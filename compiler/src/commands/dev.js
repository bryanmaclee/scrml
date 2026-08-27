/**
 * @module commands/dev
 * scrml dev subcommand.
 *
 * Compile + watch + serve, default port 3000.
 *
 * ARCHITECTURE (issue #724). The parent process compiles and watches; the actual
 * app runs in a CHILD process (`runDevChildServer`) behind a STABLE reverse proxy
 * the parent owns. On every successful recompile the parent respawns the child.
 * The reason is Bun's module cache: within one process Bun never re-evaluates a
 * recompiled `*.server.js` (a `?t=` query on a `file://` URL is ignored), so an
 * in-process reload served the STALE handler; copying the bundle to a fresh path
 * defeats the cache but relocates the `import.meta.dir`-anchored session store. A
 * fresh child process re-evaluates the whole server graph AND keeps
 * `import.meta.dir` at the real output dir, so state beside the bundle survives.
 *
 * Server function routes / WebSocket channels: inside the child, after each
 * compilation pass, `*.server.js` files are scanned and imported — exports shaped
 * `{ path, method, handler }` become live routes; `_scrml_ws_handlers` exports are
 * merged into the Bun.serve() `websocket:` option (see `loadServerRoutes`). The
 * parent reverse-proxies HTTP and WebSocket upgrades to the child, and serves the
 * dev-infra endpoints (`/_scrml/live-reload` SSE, the hot-reload client) itself so
 * the reload stream is stable across child respawns.
 */

import { statSync, readdirSync, watch, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname, join, basename, relative } from "path";
import { compileScrml, scanDirectory, findOutputFiles, toPosixSpecifier } from "../api.js";
import { moduleFormatNotices } from "./module-format-notice.js";
import { stripRedundantCode } from "./diagnostic-format.js";
import { selectRequestOnion, formatOnionConflict } from "./select-request-onion.js";

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
  --module-format=<fmt>   Client runtime module format: classic (default) or esm
                          (esm emits ES modules + type="module" tags and runs in a
                          browser, but is experimental/opt-in; classic is the only
                          conformance-tested path)
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

  return { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, port, idleTimeout, gather, validateEmit, moduleFormat };
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

// §40.3/§40.8 — THE `handle()` onion, exported by the one compiled module that
// declares it (`_scrml_mw_pipeline`), rebuilt on every recompile alongside the
// routes.
//
// `handle()` is a literal onion: SPEC §40.3.4 says it "applies to all HTTP
// requests handled by the compiled server — including statically-served assets".
// `scrml dev` is the dispatcher the adopter actually hits while developing, so
// it mounts the same onion the built server does — otherwise a custom-path
// interception would work under `scrml build` and 404 under `scrml dev`.
//
// EXACTLY ONE runs per request. The onion is application-scope (§40.8 makes the
// <program> middleware attributes app-scope and declares the top-level <program>
// once per application, in the entry file), so composing several by module load
// order — which is filename-sorted — would let a RENAME decide which handle()
// wins a contested path, and would run every module's PRE on every other
// module's page. More than one candidate is E-MW-007, surfaced through the same
// compile-failure channel `scrml build` fails on (dev/prod parity).
/** @type {Array<(downstream: Function) => Function>} */
let registeredOnions = [];

// §52.13 — served documents whose scope is `auth="required"`, mapping the
// SERVE_DIR-relative .html path (LOWERCASED — see build.js for the case-insensitive
// rationale) to its module's auth guard. Gated in the dev static-serving path so
// `scrml dev` matches the production `_server.js`
// (g-auth-required-does-not-protect-the-served-html-document).
/** @type {Map<string, (req: Request) => (Response | null)>} */
let registeredProtectedDocs = new Map();

/**
 * Test/introspection accessor for the currently mounted §40.3 onion. Still an
 * ARRAY (of length 0 or 1) so a caller can ask "is one mounted?" without a
 * null check; the one-per-server invariant is enforced in `loadServerRoutes`.
 */
export function getRegisteredOnions() {
  return registeredOnions;
}

/**
 * Test/introspection accessor for the currently registered routes. Returns the
 * LIVE array `loadServerRoutes` populates and the fetch handler dispatches over.
 */
export function getRegisteredRoutes() {
  return registeredRoutes;
}

/**
 * §40.3 — run `downstream` (the remainder of the dev dispatch: route match →
 * static file → 404) through every mounted `handle()` onion. Returns
 * `downstream(req)` unchanged when the program defines no `handle()` and no
 * `<program>` middleware attribute, so a non-middleware dev session behaves
 * exactly as it did pre-§40.3.
 *
 * Exported for the dev-server unit tests.
 *
 * @param {Request} req
 * @param {(request: Request) => Promise<Response>} downstream
 * @returns {Promise<Response>}
 */
export function runThroughOnions(req, downstream) {
  if (registeredOnions.length === 0) return downstream(req);
  // §40.8 — one application, one onion. `loadServerRoutes` never mounts more
  // than one, so this is a single wrap, not a fold.
  return registeredOnions[0](downstream)(req);
}

// ---------------------------------------------------------------------------
// Compile-failure state (adopter-#517)
//
// When a recompile fails, `scrml dev` used to leave the last-good IN-MEMORY
// routes registered (never reloaded on failure) while a PARTIAL bundle was
// written to disk — so a route call ran either a partial handler (helper
// dropped → `X is not defined`) or a silently-stale last-good handler. Either
// way the adopter saw a MISLEADING runtime error instead of the real compile
// error. We now record the last compile's diagnostics and, while it is
// failing, short-circuit every non-infra request in the fetch handler to serve
// the REAL compile error at the request (issue #517 ask (b)). The last-good
// output on disk is never served while broken, so the partial write is inert.
//
// `null` means the last compile succeeded (normal serving). A non-null value
// carries the fatal errors (and warnings) to render at the request.
/** @type {{ errors: object[], warnings: object[] } | null} */
let compileFailure = null;

/**
 * Record the outcome of a compilation pass. `errors` non-empty ⇒ the build is
 * failing and the fetch handler serves the compile error at every request;
 * empty ⇒ clear the failure state and resume normal serving.
 *
 * Exported so the unit tests can drive the fetch handler through both states
 * without starting a real compile.
 *
 * @param {{ errors?: object[], warnings?: object[] }} result
 */
export function noteCompileResult(result) {
  const errors = (result && result.errors) || [];
  compileFailure = errors.length > 0
    ? { errors, warnings: (result && result.warnings) || [] }
    : null;
}

/** Test/introspection accessor for the current compile-failure state. */
export function getCompileFailure() {
  return compileFailure;
}

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
 * §40.3 handle() onion shape (as emitted by emit-server.ts):
 *   export const _scrml_mw_pipeline = _scrml_mw_wrap   // wrap(downstream) -> handler
 *
 * FRESHNESS (issue #724): Bun caches ES modules by resolved path and never
 * re-evaluates a recompiled `*.server.js` in the same process — a `?t=` query on a
 * `file://` URL is ignored, and copying the bundle to a fresh path relocates the
 * `import.meta.dir`-anchored session store. The dev server therefore loads routes
 * in a CHILD process (`runDevChildServer`) that is respawned on every recompile;
 * this function runs ONCE per process, so a plain import is always fresh here.
 *
 * Exported so the unit tests can mount a REAL compiled module's exports without
 * starting a dev server (same reason as `noteCompileResult`).
 *
 * @param {string} outputDir
 * @returns {Promise<void>}
 */
export async function loadServerRoutes(outputDir) {
  registeredRoutes = [];
  registeredWsHandlers = null;
  registeredOnions = [];
  registeredProtectedDocs = new Map();

  // F-COMPILE-001 Option A: outputDir may be a tree when sources have nested
  // subdirectories. Walk recursively for *.server.js entries.
  const serverFiles = findOutputFiles(outputDir, ".server.js");
  if (serverFiles.length === 0) return;

  const allWsHandlers = [];
  // §40.3/§40.8 — every module that hosts a request onion, with the `.scrml`
  // source that DECLARES it (emit-server stamps `_scrml_mw_declared_in`). One is
  // mounted; more than one is E-MW-007, reported against every competing source.
  const onionCandidates = [];

  for (const { absPath, relPath } of serverFiles) {
    // First (and only) import of this path in this process — always fresh.
    let mod;
    try {
      mod = await import(`file://${absPath}`);
    } catch (err) {
      console.error(`[dev] Failed to import ${relPath}: ${err.message}`);
      continue;
    }

    for (const exportName of Object.keys(mod)) {
      const value = mod[exportName];

      // §40.3 — the handle() onion mount point. A FUNCTION, so it would fall
      // through the object-shape guard below and never be seen; collect it first.
      if (exportName === "_scrml_mw_pipeline" && typeof value === "function") {
        onionCandidates.push({
          filename: relPath,
          middlewareNames: [exportName],
          middlewareDeclaredIn: typeof mod._scrml_mw_declared_in === "string"
            ? mod._scrml_mw_declared_in
            : null,
          pipeline: value,
        });
        continue;
      }

      if (!value || typeof value !== "object") continue;

      // WebSocket handlers export — collect separately, NOT as a route.
      // _scrml_ws_handlers has shape { open, message, close }, not { path, method, handler }.
      if (exportName === "_scrml_ws_handlers") {
        allWsHandlers.push(value);
        continue;
      }

      // §52.13 — the served-document auth guard `{ guard }`. Register it against
      // this module's .html (derived from the filename, lowercased) so the dev
      // static path gates the document exactly like the production server.
      if (exportName === "_scrml_protected_document" && typeof value.guard === "function") {
        const htmlRel = relPath.replace(/\\/g, "/").replace(/\.server\.js$/, ".html").toLowerCase();
        registeredProtectedDocs.set(htmlRel, value.guard);
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

  // §40.3/§40.8 — mount THE application onion. `scrml build` fails on a second
  // one; dev surfaces the identical diagnostic through the compile-failure
  // channel (which serves the real error at every request) instead of silently
  // guessing — a dev/prod split here is exactly what the onion work set out to
  // remove.
  {
    const { onion, error } = selectRequestOnion(onionCandidates);
    if (error) {
      const diag = {
        stage: "BUILD",
        filePath: error.sources[0],
        code: error.code,
        message: error.message,
        severity: "error",
      };
      noteCompileResult({ errors: [diag], warnings: [] });
      console.error(`[dev] ${formatOnionConflict(error)}`);
    } else if (onion) {
      registeredOnions = [onion.pipeline];
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
 * Turn an exception thrown OUT of `compileScrml` into one diagnostic in the
 * shape the fetch handler already renders (`formatDiagnostic` /
 * `buildCompileErrorResponse`): `{ stage, code, message, filePath, line, column }`.
 *
 * Two classes, framed differently for the adopter:
 *
 *  - a FILESYSTEM error on a source (`ENOENT` when an entry was deleted or
 *    renamed under the watcher, `EACCES`, `EISDIR`, …; recognisable by the
 *    Node system-error fields `syscall`/`errno`/`path`) — this is the
 *    adopter's tree, not a compiler bug: keep the OS `code` (`ENOENT`) as the
 *    diagnostic code, name the path, and say how to recover;
 *  - ANYTHING ELSE (a TypeError deep in a stage, an escaped CGError, …) — a
 *    COMPILER DEFECT: the compiler is supposed to RETURN diagnostics, never
 *    throw, so say so plainly (the `validate-emit.ts` "This is a compiler
 *    defect … please report it" framing) and carry the top of the stack so
 *    the report is actionable. The code is deliberately un-prefixed
 *    (`INTERNAL-COMPILER-ERROR`, not `E-…`) so it cannot be mistaken for a
 *    §34-registered diagnostic; an escaped error that already carries a
 *    string `code` keeps it.
 *
 * Exported so the gated unit tier can pin the mapping without a live compile.
 *
 * @param {unknown} err  whatever `compileScrml` threw
 * @returns {{ stage: string, code: string, message: string, filePath: string, line?: number, column?: number }}
 */
export function compileThrowDiagnostic(err) {
  const e = (err && typeof err === "object") ? /** @type {any} */ (err) : { message: String(err) };
  const rawMessage = typeof e.message === "string" && e.message ? e.message : String(err);
  const isFsError = typeof e.code === "string"
    && (typeof e.syscall === "string" || typeof e.errno === "number" || typeof e.path === "string");

  if (isFsError) {
    const path = typeof e.path === "string" ? e.path : "";
    return {
      stage: "DEV",
      code: e.code,
      message:
        `${rawMessage}\n` +
        `  A source file could not be read while scrml dev was watching it (deleted, renamed, or unreadable). ` +
        `Restore it — or restart scrml dev with the new path — and this page reloads automatically. ` +
        `scrml dev is not serving a partial/stale bundle.`,
      filePath: path,
      line: undefined,
      column: undefined,
    };
  }

  const stackLines = typeof e.stack === "string" ? e.stack.split("\n") : [];
  // Drop the leading "Name: message" line (already in the message) and keep
  // the top frames — enough to locate the throw, not the whole event loop.
  const frames = stackLines.filter((l) => /^\s+at\s/.test(l)).slice(0, 8);
  const name = typeof e.name === "string" && e.name ? e.name : "Error";
  return {
    stage: "DEV",
    code: typeof e.code === "string" && e.code ? e.code : "INTERNAL-COMPILER-ERROR",
    message:
      `${name}: ${rawMessage}\n` +
      `  This is a compiler defect (the compiler threw instead of reporting a diagnostic). Please report it. ` +
      `scrml dev is not serving a partial/stale bundle.` +
      (frames.length ? `\n${frames.join("\n")}` : ""),
    filePath: e.filePath || e.file || e.span?.file || "",
    line: e.line ?? e.span?.line,
    column: e.column ?? e.col ?? e.span?.col,
  };
}

/**
 * Run a single compilation pass.
 *
 * Contract (S346, g-dev-compile-throw-fail-open): `runOnce` NEVER throws. A
 * throw out of `compileScrml` is a compile FAILURE like any other — it is
 * routed through the SAME `noteCompileResult` / `compileFailure` path #518
 * built for the returns-diagnostics case, so the fetch handler serves the
 * real error at the request. Before this, the throw unwound past
 * `noteCompileResult` into the async debounce callback in `scheduleRecompile`
 * (an unhandled promise rejection that Bun merely logs while cli.js's
 * top-level `await runDev()` is pending), `compileFailure` stayed `null`, and
 * dev kept serving the last-good/partial bundle at HTTP 200 for a tree that no
 * longer compiled — fail-OPEN, the exact class #518 closed, one path over.
 *
 * @param {object} opts
 * @returns {{ success: boolean, outputDir: string }}
 */
function runOnce(opts, gatheredOut) {
  const { inputFiles, outputDir, verbose, convertLegacyCss, embedRuntime, gather, validateEmit, moduleFormat } = opts;

  // ESM chunks arc — operational heads-up when --module-format=esm is selected
  // (esm now runs in a browser as of Unit 3, but is experimental/opt-in; classic
  // is the only conformance-tested path). Empty for classic. NOT a §34 diagnostic.
  for (const line of moduleFormatNotices(moduleFormat, embedRuntime)) {
    console.error(line);
  }

  let result;
  try {
    result = compileScrml({
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
      // ESM chunks arc (Unit 1) — `--module-format=classic|esm`. Default
      // `classic` keeps the shared runtime byte-identical to pre-arc output.
      moduleFormat,
    });
  } catch (err) {
    // Fail CLOSED: a throw is a failed compile. Record it exactly like a
    // returned fatal diagnostic so the fetch handler serves THIS error (not a
    // stale bundle) until the next green pass clears it.
    const diag = compileThrowDiagnostic(err);
    noteCompileResult({ errors: [diag], warnings: [] });
    console.error(`[dev] Compile threw — treating it as a compile failure (the error is served at every request; no stale bundle):`);
    const loc = diag.line ? `:${diag.line}${diag.column ? `:${diag.column}` : ""}` : "";
    console.error(`  [${diag.stage}] ${diag.filePath}${loc} ${diag.code}: ${stripRedundantCode(diag.code, diag.message)}`);
    // Mirror compileScrml's own default (api.js: dist/ next to the first
    // input) so the caller's serve-dir resolution is unchanged on this path.
    const fallbackOut = outputDir || (inputFiles.length > 0 ? join(dirname(inputFiles[0]), "dist") : "");
    return { success: false, outputDir: fallbackOut };
  }

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
      console.error(`  [${d.code}] ${rel}:${d.line}:${d.column} ${stripRedundantCode(d.code, d.message)}`);
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
      console.error(`  ${w.code ? "[" + w.code + "] " : ""}${rel}${loc} ${stripRedundantCode(w.code, w.message)?.slice(0, 120)}`);
    }
  }

  // adopter-#517 — record this pass's outcome so the fetch handler serves the
  // real compile error at the request while the build is failing (and resumes
  // normal serving on success). Set BEFORE the early return below so both the
  // initial compile and every recompile update it.
  noteCompileResult(result);

  if (result.errors.length > 0) {
    console.error(`[dev] Compilation errors: ${result.errors.length}`);
    for (const e of result.errors) {
      // Bug 3 fix (S107) — mirror the [W-LINT-*] formatter shape so adopters
      // with many .scrml files can localize the failing source. CGError-shape
      // diagnostics carry `span.line` / `span.col`; api.js's collectErrors
      // stamps `filePath` (and `span.file`) on per-file stage outputs (BS / TAB)
      // so this formatter can read them. Falls through both shapes — direct
      // `e.line` (used by some later stages) and `e.span.line` (used by BS).
      // #519 — also read the flat `file` field: the emit gate (E-CODEGEN-INVALID-LOGIC)
      // stamps the SOURCE file on `.file` (no `.filePath`, no `.span`), so without this
      // the gate error renders with NO path here — the opposite of #519's intent.
      const rel = e.filePath || e.file || e.span?.file || "";
      const line = e.line ?? e.span?.line;
      const col = e.column ?? e.col ?? e.span?.col;
      const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
      console.error(`  [${e.stage}] ${rel}${loc} ${e.code}: ${stripRedundantCode(e.code, e.message)?.slice(0, 120)}`);
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

// adopter-#82 FIX 1 — `scrml dev` content-hashes ONLY the shared runtime
// (`scrml-runtime.<hash>.js`) and, opt-in, per-route chunks
// (`<seg>/<role>.<tier>.<hash>.js`, tier ∈ initial|tier1|tier2|tierN<n>); it
// never hashes page bundles/CSS. So the dev immutable predicate matches EXACTLY
// those two known forms — no generic `.<hash>.(js|css)` shape guess, which would
// wrongly freeze a dotted-but-unhashed asset like `app.settings.js` (the exact
// silent-stale-asset failure #82 exists to kill).
const _SCRML_DEV_RUNTIME_RE = /(?:^|[\\/])scrml-runtime\.[0-9a-z]{8}\.js$/;
const _SCRML_DEV_CHUNK_RE = /\.(?:initial|tier1|tier2|tierN\d+)\.[0-9a-z]{8}\.js$/;

/**
 * adopter-#82 — cache-header policy for `scrml dev` static responses.
 *
 * The shared runtime + per-route chunks are content-addressed → `immutable`.
 * Every OTHER static asset revalidates via a WEAK validator (ETag = size+mtime,
 * `Last-Modified`) so a conditional request can 304. The HTML entry is handled
 * separately (always `no-cache`). Fixes the #82 report that `scrml dev` sent NO
 * cache headers at all.
 * @param {string} path
 * @param {import("fs").Stats} st
 * @returns {Record<string,string>}
 */
export function devCacheHeaders(path, st) {
  if (_SCRML_DEV_RUNTIME_RE.test(path) || _SCRML_DEV_CHUNK_RE.test(path)) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  const etag = 'W/"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"';
  return {
    "Cache-Control": "no-cache",
    "ETag": etag,
    "Last-Modified": new Date(st.mtimeMs).toUTCString(),
  };
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

/**
 * The URL the hot-reload client is served from. Inside `/_scrml/`, the namespace
 * the dev server already owns (`/_scrml/live-reload`, `/_scrml/log`,
 * `/_scrml/fn/*`), so it cannot collide with an author route.
 */
export const HOT_RELOAD_SRC = "/_scrml/hot-reload.js";

/**
 * The one line the app CHILD process prints to stdout once its server is bound,
 * carrying the ephemeral port it landed on. The parent proxy waits for exactly
 * this line (readiness + port in a single signal); every other child stdout line
 * is forwarded to the parent's terminal verbatim.
 */
export const CHILD_READY_PREFIX = "__SCRML_DEV_CHILD_READY__ ";

// Unique-suffix counter for the per-spawn child config file (avoids a same-ms
// collision between two child spawns in one parent process).
let childCfgSeq = 0;

/**
 * The hot-reload client itself. Served AS A FILE at `HOT_RELOAD_SRC`, not
 * inlined into the page.
 *
 * It used to be an inline `<script>`. Once the §40.3 `handle()` onion was
 * mounted around top-level `scrml dev` dispatch, a `<program headers="strict">`
 * app's own `handle()` began setting `Content-Security-Policy: default-src
 * 'self'` (§39.2.5) on dev's HTML responses too — and a browser refuses an
 * inline script under that policy with no nonce or hash. Hot reload was dead for
 * every strict-headers app in dev: exactly the "compiler-emitted content refused
 * by the compiler-pinned CSP" defect this arc set out to remove.
 *
 * A same-origin `<script src>` satisfies `default-src 'self'` with no nonce, no
 * hash, and no CSP widening — the same resolution §38's transition keyframes
 * took (inline `<style>` injection → an emitted stylesheet).
 */
const HOT_RELOAD_JS = `// scrml dev — hot reload client (served at ${HOT_RELOAD_SRC}).
(function () {
  var RELOAD_URL = "/_scrml/live-reload";
  var RETRY_MS = 2000;
  var es = new EventSource(RELOAD_URL);

  es.addEventListener("reload", function () {
    location.reload();
  });

  // The dev server restarts on a port change and drops the stream; reconnect so
  // the page is not stranded without hot reload.
  es.onerror = function () {
    es.close();
    setTimeout(function () {
      es = new EventSource(RELOAD_URL);
    }, RETRY_MS);
  };
})();
`;

const HOT_RELOAD_SCRIPT = `<script src="${HOT_RELOAD_SRC}"></script>`;

/**
 * The `Response` for `HOT_RELOAD_SRC`. Served BEFORE the compile-failure
 * short-circuit and before the `handle()` onion — it is the dev server, not the
 * compiled one, and the compile-error overlay carries the same tag so the page
 * auto-refreshes the moment the compile succeeds again.
 * @returns {Response}
 */
export function createHotReloadScriptResponse() {
  return new Response(HOT_RELOAD_JS, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Inject the hot-reload `<script src>` tag into HTML before </body> or at end.
 * @param {string} html
 * @returns {string}
 */
export function injectHotReloadScript(html) {
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) return html.slice(0, idx) + HOT_RELOAD_SCRIPT + html.slice(idx);
  return html + HOT_RELOAD_SCRIPT;
}

/**
 * Format one compile diagnostic the way the terminal formatter does
 * (dev.js runOnce): `[STAGE] file:line:col CODE: message`. Reads the two
 * diagnostic shapes api.js emits — a flat `{filePath,line,column}` and a
 * BS-stage `{span:{file,line,col}}`.
 *
 * @param {object} e
 * @returns {{ stage: string, code: string, message: string, file: string, line: number|undefined, column: number|undefined, text: string }}
 */
function formatDiagnostic(e) {
  const file = e.filePath || e.file || e.span?.file || "";
  const line = e.line ?? e.span?.line;
  const col = e.column ?? e.col ?? e.span?.col;
  const loc = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const stage = e.stage || "CG";
  const code = e.code || "";
  const message = e.message || "";
  return {
    stage, code, message, file, line, column: col,
    text: `[${stage}] ${file}${loc} ${code}${code ? ":" : ""} ${message}`.replace(/\s+/g, " ").trim(),
  };
}

/**
 * adopter-#517 — build the response served at EVERY non-infra request while
 * the last compile is failing, so the adopter sees the REAL compile error at
 * the request instead of a misleading `X is not defined` from a partial or
 * stale bundle.
 *
 * Page navigations (Accept: text/html) get a self-contained HTML overlay that
 * lists the diagnostics and carries the hot-reload script, so it auto-refreshes
 * into the working app the moment the compile succeeds again. Everything else
 * (server-fn route calls, fetch/XHR) gets a JSON body carrying the structured
 * diagnostics. Both respond 500 — the project does not currently compile.
 *
 * @param {Request} req
 * @param {{ errors: object[], warnings: object[] }} failure
 * @returns {Response}
 */
export function buildCompileErrorResponse(req, failure) {
  const diags = (failure.errors || []).map(formatDiagnostic);
  const accept = (req.headers && req.headers.get && req.headers.get("accept")) || "";
  const wantsHtml = accept.includes("text/html");

  if (wantsHtml) {
    const rows = diags.map((d) => {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const locBits = [d.file, d.line ? `:${d.line}` : "", d.column ? `:${d.column}` : ""].join("");
      return `<li><span class="code">${esc(d.code)}</span> <span class="loc">${esc(locBits)}</span><div class="msg">${esc(d.message)}</div></li>`;
    }).join("");
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>scrml — compile failing</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 2rem; background: #1e1e1e; color: #eee; }
  h1 { font-size: 1rem; color: #ff6b6b; margin: 0 0 1rem; }
  p.hint { color: #aaa; margin: 0 0 1.5rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { background: #2a2a2a; border-left: 3px solid #ff6b6b; padding: .75rem 1rem; margin: 0 0 .75rem; border-radius: 0 4px 4px 0; }
  .code { color: #ffb86c; font-weight: 600; }
  .loc { color: #8be9fd; }
  .msg { margin-top: .35rem; white-space: pre-wrap; }
</style></head><body>
<h1>scrml compile failed — ${diags.length} error${diags.length !== 1 ? "s" : ""}</h1>
<p class="hint">The last edit did not compile. This page is served in place of the app so a partial or stale bundle can't mask the real error. Fix the error below and the page reloads automatically.</p>
<ul>${rows}</ul>
</body></html>`;
    return new Response(injectHotReloadScript(body), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  return new Response(
    JSON.stringify({
      error: "scrml compile failed",
      detail: "The last compile did not succeed; scrml dev is not serving a partial/stale bundle. See errors.",
      errors: diags.map((d) => ({ stage: d.stage, code: d.code, message: d.message, file: d.file, line: d.line, column: d.column })),
    }, null, 2),
    { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } },
  );
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
  // Cross-OS invariant: the watch set is POSIX-canonical (`/`). Callers pass
  // already-absolute paths (CLI-resolved inputs + scanDirectory-gathered files),
  // so we normalize separators rather than re-root via resolve() — resolve()
  // would inject the current drive on Windows (`/proj/x` → `C:\proj\x`), which
  // both mangles the path and defeats dedup against the un-rooted form.
  const set = new Set();
  for (const f of opts.inputFiles || []) {
    if (typeof f === "string" && f.endsWith(".scrml")) set.add(toPosixSpecifier(f));
  }
  for (const f of gatheredFiles || []) {
    if (typeof f === "string" && f.endsWith(".scrml")) set.add(toPosixSpecifier(f));
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
 * §40.3 — the remainder of the `scrml dev` request pipeline: registered-route
 * match → static file → 404. This is exactly what `resolve(request)` runs
 * inside an author's `handle()`.
 *
 * Split out of the `fetch` closure so the onion can wrap it (see
 * `runThroughOnions`). Exported for the dev-server unit tests.
 *
 * @param {Request} req
 * @param {object} server        Bun server handle (WS upgrade routes need it)
 * @param {string} serveDir      dist directory served as static files
 * @param {object} opts          dev options (entry-candidate resolution)
 * @returns {Promise<Response>}
 */
export async function devDispatch(req, server, serveDir, opts) {
  const url = new URL(req.url);
  const pathname = url.pathname;

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
      const st = statSync(candidate);
      if (st.isFile()) {
        // §52.13 — gate an auth-required document BEFORE serving it, so `scrml dev`
        // matches the production `_server.js`: an unauthenticated request redirects
        // to loginRedirect instead of leaking the rendered markup
        // (g-auth-required-does-not-protect-the-served-html-document).
        if (registeredProtectedDocs.size > 0) {
          const _rel = relative(serveDir, candidate).split(/[\\/]/).join("/").toLowerCase();
          const _guard = registeredProtectedDocs.get(_rel);
          if (_guard) {
            const _gate = _guard(req);
            if (_gate) return _gate;
          }
        }
        // Inject hot-reload script into HTML responses
        if (candidate.endsWith(".html")) {
          const html = await file.text();
          return new Response(injectHotReloadScript(html), {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
          });
        }
        // adopter-#82 — attach cache headers to static assets + honor
        // conditional requests. FIX 3 (RFC 7232 §6): If-None-Match, when
        // present, is authoritative — a mismatch means CHANGED, so we do NOT
        // fall through to If-Modified-Since (which could 304 a same-second
        // stale edit). Evaluate IMS only when INM is absent.
        const headers = devCacheHeaders(candidate, st);
        const inm = req.headers.get("if-none-match");
        if (headers.ETag && inm) {
          if (inm === headers.ETag) return new Response(null, { status: 304, headers });
        } else if (headers.ETag) {
          const ims = req.headers.get("if-modified-since");
          const since = ims ? Date.parse(ims) : NaN;
          if (!Number.isNaN(since) && Math.floor(st.mtimeMs / 1000) * 1000 <= since) {
            return new Response(null, { status: 304, headers });
          }
        }
        return new Response(file, { headers });
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
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
          });
        }
      } catch { /* entry not emitted yet — fall through to scan */ }
    }

    // Fallback: serve the first .html file found — handles directory /
    // multi-input dev mode where there is no single unambiguous entry,
    // and the common single-file case when the entry candidate is absent.
    try {
      // Sort so the "first .html" is deterministic across OS / filesystem
      // readdir order (g-residual-order-bearing-readdir): two machines must
      // pick the SAME fallback entry, not whatever the FS returns first.
      const entries = readdirSync(serveDir).sort();
      const htmlFile = entries.find(e => e.endsWith(".html"));
      if (htmlFile) {
        const fallbackPath = join(serveDir, htmlFile);
        const file = Bun.file(fallbackPath);
        const html = await file.text();
        return new Response(injectHotReloadScript(html), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
        });
      }
    } catch { /* no serve dir yet */ }
  }

  return new Response("Not found", { status: 404 });
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
/**
 * The dev-INFRASTRUCTURE endpoints, served identically by the child's
 * `buildServeConfig` and (under #724) the parent proxy — factored to ONE place so
 * the two can never drift. Returns a Response for a dev-infra path, else null.
 *
 *   /_scrml/live-reload  → the SSE hot-reload stream
 *   HOT_RELOAD_SRC       → the same-origin hot-reload client script (§39.2.5-safe)
 *   POST /_scrml/log     → §20.6 client log() forwarding (fire-and-forget 204)
 *
 * @param {string} pathname
 * @param {Request} req
 * @returns {Promise<Response|null>}
 */
export async function serveDevInfra(pathname, req) {
  if (pathname === "/_scrml/live-reload") return createSseResponse();
  if (pathname === HOT_RELOAD_SRC) return createHotReloadScriptResponse();
  if (pathname === "/_scrml/log" && req.method.toUpperCase() === "POST") {
    try {
      const payload = await req.json();
      const side = (payload && typeof payload.side === "string") ? payload.side : "client";
      const msg = (payload && typeof payload.msg === "string") ? payload.msg : "";
      const loc = (payload && typeof payload.loc === "string") ? payload.loc : "";
      console.log(`[${side}] ${msg}${loc ? ` (${loc})` : ""}`);
    } catch {
      // Malformed payload — ignore (a dev convenience must never 500 a page).
    }
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return null;
}

export function buildServeConfig(opts, serveDir) {
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

      // Dev-infra endpoints (SSE hot-reload, the hot-reload client, client log()
      // forwarding) — shared with the parent proxy via serveDevInfra so the two
      // never drift. Served ahead of the compile-failure short-circuit so the
      // error overlay's script tag resolves while the project does not compile.
      const infra = await serveDevInfra(pathname, req);
      if (infra) return infra;

      // ------------------------------------------------------------------
      // adopter-#517 — compile-failure short-circuit. While the last compile
      // is failing, serve the REAL compile error at every request rather than
      // dispatching to a partial (helper-dropped → `X is not defined`) or
      // silently-stale route handler, or serving a partial static bundle. The
      // two dev-infra endpoints above (`/_scrml/live-reload`, `/_scrml/log`)
      // returned earlier and stay live so the browser can reconnect + reload
      // the instant the compile succeeds again.
      // ------------------------------------------------------------------
      if (compileFailure) {
        return buildCompileErrorResponse(req, compileFailure);
      }

      // ------------------------------------------------------------------
      // §40.3 — everything below this point (route match → static file → 404)
      // is the handle() onion's DOWNSTREAM. `handle()` PRE runs for EVERY app
      // request, so a custom-path interception with no author `route=` works
      // under `scrml dev` exactly as it does under `scrml build`.
      //
      // The dev-infra endpoints above (`/_scrml/live-reload`, `/_scrml/log`,
      // the CORS preflight, the compile-failure short-circuit) returned
      // earlier ON PURPOSE — they are the dev server, not the compiled one,
      // and SPEC §40.3.4 scopes handle() to "the compiled server".
      //
      // WebSocket upgrades are the ONE exclusion: SPEC §40.3.4 says "handle()
      // does NOT apply to WebSocket upgrade requests. WebSocket lifecycle
      // handlers use <channel> (§38)." A successful server.upgrade() signals
      // "do not return a response" by returning undefined, while §40.3.2 types
      // resolve() as returning a Response — routing an upgrade through the onion
      // would manufacture one AFTER the protocol switch. Same as the pre-§40.3
      // behaviour (the `_scrml_route_ws_*` export was never wrapped either).
      // ------------------------------------------------------------------
      for (const route of registeredRoutes) {
        if (
          route.isWebSocket &&
          route.path === pathname &&
          route.method.toUpperCase() === req.method.toUpperCase()
        ) {
          return await route.handler(req, server);
        }
      }

      return runThroughOnions(req, (request) => devDispatch(request, server, serveDir, opts));
    },
  };

  // Add websocket: option when channel handlers are registered (§38)
  if (registeredWsHandlers) {
    config.websocket = registeredWsHandlers;
  }

  return config;
}

/**
 * Parent-death decision for the dev server's orphan guard
 * (g-dev-watcher-tests-leak-server-processes). Returns true when the process
 * that launched this `scrml dev` (its ppid at start, `launchPpid`) is gone, so
 * the server should shut down rather than orphan its fs.watch handles.
 *
 * Two portable signals:
 *   - `process.ppid !== launchPpid` — on Linux a child whose parent dies is
 *     reparented (to init / a subreaper), so ppid changes; a direct, race-free tell.
 *   - `process.kill(launchPpid, 0)` throws when that pid no longer exists — a
 *     zero-signal existence probe that works on Linux AND Windows.
 *
 * @param {number} launchPpid — `process.ppid` captured at server start
 * @returns {boolean}
 */
export function launchingProcessGone(launchPpid) {
  if (process.ppid !== launchPpid) return true;
  try {
    process.kill(launchPpid, 0);
    return false;
  } catch (e) {
    // g-dev-orphan-guard-collapses-on-windows-pid-reuse (S356): only ESRCH ("no
    // such process") means the parent is genuinely gone. EPERM means the process
    // EXISTS but is not signalable from here (different user / integrity level) —
    // treating that as "gone" would FALSE-POSITIVE kill a live-parent dev server.
    // (The PID-reuse under-detection — process.kill succeeding on a recycled pid —
    // is a separate, harder residual tracked on that gap: Windows has no
    // reparent-to-init signal, so there is no cheap backstop here.)
    return e != null && e.code === "ESRCH";
  }
}

/**
 * CHILD-PROCESS app server (issue #724). The parent `scrml dev` compiles and
 * watches; the actual app runs in THIS short-lived child, respawned on every
 * recompile. A fresh process has a fresh module registry, so a recompiled
 * `*.server.js` — and its whole cross-file server graph — is always re-evaluated
 * (Bun never re-imports a changed module within one process), while
 * `import.meta.dir` stays the real output dir so the session store that lives
 * beside the bundle survives across reloads. Binds an EPHEMERAL port and prints
 * `${CHILD_READY_PREFIX}<port>` so the parent learns the port AND that the server
 * is up in one signal. Runs the full `buildServeConfig` dispatch; its own
 * `/_scrml/live-reload` + hot-reload endpoints are simply never reached because
 * the parent proxy serves those from its own stable port.
 *
 * @param {string} serveDir
 * @param {object} opts   parsed dev opts (the port is overridden to 0 here)
 * @returns {Promise<never>}
 */
export async function runDevChildServer(serveDir, opts) {
  await loadServerRoutes(serveDir);
  const server = Bun.serve(buildServeConfig({ ...opts, port: 0 }, serveDir));
  // C18 (§38.6): channel `broadcast()` runs in THIS child; publishing on the
  // child server reaches the parent's upstream proxy socket, which forwards to
  // the browser — so realtime survives the proxy.
  globalThis._scrml_active_server = server;
  console.log(`${CHILD_READY_PREFIX}${server.port}`);

  // Orphan guard — if the parent dev process dies, do not linger holding the port.
  const launchPpid = process.ppid;
  const guard = setInterval(() => {
    if (!launchingProcessGone(launchPpid)) return;
    try { server.stop(true); } catch { /* already stopped */ }
    process.exit(0);
  }, 2000);
  guard.unref?.();
  await new Promise(() => {});
}

/**
 * Spawn a fresh app-child (`runDevChildServer`) and resolve once it reports ready.
 * The child config is handed over via a temp JSON file (robust across however the
 * `scrml` CLI was invoked, unlike reconstructing argv). Child stdout is scanned
 * for the ready marker and otherwise forwarded to this terminal; stderr inherits.
 *
 * @returns {Promise<{ proc: object, port: number }>}
 */
async function spawnAppChild(serveDir, opts) {
  const cfgPath = join(tmpdir(), `scrml-dev-child-${process.pid}-${childCfgSeq++}.json`);
  writeFileSync(cfgPath, JSON.stringify({ serveDir, opts }));

  const proc = Bun.spawn(
    [process.execPath, process.argv[1], "dev", "--__dev-child", cfgPath],
    { stdout: "pipe", stderr: "inherit", stdin: "ignore" },
  );

  let port;
  try {
    port = await new Promise((resolvePort, rejectPort) => {
      const timer = setTimeout(
        () => rejectPort(new Error("app child did not become ready within 15s")),
        15000,
      );
      (async () => {
        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of proc.stdout) {
          buf += decoder.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.startsWith(CHILD_READY_PREFIX)) {
              clearTimeout(timer);
              resolvePort(Number(line.slice(CHILD_READY_PREFIX.length).trim()));
            } else {
              console.log(line); // forward the child's own logs (route registration, etc.)
            }
          }
        }
        // stdout closed before the ready marker → the child died starting up.
        clearTimeout(timer);
        rejectPort(new Error("app child exited before reporting ready"));
      })().catch(rejectPort);
    });
  } catch (err) {
    // Never leak the spawned process on a failed/slow start (the #577 orphan class).
    try { proc.kill(); } catch { /* already gone */ }
    try { rmSync(cfgPath, { force: true }); } catch { /* n/a */ }
    throw err;
  }

  try { rmSync(cfgPath, { force: true }); } catch { /* child already read it */ }
  return { proc, port };
}

/**
 * Reverse-proxy one HTTP request to the app child. Bodies are buffered (dev
 * payloads are small) to sidestep streaming/duplex differences. `redirect:
 * "manual"` relays the child's 3xx verbatim on Bun (verified: Bun returns the
 * real status + Location, not a WHATWG opaque-redirect). The response is rebuilt
 * so a `content-encoding` header can be dropped — `fetch` already DECODED the body,
 * so relaying that header would make the browser double-decode — while a copied
 * Headers preserves multiple `Set-Cookie` values intact (the state #724 protects).
 *
 * @param {URL} url  the already-parsed request URL
 */
async function proxyHttpToChild(req, url, childPort) {
  const target = `http://127.0.0.1:${childPort}${url.pathname}${url.search}`;
  const method = req.method.toUpperCase();
  // Keep the browser's original Host so app code that builds absolute URLs /
  // redirects (or does a Host check) sees the real dev host, not the child's
  // ephemeral 127.0.0.1 port. Bun's fetch honours an explicit Host header.
  const headers = stripHopByHop(new Headers(req.headers));
  const hasBody = method !== "GET" && method !== "HEAD";
  try {
    const resp = await fetch(target, {
      method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });
    const outHeaders = stripHopByHop(new Headers(resp.headers));
    // Bun's fetch transparently DECODES the compressed body (gzip/deflate/br/zstd
    // — verified on Bun 1.4.0), so `resp.body` is already plaintext; relaying the
    // stale `content-encoding` would make the browser double-decode, and the
    // pre-decode `content-length` would truncate it. The scrml child never sets
    // `content-encoding`, so this only ever fires on an adopter's own middleware —
    // strip both and let Bun re-derive the length.
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders });
  } catch (err) {
    return new Response(`[dev] proxy error: ${err.message}`, { status: 502 });
  }
}

/** Drop per-connection hop-by-hop headers a reverse proxy must not forward end-to-end. */
function stripHopByHop(headers) {
  for (const h of ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]) {
    headers.delete(h);
  }
  return headers;
}

/**
 * Open the upstream socket to the app child and pair it with the browser socket
 * (issue #724, §38 channels). Both directions are queued until their socket is
 * ready, so neither end races: the upstream's own `open`/`message`/`close`
 * listeners are attached HERE, synchronously at creation — before Bun later fires
 * the parent `open(ws)` — so an upstream event that arrives first is buffered, not
 * lost. `ws.data` carries the shared pairing state.
 *
 * @param {Request} req
 * @param {object} srv  the Bun server (for `srv.upgrade`)
 * @param {URL} url
 * @param {number} childPort
 * @returns {Response|undefined}
 */
function proxyWebSocketToChild(req, srv, url, childPort) {
  // Forward the auth-bearing request headers so a `<channel auth>` upgrade
  // handler's `_scrml_auth_check(req)` sees the browser's session cookie (Bun's
  // WebSocket honours a `headers` option). Without this, authenticated §38.5
  // channels that worked in prod would 401 under `scrml dev`.
  const fwd = {};
  const cookie = req.headers.get("cookie");
  if (cookie) fwd.Cookie = cookie;
  const auth = req.headers.get("authorization");
  if (auth) fwd.Authorization = auth;
  // NB: `Sec-WebSocket-Protocol` is deliberately NOT forwarded — scrml channels do
  // not negotiate a subprotocol, and the parent's `srv.upgrade` cannot echo the
  // child's chosen subprotocol back to the browser, so forwarding it would make a
  // subprotocol-requiring browser close on the unconfirmed handshake.

  const upstream = new WebSocket(
    `ws://127.0.0.1:${childPort}${url.pathname}${url.search}`,
    Object.keys(fwd).length ? { headers: fwd } : undefined,
  );
  // Deliver binary channel frames as ArrayBuffer (ServerWebSocket.send accepts
  // ArrayBuffer/TypedArray/string but throws on a Blob — the browser default).
  upstream.binaryType = "arraybuffer";
  const st = { upstream, browser: null, upOpen: false, toUpstream: [], toBrowser: [], closed: false };

  upstream.addEventListener("open", () => {
    st.upOpen = true;
    for (const m of st.toUpstream) { try { upstream.send(m); } catch { /* closing */ } }
    st.toUpstream = [];
  });
  upstream.addEventListener("message", (e) => {
    if (st.browser) { try { st.browser.send(e.data); } catch { /* closing */ } }
    else st.toBrowser.push(e.data);
  });
  const closeBoth = (code, reason) => {
    st.closed = true;
    if (st.browser) {
      // A close code of `undefined` (an upstream `error` with no code) is not a
      // valid argument to ServerWebSocket.close and can throw — close cleanly.
      try { code === undefined ? st.browser.close() : st.browser.close(code, reason); }
      catch { /* already closed */ }
    }
  };
  upstream.addEventListener("close", (e) => closeBoth(e.code, e.reason));
  upstream.addEventListener("error", () => closeBoth());

  const ok = srv.upgrade(req, { data: st });
  if (!ok) { try { upstream.close(); } catch { /* n/a */ } return new Response("WebSocket upgrade failed", { status: 400 }); }
  return undefined;
}

/** WebSocket handlers for the parent's Bun.serve — the browser-facing half of the pair. */
const wsProxyHandlers = {
  open(ws) {
    const st = ws.data;
    st.browser = ws;
    // Drain anything the upstream already delivered before this socket existed.
    for (const m of st.toBrowser) { try { ws.send(m); } catch { /* closing */ } }
    st.toBrowser = [];
    // Upstream already gone? Close this side too.
    if (st.closed) { try { ws.close(); } catch { /* closed */ } }
  },
  message(ws, message) {
    const st = ws.data;
    if (st.upOpen && st.upstream.readyState === 1) {
      try { st.upstream.send(message); } catch { /* closing */ }
    } else {
      st.toUpstream.push(message);
    }
  },
  close(ws) { try { ws.data.upstream.close(); } catch { /* closed */ } },
};

/**
 * Entry point for the dev subcommand.
 *
 * @param {string[]} args — raw argv slice after "dev"
 */
export async function runDev(args) {
  // #724 child-process mode: re-entered by spawnAppChild with a config file path.
  // Run ONLY the app server (no compile/watch/proxy) and return.
  const childFlag = args.indexOf("--__dev-child");
  if (childFlag !== -1) {
    const cfgPath = args[childFlag + 1];
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    // The child owns its config file from here — delete it immediately so a later
    // hard-kill of either process cannot leak it in the temp dir.
    try { rmSync(cfgPath, { force: true }); } catch { /* parent may have removed it */ }
    await runDevChildServer(cfg.serveDir, cfg.opts);
    return;
  }

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

  // #724: run the app in a fresh CHILD process (respawned per recompile) and put
  // a STABLE reverse proxy in front of it. The parent never re-imports a
  // `*.server.js`, so it can never serve a stale handler; the child, being a new
  // process each reload, always re-evaluates the whole server graph while keeping
  // `import.meta.dir` (and the session store beside the bundle) intact.
  // `childPort` is 0 until the first child reports ready; the proxy returns a 503
  // "starting" during that window. The parent port is bound BEFORE the child spawns
  // (below) so there is never a moment with no server — even if the first child
  // hangs at import, requests get a 503 instead of connection-refused.
  let appChild = null;
  let childPort = 0;

  // Serialize respawns: overlapping edit-bursts must not each read the same
  // `appChild` as `old` and orphan the intermediate child (the #577 orphan class).
  // Chaining makes each respawn read the CURRENT child (set by the prior link) as
  // its `old`, so every spawned child is either the live one or gets killed.
  let respawnChain = Promise.resolve();
  function respawnAppChild(newServeDir) {
    const run = respawnChain.then(async () => {
      const old = appChild;
      const fresh = await spawnAppChild(newServeDir, opts);
      appChild = fresh;
      childPort = fresh.port;
      // Grace period before killing the old child so a request already mid-flight
      // to it is not reset into a 502. New requests already go to `fresh`.
      if (old) {
        const t = setTimeout(() => { try { old.proc.kill(); } catch { /* gone */ } }, 3000);
        t.unref?.();
      }
    });
    // The NEXT respawn chains off a settled promise even if THIS one fails, so a
    // single bad spawn can never wedge future hot reloads; the caller still awaits
    // `run` and sees this respawn's own success/failure.
    respawnChain = run.catch(() => {});
    return run;
  }
  function killAppChild() { try { appChild?.proc.kill(); } catch { /* already gone */ } }
  process.on("exit", killAppChild);
  process.on("SIGINT", () => { killAppChild(); process.exit(0); });
  process.on("SIGTERM", () => { killAppChild(); process.exit(0); });

  // The STABLE public server: dev-infra endpoints are served here (so the
  // hot-reload SSE stream survives every child respawn); everything else is
  // reverse-proxied to the current app child.
  let server = Bun.serve({
    port: opts.port,
    idleTimeout: opts.idleTimeout ?? 120,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const pathname = url.pathname;
      // Dev-infra endpoints — served by the STABLE parent (never proxied) so the
      // SSE stream survives child respawns and the log stays a fast 204 even while
      // a compile is failing. Same helper the child uses, so no drift.
      const infra = await serveDevInfra(pathname, req);
      if (infra) return infra;
      // WebSocket upgrade (§38 channels) → reverse-proxy to the child. Handled
      // BEFORE the compile-failure short-circuit so a channel reconnect during a
      // failing compile keeps talking to the last-good child instead of getting an
      // HTML body and thrashing its retry loop.
      if ((req.headers.get("upgrade") || "").toLowerCase() === "websocket") {
        if (!childPort) return new Response("[dev] app server is starting…", { status: 503 });
        return proxyWebSocketToChild(req, srv, url, childPort);
      }
      // While the last compile is failing, serve the real error at every app
      // request (adopter-#517) rather than proxying to the last-good child.
      const failure = getCompileFailure();
      if (failure) return buildCompileErrorResponse(req, failure);
      // No child bound yet (first boot still starting, or a failed initial spawn).
      if (!childPort) return new Response("[dev] app server is starting…", { status: 503, headers: { "Retry-After": "1" } });
      return proxyHttpToChild(req, url, childPort);
    },
    websocket: wsProxyHandlers,
  });
  globalThis._scrml_active_server = server;

  // Spawn the initial app child AFTER the parent port is bound (above). A first
  // bundle that hangs or throws at import therefore degrades to a 503/error page,
  // never a downed port, and recovers on the next successful recompile. The
  // "Serving" line prints AFTER the child is ready so it keeps its "ready to serve"
  // meaning (harnesses and humans wait on it).
  try {
    appChild = await spawnAppChild(serveDir, opts);
    childPort = appChild.port;
  } catch (err) {
    console.error(`[dev] initial app server failed to start: ${err.message}`);
    console.error(`[dev] serving errors until the next successful recompile.`);
  }

  console.log(`[dev] Serving ${serveDir} at http://localhost:${server.port}`);
  console.log(`[dev] Watching for changes... (Ctrl+C to stop)\n`);

  // Parent-death guard (g-dev-watcher-tests-leak-server-processes): when `scrml
  // dev` is spawned by a test harness or agent that is later FORCE-killed
  // (SIGKILL — no chance to run its reaper), this child would otherwise survive
  // as an orphan, holding its fs.watch (inotify) handles. Enough orphans exhaust
  // the machine's inotify budget (EMFILE) and then NO dev server or watcher test
  // can start — the machine-wide failure #577 measured (89 orphans → 0 handles).
  // Poll the launching process and exit when it is gone or we have been
  // reparented away from it. Cross-OS: `process.kill(pid, 0)` sends no signal but
  // throws when the pid no longer exists (Linux + Windows); `process.ppid`
  // changing catches the Linux reparent-to-init case directly. Gated to a
  // NON-INTERACTIVE stdin so a human's terminal `scrml dev` — whose parent shell
  // is its rightful owner — is never affected.
  if (!process.stdin.isTTY) {
    const launchPpid = process.ppid;
    const parentDeathTimer = setInterval(() => {
      if (!launchingProcessGone(launchPpid)) return;
      console.error("[dev] launching process is gone — shutting down so the watcher is not orphaned");
      clearInterval(parentDeathTimer);
      try { server.stop(true); } catch { /* already stopped */ }
      process.exit(0);
    }, 2000);
    // Do not keep the event loop alive on the guard's account alone.
    parentDeathTimer.unref?.();
  }

  // BUG-1 fix (scrml-dev-watcher-and-stale-entry-2026-06-01), reworked S346
  // (g-dev-watcher-dies-on-delete-rename-permanent-500): watch each DISTINCT
  // directory that contains a gathered `.scrml` source, NON-recursively — one
  // `fs.watch(dir)` per source directory — plus a per-file stat snapshot
  // (mtime/size/inode) of every watched source.
  //
  // Why not per-FILE watches (the original BUG-1 shape): a per-file inotify
  // watch follows the INODE, so the file being deleted, renamed away, or
  // replaced by an editor's atomic save (write tmp + rename over) fires at
  // most one final event and is DEAD thereafter — no recompile ever fires for
  // that path again. Post-#518 (dev correctly refuses to serve a stale bundle
  // on a failed compile) a dead watch upgraded that from "stale app, no hot
  // reload" to a PERMANENT 500 on a project that has since been fixed on
  // disk, until restart. A non-recursive DIRECTORY watch survives all of
  // those mutations (verified on this platform: Bun fs.watch/inotify reports
  // dir-level rename/change events for rm, re-create, vim-style rename, and
  // atomic save — the atomic save is reported under the TMP file's name,
  // which is why change detection below uses the stat snapshots rather than
  // the reported filename).
  //
  // Why this does NOT reintroduce the BUG-1 ENOSPC crash: BUG-1 was
  // `fs.watch(dir, {recursive:true})` registering an inotify watch for EVERY
  // file under a large parent tree (node_modules, .git, sibling repos). A
  // non-recursive dir watch is ONE inotify watch per distinct source
  // directory — bounded by the source set and strictly fewer watches than
  // the per-file scheme it replaces. Output written under `dist/` is a
  // SUBdirectory and never fires the parent's non-recursive watch, so
  // compiling cannot re-trigger the watcher.
  //
  // `watchedFiles` tracks which absolute source paths are registered so the
  // re-gather pass can add NEW imports without double-registering;
  // `watchedDirs` tracks which directories already carry the single dir
  // watch; `fileSnapshots` carries the per-file stat snapshot that decides
  // whether a directory event was actually a source change.
  const watchedFiles = new Set();
  const watchedDirs = new Set();
  /** @type {Map<string, { mtimeMs: number, size: number, ino: number } | null>} */
  const fileSnapshots = new Map();
  // Warn at most once about the watch limit so a degraded watcher does not
  // spam the console on every failed watch attempt.
  let watchLimitWarned = false;
  // Debounce quiet period: one editor save can fire several directory events;
  // wait for a short quiet window so one save is one recompile, not several.
  const WATCH_DEBOUNCE_QUIET_MS = 100;
  // MAX-WAIT bound on that debounce: the stat sweep is guaranteed to run
  // within this long of the OLDEST un-swept event, however fast events keep
  // arriving — bounds worst-case hot-reload latency under sibling churn.
  const WATCH_DEBOUNCE_MAX_WAIT_MS = 250;
  let debounceTimer = null;
  // Timestamp of the oldest event not yet covered by a stat sweep; 0 = none
  // pending. Set on the first event of a burst, cleared whenever a sweep runs.
  let oldestPendingEventAt = 0;

  /**
   * Stat snapshot of one source. `null` means absent/unreadable — a real
   * state (the deleted half of delete→restore), not an error.
   *
   * `ctimeMs` is in the tuple deliberately (S346 review F1). {mtimeMs,size,ino}
   * alone is EVASIBLE: an in-place same-length write followed by
   * `utimesSync(f, atime, mtime)` restores mtime EXACTLY (measured:
   * 1786895065901.5632 both sides, same size, same inode) and the edit is then
   * served STALE at 200 — the silent class #518 closed, reintroduced. POSIX
   * exposes no API to set ctime, and any content or metadata write moves it
   * (the same probe: ctime 1786895065901.5632 -> 1786895065942.566), so adding
   * it closes the evasion by construction rather than by enumerating writers.
   *
   * @param {string} file absolute path
   * @returns {{ mtimeMs: number, ctimeMs: number, size: number, ino: number } | null}
   */
  function snapshotOf(file) {
    try {
      const st = statSync(file);
      return { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, ino: Number(st.ino) || 0 };
    } catch {
      return null;
    }
  }

  /**
   * Did `file` change since its recorded snapshot? Present↔absent counts as a
   * change (delete AND restore both recompile); so does a new inode with
   * identical mtime/size (atomic save). Updates the snapshot when changed so
   * one edit is one recompile, not an event-storm of them.
   *
   * @param {string} file absolute path
   * @returns {boolean}
   */
  function snapshotChanged(file) {
    const prev = fileSnapshots.get(file);
    const cur = snapshotOf(file);
    const changed = (prev === null || prev === undefined) !== (cur === null)
      || (prev != null && cur !== null
          && (prev.mtimeMs !== cur.mtimeMs || prev.ctimeMs !== cur.ctimeMs
              || prev.size !== cur.size || prev.ino !== cur.ino));
    if (changed) fileSnapshots.set(file, cur);
    return changed;
  }

  const warnLimit = (err) => {
    if (watchLimitWarned) return;
    watchLimitWarned = true;
    if (err && err.code === "ENOSPC") {
      console.error(`[dev] file-watch limit hit (fs.inotify.max_user_watches) — hot-reload disabled; raise the limit with: sudo sysctl fs.inotify.max_user_watches=524288`);
    } else {
      console.error(`[dev] file watch failed (${err && err.message ? err.message : err}) — hot-reload may be degraded; server still serving`);
    }
  };

  /**
   * Ensure the single non-recursive watch on one source DIRECTORY. Wrapped so
   * a watch failure (e.g. ENOSPC at the inotify limit) degrades gracefully —
   * the dev server keeps serving with hot-reload disabled rather than
   * crashing.
   *
   * @param {string} dir absolute directory path
   */
  function watchDir(dir) {
    if (watchedDirs.has(dir)) return;
    try {
      const w = watch(dir, (eventType, filename) => scheduleRecompile(eventType, filename));
      // A watcher `error` event (e.g. ENOSPC, the directory itself removed)
      // must NEVER crash the server. Warn once and keep serving.
      w.on("error", (err) => warnLimit(err));
      watchedDirs.add(dir);
    } catch (err) {
      // Synchronous watch() failure (also ENOSPC on some platforms).
      warnLimit(err);
    }
  }

  /**
   * Register one source file for change detection: record its stat snapshot
   * and make sure its containing directory is watched. Idempotent.
   *
   * @param {string} file absolute `.scrml` path (POSIX-canonical)
   */
  function watchFile(file) {
    if (watchedFiles.has(file)) return;
    watchedFiles.add(file);
    fileSnapshots.set(file, snapshotOf(file));
    watchDir(dirname(file));
  }

  function scheduleRecompile(_eventType, _filename) {
    // NO filename filter here — deliberately. An editor's atomic save is
    // reported under its TMP file's name (e.g. `.entry.scrml.tmp`), and a
    // directory event may carry no name at all. A filter would have to
    // enumerate every shape an event's filename can take (real name, TMP
    // name, null, per-platform variance) — an enumerate-forever list. The
    // stat sweep (sweepAndRecompile) is immune to filename shape entirely:
    // it stats the WATCHED source set and recompiles only when one of them
    // actually changed — sibling-file churn in a source directory (or the
    // dist/ subdirectory appearing) stats clean and is skipped silently.
    //
    // The debounce over that sweep is MAX-WAIT-BOUNDED. A plain debounce
    // (clearTimeout + re-arm on every event) is unbounded: with no filename
    // filter, ANY sibling writing faster than the quiet period (an appended
    // log, a test watcher, editor swap/backup churn) re-arms it forever and
    // the sweep never runs — hot-reload starves (PA-measured S346: a real
    // edit under 40 ms sibling churn was NEVER detected). The max-wait
    // guarantees the sweep runs within WATCH_DEBOUNCE_MAX_WAIT_MS of the
    // oldest un-swept event, bounding worst-case latency by construction —
    // which is why max-wait beats a filter.
    const now = Date.now();
    if (oldestPendingEventAt === 0) oldestPendingEventAt = now;
    if (now - oldestPendingEventAt >= WATCH_DEBOUNCE_MAX_WAIT_MS) {
      // The oldest pending event has waited the full bound: sweep NOW instead
      // of re-arming. Under continuous churn this fires once per max-wait
      // period, and the sweep early-returns when no watched source changed,
      // so the steady-state cost is one stat pass per period — not a compile.
      clearTimeout(debounceTimer);
      debounceTimer = null;
      oldestPendingEventAt = 0;
      sweepAndRecompile();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      oldestPendingEventAt = 0;
      sweepAndRecompile();
    }, WATCH_DEBOUNCE_QUIET_MS);
  }

  /**
   * The stat sweep + recompile behind the debounce: stat every watched source
   * against its snapshot; if none changed this was sibling churn — return
   * silently. Otherwise recompile, extend the watch set with newly gathered
   * imports, reload routes + server config, and signal connected browsers.
   */
  async function sweepAndRecompile() {
    let sourceChanged = false;
    for (const f of watchedFiles) {
      // No short-circuit: EVERY changed file's snapshot must be refreshed
      // this pass, or the leftovers re-trigger a recompile on the next
      // unrelated directory event.
      if (snapshotChanged(f)) sourceChanged = true;
    }
    if (!sourceChanged) return;
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
      // #724: respawn the app child so the recompiled server bundle (and its whole
      // cross-file server graph) is re-evaluated in a fresh process. The parent's
      // stable proxy — and its SSE hot-reload stream — is untouched, so the reload
      // signal below is reliable across the swap.
      try {
        await respawnAppChild(recompileOutputDir || serveDir);
      } catch (err) {
        // The compile SUCCEEDED but the fresh child would not start. Surface it as
        // an error page (not a silent stale bundle — the exact #724 symptom) and
        // signal a reload so the developer SEES it; the next successful edit clears
        // it via runOnce's own noteCompileResult.
        console.error(`[dev] failed to restart app server: ${err.message}`);
        noteCompileResult({
          errors: [{
            stage: "DEV",
            code: "DEV-SERVER-RESTART-FAILED",
            message: `The app server failed to restart: ${err.message}. Save again to retry.`,
            file: "",
            line: 0,
            column: 0,
            severity: "error",
          }],
          warnings: [],
        });
        broadcastReload();
        return;
      }
      // Signal all connected browsers to reload.
      broadcastReload();
      if (sseClients.size > 0) {
        console.log(`[dev] Signalled ${sseClients.size} browser(s) to reload`);
      }
    }
  }

  // Register each gathered source file (entry + transitive imports): one
  // stat snapshot per file + one non-recursive watch per distinct directory.
  for (const file of deriveWatchFiles(opts, gatheredOut.files)) {
    watchFile(file);
  }

  // Keep process alive (server already does this, but be explicit)
  await new Promise(() => {});
}
