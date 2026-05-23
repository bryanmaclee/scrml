// scrml:compiler — runtime shim (DEFERRED)
//
// Hand-written ES module mirroring stdlib/compiler/index.scrml. The .scrml
// source is an aspirational umbrella that re-exports compiler pipeline
// stages via dynamic `await import` of `../../compiler/src/api.js` and
// per-stage modules — paths relative to the .scrml file's location in the
// repo source tree.
//
// PROBLEM: When this shim is copied to `<outputDir>/_scrml/compiler.js` by
// `bundleStdlibForRun`, those source-relative paths no longer resolve. The
// scrml-tools-from-scrml story requires either (a) an installable npm
// package the shim can `import "scrml/compiler"` from, or (b) a compile-time
// path-rewriter that fixes up the imports at bundle time.
//
// Neither (a) nor (b) is in scope for the Bug 8 dispatch — the brief
// authorizes shim-only-the-working-surface for partial / aspirational
// modules.
//
// CURRENT SURFACE: every exported symbol throws a clear runtime error
// directing the caller to use the compiler as a CLI / direct API instead.
// This is loud-failure-with-attribution, not silent breakage. When a
// future dispatch lands either path (a) or (b), this shim swaps to the
// real surface.
//
// Tracked: future M16+ stdlib follow-up. Not blocking on Bug 8.

function _unavailable(name) {
  throw new Error(
    `[scrml:compiler] ${name}() is not available at runtime via the scrml:compiler shim. `
      + `The scrml:compiler umbrella module is currently DEFERRED — it requires either an installable `
      + `compiler package (scrml/compiler) or a compile-time path-rewriter for the bundled shim. `
      + `For now, invoke the compiler via the CLI (\`scrml compile\`) or import directly from `
      + `the compiler-source path in tooling code: import { compileScrml } from "<...>/compiler/src/api.js".`,
  );
}

export const compileScrml = (...args) => _unavailable("compileScrml");
export const scanDirectory = (...args) => _unavailable("scanDirectory");
export const splitBlocks = (...args) => _unavailable("splitBlocks");
export const buildAST = (...args) => _unavailable("buildAST");
export const resolveModules = (...args) => _unavailable("resolveModules");
export const runCE = (...args) => _unavailable("runCE");
export const runBPP = (...args) => _unavailable("runBPP");
export const runPA = (...args) => _unavailable("runPA");
export const runRI = (...args) => _unavailable("runRI");
export const runTS = (...args) => _unavailable("runTS");
export const runMetaChecker = (...args) => _unavailable("runMetaChecker");
export const runMetaEval = (...args) => _unavailable("runMetaEval");
export const runDG = (...args) => _unavailable("runDG");
export const runCG = (...args) => _unavailable("runCG");
export const parseExpression = (...args) => _unavailable("parseExpression");
export const extractIdentifiersFromAST = (...args) => _unavailable("extractIdentifiersFromAST");
