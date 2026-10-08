/**
 * unquoted-attr-value.ts — THE reader for an unquoted (undelimited) attribute
 * value, shared by every front end that reads markup attributes (S457 4a).
 *
 * Ruling user-voice-scrml.md S457 "4a": an unquoted attribute value is read
 * WHOLE, and a value that is still ambiguous is REFUSED — never silently
 * truncated. SPEC §5.2 "An unquoted value is read WHOLE".
 *
 * Callers (one reader of one text — before S457's fix round there were three):
 *   - compiler/src/tokenizer.ts `tokenizeAttributes` (TAB, every markup opener);
 *   - compiler/native-parser/tag-frame.js `tokenizeAttributeRegion` (the
 *     native parser, which still runs every component-body, `<match>`-arm,
 *     engine and meta re-parse: `nativeParseFile`);
 *   - compiler/src/ast-builder.js `_parseLiftAttrValue` (lifted markup inside
 *     logic, read from the logic block's source text).
 * The refusal diagnostic (`unquotedRejectDiagnostic`) is shared too.
 *
 * Pure: no positions beyond string offsets, no line/column, no tokens of its
 * own — each caller wraps the result in its own token / AttrValue shape.
 */

// ---------------------------------------------------------------------------
// Event-handler attribute helpers (S97 — SPEC §5.2.3 bare-form parser fix)
// ---------------------------------------------------------------------------

/**
 * Mirrors `isEventHandlerAttrName` from `multi-statement-scan.ts`. Inlined
 * here to avoid a cross-stage import. Keep in sync.
 *
 * Recognized event-handler attribute name shapes (per SPEC §5.2.x and §38.6.1):
 *   - `on<word>`           — DOM events (`onclick`, `oninput`, `onsubmit`, ...)
 *   - `on:<word>`          — namespaced events (Svelte-derived)
 *   - `onserver:<word>`    — channel server-direction events (§38.6.1)
 *   - `onclient:<word>`    — channel client-direction events (§38.6.1)
 */
export function isEventHandlerAttrName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (/^on[a-z]+$/i.test(name)) return true;
  if (/^on:/i.test(name)) return true;
  if (/^onserver:/i.test(name)) return true;
  if (/^onclient:/i.test(name)) return true;
  return false;
}

/**
 * Detect whether the chars at `pos` look like a bare-form event-handler
 * expression-continuation: assignment (`=`), compound assignment
 * (`+=`/`-=`/etc.), or postfix update (`++`/`--`). Used to decide whether
 * to extend an event-handler attribute value reader past the initial
 * ident into expression-mode for SPEC §5.2.3 bare-form shapes.
 *
 * Skips leading inline whitespace (` ` and `\t`). Does NOT skip newlines —
 * a newline between the ident and the operator is unusual in attribute
 * values and likely indicates a tag-split shape (caller should fall
 * through to ATTR_IDENT).
 *
 * Recognized continuations:
 *   - `=`               — assignment (rejects `==` comparison and `=>` arrow)
 *   - `+= -= *= /= %=`  — arithmetic compound assigns
 *   - `**=`             — exponent compound assign
 *   - `<<= >>= >>>=`    — shift compound assigns
 *   - `&= |= ^=`        — bitwise compound assigns
 *   - `&&= ||= ??=`     — logical compound assigns
 *   - `++ --`           — postfix updates (SPEC §5.2.3 line 1144 example)
 *
 * All shapes flow through `rewriteReactiveAssign` (`rewrite.ts:1779`) which
 * lowers them to the appropriate setter call (S97 — rewriter extended in
 * the same commit to cover compound + postfix shapes).
 */
function isBareExprContinuation(raw: string, pos: number): boolean {
  let i = pos;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) i++;
  if (i >= raw.length) return false;
  const c = raw[i];
  const n = i + 1 < raw.length ? raw[i + 1] : "";

  // `=` (assignment) — reject `==` (comparison) and `=>` (arrow body)
  if (c === "=" && n !== "=" && n !== ">") return true;

  // `++` / `--` (postfix update)
  if ((c === "+" || c === "-") && n === c) return true;

  // Compound assignment: `op=` where op is one of the recognized prefixes
  // Scan up to 4 chars for the longest match (covers `>>>=`).
  for (let len = 2; len <= 4 && i + len <= raw.length; len++) {
    const slice = raw.slice(i, i + len);
    const after = i + len < raw.length ? raw[i + len] : "";
    if (!slice.endsWith("=") || after === "=" || after === ">") continue;
    const op = slice.slice(0, -1);
    if (
      op === "+" || op === "-" || op === "*" || op === "/" || op === "%" ||
      op === "&" || op === "|" || op === "^" ||
      op === "**" || op === "<<" || op === ">>" || op === ">>>" ||
      op === "&&" || op === "||" || op === "??"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * s457 (g-onclick-unquoted-call-chain-drops-callback-s457) — whether the char at
 * `pos`, IMMEDIATELY after an unquoted event-handler value's identifier or call
 * (no whitespace between), continues that expression as a postfix operation:
 * a member access `.name`, an optional chain `?.`, an index `[…]`, or a further
 * call `(…)`.
 *
 * SPEC §5.2.3: a bare handler value is exactly one expression ("calls,
 * assignments, compound updates, method invocations"), and "a bare attribute
 * value has no closing delimiter of its own; its extent is found by scanning
 * forward, and an attribute boundary is whitespace at depth 0". So
 * `onclick=Promise.resolve(5).then(function (v) { … })` is ONE expression whose
 * whitespace all sits inside the parentheses. Before this the reader stopped at
 * the first call's `)`: the handler ran `Promise.resolve(5)` alone and the rest
 * (`.then(…)`) leaked into the element as junk attributes — silently, at exit 0.
 */
function isPostfixContinuation(raw: string, pos: number): boolean {
  if (pos >= raw.length) return false;
  const c = raw[pos];
  const n = pos + 1 < raw.length ? raw[pos + 1] : "";
  if (c === ".") return /[A-Za-z_$]/.test(n);
  // `?.` but not the conditional `? .5`
  if (c === "?" && n === ".") return !/[0-9]/.test(pos + 2 < raw.length ? raw[pos + 2] : "");
  return c === "[" || c === "(";
}

// ---------------------------------------------------------------------------
// s457 4a — one reader for every unquoted attribute value
// ---------------------------------------------------------------------------
//
// Ruling (user-voice-scrml.md S457 "4a"): an unquoted attribute value is read
// WHOLE — a handler's assignment (`onclick=@count = @count + 1`) and a member
// chain in ANY attribute (`if=fn().ok`, `title=fmt(1).trim()`,
// `onclick=fn() .then(g)`). A value that is still ambiguous is REFUSED with a
// diagnostic — never silently truncated. The helpers below are the pure
// look-ahead predicates the unquoted-value reader in `tokenizeAttributes` uses.

/** Index of the first char at/after `pos` that is not whitespace (incl. newlines). */
function skipAllWs(raw: string, pos: number): number {
  let i = pos;
  while (i < raw.length && /[ \t\r\n\f]/.test(raw[i])) i++;
  return i;
}

/**
 * Whether, after whitespace at `pos`, the value continues as a MEMBER access —
 * `.name` or `?.` — e.g. `onclick=fn(1) .then(g)`. Neither `.` nor `?` can begin
 * an attribute, so the continuation is the only reading. Returns the index of
 * the `.` / `?`, or -1.
 */
function spacedMemberAt(raw: string, pos: number): number {
  if (pos >= raw.length || !/[ \t\r\n\f]/.test(raw[pos])) return -1;
  const i = skipAllWs(raw, pos);
  if (i >= raw.length) return -1;
  const c = raw[i];
  const n = i + 1 < raw.length ? raw[i + 1] : "";
  if (c === "." && /[A-Za-z_$]/.test(n)) return i;
  if (c === "?" && n === "." && !/[0-9]/.test(i + 2 < raw.length ? raw[i + 2] : "")) return i;
  return -1;
}

/**
 * Whether an event-handler expression whose text so far is `text` is
 * syntactically INCOMPLETE — it ends in an operator that needs a right operand
 * (`@count = `, `@a + `, `@ok ? 1 :`), so whitespace there cannot be the
 * attribute boundary.
 */
function exprEndsIncomplete(text: string): boolean {
  const t = text.replace(/[ \t\r\n\f]+$/, "");
  if (t.length === 0) return true;
  if (/(?:\+\+|--)$/.test(t)) return false;
  if (/[=+\-*/%&|^!~<?:,]$/.test(t)) return true;
  if (/(?:^|[^A-Za-z0-9_$.])(?:instanceof|in|typeof|new|void|delete|is)$/.test(t)) return true;
  return false;
}

/**
 * Whether, after whitespace at `pos`, an event-handler expression continues
 * with an INFIX operator — binary, assignment, ternary, member access, or the
 * scrml keyword tests `is` / `instanceof` / `in`. None of these can begin an
 * attribute, so the expression goes on. A `>` is NOT a continuation here: at depth 0
 * it is the tag close (the block splitter has already ended the opener there);
 * a `>` after whitespace is refused by the caller as ambiguous.
 */
function handlerInfixAt(raw: string, pos: number): boolean {
  const i = skipAllWs(raw, pos);
  if (i >= raw.length) return false;
  const c = raw[i];
  const n = i + 1 < raw.length ? raw[i + 1] : "";
  if (c === ">") return false; // `>=` is decided by readExprRun (it must agree with the block splitter)
  if (c === "/") return n !== ">";
  if (c === ".") return /[A-Za-z_$]/.test(n);
  if (c === "!") return n === "=";
  if ("+-*%&|^=<?:".includes(c)) return true;
  return /^(?:is|instanceof|in)[ \t\r\n\f]+(?!=)/.test(raw.slice(i, i + 12));
}

/**
 * The text found at the attribute boundary after an unquoted value, when it
 * cannot begin anything an attribute list holds: an attribute name, the tag
 * close (`>` / `/>`), a sigil block (`${…}` …), or the `;` that
 * E-MULTI-STATEMENT-HANDLER owns. Before s457 the attribute loop skipped such a
 * character silently ("Unexpected char — skip"), which is how the tail of a
 * value the reader stopped short of (`title=@msg + "x"`, `onclick=fn() (g)`)
 * vanished at exit 0. Returns the stray character, or null.
 *
 * `;` — after an EVENT-HANDLER value it begins a bare statement sequence, which
 * E-MULTI-STATEMENT-HANDLER owns (the AST builder's opener scan); after any
 * other value it is stray (`title=f(); g()`, §5.2.4). `)` / `,` — inside the
 * parenthesized payload list of a state-child opener (`<Done (rows=r, n=k)>`,
 * `inParenList`) they close / separate that list.
 */
function strayAfterValue(raw: string, pos: number, isHandler: boolean, inParenList: boolean): string | null {
  const i = skipAllWs(raw, pos);
  if (i >= raw.length) return null;
  const c = raw[i];
  const n = i + 1 < raw.length ? raw[i + 1] : "";
  if (c === ">") return null;
  if (c === ";" && isHandler) return null;
  if ((c === ")" || c === ",") && inParenList) return null;
  if (c === "/" && n === ">") return null;
  if (/[A-Za-z_@]/.test(c)) return null;
  if ("$^?#!~".includes(c) && n === "{") return null;
  return c;
}

/**
 * s457 4a — the operator after a NON-handler, non-condition unquoted value, or
 * null. The condition test (`attrConditionOperatorAhead`, cluster-A) minus its
 * spaced-`>` reading: such a value admits no operator at all (§5.1), so a `>`
 * after it has one reading — the tag close (`<program serve=7878 >`).
 */
function nonHandlerOperatorAhead(raw: string, pos: number): string | null {
  const op = attrConditionOperatorAhead(raw, pos);
  return op === ">" ? null : op;
}

/**
 * Whether the BLOCK SPLITTER reads a `>=` that follows `valueText` as part of
 * the value (true) or as the opener's `>` followed by body text `=` (false).
 * Mirrors block-splitter.js `inUnquotedValue` (issue #28): a depth-0 `=` sets
 * it; a depth-0 `(` / `[` / `{` / quote / sigil brace clears it. The tokenizer
 * sees the whole element text, so it must stop where the splitter ended the
 * opener: `onclick=calculate()>=</>` is a button labelled `=`.
 */
function splitterKeepsGtEq(valueText: string): boolean {
  let flag = true; // the value began right after its attribute's `=`
  let depth = 0;
  let str: string | null = null;
  for (let i = 0; i < valueText.length; i++) {
    const c = valueText[i];
    if (str) { if (c === "\\") { i++; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { if (depth === 0) flag = false; str = c; continue; }
    if (c === "(" || c === "[" || c === "{") { if (depth === 0) flag = false; depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { if (depth > 0) depth--; continue; }
    if (c === "=" && depth === 0) flag = true;
  }
  return flag;
}

/**
 * Whether the tag close follows the value after INLINE whitespace
 * (`onclick=@big = @n > 1>`). The block splitter ends the opener at the first
 * depth-0 `>`, so `@n > 1` cannot be told apart from the value `@n` followed by
 * the tag close — the same reading cluster-A (S188) refuses for conditions.
 * A newline before the `>` is a layout choice, not an operator, and is fine.
 */
function spacedTagCloseAt(raw: string, pos: number): boolean {
  let i = pos;
  let sawWs = false;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) { i++; sawWs = true; }
  return sawWs && i < raw.length && raw[i] === ">";
}

/**
 * S188 follow-up — detect whether the chars at `pos` (immediately AFTER the
 * keyword `not` in an unquoted attribute value) begin a prefix-`not`-as-negation
 * operand, e.g. the `@y` in `if=not @y` or the `obj.ok` in `show=not obj.ok`.
 *
 * Returns true ONLY when, after skipping inline whitespace (` ` / `\t`), the
 * next char begins a negation operand: an `@`-sigil reactive ref, an identifier
 * start (`[A-Za-z_$]`), or an opening paren `(`. In that case the unquoted-value
 * reader captures the whole `not <operand>` run as a single ATTR_EXPR so it
 * routes through the parseExprToNode lowering choke-point and fires E-TYPE-045
 * (SPEC §42.10 — `not` is the absence VALUE, not boolean negation).
 *
 * Returns FALSE — leaving `not` to fall through to ATTR_IDENT as the valid
 * absence VALUE — when:
 *   - no operand follows (end of value / tag close `>` / `/>`); `if=not` alone
 *     is the absence-value form, not negation.
 *   - the operand char does not begin an expression (e.g. a digit cannot start
 *     a negation operand in this grammar; quoted strings / arrays are handled by
 *     their own value branches before the unquoted reader and never reach here).
 *
 * Requires that the boundary between `not` and the operand be inline whitespace
 * (mirrors the choke-point `not[ \t]+<operand>` detector, which deliberately
 * never bridges a newline — 6nz-s / S127). A newline after `not` => absence
 * value, not negation.
 */
function isPrefixNotOperandAhead(raw: string, pos: number): boolean {
  let i = pos;
  let sawInlineWs = false;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) { i++; sawInlineWs = true; }
  // A negation operand must be separated from `not` by inline whitespace (the
  // unquoted-value reader already terminated the `not` ident at this boundary,
  // so `pos` sits on that whitespace for the bare form). With no whitespace and
  // no further chars, there is no operand.
  if (!sawInlineWs) return false;
  if (i >= raw.length) return false;
  const c = raw[i];
  // Tag-close after `not` => standalone absence value (`<p if=not>`).
  if (c === ">" || (c === "/" && i + 1 < raw.length && raw[i + 1] === ">")) return false;
  // Operand starts: `@`-ref, identifier, or parenthesized sub-expression.
  return c === "@" || c === "(" || /[A-Za-z_$]/.test(c);
}

/**
 * cluster-A (S188 "reject + parens") — the markup attributes whose unquoted
 * value is a boolean CONDITION (§17.1 `if=` / §17.2 `show=` / §17.1.1
 * `else-if=`). Per SPEC §5.1/§5.2 an unquoted condition admits ONLY the
 * atomic forms — identifier (`@var` / `obj.prop`), call (`fn()`), or prefix
 * `!` — never a binary/ternary operator. Operator/compound conditions SHALL
 * be parenthesized `if=(expr)` or quoted `if="expr"`.
 *
 * NOT included: event-handler attributes (`onclick=` etc., §5.2.3 bare-form),
 * `class:` / `bind:` / `style:` directives (their own grammars, §5.4/§5.5.2),
 * and `while=` (no such markup attribute exists — §17 has only `if=`/`show=`;
 * a `while` CONDITION lives in `${ while (...) }` statement position).
 */
export function isConditionAttrName(name: string): boolean {
  return name === "if" || name === "show" || name === "else-if";
}

/**
 * cluster-A — at the boundary where the unquoted-value reader has just
 * terminated the first atomic ident of a CONDITION attribute (`if=`/`show=`/
 * `else-if=`), detect whether what follows is a stray binary/ternary OPERATOR
 * rather than a clean attribute boundary (`>` tag-close, `/>` self-close, or
 * whitespace-then-next-attribute).
 *
 * Returns the offending operator string when an operator is detected, else
 * `null`. The caller (the ATTR_IDENT-emit branch) uses a non-null return to
 * capture the whole operator run as a single ATTR_OP_REJECT token — which
 * fires E-ATTR-UNQUOTED-OPERATOR exactly once and steers to parens/quotes,
 * instead of silently shredding the operator + RHS (the dangerous class) or
 * letting the first `>` of `>=` close the tag early (the misleading
 * E-CTX-001 cascade).
 *
 * Detection rules (operate on the chars AFTER the atomic ident):
 *   - Skip leading inline whitespace (` ` / `\t`) only — a newline before an
 *     operator is unusual and treated as a non-operator boundary.
 *   - `>=`            -> ">="  (the `>` would otherwise close the tag early)
 *   - `> ` / `> <op>` -> ">"   (bare `>` operator: `>` followed by inline ws,
 *                               i.e. the canonical `@n > 3` spaced form; a bare
 *                               `>` with NO preceding ws is the tag close and
 *                               is NOT matched — `if=@n>` stays atomic)
 *   - `<` `<=` `==` `!=` `&&` `||` `+` `-` `*` `/` `?` (ternary) when they
 *     appear after the ident (with or without leading ws) -> that operator.
 *
 * Boundary safety: a bare `>` or `/>` with no leading whitespace is the tag
 * close and returns `null`. A `/` that is immediately `/>` (self-close) also
 * returns `null` — only a `/` used as a division operator (followed by an
 * operand, not `>`) is matched.
 */
function attrConditionOperatorAhead(raw: string, pos: number): string | null {
  let i = pos;
  let sawWs = false;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) { i++; sawWs = true; }
  if (i >= raw.length) return null;
  const c = raw[i];
  const n = i + 1 < raw.length ? raw[i + 1] : "";

  // keyword is-operators (§42 absence/presence): `is not not` / `is some` /
  // `is not`. Postfix (no RHS) but still OPERATORS — a bare unquoted condition
  // `if=fn() is not` must reject-with-parens exactly like the binary operators
  // below, NOT silently drop the keyword run. Before this, `is`/`is some`/
  // `is not` were absent from the op-set, so the value-reader terminated the
  // atomic ident and the trailing keyword run was tokenized as stray boolean
  // attributes (dropped) — `if=fn() is not` emitted `if((fn()))` (plain
  // truthiness, the absence check DROPPED + INVERTED, no diagnostic: the
  // silent-WRONG class). S209 ratified REJECT-with-parens. Longest match first
  // (`is not not` before `is not`); whole-word `is` only (`island` / `isReady`
  // are identifiers — guarded by the mandatory `[ \t]+` keyword separator and
  // the trailing `\b`). Returned exact-text matches what the reject branch
  // consumes (leading ws handled separately by the caller).
  const isOp = /^(?:is[ \t]+not[ \t]+not|is[ \t]+some|is[ \t]+not)\b/.exec(raw.slice(i));
  if (isOp) return isOp[0];

  // `>=` — intercept BEFORE the outer tag-close test consumes the `>`.
  if (c === ">" && n === "=") return ">=";
  // bare `>` as a comparison operator: only when separated from the ident by
  // inline whitespace (`@n > 3`). An adjacent `>` (`@n>` / `@n>3`) is the tag
  // close in this grammar and stays atomic (genuinely ambiguous; left to the
  // pre-existing tag-close behavior).
  if (c === ">" && sawWs) return ">";

  // `<` / `<=` — `<` never closes a tag in value position.
  if (c === "<") return n === "=" ? "<=" : "<";
  // `==` / `!=`
  if (c === "=" && n === "=") return "==";
  if (c === "!" && n === "=") return "!=";
  // `&&` / `||`
  if (c === "&" && n === "&") return "&&";
  if (c === "|" && n === "|") return "||";
  // ternary `?` (no-space `@n?@m:@n` and spaced `@n ? @m : @n`)
  if (c === "?") return "?";
  // arithmetic / concat: `+` `-` `*` `/`. `/` is only an operator when it is
  // NOT the start of a self-close `/>` — a self-close has no preceding operand
  // continuation. Require an operand-ish char (or ws-then-operand) after `/`.
  if (c === "+" || c === "-" || c === "*") return c;
  if (c === "/" && n !== ">") return "/";

  return null;
}


// ---------------------------------------------------------------------------
// THE reader (s457 4a) — every unquoted attribute value, every front end
// ---------------------------------------------------------------------------

/** Whether `c` begins a value this reader owns: `!…`, `(…)`, `[…]`, or an identifier / number / `@ref`. */
export function isUnquotedValueStart(c: string): boolean {
  return c === "!" || c === "(" || c === "[" || /^[A-Za-z0-9_@]$/.test(c);
}

/**
 * Mutable per-opener state the reader threads across the attributes of ONE
 * opener. `inParenList`: the caller is inside a parenthesized state-child
 * payload list (`<Done (rows=r)>`), where `)` / `,` close / separate it.
 * `handlerSemicolonTail`: set once a bare handler value is followed by `;` —
 * the rest of the opener is that handler's unbounded statement sequence,
 * which E-MULTI-STATEMENT-HANDLER reports; nothing after it is re-refused.
 */
export interface UnquotedReadState {
  inParenList: boolean;
  handlerSemicolonTail: boolean;
}

/** One token's worth of reader output. `end` is the offset in `raw` after the value. */
export interface UnquotedRead {
  end: number;
  kind: "ATTR_IDENT" | "ATTR_CALL" | "ATTR_EXPR" | "ATTR_OP_REJECT";
  /** ATTR_CALL: JSON `{name, args}`; ATTR_OP_REJECT: JSON `{name, value, op, reason}`. */
  text: string;
}

/**
 * Read ONE unquoted attribute value of attribute `name` starting at `start`
 * in `raw` (`isUnquotedValueStart(raw[start])`). `raw` must extend at least to
 * the opener's closing `>` (or `/>`) when the opener has one — the reader
 * judges the tag close it meets (a spaced `>` after a handler expression is
 * refused). It may extend further (the live tokenizer passes the whole
 * element text): a `>=` is then read as an operator only where the block
 * splitter kept it inside the value (`splitterKeepsGtEq`).
 *
 * Shared by the TAB tokenizer (`tokenizeAttributes`), the native parser's
 * attribute tokenizer (`compiler/native-parser/tag-frame.js`
 * `tokenizeAttributeRegion` — every component-body / `<match>`-arm / engine /
 * meta re-parse) and the lifted-markup tag parser (ast-builder
 * `_parseLiftAttrValue`): ONE reader for every unquoted value.
 *
 * The value is read in three steps:
 *   1. its HEAD — `!expr`, a parenthesized `(…)`, an array literal `[…]`, or
 *      an identifier with an optional call `fn(…)`;
 *   2. a POSTFIX CHAIN on the head, in every attribute: `.name`, `?.`, `[…]`,
 *      `(…)` — adjacent, or `.name` / `?.` after whitespace (neither `.` nor
 *      `?` can begin an attribute) — `if=fn().ok`, `title=fmt(1).trim()`,
 *      `onclick=fn(1) .then(g)`;
 *   3. what follows the value:
 *      - a CONDITION (`if=`/`show=`/`else-if=`) followed by an operator is
 *        refused (cluster-A, S188: conditions are atomic-only);
 *      - an EVENT HANDLER followed by an assignment, compound update, postfix
 *        update or infix operator is ONE expression (§5.2.3) and is read to its
 *        end (`onclick=@count = @count + 1`);
 *      - any OTHER attribute followed by an operator is refused (§5.1: its
 *        unquoted forms are identifier and call; an expression is written
 *        `(…)`, `${…}` or `"…"`);
 *      - text that cannot begin an attribute, or (after a handler expression)
 *        a tag close `>` after inline whitespace, is refused.
 * A refusal is ONE ATTR_OP_REJECT (payload `{name, value, op, reason}`).
 * `derived=` (§51.0.J engine expression, read from raw text elsewhere) keeps
 * the pre-s457 reading: head only, nothing judged.
 */
export function readUnquotedAttrValue(raw: string, start: number, name: string, state: UnquotedReadState): UnquotedRead {
  let p = start;
  const isHandlerAttr = isEventHandlerAttrName(name);
  const isCondAttr = isConditionAttrName(name);
  const isLogicExprAttr = name === "derived";

  // A balanced `(…)` / `[…]` group at `p`, strings opaque.
  const readGroup = (): string => {
    const open = raw[p];
    const close = open === "(" ? ")" : "]";
    let out = "";
    let depth = 0;
    let stringCh: string | null = null;
    while (p < raw.length) {
      const c2 = raw[p];
      if (stringCh !== null) {
        if (c2 === "\\" && p + 1 < raw.length) { out += c2 + raw[p + 1]; p += 2; continue; }
        if (c2 === stringCh) stringCh = null;
        out += c2; p++; continue;
      }
      if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; out += c2; p++; continue; }
      if (c2 === open) depth++;
      else if (c2 === close) {
        depth--;
        if (depth === 0) { out += c2; p++; break; }
      }
      out += c2; p++;
    }
    return out;
  };

  // Step 2 — the postfix chain. "" when none.
  const readPostfixChain = (): string => {
    let out = "";
    for (;;) {
      if (isPostfixContinuation(raw, p)) {
        const c2 = raw[p];
        if (c2 === "(" || c2 === "[") { out += readGroup(); continue; }
        if (c2 === "?") { out += "?."; p += 2; }
        else { out += "."; p++; }
        while (p < raw.length && /[A-Za-z0-9_$]/.test(raw[p])) { out += raw[p]; p++; }
        continue;
      }
      const at = spacedMemberAt(raw, p);
      if (at >= 0) { out += raw.slice(p, at); p = at; continue; }
      return out;
    }
  };

  // Step 3, event handlers — ONE expression to its end. Whitespace at depth 0
  // ends it only when the text so far is complete and what follows cannot
  // continue it. Stops at the tag close and at a depth-0 `;` (a bare `;`
  // sequence is E-MULTI-STATEMENT-HANDLER, found by the AST builder's opener
  // scan). `gt`: the run met a `>` across whitespace while INCOMPLETE.
  const readExprRun = (initial: string): { text: string; gt: boolean } => {
    let text = initial;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let stringCh: string | null = null;
    let gt = false;
    while (p < raw.length) {
      const c2 = raw[p];
      if (stringCh !== null) {
        if (c2 === "\\" && p + 1 < raw.length) { text += c2 + raw[p + 1]; p += 2; continue; }
        if (c2 === stringCh) stringCh = null;
        text += c2; p++; continue;
      }
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        if (c2 === "/" && raw[p + 1] === ">") break;
        // `>=` is an operator where the block splitter kept it in the value
        // (issue #28) — read on; elsewhere it is the tag close.
        if (c2 === ">" && raw[p + 1] === "=" && splitterKeepsGtEq(text)) { text += ">="; p += 2; continue; }
        if (c2 === ">") { gt = /[ \t]$/.test(text); break; }
        if (c2 === ";") break;
        // An unmatched closer ends the expression (a payload list's `)`).
        if (c2 === ")" || c2 === "]" || c2 === "}") break;
        if (/[ \t\r\n\f]/.test(c2)) {
          const nx = skipAllWs(raw, p);
          const gtEqAhead = raw[nx] === ">" && raw[nx + 1] === "=" && splitterKeepsGtEq(text);
          if (exprEndsIncomplete(text) || handlerInfixAt(raw, p) || gtEqAhead) {
            while (p < raw.length && /[ \t\r\n\f]/.test(raw[p])) { text += raw[p]; p++; }
            continue;
          }
          break;
        }
      }
      if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; text += c2; p++; continue; }
      if (c2 === "(") parenDepth++;
      else if (c2 === ")") parenDepth--;
      else if (c2 === "[") bracketDepth++;
      else if (c2 === "]") bracketDepth--;
      else if (c2 === "{") braceDepth++;
      else if (c2 === "}") braceDepth--;
      text += c2; p++;
    }
    return { text: text.replace(/[ \t\r\n\f]+$/, ""), gt };
  };

  // A refusal. "operator": consumes the leading whitespace + operator chars,
  // then the run to the tag close. "stray": the run to the tag close. "gt":
  // nothing (the `>` still closes the tag).
  const reject = (atomicExpr: string, op: string, reason: "operator" | "stray" | "gt"): UnquotedRead => {
    let expr = atomicExpr;
    if (reason !== "gt") {
      while (p < raw.length && /[ \t\r\n\f]/.test(raw[p])) { expr += raw[p]; p++; }
      if (reason === "operator") {
        for (let k = 0; k < op.length && p < raw.length; k++) { expr += raw[p]; p++; }
      }
      let parenDepth = 0;
      let braceDepth = 0;
      let bracketDepth = 0;
      let stringCh: string | null = null;
      while (p < raw.length) {
        const c2 = raw[p];
        if (stringCh !== null) {
          if (c2 === "\\" && p + 1 < raw.length) { expr += c2 + raw[p + 1]; p += 2; continue; }
          if (c2 === stringCh) stringCh = null;
          expr += c2; p++; continue;
        }
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          // `/>` and `>` end the run (a leading `>` operator was consumed
          // above); an unmatched closer is not part of it.
          if (c2 === "/" && raw[p + 1] === ">") break;
          if (c2 === ">") break;
          if (c2 === ")" || c2 === "]" || c2 === "}") break;
        }
        if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; expr += c2; p++; continue; }
        if (c2 === "(") parenDepth++;
        else if (c2 === ")") parenDepth = Math.max(0, parenDepth - 1);
        else if (c2 === "[") bracketDepth++;
        else if (c2 === "]") bracketDepth = Math.max(0, bracketDepth - 1);
        else if (c2 === "{") braceDepth++;
        else if (c2 === "}") braceDepth = Math.max(0, braceDepth - 1);
        expr += c2; p++;
      }
    }
    return { end: p, kind: "ATTR_OP_REJECT", text: JSON.stringify({ name, value: expr.replace(/\s+$/, ""), op, reason }) };
  };

  // The value token, unless the boundary after it holds stray text or — after
  // a handler EXPRESSION, where an operator is legal and a comparison is a
  // plausible reading — the tag close after inline whitespace. (A non-handler
  // value admits no operator, so its `>` has one reading: the tag close.
  // Conditions keep cluster-A's own spaced-`>` rule.)
  const finish = (kind: UnquotedRead["kind"], text: string, shown: string, checkGt = false): UnquotedRead => {
    if (!isLogicExprAttr && !state.handlerSemicolonTail) {
      if (checkGt && spacedTagCloseAt(raw, p)) return reject(shown, ">", "gt");
      const stray = strayAfterValue(raw, p, isHandlerAttr, state.inParenList);
      if (stray !== null) return reject(shown, stray, "stray");
    }
    if (isHandlerAttr && raw[skipAllWs(raw, p)] === ";") state.handlerSemicolonTail = true;
    return { end: p, kind, text };
  };

  // Step 1 — the head.
  let head = "";
  let ident = "";
  let shape: "ident" | "call" | "expr" = "ident";
  let callArgs = "";
  if (raw[p] === "!") {
    // `!@var`, `!!@var`, `!obj.prop` — to whitespace or the tag close.
    while (p < raw.length && !/[ \t\r\n\f>\/]/.test(raw[p])) { head += raw[p]; p++; }
    shape = "expr";
  } else if (raw[p] === "(" || raw[p] === "[") {
    // `if=(@a && @b)`, `class:on=(@t === "x")`; §41.14 `pick=["a", "b"]`.
    head = readGroup();
    shape = "expr";
  } else {
    // Event-handler idents exclude `-` so a postfix `--` ends the ident
    // (`onclick=@count--`); other attributes admit it (`class=foo-bar`).
    const valueIdentRe = isHandlerAttr ? /[A-Za-z0-9_\.@]/ : /[A-Za-z0-9_\-\.@]/;
    while (p < raw.length && valueIdentRe.test(raw[p])) { ident += raw[p]; p++; }
    head = ident;
    if (raw[p] === "(") {
      const group = readGroup();
      callArgs = group.endsWith(")") ? group.slice(1, -1) : group.slice(1);
      head = `${ident}${group}`;
      shape = "call";
    }
  }
  // Step 2 — the postfix chain.
  if (!isLogicExprAttr) {
    const chain = readPostfixChain();
    if (chain) { head += chain; shape = "expr"; }
  }

  // Step 3 — what follows.
  if (isLogicExprAttr) {
    if (shape === "ident") return { end: p, kind: "ATTR_IDENT", text: head };
    if (shape === "call") return { end: p, kind: "ATTR_CALL", text: JSON.stringify({ name: ident, args: callArgs }) };
    return { end: p, kind: "ATTR_EXPR", text: head };
  }
  if (isCondAttr && attrConditionOperatorAhead(raw, p) !== null) {
    // cluster-A (S188 "reject + parens").
    return reject(head, attrConditionOperatorAhead(raw, p)!, "operator");
  }
  if (shape === "ident" && ident === "not" && isPrefixNotOperandAhead(raw, p)) {
    // S188 follow-up — bare prefix-`not` negation (`if=not @y`): ONE ATTR_EXPR
    // `not <operand>` so the lowering choke-point fires E-TYPE-045 once.
    let expr = ident;
    while (p < raw.length && (raw[p] === " " || raw[p] === "\t")) { expr += raw[p]; p++; }
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let stringCh: string | null = null;
    while (p < raw.length) {
      const c2 = raw[p];
      if (stringCh !== null) {
        if (c2 === "\\" && p + 1 < raw.length) { expr += c2 + raw[p + 1]; p += 2; continue; }
        if (c2 === stringCh) stringCh = null;
        expr += c2; p++; continue;
      }
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        if (c2 === "/" && raw[p + 1] === ">") break;
        if (c2 === ">") break;
        if (/[ \t\r\n\f]/.test(c2)) break;
      }
      if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; expr += c2; p++; continue; }
      if (c2 === "(") parenDepth++;
      else if (c2 === ")") parenDepth--;
      else if (c2 === "[") bracketDepth++;
      else if (c2 === "]") bracketDepth--;
      else if (c2 === "{") braceDepth++;
      else if (c2 === "}") braceDepth--;
      expr += c2; p++;
    }
    return { end: p, kind: "ATTR_EXPR", text: expr };
  }
  if (isHandlerAttr && (isBareExprContinuation(raw, p) || handlerInfixAt(raw, p))) {
    // SPEC §5.2.3 — a bare handler value is ONE expression.
    const run = readExprRun(head);
    if (run.gt) return reject(run.text, ">", "gt");
    return finish("ATTR_EXPR", run.text, run.text, true);
  }
  if (!isHandlerAttr && !isCondAttr && !state.handlerSemicolonTail && nonHandlerOperatorAhead(raw, p) !== null) {
    // s457 4a — an operator after a NON-handler value is refused.
    return reject(head, nonHandlerOperatorAhead(raw, p)!, "operator");
  }
  if (shape === "ident") return finish("ATTR_IDENT", head, head);
  if (shape === "call") return finish("ATTR_CALL", JSON.stringify({ name: ident, args: callArgs }), head);
  return finish("ATTR_EXPR", head, head);
}

// ---------------------------------------------------------------------------
// The refusal's diagnostic — one text for every front end
// ---------------------------------------------------------------------------

/**
 * The diagnostic for an ATTR_OP_REJECT payload. Code is
 * E-ATTR-UNQUOTED-OPERATOR, or E-ATTR-MULTI-STATEMENT for a `;` after a bare
 * non-handler value (§5.2.4).
 */
export function unquotedRejectDiagnostic(name: string, payloadText: string): { code: string; message: string } {
  let rej: { value?: string; op?: string; reason?: string };
  try { rej = JSON.parse(payloadText); } catch { rej = { value: payloadText, op: "" }; }
  const opName = rej.op || "an operator";
  // The refused run reaches the tag close, so it can hold the element's NEXT
  // attributes (`if=@a == b bind:value=@x …`); the fix shows the value only.
  let shown = (rej.value || "").trim();
  if (!isEventHandlerAttrName(name)) shown = shown.replace(/\s+[A-Za-z_][\w:.-]*=(?!=)[\s\S]*$/, "").trim();
  const reason = rej.reason || "operator";
  const isCond = isConditionAttrName(name);
  const isHandler = isEventHandlerAttrName(name);
  if (reason === "stray" && opName === ";" && !isHandler) {
    return {
      code: "E-ATTR-MULTI-STATEMENT",
      message:
        `E-ATTR-MULTI-STATEMENT: The value of attribute \`${name}\` is followed by \`;\` — a statement ` +
        `list — but a non-handler attribute value is ONE expression, and a bare value has nothing to ` +
        `bound it. Write a single expression, or move the statements into a function and use its ` +
        `result (\`function compute() { … }\` then \`${name}=compute()\`). Only an event-handler ` +
        `attribute (\`on…=\`) takes a statement list (SPEC §5.2.3, §5.2.4).`,
    };
  }
  if (isCond && reason === "operator") {
    return {
      code: "E-ATTR-UNQUOTED-OPERATOR",
      message:
        `E-ATTR-UNQUOTED-OPERATOR: \`${name}=\` is an unquoted condition — it cannot contain ` +
        `the operator \`${opName}\`. An unquoted attribute condition admits only the atomic ` +
        `forms (\`@var\`, \`obj.prop\`, \`fn()\`, or prefix \`!\`). Parenthesize or quote the ` +
        `operator condition: \`${name}=(${shown})\` or \`${name}="${shown}"\`.`,
    };
  }
  const what = reason === "gt"
    ? `is followed by \`>\` after a space. Unquoted, \`>\` there closes the tag, so a comparison ` +
      `(\`a > b\`) and a value followed by the end of the tag read the same`
    : reason === "stray"
      ? `is followed by \`${opName}\`, which cannot begin an attribute: an unquoted value ends at ` +
        `whitespace, so the text after it would be dropped`
      : `is followed by the operator \`${opName}\`. An unquoted value is an identifier, a member ` +
        `chain or a call (§5.1); an expression with an operator needs a delimiter`;
  // Literal TEXT (a URL, `100%`, `a/b`) is not an expression: the delimited
  // expression forms would not compile it — suggest the quoted string. Text
  // that reads as an expression (it uses `@`, a call, a string, a space
  // around an operator) gets the expression delimiters.
  const looksLikeText = !/[@"'`(]|\s/.test(shown);
  const fix = isHandler
    ? `Delimit the handler: \`${name}={ ${shown} }\` (an inline block, §5.2.3) or \`${name}=\${() => …}\`.`
    : isCond
      ? `Parenthesize or quote the condition: \`${name}=(${shown})\` or \`${name}="${shown}"\`.`
      : looksLikeText
        ? `If the value is text, quote it: \`${name}="${shown}"\`; if it is an expression, write \`${name}=(…)\`.`
        : `Delimit the value: \`${name}=(${shown})\`, \`${name}=\${${shown}}\`, or quote it if it is text.`;
  let message = `E-ATTR-UNQUOTED-OPERATOR: the unquoted value of \`${name}=\` ${what}. ${fix}`;
  if (reason === "gt") message += ` If the \`>\` is the end of the tag, remove the space before it.`;
  return { code: "E-ATTR-UNQUOTED-OPERATOR", message };
}
