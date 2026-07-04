/**
 * @module codegen/index
 *
 * Entry point for the Code Generator (CG, Stage 8).
 *
 * Orchestrates the three-phase execution model:
 *   1. Analyze — walk ASTs and collect per-file data (analyze.js)
 *   2. Plan   — populate BindingRegistry during HTML emission
 *   3. Emit   — generate HTML, CSS, server JS, and client JS (browser mode)
 *              OR library JS + server JS (library mode)
 *
 * Exports `runCG()` as the sole public entry point, plus `CGError` for
 * error handling by downstream stages.
 *
 * Mode: 'browser' (default) | 'library'
 *   browser: HTML + client IIFE JS + server JS (original behavior, unchanged)
 *   library: ES module exports JS + server JS (for stdlib / self-hosting)
 */

import { scanClassesFromHtml, getAllUsedCSS } from "../tailwind-classes.js";
import { collectClassNamesFromAst } from "./collect-class-names.ts";
import { basename, dirname, relative } from "path";
import { RUNTIME_FILENAME } from "../runtime-template.js";
import { assembleRuntime } from "./runtime-chunks.ts";
import { fnv1aHash } from "./fnv1a-hash.ts";
import { CGError } from "./errors.ts";

/**
 * v0.3.x SPA tree-shake Phase B 3.1 + 3.3 — runtime-filename placeholder.
 *
 * The per-file emit phase injects this token wherever the shared-runtime
 * filename would normally appear (the `// Requires: ...` clientJs comment
 * and the `<script src=...></script>` HTML tag). After the per-file loop
 * finishes, `runCG` computes the chunk union, assembles the shared
 * runtime, hashes its content (FNV-1a over canonical bytes), derives the
 * final hashed filename (e.g. `scrml-runtime.a1b2c3d4.js`), and
 * substitutes the placeholder in every per-file output.
 *
 * Substitution is unconditional even when the union assembly happens to
 * match the legacy full-runtime content; the filename always carries
 * the hash so cache-busting is deterministic across compile-unit
 * shapes. (Without this, an adopter pinning a stable `scrml-runtime.js`
 * URL would see the runtime content change silently when one of their
 * .scrml files toggled a chunk-gate predicate — exactly the cache
 * invalidation that SCOPING §5.3 (a) flags.)
 *
 * The token is intentionally distinctive (uppercase, with delimiters) to
 * avoid clashing with any user-authored string literal.
 */
const RUNTIME_FILENAME_PLACEHOLDER = "__SCRML_RUNTIME_FILENAME_PLACEHOLDER__";
import { resetVarCounter } from "./var-counter.ts";
import { enableSrcmapProvenance, disableSrcmapProvenance } from "./srcmap-provenance.ts";
import { escapeHtmlAttr } from "./utils.ts";
import { generateHtml, augmentHtmlForChunks } from "./emit-html.ts";
import { generateCss } from "./emit-css.ts";
import { generateServerJs } from "./emit-server.ts";
import { setBatchLoopHoists, setBatchInListCap } from "./emit-control-flow.ts";
import { drainMachineCodegenErrors, clearMachineCodegenErrors } from "./emit-machines.ts";
import { generateClientJs } from "./emit-client.js";
import { generateLibraryJs } from "./emit-library.ts";
import { BindingRegistry } from "./binding-registry.ts";
import { analyzeAll } from "./analyze.ts";
import { generateTestJs } from "./emit-test.ts";
import { generateMachineTestJs } from "./emit-machine-property-tests.ts";
import { generateWorkerJs } from "./emit-worker.ts";
import { appendSourceMappingUrl } from "./source-map.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { registerFileSource, resetLogLoc, fileDeclaresLog, fileDeclaresRender } from "./log-loc.ts";
import { setLogProductionStrip, setLogShadowedInFile, setRenderShadowedInFile, setSessionProjectionActive, setCurrentUserAmbientActive } from "./emit-expr.ts";
import { EncodingContext } from "./type-encoding.ts";
import { collectDerivedVarNames, collectReactiveVarNames, collectSynthCellKeys, stampCompoundDeepSetTargets } from "./reactive-deps.ts";
import { collectTopLevelLogicStatements } from "./collect.ts";
import type { CompileContext } from "./context.ts";
import type { ReachabilityRecord } from "../types/reachability.ts";
import { resolveDbDriver } from "./db-driver.ts";
import { lintCompiledForUndefined } from "./lint-undefined-interpolation.ts";
import {
  emitPerRouteChunks,
  type ChunkKey,
  type ChunkOutput,
  type ChunksManifest,
} from "./route-splitter.ts";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface CgRouteEntry {
  boundary?: string;
}

export interface CgRouteMap {
  functions: Map<string, CgRouteEntry>;
  authMiddleware?: Map<string, CgAuthMiddleware | null>;
  /**
   * §61 `<endpoint>` private-arm reachability — fnNodeIds RI's server-
   * reachability closure says to RETAIN server-side (emit-server emits each as a
   * plain `function`; the endpoint handler runs server-side, §61.6). Empty for a
   * non-endpoint app. Mirrors `RouteMap.endpointServerHelperIds`.
   */
  endpointServerHelperIds?: Set<string>;
  /**
   * §61 — the server-ONLY subset (not client-reachable). emit-functions SKIPS
   * the client body for these so a private endpoint helper never leaks to
   * `.client.js`. Mirrors `RouteMap.endpointClientSkipIds`.
   */
  endpointClientSkipIds?: Set<string>;
}

export interface CgAuthMiddleware {
  csrf?: "auto" | "off";
}

export interface CgDepGraph {
  nodes: Map<string, object>;
  edges: Array<{ from: string; to: string }>;
}

export interface CgProtectAnalysis {
  views?: Map<string, object>;
}

export interface CgInput {
  files: object[];
  routeMap?: CgRouteMap;
  depGraph?: CgDepGraph;
  protectAnalysis?: CgProtectAnalysis;
  sourceMap?: boolean;
  embedRuntime?: boolean;
  mode?: "browser" | "library";
  /** When true, generate bun:test output from ~{} test blocks. */
  testMode?: boolean;
  /**
   * §20.6 (F4=A) — production build flag. When true, the location-transparent
   * `log()` builtin strips to ZERO bytes (the dev-only convenience is removed
   * from release artefacts; mirrors `test-bind`'s 0-byte production guarantee,
   * §19.12.7). Default false (development — log() is active).
   */
  production?: boolean;
  /**
   * §51.13 — When true, generate auto-property-tests for every non-derived
   * machine declaration. Independent of testMode. Output lands on
   * `CgFileOutput.machineTestJs`.
   */
  emitMachineTests?: boolean;
  /** Enable output name encoding (§47). Default: false. */
  encoding?: boolean | {
    enabled: boolean;
    debug?: boolean;
    /** S79 audit fix A.2 — see `EncodingContext.seqCap` JSDoc. */
    __testOnly_typeEncodingSeqCap?: number;
  };
  /** Stage 7.5 BatchPlan — consumed by emit-server for Tier 1 envelopes. */
  batchPlan?: any;
  /**
   * Batch-planner errors (E-BATCH-001 / W-BATCH-001). CG uses these to
   * suppress envelope emission for handlers with composition errors.
   */
  batchPlannerErrors?: Array<{ code: string; message: string; span?: any }>;
  /**
   * Phase A1c Step C15 — MOD's `exportRegistry` map, optional. When provided,
   * codegen can identify cross-file engine mount sites (`<engineVarName/>` in
   * importer markup whose source export's category is `"engine"`) and emit
   * the §21.8 mount-position marker per SPEC §51.0.D.
   *
   * Shape: `Map<absolutePath, Map<exportName, {kind, category, isComponent}>>`.
   * Identical to the map B14 PASS 10.B consumes (`symbol-table.ts:3997-4066`).
   * Threaded into per-file `CompileContext.exportRegistry`.
   */
  exportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean }>> | null;
  /**
   * known-gaps-#6 (S152) — MOD's `importGraph` (per-file imports with resolved
   * `absSource` edges). Threaded into per-file `CompileContext.importGraph` so
   * the cross-file `_scrml_modules` lowering (Approach B, §21.3) can identify
   * exporter files (imported by another .scrml) + derive registry keys from
   * absolute paths on both sides. Also drives the topological dependency
   * `<script>` ordering in the per-entry HTML.
   */
  importGraph?: Map<string, { imports: Array<{ names: string[]; specifiers?: Array<{ imported: string; local: string }>; absSource: string }> }> | null;
  /**
   * known-gaps-#6 (S152) — dist output base directory (api.js
   * `computeOutputBaseDir(sourcePaths)`). Threaded so the cross-file
   * `_scrml_modules` key is derived as a stable dist-relative path on both the
   * importer + exporter sides. Optional; basename-fallback when absent.
   */
  outputBaseDir?: string | null;
  /**
   * S89 A-2.1 — Stage 7.6 Reachability Solver output (SPEC §40.9).
   * Threaded into per-file `CompileContext.reachabilityRecord` so the
   * A-4 codegen wave can consume per-entry-point per-role ChunkPlans.
   * Optional; falls back to an empty record when absent.
   */
  reachabilityRecord?: ReachabilityRecord | null;
  /**
   * S91 A-4.1 — Opt-in flag for the per-route artifact splitter
   * (SPEC §40.9.7). When TRUE, after the per-file Emit phase completes,
   * `runCG` invokes `emitPerRouteChunks` and surfaces the per-(EP, role,
   * tier) chunk descriptors on the output via `chunks` + `chunksManifest`.
   *
   * Default `false` per OQ-A4-F (S91 ratification): opt-in during the
   * A-4 wave development; default-on at the v0.3.0 cut release once
   * A-4.1..A-4.7 have all landed.
   *
   * When false, the splitter is NOT invoked — per-file `.client.js`
   * emission proceeds unchanged. This is the v0.2.x default behaviour.
   */
  emitPerRoute?: boolean;
  /**
   * Q-OPEN-5 — Soft size budget (bytes) for the `W-CG-CHUNK-LARGE`
   * lint. When unset (or non-positive / non-finite), the route-splitter
   * uses the v0.3 default (`CHUNK_LARGE_SOFT_BUDGET_BYTES` = 100 000)
   * so existing behavior is preserved for callers that don't thread a
   * value through.
   *
   * Surfaced via the `--chunk-size-budget=<bytes>` flag on
   * `scrml compile`; `compileScrml` in `api.js` forwards it here, and
   * `runCG` forwards it into `emitPerRouteChunks`'s
   * `EmitPerRouteInput.chunkSizeBudgetBytes`.
   */
  chunkSizeBudgetBytes?: number;
  /**
   * PGO P1.1 (S102) — opt-in sub-stage instrumentation. When TRUE, each
   * emit-* call site inside the per-file CG loop is wrapped with a
   * `performance.now()` timing pair, totals are aggregated per-emit-name
   * across all files, and a sorted `[CG-EMIT] <name>: <total>ms
   * (<percent>% of CG)` breakdown is emitted via the `log` channel after
   * the per-file loop completes.
   *
   * Default FALSE. When unset, the instrumentation branch is short-
   * circuited so the hot per-file loop incurs zero added work beyond
   * a single boolean check per emit call site.
   *
   * Plumbed from `compileScrml({ debugPerf })` in api.js, which is
   * itself wired to the `--debug-perf` CLI flag (P1.5, commit
   * 139bbc5).
   */
  debugPerf?: boolean;
  /**
   * PGO P1.1 (S102) — log channel for `[CG-EMIT]` lines. Defaults to
   * `console.log`. Threaded from `compileScrml({ log })` in api.js so
   * test harnesses + the CLI verbose-buffer share a single sink.
   */
  log?: (msg: string) => void;
}

export interface CgFileOutput {
  sourceFile: string;
  serverJs?: string | null;
  clientJs?: string | null;
  libraryJs?: string | null;
  html?: string | null;
  css?: string | null;
  /** Generated bun:test JS output from ~{} test blocks (testMode only). */
  testJs?: string | null;
  /** §51.13 generated machine property-test JS (emitMachineTests only). */
  machineTestJs?: string | null;
  /** Worker JS bundles keyed by worker name (§4.12.4). */
  workerBundles?: Map<string, string>;
  clientJsMap?: string;
  serverJsMap?: string;
}

export interface CgOutput {
  outputs: Map<string, CgFileOutput>;
  errors: CGError[];
  runtimeJs?: string | null;
  runtimeFilename?: string;
  /**
   * S91 A-4.1 — Per-(entry-point, role, tier) chunk descriptors.
   *
   * Populated only when `CgInput.emitPerRoute === true` AND the input
   * `reachabilityRecord` carries closure entries. At A-4.1 each chunk
   * has `payloadJs: ""` (empty placeholder body) and a placeholder
   * `chunkHash = "00000000"`; A-4.2 populates the initial-tier payload
   * and A-4.6 lands real content-addressed hashes.
   *
   * Absent (undefined) when the splitter is not invoked.
   */
  chunks?: Map<ChunkKey, ChunkOutput>;
  /**
   * S91 A-4.1 — Per-app chunks.json manifest shape per OQ-A4-A (always-
   * emit when the flag is set).
   *
   * Absent (undefined) when the splitter is not invoked.
   */
  chunksManifest?: ChunksManifest;
}

/**
 * known-gaps-#6 (S152, Approach B) — compute the ordered dependency
 * `<script src>` paths for an entry's HTML.
 *
 * scrml loads `.client.js` as CLASSIC <script>s, so a page that imports from
 * another `.scrml` needs the dependency `.client.js` files loaded BEFORE its
 * own (so each dependency's `_scrml_modules[...] = {...}` footer registers
 * before the importer's `const { x } = _scrml_modules[...]` read runs).
 *
 * Returns the dependency `.client.js` paths in TOPOLOGICAL order (deps first),
 * de-duplicated, each relative to the entry HTML's dist directory (so the
 * `<script src>` resolves regardless of how deeply the entry / dep are nested
 * in the output tree). Empty when the file has no transitive `.scrml` deps or
 * the importGraph is unavailable.
 *
 * The DFS post-order over the importGraph yields deps-before-importer ordering;
 * circular imports cannot occur (forbidden at MOD, E-IMPORT-002), so the
 * `visiting` guard is a defensive backstop, not a load-bearing cycle-breaker.
 */
function computeDependencyClientScripts(
  entryFilePath: string,
  importGraph: Map<string, { imports: Array<{ source?: string; absSource: string }> }> | null,
  outputBaseDir: string | null,
): string[] {
  if (!importGraph || !entryFilePath) return [];

  // Dist dir of the entry HTML — `<script src>` paths are relative to it.
  const entryDistDir = outputBaseDir
    ? dirname(relative(outputBaseDir, entryFilePath))
    : "";

  const ordered: string[] = []; // absolute .scrml dep paths, deps-first
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (absScrml: string): void => {
    if (done.has(absScrml) || visiting.has(absScrml)) return;
    visiting.add(absScrml);
    const entry = importGraph.get(absScrml);
    if (entry && Array.isArray(entry.imports)) {
      for (const imp of entry.imports) {
        // Only LOCAL relative `.scrml` dependencies participate in the
        // `_scrml_modules` registry + get a dependency <script>. Stdlib
        // (`scrml:NAME`) imports resolve via the `_scrml_stdlib` registry +
        // the bundled `_scrml/<name>.js` shim (NOT a `.client.js`); `vendor:`
        // imports resolve against the vendor dir; `.js` imports via the
        // bundler. Filtering on the SOURCE specifier (not the resolved
        // `absSource`, which ends in `.scrml` for stdlib too) prevents a
        // dangling `<script src=".../stdlib/<name>/index.client.js">` 404.
        const src = imp.source;
        const isLocalScrml =
          typeof src === "string" &&
          (src.startsWith("./") || src.startsWith("../")) &&
          src.endsWith(".scrml") &&
          typeof imp.absSource === "string" &&
          imp.absSource.endsWith(".scrml");
        if (isLocalScrml) {
          visit(imp.absSource);
        }
      }
    }
    visiting.delete(absScrml);
    if (!done.has(absScrml)) {
      done.add(absScrml);
      // Exclude the entry itself — its own <script> is emitted separately.
      if (absScrml !== entryFilePath) ordered.push(absScrml);
    }
  };
  visit(entryFilePath);

  // Map each dep's absolute .scrml path to a `<script src>` relative to the
  // entry HTML's dist dir. Both the dep + entry dist paths are
  // `relative(outputBaseDir, ...)`, so the inter-file relative path is stable
  // regardless of nesting depth (handles the shell-composition `upToRoot` case
  // by construction). Fallback (no outputBaseDir): basename siblings.
  return ordered.map((depAbs) => {
    const depClient = depAbs.replace(/\.scrml$/, ".client.js");
    if (!outputBaseDir) return basename(depClient);
    const depDist = relative(outputBaseDir, depClient);
    // Relative path from the entry HTML's dist dir to the dep's dist file,
    // POSIX-normalized. A same-dir sibling yields a bare basename (matching the
    // entry's own `<script src="${base}.client.js">` form); a nested dep yields
    // `sub/dep.client.js` or `../dep.client.js`.
    const rel = relative(entryDistDir, depDist).split(/[\\/]/).join("/");
    return rel;
  });
}

/**
 * known-gaps-#6 (S152) — does this file participate in cross-file local
 * `.scrml` linking? True when it imports a local relative `.scrml` (an importer
 * that emits `_scrml_modules` registry reads) OR is imported by another `.scrml`
 * (an exporter that emits a registration footer). Used to gate the per-file
 * IIFE wrap that scopes the file's top-level `const`/`function` declarations so
 * they do not collide in the SHARED global lexical environment of classic
 * <script>s (two scripts each declaring top-level `const X` → "Identifier 'X'
 * has already been declared"). Single-file apps are NOT linked → not wrapped
 * (zero behavior change).
 */
function isCrossFileLinked(
  filePath: string,
  importGraph: Map<string, { imports: Array<{ source?: string; absSource: string }> }> | null,
): boolean {
  if (!importGraph || !filePath) return false;
  // (a) this file imports a local relative `.scrml`?
  const own = importGraph.get(filePath);
  if (own && Array.isArray(own.imports)) {
    for (const imp of own.imports) {
      const src = imp.source;
      if (typeof src === "string" && (src.startsWith("./") || src.startsWith("../")) && src.endsWith(".scrml")) {
        return true;
      }
    }
  }
  // (b) this file is imported by another `.scrml`?
  for (const [, entry] of importGraph) {
    if (!entry || !Array.isArray(entry.imports)) continue;
    for (const imp of entry.imports) {
      if (imp.absSource === filePath) return true;
    }
  }
  return false;
}

/**
 * known-gaps-#6 (S152) — wrap a cross-file-linked file's client.js BODY in an
 * IIFE so its top-level `const`/`function` declarations are local (not in the
 * shared global lexical env). The `_scrml_modules[key] = {...}` footer + the
 * runtime shared-global ASSIGNMENTS (e.g. `_scrml_lift_target = ...`) still
 * reach the global registry/runtime (assignments, not declarations, escape the
 * IIFE). The `// Requires: <runtime>` header line is preserved OUTSIDE the IIFE
 * (it is a comment the dev server reads to wire the runtime <script>).
 */
function wrapClientBodyInIife(clientJs: string): string {
  const reqPrefix = "// Requires: ";
  const nl = clientJs.indexOf("\n");
  if (clientJs.startsWith(reqPrefix) && nl !== -1) {
    const header = clientJs.slice(0, nl + 1);
    const body = clientJs.slice(nl + 1);
    return `${header}(function() {\n${body}\n})();\n`;
  }
  return `(function() {\n${clientJs}\n})();\n`;
}

/**
 * Run the Code Generator (CG, Stage 8).
 */
export function runCG(input: CgInput): CgOutput {
  const {
    files,
    routeMap,
    depGraph,
    protectAnalysis,
    embedRuntime = false,
    sourceMap = false,
    mode = "browser",
    testMode = false,
    emitMachineTests = false,
    encoding: encodingInput = false,
    batchPlan = null,
    batchPlannerErrors = [],
    exportRegistry: exportRegistryInput = null,
    importGraph: importGraphInput = null,
    outputBaseDir: cgOutputBaseDir = null,
    reachabilityRecord: reachabilityRecordInput = null,
    emitPerRoute = false,
    chunkSizeBudgetBytes,
    debugPerf = false,
    // §20.6 (F4=A) — production strip toggle for the log() builtin. When
    // true, log() lowers to ZERO bytes (the dev convenience strips out of
    // release artefacts; mirrors the test-bind 0-byte production guarantee,
    // §19.12.7). Threaded into EmitLogicOpts.production -> EmitExprContext.
    production = false,
    log = console.log,
  } = input;

  // §20.6 — fresh per-compile log() file:line source registry.
  resetLogLoc();
  // §20.6 (F4=A) — set the compile-wide log() production-strip flag.
  setLogProductionStrip(production);

  // Resolve encoding configuration (§47)
  const encodingOpts = typeof encodingInput === "object"
    ? encodingInput
    : { enabled: encodingInput ?? false };

  // ---------------------------------------------------------------------------
  // PGO P1.1 (S102) — sub-stage timing instrumentation.
  //
  // `codegenStage(name, fn)` mirrors api.js:559's `stage()` shape but
  // accumulates per-emit totals into a Map across all files so the
  // post-loop reporter can rank the hot emit paths. Hard-gated on
  // `debugPerf` so the flag-off baseline takes the SAME code path as
  // pre-instrumentation (one boolean check + a direct call). When the
  // flag is set, each emit call site adds two `performance.now()`
  // reads + one Map upsert — small constant overhead, identical
  // structure across all sites.
  //
  // Naming convention: short, stable strings (e.g. "emit-html",
  // "emit-server") so the reporter's left column lines up across runs
  // and PGO P2.1 can cite the names directly when deep-diving the
  // top-3 hottest paths.
  // ---------------------------------------------------------------------------
  const cgEmitTotals: Map<string, number> = debugPerf ? new Map() : (null as any);
  function codegenStage<T>(name: string, fn: () => T): T {
    if (!debugPerf) return fn();
    const start = performance.now();
    const result = fn();
    const elapsed = performance.now() - start;
    cgEmitTotals.set(name, (cgEmitTotals.get(name) ?? 0) + elapsed);
    return result;
  }
  const cgStart = debugPerf ? performance.now() : 0;

  // PGO P2.1 (S102) — second-level decomposition INSIDE emit-client.
  // S94 perf characterization (CLOSURE-ANALYSIS-COST.md) flagged emit-client
  // as ~91% of CG (~38× the next-hottest emit-* path). Phase 2.1 instruments
  // each emit*() call site inside `generateClientJs` so the top-3 hottest
  // sub-emits surface as load-bearing data for Phase 3 chip-aways.
  //
  // The same Map reference is threaded into every per-file `CompileContext`
  // so totals accumulate across the per-file loop. Sub-emit name keys are
  // short ("emit-functions", "emit-bindings", ...) so the reporter columns
  // line up across runs.
  const clientEmitTotals: Map<string, number> | null = debugPerf ? new Map() : null;

  resetVarCounter();

  // B1 use-site source-map provenance (source-map-use-site-spans-b1-2026-05-31).
  // Marker emission is a module-level gate so the ~50 EmitExprContext build sites
  // need no threading. Set ONLY for a sourceMap compile so all non-sourceMap
  // output (the default — entire test corpus) stays byte-identical and pays no
  // scan/strip cost. Set unconditionally each compile so a prior sourceMap run
  // can never leak the enabled flag into a later non-sourceMap run.
  if (sourceMap) enableSrcmapProvenance();
  else disableSrcmapProvenance();

  // §51.5.1 (S28 slice 3) — clear the machine-codegen error buffer before
  // this compile. Entries accumulated during emitTransitionGuard are drained
  // into `errors` after the per-file loop finishes.
  clearMachineCodegenErrors();

  const outputs = new Map<string, CgFileOutput>();
  const errors: CGError[] = [];
  // S91 A-4.1 — per-file CompileContext map, populated during the per-
  // file Plan/Emit phase. Passed to the route-splitter when
  // `emitPerRoute` is set so future A-4.2+ sub-phases can read per-file
  // analysis state when composing chunk payloads. Unused at A-4.1.
  const cgContextByFile = new Map<string, CompileContext>();

  // Validate inputs
  if (!files || files.length === 0) {
    return { outputs, errors };
  }

  const safeRouteMap: CgRouteMap = routeMap ?? { functions: new Map() };
  const safeDepGraph: CgDepGraph = depGraph ?? { nodes: new Map(), edges: [] };

  // §8.10 Tier 2 — register LoopHoist map keyed by for-stmt node id so
  // emit-control-flow can rewrite matched loops at emission time.
  if (batchPlan && Array.isArray((batchPlan as any).loopHoists) && (batchPlan as any).loopHoists.length > 0) {
    const map = new Map<string | number, any>();
    for (const h of (batchPlan as any).loopHoists) {
      if (h && h.loopNode != null) map.set(h.loopNode, h);
    }
    setBatchLoopHoists(map);
  } else {
    setBatchLoopHoists(null);
  }

  // Analysis pass: collect all data from AST before emission begins.
  const { fileAnalyses, protectedFields } = analyzeAll({
    files,
    routeMap: safeRouteMap,
    depGraph: safeDepGraph,
    protectAnalysis,
  });

  // Validate dependency graph edges reference known node IDs
  if (safeDepGraph.nodes && safeDepGraph.edges) {
    for (const edge of safeDepGraph.edges) {
      if (!safeDepGraph.nodes.has(edge.from)) {
        errors.push(new CGError(
          "E-CG-003",
          `E-CG-003: Internal: dependency graph references unknown source node '${edge.from}'. This is likely a compiler bug — please report it with your .scrml file.`,
          { file: "", start: 0, end: 0, line: 0, col: 0 },
        ));
      }
      if (!safeDepGraph.nodes.has(edge.to)) {
        errors.push(new CGError(
          "E-CG-003",
          `E-CG-003: Internal: dependency graph references unknown target node '${edge.to}'. This is likely a compiler bug — please report it with your .scrml file.`,
          { file: "", start: 0, end: 0, line: 0, col: 0 },
        ));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Worker extraction pre-pass (§4.12.4): find nested <program name="...">
  // nodes, extract them from parent ASTs, and compile as separate bundles.
  // ---------------------------------------------------------------------------
  const workerBundlesPerFile = new Map<string, Map<string, string>>();

  for (const fileAST of files) {
    const filePath = (fileAST as any).filePath as string;
    // §20.6 — register this file's source so the log() lowering can resolve
    // an author-visible file:line from the call node's byte offset.
    registerFileSource(filePath, ((fileAST as any)?._sourceText ?? "") as string);
    // §20.6 (shadowing) — a file-level `function log` shadows the builtin
    // across this whole file; the log() lowering then yields + lints.
    setLogShadowedInFile(fileDeclaresLog(fileAST));
    // ss16 C3 — a file-level `function render` shadows the render() client
    // component-render builtin; the render() hijack then yields to the user fn
    // (so the §47 name-encoding + fnNameMap post-pass repairs the call site).
    setRenderShadowedInFile(fileDeclaresRender(fileAST));
    // g-markup-session-read-undeclared — default the `@session` projection-active
    // flag OFF; worker bundles carry no auth session projection. Re-set per-file
    // in the main emit loop once auth middleware is resolved.
    setSessionProjectionActive(false);
    // §52 (S233) — default the `@currentUser` ambient OFF in worker bundles
    // (re-set per-file in the main emit loop). A worker carries no session.
    setCurrentUserAmbientActive(false);
    const nodes: any[] = (fileAST as any).ast?.nodes ?? (fileAST as any).nodes ?? [];

    interface WorkerDef {
      name: string;
      children: any[];
      whenMessage: any | null;
    }

    const workerDefs = new Map<string, WorkerDef>();

    function extractWorkerPrograms(parentChildren: any[]): void {
      for (let i = parentChildren.length - 1; i >= 0; i--) {
        const node = parentChildren[i];
        if (!node || typeof node !== "object") continue;

        if (node.kind === "markup" && node.tag === "program") {
          const attrs: any[] = node.attributes ?? node.attrs ?? [];
          const nameAttr = attrs.find((a: any) => a.name === "name");
          if (nameAttr) {
            const nameVal = nameAttr.value;
            let workerName: string | null = null;
            if (nameVal?.kind === "string-literal") {
              workerName = nameVal.value;
            } else if (nameVal?.kind === "variable-ref") {
              workerName = (nameVal.name ?? "").replace(/^@/, "");
            }
            if (workerName) {
              // §23.4 — a nested <program> declaring a `port=` (and not
              // `mode="wasm"`) is a SIDECAR process, NOT a §4.12.4 web worker.
              // The sidecar runtime is Nominal/spec-ahead (the `use foreign:`
              // import already failed closed with E-FOREIGN-SIDECAR-NOMINAL);
              // compiling it as a `new Worker("<name>.worker.js")` referencing a
              // never-emitted bundle is the misleading client stub the fail-closed
              // build must NOT produce. Splice it out WITHOUT registering a worker
              // (no `new Worker`, no main-scope export hoist of `predict`).
              const hasPort = attrs.some((a: any) => a.name === "port");
              const modeAttr = attrs.find((a: any) => a.name === "mode");
              const modeVal = modeAttr?.value?.kind === "string-literal"
                ? modeAttr.value.value
                : (typeof modeAttr?.value === "string" ? modeAttr.value : null);
              if (hasPort && modeVal !== "wasm") {
                parentChildren.splice(i, 1);
                continue;
              }
              const children: any[] = node.children ?? [];
              let whenMessage: any | null = null;
              for (const child of children) {
                if (child?.kind === "logic") {
                  for (const stmt of (child.body ?? [])) {
                    if (stmt?.kind === "when-message") {
                      whenMessage = stmt;
                      break;
                    }
                  }
                }
                if (whenMessage) break;
              }
              workerDefs.set(workerName, { name: workerName, children, whenMessage });
              parentChildren.splice(i, 1);
              continue;
            }
          }
        }

        if (node.kind === "markup" && (node.children?.length > 0)) {
          extractWorkerPrograms(node.children);
        }
      }
    }

    // §40.7 documentary-attrs-on-nested-program detection (Phase A1a, 2026-05-05).
    // Walk all <program> nodes; the FIRST top-level <program> is the document
    // root (its documentary attrs emit head metadata in the head-emission pass
    // below). Any deeper <program> with one of the five documentary attrs
    // (title, description, version, author, license) emits W-PROGRAM-TITLE-NESTED.
    // Runs BEFORE extractWorkerPrograms() so worker-program nodes are still in
    // tree and discoverable.
    const DOC_ATTR_NAMES = ["title", "description", "version", "author", "license"];
    function detectNestedDocAttrs(parentChildren: any[], depth: number): void {
      for (const node of parentChildren) {
        if (!node || typeof node !== "object") continue;
        if (node.kind === "markup" && node.tag === "program") {
          if (depth >= 1) {
            // Nested <program> — check for documentary attrs
            const attrs: any[] = node.attributes ?? node.attrs ?? [];
            const offending = attrs.filter((a: any) =>
              DOC_ATTR_NAMES.includes(a.name) &&
              a.value && a.value.kind === "string-literal" &&
              typeof a.value.value === "string" && a.value.value !== ""
            );
            for (const a of offending) {
              const span = (a.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 0, col: 0 });
              errors.push(new CGError(
                "W-PROGRAM-TITLE-NESTED",
                `W-PROGRAM-TITLE-NESTED: Documentary attribute \`${a.name}=\` on a nested ` +
                `<program> has no effect — workers have no DOM <head>. Move \`${a.name}=\` to ` +
                `the top-level <program> or remove it. (§40.7)`,
                { file: filePath, start: span.start ?? 0, end: span.end ?? 0, line: span.line ?? 0, col: span.col ?? 0 },
                "warning",
              ));
            }
          }
          // Recurse into nested program children at the next depth
          if (Array.isArray(node.children)) {
            detectNestedDocAttrs(node.children, depth + 1);
          }
          continue;
        }
        if (node.kind === "markup" && Array.isArray(node.children) && node.children.length > 0) {
          detectNestedDocAttrs(node.children, depth);
        }
      }
    }
    detectNestedDocAttrs(nodes, 0);

    extractWorkerPrograms(nodes);

    if (workerDefs.size > 0) {
      const bundles = new Map<string, string>();
      for (const [name, def] of workerDefs) {
        bundles.set(name, codegenStage("emit-worker", () =>
          generateWorkerJs(name, def.children, def.whenMessage)
        ));
      }
      workerBundlesPerFile.set(filePath, bundles);
    }

    // §4.12.6: DB scope annotation — tag children of <program db="..."> with _dbScope.
    // §44.2: classify the db= URI into a driver kind (sqlite | postgres | mysql).
    // Unsupported prefixes (e.g. mongodb://) emit E-SQL-005 at compile time.
    let dbScopeCounter = 0;
    function annotateDbScopes(parentChildren: any[]): void {
      for (const node of parentChildren) {
        if (!node || typeof node !== "object") continue;
        if (node.kind === "markup" && node.tag === "program") {
          const attrs: any[] = node.attributes ?? node.attrs ?? [];
          const dbAttr = attrs.find((a: any) => a.name === "db");
          const nameAttr = attrs.find((a: any) => a.name === "name");
          if (dbAttr && !nameAttr) {
            // Scoped DB context — tag all children with the scoped DB variable
            const dbVal = dbAttr.value?.value ?? dbAttr.value?.name ?? "";
            const scopedDbVar = `_scrml_sql_${++dbScopeCounter}`;
            // §44.2 driver resolution — emit E-SQL-005 on unsupported prefix.
            // On error we still annotate the scope (with driver=sqlite default)
            // so downstream codegen does not crash; the user sees the diagnostic.
            const driverResult = resolveDbDriver(dbVal);
            let driver: "sqlite" | "postgres" | "mysql" = "sqlite";
            if (driverResult.ok) {
              driver = driverResult.info.driver;
            } else {
              const span = (dbAttr.span ?? (node as any).span ?? { file: filePath, start: 0, end: 0, line: 0, col: 0 });
              errors.push(new CGError(
                driverResult.error.code,
                driverResult.error.message,
                { file: filePath, start: span.start ?? 0, end: span.end ?? 0, line: span.line ?? 0, col: span.col ?? 0 },
              ));
            }
            (node as any)._dbScope = { dbVar: scopedDbVar, connectionString: dbVal, driver };
            // Tag all descendant logic/sql nodes
            function tagDescendants(children: any[]): void {
              for (const child of children) {
                if (!child) continue;
                (child as any)._dbVar = scopedDbVar;
                if (child.children) tagDescendants(child.children);
                if (child.body && Array.isArray(child.body)) {
                  for (const stmt of child.body) {
                    if (stmt) (stmt as any)._dbVar = scopedDbVar;
                  }
                }
              }
            }
            tagDescendants(node.children ?? []);
          }
        }
        if (node.kind === "markup" && node.children?.length > 0) {
          annotateDbScopes(node.children);
        }
      }
    }
    annotateDbScopes(nodes);
  }

  // Process each file
  for (const fileAST of files) {
    const filePath = (fileAST as any).filePath as string;
    // §20.6 — register this file's source for log() file:line resolution.
    registerFileSource(filePath, ((fileAST as any)?._sourceText ?? "") as string);
    // §20.6 (shadowing) — a file-level `function log` shadows the builtin
    // across this whole file; the log() lowering then yields + lints.
    setLogShadowedInFile(fileDeclaresLog(fileAST));
    // ss16 C3 — a file-level `function render` shadows the render() builtin.
    setRenderShadowedInFile(fileDeclaresRender(fileAST));
    // g-markup-session-read-undeclared — default OFF; re-set after auth-MW
    // resolution below (needs `authMW`, resolved later in this iteration).
    setSessionProjectionActive(false);
    // §52 (S233) — default the `@currentUser` ambient OFF; re-set per-file below.
    setCurrentUserAmbientActive(false);
    const analysis = fileAnalyses.get(filePath);
    const nodes: object[] = analysis ? (analysis as any).nodes : [];

    // Bug B (structural-compound deep-set mistarget): stamp each
    // `reactive-nested-assign` whose target is a Variant C structural
    // compound parent with its TRUE write destination (the backing LEAF
    // cell key + residual path), so emit-logic writes `a.ref` not the
    // derived composite `a` (SPEC §6.3.2). In-place on the shared AST
    // nodes; no-op when the file has no compound parents.
    stampCompoundDeepSetTargets(fileAST as Record<string, unknown>);

    // Check for unknown types in nodeTypes
    if ((fileAST as any).nodeTypes) {
      for (const [nodeId, type] of (fileAST as any).nodeTypes as Map<string, any>) {
        if (type && type.kind === "unknown") {
          errors.push(new CGError(
            "E-CG-001",
            `E-CG-001: Internal: node '${nodeId}' has an unrecognized type. ` +
            `This is likely a compiler bug — please report it with your .scrml file.`,
            { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
      }
    }

    // Resolve auth middleware for this file (from RI output)
    const authMW = safeRouteMap.authMiddleware?.get(filePath) ?? null;
    // g-markup-session-read-undeclared (S228 ruling) — the `@session` window-
    // scoped auth projection (emit-client.ts `var session = ...`) is emitted iff
    // auth middleware is configured for this file. When active AND the file does
    // not declare a user reactive cell named `session` (which would otherwise own
    // the `@session` read), a CLIENT-mode `@session` read lowers to the bare
    // projection var `session` instead of `_scrml_reactive_get("session")` (the
    // latter reads an unregistered reactive key → undefined → `.current` crash).
    setSessionProjectionActive(authMW !== null && !collectReactiveVarNames(fileAST).has("session"));
    // §20.5 / §52 (S233) — the `@currentUser` ambient identity cell is active iff
    // the file declares NO user reactive cell named `currentUser` (which would own
    // the `@currentUser` read). When active, a SERVER-mode `@currentUser` read
    // lowers to the handler-scoped `_scrml_currentUser` binding (the session-
    // resolved identity); when a user `<currentUser>` cell shadows the name it
    // keeps the ordinary reactive / request-body form. Mirrors the @session gate.
    setCurrentUserAmbientActive(!collectReactiveVarNames(fileAST).has("currentUser"));
    // Resolve §39 middleware config from AST (compiler-auto tier)
    const middlewareCfg = (fileAST as any).middlewareConfig ?? null;

    // S79 audit fix C.2 — apply per-file <program batch-in-list-cap=> override
    // to the emit-control-flow module-level cap. Reset to null after the file
    // is emitted (mirrors setBatchLoopHoists lifecycle).
    {
      const rawCap = middlewareCfg?.batchInListCap;
      if (typeof rawCap === "string" && /^\d+$/.test(rawCap.trim())) {
        const n = parseInt(rawCap.trim(), 10);
        if (Number.isFinite(n) && n > 0) {
          setBatchInListCap(n);
        } else {
          setBatchInListCap(null);
        }
      } else {
        setBatchInListCap(null);
      }
    }

    // ---------------------------------------------------------------------------
    // Generate server JS — emitted in both browser and library mode.
    // ---------------------------------------------------------------------------
    // ss19 #9 (g-db-src-compile-vs-runtime-path) — thread the project root
    // (outputBaseDir = the runtime cwd) onto fileAST so emit-server can express
    // the emitted `sqlite:` path relative to a CONSISTENT base. Without this, a
    // <page> in a subdir (`src="../m.db"`) and the root entry (`src="./m.db"`)
    // reference the same physical db at compile time but emit DIFFERENT runtime
    // paths → the subdir page opens a different (empty) file from the project
    // root. null for legacy single-file callers (handled verbatim downstream).
    (fileAST as any)._outputBaseDir = cgOutputBaseDir;
    let serverJs: string | null = codegenStage("emit-server", () =>
      // §14.8.9 — thread the PA stage's ProtectAnalysis so emit-server can apply
      // protected-column egress redaction (server-fn response + SSR /__serverLoad).
      generateServerJs(fileAST, safeRouteMap, errors, authMW, middlewareCfg, batchPlan, batchPlannerErrors, mode, protectAnalysis)
    ) || null;

    // ---------------------------------------------------------------------------
    // Generate CSS — emitted in both modes.
    // ---------------------------------------------------------------------------
    const userCss: string = codegenStage("emit-css", () =>
      generateCss(nodes, analysis?.cssBlocks, errors)
    ) || "";

    // ---------------------------------------------------------------------------
    // LIBRARY MODE — emit ES module exports, skip HTML and browser client JS
    // ---------------------------------------------------------------------------
    if (mode === "library") {
      const libCtx: CompileContext = {
        filePath,
        fileAST,
        routeMap: safeRouteMap,
        depGraph: safeDepGraph,
        protectedFields,
        authMiddleware: authMW,
        middlewareConfig: middlewareCfg,
        csrfEnabled: false,
        encodingCtx: null,
        mode,
        testMode,
        dbVar: "_scrml_sql",
        workerNames: [],
        errors,
        registry: new BindingRegistry(),
        derivedNames: collectDerivedVarNames(fileAST),
        synthCellKeys: collectSynthCellKeys(fileAST),
        analysis: analysis ?? null,
        reachabilityRecord: reachabilityRecordInput,
      };
      const libraryJs: string | null = codegenStage("emit-library", () =>
        generateLibraryJs(libCtx)
      ) || null;

      const css: string | null = userCss || null;

      let serverJsMap: string | null = null;
      const base = basename(filePath, ".scrml");
      if (sourceMap) {
        const sourceBasename = `${base}.scrml`;
        // source-map-real-provenance-js-2026-05-31 — real per-line provenance
        // (was: addMapping(i, 0, 0) mapping every output line to source 0:0).
        // The per-file source string rides on the TAB result as `_sourceText`
        // (threaded in api.js via sourceByFile); byte-offset->line/col is exact
        // and sourcesContent is embedded. Falls back to "" only for harnesses
        // that bypass the full pipeline (map is then honestly all-synthetic
        // rather than a fake 0:0).
        const fileSource: string = (fileAST as any)?._sourceText ?? "";
        if (serverJs) {
          const serverMapFile = `${base}.server.js.map`;
          const { builder: serverMapBuilder, cleanedJs: serverClean } =
            buildSourceMap(serverJs, sourceBasename, fileSource, nodes);
          serverJs = serverClean; // ship the marker-stripped JS
          serverJsMap = serverMapBuilder.generate(`${base}.server.js`);
          serverJs = appendSourceMappingUrl(serverJs, serverMapFile);
        }
      }

      const fileWorkerBundles = workerBundlesPerFile.get(filePath);
      const libOutput: CgFileOutput = {
        sourceFile: filePath,
        libraryJs,
        serverJs,
        css,
        ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
        ...(serverJsMap !== null && { serverJsMap }),
      };
      outputs.set(filePath, libOutput);
      continue;
    }

    // ---------------------------------------------------------------------------
    // BROWSER MODE (default) — HTML + client IIFE JS + server JS
    // ---------------------------------------------------------------------------

    const hasServerFns = [...safeRouteMap.functions.entries()].some(
      ([id, route]) => id.startsWith(filePath + "::") && route.boundary === "server"
    );
    const csrfEnabled = authMW !== null ? authMW.csrf === "auto" : hasServerFns;

    const registry = new BindingRegistry();

    const fileWorkerNames = workerBundlesPerFile.has(filePath)
      ? [...workerBundlesPerFile.get(filePath)!.keys()]
      : [];

    // Construct CompileContext early so all emitters can use it.
    // encodingCtx starts null and is set after HTML gen.
    const compileCtx: CompileContext = {
      filePath,
      fileAST,
      routeMap: safeRouteMap,
      depGraph: safeDepGraph,
      protectedFields,
      authMiddleware: authMW,
      middlewareConfig: middlewareCfg,
      csrfEnabled,
      encodingCtx: null,
      mode,
      testMode,
      dbVar: "_scrml_sql",
      workerNames: fileWorkerNames,
      errors,
      registry,
      derivedNames: collectDerivedVarNames(fileAST),
      synthCellKeys: collectSynthCellKeys(fileAST),
      analysis: analysis ?? null,
      usedRuntimeChunks: new Set(['core', 'scope', 'errors', 'transitions']),
      // C15 — propagate MOD exportRegistry per-file so emit-engine.ts can
      // discriminate cross-file engine mount sites from local components / HTML.
      exportRegistry: exportRegistryInput,
      // known-gaps-#6 (S152) — propagate MOD importGraph + dist outputBaseDir
      // so emit-client's cross-file _scrml_modules footer/read derive a stable,
      // identical dist-relative registry key on both the exporter + importer
      // sides. outputBaseDir is computed below from the compile-unit source set.
      importGraph: importGraphInput,
      outputBaseDir: cgOutputBaseDir,
      // A-2.1 — propagate Stage 7.6 ReachabilityRecord per-file; A-4 codegen
      // will consume per-entry-point per-role ChunkPlans. Empty until A-2.2+.
      reachabilityRecord: reachabilityRecordInput,
      // PGO P2.1 (S102) — threaded so `emit-client.ts:clientStage` can
      // gate timing on the same `debugPerf` flag, route output through
      // the same `log` sink, and accumulate per-sub-emit totals into a
      // SHARED Map (one instance for the whole runCG invocation, reused
      // across every per-file compileCtx).
      debugPerf,
      log,
      clientEmitTotals,
    };

    const hasMarkup = (analysis as any)?.markupNodes?.length > 0;
    // Bug R18: After meta-eval, emit() may replace meta blocks with text nodes
    // that have no sibling markup. Check for any renderable content, not just
    // markup nodes.
    const hasRenderableContent = hasMarkup || nodes.some((n: any) =>
      n && typeof n === "object" && (
        (n.kind === "text" && typeof n.value === "string" && n.value.trim() !== "") ||
        (n.kind === "text" && typeof n.text === "string" && n.text.trim() !== "") ||
        n.kind === "state" ||
        n.kind === "if-chain" ||
        // Phase A10 (S78, 2026-05-10) — engine-decl emits a mount slot at
        // its source position when its body has any non-empty arm; gate
        // HTML generation on engine-only files too. emit-html.ts:emitNode
        // dispatches engine-decl to emit-engine.ts:emitEngineMountHtml.
        n.kind === "engine-decl" ||
        // S130 HU-1 iteration Landing 1 — each-block emits a mount slot
        // mirror of engine-decl + match-block. Gate HTML generation on
        // each-block presence so iteration-only files (no markup, no
        // engine) still produce the mount placeholder.
        n.kind === "each-block"
      )
    );
    const htmlBody: string | null = hasRenderableContent
      ? codegenStage("emit-html", () => generateHtml(nodes, compileCtx))
      : null;

    // Bug 17 (SPEC §26.1): collect Tailwind utility class names from BOTH the
    // emitted static HTML AND the source AST. The HTML scan covers `class="..."`
    // on top-level markup; the AST walker covers class names reachable ONLY
    // through `${ for ... lift <markup class="..."> }` iteration bodies and
    // sibling control-flow shapes (if-stmt, match-stmt, etc.) — those bodies
    // are emitted as `_scrml_lift(() => { el.setAttribute("class", "...") })`
    // factory JS, NOT as static HTML, so a pure HTML scan misses them.
    let tailwindCss = "";
    codegenStage("emit-tailwind", () => {
      const usedClasses = new Set<string>();
      if (htmlBody) {
        for (const cls of scanClassesFromHtml(htmlBody)) usedClasses.add(cls);
      }
      // Even with no static HTML body, an engine-only file can carry markup
      // inside arm bodies that emit-engine renders at runtime — walk the AST
      // unconditionally.
      for (const cls of collectClassNamesFromAst(nodes)) usedClasses.add(cls);
      if (usedClasses.size > 0) {
        tailwindCss = getAllUsedCSS([...usedClasses]);
      }
    });

    const cssParts: string[] = [];
    if (userCss) cssParts.push(userCss);
    if (tailwindCss) cssParts.push(tailwindCss);
    const css: string | null = cssParts.length > 0 ? cssParts.join("\n") : null;

    // Create per-file EncodingContext (§47) and set it on the compile context
    const encodingCtx = new EncodingContext({
      enabled: encodingOpts.enabled,
      debug: encodingOpts.debug,
      __testOnly_typeEncodingSeqCap:
        (encodingOpts as { __testOnly_typeEncodingSeqCap?: number })
          .__testOnly_typeEncodingSeqCap,
    });
    compileCtx.encodingCtx = encodingCtx;

    // Register reactive variables with the encoding context
    if (encodingCtx.enabled) {
      const topLevelLogic = analysis?.topLevelLogic ?? collectTopLevelLogicStatements(fileAST);
      for (const stmt of topLevelLogic) {
        if ((stmt as any).kind === "state-decl" && (stmt as any).name) {
          const type = (fileAST as any).nodeTypes?.get((stmt as any).name) ?? { kind: "asIs", constraint: null };
          encodingCtx.register((stmt as any).name, type);
        }
      }
    }

    const clientJsRaw: string | null = codegenStage("emit-client", () =>
      generateClientJs(compileCtx)
    ) || null;

    let clientJs: string | null = clientJsRaw;
    if (clientJsRaw && !embedRuntime) {
      // v0.3.x SPA tree-shake Phase B 3.3 — emit a placeholder filename
      // here; runCG substitutes the final hashed filename
      // (`scrml-runtime.<hash>.js`) in a post-pass once the union has
      // been assembled.
      const runtimeEnd = clientJsRaw.indexOf("\n// --- end scrml reactive runtime ---");
      if (runtimeEnd !== -1) {
        const afterRuntime = clientJsRaw.substring(
          runtimeEnd + "\n// --- end scrml reactive runtime ---".length
        );
        clientJs = `// Requires: ${RUNTIME_FILENAME_PLACEHOLDER}\n` + afterRuntime;
      } else {
        const runtimeStart = clientJsRaw.indexOf("// --- scrml reactive runtime ---");
        if (runtimeStart !== -1) {
          const navigateEnd = clientJsRaw.indexOf("function _scrml_navigate(path) {");
          if (navigateEnd !== -1) {
            const closeBrace = clientJsRaw.indexOf("}\n", navigateEnd + 30);
            if (closeBrace !== -1) {
              const before = clientJsRaw.substring(0, runtimeStart);
              const after = clientJsRaw.substring(closeBrace + 2);
              clientJs = before + `// Requires: ${RUNTIME_FILENAME_PLACEHOLDER}\n` + after;
            }
          }
        }
      }
    }

    // known-gaps-#6 (S152, Approach B) — IIFE-wrap the client.js body for files
    // that participate in cross-file local `.scrml` linking, so their top-level
    // `const`/`function` declarations do not collide in the SHARED global
    // lexical environment of classic <script>s (exporter `const UserRole` vs an
    // importer's `const { UserRole } = _scrml_modules[...]` → redeclaration
    // error). The `_scrml_modules[...] = {...}` footer + runtime shared-global
    // assignments still escape the IIFE. Single-file apps are NOT wrapped (zero
    // behavior change). Gated on `!embedRuntime`: the registry (`_scrml_modules`)
    // lives in the SHARED runtime file (external mode), so wrapping only the
    // per-file body keeps the registry global. In embed mode the runtime is
    // inlined per file (each file would carry its own `_scrml_modules`), so
    // cross-file linking is structurally a no-op there regardless — wrapping
    // the embedded runtime would only further isolate it; leave embed mode
    // unwrapped (the default `compile` path is external mode).
    if (clientJs && !embedRuntime && isCrossFileLinked(filePath, importGraphInput)) {
      clientJs = wrapClientBodyInIife(clientJs);
    }

    const base = basename(filePath, ".scrml");

    // §40.7 — extract documentary attributes from the top-level <program>
    // (Phase A1a, 2026-05-05). The five attributes (title, description,
    // version, author, license) emit standard HTML head tags. Empty-string
    // values are treated as absent. Non-string-literal values are silently
    // ignored — head metadata is static, not reactive.
    const topLevelProgram = (nodes as any[]).find(
      (n: any) => n && n.kind === "markup" && n.tag === "program",
    );
    function getDocAttr(name: string): string | null {
      if (!topLevelProgram) return null;
      const attrs: any[] = topLevelProgram.attributes ?? topLevelProgram.attrs ?? [];
      const a = attrs.find((x: any) => x.name === name);
      if (!a || !a.value) return null;
      if (a.value.kind !== "string-literal") return null;
      const v = a.value.value;
      if (typeof v !== "string" || v === "") return null;
      return v;
    }
    const docTitle = getDocAttr("title");
    const docDescription = getDocAttr("description");
    const docVersion = getDocAttr("version");
    const docAuthor = getDocAttr("author");
    const docLicense = getDocAttr("license");

    // Detect author-written <title> in the source — any <title> markup node
    // anywhere under the top-level <program>. When present, it suppresses
    // both the documentary title= AND the default basename <title>.
    function hasAuthorTitle(children: any[] | undefined): boolean {
      if (!Array.isArray(children)) return false;
      for (const c of children) {
        if (!c || typeof c !== "object") continue;
        if (c.kind === "markup" && c.tag === "title") return true;
        if (c.kind === "markup" && Array.isArray(c.children) && hasAuthorTitle(c.children)) return true;
        // The top-level <program>'s children are the document body — recurse
        // through state nodes too (state-typed openers that wrap markup).
        if (c.kind === "state" && Array.isArray(c.children) && hasAuthorTitle(c.children)) return true;
      }
      return false;
    }
    const authorTitlePresent = topLevelProgram
      ? hasAuthorTitle(topLevelProgram.children)
      : hasAuthorTitle(nodes as any[]);

    let html: string | null = null;
    if (htmlBody) {
      const docParts: string[] = [];
      docParts.push("<!DOCTYPE html>");
      docParts.push("<html lang=\"en\">");
      docParts.push("<head>");
      docParts.push("  <meta charset=\"UTF-8\">");
      docParts.push("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
      // §39.2.3 canonical CSRF delivery — the `<meta name="csrf-token">` element.
      // Emitted as an EMPTY placeholder in the static HTML for an auth + `csrf="auto"`
      // app; the server's request-time HTML-composition route (emit-server.ts SSR
      // compose handler) fills `content=""` with the loading viewer's session
      // synchronizer token at serve time (the token is per-session, so it cannot be
      // baked into the static file). The client reads it FIRST in
      // `_scrml_get_csrf_token()` so the initial mutating POST already carries
      // `X-CSRF-Token` — no 403 round-trip. Absent/empty (anon, or a non-composed
      // serve) falls back to the cookie + the single-shot 403-retry. Baseline
      // (no-auth) double-submit apps emit no meta tag (the client mints its own
      // token), so this is auth-path only.
      if (authMW !== null && authMW.csrf === "auto") {
        docParts.push("  <meta name=\"csrf-token\" content=\"\">");
      }
      // <title> emission rule (§40.7):
      //   1. Author-written <title> → no compiler-emitted <title>
      //      (the author <title> renders via htmlBody itself)
      //   2. Documentary title= and no author <title> → emit documentary <title>
      //   3. Neither → fall back to default basename <title>
      if (!authorTitlePresent) {
        if (docTitle !== null) {
          docParts.push(`  <title>${escapeHtmlAttr(docTitle)}</title>`);
        } else {
          docParts.push(`  <title>${escapeHtmlAttr(base)}</title>`);
        }
      }
      // Documentary <meta> tags (§40.7) — fixed emission order.
      if (docDescription !== null) {
        docParts.push(`  <meta name="description" content="${escapeHtmlAttr(docDescription)}">`);
      }
      if (docVersion !== null) {
        docParts.push(`  <meta name="application-version" content="${escapeHtmlAttr(docVersion)}">`);
      }
      if (docAuthor !== null) {
        docParts.push(`  <meta name="author" content="${escapeHtmlAttr(docAuthor)}">`);
      }
      if (docLicense !== null) {
        docParts.push(`  <meta name="license" content="${escapeHtmlAttr(docLicense)}">`);
      }
      if (css) {
        docParts.push(`  <link rel="stylesheet" href="${base}.css">`);
      }
      docParts.push("</head>");
      docParts.push("<body>");
      docParts.push(htmlBody);
      if (clientJs && !embedRuntime) {
        // v0.3.x SPA tree-shake Phase B 3.3 — placeholder; runCG
        // substitutes the final hashed filename in a post-pass.
        docParts.push(`<script src="${RUNTIME_FILENAME_PLACEHOLDER}"></script>`);
      }
      if (clientJs) {
        // known-gaps-#6 (S152, Approach B) — emit the transitive `.scrml`
        // dependency `.client.js` <script>s BEFORE the entry's own, in
        // topological (deps-first) order. Each dependency's
        // `_scrml_modules[...] = {...}` footer must register before the entry's
        // `const { x } = _scrml_modules[...]` read runs (classic-script eval is
        // sequential top-to-bottom over the document's <script>s). Empty for
        // single-file / leaf pages with no cross-file `.scrml` deps.
        const depScripts = computeDependencyClientScripts(filePath, importGraphInput, cgOutputBaseDir);
        for (const depSrc of depScripts) {
          docParts.push(`<script src="${depSrc}"></script>`);
        }
        docParts.push(`<script src="${base}.client.js"></script>`);
      }
      docParts.push("</body>");
      docParts.push("</html>");
      html = docParts.join("\n");
    }

    let clientJsMap: string | null = null;
    let serverJsMap: string | null = null;

    if (sourceMap) {
      const sourceBasename = `${base}.scrml`;
      // source-map-real-provenance-js-2026-05-31 — real per-line provenance
      // (was: addMapping(i, 0, 0) mapping every output line to source 0:0).
      // buildSourceMap correlates each generated line with the .scrml author
      // construct that produced it, recovers author names into the `names`
      // field, embeds sourcesContent, and categorizes synthetic boilerplate
      // lines explicitly (never a fake 0:0). The per-file source rides on the
      // TAB result as `_sourceText` (threaded in api.js via sourceByFile);
      // falls back to "" only for harnesses that bypass the full pipeline.
      const fileSource: string = (fileAST as any)?._sourceText ?? "";

      if (clientJs) {
        const clientMapFile = `${base}.client.js.map`;
        const { builder: clientMapBuilder, cleanedJs: clientClean } =
          buildSourceMap(clientJs, sourceBasename, fileSource, nodes);
        clientJs = clientClean; // ship the marker-stripped JS
        clientJsMap = clientMapBuilder.generate(`${base}.client.js`);
        clientJs = appendSourceMappingUrl(clientJs, clientMapFile);
      }

      if (serverJs) {
        const serverMapFile = `${base}.server.js.map`;
        const { builder: serverMapBuilder, cleanedJs: serverClean } =
          buildSourceMap(serverJs, sourceBasename, fileSource, nodes);
        serverJs = serverClean; // ship the marker-stripped JS
        serverJsMap = serverMapBuilder.generate(`${base}.server.js`);
        serverJs = appendSourceMappingUrl(serverJs, serverMapFile);
      }
    }

    // Generate test JS when testMode is enabled
    //
    // Phase A6-4 (SPEC §19.12.7) — collect same-file server-fn names so
    // emit-test.ts can emit E-TEST-006 thrower stubs for unbound server-fns
    // called inside `~{}` test blocks. Walk the file's fn nodes and pick out
    // those whose route entry has `boundary === "server"`.
    const sameFileServerFnNames: string[] = [];
    if (testMode) {
      const fnNodes: any[] = (analysis as any)?.fnNodes ?? [];
      for (const fnNode of fnNodes) {
        const span = fnNode?.span;
        if (!span || typeof span.start !== "number") continue;
        const fnNodeId = `${filePath}::${span.start}`;
        const route = safeRouteMap.functions.get(fnNodeId);
        if (!route || route.boundary !== "server") continue;
        const fnName = fnNode.name;
        if (typeof fnName === "string" && fnName !== "anon" && fnName !== "") {
          sameFileServerFnNames.push(fnName);
        }
      }
    }
    const testJs: string | null = testMode
      ? codegenStage("emit-test", () =>
          generateTestJs(filePath, (analysis as any)?.testGroups ?? [], [], sameFileServerFnNames)
        ) ?? null
      : null;

    // §51.13 — auto-generated machine property tests.
    let machineTestJs: string | null = null;
    if (emitMachineTests) {
      const machineRegistry = (fileAST as any).machineRegistry as Map<string, any> | undefined;
      const initialVariants = new Map<string, string>();
      function walkForMachineInitials(children: any[]): void {
        if (!Array.isArray(children)) return;
        for (const child of children) {
          if (!child || typeof child !== "object") continue;
          if (child.kind === "state-decl" && child.machineBinding && child.initialValue) {
            const iv = child.initialValue;
            const variant =
              (iv.kind === "variant-literal" && typeof iv.variant === "string") ? iv.variant :
              (iv.kind === "enum-variant" && typeof iv.variant === "string") ? iv.variant :
              null;
            if (variant) initialVariants.set(child.machineBinding, variant);
          }
          if (Array.isArray(child.children)) walkForMachineInitials(child.children);
          if (Array.isArray(child.body)) walkForMachineInitials(child.body);
        }
      }
      walkForMachineInitials(nodes);
      machineTestJs = codegenStage("emit-machine-tests", () =>
        generateMachineTestJs(filePath, machineRegistry ?? null, initialVariants)
      );
    }

    const fileWorkerBundles = workerBundlesPerFile.get(filePath);
    const browserOutput: CgFileOutput = {
      sourceFile: filePath,
      html,
      css,
      clientJs,
      serverJs,
      ...(testJs !== null && { testJs }),
      ...(machineTestJs !== null && { machineTestJs }),
      ...(fileWorkerBundles && { workerBundles: fileWorkerBundles }),
      ...(clientJsMap !== null && { clientJsMap }),
      ...(serverJsMap !== null && { serverJsMap }),
    };
    outputs.set(filePath, browserOutput);
    // S91 A-4.1 — stash per-file CompileContext for the route-splitter
    // post-pass below. The splitter is reserved (A-4.2+) but the
    // recording is unconditional so the contract is stable across
    // sub-phases.
    cgContextByFile.set(filePath, compileCtx);

    // M-7C-D-12 Track 3 (S90): W-CG-UNDEFINED-INTERPOLATION regression guard.
    // Scans the just-emitted compiled JS for bare `undefined` JS-keyword usage
    // outside the canonical paired-absence-check idiom. Fires per-line. See
    // lint-undefined-interpolation.ts for the legitimate-idiom exception set.
    const undefinedLintErrors = codegenStage("lint-undefined", () =>
      lintCompiledForUndefined(filePath, clientJs, serverJs)
    );
    if (undefinedLintErrors.length > 0) errors.push(...undefinedLintErrors);
  }

  // -------------------------------------------------------------------------
  // mpa-shell-clean-urls Sub 2 (2026-05-17) — per-page shell composition.
  //
  // Per SPEC §40.8 v0.3 program shape: the entry file declares the
  // top-level `<program>` (the application shell — header / nav / footer
  // / `<main>` slot), and non-entry-page files (`<page>` openers) declare
  // per-route content. Pre-fix the dev server emitted `app.html` (shell
  // with empty `<main>`) and `pages/X.html` (standalone page body with
  // no chrome) as fully independent files; visiting `/X` showed a page
  // with no header/footer, and `/` showed an empty shell.
  //
  // §40.8.1 normative text is silent on the COMPOSITION mechanism (it
  // resolves the SPA-vs-multi-page-app inference but does not specify
  // whether per-page HTML is per-page-inlined, server-side-templated,
  // or client-side-routed). The user-ratified intent (Machine B PA
  // recommendation 2026-05-17) is per-page-inlined: each per-route HTML
  // contains the shell chrome wrapped around the page body. This shape:
  //   - works with any static file server (S3 / Netlify / Bun.serve)
  //   - requires no client-side router
  //   - composes with the per-route per-role artifact splitter that
  //     landed in v0.3.0 (Approach A)
  //   - keeps each per-route emission self-contained
  //
  // Implementation: post-pass after the per-file emit loop. Find the
  // entry file (the one with `hasProgramRoot: true`), extract its
  // rendered body, find the FIRST `<main ...>...</main>` element to
  // identify the slot, and rewrite each non-entry-page file's html so
  // its body content sits inside the shell's `<main>`.
  //
  // app.scrml disposition (Sub 4 — option (i)): the entry file still
  // emits its own \`dist/app.html\` artifact alongside per-page composed
  // HTMLs. Rationale:
  //   - Adopter-facing inspectable: opening dist/app.html in a browser
  //     shows the shell with the empty <main> placeholder, useful as a
  //     "what does my shell template render to" dev-tool view.
  //   - No conflict with the home route: \`/\` resolves to dist/index.html
  //     (from pages/index.scrml) under the dev server's path-strip
  //     resolution (Sub 1 + Sub 3); app.html only serves at \`/app\`.
  //   - Symmetric with the routes/ legacy convention (entry stays as-is).
  // The alternative (drop app.html standalone emission) was considered
  // and rejected for v0.3.x: it saves one file but removes the
  // dev-tool inspection affordance with no offsetting adopter benefit.
  // Future spec work (§40.8.2?) may formalize the choice.
  //
  // Limitations (acceptable for v0.3.x):
  //   - Reactive bindings inside the shell render with their initial
  //     values on per-page emissions; the shell's app.client.js is
  //     loaded by per-page HTMLs to wire them up.
  //   - Shell composition is purely textual; complex shell structures
  //     (e.g., nested `<main>` slots) are unsupported — the FIRST
  //     `<main>` is the slot.
  //   - When the entry file has no `<main>`, composition is a no-op
  //     (per-page HTMLs remain standalone, matching pre-fix behavior).
  // -------------------------------------------------------------------------
  {
    // Find the entry file. Per §40.8, exactly ONE top-level `<program>`
    // per application; the first file with `hasProgramRoot: true` is
    // the entry. Single-file invocations on a non-entry-page file have
    // no shell — fall through to the no-op branch.
    // `hasProgramRoot` lives on the FileAST. In the CG pipeline,
    // fileAST can arrive either as `{ filePath, ast: { hasProgramRoot, ... } }`
    // (wrapped — from CE output before unwrapping) or `{ filePath,
    // hasProgramRoot, ... }` (unwrapped — from TS output downstream).
    // Check both shapes for robustness.
    function getHasProgramRoot(f: any): boolean {
      return f?.ast?.hasProgramRoot === true || f?.hasProgramRoot === true;
    }
    let entryFile: any = null;
    for (const f of files) {
      if (getHasProgramRoot(f)) {
        entryFile = f;
        break;
      }
    }

    if (entryFile) {
      const entryFilePath = (entryFile as any).filePath as string;
      const entryOutput = outputs.get(entryFilePath);
      const entryHtml = entryOutput?.html ?? null;
      const entryBase = entryFilePath
        ? entryFilePath.replace(/\.scrml$/, "").split("/").pop()
        : null;

      // Extract the `<body>...</body>` block from the entry's html. This
      // gives us the rendered shell — header, footer, the `<main>` slot,
      // and everything else inside `<body>`. Defensive: if the entry
      // doesn't have a `<body>` (e.g., library-mode entry), shellBody is
      // null and composition is skipped.
      //
      // Strip the entry's TRAILING `<script>` tags from the shell body —
      // those scripts (runtime + app.client.js) are re-emitted by the
      // per-page composition below so they sit AFTER the composed page
      // body, with correct upToRoot prefixes for nested per-page HTMLs.
      // Without this strip, per-page HTMLs would double-load the runtime
      // and app.client.js (once from the shell body's literal scripts,
      // once from the per-page composition's re-added scripts).
      let shellBody: string | null = null;
      if (entryHtml) {
        // Match the body content greedy-laziest possible. <body[^>]*>
        // tolerates body attrs (the current envelope writes bare <body>
        // but future changes might add classes); the closing </body>
        // anchor is the literal terminator.
        const bodyMatch = entryHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
        if (bodyMatch) {
          // Strip a trailing run of <script src="..."></script> tags
          // (including the runtime placeholder + the entry's client.js).
          // The envelope emits these in sequence at the end of <body>;
          // they're identifiable by being the LAST non-whitespace content.
          shellBody = bodyMatch[1].replace(
            /(\s*<script\s+src="[^"]*"><\/script>)+\s*$/,
            "",
          );
        }
      }

      // Locate the FIRST `<main ...>...</main>` in the shell body. The
      // `<main>` content is the slot — we'll replace its children with
      // the page body during composition. If no `<main>` is found,
      // composition is a no-op (the shell has nowhere to host page
      // content; the per-page HTML emits standalone).
      let mainOpenIdx = -1;
      let mainOpenEndIdx = -1;
      let mainCloseIdx = -1;
      if (shellBody) {
        const mainOpenMatch = shellBody.match(/<main(\s[^>]*)?>/);
        if (mainOpenMatch && mainOpenMatch.index !== undefined) {
          mainOpenIdx = mainOpenMatch.index;
          mainOpenEndIdx = mainOpenIdx + mainOpenMatch[0].length;
          // Find the matching </main>. Simple lookup — nested <main>s
          // would defeat this but HTML5 forbids nested <main>
          // (https://html.spec.whatwg.org/#the-main-element). For v0.3.x
          // we honor the spec rule; future work can teach this a depth
          // counter if adopters actually nest <main>.
          mainCloseIdx = shellBody.indexOf("</main>", mainOpenEndIdx);
        }
      }

      const shellAvailable =
        shellBody !== null && mainOpenIdx >= 0 && mainCloseIdx > mainOpenEndIdx;

      if (shellAvailable && shellBody !== null) {
        const shellPrefix = shellBody.slice(0, mainOpenEndIdx);
        const shellSuffix = shellBody.slice(mainCloseIdx);
        // entryClientJs base is needed so per-page HTMLs can <script src=>
        // the shell's app.client.js (so reactive shell elements such as
        // `${VERSION}` in the docs/website shell remain wired).

        for (const [filePath, output] of outputs) {
          if (filePath === entryFilePath) continue;
          if (!output.html) continue;

          // Detect non-entry-page files via the same shape as ast-builder.js
          // line 12222: !hasProgramRoot AND at least one top-level markup
          // node with tag === "page".
          const fileAST = files.find(
            (f) => (f as any)?.filePath === filePath,
          );
          if (!fileAST) continue;
          if (getHasProgramRoot(fileAST)) continue;
          const fileNodes: any[] =
            (fileAST as any).ast?.nodes ?? (fileAST as any).nodes ?? [];
          const hasPageOpener = fileNodes.some(
            (n: any) =>
              n && n.kind === "markup" && n.tag === "page",
          );
          if (!hasPageOpener) continue;

          // Extract the page's body content from its html envelope —
          // same regex as the entry. The page-tag stripper added to
          // emit-html.ts emits the page's children directly without a
          // wrapping `<page>` tag, so pageBody is the page's content.
          const pageHtml = output.html;
          const pageBodyMatch = pageHtml.match(
            /<body[^>]*>([\s\S]*?)<\/body>/,
          );
          if (!pageBodyMatch) continue;
          const pageBodyRaw = pageBodyMatch[1];

          // Strip the trailing `<script>` tags that the envelope emitted
          // for this page's own client.js / runtime — we'll re-append a
          // composed script set (shell's app.client.js + page's
          // client.js) below.
          const pageBodyStripped = pageBodyRaw
            .replace(
              /\s*<script\s+src="[^"]*\.client\.js"><\/script>\s*$/,
              "",
            )
            .replace(
              /\s*<script\s+src="[^"]*"><\/script>\s*$/,
              "",
            );

          // Compose: shell prefix (everything up to and including the
          // `<main ...>` opener) + page body + shell suffix (the
          // `</main>` and everything after it).
          const composedBody =
            shellPrefix + "\n" + pageBodyStripped + "\n" + shellSuffix;

          // Re-emit the script set on the composed body. The shell's
          // app.client.js is added FIRST (so its const declarations are
          // in scope before any per-page wiring runs), then the page's
          // own client.js. Both load against the shared runtime.
          //
          // pathFromPageToEntry: resolve a relative href from this
          // page's dist dir to the entry's dist dir so the <script src>
          // works regardless of nesting depth. mpa-shell-clean-urls
          // Sub 1 strips `pages/` from dist paths, so the entry is at
          // dist root and per-page files may be at dist/X/ —
          // computing the relative path keeps the script ref correct
          // for any depth.
          const pageDistDir =
            filePath
              .replace(/\.scrml$/, "")
              .replace(/[^/]+$/, "")
              .replace(/.*\/pages\//, "")
              .replace(/^pages\//, "") || "";
          const depth = pageDistDir
            ? pageDistDir.split("/").filter(Boolean).length
            : 0;
          const upToRoot = depth > 0 ? "../".repeat(depth) : "";

          const scriptParts: string[] = [];
          // Use the existing closing-script lines from the page's
          // original envelope — the runtime placeholder is per-file but
          // identical across files (substituted in the same post-pass
          // below), so we can either keep the page's runtime tag (which
          // is what we strip-and-readd) or take the entry's. We use the
          // page's existing runtime tag with the relative-up prefix.
          if (entryOutput?.clientJs && entryBase) {
            scriptParts.push(
              `<script src="${upToRoot}${entryBase}.client.js"></script>`,
            );
          }
          // Re-add the page's own client.js (was stripped above).
          const pageBase = filePath
            .replace(/\.scrml$/, "")
            .split("/")
            .pop();
          if (output.clientJs) {
            scriptParts.push(
              `<script src="${pageBase}.client.js"></script>`,
            );
          }

          // Find the runtime <script src=...> in the original pageHtml.
          // At post-emit time the src is the placeholder
          // `__SCRML_RUNTIME_FILENAME_PLACEHOLDER__`; the existing
          // Phase B 3.3 post-pass below substitutes it for the final
          // hashed filename. We rewrite the placeholder's href with the
          // upToRoot prefix so the substituted runtime URL resolves
          // from the per-page HTML's nested dist dir.
          const runtimeMatch = pageHtml.match(
            /<script\s+src="([^"]*)"><\/script>/,
          );
          let runtimeTagRewritten: string | null = null;
          if (runtimeMatch) {
            const src = runtimeMatch[1];
            // Only rewrite the runtime placeholder, not the page's
            // own client.js (which is at the same nested dir as the
            // page itself and uses just basename).
            if (src.includes("__SCRML_RUNTIME_FILENAME_PLACEHOLDER__")) {
              if (src.startsWith("/") || /^https?:/.test(src)) {
                runtimeTagRewritten = runtimeMatch[0];
              } else {
                runtimeTagRewritten = `<script src="${upToRoot}${src.replace(/^\.\//, "")}"></script>`;
              }
            }
          }

          // Build the replacement body. Use the FUNCTION form of
          // `String.prototype.replace` so the replacement string is
          // treated as a literal — the 2-arg string form interprets
          // `$&`, `$'`, `$\``, `$N` etc. as backreferences, which
          // breaks pages whose markup contains literal `$&` (e.g. a
          // `<code>$&#123;expr&#125;</code>` block used to render
          // literal `${expr}` text in docs). With the string form,
          // each `$&` in `composedBody` would be substituted for the
          // matched `<body>...</body>` chunk, recursively re-injecting
          // the shell and producing 3+ stacked body blocks.
          //
          // Defensive: prefer the LAST `</body>` in the document over
          // the first. The non-greedy `[\s\S]*?` regex would mis-match
          // if pageBody itself contained literal `</body>` (e.g. a docs
          // page discussing the `<body>` HTML element without entity
          // escapes). Anchoring on the document's actual final
          // `</body>` keeps the extraction robust even if a future
          // page slips literal body markup into a code example.
          const bodyOpenMatch = pageHtml.match(/<body[^>]*>/);
          const lastBodyClose = pageHtml.lastIndexOf("</body>");
          const replacementBody = `<body>\n${composedBody}\n${runtimeTagRewritten ? runtimeTagRewritten + "\n" : ""}${scriptParts.join("\n")}\n</body>`;
          let composedHtml = pageHtml;
          if (
            bodyOpenMatch &&
            bodyOpenMatch.index !== undefined &&
            lastBodyClose > bodyOpenMatch.index
          ) {
            composedHtml =
              pageHtml.slice(0, bodyOpenMatch.index) +
              replacementBody +
              pageHtml.slice(lastBodyClose + "</body>".length);
          }

          // Add the entry's CSS link so shell styles (Tailwind utility
          // classes used by header/footer/nav) reach per-page HTMLs.
          // The entry CSS lives at `<entryBase>.css` next to app.html;
          // per-page HTMLs may be nested, so prefix with upToRoot.
          if (entryOutput?.css && entryBase) {
            const entryCssTag = `  <link rel="stylesheet" href="${upToRoot}${entryBase}.css">`;
            // Insert right before the </head> so it appears AFTER the
            // page's own CSS (so per-page CSS — which is more specific
            // — wins on conflicts, consistent with the page-content-
            // overrides-shell intent).
            //
            // Use the function form of `.replace()` here too so any
            // future `$&`/`$N` chars in `entryCssTag` are treated
            // literally — defense in depth for the same class of bug
            // fixed above.
            composedHtml = composedHtml.replace(
              /<\/head>/,
              () => `${entryCssTag}\n</head>`,
            );
          }

          outputs.set(filePath, { ...output, html: composedHtml });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // v0.3.x SPA tree-shake Phase B 3.1 + 3.3 — shared-runtime union + hash.
  //
  // In `embedRuntime: true` mode each per-file client.js carries its own
  // tree-shaken runtime; the shared runtime is not produced. The legacy
  // path (`!embedRuntime`) used to ship the entire `SCRML_RUNTIME`
  // template verbatim regardless of which chunks the compile unit
  // actually used. Phase B 3.1 closes that gap by assembling the
  // runtime from the UNION of `usedRuntimeChunks` across every file's
  // CompileContext.
  //
  // Phase B 3.3 then content-hashes the assembled runtime (FNV-1a over
  // its bytes) and embeds the hash in the runtime filename so adopters
  // serving the runtime from a stable URL get a deterministic
  // cache-busting key: changing which `.scrml` files are in the build
  // (or which chunk-gate predicates fire) flips the hash, but compiling
  // the same source set twice produces a byte-identical filename.
  //
  // Substitution: per-file emission writes a placeholder
  // (`RUNTIME_FILENAME_PLACEHOLDER`) wherever the filename would appear
  // (`// Requires: <filename>` line in client.js + `<script src=...>`
  // tag in HTML). Once the final hashed filename is computed below, we
  // pass over every output's `clientJs` and `html` and substitute.
  // -------------------------------------------------------------------------
  let runtimeJs: string | null = null;
  let runtimeFilename: string = RUNTIME_FILENAME;
  if (!embedRuntime) {
    // Union usedRuntimeChunks across every compiled file in this run.
    // Always include the per-spec always-present set (`core`, `scope`,
    // `errors`, `transitions`) so files that skipped CG (library mode,
    // empty workers, fixture files with no AST features) still produce
    // a runnable runtime.
    const union = new Set<string>();
    for (const ctx of cgContextByFile.values()) {
      for (const name of ctx.usedRuntimeChunks) union.add(name);
    }
    union.add("core");
    union.add("scope");
    union.add("errors");
    union.add("transitions");
    runtimeJs = assembleRuntime(union);

    // Phase B 3.3 — content-hash the assembled runtime. FNV-1a 32-bit
    // (the same primitive used for §47 type-encoding and §47.5 per-chunk
    // content-addressing per A-4.6). 8-char base36 entropy; collision
    // risk for a per-build shared runtime is negligible.
    const hash = fnv1aHash(runtimeJs);
    // Splice the hash into the legacy `scrml-runtime.js` shape →
    // `scrml-runtime.<hash>.js`. Keep the suffix derivation tied to
    // `RUNTIME_FILENAME` (current value: "scrml-runtime.js") so a
    // future template change cascades naturally.
    const dotIdx = RUNTIME_FILENAME.lastIndexOf(".");
    const base = dotIdx === -1 ? RUNTIME_FILENAME : RUNTIME_FILENAME.slice(0, dotIdx);
    const ext = dotIdx === -1 ? "" : RUNTIME_FILENAME.slice(dotIdx);
    runtimeFilename = `${base}.${hash}${ext}`;

    // Substitute the placeholder in every output's clientJs and html.
    // Files that don't ship a `<script src=...>` runtime reference (e.g.
    // library-mode or worker-only outputs) are unaffected — the
    // placeholder is absent and the `replaceAll` is a no-op.
    for (const [path, out] of outputs) {
      let mutated = false;
      let nextClient = out.clientJs ?? null;
      let nextHtml = out.html ?? null;
      if (nextClient && nextClient.includes(RUNTIME_FILENAME_PLACEHOLDER)) {
        nextClient = nextClient.split(RUNTIME_FILENAME_PLACEHOLDER).join(runtimeFilename);
        mutated = true;
      }
      if (nextHtml && nextHtml.includes(RUNTIME_FILENAME_PLACEHOLDER)) {
        nextHtml = nextHtml.split(RUNTIME_FILENAME_PLACEHOLDER).join(runtimeFilename);
        mutated = true;
      }
      if (mutated) {
        outputs.set(path, { ...out, clientJs: nextClient, html: nextHtml });
      }
    }
  }

  // §51.5.1 (S28 slice 3) — drain E-ENGINE-001 compile errors accumulated
  // by emit-machines during this compile.
  const machineErrors = drainMachineCodegenErrors();
  if (machineErrors.length > 0) errors.push(...machineErrors);

  // Reset the Tier 2 hoist singleton so a subsequent compile in the same
  // process (persistent server, test harness) starts clean.
  setBatchLoopHoists(null);
  // S79 C.2 — same lifecycle for the batch-in-list cap override.
  setBatchInListCap(null);

  // -------------------------------------------------------------------------
  // S91 A-4.1 — Per-route artifact splitter (SPEC §40.9.7).
  //
  // Opt-in via `CgInput.emitPerRoute === true` per OQ-A4-F (S91
  // ratification). When set, iterate the Stage 7.6 ReachabilityRecord's
  // per-(EP, role) ChunkPlan shape and produce per-(EP, role, tier)
  // chunk descriptors. At A-4.1 each chunk carries an empty `payloadJs`
  // and placeholder hash; A-4.2..A-4.7 fill these in incrementally.
  //
  // Splitter diagnostics are surfaced into the standard `errors` array
  // so existing collectErrors machinery in api.js routes them
  // alongside per-file emit errors. No diagnostics are produced at
  // A-4.1 (W-CG-CHUNK-* lints land at A-4.7).
  //
  // When `emitPerRoute` is false (default), the splitter is NOT
  // invoked — per-file emission proceeds unchanged and the chunks /
  // chunksManifest fields are absent from the output.
  // -------------------------------------------------------------------------
  let chunks: Map<ChunkKey, ChunkOutput> | undefined;
  let chunksManifest: ChunksManifest | undefined;
  if (emitPerRoute && reachabilityRecordInput) {
    const splitterResult = emitPerRouteChunks({
      reachabilityRecord: reachabilityRecordInput,
      cgContextByFile,
      perFileOutputs: outputs,
      // Q-OPEN-5 — forward the CLI-supplied `--chunk-size-budget`
      // value (or `undefined` for "use default" / "flag absent").
      chunkSizeBudgetBytes,
    });
    chunks = splitterResult.chunks;
    chunksManifest = splitterResult.manifest;
    if (splitterResult.diagnostics.length > 0) {
      errors.push(...splitterResult.diagnostics);
    }

    // -------------------------------------------------------------------------
    // A-4.7 — Per-route HTML augmentation pass.
    //
    // For each per-file output that has a non-empty HTML body AND owns at
    // least one entry-point in the ReachabilityRecord, augment the HTML
    // with the chunk-activation scaffolding emitted by
    // `emit-html.ts:augmentHtmlForChunks`:
    //
    //   - Inline `<script>window._SCRML_CHUNKS = { ... }</script>` (route-
    //     keyed manifest for runtime `_scrml_prefetch_tier2` lookup +
    //     bootstrap dispatch).
    //   - `<link rel="modulepreload">` for non-empty tier-1 chunks.
    //   - Role-detection bootstrap `<script>` (localStorage > cookie >
    //     <meta name="scrml-role"> > "_anonymous").
    //
    // Per OQ-A4-E ratification (S91): ONE HTML per route + role-detection
    // bootstrap loads the per-role initial chunk. No per-(route, role)
    // HTML variance.
    //
    // The augmentation is a string-replace pass over each file's
    // pre-composed HTML (preserves all upstream HTML emit invariants —
    // documentary <meta>, transitions, modulepreload for runtime, etc.).
    // -------------------------------------------------------------------------
    if (chunks && chunks.size > 0) {
      // Build the EpId → routePath lookup once. The lookup combines two
      // sources:
      //   1. `<file>#page@<route>` EpIds expose the route trailing the
      //      `@` directly.
      //   2. `<file>#program` and `<file>#page-<N>` EpIds resolve via
      //      `safeRouteMap.pages` (file path → PageRoute with urlPattern).
      const epIdToRoutePath = new Map<string, string>();
      const pagesByFile = safeRouteMap.pages as Map<string, any> | undefined;
      for (const [, chunk] of chunks) {
        const epId = String(chunk.entryPointId);
        if (epIdToRoutePath.has(epId)) continue;
        // Case 1: explicit route after `#page@`.
        const pageAtIdx = epId.indexOf("#page@");
        if (pageAtIdx !== -1) {
          const route = epId.substring(pageAtIdx + "#page@".length);
          if (route !== "") {
            epIdToRoutePath.set(epId, route);
            continue;
          }
        }
        // Case 2: `<file>#program` — derive from RouteMap.pages.
        const programIdx = epId.indexOf("#program");
        if (programIdx !== -1) {
          const filePart = epId.substring(0, programIdx);
          if (pagesByFile && typeof pagesByFile.get === "function") {
            const pageEntry = pagesByFile.get(filePart);
            const urlPattern = (pageEntry as { urlPattern?: unknown })?.urlPattern;
            if (typeof urlPattern === "string" && urlPattern !== "") {
              epIdToRoutePath.set(epId, urlPattern);
              continue;
            }
          }
          // Fallback: SPA root → `/`. This is the dominant case when a
          // single `<program>` file declares the app entry without
          // file-based routing.
          epIdToRoutePath.set(epId, "/");
          continue;
        }
        // Case 3: `<file>#page-<N>` — positional. Best-effort: use the
        // file's first registered PageRoute as a stand-in. Test fixtures
        // that bypass RI land here; production pipelines should use
        // case 1 (the `<route>` form).
        const pageIdxIdx = epId.indexOf("#page-");
        if (pageIdxIdx !== -1) {
          const filePart = epId.substring(0, pageIdxIdx);
          if (pagesByFile && typeof pagesByFile.get === "function") {
            const pageEntry = pagesByFile.get(filePart);
            const urlPattern = (pageEntry as { urlPattern?: unknown })?.urlPattern;
            if (typeof urlPattern === "string" && urlPattern !== "") {
              epIdToRoutePath.set(epId, urlPattern);
              continue;
            }
          }
          // No RouteMap entry — fall through; the bootstrap warns at
          // runtime but the HTML stays well-formed.
        }
      }

      // Build a per-file lookup: filePath → EpIds (preserving the
      // canonical Map iteration order from RS output).
      const epIdsByFile = new Map<string, string[]>();
      for (const [, chunk] of chunks) {
        const epId = String(chunk.entryPointId);
        const hashIdx = epId.indexOf("#");
        if (hashIdx === -1) continue;
        const filePath = epId.substring(0, hashIdx);
        let list = epIdsByFile.get(filePath);
        if (!list) {
          list = [];
          epIdsByFile.set(filePath, list);
        }
        if (!list.includes(epId)) list.push(epId);
      }

      // Augment each file's HTML in place. Files without HTML
      // (library mode, worker bundles, fixture files with no markup)
      // are skipped — the augmenter would have nothing to inject into.
      for (const [filePath, output] of outputs) {
        if (!output.html) continue;
        const fileEpIds = epIdsByFile.get(filePath);
        if (!fileEpIds || fileEpIds.length === 0) continue;
        const augmented = augmentHtmlForChunks({
          html: output.html,
          chunks,
          fileEntryPointIds: fileEpIds,
          epIdToRoutePath,
        });
        // Avoid mutating the existing output object reference; replace
        // the HTML field on a fresh shallow copy. (`output` is the
        // value previously written to `outputs`; reassigning is safe.)
        outputs.set(filePath, { ...output, html: augmented });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PGO P1.1 (S102) — emit the aggregated `[CG-EMIT]` breakdown.
  //
  // Sorted descending by total ms so the hottest emit paths surface
  // first. Percentage column is computed against the elapsed CG wall
  // time captured at function entry (`cgStart`); this matches the
  // outer `[CG] Nms` line emitted by api.js:stage(), so adopters can
  // cross-reference the breakdown against the existing top-line
  // pipeline log. Sum of percentages is typically < 100 because
  // un-instrumented work (analysis pass, route-splitter, post-pass
  // shell composition, runtime-union assembly) is part of CG wall
  // time but not part of the per-emit-* surface.
  // ---------------------------------------------------------------------------
  if (debugPerf && cgEmitTotals.size > 0) {
    const cgElapsed = performance.now() - cgStart;
    const rows = [...cgEmitTotals.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, total] of rows) {
      const pct = cgElapsed > 0 ? (total / cgElapsed) * 100 : 0;
      log(`  [CG-EMIT] ${name}: ${total.toFixed(1)}ms (${pct.toFixed(1)}% of CG)`);
    }
  }

  // PGO P2.1 (S102) — second-level breakdown INSIDE emit-client.
  //
  // Percentages are computed against the top-level `emit-client`
  // aggregate captured in `cgEmitTotals` (so the column lines up with
  // the `[CG-EMIT] emit-client: <N>ms` row immediately above). When
  // emit-client wasn't entered (library mode or fully-empty file
  // corpus), the percentage falls back to zero rather than producing
  // a divide-by-zero NaN — the absolute ms is still useful as a check
  // that no sub-emit fired without the parent.
  //
  // Sum of `[CLIENT-EMIT]` rows is expected to be slightly LESS than
  // the parent `emit-client` row: the un-instrumented post-pass work
  // (fnNameMap rewrites, server-fn IIFE wrap, import pruning, SQL-leak
  // scan, protected-field scan, runtime assembly composition) is part
  // of `emit-client` wall time but not part of the per-sub-emit
  // surface. The brief allows ±10ms slack on this sum.
  if (debugPerf && clientEmitTotals && clientEmitTotals.size > 0) {
    const emitClientTotal = cgEmitTotals.get("emit-client") ?? 0;
    const rows = [...clientEmitTotals.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, total] of rows) {
      const pct = emitClientTotal > 0 ? (total / emitClientTotal) * 100 : 0;
      log(`  [CLIENT-EMIT] ${name}: ${total.toFixed(1)}ms (${pct.toFixed(1)}% of emit-client)`);
    }
  }

  return {
    outputs,
    errors,
    runtimeJs,
    // Phase B 3.3 — in `!embedRuntime` mode this is the hashed
    // filename (e.g. `scrml-runtime.a1b2c3d4.js`); in embed mode it
    // remains the legacy literal but `runtimeJs` is `null` so the
    // caller writes nothing.
    runtimeFilename,
    ...(chunks !== undefined && { chunks }),
    ...(chunksManifest !== undefined && { chunksManifest }),
  };
}

export { CGError } from "./errors.ts";
