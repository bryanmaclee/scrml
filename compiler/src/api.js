/**
 * @module api
 * scrml compiler — programmatic API.
 *
 * Exports the full BS→TAB→CE→BPP→PA→RI→TS→MC→DG→CG pipeline as a reusable
 * function so that CLI commands, test suites, watch loops, and language
 * servers can all drive compilation without spawning a subprocess.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, lstatSync, existsSync, copyFileSync } from "fs";
import { resolve, extname, dirname, basename, join, relative } from "path";
import { fileURLToPath } from "url";
import { splitBlocks } from "./block-splitter.js";
import { buildAST } from "./ast-builder.js";
import { nativeParseFile } from "../native-parser/parse-file.js";
import { populateNativeAttrValueExprNodes } from "./native-walker/attrvalue-exprnode-walker.ts";
import { backfillNativeExprText } from "./native-walker/exprtext-backfill-walker.ts";
import { computePGOFlags } from "./compute-pgo-flags.ts";
import { computeProgramConfig } from "./compute-program-config.ts";
import { runCE } from "./component-expander.ts";
import { runPostCEInvariant } from "./validators/post-ce-invariant.ts";
import { runAttributeInterpolation } from "./validators/attribute-interpolation.ts";
import { runAttributeAllowlist } from "./validators/attribute-allowlist.ts";

import { runPA } from "./protect-analyzer.ts";
import { runRI, buildFunctionIndex, isServerOnlyScrmlModuleSource } from "./route-inference.ts";
import { analyzeMonotonicity } from "./monotonicity-analyzer.ts";
import { resolveIdempotencyStore, extractDbDriverFromValue } from "./idempotency-store-resolver.ts";
import { runTS, buildTypeRegistry } from "./type-system.ts";
import { runMetaChecker } from "./meta-checker.ts";
import { runDG } from "./dependency-graph.ts";
import { isForeignLangLibDecl } from "./library-shape.js";
import { runBatchPlanner, serializeBatchPlan } from "./batch-planner.ts";
import { runReachabilitySolver, serializeReachabilityRecord } from "./reachability-solver.ts";
import { buildEngineGraphJson } from "./engine-graph.ts";
import { buildBlockAnalysis } from "./block-analysis.ts";
import { buildTokenSet, serializeTokenSet } from "./token-set.ts";
import { runAuthGraph } from "./auth-graph.ts";
import { serializeChunksManifest } from "./codegen/route-splitter.ts";
import { buildMcpDescriptors } from "./codegen/mcp-descriptors.ts";
import { runCG } from "./code-generator.js";
import { generateValueOnlyServerJs } from "./codegen/emit-server.ts";
import { validateEmittedArtifacts } from "./codegen/validate-emit.ts";
import { detectSqlInConciseArrowBody } from "./codegen/detect-sql-in-arrow.ts";
import { checkCssConflicts } from "./codegen/css-conflict-check.ts";
import { stripPagesPrefix } from "./codegen/utils.ts";
import { runMetaEval } from "./meta-eval.ts";
import { resolveModules, resolveModulePath, resolveModulePathNative } from "./module-resolver.js";
import { PathKeyedMap, PathKeyedSet } from "./path-canonical.js";
import { runNRBatch } from "./name-resolver.ts";
import { runSYMBatch } from "./symbol-table.ts";
import { setBPPOverrides } from "./codegen/compat/parser-workarounds.js";
import { lintGhostPatterns } from "./lint-ghost-patterns.js";
import { runIMatchPromotable } from "./lint-i-match-promotable.js";
import { runIFnPromotable } from "./lint-i-fn-promotable.js";
import { runWEachPromotable } from "./lint-w-each-promotable.js";
import { runWEachKey } from "./lint-w-each-key.js";
import { runWMapIterationOrder } from "./lint-w-map-iteration-order.js";
import { runWInterpInRawContent } from "./lint-w-interp-in-raw-content.js";
import { runWInputStateMarkupNonreactive } from "./lint-w-input-state-markup-nonreactive.js";
import { findUnsupportedTailwindShapes, findUnrecognizedClasses } from "./tailwind-classes.js";
import { runGauntletPhase1Checks } from "./gauntlet-phase1-checks.js";
import { runGauntletPhase3EqChecks } from "./gauntlet-phase3-eq-checks.js";
import { runTryCatchLint } from "./validators/lint-try-catch.ts";
import { runAsyncAwaitReject } from "./validators/lint-async-user-source.ts";

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
// Import-specifier separator normalization (GitHub #18)
// ---------------------------------------------------------------------------

/**
 * Normalize an OS filesystem path fragment into an ES-module import SPECIFIER.
 *
 * A `path.relative()` result uses the HOST separator — `\` on Windows, `/` on
 * POSIX. But an import specifier is a URL, not a filesystem path: it is ALWAYS
 * `/`-separated on every OS. Embedding a `\` produces an invalid string escape
 * in the emitted `import ... from "<specifier>"` — e.g. `"./_scrml\process.js"`
 * collapses `\p` and resolves to `"./_scrmlprocess.js"` ("module not found"),
 * and `"..\sheets.js"` collapses to `"..sheets.js"`. So every relative()
 * result that lands in an emitted import specifier MUST pass through here first.
 *
 * OS-independent by construction: `\` is never a legal specifier separator, so
 * rewriting it to `/` is a no-op on POSIX (where relative() already yields `/`)
 * and the fix on Windows. Filesystem paths handed to fs/mkdir/writeFile are
 * deliberately NOT routed through here — those correctly use the OS separator.
 *
 * @param {string} p — a relative filesystem path fragment
 * @returns {string} — the same path with `\` separators rewritten to `/`
 */
export function toPosixSpecifier(p) {
  return typeof p === "string" ? p.replaceAll("\\", "/") : p;
}

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
// Directory names that never hold routable `.scrml` source — package deps and
// build output. Descending into them on a `scrml dev <dir>` causes a
// compile-storm; when a dependency is `bun link`ed, an unbounded walk through a
// symlinked sibling repo. Dot-dirs (`.git`, `.claude`, …) are skipped wholesale
// (see the dot-prefix guard in walk()).
const SCAN_SKIP_DIRS = new Set(["node_modules", "dist"]);

export function scanDirectory(dirPath) {
  const results = [];
  const absDir = resolve(dirPath);

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      // Skip dot-entries (.git, .claude, dotfiles) and known non-source dirs.
      if (entry.startsWith(".") || SCAN_SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      let stat;
      try {
        // lstatSync (NOT statSync): a symlinked directory is seen as a symlink,
        // not a directory, so we never follow it into a `bun link`ed dependency
        // tree (the scandir-storm bug, reported by scrml-site S154).
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && entry.endsWith(".scrml")) {
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
          // relPath is consumed by build.js/dev.js as an import SPECIFIER
          // (generateServerEntry: `import ... from "./${filename}"`), so it
          // must be `/`-separated on every OS (GitHub #18). absPath stays raw
          // for fs use.
          relPath: toPosixSpecifier(relative(absRoot, fullPath)),
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
 * path.
 *
 * For each name, also bundle any sub-module files that live in a directory
 * matching `name` (e.g., `scrml:oauth` umbrella file is bundled alongside
 * `_scrml/oauth/pkce.js`, `_scrml/oauth/google.js`, etc.) so the umbrella's
 * `import "./oauth/pkce.js"` lines resolve at runtime.
 *
 * If a referenced name has no shim file at all, the bundler emits a
 * `W-STDLIB-SHIM-MISSING` warning via the `diagnostics` array (when
 * supplied) and continues — the emitted JS retains the literal `scrml:NAME`
 * which will fail loudly at runtime. The warning lets adopters see the gap
 * at compile time and lets stdlib maintainers catch missing shims after a
 * new stdlib module lands.
 *
 * The `scrml:compiler` family (umbrella + `compiler/<stage>` siblings) is
 * special-cased per S121 Wave 7 Unit E (survey memo Option (d), formalized as
 * KNOWN-DEFERRED). For any `scrml:compiler` or `scrml:compiler/*` name, the
 * bundler emits `W-STDLIB-COMPILER-DEFERRED` (NOT `W-STDLIB-SHIM-MISSING`),
 * whether the thunk shim is on disk or not — the deferral is a property of
 * the surface, not a stdlib-author gap.
 *
 * @param {Set<string>} names — bare stdlib names (from collectStdlibSpecifiers)
 * @param {string} outputDir — absolute path of the user's output directory
 * @param {(msg: string) => void} [log]
 * @param {object[]} [diagnostics] — optional diagnostics sink; pushed
 *   `W-STDLIB-SHIM-MISSING` entries for each non-compiler name without a shim
 *   AND `W-STDLIB-COMPILER-DEFERRED` entries for each `scrml:compiler*` name
 *   referenced. Each entry matches the `allErrors`-array shape elsewhere in
 *   api.js.
 * @returns {Set<string>} — the subset of names that were actually bundled
 */
export function bundleStdlibForRun(names, outputDir, log, diagnostics) {
  const bundled = new Set();
  if (!names || names.size === 0 || !outputDir) return bundled;
  const stdlibOut = join(outputDir, "_scrml");
  let made = false;
  function ensureOut() {
    if (!made) {
      mkdirSync(stdlibOut, { recursive: true });
      made = true;
    }
  }
  function copyTree(srcDir, dstDir) {
    mkdirSync(dstDir, { recursive: true });
    for (const entry of readdirSync(srcDir)) {
      const s = join(srcDir, entry);
      const d = join(dstDir, entry);
      const stat = statSync(s);
      if (stat.isDirectory()) {
        copyTree(s, d);
      } else if (stat.isFile()) {
        copyFileSync(s, d);
      }
    }
  }

  // Crawl a just-copied shim's top-level relative-FILE imports and copy each
  // sibling shim file into `_scrml/` (recursively). Only same-directory and
  // subdir relative `.js` imports are followed; bare/absolute specifiers and
  // bun:/node: are left to the runtime resolver. Idempotent via `copiedFiles`.
  const copiedFiles = new Set();
  function copyTransitiveShimSiblings(shimSrcPath, shimName) {
    if (copiedFiles.has(shimSrcPath)) return;
    copiedFiles.add(shimSrcPath);
    let shimText;
    try {
      shimText = readFileSync(shimSrcPath, "utf8");
    } catch {
      return;
    }
    const srcDir = dirname(shimSrcPath);
    // Match top-level `import ... from "./x.js"` / `export ... from "../y.js"`.
    const RELATIVE_IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["'](\.[^"']+\.js)["']/g;
    let m;
    while ((m = RELATIVE_IMPORT_RE.exec(shimText)) !== null) {
      const rel = m[1];
      const depSrc = join(srcDir, rel);
      if (!existsSync(depSrc) || copiedFiles.has(depSrc)) continue;
      // Destination mirrors the dependency's path relative to STDLIB_RUNTIME_DIR
      // so a `./math.js` next to `time.js` lands at `_scrml/math.js`, and a
      // nested `./oauth/pkce.js` lands at `_scrml/oauth/pkce.js`.
      const relToRoot = relative(STDLIB_RUNTIME_DIR, depSrc);
      const depDst = join(stdlibOut, relToRoot);
      mkdirSync(dirname(depDst), { recursive: true });
      copyFileSync(depSrc, depDst);
      if (log) log(`  [STDLIB] Bundled transitive ${shimName} dep -> _scrml/${relToRoot}`);
      // Recurse so a dep's own deps are copied too.
      copyTransitiveShimSiblings(depSrc, shimName);
    }
  }

  // `scrml:compiler` family — KNOWN-DEFERRED per S121 Wave 7 Unit E survey
  // (docs/changes/bug-8-followup/scrml-compiler-shim-survey-s121-2026-05-22.md
  // Option (d)). The umbrella shim + its 13 per-stage siblings ship a deferred
  // thunk that throws at call time with W-STDLIB-COMPILER-DEFERRED attribution.
  // ANY `scrml:compiler` or `scrml:compiler/*` import fires this warning at
  // compile time, regardless of whether the thunk shim is on disk, so adopters
  // see the deferral BEFORE deploy instead of at runtime via a thrown Error.
  function isCompilerFamily(name) {
    return name === "compiler" || name.startsWith("compiler/");
  }
  function emitCompilerDeferred(name) {
    if (!Array.isArray(diagnostics)) return;
    diagnostics.push({
      code: "W-STDLIB-COMPILER-DEFERRED",
      message:
        `W-STDLIB-COMPILER-DEFERRED: scrml:${name} is currently deferred — `
        + `the bundled shim is a thunk that throws at call time with attribution. `
        + `The scrml:compiler family requires either an installable compiler package `
        + `or a compile-time path-rewriter for the bundled shim; neither is in scope yet. `
        + `For now, invoke the compiler via the CLI (\`scrml compile\`) or import directly `
        + `from compiler/src/api.js. See `
        + `docs/changes/bug-8-followup/scrml-compiler-shim-survey-s121-2026-05-22.md `
        + `+ SPEC §34 (W-STDLIB-COMPILER-DEFERRED) + §41.17.`,
      severity: "warning",
      stage: "STDLIB-BUNDLE",
      filePath: "",
      line: 1,
      column: 1,
    });
  }

  for (const name of names) {
    const isCompiler = isCompilerFamily(name);
    const src = join(STDLIB_RUNTIME_DIR, `${name}.js`);
    if (!existsSync(src)) {
      // No shim available. For the `scrml:compiler*` family, emit the
      // DEFERRED-flavored warning (not SHIM-MISSING) — the absence is by
      // design, not a stdlib-author gap. For every other name, emit the
      // canonical W-STDLIB-SHIM-MISSING so the gap is visible at compile time
      // (the emitted JS still carries the literal `scrml:NAME` import, which
      // fails loudly at runtime per `rewriteStdlibImports`'s
      // loud-failure-preserved contract).
      if (isCompiler) {
        emitCompilerDeferred(name);
      } else if (Array.isArray(diagnostics)) {
        diagnostics.push({
          code: "W-STDLIB-SHIM-MISSING",
          message:
            `W-STDLIB-SHIM-MISSING: scrml:${name} has no runtime shim — imports will fail at runtime. `
            + `Add compiler/runtime/stdlib/${name}.js.`,
          severity: "warning",
          stage: "STDLIB-BUNDLE",
          filePath: "",
          line: 1,
          column: 1,
        });
      }
      continue;
    }
    ensureOut();
    // If `name` has a `/` (sub-path like `oauth/google`), make sure the
    // intermediate dirs exist under `_scrml/` so copyFileSync doesn't ENOENT.
    if (name.includes("/")) {
      mkdirSync(join(stdlibOut, dirname(name)), { recursive: true });
    }
    const dst = join(stdlibOut, `${name}.js`);
    copyFileSync(src, dst);
    bundled.add(name);
    if (log) log(`  [STDLIB] Bundled scrml:${name} -> _scrml/${name}.js`);

    // If a sibling directory matching `name` exists (e.g. `oauth/` next to
    // `oauth.js`), copy its tree alongside so the umbrella shim's internal
    // imports (`import "./oauth/pkce.js"`) resolve at runtime.
    const subDir = join(STDLIB_RUNTIME_DIR, name);
    if (existsSync(subDir) && statSync(subDir).isDirectory()) {
      const dstSub = join(stdlibOut, name);
      copyTree(subDir, dstSub);
      if (log) log(`  [STDLIB] Bundled scrml:${name}/* -> _scrml/${name}/`);
    }

    // Transitive sibling-FILE imports (S176 — stdlib-ouroboros de-leak).
    // A shim may `import { x } from "./other.js"` a SIBLING shim file (not a
    // subdir): scrml:time -> ./math.js, scrml:oauth -> ./http.js + ./crypto.js.
    // Without copying those siblings, an adopter importing only the umbrella
    // shim (e.g. just `scrml:time`) gets a runtime "Cannot find module" because
    // the dependency was never copied into `_scrml/`. Crawl the just-copied
    // shim's top-level relative-file imports and copy each one (recursively),
    // so cross-shim runtime composition resolves regardless of co-import.
    // This also closes the pre-existing scrml:oauth latent gap (oauth.js
    // imports ./http.js + ./crypto.js, never copied when oauth is imported
    // alone). Subdir imports (`./oauth/pkce.js`) are already covered above.
    copyTransitiveShimSiblings(src, name);

    // For the `scrml:compiler*` family, also fire the DEFERRED warning even
    // when the thunk shim IS on disk — the deferral is a property of the
    // surface, not the shim's presence. Per the survey memo §4-5, every
    // `scrml:compiler*` import is a compile-time signal that the adopter is
    // reaching for a surface whose runtime is deliberately stubbed.
    if (isCompiler) {
      emitCompilerDeferred(name);
    }
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
export function rewriteRelativeImportPaths(jsCode, sourceFilePath, outputDir, emittedScrmlSources = null) {
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
      // F-COMPILE-001 Option A: a scrml-emitted library module (`<base>.js`)
      // mirrors the source tree at the SAME relative position as its `.scrml`
      // source, so the source-relative specifier is ALREADY correct for the
      // output tree and must NOT be relocated — the same rationale as the
      // `.server.js`/`.client.js` skip above, generalized to a bare-`.js`
      // library module (the §64 standalone-tool import case: `import { fn }
      // from "./lib.js"`). Skip ONLY when the `.js` corresponds to a `.scrml`
      // source THIS build actually compiled (`emittedScrmlSources`) — NOT any
      // filesystem basename coincidence. A genuinely vendored `./util.js` next
      // to an unrelated, uncompiled `./util.scrml` still relocates correctly.
      if (
        emittedScrmlSources &&
        emittedScrmlSources.has(absImportPath.replace(/\.js$/, ".scrml"))
      ) {
        return match;
      }
      // Compute the relative path from the output directory. This becomes an
      // emitted import specifier, so posix-normalize it (GitHub #18) — a raw
      // Windows `relative()` result would embed `\` and break the import.
      let newRelPath = toPosixSpecifier(relative(outDir, absImportPath));
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
    // GITI-018: tolerate leading indentation (only the FIRST library-mode
    // import is de-indented to column 0; subsequent imports retain source
    // indentation) and optional trailing whitespace. Capture group 1 is the
    // leading indent so it round-trips; the backreference for the closing
    // quote is now \3 because the indent group shifted the numbering.
    /^([ \t]*)(import\s+(?:\{[^}]*\}|[^\s]+)\s+from\s+)(["'])scrml:([A-Za-z0-9_-][A-Za-z0-9_/-]*)\3([ \t]*;?[ \t]*)$/gm,
    (match, indent, prefix, quote, name, semi) => {
      if (!bundled.has(name)) return match;
      const target = join(stdlibAbs, `${name}.js`);
      // This relative path becomes the emitted `scrml:NAME` -> `./_scrml/NAME.js`
      // import specifier, so posix-normalize it (GitHub #18).
      let rel = toPosixSpecifier(relative(writeDir, target));
      if (!rel.startsWith(".")) rel = "./" + rel;
      return `${indent}${prefix}${quote}${rel}${quote}${semi}`;
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
 * @param {boolean} [options.testMode]         — Phase A8 / A6-5 (S76). Emit `<base>.test.js` from `~{}` test blocks with `test-bind` dispatch hooks (SPEC §19.12.7). Default false; production builds bit-identical to A6-5-disabled (0-byte cost guarantee).
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
 *   outputs: Map<string,{serverJs?:string,clientJs?:string,libraryJs?:string,html?:string,css?:string,clientJsMap?:string,serverJsMap?:string,testJs?:string,machineTestJs?:string}>
 * }}
 */
export function compileScrml(options = {}) {
  let {
    inputFiles = [],
  } = options;
  // W5a (g-library-mode-sql-no-db-context, ss23) — `mode` is `let` so the
  // auto-detect-library pass below MAY flip the default 'browser' to 'library'
  // for a no-<program>, exports-bearing pure-fn module (SPEC §21.5). The flip
  // fires ONLY when the caller did NOT pass `mode` explicitly — an explicit
  // `mode:` (either 'browser' or 'library') is authoritative and never
  // overridden. `_modeWasExplicit` records that distinction.
  const _modeWasExplicit = options.mode !== undefined;
  let mode = options.mode ?? 'browser';
  const {
    verbose = false,
    convertLegacyCss = false,
    embedRuntime = false,
    write = true,
    sourceMap = false,
    emitMachineTests = false,
    /**
     * Phase A8 / A6-5 (S76): emit `<base>.test.js` from `~{}` test blocks
     * declared in source. Off by default (production builds bit-identical to
     * pre-A6-5 emission per SPEC §19.12.7 0-byte production cost guarantee).
     * Enable for `bun scrml compile --test app.scrml` flow that produces a
     * runnable bun:test file with `test-bind` dispatch hooks already wired.
     */
    testMode = false,
    /**
     * §20.6 (F4=A) — production build flag. When true, the location-
     * transparent `log()` builtin (§20.6) strips to ZERO bytes (the dev-only
     * convenience is removed from release artefacts; mirrors `test-bind`'s
     * 0-byte production guarantee, §19.12.7). Threaded to runCG. Default
     * false (development — `log()` is active).
     */
    production = false,
    /**
     * S91 A-4.1 — Opt-in flag for the per-route artifact splitter
     * (SPEC §40.9.7). When TRUE, runCG produces per-(EP, role, tier)
     * chunk descriptors AND a chunks.json manifest; the api.js write
     * loop writes one file per chunk under `<outputDir>/<route-path>/`
     * plus `<outputDir>/chunks.json`.
     *
     * Default `false` per OQ-A4-F (S91 ratification). Default-on at
     * the v0.3.0 cut release once A-4.1..A-4.7 have all landed.
     */
    emitPerRoute: _emitPerRouteOpt = false,
    /**
     * Q-OPEN-5 — Soft size budget (bytes) for `W-CG-CHUNK-LARGE`.
     * When unset (or non-positive), the route-splitter uses the
     * default `CHUNK_LARGE_SOFT_BUDGET_BYTES` (100 000). Surfaced via
     * the `--chunk-size-budget=<bytes>` CLI flag.
     */
    chunkSizeBudgetBytes,
    /**
     * PGO P1.5 (S102) — opt-in sub-stage instrumentation for profile-guided
     * optimization. When TRUE, CG/RS/DG emit sub-stage `[CG-EMIT name] Nms`,
     * `[RS-COMPONENT N] Nms`, `[DG-PER-FILE] / [DG-CROSS-FILE]` lines via the
     * existing `log` channel. Consumers wire in P1.1/P1.2/P1.3; this option
     * is the plumbing precondition. Default FALSE; zero overhead when unset.
     */
    debugPerf = false,
    log = console.log,
    selfHostModules = null,
    /**
     * S108 dogfood Bug 1 FLOOR fix — compiler-level lint suppression knobs.
     * Mirrors the spec-only `lint.*` config family declared at SPEC §28.
     * Recognized keys (values: "warn" / "off" — default per-knob below):
     *   lintTailwindUnrecognizedClass — W-TAILWIND-UNRECOGNIZED-CLASS
     *     (default "warn"; set "off" for adopters whose codebase relies on
     *      custom CSS class names — the lint produces acknowledged
     *      false positives there per SPEC §34 / §26.5).
     *   lintForeignUndeclaredCapability — W-FOREIGN-UNDECLARED-CAPABILITY
     *     (default fires; set "off" for the SPEC §28 knob
     *      `lint.foreign-undeclared-capability = off` — an author who genuinely
     *      wants an undeclared foreign scope suppresses the §23.5.5 presence-nudge).
     * Unknown keys are silently ignored. Adopters can pass
     * `{ compilerSettings: { lintTailwindUnrecognizedClass: "off" } }`
     * from a project-level config loader.
     */
    compilerSettings = {},
    /**
     * M5-swap C2 (v0.7) — `--parser=scrml-native` ROUTING flag. When set to
     * the literal "scrml-native", the per-file parse is ROUTED through the
     * native parser's `nativeParseFile` (compiler/native-parser/parse-file.js)
     * instead of the live BS+TAB (`splitBlocks` + `buildAST`) path; since
     * `nativeParseFile` returns the same `{ filePath, ast, errors }` shape,
     * every downstream stage runs unchanged and pipeline-agnostic. An
     * I-PARSER-NATIVE-SHADOW routing-confirmation info diagnostic is appended
     * to result.warnings. The flag is STRICTLY OPT-IN — a no-op when null /
     * undefined / any other value, in which case the live BS+TAB pipeline is
     * the unchanged default. Pre-C2 (M5.1) the flag was observability-only;
     * C2 swapped the no-op for real routing behind the same flag value.
     */
    parser = null,
    /**
     * Emitted-JS parse gate (Approach A — ratified S141; gate-emitted-js-parse-
     * invariant-2026-05-29). When TRUE, every final JS artifact (.client.js /
     * .server.js / library .js / per-route chunk / runtime chunk) is parsed by
     * the in-process Acorn after the post-codegen import rewrites; any artifact
     * that does not parse aborts the compile with E-CODEGEN-INVALID-LOGIC and NO
     * files are written (SPEC §2.2.1). Mirrors meta-eval.ts:reparseEmitted /
     * E-META-EVAL-002 for the final artifacts.
     *
     * DEFAULT ON (S142 gate-flip-and-residuals-2026-05-29). The gate is now a
     * compile-time invariant by default: a syntactically-invalid emit is a hard
     * error (exit 1, no files written), never a green build shipping broken JS.
     *   PERF admits always-on. Measured ~24 ms median to parse all 64 artifacts
     *   of the 8433-line trucking-dispatch reference app (>2x the SPEC §2.4
     *   4000-line target) in-process — far inside the §2.4 "< 1s" budget.
     *   The S141 ship was FLAG-GATED (default OFF) because the reference app +
     *   examples emitted genuinely-invalid-JS artifacts the gate correctly
     *   caught (the C10 compound-`if=(X is some && X != "")` lowering class +
     *   the C11 leaked `server {` block). The S142 tail fix-wave CLOSED the
     *   adopter-corpus surface (C10a/C10b/C11), and this S142 flip-wave CLOSED
     *   the 3 internal-self-host residuals that blocked the flip:
     *     (1) meta-checker multi-line ternary const-init — collectExpr
     *         STMT_KEYWORD boundary no longer breaks on a keyword used as an
     *         identifier operand in RHS context (ast-builder.js);
     *     (2) module-resolver escaped-backtick template — tokenizer
     *         readBacktickString now honors backslash escapes (tokenizer.ts);
     *     (3) nested `!{}` (R25-Bug-49 §5) — emitArmBody re-parses a nested
     *         guarded-expr through BS→TAB (emit-logic.ts);
     *   plus two cascade residuals the closed surface exposed (the
     *   `await await import()` double-await — expression-parser ImportExpression
     *   case — and the non-async `^{}` meta-effect wrapper — emit-logic.ts). The
     *   FULL test suite is GREEN with the gate ON (0 E-CODEGEN-INVALID-LOGIC).
     *   `--no-validate-emit` (compile/build/dev) is the OPERATIONAL escape that
     *   suppresses the gate's ENFORCEMENT for a build — it is NOT a relaxation
     *   of the §2.2.1 "SHALL NOT emit JS that fails to parse" invariant.
     */
    validateEmit = true,
  } = options;

  let { outputDir } = options;

  if (!outputDir && inputFiles.length > 0) {
    outputDir = join(dirname(inputFiles[0]), "dist");
  }

  // MCP V0 Sub-unit D (2026-05-25) — `<program mcp>` opt-in can auto-flip
  // emitPerRoute below (after PRECG identifies the attribute). Start from the
  // adopter-provided value (default false); override to true ONLY if a
  // <program mcp> attribute is detected during PRECG. Auto-activation is
  // surfaced in the compileScrml result + verbose log so adopters see what was
  // wired without being surprised by per-route splitting they didn't request.
  let emitPerRoute = _emitPerRouteOpt;
  let mcpAutoActivated = false;
  let mcpMode = null; // "dev-only" | "always" — set when auto-activated.

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
  // S78 audit fix: GATHER_LIMIT injectable via options.gatherLimit.
  // Default 5000 preserves prior behavior. Test fixtures pass small values
  // (e.g. gatherLimit: 5) to trigger E-IMPORT-007 cleanly without
  // synthesizing 5000+ .scrml files on disk. Adopter override path: a
  // future scrmlconfig setting can plumb through the same option.
  const GATHER_LIMIT = options.gatherLimit ?? 5000;
  let resolvedInputFiles = inputFiles.map(f => resolve(f));
  if (gatherEnabled && resolvedInputFiles.length > 0) {
    // Dedup KEY is separator-canonical (PathKeyedSet folds `\`↔`/`); the
    // compiled VALUE stays uniformly NATIVE — both the explicit entry seed
    // (`resolve(f)`) and each gathered file (`resolveModulePathNative`, NOT the
    // posix-keyed `resolveModulePath`). `filePath` must stay native everywhere
    // (public `outputs`-key contract; posix-folding it caused 474 fails), so
    // gather must not inject posix filePaths. Before this fix `seen` was a plain
    // native `Set` compared against the posix `resolveModulePath` result, so a
    // Windows entry file a SIBLING also imports missed the dedup and compiled
    // TWICE. Canonical membership + native values (via `queue`, not `[...seen]`)
    // fixes it while keeping the graph the sole posix-keyed layer.
    const seen = new PathKeyedSet();
    const queue = [];
    for (const f of resolvedInputFiles) {
      if (seen.has(f)) continue;
      seen.add(f);
      queue.push(f);
    }
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
        const abs = resolveModulePathNative(spec, filePath);
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
    resolvedInputFiles = queue;
  }
  // Reassign inputFiles so the existing pipeline iterates the gathered set.
  inputFiles = resolvedInputFiles;


  function stage(name, fn) {
    const start = performance.now();
    const result = fn();
    const ms = (performance.now() - start).toFixed(1);
    // PGO P1.2 — `--debug-perf` also surfaces the per-stage aggregate
    // (so [CG-EMIT] / [RS-COMPONENT] / [DG-PER-FILE] breakdowns have
    // their parent-stage [STAGE] comparison line in context).
    if (verbose || debugPerf) log(`  [${name}] ${ms}ms`);
    return result;
  }

  function collectErrors(stageName, errors, filePath = null) {
    if (errors && errors.length > 0) {
      for (const e of errors) {
        // Bug 3 fix (S107, 2026-05-19) — stamp filePath onto per-file stage
        // diagnostics so the CLI formatters (dev / build / compile) can
        // surface `path:line:col` per W-LINT-* convention. Pre-S107, [BS]
        // and [TAB] errors arrived at dev.js / build.js with no file-origin
        // info — adopters with 80+ files had to bisect by which dist HTML
        // was missing to localize the failing source. CGError-shape diagnostics
        // already carry `span.line` / `span.col`; this stamp closes the
        // file-attribution gap.
        const enriched = { stage: stageName, code: e.code, message: e.message, severity: e.severity, ...e };
        // Normalize: BSError (compiler/src/block-splitter.js) extends native
        // Error and stores its source-span as `bsSpan` rather than `span`
        // (because the parent class consumes `span` for stack-trace purposes
        // on some engines). Lift `bsSpan` → `span` here so downstream
        // formatters can read a single field uniformly across BS / TAB / NR /
        // SYM / CG / etc. CGError-shape diagnostics (used by most stages)
        // already store as `span` and pass through unchanged.
        if (!enriched.span && enriched.bsSpan) {
          enriched.span = enriched.bsSpan;
        }
        if (filePath) {
          if (!enriched.filePath) enriched.filePath = filePath;
          if (enriched.span && typeof enriched.span === "object" && !enriched.span.file) {
            enriched.span = { ...enriched.span, file: filePath };
          }
        }
        allErrors.push(enriched);
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
  // Also runs:
  //   - W-TAILWIND-001 detector (SPEC §26.3, SPEC-ISSUE-012) — class names
  //     in source whose shape suggests Tailwind variant or arbitrary-value
  //     syntax but does not match the registered utility set.
  //   - W-TAILWIND-UNRECOGNIZED-CLASS detector (S108 dogfood Bug 1 FLOOR fix,
  //     SPEC §26.5 / §34) — any class name in `class="..."` that does not
  //     resolve via the registered utility set. Covers typos, unsupported
  //     arbitrary values, and custom CSS classes (acknowledged false
  //     positives at floor level). Suppressible per-project via
  //     `compilerSettings.lintTailwindUnrecognizedClass = "off"`.
  // ---------------------------------------------------------------------------
  const lintTailwindUnrecognizedClass =
    compilerSettings.lintTailwindUnrecognizedClass ?? "warn";
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
      if (lintTailwindUnrecognizedClass !== "off") {
        const unrecognizedDiags = findUnrecognizedClasses(source);
        for (const d of unrecognizedDiags) {
          allLintDiagnostics.push({ ...d, filePath });
          if (verbose) log(`  [LINT] ${filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
        }
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
      collectErrors("BS", result.errors, filePath);
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

  // Stage 2.5: W-INTERP-IN-RAW-CONTENT info-level lint (SPEC §4.17).
  // A scrml-significant token (`${...}` / `<TagName>` / brace sigil) inside a
  // raw-content `<pre>` / `<code>` body passes through LITERALLY per §4.17 — the
  // body is a single raw text run by design. The §4.17 rule is correct; the
  // defect this lint closes is the SILENCE (an author writing `<pre>${board}</pre>`
  // ships broken output with zero signal — Flux dog-food S193). Runs over the
  // block-split AST (`bsResults`) since the raw body is a BS-captured text child.
  // Pushed through `collectErrors` so the `W-` prefix + `severity:"info"`
  // partition the diagnostic into `result.warnings` (non-fatal; CLI exit 0) —
  // never `result.errors`. The message steers to a non-raw wrapper
  // (`<div class='whitespace-pre'>`) or explicit escaping.
  try {
    const rawInterpDiags = runWInterpInRawContent(bsResults);
    for (const d of rawInterpDiags) {
      collectErrors("BS-LINT", [d], d.filePath || null);
    }
  } catch (e) {
    if (verbose) log(`  [LINT] W-INTERP-IN-RAW-CONTENT pass threw: ${e?.message ?? String(e)}`);
  }

  // Stage 2.5b: W-INPUT-STATE-MARKUP-NONREACTIVE info-level lint (SPEC §36.6).
  // An input-state `<#id>.field` read (`<keyboard>`/`<mouse>`/`<gamepad>`, §36)
  // placed inside a markup interpolation renders ONCE at mount with no reactive
  // subscription — §36.6 normative, ruled + ratified by-design (S210 + S219).
  // The render-once behavior is CORRECT and is NOT changed; the defect this lint
  // closes is the SILENCE (an author reaching for `${<#cursor>.x}` expecting live
  // coordinates gets a one-shot value with zero diagnostic). Runs over the
  // block-split AST (`bsResults`) alongside the sibling raw-content lint — a
  // markup `${...}` interp is a BS-captured `{ type: "logic" }` node. Conservative:
  // fires ONLY when the ref id matches a DECLARED input-state element (never the
  // reactive §6.7.7 `<request>` bridge) and NOT inside an `animationFrame` loop
  // (the §36.6 `@cell` bridge). Pushed through `collectErrors` so the `W-` prefix
  // + `severity:"info"` partition it into `result.warnings` (non-fatal; CLI exit
  // 0) — never `result.errors`. The message steers to the `@cell` bridge.
  try {
    const inputStateMarkupDiags = runWInputStateMarkupNonreactive(bsResults);
    for (const d of inputStateMarkupDiags) {
      collectErrors("BS-LINT", [d], d.filePath || null);
    }
  } catch (e) {
    if (verbose) log(`  [LINT] W-INPUT-STATE-MARKUP-NONREACTIVE pass threw: ${e?.message ?? String(e)}`);
  }

  // Stage 3: TAB (per-file)
  // When selfHostModules.buildAST is provided, use it instead of the JS original.
  // The self-hosted buildAST bundles its own tokenizer, so no tokenizer override is needed.
  //
  // M5-swap C2 (v0.7) — `--parser=scrml-native` ROUTING. When the opt-in flag
  // is set, the per-file parse is driven by the native parser's
  // `nativeParseFile` (compiler/native-parser/parse-file.js) INSTEAD of the
  // live BS+TAB (`splitBlocks` + `buildAST`) path. `nativeParseFile` returns
  // the SAME `{ filePath, ast: FileAST, errors }` shape `buildAST` returns, so
  // it drops into `tabResults` and every downstream stage (PRECG / GCP1 /
  // GCP3 / NR / RI / AG / CG) runs unchanged and pipeline-agnostic.
  //   - BS still runs above (its `bsResults` feed the GCP1 raw-block-tree
  //     check pass via `bsByTab`); the native path simply does not CONSUME
  //     the BS block-stream — it re-parses from the file source directly.
  //   - The flag is STRICTLY OPT-IN. `parser` defaults to `null`; for every
  //     caller that does not pass "scrml-native" the live BS+TAB path is the
  //     untouched default, which bounds this routing's blast radius.
  //   - `nativeParseFile` needs `(filePath, source)`; both are recoverable
  //     from the paired `bsResult` (`bsResult.filePath`) + `sourceByFile`.
  const useNativeParser = parser === "scrml-native";
  const _buildAST = useNativeParser
    ? (bsResult) => {
        // M5-swap — native attr-value `exprNode` population. `nativeParseFile`
        // builds markup attr values (`onclick=`/`if=`/`bind:`/props) WITHOUT the
        // `exprNode` field that codegen (emit-html.ts -> emit-event-wiring /
        // emit-control-flow / emit-bindings / ...) consumes; the LIVE path sets
        // it inline in ast-builder.js parseAttributes via safeParseExprToNodeGlobal.
        // Native-parser modules cannot import the live acorn-backed parser (it
        // would invert the self-host layering), so the population runs HERE on
        // the assembled native FileAST, reusing the SAME safeParseExprToNodeGlobal
        // with the SAME `(raw, span.start)` pairing the live path uses -> the
        // emitted ExprNode is byte-identical to live's. Parse diagnostics
        // (E-SQL-008 / E-RESET-NO-ARG) land in `result.errors` so `collectErrors`
        // picks them up exactly as the live path does. Native-path-ONLY; the
        // default pipeline is untouched.
        const result = nativeParseFile(
          bsResult.filePath,
          sourceByFile.get(bsResult.filePath) ?? "");
        if (result && result.ast) {
          if (Array.isArray(result.errors) === false) result.errors = [];
          populateNativeAttrValueExprNodes(
            result.ast, result.filePath || bsResult.filePath, result.errors);
          // M5-swap — native string-`.expr`/`.init`/`.condition` backfill. The
          // native make*/translate* builders set these legacy string fields empty
          // (carrying the structured exprNode/initExpr/condExpr sibling instead).
          // Codegen is migrated to the structured siblings, but the type-system's
          // lifecycle / bare-variant / enum-subset enforcement is regex-over-TEXT
          // (checkLifecycleBindingAccess's statementText reads node.expr/init/
          // condition) and is un-migrated. Backfill the string fields from the
          // structured siblings (round-tripped via emitStringFromTree) so those
          // text-passes see the expression. Inert for codegen (never overwrites a
          // non-empty string; consumers with the sibling keep reading it).
          // Native-path-ONLY; the default pipeline is untouched.
          backfillNativeExprText(result.ast);
        }
        return result;
      }
    : selfHostModules?.buildAST
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
    collectErrors("TAB", result.errors, result.filePath || bsResult.filePath);
    // issue #12 blast radius — a `?{}` SQL block inside a CONCISE / curried arrow
    // body (`(x) => ?{...}`, `(a)=>(b)=>{?{...}}`, `.map(x => ?{...})`) leaks as the
    // generic E-CODEGEN-INVALID-LOGIC (and, when the fn does not escalate to server,
    // into the CLIENT bundle — emit-server.ts never runs). Diagnose precisely here,
    // parser-agnostic + escalation-independent. BRACED-body arrows stay with the
    // emit-server.ts E-SQL-009 site (the concise gate keeps the two disjoint).
    collectErrors("CG", detectSqlInConciseArrowBody(result.ast, result.filePath || bsResult.filePath), result.filePath || bsResult.filePath);
    // Attach source text for library-mode codegen (export-decl span extraction)
    if (result.filePath && sourceByFile.has(result.filePath)) {
      result._sourceText = sourceByFile.get(result.filePath);
    }
    tabResults.push(result);
    bsByTab.set(result, bsResult);
    if (verbose) log(`  [TAB] ${result.filePath}: ${result.ast?.nodes?.length ?? 0} nodes`);
  }

  // Stage 3.004 (PRECG): pipeline-agnostic post-AST pre-codegen derivations.
  // Relocated S115 (DD #27 / F5 + F6 / Pivot 2) out of `ast-builder.js`'s
  // TAB-time FileAST assembly. Two pure passes run here so the M5 native
  // parser does not have to learn codegen-optimizer caches or program-config
  // extraction — whatever pipeline produced the AST, these passes run against
  // its top-level node stream:
  //   - `computePGOFlags` → the 4 PGO has* flags (hasResetExpr /
  //     hasEqualityExpr / hasChunkedMarkupTag / hasForStmt) consumed by
  //     `codegen/emit-client.ts:detectRuntimeChunks`.
  //   - `computeProgramConfig` → `authConfig` / `middlewareConfig` consumed by
  //     route-inference.ts (RI), auth-graph.ts (AG) and codegen.
  // Both passes MUTATE the FileAST (`tabResult.ast`) with the same field
  // names the original TAB-time computation used — every downstream consumer
  // reads the identical `fileAST.has*` / `fileAST.authConfig` /
  // `fileAST.middlewareConfig` slots, so no consumer changes. Runs after the
  // whole TAB loop and before GCP1 / RI / AG / CG — earliest post-AST seam.
  for (const tabResult of tabResults) {
    const fileAST = tabResult?.ast;
    if (!fileAST) continue;
    stage("PRECG", () => {
      const nodes = fileAST.nodes ?? [];
      const pgo = computePGOFlags(nodes);
      fileAST.hasResetExpr = pgo.hasResetExpr;
      fileAST.hasEqualityExpr = pgo.hasEqualityExpr;
      fileAST.hasChunkedMarkupTag = pgo.hasChunkedMarkupTag;
      fileAST.hasForStmt = pgo.hasForStmt;
      const cfg = computeProgramConfig(nodes);
      fileAST.authConfig = cfg.authConfig;
      fileAST.middlewareConfig = cfg.middlewareConfig;
      // MCP V0 Sub-unit D — stash <program mcp> opt-in result. Consumed by
      // the auto-activation pass below (which scans every fileAST after the
      // PRECG loop completes) to set emitPerRoute + emit a boot import in
      // the generated _server.js.
      fileAST.mcpConfig = cfg.mcpConfig;
    });
  }

  // ---------------------------------------------------------------------------
  // W5a (g-library-mode-sql-no-db-context, ss23) — auto-detect-library.
  //
  // SPEC §21.5: a `.scrml` file with NO `<program>` root whose top-level
  // content is exclusively declarations (it `export`s functions/types/consts)
  // is a pure-fn / library module — "library files, not pages". Such a file
  // SHALL compile in library mode (emit an importable ES module `<base>.js`,
  // no HTML, no browser client bundle, no runtime chunk) WITHOUT requiring the
  // explicit `--mode library` flag.
  //
  // The library shaping itself already exists (S145
  // library-mode-suppress-body-escalated-server-js / SPEC §12.6); W5a just
  // SETS the build-wide `mode` the existing codegen + write path already
  // honors. `mode` is build-wide (it drives both codegen/index.ts:runCG and
  // the api.js write loop), so we flip it iff EVERY input file is a pure-fn
  // module: a mixed build (any page / any `<program>`) stays browser. A bare
  // markup fragment with no exports is NOT a library (it has nothing to import)
  // — auto-detect keys on the §21.5 shape (no <program> + has exports).
  //
  // Guards:
  //   - fires only when `mode` was NOT passed explicitly (`_modeWasExplicit`);
  //     an explicit `mode:` (browser or library) is authoritative.
  //   - requires at least one input file (an empty build is left as 'browser').
  if (!_modeWasExplicit && mode === 'browser' && tabResults.length > 0) {
    const allPureFnModules = tabResults.every((tabResult) => {
      const fileAST = tabResult?.ast;
      if (!fileAST) return false;
      const nodes = fileAST.nodes ?? [];
      const exportsList = fileAST.exports ?? [];
      // §21.5 pure-fn-module shape: no <program> root, content is exclusively
      // declarations (no top-level markup node — after liftBareDeclarations
      // has wrapped bare decls into synthetic logic blocks), and the file
      // bears at least one export. Mirrors the `isPureModuleFile` predicate
      // in ast-builder.js (W-PROGRAM-001 suppression) + the export presence
      // that distinguishes an importable library from a bare fragment.
      return (
        fileAST.hasProgramRoot !== true &&
        nodes.length > 0 &&
        nodes.every((n) => n && (n.kind !== "markup" || isForeignLangLibDecl(n))) &&
        exportsList.length > 0
      );
    });
    if (allPureFnModules) {
      mode = 'library';
      if (verbose) {
        log(`  [MODE] auto-detected library mode (no <program>, exports-bearing pure-fn module — SPEC §21.5)`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // MCP V0 Sub-unit D — `<program mcp>` auto-activation pass.
  //
  // After PRECG has stamped each fileAST with mcpConfig (null when the file's
  // <program> markup lacks `mcp=`, an McpConfig {mode} when present), scan
  // every fileAST and decide whether the build is in MCP-enabled mode.
  //
  // Activation rule: if ANY fileAST has a non-null mcpConfig, the entire
  // build is MCP-enabled and emitPerRoute is auto-flipped on (so the four
  // descriptor sidecars + chunks.json reach disk; see SCOPING §3 Sub-unit A
  // gating). The "mode" wins is "always" > "dev-only" (if any fileAST asks
  // for "always", the boot in _server.js is unconditional; otherwise it
  // runtime-gates on NODE_ENV).
  //
  // The decision is single-program in practice today (typical scrml apps
  // have one top-level <program>); the fold-across-files shape future-proofs
  // for the multi-<program> / nested-<program> §43 case.
  //
  // When mcpAutoActivated && !_emitPerRouteOpt, surface an info log line so
  // adopters running with --verbose can see emitPerRoute was wired
  // implicitly — fewer footguns than a silent auto-flip per SCOPING risk 1.
  // ---------------------------------------------------------------------------
  let anyMcpMode = null;
  for (const tabResult of tabResults) {
    const fileAST = tabResult?.ast;
    if (!fileAST?.mcpConfig) continue;
    const m = fileAST.mcpConfig.mode;
    if (m === "always") {
      anyMcpMode = "always";
      break; // "always" wins; no need to keep folding.
    }
    if (anyMcpMode === null) anyMcpMode = m;
  }
  if (anyMcpMode !== null) {
    mcpAutoActivated = true;
    mcpMode = anyMcpMode;
    if (!emitPerRoute) {
      emitPerRoute = true;
      if (verbose) {
        log(`  [MCP] <program mcp> detected — auto-flipping --emit-per-route ON (mode: ${mcpMode})`);
      }
    } else if (verbose) {
      log(`  [MCP] <program mcp> detected (mode: ${mcpMode}); --emit-per-route already set`);
    }
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

  // Stage 3.007 (LINT-TRY-CATCH): W-TRY-CATCH-IN-SCRML-SOURCE — Phase 3a
  // regression guard. scrml's error model (§19.1) is values-not-exceptions:
  // there is NO try/catch and there are NO exceptions. Fires a warning on
  // every `try-stmt` AST node in scrml source so the safeCall / safeCallAsync
  // migration cannot silently regress. Runs post-TAB / post-Gauntlet so no
  // type-system or scope dependency is needed.
  for (const tabResult of tabResults) {
    const tryCatchDiags = stage("LINT-TRY-CATCH", () => runTryCatchLint(tabResult.ast));
    collectErrors("LINT-TRY-CATCH", tryCatchDiags);
  }

  // Stage 3.008 (REJECT-ASYNC-AWAIT): §19.9.8 language-wide standing rule —
  // scrml has NO `async`/`await`. Fires the three HARD codes on user source,
  // matching the native parser: E-ASYNC-NOT-IN-SCRML (`async function`/`fn`/
  // `() =>`), E-AWAIT-NOT-IN-SCRML (an `await` expr), E-FOR-AWAIT-NOT-IN-SCRML
  // (`for await ... of`). Two carve-outs are LOAD-BEARING: (1) §13.1 stdlib —
  // a `scrml:*` file's `async function` still compiles (Promise<T> signal to
  // the §13.2.1 auto-await classifier) and its boundary `await` is exempt;
  // (2) §19.9.8 JS-host boundary — `^{}` meta + `_{}` foreign subtrees are not
  // entered (`await import(...)` there is host JS). Runs post-LINT-TRY-CATCH,
  // before MOD/SYM, so `await p` surfaces the named code rather than a generic
  // E-SCOPE-001/E-CODEGEN-INVALID-LOGIC. (Migration 2026-07 — reverses the S89
  // Q5 `I-ASYNC-USER-SOURCE` info nudge; bryan-ratified §19.9.8 + user-voice
  // "no colored functions" are normative stated intent.)
  for (const tabResult of tabResults) {
    const asyncDiags = stage("REJECT-ASYNC-AWAIT", () => runAsyncAwaitReject(tabResult.ast));
    collectErrors("REJECT-ASYNC-AWAIT", asyncDiags);
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

  // ---------------------------------------------------------------------------
  // Stage 3.105 (STDLIB-EXPORT-SEED): augment exportRegistry with stdlib metadata
  //
  // S89 §13.2 Sub-Phase B Step 3 (2026-05-13). The auto-await classifier
  // (§13.2.1) needs to know whether `safeCallAsync` (and other stdlib exports)
  // declare `async function` to decide whether to emit `await` at call sites.
  // The stdlib `.scrml` source files declare the API surface canonically; the
  // runtime is the hand-written JS shim at `compiler/runtime/stdlib/<name>.js`
  // (bundled separately, not compiled). Auto-gathering stdlib `.scrml` files
  // through the FULL pipeline triggers SYM/TS host-global errors (TextEncoder,
  // Bun, etc.) because the stubs reference Bun built-ins.
  //
  // This pass parses each stdlib module's `.scrml` source TAB-only, extracts
  // the export-decl shape, and seeds `moduleResult.exportRegistry` for the
  // absolute stdlib file path. Downstream codegen (scheduling.ts /
  // emit-functions.ts) consults the registry via `isPromiseReturningStdlibFn`
  // to drive the auto-await classifier. SYM / TS / CG see no stdlib AST.
  //
  // Cost: O(N stdlib modules referenced) TAB passes per compile; only runs
  // for modules that the user actually imports (no eager full-stdlib scan).
  // Cached: each stdlib module is parsed at most once per `compileScrml` call.
  // ---------------------------------------------------------------------------
  stage("STDLIB-EXPORT-SEED", () => {
    // Collect unique stdlib import absolute paths from the import graph.
    const stdlibPaths = new Set();
    // jwt-auth-bypass (2026-07-11, HIGH) — the subset of stdlibPaths reached via
    // a SERVER-ONLY `scrml:*` import (`scrml:auth` / `scrml:crypto` / … and their
    // submodules). A re-export in one of these modules that cannot be resolved to
    // a terminal {kind, isAsync} MUST fail CLOSED (default async), never fail open
    // to sync — see the `_resolveStdlibExport` backstop below.
    const serverOnlyStdlibPaths = new Set();
    for (const [, entry] of moduleResult.importGraph) {
      for (const imp of entry.imports) {
        if (imp.source && imp.source.startsWith("scrml:") && imp.absSource && imp.absSource.endsWith(".scrml")) {
          stdlibPaths.add(imp.absSource);
          if (isServerOnlyScrmlModuleSource(imp.source)) {
            serverOnlyStdlibPaths.add(imp.absSource);
          }
        }
      }
    }
    if (stdlibPaths.size === 0) return null;

    // TAB-only parse cache — a stdlib file (and any re-export source it points
    // at) is parsed at most once per compile. Returns the file's export-decl
    // array, or null on missing-file / parse-failure (errors swallowed — this
    // is a best-effort registry-seed pass, not a diagnostic surface).
    const _seedParseCache = new Map();
    function _parseStdlibExports(absPath) {
      if (_seedParseCache.has(absPath)) return _seedParseCache.get(absPath);
      let out = null;
      if (existsSync(absPath)) {
        try {
          const src = readFileSync(absPath, "utf8");
          const bsOut = splitBlocks(absPath, src);
          const tabResult = buildAST(bsOut);
          if (tabResult && tabResult.ast) out = tabResult.ast.exports || [];
        } catch {
          out = null;
        }
      }
      _seedParseCache.set(absPath, out);
      return out;
    }

    // Issue #26 (P0 auth-bypass) — resolve a re-export chain to its TERMINAL
    // {kind, isAsync}. `scrml:auth` (index.scrml) re-exports the password/JWT
    // surfaces via `export { verifyPassword, hashPassword } from './password.scrml'`.
    // Pre-fix, the seed recorded such a name as an opaque `kind: "re-export"`
    // entry with NO `isAsync`, so `isPromiseReturningStdlibFn` (which demands
    // `kind` ∈ {function, fn} AND `isAsync === true`) mis-classified it as sync.
    // The compiler then left the `async` call UNAWAITED in server-fn bodies —
    // a truthy `Promise` accepted every password (auth bypass) and a
    // `${hashPassword(...)}` INSERT stored a stringified Promise. Chasing the
    // `reExportSource` (honoring `renames` for `export { x as y }`) recovers the
    // real function kind + async modifier declared at the source. Depth-capped
    // so a pathological / cyclic re-export chain cannot loop.
    function _resolveStdlibExport(absPath, localName, depth) {
      if (depth > 8) return null;
      const exports = _parseStdlibExports(absPath);
      if (!exports) return null;
      for (const exp of exports) {
        if (!exp.exportedName) continue;
        if (exp.exportKind === "re-export" && exp.reExportSource) {
          // Match the requested name against this re-export's exported names,
          // resolving `as`-renames to the SOURCE local name.
          let sourceLocal = null;
          if (Array.isArray(exp.renames)) {
            const hit = exp.renames.find(r => r && r.exported === localName);
            if (hit) sourceLocal = hit.local ?? hit.exported;
          } else {
            const namesList = exp.exportedName.split(",").map(s => s.trim()).filter(Boolean);
            if (namesList.includes(localName)) sourceLocal = localName;
          }
          if (sourceLocal == null) continue;
          const srcAbs = resolve(dirname(absPath), exp.reExportSource);
          return _resolveStdlibExport(srcAbs, sourceLocal, depth + 1);
        }
        const namesList = exp.exportedName.split(",").map(s => s.trim()).filter(Boolean);
        if (namesList.includes(localName)) {
          return { kind: exp.exportKind || "unknown", isAsync: !!exp.isAsync };
        }
      }
      return null;
    }

    for (const absPath of stdlibPaths) {
      if (moduleResult.exportRegistry.has(absPath)) continue; // already seeded (re-export inheritance)
      const astExports = _parseStdlibExports(absPath);
      if (!astExports) continue;
      // Build the per-name value map from the stdlib file's exports.
      const names = new Map();
      for (const exp of astExports) {
        if (!exp.exportedName) continue;
        // Handle comma-separated names per the buildImportGraph convention.
        const namesList = exp.exportedName.split(",").map(s => s.trim()).filter(Boolean);
        for (const name of namesList) {
          let kind = exp.exportKind || "unknown";
          let isAsync = !!exp.isAsync;
          // Re-export: chase the source module for the terminal kind + async
          // modifier so the auto-await classifier sees through it (Issue #26).
          if (exp.exportKind === "re-export" && exp.reExportSource) {
            let sourceLocal = name;
            if (Array.isArray(exp.renames)) {
              const hit = exp.renames.find(r => r && r.exported === name);
              if (hit) sourceLocal = hit.local ?? hit.exported;
            }
            const srcAbs = resolve(dirname(absPath), exp.reExportSource);
            const resolved = _resolveStdlibExport(srcAbs, sourceLocal, 1);
            if (resolved) {
              kind = resolved.kind;
              isAsync = resolved.isAsync;
            } else if (serverOnlyStdlibPaths.has(absPath)) {
              // jwt-auth-bypass (2026-07-11, HIGH) — FAIL CLOSED. The re-export
              // could NOT be resolved to a terminal {kind, isAsync} (missing /
              // unparseable source, a name-not-found, or a splitter regression
              // that dropped the source export). This re-export lives in a
              // SERVER-ONLY `scrml:*` module, so silently defaulting to sync
              // (isAsync:false) is the FAIL-OPEN that leaks an un-awaited Promise
              // from a server-only auth/crypto call → the accept-all auth bypass
              // (issue #26 class). Default to async (`function` + isAsync:true) so
              // emit-server AWAITS the call. Awaiting a non-Promise is a harmless
              // no-op (`await x` ⟶ x); NOT awaiting a Promise is the vulnerability.
              // A hard E-STDLIB-SEED diagnostic would also close it, but a robust
              // silent fail-closed keeps a transient stdlib parse hiccup from
              // breaking the build while never leaking the Promise.
              kind = "function";
              isAsync = true;
              allErrors.push({
                stage: "STDLIB-EXPORT-SEED",
                code: "W-STDLIB-SEED-FAILCLOSED",
                severity: "warning",
                message:
                  `W-STDLIB-SEED-FAILCLOSED: server-only re-export \`${name}\` ` +
                  `(re-exported from \`${exp.reExportSource}\` in ${absPath}) could not ` +
                  `be resolved to a terminal {kind, isAsync}. Defaulting to async ` +
                  `(fail-closed) so the server auto-await classifier awaits it — an ` +
                  `un-awaited Promise from a server-only call is the issue #26 auth-` +
                  `bypass class. Check the re-export source module compiles cleanly.`,
              });
            }
          }
          let category;
          if (kind === "channel") category = "channel";
          else if (kind === "type") category = "type";
          else if (kind === "function" || kind === "fn") category = "function";
          else if (kind === "const") category = "const";
          else category = "other";
          const isComponent = kind === "const" && name.length > 0 &&
            name[0] >= "A" && name[0] <= "Z";
          names.set(name, {
            kind,
            category,
            isComponent,
            ...(isAsync ? { isAsync: true } : {}),
          });
        }
      }
      if (names.size > 0) {
        moduleResult.exportRegistry.set(absPath, names);
      }
    }
    return null;
  });

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
    // NR emits both warnings (W-CASE-001, W-WHITESPACE-001 — non-fatal, surface
    // in the warnings channel) and the fatal E-MARKUP-001 (SPEC §4.1 — unknown
    // HTML element name). Each diagnostic carries its own `severity`, which
    // collectErrors preserves; the final result partition routes E-MARKUP-001
    // (E- prefix / severity:"error") into result.errors and the W-* into
    // result.warnings.
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
  // PathKeyedMap: SET with the native `tabResult.filePath`, GET inside CE
  // (component-expander) with the posix `absSource` lookupKey — the boundary
  // bridges the two so cross-file COMPONENT expansion resolves on Windows (else
  // E-COMPONENT-035: the imported component's AST isn't found → survives CE).
  const fileASTMap = new PathKeyedMap();
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

  // Stage 3.4: CSS-CONFLICT — the §65.2 flat-specificity conflict checker.
  // The styling analog of an exhaustive `match`: an UNCONDITIONAL same-property
  // overlap on a provably-shared element, between two component-scope `#{}`
  // selector rules at the same precedence level, is `E-STYLE-CONFLICT` (hard) —
  // scrml deletes specificity (§65.2), so the compiler refuses to silently pick
  // a winner. The fail-closed residue (unprovable pairs, dynamic markup, and the
  // program-level escape hatch) is the soft, non-blocking `W-STYLE-CONFLICT-POSSIBLE`.
  //
  // Runs on the POST-CE AST so `collectCssBlocks` tags component-scoped blocks
  // (`_componentScope`) reliably (E-COMPONENT-021 fixed). Implements the three
  // ratified Wave-1 calibration carve-outs (§65.2.4 R1–R3): R1 universal-`*` /
  // bare-root rules layer (no fire); R2 class×class base+modifier is soft in
  // Wave 1 (hard deferred to Wave-2 `style=[a,b]`); R3 program-scope soft is
  // FILE-BOUNDED (fire only on a provable local overlap — never the 2941-warning
  // unbounded firehose). Pushed through `collectErrors` so the `E-`/`W-` prefix +
  // severity partition `E-STYLE-CONFLICT` into `result.errors` (fatal) and
  // `W-STYLE-CONFLICT-POSSIBLE` into `result.warnings` (non-fatal). Wrapped in
  // try/catch — a styling-analysis defect must never crash a valid compile.
  for (const ceFile of ceResults) {
    try {
      const cssConflictDiags = checkCssConflicts(ceFile);
      for (const d of cssConflictDiags) {
        collectErrors("CSS-CONFLICT", [d], d.filePath || ceFile.filePath || null);
        if (verbose) log(`  [CSS-CONFLICT] ${d.filePath}:${d.line} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      if (verbose) log(`  [CSS-CONFLICT] pass threw: ${e?.message ?? String(e)}`);
    }
  }

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

  // Stage 5.5: MC — Monotonicity Classifier (A9 Ext 5; SPEC §19.9.6).
  // Per S76 dispatch overlay: classify every CPS-eligible server batch as
  // monotone | non-monotone | machine-intrinsic. Verdict attaches to
  // route.cpsSplit.monotonicity (in-place mutation, the only side effect).
  // Channel-server-fns are SKIPPED per §19.9.6 channel-skip note — built into
  // fnNodes filter below by excluding any function-decl reachable inside a
  // <channel> markup body.
  stage("MC", () => {
    // Build fnNodes map: functionNodeId → function-decl AST node.
    // FunctionNodeId shape per route-inference.ts:521 — `${filePath}::${span.start}`.
    const fnNodes = new Map();
    // Track function names declared inside <channel> bodies so we can skip them.
    const channelFnNames = new Set();
    const collectFnsAndChannels = (nodeList, filePath, insideChannel) => {
      if (!Array.isArray(nodeList)) return;
      for (const n of nodeList) {
        if (!n || typeof n !== "object") continue;
        if (n.kind === "function-decl" && n.span && typeof n.span.start === "number") {
          const id = `${filePath}::${n.span.start}`;
          if (insideChannel) {
            if (typeof n.name === "string" && n.name.length > 0) channelFnNames.add(n.name);
          } else {
            fnNodes.set(id, n);
          }
        }
        const enteringChannel = insideChannel || (n.kind === "markup" && (n.tag ?? "") === "channel" && n._p3aIsExport !== true);
        if (Array.isArray(n.children)) collectFnsAndChannels(n.children, filePath, enteringChannel);
        if (n.kind === "logic" && Array.isArray(n.body)) collectFnsAndChannels(n.body, filePath, insideChannel);
      }
    };
    for (const f of ceResults) {
      const filePath = f.filePath ?? "<anon>";
      const fileNodes = f.nodes ?? f.ast?.nodes ?? [];
      collectFnsAndChannels(fileNodes, filePath, false);
    }
    // Second pass: drop any fnNode whose name was found inside a channel body
    // (handles edge cases where the same function name appears at file-scope
    // AND inside a channel; the channel-scope copy is collected during
    // emit-channel.ts handling and shouldn't be classified here).
    if (channelFnNames.size > 0) {
      for (const [id, fnNode] of fnNodes) {
        if (typeof fnNode.name === "string" && channelFnNames.has(fnNode.name)) {
          fnNodes.delete(id);
        }
      }
    }

    // S81 D3 (2026-05-11): build a global function index so the classifier
    // can recognize bare-expr calls to `fn`-kind callees as monotone per
    // §19.9.6 rule (e). Pre-D3 the classifier returned conservative
    // non-monotone for any bare-expr call → over-emitted idempotency-key
    // envelopes (HTTP-header bandwidth + server-side storage). The index
    // is keyed by function name → array of FunctionIndexEntry (multi-file
    // resolution). Channel-tagged fnNodes have already been filtered out
    // of `fnNodes` above; channel callees in the index are still allowed
    // (the classifier checks fnKind on the CALLEE, not the caller).
    const functionIndex = buildFunctionIndex(ceResults);
    const mcResult = analyzeMonotonicity(riResult.routeMap, fnNodes, functionIndex);

    if (verbose) {
      let mono = 0, nonMono = 0, machineIntrinsic = 0;
      for (const v of mcResult.verdicts.values()) {
        if (v === "monotone") mono++;
        else if (v === "non-monotone") nonMono++;
        else if (v === "machine-intrinsic") machineIntrinsic++;
      }
      log(`  [MC] ${mcResult.verdicts.size} CPS function(s) classified — ${mono} monotone, ${nonMono} non-monotone, ${machineIntrinsic} machine-intrinsic`);
      // D-CPS-MONOTONE is verbose-only per OQ-Ext5-4 resolution.
      for (const d of mcResult.diagnostics) {
        if (d.code === "D-CPS-MONOTONE" || d.code === "D-CPS-MACHINE-INTRINSIC-MONOTONE" || d.code === "D-CPS-IDEMPOTENT-OVERRIDE") {
          log(`  [MC] ${d.code}: ${d.message} (fn: ${d.functionNodeId})`);
        }
      }
    }

    // A9 Ext 5 D6: static-rejection diagnostics for non-monotone batches.
    // Per SPEC §19.9.6 + §39.2.6:
    //   - E-CPS-NONIDEM-NO-STORAGE — non-monotone CPS batch in scope of
    //     <program idempotency-store="none"> OR no resolvable backend.
    //   - E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH —
    //     idempotency-store="postgres"/"sqlite"/"mysql" doesn't match db= driver.
    //   - E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT — idempotency-store="redis"
    //     set but `scrml:redis` not in module graph.
    // These are GLOBAL diagnostics (per-app, not per-file) — the resolution
    // depends on the closest-ancestor <program db=> driver + module-graph
    // scrml:redis import detection. We fire them here at Stage 5.5 close
    // because the resolution is inherently cross-file. Per SCOPE §C the
    // landing site says "type-system.ts"; surfacing here instead so the
    // resolution reads the unified module graph + middlewareConfig before
    // TS runs per-file. Documented as SCOPE deviation; spec semantics
    // unchanged.
    const _ext5Errors = [];
    // Find the developer-declared idempotency-store= attribute and the db=
    // driver. We use file-level scoping: each file's middlewareConfig +
    // its own <program db=> attribute. For nested <program> override (§43),
    // we'd need ancestor-walk per-function — for v0.2.0 baseline, we do
    // file-grain (single <program> per file is the dominant pattern).
    for (const f of ceResults) {
      const filePath = f.filePath ?? "<anon>";
      const middleware = f.middlewareConfig ?? f.ast?.middlewareConfig ?? null;
      const idemAttr = middleware?.idempotencyStore;
      // db= driver from the file's <program db=> attribute.
      let dbDriver = null;
      const dbConfig = f.dbConfig ?? f.ast?.dbConfig ?? null;
      if (dbConfig && typeof dbConfig.driver === "string" && dbConfig.driver.length > 0) {
        // Existing dbConfig already has a driver token — trust it.
        dbDriver = dbConfig.driver === "sqlite" || dbConfig.driver === "postgres" || dbConfig.driver === "mysql"
          ? dbConfig.driver
          : null;
      } else {
        // Fallback: parse from raw db= attribute value via the helper.
        const programNode = (f.nodes ?? f.ast?.nodes ?? []).find(n => n?.kind === "markup" && (n.tag ?? "") === "program");
        const dbAttr = programNode?.attrs?.find(a => a.name === "db");
        const dbVal = dbAttr?.value?.kind === "string-literal" ? dbAttr.value.value : null;
        dbDriver = extractDbDriverFromValue(dbVal);
      }
      // Detect scrml:redis import in module graph (file-grain scan).
      let hasScrmlRedisImport = false;
      const fileImports = f.imports ?? f.ast?.imports ?? [];
      for (const imp of fileImports) {
        if (imp && typeof imp === "object") {
          const src = imp.source ?? imp.from;
          if (typeof src === "string" && src === "scrml:redis") {
            hasScrmlRedisImport = true;
            break;
          }
        }
      }
      // Resolve the backend for THIS file's scope.
      const resolution = resolveIdempotencyStore(idemAttr, dbDriver, hasScrmlRedisImport);

      // Find non-monotone CPS verdicts for functions declared in THIS file.
      // FunctionNodeId shape: `${filePath}::${span.start}` — so we filter
      // by prefix.
      const filePathPrefix = `${filePath}::`;
      for (const [fnId, verdict] of mcResult.verdicts) {
        if (!fnId.startsWith(filePathPrefix)) continue;
        if (verdict !== "non-monotone") continue;

        const fnNode = fnNodes.get(fnId);
        const fnSpan = fnNode?.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
        const fnName = (typeof fnNode?.name === "string" && fnNode.name.length > 0) ? fnNode.name : "<anonymous>";

        // E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH (highest priority — explicit-attr error).
        if (resolution.mismatch) {
          _ext5Errors.push({
            code: "E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH",
            severity: "error",
            message: `E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH: \`<program idempotency-store="${idemAttr}">\` does not match the closest-ancestor \`<program db=>\` driver (${dbDriver ?? "unset"}) in scope of CPS-eligible function \`${fnName}\`. Either change \`idempotency-store=\` to match \`db=\`, or use \`"auto"\` for compiler-default resolution.`,
            span: fnSpan,
          });
          continue;
        }
        // E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT.
        if (resolution.missingRedisImport) {
          _ext5Errors.push({
            code: "E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT",
            severity: "error",
            message: `E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT: \`<program idempotency-store="redis">\` requires \`scrml:redis\` to be imported in the module graph, but no such import was found, in scope of CPS-eligible function \`${fnName}\`. Add \`import { ... } from 'scrml:redis'\` somewhere in the module graph, or change \`idempotency-store=\` to a SQL backend matching \`db=\`.`,
            span: fnSpan,
          });
          continue;
        }
        // E-CPS-NONIDEM-NO-STORAGE — backend resolved to "none" AND batch is non-monotone.
        if (resolution.backend === "none") {
          _ext5Errors.push({
            code: "E-CPS-NONIDEM-NO-STORAGE",
            severity: "error",
            message: `E-CPS-NONIDEM-NO-STORAGE: CPS-eligible function \`${fnName}\` has a non-monotone server batch (per SPEC §19.9.6 classifier), but no idempotency-key storage backend is configured. Resolution: declare \`<program idempotency-store=>\` matching the \`db=\` driver, import \`scrml:redis\`, or annotate the function with \`.idempotent()\` (§19.9.7) if the batch is monotone-by-construction.`,
            span: fnSpan,
          });
          continue;
        }
        // Otherwise: backend is sqlite/postgres/mysql/redis (resolved successfully).
        // Set the FeatureUsage flag so codegen knows the runtime chunk is needed.
        // (file-level FeatureUsage isn't easily accessible here; emission-time
        // string-presence-detect handles this — see emit-server.ts inliner.)
      }
    }

    // Push diagnostics into the standard error/warning collectors for the
    // pipeline's normal surfacing path.
    if (_ext5Errors.length > 0) {
      collectErrors("MC", _ext5Errors);
    }

    return mcResult;
  });

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
  // PathKeyedMap: `ceFileMap` is SET with the native AST `f.filePath` but GET
  // with the posix `imp.absSource` (getDepRegistry) — the boundary canonicalizes
  // both so the cross-file type lookup can't desync (else E-ENGINE-004 /
  // missing-E-TYPE-020 on Windows: the exact regression the graph-posix change
  // otherwise reintroduces).
  const ceFileMap = new PathKeyedMap();
  for (const f of ceResults) {
    if (f.filePath) ceFileMap.set(f.filePath, f);
  }

  // SET with the posix key from iterating the (PathKeyedMap) importGraph, GET
  // with the native `fileAST.filePath` in type-system.ts — PathKeyedMap bridges.
  const importedTypesByFile = new PathKeyedMap();

  // Memoize per-file typeRegistry builds — buildTypeRegistry is pure given
  // typeDecls, so caching by file path is safe and avoids repeated work when
  // many importers reach the same dep.
  const depRegistryCache = new PathKeyedMap(); // absSource → Map<name, ResolvedType>
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

      // S122 Wave 12 Unit W: alias-aware iteration. importGraph carries both
      // `names[]` (source-side imported names, populated by ast-builder.js:
      // 7039-7044) and `specifiers[]` ({imported, local, pinned}, populated
      // by ast-builder.js:7049-7057 for the braced form). Prefer specifiers
      // when present so aliased type imports (`import { Foo as Bar } from
      // '...'`) seed importedTypes under the LOCAL name `Bar` — that's what
      // TS use-sites (match-arm patterns, type annotations) look up. The
      // imported side is still used for exportRegistry lookup (correct —
      // exportRegistry is source-side keyed). Fall back to names[] for
      // default imports (specifiers empty; default-import locals are
      // unaliasable per ES syntax, so imported === local).
      const pairs = Array.isArray(imp.specifiers) && imp.specifiers.length > 0
        ? imp.specifiers.map(s => ({ imported: s.imported, local: s.local }))
        : (imp.names ?? []).map(n => ({ imported: n, local: n }));
      const importedNames = imp.names ?? [];

      // Direct path: dep declares the type itself in its typeDecls.
      const depRegistry = getDepRegistry(imp.absSource);
      if (depRegistry) {
        for (const [typeName, resolvedType] of depRegistry) {
          if (resolvedType.kind === 'unknown') continue;
          const isExported = depExports.has(typeName);
          // Look up by IMPORTED name (source-side); seed under LOCAL name.
          const pair = pairs.find(p => p.imported === typeName);
          const isImported = importedNames.length === 0 || pair !== undefined;
          if (isExported && isImported) {
            const localKey = pair ? pair.local : typeName;
            importedTypes.set(localKey, resolvedType);
          }
        }
      }

      // Re-export chase: for each requested name not yet seeded, walk the dep's
      // exports[] re-export chain. This makes `import { X } from 'scrml:pkg'`
      // resolve when pkg/index.scrml does `export { X } from './nested.scrml'`.
      // Handles multi-hop chains (a → b → c) via recursion. Renamed re-exports
      // (`export { X as Y }`) and `export *` are out of scope — the TAB regex
      // does not currently parse them; add when grammar grows.
      //
      // Wave 12 Unit W: iterate pairs (alias-aware) — resolve via the IMPORTED
      // name (matches dep's export list), seed under the LOCAL name (matches
      // TS use-site lookup).
      for (const { imported: importedName, local: localName } of pairs) {
        if (importedTypes.has(localName)) continue;
        if (!depExports.has(importedName)) continue;
        const visited = new Set();
        const resolved = resolveTypeThroughReExport(imp.absSource, importedName, visited);
        if (resolved) {
          importedTypes.set(localName, resolved);
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
  // §23.5.5 / §28 — `lint.foreign-undeclared-capability = off` suppression. The
  // W-FOREIGN-UNDECLARED-CAPABILITY presence-nudge always computes in TS; drop it
  // here when the adopter has turned the knob off (mirrors the Tailwind lint
  // suppression pattern — `compilerSettings.lintForeignUndeclaredCapability`).
  if (compilerSettings.lintForeignUndeclaredCapability === "off" && Array.isArray(tsResult.errors)) {
    tsResult.errors = tsResult.errors.filter((e) => e.code !== "W-FOREIGN-UNDECLARED-CAPABILITY");
  }
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

  // Stage 6.4b: I-FN-PROMOTABLE info-level lint (SPEC §56.9)
  // Sibling to I-MATCH-PROMOTABLE — probes `function`-keyword declarations
  // whose bodies would pass §48.3 fn-body constraints and surfaces the
  // opportunity to rename to `fn` for the pure / state-factory contract.
  // Non-fatal — diagnostics flow into allLintDiagnostics, never errors.
  // CLI `bun scrml promote --fn` is a deferred follow-up (S122+).
  if (Array.isArray(tsResult.files) && tsResult.files.length > 0) {
    try {
      // Build the inferred-server skip set (e-fn-001-sql-enforce-2026-06-10
      // Fix B): every function route-inference escalated to the SERVER boundary
      // (§12.2) — by body content (`?{}` SQL / server-only import / file-IO /
      // protected-field / server callee) OR the explicit `server` keyword. Key
      // shape mirrors route-inference `makeFunctionNodeId`
      // (`${filePath}::${fnNode.span.start}`). I-FN-PROMOTABLE must NOT suggest
      // promoting a server function to a pure `fn`; the lint's keyword-only
      // `node.isServer` flag misses the body-content-escalated case.
      const inferredServerKeys = new Set();
      const riFns = riResult.routeMap?.functions;
      if (riFns) {
        for (const [key, fnRoute] of riFns) {
          if (fnRoute && fnRoute.boundary === "server") inferredServerKeys.add(key);
        }
      }
      const fnPromotableDiags = runIFnPromotable(
        tsResult.files,
        tsResult.stateTypeRegistry,
        inferredServerKeys,
      );
      for (const d of fnPromotableDiags) {
        allLintDiagnostics.push(d);
        if (verbose) log(`  [LINT] ${d.filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      if (verbose) log(`  [LINT] I-FN-PROMOTABLE pass threw: ${e?.message ?? String(e)}`);
    }
  }

  // Stage 6.4c: W-EACH-PROMOTABLE info-level lint (SPEC §17.X NEW per S130 HU-1)
  // Sibling to I-MATCH-PROMOTABLE — surfaces `${ for (...) { lift ... } }`
  // Tier-0 iteration sites that are mechanically promotable to the Tier-1
  // `<each in=@cell>...</each>` structural form. Non-fatal — diagnostics flow
  // into allLintDiagnostics. CLI `bun scrml promote --each` is Landing 3.
  if (Array.isArray(tsResult.files) && tsResult.files.length > 0) {
    try {
      const eachPromotableDiags = runWEachPromotable(tsResult.files);
      for (const d of eachPromotableDiags) {
        allLintDiagnostics.push(d);
        if (verbose) log(`  [LINT] ${d.filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      if (verbose) log(`  [LINT] W-EACH-PROMOTABLE pass threw: ${e?.message ?? String(e)}`);
    }
  }

  // Stage 6.4d: W-EACH-KEY-001 info-level lint (SPEC §17.X NEW per S130 HU-1)
  // Surfaces `<each in=@cell>` sites where the per-item identity isn't
  // inferable (items lack a `.id` field) AND no explicit `key=expr` is given.
  // The lint message names three legitimate causes + the explicit override
  // and `key=__index__` suppress sentinel per HU-1 Q5 ratification.
  if (Array.isArray(tsResult.files) && tsResult.files.length > 0) {
    try {
      const eachKeyDiags = runWEachKey(tsResult.files, tsResult.stateTypeRegistry);
      for (const d of eachKeyDiags) {
        allLintDiagnostics.push(d);
        if (verbose) log(`  [LINT] ${d.filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      if (verbose) log(`  [LINT] W-EACH-KEY-001 pass threw: ${e?.message ?? String(e)}`);
    }
  }

  // Stage 6.4e: W-MAP-ITERATION-ORDER info-level lint (SPEC §59.8 / §59.11).
  // Nudges `<each in=@m.entries()|.keys()|.values()>` on a NON-`@ordered` map
  // with no `.sorted()` stabilizer — iteration order is unspecified. Info-level:
  // partitions into result.warnings (W- prefix), never result.errors.
  if (Array.isArray(tsResult.files) && tsResult.files.length > 0) {
    try {
      const mapOrderDiags = runWMapIterationOrder(tsResult.files);
      for (const d of mapOrderDiags) {
        allLintDiagnostics.push(d);
        if (verbose) log(`  [LINT] ${d.filePath}:${d.line}:${d.column} ${d.code}: ${d.message}`);
      }
    } catch (e) {
      if (verbose) log(`  [LINT] W-MAP-ITERATION-ORDER pass threw: ${e?.message ?? String(e)}`);
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
    // PGO P1.3 — when --debug-perf is set, DG emits per-file Q1-Q4
    // growth breakdown + cross-file resolution time via `log`.
    debugPerf,
    log,
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

  // Stage 7.55: AG — AuthGraph derivation (SPEC §40 / SCOPING §A-3).
  //
  // A-3.5 wave-close (S91) wires the A-3 auth-graph pass into the
  // orchestrator. Position: post-RI / post-TS / post-META / post-BP /
  // pre-RS, per `compiler/src/auth-graph.ts:36` header note ("post-RI,
  // post-TS, post-META, pre-RS"). Consumes the post-CE / post-meta file
  // set + the RI-derived RouteMap (for the gateToEntryPoint cross-ref
  // and the A-3.4 redirect-target lookup against `RouteMap.pages`).
  //
  // The AuthGraph output is threaded into RS at Stage 7.6 below so
  // Component 4 (`auth_gated_boundaries_visible_to(role)`) can classify
  // gates closed-form vs. runtime-fallback and emit per-role
  // ChunkPlans. Without this wire RS Component 4 degrades to the
  // single-anonymous-role floor; with the wire active, per-role
  // filtering applies to `componentNodeIds` only (cells + server-fns
  // pending A-2.7 outer fixpoint + A-4 artifact splitter).
  //
  // Self-host hook: `runAuthGraph` is too new for a self-host
  // counterpart at S91; no selfHostModules.runAuthGraph slot is wired
  // here. If/when scrml's self-host bootstrap surface grows to include
  // auth-graph derivation the override slot mirrors the precedent at
  // L904 (`_runRI = selfHostModules?.runRI ?? runRI`).
  const _runAuthGraph = selfHostModules?.runAuthGraph ?? runAuthGraph;
  const agResult = stage("AG", () => _runAuthGraph(metaFiles, riResult.routeMap));
  collectErrors("AG", agResult.errors);
  if (verbose) {
    const gateCount = agResult.graph?.gates?.size ?? 0;
    let closedForm = 0, runtimeFallback = 0, unclassified = 0;
    if (agResult.graph?.gates) {
      for (const gate of agResult.graph.gates.values()) {
        const c = gate.classification;
        if (c === null || c === undefined) { unclassified++; continue; }
        // Per types/auth-graph.ts `RoleClassification`: closed_form boolean
        // gates one branch; the runtime-fallback case sits on the
        // gated_for_role: "runtime-fallback" sentinel.
        if (c.closed_form === true) closedForm++;
        else runtimeFallback++;
      }
    }
    const roleEnum = agResult.graph?.roleEnum;
    const roleEnumLabel = roleEnum
      ? `${roleEnum.name ?? "<unnamed>"} (${roleEnum.variants?.length ?? 0} variants${roleEnum.isImplicitAnonymous ? ", implicit-anonymous" : ""})`
      : "<unresolved>";
    log(`  [AG] ${gateCount} auth-gate(s) classified — ${closedForm} closed-form / ${runtimeFallback} runtime-fallback${unclassified > 0 ? ` / ${unclassified} unclassified` : ""}; roleEnum: ${roleEnumLabel}`);
  }

  // Stage 7.6: Reachability Solver (SPEC §40.9 / PIPELINE Stage 7.6) — A-2.1
  // scaffold + A-2.2..A-2.6 Components 1-5. Consumes finalized DG + RouteMap
  // + A-3 AuthGraph (wired at Stage 7.55 above, S91 A-3.5). Produces a
  // per-entry-point per-role ChunkPlan tree for A-4 codegen consumption.
  // Per-role filtering at A-2.5 applies to componentNodeIds only; cells +
  // server-fns + vendor-units pending A-2.7 outer fixpoint + A-4 splitter.
  const rsResult = stage("RS", () => runReachabilitySolver({
    depGraph: dgResult.depGraph,
    routeMap: riResult.routeMap,
    batchPlan: bpResult.batchPlan,
    files: metaFiles,
    authGraph: agResult.graph,
    // PGO P1.2 — when --debug-perf is set, RS emits per-component
    // `[RS-COMPONENT N]` + `[RS-OUTER-FIXPOINT]` breakdown via `log`.
    debugPerf,
    log,
  }));
  collectErrors("RS", rsResult.errors);

  // Stage 8: CG (all files)
  // known-gaps-#6 (S152) — compute the dist output base dir from the
  // compile-unit source set BEFORE runCG so codegen can derive a stable,
  // identical dist-relative `_scrml_modules` registry key on both the
  // importer + exporter sides of the cross-file client module-loading
  // lowering (Approach B, §21.3). Mirrors the write-phase computation at
  // `computeOutputBaseDir([...cgResult.outputs.keys()])` — same source paths
  // (one output per input file), so the key matches the on-disk dist layout.
  const cgSourcePaths = metaFiles
    .map((f) => f.filePath || f.ast?.filePath)
    .filter(Boolean);
  const cgOutputBaseDir = computeOutputBaseDir(cgSourcePaths);

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
    // Phase A8 / A6-5 (S76): when testMode is on, runCG emits `output.testJs`
    // for each file containing `~{}` test blocks; written to `<base>.test.js`
    // in the write-output section below.
    testMode,
    // §20.6 (F4=A) — production strip flag for the log() builtin.
    production,
    // C15 — pass MOD's exportRegistry so codegen can identify cross-file
    // engine mount sites (`<engineVarName/>` resolving to `category: "engine"`)
    // and emit the §21.8 mount-position marker per SPEC §51.0.D.
    exportRegistry: moduleResult.exportRegistry,
    // known-gaps-#6 (S152) — pass MOD importGraph + dist outputBaseDir so the
    // cross-file _scrml_modules lowering (Approach B, §21.3) can identify
    // exporter files, derive identical registry keys, and emit topo-ordered
    // dependency <script> tags.
    importGraph: moduleResult.importGraph,
    outputBaseDir: cgOutputBaseDir,
    // A-2.1 — pass Stage 7.6 ReachabilityRecord. Empty at A-2.1; consumed
    // by A-4 codegen wave once A-2.2..A-2.7 land the closure analysis.
    reachabilityRecord: rsResult.record,
    // A-4.1 (S91) — Opt-in per-route artifact splitter (§40.9.7).
    // Off by default per OQ-A4-F; enables per-(EP, role, tier) chunk
    // descriptor production + chunks.json manifest emission.
    emitPerRoute,
    // Q-OPEN-5 — `--chunk-size-budget=<bytes>` CLI flag value. When
    // undefined, the route-splitter falls back to its default
    // `CHUNK_LARGE_SOFT_BUDGET_BYTES` (100 000).
    chunkSizeBudgetBytes,
    // PGO P1.1 (S102) — when `--debug-perf` is set, runCG aggregates
    // per-emit-* timings and emits a `[CG-EMIT] ...` breakdown via
    // `log` after the per-file loop. Hard-gated; when unset the
    // per-emit instrumentation is a single boolean check per site.
    debugPerf,
    log,
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
  // MCP V0 Sub-unit D — auto-include `scrml:mcp` in the stdlib bundle when
  // `<program mcp>` is set, even if no source file imports it directly. The
  // attribute IS the opt-in; the boot import lives in the build-time-
  // generated `_server.js` (commands/build.js), not in any TAB-parsed file,
  // so it would never reach collectStdlibSpecifiers naturally. Without this
  // splice, the `_server.js` boot would `import "./_scrml/mcp.js"` against a
  // missing file. Q4 (a) in SCOPING — compiler-internal stdlib; adopters do
  // not directly import it.
  if (mcpAutoActivated) {
    stdlibSpecifiers.add("mcp");
  }
  const bundledStdlib = (write && outputDir)
    ? bundleStdlibForRun(stdlibSpecifiers, outputDir, verbose ? log : null, allErrors)
    : new Set();

  // ---------------------------------------------------------------------------
  // W-SERVER-IMPORT-UNEMITTED (S208, Fix B) — cross-file server-import invariant.
  //
  // A server bundle that imports `from "./X.server.js"` produces a GREEN compile
  // but throws at RUNTIME when (a) X.server.js is never emitted (the imported
  // module is a pure-helper with no server content → `Cannot find module`), or
  // (b) X.server.js IS emitted but does not export an imported name (a
  // server-CALLED pure helper that route-infers into a handler — `auth.server.js`
  // emits the ROUTE `export const __ri_route_rolePath`, not `export const rolePath`
  // → missing export). Both are the "compiled-green != works" class
  // (g-pure-module-server-emit-missing). Fix A (emit-server tree-shaking) prunes
  // the CLIENT-only-used import, so a SURVIVING server-import is genuinely
  // referenced server-side; this warning is the cross-file defense-in-depth that
  // catches the residual broken shapes emit-server cannot see (no sibling-emission
  // knowledge). Runs on the COMPILE (before the write gate) so it fires in any
  // write mode; non-fatal — surfaces in result.warnings. Works in SOURCE-path
  // space: `./X.server.js` reverses to `./X.scrml`, resolved against the importing
  // file's source dir, looked up in cgResult.outputs (keyed by source path).
  // ---------------------------------------------------------------------------
  function checkServerImportInvariant() {
    if (!cgResult.outputs) return;
    const outputByAbsSource = new Map();
    for (const [fp, out] of cgResult.outputs) outputByAbsSource.set(resolve(fp), out);

    // Exported names declared in an emitted .server.js (ESM forms; errs toward
    // "exported" — an unmodeled form just means no false warning).
    const exportedNamesOf = (js) => {
      const names = new Set();
      let m;
      const declRe = /\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
      while ((m = declRe.exec(js))) names.add(m[1]);
      const braceRe = /\bexport\s*\{([^}]*)\}/g;
      while ((m = braceRe.exec(js))) {
        for (const part of m[1].split(",")) {
          const t = part.trim();
          if (!t) continue;
          const as = t.split(/\s+as\s+/); // `X as Y` exports Y; bare `X` exports X
          names.add((as[1] ?? as[0]).trim());
        }
      }
      if (/\bexport\s+default\b/.test(js)) names.add("default");
      return names;
    };

    // `import D, { a, b as c } from "./X.server.js"` — default + named clause +
    // the relative .server.js path. Namespace `import * as X` is not matched.
    const importRe =
      /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.\.?\/[^"']+\.server\.js)["']/g;

    // Compile-wide dedup: one warning per DISTINCT broken-import shape (target +
    // kind + missing-name set), so a route-mis-inferred helper imported by many
    // per-route server bundles fires once, not once per bundle.
    const seen = new Set();
    for (const [filePath, output] of cgResult.outputs) {
      if (!output.serverJs) continue;
      const importerBase = basename(filePath, ".scrml");
      let m;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(output.serverJs))) {
        const [, defaultName, namedClause, relServer] = m;
        const relScrml = relServer.replace(/\.server\.js$/, ".scrml");
        const targetAbs = resolve(dirname(filePath), relScrml);
        const target = outputByAbsSource.get(targetAbs);
        if (!target) continue; // external / cross-unit / vendor — not our invariant
        const targetBase = basename(targetAbs, ".scrml");

        if (!target.serverJs) {
          // (a) MISSING-FILE — target emits no .server.js at all.
          const dk = "F|" + targetAbs;
          if (seen.has(dk)) continue;
          seen.add(dk);
          allErrors.push({
            stage: "CG",
            code: "W-SERVER-IMPORT-UNEMITTED",
            message: `Server bundle '${importerBase}.server.js' imports from '${relServer}', but '${targetBase}.scrml' has no server content and emits no .server.js — the import dangles at runtime ("Cannot find module"). Either use '${targetBase}' server-side so its .server.js is emitted, or keep its imports out of server code.`,
            file: filePath,
            line: 1,
            column: 1,
            severity: "warning",
          });
          continue;
        }
        // (b) MISSING-EXPORT — target emits .server.js but not all imported names.
        const exported = exportedNamesOf(target.serverJs);
        const wanted = [];
        if (defaultName) wanted.push("default");
        if (namedClause) {
          for (const part of namedClause.split(",")) {
            const t = part.trim();
            if (t) wanted.push(t.split(/\s+as\s+/)[0].trim());
          }
        }
        const missing = wanted.filter((n) => n && !exported.has(n));
        if (missing.length > 0) {
          const dk = "E|" + targetAbs + "|" + missing.slice().sort().join(",");
          if (seen.has(dk)) continue;
          seen.add(dk);
          allErrors.push({
            stage: "CG",
            code: "W-SERVER-IMPORT-UNEMITTED",
            message: `Server bundle '${importerBase}.server.js' imports { ${missing.join(", ")} } from '${relServer}', but that .server.js exports no such name — the import fails at runtime (missing export). A server-CALLED pure helper that route-infers into a handler emits the route, not a value export.`,
            file: filePath,
            line: 1,
            column: 1,
            severity: "warning",
          });
        }
      }
    }
  }
  // ---------------------------------------------------------------------------
  // g-const-only-module-no-server-emit (sPA ss1 item 2) — on-import value-only
  // .server.js emission. Sibling fix to the S208 route-handler value-export
  // path: that closed the MISSING-EXPORT branch (a server-CALLED route-inferred
  // helper that emits a route, not a value); THIS closes the MISSING-FILE branch
  // (a const-only module that emits NO .server.js at all).
  //
  // A module whose exports are CONSTANTS / pure types only (no server fns / no
  // `?{}` / no channels) short-circuits to "" in generateServerJs (emit-server)
  // → no .server.js. But a server-side consumer that imports a VALUE const
  // by-name emits `import { CONST } from './mod.server.js'` → the file does not
  // exist → `Cannot find module` at runtime (warned MISSING-FILE below).
  //
  // RIGHT SCOPE (R3): emit the minimal value-only .server.js ONLY for a
  // const-only module that is ACTUALLY server-imported by-name — NOT for every
  // const-only module (that would emit dead .server.js files for client-only
  // modules + churn every baseline). The cross-file "who imports ./X.server.js"
  // knowledge lives HERE (same regex + source-path resolution
  // checkServerImportInvariant uses), so this runs BEFORE it: resolve the
  // dangling targets, emit their value-only .server.js, attach to the output;
  // the invariant check then sees `target.serverJs` exists and the MISSING-FILE
  // warning drops to 0. A module with NO server-importable value export emits
  // nothing (generateValueOnlyServerJs returns "") — the warning correctly
  // still fires (there is genuinely nothing to import).
  // ---------------------------------------------------------------------------
  function emitValueOnlyServerJsForDanglingImports() {
    if (!cgResult.outputs) return;
    // Index file ASTs + output objects by absolute source path so a resolved
    // `./X.scrml` target can be located + run through generateValueOnlyServerJs.
    const astByAbsSource = new Map();
    for (const f of metaFiles) {
      if (f && f.filePath) astByAbsSource.set(resolve(f.filePath), f);
    }
    const outputByAbsSource = new Map();
    for (const [fp, out] of cgResult.outputs) outputByAbsSource.set(resolve(fp), out);
    // `import D, { a, b as c } from "./X.server.js"` — same shape the invariant
    // check matches. We only need the relative `.server.js` path here.
    const importRe =
      /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,?\s*)?(?:\{[^}]*\})?\s*from\s*["'](\.\.?\/[^"']+\.server\.js)["']/g;
    // Dedup so a target imported by many bundles is emitted once.
    const emittedFor = new Set();
    for (const [filePath, output] of cgResult.outputs) {
      if (!output.serverJs) continue;
      importRe.lastIndex = 0;
      let m;
      while ((m = importRe.exec(output.serverJs))) {
        const relServer = m[1];
        const relScrml = relServer.replace(/\.server\.js$/, ".scrml");
        const targetAbs = resolve(dirname(filePath), relScrml);
        if (emittedFor.has(targetAbs)) continue;
        const target = outputByAbsSource.get(targetAbs);
        if (!target) continue; // external / cross-unit / vendor — not ours.
        if (target.serverJs) continue; // already has server content — fine.
        const targetAst = astByAbsSource.get(targetAbs);
        if (!targetAst) continue; // no AST for the target (shouldn't happen).
        const valueOnly = generateValueOnlyServerJs(targetAst);
        emittedFor.add(targetAbs);
        if (!valueOnly) continue; // no server-importable value export → leave dangling (warning fires).
        // Attach the minimal value-only .server.js to the target output so the
        // parse-gate + write phase pick it up and the invariant check resolves.
        target.serverJs = valueOnly;
      }
    }
  }
  emitValueOnlyServerJsForDanglingImports();
  checkServerImportInvariant();

  // ---------------------------------------------------------------------------
  // Write output files
  // ---------------------------------------------------------------------------

  let fileCount = 0;

  if (write && outputDir) {
    mkdirSync(outputDir, { recursive: true });

    // `emitGateFailed` short-circuits ALL writes below (runtime chunk, per-file
    // client/server/library, per-route chunks + manifest) when the emit gate
    // rejects an artifact. Declared here so every sibling write block in this
    // `if (write && outputDir)` scope can guard on it.
    let emitGateFailed = false;

    // -------------------------------------------------------------------------
    // Emitted-JS parse gate (Approach A -- ratified S141, A+D;
    // gate-emitted-js-parse-invariant-2026-05-29). Runs BEFORE any file write
    // so a failure leaves the output dir untouched ("no files were written").
    //
    // Parses every FINAL JS artifact (runtime chunk + each .client.js /
    // .server.js / library .js, after the stdlib-import rewrites that produce
    // the exact bytes that would land on disk + per-route chunk payloads) with
    // the in-process Acorn. Any artifact that does not parse pushes a hard
    // E-CODEGEN-INVALID-LOGIC error and ABORTS the write phase entirely (return
    // before mkdir/writeFileSync). This makes SPEC SS 2.2.1 a compile-time
    // invariant: a syntactically-invalid emit is a hard error, never a green
    // build shipping broken JS. In-tree precedent: meta-eval reparseEmitted /
    // E-META-EVAL-002 for ^{} meta output.
    //
    // Path note: the gate validates with `outputDir` as the bundle dir for the
    // stdlib-import rewrites. The per-file dist subdir (pathFor) only changes
    // WHICH relative import path is emitted, never JS syntax validity, so the
    // simpler outputDir-rooted rewrite is faithful for a SYNTACTIC gate.
    //
    // FLAG-GATED, default OFF. Perf admits always-on (~24 ms over the 8433-line
    // reference app, well inside SS 2.4), but the reference corpus ships
    // pre-existing invalid-JS artifacts whose fix is a separate codegen
    // fix-wave; always-on waits for that surface to close. See the
    // `validateEmit` option doc + progress.md for the surfaced backlog.
    // -------------------------------------------------------------------------
    // Bug 70 (§2.2.1 / §17.7.3) — suppress the emitted-JS parse gate when the
    // compile already has a FATAL error from an earlier stage. The gate's
    // contract is "the compiler emits VALID JS for VALID source" — its
    // diagnostic literally says "This is a compiler defect ... please report
    // it." When the source is already invalid (e.g. `@.` used outside an
    // `<each>` body → E-SYNTAX-064 at TS), codegen-of-invalid-source producing
    // a non-parsing artifact is EXPECTED, not a compiler defect; firing
    // E-CODEGEN-INVALID-LOGIC on top of the real (already-surfaced) error is
    // actively misleading. The build still fails (the prior fatal error fails
    // it) and no artifacts are written. We use the same fatal/non-fatal
    // partition as the final result split below (`isNonFatal`): only W-/I-
    // prefixes and warning/info severities are non-fatal.
    const hasPriorFatalError = allErrors.some((e) =>
      !(e.code?.startsWith("W-")
        || e.code?.startsWith("I-")
        || e.severity === "warning"
        || e.severity === "info"
        // E-STYLE-CONFLICT (§65.2) is a CSS same-property ambiguity — ORTHOGONAL
        // to JS emission. It is still fatal in the final result partition (fails
        // the build), but it must NOT gate the emitted-JS validity check: a
        // co-occurring E-CODEGEN-INVALID-LOGIC in the SAME run would otherwise be
        // masked (the style conflict does not make codegen emit invalid JS).
        || e.code === "E-STYLE-CONFLICT"));
    if (validateEmit && !hasPriorFatalError && cgResult.outputs) {
      const gateArtifacts = [];
      const pushArtifact = (sourceFile, artifact, contents) => {
        if (typeof contents === "string" && contents.length > 0) {
          gateArtifacts.push({ sourceFile, artifact, contents });
        }
      };
      // §64 A2 — the set of `.scrml` sources THIS build compiled (their
      // `<base>.js` outputs mirror the tree; see rewriteRelativeImportPaths).
      const emittedScrmlSources = new Set(cgResult.outputs.keys());
      for (const [filePath, output] of cgResult.outputs) {
        const base = basename(filePath, ".scrml");
        // §64 — standalone-tool module (kind="tool"): a single runnable `<base>.js`.
        if (output.toolJs) {
          let s = rewriteRelativeImportPaths(output.toolJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, outputDir, outputDir, bundledStdlib);
          pushArtifact(filePath, `${base}.js`, s);
        }
        if (output.serverJs) {
          let s = rewriteRelativeImportPaths(output.serverJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, outputDir, outputDir, bundledStdlib);
          pushArtifact(filePath, `${base}.server.js`, s);
        }
        // §64 A2 — INDEPENDENT (not else): a library-shaped output writes
        // `<base>.js` (build-wide library mode OR a tool build's library dep),
        // AND a browser output writes `<base>.client.js`. In a tool build an
        // ADDITIVE library dep carries BOTH (it stays a browser page consumer's
        // dep and becomes the tool's ES import). Pure browser-app outputs never
        // carry `libraryJs`; pure library-mode outputs never carry `clientJs` —
        // so this is byte-identical for both.
        if (output.libraryJs) {
          let s = rewriteRelativeImportPaths(output.libraryJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, outputDir, outputDir, bundledStdlib);
          pushArtifact(filePath, `${base}.js`, s);
        }
        if (output.clientJs) {
          const c = rewriteStdlibImports(output.clientJs, outputDir, outputDir, bundledStdlib);
          pushArtifact(filePath, `${base}.client.js`, c);
        }
      }
      if (mode !== "library" && cgResult.runtimeJs && cgResult.runtimeFilename) {
        pushArtifact(cgResult.runtimeFilename, cgResult.runtimeFilename, cgResult.runtimeJs);
      }
      if (emitPerRoute && cgResult.chunks) {
        for (const chunk of cgResult.chunks.values()) {
          pushArtifact(chunk.filename, chunk.filename, chunk.payloadJs);
        }
      }
      const gateErrors = validateEmittedArtifacts(gateArtifacts);
      if (gateErrors.length > 0) {
        for (const ge of gateErrors) {
          allErrors.push({
            stage: "CG",
            code: ge.code,
            message: ge.message,
            file: ge.span?.file ?? "",
            line: ge.span?.line ?? 1,
            column: ge.span?.col ?? 1,
            severity: "error",
          });
        }
        emitGateFailed = true;
        if (verbose) {
          log(`  [CG] Emit gate FAILED -- ${gateErrors.length} invalid artifact(s); no files written.`);
        }
      }
    }

    // (W-SERVER-IMPORT-UNEMITTED — the cross-file server-import invariant — runs
    // BEFORE this write gate, so it fires in any write mode; see checkServerImportInvariant.)

    // In browser mode, write the shared runtime file (not needed in library mode)
    if (!emitGateFailed && mode !== 'library' && cgResult.runtimeJs && cgResult.runtimeFilename) {
      writeFileSync(join(outputDir, cgResult.runtimeFilename), cgResult.runtimeJs);
      if (verbose) log(`  [CG] Wrote shared runtime: ${cgResult.runtimeFilename}`);
    }

    if (!emitGateFailed && cgResult.outputs) {
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
        const relDirRaw = dirname(relative(outputBaseDir, filePath));
        // mpa-shell-clean-urls: strip the leading `pages/` segment from the
        // dist directory so route URLs (filesystem-inferred per §47.9.2 —
        // `pages/customer/loads.scrml` → `/customer/loads`) align with dist
        // paths (now `dist/customer/loads.html`). Without this strip, the
        // dist tree preserved `pages/` (matching §47.9.5 worked example) but
        // every URL needed an inverse-rewrite by the dev server. Stripping
        // unifies URL = dist path; static-file servers (S3, Netlify, Bun.serve)
        // resolve `/customer/loads` → `dist/customer/loads.html` trivially.
        //
        // Only `pages/` (the v0.3 canonical convention per §40.8.1 +
        // §47.9.2) is stripped. The legacy `routes/` prefix is preserved
        // as-is to avoid surprise URL shifts for existing apps that opted
        // into the legacy convention.
        //
        // The strip is segment-aligned: only an exact leading `pages` segment
        // (or `pages/...`) is removed. A file at outputBase named
        // `pages.scrml` keeps its dist name. A file at
        // outputBase/sub/pages/X.scrml is NOT stripped because the leading
        // segment is `sub`, not `pages` — this preserves outputBase semantics
        // when the user invokes the compiler with a non-`./` outputBase.
        // Issue #25: relDirRaw is a `dirname(relative())` → HOST separator, but
        // the `pages/` strip is `/`-oriented; a Windows `pages\auth` misses both
        // the `=== "pages"` and `startsWith("pages/")` branches → nested pages
        // keep the prefix → dist lands under `dist/pages/...` → the route 404s.
        // stripPagesPrefix normalizes `\`→`/` first (no-op on POSIX), then strips;
        // the `/`-separated result is re-nativized by `join()` for the FS write.
        const relDir = stripPagesPrefix(relDirRaw);
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

      // §64 A2 — the set of `.scrml` sources THIS build compiled (their
      // `<base>.js` outputs mirror the tree; see rewriteRelativeImportPaths).
      const emittedScrmlSources = new Set(cgResult.outputs.keys());
      for (const [filePath, output] of cgResult.outputs) {
        // GITI-009 + OQ-2: post-codegen rewrites for emitted JS.
        //   - rewriteRelativeImportPaths: ./*.js relative imports point at
        //     the source-tree path (so output JS resolves correctly when
        //     output dir != source dir).
        //   - rewriteStdlibImports: scrml:NAME specifiers point at the
        //     bundled <outputDir>/_scrml/NAME.js shim, with the relative
        //     path computed from the file's actual targetDir (which may be
        //     nested under outputDir per F-COMPILE-001 Option A).
        // §64 — a kind="tool" program emits a single runnable module `<base>.js`
        // (NO html / client / CSRF / server-route split). Written and returned.
        if (output.toolJs) {
          const { targetDir } = pathFor(filePath, ".js");
          let s = rewriteRelativeImportPaths(output.toolJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, targetDir, outputDir, bundledStdlib);
          if (writeOutput(filePath, ".js", s)) fileCount++;
        }
        if (output.serverJs) {
          const { targetDir } = pathFor(filePath, ".server.js");
          let s = rewriteRelativeImportPaths(output.serverJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, targetDir, outputDir, bundledStdlib);
          if (writeOutput(filePath, ".server.js", s)) fileCount++;
        }
        // §64 A2 — INDEPENDENT writes (not else): a library-shaped output writes
        // `<base>.js`; a browser output writes `<base>.client.js` + html. A tool
        // build's ADDITIVE library dep carries BOTH `libraryJs` (the tool's ES
        // import) AND `clientJs` (a co-resident browser page's `_scrml_modules`
        // dep). Filenames never collide. Pure browser-app / pure library-mode
        // outputs carry only one, so both are byte-identical.
        if (output.libraryJs) {
          const { targetDir } = pathFor(filePath, ".js");
          let s = rewriteRelativeImportPaths(output.libraryJs, filePath, outputDir, emittedScrmlSources);
          s = rewriteStdlibImports(s, targetDir, outputDir, bundledStdlib);
          if (writeOutput(filePath, ".js", s)) fileCount++;
        }
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
        // Phase A8 / A6-5 (S76): user-authored ~{} test blocks compiled to
        // bun:test JS with `test-bind` dispatch hooks already wired. Only
        // emitted when `testMode` is true; production builds (testMode:false)
        // produce no testJs per SPEC §19.12.7 0-byte production cost guarantee.
        if (output.testJs) {
          if (writeOutput(filePath, ".test.js", output.testJs)) {
            fileCount++;
            const { base } = pathFor(filePath, ".test.js");
            if (verbose) log(`  [CG] Wrote user tests: ${base}.test.js`);
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // S91 A-4.1 — Per-route chunk file writes.
    //
    // When `--emit-per-route` is set AND runCG produced chunk descriptors,
    // write one file per chunk at `<outputDir>/<route-path>/<RoleVariant>.
    // <tier>.<8-char-hash>.js` (OQ-A4-C filename convention). Also write
    // `<outputDir>/chunks.json` per OQ-A4-A always-emit ratification.
    //
    // Post-A-4.6: every chunk's filename carries the real FNV-1a base36
    // content-addressed hash (§47.5 / §40.9.8 / §47.1.3). The A-4.1
    // placeholder `"00000000"` is replaced by `finalizeChunkHash` in
    // route-splitter.ts before any descriptor surfaces here. Empty
    // tier-N chunks still carry a deterministic real-hash filename;
    // the file write is elided when payloadJs is empty (per A-4.3
    // empty-payload skip below) but the chunks.json manifest still
    // references the chunk by hash so adopter tooling can replay the
    // deterministic-from-source contract end-to-end.
    // -------------------------------------------------------------------------
    if (!emitGateFailed && emitPerRoute && cgResult.chunks && cgResult.chunksManifest) {
      // S91 A-4.3 — surface per-tier byte totals in the verbose log so
      // adopters can sanity-check the tier-1 idle-prefetch payload
      // budget at a glance. S91 A-4.4 extends this to tier-2 chunks;
      // in v0.3 RS A-2.5 floor admits NO intra-route tier-2 content
      // (the dominant tier-2 surface is cross-route hover-prefetch,
      // which fetches OTHER routes' INITIAL chunks — not these
      // tier-2 files), so the tier-2 count is typically zero.
      let tier1Count = 0;
      let tier1Bytes = 0;
      let tier2Count = 0;
      let tier2Bytes = 0;
      for (const chunk of cgResult.chunks.values()) {
        // S91 A-4.3 — Skip the file write when the chunk has an empty
        // payload AND is a non-initial tier. The initial chunk always
        // ships even with an all-empty admission set (it carries the
        // IIFE shell + chunk header comment); the tier-1 / tier-2 /
        // tier-N chunks emit a file ONLY when there is admitted content
        // to serve.
        //
        // Empty-tier elision is normative per SPEC §40.9.9 worked
        // example (viewer=Driver `prefetch_tier_1(/) = {}`): no tier-1
        // file is written, and the per-file `.client.js` runtime
        // tree-shakes `_scrml_prefetch_tier1` (no chunk references it).
        if (chunk.tier !== "initial" && chunk.payloadJs === "") {
          continue;
        }

        // The chunk filename is dist-relative; join with outputDir.
        const chunkPath = join(outputDir, chunk.filename);
        mkdirSync(dirname(chunkPath), { recursive: true });
        writeFileSync(chunkPath, chunk.payloadJs);
        fileCount++;
        const byteLen = Buffer.byteLength(chunk.payloadJs, "utf8");
        if (chunk.tier === "tier1") {
          tier1Count++;
          tier1Bytes += byteLen;
        } else if (chunk.tier === "tier2") {
          tier2Count++;
          tier2Bytes += byteLen;
        }
        if (verbose) {
          // S91 A-4.2 — surface chunk byte count in the verbose log so
          // adopters can sanity-check the per-tier payload size budget.
          log(`  [CG] Wrote chunk: ${chunk.filename} (${byteLen} B)`);
        }
      }
      const manifestPath = join(outputDir, "chunks.json");
      // A-4.6 — pass `cgResult.chunks` so the on-disk JSON resolves
      // ChunkKey → URL-style content-addressed filename per the
      // adopter-facing shape (`"/<route>/<role>.<tier>.<hash>.js"`).
      // See `serializeChunksManifest` dual-shape rationale.
      const manifestBody = serializeChunksManifest(cgResult.chunksManifest, cgResult.chunks);
      writeFileSync(manifestPath, manifestBody);
      fileCount++;
      if (verbose) {
        const manifestBytes = Buffer.byteLength(manifestBody, "utf8");
        log(`  [CG] Wrote chunks manifest: chunks.json (${manifestBytes} B)`);
      }

      // ---------------------------------------------------------------------
      // MCP V0 Sub-unit A — compile-time descriptor sidecars.
      //
      // Four read-only descriptor surfaces consumed by `scrml:mcp` v0
      // (Sub-unit C, sequenced later). Emitted next to `chunks.json` in
      // `<outputDir>/`, gated by the same `--emit-per-route` flag (Sub-unit
      // D auto-flips this flag when `<program mcp>` is present — out of
      // scope here). Authority: docs/changes/mcp-v0-devtools-scoping/SCOPING.md
      // §3 Sub-unit A.
      //
      // Degenerate-app case (SCOPING §5 Risk 6): zero-engine / zero-form /
      // zero-channel / zero-server-fn apps emit `[]` for the respective
      // sidecar — every adopter app gets the four files unconditionally so
      // the MCP server has predictable contracts to read.
      // ---------------------------------------------------------------------
      // server-keyword-eliminate-2026-06-10 (D1): thread the RI routeMap so the
      // server-fn descriptor extractor surfaces INFERRED-server fns (escalating
      // body, no `server` keyword) — not just keyword-marked `server function`s.
      const mcpDescriptors = buildMcpDescriptors(tabResults, riResult.routeMap);
      const sidecarSpecs = [
        { name: "engines.json", body: mcpDescriptors.engines },
        { name: "forms.json", body: mcpDescriptors.forms },
        { name: "channels.json", body: mcpDescriptors.channels },
        { name: "serverfns.json", body: mcpDescriptors.serverFns },
      ];
      for (const spec of sidecarSpecs) {
        const sidecarPath = join(outputDir, spec.name);
        const sidecarBody = JSON.stringify(spec.body, null, 2);
        writeFileSync(sidecarPath, sidecarBody);
        fileCount++;
        if (verbose) {
          const sidecarBytes = Buffer.byteLength(sidecarBody, "utf8");
          log(`  [CG] Wrote MCP descriptor: ${spec.name} (${spec.body.length} entries, ${sidecarBytes} B)`);
        }
      }

      if (verbose) {
        // A-4.3 tier-1 summary — single-line aggregate over all (EP,
        // role) chunks. Useful at the CLI level to confirm the idle-
        // prefetch budget at a glance ("0 tier-1 files at 0 B" means
        // the build's playable surfaces all admit their content at
        // initial render — typical for small fixtures + the §40.9.9
        // worked example).
        log(`  [CG] Tier-1 idle-prefetch chunks: ${tier1Count} file(s), ${tier1Bytes} B total`);
        // A-4.4 tier-2 summary — typically "0 file(s), 0 B" in v0.3 per
        // the RS A-2.5 intra-route tier-2 admission floor. The dominant
        // tier-2 surface is the cross-route hover-prefetch path, which
        // fetches OTHER routes' INITIAL chunks — not files counted here.
        log(`  [CG] Tier-2 intra-route prefetch chunks: ${tier2Count} file(s), ${tier2Bytes} B total`);
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
      if (output.testJs) fileCount++;
    }
  }

  // M5-swap C2 (v0.7) — `--parser=scrml-native` ROUTING CONFIRMATION. When the
  // opt-in flag is set, emit ONE I-PARSER-NATIVE-SHADOW info diagnostic per
  // compile confirming the per-file parse was ROUTED through the native
  // parser's `nativeParseFile` (the TAB-stage `_buildAST` override above).
  // Pre-C2 (M5.1) this flag was observability-only — the live BS+TAB pipeline
  // still produced the FileAST; C2 swapped the no-op for real routing. The
  // diagnostic's presence in result.warnings is the evidence the native
  // pipeline produced the downstream FileAST for this compile.
  if (parser === "scrml-native") {
    allErrors.push({
      code: "I-PARSER-NATIVE-SHADOW",
      message:
        "I-PARSER-NATIVE-SHADOW: --parser=scrml-native flag recognized. " +
        "The per-file parse was ROUTED through the native parser " +
        "(nativeParseFile, compiler/native-parser/parse-file.js) instead " +
        "of the live BS+TAB path; the native parser produced the FileAST " +
        "consumed by every downstream stage for this compile. The flag is " +
        "strictly opt-in — callers that do not pass it use the unchanged " +
        "live pipeline.",
      severity: "info",
      stage: "PARSER-FLAG",
      filePath: inputFiles[0] || "",
      line: 1,
      column: 1,
    });
  }

  // Diagnostic-stream partition (S93 fix — info-level no longer fatal).
  //
  // result.errors: fatal diagnostics that should fail the build. Includes
  //   E-* prefix codes + any diagnostic with severity:"error" + any
  //   diagnostic with no prefix/severity (defensive default).
  //
  // result.warnings: non-fatal diagnostics surfaced to the developer. Includes
  //   W-* prefix codes + severity:"warning" + I-* prefix codes +
  //   severity:"info". The non-fatal bucket carries info-level entries so
  //   the CLI exits 0 when the only "errors" are informational lints
  //   (e.g. I-AUTH-REDIRECT-UNRESOLVED on entry files whose /login page
  //   lives in a separate compile unit, I-MATCH-PROMOTABLE on if-chains
  //   over enums, etc.).
  //
  // Pre-S93 behavior treated info-level as fatal (CLI exit 1 on info-only
  // files including 07-admin-dashboard and 23-trucking-dispatch). The
  // partition rule was {W- prefix OR severity:warning} → warnings; everything
  // else → errors. Info-level fell through to errors. Now: {W-/I- prefix OR
  // severity:warning/info} → warnings.
  const isNonFatal = (e) =>
    e.code?.startsWith("W-") ||
    e.code?.startsWith("I-") ||
    e.severity === "warning" ||
    e.severity === "info";
  const errors = allErrors.filter(e => !isNonFatal(e));
  const warnings = allErrors.filter(isNonFatal);

  return {
    errors,
    warnings,
    lintDiagnostics: allLintDiagnostics,
    fileCount,
    outputDir: outputDir || "",
    durationMs,
    outputs: cgResult.outputs || new Map(),
    // v0.3.x SPA tree-shake Phase B 3.3 — runtime filename written to
    // `outputDir` (when `!embedRuntime`). Carries the content hash
    // (e.g. "scrml-runtime.a1b2c3d4.js"). Undefined when CG was not
    // exercised (e.g. fatal upstream errors); callers fall back to the
    // legacy literal `RUNTIME_FILENAME` when needed.
    runtimeFilename: cgResult.runtimeFilename,
    // W2 §21.7: the full gathered .scrml file set (after auto-gather pre-pass).
    // Equal to options.inputFiles when gather is disabled. Includes all
    // transitively-reachable .scrml files when gather is enabled.
    gatheredFiles: inputFiles,
    batchPlan: bpResult.batchPlan,
    batchPlanJson: () => serializeBatchPlan(bpResult.batchPlan),
    // Stage 7.6 — A-2.1 scaffold. The record is empty until A-2.2+.
    reachabilityRecord: rsResult.record,
    reachabilityRecordJson: () => serializeReachabilityRecord(rsResult.record),
    // Engine "what-comes-next" static sidecar (engine-graph-sidecar-2026-05-31).
    // Lazy projection of the engine state-machine metadata codegen already
    // resolves (`_record.engineMeta` on each engine-decl in `metaFiles`) into a
    // deterministic graph JSON. Written to `<base>.engine-graph.json` by
    // commands/compile.js under `--emit-engine-graph`. Honest-empty
    // (`{ "engines": [] }`) when the file declares no engines. The function form
    // mirrors `reachabilityRecordJson` / `batchPlanJson` — no cost unless called.
    engineGraphJson: () => buildEngineGraphJson(metaFiles),
    // Block-analysis PER-FILE static sidecar (block-analysis-emit-2026-06-18).
    // Lazy projection of every named block (function / component / engine / type
    // / channel) in each compiled file into its OWN deterministic JSON artifact
    // — `<base>.block-analysis.json`, written by commands/compile.js under
    // `--emit-block-analysis`. UNLIKE `engineGraphJson` (which merges all engines
    // across all files into ONE graph), this returns ONE `BlockAnalysis` PER
    // file (each carrying its own `.file` relpath + only that file's blocks), so
    // the write loop matches each input file to its own analysis and never
    // writes a merged blob. Honest-empty (`blocks: []`) for a file with no
    // leasable blocks. The function form mirrors `engineGraphJson` — no cost
    // unless called.
    blockAnalyses: () => buildBlockAnalysis(metaFiles),
    // ss54 (S229) — the `--emit-token-set` projection. ONE deterministic
    // `token-set.json` per compile: declared symbols (with kind), the §34
    // error-code set, the keyword vocab, + an fnv1a content fingerprint.
    // A READ-ONLY currency oracle for flogence's docs-drift pass — wired into
    // nothing pass/fail (constraint i), written nowhere the compiler reads back
    // (constraint ii). The function form mirrors `engineGraphJson` /
    // `reachabilityRecordJson` — no cost unless called under the CLI flag.
    tokenSetJson: () => serializeTokenSet(buildTokenSet(metaFiles)),
    // Stage 7.55 — A-3.5 wire (S91). The AuthGraph is the per-gate
    // classification surface consumed by RS Component 4 and (future)
    // A-4 per-role chunk emission. Surfaced on the return so integration
    // tests and adopter debug tools can inspect classifier output without
    // re-running the auth-graph pass.
    authGraph: agResult.graph,
    // S91 A-4.1 — per-(EP, role, tier) chunk descriptors. Present only
    // when `emitPerRoute: true` was passed AND runCG produced chunks.
    // Surface the splitter output on the public return so adopter tools
    // (and tests at A-4.1) can introspect without re-running the
    // splitter. The function form mirrors `batchPlanJson` /
    // `reachabilityRecordJson`.
    chunks: cgResult.chunks,
    chunksManifest: cgResult.chunksManifest,
    // A-4.6 — pass `cgResult.chunks` so the JSON output uses the
    // adopter-facing URL-style filename shape (matches what api.js
    // writes to chunks.json on disk).
    chunksManifestJson: () =>
      cgResult.chunksManifest
        ? serializeChunksManifest(cgResult.chunksManifest, cgResult.chunks)
        : null,
    // MCP V0 Sub-unit D — `<program mcp>` opt-in auto-activation surface.
    // Consumed by commands/compile.js (--verbose log) and commands/build.js
    // (boot-import injection into the generated _server.js).
    //   mcpAutoActivated — true when ANY fileAST in this build carries the
    //     <program mcp> attribute (and we therefore auto-flipped emitPerRoute
    //     + intend to inject the boot import); false when no mcp attribute
    //     was present.
    //   mcpMode — "dev-only" | "always" when activated; null otherwise.
    //   mcpEmitPerRouteAutoFlipped — true when adopter did NOT pass
    //     --emit-per-route but we flipped it anyway because of <program mcp>;
    //     surfaced for the --verbose log line.
    mcpAutoActivated,
    mcpMode,
    mcpEmitPerRouteAutoFlipped: mcpAutoActivated && !_emitPerRouteOpt,
  };
}
