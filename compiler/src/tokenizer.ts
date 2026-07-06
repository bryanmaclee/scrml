/**
 * Tokenizer — Stage 3a of the scrml compiler pipeline (TAB).
 *
 * Produces per-block token streams from Block Splitter output. Each block type
 * gets its own tokenization rules. Tokens carry spans so every downstream AST
 * node can carry source location without recomputation.
 *
 * Token kinds
 * -----------
 * Common
 *   EOF
 *   IDENT         identifier (letter | _ | -) (letter | digit | _ | -)*
 *   NUMBER        numeric literal (integer or float)
 *   STRING        double-quoted or back-tick string literal (raw text between delimiters)
 *   PUNCT         single-char punctuation: ( ) [ ] { } , ; . : ! & | + - * / % ^ ~ = < > ?
 *   OPERATOR      multi-char operators: => == != <= >= ** ... etc.
 *   KEYWORD       scrml / JS reserved words (see KEYWORDS below)
 *   AT_IDENT      @name reactive sigil
 *   TILDE         ~ pipeline accumulator keyword
 *   BLOCK_REF     embedded child block placeholder (for logic/sql/css/error-effect/meta children)
 *   TEXT          raw text content (inside markup/state)
 *   COMMENT       // … to end-of-line
 *
 * Attribute-specific (markup / state block header)
 *   ATTR_NAME     attribute name
 *   ATTR_EQ       =
 *   ATTR_STRING   "…" quoted string value
 *   ATTR_IDENT    unquoted identifier value
 *   ATTR_CALL     unquoted fn() call value (name + args string)
 *   ATTR_BLOCK    {...} brace-block attribute value (raw content between braces, for props={...})
 *   ATTR_TYPED_DECL  name(type) typed attribute in state blocks
 *   ATTR_EXPR     boolean expression value for if= attribute (negation, equality, logical ops)
 *   ATTR_OP_REJECT  unquoted CONDITION attribute value with a bare binary/ternary operator
 *                   (cluster-A S188 — fires E-ATTR-UNQUOTED-OPERATOR; payload {name,value,op})
 *   TAG_OPEN      < name
 *   TAG_CLOSE_GT  >
 *   TAG_SELF_CLOSE />
 *
 * CSS-specific
 *   CSS_SELECTOR  selector text
 *   CSS_PROP      property name
 *   CSS_COLON     :
 *   CSS_VALUE     property value (everything up to ; or })
 *   CSS_SEMI      ;
 *   CSS_LBRACE    {
 *   CSS_RBRACE    }
 *   CSS_AT_RULE   verbatim CSS at-rule (@import, @media, @keyframes, etc.)
 *
 * SQL-specific
 *   SQL_RAW       raw query text (template literal contents)
 *   SQL_ARGS      argument string for a chained call (synthetic token)
 */

// ---------------------------------------------------------------------------
// scrml + JS keywords
// ---------------------------------------------------------------------------
//
// Exported (S229 ss54) so the `--emit-token-set` tooling pass can project the
// canonical keyword vocabulary into `token-set.json` (token-set.ts). The set is
// the single source of truth for what the tokenizer reserves; the emit is a
// read-only projection — it must never mutate it or be read back into the lexer.
export const KEYWORDS = new Set([
  // scrml-specific
  "lift", "fn", "server", "match", "is", "type", "let", "const", "import",
  "export", "from", "as", "default", "return", "if", "else", "for", "while",
  "of", "in", "do", "switch", "case", "break", "continue", "throw", "try",
  "catch", "finally", "new", "delete", "typeof", "instanceof", "void",
  "class", "extends", "super", "this", "null", "undefined", "true", "false",
  "function", "async", "await", "yield", "static", "get", "set",
  // scrml error system
  "fail", "transaction",
  // scrml built-in functions / modifiers
  // `reset` — §6.8.2 state-cell reset builtin: `reset(@cell)` restores
  // a state cell to its declared default. Reserved at lex time so the
  // expression-parser (Step 6) can produce a `reset-expr` AST node and
  // the parser (Step 8) can emit E-RESERVED-IDENTIFIER for shadowing.
  // S81 OQ-2 (2026-05-11): `debounce` and `throttle` retired as KEYWORDs.
  // The imperative keyword-call form `debounce(fn, ms)` / `throttle(fn, ms)`
  // is RETIRED in favor of two canonical surfaces:
  //   - state-decl attribute: `<x debounced=300ms>` per §6.13 (S79 Approach B)
  //   - stdlib: `import { debounce, throttle } from "scrml:time"` per §41
  // Adopters now use `debounce`/`throttle` as ordinary identifiers; calls
  // resolve through the stdlib import. Without the KEYWORD reservation,
  // names like `let debounce = ...` no longer fire E-RESERVED-IDENTIFIER.
  "cleanup", "upload", "reset",
  // scrml env access modifier
  "env", "public",
  // scrml reactive effects (§6.7.4)
  "when", "changes",
  // scrml lifecycle built-ins (§6.7.5–6.7.7)
  "animationFrame",
  // scrml channel built-ins (§35)
  "broadcast", "disconnect",
  // scrml top-level
  "use", "using", "with", "navigate",
  // §42 absence value
  "not",
  // §42.2.3 given — presence guard keyword
  "given",
  // §18.18 partial match modifier
  "partial",
  // §35.2 linear types — lin variable declaration keyword
  "lin",
]);

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export interface Span {
  start: number;
  end: number;
  line: number;
  col: number;
}

/** A child block from Block Splitter output. */
export interface Block {
  type: string;
  raw: string;
  span: { start: number; end: number; line?: number; col?: number };
  children?: Block[];
}

/**
 * A single token produced by the tokenizer. BLOCK_REF tokens additionally
 * carry a `block` field referencing the child Block from BS output.
 */
export interface Token {
  kind: string;
  text: string;
  span: Span;
  block?: Block;
  /**
   * True when this STRING token came from a backtick template literal.
   * Set by readBacktickString. Consumed by collectExpr in ast-builder.js
   * to re-emit the literal as `…` (preserving `${...}` interpolations)
   * rather than JSON.stringify-ing it as a plain double-quoted string.
   * (A4 surgical fix — preserves template-literal interpolations through
   * the tokenize/re-emit/parse pipeline so forEachIdentInExprNode can
   * descend into them.)
   */
  isTemplate?: boolean;
}

// ---------------------------------------------------------------------------
// Token factory
// ---------------------------------------------------------------------------

function makeToken(kind: string, text: string, start: number, end: number, line: number, col: number): Token {
  return { kind, text, span: { start, end, line, col } };
}

// ---------------------------------------------------------------------------
// §18.2 — `match` is a CONTEXTUAL keyword (GITI-016, bryan S241 Option A)
// ---------------------------------------------------------------------------
//
// `match` mirrors the `to` (§14.12) / `from` (§21.3) contextual keywords: it is
// reserved ONLY in the value-return / statement match-expression position
//
//     match <subject> { <arm> :> <body> … }
//
// where the brace block holds at least one top-level arm marker — a `:>` / `=>`
// / `->` separator or a `case` arm keyword (§18.2). Anywhere else it is an
// ordinary identifier — the conventional regex-result name:
//
//     const match = raw.match(/x/)
//     const name  = match is some ? match[1] : "fb"   // `is some` → §42 absence
//     obj.match  ·  raw.match(re)  ·  match[1]  ·  function f(match) { … }
//
// The lexer classifies `match` context-free as KEYWORD (it is in KEYWORDS so a
// shadow decl still fires E-RESERVED where §18.2 reserves it). This pass then
// re-scans the finished token stream and DEMOTES a `match` KEYWORD token to
// IDENT wherever it does NOT open a real match-expression. Every downstream
// match dispatch (ast-builder `parseOneMatchAsExpr`, the statement-form match
// parser, `preprocessMatchExprs`) gates on `kind === "KEYWORD"`, so a demoted
// `match` flows through the ordinary expression path untouched — and the prior
// mis-parse (`match is some` → subject `is` → `E-SCOPE-001: Undeclared
// identifier 'is'`) can no longer arise.
//
// The STRUCTURAL `<match for=T>` block form (§18.0.1) is captured as raw markup
// by the block-splitter and never reaches this tokenizer, so it is untouched.

/** Statement-starting keywords: encountering one at subject top level means the
 *  `{` we might reach belongs to a following statement, not a match arm-block.
 *  Expression keywords (`typeof`/`new`/`await`/`in`/`instanceof`/`this`/`not`/…)
 *  are deliberately EXCLUDED — they can appear inside a subject expression. */
const MATCH_SUBJECT_BOUNDARY_KEYWORDS = new Set([
  "const", "let", "var", "return", "if", "else", "for", "while", "do",
  "function", "fn", "server", "type", "import", "export", "switch", "try",
  "throw", "break", "continue", "lift", "use", "transaction", "fail", "when",
]);

/** PUNCT/OPERATOR (and a few KEYWORD) tokens that CANNOT begin a match subject:
 *  when one immediately follows `match`, the `match` is being used as a value /
 *  identifier (`match is`, `match =`, `match ?`, `match ,`, `match )`, …). This
 *  is the fast early-out of Option A #2; the forward scan (#1/#3) is the robust
 *  backstop for every remaining shape. Deliberately conservative — it lists only
 *  tokens that can never start an expression, so it can never demote a real
 *  match-expression. */
const MATCH_IDENTIFIER_TELL_TOKENS = new Set([
  "=", "==", "===", "!=", "!==", "=>", ":>", "->", "?", "??", "?.", ":", ",",
  ")", "]", "}", ";", "&&", "||", "&", "|", "^", "*", "/", "%", "**",
  "<<", ">>", ">>>", "<=", ">=", "+=", "-=", "*=", "/=", "%=",
  "&=", "|=", "^=", "&&=", "||=", "??=", ".",
]);
const MATCH_IDENTIFIER_TELL_KEYWORDS = new Set(["is", "instanceof", "in", "as"]);

/** Does the balanced `{ … }` block opening at `tokens[openIdx]` (a `{` PUNCT)
 *  contain a top-level (`depth === 1`) match arm marker? A value-return / stmt
 *  match ALWAYS has arm rows; a method / plain block does not. This is the
 *  robust §18.2 disambiguator. The markers are the arm separators — `:>`
 *  (canonical) or the deprecated aliases `=>` / `->` (§18.2) — plus a leading
 *  `case` arm keyword. `:>`/`=>` are single OPERATOR tokens; `->` tokenizes as
 *  `-` `>` (two PUNCT); `case` is a KEYWORD. Keeping the arm-marker requirement
 *  (rather than accepting any brace) avoids demoting neither side: a method
 *  named `match` (`{ match(x) { return x } }`) has no arm marker → identifier. */
function braceBlockHasTopLevelArm(tokens: Token[], openIdx: number): boolean {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === "{") { depth++; continue; }
    if (t.text === "}") { depth--; if (depth === 0) return false; continue; }
    if (depth !== 1) continue;
    // Contiguous `:>` / `=>` (single OPERATOR token).
    if (t.kind === "OPERATOR" && (t.text === ":>" || t.text === "=>")) return true;
    // Split forms — `->` is always two tokens (`-` `>`); `:>` / `=>` split when
    // the source space-pads the operator (`: >` / `= >`).
    if ((t.text === "-" || t.text === ":" || t.text === "=") && tokens[i + 1]?.text === ">") return true;
    // A leading `case` arm keyword (statement-form match arm rows).
    if (t.kind === "KEYWORD" && t.text === "case") return true;
  }
  return false;
}

/** Option A: is the `match` KEYWORD at `tokens[k]` the start of a real
 *  match-expression? Scans the subject (which may hold balanced `()`/`[]`) for
 *  the first top-level `{ … }` block, without crossing a statement boundary, and
 *  requires that block to carry a top-level arm marker (see
 *  `braceBlockHasTopLevelArm`). */
function matchKeywordOpensMatchExpr(tokens: Token[], k: number): boolean {
  const prev = tokens[k - 1];
  // Member position (`obj.match`, `raw.match(re)`) or decl-name position
  // (`function match(…)`) — never a match-expression keyword.
  if (prev) {
    if (prev.text === "." || prev.text === "?.") return false;
    if (prev.kind === "KEYWORD" && (prev.text === "function" || prev.text === "fn")) return false;
  }
  const next = tokens[k + 1];
  if (!next || next.kind === "EOF") return false;
  // Fast early-out: `match` used as a value (operator / separator follows).
  if (MATCH_IDENTIFIER_TELL_TOKENS.has(next.text)) return false;
  if (next.kind === "KEYWORD" && MATCH_IDENTIFIER_TELL_KEYWORDS.has(next.text)) return false;

  // Robust scan: walk the subject to the first top-level `{`.
  let subjDepth = 0; // depth of () and [] within the subject
  for (let i = k + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "EOF") return false;
    if (subjDepth === 0) {
      if (t.text === "{") return braceBlockHasTopLevelArm(tokens, i);
      // A statement boundary or an enclosing closer ends the subject region:
      // the `match` cannot be a match-expression here.
      if (t.text === ";" || t.text === "}" || t.text === ")" || t.text === "]") return false;
      if (t.kind === "KEYWORD" && MATCH_SUBJECT_BOUNDARY_KEYWORDS.has(t.text)) return false;
      if (t.text === "(" || t.text === "[") { subjDepth++; continue; }
    } else {
      if (t.text === "(" || t.text === "[" || t.text === "{") subjDepth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") subjDepth--;
    }
  }
  return false;
}

/**
 * Post-tokenization pass: demote every `match` KEYWORD token that does NOT open
 * a real match-expression (per Option A) to an IDENT, making `match` a usable
 * identifier everywhere else. Mutates `tokens` in place. See the §18.2 note above.
 */
export function reclassifyContextualMatch(tokens: Token[]): void {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== "KEYWORD" || t.text !== "match") continue;
    if (!matchKeywordOpensMatchExpr(tokens, k)) t.kind = "IDENT";
  }
}

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
function isEventHandlerAttrName(name: string): boolean {
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
function isConditionAttrName(name: string): boolean {
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
// Attribute tokenizer — used by markup and state block headers
// ---------------------------------------------------------------------------

/**
 * Tokenize the attribute region of a markup or state block header.
 *
 * `raw` is the full raw string of the block (e.g. `<div class="foo" id=bar>`).
 * `baseOffset` is the source offset of the first character of `raw`.
 * `baseLine` / `baseCol` are the 1-based source position of the first character.
 *
 * Returns an array of attribute tokens (ATTR_NAME, ATTR_EQ, ATTR_STRING,
 * ATTR_IDENT, ATTR_CALL, ATTR_BLOCK, ATTR_EXPR) for the attribute region,
 * plus TAG_OPEN, TAG_CLOSE_GT or TAG_SELF_CLOSE.
 *
 * For state blocks the raw starts with `< ` (plus optional whitespace before the
 * identifier), so we skip past `<`, skip whitespace, then skip the identifier.
 * For markup blocks the raw starts with `<identifier`.
 */
export function tokenizeAttributes(raw: string, baseOffset: number, baseLine: number, baseCol: number, blockType: 'markup' | 'state'): Token[] {
  const tokens: Token[] = [];

  let pos = 0;      // offset within raw
  let line = baseLine;
  let col = baseCol;

  function absOff() { return baseOffset + pos; }

  function ch(n = 0) { return pos + n < raw.length ? raw[pos + n] : ""; }

  function advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (pos < raw.length) {
        if (raw[pos] === "\n") { line++; col = 1; }
        else { col++; }
        pos++;
      }
    }
  }

  function skipWs() {
    while (pos < raw.length && /[ \t\r\n\f]/.test(raw[pos])) advance();
  }

  // cluster-A (S188 "reject + parens") — shared reject-capture for a CONDITION
  // attribute (`if=`/`show=`/`else-if=`) whose already-read atomic value
  // (`atomicExpr` = `@n` / `obj.prop` / `fn(args)`) is followed by a bare
  // operator. Consumes the leading inline ws + the detected operator run + the
  // RHS up to the attribute boundary and pushes ONE ATTR_OP_REJECT token, so the
  // AST builder fires E-ATTR-UNQUOTED-OPERATOR exactly once and steers to
  // parens/quotes. Caller must have confirmed `attrConditionOperatorAhead(raw,
  // pos) !== null`. Shared by BOTH the bare-ident path and the call path — a
  // call followed by an operator (`if=fn() is not`, `if=fn() && @m`) previously
  // committed to ATTR_CALL and silently dropped the trailing run (the
  // silent-WRONG class for `is not`: `if=fn() is not` emitted `if((fn()))` —
  // plain truthiness, the absence check dropped + inverted).
  function pushConditionOpReject(name: string, atomicExpr: string, vs: number, vl: number, vc: number) {
    const op = attrConditionOperatorAhead(raw, pos)!;
    let expr = atomicExpr;
    // Consume the leading inline whitespace + the detected operator chars FIRST,
    // so the boundary loop below reads only the RHS (a bare spaced `>` operator
    // is consumed here; the loop then breaks on the genuine tag-close `>`).
    while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\t")) { expr += raw[pos]; advance(); }
    for (let k = 0; k < op.length && pos < raw.length; k++) { expr += raw[pos]; advance(); }
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let stringCh: string | null = null;
    while (pos < raw.length) {
      const c2 = raw[pos];
      if (stringCh !== null) {
        if (c2 === "\\" && pos + 1 < raw.length) { expr += c2 + raw[pos + 1]; advance(2); continue; }
        if (c2 === stringCh) stringCh = null;
        expr += c2; advance(); continue;
      }
      const atDepthZero = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
      if (atDepthZero) {
        // `/>` self-close and a bare `>` tag-close end the RHS run. The leading
        // operator (incl. the `>` of `>=` / spaced `>`) was already consumed
        // above, so any `>` reached here is a genuine tag boundary.
        if (c2 === "/" && raw[pos + 1] === ">") break;
        if (c2 === ">") break;
      }
      if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; expr += c2; advance(); continue; }
      if (c2 === "(") { parenDepth++; expr += c2; advance(); continue; }
      if (c2 === ")") { parenDepth--; expr += c2; advance(); continue; }
      if (c2 === "[") { bracketDepth++; expr += c2; advance(); continue; }
      if (c2 === "]") { bracketDepth--; expr += c2; advance(); continue; }
      if (c2 === "{") { braceDepth++; expr += c2; advance(); continue; }
      if (c2 === "}") { braceDepth--; expr += c2; advance(); continue; }
      expr += c2; advance();
    }
    tokens.push(makeToken(
      "ATTR_OP_REJECT",
      JSON.stringify({ name, value: expr.replace(/\s+$/, ""), op }),
      vs, absOff(), vl, vc,
    ));
  }

  function readIdentRaw() {
    let id = "";
    while (pos < raw.length && /[A-Za-z0-9_\-]/.test(raw[pos])) {
      id += raw[pos];
      advance();
    }
    return id;
  }

  // --- Consume the opening `<` ---
  const tagOpenStart = absOff();
  const tagOpenLine = line;
  const tagOpenCol = col;
  advance(); // consume `<`

  // Skip whitespace (for state blocks)
  if (blockType === "state") {
    skipWs();
  }

  // Read tag/state name
  const tagName = readIdentRaw();

  tokens.push(makeToken("TAG_OPEN", tagName, tagOpenStart, absOff(), tagOpenLine, tagOpenCol));

  // --- Now tokenize attributes until `>` or `/>` ---
  while (pos < raw.length) {
    skipWs();

    if (pos >= raw.length) break;

    const c = ch();

    // Self-closing: />
    if (c === "/" && ch(1) === ">") {
      const start = absOff();
      const l = line, co = col;
      advance(2);
      tokens.push(makeToken("TAG_SELF_CLOSE", "/>", start, absOff(), l, co));
      break;
    }

    // End of tag: >
    if (c === ">") {
      const start = absOff();
      const l = line, co = col;
      advance();
      tokens.push(makeToken("TAG_CLOSE_GT", ">", start, absOff(), l, co));
      break;
    }

    // Attribute name
    if (/[A-Za-z_@]/.test(c)) {
      const atStart = absOff();
      const atLine = line;
      const atCol = col;
      let name = "";
      while (pos < raw.length && /[A-Za-z0-9_\-:@]/.test(raw[pos])) {
        name += raw[pos];
        advance();
      }
      // §35.2: In state blocks, `name(type)` (no preceding `=`) is a typed
      // attribute declaration, not a call expression. Detect this pattern before
      // emitting the ATTR_NAME token.
      if (blockType === "state" && ch() === "(") {
        // Typed attribute declaration: collect the type expression inside parens.
        advance(); // consume `(`
        let typeExpr = "";
        let depth = 1;
        while (pos < raw.length && depth > 0) {
          if (raw[pos] === "(") depth++;
          else if (raw[pos] === ")") {
            depth--;
            if (depth === 0) { advance(); break; }
          }
          typeExpr += raw[pos];
          advance();
        }
        tokens.push(makeToken("ATTR_TYPED_DECL", JSON.stringify({ name, typeExpr }), atStart, absOff(), atLine, atCol));
        continue;  // next attribute
      }

      tokens.push(makeToken("ATTR_NAME", name, atStart, absOff(), atLine, atCol));

      skipWs();

      // Check for = assignment
      if (ch() === "=") {
        const eqStart = absOff();
        const eqLine = line;
        const eqCol = col;
        advance(); // consume `=`
        tokens.push(makeToken("ATTR_EQ", "=", eqStart, absOff(), eqLine, eqCol));

        skipWs();

        // Value: quoted string, brace-block, identifier, call, or if= expression
        if (ch() === '"') {
          // Quoted string value.
          // For `if=` attributes: quoted values may contain boolean expressions
          // (e.g. `if="@var === 'x'"`, `if="@a && @b"`). Emit ATTR_EXPR for if=
          // so downstream can distinguish from plain static strings.
          const vs = absOff();
          const vl = line;
          const vc = col;
          advance(); // consume opening `"`
          let str = "";
          // g-each-peritem-attr-ternary-quoted-arms (2026-06-18) — a `"` that
          // lives INSIDE a `${...}` (or `?{`/`#{`/`!{`/`^{`/`~{`/bare-`{`)
          // interpolation is a string-literal delimiter of the INTERPOLATED
          // EXPRESSION (`${ cond ? "bg-yellow" : "bg-white" }`), NOT the
          // terminator of the attribute string. The pre-fix reader stopped at
          // the first such inner `"`, truncating the value to `${... ? ` (both
          // ternary arms dropped) → emit-each/emit-html later emitted invalid
          // JS (`...) ? }`) → E-CODEGEN-INVALID-LOGIC. Track interpolation depth
          // (brace-balanced, opened by `${`/sigil-`{`/bare-`{`) so the
          // value-terminating `"` is only the one seen at depth 0. Inside an
          // interpolation we also skip over nested string literals (`'…'` /
          // `"…"`) so their braces/quotes are opaque to the depth scan.
          let interpDepth = 0;       // brace depth inside any `${…}` interpolation
          let interpStringCh = "";   // active string delimiter inside the interpolation, "" when none
          while (pos < raw.length) {
            const sc = raw[pos];
            if (interpDepth === 0 && sc === '"') break; // depth-0 `"` terminates the attr value
            if (sc === "\\" && pos + 1 < raw.length) {
              str += sc + raw[pos + 1];
              advance(2);
              continue;
            }
            if (interpDepth > 0 && interpStringCh) {
              // Inside a string literal within the interpolation — opaque until
              // its matching delimiter (the leading `\\` escape is handled above).
              if (sc === interpStringCh) interpStringCh = "";
              str += sc;
              advance();
              continue;
            }
            if (interpDepth > 0 && (sc === '"' || sc === "'" || sc === "`")) {
              // Open a nested string literal inside the interpolation.
              interpStringCh = sc;
              str += sc;
              advance();
              continue;
            }
            // Open an interpolation: `${`, `?{`, `#{`, `!{`, `^{`, `~{`, or bare `{`.
            if (sc === "{") {
              interpDepth++;
              str += sc;
              advance();
              continue;
            }
            if ((sc === "$" || sc === "?" || sc === "#" || sc === "!" || sc === "^" || sc === "~") && pos + 1 < raw.length && raw[pos + 1] === "{") {
              interpDepth++;
              str += sc + "{";
              advance(2);
              continue;
            }
            if (sc === "}" && interpDepth > 0) {
              interpDepth--;
              str += sc;
              advance();
              continue;
            }
            str += sc;
            advance();
          }
          if (ch() === '"') advance(); // consume closing `"`
          if (name === "if") {
            // if= quoted value: always emit ATTR_EXPR so the AST builder
            // can produce an expr node for reactive wiring.
            tokens.push(makeToken("ATTR_EXPR", str, vs, absOff(), vl, vc));
          } else {
            tokens.push(makeToken("ATTR_STRING", str, vs, absOff(), vl, vc));
          }
        } else if (ch() === '{') {
          // Brace-block attribute value: `props={...}` typed props declaration (§15.10)
          const vs = absOff();
          const vl = line;
          const vc = col;
          advance(); // consume opening `{`
          let blockContent = "";
          let depth = 1;
          while (pos < raw.length && depth > 0) {
            if (raw[pos] === '{') depth++;
            else if (raw[pos] === '}') {
              depth--;
              if (depth === 0) { advance(); break; }
            }
            blockContent += raw[pos];
            advance();
          }
          tokens.push(makeToken("ATTR_BLOCK", blockContent, vs, absOff(), vl, vc));
        } else if (ch() === "!") {
          // Unquoted negation expression: `!@var`, `!!@var`, `!obj.prop`, etc.
          // Applies to any attribute (if=, class:name=, show=, etc.).
          // Read everything up to whitespace or tag-close characters.
          // Note: `>` and `/` would close the tag so they cannot appear unquoted.
          // Expressions with >, <, &&, ||, ===, !== must be quoted; use parens: `(!@a || !@b)`.
          const vs = absOff();
          const vl = line;
          const vc = col;
          let expr = "";
          while (pos < raw.length && !/[ \t\r\n\f>\/]/.test(raw[pos])) {
            expr += raw[pos];
            advance();
          }
          tokens.push(makeToken("ATTR_EXPR", expr, vs, absOff(), vl, vc));
        } else if (ch() === "(") {
          // Parenthesized expression for any attribute: `if=(@state === "loading")`,
          // `class:active=(@tool === "select")`, `show=(@count > 0)`, etc.
          // Read everything between the outer parens, preserving the parens in the output.
          // Supports nested parens: `if=((@a || @b) && @c)`.
          const vs = absOff();
          const vl = line;
          const vc = col;
          let expr = "";
          expr += raw[pos]; // include opening (
          advance();
          let depth = 1;
          while (pos < raw.length && depth > 0) {
            if (raw[pos] === "(") depth++;
            else if (raw[pos] === ")") {
              depth--;
              if (depth === 0) {
                expr += raw[pos];
                advance();
                break;
              }
            }
            expr += raw[pos];
            advance();
          }
          tokens.push(makeToken("ATTR_EXPR", expr, vs, absOff(), vl, vc));
        } else if (ch() === "[") {
          // §41.14 — Array-literal attribute value: `pick=["a", "b"]`,
          // `omit=["c"]`. The array-literal form is normative for the formFor
          // `pick=`/`omit=` attributes (§41.14.5). The form is admitted
          // generically for any attribute name — there's no per-attribute
          // gate at the tokenizer level; downstream attribute-grammar
          // validation (attribute-registry.js) may further restrict.
          //
          // Read everything between matched square brackets, preserving the
          // brackets in the output. Supports nested brackets/quotes:
          //   pick=[["a", "b"], ["c"]]                ← nested arrays
          //   pick=["a, b, c"]                         ← comma in string
          //
          // Bracket-depth tracking is depth-aware over `[` / `]`; string
          // literal contexts are tracked so `[` inside `"..."` does NOT
          // increment depth. Mirrors the brace-block / paren handlers.
          const vs = absOff();
          const vl = line;
          const vc = col;
          let expr = "";
          expr += raw[pos]; // include opening [
          advance();
          let depth = 1;
          let inSQ = false;
          let inDQ = false;
          while (pos < raw.length && depth > 0) {
            const c = raw[pos];
            if (inSQ) {
              if (c === "'" && raw[pos - 1] !== "\\") inSQ = false;
            } else if (inDQ) {
              if (c === '"' && raw[pos - 1] !== "\\") inDQ = false;
            } else {
              if (c === "'") inSQ = true;
              else if (c === '"') inDQ = true;
              else if (c === "[") depth++;
              else if (c === "]") {
                depth--;
                if (depth === 0) {
                  expr += c;
                  advance();
                  break;
                }
              }
            }
            expr += c;
            advance();
          }
          tokens.push(makeToken("ATTR_EXPR", expr, vs, absOff(), vl, vc));
        } else if (ch() === '$' && pos + 1 < raw.length && raw[pos + 1] === '{') {
          // Inline expression: ${() => fn(arg)}, ${condition ? a : b}, etc.
          const vs = absOff();
          const vl = line;
          const vc = col;
          advance(); // consume '$'
          advance(); // consume '{'
          let expr = "";
          let depth = 1;
          while (pos < raw.length && depth > 0) {
            if (raw[pos] === '{') depth++;
            else if (raw[pos] === '}') {
              depth--;
              if (depth === 0) { advance(); break; }
            }
            expr += raw[pos];
            advance();
          }
          tokens.push(makeToken("ATTR_EXPR", expr, vs, absOff(), vl, vc));
        } else if (/[A-Za-z0-9_@]/.test(ch())) {
          // Unquoted: peek ahead to see if it's a call (has `(`)
          const vs = absOff();
          const vl = line;
          const vc = col;
          let ident = "";
          // For event handler attributes, exclude `-` from the value-ident
          // regex so postfix `--` (e.g. `onclick=@count--`) terminates the
          // ident at the boundary. JS identifiers don't allow `-`, and
          // event-handler values are always JS-expression-shaped (call,
          // assignment, member chain), so the exclusion is safe. For all
          // other attributes (e.g. `class=foo-bar`), the legacy regex
          // continues to allow hyphenated unquoted values.
          const valueIdentRe = isEventHandlerAttrName(name)
            ? /[A-Za-z0-9_\.@]/
            : /[A-Za-z0-9_\-\.@]/;
          while (pos < raw.length && valueIdentRe.test(raw[pos])) {
            ident += raw[pos];
            advance();
          }
          if (ch() === "(") {
            // Call form: collect everything up to matching `)`
            let args = "";
            advance(); // consume `(`
            let depth = 1;
            while (pos < raw.length && depth > 0) {
              if (raw[pos] === "(") depth++;
              else if (raw[pos] === ")") { depth--; if (depth === 0) { advance(); break; } }
              args += raw[pos];
              advance();
            }
            // cluster-A — a CONDITION attribute call followed by a bare operator
            // (`if=fn() is not` / `if=fn() && @m`) rejects-with-parens, exactly
            // like the bare-ident path below. Without this the ATTR_CALL emit
            // committed here and the trailing operator run was silently dropped.
            if (isConditionAttrName(name) && attrConditionOperatorAhead(raw, pos) !== null) {
              pushConditionOpReject(name, `${ident}(${args})`, vs, vl, vc);
            } else {
              tokens.push(makeToken("ATTR_CALL", JSON.stringify({ name: ident, args }), vs, absOff(), vl, vc));
            }
          } else if (ident === "not" && isPrefixNotOperandAhead(raw, pos)) {
            // S188 follow-up (g-not-negation-enforce attr-bare hole) — bare
            // prefix-`not`-as-negation in an UNQUOTED attribute value, e.g.
            // `<p if=not @y>` / `<p show=not @y>`. SPEC §42.10 forbids prefix
            // `not` as boolean negation (E-TYPE-045); the negation operator is
            // `!`. The paren form `if=(not @y)` already tokenizes as ATTR_EXPR
            // and fires via the type-system harvest of the lowering choke-point
            // stamp. The BARE form did NOT: the unquoted-value reader stopped at
            // the space after `not`, emitting ATTR_IDENT "not" (the absence
            // VALUE) and stranding the operand (`@y`) as a stray bareword
            // attribute — so `not @y` never reached parseExprToNode, never
            // stamped `_notPrefixNegation`, and silently mis-compiled.
            //
            // Fix: when the unquoted value is exactly the keyword `not` followed
            // (after inline whitespace) by a negation operand, capture the whole
            // `not <operand>` run as a single ATTR_EXPR. It then routes through
            // the SAME parseExprToNode choke-point as every other position, gets
            // stamped, and the harvest fires E-TYPE-045 exactly ONCE (span-dedup
            // guards against any double-fire). The operand is read in
            // expression-mode (paren/brace/bracket/string-tracked) up to the
            // attribute boundary so member chains / call operands are captured
            // whole. Bare `if=not` with NO operand following stays ATTR_IDENT
            // (the valid absence-value form) — never reached here.
            let expr = ident; // "not"
            // Consume the inline whitespace between `not` and the operand so the
            // captured ATTR_EXPR is `not <operand>` (the choke-point lowering's
            // `not[ \t]+<operand>` detector matches this verbatim).
            while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\t")) {
              expr += raw[pos];
              advance();
            }
            // Read the operand in expression-mode up to the attribute boundary
            // (whitespace at depth 0 outside strings, or tag close `>` / `/>`).
            let parenDepth = 0;
            let braceDepth = 0;
            let bracketDepth = 0;
            let stringCh: string | null = null;
            while (pos < raw.length) {
              const c2 = raw[pos];
              if (stringCh !== null) {
                if (c2 === "\\" && pos + 1 < raw.length) { expr += c2 + raw[pos + 1]; advance(2); continue; }
                if (c2 === stringCh) stringCh = null;
                expr += c2; advance(); continue;
              }
              const atDepthZero = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
              if (atDepthZero) {
                if (c2 === "/" && raw[pos + 1] === ">") break;
                if (c2 === ">") break;
                if (/[ \t\r\n\f]/.test(c2)) break;
              }
              if (c2 === '"' || c2 === "'" || c2 === "`") { stringCh = c2; expr += c2; advance(); continue; }
              if (c2 === "(") { parenDepth++; expr += c2; advance(); continue; }
              if (c2 === ")") { parenDepth--; expr += c2; advance(); continue; }
              if (c2 === "[") { bracketDepth++; expr += c2; advance(); continue; }
              if (c2 === "]") { bracketDepth--; expr += c2; advance(); continue; }
              if (c2 === "{") { braceDepth++; expr += c2; advance(); continue; }
              if (c2 === "}") { braceDepth--; expr += c2; advance(); continue; }
              expr += c2; advance();
            }
            tokens.push(makeToken("ATTR_EXPR", expr, vs, absOff(), vl, vc));
          } else if (isEventHandlerAttrName(name) && isBareExprContinuation(raw, pos)) {
            // S97 — SPEC §5.2.3 bare-assignment event handler.
            //
            // L19 normatively recognizes three bare-form shapes:
            //   1. Bare call           — `onclick=fn()`                  (handled above as ATTR_CALL)
            //   2. Bare assignment     — `onclick=@phase = .Loading`     (handled HERE)
            //   3. Bare single-expr    — `onclick=@count++` etc.         (NOT YET — see isBareExprContinuation)
            //
            // Without this branch, the unquoted-value reader stops at the
            // first whitespace after the ident, then the outer loop sees `=`
            // as an unexpected char, silently swallows it, and misinterprets
            // the rest as boolean attributes. Symptom on
            // `<button onclick=@phase = .Loading>`: HTML emitted as
            // `<button onclick="phase" Loading>` — `@` stripped, value
            // string-quoted, `.Loading` becomes a bare attribute.
            //
            // The fix: when the attribute name is an event handler AND the
            // continuation after the ident looks like an expression-continuation
            // operator (`=` not-comparison-not-arrow, `++`, `--`, compound
            // assigns like `+=`, `??=`), keep reading in expression-mode
            // (paren/brace/bracket/string-tracked) until the tag-closing `>`
            // or `/>` at depth 0 outside strings. Emit as ATTR_EXPR — the
            // downstream parseAttributes ATTR_EXPR branch produces a `kind:
            // "expr"` value with the full expression text + reactive refs,
            // and the emit-event-wiring path wraps it as `function(event) {
            // <expr>; }` per §5.2.2 line 1128.
            //
            // SPEC authority:
            //   - §5.2.3 lines 1140-1152 (bare-form rule + worked example)
            //   - §50 (assignment-as-expression)
            //   - §34 / multi-statement-scan E-MULTI-STATEMENT-HANDLER stays
            //     intact — the multi-statement scanner runs on the captured
            //     ATTR_EXPR raw text in ast-builder.js post-tokenization.
            // Two bare-form shapes per SPEC §5.2.3, distinguished by the
            // operator following the LHS ident:
            //   - Postfix update (`++` / `--`): self-contained, no RHS to read.
            //   - Assignment / compound assignment: consume the op then read
            //     RHS until the next attribute boundary (whitespace at depth
            //     0 outside strings) or tag close (`>` / `/>`).
            let expr = ident;
            // Skip whitespace between LHS ident and the operator.
            while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\t")) {
              expr += raw[pos];
              advance();
            }
            const opC = pos < raw.length ? raw[pos] : "";
            const opN = pos + 1 < raw.length ? raw[pos + 1] : "";
            if ((opC === "+" || opC === "-") && opN === opC) {
              // Postfix update — consume 2 chars and we're done.
              expr += opC + opN;
              advance(2);
              tokens.push(makeToken("ATTR_EXPR", expr.replace(/\s+$/, ""), vs, absOff(), vl, vc));
            } else {
              // Assignment / compound assignment — read until boundary.
              // Boundary detection:
              //   - Inside strings / parens / brackets / braces (depth > 0):
              //     keep reading regardless of whitespace.
              //   - At depth 0 outside strings: STOP on whitespace ONLY after
              //     we've consumed the `=` and at least one non-whitespace
              //     RHS char. (Without this guard, multiple bare-assignment
              //     handlers on the same element collide — the first reader
              //     would swallow `onmouseenter=...` etc. up to the tag close.)
              //   - Also STOP on `>` or `/>` at depth 0 outside strings.
              let parenDepth = 0;
              let braceDepth = 0;
              let bracketDepth = 0;
              let stringCh: string | null = null;
              let consumedEq = false;        // have we passed the `=` of the assignment?
              let consumedRhsChar = false;   // and at least one non-ws RHS char?
              while (pos < raw.length) {
                const c2 = raw[pos];
                if (stringCh !== null) {
                  if (c2 === '\\' && pos + 1 < raw.length) {
                    expr += c2 + raw[pos + 1];
                    advance(2);
                    continue;
                  }
                  if (c2 === stringCh) { stringCh = null; }
                  expr += c2;
                  advance();
                  continue;
                }
                const atDepthZero = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
                if (atDepthZero) {
                  if (c2 === '/' && raw[pos + 1] === '>') break;
                  if (c2 === '>') break;
                  if (consumedEq && consumedRhsChar && /[ \t\r\n\f]/.test(c2)) break;
                }
                if (c2 === '"' || c2 === "'" || c2 === '`') { stringCh = c2; expr += c2; advance(); continue; }
                if (c2 === '(') { parenDepth++; expr += c2; advance(); continue; }
                if (c2 === ')') { parenDepth--; expr += c2; advance(); continue; }
                if (c2 === '[') { bracketDepth++; expr += c2; advance(); continue; }
                if (c2 === ']') { bracketDepth--; expr += c2; advance(); continue; }
                if (c2 === '{') { braceDepth++; expr += c2; advance(); continue; }
                if (c2 === '}') { braceDepth--; expr += c2; advance(); continue; }
                if (atDepthZero) {
                  // `consumedEq` flips on the `=` that ENDS the assignment
                  // operator. For plain `=`, that's the only char. For
                  // compound `+=` / `??=` / etc., the `=` is the last char
                  // of the op; the earlier chars (`+`, `?`, etc.) flow
                  // through the plain append below and don't toggle the flag.
                  if (!consumedEq && c2 === '=') {
                    consumedEq = true;
                    expr += c2;
                    advance();
                    continue;
                  }
                  if (consumedEq && !/[ \t\r\n\f]/.test(c2)) {
                    consumedRhsChar = true;
                  }
                }
                expr += c2;
                advance();
              }
              tokens.push(makeToken("ATTR_EXPR", expr.replace(/\s+$/, ""), vs, absOff(), vl, vc));
            }
          } else if (
            isConditionAttrName(name) &&
            attrConditionOperatorAhead(raw, pos) !== null
          ) {
            // cluster-A (S188 "reject + parens") — a CONDITION attribute
            // (`if=`/`show=`/`else-if=`) whose unquoted value continues past
            // the first atomic ident into a BINARY/TERNARY operator
            // (`>= > < <= == != && || + - * /` or ternary `?:`). SPEC §5.1/§5.2
            // admit only the ATOMIC unquoted forms for a condition; operator
            // conditions SHALL be parenthesized `if=(expr)` or quoted
            // `if="expr"`.
            //
            // Before this branch, the value-reader stopped at the operator and
            // the operator + RHS were either silently shredded (the operator
            // and its operand DROPPED at token level — the dangerous class) or
            // the first `>` of `>=` closed the tag early (the misleading
            // E-CTX-001 "no matching tag" cascade). Here we CAPTURE the whole
            // operator run as a single ATTR_OP_REJECT token so the AST builder
            // can fire E-ATTR-UNQUOTED-OPERATOR exactly ONCE, naming the real
            // cause and steering to parens/quotes — no silent drop, no stray
            // DOM-leaked operand, no E-CTX-001 cascade.
            //
            // The run is read in expression-mode (paren/brace/bracket/string-
            // tracked) up to the attribute boundary so the captured text
            // mirrors the author's intent in the diagnostic. The `>=` / spaced
            // `>` cases are intercepted here BEFORE the outer tag-close test
            // would consume the `>`. Shared with the call path via
            // pushConditionOpReject (atomic value = the bare ident here).
            pushConditionOpReject(name, ident, vs, vl, vc);
          } else {
            tokens.push(makeToken("ATTR_IDENT", ident, vs, absOff(), vl, vc));
          }
        } else if (ch() === '<' && pos + 1 < raw.length && raw[pos + 1] === '#') {
          // Worker ref or input state ref in attribute value position.
          // The attribute scanner cannot handle '#' in identifiers, so we detect and decode
          // the <#name> pattern directly here.
          // <#name>.send(args) → ATTR_CALL { name: "_scrml_worker_name.send", args }
          // <#name>            → ATTR_IDENT "_scrml_input_name_"
          // Mirrors preprocessWorkerAndStateRefs() in ast-builder.js (logic block context).
          const vs = absOff();
          const vl = line;
          const vc = col;
          advance(2); // consume '<#'
          let refName = "";
          while (pos < raw.length && /[A-Za-z0-9_$]/.test(raw[pos])) {
            refName += raw[pos];
            advance();
          }
          if (ch() === '>') advance(); // consume '>'
          // Skip optional spaces, then check for .send(
          while (pos < raw.length && raw[pos] === ' ') advance();
          if (ch() === '.' && raw.slice(pos + 1).match(/^send\s*\(/)) {
            advance(); // consume '.'
            while (pos < raw.length && /[a-z]/.test(raw[pos])) advance(); // consume 'send'
            while (pos < raw.length && raw[pos] === ' ') advance(); // skip ws before (
            if (ch() === '(') {
              advance(); // consume '('
              let args = "";
              let depth = 1;
              while (pos < raw.length && depth > 0) {
                if (raw[pos] === '(') depth++;
                else if (raw[pos] === ')') { depth--; if (depth === 0) { advance(); break; } }
                args += raw[pos];
                advance();
              }
              tokens.push(makeToken("ATTR_CALL", JSON.stringify({ name: `_scrml_worker_${refName}.send`, args }), vs, absOff(), vl, vc));
            }
          } else {
            // Standalone <#name>[.member.chain] — input-state (§36) OR request
            // (§6.7.7) ref. PRE-FIX this branch dropped any trailing `.member`
            // (e.g. `if=<#feed>.loading` captured only `_scrml_input_feed_`, losing
            // `.loading` → the if= condition read the wrong thing). Consume the
            // trailing member-access chain (`.loading` / `.data` / `.error` /
            // `.stale`) so it survives into the ATTR_IDENT. (`.send(` is the worker
            // form, handled above; the optional-spaces skip at :1036 already ran, so
            // a `.send(` never reaches here.) Member-access only — a trailing call
            // (`.refetch()`) is not a valid condition/attr-value shape and is left
            // for the §6.7.7 logic-body form.
            let memberChain = "";
            while (
              ch() === '.' &&
              pos + 1 < raw.length &&
              /[A-Za-z_$]/.test(raw[pos + 1])
            ) {
              memberChain += '.';
              advance(); // consume '.'
              while (pos < raw.length && /[A-Za-z0-9_$]/.test(raw[pos])) {
                memberChain += raw[pos];
                advance();
              }
            }
            tokens.push(makeToken("ATTR_IDENT", `_scrml_input_${refName}_${memberChain}`, vs, absOff(), vl, vc));
          }
        }
        // (Other value forms not currently handled — fallthrough skips them)
      }
      // Boolean attribute (no =): ATTR_NAME alone is sufficient
    } else {
      // Sigil-prefixed brace block in standalone attribute position:
      // ${...}, ^{...}, ?{...}, #{...}, !{...}, ~{...}
      // Must consume as opaque unit — otherwise content like process.env
      // or Bun.file() would be tokenized as ATTR_NAME/ATTR_CALL, leaking
      // server-context code into client JS via event binding paths.
      // (Post-S130 / HU-2 Q4: `bun.eval()` retires as a user-facing surface
      // per Approach C extension; the broader server-context concern remains.)
      if (
        (c === '$' || c === '^' || c === '?' || c === '#' || c === '!' || c === '~') &&
        pos + 1 < raw.length && raw[pos + 1] === '{'
      ) {
        advance(); advance(); // consume sigil and '{'
        let depth = 1;
        while (pos < raw.length && depth > 0) {
          const bc = raw[pos];
          if (bc === '`') {
            // Template literal: scan until matching backtick
            advance();
            while (pos < raw.length) {
              const tc = raw[pos];
              if (tc === '\\') { advance(); advance(); continue; }
              if (tc === '`') { advance(); break; }
              if (tc === '$' && pos + 1 < raw.length && raw[pos + 1] === '{') {
                advance(); advance();
                let innerDepth = 1;
                while (pos < raw.length && innerDepth > 0) {
                  const ic = raw[pos];
                  if (ic === '{') innerDepth++;
                  else if (ic === '}') { innerDepth--; if (innerDepth === 0) { advance(); break; } }
                  advance();
                }
                continue;
              }
              advance();
            }
            continue;
          }
          if (bc === '{') depth++;
          else if (bc === '}') {
            depth--;
            if (depth === 0) { advance(); break; }
          }
          advance();
        }
        continue;
      }
      // Unexpected char — skip
      advance();
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Logic / meta block tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize the body content of a logic (`${}`) or meta (`^{}`) block.
 *
 * `content` is the raw content BETWEEN the delimiters (i.e., the block `.raw`
 * with the opening `${` / `^{` and closing `}` stripped).
 *
 * `baseOffset` is the source offset of content[0].
 * `baseLine` / `baseCol` are the 1-based source position of content[0].
 *
 * Only brace-delimited child blocks (logic, sql, css, error-effect, meta) are
 * represented as BLOCK_REF tokens — text and comment blocks are raw content
 * that already appears verbatim in `content` and must not be skipped.
 *
 * `children` — child blocks in source order (from BS output)
 */
export function tokenizeLogic(content: string, baseOffset: number, baseLine: number, baseCol: number, children: Block[]): Token[] {
  const tokens: Token[] = [];

  let pos = 0;
  let line = baseLine;
  let col = baseCol;

  // Only brace-delimited block types should be skipped and replaced with BLOCK_REF.
  // Text and comment blocks are already represented as raw characters in `content`.
  const BLOCKREF_TYPES = new Set(["logic", "sql", "css", "error-effect", "meta", "foreign"]);  // dpa-003 (S216) — `_={ … }=` inline foreign-code block emits a BLOCK_REF in logic.

  const childByStart = new Map<number, Block>();
  for (const child of children) {
    if (!BLOCKREF_TYPES.has(child.type)) continue;
    // child.span.start is absolute; content starts at baseOffset
    const relStart = child.span.start - baseOffset;
    if (relStart >= 0 && relStart < content.length) {
      childByStart.set(relStart, child);
    }
  }

  function absOff() { return baseOffset + pos; }
  function ch(n = 0) { return pos + n < content.length ? content[pos + n] : ""; }

  function advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (pos < content.length) {
        if (content[pos] === "\n") { line++; col = 1; }
        else { col++; }
        pos++;
      }
    }
  }

  function skipWs() {
    while (pos < content.length && /[ \t\r\n\f]/.test(content[pos])) advance();
  }

  function isIdentStart(c: string): boolean { return /[A-Za-z_$]/.test(c); }
  function isIdentPart(c: string): boolean  { return /[A-Za-z0-9_$]/.test(c); }

  function readIdent() {
    let id = "";
    while (pos < content.length && isIdentPart(content[pos])) {
      id += content[pos];
      advance();
    }
    return id;
  }

  function readLineComment() {
    const start = absOff();
    const l = line, c = col;
    let text = "";
    while (pos < content.length && content[pos] !== "\n") {
      text += content[pos];
      advance();
    }
    if (pos < content.length) { text += "\n"; advance(); } // consume \n
    tokens.push(makeToken("COMMENT", text, start, absOff(), l, c));
  }

  function readBlockComment() {
    const start = absOff();
    const l = line, c = col;
    let text = "";
    while (pos < content.length) {
      if (content[pos] === "*" && ch(1) === "/") {
        text += "*/";
        advance(2);
        break;
      }
      text += content[pos];
      advance();
    }
    tokens.push(makeToken("COMMENT", text, start, absOff(), l, c));
  }

  function readString(delim: string) {
    const start = absOff();
    const l = line, c = col;
    advance(); // consume opening delimiter
    let str = "";
    while (pos < content.length && content[pos] !== delim) {
      if (content[pos] === "\\" && pos + 1 < content.length) {
        str += content[pos] + content[pos + 1];
        advance(2);
      } else {
        str += content[pos];
        advance();
      }
    }
    if (pos < content.length) advance(); // consume closing delimiter
    tokens.push(makeToken("STRING", str, start, absOff(), l, c));
  }

  // ss39 #2 (g-nested-template-raw-mangle) — scan a `${...}` interpolation body
  // after its opening `${` has been consumed. Returns the body text INCLUDING
  // the matching closing `}`, balancing braces and stepping over nested strings
  // and nested template literals so a `${`, `}`, or backtick that lives inside
  // an inner template/string does NOT prematurely close the interpolation.
  // Mutually recursive with `scanTemplateBody` (a nested `` ` `` re-enters
  // template-string scanning, whose own `${...}` re-enters this helper).
  function scanInterpBody(): string {
    let out = "";
    let depth = 1; // the opening `${` has already been consumed
    while (pos < content.length && depth > 0) {
      const cc = content[pos];
      // Backslash escape — copy both chars verbatim.
      if (cc === "\\" && pos + 1 < content.length) {
        out += content[pos] + content[pos + 1];
        advance(2);
        continue;
      }
      if (cc === "{") { depth++; out += cc; advance(); continue; }
      if (cc === "}") { depth--; out += cc; advance(); continue; }
      // Nested string — copy verbatim up to + including the matching quote.
      if (cc === '"' || cc === "'") {
        const q = cc;
        out += cc;
        advance();
        while (pos < content.length && content[pos] !== q) {
          if (content[pos] === "\\" && pos + 1 < content.length) {
            out += content[pos] + content[pos + 1];
            advance(2);
            continue;
          }
          out += content[pos];
          advance();
        }
        if (pos < content.length) { out += content[pos]; advance(); } // closing quote
        continue;
      }
      // Nested template literal — recurse so its own `${...}` / backticks are
      // preserved verbatim and don't leak brace-depth into this interpolation.
      if (cc === "`") {
        out += "`";
        advance();
        out += scanTemplateBody();
        out += "`";
        continue;
      }
      out += cc;
      advance();
    }
    return out;
  }

  // ss39 #2 — scan a template-literal body after its opening backtick has been
  // consumed. Returns the inner text (WITHOUT the surrounding backticks),
  // consuming the matching closing backtick. Preserves every `${...}`
  // interpolation verbatim (via `scanInterpBody`), including nested templates.
  function scanTemplateBody(): string {
    let out = "";
    while (pos < content.length) {
      const cc = content[pos];
      // Backslash escape: `\\`` (escaped backtick), `\\$` (escaped
      // interpolation), `\\n` etc. — copy BOTH chars verbatim and skip past
      // them so an escaped backtick does NOT close the template. Without this
      // the tokenizer treated `\\`` as a closing backtick and truncated the
      // template literal mid-string (e.g. `\\`${name}\\`` lost everything
      // after the first escaped backtick, emitting invalid JS).
      if (cc === "\\" && pos + 1 < content.length) {
        out += content[pos] + content[pos + 1];
        advance(2);
        continue;
      }
      // Closing backtick (template-string level).
      if (cc === "`") { advance(); break; }
      // Interpolation opener — hand off to the brace-balanced scanner so a
      // nested template's backtick / `${` is not mistaken for this template's
      // close (the ss39 #2 nested-template-raw-mangle root cause).
      if (cc === "$" && content[pos + 1] === "{") {
        out += "${";
        advance(2);
        out += scanInterpBody();
        continue;
      }
      out += cc;
      advance();
    }
    return out;
  }

  function readBacktickString() {
    const start = absOff();
    const l = line, c = col;
    advance(); // consume opening `
    const str = scanTemplateBody();
    const tok = makeToken("STRING", str, start, absOff(), l, c);
    // A4: mark backtick-derived STRING tokens so collectExpr can re-emit
    // them with backticks (preserving `${...}` interpolations) instead of
    // JSON.stringify-ing them as plain double-quoted strings.
    tok.isTemplate = true;
    tokens.push(tok);
  }

  function readNumber() {
    const start = absOff();
    const l = line, c = col;
    let num = "";
    // Hex
    if (content[pos] === "0" && /[xXoObB]/.test(ch(1))) {
      num += content[pos] + content[pos + 1];
      advance(2);
      while (pos < content.length && /[0-9a-fA-F_]/.test(content[pos])) {
        num += content[pos];
        advance();
      }
    } else {
      while (pos < content.length && /[0-9_]/.test(content[pos])) {
        num += content[pos];
        advance();
      }
      if (ch() === "." && /[0-9]/.test(ch(1))) {
        num += ".";
        advance();
        while (pos < content.length && /[0-9_]/.test(content[pos])) {
          num += content[pos];
          advance();
        }
      }
      if (/[eE]/.test(ch())) {
        num += content[pos];
        advance();
        if (/[+-]/.test(ch())) { num += content[pos]; advance(); }
        while (pos < content.length && /[0-9]/.test(content[pos])) {
          num += content[pos];
          advance();
        }
      }
    }
    tokens.push(makeToken("NUMBER", num, start, absOff(), l, c));
  }

  // ---------------------------------------------------------------------------
  // Regex literal detection and consumption
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the current `/` should be the start of a regex literal
   * rather than a division operator.
   *
   * Heuristic: `/` is a regex when the last non-comment token is NOT a
   * value-producing token. Value-producing (division): IDENT, NUMBER, STRING,
   * REGEX, value keywords (true/false/null/undefined/this), `)`, `]`.
   * Everything else → regex context.
   */
  function isRegexContext() {
    // Walk backward, skipping comments, to find the preceding token.
    // Regex context: token is an operator/punctuation that cannot end a value
    //   expression, OR a statement keyword, OR start of stream.
    // Division context: the preceding token produces a value (IDENT, NUMBER,
    //   STRING, REGEX, value keywords like true/false/null/undefined/this,
    //   or closing ) / ]).
    //
    // Explicit regex-context PUNCT tokens (cannot end a value expression):
    //   ( [ { , ; ! ~ & | ^ ? : = + - * % < > =>  and compound operators
    // Explicit division-context PUNCT/KEYWORD tokens (end a value expression):
    //   ) ]   and value keywords: true false null undefined this
    //
    // NOTE: This list intentionally excludes arithmetic operators (+, -, *, %)
    // from the regex-context set to avoid false positives like x * /foo/.test().
    // Instead we use a conservative whitelist for regex context.
    const REGEX_PUNCT = new Set(['(', '[', '{', ',', ';', '!', '~', '&', '|', '^', '?', ':', '=']);
    const REGEX_KEYWORDS = new Set([
      'return', 'typeof', 'void', 'delete', 'in', 'instanceof',
      'case', 'throw', 'new', 'if', 'else', 'while', 'for', 'do',
      'yield', 'await', 'of',
    ]);
    const VALUE_KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'this']);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.kind === 'COMMENT') continue;
      // Division context: value-producing tokens
      if (t.kind === 'IDENT') return false;
      if (t.kind === 'NUMBER') return false;
      if (t.kind === 'STRING') return false;
      if (t.kind === 'REGEX') return false;
      if (t.kind === 'AT_IDENT') return false;
      if (t.kind === 'KEYWORD' && VALUE_KEYWORDS.has(t.text)) return false;
      if (t.kind === 'PUNCT' && (t.text === ')' || t.text === ']')) return false;
      // Regex context: explicit operator/punctuation whitelist
      if (t.kind === 'PUNCT' && REGEX_PUNCT.has(t.text)) return true;
      if (t.kind === 'OPERATOR') return true;  // => == != += etc.
      if (t.kind === 'KEYWORD' && REGEX_KEYWORDS.has(t.text)) return true;
      // Anything else (e.g. TILDE, BLOCK_REF, other PUNCT like < > + - * % ^ ~ /)
      // → treat as division context to avoid false positives on closing tags
      return false;
    }
    return true; // start of stream → regex
  }

  /**
   * Consume a regex literal. Called when isRegexContext() returns true and ch() === '/'.
   * Handles character classes [...] (which may contain unescaped /) and backslash
   * escapes. Emits a single REGEX token with the full text including flags.
   */
  function readRegex() {
    const start = absOff();
    const l = line, c = col;
    let raw = '/';
    advance(); // consume opening /

    let inClass = false;
    while (pos < content.length) {
      const c0 = content[pos];
      if (c0 === '\\' && pos + 1 < content.length) {
        // Escaped character — consume two chars verbatim
        raw += c0 + content[pos + 1];
        advance(2);
        continue;
      }
      if (c0 === '[') { inClass = true;  raw += c0; advance(); continue; }
      if (c0 === ']') { inClass = false; raw += c0; advance(); continue; }
      if (c0 === '/' && !inClass) {
        raw += c0; advance(); break; // closing slash
      }
      if (c0 === '\n') break; // unescaped newline — malformed, stop
      raw += c0;
      advance();
    }

    // Consume flags: g i m s u y d (ECMAScript regex flags)
    while (pos < content.length && /[gimsuyd]/.test(content[pos])) {
      raw += content[pos];
      advance();
    }

    tokens.push(makeToken('REGEX', raw, start, absOff(), l, c));
  }

  /**
   * Bug 49 (S138) — synthesize a synthetic `error-effect` BLOCK_REF when
   * `!{...}` is encountered inside content tokenizeLogic is re-tokenizing
   * from scratch (i.e. with no pre-split children at this position).
   *
   * Under v0.3 default-logic-mode, bare top-level function declarations at
   * `<program>` / `<page>` / `<channel>` direct-child positions auto-lift via
   * `liftBareDeclarations` (ast-builder.js) into a synthetic `${...}` logic
   * block whose `children: []` array carries no BS-side `!{...}` child —
   * because block-splitter's orphan-brace mode disables sigil-recognition
   * inside function-decl bodies (see block-splitter.js scanAttributes /
   * orphanBraceDepth gating).
   *
   * When buildBlock(case "logic") re-tokenizes that lifted body, the inner
   * `!{...}` arm-handler block would otherwise be lexed as PUNCT `!` + PUNCT
   * `{` + interior tokens + PUNCT `}`. collectExpr (ast-builder.js:2479) then
   * greedily consumes those into the const/let/bare-call RHS, acorn parses
   * only the call (`risky()`) as the expression, and the trailing
   * `! { | ::Variant -> { ... } }` content trips the "statement boundary not
   * detected" warning at expression-parser.ts:2010 — arm bodies never reach
   * the AST and are silently dropped.
   *
   * Scope (S138):
   *   - This recognizer handles `!{` only — the canon-shown surface (PRIMER §6
   *     + kickstarter §error-handling). Sister sigils (`${`, `#{`, `^{`, `~{`)
   *     would each need their own composition checks before adding here.
   *   - Recognition is unconditional once `!` + `{` are seen here: the `!{`
   *     digraph has no overload in scrml — it is unambiguously the error-
   *     handler context opener (§19.5). At this point in tokenizeLogic, we
   *     are necessarily at a code position (strings / line comments / block
   *     comments are consumed by readString / readLineComment /
   *     readBlockComment before reaching the dispatch).
   *   - Inside the scanned body, we skip string + comment runs so braces
   *     embedded in handler-arm string literals (`@msg = "}"`) don't fool
   *     the brace-depth scanner.
   *
   * Returns true when a synthetic BLOCK_REF was emitted (caller `continue`s
   * the main loop); false when `!{` is not at this position OR scanning hit
   * EOF before finding the matching close (caller falls through to normal
   * tokenization so downstream stages can surface a recoverable diagnostic
   * rather than silently dropping content).
   */
  function tryEmitSyntheticErrorEffectBlock(): boolean {
    if (ch() !== "!" || ch(1) !== "{") return false;
    const blockStart = absOff();
    const blockStartLine = line;
    const blockStartCol = col;
    const startPos = pos;
    // Scan forward from `!{` (cursor at `!`) to the matching `}`, tracking
    // brace nesting and skipping string + comment runs. Mirrors the discipline
    // of block-splitter.js's brace-context scanner.
    let scan = pos + 2; // past `!{`
    let depth = 1;
    while (scan < content.length) {
      const c = content[scan];
      const c2 = scan + 1 < content.length ? content[scan + 1] : "";
      // Line comment `// ...`
      if (c === "/" && c2 === "/") {
        scan += 2;
        while (scan < content.length && content[scan] !== "\n") scan++;
        continue;
      }
      // Block comment `/* ... */`
      if (c === "/" && c2 === "*") {
        scan += 2;
        while (scan + 1 < content.length && !(content[scan] === "*" && content[scan + 1] === "/")) scan++;
        if (scan + 1 < content.length) scan += 2;
        continue;
      }
      // Double-quoted string
      if (c === '"') {
        scan++;
        while (scan < content.length && content[scan] !== '"') {
          if (content[scan] === "\\" && scan + 1 < content.length) { scan += 2; continue; }
          scan++;
        }
        if (scan < content.length) scan++; // closing quote
        continue;
      }
      // Single-quoted string
      if (c === "'") {
        scan++;
        while (scan < content.length && content[scan] !== "'") {
          if (content[scan] === "\\" && scan + 1 < content.length) { scan += 2; continue; }
          scan++;
        }
        if (scan < content.length) scan++;
        continue;
      }
      // Backtick template literal — consume the whole template (including any
      // nested `${...}` interpolations) as one balanced unit. Inside an
      // interpolation, brace depth is tracked locally.
      if (c === "`") {
        scan++;
        while (scan < content.length && content[scan] !== "`") {
          if (content[scan] === "\\" && scan + 1 < content.length) { scan += 2; continue; }
          if (content[scan] === "$" && content[scan + 1] === "{") {
            scan += 2;
            let bd = 1;
            while (scan < content.length && bd > 0) {
              if (content[scan] === "{") bd++;
              else if (content[scan] === "}") bd--;
              scan++;
            }
            continue;
          }
          scan++;
        }
        if (scan < content.length) scan++; // closing backtick
        continue;
      }
      // Brace depth
      if (c === "{") { depth++; scan++; continue; }
      if (c === "}") {
        depth--;
        scan++;
        if (depth === 0) {
          const blockEnd = baseOffset + scan;
          const blockRaw = content.slice(startPos, scan);
          const childBlock: Block = {
            type: "error-effect",
            raw: blockRaw,
            span: { start: blockStart, end: blockEnd },
            children: [],
          };
          // Advance the tokenizer cursor to `scan` (post matching `}`).
          advance(scan - startPos);
          const tok: Token = makeToken("BLOCK_REF", blockRaw, blockStart, absOff(), blockStartLine, blockStartCol);
          tok.block = childBlock;
          tokens.push(tok);
          return true;
        }
        continue;
      }
      scan++;
    }
    // EOF before matching close — fall through to normal tokenization so the
    // downstream parser surfaces a recovery diagnostic.
    return false;
  }



  // Multi-char operators (longest first)
  // W14-BB: added "++" and "--" for postfix update on @x reactive vars
  // (SPEC §5.2.3 line 1385, §6.1.2). Without them, `@x++` lexed as three
  // PUNCT tokens (@x, +, +) and `joinWithNewlines` reassembled the source
  // as `@x + +`, which Acorn rejected, producing escape-hatch JS like
  // `_scrml_reactive_get("x") + +`. Placed BEFORE `+=` / `-=` so the
  // alternation matches the longest applicable op: scanner walks the list
  // in order, and `+=` is also two chars, but the loop tries them in
  // declared order so `++` must come first when both could match the same
  // 2-char window. (In practice they're disjoint — `+=` vs `++` differ in
  // the second char — but list-order is the documented contract.)
  const MULTI_OPS = [
    // ss4 item 7 — shift compound-assigns MUST precede the bare shift ops
    // (`<<`/`>>`/`>>>` below) so `@x <<= 1` lexes `<<=` as ONE OPERATOR token.
    // Without them the longest match was `<<`, leaving `=` a separate PUNCT;
    // joinWithNewlines then reassembled `<< =`, which broke
    // rewriteReactiveAssign's contiguous-op regex -> E-CODEGEN-INVALID-LOGIC.
    // (`>>>=`/`>>=` are mutually non-conflicting; both precede `>>>`/`>>`.)
    "...", "===", "!==", "**=", "&&=", "||=", "??=", ">>>=", "<<=", ">>=", "=>", ":>",
    "==", "!=", "<=", ">=", "**", "&&", "||", "??",
    "++", "--",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "<<", ">>", ">>>", "::", ".."
  ];

  while (pos < content.length) {
    // Check for a child block at this position
    if (childByStart.has(pos)) {
      const child = childByStart.get(pos)!;
      const childLen = child.span.end - child.span.start;
      const start = absOff();
      const l = line, c = col;
      // Advance over the child's source region
      advance(childLen);
      const tok: Token = makeToken("BLOCK_REF", child.raw, start, absOff(), l, c);
      tok.block = child;
      tokens.push(tok);
      continue;
    }

    // Bug 49 (S138) — synthesize an error-effect BLOCK_REF for `!{...}`
    // appearing inside content without a pre-split BS child here. See
    // tryEmitSyntheticErrorEffectBlock above for full rationale. Recognizing
    // `!{...}` at tokenize-time produces a BLOCK_REF that ast-builder.js's
    // collectExpr (L2512) breaks at and the outer parseLogicBody /
    // parseRecursiveBody (L3653 / L7257) wraps as a guarded-expr.
    if (ch() === "!" && ch(1) === "{") {
      if (tryEmitSyntheticErrorEffectBlock()) continue;
    }

    const c0 = ch();
    const l = line, co = col;
    const start = absOff();

    // Whitespace
    if (/[ \t\r\n\f]/.test(c0)) {
      advance();
      continue;
    }

    // Line comment
    if (c0 === "/" && ch(1) === "/") {
      advance(2);
      readLineComment();
      continue;
    }

    // Block comment
    if (c0 === "/" && ch(1) === "*") {
      advance(2);
      readBlockComment();
      continue;
    }

    // Regex literal — check after line/block comments but before single-char PUNCT.
    // isRegexContext() inspects the token stream to distinguish /pattern/flags
    // from division operators (x / y) and compound operators (/=).
    if (c0 === '/' && ch(1) !== '/' && ch(1) !== '*' && ch(1) !== '=' && isRegexContext()) {
      readRegex();
      continue;
    }

    // Strings
    if (c0 === '"' || c0 === "'") { readString(c0); continue; }
    if (c0 === "`") { readBacktickString(); continue; }

    // Numbers
    if (/[0-9]/.test(c0) || (c0 === "." && /[0-9]/.test(ch(1)))) {
      readNumber();
      continue;
    }

    // @ sigil — reactive variable or decorator
    if (c0 === "@") {
      advance();
      if (isIdentStart(ch())) {
        const name = readIdent();
        tokens.push(makeToken("AT_IDENT", "@" + name, start, absOff(), l, co));
      } else {
        tokens.push(makeToken("PUNCT", "@", start, absOff(), l, co));
      }
      continue;
    }

    // ~ pipeline accumulator
    if (c0 === "~") {
      advance();
      tokens.push(makeToken("TILDE", "~", start, absOff(), l, co));
      continue;
    }

    // Identifiers / keywords
    if (isIdentStart(c0)) {
      const name = readIdent();
      const kind = KEYWORDS.has(name) ? "KEYWORD" : "IDENT";
      tokens.push(makeToken(kind, name, start, absOff(), l, co));
      continue;
    }

    // Multi-char operators (check longest first)
    let matched = false;
    for (const op of MULTI_OPS) {
      if (content.startsWith(op, pos)) {
        advance(op.length);
        tokens.push(makeToken("OPERATOR", op, start, absOff(), l, co));
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Single-char punctuation / operators
    if (/[(){}\[\],;.:\-+*/%^&|!=<>?]/.test(c0)) {
      advance();
      tokens.push(makeToken("PUNCT", c0, start, absOff(), l, co));
      continue;
    }

    // Anything else: skip (not a recognized token)
    advance();
  }

  tokens.push(makeToken("EOF", "", absOff(), absOff(), line, col));
  // §18.2 — demote `match` KEYWORD → IDENT wherever it is not a real
  // match-expression, so it can be used as an ordinary identifier (GITI-016).
  reclassifyContextualMatch(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// SQL block tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize the body of a SQL block (`?{...}`).
 *
 * The content is typically a template literal: `` ?{`SELECT ...`} ``.
 * We extract the query string. Chained method calls (`.all()`, `.first()`, etc.)
 * appear in the PARENT logic block's token stream after the BLOCK_REF for this
 * SQL block — they are handled by the logic block parser.
 *
 * `content` — body text between `?{` and `}`
 */
export function tokenizeSQL(content: string, baseOffset: number, baseLine: number, baseCol: number): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = baseLine;
  let col = baseCol;

  function absOff() { return baseOffset + pos; }
  function ch(n = 0) { return pos + n < content.length ? content[pos + n] : ""; }

  function advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (pos < content.length) {
        if (content[pos] === "\n") { line++; col = 1; }
        else { col++; }
        pos++;
      }
    }
  }

  function skipWs() {
    while (pos < content.length && /[ \t\r\n\f]/.test(content[pos])) advance();
  }

  skipWs();

  // Backtick-delimited SQL string
  if (ch() === "`") {
    const start = absOff();
    const l = line, c = col;
    advance(); // consume `
    let query = "";
    while (pos < content.length && ch() !== "`") {
      query += content[pos];
      advance();
    }
    if (ch() === "`") advance(); // consume closing `
    tokens.push(makeToken("SQL_RAW", query, start, absOff(), l, c));
  } else {
    // Non-backtick fallback: treat rest as raw
    const start = absOff();
    const l = line, c = col;
    let query = content.slice(pos).trim();
    advance(content.length - pos);
    tokens.push(makeToken("SQL_RAW", query, start, absOff(), l, c));
  }

  tokens.push(makeToken("EOF", "", absOff(), absOff(), line, col));
  return tokens;
}

// ---------------------------------------------------------------------------
// CSS block tokenizer
// ---------------------------------------------------------------------------

/**
 * Lookahead helper: we're positioned at `:` after reading an ident that could
 * be either an element selector (`button:hover { ... }`) or a property name
 * (`color: red;`). Scan forward from `:` for the earliest `{`, `;`, or `}`:
 *   `{` first → pseudo compound selector; continue reading as CSS_SELECTOR.
 *   `;` or `}` first → property declaration.
 * Returns true if this colon introduces a selector.
 */
function colonIntroducesSelector(content: string, colonPos: number): boolean {
  for (let p = colonPos + 1; p < content.length; p++) {
    const c = content[p];
    if (c === "{") return true;
    if (c === ";" || c === "}") return false;
  }
  return false;
}

/**
 * Lookahead helper (GITI-007): disambiguate `nav a { ... }` (descendant
 * combinator selector) from `foo bar;` (malformed property value). Scan
 * forward for `{`, `;`, `}`; `{` first means we're in a selector rule.
 * Returns true if a `{` appears before the next statement terminator.
 */
function hasBraceBeforeSemiOrRbrace(content: string, startPos: number): boolean {
  for (let p = startPos; p < content.length; p++) {
    const c = content[p];
    if (c === "{") return true;
    if (c === ";" || c === "}") return false;
  }
  return false;
}

/**
 * Tokenize the body of a CSS inline block (`#{...}`).
 *
 * The body contains CSS property declarations and/or selector rules.
 * We produce CSS_PROP, CSS_COLON, CSS_VALUE, CSS_SEMI, CSS_LBRACE, and CSS_RBRACE tokens.
 *
 * Selector detection handles three forms:
 *   - Class/id/pseudo/combinator selectors starting with . # * [ > + ~ — always CSS_SELECTOR
 *   - Bare element selectors (e.g. body, div, h1) — identifier followed by { — CSS_SELECTOR
 *   - Compound element selectors (e.g. a.foo, button:hover, h1, h2) — ident followed by
 *     a selector-continuation char (`.`, `#`, `[`, `,`, `>`, `+`, `~`, `*`) or by `:`
 *     when the `:` resolves to a pseudo (first `{` before `;`/`}`) — CSS_SELECTOR
 *   - Property declarations — identifier followed by : resolving to a value — CSS_PROP
 */
export function tokenizeCSS(content: string, baseOffset: number, baseLine: number, baseCol: number): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = baseLine;
  let col = baseCol;

  function absOff() { return baseOffset + pos; }
  function ch(n = 0) { return pos + n < content.length ? content[pos + n] : ""; }

  function advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (pos < content.length) {
        if (content[pos] === "\n") { line++; col = 1; }
        else { col++; }
        pos++;
      }
    }
  }

  function skipWs() {
    while (pos < content.length && /[ \t\r\n\f]/.test(content[pos])) advance();
  }

  while (pos < content.length) {
    skipWs();
    if (pos >= content.length) break;

    // Comment
    if (ch() === "/" && ch(1) === "*") {
      advance(2);
      while (pos < content.length && !(ch() === "*" && ch(1) === "/")) advance();
      if (pos < content.length) advance(2);
      continue;
    }

    // CSS at-rule: @import, @media, @keyframes, @font-face, @supports, @page, @layer, etc.
    // Statement at-rules (@import, @charset, @namespace) end at `;`.
    // Block at-rules (@media, @keyframes, @font-face, @supports, @page, @layer) have a
    // brace-delimited body. We capture the entire at-rule (prelude + body) as a single
    // CSS_AT_RULE token for verbatim passthrough (GITI-011).
    if (ch() === "@") {
      const start = absOff();
      const l = line, c = col;
      advance(); // skip @

      // Read the at-rule name (e.g. "media", "import", "keyframes")
      let name = "";
      while (pos < content.length && /[A-Za-z0-9_\-]/.test(content[pos])) {
        name += content[pos];
        advance();
      }

      if (!name) {
        // Bare `@` with no ident — skip it (degenerate input)
        continue;
      }

      // Statement at-rules: consume everything through `;`
      const statementAtRules = new Set(["import", "charset", "namespace"]);
      if (statementAtRules.has(name)) {
        let text = `@${name}`;
        while (pos < content.length && ch() !== ";") {
          text += content[pos];
          advance();
        }
        if (ch() === ";") {
          text += ";";
          advance();
        }
        tokens.push(makeToken("CSS_AT_RULE", text, start, absOff(), l, c));
        continue;
      }

      // Block at-rules: consume prelude, then brace-delimited body with depth tracking.
      // This handles nested braces in @keyframes (e.g. `from { ... } to { ... }` inside
      // the outer `@keyframes spin { ... }`).
      let text = `@${name}`;
      // Consume prelude (everything before the opening `{`)
      while (pos < content.length && ch() !== "{" && ch() !== ";") {
        text += content[pos];
        advance();
      }
      if (ch() === ";") {
        // At-rule ended with `;` instead of `{` — treat as statement (e.g. @layer name;)
        text += ";";
        advance();
        tokens.push(makeToken("CSS_AT_RULE", text, start, absOff(), l, c));
        continue;
      }
      if (ch() === "{") {
        text += " {";
        advance(); // consume opening {
        let depth = 1;
        while (pos < content.length && depth > 0) {
          if (ch() === "{") depth++;
          else if (ch() === "}") depth--;
          if (depth > 0) {
            text += content[pos];
          }
          advance();
        }
        text += " }";
        tokens.push(makeToken("CSS_AT_RULE", text, start, absOff(), l, c));
        continue;
      }

      // No `{` or `;` found — emit what we have (degenerate/truncated input)
      tokens.push(makeToken("CSS_AT_RULE", text.trim(), start, absOff(), l, c));
      continue;
    }

    // Identifier: could be a CSS property name OR the start of an element-leading selector.
    // Disambiguation after reading the ident + skipWs():
    //   `{` → bare element selector (`body {`, `div {`)
    //   `.`, `#`, `[`, `,`, `>`, `+`, `~`, `*` → compound selector (`a.foo`, `h1, h2`, `ul > li`)
    //   `:` → ambiguous. Lookahead: if `{` appears before `;` or `}`, it's a pseudo selector
    //         (`button:hover { ... }`); otherwise a property declaration (`color: red;`).
    //   otherwise → property declaration (best-effort; degenerate input falls here).
    if (/[A-Za-z_\-]/.test(ch()) || (ch() === "-" && ch(1) === "-")) {
      const start = absOff();
      const l = line, c = col;
      let ident = "";
      while (pos < content.length && /[A-Za-z0-9_\-]/.test(content[pos])) {
        ident += content[pos];
        advance();
      }

      const beforeWs = pos;
      skipWs();
      const hadWs = pos > beforeWs;

      const nextCh = ch();
      const isCompoundSelectorChar =
        nextCh === "." || nextCh === "#" || nextCh === "[" || nextCh === "," ||
        nextCh === ">" || nextCh === "+" || nextCh === "~" || nextCh === "*";
      const isPseudoThenBrace = nextCh === ":" && colonIntroducesSelector(content, pos);
      // GITI-007: descendant combinator. `nav a { ... }` — after ident + ws,
      // another ident-start means the first ident was a selector, not a prop.
      // Only trigger when ws separated them (unspaced `nava` would be one ident
      // to the earlier loop anyway). Disambiguates from valueless-prop-followed-
      // by-next-rule (already malformed) by requiring a `{` before `;`/`}`
      // downstream.
      const isDescendantCombinator =
        hadWs && /[A-Za-z_\-]/.test(nextCh) && hasBraceBeforeSemiOrRbrace(content, pos);

      if (nextCh === "{") {
        // Bare element selector: `body {`, `div {`, `h1 {`, etc.
        // Emit CSS_SELECTOR; the `{` will be consumed as CSS_LBRACE in the next iteration.
        tokens.push(makeToken("CSS_SELECTOR", ident, start, absOff(), l, c));
      } else if (isCompoundSelectorChar || isPseudoThenBrace || isDescendantCombinator) {
        // Compound selector beginning with an element name. Consume through `{` or `}`
        // as one CSS_SELECTOR token. Examples: `a.foo`, `button:hover`, `h1, h2`, `ul > li`.
        // Preserve a single space after the ident if source had whitespace (descendant
        // combinator, selector-list separator, etc.); the continuation chars carry no
        // separator themselves (e.g. `a.foo` is unspaced).
        let sel = ident + (hadWs ? " " : "");
        while (pos < content.length && ch() !== "{" && ch() !== "}") {
          sel += content[pos];
          advance();
        }
        tokens.push(makeToken("CSS_SELECTOR", sel.trim(), start, absOff(), l, c));
      } else {
        // Property declaration: `color: red`, `font-size: 14px`, `--custom-prop: val`, etc.
        tokens.push(makeToken("CSS_PROP", ident, start, absOff(), l, c));

        if (ch() === ":") {
          const cs = absOff();
          const cl = line, cc = col;
          advance();
          tokens.push(makeToken("CSS_COLON", ":", cs, absOff(), cl, cc));

          skipWs();

          // Value: everything up to `;` or `}`
          const vs = absOff();
          const vl = line, vc = col;
          let value = "";
          while (pos < content.length && ch() !== ";" && ch() !== "}") {
            value += content[pos];
            advance();
          }
          tokens.push(makeToken("CSS_VALUE", value.trim(), vs, absOff(), vl, vc));

          if (ch() === ";") {
            const ss = absOff();
            const sl = line, sc = col;
            advance();
            tokens.push(makeToken("CSS_SEMI", ";", ss, absOff(), sl, sc));
          }
        }
      }
      continue;
    }

    // Selector characters: class (.foo), id (#bar), universal (*), attribute ([attr]),
    // child (>), adjacent (+), sibling (~), pseudo (:root, :hover, ::before).
    // These always start a CSS_SELECTOR token.
    if (/[\.#\*\[>+~:]/.test(ch())) {
      const start = absOff();
      const l = line, c = col;
      let sel = "";
      while (pos < content.length && ch() !== "{" && ch() !== "}") {
        sel += content[pos];
        advance();
      }
      tokens.push(makeToken("CSS_SELECTOR", sel.trim(), start, absOff(), l, c));
      continue;
    }

    // Brace tokens: open and close braces in selector rules
    if (ch() === "{") {
      const s = absOff();
      const bl = line, bc = col;
      advance();
      tokens.push(makeToken("CSS_LBRACE", "{", s, absOff(), bl, bc));
      continue;
    }

    if (ch() === "}") {
      const s = absOff();
      const bl = line, bc = col;
      advance();
      tokens.push(makeToken("CSS_RBRACE", "}", s, absOff(), bl, bc));
      continue;
    }

    advance(); // skip unrecognized chars
  }

  tokens.push(makeToken("EOF", "", absOff(), absOff(), line, col));
  return tokens;
}

// ---------------------------------------------------------------------------
// Error effect block tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize the body of an error-effect block (`!{...}`).
 *
 * The body contains match arms: `| ::TypeA e -> handler`
 * We reuse the logic tokenizer.
 */
export function tokenizeError(content: string, baseOffset: number, baseLine: number, baseCol: number): Token[] {
  return tokenizeLogic(content, baseOffset, baseLine, baseCol, []);
}

// ---------------------------------------------------------------------------
// Text and comment passthrough
// ---------------------------------------------------------------------------

/**
 * Produce a minimal single-token stream for text and comment blocks.
 */
export function tokenizePassthrough(blockType: 'text' | 'comment', raw: string, baseOffset: number, baseLine: number, baseCol: number): Token[] {
  const kind = blockType === "comment" ? "COMMENT" : "TEXT";
  return [
    makeToken(kind, raw, baseOffset, baseOffset + raw.length, baseLine, baseCol),
    makeToken("EOF", "", baseOffset + raw.length, baseOffset + raw.length, baseLine, baseCol),
  ];
}

// ---------------------------------------------------------------------------
// Dispatcher: choose the right tokenizer for each block kind
// ---------------------------------------------------------------------------

/**
 * Tokenize a single Block from the Block Splitter output.
 *
 * The `block.raw` string includes the delimiters (e.g., `${` and `}`).
 * We strip those delimiters to get the body content.
 *
 * `block` — a Block from BS output
 * `filePath` — source file path (for error context; reserved for future use)
 */
export function tokenizeBlock(block: Block, filePath: string): Token[] {
  const { type, raw, span } = block;
  const baseOffset = span.start;
  const baseLine = span.line ?? 1;
  const baseCol = span.col ?? 1;

  switch (type) {
    case "markup":
    case "state":
      return tokenizeAttributes(raw, baseOffset, baseLine, baseCol, type as 'markup' | 'state');

    case "logic": {
      // Strip `${` prefix and `}` suffix to get body
      const body = raw.slice(2, raw.length - 1);
      return tokenizeLogic(body, baseOffset + 2, baseLine, baseCol + 2, block.children ?? []);
    }

    case "meta": {
      // Strip `^{` prefix and `}` suffix
      const body = raw.slice(2, raw.length - 1);
      return tokenizeLogic(body, baseOffset + 2, baseLine, baseCol + 2, block.children ?? []);
    }

    case "sql": {
      // Strip `?{` prefix and `}` suffix
      const body = raw.slice(2, raw.length - 1);
      return tokenizeSQL(body, baseOffset + 2, baseLine, baseCol + 2);
    }

    case "css": {
      // Strip `#{` prefix and `}` suffix
      const body = raw.slice(2, raw.length - 1);
      return tokenizeCSS(body, baseOffset + 2, baseLine, baseCol + 2);
    }

    case "error-effect": {
      // Strip `!{` prefix and `}` suffix
      const body = raw.slice(2, raw.length - 1);
      return tokenizeError(body, baseOffset + 2, baseLine, baseCol + 2);
    }

    case "test": {
      // Strip `~{` prefix and `}` suffix — reuse the logic-context tokenizer.
      // Test content is logic-like: identifiers, strings, operators, braces.
      // The test body parser (parseTestBody in ast-builder.js) processes the
      // token stream to extract test "name" { } blocks and assert statements.
      const body = raw.slice(2, raw.length - 1);
      return tokenizeLogic(body, baseOffset + 2, baseLine, baseCol + 2, block.children ?? []);
    }
    case "text":
    case "comment":
      return tokenizePassthrough(type as 'text' | 'comment', raw, baseOffset, baseLine, baseCol);

    default:
      // Unknown block type — return empty stream with EOF
      return [makeToken("EOF", "", baseOffset, baseOffset, baseLine, baseCol)];
  }
}
