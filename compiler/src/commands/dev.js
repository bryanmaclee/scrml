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
import { resolve, dirname, join, basename } from "path";
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
  --idle-timeout <n>      Bun.serve idleTimeout in seconds (default: 120; raises
                          the 10s default so long data-layer routes finish)
  --verbose, -v           Show per-stage timing and counts
  --embed-runtime         Embed runtime inline instead of writing a separate file
  --convert-legacy-css    Convert <style> blocks to #{...}
  --validate-emit         Parse every emitted JS artifact (E-CODEGEN-INVALID-LOGIC); abort on malformed output
  --no-validate-emit      Opt out of the emitted-JS parse gate (dev/CI escape hatch)
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
 *             convertLegacyCss: boolean, embedRuntime: boolean, port: number,
 *             idleTimeout: number }}
 */
function parseArgs(args) {
  const inputFiles = [];
  let outputDir = null;
  let verbose = false;
  let convertLegacyCss = false;
  let embedRuntime = false;
  let port = 3000;
  // ss33 item 3 (g-dev-server-idletimeout-not-configurable): the S221 raise to
  // 120s (so legitimate >10s data-layer routes are not truncated mid-flight) is
  // now an overridable knob, mirroring `--port`. Default stays 120 so unset
  // callers are byte-unchanged.
  let idleTimeout = 120;
  // W2 §21.7: auto-gather defaults ON. `--no-gather` opts out.
  let gather = true;
  // S142 — emitted-JS parse gate. undefined = compileScrml default; `true`
  // forces on; `false` (--no-validate-emit) is the dev opt-out.
  let validateEmit = undefined;

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
    } else if (arg === "--validate-emit") {
      validateEmit = true;
    } else if (arg === "--no-validate-emit") {
      validateEmit = false;
    } else if (arg === "--no-gather") {
      // W2 §21.7: opt out of transitive .scrml import closure pre-pass.
      gather = false;
    } else if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error(`Invalid port: ${args[i]}`);
        process.exit(1);
      }
    } else if (arg === "--idle-timeout") {
      idleTimeout = parseInt(args[++i], 10);
      if (isNaN(idleTimeout) || idleTimeout < 0) {
        console.error(`Invalid idle-timeout (expected non-negative seconds): ${args[i]}`);
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

  return { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, port, idleTimeout, gather, validateEmit };
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
  const { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, gather, validateEmit } = opts;

  const result = compileScrml({
    inputFiles,
    outputDir,
    verbose,
    convertLegacyCss,
    embedRuntime,
    gather,
    write: true,
    log: console.log,
    // S142 — `--validate-emit` / `--no-validate-emit`. undefined = compileScrml default.
    validateEmit,
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
      // Bug 3 fix (S107) — mirror the error-path fallback so BS-stage warnings
      // (W-PROGRAM-* etc.) surface path:line:col now that api.js stamps span.
      const rel = w.filePath || w.span?.file || w.file || "";
      const line = w.line ?? w.span?.line;
      const col = w.column ?? w.col ?? w.span?.col;
      const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
      console.error(`  ${w.code ? "[" + w.code + "] " : ""}${rel}${loc} ${w.message?.slice(0, 120)}`);
    }
  }

  if (result.errors.length > 0) {
    console.error(`[dev] Compilation errors: ${result.errors.length}`);
    for (const e of result.errors) {
      // Bug 3 fix (S107) — mirror the [W-LINT-*] formatter shape so adopters
      // with many .scrml files can localize the failing source. CGError-shape
      // diagnostics carry `span.line` / `span.col`; api.js's collectErrors
      // stamps `filePath` (and `span.file`) on per-file stage outputs (BS / TAB)
      // so this formatter can read them. Falls through both shapes — direct
      // `e.line` (used by some later stages) and `e.span.line` (used by BS).
      const rel = e.filePath || e.span?.file || "";
      const line = e.line ?? e.span?.line;
      const col = e.column ?? e.col ?? e.span?.col;
      const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
      console.error(`  [${e.stage}] ${rel}${loc} ${e.code}: ${e.message?.slice(0, 120)}`);
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
 * Derive the bounded set of source files to watch for hot-reload.
 *
 * BUG-1 fix (scrml-dev-watcher-and-stale-entry-2026-06-01): the previous
 * implementation watched `dirname(inputFile)` recursively. When `scrml dev`
 * is run from a large parent directory, `fs.watch(dir, {recursive:true})`
 * registers an inotify watch for EVERY file in that tree — `node_modules`,
 * sibling repos, `.git`, `.claude/worktrees` — blowing
 * `fs.inotify.max_user_watches` and crashing the dev server with an
 * unhandled `ENOSPC` error.
 *
 * Instead we watch the bounded set of gathered `.scrml` source files
 * DIRECTLY (one `fs.watch` per real source). This is bounded by source count
 * and never touches `node_modules` or sibling directories. `fs.watch` has no
 * ignore-pattern support, so per-file watching is the robust way to exclude
 * non-source files — a recursive dir-watch cannot exclude subdirs.
 *
 * Documented limitation: a BRAND-NEW top-level `.scrml` file added to a
 * directory is not auto-detected until the next recompile/restart (the
 * recursive dir-watch that the old code used WAS the bug). The re-gather on
 * recompile (see scheduleRecompile) still extends the set when an existing
 * watched source adds a NEW import.
 *
 * @param {{ inputFiles: string[] }} opts
 * @param {string[]} gatheredFiles  Full transitive .scrml closure from compileScrml().gatheredFiles
 * @returns {string[]} de-duped absolute `.scrml` file paths
 */
export function deriveWatchFiles(opts, gatheredFiles) {
  const set = new Set();
  for (const f of opts.inputFiles || []) {
    if (typeof f === "string" && f.endsWith(".scrml")) set.add(resolve(f));
  }
  for (const f of gatheredFiles || []) {
    if (typeof f === "string" && f.endsWith(".scrml")) set.add(resolve(f));
  }
  return [...set];
}

/**
 * Resolve the preferred root-`/` entry HTML candidate.
 *
 * BUG-2 fix (scrml-dev-watcher-and-stale-entry-2026-06-01): for root `/`,
 * static resolution looks for `index.html`; when the compiled entry is not
 * `index.html` (e.g. `scrml dev req.scrml` → `req.html`), resolution used to
 * fall through to "first .html file in dist root", which serves a STALE app
 * when `dist/` contains leftover output from a prior `scrml dev` of a
 * DIFFERENT source (`scrml dev` does not clean its output dir).
 *
 * When dev compiles a SINGLE input file, that file's `<basename>.html` is the
 * canonical index. We prefer it ahead of the "first .html" fallback. For
 * multi-input / directory dev mode (>=2 input files) there is no single
 * unambiguous entry, so we return absence and keep the existing fallback.
 *
 * @param {{ inputFiles: string[] }} opts
 * @param {string} serveDir
 * @returns {string} absolute path to `<entryBase>.html`, or "" when there is
 *                   no single unambiguous entry.
 */
export function resolveRootEntryCandidate(opts, serveDir) {
  const inputs = opts.inputFiles || [];
  if (inputs.length !== 1) return "";
  const entry = inputs[0];
  if (typeof entry !== "string" || !entry.endsWith(".scrml")) return "";
  const base = basename(entry, ".scrml");
  return join(serveDir, `${base}.html`);
}

/**
 * Build the Bun.serve() config object including WebSocket support when channels exist.
 *
 * Called initially and after each recompile to update routes/ws handlers.
 *
 * @param {{ port: number, idleTimeout?: number }} opts
 * @param {string} serveDir
 * @returns {object} Bun.serve() config
 */
function buildServeConfig(opts, serveDir) {
  const config = {
    port: opts.port,
    // S221 (g-dev-server-idletimeout-default-10s, flogence S15 Finding B): Bun's
    // default idleTimeout is 10s, which truncates legitimate >10s data-layer routes
    // (a heavy ?{} query, a _{} foreign slice spawning a subprocess, or ~20 mount-time
    // load routes contending) mid-flight → ERR_INCOMPLETE_CHUNKED_ENCODING on the
    // client even though the server work completed. Raise to 120s by default.
    // ss33 item 3 (g-dev-server-idletimeout-not-configurable): overridable via
    // `--idle-timeout <seconds>`; `?? 120` keeps direct callers (and tests that
    // build opts without the flag) byte-unchanged.
    idleTimeout: opts.idleTimeout ?? 120,
    async fetch(req, server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // SSE hot-reload endpoint
      if (pathname === "/_scrml/live-reload") {
        return createSseResponse();
      }

      // §20.6 (F2=B) — client log() forwarding endpoint. In development the
      // compiled client `_scrml_log` POSTs each tagged client-side log here so
      // the developer sees ONE unified view in the terminal (terminal-as-the-
      // single-view): server `log()` already prints to this terminal, and now
      // client `log()` does too. Payload: { side:"client", loc, msg }. The
      // print mirrors the runtime line format `[client] <msg> (loc)`. Fire-and-
      // forget on the client side; this handler never blocks the page.
      if (pathname === "/_scrml/log" && req.method.toUpperCase() === "POST") {
        try {
          const payload = await req.json();
          const side = (payload && typeof payload.side === "string") ? payload.side : "client";
          const msg = (payload && typeof payload.msg === "string") ? payload.msg : "";
          const loc = (payload && typeof payload.loc === "string") ? payload.loc : "";
          const locSuffix = loc ? ` (${loc})` : "";
          console.log(`[${side}] ${msg}${locSuffix}`);
        } catch {
          // Malformed payload — ignore (a dev convenience must never 500 a page).
        }
        return new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
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
      //
      // mpa-shell-clean-urls (2026-05-17): with the build now stripping
      // `pages/` from dist paths (api.js pathFor), URLs map directly to
      // dist files. Resolution order:
      //   1. exact file (`/foo/bar.js` → `dist/foo/bar.js`)
      //   2. with .html suffix (`/foo` → `dist/foo.html`)
      //   3. as directory index (`/foo` → `dist/foo/index.html`)
      //   4. as trailing-slash directory index (`/foo/` → `dist/foo/index.html`)
      //   5. (root only) any .html file in dist root
      // Step 3 + 4 are new — pre-fix only steps 1 + 2 + 5 existed; with
      // the path strip, nested pages (`pages/foo/index.scrml` →
      // `dist/foo/index.html`) need directory-index resolution for
      // `/foo` to land on the right file.
      // ------------------------------------------------------------------
      // Normalize trailing slash to fold `/foo/` into `/foo` for the
      // first probe (the trailing-slash form still resolves via the
      // directory-index candidate below).
      const trimmedPathname = (pathname !== "/" && pathname.endsWith("/"))
        ? pathname.slice(0, -1)
        : pathname;
      let staticPathname = trimmedPathname === "/" ? "/index.html" : trimmedPathname;

      // Try, in order: exact file, with .html, as dir/index.html.
      const candidates = [
        join(serveDir, staticPathname),
        join(serveDir, `${staticPathname}.html`),
        join(serveDir, staticPathname, "index.html"),
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

      // Root-only HTML resolution.
      //
      // BUG-2 fix (scrml-dev-watcher-and-stale-entry-2026-06-01): PREFER the
      // compiled entry `<entryBase>.html` for the single-input case BEFORE the
      // "first .html in dist root" fallback. `scrml dev` does not clean its
      // output dir, so a leftover `test.html` from a prior session can sit
      // beside a fresh `req.html`; the old "first .html" scan would serve the
      // STALE app. When dev compiles a single input file, that file's `.html`
      // is the canonical index.
      if (pathname === "/") {
        const entryCandidate = resolveRootEntryCandidate(opts, serveDir);
        if (entryCandidate) {
          try {
            if (statSync(entryCandidate).isFile()) {
              const file = Bun.file(entryCandidate);
              const html = await file.text();
              return new Response(injectHotReloadScript(html), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }
          } catch { /* entry not emitted yet — fall through to scan */ }
        }

        // Fallback: serve the first .html file found — handles directory /
        // multi-input dev mode where there is no single unambiguous entry,
        // and the common single-file case when the entry candidate is absent.
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

  // BUG-1 fix (scrml-dev-watcher-and-stale-entry-2026-06-01): watch the
  // bounded set of gathered `.scrml` source files DIRECTLY (one fs.watch per
  // real source) instead of `fs.watch(dirname(input), {recursive:true})`.
  //
  // The recursive dir-watch registered an inotify watch for every file in the
  // entry's directory tree — including `node_modules`, sibling repos, `.git`,
  // and `.claude/worktrees` when run from a large parent directory — blowing
  // `fs.inotify.max_user_watches` and crashing the server with an unhandled
  // ENOSPC. Per-file watching is bounded by source count and never touches
  // those trees (fs.watch has no ignore-pattern support, so per-file is the
  // robust exclusion mechanism).
  //
  // `watchedFiles` tracks which absolute source paths already have a live
  // watch so the re-gather pass can add watches for NEW imports without
  // double-watching existing ones.
  const watchedFiles = new Set();
  // Warn at most once about the watch limit so a degraded watcher does not
  // spam the console on every failed watch attempt.
  let watchLimitWarned = false;
  let debounceTimer = null;

  /**
   * Start watching a single source file. Wrapped so a watch failure (e.g.
   * ENOSPC at the inotify limit) degrades gracefully — the dev server keeps
   * serving with hot-reload disabled rather than crashing.
   *
   * @param {string} file absolute `.scrml` path
   */
  function watchFile(file) {
    if (watchedFiles.has(file)) return;
    const warnLimit = (err) => {
      if (watchLimitWarned) return;
      watchLimitWarned = true;
      if (err && err.code === "ENOSPC") {
        console.error(`[dev] file-watch limit hit (fs.inotify.max_user_watches) — hot-reload disabled; raise the limit with: sudo sysctl fs.inotify.max_user_watches=524288`);
      } else {
        console.error(`[dev] file watch failed (${err && err.message ? err.message : err}) — hot-reload may be degraded; server still serving`);
      }
    };
    try {
      const w = watch(file, (eventType, filename) => scheduleRecompile(eventType, filename || file));
      // A watcher `error` event (e.g. ENOSPC, file removed) must NEVER crash
      // the server. Warn once and keep serving.
      w.on("error", (err) => warnLimit(err));
      watchedFiles.add(file);
    } catch (err) {
      // Synchronous watch() failure (also ENOSPC on some platforms).
      warnLimit(err);
    }
  }

  function scheduleRecompile(eventType, filename) {
    if (filename && !filename.endsWith(".scrml")) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log(`[dev] Change detected — recompiling...`);
      const recomputeGathered = { files: [] };
      const { success, outputDir: recompileOutputDir } = runOnce(opts, recomputeGathered);
      // BUG-1 fix: a recompile may have pulled in NEW imports. Because we now
      // watch individual files (not dirs), we can start watches on the newly
      // gathered sources immediately — no restart needed.
      for (const f of deriveWatchFiles(opts, recomputeGathered.files)) {
        watchFile(f);
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

  // Start a watch on each gathered source file (entry + transitive imports).
  for (const file of deriveWatchFiles(opts, gatheredOut.files)) {
    watchFile(file);
  }

  // Keep process alive (server already does this, but be explicit)
  await new Promise(() => {});
}
