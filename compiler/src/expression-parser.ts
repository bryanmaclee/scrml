/**
 * Expression Parser — Acorn-based structured expression parsing for scrml.
 *
 * Provides ESTree AST nodes for JS expressions embedded in scrml contexts.
 * Uses acorn with a minimal plugin to handle the `@` reactive variable sigil.
 *
 * This is Phase 1 of the compiler restructure: expressions are parsed to trees
 * instead of manipulated as raw strings. The tree representation eliminates
 * the need for regex-based string scanning (extractIdentifiers, extractReactiveDeps)
 * and will eventually replace the rewriteExpr chain (Phase 2).
 *
 * @module expression-parser
 */

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";
// @ts-ignore — astring ships its own types
import { generate as astringGenerate } from "astring";
// GITI-017 (S125): shared regex/comment/string fence. preprocessForAcorn's
// `not `→`!` lowering must skip regex-literal / comment / string interiors or
// it corrupts `/not a jj repo/i` → `/!a jj repo/i` (silent-corruption class).
import { rewriteCodeSegments } from "./codegen/code-segments.ts";

import type {
  ExprNode, ExprSpan,
  IdentExpr, LitExpr, ArrayExpr, ObjectExpr, ObjectProp, SpreadExpr,
  UnaryExpr, BinaryExpr, AssignExpr, TernaryExpr,
  MemberExpr, IndexExpr, CallExpr, NewExpr,
  LambdaExpr, LambdaParam,
  CastExpr, MatchExpr, MapLitExpr, MapEntry, SqlRefExpr, InputStateRefExpr, EscapeHatchExpr,
  ResetExpr,
} from "./types/ast.ts";

// ---------------------------------------------------------------------------
// ESTree types (minimal local definitions — acorn provides runtime shapes)
// ---------------------------------------------------------------------------

/** A minimal ESTree node. All nodes have a `type` string discriminant. */
export interface ESNode {
  type: string;
  [key: string]: unknown;
}

/** Return type for parseExpression / parseStatements. */
export interface ParseResult {
  ast: ESNode | null;
  error: string | null;
  /** Non-empty trailing content after the parsed expression (silent data loss detection). */
  trailingContent?: string;
  /**
   * F-SQL-001: structured diagnostic raised when `?{...}` SQL block scanning
   * fails (unbalanced braces, unterminated template literal). Carries the
   * error code so callers can surface it as a hard compile error (E-SQL-008).
   */
  sqlDiagnostic?: { code: string; message: string; offset: number };
  /**
   * B1 (g-unary-left-of-exponent-no-paren) — structured diagnostic raised when
   * acorn REJECTS an expression because a UNARY operator sits immediately to the
   * left of `**` (e.g. `-@a ** 2`). The JS exponentiation grammar forbids an
   * un-parenthesized unary base (`-a ** 2` is a SyntaxError; only `(-a) ** 2` or
   * `-(a ** 2)` parse). Such an expression fell back to the string-rewrite path,
   * which re-emitted the flat `- … ** 2` form — SILENTLY-invalid JS. Callers
   * surface this as a LOUD E-CODEGEN-INVALID-LOGIC (the AST-path twin is handled by
   * binaryOperandNeedsParens; this is the acorn-fallback complement).
   */
  exponentDiagnostic?: { code: string; message: string; offset: number };
  /**
   * g-fn-shortform-arrow-callback-invalid-js — structured diagnostic raised when
   * acorn REJECTS an expression because the `fn` keyword is followed by a
   * parenthesized param list and then an ARROW `=>` body (e.g.
   * `arr.map(fn(n) => n * 2)`). This mixes the two canonical anonymous-callable
   * forms: the BLOCK-body anonymous `fn` (`fn(args) { return … }`, §48.2.1) and
   * the plain inline lambda (`args => expr`). The mixed shape is not a sanctioned
   * scrml form; pre-fix it fell back to the string-rewrite path, where the blind
   * `\bfn\b`->`function` replace produced `function(n) => …` — invalid JS surfaced
   * as a misleading "compiler defect" E-CODEGEN-INVALID-LOGIC. Callers surface this
   * as a clean E-FN-ARROW-BODY syntax error that steers to the two valid forms.
   */
  fnArrowDiagnostic?: { code: string; message: string; offset: number };
}

/** Return type for rewriteReactiveRefsAST / rewriteServerReactiveRefsAST. */
export interface RewriteResult {
  result: string;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Acorn plugin: handle @ sigil as part of identifiers
// ---------------------------------------------------------------------------

/**
 * Acorn plugin that makes `@` a valid identifier-start character.
 * `@count` parses as Identifier { name: "@count" }.
 */
// @ts-ignore — acorn plugin API uses dynamic class extension not captured in types
function scrmlAtPlugin(Parser: typeof acorn.Parser) {
  // @ts-ignore
  return class extends Parser {
    readToken(code: number) {
      // 64 = '@'
      if (code === 64) {
        // Peek ahead: only consume @ as identifier if followed by a valid
        // identifier start char (letter, _, $). Otherwise let acorn handle it
        // (it will likely error, which is correct for bare @ or @123).
        // @ts-ignore
        const next = this.input.charCodeAt(this.pos + 1);
        // §17.7.3 — the `@.` contextual iteration sigil ("the current iteration
        // value"). `@` followed by `.` is NOT an identifier-start, so the bare
        // peek below would let acorn choke on it (escape-hatch ParseError for
        // `@.` / `@.field` fed to parseExprToNode — the ExprNode layer could not
        // structure the sigil; the each-body markup path lowers `@.` via a
        // separate string-rewrite in emit-lift, and E-SYNTAX-064 is enforced by
        // the type-system token scan — both independent of this parse). Consume
        // `@.` plus an optional immediately-following field name as ONE name
        // token: `@.` → "@.", `@.field` → "@.field", chained `@.a.b` → "@.a"
        // here then acorn handles `.b` as member access, `@.items[0]` → "@.items"
        // then computed member. Whether `@.` is legal at this locus (inside an
        // `<each>` body) is decided downstream by E-SYNTAX-064 — this layer's job
        // is only to STRUCTURE the valid-scrml sigil instead of escape-hatching.
        //
        // INLINE-WS-tolerant: the block-splitter join path emits expression text
        // with whitespace around tokens, so a source `@.name` reaches here as
        // `@ . name`. Non-destructive lookahead from just after `@` skips inline
        // ws (space/tab only — never a newline) to find the `.`; if present this
        // is the sigil and `this.pos` is advanced past the `.` + trailing ws to
        // the field. (readToken never fires inside string/comment interiors —
        // acorn handles those separately — so this absorbs only real code ws.)
        // @ts-ignore
        let _look = this.pos + 1;
        // @ts-ignore
        while (this.input.charCodeAt(_look) === 32 || this.input.charCodeAt(_look) === 9) _look++;
        // @ts-ignore
        if (this.input.charCodeAt(_look) === 46) { // '.'
          _look++; // past '.'
          // @ts-ignore
          while (this.input.charCodeAt(_look) === 32 || this.input.charCodeAt(_look) === 9) _look++;
          // @ts-ignore
          this.pos = _look;
          // @ts-ignore
          const after = this.input.charCodeAt(this.pos);
          const fieldStart = (after >= 65 && after <= 90)   // A-Z
            || (after >= 97 && after <= 122)                 // a-z
            || after === 95 || after === 36;                 // _ or $
          let field = "";
          if (fieldStart) {
            // @ts-ignore
            field = this.readWord1();
          }
          // @ts-ignore
          return this.finishToken(acorn.tokTypes.name, "@." + field);
        }
        const isIdentStart = (next >= 65 && next <= 90)  // A-Z
          || (next >= 97 && next <= 122)                   // a-z
          || next === 95 || next === 36;                   // _ or $
        if (isIdentStart) {
          // @ts-ignore
          this.pos++;
          // @ts-ignore
          const word = this.readWord1();
          // @ts-ignore
          return this.finishToken(acorn.tokTypes.name, "@" + word);
        }
      }
      // @ts-ignore
      return super.readToken(code);
    }
  };
}

/**
 * Acorn plugin that handles `::` enum variant access.
 * Transforms `Type::Variant` by reading it as a single string token.
 * Without this, acorn would choke on `::` which is not valid JS.
 */
// @ts-ignore — acorn plugin API uses dynamic class extension not captured in types
function scrmlEnumPlugin(Parser: typeof acorn.Parser) {
  // @ts-ignore
  return class extends Parser {
    readToken(code: number) {
      // 58 = ':'
      // @ts-ignore
      if (code === 58 && this.input.charCodeAt(this.pos + 1) === 58) {
        // Read Type::Variant as a special identifier
        // @ts-ignore
        this.pos += 2; // skip ::
        // @ts-ignore
        const variant = this.readWord1();
        // Emit as a string literal containing the variant name
        // @ts-ignore
        return this.finishToken(acorn.tokTypes.string, variant);
      }
      // @ts-ignore
      return super.readToken(code);
    }
  };
}

// @ts-ignore
const ScrmlParser = acorn.Parser.extend(scrmlAtPlugin, scrmlEnumPlugin);

// ---------------------------------------------------------------------------
// SQL placeholder scanner (F-SQL-001)
// ---------------------------------------------------------------------------

/**
 * Result of replaceSqlBlockPlaceholder — the rewritten string with `?{...}`
 * SQL blocks replaced by `__scrml_sql_placeholder__`, plus an optional
 * diagnostic if a `?{` opener was found without a matching `}`.
 *
 * F-SQL-001 root cause: the prior regex `/\?\{[^}]*\}/g` could not handle
 * `?{...${expr}...}` because `[^}]*` stops at the first `}` (the inner
 * `${}` interpolation's close brace). This function performs a proper
 * bracket-matched scan that respects template-literal boundaries.
 */
interface SqlPlaceholderResult {
  result: string;
  /**
   * If a `?{` opener was found without a matching `}`, this carries the
   * source offset and a human-readable message. Surfaced as E-SQL-008
   * by callers.
   */
  unbalanced?: { offset: number; message: string };
}

/**
 * Scan `input` for `?{...}` SQL blocks and replace each with
 * `__scrml_sql_placeholder__`. Bracket-matched: respects template-literal
 * boundaries (backticks) and tracks `{`/`}` nesting inside the SQL block,
 * so embedded `${expr}` interpolations are consumed correctly.
 *
 * @param input the source-like string passed through preprocessing
 * @returns SqlPlaceholderResult — `result` is the rewritten string;
 *   `unbalanced` is set if a `?{` had no matching `}`.
 */
function replaceSqlBlockPlaceholder(input: string): SqlPlaceholderResult {
  let out = "";
  let i = 0;
  const n = input.length;
  let unbalanced: { offset: number; message: string } | undefined;

  // Mode stack — top of stack is the current lexical context.
  //   "js"        : JS expression context. `{`/`}` track block/object depth.
  //                 `\`` opens a template literal. `'`/`"` open quoted strings.
  //   "template"  : template literal body. `${` opens a nested JS context;
  //                 `\`` closes the template (back to the context one below).
  //   "single"    : single-quoted string. `\\` escapes; `'` closes.
  //   "double"    : double-quoted string. `\\` escapes; `"` closes.
  //
  // The outer `?{` SQL block is treated as a "js" context entered with depth=1.
  // When the enclosing `js` context's depth returns to 0, the SQL block is
  // closed.
  type Frame = { kind: "js"; depth: number } | { kind: "template" } | { kind: "single" } | { kind: "double" };

  while (i < n) {
    const ch = input[i];

    // Look for `?{` SQL block opener.
    if (ch === "?" && input[i + 1] === "{") {
      const sqlStart = i;
      i += 2; // consume ?{
      const stack: Frame[] = [{ kind: "js", depth: 1 }];
      let closed = false;
      while (i < n && stack.length > 0) {
        const top = stack[stack.length - 1];
        const c = input[i];

        if (top.kind === "single") {
          if (c === "\\") { i += 2; continue; }
          if (c === "'") { stack.pop(); i++; continue; }
          i++;
          continue;
        }
        if (top.kind === "double") {
          if (c === "\\") { i += 2; continue; }
          if (c === "\"") { stack.pop(); i++; continue; }
          i++;
          continue;
        }
        if (top.kind === "template") {
          if (c === "\\") { i += 2; continue; }
          if (c === "`") { stack.pop(); i++; continue; }
          if (c === "$" && input[i + 1] === "{") {
            // Open nested JS context inside the template interpolation.
            stack.push({ kind: "js", depth: 1 });
            i += 2;
            continue;
          }
          i++;
          continue;
        }
        // top.kind === "js"
        if (c === "`") { stack.push({ kind: "template" }); i++; continue; }
        if (c === "'") { stack.push({ kind: "single" }); i++; continue; }
        if (c === "\"") { stack.push({ kind: "double" }); i++; continue; }
        if (c === "{") { top.depth++; i++; continue; }
        if (c === "}") {
          top.depth--;
          i++;
          if (top.depth === 0) {
            stack.pop();
            // If the popped frame was the outermost SQL `?{` js-frame,
            // the entire SQL block is closed.
            if (stack.length === 0) { closed = true; break; }
          }
          continue;
        }
        i++;
      }
      if (!closed) {
        if (!unbalanced) {
          unbalanced = {
            offset: sqlStart,
            message:
              "E-SQL-008: `?{` SQL block has no matching `}` — unterminated SQL template " +
              "(possibly a missing closing brace, unterminated backtick template literal, " +
              "or unmatched `${` interpolation inside the SQL body).",
          };
        }
      }
      out += "__scrml_sql_placeholder__";
      continue;
    }
    out += ch;
    i++;
  }

  return unbalanced ? { result: out, unbalanced } : { result: out };
}

// ---------------------------------------------------------------------------
// Parse utilities
// ---------------------------------------------------------------------------

/**
 * B1 (g-unary-left-of-exponent-no-paren) — detect the JS-grammar violation where
 * a UNARY operator sits immediately left of `**`, which acorn rejects with the
 * error position landing exactly on the `**` token.
 *
 *   ExponentiationExpression :
 *       UnaryExpression
 *     | UpdateExpression ** ExponentiationExpression
 *
 * `-a ** 2`, `!flag ** 2`, `typeof a ** 2`, `-foo.bar() ** 2` are all SyntaxErrors
 * (only `(-a) ** 2` / `-(a ** 2)` parse). UPDATE operators (`++`/`--`) ARE valid
 * `**` bases, so `x-- ** 2` is excluded. A parenthesized base `(...)` is skipped
 * wholesale by the operand walk, so the author-paren form is never flagged.
 *
 * @param src - the EXACT string acorn parsed (post internal preprocessing).
 * @param pos - acorn's error offset (`err.pos`).
 * @returns the structured diagnostic, or null when this is not the unary-`**` shape.
 */
function detectUnaryLeftOfExponent(
  src: string,
  pos: number | undefined,
): { code: string; message: string; offset: number } | null {
  if (typeof pos !== "number" || pos < 1) return null;
  if (src.slice(pos, pos + 2) !== "**") return null;

  // Walk left from the `**` over whitespace, then over the base operand
  // (idents / numbers / member dots / `@` sigil + balanced call/index tails).
  let i = pos - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0) return null; // leading `**` — a different malformed shape, out of scope
  while (i >= 0) {
    const c = src[i];
    if (/[A-Za-z0-9_$.@]/.test(c)) { i--; continue; }
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      let depth = 1;
      i--;
      while (i >= 0 && depth > 0) {
        if (src[i] === c) depth++;
        else if (src[i] === open) depth--;
        i--;
      }
      continue;
    }
    break;
  }
  // `i` now sits just before the base's first char. Skip whitespace; if the
  // preceding token is a PREFIX unary operator the base is un-parenthesized
  // unary → the grammar violation.
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0) return null; // base is at the expression start — no prefix unary
  const c = src[i];
  let isUnary = false;
  if (c === "!" || c === "~") {
    isUnary = true; // no binary `!`/`~` exists — always prefix
  } else if (c === "-" || c === "+") {
    // Exclude the update operators `--`/`++` (valid `**` bases); confirm the
    // `-`/`+` is in PREFIX position (not a binary subtraction/addition).
    if (i - 1 >= 0 && (src[i - 1] === "-" || src[i - 1] === "+")) isUnary = false;
    else {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      isUnary = j < 0 || !/[A-Za-z0-9_$)\].@]/.test(src[j]);
    }
  } else if (/(?:^|[^A-Za-z0-9_$])(?:typeof|void|delete|await)$/.test(src.slice(0, i + 1))) {
    isUnary = true;
  }
  if (!isUnary) return null;

  return {
    code: "E-CODEGEN-INVALID-LOGIC",
    message:
      "E-CODEGEN-INVALID-LOGIC: a unary operator immediately left of `**` is invalid " +
      "\u2014 the exponentiation grammar forbids an un-parenthesized unary " +
      "base. Parenthesize the base: write `(-@a) ** 2` (negate, then square).",
    offset: pos,
  };
}

/**
 * g-fn-shortform-arrow-callback-invalid-js — detect the invalid scrml form where
 * the `fn` keyword is followed by a parenthesized param list and then an ARROW
 * `=>` body (e.g. `arr.map(fn(n) => n * 2)`). acorn rejects this at the `=>` (it
 * parses `fn(n)` as a CALL expression, then the `=>` is unexpected), with the
 * error position landing exactly on the `=>` token — the same anchor strategy as
 * detectUnaryLeftOfExponent.
 *
 * `fn(args) => expr` mixes the two canonical anonymous-callable forms:
 *   - the BLOCK-body anonymous `fn`:  `fn(args) { return expr }`  (§48.2.1)
 *   - the plain inline lambda:        `args => expr`
 * None of the valid siblings false-fire here:
 *   - `fn(args) { … }` parses as a call `fn(args)` (acorn does NOT reject) so this
 *     detector never runs on it.
 *   - `args => expr` / `(x) => x*2` has no `fn` keyword left of the param list.
 *   - `fn(args) -> T { … }` (return-type, brace body) rejects at `->`, not `=>`,
 *     so the `=>`-at-`pos` guard short-circuits.
 *   - `obj.fn(x) => …` is a member call (`.fn`) — the keyword guard excludes an
 *     `fn` preceded by `.`/`@`/identifier chars.
 *   - a `fn(x)=>` inside a STRING in an otherwise-valid expression never reaches
 *     this path (acorn succeeds, so the catch block is not entered).
 *
 * @param src - the EXACT string acorn parsed (post internal preprocessing).
 * @param pos - acorn's error offset (`err.pos`).
 * @returns the structured diagnostic, or null when this is not the `fn`-arrow shape.
 */
function detectFnKeywordArrowBody(
  src: string,
  pos: number | undefined,
): { code: string; message: string; offset: number } | null {
  if (typeof pos !== "number" || pos < 1) return null;
  if (src.slice(pos, pos + 2) !== "=>") return null;

  // Walk left from `=>` over whitespace; the param list must close with `)`.
  let i = pos - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0 || src[i] !== ")") return null;

  // Walk the balanced parameter parens leftward to the matching `(`.
  let depth = 1;
  i--;
  while (i >= 0 && depth > 0) {
    if (src[i] === ")") depth++;
    else if (src[i] === "(") depth--;
    i--;
  }
  if (depth !== 0) return null; // unbalanced — not a clean param list

  // `i` now sits just before the `(`. Skip whitespace; the token immediately
  // left of the param list must be the `fn` KEYWORD (word-boundary; not a member
  // `.fn` and not the tail of a longer identifier like `myfn` / `fnButton`).
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 1) return null;
  if (src[i] !== "n" || src[i - 1] !== "f") return null;
  const beforeKw = i - 2;
  if (beforeKw >= 0 && /[A-Za-z0-9_$.@]/.test(src[beforeKw])) return null;

  return {
    code: "E-FN-ARROW-BODY",
    message:
      "E-FN-ARROW-BODY: `fn(args) => expr` is not a valid scrml form — it mixes " +
      "the `fn` keyword with an arrow body. For an inline lambda use `args => expr`; " +
      "for a named-style anonymous function use `fn(args) { return expr }` (§48.2.1).",
    offset: i - 1,
  };
}

/**
 * Parse a single JS expression string into an ESTree node.
 */
export function parseExpression(raw: string, opts: { tolerant?: boolean } = {}): ParseResult {
  const { tolerant = true } = opts;
  if (!raw || typeof raw !== "string") return { ast: null, error: "empty expression" };

  // Pre-process: strip scrml-specific constructs that acorn can't handle
  let processed = raw.trim();

  // F-SQL-001: replace ?{...} SQL blocks with a placeholder identifier using
  // a bracket-matched scanner (handles ?{`...${expr}...`} correctly).
  const sqlScan = replaceSqlBlockPlaceholder(processed);
  processed = sqlScan.result;

  // Handle <#id>.send() worker refs — replace with placeholder before input state refs
  processed = processed.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*send\s*\(/g, "__scrml_worker_$1__.send(");
  // Handle <#id> input state refs — replace with placeholder
  processed = processed.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, "__scrml_input_$1__");

  // F-SQL-001: if the SQL scanner found an unbalanced `?{` opener, surface
  // it as a hard error (E-SQL-008). Callers (parseExprToNode, ast-builder)
  // pick this up via ParseResult.sqlDiagnostic and convert to a TABError.
  const sqlDiag = sqlScan.unbalanced
    ? { code: "E-SQL-008", message: sqlScan.unbalanced.message, offset: sqlScan.unbalanced.offset }
    : undefined;

  try {
    // @ts-ignore
    const ast = ScrmlParser.parseExpressionAt(processed, 0, {
      ecmaVersion: 2025,
      sourceType: "module",
      allowAwaitOutsideFunction: true,
    }) as ESNode;
    // Trailing-content detection: if parseExpressionAt didn't consume the full
    // string, there is content that would be silently dropped.
    const trailing = processed.slice((ast as any).end).trim();
    return { ast, error: null, trailingContent: trailing || undefined, ...(sqlDiag ? { sqlDiagnostic: sqlDiag } : {}) };
  } catch (err) {
    const e = err as Error & { pos?: number };
    // B1: when acorn fails specifically because a unary operator is the LEFT
    // operand of `**`, surface a structured diagnostic so callers can fire a
    // LOUD E-CODEGEN-INVALID-LOGIC instead of silently emitting invalid JS.
    const exponentDiagnostic = detectUnaryLeftOfExponent(processed, e.pos);
    // g-fn-shortform-arrow-callback-invalid-js: acorn also rejects `fn(args) => …`
    // (the `fn` keyword + an arrow body). Surface a clean E-FN-ARROW-BODY rather
    // than letting the string-rewrite path emit `function(args) => …` (invalid JS
    // mis-framed as a compiler defect). The two diagnostics anchor on different
    // tokens (`**` vs `=>`) so at most one fires.
    const fnArrowDiagnostic = detectFnKeywordArrowBody(processed, e.pos);
    if (tolerant) return { ast: null, error: e.message, ...(sqlDiag ? { sqlDiagnostic: sqlDiag } : {}), ...(exponentDiagnostic ? { exponentDiagnostic } : {}), ...(fnArrowDiagnostic ? { fnArrowDiagnostic } : {}) };
    throw err;
  }
}

/**
 * Parse a multi-statement JS body into an ESTree Program node.
 */
export function parseStatements(raw: string, opts: { tolerant?: boolean } = {}): ParseResult {
  const { tolerant = true } = opts;
  if (!raw || typeof raw !== "string") return { ast: null, error: "empty body" };

  let processed = raw.trim();
  // F-SQL-001: bracket-matched ?{} placeholder replacement (see replaceSqlBlockPlaceholder).
  const sqlScan = replaceSqlBlockPlaceholder(processed);
  processed = sqlScan.result;
  // Handle <#id>.send() worker refs — replace with placeholder before input state refs
  processed = processed.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*send\s*\(/g, "__scrml_worker_$1__.send(");
  processed = processed.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, "__scrml_input_$1__");

  const sqlDiag = sqlScan.unbalanced
    ? { code: "E-SQL-008", message: sqlScan.unbalanced.message, offset: sqlScan.unbalanced.offset }
    : undefined;

  try {
    // @ts-ignore
    const ast = ScrmlParser.parse(processed, {
      ecmaVersion: 2025,
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as ESNode;
    return { ast, error: null, ...(sqlDiag ? { sqlDiagnostic: sqlDiag } : {}) };
  } catch (err) {
    if (tolerant) return { ast: null, error: (err as Error).message, ...(sqlDiag ? { sqlDiagnostic: sqlDiag } : {}) };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// AST walking utilities
// ---------------------------------------------------------------------------

/** Visitor function type for walk(). */
export type WalkVisitor = (node: ESNode, parent: ESNode | null) => void;

/**
 * Simple ESTree walker. Calls `visitor(node, parent)` for every node.
 */
export function walk(node: ESNode | null | undefined, visitor: WalkVisitor, parent: ESNode | null = null): void {
  if (!node || typeof node !== "object") return;
  visitor(node, parent);

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof (item as ESNode).type === "string") {
            walk(item as ESNode, visitor, node);
          }
        }
      } else if (typeof (child as ESNode).type === "string") {
        walk(child as ESNode, visitor, node);
      }
    }
  }
}

/**
 * Extract all identifier names from an expression, excluding:
 * - Property accesses (x.prop — prop is excluded)
 * - Function parameter declarations
 * - Object literal keys
 *
 * This is the structured replacement for the regex-based extractIdentifiers
 * in meta-checker.ts.
 */
export function extractIdentifiersFromAST(expr: string): string[] {
  const { ast } = parseExpression(expr);
  if (!ast) {
    // Fallback: try as statements
    const stmts = parseStatements(expr);
    if (!stmts.ast) return [];
    return extractIdentifiersFromNode(stmts.ast);
  }
  return extractIdentifiersFromNode(ast);
}

/**
 * Recursively collect all binding identifiers from a parameter pattern node.
 * Handles Identifier, ObjectPattern, ArrayPattern, RestElement, and AssignmentPattern.
 */
function collectBindingIdentifiers(node: ESNode, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      out.add(node.name as string);
      break;
    case "ObjectPattern":
      for (const prop of (node.properties as ESNode[] | undefined) ?? []) {
        if (prop.type === "RestElement") {
          collectBindingIdentifiers((prop as { argument?: ESNode }).argument as ESNode, out);
        } else if (prop.type === "Property") {
          collectBindingIdentifiers((prop as { value?: ESNode }).value as ESNode, out);
        }
      }
      break;
    case "ArrayPattern":
      for (const elem of (node.elements as (ESNode | null)[] | undefined) ?? []) {
        if (elem) collectBindingIdentifiers(elem, out);
      }
      break;
    case "RestElement":
      collectBindingIdentifiers((node as { argument?: ESNode }).argument as ESNode, out);
      break;
    case "AssignmentPattern":
      collectBindingIdentifiers((node as { left?: ESNode }).left as ESNode, out);
      break;
  }
}

/**
 * Extract identifiers from an ESTree node, excluding property accesses,
 * function params, and object keys.
 */
function extractIdentifiersFromNode(node: ESNode): string[] {
  const ids = new Set<string>();
  const declared = new Set<string>(); // function params, for-of iterators, etc.

  walk(node, (n, parent) => {
    // Collect function parameter declarations
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      for (const param of (n.params as ESNode[] | undefined) ?? []) {
        collectBindingIdentifiers(param, declared);
      }
    }

    // Collect for-of/for-in iterator declarations (including destructuring)
    if (n.type === "ForInStatement" || n.type === "ForOfStatement") {
      const left = n.left as ESNode | undefined;
      if (left?.type === "VariableDeclaration") {
        for (const decl of (left.declarations as ESNode[] | undefined) ?? []) {
          const id = (decl as { id?: ESNode }).id;
          if (id) collectBindingIdentifiers(id, declared);
        }
      }
    }

    // Collect variable declarations (including destructuring)
    if (n.type === "VariableDeclaration") {
      for (const decl of (n.declarations as ESNode[] | undefined) ?? []) {
        const id = (decl as { id?: ESNode }).id;
        if (id) collectBindingIdentifiers(id, declared);
      }
    }

    // Collect identifiers that are NOT property accesses or object keys
    if (n.type === "Identifier") {
      // Skip if this is a property access (x.prop — skip prop)
      if (parent?.type === "MemberExpression" && (parent as { property?: ESNode; computed?: boolean }).property === n && !(parent as { computed?: boolean }).computed) return;
      // Skip if this is an object key
      if (parent?.type === "Property" && (parent as { key?: ESNode; computed?: boolean }).key === n && !(parent as { computed?: boolean }).computed) return;
      ids.add(n.name as string);
    }
  });

  // Remove declared locals
  for (const d of declared) ids.delete(d);

  return [...ids];
}

/**
 * Extract reactive variable dependencies from an expression.
 * Finds all Identifier nodes whose name starts with `@`.
 */
export function extractReactiveDepsFromAST(expr: string, knownReactiveVars: Set<string> | null = null): Set<string> {
  const found = new Set<string>();

  const { ast } = parseExpression(expr);
  const target = ast || parseStatements(expr)?.ast;
  if (!target) return found;

  walk(target, (n, parent) => {
    if (n.type === "Identifier" && typeof n.name === "string" && n.name.startsWith("@")) {
      const varName = n.name.slice(1); // remove @
      // Validate: must be a valid JS identifier (starts with letter, _, $)
      if (!varName || !/^[A-Za-z_$]/.test(varName)) return;
      // Skip property access positions
      if (parent?.type === "MemberExpression" && (parent as { property?: ESNode; computed?: boolean }).property === n && !(parent as { computed?: boolean }).computed) return;
      if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
        found.add(varName);
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------------------
// ESTree → JS serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an ESTree node back to JavaScript source.
 */
export function astToJs(node: ESNode): string {
  // @ts-ignore — astring types don't perfectly align with acorn ESTree output
  return astringGenerate(node);
}

// ---------------------------------------------------------------------------
// Phase 2: AST-based expression rewrites
// ---------------------------------------------------------------------------

/**
 * Rewrite `@varName` reactive references to runtime getter calls using ESTree.
 *
 * Parses the expression with acorn, walks the tree to find @-prefixed Identifiers,
 * replaces them with CallExpression nodes for _scrml_reactive_get("varName") or
 * _scrml_derived_get("varName"), then serializes back to JS.
 *
 * This is the structured replacement for the regex-based rewriteReactiveRefs
 * in rewrite.js.
 */
export function rewriteReactiveRefsAST(expr: string, derivedNames: Set<string> | null = null): RewriteResult {
  if (!expr || typeof expr !== "string") return { result: expr, ok: false };

  // Quick check: if no @ in the expression, nothing to rewrite
  if (!expr.includes("@")) return { result: expr, ok: true };

  // If expression contains :: (enum syntax), ?{ (SQL sigil), or match keyword,
  // fall back to regex — acorn can't parse these scrml constructs correctly.
  // `match` is particularly dangerous: acorn parses it as an identifier and
  // silently skips the @var inside, returning ok:true with no rewrites.
  if (/::|\?\{|\bmatch\b|\bis\b/.test(expr)) return { result: expr, ok: false };

  // Try parsing as expression first, then as statements
  let { ast } = parseExpression(expr);
  if (!ast) {
    const stmts = parseStatements(expr);
    if (!stmts.ast) return { result: expr, ok: false };
    ast = stmts.ast;
  }

  const hasDerived = derivedNames && derivedNames.size > 0;
  let modified = false;

  // Walk and replace @var Identifiers in-place
  walk(ast, (node, parent) => {
    if (node.type !== "Identifier" || typeof node.name !== "string" || !node.name.startsWith("@")) return;

    const varName = node.name.slice(1);
    if (!varName || !/^[A-Za-z_$]/.test(varName)) return;

    // Skip property access positions (obj.@prop shouldn't happen, but guard)
    if (parent?.type === "MemberExpression" && (parent as { property?: ESNode; computed?: boolean }).property === node && !(parent as { computed?: boolean }).computed) return;

    // Determine which getter to use
    const getter = (hasDerived && derivedNames!.has(varName))
      ? "_scrml_derived_get"
      : "_scrml_reactive_get";

    // Replace the Identifier node in-place with a CallExpression
    // We mutate the node to become a CallExpression
    node.type = "CallExpression";
    node.callee = { type: "Identifier", name: getter };
    node.arguments = [{ type: "Literal", value: varName }];
    node.optional = false;
    delete node.name;
    modified = true;
  });

  if (!modified) return { result: expr, ok: true };

  try {
    const js = astToJs(ast);
    // astring adds trailing newline for Program nodes; strip it
    return { result: js.trim(), ok: true };
  } catch {
    return { result: expr, ok: false };
  }
}

/**
 * Rewrite `@varName` reactive references to server-side body lookups using ESTree.
 *
 * Server-side counterpart to rewriteReactiveRefsAST. Replaces @var with
 * `_scrml_body["varName"]` instead of `_scrml_reactive_get("varName")`.
 */
// §20.5 / §52 (S233) — `@currentUser` ambient-active flag for the AST server
// rewriter. Set per-file by the codegen driver (via rewrite.ts) to mirror
// emit-expr's `_currentUserAmbientActive`: TRUE iff no user `<currentUser>` cell
// shadows the name. Default FALSE (conservative — a `@currentUser` falls back to
// the request-body form unless the driver enables the ambient for this file).
let _currentUserAmbientActive = false;

/** Set the per-file `@currentUser` ambient-active flag (AST server rewriter). */
export function setParserCurrentUserAmbientActive(on: boolean): void {
  _currentUserAmbientActive = !!on;
}

export function rewriteServerReactiveRefsAST(expr: string): RewriteResult {
  if (!expr || typeof expr !== "string") return { result: expr, ok: false };
  if (!expr.includes("@")) return { result: expr, ok: true };
  if (/::|\?\{/.test(expr)) return { result: expr, ok: false };

  const parsed = parseExpression(expr);
  let ast = parsed.ast;
  // g-endpoint-at-led-arm-trailing-expr-dropped (ss49): parseExpression
  // (parseExpressionAt) consumes only the FIRST expression of a multi-statement
  // input and reports the remainder as `trailingContent`. Re-emitting just that
  // first expression would silently DROP every trailing statement — e.g. an
  // `@`-led `<endpoint>` arm body (`@cursor = seq + 1` followed by the intended
  // JSON return value) collapsed to the bare assignment, hiding the
  // multi-statement shape from the §61 `E-ENDPOINT-MULTI-STATEMENT-ARM` guard so
  // the arm's response value was lost with no diagnostic. Bail to the caller's
  // regex fallback, which rewrites `@`-refs across the WHOLE text and preserves
  // every statement, so the multi-statement body survives intact and is detected
  // — matching the non-`@` multi-statement bare-body behavior.
  if (ast && parsed.trailingContent) return { result: expr, ok: false };
  if (!ast) {
    const stmts = parseStatements(expr);
    if (!stmts.ast) return { result: expr, ok: false };
    ast = stmts.ast;
  }

  let modified = false;

  walk(ast, (node, parent) => {
    if (node.type !== "Identifier" || typeof node.name !== "string" || !node.name.startsWith("@")) return;
    const varName = node.name.slice(1);
    if (!varName || !/^[A-Za-z_$]/.test(varName)) return;
    if (parent?.type === "MemberExpression" && (parent as { property?: ESNode; computed?: boolean }).property === node && !(parent as { computed?: boolean }).computed) return;

    // §20.5 / §52 (S233) — `@currentUser` is the compiler-provided ambient
    // identity cell, resolved server-side from the session middleware and bound
    // as `_scrml_currentUser` at the handler's scope entry (emit-server). It is
    // NOT a client-supplied request-body field, so it lowers to that plain
    // identifier, never `_scrml_body["currentUser"]`.
    if (varName === "currentUser" && _currentUserAmbientActive) {
      node.type = "Identifier";
      node.name = "_scrml_currentUser";
      modified = true;
      return;
    }

    // Replace with _scrml_body["varName"] — a MemberExpression
    node.type = "MemberExpression";
    node.object = { type: "Identifier", name: "_scrml_body" };
    node.property = { type: "Literal", value: varName };
    node.computed = true;
    node.optional = false;
    delete node.name;
    modified = true;
  });

  if (!modified) return { result: expr, ok: true };

  try {
    return { result: astToJs(ast).trim(), ok: true };
  } catch {
    return { result: expr, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Phase 1: ExprNode conversion
// ---------------------------------------------------------------------------
// These functions implement the structured expression AST migration.
// Design doc: /scrml-support/docs/deep-dives/expression-ast-phase-0-design-2026-04-11.md
// ---------------------------------------------------------------------------

/**
 * Null span — used when we cannot determine a precise source span.
 * Callers with real offsets should pass them via parseExprToNode.
 */
function nullSpan(filePath: string): ExprSpan {
  return { file: filePath, start: 0, end: 0, line: 1, col: 1 };
}

/**
 * Construct an ExprSpan from an ESTree node's `start`/`end` positions
 * plus a base offset for the enclosing source region.
 */
function spanFromEstree(node: ESNode, filePath: string, baseOffset: number): ExprSpan {
  const start = (typeof node.start === "number" ? node.start : 0) + baseOffset;
  const end = (typeof node.end === "number" ? node.end : 0) + baseOffset;
  return { file: filePath, start, end, line: 1, col: 1 };
}

// ---------------------------------------------------------------------------
// Pre-processing scrml-specific forms before Acorn
// ---------------------------------------------------------------------------
//
// Acorn cannot parse scrml-specific operators: `is`, `is not`, `is some`,
// `is not not`, `is given`, `match { ... }`.
//
// Strategy: replace these with placeholder function calls that Acorn CAN parse,
// then convert those calls back to the correct ExprNode types in esTreeToExprNode.
//
// Placeholder scheme:
//   x is not not  → __scrml_is_not_not__(x)
//   x is not      → __scrml_is_not__(x)
//   x is some     → __scrml_is_some__(x)
//   x is given    → __scrml_is_some__(x)   (alias per OQ-9)
//   x is .Var     → __scrml_is_variant__(x, ".Var")
//   x is T.Var    → __scrml_is_variant__(x, "T.Var")
//
// Limitation: these replacements are regex-based and operate on the pre-processed
// string. They handle the common cases found in the examples corpus. Complex nested
// forms (multiple is operators) may not round-trip perfectly — those fire EscapeHatch.
//
// `match` expressions: replace entire `match expr { ... }` with
//   __scrml_match__(expr, "arm1", "arm2", ...)
// where each arm is a quoted string. The arm content is preserved verbatim.
// ---------------------------------------------------------------------------

const SCRML_PLACEHOLDER_PREFIX = "__scrml_";

// ---------------------------------------------------------------------------
// rewriteIsPredicates — structural scanner for `is some|given|not|not not|.V|T.V`
// ---------------------------------------------------------------------------
//
// Phase B (2026-05-17) replaces the brittle multi-pass regex chain of S99
// Phase A with a single left-to-right structural scanner. See the call site
// in preprocessForAcorn for the algorithmic rationale and the SPEC §42.2.4
// binding semantics this rewrite honors.
//
// Returns the input string with every `<lhs> is <suffix>` occurrence outside
// string literals replaced by the corresponding `__scrml_is_X__(<lhs>)` call.
//
// Honor-string-literals: the scanner tracks `"`, `'`, and `` ` `` interiors
// and skips them entirely (so `"x is not"` inside a string literal stays
// verbatim). Template-literal interpolations `${...}` are NOT scanned here —
// the outer expression-parser pipeline handles template literals by lifting
// interpolations into separate parseExprToNode calls, so the `is` operator
// inside `${...}` arrives in its own preprocessing pass.

/** Return the byte index of the matching open character for a balanced group ending at `s[end - 1]` (close). */
function findMatchingOpenLeft(s: string, end: number, open: string, close: string): number {
  // s[end - 1] is the closer (e.g. `)` or `]`). Scan back to its opener.
  // We rely on the assumption that the input has well-formed bracket structure;
  // pathological inputs route through the escape-hatch path downstream.
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const c = s[i];
    if (c === close) depth++;
    else if (c === open) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Scan leftward from `isStart` (the index of the `i` of the `is` keyword)
 * to find the LHS predicate-target extent. Returns the byte index of the
 * start of the LHS (inclusive), or -1 if no valid LHS is found.
 *
 * The LHS grammar (per SPEC §42.2.4 — any valid expression target):
 *   LHS    := Base (Tail)*
 *   Base   := @? Ident                            (bare ident — required for
 *                                                  bare-form `x is some`)
 *           | ( Expr )                            (paren grouping — explicit
 *                                                  Phase A form `(expr) is X`)
 *   Tail   := . Ident                             (member access, whitespace
 *                                                  tolerant per A4 fix)
 *           | ( Args )                            (call tail, balanced nesting)
 *           | [ Index ]                           (index tail, balanced nesting)
 *
 * The scanner walks right-to-left. Tails may chain directly (no `.` between
 * `arr` and `[0]` in `arr[0]`, no `.` between `f()` and `()` in `f()()`).
 * Member tails are preceded by `.`. The base is the LEFTMOST segment.
 *
 * The LHS extent terminates when a non-chain character precedes the current
 * segment — e.g. binary operator, comma, semicolon, opening `(`/`[`/`{`, or
 * the start of the string. The scanner does NOT consume operators; it stops
 * just past them, leaving them in the prefix portion that is preserved
 * verbatim in the output (so `a || b is some` becomes
 * `a || __scrml_is_some__(b)`).
 */
function scanLhsLeft(s: string, isStart: number): number {
  // 1. Skip whitespace immediately before `is`
  let i = isStart - 1;
  while (i >= 0 && /\s/.test(s[i])) i--;
  if (i < 0) return -1;

  // 2. The LHS must end with an identifier char, `)`, or `]`. Anything else
  //    means there is no valid bare-form LHS here (e.g. preceded by operator).
  const tailChar = s[i];
  if (!(/[A-Za-z0-9_$]/.test(tailChar) || tailChar === ")" || tailChar === "]")) {
    return -1;
  }

  // 3. Walk leftward through chained segments.
  //
  // State machine: `expecting`
  //   - "tail-or-base" — the previous segment was a `(...)`, `[...]`, or `.ident`
  //                       tail, or we have not consumed anything yet. Left of
  //                       here we accept: another `(...)` / `[...]` tail (chained
  //                       no-dot, e.g. `arr[0][1]` or `f()()`), a `.ident`
  //                       member tail, or a `@?Ident` base.
  //   - "after-base" — we just consumed a bare ident. The chain has hit its
  //                    base; the loop terminates.
  //
  // The state captures: an ident segment without a leading `.` is a BASE and
  // therefore stops the leftward walk unless we are walking up a member-access
  // chain (i.e., a `.` was just consumed on the right).
  //
  // Whitespace tolerance: the joinWithNewlines path in ast-builder emits
  // condition strings with whitespace AROUND every token, so `arr[0].trim()
  // is some` reaches this scanner as `arr [ 0 ] . trim ( ) is some`. The
  // scanner skips whitespace between consecutive chain segments.
  let pos = i;
  let chainStart = pos + 1; // exclusive — furthest-left consumed
  let expecting: "tail-or-base" | "after-base" = "tail-or-base";

  while (pos >= 0 && expecting === "tail-or-base") {
    // Skip whitespace between segments.
    while (pos >= 0 && /\s/.test(s[pos])) pos--;
    if (pos < 0) break;

    const c = s[pos];

    if (c === ")") {
      // Call tail.
      const openIdx = findMatchingOpenLeft(s, pos + 1, "(", ")");
      if (openIdx === -1) return -1;
      chainStart = openIdx;
      pos = openIdx - 1;
      // After a call/index tail, we expect another tail or a base.
      expecting = "tail-or-base";
    } else if (c === "]") {
      // Index tail.
      const openIdx = findMatchingOpenLeft(s, pos + 1, "[", "]");
      if (openIdx === -1) return -1;
      chainStart = openIdx;
      pos = openIdx - 1;
      expecting = "tail-or-base";
    } else if (/[A-Za-z0-9_$]/.test(c)) {
      // Ident segment. This may be:
      //   - the BASE of the chain (no `.` left of it) — terminate after,
      //   - or a member-tail-name (a `.` left of it) — continue chain.
      while (pos >= 0 && /[A-Za-z0-9_$]/.test(s[pos])) pos--;
      const identStart = pos + 1;
      chainStart = identStart;

      // Look for `.` (whitespace-tolerant) to the left — that makes the ident
      // a member-tail, NOT a base.
      let scan = pos;
      while (scan >= 0 && /\s/.test(s[scan])) scan--;
      if (scan >= 0 && s[scan] === ".") {
        // Member-access chain link. Consume the `.` and continue.
        pos = scan - 1;
        chainStart = scan; // include the `.` in the LHS
        // expecting stays "tail-or-base" — there must be another segment left.
        continue;
      }

      // No `.` — this ident is the BASE. Include optional `@` sigil (with
      // whitespace tolerance) and stop.
      if (scan >= 0 && s[scan] === "@") {
        chainStart = scan;
      }
      expecting = "after-base";
    } else {
      // Not a continuation char (binary operator, comma, semicolon, `{`, etc.)
      // — the chain terminates without consuming more.
      break;
    }
  }

  // If we never consumed anything, the LHS is empty/invalid.
  if (chainStart > i) return -1;
  return chainStart;
}

/** Suffix descriptor: what follows `is ` and how to translate. */
type IsPredicateSuffix =
  | { kind: "is-not-not"; consumeLen: number }
  | { kind: "is-not"; consumeLen: number }
  | { kind: "is-some"; consumeLen: number }
  | { kind: "is-variant"; consumeLen: number; variant: string };

/**
 * Match the suffix starting at `s[start]`, which is positioned just after the
 * `is` keyword's trailing whitespace. Returns the matched form and the byte
 * length it occupies (the number of bytes after the `is`-trailing-whitespace
 * the suffix consumed).
 *
 * Returns null if no recognized predicate suffix follows.
 *
 * Precedence (longest-match-first):
 *   1. `not not` (presence — double negation)
 *   2. `not`     (absence)
 *   3. `some` / `given` (presence)
 *   4. `Type.Variant` (qualified — prefer over bare-dot when applicable)
 *   5. `.VariantName`
 */
function matchIsPredicateSuffix(s: string, start: number): IsPredicateSuffix | null {
  const tail = s.slice(start);

  // `not not` — must check before `not` (longest-match). Word-boundary on both
  // sides.
  const notNotMatch = /^not\s+not(?![A-Za-z0-9_$])/.exec(tail);
  if (notNotMatch) return { kind: "is-not-not", consumeLen: notNotMatch[0].length };

  const notMatch = /^not(?![A-Za-z0-9_$])/.exec(tail);
  if (notMatch) return { kind: "is-not", consumeLen: notMatch[0].length };

  const someMatch = /^(?:some|given)(?![A-Za-z0-9_$])/.exec(tail);
  if (someMatch) return { kind: "is-some", consumeLen: someMatch[0].length };

  // Qualified variant `Type.Variant` — match BEFORE bare `.Variant` so a
  // qualified form is preferred when it applies.
  //
  // R24-BUG-35 (S137): the BS tokenizer space-pads dot tokens, so a source
  // `is Status.Active` may arrive here as `is Status . Active`. Both forms
  // must match identically (mirrors `rewriteIsOperator` in `codegen/rewrite.ts`
  // which has carried `\s*` tolerance on the string-rewrite fallback path).
  // The captured `variant` is normalized (interior whitespace stripped) so
  // downstream consumers see the canonical no-space spelling.
  const typedVariantMatch = /^([A-Z][A-Za-z0-9_]*\s*\.\s*[A-Z][A-Za-z0-9_]*)(?![A-Za-z0-9_$.])/.exec(tail);
  if (typedVariantMatch) {
    const variant = typedVariantMatch[1].replace(/\s+/g, "");
    return { kind: "is-variant", consumeLen: typedVariantMatch[0].length, variant };
  }

  // Bare-dot variant `.Variant` — `\s*` between `.` and the variant name
  // tolerates the BS-tokenizer space-padded form `. Variant` (R24-BUG-35).
  const bareVariantMatch = /^(\.\s*[A-Z][A-Za-z0-9_]*)(?![A-Za-z0-9_$.])/.exec(tail);
  if (bareVariantMatch) {
    const variant = bareVariantMatch[1].replace(/\s+/g, "");
    return { kind: "is-variant", consumeLen: bareVariantMatch[0].length, variant };
  }

  return null;
}

/** Format a placeholder call for the matched predicate. */
function formatIsPredicate(lhs: string, suffix: IsPredicateSuffix): string {
  switch (suffix.kind) {
    case "is-not-not": return `__scrml_is_not_not__(${lhs})`;
    case "is-not":     return `__scrml_is_not__(${lhs})`;
    case "is-some":    return `__scrml_is_some__(${lhs})`;
    case "is-variant": return `__scrml_is_variant__(${lhs}, "${suffix.variant}")`;
  }
}

/**
 * Replace every `<lhs> is <suffix>` occurrence in `s` with the corresponding
 * `__scrml_is_X__(...)` placeholder call. Scans left-to-right, skipping
 * string-literal interiors.
 *
 * E-EQ-005 (§45.5, S237) — the `is` RHS is bounded. When a `<lhs> is …` form
 * has a valid LHS but the RHS is NEITHER a sanctioned absence/presence keyword
 * (`not` / `some` / `given` / `not not`) NOR a `.Variant` / `Type.Variant`
 * pattern — i.e. it is a value literal (`x is 0`) or a value-expression
 * (`x is @other`) — this scanner flags `detector.valueRhsOnIs`. The offending
 * text is left VERBATIM (not masked): the stamped node is harvested downstream
 * (parseExprToNode → `_isValueRhsOnIs`) and E-EQ-005 fires as a hard error
 * BEFORE codegen, replacing the old misleading `E-DG-002` / `E-CODEGEN-INVALID-LOGIC`
 * mis-lowering. Mirror of E-EQ-002 (`x == not` → `x is not`); steers to `==`.
 */
function rewriteIsPredicates(s: string, detector?: { valueRhsOnIs?: boolean }): string {
  let result = "";
  let i = 0;
  let inString: string | null = null;

  while (i < s.length) {
    const c = s[i];

    // String-literal tracking
    if (inString === null) {
      if (c === '"' || c === "'" || c === "`") {
        inString = c;
        result += c;
        i++;
        continue;
      }
    } else {
      if (c === "\\") {
        // Pass through the escape and its target
        result += c;
        i++;
        if (i < s.length) { result += s[i]; i++; }
        continue;
      }
      if (c === inString) {
        inString = null;
        result += c;
        i++;
        continue;
      }
      result += c;
      i++;
      continue;
    }

    // Look for the `is` keyword: word-boundary `is` followed by whitespace,
    // followed by a recognised suffix. The character before `is` must be a
    // non-identifier and the character after `is` must also be non-identifier
    // (so we don't fire on `is_some` / `island` etc.).
    if (c === "i" && s[i + 1] === "s") {
      const before = i === 0 ? " " : s[i - 1];
      const after = s[i + 2];
      const isWord = /[A-Za-z0-9_$]/.test(before) || (after !== undefined && /[A-Za-z0-9_$]/.test(after));
      if (!isWord) {
        // After `is`, require at least one whitespace before the suffix.
        let suffixStart = i + 2;
        let wsCount = 0;
        while (suffixStart < s.length && /\s/.test(s[suffixStart])) {
          suffixStart++;
          wsCount++;
        }
        if (wsCount > 0) {
          const suffix = matchIsPredicateSuffix(s, suffixStart);
          if (suffix !== null) {
            // Find the LHS extent in `s` (the original string).
            const lhsStart = scanLhsLeft(s, i);
            if (lhsStart !== -1) {
              // The bytes [lhsStart .. i) of `s` were already appended to
              // `result` (no substitution can have intervened: substitutions
              // only happen here, and after each one we skip past `is` +
              // suffix, so the LHS-extent slice is verbatim in `result`'s
              // tail). Trim that tail from `result` and emit the placeholder.
              const lhsLenInS = i - lhsStart;
              if (lhsLenInS > 0) {
                result = result.slice(0, result.length - lhsLenInS);
              }
              const lhsText = s.slice(lhsStart, i).trimEnd();
              result += formatIsPredicate(lhsText, suffix);
              i = suffixStart + suffix.consumeLen;
              continue;
            }
          } else if (suffixStart < s.length && detector) {
            // E-EQ-005 (§45.5) — `is` with a NON-sanctioned RHS. The suffix is
            // neither `not` / `some` / `given` / `not not` nor a `.Variant` /
            // `Type.Variant` pattern, so it is a value literal (`x is 0`,
            // `x is "text"`, `x is true`) or a value-expression (`x is @other`,
            // `x is someLocal`). Only flag when there is a genuine LHS predicate
            // target (so a stray `is` with no left operand is not misread). The
            // text is left verbatim; the downstream harvest fires E-EQ-005 and
            // steers to `==`.
            const lhsStart = scanLhsLeft(s, i);
            if (lhsStart !== -1) {
              detector.valueRhsOnIs = true;
            }
          }
        }
      }
    }

    result += c;
    i++;
  }

  return result;
}

/** Pre-process scrml-specific operators for Acorn parsing. Returns transformed string. */
function preprocessForAcorn(
  raw: string,
  opts?: { tildeActive?: boolean },
  detector?: { notPrefixNegation: boolean; valueRhsOnIs?: boolean },
): string {
  let s = raw.trim();

  // Bug 1 fix-B (S88 dispatch — 14-mario): the `::` enum-variant access alias
  // is normalized to `.` here so acorn parses it as a standard MemberExpression.
  //
  // SPEC §14 (line 6976) declares `EnumType::Variant` and `::Variant` as
  // syntactic aliases for `EnumType.Variant` and `.Variant`. Without this
  // rewrite, the scrmlEnumPlugin (defined below) emits a STRING token for
  // `::Variant` AFTER the IDENT for the enum-type prefix has already been
  // emitted — acorn's parseExpressionAt then stops at the IDENT and silently
  // drops the trailing STRING (no operator between them), producing wrong
  // codegen for comparisons like `@marioState == MarioState::Small`
  // (`_scrml_structural_eq(<cell>, MarioState)` — compares against whole
  // enum object instead of the `"Small"` discriminant).
  //
  // Rewriting `::` → `.` before acorn lets the standard member-access path
  // handle both bare `MarioState::Small` (read) and constructor calls like
  // `PowerUp::Mushroom(1)` (call). The runtime enum object frozen by
  // emitEnumVariantObjects exposes both shapes — see emit-client.ts.
  //
  // Standalone `::Variant` (shorthand, no enum-type prefix) also normalizes
  // to `.Variant`, which then falls into the existing bare-dot variant
  // placeholder path below.
  s = s.replace(/::(?=\s*[A-Z])/g, ".");

  // S142 gate-tail: collapse the BS tokenizer's space-padded optional-chaining
  // operator `? .` back to `?.` so acorn parses `file.ast?.filePath` as an
  // optional chain rather than a malformed ternary. The block-splitter spaces
  // operators (`file . ast ? . filePath`), and without this collapse the
  // space-padded form fails to parse (escape-hatch ParseError), forcing the
  // string-rewrite fallback that leaves `? .` uncollapsed → invalid JS
  // (surfaced via stdlib/compiler/module-resolver.scrml).
  //
  // Disambiguation from a ternary: optional-chaining `?.` is followed by a
  // PROPERTY access (lowercase/`_`/`$` ident start), an index `[`, or a call
  // `(`. A ternary consequent can begin with a bare-dot variant `.Active`
  // (`cond ? .Active : .Idle`) — its leading char after `.` is UPPERCASE — so
  // gating the collapse on a non-uppercase following char preserves ternaries
  // with bare-variant arms.
  s = s.replace(/\?\s*\.\s*(?=[a-z_$[(])/g, "?.");

  // Replace `match expr { arms }` with placeholder
  // This is processed first because match may contain `is` operators inside arms.
  s = preprocessMatchExprs(s);

  // §59.3 — value-native map literal rewrite. Acorn rejects a `:` inside
  // `[...]`, so a map literal (`[:]` / `[k: v, …]`) is rewritten to a
  // placeholder call `__scrml_map_lit__(<diagJSON>, k1, v1, k2, v2, …)` here,
  // BEFORE the bare-variant rewrite and `not`-lowering. Runs AFTER
  // preprocessMatchExprs so a `[k: v]` inside a match arm is already masked as
  // a JSON string arg and is not re-scanned. Each key/value text round-trips
  // through the full pipeline at unmask time (same as match `rawArms`).
  s = preprocessMapLiterals(s);

  // ─── `is …` predicate rewriting (Phase A: S99 / Phase B: 2026-05-17) ───
  //
  // Phase A (A4, S99) introduced a regex-based LHS capture: a base ident
  // followed by member-access / single-level call / single-level index tail
  // segments. That regex worked for chains like `obj.method().prop is some`
  // and `arr[0] is some` but FAILED on nested parens/brackets inside a tail
  // segment — `re.exec(str.trim()) is some` would route through a multi-pass
  // suffix-substitution chain that introduced a stray `.` character and
  // produced `re.exec(str.trim()).__scrml_is_some_suffix__` (invalid JS).
  //
  // Phase B replaces the brittle multi-pass regex chain with a single
  // structural scan via `rewriteIsPredicates`. The scanner walks the string
  // once left-to-right, skipping string-literal interiors, and at every `is`
  // keyword position it:
  //
  //   1. Looks right to identify the predicate suffix:
  //        `is not not` (presence), `is some` / `is given` (presence),
  //        `is not` (absence), `is .Variant` (variant tag), `is T.Variant`
  //        (qualified variant tag).
  //   2. Looks left through a BALANCED-paren / BALANCED-bracket scanner to
  //      find the LHS predicate-target extent. The scanner consumes:
  //        - bare or `@`-prefixed identifiers
  //        - `.`-member-access chains (whitespace tolerant)
  //        - balanced `(...)` call-tail groups, with nesting
  //        - balanced `[...]` index-tail groups, with nesting
  //      and STOPS at a binary operator (`||`, `&&`, comparison, arithmetic,
  //      etc.), comma, semicolon, opening brace, or an unmatched `(` /
  //      statement-start — matching standard JS precedence intuition.
  //   3. Substitutes the matched `<LHS> is <suffix>` slice with the
  //      placeholder call `__scrml_is_X__(<LHS>)` (or
  //      `__scrml_is_variant__(<LHS>, "<variant>")` for variant tags).
  //
  // Critical SPEC §42.2.4 semantics this rewrite honors:
  //   - Parentheses around a compound expression have NO special meaning
  //     beyond grouping (§42.2.4 line 18437). `(a || b) is some` and
  //     `((a || b)) is some` both produce the same LHS — the balanced-paren
  //     scanner consumes the wrapping parens as a single segment.
  //   - Bare binary expressions (`a || b is some`) bind per JS precedence:
  //     `||` has lower precedence than `is some`, so the scanner stops at
  //     `||` going leftward and the result is `a || __scrml_is_some__(b)`.
  //     If the programmer wants `(a || b)` as the predicate target, the
  //     parens — as grouping — give it to them.
  //   - Side-effecting LHS expressions like `re.exec(str)` evaluate once:
  //     the placeholder consumer in esTreeToExprNode unwraps the call back
  //     into a single BinaryExpr left-operand, which the AST builder emits
  //     as a single evaluation (the temp-var single-eval guarantee in
  //     codegen/rewrite.ts:_rewriteParenthesizedIsOp is enforced separately
  //     by the codegen pipeline; the AST shape carries the full expression
  //     as a node tree).
  s = rewriteIsPredicates(s, detector);

  // Bare-dot variants (.Variant) as primary expressions (S66 — principled fix per Bryan)
  //
  // Acorn cannot parse `.Idle` as a primary expression — it expects an object
  // before the dot. But scrml admits `.Variant` everywhere a primary expression
  // can appear (per §14.10 / M9 bare-variant inference): `<x>: T = .V`,
  // `@phase == .Idle`, `fn(.Idle)`, `[.A, .B]`, `cond ? .A : .B`, etc.
  //
  // Strategy: replace `.Variant` with placeholder identifier `__scrml_bare_variant_Variant__`
  // when it appears OUTSIDE of an identifier-chain (i.e., not preceded by an
  // identifier char, closing paren, or closing bracket — those mean member
  // access on a value, which is acorn-parseable).
  //
  // Prior `is .Variant` / `is TypeName.Variant` rules above run FIRST, so those
  // structural variant-tag-check forms are already consumed. The general rule
  // below catches everything else: `==`, `!=`, comparison ops, argument
  // positions, array elements, ternary branches, return values, object-literal
  // values, anywhere a primary expression is expected.
  //
  // The placeholder is unmasked back to `IdentExpr { name: ".Variant" }` in
  // `esTreeToExprNode` so downstream consumers see a structured AST node
  // (instead of falling into the escape-hatch path on the whole expression).
  //
  // §18 pipe-alternation arm patterns (S84 fix): the negation class includes
  // `|` so that `.A | .B | .C` (inside an already-preprocessed `__scrml_match__`
  // quoted arm, where the second-and-subsequent `.Variant` are preceded by
  // ` | ` rather than the leading `"`) stays UN-substituted. This is required
  // for `rewriteMatchExpr` downstream to recognise the alternation chain and
  // emit the OR-chain condition. Outside alternation, `x | .Variant` (bitwise
  // OR with a bare variant) is meaningless in scrml — the canonical absence
  // check is `is .Variant` (§42), not `|`. So including `|` does not lose
  // expressivity for valid scrml programs.
  s = s.replace(
    /(?<![A-Za-z0-9_$\)\]"'`|]\s*)\.\s*([A-Z][A-Za-z0-9_]*)/g,
    '__scrml_bare_variant_$1__'
  );

  // §45.7 + §42 `not`-keyword lowering — boolean-negation forms.
  //
  // GITI-017 residual (S125, 2026-05-24): these two substitutions previously
  // ran over the WHOLE string `s` with no literal/comment fence, corrupting the
  // INTERIOR of regex literals: `/not a jj repo/i` → `/!a jj repo/i`,
  // `/bookmark.*not found/i` → `/bookmark.*!found/i` (silent-corruption class —
  // valid JS, valid regex, wrong pattern). The codegen sibling pass
  // (rewriteNotKeyword in codegen/rewrite.ts) was fenced in S124 (f181d60a);
  // this is the second, separately-located `not`-lowering site. Both now share
  // the same regex/comment/string fence via rewriteCodeSegments — `not`
  // substitutions apply ONLY to code regions; regex/comment/string interiors
  // pass through verbatim. The char-class case `/n[o]t .../` and the
  // absence-sentinel `/(not) .../` (no trailing whitespace → operator-form
  // regex never matched) are likewise preserved.
  s = rewriteCodeSegments(s, (code) => {
    // Replace `not (expr)` prefix negation → `!(expr)`.
    // 6nz-s (S127): `[ \t]*` not `\s*` — never bridge a statement boundary
    // (a real `not (...)` negation keeps its operand on the same logical line;
    // `not\n(` is standalone absence followed by a separate parenthesised stmt).
    //
    // §42.10 ENFORCEMENT (S188 g-not-negation-enforce): whichever substitution
    // fires is EXACTLY the SPEC-forbidden prefix-`not`-as-negation (all valid
    // `not` — `is not`, `= not`, `return not`, `f(not)`, regex/string interiors —
    // is excluded BEFORE this point; cross-ref the §29 SCOPE rationale). We STILL
    // lower `not`→`!` so error-recovery output stays coherent, AND additionally
    // record the detection in `detector` so parseExprToNode can attach the
    // diagnostic onto the returned ExprNode (type-system harvests → E-TYPE-045).
    // `detector` is undefined for pure-lowering callers (rewriteExpr /
    // rewriteNotKeyword direct-call unit tests, no sink) → behaviour unchanged.
    const beforeParen = code;
    code = code.replace(/(?<![A-Za-z0-9_$@])not[ \t]*\(/g, "!(");
    if (detector && code !== beforeParen) detector.notPrefixNegation = true;

    // §45.7 operator-form: `not <operand>` — unary boolean negation → `!<operand>`.
    // Acorn does not know `not` is a unary operator, so without this rewrite it
    // would parse `not @x` as Identifier `not` followed by trailing content `@x`,
    // dropping the operand. By rewriting to `!@x` here, acorn produces a proper
    // UnaryExpression `{ op: "!", argument: @x }` which esTreeToExprNode then
    // converts to UnaryExpr correctly.
    //
    // The operand is matched conservatively: an optional `@` sigil, identifier
    // chain (with dotted member access), AND optional bracket-indexing tail.
    // Function-call parentheses are NOT consumed — JS unary `!` has lower
    // precedence than function-call, so `!f(x)` parses as `!(f(x))`, which is
    // the desired semantics. The same applies to method calls like `@x.method()`.
    //
    // Lookbehind `(?<![A-Za-z0-9_$@.])` ensures we don't match `not` when it is
    // a member name (`obj.not foo` would have `.` before — excluded).
    //
    // The standalone-value form (`@x = not`, `return not`, `f(not)`, `[a, not, b]`)
    // is NOT matched here because no operand-ident follows. It falls through to
    // esTreeToExprNode which converts Identifier `not` → LitExpr { litType: "not" }
    // (the §42 non-presence value form, which then emits as `null`).
    //
    // 6nz-s (S127): two guards so a STANDALONE `not` (value-completion position:
    // `return not`, `@x = not`, `f(not)`, `[a, not]`) is NOT mis-lowered to `!`
    // by greedily eating the following token:
    //   (a) Statement-boundary guard — `[ \t]+` (horizontal whitespace only), so
    //       the rewrite never crosses a newline / statement break. `return not\n
    //       const pos = ...` previously emitted `return !const pos = ...`
    //       (glued + invalid JS, killing the whole bundle at load — the adopter
    //       6nz repro). The newline now keeps `not` standalone → it falls through
    //       to esTreeToExprNode as Identifier `not` → LitExpr { litType: "not" }
    //       (the canonical §42 absence value, emitted as `null`).
    //   (b) Keyword-exclusion lookahead — a JS reserved keyword is never a valid
    //       negation operand, so `not const` / `not return` / `not if` (even on
    //       one line) is standalone absence, not negation. Defensive complement
    //       to (a) for any same-line keyword-adjacency.
    const beforeBare = code;
    code = code.replace(
      /(?<![A-Za-z0-9_$@.])not[ \t]+(?!(?:const|let|var|return|if|else|for|while|do|switch|case|break|continue|function|new|typeof|void|delete|in|instanceof|class|import|export|yield|await|throw|try|catch|finally|with|debugger|default)(?![A-Za-z0-9_$]))(@?[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*(?:\[[^\]]*\])*)/g,
      "!$1"
    );
    if (detector && code !== beforeBare) detector.notPrefixNegation = true;
    return code;
  });

  // R24-BUG-1 (S136 codegen lowering) — word-form boolean operators.
  //
  // scrml admits `or` / `and` as word-form boolean operators in expression
  // position (alongside JS-form `||` / `&&`). Acorn does not know these are
  // operators — `a or b` parses as Identifier `a` followed by trailing content
  // `or b`, which falls through to the string-rewrite fallback and leaks the
  // raw `or` / `and` tokens into emitted JS (`SyntaxError: Unexpected
  // identifier 'or'` at runtime). Surfaced in gauntlet R24 by 2 of 4 devs.
  //
  // Lowering both `or`→`||` and `and`→`&&` BEFORE acorn parses lets the
  // standard LogicalExpression path produce a `BinaryExpr { op: "||"|"&&" }`
  // node — emitBinary's `default` branch then emits the proper JS operator.
  //
  // Lookbehind `(?<![A-Za-z0-9_$@.])` excludes:
  //   - identifier-substring matches (`orange`, `xor`, `vendor`, `border`,
  //     `Author`, `brand`, `andrew`, `random`, `demand`, `operator`)
  //   - member-access (`obj.or`, `this.and`)
  //   - decorator/sigil-attached (`@or`)
  // Lookahead `(?![A-Za-z0-9_$])` excludes identifier-tail matches.
  // Fenced via rewriteCodeSegments (same shape as the `not` precedent above)
  // so the substitution applies only to code regions; regex/comment/string
  // literal interiors pass through verbatim — `/orange or apple/i` stays a
  // literal regex pattern; the comment `// a or b` stays prose.
  //
  // Trade-off: `let and = 5` / `let or = 5` would also rewrite — these are
  // valid JS identifier names. Matching the `not` precedent's accepted
  // trade-off (`let not = 5` similarly breaks). Bare `and`/`or` as identifier
  // names in scrml source is vanishingly rare and never appears in the
  // current test/sample/stdlib corpus.
  s = rewriteCodeSegments(s, (code) => {
    code = code.replace(/(?<![A-Za-z0-9_$@.])or(?![A-Za-z0-9_$])/g, "||");
    code = code.replace(/(?<![A-Za-z0-9_$@.])and(?![A-Za-z0-9_$])/g, "&&");
    return code;
  });

  // §14.9/§16.6: render name() → __scrml_render_name__()
  s = s.replace(
    /(?<![A-Za-z0-9_$])render\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    '__scrml_render_$1__('
  );

  // §32 tilde accumulator: replace standalone `~` with placeholder identifier.
  //
  // The regex `(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])` is precisely tuned to match
  // ONLY bare standalone `~` — not adjacent to identifier characters. Bitwise-NOT
  // requires an attached operand (`~x`, `~5`), which always has an identifier or
  // digit character immediately following the `~` and so does NOT match this
  // regex. The matched form is therefore structurally the tilde-accumulator: it
  // cannot be a well-formed JS bitwise-NOT.
  //
  // Applied unconditionally (no `tildeActive` gate) so that the round-trip
  //   parseExprToNode → emitStringFromTree → parseExprToNode
  // is stable for `IdentExpr { name: "~" }` and any expression containing one.
  // The emitter renders `~` as the bare ident; without unconditional substitution
  // the re-parse would treat the bare `~` as a malformed bitwise-NOT and produce
  // a ParseError escape-hatch — breaking the corpus-invariant idempotency check.
  //
  // The `opts?.tildeActive` parameter is retained in the signature for backward
  // compatibility and to allow future tilde-scope-aware diagnostics, but is no
  // longer load-bearing for this substitution.
  s = s.replace(/(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/g, "__scrml_tilde__");

  return s;
}

// ---------------------------------------------------------------------------
// §59.3 — value-native map literal scanner (legacy / Acorn pre-rewrite)
// ---------------------------------------------------------------------------

/** A diagnostic the map scanner attaches to a `__scrml_map_lit__` placeholder. */
type MapLitDiag = { code: string; message: string };

/**
 * Given source `s` and the index of an opening `[`, return the index of its
 * matching `]` (string/template-literal aware, depth-tracked), or -1 if the
 * bracket is never closed. The returned index points AT the closing `]`.
 */
function findMatchingBracket(s: string, openIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (inString !== null) {
      if (c === "\\") { i++; continue; }      // skip the escaped char
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * §59.3 disambiguation, value-level. Given the INNER body of a `[ … ]`
 * (brackets already stripped), return the index in `inner` of the first
 * **depth-0 entry-colon that is NOT a ternary alternative-separator**, or -1
 * if there is none (→ the bracket is an array literal, not a map).
 *
 * Mirrors `findMapEntryColon` (type-system.ts) — track bracket/brace/paren
 * depth + an unmatched-`?` counter at depth 0 — and additionally skips
 * string/template-literal interiors (a `:` inside `"a:b"` is not an entry-colon).
 */
function findMapEntryColonInLiteral(inner: string): number {
  let depth = 0;
  let pendingTernary = 0;
  let inString: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString !== null) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === "?") { pendingTernary++; continue; }
    if (ch === ":") {
      // A depth-0 colon. An unmatched `?` before it makes it a ternary
      // alternative-separator (§59.3 exclusion) — consume the `?` and skip.
      if (pendingTernary > 0) { pendingTernary--; continue; }
      return i;
    }
  }
  return -1;
}

/**
 * Split a map-literal inner body into its top-level (depth-0) entry segments
 * on commas, skipping commas nested inside brackets/braces/parens and string
 * interiors. Mirrors the comma-split discipline used elsewhere in the parser.
 */
function splitMapEntriesTopLevel(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString !== null) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

/**
 * Is `keyText` a struct/enum key literal (`{ … }` or a `.Variant` /
 * `Type.Variant` enum value)? Such a literal parse-accepts in v1 but is
 * codegen-deferred to `.insert` (§59.3 M-cut) → `W-MAP-STRUCT-KEY-LITERAL`.
 * A bare-string / number / boolean primitive key does NOT trigger this.
 */
function mapKeyIsStructOrEnum(keyText: string): boolean {
  const t = keyText.trim();
  if (t.startsWith("{")) return true;                          // struct literal
  if (/^\.[A-Z]/.test(t)) return true;                          // .Variant
  if (/^[A-Z][A-Za-z0-9_]*\s*(?:::|\.)\s*[A-Z]/.test(t)) return true; // Type.Variant / Type::Variant
  return false;
}

/**
 * §59.3 — rewrite value-native map literals to a placeholder call so Acorn can
 * parse them. A bracketed expression is a MAP iff it is the empty form `[:]`
 * OR it contains a depth-1 entry-colon that is not a ternary alternative-colon
 * (`findMapEntryColonInLiteral`). Array literals and index accesses (which never
 * carry a qualifying depth-1 entry-colon) are left untouched.
 *
 * Emitted shape: `__scrml_map_lit__(<diagJSON>, k1, v1, k2, v2, …)` where
 * `<diagJSON>` is a JSON-string of the attached diagnostics array (Error +
 * Info) and the remaining args are the JSON-quoted key/value source slices —
 * round-tripped through the full pipeline at unmask time (mirrors match arms).
 * An empty map (`[:]`) emits `__scrml_map_lit__(<diagJSON>)` (no pairs).
 *
 * Processed right-to-left so earlier indices stay valid after each rewrite.
 */
function preprocessMapLiterals(s: string): string {
  // Collect candidate map-literal brackets (left-to-right), then rewrite
  // right-to-left so prior-index slices remain valid.
  const rewrites: Array<{ start: number; end: number; replacement: string }> = [];

  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString !== null) {
      if (c === "\\") { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c !== "[") continue;

    const closeIdx = findMatchingBracket(s, i);
    if (closeIdx === -1) continue;                       // unclosed — leave to acorn
    const inner = s.slice(i + 1, closeIdx);
    const innerTrim = inner.trim();

    // Empty-map literal `[:]` (exactly a single colon, possibly padded).
    if (innerTrim === ":") {
      rewrites.push({ start: i, end: closeIdx + 1, replacement: `__scrml_map_lit__(${JSON.stringify(JSON.stringify([]))})` });
      i = closeIdx;                                       // skip past — no nested re-scan of this bracket
      continue;
    }

    // Map iff there is a depth-1 entry-colon that is not a ternary alt-colon.
    const entryColon = findMapEntryColonInLiteral(inner);
    if (entryColon === -1) continue;                     // array literal / index — not a map

    const diags: MapLitDiag[] = [];
    const segments = splitMapEntriesTopLevel(inner);
    const pairArgs: string[] = [];
    const seenKeys: string[] = [];

    for (const seg of segments) {
      const segTrim = seg.trim();
      if (segTrim === "") {
        // An empty entry segment (a stray / trailing comma) — count error.
        diags.push({
          code: "E-MAP-LITERAL-MALFORMED",
          message: "E-MAP-LITERAL-MALFORMED: empty entry in map literal (stray or trailing comma) (§59.3).",
        });
        continue;
      }
      const colon = findMapEntryColonInLiteral(seg);
      if (colon === -1) {
        // An entry with no key:value colon (e.g. `[ "a": 1, "b" ]`) — malformed.
        diags.push({
          code: "E-MAP-LITERAL-MALFORMED",
          message: `E-MAP-LITERAL-MALFORMED: map-literal entry \`${segTrim}\` is missing a \`key: value\` colon (§59.3).`,
        });
        continue;
      }
      const keyText = seg.slice(0, colon).trim();
      const valText = seg.slice(colon + 1).trim();
      if (keyText === "" || valText === "") {
        // Missing key or value, or a trailing colon (`["k":]`, `[:5]`).
        diags.push({
          code: "E-MAP-LITERAL-MALFORMED",
          message: `E-MAP-LITERAL-MALFORMED: map-literal entry \`${segTrim}\` has a ${keyText === "" ? "missing key" : "missing value"} (§59.3).`,
        });
        continue;
      }
      // §59.3 M-cut — struct/enum-key literal parse-accepts but is codegen-
      // deferred to `.insert` in v1. Surface once per offending key.
      if (mapKeyIsStructOrEnum(keyText)) {
        diags.push({
          code: "W-MAP-STRUCT-KEY-LITERAL",
          message: `W-MAP-STRUCT-KEY-LITERAL: struct/enum-key map literal \`${keyText}: …\` parse-accepts but v1 codegen requires the \`.insert(${keyText}, …)\` form (§59.3/§59.12).`,
        });
      }
      // §59.3 duplicate depth-1 keys — last-wins; surface the overwrite. Keys
      // are compared by normalized source text (a best-effort structural proxy
      // at parse time; the runtime applies true §45-equality last-wins).
      const keyNorm = keyText.replace(/\s+/g, " ");
      if (seenKeys.includes(keyNorm)) {
        diags.push({
          code: "W-MAP-DUPLICATE-LITERAL-KEY",
          message: `W-MAP-DUPLICATE-LITERAL-KEY: duplicate map-literal key \`${keyText}\` — last entry wins (§59.3).`,
        });
      }
      seenKeys.push(keyNorm);
      pairArgs.push(JSON.stringify(keyText), JSON.stringify(valText));
    }

    const diagArg = JSON.stringify(JSON.stringify(diags));
    const allArgs = [diagArg, ...pairArgs].join(", ");
    rewrites.push({ start: i, end: closeIdx + 1, replacement: `__scrml_map_lit__(${allArgs})` });
    i = closeIdx;
  }

  if (rewrites.length === 0) return s;
  let result = s;
  for (let k = rewrites.length - 1; k >= 0; k--) {
    const { start, end, replacement } = rewrites[k];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

/**
 * §18.2 (GITI-016) — does `arms` (the interior of a `match … { … }` brace block)
 * carry at least one top-level match arm — a `:>` or `->` separator at bracket
 * depth 0? A value-return match ALWAYS has `pattern :> body` arms; a false brace
 * (an object literal, a following code block) does not. Skips string literals and
 * nested `()`/`[]`/`{}` so a `:>` inside a body / string never counts.
 *
 * Per §18.2 the separator is `:>` (canonical) or the deprecated aliases `=>` /
 * `->` — all three count. A genuine identifier use of `match` always carries a
 * tell-operator immediately after `match` (caught by the early-out at the call
 * site) or no brace at all, so the `=>` form cannot mis-fire on an object literal
 * reached through those paths.
 */
function matchArmsHaveTopLevelArm(arms: string): boolean {
  let depth = 0;
  let str: string | null = null;
  for (let i = 0; i < arms.length; i++) {
    const c = arms[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; continue; }
    // `:>` / `=>` / `->` at depth 0 — whitespace-tolerant (the block-splitter
    // space-pads operators, so `:>` may arrive as `: >`, `->` as `- >`, etc.).
    if (depth === 0 && (c === ":" || c === "-" || c === "=")) {
      let j = i + 1;
      while (j < arms.length && /\s/.test(arms[j])) j++;
      if (arms[j] === ">") return true;
    }
  }
  return false;
}

/** Pre-process `match subject { arms }` expressions. */
function preprocessMatchExprs(s: string): string {
  // Find `match` followed by an expression and a brace block
  // This is a simple balanced-brace scanner — handles one level of nesting
  const matchRe = /\bmatch\s+/g;
  let result = s;
  let searchFrom = 0;
  let m: RegExpExecArray | null;

  // Process match expressions right-to-left to handle nesting
  const matches: Array<{ index: number; end: number; raw: string }> = [];

  matchRe.lastIndex = 0;
  while ((m = matchRe.exec(s)) !== null) {
    const matchStart = m.index;
    // Find the opening brace
    const braceIdx = s.indexOf("{", m.index + m[0].length);
    if (braceIdx === -1) continue;

    // Extract subject (between `match ` and `{`)
    const subjectRaw = s.slice(m.index + m[0].length, braceIdx).trim();

    // Find closing brace (balanced)
    let depth = 1;
    let i = braceIdx + 1;
    while (i < s.length && depth > 0) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      i++;
    }
    const matchEnd = i;
    const armsRaw = s.slice(braceIdx + 1, i - 1).trim();

    // §18.2 (GITI-016) — `match` is a CONTEXTUAL keyword. Only treat this
    // `match …{…}` as a value-return match-expression when Option A holds;
    // otherwise `match` is an ordinary identifier and is left verbatim (so a
    // `match is some ? {…} : {…}` ternary no longer mis-lowers on the wrong `{`).
    //   (a) member position — `.match` (`obj.match`) is a member access.
    if (matchStart > 0 && s[matchStart - 1] === ".") continue;
    //   (b) identifier-usage early-out — `match` immediately followed by `is` /
    //       `=` / a binary/logical operator / `?` / `:` / `,` / `)` is a value use.
    if (/^(?:is\b|instanceof\b|in\b|as\b|=>|==|===|=|\?|:|,|\)|\]|&&|\|\||[&|^%*/<>])/.test(subjectRaw)) continue;
    //   (c) the robust tell — the brace block MUST carry a top-level `:>`/`->`
    //       arm (§18.2); a false brace (object literal / code block) has none.
    if (!matchArmsHaveTopLevelArm(armsRaw)) continue;
    //   (d) statement boundary — a new statement keyword between `match` and the
    //       `{` means the brace belongs to that statement, not a match arm-block.
    if (/(?:^|\n)\s*(?:const|let|var|return|if|else|for|while|do|function|fn|type|import|export|switch|try)\b/.test(subjectRaw)) continue;

    matches.push({ index: matchStart, end: matchEnd, raw: s.slice(matchStart, matchEnd) });
  }

  // Replace right-to-left so indices stay valid
  for (let k = matches.length - 1; k >= 0; k--) {
    const { index, end, raw } = matches[k];
    // Extract subject and arms from the raw match text
    const innerBraceIdx = raw.indexOf("{");
    const subject = raw.slice("match ".length, innerBraceIdx).trim();
    const armsContent = raw.slice(innerBraceIdx + 1, -1).trim();

    // Split arms by `\n` or `.` prefixed arm starts — simple approach
    // Each arm is: `.Variant => expr` or `else => expr`
    // We keep arms as raw strings
    const armStrings = splitMatchArms(armsContent);
    const armsQuoted = armStrings.map(a => JSON.stringify(a.trim())).join(", ");

    const replacement = `__scrml_match__(${subject}, ${armsQuoted})`;
    result = result.slice(0, index) + replacement + result.slice(end);
  }

  return result;
}

/**
 * §18.19 — split a string by depth-0 commas, respecting nested () [] {} and
 * string literals. Used for the scrutinee head and product-pattern positions.
 */
export function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let str: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (str) {
      cur += c;
      if (c === "\\" && i + 1 < inner.length) { cur += inner[++i]; }
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; cur += c; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; cur += c; continue; }
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim().length > 0) parts.push(cur.trim());
  return parts;
}

/**
 * §18.19 — does a trimmed arm-line begin a product-pattern arm `( p1, …, pN ) :>`?
 * Requires a `(` whose matching `)` is followed (after ws) by a match arrow, and
 * a depth-1 comma between them (≥ 2 positions). A single-scrutinee parenthesized
 * value / presence guard never matches (no depth-1 comma).
 */
function looksLikeProductArmStart(t: string): boolean {
  if (!t.startsWith("(")) return false;
  let depth = 0;
  let str: string | null = null;
  let sawComma = false;
  let closeIdx = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (str) { if (c === "\\") { i++; } else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) { closeIdx = i; break; } }
    else if (c === "," && depth === 1) sawComma = true;
  }
  if (closeIdx < 0 || !sawComma) return false;
  const after = t.slice(closeIdx + 1).trimStart();
  return after.startsWith(":>") || after.startsWith("=>") || after.startsWith("->");
}

/** Split match arms content into individual arm strings. */
function splitMatchArms(content: string): string[] {
  // Arms are separated by line-starts of arm-shape tokens.
  // Recognised arm-start patterns:
  //   - `.UpperCase`  (variant arm)
  //   - `else`        (wildcard arm)
  //   - `_` followed by `=>` / `:>` / `->`  (Bug 1 S95 — JS-style wildcard
  //     alias; previously this splitter only recognised `.` and `else`,
  //     causing `_ => false` lines to be appended to the prior arm's result
  //     and producing malformed JS via the emit-expr.ts:emitMatchExpr shim.)
  //   - `not` followed by `=>` / `:>` / `->`  (§42 absence arm)
  const arms: string[] = [];
  // Split on newlines first, then re-join arm continuations
  const lines = content.split(/\n/);

  // Predicate: does this trimmed line text start a new arm?
  function isArmStart(t: string): boolean {
    if (t.startsWith(".")) return true;
    if (t.startsWith("else")) return true;
    // §18.19 — a product-pattern arm `( p1, …, pN ) :>` (depth-1 comma + arrow),
    // and a leading-`|` whole-product wildcard / product arm (`| _` / `| else` /
    // `| ( … )`). `| .Variant` is NOT treated as a boundary — it stays a
    // variant-pattern alternation continuation (old behavior, §51.0.J).
    if (t.startsWith("(") && looksLikeProductArmStart(t)) return true;
    if (t.startsWith("|")) {
      const rest = t.slice(1).trimStart();
      if (rest.startsWith("_") || rest.startsWith("else")) return true;
      if (rest.startsWith("(") && looksLikeProductArmStart(rest)) return true;
    }
    // `_` standalone followed by an arrow operator
    if (t.startsWith("_")) {
      // Look past `_` + whitespace for an arrow token.
      let j = 1;
      while (j < t.length && /\s/.test(t[j])) j++;
      const arrow2 = t.slice(j, j + 2);
      if (arrow2 === "=>" || arrow2 === ":>" || arrow2 === "->") return true;
    }
    // `not` standalone followed by an arrow operator (§42 absence arm)
    if (t.startsWith("not")) {
      const after = t.slice(3);
      // Must not be a longer identifier like `notation`
      if (after.length === 0 || /[\s=:\->]/.test(after[0])) {
        let j = 0;
        while (j < after.length && /\s/.test(after[j])) j++;
        const arrow2 = after.slice(j, j + 2);
        if (arrow2 === "=>" || arrow2 === ":>" || arrow2 === "->") return true;
      }
    }
    return false;
  }

  let current = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (current && isArmStart(trimmed)) {
      arms.push(current.trim());
      current = trimmed;
    } else {
      current += (current ? " " : "") + trimmed;
    }
  }
  if (current.trim()) arms.push(current.trim());
  // Fallback: if only one arm or no newlines, try splitting on whitespace-. pattern
  if (arms.length === 0 && content.trim()) {
    arms.push(content.trim());
  }
  return arms;
}

// ---------------------------------------------------------------------------
// esTreeToExprNode — convert Acorn ESTree to ExprNode
// ---------------------------------------------------------------------------

/**
 * Convert an Acorn ESTree node to an ExprNode.
 *
 * @param node - ESTree node from Acorn
 * @param filePath - Source file path (for spans)
 * @param baseOffset - Byte offset of the expression start in the source file
 * @param rawSource - The original raw source string (before preprocessing) for escape hatch
 */
export function esTreeToExprNode(
  node: ESNode,
  filePath: string,
  baseOffset: number,
  rawSource?: string,
): ExprNode {
  const span = spanFromEstree(node, filePath, baseOffset);

  switch (node.type) {
    // ---- Identifier ----
    case "Identifier": {
      const name = node.name as string;
      // Handle __scrml_input_<id>__ placeholders back to input-state-ref
      if (name.startsWith("__scrml_input_") && name.endsWith("__")) {
        const inputName = name.slice("__scrml_input_".length, -2);
        return { kind: "input-state-ref", span, name: inputName } satisfies InputStateRefExpr;
      }
      // Handle __scrml_sql_placeholder__
      if (name === "__scrml_sql_placeholder__") {
        return { kind: "sql-ref", span, nodeId: -1 } satisfies SqlRefExpr;
      }
      // Handle worker refs __scrml_worker_<id>__
      if (name.startsWith("__scrml_worker_") && name.endsWith("__")) {
        // Worker refs are handled at a higher level; emit as ident for now
        return { kind: "ident", span, name } satisfies IdentExpr;
      }
      // S66: bare-variant `.Variant` placeholder unmasking. The preprocessor
      // replaces `.Variant` → `__scrml_bare_variant_Variant__` so acorn can
      // parse the surrounding expression. Here we restore the leading-dot
      // form on the IdentExpr, matching the convention used by the
      // `__scrml_is_variant__` consumer (which also produces IdentExpr with
      // name `.Variant`). Downstream M9 bare-variant inference resolves the
      // type from context (LHS annotation, parameter type, match for=, etc.).
      if (name.startsWith("__scrml_bare_variant_") && name.endsWith("__")) {
        const variantName = "." + name.slice("__scrml_bare_variant_".length, -2);
        return { kind: "ident", span, name: variantName } satisfies IdentExpr;
      }
      // §32 tilde accumulator: convert placeholder back to ~ ident
      if (name === "__scrml_tilde__") {
        return { kind: "ident", span, name: "~" } satisfies IdentExpr;
      }
      // §42 absence value: `not` keyword → null literal
      if (name === "not") {
        return { kind: "lit", span, raw: "not", value: null, litType: "not" } satisfies LitExpr;
      }
      return { kind: "ident", span, name } satisfies IdentExpr;
    }

    // ---- Literals ----
    case "Literal": {
      const raw = node.raw as string ?? String(node.value);
      const value = node.value;
      if (typeof value === "number") {
        return { kind: "lit", span, raw, value, litType: "number" } satisfies LitExpr;
      }
      if (typeof value === "boolean") {
        return { kind: "lit", span, raw, value, litType: "bool" } satisfies LitExpr;
      }
      if (value === null) {
        // §42 absence canon (S90 M-7C-D-12 Track 1): user-source `null` token
        // gets `litType: "not"` so the AST only carries the canonical absence
        // discriminator. The `raw: "null"` field preserves source-token
        // provenance so the gauntlet-phase3 detector can still fire
        // E-SYNTAX-042 on user-source `null` (raw "null" / "undefined" → user
        // forbidden token; raw "not" → scrml canonical keyword or internal
        // synthesis).
        return { kind: "lit", span, raw, value: null, litType: "not" } satisfies LitExpr;
      }
      if (typeof value === "string") {
        // Template literals that survived preprocessing are string literals
        const litType = raw && raw.startsWith("`") ? "template" : "string";
        return { kind: "lit", span, raw, value, litType } satisfies LitExpr;
      }
      // Regex literal — ESTree represents `/[^a-z0-9]+/g` as a `Literal` whose
      // `value` is a RegExp object (typeof "object", so it falls past the
      // number/boolean/null/string arms above) carrying a `regex` { pattern,
      // flags } property and a `raw` field with the literal source.
      //
      // g-literal-arg-expr-serializer-wrong-span: the BigInt fallback below
      // passes the OUTER `rawSource` (the whole enclosing expression) as the
      // escape-hatch raw. For a regex in CALL-ARGUMENT position
      // (`s.split(/[^a-z0-9]+/)`) that re-serialized the entire enclosing
      // expression into the arg slot — silent miscompile (the emitted call took
      // its own enclosing expression as its argument). The literal's OWN source
      // (`node.raw` = `/[^a-z0-9]+/`) is the only correct raw to carry; the
      // escape-hatch emitter passes it through `rewriteExpr`, and the
      // code-segments fence treats a regex literal as opaque so its body is
      // preserved verbatim.
      if ((node as unknown as { regex?: unknown }).regex && typeof raw === "string") {
        return makeEscapeHatch(node, span, raw);
      }
      // BigInt or other exotic literals — `raw` is the literal's own source
      // text (e.g. `123n`); prefer it over the OUTER `rawSource` so a literal in
      // call-argument position serializes only itself, not its enclosing expr.
      return makeEscapeHatch(node, span, raw ?? rawSource ?? String(node.value));
    }

    // ---- Template Literal ----
    // Both single-quasi (no interpolation) and multi-quasi (with `${...}`) are
    // represented as `lit { litType: "template" }` carrying the full backtick
    // source in `raw`. The walker (forEachIdentInExprNode) special-cases
    // template literals and recurses into the interpolations.
    case "TemplateLiteral": {
      const quasis = (node.quasis as ESNode[]) ?? [];
      if (quasis.length === 1) {
        const quasi = quasis[0];
        const cooked = (quasi as { value?: { cooked?: string } }).value?.cooked ?? "";
        const raw = "`" + cooked + "`";
        return { kind: "lit", span, raw, value: cooked, litType: "template" } satisfies LitExpr;
      }
      // Multi-quasi template — reconstruct the original backtick source from
      // the ESTree node's start/end offsets within `rawSource` (which is the
      // full expression text passed to esTreeToExprNode).
      // A4: previously this branch made an escape-hatch carrying the OUTER
      // `rawSource`, which broke round-trip (emit doubled the surrounding call)
      // AND hid interpolations from the walker. Now we keep the literal
      // structured so both work.
      const tplStart = (node as unknown as { start?: number }).start;
      const tplEnd = (node as unknown as { end?: number }).end;
      let templateRaw = "";
      if (typeof tplStart === "number" && typeof tplEnd === "number"
          && rawSource && tplStart >= 0 && tplEnd <= rawSource.length && tplStart < tplEnd) {
        templateRaw = rawSource.slice(tplStart, tplEnd);
      }
      // Defensive fallback: if we couldn't slice the source, reconstruct from
      // quasis + expressions via astring (best-effort) so `raw` is at least
      // a valid template literal.
      if (!templateRaw || !templateRaw.startsWith("`")) {
        try {
          templateRaw = astringGenerate(node as unknown as Parameters<typeof astringGenerate>[0]);
        } catch (_e) {
          // Last-resort: empty template (caller will see `kind: lit / template`
          // with empty raw — the walker's interpolation extractor will simply
          // find no segments).
          templateRaw = "``";
        }
      }
      // `value` for a template lit is conventionally the joined cooked-quasi
      // text (matches the single-quasi branch above for un-interpolated parts);
      // for the multi-quasi case we just record empty since the cooked value
      // isn't meaningful without interpolation values.
      return {
        kind: "lit", span,
        raw: templateRaw,
        value: "",
        litType: "template",
      } satisfies LitExpr;
    }

    // ---- Unary ----
    case "UnaryExpression": {
      const op = node.operator as string;
      // Bug 5 (s87 trio-b, 2026-05-12): thread rawSource so a function-with-
      // block-body nested in unary position (e.g., `!arr.filter(function(t){...})`)
      // can slice its own raw text in the FunctionExpression branch. Without
      // this, the inner callback's escape-hatch raw="" and the emitter drops it.
      const argument = esTreeToExprNode(node.argument as ESNode, filePath, baseOffset, rawSource);
      const validOps = ["!", "-", "+", "~", "typeof", "void", "delete", "await"];
      if (!validOps.includes(op)) return makeEscapeHatch(node, span, rawSource ?? "");
      return {
        kind: "unary", span,
        op: op as UnaryExpr["op"],
        argument,
        prefix: true,
      } satisfies UnaryExpr;
    }

    // ---- Update (prefix/postfix ++ / --) ----
    case "UpdateExpression": {
      const op = node.operator as string; // "++" or "--"
      // Bug 5 (s87 trio-b): thread rawSource (same shape as UnaryExpression).
      const argument = esTreeToExprNode(node.argument as ESNode, filePath, baseOffset, rawSource);
      return {
        kind: "unary", span,
        op: op as "++" | "--",
        argument,
        prefix: node.prefix as boolean,
      } satisfies UnaryExpr;
    }

    // ---- Await ----
    case "AwaitExpression": {
      // Bug 5 (s87 trio-b): thread rawSource (same shape as UnaryExpression).
      const argument = esTreeToExprNode(node.argument as ESNode, filePath, baseOffset, rawSource);
      return {
        kind: "unary", span,
        op: "await",
        argument,
        prefix: true,
      } satisfies UnaryExpr;
    }

    // ---- Dynamic import `import(spec)` (ESTree ImportExpression) ----
    case "ImportExpression": {
      // Without an explicit case, ImportExpression falls into the `default`
      // escape-hatch which uses the PARENT's rawSource verbatim. When the
      // import is the argument of an `await` (`await import("path")`), the
      // parent rawSource INCLUDES the `await`, so the emitted escape-hatch raw
      // was `await import("path")` and the outer unary-await re-prefixed it →
      // `await await import("path")` (invalid double-await; also leaked the
      // `await` out of any async wrapper). Build the import text from the
      // source child so it slices ONLY `import(<spec>)`.
      const sourceNode = (node as { source: ESNode }).source;
      const sourceExpr = esTreeToExprNode(sourceNode, filePath, baseOffset, rawSource);
      const importRaw = `import(${emitStringFromTree(sourceExpr)})`;
      return {
        kind: "escape-hatch",
        span,
        nativeKind: "ImportExpression",
        raw: importRaw,
      } satisfies EscapeHatchExpr;
    }

    // ---- Binary ----
    case "BinaryExpression": {
      const op = node.operator as string;
      // Bug 5 (s87 trio-b): thread rawSource so function-with-block-body nested
      // in either operand can slice its own raw text. Real-world shape:
      // `cond && arr.filter(function(t){...}).length > 0`.
      const left = esTreeToExprNode(node.left as ESNode, filePath, baseOffset, rawSource);
      const right = esTreeToExprNode(node.right as ESNode, filePath, baseOffset, rawSource);
      // All JS binary ops are valid in the BinaryExpr union
      return { kind: "binary", span, op: op as BinaryExpr["op"], left, right } satisfies BinaryExpr;
    }

    // ---- Logical (&&, ||, ??) ----
    case "LogicalExpression": {
      const op = node.operator as string;
      // Bug 5 (s87 trio-b): thread rawSource (same shape as BinaryExpression).
      const left = esTreeToExprNode(node.left as ESNode, filePath, baseOffset, rawSource);
      const right = esTreeToExprNode(node.right as ESNode, filePath, baseOffset, rawSource);
      return { kind: "binary", span, op: op as BinaryExpr["op"], left, right } satisfies BinaryExpr;
    }

    // ---- Assignment ----
    case "AssignmentExpression": {
      const op = node.operator as string;
      // Bug M (2026-04-26): thread rawSource into both target and value
      // recursion. The right-hand side may be a FunctionExpression with a
      // BlockStatement body, which esTreeToExprNode cannot fully convert
      // and falls back to escape-hatch. Without rawSource, the slice from
      // node.start..node.end produces raw="" and the emitter drops the
      // whole RHS — leaving `obj.x = ;` in the output. (Same fix shape as
      // Bug C / 6nz 2026-04-20 for CallExpression args.)
      const target = esTreeToExprNode(node.left as ESNode, filePath, baseOffset, rawSource);
      const value = esTreeToExprNode(node.right as ESNode, filePath, baseOffset, rawSource);
      return { kind: "assign", span, op: op as AssignExpr["op"], target, value } satisfies AssignExpr;
    }

    // ---- Ternary ----
    case "ConditionalExpression": {
      // Bug 5 (s87 trio-b): thread rawSource through all three branches so a
      // function-with-block-body in any branch can slice its raw text.
      const condition = esTreeToExprNode(node.test as ESNode, filePath, baseOffset, rawSource);
      const consequent = esTreeToExprNode(node.consequent as ESNode, filePath, baseOffset, rawSource);
      const alternate = esTreeToExprNode(node.alternate as ESNode, filePath, baseOffset, rawSource);
      return { kind: "ternary", span, condition, consequent, alternate } satisfies TernaryExpr;
    }

    // ---- Member Access ----
    case "MemberExpression": {
      // Bug 5 (s87 trio-b — load-bearing site): thread rawSource into the
      // object recursion. Without this, `arr.filter(function(t){...}).length`
      // (i.e. a method call with a block-body callback chained to a member
      // access) loses the inner callback — the FunctionExpression branch tries
      // to slice rawSource.slice(start, end) and falls back to "" when
      // rawSource is undefined, producing `arr.filter().length`.
      const object = esTreeToExprNode(node.object as ESNode, filePath, baseOffset, rawSource);
      const computed = node.computed as boolean;
      const optional = node.optional as boolean ?? false;

      if (computed) {
        // Computed access: expr[index]
        // Bug 5 follow-on: thread rawSource into the index recursion as well so
        // shapes like `arr[fn(function(){...})]` survive.
        const index = esTreeToExprNode(node.property as ESNode, filePath, baseOffset, rawSource);
        return { kind: "index", span, object, index, optional } satisfies IndexExpr;
      } else {
        // Static access: expr.prop
        const propNode = node.property as ESNode;
        const property = propNode.name as string ?? (propNode.value as string);
        return { kind: "member", span, object, property, optional } satisfies MemberExpr;
      }
    }

    // ---- Optional Chain wrapper (Acorn wraps optional chains) ----
    case "ChainExpression": {
      // Acorn wraps optional chain expressions in ChainExpression
      // Recurse on the inner expression
      return esTreeToExprNode(node.expression as ESNode, filePath, baseOffset, rawSource);
    }

    // ---- Call ----
    case "CallExpression": {
      const callee = node.callee as ESNode;
      const optional = node.optional as boolean ?? false;
      const rawArgs = (node.arguments as ESNode[]) ?? [];

      // Check for scrml placeholder calls
      if (callee.type === "Identifier") {
        const calleeName = callee.name as string;

        // Bug 5 (s87 trio-b) — thread rawSource into the LHS recursion of
        // every scrml placeholder call so `(arr.filter(function(t){...}).length is not)`
        // and similar absence/variant-check shapes preserve nested callbacks.
        // §42 absence canon (S90 M-7C-D-12 Track 1): RHS injection for
        // is-not / is-some / is-not-not uses canonical `litType: "not"` with
        // `raw: "not"`. The gauntlet-phase3 walker already suppresses direct
        // operands of these absence operators (isAbsenceOp check), so the
        // synthetic RHS is never inspected as a forbidden-source-token.
        if (calleeName === "__scrml_is_not_not__") {
          const left = esTreeToExprNode(rawArgs[0] as ESNode, filePath, baseOffset, rawSource);
          const absentNode: LitExpr = { kind: "lit", span, raw: "not", value: null, litType: "not" };
          return { kind: "binary", span, op: "is-not-not", left, right: absentNode } satisfies BinaryExpr;
        }
        if (calleeName === "__scrml_is_not__") {
          const left = esTreeToExprNode(rawArgs[0] as ESNode, filePath, baseOffset, rawSource);
          const absentNode: LitExpr = { kind: "lit", span, raw: "not", value: null, litType: "not" };
          return { kind: "binary", span, op: "is-not", left, right: absentNode } satisfies BinaryExpr;
        }
        if (calleeName === "__scrml_is_some__") {
          const left = esTreeToExprNode(rawArgs[0] as ESNode, filePath, baseOffset, rawSource);
          const absentNode: LitExpr = { kind: "lit", span, raw: "not", value: null, litType: "not" };
          return { kind: "binary", span, op: "is-some", left, right: absentNode } satisfies BinaryExpr;
        }
        if (calleeName === "__scrml_is_variant__") {
          const left = esTreeToExprNode(rawArgs[0] as ESNode, filePath, baseOffset, rawSource);
          const variantLit = rawArgs[1] as ESNode;
          const variantName = variantLit.value as string ?? "";
          const right: IdentExpr = { kind: "ident", span, name: variantName };
          return { kind: "binary", span, op: "is", left, right } satisfies BinaryExpr;
        }
        if (calleeName === "__scrml_match__") {
          // First arg is subject, rest are arm strings
          const arg0 = rawArgs[0] as ESNode;
          const rawArmNodes = rawArgs.slice(1) as ESNode[];
          const rawArmsArr = rawArmNodes.map(a => a.value as string ?? "");
          // §18.19 — a multi-scrutinee head `match (e1, …, eN)` parses (after the
          // `match ` mask) as a parenthesized SequenceExpression in the subject
          // slot. Lift each sub-expression into the `subjects` list; `subject`
          // mirrors `subjects[0]` for single-scrutinee-compatible consumers.
          if (arg0 && arg0.type === "SequenceExpression" && Array.isArray((arg0 as ESNode & { expressions?: ESNode[] }).expressions)) {
            const exprs = (arg0 as ESNode & { expressions: ESNode[] }).expressions;
            if (exprs.length >= 2) {
              const subjects = exprs.map(e => esTreeToExprNode(e, filePath, baseOffset, rawSource));
              return { kind: "match-expr", span, subject: subjects[0], subjects, rawArms: rawArmsArr } satisfies MatchExpr;
            }
          }
          const subject = esTreeToExprNode(arg0, filePath, baseOffset, rawSource);
          return { kind: "match-expr", span, subject, rawArms: rawArmsArr } satisfies MatchExpr;
        }

        // §59.3 — value-native map literal placeholder unmask. The scanner
        // (preprocessMapLiterals) emitted `__scrml_map_lit__(<diagJSON>, k1, v1,
        // k2, v2, …)`. The first arg is a JSON string of the attached
        // diagnostics array; the remaining args are alternating key/value source
        // slices, each re-parsed through the full pipeline (so nested map
        // literals, bare variants, etc. inside a key/value are handled). An
        // empty `[:]` map carries only the diag arg → zero entries.
        if (calleeName === "__scrml_map_lit__") {
          const diagRaw = (rawArgs[0] as ESNode | undefined)?.value as string ?? "[]";
          let diagnostics: { code: string; message: string }[] = [];
          try {
            const parsed = JSON.parse(diagRaw);
            if (Array.isArray(parsed)) diagnostics = parsed;
          } catch { /* malformed diag payload — treat as none */ }
          const pairNodes = rawArgs.slice(1) as ESNode[];
          const entries: MapEntry[] = [];
          for (let p = 0; p + 1 < pairNodes.length; p += 2) {
            const keyText = (pairNodes[p].value as string) ?? "";
            const valText = (pairNodes[p + 1].value as string) ?? "";
            const key = parseExprToNode(keyText, filePath, baseOffset);
            const value = parseExprToNode(valText, filePath, baseOffset);
            entries.push({ key, value });
          }
          const lit: MapLitExpr = { kind: "map-lit", span, entries };
          if (diagnostics.length > 0) lit.diagnostics = diagnostics;
          return lit;
        }

        // §6.8.2 — `reset(<expr>)` is a language keyword expression. Lift the
        // bare-Identifier `reset` callee form into a structurally-distinct
        // `reset-expr` node so downstream passes (A1b target validation,
        // A1c codegen lowering) can recognise it without re-checking the name.
        // Member calls (e.g. `obj.reset(x)`) are NOT touched — those are
        // ordinary method calls. Callee-shape: must be a bare Identifier here.
        // Diagnostics for malformed shape are attached to the node and
        // surfaced by the ast-builder wrapper as a TABError (E-RESET-NO-ARG).
        if (calleeName === "reset") {
          // Spread arguments are not legal for reset(); A1b will further
          // validate target shape. At parse time we treat them as malformed.
          const hasSpread = rawArgs.some(a => a.type === "SpreadElement");
          // Diagnose zero-arg / multi-arg / spread shapes. The single-arg
          // happy path produces a clean reset-expr without diagnostic.
          if (rawArgs.length === 0) {
            // Zero-arg form: synthesize an absence-literal target so the
            // node carries a valid shape; A1b can ignore the target since
            // the E-RESET-NO-ARG diagnostic prevents further codegen.
            // §42 absence canon (S90 M-7C-D-12 Track 1): use `litType: "not"`
            // (canonical) instead of the deprecated `"undefined"` variant.
            const absentTarget: LitExpr = {
              kind: "lit", span,
              raw: "not", value: null,
              litType: "not",
            };
            return {
              kind: "reset-expr", span,
              target: absentTarget,
              diagnostic: {
                code: "E-RESET-NO-ARG",
                message:
                  "E-RESET-NO-ARG: `reset()` called with no argument. The `reset` keyword "
                  + "requires an explicit cell argument: `reset(@cell)` or "
                  + "`reset(@compound.field)` (§6.8.2).",
              },
            } satisfies ResetExpr;
          }
          if (rawArgs.length > 1 || hasSpread) {
            // Multi-arg or spread form: keep the first non-spread argument as
            // the target so A1b can still typecheck a target shape; emit
            // E-RESET-NO-ARG with an arity-specific message (single error code
            // per Step 9 survey decision — see progress.md).
            const firstArg = rawArgs.find(a => a.type !== "SpreadElement") as ESNode | undefined;
            // §42 absence canon (S90 M-7C-D-12 Track 1): synthetic fallback
            // target uses canonical `litType: "not"` (deprecated "undefined"
            // variant no longer manufactured). The diagnostic still fires.
            const target: ExprNode = firstArg
              ? esTreeToExprNode(firstArg, filePath, baseOffset, rawSource)
              : { kind: "lit", span, raw: "not", value: null, litType: "not" } satisfies LitExpr;
            const detail = hasSpread
              ? "spread arguments are not permitted"
              : `expected exactly one argument, got ${rawArgs.length}`;
            return {
              kind: "reset-expr", span,
              target,
              diagnostic: {
                code: "E-RESET-NO-ARG",
                message:
                  `E-RESET-NO-ARG: \`reset(...)\` ${detail}. The \`reset\` keyword `
                  + `requires exactly one cell argument: \`reset(@cell)\` or `
                  + `\`reset(@compound.field)\` (§6.8.2).`,
              },
            } satisfies ResetExpr;
          }
          // Happy path: exactly one non-spread argument.
          const target = esTreeToExprNode(rawArgs[0] as ESNode, filePath, baseOffset, rawSource);
          return { kind: "reset-expr", span, target } satisfies ResetExpr;
        }
      }

      // Normal call
      const calleeExpr = esTreeToExprNode(callee, filePath, baseOffset, rawSource);
      // Thread rawSource into arg recursion so arrow-with-block-body args
      // can slice their own raw text for the escape-hatch fallback
      // (Bug C — 6nz inbound 2026-04-20).
      const args = rawArgs.map(a => {
        if (a.type === "SpreadElement") {
          const arg = esTreeToExprNode((a as { argument: ESNode }).argument, filePath, baseOffset, rawSource);
          return { kind: "spread" as const, span: spanFromEstree(a, filePath, baseOffset), argument: arg } satisfies SpreadExpr;
        }
        return esTreeToExprNode(a, filePath, baseOffset, rawSource);
      });
      return { kind: "call", span, callee: calleeExpr, args, optional } satisfies CallExpr;
    }

    // ---- New ----
    case "NewExpression": {
      // Bug 5 (s87 trio-b): thread rawSource through callee and args so a
      // function-with-block-body inside `new Cls(function(){...})` survives.
      const calleeExpr = esTreeToExprNode(node.callee as ESNode, filePath, baseOffset, rawSource);
      const rawArgs = (node.arguments as ESNode[]) ?? [];
      const args = rawArgs.map(a => {
        if (a.type === "SpreadElement") {
          const arg = esTreeToExprNode((a as { argument: ESNode }).argument, filePath, baseOffset, rawSource);
          return { kind: "spread" as const, span: spanFromEstree(a, filePath, baseOffset), argument: arg } satisfies SpreadExpr;
        }
        return esTreeToExprNode(a, filePath, baseOffset, rawSource);
      });
      return { kind: "new", span, callee: calleeExpr, args } satisfies NewExpr;
    }

    // ---- Array ----
    case "ArrayExpression": {
      // Bug 5 (s87 trio-b): thread rawSource through every element so a
      // function-with-block-body inside an array literal survives.
      const elements = ((node.elements as (ESNode | null)[]) ?? []).map(el => {
        // §42 absence canon (S90 M-7C-D-12 Track 1): array holes (`[1,,3]`)
        // synthesize an absence literal at the hole position. Canonical
        // `litType: "not"` replaces the deprecated `"undefined"` variant.
        // Emit semantics: `litType: "not"` compiles to JS `null` per §42.5/§42.8
        // (was previously JS `undefined`); this aligns with scrml absence ABI.
        if (!el) return { kind: "lit" as const, span, raw: "not", value: null, litType: "not" as const } satisfies LitExpr;
        if (el.type === "SpreadElement") {
          const arg = esTreeToExprNode((el as { argument: ESNode }).argument, filePath, baseOffset, rawSource);
          return { kind: "spread" as const, span: spanFromEstree(el, filePath, baseOffset), argument: arg } satisfies SpreadExpr;
        }
        return esTreeToExprNode(el, filePath, baseOffset, rawSource);
      });
      return { kind: "array", span, elements } satisfies ArrayExpr;
    }

    // ---- Object ----
    case "ObjectExpression": {
      // Bug 5 (s87 trio-b): thread rawSource through computed-key / value so a
      // function-with-block-body inside an object literal survives.
      const props: ObjectProp[] = ((node.properties as ESNode[]) ?? []).map(p => {
        const propSpan = spanFromEstree(p, filePath, baseOffset);
        if (p.type === "SpreadElement") {
          const arg = esTreeToExprNode((p as { argument: ESNode }).argument, filePath, baseOffset, rawSource);
          return { kind: "spread" as const, argument: arg, span: propSpan } satisfies Extract<ObjectProp, { kind: "spread" }>;
        }
        // Property
        const keyNode = (p as { key: ESNode }).key;
        const computed = (p as { computed?: boolean }).computed ?? false;
        const shorthand = (p as { shorthand?: boolean }).shorthand ?? false;
        const valueNode = (p as { value: ESNode }).value;

        if (shorthand && keyNode.type === "Identifier") {
          return { kind: "shorthand" as const, name: keyNode.name as string, span: propSpan } satisfies Extract<ObjectProp, { kind: "shorthand" }>;
        }

        // S66 bare-variant placeholder unmask in KEY position. The preprocessor
        // masks `.Variant` → `__scrml_bare_variant_Variant__` so acorn can parse
        // the surrounding literal; a `.Variant` used as a NON-computed object key
        // (`registerMessages({.Required: fn})`, §55.10 L2 / §41.12) lands here as
        // an Identifier key still carrying the placeholder. Restore the BARE
        // variant name (no leading dot) so the emitted property name matches the
        // runtime enum-tag string the store is keyed on (`_scrml_messages_register`
        // keys on `error.tag` = "Required"). Without this the key leaked as the
        // literal placeholder and every Level-2 registered-message lookup missed.
        let rawKeyName = computed
          ? null
          : (keyNode.name as string ?? keyNode.value as string ?? "");
        if (
          typeof rawKeyName === "string" &&
          rawKeyName.startsWith("__scrml_bare_variant_") &&
          rawKeyName.endsWith("__")
        ) {
          rawKeyName = rawKeyName.slice("__scrml_bare_variant_".length, -2);
        }
        const key: string | ExprNode = computed
          ? esTreeToExprNode(keyNode, filePath, baseOffset, rawSource)
          : (rawKeyName as string);
        const value = esTreeToExprNode(valueNode, filePath, baseOffset, rawSource);
        return { kind: "prop" as const, key, value, computed, span: propSpan } satisfies Extract<ObjectProp, { kind: "prop" }>;
      });
      return { kind: "object", span, props } satisfies ObjectExpr;
    }

    // ---- Arrow Function / Function Expression ----
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const isAsync = node.async as boolean ?? false;
      const fnStyle: LambdaExpr["fnStyle"] =
        node.type === "ArrowFunctionExpression" ? "arrow" : "function";
      const params = convertParams((node.params as ESNode[]) ?? [], filePath, baseOffset);
      const bodyNode = node.body as ESNode;

      if (bodyNode.type !== "BlockStatement") {
        // Expression body: `x => expr`
        const value = esTreeToExprNode(bodyNode, filePath, baseOffset);
        return {
          kind: "lambda", span, params, isAsync, fnStyle,
          body: { kind: "expr", value },
        } satisfies LambdaExpr;
      }

      // Block body: we cannot fully convert block statements in Phase 1.
      // Convert to EscapeHatchExpr with the raw body text.
      //
      // Bug C (6nz 2026-04-20): the call site `esTreeToExprNode(callExpr, ...)`
      // recursed into its args without threading `rawSource`, so every arrow
      // in call-argument position (e.g. `arr.map((n, i) => { ... })`) got an
      // escape-hatch with raw="". The downstream emitter dropped the empty
      // raw, producing `arr.map()` — the whole callback silently lost.
      //
      // Fix: when rawSource is available, slice the arrow's own substring
      // using the ESTree node's start/end offsets (same coordinate space).
      // The slice is validated to look like a function form before use;
      // otherwise fall back to the whole source (old behavior).
      const nodeStart = (node as { start?: number }).start;
      const nodeEnd = (node as { start?: number; end?: number }).end;
      let rawSlice = "";
      if (
        rawSource != null &&
        typeof nodeStart === "number" &&
        typeof nodeEnd === "number" &&
        nodeStart >= 0 &&
        nodeEnd <= rawSource.length &&
        nodeEnd > nodeStart
      ) {
        const candidate = rawSource.slice(nodeStart, nodeEnd);
        // Minimal shape check: an arrow fn starts with `(`, `async`, or a
        // bare ident (the single-param form `x => ...`); a function fn
        // starts with `function`. Also require that the candidate contains
        // the arrow token (or `function` keyword) so we don't accept a
        // slice that happens to start with a letter but is some unrelated
        // prefix caused by preprocessing offset shift.
        const c = candidate.trimStart();
        const looksLikeArrow = /^(async\s+)?(\(|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/.test(c) && c.includes("=>");
        const looksLikeFn = /^(async\s+)?function\b/.test(c);
        if (looksLikeArrow || looksLikeFn) {
          rawSlice = candidate;
        }
        // If validation fails, rawSlice stays "" — same as pre-fix behavior.
      }
      return makeEscapeHatch(node, span, rawSlice);
    }

    // ---- Sequence Expression (a, b, c) — not common but valid ----
    case "SequenceExpression": {
      // Model as nested binary with comma op — use EscapeHatch for now
      return makeEscapeHatch(node, span, rawSource ?? "");
    }

    // ---- Spread (in spread position, handled by parent; standalone is escape hatch) ----
    case "SpreadElement": {
      const argument = esTreeToExprNode((node as { argument: ESNode }).argument, filePath, baseOffset);
      return { kind: "spread", span, argument } satisfies SpreadExpr;
    }

    // ---- Parenthesized expression (Acorn doesn't emit a node for these — transparent) ----

    default: {
      // Unknown ESTree node type — emit escape hatch
      return makeEscapeHatch(node, span, rawSource ?? "");
    }
  }
}

/** Create an EscapeHatchExpr for an unsupported ESTree node type. */
function makeEscapeHatch(node: ESNode, span: ExprSpan, rawSource: string): EscapeHatchExpr {
  return {
    kind: "escape-hatch",
    span,
    nativeKind: node.type,
    raw: rawSource,
  } satisfies EscapeHatchExpr;
}

/** Convert ESTree parameter nodes to LambdaParam[]. */
function convertParams(params: ESNode[], filePath: string, baseOffset: number): LambdaParam[] {
  return params.map(p => {
    if (p.type === "Identifier") {
      return { name: p.name as string };
    }
    if (p.type === "RestElement") {
      const arg = (p as { argument: ESNode }).argument;
      return { name: arg.name as string ?? "", isRest: true };
    }
    if (p.type === "AssignmentPattern") {
      const left = (p as { left: ESNode }).left;
      const right = (p as { right: ESNode }).right;
      const defaultValue = esTreeToExprNode(right, filePath, baseOffset);
      return { name: left.name as string ?? "", defaultValue };
    }
    // Destructured patterns — not yet structured
    return { name: "__destructured__" };
  });
}

// ---------------------------------------------------------------------------
// parseExprToNode — top-level entry point
// ---------------------------------------------------------------------------

/**
 * Parse a scrml expression string into a structured ExprNode.
 *
 * @param raw - The raw expression string (as produced by collectExpr / joinWithNewlines)
 * @param filePath - Absolute path of the source file (for span reporting)
 * @param offset - Byte offset of the expression start in the preprocessed source file
 * @returns A structured ExprNode. Returns EscapeHatchExpr on parse failure.
 */
export function parseExprToNode(raw: string, filePath: string, offset: number, opts?: { tildeActive?: boolean }): ExprNode {
  // §42.10 ENFORCEMENT (S188 g-not-negation-enforce): a detector object captures
  // whether preprocessForAcorn lowered a prefix-`not`-as-negation (bare `not @x`
  // OR parenthesized `not (expr)`) ANYWHERE in this expression. When it fires we
  // stamp `_notPrefixNegation` onto the returned ExprNode; the type-system harvest
  // walk (harvestNotPrefixNegation) emits E-TYPE-045 once per stamped node. This
  // covers ALL expression positions + BOTH forms with a single source of truth
  // (the lowering choke-point), since every expression flows through this fn once.
  //
  // §45.5 (S237): the same detector object also captures `valueRhsOnIs` — an
  // `is <value>` form (`x is 0` / `x is @other`) whose RHS is neither a
  // sanctioned absence/presence keyword nor a `.Variant` pattern. When it fires
  // we stamp `_isValueRhsOnIs`; the gauntlet-phase3 §45 harvest fires E-EQ-005
  // (once per stamped node) BEFORE codegen, steering the author to `==`.
  const _detector = { notPrefixNegation: false, valueRhsOnIs: false };
  const _node = _parseExprToNodeInner(raw, filePath, offset, opts, _detector);
  if (_node && typeof _node === "object") {
    if (_detector.notPrefixNegation) (_node as Record<string, unknown>)._notPrefixNegation = true;
    if (_detector.valueRhsOnIs) (_node as Record<string, unknown>)._isValueRhsOnIs = true;
  }
  return _node;
}

function _parseExprToNodeInner(raw: string, filePath: string, offset: number, opts?: { tildeActive?: boolean }, _notDetector?: { notPrefixNegation: boolean; valueRhsOnIs?: boolean }): ExprNode {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    // Empty expression — return an absence-literal placeholder.
    // §42 absence canon (S90 M-7C-D-12 Track 1): canonical `litType: "not"`
    // with empty `raw`. The empty raw distinguishes from a user-source `null`
    // (which would have `raw: "null"`); the gauntlet-phase3 detector only
    // fires on `raw: "null"` / `raw: "undefined"`.
    const span: ExprSpan = { file: filePath, start: offset, end: offset, line: 1, col: 1 };
    return { kind: "lit", span, raw: "", value: null, litType: "not" } satisfies LitExpr;
  }

  const trimmed = raw.trim();

  // Apply scrml-specific preprocessing to convert `is`/`match` etc.
  let processed = trimmed;

  // Preprocessing for scrml-specific operators
  processed = preprocessForAcorn(processed, { tildeActive: opts?.tildeActive }, _notDetector);

  // Standard parseExpression preprocessing (SQL, input-state, worker refs)
  // parseExpression already does this, but we also do it here so we can
  // pass the pre-processed string directly if needed.

  // Try to parse the processed expression
  let estree: ESNode | null = null;
  let parseError: string | null = null;

  let trailingContent: string | undefined;
  let sqlDiagnostic: { code: string; message: string; offset: number } | undefined;
  let exponentDiagnostic: { code: string; message: string; offset: number } | undefined;
  let fnArrowDiagnostic: { code: string; message: string; offset: number } | undefined;
  try {
    const result = parseExpression(processed);
    estree = result.ast;
    parseError = result.error;
    trailingContent = result.trailingContent;
    sqlDiagnostic = result.sqlDiagnostic;
    exponentDiagnostic = result.exponentDiagnostic;
    fnArrowDiagnostic = result.fnArrowDiagnostic;
  } catch (e) {
    parseError = (e as Error).message;
  }

  // F-SQL-001: if the SQL scanner flagged an unbalanced ?{}, surface it as a
  // hard error by attaching it to the returned escape-hatch (ast-builder
  // converts to a TABError). This does NOT change behaviour for well-formed
  // ?{...${}...} blocks — those parse cleanly via the bracket-matched scanner.
  if (sqlDiagnostic) {
    const span: ExprSpan = { file: filePath, start: offset + sqlDiagnostic.offset, end: offset + trimmed.length, line: 1, col: 1 };
    return {
      kind: "escape-hatch",
      span,
      nativeKind: "SqlPlaceholderError",
      raw: trimmed,
      sqlDiagnostic,
    } as EscapeHatchExpr & { sqlDiagnostic: { code: string; message: string; offset: number } };
  }

  // Trailing-content guard: detect silent data loss from merged statements.
  // The ASI bug in collectExpr produces init strings like "false\nupdateDisplay()"
  // where two statements are merged. parseExpressionAt parses the first expression
  // and the rest is silently dropped. Warn when trailing content contains a newline
  // followed by code — this is the signature of the ASI merge bug.
  // Single-line trailing content (e.g., tokenizer-spaced "header ( )") is typically
  // from the space-separated token stream, not from merged statements.
  if (estree && trailingContent && trailingContent.includes("\n") && /[a-zA-Z_$@]/.test(trailingContent)) {
    const preview = trailingContent.length > 60 ? trailingContent.slice(0, 60) + "..." : trailingContent;
    console.warn(`[scrml] warning: statement boundary not detected — trailing content would be silently dropped: "${preview}" (in ${filePath} near offset ${offset})`);
  }

  if (!estree) {
    // Parse failed — return escape hatch. B1: when acorn rejected a unary base
    // of `**`, carry the structured diagnostic so ast-builder surfaces a LOUD
    // E-CODEGEN-INVALID-LOGIC (mirrors the sqlDiagnostic escape-hatch path).
    const span: ExprSpan = { file: filePath, start: offset, end: offset + trimmed.length, line: 1, col: 1 };
    return {
      kind: "escape-hatch",
      span,
      nativeKind: "ParseError",
      raw: trimmed,
      ...(exponentDiagnostic ? { exponentDiagnostic } : {}),
      ...(fnArrowDiagnostic ? { fnArrowDiagnostic } : {}),
    } as EscapeHatchExpr & {
      exponentDiagnostic?: { code: string; message: string; offset: number };
      fnArrowDiagnostic?: { code: string; message: string; offset: number };
    };
  }

  try {
    // S97 bug fix: pass `processed` (not `trimmed`) as rawSource so that
    // FunctionExpression/ArrowFunctionExpression escape-hatch slices
    // (esTreeToExprNode line 1466) align with acorn's reported start/end
    // positions. Acorn parsed `processed`; its nodeStart/nodeEnd are in
    // processed coordinates. preprocessForAcorn shrinks (`::` → `.`) and
    // grows (`is not` → `__scrml_is_not__(...)`) the string, so passing
    // `trimmed` desynchronized the slice. The escape-hatch raw is then fed
    // through rewriteExpr's string-rewrite pipeline, which idempotently
    // handles preprocessed forms (e.g. `Mode.A` is valid JS for what was
    // originally `Mode::A`).
    return esTreeToExprNode(estree, filePath, offset, processed);
  } catch (e) {
    const span: ExprSpan = { file: filePath, start: offset, end: offset + trimmed.length, line: 1, col: 1 };
    return {
      kind: "escape-hatch",
      span,
      nativeKind: "ConversionError",
      raw: trimmed,
    } satisfies EscapeHatchExpr;
  }
}

// ---------------------------------------------------------------------------
// emitStringFromTree — ExprNode → string (round-trip invariant check)
// ---------------------------------------------------------------------------
//
// Converts an ExprNode back to a token-joined string that should be equivalent
// to the original string-form field (modulo whitespace normalization).
//
// Whitespace normalization rule: collapse multiple spaces to single space, trim.
// This matches collectExpr's joinWithNewlines which adds spaces between tokens.
//
// Design doc §5.2: "the invariant check may fail on whitespace differences.
// Mitigation: normalize whitespace in the invariant check."
// ---------------------------------------------------------------------------

/**
 * Emit a string from an ExprNode tree.
 *
 * The result is equivalent to the original expression string modulo whitespace
 * normalization. Used for the Phase 1 round-trip invariant tests.
 *
 * @param node - The ExprNode to emit
 * @returns String representation of the expression
 */
// Binary-operator precedence (JS; higher binds tighter) — used by emitStringFromTree to parenthesize
// a binary/ternary/assign operand whose precedence is lower than its parent op's, so re-serialization
// preserves grouping (g-emit-string-tree-paren-drop, S205: `(a + b) % c` must not re-emit as `a + b % c`).
const BIN_PREC: Record<string, number> = {
  "??": 3, "||": 4, "&&": 5, "|": 6, "^": 7, "&": 8,
  "==": 9, "!=": 9, "===": 9, "!==": 9,
  "<": 10, "<=": 10, ">": 10, ">=": 10, "in": 10, "instanceof": 10,
  "<<": 11, ">>": 11, ">>>": 11,
  "+": 12, "-": 12,
  "*": 13, "/": 13, "%": 13,
  "**": 14,
};
// scrml `is` / `is some` / `is not` / `is not not` predicates bind tighter than arithmetic (the parser's
// LHS scanner stops at any binary operator — see §"is some" scanner notes), so `(a + b) is some` needs parens.
const IS_PREC = 15;
function exprPrec(node: ExprNode): number {
  if (node.kind === "binary") {
    const op = (node as { op: string }).op;
    if (op === "is" || op === "is-not" || op === "is-some" || op === "is-not-not") return IS_PREC;
    return BIN_PREC[op] ?? 0;
  }
  if (node.kind === "ternary") return 2;
  if (node.kind === "assign") return 1;
  if (node.kind === "lambda") return 1;
  return 99; // atomic / tighter-binding (ident · lit · member · call · index · unary · array · object)
}

// g-paren-binary-group-dropped-before-method (ss3, S210) — receiver-paren guard,
// the round-trip twin of emit-expr.ts:receiverNeedsParens. Member/index/call/new
// all bind tighter than every operator, so a receiver/callee whose top form is a
// looser operator (binary, ternary, assign, unary, arrow) needs re-wrapping —
// else `(a + b).m()` round-trips as `a + b.m()` (method binds to `b` alone).
// Sibling of the S205 g-emit-string-tree-paren-drop binary-OPERAND fix above.
// `exprPrec` lumps `unary` in with the atomics (99), so kind-match instead.
function receiverNeedsParensRT(node: ExprNode): boolean {
  switch (node.kind) {
    case "binary":
    case "ternary":
    case "assign":
    case "unary":
    case "lambda":
      return true;
    default:
      return false;
  }
}

function emitReceiverRT(node: ExprNode): string {
  const s = emitStringFromTree(node);
  return receiverNeedsParensRT(node) ? `(${s})` : s;
}

export function emitStringFromTree(node: ExprNode): string {
  switch (node.kind) {
    case "ident":
      return node.name;

    case "lit": {
      // §42 absence canon (S90 M-7C-D-12 Track 1): all parser sites manufacture
      // `litType: "not"`. Round-trip uses `raw` to preserve source-token
      // provenance ("null" / "undefined" for user-source forbidden tokens,
      // "not" for the scrml canonical keyword, "" for empty-expression
      // placeholders). The deprecated `"null"` / `"undefined"` litType branches
      // remain for older AST snapshots / defensive-coded consumers.
      if (node.litType === "not") {
        if (node.raw === "null") return "null";
        if (node.raw === "undefined") return "undefined";
        return "not";
      }
      if (node.litType === "null") return node.raw || "null";
      if (node.litType === "undefined") return "undefined";
      return node.raw;
    }

    case "array": {
      const elems = node.elements.map(e => emitStringFromTree(e as ExprNode)).join(", ");
      return `[${elems}]`;
    }

    case "object": {
      const props = node.props.map(p => {
        if (p.kind === "spread") return `...${emitStringFromTree(p.argument)}`;
        if (p.kind === "shorthand") return p.name;
        const keyStr = typeof p.key === "string"
          ? (p.computed ? `[${p.key}]` : p.key)
          : (p.computed ? `[${emitStringFromTree(p.key)}]` : emitStringFromTree(p.key));
        return `${keyStr}: ${emitStringFromTree(p.value)}`;
      });
      return `{${props.length > 0 ? " " + props.join(", ") + " " : ""}}`;
    }

    case "spread":
      return `...${emitStringFromTree(node.argument)}`;

    case "unary": {
      const arg = emitStringFromTree(node.argument);
      if (!node.prefix) return `${arg}${node.op}`;
      // Special keyword operators need a space
      const needsSpace = ["typeof", "void", "delete", "await"].includes(node.op);
      if (needsSpace) return `${node.op} ${arg}`;
      // B3 (g-double-unary-minus-emit-decrement) — round-trip twin of
      // emit-expr.ts:emitUnary. A prefix `-`/`+` over an operand that serializes
      // starting with the same sign char would fuse into the `--`/`++` UPDATE
      // operator (`-(-@a)` -> `--@a`). Insert ONE space so they stay distinct
      // unary operators (`- -@a`). `++`/`--` update ops + `!!`/`~~` are excluded.
      if ((node.op === "-" || node.op === "+") && arg.charCodeAt(0) === node.op.charCodeAt(0)) {
        return `${node.op} ${arg}`;
      }
      return `${node.op}${arg}`;
    }

    case "binary": {
      const isPred = node.op === "is" || node.op === "is-not" || node.op === "is-some" || node.op === "is-not-not";
      const parentPrec = isPred ? IS_PREC : (BIN_PREC[node.op] ?? 0);
      const rightAssoc = node.op === "**"; // only ** is right-associative among JS binaries
      // Wrap an operand if its precedence is lower than the parent op's, OR equal-and-on-the-
      // associativity-losing side (left operand of a right-assoc op, or right operand of a
      // left-assoc op). This is the minimal-parens rule; deterministic → idempotent round-trip.
      const wrap = (child: ExprNode, tieNeedsParen: boolean): string => {
        const s = emitStringFromTree(child);
        const cp = exprPrec(child);
        return (cp < parentPrec || (tieNeedsParen && cp === parentPrec)) ? `(${s})` : s;
      };
      // g-unary-left-of-exponent-no-paren (ss21) — round-trip twin of
      // emit-expr.ts binaryOperandNeedsParens. JS grammar forbids an
      // un-parenthesized UnaryExpression as the LEFT operand of `**`
      // (`-@a ** 2` is a SyntaxError), so it MUST round-trip as `(-@a) ** 2`.
      // `exprPrec` lumps `unary` with the atomics (99), so the generic `wrap`
      // never parens it; force the wrap here. UPDATE operators (`++`/`--`,
      // prefix or postfix) are UpdateExpressions — valid `**` bases — so they
      // are excluded. Only the LEFT operand is affected (`@a ** -@b` is legal).
      const leftIsUnaryExpExponentBase =
        node.op === "**" &&
        node.left.kind === "unary" &&
        (node.left as UnaryExpr).op !== "++" &&
        (node.left as UnaryExpr).op !== "--";
      const left = leftIsUnaryExpExponentBase
        ? `(${emitStringFromTree(node.left)})`
        : wrap(node.left, rightAssoc);
      switch (node.op) {
        case "is": return `${left} is ${emitStringFromTree(node.right)}`;
        case "is-not": return `${left} is not`;
        case "is-some": return `${left} is some`;
        case "is-not-not": return `${left} is not not`;
        default: return `${left} ${node.op} ${wrap(node.right, !rightAssoc)}`;
      }
    }

    case "assign": {
      const target = emitStringFromTree(node.target);
      const value = emitStringFromTree(node.value);
      return `${target} ${node.op} ${value}`;
    }

    case "ternary": {
      const cond = emitStringFromTree(node.condition);
      const cons = emitStringFromTree(node.consequent);
      const alt = emitStringFromTree(node.alternate);
      return `${cond} ? ${cons} : ${alt}`;
    }

    case "member": {
      const obj = emitReceiverRT(node.object);
      const sep = node.optional ? "?." : ".";
      return `${obj}${sep}${node.property}`;
    }

    case "index": {
      const obj = emitReceiverRT(node.object);
      const idx = emitStringFromTree(node.index);
      const sep = node.optional ? "?." : "";
      return `${obj}${sep}[${idx}]`;
    }

    case "call": {
      const callee = emitReceiverRT(node.callee);
      const args = node.args.map(a => emitStringFromTree(a as ExprNode)).join(", ");
      const sep = node.optional ? "?." : "";
      return `${callee}${sep}(${args})`;
    }

    case "new": {
      const callee = emitReceiverRT(node.callee);
      const args = node.args.map(a => emitStringFromTree(a as ExprNode)).join(", ");
      return `new ${callee}(${args})`;
    }

    case "lambda": {
      const params = node.params.map(p => {
        let s = p.isLin ? `lin ${p.name}` : p.name;
        if (p.typeAnnotation) s += `: ${p.typeAnnotation}`;
        if (p.defaultValue) s += ` = ${emitStringFromTree(p.defaultValue)}`;
        if (p.isRest) s = `...${p.name}`;
        return s;
      });
      const paramStr = params.length === 1 && !node.params[0].isRest ? params[0] : `(${params.join(", ")})`;

      if (node.body.kind === "expr") {
        let bodyStr = emitStringFromTree(node.body.value);
        // Arrow functions returning object literals need parentheses to avoid
        // ambiguity with block statements: `x => ({ a: 1 })` not `x => { a: 1 }`
        if (node.body.value.kind === "object") {
          bodyStr = `(${bodyStr})`;
        }
        if (node.fnStyle === "arrow") {
          return node.isAsync ? `async ${paramStr} => ${bodyStr}` : `${paramStr} => ${bodyStr}`;
        }
        // fn style — emit as arrow for Phase 1 round-trip
        return node.isAsync ? `async ${paramStr} => ${bodyStr}` : `${paramStr} => ${bodyStr}`;
      }

      // Block body — not fully structured in Phase 1, raw text unavailable
      // This path only reached if LambdaExpr with block body was somehow constructed;
      // in practice Phase 1 block bodies become EscapeHatchExpr.
      return "/* block body */";
    }

    case "cast":
      return `${emitStringFromTree(node.expression)} as ${node.targetType}`;

    case "match-expr": {
      const subject = emitStringFromTree(node.subject);
      const arms = node.rawArms.join(" ");
      return `match ${subject} { ${arms} }`;
    }

    case "sql-ref":
      return `?{ /* sql */ }`;

    case "input-state-ref":
      return `<#${node.name}>`;

    case "escape-hatch":
      // Emit verbatim — the escape hatch preserves the raw source
      return node.raw;

    case "reset-expr": {
      // §6.8.2 — round-trip emit as `reset(<target>)`. Diagnostic-bearing
      // nodes still emit the same string (the diagnostic surfaces separately
      // through the ast-builder wrapper); this keeps the round-trip stable.
      return `reset(${emitStringFromTree(node.target)})`;
    }

    case "map-lit": {
      // §59.3 — round-trip emit as `[:]` (empty) or `[k: v, …]` (map literal).
      if (node.entries.length === 0) return "[:]";
      const entries = node.entries
        .map(e => `${emitStringFromTree(e.key)}: ${emitStringFromTree(e.value)}`)
        .join(", ");
      return `[${entries}]`;
    }

    default: {
      // Exhaustive check
      const _never: never = node;
      return "";
    }
  }
}

/**
 * Normalize whitespace in a string for round-trip invariant comparison.
 * Collapses multiple spaces/newlines to single space, trims.
 * This is the normalization function used by invariant tests.
 */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// deepEqualExprNode — structural equality for ExprNode trees
// ---------------------------------------------------------------------------
//
// Compares two ExprNode trees structurally, ignoring `span` fields.
// Spans are excluded because reparsed nodes start at offset 0 while the
// original nodes may have real source offsets — spans differ by design.
//
// This is the correct equivalence relation for the idempotency invariant:
//   parse(emit(node)) deepEquals node
//
// Escape-hatch nodes: compared by normalized raw string content.
// All other kinds: strict structural equality on non-span fields.
// ---------------------------------------------------------------------------

/**
 * Structural deep equality for ExprNode trees.
 * Ignores `span` fields on all nodes.
 * Escape-hatch nodes compare by whitespace-normalized `raw`.
 *
 * @returns true if a and b are structurally equal (ignoring spans).
 */
export function deepEqualExprNode(a: ExprNode, b: ExprNode): boolean {
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "ident": {
      const bNode = b as typeof a;
      return a.name === bNode.name;
    }

    case "lit": {
      const bNode = b as typeof a;
      if (a.litType !== bNode.litType) return false;
      // Compare raw for template literals; compare value for all others
      if (a.litType === "template") return a.raw === bNode.raw;
      // NaN != NaN in JS, but structurally equal
      if (typeof a.value === "number" && typeof bNode.value === "number") {
        if (isNaN(a.value) && isNaN(bNode.value)) return true;
      }
      return a.value === bNode.value;
    }

    case "array": {
      const bNode = b as typeof a;
      if (a.elements.length !== bNode.elements.length) return false;
      return a.elements.every((el, i) =>
        deepEqualExprNode(el as ExprNode, bNode.elements[i] as ExprNode)
      );
    }

    case "object": {
      const bNode = b as typeof a;
      if (a.props.length !== bNode.props.length) return false;
      return a.props.every((p, i) => {
        const q = bNode.props[i];
        if (p.kind !== q.kind) return false;
        if (p.kind === "spread" && q.kind === "spread") {
          return deepEqualExprNode(p.argument, q.argument);
        }
        if (p.kind === "shorthand" && q.kind === "shorthand") {
          return p.name === q.name;
        }
        if (p.kind === "prop" && q.kind === "prop") {
          if (p.computed !== q.computed) return false;
          const keysEqual = typeof p.key === "string" && typeof q.key === "string"
            ? p.key === q.key
            : typeof p.key === "object" && typeof q.key === "object"
              ? deepEqualExprNode(p.key, q.key)
              : false;
          return keysEqual && deepEqualExprNode(p.value, q.value);
        }
        return false;
      });
    }

    case "spread": {
      const bNode = b as typeof a;
      return deepEqualExprNode(a.argument, bNode.argument);
    }

    case "unary": {
      const bNode = b as typeof a;
      return a.op === bNode.op
        && a.prefix === bNode.prefix
        && deepEqualExprNode(a.argument, bNode.argument);
    }

    case "binary": {
      const bNode = b as typeof a;
      return a.op === bNode.op
        && deepEqualExprNode(a.left, bNode.left)
        && deepEqualExprNode(a.right, bNode.right);
    }

    case "assign": {
      const bNode = b as typeof a;
      return a.op === bNode.op
        && deepEqualExprNode(a.target, bNode.target)
        && deepEqualExprNode(a.value, bNode.value);
    }

    case "ternary": {
      const bNode = b as typeof a;
      return deepEqualExprNode(a.condition, bNode.condition)
        && deepEqualExprNode(a.consequent, bNode.consequent)
        && deepEqualExprNode(a.alternate, bNode.alternate);
    }

    case "member": {
      const bNode = b as typeof a;
      return a.property === bNode.property
        && a.optional === bNode.optional
        && deepEqualExprNode(a.object, bNode.object);
    }

    case "index": {
      const bNode = b as typeof a;
      return a.optional === bNode.optional
        && deepEqualExprNode(a.object, bNode.object)
        && deepEqualExprNode(a.index, bNode.index);
    }

    case "call": {
      const bNode = b as typeof a;
      if (a.optional !== bNode.optional) return false;
      if (a.args.length !== bNode.args.length) return false;
      return deepEqualExprNode(a.callee, bNode.callee)
        && a.args.every((arg, i) =>
          deepEqualExprNode(arg as ExprNode, bNode.args[i] as ExprNode)
        );
    }

    case "new": {
      const bNode = b as typeof a;
      if (a.args.length !== bNode.args.length) return false;
      return deepEqualExprNode(a.callee, bNode.callee)
        && a.args.every((arg, i) =>
          deepEqualExprNode(arg as ExprNode, bNode.args[i] as ExprNode)
        );
    }

    case "lambda": {
      const bNode = b as typeof a;
      if (a.fnStyle !== bNode.fnStyle) return false;
      if (a.isAsync !== bNode.isAsync) return false;
      if (a.params.length !== bNode.params.length) return false;
      const paramsEqual = a.params.every((p, i) => {
        const q = bNode.params[i];
        if (p.name !== q.name) return false;
        if ((p.isRest ?? false) !== (q.isRest ?? false)) return false;
        if ((p.isLin ?? false) !== (q.isLin ?? false)) return false;
        if ((p.typeAnnotation ?? "") !== (q.typeAnnotation ?? "")) return false;
        if (p.defaultValue && q.defaultValue) {
          return deepEqualExprNode(p.defaultValue, q.defaultValue);
        }
        return !p.defaultValue && !q.defaultValue;
      });
      if (!paramsEqual) return false;
      if (a.body.kind !== bNode.body.kind) return false;
      if (a.body.kind === "expr" && bNode.body.kind === "expr") {
        return deepEqualExprNode(a.body.value, bNode.body.value);
      }
      // Block bodies: compare by statement count — Phase 1 doesn't structure them
      if (a.body.kind === "block" && bNode.body.kind === "block") {
        return a.body.stmts.length === bNode.body.stmts.length;
      }
      return false;
    }

    case "cast": {
      const bNode = b as typeof a;
      return a.targetType === bNode.targetType
        && deepEqualExprNode(a.expression, bNode.expression);
    }

    case "match-expr": {
      const bNode = b as typeof a;
      if (!deepEqualExprNode(a.subject, bNode.subject)) return false;
      // rawArms is a raw-string format whose element count depends on
      // how the source was line-wrapped (arm splitter is newline-based).
      // After emit+reparse, all arms may be joined into fewer elements.
      // Compare by normalizing: join all arms, collapse whitespace, compare.
      const aArmsNorm = normalizeWhitespace(a.rawArms.join(" "));
      const bArmsNorm = normalizeWhitespace(bNode.rawArms.join(" "));
      return aArmsNorm === bArmsNorm;
    }

    case "sql-ref": {
      // SQL refs: both sides are placeholders; nodeId may differ in reparse
      // (nodeId is -1 for parsed refs) — compare as equal if both are sql-ref
      return true;
    }

    case "input-state-ref": {
      const bNode = b as typeof a;
      return a.name === bNode.name;
    }

    case "escape-hatch": {
      const bNode = b as typeof a;
      // Escape-hatch: compare by whitespace-normalized raw content
      return normalizeWhitespace(a.raw) === normalizeWhitespace(bNode.raw);
    }

    case "reset-expr": {
      const bNode = b as typeof a;
      // Compare structurally on target. Diagnostic field is a parse-time
      // annotation — treated as equal regardless of presence so that round-
      // tripped (re-parsed-from-emit) trees compare equal to the original.
      return deepEqualExprNode(a.target, bNode.target);
    }

    case "map-lit": {
      // §59.3 / §59.12 — a map literal (`[:]` / `[k: v, …]`; also a set's empty
      // seed `[:]`). Compare structurally on the ordered entry list (key + value
      // ExprNodes). The `diagnostics` sidecar is a parse-time annotation —
      // ignored (a round-tripped re-parse-from-emit tree carries it differently),
      // mirroring the `reset-expr` diagnostic-field treatment above.
      const bNode = b as typeof a;
      if (a.entries.length !== bNode.entries.length) return false;
      return a.entries.every((e, i) =>
        deepEqualExprNode(e.key, bNode.entries[i].key) &&
        deepEqualExprNode(e.value, bNode.entries[i].value)
      );
    }

    default: {
      const _never: never = a;
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Template-literal interpolation walking (A4 surgical fix)
// ---------------------------------------------------------------------------
//
// Template literals are stored in the AST as `lit` ExprNodes with
// `litType === "template"`. The interpolated `${...}` segments are NOT
// represented as structured children — they live inside the opaque `raw`
// field as text. Without special handling, every consumer of
// `forEachIdentInExprNode` (lin tracking, dep-graph, reactive analysis, ...)
// misses identifiers inside interpolations.
//
// The helpers below tokenize a template-literal `raw` string and re-parse
// each interpolation back to an ExprNode so the walker can recurse. Results
// are memoized per-LitExpr so repeated walks don't re-parse.
//
// Reference: scrml-support/archive/changes/fix-lin-template-literal-interpolation-walk/intake.md
// Reference: SPEC §35.3 rule 1 — any read of a `lin` value as an expression
//            is a consumption (interpolations are expression-position reads).
// ---------------------------------------------------------------------------

/**
 * One segment of a tokenized template literal.
 *
 * - `quasi` segments are literal text (no interpolation).
 * - `expr` segments are the source text inside `${ ... }` (without the
 *   surrounding `${` and `}`); `exprOffset` is the offset of the FIRST
 *   character of the expression text within the full `raw` string.
 */
interface TemplateSegment {
  kind: "quasi" | "expr";
  text: string;
  /** Offset of `text[0]` within the original `raw` string. */
  offset: number;
}

/**
 * Tokenize a template-literal `raw` string into quasis and interpolations.
 *
 * Walks character-by-character respecting:
 *   - Backslash escapes inside the literal text (so `\${` and `\\` are not
 *     interpolation starts).
 *   - Nested `${...}` braces — interpolation expressions can themselves
 *     contain `{}`, including nested template literals.
 *   - String literals and comments inside an interpolation expression so
 *     `${"}"}` doesn't terminate prematurely.
 *
 * Tolerant: malformed input falls through with whatever segments were
 * recognized so far. Caller falls back to a regex scan when parsing the
 * extracted expression fails.
 *
 * @param raw The full template-literal source including outer backticks.
 *            If the input does not look like a backtick template, returns
 *            a single quasi covering the whole string.
 */
function tokenizeTemplateInterpolations(raw: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  if (!raw || typeof raw !== "string") return segments;

  // Strip surrounding backticks if present; the inner content is what we walk.
  // We track offsets relative to the ORIGINAL `raw` string so spans line up.
  let i = 0;
  let innerStart = 0;
  let innerEnd = raw.length;
  if (raw.startsWith("`")) {
    innerStart = 1;
    if (raw.endsWith("`") && raw.length >= 2) innerEnd = raw.length - 1;
    i = innerStart;
  }

  let quasiStart = i;

  while (i < innerEnd) {
    const ch = raw.charCodeAt(i);
    // Backslash escape: skip the next char inside literal text.
    if (ch === 92 /* \ */) { i += 2; continue; }
    // ${ — interpolation start.
    if (ch === 36 /* $ */ && i + 1 < innerEnd && raw.charCodeAt(i + 1) === 123 /* { */) {
      // Emit the preceding quasi.
      if (i > quasiStart) {
        segments.push({ kind: "quasi", text: raw.slice(quasiStart, i), offset: quasiStart });
      } else {
        segments.push({ kind: "quasi", text: "", offset: quasiStart });
      }
      const exprStart = i + 2;
      // Walk forward respecting nested braces and strings.
      let depth = 1;
      let j = exprStart;
      while (j < innerEnd && depth > 0) {
        const c = raw.charCodeAt(j);
        if (c === 92 /* \ */) { j += 2; continue; }
        if (c === 123 /* { */) { depth++; j++; continue; }
        if (c === 125 /* } */) { depth--; j++; continue; }
        // Single-quoted string.
        if (c === 39 /* ' */) {
          j++;
          while (j < innerEnd) {
            const sc = raw.charCodeAt(j);
            if (sc === 92) { j += 2; continue; }
            if (sc === 39) { j++; break; }
            j++;
          }
          continue;
        }
        // Double-quoted string.
        if (c === 34 /* " */) {
          j++;
          while (j < innerEnd) {
            const sc = raw.charCodeAt(j);
            if (sc === 92) { j += 2; continue; }
            if (sc === 34) { j++; break; }
            j++;
          }
          continue;
        }
        // Nested backtick template — count balanced backticks. We do not
        // recurse here; re-parse will handle the nested template structure
        // via esTreeToExprNode (which calls back into the lit case).
        if (c === 96 /* ` */) {
          j++;
          let nestedDepth = 0;
          while (j < innerEnd) {
            const tc = raw.charCodeAt(j);
            if (tc === 92) { j += 2; continue; }
            if (tc === 36 /* $ */ && j + 1 < innerEnd && raw.charCodeAt(j + 1) === 123) {
              nestedDepth++;
              j += 2;
              continue;
            }
            if (tc === 125 /* } */ && nestedDepth > 0) {
              nestedDepth--;
              j++;
              continue;
            }
            if (tc === 96 /* ` */ && nestedDepth === 0) { j++; break; }
            j++;
          }
          continue;
        }
        j++;
      }
      // depth==0 means we consumed the closing `}`; the expression text
      // ends at j-1 (one before the closing brace).
      const exprEnd = depth === 0 ? j - 1 : j;
      segments.push({ kind: "expr", text: raw.slice(exprStart, exprEnd), offset: exprStart });
      i = j;
      quasiStart = i;
      continue;
    }
    i++;
  }

  // Trailing quasi.
  if (quasiStart < innerEnd) {
    segments.push({ kind: "quasi", text: raw.slice(quasiStart, innerEnd), offset: quasiStart });
  }

  return segments;
}

/**
 * Memoized cache of parsed interpolation ExprNodes for a given LitExpr.
 *
 * Keyed by the LitExpr object reference. The walker is called on the same
 * AST repeatedly across pipeline stages (lin tracking, dep-graph, ...);
 * caching the parsed sub-trees avoids re-tokenizing and re-parsing each
 * time. The cache lives only as long as the LitExpr — when the AST is
 * dropped, the cache is GC'd.
 */
const TEMPLATE_INTERP_CACHE: WeakMap<LitExpr, ExprNode[]> = new WeakMap();

/**
 * Regex fallback for extracting identifier-like tokens from an interpolation
 * source string when full expression parsing fails. Matches scrml identifier
 * shapes: `@name` (reactive), `~` (tilde accumulator), bare names. Avoids
 * matching inside string literals via a simple state machine.
 *
 * Synthesizes IdentExpr nodes anchored at the lit node's span — exact column
 * positions inside the template literal are not preserved (this is a fallback
 * path; precision is best-effort).
 */
function regexExtractIdents(
  exprText: string,
  span: ExprSpan,
  callback: (ident: IdentExpr) => void,
): void {
  // Skip strings/comments crudely so we don't pick up identifiers inside them.
  let cleaned = "";
  let i = 0;
  while (i < exprText.length) {
    const c = exprText.charCodeAt(i);
    if (c === 92 /* \ */) { i += 2; continue; }
    if (c === 34 /* " */ || c === 39 /* ' */ || c === 96 /* ` */) {
      const quote = c;
      cleaned += " ";
      i++;
      while (i < exprText.length) {
        const sc = exprText.charCodeAt(i);
        if (sc === 92) { cleaned += "  "; i += 2; continue; }
        if (sc === quote) { cleaned += " "; i++; break; }
        cleaned += " "; i++;
      }
      continue;
    }
    cleaned += exprText[i];
    i++;
  }
  // Match @ident, ~, and bare identifiers. Don't match property access (the
  // `.` makes the ident a member name, not a binding reference, but the
  // walker callsite handles MemberExpr — here we're a regex fallback so we
  // accept some imprecision).
  const re = /(?<![A-Za-z0-9_$\.])(?:@[A-Za-z_$][A-Za-z0-9_$]*|~|[A-Za-z_$][A-Za-z0-9_$]*)/g;
  // Reserved JS keywords / scrml literals we should not emit as idents.
  const STOP = new Set([
    "true", "false", "null", "undefined", "not",
    "if", "else", "return", "function", "let", "const", "var", "new", "this",
    "typeof", "void", "delete", "instanceof", "in", "of", "for", "while", "do",
    "break", "continue", "switch", "case", "default", "throw", "try", "catch",
    "finally", "class", "extends", "super", "import", "export", "from", "as",
    "async", "await", "yield",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[0];
    if (STOP.has(name)) continue;
    callback({ kind: "ident", span, name } as IdentExpr);
  }
}

/**
 * Walk a template-literal LitExpr's interpolations, invoking `callback` for
 * every IdentExpr inside any `${...}` segment. Quasi (literal text) segments
 * are ignored.
 *
 * Caches the parsed interpolation ExprNodes on the LitExpr for repeated walks.
 * On parse failure for a segment, falls back to a regex-based identifier scan.
 */
function walkTemplateInterpolations(
  lit: { raw: string; span: ExprSpan } & object,
  callback: (ident: IdentExpr) => void,
): void {
  let cached = TEMPLATE_INTERP_CACHE.get(lit as unknown as LitExpr);
  if (!cached) {
    cached = [];
    const segments = tokenizeTemplateInterpolations(lit.raw);
    for (const seg of segments) {
      if (seg.kind !== "expr") continue;
      const exprText = seg.text.trim();
      if (!exprText) continue;
      // Try to parse as a full expression.
      const { ast, error } = parseExpression(exprText, { tolerant: true });
      if (ast && !error) {
        try {
          const baseOffset = (lit.span?.start ?? 0) + seg.offset;
          const node = esTreeToExprNode(ast, lit.span?.file ?? "", baseOffset);
          cached.push(node);
          continue;
        } catch (_e) {
          // Conversion error — fall through to regex fallback below.
        }
      }
      // Fallback: synthesize an EscapeHatchExpr-ish marker carrying a regex
      // pre-scan. We store a sentinel so future walks know to use the regex
      // path. To keep this simple we cache nothing for the sentinel and
      // re-run the regex each walk (fallback path is cold).
      cached.push({
        kind: "escape-hatch",
        span: lit.span,
        nativeKind: "TemplateInterpFallback",
        raw: exprText,
      } as EscapeHatchExpr);
    }
    TEMPLATE_INTERP_CACHE.set(lit as unknown as LitExpr, cached);
  }

  for (const node of cached) {
    if ((node as EscapeHatchExpr).kind === "escape-hatch"
        && (node as EscapeHatchExpr).nativeKind === "TemplateInterpFallback") {
      regexExtractIdents((node as EscapeHatchExpr).raw, lit.span, callback);
      continue;
    }
    forEachIdentInExprNode(node, callback);
  }
}

// ---------------------------------------------------------------------------
// forEachIdentInExprNode — walk ExprNode tree and invoke callback on every IdentExpr
// ---------------------------------------------------------------------------
//
// Used by the lin type system (checkLinear) to find identifier references
// inside structured expression trees, replacing the string-regex approach.
//
// Semantics:
// - Every IdentExpr node encountered triggers the callback with that node.
// - LambdaExpr: the body is NOT descended into — lambdas create a new lin scope.
//   Capture tracking (when a lambda closes over a lin var) is handled separately
//   by the `case "closure"` handler in type-system.ts walkNode.
//   Phase 2 decision: skip lambda bodies conservatively. Future slice can add
//   capture-based lin consumption here if needed.
// - EscapeHatchExpr: skipped — opaque content, no identifier extraction possible.
// - SqlRefExpr, InputStateRefExpr: no sub-expressions to walk.
// - MemberExpr: object is walked (the base of `obj.prop`), but `property: string`
//   is NOT an IdentExpr — it is a static property name, not a binding reference.
//   IndexExpr: both object and index are walked.
// ---------------------------------------------------------------------------

/**
 * Walk an ExprNode tree recursively and invoke `callback` for every IdentExpr found.
 *
 * The callback receives the IdentExpr node (including its span).
 * The walk does NOT descend into LambdaExpr bodies (new lin scope boundary).
 * The walk does NOT descend into EscapeHatchExpr (opaque).
 *
 * @param node - Root ExprNode to walk
 * @param callback - Called once per IdentExpr encountered
 */
export function forEachIdentInExprNode(
  node: ExprNode,
  callback: (ident: IdentExpr) => void,
): void {
  if (!node) return;

  switch (node.kind) {
    case "ident": {
      callback(node as IdentExpr);
      return;
    }

    case "lit": {
      // Most lit kinds (string, number, bool, null, undefined, not) are leaves.
      // Template literals (litType === "template") are NOT leaves: their
      // `${...}` interpolations contain identifier reads that downstream
      // analyses (lin tracking, dep-graph, reactive deps) need to see.
      // Surgical fix A4: tokenize the raw template and recurse into each
      // interpolation. See walkTemplateInterpolations above.
      const litNode = node as LitExpr;
      if (litNode.litType === "template") {
        walkTemplateInterpolations(litNode, callback);
      }
      return;
    }

    case "sql-ref":
    case "input-state-ref": {
      // Leaf nodes with no sub-expressions. Nothing to walk.
      return;
    }

    case "escape-hatch": {
      // Most escape-hatch nodes are opaque (no identifier extraction). But
      // template literals with interpolations currently route through
      // makeEscapeHatch in esTreeToExprNode (see expression-parser.ts ~line 762),
      // so their `${...}` interpolations would otherwise be invisible to
      // every walker consumer. Surgical fix A4: when the escape-hatch was
      // built from a TemplateLiteral, descend into its interpolations.
      const eh = node as EscapeHatchExpr;
      if (eh.nativeKind === "TemplateLiteral" && typeof eh.raw === "string"
          && eh.raw.startsWith("`") && eh.raw.includes("${")) {
        walkTemplateInterpolations(eh as unknown as { raw: string; span: ExprSpan } & object, callback);
      }
      return;
    }

    case "array": {
      const n = node as ArrayExpr;
      for (const el of n.elements) {
        forEachIdentInExprNode(el as ExprNode, callback);
      }
      return;
    }

    case "object": {
      const n = node as ObjectExpr;
      for (const prop of n.props) {
        if (prop.kind === "prop") {
          // key may be computed (ExprNode) or static (string)
          if (typeof prop.key !== "string") {
            forEachIdentInExprNode(prop.key as ExprNode, callback);
          }
          forEachIdentInExprNode(prop.value, callback);
        } else if (prop.kind === "shorthand") {
          // shorthand: `{ x }` — x is both key and value reference.
          // The name is a binding reference, so emit a synthetic IdentExpr call.
          // We can't call callback with the full prop object, so we skip:
          // shorthand properties are value reads of the identifier.
          // Represent as an IdentExpr with the prop's span.
          callback({ kind: "ident", name: prop.name, span: prop.span } as IdentExpr);
        } else if (prop.kind === "spread") {
          forEachIdentInExprNode(prop.argument, callback);
        }
      }
      return;
    }

    case "spread": {
      const n = node as SpreadExpr;
      forEachIdentInExprNode(n.argument, callback);
      return;
    }

    case "unary": {
      const n = node as UnaryExpr;
      forEachIdentInExprNode(n.argument, callback);
      return;
    }

    case "binary": {
      const n = node as BinaryExpr;
      forEachIdentInExprNode(n.left, callback);
      forEachIdentInExprNode(n.right, callback);
      return;
    }

    case "assign": {
      const n = node as AssignExpr;
      forEachIdentInExprNode(n.target, callback);
      forEachIdentInExprNode(n.value, callback);
      return;
    }

    case "ternary": {
      const n = node as TernaryExpr;
      forEachIdentInExprNode(n.condition, callback);
      forEachIdentInExprNode(n.consequent, callback);
      forEachIdentInExprNode(n.alternate, callback);
      return;
    }

    case "member": {
      const n = node as MemberExpr;
      // Walk the object (the base) but NOT property (it is a static name string).
      forEachIdentInExprNode(n.object, callback);
      return;
    }

    case "index": {
      const n = node as IndexExpr;
      forEachIdentInExprNode(n.object, callback);
      forEachIdentInExprNode(n.index, callback);
      return;
    }

    case "call": {
      const n = node as CallExpr;
      forEachIdentInExprNode(n.callee, callback);
      for (const arg of n.args) {
        forEachIdentInExprNode(arg as ExprNode, callback);
      }
      return;
    }

    case "new": {
      const n = node as NewExpr;
      forEachIdentInExprNode(n.callee, callback);
      for (const arg of n.args) {
        forEachIdentInExprNode(arg as ExprNode, callback);
      }
      return;
    }

    case "lambda": {
      // Do NOT descend into the lambda body — new lin scope boundary.
      // Phase 2 decision: capture tracking is handled by the `case "closure"`
      // handler in checkLinear, which reads the `captures` string array on the
      // AST-level closure node. The ExprNode lambda body is a new scope.
      //
      // LambdaParam.defaultValue is an ExprNode and is in the OUTER scope
      // (evaluated before entering the lambda). Walk default values.
      const n = node as LambdaExpr;
      for (const param of n.params) {
        if (param.defaultValue) {
          forEachIdentInExprNode(param.defaultValue, callback);
        }
      }
      return;
    }

    case "cast": {
      const n = node as CastExpr;
      forEachIdentInExprNode(n.expression, callback);
      return;
    }

    case "match-expr": {
      const n = node as MatchExpr;
      // Walk the subject expression. Arms are raw strings (Phase 1) — cannot walk.
      forEachIdentInExprNode(n.subject, callback);
      return;
    }

    case "reset-expr": {
      const n = node as ResetExpr;
      // Recurse into the target expression so identifier-based analyses
      // (lin tracking, dep-graph, reactive deps) see any @cell reads.
      forEachIdentInExprNode(n.target, callback);
      return;
    }

    case "map-lit": {
      // §59.3 — recurse into every entry key + value so identifier-based
      // analyses (dep-graph, reactive deps) see @cell reads in either position.
      const n = node as MapLitExpr;
      for (const entry of n.entries) {
        forEachIdentInExprNode(entry.key, callback);
        forEachIdentInExprNode(entry.value, callback);
      }
      return;
    }

    default: {
      // TypeScript exhaustiveness check. If this fires, a new ExprNode kind was
      // added without updating this function. Stop-and-report trigger per spec.
      const _never: never = node;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 4d Slice 2 — ExprNode walker utilities
// ---------------------------------------------------------------------------
//
// Structured replacements for string-regex analysis. Each helper walks the
// ExprNode tree and answers a specific question about its contents, replacing
// ad-hoc string patterns like extractCalleesFromExpr, LIFT_CALL_RE,
// /@[A-Za-z]/ regex, extractInitLiteral, etc.
//
// All helpers skip LambdaExpr bodies (scope boundary) and EscapeHatchExpr
// (opaque), matching forEachIdentInExprNode semantics.
// ---------------------------------------------------------------------------

/**
 * Walk an ExprNode tree and return true if it contains a CallExpr.
 * If `calleeName` is provided, only matches calls where the callee is an
 * IdentExpr with that exact name (e.g. "lift", "emit", "navigate").
 *
 * Replaces: `extractCalleesFromExpr`, `LIFT_CALL_RE`, `includes("(")` checks.
 */
export function exprNodeContainsCall(node: ExprNode, calleeName?: string): boolean {
  if (!node) return false;
  switch (node.kind) {
    case "call": {
      const n = node as CallExpr;
      if (!calleeName) return true;
      if (n.callee.kind === "ident" && (n.callee as IdentExpr).name === calleeName) return true;
      // Check args and callee recursively for nested calls
      if (exprNodeContainsCall(n.callee, calleeName)) return true;
      for (const arg of n.args) {
        if (exprNodeContainsCall(arg as ExprNode, calleeName)) return true;
      }
      return false;
    }
    case "new": {
      const n = node as NewExpr;
      if (exprNodeContainsCall(n.callee, calleeName)) return true;
      for (const arg of n.args) {
        if (exprNodeContainsCall(arg as ExprNode, calleeName)) return true;
      }
      return false;
    }
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch":
      return false;
    case "array": {
      const n = node as ArrayExpr;
      return n.elements.some(el => exprNodeContainsCall(el as ExprNode, calleeName));
    }
    case "object": {
      const n = node as ObjectExpr;
      return n.props.some(p =>
        (p.kind === "prop" && (typeof p.key !== "string" ? exprNodeContainsCall(p.key as ExprNode, calleeName) : false) || (p.kind === "prop" && exprNodeContainsCall(p.value, calleeName))) ||
        (p.kind === "spread" && exprNodeContainsCall(p.argument, calleeName))
      );
    }
    case "spread": return exprNodeContainsCall((node as SpreadExpr).argument, calleeName);
    case "unary": return exprNodeContainsCall((node as UnaryExpr).argument, calleeName);
    case "binary": return exprNodeContainsCall((node as BinaryExpr).left, calleeName) || exprNodeContainsCall((node as BinaryExpr).right, calleeName);
    case "assign": return exprNodeContainsCall((node as AssignExpr).target, calleeName) || exprNodeContainsCall((node as AssignExpr).value, calleeName);
    case "ternary": {
      const n = node as TernaryExpr;
      return exprNodeContainsCall(n.condition, calleeName) || exprNodeContainsCall(n.consequent, calleeName) || exprNodeContainsCall(n.alternate, calleeName);
    }
    case "member": return exprNodeContainsCall((node as MemberExpr).object, calleeName);
    case "index": return exprNodeContainsCall((node as IndexExpr).object, calleeName) || exprNodeContainsCall((node as IndexExpr).index, calleeName);
    case "lambda": return false; // scope boundary
    case "cast": return exprNodeContainsCall((node as CastExpr).expression, calleeName);
    case "match-expr": return exprNodeContainsCall((node as MatchExpr).subject, calleeName);
    case "reset-expr": {
      // `reset-expr` is NOT a call — it's a structurally-distinct keyword
      // expression. If a caller asks "does this contain a call to `reset`?"
      // the answer is no (the bare-Identifier-callee was lifted into reset-expr).
      // Recurse into target so a call appearing inside the target counts.
      return exprNodeContainsCall((node as ResetExpr).target, calleeName);
    }
    case "map-lit": return (node as MapLitExpr).entries.some(e =>
      exprNodeContainsCall(e.key, calleeName) || exprNodeContainsCall(e.value, calleeName));
    default: { const _never: never = node; return false; }
  }
}

/**
 * Collect all callee names from CallExpr nodes in the tree.
 * Only captures direct IdentExpr callees (e.g. `foo(...)` → "foo").
 * Member-access calls like `obj.method()` are not captured.
 *
 * Replaces: `extractCalleesFromExpr` (regex-based callee extraction).
 */
export function exprNodeCollectCallees(node: ExprNode): string[] {
  const names: string[] = [];
  if (!node) return names;
  forEachCallInExprNode(node, (call) => {
    if (call.callee.kind === "ident") {
      names.push((call.callee as IdentExpr).name);
    }
  });
  return names;
}

/** Walk an ExprNode tree and invoke callback on every CallExpr. */
export function forEachCallInExprNode(node: ExprNode, cb: (call: CallExpr) => void): void {
  if (!node) return;
  switch (node.kind) {
    case "call": {
      const n = node as CallExpr;
      cb(n);
      forEachCallInExprNode(n.callee, cb);
      for (const a of n.args) forEachCallInExprNode(a as ExprNode, cb);
      return;
    }
    case "new": {
      const n = node as NewExpr;
      forEachCallInExprNode(n.callee, cb);
      for (const a of n.args) forEachCallInExprNode(a as ExprNode, cb);
      return;
    }
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return;
    case "array": { for (const el of (node as ArrayExpr).elements) forEachCallInExprNode(el as ExprNode, cb); return; }
    case "object": {
      for (const p of (node as ObjectExpr).props) {
        if (p.kind === "prop") { if (typeof p.key !== "string") forEachCallInExprNode(p.key as ExprNode, cb); forEachCallInExprNode(p.value, cb); }
        else if (p.kind === "spread") forEachCallInExprNode(p.argument, cb);
      }
      return;
    }
    case "spread": forEachCallInExprNode((node as SpreadExpr).argument, cb); return;
    case "unary": forEachCallInExprNode((node as UnaryExpr).argument, cb); return;
    case "binary": { const n = node as BinaryExpr; forEachCallInExprNode(n.left, cb); forEachCallInExprNode(n.right, cb); return; }
    case "assign": { const n = node as AssignExpr; forEachCallInExprNode(n.target, cb); forEachCallInExprNode(n.value, cb); return; }
    case "ternary": { const n = node as TernaryExpr; forEachCallInExprNode(n.condition, cb); forEachCallInExprNode(n.consequent, cb); forEachCallInExprNode(n.alternate, cb); return; }
    case "member": forEachCallInExprNode((node as MemberExpr).object, cb); return;
    case "index": { const n = node as IndexExpr; forEachCallInExprNode(n.object, cb); forEachCallInExprNode(n.index, cb); return; }
    case "lambda": return;
    case "cast": forEachCallInExprNode((node as CastExpr).expression, cb); return;
    case "match-expr": forEachCallInExprNode((node as MatchExpr).subject, cb); return;
    case "reset-expr": forEachCallInExprNode((node as ResetExpr).target, cb); return;
    default: { const _never: never = node; return; }
  }
}

/**
 * Walk an ExprNode tree and invoke `cb` once per `ResetExpr` encountered.
 *
 * §6.8.2 (Step 9, Phase A1a) — used by ast-builder to surface parse-time
 * `E-RESET-NO-ARG` diagnostics that the expression-parser attached to
 * malformed `reset(...)` calls. Mirrors the F-SQL-001 pattern but recurses
 * the full tree (a malformed reset can appear nested inside any larger
 * expression — e.g. `if (cond) reset()`).
 */
export function forEachResetExprInExprNode(node: ExprNode, cb: (resetNode: ResetExpr) => void): void {
  if (!node) return;
  switch (node.kind) {
    case "reset-expr": {
      const n = node as ResetExpr;
      cb(n);
      forEachResetExprInExprNode(n.target, cb);
      return;
    }
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return;
    case "array": { for (const el of (node as ArrayExpr).elements) forEachResetExprInExprNode(el as ExprNode, cb); return; }
    case "object": {
      for (const p of (node as ObjectExpr).props) {
        if (p.kind === "prop") { if (typeof p.key !== "string") forEachResetExprInExprNode(p.key as ExprNode, cb); forEachResetExprInExprNode(p.value, cb); }
        else if (p.kind === "spread") forEachResetExprInExprNode(p.argument, cb);
      }
      return;
    }
    case "spread": forEachResetExprInExprNode((node as SpreadExpr).argument, cb); return;
    case "unary": forEachResetExprInExprNode((node as UnaryExpr).argument, cb); return;
    case "binary": { const n = node as BinaryExpr; forEachResetExprInExprNode(n.left, cb); forEachResetExprInExprNode(n.right, cb); return; }
    case "assign": { const n = node as AssignExpr; forEachResetExprInExprNode(n.target, cb); forEachResetExprInExprNode(n.value, cb); return; }
    case "ternary": { const n = node as TernaryExpr; forEachResetExprInExprNode(n.condition, cb); forEachResetExprInExprNode(n.consequent, cb); forEachResetExprInExprNode(n.alternate, cb); return; }
    case "member": forEachResetExprInExprNode((node as MemberExpr).object, cb); return;
    case "index": { const n = node as IndexExpr; forEachResetExprInExprNode(n.object, cb); forEachResetExprInExprNode(n.index, cb); return; }
    case "call": {
      const n = node as CallExpr;
      forEachResetExprInExprNode(n.callee, cb);
      for (const a of n.args) forEachResetExprInExprNode(a as ExprNode, cb);
      return;
    }
    case "new": {
      const n = node as NewExpr;
      forEachResetExprInExprNode(n.callee, cb);
      for (const a of n.args) forEachResetExprInExprNode(a as ExprNode, cb);
      return;
    }
    case "lambda": {
      // Walk default values (outer scope). Body is a fresh scope, but a
      // malformed reset() inside a lambda body should still be surfaced —
      // unlike free-identifier capture, parse-time syntax errors don't
      // respect scope boundaries.
      const n = node as LambdaExpr;
      for (const p of n.params) {
        if (p.defaultValue) forEachResetExprInExprNode(p.defaultValue, cb);
      }
      if (n.body.kind === "expr") forEachResetExprInExprNode(n.body.value, cb);
      // Block bodies are EscapeHatchExpr in Phase 1; cannot recurse structurally.
      return;
    }
    case "cast": forEachResetExprInExprNode((node as CastExpr).expression, cb); return;
    case "match-expr": forEachResetExprInExprNode((node as MatchExpr).subject, cb); return;
    case "map-lit": {
      for (const e of (node as MapLitExpr).entries) {
        forEachResetExprInExprNode(e.key, cb);
        forEachResetExprInExprNode(e.value, cb);
      }
      return;
    }
    default: { const _never: never = node; return; }
  }
}

/**
 * Walk an ExprNode tree and invoke `cb` for every `MapLitExpr` (§59.3).
 *
 * Mirrors `forEachResetExprInExprNode`. The ast-builder wrapper uses this to
 * surface a map literal's attached parse-time diagnostics
 * (`E-MAP-LITERAL-MALFORMED`, `W-MAP-STRUCT-KEY-LITERAL`,
 * `W-MAP-DUPLICATE-LITERAL-KEY`) as TABErrors — the scanner runs pre-Acorn and
 * cannot push into an errors array directly, so it attaches them to the node.
 * Recurses into entry keys/values (a nested map literal is visited too).
 */
export function forEachMapLitExprInExprNode(node: ExprNode, cb: (mapNode: MapLitExpr) => void): void {
  if (!node) return;
  switch (node.kind) {
    case "map-lit": {
      const n = node as MapLitExpr;
      cb(n);
      for (const e of n.entries) {
        forEachMapLitExprInExprNode(e.key, cb);
        forEachMapLitExprInExprNode(e.value, cb);
      }
      return;
    }
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return;
    case "array": { for (const el of (node as ArrayExpr).elements) forEachMapLitExprInExprNode(el as ExprNode, cb); return; }
    case "object": {
      for (const p of (node as ObjectExpr).props) {
        if (p.kind === "prop") { if (typeof p.key !== "string") forEachMapLitExprInExprNode(p.key as ExprNode, cb); forEachMapLitExprInExprNode(p.value, cb); }
        else if (p.kind === "spread") forEachMapLitExprInExprNode(p.argument, cb);
      }
      return;
    }
    case "spread": forEachMapLitExprInExprNode((node as SpreadExpr).argument, cb); return;
    case "unary": forEachMapLitExprInExprNode((node as UnaryExpr).argument, cb); return;
    case "binary": { const n = node as BinaryExpr; forEachMapLitExprInExprNode(n.left, cb); forEachMapLitExprInExprNode(n.right, cb); return; }
    case "assign": { const n = node as AssignExpr; forEachMapLitExprInExprNode(n.target, cb); forEachMapLitExprInExprNode(n.value, cb); return; }
    case "ternary": { const n = node as TernaryExpr; forEachMapLitExprInExprNode(n.condition, cb); forEachMapLitExprInExprNode(n.consequent, cb); forEachMapLitExprInExprNode(n.alternate, cb); return; }
    case "member": forEachMapLitExprInExprNode((node as MemberExpr).object, cb); return;
    case "index": { const n = node as IndexExpr; forEachMapLitExprInExprNode(n.object, cb); forEachMapLitExprInExprNode(n.index, cb); return; }
    case "call": {
      const n = node as CallExpr;
      forEachMapLitExprInExprNode(n.callee, cb);
      for (const a of n.args) forEachMapLitExprInExprNode(a as ExprNode, cb);
      return;
    }
    case "new": {
      const n = node as NewExpr;
      forEachMapLitExprInExprNode(n.callee, cb);
      for (const a of n.args) forEachMapLitExprInExprNode(a as ExprNode, cb);
      return;
    }
    case "lambda": {
      const n = node as LambdaExpr;
      for (const p of n.params) { if (p.defaultValue) forEachMapLitExprInExprNode(p.defaultValue, cb); }
      if (n.body.kind === "expr") forEachMapLitExprInExprNode(n.body.value, cb);
      return;
    }
    case "cast": forEachMapLitExprInExprNode((node as CastExpr).expression, cb); return;
    case "match-expr": forEachMapLitExprInExprNode((node as MatchExpr).subject, cb); return;
    case "reset-expr": forEachMapLitExprInExprNode((node as ResetExpr).target, cb); return;
    default: { const _never: never = node; return; }
  }
}

/**
 * Return true if the ExprNode tree contains any IdentExpr whose name
 * starts with `@` (reactive variable reference).
 *
 * Replaces: `/@[A-Za-z_$]/` regex on expression strings.
 */
export function exprNodeContainsReactiveRef(node: ExprNode): boolean {
  if (!node) return false;
  let found = false;
  forEachIdentInExprNode(node, (ident) => {
    if (!found && ident.name.startsWith("@")) found = true;
  });
  return found;
}

/**
 * Return true if the ExprNode tree contains an AssignExpr.
 *
 * Replaces: assignment-in-condition detection via string regex.
 */
export function exprNodeContainsAssignment(node: ExprNode): boolean {
  if (!node) return false;
  switch (node.kind) {
    case "assign": return true;
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return false;
    case "array": return (node as ArrayExpr).elements.some(el => exprNodeContainsAssignment(el as ExprNode));
    case "object": return (node as ObjectExpr).props.some(p =>
      (p.kind === "prop" && ((typeof p.key !== "string" && exprNodeContainsAssignment(p.key as ExprNode)) || exprNodeContainsAssignment(p.value))) ||
      (p.kind === "spread" && exprNodeContainsAssignment(p.argument))
    );
    case "spread": return exprNodeContainsAssignment((node as SpreadExpr).argument);
    case "unary": return exprNodeContainsAssignment((node as UnaryExpr).argument);
    case "binary": return exprNodeContainsAssignment((node as BinaryExpr).left) || exprNodeContainsAssignment((node as BinaryExpr).right);
    case "ternary": {
      const n = node as TernaryExpr;
      return exprNodeContainsAssignment(n.condition) || exprNodeContainsAssignment(n.consequent) || exprNodeContainsAssignment(n.alternate);
    }
    case "member": return exprNodeContainsAssignment((node as MemberExpr).object);
    case "index": return exprNodeContainsAssignment((node as IndexExpr).object) || exprNodeContainsAssignment((node as IndexExpr).index);
    case "call": {
      const n = node as CallExpr;
      return exprNodeContainsAssignment(n.callee) || n.args.some(a => exprNodeContainsAssignment(a as ExprNode));
    }
    case "new": {
      const n = node as NewExpr;
      return exprNodeContainsAssignment(n.callee) || n.args.some(a => exprNodeContainsAssignment(a as ExprNode));
    }
    case "lambda": return false;
    case "cast": return exprNodeContainsAssignment((node as CastExpr).expression);
    case "match-expr": return exprNodeContainsAssignment((node as MatchExpr).subject);
    case "reset-expr": return exprNodeContainsAssignment((node as ResetExpr).target);
    case "map-lit": return (node as MapLitExpr).entries.some(e =>
      exprNodeContainsAssignment(e.key) || exprNodeContainsAssignment(e.value));
    default: { const _never: never = node; return false; }
  }
}

/**
 * Return true if the ExprNode tree contains a MemberExpr accessing any of
 * the specified property names on an IdentExpr base.
 * E.g. `exprNodeContainsMemberAccess(node, ["innerHTML", "textContent"])`.
 *
 * Replaces: DOM manipulation detection via string regex.
 */
export function exprNodeContainsMemberAccess(node: ExprNode, props: string[]): boolean {
  if (!node || props.length === 0) return false;
  switch (node.kind) {
    case "member": {
      const n = node as MemberExpr;
      if (props.includes(n.property)) return true;
      return exprNodeContainsMemberAccess(n.object, props);
    }
    case "ident": case "lit": case "sql-ref": case "input-state-ref": case "escape-hatch": return false;
    case "array": return (node as ArrayExpr).elements.some(el => exprNodeContainsMemberAccess(el as ExprNode, props));
    case "object": return (node as ObjectExpr).props.some(p =>
      (p.kind === "prop" && ((typeof p.key !== "string" && exprNodeContainsMemberAccess(p.key as ExprNode, props)) || exprNodeContainsMemberAccess(p.value, props))) ||
      (p.kind === "spread" && exprNodeContainsMemberAccess(p.argument, props))
    );
    case "spread": return exprNodeContainsMemberAccess((node as SpreadExpr).argument, props);
    case "unary": return exprNodeContainsMemberAccess((node as UnaryExpr).argument, props);
    case "binary": return exprNodeContainsMemberAccess((node as BinaryExpr).left, props) || exprNodeContainsMemberAccess((node as BinaryExpr).right, props);
    case "assign": return exprNodeContainsMemberAccess((node as AssignExpr).target, props) || exprNodeContainsMemberAccess((node as AssignExpr).value, props);
    case "ternary": {
      const n = node as TernaryExpr;
      return exprNodeContainsMemberAccess(n.condition, props) || exprNodeContainsMemberAccess(n.consequent, props) || exprNodeContainsMemberAccess(n.alternate, props);
    }
    case "index": return exprNodeContainsMemberAccess((node as IndexExpr).object, props) || exprNodeContainsMemberAccess((node as IndexExpr).index, props);
    case "call": {
      const n = node as CallExpr;
      return exprNodeContainsMemberAccess(n.callee, props) || n.args.some(a => exprNodeContainsMemberAccess(a as ExprNode, props));
    }
    case "new": {
      const n = node as NewExpr;
      return exprNodeContainsMemberAccess(n.callee, props) || n.args.some(a => exprNodeContainsMemberAccess(a as ExprNode, props));
    }
    case "lambda": return false;
    case "cast": return exprNodeContainsMemberAccess((node as CastExpr).expression, props);
    case "match-expr": return exprNodeContainsMemberAccess((node as MatchExpr).subject, props);
    case "reset-expr": return exprNodeContainsMemberAccess((node as ResetExpr).target, props);
    case "map-lit": return (node as MapLitExpr).entries.some(e =>
      exprNodeContainsMemberAccess(e.key, props) || exprNodeContainsMemberAccess(e.value, props));
    default: { const _never: never = node; return false; }
  }
}

/**
 * Return true if the ExprNode is a single IdentExpr matching `name`,
 * or contains a top-level reference to it.
 * When `exact` is true (default), only matches if the root node is that ident.
 *
 * Replaces: `=== "children"`, `=== "..."`, linear var reference checks on strings.
 */
export function exprNodeMatchesIdent(node: ExprNode, name: string, exact: boolean = true): boolean {
  if (!node) return false;
  if (exact) {
    return node.kind === "ident" && (node as IdentExpr).name === name;
  }
  // Non-exact: search the whole tree for any ident with this name
  let found = false;
  forEachIdentInExprNode(node, (ident) => {
    if (!found && ident.name === name) found = true;
  });
  return found;
}

/**
 * Classify a literal ExprNode into a SourceInfo-compatible shape.
 * Returns the kind of literal and its value for type inference.
 *
 * Replaces: `extractInitLiteral` (regex parsing of string values).
 */
export function classifyLiteralFromExprNode(node: ExprNode): { kind: "literal"; value: string | number } | { kind: "arithmetic" } | { kind: "unconstrained" } {
  if (!node) return { kind: "unconstrained" };

  switch (node.kind) {
    case "lit": {
      const n = node as LitExpr;
      if (n.litType === "number" && typeof n.value === "number") {
        return { kind: "literal", value: n.value };
      }
      if (n.litType === "string" && typeof n.value === "string") {
        return { kind: "literal", value: n.value };
      }
      return { kind: "unconstrained" };
    }

    case "unary": {
      // Negative numeric literal: `-42`
      const n = node as UnaryExpr;
      if (n.op === "-" && n.prefix && n.argument.kind === "lit") {
        const lit = n.argument as LitExpr;
        if (lit.litType === "number" && typeof lit.value === "number") {
          return { kind: "literal", value: -lit.value };
        }
      }
      return { kind: "unconstrained" };
    }

    case "binary": {
      const n = node as BinaryExpr;
      if (n.op === "+" || n.op === "-" || n.op === "*" || n.op === "/" || n.op === "%") {
        return { kind: "arithmetic" };
      }
      return { kind: "unconstrained" };
    }

    default:
      return { kind: "unconstrained" };
  }
}
