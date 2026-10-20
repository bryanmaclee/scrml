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
 * S469 follow-up — text the front-end does NOT parse (a body it refuses, an escape hatch that
 * carries only `raw`: a tagged template, a sequence, …) is never skipped. It is never trusted
 * either: its names are read with the compiler's logic tokenizer ONLY TO REFUSE — every failable
 * function it names is an unhandled call (`mentionedNames` / `Walker.unreadText`). Nothing is
 * accepted on the strength of a text read.
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
 * instead of one syntactic chain per review round.
 *
 * A `match` is different (S468 fix round 1): it HANDLES a failable call only when its lowering can
 * discriminate the error, and impl#1's lowering discriminates by treating every non-error value as
 * `.Ok`. That is correct only when the subject's value is PROVABLY a failable result — so the
 * subject must be a call whose callee is PROVABLY a failable function (`provableSubjectCallees`:
 * every value the callee may be is a failable function — a `!` function by name, a `const` bound
 * to one, a call of a function every `return` of which is one, a ternary both of whose arms are).
 * A subject whose value MAY be a failable result but may also be a plain value — an operator
 * (`match (a || check(p))`, `match (c ? AuthErr::Denied : check(p))`) or a callee that may be a
 * plain function (`const g = c ? plainDeny : check; match g(p)`) — has no correct lowering (a plain
 * `AuthErr::Denied` would be read as `.Ok`, or the error object compared as a plain value), so it
 * is NOT handled: E-ERROR-002, fail closed. The check that ACCEPTS a `match` as handling a call
 * and the stamp that makes the lowering DISCRIMINATE read this one answer.
 */

import type { ExprNode, CallExpr, LambdaExpr } from "./types/ast.ts";
import { templateInterpolationNodesAll, guardCallArmsRaw, hasLostTrailingContent } from "./expression-parser.ts";
import { tokenizeLogic } from "./tokenizer.ts";
import { isEventHandlerAttrName } from "./multi-statement-scan.ts";

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
   * The failable functions an outer name PROVABLY is — every value it may hold is one of them (a
   * `!` function by name, a `const` bound to one) — or null when that is not provable.
   */
  resolveOuterExact(name: string): string[] | null;
  /** The failable functions a CALL of an outer name PROVABLY returns (every `return` is one), or null. */
  resolveOuterReturnsExact(name: string): string[] | null;
  /**
   * An expression-position `match` whose subject is a call of a PROVABLY failable function (the
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
  /**
   * S468 — the call was found in text the AST carries and this walk PARSED (a `!{}` arm body, a
   * raw inline-`match` arm, a template literal's `${…}`, a C-style `for` initializer, a bare
   * `{ … }` block): `call` is not a node codegen will see, since codegen lowers that text itself.
   */
  fromText: boolean;
  /**
   * The call is a `match` subject whose callee MAY be a failable function but is not PROVABLY one
   * (S468 fix round 1): the match cannot discriminate its error, so it does not handle the call.
   */
  matchSubjectNotProvable?: boolean;
  /**
   * S469 — what was found (absent = "call"):
   *   - "call": a call to the failable function;
   *   - "fn-value": the failable function itself read as a VALUE outside callee position — a
   *     `lift` operand (`const g = if (c) { lift check } else { lift plain }`), an argument
   *     (`apply(check)`), a `return check`, an operator alias (`p ? check : id`), an object member…
   *     impl#1 does not follow a failable function through a value, so the read is refused
   *     (E-IMPL1-FAILABLE-FN-VALUE — an impl#1 limitation; ruling:user-voice-scrml.md S469 "Split +
   *     audit": the language allows it, §19.4.3). The one read accepted is a `const` alias of it by
   *     name (`const g = check`), which the walk follows (recordAlias);
   *   - "lift-guard": a call that is the operand of a `!{}` on a `lift` (`lift check(p) !{ … }`).
   *     impl#1 lowers that guard against the LIFT's result, not the call's (the error object is
   *     lifted unchecked; executed S469), so the `!{}` does not handle it.
   */
  refKind?: "call" | "fn-value" | "lift-guard" | "unreadable" | "unreadable-expr";
  /**
   * S469 follow-up — `refKind: "unreadable"`: a `lift` operand this walk could not read — the
   * operand text (`lift if (c) { lift if … }`, a value form nested two deep) parses neither as
   * an expression nor as statements, and names no failable function in scope. Nothing proves it
   * free of an unhandled failable call through a path the text scan cannot see, so it is
   * refused (fails closed). `calleeName` is "" and `text` is the operand text.
   *
   * S469 (template interpolation) — `refKind: "unreadable-expr"`: an escape hatch that carries
   * NO source text (`raw` empty or missing) and is not a literal: the walk can read neither its
   * structure nor its text, so nothing proves it free of an unhandled failable call. Refused
   * (E-ERROR-002, fails closed). `calleeName` is "" and `text` is the hatch's ESTree kind.
   */
  text?: string;
  /**
   * S469 follow-up — the call is inside markup a `lift` produces (`lift <li>${check(x)}</li>`)
   * or markup an expression holds (`c ? <p>${check(p)}</p> : ""`). The main walk visits
   * neither, so an `<errorBoundary>` cannot be trusted to test it there (refused, like `fromText`).
   */
  inLiftedMarkup?: boolean;
  /**
   * S469 — the call is inside the body of a value-form `if` / `for` (see FnCtx.inValueForm): an
   * `<errorBoundary>` cannot be trusted to test it there (refused, like `fromText`).
   */
  inValueForm?: boolean;
}

export type RootHandling =
  /** Nothing handles the root: every failable call in it is reported. */
  | "none"
  /** The root is a whole statement: a call that IS the root is the statement check's (not reported here). */
  | "statement-call"
  /** The root is the operand of a handling form: a call whose value reaches it unchanged is handled. */
  | "operand"
  /** The root is a `match` subject: only a call of a PROVABLY failable function is handled (see matchSubject). */
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
  /** Per bound name: the failable functions it PROVABLY is (a local `!` function, a `const` bound to one). */
  readonly exact = new Map<string, string[]>();
  /** Per bound name: the failable functions a CALL of it PROVABLY returns. */
  readonly exactReturns = new Map<string, string[]>();
  constructor(readonly parent: LocalScope | null) {}
  child(): LocalScope { return new LocalScope(this); }
}

/**
 * `inValueForm` (S469) — inside the body of a value-form `if` / `for`. The type system's main
 * walk never visits those bodies, so nothing there carries the stamps codegen's handling forms
 * read (`__matchSubjectFailable`): a `match` on a failable call there compares the error object
 * as a plain value and its arms never see the failure (executed: a wrong password logged in).
 * Within one, only a statement `!{}` is a handling form (it lowers from the tree alone).
 */
interface FnCtx { inFunction: boolean; inFailableFn: boolean; fromText?: boolean; inValueForm?: boolean; liftGuard?: boolean; inLiftedMarkup?: boolean; }
const TOP: FnCtx = { inFunction: false, inFailableFn: false };
const PLAIN_FN: FnCtx = { inFunction: true, inFailableFn: false };
/** The same context, for nodes this walk parsed out of text (see FailableCallCandidate.fromText). */
function textCtx(fn: FnCtx): FnCtx { return fn.fromText ? fn : { ...fn, fromText: true }; }
/** A function body written inside `fn` (a value-form body stays one: see FnCtx). */
function fnBodyCtx(fn: FnCtx, canFail: boolean): FnCtx {
  const out: FnCtx = { inFunction: true, inFailableFn: canFail };
  if (fn.inValueForm) out.inValueForm = true;
  if (fn.inLiftedMarkup) out.inLiftedMarkup = true;
  return out;
}

/**
 * S469 follow-up — a tagged template whose tag is a bare name (`check\`a ${p}\``), carried as
 * an escape hatch: its tag and its template text. Null for any other node (a tag that is a
 * member, a call, a nested tagged template, … is read only as text — see Walker.unreadText).
 */
function taggedTemplateParts(node: ExprNode | null | undefined): { tag: string; quasi: string } | null {
  if (!node || typeof node !== "object" || node.kind !== "escape-hatch") return null;
  const h = node as unknown as { nativeKind?: unknown; raw?: unknown };
  if (h.nativeKind !== "TaggedTemplateExpression" || typeof h.raw !== "string") return null;
  const m = /^\s*([A-Za-z_$][\w$]*)\s*(`[\s\S]*`)\s*$/.exec(h.raw);
  return m ? { tag: m[1], quasi: m[2] } : null;
}

/** The statement carries at least one expression tree that is not a parse-error hatch. */
function hasStructuredExpression(st: Record<string, unknown>): boolean {
  for (const key of Object.keys(st)) {
    if (STATEMENT_CHILD_KEYS.has(key) || key === "span") continue;
    const v = st[key];
    for (const x of Array.isArray(v) ? v : [v]) if (isExprNodeValue(x) && !isParseErrorHatch(x)) return true;
  }
  return false;
}

/** Every identifier-shaped run of `t` (the over-approximating fallback of mentionedNames). */
function identifierRuns(t: string, out: Set<string>): void {
  for (const m of t.matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0]);
}

/**
 * S469 follow-up (§19.4.3) — every name a piece of source TEXT could refer to, read with the
 * compiler's own logic tokenizer. Used ONLY to REFUSE: when text this walk must read does not
 * parse (or is carried by an escape hatch with no structure), a failable function it names may
 * be called in it unhandled, and nothing else will check it. Over-approximates on purpose:
 * keywords are kept (a contextual keyword may be a binding name), and a string token that holds
 * a `${` is read again (a template literal's interpolations are text inside its token, and an
 * unterminated quote in markup text swallows the rest of the line). A name read as a property
 * (`o.check`) is not a reference to the binding `check`. When the tokenizer throws, every
 * identifier-shaped run of the text is a name.
 */
export function mentionedNames(text: string): Set<string> {
  const out = new Set<string>();
  const scan = (t: string, depth: number): void => {
    let toks: Array<{ kind: string; text: string }>;
    try {
      toks = tokenizeLogic(t, 0, 1, 1, []) as unknown as Array<{ kind: string; text: string }>;
    } catch {
      identifierRuns(t, out);
      return;
    }
    for (let i = 0; i < toks.length; i++) {
      const k = toks[i];
      if (k.kind === "IDENT" || k.kind === "KEYWORD") {
        const prev = i > 0 ? toks[i - 1] : null;
        if (prev && prev.kind === "PUNCT" && (prev.text === "." || prev.text === "?.")) continue;
        out.add(k.text);
      } else if (k.kind === "STRING") {
        if (!k.text.includes("${")) continue;
        if (depth < 32) scan(k.text, depth + 1);
        else identifierRuns(k.text, out);
      } else if (k.kind !== "NUMBER" && k.kind !== "PUNCT" && k.kind !== "OPERATOR" && k.kind !== "EOF") {
        // An `@cell`, a block reference, or a token kind this reader has no class for: its text
        // may hold a name.
        identifierRuns(k.text, out);
      }
    }
  };
  scan(text, 0);
  return out;
}

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

function resolveExact(name: string, scope: LocalScope | null, env: FailableEnv): string[] | null {
  for (let s = scope; s !== null; s = s.parent) {
    if (s.names.has(name)) return s.exact.get(name) ?? null;
  }
  return env.resolveOuterExact(name);
}

function resolveReturnsExact(name: string, scope: LocalScope | null, env: FailableEnv): string[] | null {
  for (let s = scope; s !== null; s = s.parent) {
    if (s.names.has(name)) return s.exactReturns.get(name) ?? null;
  }
  return env.resolveOuterReturnsExact(name);
}

/**
 * How a function-value judgement resolves a NAME: what it may be and what a call of it may return
 * (fail closed — "may"), and what it PROVABLY is / returns (admit only what is provable — "exact").
 */
export interface FnValueLookup {
  is(name: string): string | null;
  returns(name: string): string | null;
  isExact(name: string): string[] | null;
  returnsExact(name: string): string[] | null;
}

function scopeLookup(scope: LocalScope | null, env: FailableEnv): FnValueLookup {
  return {
    is: (n) => resolveName(n, scope, env),
    returns: (n) => resolveReturns(n, scope, env),
    isExact: (n) => resolveExact(n, scope, env),
    returnsExact: (n) => resolveReturnsExact(n, scope, env),
  };
}

function unionNames(a: string[] | null, b: string[]): string[] {
  const out = a ? [...a] : [];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

/**
 * The failable functions the VALUE of `node` PROVABLY is — every value it may evaluate to is one of
 * them — or null when that is not provable (S468 fix round 1; admit only what is provably safe):
 *   - a name the lookup proves (a `!` function by name, a `const` bound to one);
 *   - a ternary BOTH of whose arms are provable;
 *   - a cast of a provable value;
 *   - a call of a NAME every `return` of which is provable (`getF()` with `function getF() { return check }`).
 * Everything else — `||` / `??` / `&&` (an operand may be chosen that is not a function), an
 * assignment, a lambda callee (its parameters are not modelled here), a member read — is not
 * provable. This judgement only ADMITS: a null answer never makes a call less failable; the
 * may-judgement (`failableFnValueOf`) still reports it.
 */
export function exactFnValueOf(node: ExprNode | null | undefined, lk: FnValueLookup, depth = 0): string[] | null {
  if (!node || typeof node !== "object" || depth > 64) return null;
  switch (node.kind) {
    case "ident": return typeof node.name === "string" ? lk.isExact(node.name) : null;
    case "ternary": {
      const a = exactFnValueOf(node.consequent, lk, depth + 1);
      if (a === null) return null;
      const b = exactFnValueOf(node.alternate, lk, depth + 1);
      return b === null ? null : unionNames(a, b);
    }
    case "cast": return exactFnValueOf(node.expression, lk, depth + 1);
    case "call": {
      if (guardCallArmsRaw(node) !== null || !node.callee) return null;
      return node.callee.kind === "ident" && typeof node.callee.name === "string" ? lk.returnsExact(node.callee.name) : null;
    }
    default: return null;
  }
}

/**
 * S468 fix round 1 — the failable functions a `match` subject is PROVABLY a call of, or null. A
 * `match` handles a failable call (and its lowering discriminates the error, reading every other
 * value as `.Ok`) only when this is non-null: the subject IS a call (parentheses are transparent)
 * and its callee is provably a failable function (`exactFnValueOf`). A subject that may also be a
 * plain value has no correct lowering — see the module header.
 */
export function provableSubjectCallees(node: ExprNode | null | undefined, lk: FnValueLookup): string[] | null {
  if (!node || typeof node !== "object" || node.kind !== "call" || guardCallArmsRaw(node) !== null || !node.callee) return null;
  return node.callee.kind === "ident" && typeof node.callee.name === "string"
    ? lk.isExact(node.callee.name)
    : exactFnValueOf(node.callee, lk);
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

/** Statement kinds whose expressions are read. */
export const VALUE_POSITION_STMT_KINDS: ReadonlySet<string> = new Set([
  "bare-expr", "let-decl", "const-decl", "state-decl", "lin-decl", "tilde-decl",
  "return-stmt", "propagate-expr", "if-stmt", "while-stmt", "while-loop", "do-while-stmt",
  "for-stmt", "for-loop", "match-stmt", "match-expr", "match-arm-inline",
  "reactive-nested-assign", "reactive-array-mutation", "guarded-expr", "function-decl", "lift-expr",
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

/**
 * S469 (§19.4.3) — EVERY key a declaration statement can carry, classified. A declaration's value
 * is not always `initExpr`: a value-form `if` / `for` (`const ok = if (c) { lift check(p) } …`)
 * is carried as `ifExpr` / `forExpr` with `init: ""`, and before S469 neither was read, so a wrong
 * password logged in. The walk reads a declaration key by key and FAILS CLOSED on a key it has no
 * class for: such a key's value is read as a value position in full (every failable call in it
 * is unhandled). `compiler/tests/unit/e-error-002-value-form-if-for-s469.test.js` enumerates
 * the keys the AST builder writes on a declaration and fails when one is missing here.
 *
 *   - "expr":       an expression tree (or a list of them), read by the generic root loop.
 *   - "value-form": a value-form `if` / `for`, read as a statement — condition / iterable as
 *                   values, bodies as statements, each `lift` operand as a value.
 *   - "statements": child statements (`matchExpr`, a structural state's `children`): visited by
 *                   the main walk itself, and by this walk when it recurses (STATEMENT_CHILD_KEYS).
 *   - "pattern":    the bound name, or a destructuring pattern whose defaults are values.
 *   - "text":       the source text of a value carried structurally under another key (`init`;
 *                   read only when no structured value is carried — see ownExpressions).
 *   - "inert":      flags, names and type text: no expression.
 *   - "opaque":     a structure (SQL, a foreign block, a render spec, validators) whose
 *                   expressions are read conservatively: every expression tree in it is a value
 *                   position, every statement in it is walked as a statement.
 */
export const DECL_KEY_CLASSES: ReadonlyMap<string, "expr" | "value-form" | "statements" | "pattern" | "text" | "inert" | "opaque"> = new Map([
  ["initExpr", "expr"], ["defaultExpr", "expr"],
  ["ifExpr", "value-form"], ["forExpr", "value-form"],
  ["matchExpr", "statements"], ["children", "statements"],
  ["name", "pattern"],
  ["init", "text"],
  ["id", "inert"], ["kind", "inert"], ["span", "inert"], ["typeAnnotation", "inert"], ["isConst", "inert"],
  ["isServer", "inert"], ["isShared", "inert"], ["pinned", "inert"], ["shape", "inert"],
  ["structuralForm", "inert"], ["stateType", "inert"], ["auth", "inert"], ["reactivity", "inert"],
  ["implicitNotLifecycle", "inert"], ["_isReactiveAssign", "inert"], ["_bareAssign", "inert"],
  ["refinementNoRhsBase", "inert"], ["serverAuthorityTable", "inert"], ["boundNames", "inert"],
  // S469 follow-up — flags written outside a declaration literal: on each statement of an arrow
  // handler's parameter prelude (`const e = _scrml_event`, ast-builder `parseArrowHandlerStatements`,
  // through a loop variable), and on the cells `<formFor>` synthesizes (codegen — after this walk).
  ["_handlerParamPrelude", "inert"], ["_cellKind", "inert"], ["_formForSynth", "inert"],
  ["sqlNode", "opaque"], ["foreignNode", "opaque"], ["renderSpec", "opaque"], ["validators", "opaque"],
] as const);

/**
 * S469 follow-up (§19.4.3) — the object-valued keys a NON-declaration statement carries that are
 * not expression trees and not child statements (STATEMENT_CHILD_KEYS), classified. Measured on
 * the corpus (examples / samples / conformance/cases / stdlib / benchmarks / compiler/tests):
 * `return-stmt.markupNode` (a `return <markup>` — before, never read: a wrong password logged in),
 * `return-stmt.sqlNode`, `match-arm-inline.leaveStmt` (the arm's leaving statement), `for-stmt.variable`
 * (a destructuring head — its defaults were never read), `bare-expr._refusalSpan`. Any other
 * object-valued key is read conservatively (`opaque`): fails closed. The e-error-002 value-form
 * test D enumerates the keys ast-builder.js writes on statements and fails on an unclassified one.
 */
export const STMT_KEY_CLASSES: ReadonlyMap<string, "markup" | "pattern" | "statement" | "inert" | "opaque"> = new Map([
  ["markupNode", "markup"], ["variable", "pattern"], ["leaveStmt", "statement"],
  ["sqlNode", "opaque"], ["foreignNode", "opaque"], ["productPatterns", "opaque"], ["_refusalSpan", "inert"],
] as const);

/** Statement kinds a conservative ("opaque") read walks as statements rather than field by field. */
const OPAQUE_STATEMENT_KINDS = new Set([...VALUE_POSITION_STMT_KINDS, "if-expr", "for-expr"]);

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
  returnSink: { ctx: FnCtx; found: string | null; exact: string[] | null; allExact: boolean } | null = null;

  /**
   * Set when the walk met a body it could not read (text that does not parse): a `return` in it is
   * unseen, so nothing about the function's returns is PROVABLE (the exact-returns judgement).
   */
  unreadable = false;

  constructor(readonly env: FailableEnv, readonly cb: Cb) {}

  /** Parse a text-carried statement body; a body that does not parse makes the walk `unreadable`. */
  parseBody(text: string): unknown[] | null {
    const stmts = this.env.parseStatements(text);
    if (stmts === null) this.unreadable = true;
    return stmts;
  }

  /** Identifier nodes already reported as a failable function read as a value (one report each). */
  readonly fnValueSeen = new WeakSet<object>();

  /**
   * S469 F4 — ONE reader of "a failable function read as a VALUE" (`refKind: "fn-value"`,
   * E-IMPL1-FAILABLE-FN-VALUE): the general value-position walk (`expr`, `ident`) and the `lift`
   * operand scan (`fnValueRefs`) both report through here, once per identifier node.
   */
  fnValueRead(node: { name?: unknown }, scope: LocalScope | null, fn: FnCtx): void {
    if (typeof node.name !== "string" || this.fnValueSeen.has(node as object)) return;
    const target = resolveName(node.name, scope, this.env);
    if (target === null) return;
    this.fnValueSeen.add(node as object);
    this.cb({ call: null, calleeName: target, via: target === node.name ? null : node.name,
      inFunction: fn.inFunction, inFailableFn: fn.inFunction && fn.inFailableFn, fromText: fn.fromText === true,
      refKind: "fn-value", ...(fn.inValueForm ? { inValueForm: true } : {}),
      ...(fn.inLiftedMarkup ? { inLiftedMarkup: true } : {}) });
  }

  report(call: CallExpr | null, written: string, scope: LocalScope | null, fn: FnCtx): void {
    const target = resolveName(written, scope, this.env);
    if (target === null) return;
    this.cb({ call, calleeName: target, via: target === written ? null : written,
      inFunction: fn.inFunction, inFailableFn: fn.inFunction && fn.inFailableFn, fromText: fn.fromText === true,
      ...(fn.inValueForm ? { inValueForm: true } : {}), ...(fn.inLiftedMarkup ? { inLiftedMarkup: true } : {}),
      ...(fn.liftGuard ? { refKind: "lift-guard" as const } : {}) });
  }

  /**
   * S469 follow-up (§19.4.3) — text this walk must read but cannot parse (or an escape hatch
   * that carries no structure: a tagged template, a sequence, a class expression, …). Every
   * failable function the text names is reported as an unhandled CALL (fails closed: a tagged
   * template's tag IS called; any other mention may be). True when something was reported.
   */
  unreadText(text: unknown, scope: LocalScope | null, fn: FnCtx): boolean {
    // S469 — text that is missing is not text that holds nothing: nothing about it is provable.
    // (A caller holding an escape hatch with no text refuses it: see escapeHatch.)
    if (typeof text !== "string" || text.trim() === "") { this.unreadable = true; return false; }
    // Text this walk could not read structurally: nothing in it is PROVABLE (S469 fix round 3 —
    // the exact-returns judgement reads `unreadable`; main's refuse-by-name read keeps it closed).
    this.unreadable = true;
    let found = false;
    for (const name of mentionedNames(text)) {
      if (resolveName(name, scope, this.env) === null) continue;
      this.report(null, name, scope, textCtx(fn));
      found = true;
    }
    return found;
  }

  /** A call whose callee is not a bare name: failable when the callee's VALUE may be a failable function. */
  reportValueCallee(call: CallExpr, scope: LocalScope | null, fn: FnCtx): void {
    const target = failableFnValueOf(call.callee, scopeLookup(scope, this.env));
    if (target === null) return;
    this.cb({ call, calleeName: target, via: calleeDisplay(call.callee),
      inFunction: fn.inFunction, inFailableFn: fn.inFunction && fn.inFailableFn, fromText: fn.fromText === true });
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
          if (arms) this.guardArms({ arms }, scope, textCtx(fn));
          else this.unreadText(armsRaw, scope, fn);
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
        // The ONE judgement matchSubject accepted it by: only a call of a provably failable
        // function is stamped (its lowering then discriminates the error).
        if (subjects.length === 1 && !fn.inValueForm && this.env.onFailableMatchSubject) {
          const callees = provableSubjectCallees(subjects[0], scopeLookup(scope, this.env));
          if (callees !== null && callees.length > 0) this.env.onFailableMatchSubject(node, callees);
        }
        // Its arms are kept raw (`pattern :> body`): each body is a value (or a block whose
        // statements are walked).
        for (const raw of node.rawArms ?? []) {
          if (typeof raw !== "string") continue;
          const body = this.env.matchArmBodyText(raw.trim());
          if (body === null) { this.unreadable = true; continue; }
          const stmts = this.parseBody(body);
          if (stmts) this.statements(stmts, scope, textCtx(fn));
          else this.unreadText(body ?? raw, scope, fn);
        }
        return;
      }
      case "lambda": this.lambda(node, scope, fn); return;
      case "lit": {
        if (node.litType === "template" && node.hasInterpolation !== false && typeof node.raw === "string") {
          // S469 follow-up — every interpolation, an unparsed one as a text hatch (read to refuse).
          for (const e of templateInterpolationNodesAll(node)) this.expr(e, scope, textCtx(fn));
        }
        return;
      }
      case "escape-hatch": this.escapeHatch(node as unknown as Record<string, unknown>, scope, fn); return;
      case "ident": {
        // S469 F4 — a bare name in a value position (a callee by bare name never reaches here —
        // `report` handles it above): a read of the function as a VALUE when it may be a failable one.
        if (typeof node.name === "string") this.fnValueRead(node, scope, fn);
        return;
      }
      case "markup-value":
        // S469 follow-up — markup held by an expression (`${ c ? <p>${check(p) ? "a" : "b"}</p> : "" }`)
        // renders its interpolations and attribute values like lifted markup does: read the same
        // way (`g-markup-in-interp-ternary-failable-call-unchecked-s468`; before, a leaf).
        this.liftedMarkup((node as unknown as { node?: unknown }).node, scope, { ...fn, inLiftedMarkup: true });
        return;
      case "sql-ref": case "input-state-ref": return;
      case "array": for (const el of node.elements) this.expr(el as ExprNode, scope, fn); return;
      case "object":
        for (const p of node.props) {
          if (p.kind === "prop") {
            if (typeof p.key !== "string") this.expr(p.key as ExprNode, scope, fn);
            this.expr(p.value, scope, fn);
          } else if (p.kind === "spread") this.expr(p.argument, scope, fn);
          // S469 — `{ check }` reads `check` as a VALUE (the shorthand of `{ check: check }`).
          else if (p.kind === "shorthand") this.fnValueRead(p, scope, fn);
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
    // A tagged template whose tag is a name (`check\`${p}\` !{ … }`) IS a call of the tag:
    // handled like one (its interpolations are its arguments — still value positions).
    const tagged = taggedTemplateParts(node);
    if (tagged !== null) { this.templateInterpolations(tagged.quasi, node, scope, fn); return; }
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
   * A `match` subject (S468 fix round 1 — fail closed). impl#1's `match` discriminates a failable
   * result by reading every non-error value as `.Ok`, which is correct only when the subject IS a
   * call of a PROVABLY failable function (`provableSubjectCallees`). Such a call is handled (its
   * arguments, and a callee that is not a bare name, are values). A call whose callee MAY be a
   * failable function but is not provably one (`const g = c ? plainDeny : check; match g(p)`) is
   * NOT handled — a plain `AuthErr::Denied` would read as `.Ok` — and is reported. Anything else —
   * an operator (`match (a || check(p))`, `match (c ? AuthErr::Denied : check(p))`) — is a value
   * position: a failable call inside it is unhandled
   * (`g-match-failable-subject-through-operator-miscompiled-s467`, refused as on base).
   */
  matchSubject(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    // S469 — no `match` inside a value-form body is lowered as a failable match (see FnCtx).
    if (fn.inValueForm) { this.expr(node, scope, fn); return; }
    if (node.kind === "call" && guardCallArmsRaw(node) === null && node.callee) {
      const lk = scopeLookup(scope, this.env);
      const may = failableCalleeOf(node, lk);
      if (may !== null && provableSubjectCallees(node, lk) === null) {
        const callee = node.callee;
        const via = callee.kind === "ident" ? (callee.name === may ? null : callee.name) : calleeDisplay(callee);
        this.cb({ call: node, calleeName: may, via, inFunction: fn.inFunction,
          inFailableFn: fn.inFunction && fn.inFailableFn, fromText: fn.fromText === true, matchSubjectNotProvable: true });
      }
      if (node.callee.kind !== "ident") this.expr(node.callee, scope, fn);
      for (const a of node.args ?? []) this.expr(a as ExprNode, scope, fn);
      return;
    }
    this.expr(node, scope, fn);
  }

  /**
   * One scrutinee of a §18.19 multi-scrutinee head: only a call that IS the scrutinee is handled
   * (the multi-scrutinee lowering is not widened by S468); everything else is a value position.
   */
  directCallSubject(node: ExprNode | null | undefined, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    // S469 — no `match` inside a value-form body is lowered as a failable match (see FnCtx).
    if (fn.inValueForm) { this.expr(node, scope, fn); return; }
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
    // A whole-statement `check\`x\`` is the statement check's, like a whole-statement call.
    const tagged = handling === "statement-call" ? taggedTemplateParts(node) : null;
    if (tagged !== null) { this.templateInterpolations(tagged.quasi, node, scope, fn); return; }
    this.expr(node, scope, fn);
  }

  /** `text` parses as one expression with nothing dropped (no parse error, no lost trailing text). */
  readsWhole(text: string): boolean {
    if (text.trim() === "") return true;
    const n = this.env.parseExpr(text);
    return !!n && !isParseErrorHatch(n) && !hasLostTrailingContent(n);
  }

  /** The `${ … }` interpolations of template-literal text (`quasi`), each a value position. */
  templateInterpolations(quasi: string, at: ExprNode, scope: LocalScope | null, fn: FnCtx): void {
    const lit = { kind: "lit", litType: "template", raw: quasi, span: (at as { span?: unknown }).span } as unknown as ExprNode & { raw: string; span: never };
    for (const e of templateInterpolationNodesAll(lit)) this.expr(e, scope, textCtx(fn));
  }

  /** A parameter list: its names shadow; its defaults are evaluated at call time (in the function). */
  params(params: unknown, scope: LocalScope, fn: FnCtx): void {
    for (const n of paramNames(params)) scope.names.set(n, null);
    if (!Array.isArray(params)) return;
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const d = (p as { defaultValue?: unknown }).defaultValue;
      if (isExprNodeValue(d)) this.expr(d, scope, fn);
      else if (typeof d === "string" && d.trim() !== "") {
        const parsed = this.env.parseExpr(d);
        if (parsed && !isParseErrorHatch(parsed)) this.expr(parsed, scope, textCtx(fn));
        else this.unreadText(d, scope, fn);
      }
      const pat = (p as { pattern?: unknown }).pattern;
      if (pat && typeof pat === "object") this.patternDefaults(pat, scope, fn);
    }
  }

  patternDefaults(pat: unknown, scope: LocalScope | null, fn: FnCtx): void {
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

  lambda(node: LambdaExpr, scope: LocalScope | null, fn: FnCtx): void {
    const inner = new LocalScope(scope);
    const body = fnBodyCtx(fn, false);
    this.params(node.params, inner, body);
    if (node.body && node.body.kind === "expr") this.expr(node.body.value, inner, body);
    else if (node.body && node.body.kind === "block") this.statements(node.body.stmts as unknown[], inner, body);
  }

  escapeHatch(node: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx): void {
    const nk = node.nativeKind;
    const raw = node.raw;
    if (nk === "TemplateLiteral" && typeof raw === "string" && raw.startsWith("`")) {
      for (const e of templateInterpolationNodesAll(node as unknown as ExprNode & { raw: string; span: never })) this.expr(e, scope, textCtx(fn));
      return;
    }
    // A function written as a value and carried with its body TEXT (`function () { … }`, a
    // block-bodied arrow): its body is a function body like any other — parse it and walk it.
    if (typeof node.bodyRaw === "string") {
      const inner = new LocalScope(scope);
      const body = fnBodyCtx(fn, false);
      this.params(node.params, inner, body);
      const stmts = this.env.parseStatements(node.bodyRaw);
      if (stmts) this.statements(stmts, inner, body);
      else this.unreadText(node.bodyRaw, inner, body);
      return;
    }
    // A literal the tree does not model (a regular expression, a BigInt) holds no code.
    if (nk === "Literal") return;
    // A statement's text the expression parser could not read: its reader is the statement's
    // (ownExpressions — the statement usually carries the structured form under another key).
    // Nothing in it is PROVABLE from here (the exact-returns judgement reads `unreadable`).
    if (nk === "ParseError") { this.unreadable = true; return; }
    // S469 (§19.4.3) — FAIL CLOSED: a hatch with no source text can be read neither as structure
    // nor as text. Before, `unreadText("")` returned false — nothing refused, `unreadable` not
    // set — so `${(check(p), 1) ? "Y" : "N"}` (a sequence hatch the template-interpolation reader
    // built with `raw: ""`) compiled and a wrong password logged in. The reader now carries the
    // text (expression-parser.ts `readTemplateInterpolations`); a hatch that still has none is
    // refused, never skipped.
    if (typeof raw !== "string" || raw.trim() === "") {
      this.unreadable = true;
      this.cb({ call: null, calleeName: "", via: null, inFunction: fn.inFunction,
        inFailableFn: fn.inFunction && fn.inFailableFn, fromText: true, refKind: "unreadable-expr",
        text: typeof nk === "string" ? nk : "expression" });
      return;
    }
    // S469 follow-up (§19.4.3) — `check\`${p}\``: a tagged template CALLS its tag (with the
    // template's strings and interpolated values). Before, the hatch was not read and
    // `const ok = check\`${p}\`` compiled: a wrong password logged in. A tag that is a name is
    // read as the callee of a call in a value position; its interpolations are values.
    const tagged = taggedTemplateParts(node as unknown as ExprNode);
    if (tagged !== null) {
      this.report(null, tagged.tag, scope, textCtx(fn));
      this.templateInterpolations(tagged.quasi, node as unknown as ExprNode, scope, fn);
      return;
    }
    // Every other hatch carries only its source text: an ESTree node the expression tree does
    // not model (a tagged template whose tag is not a name, a SequenceExpression, a
    // ClassExpression, …) or an interpolation the parser could not read. Before, it was not
    // read at all. Its text is read to refuse (fails closed): every failable function it names
    // is an unhandled call.
    this.unreadText(raw, scope, fn);
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
          const failableFn = decl.kind === "function-decl" && decl.canFail === true;
          block.names.set(n, failableFn ? n : null);
          if (failableFn) block.exact.set(n, [n]);
        }
      }
    }
    // (S469 fix round 2 — what a LOCAL function declaration returns is no longer analysed: a
    // `return` that could yield a failable function is itself refused, E-IMPL1-FAILABLE-FN-VALUE;
    // see type-system.ts `fnFactsReturns`.)
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
      const fnCtx: FnCtx = fnBodyCtx(fn, st.canFail === true);
      this.params(st.params, inner, fnCtx);
      if (Array.isArray(st.body)) this.statements(st.body as unknown[], inner, fnCtx);
      return;
    }
    if (kind === "return-stmt" && this.returnSink && this.returnSink.ctx === fn) {
      const sink = this.returnSink;
      const lk = scopeLookup(scope, this.env);
      const operand = st.exprNode as ExprNode | undefined;
      if (sink.found === null) sink.found = failableFnValueOf(operand, lk);
      const ex = exactFnValueOf(operand, lk);
      if (ex === null) sink.allExact = false;
      else sink.exact = unionNames(sink.exact, ex);
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
    if (kind === "for-stmt" || kind === "for-loop" || kind === "for-expr") {
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
      const stmts = typeof b.raw === "string" && b.raw.trim() !== "" ? this.parseBody(b.raw) : null;
      if (stmts) this.statements(stmts, scope, PLAIN_FN);
      else {
        if (isExprNodeValue(b.expr)) this.root(b.expr, "none", scope, PLAIN_FN);
        // The single-expression view may hold only part of a body that did not parse.
        this.unreadText(b.raw, scope, PLAIN_FN);
      }
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
    // PROVABLE facts only for a binding that is never written again: a `const` / `lin`.
    const once = st.kind === "const-decl" || st.kind === "lin-decl";
    const exact = once ? exactFnValueOf(init, lk) : null;
    const exactReturns = once ? returns.exact : null;
    if (target === null && returns.may === null && exact === null && exactReturns === null) return;
    // Bind in the innermost scope that already declares it; else this block.
    let owner: LocalScope = scope;
    for (let s: LocalScope | null = scope; s !== null; s = s.parent) {
      if (s.names.has(name)) { owner = s; break; }
    }
    if (target !== null) owner.names.set(name, target);
    else if (!owner.names.has(name)) owner.names.set(name, resolveName(name, scope, this.env));
    if (returns.may !== null) owner.returns.set(name, returns.may);
    if (exact !== null && target !== null) owner.exact.set(name, exact);
    if (exactReturns !== null) owner.exactReturns.set(name, exactReturns);
  }

  /** A C-style `for`'s parts: the initializer (a declaration, carried as text), test and update. */
  cStyleParts(st: Record<string, unknown>, loop: LocalScope, fn: FnCtx): void {
    const parts = st.cStyleParts as Record<string, unknown> | undefined;
    if (!parts || typeof parts !== "object") return;
    const init = parts.initExpr;
    if (isParseErrorHatch(init) && typeof (init as { raw?: unknown }).raw === "string") {
      const stmts = this.parseBody((init as { raw: string }).raw);
      if (stmts) {
        for (const s of stmts) {
          if (!s || typeof s !== "object") continue;
          const d = s as Record<string, unknown>;
          if (DECL_KINDS.has(d.kind as string)) for (const n of declaredNames(d)) loop.names.set(n, null);
          this.statement(d, loop, textCtx(fn), "none");
        }
      } else this.unreadText((init as { raw: string }).raw, loop, fn);
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
      // S468 fix round 2 — a BRACED arm body is a statement list (§7.2.2 "Terms": "a `{ … }`
      // match or `!{}` arm block"), read by the one statement-list reader every emitter uses
      // (`env.parseStatements` = defer-structure `parseStatementText`). Its `handlerExpr` is the
      // builder's EXPRESSION reading of the block's inner text, which stops after the FIRST
      // statement: walking it let `{ note = "d"⏎ const q = check3(p)⏎ q }` — an unhandled
      // failable call after the first statement — escape E-ERROR-002, and a wrong password
      // logged in. `handlerExpr` is read only for an unbraced (single-expression) arm, or as a
      // last resort when the block text does not parse.
      const ht = typeof a.handler === "string" ? a.handler.trim() : "";
      const braced = ht.startsWith("{") && ht.endsWith("}");
      const blockStmts = braced && ht.slice(1, -1).trim() !== "" ? this.env.parseStatements(ht) : null;
      if (blockStmts) {
        this.statements(blockStmts, armScope, textCtx(fn));
      } else if (isExprNodeValue(a.handlerExpr) && !isParseErrorHatch(a.handlerExpr)) {
        this.expr(a.handlerExpr, armScope, fn);
        // A braced body that did not parse: `handlerExpr` reads only its first statement.
        if (braced && ht.slice(1, -1).trim() !== "") this.unreadText(ht, armScope, fn);
      } else if (ht !== "") {
        const stmts = this.parseBody(ht);
        if (stmts) this.statements(stmts, armScope, textCtx(fn));
        else this.unreadText(ht, armScope, fn);
      }
    }
  }

  /**
   * S469 follow-up — one key of a NON-declaration statement whose value is a structure, not an
   * expression tree (STMT_KEY_CLASSES). True when the key was read here (the generic root loop
   * skips it); false for an expression tree (or a list of them), which that loop reads. A key
   * with no class is read conservatively (`opaque`) — fails closed, as DECL_KEY_CLASSES does.
   */
  stmtKey(st: Record<string, unknown>, key: string, scope: LocalScope | null, fn: FnCtx): boolean {
    const v = st[key];
    if (v === null || typeof v !== "object") return false;
    if (isExprNodeValue(v) || (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object" || isExprNodeValue(x)))) {
      // §18.19 — a multi-scrutinee head `match (a, b)` is carried twice: `scrutineeExprs` (each
      // scrutinee, handled as a subject) and `headerExpr`, the comma SEQUENCE as an escape hatch
      // holding the same text. The structured reading is the one walked.
      if (key === "headerExpr" && Array.isArray(st.scrutineeExprs) && st.scrutineeExprs.length > 0
          && (v as { kind?: unknown; nativeKind?: unknown }).kind === "escape-hatch"
          && (v as { nativeKind?: unknown }).nativeKind === "SequenceExpression") return true;
      return false;
    }
    switch (STMT_KEY_CLASSES.get(key)) {
      case "inert": return true;
      case "markup":
        // `return <b>${check(p) ? "a" : "b"}</b>`: markup an expression holds.
        this.liftedMarkup(v, scope, { ...fn, inLiftedMarkup: true });
        return true;
      case "pattern":
        // A `for` head's destructuring pattern: its defaults are values (`for (const { a = check(p) } of xs)`).
        this.patternDefaults(v, new LocalScope(scope), fn);
        return true;
      case "statement":
        if (!Array.isArray(v) && typeof (v as { kind?: unknown }).kind === "string") {
          this.statement(v as Record<string, unknown>, new LocalScope(scope), fn, "none");
          return true;
        }
        this.opaque(v, scope, fn);
        return true;
      default:
        // `sqlNode`, or a key this walk has not been taught: every expression tree in it is a
        // value position, every statement in it is walked as a statement.
        this.opaque(v, scope, fn);
        return true;
    }
  }

  /**
   * S469 — one key of a declaration, by its class (DECL_KEY_CLASSES). True when the key was read
   * here (the generic root loop skips it); false for an "expr" key, which that loop reads.
   */
  declKey(st: Record<string, unknown>, key: string, scope: LocalScope | null, fn: FnCtx, handling: RootHandling): boolean {
    const cls = DECL_KEY_CLASSES.get(key);
    const v = st[key];
    switch (cls) {
      case "expr": return false;
      case "statements": case "inert": return true;
      case "value-form":
        // `const ok = if (c) { lift a } else { lift b }` / `const vs = for (x of xs) { lift f(x) }`:
        // nothing handles the value the form produces, so its condition / iterable, its body
        // statements and its `lift` operands are all value positions. The main walk never visits
        // these bodies (it descends only array-valued keys), so this walk reads them in full.
        if (v && typeof v === "object" && !Array.isArray(v)) {
          this.statement(v as Record<string, unknown>, new LocalScope(scope), { ...fn, inValueForm: true }, "none");
        } else if (v !== undefined && v !== null) {
          this.opaque(v, scope, fn);
        }
        return true;
      case "pattern":
        if (v && typeof v === "object") this.opaque(v, scope, fn);
        return true;
      case "text": {
        // The source text of the value. Read only when no structured value is carried — a
        // declaration whose initializer did not parse to a tree still emits that text.
        const structured = isExprNodeValue(st.initExpr) && !isParseErrorHatch(st.initExpr);
        const other = ["ifExpr", "forExpr", "matchExpr", "sqlNode", "foreignNode", "renderSpec"].some((k) => st[k] != null);
        if (typeof v === "string" && v.trim() !== "" && !structured && !other) {
          const parsed = this.env.parseExpr(v);
          if (parsed && !isParseErrorHatch(parsed)) this.root(parsed, handling, scope, textCtx(fn));
          else this.unreadText(v, scope, fn);
        }
        return true;
      }
      case "opaque":
        this.opaque(v, scope, fn);
        return true;
      default:
        // A key with no class — written by a builder change this walk has not been taught.
        // Fails closed: read as a value position in full.
        if (isExprNodeValue(v) || (Array.isArray(v) && v.every((x) => isExprNodeValue(x)))) return false;
        this.opaque(v, scope, fn);
        return true;
    }
  }

  /**
   * S469 — a conservative read of a structure this walk has no specific reader for: every
   * expression tree in it is a value position, every statement in it is walked as a statement
   * (so a `!{}` / `match` / `?` inside still handles what it handles). Nothing is skipped.
   */
  opaque(v: unknown, scope: LocalScope | null, fn: FnCtx): void {
    const seen = new WeakSet<object>();
    const go = (x: unknown): void => {
      if (!x || typeof x !== "object" || seen.has(x as object)) return;
      seen.add(x as object);
      if (Array.isArray(x)) { for (const y of x) go(y); return; }
      if (isExprNodeValue(x)) { this.expr(x, scope, fn); return; }
      const k = (x as { kind?: unknown }).kind;
      if (typeof k === "string" && OPAQUE_STATEMENT_KINDS.has(k)) {
        this.statement(x as Record<string, unknown>, new LocalScope(scope), fn, "none");
        return;
      }
      for (const key of Object.keys(x as object)) if (key !== "span") go((x as Record<string, unknown>)[key]);
    };
    go(v);
  }

  /**
   * S469 — `lift <operand>`: the operand is the value the enclosing form produces (a value-form
   * `if` / `for`, or a rendered `for` body), so it is a VALUE position; and a failable function
   * read as a value there (`lift check`, `lift c ? check : plain`, `lift (x) => check`) escapes
   * into a binding whose calls this walk cannot follow — refused (`refKind: "fn-value"`).
   *
   * S469 follow-up — lifted MARKUP (`lift <li>${check(x) ? "a" : "b"}</li>`) is read too: the
   * main walk does not visit it, so before this a failable call in its interpolations or
   * attribute values was checked nowhere and a wrong password rendered as a login
   * (`g-lift-markup-failable-call-unchecked-s468`). Any other operand shape is read
   * conservatively (`opaque`).
   */
  liftOperand(st: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx, handling: RootHandling): void {
    const e = st.expr as { kind?: unknown; expr?: unknown; exprNode?: unknown; node?: unknown } | undefined;
    if (!e || typeof e !== "object") return;
    if (e.kind === "markup") {
      this.liftedMarkup(e.node, scope, { ...fn, inLiftedMarkup: true });
      return;
    }
    if (e.kind !== "expr") { this.opaque(e, scope, fn); return; }
    let node: ExprNode | null = isExprNodeValue(e.exprNode) && !isParseErrorHatch(e.exprNode) ? e.exprNode : null;
    let lfn = fn;
    if (node === null && typeof e.expr === "string" && e.expr.trim() !== "") {
      const parsed = this.env.parseExpr(e.expr);
      if (parsed && !isParseErrorHatch(parsed)) { node = parsed; lfn = textCtx(fn); }
    }
    if (node === null) {
      // An operand that is not an expression (`lift if (c) { … } else { … }` — a nested value
      // form carried as text): read it as statements. A value-form body (see FnCtx).
      const text = typeof e.expr === "string" ? e.expr : "";
      const stmts = text.trim() !== "" ? this.env.parseStatements(text) : null;
      if (stmts) { this.statements(stmts, scope, { ...textCtx(fn), inValueForm: true }); return; }
      // S469 follow-up (§19.4.3) — the operand text parses neither way (`lift if (c) { lift if
      // (d) { lift check(x) } … }`: a value form nested two deep, whose inner `lift if` the
      // statement reader refuses). Before, the walk returned here and read nothing; only
      // codegen's E-CODEGEN-INVALID-LOGIC stood between it and an unhandled call. Fails closed:
      // every failable function the text names is an unhandled call; text that names none is
      // refused as unreadable.
      if (text.trim() !== "" && !this.unreadText(text, scope, { ...fn, inValueForm: true })) {
        this.cb({ call: null, calleeName: "", via: null, inFunction: fn.inFunction,
          inFailableFn: fn.inFunction && fn.inFailableFn, fromText: true, refKind: "unreadable", text: text.trim() });
      }
      return;
    }
    // A whole-statement `lift f()` is NOT a statement call: its value is lifted, so it is read.
    // `lift check(p) !{ … }` (the guarded node of a `!{}`) is NOT handled either: see refKind
    // "lift-guard". Every failable call in the operand is reported.
    this.root(node, "none", scope, handling === "operand" ? { ...lfn, liftGuard: true } : lfn);
    this.fnValueRefs(node, scope, lfn);
  }

  /**
   * S469 follow-up — markup a `lift` produces: its attribute values and `${ … }` interpolations
   * are values rendered into the DOM (an unhandled failable call there renders its error object
   * as data), its event-handler values are handler bodies, and its child markup is read the same
   * way. Nothing in it is a handling form except what is written there (`!{}`, `match`).
   */
  liftedMarkup(node: unknown, scope: LocalScope | null, fn: FnCtx): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) this.liftedMarkup(n, scope, fn); return; }
    const n = node as Record<string, unknown>;
    const kind = n.kind;
    if (kind === "text" || kind === "comment") return;
    if (kind === "logic" && Array.isArray(n.body)) {
      // A `${ … }` interpolation: its statements' values are rendered (no statement-call
      // exemption — a bare `${check(x)}` renders the call's result).
      this.statements(n.body as unknown[], scope, fn);
      return;
    }
    if (kind !== "markup") {
      if (typeof kind === "string" && OPAQUE_STATEMENT_KINDS.has(kind)) this.statement(n, new LocalScope(scope), fn, "none");
      else this.opaque(n, scope, fn);
      return;
    }
    for (const attr of Array.isArray(n.attrs) ? n.attrs as Array<Record<string, unknown>> : []) {
      if (!attr || typeof attr !== "object") continue;
      const value = attr.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const handler = typeof attr.name === "string" && isEventHandlerAttrName(attr.name);
      // An event handler runs on the event: a function body (not render-time, not `!`).
      const vfn = handler ? fnBodyCtx(fn, false) : fn;
      if (value.kind === "call-ref" && typeof value.name === "string") {
        // `attr=f(x)` / `onclick=f(x)`: a call nothing handles.
        this.report(null, value.name, scope, vfn);
        for (const a of Array.isArray(value.argExprNodes) ? value.argExprNodes as ExprNode[] : []) this.expr(a, scope, vfn);
        continue;
      }
      if (value.kind === "variable-ref" && typeof value.name === "string") {
        // `onclick=check`: a handler REFERENCE — the dispatcher calls it and discards its result.
        if (handler) this.report(null, value.name, scope, vfn);
        continue;
      }
      if (Array.isArray(value.handlerBlock)) { this.statements(value.handlerBlock as unknown[], scope, vfn); continue; }
      // An event handler's value is a STATEMENT LIST (`onclick=${ @x = f() !{ … }; @y = @x + 1 }`):
      // its `exprNode` reads only the first statement. When the text is not one whole expression,
      // it is read as what it is — statements, by the compiler's statement reader — so a handled
      // `!{}` there is handled and every later statement is read. Text that does not parse as
      // statements either falls through to the refuse-only read below. (S469 r3: before, such a
      // value was read refuse-only, so a correctly handled `!{}` in a lifted handler was refused.)
      if (handler && value.kind === "expr" && typeof value.raw === "string" && !this.readsWhole(value.raw)) {
        const stmts = this.env.parseStatements(value.raw);
        if (stmts) { this.statements(stmts, scope, textCtx(vfn)); continue; }
      }
      if (value.kind === "expr" && isExprNodeValue(value.exprNode) && !isParseErrorHatch(value.exprNode)) {
        this.expr(value.exprNode, scope, vfn);
        // `onclick=check`: the function read as a value — the dispatcher calls it, unhandled.
        if (handler) this.fnValueRefs(value.exprNode, scope, vfn);
        // Two readers of one text: `parseLiftTag` can fold `attr=${…}` AND every attribute after
        // it into one value (`raw` = `${"a"}onclick={ @m = check(x) }`, `exprNode` = the ident
        // `$`) while codegen still emits the later attributes. Unless `raw` reads as ONE whole
        // expression (nothing dropped), it is read too, to refuse
        // (`g-lift-tag-attr-value-swallows-attrs-s469`).
        if (typeof value.raw === "string" && !this.readsWhole(value.raw)) this.unreadText(value.raw, scope, vfn);
        continue;
      }
      if (value.kind === "expr" && typeof value.raw === "string") { this.unreadText(value.raw, scope, vfn); continue; }
      this.opaque(value, scope, vfn);
    }
    if (Array.isArray(n.children)) for (const c of n.children) this.liftedMarkup(c, scope, fn);
  }

  /**
   * Every read of a failable function AS A VALUE in `node` — an identifier that is not the callee
   * of a call. Conservative: a name bound inside the tree (a lambda parameter) is still resolved
   * against the enclosing scope, so shadowing can only over-refuse, never miss.
   */
  fnValueRefs(node: ExprNode, scope: LocalScope | null, fn: FnCtx): void {
    const seen = new WeakSet<object>();
    const callees = new WeakSet<object>();
    const go = (x: unknown): void => {
      if (!x || typeof x !== "object" || seen.has(x as object)) return;
      seen.add(x as object);
      if (Array.isArray(x)) { for (const y of x) go(y); return; }
      const r = x as Record<string, unknown>;
      if (r.kind === "call" && r.callee && typeof r.callee === "object" && (r.callee as { kind?: unknown }).kind === "ident") {
        callees.add(r.callee as object);
      }
      // An identifier that is not a callee, or an object shorthand `{ check }` (a value read).
      if ((r.kind === "ident" || r.kind === "shorthand") && typeof r.name === "string" && !callees.has(r)) {
        this.fnValueRead(r, scope, fn);
        return;
      }
      // A function written as a value and carried with its body TEXT: its body is read too.
      if (r.kind === "escape-hatch" && typeof r.bodyRaw === "string") {
        const stmts = this.env.parseStatements(r.bodyRaw);
        if (stmts) go(stmts);
      }
      for (const key of Object.keys(r)) if (key !== "span") go(r[key]);
    };
    go(node);
  }

  /**
   * This statement's OWN expressions (not its child statements), plus the bodies it carries as
   * text: a C-style `for` (its parts), a `function-decl`'s parameter defaults, an `on mount` body
   * or a bare `{ … }` block kept as text.
   */
  ownExpressions(st: Record<string, unknown>, scope: LocalScope | null, fn: FnCtx, handling: RootHandling): void {
    const kind = st.kind as string;
    if (kind === "lift-expr") { this.liftOperand(st, scope, fn, handling); return; }
    const isDecl = DECL_KINDS.has(kind);
    const seen = new Set<object>();
    for (const key of Object.keys(st)) {
      if (STATEMENT_CHILD_KEYS.has(key) || SPECIAL_KEYS.has(key)) continue;
      if (key.startsWith("__")) {
        // A pass's annotation (`__inGuardedContext`, `__enclosingFnCanFail`, …): a flag or a
        // name. S469 follow-up — one that holds a STRUCTURE is not a flag this walk knows: it is
        // read conservatively (fails closed), never skipped.
        const v = st[key];
        if (v !== null && typeof v === "object") this.opaque(v, scope, fn);
        continue;
      }
      if (isDecl && this.declKey(st, key, scope, fn, handling)) continue;
      if (!isDecl && this.stmtKey(st, key, scope, fn)) continue;
      const v = st[key];
      const roots = Array.isArray(v) ? v : [v];
      for (const root of roots) {
        if (!isExprNodeValue(root) || seen.has(root)) continue;
        seen.add(root);
        // S469 — inside a value-form body a `match` head / arm `?` is not lowered as a handler (see FnCtx).
        const h: RootHandling = HANDLED_OPERAND_KEYS.has(key) && handling === "none"
          ? (fn.inValueForm ? "none" : HANDLED_OPERAND_KEYS.get(key)!) : handling;
        // A bare-expr kept only as text (an `on mount { }` body, a bare `{ … }` block): its
        // statements are read below.
        if (kind === "bare-expr" && isParseErrorHatch(root) && typeof st.expr === "string") continue;
        // S469 follow-up — a parse-error root is the statement's text the expression parser could
        // not read. Where the statement carries a structured reading of it under another key
        // (`check(p)?` ending an inline arm: `propagateOperandExpr`), that reading is walked; where
        // it carries none, the text is read to refuse (fails closed).
        if (isParseErrorHatch(root)) {
          if (!hasStructuredExpression(st)) this.unreadText((root as unknown as { raw?: unknown }).raw, scope, fn);
          continue;
        }
        // S469 fix round 2 (F4) — the one value read of a failable function impl#1 accepts: a
        // `const` alias of it by name (`const g = check`), which the walk follows (recordAlias).
        if (kind === "const-decl" && key === "initExpr" && root.kind === "ident") continue;
        this.root(root, h, scope, fn);
      }
    }
    // S469 fix round 2 (F4) — a destructuring declaration's pattern (`const { g = check } = o`)
    // carries its defaults as expressions under `name`: they are values like any other.
    if (DECL_KINDS.has(kind) && st.name && typeof st.name === "object") this.patternDefaults(st.name, scope, fn);
    // Text-only: a multi-statement `on mount` body carries no exprNode; a bare `{ … }` block (or
    // any statement text the expression parser could not read) carries a parse-error hatch.
    const textOnly = st._onMountEffect === true ? !st.exprNode || isParseErrorHatch(st.exprNode) : isParseErrorHatch(st.exprNode);
    if (kind === "bare-expr" && typeof st.expr === "string" && textOnly) {
      const stmts = this.parseBody(st.expr);
      // An `on mount` body is an effect, not render-time. The statements inside are checked
      // nowhere else, so a whole-statement call among them is reported here — unless the text
      // is itself the operand of a `!{}`.
      if (stmts) this.statements(stmts, scope, textCtx(st._onMountEffect === true ? PLAIN_FN : fn), handling === "operand" ? "operand" : "none");
      else this.unreadText(st.expr, scope, st._onMountEffect === true ? PLAIN_FN : fn);
    }
  }
}

const NO_REPORT: Cb = () => {};

/**
 * What a function returns, as a function value: `may` — a failable function any `return` may be
 * (fail closed); `exact` — the failable functions it PROVABLY returns (every `return` operand is
 * provably one of them, at least one `return` exists, and no part of the body was unreadable), or
 * null.
 */
export interface ReturnFacts { may: string | null; exact: string[] | null; }
const NO_RETURNS: ReturnFacts = { may: null, exact: null };

/** Per env: a declaration / function value → what its body returns. */
const returnsCache = new WeakMap<FailableEnv, WeakMap<object, ReturnFacts>>();

const quietEnvs = new WeakMap<FailableEnv, FailableEnv>();
/** The env a return-judging walk runs with: it reports nothing and stamps nothing (memoized per env). */
function quietEnv(env: FailableEnv): FailableEnv {
  if (!env.onFailableMatchSubject) return env;
  let q = quietEnvs.get(env);
  if (!q) { q = { ...env, onFailableMatchSubject: undefined }; quietEnvs.set(env, q); }
  return q;
}

/**
 * What a function body RETURNS (`ReturnFacts`): its own `return` operands (not those of a function
 * nested in it), or the tail expression of a `fn` body.
 */
function failableFnReturnedByBody(
  owner: object, params: unknown, body: unknown[], isFnTail: boolean, scope: LocalScope | null, env: FailableEnv,
): ReturnFacts {
  let byEnv = returnsCache.get(env);
  if (!byEnv) { byEnv = new WeakMap(); returnsCache.set(env, byEnv); }
  const cached = byEnv.get(owner);
  if (cached) return cached;
  byEnv.set(owner, NO_RETURNS); // a self-reference while judging reads "not known" (never provable)
  const w = new Walker(quietEnv(env), NO_REPORT);
  const ctx: FnCtx = { inFunction: true, inFailableFn: false };
  const sink = { ctx, found: null as string | null, exact: null as string[] | null, allExact: true };
  w.returnSink = sink;
  const inner = new LocalScope(scope);
  w.params(params, inner, ctx);
  w.statements(body, inner, ctx);
  let found = sink.found;
  let exact = sink.allExact && !w.unreadable ? sink.exact : null;
  if (sink.found === null && sink.exact === null && isFnTail && body.length > 0) {
    const last = body[body.length - 1] as Record<string, unknown> | null;
    if (last && last.kind === "bare-expr") {
      const lk = scopeLookup(inner, env);
      found = failableFnValueOf(last.exprNode as ExprNode | undefined, lk);
      exact = sink.allExact && !w.unreadable ? exactFnValueOf(last.exprNode as ExprNode | undefined, lk) : null;
    }
  }
  const facts: ReturnFacts = { may: found, exact: found === null ? null : exact };
  byEnv.set(owner, facts);
  return facts;
}

/**
 * What a CALL of `value` returns (`ReturnFacts`), when `value` is itself a function (or names one):
 * an arrow whose body may yield one, a name whose call may, either side of a choice. Provable
 * (`exact`) only through a name, an arrow, a function expression, a ternary both of whose arms are
 * provable, or a cast.
 */
function lambdaOrValueReturns(
  value: ExprNode | null | undefined, scope: LocalScope | null, env: FailableEnv, lk: FnValueLookup, depth = 0,
): ReturnFacts {
  if (!value || typeof value !== "object" || depth > 64) return NO_RETURNS;
  switch (value.kind) {
    case "ident": {
      const may = lk.returns(value.name);
      return { may, exact: may === null ? null : lk.returnsExact(value.name) };
    }
    case "lambda": {
      if (value.body && value.body.kind === "expr") {
        const inner = new LocalScope(scope);
        for (const n of paramNames(value.params)) inner.names.set(n, null);
        const ilk = scopeLookup(inner, env);
        const may = failableFnValueOf(value.body.value, ilk);
        return { may, exact: may === null ? null : exactFnValueOf(value.body.value, ilk) };
      }
      if (value.body && value.body.kind === "block") {
        return failableFnReturnedByBody(value, value.params, value.body.stmts as unknown[], false, scope, env);
      }
      return NO_RETURNS;
    }
    case "escape-hatch": {
      const r = value as unknown as Record<string, unknown>;
      if (typeof r.bodyRaw !== "string") return NO_RETURNS;
      const stmts = env.parseStatements(r.bodyRaw);
      return stmts ? failableFnReturnedByBody(value, r.params, stmts, false, scope, env) : NO_RETURNS;
    }
    case "ternary": {
      const a = lambdaOrValueReturns(value.consequent, scope, env, lk, depth + 1);
      const b = lambdaOrValueReturns(value.alternate, scope, env, lk, depth + 1);
      return { may: a.may ?? b.may, exact: a.exact !== null && b.exact !== null ? unionNames(a.exact, b.exact) : null };
    }
    case "binary":
      if (value.op === "||" || value.op === "??") {
        const a = lambdaOrValueReturns(value.left, scope, env, lk, depth + 1);
        return { may: a.may ?? lambdaOrValueReturns(value.right, scope, env, lk, depth + 1).may, exact: null };
      }
      if (value.op === "&&") return { may: lambdaOrValueReturns(value.right, scope, env, lk, depth + 1).may, exact: null };
      return NO_RETURNS;
    case "cast": return lambdaOrValueReturns(value.expression, scope, env, lk, depth + 1);
    default: return NO_RETURNS;
  }
}

/**
 * What a binding's initializer makes it (S468): the failable function the value may be (`is`), the
 * failable function a call of it may return (`returns`), and the PROVABLE versions of both
 * (`isExact` / `returnsExact`; the caller keeps those only for a binding never written again).
 */
export function failableBindingFacts(init: ExprNode | null | undefined, env: FailableEnv): {
  is: string | null; returns: string | null; isExact: string[] | null; returnsExact: string[] | null;
} {
  const lk = scopeLookup(null, env);
  const is = failableFnValueOf(init, lk);
  const r = lambdaOrValueReturns(init, null, env, lk);
  return { is, returns: r.may, isExact: is === null ? null : exactFnValueOf(init, lk), returnsExact: r.exact };
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
