import { genVar } from "./var-counter.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import { emitLogicNode } from "./emit-logic.js";
import { CGError } from "./errors.ts";
import {
  collectTopLevelLogicStatements,
  collectCssVariableBridges,
  getNodes,
  isServerOnlyNode,
  collectServerVarDecls,
  callableServerVarDecls,
} from "./collect.ts";
import { collectDerivedVarNames } from "./reactive-deps.ts";
import { collectChannelNodes, emitChannelClientJs } from "./emit-channel.ts";
import { emitInitialLoad, emitOptimisticUpdate, emitServerSyncStub, emitUnifiedMountHydrate } from "./emit-sync.ts";
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

  // Walk the AST to find reactive-decl nodes with machineBinding annotation
  const nodes: any[] = fileAST.nodes ?? fileAST.ast?.nodes ?? [];
  function walk(nodeList: any[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "logic" && Array.isArray(node.body)) {
        for (const child of node.body) {
          if (child && child.kind === "state-decl" && child.machineBinding) {
            const engineName: string = child.machineBinding;
            const machine = machineRegistry.get(engineName);
            if (machine && child.name) {
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
  const machineBindings = buildMachineBindingsMap(fileAST);
  const emitOpts: { derivedNames?: Set<string>; encodingCtx?: typeof encodingCtx; machineBindings?: typeof machineBindings } = derivedNames.size > 0
    ? { derivedNames, encodingCtx, ...(machineBindings ? { machineBindings } : {}) }
    : { encodingCtx, ...(machineBindings ? { machineBindings } : {}) };

  // Step 4a: Generate transition lookup tables for enums with transitions{} and machines (§51.5).
  // These must be emitted BEFORE top-level logic statements because reactive-decl
  // initializers with machine bindings emit transition guard IIFEs that reference
  // the table variables.
  const machineRegistry = (fileAST as any).machineRegistry as Map<string, any> | undefined;
  const typeDecls = (fileAST as any).typeDecls as any[] | undefined;
  if (typeDecls || machineRegistry) {
    const { emitTransitionTable } = require("./emit-machines.ts");
    // Emit tables for enums with type-level transitions
    if (typeDecls) {
      const { buildTypeRegistry, BUILTIN_TYPES } = require("../type-system.ts");
      const typeRegistry = buildTypeRegistry(typeDecls, [], { file: fileAST.filePath ?? "", start: 0, end: 0, line: 1, col: 1 });
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

    for (const stmt of stmts) {
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
      const code = emitLogicNode(stmt, emitOpts);
      if (code) codes.push(code);
      if (stmtContainsLift(stmt)) groupHasLift = true;
      // Check for reactive deps in the emitted code (after @var rewriting)
      if (code && code.includes("_scrml_reactive_get(")) groupHasReactiveDeps = true;
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

  // Step 4c: Generate server @var sync infrastructure (§52.6)
  const serverVarDecls = collectServerVarDecls(fileAST);
  if (serverVarDecls.length > 0) {
    lines.push("");
    lines.push("// --- server @var sync infrastructure (§52.6, compiler-generated) ---");
    // §8.11: if ≥2 callable initExprs share this page, coalesce their initial
    // loads into one /__mountHydrate fetch instead of N per-var async IIFEs.
    // Writes (optimistic update + sync stub) remain 1:1 per §8.11.3.
    const callableDecls = callableServerVarDecls(serverVarDecls);
    const coalesceMount = callableDecls.length >= 2;
    for (const decl of serverVarDecls) {
      const varName: string = decl.name as string;
      // Phase 4d: ExprNode-first, string fallback
      const initExpr: string = (decl as any).initExpr ? emitStringFromTree((decl as any).initExpr) : (typeof decl.init === "string" ? decl.init : "");
      for (const l of emitServerSyncStub(varName)) lines.push(l);
      // Emit per-var IIFE only when NOT coalescing OR when this var is not
      // callable (callable subset is handled by the unified fetch below).
      const isCallable = !!initExpr && initExpr.includes("(");
      if (!coalesceMount || !isCallable) {
        for (const l of emitInitialLoad(varName, initExpr)) lines.push(l);
      }
      for (const l of emitOptimisticUpdate(varName)) lines.push(l);
    }
    if (coalesceMount) {
      const coalescedNames = callableDecls.map((d) => d.name as string);
      for (const l of emitUnifiedMountHydrate(coalescedNames)) lines.push(l);
    }
  }

  // Single-pass classification of markup nodes (replaces 5 independent AST walks)
  const { lifecycleNodes, inputStateNodes, requestNodes, timeoutNodes, bindPropsWirings } =
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
    lines.push("");
    lines.push("// --- channel WebSocket client initialization (§35, compiler-generated) ---");
    for (const chNode of channelNodes) {
      const chLines = emitChannelClientJs(chNode, errors, fileAST.filePath ?? "");
      for (const l of chLines) lines.push(l);
    }
  }

  // Step 5c: Generate <request> single-shot async fetch initialization (§6.7.7)
  if (requestNodes.length > 0) {
    lines.push("");
    lines.push("// --- request async fetch initialization (§6.7.7, compiler-generated) ---");
    for (const rqNode of requestNodes) {
      const rqLines = emitRequestNode(rqNode, errors, fileAST.filePath ?? "");
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
// Single-pass markup classification (replaces 5 independent AST walks)
// ---------------------------------------------------------------------------

interface WiringCollections {
  lifecycleNodes: any[];
  inputStateNodes: any[];
  requestNodes: any[];
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
    timeoutNodes: [],
    bindPropsWirings: [],
  };

  function visit(nodeList: any[]): void {
    for (const node of nodeList) {
      if (!node || typeof node !== "object") continue;

      if (node.kind === "markup") {
        const tag: string = node.tag ?? "";

        if (tag === "timer" || tag === "poll") {
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

        // Recurse into markup children
        if (Array.isArray(node.children)) {
          visit(node.children);
        }
        continue;
      }

      // Skip logic block children — reactive-wiring nodes are not inside logic blocks
      if (node.kind === "logic" && Array.isArray(node.body)) {
        continue;
      }

      // Recurse into all other node kinds
      if (Array.isArray(node.children)) {
        visit(node.children);
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

  lines.push(`_scrml_register_cleanup(() => _scrml_timer_stop(${scopeVar}, ${timerVar}));`);

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
// Request node emission (§6.7.7)
// ---------------------------------------------------------------------------

function emitRequestNode(node: any, errors: CGError[], filePath: string): string[] {
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
  lines.push(`var ${stateVar} = { loading: true, data: null, error: null, stale: false };`);
  lines.push(`var ${seqVar} = 0;`);
  lines.push(`var ${mountedVar} = true;`);
  lines.push(`async function ${fetchFn}() {`);
  lines.push(`  var _seq = ++${seqVar};`);
  lines.push(`  ${stateVar}.loading = true;`);
  lines.push(`  ${stateVar}.error = null;`);
  lines.push(`  if (${stateVar}.data !== null) { ${stateVar}.stale = true; }`);
  lines.push(`  _scrml_notify(${JSON.stringify(requestId)});`);
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
  lines.push(`  _scrml_notify(${JSON.stringify(requestId)});`);
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
