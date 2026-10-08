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
 *   - `if=` / `show=` / `else-if=` on a markup element (bare receiver): the element's
 *     children AND its own other attributes (the element — and so its handlers — exists
 *     only while the guard holds, §42.4);
 *   - `given recv :> { … }` body; a `match recv { … }` body.
 */

/** A source span (the subset this module reads / passes through). */
export type NarrowSpan = { file?: string; start?: number; end?: number; line?: number; col?: number };

type Rec = Record<string, unknown>;

export interface PresenceNarrowingOptions {
  /** The tracked possibly-`not` receiver an EXPRESSION denotes (a key), or null. */
  receiverKey(node: unknown): string | null;
  /** The receiver an `if=` / `show=` guard value names (defaults to `receiverKey`). */
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
  return s;
}
function withKeys(present: ReadonlySet<string>, keys: string[]): ReadonlySet<string> {
  let out = present;
  for (const k of keys) out = withKey(out, k);
  return out;
}

const EXPR_KEYS = ["exprNode", "initExpr", "condExpr", "headerExpr", "resultExpr", "argsExpr", "conditionExpr", "callbackExpr", "valueExpr"];
const CHILD_KEYS = ["body", "children", "consequent", "alternate", "cases", "arms"];

/** Walk one expression tree, calling `onExpr` with the presence set at every node. */
export function walkExprNarrowed(
  node: unknown,
  present: ReadonlySet<string>,
  span: NarrowSpan,
  opts: PresenceNarrowingOptions,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const el of node) walkExprNarrowed(el, present, span, opts); return; }
  const n = node as Rec;
  if (typeof n.kind === "string") opts.onExpr(n, present, span);
  if (n.kind === "ternary" || n.kind === "conditional") {
    const cond = (n.condition ?? n.test) as unknown;
    walkExprNarrowed(cond, present, span, opts);
    walkExprNarrowed(n.consequent, withKeys(present, narrowsWhen(cond, true, opts.receiverKey)), span, opts);
    walkExprNarrowed(n.alternate, withKeys(present, narrowsWhen(cond, false, opts.receiverKey)), span, opts);
    return;
  }
  if (n.kind === "binary" && (n.op === "&&" || n.op === "||")) {
    // `A && B` evaluates B only when A is true; `A || B` only when A is false.
    walkExprNarrowed(n.left, present, span, opts);
    walkExprNarrowed(n.right, withKeys(present, narrowsWhen(n.left, n.op === "&&", opts.receiverKey)), span, opts);
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
  for (const key of Object.keys(n)) {
    if (key === "span") continue;
    const v = n[key];
    if (v && typeof v === "object") walkExprNarrowed(v, present, span, opts);
  }
}

function spanOf(node: Rec, fallback: NarrowSpan): NarrowSpan {
  const s = node.span as NarrowSpan | undefined;
  return s && typeof s.line === "number" ? s : fallback;
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
    if (name !== "if" && name !== "show" && name !== "else-if") continue;
    const val = attr.value as Rec | undefined;
    if (!val) continue;
    let target = (val.exprNode as Rec | undefined) ?? val;
    while (target && target.kind === "paren" && target.expr) target = target.expr as Rec;
    const key = (opts.guardKey ?? opts.receiverKey)(target);
    if (key) out.push(key);
  }
  return out;
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
  for (const k of EXPR_KEYS) {
    if (n[k] && typeof n[k] === "object") walkExprNarrowed(n[k], present, here, opts);
  }
  if (n.kind === "markup") {
    let inner = present;
    for (const k of guardKeys(n, opts)) inner = withKey(inner, k);
    const attrs = n.attrs as Rec[] | undefined;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const val = attr?.value as Rec | undefined;
        if (!val || typeof val !== "object") continue;
        const isGuard = attr.name === "if" || attr.name === "show" || attr.name === "else-if";
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
    walkBodyNarrowed((n.consequent as unknown[]) ?? [], withKeys(present, narrowsWhen(n.condExpr, true, opts.receiverKey)), here, opts);
    walkBodyNarrowed((n.alternate as unknown[]) ?? [], withKeys(present, narrowsWhen(n.condExpr, false, opts.receiverKey)), here, opts);
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

/** Walk a statement list, threading early-return narrowing across siblings. */
export function walkBodyNarrowed(
  body: unknown[],
  present: ReadonlySet<string>,
  span: NarrowSpan,
  opts: PresenceNarrowingOptions,
): void {
  if (!Array.isArray(body)) return;
  let acc = present;
  for (const node of body) {
    walkNodeNarrowed(node, acc, span, opts);
    if (node && typeof node === "object") acc = withKeys(acc, earlyReturnKeys(node as Rec, opts));
  }
}
