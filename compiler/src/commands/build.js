/**
 * @module commands/build
 * scrml build subcommand.
 *
 * Compiles all .scrml files in a directory and generates a production
 * server entry point (dist/_server.js) that:
 *  - Imports all *.server.js route handler exports
 *  - Registers routes in a Bun.serve() fetch handler
 *  - Serves static files (HTML, CSS, client.js, runtime) as fallback
 *  - Exposes a health check at /_scrml/health
 *  - Respects the PORT env var (default 3000)
 *  - Wires WebSocket channels (_scrml_ws_handlers) into Bun.serve() websocket: option
 *
 * Usage: scrml build <dir> [--output dist/] [--embed-runtime] [--minify] [--target <platform>]
 */

import { statSync, readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import { compileScrml, scanDirectory, findOutputFiles } from "../api.js";
import { moduleFormatNotices } from "./module-format-notice.js";

/** Valid deployment target identifiers. */
const VALID_TARGETS = ["fly", "railway", "render", "static", "docker"];

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`scrml build <directory> [options]

Compile all .scrml files in a directory and produce a production-ready output
with a server entry point (_server.js) for deployment.

Arguments:
  <directory>               Directory containing .scrml source files

Options:
  --output, -o <dir>        Output directory (default: dist/ next to input)
  --module-format=<fmt>     Client runtime module format: classic (default) or esm
                            (esm emits ES modules + type="module" tags and runs in
                            a browser, but is experimental/opt-in; classic is the
                            only conformance-tested path)
  --embed-runtime           Embed runtime inline instead of writing a separate file
  --minify                  Accepted flag (minification is a Phase 2 feature)
  --verbose, -v             Per-stage timing and counts
  --validate-emit           Parse every emitted JS artifact (E-CODEGEN-INVALID-LOGIC); abort on malformed output
  --no-validate-emit        Opt out of the emitted-JS parse gate (dev/CI escape hatch)
  --target <platform>       Deploy adapter: fly|railway|render|static|docker
  --idle-timeout <n>        Bun.serve idleTimeout in seconds baked into the
                            production server (default: 120; raises the 10s
                            default so long server routes finish)
  --help, -h                Show this message

Examples:
  scrml build src/
  scrml build src/ --output dist/ --target fly
  scrml build src/ --target static
`);
}

/**
 * Parse build-command arguments.
 *
 * @param {string[]} args
 * @returns {{ inputDir: string|null, outputDir: string|null, embedRuntime: boolean, minify: boolean, verbose: boolean, target: string|null, idleTimeout: number }}
 */
export function parseArgs(args) {
  let inputDir = null;
  let outputDir = null;
  let embedRuntime = false;
  let minify = false;
  let verbose = false;
  let target = null;
  // ss33 item 3 (g-dev-server-idletimeout-not-configurable): the S221 raise to
  // 120s is baked into the emitted production server; `--idle-timeout <seconds>`
  // overrides the value emitted into the prod-server config. Default 120 so the
  // emitted server.js is byte-unchanged when the flag is unset.
  let idleTimeout = 120;
  // S142 — emitted-JS parse gate. undefined = compileScrml default; `true`
  // forces on; `false` (--no-validate-emit) is the dev/CI opt-out.
  let validateEmit = undefined;
  // ESM chunks arc (Unit 1) — client runtime module format (classic|esm).
  // Default `classic` is byte-identical to pre-arc output.
  let moduleFormat = "classic";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg === "-o") {
      outputDir = args[++i];
    } else if (arg === "--module-format" || arg.startsWith("--module-format=")) {
      // ESM chunks arc (Unit 1) — `--module-format=classic|esm`. Both `=value`
      // and space-separated shapes accepted; unknown value errors.
      let raw;
      if (arg === "--module-format") {
        raw = args[++i];
        if (!raw) {
          console.error(`--module-format requires a value: classic|esm`);
          process.exit(1);
        }
      } else {
        raw = arg.substring("--module-format=".length);
      }
      if (raw !== "classic" && raw !== "esm") {
        console.error(`Unknown --module-format value: "${raw}". Valid values: classic, esm`);
        process.exit(1);
      }
      moduleFormat = raw;
    } else if (arg === "--validate-emit") {
      validateEmit = true;
    } else if (arg === "--no-validate-emit") {
      validateEmit = false;
    } else if (arg === "--embed-runtime") {
      embedRuntime = true;
    } else if (arg === "--minify") {
      // Accepted flag — minification is a no-op in v1 but the flag is recognized
      minify = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--target") {
      const val = args[++i];
      if (!val) {
        console.error("--target requires a value: fly|railway|render|static|docker");
        process.exit(1);
      }
      if (!VALID_TARGETS.includes(val)) {
        console.error(`Unknown --target value: "${val}". Valid targets: ${VALID_TARGETS.join("|")}`);
        process.exit(1);
      }
      target = val;
    } else if (arg === "--idle-timeout") {
      idleTimeout = parseInt(args[++i], 10);
      if (isNaN(idleTimeout) || idleTimeout < 0) {
        console.error(`Invalid idle-timeout (expected non-negative seconds): ${args[i]}`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      // Treat as input directory
      try {
        const stat = statSync(arg);
        if (stat.isDirectory()) {
          inputDir = resolve(arg);
          continue;
        }
      } catch { /* not a directory */ }
      console.error(`Unknown argument or non-directory path: ${arg}`);
      process.exit(1);
    }
  }

  return { inputDir, outputDir, embedRuntime, minify, verbose, target, idleTimeout, validateEmit, moduleFormat };
}

/**
 * Discover all *.server.js files in the output directory and extract their
 * exported route names. Route exports follow the naming convention:
 *   export const _scrml_route_<name> = { ... }
 * or:
 *   export const _scrml_session_destroy = { ... }  (auth/session handler)
 *
 * WebSocket handler exports (_scrml_ws_handlers) are separated into wsHandlerNames — they
 * must NOT be added to the routes array (they have shape {open, message, close}, not
 * {path, method, handler}, and are passed to Bun.serve() websocket: option instead).
 *
 * @param {string} outputDir
 * @returns {Array<{ filename: string, routeNames: string[], wsHandlerNames: string[] }>}
 */
export function discoverServerRoutes(outputDir) {
  // F-COMPILE-001 Option A: outputDir may be a tree (e.g. dist/pages/customer/home.server.js)
  // when sources have nested subdirectories. Walk recursively and use the
  // tree-relative path as the import specifier (the `filename` field is a
  // relative path like "pages/customer/home.server.js", consumed by
  // generateServerEntry as `import ... from "./${filename}";`).
  const serverFiles = findOutputFiles(outputDir, ".server.js");

  const result = [];

  for (const { absPath, relPath } of serverFiles) {
    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    // Extract all named exports that look like route objects or WS handlers.
    // _scrml_ws_handlers is the Bun.serve() websocket: option — it is NOT a route.
    //   export const _scrml_route_... = { path, method, handler }  (HTTP route)
    //   export const _scrml_session_destroy = { ... }              (auth/session handler)
    //   export const _scrml_ws_handlers = { open, message, close } (WS handlers — not a route)
    const routeNames = [];
    const wsHandlerNames = [];
    // `_scrml_*` covers routes/session/endpoint/sse/cors/ws; `__ri_route_*` are
    // the inferred server-function RPC routes (a `?{}`/host-touching function
    // escalated to a route) — they do NOT carry the `_scrml_` prefix, so without
    // this alternation `scrml build` silently drops every server-function route
    // (they 404 in production while working under `scrml dev`).
    const exportRe = /export\s+const\s+(_scrml_\w+|__ri_route_\w+)\s*=/g;
    let m;
    while ((m = exportRe.exec(source)) !== null) {
      const name = m[1];
      if (name === "_scrml_ws_handlers") {
        wsHandlerNames.push(name);
      } else {
        routeNames.push(name);
      }
    }

    if (routeNames.length > 0 || wsHandlerNames.length > 0) {
      // `filename` carries the relative path under outputDir so the generated
      // `_server.js` can import via `./${filename}` regardless of nesting.
      result.push({ filename: relPath, routeNames, wsHandlerNames });
    }
  }

  return result;
}

/**
 * Generate the content of dist/_server.js.
 *
 * Handles both regular HTTP routes and WebSocket channels.
 * WebSocket channels emit two artifacts from the codegen stage:
 *   1. A route with isWebSocket: true that calls server.upgrade(req) in its handler
 *   2. A _scrml_ws_handlers export with { open, message, close } for Bun.serve() websocket:
 *
 * MCP V0 Sub-unit D (2026-05-25) — when the build's `<program>` carries the
 * `mcp` opt-in attribute, compileScrml surfaces `mcpAutoActivated: true` +
 * `mcpMode: "dev-only" | "always"` on the result. The build command passes
 * those through here as `mcpOpts`, and this function:
 *   - imports `startMcpServer` / `shutdownMcpServer` from `./_scrml/mcp.js`
 *   - boots the MCP server after `Bun.serve()` is up, with a NODE_ENV
 *     runtime gate when mode === "dev-only" (since the compiler has no
 *     canonical compile-time dev-vs-prod hook today — §58 build-story is
 *     spec-only as of S118)
 *   - wires `SIGINT` / `SIGTERM` → `shutdownMcpServer(handle)` for clean
 *     transport teardown (SCOPING risk 2 — SDK lifecycle under Bun)
 * Fall-back when `mcpOpts` is null (or `mcpOpts.activated === false`) is
 * the pre-Sub-unit-D shape — no MCP code generated, zero opt-out cost.
 *
 * @param {Array<{ filename: string, routeNames: string[], wsHandlerNames: string[] }>} serverModules
 *   Each entry is one *.server.js file. routeNames are HTTP route exports (added to the
 *   routes array). wsHandlerNames are _scrml_ws_handlers exports (passed to websocket:).
 * @param {{ activated: boolean, mode: "dev-only" | "always" } | null} [mcpOpts]
 *   MCP V0 Sub-unit D wiring; pass null / omit for non-MCP builds.
 * @param {number} [idleTimeout=120]
 *   ss33 item 3 — Bun.serve idleTimeout (seconds) baked into the emitted prod
 *   server. Defaults to 120 so the emitted server.js is byte-unchanged when the
 *   build's `--idle-timeout` flag is not set.
 * @returns {string}
 */
export function generateServerEntry(serverModules, mcpOpts = null, idleTimeout = 120, hashedAssets = []) {
  const lines = [];

  // Determine if any module exports _scrml_ws_handlers (WebSocket channels present)
  const wsModules = serverModules.filter(m => (m.wsHandlerNames ?? []).length > 0);
  const hasWs = wsModules.length > 0;

  lines.push("// scrml production server — compiler-generated");
  lines.push("// DO NOT EDIT. Regenerate with: scrml build");
  lines.push("");
  lines.push('import { statSync } from "fs";');
  lines.push('import { join, relative } from "path";');
  // MCP V0 Sub-unit D — add scrml:mcp boot import when <program mcp> opted in.
  const mcpActivated = mcpOpts && mcpOpts.activated === true;
  const mcpMode = mcpActivated ? (mcpOpts.mode || "dev-only") : null;
  if (mcpActivated) {
    lines.push('// MCP V0 Sub-unit D — scrml:mcp boot import (auto-injected by <program mcp> opt-in).');
    lines.push('// Adopters do NOT directly import scrml:mcp; the attribute IS the opt-in.');
    lines.push('// Mode: ' + mcpMode + ' (runtime NODE_ENV gate applied when "dev-only").');
    lines.push('import { startMcpServer, shutdownMcpServer } from "./_scrml/mcp.js";');
  }
  lines.push("");

  if (serverModules.length === 0) {
    lines.push("// No server routes found — serving static files only");
    lines.push("");
  } else {
    lines.push("// Server route modules");
    // F-BUILD-002: de-duplicate names across modules. Each server.js with auth
    // middleware exports its own `_scrml_session_destroy` (compiler-generated
    // boilerplate; identical shape across files), but the entry must import
    // each name at most once — duplicate imports are a JavaScript SyntaxError.
    // First-importer wins (the registered route is identical regardless of
    // source module). Per-file unique route names (`_scrml_route_<name>`) are
    // unaffected since each appears in exactly one module.
    const seenNames = new Set();
    for (const { filename, routeNames, wsHandlerNames } of serverModules) {
      // Import both route names and ws handler names from each server file
      const allNames = [
        ...(routeNames ?? []),
        ...(wsHandlerNames ?? []),
      ].filter(Boolean);
      // Drop names already imported by an earlier module
      const uniqueNames = allNames.filter(n => !seenNames.has(n));
      if (uniqueNames.length > 0) {
        for (const n of uniqueNames) seenNames.add(n);
        lines.push(`import { ${uniqueNames.join(", ")} } from "./${filename}";`);
      }
    }
    lines.push("");
  }

  // Route registry — HTTP routes only (ws handlers are NOT routes).
  // F-BUILD-002: de-duplicate route names. `_scrml_session_destroy` is emitted
  // by every auth-middleware server.js; only one entry should appear in the
  // routes array (each entry registers the same path/method handler).
  const seenRouteNames = new Set();
  const allRouteNames = [];
  for (const m of serverModules) {
    for (const n of (m.routeNames ?? [])) {
      if (seenRouteNames.has(n)) continue;
      seenRouteNames.add(n);
      allRouteNames.push(n);
    }
  }

  lines.push("// Route registry");
  if (allRouteNames.length === 0) {
    lines.push("const routes = [];");
  } else {
    lines.push("const routes = [");
    for (const name of allRouteNames) {
      lines.push(`  ${name},`);
    }
    lines.push("];");
  }
  lines.push("");

  // Health check
  lines.push("// Health check (compiler-generated)");
  lines.push("routes.push({");
  lines.push('  path: "/_scrml/health",');
  lines.push('  method: "GET",');
  lines.push(
    '  handler: () => new Response(JSON.stringify({ status: "ok", uptime: process.uptime() }), {'
  );
  lines.push('    headers: { "Content-Type": "application/json" },');
  lines.push("  }),");
  lines.push("});");
  lines.push("");

  if (hasWs) {
    // Merge all _scrml_ws_handlers into a single object for Bun.serve() websocket:
    // Multiple channel files are merged by delegating each lifecycle method.
    // Each module already routes internally via ws.data.__ch (set during upgrade).
    lines.push("// WebSocket handler — merged from all channel modules (§38)");
    if (wsModules.length === 1) {
      // Single ws module — use directly
      lines.push(`const _scrml_ws_merged = ${wsModules[0].wsHandlerNames[0]};`);
    } else {
      // Multiple ws modules — merge by delegating each lifecycle method
      const allWsNames = wsModules.flatMap(m => m.wsHandlerNames);
      lines.push("const _scrml_ws_merged = {");
      lines.push("  open(ws) {");
      for (const name of allWsNames) {
        lines.push(`    if (${name}.open) ${name}.open(ws);`);
      }
      lines.push("  },");
      lines.push("  message(ws, raw) {");
      for (const name of allWsNames) {
        lines.push(`    if (${name}.message) ${name}.message(ws, raw);`);
      }
      lines.push("  },");
      lines.push("  close(ws, code, reason) {");
      for (const name of allWsNames) {
        lines.push(`    if (${name}.close) ${name}.close(ws, code, reason);`);
      }
      lines.push("  },");
      lines.push("};");
    }
    lines.push("");
  }

  // adopter-#82 — static-asset cache policy helpers.
  //
  // FIX 1 — immutability is decided by EXACT membership in the content-addressed
  // artifact set the compiler produced (`_SCRML_IMMUTABLE`, dist-relative POSIX
  // paths), NOT by a filename shape guess. A dotted-but-unhashed asset such as
  // `app.settings.js` is therefore correctly revalidated, not frozen — the exact
  // silent-stale-asset failure #82 exists to kill. Content-addressed assets
  // (runtime `scrml-runtime.<hash>.js`, page bundles `<base>.client.<hash>.js`,
  // CSS `<base>.<hash>.css`, per-route chunks) are `immutable`; the HTML entry is
  // `no-cache`; every other static asset revalidates via a WEAK validator (ETag =
  // size+mtime, `Last-Modified`) that a conditional request can 304 against.
  lines.push("// adopter-#82 — static-asset cache-header policy (immutable by exact set membership)");
  lines.push(`const _SCRML_IMMUTABLE = new Set(${JSON.stringify([...hashedAssets])});`);
  lines.push("function _scrml_etag(st) {");
  lines.push('  return \'W/"\' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + \'"\';');
  lines.push("}");
  lines.push("function _scrml_cache_headers(relPath, st) {");
  lines.push("  if (_SCRML_IMMUTABLE.has(relPath)) {");
  lines.push('    return { "Cache-Control": "public, max-age=31536000, immutable" };');
  lines.push("  }");
  lines.push('  if (relPath.endsWith(".html")) {');
  lines.push('    return { "Cache-Control": "no-cache" };');
  lines.push("  }");
  lines.push('  return { "Cache-Control": "no-cache", "ETag": _scrml_etag(st), "Last-Modified": new Date(st.mtimeMs).toUTCString() };');
  lines.push("}");
  lines.push("");

  // Server
  lines.push("// Production server");
  lines.push('const PORT = parseInt(process.env.PORT ?? "3000", 10);');
  lines.push("const SERVE_DIR = import.meta.dir;");
  lines.push("");
  if (hasWs) {
    // C18 (§38.6): Bun.serve() returns the server handle; stash it on
    // globalThis so the auto-injected broadcast() helper inside channel-
    // scoped server functions can call _scrml_active_server.publish(topic, msg).
    lines.push("const _scrml_server = Bun.serve({");
  } else {
    lines.push("Bun.serve({");
  }
  lines.push("  port: PORT,");
  // S221 (g-dev-server-idletimeout-default-10s, flogence S15 Finding B): same 10s→120s
  // raise for the emitted production server — a legitimate >10s server route must not be
  // truncated by Bun's default idleTimeout. ss33 item 3: the baked value is the build's
  // `--idle-timeout` (default 120, so this line is byte-unchanged when the flag is unset).
  lines.push(`  idleTimeout: ${idleTimeout},`);
  lines.push("  async fetch(req, server) {");
  lines.push("    const url = new URL(req.url);");
  lines.push("");
  lines.push("    // Match server routes");
  lines.push("    for (const route of routes) {");
  lines.push("      if (url.pathname === route.path && req.method === route.method) {");
  if (hasWs) {
    lines.push("        // WebSocket upgrade routes call server.upgrade() — they need the server ref");
    lines.push("        if (route.isWebSocket) return route.handler(req, server);");
    lines.push("        return route.handler(req);");
  } else {
    lines.push("        return route.handler(req);");
  }
  lines.push("      }");
  lines.push("    }");
  lines.push("");
  lines.push("    // Static file serving");
  lines.push('    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;');
  lines.push("    const candidates = [");
  lines.push("      join(SERVE_DIR, pathname),");
  lines.push("      join(SERVE_DIR, `${pathname}.html`),");
  lines.push("    ];");
  lines.push("");
  lines.push("    for (const candidate of candidates) {");
  lines.push("      try {");
  lines.push("        const st = statSync(candidate);");
  lines.push("        if (st.isFile()) {");
  lines.push("          // adopter-#82 — cache policy: content-hashed artifacts (by exact");
  lines.push("          // set membership) are immutable; the HTML entry is no-cache; other");
  lines.push("          // static assets revalidate via ETag / Last-Modified → 304.");
  lines.push('          const rel = relative(SERVE_DIR, candidate).split(/[\\\\/]/).join("/");');
  lines.push("          const headers = _scrml_cache_headers(rel, st);");
  lines.push('          const inm = req.headers.get("if-none-match");');
  lines.push("          if (headers.ETag && inm) {");
  lines.push("            // INM present ⇒ authoritative; a mismatch means CHANGED — do NOT");
  lines.push("            // consult If-Modified-Since (RFC 7232 §6 precedence).");
  lines.push("            if (inm === headers.ETag) return new Response(null, { status: 304, headers });");
  lines.push("          } else if (headers.ETag) {");
  lines.push('            const ims = req.headers.get("if-modified-since");');
  lines.push("            const since = ims ? Date.parse(ims) : NaN;");
  lines.push("            if (!Number.isNaN(since) && Math.floor(st.mtimeMs / 1000) * 1000 <= since) {");
  lines.push("              return new Response(null, { status: 304, headers });");
  lines.push("            }");
  lines.push("          }");
  lines.push("          return new Response(Bun.file(candidate), { headers });");
  lines.push("        }");
  lines.push("      } catch {}");
  lines.push("    }");
  lines.push("");
  lines.push('    return new Response("Not found", { status: 404 });');
  lines.push("  },");

  if (hasWs) {
    lines.push("  websocket: _scrml_ws_merged,");
  }

  lines.push("});");
  if (hasWs) {
    // C18 (§38.6): expose Bun.serve() handle for broadcast() in HTTP-routed
    // channel-scoped server functions.
    lines.push("globalThis._scrml_active_server = _scrml_server;");
  }
  lines.push("");
  lines.push("console.log(`scrml server listening on http://localhost:${PORT}`);");

  // MCP V0 Sub-unit D — boot block + lifecycle wiring.
  //
  // The boot lives AFTER Bun.serve() so the MCP stdio readiness line never
  // races with the HTTP "listening" log line. The boot is async (the SDK
  // and zod are dynamic imports inside startMcpServer) — we kick it off
  // without awaiting because:
  //   1. Bun.serve() is already accepting requests (the server stays alive
  //      independent of MCP boot success/failure).
  //   2. STDIO discipline (SCOPING Risk 4) — the MCP transport owns stdout
  //      from server.connect() onward. Awaiting would block the main entry
  //      and any startup logging in between would corrupt JSON-RPC framing.
  // The runtime read helpers (_scrml_reactive_get / _scrml_derived_get) are
  // module-scoped in each generated .server.js — for V0 we pass undefined
  // and the shim's tool resolvers gracefully degrade (the descriptor
  // sidecars carry the topology data; runtime cell reads are best-effort).
  // Future wave: have each .server.js stash its helpers on globalThis so
  // the boot can read globalThis._scrml_reactive_get.
  if (mcpActivated) {
    lines.push("");
    lines.push("// ----- MCP V0 Sub-unit D boot -----");
    lines.push("// Compiler-generated by <program mcp> opt-in; mode: " + mcpMode + ".");
    if (mcpMode === "dev-only") {
      // Runtime gate: skip boot when NODE_ENV === "production".
      lines.push('const _scrml_mcp_boot_enabled = process.env.NODE_ENV !== "production";');
      lines.push("if (_scrml_mcp_boot_enabled) {");
      lines.push("  // mode='dev-only' default: skip boot in production-NODE_ENV.");
    } else {
      // mode === "always" — unconditional boot.
      lines.push("{");
      lines.push("  // mode='always': boot regardless of NODE_ENV.");
    }
    lines.push('  const _scrml_mcp_watch = process.env.SCRML_MCP_WATCH === "1";');
    lines.push("  startMcpServer({");
    lines.push("    reactiveGet: globalThis._scrml_reactive_get,");
    lines.push("    derivedGet: globalThis._scrml_derived_get,");
    lines.push("    outputDir: SERVE_DIR,");
    lines.push("    watch: _scrml_mcp_watch,");
    lines.push("  }).then((handle) => {");
    lines.push("    globalThis._scrml_mcp_handle = handle;");
    lines.push("    // SCOPING Risk 2 — wire SIGINT/SIGTERM to clean transport teardown.");
    lines.push('    const _shutdown = () => { try { shutdownMcpServer(handle); } catch (_e) { /* ignore */ } };');
    lines.push('    process.once("SIGINT", _shutdown);');
    lines.push('    process.once("SIGTERM", _shutdown);');
    lines.push("  }).catch((err) => {");
    lines.push('    // Diagnostics → stderr per SCOPING Risk 4 STDIO discipline.');
    lines.push('    try { process.stderr.write("[scrml:mcp] startMcpServer failed: " + (err && err.message || err) + "\\n"); } catch (_e) {}');
    lines.push("  });");
    lines.push("}");
  }

  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Deployment adapters
// ---------------------------------------------------------------------------

/**
 * Derive an app name from the input directory basename.
 * Lowercase, spaces/underscores replaced with hyphens.
 *
 * @param {string} inputDir
 * @returns {string}
 */
function deriveAppName(inputDir) {
  return basename(inputDir)
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    || "scrml-app";
}

/**
 * Generate Dockerfile content (shared by fly and docker targets).
 *
 * @returns {string}
 */
export function generateDockerfile() {
  return [
    "FROM oven/bun:1.2",
    "WORKDIR /app",
    "COPY . .",
    "EXPOSE ${PORT:-3000}",
    'CMD ["bun", "_server.js"]',
    "",
  ].join("\n");
}

/**
 * Apply the --target fly adapter.
 * Writes Dockerfile and fly.toml to the output directory.
 *
 * @param {string} outputDir
 * @param {string} appName
 */
export function applyFlyAdapter(outputDir, appName) {
  writeFileSync(join(outputDir, "Dockerfile"), generateDockerfile());

  const flyToml = [
    `app = "${appName}"`,
    'primary_region = "iad"',
    "",
    "[http_service]",
    "  internal_port = 3000",
    "  force_https = true",
    "",
    "[checks]",
    "  [checks.health]",
    "    port = 3000",
    '    type = "http"',
    "    interval = 10000",
    "    timeout = 2000",
    '    path = "/_scrml/health"',
    "",
  ].join("\n");

  writeFileSync(join(outputDir, "fly.toml"), flyToml);
}

/**
 * Apply the --target railway adapter.
 * Ensures package.json in the output directory has scripts.start = "bun _server.js".
 *
 * @param {string} outputDir
 */
export function applyRailwayAdapter(outputDir) {
  const pkgPath = join(outputDir, "package.json");
  let pkg = {};

  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {};
    }
  }

  if (!pkg.scripts) {
    pkg.scripts = {};
  }

  if (!pkg.scripts.start) {
    pkg.scripts.start = "bun _server.js";
  }

  if (!pkg.name) {
    pkg.name = "scrml-app";
  }

  if (!pkg.version) {
    pkg.version = "1.0.0";
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/**
 * Apply the --target render adapter.
 * Writes render.yaml to the output directory.
 *
 * @param {string} outputDir
 */
export function applyRenderAdapter(outputDir) {
  const renderYaml = [
    "services:",
    "  - type: web",
    "    name: scrml-app",
    "    runtime: bun",
    '    buildCommand: ""',
    "    startCommand: bun _server.js",
    "    healthCheckPath: /_scrml/health",
    "",
  ].join("\n");

  writeFileSync(join(outputDir, "render.yaml"), renderYaml);
}

/**
 * Apply the --target docker adapter.
 * Writes Dockerfile only (no platform-specific config).
 *
 * @param {string} outputDir
 */
export function applyDockerAdapter(outputDir) {
  writeFileSync(join(outputDir, "Dockerfile"), generateDockerfile());
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Entry point for the build subcommand.
 *
 * @param {string[]} args — raw argv slice after "build"
 */
export async function runBuild(args) {
  const opts = parseArgs(args);

  if (!opts.inputDir) {
    console.error("Usage: scrml build <directory> [options]");
    console.error("Run `scrml build --help` for details.");
    process.exit(1);
  }

  const inputFiles = scanDirectory(opts.inputDir);

  if (inputFiles.length === 0) {
    console.error(`No .scrml files found in: ${opts.inputDir}`);
    process.exit(1);
  }

  // Determine output directory
  const outputDir = opts.outputDir
    ? resolve(opts.outputDir)
    : join(opts.inputDir, "dist");

  const targetLabel = opts.target ? ` [--target ${opts.target}]` : "";
  console.log(`scrml build — compiling ${inputFiles.length} file(s)...${targetLabel}`);

  // ESM chunks arc — operational heads-up when --module-format=esm is selected
  // (esm now runs in a browser as of Unit 3, but is experimental/opt-in; classic
  // is the only conformance-tested path). Empty for classic. NOT a §34 diagnostic.
  for (const line of moduleFormatNotices(opts.moduleFormat, opts.embedRuntime)) {
    console.error(line);
  }

  const result = compileScrml({
    inputFiles,
    outputDir,
    verbose: opts.verbose,
    embedRuntime: opts.embedRuntime,
    write: true,
    // adopter-#82 — the deploy path content-addresses page bundles + CSS
    // (`<base>.client.<hash>.js` / `<base>.<hash>.css`) so a redeploy that
    // changes bundle bytes changes the URL; the generated `_server.js` serves
    // those hashed assets `immutable` and the HTML entry `no-cache`.
    contentHashAssets: true,
    log: console.log,
    // S142 — `--validate-emit` / `--no-validate-emit`. undefined = compileScrml
    // default; the emitted-JS parse gate (E-CODEGEN-INVALID-LOGIC) is especially
    // valuable for `build` (catches malformed output before deploy).
    validateEmit: opts.validateEmit,
    // ESM chunks arc (Unit 1) — `--module-format=classic|esm`. Default
    // `classic` keeps the shared runtime byte-identical to pre-arc output.
    moduleFormat: opts.moduleFormat,
  });

  if (result.errors.length > 0) {
    console.error(`\nBuild failed with ${result.errors.length} error(s):`);
    for (const e of result.errors) {
      // Bug 3 fix (S107) — same shape as dev.js error formatter; surface path:line:col.
      const rel = e.filePath || e.span?.file || "";
      const line = e.line ?? e.span?.line;
      const col = e.column ?? e.col ?? e.span?.col;
      const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
      console.error(`  [${e.stage}] ${rel}${loc} ${e.code}: ${e.message?.slice(0, 120)}`);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      // Bug 3 fix (S107) — warnings also get path:line:col.
      const rel = w.filePath || w.span?.file || "";
      const line = w.line ?? w.span?.line;
      const col = w.column ?? w.col ?? w.span?.col;
      const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
      console.warn(`  [warn] ${rel}${loc} ${w.code}: ${w.message?.slice(0, 120)}`);
    }
  }

  console.log(`Compiled ${inputFiles.length} file(s) in ${result.durationMs}ms`);

  // Discover server route modules in the output directory.
  // discoverServerRoutes separates regular routes from _scrml_ws_handlers.
  const serverModules = discoverServerRoutes(result.outputDir || outputDir);
  const totalRoutes = serverModules.reduce((n, m) => n + (m.routeNames ?? []).length, 0);
  const totalWsChannels = serverModules.reduce((n, m) => n + (m.wsHandlerNames ?? []).length, 0);
  const resolvedOutputDir = result.outputDir || outputDir;

  // For static target: skip server entry generation, emit warning if server functions exist
  if (opts.target === "static") {
    if (totalRoutes > 0) {
      console.warn(
        `W-DEPLOY-001: ${totalRoutes} server function(s) found but target is "static". ` +
        `Server functions will not be available in production.`
      );
    }

    console.log(`\nscrml build complete.`);
    console.log(`Output: ${result.fileCount} files → ${resolvedOutputDir}/`);
    console.log(`Target: static`);
    console.log(`\nStatic build ready. Deploy the contents of ${resolvedOutputDir}/ to any static host.`);
    return;
  }

  // Generate and write _server.js (all non-static targets).
  // MCP V0 Sub-unit D — when compileScrml auto-activated MCP (because the
  // adopter set <program mcp>), thread the activation surface into the
  // server-entry generator so the boot import + lifecycle wiring lands.
  const mcpOpts = result.mcpAutoActivated
    ? { activated: true, mode: result.mcpMode || "dev-only" }
    : null;
  // adopter-#82 FIX 1 — thread the exact content-addressed artifact set so the
  // emitted server serves `immutable` by membership, not by filename shape.
  const serverEntry = generateServerEntry(serverModules, mcpOpts, opts.idleTimeout, result.hashedAssets || []);
  const serverEntryPath = join(resolvedOutputDir, "_server.js");
  writeFileSync(serverEntryPath, serverEntry);
  if (mcpOpts) {
    console.log(
      `MCP V0: <program mcp> opt-in detected (mode: ${mcpOpts.mode}); ` +
        `boot wired into ${serverEntryPath}.`
    );
  }

  // Apply deployment adapter
  const appName = deriveAppName(opts.inputDir);

  if (opts.target === "fly") {
    applyFlyAdapter(resolvedOutputDir, appName);
  } else if (opts.target === "railway") {
    applyRailwayAdapter(resolvedOutputDir);
  } else if (opts.target === "render") {
    applyRenderAdapter(resolvedOutputDir);
  } else if (opts.target === "docker") {
    applyDockerAdapter(resolvedOutputDir);
  }

  // Summary
  console.log(`\nscrml build complete.`);
  console.log(`Output: ${result.fileCount} files → ${resolvedOutputDir}/`);
  console.log(`Routes: ${totalRoutes} server route(s) wired`);
  if (totalWsChannels > 0) {
    console.log(`WebSocket channels: ${totalWsChannels} channel(s) wired`);
  }
  console.log(`Server: ${serverEntryPath}`);

  if (opts.target === "fly") {
    console.log(`\nFly.io deploy artifacts:`);
    console.log(`  ${join(resolvedOutputDir, "Dockerfile")}`);
    console.log(`  ${join(resolvedOutputDir, "fly.toml")}`);
    console.log(`\nReady to deploy:`);
    console.log(`  fly launch --copy-config`);
  } else if (opts.target === "railway") {
    console.log(`\nRailway deploy artifact:`);
    console.log(`  ${join(resolvedOutputDir, "package.json")} (scripts.start set)`);
    console.log(`\nReady to deploy:`);
    console.log(`  railway up`);
  } else if (opts.target === "render") {
    console.log(`\nRender deploy artifact:`);
    console.log(`  ${join(resolvedOutputDir, "render.yaml")}`);
    console.log(`\nReady to deploy:`);
    console.log(`  Push to your connected GitHub repo — Render auto-deploys on push.`);
  } else if (opts.target === "docker") {
    console.log(`\nDocker artifact:`);
    console.log(`  ${join(resolvedOutputDir, "Dockerfile")}`);
    console.log(`\nReady to build:`);
    console.log(`  docker build -t ${appName} ${resolvedOutputDir}/`);
    console.log(`  docker run -p 3000:3000 ${appName}`);
  } else {
    console.log(`\nReady to deploy:`);
    console.log(`  bun ${serverEntryPath}`);
  }
}
