/**
 * @module commands/dev
 * scrml dev subcommand.
 *
 * Compile + watch + Bun.serve() static file server pointing at output dir.
 * Default port 3000.
 *
 * Server function routes: after each compilation pass, *.server.js files in the
 * output directory are scanned and dynamically imported. Any export whose value
 * has shape `{ path, method, handler }` is registered as a live route. Incoming
 * requests are matched against registered routes BEFORE the static file fallback.
 *
 * WebSocket channels: exports named `_scrml_ws_handlers` are collected and merged
 * into the Bun.serve() `websocket:` option. Channel upgrade routes (isWebSocket: true)
 * have their handler called as `handler(req, server)` so server.upgrade() can be invoked.
 */

import { statSync, readdirSync, watch } from "fs";
import { resolve, dirname, join } from "path";
import { compileScrml, scanDirectory, findOutputFiles } from "../api.js";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`scrml dev <file.scrml|directory> [options]

Compile scrml source, start a dev server, and watch for changes.
The browser reloads automatically when files change.

Arguments:
  <file.scrml>            A single .scrml file
  <directory>             A directory — all .scrml files inside are compiled

Options:
  --output, -o <dir>      Output directory (default: dist/ next to input)
  --port, -p <n>          HTTP port for dev server (default: 3000)
  --verbose, -v           Show per-stage timing and counts
  --embed-runtime         Embed runtime inline instead of writing a separate file
  --convert-legacy-css    Convert <style> blocks to #{...}
  --help, -h              Show this message

Examples:
  scrml dev src/app.scrml
  scrml dev src/ --port 8080
`);
}

/**
 * Parse dev-command arguments.
 *
 * @param {string[]} args
 * @returns {{ inputFiles: string[], outputDir: string|null, verbose: boolean,
 *             convertLegacyCss: boolean, embedRuntime: boolean, port: number }}
 */
function parseArgs(args) {
  const inputFiles = [];
  let outputDir = null;
  let verbose = false;
  let convertLegacyCss = false;
  let embedRuntime = false;
  let port = 3000;
  // W2 §21.7: auto-gather defaults ON. `--no-gather` opts out.
  let gather = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg === "-o") {
      outputDir = args[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--convert-legacy-css") {
      convertLegacyCss = true;
    } else if (arg === "--embed-runtime") {
      embedRuntime = true;
    } else if (arg === "--no-gather") {
      // W2 §21.7: opt out of transitive .scrml import closure pre-pass.
      gather = false;
    } else if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error(`Invalid port: ${args[i]}`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.endsWith(".scrml")) {
      inputFiles.push(resolve(arg));
    } else {
      // Directory?
      try {
        const stat = statSync(arg);
        if (stat.isDirectory()) {
          const dirFiles = scanDirectory(arg);
          inputFiles.push(...dirFiles);
          continue;
        }
      } catch { /* not a directory */ }
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, port, gather };
}

// ---------------------------------------------------------------------------
// Server-route and WebSocket handler registry
//
// registeredRoutes: flat array of { path, method, handler, isWebSocket? } from all
// *.server.js files in the output directory after each compilation pass.
//
// registeredWsHandlers: merged { open, message, close } from all _scrml_ws_handlers
// exports. Used as the Bun.serve() websocket: option.
//
// Both are cleared and rebuilt on every recompile so that watch-mode changes are
// picked up without restarting the dev server.
// ---------------------------------------------------------------------------

/** @type {Array<{ path: string, method: string, handler: Function, isWebSocket?: boolean }>} */
let registeredRoutes = [];

/** @type {{ open: Function, message: Function, close: Function } | null} */
let registeredWsHandlers = null;

/**
 * Scan `outputDir` for `*.server.js` files, dynamically import each, and
 * collect every export that looks like a route object or WebSocket handlers.
 *
 * Route object shape (as emitted by emit-server.ts):
 *   export const _scrml_route_foo = { path, method, handler }
 *   export const _scrml_route_ws_<name> = { path, method: "GET", isWebSocket: true, handler }
 *
 * WebSocket handlers shape (as emitted by emit-channel.ts):
 *   export const _scrml_ws_handlers = { open(ws), message(ws, raw), close(ws, code, reason) }
 *
 * Bun caches ES module imports by specifier. To force a reload after
 * recompilation we append a `?t=<timestamp>` cache-buster to the import URL.
 *
 * @param {string} outputDir
 * @returns {Promise<void>}
 */
async function loadServerRoutes(outputDir) {
  registeredRoutes = [];
  registeredWsHandlers = null;

  // F-COMPILE-001 Option A: outputDir may be a tree when sources have nested
  // subdirectories. Walk recursively for *.server.js entries.
  const serverFiles = findOutputFiles(outputDir, ".server.js");
  if (serverFiles.length === 0) return;

  const cacheBuster = Date.now();
  const allWsHandlers = [];

  for (const { absPath, relPath } of serverFiles) {
    // Absolute file URL with cache-buster so Bun re-evaluates on each reload.
    const fileUrl = `file://${absPath}?t=${cacheBuster}`;

    let mod;
    try {
      mod = await import(fileUrl);
    } catch (err) {
      console.error(`[dev] Failed to import ${relPath}: ${err.message}`);
      continue;
    }

    for (const exportName of Object.keys(mod)) {
      const value = mod[exportName];
      if (!value || typeof value !== "object") continue;

      // WebSocket handlers export — collect separately, NOT as a route.
      // _scrml_ws_handlers has shape { open, message, close }, not { path, method, handler }.
      if (exportName === "_scrml_ws_handlers") {
        allWsHandlers.push(value);
        continue;
      }

      // Regular route or WS upgrade route: { path, method, handler }
      if (
        typeof value.path === "string" &&
        typeof value.method === "string" &&
        typeof value.handler === "function"
      ) {
        registeredRoutes.push(value);
      }
    }
  }

  // Merge all _scrml_ws_handlers into a single object.
  // Each module already scopes to its own channels via ws.data.__ch.
  if (allWsHandlers.length === 1) {
    registeredWsHandlers = allWsHandlers[0];
  } else if (allWsHandlers.length > 1) {
    registeredWsHandlers = {
      open(ws) {
        for (const h of allWsHandlers) { if (h.open) h.open(ws); }
      },
      message(ws, raw) {
        for (const h of allWsHandlers) { if (h.message) h.message(ws, raw); }
      },
      close(ws, code, reason) {
        for (const h of allWsHandlers) { if (h.close) h.close(ws, code, reason); }
      },
    };
  }

  if (registeredRoutes.length > 0) {
    const wsRoutes = registeredRoutes.filter(r => r.isWebSocket);
    const httpRoutes = registeredRoutes.filter(r => !r.isWebSocket);
    console.log(`[dev] Registered ${httpRoutes.length} HTTP route(s)${wsRoutes.length > 0 ? ` + ${wsRoutes.length} WebSocket upgrade route(s)` : ""}:`);
    for (const r of registeredRoutes) {
      const label = r.isWebSocket ? "WS    " : r.method.padEnd(6);
      console.log(`[dev]   ${label} ${r.path}`);
    }
  }

  if (registeredWsHandlers) {
    console.log(`[dev] WebSocket channel handler registered (§38)`);
  }
}

/**
 * Run a single compilation pass.
 *
 * @param {object} opts
 * @returns {{ success: boolean, outputDir: string }}
 */
function runOnce(opts, gatheredOut) {
  const { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, gather } = opts;

  const result = compileScrml({
    inputFiles,
    outputDir,
    verbose,
    convertLegacyCss,
    embedRuntime,
    gather,
    write: true,
    log: console.log,
  });

  // W2 B5: surface the gathered .scrml file set so the watcher can extend
  // dirsToWatch to include any sibling-directory imports.
  if (gatheredOut && Array.isArray(result.gatheredFiles)) {
    gatheredOut.files = result.gatheredFiles;
  }


  // Ghost-pattern lint diagnostics (W-LINT-NNN) — non-fatal, adopter-facing.
  // Surfaces JSX/Vue/Svelte syntax early so it does not silently compile to
  // broken output and leave a dead UI in the browser.
  const lintDiags = result.lintDiagnostics || [];
  if (lintDiags.length > 0) {
    console.error(`[dev] ${lintDiags.length} ghost-pattern lint${lintDiags.length !== 1 ? "s" : ""}:`);
    for (const d of lintDiags) {
      const rel = d.filePath || d.file || "";
      console.error(`  [${d.code}] ${rel}:${d.line}:${d.column} ${d.message}`);
    }
  }

  // Non-fatal warnings
  if (result.warnings && result.warnings.length > 0) {
    console.error(`[dev] ${result.warnings.length} warning${result.warnings.length !== 1 ? "s" : ""}:`);
    for (const w of result.warnings) {
      const rel = w.filePath || w.file || "";
      const loc = w.line ? `:${w.line}` : "";
      console.error(`  ${w.code ? "[" + w.code + "] " : ""}${rel}${loc} ${w.message?.slice(0, 120)}`);
    }
  }

  if (result.errors.length > 0) {
    console.error(`[dev] Compilation errors: ${result.errors.length}`);
    for (const e of result.errors) {
      console.error(`  [${e.stage}] ${e.code}: ${e.message?.slice(0, 120)}`);
    }
    return { success: false, outputDir: result.outputDir };
  }

  return { success: true, outputDir: result.outputDir };
}

// ---------------------------------------------------------------------------
// Hot reload — SSE client registry
// ---------------------------------------------------------------------------

/** @type {Set<ReadableStreamDefaultController>} */
export const sseClients = new Set();

/**
 * Create an SSE Response for a new client connection.
 * @returns {Response}
 */
export function createSseResponse() {
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      sseClients.add(controller);
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      sseClients.delete(controller);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Send a "reload" SSE event to all connected clients.
 */
export function broadcastReload() {
  const msg = new TextEncoder().encode("event: reload\ndata: {}\n\n");
  for (const controller of sseClients) {
    try {
      controller.enqueue(msg);
    } catch {
      sseClients.delete(controller);
    }
  }
}

const HOT_RELOAD_SCRIPT = `<script>
(function(){var es=new EventSource("/_scrml/live-reload");es.addEventListener("reload",function(){location.reload()});es.onerror=function(){es.close();setTimeout(function(){es=new EventSource("/_scrml/live-reload")},2000)};})();
</script>`;

/**
 * Inject hot-reload script into HTML before </body> or at end.
 * @param {string} html
 * @returns {string}
 */
export function injectHotReloadScript(html) {
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) return html.slice(0, idx) + HOT_RELOAD_SCRIPT + html.slice(idx);
  return html + HOT_RELOAD_SCRIPT;
}

/**
 * Build the Bun.serve() config object including WebSocket support when channels exist.
 *
 * Called initially and after each recompile to update routes/ws handlers.
 *
 * @param {{ port: number }} opts
 * @param {string} serveDir
 * @returns {object} Bun.serve() config
 */
function buildServeConfig(opts, serveDir) {
  const config = {
    port: opts.port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // SSE hot-reload endpoint
      if (pathname === "/_scrml/live-reload") {
        return createSseResponse();
      }

      // ------------------------------------------------------------------
      // Route dispatch — check registered server routes BEFORE static files.
      //
      // Match on path (exact) and method (case-insensitive). The path values
      // emitted by CG look like "/_scrml/fn/functionName" so no prefix strip
      // is needed — they match the raw pathname directly.
      //
      // WebSocket upgrade routes (isWebSocket: true) receive server as the
      // second argument so they can call server.upgrade(req).
      // ------------------------------------------------------------------
      for (const route of registeredRoutes) {
        if (
          route.path === pathname &&
          route.method.toUpperCase() === req.method.toUpperCase()
        ) {
          try {
            // Channel WS upgrade routes need server ref to call server.upgrade()
            if (route.isWebSocket) return await route.handler(req, server);
            return await route.handler(req);
          } catch (err) {
            console.error(`[dev] Route handler error for ${req.method} ${pathname}: ${err.message}`);
            return new Response(
              JSON.stringify({ error: "Internal server error", detail: err.message }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
        }
      }

      // ------------------------------------------------------------------
      // Static file fallback
      // ------------------------------------------------------------------
      let staticPathname = pathname === "/" ? "/index.html" : pathname;

      // Try exact path first, then with .html extension
      const candidates = [
        join(serveDir, staticPathname),
        join(serveDir, `${staticPathname}.html`),
      ];

      for (const candidate of candidates) {
        const file = Bun.file(candidate);
        // Bun.file() is lazy — check existence via statSync
        try {
          if (statSync(candidate).isFile()) {
            // Inject hot-reload script into HTML responses
            if (candidate.endsWith(".html")) {
              const html = await file.text();
              return new Response(injectHotReloadScript(html), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }
            return new Response(file);
          }
        } catch { /* not found */ }
      }

      // If requesting / and index.html doesn't exist, serve the first
      // .html file found — handles the common single-file project case
      // where the output is app.html instead of index.html.
      if (pathname === "/") {
        try {
          const entries = readdirSync(serveDir);
          const htmlFile = entries.find(e => e.endsWith(".html"));
          if (htmlFile) {
            const fallbackPath = join(serveDir, htmlFile);
            const file = Bun.file(fallbackPath);
            const html = await file.text();
            return new Response(injectHotReloadScript(html), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        } catch { /* no serve dir yet */ }
      }

      return new Response("Not found", { status: 404 });
    },
  };

  // Add websocket: option when channel handlers are registered (§38)
  if (registeredWsHandlers) {
    config.websocket = registeredWsHandlers;
  }

  return config;
}

/**
 * Entry point for the dev subcommand.
 *
 * @param {string[]} args — raw argv slice after "dev"
 */
export async function runDev(args) {
  const opts = parseArgs(args);

  if (opts.inputFiles.length === 0) {
    console.error("Usage: scrml dev <file.scrml|directory> [options]");
    console.error("Run `scrml dev --help` for details.");
    process.exit(1);
  }

  // Initial compile
  console.log(`scrml dev — compiling ${opts.inputFiles.length} file(s)...`);
  const gatheredOut = { files: [] };
  const { outputDir } = runOnce(opts, gatheredOut);

  // Resolve the serve directory the same way the server does.
  const serveDir = outputDir || join(dirname(opts.inputFiles[0]), "dist");

  // Load server routes from the initial compilation output.
  await loadServerRoutes(serveDir);

  // Start static file server with WebSocket support if channels were found.
  // Bun.serve() returns a server object that supports server.reload(config)
  // to update routes/ws handlers without dropping connections.
  let server = Bun.serve(buildServeConfig(opts, serveDir));
  // C18 (§38.6): expose Bun.serve() handle for the broadcast() helper
  // injected into channel-scoped server functions. Refreshed on every
  // server.reload() since reload() returns the same server instance.
  globalThis._scrml_active_server = server;

  console.log(`[dev] Serving ${serveDir} at http://localhost:${opts.port}`);
  console.log(`[dev] Watching for changes... (Ctrl+C to stop)\n`);

  // Watch loop with 100ms debounce
  // W2 §21.7 / B5: dirsToWatch is recomputed after each runOnce so the
  // auto-gather closure (which may pull in files from sibling directories)
  // is fully covered by the watcher. Initial set seeded from explicit
  // inputFiles; on each recompile dirsToWatch is updated to also include the
  // dirs of any GATHERED files (the keys of result.outputs).
  const dirsToWatch = new Set(opts.inputFiles.map(f => dirname(f)));
  // W2 §21.7 / B5: extend with directories of any gathered files outside the
  // entry's directory tree (e.g. sibling components/ pulled in by import).
  for (const f of gatheredOut.files) {
    dirsToWatch.add(dirname(f));
  }
  let debounceTimer = null;

  function scheduleRecompile(eventType, filename) {
    if (filename && !filename.endsWith(".scrml")) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log(`[dev] Change detected — recompiling...`);
      const recomputeGathered = { files: [] };
      const { success, outputDir: recompileOutputDir } = runOnce(opts, recomputeGathered);
      // W2 B5: extend dirsToWatch in case a recompile pulled in NEW imports.
      for (const f of recomputeGathered.files) {
        if (!dirsToWatch.has(dirname(f))) {
          dirsToWatch.add(dirname(f));
          // Note: we do not start a NEW watch on the new dir — the next
          // `scrml dev` start will pick it up. This is acceptable because
          // adding cross-dir imports is rare; existing watchers cover the
          // common case. Future enhancement: dynamically watch new dirs.
        }
      }
      if (success) {
        // Reload server routes to pick up any changes to server functions.
        await loadServerRoutes(recompileOutputDir || serveDir);
        // Reload the Bun.serve() instance to update WebSocket handlers if they changed.
        // server.reload() updates the config in-place, preserving existing connections.
        try {
          server.reload(buildServeConfig(opts, serveDir));
        } catch {
          // Fallback: stop and restart (drops SSE connections, browser auto-reconnects)
          server.stop(true);
          server = Bun.serve(buildServeConfig(opts, serveDir));
        }
        // C18 (§38.6): refresh broadcast() handle after reload/restart.
        globalThis._scrml_active_server = server;
        // Signal all connected browsers to reload.
        broadcastReload();
        if (sseClients.size > 0) {
          console.log(`[dev] Signalled ${sseClients.size} browser(s) to reload`);
        }
      }
    }, 100);
  }

  for (const dir of dirsToWatch) {
    watch(dir, { recursive: true }, scheduleRecompile);
  }

  // Keep process alive (server already does this, but be explicit)
  await new Promise(() => {});
}
