/**
 * @module codegen/context
 *
 * CompileContext — a single object that consolidates the ad-hoc parameters
 * threaded through every codegen emitter function.
 *
 * This is a pure refactor: the fields existed before as individual parameters;
 * now they live in one place so new features don't require signature changes.
 */

import { BindingRegistry } from "./binding-registry.ts";
import type { CGError } from "./errors.ts";
import type { EncodingContext } from "./type-encoding.ts";
import type { FileAnalysis } from "./analyze.ts";
import { type ReachabilityRecord, emptyReachabilityRecord } from "../types/reachability.ts";

// Re-export EncodingContext so callers only need to import from context.ts
export type { EncodingContext };

// ---------------------------------------------------------------------------
// CompileContext — the consolidated parameter bag.
// ---------------------------------------------------------------------------

export interface CompileContext {
  filePath: string;
  fileAST: any;
  routeMap: any;
  depGraph: any;
  protectedFields: Set<string>;
  authMiddleware: any | null;
  middlewareConfig: any | null;
  csrfEnabled: boolean;
  encodingCtx: EncodingContext | null;
  mode: "browser" | "library";
  testMode: boolean;
  dbVar: string;
  workerNames: string[];
  errors: CGError[];
  registry: BindingRegistry;
  derivedNames: Set<string>;
  /**
   * Bug 61 — dotted synth-cell keys (`collectSynthCellKeys(fileAST)`) for this
   * file's compound parents. Threaded into the EmitExprContext built by the
   * onclick/event-wiring + variant-guard emitters so `@<compound>.<synthProp>`
   * reads route to the dotted synth cell. Sibling to `derivedNames`.
   */
  synthCellKeys: Set<string>;
  /**
   * Pre-computed analysis for this file from the CG analysis layer.
   *
   * Populated by analyzeAll() in analyze.ts and threaded through CompileContext
   * so emitters can use cached AST data instead of re-walking the raw AST.
   * Null in tests that construct CompileContext directly without an analysis pass.
   * All emitters MUST use the fallback pattern: `ctx.analysis?.field ?? collectOriginal()`.
   */
  analysis: FileAnalysis | null;
  /**
   * Runtime chunks needed by this file's compiled output.
   *
   * Populated by `detectRuntimeChunks(fileAST)` in emit-client.ts before
   * runtime assembly. The following chunks are always included (pre-populated
   * by the factory):
   *   - 'core'        — _scrml_reactive_get/set/subscribe (used everywhere)
   *   - 'scope'       — _scrml_register_cleanup, _scrml_destroy_scope (used by timers, meta, input)
   *   - 'errors'      — built-in error classes (NetworkError, ValidationError, etc.)
   *   - 'transitions' — CSS animation injection IIFE (small, needed by any conditional display)
   *
   * All other chunks are conditionally added by detectRuntimeChunks() in
   * emit-client.ts based on AST feature usage.
   *
   * Used only in embedded-runtime mode. External mode always emits SCRML_RUNTIME.
   */
  usedRuntimeChunks: Set<string>;
  /**
   * Phase A1c Step C15 — MOD's `exportRegistry` map plumbed into codegen so
   * cross-file engine mount sites (`<engineVarName/>` in importer markup
   * resolving to an engine-category export) can be discriminated at emit time.
   *
   * Shape: `Map<absolutePath, Map<exportName, {kind, category, isComponent}>>`.
   * Mirrors the same map B14 PASS 10.B consumes in `symbol-table.ts:3997-4066`.
   * Null when no MOD result is available (test harnesses that bypass the full
   * pipeline) — codegen's cross-file mount walker short-circuits in that case.
   *
   * SPEC §21.8 + §51.0.D — cross-file engine import via `<EngineName/>`.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | null;
  /**
   * known-gaps-#6 (S152) — MOD's `importGraph` plumbed into codegen so the
   * cross-file client module-loading lowering (Approach B, §21.3) can:
   *   (a) on the EXPORTER side, ask "is THIS file imported by another .scrml in
   *       the compile unit?" (scan for any import whose `absSource` === this
   *       file) — gates the `_scrml_modules[...] = {...}` registration footer;
   *   (b) on the IMPORTER side, resolve each local `.scrml` import's absolute
   *       path (`absSource`) so the registry key is derived identically on both
   *       sides (see `moduleRegistryKey` in emit-client.ts).
   *
   * Shape mirrors `module-resolver.js` `buildImportGraph` output:
   * `Map<absPath, { imports: Array<{ names, specifiers, absSource }> }>`.
   * Null when no MOD result is available (test harnesses that bypass MOD) — the
   * exporter footer + importer-key derivation both degrade gracefully (the
   * importer falls back to the path-relative `.client.js` key).
   */
  importGraph?: Map<string, { imports: Array<{ names: string[]; specifiers?: Array<{ imported: string; local: string }>; absSource: string }> }> | null;
  /**
   * #358 — cross-file client-reachability seed for directly-imported export
   * consts. Keyed by a module's POSIX absolute path; the value is the set of that
   * module's EXPORT names that are READ in the CLIENT code of some OTHER file in
   * the compile unit that imports them directly (`import { X } from './M.scrml'`
   * + a client read of `X`). Computed ONCE by `runCG` via
   * `collectClientReferencedIdentsForAST` (the same confidentiality-safe prune the
   * per-file #263 gate uses — a server-only import never enters the set), so both
   * the EXPORTER (make `X` client-reachable → emit + register it) and the IMPORTER
   * (keep `X` in the `_scrml_modules` destructure even when NR mis-tags the
   * all-caps const as a component) route off ONE ground-truth signal and can never
   * drift. Null for test harnesses / single-file compiles with no cross-file
   * imports — both sides then behave exactly as before (byte-identity preserved).
   */
  crossFileClientReads?: Map<string, Set<string>> | null;
  /**
   * known-gaps-#6 (S152) — the dist-output base directory, computed in api.js
   * via `computeOutputBaseDir(sourcePaths)` and threaded into codegen so the
   * exporter footer + importer read derive the SAME dist-relative
   * `_scrml_modules` key from absolute paths (handles subdir / shell `upToRoot`
   * nesting — the key is a stable identifier, NOT a URL). Null for harnesses
   * that bypass the write phase; the key derivation falls back to basename.
   */
  outputBaseDir?: string | null;
  /**
   * S89 A-2.1 — Reachability Solver output (PIPELINE Stage 7.6 / SPEC §40.9).
   *
   * Populated by `runReachabilitySolver` in `api.js` between Stage 7.5 (BP)
   * and Stage 8 (CG). At A-2.1 the record is empty for every input; A-4
   * codegen will consume per-entry-point per-role ChunkPlans once A-2.2..
   * A-2.7 land the algorithm. Optional + nullable so test harnesses that
   * bypass the full pipeline don't have to construct one — the factory
   * pre-populates with an empty record for safety.
   */
  reachabilityRecord?: ReachabilityRecord | null;
  /**
   * S91 A-4.4 — set to `true` by `emit-html.ts` when at least one
   * internal `<a href="/...">` was wired with `data-scrml-prefetch="..."`
   * during HTML emission for this file. Two downstream consumers read it:
   *
   *   1. `detectRuntimeChunks` in `emit-client.ts` activates the
   *      `prefetch` runtime chunk so `_scrml_prefetch_tier2` ships.
   *   2. `emitPerRouteChunks` in `route-splitter.ts` passes the flag
   *      into `composeInitialChunk` so the IIFE-tail hover-handler
   *      attachment block is emitted.
   *
   * Tree-shake invariant: when the flag stays `false` (no internal
   * links emitted in HTML), the `_scrml_prefetch_tier2` runtime
   * function is tree-shaken AND no hover-handler block is emitted into
   * the initial chunk. A-4.4 test §9 "Runtime function elision
   * (tree-shake dead)" pins this contract.
   *
   * Defaults to `false`. Mutated by `emit-html.ts` during the markup
   * walk (per-element check on `<a href>` against `RouteMap.pages`).
   */
  hasPrefetchableLinks?: boolean;
  /**
   * Q-OPEN-6 — set to `true` by `emit-html.ts` when the file's markup
   * contains at least one `<a href="/...">` with an absolute-path,
   * non-interpolated string-literal value (i.e. a syntactically
   * internal-shaped link), regardless of whether it resolved to a
   * known `RouteMap.pages` urlPattern.
   *
   * Distinct from `hasPrefetchableLinks`: that flag fires only when the
   * `<a href>` value resolved to a known route AND was decorated with
   * `data-scrml-prefetch`. This flag fires on the structural existence
   * of an internal-shaped link, independently of resolution outcome.
   *
   * Read by the per-route artifact splitter's `emitChunkLints` to
   * distinguish two cases for adopter-facing diagnostics:
   *   - `hasInternalLinks === false` → the file has NO internal links
   *     at all (genuinely "no prefetch possible"). Info-level
   *     `W-CG-CHUNK-NO-PREFETCH` per Q-OPEN-6.
   *   - `hasInternalLinks === true && hasPrefetchableLinks === false`
   *     → links EXIST but none resolved to RouteMap.pages (typo,
   *     missing page, or unimplemented route). Warning-level
   *     `W-CG-CHUNK-PREFETCH-UNRESOLVED` per Q-OPEN-6.
   *
   * Defaults to `false`. Mutated by `emit-html.ts` during the markup
   * walk; orthogonal to `hasPrefetchableLinks` (one can be true with
   * the other false, in either direction, depending on whether links
   * resolve).
   */
  hasInternalLinks?: boolean;
  /**
   * PGO P2.1 (S102) — sub-emit timing instrumentation gate.
   *
   * When `true`, `generateClientJs` wraps every emit* call site with a
   * `performance.now()` timing pair and accumulates totals into
   * `clientEmitTotals`. When `false` (or absent), the instrumentation
   * branch short-circuits so the flag-off baseline takes the same code
   * path as pre-instrumentation (one boolean check + a direct call).
   *
   * Plumbed from `runCG({ debugPerf })` which is itself plumbed from
   * `compileScrml({ debugPerf })` ← `--debug-perf` CLI flag (P1.5).
   *
   * Distinct from `runCG`'s outer `codegenStage`-keyed totals (which
   * track top-level emit-* call sites like emit-client, emit-html,
   * emit-server). This sub-key set decomposes the emit-client interior.
   */
  debugPerf?: boolean;
  /**
   * PGO P2.1 (S102) — log channel for `[CLIENT-EMIT]` lines. Defaults
   * to `console.log` when unset. Mirrors `runCG.log` so the test
   * harnesses + the CLI verbose-buffer share a single sink.
   */
  log?: (msg: string) => void;
  /**
   * PGO P2.1 (S102) — per-sub-emit timing accumulator. Map<name, ms>.
   *
   * Populated by `clientStage(name, fn)` in `emit-client.ts` when
   * `debugPerf === true`. Aggregated across every file processed by
   * `runCG`'s per-file loop and reported as a sorted `[CLIENT-EMIT]
   * <name>: <total>ms (<pct>% of emit-client)` breakdown after the
   * loop completes.
   *
   * `runCG` constructs the Map ONCE (outside the per-file loop) and
   * threads the same reference into every `CompileContext` so totals
   * accumulate across files. Null when `debugPerf === false` so the
   * non-instrumented hot path doesn't allocate the Map.
   */
  clientEmitTotals?: Map<string, number> | null;
}

// ---------------------------------------------------------------------------
// Factory — creates a CompileContext with sensible defaults.
// Used by tests and internal callers that only need a subset of fields.
// ---------------------------------------------------------------------------

export function makeCompileContext(partial: Partial<CompileContext> & { fileAST: any }): CompileContext {
  return {
    filePath: partial.filePath ?? partial.fileAST?.filePath ?? "",
    fileAST: partial.fileAST,
    routeMap: partial.routeMap ?? { functions: new Map() },
    depGraph: partial.depGraph ?? { nodes: new Map(), edges: [] },
    protectedFields: partial.protectedFields ?? new Set(),
    authMiddleware: partial.authMiddleware ?? null,
    middlewareConfig: partial.middlewareConfig ?? null,
    csrfEnabled: partial.csrfEnabled ?? false,
    encodingCtx: partial.encodingCtx ?? null,
    mode: partial.mode ?? "browser",
    testMode: partial.testMode ?? false,
    dbVar: partial.dbVar ?? "_scrml_sql",
    workerNames: partial.workerNames ?? [],
    errors: partial.errors ?? [],
    registry: partial.registry ?? new BindingRegistry(),
    derivedNames: partial.derivedNames ?? new Set(),
    synthCellKeys: partial.synthCellKeys ?? new Set(),
    analysis: partial.analysis ?? null,
    // Always-included runtime chunks. Additional chunks are added by
    // detectRuntimeChunks() in emit-client.ts based on feature usage.
    //
    // 'transitions' is always included because the animation keyframes
    // are needed by any conditional display with transition directives,
    // and detecting transition usage from the AST requires inspecting
    // the binding registry which may not be populated at context creation time.
    usedRuntimeChunks: partial.usedRuntimeChunks ?? new Set(['core', 'scope', 'errors', 'transitions']),
    // C15 — MOD exportRegistry, optional. Defaults to null for tests that
    // bypass the full pipeline; the C15 cross-file mount walker short-circuits
    // when null.
    exportRegistry: partial.exportRegistry ?? null,
    // known-gaps-#6 (S152) — MOD importGraph + dist outputBaseDir for the
    // cross-file _scrml_modules lowering. Default null/basename-fallback for
    // harnesses that bypass MOD / the write phase.
    importGraph: partial.importGraph ?? null,
    // #358 — cross-file client-read export names. Default null (no cross-file
    // seed) so single-file / harness compiles keep the pre-#358 code path.
    crossFileClientReads: partial.crossFileClientReads ?? null,
    outputBaseDir: partial.outputBaseDir ?? null,
    // A-2.1 — Reachability Solver record. Defaults to a fresh empty record
    // so downstream consumers (A-4 codegen wave) can read the shape without
    // a null-guard; A-2.2+ replaces this with the actual closure analysis.
    reachabilityRecord: partial.reachabilityRecord ?? emptyReachabilityRecord(),
    // A-4.4 — `<a data-scrml-prefetch>` emission flag. Defaults to false;
    // `emit-html.ts` flips it to true when at least one internal `<a href>`
    // resolves to a `RouteMap.pages` urlPattern.
    hasPrefetchableLinks: partial.hasPrefetchableLinks ?? false,
    // Q-OPEN-6 — structural-existence flag for internal-shaped `<a href>`
    // links. Defaults to false; `emit-html.ts` flips it to true on the
    // first absolute-path string-literal `<a href>` it encounters
    // (independent of whether it resolved to a known route).
    hasInternalLinks: partial.hasInternalLinks ?? false,
    // PGO P2.1 (S102) — sub-emit timing instrumentation. Defaults to
    // OFF so non-debug code paths take the same shape as before
    // instrumentation landed.
    debugPerf: partial.debugPerf ?? false,
    log: partial.log ?? console.log,
    clientEmitTotals: partial.clientEmitTotals ?? null,
  };
}
