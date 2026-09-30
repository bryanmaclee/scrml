/**
 * @module commands/serve
 * scrml serve subcommand.
 *
 * Starts a persistent HTTP compiler server that accepts compilation requests.
 * Eliminates the ~64ms JIT warmup cost on every cold invocation by keeping
 * the compiler process hot.
 *
 * Endpoints:
 *   GET  /health              — liveness check + uptime
 *   POST /compile             — compile files, returns JSON result
 *   POST /compile-source      — compile from inline source (no disk read)
 *   POST /shutdown            — graceful shutdown
 *
 * Environment:
 *   SCRML_PORT  — port to listen on (default: 3100)
 */

import { compileScrml, scanDirectory } from "../api.js";
import { resetVarCounter } from "../codegen/var-counter.js";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`scrml serve [options]

Start a persistent HTTP compiler server. Keeps the compiler process hot to
eliminate JIT warmup cost (~64ms) on every compilation request.

Options:
  --port, -p <n>        HTTP port (default: 3100, or SCRML_PORT env var)
  --verbose, -v         Log per-stage timing for each compilation
  --help, -h            Show this message

Endpoints:
  GET  /health          Liveness check + uptime
  POST /compile         Compile files from disk (JSON body: { inputFiles, outputDir?, options? })
  POST /compile-source  Compile from inline source strings
  POST /shutdown        Graceful shutdown

Examples:
  scrml serve
  scrml serve --port 4000
  SCRML_PORT=4000 scrml serve
`);
}

/**
 * Parse serve-command arguments.
 *
 * @param {string[]} args
 * @returns {{ port: number, verbose: boolean }}
 */
function parseArgs(args) {
  let port = parseInt(process.env.SCRML_PORT ?? "3100", 10);
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i], 10);
      if (isNaN(port)) {
        console.error(`Invalid port: ${args[i]}`);
        process.exit(1);
      }
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { port, verbose };
}

/** Track compilation count for diagnostics */
let compilationCount = 0;

/**
 * Reset compiler-internal state between compilations to prevent memory growth
 * and stale state leaking between requests.
 */
function cleanupBetweenCompilations() {
  resetVarCounter();

  // Hint to the GC if available (Bun supports this)
  if (typeof Bun !== "undefined" && Bun.gc) {
    Bun.gc(false); // non-blocking GC
  }
}

/**
 * Entry point for the serve subcommand.
 *
 * @param {string[]} args — raw argv slice after "serve"
 */
export async function runServe(args) {
  const opts = parseArgs(args);

  const server = Bun.serve({
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // -----------------------------------------------------------------------
      // GET /health — liveness check
      // -----------------------------------------------------------------------
      if (pathname === "/health" && req.method === "GET") {
        return Response.json({
          status: "ok",
          uptime: process.uptime(),
          compilations: compilationCount,
          memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
        });
      }

      // -----------------------------------------------------------------------
      // POST /compile — compile files from disk
      //
      // Request body:
      //   { inputFiles: string[], outputDir?: string, options?: {...} }
      //
      // inputFiles are resolved relative to CWD if not absolute.
      // -----------------------------------------------------------------------
      if (pathname === "/compile" && req.method === "POST") {
        let body;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        if (!body.inputFiles || !Array.isArray(body.inputFiles) || body.inputFiles.length === 0) {
          return Response.json({ error: "inputFiles is required and must be a non-empty array" }, { status: 400 });
        }

        // Resolve file paths and expand directories
        const resolvedFiles = [];
        for (const f of body.inputFiles) {
          const resolved = resolve(f);
          try {
            const stat = Bun.file(resolved);
            // Check if it's a directory by trying scanDirectory
            // Bun.file doesn't have isDirectory, so we try the FS approach
            const { statSync } = await import("fs");
            if (statSync(resolved).isDirectory()) {
              resolvedFiles.push(...scanDirectory(resolved));
            } else {
              resolvedFiles.push(resolved);
            }
          } catch {
            resolvedFiles.push(resolved);
          }
        }

        // Clean up state from previous compilation
        cleanupBetweenCompilations();

        const compileOpts = {
          inputFiles: resolvedFiles,
          outputDir: body.outputDir ? resolve(body.outputDir) : undefined,
          verbose: body.options?.verbose ?? opts.verbose,
          convertLegacyCss: body.options?.convertLegacyCss ?? false,
          embedRuntime: body.options?.embedRuntime ?? false,
          write: body.options?.write ?? true,
          log: opts.verbose ? console.log : () => {},
        };

        try {
          const result = compileScrml(compileOpts);
          compilationCount++;

          // Serialize outputs Map to a plain object for JSON
          const outputsObj = {};
          if (result.outputs) {
            for (const [filePath, output] of result.outputs) {
              outputsObj[filePath] = output;
            }
          }

          return Response.json({
            errors: result.errors,
            warnings: result.warnings,
            fileCount: result.fileCount,
            outputDir: result.outputDir,
            durationMs: result.durationMs,
            outputs: outputsObj,
          });
        } catch (err) {
          return Response.json({
            error: "Compilation failed",
            message: err.message,
            stack: err.stack,
          }, { status: 500 });
        }
      }

      // -----------------------------------------------------------------------
      // POST /compile-source — compile from inline source strings
      //
      // Request body:
      //   { sources: { [filename]: sourceString }, outputDir?: string, options?: {...} }
      //
      // Writes sources to temp files, compiles, returns result.
      // Useful for IDE integrations and testing.
      // -----------------------------------------------------------------------
      if (pathname === "/compile-source" && req.method === "POST") {
        let body;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        if (!body.sources || typeof body.sources !== "object" || Object.keys(body.sources).length === 0) {
          return Response.json({ error: "sources is required and must be a non-empty object" }, { status: 400 });
        }

        // Write sources to temp files
        const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
        const { join } = await import("path");
        const { tmpdir } = await import("os");

        const tempDir = mkdtempSync(join(tmpdir(), "scrml-serve-"));
        const inputFiles = [];

        try {
          for (const [filename, source] of Object.entries(body.sources)) {
            const filePath = join(tempDir, filename.endsWith(".scrml") ? filename : `${filename}.scrml`);
            writeFileSync(filePath, source);
            inputFiles.push(filePath);
          }

          cleanupBetweenCompilations();

          const compileOpts = {
            inputFiles,
            outputDir: body.outputDir ? resolve(body.outputDir) : join(tempDir, "dist"),
            verbose: body.options?.verbose ?? opts.verbose,
            convertLegacyCss: body.options?.convertLegacyCss ?? false,
            embedRuntime: body.options?.embedRuntime ?? false,
            write: body.options?.write ?? false,
            log: opts.verbose ? console.log : () => {},
          };

          const result = compileScrml(compileOpts);
          compilationCount++;

          const outputsObj = {};
          if (result.outputs) {
            for (const [filePath, output] of result.outputs) {
              outputsObj[filePath] = output;
            }
          }

          return Response.json({
            errors: result.errors,
            warnings: result.warnings,
            fileCount: result.fileCount,
            outputDir: result.outputDir,
            durationMs: result.durationMs,
            outputs: outputsObj,
          });
        } finally {
          // Clean up temp files
          try { rmSync(tempDir, { recursive: true }); } catch { /* best effort */ }
        }
      }

      // -----------------------------------------------------------------------
      // POST /shutdown — graceful shutdown
      // -----------------------------------------------------------------------
      if (pathname === "/shutdown" && req.method === "POST") {
        // Respond before shutting down
        setTimeout(() => {
          server.stop();
          process.exit(0);
        }, 100);
        return Response.json({ status: "shutting down" });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`scrml compiler server listening on http://localhost:${server.port}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health         — liveness check`);
  console.log(`  POST /compile        — compile files from disk`);
  console.log(`  POST /compile-source — compile from inline source`);
  console.log(`  POST /shutdown       — graceful shutdown`);

  // Keep process alive
  await new Promise(() => {});
}
