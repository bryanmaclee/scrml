import { genVar } from "./var-counter.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import { emitLogicNode, nodeListContainsTildeRef } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import {
  collectTopLevelLogicStatements,
  collectCssVariableBridges,
  getNodes,
  isServerOnlyNode,
  collectServerVarDecls,
  callableServerVarDecls,
  collectServerAuthorityTypes,
  serverVarDeclLoadKind,
} from "./collect.ts";
import { collectDerivedVarNames, buildFunctionBodyRegistry, collectReactiveVarNames, type FunctionBodyRegistry } from "./reactive-deps.ts";
import { collectChannelNodes, emitChannelClientJs, parseChannelReconnect } from "./emit-channel.ts";
import { emitInitialLoad, emitUnifiedMountHydrate, emitServerAuthorityLoad, emitDeclRhsSqlLoad } from "./emit-sync.ts";
import { emitParseVariantDecodeIIFE, type ParseVariantEnumLike } from "./emit-parse-variant.ts";
import type { EncodingContext } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bug 5 helper: strip `_scrml_reconcile_list(...)` calls (with balanced parens)
 * from emitted code so we can detect whether the REMAINING code has any
 * reactive reads. Used to recognize pure-keyed-reconcile blocks whose only
 * reactive deps are already inside self-registering `_scrml_effect_static`.
 * For those blocks, wrapping in an outer `_scrml_effect` re-creates the list
 * wrapper per mutation → list accumulation (3 → 8 → 15 on sequential clicks).
 */
function stripReconcileCalls(code: string): string {
  let out = "";
  let i = 0;
  const needle = "_scrml_reconcile_list(";
  while (i < code.length) {
    const idx = code.indexOf(needle, i);
    if (idx === -1) { out += code.slice(i); break; }
    out += code.slice(i, idx);
    let j = idx + needle.length;
    let depth = 1;
    while (j < code.length && depth > 0) {
      const c = code[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      j++;
    }
    i = j;
  }
  return out;
}

/**
 * Mixed-case for-lift helper (follow-on to Bug 5): extract the one-time
 * setup lines emitted by `emit-control-flow.ts` for each reactive for-lift
 * in a logic group, so they can be hoisted outside the outer `_scrml_effect`
 * wrap. Leaves the `_scrml_lift(wrapper)` call in place so wrapper mount
 * order is preserved on each effect re-fire (appendChild on an already-
 * created node MOVES it rather than duplicating — wrapper's reconciled
 * children come along).
 *
 * The emit shape produced by emit-control-flow.ts (reactive for-lift branch
 * at line 190-245) is always:
 *   const _scrml_list_wrapper_N = document.createElement("div");
 *   _scrml_lift(_scrml_list_wrapper_N);                        ← left in place
 *   function _scrml_create_item_M(var, _scrml_idx) { ... }     ← hoisted
 *   function _scrml_render_list_P() {
 *     _scrml_reconcile_list(_scrml_list_wrapper_N, ..., _scrml_create_item_M);
 *   }                                                           ← hoisted
 *   _scrml_render_list_P();                                     ← hoisted
 *   _scrml_effect_static(_scrml_render_list_P);                 ← hoisted
 *
 * The wrapper declaration (line 1) is also hoisted so the effect body
 * references an outer-scope const (closure) that persists across re-fires.
 * With `TARGET.innerHTML = ""` at the top of the effect, the wrapper is
 * temporarily detached from TARGET; `_scrml_lift(wrapper)` re-mounts it
 * with its reconciled children intact.
 */
function hoistForLiftSetup(combinedCode: string): { hoistedSetup: string; remaining: string } {
  const wrapperRegex = /^( *)const (_scrml_list_wrapper_\d+) = document\.createElement\("div"\);\s*\n/m;
  const hoisted: string[] = [];
  let remaining = combinedCode;

  while (true) {
    const wrapperMatch = remaining.match(wrapperRegex);
    if (!wrapperMatch) break;

    const wrapperVar = wrapperMatch[2];
    const wrapperStart = wrapperMatch.index!;
    const wrapperEnd = wrapperStart + wrapperMatch[0].length;

    // Immediately after wrapper decl is `_scrml_lift(WRAPPER);` — keep in place.
    const liftLine = `_scrml_lift(${wrapperVar});`;
    const liftIdx = remaining.indexOf(liftLine, wrapperEnd);
    if (liftIdx === -1) break;
    const liftEnd = remaining.indexOf("\n", liftIdx) + 1;
    if (liftEnd === 0) break;

    // Find `function _scrml_create_item_M(...)` — balanced-brace extent.
    const createFnRegex = /function (_scrml_create_item_\d+)\(/;
    const createMatchRel = remaining.slice(liftEnd).match(createFnRegex);
    if (!createMatchRel) break;
    const createStart = liftEnd + createMatchRel.index!;
    const createEnd = _findFunctionBodyEnd(remaining, createStart);
    if (createEnd === -1) break;

    // Find `function _scrml_render_list_P()` — balanced-brace extent.
    const renderFnRegex = /function (_scrml_render_list_\d+)\(/;
    const renderMatchRel = remaining.slice(createEnd).match(renderFnRegex);
    if (!renderMatchRel) break;
    const renderStart = createEnd + renderMatchRel.index!;
    const renderFnName = renderMatchRel[1];
    const renderEnd = _findFunctionBodyEnd(remaining, renderStart);
    if (renderEnd === -1) break;

    // Find `RENDER_FN();` call line. Accept newline OR end-of-string because
    // combinedCode for the last group may lack a trailing newline.
    const callRegex = new RegExp(`^ *${renderFnName}\\(\\);\\s*(?:\\n|$)`, "m");
    const afterRender = remaining.slice(renderEnd);
    const callMatchRel = afterRender.match(callRegex);
    if (!callMatchRel) break;
    const callStart = renderEnd + callMatchRel.index!;
    const callEnd = callStart + callMatchRel[0].length;

    // Find `_scrml_effect_static(RENDER_FN);` line. Accept EOF terminator too.
    const effectRegex = new RegExp(`^ *_scrml_effect_static\\(${renderFnName}\\);\\s*(?:\\n|$)`, "m");
    const effectMatchRel = remaining.slice(callEnd).match(effectRegex);
    if (!effectMatchRel) break;
    const effectStart = callEnd + effectMatchRel.index!;
    const effectEnd = effectStart + effectMatchRel[0].length;

    // Collect hoisted content in emit order.
    hoisted.push(remaining.slice(wrapperStart, wrapperEnd).replace(/\n$/, ""));
    hoisted.push(remaining.slice(createStart, createEnd).replace(/\n$/, ""));
    hoisted.push(remaining.slice(renderStart, renderEnd).replace(/\n$/, ""));
    hoisted.push(remaining.slice(callStart, callEnd).replace(/\n$/, ""));
    hoisted.push(remaining.slice(effectStart, effectEnd).replace(/\n$/, ""));

    // Remove hoisted segments from `remaining`. Work back-to-front so earlier
    // indices remain valid during splicing.
    remaining = remaining.slice(0, effectStart) + remaining.slice(effectEnd);
    remaining = remaining.slice(0, callStart) + remaining.slice(callEnd);
    remaining = remaining.slice(0, renderStart) + remaining.slice(renderEnd);
    remaining = remaining.slice(0, createStart) + remaining.slice(createEnd);
    // wrapper decl line (leave the lift line intact).
    remaining = remaining.slice(0, wrapperStart) + remaining.slice(wrapperEnd);
  }

  return { hoistedSetup: hoisted.join("\n"), remaining };
}

/**
 * Find the index one past the closing `}` (and trailing newline, if present)
 * of a `function NAME(...) { ... }` declaration starting at `start`. Performs
 * balanced-brace matching. Returns -1 if no balanced match found.
 */
function _findFunctionBodyEnd(code: string, start: number): number {
  const openBrace = code.indexOf("{", start);
  if (openBrace === -1) return -1;
  let depth = 1;
  let i = openBrace + 1;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  if (depth !== 0) return -1;
  // Include trailing newline if present.
  while (i < code.length && code[i] !== "\n") i++;
  return i < code.length ? i + 1 : i;
}

/** Check if an AST statement contains a lift-expr anywhere in its tree. */
function stmtContainsLift(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "lift-expr") return true;
  for (const key of ["body", "consequent", "alternate"]) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) {
        if (stmtContainsLift(child)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BindPropsWiring {
  propName: string;
  callerVar: string;
  componentName: string;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §51.5 — Build machine bindings map for transition guard emission
// ---------------------------------------------------------------------------

/**
 * Walk the fileAST and build a Map from reactive var name → machine binding info.
 * Returns null if no machine bindings are found.
 *
 * The map is used by rewriteBlockBody to emit emitTransitionGuard instead of
 * plain _scrml_reactive_set for machine-governed reactive variable assignments.
 */
export function buildMachineBindingsMap(fileAST: any): Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget: string | null }> | null {
  const machineRegistry = (fileAST as any).machineRegistry as Map<string, any> | undefined;
  if (!machineRegistry || machineRegistry.size === 0) return null;

  const result = new Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget: string | null }>();

  // Walk the AST to find state-decl nodes with machineBinding annotation
  const nodes: any[] = fileAST.nodes ?? fileAST.ast?.nodes ?? [];
  function walk(nodeList: any[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child && child.kind === "state-decl" && child.machineBinding) {
            const engineName: string = child.machineBinding;
            const machine = machineRegistry.get(engineName);
            // engine-name-dual-table-fix (2026-06-20) — a machine-typed cell `@x: N`
            // whose bound machine `N` is a MODERN engine (state-child body) is
            // governed by the §51.0 engine path, NOT the §51.3 arrow-rule write-guard.
            // A modern engine registers EMPTY `machine.rules` (type-system.ts
            // buildMachineRegistry — the rules live in engineMeta.stateChildren and
            // feed `emit-engine.ts`'s POPULATED `__scrml_engine_<var>_transitions`).
            // Emitting a §51.3 binding here would point the write-guard at an EMPTY
            // `__scrml_transitions_N` table → every legal transition throws
            // E-ENGINE-001-RT at runtime. SKIP it: SYM unified the engine's variable
            // to `@x` (registerEngineDecl), so the cell is in `engineBindings` and
            // `_emitReactiveSet` routes `@x = .V` through `emitEngineWriteGuard`
            // against the populated table. The LEGACY arrow-body named machine keeps
            // a non-empty `machine.rules`, so it still gets its §51.3 binding here.
            const isModernEngine = machine != null
              && Array.isArray(machine.rules) && machine.rules.length === 0
              && machine.isDerived !== true;
            if (machine && child.name && !isModernEngine) {
              result.set(child.name as string, {
                engineName,
                tableName: `__scrml_transitions_${engineName}`,
                rules: machine.rules ?? [],
                auditTarget: (machine.auditTarget as string | null | undefined) ?? null,
              });
            }
          }
        }
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  }
  walk(nodes);

  return result.size > 0 ? result : null;
}

/**
 * Emit top-level logic statements and CSS variable bridge wiring.
 */
export function emitReactiveWiring(ctx: CompileContext): string[] {
  const { fileAST, errors, encodingCtx } = ctx;
  const lines: string[] = [];

  const derivedNames = collectDerivedVarNames(fileAST);
  // Bug 61 — dotted synth-cell keys for compound parents in this file. Read
  // from the CompileContext (populated in index.ts via collectSynthCellKeys);
  // threaded into emitOpts so `@<compound>.<synthProp>` reads in top-level logic
  // / derived-init / validator-arg expressions route to the dotted synth cell.
  const synthCellKeys: Set<string> = ctx.synthCellKeys ?? new Set();
  const machineBindings = buildMachineBindingsMap(fileAST);
  // C13 (§51.0.F + §51.0.G) — sibling map for new `<engine>`-form direct-write
  // hook + `.advance()` dispatch. Forked from `machineBindings` per C13 SURVEY
  // q1 (the new C12 table format and legacy TransitionRule[] do not merge cleanly).
  const { buildEngineBindingsMap, collectEngineVarNames, collectEnginesWithHooks, collectEnginesWithOnTimeout, collectEnginesWithIdleWatchdog, collectEnginesWithInternalRules, collectEnginesWithHistory, collectEnginesWithMessageArms, collectEngineMessageVariants } = require("./emit-engine.ts");
  const engineBindings = buildEngineBindingsMap(fileAST);
  const engineVarNames: Set<string> = collectEngineVarNames(fileAST);
  // §59 (D4) — value-native MAP variable names in the file's scope. Threaded
  // into `emit-logic` via `EmitLogicOpts.mapVarNames` so emit-expr intercepts
  // `@m[k]` reads / `@m.<method>(…)` calls / `@m.size`. Sibling to engineVarNames.
  const { collectMapVarNames, collectOrderedMapVarNames, collectRequestIds, collectSetVarNames } = require("./reactive-deps.ts");
  const mapVarNames: Set<string> = collectMapVarNames(fileAST);
  // §59.12 (D4) — value-native SET cell names (strict subset of mapVarNames).
  // Threaded into `emit-logic` via `EmitLogicOpts.setVarNames` so emit-expr
  // intercepts the set-native vocabulary in interpolations / derived cells.
  const setVarNames: Set<string> = collectSetVarNames(fileAST);
  // §6.7.7 / §60.4 — `<request>` id set. Threaded into `emit-logic` via
  // `EmitLogicOpts.requestIds` so emit-expr routes a `<#id>` request ref to the
  // reactive `_scrml_request_<id>` object (not the §36 input-state registry).
  const requestIds: Set<string> = collectRequestIds(fileAST);
  // §59.8 (S169) — the STRICT `@ordered`-typed subset of `mapVarNames`. Threaded
  // into `emit-logic` via `EmitLogicOpts.orderedMapVarNames` so emit-expr lowers
  // a reassignment `@m = [...]` to an ordered cell ordered. Sibling to mapVarNames.
  const orderedMapVarNames: Set<string> = collectOrderedMapVarNames(fileAST);
  // B17.4 (§51.0.H) — engines with hooks gate the wrap on `.advance()` /
  // direct-write call sites; threaded into `emit-logic` via
  // `EmitLogicOpts.enginesWithHooks`.
  const enginesWithHooks: Set<string> = collectEnginesWithHooks(fileAST);
  // A5-4 (§51.0.M) — engines with at least one `<onTimeout>` element gate
  // the timer-table arg insertion at write sites; sibling to enginesWithHooks.
  const enginesWithOnTimeout: Set<string> = collectEnginesWithOnTimeout(fileAST);
  // A5-6 (§51.0.R, S77) — engines that declare `<onIdle>` gate the watchdog-
  // config arg insertion at write sites; sibling to enginesWithOnTimeout.
  const enginesWithIdleWatchdog: Set<string> = collectEnginesWithIdleWatchdog(fileAST);
  // A5-7 Wave 2.2 (§51.0.O, Bug #4 fix) — engines with at least one state-
  // child carrying `internal:rule=` gate the internal-table arg insertion at
  // write sites; sibling to enginesWithIdleWatchdog.
  const enginesWithInternalRules: Set<string> = collectEnginesWithInternalRules(fileAST);
  // A5-7 Wave 2.3 (§51.0.N, Bug #3) — engines with at least one composite
  // state-child carrying `history` (with a discoverable inner-engine var)
  // gate the history-map arg insertion at write sites; sibling to
  // enginesWithInternalRules.
  const enginesWithHistory: Set<string> = collectEnginesWithHistory(fileAST);
  // §51.0.S (S155 batch 3) — engines that declare `(state × message)` arms
  // gate the `.advance` message-plane routing; the message-variant map
  // stamps the plane at codegen (sibling to enginesWithHistory).
  const enginesWithMessageArms: Set<string> = collectEnginesWithMessageArms(fileAST);
  const engineMessageVariants: Map<string, Set<string>> = collectEngineMessageVariants(fileAST);
  // C2: build function-body registry once per file for transitive reactive-dep
  // extraction in derived-cell inits (closes SPEC §6.6.3 line 2470-2482
  // normative — deps tracked through fn calls). Mirrors the
  // `extractReactiveDepsTransitive` usage in `emit-html.ts:891` for markup
  // interpolations. Threaded into `emit-logic` via `EmitLogicOpts.fnBodyRegistry`.
  const fnBodyRegistry: FunctionBodyRegistry = buildFunctionBodyRegistry(fileAST as Record<string, unknown>);
  // C21 (§14.11 / M10) — Build the file-level typeRegistry once and thread
  // through emitOpts so the state-decl arm can resolve typeAnnotation strings
  // to StructType records for Tier 3 positional sugar lowering. Reused by the
  // transition-table emitter below (replaces the prior local rebuild).
  const typeDeclsForRegistry = (fileAST as any).typeDecls as any[] | undefined;
  let typeRegistry: Map<string, any> | null = null;
  if (typeDeclsForRegistry) {
    const { buildTypeRegistry } = require("../type-system.ts");
    typeRegistry = buildTypeRegistry(typeDeclsForRegistry, [], { file: fileAST.filePath ?? "", start: 0, end: 0, line: 1, col: 1 });
  }
  // Bug 61 — synthCellKeys is added in BOTH ternary branches (NOT gated on
  // derivedNames.size): a compound form may have zero top-level derived cells
  // yet still declare synth cells, and the `@<compound>.<synthProp>` read must
  // still route. Only spread when non-empty to keep emitOpts lean.
  const synthCellKeysSpread = synthCellKeys.size > 0 ? { synthCellKeys } : {};
  const emitOpts: { derivedNames?: Set<string>; synthCellKeys?: Set<string>; encodingCtx?: typeof encodingCtx; machineBindings?: typeof machineBindings; engineBindings?: typeof engineBindings; mapVarNames?: Set<string>; setVarNames?: Set<string>; requestIds?: Set<string>; orderedMapVarNames?: Set<string>; engineVarNames?: Set<string>; enginesWithHooks?: Set<string>; enginesWithOnTimeout?: Set<string>; enginesWithIdleWatchdog?: Set<string>; enginesWithInternalRules?: Set<string>; enginesWithHistory?: Set<string>; enginesWithMessageArms?: Set<string>; engineMessageVariants?: Map<string, Set<string>>; fnBodyRegistry?: FunctionBodyRegistry; typeRegistry?: Map<string, any> | null; errors?: typeof errors } = derivedNames.size > 0
    ? { derivedNames, ...synthCellKeysSpread, encodingCtx, fnBodyRegistry, errors, ...(typeRegistry ? { typeRegistry } : {}), ...(machineBindings ? { machineBindings } : {}), ...(engineBindings ? { engineBindings } : {}), ...(mapVarNames.size > 0 ? { mapVarNames } : {}), ...(setVarNames.size > 0 ? { setVarNames } : {}), ...(requestIds.size > 0 ? { requestIds } : {}), ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}), ...(engineVarNames.size > 0 ? { engineVarNames } : {}), ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}), ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}), ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}), ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}), ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}), ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}), ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}) }
    : { ...synthCellKeysSpread, encodingCtx, fnBodyRegistry, errors, ...(typeRegistry ? { typeRegistry } : {}), ...(machineBindings ? { machineBindings } : {}), ...(engineBindings ? { engineBindings } : {}), ...(mapVarNames.size > 0 ? { mapVarNames } : {}), ...(setVarNames.size > 0 ? { setVarNames } : {}), ...(requestIds.size > 0 ? { requestIds } : {}), ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}), ...(engineVarNames.size > 0 ? { engineVarNames } : {}), ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}), ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}), ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}), ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}), ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}), ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}), ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}) };

  // Step 4a: Generate transition lookup tables for enums with transitions{} and machines (§51.5).
  // These must be emitted BEFORE top-level logic statements because state-decl
  // initializers with machine bindings emit transition guard IIFEs that reference
  // the table variables.
  const machineRegistry = (fileAST as any).machineRegistry as Map<string, any> | undefined;
  const typeDecls = (fileAST as any).typeDecls as any[] | undefined;
  if (typeDecls || machineRegistry) {
    const { emitTransitionTable } = require("./emit-machines.ts");
    // Emit tables for enums with type-level transitions
    if (typeDecls && typeRegistry) {
      const { BUILTIN_TYPES } = require("../type-system.ts");
      for (const [name, type] of typeRegistry) {
        if (BUILTIN_TYPES.has(name)) continue;
        if (type.kind === "enum" && type.transitionRules && type.transitionRules.length > 0) {
          lines.push("");
          for (const l of emitTransitionTable(`__scrml_transitions_${name}`, type.transitionRules)) {
            lines.push(l);
          }
        }
      }
    }
    // Emit tables for machines. Derived/projection machines (§51.9) skip
    // the transition-table emission — they don't enforce transitions; they
    // project a source enum into a different enum at read time.
    if (machineRegistry && machineRegistry.size > 0) {
      const { emitProjectionFunction, emitDerivedDeclaration } = require("./emit-machines.ts");
      for (const [name, machine] of machineRegistry) {
        if (machine.isDerived) {
          lines.push("");
          for (const l of emitProjectionFunction(machine)) lines.push(l);
          for (const l of emitDerivedDeclaration(machine)) lines.push(l);
          continue;
        }
        // engine-name-dual-table-fix (2026-06-20) — a MODERN engine (state-child
        // body) registers EMPTY `machine.rules`; its transitions live in the §51.0
        // engine table `__scrml_engine_<var>_transitions` (emit-engine.ts). Emitting
        // an empty `__scrml_transitions_<name>` here is dead output (no write-guard
        // reads it post-fix — see buildMachineBindingsMap modern-engine skip). Skip
        // it for output minimality. The LEGACY arrow-body named machine keeps a
        // non-empty `machine.rules`, so its keyed §51.3 table is still emitted.
        if (Array.isArray(machine.rules) && machine.rules.length === 0) continue;
        lines.push("");
        for (const l of emitTransitionTable(`__scrml_transitions_${name}`, machine.rules)) {
          lines.push(l);
        }
      }
    }
  }

  // Step 4b: Generate top-level logic statements
  // Always re-collect (don't use pre-computed analysis.topLevelLogic) because
  // generateHtml annotates logic nodes with _placeholderId which must be propagated
  // to children for lift-target routing.
  // §6.7.7 — HOIST the `<request>` state-object declarations to BEFORE top-level
  // logic. The render bridge routes a file-scope `const <x> = <#id>.data` (and
  // interpolation/match/if reads) to `_scrml_request_<id>`, but the full request
  // init (Step 5c) is emitted AFTER top-level logic. Since `var` hoists only the
  // binding (not the assignment), a module-init read of `_scrml_request_<id>.data`
  // before its assignment would throw `undefined.data`. Emit the deep-reactive
  // state object early so the binding is initialized before any file-scope read.
  // The fetch fn + invocation + seq/mounted vars stay in Step 5c (they are only
  // read by the late-emitted fetch fn, and the deps=/args= effect must run after
  // the cells it reads are set by top-level logic).
  const _hoistRequestNodes = classifyMarkupNodes(getNodes(fileAST)).requestNodes;
  if (_hoistRequestNodes.length > 0) {
    const hoistedIds = new Set<string>();
    for (const rqNode of _hoistRequestNodes) {
      const rqId = extractRequestId(rqNode);
      if (rqId && !hoistedIds.has(rqId)) {
        hoistedIds.add(rqId);
        if (hoistedIds.size === 1) {
          lines.push("");
          lines.push("// --- request state objects (§6.7.7, hoisted for module-init reads) ---");
        }
        lines.push(`var _scrml_request_${rqId} = _scrml_deep_reactive({ loading: true, data: null, error: null, stale: false });`);
      }
    }
  }

  const topLevel = collectTopLevelLogicStatements(fileAST);

  // Group statements by placeholder ID so sibling statements from the same logic
  // block are emitted together. This is critical for reactive lift blocks: the
  // reactive dep (@query) may be in a sibling statement (const q = @query...) while
  // the lift-expr is in the for-stmt. Both must be inside the same _scrml_effect.
  const groups: Array<{ pid: string | null; stmts: any[] }> = [];
  let currentGroup: { pid: string | null; stmts: any[] } | null = null;

  for (const stmt of topLevel) {
    const pid = stmt._placeholderId ?? null;
    if (currentGroup && currentGroup.pid === pid) {
      currentGroup.stmts.push(stmt);
    } else {
      currentGroup = { pid, stmts: [stmt] };
      groups.push(currentGroup);
    }
  }

  for (const group of groups) {
    const { pid, stmts } = group;
    const codes: string[] = [];
    let groupHasLift = false;
    let groupHasReactiveDeps = false;
    let skipGroup = false;

    // §32 tilde codegen: pre-scan each group (a contiguous run of statements
    // within a `${}` body — sharing _placeholderId) for `~` references. When
    // any statement in the group references `~` (including structural ExprNode
    // form), set up a per-group tildeContext so bare-expr / value-lift nodes
    // capture results to a generated `_scrml_tilde_N` and consume sites lower
    // `~` to that var. Each group is an independent `${}` boundary per
    // SPEC §32.4. `let` shadowing in JS handles nested scopes naturally —
    // see emitIfExprDecl / emitForExprDecl for the as-expression-decl
    // counterpart.
    const groupTildeUsed = nodeListContainsTildeRef(stmts);
    const groupTildeCtx = groupTildeUsed
      ? { var: null as string | null, mode: "single" as "single" | "array" }
      : null;
    const groupEmitOpts = groupTildeCtx
      ? { ...emitOpts, tildeContext: groupTildeCtx }
      : emitOpts;

    for (const stmt of stmts) {
      // S108 Bug 5 Phase 3 — Skip statements from constant-folded logic wrappers.
      // emit-html.ts inlines the folded value directly into the HTML body; the
      // bare-expr (literal / ident / arithmetic) that produced the fold has
      // nothing to emit at file scope. Without this skip, `${"hello"}` produces
      // an orphan `"hello";` no-op statement at file scope (visible noise).
      if ((stmt as any)._constantFolded === true) {
        continue;
      }
      // inline-value-form-interp (§18.0 / §17.6) — Skip the control-flow body of
      // a value-form `${ match … }` / `${ if … }` interpolation. emit-html.ts
      // allocated its render slot + registered a `value-control-flow` logic-
      // binding; emit-event-wiring.ts renders the SELECTED VALUE into the slot
      // (and wires the reactive re-render). Without this skip the body would ALSO
      // emit at file scope as a value-DISCARDING statement (the dead
      // `(function(){…})()` for match / `if(){…}else{…}` for if) — the very
      // pre-fix bug. (Marker set on the wrapper by emit-html.ts; propagated to
      // this inner child stmt by collect.ts, mirroring `_constantFolded`.)
      if ((stmt as any)._valueControlFlowRendered === true) {
        continue;
      }
      if (isServerOnlyNode(stmt)) {
        errors.push(new CGError(
          "W-CG-001",
          `W-CG-001: Top-level ${stmt.kind} block suppressed from client output. ` +
          `Server-only constructs (SQL, transactions, server-context meta) must be ` +
          `inside server-boundary functions. This block will not execute.`,
          stmt.span ?? { file: fileAST.filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
          "warning",
        ));
        continue;
      }
      const code = emitLogicNode(stmt, groupEmitOpts);

      // Bug 5 Phase 2 (S107, 2026-05-19) — Anomaly B fix.
      //
      // For pid-tagged groups (interpolation-in-markup `${...}`), bare-expr
      // bodies are CONSUMED by binding wiring at DOMContentLoaded via
      // emit-event-wiring.ts. Pre-S107 also emitted them at file-scope as
      // standalone expression statements — producing orphan no-ops like
      // `VERSION;` (from `${VERSION}`) or `_scrml_reactive_get("count");`
      // (from `${@count}`). Harmless but adopter-visible noise in inspected
      // client.js.
      //
      // Skip the file-scope emission when:
      //   - pid is set (this is an interpolation, not a file-level ${...} block)
      //   - !groupTildeCtx (tilde groups emit `let _scrml_tilde_N = ...`
      //     statements that MUST live at file-scope for the wiring closure to
      //     read them — Phase 3 will thread tilde context properly)
      //   - stmt.kind === "bare-expr" (declarations + assignments + side-
      //     effecting calls always emit; only pure read-shape statements skip)
      //   - the emitted code matches a "pure read orphan" shape: a bare
      //     identifier, dotted-path member access, or a `_scrml_reactive_get`
      //     / `_scrml_derived_get` call followed by `;`. Anything else
      //     (function calls, assignments, blocks, multi-statement output)
      //     keeps emitting to preserve side effects.
      //
      // Pure-read regex matches `IDENT;`, `IDENT.path;`, `_scrml_reactive_get("x");`,
      // `_scrml_derived_get("x");`. Doesn't match: `foo();` (call), `@x = 1;`
      // (assignment), `{ ... }` (block), multi-line output.
      //
      // S144 (6nz Bug AC) — also suppress the §36 input-state registry read
      // shape `_scrml_input_state_registry.get("id").member.chain;`. Like the
      // `_scrml_reactive_get` orphan beside it, an input-state read in an
      // interpolation `${<#cursor>.x}` is CONSUMED by the binding wiring at
      // DOMContentLoaded (emit-event-wiring.ts) and must NOT also leak as a
      // file-scope statement. It would not only be visible no-op noise — it
      // would EXECUTE before `_scrml_input_*_create` registers the state
      // (file-scope runs top-down, registration follows), so the empty
      // registry returns `undefined` and `.member` throws a fresh file-scope
      // `TypeError`. (Before S144 this shape never reached here: the read
      // compiled to the dead bare `_scrml_input_<id>_.member` form, which the
      // first regex alternative already matched and suppressed.)
      //
      // ss3 item7 (giti-006, 2026-06-19) — extend the `_scrml_(reactive|derived)_get`
      // alternative with the SAME trailing member-access / index chain the input-state
      // alternative already carries. Pre-fix it matched only the bare-cell read
      // `_scrml_reactive_get("data")` (from `${@data}`) but NOT the path read
      // `_scrml_reactive_get("data").name` (from `${@data.name}`), so a markup
      // interpolation of a dotted path leaked a spurious file-scope statement. That
      // statement is dead (its value is unused — the render wiring at DOMContentLoaded
      // is the sole consumer) AND harmful: for an async-initialized reactive whose cell
      // holds the `null` placeholder until a server fetch resolves, the file-scope
      // `null.name` THROWS at module-init, crashing the page before the fetch lands.
      // The trailing chain is member (`.path`) + index (`[k]`) ONLY — NO call
      // alternative — because a trailing call (`_scrml_reactive_get("x").map(...)`) is
      // a method invocation with side effects and MUST keep emitting at file-scope.
      if (
        pid &&
        !groupTildeCtx &&
        stmt.kind === "bare-expr" &&
        code &&
        /^(?:[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*|_scrml_(?:reactive|derived)_get\([^)]*\)(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]*\])*|_scrml_input_state_registry\.get\([^)]*\)(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]*\]|\([^)]*\))*)\s*;?\s*$/.test(code.trim())
      ) {
        continue;
      }

      if (code) codes.push(code);
      if (stmtContainsLift(stmt)) groupHasLift = true;
      // Check for reactive deps in the emitted code (after @var rewriting)
      if (code && code.includes("_scrml_reactive_get(")) groupHasReactiveDeps = true;
      // ss21 item 1 (g-request-lift-bare-if-condition) — a `<#id>` request ref in
      // a `${ if (...) { lift } }` CONDITION lowers (Seam 2) to a deep-reactive
      // `_scrml_request_<id>` member read, NOT `_scrml_reactive_get(...)`, so the
      // detector above missed it and the lift group fell into the non-reactive
      // `else` branch below: the `if` ran ONCE at module-init and never
      // re-evaluated on fetch-resolve (loading->data) — the gated lift was frozen.
      // Treat such a read as a reactive dep so the group is `_scrml_effect`-wrapped
      // (the wrap re-runs the if on resolve and toggles the gated content, matching
      // the ${@cell}-gated lift path). Whole-token boundary guard keeps the match
      // off the `_scrml_request_<id>_fetch`/`_seq`/`_mounted` sidecars (which never
      // appear in a logic-group body anyway).
      if (code && !groupHasReactiveDeps && requestIds && requestIds.size > 0 && code.includes("_scrml_request_")) {
        for (const _rqId of requestIds) {
          const _re = new RegExp("_scrml_request_" + _rqId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_$])");
          if (_re.test(code)) { groupHasReactiveDeps = true; break; }
        }
      }
    }

    if (codes.length === 0) continue;
    const combinedCode = codes.join("\n");

    if (pid && groupHasLift) {
      if (groupHasReactiveDeps) {
        // Wrap in _scrml_effect: clear the placeholder, re-run the block.
        // Guard 1 (branch): if the group is a single if-stmt whose condition
        //   evaluates to the same truthy/falsy value as last time, skip the
        //   innerHTML clear to preserve event listeners and input state.
        // Guard 2 (keyed reconcile): if the emitted code uses
        //   `_scrml_reconcile_list`, the list wrapper is mounted once and
        //   reconciled in place. An innerHTML clear would destroy the wrapper
        //   every time the effect re-runs, breaking keyed diffing.
        // Bug 5: if the ONLY reactive reads in the block are inside keyed
        //   reconcile calls, the `_scrml_effect_static(renderFn)` inside the
        //   for-lift emit already handles re-reconciliation. An outer
        //   _scrml_effect wrap would re-create the list wrapper per mutation,
        //   causing list accumulation (3 → 8 → 15 on sequential clicks).
        //   Skip the outer effect wrap for this case. Mixed case (keyed
        //   reconcile + other reactive reads) falls through to the general
        //   wrap — preserves existing behavior (known issues there are
        //   separate from Bug 5 and addressed in a follow-on).
        const isSingleIf = stmts.length === 1 && stmts[0].kind === "if-stmt";
        const hasKeyedReconcile = combinedCode.includes("_scrml_reconcile_list(");
        const hasOtherReactiveReads = hasKeyedReconcile
          ? stripReconcileCalls(combinedCode).includes("_scrml_reactive_get(")
          : true;
        const canSkipOuterEffect = hasKeyedReconcile && !hasOtherReactiveReads;

        if (canSkipOuterEffect) {
          lines.push(`_scrml_lift_target = document.querySelector('[data-scrml-logic="${pid}"]');`);
          lines.push(combinedCode);
          lines.push(`_scrml_lift_target = null;`);
        } else {
          const targetVar = genVar("lift_tgt");
          const branchVar = isSingleIf ? genVar("lift_branch") : null;
          lines.push(`const ${targetVar} = document.querySelector('[data-scrml-logic="${pid}"]');`);
          if (branchVar) {
            lines.push(`let ${branchVar} = -1;`);
          }

          // Mixed-case follow-on to Bug 5: if the block combines a keyed-
          // reconcile for-lift with OTHER reactive content (e.g. a sibling
          // `if (@cond) { lift ... }`), hoist the for-lift's one-time setup
          // (wrapper creation, createFn, renderFn, first render call, static
          // effect registration) OUTSIDE the outer _scrml_effect. Inside the
          // effect we retain `_scrml_lift(wrapper)` which re-mounts the same
          // wrapper node (appendChild MOVES rather than duplicates; the
          // wrapper's reconciled children persist). With this hoist we can
          // safely re-enable `targetVar.innerHTML = ""` — it clears other
          // content but the hoisted wrapper is re-mounted right after,
          // fixing both (a) wrapper accumulation and (b) conditional-lift
          // accumulation in one pass.
          let effectBodyCode = combinedCode;
          if (hasKeyedReconcile && hasOtherReactiveReads) {
            const { hoistedSetup, remaining } = hoistForLiftSetup(combinedCode);
            if (hoistedSetup) {
              lines.push(hoistedSetup);
              effectBodyCode = remaining;
            }
          }

          lines.push(`_scrml_effect(function() {`);
          if (branchVar) {
            // Extract the condition from the emitted if-statement to check branch identity.
            // The emitted code starts with `if (condition) {` — extract and test condition.
            const condMatch = effectBodyCode.match(/^if\s*\((.+)\)\s*\{/);
            if (condMatch) {
              lines.push(`  const _branch = (${condMatch[1]}) ? 1 : 0;`);
              lines.push(`  if (_branch === ${branchVar}) return;`);
              lines.push(`  ${branchVar} = _branch;`);
            }
          }
          // With the mixed-case hoist in place, innerHTML clear is now safe
          // even when hasKeyedReconcile (the wrapper is outer-scope; it
          // re-mounts via the retained _scrml_lift(wrapper) in the body).
          const hoisted = hasKeyedReconcile && hasOtherReactiveReads;
          if (!hasKeyedReconcile || hoisted) {
            lines.push(`  ${targetVar}.innerHTML = "";`);
          }
          lines.push(`  _scrml_lift_target = ${targetVar};`);
          lines.push(`  ${effectBodyCode}`);
          lines.push(`  _scrml_lift_target = null;`);
          lines.push(`});`);
        }
      } else {
        lines.push(`_scrml_lift_target = document.querySelector('[data-scrml-logic="${pid}"]');`);
        lines.push(combinedCode);
        lines.push(`_scrml_lift_target = null;`);
      }
    } else {
      lines.push(combinedCode);
    }
  }

  // Step 4c: Generate <var server> READ-authority sync infrastructure (§52.6).
  // Under the Q1=C / Q2=WF ruling §52 generates the READ path only (initial
  // load + SSR + E-AUTH). The WRITE is the developer's own `?{}` server fn
  // (§52.6.2 / §52.6.6) — NO `_scrml_server_sync_<var>` stub and NO optimistic
  // subscriber are emitted. An assignment lands locally via the ordinary
  // reactive set (that IS the immediate-local property); errors surface at the
  // dev's awaited server-fn call site.
  //
  // §52.8 (ssr-b-substrate) — SSR pre-render seed application. The compiler-
  // emitted SSR HTML-composition route (emit-server.ts) injects
  // window.__scrml_ssr_state={…} with the server-authoritative cell values
  // (redacted at the §14.8.9 egress sink). _scrml_ssr_seed_apply() applies them
  // HERE — after the top-level cell-init (Step 4b, placeholders) so it OVERRIDES
  // the placeholder, and BEFORE the fetch IIFEs below (which then skip the RTT
  // per _scrml_ssr_seeded) AND before the engine A-leg/E-leg hydration (emitted
  // after emitReactiveWiring) so a server=@cell engine reads a real value at
  // construction. Gated on having ≥1 server-authority cell — a non-server-
  // authority page emits no seed-apply (byte-identical; the 'ssr' runtime chunk
  // tree-shakes out). Absent SSR at request time, the helper is a runtime no-op.
  const serverVarDecls = collectServerVarDecls(fileAST);
  const serverAuthorityTypesForSeed = collectServerAuthorityTypes(fileAST);
  if (serverVarDecls.length > 0 || serverAuthorityTypesForSeed.length > 0) {
    lines.push("");
    lines.push("// --- §52.8 SSR pre-render seed application (ssr-b-substrate) ---");
    // navigate-wave1b #5 — when this page is a <program> shell (has an <outlet>),
    // emit the compile-time set of program-top-level (shell) cell names so the
    // soft-nav REHYDRATE seed-apply (_scrml_ssr_seed_apply(true)) can skip them: a
    // mutated shell cell (nav counter, sidebar toggle) MUST survive a soft nav, not
    // reset to the fetched route's SSR-initial value. The INITIAL page load seeds
    // everything (the bare _scrml_ssr_seed_apply() below). Only a shell that has ≥1
    // shell cell overlapping the seed needs the set — gate on that intersection so
    // a route-only-seed page emits nothing (byte-identical to before).
    if (fileHasOutlet(fileAST)) {
      const shellCells = collectShellCellNames(fileAST);
      const seedShellCells: string[] = [];
      for (const decl of serverVarDecls) {
        const n = decl.name as string;
        if (shellCells.has(n)) seedShellCells.push(n);
      }
      for (const decl of serverAuthorityTypesForSeed) {
        const n = decl.name as string;
        if (shellCells.has(n)) seedShellCells.push(n);
      }
      if (seedShellCells.length > 0) {
        const entries = seedShellCells.map((n) => `${JSON.stringify(n)}: true`).join(", ");
        lines.push(`// navigate-wave1b #5 — shell cells skipped by the soft-nav rehydrate seed-apply.`);
        lines.push(`var _scrml_shell_cells = { ${entries} };`);
      }
    }
    lines.push("_scrml_ssr_seed_apply();");
  }
  if (serverVarDecls.length > 0) {
    lines.push("");
    lines.push("// --- <var server> read-authority sync (§52.6, compiler-generated) ---");
    // §8.11: if ≥2 callable initExprs share this page, coalesce their initial
    // loads into one /__mountHydrate fetch instead of N per-var async IIFEs.
    // There is no write route to coalesce (§8.11.3) — writes are the dev's `?{}`.
    const callableDecls = callableServerVarDecls(serverVarDecls);
    const coalesceMount = callableDecls.length >= 2;
    for (const decl of serverVarDecls) {
      const varName: string = decl.name as string;
      // §52.6.5 Pattern C (S216 disposition A): a `<var server> = ?{…}` decl
      // carries a structured `sqlNode` (ss1 item-3 leak-stop) — the inline `?{}`
      // IS the cell's mount load. A PARAM-FREE query loads via the
      // `/__serverLoad/<var>` route (POST empty body, mirror of Tier-1). A
      // PARAM-BEARING query (`?{ … ${@cell} … }`) needs POST-body param-passing
      // (bounded follow-on) — it emits NO load here; the type system surfaces
      // W-AUTH-004 so the dev sees the cell will not hydrate.
      // §52 (S233) — pass the ambient-active flag so a Fork-3 row-scope query
      // (`?{ … ${@currentUser.id} … }`) classifies as sql-load (server-resolvable),
      // not param-bearing, when no user `<currentUser>` cell shadows the name.
      const loadKind = serverVarDeclLoadKind(decl, !collectReactiveVarNames(fileAST).has("currentUser"));
      if (loadKind === "sql-load") {
        for (const l of emitDeclRhsSqlLoad(varName)) lines.push(l);
        continue;
      }
      if (loadKind === "param-bearing") {
        // No load emitted (W-AUTH-004 diagnostic owns the dev-facing nudge).
        continue;
      }
      // Phase 4d: ExprNode-first, string fallback
      const initExpr: string = (decl as any).initExpr ? emitStringFromTree((decl as any).initExpr) : (typeof decl.init === "string" ? decl.init : "");
      // Emit per-var initial-load IIFE only when NOT coalescing OR when this var
      // is not callable (callable subset is handled by the unified fetch below).
      const isCallable = !!initExpr && initExpr.includes("(");
      if (!coalesceMount || !isCallable) {
        for (const l of emitInitialLoad(varName, initExpr)) lines.push(l);
      }
    }
    if (coalesceMount) {
      const coalescedNames = callableDecls.map((d) => d.name as string);
      for (const l of emitUnifiedMountHydrate(coalescedNames)) lines.push(l);
    }
  }

  // Step 4c.1: §52.3.5 Tier-1 server-authority TYPE read-authority load.
  // For each `< Type authority="server" table="…">` instance, emit the
  // `SELECT * FROM <table>` initial load on mount (§52.6.1). The query runs
  // server-side via the compiler-generated `/__serverLoad/<var>` route
  // (emitted by generateServerJs); the client fetches it and lands the rows.
  // The WRITE is the developer's own `?{}` server fn (§52.6.2, Q1=C).
  const serverAuthorityTypes = collectServerAuthorityTypes(fileAST);
  if (serverAuthorityTypes.length > 0) {
    lines.push("");
    lines.push("// --- Tier-1 server-authority type read-authority load (§52.3.5/§52.6.1) ---");
    for (const decl of serverAuthorityTypes) {
      const varName: string = decl.name as string;
      const table: string = (decl as any).serverAuthorityTable as string;
      for (const l of emitServerAuthorityLoad(varName, table)) lines.push(l);
    }
  }

  // Single-pass classification of markup nodes (replaces 5 independent AST walks)
  const { lifecycleNodes, inputStateNodes, requestNodes, apiDeclNodes, timeoutNodes, bindPropsWirings } =
    classifyMarkupNodes(getNodes(fileAST));

  // Step 5: Generate <timer> and <poll> lifecycle initialization (§6.7.5, §6.7.6)
  if (lifecycleNodes.length > 0) {
    lines.push("");
    lines.push("// --- lifecycle initialization (compiler-generated) ---");
    for (const lcNode of lifecycleNodes) {
      const lcLines = emitLifecycleNode(lcNode, errors, fileAST.filePath ?? "");
      for (const l of lcLines) lines.push(l);
    }
  }

  // Step 5b: Generate <keyboard>, <mouse>, <gamepad> input state initialization (§35)
  if (inputStateNodes.length > 0) {
    lines.push("");
    lines.push("// --- input state initialization (compiler-generated) ---");
    for (const isNode of inputStateNodes) {
      const isLines = emitInputStateNode(isNode, errors, fileAST.filePath ?? "");
      for (const l of isLines) lines.push(l);
    }
  }

  // Step 5.5: Generate <channel> client-side WebSocket initialization (§35)
  const channelNodes = ctx.analysis?.channelNodes ?? collectChannelNodes(getNodes(fileAST));
  if (channelNodes.length > 0) {
    // S81 audit fix F.2 (§38.3.1): parse project-level <program channel-reconnect=>
    // default once and thread to every channel's client-side emitter. Per-channel
    // <channel reconnect=> wins over the project default; both absent → 2000ms.
    const mwConfig = (fileAST as any)?.middlewareConfig ?? null;
    const channelReconnectRaw = mwConfig?.channelReconnect ?? null;
    const projectReconnectDefault = parseChannelReconnect(channelReconnectRaw);
    lines.push("");
    lines.push("// --- channel WebSocket client initialization (§35, compiler-generated) ---");
    for (const chNode of channelNodes) {
      const chLines = emitChannelClientJs(chNode, errors, fileAST.filePath ?? "", projectReconnectDefault);
      for (const l of chLines) lines.push(l);
    }
  }

  // Step 5c: Generate <request> single-shot async fetch initialization (§6.7.7).
  // §60.4 — also handles `<request api="endpointName">` (typed external API);
  // the endpoint registry is built once from the file's `<api>` decls.
  if (requestNodes.length > 0) {
    // Deep-walked api-decl set (classifyMarkupNodes descends into <program>/
    // <page>/engine bodies) — getNodes() top-level-only missed a wrapped <api>.
    const apiEndpoints = buildApiEndpointRegistry(apiDeclNodes);
    lines.push("");
    lines.push("// --- request async fetch initialization (§6.7.7, compiler-generated) ---");
    for (const rqNode of requestNodes) {
      const rqLines = emitRequestNode(rqNode, errors, fileAST.filePath ?? "", apiEndpoints);
      for (const l of rqLines) lines.push(l);
    }
  }

  // Step 5d: Generate <timeout> single-shot timer initialization (§6.7.8)
  if (timeoutNodes.length > 0) {
    lines.push("");
    lines.push("// --- timeout single-shot timer initialization (§6.7.8, compiler-generated) ---");
    for (const toNode of timeoutNodes) {
      const toLines = emitTimeoutNode(toNode, errors, fileAST.filePath ?? "");
      for (const l of toLines) lines.push(l);
    }
  }

  // Step 6: Generate CSS variable bridge
  const cssBridges = ctx.analysis?.cssBridges ?? collectCssVariableBridges(getNodes(fileAST));
  if (cssBridges.length > 0) {
    lines.push("");
    lines.push("// --- CSS variable bridge (compiler-generated) ---");

    for (const bridge of cssBridges) {
      const target = bridge.scoped
        ? `_scrml_el`
        : `document.documentElement`;

      if (bridge.isExpression) {
        const exprJs: string = bridge.expr.replace(
          /@([A-Za-z_$][A-Za-z0-9_$]*)/g,
          `_scrml_reactive_get("$1")`
        );
        const evalFn = genVar("css_expr");
        lines.push(`function ${evalFn}() { return ${exprJs}; }`);
        lines.push(`${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, ${evalFn}());`);
        if (bridge.refs.length > 0) {
          lines.push(`_scrml_effect(() => ${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, ${evalFn}()));`);
        }
      } else {
        lines.push(`${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, _scrml_reactive_get(${JSON.stringify(bridge.varName)}));`);
        lines.push(`_scrml_effect(() => ${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, _scrml_reactive_get(${JSON.stringify(bridge.varName)})));`);
      }
    }
  }

  // Step 7: Generate bind: prop bidirectional wiring (§15.11.1)
  if (bindPropsWirings.length > 0) {
    lines.push("");
    lines.push("// --- bind: prop bidirectional wiring (compiler-generated) ---");
    for (const { propName, callerVar, componentName } of bindPropsWirings) {
      const guardVar = genVar("bind_sync");
      const propJs = JSON.stringify(propName);
      const callerJs = JSON.stringify(callerVar);
      lines.push(`// bind:${propName}=@${callerVar} (from ${componentName})`);
      lines.push(`let ${guardVar} = false;`);
      lines.push(`_scrml_effect(function() {`);
      lines.push(`  const _v = _scrml_reactive_get(${callerJs});`);
      lines.push(`  if (${guardVar}) return; ${guardVar} = true;`);
      lines.push(`  _scrml_reactive_set(${propJs}, _v);`);
      lines.push(`  ${guardVar} = false;`);
      lines.push(`});`);
      lines.push(`_scrml_effect(function() {`);
      lines.push(`  const _v = _scrml_reactive_get(${propJs});`);
      lines.push(`  if (${guardVar}) return; ${guardVar} = true;`);
      lines.push(`  _scrml_reactive_set(${callerJs}, _v);`);
      lines.push(`  ${guardVar} = false;`);
      lines.push(`});`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// navigate-wave1b #5 — persistent-shell cell membership
// ---------------------------------------------------------------------------

/**
 * Collect the names of PROGRAM-TOP-LEVEL (shell) cells — `state-decl`s declared
 * OUTSIDE any `<outlet>`/`<page>` region — so the soft-nav rehydrate seed-apply
 * can SKIP re-seeding them (finding #5). A shell cell (a nav counter, a sidebar
 * toggle) belongs to the persistent `<program>` shell that survives a soft nav;
 * re-applying the fetched route's SSR-initial value would RESET a value the user
 * mutated. A cell declared INSIDE the outlet/page IS route-scoped and re-seeds
 * with the new route's values on every swap.
 *
 * The walk mirrors `classifyMarkupNodes`'s `insideOutlet` region tracking, but
 * (a) descends into `logic` bodies (where `state-decl`s live — the classifier
 * SKIPS them) and (b) treats `<outlet>` AND `<page>` as region boundaries.
 * Membership is COMPILE-TIME only — no runtime shortcut (per the finding).
 */
function collectShellCellNames(fileAST: any): Set<string> {
  const shell = new Set<string>();
  function visit(nodeList: any[], insideRegion: boolean): void {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      // A cell declared OUTSIDE any outlet/page region is a shell cell.
      if (node.kind === "state-decl" && node.name && !insideRegion) {
        shell.add(node.name as string);
      }
      // An <outlet>/<page> subtree is route-scoped: descend with the region bit set.
      let childRegion = insideRegion;
      if (node.kind === "markup") {
        const tag: string = node.tag ?? "";
        if (tag === "outlet" || tag === "page") childRegion = true;
      }
      if (node.kind === "logic" && Array.isArray(node.body)) visit(node.body, insideRegion);
      if (Array.isArray(node.children)) visit(node.children, childRegion);
      if (node.kind === "engine-decl" && Array.isArray((node as any).bodyChildren)) {
        visit((node as any).bodyChildren, insideRegion);
      }
      // Control-flow bodies carry the region bit unchanged.
      if (node.kind === "match-stmt" && Array.isArray((node as any).body)) visit((node as any).body, insideRegion);
      if (node.kind === "if-stmt") {
        if (Array.isArray((node as any).consequent)) visit((node as any).consequent, insideRegion);
        if (Array.isArray((node as any).alternate)) visit((node as any).alternate, insideRegion);
      }
    }
  }
  visit(getNodes(fileAST), false);
  return shell;
}

/**
 * Does the file contain an `<outlet>` anywhere in its markup? Soft-nav (and thus
 * the `_scrml_shell_cells` skip) is only applicable to a `<program>` shell with a
 * swap region, so `_scrml_shell_cells` is emitted only when an outlet is present.
 */
function fileHasOutlet(fileAST: any): boolean {
  let found = false;
  function visit(nodeList: any[]): void {
    if (found || !Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      if (found) return;
      if (!node || typeof node !== "object") continue;
      if (node.kind === "markup" && node.tag === "outlet") { found = true; return; }
      if (Array.isArray(node.children)) visit(node.children);
      if (node.kind === "engine-decl" && Array.isArray((node as any).bodyChildren)) visit((node as any).bodyChildren);
    }
  }
  visit(getNodes(fileAST));
  return found;
}

// ---------------------------------------------------------------------------
// Single-pass markup classification (replaces 5 independent AST walks)
// ---------------------------------------------------------------------------

interface WiringCollections {
  lifecycleNodes: any[];
  inputStateNodes: any[];
  requestNodes: any[];
  apiDeclNodes: any[];
  timeoutNodes: any[];
  bindPropsWirings: BindPropsWiring[];
}

/**
 * Walk the AST once and classify markup nodes into all 5 wiring buckets.
 *
 * Behavioral notes:
 * - Skips kind === "logic" block children (matches collectLifecycleNodes and
 *   collectInputStateNodes, the dominant behavior of 4/5 original collectors).
 * - _bindProps can appear on ANY markup node, not exclusive with tag classification.
 * - Valid scrml does not place timer/poll/request/timeout inside logic blocks,
 *   so the logic-block skip is safe for all well-formed AST.
 */
function classifyMarkupNodes(nodes: any[]): WiringCollections {
  const result: WiringCollections = {
    lifecycleNodes: [],
    inputStateNodes: [],
    requestNodes: [],
    apiDeclNodes: [],
    timeoutNodes: [],
    bindPropsWirings: [],
  };

  function visit(nodeList: any[], insideOutlet = false): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      if (node.kind === "markup") {
        const tag: string = node.tag ?? "";
        // navigate-wave1b M1 Phase 4 — an <outlet> descendant is region-resident:
        // a <timer>/<poll> lexically inside the outlet belongs to the swappable
        // region, so its cleanup routes into _scrml_region_cleanups (torn down on
        // soft nav), not the boot-once beforeunload path. A shell-level timer
        // (outside the outlet) keeps the module-init path untouched.
        const childInsideOutlet = insideOutlet || tag === "outlet";

        if (tag === "timer" || tag === "poll") {
          if (insideOutlet) node._outletResident = true;
          result.lifecycleNodes.push(node);
        } else if (tag === "keyboard" || tag === "mouse" || tag === "gamepad") {
          result.inputStateNodes.push(node);
        } else if (tag === "request") {
          result.requestNodes.push(node);
        } else if (tag === "timeout") {
          result.timeoutNodes.push(node);
        }

        // bindProps is not exclusive — any markup node can have _bindProps
        if (Array.isArray(node._bindProps) && node._bindProps.length > 0) {
          const componentName: string = node._expandedFrom ?? node.tag ?? "unknown";
          for (const { propName, callerVar } of node._bindProps) {
            result.bindPropsWirings.push({ propName, callerVar, componentName });
          }
        }

        // Recurse into markup children (carry the outlet-residence flag).
        if (Array.isArray(node.children)) {
          visit(node.children, childInsideOutlet);
        }
        continue;
      }

      // §60.4 'api-decl' nodes are NOT kind==="markup" (they are their own
      // top-level kind), and they nest inside the '<program>'/'<page>' markup
      // subtree in the canonical app shape. Collect them here so emitRequestNode's
      // api= mode can build its endpoint registry from the DEEP-walked set
      // (getNodes() returns only top-level nodes, so a wrapped <api> was missed).
      if (node.kind === "api-decl") {
        result.apiDeclNodes.push(node);
        continue;
      }

      // Skip logic block children — reactive-wiring nodes are not inside logic blocks
      if (node.kind === "logic" && Array.isArray(node.body)) {
        continue;
      }

      // Phase A10 (S78, 2026-05-10) — descend into engine-decl.bodyChildren
      // so reactive-wiring nodes (lifecycle <timer>/<poll>, input-state
      // <keyboard>/<mouse>/<gamepad>, <request>, <timeout>, _bindProps)
      // INSIDE engine state-child bodies are discovered. Without this
      // branch, non-renderable wiring elements declared inside arm bodies
      // would be silently dropped.
      //
      // Per PHASE-0-SURVEY §3 walker-affected list: this is the
      // recursive descent for emit-reactive-wiring's `classifyMarkupNodes`
      // pass. Body-render itself is emitted via the dispatcher in
      // emit-engine.ts; this branch is only for OTHER reactive surfaces
      // that may incidentally appear inside arm bodies.
      if (node.kind === "engine-decl" && Array.isArray((node as any).bodyChildren)) {
        visit((node as any).bodyChildren, insideOutlet);
        continue;
      }

      // Recurse into all other node kinds
      if (Array.isArray(node.children)) {
        visit(node.children, insideOutlet);
      }
    }
  }

  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle node emission
// ---------------------------------------------------------------------------

function emitLifecycleNode(node: any, errors: CGError[], filePath: string): string[] {
  const lines: string[] = [];
  const tag: string = node.tag ?? "timer";
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const children: any[] = node.children ?? [];
  const span = node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  const intervalAttr = attrMap.get("interval");
  let intervalMs: number | null = null;
  if (intervalAttr) {
    const v = intervalAttr.value;
    if (v?.kind === "string-literal") {
      intervalMs = parseInt(v.value, 10);
    } else if (v?.kind === "variable-ref") {
      const raw: string = (v.name ?? "").replace(/^@/, "");
      intervalMs = parseInt(raw, 10);
    }
  }

  if (intervalMs === null || isNaN(intervalMs) || intervalMs <= 0) {
    intervalMs = 1000;
  }

  const idAttr = attrMap.get("id");
  let timerId: string | null = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind === "string-literal") timerId = v.value;
    else if (v?.kind === "variable-ref") timerId = (v.name ?? "").replace(/^@/, "");
  }

  const timerVar = timerId ? `"${timerId}"` : JSON.stringify(genVar("timer"));
  const scopeVar = JSON.stringify(genVar("scope"));

  const runningAttr = attrMap.get("running");
  let runningVarName: string | null = null;
  let runningIsAlwaysTrue = true;
  if (runningAttr) {
    const v = runningAttr.value;
    if (v?.kind === "variable-ref") {
      const raw: string = v.name ?? "";
      if (raw.startsWith("@")) {
        runningVarName = raw.slice(1);
        runningIsAlwaysTrue = false;
      } else if (raw === "true") {
        runningIsAlwaysTrue = true;
      } else if (raw === "false") {
        runningIsAlwaysTrue = false;
      }
    }
  }

  let bodyCode = "/* empty */";
  const logicChild = children.find((c: any) => c?.kind === "logic");
  if (logicChild && Array.isArray(logicChild.body) && logicChild.body.length > 0) {
    const bodyLines: string[] = [];
    for (const stmt of logicChild.body) {
      const code = emitLogicNode(stmt);
      if (code) bodyLines.push(code);
    }
    bodyCode = bodyLines.join("\n  ");
  }

  lines.push(`// <${tag}${timerId ? ` id="${timerId}"` : ""}> interval=${intervalMs}ms`);
  lines.push(`_scrml_timer_start(${scopeVar}, ${timerVar}, ${intervalMs}, function() {`);
  lines.push(`  ${bodyCode}`);
  lines.push(`});`);

  if (!runningIsAlwaysTrue && !runningVarName) {
    lines.push(`_scrml_timer_pause(${scopeVar}, ${timerVar});`);
  }

  if (runningVarName) {
    const varJs = JSON.stringify(runningVarName);
    lines.push(`if (!_scrml_reactive_get(${varJs})) { _scrml_timer_pause(${scopeVar}, ${timerVar}); }`);
    lines.push(`_scrml_effect(function() {`);
    lines.push(`  if (_scrml_reactive_get(${varJs})) { _scrml_timer_resume(${scopeVar}, ${timerVar}); } else { _scrml_timer_pause(${scopeVar}, ${timerVar}); }`);
    lines.push(`});`);
  }

  // navigate-wave1b M1 Phase 4 — an OUTLET-RESIDENT <timer>/<poll> belongs to the
  // swappable region: route its stop into `_scrml_region_cleanups` so a soft nav
  // AWAY tears it down (`_scrml_teardown_region` drains it), closing the leak
  // where the old route's timer keeps ticking against detached cells. A
  // SHELL-level timer keeps the boot-once `_scrml_register_cleanup` (beforeunload)
  // path so it survives navigation. (Restart-on-return for the region timer rides
  // §20.8.4 fresh-per-visit re-hydrate — a bounded follow-on; the leak is closed.)
  if (node && node._outletResident) {
    lines.push(`if (typeof _scrml_region_cleanups !== "undefined") { _scrml_region_cleanups.push(() => _scrml_timer_stop(${scopeVar}, ${timerVar})); } else { _scrml_register_cleanup(() => _scrml_timer_stop(${scopeVar}, ${timerVar})); }`);
  } else {
    lines.push(`_scrml_register_cleanup(() => _scrml_timer_stop(${scopeVar}, ${timerVar}));`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Input state node emission
// ---------------------------------------------------------------------------

function emitInputStateNode(node: any, errors: CGError[], filePath: string): string[] {
  const lines: string[] = [];
  const tag: string = node.tag ?? "keyboard";
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const span = node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  const idAttr = attrMap.get("id");
  let inputId: string | null = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind === "string-literal") inputId = v.value;
    else if (v?.kind === "variable-ref") inputId = (v.name ?? "").replace(/^@/, "");
  }

  const inputIdJs = inputId ? JSON.stringify(inputId) : JSON.stringify(genVar("input"));
  const scopeVar = JSON.stringify(genVar("scope"));

  if (tag === "keyboard") {
    lines.push(`// <keyboard${inputId ? ` id="${inputId}"` : ""}>`);
    lines.push(`_scrml_input_keyboard_create(${inputIdJs}, ${scopeVar});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_keyboard_destroy(${inputIdJs}, ${scopeVar}));`);
  } else if (tag === "mouse") {
    const targetAttr = attrMap.get("target");
    let targetExpr = "null";
    if (targetAttr) {
      const v = targetAttr.value;
      if (v?.kind === "variable-ref") {
        const raw: string = (v.name ?? "").replace(/^@/, "");
        targetExpr = `() => _scrml_reactive_get(${JSON.stringify(raw)})`;
      }
    }
    lines.push(`// <mouse${inputId ? ` id="${inputId}"` : ""}${targetAttr ? " target=..." : ""}>`);
    lines.push(`_scrml_input_mouse_create(${inputIdJs}, ${scopeVar}, ${targetExpr});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_mouse_destroy(${inputIdJs}, ${scopeVar}));`);
  } else if (tag === "gamepad") {
    const indexAttr = attrMap.get("index");
    let gamepadIndex = 0;
    if (indexAttr) {
      const v = indexAttr.value;
      if (v?.kind === "string-literal") {
        const n = parseInt(v.value, 10);
        if (!isNaN(n) && n >= 0 && n <= 3) gamepadIndex = n;
      } else if (v?.kind === "variable-ref") {
        const n = parseInt((v.name ?? "").replace(/^@/, ""), 10);
        if (!isNaN(n) && n >= 0 && n <= 3) gamepadIndex = n;
      }
    }
    lines.push(`// <gamepad${inputId ? ` id="${inputId}"` : ""} index=${gamepadIndex}>`);
    lines.push(`_scrml_input_gamepad_create(${inputIdJs}, ${scopeVar}, ${gamepadIndex});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_gamepad_destroy(${inputIdJs}, ${scopeVar}));`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// <api> endpoint registry (§60.2 / §60.4) — read by emitRequestNode's api= mode
// ---------------------------------------------------------------------------

/**
 * A single `<api>` endpoint, flattened for codegen: the base URL it inherits
 * from its enclosing `<api base=>` block plus the endpoint's own method / path /
 * request-shape / resolved response enum (the W3 typer annotation, §60.5).
 */
interface ApiEndpointForEmit {
  base: string;
  method: string;
  path: string;            // verbatim path template; `${param}` substituted at runtime
  reqShape: string | null;
  responseEnum: ParseVariantEnumLike | null; // null -> no parseVariant decode (raw body)
}

/**
 * Build the file's `<api>` endpoint registry (§60.4 "in-scope `<api>` endpoints").
 * Endpoints across every top-level `api-decl` node share one name space; the
 * first declaration of a name wins (matching the W3 typer's endpointRegistry).
 * `base` is carried down from the endpoint's `<api>` block opener.
 */
function buildApiEndpointRegistry(topNodes: any[]): Map<string, ApiEndpointForEmit> {
  const registry = new Map<string, ApiEndpointForEmit>();
  for (const node of topNodes) {
    if (!node || typeof node !== "object" || node.kind !== "api-decl") continue;
    const base: string | null = typeof node.base === "string" ? node.base : null;
    if (base === null) continue; // E-API-BASE-MISSING already fired (W2); skip
    const eps: any[] = Array.isArray(node.endpoints) ? node.endpoints : [];
    for (const ep of eps) {
      if (!ep || typeof ep.name !== "string" || ep.name.length === 0) continue;
      if (registry.has(ep.name)) continue;
      const responseEnum =
        ep.responseEnum && ep.responseEnum.kind === "enum"
          ? (ep.responseEnum as ParseVariantEnumLike)
          : null;
      registry.set(ep.name, {
        base,
        method: typeof ep.method === "string" ? ep.method : "GET",
        path: typeof ep.path === "string" ? ep.path : "",
        reqShape: typeof ep.reqShape === "string" ? ep.reqShape : null,
        responseEnum,
      });
    }
  }
  return registry;
}

/**
 * Lower a §60.2 endpoint path template (verbatim `${param}` markers) into a JS
 * string expression that concatenates `base` with the path, substituting each
 * `${param}` for the corresponding field of the args object.
 *
 * Each `${id}` references a field of the endpoint's request shape (§60.2 — the
 * value substituted into the URL at the call boundary; W3's
 * E-API-PATH-PARAM-UNBOUND already verified each param is a declared field).
 * `argsVar` is the local holding the runtime args object bound by
 * `<request args=@cell>`. The field value is URL-encoded so a path segment
 * cannot break the URL.
 */
function emitApiUrlExpr(base: string, path: string, argsVar: string): string {
  const parts: string[] = [];
  const re = /\$\{\s*([^}]*?)\s*\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const literal = path.slice(last, m.index);
    parts.push(JSON.stringify(literal));
    const inner = (m[1] ?? "").trim();
    // A path param keys on the leading identifier of the `${...}` (e.g.
    // `${user.id}` -> field `user`), mirroring the W3 pathParamNames rule.
    const lead = inner.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    const field = lead ? lead[0] : inner;
    parts.push(`encodeURIComponent(String(${argsVar}[${JSON.stringify(field)}]))`);
    last = m.index + m[0].length;
  }
  parts.push(JSON.stringify(path.slice(last)));
  return `${JSON.stringify(base)} + ${parts.join(" + ")}`;
}

// ---------------------------------------------------------------------------
// Request node emission (§6.7.7)
// ---------------------------------------------------------------------------

function extractRequestId(node: any): string | null {
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  for (const a of attrs) {
    if (a?.name !== "id") continue;
    const v = a.value;
    if (v?.kind === "string-literal" && typeof v.value === "string") return v.value;
    if (v?.kind === "variable-ref") return (v.name ?? "").replace(/^@/, "");
    if (typeof v === "string") return v;
    if (typeof v?.value === "string") return v.value;
  }
  return null;
}

function emitRequestNode(node: any, errors: CGError[], filePath: string, apiEndpoints: Map<string, ApiEndpointForEmit>): string[] {
  const lines: string[] = [];
  const attrs: any[] = node.attrs ?? node.attributes ?? [];

  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  const idAttr = attrMap.get("id");
  let requestId: string | null = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind === "string-literal") requestId = v.value;
    else if (v?.kind === "variable-ref") requestId = (v.name ?? "").replace(/^@/, "");
    else if (typeof v === "string") requestId = v;
  }

  if (!requestId) return lines;

  // ----------------------------------------------------------------------
  // §60.4 — `<request api="endpointName" args=@cell>` mode. The endpoint's
  // declared base/method/path/responseType drive a thin typed fetch + an
  // automatic parseVariant decode (§60.5). This is a PURE-CLIENT fetch
  // (§60.6) — no server bundle, no .server.js. LIMIT-PRIMITIVES (§60.7): a
  // single fetch + decode, NO retry / cache / pagination / interceptors.
  // ----------------------------------------------------------------------
  const apiAttr = attrMap.get("api");
  if (apiAttr) {
    const av = apiAttr.value;
    const endpointName =
      av?.kind === "string-literal" ? av.value
      : typeof av === "string" ? av
      : typeof av?.value === "string" ? av.value
      : null;
    const endpoint = endpointName ? apiEndpoints.get(endpointName) : null;
    // An unknown endpoint already fired E-API-ENDPOINT-UNKNOWN (W3); emit
    // nothing rather than a broken fetch.
    if (!endpoint) return lines;

    // args=@cell — the request shape value. Bound by reference to a reactive
    // cell so the URL path-params + (body-method) request body read its
    // fields at call time.
    const argsAttr = attrMap.get("args");
    let argsVarName: string | null = null;
    if (argsAttr) {
      const va = argsAttr.value;
      if (va?.kind === "variable-ref") argsVarName = (va.name ?? "").replace(/^@/, "");
      else if (typeof va === "string") argsVarName = va.replace(/^@/, "");
    }

    const stateVar = `_scrml_request_${requestId}`;
    const fetchFn = `_scrml_request_${requestId}_fetch`;
    const seqVar = `_scrml_request_${requestId}_seq`;
    const mountedVar = `_scrml_request_${requestId}_mounted`;
    const method = endpoint.method;
    const carriesBody = method === "POST" || method === "PUT" || method === "PATCH";

    lines.push(`// <request id="${requestId}" api="${endpointName}"> (§60.4 — typed external API)`);
    lines.push(`// ${stateVar} declared+initialized in the hoisted request-state pass above (§6.7.7).`);
    lines.push(`var ${seqVar} = 0;`);
    lines.push(`var ${mountedVar} = true;`);
    lines.push(`async function ${fetchFn}() {`);
    lines.push(`  var _seq = ++${seqVar};`);
    // Read the args object once per call (the path-param / body source).
    if (argsVarName !== null) {
      lines.push(`  var _args = _scrml_reactive_get(${JSON.stringify(argsVarName)});`);
    } else {
      lines.push(`  var _args = {};`);
    }
    const urlExpr = emitApiUrlExpr(endpoint.base, endpoint.path, "_args");
    lines.push(`  ${stateVar}.loading = true;`);
    lines.push(`  ${stateVar}.error = null;`);
    lines.push(`  if (${stateVar}.data !== null) { ${stateVar}.stale = true; }`);
    lines.push(`  try {`);
    // Request init: method always; body for body-carrying methods (the args
    // object serialized as JSON, §60.4 — the args value IS the request shape).
    if (carriesBody) {
      lines.push(`    var _res = await fetch(${urlExpr}, {`);
      lines.push(`      method: ${JSON.stringify(method)},`);
      lines.push(`      headers: { "Content-Type": "application/json" },`);
      lines.push(`      body: JSON.stringify(_args),`);
      lines.push(`    });`);
    } else {
      lines.push(`    var _res = await fetch(${urlExpr}, { method: ${JSON.stringify(method)} });`);
    }
    lines.push(`    if (!_res.ok) throw new Error("HTTP " + _res.status);`);
    lines.push(`    var _body = await _res.json();`);
    lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
    if (endpoint.responseEnum) {
      // §60.5 — decode the wire body via parseVariant against the endpoint's
      // declared `: ResponseT`. A decode failure is a `::ParseError` fail
      // object; route it to `.error` so a consuming `::ParseError` arm sees it.
      const decoded = emitParseVariantDecodeIIFE(endpoint.responseEnum, "_body");
      lines.push(`    var _decoded = ${decoded};`);
      lines.push(`    if (_decoded && _decoded.__scrml_error === true) {`);
      lines.push(`      ${stateVar}.error = _decoded;`);
      lines.push(`    } else {`);
      lines.push(`      ${stateVar}.data = _decoded;`);
      lines.push(`    }`);
    } else {
      // Non-enum response type (or none resolved): land the raw JSON body. A
      // struct/refinement response is decoded by the §53.4 SPARK boundary at
      // the consuming assignment, not here (§60.5).
      lines.push(`    ${stateVar}.data = _body;`);
    }
    lines.push(`  } catch (_e) {`);
    lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
    lines.push(`    ${stateVar}.error = _e;`);
    lines.push(`  }`);
    lines.push(`  ${stateVar}.loading = false;`);
    lines.push(`  ${stateVar}.stale = false;`);
    lines.push(`}`);
    lines.push(`${stateVar}.refetch = ${fetchFn};`);
    lines.push(`_scrml_register_cleanup(function() { ${mountedVar} = false; });`);
    // Re-fetch when the args cell changes (the request's reactive dependency,
    // §6.7.7 — mirrors the url-mode deps= effect, but the dep is the args cell).
    if (argsVarName !== null) {
      lines.push(`_scrml_effect(function() {`);
      lines.push(`  var _d = _scrml_reactive_get(${JSON.stringify(argsVarName)});`);
      lines.push(`  if (${mountedVar}) ${fetchFn}();`);
      lines.push(`});`);
    } else {
      lines.push(`${fetchFn}();`);
    }
    return lines;
  }

  const urlAttr = attrMap.get("url");
  let urlExpr = '""';
  let hasUrl = false;
  if (urlAttr) {
    const v = urlAttr.value;
    if (v?.kind === "string-literal") { urlExpr = JSON.stringify(v.value); hasUrl = true; }
    else if (typeof v === "string") { urlExpr = JSON.stringify(v); hasUrl = true; }
    else if (typeof v?.value === "string") { urlExpr = JSON.stringify(v.value); hasUrl = true; }
  }

  // GITI-001 (giti inbound 2026-04-20): without a `url=` attribute, the
  // `<request>` tag previously emitted a full fetch machinery with empty URL
  // — runtime noise that fired on mount and failed silently. When the tag is
  // used as a wrapper around a body that calls a server fn directly (the
  // common case: `<request id="x">\${ @data = serverFn() }</>`) the body is
  // already the fetch. Skip the compiler-generated fetch emission entirely
  // when url= is absent.
  if (!hasUrl) return lines;

  const depsAttr = attrMap.get("deps");
  const depsVars: string[] = [];
  if (depsAttr) {
    const v = depsAttr.value;
    if (v?.kind === "array" && Array.isArray(v.elements)) {
      for (const el of v.elements) {
        if (el?.kind === "variable-ref") depsVars.push((el.name ?? "").replace(/^@/, ""));
      }
    } else if (typeof v?.value === "string") {
      const matches = v.value.matchAll(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
      for (const m of matches) depsVars.push(m[1]);
    }
  }

  const methodAttr = attrMap.get("method");
  let method = "GET";
  if (methodAttr) {
    const v = methodAttr.value;
    if (v?.kind === "string-literal") method = v.value;
    else if (typeof v === "string") method = v;
    else if (typeof v?.value === "string") method = v.value;
  }

  const stateVar = `_scrml_request_${requestId}`;
  const fetchFn = `_scrml_request_${requestId}_fetch`;
  const seqVar = `_scrml_request_${requestId}_seq`;
  const mountedVar = `_scrml_request_${requestId}_mounted`;

  lines.push(`// <request id="${requestId}">`);
    lines.push(`// ${stateVar} declared+initialized in the hoisted request-state pass above (§6.7.7).`);
  lines.push(`var ${seqVar} = 0;`);
  lines.push(`var ${mountedVar} = true;`);
  lines.push(`async function ${fetchFn}() {`);
  lines.push(`  var _seq = ++${seqVar};`);
  lines.push(`  ${stateVar}.loading = true;`);
  lines.push(`  ${stateVar}.error = null;`);
  lines.push(`  if (${stateVar}.data !== null) { ${stateVar}.stale = true; }`);
  lines.push(`  try {`);
  lines.push(`    var _res = await fetch(${urlExpr}, { method: ${JSON.stringify(method)} });`);
  lines.push(`    if (!_res.ok) throw new Error("HTTP " + _res.status);`);
  lines.push(`    var _data = await _res.json();`);
  lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
  lines.push(`    ${stateVar}.data = _data;`);
  lines.push(`  } catch (_e) {`);
  lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
  lines.push(`    ${stateVar}.error = _e;`);
  lines.push(`  }`);
  lines.push(`  ${stateVar}.loading = false;`);
  lines.push(`  ${stateVar}.stale = false;`);
  lines.push(`}`);
  lines.push(`${stateVar}.refetch = ${fetchFn};`);
  lines.push(`_scrml_register_cleanup(function() { ${mountedVar} = false; });`);

  if (depsVars.length > 0) {
    const depsJs = depsVars.map(d => `_scrml_reactive_get(${JSON.stringify(d)})`).join(", ");
    lines.push(`_scrml_effect(function() {`);
    lines.push(`  var _d = [${depsJs}];`);
    lines.push(`  if (${mountedVar}) ${fetchFn}();`);
    lines.push(`});`);
  } else {
    lines.push(`${fetchFn}();`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Timeout node emission (§6.7.8)
// ---------------------------------------------------------------------------

function emitTimeoutNode(node: any, errors: CGError[], filePath: string): string[] {
  const lines: string[] = [];
  const attrs: any[] = node.attrs ?? node.attributes ?? [];
  const children: any[] = node.children ?? [];

  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  // Extract delay attribute
  const delayAttr = attrMap.get("delay");
  let delayMs: number | null = null;
  if (delayAttr) {
    const v = delayAttr.value;
    if (v?.kind === "string-literal") {
      delayMs = parseInt(v.value, 10);
    } else if (v?.kind === "variable-ref") {
      const raw: string = (v.name ?? "").replace(/^@/, "");
      delayMs = parseInt(raw, 10);
    }
  }
  if (delayMs === null || isNaN(delayMs) || delayMs <= 0) {
    delayMs = 1000; // fallback (error already reported in emit-html)
  }

  // Extract id attribute
  const idAttr = attrMap.get("id");
  let timeoutId: string | null = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind === "string-literal") timeoutId = v.value;
    else if (v?.kind === "variable-ref") timeoutId = (v.name ?? "").replace(/^@/, "");
  }

  const timerVar = genVar("timeout");

  // Extract body code from logic children
  let bodyCode = "";
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    if (child.kind === "logic" && Array.isArray(child.body)) {
      const bodyLines: string[] = [];
      for (const stmt of child.body) {
        const code = emitLogicNode(stmt);
        if (code) bodyLines.push(code);
      }
      bodyCode = bodyLines.join("\n    ");
    }
  }

  lines.push(`// <timeout${timeoutId ? ` id="${timeoutId}"` : ""} delay=${delayMs}>`);

  // Emit the setTimeout call
  lines.push(`var ${timerVar} = setTimeout(function() {`);
  if (bodyCode) {
    lines.push(`    ${bodyCode}`);
  }
  if (timeoutId) {
    lines.push(`    _scrml_reactive_set(${JSON.stringify(timeoutId + "_fired")}, true);`);
  }
  lines.push(`}, ${delayMs});`);

  // Emit cancel function and initial fired state if id is present
  if (timeoutId) {
    lines.push(`_scrml_reactive_set(${JSON.stringify(timeoutId + "_fired")}, false);`);
    lines.push(`function ${timeoutId}_cancel() { clearTimeout(${timerVar}); }`);
  }

  // Register scope cleanup — cancel timeout on teardown (§6.7.2, step 2)
  lines.push(`_scrml_register_cleanup(function() { clearTimeout(${timerVar}); });`);

  return lines;
}

// (§52.6 collectServerVarDecls moved to collect.ts for cross-module sharing)
