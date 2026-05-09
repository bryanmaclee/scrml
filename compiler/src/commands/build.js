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
  --embed-runtime           Embed runtime inline instead of writing a separate file
  --minify                  Accepted flag (minification is a Phase 2 feature)
  --verbose, -v             Per-stage timing and counts
  --target <platform>       Deploy adapter: fly|railway|render|static|docker
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
 * @returns {{ inputDir: string|null, outputDir: string|null, embedRuntime: boolean, minify: boolean, verbose: boolean, target: string|null }}
 */
export function parseArgs(args) {
  let inputDir = null;
  let outputDir = null;
  let embedRuntime = false;
  let minify = false;
  let verbose = false;
  let target = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg === "-o") {
      outputDir = args[++i];
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

  return { inputDir, outputDir, embedRuntime, minify, verbose, target };
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
    const exportRe = /export\s+const\s+(_scrml_\w+)\s*=/g;
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
 * @param {Array<{ filename: string, routeNames: string[], wsHandlerNames: string[] }>} serverModules
 *   Each entry is one *.server.js file. routeNames are HTTP route exports (added to the
 *   routes array). wsHandlerNames are _scrml_ws_handlers exports (passed to websocket:).
 * @returns {string}
 */
export function generateServerEntry(serverModules) {
  const lines = [];

  // Determine if any module exports _scrml_ws_handlers (WebSocket channels present)
  const wsModules = serverModules.filter(m => (m.wsHandlerNames ?? []).length > 0);
  const hasWs = wsModules.length > 0;

  lines.push("// scrml production server — compiler-generated");
  lines.push("// DO NOT EDIT. Regenerate with: scrml build");
  lines.push("");
  lines.push('import { statSync } from "fs";');
  lines.push('import { join } from "path";');
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
  lines.push("        if (statSync(candidate).isFile()) {");
  lines.push("          return new Response(Bun.file(candidate));");
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

  const result = compileScrml({
    inputFiles,
    outputDir,
    verbose: opts.verbose,
    embedRuntime: opts.embedRuntime,
    write: true,
    log: console.log,
  });

  if (result.errors.length > 0) {
    console.error(`\nBuild failed with ${result.errors.length} error(s):`);
    for (const e of result.errors) {
      console.error(`  [${e.stage}] ${e.code}: ${e.message?.slice(0, 120)}`);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.warn(`  [warn] ${w.code}: ${w.message?.slice(0, 120)}`);
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

  // Generate and write _server.js (all non-static targets)
  const serverEntry = generateServerEntry(serverModules);
  const serverEntryPath = join(resolvedOutputDir, "_server.js");
  writeFileSync(serverEntryPath, serverEntry);

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
