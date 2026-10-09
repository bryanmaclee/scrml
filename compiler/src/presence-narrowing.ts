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
}
const ENDED_INFO = new WeakMap<ReadonlySet<string>, ReadonlyMap<string, NarrowEndInfo>>();

/** The write that ended `key`'s narrowing on the way to this presence set, if any. */
export function narrowingEndedAt(present: ReadonlySet<string>, key: string): NarrowEndInfo | undefined {
  return ENDED_INFO.get(present)?.get(key);
}

/** The presence set with every ended receiver removed (recording where, for diagnostics). */
function withoutEnds(present: ReadonlySet<string>, ends: NarrowEnds, at?: NarrowSpan): ReadonlySet<string> {
  if (ends !== "all" && ends.size === 0) return present;
  if (present.size === 0) return present;
  const removed = ends === "all" ? [...present] : [...ends].filter((k) => present.has(k));
  if (removed.length === 0) return present;
  const out = new Set(present);
  for (const k of removed) out.delete(k);
  const prior = ENDED_INFO.get(present);
  const info = new Map(prior ?? []);
  if (at) for (const k of removed) info.set(k, { span: at, unresolved: ends === "all" });
  if (info.size > 0) ENDED_INFO.set(out, info);
  return out;
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
export function endsWithin(node: unknown, opts: Pick<PresenceNarrowingOptions, "endsAt">): NarrowEnds {
  if (!opts.endsAt || !node || typeof node !== "object") return NO_ENDS;
  // Memoised per options object (the walk asks again for every enclosing level). A
  // consumer whose `endsAt` answers change (a write-set fixpoint) passes a fresh object.
  let memo = ENDS_MEMO.get(opts);
  if (!memo) { memo = new WeakMap(); ENDS_MEMO.set(opts, memo); }
  const hit = memo.get(node as object);
  if (hit) return hit;
  const out = endsWithinUncached(node, opts);
  memo.set(node as object, out);
  return out;
}

const ENDS_MEMO = new WeakMap<object, WeakMap<object, NarrowEnds>>();

function endsWithinUncached(node: object, opts: Pick<PresenceNarrowingOptions, "endsAt">): NarrowEnds {
  if (!opts.endsAt) return NO_ENDS;
  if (Array.isArray(node)) {
    let acc: NarrowEnds = NO_ENDS;
    for (const el of node) {
      acc = unionEnds(acc, endsWithin(el, opts));
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
    // A branch that always exits never reaches the rest of the list.
    acc = unionEnds(acc, endsWithin(n.condExpr, opts));
    if (!exits(n.consequent)) acc = unionEnds(acc, endsWithin(n.consequent, opts));
    if (!exits(n.alternate)) acc = unionEnds(acc, endsWithin(n.alternate, opts));
    return acc;
  }
  if (n.kind === "markup") {
    // Attributes (event handlers) run later; the children render where the element stands.
    return unionEnds(acc, endsWithin(n.children, opts));
  }
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") {
      acc = unionEnds(acc, endsWithin(v, opts));
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
): string[] {
  let c = cond as Rec | undefined;
  while (c && c.kind === "paren" && c.expr) c = c.expr as Rec;
  if (!c) return [];
  if (c.kind === "binary") {
    if (c.op === "&&") return truth ? [...narrowsWhen(c.left, true, receiverKey), ...narrowsWhen(c.right, true, receiverKey)] : [];
    if (c.op === "||") return truth ? [] : [...narrowsWhen(c.left, false, receiverKey), ...narrowsWhen(c.right, false, receiverKey)];
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
    return narrowsWhen(c.argument, !truth, receiverKey);
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

const EXPR_KEYS = ["exprNode", "initExpr", "condExpr", "headerExpr", "resultExpr", "argsExpr", "conditionExpr", "callbackExpr", "valueExpr"];
const CHILD_KEYS = ["body", "children", "consequent", "alternate", "cases", "arms"];

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
      p = withoutEnds(p, endsWithin(el, opts), atOf(el, span));
    }
    return;
  }
  const n = node as Rec;
  if (typeof n.kind === "string") opts.onExpr(n, present, span);
  if (n.kind === "ternary" || n.kind === "conditional") {
    const cond = (n.condition ?? n.test) as unknown;
    walkExprNarrowed(cond, present, span, opts);
    const condEnds = endsWithin(cond, opts);
    const after = withoutEnds(present, condEnds, atOf(cond, span));
    walkExprNarrowed(n.consequent, withKeys(after, keysWithoutEnds(narrowsWhen(cond, true, opts.receiverKey), condEnds)), span, opts);
    walkExprNarrowed(n.alternate, withKeys(after, keysWithoutEnds(narrowsWhen(cond, false, opts.receiverKey), condEnds)), span, opts);
    return;
  }
  if (n.kind === "binary" && (n.op === "&&" || n.op === "||")) {
    // `A && B` evaluates B only when A is true; `A || B` only when A is false.
    walkExprNarrowed(n.left, present, span, opts);
    const leftEnds = endsWithin(n.left, opts);
    const after = withoutEnds(present, leftEnds, atOf(n.left, span));
    walkExprNarrowed(n.right, withKeys(after, keysWithoutEnds(narrowsWhen(n.left, n.op === "&&", opts.receiverKey), leftEnds)), span, opts);
    return;
  }
  if (n.kind === "lambda" && n.body && typeof n.body === "object" && (n.body as Rec).kind === "block") {
    walkBodyNarrowed(((n.body as Rec).stmts as unknown[]) ?? [], present, span, opts);
    return;
  }
  if (opts.expandOpaque && n.kind === "escape-hatch") {
    const stmts = opts.expandOpaque(n);
    if (stmts) { walkBodyNarrowed(stmts, present, span, opts); return; }
  }
  // Operands in evaluation order (a call's callee, then its arguments, then the call
  // itself — whose own write the PARENT applies through `endsWithin`). A lambda's
  // expression body runs when it is called, not here: it ends nothing after it.
  let p = present;
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") {
      walkExprNarrowed(v, p, span, opts);
      if (n.kind !== "lambda") p = withoutEnds(p, endsWithin(v, opts), atOf(v, span));
    }
  }
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

/** The receivers an `if (D) <exit>` early return narrows for the rest of the list. */
function earlyReturnKeys(node: Rec, opts: PresenceNarrowingOptions): string[] {
  if (node.kind !== "if-stmt" || !exits(node.consequent)) return [];
  return narrowsWhen(node.condExpr, false, opts.receiverKey);
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
  if (typeof n.kind === "string" && LOOP_KINDS.has(n.kind)) {
    // S462 — the body, the per-iteration test and the C-style update run again after
    // themselves: a write anywhere in them ends the narrowing for all of them. The
    // iterable / C-style init runs once, before.
    const c = n.cStyleParts as Rec | undefined;
    let before = present;
    if (c && c.initExpr) before = withoutEnds(before, endsWithin(c.initExpr, opts), here);
    if (n.iterExpr) before = withoutEnds(before, endsWithin(n.iterExpr, opts), here);
    const loopEnds = unionEnds(unionEnds(endsWithin(n.body, opts), endsWithin(n.condExpr, opts)),
      c ? unionEnds(endsWithin(c.condExpr, opts), endsWithin(c.updateExpr, opts)) : NO_ENDS);
    const inLoop = withoutEnds(before, loopEnds, here);
    for (const k of EXPR_KEYS) {
      if (n[k] && typeof n[k] === "object") walkExprNarrowed(n[k], inLoop, here, opts);
    }
    walkBodyNarrowed((n.body as unknown[]) ?? [], inLoop, here, opts);
    return;
  }
  // The node's own expressions, in order; a write in one ends the narrowing for the rest
  // of the node (the branches of an `if`, the body of a `match`, …).
  let p = present;
  for (const k of EXPR_KEYS) {
    if (n[k] && typeof n[k] === "object") {
      walkExprNarrowed(n[k], p, here, opts);
      p = withoutEnds(p, endsWithin(n[k], opts), atOf(n[k], here));
    }
  }
  present = p;
  if (n.kind === "markup") {
    let inner = present;
    for (const k of guardKeys(n, opts)) inner = withKey(inner, k);
    const attrs = n.attrs as Rec[] | undefined;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const val = attr?.value as Rec | undefined;
        if (!val || typeof val !== "object") continue;
        const isGuard = attr.name === "if" || attr.name === "else-if";
        const hb = (val.handlerBlock as Rec | undefined)?.stmts;
        if (Array.isArray(hb)) walkBodyNarrowed(hb, isGuard ? present : inner, here, opts);
        else walkExprNarrowed(val, isGuard ? present : inner, here, opts);
      }
    }
    walkBodyNarrowed((n.children as unknown[]) ?? [], inner, here, opts);
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
    walkBodyNarrowed((n.body as unknown[]) ?? [], withKey(present, opts.receiverKey(n.headerExpr)), here, opts);
    return;
  }
  if (n.kind === "if-stmt" || n.kind === "if-expr") {
    // `present` already lost what the condition writes; a narrowing the condition
    // proves before such a write is not kept either (fail closed).
    const condEnds = endsWithin(n.condExpr, opts);
    walkBodyNarrowed((n.consequent as unknown[]) ?? [], withKeys(present, keysWithoutEnds(narrowsWhen(n.condExpr, true, opts.receiverKey), condEnds)), here, opts);
    walkBodyNarrowed((n.alternate as unknown[]) ?? [], withKeys(present, keysWithoutEnds(narrowsWhen(n.condExpr, false, opts.receiverKey), condEnds)), here, opts);
    return;
  }
  for (const k of CHILD_KEYS) {
    const v = n[k];
    if (Array.isArray(v)) walkBodyNarrowed(v, present, here, opts);
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
  for (const node of expandCheckPieces(body)) {
    walkNodeNarrowed(node, acc, span, opts);
    if (node && typeof node === "object") {
      acc = withoutEnds(acc, endsWithin(node, opts), atOf(node, span));
      const r = node as Rec;
      acc = withKeys(acc, keysWithoutEnds(earlyReturnKeys(r, opts), r.kind === "if-stmt" ? endsWithin(r.condExpr, opts) : NO_ENDS));
    }
  }
}
