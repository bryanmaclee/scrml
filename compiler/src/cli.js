#!/usr/bin/env bun
/**
 * scrml — CLI entry point with subcommand routing.
 *
 * Usage:
 *   scrml compile <file.scrml|dir> [options]
 *   scrml dev <file.scrml|dir> [options]
 *   scrml build <dir> [options]
 *   scrml migrate <file|dir> [options]
 *   scrml introspect <postgres-url> [options]
 *   scrml promote --match|--engine <file|dir> [options]
 *   scrml --help
 *   scrml --version
 *
 * Falls through to compile if the first arg is a .scrml file or directory.
 */

import { statSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from the nearest package.json that has it
let version = "0.2.0";
try {
  // Walk up to find a package.json with a version field
  const pkgPath = join(__dirname, "../../package.json");
  const pkg = JSON.parse(await Bun.file(pkgPath).text());
  if (pkg.version) version = pkg.version;
} catch { /* use default */ }

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`scrml compiler v${version}

Usage:
  scrml init [directory]                     Scaffold a new scrml project
  scrml compile <file.scrml|dir> [options]   Compile scrml source
  scrml dev <file.scrml|dir> [options]       Compile + watch + serve
  scrml build <dir> [options]                Build production server
  scrml serve [options]                      Start persistent compiler server
  scrml generate <type> [options]            Scaffold adopter-owned source (e.g. \`scrml generate auth\`)
  scrml migrate <file|dir> [options]         Apply automated source rewrites for deprecated patterns
  scrml promote --match|--engine <file|dir>  Promote tier-1 if-else → <match> or <match> → <engine> (CLI surface; impl pending)
  scrml introspect <postgres-url> [options]  Read a live Postgres schema and emit scrml <schema> source
  scrml semdiff <base> <head> [options]      Classify a change by AXIS + soundness TIER (#6b P0)

Options (compile / dev):
  --output-dir, -o <dir>  Output directory (default: dist/ next to input)
  --verbose, -v           Per-stage timing and counts
  --convert-legacy-css    Convert <style> blocks to #{...}
  --embed-runtime         Embed runtime inline instead of writing a separate file
  --emit-batch-plan       Print the Stage 7.5 BatchPlan as JSON
  --emit-reachability     Emit <base>.reachability.json (Stage 7.6 / SPEC §40.9)
  --emit-engine-graph     Emit <base>.engine-graph.json (engine what-comes-next graph, SPEC §51.0)
  --emit-block-analysis   Emit <base>.block-analysis.json (per-file block-lease analysis sidecar)
  --chunk-size-budget=N   Soft size budget (bytes) for W-CG-CHUNK-LARGE (default 100000)
  --emit-machine-tests    Emit <base>.machine.test.js for each source (§51.13)
  --debug-perf            Sub-stage timing for CG / RS / DG (PGO instrumentation)
  --parser=scrml-native   M5.1 native-parser observability shadow (opt-in)
  --watch, -w             Watch for changes and recompile (compile command only)

Options (dev):
  --port <n>            HTTP port for dev server (default: 3000)

Options (build):
  --output <dir>        Output directory (default: dist/ next to input)
  --embed-runtime       Embed runtime inline instead of writing a separate file
  --minify              Enable minification (Phase 2 — accepted but no-op in v1)

Options (serve):
  --port <n>            HTTP port for compiler server (default: 3100, or SCRML_PORT env)
  --verbose, -v         Log per-stage timing for each compilation

Options (migrate):
  --dry-run             Print unified diff to stdout without writing
  --check               Exit non-zero if any file would be modified (CI-friendly)
  --include=<glob>      File pattern (default: '*.scrml')
  --exclude=<glob>      Additional exclude pattern (substring match)
  --no-default-excludes Disable built-in samples/ + tests/ exclusions

Options (promote):
  --match               Lift if-else over enum-typed cell into <match> block (Tier 1)
  --engine              Lift <match> with rule= attributes into <engine> (Tier 2)
  --dry-run             Print unified diff to stdout without writing
  --check               Exit non-zero if any file would be promoted
  Status: CLI surface locked; AST→AST rewrite implementation pending.
  See docs/changes/promotion-ergonomics/SCOPE.md.

Options (introspect):
  --out <file>          Write emitted <schema> source to <file> (default: stdout)
  --table <name>        Emit only the named table (default: all base tables)
  Status: Postgres-only (v1).

Options (semdiff):
  --emit-classification Emit the per-matched-entity classification (default)
  --json                Structured JSON output (consumer review-row / merge input)
  Exit: 0 classification produced · 2 a version failed to compile (fail-closed).

Options (global):
  --help, -h            Show this message
  --version             Print version
`);
  process.exit(0);
}

if (args[0] === "--version") {
  console.log(version);
  process.exit(0);
}

// Resolve subcommand
let subcommand = args[0];
let subArgs = args.slice(1);

// Fall through: if first arg is a .scrml file or a directory, treat as compile
if (subcommand !== "compile" && subcommand !== "dev" && subcommand !== "build" && subcommand !== "serve" && subcommand !== "init" && subcommand !== "migrate" && subcommand !== "promote" && subcommand !== "generate" && subcommand !== "introspect" && subcommand !== "semdiff") {
  // Check if it looks like a file or directory rather than a subcommand
  const looksLikeInput = subcommand.endsWith(".scrml") || (() => {
    try { return statSync(subcommand).isDirectory(); } catch { return false; }
  })();

  if (looksLikeInput) {
    subcommand = "compile";
    subArgs = args; // include the first arg — it is the input
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Run `scrml --help` for usage.');
    process.exit(1);
  }
}

// Dispatch to subcommand handler
if (subcommand === "init") {
  const { runInit } = await import("./commands/init.js");
  await runInit(subArgs);
} else if (subcommand === "compile") {
  const { runCompile } = await import("./commands/compile.js");
  await runCompile(subArgs);
} else if (subcommand === "dev") {
  const { runDev } = await import("./commands/dev.js");
  await runDev(subArgs);
} else if (subcommand === "build") {
  const { runBuild } = await import("./commands/build.js");
  await runBuild(subArgs);
} else if (subcommand === "serve") {
  const { runServe } = await import("./commands/serve.js");
  await runServe(subArgs);
} else if (subcommand === "migrate") {
  const { runMigrate } = await import("./commands/migrate.js");
  await runMigrate(subArgs);
} else if (subcommand === "promote") {
  const { runPromote } = await import("./commands/promote.js");
  await runPromote(subArgs);
} else if (subcommand === "generate") {
  const { runGenerate } = await import("./commands/generate.js");
  await runGenerate(subArgs);
} else if (subcommand === "introspect") {
  const { runIntrospect } = await import("./commands/introspect.js");
  await runIntrospect(subArgs);
} else if (subcommand === "semdiff") {
  const { runSemdiff } = await import("./commands/semdiff.js");
  await runSemdiff(subArgs);
}
