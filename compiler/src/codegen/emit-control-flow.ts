import { genVar } from "./var-counter.ts";
import { emitExpr, emitExprField, type EmitExprContext } from "./emit-expr.ts";
import { emitLogicNode, emitLogicBody } from "./emit-logic.js";
import { hasFragmentedLiftBody, emitConsolidatedLift, emitLiftExpr, emitIfStmtWithContainer, emitForStmtWithContainer, buildLiftEngineCtxFromExtras } from "./emit-lift.js";
import { emitTransitionGuard } from "./emit-machines.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import { iterableHasReactiveRefs, type FunctionBodyRegistry } from "./reactive-deps.ts";
import { isDestructurePattern, emitDestructurePatternText } from "./emit-destructure-pattern.ts";
import { CGError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Module-level Tier 2 hoist registry (§8.10)
//
// The Batch Planner registers a loop-id → LoopHoist map for each compile
// before CG emission begins. emitForStmt consults this map; if the
// current for-stmt's id is present, the rewritten IN-list path runs in
// place of the plain emission. Cleared after every compile.
// ---------------------------------------------------------------------------

let _hoistMap: Map<string | number, any> | null = null;

/** Called by runCG before emission. Pass null to reset. */
export function setBatchLoopHoists(m: Map<string | number, any> | null): void {
  _hoistMap = m;
}

// ---------------------------------------------------------------------------
// S79 audit fix C.2 — batched IN-list cap (`<program batch-in-list-cap=>`)
// ---------------------------------------------------------------------------
//
// Per-file override of the SQLITE_MAX_VARIABLE_NUMBER ceiling enforced in
// emitted hoisted-loop code. Default 32766 (SQLite 3.32+); adopters with
// Postgres (~65535) or older SQLite (999) override here. Module-level cache
// mirrors `_hoistMap` lifecycle: set per file before generateClientJs /
// generateServerJs, cleared after compile.

let _batchInListCap: number | null = null;

/** Called by runCG before emission. Pass null to reset to default 32766. */
export function setBatchInListCap(cap: number | null): void {
  _batchInListCap = (typeof cap === "number" && cap > 0) ? cap : null;
}

function getBatchInListCap(): number {
  return _batchInListCap ?? 32766;
}

// ---------------------------------------------------------------------------
// Module-level variant payload fields registry (S22 §1a slice 2)
//
// Maps enum variant name → ordered list of declared payload field names. Used
// by emitMatchExpr to resolve positional bindings (e.g. `.Circle(r)` → the
// first declared field of `Circle`). Populated once per file from fileAST's
// typeDecls by setVariantFieldsForFile at the top of generateClientJs /
// generateServerJs, cleared after compile so nothing leaks between files.
//
// Collision policy: if two enums in the same file declare a variant with the
// same name, the first-seen field list wins and the collision is recorded in
// _variantFieldCollisions so the emitter can refuse to destructure positionally
// (since the type would be ambiguous). Named bindings (`.V(field: local)`) are
// always safe — they name the field directly.
// ---------------------------------------------------------------------------

let _variantFields: Map<string, string[]> | null = null;
let _variantFieldCollisions: Set<string> | null = null;

export function setVariantFieldsForFile(
  variantFields: Map<string, string[]> | null,
  collisions?: Set<string> | null,
): void {
  _variantFields = variantFields;
  _variantFieldCollisions = collisions ?? null;
}

/**
 * Bug 2 (S95) — Lookup helper for the variant payload-field schema. Used by
 * `emit-expr.ts:emitCall` to lower `.Variant(args)` bare-dot constructor
 * calls (and qualified `Enum.Variant(args)` calls — see emitCall for the
 * dispatch logic) into the canonical `{ variant, data }` tagged-object shape
 * matching what the emitted enum-constructor function would return (see
 * `emit-client.ts:emitEnumVariantObjects`).
 *
 * Returns the ordered declared field-name list for a payload variant, or
 * `null` when the variant name is unknown (unit variant, or no enum decl in
 * the current file declares the name).
 *
 * Collision policy mirrors the existing positional-binding path: when two
 * enums in the same file declare a variant with the same name, the variant
 * is in `_variantFieldCollisions` and we conservatively return `null` here
 * (caller falls back to the legacy `callee(args)` emission — which today
 * produces broken code only when the callee was bare-dot; with a qualified
 * `Enum.Variant(args)` the enum-namespaced constructor handles the
 * disambiguation correctly).
 */
export function getVariantFieldSchema(variantName: string): string[] | null {
  if (!_variantFields) return null;
  if (_variantFieldCollisions && _variantFieldCollisions.has(variantName)) return null;
  return _variantFields.get(variantName) ?? null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IfOpts {
  derivedNames?: Set<string>;
  /**
   * Bug 61 — dotted synth-cell keys, threaded into the if-condition's
   * EmitExprContext + the body opts so `@<compound>.<synthProp>` reads inside
   * if/else conditions + bodies route to the dotted synth cell. Sibling to
   * `derivedNames`.
   */
  synthCellKeys?: Set<string>;
  /**
   * Names declared in an outer scope (let/const/lin). Threaded through
   * control-flow constructs so bare `x = expr` reassignments inside an
   * if/else/for/while body are recognized as reassignments rather than
   * new tilde-decls. Without this, the tilde-decl emission path would
   * produce `const x = expr` shadows (Bug B) or _scrml_derived_declare
   * calls for plain locals (Bug F).
   */
  declaredNames?: Set<string>;
  /**
   * C5 — propagate the "we are inside a function body" flag through control-
   * flow nesting so state-decl reassignments inside `if (…) { @x = … }`
   * don't emit a `_scrml_init_set` sidecar (which would clobber the cell's
   * canonical declaration-time init thunk).
   */
  insideFunctionBody?: boolean;
  /**
   * S144 (GITI-020) — emission boundary, threaded so a channel-cell write
   * `@cell = expr` nested inside an if/else body on the SERVER boundary reaches
   * the broadcast-wire lowering arm in emit-logic (which gates on
   * `boundary === "server"`). Without this, the nested-body opts default to
   * client mode and the write mis-lowers to `_scrml_reactive_set` (undefined in
   * the emitted `.server.js`).
   */
  boundary?: "client" | "server";
  /**
   * S144 (GITI-020) — channel-owned cell set, threaded alongside `boundary` so
   * the nested-body broadcast-wire arm can confirm the LHS bare name is a
   * channel-declared cell. Sibling to `boundary`; both must reach the nested
   * body for the broadcast lowering to fire.
   */
  channelOwnedCells?: Set<string> | null;
  /**
   * S144 Cluster E / Bug-AB Defect 1 — engine + machine context threaded
   * through `if (…) { … }` bodies so a nested `@engineVar = .X` direct write
   * or `@engineVar.advance(.X)` call routes through the canonical engine
   * dispatch (`_scrml_engine_direct_set` / `_scrml_engine_advance` +
   * `__scrml_engine_<var>_fire_hooks`) instead of emitting a bare
   * `_scrml_reactive_set` / a method call on the variant-string value.
   *
   * Mirrors the field set the match-arm-block path already forwards
   * (rewriteBlockBody → EngineRewriteCtx). Without these, an engine
   * transition triggered from a free program-scope `function` body whose
   * write sits inside an if/else never fires its `<onTransition>` handlers.
   * (S144 landing: merged with the GITI-020 boundary/channelOwnedCells fields
   * above — both A+B and Bug-AB extend this same IfOpts; `boundary` is shared.)
   */
  engineBindings?: Map<string, import("./emit-engine.ts").EngineBindingInfo> | null;
  engineVarNames?: Set<string> | null;
  enginesWithHooks?: Set<string> | null;
  enginesWithOnTimeout?: Set<string> | null;
  enginesWithIdleWatchdog?: Set<string> | null;
  enginesWithInternalRules?: Set<string> | null;
  enginesWithHistory?: Set<string> | null;
  // §51.0.S (S155 batch 3) — message-plane routing inputs.
  enginesWithMessageArms?: Set<string> | null;
  engineMessageVariants?: Map<string, Set<string>> | null;
  machineBindings?: Map<string, MachineBindingInfo> | null;
  /**
   * Bug 72 (S158) — enclosing `for`-loop variable name, threaded so a nested
   * `<each>` inside an `if`/`else` body that sits inside a lifted `for` lowers
   * its inner `@.` to the inner each's iter var (§17.7.3 innermost-scope rule).
   * Reaches the consolidated-lift calls below. null = no enclosing for →
   * byte-identical pre-fix emission.
   */
  scopeVar?: string | null;
}

// §51.5 — Machine binding info for transition guard emission in rewriteBlockBody
interface MachineBindingInfo {
  engineName: string;
  tableName: string;
  rules: Array<{ from: string; to: string; guard: string | null; label: string | null; effectBody: string | null }>;
}

/**
 * §51.0.F + §51.0.G — Engine context threaded into `rewriteBlockBody` so that
 * event-handler bodies containing `@engineVar = .X` (direct write) AND
 * `@engineVar.advance(.X)` (loud advance) route through the canonical
 * write-guard path instead of bypassing it.
 *
 * Bug #6 (s83-a7): event-handler emission paths (`emit-event-wiring.ts` +
 * `emit-variant-guard.ts`'s arm-wire fn) previously called `rewriteBlockBody`
 * with NO engine context, so `@phase = .Loading` inside `onclick=${...}`
 * silently emitted a bare `_scrml_reactive_set`. That bypassed `rule=`
 * enforcement, `<onTransition>` hooks, `internal:rule=` distinct path,
 * history-cell capture, and the history-restore flag — all of which fire
 * correctly when the SAME assignment appears inside a function body
 * (because emit-logic.ts:_emitReactiveSet threads engineBindings there).
 *
 * `engineBindings` is the per-engine direct-write info (consumed at the
 * `@engineVar = .X` site). `exprCtxExtras` carries the partial
 * EmitExprContext that lets `.advance()` calls inside event-handler bodies
 * dispatch to `_scrml_engine_advance` via the C13 detection arm in
 * `emit-expr.ts:emitCall`.
 */
export interface EngineRewriteCtx {
  engineBindings?: Map<string, import("./emit-engine.ts").EngineBindingInfo> | null;
  exprCtxExtras?: Pick<
    EmitExprContext,
    | "engineVarNames"
    | "enginesWithHooks"
    | "enginesWithOnTimeout"
    | "enginesWithIdleWatchdog"
    | "enginesWithInternalRules"
    | "enginesWithHistory"
    // §51.0.S (S155 batch 3) — message-plane routing inputs.
    | "enginesWithMessageArms"
    | "engineMessageVariants"
    // §51.0.F (Option A comprehensive engine-routing) — engine binding-info
    // threaded into nested-expression contexts (arm-result expressions,
    // event-handler bodies) so `@engineCell = .X` writes appearing inside
    // a sub-expression (e.g., `.A => myFn(@engineCell = .B)`) route through
    // the canonical write-guard via `emit-expr.ts:emitAssign`.
    | "engineBindings"
  > | null;
}

/**
 * §51.0.N + §51.0.Q.1 (Bug #2 follow-up for the string-rewrite path) — detect
 * the `.Variant.history` restore-form on the RHS of an engine-bound direct
 * assignment when the RHS is only available as raw source text (the case
 * inside `rewriteBlockBody`, which operates on event-handler body strings
 * before any ExprNode parse).
 *
 * Accepted shapes (mirrors `emit-logic.ts:detectHistoryForm` semantics):
 *   `.Playing.history`                → strip → `.Playing`
 *   `AppMode.Playing.history`         → strip → `AppMode.Playing`
 *   `(.Playing).history`              → strip → `.Playing`
 *   `AppMode.Playing.history.foo`     → no strip (`.foo` follows)
 *   `getX().history`                  → no strip (non-variant base)
 *
 * The check is conservative — the suffix MUST be exactly `.history` at the
 * very end of the RHS expression. Inner usages (e.g. computed expressions
 * referencing `.history` in the middle of a sub-call) are out of scope.
 */
function detectHistoryFormFromString(rhs: string): { isHistoryForm: boolean; strippedRhs: string } {
  const trimmed = rhs.trim();
  // Suffix must be `.history` (word-final — `.historyExtra` does NOT count).
  const m = trimmed.match(/^(.*?)\.history\s*$/s);
  if (!m) return { isHistoryForm: false, strippedRhs: trimmed };
  const base = m[1].trim();
  if (base.length === 0) return { isHistoryForm: false, strippedRhs: trimmed };
  // Base must look like a variant target: either starts with `.` (bare-dot
  // variant tag) OR is a member expression on a (presumed-enum) ident chain.
  // Accept `(.X)` parenthesized form too — strip outer parens for the check.
  let baseForCheck = base;
  while (baseForCheck.startsWith("(") && baseForCheck.endsWith(")")) {
    baseForCheck = baseForCheck.slice(1, -1).trim();
  }
  if (baseForCheck.length === 0) return { isHistoryForm: false, strippedRhs: trimmed };
  // Variant shapes accepted:
  //   `.Foo`               (bare-dot)
  //   `Type.Foo`           (qualified)
  //   `Outer.Type.Foo`     (deeper qualified — still ident chain)
  // Reject: trailing parens (function call), brackets (index), operators.
  if (!/^(\.)?[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(baseForCheck)) {
    return { isHistoryForm: false, strippedRhs: trimmed };
  }
  return { isHistoryForm: true, strippedRhs: base };
}

// ---------------------------------------------------------------------------
// if / else
// ---------------------------------------------------------------------------

/**
 * Emit an if statement.
 */
export function emitIfStmt(node: any, opts: IfOpts = {}): string {
  const lines: string[] = [];
  const _ifExprCtx: EmitExprContext = { mode: "client", derivedNames: opts.derivedNames ?? null, synthCellKeys: opts.synthCellKeys ?? null };
  const _ifCond = emitExprField(node.condExpr, node.condition ?? node.test ?? "true", _ifExprCtx);
  lines.push(`if (${_ifCond}) {`);

  const consequent: any[] = node.consequent ?? node.body ?? [];

  // Thread declaredNames through body emissions so bare `x = expr`
  // reassignments inside the if/else body are recognized as rebinds of
  // outer lets (Bug B + F). C5: also thread insideFunctionBody so nested
  // state-decl reassignments don't leak _scrml_init_set sidecars.
  const bodyOpts = {
    derivedNames: opts.derivedNames,
    synthCellKeys: opts.synthCellKeys,
    declaredNames: opts.declaredNames,
    insideFunctionBody: opts.insideFunctionBody,
    // S144 (GITI-020): thread boundary + channelOwnedCells so a nested
    // `@cell = expr` on the server boundary reaches the broadcast-wire arm.
    boundary: opts.boundary,
    channelOwnedCells: opts.channelOwnedCells,
    // S144 Cluster E / Bug-AB Defect 1 — forward engine + machine context so
    // a nested `@engineVar = .X` / `@engineVar.advance(.X)` inside the if/else
    // body dispatches through the engine helpers (fire_hooks) rather than a
    // bare reactive_set. Tree-shaken: undefined fields are simply ignored by
    // the downstream emitLogicNode opt-consumers.
    ...(opts.engineBindings ? { engineBindings: opts.engineBindings } : {}),
    ...(opts.engineVarNames ? { engineVarNames: opts.engineVarNames } : {}),
    ...(opts.enginesWithHooks ? { enginesWithHooks: opts.enginesWithHooks } : {}),
    ...(opts.enginesWithOnTimeout ? { enginesWithOnTimeout: opts.enginesWithOnTimeout } : {}),
    ...(opts.enginesWithIdleWatchdog ? { enginesWithIdleWatchdog: opts.enginesWithIdleWatchdog } : {}),
    ...(opts.enginesWithInternalRules ? { enginesWithInternalRules: opts.enginesWithInternalRules } : {}),
    ...(opts.enginesWithHistory ? { enginesWithHistory: opts.enginesWithHistory } : {}),
    ...(opts.enginesWithMessageArms ? { enginesWithMessageArms: opts.enginesWithMessageArms } : {}),
    ...(opts.engineMessageVariants ? { engineMessageVariants: opts.engineMessageVariants } : {}),
    ...(opts.machineBindings ? { machineBindings: opts.machineBindings } : {}),
  };

  if (hasFragmentedLiftBody(consequent)) {
    const liftCode = emitConsolidatedLift(consequent, { scopeVar: opts.scopeVar ?? null });
    if (liftCode) lines.push(`  ${liftCode}`);
  } else {
    for (const code of emitLogicBody(consequent, bodyOpts)) {
      lines.push(`  ${code}`);
    }
  }

  lines.push(`}`);
  if (node.alternate) {
    const alternate: any[] = Array.isArray(node.alternate) ? node.alternate : [node.alternate];

    if (hasFragmentedLiftBody(alternate)) {
      lines.push(`else {`);
      const liftCode = emitConsolidatedLift(alternate, { scopeVar: opts.scopeVar ?? null });
      if (liftCode) lines.push(`  ${liftCode}`);
      lines.push(`}`);
    } else {
      lines.push(`else {`);
      for (const code of emitLogicBody(alternate, bodyOpts)) {
        lines.push(`  ${code}`);
      }
      lines.push(`}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// for
// ---------------------------------------------------------------------------

/**
 * Emit a for statement.
 *
 * When the iteration source is a reactive variable (`@varName`), the generated JS
 * subscribes to that variable and re-renders the loop body on changes. This is the
 * §6.5 reactive for/lift pattern.
 *
 * Non-reactive iterables use the plain for-loop path.
 */
export function emitForStmt(
  node: any,
  opts?: { dbVar?: string; declaredNames?: Set<string>; insideFunctionBody?: boolean; fnBodyRegistry?: FunctionBodyRegistry | null; boundary?: "client" | "server"; channelOwnedCells?: Set<string> | null;
    // Bug 65 (S157) — engine codegen extras for lifted engine-transition
    // handlers (`@engine.advance(.X)` / `@engine = .X` inside `${for…lift}`).
    // The if-stmt dispatch already threads these (emit-logic.ts:2358); the
    // for-stmt dispatch now threads them too (emit-logic.ts:2385) so the
    // lift path can lower engine refs through the SHARED each machinery.
    engineVarNames?: Set<string> | null; engineBindings?: Map<string, any> | null;
    enginesWithHooks?: Set<string> | null; enginesWithOnTimeout?: Set<string> | null;
    enginesWithIdleWatchdog?: Set<string> | null; enginesWithInternalRules?: Set<string> | null;
    enginesWithHistory?: Set<string> | null; enginesWithMessageArms?: Set<string> | null;
    engineMessageVariants?: Map<string, Set<string>> | null },
): string {
  const lines: string[] = [];
  // Bug 65 (S157) — assemble the engine codegen ctx ONCE from the threaded
  // extras so lifted engine-transition handlers lower through the SHARED each
  // machinery (`emitEngineHandlerBody`). Null when the file declares no engine
  // (tree-shaken — lifted-handler emission is byte-identical to pre-fix).
  const _liftEngineCtx = buildLiftEngineCtxFromExtras(opts ?? {});
  // A5 (2026-05-17) — `node.variable` may be a structured DestructurePattern.
  // Render it back to JS source for the for-of LHS. String-form passes through
  // unchanged (`item`, `entry`, etc.).
  let varName: string;
  if (isDestructurePattern(node.variable)) {
    varName = emitDestructurePatternText(node.variable);
  } else {
    varName = (typeof node.variable === "string" && node.variable) || node.name || "item";
  }
  let iterable: string = node.iterable ?? node.collection ?? "[]";

  // §8.10 Tier 2 loop-hoist: if the Batch Planner recorded a LoopHoist
  // for this for-stmt, delegate to the rewriter before falling through
  // to the standard emission path.
  const _hoist = (_hoistMap && node.id != null) ? _hoistMap.get(node.id) : null;
  if (_hoist) {
    return emitHoistedForStmt(node, _hoist, opts?.dbVar ?? "_scrml_sql");
  }

  if (typeof iterable === "string") {
    // Check for C-style for loop: "( let i = 0 ; i < 10 ; i++ )"
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) {
      const _cParts = node.cStyleParts;
      const _cCtx: EmitExprContext = { mode: "client" };
      const init = emitExprField(_cParts?.initExpr, cStyleMatch[1].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), _cCtx);
      const cond = emitExprField(_cParts?.condExpr, cStyleMatch[2].trim(), _cCtx);
      const update = emitExprField(_cParts?.updateExpr, cStyleMatch[3].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), _cCtx);
      lines.push(`for (${init}; ${cond}; ${update}) {`);

      const body: any[] = node.body ?? [];
      for (const code of emitLogicBody(body, { declaredNames: opts?.declaredNames, insideFunctionBody: opts?.insideFunctionBody, boundary: opts?.boundary, channelOwnedCells: opts?.channelOwnedCells } as any)) {
        lines.push(`  ${code}`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    // Match "( [let|const|var] VAR of EXPR )" or "( VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] !== "item") {
        varName = forOfMatch[1];
      }
      iterable = forOfMatch[2].trim();
    }
  }

  // S96 Issue C — predicate widened: reactive iff iterable contains any
  // @-prefix ref (direct or transitive through fn-call body), not just
  // bare-@-ident. Mirrors the chunk-gate predicate in
  // emit-client.ts:detectRuntimeChunks (both sites must agree, otherwise
  // the runtime ships the reconciliation chunk but the emit uses plain
  // for-loop, or vice versa).
  //
  // Pre-S96: `for (let task of @tasks.filter(...))` (real-code shape from
  // examples/25-triage-board.scrml) and `for (let x of fn())` where fn
  // reads `@state` both silently fell through to plain `for (const x of
  // ...)` emission. The surrounding `<ul>` would render once at module-init
  // and never re-render on state change. V5-strict enforcement at the
  // identifier level (§6.1.3 + E-NAME-COLLIDES-STATE) makes "no @-ref =
  // snapshot" unambiguous, so the predicate widening is sound.
  const iterIsReactive = iterableHasReactiveRefs(node, opts?.fnBodyRegistry ?? null);

  if (iterIsReactive) {
    // Reactive for/lift path — §6.5.3 with keyed reconciliation
    const wrapperVar = genVar("list_wrapper");
    const renderFn = genVar("render_list");
    const createFnVar = genVar("create_item");
    const tmpContainerVar = genVar("tmp");
    const _forExprCtx: EmitExprContext = { mode: "client" };
    const rewrittenIterable = emitExprField(node.iterExpr, iterable, _forExprCtx);
    const body: any[] = node.body ?? [];

    lines.push(`const ${wrapperVar} = document.createElement("div");`);
    lines.push(`_scrml_lift(${wrapperVar});`);

    lines.push(`function ${createFnVar}(${varName}, _scrml_idx) {`);

    if (hasFragmentedLiftBody(body)) {
      // Pass continueBehavior:"return" so continue-stmts in pre-statements emit `return;`
      const liftCode = emitConsolidatedLift(body, { directReturn: true, continueBehavior: "return", engineCtx: _liftEngineCtx, scopeVar: varName });
      if (liftCode) {
        for (const line of liftCode.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    } else {
      // Fallback: use DocumentFragment for non-consolidated lift bodies
      lines.push(`  const ${tmpContainerVar} = document.createDocumentFragment();`);
      for (const child of body) {
        if (child && child.kind === "lift-expr") {
          const code = emitLiftExpr(child, { containerVar: tmpContainerVar, engineCtx: _liftEngineCtx, scopeVar: varName });
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        } else if (child && child.kind === "if-stmt") {
          // LIFT-5 fix: if-stmt that may contain lift-expr children must route
          // those inner lifts to tmpContainerVar instead of the global ambient
          // _scrml_lift_target (which is null when the reconciler calls this factory).
          const code = emitIfStmtWithContainer(child, tmpContainerVar, { continueBehavior: "return", engineCtx: _liftEngineCtx, scopeVar: varName });
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        } else if (child && child.kind === "for-stmt") {
          // LIFT-5 fix: nested for-stmt that may contain lift-expr children.
          const code = emitForStmtWithContainer(child, tmpContainerVar, { continueBehavior: "return", engineCtx: _liftEngineCtx });
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        } else {
          // Pass continueBehavior:"return" so continue-stmts nested at any depth
          // (e.g. inside an if-body) emit `return;` rather than illegal `continue;`.
          const code = emitLogicNode(child, { continueBehavior: "return" });
          if (code) {
            for (const line of code.split("\n")) {
              lines.push(`  ${line}`);
            }
          }
        }
      }
      lines.push(`  return ${tmpContainerVar}.firstChild;`);
    }
    lines.push(`}`);

    lines.push(`function ${renderFn}() {`);
    // Keying function: use `item.id` when present, fall back to index `i`.
    // `item?.id != null` (loose equality) covers both JS null + undefined
    // and avoids the bare `undefined` keyword that the W-CG-UNDEFINED-
    // INTERPOLATION lint flags (per M-7C-D-12 + §42.5 — canonical scrml
    // absence is null; runtime stores may yield either).
    lines.push(`  _scrml_reconcile_list(${wrapperVar}, ${rewrittenIterable}, (item, i) => item?.id != null ? item.id : i, ${createFnVar});`);
    lines.push(`}`);
    lines.push(`${renderFn}();`);
    lines.push(`_scrml_effect_static(${renderFn});`);
    return lines.join("\n");
  }

  // Non-reactive path — plain for loop
  const _plainForCtx: EmitExprContext = { mode: "client" };
  iterable = emitExprField(node.iterExpr, iterable, _plainForCtx);
  lines.push(`for (const ${varName} of ${iterable}) {`);

  const body: any[] = node.body ?? [];

  if (hasFragmentedLiftBody(body)) {
    const liftCode = emitConsolidatedLift(body, { engineCtx: _liftEngineCtx, scopeVar: varName });
    if (liftCode) {
      lines.push(`  ${liftCode}`);
    }
  } else {
    for (const code of emitLogicBody(body, { declaredNames: opts?.declaredNames, insideFunctionBody: opts?.insideFunctionBody, boundary: opts?.boundary, channelOwnedCells: opts?.channelOwnedCells } as any)) {
      lines.push(`  ${code}`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// §8.10 Tier 2 — N+1 loop-hoist rewrite
// ---------------------------------------------------------------------------

/**
 * Deep-clone a for-stmt body and substitute the single hoisted `?{...}`
 * site with a Map.get(...) lookup expression. Walks every string field
 * that might carry the original SQL (`init`, `expr`, `value`, etc.) and
 * performs a targeted replace. The first match per statement is enough
 * because §8.10.1 requires exactly one SQL site in the body.
 *
 * The structured ExprNode siblings (`initExpr`, `exprNode`, …) are
 * dropped on the cloned node so emit-logic falls back to the string form
 * we just rewrote. Other AST fields pass through by reference — safe
 * because emit-logic treats them as read-only.
 */
function substituteHoistedSqlInBody(
  body: any[],
  sqlSourcePattern: RegExp,
  replacement: string,
): any[] {
  const out: any[] = [];
  for (const stmt of body) {
    if (!stmt || typeof stmt !== "object") {
      out.push(stmt);
      continue;
    }
    const clone: any = { ...stmt };
    let replaced = false;
    // v0.2.4 bug-1-anomaly-2: when a let-decl/const-decl carries a structured
    // sqlNode (from the ast-builder tryConsumeSqlInit hook), the body's SQL
    // site no longer lives in any string field — so the per-key string regex
    // below would never match. Detect the structured form first: if the
    // clone has a `sqlNode` whose reconstructed `?{` form matches the hoist
    // source pattern, strip the sqlNode and inject the replacement as a
    // plain `init` string. emit-logic case "let-decl"/"const-decl" then
    // falls through to the Phase-4 fallback path (init string → emitExprField).
    if (clone.sqlNode && clone.sqlNode.kind === "sql") {
      const sqlBody = typeof clone.sqlNode.query === "string"
        ? clone.sqlNode.query
        : (typeof clone.sqlNode.body === "string" ? clone.sqlNode.body : "");
      const chainCalls = Array.isArray(clone.sqlNode.chainedCalls) ? clone.sqlNode.chainedCalls : [];
      const argsStr = (chainCalls[0]?.args ?? "").toString();
      const termName = (chainCalls[0]?.method ?? "").toString();
      const reconstructed = `?{\`${sqlBody}\`}.${termName}(${argsStr})`;
      if (sqlSourcePattern.test(reconstructed)) {
        delete clone.sqlNode;
        clone.init = replacement;
        replaced = true;
      }
    }
    for (const k of Object.keys(clone)) {
      if (k === "span" || k === "id" || k === "kind") continue;
      if (k === "exprNode" || k.endsWith("Expr")) {
        // Drop stale ExprNode siblings so emit-logic reads the updated string.
        delete clone[k];
        continue;
      }
      const v = clone[k];
      if (typeof v === "string" && sqlSourcePattern.test(v)) {
        clone[k] = v.replace(sqlSourcePattern, replacement);
        replaced = true;
      }
    }
    // Recurse into nested body arrays (e.g., if-stmt.consequent, etc.) so
    // the SQL site in a nested block is also rewritten.
    if (!replaced && Array.isArray(clone.body)) {
      clone.body = substituteHoistedSqlInBody(clone.body, sqlSourcePattern, replacement);
    }
    out.push(clone);
  }
  return out;
}

/**
 * Emit the §8.10 rewritten form of a for-stmt. Produces:
 *   const _keys = <iterable>.map(<loopVar> => <loopVar>.<keyField>);
 *   const _placeholders = _keys.map((_, i) => `?${i+1}`).join(", ");
 *   const _rows = _db.query(<in-sql with placeholders>).all(..._keys);
 *   const _byKey = new Map();
 *   for (const _r of _rows) _byKey.set(_r.<keyColumn>, _r);   // or push for .all()
 *   for (const <loopVar> of <iterable>) {
 *     <body with original ?{...}.get()/.all() replaced by Map lookup>
 *   }
 *
 * The IN placeholder list is built at runtime from the key array (no
 * string interpolation of user data — preserves §8.2 parameter invariant
 * via spread binding).
 */
function emitHoistedForStmt(node: any, hoist: any, dbVar: string): string {
  // A5 — destructuring LHS support in the batch-hoisted for-stmt path.
  let loopVar: string;
  if (isDestructurePattern(node.variable)) {
    loopVar = emitDestructurePatternText(node.variable);
  } else {
    loopVar = (typeof node.variable === "string" && node.variable) || hoist.loopVar || "item";
  }
  let iterable: string = node.iterable ?? "[]";
  if (typeof iterable === "string") {
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) iterable = forOfMatch[2].trim();
  }
  const _ctx: EmitExprContext = { mode: "client" };
  iterable = emitExprField(node.iterExpr, iterable, _ctx);

  const keysVar = genVar("batch_keys");
  const placeholdersVar = genVar("batch_placeholders");
  const rowsVar = genVar("batch_rows");
  const mapVar = genVar("batch_byKey");

  const keyField: string = hoist.keyField;
  const keyColumn: string = hoist.keyColumn;
  const terminator: "get" | "all" = hoist.terminator;
  const inSqlTemplate: string = hoist.inSqlTemplate;

  const lines: string[] = [];
  lines.push(`// §8.10 Tier 2 loop hoist (key: ${keyColumn})`);
  lines.push(`const ${keysVar} = (${iterable}).map(${loopVar} => ${loopVar}.${keyField});`);
  // §8.10.6: reject key counts above the configured cap at runtime.
  // Default 32766 matches SQLite 3.32+ SQLITE_MAX_VARIABLE_NUMBER (the
  // bun:sqlite bundled version). S79 audit fix C.2 — adopter override via
  // <program batch-in-list-cap="65535"> for Postgres or
  // <program batch-in-list-cap="999"> for older SQLite.
  // Users can .nobatch() the site to opt out if they hit this ceiling.
  const batchCap = getBatchInListCap();
  lines.push(
    `if (${keysVar}.length > ${batchCap}) { const _e = new Error("E-BATCH-002: batched IN-list exceeds SQLITE_MAX_VARIABLE_NUMBER (${batchCap}) for hoisted loop"); _e.code = "E-BATCH-002"; throw _e; }`,
  );
  // Build placeholder list `?1, ?2, ...` so Bun.SQL gets positional bound
  // params. Bun.SQL's SQLite branch does NOT support array binding in tagged
  // templates (`${arr}` throws), so we emit a runtime-built SQL string and
  // bind the array via `sql.unsafe(rawSql, paramArray)` (§44.5).
  lines.push(
    `const ${placeholdersVar} = ${keysVar}.map((_, _i) => "?" + (_i + 1)).join(", ");`,
  );
  // Substitute `__SCRML_BATCH_IN__` placeholder in the template with the
  // generated positional placeholder list. The rest of the SQL template
  // (column list, table, other predicates) is preserved verbatim.
  lines.push(
    `const ${rowsVar} = ${keysVar}.length === 0 ? [] : (await ${dbVar}.unsafe(${JSON.stringify(inSqlTemplate)}.replace("__SCRML_BATCH_IN__", ${placeholdersVar}), ${keysVar}));`,
  );
  lines.push(`const ${mapVar} = new Map();`);
  if (terminator === "get") {
    lines.push(
      `for (const _r of ${rowsVar}) ${mapVar}.set(_r[${JSON.stringify(keyColumn)}], _r);`,
    );
  } else {
    lines.push(
      `for (const _r of ${rowsVar}) { const _k = _r[${JSON.stringify(keyColumn)}]; const _a = ${mapVar}.get(_k) ?? []; _a.push(_r); ${mapVar}.set(_k, _a); }`,
    );
  }

  // Body rewrite — replace the original `?{`<template>`}.get()/.all()`
  // call with the Map lookup. We match the raw template (with
  // backticks) rather than post-emit strings so the rewrite happens at
  // AST level, before emit-logic / rewrite.ts transform the string.
  const bodyTemplate = hoist.sqlTemplate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sourceRe = new RegExp(
    `\\?\\{\`${bodyTemplate}\`\\}\\s*\\.\\s*${terminator}\\s*\\(\\s*\\)`,
    "g",
  );
  const replacement = terminator === "get"
    ? `(${mapVar}.get(${loopVar}.${keyField}) ?? null)`
    : `(${mapVar}.get(${loopVar}.${keyField}) ?? [])`;
  const rewrittenBody = substituteHoistedSqlInBody(node.body ?? [], sourceRe, replacement);

  lines.push(`for (const ${loopVar} of ${iterable}) {`);
  for (const code of emitLogicBody(rewrittenBody)) {
    lines.push(`  ${code}`);
  }
  lines.push(`}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// while
// ---------------------------------------------------------------------------

/**
 * Emit a while statement, optionally with a label prefix.
 */
export function emitWhileStmt(node: any, opts?: { declaredNames?: Set<string>; insideFunctionBody?: boolean; boundary?: "client" | "server"; channelOwnedCells?: Set<string> | null }): string {
  // R25-Bug-42 (S138): thread `boundary` through to the body emission so
  // SQL-bearing statements (`yield ?{...}`, `return ?{...}`, etc.) inside a
  // `while` body parse-time-attached sqlNode are emitted via the server
  // case "sql" path when the enclosing function-decl ran the server-boundary
  // emit (emit-server.ts SSE handler + non-SSE handler). Pre-fix, the loop
  // body always saw boundary=undefined, defaulting opts to client-mode
  // inside emit-logic.ts case "yield-stmt" / "return-stmt" sqlNode branches —
  // which emitted `yield null; // SQL — client cannot evaluate _scrml_sql`
  // inside SSE generator bodies.
  const lines: string[] = [];
  const _whileCtx: EmitExprContext = { mode: opts?.boundary === "server" ? "server" : "client" };
  const condition = emitExprField(node.condExpr, node.condition ?? "true", _whileCtx);
  const label = node.label ? `${node.label}: ` : "";
  lines.push(`${label}while (${condition}) {`);
  for (const code of emitLogicBody(node.body ?? [], { declaredNames: opts?.declaredNames, insideFunctionBody: opts?.insideFunctionBody, boundary: opts?.boundary, channelOwnedCells: opts?.channelOwnedCells } as any)) {
    lines.push(`  ${code}`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// do-while
// ---------------------------------------------------------------------------

/**
 * Emit a do-while statement.
 */
export function emitDoWhileStmt(node: any, opts?: { declaredNames?: Set<string>; insideFunctionBody?: boolean; boundary?: "client" | "server"; channelOwnedCells?: Set<string> | null }): string {
  // R25-Bug-42 (S138): thread `boundary` through to body emission. See
  // emitWhileStmt comment above.
  const lines: string[] = [];
  const _doWhileCtx: EmitExprContext = { mode: opts?.boundary === "server" ? "server" : "client" };
  const condition = emitExprField(node.condExpr, node.condition ?? "true", _doWhileCtx);
  const label = node.label ? `${node.label}: ` : "";
  lines.push(`${label}do {`);
  for (const code of emitLogicBody(node.body ?? [], { declaredNames: opts?.declaredNames, insideFunctionBody: opts?.insideFunctionBody, boundary: opts?.boundary, channelOwnedCells: opts?.channelOwnedCells } as any)) {
    lines.push(`  ${code}`);
  }
  lines.push(`} while (${condition});`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// break / continue
// ---------------------------------------------------------------------------

/**
 * Emit a break statement, optionally with a label target.
 */
export function emitBreakStmt(node: any): string {
  return node.label ? `break ${node.label};` : `break;`;
}

/**
 * Emit a continue statement, optionally with a label target.
 */
export function emitContinueStmt(node: any): string {
  return node.label ? `continue ${node.label};` : `continue;`;
}

// ---------------------------------------------------------------------------
// try / catch / finally
// ---------------------------------------------------------------------------

/**
 * Emit a try-catch-finally statement.
 */
export function emitTryStmt(node: any): string {
  const lines: string[] = [];
  lines.push(`try {`);
  for (const code of emitLogicBody(node.body ?? [])) {
    for (const line of code.split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`}`);

  if (node.catchNode) {
    // Phase 4d note: catchNode.header has no ExprNode equivalent — it's a structural
    // param like "(e)" that the AST builder stores as a raw string. Future: add a
    // catchParam field to TryStmtNode to avoid string parsing here.
    let catchParam: string = node.catchNode.header ? node.catchNode.header.trim() : "";
    if (catchParam.startsWith("(") && catchParam.endsWith(")")) {
      catchParam = catchParam.slice(1, -1).trim();
    }
    const catchParamStr = catchParam ? ` (${catchParam})` : "";
    lines.push(`catch${catchParamStr} {`);
    for (const code of emitLogicBody(node.catchNode.body ?? [])) {
      for (const line of code.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
  }

  if (node.finallyNode) {
    lines.push(`finally {`);
    for (const code of emitLogicBody(node.finallyNode.body ?? [])) {
      for (const line of code.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

export interface MatchArm {
  kind: "variant" | "string" | "wildcard" | "not";
  /**
   * The arm's primary test value. For single-variant arms this is the variant
   * name (e.g. `"Big"`); for pipe-alternation arms (§18 follow-on, S84 fix)
   * it is the FIRST alternate and `tests` carries the full list.
   */
  test: string | null;
  /**
   * Pipe-alternation alternates for `.A | .B | .C => result` arms. When set,
   * the emitted condition uses an OR-chain (`tag === "A" || tag === "B" || ...`).
   * For singleton arms this field is omitted/null. Alternation arms MAY NOT
   * carry payload bindings — per SPEC §51.3.2 / §18.0.3 the same-binding-shape
   * requirement (E-ENGINE-016) is enforced at parse time by refusing to match
   * alternation when any alternate has a payload form. (§18 follow-on to S83 B3.)
   */
  tests?: string[] | null;
  /**
   * Raw paren contents of a variant-arm binding (if any), e.g. "w, h", "radius: r",
   * "_, h". Parsed into `PayloadBinding[]` at emit time via parseBindingList.
   * For presence arms ((x) => ...) this is the presence var name (single ident).
   */
  binding: string | null;
  result: string;
  /** Structured AST body for match-arm-block nodes — bypasses rewriteBlockBody */
  structuredBody?: any[] | null;
}

/**
 * One element of a match-arm variant binding list.
 *
 *   .Circle(r)           → [{ sourceField: null, localName: "r", discard: false }]
 *   .Rect(w, h)          → [{ null, "w", false }, { null, "h", false }]
 *   .Reloading(reason: r)→ [{ "reason", "r", false }]
 *   .Rect(_, h)          → [{ null, "", true }, { null, "h", false }]
 *
 * `sourceField` is non-null for named bindings. When null, positional resolution
 * applies: the element at index i binds the i-th declared payload field.
 */
export interface PayloadBinding {
  sourceField: string | null;
  localName: string;
  discard: boolean;
}

/**
 * Parse the raw contents of a variant-arm binding-list.
 * Returns [] for an empty/whitespace-only string.
 * Each element is one comma-separated item. Leading/trailing whitespace is trimmed.
 */
export function parseBindingList(raw: string): PayloadBinding[] {
  if (!raw) return [];
  const result: PayloadBinding[] = [];
  // Variant bindings do not contain nested parens; a simple comma split is safe.
  const parts = raw.split(",").map(s => s.trim()).filter(s => s.length > 0);
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx !== -1) {
      // Named: `field: local`
      const sourceField = part.slice(0, colonIdx).trim();
      const localName = part.slice(colonIdx + 1).trim();
      if (localName === "_") {
        result.push({ sourceField, localName: "", discard: true });
      } else {
        result.push({ sourceField, localName, discard: false });
      }
    } else {
      // Positional: bare ident, or `_` discard
      if (part === "_") {
        result.push({ sourceField: null, localName: "", discard: true });
      } else {
        result.push({ sourceField: null, localName: part, discard: false });
      }
    }
  }
  return result;
}

/**
 * Parse a single match arm text into a structured arm descriptor.
 *
 * Recognized arm forms (tried in order — new scrml-native syntax first, then legacy fallback):
 *
 * NEW (scrml-native): `=>` and `:>` are equivalent canonical arrows.
 * `:>` reads as "narrows to" (the match subject narrows from full type to variant),
 * distinguishing match arms from JS arrow functions `=>`.
 *   1. .Variant => expr  /  .Variant :> expr          — enum variant (dot-prefix, capital letter required)
 *   2. .Variant(binding) => expr  /  :> expr          — enum variant with payload binding
 *   3. "string" => expr  /  :> expr                   — string literal (double-quoted)
 *   4. 'string' => expr  /  :> expr                   — string literal (single-quoted)
 *   5. else => expr  /  :> expr                       — wildcard/catch-all arm
 *
 * LEGACY (Rust-style fallback — recognized but not canonical):
 *   6. ::Variant -> expr          — old enum variant syntax
 *   7. ::Variant(binding) -> expr — old enum variant with payload
 *   8. "string" -> expr           — old string literal (double-quoted)
 *   9. 'string' -> expr           — old string literal (single-quoted)
 *  10. _ -> expr                  — old wildcard syntax
 */
/**
 * C2 (R27): the `->` match-arm separator (a legal alias for `=>` per SPEC
 * §18.2) is tokenized as TWO PUNCT tokens (`-` then `>`); when the block
 * splitter rejoins arm text in default-logic mode it inserts a space, yielding
 * `. Variant - > result`. The single-token arrows `=>` / `:>` survive rejoin
 * intact, so only `->` needs repair. Collapse a rejoin-spaced `- >` back to the
 * canonical `->` before arm parsing so the value-return match (and every other
 * `->`-arm locus) lowers identically to its `=>` form rather than dropping the
 * arm and emitting a "could not be compiled" stub.
 *
 * Scoped to the FIRST occurrence only (the arm separator is always the leading
 * arrow); a `-` `>` adjacency inside the arm RESULT expression is not a valid
 * scrml operator, so this is safe. String-literal contents are not scanned
 * because the arm pattern + separator always precede the first string literal
 * in an arm.
 */
export function normalizeMatchArmArrow(text: string): string {
  return text.replace(/-\s*>/, "->");
}

export function parseMatchArm(rawTrimmed: string): MatchArm | null {
  // C2 (R27): repair the rejoin-spaced `- >` arrow alias before pattern-match.
  const trimmed = normalizeMatchArmArrow(rawTrimmed);
  // NEW Form 0 (§18 pipe-alternation): `.A | .B | .C => result` (or `:>`).
  // Tried BEFORE the single-variant regex so the alternation chain wins.
  // Alternation arms with payload bindings are NOT supported — the SPEC §51.3.2
  // same-binding-shape rule (E-ENGINE-016) requires AST-level verification;
  // codegen here only matches the unit-variant alternation form (no parens
  // anywhere in the LHS chain).
  const altMatch = trimmed.match(
    /^\.\s*([A-Z][A-Za-z0-9_]*)((?:\s*\|\s*\.\s*[A-Z][A-Za-z0-9_]*)+)\s*(?:=>|:>|->)\s*([\s\S]+)$/,
  );
  if (altMatch) {
    const first = altMatch[1];
    const rest = altMatch[2]
      .split("|")
      .map(s => s.trim().replace(/^\./, "").trim())
      .filter(s => s.length > 0);
    const tests = [first, ...rest];
    return {
      kind: "variant",
      test: first,
      tests,
      binding: null,
      result: altMatch[3].trim(),
    };
  }

  // NEW Form 1 & 2: .Variant => result or .Variant :> result (also with (binding-list))
  // `:>` reads as "narrows to" — distinguishes from JS arrow function `=>`
  // binding-list: zero or more comma-separated bindings, optionally `field: local`
  // or `_` discard. No nested parens (variant bindings are identifier-level).
  const newVariantMatch = trimmed.match(/^\.\s*([A-Z][A-Za-z0-9_]*)(?:\s*\(\s*([^)]*?)\s*\))?\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (newVariantMatch) {
    return { kind: "variant", test: newVariantMatch[1], binding: newVariantMatch[2] ?? null, result: newVariantMatch[3].trim() };
  }

  // NEW Form 3: "string" => expr (or :>)
  const newDqStringMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (newDqStringMatch) {
    return { kind: "string", test: `"${newDqStringMatch[1]}"`, binding: null, result: newDqStringMatch[2].trim() };
  }

  // NEW Form 4: 'string' => expr (or :>)
  const newSqStringMatch = trimmed.match(/^'((?:[^'\\]|\\.)*)'\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (newSqStringMatch) {
    return { kind: "string", test: `'${newSqStringMatch[1]}'`, binding: null, result: newSqStringMatch[2].trim() };
  }

  // NEW Form 5a: not => expr (or :>) — absence arm (§42: `not` in match arms)
  const notArmMatch = trimmed.match(/^not\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (notArmMatch) {
    return { kind: "not", test: null, binding: null, result: notArmMatch[1].trim() };
  }

  // NEW Form 5b: else => expr (or :>, or bare: else expr) — wildcard arm
  const newWildcardMatch = trimmed.match(/^else\s*(?:(?:=>|:>|->)\s*)?([\s\S]+)$/);
  if (newWildcardMatch) {
    return { kind: "wildcard", test: null, binding: null, result: newWildcardMatch[1].trim() };
  }

  // LEGACY Form 1 & 2: ::Variant -> result or ::Variant(binding-list) -> result
  const legacyVariantMatch = trimmed.match(/^::\s*(\w+)(?:\s*\(\s*([^)]*?)\s*\))?\s*->\s*([\s\S]+)$/);
  if (legacyVariantMatch) {
    return { kind: "variant", test: legacyVariantMatch[1], binding: legacyVariantMatch[2] ?? null, result: legacyVariantMatch[3].trim() };
  }

  // LEGACY Form 3: "string" -> expr (double-quoted)
  const legacyDqStringMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*->\s*([\s\S]+)$/);
  if (legacyDqStringMatch) {
    return { kind: "string", test: `"${legacyDqStringMatch[1]}"`, binding: null, result: legacyDqStringMatch[2].trim() };
  }

  // LEGACY Form 4: 'string' -> expr (single-quoted)
  const legacySqStringMatch = trimmed.match(/^'((?:[^'\\]|\\.)*)'\s*->\s*([\s\S]+)$/);
  if (legacySqStringMatch) {
    return { kind: "string", test: `'${legacySqStringMatch[1]}'`, binding: null, result: legacySqStringMatch[2].trim() };
  }

  // LEGACY Form 5: _ -> expr (old wildcard)
  const legacyWildcardMatch = trimmed.match(/^_\s*->\s*([\s\S]+)$/);
  if (legacyWildcardMatch) {
    return { kind: "wildcard", test: null, binding: null, result: legacyWildcardMatch[1].trim() };
  }

  // Bug 1 (S95) — NEW Form 5c: `_ => expr` / `_ :> expr` — JS-style wildcard
  // arm alias for `else`. Mirrors ast-builder.js Inline Form 4 which already
  // produces `match-arm-inline` nodes for this shape; this branch covers the
  // residual paths where match arms arrive as raw strings (expression-position
  // `return match { ... }` → rawArms → emit-expr.ts bridge → bare-expr children
  // → parseMatchArm).
  const newUnderscoreWildcardMatch = trimmed.match(/^_\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (newUnderscoreWildcardMatch) {
    return { kind: "wildcard", test: null, binding: null, result: newUnderscoreWildcardMatch[1].trim() };
  }

  // §42 presence arm: (identifier) => expr (or :>) — counterpart to `not => expr` in match
  // Acts as a wildcard/else arm with the variable bound to the matched value.
  const presenceArmMatch = trimmed.match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*(?:=>|:>|->)\s*([\s\S]+)$/);
  if (presenceArmMatch) {
    return { kind: "wildcard", test: null, binding: presenceArmMatch[1], result: presenceArmMatch[2].trim() };
  }

  return null;
}

/**
 * Convert a structured `match-arm-inline` AST node into a `MatchArm`.
 *
 * The inline node carries pre-parsed fields from the AST builder, so no regex
 * parsing is needed — this is a fast-path conversion.
 *
 * Test field formats:
 *   - `.VariantName`        → kind "variant", test "VariantName"
 *   - `.Variant(binding)`   → kind "variant", test "Variant", binding from node
 *   - `"string"`            → kind "string", test includes quotes
 *   - `else`                → kind "wildcard"
 *   - `not`                 → kind "not"
 */
export function matchArmInlineToMatchArm(node: any): MatchArm | null {
  const test: string = node.test ?? "";
  // S144 Cluster D (Bug Y) — strip a stray trailing comma arm-separator.
  // §18.2 has NO comma separator between arms; when source writes `.A => x,`
  // the AST builder folds the `,` into this arm's `result` (`"x" ,`). Left
  // intact it emits invalid JS (`return "x" ,;`) which the validate-emit gate
  // reports as the GENERIC E-CODEGEN-INVALID-JS. The typer already fires the
  // clean source-anchored E-MATCH-ARM-SEPARATOR (type-system.ts) — that error
  // is what fails the build. Here we only sanitize so the never-meant-to-ship
  // emitted JS still PARSES, leaving E-MATCH-ARM-SEPARATOR as the sole
  // diagnostic the developer sees (no duplicate generic invalid-JS report).
  const result: string = String(node.result ?? "").replace(/,\s*$/, "");
  const binding: string | null = node.binding ?? null;

  // Determine arm kind from test pattern
  if (test === "else") {
    return { kind: "wildcard", test: null, binding: null, result };
  }
  if (test === "not") {
    return { kind: "not", test: null, binding: null, result };
  }
  // String literal arms: test starts with " or '
  if (test.startsWith('"') || test.startsWith("'")) {
    return { kind: "string", test, binding: null, result };
  }
  // §18 pipe-alternation: test is `.A | .B | .C` (no payload binding form).
  // Tried BEFORE the single-variant regex so the alternation chain wins.
  const altInlineMatch = test.match(
    /^\.\s*([A-Z][A-Za-z0-9_]*)((?:\s*\|\s*\.\s*[A-Z][A-Za-z0-9_]*)+)\s*$/,
  );
  if (altInlineMatch) {
    const first = altInlineMatch[1];
    const rest = altInlineMatch[2]
      .split("|")
      .map(s => s.trim().replace(/^\./, "").trim())
      .filter(s => s.length > 0);
    return {
      kind: "variant",
      test: first,
      tests: [first, ...rest],
      binding: null,
      result,
    };
  }
  // Variant arms: test starts with . or ::
  const variantMatch = test.match(/^(?:\.|::)\s*([A-Z][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?$/);
  if (variantMatch) {
    return {
      kind: "variant",
      test: variantMatch[1],
      binding: variantMatch[2]?.trim() ?? binding ?? null,
      result,
    };
  }
  // Fallback: try parsing as raw text (shouldn't normally happen)
  return parseMatchArm(test + " => " + result);
}

/**
 * Split a string containing multiple concatenated match arms into individual arm strings.
 *
 * When the AST delivers a single body child with all arms merged on one line
 * (e.g. ".Todo => Status.InProgress .Done => Status.Todo else => Status.Todo"),
 * this function splits it at arm boundaries before parseMatchArm is called.
 *
 * Arm boundaries are detected by scanning for arm-start tokens at non-string positions:
 *   - .UpperCase  (new variant arm — only when NOT preceded by an identifier char)
 *   - "..." =>    (string literal arm — double-quoted, followed by => or ->)
 *   - '...' =>    (string literal arm — single-quoted, followed by => or ->)
 *   - else        (wildcard arm — when preceded by whitespace or start-of-string)
 *   - ::letter    (legacy variant arm)
 *   - _ ->        (legacy wildcard arm)
 *
 * The "NOT preceded by identifier char" rule prevents false positives from object
 * property accesses like Status.InProgress (where .I would otherwise look like an arm).
 *
 * Returns [s] when only zero or one arm boundary is found.
 */
export function splitMultiArmString(s: string): string[] {
  const armStartPositions: number[] = [];
  let inString: string | null = null;
  let braceDepth = 0; // skip arm detection inside nested { } blocks
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Track string literal boundaries (skip content inside strings)
    if (inString !== null) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }

    // Skip whitespace (but record position for preceding-char checks below)
    // Track brace depth — skip arm detection inside nested { } blocks
    if (ch === "{") { braceDepth++; i++; continue; }
    if (ch === "}") { if (braceDepth > 0) braceDepth--; i++; continue; }
    if (braceDepth > 0) { i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }

    // New variant arm: .UpperCase or . UpperCase (BS adds spaces around .)
    // Only counts as an arm boundary when NOT preceded by an identifier char.
    // This prevents property accesses like Status.InProgress from triggering.
    // IMPORTANT: skip whitespace before the dot. The block-splitter emits
    // "MarioState . Big" with spaces around '.'. Without skipping whitespace,
    // s[i-1] is ' ' (space), which passes !/[A-Za-z0-9_$]/.test() — incorrectly
    // treating .Big as a new arm start instead of a property access.
    if (ch === "." && i + 1 < s.length) {
      let nextNonSpace = i + 1;
      while (nextNonSpace < s.length && s[nextNonSpace] === " ") nextNonSpace++;
      if (nextNonSpace < s.length && /[A-Z]/.test(s[nextNonSpace])) {
                // An arm boundary is a .UpperCase token followed by => (or ->) at the same depth.
        // This is the only reliable signal that distinguishes arm starts from property accesses
        // in the single-line token-joined format that collectExpr produces (e.g.,
        // "MarioState . Fire . Feather => ..." — .Fire has no arrow, .Feather does).
        //
        // Strategy: look AHEAD past the variant name (and optional payload binding) to check
        // for =>. If present, it's an arm boundary. Otherwise, it's a property access result.
        // Apply the original prevCh rule ONLY when => is NOT found (property access cases like
        // "Status.InProgress .Done => ..." still need splitting at .Done).
        let nameEnd = nextNonSpace;
        while (nameEnd < s.length && /[A-Za-z0-9_]/.test(s[nameEnd])) nameEnd++;
        let afterName = nameEnd;
        while (afterName < s.length && s[afterName] === " ") afterName++;
        // Skip optional payload binding: (binding)
        if (afterName < s.length && s[afterName] === "(") {
          let pd = 1; afterName++;
          while (afterName < s.length && pd > 0) {
            if (s[afterName] === "(") pd++;
            else if (s[afterName] === ")") pd--;
            afterName++;
          }
          while (afterName < s.length && s[afterName] === " ") afterName++;
        }
        // §18 pipe-alternation lookahead: consume `\s*|\s*\.\s*UpperIdent` repetitions
        // so the LEADING `.A` of `.A | .B | .C => result` registers as the arm start.
        while (afterName < s.length && s[afterName] === "|") {
          let p = afterName + 1;
          while (p < s.length && /\s/.test(s[p])) p++;
          if (p >= s.length || s[p] !== ".") break;
          p++;
          while (p < s.length && /\s/.test(s[p])) p++;
          if (p >= s.length || !/[A-Z]/.test(s[p])) break;
          while (p < s.length && /[A-Za-z0-9_]/.test(s[p])) p++;
          while (p < s.length && /\s/.test(s[p])) p++;
          afterName = p;
        }
        const arrow2 = s.slice(afterName, afterName + 2);
        const isFollowedByArrow = arrow2 === "=>" || arrow2 === ":>" || arrow2 === "->";
        if (isFollowedByArrow) {
          // §18 pipe-alternation: when we ARE an alternate (preceding non-space
          // is `|`), do NOT register this `.` as a new arm start — the leading
          // `.A` of the chain already claimed it.
          let back = i - 1;
          while (back >= 0 && /\s/.test(s[back])) back--;
          const isAlternate = back >= 0 && s[back] === "|";
          // Definitive arm start — check original prevCh rule to avoid mid-result property accesses
          const prevCh = i > 0 ? s[i - 1] : null;
          if (!isAlternate && (prevCh === null || !/[A-Za-z0-9_$]/.test(prevCh))) {
            armStartPositions.push(i);
          }
        }
      }
      i++;
      continue;
    }

    // String literal arm: "..." => / "..." -> or '...' => / '...' ->
    // Only counts as an arm boundary when the string is followed by => or ->.
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") j++;
        j++;
      }
      if (j < s.length) {
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        const strArrow2 = s.slice(k, k + 2);
        if (strArrow2 === "=>" || strArrow2 === ":>" || strArrow2 === "->") {
          armStartPositions.push(i);
          inString = q;
          i++;
          continue;
        }
      }
      // Not an arm boundary — string is inside a result expression; track it
      inString = q;
      i++;
      continue;
    }

    // §42 absence arm: not => expr (or :> or ->)
    // Only counts as an arm boundary when preceded by whitespace or at start-of-string,
    // and followed by whitespace and an arrow.
    if (s.slice(i, i + 3) === "not" && (i + 3 >= s.length || /[\s=:\->]/.test(s[i + 3]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        // Verify it's followed by an arrow (skip whitespace)
        let k = i + 3;
        while (k < s.length && /\s/.test(s[k])) k++;
        const notArrow2 = s.slice(k, k + 2);
        if (notArrow2 === "=>" || notArrow2 === ":>" || notArrow2 === "->") {
          armStartPositions.push(i);
          i += 3;
          continue;
        }
      }
    }

    // Wildcard arm: else
    // Only counts as an arm boundary when preceded by whitespace or at start-of-string,
    // and followed by whitespace, =, :, >, -, or end-of-string (arrow or binding).
    if (s.slice(i, i + 4) === "else" && (i + 4 >= s.length || /[\s=:\->(]/.test(s[i + 4]))) {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        armStartPositions.push(i);
        i += 4;
        continue;
      }
    }

    // Legacy variant arm: ::Letter
    if (ch === ":" && i + 1 < s.length && s[i + 1] === ":" && i + 2 < s.length && /[A-Za-z_]/.test(s[i + 2])) {
      armStartPositions.push(i);
      i += 2;
      continue;
    }

    // Legacy wildcard: `_ ->` AND JS-style wildcard alias: `_ =>` / `_ :>`
    // (Bug 1 S95 — the JS-style form was previously missing here. Without
    // this, `.Dragging(d) => d == targetId _ => false` arrived as one
    // concatenated string and the wildcard arm was either dropped or had
    // its `_ => false` text leak into the previous arm's result.)
    //
    // The check requires the `_` to be a STANDALONE token — preceded by
    // start-of-string or whitespace AND followed (after optional whitespace)
    // by `->` / `=>` / `:>`. The prior-char guard prevents false positives
    // from JS identifiers that happen to end in `_` (e.g., a local named
    // `_foo` would never appear at an arm-start position, but `bar_` could
    // legally appear in an arm result and must not be split).
    if (ch === "_") {
      const prevCh = i > 0 ? s[i - 1] : null;
      const isStandalone = prevCh === null || /\s/.test(prevCh);
      // Look past `_` and any whitespace for an arrow.
      let k = i + 1;
      while (k < s.length && /\s/.test(s[k])) k++;
      const arrow2 = s.slice(k, k + 2);
      const isArrow = arrow2 === "->" || arrow2 === "=>" || arrow2 === ":>";
      if (isStandalone && isArrow) {
        armStartPositions.push(i);
      }
    }

    // §42 presence arm: (identifier) => — only when preceded by whitespace or start
    // AND not immediately following a variant-arm name (e.g. `.Circle (r) =>` must
    // NOT be split — the `(r)` is a payload binding, not a presence arm). We look
    // past the preceding whitespace; if the prior non-space char is an identifier
    // character, this `(` belongs to a variant binding and we skip.
    if (ch === "(") {
      const prevCh = i > 0 ? s[i - 1] : null;
      if (prevCh === null || /\s/.test(prevCh)) {
        let back = i - 1;
        while (back >= 0 && /\s/.test(s[back])) back--;
        const priorNonSpace = back >= 0 ? s[back] : null;
        const looksLikeVariantBinding = priorNonSpace !== null && /[A-Za-z0-9_$]/.test(priorNonSpace);
        if (!looksLikeVariantBinding) {
          // Check pattern: ( identifier ) => / :> / ->
          const presenceRe = /^\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)\s*(?:=>|:>|->)/;
          if (presenceRe.test(s.slice(i))) {
            armStartPositions.push(i);
          }
        }
      }
    }

    i++;
  }

  if (armStartPositions.length <= 1) {
    // Single-arm case — strip a trailing arm-separator comma if present
    // (canonical source syntax `match @x { .V => result, .W => result }` puts
    // a `,` between arms; if the input slice ends at one, we need it gone).
    return [s.trim().replace(/,\s*$/, "").trimEnd()];
  }

  const result: string[] = [];
  for (let idx = 0; idx < armStartPositions.length; idx++) {
    const start = armStartPositions[idx];
    const end = idx + 1 < armStartPositions.length ? armStartPositions[idx + 1] : s.length;
    // S96 match-form derived codegen fix — each slice between arm-start
    // positions covers everything UP TO the next arm's start, which includes
    // the source-level `,` arm-separator. Strip that trailing comma so it
    // doesn't leak into `arm.result` via the `[\s\S]+$` capture in
    // parseMatchArm. Pre-fix: `match @x { .A => fn(arg), .B => x }` emitted
    // `return ...fn(arg),;` (invalid JS) because the `,` was captured into
    // arm.result and then `;`-terminated. Stripping a trailing comma here
    // is safe — commas inside the arm body (`fn(a, b)`, `[1, 2]`) are
    // inside `()`/`[]`/`{}` and never trail the arm at depth 0.
    const arm = s.slice(start, end).trim().replace(/,\s*$/, "").trimEnd();
    if (arm) result.push(arm);
  }
  return result.length > 0 ? result : [s];
}

/**
 * Rewrite the text content of a match arm block body `{ ... }`.
 *
 * Match arm blocks are raw text (not structured AST nodes), so reactive
 * assignments `@name = expr` must be rewritten here before rewriteExpr
 * processes `@name` as a getter call.
 *
 * When `machineBindings` is provided, machine-bound reactive assignments
 * are wrapped with `emitTransitionGuard` instead of a plain `_scrml_reactive_set`.
 * This enforces §51 state machine transition rules at runtime.
 *
 * When `engineCtx` is provided (Bug #6, s83-a7), engine-bound (`<engine>`-form)
 * direct assignments route through `emitEngineWriteGuard` — the canonical
 * write-guard path that threads `rule=` enforcement (§51.0.F), `<onTransition>`
 * hook firing (§51.0.H), `internal:rule=` distinct path (§51.0.O), history-cell
 * capture (§51.0.N), and the `.Variant.history` restore-form flag (§51.0.Q.1).
 * Additionally, `engineCtx.exprCtxExtras` is threaded into every `emitExprField`
 * call so `.advance(.X)` calls inside the body dispatch to `_scrml_engine_advance`
 * via the C13 detection arm in `emit-expr.ts:emitCall`.
 *
 * Engine binding wins over machine binding when both are present for the same
 * name (engines are the canonical surface; machines are the deprecated legacy).
 */
export function rewriteBlockBody(
  content: string,
  machineBindings?: Map<string, MachineBindingInfo> | null,
  engineCtx?: EngineRewriteCtx | null,
  // inline-sql-in-branch-cps (2026-06-01): emit-mode for nested `@cell` reads.
  // When "server" (a match arm lowered inside a server batch — see
  // emitMatchExpr / emit-server.ts CPS stub path), `@cell` references resolve
  // to `_scrml_body["cell"]` (the marshalled request payload) rather than the
  // client-only `_scrml_reactive_get("cell")`. Defaults to "client" so every
  // existing caller (event wiring, variant guards) is unaffected.
  mode: "client" | "server" = "client",
): string {
  // C5 (R27): split block-body statements on top-level `;` / newline, but the
  // scanner MUST be STRING-LITERAL-AWARE — a `;` (or `\n`) INSIDE a `"..."` /
  // `'...'` / `` `...` `` span is part of the string value, NOT a statement
  // separator. Previously the splitter tracked only brace/paren/bracket depth,
  // so `@msg = "write failed; rolled back"` split mid-string into
  // `_scrml_reactive_set("msg", "write failed)` + orphaned `rolled back";`
  // (invalid JS at compile-exit-0). Backslash escapes inside quoted strings are
  // skipped; template literals (`` ` ``) are treated as opaque spans (any
  // `${...}` interpolation inside is rare in arm bodies and a top-level `;`
  // inside it is still string content, not a statement boundary).
  const stmts: string[] = [];
  let current = "";
  let depth = 0;
  let strQuote: string | null = null; // active string delimiter: '"' | "'" | "`"
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (strQuote !== null) {
      // Inside a string literal — copy verbatim, honoring backslash escapes.
      if (ch === "\\") {
        current += ch;
        if (i + 1 < content.length) { current += content[i + 1]; i++; }
        continue;
      }
      if (ch === strQuote) strQuote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { strQuote = ch; current += ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if ((ch === ";" || ch === "\n") && depth === 0) {
      const s = current.trim();
      if (s) stmts.push(s);
      current = "";
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) stmts.push(last);

  if (stmts.length === 0) return "";

  // Bug #6 (s83-a7) — build a fresh EmitExprContext for every emitExprField
  // call inside this body so `.advance(.X)` lowering reaches the C13 dispatch
  // path. When engineCtx.exprCtxExtras is null/undefined, the spread is a
  // no-op and we get the same behaviour as the original `{ mode: "client" }`.
  const exprCtx: EmitExprContext = {
    mode,
    ...(engineCtx?.exprCtxExtras ?? {}),
  };

  const results: string[] = [];
  for (const stmt of stmts) {
    const reactiveAssignMatch = stmt.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*([\s\S]+)$/);
    if (reactiveAssignMatch) {
      const name = reactiveAssignMatch[1];
      const rawRhs = reactiveAssignMatch[2].trim();
      // Bug #6 (s83-a7) — engine binding wins. Engine and machine bindings
      // cannot legally share a name (a var is either engine-bound, machine-
      // bound, or plain); when both maps are non-null we still check engine
      // first to mirror the priority used by emit-logic.ts:_emitReactiveSet.
      const engineBinding = engineCtx?.engineBindings?.get(name) ?? null;
      if (engineBinding) {
        // §51.0.N + §51.0.Q.1 (Bug #2 follow-up) — detect the `.Variant.history`
        // structured target form on the RHS. When present, strip the `.history`
        // suffix from the value expression (so the runtime value is the bare
        // variant tag) AND set isHistoryRestore=true so the runtime helper
        // arms the pending-history-restore flag for the dispatcher's
        // composite-arm postMountJs to consume.
        const hist = detectHistoryFormFromString(rawRhs);
        const valueExpr = emitExprField(null, hist.strippedRhs, exprCtx);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { emitEngineWriteGuard } = require("./emit-engine.ts") as {
          emitEngineWriteGuard: (
            binding: import("./emit-engine.ts").EngineBindingInfo,
            newValueExpr: string,
            isHistoryRestore?: boolean,
          ) => string[];
        };
        results.push(emitEngineWriteGuard(engineBinding, valueExpr, hist.isHistoryForm).join("\n"));
        continue;
      }
      const valueExpr = emitExprField(null, rawRhs, exprCtx);
      const binding = machineBindings?.get(name) ?? null;
      if (binding) {
        // §51.5: Emit transition guard instead of plain reactive_set for machine-bound vars
        const guardLines = emitTransitionGuard(
          name,
          valueExpr,
          binding.tableName,
          binding.engineName,
          binding.rules,
          binding.auditTarget ?? null,
        );
        results.push(guardLines.join("\n"));
      } else {
        results.push(`_scrml_reactive_set("${name}", ${valueExpr})`);
      }
    } else {
      results.push(emitExprField(null, stmt, exprCtx));
    }
  }
  return results.join("; ");
}

/**
 * Bug 1.7 inline-arm (S88 v0.3) — detect a `@<name> = <expr>` shape at the
 * head of a match-arm result string AND check whether `<name>` is engine-bound.
 * When detected, returns the parsed binding + the precomputed
 * `emitEngineWriteGuard` lines so the caller can splice them into the arm
 * emission directly (replacing the bare `_scrml_reactive_set` that
 * `emitExprField → emit-expr.ts:emitAssign` would have emitted).
 *
 * Why a separate helper (vs upgrading `emitAssign`):
 *   - `emitEngineWriteGuard` returns an array of statements (multi-line for
 *     hookless engines too: a comment + the call). `emitAssign` returns a single
 *     expression string and is composed inside `emitExpr` which expects an
 *     expression — no place to splice multi-line statement output cleanly.
 *   - The match-arm-result emission path is statement-level (the IIFE
 *     `return` wraps it), so we have a natural splicing site.
 *   - Mirrors the same precedent shape used by `rewriteBlockBody`'s
 *     reactive-assign branch (lines 1189-1217 — `^@<name>\s*=...` regex →
 *     `engineBindings?.get(name)` → `emitEngineWriteGuard`).
 *
 * Mirrors `detectHistoryFormFromString` for the `.Variant.history` restore-form
 * RHS (so inline-arm engine writes targeting a history form work the same way
 * as block-arm + non-match-arm sites).
 *
 * Returns null when the arm result is NOT a `@<name> = ...` shape OR when
 * `<name>` is not engine-bound. The caller falls through to the standard
 * `emitExprField`-based emission in those cases.
 */
function detectInlineEngineWrite(
  armResult: string,
  engineBindings: Map<string, import("./emit-engine.ts").EngineBindingInfo>,
): { binding: import("./emit-engine.ts").EngineBindingInfo; guardLines: string[] } | null {
  // Permit only the assignment-form prefix; compound `@x += y` etc. are out of
  // scope (engine vars are `.Variant`-typed; arithmetic compound-assign isn't
  // a meaningful engine operation). Mirror rewriteBlockBody:1189 regex.
  const m = armResult.match(/^@([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*([\s\S]+)$/);
  if (!m) return null;
  const name = m[1];
  const rawRhs = m[2].trim();
  const binding = engineBindings.get(name);
  if (!binding) return null;
  // §51.0.N + §51.0.Q.1 — strip the `.Variant.history` suffix when present;
  // pass `isHistoryRestore=true` to the guard emitter.
  const hist = detectHistoryFormFromString(rawRhs);
  // Build a fresh EmitExprContext for the RHS so `.advance()` / engine refs
  // inside it route via the C13 detection arm. (No engine-write recursion: an
  // engine write inside an engine write's RHS isn't a meaningful shape.)
  const exprCtx: EmitExprContext = { mode: "client" };
  const valueExpr = emitExprField(null, hist.strippedRhs, exprCtx);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitEngineWriteGuard } = require("./emit-engine.ts") as {
    emitEngineWriteGuard: (
      binding: import("./emit-engine.ts").EngineBindingInfo,
      newValueExpr: string,
      isHistoryRestore?: boolean,
    ) => string[];
  };
  const guardLines = emitEngineWriteGuard(binding, valueExpr, hist.isHistoryForm);
  return { binding, guardLines };
}

/**
 * Emit a match expression compiled to a JS if/else IIFE.
 *
 * `opts` is an opaque pass-through used by emitLogicBody for the structured
 * (match-arm-block) path. Thread it from the caller so engineBindings /
 * machineBindings / declaredNames / boundary survive INTO arm bodies — without
 * it, an `@engineCell = .X` write inside `match v { .V => { @engineCell = ... } }`
 * routes to bare `_scrml_reactive_set` instead of `_scrml_engine_direct_set`,
 * silently bypassing the rule= contract guard. (Bug 1 follow-on, S88.)
 *
 * Bug 1.7 inline-arm follow-on (S88, v0.3 dispatch):
 * Inline-arm results (`. Variant => @engineCell = .X`) flow through
 * `emitExprField` and historically emitted bare `_scrml_reactive_set` (because
 * `emit-expr.ts:emitAssign` is engine-routing-naïve). We now read
 * `opts.engineBindings` + the engine-substrate extras and (a) build an
 * `engineCtx` for `rewriteBlockBody` (used by `{ ... }` arm-result shapes) and
 * (b) detect the `@<name> = expr` shape on inline-arm results, dispatching to
 * `emitEngineWriteGuard` when `<name>` is engine-bound. This brings inline-arm
 * bodies into structural parity with block-arm bodies for engine-write routing
 * (rule= enforcement / <onTransition> hooks / timer arm-clear / history capture
 * / Option-d self-write semantics per §51.0.F.1).
 */
export function emitMatchExpr(node: any, opts?: any): string {
  // Bug 1.7 inline-arm (S88 v0.3) — build an engineCtx from `opts` so the
  // inline-arm result path can dispatch @engineCell writes through the
  // canonical write-guard. `opts` may be undefined (legacy call-sites that
  // don't carry engine context — those have no @engine writes by definition).
  const engineBindings: Map<string, import("./emit-engine.ts").EngineBindingInfo> | null =
    opts?.engineBindings ?? null;
  const engineCtx: EngineRewriteCtx | null = (engineBindings || opts?.engineVarNames) ? {
    engineBindings,
    exprCtxExtras: {
      engineVarNames: opts?.engineVarNames ?? null,
      enginesWithHooks: opts?.enginesWithHooks ?? null,
      enginesWithOnTimeout: opts?.enginesWithOnTimeout ?? null,
      enginesWithIdleWatchdog: opts?.enginesWithIdleWatchdog ?? null,
      enginesWithInternalRules: opts?.enginesWithInternalRules ?? null,
      enginesWithHistory: opts?.enginesWithHistory ?? null,
      // §51.0.S (S155 batch 3) — forward the message-plane routing inputs.
      enginesWithMessageArms: opts?.enginesWithMessageArms ?? null,
      engineMessageVariants: opts?.engineMessageVariants ?? null,
      // §51.0.F (Option A) — forward engine binding-info into nested
      // expression contexts so `@engineCell = .X` writes appearing inside
      // arm-result expressions / event-handler bodies route through
      // `emit-expr.ts:emitAssign`'s engine-routing dispatch.
      engineBindings,
    },
  } : null;
  // Enrich the EmitExprContext used to lower arm results so `.advance(.X)`
  // calls inside inline-arm RHS reach the C13 detection arm in emit-expr.ts.
  // inline-sql-in-branch-cps (2026-06-01): when this match-stmt is being
  // emitted INSIDE a server batch (CPS body-split — emit-server.ts stub path),
  // `opts.boundary === "server"`. In that mode arm-body `@cell` reads must
  // resolve to the marshalled request payload `_scrml_body["cell"]`, and a
  // nested `?{}` lowers to `await _scrml_sql...`, which requires the wrapping
  // IIFE to be `async` + `await`ed (the enclosing server handler IIFE is async).
  const _matchMode: "client" | "server" = opts?.boundary === "server" ? "server" : "client";
  const _matchCtx: EmitExprContext = {
    mode: _matchMode,
    ...(engineCtx?.exprCtxExtras ?? {}),
  };
  const header = emitExprField(node.headerExpr, (node.header ?? "").trim(), _matchCtx);
  const body: any[] = node.body ?? [];

  const tmpVar = genVar("match");

  const arms: MatchArm[] = [];
  for (const child of body) {
    if (!child) continue;
    // Handle structured match-arm-block nodes (from AST builder block body parsing).
    // These come from `. VariantName => { ... }` arms where the body was parsed as AST.
    //
    // Bug 1 fix (S88 dispatch — 14-mario): block-form payload-binding arms
    // (`. Variant(n) => { ... }`) carry `payloadBindings: string[]` from
    // ast-builder.js (Form 1b). Project them into MatchArm.binding so
    // emitVariantBindingPrelude can produce the `const n = tmp.data.field;`
    // statements before the arm body. Without this, references like `n` inside
    // the body emit as unbound JS identifiers → ReferenceError at runtime.
    // (B20 fixed parse + typer for this shape at S69; this closes the CG gap.)
    if (child.kind === "match-arm-block") {
      const payloadBindings = Array.isArray(child.payloadBindings) ? child.payloadBindings : [];
      const binding = payloadBindings.length > 0 ? payloadBindings.join(", ") : null;
      const arm: MatchArm = {
        kind: child.isWildcard ? "wildcard" : child.isNotArm ? "not" : "variant",
        test: child.variant ?? null,
        binding,
        result: "",
        structuredBody: Array.isArray(child.body) ? child.body : null,
      };
      arms.push(arm);
      continue;
    }
    // Handle structured match-arm-inline nodes (from AST builder inline arm parsing).
    // These come from `. VariantName => result` arms where the result is a single expression.
    // The structured node carries pre-parsed test/binding/result fields, so no regex needed.
    if (child.kind === "match-arm-inline") {
      const arm = matchArmInlineToMatchArm(child);
      if (arm) arms.push(arm);
      continue;
    }
    // Prefer string `expr`: match arm text (e.g. `.Variant :> result`) is inherently
    // a multi-part pattern the expression parser can only partially represent.
    // exprNode captures only the first parseable chunk, losing the arrow + result.
    let armExpr: string = child.expr ?? child.header ?? "";
    if (!armExpr && child.exprNode) {
      try { armExpr = emitStringFromTree(child.exprNode); } catch { armExpr = ""; }
    }
    if (typeof armExpr !== "string") continue;
    const trimmed = armExpr.trim();
    if (!trimmed) continue;

    // A single body child may contain all arms concatenated on one line.
    // Split into individual arm strings before parsing (BUG-R13-001).
    // C2 (R27): repair rejoin-spaced `- >` → `->` across the whole arm text
    // BEFORE the splitter scans for arm-boundary arrows (the splitter's arrow
    // lookahead matches a literal 2-char `->`; the spaced form would otherwise
    // be invisible to it). `->` is never a value-expression operator in scrml,
    // so a global collapse of `- >` is safe.
    const armStrings = splitMultiArmString(trimmed.replace(/-\s*>/g, "->"));
    for (const armStr of armStrings) {
      const arm = parseMatchArm(armStr);
      if (arm) arms.push(arm);
    }
  }

  if (arms.length === 0) {
    // D (gate-emitted-js-parse-invariant-2026-05-29; ratified S141, A+D):
    // codegen could not lower ANY arm of this match. Historically this site
    // emitted `/* match expression could not be compiled */ <header>;` — a
    // SILENT STUB that produced INVALID JS in expression position (e.g.
    // `() => /* ... */ _scrml_reactive_get("phase"))` → "missing ) after
    // argument list", the R27 C2 class). Instead, emit a HARD E-CG-003
    // ("unsupported AST node kind in emission") naming the SOURCE construct so
    // the compile FAILS with a source-anchored diagnostic, AND fall back to a
    // SYNTACTICALLY-VALID placeholder so the never-meant-to-run emitted JS
    // still parses (the A backstop must not double-report a known-unlowerable
    // site as a generic invalid-JS defect). When no error channel is threaded
    // (the emit-expr.ts expression-position bridge passes no `opts`), the hard
    // error cannot be recorded here — the A parse gate is then the backstop.
    const matchSrc = (node?.header ?? "").trim() || "<match>";
    const errChannel: CGError[] | null | undefined = opts?.errors;
    if (errChannel) {
      errChannel.push(new CGError(
        "E-CG-003",
        `E-CG-003: match expression \`match ${matchSrc} { ... }\` has no arm the ` +
        `code generator can lower — every arm failed to parse (unsupported arm ` +
        `shape). Rewrite the arms using a documented form (\`.Variant => result\`, ` +
        `\`.Variant(binding) => result\`, \`"string" => result\`, \`else => result\`; ` +
        `the \`->\` / \`:>\` separators are accepted aliases per SPEC §18.2).`,
        (node?.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 }) as Parameters<typeof CGError>[2],
      ));
    }
    // Valid-JS placeholder (parses in statement AND expression position).
    return `(undefined) /* E-CG-003: match expression had no lowerable arms */`;
  }

  // S22 §1a slice 2: decide whether this match needs the tagged-object normalization.
  const needsTagNormalization = hasPayloadBindingOrTaggedVariant(arms);
  const tagVar = needsTagNormalization ? genVar("tag") : tmpVar;

  const iifeLines: string[] = [];
  // inline-sql-in-branch-cps (2026-06-01): a server-batch match-stmt may emit
  // `await` (nested `?{}` SQL) in its arm bodies; the IIFE must therefore be
  // `async` and `await`ed. The enclosing server-handler IIFE is itself async,
  // so an awaited inner async IIFE is well-formed. Client mode keeps the plain
  // synchronous IIFE (no `await` ever appears in client arm bodies).
  iifeLines.push(_matchMode === "server" ? `await (async function() {` : `(function() {`);
  iifeLines.push(`  const ${tmpVar} = ${header};`);
  if (needsTagNormalization) {
    iifeLines.push(
      `  const ${tagVar} = (${tmpVar} != null && typeof ${tmpVar} === "object") ? ${tmpVar}.variant : ${tmpVar};`,
    );
  }

  let conditionIndex = 0;
  for (const arm of arms) {
    // Pre-compute payload binding statements (applies to variant arms only).
    const bindingPrelude = arm.kind === "variant"
      ? emitVariantBindingPrelude(arm, tmpVar)
      : "";

    // Structured body: emit each statement via emitLogicNode (handles lift-expr, etc.)
    // This path is taken for match-arm-block nodes parsed by the AST builder.
    // Bug 1 fix-C (S88 dispatch — 14-mario engine writes): thread `opts` so
    // engine/machine bindings + declaredNames + boundary reach _emitReactiveSet
    // in the arm body. Without this, `@engineCell = .X` inside an arm emits
    // bare `_scrml_reactive_set` and bypasses the rule= contract guard +
    // engine timer/history bookkeeping.
    if (arm.structuredBody) {
      const bodyLines = emitLogicBody(arm.structuredBody, opts).filter(Boolean);
      const structuredInner = bodyLines.join("; ");
      const structuredEmit = structuredInner
        ? `{ ${bindingPrelude}${structuredInner} }`
        : (bindingPrelude ? `{ ${bindingPrelude.trimEnd()} }` : `{}`);
      if (arm.kind === "wildcard") {
        if (arm.binding) {
          iifeLines.push(`  else { const ${arm.binding} = ${tmpVar}; ${structuredEmit} }`);
        } else {
          iifeLines.push(`  else ${structuredEmit}`);
        }
      } else {
        const prefix = conditionIndex === 0 ? "if" : "else if";
        const condition = armCondition(arm, tmpVar, tagVar);
        iifeLines.push(`  ${prefix} (${condition}) ${structuredEmit}`);
        conditionIndex++;
      }
      continue;
    }
    // Detect block-bodied arm results: `{ statements... }`.
    // Block bodies contain statements (reactive assignments, lift calls) — they must NOT
    // be passed to rewriteExpr directly or @name becomes _scrml_reactive_get("name")
    // on the left side of =. Route through rewriteBlockBody instead.
    //
    // Bug 1.7 inline-arm (S88 v0.3) — thread engineCtx so `{ @engineCell = .X }`
    // braced-statement arm bodies route through emitEngineWriteGuard (mirrors
    // the C13 routing already in place for non-match-arm body usage).
    const isBlockBody = arm.result.trimStart().startsWith("{") && arm.result.trimEnd().endsWith("}");
    // Bug 1.7 inline-arm (S88 v0.3) — for the inline-arm (`. V => @e = .X`)
    // shape, detect engine-write at the result level. When detected, swap the
    // standard `return _scrml_reactive_set(...)` emission for a brace-wrapped
    // emission of the canonical `_scrml_engine_direct_set(...)` guard lines.
    // The IIFE return value isn't consumed for assignment-statement arm bodies
    // (the outer `match-stmt` discards it), so dropping `return` is safe.
    const inlineEngineWrite = !isBlockBody && engineBindings
      ? detectInlineEngineWrite(arm.result, engineBindings)
      : null;
    const emitResult = isBlockBody
      ? (() => {
          const inner = arm.result.trim().slice(1, -1).trim();
          return inner ? `{ ${bindingPrelude}${rewriteBlockBody(inner, null, engineCtx, _matchMode)} }` : (bindingPrelude ? `{ ${bindingPrelude.trimEnd()} }` : `{}`);
        })()
      : inlineEngineWrite
        ? `{ ${bindingPrelude}${inlineEngineWrite.guardLines.join("\n")} }`
        : (bindingPrelude
            ? `{ ${bindingPrelude}return ${emitExprField(null, arm.result, _matchCtx)}; }`
            : `return ${emitExprField(null, arm.result, _matchCtx)};`);

    if (arm.kind === "wildcard") {
      if (arm.binding) {
        // §42 presence arm: (x) => expr — bind x to the matched value
        if (isBlockBody) {
          iifeLines.push(`  else { const ${arm.binding} = ${tmpVar}; ${emitResult} }`);
        } else if (inlineEngineWrite) {
          // Bug 1.7 inline-arm (S88 v0.3) — engine-write in a presence arm result.
          // The `emitResult` already wraps the guard lines in braces.
          iifeLines.push(`  else { const ${arm.binding} = ${tmpVar}; ${emitResult} }`);
        } else {
          iifeLines.push(`  else { const ${arm.binding} = ${tmpVar}; return ${emitExprField(null, arm.result, _matchCtx)}; }`);
        }
      } else {
        iifeLines.push(`  else ${emitResult}`);
      }
    } else {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      const condition = armCondition(arm, tmpVar, tagVar);
      iifeLines.push(`  ${prefix} (${condition}) ${emitResult}`);
      conditionIndex++;
    }
  }

  iifeLines.push(`})()`);
  return iifeLines.join("\n");
}

/**
 * Build the if-condition for a variant / string / not arm, respecting whether
 * the match emitter decided to extract a normalized `.variant` tag (tagVar) or
 * is still comparing the raw subject (tmpVar).
 */
function armCondition(arm: MatchArm, tmpVar: string, tagVar: string): string {
  if (arm.kind === "not") {
    return `${tmpVar} === null || ${tmpVar} === undefined`;
  }
  if (arm.kind === "variant") {
    // §18 pipe-alternation: `.A | .B | .C => result` emits OR-chain over the
    // declared alternates. Singleton arms hit the single-equality path
    // (regression-preserving — the `tests` field is undefined or length 1).
    if (arm.tests && arm.tests.length > 1) {
      return arm.tests.map(t => `${tagVar} === "${t}"`).join(" || ");
    }
    return `${tagVar} === "${arm.test}"`;
  }
  return `${tmpVar} === ${arm.test}`;
}

/**
 * Emit `const <local> = <tmpVar>.data.<field>;` statements (one per binding) for
 * a variant arm's payload binding-list. Returns a string ending with `"; "` so
 * callers can concatenate the arm body directly. Returns `""` when the arm has
 * no binding.
 *
 * Field-name resolution:
 *   - Named binding (`field: local`) uses `sourceField` directly — always safe.
 *   - Positional binding uses the module-level variant registry
 *     (_variantFields). If the variant name is not known or is in the
 *     collision set, the emitter skips positional bindings and inserts a
 *     comment so the generated code is still valid JS.
 */
/**
 * Whether the arm set includes at least one variant that will be matched via
 * the tagged-object shape (either because the variant has a known payload field
 * list OR the arm has a binding). When true, callers emit the __tag
 * normalization. When false, unit-only / scalar arms can keep plain equality.
 */
export function hasPayloadBindingOrTaggedVariant(arms: MatchArm[]): boolean {
  return arms.some(a => {
    if (a.kind !== "variant") return false;
    if (a.binding) return true;
    // §18 alternation arms: any alternate that names a payload-bearing variant
    // (in _variantFields) requires tagVar normalization so the OR-chain compares
    // .variant strings rather than the tagged-object value itself.
    if (a.tests && a.tests.length > 1) {
      return a.tests.some(t => _variantFields?.has(t));
    }
    return _variantFields?.has(a.test ?? "") ?? false;
  });
}

export function emitVariantBindingPrelude(arm: MatchArm, tmpVar: string): string {
  if (!arm.binding) return "";
  const bindings = parseBindingList(arm.binding);
  if (bindings.length === 0) return "";

  const variantName = arm.test ?? "";
  const fieldSchema = _variantFields?.get(variantName) ?? null;
  const ambiguous = _variantFieldCollisions?.has(variantName) ?? false;

  const statements: string[] = [];
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    if (b.discard) continue;
    let fieldName: string | null = b.sourceField;
    if (!fieldName) {
      // Positional — resolve against the declared field order.
      if (fieldSchema && !ambiguous && i < fieldSchema.length) {
        fieldName = fieldSchema[i];
      } else {
        statements.push(
          `/* §1a: cannot positionally bind '${b.localName}' — variant '${variantName}' field order unknown${ambiguous ? " (ambiguous across enums)" : ""} */`,
        );
        continue;
      }
    }
    statements.push(`const ${b.localName} = ${tmpVar}.data.${fieldName};`);
  }
  return statements.length > 0 ? statements.join(" ") + " " : "";
}

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

/**
 * Emit a switch statement.
 */
export function emitSwitchStmt(node: any): string {
  const _switchCtx: EmitExprContext = { mode: "client" };
  const header = emitExprField(node.headerExpr, (node.header ?? "").trim(), _switchCtx);
  const lines: string[] = [];
  let cleanHeader = header;
  if (cleanHeader.startsWith("(") && cleanHeader.endsWith(")")) {
    cleanHeader = cleanHeader.slice(1, -1).trim();
  }
  lines.push(`switch (${cleanHeader}) {`);

  const body: any[] = node.body ?? [];
  let i = 0;
  let caseBlockOpen = false;
  while (i < body.length) {
    const child = body[i];
    if (!child) { i++; continue; }

    // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
    if (child.kind === "bare-expr" && (child.exprNode || child.expr)) {
      const exprTrimmed: string = (child.exprNode ? emitStringFromTree(child.exprNode) : (child.expr ?? "")).trim();

      const breakCaseMatch = exprTrimmed.match(/^break\s+(case\s+.*|default\s*:.*)$/s);
      if (breakCaseMatch) {
        lines.push(`    break;`);
        lines.push(`  }`);
        caseBlockOpen = false;
        const caseLabel = breakCaseMatch[1].trim();
        lines.push(`  ${emitExprField(null, caseLabel, _switchCtx)} {`);
        caseBlockOpen = true;
        i++;
        continue;
      }

      if (/^case\s/.test(exprTrimmed) || /^default\s*:/.test(exprTrimmed)) {
        if (caseBlockOpen) {
          lines.push(`  }`);
        }
        lines.push(`  ${emitExprField(null, exprTrimmed, _switchCtx)} {`);
        caseBlockOpen = true;
        i++;
        continue;
      }
    }

    const code = emitLogicNode(child);
    if (code) {
      for (const line of code.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    i++;
  }

  if (caseBlockOpen) {
    lines.push(`  }`);
  }

  lines.push(`}`);
  return lines.join("\n");
}
