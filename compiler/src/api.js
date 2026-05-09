/**
 * @module api
 * scrml compiler — programmatic API.
 *
 * Exports the full BS→TAB→CE→BPP→PA→RI→TS→MC→DG→CG pipeline as a reusable
 * function so that CLI commands, test suites, watch loops, and language
 * servers can all drive compilation without spawning a subprocess.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "fs";
import { resolve, extname, dirname, basename, join, relative } from "path";
import { fileURLToPath } from "url";
import { splitBlocks } from "./block-splitter.js";
import { buildAST } from "./ast-builder.js";
import { runCE } from "./component-expander.ts";
import { runPostCEInvariant } from "./validators/post-ce-invariant.ts";
import { runAttributeInterpolation } from "./validators/attribute-interpolation.ts";
import { runAttributeAllowlist } from "./validators/attribute-allowlist.ts";

import { runPA } from "./protect-analyzer.ts";
import { runRI } from "./route-inference.ts";
import { runTS, buildTypeRegistry } from "./type-system.ts";
import { runMetaChecker } from "./meta-checker.ts";
import { runDG } from "./dependency-graph.ts";
import { runBatchPlanner, serializeBatchPlan } from "./batch-planner.ts";
import { runCG } from "./code-generator.js";
import { runMetaEval } from "./meta-eval.ts";
import { resolveModules, resolveModulePath } from "./module-resolver.js";
import { runNRBatch } from "./name-resolver.ts";
import { runSYMBatch } from "./symbol-table.ts";
import { setBPPOverrides } from "./codegen/compat/parser-workarounds.js";
import { lintGhostPatterns } from "./lint-ghost-patterns.js";
import { runIMatchPromotable } from "./lint-i-match-promotable.js";
import { findUnsupportedTailwindShapes } from "./tailwind-classes.js";
import { runGauntletPhase1Checks } from "./gauntlet-phase1-checks.js";
import { runGauntletPhase3EqChecks } from "./gauntlet-phase3-eq-checks.js";

// ---------------------------------------------------------------------------
// Stdlib runtime directory
// ---------------------------------------------------------------------------
//
// Hand-written ES module shims for stdlib modules live at
// compiler/runtime/stdlib/<name>.js. They are copied verbatim into
// <outputDir>/_scrml/<name>.js by bundleStdlibForRun() so emitted JS can
// `import { ... } from "./_scrml/<name>.js"` (rewritten from "scrml:<name>").
//
// This is the runtime-resolution bridge the compiler had been missing —
// see scrml-support/archive/changes/oq-2-dev-server-bootstrap/diagnosis.md.
//
// Why hand-written shims (vs. compiling stdlib/<name>/*.scrml on the fly):
// stdlib/.scrml sources contain `server {}` blocks the standard pipeline does
// not lower at TS time today (tracked separately under M16 as the deeper
// stdlib bring-up). The shims are the smallest viable runtime artefact and
// can be replaced by truly-compiled output once that gap is closed.
const __apiFile = fileURLToPath(import.meta.url);
const STDLIB_RUNTIME_DIR = resolve(dirname(__apiFile), "..", "runtime", "stdlib");

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

/**
 * Recursively scan a directory for .scrml files.
 * Used when the compiler is given a directory instead of individual files.
 * Directory structure maps to URL paths per the file-based routing convention.
 *
 * @param {string} dirPath — directory to scan
 * @returns {string[]} — array of absolute .scrml file paths, sorted
 */
export function scanDirectory(dirPath) {
  const results = [];
  const absDir = resolve(dirPath);

  function walk(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".scrml")) {
        results.push(fullPath);
      }
    }
  }

  walk(absDir);
  return results.sort();
}

// ---------------------------------------------------------------------------
// Output path resolution (F-COMPILE-001 — Option A: preserve source tree)
// ---------------------------------------------------------------------------

/**
 * Compute the longest common directory prefix of a set of input file paths.
 * Used by the output write loop to preserve source-tree structure in dist/.
 *
 * Behavior:
 *   0 files  → returns null
 *   1 file   → returns dirname(file)
 *   N files  → returns the longest directory path that is a prefix of every
 *              file's absolute path, segment-aligned (not character-aligned)
 *
 * Examples:
 *   ["/a/b/c.scrml"]                                → "/a/b"
 *   ["/a/b/c.scrml", "/a/b/d.scrml"]                → "/a/b"
 *   ["/a/b/c.scrml", "/a/b/sub/d.scrml"]            → "/a/b"
 *   ["/a/b/x/c.scrml", "/a/b/y/d.scrml"]            → "/a/b"
 *   ["/p/x.scrml", "/q/y.scrml"]                    → "/"
 *
 * Segment-aligned matching: "/a/b" is the prefix of "/a/b/c" but NOT of "/a/bc"
 * (a character-wise prefix would falsely match "/a/bc").
 *
 * @param {string[]} inputFiles
 * @returns {string|null}
 */
export function computeOutputBaseDir(inputFiles) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) return null;
  if (inputFiles.length === 1) return dirname(resolve(inputFiles[0]));

  const dirSegments = inputFiles.map(f => dirname(resolve(f)).split(/[\\/]/));
  const minLen = Math.min(...dirSegments.map(s => s.length));
  let common = 0;
  for (; common < minLen; common++) {
    const seg = dirSegments[0][common];
    if (!dirSegments.every(s => s[common] === seg)) break;
  }

  // Re-join. If the first segment is empty (POSIX absolute "/a/b" splits to
  // ["", "a", "b"]) and we kept index 0, the join yields "/a/b" naturally.
  return dirSegments[0].slice(0, common).join("/") || "/";
}

/**
 * Recursively find files under a directory whose names end with the given suffix.
 * Used by build.js / dev.js to discover *.server.js files in the output tree
 * after Option A preserved-source-tree output. (Pre-fix dist/ was always flat,
 * but a nested input tree now produces a nested dist/ tree.)
 *
 * Returns absolute paths AND relative paths so callers can construct correct
 * import specifiers (which are relative to the dist root).
 *
 * @param {string} dirPath — absolute directory path
 * @param {string} suffix — filename suffix to match (e.g. ".server.js")
 * @returns {Array<{ absPath: string, relPath: string }>} — entries sorted by relPath
 */
export function findOutputFiles(dirPath, suffix) {
  const results = [];
  const absRoot = resolve(dirPath);

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(suffix)) {
        results.push({
          absPath: fullPath,
          relPath: relative(absRoot, fullPath),
        });
      }
    }
  }

  walk(absRoot);
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ---------------------------------------------------------------------------
// Legacy CSS conversion
// ---------------------------------------------------------------------------

/**
 * Pre-process source to convert `<style>...</style>` blocks to `#{...}`.
 * Used when convertLegacyCss option is set.
 *
 * @param {string} source
 * @returns {string}
 */
function convertLegacyCssSource(source) {
  return source.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, content) => {
    return `#{${content}}`;
  });
}

// ---------------------------------------------------------------------------
// Stdlib bundling (OQ-2 — runtime resolution of `scrml:*` imports)
// ---------------------------------------------------------------------------

/**
 * Walk a TAB result's import declarations and gather the unique set of
 * `scrml:NAME` specifiers it references (anywhere — top-level or scoped).
 *
 * The set is the input to bundleStdlibForRun() and to rewriteStdlibImports().
 *
 * @param {object[]} tabResults — TAB stage outputs
 * @returns {Set<string>} — bare module names (e.g., "auth", "crypto", "store")
 */
export function collectStdlibSpecifiers(tabResults) {
  const names = new Set();
  for (const tab of tabResults || []) {
    const imports = tab?.ast?.imports || tab?.imports || [];
    for (const imp of imports) {
      const src = imp?.source;
      if (typeof src === "string" && src.startsWith("scrml:")) {
        const name = src.slice("scrml:".length);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/**
 * Copy the runtime shim for each referenced `scrml:NAME` specifier into
 * `<outputDir>/_scrml/<name>.js` so emitted JS can `import` it via a relative
 * path. Modules without a hand-written shim are silently skipped — emitted
 * JS that imports them will fail loudly at runtime, which matches the
 * pre-bundle behaviour and lets the gap surface as a finding.
 *
 * @param {Set<string>} names — bare stdlib names (from collectStdlibSpecifiers)
 * @param {string} outputDir — absolute path of the user's output directory
 * @param {(msg: string) => void} [log]
 * @returns {Set<string>} — the subset of names that were actually bundled
 */
export function bundleStdlibForRun(names, outputDir, log) {
  const bundled = new Set();
  if (!names || names.size === 0 || !outputDir) return bundled;
  const stdlibOut = join(outputDir, "_scrml");
  let made = false;
  for (const name of names) {
    const src = join(STDLIB_RUNTIME_DIR, `${name}.js`);
    if (!existsSync(src)) {
      // No shim available — leave this name to fail loudly at runtime so the
      // gap is visible. Future M16 work can replace this with truly-compiled
      // stdlib output.
      continue;
    }
    if (!made) {
      mkdirSync(stdlibOut, { recursive: true });
      made = true;
    }
    const dst = join(stdlibOut, `${name}.js`);
    copyFileSync(src, dst);
    bundled.add(name);
    if (log) log(`  [STDLIB] Bundled scrml:${name} -> _scrml/${name}.js`);
  }
  return bundled;
}

// ---------------------------------------------------------------------------
// Import path rewriting (GITI-009 + OQ-2)
// ---------------------------------------------------------------------------

/**
 * Rewrite relative .js import paths in generated JS output so they resolve
 * from the output directory instead of the source file directory.
 *
 * When a .scrml file at `ui/repros/foo.scrml` imports `./helper.js`, the
 * import resolves to `ui/repros/helper.js` in source. But the compiled
 * output at `dist/ui/foo.server.js` needs the import to resolve from
 * `dist/ui/` — so the path must be rewritten to `../../ui/repros/helper.js`.
 *
 * Only rewrites relative imports (starting with ./ or ../) that end with .js,
 * EXCLUDING .server.js and .client.js (those are scrml-emitted output-tree
 * artefacts — siblings of the importing file in the dist tree, NOT source-tree
 * files; their relative paths in the output tree mirror the source tree per
 * F-COMPILE-001 Option A, so no relocation is needed).
 *
 * Non-relative imports (scrml:, vendor:, bare names) are left untouched —
 * those are handled by rewriteStdlibImports().
 *
 * @param {string} jsCode — generated JS source code
 * @param {string} sourceFilePath — absolute path of the source .scrml file
 * @param {string} outputDir — absolute path of the output directory
 * @returns {string} — JS code with rewritten import paths
 */
export function rewriteRelativeImportPaths(jsCode, sourceFilePath, outputDir) {
  if (!jsCode || !sourceFilePath || !outputDir) return jsCode;
  const sourceDir = dirname(resolve(sourceFilePath));
  const outDir = resolve(outputDir);
  // If source dir and output dir are the same, no rewriting needed
  if (sourceDir === outDir) return jsCode;

  return jsCode.replace(
    /^(import\s+(?:\{[^}]*\}|[^\s]+)\s+from\s+)(["'])(\.\.?\/[^"']+\.js)\2(;?)$/gm,
    (match, prefix, quote, relPath, semi) => {
      // F-COMPILE-002: skip .server.js / .client.js — these are scrml output
      // artefacts that live in the dist tree at the same relative position as
      // their .scrml source, so the source-relative path is already correct
      // for the output tree (no relocation needed).
      if (relPath.endsWith(".server.js") || relPath.endsWith(".client.js")) {
        return match;
      }
      // Resolve the import path from the source file's directory
      const absImportPath = resolve(sourceDir, relPath);
      // Compute the relative path from the output directory
      let newRelPath = relative(outDir, absImportPath);
      // Ensure it starts with ./ or ../
      if (!newRelPath.startsWith('.')) newRelPath = './' + newRelPath;
      return `${prefix}${quote}${newRelPath}${quote}${semi}`;
    }
  );
}

/**
 * Rewrite `import { ... } from "scrml:NAME"` to a relative path under
 * `<outputDir>/_scrml/NAME.js` for every NAME in the bundled-stdlib set.
 *
 * This pairs with bundleStdlibForRun() so the rewritten path always
 * points at a real on-disk artefact. NAMES not in the bundled set are
 * left as-is (they will fail loudly at runtime — see bundleStdlibForRun
 * comment for rationale).
 *
 * @param {string} jsCode — generated JS source code
 * @param {string} bundleDir — absolute path of the directory the file will
 *   be written into (e.g., outputDir for top-level files)
 * @param {string} outputDir — absolute path of the user's output directory
 *   (where the _scrml/ subdir lives)
 * @param {Set<string>} bundled — names actually bundled into _scrml/
 * @returns {string}
 */
export function rewriteStdlibImports(jsCode, bundleDir, outputDir, bundled) {
  if (!jsCode || !bundleDir || !outputDir || !bundled || bundled.size === 0) return jsCode;
  const writeDir = resolve(bundleDir);
  const outDir = resolve(outputDir);
  const stdlibAbs = join(outDir, "_scrml");
  return jsCode.replace(
    /^(import\s+(?:\{[^}]*\}|[^\s]+)\s+from\s+)(["'])scrml:([A-Za-z0-9_-][A-Za-z0-9_/-]*)\2(;?)$/gm,
    (match, prefix, quote, name, semi) => {
      if (!bundled.has(name)) return match;
      const target = join(stdlibAbs, `${name}.js`);
      let rel = relative(writeDir, target);
      if (!rel.startsWith(".")) rel = "./" + rel;
      return `${prefix}${quote}${rel}${quote}${semi}`;
    }
  );
}

// ---------------------------------------------------------------------------
// compileScrml
// ---------------------------------------------------------------------------

/**
 * Run the full scrml compiler pipeline on a set of input files.
 *
 * @param {object} options
 * @param {string[]} options.inputFiles        — resolved .scrml file paths to compile
 * @param {string}  [options.outputDir]        — directory to write output files; defaults to dist/ next to first input
 * @param {boolean} [options.verbose]          — emit per-stage timing and counts to options.log
 * @param {boolean} [options.convertLegacyCss] — pre-process <style> blocks to #{…}
 * @param {boolean} [options.embedRuntime]     — embed runtime inline instead of writing separate file (browser mode only)
 * @param {boolean} [options.write]            — write output files to disk (default true)
 * @param {boolean} [options.sourceMap]        — generate Source Map v3 .map files alongside JS output (default false)
 * @param {function} [options.log]             — logging function; defaults to console.log
 * @param {'browser'|'library'} [options.mode] — output mode (default 'browser')
 *   'browser': emits HTML + client IIFE JS + server JS (standard browser app)
 *   'library': emits ES module exports JS + server JS (importable module, no HTML, no runtime)
 * @param {object|null} [options.selfHostModules] — optional self-hosted module overrides.
 *   When provided, uses compiled scrml modules instead of the JS originals for:
 *   - selfHostModules.splitBlocks — replaces block-splitter.js:splitBlocks
 *   - selfHostModules.tokenizer — replaces tokenizer.js token functions (passed to buildAST)
 *   - selfHostModules.buildAST — replaces ast-builder.js:buildAST
 *   - selfHostModules.bpp — replaces parser-workarounds.js BPP functions
 *   - selfHostModules.runPA — replaces protect-analyzer.ts:runPA
 *   - selfHostModules.runRI — replaces route-inference.ts:runRI
 *   - selfHostModules.resolveModules — replaces module-resolver.js:resolveModules
 *   - selfHostModules.runTS — replaces type-system.ts:runTS
 *   - selfHostModules.runMetaChecker — replaces meta-checker.js:runMetaChecker
 *   - selfHostModules.runDG — replaces dependency-graph.ts:runDG
 *   - selfHostModules.runCG — replaces codegen/index.ts:runCG
 *   All other pipeline stages always use the JS originals.
 *   Caller is responsible for pre-loading modules (async import before calling compileScrml).
 *
 * @returns {{
 *   errors: object[],
 *   warnings: object[],
 *   lintDiagnostics: object[],
 *   fileCount: number,
 *   outputDir: string,
 *   durationMs: number,
 *   outputs: Map<string,{serverJs?:string,clientJs?:string,libraryJs?:string,html?:string,css?:string,clientJsMap?:string,serverJsMap?:string}>
 * }}
 */
export function compileScrml(options = {}) {
  let {
    inputFiles = [],
  } = options;
  const {
    verbose = false,
    convertLegacyCss = false,
    embedRuntime = false,
    write = true,
    sourceMap = false,
    mode = 'browser',
    emitMachineTests = false,
    log = console.log,
    selfHostModules = null,
  } = options;

  let { outputDir } = options;

  if (!outputDir && inputFiles.length > 0) {
    outputDir = join(dirname(inputFiles[0]), "dist");
  }

  const allErrors = [];

  // ---------------------------------------------------------------------------
  // Auto-gather pre-pass (SPEC §21.7 — F-COMPONENT-001 W2)
  //
  // When `gather` is enabled (default), expand `inputFiles` to the transitive
  // .scrml import closure. This implements the canonical-key cross-file
  // resolution promised by SPEC §21 — without auto-gather, single-file
  // CLI invocations like `scrml compile foo.scrml` only TAB the entry file
  // and any imported .scrml files are silently absent from `fileASTMap` /
  // `exportRegistry`. CE then misses cross-file lookups and either expands
  // nothing (silent phantom DOM, pre-W1) or fires E-COMPONENT-035 (post-W1).
  //
  // Algorithm:
  //   1. Initial set = explicit .scrml inputFiles (resolved to absolute paths).
  //   2. For each not-yet-processed file, regex-extract relative imports of
  //      `.scrml` files, resolve to absolute paths via `resolveModulePath`,
  //      and queue any `.scrml` files not yet in the set.
  //   3. Repeat until no new files are added.
  //   4. Cap at GATHER_LIMIT files; emit E-IMPORT-007 if exceeded.
  //
  // Notes:
  //   - `.js` imports are NOT traversed (per OQ-1 default — they follow ES
  //     module semantics and are resolved by the bundler/runtime).
  //   - When the user passes a directory, `commands/compile.js` already calls
  //     `scanDirectory()` to enumerate the tree; gather adds any imports that
  //     reach OUTSIDE that directory (e.g. ../components/foo.scrml).
  //   - `--no-gather` (CLI flag) sets `gather: false` and disables this pass;
  //     the user accepts the broken-artifact / E-IMPORT-006 risk.
  // ---------------------------------------------------------------------------
  const gatherEnabled = options.gather !== false;
  const GATHER_LIMIT = 5000;
  let resolvedInputFiles = inputFiles.map(f => resolve(f));
  if (gatherEnabled && resolvedInputFiles.length > 0) {
    const seen = new Set(resolvedInputFiles);
    const queue = [...resolvedInputFiles];
    let i = 0;
    let limitExceeded = false;
    while (i < queue.length && !limitExceeded) {
      const filePath = queue[i++];
      if (!filePath.endsWith(".scrml")) continue;
      let fileSrc = "";
      try {
        fileSrc = readFileSync(filePath, "utf8");
      } catch {
        // unreadable — BS will report; skip gather for this file
        continue;
      }
      // Lightweight regex scan for `import ... from '<path>'` AND
      // `export { ... } from '<path>'`. The real graph is built by
      // buildImportGraph after the canonical TAB pass; this pass only needs
      // the file SET. Re-export sources MUST be gathered too — otherwise the
      // type-registry seeder in api.js can't chase a re-exported name back to
      // its origin file (the chain hits a file that isn't in the compile set).
      const importRe = /(?:import|export)\s+[\s\S]*?from\s+(["'])([^"']+)\1/g;
      let m;
      while ((m = importRe.exec(fileSrc)) !== null) {
        const spec = m[2];
        if (typeof spec !== "string") continue;
        // Only follow relative imports — stdlib (scrml:) / vendor (vendor:)
        // get pulled in by their own consumers; .js imports are not gathered.
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        if (spec.endsWith(".js")) continue;
        const abs = resolveModulePath(spec, filePath);
        if (!abs.endsWith(".scrml")) continue;
        if (seen.has(abs)) continue;
        // Skip non-existent imports — MOD's existing E-IMPORT-006 check
        // handles them with precise span data; the gather pass's job is
        // to expand the working file set, not to validate.
        if (!existsSync(abs)) continue;
        seen.add(abs);
        queue.push(abs);
        if (seen.size > GATHER_LIMIT) {
          allErrors.push({
            stage: "GATHER",
            code: "E-IMPORT-007",
            severity: "error",
            message: `E-IMPORT-007: Auto-gather exceeded sane limit (${GATHER_LIMIT} files). ` +
              `Either use \`--no-gather\` and pass an explicit file list, or pass a directory ` +
              `root and let \`scanDirectory\` enumerate without graph traversal.`,
          });
          limitExceeded = true;
          break;
        }
      }
    }
    resolvedInputFiles = [...seen];
  }
  // Reassign inputFiles so the existing pipeline iterates the gathered set.
  inputFiles = resolvedInputFiles;


  function stage(name, fn) {
    const start = performance.now();
    const result = fn();
    const ms = (performance.now() - start).toFixed(1);
    if (verbose) log(`  [${name}] ${ms}ms`);
    return result;
  }

  function collectErrors(stageName, errors) {
    if (errors && errors.length > 0) {
      for (const e of errors) {
        allErrors.push({ stage: stageName, code: e.code, message: e.message, severity: e.severity, ...e });
        if (verbose) log(`  [${stageName}] ${e.code}: ${e.message}`);
      }
    }
  }

  const pipelineStart = performance.now();

  // ---------------------------------------------------------------------------
  // Ghost-error lint pre-pass (runs before Stage 2 / BS)
  // Non-fatal: diagnostics are returned in lintDiagnostics[], never in errors[].
  // The real compiler always runs regardless of lint findings.
  //
  // Also runs the W-TAILWIND-001 detector (SPEC §26.3, SPEC-ISSUE-012) which
  // surfaces class names in source whose shape suggests Tailwind variant or
  // arbitrary-value syntax but does not match the registered utility set.
  // ---------------------------------------------------------------------------
  const allLintDiagnostics = [];
  for (const inputFile of inputFiles) {
    try {
      const filePath = resolve(inputFile);
      const source = readFileSync(filePath, "utf8");
      const diags = lintGhostPatterns(source, filePath);
      for (const d of diags) {
        allLintDiagnostics.push({ ...d, filePath });
        if (verbose) log(`  [LINT] ${filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
      const tailwindDiags = findUnsupportedTailwindShapes(source);
      for (const d of tailwindDiags) {
        allLintDiagnostics.push({ ...d, filePath });
        if (verbose) log(`  [LINT] ${filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch {
      // Lint errors must not block compilation — silently skip unreadable files here
      // (BS will report the real read error below)
    }
  }

  // Stage 2: Block Splitter (per-file)
  // When selfHostModules.splitBlocks is provided, use it instead of the JS original.
  const _splitBlocks = selfHostModules?.splitBlocks ?? splitBlocks;
  const bsResults = [];
  const sourceByFile = new Map();
  for (const inputFile of inputFiles) {
    const filePath = resolve(inputFile);
    let source = readFileSync(filePath, "utf8");
    if (convertLegacyCss) {
      source = convertLegacyCssSource(source);
    }
    sourceByFile.set(filePath, source);
    try {
      const result = stage("BS", () => _splitBlocks(filePath, source));
      bsResults.push(result);
      collectErrors("BS", result.errors);
      if (verbose) log(`  [BS] ${filePath}: ${result.blocks.length} blocks`);
    } catch (e) {
      allErrors.push({ stage: "BS", code: e.code || "E-BS-000", message: e.message });
    }
  }

  if (bsResults.length === 0) {
    const errors = allErrors;
    const warnings = [];
    return { errors, warnings, lintDiagnostics: allLintDiagnostics, fileCount: 0, outputDir: outputDir || "", durationMs: 0, outputs: new Map() };
  }

  // Stage 3: TAB (per-file)
  // When selfHostModules.buildAST is provided, use it instead of the JS original.
  // The self-hosted buildAST bundles its own tokenizer, so no tokenizer override is needed.
  const _buildAST = selfHostModules?.buildAST
    ? (bsResult) => selfHostModules.buildAST(bsResult)
    : (bsResult) => buildAST(bsResult, selfHostModules?.tokenizer ?? null);
  const tabResults = [];
  // Keep bsResult alongside tabResult for the Gauntlet Phase 1 check pass
  // (some diagnostics need to inspect the raw block tree before TAB drops
  // stray top-level text blocks — e.g. `use` / `export` at file preamble).
  const bsByTab = new Map();
  for (let i = 0; i < bsResults.length; i++) {
    const bsResult = bsResults[i];
    const result = stage("TAB", () => _buildAST(bsResult));
    collectErrors("TAB", result.errors);
    // Attach source text for library-mode codegen (export-decl span extraction)
    if (result.filePath && sourceByFile.has(result.filePath)) {
      result._sourceText = sourceByFile.get(result.filePath);
    }
    tabResults.push(result);
    bsByTab.set(result, bsResult);
    if (verbose) log(`  [TAB] ${result.filePath}: ${result.ast?.nodes?.length ?? 0} nodes`);
  }

  // Stage 3.005 (GCP1): Gauntlet Phase 1 checks (§21, §41, §7.6) — runs before NR.
  // Post-TAB checks that catch spec-violating declarations silently accepted
  // by the main pipeline. Emits E-IMPORT-001, E-IMPORT-003, E-SCOPE-010,
  // E-USE-001, E-USE-002, E-USE-005. Cross-file / npm-style E-IMPORT-005 is
  // enforced in module-resolver.js instead (it needs the resolved graph).
  for (const tabResult of tabResults) {
    const bsResult = bsByTab.get(tabResult);
    const checkErrors = stage("GCP1", () => runGauntletPhase1Checks(bsResult, tabResult));
    collectErrors("GCP1", checkErrors);
  }

  // Stage 3.006 (GCP3): Gauntlet Phase 3 equality checks (§45) — runs before NR.
  // Post-TAB checks that catch equality-operator misuses silently accepted by
  // the main pipeline. Emits E-EQ-001, E-EQ-002, E-EQ-003, E-EQ-004,
  // E-SYNTAX-042, W-EQ-001. Repros live under
  //   samples/compilation-tests/gauntlet-s19-phase3-operators/
  // (triage: docs/changes/gauntlet-s19/phase3-bugs.md Cat A1–A8).
  for (const tabResult of tabResults) {
    const checkErrors = stage("GCP3", () => runGauntletPhase3EqChecks(tabResult));
    collectErrors("GCP3", checkErrors);
  }

  // Stage 3.1: Module Resolution
  // When selfHostModules.resolveModules is provided, use it instead of the JS original.
  const _resolveModules = selfHostModules?.resolveModules ?? resolveModules;
  const moduleResult = stage("MOD", () => _resolveModules(tabResults));
  collectErrors("MOD", moduleResult.errors);
  if (verbose) {
    const importCount = [...moduleResult.importGraph.values()].reduce((n, e) => n + e.imports.length, 0);
    const exportCount = [...moduleResult.exportRegistry.values()].reduce((n, e) => n + e.size, 0);
    log(`  [MOD] ${importCount} import(s), ${exportCount} export(s), order: ${moduleResult.compilationOrder.map(p => basename(p)).join(" -> ")}`);
  }

  // Stage 3.05 (NR): Name Resolution — SHADOW MODE in P1 per SPEC §15.15.6.
  // Walks every tag-bearing AST node and stamps resolvedKind/resolvedCategory.
  // Emits W-CASE-001 (lowercase user state-type shadowing HTML element) and
  // W-WHITESPACE-001 (whitespace after `<` in opener). Downstream stages still
  // route on the legacy `isComponent` discriminator in P1; the routing flip
  // moves to P2/P3.
  //
  // Why post-MOD instead of post-TAB: cross-file imported names need MOD's
  // exportRegistry to resolve. Same-file lookups would work pre-MOD too, but
  // a single post-MOD pass is simpler and well within the <5ms/file budget.
  const tabResultsForNR = tabResults
    .filter(r => r && r.ast)
    .map(r => ({ filePath: r.filePath, ast: r.ast }));
  const nrResults = stage("NR", () => runNRBatch(
    tabResultsForNR,
    moduleResult.exportRegistry,
    moduleResult.importGraph,
  ));
  for (const nr of nrResults) {
    // Errors from NR are warnings (W-CASE-001, W-WHITESPACE-001) and surface in
    // the standard warnings channel. Severity is preserved through the existing
    // collector.
    collectErrors("NR", nr.errors);
  }
  if (verbose) {
    let totalDiag = 0;
    for (const nr of nrResults) totalDiag += nr.errors.length;
    log(`  [NR] ${nrResults.length} file(s), ${totalDiag} diagnostic(s) (shadow mode)`);
  }

  // Stage 3.06 (SYM): Symbol Table — Phase A1b Step B1 foundational pass.
  // Walks every state-decl AST node and registers it into a per-scope state-cell
  // table. Constructs the scope tree (file / function / compound at B1; engine
  // and component scopes RESERVED for B14+/B17+). Mutates ASTs in place by
  // attaching `_record` to each state-decl and `_scope` to each scope-introducing
  // node + the FileAST root.
  //
  // B1 fires NO diagnostics — this is foundational infrastructure consumed by
  // B2-B22 (E-NAME-COLLIDES-STATE, @name resolution, validity-surface synthesis,
  // L21 walker, etc.). B2 onward populates SYMResult.errors[].
  //
  // Why post-NR rather than NR-extension: NR's responsibility is tag-bearing-
  // node classification (resolvedKind / resolvedCategory). State-cell scope
  // registration is a separate concern; folding into NR would muddle
  // separation. SYM consumes the same per-file AST NR produced; no MOD output
  // dependency at B1 (cross-file state-cell resolution lands in B4).
  // B4: passes moduleResult.exportRegistry so SYM can fire
  // E-IMPORT-PINNED-INVALID best-effort (Option A) on pinned imports of
  // function/fn/type/channel exports. const/let imports are accepted with
  // a documented B14 deferral (engine vs. arbitrary-const distinction is
  // not knowable today).
  const symResults = stage("SYM", () => runSYMBatch(tabResultsForNR, moduleResult.exportRegistry));
  for (const sym of symResults) {
    collectErrors("SYM", sym.errors);
  }
  if (verbose) {
    let totalRecords = 0;
    let totalScopes = 0;
    for (const sym of symResults) {
      totalRecords += sym.stats.totalRecords;
      totalScopes += sym.stats.totalScopes;
    }
    log(`  [SYM] ${symResults.length} file(s), ${totalRecords} state-cell record(s) across ${totalScopes} scope(s)`);
  }

  // Stage 3.2: CE — Component Expander (per-file)
  // Runs after TAB and Module Resolution, before BPP.
  // Builds a same-file component registry and replaces all isComponent: true
  // markup nodes with their expanded markup subtrees.
  // Phase 2: also resolves imported components via exportRegistry + fileASTMap.
  //
  // Build fileASTMap from tabResults BEFORE the CE loop — CE consumes ast.components
  // so the cross-file lookup must use the pre-CE AST.
  const fileASTMap = new Map();
  for (const tabResult of tabResults) {
    if (tabResult.filePath) {
      fileASTMap.set(tabResult.filePath, tabResult);
    }
  }

  const ceResults = [];
  for (const tabResult of tabResults) {
    const result = stage("CE", () => runCE({
      files: [tabResult],
      exportRegistry: moduleResult.exportRegistry,
      fileASTMap,
      importGraph: moduleResult.importGraph,
    }));
    collectErrors("CE", result.errors);
    // Re-attach source text for library-mode codegen (CE creates new file objects)
    for (const ceFile of result.files) {
      if (ceFile.filePath && sourceByFile.has(ceFile.filePath)) {
        ceFile._sourceText = sourceByFile.get(ceFile.filePath);
      }
    }
    ceResults.push(...result.files);
  }

  // Stage 3.3 — Post-CE Validators (Unified Validation Bundle / W1)
  // VP-2 — post-CE invariant: residual `isComponent: true` becomes a hard
  //        E-COMPONENT-035 instead of a silent phantom DOM emission.
  // VP-3 — attribute interpolation: `${...}` in non-interpolating attribute
  //        values (e.g. `<channel name=>`) becomes E-CHANNEL-007.
  // VP-1 — attribute allowlist: unknown attributes on scrml-special elements
  //        (or `auth="role:X"`) emit W-ATTR-001 / W-ATTR-002 (warnings).
  // Run all three on the post-CE AST set so downstream stages see consistent
  // diagnostics. Errors fail the run; warnings continue.
  const postCEResult = stage("VP-2", () => runPostCEInvariant({ files: ceResults }));
  collectErrors("VP-2", postCEResult.errors);

  const attrInterpResult = stage("VP-3", () => runAttributeInterpolation({ files: ceResults }));
  collectErrors("VP-3", attrInterpResult.errors);

  const attrAllowlistResult = stage("VP-1", () => runAttributeAllowlist({ files: ceResults }));
  collectErrors("VP-1", attrAllowlistResult.errors);

  // Stage 4: PA (all files)
  const _runPA = selfHostModules?.runPA ?? runPA;
  const paResult = stage("PA", () => _runPA({ files: ceResults }));
  collectErrors("PA", paResult.errors);
  if (verbose) {
    const viewCount = paResult.protectAnalysis?.views?.size ?? 0;
    log(`  [PA] ${viewCount} db block(s) analyzed`);
  }

  // Stage 5: RI (all files)
  const _runRI = selfHostModules?.runRI ?? runRI;
  const riResult = stage("RI", () => _runRI({ files: ceResults, protectAnalysis: paResult.protectAnalysis }));
  collectErrors("RI", riResult.errors);
  if (verbose) {
    const routeCount = riResult.routeMap?.functions?.size ?? 0;
    const authCount = riResult.routeMap?.authMiddleware?.size ?? 0;
    log(`  [RI] ${routeCount} function(s) routed, ${authCount} auth guard(s)`);
  }

  // Stage 6: TS (all files)
  // When selfHostModules.runTS is provided, use it instead of the JS original.
  const _runTS = selfHostModules?.runTS ?? runTS;

  // Build cross-file type map for TS — enables imported types in match exhaustiveness,
  // type annotations, and struct field access across .scrml file boundaries (§21.3).
  // Algorithm:
  //   1. Build a file-path → (CE-processed AST) lookup from ceResults
  //   2. For each importing file, gather its import declarations from the importGraph
  //   3. For each dependency, call buildTypeRegistry on its typeDecls to get resolved types
  //   4. Filter to only exported type names (from exportRegistry)
  //   5. Merge into the importing file's importedTypes map
  // This runs after CE so typeDecls are final (component-expander may hoist them).
  const ceFileMap = new Map();
  for (const f of ceResults) {
    if (f.filePath) ceFileMap.set(f.filePath, f);
  }

  const importedTypesByFile = new Map();

  // Memoize per-file typeRegistry builds — buildTypeRegistry is pure given
  // typeDecls, so caching by file path is safe and avoids repeated work when
  // many importers reach the same dep.
  const depRegistryCache = new Map(); // absSource → Map<name, ResolvedType>
  function getDepRegistry(absSource) {
    if (depRegistryCache.has(absSource)) return depRegistryCache.get(absSource);
    const depFile = ceFileMap.get(absSource);
    if (!depFile) {
      depRegistryCache.set(absSource, null);
      return null;
    }
    const depTypeDecls = depFile.typeDecls ?? depFile.ast?.typeDecls ?? [];
    if (depTypeDecls.length === 0) {
      depRegistryCache.set(absSource, new Map());
      return depRegistryCache.get(absSource);
    }
    const reg = buildTypeRegistry(depTypeDecls, [], { file: absSource, start: 0, end: 0, line: 1, col: 1 });
    depRegistryCache.set(absSource, reg);
    return reg;
  }

  /**
   * Resolve a type name through a dep's re-export chain.
   *
   * If `absSource` directly declares `typeName` (it appears in that file's
   * typeRegistry), return the resolved type.
   *
   * Otherwise, look at `absSource`'s graph-entry exports[] for a re-export
   * entry matching `typeName` and recurse into its `reExportSource`. Cycle-
   * break via `visited` (set of `${absSource}::${typeName}` keys).
   *
   * Returns null if no resolution found.
   */
  function resolveTypeThroughReExport(absSource, typeName, visited) {
    const key = `${absSource}::${typeName}`;
    if (visited.has(key)) return null;
    visited.add(key);

    // First, check this file's own type registry.
    const reg = getDepRegistry(absSource);
    if (reg && reg.has(typeName)) {
      const t = reg.get(typeName);
      if (t && t.kind !== 'unknown') return t;
    }

    // Otherwise, check this file's exports[] for a matching re-export entry.
    const depGraphEntry = moduleResult.importGraph.get(absSource);
    if (!depGraphEntry || !depGraphEntry.exports) return null;

    for (const exp of depGraphEntry.exports) {
      if (exp.name !== typeName) continue;
      if (!exp.reExportSource) continue;
      // Recurse: chase the chain.
      const found = resolveTypeThroughReExport(exp.reExportSource, typeName, visited);
      if (found) return found;
    }

    return null;
  }

  for (const [filePath, graphEntry] of moduleResult.importGraph) {
    if (!graphEntry.imports || graphEntry.imports.length === 0) continue;

    const importedTypes = new Map();
    for (const imp of graphEntry.imports) {
      const depExports = moduleResult.exportRegistry.get(imp.absSource);
      if (!depExports) continue; // dep not in compile set
      const importedNames = imp.names ?? [];

      // Direct path: dep declares the type itself in its typeDecls.
      const depRegistry = getDepRegistry(imp.absSource);
      if (depRegistry) {
        for (const [typeName, resolvedType] of depRegistry) {
          if (resolvedType.kind === 'unknown') continue;
          const isExported = depExports.has(typeName);
          const isImported = importedNames.length === 0 || importedNames.includes(typeName);
          if (isExported && isImported) {
            importedTypes.set(typeName, resolvedType);
          }
        }
      }

      // Re-export chase: for each requested name not yet seeded, walk the dep's
      // exports[] re-export chain. This makes `import { X } from 'scrml:pkg'`
      // resolve when pkg/index.scrml does `export { X } from './nested.scrml'`.
      // Handles multi-hop chains (a → b → c) via recursion. Renamed re-exports
      // (`export { X as Y }`) and `export *` are out of scope — the TAB regex
      // does not currently parse them; add when grammar grows.
      for (const name of importedNames) {
        if (importedTypes.has(name)) continue;
        if (!depExports.has(name)) continue;
        const visited = new Set();
        const resolved = resolveTypeThroughReExport(imp.absSource, name, visited);
        if (resolved) {
          importedTypes.set(name, resolved);
        }
      }
    }

    if (importedTypes.size > 0) {
      importedTypesByFile.set(filePath, importedTypes);
    }
  }

  const tsResult = stage("TS", () => _runTS({
    files: ceResults,
    protectAnalysis: paResult.protectAnalysis,
    routeMap: riResult.routeMap,
    importedTypesByFile,
  }));
  collectErrors("TS", tsResult.errors);

  // S66 promote-bridge: if an external caller has set the typed-AST capture
  // hook on globalThis (Symbol.for('__SCRML_PROMOTE_TS_CAPTURE__')), stash
  // tsResult.files there. Used by `bun scrml promote --match` to walk the
  // typed-AST without re-architecting the api. Non-invasive: no caller sees
  // any change unless they explicitly opt in by setting the capture symbol.
  try {
    const captureKey = Symbol.for("__SCRML_PROMOTE_TS_CAPTURE__");
    if (globalThis[captureKey] && typeof globalThis[captureKey] === "object") {
      globalThis[captureKey].files = tsResult.files ?? null;
    }
  } catch { /* no-op */ }

  // Stage 6.4: I-MATCH-PROMOTABLE info-level lint (SPEC §56)
  // Walks the typed-AST and emits info diagnostics for if-else chains over
  // enum-typed state cells that are mechanically promotable to <match>.
  // Non-fatal — diagnostics flow into allLintDiagnostics, never errors.
  // Pairs with `bun scrml promote --match`.
  if (tsResult.stateTypeRegistry && Array.isArray(tsResult.files) && tsResult.files.length > 0) {
    try {
      const matchPromotableDiags = runIMatchPromotable(tsResult.files, tsResult.stateTypeRegistry);
      for (const d of matchPromotableDiags) {
        allLintDiagnostics.push(d);
        if (verbose) log(`  [LINT] ${d.filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      // Lint must not block compilation under any circumstance.
      if (verbose) log(`  [LINT] I-MATCH-PROMOTABLE pass threw: ${e?.message ?? String(e)}`);
    }
  }

  // Stage 6.5: META — Meta Check + Eval (merged MC+ME, runs before DG)
  // MC validates phase separation (E-META-001) and reflect() calls (E-META-003).
  // ME evaluates compile-time ^{} blocks with emit() and splices results into AST.
  // Combined so DG sees the post-meta-expansion AST.
  // When selfHostModules.runMetaChecker is provided, use it instead of the JS original.
  const metaFiles = tsResult.files || ceResults;
  const _runMetaChecker = selfHostModules?.runMetaChecker ?? runMetaChecker;
  const mcResult = stage("MC", () => _runMetaChecker({ files: metaFiles }));
  collectErrors("MC", mcResult.errors);
  const metaEvalResult = stage("ME", () => runMetaEval({ files: metaFiles }));
  collectErrors("ME", metaEvalResult.errors);

  // Stage 7: DG (all files — sees post-meta-expansion AST)
  // When selfHostModules.runDG is provided, use it instead of the JS original.
  const _runDG = selfHostModules?.runDG ?? runDG;
  const dgResult = stage("DG", () => _runDG({
    files: metaFiles,
    routeMap: riResult.routeMap,
  }));
  collectErrors("DG", dgResult.errors);

  // Stage 7.5: Batch Planner (§8.9 / §8.10 / §8.11) — consumes the
  // finalized, lift-checked DG and produces a BatchPlan for CG.
  const bpResult = stage("BP", () => runBatchPlanner({
    files: metaFiles,
    depGraph: dgResult.depGraph,
    routeMap: riResult.routeMap,
    protectAnalysis: paResult.protectAnalysis,
  }));
  collectErrors("BP", bpResult.errors);

  // When selfHostModules.bpp is provided, override BPP functions in parser-workarounds.
  if (selfHostModules?.bpp) setBPPOverrides(selfHostModules.bpp);

  // Stage 8: CG (all files)
  // When selfHostModules.runCG is provided, use it instead of the JS original.
  const _runCG = selfHostModules?.runCG ?? runCG;
  const cgResult = stage("CG", () => _runCG({
    files: metaFiles,
    routeMap: riResult.routeMap,
    depGraph: dgResult.depGraph,
    protectAnalysis: paResult.protectAnalysis,
    batchPlan: bpResult.batchPlan,
    batchPlannerErrors: bpResult.errors,
    embedRuntime,
    sourceMap,
    mode,
    emitMachineTests,
    // C15 — pass MOD's exportRegistry so codegen can identify cross-file
    // engine mount sites (`<engineVarName/>` resolving to `category: "engine"`)
    // and emit the §21.8 mount-position marker per SPEC §51.0.D.
    exportRegistry: moduleResult.exportRegistry,
  }));
  collectErrors("CG", cgResult.errors);

  const durationMs = parseFloat((performance.now() - pipelineStart).toFixed(1));

  // ---------------------------------------------------------------------------
  // Stdlib bundling (OQ-2 — runtime resolution of `scrml:*` imports)
  //
  // Identify referenced stdlib specifiers from the TAB pass and copy a hand-
  // written shim per name into <outputDir>/_scrml/<name>.js. Emitted JS is
  // post-rewritten further down so each `import { ... } from "scrml:NAME"`
  // becomes `import { ... } from "./_scrml/NAME.js"` (relative to the
  // emitting file's location in the output tree).
  // ---------------------------------------------------------------------------
  const stdlibSpecifiers = collectStdlibSpecifiers(tabResults);
  const bundledStdlib = (write && outputDir)
    ? bundleStdlibForRun(stdlibSpecifiers, outputDir, verbose ? log : null)
    : new Set();

  // ---------------------------------------------------------------------------
  // Write output files
  // ---------------------------------------------------------------------------

  let fileCount = 0;

  if (write && outputDir) {
    mkdirSync(outputDir, { recursive: true });

    // In browser mode, write the shared runtime file (not needed in library mode)
    if (mode !== 'library' && cgResult.runtimeJs && cgResult.runtimeFilename) {
      writeFileSync(join(outputDir, cgResult.runtimeFilename), cgResult.runtimeJs);
      if (verbose) log(`  [CG] Wrote shared runtime: ${cgResult.runtimeFilename}`);
    }

    if (cgResult.outputs) {
      // F-COMPILE-001 Option A: preserve source-tree structure in dist/.
      // Compute the longest common directory prefix across all input files;
      // each output is written at outputDir + (filePath relative to that base).
      // Single-file invocation reduces to dirname(file) → flat output (unchanged).
      const sourcePaths = [...cgResult.outputs.keys()];
      const outputBaseDir = computeOutputBaseDir(sourcePaths);

      // F-COMPILE-001 Option B: pre-write collision detection.
      // After Option A this is a backstop — collisions are nearly impossible
      // unless two source files have literally identical absolute paths AND
      // the same basename, but we still guard against it for defense-in-depth
      // (and to catch any future flag/refactor that re-introduces flattening).
      // E-CG-015 is the spec-reserved code (§47.9, added by F-COMPILE-001).
      const writtenPaths = new Map(); // absDistPath → sourceFilePath that wrote it

      function pathFor(filePath, suffix) {
        // Compute the dist-relative directory + basename for this source file.
        // outputBaseDir is guaranteed non-null here because cgResult.outputs is non-empty.
        const base = basename(filePath, ".scrml");
        const relDir = dirname(relative(outputBaseDir, filePath));
        // relative() may yield "." for files at outputBaseDir itself.
        const targetDir = (relDir === "." || relDir === "") ? outputDir : join(outputDir, relDir);
        return { targetDir, base, fullPath: join(targetDir, `${base}${suffix}`) };
      }

      function writeOutput(filePath, suffix, contents) {
        const { targetDir, fullPath } = pathFor(filePath, suffix);
        const prior = writtenPaths.get(fullPath);
        if (prior !== undefined && prior !== filePath) {
          // Distinct source files compute to the same dist path.
          // Hard error per §47.9 / §10.10 default. Refuse to overwrite.
          allErrors.push({
            stage: "CG",
            code: "E-CG-015",
            message:
              `E-CG-015: conflicting output paths — ` +
              `\`${prior}\` and \`${filePath}\` both compile to \`${fullPath}\`. ` +
              `Rename one of the source files or invoke the compiler on a smaller input set.`,
            file: filePath,
            severity: "error",
          });
          return false;
        }
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(fullPath, contents);
        writtenPaths.set(fullPath, filePath);
        return true;
      }

      for (const [filePath, output] of cgResult.outputs) {
        // GITI-009 + OQ-2: post-codegen rewrites for emitted JS.
        //   - rewriteRelativeImportPaths: ./*.js relative imports point at
        //     the source-tree path (so output JS resolves correctly when
        //     output dir != source dir).
        //   - rewriteStdlibImports: scrml:NAME specifiers point at the
        //     bundled <outputDir>/_scrml/NAME.js shim, with the relative
        //     path computed from the file's actual targetDir (which may be
        //     nested under outputDir per F-COMPILE-001 Option A).
        if (output.serverJs) {
          const { targetDir } = pathFor(filePath, ".server.js");
          let s = rewriteRelativeImportPaths(output.serverJs, filePath, outputDir);
          s = rewriteStdlibImports(s, targetDir, outputDir, bundledStdlib);
          if (writeOutput(filePath, ".server.js", s)) fileCount++;
        }
        if (mode === 'library') {
          // Library mode: write libraryJs as <base>.js (importable ES module)
          if (output.libraryJs) {
            const { targetDir } = pathFor(filePath, ".js");
            let s = rewriteRelativeImportPaths(output.libraryJs, filePath, outputDir);
            s = rewriteStdlibImports(s, targetDir, outputDir, bundledStdlib);
            if (writeOutput(filePath, ".js", s)) fileCount++;
          }
        } else {
          // Browser mode: write clientJs as <base>.client.js + html
          if (output.clientJs) {
            // Client JS does not currently get GITI-009 relative-path rewrites
            // (no existing test asserts that contract for client output) but
            // it MUST get scrml:NAME rewrites — Bun fails to resolve any
            // unresolved scrml:* in browser-loaded JS just as in server JS.
            const { targetDir } = pathFor(filePath, ".client.js");
            const c = rewriteStdlibImports(output.clientJs, targetDir, outputDir, bundledStdlib);
            if (writeOutput(filePath, ".client.js", c)) fileCount++;
          }
          if (output.html) {
            if (writeOutput(filePath, ".html", output.html)) fileCount++;
          }
        }
        if (output.css) {
          if (writeOutput(filePath, ".css", output.css)) fileCount++;
        }
        // Source map files (only written when sourceMap:true was passed to compileScrml)
        if (output.clientJsMap) {
          if (writeOutput(filePath, ".client.js.map", output.clientJsMap)) {
            const { base } = pathFor(filePath, ".client.js.map");
            if (verbose) log(`  [CG] Wrote source map: ${base}.client.js.map`);
          }
        }
        if (output.serverJsMap) {
          if (writeOutput(filePath, ".server.js.map", output.serverJsMap)) {
            const { base } = pathFor(filePath, ".server.js.map");
            if (verbose) log(`  [CG] Wrote source map: ${base}.server.js.map`);
          }
        }
        // §51.13 — auto-generated machine property tests
        if (output.machineTestJs) {
          if (writeOutput(filePath, ".machine.test.js", output.machineTestJs)) {
            fileCount++;
            const { base } = pathFor(filePath, ".machine.test.js");
            if (verbose) log(`  [CG] Wrote machine property tests: ${base}.machine.test.js`);
          }
        }
      }
    }
  } else if (!write && cgResult.outputs) {
    // Still count outputs even when not writing
    for (const [, output] of cgResult.outputs) {
      if (output.serverJs) fileCount++;
      if (output.clientJs) fileCount++;
      if (output.libraryJs) fileCount++;
      if (output.html) fileCount++;
      if (output.css) fileCount++;
    }
  }

  const errors = allErrors.filter(e => !e.code?.startsWith("W-") && e.severity !== "warning");
  const warnings = allErrors.filter(e => e.code?.startsWith("W-") || e.severity === "warning");

  return {
    errors,
    warnings,
    lintDiagnostics: allLintDiagnostics,
    fileCount,
    outputDir: outputDir || "",
    durationMs,
    outputs: cgResult.outputs || new Map(),
    // W2 §21.7: the full gathered .scrml file set (after auto-gather pre-pass).
    // Equal to options.inputFiles when gather is disabled. Includes all
    // transitively-reachable .scrml files when gather is enabled.
    gatheredFiles: inputFiles,
    batchPlan: bpResult.batchPlan,
    batchPlanJson: () => serializeBatchPlan(bpResult.batchPlan),
  };
}
