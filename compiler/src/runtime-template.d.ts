// runtime-template.d.ts — type declarations for runtime-template.js (S454 types gate).
// (`export declare` form so the file also transpiles as ordinary TS: repo scanners
// such as cli-listen-host.test.js transpile every compiler/src/*.ts.)
//
// The implementation stays JavaScript; this file only describes its exports to
// the TypeScript checker. Bun ignores it at run time. Keep it in step with
// runtime-template.js.

/**
 * Inline sibling-shim imports for one shim source. `emitted` is the shared set
 * of already-defined symbol names (dedup across the transitive graph); it is
 * mutated.
 */
export declare function _inlineSiblingShimImports(
  source: string,
  shimDir: string,
  emitted: Set<string>,
): { prelude: string; body: string };

/** The full client reactive runtime source text. */
export declare const SCRML_RUNTIME: string;

/** §59 value-native map/set runtime, sliced from SCRML_RUNTIME for server inlining. */
export declare const SERVER_VALUE_NATIVE_MAP_HELPER: string;

/** §45 structural-equality helper source, sliced from SCRML_RUNTIME for server inlining. */
export declare const SERVER_STRUCTURAL_EQ_SOURCE: string;

/** Runtime filename used in external mode. */
export declare const RUNTIME_FILENAME: "scrml-runtime.js";

/** S457 — the runtime URL scheme guard source (runtime-url-guard.js), inlined as the `urlguard` chunk. */
export declare const URL_GUARD_RUNTIME_SOURCE: string;
