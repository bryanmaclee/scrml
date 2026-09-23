import * as acorn from "acorn";
import { genVar } from "./var-counter.ts";
import { ifChainChildNodes } from "../ast-if-chain.js";
import { emitStringFromTree } from "../expression-parser.ts";
import { emitLogicNode, nodeListContainsTildeRef, setStructuralDeclNamesForFile } from "./emit-logic.js";
import { pushLiftNonKeyed, popLiftNonKeyed } from "./emit-lift.js";
import { liftScopeDeclaredNames, seedOwnConsts, seededConstFallbackCount, withSeededConstsOff } from "./declared-name-marks.ts";
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
import { collectDerivedVarNames, buildFunctionBodyRegistry, collectReactiveVarNames, collectStructuralDeclNames, type FunctionBodyRegistry } from "./reactive-deps.ts";
import { collectChannelNodes, emitChannelClientJs, parseChannelReconnect } from "./emit-channel.ts";
import { emitInitialLoad, emitUnifiedMountHydrate, emitServerAuthorityLoad, emitDeclRhsSqlLoad } from "./emit-sync.ts";
import { emitParseVariantDecodeIIFE, type ParseVariantEnumLike } from "./emit-parse-variant.ts";
import { liftEmittedStatementAwaits, emittedCodeCallsServerFn } from "./scheduling.ts";
import type { EncodingContext } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";
import type { LogicBinding, NestedLiftGroup } from "./binding-registry.ts";

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

// ---------------------------------------------------------------------------
// s427-lift-body-lowering — the mixed-case hoist must not strand a declaration
// ---------------------------------------------------------------------------

function _parseScript(js: string): any | null {
  try {
    return acorn.parse(js, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    return null;
  }
}

/** Names declared by the TOP-LEVEL statements of `js` (var/let/const — every
 *  binding of a destructuring pattern — and function/class declarations). */
function _topLevelDeclaredNames(js: string): Set<string> | null {
  const ast = _parseScript(js);
  if (!ast) return null;
  const out = new Set<string>();
  const addPattern = (p: any): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": out.add(p.name); return;
      case "ObjectPattern": for (const pr of p.properties) addPattern(pr.type === "RestElement" ? pr.argument : pr.value); return;
      case "ArrayPattern": for (const el of p.elements) addPattern(el); return;
      case "RestElement": addPattern(p.argument); return;
      case "AssignmentPattern": addPattern(p.left); return;
    }
  };
  for (const st of ast.body) {
    if (st.type === "VariableDeclaration") for (const d of st.declarations) addPattern(d.id);
    else if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) out.add(st.id.name);
  }
  return out;
}

/**
 * s427 round 2 (M1) — the FREE identifier references of `js`: every identifier
 * read or written that no declaration inside `js` itself binds at that point.
 *
 * Round 1 collected EVERY identifier and intersected it with the group's
 * top-level declarations, with no scope analysis — so a row-local
 * `const name = item.name` inside the keyed factory, sharing a name with the
 * block's `const name = @user`, read as a reference to the block-level binding
 * and demoted a working keyed list to a plain loop (row identity lost on push /
 * reverse). A name bound by a nearer declaration — a factory-local `let`/`const`,
 * a function or arrow parameter, a nested block, a nested function, a catch
 * binding, a for-loop head — is not a reference to the block-level one.
 *
 * Standard ESTree lexical scoping: `var` and function declarations hoist to the
 * nearest function scope, `let`/`const`/`class` to the nearest block; every
 * binding of a scope is visible throughout that scope (hoisting / TDZ), so
 * declarations are collected before the scope's references are resolved.
 */
function _freeNames(js: string): Set<string> | null {
  const ast = _parseScript(js);
  if (!ast) return null;
  const free = new Set<string>();
  type Scope = { names: Set<string>; parent: Scope | null };

  const patternNames = (p: any, out: Set<string>): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": out.add(p.name); return;
      case "ObjectPattern": for (const pr of p.properties) patternNames(pr.type === "RestElement" ? pr.argument : pr.value, out); return;
      case "ArrayPattern": for (const el of p.elements) patternNames(el, out); return;
      case "RestElement": patternNames(p.argument, out); return;
      case "AssignmentPattern": patternNames(p.left, out); return;
    }
  };
  /** `var` declarations and (sloppy-mode) nested function declarations of a function
   *  body, found through nested blocks but not nested functions. */
  const hoistedVarNames = (n: any, out: Set<string>): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) hoistedVarNames(c, out); return; }
    if (typeof n.type !== "string") return;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "ClassDeclaration" || n.type === "ClassExpression") return;
    if (n.type === "VariableDeclaration" && n.kind === "var") for (const d of n.declarations) patternNames(d.id, out);
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = n[k];
      if (v && typeof v === "object") hoistedVarNames(v, out);
    }
  };
  /** Block-scoped declarations DIRECTLY in a statement list. */
  const lexicalNames = (stmts: any[], out: Set<string>): void => {
    for (const st of stmts ?? []) {
      if (!st) continue;
      if (st.type === "VariableDeclaration" && st.kind !== "var") for (const d of st.declarations) patternNames(d.id, out);
      else if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) out.add(st.id.name);
    }
  };
  const resolves = (name: string, s: Scope | null): boolean => {
    for (let c = s; c; c = c.parent) if (c.names.has(name)) return true;
    return false;
  };
  const ref = (name: string, s: Scope): void => { if (!resolves(name, s)) free.add(name); };

  /** A binding pattern: its names are bound elsewhere; only defaults and computed
   *  keys are references. */
  const visitPattern = (p: any, s: Scope): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") visitPattern(pr.argument, s);
          else { if (pr.computed) visit(pr.key, s); visitPattern(pr.value, s); }
        }
        return;
      case "ArrayPattern": for (const el of p.elements) visitPattern(el, s); return;
      case "RestElement": visitPattern(p.argument, s); return;
      case "AssignmentPattern": visitPattern(p.left, s); visit(p.right, s); return;
      default: visit(p, s); // a member-expression target in an assignment pattern
    }
  };
  /** An assignment target: identifiers in it are REFERENCES (writes). */
  const visitTarget = (p: any, s: Scope): void => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": ref(p.name, s); return;
      case "ObjectPattern":
        for (const pr of p.properties) {
          if (pr.type === "RestElement") visitTarget(pr.argument, s);
          else { if (pr.computed) visit(pr.key, s); visitTarget(pr.value, s); }
        }
        return;
      case "ArrayPattern": for (const el of p.elements) visitTarget(el, s); return;
      case "RestElement": visitTarget(p.argument, s); return;
      case "AssignmentPattern": visitTarget(p.left, s); visit(p.right, s); return;
      default: visit(p, s);
    }
  };
  const blockScope = (stmts: any[], parent: Scope): Scope => {
    const names = new Set<string>();
    lexicalNames(stmts, names);
    return { names, parent };
  };
  const visitFunction = (fn: any, s: Scope): void => {
    const names = new Set<string>();
    // A named function EXPRESSION binds its own name inside itself.
    if (fn.type === "FunctionExpression" && fn.id) names.add(fn.id.name);
    for (const p of fn.params) patternNames(p, names);
    if (fn.type !== "ArrowFunctionExpression") names.add("arguments");
    const fs: Scope = { names, parent: s };
    for (const p of fn.params) visitPattern(p, fs);
    if (fn.body && fn.body.type === "BlockStatement") {
      hoistedVarNames(fn.body.body, names);
      lexicalNames(fn.body.body, names);
      for (const st of fn.body.body) visit(st, fs);
    } else {
      visit(fn.body, fs);
    }
  };
  const visitClass = (c: any, s: Scope): void => {
    const cs: Scope = { names: new Set(c.id ? [c.id.name] : []), parent: s };
    if (c.superClass) visit(c.superClass, s);
    for (const m of c.body.body) {
      if (m.computed) visit(m.key, cs);
      if (m.value) visit(m.value, cs);
      if (m.type === "StaticBlock") { const bs = blockScope(m.body, cs); for (const st of m.body) visit(st, bs); }
    }
  };

  const visit = (n: any, s: Scope): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) visit(c, s); return; }
    if (typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier": ref(n.name, s); return;
      case "MemberExpression": visit(n.object, s); if (n.computed) visit(n.property, s); return;
      case "Property":
        if (n.computed) visit(n.key, s);
        visit(n.value, s);
        return;
      case "LabeledStatement": visit(n.body, s); return;
      case "BreakStatement": case "ContinueStatement": return;
      case "MetaProperty": return;
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression":
        visitFunction(n, s); return;
      case "ClassDeclaration": case "ClassExpression": visitClass(n, s); return;
      case "VariableDeclaration":
        for (const d of n.declarations) { visitPattern(d.id, s); visit(d.init, s); }
        return;
      case "AssignmentExpression": visitTarget(n.left, s); visit(n.right, s); return;
      case "UpdateExpression": visitTarget(n.argument, s); return;
      case "BlockStatement": { const bs = blockScope(n.body, s); for (const st of n.body) visit(st, bs); return; }
      case "StaticBlock": { const bs = blockScope(n.body, s); for (const st of n.body) visit(st, bs); return; }
      case "ForStatement": {
        const fs: Scope = { names: new Set(), parent: s };
        if (n.init && n.init.type === "VariableDeclaration" && n.init.kind !== "var") for (const d of n.init.declarations) patternNames(d.id, fs.names);
        visit(n.init, fs); visit(n.test, fs); visit(n.update, fs); visit(n.body, fs);
        return;
      }
      case "ForInStatement": case "ForOfStatement": {
        const fs: Scope = { names: new Set(), parent: s };
        if (n.left.type === "VariableDeclaration") {
          if (n.left.kind !== "var") for (const d of n.left.declarations) patternNames(d.id, fs.names);
          for (const d of n.left.declarations) visitPattern(d.id, fs);
        } else {
          visitTarget(n.left, s);
        }
        visit(n.right, s);
        visit(n.body, fs);
        return;
      }
      case "SwitchStatement": {
        visit(n.discriminant, s);
        const all = n.cases.flatMap((c: any) => c.consequent);
        const ss = blockScope(all, s);
        for (const c of n.cases) { visit(c.test, ss); for (const st of c.consequent) visit(st, ss); }
        return;
      }
      case "CatchClause": {
        const cs: Scope = { names: new Set(), parent: s };
        if (n.param) { patternNames(n.param, cs.names); visitPattern(n.param, cs); }
        visit(n.body, cs);
        return;
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      const v = n[k];
      if (v && typeof v === "object") visit(v, s);
    }
  };

  // The program's own top-level declarations bind within it too (a hoisted
  // factory's `function _scrml_create_item_N(…)` is not a free reference).
  const top: Scope = { names: new Set(), parent: null };
  hoistedVarNames(ast.body, top.names);
  lexicalNames(ast.body, top.names);
  for (const st of ast.body) visit(st, top);
  return free;
}

/**
 * The mixed-case hoist (`hoistForLiftSetup`) moves a keyed for-lift's item
 * factory and render function OUT of the group's re-render `_scrml_effect`, while
 * the group's own declarations stay INSIDE it (they must re-evaluate on every
 * run). A factory that reads such a declaration —
 * `const { prefix, suffix } = @cfg; for (it of @items) { lift <li>${prefix}…</li> }`,
 * or any plain `const pre = @cfg.prefix` — then runs where that name does not
 * exist: `ReferenceError: prefix is not defined` at boot, whole page dead, compile
 * at exit 0. Returns true when the hoist would strand such a reference.
 *
 * Not reachable by keeping the setup inside the effect either: the list would be
 * rebuilt (and its static effect re-registered) on every run. Keying cannot
 * express "rows depend on a block-local that re-evaluates" at all — the rows must
 * re-render when it changes — so the caller lowers that loop plain instead, and
 * the group's effect re-runs the whole block exactly as the source reads.
 * Unparseable code (never observed) keeps the prior lowering.
 */
function mixedHoistStrandsADeclaration(combinedCode: string): boolean {
  const { hoistedSetup, remaining } = hoistForLiftSetup(combinedCode);
  if (!hoistedSetup) return false;
  const declared = _topLevelDeclaredNames(remaining);
  if (!declared || declared.size === 0) return false;
  const refs = _freeNames(hoistedSetup);
  if (!refs) return false;
  for (const n of refs) if (declared.has(n)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Lift-group emission (Step 4b)
// ---------------------------------------------------------------------------

/**
 * The parameter name a mount-deferred lift group's function receives its host
 * through. Occupies the exact position the eager
 * `document.querySelector('[data-scrml-logic="<pid>"]')` holds for an SSR-body
 * host, so both shapes come out of the one `emitLiftGroup` body.
 */
const LIFT_MOUNT_HOST_PARAM = "_scrml_lift_host";

/** The function a mount-deferred lift group is emitted as (pid is a genVar identifier). */
export function liftMountFnName(pid: string): string {
  return `_scrml_lift_mount_${pid}`;
}

/**
 * File-local driver for a mount-deferred lift group, emitted once per file that
 * has one. `host` is the freshly mounted `<span data-scrml-logic>`; `body` is the
 * group's `_scrml_lift_mount_<pid>` function.
 *
 *   - Once per host node (defensive): re-running the group on a host would lift
 *     every row a second time. Today no path reaches a host twice — the host's
 *     `_scrml_nav_rewire` block is registered BEFORE the controller of any
 *     template enclosing it (a controller's binding is added after its template
 *     body), so an outer mount pass looks for the host before an inner `if=`
 *     inserts it, and the inner pass binds it (measured: the nested-if case binds
 *     once with or without this mark). The mark keeps a later re-ordering of the
 *     rehydrator from silently duplicating rows. A re-mount clones the template
 *     afresh, so a new host never carries it.
 *   - Effect ownership, for the mount's WHOLE lifetime: the group runs with
 *     tracking wrappers in place of the two effect constructors (lexically
 *     shadowed — see the emitted function's parameters), so they apply to every
 *     effect the group's code creates, whenever it creates it — during the mount
 *     pass AND later (a keyed list builds per-row effects each time a row is
 *     added). The mount's teardown — `_scrml_region_track`, which inside a mount
 *     registers against the mount's scope, drained by `_scrml_unmount_scope` on
 *     the true→false transition — does two things:
 *       · marks the mount dead: every wrapped effect body is gated on it, so any
 *         such effect (whenever created) never runs its body again; an ordinary
 *         `_scrml_effect` that re-runs gated reads nothing and so drops all its
 *         subscriptions on that run;
 *       · disposes, immediately, every effect created during the mount pass and
 *         every `_scrml_effect_static` created at any time (a static effect keeps
 *         its first-run subscriptions forever, so the gate alone cannot release
 *         it). A plain `_scrml_effect` created AFTER the mount pass is not kept
 *         in a list — holding every per-row effect's disposer for the mount's
 *         lifetime would retain removed rows — it is released by the gate on its
 *         next trigger instead.
 *     Without this each re-mount would leave the previous mount's effects live,
 *     re-rendering into a detached subtree.
 *   - The lift target is SAVED and RESTORED around the group: a mount can happen
 *     synchronously in the middle of another lift group (that group writes a
 *     cell an `if=` condition reads), and that outer group's remaining lifts must
 *     still land in its own target.
 */
const LIFT_MOUNT_RUN_HELPER: readonly string[] = [
  "function _scrml_lift_mount_run(host, body) {",
  "  if (!host || host._scrml_lift_mounted) return;",
  "  host._scrml_lift_mounted = true;",
  "  const disposers = [];",
  "  let collecting = true;",
  "  let alive = true;",
  "  const own = (make, keepAlways) => function(fn) {",
  "    const d = make(function() { if (alive) fn(); });",
  "    if ((collecting || keepAlways) && typeof d === \"function\") disposers.push(d);",
  "    return d;",
  "  };",
  "  const prevTarget = _scrml_lift_target;",
  "  try {",
  "    body(host, own(_scrml_effect, false), own(_scrml_effect_static, true));",
  "  } finally {",
  "    collecting = false;",
  "    _scrml_lift_target = prevTarget;",
  "  }",
  "  _scrml_region_track(host, function() { alive = false; for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); disposers.length = 0; });",
  "}",
];

/**
 * g-lift-inside-each-row-or-match-arm-silently-dropped — file-local drivers for
 * a NESTED lift group (see `NestedLiftGroup` in binding-registry.ts), emitted
 * once per file that has one.
 *
 * `_scrml_lift_scoped_run(host, body, args)` is `_scrml_lift_mount_run` with the
 * teardown handed back to the caller instead of registered on a mount scope:
 * an arm is torn down by its dispatcher (the wire function's `_disposers`), a
 * row by its own effect — neither is an `if=` mount. Same ownership contract:
 * the group's two effect constructors are shadowed so every effect it creates
 * is alive-gated to this run, the mount-pass effects and every static effect
 * are disposed by the returned function, and the lift target is saved/restored.
 * It is a separate helper (not a refactor of `_scrml_lift_mount_run`) so the
 * `if=` lift output stays byte-identical.
 *
 * `_scrml_lift_item_run(host, body, args)` wraps one scoped run in an effect so
 * the group RE-RUNS against the same host when what it read synchronously
 * changes — for a row, the item's own fields (`g.items.push(…)` re-renders that
 * row, and only that row). Each re-run disposes the previous run first, so a
 * keyed list or per-element effect inside the block never accumulates. The
 * returned function disposes the effect and the current run.
 */
const NESTED_LIFT_RUN_HELPERS: readonly string[] = [
  "function _scrml_lift_scoped_run(host, body, args) {",
  "  const disposers = [];",
  "  let collecting = true;",
  "  let alive = true;",
  "  const own = (make, keepAlways) => function(fn) {",
  "    const d = make(function() { if (alive) fn(); });",
  "    if ((collecting || keepAlways) && typeof d === \"function\") disposers.push(d);",
  "    return d;",
  "  };",
  "  const prevTarget = _scrml_lift_target;",
  "  try {",
  "    body(host, own(_scrml_effect, false), own(_scrml_effect_static, true), ...args);",
  "  } finally {",
  "    collecting = false;",
  "    _scrml_lift_target = prevTarget;",
  "  }",
  "  return function() { alive = false; for (let i = disposers.length - 1; i >= 0; i--) disposers[i](); disposers.length = 0; };",
  "}",
  "function _scrml_lift_item_run(host, body, args) {",
  "  let stop = null;",
  "  const d = _scrml_effect(function() {",
  "    if (stop) { stop(); stop = null; }",
  "    host.replaceChildren();",
  "    stop = _scrml_lift_scoped_run(host, body, args);",
  "  });",
  "  return function() { d(); if (stop) { stop(); stop = null; } };",
  "}",
];

/**
 * True when `emitLiftGroup` wraps the group in an outer re-render
 * `_scrml_effect` (the whole block re-runs on every reactive change), false for
 * the two run-once shapes (non-reactive, and keyed-reconcile-only whose list
 * re-renders through its own static effect). Mirrors emitLiftGroup's decision.
 */
function liftGroupWrapsOuterEffect(combinedCode: string, groupHasReactiveDeps: boolean): boolean {
  if (!groupHasReactiveDeps) return false;
  const hasKeyedReconcile = combinedCode.includes("_scrml_reconcile_list(");
  const hasOtherReactiveReads = hasKeyedReconcile
    ? stripReconcileCalls(combinedCode).includes("_scrml_reactive_get(")
    : true;
  return !(hasKeyedReconcile && !hasOtherReactiveReads);
}

/**
 * g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template — emit a
 * lift group whose host is inside a mount-deferred `<template>`.
 *
 * `chunkOut` receives code that stays at CHUNK (file) scope, at the group's
 * source position; `mountOut` receives the body of the group's
 * `_scrml_lift_mount_<pid>(host, …)` function, run once per mount.
 *
 * Declarations keep the scope and evaluation time the SSR-body twin gives them —
 * nothing about WHERE a declaration lives changes; only render work moves:
 *
 *   - RUN-ONCE shapes (non-reactive, keyed-reconcile-only). The SSR-body twin
 *     runs every statement once, at module init, at chunk scope (so, per SPEC
 *     §7.6, its `const`/`let` are file-scope). Every statement that does NOT
 *     contain a `lift` — `const`/`let`, reactive declarations and writes,
 *     expression statements, lift-free control flow — is emitted to `chunkOut`
 *     unchanged, so it evaluates exactly when and where the twin evaluates it.
 *     Only the statements that contain a `lift` go to `mountOut`, run per mount
 *     against the mounted host.
 *
 *     ⚑ ORDER — CURRENT, KNOWN, RULING PENDING (see the S427 inbox question to
 *     bryan: §7.6 file scope vs §6.7.2.1 memoryless remount). Splitting the block
 *     changes the relative order of its statements; two consequences are pinned
 *     by tests as the current behaviour, NOT as correct:
 *       (a) a lift-free statement that reads a value WRITTEN by a lift-containing
 *           statement of the same block sees the pre-mount value (it ran at
 *           init; the lift statement runs at mount);
 *       (b) a lift-free statement placed AFTER a lift-containing statement runs
 *           BEFORE it (init precedes mount), so a lift that reads state the
 *           later statement writes sees the later value on its first render.
 *     Do not "fix" either without that ruling.
 *
 *   - OUTER-EFFECT shape (the block reads reactive state outside a keyed list).
 *     The whole block — declarations included — stays inside its re-render
 *     `_scrml_effect`, exactly as the SSR-body twin emits it (declarations are
 *     effect-local there too); the effect lives in the mount function. No
 *     declaration is hoisted: a chunk-scope `let` shared across renders turned
 *     the twin's loud failures (TDZ, duplicate-declaration codegen error) into
 *     silently wrong output, and collided with file-level imports/functions.
 */
function emitMountDeferredLiftGroup(
  chunkOut: string[],
  mountOut: string[],
  stmts: any[],
  codes: string[],
  codeStmts: any[],
  combinedCode: string,
  groupHasReactiveDeps: boolean,
): void {
  if (!liftGroupWrapsOuterEffect(combinedCode, groupHasReactiveDeps)) {
    const liftCodes: string[] = [];
    const liftStmts: any[] = [];
    for (let i = 0; i < codes.length; i++) {
      if (stmtContainsLift(codeStmts[i])) {
        liftCodes.push(codes[i]);
        liftStmts.push(codeStmts[i]);
      } else {
        chunkOut.push(codes[i]);
      }
    }
    if (liftCodes.length === 0) return;
    emitLiftGroup(mountOut, LIFT_MOUNT_HOST_PARAM, liftStmts, liftCodes.join("\n"), groupHasReactiveDeps);
    return;
  }
  emitLiftGroup(mountOut, LIFT_MOUNT_HOST_PARAM, stmts, combinedCode, groupHasReactiveDeps);
}

/**
 * Emit one lift group — the statements of a single `${ … lift … }` block whose
 * placeholder is `pid` — onto `out`, binding its target through `hostExpr`.
 *
 * `hostExpr` is the eager `document.querySelector(...)` for a host in the SSR
 * body, or `LIFT_MOUNT_HOST_PARAM` for a host inside a mount-deferred
 * `<template>` (the caller then wraps `out` in the group's mount function).
 * Everything else about the group's shape is identical between the two.
 */
function emitLiftGroup(
  out: string[],
  hostExpr: string,
  stmts: any[],
  combinedCode: string,
  groupHasReactiveDeps: boolean,
): void {
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
      out.push(`_scrml_lift_target = ${hostExpr};`);
      out.push(combinedCode);
      out.push(`_scrml_lift_target = null;`);
    } else {
      const targetVar = genVar("lift_tgt");
      const branchVar = isSingleIf ? genVar("lift_branch") : null;
      out.push(`const ${targetVar} = ${hostExpr};`);
      if (branchVar) {
        out.push(`let ${branchVar} = -1;`);
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
          out.push(hoistedSetup);
          effectBodyCode = remaining;
        }
      }

      out.push(`_scrml_effect(function() {`);
      if (branchVar) {
        // Extract the condition from the emitted if-statement to check branch identity.
        // The emitted code starts with `if (condition) {` — extract and test condition.
        const condMatch = effectBodyCode.match(/^if\s*\((.+)\)\s*\{/);
        if (condMatch) {
          out.push(`  const _branch = (${condMatch[1]}) ? 1 : 0;`);
          out.push(`  if (_branch === ${branchVar}) return;`);
          out.push(`  ${branchVar} = _branch;`);
        }
      }
      // With the mixed-case hoist in place, innerHTML clear is now safe
      // even when hasKeyedReconcile (the wrapper is outer-scope; it
      // re-mounts via the retained _scrml_lift(wrapper) in the body).
      const hoisted = hasKeyedReconcile && hasOtherReactiveReads;
      if (!hasKeyedReconcile || hoisted) {
        out.push(`  ${targetVar}.innerHTML = "";`);
      }
      out.push(`  _scrml_lift_target = ${targetVar};`);
      out.push(`  ${effectBodyCode}`);
      out.push(`  _scrml_lift_target = null;`);
      out.push(`});`);
    }
  } else {
    out.push(`_scrml_lift_target = ${hostExpr};`);
    out.push(combinedCode);
    out.push(`_scrml_lift_target = null;`);
  }
}

/** Check if an AST statement contains a lift-expr anywhere in its tree. */
export function stmtContainsLift(node: any): boolean {
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
  // g-assignment-emits-init-set-inverting-reset (§6.8) — structurally-declared
  // (`<name>`) cell names, so _emitInitThunkSidecar can skip a reset init-thunk
  // for a `@name =` REASSIGNMENT of such a cell (see emit-logic.ts).
  const structuralDeclNames = collectStructuralDeclNames(fileAST);
  // Publish to the module-level fallback so _emitInitThunkSidecar's reassignment
  // guard fires for a reassignment nested in a top-level control-flow body (whose
  // hand-picked opts do not carry structuralDeclNames — S239 F1). File-immutable.
  setStructuralDeclNamesForFile(structuralDeclNames);
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
    ? { derivedNames, ...(structuralDeclNames.size > 0 ? { structuralDeclNames } : {}), ...synthCellKeysSpread, encodingCtx, fnBodyRegistry, errors, ...(typeRegistry ? { typeRegistry } : {}), ...(machineBindings ? { machineBindings } : {}), ...(engineBindings ? { engineBindings } : {}), ...(mapVarNames.size > 0 ? { mapVarNames } : {}), ...(setVarNames.size > 0 ? { setVarNames } : {}), ...(requestIds.size > 0 ? { requestIds } : {}), ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}), ...(engineVarNames.size > 0 ? { engineVarNames } : {}), ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}), ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}), ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}), ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}), ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}), ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}), ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}) }
    : { ...(structuralDeclNames.size > 0 ? { structuralDeclNames } : {}), ...synthCellKeysSpread, encodingCtx, fnBodyRegistry, errors, ...(typeRegistry ? { typeRegistry } : {}), ...(machineBindings ? { machineBindings } : {}), ...(engineBindings ? { engineBindings } : {}), ...(mapVarNames.size > 0 ? { mapVarNames } : {}), ...(setVarNames.size > 0 ? { setVarNames } : {}), ...(requestIds.size > 0 ? { requestIds } : {}), ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}), ...(engineVarNames.size > 0 ? { engineVarNames } : {}), ...(enginesWithHooks.size > 0 ? { enginesWithHooks } : {}), ...(enginesWithOnTimeout.size > 0 ? { enginesWithOnTimeout } : {}), ...(enginesWithIdleWatchdog.size > 0 ? { enginesWithIdleWatchdog } : {}), ...(enginesWithInternalRules.size > 0 ? { enginesWithInternalRules } : {}), ...(enginesWithHistory.size > 0 ? { enginesWithHistory } : {}), ...(enginesWithMessageArms.size > 0 ? { enginesWithMessageArms } : {}), ...(engineMessageVariants.size > 0 ? { engineMessageVariants } : {}) };

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

  // Lift hosts inside a mount-deferred `<template>` (emit-html registers a
  // `lift-host` binding for each, and only for those) → their group is emitted
  // as a mount function instead of an eager module-init bind. See the lift-group
  // emission below.
  const liftHostBindings = new Map<string, LogicBinding>();
  for (const b of ((ctx.registry?.logicBindings ?? []) as LogicBinding[])) {
    if (b.kind === "lift-host" && b.placeholderId) liftHostBindings.set(b.placeholderId, b);
  }
  const liftMountFnLines = new Map<string, string[]>();

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

  // g-lift-inside-each-row-or-match-arm-silently-dropped — NESTED lift groups.
  // A `${ … lift … }` block inside an `<each>` row or a match/engine arm is
  // rendered per instance by emit-each / emit-variant-guard, which registered it
  // (BindingRegistry.addNestedLiftGroup) and emitted a call to its function. It
  // is lowered HERE, through the very same per-group statement loop below, so
  // it cannot drift from its top-level twin. Drained as a queue AFTER the
  // top-level groups: lowering a group can itself register one (an `<each>`
  // inside Tier-0 lifted markup emits its rows while Step 4b lowers the lift).
  const nestedLiftGroups: NestedLiftGroup[] = (ctx.registry?.nestedLiftGroups ?? []) as NestedLiftGroup[];
  const nestedLiftFnLines = new Map<string, string[]>();
  function* drainGroups(): Generator<{ pid: string | null; stmts: any[]; nested?: NestedLiftGroup }> {
    for (const g of groups) yield g;
    for (let i = 0; i < nestedLiftGroups.length; i++) {
      const ng = nestedLiftGroups[i];
      nestedLiftFnLines.set(ng.fnName, []);
      yield { pid: ng.pid, stmts: ng.stmts, nested: ng };
    }
  }

  // An `<each>` inside Tier-0 lifted markup emits its rows from inside this
  // loop (emit-lift → emit-each); give its per-row lift path the registry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setEachLiftRegistry } = require("./emit-each.ts") as {
    setEachLiftRegistry: (r: any) => any;
  };
  const prevEachLiftRegistry = setEachLiftRegistry(ctx.registry ?? null);

  // s427-lift-body-lowering — names declared at chunk scope by the groups emitted
  // so far (SPEC §7.6 file scope). See `groupNames` below.
  const fileScopeNames = new Set<string>();

  for (const group of drainGroups()) {
    const { pid, stmts } = group;
    const codes: string[] = [];
    // The source statement each `codes` entry came from (same index). The
    // mount-deferred lift split (below) classifies per statement.
    const codeStmts: any[] = [];
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
    // s427-lift-body-lowering — the group's declared-name scope. Every top-level
    // statement used to be emitted with NO set, and the set is exactly what tells a
    // keywordless `n = n + 1` (a `tilde-decl`) after `let n = 0` from a fresh
    // declaration (emit-logic.ts, the `tilde-decl` arm). Without it the rebind
    // lowered to `const n = n + 1`: at the block's own top level a duplicate
    // declaration (E-CODEGEN-INVALID-LOGIC), and one block deeper — a `for` body,
    // the running counter of a lift loop — a shadowing `const` read in its own TDZ,
    // `ReferenceError: Cannot access 'n' before initialization` at boot, exit 0.
    // Seeded from the names earlier groups declared at chunk scope (SPEC §7.6: a
    // top-level `let`/`const` of a file-level `${}` block is in scope for every
    // later block); merged back below only when THIS group's declarations land at
    // chunk scope too.
    const groupNames = liftScopeDeclaredNames(fileScopeNames);
    seedOwnConsts(fileScopeNames, groupNames, true); // chunk scope, if the group lands there (declared-name-marks.ts)
    const groupEmitOpts = groupTildeCtx
      ? { ...emitOpts, tildeContext: groupTildeCtx, declaredNames: groupNames }
      : { ...emitOpts, declaredNames: groupNames };
    // Per-statement ranges of the side-channel lists a statement's emission appends
    // to, so a statement re-emitted by the mixed-hoist guard below leaves no
    // duplicate behind.
    const stmtSideRanges: Array<{ nested: [number, number]; errs: [number, number] }> = [];
    const nestedListRef: any[] | null = (ctx.registry?.nestedLiftGroups ?? null) as any[] | null;

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
      const _nestedBefore = nestedListRef ? nestedListRef.length : 0;
      const _errsBefore = errors.length;
      const _seededBefore = seededConstFallbackCount();
      const code = emitLogicNode(stmt, groupEmitOpts);
      const _sideRange = {
        nested: [_nestedBefore, nestedListRef ? nestedListRef.length : 0] as [number, number],
        errs: [_errsBefore, errors.length] as [number, number],
        seededConst: seededConstFallbackCount() !== _seededBefore,
      };

      // GH #237 (fail-open, S293) — `on mount { … }` calling a server function.
      //
      // SPEC §13.2: "The compiler SHALL insert `await` at every call site where a
      // server-generated fetch call is made." Inside a scrml `function` body that
      // already holds: `emit-functions` colours the fn `async` and
      // `scheduleStatements` -> `injectPromiseAwait` inserts the `await`. A
      // desugared `on mount { … }` body (§6.7.1a) had NEITHER — it is emitted at
      // MODULE scope, and the chunk body is a SYNC IIFE where `await` is illegal,
      // so every server call in a mount block landed as a bare, unawaited Promise:
      //
      //     const u = _scrml_fetch_loadMe_2(1);          // a PENDING Promise
      //     if (u === null || u === undefined) { … }     // ALWAYS false
      //
      // That is fail-OPEN: an `if (u is not) { redirect("/login") }` sign-in guard
      // can never take its deny branch, and `u.type` is `undefined` so every role
      // test downstream silently fails. (The sibling reactive-cell destination
      // `@you = loadMe(1)` was already correct — emit-client.ts lifts it into its
      // own `(async () => _scrml_reactive_set(…, await …))()`.)
      //
      // Fix: give the mount block the async scope §13.2 requires. The body runs
      // inside a self-contained `(async () => { … })()` — the same shape, and the
      // same `injectPromiseAwait` await policy, the two already-correct paths use.
      // `on mount { … }` is a fire-and-forget lifecycle effect (§6.7.1a), and its
      // locals are BLOCK-scoped in source, so nothing outside the block can
      // reference them: the wrap changes no visible binding. Gated on the body
      // actually calling a server fn — a mount block without one emits
      // byte-identically to before.
      if (code && (stmt as any)._onMountEffect === true && ctx.routeMap && emittedCodeCallsServerFn(code, ctx.routeMap)) {
        const awaited = liftEmittedStatementAwaits(code, ctx.routeMap, ctx.filePath ?? "");
        const indented = awaited
          .split("\n")
          .map((l) => (l.length ? "  " + l : l))
          .join("\n");
        codes.push(
          `// §6.7.1a \`on mount\` — async scope for the server calls in this block (§13.2).\n` +
          `(async () => {\n${indented}\n})().catch(_scrml_async_err => _scrml_error_boundary_log("on mount", _scrml_async_err));`,
        );
        codeStmts.push(stmt);
        stmtSideRanges.push({ ..._sideRange, onMount: true } as any);
        continue;
      }

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

      if (code) { codes.push(code); codeStmts.push(stmt); stmtSideRanges.push(_sideRange); }
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
    let combinedCode = codes.join("\n");

    // s427-lift-body-lowering — the mixed-case hoist guard (see
    // mixedHoistStrandsADeclaration). When the group re-renders through an outer
    // effect AND the hoisted keyed setup would read a declaration that stays inside
    // that effect, every statement that keys a list is re-emitted with its loops
    // lowered plain; the side-channel entries its first emission appended are
    // withdrawn first (reverse order keeps the earlier ranges valid).
    if (
      groupHasLift &&
      combinedCode.includes("_scrml_reconcile_list(") &&
      liftGroupWrapsOuterEffect(combinedCode, groupHasReactiveDeps) &&
      mixedHoistStrandsADeclaration(combinedCode)
    ) {
      for (let i = codes.length - 1; i >= 0; i--) {
        const r = stmtSideRanges[i] as any;
        if (!r || r.onMount || !codes[i].includes("_scrml_reconcile_list(")) continue;
        if (nestedListRef && r.nested[1] > r.nested[0]) nestedListRef.splice(r.nested[0], r.nested[1] - r.nested[0]);
        if (r.errs[1] > r.errs[0]) errors.splice(r.errs[0], r.errs[1] - r.errs[0]);
        pushLiftNonKeyed();
        try {
          codes[i] = emitLogicNode(codeStmts[i], groupEmitOpts);
        } finally {
          popLiftNonKeyed();
        }
      }
      combinedCode = codes.join("\n");
    }

    // The group's declarations are file scope (SPEC §7.6) exactly when its code
    // runs at chunk scope: a plain logic group, or a run-once lift group (its
    // lift-free statements stay at chunk scope in the mount-deferred split too). An
    // outer-effect group keeps them effect-local, and a nested group's live in its
    // per-instance function.
    const groupAtChunkScope = !group.nested && (!(pid && groupHasLift) || !liftGroupWrapsOuterEffect(combinedCode, groupHasReactiveDeps));
    if (groupAtChunkScope) {
      for (const n of groupNames) fileScopeNames.add(n);
      seedOwnConsts(groupNames, fileScopeNames);
    } else if (stmtSideRanges.some((r: any) => r && r.seededConst)) {
      // s427 round 2 (H1) — a keywordless write to an earlier group's `const` was
      // lowered as base's duplicate `const` on the assumption that this group's code
      // shares the chunk scope — where the duplicate fails the compile, as it did on
      // base. It does not: it runs inside the group's effect / per-instance function,
      // where that `const` would be a silent SHADOW that drops the write. The write
      // is re-emitted as the assignment it is, and the compile fails with the same
      // code base failed it with (E-CODEGEN-INVALID-LOGIC — no dedicated diagnostic
      // for a `const` write exists in the compiler yet; SPEC §50 names one). A
      // top-level keywordless assignment appends nothing to the side channels, so
      // nothing is withdrawn.
      for (let i = 0; i < codes.length; i++) {
        const r = stmtSideRanges[i] as any;
        if (!r || !r.seededConst || r.onMount) continue;
        const st = codeStmts[i];
        codes[i] = withSeededConstsOff(groupNames, () => emitLogicNode(st, groupEmitOpts));
        const nm = typeof st?.name === "string" ? st.name : "?";
        errors.push(new CGError(
          "E-CODEGEN-INVALID-LOGIC",
          `E-CODEGEN-INVALID-LOGIC: the keywordless assignment \`${nm} = …\` writes \`${nm}\`, which an earlier ` +
            `\`\${}\` block declares \`const\` (SPEC §50: a \`const\` is immutable). This block runs inside its ` +
            `re-render effect, so the write cannot be lowered: as an assignment it throws at runtime, as a ` +
            `declaration it would silently shadow \`${nm}\`. Declare \`${nm}\` with \`let\` if it is meant to change, ` +
            `or give this value its own name.`,
          st?.span ?? { file: fileAST.filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
          "error",
        ));
      }
      combinedCode = codes.join("\n");
    }

    // A nested group NEVER reaches file scope: its statements read the row's
    // iteration names / the arm's payload bindings, which exist only as the
    // parameters of its function. The whole block (declarations included) runs
    // per instance — each row and each arm entry is its own `${}` evaluation.
    if (group.nested) {
      const fnLines = nestedLiftFnLines.get(group.nested.fnName)!;
      if (groupHasLift) emitLiftGroup(fnLines, LIFT_MOUNT_HOST_PARAM, stmts, combinedCode, groupHasReactiveDeps);
      else fnLines.push(combinedCode);
      continue;
    }

    if (pid && groupHasLift) {
      // g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template —
      // where the lift target comes from. A host in the SSR body is in the
      // document at module init, so the group binds it eagerly (unchanged,
      // byte-identical). A host inside a mount-deferred `<template>` (emit-html
      // registered a `lift-host` binding for it) does NOT exist until the
      // template is cloned and inserted — `document.querySelector` never
      // descends into template content, so the eager bind was `null` and the
      // group either threw (`null.innerHTML`) or `_scrml_lift` fell back to
      // `document.body`, rendering the rows OUTSIDE their host. Such a group is
      // emitted as a function of the host instead; emit-event-wiring calls it
      // from `_scrml_nav_rewire` against each freshly mounted host (§17.1: every
      // false→true transition mounts a fresh clone).
      const mountHostBinding = liftHostBindings.get(pid);
      if (mountHostBinding) {
        let fnLines = liftMountFnLines.get(pid);
        if (!fnLines) {
          fnLines = [];
          liftMountFnLines.set(pid, fnLines);
          mountHostBinding.liftMountFn = liftMountFnName(pid);
        }
        // Only the RENDER work moves into the mount function; the block's
        // declarations keep file scope (SPEC §7.6) — see emitMountDeferredLiftGroup.
        const chunkLines: string[] = [];
        emitMountDeferredLiftGroup(chunkLines, fnLines, stmts, codes, codeStmts, combinedCode, groupHasReactiveDeps);
        lines.push(...chunkLines);
      } else {
        emitLiftGroup(lines, `document.querySelector('[data-scrml-logic="${pid}"]')`, stmts, combinedCode, groupHasReactiveDeps);
      }
    } else {
      lines.push(combinedCode);
    }
  }
  setEachLiftRegistry(prevEachLiftRegistry);

  // Emit each mount-deferred lift group as `function _scrml_lift_mount_<pid>(host, _scrml_effect, _scrml_effect_static)`.
  // The two effect constructors are PARAMETERS so every effect the group's code
  // creates — lexically, at any depth (the outer re-render effect, the keyed
  // list's static effect, per-item effects) — goes through the tracking pair
  // `_scrml_lift_mount_run` passes in, and is disposed when the mount that
  // created it is torn down. Effects elsewhere in the file are untouched. The
  // declaration hoists within the chunk scope, so its position is immaterial.
  // The group's lines are NOT re-indented: they may carry multi-line string
  // literals whose content indentation would change.
  if (liftMountFnLines.size > 0) {
    lines.push("");
    lines.push("// --- lift groups whose host is inside a mount-deferred <template> (§17.1); bound per mount from _scrml_nav_rewire ---");
    lines.push(...LIFT_MOUNT_RUN_HELPER);
    for (const [pid, fnLines] of liftMountFnLines) {
      lines.push(`function ${liftMountFnName(pid)}(${LIFT_MOUNT_HOST_PARAM}, _scrml_effect, _scrml_effect_static) {`);
      lines.push(...fnLines);
      lines.push("}");
    }
  }

  // Nested lift groups (an `<each>` row / a match or engine arm): same
  // host-parameterised shape as the mount groups above, plus the instance scope
  // as trailing parameters. Every registered group gets its function even if it
  // lowered to nothing — its caller was already emitted.
  if (nestedLiftGroups.length > 0) {
    lines.push("");
    lines.push("// --- lift groups whose host is created per instance (<each> row, match/engine arm); run from the row factory / arm wire fn ---");
    lines.push(...NESTED_LIFT_RUN_HELPERS);
    for (const ng of nestedLiftGroups) {
      lines.push(`function ${ng.fnName}(${[LIFT_MOUNT_HOST_PARAM, "_scrml_effect", "_scrml_effect_static", ...ng.params].join(", ")}) {`);
      lines.push(...ng.prologue);
      lines.push(...(nestedLiftFnLines.get(ng.fnName) ?? []));
      lines.push("}");
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
        // Published on globalThis as well as declared: the chunk body is wrapped
        // in a per-chunk IIFE (chunk-namespacing N3), and `_scrml_ssr_seed_apply`
        // in the RUNTIME probes this by bare name (`typeof _scrml_shell_cells
        // !== "undefined"`). A bare `var` inside the wrap is invisible to it, so
        // the soft-nav shell-skip would silently stop working. This is the ONLY
        // chunk-declared global the runtime reads by name — audited, not assumed.
        lines.push(`var _scrml_shell_cells = { ${entries} };`);
        lines.push(`if (typeof globalThis !== "undefined") globalThis._scrml_shell_cells = _scrml_shell_cells;`);
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
  const { lifecycleNodes, inputStateNodes, requestNodes, apiDeclNodes, timeoutNodes, bindPropsWirings, regionOrderedNodes } =
    classifyMarkupNodes(getNodes(fileAST));

  // Steps 5 + 5c are ONE source-ordered pass — §20.8.8 step 3.
  //
  // "Bodies associated with the region run in declaration order." `<timer>`,
  // `<poll>` and `<request>` are three of the six construct kinds §6.7.2.1
  // associates with an element scope or route region, so their EMITTED order
  // must follow their DECLARED order. Emitting them as two sequential bucket
  // passes could not express that: every `<timer>` preceded every `<request>`
  // regardless of authoring, so a `<timer>` declared SECOND ran before a
  // `<request>` declared FIRST. (§20.8.8(6) makes the first rendering of route
  // content a `route-enter`, so this clause binds a page that never navigates —
  // at module init the emitted order IS the run order.)
  //
  // DELIBERATELY NOT WIDENED: `<keyboard>`/`<mouse>`/`<gamepad>` (Step 5b),
  // `<channel>` (Step 5.5) and `<timeout>` (Step 5d) are NOT in §6.7.2.1's set.
  // They keep their own passes, their own relative order, and their own emitted
  // text. Reordering them would be a semantics change with no clause behind it.
  //
  // WHERE the merged block lands: at the slot of whichever in-set bucket emitted
  // FIRST under the legacy bucket ordering — the lifecycle slot when the file
  // declares any `<timer>`/`<poll>`, the request slot otherwise. SPEC constrains
  // the in-set bodies relative to EACH OTHER and says nothing about their
  // position relative to the out-of-set kinds, so this rule is chosen to hold
  // the out-of-set neighbours still: a file declaring only ONE of the two in-set
  // kinds emits byte-identically to the pre-fix output, and only a file that
  // actually interleaves them moves.
  const regionWiringAtLifecycleSlot = lifecycleNodes.length > 0;
  // Deep-walked api-decl set (classifyMarkupNodes descends into <program>/
  // <page>/engine bodies) — getNodes() top-level-only missed a wrapped <api>.
  // §60.4 — `<request api="endpointName">` (typed external API) resolves here.
  const apiEndpoints: Map<string, ApiEndpointForEmit> =
    requestNodes.length > 0 ? buildApiEndpointRegistry(apiDeclNodes) : new Map();
  const emitRegionOrderedWiring = (): void => {
    let previousKind: RegionBodyKind | null = null;
    for (const { kind, node } of regionOrderedNodes) {
      // One section header per contiguous RUN of the same kind, so a file that
      // declares only timers or only requests reads exactly as it did before.
      if (kind !== previousKind) {
        lines.push("");
        lines.push(
          kind === "lifecycle"
            // Step 5: <timer> / <poll> lifecycle initialization (§6.7.5, §6.7.6)
            ? "// --- lifecycle initialization (compiler-generated) ---"
            // Step 5c: <request> single-shot async fetch initialization (§6.7.7)
            : "// --- request async fetch initialization (§6.7.7, compiler-generated) ---",
        );
        previousKind = kind;
      }
      const emitted = kind === "lifecycle"
        ? emitLifecycleNode(node, errors, fileAST.filePath ?? "")
        : emitRequestNode(node, errors, fileAST.filePath ?? "", apiEndpoints);
      for (const l of emitted) lines.push(l);
    }
  };

  if (regionWiringAtLifecycleSlot) emitRegionOrderedWiring();

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

  // Step 5c: <request> initialization is emitted by the merged source-ordered
  // pass above (see the §20.8.8 step 3 note at Step 5). It runs HERE — after
  // input-state and channel — when the file declares no `<timer>`/`<poll>`,
  // which reproduces the legacy bucket position exactly.
  if (!regionWiringAtLifecycleSlot) emitRegionOrderedWiring();

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
      // A reactive CSS custom property is ALWAYS set on `document.documentElement`
      // (`:root`). Components are compile-time INLINED — there is no per-instance
      // runtime element, and every cell reaching this path is a global reactive
      // cell. The custom property set on :root inherits into the component's inline
      // `style="… var(--scrml-name)"` (§65.3.1 @scope bounds matching not
      // inheritance; §25.5 custom-prop inheritance). A prior `bridge.scoped`
      // ternary targeted an undefined `_scrml_el` stub for a per-instance runtime
      // that does not exist → `ReferenceError: _scrml_el is not defined` on load.
      const target = `document.documentElement`;

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

  // §20.8.3 link-boost (i27) NOTE: the delegated `_scrml_link_ensure_click()`
  // boot call is NOT emitted here. It MUST register its document-level click
  // listener AFTER the author's delegated onclick handlers so an author
  // `event.preventDefault()` is visible to link-boost's `if (e.defaultPrevented)`
  // top-guard (S239 HIGH — reactiveLines land at client-body top level, BEFORE
  // the author delegation which registers inside DOMContentLoaded). The boot
  // call is emitted by generateClientJs AFTER `eventLines`, wrapped in its own
  // DOMContentLoaded handler, so its registration follows the author's.
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
export function fileHasOutlet(fileAST: any): boolean {
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

/**
 * §6.7.2.1 associates six construct kinds with the nearest enclosing element
 * scope OR route region: `${}` logic blocks, `on mount` bodies, `<request>`,
 * `<timer>`, `<poll>` and `cleanup()` registrations. THREE of those six are
 * classified by this walk — `<timer>`/`<poll>` (`"lifecycle"`) and `<request>`
 * (`"request"`) — and §20.8.8 step 3 requires them to run in DECLARATION order.
 *
 * `<keyboard>`/`<mouse>`/`<gamepad>`, `<channel>` and `<timeout>` are NOT in
 * §6.7.2.1's set and are deliberately absent from this ordering.
 */
type RegionBodyKind = "lifecycle" | "request";

interface RegionOrderedWiring {
  kind: RegionBodyKind;
  node: any;
}

interface WiringCollections {
  lifecycleNodes: any[];
  inputStateNodes: any[];
  requestNodes: any[];
  apiDeclNodes: any[];
  timeoutNodes: any[];
  bindPropsWirings: BindPropsWiring[];
  /**
   * The §6.7.2.1 region-associated bodies this walk classifies, in SOURCE
   * (declaration) order — the interleaving of `lifecycleNodes` and
   * `requestNodes` that the per-bucket arrays cannot express. The walk below is
   * a pre-order DFS, and a markup node is pushed BEFORE its children are
   * visited, so push order is source order.
   */
  regionOrderedNodes: RegionOrderedWiring[];
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
    regionOrderedNodes: [],
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
        //
        // SCOPE OF THIS PREDICATE — read before "fixing" it (S314, traced by
        // execution). `insideOutlet` means "a lexical descendant of an <outlet>
        // node in THIS file's AST". Real route content is never that: the
        // <outlet> is a slot in the SHELL file and the route body lives in its
        // own `pages/*.scrml`, which the router fills at navigation time. So
        // this flag covers a degenerate authoring shape and MISSES the case that
        // actually occurs — that is `g-route-timer-poll-not-stopped-on-soft-nav`
        // (HIGH, open).
        //
        // Note the divergence from `collectShellCellNames` above, which decides
        // the SAME shell-vs-region question for cells and treats BOTH <outlet>
        // and <page> as region boundaries. The two walks disagree, and the
        // cell walk is the one that matches §6.7.2.1.
        //
        // Widening this predicate to `|| tag === "page"` is NOT sufficient on its
        // own and MUST NOT be landed alone — measured S314, three ways:
        //   1. A route chunk's module-init runs INSIDE the injection window of
        //      the same navigation that is about to tear down the OUTGOING
        //      region (`_scrml_nav_load_chunks` -> onDone -> swap ->
        //      `_scrml_teardown_region`), so the INCOMING route's timer is
        //      registered and then immediately drained. Route timers become dead
        //      on arrival.
        //   2. A chunk that is already loaded is never re-injected
        //      (`_scrml_nav_missing_chunks` keys on the live document's script
        //      set), so nothing restarts a route timer on RE-ENTRY. §20.8.8
        //      step 3 is unbuilt.
        //   3. In the single-file <page> form every page's timer starts at the
        //      same module-init in ONE chunk, so the first navigation drains the
        //      timers of every page including the one being entered.
        // See `docs/changes/route-region-teardown/SCOPING.md` for the traces.
        const childInsideOutlet = insideOutlet || tag === "outlet";

        if (tag === "timer" || tag === "poll") {
          if (insideOutlet) node._outletResident = true;
          result.lifecycleNodes.push(node);
          result.regionOrderedNodes.push({ kind: "lifecycle", node });
        } else if (tag === "keyboard" || tag === "mouse" || tag === "gamepad") {
          // navigate-wave1b #7 — an <keyboard>/<mouse>/<gamepad> lexically inside the
          // outlet is region-resident: its GLOBAL document/window listeners must be
          // torn down on a soft-nav swap (else they leak, double-firing against the
          // old route's cells). Route its destroy into _scrml_region_cleanups, the
          // same treatment <timer>/<poll> get. A SHELL-level input handler keeps the
          // boot-once cleanup path so it survives navigation.
          if (insideOutlet) node._outletResident = true;
          result.inputStateNodes.push(node);
        } else if (tag === "request") {
          result.requestNodes.push(node);
          result.regionOrderedNodes.push({ kind: "request", node });
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

      // §17.1.1 if-chain — an `if=`/`else-if=`/`else` chain WITH an else arm is
      // collapsed into `{kind:"if-chain", branches:[{condition, element}],
      // elseBranch}`, whose branch bodies live under `branches[].element` +
      // `elseBranch`, NOT `children` — so the generic recurse below misses them
      // and a `<timer>`/`<poll>` (or any reactive-wiring node) declared inside a
      // chain branch is silently dropped (`_scrml_timer_start` never emitted).
      // Descend via the shared enumerator, the same fact every sibling walk uses.
      // g-timer-in-if-chain-branch-never-starts. `ifChainChildNodes` returns [] for
      // any non-if-chain node, so this is a no-op elsewhere.
      for (const branchBody of ifChainChildNodes(node)) {
        visit([branchBody], insideOutlet);
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

  // §6.7.6 — a `<poll>` fires an immediate first tick on arming; a `<timer>` never does
  // (§6.7.5). The immediate tick is gated by `running=`: a `<poll running=false>` has not
  // armed, so it fires no immediate tick; a reactive `running=@cell` fires only if the cell
  // is true at arming. `<timer>` and a static `running=false` poll pass no `immediate` arg.
  let immediateArg = "";
  if (tag === "poll") {
    if (runningIsAlwaysTrue) {
      immediateArg = ", true";
    } else if (runningVarName) {
      immediateArg = `, _scrml_reactive_get(${JSON.stringify(runningVarName)})`;
    }
  }

  lines.push(`// <${tag}${timerId ? ` id="${timerId}"` : ""}> interval=${intervalMs}ms`);
  lines.push(`_scrml_timer_start(${scopeVar}, ${timerVar}, ${intervalMs}, function() {`);
  lines.push(`  ${bodyCode}`);
  lines.push(`}${immediateArg});`);

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
  // AWAY tears it down (`_scrml_teardown_region` drains it). A SHELL-level timer
  // keeps the boot-once `_scrml_register_cleanup` (beforeunload) path so it
  // survives navigation.
  //
  // SCOPE (corrected S314 — the previous wording said "the leak is closed", which
  // is true of THIS BRANCH and over-claims the CLASS). What is closed is the leak
  // for a <timer>/<poll> written LEXICALLY INSIDE `<outlet>`, which is a
  // degenerate authoring shape. Route content lives in a different file from the
  // shell that owns the <outlet>, so `_outletResident` is essentially never set
  // for it and a real route timer still takes the `else` branch below and leaks
  // across a soft nav — `g-route-timer-poll-not-stopped-on-soft-nav` (HIGH, open).
  // See the SCOPE note on `classifyMarkupNodes`'s `insideOutlet` for why widening
  // the predicate alone does not fix it.
  //
  // Restart-on-return is likewise NOT covered here. The start above runs at chunk
  // MODULE-INIT and nothing re-runs it on a later navigation, so §20.8.8 step 3
  // (route-enter re-runs region-associated bodies) is unbuilt even for the
  // outlet-resident subset.
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

  // navigate-wave1b #7 — an OUTLET-RESIDENT input handler routes its destroy into
  // `_scrml_region_cleanups` (drained by _scrml_teardown_region on a soft-nav swap)
  // so its global document/window listeners are removed, not leaked; a SHELL-level
  // handler keeps the boot-once `_scrml_register_cleanup` (beforeunload) path.
  // Same SCOPE caveat as the <timer> branch above (S314): `_outletResident` means
  // LEXICALLY inside `<outlet>`, so a handler declared in a `pages/*.scrml` route
  // file is not covered and still leaks its global listeners across a soft nav.
  const registerDestroy = (destroyCall: string): string =>
    (node && node._outletResident)
      ? `if (typeof _scrml_region_cleanups !== "undefined") { _scrml_region_cleanups.push(() => ${destroyCall}); } else { _scrml_register_cleanup(() => ${destroyCall}); }`
      : `_scrml_register_cleanup(() => ${destroyCall});`;

  if (tag === "keyboard") {
    lines.push(`// <keyboard${inputId ? ` id="${inputId}"` : ""}>`);
    lines.push(`_scrml_input_keyboard_create(${inputIdJs}, ${scopeVar});`);
    lines.push(registerDestroy(`_scrml_input_keyboard_destroy(${inputIdJs}, ${scopeVar})`));
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
    lines.push(registerDestroy(`_scrml_input_mouse_destroy(${inputIdJs}, ${scopeVar})`));
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
    lines.push(registerDestroy(`_scrml_input_gamepad_destroy(${inputIdJs}, ${scopeVar})`));
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
