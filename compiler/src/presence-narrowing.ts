/**
 * presence-narrowing.ts — THE §42 presence-narrowing reader (S459 D1 round 7).
 *
 * One walker answers "at this expression, which possibly-`not` receivers are PROVEN
 * present?" for every consumer that judges an absence-unsafe use:
 *   - E-TYPE-046 (type-system.ts `checkOptionalMemberAccess`): a bare member / index /
 *     method hop through a plain-optional `@cell` (§42.3.5).
 *   - E-TYPE-031 for component props (component-expander.ts): a call of an OPTIONAL
 *     function-typed prop — `fn | not` in the body — with no absence check (§15.11.4).
 * Both used to carry their own model; a component prop is now judged exactly as a
 * `T | not` cell is.
 *
 * Governing text — §42.3.5: a use through a possibly-`not` receiver is absence-safe when
 *   (1) "Optional chaining the access itself — … `recv?.method(...)`", or
 *   (2) "Narrowing … via any canonical presence-discrimination: the `if=` markup guard
 *       (§42.4), `given recv :> { ... }`, an `if (recv is not) return` / `is some`
 *       early-return, or a `match recv …` arm".
 * (1) is the consumer's own judgement (it sees the `optional` flag on the hop / call).
 * (2) is this walker. The discriminations it reads (`narrowsWhen`):
 *   - `recv is some`, bare `recv` (truthiness — `not` is falsy, §42.4)   → present when TRUE
 *   - `recv is not`, `!recv` / `not recv`, `recv == not`                → present when FALSE
 *   - `recv != not`                                                     → present when TRUE
 * composed through `&&` (both sides, when true) / `||` (both sides, when false) / `!` (`narrowsWhen`),
 * and the regions they narrow:
 *   - `if (D) { A } else { B }`: A with D's TRUE-facts, B with its FALSE-facts;
 *   - an `if (D) <exit>` whose consequent exits (return / fail) narrows the REST of the
 *     enclosing statement list with D's FALSE-facts (early return);
 *   - `D ? A : B` (same split as `if`), `D && E` (E with D's TRUE-facts), `D || E` (E with
 *     D's FALSE-facts);
 *   - `if=` / `else-if=` on a markup element (bare receiver): the element's
 *     children AND its own other attributes (the element — and so its handlers — exists
 *     only while the guard holds, §42.4);
 *   - NOT `show=`. §17.2: "`show=` SHALL NOT narrow. Because the element and its children
 *     exist and are evaluated while `expr` is false, a binding tested by `show=` keeps its
 *     un-narrowed type inside the element (§42.3.5)". A `show=` element is hidden, not
 *     removed, so its children, attributes and handlers all run while the receiver is `not`
 *     (S451 rec 1; S460 F1 removed it from both guard tests below);
 *   - `given recv :> { … }` body; a `match recv { … }` body.
 *
 * S462 — a narrowing ENDS at a write. §42.3.5: "A write to the narrowed place — direct,
 * in a nested block, or by a call that writes it or whose write set cannot be
 * determined — ends the narrowing from that point; a later member access through it is
 * E-TYPE-046." The consumer says what ONE node writes (`endsAt`: an assignment's target,
 * a call's write set, or "all" for a call it cannot resolve); this module owns the one
 * structural reading of WHEN that write happens (`endsWithin`):
 *   - in evaluation order: a statement's write ends the narrowing for the statements
 *     after it, and inside one expression for the operands evaluated after it;
 *   - a write anywhere in a nested block (`if` branch, `given` / `match` body, `try`, …)
 *     ends it after that block — except in a branch that always exits (`return` /
 *     `fail`), whose writes never reach the rest of the list;
 *   - a loop's body (and its per-iteration condition / update) runs again after itself,
 *     so a write anywhere in it ends the narrowing for the WHOLE body and condition;
 *   - a definition runs nothing: a function declaration's or a lambda's body writes only
 *     when it is called — the consumer's `endsAt` for that call accounts for it;
 *   - a markup element's attributes (event handlers) run later, not where it stands.
 * A fresh presence test after the write narrows again, as any test does.
 */

import { impliedLiftCheckPieces } from "./implied-lift-desugar.ts";
import { ifChainChildNodes } from "./ast-if-chain.js";
import { isEventHandlerAttrName } from "./multi-statement-scan.ts";

/** A source span (the subset this module reads / passes through). */
export type NarrowSpan = { file?: string; start?: number; end?: number; line?: number; col?: number };

type Rec = Record<string, unknown>;

export interface PresenceNarrowingOptions {
  /** The tracked possibly-`not` receiver an EXPRESSION denotes (a key), or null. */
  receiverKey(node: unknown): string | null;
  /** The receiver an `if=` / `else-if=` guard value names (defaults to `receiverKey`). */
  guardKey?(node: unknown): string | null;
  /** The receiver a `given` variable NAME names (defaults to `receiverKey` of an ident). */
  givenKey?(name: string): string | null;
  /**
   * Called for every expression node, pre-order, with the receivers proven present AT
   * that node. The consumer fires its own diagnostic here.
   */
  onExpr(node: Rec, present: ReadonlySet<string>, span: NarrowSpan): void;
  /**
   * Optional: the statement list hidden in an opaque expression (a block-bodied arrow the
   * parser kept as an escape hatch). Walked with the presence set of its position.
   */
  expandOpaque?(node: Rec): unknown[] | null;
  /**
   * S462 (§42.3.5) — the receivers whose narrowing EVALUATING this one node ends: the
   * target of an assignment / `reset`, the write set of a call. The node's OWN effect
   * only — the walker reaches its operands and nested blocks itself (`endsWithin`).
   * `"all"` ends every narrowing in force (a call whose write set cannot be determined).
   * `null` / absent: this node writes nothing a consumer tracks.
   */
  endsAt?(node: Rec): string[] | "all" | null;
  /**
   * S462 Q10 ("a") — the receivers a STATEMENT proves present once it has run: a write
   * whose value is provably present ("a struct/object literal, a value of a non-optional
   * type") "narrows the place again from that point".
   */
  narrowsAt?(stmt: Rec): string[];
  /**
   * S462 Q12 ("a") — the receivers a function body created here does NOT inherit (it may
   * run later; it re-tests). Reactive cells; a captured LOCAL keeps its narrowing.
   * Absent: every narrowing is inherited.
   */
  closureDrops?(key: string): boolean;
  /**
   * S462 Q12 ("a") — is argument `index` of this call a callback a built-in calls
   * synchronously and does not retain (`.map` / `.filter` / … on a KNOWN built-in
   * receiver)? Such a lambda keeps the narrowing of its position.
   */
  syncCallbackArg?(call: Rec, index: number): boolean;
}

/** The narrowings a piece of code ends: a set of receiver keys, or every one. */
export type NarrowEnds = ReadonlySet<string> | "all";

const NO_ENDS: ReadonlySet<string> = new Set<string>();

/** Union of two end sets (`"all"` absorbs). */
export function unionEnds(a: NarrowEnds, b: NarrowEnds): NarrowEnds {
  if (a === "all" || b === "all") return "all";
  if (b.size === 0) return a;
  if (a.size === 0) return b;
  const s = new Set(a);
  for (const k of b) s.add(k);
  return s;
}

/**
 * Where a narrowing ENDED (S462), so a consumer's diagnostic can name the root cause
 * ("narrowed, then written") instead of only "not narrowed". Kept beside a presence set
 * (keyed by the set object — every set the walk passes on is a fresh one when it changes).
 */
export interface NarrowEndInfo {
  /** The statement / operand whose write ended it. */
  span: NarrowSpan;
  /** True when it ended at a call whose write set cannot be determined. */
  unresolved: boolean;
  /**
   * Why it ended: a write in `src` (`"write"`), a function body that may run later
   * (`"closure"`, S462 Q12), or a deferred body judged after the rest of its block
   * (`"deferred"`).
   */
  why: "write" | "closure" | "deferred";
  /** The code whose write ended it — `findEndCause` names the node inside it. */
  src?: unknown;
}
const ENDED_INFO = new WeakMap<ReadonlySet<string>, ReadonlyMap<string, NarrowEndInfo>>();

/** The write that ended `key`'s narrowing on the way to this presence set, if any. */
export function narrowingEndedAt(present: ReadonlySet<string>, key: string): NarrowEndInfo | undefined {
  return ENDED_INFO.get(present)?.get(key);
}

/** The presence set with every ended receiver removed (recording where, for diagnostics). */
function withoutEnds(
  present: ReadonlySet<string>,
  ends: NarrowEnds,
  at?: NarrowSpan,
  src?: unknown,
  why: NarrowEndInfo["why"] = "write",
): ReadonlySet<string> {
  if (ends !== "all" && ends.size === 0) return present;
  if (present.size === 0) return present;
  const removed = ends === "all" ? [...present] : [...ends].filter((k) => present.has(k));
  if (removed.length === 0) return present;
  const out = new Set(present);
  for (const k of removed) out.delete(k);
  const prior = ENDED_INFO.get(present);
  const info = new Map(prior ?? []);
  if (at) for (const k of removed) info.set(k, { span: at, unresolved: ends === "all", why, src });
  if (info.size > 0) ENDED_INFO.set(out, info);
  return out;
}

/**
 * The FIRST node inside `src`, in the order `endsWithin` reads it, whose own write ends
 * `key` (or every narrowing) — so a diagnostic can name the call / assignment itself.
 */
export function findEndCause(src: unknown, key: string, opts: Pick<PresenceNarrowingOptions, "endsAt">): Rec | null {
  if (!opts.endsAt || !src || typeof src !== "object") return null;
  if (Array.isArray(src)) {
    for (const el of src) { const c = findEndCause(el, key, opts); if (c) return c; }
    return null;
  }
  const n = src as Rec;
  if (typeof n.kind === "string" && DEFINITION_KINDS.has(n.kind)) return null;
  if (n.kind === "call" && Array.isArray(n.args)) {
    // A callback handed to the call runs inside it: name the call IN its body that ends
    // the narrowing (`acc.concat(…)`), not the outer call, when there is one.
    for (const a of n.args as Rec[]) {
      if (a && a.kind === "lambda" && a.body && typeof a.body === "object") {
        const b = a.body as Rec;
        const c = findEndCause(b.kind === "block" ? b.stmts : b.kind === "expr" ? b.value : b, key, opts);
        if (c) return c;
      }
    }
  }
  for (const k of Object.keys(n)) {
    if (k === "span" || k === "attrs") continue;
    const v = n[k];
    if (v && typeof v === "object") { const c = findEndCause(v, key, opts); if (c) return c; }
  }
  if (typeof n.kind === "string") {
    const own = opts.endsAt(n);
    if (own === "all" || (own && own.includes(key))) return n;
  }
  return null;
}

/** Keys minus the ended ones. */
function keysWithoutEnds(keys: string[], ends: NarrowEnds): string[] {
  if (ends === "all") return [];
  return ends.size === 0 ? keys : keys.filter((k) => !ends.has(k));
}

/**
 * Node kinds whose body does NOT run where the node stands — a definition. Its body
 * writes only when it is called (the consumer's `endsAt` for that call says what).
 */
const DEFINITION_KINDS = new Set(["function-decl", "lambda", "component-def", "type-decl"]);

/** Loop kinds: the body (and the per-iteration test) runs again after itself. */
const LOOP_KINDS = new Set(["for-stmt", "for-expr", "while-stmt", "do-while-stmt"]);

/**
 * S462 — the narrowings that EXECUTING `node` (a statement, an expression, a list of
 * either) may end, by the rules in the module header. Pure; the one structural reading
 * of "a write ends the narrowing", shared by the walk below and by every consumer that
 * summarises a function body (its write set).
 */
export function endsWithin(
  node: unknown,
  opts: Pick<PresenceNarrowingOptions, "endsAt">,
  allPaths = false,
): NarrowEnds {
  if (!opts.endsAt || !node || typeof node !== "object") return NO_ENDS;
  // Memoised per options object and mode (the walk asks again for every enclosing
  // level). A consumer whose `endsAt` answers change (a write-set fixpoint) passes a
  // fresh object.
  const memos = allPaths ? ENDS_MEMO_ALL : ENDS_MEMO;
  let memo = memos.get(opts);
  if (!memo) { memo = new WeakMap(); memos.set(opts, memo); }
  const hit = memo.get(node as object);
  if (hit) return hit;
  const out = endsWithinUncached(node, opts, allPaths);
  memo.set(node as object, out);
  return out;
}

/**
 * S462 fix round 1 (F1) — what a piece of code MAY write on ANY path, an exiting branch
 * included: the write set of a function body, a lambda body, a deferred body. A
 * function's write set is a may-write set — `if (c) { @user = not; return }` writes
 * `@user` even though the rest of the body never sees it. (`endsWithin` without
 * `allPaths` answers the other question — what reaches the rest of THIS list.)
 */
export function mayWriteWithin(node: unknown, opts: Pick<PresenceNarrowingOptions, "endsAt">): NarrowEnds {
  return endsWithin(node, opts, true);
}

const ENDS_MEMO = new WeakMap<object, WeakMap<object, NarrowEnds>>();
const ENDS_MEMO_ALL = new WeakMap<object, WeakMap<object, NarrowEnds>>();

/** Node kinds whose `body` is a list of mutually exclusive arms (one runs). */
const ARM_LIST_KINDS = new Set(["match-stmt", "match-expr"]);

function endsWithinUncached(node: object, opts: Pick<PresenceNarrowingOptions, "endsAt">, allPaths: boolean): NarrowEnds {
  if (!opts.endsAt) return NO_ENDS;
  const sub = (x: unknown): NarrowEnds => endsWithin(x, opts, allPaths);
  // In the "rest of this list" mode a branch / arm that always exits never reaches it.
  const reaches = (body: unknown): boolean => allPaths || !exits(body);
  if (Array.isArray(node)) {
    let acc: NarrowEnds = NO_ENDS;
    for (const el of node) {
      acc = unionEnds(acc, sub(el));
      if (acc === "all") return acc;
    }
    return acc;
  }
  const n = node as Rec;
  if (typeof n.kind === "string" && DEFINITION_KINDS.has(n.kind)) return NO_ENDS;
  let acc: NarrowEnds = NO_ENDS;
  if (typeof n.kind === "string") {
    const own = opts.endsAt(n);
    if (own === "all") return "all";
    if (own && own.length > 0) acc = new Set(own);
  }
  if (n.kind === "if-stmt" || n.kind === "if-expr") {
    acc = unionEnds(acc, sub(n.condExpr));
    if (reaches(n.consequent)) acc = unionEnds(acc, sub(n.consequent));
    if (reaches(n.alternate)) acc = unionEnds(acc, sub(n.alternate));
    return acc;
  }
  if (typeof n.kind === "string" && ARM_LIST_KINDS.has(n.kind)) {
    acc = unionEnds(acc, sub(n.headerExpr));
    acc = unionEnds(acc, sub(n.scrutineeExprs));
    for (const arm of (n.body as unknown[] | undefined) ?? []) {
      const armBody = (arm as Rec | undefined)?.body;
      if (reaches(armBody)) acc = unionEnds(acc, sub(arm));
      if (acc === "all") return acc;
    }
    return acc;
  }
  if (n.kind === "markup") {
    // Attributes (event handlers) run later; the children render where the element stands.
    return unionEnds(acc, sub(n.children));
  }
  // A `defer` body runs at its block's exit (§19.16.2): its writes are part of what the
  // enclosing block does (the walk below does not apply them in place — see
  // walkBodyNarrowed), so they are counted here, with the rest of the node.
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") {
      acc = unionEnds(acc, sub(v));
      if (acc === "all") return acc;
    }
  }
  return acc;
}

/**
 * The receivers a condition PROVES present when it evaluates to `truth`:
 *   - `recv is some`, bare `recv` (truthiness — `not` is falsy, §42.4), `recv != not`
 *     prove `recv` present when TRUE;
 *   - `recv is not`, `recv == not` prove it present when FALSE;
 *   - `!D` / `not D` swaps the truth; `A && B` proves both sides' TRUE-facts when true;
 *     `A || B` proves both sides' FALSE-facts when false.
 */
export function narrowsWhen(
  cond: unknown,
  truth: boolean,
  receiverKey: (n: unknown) => string | null,
  endsOf?: (n: unknown) => NarrowEnds,
): string[] {
  let c = cond as Rec | undefined;
  while (c && c.kind === "paren" && c.expr) c = c.expr as Rec;
  if (!c) return [];
  if (c.kind === "binary") {
    // S462 (fix round 1, F5c) — evaluation order: the left operand's facts hold only
    // until the right operand writes; the right operand's facts hold from its own test
    // on ("from that point"). So `wipe() && @user is given` narrows `@user`, and
    // `@user is given && wipe()` does not (when `wipe` writes it).
    const ordered = (side: boolean): string[] => [
      ...keysWithoutEnds(narrowsWhen(c!.left, side, receiverKey, endsOf), endsOf ? endsOf(c!.right) : NO_ENDS),
      ...narrowsWhen(c!.right, side, receiverKey, endsOf),
    ];
    if (c.op === "&&") return truth ? ordered(true) : [];
    if (c.op === "||") return truth ? [] : ordered(false);
    if (c.op === "is-some" || c.op === "is-not") {
      const key = receiverKey(c.left);
      return key && (truth === (c.op === "is-some")) ? [key] : [];
    }
    if (c.op === "==" || c.op === "!=") {
      const isNot = (x: unknown) => {
        const r = x as Rec | undefined;
        return !!r && r.kind === "lit" && (r.litType === "not" || r.litType === "null" || r.litType === "undefined");
      };
      const key = isNot(c.right) ? receiverKey(c.left) : isNot(c.left) ? receiverKey(c.right) : null;
      return key && (truth === (c.op === "!=")) ? [key] : [];
    }
    return [];
  }
  if (c.kind === "unary" && (c.op === "!" || c.op === "not") && c.prefix !== false) {
    return narrowsWhen(c.argument, !truth, receiverKey, endsOf);
  }
  const key = receiverKey(c);
  return key && truth ? [key] : [];
}

function withKey(present: ReadonlySet<string>, key: string | null | undefined): ReadonlySet<string> {
  if (!key || present.has(key)) return present;
  const s = new Set(present);
  s.add(key);
  // A fresh test narrows again; the other receivers' end records carry over.
  const prior = ENDED_INFO.get(present);
  if (prior) {
    const info = new Map(prior);
    info.delete(key);
    if (info.size > 0) ENDED_INFO.set(s, info);
  }
  return s;
}
function withKeys(present: ReadonlySet<string>, keys: string[]): ReadonlySet<string> {
  let out = present;
  for (const k of keys) out = withKey(out, k);
  return out;
}

// `argExprs` (s461) is an ExprNode LIST — one node per argument of a reactive
// array mutation (§6.5.1); every other key holds a single ExprNode.
const EXPR_KEYS = ["exprNode", "initExpr", "condExpr", "headerExpr", "resultExpr", "argsExpr", "argExprs", "conditionExpr", "callbackExpr", "valueExpr"];
const CHILD_KEYS = ["body", "children", "consequent", "alternate", "cases", "arms"];

/** The ExprNodes an `EXPR_KEYS` field holds, in order (`argExprs` is a list, s461). */
function exprKeyNodes(v: unknown): Rec[] {
  if (Array.isArray(v)) return v.filter((e): e is Rec => !!e && typeof e === "object");
  return v && typeof v === "object" ? [v as Rec] : [];
}

/**
 * Walk one expression tree, calling `onExpr` with the presence set at every node.
 * Operands are visited in evaluation order; a write in one (S462, `endsWithin`) ends
 * the narrowing for the operands evaluated after it.
 */
export function walkExprNarrowed(
  node: unknown,
  present: ReadonlySet<string>,
  span: NarrowSpan,
  opts: PresenceNarrowingOptions,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    let p = present;
    for (const el of node) {
      walkExprNarrowed(el, p, span, opts);
      p = withoutEnds(p, endsWithin(el, opts), span, el);
    }
    return;
  }
  const n = node as Rec;
  if (typeof n.kind === "string") opts.onExpr(n, present, span);
  if (typeof n.kind === "string" && ARM_LIST_KINDS.has(n.kind)) {
    // S462 (F5a) — a value-position `match`: the header, then the arms as alternatives.
    walkExprNarrowed(n.headerExpr, present, span, opts);
    const after = withoutEnds(present, endsWithin(n.headerExpr, opts), span, n.headerExpr);
    walkAlternatives((n.body as unknown[]) ?? [], after, span, opts);
    return;
  }
  if (n.kind === "ternary" || n.kind === "conditional") {
    const cond = (n.condition ?? n.test) as unknown;
    walkExprNarrowed(cond, present, span, opts);
    const condEnds = endsWithin(cond, opts);
    const after = withoutEnds(present, condEnds, span, cond);
    walkExprNarrowed(n.consequent, withKeys(after, facts(cond, true, opts)), span, opts);
    walkExprNarrowed(n.alternate, withKeys(after, facts(cond, false, opts)), span, opts);
    return;
  }
  if (n.kind === "binary" && (n.op === "&&" || n.op === "||")) {
    // `A && B` evaluates B only when A is true; `A || B` only when A is false.
    walkExprNarrowed(n.left, present, span, opts);
    const leftEnds = endsWithin(n.left, opts);
    const after = withoutEnds(present, leftEnds, span, n.left);
    walkExprNarrowed(n.right, withKeys(after, facts(n.left, n.op === "&&", opts)), span, opts);
    return;
  }
  if (n.kind === "call" && opts.syncCallbackArg && Array.isArray(n.args)) {
    // S462 Q12 — mark the lambdas a known built-in calls synchronously (they keep the
    // narrowing of their position); every other lambda starts without cell narrowings.
    (n.args as unknown[]).forEach((a, i) => {
      if (a && typeof a === "object" && opts.syncCallbackArg!(n, i)) SYNC_CALLBACKS.add(a as object);
    });
  }
  if (n.kind === "lambda") {
    let inner = closureEntry(present, n, span, opts);
    if (n.body && typeof n.body === "object" && (n.body as Rec).kind === "block") {
      // S462 fix round 5 — parameter defaults run first, on each call, before the body.
      inner = walkParamDefaults(n, inner, span, opts);
      walkBodyNarrowed(((n.body as Rec).stmts as unknown[]) ?? [], inner, span, opts);
      return;
    }
    // Parameter defaults and an expression body: run when the lambda is called.
    for (const key of Object.keys(n)) {
      if (key === "span") continue;
      const v = n[key];
      if (v && typeof v === "object") walkExprNarrowed(v, inner, span, opts);
    }
    return;
  }
  if (opts.expandOpaque && n.kind === "escape-hatch") {
    const stmts = opts.expandOpaque(n);
    if (stmts) {
      // S462 fix round 5 — the parser's structured parameters: their defaults run first.
      const inner = walkParamDefaults(n, closureEntry(present, n, span, opts), span, opts);
      walkBodyNarrowed(stmts, inner, span, opts);
      return;
    }
  }
  // Operands in evaluation order (a call's callee, then its arguments, then the call
  // itself — whose own write the PARENT applies through `endsWithin`).
  let p = present;
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") {
      walkExprNarrowed(v, p, span, opts);
      if (n.kind !== "lambda") p = withoutEnds(p, endsWithin(v, opts), span, v);
    }
  }
}

/**
 * S462 fix round 5 — the default values of a function value's STRUCTURED parameters (a
 * `lambda`'s, or a block-bodied arrow escape hatch's parser-recorded `params`), in order.
 * A default is evaluated on each call, before the body.
 */
export function paramDefaults(fn: Rec): unknown[] {
  const out: unknown[] = [];
  for (const p of (fn.params as Rec[] | undefined) ?? []) {
    const d = p && typeof p === "object" ? (p as Rec).defaultValue : undefined;
    if (d && typeof d === "object") out.push(d);
  }
  return out;
}

/** Walk a function value's parameter defaults (reads checked; their writes end narrowings). */
function walkParamDefaults(fn: Rec, present: ReadonlySet<string>, span: NarrowSpan, opts: PresenceNarrowingOptions): ReadonlySet<string> {
  let p = present;
  for (const d of paramDefaults(fn)) {
    walkExprNarrowed(d, p, span, opts);
    p = withoutEnds(p, endsWithin(d, opts), span, d);
  }
  return p;
}

/**
 * S462 Q18 ("a") — the mark an `if=` / `else-if=` gate leaves beside each receiver it
 * narrows. Presence keys are receiver names chosen by the consumer; a NUL-prefixed key
 * cannot be one, and no consumer looks it up. A mark lives exactly as long as the set it
 * is in: a function body that drops reactive narrowings (`closureDrop`) drops the marks
 * too, so a closure created inside the gated subtree does not inherit the exemption.
 */
const GATE_MARK = "\u0000gate:";

/**
 * S462 Q18 ("a") — the presence set an event handler starts with. As any function body
 * (Q12) it re-tests reactive cells, EXCEPT a receiver narrowed by the chain of `if=` /
 * `else-if=` gates enclosing the handler (the element's own or an ancestor's, still
 * narrowed here): render-gating removes the subtree and its listener synchronously on the
 * write that ends the gate's condition, so the handler cannot run while it is `not`.
 * `show=` never gates (it hides, it does not remove). A write inside the handler still
 * ends the narrowing from that point (S462 "b") — the body walk does that.
 *
 * S462 round 6 (F6-2, review #6) — the removal guarantee holds for every event dispatched
 * AFTER the write (delegated events never reach a detached node; a direct listener checks
 * that its element is connected, codegen/detached-listener.ts). It does NOT hold for an
 * event a browser fires DURING the removal, while the node is still connected — Chromium
 * fires `blur` / `focusout` on a focused element inside `remove()` (measured, Playwright
 * Chromium), and other engines cannot be checked here. So the exemption is FAIL-CLOSED: it
 * applies only to the events in `USER_INPUT_EVENTS` (exact names), which a user agent fires
 * as their own task from direct user input, never synchronously from a DOM mutation. Every
 * other event — the focus family, every leave / out / cancel event, animation and
 * transition events, custom events, unknown names — keeps no gate narrowing.
 */
function handlerEntry(present: ReadonlySet<string>, handler: Rec, span: NarrowSpan, opts: PresenceNarrowingOptions, eventName = ""): ReadonlySet<string> {
  const entry = closureEntry(present, handler, span, opts);
  if (!USER_INPUT_EVENTS.has(eventName)) return entry;
  const gated = [...present].filter((k) => !k.startsWith(GATE_MARK) && present.has(GATE_MARK + k));
  return withKeys(entry, gated);
}

/**
 * S462 round 6 (review #6 ruling) — the events a gated handler keeps the gate's narrowing
 * for: fired by the user agent as their own task from direct user input. An ALLOW-list by
 * exact name; when in doubt a name is left out. Pruned from the reviewer's list: `change`
 * (a browser may commit a pending value change as part of the blur it fires when a focused
 * control is removed).
 */
const USER_INPUT_EVENTS = new Set([
  "click", "dblclick", "auxclick", "contextmenu",
  "input", "beforeinput", "submit", "reset",
  "keydown", "keyup", "keypress",
  "mousedown", "mouseup", "mousemove", "pointerdown", "pointerup", "pointermove",
  "wheel", "touchstart", "touchmove", "touchend",
  "dragstart", "drag", "dragend", "dragenter", "dragover", "drop",
]);

/**
 * The DOM event an event-handler attribute names (`onclick` / `on:click` / `onclient:click`
 * → `click`), ASCII-lowercased: HTML attribute names are ASCII case-insensitive.
 */
function handlerEventName(attrName: string): string {
  return attrName.replace(/^on(?:client:|server:|:)?/i, "").toLowerCase();
}

/**
 * S462 round 6 (F6-4) — an event-handler value that IS a function (`onclick=${() => { … }}`,
 * `${(e) => …}`, `${function (e) { … }}`) is the handler itself (Q12: "an event handler, in
 * any form"), not a closure created inside it: its parameter defaults and body are walked
 * with the HANDLER's entry set (`at` — Q12 + the Q18 gate), and closures created inside
 * still start un-narrowed. Returns false when the value is not a function the walk can read
 * (the caller then walks it as an expression, which treats any function in it as a closure).
 */
function walkHandlerFunctionValue(val: Rec, at: ReadonlySet<string>, span: NarrowSpan, opts: PresenceNarrowingOptions): boolean {
  let fn = (val.exprNode as Rec | undefined) ?? null;
  while (fn && fn.kind === "paren" && fn.expr && typeof fn.expr === "object") fn = fn.expr as Rec;
  if (!fn) return false;
  const readable = fn.kind === "lambda" || (fn.kind === "escape-hatch" && !!opts.expandOpaque?.(fn));
  if (!readable) return false;
  // The value and the function node are visited as the expression walk would (a consumer
  // anchors its diagnostics on them — component-expander's E-TYPE-031 call positions).
  if (typeof val.kind === "string") opts.onExpr(val, at, span);
  opts.onExpr(fn, at, span);
  if (fn.kind === "lambda") {
    const p = walkParamDefaults(fn, at, span, opts);
    const body = fn.body as Rec | undefined;
    if (body && body.kind === "block") walkBodyNarrowed((body.stmts as unknown[]) ?? [], p, span, opts);
    else if (body && body.kind === "expr") walkExprNarrowed(body.value, p, span, opts);
    else return false;
    return true;
  }
  if (fn.kind === "escape-hatch" && opts.expandOpaque) {
    const stmts = opts.expandOpaque(fn);
    if (!stmts) return false;
    walkBodyNarrowed(stmts, walkParamDefaults(fn, at, span, opts), span, opts);
    return true;
  }
  return false;
}

/** Lambdas a known built-in calls synchronously (S462 Q12) — set by the call above them. */
const SYNC_CALLBACKS = new WeakSet<object>();

/**
 * S462 Q12 ("a") — the presence set a function body created HERE starts with: it may run
 * later, after writes this walk does not see, so it does not inherit the narrowing of
 * reactive cells (`closureDrops`) — unless a known built-in calls it synchronously.
 */
function closureEntry(present: ReadonlySet<string>, fn: Rec, span: NarrowSpan, opts: PresenceNarrowingOptions): ReadonlySet<string> {
  if (present.size === 0) return present;
  if (SYNC_CALLBACKS.has(fn)) {
    // S462 fix round 3 (NEW-1) — a callback a built-in calls synchronously runs ONCE PER
    // ELEMENT: it is a loop body. As for `LOOP_KINDS`, what the body may write ends the
    // narrowing on entry (the next call sees the previous call's writes).
    const body = fn.kind === "lambda"
      ? ((fn.body as Rec | undefined)?.kind === "block" ? (fn.body as Rec).stmts : (fn.body as Rec | undefined)?.kind === "expr" ? (fn.body as Rec).value : fn.body)
      : opts.expandOpaque?.(fn) ?? null;
    if (body === null || body === undefined) return closureDrop(present, fn, span, opts);
    // The parameter defaults run on every call too (S462 fix round 5).
    return withoutEnds(present, mayWriteWithin([...paramDefaults(fn), body], opts), span, body);
  }
  return closureDrop(present, fn, span, opts);
}

function closureDrop(present: ReadonlySet<string>, fn: Rec, span: NarrowSpan, opts: PresenceNarrowingOptions): ReadonlySet<string> {
  if (!opts.closureDrops) return present;
  const drop = new Set([...present].filter((k) => opts.closureDrops!(k)));
  return withoutEnds(present, drop, fn.kind === "function-decl" ? atOf(fn, span) : span, fn, "closure");
}

function spanOf(node: Rec, fallback: NarrowSpan): NarrowSpan {
  const s = node.span as NarrowSpan | undefined;
  return s && typeof s.line === "number" ? s : fallback;
}

/** The span of any value the walk passes (a node, a list — its first located node). */
function atOf(x: unknown, fallback: NarrowSpan): NarrowSpan {
  if (!x || typeof x !== "object") return fallback;
  if (Array.isArray(x)) {
    for (const el of x) { const s = atOf(el, fallback); if (s !== fallback) return s; }
    return fallback;
  }
  return spanOf(x as Rec, fallback);
}

function exits(stmts: unknown): boolean {
  return Array.isArray(stmts) && stmts.some((s) => {
    const r = s as Rec | undefined;
    return !!r && (r.kind === "return-stmt" || r.kind === "fail-stmt" || r.kind === "fail-expr");
  });
}

/** A condition's facts when it is `truth`, in evaluation order (F5c). */
function facts(cond: unknown, truth: boolean, opts: PresenceNarrowingOptions): string[] {
  return narrowsWhen(cond, truth, opts.receiverKey, (x) => endsWithin(x, opts));
}

/** The receivers an `if (D) <exit>` early return narrows for the rest of the list. */
function earlyReturnKeys(node: Rec, opts: PresenceNarrowingOptions): string[] {
  if (node.kind !== "if-stmt" || !exits(node.consequent)) return [];
  return facts(node.condExpr, false, opts);
}

function guardKeys(markup: Rec, opts: PresenceNarrowingOptions): string[] {
  const out: string[] = [];
  const attrs = markup.attrs as Rec[] | undefined;
  if (!Array.isArray(attrs)) return out;
  for (const attr of attrs) {
    const name = attr?.name as string | undefined;
    if (name !== "if" && name !== "else-if") continue;
    const val = attr.value as Rec | undefined;
    if (!val) continue;
    let target = (val.exprNode as Rec | undefined) ?? val;
    while (target && target.kind === "paren" && target.expr) target = target.expr as Rec;
    // S462 round 7 (R7-2) — a component body is re-parsed by the native parser, whose bare
    // `if=@cell` value is `{ kind: "variable-ref", name: "@cell" }` with no `exprNode`: it is
    // the same reference as the top-level `ident`, so a component-body gate narrows (its
    // children and its handlers) exactly as a top-level one does.
    if (target && target.kind === "variable-ref" && typeof target.name === "string") target = { kind: "ident", name: target.name };
    const key = (opts.guardKey ?? opts.receiverKey)(target);
    if (key) out.push(key);
  }
  return out;
}

/**
 * s461 — an implied `lift` that the §17.6.10 desugar (implied-lift-desugar.ts, CE
 * head) produced for an arm the PRE-s461 pass never desugared (any arm of a cascade
 * that reaches a `given` guard, at any depth) carries that arm's pre-desugar pieces
 * (`impliedLiftCheckPieces`). This walker does not descend into a `lift-expr`'s
 * `expr` object, so it judges those pieces in the lift's place — exactly what it
 * judged before s461 made the arm render. Without this, `${ given @o :> { <p>${@o.opt.x}</p> } }`
 * (or the same under `given → if`) would stop firing E-TYPE-046: a newly-ACCEPTING
 * change the s461 lowering fix must not make.
 *
 * Generic over position on purpose: it keys on the pieces being PRESENT, which the
 * desugar decides in one place. A lift with no pieces (an explicit `lift`, an
 * `if`-arm lift the old pass already made) is walked as before — its markup is a
 * pre-existing coverage hole; closing it is newly-REJECTING and not done here.
 */
function expandCheckPieces(body: unknown[]): unknown[] {
  return body.flatMap((s) => impliedLiftCheckPieces(s) ?? [s]);
}

/** Walk one statement / markup node with the current presence set. */
export function walkNodeNarrowed(
  node: unknown,
  present: ReadonlySet<string>,
  span: NarrowSpan,
  opts: PresenceNarrowingOptions,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { walkBodyNarrowed(node, present, span, opts); return; }
  const n = node as Rec;
  const here = spanOf(n, span);
  if (n.kind === "function-decl" && opts.closureDrops) {
    // S462 Q12 — a function declared inside a narrowed scope runs when called, later.
    present = closureEntry(present, n, here, opts);
  }
  if (typeof n.kind === "string" && LOOP_KINDS.has(n.kind)) {
    // S462 — the body, the per-iteration test and the C-style update run again after
    // themselves: a write anywhere in them ends the narrowing for all of them. The
    // iterable / C-style init runs once, before.
    const c = n.cStyleParts as Rec | undefined;
    let before = present;
    if (c && c.initExpr) before = withoutEnds(before, endsWithin(c.initExpr, opts), here, c.initExpr);
    if (n.iterExpr) before = withoutEnds(before, endsWithin(n.iterExpr, opts), here, n.iterExpr);
    const loopEnds = unionEnds(unionEnds(endsWithin(n.body, opts), endsWithin(n.condExpr, opts)),
      c ? unionEnds(endsWithin(c.condExpr, opts), endsWithin(c.updateExpr, opts)) : NO_ENDS);
    const inLoop = withoutEnds(before, loopEnds, here, n);
    for (const k of EXPR_KEYS) {
      for (const e of exprKeyNodes(n[k])) walkExprNarrowed(e, inLoop, here, opts);
    }
    walkBodyNarrowed((n.body as unknown[]) ?? [], inLoop, here, opts);
    return;
  }
  // The node's own expressions, in order; a write in one ends the narrowing for the rest
  // of the node (the branches of an `if`, the body of a `match`, …).
  let p = present;
  for (const k of EXPR_KEYS) {
    for (const e of exprKeyNodes(n[k])) {
      walkExprNarrowed(e, p, here, opts);
      p = withoutEnds(p, endsWithin(e, opts), here, e);
    }
  }
  present = p;
  if (n.kind === "markup") {
    let inner = present;
    // S462 Q18 — an `if=` / `else-if=` gate also MARKS what it narrows, so an event handler
    // inside the gated subtree (this element's or a descendant's) can keep it.
    for (const k of guardKeys(n, opts)) inner = withKey(withKey(inner, k), GATE_MARK + k);
    const attrs = n.attrs as Rec[] | undefined;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const val = attr?.value as Rec | undefined;
        if (!val || typeof val !== "object") continue;
        const isGuard = attr.name === "if" || attr.name === "else-if";
        const hb = (val.handlerBlock as Rec | undefined)?.stmts;
        // S462 Q12 — an event handler (any form: a statement list, an expression, a
        // lambda) is a function body: it runs later, so it re-tests reactive cells —
        // except what an enclosing `if=` gate narrows (Q18, `handlerEntry`).
        const isHandler = typeof attr.name === "string" && isEventHandlerAttrName(attr.name);
        const at = isGuard ? present
          : isHandler ? handlerEntry(inner, val, here, opts, handlerEventName(attr.name as string)) : inner;
        if (Array.isArray(hb)) walkBodyNarrowed(hb, at, here, opts);
        else if (!(isHandler && walkHandlerFunctionValue(val, at, here, opts))) walkExprNarrowed(val, at, here, opts);
      }
    }
    walkBodyNarrowed((n.children as unknown[]) ?? [], inner, here, opts);
    return;
  }
  if (n.kind === "if-chain") {
    // §17.1.1 — a collapsed `if=` / `else-if=` / `else` chain keeps its branch bodies under
    // `branches[].element` + `elseBranch` (ast-if-chain.js, the one module that knows).
    // Each branch element carries its own `if=` / `else-if=` attribute, so it narrows as any
    // gated element does; the `else` element narrows nothing (S462 round 6, F6-5 — the
    // chain was not walked at all before, so a bare read in any branch was unchecked).
    for (const child of ifChainChildNodes(n)) walkNodeNarrowed(child, present, here, opts);
    return;
  }
  if (n.kind === "given-guard") {
    let inner = present;
    for (const v of (n.variables as string[] | undefined) ?? []) {
      inner = withKey(inner, opts.givenKey ? opts.givenKey(v) : opts.receiverKey({ kind: "ident", name: v }));
    }
    walkBodyNarrowed((n.body as unknown[]) ?? [], inner, here, opts);
    return;
  }
  if (n.kind === "match-stmt") {
    // S462 (F5a) — the arms are ALTERNATIVES: one runs, so a write in one arm does not
    // end a narrowing in a sibling arm (after the match, `endsWithin` takes the union).
    walkAlternatives((n.body as unknown[]) ?? [], withKey(present, opts.receiverKey(n.headerExpr)), here, opts);
    return;
  }
  if (n.kind === "if-stmt" || n.kind === "if-expr") {
    // `present` already lost what the condition writes; the condition's facts are taken
    // in evaluation order (`facts`): a test after a write in the condition narrows.
    walkBodyNarrowed((n.consequent as unknown[]) ?? [], withKeys(present, facts(n.condExpr, true, opts)), here, opts);
    walkBodyNarrowed((n.alternate as unknown[]) ?? [], withKeys(present, facts(n.condExpr, false, opts)), here, opts);
    return;
  }
  for (const k of CHILD_KEYS) {
    const v = n[k];
    // `arms` (a handling form's arms, a guarded expression's arms) are alternatives.
    if (Array.isArray(v)) {
      if (k === "arms") walkAlternatives(v, present, here, opts);
      else walkBodyNarrowed(v, present, here, opts);
    }
  }
  for (const k of Object.keys(n)) {
    if (CHILD_KEYS.includes(k) || EXPR_KEYS.includes(k) || k === "attrs" || k === "children" || k === "span") continue;
    const v = n[k];
    if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === "object" && typeof (v[0] as Rec).kind === "string") {
      walkBodyNarrowed(v, present, here, opts);
    }
  }
}

/**
 * Walk a statement list, threading across siblings: an early return narrows the rest
 * of the list; a write (S462, `endsWithin`) ends a narrowing for the rest of the list.
 */
export function walkBodyNarrowed(
  body: unknown[],
  present: ReadonlySet<string>,
  span: NarrowSpan,
  opts: PresenceNarrowingOptions,
): void {
  if (!Array.isArray(body)) return;
  let acc = present;
  const pieces = expandCheckPieces(body);
  for (let i = 0; i < pieces.length; i++) {
    const node = pieces[i];
    const r = node as Rec | undefined;
    if (r && typeof r === "object" && r.kind === "defer-stmt") {
      // S462 (F5b) — a deferred body runs at the block's EXIT (§19.16.2), not here: its
      // writes end nothing for the statements after it in this list (they still count
      // for what the whole block does — `endsWithin` — so they end the narrowing AFTER
      // the block). It runs after the rest of the list, so it is judged with what the
      // rest of the list may write already ended.
      walkNodeNarrowed(node, withoutEnds(acc, mayWriteWithin(pieces.slice(i + 1), opts), atOf(r, span), pieces.slice(i + 1), "deferred"), span, opts);
      continue;
    }
    walkNodeNarrowed(node, acc, span, opts);
    if (r && typeof r === "object") {
      acc = withoutEnds(acc, endsWithin(r, opts), atOf(r, span), r);
      // An early return's facts hold for the rest of the list — less what the `else`
      // branch (which runs on the way here) may write.
      acc = withKeys(acc, keysWithoutEnds(earlyReturnKeys(r, opts), r.kind === "if-stmt" ? endsWithin(r.alternate, opts) : NO_ENDS));
      // S462 Q10 — a write of a provably present value narrows the place again.
      if (opts.narrowsAt) acc = withKeys(acc, opts.narrowsAt(r));
    }
  }
}

/** Walk mutually exclusive arms: each with the same presence set (one of them runs). */
function walkAlternatives(arms: unknown[], present: ReadonlySet<string>, span: NarrowSpan, opts: PresenceNarrowingOptions): void {
  for (const arm of arms) walkNodeNarrowed(arm, present, span, opts);
}
