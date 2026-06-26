import { SCRML_RUNTIME } from "../runtime-template.js";
import { relative, basename } from "path";
import { exprNodeContainsCall } from "../expression-parser.ts";
// F8 / v0.6 — dual-mode meta-block kind test (live `"meta"` / native `"Meta"`).
import { isMetaKind } from "../types/ast.ts";
import { assembleRuntime, RUNTIME_CHUNK_ORDER, applyChunkDependencies } from "./runtime-chunks.ts";
import { buildFunctionBodyRegistry, iterableHasReactiveRefs, collectMapVarNames, fileHasMapUsage } from "./reactive-deps.ts";
import { CGError } from "./errors.ts";
import { escapeRegex } from "./utils.ts";
import { rewriteCodeSegments } from "./code-segments.ts";
import { emitFunctions } from "./emit-functions.ts";
import { emitBindings } from "./emit-bindings.ts";
import { emitReactiveWiring } from "./emit-reactive-wiring.ts";
import { filterChannelImportSpecifiers } from "./emit-channel.ts";
import { emitEventWiring } from "./emit-event-wiring.ts";
import { emitEngineSubstrate, emitDerivedEngineSubstrateForFile, emitCrossFileEngineMountsForFile, emitEngineHookFiringFunctionsForFile, emitEngineInitialArmsForFile, emitEngineCellHydrationInitsForFile, emitEngineServerSourceHydrationsForFile, emitEngineOpenerEffectsForFile, emitEngineBodyRenderForFile, emitDerivedEngineBodyRenderForFile } from "./emit-engine.ts";
import { setVariantFieldsForFile } from "./emit-control-flow.ts";
import { setVariantFieldsForRewriter } from "./rewrite.js";
import { EncodingContext, emitDecodeTable, emitRuntimeReflect } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";
export type { EncodingContext } from "./type-encoding.ts";
export type { CompileContext } from "./context.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnumVariant {
  name?: string;
  payload?: any;
}

interface TypeDecl {
  kind: string;
  typeKind?: string;
  name?: string;
  variants?: EnumVariant[];
  raw?: string;
}

// ---------------------------------------------------------------------------
// known-gaps-#6 (S152) — cross-file CLIENT module-loading (Approach B, §21.3)
//
// scrml loads every `.client.js` as a CLASSIC (non-module) <script>, so a bare
// ES `import { x } from "./dep.client.js"` SyntaxErrors at parse time and
// poisons the whole script body (zero client code runs). Approach B mirrors the
// already-shipped `_scrml_stdlib` registry: each dependency `.client.js` ends
// with a registration footer `_scrml_modules["<key>"] = { name: emitted, ... }`
// and each importer rewrites `import` to `const { x } = _scrml_modules["<key>"]`.
// The importer + exporter MUST agree on the key — both derive it identically
// from the dependency's ABSOLUTE path via `moduleRegistryKey`.
// ---------------------------------------------------------------------------

/**
 * Derive the stable `_scrml_modules` registry key for a dependency `.scrml`
 * file from its ABSOLUTE source path. The key is a dist-RELATIVE `.client.js`
 * path (POSIX `/` separators), e.g. `"types.client.js"` or
 * `"components/load-card.client.js"`. It is a stable IDENTIFIER, not a URL —
 * it survives the shell-composition `upToRoot` rewrite because the importer +
 * exporter both compute the SAME dist-relative path from absolute paths,
 * regardless of how deeply nested either page sits in the output tree.
 *
 * Open Q #2 (RESOLVED) — path-relative now; a future content-addressed FNV-1a
 * hash-key could unify with A-4's content-addressing (`fnv1a-hash.ts`), but
 * path-relative matches auto-gather's `absSource` resolution and is simplest.
 *
 * Falls back to the basename when `outputBaseDir` is unavailable (test
 * harnesses that bypass the write phase) — both sides degrade identically.
 */
function moduleRegistryKey(absScrmlPath: string, outputBaseDir: string | null | undefined): string {
  if (typeof absScrmlPath !== "string" || absScrmlPath.length === 0) return "";
  let rel: string;
  if (outputBaseDir) {
    rel = relative(outputBaseDir, absScrmlPath);
    // `relative` may emit `..` segments if a dep sits OUTSIDE the base dir;
    // fall back to the basename in that degenerate case so both sides still
    // agree on a clean key (the dist write would also flatten such a file).
    if (rel.startsWith("..")) rel = basename(absScrmlPath);
  } else {
    rel = basename(absScrmlPath);
  }
  // Normalize separators to POSIX and rewrite the `.scrml` suffix to
  // `.client.js` (the artifact the importer loads).
  rel = rel.split(/[\\/]/).join("/");
  return rel.replace(/\.scrml$/, ".client.js");
}

/**
 * Resolve the absolute source path of a local `.scrml` import from the current
 * file's importGraph entry, matching on the raw import specifier. Returns null
 * when no importGraph is threaded (test harnesses) or no matching edge exists —
 * the importer then falls back to a path-relative key derived from the
 * specifier itself (preserving pre-#6 same-dir behavior).
 */
function resolveLocalImportAbsSource(
  filePath: string,
  source: string,
  importGraph: CompileContext["importGraph"],
): string | null {
  if (!importGraph) return null;
  const entry = importGraph.get(filePath);
  if (!entry || !Array.isArray(entry.imports)) return null;
  for (const imp of entry.imports) {
    if ((imp as any).source === source && typeof imp.absSource === "string") {
      return imp.absSource;
    }
  }
  return null;
}

/**
 * Build the exporter registration footer for a dependency `.client.js`.
 *
 * Returns the `_scrml_modules["<key>"] = { publicName: emittedName, ... };`
 * line(s) for THIS file when it is imported by another `.scrml` in the compile
 * unit, or an empty array otherwise. Public names come from `exportRegistry`;
 * emitted (possibly-mangled) names come from `fnNameMap` for fn/function
 * exports, and the un-mangled public name directly for everything else
 * (enums/variant objects/components/consts are emitted under their public name).
 *
 * The footer is emitted AFTER all function/enum/const decls so every referenced
 * binding is already declared. The `post-fn-name-mangle` pass does NOT corrupt
 * it: property KEYS are followed by `:` (outside the mangle lookahead char
 * class) and VALUES are already the final emitted names.
 */
function buildModuleRegistryFooter(
  ctx: CompileContext,
  fnNameMap: Map<string, string>,
  emittedLines: string[],
): string[] {
  const filePath: string = (ctx.fileAST as any)?.filePath;
  const importGraph = ctx.importGraph ?? null;
  const exportRegistry = ctx.exportRegistry ?? null;
  if (!filePath || !importGraph || !exportRegistry) return [];

  // Is THIS file imported by another .scrml in the compile unit? Scan every
  // file's import edges for one whose resolved absSource === this file.
  let isImportedByAnother = false;
  for (const [, entry] of importGraph) {
    if (!entry || !Array.isArray(entry.imports)) continue;
    for (const imp of entry.imports) {
      if (imp.absSource === filePath) { isImportedByAnother = true; break; }
    }
    if (isImportedByAnother) break;
  }
  if (!isImportedByAnother) return [];

  const exports = exportRegistry.get(filePath);
  const key = moduleRegistryKey(filePath, ctx.outputBaseDir);

  // Register only exports that have a REAL emitted client-side JS binding.
  // fn/function exports are mangled (bridge via fnNameMap); enums emit a
  // `const <Name> = Object.freeze(...)` variant object; value consts emit a
  // top-level `const`/`let`/`var <name>`. Type-only exports (pure structs) +
  // cross-file COMPONENTS (resolved at markup-mount time, not via a JS value)
  // + ENGINES + channels have NO client-side JS binding — registering them
  // would reference an undeclared identifier and throw at footer eval, poisoning
  // the whole script. We probe the already-emitted lines for a top-level
  // declaration of the export's emitted name; only declared bindings register.
  //
  // The footer is ALWAYS emitted (even when no name registers → `= {}`) for an
  // imported file, so the importer's `const { x } = _scrml_modules[key]` reads
  // an object (yielding `undefined` for markup/type-only names — harmless) and
  // never destructures `undefined` (which WOULD throw).
  const declaredBinding = (emittedName: string): boolean => {
    // Match a top-level declaration of `emittedName`: `function NAME`,
    // `const NAME`, `let NAME`, or `var NAME` (optionally `async function`),
    // allowing leading indentation. `emittedLines` is the pre-join line array,
    // so we test each line independently. Backslashes are doubled so the
    // RegExp source receives literal `\\s` / `\\b` metacharacters (a TS
    // template literal would otherwise collapse `\s` to `s`).
    const reDecl = new RegExp(
      `^\\s*(?:async\\s+)?(?:function|const|let|var)\\s+${escapeRegex(emittedName)}\\b`,
    );
    for (const line of emittedLines) {
      if (reDecl.test(line)) return true;
    }
    return false;
  };

  const pairs: string[] = [];
  if (exports) {
    for (const [publicName, info] of exports) {
      // Channels are inlined at the consumer site by CHX, never registered.
      if ((info as any)?.category === "channel" || (info as any)?.kind === "channel") continue;
      const emitted = fnNameMap.get(publicName) ?? publicName;
      if (!declaredBinding(emitted)) continue; // no client-side JS binding → skip
      pairs.push(`${publicName}: ${emitted}`);
    }
  }

  return [
    "// --- cross-file module registry footer (known-gaps-#6, §21.3) ---",
    `_scrml_modules[${JSON.stringify(key)}] = { ${pairs.join(", ")} };`,
    "",
  ];
}

// ---------------------------------------------------------------------------
// hasRuntimeMetaBlocks — detect ^{} blocks with capturedScope (§22.5)
// ---------------------------------------------------------------------------

/**
 * Walk the AST and return true if any meta node has a capturedScope set,
 * indicating it is a runtime meta block that requires the decode table.
 */
function hasRuntimeMetaBlocks(fileAST: any): boolean {
  const nodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function visit(nodeList: any[]): boolean {
    for (const node of nodeList) {
      if (!node) continue;
      if (isMetaKind(node.kind) && node.capturedScope) return true;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        if (visit(node.body)) return true;
      }
      if (Array.isArray(node.children)) {
        if (visit(node.children)) return true;
      }
    }
    return false;
  }
  return visit(nodes);
}

// ---------------------------------------------------------------------------
// detectRuntimeChunks — walk the AST and register needed runtime chunks.
//
// Populates ctx.usedRuntimeChunks based on what the compiled file uses.
// 'core', 'scope', and 'errors' are always included (pre-populated in
// makeCompileContext). This function adds conditionally-needed chunks.
//
// Detection is conservative: when in doubt, include the chunk. A false
// positive (chunk included but not used) adds a few KB. A false negative
// (chunk omitted but needed) causes a runtime crash.
//
// Chunk → triggering AST node kinds / features:
//   derived       state-decl with shape:"derived" + structuralForm:false
//                 (formerly reactive-derived-decl; folded in Phase A1a Step 11.5)
//   lift          lift-expr, or markup children containing lift bodies
//   timers        markup tag "timer", "poll", or "timeout"
//   animation     markup tag with animationFrame body, or direct animationFrame call
//   reconciliation for-stmt with @reactive iterable
//   utilities     reactive-nested-assign, debounce-call, throttle-call,
//                 upload-call, reactive-explicit-set, bare navigate call,
//                 state-decl with reactivity (debounced= / throttled= per §6.13).
//   meta          meta node
//   transitions   logic binding or event binding with transitionEnter/transitionExit
//   input         markup tag "keyboard", "mouse", or "gamepad"
//   deep_reactive state-decl (uses _scrml_deep_reactive), when-effect, bind: directives,
//                 CSS variable bridge with reactive refs, bind-props wiring,
//                 markup tag "request" (request-state object is deep-reactive-wrapped)
//   equality      match-stmt with enum arms, == / != binary ops (uses _scrml_structural_eq)
// ---------------------------------------------------------------------------

/**
 * Detect which runtime chunks are needed for the given fileAST and add them
 * to ctx.usedRuntimeChunks.
 *
 * Called before assembling the runtime in generateClientJs().
 */
function detectRuntimeChunks(fileAST: any, ctx: CompileContext): void {
  const chunks = ctx.usedRuntimeChunks;
  const allNodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];

  // server-keyword-eliminate-2026-06-10 (D1): resolve a function-decl node's
  // INFERRED server boundary from route-inference (§12), so the `wire`-chunk
  // gate (case "function-decl" below) lights up for a keyless-but-escalating
  // server fn — not just one carrying the deprecated `server` KEYWORD. Mirrors
  // route-inference's `makeFunctionNodeId` (`${filePath}::${fnNode.span.start}`)
  // and the canonical TS resolver (type-system.ts `functionBoundary`). The
  // keyword (`node.isServer`) is kept as a defensive OR-fallback for any node
  // RI did not classify (synthetic AST / no-RI call path / older FileAST shape).
  const __riFns: Map<string, { boundary?: string }> | undefined =
    ctx.routeMap?.functions;
  const __chunkFilePath: string = ctx.filePath ?? fileAST?.filePath ?? "";
  function functionDeclIsServerBoundary(node: any): boolean {
    if (node?.isServer === true) return true;
    if (!__riFns) return false;
    const start = node?.span?.start;
    if (typeof start !== "number") return false;
    const entry = __riFns.get(`${__chunkFilePath}::${start}`);
    return entry?.boundary === "server";
  }

  // PGO Phase 3 follow-up C2 (S108) — fused TAB-time presence flags for the
  // markup-tag + for-stmt chunk-gate surfaces. The walker
  // `detectMarkupForStmtChunkPresence` (ast-builder.js) runs once at TAB time
  // and caches { hasChunkedMarkupTag, hasForStmt } on the FileAST. Reading the
  // flags here is O(1) — no descent, no walk. Sibling Option-2 pattern to
  // hasResetExpr (S102) + hasEqualityExpr (S106).
  //
  // **hasForStmt gate (`buildFunctionBodyRegistry` skip):** the function-body
  // registry exists ONLY to support the for-stmt iter-reactivity transitive
  // probe (`iterableHasReactiveRefs` at the `case "for-stmt"` site below).
  // When the file has NO for-stmt nodes, the registry is never consulted, so
  // building it is pure waste. The S96 Issue C precedent (function-call
  // transitive reactive deps) still applies for files that DO have for-stmts —
  // we build the registry conditionally instead of unconditionally.
  //
  // **hasChunkedMarkupTag gate (in-walk markup tag-test skip):** when the
  // file has NO markup tag in {timer/poll/timeout/keyboard/mouse/gamepad},
  // the in-walk `case "markup"` tag-test block can be elided. The recursion
  // into markup children still fires (other kinds may live inside markup).
  //
  // When either flag is `undefined` (synthetic AST / legacy caller / older
  // FileAST shape), the in-walk probe and registry build both fall back to
  // pre-fix behaviour (full work). This preserves correctness for any caller
  // that doesn't go through the canonical `buildAST` path.
  const __hasChunkedMarkupTagFlag = fileAST?.ast?.hasChunkedMarkupTag ?? fileAST?.hasChunkedMarkupTag;
  const __hasForStmtFlag = fileAST?.ast?.hasForStmt ?? fileAST?.hasForStmt;
  const __chunkedMarkupTagDefinitivelyAbsent = __hasChunkedMarkupTagFlag === false;
  const __forStmtDefinitivelyAbsent = __hasForStmtFlag === false;

  // S96 Issue C — build the function-body registry once so the for-stmt
  // chunk-gate (case "for-stmt" below) can detect transitive reactive
  // dependencies through function-call iterables (`fn()` where fn body
  // reads `@state`). Without this, the gate misses Cases 3 + transitive
  // from the Option A table — see iterableHasReactiveRefs docstring.
  // Mirror of the registry build at emit-reactive-wiring.ts:286.
  //
  // PGO P3 follow-up C2 (S108) — skip the registry build when the TAB-time
  // walker proved no for-stmt exists in the file. The registry is consumed
  // only by `iterableHasReactiveRefs` at the `case "for-stmt"` site below,
  // which never fires if no for-stmt exists. Skipping avoids a full AST
  // collectFunctions walk for pure-logic / no-loop files.
  const fnRegistry = __forStmtDefinitivelyAbsent
    ? null
    : buildFunctionBodyRegistry(
        fileAST?.ast ?? fileAST ?? {},
      );

  // PGO P3.B follow-up (Option 2, S102) — O(1) reset-expr chunk gate.
  //
  // Pre-fix: the per-node ExprNode probe at line ~365 below scanned every
  // ExprNode subtree looking for `reset-expr` nodes (alongside `==`/`!=`).
  // Per the P3.B agent's instrumentation, the reset-side sub-probe was the
  // largest residual sub-component of detect-runtime-chunks cost — ~123ms
  // on trucking-dispatch after P3.B's fused-probe + structural-skip work.
  //
  // Post-fix: `ast-builder.js → detectResetExprPresence` walks the AST
  // exactly once at TAB time and caches the boolean on `FileAST.hasResetExpr`.
  // Reading the flag here is O(1) — no descent, no walk. Once `chunks.has(
  // "reset")` is true the in-walk probe's `needReset && !chunks.has("reset")`
  // condition (line ~374) becomes false on every node, so the reset-side
  // scanning is fully short-circuited inside `probeExprForEqualityAndReset`.
  //
  // **Correctness — chunk-set identity:** the `reset` chunk is included iff
  // the file has at least one `reset-expr` node (or one of the other gates
  // below: state-decl `defaultExpr`, validators, etc.). The previous walk's
  // ExprNode-side rule was "fire `chunks.add('reset')` once a reset-expr
  // is seen". `hasResetExpr` from TAB encodes exactly that predicate, so
  // chunk-set inclusion is byte-identical to pre-fix. Other gates (kind-
  // based: state-decl, function-decl, etc.) are unchanged and still fire
  // independently in the kind-switch below.
  // Capture the AST-cached flag once. When `hasResetExpr === true`, we pre-
  // activate the `reset` chunk so the in-walk probe at line ~395 sees
  // `chunks.has("reset") === true` and short-circuits reset-side scanning
  // immediately. When `hasResetExpr === false`, the boolean is used directly
  // to gate `needReset` in the in-walk probe — the AST is guaranteed to
  // contain no `reset-expr` node, so the probe doesn't need to look.
  // When the field is missing entirely (legacy callers / synthetic ASTs),
  // we fall back to the pre-fix behaviour (probe scans both sides).
  const __hasResetExprFlag = fileAST?.ast?.hasResetExpr ?? fileAST?.hasResetExpr;
  if (__hasResetExprFlag === true) {
    chunks.add("reset");
  }
  // `false` when the AST builder cached a definitive negative; `undefined`
  // when the field was not produced (synthetic AST / legacy caller). The
  // in-walk probe at line ~395 reads this to skip reset-side scanning.
  const __resetExprDefinitivelyAbsent = __hasResetExprFlag === false;

  // PGO Phase 3 follow-up C1 (S106) — sibling Option-2 pattern to hasResetExpr
  // above. The TAB-time walker `detectEqualityExprPresence` (ast-builder.js)
  // caches the boolean on `FileAST.hasEqualityExpr`. Reading it here is O(1)
  // — no descent, no walk. When `true`, pre-activate the `equality` chunk so
  // the in-walk probe (line ~415 below) sees `chunks.has("equality") === true`
  // and short-circuits equality-side scanning. When `false`, the boolean
  // gates `needEquality` in the in-walk probe — the AST is guaranteed to
  // contain no binary `==` or `!=` operator, so the probe doesn't need to
  // look. When the field is missing entirely (synthetic AST / legacy caller),
  // fall back to the pre-fix behaviour (probe scans equality side).
  // Correctness — chunk-set identity: the `equality` chunk is included iff
  // the file has at least one `==` / `!=` binary op (or one of the other
  // gates: match-stmt with enum arms). hasEqualityExpr from TAB encodes
  // exactly the ExprNode-side predicate, so chunk-set inclusion is byte-
  // identical to pre-fix. Other gates (kind-based: match-stmt enum arms in
  // the kind-switch below) are unchanged and still fire independently.
  const __hasEqualityExprFlag = fileAST?.ast?.hasEqualityExpr ?? fileAST?.hasEqualityExpr;
  if (__hasEqualityExprFlag === true) {
    chunks.add("equality");
  }
  const __equalityExprDefinitivelyAbsent = __hasEqualityExprFlag === false;

  // §59 (D4) — `map` chunk gate. Light up the `'map'` runtime chunk (which
  // carries `_scrml_fnv1a` + `_scrml_value_canonical` + all `_scrml_map_*`
  // helpers) whenever this file USES a value-native map — a declared `[KeyT:
  // ValT]` cell, a `map-lit` literal anywhere, a bracket-read/method/`.size` on
  // a map cell (all of which require a declared map cell → covered by
  // `collectMapVarNames` inside `fileHasMapUsage`). WITHOUT this gate the
  // helpers are tree-shaken out of the assembled runtime and the first
  // `_scrml_map_get` throws `ReferenceError` (SURVEY-SYNTHESIS D4 R2 — the #1
  // integration risk). Conservative: a false positive costs a few KB; a false
  // negative crashes at runtime.
  if (fileHasMapUsage(fileAST?.ast ?? fileAST ?? {})) {
    chunks.add("map");
  }

  // A-4.3 + A-4.5 — `prefetch` chunk lights up when the Stage 7.6 RS has
  // produced EITHER:
  //   (i)  at least one non-empty tier-1 ChunkContents (A-4.3 — idle prefetch
  //        via `_scrml_prefetch_tier1`); OR
  //   (ii) at least one non-empty tier-N (N>=3) ChunkContents (A-4.5 — on-
  //        demand dispatch via `_scrml_fetch_chunk`).
  // for an entry point in THIS file. The initial-chunk IIFE emits a tail
  // `_scrml_prefetch_tier1` call when tier-1 admission is non-empty; the
  // tier-N case is structurally scaffolded (RS emits empty tier-N in v0.3
  // per OQ-A2-B Option a — no call site emitted by codegen) but the chunk
  // activation gate accepts it so that when RS extends to N>=3 in v0.4+,
  // `_scrml_fetch_chunk` automatically lands in the emitted runtime
  // without requiring a touch to emit-client.ts.
  //
  // Tree-shake floor (§40.9.9 worked example): every (EP, role) has EMPTY
  // tier-1 AND tier-N admission for the worked-example fixture. The scan
  // here returns false and the prefetch chunk does NOT land in the per-
  // file `.client.js`'s runtime slice. (The shared `scrml-runtime.js`
  // path is full-runtime by design — `runtimeJs = SCRML_RUNTIME` in
  // `index.ts` — and is governed by `embedRuntime: false`. Embed mode
  // uses the per-file `usedRuntimeChunks` and IS subject to the tree-
  // shake.)
  function chunkContentsNonEmpty(c: any): boolean {
    return !!c && (
      c.componentNodeIds.size > 0 ||
      c.reactiveCellNodeIds.size > 0 ||
      c.serverFnNodeIds.size > 0 ||
      c.vendorUnitNames.size > 0
    );
  }
  const reach = ctx.reachabilityRecord;
  if (reach && reach.closures && ctx.filePath) {
    // A-4.7 — `mount` + `vendor-ref` activation. The two chunk-side
    // record-keeping helpers (`_scrml_chunk_mount`, `_scrml_vendor_require`)
    // are referenced from atom-emitter output baked into the per-(EP,
    // role, tier) chunk file. Activate `mount` when ANY chunk in the
    // file's reachability record admits a non-empty markup-node set;
    // activate `vendor-ref` similarly for vendor units. Both gates
    // examine ALL three tiers (initial, tier-1, tier-N) because the
    // atom-emitter is shared across tiers — any tier admitting content
    // produces the call sites.
    function chunkHasComponents(c: any): boolean {
      return !!c && c.componentNodeIds && c.componentNodeIds.size > 0;
    }
    function chunkHasVendorUnits(c: any): boolean {
      return !!c && c.vendorUnitNames && c.vendorUnitNames.size > 0;
    }
    for (const [epId, rps] of reach.closures) {
      // EpId encodes the source file path as a prefix (either
      // `<filePath>::#program` or `<filePath>#page@<routePath>`).
      // We accept either separator to match the dual EpId shapes
      // produced by reachability/entry-points.ts.
      const idStr = String(epId);
      const fileMatches =
        idStr.startsWith(ctx.filePath + "::") ||
        idStr.startsWith(ctx.filePath + "#");
      if (!fileMatches) continue;
      for (const [, plan] of rps.byRole) {
        if (chunkContentsNonEmpty(plan.prefetchTier1)) {
          chunks.add("prefetch");
        }
        // A-4.5 — tier-N admission also lights up the prefetch chunk so
        // `_scrml_fetch_chunk` is present in the emitted runtime when
        // any deep-traversal chunk exists. In v0.3 this branch never
        // fires (RS always emits prefetchTierN: []).
        const tierN = plan.prefetchTierN;
        if (Array.isArray(tierN) && tierN.some(chunkContentsNonEmpty)) {
          chunks.add("prefetch");
        }
        // A-4.7 — mount activation: any tier with admitted markup
        // components produces atom-emitter `_scrml_chunk_mount(...)`
        // calls in the chunk file.
        if (
          chunkHasComponents(plan.initialChunk) ||
          chunkHasComponents(plan.prefetchTier1) ||
          chunkHasComponents(plan.prefetchTier2) ||
          (Array.isArray(tierN) && tierN.some(chunkHasComponents))
        ) {
          chunks.add("mount");
        }
        // A-4.7 — vendor-ref activation: any tier with admitted vendor
        // units produces atom-emitter `_scrml_vendor_require(...)`
        // calls in the chunk file.
        if (
          chunkHasVendorUnits(plan.initialChunk) ||
          chunkHasVendorUnits(plan.prefetchTier1) ||
          chunkHasVendorUnits(plan.prefetchTier2) ||
          (Array.isArray(tierN) && tierN.some(chunkHasVendorUnits))
        ) {
          chunks.add("vendor-ref");
        }
      }
    }
  }

  // A-4.4 — `prefetch` chunk also lights up when this file's HTML
  // emission produced at least one internal `<a data-scrml-prefetch>`
  // attribute (i.e. the hover-handler attachment block was emitted
  // into the initial chunk and the runtime `_scrml_prefetch_tier2`
  // call target needs to ship). `emit-html.ts` flips the flag during
  // the markup walk; we read it here to gate the runtime inclusion.
  //
  // The same `prefetch` chunk also covers `_scrml_prefetch_tier1`
  // (A-4.3) — single marker, both runtime functions in the same chunk
  // range; see `runtime-chunks.ts:CHUNK_MARKERS.prefetch`.
  if (ctx.hasPrefetchableLinks) {
    chunks.add("prefetch");
  }

  // Stdlib registry chunks (Bug 18 fix, S95) — light up `stdlib-<name>`
  // when this file imports from `scrml:<name>`. The chunk populates
  // `_scrml_stdlib.<name>` so the import-rewrite emitted below resolves
  // at runtime. Browsers cannot resolve bare `scrml:NAME` specifiers;
  // emitting the bare import statement is a SyntaxError in classic-
  // script context.
  const allImportsForStdlib: any[] = fileAST?.ast?.imports ?? fileAST?.imports ?? [];
  for (const stmt of allImportsForStdlib) {
    if ((stmt.kind === "import-decl" || stmt.kind === "use-decl") && typeof stmt.source === "string") {
      if (stmt.source.startsWith("scrml:")) {
        const name = stmt.source.slice("scrml:".length);
        const chunkName = `stdlib-${name}`;
        // Only register chunks the runtime actually carries. Unknown
        // names fall through; the import is dropped at emit time below
        // and use sites produce a clear runtime error.
        if (RUNTIME_CHUNK_ORDER.includes(chunkName as any)) {
          chunks.add(chunkName);
        }
      }
    }
  }

  // known-gaps-#6 (S152) — `modules` chunk (the §21.3 _scrml_modules registry).
  // Activate when this file participates in cross-file local `.scrml` linking,
  // i.e. it EITHER imports a local `.scrml` (an importer that emits a registry
  // read) OR is imported by another `.scrml` in the compile unit (an exporter
  // that emits a registration footer). Single-file apps + leaf pages with no
  // cross-file local imports never carry the registry. The compile-unit-wide
  // chunk union (index.ts) guarantees the runtime ships the chunk whenever ANY
  // file lights it up, so importer + exporter always share one registry.
  {
    const filePath: string = (ctx.fileAST as any)?.filePath ?? (fileAST as any)?.filePath;
    const importGraph = ctx.importGraph ?? null;
    let crossFileLocal = false;
    // (a) this file imports a local `.scrml`?
    for (const stmt of allImportsForStdlib) {
      if (
        (stmt.kind === "import-decl" || stmt.kind === "use-decl") &&
        typeof stmt.source === "string" &&
        stmt.source.endsWith(".scrml")
      ) { crossFileLocal = true; break; }
    }
    // (b) this file is imported by another `.scrml`?
    if (!crossFileLocal && importGraph && filePath) {
      for (const [, entry] of importGraph) {
        if (!entry || !Array.isArray(entry.imports)) continue;
        for (const imp of entry.imports) {
          if (imp.absSource === filePath) { crossFileLocal = true; break; }
        }
        if (crossFileLocal) break;
      }
    }
    if (crossFileLocal) chunks.add("modules");
  }

  // PGO P3.B (S102) — fused iterative ExprNode probe with structural skip.
  //
  // Pre-P3.B: `exprNeedsEquality` and `exprContainsResetExpr` each ran a full
  // recursive walk over every ExprNode-valued field of every AST node. Each
  // probe re-walked the same expression sub-tree. When the outer walkNodes
  // visited a markup node, the probe would also be called on the markup's
  // children array — re-walking the same markup subtree that walkNodes was
  // about to recurse into anyway. Doubled work.
  //
  // Post-P3.B:
  //   1. Single iterative stack-based walk that checks both conditions
  //      simultaneously.
  //   2. Structural-skip via a kind allow-list: only descend into nodes
  //      whose kind is on the ExprNode/expression-shape allow-list. Structural
  //      AST kinds (markup, logic, function-decl, state-decl bodies, etc.)
  //      are already visited by the outer walkNodes — there is no need to
  //      re-walk them here. This avoids re-traversing the entire markup
  //      subtree from every parent's probe call.
  //
  // The allow-list covers every ExprNode kind produced by expression-parser.ts
  // plus a small set of structural shapes (e.g. `arm.pattern`, attribute
  // value) where ExprNode subtrees live but the outer walk would not re-
  // visit. Conservatism rule: if a kind might contain `==` or `reset-expr`,
  // it must be on the list. Unknown kinds are descended into for safety —
  // false positives at this gate just produce extra work, never wrong chunks.
  //
  // Structural-AST kinds that the outer walker handles — DO NOT descend here:
  //   markup, logic, function-decl, state-decl, let-decl, const-decl,
  //   tilde-decl, for-stmt, while-stmt, if-stmt, match-stmt, return-stmt,
  //   bare-expr, when-effect, engine-decl, meta, type-decl, import-decl,
  //   use-decl, lift-expr, reactive-nested-assign, upload-call,
  //   reactive-explicit-set, channel-decl, css, state-constructor-def,
  //   component-decl, render-decl, snippet-decl, state-decl-arm, route-decl.
  const STRUCTURAL_AST_KINDS = new Set<string>([
    "markup", "logic", "function-decl", "state-decl", "let-decl", "const-decl",
    "tilde-decl", "for-stmt", "while-stmt", "if-stmt", "match-stmt", "return-stmt",
    "bare-expr", "when-effect", "engine-decl", "meta", "type-decl", "import-decl",
    "use-decl", "channel-decl", "css", "state-constructor-def", "component-decl",
    "render-decl", "snippet-decl", "route-decl", "engine-arm", "engine-rule",
    "engine-onTransition", "engine-effect", "engine-onTimeout", "if-chain",
    "try-stmt", "catch-clause", "finally-clause", "register-cleanup", "match-arm",
    "switch-stmt", "switch-case", "lift-expr", "reactive-nested-assign",
    "upload-call", "reactive-explicit-set", "for-expr",
  ]);
  function probeExprForEqualityAndReset(
    expr: any,
    needEquality: boolean,
    needReset: boolean,
  ): { foundEquality: boolean; foundReset: boolean } {
    if (!expr || typeof expr !== "object" || (!needEquality && !needReset)) {
      return { foundEquality: false, foundReset: false };
    }
    let foundEquality = false;
    let foundReset = false;
    const stack: any[] = [expr];
    while (stack.length > 0) {
      // Cheap doubled short-circuit — saves walking the remainder of a tree
      // once the file has both flags.
      if (
        (foundEquality || !needEquality) &&
        (foundReset || !needReset)
      ) break;
      const e = stack.pop();
      if (!e || typeof e !== "object") continue;
      const kind = (e as any).kind;
      if (needEquality && !foundEquality && kind === "binary" && (e.op === "==" || e.op === "!=")) {
        foundEquality = true;
      } else if (needReset && !foundReset && kind === "reset-expr") {
        foundReset = true;
      }
      // Structural-skip: if this node is a structural AST kind, the outer
      // walkNodes/walkBody already visits it. Don't re-descend.
      if (typeof kind === "string" && STRUCTURAL_AST_KINDS.has(kind)) continue;
      // Push children. Iterative descent matches the pre-P3.B walker semantics
      // for ExprNode subtrees.
      for (const key in e) {
        const v = e[key];
        if (v && typeof v === "object") {
          if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
              const el = v[i];
              if (el && typeof el === "object") stack.push(el);
            }
          } else {
            stack.push(v);
          }
        }
      }
    }
    return { foundEquality, foundReset };
  }

  // Walk the full AST tree recursively
  function walkNodes(nodes: any[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      detectFromNode(node);
      if (Array.isArray(node.children)) walkNodes(node.children);
      if (Array.isArray(node.body)) walkBody(node.body);
    }
  }

  function walkBody(body: any[]): void {
    if (!Array.isArray(body)) return;
    for (const stmt of body) {
      if (!stmt || typeof stmt !== "object") continue;
      detectFromNode(stmt);
      if (Array.isArray(stmt.body)) walkBody(stmt.body);
      if (Array.isArray(stmt.consequent)) walkBody(stmt.consequent);
      if (Array.isArray(stmt.alternate)) walkBody(stmt.alternate);
      if (Array.isArray(stmt.children)) walkNodes(stmt.children);
    }
  }

  function detectFromNode(node: any): void {
    const kind: string = node.kind ?? "";

    // Check all ExprNode-valued fields for structural equality ops (== / !=)
    // and C5's reset-expr (triggers `reset` chunk).
    //
    // PGO P3.B (S102) — fused probe + outer short-circuit. If both chunks
    // are already activated for this file, skip the entire scan (which
    // before this fix was O(deep-tree-size × ExprNode-fields-per-node)).
    // PGO Phase 3 follow-up C1 (S106) — gate `needEquality` on the AST-cached
    // `hasEqualityExpr` flag (sibling pattern to hasResetExpr below). When the
    // flag is `false`, the TAB-time walker proved no binary `==`/`!=` exists
    // anywhere in the AST, so the in-walk probe doesn't need to scan equality-
    // side. When the flag is `true`, `chunks.add("equality")` was called above
    // and `chunks.has("equality")` is already true → needEquality is false.
    // When the flag is `undefined` (synthetic AST / legacy caller), fall back
    // to the pre-fix behaviour: probe scans equality side.
    const needEquality = !chunks.has("equality") && !__equalityExprDefinitivelyAbsent;
    // PGO P3.B follow-up (Option 2, S102) — gate `needReset` on the AST-cached
    // `hasResetExpr` flag. When the flag is `false`, we KNOW with certainty
    // no `reset-expr` node exists anywhere in the AST (the TAB-time walker
    // already proved it), so the in-walk probe doesn't need to scan reset-
    // side. When the flag is `true`, `chunks.add("reset")` was called above,
    // so `chunks.has("reset")` is already true and `needReset` falls naturally
    // to false. When the flag is `undefined` (synthetic AST / legacy caller),
    // fall back to the pre-fix behaviour: probe scans both sides.
    const needReset = !chunks.has("reset") && !__resetExprDefinitivelyAbsent;
    if (needEquality || needReset) {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (v && typeof v === "object" && typeof v.kind === "string") {
          const { foundEquality, foundReset } = probeExprForEqualityAndReset(
            v,
            needEquality && !chunks.has("equality"),
            needReset && !chunks.has("reset"),
          );
          if (foundEquality) chunks.add("equality");
          if (foundReset) chunks.add("reset");
          if (chunks.has("equality") && chunks.has("reset")) break;
        }
      }
    }

    switch (kind) {
      // Phase A1a Step 11.5 — `reactive-derived-decl` folded into state-decl
      // (the `case "state-decl"` below handles the post-fold representation
      // and gates the `derived` chunk on shape:"derived").

      // lift — DOM lift expressions
      case "lift-expr":
        chunks.add("lift");
        break;

      // v0.3.x SPA tree-shake (Phase B 3.2) — `wire` chunk gate.
      // The §57 dual-decoder `_scrml_wire_decode` is only referenced from
      // emitted server-fn fetch stubs (emit-functions.ts at the `T | not`
      // call site + atom-emitter.ts at the chunked server-fn stub call
      // site). Activate the chunk whenever a server `function-decl` appears
      // in this file's AST. The gate is conservative: even pure-`T`
      // server-fns activate the chunk (the helper is small and the
      // detectRuntimeChunks walk runs before return-type analysis would
      // be available here). A future tightening could gate on
      // `returnTypeAllowsAbsence(fn.returnTypeAnnotation)` per server-fn.
      //
      // server-keyword-eliminate-2026-06-10 (D1): gate on the INFERRED
      // server boundary (route-inference §12), NOT the deprecated `server`
      // KEYWORD. A function with an escalating body (a `?{}` SQL block, a
      // server-only import, file-IO, a protected-field access, a server
      // callee) is server-boundary even WITHOUT the `server` keyword —
      // RI escalated it. Keying on `node.isServer` (the keyword flag) would
      // drop the `wire` chunk for a keyless-but-escalating server fn, and its
      // emitted fetch stub's `_scrml_wire_decode` reference would crash at
      // runtime. `functionDeclIsServerBoundary` resolves the node's boundary
      // via `ctx.routeMap` (keyed `${filePath}::${span.start}`, RI's
      // `makeFunctionNodeId`), with the keyword as a defensive OR-fallback for
      // any node RI did not classify (synthetic AST / no-RI call path).
      case "function-decl":
        if (functionDeclIsServerBoundary(node)) {
          chunks.add("wire");
        }
        break;

      // v0.3.x SPA tree-shake (Phase B 3.2) — `wire` chunk gate (sidecar
      // form). `use foreign:NAME { fn-list }` (§23.4) imports
      // sidecar-process functions whose call sites flow through the same
      // wire-format decoder path as cross-boundary server-fns. Activate
      // the chunk when the source string begins with `foreign:`.
      case "use-decl":
        if (
          typeof (node as any).source === "string" &&
          (node as any).source.startsWith("foreign:")
        ) {
          chunks.add("wire");
        }
        break;

      // state-decl — @x = value. Uses _scrml_deep_reactive for object/array wrapping.
      // Phase A1a Step 11.5 — fold: state-decl with shape:"derived" AND
      // structuralForm:false is the post-fold representation of legacy
      // `const @x = expr` (formerly reactive-derived-decl). Triggers the
      // `derived` chunk in addition to `deep_reactive`.
      // C5 (§6.8): a state-decl with `defaultExpr !== null` triggers the
      // `reset` chunk (default= storage helper). Plain Shape 1/Shape 2 cells
      // also emit an init-thunk via `_scrml_init_set` so reset can re-evaluate
      // the init expression — but that's also part of the `reset` chunk.
      // Conservative trigger: if any state-decl has `defaultExpr` set, we
      // need the chunk. The companion trigger (a `reset-expr` AST node anywhere
      // in the file) is handled by the ExprNode walker below.
      case "state-decl":
        chunks.add("deep_reactive");
        // Derived chunk gate covers BOTH the legacy folded form
        // (shape:"derived" + structuralForm:false — Phase A1a Step 11.5 fold of
        // `reactive-derived-decl` into state-decl, the `const @x = expr` shape)
        // AND the Shape 3 V5-strict form (`const <x> = expr` with
        // structuralForm:true). Both emit `_scrml_derived_declare` /
        // `_scrml_derived_subscribe` call sites; without the chunk, those calls
        // throw at runtime. Pre-S103 only the structuralForm:false branch was
        // covered — V5-strict derived cells leaked through the tree-shaker and
        // broke at runtime when imported. Surfaced while landing P1.B runtime
        // instrumentation (the TodoMVC fixture uses `const <visibleTodos>`).
        if ((node as any).shape === "derived") {
          chunks.add("derived");
        }
        // markup-value-in-expression-2026-06-17 — markup-typed derived cells
        // (`const <x> = <markup>`, the §6.6.17 markup-as-value derived form)
        // carry `shape: "decl-with-spec"` + `_cellKind: "markup-typed"`, NOT
        // `shape: "derived"`. emit-logic.ts still emits a `_scrml_derived_declare`
        // for them (factory-shell → derived cell), so without this gate the
        // `derived` chunk is tree-shaken away and the call throws
        // `_scrml_derived_declare is not defined` at runtime — the same
        // tree-shake class as Bug 57. Pull the chunk for the markup-typed form.
        if ((node as any)._cellKind === "markup-typed") {
          chunks.add("derived");
        }
        if ((node as any).defaultExpr) {
          chunks.add("reset");
        }
        // S79 / §6.13: a state-decl with `reactivity` set (debounced= /
        // throttled=) triggers the `utilities` chunk — that's where the
        // _scrml_reactive_debounced / _scrml_reactive_throttled / register
        // helpers live. The cancel-on-reset path lives in `_scrml_reset`
        // ('reset' chunk), so trigger that too — but only when a rule is
        // actually present (a future write may reset() the cell, and the
        // reset chunk's call into _scrml_reactivity_cancel needs the
        // utilities chunk to be present so the lookup resolves).
        if ((node as any).reactivity) {
          chunks.add("utilities");
        }
        // C7 (§55.2 + §55.6): a state-decl with non-empty validators[] triggers
        // the `validators` runtime chunk (14 fire functions + VALIDATOR_RUNTIME
        // map + _scrml_validator_fire dispatch). C7 codegen emits the per-cell
        // runner as a derived computation, so the `derived` chunk is also
        // required. Top-level non-compound cells with validators technically
        // hit this trigger too — they include the chunk even though C7 emits
        // no runner (no per-field synth surface to write to per §55.5 L11
        // Edge A). Conservative tree-shaking — a few KB cost over correctness.
        if (
          Array.isArray((node as any).validators) &&
          (node as any).validators.length > 0
        ) {
          chunks.add("validators");
          chunks.add("derived");
          // C10 (§55.10 L12): Level-1 inline override emission. When ANY
          // validator on this cell carries a non-null `inlineOverride`, the
          // emitted code calls `_scrml_messages_register_inline` from the
          // `messages` chunk. Tree-shaken when no inline overrides exist
          // and (future, C11) no `<errors of=>` element appears.
          for (const v of (node as any).validators as any[]) {
            if (v && typeof v.inlineOverride === "string") {
              chunks.add("messages");
              break;
            }
          }
        }
        // C8 (§55.5/§55.6/§55.7): every compound-parent state-decl triggers
        // the validity-surface synth emission (compound-level rollup +
        // per-field touched + compound submitted + per-field trivial defaults).
        // The emission uses:
        //   - `derived` chunk — _scrml_derived_declare/get/subscribe for the
        //     compound errors/isValid/touched derivations + per-field trivial
        //     defaults.
        //   - `reset` chunk — _scrml_init_set registrations for per-field
        //     touched + compound submitted (so reset(@compound) clears them
        //     per §55.13).
        // Predictability rule (§55.5): unconditional for every compound
        // parent — even compounds with no validator-bearing fields get the
        // surface with trivially-true isValid + empty errors.
        if (
          (node as any)._cellKind === "compound-parent" ||
          Array.isArray((node as any).children)
        ) {
          chunks.add("derived");
          chunks.add("reset");
        }
        break;

      // timers — <timer> and <poll> markup elements
      case "markup": {
        // PGO P3 follow-up C2 (S108) — gate the tag-test block on the AST-
        // cached `hasChunkedMarkupTag` flag. When `false`, the TAB-time walker
        // proved no markup tag in {timer/poll/timeout/keyboard/mouse/gamepad}
        // exists anywhere in the AST, so the in-walk tag-test can be elided.
        // The recursion into markup children below still fires (other kinds
        // may live inside markup). When the flag is `undefined` (synthetic
        // AST / legacy caller), fall back to pre-fix behaviour: run the tag-
        // test. Channel tag is unconditional (no-op — kept for documentary
        // value; structural-AST-kind detection already happens elsewhere).
        if (!__chunkedMarkupTagDefinitivelyAbsent) {
          const tag: string = node.tag ?? "";
          if (tag === "timer" || tag === "poll" || tag === "timeout") {
            chunks.add("timers");
            chunks.add("deep_reactive"); // emitLifecycleNode uses _scrml_effect for running=@var
          }
          if (tag === "keyboard" || tag === "mouse" || tag === "gamepad") {
            chunks.add("input");
          }
          if (tag === "request") {
            // <request> state object is _scrml_deep_reactive(...)-wrapped so its
            // .loading/.data/.error mutations trigger effect re-render (the §6.7.7
            // render bridge). It uses _scrml_register_cleanup (always in 'scope').
            chunks.add("deep_reactive");
          }
          if (tag === "channel") {
            // <channel> generates inline WebSocket code (no runtime chunk needed)
            // but uses _scrml_register_cleanup — already in 'scope' (always included)
          }
        }
        // Check for reactive for-loop (iterable is @varName) — within children
        if (Array.isArray(node.children)) {
          walkNodes(node.children);
        }
        break;
      }

      // for-stmt — reactive for-loops use _scrml_reconcile_list + _scrml_effect_static + _scrml_lift
      case "for-stmt": {
        // S96 Issue C — predicate widened from "iterable is bare @ident" to
        // "iterable contains any @-prefix ref (direct or transitive through
        // fn-call body)". Closes the silent-non-reactivity gap for shapes
        // like `for (let x of @cell.filter(...))` and `for (let x of fn())`
        // where fn body reads `@state`. V5-strict ensures bare identifiers
        // are LOCAL (per §6.1.3 + E-NAME-COLLIDES-STATE), so "no @-ref" is
        // unambiguously snapshot semantics. See iterableHasReactiveRefs
        // in reactive-deps.ts for the helper.
        //
        // PGO P3 follow-up C2 (S108) — when `fnRegistry` is null (the TAB-time
        // walker proved no for-stmt exists, so we skipped building the registry),
        // this case can't fire. Defensively guard against an inconsistent state
        // (case fires despite no registry) by falling back to the non-registry
        // form of `iterableHasReactiveRefs`, which still checks direct @-refs
        // and just misses the transitive fn-body case. Soundness > completeness:
        // a missed transitive case here would only happen if the TAB-time walker
        // returned `hasForStmt: false` when it should have been `true`, which
        // would be a TAB-time bug. The fallback is purely defensive.
        const iterIsReactive = iterableHasReactiveRefs(node, fnRegistry);
        if (iterIsReactive) {
          chunks.add("reconciliation");
          chunks.add("lift");
          chunks.add("deep_reactive"); // _scrml_effect_static
        }
        if (Array.isArray(node.body)) walkBody(node.body);
        break;
      }

      // each-block — Tier-1 `<each>` iteration (SPEC §17.X). emit-each.ts's
      // emitEachBodyRenderForFile ALWAYS emits a `_scrml_reconcile_list(...)`
      // call site (keyed list reconciliation) plus a `_scrml_effect_static(...)`
      // dispatcher that re-runs the render on dep change. Those helpers live in
      // the `reconciliation` and `deep_reactive` chunks respectively. Without
      // this case the chunk-walk had NO `each-block` discriminator, so a file
      // whose ONLY iteration is `<each>` (no Tier-0 `${for…lift}`, which is the
      // sole other `reconciliation` trigger at `case "for-stmt"` above) shipped
      // a client bundle that CALLS `_scrml_reconcile_list` but a runtime bundle
      // that never DEFINES it → ReferenceError on first `_scrml_each_render_N()`
      // (Bug 57, HIGH silent-miscompile). Compile exits 0 and `node --check`
      // passes because the call site is syntactically valid; the gap is purely
      // tree-shaking. Both chunks are unconditional: `_scrml_reconcile_list`
      // because every non-empty each emits the call, and `_scrml_effect_static`
      // (in `deep_reactive`) because an `of=N`/`in=N` over a snapshot literal
      // with no `@`-state decl would otherwise lose the dispatcher helper too.
      case "each-block": {
        chunks.add("reconciliation"); // _scrml_reconcile_list + _scrml_lis
        chunks.add("deep_reactive");  // _scrml_effect_static dispatcher
        // The each-block node carries its walkable AST in bodyChildren /
        // templateChildren / emptyChild — NOT in `children`/`body` — so the
        // outer walkNodes/walkBody recursion does not descend into it. Recurse
        // explicitly so chunk-requiring shapes inside the per-item template
        // (lift-expr, nested `<each>`, nested `${for…lift}`, bind: directives)
        // are still detected for chunk-gating.
        if (Array.isArray(node.bodyChildren)) walkNodes(node.bodyChildren);
        break;
      }

      // meta — ^{} runtime meta blocks use _scrml_meta_effect
      case "meta":
        chunks.add("meta");
        break;

      // when-effect — uses _scrml_effect
      case "when-effect":
        chunks.add("deep_reactive");
        break;

      // register-cleanup — uses _scrml_register_cleanup (already in 'scope')
      // No extra chunk needed.

      // utilities — various utility function calls
      case "reactive-nested-assign":
        chunks.add("utilities"); // _scrml_deep_set
        break;
      // S79 — case "reactive-debounced-decl" RETIRED (state-decl with
      // reactivity field handles the chunk-trigger now).
      // S81 OQ-2 (2026-05-11) — `case "debounce-call"` + `case "throttle-call"`
      // RETIRED. Imperative form replaced by stdlib `scrml:time.debounce`/
      // `throttle` imports (regular function calls; chunk-trigger inferred
      // from the import + the importing module's chunk needs).
      case "upload-call":
        chunks.add("utilities"); // _scrml_upload
        break;
      case "reactive-explicit-set":
        chunks.add("utilities"); // _scrml_reactive_explicit_set
        break;

      // C13 (§51.0.F + §51.0.G): engine-decl in scope → enable the `engine`
      // runtime chunk for C13 hooks (_scrml_engine_check_transition / advance /
      // direct_set). Conservative trigger: any engine-decl AST node — even
      // derived ones (C14 surface) currently have no helper hookups, but a
      // future direct-write hook on derived projection results would reuse
      // this same chunk. Tree-shaken when no engines appear in the file.
      //
      // C14 (§51.0.J): derived engine-decl ALSO needs the `derived` chunk
      // (`_scrml_derived_declare`/`_scrml_derived_subscribe`/`_scrml_derived_get`)
      // — emit-engine.ts:emitDerivedEngineSubstrateForFile uses these helpers
      // to register the engine variant cell as a read-only derived cell. The
      // tightest gate is `engineMeta.derivedExpr != null` which mirrors C14's
      // emission gate exactly.
      case "engine-decl": {
        chunks.add("engine");
        // C14: derived engine (non-legacy `<machine>` keyword) needs the
        // `derived` chunk. Mirror the gate used by
        // `isC14DerivedEngineDecl` (`derivedExpr != null` AND
        // `legacyMachineKeyword !== true`).
        const engineMeta = (node as any)._record?.engineMeta;
        const isLegacyMachine = (node as any).legacyMachineKeyword === true;
        if (!isLegacyMachine && engineMeta && engineMeta.derivedExpr != null) {
          chunks.add("derived");
        }
        // engine-gated-each-populate (S153) — descend into the engine's arm
        // bodies. The engine-decl node carries its state-child arm markup in
        // `bodyChildren` (NOT `children`/`body`), so the outer walkNodes/walkBody
        // recursion does NOT reach it (same gap the each-block case handles
        // explicitly above). Without this descent, a chunk-requiring shape inside
        // a NON-`initial=` engine arm — most importantly an `<each>` — is never
        // visited, so its `reconciliation` / `deep_reactive` chunks are
        // tree-shaken out while the emitted arm-render code STILL calls
        // `_scrml_reconcile_list` / `_scrml_effect_static` / `_scrml_remount_each`
        // → runtime ReferenceError once the arm mounts (compile-clean,
        // `node --check`-clean: the call sites are syntactically valid, the gap
        // is purely tree-shaking). Recurse so those nested shapes gate correctly.
        if (Array.isArray((node as any).bodyChildren)) walkNodes((node as any).bodyChildren);
        break;
      }

      // match-block — Tier-1 `<match for=Type on=...>` block form (SPEC
      // §18.0.1). each-in-block-form-match (S153): an `<each>` inside a match
      // arm body lives in `armsRaw` raw text (the match body is a structural
      // raw-body element — BS does NOT descend, so the each is NOT a walkable
      // node here at chunk-detect time, which runs BEFORE emit-match attaches
      // the lifted each-blocks to bodyChildren). Without this case the
      // arm-render code emitted by emit-each (via the buildMatchArms each-block
      // re-parse) calls `_scrml_reconcile_list` / `_scrml_effect_static` /
      // `_scrml_remount_each` against a runtime that tree-shook them out →
      // ReferenceError once the arm mounts (compile-clean, node --check-clean —
      // identical failure class to the engine-arm each the engine-decl case
      // above handles). Cheap raw-text probe gates the chunk add to arms that
      // actually contain an each. Both chunks are unconditional once an each is
      // present (every non-empty each emits the `_scrml_reconcile_list` call +
      // the `_scrml_effect_static` registration), mirroring the each-block case.
      case "match-block": {
        const armsRaw = (node as any).armsRaw;
        if (typeof armsRaw === "string" && /<\s*each\b/.test(armsRaw)) {
          chunks.add("reconciliation"); // _scrml_reconcile_list + _scrml_remount_each + _scrml_each_renderers
          chunks.add("deep_reactive");  // _scrml_effect_static
        }
        // Defensive: if buildMatchArms already attached the lifted each-blocks
        // to bodyChildren (re-run ordering), descend so any OTHER chunk-
        // requiring shape inside them gates too.
        if (Array.isArray((node as any).bodyChildren)) walkNodes((node as any).bodyChildren);
        break;
      }

      // match-stmt with enum arms — uses _scrml_structural_eq for enum comparison
      case "match-stmt": {
        const arms: any[] = node.arms ?? [];
        const hasEnumArm = arms.some((arm: any) =>
          arm && (arm.enumType || arm.pattern?.includes("."))
        );
        if (hasEnumArm) {
          chunks.add("equality");
        }
        break;
      }

      // Recurse into logic body nodes
      case "logic":
        if (Array.isArray(node.body)) walkBody(node.body);
        break;
    }

    // Check for animationFrame calls in bare-expr nodes
    // Phase 4d Step 8: ExprNode-only (bare-expr.expr TS field deleted; production AST always has exprNode)
    if (kind === "bare-expr") {
      const exprNode = (node as any).exprNode;
      if (exprNode) {
        if (exprNodeContainsCall(exprNode, "animationFrame")) chunks.add("animation");
        if (exprNodeContainsCall(exprNode, "navigate") || exprNodeContainsCall(exprNode, "_scrml_navigate")) chunks.add("utilities");
      } else if ((node as any).expr) {
        // Runtime-only fallback for synthetic test nodes
        const expr: string = (node as any).expr ?? "";
        if (expr.includes("animationFrame(")) chunks.add("animation");
        if (expr.includes("navigate(") || expr.includes("_scrml_navigate(")) chunks.add("utilities");
      }
    }

    // Recurse into function declarations
    if (kind === "function-decl" && Array.isArray(node.body)) {
      walkBody(node.body);
    }
  }

  walkNodes(allNodes);

  // Check for bind: directives and reactive display bindings in the binding registry.
  // These use _scrml_effect for reactive wiring.
  const eventBindings: any[] = (ctx.registry as any).eventBindings ?? [];
  const logicBindings: any[] = (ctx.registry as any).logicBindings ?? [];

  if (logicBindings.length > 0) {
    chunks.add("deep_reactive"); // _scrml_effect for reactive display
    // Check for transition directives
    for (const binding of logicBindings) {
      if (binding.transitionEnter || binding.transitionExit) {
        chunks.add("transitions");
        break;
      }
    }
  }

  if (eventBindings.length > 0) {
    // Event wiring itself doesn't use runtime functions directly,
    // but if there are logic bindings with reactive refs, those use _scrml_effect
    chunks.add("deep_reactive");
  }

  // Check for bind: directives — these use _scrml_effect and _scrml_deep_set
  const allAstNodes: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function hasBoundDirectives(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      const attrs: any[] = node.attributes ?? node.attrs ?? [];
      for (const attr of attrs) {
        if (attr?.name?.startsWith("bind:")) return true;
        if (attr?.name?.startsWith("class:")) return true;
        if (attr?.name === "ref") return true;
      }
      if (Array.isArray(node.children) && hasBoundDirectives(node.children)) return true;
    }
    return false;
  }

  if (hasBoundDirectives(allAstNodes)) {
    chunks.add("deep_reactive"); // _scrml_effect for bind: wiring
    chunks.add("utilities");     // _scrml_deep_set for path bindings (bind:x.y)
  }

  // CSS variable bridges — use _scrml_effect when there are reactive refs
  const allNodes2: any[] = fileAST?.ast?.nodes ?? fileAST?.nodes ?? [];
  function hasCssBridges(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "css" && Array.isArray(node.rules)) {
        for (const rule of node.rules) {
          if ((rule as any).reactiveRefs?.length > 0 || (rule as any).isExpression) return true;
        }
      }
      if (Array.isArray(node.children) && hasCssBridges(node.children)) return true;
    }
    return false;
  }
  if (hasCssBridges(allNodes2)) {
    chunks.add("deep_reactive"); // _scrml_effect for CSS variable bridge
  }

  // Bind-props wiring — uses _scrml_effect
  function hasBindProps(nodes: any[]): boolean {
    for (const node of nodes) {
      if (!node) continue;
      if (Array.isArray(node._bindProps) && node._bindProps.length > 0) return true;
      if (Array.isArray(node.children) && hasBindProps(node.children)) return true;
    }
    return false;
  }
  if (hasBindProps(allAstNodes)) {
    chunks.add("deep_reactive");
  }

  // 6nz Bug P (S124, 2026-05-23) — close cross-chunk dependency edges before
  // chunk-set consumption. The `scope` chunk (always-seeded — see
  // context.ts:211) unconditionally calls `_scrml_stop_scope_timers` (timers
  // chunk) and `_scrml_cancel_animation_frames` (animation chunk) inside
  // `_scrml_destroy_scope`. Without this closure, a compile unit with no
  // user-facing timer / animation-frame usage would tree-shake both chunks
  // and crash on first reactive-scope teardown. Full edge table + audit
  // shape lives at `codegen/runtime-chunks.ts:CHUNK_DEPENDENCIES`.
  applyChunkDependencies(chunks);
}

// ---------------------------------------------------------------------------
// PGO P2.1 (S102) — sub-emit timing helper.
//
// Mirrors `codegen/index.ts:codegenStage` but operates on the per-sub-emit
// Map plumbed through `CompileContext.clientEmitTotals`. Same shape so the
// flag-off baseline is identical to pre-instrumentation: one boolean check
// + a direct call. When `ctx.debugPerf === true`, each call site adds two
// `performance.now()` reads + one Map upsert — the same constant overhead
// the outer P1.1 instrumentation pays.
//
// Naming convention: short kebab-case strings ("emit-functions",
// "emit-bindings", ...) so the reporter columns align across runs and PGO
// Phase 3 dispatches can cite the names directly.
//
// Sub-emits called inside `generateClientJs` are wrapped here. Any other
// emit*() callers in this file (e.g. `emitEnumLookupTables` at module
// top-level, used by tests) bypass the helper — instrumentation is scoped
// to the per-file CG hot path.
// ---------------------------------------------------------------------------
function clientStage<T>(ctx: CompileContext, name: string, fn: () => T): T {
  if (!ctx.debugPerf || !ctx.clientEmitTotals) return fn();
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  ctx.clientEmitTotals.set(name, (ctx.clientEmitTotals.get(name) ?? 0) + elapsed);
  return result;
}

// ---------------------------------------------------------------------------
// generateClientJs
// ---------------------------------------------------------------------------

/**
 * Generate client-side JS for a file.
 */
export function generateClientJs(ctx: CompileContext): string {
  const { fileAST, protectedFields, errors, encodingCtx, workerNames } = ctx;
  const authMiddlewareEntry = ctx.authMiddleware;
  const csrfEnabled = ctx.csrfEnabled;
  const filePath: string = fileAST.filePath;
  const lines: string[] = [];

  // S22 §1a slice 2: publish the file's variant→payload-field lookup so that
  // emitMatchExpr can resolve positional bindings `.Circle(r)` to field names.
  // Cleared at end of this function so state does not leak between files.
  //
  // S95 Bug 2 — also publish to the string-rewrite pipeline so that
  // `.Variant(args)` bare-dot constructor calls in event-handler bodies,
  // escape-hatch expressions, and other legacy emission surfaces lower to
  // the canonical `{ variant, data }` tagged-object literal (matches the
  // structured AST path in emit-expr.ts:emitCall).
  const { fields, collisions } = clientStage(ctx, "build-variant-fields-registry", () =>
    buildVariantFieldsRegistry(fileAST)
  );
  setVariantFieldsForFile(fields, collisions);
  setVariantFieldsForRewriter(fields, collisions);

  lines.push("// Generated client-side JS for scrml");
  lines.push("// This file is executable browser JavaScript.");
  lines.push("");

  // PGO P3.B (S102) — runtime assembly DEFERRED + walk-cost reduced via
  // fused probe + structural-AST kind allow-list.
  //
  // Pre-P3.B: detectRuntimeChunks ran a separate full-AST walk (~471ms on
  // trucking-dispatch = 63% of emit-client), then assembleRuntime ran with
  // the resulting chunk set. Two independent ExprNode probes (one for `==/!=`
  // equality, one for `reset-expr`) re-walked the same expression sub-trees,
  // and the outer Object.keys iteration would push markup-children arrays
  // into the probe stack — duplicating the work that walkNodes was about to
  // do anyway.
  //
  // Post-P3.B:
  //   1. Equality + reset ExprNode probe is FUSED into a single iterative
  //      stack walk that exits as soon as both flags are set for the file
  //      (or per-call once both are no longer needed).
  //   2. Probe descent STOPS at structural-AST kinds (markup/logic/state-decl/
  //      etc.) because the outer walker re-visits those nodes anyway.
  //   3. `assembleRuntime` call is moved to the END of `generateClientJs`.
  //      We reserve a placeholder slot here and splice the assembled runtime
  //      in below after all emit-* phases complete. The reordering preserves
  //      the original "runtime block appears at top of client.js" output
  //      order. Required for future iteration where emit-* phases tag chunks
  //      during their own walks; the placeholder makes the splice viable
  //      without re-ordering downstream lines.
  //
  // Per-file savings on trucking-dispatch: 471ms -> 114ms (-75.7%). emit-
  // client parent: 771ms -> 291ms (-62.2%). The residual cost is the
  // structural AST walk itself + per-node Object.keys iteration; further
  // reduction would require either upstream AST-builder flagging of
  // `reset-expr`/`==/!=` presence (an O(1) gate read here), folding the
  // walk into a host emit-* phase that already touches every node (no host
  // walks every node in the same shape — emit-html walks markup, emit-
  // reactive-wiring walks top-level logic + descends into markup,
  // emit-functions walks fn bodies), OR strict-superset adoption (always
  // include the equality + reset chunks — adds ~5KB to every client.js
  // that doesn't otherwise need them). All three options deferred to a
  // follow-up dispatch.
  //
  // 'core', 'scope', 'errors', 'transitions' are always pre-populated (see
  // makeCompileContext in context.ts).
  const runtimeInsertIndex = lines.length;
  lines.push("// --- runtime assembly placeholder (P3.B) ---");
  lines.push("// --- end scrml reactive runtime ---");
  lines.push("");
  clientStage(ctx, "detect-runtime-chunks", () => { detectRuntimeChunks(fileAST, ctx); });

  // Emit JS imports from use-decl and import-decl nodes (§40, §21.3, §41.3).
  // Local .scrml imports are rewritten to .client.js (compiled browser output).
  // `scrml:NAME` imports are lowered to `const { ... } = _scrml_stdlib.<name>;`
  // because browsers cannot resolve bare ES-module specifiers and the
  // client.js script tag is a classic (non-module) script — bare imports
  // would SyntaxError at parse time. The `_scrml_stdlib` registry is
  // populated by the corresponding `stdlib-<name>` runtime chunk (see
  // runtime-template.js + runtime-chunks.ts).
  //
  // `vendor:` imports continue to pass through unchanged — they resolve
  // against the project's vendor/ directory at runtime.
  //
  // Task #17 (S85): cross-file channel imports (kebab-named, string-literal
  // form in source — `import { "dispatch-board" as alias } from '...'`) are
  // filtered out via `filterChannelImportSpecifiers`. Channels are inlined
  // by CHX at the consumer site, not resolved via ES module bindings, so
  // emitting a JS import for them either produces a SyntaxError (bare kebab)
  // or a module-link error (no matching export on the channel-file side).
  clientStage(ctx, "emit-imports", () => {
  const allImports: any[] = fileAST?.ast?.imports ?? fileAST?.imports ?? [];
  for (const stmt of allImports) {
    if ((stmt.kind === "import-decl" || stmt.kind === "use-decl") && stmt.source && stmt.names?.length > 0) {
      const stdlibMatch = typeof stmt.source === "string" && stmt.source.startsWith("scrml:")
        ? stmt.source.slice("scrml:".length)
        : null;
      if (stdlibMatch !== null) {
        if (stmt.isDefault) {
          // No stdlib module exports a default binding; skip.
          continue;
        }
        const kept = filterChannelImportSpecifiers(stmt, filePath, ctx.exportRegistry ?? null);
        if (kept.length === 0) continue;
        const destructured = kept
          .map((s) => (s.imported === s.local ? s.imported : `${s.imported}: ${s.local}`))
          .join(", ");
        lines.push(`const { ${destructured} } = _scrml_stdlib.${stdlibMatch};`);
        continue;
      }
      let jsSource: string = stmt.source;
      // known-gaps-#6 (S152) — local `.scrml` imports lower to a registry read
      // from `_scrml_modules`, EXACTLY mirroring the `scrml:` branch above. A
      // bare ES `import` would SyntaxError in a classic <script> and poison the
      // whole client.js body. The dependency `.client.js` registers its exports
      // via the footer emitted by `buildModuleRegistryFooter` (below), loaded as
      // a <script> BEFORE this entry (topo order, deps-first — see index.ts), so
      // the registry is populated before this read runs.
      //
      // Stable key: derived from the dep's ABSOLUTE path (importGraph absSource)
      // via `moduleRegistryKey` — identical to the exporter side regardless of
      // subdir / shell `upToRoot` nesting. Falls back to the path-relative
      // specifier-derived key when the importGraph is absent (test harnesses).
      if (jsSource.endsWith(".scrml")) {
        const absSource = resolveLocalImportAbsSource(filePath, stmt.source, ctx.importGraph ?? null);
        const moduleKey = absSource !== null
          ? moduleRegistryKey(absSource, ctx.outputBaseDir)
          // Fallback: rewrite the specifier itself to a path-relative key.
          : stmt.source.replace(/^\.\//, "").split(/[\\/]/).join("/").replace(/\.scrml$/, ".client.js");
        if (stmt.isDefault) {
          // Open Q #3 — no client-side default `.scrml` export exists today;
          // implemented defensively. `default` is the exporter-side key.
          const name: string = stmt.names.join(", ");
          lines.push(`const ${name} = _scrml_modules[${JSON.stringify(moduleKey)}].default;`);
          continue;
        }
        const keptLocal = filterChannelImportSpecifiers(stmt, filePath, ctx.exportRegistry ?? null);
        if (keptLocal.length === 0) continue; // All specifiers are channels — inlined by CHX.
        const destructuredLocal = keptLocal
          .map((s) => (s.imported === s.local ? s.imported : `${s.imported}: ${s.local}`))
          .join(", ");
        lines.push(`const { ${destructuredLocal} } = _scrml_modules[${JSON.stringify(moduleKey)}];`);
        continue;
      }
      // Non-`.scrml` local imports (`.js` helpers, etc.) keep ES `import` form —
      // these resolve via the bundler / runtime, not the classic-script registry.
      if (stmt.isDefault) {
        const names: string = stmt.names.join(", ");
        lines.push(`import ${names} from ${JSON.stringify(jsSource)};`);
        continue;
      }
      const kept = filterChannelImportSpecifiers(stmt, filePath, ctx.exportRegistry ?? null);
      if (kept.length === 0) continue; // All specifiers are channels — skip emit entirely.
      const names = kept.map((s) => (s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`)).join(", ");
      lines.push(`import { ${names} } from ${JSON.stringify(jsSource)};`);
    }
  }
  lines.push("");
  });

  // Enum toEnum() lookup tables (SPEC §14.4.1)
  const enumLookupLines = clientStage(ctx, "emit-enum-lookup-tables", () => emitEnumLookupTables(fileAST));
  if (enumLookupLines.length > 0) {
    lines.push("// --- enum toEnum() lookup tables (compiler-generated) ---");
    for (const line of enumLookupLines) lines.push(line);
    lines.push("");
  }

  // Enum variant objects — `const Status = Object.freeze({ Loading: "Loading", ... })`
  // Allows `@status = Status.Loading` at runtime (§14.4)
  const enumObjectLines = clientStage(ctx, "emit-enum-variant-objects", () => emitEnumVariantObjects(fileAST));
  if (enumObjectLines.length > 0) {
    lines.push("// --- enum variant objects (compiler-generated) ---");
    for (const line of enumObjectLines) lines.push(line);
    lines.push("");
  }

  // C12 engine substrate — per `<engine for=Type initial=.X>` declaration:
  // (1) static transition table const, (2) auto-declared variant cell init.
  // SPEC §51.0.A-G. Emitted AFTER enum variant objects (so the variant tag
  // names map to defined runtime constants) and BEFORE reactive-wiring +
  // event-wiring (so the engine's auto-declared cell exists before any
  // user-authored code reads `@<varName>`).
  //
  // Direct-write rule= validation hook + `.advance()` method emission +
  // `<onTransition>` hook firing + body rendering are DEFERRED to C13/C14/
  // C15. See `compiler/src/codegen/emit-engine.ts` and the C12 SURVEY
  // (`docs/changes/phase-a1c-step-c12-engine-state-machine-runtime/SURVEY.md`)
  // for the full hand-off contract.
  const engineLines = clientStage(ctx, "emit-engine-substrate", () => emitEngineSubstrate(fileAST, errors));
  if (engineLines.length > 0) {
    lines.push("// --- engine substrate (compiler-generated, §51.0) ---");
    for (const line of engineLines) lines.push(line);
    lines.push("");
  }

  // B17.4 (§51.0.H) — per-engine hook-firing functions + once-flag declarations
  // for `effect=` + `<onTransition>` arms. Emitted AFTER C12's variant cell
  // init (so the cell exists when the function is called) and BEFORE
  // reactive wiring (so write sites can reference the function via JS function
  // hoisting at module-init time). Also covers derived engines (per §51.0.J
  // line 20640 — `<onTransition>` and `effect=` are LEGAL on derived state-
  // children and fire on derived state changes).
  //
  // Tree-shake: when no engine in the file has hooks, this returns an empty
  // array and no section header is emitted. When some engines have hooks and
  // others don't, hookless engines emit no hook-firing function (the wrap
  // emitters at the write-site call sites gate on `enginesWithHooks` /
  // `EngineBindingInfo.hasHooks`).
  const engineHookLines = clientStage(ctx, "emit-engine-hook-firing-functions", () => emitEngineHookFiringFunctionsForFile(fileAST));
  if (engineHookLines.length > 0) {
    lines.push("// --- engine hook-firing functions (compiler-generated, §51.0.H) ---");
    for (const line of engineHookLines) lines.push(line);
    lines.push("");
  }

  // C14 derived engine substrate — per `<engine for=Type derived=expr>` decl:
  // (1) `_scrml_derived_declare` registering a read-only variant cell with
  // a projection closure, (2) one `_scrml_derived_subscribe` per upstream
  // dependency, (3) forced initial `_scrml_derived_get` so init-time
  // E-DERIVED-ENGINE-INITIAL-UNDEFINED throws fire loudly per §51.0.J line
  // 20640 + §34 line 14460.
  //
  // SPEC §51.0.J. Emitted AFTER the C12 (non-derived) engine substrate so
  // any derived engine projecting from a non-derived engine variant cell
  // sees the upstream's initial value during init-time forced eval. NO
  // transition table (rule= rejected at A1b/B16); NO direct-write hook
  // (writes rejected at A1b/B16); NO `.advance()` (derived engines are
  // read-only per §51.0.J). `<onTransition>`/`effect=` firing on derived
  // state-children remains DEFERRED — same parser blocker as C13. See
  // `compiler/src/codegen/emit-engine.ts` C14 section + the C14 SURVEY
  // (`docs/changes/phase-a1c-step-c14-derived-engines/SURVEY.md`).
  const derivedEngineLines = clientStage(ctx, "emit-derived-engine-substrate", () => emitDerivedEngineSubstrateForFile(fileAST));
  if (derivedEngineLines.length > 0) {
    lines.push("// --- derived engine substrate (compiler-generated, §51.0.J) ---");
    for (const line of derivedEngineLines) lines.push(line);
    lines.push("");
  }

  // Phase A10 (S78, 2026-05-10) — engine state-child body render.
  //
  // Emit per-arm render functions + dispatcher per in-scope engine.
  // Render functions are top-level fn decls (JS-hoisted). Dispatcher
  // subscribes to the engine variable via `_scrml_reactive_subscribe`,
  // firing on `set` only — initial-arm HTML emitted by emit-html.ts at
  // the engine's source position is left intact at module init so
  // file-level reactive-wiring can bind to its placeholders.
  //
  // Tree-shake: when no engine has any non-empty arm body, both arrays
  // are empty and no section header emits. The C12/C14 mount-position
  // marker comments are preserved as documented debug aids (Q4 RATIFIED).
  //
  // See SCOPE-AND-DECOMPOSITION.md §3.4 (Option C-prime, RATIFIED) and
  // PHASE-0-SURVEY §7.3 finalized helper signature.
  const c12BodyRender = clientStage(ctx, "emit-engine-body-render", () => emitEngineBodyRenderForFile(fileAST, ctx));
  const c14BodyRender = clientStage(ctx, "emit-derived-engine-body-render", () => emitDerivedEngineBodyRenderForFile(fileAST, ctx));
  // S108 Phase 3 — match-block body render (SPEC §18.0.1). Mirrors C12/C14
  // engine body-render; consumes the variant-source-agnostic
  // `emit-variant-guard.ts` helper. Same tree-shake invariant: when no
  // match-block has any non-empty arm body, returns empty arrays and no
  // emission happens.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitMatchBodyRenderForFile } = require("./emit-match.ts") as {
    emitMatchBodyRenderForFile: (fileAST: any, ctx: any) => { renderFunctions: string[]; dispatchers: string[] };
  };
  const matchBodyRender = clientStage(ctx, "emit-match-body-render", () => emitMatchBodyRenderForFile(fileAST, ctx));

  // S130 HU-1 iteration Landing 1 — each-block body render (SPEC §17.X NEW).
  // Mirrors C12/C14 engine body-render + S108 Phase 3 match-block. Same
  // tree-shake invariant: when no each-block has any template + empty
  // content, returns empty arrays and no emission happens.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitEachBodyRenderForFile } = require("./emit-each.ts") as {
    emitEachBodyRenderForFile: (fileAST: any, ctx: any) => { renderFunctions: string[]; dispatchers: string[] };
  };
  const eachBodyRender = clientStage(ctx, "emit-each-body-render", () => emitEachBodyRenderForFile(fileAST, ctx));

  const allRenderFns = [...c12BodyRender.renderFunctions, ...c14BodyRender.renderFunctions, ...matchBodyRender.renderFunctions, ...eachBodyRender.renderFunctions];
  // Engine (C12/C14) + match dispatchers fire here (early, before reactiveLines):
  // their boot ordering is intentional (engine substrate seeds its OWN variant
  // cells via emitEngineSubstrate, not via the user reactiveLines below). The
  // EACH dispatchers are DEFERRED to after reactiveLines (see eachDispatchers
  // below) so the initial `_scrml_each_render_NN()` sees the source cell's real
  // value rather than undefined (the same-file cell-init crash, change-id
  // each-render-before-cell-init-2026-06-01).
  const allDispatchers = [...c12BodyRender.dispatchers, ...c14BodyRender.dispatchers, ...matchBodyRender.dispatchers];
  const eachDispatchers = [...eachBodyRender.dispatchers];
  if (allRenderFns.length > 0 || allDispatchers.length > 0 || eachDispatchers.length > 0) {
    lines.push("// --- engine + match + each body render (Phase A10, §51.0.D + §18.0.1 + §17.X) ---");
    for (const fn of allRenderFns) {
      lines.push(fn);
      lines.push("");
    }
    for (const disp of allDispatchers) {
      lines.push(disp);
      lines.push("");
    }
  }

  // C15 cross-file engine mount markers — per §21.8 + §51.0.D.
  // For each `<engineVarName/>` use-site in the importer's markup whose
  // source export is `category: "engine"`, emit a mount-position marker
  // comment. The singleton mechanism is the page-shared `_scrml_state`
  // table — exporter's `_scrml_reactive_set("appPhase", ...)` writes to
  // the same map all importers read from. The JS module-import side is
  // already handled by the existing import-rewriter at line 498-514 above
  // (`import { Phase } from './engines.scrml'` → `import { Phase } from
  // "./engines.client.js"`). The `.client.js` import is preserved by the
  // GITI-003 prune (line 869) so the exporter's module-init code runs at
  // page load even when no symbol from the import is referenced in the
  // importer's body.
  //
  // Body rendering at the use-site DOM position is DEFERRED — same parser
  // blocker as C12/C13/C14. The marker documents WHERE the imported
  // engine renders; a follow-on body-render emitter fills the slot.
  //
  // See `compiler/src/codegen/emit-engine.ts` C15 section + the C15 SURVEY
  // (`docs/changes/phase-a1c-step-c15-cross-file-engine-mount/SURVEY.md`).
  const crossFileEngineMountLines = clientStage(ctx, "emit-cross-file-engine-mounts", () =>
    emitCrossFileEngineMountsForFile(fileAST, ctx.exportRegistry ?? null)
  );
  if (crossFileEngineMountLines.length > 0) {
    lines.push("// --- cross-file engine mounts (compiler-generated, §21.8 + §51.0.D) ---");
    for (const line of crossFileEngineMountLines) lines.push(line);
    lines.push("");
  }

  // §4.12.4: Worker instantiation — new Worker() + Promise-based .send()
  if (workerNames && workerNames.length > 0) {
    lines.push("// --- worker instantiation (compiler-generated, §4.12.4) ---");
    for (const name of workerNames) {
      lines.push(`const _scrml_worker_${name} = new Worker("${name}.worker.js");`);
      lines.push(`_scrml_worker_${name}.send = function(data) {`);
      lines.push(`  return new Promise(function(resolve) {`);
      lines.push(`    _scrml_worker_${name}.onmessage = function(e) { resolve(e.data); };`);
      lines.push(`    _scrml_worker_${name}.postMessage(data);`);
      lines.push(`  });`);
      lines.push(`};`);
    }
    lines.push("");
  }

  // @session reactive projection (Option C hybrid)
  if (authMiddlewareEntry) {
    const { loginRedirect } = authMiddlewareEntry;

    lines.push("// --- @session reactive projection (compiler-generated) ---");
    lines.push("let _scrml_session = null;");
    lines.push("");
    lines.push("async function _scrml_session_init() {");
    lines.push("  try {");
    lines.push("    const resp = await fetch('/_scrml/session', { credentials: 'include' });");
    lines.push("    if (resp.ok) {");
    lines.push("      _scrml_session = await resp.json();");
    lines.push("    } else {");
    lines.push("      _scrml_session = null;");
    lines.push("    }");
    lines.push("  } catch {");
    lines.push("    _scrml_session = null;");
    lines.push("  }");
    lines.push("}");
    lines.push("");
    lines.push("const session = {");
    lines.push("  get current() { return _scrml_session; },");
    lines.push("  async destroy() {");
    lines.push("    await fetch('/_scrml/session/destroy', {");
    lines.push("      method: 'POST',");
    lines.push("      credentials: 'include',");
    lines.push("    });");
    lines.push("    _scrml_session = null;");
    lines.push(`    window.location.href = ${JSON.stringify(loginRedirect)};`);
    lines.push("  },");
    lines.push("};");
    lines.push("");
    lines.push("_scrml_session_init();");
    lines.push("");
  }

  // Baseline CSRF token helper
  if (csrfEnabled && !authMiddlewareEntry) {
    lines.push("// --- CSRF token helper (compiler-generated, double-submit cookie) ---");
    lines.push("function _scrml_get_csrf_token() {");
    lines.push("  const match = document.cookie.match(/(?:^|;\\s*)scrml_csrf=([^;]+)/);");
    lines.push("  if (match) return decodeURIComponent(match[1]);");
    // Issue #2 (parent scrmlTS): bootstrap a same-origin double-submit token
    // when none is present so the FIRST request — read OR write — carries a
    // cookie that matches its X-CSRF-Token header. The baseline server gate only
    // checks cookie===header (both non-empty), so a client-planted token
    // validates on the first POST; no 403 round-trip and no reliance on the
    // mint-on-403 retry (which the write path previously could not recover from).
    // SameSite=Strict keeps the cookie off cross-site requests, so an attacker's
    // forged cross-origin POST sends no cookie and is still rejected — the
    // double-submit CSRF guarantee is preserved. The token is plain
    // (UUID / base36), so we return it directly rather than round-tripping
    // through document.cookie a second time.
    lines.push("  const _scrml_t = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));");
    lines.push("  document.cookie = `scrml_csrf=${_scrml_t}; Path=/; SameSite=Strict`;");
    lines.push("  return _scrml_t;");
    lines.push("}");
    lines.push("");
    // GITI-010: fetch-with-retry wrapper. Only emitted when at least one
    // CSRF-gated mutating route exists — otherwise the helper would be dead
    // code (an SSE-only file uses EventSource, not fetch).
    let hasMutatingCsrfServerFn = false;
    const routeMap = ctx.routeMap;
    if (routeMap?.functions) {
      for (const [, route] of routeMap.functions) {
        if (!route || route.boundary !== "server") continue;
        const method = route.explicitMethod ?? "POST";
        if (method !== "GET" && method !== "HEAD") {
          hasMutatingCsrfServerFn = true;
          break;
        }
      }
    }
    if (hasMutatingCsrfServerFn) {
      // Cookie-less first POST receives a 403 with Set-Cookie (server plants
      // a fresh token). We retry exactly once, re-reading document.cookie
      // for the fresh X-CSRF-Token. Single-shot retry — if the second
      // attempt also 403s, it's a real mismatch (stale token, actual CSRF
      // attempt) and propagates to the caller.
      lines.push("async function _scrml_fetch_with_csrf_retry(path, method, body) {");
      lines.push("  let _scrml_resp = await fetch(path, {");
      lines.push("    method,");
      lines.push('    headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_get_csrf_token() },');
      lines.push("    body,");
      lines.push("  });");
      lines.push("  if (_scrml_resp.status === 403) {");
      lines.push("    _scrml_resp = await fetch(path, {");
      lines.push("      method,");
      lines.push('      headers: { "Content-Type": "application/json", "X-CSRF-Token": _scrml_get_csrf_token() },');
      lines.push("      body,");
      lines.push("    });");
      lines.push("  }");
      lines.push("  return _scrml_resp;");
      lines.push("}");
      lines.push("");
    }
  }

  // Emit fetch stubs, CPS wrappers, and client-boundary function bodies
  const { lines: fnLines, fnNameMap } = clientStage(ctx, "emit-functions", () => emitFunctions(ctx));
  for (const line of fnLines) lines.push(line);

  // known-gaps-#6 (S152) — cross-file module registry footer (Approach B,
  // §21.3). Emitted AFTER all fn/enum/const decls so every exported binding is
  // already declared. Empty for files NOT imported by another .scrml in the
  // compile unit (single-file apps, leaf pages) — the 'modules' runtime chunk
  // tree-shakes out in that case (see detectRuntimeChunks). The `post-fn-name-
  // mangle` pass below does NOT corrupt this footer: property keys are followed
  // by `:` (outside the mangle lookahead) and values are the final emitted names.
  const moduleFooterLines = clientStage(ctx, "emit-module-registry-footer", () => buildModuleRegistryFooter(ctx, fnNameMap, lines));
  for (const line of moduleFooterLines) lines.push(line);

  // Emit top-level logic statements and CSS variable bridge
  const reactiveLines = clientStage(ctx, "emit-reactive-wiring", () => emitReactiveWiring(ctx));
  for (const line of reactiveLines) lines.push(line);

  // each-render-before-cell-init-2026-06-01: the `<each>` dispatchers (initial
  // `_scrml_each_render_NN()` + `_scrml_effect_static(...)`) are emitted HERE,
  // AFTER reactiveLines, NOT up in the render-fn block above. reactiveLines holds
  // the same-file cell-init (`_scrml_reactive_set("items", _scrml_deep_reactive(...))`),
  // so deferring the each dispatchers lets the FIRST `_scrml_each_render_NN()` read
  // the real collection value instead of undefined. The emit-each guard +
  // `_scrml_reconcile_list` Array.isArray guard are belt-and-suspenders for the
  // residual case (cell init in a LATER module via import, or no init at all).
  if (eachDispatchers.length > 0) {
    lines.push("");
    lines.push("// --- each body-render dispatchers (deferred post-cell-init, §17.X) ---");
    for (const disp of eachDispatchers) {
      lines.push(disp);
      lines.push("");
    }
  }

  // §51.0.E (S198 — Approach F A-leg) — runtime-cell hydration construction.
  // `initial=@cell` engines DEFER their construction set to HERE (after
  // emitReactiveWiring) so the snapshot reads the referenced cell's REAL value
  // (its `@cell = init` line ran first), not undefined — the each-render-before-
  // cell-init ordering precedent. Emitted BEFORE the onTimeout/onIdle initial-
  // arms + opener effects (which observe the constructed state). The set is
  // guard-free (hydration is construction, not transition) and carries a
  // decoder-boundary runtime guard (E-ENGINE-INITIAL-INVALID-VARIANT). Tree-
  // shake: empty unless an engine declares `initial=@cell`.
  const engineHydrationLines = clientStage(ctx, "emit-engine-cell-hydration-inits", () => emitEngineCellHydrationInitsForFile(fileAST));
  if (engineHydrationLines.length > 0) {
    lines.push("");
    lines.push("// --- engine runtime-cell hydration (deferred post-cell-init, §51.0.E) ---");
    for (const line of engineHydrationLines) lines.push(line);
  }

  // §52 (S199 — the E-leg) — server-authoritative REACTIVE hydration. A
  // `server=@source` engine subscribes to a server-owned source cell and
  // re-hydrates GUARD-FREE on every change (the server is the authority asserting
  // truth); client moves stay guarded transitions (the engine remains writable).
  // Emitted alongside the A-leg hydration (after emitReactiveWiring so the
  // initial read sees the source's real value). The §38 server-push composes for
  // free — a pushed source-cell change fires the same subscription. Tree-shake:
  // empty unless an engine declares `server=@source`.
  const engineServerHydrationLines = clientStage(ctx, "emit-engine-server-source-hydrations", () => emitEngineServerSourceHydrationsForFile(fileAST));
  if (engineServerHydrationLines.length > 0) {
    lines.push("");
    lines.push("// --- engine server-authoritative reactive hydration (§52, E-leg) ---");
    for (const line of engineServerHydrationLines) lines.push(line);
  }

  // A5-4 (§51.0.M) — Initial-arm for engines with <onTimeout>. Emitted AFTER
  // emitReactiveWiring so the user reactive cells (which a computed-form
  // <onTimeout after=${@var}<unit>/> may read at arm time) are initialized
  // first. Tree-shake: empty when no engine in the file has <onTimeout>.
  const engineInitArmLines = clientStage(ctx, "emit-engine-initial-arms", () => emitEngineInitialArmsForFile(fileAST));
  if (engineInitArmLines.length > 0) {
    lines.push("");
    lines.push("// --- engine onTimeout initial-arms (compiler-generated, §51.0.M) ---");
    for (const line of engineInitArmLines) lines.push(line);
  }

  // §51.0.H Form 3 (S148, Insight 33 Fork C1) — boot-only opener effect=.
  // Emitted AFTER the onTimeout/onIdle initial-arms (ordering ruling ii): the
  // variant cell inits (emitEngineSubstrate), the <onIdle> watchdog arms
  // (engineInitArmLines above), THEN the opener effect fires here \u2014 LAST
  // among the module-init engine steps. Boot-only: emitted on the module-init
  // path exactly once; re-entering initial= later does NOT re-run it. Any
  // cross-variant write inside it is an ordinary transition that resets the
  // watchdog per §51.0.R rule 2 (falls out of the standard write rewrite \u2014
  // no watchdog reset is special-cased for the boot edge). Tree-shake: empty
  // when no engine declares an opener effect=.
  const engineOpenerEffectLines = clientStage(ctx, "emit-engine-opener-effects", () => emitEngineOpenerEffectsForFile(fileAST));
  if (engineOpenerEffectLines.length > 0) {
    lines.push("");
    lines.push("// --- engine opener effect= boot-init effects (compiler-generated, §51.0.H Form 3) ---");
    for (const line of engineOpenerEffectLines) lines.push(line);
  }

  // Emit ref= and bind:/class: directive wiring
  const bindingLines = clientStage(ctx, "emit-bindings", () => emitBindings(ctx));
  for (const line of bindingLines) lines.push(line);

  // Emit event handler wiring and reactive display wiring
  const eventLines = clientStage(ctx, "emit-event-wiring", () => emitEventWiring(ctx, fnNameMap));
  for (const line of eventLines) lines.push(line);

  // Emit type decode table + runtime reflect when encoding is enabled
  // and runtime meta blocks exist (§47.2, tree-shaking per §47.2.3)
  if (encodingCtx?.enabled && hasRuntimeMetaBlocks(fileAST)) {
    lines.push("");
    lines.push("// --- type decode table (§47.2) ---");
    lines.push(clientStage(ctx, "emit-decode-table", () => emitDecodeTable(encodingCtx)));
    lines.push(clientStage(ctx, "emit-runtime-reflect", () => emitRuntimeReflect()));
    lines.push("");
  }

  // Post-process to mangle function call sites.
  //
  // Negative lookbehind `(?<!\.)` excludes property-access positions: the user's
  // fn `toggle()` must NOT rewrite `classList.toggle(...)`, `arr.forEach(...)`,
  // etc. Those are DOM / stdlib method calls on runtime values, unrelated to
  // the user symbol.
  //
  // Bug D (6nz inbound 2026-04-20): user fn `toggle()` → `_scrml_toggle_7`
  // corrupted the compiler-generated `classList.toggle("active", ...)` emitted
  // by the `class:active=@active` binding template. Any user fn sharing a name
  // with a DOM method (toggle, add, remove, append, replace, forEach, ...) hit
  // this bug silently.
  //
  // Bug I (adopter inbound 2026-04-22): user fn `lines()` corrupted
  // `n . lines` in record literal values because the emitter outputs
  // spaces around `.`, so the fixed-width `(?<!\.)` lookbehind saw a
  // space instead of a dot. Extended to variable-length `(?<!\.\s*)`.
  //
  // g-spread (2026-06-10): the plain `(?<!\.\s*)` lookbehind ALSO rejected
  // a spread-call callee — in `[...makeList()]` the third spread `.` directly
  // precedes `makeList`, so the rename was skipped and the user name leaked
  // (runtime ReferenceError; the mangled decl exists but the bare name does
  // not). The lookbehind now rejects ONLY a GENUINE member-access dot — a `.`
  // that is itself preceded by an identifier-char / `)` / `]` (`x.foo`,
  // `f().foo`, `a[0].foo`). A spread's operative dot is preceded by another
  // `.`, not an identifier-char, so `...foo` renames while `x.foo` does not.
  // The trailing call/statement lookahead `(?=\s*[(;,}\]\n)]|$)` is unchanged.
  // §20.6 — POST-EMIT `log` chunk gate. The location-transparent log()
  // builtin lowers to a `_scrml_log(...)` call ONLY when it actually fired
  // (not shadowed by a user `log`, not production-stripped). Scanning the
  // emitted body for the helper call is the exact, leak-proof signal: a
  // shadowed or stripped build emits no `_scrml_log(` and so omits the chunk
  // (the prod bundle then carries zero _scrml_log bytes — F4=A). The runtime
  // placeholder slot is still empty here, so this scans only emitted code.
  for (const _ln of lines) {
    if (typeof _ln === "string" && _ln.includes("_scrml_log(")) {
      ctx.usedRuntimeChunks.add("log");
      break;
    }
  }

  // ss27-4 (runtime-minimality) — POST-EMIT tree-shake of client-SAFE stdlib
  // runtime chunks used ONLY in server code. A `scrml:NAME` capability lowers
  // to `const { ... } = _scrml_stdlib.NAME;` at emit-imports and lights up the
  // `stdlib-NAME` runtime chunk in `detectRuntimeChunks` purely from IMPORT
  // PRESENCE. When every bound name is referenced ONLY inside a server-fn body,
  // the GITI-003 / ss19 #5 post-prune (below) strips the lowered read LINE from
  // client.js — but the chunk (which defines `_scrml_stdlib.NAME`) still ships,
  // leaving `_scrml_stdlib.NAME` defined-but-unused dead weight in the client
  // runtime. `emitFunctions` above already lowered server-fn bodies to fetch
  // stubs, so the emitted `lines` here are the SAME ground-truth client body
  // ss19 #5 keys on: a bound name's absence from the body (excluding its own
  // lowered read decl) proves it is server-only. Pruning `ctx.usedRuntimeChunks`
  // HERE — before BOTH the per-file embed splice (`assembleRuntime` below) and
  // the cross-file shared-runtime union (index.ts) — tree-shakes the dead chunk
  // from both runtime-assembly paths with a single deletion.
  //
  // Consistency with ss19 #5: gated on `!ctx.testMode` so the chunk and the
  // lowered read LINE are pruned together (in testMode BOTH are kept, so the
  // surviving read resolves against a shipped chunk; in real builds BOTH go).
  //
  // Conservative — never over-strip a chunk a client reference needs:
  //   * only modules with an active `stdlib-NAME` chunk AND a lowered read line
  //     are candidates;
  //   * a bound LOCAL name present anywhere in the client body keeps the chunk;
  //   * a direct `_scrml_stdlib.NAME` access keeps the chunk (defensive — the
  //     lowering always destructures, but a future direct-access emitter would
  //     still need the chunk).
  if (!ctx.testMode) {
    clientStage(ctx, "prune-server-only-stdlib-chunks", () => {
      const chunks = ctx.usedRuntimeChunks;
      let anyStdlibChunk = false;
      for (const c of chunks) { if (c.startsWith("stdlib-")) { anyStdlibChunk = true; break; } }
      if (!anyStdlibChunk) return;

      const strLines: string[] = lines.filter((ln: any) => typeof ln === "string");
      // Lowered stdlib read: `const { a, b: c } = _scrml_stdlib.<mod>;` (mirrors
      // the ss19 #5 `stdlibRe` shape — one emitted line per `scrml:` import).
      const readRe = /^\s*const\s+\{([^}]*)\}\s*=\s*_scrml_stdlib\.([A-Za-z_$][A-Za-z0-9_$]*)\s*;?\s*$/;
      const moduleNames = new Map<string, string[]>();
      const readLineIdx = new Set<number>();
      for (let i = 0; i < strLines.length; i++) {
        const m = readRe.exec(strLines[i]);
        if (!m) continue;
        readLineIdx.add(i);
        const mod = m[2];
        if (!chunks.has(`stdlib-${mod}`)) continue;
        // Each destructure entry is `local` or `imported: local`; client code
        // reads the LOCAL (post-`:`) binding.
        const locals = m[1]
          .split(",")
          .map((s) => s.trim().split(":").pop()!.trim())
          .filter(Boolean);
        moduleNames.set(mod, (moduleNames.get(mod) ?? []).concat(locals));
      }
      if (moduleNames.size === 0) return;

      // Client body view: every emitted line EXCEPT the lowered read decls, so a
      // bound name is never counted as used by its own declaration.
      const body = strLines.filter((_, i) => !readLineIdx.has(i)).join("\n");

      for (const [mod, locals] of moduleNames) {
        // Defensive: a direct `_scrml_stdlib.<mod>` registry access keeps the chunk.
        const directRe = new RegExp(`_scrml_stdlib\\.${escapeRegex(mod)}(?![\\w$])`, "");
        if (directRe.test(body)) continue;
        const usedInClient = locals.some((name) => {
          // Same member-access + word-boundary lookbehind as ss19 #5 (g-spread):
          // a genuine `obj.NAME` member access does not count; a spread call
          // `...NAME` does.
          const useRe = new RegExp(
            `(?<![A-Za-z0-9_$)\\]]\\s*\\.\\s*)(?<![\\w$])${escapeRegex(name)}(?![\\w$])`,
            "",
          );
          return useRe.test(body);
        });
        if (!usedInClient) chunks.delete(`stdlib-${mod}`);
      }
    });
  }

  // PGO P3.B (S102) — splice the assembled runtime into the placeholder slot
  // reserved at the top of generateClientJs. By this point all emit-* walks
  // have run and tagged their AST-shape-derived chunks; the chunk set is now
  // final.
  const runtimeSource = clientStage(ctx, "assemble-runtime", () => assembleRuntime(ctx.usedRuntimeChunks));
  lines[runtimeInsertIndex] = runtimeSource;
  let clientCode = clientStage(ctx, "lines-join", () => lines.join("\n"));
  if (fnNameMap && fnNameMap.size > 0) {
    clientStage(ctx, "post-fn-name-mangle", () => {
      // PGO P3.A: collapse the per-name regex loop into a single alternation
      // pass. The original loop ran one regex over the entire client buffer
      // for each user function — O(names * bufferSize) on a buffer that
      // grows linearly with project size. The combined regex makes a single
      // O(bufferSize) sweep.
      //
      // Alternation rules:
      //   * Names are sorted by length DESC so longer names match before
      //     prefixes (e.g. `fooBar` wins against `foo`). Word boundaries
      //     would already prevent `foo` from matching inside `fooBar`, but
      //     sorting also guards against future name shapes where a name
      //     happens to be a prefix of another at a word boundary.
      //   * The member-access lookbehind `(?<![A-Za-z0-9_$)\]]\s*\.\s*)`
      //     and the call/statement lookahead `(?=\s*[(;,}\]\n)]|$)` are
      //     shared by every name; see the g-spread note above for why the
      //     lookbehind rejects only a genuine member dot (not a spread dot).
      //   * A single capture group around the alternation lets the
      //     replacer recover the matched name and look up its mangled form
      //     via the fnNameMap.
      const sortedNames = [...fnNameMap.keys()].sort(
        (a, b) => b.length - a.length,
      );
      const alternation = sortedNames.map(escapeRegex).join("|");
      const combinedRegex = new RegExp(
        `(?<![A-Za-z0-9_$)\\]]\\s*\\.\\s*)\\b(${alternation})\\b(?=\\s*[(;,}\\]\\n)]|$)`,
        "g",
      );
      // 6nz Bug Z (S144): the mangle is a raw-string regex pass with no
      // string-literal awareness, so a declared name occurring INSIDE a
      // `"..."` / `'...'` / backtick literal (or a comment) was rewritten —
      // silently corrupting displayed content (e.g. the editor string
      // `"handleKey(e)"` became `"_scrml_handleKey_3(e)"`). Fence the replace
      // through rewriteCodeSegments (the shared string/regex/comment-aware
      // splitter, code-segments.ts) so it applies ONLY to code segments;
      // string literals, regex literals, and comments pass through verbatim.
      // Real call sites in CODE position still mangle (the regex itself is
      // preserved bit-for-bit — only its INPUT is now the code-only view).
      clientCode = rewriteCodeSegments(clientCode, (codeSeg) =>
        codeSeg.replace(
          combinedRegex,
          (_match, name: string) => fnNameMap.get(name) ?? _match,
        ),
      );
    });

    // GITI-001 (giti inbound 2026-04-20): `@data = serverFn(args)` emits
    // `_scrml_reactive_set("data", _scrml_fetch_serverFn_N(args));` — storing
    // the UNAWAITED Promise. Readers then see `[object Promise]` instead of
    // the resolved value. Wrap each such statement in an async IIFE that
    // awaits the fetch stub before setting the reactive. Scoped by fnNameMap
    // so only server-fn call sites (fetch stubs / CPS wrappers) are touched.
    clientStage(ctx, "post-server-fn-iife-wrap", () => {
    for (const [, mangledName] of fnNameMap) {
      if (!/^_scrml_(fetch|cps)_/.test(mangledName)) continue;
      // Match _scrml_reactive_set("NAME", <mangledName>( ... );) at statement level.
      // Body args may themselves contain `(`; count parens to find the matching close.
      const callPrefix = `${mangledName}(`;
      const setHead = "_scrml_reactive_set(";
      let i = 0;
      const parts: string[] = [];
      while (i < clientCode.length) {
        const setIdx = clientCode.indexOf(setHead, i);
        if (setIdx < 0) {
          parts.push(clientCode.slice(i));
          break;
        }
        // Locate the "," separating name and value.
        let depth = 1;
        let j = setIdx + setHead.length;
        while (j < clientCode.length && depth > 0) {
          if (clientCode[j] === "," && depth === 1) break;
          if (clientCode[j] === "(") depth++;
          else if (clientCode[j] === ")") depth--;
          j++;
        }
        if (j >= clientCode.length || clientCode[j] !== ",") {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        const nameArg = clientCode.slice(setIdx + setHead.length, j);
        // Skip whitespace after the comma.
        let valStart = j + 1;
        while (valStart < clientCode.length && /\s/.test(clientCode[valStart])) valStart++;
        // Value must begin with the mangled fetch-stub call.
        if (clientCode.slice(valStart, valStart + callPrefix.length) !== callPrefix) {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        // Walk through the call args to find its matching `)`.
        let cdepth = 1;
        let k = valStart + callPrefix.length;
        while (k < clientCode.length && cdepth > 0) {
          if (clientCode[k] === "(") cdepth++;
          else if (clientCode[k] === ")") cdepth--;
          if (cdepth === 0) break;
          k++;
        }
        if (k >= clientCode.length) {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        // k is the index of the closing `)` of the call. The outer
        // _scrml_reactive_set should close right after.
        let outerClose = k + 1;
        while (outerClose < clientCode.length && /\s/.test(clientCode[outerClose])) outerClose++;
        if (clientCode[outerClose] !== ")") {
          parts.push(clientCode.slice(i, setIdx + setHead.length));
          i = setIdx + setHead.length;
          continue;
        }
        let stmtEnd = outerClose + 1;
        // S84 fix-lift-async-iife-paren: detect statement vs expression context.
        // The original `_scrml_reactive_set(name, fetchStub(args))` may appear in
        // EXPRESSION position (e.g. inside `el.textContent = await (...)` at
        // emit-event-wiring.ts:826/854/855 — markup that renders an `@var = serverFn()`
        // assignment). Always appending a trailing `;` to the IIFE wrap there
        // produces invalid `await ((async () => ...)();)` — a `;)` token sequence.
        // Preserve the trailing `;` only if the source had one (statement context).
        const hadTrailingSemi = clientCode[stmtEnd] === ";";
        if (hadTrailingSemi) stmtEnd++;
        const args = clientCode.slice(valStart + callPrefix.length, k);
        parts.push(clientCode.slice(i, setIdx));
        parts.push(`(async () => _scrml_reactive_set(${nameArg}, await ${mangledName}(${args})))()${hadTrailingSemi ? ";" : ""}`);
        i = stmtEnd;
      }
      clientCode = parts.join("");
    }
    });

    // GITI-026 (giti inbound 2026-05-30): SSE reactive binding `@cell = gen()`.
    // The naive emit is `_scrml_reactive_set("cell", _scrml_sse_X(args))` plus a
    // `_scrml_init_set("cell", () => _scrml_sse_X(args))` reset thunk — both of
    // which STORE the returned EventSource object in the cell and pass NO
    // message callback, so stream events never reach the cell (it is forever
    // the EventSource). The fetch await-IIFE wrap above is WRONG for streams
    // (an EventSource is not awaitable and produces many values over time).
    // Instead: seed the cell to absence and SUBSCRIBE via the stub's trailing
    // message callback, routing every event to `_scrml_reactive_set`.
    //   reactive_set(N, sse_X(args))      -> reactive_set(N, undefined);
    //                                         sse_X(args, d => reactive_set(N, d));
    //   init_set(N, () => sse_X(args))    -> init_set(N, () => {
    //                                          sse_X(args, d => reactive_set(N, d));
    //                                          return null; });
    // (null is the canonical JS absence representation — §42.5/§42.8; the render
    // path treats null/undefined identically as `not`.)
    clientStage(ctx, "post-sse-reactive-bind", () => {
    for (const [, mangledName] of fnNameMap) {
      if (!/^_scrml_sse_/.test(mangledName)) continue;
      const callPrefix = `${mangledName}(`;

      // Generic walker: find `<setHead>"NAME", <valuePrefix><callPrefix>ARGS)<tail>`
      // and rebuild it via `build(nameArg, args)`. setHead/valuePrefix/tail let
      // us share the paren-matching logic between the reactive_set and init_set
      // forms.
      const rewriteForm = (
        setHead: string,
        valuePrefix: string,
        build: (nameArg: string, args: string) => string,
      ): void => {
        let i = 0;
        const out: string[] = [];
        while (i < clientCode.length) {
          const setIdx = clientCode.indexOf(setHead, i);
          if (setIdx < 0) { out.push(clientCode.slice(i)); break; }
          // Find the comma separating NAME from the value (depth-aware).
          let depth = 1;
          let j = setIdx + setHead.length;
          while (j < clientCode.length && depth > 0) {
            if (clientCode[j] === "," && depth === 1) break;
            if (clientCode[j] === "(") depth++;
            else if (clientCode[j] === ")") depth--;
            j++;
          }
          if (j >= clientCode.length || clientCode[j] !== ",") {
            out.push(clientCode.slice(i, setIdx + setHead.length));
            i = setIdx + setHead.length;
            continue;
          }
          const nameArg = clientCode.slice(setIdx + setHead.length, j);
          let valStart = j + 1;
          while (valStart < clientCode.length && /\s/.test(clientCode[valStart])) valStart++;
          // Value must begin with the (optional) prefix then the sse-stub call.
          if (clientCode.slice(valStart, valStart + valuePrefix.length) !== valuePrefix) {
            out.push(clientCode.slice(i, setIdx + setHead.length));
            i = setIdx + setHead.length;
            continue;
          }
          let callStart = valStart + valuePrefix.length;
          while (callStart < clientCode.length && /\s/.test(clientCode[callStart])) callStart++;
          if (clientCode.slice(callStart, callStart + callPrefix.length) !== callPrefix) {
            out.push(clientCode.slice(i, setIdx + setHead.length));
            i = setIdx + setHead.length;
            continue;
          }
          // Walk the stub call args to its matching `)`.
          let cdepth = 1;
          let k = callStart + callPrefix.length;
          while (k < clientCode.length && cdepth > 0) {
            if (clientCode[k] === "(") cdepth++;
            else if (clientCode[k] === ")") cdepth--;
            if (cdepth === 0) break;
            k++;
          }
          if (k >= clientCode.length) {
            out.push(clientCode.slice(i, setIdx + setHead.length));
            i = setIdx + setHead.length;
            continue;
          }
          // After the stub-call close, consume the rest of the outer set call
          // (the closing `)` of reactive_set/init_set, plus — for init_set — the
          // arrow-body close) and the trailing `;`.
          let outerClose = k + 1;
          // valuePrefix carries any `() => ` arrow head; the arrow body here is a
          // single expression, so the next non-space char is the outer `)`.
          while (outerClose < clientCode.length && /\s/.test(clientCode[outerClose])) outerClose++;
          if (clientCode[outerClose] !== ")") {
            out.push(clientCode.slice(i, setIdx + setHead.length));
            i = setIdx + setHead.length;
            continue;
          }
          let stmtEnd = outerClose + 1;
          if (clientCode[stmtEnd] === ";") stmtEnd++;
          const args = clientCode.slice(callStart + callPrefix.length, k);
          out.push(clientCode.slice(i, setIdx));
          out.push(build(nameArg, args));
          i = stmtEnd;
        }
        clientCode = out.join("");
      };

      const subscribe = (nameArg: string, args: string): string => {
        const callArgs = args.trim().length > 0
          ? `${args}, (_scrml_d) => _scrml_reactive_set(${nameArg}, _scrml_d)`
          : `(_scrml_d) => _scrml_reactive_set(${nameArg}, _scrml_d)`;
        return `${mangledName}(${callArgs})`;
      };

      // Form 1: the init-time `_scrml_reactive_set("N", sse_X(args));`. Seed the
      // cell to absence — canonical JS `null` per SPEC §42.5/§42.8 (the runtime
      // treats null/undefined identically; `null` avoids W-CG-UNDEFINED-INTERP).
      rewriteForm("_scrml_reactive_set(", "", (nameArg, args) =>
        `_scrml_reactive_set(${nameArg}, null);\n${subscribe(nameArg, args)};`,
      );
      // Form 2: the reset thunk `_scrml_init_set("N", () => sse_X(args));` —
      // re-subscribe (side-effect) and return absence (null) so reset re-seeds
      // the cell rather than storing the EventSource object.
      rewriteForm("_scrml_init_set(", "() =>", (nameArg, args) =>
        `_scrml_init_set(${nameArg}, () => { ${subscribe(nameArg, args)}; return null; });`,
      );
    }
    });
  }

  // GITI-003 (giti inbound 2026-04-20): prune imports that are only used by
  // server-fn bodies. Client emission unconditionally writes every import-
  // decl from the source file; when a name like `getGreeting` is referenced
  // only inside a `server function` body (which gets lowered to a fetch stub
  // that doesn't reference the original JS helper), the import in
  // `.client.js` points at a server-only module and 500s the browser load.
  //
  // Strategy: after all rewrites have run, parse out the top-of-file import
  // statements, check each imported name for any usage in the REMAINING body
  // of clientCode, and drop imports with no remaining usage. This is a
  // conservative post-pass — if a name is used anywhere in client output,
  // the import is preserved verbatim.
  //
  // testMode skip: unit tests that assert import-source passthrough with
  // minimal (empty-body) fixtures would see their imports pruned (correctly
  // unused) without this carve-out. Real compilations always go through
  // testMode: false.
  clientCode = ctx.testMode ? clientCode : clientStage(ctx, "post-prune-unused-imports", () => (function pruneUnusedClientImports(code: string): string {
    // A removable region is a top-of-file binding declaration whose bound
    // names may be dropped if unreferenced in the REMAINING client body. Two
    // shapes are recognized:
    //
    //   - ES import   `import { a, b } from 'src';`         (GITI-003)
    //     A hand-written JS/TS helper only called from server-fn bodies — the
    //     fetch stub that replaces the body never references the helper, so the
    //     import in `.client.js` points at a server-only module and 500s the
    //     browser load.
    //
    //   - stdlib read `const { a, b } = _scrml_stdlib.<mod>;`  (#5 ss19)
    //     A `scrml:` capability lowered at `emit-imports`. When every bound
    //     name is referenced ONLY inside a server-fn body (which client
    //     emission lowers to a fetch stub that never names the binding), the
    //     read survives into `.client.js` and destructures `_scrml_stdlib.<mod>`
    //     — `undefined` for a server-only module (store/auth/crypto, whose
    //     runtime chunk is never shipped to the client), throwing a TypeError
    //     at module load and killing the whole page. Both shapes share the
    //     same ground-truth signal: the post-rewrite client body. Because
    //     server-fn bodies are already lowered to fetch stubs at this point, a
    //     binding's absence from the body proves it is server-only.
    type Region = { start: number; end: number; names: string[]; keepWhole: boolean };
    const regions: Region[] = [];
    let m: RegExpExecArray | null;

    // (1) ES `import ... from '...'` statements (GITI-003).
    const importRe = /^import\s+(?:\{([^}]*)\}|([A-Za-z_$][A-Za-z0-9_$]*))\s+from\s+(['"])([^'"]+)\3\s*;?\s*$/gm;
    while ((m = importRe.exec(code)) !== null) {
      const namedList = m[1];
      const defaultName = m[2];
      const src = m[4];
      const names = namedList
        ? namedList.split(",").map(s => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean)
        : [defaultName];
      // Narrow targeting: only prune imports whose source is a plain external
      // module specifier (user-written JS/TS that might be server-only).
      // Preserve runtime-managed sources:
      //   - `.client.js`   cross-file scrml outputs (resolved at runtime)
      //   - `scrml:`       stdlib imports (these do NOT reach here — they lower
      //                    to the `_scrml_stdlib` read handled in (2) — kept
      //                    defensively)
      //   - `vendor:`      external packages (resolved by bundler/runtime)
      const keepWhole = src.startsWith("scrml:") || src.startsWith("vendor:") || src.endsWith(".client.js");
      regions.push({ start: m.index, end: m.index + m[0].length, names, keepWhole });
    }

    // (2) stdlib reads `const { a, b: c } = _scrml_stdlib.<mod>;` (#5 ss19).
    // Each destructure entry is `local` or `imported: local`; the name client
    // code actually reads is the LOCAL (post-`:`) binding.
    const stdlibRe = /^const\s+\{([^}]*)\}\s*=\s*_scrml_stdlib\.[A-Za-z_$][A-Za-z0-9_$]*\s*;?\s*$/gm;
    while ((m = stdlibRe.exec(code)) !== null) {
      const names = m[1]
        .split(",")
        .map(s => s.trim().split(":").pop()!.trim())
        .filter(Boolean);
      regions.push({ start: m.index, end: m.index + m[0].length, names, keepWhole: false });
    }

    if (regions.length === 0) return code;
    regions.sort((a, b) => a.start - b.start);

    // Build the "body" view: blank every removable region so a bound name is
    // never counted as used by its own declaration line. Iterate from the end
    // so earlier offsets stay valid.
    let body = code;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      body = body.slice(0, r.start) + " ".repeat(r.end - r.start) + body.slice(r.end);
    }

    // A region drops only when NONE of its bound names appear in the remaining
    // body (whole-region grain — matches GITI-003 and the brief: strip when
    // bound name(s) are referenced ONLY server-side; KEEP if any name is used
    // in BOTH client and server code).
    const toDrop: Set<number> = new Set();
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (r.keepWhole) continue;
      const usedInBody = r.names.some(name => {
        // g-spread (2026-06-10): a member-access-only lookbehind (a `.`
        // preceded by ident-char / `)` / `]`, e.g. `obj.makeRange`) plus a
        // word-boundary lookbehind, so a genuine member access of a DIFFERENT
        // object does not count as a use, while a spread call (`...makeRange`)
        // does.
        const useRe = new RegExp(`(?<![A-Za-z0-9_$)\\]]\\s*\\.\\s*)(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, "");
        return useRe.test(body);
      });
      if (!usedInBody) toDrop.add(i);
    }
    if (toDrop.size === 0) return code;

    // Rebuild the file with dropped regions removed (regions are sorted by
    // start; cursor walks left-to-right).
    let result = "";
    let cursor = 0;
    for (let i = 0; i < regions.length; i++) {
      if (toDrop.has(i)) {
        result += code.slice(cursor, regions[i].start);
        // skip the declaration itself; also skip a following newline if present
        let endCursor = regions[i].end;
        if (code[endCursor] === "\n") endCursor++;
        cursor = endCursor;
      }
    }
    result += code.slice(cursor);
    return result;
  })(clientCode));
  clientStage(ctx, "post-protected-field-scan", () => {
  for (const field of protectedFields) {
    const fieldRegex = new RegExp(`\\.${escapeRegex(field)}\\b`);
    if (fieldRegex.test(clientCode)) {
      errors.push(new CGError(
        "E-CG-001",
        `E-CG-001: Protected field \`${field}\` found in client JS output. ` +
        `This indicates an upstream invariant violation.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }
  });

  // Security validation: client JS must not contain SQL execution calls.
  // §44 Bun.SQL identifier `_scrml_sql` (and scoped `_scrml_sql_<n>` for
  // nested <program db="..."> contexts) must never reach the client.
  // Detected forms: `_scrml_sql.method(`, `_scrml_sql\``, `_scrml_sql_2.unsafe(`
  clientStage(ctx, "post-sql-leak-scan", () => {
  const SQL_LEAK_PATTERNS: RegExp[] = [
    /_scrml_sql_exec\s*\(/,                 // legacy helper name (defensive)
    /_scrml_db\s*\./,                       // legacy bun:sqlite db var (defensive)
    /\b_scrml_sql(?:_\d+)?\s*[.`]/,         // §44 Bun.SQL tag/method calls
    /\bprocess\.env\b/,
    /\bBun\.env\b/,
    /\bbun\.eval\s*\(/,
    /\?\{`/,
  ];
  for (const pattern of SQL_LEAK_PATTERNS) {
    if (pattern.test(clientCode)) {
      errors.push(new CGError(
        "E-CG-006",
        `E-CG-006: Server-only pattern (${pattern}) detected in client JS output. ` +
        `This is a security violation. Indicates a failure in the server-only node guard.`,
        { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      ));
    }
  }
  });

  // S22 §1a slice 2: release the per-file variant registry.
  // S95 Bug 2: also release the rewriter's mirror.
  setVariantFieldsForFile(null, null);
  setVariantFieldsForRewriter(null, null);

  return clientCode;
}

// ---------------------------------------------------------------------------
// buildVariantFieldsRegistry (S22 §1a slice 2)
//
// Scan fileAST.typeDecls once and produce:
//   - fields: Map<variantName, declaredFieldNames[]>
//   - collisions: Set<variantName> — names that appear in more than one enum,
//     flagging positional-binding ambiguity for emitMatchExpr.
// Uses the same decl.variants / decl.raw fallback logic as emitEnumVariantObjects
// (the type system may not attach .variants back onto the AST node).
// ---------------------------------------------------------------------------

export function buildVariantFieldsRegistry(fileAST: any): {
  fields: Map<string, string[]>;
  collisions: Set<string>;
} {
  const fields = new Map<string, string[]>();
  const collisions = new Set<string>();
  const typeDecls: TypeDecl[] = fileAST?.typeDecls ?? fileAST?.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;
    const info = getAllVariantInfo(decl);
    for (const v of info) {
      if (v.fieldNames === null) continue; // unit variants have no bindings
      if (fields.has(v.name)) {
        // Same variant name used in a second enum → positional ambiguity.
        collisions.add(v.name);
      } else {
        fields.set(v.name, v.fieldNames);
      }
    }
  }
  return { fields, collisions };
}

// ---------------------------------------------------------------------------
// emitEnumLookupTables
// ---------------------------------------------------------------------------

/**
 * Generate enum toEnum() lookup table declarations for all enum type
 * declarations in a FileAST.
 */
export function emitEnumLookupTables(fileAST: any): string[] {
  const lines: string[] = [];
  const typeDecls: TypeDecl[] = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;

    const unitVariants = getUnitVariantNames(decl);
    if (unitVariants.length > 0) {
      const entries = unitVariants.map((name: string) => `"${name}": "${name}"`).join(", ");
      lines.push(`const ${decl.name}_toEnum = { ${entries} };`);
    }

    // §14.4.2 — variants array (all variant names in declaration order)
    const allVariants = getAllVariantNames(decl);
    if (allVariants.length > 0) {
      const variantsArray = allVariants.map((name: string) => `"${name}"`).join(", ");
      lines.push(`const ${decl.name}_variants = [${variantsArray}];`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// getUnitVariantNames
// ---------------------------------------------------------------------------

function stripTransitionsBlock(body: string): string {
  // §51.2: Remove `transitions { ... }` block from enum raw body
  const idx = body.indexOf("transitions");
  if (idx < 0) return body;
  const braceStart = body.indexOf("{", idx);
  if (braceStart < 0) return body;
  let depth = 0;
  let i = braceStart;
  while (i < body.length) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  return body.slice(0, idx) + body.slice(i);
}

function getUnitVariantNames(decl: TypeDecl): string[] {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .filter((v: EnumVariant) => v.payload === null || v.payload === undefined)
      .map((v: EnumVariant) => v.name ?? "")
      .filter((name: string) => typeof name === "string" && /^[A-Z]/.test(name));
  }

  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();

  if (!body) return [];

  const parts = body.split(/[\n,|]+/);
  const names: string[] = [];
  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;
    if (trimmed.includes("(")) continue;
    const name = trimmed.split(/\s+/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// getAllVariantNames
// ---------------------------------------------------------------------------

/**
 * Returns ALL variant names (unit and payload) for an enum type declaration,
 * in declaration order. Used by the .variants built-in array (§14.4.2).
 * For payload variants like Found(id: number), only the tag name is returned.
 */
function getAllVariantNames(decl: TypeDecl): string[] {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .map((v: EnumVariant) => v.name ?? "")
      .filter((name: string) => typeof name === "string" && /^[A-Z]/.test(name));
  }

  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();

  if (!body) return [];

  const parts = body.split(/[\n,|]+/);
  const names: string[] = [];
  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;
    // For payload variants like Found(id: number), extract the name before '(' or whitespace.
    const name = trimmed.split(/[\s(]/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// getAllVariantInfo — name + field ordering per variant (unit vs payload)
// ---------------------------------------------------------------------------

interface VariantInfo {
  name: string;
  fieldNames: string[] | null; // null → unit variant; [] → payload with no fields
}

/**
 * Returns ALL variants for an enum type declaration with their payload field
 * ordering when present. Prefers the structured `decl.variants` array (populated
 * by the type system's parseEnumBody) and falls back to parsing `decl.raw`
 * directly — the type system may not always populate `decl.variants` back onto
 * the AST node (the registry is the canonical store).
 */
function getAllVariantInfo(decl: TypeDecl): VariantInfo[] {
  const out: VariantInfo[] = [];

  if (Array.isArray(decl.variants) && decl.variants.length > 0) {
    for (const v of decl.variants) {
      const name = v.name ?? "";
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
      if (v.payload == null) {
        out.push({ name, fieldNames: null });
      } else if (v.payload instanceof Map) {
        out.push({ name, fieldNames: Array.from(v.payload.keys()) });
      } else if (typeof v.payload === "object") {
        // Some paths may leave payload as a plain object — keep insertion order.
        out.push({ name, fieldNames: Object.keys(v.payload) });
      } else {
        out.push({ name, fieldNames: null });
      }
    }
    if (out.length > 0) return out;
  }

  // Fallback: parse from decl.raw. Mirrors type-system.ts parseEnumBody:
  //   Name                  → unit variant
  //   Name(f1:T1, f2:T2)    → payload variant with ordered field names
  const raw: string = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = stripTransitionsBlock(body);
  body = body.trim();
  if (!body) return out;

  // Top-level split on newline AND comma AND `|` at depth 0 — matches the
  // looser style accepted by the existing getAllVariantNames helper.
  // Walking char-by-char avoids splitting inside `(... , ...)`.
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();
    if (!trimmed) continue;

    const parenIdx = trimmed.indexOf("(");
    if (parenIdx === -1) {
      // Unit variant. Strip any trailing `renders ...` so we only keep the name.
      const name = trimmed.split(/\s+/)[0];
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
        out.push({ name, fieldNames: null });
      }
      continue;
    }

    // Payload variant
    const name = trimmed.slice(0, parenIdx).trim();
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) continue;
    const closeParenIdx = trimmed.lastIndexOf(")");
    if (closeParenIdx <= parenIdx) continue;
    const payloadStr = trimmed.slice(parenIdx + 1, closeParenIdx).trim();
    const fieldNames: string[] = [];
    if (payloadStr) {
      // Split on commas at depth 0 (payload types can contain generics/parens).
      let d = 0;
      let fb = "";
      const pieces: string[] = [];
      for (const ch of payloadStr) {
        if (ch === "(" || ch === "[" || ch === "{" || ch === "<") d++;
        else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") d--;
        if (d === 0 && ch === ",") {
          if (fb.trim()) pieces.push(fb);
          fb = "";
        } else {
          fb += ch;
        }
      }
      if (fb.trim()) pieces.push(fb);
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        const colonIdx = p.indexOf(":");
        if (colonIdx === -1) {
          // Bug 68 — positional payload field (a bare type expr, no field
          // name, e.g. `Ok(int)`). Synthesize the index-based key `_<i>`,
          // mirroring type-system.ts parseEnumBody + emit-logic.ts so the
          // raw-fallback path agrees with the structured `decl.variants`
          // path. Without this, a positionally-declared payload variant lost
          // its payload field here (it became a fieldNames:[] "empty payload"
          // entry) and the constructor / schemaFor classification dropped it.
          if (p.trim()) fieldNames.push(`_${i}`);
          continue;
        }
        const fname = p.slice(0, colonIdx).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(fname)) fieldNames.push(fname);
      }
    }
    out.push({ name, fieldNames });
  }

  return out;
}

// ---------------------------------------------------------------------------
// emitEnumVariantObjects (§14.4)
// ---------------------------------------------------------------------------

/**
 * Generate frozen enum objects so developers can write `@status = Status.Loading`
 * for unit variants or `Shape.Circle(10)` for payload variants (§51.3.2).
 *
 * Unit variant   → `Square: "Square"`
 * Payload variant → `Circle: function(radius) { return { variant: "Circle", data: { radius } }; }`
 *
 * The tagged-object shape `{ variant, data }` aligns with §19.3.2 `fail` objects
 * (which add a `__scrml_error` sentinel) so one runtime can dispatch both.
 *
 * The `variants` property (§14.4.2) provides an ordered array of all variant
 * names, enabling iteration: `for (v of Status.variants) { ... }`.
 */
export function emitEnumVariantObjects(fileAST: any): string[] {
  const lines: string[] = [];
  const typeDecls: TypeDecl[] = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];

  for (const decl of typeDecls) {
    if (decl.kind !== "type-decl" || decl.typeKind !== "enum") continue;

    const info = getAllVariantInfo(decl);
    if (info.length === 0) continue;

    const entries: string[] = [];
    for (const v of info) {
      if (v.fieldNames === null) {
        entries.push(`${v.name}: "${v.name}"`);
      } else {
        const params = v.fieldNames.join(", ");
        const dataInit = v.fieldNames.length === 0 ? "{}" : `{ ${params} }`;
        entries.push(`${v.name}: function(${params}) { return { variant: "${v.name}", data: ${dataInit} }; }`);
      }
    }
    const variantsArray = info.map(v => `"${v.name}"`).join(", ");
    lines.push(`const ${decl.name} = Object.freeze({ ${entries.join(", ")}, variants: [${variantsArray}] });`);
  }

  return lines;
}
