/**
 * failable-value-calls.ts — S467 (§19.4.3 / §19.4.4, E-ERROR-002).
 *
 * "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile
 * error: E-ERROR-002" (§19.4.3). The ways are: `match`, `?` (inside a `!` function), `!{}`, an
 * `<errorBoundary>` around a render-time call, and a `<request>` body's right-hand side. A call
 * whose result is USED — an initializer, a write, an argument, an operand, a `return` operand, an
 * array/object member, a template interpolation — is handled by none of them unless its value
 * reaches one.
 *
 * ONE rule for "handled" (S467 fix round 2): a failable call is handled by a `!{}` / `match` / `?`
 * only if its VALUE REACHES that handling form UNCHANGED —
 *   - through parentheses (the tree carries no parenthesis node, so they are transparent);
 *   - as an operand that `||` / `??` returns as-is (both sides: an error value is truthy and not
 *     nullish, so a failed LEFT operand is the result), or the RIGHT operand of `&&` (the left
 *     operand of `&&` is only tested — an error value is truthy, so `&&` discards it);
 *   - as a ternary arm (the condition is only tested).
 * Any transformation between the call and the handler — a member access (`.toString()`, `.ok`,
 * `["variant"]`), being an argument to another call, a coercing operator (`!`, `==`, `+`, a
 * template) — means the handler sees something else, so the call's own result is in a VALUE
 * POSITION: unhandled.
 *
 * WHERE it looks: every expression container. An expression tree is walked in full, including
 * the bodies of the functions written inside it — an expression-bodied arrow, a block-bodied
 * arrow, a `function () { … }` expression (structured, or carried as an escape hatch with its
 * body text, which is PARSED with the compiler's own front-end — never scanned, project Rule 7),
 * and parameter defaults. A function body is not render-time and is not a `!` function unless
 * declared so. A statement list reached this way (a function expression's body, an `on mount`
 * body, a `!{}` arm body, a C-style `for` initializer) is walked with the same rule; its
 * declarations shadow outer names, and a binding whose initializer is (or resolves to) a failable
 * function is an ALIAS — calling it is calling that function (fails closed).
 *
 * Whether an OUTER name is a failable function (and whether a binding outside the walk shadows
 * it) is the caller's decision: it owns the scope chain and the failable-function table
 * (`env.resolveOuter`). This module only reports the calls that resolve to one, with the context
 * the caller needs to classify them.
 *
 * A CALLEE is judged by its VALUE, not by its spelling (S468): a call is a failable call when the
 * function its callee evaluates to MAY be a failable function (`failableFnValueOf`) — a name bound
 * to one, a ternary / `||` / `??` / `&&` that may choose one, a call of a function that may RETURN
 * one (`getF()(p)`, `const g = getF(); g(p)`). One fail-closed judgement covers every alias shape
 * instead of one syntactic chain per review round. The same judgement decides what a `match`
 * subject carries (`failableResultCallees`): the failable calls whose result reaches the subject
 * unchanged — so the check that ACCEPTS a `match` as handling a call and the lowering that
 * DISCRIMINATES that call's error read one answer.
 */

import type { ExprNode, CallExpr, LambdaExpr } from "./types/ast.ts";
import { templateInterpolationNodes, guardCallArmsRaw } from "./expression-parser.ts";

export interface FailableEnv {
  /**
   * The failable function an OUTER name (not bound inside the walk) refers to — the name itself
   * for a failable function, the aliased function for a binding that aliases one — or null.
   */
  resolveOuter(name: string): string | null;
  /**
   * The failable function a CALL of an outer name may return (`function getF() { return check }`
   * → `check`), or null. Fail closed: a function any of whose returns may be one returns one.
   */
  resolveOuterReturns(name: string): string | null;
  /**
   * An expression-position `match` whose subject carries the result of failable calls (the
   * failable functions named): the caller stamps it, so its lowering discriminates the error.
   */
  onFailableMatchSubject?(node: ExprNode, callees: string[]): void;
  /** Parse a text-carried statement body into statements (the compiler's own front-end); null when it does not parse. */
  parseStatements(text: string): unknown[] | null;
  /** Parse expression text into an ExprNode; null when it does not parse. */
  parseExpr(text: string): ExprNode | null;
  /** The arms of an expression-position `!{ … }` (its raw handler text); null when they do not parse. */
  parseGuardArms(raw: string): unknown[] | null;
  /** The body text of one raw inline-`match` arm (`pattern :> body`); null when it does not split. */
  matchArmBodyText(raw: string): string | null;
}

export interface FailableCallCandidate {
  /** The call node (null for a call carried without one, e.g. a markup call-ref). */
  call: CallExpr | null;
  /** The failable function the callee resolves to. */
  calleeName: string;
  /** The callee as written when it is an alias of `calleeName` (`const g = check; g(p)`). */
  via: string | null;
  /** The call is inside a function written within the walked tree (never render-time). */
  inFunction: boolean;
  /** `inFunction` and that innermost function is declared `!`. */
  inFailableFn: boolean;
}

export type RootHandling =
  /** Nothing handles the root: every failable call in it is reported. */
  | "none"
  /** The root is a whole statement: a call that IS the root is the statement check's (not reported here). */
  | "statement-call"
  /** The root is the operand of a handling form: a call whose value reaches it unchanged is handled. */
  | "operand"
  /** The root is a `match` subject: handled exactly like an operand (see matchSubject). */
  | "match-subject"
  /** The root is one scrutinee of a §18.19 multi-scrutinee head: only a direct call is handled. */
  | "multi-scrutinee";

type Cb = (c: FailableCallCandidate) => void;

/**
 * Names bound inside the walk, innermost first. A name maps to the failable function it aliases,
 * or null for a binding that is not a failable function (it shadows an outer one).
 */
class LocalScope {
  readonly names = new Map<string, string | null>();
  /** Per bound name: the failable function a CALL of it may return (`const mk = () => check`). */
  readonly returns = new Map<string, string>();
  constructor(readonly parent: LocalScope | null) {}
  child(): LocalScope { return new LocalScope(this); }
}

interface FnCtx { inFunction: boolean; inFailableFn: boolean; }
const TOP: FnCtx = { inFunction: false, inFailableFn: false };
const PLAIN_FN: FnCtx = { inFunction: true, inFailableFn: false };

function resolveName(name: string, scope: LocalScope | null, env: FailableEnv): string | null {
  for (let s = scope; s !== null; s = s.parent) {
    if (s.names.has(name)) return s.names.get(name) ?? null;
  }
  return env.resolveOuter(name);
}

/** Whether a scope of the walk (not the caller's) binds `name`. */
function localBinds(name: string, scope: LocalScope | null): boolean {
  for (let s = scope; s !== null; s = s.parent) if (s.names.has(name)) return true;
  return false;
}

function resolveReturns(name: string, scope: LocalScope | null, env: FailableEnv): string | null {
  for (let s = scope; s !== null; s = s.parent) {
    if (s.names.has(name)) return s.returns.get(name) ?? null;
  }
  return env.resolveOuterReturns(name);
}

/** How a function-value judgement resolves a NAME: what it may be, and what a call of it may return. */
export interface FnValueLookup {
  is(name: string): string | null;
  returns(name: string): string | null;
}

function scopeLookup(scope: LocalScope | null, env: FailableEnv): FnValueLookup {
  return { is: (n) => resolveName(n, scope, env), returns: (n) => resolveReturns(n, scope, env) };
}

/**
 * The failable function the VALUE of `node` may be, or null — read from the tree, failing closed
 * over the flow it shows:
 *   - a name: what it is bound to (a failable function, or a binding that may hold one);
 *   - a ternary: either arm; `||` / `??`: either operand; `&&`: its right operand (a function is
 *     truthy, so `f && g` is `g` — the left operand is only tested);
 *   - an assignment: its value; a cast: its operand;
 *   - a call: what the called function may return (a name's `returns`, an arrow's body).
 * A lambda is a plain function value: a failable call in its BODY is reported where the body is
 * walked. A member / index read cannot yield a function — no value holds one (§14.3,
 * E-VALUE-FUNCTION-STORED).
 */
export function failableFnValueOf(node: ExprNode | null | undefined, lk: FnValueLookup, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 64) return null;
  switch (node.kind) {
    case "ident": return typeof node.name === "string" ? lk.is(node.name) : null;
    case "ternary":
      return failableFnValueOf(node.consequent, lk, depth + 1) ?? failableFnValueOf(node.alternate, lk, depth + 1);
    case "binary":
      if (node.op === "||" || node.op === "??") {
        return failableFnValueOf(node.left, lk, depth + 1) ?? failableFnValueOf(node.right, lk, depth + 1);
      }
      if (node.op === "&&") return failableFnValueOf(node.right, lk, depth + 1);
      return null;
    case "assign":
      if (node.op === "=" || node.op === "&&=") return failableFnValueOf(node.value, lk, depth + 1);
      if (node.op === "||=" || node.op === "??=") {
        return failableFnValueOf(node.target, lk, depth + 1) ?? failableFnValueOf(node.value, lk, depth + 1);
      }
      return null;
    case "cast": return failableFnValueOf(node.expression, lk, depth + 1);
    case "call": {
      if (guardCallArmsRaw(node) !== null) return null;
      return failableFnReturnOfCallee(node.callee, lk, depth + 1);
    }
    default: return null;
  }
}

/** The failable function calling `callee` may return (`getF` → what `getF` returns). */
function failableFnReturnOfCallee(callee: ExprNode | null | undefined, lk: FnValueLookup, depth: number): string | null {
  if (!callee || typeof callee !== "object" || depth > 64) return null;
  switch (callee.kind) {
    case "ident": return typeof callee.name === "string" ? lk.returns(callee.name) : null;
    case "lambda":
      return callee.body && callee.body.kind === "expr" ? failableFnValueOf(callee.body.value, lk, depth + 1) : null;
    case "ternary":
      return failableFnReturnOfCallee(callee.consequent, lk, depth + 1) ?? failableFnReturnOfCallee(callee.alternate, lk, depth + 1);
    case "binary":
      if (callee.op === "||" || callee.op === "??") {
        return failableFnReturnOfCallee(callee.left, lk, depth + 1) ?? failableFnReturnOfCallee(callee.right, lk, depth + 1);
      }
      if (callee.op === "&&") return failableFnReturnOfCallee(callee.right, lk, depth + 1);
      return null;
    default: return null;
  }
}

/**
 * The failable call a call node makes, or null: the failable function its callee's value may be.
 * The expression-position `!{ … }` sentinel call is the handler, not a call.
 */
export function failableCalleeOf(node: ExprNode | null | undefined, lk: FnValueLookup): string | null {
  if (!node || node.kind !== "call" || guardCallArmsRaw(node) !== null || !node.callee) return null;
  return node.callee.kind === "ident" ? lk.is(node.callee.name) : failableFnValueOf(node.callee, lk);
}

/**
 * The failable calls whose RESULT reaches `node`'s value unchanged (the rule a handling form reads,
 * see the module header): the call itself; either operand of `||` / `??`; the right of `&&`; either
 * ternary arm. Returns the failable functions called (deduplicated). A `match` on `node` matches
 * these calls' results, so it must discriminate their errors.
 */
export function failableResultCallees(node: ExprNode | null | undefined, lk: FnValueLookup): string[] {
  const out: string[] = [];
  const go = (e: ExprNode | null | undefined, depth: number): void => {
    if (!e || typeof e !== "object" || depth > 64) return;
    if (e.kind === "call") {
      const t = failableCalleeOf(e, lk);
      if (t !== null && !out.includes(t)) out.push(t);
      return;
    }
    if (e.kind === "binary" && (e.op === "||" || e.op === "??")) { go(e.left, depth + 1); go(e.right, depth + 1); return; }
    if (e.kind === "binary" && e.op === "&&") { go(e.right, depth + 1); return; }
    if (e.kind === "ternary") { go(e.consequent, depth + 1); go(e.alternate, depth + 1); }
  };
  go(node, 0);
  return out;
}

/** Statement kinds whose expressions are read. */
export const VALUE_POSITION_STMT_KINDS: ReadonlySet<string> = new Set([
  "bare-expr", "let-decl", "const-decl", "state-decl", "lin-decl", "tilde-decl",
  "return-stmt", "propagate-expr", "if-stmt", "while-stmt", "while-loop", "do-while-stmt",
  "for-stmt", "for-loop", "match-stmt", "match-expr", "match-arm-inline",
  "reactive-nested-assign", "reactive-array-mutation", "guarded-expr", "function-decl",
  ...["when-effect", "when-message", "when-worker-message", "when-worker-error", "onchange-decl"],
]);

/** Reactive / message / channel bodies carried as text (`bodyRaw`) — effects, never render-time. */
const TEXT_BODY_EFFECT_KINDS = new Set(["when-effect", "when-message", "when-worker-message", "when-worker-error"]);

const EXPR_NODE_KINDS = new Set([
  "ident", "lit", "array", "object", "spread", "unary", "binary", "assign", "ternary",
  "member", "index", "call", "new", "lambda", "cast", "match-expr", "map-lit", "sql-ref",
  "input-state-ref", "escape-hatch", "markup-value", "reset-expr",
]);

/**
 * Keys that hold CHILD STATEMENTS (or a nested statement-shaped node) — never an expression of
 * this statement. The main walk visits them as statements; the statement walk here recurses.
 */
export const STATEMENT_CHILD_KEYS: ReadonlySet<string> = new Set([
  "guardedNode", "body", "consequent", "alternate", "children", "arms", "thenBody", "elseBody",
  "cases", "armBody", "failExpr", "matchExpr", "fnExprNode", "handlerBlock",
]);

/**
 * Keys whose expression is the OPERAND of a handling form: a `match` head (one scrutinee, or
 * every scrutinee of a §18.19 multi-scrutinee head) and the operand of a `?` ending a `match`
 * arm (§19.5.1, `propagateOperandExpr`).
 */
const HANDLED_OPERAND_KEYS = new Map<string, RootHandling>([
  ["headerExpr", "match-subject"], ["scrutineeExprs", "multi-scrutinee"], ["propagateOperandExpr", "operand"],
]);

/** Keys walked specially (below), never by the generic expression-key loop. */
const SPECIAL_KEYS = new Set(["span", "id", "params", "cStyleParts"]);

const DECL_KINDS = new Set(["let-decl", "const-decl", "tilde-decl", "lin-decl", "state-decl"]);

export function isExprNodeValue(v: unknown): v is ExprNode {
  if (!v || typeof v !== "object") return false;
  const k = (v as { kind?: unknown }).kind;
  if (typeof k !== "string" || !EXPR_NODE_KINDS.has(k)) return false;
  // The statement-shaped `match-expr` (header + body) shares the kind; the
  // expression one carries `subject`.
  return k !== "match-expr" || "subject" in (v as object);
}

function isParseErrorHatch(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "escape-hatch"
    && (v as { nativeKind?: unknown }).nativeKind === "ParseError";
}

function paramNames(params: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(params)) return out;
  for (const p of params) {
    if (!p) continue;
    if (typeof p === "string") { out.push(p); continue; }
    const pp = p as { boundNames?: unknown; name?: unknown };
    if (Array.isArray(pp.boundNames)) out.push(...(pp.boundNames as string[]));
    else if (typeof pp.name === "string") out.push(pp.name);
  }
  return out;
}

/** The names a declaration statement binds. */
function declaredNames(stmt: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof stmt.name === "string") out.push(stmt.name);
  if (Array.isArray(stmt.boundNames)) out.push(...(stmt.boundNames as string[]));
  return out;
}

/** How a callee that is not a bare name is shown in a diagnostic (`getF()`, `a value`). */
function calleeDisplay(callee: ExprNode): string {
  if (callee.kind === "call" && callee.callee && callee.callee.kind === "ident") return `${callee.callee.name}()`;
  return "a function value";
}

class Walker {
  /**
   * When set, the values `return`ed by the function whose context is `ctx` (not by functions nested
   * in it) are judged here: the failable function any of them may be (`failableFnReturnedBy`).
   */
  returnSink: { ctx: FnCtx; found: string | null } | null = null;

  constructor(readonly env: FailableEnv, readonly cb: Cb) {}

  report(call: CallExpr | null, written: string, scope: LocalScope | null, fn: FnCtx): void {
    const target = resolveName(written, scope, this.env);
    if (target === null) return;
    this.cb({ call, calleeName: target, via: target === written ? null : written,
      inFunction: fn.inFunction, inFailableFn: fn.inFunction && fn.inFailableFn });
  }

  /** A call whose callee is not a bare name: failable when the callee's VALUE may be a failable function. */
  reportValueCallee(call: CallExpr, scope: LocalScope | null, fn: FnCtx): void {
    const target = failableFnValueOf(call.callee, scopeLookup(scope, this.env));
    if (target === null) return;
    this.cb({ call, calleeName: target, via: calleeDisplay(call.callee),
      inFunction: fn.inFunction, inFailableFn: fn.inFunction && fn.inFailableFn });
  }

  // ---- expressions --------------------------------------------------------

  /** A value position: every failable call in `node` is reported. */
  expr(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    switch (node.kind) {
      case "call": {
        // An expression-position `!{ … }` (`<operand> .__scrml_guard__("!{ … }")`): its operand
        // is handled where its value reaches the handler unchanged. The handler's own arm
        // bodies are text inside the sentinel: parsed and walked as arm bodies.
        const armsRaw = guardCallArmsRaw(node);
        if (armsRaw !== null && node.callee.kind === "member") {
          this.operand(node.callee.object, scope, fn);
          const arms = this.env.parseGuardArms(armsRaw);
          if (arms) this.guardArms({ arms }, scope, fn);
          return;
        }
        if (node.callee && node.callee.kind === "ident") this.report(node, node.callee.name, scope, fn);
        else {
          if (node.callee) this.reportValueCallee(node, scope, fn);
          this.expr(node.callee, scope, fn);
        }
        for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
        return;
      }
      case "new": {
        this.expr(node.callee, scope, fn);
        for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
        return;
      }
      case "match-expr": {
        // The inline `match` handles its subject (§19.4.3 item 1). For a multi-scrutinee head
        // every scrutinee is a subject. Its arm results are values.
        const subjects = Array.isArray(node.subjects) && node.subjects.length > 0 ? node.subjects : [node.subject];
        for (const s of subjects) {
          if (subjects.length === 1) this.matchSubject(s, scope, fn);
          else this.directCallSubject(s, scope, fn);
        }
        if (subjects.length === 1 && this.env.onFailableMatchSubject) {
          const callees = failableResultCallees(subjects[0], scopeLookup(scope, this.env));
          if (callees.length > 0) this.env.onFailableMatchSubject(node, callees);
        }
        // Its arms are kept raw (`pattern :> body`): each body is a value (or a block whose
        // statements are walked).
        for (const raw of node.rawArms ?? []) {
          if (typeof raw !== "string") continue;
          const body = this.env.matchArmBodyText(raw.trim());
          const stmts = body === null ? null : this.env.parseStatements(body);
          if (stmts) this.statements(stmts, scope, fn);
        }
        return;
      }
      case "lambda": this.lambda(node, scope, fn); return;
      case "lit": {
        if (node.litType === "template" && node.hasInterpolation !== false && typeof node.raw === "string") {
          for (const e of templateInterpolationNodes(node)) this.expr(e, scope, fn);
        }
        return;
      }
      case "escape-hatch": this.escapeHatch(node as unknown as Record<string, unknown>, scope, fn); return;
      case "ident": case "sql-ref": case "input-state-ref": case "markup-value": return;
      case "array": for (const el of node.elements) this.expr(el as ExprNode, scope, fn); return;
      case "object":
        for (const p of node.props) {
          if (p.kind === "prop") {
            if (typeof p.key !== "string") this.expr(p.key as ExprNode, scope, fn);
            this.expr(p.value, scope, fn);
          } else if (p.kind === "spread") this.expr(p.argument, scope, fn);
        }
        return;
      case "map-lit": for (const e of node.entries) { this.expr(e.key, scope, fn); this.expr(e.value, scope, fn); } return;
      case "spread": this.expr(node.argument, scope, fn); return;
      case "unary": this.expr(node.argument, scope, fn); return;
      case "binary": this.expr(node.left, scope, fn); this.expr(node.right, scope, fn); return;
      case "assign": this.expr(node.target, scope, fn); this.expr(node.value, scope, fn); return;
      case "ternary": this.expr(node.condition, scope, fn); this.expr(node.consequent, scope, fn); this.expr(node.alternate, scope, fn); return;
      case "member": this.expr(node.object, scope, fn); return;
      case "index": this.expr(node.object, scope, fn); this.expr(node.index, scope, fn); return;
      case "cast": this.expr(node.expression, scope, fn); return;
      case "reset-expr": this.expr(node.target, scope, fn); return;
      default: { const _never: never = node; return; }
    }
  }

  /**
   * The operand of a handling form: a call whose value reaches the handler UNCHANGED is handled
   * (its arguments are still value positions); everything else is a value position.
   */
  operand(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    if (node.kind === "call" && guardCallArmsRaw(node) === null && node.callee) {
      // The call's own result reaches the handler: not reported. Its callee (when it is not a
      // bare name) and its arguments are values.
      if (node.callee.kind !== "ident") this.expr(node.callee, scope, fn);
      for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
      return;
    }
    if (node.kind === "binary" && (node.op === "||" || node.op === "??")) {
      this.operand(node.left, scope, fn);
      this.operand(node.right, scope, fn);
      return;
    }
    if (node.kind === "binary" && node.op === "&&") {
      this.expr(node.left, scope, fn);
      this.operand(node.right, scope, fn);
      return;
    }
    if (node.kind === "ternary") {
      this.expr(node.condition, scope, fn);
      this.operand(node.consequent, scope, fn);
      this.operand(node.alternate, scope, fn);
      return;
    }
    this.expr(node, scope, fn);
  }

  /**
   * A `match` subject: an operand like any other handling form's (S468). A call whose result
   * reaches the subject unchanged (`match (a || check(p)) { .Denied :> … }`) is handled, and the
   * lowering discriminates its error: the caller stamps the match from `failableResultCallees` —
   * the same reaches-unchanged reading — so a subject accepted here is one whose error the arms
   * see (`g-match-failable-subject-through-operator-miscompiled-s467`, resolved).
   */
  matchSubject(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    this.operand(node, scope, fn);
  }

  /**
   * One scrutinee of a §18.19 multi-scrutinee head: only a call that IS the scrutinee is handled
   * (the multi-scrutinee lowering is not widened by S468); everything else is a value position.
   */
  directCallSubject(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    if (node.kind === "call" && guardCallArmsRaw(node) === null && node.callee && node.callee.kind === "ident") {
      for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
      return;
    }
    this.expr(node, scope, fn);
  }

  root(node: ExprNode | null | undefined, handling: RootHandling, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    if (handling === "operand") { this.operand(node, scope, fn); return; }
    if (handling === "match-subject") { this.matchSubject(node, scope, fn); return; }
    if (handling === "multi-scrutinee") { this.directCallSubject(node, scope, fn); return; }
    // A whole-statement call of a failable function by its own name is the statement check's; one
    // made through an alias (`const g = check` then `g(p)`) is not — that check reads names only.
    if (handling === "statement-call" && node.kind === "call" && guardCallArmsRaw(node) === null
        && node.callee && node.callee.kind === "ident") {
      const target = resolveName(node.callee.name, scope, this.env);
      if (target === null || target === node.callee.name) {
        for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
        return;
      }
    }
    this.expr(node, scope, fn);
  }

  /** A parameter list: its names shadow; its defaults are evaluated at call time (in the function). */
  params(params: unknown, scope: LocalScope, fn: FnCtx): void {
    for (const n of paramNames(params)) scope.names.set(n, null);
    if (!Array.isArray(params)) return;
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const d = (p as { defaultValue?: unknown }).defaultValue;
      if (isExprNodeValue(d)) this.expr(d, scope, fn);
      else if (typeof d === "string" && d.trim() !== "") this.expr(this.env.parseExpr(d), scope, fn);
      const pat = (p as { pattern?: unknown }).pattern;
      if (pat && typeof pat === "object") this.patternDefaults(pat, scope, fn);
    }
  }

  patternDefaults(pat: unknown, scope: LocalScope, fn: FnCtx): void {
    const seen = new WeakSet<object>();
    const go = (v: unknown): void => {
      if (!v || typeof v !== "object" || seen.has(v as object)) return;
      seen.add(v as object);
      if (Array.isArray(v)) { for (const x of v) go(x); return; }
      if (isExprNodeValue(v)) { this.expr(v, scope, fn); return; }
      for (const k of Object.keys(v as object)) if (k !== "span") go((v as Record<string, unknown>)[k]);
    };
    go(pat);
  }

  lambda(node: LambdaExpr, scope: LocalScope | null, _fn: FnCtx): void {
    const inner = new LocalScope(scope);
    this.params(node.params, inner, PLAIN_FN);
    if (node.body && node.body.kind === "expr") this.expr(node.body.value, inner, PLAIN_FN);
    else if (node.body && node.body.kind === "block") this.statements(node.body.stmts as unknown[], inner, PLAIN_FN);
  }

  escapeHatch(node: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx): void {
    const nk = node.nativeKind;
    const raw = node.raw;
    if (nk === "TemplateLiteral" && typeof raw === "string" && raw.startsWith("`")) {
      for (const e of templateInterpolationNodes(node as unknown as ExprNode & { raw: string; span: never })) this.expr(e, scope, fn);
      return;
    }
    // A function written as a value and carried with its body TEXT (`function () { … }`, a
    // block-bodied arrow): its body is a function body like any other — parse it and walk it.
    if (typeof node.bodyRaw === "string") {
      const inner = new LocalScope(scope);
      this.params(node.params, inner, PLAIN_FN);
      const stmts = this.env.parseStatements(node.bodyRaw);
      if (stmts) this.statements(stmts, inner, PLAIN_FN);
      return;
    }
    // Any other hatch carries no structure to read (it is not re-scanned).
  }

  // ---- statements ---------------------------------------------------------

  /** A statement list in its own block scope. */
  statements(stmts: unknown[], scope: LocalScope | null, fn: FnCtx, handling: RootHandling = "none"): void {
    const block = new LocalScope(scope);
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      const st = s as Record<string, unknown>;
      const decl = st.kind === "guarded-expr" && st.guardedNode && typeof st.guardedNode === "object"
        ? st.guardedNode as Record<string, unknown> : st;
      if (DECL_KINDS.has(decl.kind as string) || decl.kind === "function-decl") {
        for (const n of declaredNames(decl)) {
          if (block.names.has(n)) continue;
          // A bare `g = v` (a tilde-decl) WRITES an enclosing local `g` when one exists: it does
          // not declare a new one here (recordAlias then records on that binding's scope).
          if (decl.kind === "tilde-decl" && localBinds(n, scope)) continue;
          block.names.set(n, decl.kind === "function-decl" && decl.canFail === true ? n : null);
        }
      }
    }
    // A local function that returns a failable function: calling it yields one (hoisted, like the name).
    for (const s of stmts) {
      const st = s as Record<string, unknown> | null;
      if (!st || typeof st !== "object" || st.kind !== "function-decl" || typeof st.name !== "string") continue;
      const ret = failableFnReturnedByDecl(st, block, this.env);
      if (ret !== null) block.returns.set(st.name, ret);
    }
    for (const s of stmts) if (s && typeof s === "object") this.statement(s as Record<string, unknown>, block, fn, handling);
  }

  /**
   * One statement (and, in this walk, its child statements). `handling` — the statement is the
   * guarded node of a `!{}` (its expressions' roots are that handler's operand).
   */
  statement(st: Record<string, unknown>, scope: LocalScope, fn: FnCtx, handling: RootHandling): void {
    const kind = st.kind as string;
    if (kind === "function-decl") {
      const inner = scope.child();
      const fnCtx: FnCtx = { inFunction: true, inFailableFn: st.canFail === true };
      this.params(st.params, inner, fnCtx);
      if (Array.isArray(st.body)) this.statements(st.body as unknown[], inner, fnCtx);
      return;
    }
    if (kind === "return-stmt" && this.returnSink && this.returnSink.ctx === fn && this.returnSink.found === null) {
      this.returnSink.found = failableFnValueOf(st.exprNode as ExprNode | undefined, scopeLookup(scope, this.env));
    }
    if (kind === "guarded-expr") {
      if (st.guardedNode && typeof st.guardedNode === "object") {
        this.statement(st.guardedNode as Record<string, unknown>, scope, fn, "operand");
      }
      this.guardArms(st, scope, fn);
      return;
    }
    this.ownExpressions(st, scope, fn, handling === "operand" ? "operand" : kind === "propagate-expr" ? "operand" : "none");
    // A local alias: `const g = check` / `g = check` binds `g` to the failable function.
    this.recordAlias(st, scope);
    // Child statements, each in its own block.
    if (kind === "for-stmt" || kind === "for-loop") {
      const loop = scope.child();
      for (const n of paramNames(Array.isArray(st.variable) ? st.variable : st.variable ? [st.variable] : [])) loop.names.set(n, null);
      this.cStyleParts(st, loop, fn);
      if (Array.isArray(st.body)) this.statements(st.body as unknown[], loop, fn);
      return;
    }
    for (const key of STATEMENT_CHILD_KEYS) {
      if (key === "guardedNode") continue;
      const v = st[key];
      if (Array.isArray(v)) {
        if (key === "arms" && kind !== "match-stmt" && kind !== "match-expr") continue;
        this.statements(v, scope, fn);
      } else if (v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string" && !isExprNodeValue(v)) {
        this.statement(v as Record<string, unknown>, scope, fn, "none");
      }
    }
  }

  /**
   * A `when … changes` / `when message` body, or a `<channel>` `<onchange>` arm body: statements
   * carried as text, run as an effect (not render-time, not a `!` function). Read from the text
   * when it parses (the single-expression `bodyExpr` view is the same body).
   */
  effectBodies(st: Record<string, unknown>): void {
    const bodies: Array<{ raw: unknown; expr: unknown; binding: unknown }> = [];
    if (TEXT_BODY_EFFECT_KINDS.has(st.kind as string)) bodies.push({ raw: st.bodyRaw, expr: st.bodyExpr, binding: st.binding });
    if (st.kind === "onchange-decl" && Array.isArray(st.arms)) {
      for (const a of st.arms) if (a && typeof a === "object") bodies.push({ raw: (a as Record<string, unknown>).bodyRaw, expr: null, binding: (a as Record<string, unknown>).binding });
    }
    for (const b of bodies) {
      const scope = new LocalScope(null);
      if (typeof b.binding === "string" && b.binding.trim() !== "") scope.names.set(b.binding.trim(), null);
      const stmts = typeof b.raw === "string" && b.raw.trim() !== "" ? this.env.parseStatements(b.raw) : null;
      if (stmts) this.statements(stmts, scope, PLAIN_FN);
      else if (isExprNodeValue(b.expr)) this.root(b.expr, "none", scope, PLAIN_FN);
    }
  }

  /**
   * `const g = <value>` (or `g = <value>`): `g` holds the failable function the value may be
   * (`check`, `p ? check : id`, `check || id`, `getF()`), and a call of `g` returns what the value's
   * call may return (`const mk = () => check`). Judged by value (`failableFnValueOf`), fail closed.
   */
  recordAlias(st: Record<string, unknown>, scope: LocalScope): void {
    let name: string | null = null;
    let init: ExprNode | undefined;
    if (DECL_KINDS.has(st.kind as string) && typeof st.name === "string") {
      name = st.name;
      init = st.initExpr as ExprNode | undefined;
    } else if (st.kind === "bare-expr") {
      const e = st.exprNode as ExprNode | undefined;
      if (e && e.kind === "assign" && e.target && e.target.kind === "ident") { name = e.target.name; init = e; }
    }
    if (name === null || !init) return;
    const lk = scopeLookup(scope, this.env);
    const target = failableFnValueOf(init, lk);
    const returns = lambdaOrValueReturns(init.kind === "assign" ? init.value : init, scope, this.env, lk);
    if (target === null && returns === null) return;
    // Bind in the innermost scope that already declares it; else this block.
    let owner: LocalScope = scope;
    for (let s: LocalScope | null = scope; s !== null; s = s.parent) {
      if (s.names.has(name)) { owner = s; break; }
    }
    if (target !== null) owner.names.set(name, target);
    else if (!owner.names.has(name)) owner.names.set(name, resolveName(name, scope, this.env));
    if (returns !== null) owner.returns.set(name, returns);
  }

  /** A C-style `for`'s parts: the initializer (a declaration, carried as text), test and update. */
  cStyleParts(st: Record<string, unknown>, loop: LocalScope, fn: FnCtx): void {
    const parts = st.cStyleParts as Record<string, unknown> | undefined;
    if (!parts || typeof parts !== "object") return;
    const init = parts.initExpr;
    if (isParseErrorHatch(init) && typeof (init as { raw?: unknown }).raw === "string") {
      const stmts = this.env.parseStatements((init as { raw: string }).raw);
      if (stmts) {
        for (const s of stmts) {
          if (!s || typeof s !== "object") continue;
          const d = s as Record<string, unknown>;
          if (DECL_KINDS.has(d.kind as string)) for (const n of declaredNames(d)) loop.names.set(n, null);
          this.statement(d, loop, fn, "none");
        }
      }
    } else if (isExprNodeValue(init)) this.expr(init, loop, fn);
    if (isExprNodeValue(parts.condExpr)) this.expr(parts.condExpr, loop, fn);
    if (isExprNodeValue(parts.updateExpr)) this.expr(parts.updateExpr, loop, fn);
  }

  /** A `!{}` handler's arm values / bodies: what an arm produces is a value like any other. */
  guardArms(st: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx): void {
    if (!Array.isArray(st.arms)) return;
    for (const arm of st.arms) {
      if (!arm || typeof arm !== "object") continue;
      const a = arm as Record<string, unknown>;
      const armScope = new LocalScope(scope);
      if (typeof a.binding === "string" && a.binding.trim() !== "") armScope.names.set(a.binding.trim(), null);
      if (isExprNodeValue(a.handlerExpr) && !isParseErrorHatch(a.handlerExpr)) {
        this.expr(a.handlerExpr, armScope, fn);
      } else if (typeof a.handler === "string" && a.handler.trim() !== "") {
        const stmts = this.env.parseStatements(a.handler);
        if (stmts) this.statements(stmts, armScope, fn);
      }
    }
  }

  /**
   * This statement's OWN expressions (not its child statements), plus the bodies it carries as
   * text: a C-style `for` (its parts), a `function-decl`'s parameter defaults, an `on mount` body
   * or a bare `{ … }` block kept as text.
   */
  ownExpressions(st: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx, handling: RootHandling): void {
    const kind = st.kind as string;
    const seen = new Set<object>();
    for (const key of Object.keys(st)) {
      if (STATEMENT_CHILD_KEYS.has(key) || SPECIAL_KEYS.has(key) || key.startsWith("__")) continue;
      const v = st[key];
      const roots = Array.isArray(v) ? v : [v];
      for (const root of roots) {
        if (!isExprNodeValue(root) || seen.has(root)) continue;
        seen.add(root);
        const h: RootHandling = HANDLED_OPERAND_KEYS.has(key) && handling === "none" ? HANDLED_OPERAND_KEYS.get(key)! : handling;
        // A bare-expr kept only as text (an `on mount { }` body, a bare `{ … }` block): its
        // statements are read below.
        if (kind === "bare-expr" && isParseErrorHatch(root) && typeof st.expr === "string") continue;
        this.root(root, h, scope, fn);
      }
    }
    // Text-only: a multi-statement `on mount` body carries no exprNode; a bare `{ … }` block (or
    // any statement text the expression parser could not read) carries a parse-error hatch.
    const textOnly = st._onMountEffect === true ? !st.exprNode || isParseErrorHatch(st.exprNode) : isParseErrorHatch(st.exprNode);
    if (kind === "bare-expr" && typeof st.expr === "string" && textOnly) {
      const stmts = this.env.parseStatements(st.expr);
      // An `on mount` body is an effect, not render-time. The statements inside are checked
      // nowhere else, so a whole-statement call among them is reported here — unless the text
      // is itself the operand of a `!{}`.
      if (stmts) this.statements(stmts, scope, st._onMountEffect === true ? PLAIN_FN : fn, handling === "operand" ? "operand" : "none");
    }
  }
}

const NO_REPORT: Cb = () => {};

/** Per env: a declaration / function value → the failable function its body returns (or null). */
const returnsCache = new WeakMap<FailableEnv, WeakMap<object, string | null>>();

const quietEnvs = new WeakMap<FailableEnv, FailableEnv>();
/** The env a return-judging walk runs with: it reports nothing and stamps nothing (memoized per env). */
function quietEnv(env: FailableEnv): FailableEnv {
  if (!env.onFailableMatchSubject) return env;
  let q = quietEnvs.get(env);
  if (!q) { q = { ...env, onFailableMatchSubject: undefined }; quietEnvs.set(env, q); }
  return q;
}

/**
 * The failable function a function body may RETURN: any `return` operand of the function itself
 * (not of a function nested in it) that may be one, or the tail expression of a `fn` body.
 */
function failableFnReturnedByBody(
  owner: object, params: unknown, body: unknown[], isFnTail: boolean, scope: LocalScope | null, env: FailableEnv,
): string | null {
  let byEnv = returnsCache.get(env);
  if (!byEnv) { byEnv = new WeakMap(); returnsCache.set(env, byEnv); }
  if (byEnv.has(owner)) return byEnv.get(owner) ?? null;
  byEnv.set(owner, null); // a self-reference while judging reads "not yet known"
  const w = new Walker(quietEnv(env), NO_REPORT);
  const ctx: FnCtx = { inFunction: true, inFailableFn: false };
  w.returnSink = { ctx, found: null };
  const inner = new LocalScope(scope);
  w.params(params, inner, ctx);
  w.statements(body, inner, ctx);
  let found = w.returnSink.found;
  if (found === null && isFnTail && body.length > 0) {
    const last = body[body.length - 1] as Record<string, unknown> | null;
    if (last && last.kind === "bare-expr") found = failableFnValueOf(last.exprNode as ExprNode | undefined, scopeLookup(inner, env));
  }
  byEnv.set(owner, found);
  return found;
}

function failableFnReturnedByDecl(st: Record<string, unknown>, scope: LocalScope | null, env: FailableEnv): string | null {
  if (!Array.isArray(st.body)) return null;
  return failableFnReturnedByBody(st, st.params, st.body as unknown[], st.fnKind === "fn", scope, env);
}

/**
 * The failable function a CALL of `value` may return, when `value` is itself a function (or names
 * one): an arrow whose body may yield one, a name whose call may, either side of a choice.
 */
function lambdaOrValueReturns(
  value: ExprNode | null | undefined, scope: LocalScope | null, env: FailableEnv, lk: FnValueLookup, depth = 0,
): string | null {
  if (!value || typeof value !== "object" || depth > 64) return null;
  switch (value.kind) {
    case "ident": return lk.returns(value.name);
    case "lambda": {
      if (value.body && value.body.kind === "expr") {
        const inner = new LocalScope(scope);
        for (const n of paramNames(value.params)) inner.names.set(n, null);
        return failableFnValueOf(value.body.value, scopeLookup(inner, env));
      }
      if (value.body && value.body.kind === "block") {
        return failableFnReturnedByBody(value, value.params, value.body.stmts as unknown[], false, scope, env);
      }
      return null;
    }
    case "escape-hatch": {
      const r = value as unknown as Record<string, unknown>;
      if (typeof r.bodyRaw !== "string") return null;
      const stmts = env.parseStatements(r.bodyRaw);
      return stmts ? failableFnReturnedByBody(value, r.params, stmts, false, scope, env) : null;
    }
    case "ternary":
      return lambdaOrValueReturns(value.consequent, scope, env, lk, depth + 1) ?? lambdaOrValueReturns(value.alternate, scope, env, lk, depth + 1);
    case "binary":
      if (value.op === "||" || value.op === "??") {
        return lambdaOrValueReturns(value.left, scope, env, lk, depth + 1) ?? lambdaOrValueReturns(value.right, scope, env, lk, depth + 1);
      }
      if (value.op === "&&") return lambdaOrValueReturns(value.right, scope, env, lk, depth + 1);
      return null;
    case "cast": return lambdaOrValueReturns(value.expression, scope, env, lk, depth + 1);
    default: return null;
  }
}

/**
 * The failable function a file-level function declaration may return (S468) — for the caller's
 * whole-file facts (`env.resolveOuterReturns`), solved by the caller to a fixpoint.
 */
export function failableFnReturnedBy(fnDecl: Record<string, unknown>, env: FailableEnv): string | null {
  return failableFnReturnedByDecl(fnDecl, null, env);
}

/**
 * What a file-level binding's initializer makes it (S468): the failable function the value may be,
 * and the failable function a call of it may return.
 */
export function failableBindingFacts(init: ExprNode | null | undefined, env: FailableEnv): { is: string | null; returns: string | null } {
  const lk = scopeLookup(null, env);
  return { is: failableFnValueOf(init, lk), returns: lambdaOrValueReturns(init, null, env, lk) };
}

/**
 * Walk one expression tree. `handling` says what the root is (see RootHandling). `scope` is null
 * at the root: every name resolves through `env.resolveOuter` until the walk binds it.
 */
export function forEachCallInValuePosition(
  root: ExprNode | null | undefined,
  handling: RootHandling,
  env: FailableEnv,
  cb: Cb,
): void {
  new Walker(env, cb).root(root, handling, null, TOP);
}

/**
 * The main AST walk's entry: ONE statement's own expressions and text-carried bodies — never its
 * child statements, which the main walk visits itself. `handling`: "operand" for the guarded node
 * of a `!{}`, "statement-call" when the whole-statement check owns a root call (a `bare-expr`),
 * otherwise "none" (a `?` / `match` head is recognized here).
 */
export function forEachCallInStatement(
  st: Record<string, unknown>,
  handling: RootHandling,
  env: FailableEnv,
  cb: Cb,
): void {
  const w = new Walker(env, cb);
  const kind = st.kind as string;
  if (kind === "function-decl") {
    // Its parameter defaults (its body is visited as statements).
    const inner = new LocalScope(null);
    w.params(st.params, inner, { inFunction: true, inFailableFn: st.canFail === true });
    return;
  }
  if (kind === "guarded-expr") {
    // Its guarded node is visited as a statement (with `__inGuardedContext`); its arms are here.
    w.guardArms(st, null, TOP);
    return;
  }
  if (TEXT_BODY_EFFECT_KINDS.has(kind) || kind === "onchange-decl") {
    w.effectBodies(st);
    return;
  }
  const scope = new LocalScope(null);
  w.ownExpressions(st, scope, TOP, kind === "propagate-expr" ? "operand" : handling);
  if (kind === "for-stmt" || kind === "for-loop") w.cStyleParts(st, scope, TOP);
}
