/**
 * AST Builder — Stage 3b of the scrml compiler pipeline (TAB).
 *
 * Receives the Block tree from the Block Splitter and the token streams
 * produced by the Tokenizer, then constructs a typed FileAST.
 *
 * Input:  { filePath: string, blocks: Block[] }   (BS output)
 * Output: { filePath: string, ast: FileAST, errors: TABError[] }
 *
 * FileAST = {
 *   filePath: string,
 *   nodes:      ASTNode[],
 *   imports:    ImportDecl[],
 *   exports:    ExportDecl[],
 *   components: ComponentDef[],
 *   typeDecls:  TypeDecl[],
 * }
 *
 * ASTNode discriminated by `.kind`:
 *   'markup'      — MarkupElement
 *   'state'       — StateBlock
 *   'state-constructor-def' — StateConstructorDef (§35.2)
 *   'logic'       — LogicBlock
 *   'sql'         — SQLBlock
 *   'css-inline'  — CSSInlineBlock
 *   'style'       — StyleBlock
 *   'error-effect' — ErrorEffectBlock
 *   'meta'        — MetaBlock
 *   'text'        — TextNode
 *   'comment'     — CommentNode
 *   'throw-stmt'  — ThrowStmt (§19) — error throw expression
 *   'guarded-expr' — GuardedExpr (§19) — expression with !{} error context
 *
 * Every node carries a `span` field. Spans reference the preprocessed source.
 * No type information, no scope resolution, no code generation here.
 */

import {
  tokenizeAttributes as _defaultTokenizeAttributes,
  tokenizeLogic as _defaultTokenizeLogic,
  tokenizeSQL as _defaultTokenizeSQL,
  tokenizeCSS as _defaultTokenizeCSS,
  tokenizeError as _defaultTokenizeError,
  tokenizePassthrough as _defaultTokenizePassthrough,
} from "./tokenizer.ts";

import { parseExprToNode, forEachResetExprInExprNode, forEachMapLitExprInExprNode } from "./expression-parser.ts";
import { decorateValidatorsWithExprNodes } from "./validator-arg-parser.ts";
import { splitBlocks as _splitBlocksForP2Form1 } from "./block-splitter.js";
import { scanForTopLevelSemicolon, isEventHandlerAttrName } from "./multi-statement-scan.ts";
import { getElementShape } from "./html-elements.js";
import { parseAfterDuration } from "./codegen/parse-after-duration.ts";

import { existsSync, statSync } from "fs";
import { dirname as _pathDirname, join as _pathJoin, isAbsolute as _pathIsAbsolute } from "path";

/**
 * Bug 1 fix: re-emit a string literal's raw inner text as a valid JS string
 * literal. The scrml tokenizer stores the source-as-written inner text for
 * STRING tokens (e.g., `"a\nb"` → `a\nb` = 4 chars including a literal
 * backslash). Previous code double-escaped this by `.replace(/\\/g, "\\\\")`,
 * producing `"a\\nb"` in the emitted JS, which parses as literal backslash+n
 * instead of LF. This helper interprets standard escapes into their character
 * values, then JSON.stringifies to produce a canonical double-quoted JS literal.
 *
 * Handles: \n \t \r \\ \" \' \0 \b \f \v \xHH \uHHHH \u{HHHHHH}
 * Unknown escape sequences pass through as literal backslash+char (conservative).
 */
function reemitJsStringLiteral(rawInner) {
  let out = "";
  for (let i = 0; i < rawInner.length; i++) {
    const c = rawInner[i];
    if (c !== "\\" || i + 1 >= rawInner.length) { out += c; continue; }
    const n = rawInner[i + 1];
    switch (n) {
      case "n":  out += "\n"; i++; break;
      case "t":  out += "\t"; i++; break;
      case "r":  out += "\r"; i++; break;
      case "\\": out += "\\"; i++; break;
      case '"':  out += '"';  i++; break;
      case "'":  out += "'";  i++; break;
      case "`":  out += "`";  i++; break;
      case "0":  out += "\0"; i++; break;
      case "b":  out += "\b"; i++; break;
      case "f":  out += "\f"; i++; break;
      case "v":  out += "\v"; i++; break;
      case "x": {
        const hex = rawInner.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 3; }
        else { out += "\\" + n; i++; }
        break;
      }
      case "u": {
        if (rawInner[i + 2] === "{") {
          const close = rawInner.indexOf("}", i + 3);
          const hex = close > 0 ? rawInner.slice(i + 3, close) : "";
          if (/^[0-9a-fA-F]+$/.test(hex)) { out += String.fromCodePoint(parseInt(hex, 16)); i = close; }
          else { out += "\\" + n; i++; }
        } else {
          const hex = rawInner.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; }
          else { out += "\\" + n; i++; }
        }
        break;
      }
      default:   out += "\\" + n; i++; break;
    }
  }
  return JSON.stringify(out);
}

/**
 * Phase 3.5: detect expressions that should NOT be parsed to ExprNode.
 * Returns true for:
 * - HTML tag fragments (tokenizer-spaced: `< / span >`, `< button onclick = ...`)
 * - Leading-dot method chains (`. all ( )` SQL continuations)
 * - C-style for-loop headers (`( let i = 0 ; i < 10 ; i + + )`)
 * - emit() calls with embedded HTML strings
 *
 * These patterns produce EscapeHatchExpr nodes that always fall back to the
 * string pipeline. Skipping them avoids the escape hatch round-trip.
 */
function shouldSkipExprParse(expr) {
  if (!expr || typeof expr !== "string") return true;
  const t = expr.trim();
  if (!t) return true;
  // HTML tag fragments: starts with `<` or `>` (tag content/closers) or contains tag syntax
  if (/^\s*</.test(t)) return true;
  if (/^\s*>/.test(t)) return true;
  // Closing tag fragments in the middle: `</span>`, `< / span >`
  if (/< \/ [a-z]/i.test(t)) return true;
  // Multi-line strings with embedded HTML (e.g. emit("<div>...\n...</div>"))
  if (/\n/.test(t) && /<[a-z]/i.test(t)) return true;
  // Leading dot: `.method()` chain continuations (not a standalone expression).
  // EXCEPTION (B20, §14.10 / M9): `.Variant` (uppercase first letter) IS a
  // valid standalone primary expression — the bare-variant form. The S66
  // parser fix in `expression-parser.ts:preprocessForAcorn` replaces it with
  // a placeholder identifier that acorn can parse. So we let `.Variant` (or
  // `. Variant` after joinWithNewlines token-join spacing) fall through to
  // the parser; only chain continuations (`.method()`, `.field`, `.0`)
  // starting with non-uppercase or numeric remain skipped.
  if (/^\s*\./.test(t) && !/^\s*\.\s*[A-Z]/.test(t)) return true;
  // C-style for-loop header: `( init ; cond ; update )`
  if (/^\s*\(/.test(t) && /;\s*/.test(t) && t.trim().endsWith(")")) return true;
  return false;
}

/**
 * Phase 4: detect whether an expression string is an HTML fragment rather than a JS expression.
 * Used at bare-expr creation sites to emit html-fragment nodes instead of bare-expr.
 * Matches the HTML-specific patterns from shouldSkipExprParse (not method chains or for-loops).
 */
function isHtmlFragment(expr) {
  if (!expr || typeof expr !== "string") return false;
  const t = expr.trim();
  if (!t) return false;
  if (/^\s*</.test(t)) return true;
  if (/^\s*>/.test(t)) return true;
  if (/< \/ [a-z]/i.test(t)) return true;
  if (/\n/.test(t) && /<[a-z]/i.test(t)) return true;
  return false;
}

/**
 * §4.15 — Scrml-defined structural-DECLARATION elements registry. These 9
 * elements are declaration-shapes (NOT markup-as-value): a state-machine
 * definition (<engine>), channel/page/schema/auth declarations, an errors
 * template, lifecycle handlers (<onTransition>/<onTimeout>/<onIdle>). They
 * are grammatical ONLY in their owning loci; appearance inside a `${...}`
 * logic body (parseLogicBody) is a misplacement — without this gate they
 * were silently swallowed as `kind: "html-fragment"` raw text and produced
 * empty output.
 *
 * <match> (the 10th §4.15 entry) is intentionally NOT in this table — block-
 * form <match> IS markup-as-value (§18.0.1 + §1.4) and is canonical inside
 * `${...}` markup-emit contexts. See the inline NOTE at the table's tail.
 *
 * The registry name-match is case-sensitive (§4.15). PascalCase user
 * components (`<MyComponent>`) and HTML elements (`<div>`) are not in the
 * table, so the diagnostic does not fire on them. Each entry pairs the
 * element name with the canonical-placement story cited in the diagnostic
 * message. The §-references mirror SPEC §4.15 Cross-references.
 */
const STRUCTURAL_ELEMENT_PLACEMENT = {
  schema:       "a `<schema>` element belongs as an immediate child of `<program>` (§39.2 / §39.12)",
  engine:       "an `<engine>` element belongs at file top-level or as a typed-state-cell init (§51.0 / §51)",
  channel:      "a `<channel>` element belongs inside `<program>` as a sibling of `<page>` (§38.1 / §38.3)",
  page:         "a `<page>` element belongs inside `<program>` in multi-page apps (§40 / §40.8)",
  auth:         "an `<auth>` element belongs as a child of `<program>` / `<page>` / `<channel>` (§40.9.5 / §40.1.1)",
  errors:       "an `<errors>` element belongs in a parent context that supports it (§55.8)",
  onTransition: "an `<onTransition>` element belongs as a child of `<engine>` (§51.0.H)",
  onTimeout:    "an `<onTimeout>` element belongs inside an engine state-child (§51.0.M)",
  onIdle:       "an `<onIdle>` element belongs at engine root, sibling of state-children (§51.0.R)",
  // NOTE: <match> is intentionally NOT in this table. Block-form <match> is
  // markup-as-value (§18.0.1 + §1.4 L1 pillar) — it is grammatical wherever a
  // value-yielding expression sits, including `${...}` markup-emit contexts
  // (the canonical output of `bun scrml promote --match`, S66 SHIPPED). The
  // brief's PA-lean kill-list conflated <match> with the 9 declarations; the
  // promote-safety-harness regression confirmed the false-positive empirically
  // (3 tests in compiler/tests/unit/promote-safety-harness.test.js failed
  // before this scope correction).
};

/**
 * Extract the leading tag-opener name from a collected expression string, e.g.
 * `"<schema>\n  <users>..."` → `"schema"`. Returns null if the expression
 * does not start with a tag opener `<NAME` (case-sensitive on the name; the
 * tokenizer may insert a single space between `<` and the IDENT, hence `\s*`).
 *
 * Used by parseLogicBody to gate E-STRUCTURAL-ELEMENT-MISPLACED — the diagnostic
 * fires only when the leading tag-name is in STRUCTURAL_ELEMENT_PLACEMENT.
 * HTML elements (`<div>`, `<p>`, …) and PascalCase components (`<MyComponent>`)
 * do NOT appear in the placement table so the diagnostic does not fire on them.
 */
function leadingTagName(expr) {
  if (!expr || typeof expr !== "string") return null;
  const m = expr.match(/^\s*<\s*([A-Za-z][A-Za-z0-9_-]*)\b/);
  return m ? m[1] : null;
}

/**
 * Module-level safe expression parser — wraps parseExprToNode in try/catch.
 * Returns undefined on failure. Used by parseAttributes (module-level scope)
 * and other module-level helpers that need ExprNode but lack access to the
 * closure-scoped safeParseExprToNode inside parseLogicBody.
 */
export function safeParseExprToNodeGlobal(expr, filePath, startOffset, errors) {
  if (!expr || typeof expr !== "string" || !expr.trim()) return undefined;
  if (shouldSkipExprParse(expr)) {
    return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, nativeKind: "SkippedExpr", raw: expr };
  }
  try {
    const node = parseExprToNode(expr, filePath, startOffset ?? 0);
    // F-SQL-001: surface E-SQL-008 from unbalanced ?{} as a TABError when
    // an errors array is in scope. Falls back to escape-hatch otherwise.
    if (node && node.kind === "escape-hatch" && node.nativeKind === "SqlPlaceholderError" && node.sqlDiagnostic) {
      if (errors) {
        errors.push(new TABError(
          node.sqlDiagnostic.code || "E-SQL-008",
          node.sqlDiagnostic.message,
          node.span,
        ));
      }
    }
    // §6.8.2 (Step 9, Phase A1a) — surface E-RESET-NO-ARG diagnostics
    // attached by the expression-parser when `reset(...)` is malformed
    // (zero-arg, multi-arg, or spread). Walks the full ExprNode tree so
    // a malformed reset nested inside a larger expression is still caught.
    if (node && errors) {
      forEachResetExprInExprNode(node, (resetNode) => {
        if (resetNode.diagnostic) {
          errors.push(new TABError(
            resetNode.diagnostic.code || "E-RESET-NO-ARG",
            resetNode.diagnostic.message,
            resetNode.span,
          ));
        }
      });
      // §59.3 (Units 4+5) — surface map-literal parse-time diagnostics attached
      // by the legacy scanner (E-MAP-LITERAL-MALFORMED fatal; W-MAP-STRUCT-KEY-
      // LITERAL / W-MAP-DUPLICATE-LITERAL-KEY info → result.warnings via the
      // W-/I- prefix partition at api.js). Same surfacing pattern as reset-expr.
      forEachMapLitExprInExprNode(node, (mapNode) => {
        for (const d of mapNode.diagnostics ?? []) {
          errors.push(new TABError(d.code, d.message, mapNode.span));
        }
      });
    }
    return node;
  } catch (_e) {
    return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, nativeKind: "ParseError", raw: expr };
  }
}

/**
 * P3.B helper (F-ENGINE-001) — parse an exported type's expression body
 * captured by collectExpr() and reconstruct the (typeKind, raw-body) pair
 * that the type-decl AST node needs. Mirrors the construction performed
 * inline by the type-decl parser path (~line 4400) for non-exported types.
 *
 * Inputs (examples):
 *   "type Foo : enum = { OffDuty , OnDuty }"        ->  {typeKind: "enum",   raw: "{ OffDuty , OnDuty }"}
 *   "type Config : struct = { timeout : number }"   ->  {typeKind: "struct", raw: "{ timeout : number }"}
 *   "type Pair : tuple = { a , b }"                 ->  {typeKind: "tuple",  raw: "{ a , b }"}
 *   "type Foo : enum"                               ->  {typeKind: "enum",   raw: ""}
 *   "type Alias = number"                           ->  {typeKind: "",       raw: "number"}
 *   "type Alias = number | string"                  ->  {typeKind: "",       raw: "number | string"}
 *   (alternate form)
 *   "type : enum Foo { OffDuty }"                   ->  {typeKind: "enum",   raw: "{ OffDuty }"}
 *
 * The function tolerates the same syntax surface the type-decl parser path
 * already accepts. Whitespace from collectExpr() is preserved in the raw body.
 */
function parseExportedTypeBody(expr) {
  // Default result for malformed / nameless / kindless input.
  const empty = { typeKind: "", raw: "" };
  if (typeof expr !== "string") return empty;

  // Try alternate form first: "type : kind Name [{ body }]" (matches existing
  // ast-builder type-decl path's alternate form).
  let m = expr.match(/^\s*type\s*:\s*(\w+)\s+\w+\s*(.*)$/s);
  let typeKind = "";
  let rest = "";
  if (m) {
    typeKind = m[1] || "";
    rest = (m[2] || "").trim();
  } else {
    // Standard form: "type Name [: kind] [= body]"
    m = expr.match(/^\s*type\s+\w+\s*(?::\s*(\w+))?\s*(?:=\s*(.*))?$/s);
    if (!m) return empty;
    typeKind = m[1] || "";
    rest = (m[2] || "").trim();
  }

  // rest is the post-"=" body (or post-name body for the alternate form).
  if (!rest) return { typeKind, raw: "" };

  // Brace-bounded body: take everything between the OUTER `{` and its matching `}`.
  if (rest.startsWith("{")) {
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          // Reconstruct the raw body in the same shape as the existing
          // type-decl path: "{ " + inner + " }" (with the existing path's
          // exact spacing). Inner is rest.slice(1, i) — anything between
          // braces. Trim leading/trailing whitespace for stability.
          const inner = rest.slice(1, i).trim();
          return { typeKind, raw: "{ " + inner + " }" };
        }
      }
    }
    // Unbalanced — fall through, treat as inline.
  }

  // Inline body (alias / union / etc.) — preserved verbatim.
  return { typeKind, raw: rest };
}

// Module-level tokenizer references — overridable by buildAST(bsOutput, tokenizerOverrides)
let tokenizeAttributes = _defaultTokenizeAttributes;
let tokenizeLogic = _defaultTokenizeLogic;
let tokenizeSQL = _defaultTokenizeSQL;
let tokenizeCSS = _defaultTokenizeCSS;
let tokenizeError = _defaultTokenizeError;
let tokenizePassthrough = _defaultTokenizePassthrough;

// ---------------------------------------------------------------------------
// Pre-tokenization preprocessing
// ---------------------------------------------------------------------------

/**
 * Preprocess raw text before tokenization to handle constructs the tokenizer
 * can't parse. The tokenizer drops `#` characters, so `<#name>.send(...)` and
 * `<#name>` must be replaced with placeholder identifiers before tokenization.
 *
 * Order matters: worker refs (<#name>.send) must be replaced BEFORE input state
 * refs (<#name>) to avoid partial matches.
 */
function preprocessWorkerAndStateRefs(raw) {
  if (!raw || !raw.includes("<#")) return raw;
  // <#name>.send( → _scrml_worker_name.send(
  raw = raw.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*send\s*\(/g, '_scrml_worker_$1.send(');
  // when message from <#name> → when message from _scrml_worker_name
  raw = raw.replace(/when\s+message\s+from\s+<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, 'when message from _scrml_worker_$1');
  // when error from <#name> → when error from _scrml_worker_name
  raw = raw.replace(/when\s+error\s+from\s+<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, 'when error from _scrml_worker_$1');
  // <#name> (standalone state ref) → _scrml_input_$1_
  raw = raw.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, '_scrml_input_$1_');
  return raw;
}

// ---------------------------------------------------------------------------
// Block-level pre-processing: bare top-level declaration lifting
// ---------------------------------------------------------------------------

/**
 * Regex that matches text blocks starting with a bare declaration keyword.
 *
 * Matches (at the start of the raw content, which may have leading whitespace):
 *   server fn <name>  |  server function <name>  |  fn <name>
 *   function <name>   |  type <name>
 *   import { ... } from ... | import name from ...
 *
 * v0.3 Wave 2 extension (item b): the `(?:export\s+)?` prefix matches the
 * `export fn …` / `export function …` / `export type …` shapes; the
 * `let \w` / `const \w` shapes recognise plain-local declarations (the
 * derived-state `const <x>` shape is NOT matched here — it's a `<` after
 * `const`, which is caught by TOPLEVEL_STATE_DECL_RE).
 *
 * `import` is admitted so that `<program>`/`<page>`/`<channel>` direct-child
 * text beginning with `import { x } from '...'` (the canonical ES form) lifts
 * into a synthetic `${...}` block under v0.3 default-logic mode (SPEC §40.8).
 * Without this admission, a text block whose leading statement is `import`
 * fails the regex match — even when subsequent statements (e.g. `type ...`)
 * are declaration shapes — because BS merges sibling text fragments into a
 * single block and the lift gates on the LEADING content.
 */
// R25-Bug-42 (S138): admit `function*` / `fn*` (no whitespace before the `*`)
// so generator-function-decl shapes at <program>/<page>/<channel> direct-child
// position lift into the synthetic \`\${...}\` logic block per SPEC §40.8.
// Pre-fix, BARE_DECL_RE required \s after function/fn — `server function*`
// missed the gate and emitted as raw text (never parsed as function-decl,
// no server.js handler synthesized, all body contents silently dropped).
const BARE_DECL_RE = /^\s*(?:export\s+)?(server\s+(?:fn|function)[*\s]|type\s+\w|fn[*\s]\w?|function[*\s]\w?|let\s+[A-Za-z_]|const\s+[A-Za-z_]|import\s+[{a-zA-Z_*"'])/;

/**
 * Phase A1a Step 11.0d — top-level structural state-decl pattern.
 *
 * Matches text blocks that BS emitted when it detected the top-level state-decl
 * signal (`<count> = 0`, `const <doubled> = expr`, `<count>: number = 0`).
 * Such text blocks always start with optional `const`, optional whitespace,
 * then `<` IDENT (optionally with attrs), `>`, then `=` or `:`.
 *
 * Bug-3 (S101) extension: Variant C compound state-decl
 * (`<formRes><name>="" <email>="" </>`) is also a top-level state-decl
 * shape at <program>/<page>/<channel> direct-child position per SPEC §6.3.2 +
 * §40.8. BS's `peekCompoundStateDeclSignal` emits the entire compound span
 * as a single text block; this regex's alternation accepts the compound
 * shape (parent `>` followed by whitespace + `<` of nested child decl).
 *
 * SPEC §6.2 (Three RHS Shapes), §6.3.2 (Variant C compound),
 *      §6.6 (derived const), §35.2 (typed-decl), §40.8 (default-logic mode).
 *
 * Notes:
 *   - The regex anchors on `^\s*` to permit leading newlines/spaces.
 *   - Optional `const\s+` matches Shape 3 (derived).
 *   - The attrs portion `[^>]*` is permissive — actual attr parsing happens
 *     in parseLogicBody → tryParseStructuralDecl after the `${...}` wrap.
 *   - Original alternation `>\s*[=:]` matches Shape 1/2/3 (RHS-bearing).
 *   - New alternation `>\s*<[A-Za-z_]` matches Variant C compound (the
 *     parent's `>` is followed by whitespace and a nested child opener).
 *     Ordinary markup-prose like `<div><span>hello</></>` would also
 *     match this pattern at the regex level, but BS only emits such a
 *     text block when `peekCompoundStateDeclSignal` confirmed the shape
 *     (i.e., the nested `<child>` is itself a state-decl); ordinary
 *     markup-prose stays as markup nodes and never reaches this regex.
 */
const TOPLEVEL_STATE_DECL_RE =
  /^\s*(?:export\s+)?(?:const\s+)?<\s*[A-Za-z_][A-Za-z0-9_]*[^>]*>\s*(?:[=:]|<[A-Za-z_])/;

/**
 * §32 Gap 6 — tilde-bearing text at `<program>` / `<page>` / `<channel>`
 * direct child position. The v0.3 default-logic-mode promise (SPEC §40.8)
 * says these bodies parse as logic by default. BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE
 * lift the canonical decl shapes, but a text fragment that opens with a bare
 * call (e.g. `step1(2)\n  const result = step2(~)`) doesn't match those
 * patterns and stays as a TEXT node — emitting no code. The fragment
 * boundary can be created by an intervening JS line comment (`// ...`)
 * which BS extracts as a separate `comment` child, flushing the preceding
 * text. The `~` accumulator is an unambiguous tell that the fragment is
 * logic code (not markup prose), so lifting it on this signal is safe and
 * conservative. SPEC §32 is normative for `~`.
 */
const TILDE_TOKEN_RE = /(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/;

/**
 * Unit CC (S123) — bare `@name = expr` write text at `<program>` / `<page>` /
 * `<channel>` direct-child position. Pre-Unit-CC, such text was NOT auto-
 * lifted (BARE_DECL_RE matches keyword-led decls only, TOPLEVEL_STATE_DECL_RE
 * matches `<name>` opener) and stayed as a TEXT node — silently dropped at
 * codegen with no diagnostic. (Bug-q-1 reproducer: `<program>` body opening
 * with `@cell = X` produced a silent runtime miss.)
 *
 * Per the S122 user-voice Option-2 ratification, this shape is a SEMANTIC
 * error (writes are logic; logic goes in `${...}`). The lift wraps the text
 * in a synthetic `${...}` so the parser's V5-strict `@name = expr` site sees
 * the write, tags it `_isUnitCCWrite: true` via the synthetic-wrapper +
 * body-top discrimination, and SYM PASS 3 fires E-WRITE-NOT-IN-LOGIC-CONTEXT.
 *
 * Without this lift, Unit CC's enforcement would have a gap — the very shape
 * the diagnostic is meant to catch would silently skip the parser. The lift
 * is what makes the loud-error path reachable.
 *
 * Regex: matches text whose leading non-whitespace token is `@IDENT = ...`
 * (with the `=` not followed by another `=`, to exclude `==` comparison).
 * Conservative — only the canonical write shape is admitted; nested-path
 * forms (`@obj.path = X`) and array mutations (`@arr.push(X)`) reach the
 * parser via their own routes (they parse as expression statements at the
 * parser site and are tagged separately, not at the lift gate).
 */
const TOPLEVEL_AT_WRITE_RE =
  /^\s*@[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/;

/**
 * P2: regex matching a text block whose only meaningful content is the bare
 * `export` keyword. Used to detect the `export <ComponentName ...>...</>`
 * pattern (text "export " block followed by a PascalCase markup block).
 *
 * Allows a leading text payload (e.g. comments, whitespace) but requires the
 * trailing portion of the text block to be `export` with optional surrounding
 * whitespace — the markup that follows is the component body.
 */
const BARE_EXPORT_AT_END_RE = /(^|\s)export\s*$/;

/**
 * Bug-batch S93 (Bug 2): regex matching a text block whose TRAILING portion
 * is a const-or-let component-def header awaiting its markup RHS:
 *
 *   `const Name = `       (capture group 1 = leading prefix text)
 *   `let Name = `         (capture group 2 = "const"/"let" keyword + binding name)
 *   `export const Name = `
 *   `export let Name = `
 *
 * Used to detect the `const Name = <markup>...</>` Form 2 pattern when
 * declared as a direct child of `<program>` / `<page>` / file-root. Prior
 * to the Bug 2 fix, BS-layer split such declarations into a text block
 * (ending in the bare `const Name = `) and a markup block (the RHS),
 * and the lift pass did not re-pair them — leaving the const decl orphan-
 * referenced from the downstream component-expander pass (E-COMPONENT-035).
 *
 * Mirrors BARE_EXPORT_AT_END_RE's "trailing payload" shape; the leading
 * prefix is preserved verbatim as a separate text block so its content
 * (e.g. a preceding state-decl `<count> = 0`) is re-lifted by the existing
 * BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE rules.
 *
 * Match group 1 captures the prefix; group 2 captures the keyword + name +
 * `=` trailer (so the synthesized lift can re-build the full statement).
 *
 * IMPORTANT — case discrimination: the binding name must start with an
 * UPPERCASE letter ([A-Z]). Lowercase-name `const m = <main>...</>` is a
 * regular `const-decl` (whose init expression happens to start with `<`)
 * and is handled at the markup-render call-site, not as a component-def.
 * Only PascalCase names like `const TodoRow = <li>...</>` trigger the
 * component-def auto-lift. (See ast-builder.js:6991 — component-def
 * recognition gates on `name[0] === name[0].toUpperCase()`.)
 */
const BARE_DECL_NAME_EQ_AT_END_RE =
  /^([\s\S]*?)((?:^|\s)(?:export\s+)?(?:const|let)\s+[A-Z][A-Za-z0-9_]*\s*=\s*)$/;

// ---------------------------------------------------------------------------
// P2 Form 1 desugaring helpers — body-root absorbs outer attrs (SPEC §21.2)
//
// Goal: make `export <Name outerAttrs>{body}</Name>` produce an AST byte-
// equivalent to `export const Name = <bodyRoot bodyAttrs+outerAttrs>...</bodyRoot>`,
// i.e. drop the outer self-named wrapper. The body's single root markup
// element absorbs all of the outer's attributes; the outer tag itself
// disappears at the source level.
//
// Strategy: pure source-string manipulation on the BS-produced raw slices.
// The outer `next.raw` is `<Name outerAttrs>{children-text-and-blocks}</Name>`.
// We:
//   1. Extract the outer's opener-attrs portion (everything between the tag
//      name and the closing `>` of the opener).
//   2. Locate the single markup body root in `next.children` (skipping
//      whitespace text + comments). Multi-rooted / empty bodies trigger
//      E-EXPORT-002.
//   3. Compare attribute names between outer attrs and body-root attrs.
//      Conflicts trigger E-EXPORT-003.
//   4. Splice the outer attrs into the body root's opener `>`, producing a
//      new raw `<bodyTag bodyAttrs outerAttrs>...</bodyTag>` that downstream
//      TAB parses identically to the legacy `export const Name = <markup>` RHS.
// ---------------------------------------------------------------------------

/**
 * Scan an opener tag (`<TagName ...>` or `<TagName ... />`) starting at
 * position `start` in `raw`. Returns metadata about the opener:
 *   { attrStart, openerEnd, selfClosing, tagName }
 * where `attrStart` is the offset right after the tag name, and `openerEnd`
 * is the offset of the closing `>` (or the `/` of `/>` if self-closing).
 *
 * Mirrors block-splitter.scanAttributes in respecting:
 *   - Quote escaping ("..." and '...')
 *   - Brace nesting (sigil-prefixed ${, ?{, #{, !{, ^{, ~{ and bare {)
 *   - Paren nesting ((expr))
 *
 * Returns null if `raw` is malformed (no closing `>`).
 */
function scanOpenerForAttrs(raw, start) {
  const len = raw.length;
  if (start >= len || raw[start] !== "<") return null;
  let pos = start + 1;
  // Skip optional whitespace per §15.15 uniform opener
  while (pos < len && /\s/.test(raw[pos])) pos++;
  const nameStart = pos;
  while (pos < len && /[A-Za-z0-9_-]/.test(raw[pos])) pos++;
  const tagName = raw.slice(nameStart, pos);
  if (!tagName) return null;
  const attrStart = pos;
  let inDouble = false, inSingle = false;
  let braceDepth = 0, parenDepth = 0;
  let selfClosing = false;
  let openerEnd = -1;
  while (pos < len) {
    const c = raw[pos];
    if (braceDepth > 0) {
      if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      pos++;
      continue;
    }
    if (parenDepth > 0) {
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      pos++;
      continue;
    }
    if (!inDouble && !inSingle) {
      if (c === ">") { openerEnd = pos; break; }
      if (c === "/" && raw[pos + 1] === ">") {
        selfClosing = true;
        openerEnd = pos;
        break;
      }
      if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && raw[pos + 1] === "{") {
        braceDepth = 1;
        pos += 2;
        continue;
      }
      if (c === "{") { braceDepth++; pos++; continue; }
      if (c === "(") { parenDepth++; pos++; continue; }
      if (c === '"') { inDouble = true; pos++; continue; }
      if (c === "'") { inSingle = true; pos++; continue; }
    } else if (inDouble && c === '"') { inDouble = false; pos++; continue; }
    else if (inSingle && c === "'") { inSingle = false; pos++; continue; }
    else if (c === "\\") { pos += 2; continue; }
    pos++;
  }
  if (openerEnd === -1) return null;
  return { attrStart, openerEnd, selfClosing, tagName };
}

/**
 * Extract the trimmed attribute-portion source of an outer markup block.
 * Returns "" if no attrs, or null if malformed.
 */
function extractOuterAttrSource(rawOpener) {
  const scan = scanOpenerForAttrs(rawOpener, 0);
  if (!scan) return null;
  return rawOpener.slice(scan.attrStart, scan.openerEnd).trim();
}

/**
 * P3.A: Extract the value of `name="..."` (or `name='...'`) from a
 * `<channel name="X" ...>` opener. Returns the string content (without
 * surrounding quotes) or `null` if absent or non-literal.
 *
 * Channel names with reactive-ref values (`name=@var`) are NOT supported
 * for export — the W6 + DD1 wire-layer-by-name design requires a
 * compile-time-stable string identity. The TAB caller is expected to fall
 * through to error reporting if the result is null.
 */
function extractChannelNameFromOpener(rawOpener) {
  const attrSource = extractOuterAttrSource(rawOpener);
  if (attrSource === null || attrSource === "") return null;
  // Match `name="..."` or `name='...'` (string-literal form only).
  const m = attrSource.match(/\bname\s*=\s*("([^"]*)"|'([^']*)')/);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3];
}

/**
 * Parse a flat list of attribute names from a raw attribute-portion string.
 * Used for conflict detection between outer attrs and body-root attrs.
 *
 * For typed-prop syntax `name:type`, the conflict-relevant identifier is the
 * bare `name` (before `:`). For directives like `bind:value`, the full
 * `bind:value` is kept so it doesn't collide with `value`.
 *
 * Returns an array of `{ name, fullName, span: { start, end } }` (offsets
 * relative to attrSource).
 */
function parseAttrNames(attrSource) {
  const names = [];
  const len = attrSource.length;
  let pos = 0;
  while (pos < len) {
    while (pos < len && /\s/.test(attrSource[pos])) pos++;
    if (pos >= len) break;
    const nameStart = pos;
    while (pos < len && /[A-Za-z0-9_:\-.@]/.test(attrSource[pos])) pos++;
    if (pos === nameStart) { pos++; continue; }
    const fullName = attrSource.slice(nameStart, pos);
    let nameForCompare = fullName;
    const colonIdx = fullName.indexOf(":");
    if (colonIdx > 0) {
      const prefix = fullName.slice(0, colonIdx);
      const DIRECTIVE_PREFIXES = new Set([
        "bind", "on", "class", "use", "style", "transition", "in", "out", "animate",
      ]);
      if (!DIRECTIVE_PREFIXES.has(prefix)) {
        nameForCompare = prefix;
      }
    }
    names.push({ name: nameForCompare, fullName, span: { start: nameStart, end: pos } });
    while (pos < len && /\s/.test(attrSource[pos])) pos++;
    if (pos < len && attrSource[pos] === "=") {
      pos++;
      while (pos < len && /\s/.test(attrSource[pos])) pos++;
      if (pos >= len) break;
      const c = attrSource[pos];
      if (c === '"' || c === "'") {
        const quote = c;
        pos++;
        while (pos < len && attrSource[pos] !== quote) {
          if (attrSource[pos] === "\\" && pos + 1 < len) { pos += 2; continue; }
          pos++;
        }
        if (pos < len) pos++;
        continue;
      }
      if (c === "{" || ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && attrSource[pos + 1] === "{")) {
        if (c !== "{") pos++;
        let depth = 0;
        while (pos < len) {
          const ch = attrSource[pos];
          if (ch === "{") depth++;
          else if (ch === "}") { depth--; if (depth === 0) { pos++; break; } }
          pos++;
        }
        continue;
      }
      if (c === "(") {
        let depth = 0;
        while (pos < len) {
          const ch = attrSource[pos];
          if (ch === "(") depth++;
          else if (ch === ")") { depth--; if (depth === 0) { pos++; break; } }
          pos++;
        }
        continue;
      }
      while (pos < len && !/\s/.test(attrSource[pos])) pos++;
    }
  }
  return names;
}

/**
 * Find the single root markup block in `children`. Whitespace-only text
 * blocks and comment blocks are skipped. Returns:
 *   { ok: true, root }
 *   { ok: false, reason: "empty" | "multi-rooted", offendingBlocks }
 */
function findSingleBodyRoot(children) {
  const markupChildren = [];
  const textNonWs = [];
  for (const child of children) {
    if (!child) continue;
    if (child.type === "comment") continue;
    if (child.type === "text") {
      if (child.raw.trim().length === 0) continue;
      textNonWs.push(child);
      continue;
    }
    if (child.type === "markup" || child.type === "state") {
      markupChildren.push(child);
      continue;
    }
    textNonWs.push(child);
  }
  if (markupChildren.length === 0 && textNonWs.length === 0) {
    return { ok: false, reason: "empty", offendingBlocks: [] };
  }
  if (markupChildren.length !== 1 || textNonWs.length > 0) {
    return { ok: false, reason: "multi-rooted", offendingBlocks: [...markupChildren, ...textNonWs] };
  }
  return { ok: true, root: markupChildren[0] };
}

/**
 * Splice the outer's attribute-source into the body root's opener.
 * Given body root's `raw` and the outer attr source, produces a new raw
 * with the outer attrs appended after the body root's existing attrs.
 *
 * Returns the spliced raw string, or null if the body root's opener is
 * malformed.
 */
function spliceAttrsIntoBodyRoot(bodyRootRaw, outerAttrSource) {
  if (!outerAttrSource) return bodyRootRaw;
  const scan = scanOpenerForAttrs(bodyRootRaw, 0);
  if (!scan) return null;
  const before = bodyRootRaw.slice(0, scan.openerEnd);
  const after = bodyRootRaw.slice(scan.openerEnd);
  const sep = /\s$/.test(before) ? "" : " ";
  return before + sep + outerAttrSource + after;
}

/**
 * Recursively shift all span.start/span.end values in a block tree by `delta`.
 * Used to re-anchor blocks produced by re-invoking splitBlocks on a synthesized
 * source fragment. After shifting, the block's spans match where the synthesized
 * fragment lives in the original source's coordinate system.
 *
 * Mutates blocks in place (acceptable because they are freshly produced by
 * splitBlocks and not shared with anything else).
 */
function shiftBlockSpans(blocks, delta, lineDelta = 0) {
  for (const b of blocks) {
    if (b && b.span) {
      b.span = {
        ...b.span,
        start: b.span.start + delta,
        end: b.span.end + delta,
        line: b.span.line + lineDelta,
      };
    }
    if (b && b.children && b.children.length > 0) {
      shiftBlockSpans(b.children, delta, lineDelta);
    }
  }
}



/**
 * Walk a block tree and convert text blocks that start with a bare declaration
 * keyword into synthetic logic blocks.
 *
 * This enables bare top-level declarations inside any markup or state context:
 *
 *   <program>
 *     type Color:enum = { Red, Green, Blue }
 *     fn greet(name) { return "Hello " + name }
 *     server fn getData() { return ?{ SELECT * FROM items } }
 *   </program>
 *
 * The synthetic logic block wraps the raw text with `${` and `}` so buildBlock
 * case "logic" processes it normally (it slices off the first 2 and last 1 chars
 * to recover the original text as the body).
 *
 * Only text blocks whose trimmed content STARTS with a bare declaration keyword
 * are lifted. Plain whitespace-only text or markup content is left as-is.
 *
 * P2 (state-as-primary unification, 2026-04-30): Also pairs a top-level text
 * block ending in bare `export` with the immediately following PascalCase
 * markup block into a single synthetic logic block of the form
 * `${ export const ComponentName = <markup-raw> }`. This makes
 * `export <ComponentName ...>...</>` (canonical Form 1, SPEC §21.2) parse
 * identically to the legacy `${ export const Name = <markup> }` (Form 2):
 * both produce the same export-decl shape and the same exportRegistry entry
 * downstream. The pairing happens BEFORE buildBlock so all downstream
 * stages (TAB body parser, MOD, NR, CE, codegen) see Form 2 internals.
 *
 * @param {object[]} blocks  — Block[] from the Block Splitter
 * @returns {object[]}  — transformed Block[] (new array, no mutation)
 */
function liftBareDeclarations(blocks, errors, filePath, parentType = null, _p3aSynthCounter = { next: 0 }, isDefaultLogicBody = false) {
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Recurse into state children — server fns inside <db>/state contexts
    // are real declarations and need the same lift treatment. Pass
    // parentType="state" so a state block nested inside markup still lifts.
    if (block.type === "state") {
      // STATE blocks (`<state>` / `<db>` / etc.) are NOT default-logic-body
      // contexts (Unit CC's §40.8 surface). Pass isDefaultLogicBody=false
      // explicitly to ensure bare `@x = []` inside `<db>` bodies (canonical
      // reactive-cell declaration in V5-strict state-block grammar) is NOT
      // lifted into a Unit CC fire site.
      const newChildren = liftBareDeclarations(block.children || [], errors, filePath, "state", _p3aSynthCounter, false);
      result.push({ ...block, children: newChildren });
      continue;
    }

    // Recurse into markup children with a context flag. The lift transform
    // still fires for direct children of <program> (the canonical wrapper
    // for bare top-level declarations) and for state descendants, but is
    // suppressed for text inside any deeper markup descendant. This stops
    // BARE_DECL_RE from promoting markup-text content (e.g. prose inside
    // <p>function adds.</p>) into a synthetic logic block, while preserving
    // the bare-decl auto-lift inside <program>.
    // (Fix for Scope C finding A5 — see scrml-support/archive/changes/fix-bare-decl-markup-text-lift/.)
    if (block.type === "markup") {
      // Top-level <program> remains a declaration site for its direct text
      // children. Any other markup tag is prose context — its text children
      // must be passed through unchanged.
      //
      // S83 B4 — File-level `<channel>` body is also a declaration site
      // (SPEC §38.4 V5-strict channel body): `<messages> = []` declares an
      // auto-synced reactive cell at the channel scope. Treat channel-direct
      // text children as state-context so TOPLEVEL_STATE_DECL_RE lifts them
      // into synthetic `${...}` blocks (same path as <program> direct text).
      //
      // v0.3 Wave 2 — `<page>` is a per-route attribute container (SPEC §4.15,
      // §40.8); its body parses in default-logic mode symmetrically with
      // `<program>` body. Treat `<page>` direct text children as state-context
      // so the top-level declaration regex family (V5-strict state decl,
      // function/fn/server-fn, type, let/const, etc.) auto-lifts inside the
      // page body — same path as <program>.
      const isProgramRoot = parentType !== "markup" && block.name === "program";
      const isChannelRoot = parentType !== "markup" && block.name === "channel";
      const isPageRoot = parentType !== "markup" && block.name === "page";
      const childContext = (isProgramRoot || isChannelRoot || isPageRoot) ? "state" : "markup";
      // Unit CC (S123) — propagate a precise default-logic-body marker (true
      // only for direct children of <program>/<page>/<channel> markup, the
      // canonical §40.8 default-logic-mode surface). The existing
      // `parentType === "state"` is overloaded — it admits BOTH this case AND
      // `<state>`/`<db>` STATE-block children (where bare `@x = []` is the
      // canonical reactive-cell declaration in V5-strict state-block
      // grammar). Unit CC fires only inside the §40.8 surface.
      const childIsDefaultLogicBody = (isProgramRoot || isChannelRoot || isPageRoot);
      const newChildren = liftBareDeclarations(block.children || [], errors, filePath, childContext, _p3aSynthCounter, childIsDefaultLogicBody);
      result.push({ ...block, children: newChildren });
      continue;
    }

    // P2: Pair a top-level text block ending in bare `export` with the
    // immediately following PascalCase markup block. Suppressed inside
    // non-program markup (parentType === "markup") and inside any context
    // where the text content does not match the bare-export trailer.
    //
    // Pattern detected: text containing trailing bare `export ` followed
    // by markup block <ComponentName ...>...</ComponentName>
    //
    // Per SPEC §21.2 (P2-wrapper amendment): desugar to a synthetic logic
    // block whose body is `export const NAME = <body-root attrs+outer-attrs>...</body-root>`
    // — i.e. the OUTER self-named tag is dropped at the source level and
    // the body's single root markup element absorbs all of the outer's
    // attributes. This makes Form 1 byte-equivalent to Form 2's RHS:
    //   Form 1: `export <Card title:string><div>${title}</div></Card>`
    //   Form 2: `export const Card = <div title:string>${title}</div>`
    //
    // Failure modes:
    //   E-EXPORT-002 — body is empty or has more than one root markup element
    //   E-EXPORT-003 — outer attr conflicts with body-root attr (same name)
    if (
      block.type === "text" &&
      parentType !== "markup" &&
      BARE_EXPORT_AT_END_RE.test(block.raw)
    ) {
      const next = blocks[i + 1];
      if (next && next.type === "markup" && next.isComponent === true && next.name) {
        const m = block.raw.match(/^([\s\S]*?)((?:^|\s)export\s*)$/);
        const preExportRaw = m ? m[1] : "";
        if (preExportRaw.length > 0) {
          result.push({
            ...block,
            raw: preExportRaw,
            span: { ...block.span, end: block.span.start + preExportRaw.length },
          });
        }
        const compName = next.name;

        // Step 1: extract the outer's attribute portion.
        const outerAttrSource = extractOuterAttrSource(next.raw);
        // outerAttrSource === null is unreachable for a well-formed BS markup
        // block (BS itself parses the opener), but defensively handle it by
        // falling through to the legacy synthesis path.

        // Step 2: locate the single root markup body.
        const bodyResult = findSingleBodyRoot(next.children || []);
        if (!bodyResult.ok) {
          // E-EXPORT-002 — body is empty or multi-rooted
          const reason = bodyResult.reason;
          const message = reason === "empty"
            ? `E-EXPORT-002: Component \`${compName}\` declared with \`export <${compName}>\` form must have a non-empty single-rooted body. Wrap the body in a container element such as \`<div>...</>\`.`
            : `E-EXPORT-002: Component \`${compName}\` declared with \`export <${compName}>\` form must be single-rooted; wrap multiple elements in a container such as \`<div>...</>\`.`;
          errors.push(new TABError("E-EXPORT-002", message, fullSpan(next.span, filePath)));
          // Fail-open: do not emit a synthetic export-decl. The next block is
          // consumed (advance i) so we don't re-process it as orphan markup.
          i += 1;
          continue;
        }
        const bodyRoot = bodyResult.root;

        // Step 3: detect attr-name conflicts between outer and body root.
        let bodyAttrSource = "";
        if (bodyRoot.type === "markup" || bodyRoot.type === "state") {
          const bodyOpenerScan = scanOpenerForAttrs(bodyRoot.raw, 0);
          if (bodyOpenerScan) {
            bodyAttrSource = bodyRoot.raw.slice(bodyOpenerScan.attrStart, bodyOpenerScan.openerEnd).trim();
          }
        }
        const outerNames = outerAttrSource ? parseAttrNames(outerAttrSource) : [];
        const bodyNames = bodyAttrSource ? parseAttrNames(bodyAttrSource) : [];
        const bodyNameSet = new Set(bodyNames.map(n => n.name));
        // §15.5 class-merging exception: `class` may legitimately appear on
        // both the outer and the body root because scrml class-attr merging
        // combines them. Only flag conflicts for non-class names.
        const conflicts = outerNames.filter(n => n.name !== "class" && bodyNameSet.has(n.name));
        if (conflicts.length > 0) {
          const c = conflicts[0];
          errors.push(new TABError(
            "E-EXPORT-003",
            `E-EXPORT-003: Component \`${compName}\` declaration conflicts with body root attr \`${c.name}\`; choose one location for this attribute.`,
            fullSpan(next.span, filePath),
          ));
          i += 1;
          continue;
        }

        // Step 4: splice outer attrs into body root opener, producing the
        // RHS markup raw for `export const NAME = <body-root mergedAttrs>...</body-root>`.
        const splicedRaw = spliceAttrsIntoBodyRoot(bodyRoot.raw, outerAttrSource || "");
        if (splicedRaw === null) {
          // Defensive: body root's opener is malformed (BS would have caught
          // this already, but if it slipped through, fall back to E-EXPORT-002).
          errors.push(new TABError(
            "E-EXPORT-002",
            `E-EXPORT-002: Component \`${compName}\` body root markup element is malformed.`,
            fullSpan(next.span, filePath),
          ));
          i += 1;
          continue;
        }

        // Build the synthesized logic-body source string and re-invoke
        // splitBlocks on it to obtain the proper block tree (with nested
        // ${...}/?{...}/etc. as flat children of the top-level logic block,
        // matching how Form 2 (`${ export const NAME = <markup> }`) is parsed).
        const synthFullRaw = "${ export const " + compName + " = " + splicedRaw + " }";
        const reBs = _splitBlocksForP2Form1(filePath || "<p2-form1>", synthFullRaw);
        const reBlocks = reBs.blocks || [];
        // Find the logic block produced (should be reBlocks[0]; defensive lookup).
        const reLogic = reBlocks.find(b => b && b.type === "logic");
        if (!reLogic) {
          // Defensive: re-parsing failed. Fall through to a minimal synthesis
          // that at least preserves export-decl visibility (no proper children).
          result.push({
            type: "logic",
            raw: synthFullRaw,
            span: {
              start: block.span.start,
              end: next.span.end,
              line: block.span.line,
              col: block.span.col,
            },
            depth: block.depth,
            children: [],
            name: null,
            closerForm: null,
            isComponent: false,
            _synthetic: true,
            _p2Form1: true,
            _p2Form1Name: compName,
            _p2Form1BodyRoot: bodyRoot.name,
          });
          i += 1;
          continue;
        }
        // Shift spans of the re-parsed logic block (and all descendants) so
        // they map into the original source's coordinate system. Anchor the
        // synthesized logic block at the original text-block start.
        const delta = block.span.start - reLogic.span.start;
        const lineDelta = block.span.line - reLogic.span.line;
        shiftBlockSpans([reLogic], delta, lineDelta);
        // Tag the re-parsed logic block with P2 Form 1 markers.
        const synthetic = {
          ...reLogic,
          depth: block.depth,
          _synthetic: true,
          _p2Form1: true,
          _p2Form1Name: compName,
          _p2Form1BodyRoot: bodyRoot.name,
        };
        result.push(synthetic);
        i += 1; // skip the markup block we just consumed
        continue;
      }
      // ---------------------------------------------------------------
      // P3.A: `export <channel name="X" attrs>{body}</>` form
      //
      // Mirrors the component Form 1 detection above but for channel
      // markup blocks (block.isComponent === false, block.name === "channel").
      // Emits:
      //   (a) the pre-export text prefix (preserved like the component case)
      //   (b) a synthetic logic block whose body contains an export-decl
      //       tagged `_p3aChannelExport: <channelName>` — at TAB build time
      //       this is rewritten to {exportKind: "channel", exportedName: <name>}
      //       so MOD registers it with category=channel
      //   (c) the channel markup block, tagged `_p3aIsExport: true`
      //
      // Per P3 deep-dive §4.1 + §6.2.
      // ---------------------------------------------------------------
      if (next && next.type === "markup" && next.name === "channel") {
        const m = block.raw.match(/^([\s\S]*?)((?:^|\s)export\s*)$/);
        const preExportRaw = m ? m[1] : "";
        if (preExportRaw.length > 0) {
          result.push({
            ...block,
            raw: preExportRaw,
            span: { ...block.span, end: block.span.start + preExportRaw.length },
          });
        }

        // Extract the channel's `name=` attribute value (string-literal only).
        const channelName = extractChannelNameFromOpener(next.raw);
        if (!channelName) {
          // E-CHANNEL-EXPORT-001 (NEW in P3.A): channel exported without a
          // string-literal `name=` attribute. Wire-layer identity requires
          // a compile-time-stable name; reactive-ref forms (`name=@var`) are
          // not supported for export.
          errors.push(new TABError(
            "E-CHANNEL-EXPORT-001",
            `E-CHANNEL-EXPORT-001: \`export <channel ...>\` requires a string-literal \`name="..."\` attribute. ` +
            `Reactive-ref forms (e.g. \`name=@var\`) are not supported for cross-file channel exports because ` +
            `the wire-layer identity must be compile-time stable. Add \`name="topic-name"\` to the channel opener.`,
            fullSpan(next.span, filePath),
          ));
          // Fail-open: emit the channel markup block as a per-page (non-export)
          // declaration so downstream stages can still parse it. The export
          // is dropped (the file becomes a per-page channel without a
          // cross-file binding).
          result.push(next);
          i += 1;
          continue;
        }

        // (b) Synthesize a logic block carrying the channel-export marker.
        // The synthesized body uses a unique helper-const name to satisfy
        // parseLogicBody's regex for export-decl recognition. After
        // parseLogicBody runs (in buildBlock), we rewrite the export-decl's
        // {exportKind, exportedName} to {"channel", channelName}. See the
        // post-processing in buildBlock for type="logic" (look for
        // `_p3aChannelExport`).
        const synthIdx = ++_p3aSynthCounter.next;
        const synthHelperName = `_p3a_channel_export_${synthIdx}`;
        const synthRaw = `\${ export const ${synthHelperName} = ${JSON.stringify(channelName)} }`;
        result.push({
          type: "logic",
          raw: synthRaw,
          span: {
            start: block.span.start,
            end: block.span.start + synthRaw.length,
            line: block.span.line,
            col: block.span.col,
          },
          depth: block.depth,
          children: [],
          name: null,
          closerForm: null,
          isComponent: false,
          _synthetic: true,
          _p3aChannelExport: channelName,
        });

        // (c) Push the channel markup block, tagged with isExport flag.
        result.push({
          ...next,
          _p3aIsExport: true,
          _p3aExportName: channelName,
        });
        i += 1; // skip the channel markup block we just consumed
        continue;
      }
      // ---------------------------------------------------------------
      // Phase A1b B14: `export <engine ...>` Form 1 (SPEC §51.0.D + §21.8 / M18)
      //
      // Engines parse as `block.type === "state"` (state-form lifecycle —
      // see _STATE_FORM_LIFECYCLE) with `block.name === "engine"` or
      // (deprecated) `"machine"`. The detection here mirrors the channel-
      // export pattern above:
      //   (a) emit the pre-export text prefix (preserved verbatim)
      //   (b) emit the engine state block, tagged `_b14IsExport: true`
      //
      // The engine's body is RAW TEXT (engine-decl.rulesRaw is built from
      // children at AST-build time); there is no need for a synthetic
      // export-decl logic block here — the engine itself is the AST node,
      // and the `isExported` flag flows through to MOD's exportRegistry
      // via `file.ast.machineDecls` (B14 MOD enhancement reads the flag).
      // Per SPEC §51.0.D + §21.8, an exported engine's auto-declared
      // variable name (or `var=` override) is the cross-file mount tag.
      // ---------------------------------------------------------------
      if (next && (next.type === "state" || next.type === "markup")
          && (next.name === "engine" || next.name === "machine")) {
        const m = block.raw.match(/^([\s\S]*?)((?:^|\s)export\s*)$/);
        const preExportRaw = m ? m[1] : "";
        if (preExportRaw.length > 0) {
          result.push({
            ...block,
            raw: preExportRaw,
            span: { ...block.span, end: block.span.start + preExportRaw.length },
          });
        }
        // Push the engine state block, tagged with isExport flag.
        // The flag survives buildBlock and lands on the engine-decl AST
        // node as `isExported: true` (see the engine-decl construction
        // in buildBlock; the flag is read off block._b14IsExport).
        result.push({
          ...next,
          _b14IsExport: true,
        });
        i += 1; // skip the engine state block we just consumed
        continue;
      }
    }

    // ---------------------------------------------------------------
    // Bug-batch S93 — Bug 2: `const Name = <markup>` Form 2 auto-lift.
    //
    // BS-layer splits `const TodoRow = <li>...</li>` into a TEXT block
    // (ending in `const TodoRow = `) and a MARKUP block (`<li>...</li>`).
    // Inside `${...}` wrappers this re-pairs at parseLogicBody time, but
    // at `<program>` direct-child level the two BS-emitted blocks remain
    // separate siblings — the const decl orphan is incomplete, the markup
    // is dangling, and component-expander emits E-COMPONENT-035 at the
    // use-site.
    //
    // Detect: text block whose trailing payload is
    //     `(?:export\s+)?(?:const|let)\s+NAME\s*=\s*$`
    // followed by a markup-block sibling. Pair them into a synthetic
    // logic block:
    //     `${ <prefix> <const|let> NAME = <markup-raw> }`
    // The leading text prefix is preserved verbatim as a separate text
    // block (so any preceding state-decl `<count> = 0` re-traverses the
    // existing TOPLEVEL_STATE_DECL_RE lift). The trailing `const NAME =
    // <markup-raw>` is the component-def the user authored.
    //
    // Suppressed when parentType === "markup" — inside a non-program
    // markup element, the text is prose, not a decl trailer.
    if (
      block.type === "text" &&
      parentType !== "markup" &&
      BARE_DECL_NAME_EQ_AT_END_RE.test(block.raw)
    ) {
      const next = blocks[i + 1];
      if (next && next.type === "markup") {
        const m = block.raw.match(BARE_DECL_NAME_EQ_AT_END_RE);
        const prefixRaw = m ? m[1] : "";
        const trailerRaw = m ? m[2] : "";
        // Emit the prefix as its own text block so existing lift rules
        // re-process it (handles a preceding `<count> = 0` state-decl,
        // a preceding `function f() { ... }` bare-decl, etc.).
        if (prefixRaw.length > 0) {
          result.push({
            ...block,
            raw: prefixRaw,
            span: { ...block.span, end: block.span.start + prefixRaw.length },
          });
          // Re-run the lift recursively on a 1-block list so the prefix's
          // own lift rules (BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE) fire.
          // Forward isDefaultLogicBody so Unit CC lift gating composes.
          const last = result.pop();
          const lifted = liftBareDeclarations([last], errors, filePath, parentType, _p3aSynthCounter, isDefaultLogicBody);
          for (const b of lifted) result.push(b);
        }
        // Pair the trailer `(export )?(const|let) NAME = ` with the next
        // markup block's verbatim raw. The synthesized logic-body source
        // is `(export )?(const|let) NAME = <markup-raw>`.
        const synthBody = trailerRaw.trimStart() + next.raw;
        const synthFullRaw = "${ " + synthBody + " }";
        result.push({
          type: "logic",
          raw: synthFullRaw,
          span: {
            start: block.span.start + prefixRaw.length,
            end: next.span.end,
            line: block.span.line,
            col: block.span.col,
          },
          depth: block.depth,
          children: [],
          name: null,
          closerForm: null,
          isComponent: false,
          _synthetic: true,
          _bug2DeclMarkupPair: true,
        });
        i += 1; // skip the markup block we just consumed
        continue;
      }
    }

    // Convert text blocks that start with a bare declaration keyword.
    // Suppressed when parentType === "markup" (i.e. inside non-program
    // markup) — text there is prose content, not a declaration.
    if (block.type === "text" && parentType !== "markup" && BARE_DECL_RE.test(block.raw)) {
      result.push({
        type: "logic",
        raw: "${" + block.raw + "}",
        span: block.span,
        depth: block.depth,
        children: [],       // text blocks have no block children
        name: null,
        closerForm: null,
        isComponent: false,
        _synthetic: true,   // diagnostic marker
        // S180 D3.1 — this synthetic block PREPENDS a fictional `${` to raw while
        // keeping span at body[0]; the `case "logic"` handler keys on this flag
        // to NOT advance bodyOffset past the (non-existent) `${` (else every
        // child node span is shifted +2 — see W-DEPRECATED-SERVER-MODIFIER /
        // Migration 4). Distinct from `_synthetic` (the export-pairing synthetic
        // blocks carry `_synthetic` but DO have a real `${` and need the +2).
        _bareDeclLift: true,
      });
      continue;
    }

    // Phase A1a Step 11.0d — top-level structural state-decl lift.
    //
    // SPEC §6.2 (Three RHS Shapes for State Declarations) — `<count> = 0` at
    // FILE TOP-LEVEL is canonical Shape 1. BS now emits this as a text block
    // (see block-splitter.js peekTopLevelStateDeclSignal). Wrap it in ${...}
    // so parseLogicBody's tryParseStructuralDecl (Steps 2/11.0a/11.0c) parses
    // it as a state-decl with structuralForm:true.
    //
    // Suppressed when parentType === "markup" (prose context). Mirrors
    // BARE_DECL_RE's policy: lift fires at true top level and inside
    // <program> direct text children (parentType === "state"), not inside
    // arbitrary markup elements.
    if (block.type === "text" && parentType !== "markup" && TOPLEVEL_STATE_DECL_RE.test(block.raw)) {
      result.push({
        type: "logic",
        raw: "${" + block.raw + "}",
        span: block.span,
        depth: block.depth,
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
        _synthetic: true,
        _toplevelStateDecl: true, // diagnostic marker
        // S180 D3.1 — this synthetic block PREPENDS a fictional `${` to raw while
        // keeping span at body[0]; the `case "logic"` handler keys on this flag
        // to NOT advance bodyOffset past the (non-existent) `${` (else every
        // child node span is shifted +2 — see W-DEPRECATED-SERVER-MODIFIER /
        // Migration 4). Distinct from `_synthetic` (the export-pairing synthetic
        // blocks carry `_synthetic` but DO have a real `${` and need the +2).
        _bareDeclLift: true,
      });
      continue;
    }

    // §32 Gap 6 — `~`-bearing text at <program>/<page>/<channel> direct child.
    //
    // BS extracts JS line comments (`// ...`) as separate `comment` children
    // at markup/state context, which flushes the preceding text. A text
    // fragment after such a comment that opens with a bare call (e.g.
    // `step1(2)\n  const result = step2(~)`) does NOT start with a decl
    // keyword, so BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE skip it and the
    // fragment stays as a TEXT node, emitting no code (E-SCOPE-001 fires on
    // downstream references to `result`). Lifting on `~`-token presence is
    // conservative: `~` is an unambiguous logic-mode signal (SPEC §32 is
    // normative); prose containing literal `~` is not produced by adopters
    // at <program>/<page>/<channel> direct-child position.
    //
    // Gated on parentType === "state" (= <program>, <page>, <channel> direct
    // children — see liftBareDeclarations's parentType propagation above)
    // to avoid lifting prose markup that happens to contain `~`.
    if (block.type === "text" && parentType === "state" && TILDE_TOKEN_RE.test(block.raw)) {
      result.push({
        type: "logic",
        raw: "${" + block.raw + "}",
        span: block.span,
        depth: block.depth,
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
        _synthetic: true,
        _tildeBearingLift: true,  // diagnostic marker
        // S180 D3.1 — this synthetic block PREPENDS a fictional `${` to raw while
        // keeping span at body[0]; the `case "logic"` handler keys on this flag
        // to NOT advance bodyOffset past the (non-existent) `${` (else every
        // child node span is shifted +2 — see W-DEPRECATED-SERVER-MODIFIER /
        // Migration 4). Distinct from `_synthetic` (the export-pairing synthetic
        // blocks carry `_synthetic` but DO have a real `${` and need the +2).
        _bareDeclLift: true,
      });
      continue;
    }

    // Unit CC (S123) — bare `@name = expr` write at <program>/<page>/
    // <channel> direct-child text position. Wrap in synthetic `${...}` so
    // the parser observes the write and the SYM PASS 3 fire site reaches
    // E-WRITE-NOT-IN-LOGIC-CONTEXT. See TOPLEVEL_AT_WRITE_RE comment for
    // rationale (pre-Unit-CC silent drop closed at the lift gate).
    //
    // Gated on `isDefaultLogicBody === true` — the PRECISE §40.8 default-
    // logic-body surface. Suppressed inside `<db>` / `<state>` STATE-block
    // bodies (parentType === "state" but isDefaultLogicBody === false), where
    // bare `@x = []` is the canonical V5-strict reactive-cell declaration
    // for the state-block grammar (e.g., `<db>` direct-child `@products =
    // []` is intentional, not a Unit CC violation).
    if (block.type === "text" && isDefaultLogicBody && TOPLEVEL_AT_WRITE_RE.test(block.raw)) {
      result.push({
        type: "logic",
        raw: "${" + block.raw + "}",
        span: block.span,
        depth: block.depth,
        children: [],
        name: null,
        closerForm: null,
        isComponent: false,
        _synthetic: true,
        _atWriteLift: true,  // diagnostic marker — Unit CC lift origin
        // S180 D3.1 — this synthetic block PREPENDS a fictional `${` to raw while
        // keeping span at body[0]; the `case "logic"` handler keys on this flag
        // to NOT advance bodyOffset past the (non-existent) `${` (else every
        // child node span is shifted +2 — see W-DEPRECATED-SERVER-MODIFIER /
        // Migration 4). Distinct from `_synthetic` (the export-pairing synthetic
        // blocks carry `_synthetic` but DO have a real `${` and need the +2).
        _bareDeclLift: true,
      });
      continue;
    }

    result.push(block);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class TABError extends Error {
  constructor(code, message, span) {
    super(`${message} (line ${span.line}, col ${span.col})`);
    this.name = "TABError";
    this.code = code;
    this.tabSpan = span;
  }
}

// ---------------------------------------------------------------------------
// E-SWITCH-FORBIDDEN — expression-text scanner
// ---------------------------------------------------------------------------

/**
 * §17 + §34: the JS `switch` keyword is universally forbidden in scrml. The
 * post-parse `collectForbiddenSwitches` walker (S99 A7) catches every
 * `switch-stmt` AST node, but the walker only fires when the parser produced
 * a `switch-stmt` node in the AST. Several call sites consume `${...}` body
 * text as a raw expression string and hand it to acorn via `parseExprToNode`
 * — when the body's first depth-0 keyword is `switch`, acorn fails the parse
 * (`switch` is a statement keyword, not an expression) and returns an
 * `escape-hatch` ExprNode with `nativeKind: "ParseError"`. No `switch-stmt`
 * node ever lands in the AST and the walker has nothing to walk.
 *
 * Concrete bypass path (the FOLLOW-UP gap pinned by S99 A7):
 *   `<button onclick=${ switch (1) { case 1: ... } }>x</button>`
 *   ─► block-splitter emits one markup block for `<button ...>x</button>`
 *   ─► tokenizer emits one ATTR_EXPR token holding the raw inner text
 *      (` switch (1) { case 1: ... } `) — see tokenizer.ts:455-473
 *   ─► parseAttributes' ATTR_EXPR branch (~L1435) hands the raw to
 *      safeParseExprToNodeGlobal → parseExprToNode → acorn parseExpression
 *      → ParseError escape-hatch → silently swallowed
 *
 * Other call sites with the same shape:
 *   - parseAttributes ATTR_BLOCK non-props branch (~L1418): `{...}` brace-block
 *     value (lambda or event handler) — also fed to safeParseExprToNodeGlobal
 *   - parseLiftTag attribute-value BLOCK_REF branch (~L2924-2935): inline
 *     `${...}` value inside a `lift <tag attr=${...}/>` markup (the parser
 *     unwraps the `${ ... }` shell and passes the inner to safeParseExprToNode)
 *
 * Structural fix: at every call site where a `${...}` (or `{...}`) body's
 * RAW INNER TEXT is sent to acorn-based parsing without going through the
 * full TAB statement-parser path, ALSO scan the raw text for the `switch`
 * keyword at depth-0 statement-start position and emit E-SWITCH-FORBIDDEN.
 *
 * `findForbiddenSwitchInRaw(raw, innerStartOffset)`:
 *   - `raw`: the inner expression text (the contents BETWEEN `${` and `}`,
 *     or BETWEEN `{` and `}`, etc.). Excludes the brace delimiters.
 *   - `innerStartOffset`: absolute source offset of `raw[0]`. The caller
 *     computes this from `valTok.span.start + 2` for `${...}` (skip 2 chars
 *     for `${`) or `valTok.span.start + 1` for `{...}` (skip 1 for `{`).
 *
 * Returns an array of `{ absoluteOffset }` — one entry per `switch` keyword
 * occurrence at depth-0 statement-position. The caller emits one
 * E-SWITCH-FORBIDDEN per entry, using a span whose `start` equals
 * `absoluteOffset`; dedup against `collectForbiddenSwitches` is automatic
 * because dedup is keyed on `(file, span.start)` and the walker can only fire
 * for switch-stmt nodes — which by definition don't exist on this path.
 *
 * String / comment skipping is conservative: line comments (`//`), block
 * comments (`/* * /`), single-quoted strings, double-quoted strings, and
 * template literals (`` ` `` ... `` ` ``) are skipped. INSIDE a template
 * literal's `${...}` interpolation, the scanner re-enters expression mode and
 * still detects `switch`. Property-access shape (`.switch`) is excluded — a
 * dot-prefixed `switch` is a JS property name, not a keyword.
 *
 * The scanner is intentionally simple: it does NOT track operator context, so
 * a `switch` used as a freestanding identifier-in-expression-position (e.g.
 * `let switch = 1`) WOULD also fire — but that's correct: `switch` is a
 * reserved word in JS and cannot be used as an identifier anywhere either,
 * per SPEC §17's universal forbid clause.
 */
function findForbiddenSwitchInRaw(raw, innerStartOffset) {
  if (!raw || typeof raw !== "string") return [];
  // Fast path: no `switch` substring at all.
  if (raw.indexOf("switch") === -1) return [];
  const out = [];
  const n = raw.length;
  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);

  // Recursive-ish scan over a region [start, n). `templateDepth` tracks brace
  // depth inside a template-literal interpolation so we know when to exit
  // back to the literal context (caller's responsibility — this helper just
  // walks linearly and skips delimited regions).
  let i = 0;
  while (i < n) {
    const c = raw[i];
    // Line comment
    if (c === "/" && raw[i + 1] === "/") {
      i += 2;
      while (i < n && raw[i] !== "\n") i++;
      continue;
    }
    // Block comment
    if (c === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < n - 1 && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Double-quoted string
    if (c === '"') {
      i++;
      while (i < n && raw[i] !== '"') {
        if (raw[i] === "\\" && i + 1 < n) { i += 2; continue; }
        i++;
      }
      i++;
      continue;
    }
    // Single-quoted string
    if (c === "'") {
      i++;
      while (i < n && raw[i] !== "'") {
        if (raw[i] === "\\" && i + 1 < n) { i += 2; continue; }
        i++;
      }
      i++;
      continue;
    }
    // Template literal — scan inside, but re-enable detection inside `${...}`.
    if (c === "`") {
      i++;
      while (i < n && raw[i] !== "`") {
        if (raw[i] === "\\" && i + 1 < n) { i += 2; continue; }
        if (raw[i] === "$" && raw[i + 1] === "{") {
          // Interpolation: scan inside as expression. Track brace depth so
          // we close the interpolation correctly. Inside, we still detect
          // `switch` at any depth (consistent with the outer-loop behavior;
          // depth here means template-interpolation brace depth, not
          // statement-vs-expression context).
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const cc = raw[i];
            if (cc === "{") { depth++; i++; continue; }
            if (cc === "}") {
              depth--;
              i++;
              if (depth === 0) break;
              continue;
            }
            // Skip nested strings inside interpolation (minimal — just
            // quotes and template literals; avoids false-positives on
            // string content like `"a switch"`).
            if (cc === '"' || cc === "'") {
              const q = cc;
              i++;
              while (i < n && raw[i] !== q) {
                if (raw[i] === "\\" && i + 1 < n) { i += 2; continue; }
                i++;
              }
              i++;
              continue;
            }
            // `switch` keyword inside interpolation
            if (cc === "s" && raw.slice(i, i + 6) === "switch") {
              const before = i > 0 ? raw[i - 1] : " ";
              const after = i + 6 < n ? raw[i + 6] : " ";
              if (!isWordChar(before) && before !== "." && !isWordChar(after)) {
                out.push({ absoluteOffset: innerStartOffset + i });
              }
            }
            i++;
          }
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    // `switch` keyword — word-boundary match, exclude property-access (`.switch`).
    if (c === "s" && raw.slice(i, i + 6) === "switch") {
      const before = i > 0 ? raw[i - 1] : " ";
      const after = i + 6 < n ? raw[i + 6] : " ";
      if (!isWordChar(before) && before !== "." && !isWordChar(after)) {
        out.push({ absoluteOffset: innerStartOffset + i });
        i += 6;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Wrapper around `findForbiddenSwitchInRaw` that emits one TABError per hit
 * directly into the supplied `errors` array.
 *
 * `raw` is the token's text (the content already extracted by the tokenizer —
 * for `${...}` the inner expression text, for `{...}` the inner block text,
 * for `(...)` the parenthesized expression including the parens, for `"..."`
 * the inner string content). `valTokSpan` is the token's span (covers the
 * entire token including any delimiters).
 *
 * `baseOffset` is the absolute source offset of `raw[0]`. Callers compute
 * this as `valTokSpan.start + delimiterChars` where delimiterChars is the
 * count of delimiter characters at the start of the token's source:
 *   2 for `${...}` (skip `$` and `{`)
 *   1 for `{...}` ATTR_BLOCK (skip `{`)
 *   1 for `"..."` (skip `"`)
 *   0 for `(...)` ATTR_EXPR (token text includes parens)
 *   0 for unquoted / `!...` ATTR_EXPR (no leading delimiter)
 *
 * The resulting `span.start` is the exact absolute source offset of the
 * `switch` keyword — within the same uniqueness space as the inline TAB
 * fire-site spans, so the post-parse `collectForbiddenSwitches` walker's
 * dedup index `(file, span.start)` works transparently. (In practice, no
 * switch-stmt AST node can land here — acorn rejects `switch` as an
 * expression — so dedup is structurally impossible to violate, but
 * matching the span shape keeps the invariant clean.)
 */
function emitForbiddenSwitchInRaw(raw, valTokSpan, baseOffset, filePath, errors) {
  if (!raw || !valTokSpan) return;
  const hits = findForbiddenSwitchInRaw(raw, baseOffset);
  if (hits.length === 0) return;
  for (const hit of hits) {
    const relIndex = hit.absoluteOffset - baseOffset;
    // Compute line/col by walking the raw prefix.
    let line = valTokSpan.line;
    let col = valTokSpan.col + (baseOffset - valTokSpan.start);
    for (let j = 0; j < relIndex; j++) {
      if (raw[j] === "\n") { line++; col = 1; }
      else { col++; }
    }
    const span = {
      file: filePath,
      start: hit.absoluteOffset,
      end: hit.absoluteOffset + 6,
      line,
      col,
    };
    errors.push(new TABError(
      "E-SWITCH-FORBIDDEN",
      "E-SWITCH-FORBIDDEN: `switch` is not a scrml keyword. " +
      "Did you mean: " +
      "`<match for=Type> ... </match>` for structural exhaustive case-analysis " +
      "(Tier 1 block form; produces markup or executes statements per arm), " +
      "or `match expr { .Variant -> ... }` for value-return case-analysis " +
      "(Tier 1 JS-style form; produces a value in expression position)? " +
      "See SPEC §18 for match block-form, primer §1 for the tier ladder.",
      span,
    ));
  }
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

/**
 * Attach `file` to a block-splitter span to produce a full Span.
 * BS spans have: { start, end, line, col }.
 * Full spans add: { file }.
 */
function fullSpan(bsSpan, filePath) {
  return {
    file: filePath,
    start: bsSpan.start,
    end: bsSpan.end,
    line: bsSpan.line,
    col: bsSpan.col,
  };
}

function tokenSpan(tok, filePath) {
  return {
    file: filePath,
    start: tok.span.start,
    end: tok.span.end,
    line: tok.span.line,
    col: tok.span.col,
  };
}

// ---------------------------------------------------------------------------
// Match arm arrow helper (§18, §19)
// ---------------------------------------------------------------------------

/**
 * Returns true if `tok` is a single-token match arm arrow.
 * Accepts the canonical `:>` and the deprecated alias `=>` (§18.2, §19).
 * NOTE: the third deprecated alias `->` tokenizes as TWO PUNCT tokens
 * (`-` then `>`) and is NOT recognised by this single-token predicate —
 * use `matchArrowGlyphAt` when `->` must also be detected.
 */
function isMatchArrow(tok) {
  return tok != null && tok.kind === "OPERATOR" && (tok.text === "=>" || tok.text === ":>");
}

/**
 * Detect a match / `!{}`-handler arm-separator arrow at peek-offset `k` and
 * report which glyph it is plus how many tokens it spans. Handles all three
 * §18.2 arm separators:
 *   - `:>` (canonical)  — single OPERATOR token   → { glyph: ":>", len: 1 }
 *   - `=>` (deprecated) — single OPERATOR token   → { glyph: "=>", len: 1 }
 *   - `->` (deprecated) — two PUNCT tokens (`-`,`>`) → { glyph: "->", len: 2 }
 * Returns null when no arm arrow begins at `k`. `peek` is the offset-relative
 * lookahead closure from the surrounding parser body.
 *
 * `->` deliberately stays a two-token sequence at the lexer level — it is also
 * the `fn ... -> ReturnType` separator (parsed as two tokens at the fn-decl
 * sites) and merging it into a single OPERATOR would fracture that path.
 */
function matchArrowGlyphAt(peek, k = 0) {
  const t = peek(k);
  if (t != null && t.kind === "OPERATOR" && (t.text === "=>" || t.text === ":>")) {
    return { glyph: t.text, len: 1 };
  }
  if (t != null && t.kind === "PUNCT" && t.text === "-") {
    const t2 = peek(k + 1);
    if (t2 != null && t2.kind === "PUNCT" && t2.text === ">") {
      return { glyph: "->", len: 2 };
    }
  }
  return null;
}

/**
 * Scan a `derived=match @VAR { ... }` engine-attribute match BODY (the raw text
 * between the outer `{` and `}` — `engine-decl.inlineMatchBody`) for its
 * arm-separator arrow glyphs. Returns one entry per ARM, in source order:
 *   { glyph: ":>" | "=>" | "->", srcOffset: <absolute source index of the glyph> }
 *
 * S171 — the §51.0.J derived-engine `derived=match` match arms join the §18.2
 * `:>` arm-separator deprecation: `=>` / `->` are deprecated aliases of the
 * canonical `:>` (all three lower identically through `rewriteExpr`, byte-
 * identical JS). This scanner is the arm-context-scoped locator the
 * W-MATCH-ARROW-LEGACY lint (type-system.ts) + `bun scrml migrate --fix`
 * (commands/migrate.js) both consume — the body is captured as RAW TEXT (no
 * structured arm nodes, unlike block-form / value-return match), so the
 * `armArrow`-field path the other loci use is unavailable here.
 *
 * ARM-CONTEXT-SCOPED: an arm separator is the FIRST arrow glyph at
 * bracket-depth 0 (outside any `()`/`{}`/`[]`) following each arm-pattern
 * start (`.Variant`, `_`, `else`, `not`, or a `|`-continued multi-pattern).
 * After recording an arm's separator we skip its body region (everything up to
 * the next depth-0 arm-pattern start), so a body-internal `=>` arrow-function
 * or `->` is NEVER mis-recorded. The §51.0.J value-return shape is the typical
 * input (`.Small => .Healthy`), but the depth/skip discipline tolerates block
 * (`{ ... }`) and payload (`.V(x) => ...`) arm bodies too.
 *
 * `bodyAbsStart` is the absolute source offset of the FIRST char of `bodyText`
 * (so the returned `srcOffset` values index the original source directly).
 * Uses the module-level `tokenizeLogic` (the live tokenizer) with that base so
 * arrow tokens carry absolute spans; an `->` is a `-` PUNCT + `>` PUNCT pair,
 * matching `matchArrowGlyphAt`.
 *
 * Returns [] on any tokenizer trouble (fail-safe: never invent a position).
 */
function scanInlineMatchArmArrows(bodyText, bodyAbsStart) {
  if (typeof bodyText !== "string" || bodyText.length === 0) return [];
  let tokens;
  try {
    tokens = tokenizeLogic(bodyText, bodyAbsStart, 1, 1, []);
  } catch {
    return [];
  }
  if (!Array.isArray(tokens) || tokens.length === 0) return [];

  // Token-relative peek + glyph reader (mirrors matchArrowGlyphAt's pair logic).
  const at = (k) => tokens[k];
  const glyphAt = (k) => {
    const t = at(k);
    if (t && t.kind === "OPERATOR" && (t.text === "=>" || t.text === ":>")) {
      return { glyph: t.text, len: 1, startTok: t };
    }
    if (t && t.kind === "PUNCT" && t.text === "-") {
      const t2 = at(k + 1);
      if (t2 && t2.kind === "PUNCT" && t2.text === ">") {
        return { glyph: "->", len: 2, startTok: t };
      }
    }
    return null;
  };
  // The absolute source offset of a token's first char. The tokenizer stamps
  // `start` (absolute, with the supplied base) on each token; fall back to
  // `span.start` for tokenizer-override shapes.
  const tokStart = (t) => {
    if (t == null) return -1;
    if (typeof t.start === "number") return t.start;
    if (t.span && typeof t.span.start === "number") return t.span.start;
    return -1;
  };

  const isPatternStart = (k) => {
    const t = at(k);
    if (!t) return false;
    // `.Variant` enum-pattern, `else` / `not` wildcard/absence, or `_` discard.
    if (t.kind === "PUNCT" && t.text === ".") {
      const n = at(k + 1);
      return !!(n && n.kind === "IDENT" && /^[A-Z]/.test(n.text));
    }
    if (t.kind === "KEYWORD" && (t.text === "else" || t.text === "not")) return true;
    if (t.kind === "IDENT" && t.text === "_") return true;
    return false;
  };

  const out = [];
  let depth = 0;
  let i = 0;
  // Walk to the first depth-0 arm-pattern start, then for each arm: record the
  // first depth-0 arrow as its separator and advance to the next pattern start.
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "PUNCT" && (t.text === "(" || t.text === "{" || t.text === "[")) { depth++; i++; continue; }
    if (t.kind === "PUNCT" && (t.text === ")" || t.text === "}" || t.text === "]")) { if (depth > 0) depth--; i++; continue; }
    if (depth !== 0) { i++; continue; }
    if (isPatternStart(i)) {
      // Scan forward (staying at depth 0) for the first arm-separator arrow.
      let j = i;
      let d = 0;
      let recorded = false;
      while (j < tokens.length) {
        const tj = tokens[j];
        if (tj.kind === "PUNCT" && (tj.text === "(" || tj.text === "{" || tj.text === "[")) { d++; j++; continue; }
        if (tj.kind === "PUNCT" && (tj.text === ")" || tj.text === "}" || tj.text === "]")) { if (d > 0) d--; j++; continue; }
        if (d === 0) {
          const g = glyphAt(j);
          if (g) {
            const off = tokStart(g.startTok);
            if (off >= 0) out.push({ glyph: g.glyph, srcOffset: off });
            recorded = true;
            j += g.len; // step past the arrow into the body region
            break;
          }
          // A new pattern start at depth 0 before any arrow → malformed arm;
          // bail to that pattern (the outer loop re-enters there).
          if (j > i && isPatternStart(j)) break;
        }
        j++;
      }
      // Advance past the arm body to the NEXT depth-0 pattern start (so the
      // body's own arrows are never re-scanned as separators).
      let k = j;
      let bd = 0;
      while (k < tokens.length) {
        const tk = tokens[k];
        if (tk.kind === "PUNCT" && (tk.text === "(" || tk.text === "{" || tk.text === "[")) { bd++; k++; continue; }
        if (tk.kind === "PUNCT" && (tk.text === ")" || tk.text === "}" || tk.text === "]")) { if (bd > 0) bd--; k++; continue; }
        if (bd === 0 && isPatternStart(k)) break;
        k++;
      }
      i = recorded ? Math.max(k, i + 1) : i + 1;
      continue;
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Known boolean HTML attributes (E-ATTR-002 set)
// ---------------------------------------------------------------------------

const BOOLEAN_ATTRS = new Set([
  "disabled",
  "checked",
  "readonly",
  "required",
  "selected",
  "multiple",
  "open",
  "hidden",
]);

// ---------------------------------------------------------------------------
// Supported bind: directive names (§5.4)
// ---------------------------------------------------------------------------

const BIND_DIRECTIVES = new Set([
  "bind:value",
  "bind:checked",
  "bind:selected",
  "bind:group",
  "bind:files",
]);

// ---------------------------------------------------------------------------
// HTML void elements (no closer required by HTML semantics)
// ---------------------------------------------------------------------------
// scrml accepts the natural HTML form for these tags — `<br>`, `<input>`,
// `<img src="…">` — without a `/>` self-close or `</tag>` closer. The angle-
// tracker in collectExpr / collectLiftExpr (A3 fix, commit bcd4557) uses
// element-nesting semantics where every `<TAG` increments depth and is
// expected to be matched by `</TAG` or `/>`. Void elements have NO closer
// in idiomatic scrml, so they would leak depth permanently. This Set lets
// the angle-tracker skip the increment for known void tags.
//
// A7 fix (fix-component-def-block-ref-interpolation-in-body): without this
// Set, `<div><input bind:value=@x></div>` left angleDepth at 1 after the
// closing `</div>`, defeating the IDENT-`=` boundary guard at the next
// sibling `const Foo = …` and silently swallowing all subsequent component
// declarations into one greedy raw expression. Same root cause as A8
// (`<select><option>…<input bind:value=@x>` shape).
//
// Standard HTML5 void elements + SVG primitive shapes registered in
// compiler/src/html-elements.js with isVoid: true. Lower-cased; lookup
// must lower-case the tag name.
const HTML_VOID_ELEMENTS = new Set([
  // HTML5 void elements (W3C HTML Living Standard)
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
  // SVG primitive shapes — leaf elements with no children (registry: html-elements.js)
  "rect", "circle", "line", "path", "polyline", "polygon",
]);

// ---------------------------------------------------------------------------
// Block context → user-readable label
// ---------------------------------------------------------------------------

/**
 * Convert an internal blockContext string to the user-facing label used in
 * diagnostic messages.  This keeps internal identifier names out of error
 * text.
 *
 * @param {string} ctx  — internal context string ('meta', 'sql', 'css', etc.)
 * @returns {string}    — human-readable label including the delimiter syntax
 */
function contextLabel(ctx) {
  switch (ctx) {
    case "meta":    return "`^{ }` meta";
    case "sql":     return "`?{ }` SQL";
    case "css":     return "`#{ }` CSS";
    case "error":   return "`!{ }` error";
    case "state":   return "state";
    case "markup":  return "markup";
    default:        return `\`${ctx}\``;
  }
}

// ---------------------------------------------------------------------------
// Attribute parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the attribute token stream produced by tokenizeAttributes() into
 * AttrNode[].
 *
 * AttrNode = { name: string, value: AttrValue, span: Span }
 * AttrValue =
 *   | { kind: 'string-literal', value: string }
 *   | { kind: 'variable-ref',   name: string }
 *   | { kind: 'call-ref',       name: string, args: string[] }
 *   | { kind: 'expr',           raw: string, refs: string[] }
 *   | { kind: 'absent' }
 *
 * @param {import('./tokenizer.ts').Token[]} tokens
 * @param {string} filePath
 * @param {TABError[]} errors
 * @param {boolean} [isComponent=false]  — true when parsing attrs for a component call site.
 *   Unrecognized bind: names skip E-ATTR-011 when true (§15.11.1 — CE validates component
 *   bind: props against the propsDecl and emits E-COMPONENT-013 if prop is not bindable).
 * @returns {AttrNode[]}
 */
function parseAttributes(tokens, filePath, errors, isComponent = false) {
  const attrs = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.kind === "ATTR_NAME") {
      const nameSpan = tokenSpan(tok, filePath);
      const name = tok.text;
      i++;

      // Check for ATTR_EQ
      if (i < tokens.length && tokens[i].kind === "ATTR_EQ") {
        i++; // consume `=`

        if (i < tokens.length) {
          const valTok = tokens[i];
          i++;

          let value;
          const valSpan = tokenSpan(valTok, filePath);
          if (valTok.kind === "ATTR_STRING") {
            value = { kind: "string-literal", value: valTok.text, span: valSpan };
            // E-ATTR-002: boolean attribute with a quoted string value
            if (BOOLEAN_ATTRS.has(name)) {
              errors.push(new TABError(
                "E-ATTR-002",
                `E-ATTR-002: Attribute \`${name}\` is a boolean attribute but was given a quoted string value \`"${valTok.text}"\`. ` +
                `Use an unquoted boolean expression instead — for example \`${name}=myBoolVar\` or omit the value entirely for \`${name}\` (presence = true).`,
                valSpan,
              ));
            }
          } else if (valTok.kind === "ATTR_CALL") {
            // text is JSON.stringify({ name, args })
            let parsed;
            try { parsed = JSON.parse(valTok.text); } catch { parsed = { name: valTok.text, args: "" }; }
            const rawArgs = parsed.args || "";
            // Split args on commas, handling nested parens
            const argList = rawArgs.trim().length === 0
              ? []
              : splitArgs(rawArgs);
            const _argExprNodes = argList.map(a => safeParseExprToNodeGlobal(a, filePath, valSpan?.start ?? 0, errors)).filter(Boolean);
            value = { kind: "call-ref", name: parsed.name, args: argList, argExprNodes: _argExprNodes.length === argList.length ? _argExprNodes : undefined, span: valSpan };
          } else if (valTok.kind === "ATTR_IDENT") {
            value = { kind: "variable-ref", name: valTok.text, exprNode: safeParseExprToNodeGlobal(valTok.text, filePath, valSpan?.start ?? 0, errors), span: valSpan };
          } else if (valTok.kind === "ATTR_BLOCK") {
            if (name === "props") {
              // Brace-block attribute value: `props={...}` typed props declaration (§15.10)
              const propsDecl = parsePropsBlock(valTok.text, valSpan, errors);
              value = { kind: "props-block", propsDecl, span: valSpan };
            } else {
              // §14.9: Non-props brace-block — expression attribute (e.g. snippet lambda,
              // event handler). Parse as expr, same as ATTR_EXPR.
              const raw = valTok.text;
              const refs = [];
              const refRe = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
              let m;
              while ((m = refRe.exec(raw)) !== null) {
                if (!refs.includes(m[1])) refs.push(m[1]);
              }
              // §17 + §34 E-SWITCH-FORBIDDEN: scan the raw block text for the
              // `switch` keyword. acorn rejects `switch` as not-an-expression,
              // returns escape-hatch silently — no switch-stmt AST node lands,
              // so collectForbiddenSwitches has nothing to walk. Detect here.
              // Token text is the inner of `{...}` (delimiter `{` skipped),
              // so baseOffset = valSpan.start + 1.
              emitForbiddenSwitchInRaw(raw, valSpan, (valSpan?.start ?? 0) + 1, filePath, errors);
              value = { kind: "expr", raw, refs, exprNode: safeParseExprToNodeGlobal(raw, filePath, valSpan?.start ?? 0, errors), span: valSpan };
            }
          } else if (valTok.kind === "ATTR_EXPR") {
            // Boolean expression for if= attribute (e.g. !@var, @a === 1, @a && @b quoted).
            // Extract all @varname references for reactive subscription.
            const raw = valTok.text;
            const refs = [];
            const refRe = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
            let m;
            while ((m = refRe.exec(raw)) !== null) {
              if (!refs.includes(m[1])) refs.push(m[1]);
            }
            // §17 + §34 E-SWITCH-FORBIDDEN: scan attribute expression text for
            // the `switch` keyword (the S99-A7 FOLLOW-UP gap — see findForbiddenSwitchInRaw
            // docblock). ATTR_EXPR text may come from any of `${...}` / `(...)` /
            // `!...` / `"..."` / unquoted — the leading-delimiter count varies, but
            // for dedup and uniqueness purposes valSpan.start is a safe base
            // (every distinct `switch` keyword in the source has a unique
            // relative index within the token text and the token spans don't
            // overlap across attributes).
            emitForbiddenSwitchInRaw(raw, valSpan, valSpan?.start ?? 0, filePath, errors);
            value = { kind: "expr", raw, refs, exprNode: safeParseExprToNodeGlobal(raw, filePath, valSpan?.start ?? 0, errors), span: valSpan };
          } else {
            // E-ATTR-001: unexpected token type as attribute value
            errors.push(new TABError(
              "E-ATTR-001",
              `E-ATTR-001: The value \`${valTok.text}\` is not valid for attribute \`${name}\`. ` +
              `Attribute values must be a quoted string literal, an unquoted identifier, or a call expression. ` +
              `For example: \`${name}="hello"\`, \`${name}=myVar\`, or \`${name}=\${expression}\`.`,
              valSpan,
            ));
            value = { kind: "absent" };
          }

          // Span covers name through end of value
          const attrSpan = {
            file: filePath,
            start: nameSpan.start,
            end: tokenSpan(valTok, filePath).end,
            line: nameSpan.line,
            col: nameSpan.col,
          };

          // §5.4: bind: directive validation
          // §15.11.1: on component call sites (isComponent=true), defer E-ATTR-011 for
          // unrecognized bind: names — CE validates against propsDecl (E-COMPONENT-013).
          if (name.startsWith("bind:")) {
            if (!BIND_DIRECTIVES.has(name) && !isComponent) {
              errors.push(new TABError(
                "E-ATTR-011",
                `E-ATTR-011: \`${name}\` is not a supported bind directive. ` +
                `Supported: \`bind:value\`, \`bind:checked\`, \`bind:selected\`, \`bind:group\`, \`bind:this\`. ` +
                `If you intended a regular attribute, remove the \`bind:\` prefix.`,
                attrSpan,
              ));
            }
            // bind: target must be an @-prefixed reactive variable or a dotted state path
            if (value.kind === "variable-ref") {
              if (!value.name.startsWith("@") && !value.name.includes(".")) {
                errors.push(new TABError(
                  "E-ATTR-010",
                  `E-ATTR-010: \`${name}\` requires a reactive \`@\` variable or state field path. ` +
                  `\`${value.name}\` is not reactive. ` +
                  `Use \`@${value.name}\` or a state field path like \`stateObj.field\`.`,
                  attrSpan,
                ));
              }
            } else if (value.kind === "string-literal") {
              errors.push(new TABError(
                "E-ATTR-010",
                `E-ATTR-010: \`${name}\` requires a reactive \`@\` variable. ` +
                `Got a string literal \`"${value.value}"\` instead. ` +
                `Use an \`@\`-prefixed reactive variable, e.g. \`${name}=@myVar\`.`,
                attrSpan,
              ));
            }
          }

          // §5.5.2: class: directive validation — E-ATTR-013
          // The right-hand side of class:name= accepts:
          //   @variable    — reactive variable (class:active=@isActive)
          //   obj.prop     — property access (class:done=todo.completed); root key subscribed
          //   (expr)       — parenthesized boolean expression (ATTR_EXPR → expr kind)
          //   fn()         — function call (ATTR_CALL → call-ref kind)
          // Rejects: bare identifiers (no @, no dot), string literals, absent.
          if (name.startsWith("class:")) {
            if (value.kind === "variable-ref") {
              const _isReactive = value.name.startsWith("@");
              const _isDotPath  = !_isReactive && value.name.includes(".");
              if (!_isReactive && !_isDotPath) {
                errors.push(new TABError(
                  "E-ATTR-013",
                  `E-ATTR-013: \`${name}\` requires a boolean expression. ` +
                  `\`${value.name}\` is a bare identifier — did you mean \`@${value.name}\`? ` +
                  `Valid forms: \`${name}=@myVar\`, \`${name}=obj.prop\`, \`${name}=(expr)\`, \`${name}=fn()\`.`,
                  attrSpan,
                ));
              }
              // @variable and obj.prop forms pass through — wired in emit-bindings.ts
            } else if (value.kind === "string-literal") {
              errors.push(new TABError(
                "E-ATTR-013",
                `E-ATTR-013: \`${name}\` requires a boolean expression, not a string literal. ` +
                `Got \`"${value.value}"\`. ` +
                `Valid forms: \`${name}=@myVar\`, \`${name}=obj.prop\`, \`${name}=(expr)\`, \`${name}=fn()\`.`,
                attrSpan,
              ));
            } else if (value.kind === "absent") {
              errors.push(new TABError(
                "E-ATTR-013",
                `E-ATTR-013: \`${name}\` requires a boolean expression. ` +
                `No value was provided. Valid forms: \`${name}=@myVar\`, \`${name}=obj.prop\`, \`${name}=(expr)\`, \`${name}=fn()\`.`,
                attrSpan,
              ));
            }
            // call-ref (fn()) and expr ((a === b)) pass through without error — wired in emit-bindings.ts
          }

          attrs.push({ name, value, span: attrSpan });
        }
      } else {
        // Boolean attribute — no value
        // §5.5.2: class: directives without a value are also E-ATTR-013 (absent RHS)
        if (name.startsWith("class:")) {
          errors.push(new TABError(
            "E-ATTR-013",
            `E-ATTR-013: \`${name}\` requires a reactive \`@\` variable. ` +
            `No value was provided. Use \`${name}=@myVar\`.`,
            nameSpan,
          ));
        }
        attrs.push({ name, value: { kind: "absent" }, span: nameSpan });
      }
      continue;
    }

    // Skip TAG_OPEN, TAG_CLOSE_GT, TAG_SELF_CLOSE, EOF
    i++;
  }

  return attrs;
}

/**
 * Parse typed attribute declarations from tokenized state block attributes.
 *
 * Typed declarations use ATTR_TYPED_DECL tokens (produced by the tokenizer
 * for `name(type)` patterns in state blocks). Returns both standard attrs
 * and a separate typedAttrs array.
 *
 * @param {import('./tokenizer.ts').Token[]} tokens
 * @param {string} filePath
 * @param {TABError[]} errors
 * @returns {{ attrs: AttrNode[], typedAttrs: TypedAttrDecl[], hasTypedDecls: boolean }}
 *
 * TypedAttrDecl = {
 *   name: string,
 *   typeExpr: string,    — raw type expression (e.g. "string", "number", "enum { A, B }")
 *   optional: boolean,   — true if type ends with ?
 *   defaultValue: string|null, — default value if `= value` present in type expr
 *   span: Span
 * }
 */
/**
 * §54.3 Phase 4b — parse the trailing transition-decl signature from a text
 * block's content. Returns null if the text does not end with a signature.
 *
 * Signature shape: `IDENT ( PARAMS ) => < TARGET >` optionally followed by
 * whitespace. The companion block-splitter recognizer (Phase 4a) only emits
 * the text+logic sibling pair when this pattern is present, but we re-verify
 * here so the AST collapse is self-contained.
 *
 * Returns: { name, paramsRaw, target, sigStart } where sigStart is the index
 * in `text` where the signature begins (useful for preserving leading
 * residual content).
 */
function parseTrailingTransitionSignature(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let i = text.length - 1;
  // Skip trailing whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  // Expect '>'
  if (i < 0 || text[i] !== ">") return null;
  i--;
  // Optional whitespace inside the tag (rare, e.g., `< Target >`)
  while (i >= 0 && /\s/.test(text[i])) i--;
  // Target identifier
  const targetEnd = i + 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i])) i--;
  const targetStart = i + 1;
  if (targetStart === targetEnd) return null;
  const target = text.slice(targetStart, targetEnd);
  if (!/^[A-Za-z_]/.test(target)) return null;
  // Required whitespace (the `< ` space per §4.3 / §54.3)
  if (i < 0 || !/\s/.test(text[i])) return null;
  while (i >= 0 && /\s/.test(text[i])) i--;
  // '<'
  if (i < 0 || text[i] !== "<") return null;
  i--;
  // Whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  // '=>'
  if (i < 1 || text[i] !== ">" || text[i - 1] !== "=") return null;
  i -= 2;
  // Whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  // ')' closing params
  if (i < 0 || text[i] !== ")") return null;
  // Balance-match back through parens
  const paramsEnd = i; // exclusive end of params
  let depth = 1;
  i--;
  while (i >= 0 && depth > 0) {
    const c = text[i];
    if (c === ")") depth++;
    else if (c === "(") depth--;
    if (depth === 0) break;
    i--;
  }
  if (depth !== 0) return null;
  // i is now at the '('
  const paramsStart = i + 1;
  const paramsRaw = text.slice(paramsStart, paramsEnd);
  i--;
  // Optional whitespace between name and '('
  while (i >= 0 && /\s/.test(text[i])) i--;
  // Transition name (identifier)
  const nameEnd = i + 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i])) i--;
  const nameStart = i + 1;
  if (nameStart === nameEnd) return null;
  const name = text.slice(nameStart, nameEnd);
  if (!/^[A-Za-z_]/.test(name)) return null;
  return { name, paramsRaw, target, sigStart: nameStart };
}

/**
 * §54.3 Phase 4b — walk a state-constructor's AST children and collapse each
 * (text-ending-in-signature, logic) sibling pair into a single transition-decl
 * node. Children not matching the pattern are passed through untouched.
 *
 * The block-splitter Phase 4a contract guarantees that when a transition-decl
 * is present, the text block immediately precedes the logic body and carries
 * the signature text verbatim (including any leading residual content).
 *
 * Leading residual text BEFORE the signature is preserved as its own text
 * node so surrounding whitespace / comments / other content are not dropped.
 */
function collapseTransitionDecls(children, filePath, counter, parentStateName) {
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const cur = children[i];
    const next = children[i + 1];
    if (cur && cur.kind === "text" && next && next.kind === "logic") {
      const sig = parseTrailingTransitionSignature(cur.value);
      if (sig) {
        // Preserve any leading residual text before the signature
        const residual = cur.value.slice(0, sig.sigStart);
        if (residual.length > 0) {
          out.push({
            id: ++counter.next,
            kind: "text",
            value: residual,
            span: cur.span,
          });
        }
        // Build the transition-decl node. Span covers signature start → body end.
        const tdSpan = {
          file: filePath,
          start: (cur.span && typeof cur.span.start === "number")
            ? cur.span.start + sig.sigStart
            : (next.span ? next.span.start : 0),
          end: (next.span && typeof next.span.end === "number")
            ? next.span.end
            : (cur.span ? cur.span.end : 0),
          line: cur.span ? cur.span.line : (next.span ? next.span.line : 1),
          col: cur.span ? cur.span.col : (next.span ? next.span.col : 1),
        };
        out.push({
          id: ++counter.next,
          kind: "transition-decl",
          name: sig.name,
          paramsRaw: sig.paramsRaw,
          targetSubstate: sig.target,
          // §54.3 Phase 4d: the declaring state is the `from` binding type for
          // expressions inside the body. Null at top-level states (no parent).
          fromSubstate: parentStateName ?? null,
          body: Array.isArray(next.body) ? next.body : [],
          span: tdSpan,
        });
        i++; // consume the logic sibling
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

function parseTypedAttributes(tokens, filePath, errors) {
  const attrs = [];
  const typedAttrs = [];
  let hasTypedDecls = false;
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.kind === "ATTR_TYPED_DECL") {
      hasTypedDecls = true;
      let parsed;
      try { parsed = JSON.parse(tok.text); } catch { parsed = { name: "?", typeExpr: "" }; }

      const { name, typeExpr: rawTypeExpr } = parsed;
      const span = tokenSpan(tok, filePath);

      // Check for default value: `type = defaultValue`
      let typeExpr = rawTypeExpr.trim();
      let defaultValue = null;
      const eqIdx = typeExpr.indexOf("=");
      if (eqIdx !== -1) {
        defaultValue = typeExpr.slice(eqIdx + 1).trim();
        typeExpr = typeExpr.slice(0, eqIdx).trim();
      }

      // Check for optional marker: `type?`
      let optional = false;
      if (typeExpr.endsWith("?")) {
        optional = true;
        typeExpr = typeExpr.slice(0, -1).trim();
      }

      // Default value implies optional
      if (defaultValue !== null) {
        optional = true;
      }

      typedAttrs.push({ name, typeExpr, optional, defaultValue, span });
      i++;
      continue;
    }

    if (tok.kind === "ATTR_NAME") {
      const nameSpan = tokenSpan(tok, filePath);
      const name = tok.text;
      i++;

      // Check for ATTR_EQ
      if (i < tokens.length && tokens[i].kind === "ATTR_EQ") {
        i++; // consume `=`

        if (i < tokens.length) {
          const valTok = tokens[i];
          i++;

          let value;
          const valSpan = tokenSpan(valTok, filePath);
          if (valTok.kind === "ATTR_STRING") {
            value = { kind: "string-literal", value: valTok.text, span: valSpan };
          } else if (valTok.kind === "ATTR_IDENT") {
            value = { kind: "variable-ref", name: valTok.text, exprNode: safeParseExprToNodeGlobal(valTok.text, filePath, valSpan?.start ?? 0), span: valSpan };
          } else {
            value = { kind: "absent" };
          }

          const attrSpan = {
            file: filePath,
            start: nameSpan.start,
            end: tokenSpan(valTok, filePath).end,
            line: nameSpan.line,
            col: nameSpan.col,
          };
          attrs.push({ name, value, span: attrSpan });
        }
      } else {
        // Boolean attribute — no value
        attrs.push({ name, value: { kind: "absent" }, span: nameSpan });
      }
      continue;
    }

    // Skip TAG_OPEN, TAG_CLOSE_GT, TAG_SELF_CLOSE, EOF
    i++;
  }

  return { attrs, typedAttrs, hasTypedDecls };
}

/**
 * Split a comma-separated argument string, respecting parentheses nesting.
 * @param {string} raw
 * @returns {string[]}
 */
function splitArgs(raw) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of raw) {
    if (ch === "(" || ch === "[" || ch === "{") { depth++; cur += ch; }
    else if (ch === ")" || ch === "]" || ch === "}") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) parts.push(cur.trim());
  return parts;
}

/**
 * v0.2.4 bug-1-a1: join token texts while preserving token-boundary whitespace
 * for fusion-risky adjacencies.
 *
 * Used by `_parseLiftAttrValue` (lift-tag attribute-value collector). The
 * tokenizer/parser pair strips inter-token whitespace by the time tokens reach
 * the lift attr collector — joining with `""` then loses the source-level
 * boundary between e.g. `not` (KEYWORD) and `t` (IDENT), producing the bogus
 * identifier `nott` and downstream codegen `nott.completed` in event-handler
 * attribute values (`onchange=toggle(t.id, not t.completed)`).
 *
 * Rule: insert a single space between two parts when the LAST char of the
 * prior part AND the FIRST char of the next part are both word-shaped
 * (`[A-Za-z0-9_$@]`). All other adjacencies (e.g. IDENT-`.`, `.`-IDENT,
 * `(`-IDENT, etc.) join with no space — preserving member access (`t.id`)
 * and call syntax (`fn(arg)`) verbatim.
 *
 * The downstream expression parser (preprocessForAcorn + acorn) is whitespace-
 * insensitive within member access (`t . id` parses identically to `t.id`),
 * so adding a single space inside expressions is safe.
 *
 * @param {string[]} parts — token texts as collected by `_parseLiftAttrValue`
 * @returns {string}
 */
function _joinPreservingWordBoundary(parts) {
  if (parts.length === 0) return "";
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const prevEnd = out.charAt(out.length - 1);
    const nextStart = parts[i].charAt(0);
    if (/[A-Za-z0-9_$@]/.test(prevEnd) && /[A-Za-z0-9_$@]/.test(nextStart)) {
      out += " ";
    }
    out += parts[i];
  }
  return out;
}

/**
 * Split a string on commas at top-level depth (not inside braces/parens/brackets).
 *
 * @param {string} raw
 * @returns {string[]}
 */
function splitAtTopLevelCommas(raw) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "{" || ch === "(" || ch === "[") { depth++; current += ch; }
    else if (ch === "}" || ch === ")" || ch === "]") { depth--; current += ch; }
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Parse a props declaration block content string into a structured array.
 *
 * Input: raw content between the braces of `props={...}`, e.g.:
 *   "name: string, size?: string, role: UserRole, count: number = 0"
 *
 * Grammar:
 *   prop-decl ::= identifier ('?')? ':' type-expr ('=' literal)?
 *
 * Returns:
 *   Array<{ name: string, type: string, optional: boolean, default: string|null }>
 *
 * @param {string} raw    — content between the braces (braces not included)
 * @param {object} span   — span for error reporting
 * @param {TABError[]} errors
 * @returns {Array}
 */
function parsePropsBlock(raw, span, errors) {
  const props = [];
  const parts = splitAtTopLevelCommas(raw);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // §15.11.1: detect bindable prop declaration: "bind name: type"
    let bindable = false;
    let propText = trimmed;
    if (propText.startsWith("bind ")) {
      bindable = true;
      propText = propText.slice(5).trim(); // strip "bind " prefix
    }

    // Match: identifier, optional '?', ':', type, optional '= default'
    const match = propText.match(/^([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*(.+)$/);
    if (!match) {
      errors.push(new TABError(
        "E-COMPONENT-019",
        `E-COMPONENT-019: Invalid prop declaration \`${trimmed}\` in props block. ` +
        `Expected format: \`name: type\`, \`name?: type\`, \`name: type = default\`, ` +
        `\`bind name: type\` (bindable prop), or \`name: fn-signature\` (function prop).`,
        span,
      ));
      continue;
    }

    const name = match[1];
    const optional = match[2] === "?";
    let typeAndDefault = match[3].trim();

    // Split off default value: find '=' not followed by '=' or '>'
    let defaultValue = null;
    const eqMatch = typeAndDefault.match(/^(.+?)\s*=(?!=|>)\s*(.+)$/);
    if (eqMatch) {
      typeAndDefault = eqMatch[1].trim();
      defaultValue = eqMatch[2].trim();
    }

    // §15.11.4: detect function-typed prop — type contains "=>" or starts with "("
    const isFunctionProp = typeAndDefault.includes("=>") || typeAndDefault.trim().startsWith("(");

    props.push({
      name,
      type: typeAndDefault,
      optional: optional || defaultValue !== null,
      default: defaultValue,
      bindable,            // §15.11.1: true when declared as "bind name: type"
      isFunctionProp,      // §15.11.4: true when type is a function signature
      isSnippet: false,              // §14.9: set by CE post-processing
      snippetParamType: null,        // §14.9: set by CE post-processing
    });
  }

  return props;
}

// ---------------------------------------------------------------------------
// Logic block parser
// ---------------------------------------------------------------------------

/**
 * Parse the token stream of a logic or meta block body into LogicNode[].
 *
 * This is a best-effort structural parser. The TAB stage is NOT a full JS
 * parser — it recognises scrml-specific constructs (lift, fn, @,
 * function declarations, reactive decls, imports, exports, type decls,
 * const component defs) and wraps everything else as BareExpr nodes.
 *
 * The parser is intentionally conservative: when it sees a construct it can
 * classify, it produces the appropriate node kind. When it cannot classify,
 * it accumulates tokens until a natural boundary (`;`, a keyword at statement
 * start, or EOF) and emits a BareExpr.
 *
 * @param {import('./tokenizer.ts').Token[]} tokens
 * @param {string} filePath
 * @param {object[]} childBlocks  — child blocks of the parent logic block
 * @param {object}   parentBlock  — the enclosing BS block (for child lookup)
 * @param {{ next: number }} counter  — node ID counter shared with buildBlock
 * @param {TABError[]} errors
 * @param {string} blockContext   — 'logic' or 'meta'
 * @returns {LogicNode[]}
 */
export function parseLogicBody(tokens, filePath, childBlocks, parentBlock, counter, errors, blockContext) {
  const nodes = [];
  let i = 0;

  function peek(n = 0) {
    return i + n < tokens.length ? tokens[i + n] : { kind: "EOF", text: "", span: { start: 0, end: 0, line: 1, col: 1 } };
  }

  function consume() {
    return i < tokens.length ? tokens[i++] : peek();
  }

  function spanOf(startTok, endTok) {
    return {
      file: filePath,
      start: startTok.span.start,
      end: endTok.span.end,
      line: startTok.span.line,
      col: startTok.span.col,
    };
  }

  /**
   * Phase 1: safely parse an expression string to ExprNode.
   * Never throws — returns undefined on failure.
   * Used to populate parallel ExprNode fields alongside existing string fields.
   */
  function safeParseExprToNode(expr, startOffset) {
    if (!expr || typeof expr !== "string" || !expr.trim()) return undefined;
    // Phase 4d: when shouldSkipExprParse is true, produce an escape-hatch node
    // so ExprNode fields are always populated when a string expression exists.
    if (shouldSkipExprParse(expr)) {
      return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, nativeKind: "SkippedExpr", raw: expr };
    }
    try {
      // Automatically thread tilde context from the closure-scoped flag
      const node = parseExprToNode(expr, filePath, startOffset ?? 0, _tildeActive ? { tildeActive: true } : undefined);
      // F-SQL-001: surface E-SQL-008 from unbalanced ?{} as a TABError.
      if (node && node.kind === "escape-hatch" && node.nativeKind === "SqlPlaceholderError" && node.sqlDiagnostic) {
        errors.push(new TABError(
          node.sqlDiagnostic.code || "E-SQL-008",
          node.sqlDiagnostic.message,
          node.span,
        ));
      }
      // §6.8.2 (Step 9, Phase A1a) — surface E-RESET-NO-ARG from malformed
      // reset(...) calls. Walks the full ExprNode tree (a malformed reset
      // can appear nested inside any larger expression).
      if (node) {
        forEachResetExprInExprNode(node, (resetNode) => {
          if (resetNode.diagnostic) {
            errors.push(new TABError(
              resetNode.diagnostic.code || "E-RESET-NO-ARG",
              resetNode.diagnostic.message,
              resetNode.span,
            ));
          }
        });
        // §59.3 (Units 4+5) — surface map-literal parse-time diagnostics
        // (E-MAP-LITERAL-MALFORMED fatal; W-MAP-* info → result.warnings).
        forEachMapLitExprInExprNode(node, (mapNode) => {
          for (const d of mapNode.diagnostics ?? []) {
            errors.push(new TABError(d.code, d.message, mapNode.span));
          }
        });
      }
      return node;
    } catch (_e) {
      // Phase 4d: produce escape-hatch on parse failure instead of undefined
      return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, nativeKind: "ParseError", raw: expr };
    }
  }

  /**
   * cycles-prereq (S168 COW-all): collect a heterogeneous reactive path-segment
   * chain off an `@name` root, accepting BOTH `.ident` AND `[indexExpr]`
   * segments. Used by the two AT_IDENT dotted-path collectors so that a
   * bracket-index WRITE (`@arr[i] = x`, `@m["DAL"] = v`, `@obj.f[i].x = v`)
   * routes through the same `reactive-nested-assign` -> `_scrml_deep_set` COW
   * path as a dotted write, instead of falling through to a raw in-place
   * bare-expr (which could construct a live value-cycle: `@arr[0] = @arr`).
   *
   * Caller MUST have already confirmed `peek().text === "." || peek().text === "["`.
   * Consumes the full `(.ident | [idx])+` chain and leaves the cursor on the
   * first token AFTER the chain (the `=` / `(` / etc.).
   *
   * Segment representation (consumed by emit-logic `reactive-nested-assign`):
   *   - `.ident`            -> the ident string (unchanged dotted form).
   *   - `[<int>]` / `[<str>]` (bare literal) -> the literal value as a STRING
   *     segment ("0" / "DAL"). JS array-index coercion makes arr["0"] === arr[0]
   *     and object["DAL"] === object.DAL, so a literal index rides the existing
   *     string representation with no computed segment.
   *   - `[<expr>]` (non-literal) -> a COMPUTED segment `{ index: ExprNode, raw }`.
   *
   * Returns `{ segments, reconstruct }` where `reconstruct` is the faithful
   * source-text suffix (`.field[i].x` / `[0]`) for the bare-expr READ fallback
   * (a bracket access NOT followed by `=` is a read, not COW'd).
   */
  function collectAtPathSegments() {
    const segments = [];
    let reconstruct = "";
    while (peek().text === "." || peek().text === "[") {
      if (peek().text === ".") {
        consume(); // consume "."
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          const segTok = consume();
          segments.push(segTok.text);
          reconstruct += "." + segTok.text;
        } else {
          // Malformed dotted segment — caller reconstructs the rest verbatim.
          reconstruct += ".";
          break;
        }
      } else {
        // Bracket-index segment: scan to the matching `]`, bracket-depth aware.
        const openTok = consume(); // consume "["
        const innerParts = [];
        let bracketDepth = 1;
        while (bracketDepth > 0 && peek().kind !== "EOF") {
          const t = peek();
          if (t.kind === "PUNCT" && t.text === "[") bracketDepth++;
          if (t.kind === "PUNCT" && t.text === "]") {
            bracketDepth--;
            if (bracketDepth === 0) { consume(); break; }
          }
          innerParts.push(consume());
        }
        const innerToks = innerParts;
        const innerText = innerToks.map((t) => t.text).join(" ").trim();
        // Literal-index optimization: a SINGLE bare NUMBER or STRING token rides
        // the existing string-segment representation (no computed segment).
        if (innerToks.length === 1 && (innerToks[0].kind === "NUMBER" || innerToks[0].kind === "STRING")) {
          const litTok = innerToks[0];
          segments.push(litTok.text);
          // Faithful reconstruction: STRING tokens lose their quotes during
          // tokenization, so re-quote for the READ-fallback source text.
          reconstruct += litTok.kind === "STRING"
            ? "[" + JSON.stringify(litTok.text) + "]"
            : "[" + litTok.text + "]";
        } else {
          // Non-literal index -> computed segment carrying the index ExprNode.
          const idxStart = (openTok.span && typeof openTok.span.end === "number") ? openTok.span.end : 0;
          segments.push({ index: safeParseExprToNode(innerText, idxStart), raw: innerText });
          reconstruct += "[" + innerText + "]";
        }
      }
    }
    return { segments, reconstruct };
  }

  /**
   * Collect tokens into a raw expression string up to (but not including)
   * the next statement boundary. Returns { expr: string, span }.
   *
   * Statement boundary: `;`, an unbalanced `}`, or a keyword that starts a
   * new top-level statement (lift, function, fn, const, let, import, export,
   * type, pure, server), or EOF.
   */
  /** Join token parts using newlines when tokens span different source lines, spaces otherwise. */
  function joinWithNewlines(parts, partLines) {
    if (parts.length === 0) return "";
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const sep = (partLines[i] > partLines[i - 1]) ? "\n" : " ";
      result += sep + parts[i];
    }
    return result;
  }

  function collectExpr(stopAt = null, opts = null) {
    // Phase A1a Step 11.0a — when called from inside a Variant C compound
    // body, the RHS of a child state-decl must terminate at the next
    // `<NAME>` opener (sibling decl) or `</` (compound close). Without
    // this, `collectExpr` greedily consumes sibling-decl tokens into the
    // child's init string. The `compoundBody` flag enables that boundary.
    const inCompoundBody = !!(opts && opts.compoundBody);
    const parts = [];
    const partLines = []; // parallel array: source line number for each part
    const startTok = peek();
    let lastTok = startTok;
    let depth = 0;
    let angleDepth = 0; // Track < ... > nesting for component tag expressions
    // A7 fix: when an HTML void element is opened (`<br`, `<input`, etc.),
    // the matching close is the open-tag's bare `>` (not `</tag>`, which
    // doesn't exist for void elements). pendingVoidClose flags that the next
    // `>` should decrement angleDepth. Cleared on `/>` (self-close) or after
    // it fires on `>`.
    let pendingVoidClose = false;

    const STMT_KEYWORDS = new Set(["lift", "function", "fn", "const", "let", "import", "export", "use", "type", "server", "for", "while", "do", "if", "return", "match", "partial", "switch", "try", "fail", "transaction", "throw", "continue", "break", "when", "given"]);
    const DECL_KEYWORDS = new Set(["const", "let", "type", "function", "fn"]);

    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      // Skip comments — they must not leak as JS statements (BUG-2)
      if (tok.kind === "COMMENT") { consume(); continue; }
      if (stopAt && tok.text === stopAt && depth === 0) break;
      // BLOCK_REF at depth 0 is a statement boundary — the child block
      // (sql, error-effect, meta) should be its own AST node, not part of a bare-expr.
      // Exception: when the BLOCK_REF is inside a tag body (tagNesting > 0), the
      // block is part of the enclosing component expression, not a separate statement.
      if (tok.kind === "BLOCK_REF" && depth === 0 && parts.length > 0 && (tok.block?.tagNesting ?? 0) === 0) break;
      // S89 §13.2 Sub-Phase B — `async function` / `async fn` decl-shape boundary.
      // When collectExpr sees `async` immediately followed by `function`/`fn` at
      // depth 0 (with optional `server` between), this is the start of an
      // `async function|fn` declaration — break BEFORE consuming `async` so
      // both tokens remain for the function-decl handler (which now recognizes
      // the `async function` form). Without this guard, `async` gets consumed
      // into parts at the first iteration; on the second iteration `function`
      // hits the STMT_KEYWORD boundary (with parts.length > 0) and breaks,
      // leaving `function name() {body}` for the function-decl handler but
      // losing the `async` modifier signal. The downstream effect is that
      // `export async function name() { body }` parses to a function-decl
      // with NO isAsync flag, which silences the auto-await classifier
      // (§13.2.1) for stdlib Promise<T> functions.
      if (depth === 0 && tok.kind === "KEYWORD" && tok.text === "async") {
        const _next = peek(1);
        const _nextIsFnKw = _next && _next.kind === "KEYWORD" && (_next.text === "function" || _next.text === "fn");
        const _nextIsServerFn = _next && _next.kind === "KEYWORD" && _next.text === "server" &&
          peek(2)?.kind === "KEYWORD" && (peek(2)?.text === "function" || peek(2)?.text === "fn");
        if (_nextIsFnKw || _nextIsServerFn) break;
      }
      // Statement boundary at depth 0
      if (depth === 0) {
        if (tok.kind === "PUNCT" && tok.text === ";") {
          lastTok = consume();
          break;
        }
        if (tok.kind === "PUNCT" && tok.text === "}") break;
        // S27: match-arm-pattern boundary. When collectExpr has already
        // consumed tokens (parts.length > 0) and the current token starts
        // a NEW match-arm pattern (`.IDENT …=>`, `::IDENT …=>`, `else =>`,
        // `_ =>`, `not …=>`), break so each arm parses independently.
        // Pre-S27, a single-line `match x { .A => 1 .B => 2 }` collected
        // both arms into one bare-expr; only the first arm reached the
        // exhaustiveness checker.
        // Safe as an always-on rule: `.IDENT =>` at depth 0 is unambiguous
        // match-arm syntax — scrml has no other construct with that shape.
        if (parts.length > 0) {
          const startsArmPattern = (() => {
            // Detect an arm arrow at peek-offset `k`. `=>` / `:>` are single
            // OPERATOR tokens; `->` is two adjacent PUNCT tokens (`-` `>`).
            // Delegates to the module-level `matchArrowGlyphAt` so the
            // boundary scanner and the arm-construction sites agree on what
            // counts as an arm separator (all three §18.2 glyphs).
            const armArrowAt = (k) => matchArrowGlyphAt(peek, k) != null;
            // `.IDENT =>` or `.IDENT(…)=>`  — enum-variant arm
            if ((tok.kind === "PUNCT" && tok.text === ".") || (tok.kind === "OPERATOR" && tok.text === "::")) {
              const t1 = peek(1);
              if (!t1 || t1.kind !== "IDENT" || !/^[A-Z]/.test(t1.text ?? "")) return false;
              // Walk forward past an optional payload binding `(…)`
              let i = 2;
              if (peek(i)?.text === "(") {
                let d = 1;
                i++;
                while (i < 20 && d > 0) {
                  const tk = peek(i);
                  if (!tk || tk.kind === "EOF") return false;
                  if (tk.text === "(") d++;
                  else if (tk.text === ")") d--;
                  i++;
                }
              }
              return armArrowAt(i);
            }
            // `else =>` — wildcard arm
            if (tok.kind === "KEYWORD" && tok.text === "else") {
              return armArrowAt(1);
            }
            // `_ =>` — wildcard alias
            if (tok.kind === "IDENT" && tok.text === "_") {
              return armArrowAt(1);
            }
            // `not …=>` — is-not arm (§42). Scan forward up to 6 tokens
            // for an arm arrow before hitting a block opener.
            if (tok.kind === "KEYWORD" && tok.text === "not") {
              for (let i = 1; i < 6; i++) {
                const tk = peek(i);
                if (!tk || tk.kind === "EOF") return false;
                if (armArrowAt(i)) return true;
                if (tk.kind === "PUNCT" && tk.text === "{") return false;
              }
              return false;
            }
            // `"string" =>` or `'string' =>` — string literal arm
            if (tok.kind === "STRING") {
              return armArrowAt(1);
            }
            return false;
          })();
          if (startsArmPattern) break;
        }
        // Another statement-starting keyword is a boundary (do not consume).
        // Guard: angleDepth === 0 ensures we are NOT inside a tag expression
        // (e.g. <div if=visible>). Keywords used as HTML attributes must not
        // break expression collection mid-tag.
        // Guard: last part is not "." — e.g. `node.type` should NOT break at `type`.
        // Keywords after a dot are property accesses, not statement boundaries.
        // Guard (Bug M, 2026-04-26): `function` and `fn` are dual-form. They start
        // function-decl statements, but also start function expressions. When the
        // previous part is an operator/punctuation that places us in expression-RHS
        // context (e.g. `= , : => :> ? && || ?? ! + - * / % < > <= >= == !=` or
        // an expression-opening keyword like `return throw yield await new`), the
        // upcoming `function` belongs to this expression. Without this exception,
        // `obj.x = function() {...}` truncated at `=` and emitted an orphan
        // function-decl. (Function-as-call-arg already worked because it sits inside
        // `(`...`)` and never reached depth 0 here.)
        if (parts.length > 0 && angleDepth === 0 && tok.kind === "KEYWORD" && STMT_KEYWORDS.has(tok.text) && parts[parts.length - 1]?.trim() !== ".") {
          const _lastPart = parts[parts.length - 1]?.trim() ?? "";
          // RHS context: the previous part is an operator/punctuation that
          // demands a following operand, so the upcoming token belongs to THIS
          // expression, not a new statement. (`obj.x = function() {...}` etc.)
          const _RHS_CTX = new Set([
            "=", ",", ":", "=>", ":>", "?",
            "&&", "||", "??", "!",
            "+", "-", "*", "/", "%",
            "<", ">", "<=", ">=", "==", "!=",
            "return", "throw", "yield", "await", "new",
          ]);
          const _inRhsCtx = _RHS_CTX.has(_lastPart);
          let _isExprAfterRhs = false;
          // `function`/`fn` are dual-form (decl OR expression); in RHS context
          // the upcoming `function`/`fn` opens a function EXPRESSION.
          if ((tok.text === "function" || tok.text === "fn") && _inRhsCtx) {
            _isExprAfterRhs = true;
          }
          // A STMT_KEYWORD used as an IDENTIFIER (member access `type.x`, call
          // `type(...)`, or index `type[...]`, incl. optional-chain `type?.x`)
          // is an operand, not a statement opener. When the previous part is an
          // operator demanding an operand (RHS context — e.g. a ternary `?` /
          // `:`, binary op, `=`), the keyword continues the expression. Without
          // this, `cond ? type.variants.map(...) : []` (where `type` is the
          // `type` keyword used as a variable name) breaks at the second `type`
          // — collectExpr truncated the init to `... ?`, emitting invalid JS
          // (`const x = ... ?;`). The keyword-expression openers (`if`, `match`,
          // `for`, `partial`) are NOT exempted here — they retain their
          // expression-form handling, which fires before collectExpr is entered.
          if (!_isExprAfterRhs && _inRhsCtx) {
            const _n1 = peek(1);
            const _kwAsIdentifier =
              _n1 &&
              ((_n1.kind === "PUNCT" && (_n1.text === "." || _n1.text === "(" || _n1.text === "[")) ||
               (_n1.kind === "OPERATOR" && (_n1.text === "?." || _n1.text === "?.[" || _n1.text === "?.(")));
            // Only the keywords that have NO competing expression form are
            // treated as bare identifiers; expression-opener keywords keep
            // breaking so their dedicated handlers run.
            const _EXPR_OPENER_KW = new Set(["if", "match", "for", "partial", "function", "fn", "switch", "when", "given"]);
            if (_kwAsIdentifier && !_EXPR_OPENER_KW.has(tok.text)) {
              _isExprAfterRhs = true;
            }
          }
          if (!_isExprAfterRhs) break;
        }
        // BUG-R14-002: @name = or bare name = at depth 0 starts a new statement.
        // Guards:
        //   1. angleDepth > 0 — inside a tag expression (< div class="x" />),
        //      IDENT = is an attribute, not a statement boundary.
        //   2. lastPart is a decl keyword (const, let, etc.) — e.g.
        //      `export const MAX_RETRIES = 3` should not break at `MAX_RETRIES =`.
        //   3. lastPart === "=" — collecting RHS of an assignment expression (§50: chained
        //      assignment). `a = b = c = 0` collects RHS `b = c = 0`: seeing `c =` is
        //      part of the chain, not a new statement boundary.
        //   4. lastPart === ":" — type-kind separator in `type X:enum = {...}` or
        //      type annotation `const x:number = 5`. `enum`/`struct`/primitive type
        //      names tokenize as IDENT (not KEYWORD); without this guard, collectExpr
        //      treats them as a new assignment statement and breaks mid-type-decl.
        if (parts.length > 0 && angleDepth === 0) {
          const lastPart = parts[parts.length - 1];
          if (!DECL_KEYWORDS.has(lastPart)) {
            const next1 = peek(1);
            const isAssign = next1 && next1.kind === "PUNCT" && next1.text === "=" && peek(2)?.text !== "=";
            if (isAssign) {
              if (tok.kind === "AT_IDENT" && lastPart !== "=") break;
              if (tok.kind === "IDENT" && lastPart !== "." && lastPart !== "=" && lastPart !== ":") break;
            }
            // W14-BB: extend the assignment-boundary check to compound assigns
            // (`+=`, `-=`, `*=`, `/=`, `%=`) and postfix updates (`++`, `--`)
            // on reactive `@x` cells. SPEC §6.1.2 + §50.13 enumerate the
            // compound forms; §5.2.3 line 1385 enumerates `@count++`. Without
            // this gate, a state-decl RHS like `<x> = 0` followed by a
            // newline-separated `@y += 1` greedily swallowed the second
            // statement into the first decl's init string (`init: "0\n@y += 1"`)
            // and the @y write was silently dropped. The peek(1) shape is
            // OPERATOR (multi-char), not PUNCT — so this guard sits parallel
            // to the existing `=`-PUNCT check rather than re-using it.
            // Bitwise compound assigns (`<<=`, `>>=`, `&=`, `|=`, `^=`,
            // `**=`, `&&=`, `||=`, `??=`, `>>>=`) are NOT listed in SPEC
            // §50.13 — excluded conservatively per scope rules.
            const COMPOUND_OPS = new Set(["+=", "-=", "*=", "/=", "%=", "++", "--"]);
            const isCompoundOrUpdate = next1 && next1.kind === "OPERATOR" && COMPOUND_OPS.has(next1.text);
            if (isCompoundOrUpdate && tok.kind === "AT_IDENT" && lastPart !== "=") break;
            // S25 — S22 §6 bug fix: `@name :` at depth 0 always begins a
            // typed state-decl (§53). Without this guard, an untyped
            // `@x = 1` followed by `@y: Type = expr` in the same logic
            // block silently swallows the typed decl — collectExpr kept
            // consuming because `@y` wasn't followed by `=`. The `:`
            // after `@` cannot appear mid-expression at depth 0
            // (ternary uses `?`, object keys are inside `{}` which is
            // depth > 0).
            const isTypedReactive = next1 && next1.kind === "PUNCT" && next1.text === ":";
            if (isTypedReactive && tok.kind === "AT_IDENT" && lastPart !== "=") break;
            // high-deepset-write-loss (2026-06-06): a dotted-path reactive
            // statement at depth 0 also begins a NEW statement. The forms are
            //   `@obj.path.to.prop = value`     -> reactive-nested-assign (§5.2.3)
            //   `@arr.push(...)` (et al.)       -> reactive-array-mutation
            // The existing assignment/compound/typed boundary checks above only
            // fire when peek(1) is `=`/`+=`/`:` etc., but a deep-set's peek(1)
            // is `.` (the path opener), so none of them break. Result: the
            // PRECEDING statement's collectExpr greedily swallows the whole
            // dotted-path statement into its RHS (e.g. `@c = 1` swallows the
            // following `@a.ref = "p"`, and `@a.ref = "p"` swallows the
            // following `@a.ref = "q"`), silently dropping the deep-set / array
            // mutation at codegen. The ASI-NEWLINE path below cannot rescue it
            // because its tokStartsStmt excludes AT_IDENT. So recognize the
            // dotted-path reactive form explicitly here.
            //
            // `lastPart !== "="` (and `!== "."`) preserves RHS operand reads:
            // `@y = @x.prop` collects `@x.prop` as the RHS value, not a new
            // statement. The forward scan only confirms the path TERMINATES as a
            // statement (a bare `=`, not `==`, after the chain — a deep-set; or
            // a 1-segment array-mutation method immediately followed by `(`).
            //
            // cycles-prereq (S168 COW-all): the chain also accepts `[idx]`
            // bracket segments so a bracket-index WRITE (`@arr[i] = value`)
            // following another statement is recognized as a NEW statement.
            // Pre-fix, a bracket-write's peek(1) is `[` (not `.`/`=`), so none
            // of the boundary checks fired and the preceding statement's
            // collectExpr swallowed it (same write-loss class as the S167
            // deep-set fix, now generalized to bracket targets).
            if (
              tok.kind === "AT_IDENT" &&
              lastPart !== "=" && lastPart !== "." &&
              next1 && next1.kind === "PUNCT" && (next1.text === "." || next1.text === "[")
            ) {
              const ARRAY_MUTATIONS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"]);
              // Walk the heterogeneous `(.ident | [idx])+` chain from peek(1).
              let k = 1;
              const segs = [];           // dotted-ident segments (for mutation check)
              let sawBracket = false;
              let valid = true;
              while (peek(k)?.kind === "PUNCT" && (peek(k)?.text === "." || peek(k)?.text === "[")) {
                if (peek(k).text === ".") {
                  const segTok = peek(k + 1);
                  if (segTok && (segTok.kind === "IDENT" || segTok.kind === "KEYWORD")) {
                    segs.push(segTok.text);
                    k += 2;
                  } else {
                    break;
                  }
                } else {
                  // `[ ... ]` — skip to the matching `]`, bracket-depth aware.
                  sawBracket = true;
                  let bd = 1;
                  let j = k + 1;
                  while (bd > 0 && peek(j)?.kind !== "EOF") {
                    const pt = peek(j);
                    if (pt.kind === "PUNCT" && pt.text === "[") bd++;
                    else if (pt.kind === "PUNCT" && pt.text === "]") bd--;
                    j++;
                  }
                  if (bd !== 0) { valid = false; break; }
                  k = j;
                }
              }
              if (valid && (segs.length > 0 || sawBracket)) {
                const afterChain = peek(k);
                // Array-mutation: `@arr.method(` (single dotted segment, no bracket).
                const isArrayMutation =
                  !sawBracket && segs.length === 1 && ARRAY_MUTATIONS.has(segs[0]) &&
                  afterChain && afterChain.kind === "PUNCT" && afterChain.text === "(";
                // Deep-set / bracket-write: `@obj.path... = value` (bare `=`, not `==`).
                const isDeepSet =
                  afterChain && afterChain.kind === "PUNCT" && afterChain.text === "=" &&
                  peek(k + 1)?.text !== "=";
                if (isArrayMutation || isDeepSet) break;
              }
            }
          }
        }
        // BUG-ASI-NEWLINE: When at depth 0 and the current token is on a new line
        // relative to the last consumed token, AND the last consumed token ends a
        // value expression (IDENT, NUMBER, STRING, closing paren/bracket), AND the
        // current token begins a new statement (IDENT or KEYWORD), treat the newline
        // as a statement boundary. This handles multi-line ^{} meta bodies like:
        //   let variants = reflect(Color).variants
        //   emit("<p>" + variants.join(", ") + "/")
        // Without this, collectExpr greedily consumes both lines as a single let-decl.
        if (
          parts.length > 0 &&
          angleDepth === 0 &&
          // (Slice 3) removed redundant identity check `lastTok !== startTok` — it was an
          // off-by-one (peek/consume return same object, so it meant >=2 tokens, not >=1).
          // `parts.length > 0` is the authoritative "have we consumed something" signal.
          tok.span.line > lastTok.span.line // current token is on a later line
        ) {
          const lastKind = lastTok.kind;
          const lastText = lastTok.text;
          // lastTok ends an expression if it's a value-producing token
          // Phase A1a Step 11.0e — `not` (SPEC §42.1) is the absence-value
          // primitive: "both a value and a type." It is value-producing in
          // RHS position (`<x> = not`, `let x = not`) and as the trailing
          // token of `is not` operator. SPEC §42.6 E-TYPE-045 explicitly
          // forbids `not` in prefix position, so it never opens a new
          // statement. Without this entry, `<x> = not\n<y> = 0` failed
          // ASI-NEWLINE (`lastEndsValue=false`), and Step 11.0b's universal
          // `<` IDENT boundary (below) never fired — sibling `<y>` got
          // greedily consumed into the init string. (P-FUP-2 from Step 12.)
          //
          // Phase A1a Step 11.0f — BLOCK_REF tokens (e.g., `?{SQL}`,
          // `${expr}` consumed as embedded child placeholders per
          // tokenizer.ts L796) are value-producing terminals. SPEC §6
          // establishes `?{SQL}` as a SQL passthrough block expression;
          // these placeholders represent the in-place result of an
          // embedded child block (sql/error-effect/meta) and are
          // semantically symmetric with closing-bracket terminals (`)`,
          // `]`, `}`) — they end an expression with a value. Without
          // this entry, `<x> = ?{SQL}\n<y> = 0` failed ASI-NEWLINE
          // (`lastEndsValue=false`); Step 11.0b's universal `<` IDENT
          // boundary (below) never fired — sibling `<y>` got greedily
          // consumed into the init string. (P-FUP-3 from Step 11.0e.)
          //
          // Note: L1817 (above) already breaks at depth 0 when a NEW
          // BLOCK_REF arrives after `parts.length > 0`, so adjacent
          // `?{A}\n?{B}` pairs are governed by that earlier guard, NOT
          // by this disjunct. This disjunct only fires when the next
          // token is something OTHER than BLOCK_REF (e.g., `<NAME>`
          // sibling decl opener) on a later line.
          const VALUE_KEYWORDS = new Set(["true", "false", "null", "undefined", "this", "not"]);
          const lastEndsValue = (
            lastKind === "IDENT" ||
            lastKind === "NUMBER" ||
            lastKind === "STRING" ||
            lastKind === "AT_IDENT" ||
            lastKind === "BLOCK_REF" ||
            (lastKind === "KEYWORD" && VALUE_KEYWORDS.has(lastText)) ||
            (lastKind === "PUNCT" && (lastText === ")" || lastText === "]" || lastText === "}"))
          );
          // tok starts a new statement if it's an IDENT (function call) or unhandled KEYWORD
          const tokStartsStmt = (
            tok.kind === "IDENT" ||
            (tok.kind === "KEYWORD" && !STMT_KEYWORDS.has(tok.text))
          );
          if (lastEndsValue && tokStartsStmt) break;
          // Phase A1a Step 11.0b — newline-as-statement-separator for state-decls.
          // When a newline crosses, lastTok ends a value, and the current token
          // is `<` PUNCT followed by IDENT, peek further to see if this opens a
          // state-decl (Shape 1/2/3 plain or Variant C compound). If so, treat
          // the newline as a statement boundary.
          //
          // This generalizes ASI-NEWLINE (above) to recognize state-decl
          // openers — which start with `<` PUNCT, not IDENT or KEYWORD. The
          // shape lookahead is delegated to `scanStructuralDeclLookahead`,
          // the same helper used by `tryParseStructuralDecl` to confirm a
          // state-decl pattern. It returns null on decline, so a stray `<`
          // followed by IDENT but not shaped like a state-decl will not
          // trigger a false break.
          //
          // Critical disambiguation:
          //   - `<x> = a < b ? 1 : 2`  — same line; newline gate suppresses,
          //     no break (existing behavior preserved).
          //   - `<x> = @a +\n@b`       — `+` does not end a value (lastEndsValue
          //     false), no break. Multi-line legitimate expressions preserved.
          //   - `<x> = <input\n type/>` — at the `<input` token we are inside
          //     markup-RHS handled by `parseLiftTag`, not collectExpr. When we
          //     re-enter collectExpr after parseLiftTag (or for plain Shape
          //     1/3 RHS), `angleDepth === 0` ensures markup nesting is
          //     respected.
          //   - `compute(\na,b\n)\n<count>=0` — after `)`, lastEndsValue=true,
          //     newline crossed, `<count>` shape matches → break.
          if (
            lastEndsValue &&
            tok.kind === "PUNCT" && tok.text === "<" &&
            peek(1) && peek(1).kind === "IDENT"
          ) {
            // scanStructuralDeclLookahead is a closure over `i`; it expects
            // peek(0) === `<` and peek(1) === IDENT. Returns null if the
            // shape does not match a state-decl (Shape 1/2/3 or Variant C).
            const declShape = scanStructuralDeclLookahead();
            if (declShape) break;
          }
        }
        // Phase A1a Step 11.0a — compound-body child boundary.
        // When collecting the RHS of a child state-decl inside a Variant C
        // compound body, stop at the next sibling decl opener `<NAME>` (`<`
        // IDENT) or compound close `</`. This must fire AFTER at least one
        // RHS token has been consumed — i.e., parts.length > 0 — so the
        // first `<` is the leading ChildName opener that the caller has
        // already consumed past, not a leading-`<` of an incoming sibling.
        if (inCompoundBody && parts.length > 0 && angleDepth === 0) {
          if (tok.kind === "PUNCT" && tok.text === "<") {
            const t1 = peek(1);
            // Sibling decl: `<` IDENT (peek(1) is IDENT — the field name).
            if (t1 && t1.kind === "IDENT") break;
            // Compound close: `<` `/` (peek(1) is PUNCT `/`).
            if (t1 && t1.kind === "PUNCT" && t1.text === "/") break;
          }
        }
      }
      // Track brace / paren depth
      if (tok.kind === "PUNCT" && (tok.text === "{" || tok.text === "(" || tok.text === "[")) depth++;
      if (tok.kind === "PUNCT" && (tok.text === "}" || tok.text === ")" || tok.text === "]")) {
        if (depth === 0) break;
        depth--;
      }
      // Track angle-bracket depth as ELEMENT NESTING (not delimiter nesting).
      // Open: `<` IDENT/KEYWORD increments — opens an element.
      // Close: `< /` decrements — start of a `</tag>` close-tag.
      //        `/ >` decrements — self-closing `<tag/>`.
      // Plain `>` does NOT decrement: it ends an open-tag delimiter, but the
      // element body (text + children) continues until its `</tag>`.
      //
      // Bug 3 guard (`base < limit ? base : limit`): outside markup
      // (angleDepth === 0), if the previous token is a value-producing token,
      // `<` is a less-than comparison, not a tag opener — leave angleDepth
      // alone. INSIDE markup (angleDepth > 0) the guard does NOT apply: text
      // content tokenizes as IDENT/NUMBER/STRING and naturally precedes child
      // tags (`<div>label <button…>`), so a `<` IDENT/KEYWORD sequence is
      // unambiguously a child element opener.
      //
      // A3 fix (fix-component-def-text-plus-handler-child): pre-fix this used
      // delimiter nesting (`>` decrements). For `<div>label <button onclick=…`,
      // the `>` of `<div>` dropped angleDepth to 0; then the prevEndsValue
      // guard blocked the next `<` from re-opening because lastTok was the
      // text-IDENT `label`. With angleDepth==0, the inner `onclick =` tripped
      // the IDENT-`=` statement-boundary check and `collectExpr` truncated
      // the component-def body mid-stream. The element-nesting scheme aligns
      // with `collectLiftExpr` (above) and resolves the bug.
      if (tok.kind === "PUNCT" && tok.text === "<" && depth === 0) {
        const afterLt = peek(1);
        const isTagNameAfter = afterLt && (afterLt.kind === "IDENT" || afterLt.kind === "KEYWORD");
        const isCloseTagStart = afterLt && afterLt.kind === "PUNCT" && afterLt.text === "/";
        // A7 fix (fix-component-def-block-ref-interpolation-in-body): track
        // whether this open tag is for an HTML void element (`<br>`,
        // `<input>`, `<hr>`, etc.). Void elements increment angleDepth like
        // any other element so attribute tokens (`bind:value=@x`) inside
        // their open tag are correctly treated as inside-markup. The matching
        // decrement happens on the open-tag's closing `>` (not `</tag>`,
        // which never appears for void elements). See the void-close handler
        // below which fires on the next `>` after `pendingVoidClose` is set.
        const isVoidHtmlTag = isTagNameAfter && afterLt.kind === "IDENT" && HTML_VOID_ELEMENTS.has(afterLt.text.toLowerCase());
        if (isCloseTagStart && angleDepth > 0) {
          angleDepth--;
        } else if (isTagNameAfter) {
          if (angleDepth > 0) {
            // Inside markup — child tag opener, unconditional.
            angleDepth++;
            if (isVoidHtmlTag) pendingVoidClose = true;
          } else {
            // Outside markup — Bug 3 guard against `value < value`.
            const prevEndsValue = parts.length > 0 && (
              lastTok.kind === "IDENT" ||
              lastTok.kind === "AT_IDENT" ||
              lastTok.kind === "NUMBER" ||
              lastTok.kind === "STRING" ||
              (lastTok.kind === "PUNCT" && (lastTok.text === ")" || lastTok.text === "]"))
            );
            if (!prevEndsValue) {
              angleDepth++;
              if (isVoidHtmlTag) pendingVoidClose = true;
            }
          }
        }
      }
      // Self-close: `/` followed by `>` decrements element depth.
      if (angleDepth > 0 && tok.kind === "PUNCT" && tok.text === "/" && depth === 0) {
        const next = peek(1);
        if (next && next.kind === "PUNCT" && next.text === ">") {
          angleDepth--;
          // `<voidtag/>` self-closes via the slash; cancel any pending void close
          // so the subsequent `>` does not double-decrement.
          pendingVoidClose = false;
        }
      }
      // A7 fix: void-element close — when `pendingVoidClose` is set, the next
      // bare `>` (not `/>`, handled above) closes the void element. Decrement
      // angleDepth and clear the flag.
      if (pendingVoidClose && tok.kind === "PUNCT" && tok.text === ">" && depth === 0 && angleDepth > 0) {
        angleDepth--;
        pendingVoidClose = false;
      }
      // E-EQ-004: `===` and `!==` are not valid scrml operators (§45)
      if (tok.kind === "OPERATOR" && (tok.text === "===" || tok.text === "!==")) {
        const eqSpan = tokenSpan(tok, filePath);
        const replacement = tok.text === "===" ? "==" : "!=";
        errors.push(new TABError(
          "E-EQ-004",
          `E-EQ-004: \`${tok.text}\` is not a valid scrml operator. Use \`${replacement}\` instead — scrml equality is always strict.`,
          eqSpan,
        ));
        lastTok = consume();
        parts.push(replacement);
        partLines.push(lastTok.span?.line ?? 0);
        continue;
      }
      // E-EQ-002: `== not` and `!= not` — use `is not` instead (§45)
      // Recovery: rewrite `== not` → `is not`, `!= not` → `is not not` in the expression.
      if (tok.kind === "OPERATOR" && (tok.text === "==" || tok.text === "!=")) {
        const nextTok = peek(1);
        if (nextTok && nextTok.kind === "KEYWORD" && nextTok.text === "not") {
          const eqSpan = tokenSpan(tok, filePath);
          errors.push(new TABError(
            "E-EQ-002",
            `E-EQ-002: \`${tok.text} not\` is not valid — use \`is not\` to check for absence (§45).`,
            eqSpan,
          ));
          // Consume both `==`/`!=` and `not`, emit recovered `is not` form
          consume(); // consume the operator
          lastTok = consume(); // consume `not`
          parts.push(tok.text === "!=" ? "is not not" : "is not");
          partLines.push(lastTok.span?.line ?? 0);
          continue;
        }
      }
      lastTok = consume();
      // Re-quote STRING tokens so their delimiters are preserved in the expression
      if (lastTok.kind === "STRING") {
        // A4: backtick-derived strings are re-emitted with backticks so any
        // `${...}` interpolations they contain remain template-literal
        // interpolations after re-parsing. Without this, the tokenizer's STRING
        // token would be JSON-stringified into a plain "..." literal and the
        // walker (lin tracking, dep-graph, …) would never see the identifiers
        // inside the interpolations.
        if (lastTok.isTemplate) {
          parts.push("`" + lastTok.text + "`");
        } else {
          parts.push(reemitJsStringLiteral(lastTok.text));
        }
      } else {
        parts.push(lastTok.text);
      }
      partLines.push(lastTok.span?.line ?? 0);
    }

    return {
      expr: joinWithNewlines(parts, partLines),
      span: parts.length > 0 ? spanOf(startTok, lastTok) : spanOf(startTok, startTok),
    };
  }

  /**
   * Collect a braced block body as raw text.  Returns { body: string, span }
   * Caller should have already seen the opening `{`.
   */
  function collectBracedBody() {
    const startTok = peek();
    let depth = 1;
    const parts = [];
    const partLines = [];
    let lastTok = startTok;

    while (depth > 0) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      if (tok.kind === "PUNCT" && tok.text === "{") depth++;
      if (tok.kind === "PUNCT" && tok.text === "}") {
        depth--;
        if (depth === 0) { lastTok = consume(); break; }
      }
      lastTok = consume();
      parts.push(lastTok.text);
      partLines.push(lastTok.span?.line ?? 0);
    }

    return {
      body: joinWithNewlines(parts, partLines),
      span: parts.length > 0 ? spanOf(startTok, lastTok) : spanOf(startTok, startTok),
    };
  }

  /**
   * Collect a lift expression. Unlike collectExpr, this collector includes
   * `/` tag closers as part of the expression (for inline markup like
   * `lift <li>${item}/`). Collection stops at `;`, `}`, a BLOCK_REF at
   * depth 0 (after collecting some tokens), or a statement keyword at
   * depth 0.
   *
   * @returns {{ expr: string, span: object }}
   */
  function collectLiftExpr() {
    const parts = [];
    const partLines = [];
    const startTok = peek();
    let lastTok = startTok;
    let depth = 0;
    // Track whether we're inside a markup tag's text content (between > and /).
    // Keywords in text content should NOT be treated as statement boundaries.
    let angleDepth = 0;
    // A7 fix: pending void-element close flag. Set when a `<voidtag` opens;
    // cleared on the open-tag's `>` or on a `/>` self-close.
    let pendingVoidClose = false;

    const STMT_KEYWORDS = new Set(["lift", "function", "fn", "const", "let", "import", "export", "use", "type", "server", "for", "while", "do", "if", "return", "match", "partial", "switch", "try", "fail", "transaction", "throw", "continue", "break", "when", "given"]);

    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      // BLOCK_REF at depth 0 after we have content is a boundary.
      // Exception: inside a tag body (tagNesting > 0) or inside markup content
      // (angleDepth > 0), the block is part of the expression.
      if (tok.kind === "BLOCK_REF" && depth === 0 && angleDepth === 0 && parts.length > 0 && (tok.block?.tagNesting ?? 0) === 0) break;
      // Track markup nesting depth: `< tag` opens, `</>` or `</tag>` closes.
      // Inside markup content (angleDepth > 0), keywords are text, not code.
      if (tok.text === "<" && (tok.kind === "PUNCT" || tok.kind === "OPERATOR")) {
        const next = peek(1);
        // `< /` or `< / >` = closing tag → decrement angleDepth
        if (next && next.text === "/" && next.kind === "PUNCT" && angleDepth > 0) {
          angleDepth--;
        }
        // `< ident` or `< keyword` = tag open → increment angleDepth
        // A7 fix: HTML void elements (`<br>`, `<input>`, etc.) have no closer.
        // Increment angleDepth (so attributes inside the open tag are tracked
        // as inside-markup), then flag pendingVoidClose so the next bare `>`
        // decrements it.
        else if (next && (next.kind === "IDENT" || next.kind === "KEYWORD")) {
          angleDepth++;
          if (next.kind === "IDENT" && HTML_VOID_ELEMENTS.has(next.text.toLowerCase())) {
            pendingVoidClose = true;
          }
        }
      }
      // A7 fix: `/>` self-close cancels any pending void close (slash decrement
      // happens via the brace/paren/angle generic handler below).
      if (tok.kind === "PUNCT" && tok.text === "/" && peek(1)?.kind === "PUNCT" && peek(1)?.text === ">") {
        if (angleDepth > 0) angleDepth--;
        pendingVoidClose = false;
      }
      // A7 fix: void-element close — bare `>` (not `/>`) decrements when a
      // void open tag is pending.
      else if (pendingVoidClose && tok.kind === "PUNCT" && tok.text === ">" && angleDepth > 0) {
        angleDepth--;
        pendingVoidClose = false;
      }
      // ASI-style newline boundary (same logic as collectExpr BUG-ASI-NEWLINE)
      if (parts.length > 0 && depth === 0 && angleDepth === 0 && tok.span.line > lastTok.span.line) {
        const lk = lastTok.kind, lt = lastTok.text;
        const VALUE_KW = new Set(["true", "false", "null", "undefined", "this"]);
        const endsValue = (
          lk === "IDENT" || lk === "NUMBER" || lk === "STRING" || lk === "AT_IDENT" ||
          (lk === "KEYWORD" && VALUE_KW.has(lt)) ||
          (lk === "PUNCT" && (lt === ")" || lt === "]" || lt === "}"))
        );
        const startsStmt = (
          tok.kind === "IDENT" || tok.kind === "AT_IDENT" ||
          (tok.kind === "KEYWORD" && !STMT_KEYWORDS.has(tok.text))
        );
        if (endsValue && startsStmt) break;
      }
      // Statement boundary at depth 0
      if (depth === 0) {
        if (tok.kind === "PUNCT" && tok.text === ";") {
          lastTok = consume();
          break;
        }
        if (tok.kind === "PUNCT" && tok.text === "}") break;
        // Statement keyword boundary (do not consume)
        // Guard: keywords after "." are property accesses (e.g. node.type), not boundaries.
        // Guard: keywords inside markup text content (angleDepth > 0) are text, not code.
        // Guard (Bug M, 2026-04-26): `function` / `fn` after expression-RHS context
        // is a function expression — keep collecting. See collectExpr above.
        if (parts.length > 0 && angleDepth === 0 && tok.kind === "KEYWORD" && STMT_KEYWORDS.has(tok.text) && parts[parts.length - 1]?.trim() !== ".") {
          let _isFnExprAfterRhs = false;
          if (tok.text === "function" || tok.text === "fn") {
            const _lastPart = parts[parts.length - 1]?.trim() ?? "";
            const _RHS_CTX = new Set([
              "=", ",", ":", "=>", ":>", "?",
              "&&", "||", "??", "!",
              "+", "-", "*", "/", "%",
              "<", ">", "<=", ">=", "==", "!=",
              "return", "throw", "yield", "await", "new",
            ]);
            if (_RHS_CTX.has(_lastPart)) _isFnExprAfterRhs = true;
          }
          if (!_isFnExprAfterRhs) break;
        }
      }
      // Track brace / paren / angle depth
      if (tok.kind === "PUNCT" && (tok.text === "{" || tok.text === "(" || tok.text === "[")) depth++;
      if (tok.kind === "PUNCT" && (tok.text === "}" || tok.text === ")" || tok.text === "]")) {
        if (depth === 0) break;
        depth--;
      }
      // Consume the token — including `/` which collectExpr would stop at for operators
      lastTok = consume();
      // Re-quote STRING tokens so their delimiters are preserved
      if (lastTok.kind === "STRING") {
        // A4: preserve backtick templates so `${...}` interpolations

        // remain template-literal interpolations after re-parsing.

        if (lastTok.isTemplate) {

          parts.push('`' + lastTok.text + '`');

        } else {

          parts.push(reemitJsStringLiteral(lastTok.text));

        }
      } else {
        parts.push(lastTok.text);
      }
      partLines.push(lastTok.span?.line ?? 0);
    }

    return {
      expr: joinWithNewlines(parts, partLines),
      span: parts.length > 0 ? spanOf(startTok, lastTok) : spanOf(startTok, startTok),
    };
  }

  /**
   * Lift Approach C — parse inline lift markup directly into a MarkupNode.
   * Precondition: peek() is `<`, peek(1) is IDENT/KEYWORD (tag name).
   * Returns a MarkupNode, or null if the markup is malformed (caller falls
   * back to collectLiftExpr string path).
   *
   * Handles:
   *   - Opening tag: `<tag ...>` with attributes
   *   - Self-closing: `<tag .../>`
   *   - Closers: `</>` (inferred) and `</tagname>` (explicit)
   *   - Children: text, nested tags, BLOCK_REF (${expr}) logic children
   *   - Attribute forms: name="string", name=ident, name=fn(args), name=BLOCK_REF
   *   - Boolean attrs: name (no `=`)
   */
  function parseLiftTag() {
    const startTok = peek();
    if (startTok.text !== "<" || startTok.kind !== "PUNCT") return null;
    const nameTok = peek(1);
    if (!nameTok || (nameTok.kind !== "IDENT" && nameTok.kind !== "KEYWORD")) return null;

    consume(); // <
    consume(); // tag name
    const tag = nameTok.text;
    const isComponent = /^[A-Z]/.test(tag);

    // Parse attributes until > or /> or </> (malformed)
    const attrs = [];
    let selfClosing = false;
    while (true) {
      const t = peek();
      if (t.kind === "EOF") return null;
      // Self-close: />
      if (t.kind === "PUNCT" && t.text === "/" && peek(1)?.text === ">") {
        consume(); consume();
        selfClosing = true;
        break;
      }
      // Opening tag closer: >
      if (t.kind === "PUNCT" && t.text === ">") {
        consume();
        break;
      }
      // Attribute
      if (t.kind === "IDENT" || t.kind === "KEYWORD") {
        const attrName = _parseLiftAttrName();
        if (attrName === null) return null;
        const attrSpan = tokenSpan(t, filePath);
        // Check for =
        if (peek().kind === "PUNCT" && peek().text === "=") {
          consume(); // =
          const value = _parseLiftAttrValue(attrSpan);
          if (value === null) return null;
          attrs.push({ name: attrName, value, span: attrSpan });
        } else {
          // Boolean attribute (no =)
          attrs.push({ name: attrName, value: { kind: "absent", span: attrSpan }, span: attrSpan });
        }
        continue;
      }
      // Unknown token — bail to string fallback
      return null;
    }

    // Self-closing or void element: no children
    if (selfClosing) {
      return {
        id: ++counter.next,
        kind: "markup",
        tag,
        attrs,
        children: [],
        selfClosing: true,
        closerForm: "self-closing",
        isComponent,
        span: spanOf(startTok, peek()),
      };
    }

    // A7 fix (fix-component-def-block-ref-interpolation-in-body): HTML void
    // elements (`<br>`, `<input>`, `<hr>`, `<img>`, etc.) are implicitly
    // closed by HTML semantics — they have no children and no closer in
    // idiomatic scrml. Without this case, parseLiftTag would try to parse
    // the parent's `</tag>` as the void element's closer, mismatch, return
    // null, and force the lift expression into the string-fallback path
    // which then truncates at the next sibling's IDENT-`=` boundary.
    // Treat void elements like self-close: emit a children-less markup node.
    if (HTML_VOID_ELEMENTS.has(tag.toLowerCase())) {
      return {
        id: ++counter.next,
        kind: "markup",
        tag,
        attrs,
        children: [],
        selfClosing: true,
        closerForm: "void",
        isComponent: false, // void elements are HTML, never components
        span: spanOf(startTok, peek()),
      };
    }

    // Parse children until </> or </tagname> or EOF
    const children = [];
    while (true) {
      const t = peek();
      if (t.kind === "EOF") break;
      // Closer: </> or </tagname>
      if (t.kind === "PUNCT" && t.text === "<" && peek(1)?.text === "/" && peek(1)?.kind === "PUNCT") {
        consume(); // <
        consume(); // /
        // Accept </> inferred
        if (peek().kind === "PUNCT" && peek().text === ">") {
          consume();
          return {
            id: ++counter.next, kind: "markup", tag, attrs, children,
            selfClosing: false, closerForm: "inferred", isComponent,
            span: spanOf(startTok, peek()),
          };
        }
        // Accept </tagname> explicit
        if ((peek().kind === "IDENT" || peek().kind === "KEYWORD") && peek().text === tag) {
          consume(); // tagname
          if (peek().kind === "PUNCT" && peek().text === ">") consume();
          return {
            id: ++counter.next, kind: "markup", tag, attrs, children,
            selfClosing: false, closerForm: "explicit", isComponent,
            span: spanOf(startTok, peek()),
          };
        }
        // Mismatched closing tag — bail
        return null;
      }
      // Nested tag: <IDENT or <KEYWORD
      if (t.kind === "PUNCT" && t.text === "<" && peek(1) && (peek(1).kind === "IDENT" || peek(1).kind === "KEYWORD")) {
        const childTag = parseLiftTag();
        if (!childTag) return null;
        children.push(childTag);
        continue;
      }
      // BLOCK_REF = ${expr} inline logic child
      if (t.kind === "BLOCK_REF") {
        const refTok = consume();
        if (refTok.block) {
          const logicChild = buildBlock(refTok.block, filePath, "logic", counter, errors);
          if (logicChild) children.push(logicChild);
        }
        continue;
      }
      // Statement boundary: } or ; ends the lift (no closer — bare component ref)
      // Only valid for components (PascalCase tags) with no children collected
      if ((t.kind === "PUNCT" && (t.text === "}" || t.text === ";")) && isComponent && children.length === 0) {
        return {
          id: ++counter.next, kind: "markup", tag, attrs, children: [],
          selfClosing: true, closerForm: "bare-ref", isComponent,
          span: spanOf(startTok, peek()),
        };
      }
      // Text content — consume and accumulate.
      // GITI-008: coalesce consecutive text tokens into one child. The
      // tokenizer splits `Hello world` into separate tokens with the
      // whitespace stripped; a prior span-gap means the source had
      // whitespace there. Join with a single space (HTML whitespace
      // semantics) so downstream emitters render text as the user wrote
      // it, not `Helloworldlikethis`. Parity with the static markup
      // path which preserves whitespace in text content; §10 imposes no
      // divergent text semantics for lift markup.
      consume();
      const prev = children.length > 0 ? children[children.length - 1] : null;
      if (prev && prev.kind === "text" && t.span.start > prev.span.end) {
        prev.value = prev.value + " " + t.text;
        prev.span = { ...prev.span, end: t.span.end };
      } else if (prev && prev.kind === "text") {
        prev.value = prev.value + t.text;
        prev.span = { ...prev.span, end: t.span.end };
      } else {
        children.push({
          id: ++counter.next,
          kind: "text",
          value: t.text,
          span: tokenSpan(t, filePath),
        });
      }
    }
    // EOF without closer — if component with no children, treat as bare-ref
    if (isComponent && children.length === 0) {
      return {
        id: ++counter.next, kind: "markup", tag, attrs, children: [],
        selfClosing: true, closerForm: "bare-ref", isComponent,
        span: spanOf(startTok, peek()),
      };
    }
    // EOF without closer on non-component — malformed
    return null;
  }

  /** Collect one attribute name token (possibly compound like `bind:value`, `class:active`, `aria-label`, `data-id`). */
  function _parseLiftAttrName() {
    const t = peek();
    if (t.kind !== "IDENT" && t.kind !== "KEYWORD") return null;
    consume();
    let name = t.text;
    // Compound names: bind:value, class:active, on:click (colon separator)
    //                 aria-label, data-id, aria-hidden (hyphen separator)
    while (
      (peek().kind === "PUNCT" && (peek().text === ":" || peek().text === "-")) &&
      (peek(1)?.kind === "IDENT" || peek(1)?.kind === "KEYWORD")
    ) {
      const sep = consume();
      const suffix = consume();
      name += sep.text + suffix.text;
    }
    return name;
  }

  /** Parse one attribute value after `=` into a structured value object. */
  function _parseLiftAttrValue(attrSpan) {
    // C10 fix (gate-found-tail) — when collecting the tokens of a lift markup
    // attribute value into a `parts` array, STRING tokens carry their content
    // WITHOUT delimiters (the tokenizer strips quotes — see readString). A
    // naive `parts.push(ct.text)` therefore drops the quotes, so
    // `if=(x != "")` reassembles to `(x !=)` (dangling `!=`, invalid JS) and
    // `if=(x == "active")` reassembles to `(x == active)` (bare ident — a
    // ReferenceError at runtime). Re-quote STRING tokens via the established
    // `reemitJsStringLiteral` helper (and re-wrap backtick template strings),
    // mirroring the collectExpr re-quote at the top-level expression path.
    const _pushAttrToken = (parts, ct) => {
      if (ct.kind === "STRING") {
        parts.push(ct.isTemplate ? "`" + ct.text + "`" : reemitJsStringLiteral(ct.text));
      } else {
        parts.push(ct.text);
      }
    };
    const t = peek();
    // String literal: "foo" or 'foo'
    if (t.kind === "STRING") {
      const valTok = consume();
      return { kind: "string-literal", value: valTok.text, span: tokenSpan(valTok, filePath) };
    }
    // BLOCK_REF = ${expr}
    if (t.kind === "BLOCK_REF") {
      const refTok = consume();
      const raw = refTok.block?.raw ?? "";
      // Strip ${ and }
      const inner = raw.replace(/^\$\{\s*/, "").replace(/\s*\}$/, "");
      const refSpan = tokenSpan(refTok, filePath);
      // §17 + §34 E-SWITCH-FORBIDDEN: same gap as ATTR_EXPR (S99-A7 FOLLOW-UP).
      // Inline `${...}` body inside a `lift <tag attr=${...}/>` markup —
      // safeParseExprToNode hands inner to acorn, which rejects `switch` as
      // not-an-expression and silently swallows it. Scan the inner text here
      // so the keyword surfaces a diagnostic. baseOffset uses refSpan.start
      // for uniqueness; the inner content starts ~2 chars in (after `${`).
      emitForbiddenSwitchInRaw(inner, refSpan, refSpan?.start ?? 0, filePath, errors);
      return {
        kind: "expr",
        raw: inner,
        refs: [],
        exprNode: safeParseExprToNode(inner, refSpan?.start ?? 0),
        span: refSpan,
      };
    }
    // Identifier or call: ident / ident.prop / ident(args)
    if (t.kind === "IDENT" || t.kind === "KEYWORD" || t.kind === "AT_IDENT" || t.kind === "NUMBER") {
      const parts = [];
      const startValTok = t;
      // Collect value tokens until whitespace-delimited boundary (next attr or `>`)
      // Track paren depth for function calls
      let depth = 0;
      while (true) {
        const ct = peek();
        if (ct.kind === "EOF") break;
        if (depth === 0) {
          if (ct.kind === "PUNCT" && (ct.text === ">" || ct.text === "/")) break;
          // End of value when next token is attribute name (IDENT/KEYWORD) not preceded by a continuation operator
          // Simplest heuristic: end when we see IDENT/KEYWORD after we already consumed value content
          // For now: stop at > or /; track () and [] depth for calls
        }
        if (ct.kind === "PUNCT" && (ct.text === "(" || ct.text === "[")) depth++;
        if (ct.kind === "PUNCT" && (ct.text === ")" || ct.text === "]")) {
          if (depth === 0) break;
          depth--;
        }
        // Next attribute boundary: if at depth 0 and current token was not `(`, `.`, `=`, or operator,
        // and next is IDENT/KEYWORD followed by `=` or whitespace-then-`>`, stop.
        // Simpler: rely on the whitespace heuristic via token line numbers isn't reliable here.
        // Safe approximation: IDENT/KEYWORD at depth 0 after a value-ending token is new attr
        if (depth === 0 && parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          const endsValue = /[\w)\]"']$/.test(lastPart);
          const startsAttr = (ct.kind === "IDENT" || ct.kind === "KEYWORD") && peek(1)?.text === "=";
          if (endsValue && startsAttr) break;
          // Also break when IDENT/KEYWORD at depth 0 follows a value-ending token and next is > or /
          if (endsValue && (ct.kind === "IDENT" || ct.kind === "KEYWORD")) {
            // Heuristic: this is the start of a new attribute (since it's not a . property access)
            // Check if previous token was `.` — then it IS a property access, continue
            if (lastPart !== ".") break;
          }
        }
        _pushAttrToken(parts, ct);
        consume();
      }
      // v0.2.4 bug-1-a1 — preserve token-boundary whitespace when joining lift
      // attribute-value tokens. The naive `parts.join("")` fuses adjacent
      // word-shaped tokens, so `not t.completed` (KEYWORD + IDENT + …) collapses
      // to `nott.completed` — a bogus identifier. Downstream `splitArgs` then
      // splits the call args on commas, hands `"nott.completed"` to acorn,
      // which parses it as a free MemberExpression and emits `nott.completed`
      // verbatim (the §45.7 `not <operand>` rewrite never matches because the
      // space it requires has been erased upstream). Solution: when joining
      // would create such a fusion (last char of prior part is word-shaped AND
      // first char of next part is word-shaped), insert a single space. This
      // preserves call-form `toggle(t.id, not t.completed)` correctly while
      // leaving non-fusing joins (`t` + `.` + `id` → `t.id`) untouched.
      const raw = _joinPreservingWordBoundary(parts);
      const valSpan = tokenSpan(startValTok, filePath);
      // Detect call-ref shape: identifier ( ... )
      const callMatch = raw.match(/^([A-Za-z_$][A-Za-z0-9_$.]*)\s*\((.*)\)$/s);
      if (callMatch) {
        const rawArgs = callMatch[2];
        const argList = rawArgs.trim().length === 0 ? [] : splitArgs(rawArgs);
        const _argExprNodes = argList.map(a => safeParseExprToNode(a, valSpan?.start ?? 0)).filter(Boolean);
        return {
          kind: "call-ref",
          name: callMatch[1],
          args: argList,
          argExprNodes: _argExprNodes.length === argList.length ? _argExprNodes : undefined,
          span: valSpan,
        };
      }
      // Simple variable-ref (single identifier, possibly with dots)
      if (/^[@A-Za-z_$][A-Za-z0-9_$.]*$/.test(raw)) {
        return {
          kind: "variable-ref",
          name: raw,
          exprNode: safeParseExprToNode(raw, valSpan?.start ?? 0),
          span: valSpan,
        };
      }
      // Fallback: treat as expr
      return {
        kind: "expr",
        raw,
        refs: [],
        exprNode: safeParseExprToNode(raw, valSpan?.start ?? 0),
        span: valSpan,
      };
    }
    // Bug 72 (S158) — bare `@`-sigil attribute value (the `<each>`-contextual
    // iteration sigil). The tokenizer emits `@` as a standalone PUNCT token, so
    // `<td title=@.>` lands here as `PUNCT "@"` — NOT covered by the
    // IDENT/KEYWORD/AT_IDENT branch above. Pre-fix this fell through to the
    // final `return null`, which forced `parseLiftTag` to bail the ENTIRE tag
    // parse and re-route the whole lift through the string-fallback path
    // ({kind:"expr"}). That string path renders a nested `<each>` as a literal
    // element and leaks the inner `@.` raw into the emitted JS
    // (E-CODEGEN-INVALID-JS). Collecting the `@`-sigil expression here keeps the
    // lift on the structured `{kind:"markup"}` path, where the shared each
    // machinery lowers the inner `@.` to the inner each's iter var (§17.7.3).
    // Mirrors the paren-branch below: collect the balanced `@...` token run
    // (member chain `@.field.sub` + any call args) and return an `expr` value.
    if (t.kind === "PUNCT" && t.text === "@") {
      const parts = [];
      const startValTok = t;
      let depth = 0;
      while (true) {
        const ct = peek();
        if (ct.kind === "EOF") break;
        if (depth === 0) {
          if (ct.kind === "PUNCT" && (ct.text === ">" || ct.text === "/")) break;
        }
        if (ct.kind === "PUNCT" && (ct.text === "(" || ct.text === "[")) depth++;
        if (ct.kind === "PUNCT" && (ct.text === ")" || ct.text === "]")) {
          if (depth === 0) break;
          depth--;
        }
        // Next-attribute boundary: same heuristic as the IDENT branch — a new
        // IDENT/KEYWORD at depth 0 following a value-ending token (and not a
        // property access via `.`) starts the next attribute.
        if (depth === 0 && parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          const endsValue = /[\w)\]"']$/.test(lastPart);
          const startsAttr = (ct.kind === "IDENT" || ct.kind === "KEYWORD") && peek(1)?.text === "=";
          if (endsValue && startsAttr) break;
          if (endsValue && (ct.kind === "IDENT" || ct.kind === "KEYWORD")) {
            if (lastPart !== ".") break;
          }
        }
        _pushAttrToken(parts, ct);
        consume();
      }
      const raw = _joinPreservingWordBoundary(parts);
      const valSpan = tokenSpan(startValTok, filePath);
      return {
        kind: "expr",
        raw,
        refs: [],
        exprNode: safeParseExprToNode(raw, valSpan?.start ?? 0),
        span: valSpan,
      };
    }
    // LIFT-1 fix: paren-wrapped expression attribute value — e.g. class:editing=(@x == item.id)
    //
    // When an attribute value starts with `(`, it is a parenthesized expression. The
    // IDENT/KEYWORD branch above does not handle this case — returning null here causes
    // parseLiftTag to abandon the entire tag parse after consuming `<`, the tag name,
    // and the attribute name, leaving the cursor desynchronised. The string-fallback
    // path then begins from the `(` token, losing the tag name (which defaults to
    // "div") and treating the parenthesized expression as text content (causing the
    // duplicate-text symptom: LIFT-1).
    //
    // Fix: collect the entire balanced parenthesized expression (tracking nested
    // parens) and return it as an `expr` attribute value — the same shape the
    // IDENT/KEYWORD fallback uses.
    if (t.kind === "PUNCT" && t.text === "(") {
      const parts = [];
      let depth = 0;
      while (true) {
        const ct = peek();
        if (ct.kind === "EOF") break;
        if (ct.kind === "PUNCT" && ct.text === "(") {
          depth++;
        } else if (ct.kind === "PUNCT" && ct.text === ")") {
          _pushAttrToken(parts, ct);
          consume();
          depth--;
          if (depth === 0) break;
          continue;
        }
        _pushAttrToken(parts, ct);
        consume();
      }
      const raw = _joinPreservingWordBoundary(parts);
      return {
        kind: "expr",
        raw,
        refs: [],
        exprNode: safeParseExprToNode(raw, attrSpan?.start ?? 0),
        span: attrSpan,
      };
    }
    return null;
  }

  /**
   * §53 Inline Type Predicates — type annotation collector (parseLogicBody closure).
   * Called after consuming `@name` when peek() is `:`.
   * Consumes `:` and collects the type expression (including balanced parens,
   * braces, brackets, and optional [label] suffix) up to `=` or `,` at top
   * level (i.e., when all three depth counters are zero).
   *
   * v024-4 — extended to track BRACE (`{`/`}`) and BRACKET (`[`/`]`) depth
   * alongside paren depth. Previous version tracked only paren depth, which
   * caused multi-field object-type annotations like
   * `{ id: number, title: string }[]` to terminate at the first comma inside
   * the braces. That made the typed-decl `<cards>: { id, title }[] = [...]`
   * fall through to html-fragment and never reach SYM PASS 1 — the kanban
   * registration gap. Object-type, tuple-array, and array-of-record forms are
   * all natural shapes in scrml's type grammar (SPEC §6.2 / §6.5 / §14).
   *
   * Top-level terminators (only when depth === 0 across ALL three):
   *   - `=` (assignment to RHS) — but not `==` (operator).
   *   - `,` (defensive — function-param parsing has its own collector and does
   *     not call this; left in place for callers in expression-list contexts).
   *
   * Returns the annotation string (e.g. "number(>0 && <10000)[valid_x]",
   * "{a:number,b:string}[]") or null.
   */
  // S160 — statement/decl-starting keywords that can NEVER appear at top level
  // inside a type annotation (§7.5 type-expr grammar has no statement keywords).
  // Used by collectTypeAnnotation to STOP a no-RHS type-annotation scan at the
  // next-sibling statement boundary (the no-RHS path has no `=` terminator).
  // EXCLUDES the type-shape/lifecycle keywords `not` / `lin` and the contextual
  // `to` (an IDENT) so `(not to User)` / `lin T` annotations survive intact.
  const TYPE_BOUNDARY_KEYWORDS = new Set([
    "function", "fn", "server", "lift", "const", "let", "type", "import",
    "export", "return", "if", "else", "for", "while", "match", "given",
    "partial", "do", "switch", "class", "public", "env", "when", "broadcast",
    "navigate", "use", "using", "transaction", "fail", "cleanup", "upload",
    "reset", "disconnect",
  ]);

  function collectTypeAnnotation() {
    if (peek().text !== ':') return null;
    consume(); // consume ':'
    const parts = [];
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    const atTopLevel = () => parenDepth === 0 && braceDepth === 0 && bracketDepth === 0;
    while (peek().kind !== 'EOF') {
      const t = peek();
      if (t.text === '(') {
        parenDepth++;
        parts.push(t.text);
        consume();
      } else if (t.text === ')') {
        if (parenDepth === 0) break; // unmatched ')' — stop
        parenDepth--;
        parts.push(t.text);
        consume();
        // Check for label suffix [ident] immediately after closing paren at top level
        if (atTopLevel() && peek().text === '[') {
          parts.push(peek().text); consume(); // consume '['
          while (peek().kind !== 'EOF' && peek().text !== ']') {
            parts.push(peek().text); consume();
          }
          if (peek().text === ']') { parts.push(peek().text); consume(); } // consume ']'
        }
      } else if (t.text === '{') {
        braceDepth++;
        parts.push(t.text);
        consume();
      } else if (t.text === '}') {
        if (braceDepth === 0) break; // unmatched '}' — stop
        braceDepth--;
        parts.push(t.text);
        consume();
      } else if (t.text === '[') {
        bracketDepth++;
        parts.push(t.text);
        consume();
      } else if (t.text === ']') {
        if (bracketDepth === 0) break; // unmatched ']' — stop
        bracketDepth--;
        parts.push(t.text);
        consume();
      } else if (t.text === '=' && atTopLevel()) {
        // Stop at assignment (but not ==)
        const next = peek(1);
        if (next && next.text === '=') {
          // == operator — include it
          parts.push(t.text); consume();
        } else {
          break;
        }
      } else if (t.text === ',' && atTopLevel()) {
        break; // stop at top-level comma (defensive — see docstring)
      } else if (t.text === '<' && atTopLevel()) {
        // S152 — stop at a top-level `<`. The scrml type-expr grammar (§7.5:
        // primitive-type | identifier | type-expr '[]' | type-expr '|' |
        // type-expr '?') has NO top-level `<` — there is no angle-bracket
        // generic syntax. A `<` here is therefore NOT part of the type; it is
        // the boundary of the annotation (e.g. a no-RHS state-decl `<x>: T[]`
        // followed by a sibling decl `<y>` or a compound close `</...>`).
        // Stopping here keeps the type string clean (`T[]`, not `T[]</state>`)
        // so the no-RHS array-default detection (Shape 4) sees a trailing `[]`.
        break;
      } else if (t.kind === 'KEYWORD' && atTopLevel() && TYPE_BOUNDARY_KEYWORDS.has(t.text)) {
        // S160 — stop at a top-level statement/decl-starting KEYWORD. The scrml
        // type-expr grammar (§7.5) contains NO statement keywords; a top-level
        // `function` / `server` / `const` / `if` / `match` / `return` / etc.
        // is therefore the BOUNDARY of the annotation, not part of the type.
        // Without this, a no-RHS typed decl (`<u>: User`) whose next sibling is
        // a statement (`function show() { ... }`) GREEDILY swallowed the whole
        // statement into the type string (the `{` opened brace-depth and the
        // scan ran to EOF). The lifecycle keywords `not` / `lin` and the
        // contextual `to` (an IDENT, not a KEYWORD) are NOT in the boundary set,
        // so `(not to User)` and `lin`-typed annotations are unaffected.
        break;
      } else {
        parts.push(t.text);
        consume();
      }
    }
    // Join parts. Insert a single space between two consecutive tokens whose
    // adjacent characters are both `[A-Za-z0-9_$]` — otherwise the parser
    // would silently fuse identifier-shape tokens like `not to string` into
    // `nottostring`, breaking the `to` contextual-keyword glyph detection
    // for SPEC §14.12 lifecycle annotations (S130 Landing 2). Single-space
    // is canonical (the `findTopLevelArrow` helper treats space as the
    // boundary). Pre-S130 callers tolerated the no-space join because the
    // glyphs they checked (`->`, `&&`, `!`) were punctuation-shaped and
    // unambiguous; the `to` glyph requires whitespace boundaries.
    const buf = [];
    for (let pi = 0; pi < parts.length; pi++) {
      const cur = parts[pi];
      if (pi > 0) {
        const prevEnd = buf[buf.length - 1].slice(-1);
        const curStart = cur.slice(0, 1);
        if (/[A-Za-z0-9_$]/.test(prevEnd) && /[A-Za-z0-9_$]/.test(curStart)) {
          buf.push(' ');
        }
      }
      buf.push(cur);
    }
    const annotation = buf.join('').trim();
    return annotation || null;
  }

  // Phase 4: tilde context tracking. Set to true after a value-lift (lift-expr with
  // expr.kind === "expr"). When active, safeParseExprToNode passes tildeActive to the
  // expression parser so standalone `~` is parsed as the tilde accumulator, not bitwise NOT.
  // Cleared after the next statement that contains `~` is parsed.
  let _tildeActive = false;

  // Unit CC (S123) — nested-block depth counter. Used by the V5-strict
  // `@name = expr` parse site to discriminate between:
  //   (a) bare write at the IMMEDIATE body-top of the synthetic default-logic
  //       lift wrapper (`<program>` / `<page>` / `<channel>` body-top under
  //       §40.8) → fires E-WRITE-NOT-IN-LOGIC-CONTEXT (Unit CC's surface)
  //   (b) bare write nested inside a fn / function body OR an explicit
  //       `${...}` block whose enclosing top-level wrapper happens to be
  //       synthetic → DOES NOT fire Unit CC (the nested context IS valid
  //       logic context; V-kill governs this region instead)
  //
  // `parentBlock._synthetic === true` alone is too coarse — it stays true
  // for the entire recursive parse tree under the synthetic wrapper. The
  // depth counter is incremented around any `{ ... }` body parse
  // (parseRecursiveBody) so nested-body sites observe `_nestedBlockDepth >
  // 0` even when parentBlock is synthetic. The Unit CC tag fires only when
  // (parentBlock._synthetic === true) AND (_nestedBlockDepth === 0).
  let _nestedBlockDepth = 0;

  /**
   * Parse a braced body `{ ... }` into a structured LogicNode[] tree.
   * Caller should have already consumed the opening `{`.
   * Consumes up to and including the closing `}`.
   */
  function parseRecursiveBody() {
    _nestedBlockDepth++;
    try {
      return _parseRecursiveBodyInner();
    } finally {
      _nestedBlockDepth--;
    }
  }

  function _parseRecursiveBodyInner() {
    const stmts = [];
    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      // Closing brace ends the body
      if (tok.kind === "PUNCT" && tok.text === "}") {
        consume();
        break;
      }
      // Skip bare semicolons
      if (tok.kind === "PUNCT" && tok.text === ";") { consume(); continue; }
      // Skip comments
      if (tok.kind === "COMMENT") { consume(); continue; }
      // Skip whitespace tokens
      if (tok.text.trim() === "" && tok.kind !== "EOF") { consume(); continue; }

      const node = parseOneStatement();
      if (node) {
        // GUARDED-EXPR: check if next token is a BLOCK_REF to error-effect — if so, wrap
        const nextTok = peek();
        if (nextTok.kind === "BLOCK_REF" && nextTok.block && nextTok.block.type === "error-effect") {
          consume();
          const errBlock = buildBlock(nextTok.block, filePath, parentBlock.type, counter, errors);
          stmts.push({
            id: ++counter.next,
            kind: "guarded-expr",
            guardedNode: node,
            arms: errBlock ? errBlock.arms : [],
            span: { ...node.span, end: nextTok.block.span.end },
          });
        } else {
          stmts.push(node);
        }
        // Phase 4 / §32 — track tilde context. The tilde accumulator is
        // initialized by EITHER (1) a `lift` statement with a value-lift
        // expression, OR (2) an unassigned expression statement (bare-expr
        // with no binding). The next statement may consume `~`; after one
        // potentially-consuming statement we deactivate so subsequent
        // statements do not silently parse `~` as the accumulator (they
        // would either be a fresh init or a forbidden out-of-scope read,
        // both of which the type system / RI surface diagnostics for).
        if (
          (node.kind === "lift-expr" && node.expr && node.expr.kind === "expr") ||
          node.kind === "bare-expr"
        ) {
          _tildeActive = true;
        } else if (_tildeActive) {
          _tildeActive = false;
        }
      }
    }
    return stmts;
  }

  /**
   * Parse a `fail` statement — `fail EnumType.Variant(args)` or `fail EnumType::Variant(args)`.
   * Called from both parseLogicBody's top-level loop and parseOneStatement (nested bodies).
   * Assumes peek() is the `fail` keyword.
   */
  function parseFailStmt() {
    const startTok = consume(); // consume `fail`
    let enumType = "";
    let variant = "";
    let args = "";

    // Parse EnumType
    if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
      enumType = consume().text;
    }

    // Parse separator: `.` (canonical) or `::` (alias)
    if (peek().text === "::" || peek().text === ".") {
      consume();
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        variant = consume().text;
      }
    }

    // Parse optional args in parens, preserving string literal quotes
    if (peek().text === "(") {
      consume();
      const argParts = [];
      let depth = 1;
      while (depth > 0) {
        const t = peek();
        if (t.kind === "EOF") break;
        if (t.text === "(") depth++;
        if (t.text === ")") {
          depth--;
          if (depth === 0) { consume(); break; }
        }
        const ct = consume();
        if (ct.kind === "STRING") {
          // A4: preserve backtick templates so `${...}` interpolations

          // remain template-literal interpolations after re-parsing.

          if (ct.isTemplate) {

            argParts.push('`' + ct.text + '`');

          } else {

            argParts.push(reemitJsStringLiteral(ct.text));

          }
        } else {
          argParts.push(ct.text);
        }
      }
      args = argParts.join(" ");
    }

    return {
      id: ++counter.next,
      kind: "fail-expr",
      enumType,
      variant,
      args,
      argsExpr: args ? safeParseExprToNode(args, spanOf(startTok, peek())?.start ?? 0) : undefined,
      span: spanOf(startTok, peek()),
    };
  }

  /**
   * §SQL: collect chained method calls (.run(), .all(), .get(), …) from the
   * parent token stream and append them to a SQL node's chainedCalls array.
   * Mirrors the consumption pattern used by the bare-BLOCK_REF handler
   * (parseOneStatement BLOCK_REF case and the buildBlock body-loop). Extracted
   * so the lift+BLOCK_REF case can apply the same chain-consumption when its
   * BLOCK_REF child is a SQL node (fix-lift-sql-chained-call, S40).
   */
  function consumeSqlChainedCalls(sqlNode) {
    if (!sqlNode || sqlNode.kind !== "sql" || !sqlNode.chainedCalls) return;
    while (peek().kind === "PUNCT" && peek().text === ".") {
      consume(); // dot
      // Accept IDENT or KEYWORD as the method name. `get` and `set` are
      // tokenized as KEYWORD per tokenizer.ts:62 — without this, `.get()`
      // would be left orphan in the parent token stream.
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        const methodTok = consume();
        let args = "";
        if (peek().kind === "PUNCT" && peek().text === "(") {
          consume(); // open paren
          while (peek().kind !== "EOF" && !(peek().kind === "PUNCT" && peek().text === ")")) {
            args += consume().text;
          }
          if (peek().kind === "PUNCT" && peek().text === ")") consume(); // close paren
        }
        // §8.9.5: `.nobatch()` is a compile-time marker with no
        // runtime effect. Flag the node and drop the call.
        if (methodTok.text === "nobatch") {
          sqlNode.nobatch = true;
        } else {
          sqlNode.chainedCalls.push({ method: methodTok.text, args });
        }
      } else {
        // Defensive: a dot followed by a non-IDENT is malformed; bail to avoid
        // spinning. The trailing tokens fall through to the parent's normal
        // statement processing.
        break;
      }
    }
  }

  /**
   * fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when a state-decl
   * initializer (RHS of `@x = …`, `server @x = …`, `@shared x = …`,
   * `@x: T = …`) is a SQL `?{}` BLOCK_REF — possibly with a chained
   * `.all()/.get()/.run()` — build the structured SQL child node, consume
   * the chain, and return it. Caller attaches the returned node as
   * `sqlNode` on the state-decl AST node and sets `init: ""` /
   * omits `initExpr` so downstream consumers (batch-planner string scanner,
   * emit-server CPS path, emit-logic case "state-decl") opt into the
   * structured form instead of the broken sql-ref placeholder comment
   * that `safeParseExprToNode` would otherwise produce
   * (the placeholder shape is "(slash-star) sql-ref:N (star-slash)" — written
   * out longhand here so this JSDoc comment doesn't close prematurely).
   *
   * Mirrors the parent fix at `return ?{…}.method()` (commit 2a05585).
   *
   * Returns the SQL child node on success; null otherwise. On null, no
   * tokens are consumed and callers MUST fall through to the legacy
   * `collectExpr()` path. The optional trailing `;` is consumed here
   * when a SQL node is built.
   */
  function tryConsumeSqlInit() {
    const next = peek();
    if (!(next && next.kind === "BLOCK_REF" && next.block && next.block.type === "sql")) {
      return null;
    }
    const refTok = consume(); // consume the BLOCK_REF
    const childNode = buildBlock(refTok.block, filePath, parentBlock.type, counter, errors);
    if (!childNode || childNode.kind !== "sql") {
      // Defensive: BS contract guarantees BLOCK_REF.block.type === "sql"
      // means buildBlock returns a SQL node. If that ever breaks, we have
      // already consumed the BLOCK_REF token; surfacing as null here would
      // create a token-stream hole for the caller. Best-effort: return null
      // and let collectExpr emit whatever it can with the remaining tokens.
      return null;
    }
    consumeSqlChainedCalls(childNode);
    if (peek().kind === "PUNCT" && peek().text === ";") consume();
    return childNode;
  }

  /**
   * Phase A1a Step 2 — V5-strict structural state-decl recognition.
   * Phase A1a Step 5 — extended for Shape 2 (decl-with-spec): markup-RHS
   * detection + bareword/call-form validators between IDENT and `>`.
   *
   * Recognizes the v0.next forms inside `${...}` logic blocks:
   *
   *   Shape 1:  `<NAME> = expr`                      → shape: "plain"
   *   Shape 3:  `const <NAME> = expr`                → shape: "derived"
   *   Shape 2:  `<NAME validator...> = <markup/>`    → shape: "decl-with-spec"
   *
   * Without this hook, the `<NAME>` form is silently consumed as
   * `kind: "html-fragment"` raw text (the deceptive-success pattern
   * documented in PARSER-AUDIT-2026-05-05.md).
   *
   * Caller invariants:
   * - `startTok` is the FIRST token of the decl: either the `<` PUNCT itself
   *   (Shape 1/2) or the `const` KEYWORD token (Shape 3, where `const` has
   *   already been consumed).
   * - When `isConst === true`, the `const` keyword has already been consumed
   *   and peek() is now the `<` PUNCT.
   * - When `isConst === false`, peek() is the `<` PUNCT.
   *
   * Step 5 lookahead grammar (between IDENT and `>`):
   *   validator-attr ::= IDENT                         (bareword: `req`, `email`, ...)
   *                    | IDENT `(` arg-text `)`        (call-form: `length(>=2)`, `min(0)`)
   *
   * Step 5 RHS branch (after `=`):
   *   markup-RHS  ::= `<` IDENT/KEYWORD ...           → wrap in render-spec, Shape 2
   *   expr-RHS    ::= anything else                    → existing collectExpr path
   *
   * Does NOT match (deferred to later A1a steps):
   * - `>` followed by `:` (typed annotation) — Step 6
   * - `>` followed by `{` (compound block, Variant C) — Step 11
   * - validators on Shape 1/3 (expr-RHS with validators) — declines so existing
   *   dispatch handles; per Step 5 brief, validators are Shape-2-only in scope
   * - `is some` two-word predicate (rejected by bareword scan; deferred)
   *
   * Returns the constructed `kind: "state-decl"` AST node on match. Returns
   * null if the lookahead does not match — caller MUST fall through to
   * existing dispatch (markup-tag/html-fragment paths) without tokens consumed.
   *
   * Per AST-CONTRACTS-AND-DECOMPOSITION §1.1: kind is `state-decl` (renamed
   * from `reactive-decl` in Step 3). Step 5 adds `shape: "decl-with-spec"`,
   * `renderSpec` sub-node (kind: "render-spec" wrapping the markup AST), and
   * `validators[]` field carrying bareword/call-form validator entries.
   */
  function tryParseStructuralDecl(startTok, isConst, opts = null) {
    // Phase A1a Step 11.0a — when called recursively from inside a Variant C
    // compound body, the child's RHS-collection must stop at the next
    // sibling-decl opener or compound close. The `inCompoundBody` flag is
    // forwarded to `collectExpr`. Top-level calls leave it false.
    const inCompoundBody = !!(opts && opts.inCompoundBody);
    // peek() must be `<` (PUNCT). If not, decline.
    const lt = peek();
    if (!(lt && lt.kind === "PUNCT" && lt.text === "<")) return null;

    // peek(1) must be IDENT (the cell name). If not, decline. This guards
    // against `<` used in JS comparisons — but at statement-start position,
    // a bare `<` followed by IDENT is unambiguous: scrml + JS have no other
    // construct of this shape.
    const nameTok = peek(1);
    if (!nameTok || nameTok.kind !== "IDENT") return null;

    // ─── Step 5 — lookahead scan for optional validators between IDENT and `>` ───
    //
    // scanLookahead returns:
    //   { consumeUntil, validators, fusedGtEq }
    //   - consumeUntil: index (relative to current `i`) AFTER the trailing `=`
    //     (or after the fused `>=` for the no-whitespace path)
    //   - validators: array of {name, args: string[]|null, span} entries
    //     (Phase A1b Step B9 then transforms args into ValidatorArg[] —
    //     ExprNode for standard predicates, RelationalPredicateNode for
    //     length(>=N)-style — via decorateValidatorsWithExprNodes below.)
    //   - fusedGtEq: true if the closer was the fused `>=` OPERATOR token
    //                (no-whitespace form `<count>=0`); false for whitespace
    //                form `<NAME ...> = ...`. Note: fused `>=` precludes
    //                inter-attr scanning (it's a tight `<NAME>=expr` form).
    //
    // Returns null on decline (caller falls through with no tokens consumed).
    //
    // Per Step 5 brief §5 surface: the scan is purely lookahead — does NOT
    // consume tokens. Caller consumes after a successful match.
    const scan = scanStructuralDeclLookahead();
    if (!scan) return null;

    // Pattern matched. Consume tokens through the `=` (or fused `>=`, or just
    // through `>` for the Variant C compound branch).
    const cursorBeforeConsume = i;
    while (i < scan.consumeUntil) consume();

    const name = nameTok.text;

    // ─── Phase A1a Step 11.0a — Variant C compound state-decl ───
    //
    // SPEC §6.3.2 Tier 2 (ad-hoc compound). The opener `<NAME>` is followed by
    // structural-children (each child a state-decl in its own right) and a
    // closer `</>` (anonymous) or `</NAME>` (named, no name-match enforcement
    // at this level — A1b can validate later if needed).
    //
    // Per AST-CONTRACTS-AND-DECOMPOSITION §1.1: parent state-decl carries
    //   shape:"plain", initExpr:null, structuralForm:true, isConst:false,
    //   children:[...child state-decl nodes].
    //
    // Per §6.6, parent compound CANNOT be `const` (only individual derived
    // fields are const). If `isConst` is true on a compound parent, decline.
    if (scan.compoundBody) {
      if (isConst) {
        // `const <x><y>=...</>` is not legal per §6.6. Restore cursor and
        // decline — caller falls through to html-fragment / next-statement.
        i = cursorBeforeConsume;
        return null;
      }
      // Loop: parse zero or more child state-decls, terminate on close tag.
      // Recursive: each child enters tryParseStructuralDecl, which itself
      // can compound — supporting nested compound `<o><i><leaf>=0</></></>`.
      const children = [];
      while (true) {
        // Skip COMMENT tokens defensively (the tokenizer may emit some
        // even though logic-block usually strips).
        while (peek().kind === "COMMENT") consume();
        const t = peek();
        // Anonymous close `</>` or named close `</NAME>`. Both are
        // recognized; if NAME differs from parent, no error here.
        if (t && t.kind === "PUNCT" && t.text === "<") {
          const tNext = peek(1);
          if (tNext && tNext.kind === "PUNCT" && tNext.text === "/") {
            // It's a close tag. Two forms:
            //   `</>`     → `<` `/` `>`
            //   `</NAME>` → `<` `/` IDENT `>`
            const tNext2 = peek(2);
            if (tNext2 && tNext2.kind === "PUNCT" && tNext2.text === ">") {
              // Anonymous close `</>` — consume `<` `/` `>`
              consume(); consume(); consume();
              break;
            }
            if (
              tNext2 && tNext2.kind === "IDENT" &&
              peek(3) && peek(3).kind === "PUNCT" && peek(3).text === ">"
            ) {
              // Named close `</NAME>` — consume `<` `/` IDENT `>`
              consume(); consume(); consume(); consume();
              break;
            }
            // Malformed close — decline whole compound, restore cursor.
            i = cursorBeforeConsume;
            return null;
          }
          // Sibling decl — recurse via tryParseStructuralDecl with the
          // `inCompoundBody` flag so the child's RHS-collection stops at
          // the next sibling boundary (sibling `<NAME>` or `</`).
          // The recursive call sees the new `<` opener at peek().
          const childCursor = i;
          const childNode = tryParseStructuralDecl(t, false, { inCompoundBody: true });
          if (!childNode) {
            // Child couldn't be parsed as a state-decl. Decline entire
            // compound (per §6.3.2: body must be structural-children only).
            i = cursorBeforeConsume;
            return null;
          }
          // Defensive: ensure recursive call advanced the cursor. If not,
          // it's an infinite loop — decline.
          if (i === childCursor) {
            i = cursorBeforeConsume;
            return null;
          }
          children.push(childNode);
          continue;
        }
        // EOF or unexpected token inside compound body — decline.
        if (!t || t.kind === "EOF") {
          i = cursorBeforeConsume;
          return null;
        }
        // Any other token (numbers, strings, IDENT-not-after-`<`, etc.)
        // is not a structural-child — decline whole compound.
        i = cursorBeforeConsume;
        return null;
      }
      return {
        id: ++counter.next,
        kind: "state-decl",
        name,
        init: "",
        initExpr: null,
        structuralForm: true,
        isConst: false,
        shape: "plain",
        defaultExpr: null,
        pinned: false,
        children,
        span: spanOf(startTok, peek()),
      };
    }

    // ─── Phase A1a Step 11.0c — typed state-decl ───
    //
    // SPEC §6.2 explicitly permits typed annotations on the three RHS shapes:
    //
    //   <count>: number = 0                              // typed Shape 1
    //   <userInfo>: UserInfo = ("alice", 30, true)       // Tier 3 positional sugar (§14.11)
    //   <phase>: Phase = .Idle                           // bare-variant inference (§14.10 / M9)
    //   const <doubled>: number = @count * 2             // typed Shape 3 derived
    //   <email>: string(pattern(/.../)) req = <input/>   // refinement-typed Shape 2
    //
    // The shape is `<NAME>` + `:` + type-expression + `=` + RHS. The lookahead
    // (`scanStructuralDeclLookahead`) recognises the `>:` prefix and returns
    // `typedDecl: true` with `consumeUntil` set to past `>` only — caller
    // consumes the `:`, the balanced type expression, then the `=`, and
    // proceeds with the standard markup-RHS / expression-RHS dispatch.
    //
    // Type-expression collection delegates to the existing
    // `collectTypeAnnotation()` helper (used by typed `let`, `const`,
    // `@NAME : T = init`, function-param annotations, etc.). The helper
    // tracks paren depth, so refinement-type predicate forms
    // (`string(pattern(/^[^@]+@[^@]+$/))`) are accepted without further
    // extension. Output is a STRING (raw type text) — A1b owns
    // type-checking and bare-variant resolution; A1c emits runtime
    // predicates from refinement-type forms.
    //
    // Tier 3 positional sugar `("alice", 30, true)` parses via acorn as a
    // `SequenceExpression` ExprNode — acceptable here. A1b's typed-compound
    // resolver interprets the sequence positionally per §14.11.
    //
    // Bare-variant `.Idle` parses via acorn as an error → safeParseExprToNode
    // produces an `escape-hatch` ExprNode with `raw: ".Idle"`. Acceptable for
    // 11.0c — A1b's bare-variant inference (M9) handles the resolution.
    let typeAnnotation = null;
    if (scan.typedDecl) {
      // peek() should now be `:`. Defensive: confirm.
      if (peek().kind !== "PUNCT" || peek().text !== ":") {
        // Should never happen: scanLookahead asserted this. Restore and decline.
        i = cursorBeforeConsume;
        return null;
      }
      // collectTypeAnnotation consumes `:` + balanced type expression up to
      // (but not including) the next top-level `=`.
      typeAnnotation = collectTypeAnnotation();
      if (!typeAnnotation) {
        // Empty/malformed type — restore cursor and decline so the existing
        // dispatch falls through to html-fragment.
        i = cursorBeforeConsume;
        return null;
      }
      // ─── Shape 4 — typed-decl with no `=` (no RHS) ─── (S152 array; S160 generalized)
      // SPEC §6.2 Shape 4: a typed decl (`<x>: T`) MAY omit the RHS. It defaults
      // to the type's canonical empty/zero DEFINED value where one exists
      // (int/integer/number→0, bool/boolean→false, string→"", T[]→[]); to `not`
      // (with an implicit `(not to T)` lifecycle, §14.12) where the type is a
      // bare `T` with no canonical empty (named :struct, :enum, date/timestamp,
      // opaque/custom); to `not` (NO lifecycle) where the type already admits
      // absence (`T | not` / `T?`). Refinement-typed forms synth the base
      // canonical-empty and defer the SATISFIES/VIOLATES decision (E-REFINEMENT-
      // NO-DEFAULT) to type-system, which has the §53 predicate evaluator.
      // The retired E-DECL-NEEDS-INITIALIZER survives ONLY for the const-derived
      // sub-case (`const <x>: T` no RHS) — that is a derived-with-no-expression
      // error, explicitly NOT covered by Shape 4 (§6.2). Preserving an error
      // there closes the silent-`undefined`→html-fragment hole (S152).
      if (peek().kind !== "PUNCT" || peek().text !== "=") {
        const declSpan = spanOf(startTok, peek());
        const litSpan = declSpan
          ? { file: filePath, start: declSpan.start, end: declSpan.end, line: declSpan.line, col: declSpan.col }
          : { file: filePath, start: 0, end: 0, line: 1, col: 1 };

        // Array type annotation ends in `[]` (refinement-type predicate forms
        // like `string(pattern(...))` are NON-array; their bracket-bearing args
        // are parenthesised, never a trailing `[]`).
        const isArrayType = /\[\s*\]\s*$/.test(typeAnnotation);

        // const-derived no-RHS is NOT Shape 4 (§6.2): a derived cell requires an
        // expression. (The array form historically synthesizes `[]` even for
        // const; that behavior is preserved unchanged below.)
        if (isConst && !isArrayType) {
          errors.push(new TABError(
            "E-DECL-NEEDS-INITIALIZER",
            `Derived cell \`const <${name}>: ${typeAnnotation}\` has no expression. A derived (\`const\`) cell requires an initializer expression (e.g. \`const <${name}>: ${typeAnnotation} = ...\`); the no-RHS canonical-empty/\`not\` default (§6.2 Shape 4) applies to plain reactive cells only.`,
            spanOf(startTok, peek()) || { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
          i = cursorBeforeConsume;
          return null;
        }

        // Classify the bare type STRING to pick the synthesized initial value.
        // ast-builder has no full type resolution; primitives with a canonical
        // empty are syntactically detectable. Everything else non-array →
        // `not`-init (the absence of a canonical empty is the deciding factor;
        // struct-vs-enum-vs-opaque distinction is irrelevant to the `not`
        // choice). Union/optional (`T | not` / `T?`) → `not`-init, NO lifecycle.
        // Refinement (`int(>0)` etc.) → synth base canonical-empty; type-system
        // performs the §53 predicate check (E-REFINEMENT-NO-DEFAULT).
        const tAnno = typeAnnotation.trim();

        // Union admitting absence (`T | not`, `not | T`) or optional (`T?`).
        // Top-level `|`/`?` only — refinement parens shield inner `|`. A simple
        // paren-depth scan keeps this robust against `Enum oneOf([.A, .B])`-style
        // args (their `|` would be inside `(`).
        let admitsAbsence = false;
        {
          let depth = 0;
          for (let k = 0; k < tAnno.length; k++) {
            const ch = tAnno[k];
            if (ch === "(" || ch === "[" || ch === "{") depth++;
            else if (ch === ")" || ch === "]" || ch === "}") depth--;
            else if (depth === 0 && ch === "?") admitsAbsence = true;
            else if (depth === 0 && ch === "|") {
              // top-level union — does any arm equal `not`?
              const arms = (function () {
                const out = [];
                let d = 0, start = 0;
                for (let j = 0; j <= tAnno.length; j++) {
                  const c = tAnno[j];
                  if (j === tAnno.length || (d === 0 && c === "|")) {
                    out.push(tAnno.slice(start, j).trim());
                    start = j + 1;
                  } else if (c === "(" || c === "[" || c === "{") d++;
                  else if (c === ")" || c === "]" || c === "}") d--;
                }
                return out;
              })();
              if (arms.some((a) => a === "not")) admitsAbsence = true;
            }
          }
        }

        // Refinement form: a base type immediately followed by a top-level
        // `(...)` predicate — e.g. `number(>0)`, `string(pattern(...))`,
        // `int(>=0)`. Captures the base type so we can synth its canonical empty.
        const refMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.test(tAnno) && tAnno.endsWith(")")
          ? tAnno.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/)
          : null;

        // Canonical-empty literal for a base primitive type name, or null when
        // the type has no canonical empty.
        function canonicalEmptyFor(baseName) {
          switch (baseName) {
            case "int": case "integer": case "number": return "0";
            case "bool": case "boolean": return "false";
            case "string": return '""';
            default: return null;
          }
        }

        // Decide the synthesized init text + whether to engage the implicit
        // `(not to T)` lifecycle (bare-T with no canonical empty).
        let initText = null;       // synthesized init source text
        let implicitNotLifecycle = false;
        let refinementBase = null; // when set, type-system runs the §53 check

        if (isArrayType) {
          initText = "[]";         // handled by the dedicated array branch below
        } else if (admitsAbsence) {
          initText = "not";        // union/optional — `not` inhabits the type, no lifecycle
        } else if (refMatch) {
          // Refinement-typed. Synth the base canonical-empty (if the base has
          // one) and let type-system fire E-REFINEMENT-NO-DEFAULT on violation.
          const baseEmpty = canonicalEmptyFor(refMatch[1]);
          if (baseEmpty !== null) {
            initText = baseEmpty;
            refinementBase = refMatch[1];
          } else {
            // Refinement over a no-canonical-empty base (rare) → `not` + lifecycle.
            initText = "not";
            implicitNotLifecycle = true;
          }
        } else {
          const empty = canonicalEmptyFor(tAnno);
          if (empty !== null) {
            initText = empty;      // primitive canonical empty (0 / false / "")
          } else {
            initText = "not";      // bare-T no canonical empty → not + implicit lifecycle
            implicitNotLifecycle = true;
          }
        }

        if (isArrayType) {
          // Synthesize the `[]` default. Build the node directly here — the
          // standard dispatch below expects a `=` to have been consumed and an
          // RHS to collect; the no-RHS array form has neither. (Unchanged S152.)
          const node = {
            id: ++counter.next,
            kind: "state-decl",
            name,
            init: "[]",
            initExpr: { kind: "array", span: litSpan, elements: [] },
            structuralForm: true,
            isConst: !!isConst,
            shape: "plain",
            defaultExpr: scan.defaultExprRaw
              ? safeParseExprToNode(scan.defaultExprRaw, scan.defaultExprSpan?.start ?? 0)
              : null,
            pinned: !!scan.pinned,
            ...(scan.server ? { isServer: true } : {}),
            typeAnnotation,
            span: declSpan,
          };
          let _reactivity;
          if (scan.debouncedRaw !== null && scan.debouncedRaw !== undefined) {
            _reactivity = _reactivity || {};
            _reactivity.debounced = parseAfterDuration(scan.debouncedRaw);
          }
          if (scan.throttledRaw !== null && scan.throttledRaw !== undefined) {
            _reactivity = _reactivity || {};
            _reactivity.throttled = parseAfterDuration(scan.throttledRaw);
          }
          if (_reactivity) node.reactivity = _reactivity;
          if (scan.validators && scan.validators.length > 0) {
            decorateValidatorsWithExprNodes(scan.validators, filePath);
            node.validators = scan.validators;
          }
          return node;
        }

        // Non-array Shape 4 — synthesize the scalar/`not` init. The codegen
        // already emits `not`→null, 0→0, ""→"", false→false from `init`/`initExpr`.
        const node = {
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: initText,
          initExpr: safeParseExprToNode(initText, litSpan.start),
          structuralForm: true,
          isConst: !!isConst,
          shape: "plain",
          defaultExpr: scan.defaultExprRaw
            ? safeParseExprToNode(scan.defaultExprRaw, scan.defaultExprSpan?.start ?? 0)
            : null,
          pinned: !!scan.pinned,
          ...(scan.server ? { isServer: true } : {}),
          typeAnnotation,
          // S160 Shape 4 — marker consumed by type-system's cell-value lifecycle
          // tracker: a no-RHS bare-`T` cell with no canonical empty defaulted to
          // `not` and acquires an IMPLICIT `(not to T)` lifecycle. The E-TYPE-001
          // message on a pre-transition read names that the lifecycle was
          // synthesized from the no-RHS declaration (§6.2 / §14.12.3).
          ...(implicitNotLifecycle ? { implicitNotLifecycle: true } : {}),
          // S160 Shape 4 — marker consumed by type-system for the refinement
          // static check: the base canonical-empty was synthesized; type-system
          // evaluates the §53 predicate on it and fires E-REFINEMENT-NO-DEFAULT
          // if it VIOLATES (no auto-default for a refined type with no
          // predicate-satisfying canonical empty).
          ...(refinementBase ? { refinementNoRhsBase: refinementBase } : {}),
          span: declSpan,
        };
        let _reactivity2;
        if (scan.debouncedRaw !== null && scan.debouncedRaw !== undefined) {
          _reactivity2 = _reactivity2 || {};
          _reactivity2.debounced = parseAfterDuration(scan.debouncedRaw);
        }
        if (scan.throttledRaw !== null && scan.throttledRaw !== undefined) {
          _reactivity2 = _reactivity2 || {};
          _reactivity2.throttled = parseAfterDuration(scan.throttledRaw);
        }
        if (_reactivity2) node.reactivity = _reactivity2;
        if (scan.validators && scan.validators.length > 0) {
          decorateValidatorsWithExprNodes(scan.validators, filePath);
          node.validators = scan.validators;
        }
        return node;
      }
      consume(); // consume `=`
      // Fall through to the standard markup-RHS / expression-RHS dispatch
      // below. The `typeAnnotation` local is attached to the returned node.
    }

    // ─── Step 5 — RHS branch: markup-RHS (Shape 2) or expression-RHS (Shapes 1/3) ───
    //
    // If next token is `<` PUNCT followed by IDENT/KEYWORD, attempt markup-RHS.
    // Successful markup parse → Shape 2 (decl-with-spec). Otherwise → expression-RHS.
    //
    // Step 5 scope: validators are Shape-2-only. If validators were collected
    // but RHS is expression (no markup), DECLINE (return null). The existing
    // dispatch will handle the failed parse. This bounds Step 5 to the brief's
    // narrow Shape 2 scope; validators-on-Shape-1/3 deferred to later step.
    const rhsTok = peek();
    const rhsT1 = peek(1);
    const isMarkupRHS = (
      rhsTok && rhsTok.kind === "PUNCT" && rhsTok.text === "<" &&
      rhsT1 && (rhsT1.kind === "IDENT" || rhsT1.kind === "KEYWORD")
    );

    // Phase A1a Step 6 — parse `default=expr` raw text into ExprNode. Stays
    // null if the scan didn't see a `default=` attr.
    const defaultExpr = scan.defaultExprRaw
      ? safeParseExprToNode(scan.defaultExprRaw, scan.defaultExprSpan?.start ?? 0)
      : null;
    const pinnedFlag = !!scan.pinned;
    // S83 Bug 1 — bareword `server` modifier on V5-strict structural decl.
    // When set, the state-decl is server-authoritative — same semantics as
    // the legacy `server @x = init` keyword-prefix path (ast-builder.js:4079),
    // which sets `isServer: true`. Type-system reads `isServer` to bind
    // scope-chain entries with isServer:true and to fire E-AUTH-005 /
    // W-AUTH-001 / E-AUTH-002 (type-system.ts:4578+).
    const serverFlag = !!scan.server;

    // S79 Phase 2 — parse debounced= / throttled= raw text via parseAfterDuration.
    // The reactivity field rides forward when at least one duration was captured;
    // typer (B14 / type-system.ts) handles E-REACTIVITY-ATTR-CONFLICT (both
    // present) and E-DEBOUNCED-WITH-DERIVED (isConst:true).
    let reactivity = undefined;
    if (scan.debouncedRaw !== null && scan.debouncedRaw !== undefined) {
      const parsed = parseAfterDuration(scan.debouncedRaw);
      reactivity = reactivity || {};
      reactivity.debounced = parsed;
    }
    if (scan.throttledRaw !== null && scan.throttledRaw !== undefined) {
      const parsed = parseAfterDuration(scan.throttledRaw);
      reactivity = reactivity || {};
      reactivity.throttled = parsed;
    }

    if (isMarkupRHS) {
      // Shape 2: markup-RHS. Parse via parseLiftTag (the existing markup parser
      // shared with `lift` directives). On failure, reset cursor to start of
      // the RHS and treat as expression-RHS to avoid token-stream desync.
      const rhsCursor = i;
      const markupNode = parseLiftTag();
      if (markupNode) {
        // Wrap in render-spec sub-node per AST-CONTRACTS §1.2.
        const renderSpec = {
          id: ++counter.next,
          kind: "render-spec",
          element: markupNode,
          span: markupNode.span,
        };
        // Phase A1b Step B9 — convert raw-text validator args into structured
        // ValidatorArg[] (ExprNode | RelationalPredicateNode). Mutates in
        // place; preserves null/[] distinction; idempotent.
        decorateValidatorsWithExprNodes(scan.validators, filePath);
        return {
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: "",
          initExpr: null,
          renderSpec,
          validators: scan.validators,
          defaultExpr,
          pinned: pinnedFlag,
          // S83 Bug 1 — `isServer` mirrors the legacy `server @x = init` path
          // (ast-builder.js:4079). Only emitted when the bareword `server`
          // appeared on the V5-strict structural decl.
          ...(serverFlag ? { isServer: true } : {}),
          structuralForm: true,
          isConst: !!isConst,
          shape: "decl-with-spec",
          // S79 Phase 2 — reactivity attribute (debounced= / throttled=).
          // Undefined when neither attribute was captured.
          ...(reactivity ? { reactivity } : {}),
          // Phase A1a Step 11.0c — typed Shape 2 (`<email>: string = <input/>`).
          // typeAnnotation is non-null iff the decl carried a `:T` annotation.
          ...(typeAnnotation ? { typeAnnotation } : {}),
          span: spanOf(startTok, peek()),
        };
      }
      // parseLiftTag failed (malformed markup). Reset cursor and fall through
      // to expression-RHS path so the html-fragment fallback can surface the
      // original raw text. This keeps Step 5 conservative — a malformed Shape 2
      // shouldn't silently downgrade.
      i = rhsCursor;
    }

    // Shape 1 or 3: expression-RHS. If validators were collected, this is an
    // out-of-scope combination for Step 5 — decline to keep scope bounded.
    if (scan.validators.length > 0) {
      // Cannot easily reset to before the lookahead consume since we already
      // consumed tokens. Return a state-decl with validators preserved on the
      // node (defensive: A1b can later validate the Shape 1/3 + validators
      // combination). For Step 5 tests, this path is exercised only by the
      // §S5.M11 negative case which expects fall-through; that case is
      // shaped to NOT have a `=` after attrs (no token consumption).
      // Per actual Step 5 brief §5 negative case 8: `<x req length(>=2)>` with
      // NO `=` after — the scan declines (no `=` found) and we never reach here.
    }

    // Bug 71 (S157) — derived `const <x> = match @cell { ... }` exhaustiveness.
    //
    // A derived state-cell whose RHS is a value-return `match` is the structural
    // sibling of the let-decl / const-decl / return-stmt match-as-expr hooks
    // (above; ast-builder.js:4985/5095/5744). Those hooks build a STRUCTURAL
    // match-expr (parseOneMatchAsExpr → header + parsed `match-arm-inline` body)
    // that the typer visits → checkMatchDiagnostics → exhaustiveness (E-TYPE-020).
    // Without the hook here, the derived RHS collapses to the ExprNode-form
    // match-expr (`rawArms: string[]` from safeParseExprToNode on `init`), which
    // the typer's exhaustiveness path never visits — a missing enum variant was
    // silently accepted.
    //
    // The derived cell is REACTIVE: emit-logic.ts (shape:"derived") builds its
    // `_scrml_derived_declare` recompute + `_scrml_derived_subscribe` dep edges
    // from `node.initExpr` / `node.init`. We MUST NOT perturb that path or the
    // cell stops recomputing on `@cell` change. So we DUAL-PARSE the same token
    // range: `collectExpr()` first (yielding `init` / `initExpr` byte-identical
    // to the pre-fix path — the reactive emit is unchanged), then RESET the
    // cursor and run `parseOneMatchAsExpr` to build a STRUCTURAL `matchExpr` that
    // rides alongside as a pure typer side-field (annotateNodes' state-decl
    // walker visits it for exhaustiveness; codegen ignores it). Both consume the
    // identical token span (a well-formed `match … { … }` ends at the same `}`),
    // so the post-RHS token stream (next sibling decl, etc.) is unaffected.
    const _rhsForMatchHook = peek();
    const _rhsForMatchHook1 = peek(1);
    const _rhsIsMatch = (
      _rhsForMatchHook && _rhsForMatchHook.kind === "KEYWORD" &&
      (_rhsForMatchHook.text === "match" ||
        (_rhsForMatchHook.text === "partial" && _rhsForMatchHook1?.text === "match"))
    );
    const _cursorBeforeRhs = i;

    // Collect the RHS expression (stops at `;`, unbalanced `}`, STMT_KEYWORDS,
    // BLOCK_REF, or EOF — same boundary rules as the legacy `@NAME = init` path).
    // Phase A1a Step 11.0a — when this call is recursive inside a compound
    // body, also stop at the next sibling-decl opener or compound close.
    const { expr } = collectExpr(null, inCompoundBody ? { compoundBody: true } : null);

    // Bug 71 (S157) — build the structural match-expr side-field for the typer.
    // Done AFTER collectExpr so `init` / `initExpr` (and thus the reactive emit)
    // are exactly as before; we then rewind and re-parse the match structurally.
    let _derivedMatchExpr = null;
    if (_rhsIsMatch) {
      i = _cursorBeforeRhs;
      _derivedMatchExpr = parseOneMatchAsExpr(startTok);
    }

    // Phase A1a Step 4 — `shape` discriminant per AST-CONTRACTS-AND-DECOMPOSITION
    // §1.1. Step 5 adds `validators` field when present (Shape 1/3 with validators
    // is technically out of brief scope but defensively preserved).
    // Phase A1a Step 11.0c — `typeAnnotation` field added for typed Shape 1/3.
    const node = {
      id: ++counter.next,
      kind: "state-decl",
      name,
      init: expr,
      initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
      structuralForm: true,
      isConst: !!isConst,
      shape: isConst ? "derived" : "plain",
      defaultExpr,
      pinned: pinnedFlag,
      // S83 Bug 1 — `isServer` mirrors the legacy `server @x = init` path
      // (ast-builder.js:4079). Only emitted when the bareword `server`
      // appeared on the V5-strict structural decl. Type-system at line
      // 4578+ reads `isServer` to fire E-AUTH-005 / W-AUTH-001 / E-AUTH-002.
      ...(serverFlag ? { isServer: true } : {}),
      // S79 Phase 2 — reactivity attribute (debounced= / throttled=).
      ...(reactivity ? { reactivity } : {}),
      span: spanOf(startTok, peek()),
    };
    if (scan.validators.length > 0) {
      // Phase A1b Step B9 — convert raw-text validator args into structured
      // ValidatorArg[] (ExprNode | RelationalPredicateNode). Idempotent;
      // safe to call from this defensive Shape-1/3-with-validators path.
      decorateValidatorsWithExprNodes(scan.validators, filePath);
      node.validators = scan.validators;
    }
    if (typeAnnotation) {
      node.typeAnnotation = typeAnnotation;
    }
    // Bug 71 (S157) — attach the structural match-expr side-field (built above
    // from the same token range) so the typer's state-decl walker can route a
    // derived `const <x> = match @cell { ... }` through checkMatchDiagnostics
    // (exhaustiveness — E-TYPE-020). Pure side-field: the reactive derived-cell
    // emit (emit-logic.ts shape:"derived") reads `node.init` / `node.initExpr`,
    // which are unchanged, so recompute + dep-subscribe wiring are untouched.
    if (_derivedMatchExpr) {
      node.matchExpr = _derivedMatchExpr;
    }
    return node;
  }

  /**
   * Phase A1a Step 5 — lookahead scan for the structural state-decl shape.
   *
   * Does NOT consume tokens. Caller consumes `consumeUntil - i` tokens on success.
   *
   * Grammar (between IDENT at peek(1) and the trailing `>` at some peek(n)):
   *   validator-list ::= (validator-attr)*
   *   validator-attr ::= IDENT                              (bareword)
   *                    | IDENT `(` paren-balanced-text `)`  (call-form)
   *
   * Closer match:
   *   - PUNCT `>` followed by PUNCT `=`   → consumeUntil = end of `=` token
   *   - OPERATOR `>=` (fused, no-ws form) → consumeUntil = end of `>=` token
   *
   * Returns null on decline. Decline conditions:
   *   - No `>` or `>=` found within reasonable bounds.
   *   - Disallowed token between IDENT and `>` (KEYWORD other than allowed,
   *     `}`, `;`, `<`, `:`, `=`, EOF, BLOCK_REF, AT_IDENT, etc.).
   *   - `>` not followed by `=` (e.g., `<x>foo` is a markup-tag, not state-decl).
   *
   * Edge: when validators are present, the fused `>=` form is impossible
   * (the IDENT is followed by IDENT not `>`). So fusedGtEq → no validators.
   */
  function scanStructuralDeclLookahead() {
    // Index (relative to tokens[]) of the validator-scan cursor. peek(0) is `<`,
    // peek(1) is IDENT (cell name). Validators start at peek(2).
    let scanIdx = 2;
    const validators = [];
    // Phase A1a Step 6 — `default=expr` raw text + span (parsed into ExprNode by caller).
    let defaultExprRaw = null;
    let defaultExprSpan = null;
    // Phase A1a Step 6 — `pinned` bareword modifier flag.
    let pinned = false;
    // S83 Bug 1 — `server` bareword modifier flag (V5-strict canonical form
    // `<x server> = init` per SPEC §6.13 + §52 + primer §4). Parallels the
    // legacy `server @x = init` keyword-prefix form (ast-builder.js:4062),
    // which produces a state-decl with `isServer: true`. The bareword path
    // here records the flag; the caller maps `scan.server → node.isServer`.
    let server = false;
    // S79 Phase 2 — `debounced=DURATION` / `throttled=DURATION` raw text + span
    // per SPEC §6.13. Both attributes share the duration grammar reused from
    // `<onTimeout after=>` (parsed via parseAfterDuration in the caller).
    // Mutually exclusive — typer (B14 / type-system.ts) fires
    // E-REACTIVITY-ATTR-CONFLICT on dual-attr; the scanner records both raw
    // forms if both are present so the typer can locate both spans.
    let debouncedRaw = null;
    let debouncedSpan = null;
    let throttledRaw = null;
    let throttledSpan = null;

    // Edge: bare `<NAME>` form (no validators) — peek(2) is `>` or `>=`.
    // Handled below by the closer check after the validator loop.

    while (true) {
      const t = tokens[i + scanIdx];
      if (!t || t.kind === "EOF") return null;

      // Closer: PUNCT `>`. Must be followed by PUNCT `=` for Shape 1/2/3
      // state-decl, OR by `<` IDENT / `</` for Variant C compound state-decl
      // (Phase A1a Step 11.0a — kickstarter v2 §3 / SPEC §6.3.2).
      if (t.kind === "PUNCT" && t.text === ">") {
        const next1 = tokens[i + scanIdx + 1];
        // Variant C compound: `<NAME>` followed by sibling-decl `<NAME>` or
        // anonymous close `</`. The sibling-decl shape is `<` PUNCT, then
        // IDENT (the field name). The anonymous close is `<` PUNCT, then
        // `/` PUNCT. Either way, after `>` we see PUNCT `<`. We disambiguate
        // by peeking peek(2) — the token after `<`.
        //
        // NOTE: validators (scan path with non-zero validator count) are not
        // permitted on a Variant C parent — only on Shape 2 fields (children).
        // The parent opener is just `<NAME>` with no attrs. So if validators
        // is non-empty, the compound branch is closed off.
        if (
          next1 && next1.kind === "PUNCT" && next1.text === "<" &&
          validators.length === 0 && defaultExprRaw === null && !pinned && !server
        ) {
          const next2 = tokens[i + scanIdx + 2];
          const isSiblingDecl = next2 && next2.kind === "IDENT";
          const isCompoundClose = next2 && next2.kind === "PUNCT" && next2.text === "/";
          if (isSiblingDecl || isCompoundClose) {
            return {
              consumeUntil: i + scanIdx + 1, // past `>` only — compound body parser will consume the rest
              validators,
              defaultExprRaw,
              defaultExprSpan,
              pinned,
              server,
              debouncedRaw,
              debouncedSpan,
              throttledRaw,
              throttledSpan,
              fusedGtEq: false,
              compoundBody: true,
            };
          }
        }
        // ─── Phase A1a Step 11.0c — typed state-decl ───
        // SPEC §6.2 explicitly permits typed annotations on the three RHS
        // shapes; SPEC §5/§14.11 (M10) defines Tier 3 typed compound positional
        // sugar `<userInfo>: UserInfo = ("alice", 30, true)`. The shape is
        // `<NAME>` + `:` + type-expression + `=` + RHS.
        //
        // Lookahead detects only the `>` followed by `:` prefix here. The
        // caller (`tryParseStructuralDecl`) then consumes the `:` and balanced
        // type expression via the existing `collectTypeAnnotation()` helper,
        // followed by the standard `=` and RHS dispatch (Shape 1/2/3).
        //
        // Validators-before-`>` are compatible (e.g. `<email req>: string =
        // <input/>`). The validators array is forwarded normally on the
        // returned scan record; the typed branch does NOT zero them.
        //
        // Refinement-type predicate forms (`string(pattern(/.../))`) are
        // accepted: collectTypeAnnotation tracks paren depth, so the
        // parenthesized predicate-list is consumed as part of the type
        // expression.
        if (next1 && next1.kind === "PUNCT" && next1.text === ":") {
          return {
            consumeUntil: i + scanIdx + 1, // past `>` only — caller handles `:` + type-expr + `=`
            validators,
            defaultExprRaw,
            defaultExprSpan,
            pinned,
            server,
            debouncedRaw,
            debouncedSpan,
            throttledRaw,
            throttledSpan,
            fusedGtEq: false,
            typedDecl: true,
          };
        }
        if (!next1 || next1.kind !== "PUNCT" || next1.text !== "=") return null;
        // Tighten: reject `>==` (would mean compound `==`) — eqTok.text === "="
        // standalone PUNCT is the canonical assignment-equals shape.
        return {
          consumeUntil: i + scanIdx + 2, // past `>` and `=`
          validators,
          defaultExprRaw,
          defaultExprSpan,
          pinned,
          server,
          debouncedRaw,
          debouncedSpan,
          throttledRaw,
          throttledSpan,
          fusedGtEq: false,
        };
      }

      // Fused `>=` OPERATOR (no-whitespace form `<count>=0`). Only possible
      // when scanIdx === 2 (no validators between IDENT and `>=`).
      if (t.kind === "OPERATOR" && t.text === ">=") {
        if (scanIdx !== 2) return null; // can't have validators + fused `>=`
        return {
          consumeUntil: i + scanIdx + 1, // past the fused token
          validators,
          defaultExprRaw,
          defaultExprSpan,
          pinned,
          server,
          debouncedRaw,
          debouncedSpan,
          throttledRaw,
          throttledSpan,
          fusedGtEq: true,
        };
      }

      // ─── Phase A1a Step 6 — `default=expr` attribute ───
      // KEYWORD token with text "default" followed by PUNCT `=`. Collect the
      // RHS as raw text, depth-tracked, stopping at top-level `>` or the
      // look-ahead pattern of the next attribute.
      if (t.kind === "KEYWORD" && t.text === "default") {
        const eqTok = tokens[i + scanIdx + 1];
        if (!eqTok || eqTok.kind !== "PUNCT" || eqTok.text !== "=") return null;
        if (defaultExprRaw !== null) return null; // duplicate `default=` — decline
        const valStart = tokens[i + scanIdx + 2];
        if (!valStart || valStart.kind === "EOF") return null;
        // State-machine collector for `default=<expr>`:
        //   - depth-track parens/brackets/braces.
        //   - At top level, stop on PUNCT `>` (closer).
        //   - At top level, an IDENT/KEYWORD encountered when `expectingExpr`
        //     is false (i.e., a primary already consumed and no continuing
        //     operator since) signals the next attribute → stop before consuming.
        //   - `expectingExpr` toggles: true after operator-like punctuation
        //     (`.`, `[`, OPERATOR), false after a primary (IDENT/KEYWORD/
        //     NUMBER/STRING) or after `)`/`]`.
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;
        let valIdx = scanIdx + 2;
        const valTexts = [];
        let valLastTok = null;
        let expectingExpr = true;
        while (true) {
          const vt = tokens[i + valIdx];
          if (!vt || vt.kind === "EOF") return null; // unterminated
          const topLevel = (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0);
          // Top-level closer: PUNCT `>`. Stop before consuming.
          if (topLevel && vt.kind === "PUNCT" && vt.text === ">") break;
          // Top-level next-attribute boundary: IDENT/KEYWORD when not expecting
          // an expression token signals the start of the next attribute.
          if (topLevel && !expectingExpr && (vt.kind === "IDENT" || vt.kind === "KEYWORD")) break;
          // Track depth + expectingExpr transitions.
          if (vt.kind === "PUNCT" && vt.text === "(") {
            parenDepth++;
            expectingExpr = true;
          } else if (vt.kind === "PUNCT" && vt.text === ")") {
            if (parenDepth === 0) return null;
            parenDepth--;
            expectingExpr = false;
          } else if (vt.kind === "PUNCT" && vt.text === "[") {
            bracketDepth++;
            expectingExpr = true;
          } else if (vt.kind === "PUNCT" && vt.text === "]") {
            if (bracketDepth === 0) return null;
            bracketDepth--;
            expectingExpr = false;
          } else if (vt.kind === "PUNCT" && vt.text === "{") {
            braceDepth++;
            expectingExpr = true;
          } else if (vt.kind === "PUNCT" && vt.text === "}") {
            if (braceDepth === 0) return null;
            braceDepth--;
            expectingExpr = false;
          } else if (vt.kind === "PUNCT" && (vt.text === "." || vt.text === ",")) {
            expectingExpr = true;
          } else if (vt.kind === "OPERATOR") {
            expectingExpr = true;
          } else if (vt.kind === "IDENT" || vt.kind === "KEYWORD" || vt.kind === "NUMBER" || vt.kind === "STRING" || vt.kind === "AT_IDENT") {
            expectingExpr = false;
          }
          // STRING tokens have their quotes stripped by the tokenizer; restore
          // them via JSON.stringify so the raw text is parseable as JS.
          valTexts.push(vt.kind === "STRING" ? JSON.stringify(vt.text) : vt.text);
          valLastTok = vt;
          valIdx++;
        }
        if (valTexts.length === 0) return null; // empty `default=` — decline
        defaultExprRaw = valTexts.join(" ").trim();
        defaultExprSpan = { ...valStart.span, end: valLastTok.span.end };
        scanIdx = valIdx;
        continue;
      }

      // ─── S79 Phase 2 — `debounced=DURATION` / `throttled=DURATION` attributes ───
      // SPEC §6.13. DURATION grammar reuses parseAfterDuration:
      //   literal:  Nms / Ns / Nm / Nh
      //   computed: ${expr}<unit>
      //
      // Token-stream shape — DURATION tokenizes as either:
      //   literal: NUMBER ("300") + IDENT ("ms")  — possibly with whitespace
      //   computed: PUNCT "$" + PUNCT "{" + ... + PUNCT "}" + IDENT ("ms")
      //             OR a single STRING/INTERP token if the tokenizer fuses ${...}
      //
      // The collector reuses the same depth-track pattern as default=, capturing
      // raw token text until the next attribute boundary or top-level `>`.
      // parseAfterDuration is invoked at decl-completion time (caller side) to
      // validate the captured raw text and produce an AfterDurationResult.
      if (t.kind === "IDENT" && (t.text === "debounced" || t.text === "throttled")) {
        const attrName = t.text;
        const eqTok = tokens[i + scanIdx + 1];
        if (!eqTok || eqTok.kind !== "PUNCT" || eqTok.text !== "=") {
          // Not the attribute form — fall through to the generic-IDENT validator
          // path below (which would treat `debounced` as a bareword validator,
          // an invalid predicate name; B10 typer rejects unknown predicates).
        } else {
          if ((attrName === "debounced" && debouncedRaw !== null) ||
              (attrName === "throttled" && throttledRaw !== null)) {
            return null; // duplicate attribute — decline
          }
          const valStart = tokens[i + scanIdx + 2];
          if (!valStart || valStart.kind === "EOF") return null;
          // Same depth-track collector as default=; stops at top-level `>` or
          // next attribute start.
          let parenDepth = 0;
          let bracketDepth = 0;
          let braceDepth = 0;
          let valIdx = scanIdx + 2;
          const valTexts = [];
          let valLastTok = null;
          let expectingExpr = true;
          while (true) {
            const vt = tokens[i + valIdx];
            if (!vt || vt.kind === "EOF") return null;
            const topLevel = (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0);
            if (topLevel && vt.kind === "PUNCT" && vt.text === ">") break;
            if (topLevel && !expectingExpr && (vt.kind === "IDENT" || vt.kind === "KEYWORD")) {
              // Heuristic: at top-level, an IDENT/KEYWORD when not expecting an
              // expression is normally the next attribute. EXCEPTION: the unit
              // suffix (ms/s/m/h) immediately after a NUMBER or `}` is part of
              // the duration value, not a new attribute. The unit IS an IDENT
              // and would be hit here right after the NUMBER's expectingExpr=
              // false transition. Detect: the immediately preceding token IS
              // a NUMBER or `}`, AND this IDENT is one of the duration unit
              // suffixes — keep it.
              const isUnit = (vt.text === "ms" || vt.text === "s" ||
                              vt.text === "m" || vt.text === "h");
              const prev = valLastTok;
              const prevIsNumberOrCloseBrace = prev && (
                prev.kind === "NUMBER" ||
                (prev.kind === "PUNCT" && prev.text === "}")
              );
              if (!(isUnit && prevIsNumberOrCloseBrace)) break;
            }
            if (vt.kind === "PUNCT" && vt.text === "(") { parenDepth++; expectingExpr = true; }
            else if (vt.kind === "PUNCT" && vt.text === ")") {
              if (parenDepth === 0) return null;
              parenDepth--;
              expectingExpr = false;
            }
            else if (vt.kind === "PUNCT" && vt.text === "[") { bracketDepth++; expectingExpr = true; }
            else if (vt.kind === "PUNCT" && vt.text === "]") {
              if (bracketDepth === 0) return null;
              bracketDepth--;
              expectingExpr = false;
            }
            else if (vt.kind === "PUNCT" && vt.text === "{") { braceDepth++; expectingExpr = true; }
            else if (vt.kind === "PUNCT" && vt.text === "}") {
              if (braceDepth === 0) return null;
              braceDepth--;
              expectingExpr = false;
            }
            else if (vt.kind === "PUNCT" && (vt.text === "." || vt.text === ",")) expectingExpr = true;
            else if (vt.kind === "OPERATOR") expectingExpr = true;
            else if (vt.kind === "IDENT" || vt.kind === "KEYWORD" || vt.kind === "NUMBER" ||
                     vt.kind === "STRING" || vt.kind === "AT_IDENT") expectingExpr = false;
            valTexts.push(vt.kind === "STRING" ? JSON.stringify(vt.text) : vt.text);
            valLastTok = vt;
            valIdx++;
          }
          if (valTexts.length === 0) return null; // empty value — decline
          // Join WITHOUT whitespace between tokens — duration values are tightly
          // shaped (`300ms`, `${expr}ms`); whitespace would change parseAfterDuration's
          // recognition. The literal regex tolerates whitespace defensively but
          // the canonical token-text join keeps things tight.
          const rawValue = valTexts.join("").trim();
          const valSpan = { ...valStart.span, end: valLastTok.span.end };
          if (attrName === "debounced") {
            debouncedRaw = rawValue;
            debouncedSpan = valSpan;
          } else {
            throttledRaw = rawValue;
            throttledSpan = valSpan;
          }
          scanIdx = valIdx;
          continue;
        }
      }

      // ─── Phase A1a Step 6 — `pinned` bareword modifier ───
      // IDENT with text "pinned" NOT followed by `(`. Sets `pinned: true` and
      // does NOT add to validators[]. Must be checked BEFORE the generic IDENT
      // validator branch below (otherwise `pinned` would be captured as a
      // validator name).
      if (t.kind === "IDENT" && t.text === "pinned") {
        const lookNext = tokens[i + scanIdx + 1];
        if (!lookNext || lookNext.kind !== "PUNCT" || lookNext.text !== "(") {
          if (pinned) return null; // duplicate `pinned` — decline
          pinned = true;
          scanIdx++;
          continue;
        }
        // `pinned(...)` falls through to the call-form validator branch (defensive,
        // though no spec-sanctioned `pinned(args)` form exists).
      }

      // ─── S83 Bug 1 — `server` bareword modifier ───
      // KEYWORD with text "server" NOT followed by `(`. Sets `server: true`
      // and does NOT add to validators[]. Must be checked BEFORE the generic
      // KEYWORD-falls-through path; `server` tokenises as KEYWORD (see
      // tokenizer.ts KEYWORDS), not IDENT, so it cannot ride the `pinned`
      // (IDENT) branch above. The bareword on a state-decl is the V5-strict
      // canonical form of `server @x = init` (SPEC §52.4.1 legacy keyword-
      // prefix form maps to `<x server> = init` per SPEC §6.13 + §34 row
      // E-DEBOUNCED-WITH-SERVER which already uses the `<x server>` notation,
      // plus primer §4 line 100 + the example 18 V5-strict comment). The
      // caller maps `scan.server → node.isServer` identically to how the
      // legacy `server @x` path sets `isServer: true` (ast-builder.js:4079).
      if (t.kind === "KEYWORD" && t.text === "server") {
        const lookNext = tokens[i + scanIdx + 1];
        if (!lookNext || lookNext.kind !== "PUNCT" || lookNext.text !== "(") {
          if (server) return null; // duplicate `server` — decline
          server = true;
          scanIdx++;
          continue;
        }
        // `server(...)` is not a spec-sanctioned form. Fall through to the
        // KEYWORD-decline path below (line ~3893) which returns null. The
        // caller restores the cursor and the existing markup-tag dispatch
        // surfaces the original text.
      }

      // Validator: IDENT bareword or call-form.
      if (t.kind === "IDENT") {
        const validatorName = t.text;
        const validatorStart = t.span;
        // Check for call-form: IDENT `(`
        const next = tokens[i + scanIdx + 1];
        if (next && next.kind === "PUNCT" && next.text === "(") {
          // Call-form: collect args by walking paren-matched tokens.
          //
          // Phase A1b Step B13 — top-level comma split.
          // SPEC §55.10 (4-level error message resolution chain) — Level-1
          // inline-override is a trailing string-literal arg on a predicate
          // call: `length(>=2, "Name must be at least 2 chars")`. To extract
          // the override, the collector splits args at commas that appear at
          // THIS call's top level (i.e., outside any nested paren/bracket/
          // brace). Pre-B13 produced one joined string; B13 emits one raw
          // string per top-level arg. B9's `decorateValidatorsWithExprNodes`
          // already iterates `args as string[]` and produces one structured
          // ValidatorArg per element.
          //
          // Backward-compat: for single-arg cases (no top-level commas),
          // the resulting array has length 1 — same shape as before.
          //
          // The relational form `length(>=2)` has its inner `>=` as an
          // OPERATOR token, not a paren-shaped construct, so it doesn't
          // confuse this splitter; it travels in the first arg as the only
          // arg, intact, for B9's relational-predicate sub-grammar parser.
          let parenDepth = 1;
          let bracketDepth = 0;
          let braceDepth = 0;
          let argIdx = scanIdx + 2;
          // Per-arg accumulator + array of all collected args.
          let curArgTexts = [];
          const allArgs = [];
          let lastTok = next;
          while (true) {
            const at = tokens[i + argIdx];
            if (!at || at.kind === "EOF") return null; // unbalanced — decline
            if (at.kind === "PUNCT" && at.text === "(") parenDepth++;
            if (at.kind === "PUNCT" && at.text === ")") {
              parenDepth--;
              if (parenDepth === 0) {
                // Closing paren of the outer call. Flush the current arg
                // (if any) and stop.
                if (curArgTexts.length > 0) {
                  allArgs.push(curArgTexts.join(" ").trim());
                }
                lastTok = at;
                argIdx++;
                break;
              }
            }
            if (at.kind === "PUNCT" && at.text === "[") bracketDepth++;
            else if (at.kind === "PUNCT" && at.text === "]") {
              if (bracketDepth === 0) return null; // malformed — decline
              bracketDepth--;
            }
            else if (at.kind === "PUNCT" && at.text === "{") braceDepth++;
            else if (at.kind === "PUNCT" && at.text === "}") {
              if (braceDepth === 0) return null; // malformed — decline
              braceDepth--;
            }
            // Top-level comma: split arg boundary. parenDepth === 1 means
            // we are inside the outer call's arg list; bracketDepth/
            // braceDepth === 0 means we are not inside a nested array/
            // object literal. (`oneOf([.A, .B])` keeps `.A, .B` together
            // because bracketDepth becomes 1 inside `[`.)
            if (
              at.kind === "PUNCT" && at.text === "," &&
              parenDepth === 1 && bracketDepth === 0 && braceDepth === 0
            ) {
              allArgs.push(curArgTexts.join(" ").trim());
              curArgTexts = [];
              lastTok = at;
              argIdx++;
              continue;
            }
            // STRING tokens have their surrounding quotes stripped by the
            // tokenizer; restore them via JSON.stringify so the joined raw
            // text is parseable as a JS string literal in B9. Mirrors the
            // default-expr collector treatment above (line ~3533). Without
            // this, `pattern("[a-z]+")` would store `[a-z]+` and B9's
            // expression-parser would fail to recognise it as a string lit.
            curArgTexts.push(at.kind === "STRING" ? JSON.stringify(at.text) : at.text);
            lastTok = at;
            argIdx++;
          }
          // Filter out any empty args produced by trailing-comma or
          // adjacent-comma artifacts. Empty paren `f()` already produced
          // an empty `allArgs` (the curArgTexts.length === 0 flush guard
          // skipped). `f(,)` would push two empties — drop them.
          const args = allArgs.filter((s) => s.length > 0);
          validators.push({
            name: validatorName,
            args,
            span: { ...validatorStart, end: lastTok.span.end },
          });
          scanIdx = argIdx;
          continue;
        }
        // Bareword: no args.
        validators.push({
          name: validatorName,
          args: null,
          span: validatorStart,
        });
        scanIdx++;
        continue;
      }

      // Anything else: decline. KEYWORDS (including `is`/`not`), AT_IDENT,
      // PUNCT `}`, `;`, `<`, `:`, NUMBER, STRING, BLOCK_REF — none are valid
      // between IDENT and `>` in a state-decl. The existing dispatch handles
      // these cases (e.g., `<span>hello</span>` falls through to markup-tag).
      return null;
    }
  }

  /**
   * Parse a single statement and return an AST node.
   * Handles: let, const, @reactive, lift, for, if, while, return, bare-expr.
   */
  function parseOneStatement() {
    const tok = peek();

    // BLOCK_REF — embedded child block
    if (tok.kind === "BLOCK_REF") {
      consume();
      const child = tok.block;
      if (child) {
        const childNode = buildBlock(child, filePath, parentBlock.type, counter, errors);
        if (childNode) {
          childNode.span = fullSpan(child.span, filePath);
          // §SQL: collect chained method calls (.run(), .all(), .get()) from parent token stream.
          // Uses the shared helper (defined ~L1910) which accepts both IDENT and KEYWORD method
          // names — `.get()` and `.set()` tokenize as KEYWORD per tokenizer.ts:62.
          // (fix-lift-sql-chained-call-parallel-sites, S40 follow-up.)
          consumeSqlChainedCalls(childNode);
          return childNode;
        }
      }
      return null;
    }

    // LABEL PREFIX: `label: while (...)` or `label: do { ... }` or `label: for (...)`
    // Lookahead: IDENT + PUNCT(":") + KEYWORD(while|do|for) → consume label, continue parsing
    if (tok.kind === "IDENT" && peek(1)?.kind === "PUNCT" && peek(1)?.text === ":" &&
        peek(2)?.kind === "KEYWORD" && (peek(2)?.text === "while" || peek(2)?.text === "do" || peek(2)?.text === "for")) {
      const labelTok = consume();  // consume label identifier
      const labelName = labelTok.text;
      consume();  // consume ":"
      // Now parse the loop statement and attach the label
      const loopNode = parseOneStatement();
      if (loopNode && (loopNode.kind === "while-stmt" || loopNode.kind === "do-while-stmt" || loopNode.kind === "for-stmt")) {
        loopNode.label = labelName;
        return loopNode;
      }
      return loopNode;
    }

    // FAIL: `fail EnumType.Variant(args)` (§19.3)
    if (tok.kind === "KEYWORD" && tok.text === "fail") {
      return parseFailStmt();
    }

    // LET
    if (tok.kind === "KEYWORD" && tok.text === "let") {
      const startTok = consume();
      let name = "";
      // A5 (2026-05-17) — destructuring LHS: `let [a, b] = ...` / `let {a, b} = ...`.
      // parseDestructurePattern consumes through the matching closer; `name`
      // becomes a structured DestructurePattern node (replacing A1's bare-expr
      // re-parsing workaround). The downstream `= expr` path is unchanged.
      if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
        name = parseDestructurePattern();
      } else if (peek().kind === "IDENT") name = consume().text;
      else if (peek().kind === "KEYWORD") name = consume().text;
      const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume();
        // If-as-expression: `let a = if (cond) { lift val }`
        if (peek().kind === "KEYWORD" && peek().text === "if") {
          const ifNode = parseOneIfStmt();
          return { id: ++counter.next, kind: "let-decl", name, init: "", ifExpr: { ...ifNode, kind: "if-expr" }, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // For-as-expression: `let names = for (item of items) { lift item.name }`
        if (peek().kind === "KEYWORD" && peek().text === "for") {
          const forNode = parseOneForStmt();
          return { id: ++counter.next, kind: "let-decl", name, init: "", forExpr: { ...forNode, kind: "for-expr" }, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // Match-as-expression: `let result = match expr { .A => { lift val } }`
        if (peek().kind === "KEYWORD" && (peek().text === "match" || (peek().text === "partial" && peek(1)?.text === "match"))) {
          const matchNode = parseOneMatchAsExpr(startTok);
          return { id: ++counter.next, kind: "let-decl", name, init: "", matchExpr: matchNode, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // v0.2.4 bug-1-anomaly-2: `let x = ?{...}.method()` — when RHS is a SQL
        // BLOCK_REF, build the SQL child via tryConsumeSqlInit and attach as
        // `sqlNode` on the let-decl. emit-logic case "let-decl" routes through
        // case "sql" when sqlNode is present. Mirrors the state-decl sites
        // above (server @, @shared, @x:T, @x). Without this, the BLOCK_REF is
        // captured in the `init` string, then safeParseExprToNode preprocesses
        // it to `__scrml_sql_placeholder__` and emit-expr renders the broken
        // `(slash-star) sql-ref:-1 (star-slash).get()` shape (server fn body
        // postNote → `const user = ?{...}.get()` repro on
        // examples/17-schema-migrations.scrml).
        const _sqlInitLet = tryConsumeSqlInit();
        if (_sqlInitLet) {
          return { id: ++counter.next, kind: "let-decl", name, init: "", sqlNode: _sqlInitLet, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        const { expr, span } = collectExpr();
        // §19.5: `let x = fallible()?` — propagate-expr binding
        const strippedLet = expr.trimEnd();
        if (strippedLet.endsWith("?")) {
          const innerLet = strippedLet.slice(0, -1).trimEnd();
          return {
            id: ++counter.next,
            kind: "propagate-expr",
            binding: name,
            expr: innerLet,
            exprNode: safeParseExprToNode(innerLet, spanOf(startTok, peek())?.start ?? 0),
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          };
        }
        return { id: ++counter.next, kind: "let-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
      } else {
        // S142 gate-tail: `let NAME` with NO `=` is a bare (uninitialized)
        // declaration — `let m` followed by a `while` on the next line. The
        // old `collectExpr()` here ran with an empty `parts` buffer, so its
        // BUG-ASI-NEWLINE statement-boundary heuristic (which only fires once
        // `parts.length > 0`) did not stop it from greedily consuming the
        // following statement as the initializer, emitting `let m = while (...)`
        // (invalid JS the emit gate catches — surfaced via stdlib/compiler/
        // meta-checker.scrml). A declaration with no `=` has no init; emit the
        // bare `let NAME;` directly (no expression collection).
        return { id: ++counter.next, kind: "let-decl", name, init: "", ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
      }
    }

    // CONST — may be `const @name = expr` (legacy expression-form derived,
    // post-Step-11.5 produces state-decl with shape:"derived", isConst:true,
    // structuralForm:false) or `const name = expr` or `const <name> = expr`
    // (Shape 3 V5-strict derived state-decl, A1a Step 2).
    if (tok.kind === "KEYWORD" && tok.text === "const") {
      const startTok = consume();
      // Check for `const @name = expr` or `const @name: T = expr` — legacy
      // expression-form derived reactive value (post-Step-11.5: state-decl,
      // shape:"derived", isConst:true, structuralForm:false). ADR Option A
      // FOLD ratified S60. Per AST-CONTRACTS-AND-DECOMPOSITION §1.1 invariant:
      // shape:"derived" ⇒ isConst === true AND initExpr !== null.
      // S26 bug B: the original branch ignored the optional `:type` annotation;
      // with the type present, the `=` check failed, the parser returned
      // init:"", and emit-logic produced `const name = ;` (invalid JS).
      // Mirror the typed-let/typed-const handling below.
      if (peek().kind === "AT_IDENT") {
        const atTok = consume();
        const derivedName = atTok.text.slice(1); // strip @
        const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume();
          const { expr, span } = collectExpr();
          return { id: ++counter.next, kind: "state-decl", name: derivedName, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), shape: "derived", isConst: true, structuralForm: false, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        } else {
          return { id: ++counter.next, kind: "state-decl", name: derivedName, init: "", shape: "derived", isConst: true, structuralForm: false, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
      }
      // Phase A1a Step 2 — Shape 3 derived: `const <derived> = expr` (V5-strict).
      // Per SPEC §6.6.1, this is the canonical declaration syntax for derived
      // reactive values. Without this hook, `const <doubled> = @count * 2`
      // falls through to the const-decl path with name="" and an empty body
      // (the `<` is unrecognized so the IDENT-collection at line below sees `<`).
      // On match, returns a `kind: "state-decl"` node with `isConst: true`
      // and `structuralForm: true`. Step 4 will populate `shape: "derived"`.
      if (peek().kind === "PUNCT" && peek().text === "<") {
        const declNode = tryParseStructuralDecl(startTok, true);
        if (declNode) return declNode;
        // No match — fall through. Tokens are unconsumed; the const path below
        // will continue with the remaining `<` token (which produces the
        // legacy const-decl with empty name — same behavior as today).
      }
      let name = "";
      // A5 (2026-05-17) — destructuring LHS: `const [a, b] = ...` / `const {a, b} = ...`.
      // parseDestructurePattern returns a structured DestructurePattern node;
      // stored on const-decl.name (replacing A1's bare-expr re-parsing path).
      if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
        name = parseDestructurePattern();
      } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") name = consume().text;
      const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume();
        // If-as-expression: `const a = if (cond) { lift val }`
        if (peek().kind === "KEYWORD" && peek().text === "if") {
          const ifNode = parseOneIfStmt();
          return { id: ++counter.next, kind: "const-decl", name, init: "", ifExpr: { ...ifNode, kind: "if-expr" }, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // For-as-expression: `const names = for (item of items) { lift item.name }`
        if (peek().kind === "KEYWORD" && peek().text === "for") {
          const forNode = parseOneForStmt();
          return { id: ++counter.next, kind: "const-decl", name, init: "", forExpr: { ...forNode, kind: "for-expr" }, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // Match-as-expression: `const result = match expr { .A => { lift val } }`
        if (peek().kind === "KEYWORD" && (peek().text === "match" || (peek().text === "partial" && peek(1)?.text === "match"))) {
          const matchNode = parseOneMatchAsExpr(startTok);
          return { id: ++counter.next, kind: "const-decl", name, init: "", matchExpr: matchNode, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        // v0.2.4 bug-1-anomaly-2: `const x = ?{...}.method()` — see matching
        // let-decl hook above for rationale.
        const _sqlInitConst = tryConsumeSqlInit();
        if (_sqlInitConst) {
          return { id: ++counter.next, kind: "const-decl", name, init: "", sqlNode: _sqlInitConst, ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        }
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "const-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
      } else {
        return { id: ++counter.next, kind: "const-decl", name, init: "", ...(typeAnnotation ? { typeAnnotation } : {}), span: tokenSpan(startTok, filePath) };
      }
    }

    // S79 — `@debounced(N) name = expr` keyword-form parse path RETIRED.
    // The canonical surface is now `<name debounced=Nms> = expr` (SPEC
    // §6.13). Per S78 deep-dive Approach B (clean-cut, no deprecation
    // cycle), this parse path was deleted; `@debounced(N)` source will
    // surface as a generic parse error on the next compile.

    // server MODIFIER: `server @varName = expr` → state-decl with isServer: true (§52.4)
    // Guard: only consume `server` when the next token is AT_IDENT.
    // This ensures `server function` and `server fn` fall through to their own handlers.
    if (tok.kind === "KEYWORD" && tok.text === "server" && peek(1)?.kind === "AT_IDENT") {
      const startTok = consume(); // consume `server`
      const atTok = consume(); // consume `@varName`
      const name = atTok.text.slice(1); // strip @
      // §53: optional type annotation — `server @name: Type(pred) = expr`
      const typeAnnotation = collectTypeAnnotation();
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `server @x = ?{...}.method()`.
        // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          const node = { id: ++counter.next, kind: "state-decl", name, init: "", sqlNode: _sqlInit, isServer: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
          if (typeAnnotation) node.typeAnnotation = typeAnnotation;
          return node;
        }
        const { expr } = collectExpr();
        const node = { id: ++counter.next, kind: "state-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), isServer: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        if (typeAnnotation) node.typeAnnotation = typeAnnotation;
        return node;
      }
      // Malformed — emit as bare-expr
      const { expr } = collectExpr();
      const _be2 = startTok.text + " " + atTok.text + (expr ? " " + expr : "");
      return { id: ++counter.next, kind: "bare-expr", expr: _be2, exprNode: safeParseExprToNode(_be2, 0), span: spanOf(startTok, peek()) };
    }

    // @shared MODIFIER: `@shared varName = expr` → state-decl with isShared: true (§37.4)
    if (tok.kind === "AT_IDENT" && tok.text === "@shared") {
      const startTok = consume(); // consume `@shared`
      // Expect: IDENT or KEYWORD (varName), then =, then expr
      if ((peek().kind === "IDENT" || peek().kind === "KEYWORD") && peek(1)?.text === "=" && peek(2)?.text !== "=") {
        const nameTok = consume(); // consume varName
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `@shared x = ?{...}.method()`.
        // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          return { id: ++counter.next, kind: "state-decl", name: nameTok.text, init: "", sqlNode: _sqlInit, isShared: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        }
        const { expr } = collectExpr();
        return { id: ++counter.next, kind: "state-decl", name: nameTok.text, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), isShared: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
      }
      // Malformed @shared — emit as bare-expr
      const { expr } = collectExpr();
      const _be3 = startTok.text + (expr ? " " + expr : "");
      return { id: ++counter.next, kind: "bare-expr", expr: _be3, exprNode: safeParseExprToNode(_be3, 0), span: spanOf(startTok, peek()) };
    }

    // REACTIVE DECL / NESTED ASSIGN / ARRAY MUTATION: @name...
    if (tok.kind === "AT_IDENT") {
      const startTok = consume();
      const name = tok.text.slice(1);

      // Check for a reactive path: @obj.path.to.prop = value  OR  @arr.push(...)
      // OR (cycles-prereq S168) a bracket-index WRITE @arr[i] = value /
      // @m["DAL"] = value / @obj.field[i].x = value. Bracket-writes route
      // through the same COW (_scrml_deep_set) path as dotted writes.
      if (peek().text === "." || peek().text === "[") {
        // Collect the heterogeneous (.ident | [idx])+ path-segment chain.
        const { segments: pathSegments, reconstruct: pathStr } = collectAtPathSegments();

        // Check for array mutation patterns: @arr.push(...), @arr.splice(...)
        // — only a dotted single-segment (string) method, never a bracket index.
        const ARRAY_MUTATIONS = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
        const lastSeg = pathSegments[pathSegments.length - 1];
        if (pathSegments.length === 1 && typeof lastSeg === "string" && ARRAY_MUTATIONS.includes(lastSeg) && peek().text === "(") {
          // @arr.push(item) → reactive-array-mutation node
          consume(); // consume "("
          const argParts = [];
          let parenDepth = 1;
          while (parenDepth > 0 && peek().kind !== "EOF") {
            const t = consume();
            if (t.text === "(") parenDepth++;
            if (t.text === ")") { parenDepth--; if (parenDepth === 0) break; }
            argParts.push(t.text);
          }
          const _ramArgs = argParts.join(" ").trim();
          return {
            id: ++counter.next,
            kind: "reactive-array-mutation",
            target: name,
            method: lastSeg,
            args: _ramArgs,
            argsExpr: safeParseExprToNode(_ramArgs, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          };
        }

        // Check for nested assignment: @obj.path = value / @arr[i] = value
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume(); // consume "="
          const { expr, span } = collectExpr();
          return {
            id: ++counter.next,
            kind: "reactive-nested-assign",
            target: name,
            path: pathSegments,
            value: expr,
            valueExpr: safeParseExprToNode(expr, 0),
            span: spanOf(startTok, peek()),
          };
        }

        // Not a write — a READ (e.g. @arr[i].foo()) — reconstruct as bare-expr
        // verbatim from the faithful path source-text suffix. Reads are NOT COW'd.
        const { expr, span } = collectExpr();
        const _be4 = startTok.text + pathStr + (expr ? " " + expr : "");
        return { id: ++counter.next, kind: "bare-expr", expr: _be4, exprNode: safeParseExprToNode(_be4, 0), span: spanOf(startTok, peek()) };
      }

      // Type annotation: @name: Type(predicate) = expr  (§53)
      // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
      if (peek().text === ":") {
        const typeAnnotation = collectTypeAnnotation();
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume(); // consume '='
          // fix-cg-cps-return-sql-ref-placeholder: detect `@x: T = ?{...}.method()`.
          const _sqlInit = tryConsumeSqlInit();
          if (_sqlInit) {
            return { id: ++counter.next, kind: "state-decl", name, init: "", sqlNode: _sqlInit, typeAnnotation, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
          }
          const { expr } = collectExpr();
          return { id: ++counter.next, kind: "state-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), typeAnnotation, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        }
        // Malformed — fall through to bare-expr
      }

      // V-kill (S123) — Simple reactive assignment / decl: @name = expr
      //
      // Pre-S123: this branch unconditionally emitted `state-decl`, silently
      // synthesising a phantom cell from every `@name = expr` write. SPEC
      // §6.1.1 + §6.2 normatively require declarations via the structural
      // form `<name>`; the auto-synth path was undocumented, unauthorised, and
      // corrupted the SYM PASS 1 cell-table whenever a later `@x = ...` write
      // followed a prior `<x> = init` decl (Test 5/6 in DD §3).
      //
      // V-kill carve-out (deep-dive 2026-05-23 §6 + Approach-B follow-up):
      //   - Default-logic auto-lift at `<program>` / `<page>` / `<channel>`
      //     body-top (parentBlock._synthetic === true) → STAY legacy state-decl
      //     without the marker. Per §40.8 default-logic mode lifts bare top-
      //     level decls; Option-2 enforcement of bare `@x = expr` here is
      //     Unit CC's territory and explicitly out of V-kill scope.
      //   - Meta `^{...}` body (blockContext "meta") → STAY legacy state-decl
      //     without the marker. BUG-META-6 (dependency-graph.ts:2675) and
      //     meta-checker.ts:710 both treat synth state-decl-in-meta as runtime
      //     @-writes; changing the shape would ripple through DG / meta-eval
      //     / meta-checker.
      //   - User-written `${...}` body OR fn / function body (blockContext
      //     "logic" with parentBlock._synthetic !== true) → emit `state-decl`
      //     tagged with `_isReactiveAssign: true`. SYM PASS 1 uses this flag
      //     to SKIP cell-table registration (no phantom-synth, no clobber).
      //     SYM PASS 3 fires E-STATE-UNDECLARED if `target` does not resolve
      //     to a structurally-declared cell in scope. Downstream codegen
      //     consumers (emit-functions.ts / emit-server.ts / emit-engine.ts /
      //     ...) key off `kind === "state-decl"` AND the C5 `inFunctionBody`
      //     context flag — they correctly treat tagged nodes as reassignments
      //     today and continue to do so.
      //
      // Why mark-not-rename (Approach B vs DD §6 mechanical rename):
      //   The DD §6 prescription assumed `reactive-assign` was already a node
      //   kind. It is not — 73 downstream files reference `kind === "state-
      //   decl"`, and the rename surfaced 111 test failures because codegen
      //   uses state-decl as the canonical wire form for fn-body reassignment
      //   (with C5 `inFunctionBody` flag steering the emit). Approach B
      //   preserves the wire form and the codegen contract, achieving V-kill's
      //   normative intent (no silent phantom-synth + E-STATE-UNDECLARED fires
      //   on bare use) with the minimum surface change. The `ReactiveAssignNode`
      //   type definition is retained in types/ast.ts for future use; the
      //   parser does not currently emit it.
      //
      // Special case: SQL initializer (`@x = ?{...}.method()`) — KEEP the
      // legacy state-decl shape unchanged. The SQL-init pattern is V5-strict
      // valid declaration syntax (mirrors `let _ = ?{}.method()`), flows
      // through the CPS-split pipeline in emit-functions.ts/emit-server.ts
      // which key off `kind === "state-decl"`. Touching it here is outside
      // V-kill scope. (SQL-init nodes are NOT tagged `_isReactiveAssign`.)
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume();
        // fix-cg-cps-return-sql-ref-placeholder: detect `@x = ?{...}.method()`.
        // SQL-init keeps state-decl shape regardless of context.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          return { id: ++counter.next, kind: "state-decl", name, init: "", sqlNode: _sqlInit, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        }
        const { expr, span } = collectExpr();
        // V-kill: tag fn/function/${} body emissions with _isReactiveAssign so
        // SYM PASS 1 SKIPS registration (preventing phantom-synth + clobber)
        // and SYM PASS 3 fires E-STATE-UNDECLARED on undeclared targets.
        //
        // Unit CC (S123 — companion to V-kill): tag default-logic body-top
        // emissions (parentBlock._synthetic === true AND _nestedBlockDepth
        // === 0 — the §40.8 auto-lifted `<program>` / `<page>` / `<channel>`
        // body wrapping, at IMMEDIATE body-top, NOT nested inside a fn /
        // function body or explicit `${...}` block under the wrapper) with
        // `_isUnitCCWrite: true`. Per S122 user-voice Option-2 ratification,
        // §40.8 auto-lift covers DECLARATIONS only (`<x> = 0`,
        // `function f() { }`) — NOT writes (`@x = 5`). Writes are logic;
        // logic goes in `${...}`. SYM PASS 3 fires
        // E-WRITE-NOT-IN-LOGIC-CONTEXT on tagged nodes whose file path is
        // not on the corpus exemption list.
        //
        // Discrimination (mutually exclusive after Unit CC's depth-counter
        // narrowing):
        //   - isAtBodyTopOfSyntheticLift → _isUnitCCWrite (Unit CC fire)
        //   - V-kill region (default-logic-lift carve-out preserved): no tag,
        //     legacy phantom-synth via state-decl registration. This carve-out
        //     keeps V-kill's pre-Unit-CC behavior for nested writes under
        //     synthetic wrappers (e.g., `<program> function f() { @x = 5 }`)
        //     to avoid blast radius on the 110-file unmigrated corpus. The
        //     carve-out is documented as a V-kill follow-up; Unit CC narrows
        //     it ONLY at the IMMEDIATE body-top surface.
        //   - isMetaContext → no tag (BUG-META-6 dependency)
        //   - else (fn / function / user-written ${}) → _isReactiveAssign (V-kill fire)
        const isDefaultLogicLift = parentBlock && parentBlock._synthetic === true;
        const isMetaContext = blockContext === "meta";
        const isAtBodyTopOfSyntheticLift = isDefaultLogicLift && _nestedBlockDepth === 0;
        const isUnitCCWrite = isAtBodyTopOfSyntheticLift;
        // V-kill fire region: preserve original V-kill discrimination
        // (synthetic-wrapper carve-out) to avoid expanding V-kill's surface
        // beyond Unit CC's narrow body-top fire.
        const isReactiveAssign = !isDefaultLogicLift && !isMetaContext;
        return {
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: expr,
          initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
          shape: "plain",
          structuralForm: false,
          isConst: false,
          ...(isReactiveAssign ? { _isReactiveAssign: true } : {}),
          ...(isUnitCCWrite ? { _isUnitCCWrite: true } : {}),
          span: spanOf(startTok, peek()),
        };
      }

      // @set(@obj, "path", value) — explicit escape hatch
      if (name === "set" && peek().text === "(") {
        consume(); // consume "("
        const argParts = [];
        let parenDepth = 1;
        while (parenDepth > 0 && peek().kind !== "EOF") {
          const t = consume();
          if (t.text === "(") parenDepth++;
          if (t.text === ")") { parenDepth--; if (parenDepth === 0) break; }
          argParts.push(t.text);
        }
        const argsStr = argParts.join(" ").trim();
        return {
          id: ++counter.next,
          kind: "reactive-explicit-set",
          args: argsStr,
          argsExpr: safeParseExprToNode(argsStr, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        };
      }

      // Otherwise: bare-expr starting with @name
      const { expr, span } = collectExpr();
      const _be5 = startTok.text + (expr ? " " + expr : "");
      return { id: ++counter.next, kind: "bare-expr", expr: _be5, exprNode: safeParseExprToNode(_be5, 0), span: spanOf(startTok, peek()) };
    }

    // LIFT
    if (tok.kind === "KEYWORD" && tok.text === "lift") {
      const startTok = consume();
      if (peek().kind === "BLOCK_REF") {
        const refTok = consume();
        const child = refTok.block;
        if (child) {
          // Build the child block in its own native context (sql / markup / logic / etc.).
          // Previously hardcoded to "logic" — that worked for the original markup case but
          // suppresses correct context for ?{} SQL blocks. Use parentBlock.type to mirror
          // the pattern in parseOneStatement BLOCK_REF case (line ~1914) and the buildBlock
          // body-loop BLOCK_REF case (line ~3417). The buildBlock dispatch keys off
          // block.type, so the parentContextKind argument is mainly informational here.
          const childNode = buildBlock(child, filePath, parentBlock.type, counter, errors);
          // fix-lift-sql-chained-call (S40): when the BLOCK_REF child is a SQL
          // node, consume any trailing .method() chain and wrap as a SQL
          // lift-expr variant. The previous code wrapped a SQL node as
          // {kind:"markup"} which (a) lied about the payload, (b) caused
          // emit-lift to render an empty <div>, and (c) left the trailing
          // .all()/.get()/.run() chain orphan in the parent token stream.
          if (childNode && childNode.kind === "sql") {
            consumeSqlChainedCalls(childNode);
            return {
              id: ++counter.next,
              kind: "lift-expr",
              expr: { kind: "sql", node: childNode },
              span: spanOf(startTok, peek()),
            };
          }
          return { id: ++counter.next, kind: "lift-expr", expr: { kind: "markup", node: childNode }, span: spanOf(startTok, refTok) };
        }
      }
      // Lift Approach C: inline markup → structured MarkupNode
      if (peek().text === "<" && peek().kind === "PUNCT" && peek(1) && (peek(1).kind === "IDENT" || peek(1).kind === "KEYWORD")) {
        const markupCursor = i;
        const markupNode = parseLiftTag();
        if (markupNode) {
          return { id: ++counter.next, kind: "lift-expr", expr: { kind: "markup", node: markupNode }, span: spanOf(startTok, peek()) };
        }
        // parseLiftTag returned null — reset cursor and fall through to string path
        i = markupCursor;
      }
      // Non-markup lift (identifier, call, etc.) or malformed markup
      const { expr, span } = collectLiftExpr();
      return { id: ++counter.next, kind: "lift-expr", expr: { kind: "expr", expr, exprNode: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0) }, span: spanOf(startTok, peek()) };
    }

    // FOR: `for variable in iterable { body }`
    //   OR JS-style: `for (const x of iterable) { body }`
    if (tok.kind === "KEYWORD" && tok.text === "for") {
      const startTok = consume();
      let variable = "item";
      let iterable;
      if (peek().kind === "PUNCT" && peek().text === "(") {
        // JS-style: for (const|let|var x of|in iterable) or C-style: for (init; cond; update)
        consume(); // consume `(`
        // Detect C-style: look for `;` at paren depth 1 before closing `)`
        let isCStyleFor = false;
        {
          let d = 1;
          for (let la = 0; ; la++) {
            const t = peek(la);
            if (t.kind === "EOF") break;
            if (t.kind === "PUNCT" && (t.text === "(" || t.text === "[" || t.text === "{")) d++;
            if (t.kind === "PUNCT" && (t.text === ")" || t.text === "]" || t.text === "}")) {
              d--;
              if (d === 0) break;
            }
            if (d === 1 && t.kind === "PUNCT" && t.text === ";") { isCStyleFor = true; break; }
          }
        }
        if (isCStyleFor) {
          // C-style for: collect raw tokens from `(` to `)` (inclusive)
          // emitForStmt expects iterable in the form "( init; cond; update )"
          const rawParts = ["("];
          let d = 1;
          while (d > 0 && peek().kind !== "EOF") {
            const t = consume();
            rawParts.push(t.text);
            if (t.kind === "PUNCT" && (t.text === "(" || t.text === "[" || t.text === "{")) d++;
            if (t.kind === "PUNCT" && (t.text === ")" || t.text === "]" || t.text === "}")) d--;
          }
          iterable = rawParts.join(" ");
          variable = null;
        } else {
          // for-of / for-in: for (const|let|var x of|in iterable)
          // skip const/let/var
          if (peek().kind === "KEYWORD" && (peek().text === "const" || peek().text === "let" || peek().text === "var")) {
            consume();
          }
          // A5 (2026-05-17) — destructuring LHS: `for (const [a, b] of xs)` or
          // `for (const {a, b: ren} of xs)`. parseDestructurePattern consumes
          // through the matching closer; the result is stored in `variable`
          // as a structured DestructurePattern node (replacing the synth
          // "item" + iterable-text-preserves-pattern A1 workaround).
          if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
            variable = parseDestructurePattern();
          } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            // variable name
            variable = consume().text;
          }
          // Accept `of` (scrml canonical); reject `in` (JS-reflex).
          if (peek().kind === "KEYWORD" && peek().text === "in") {
            const inTok = peek();
            const varDesc = typeof variable === "string" ? variable : "item";
            errors.push(new TABError(
              "E-CTRL-011",
              "E-CTRL-011: `for (... in ...)` is not supported — scrml uses `for (" + (varDesc || "item") + " of <iterable>)`. " +
              "`in` iterates object keys in JavaScript; scrml iterates values via `of`.",
              tokenSpan(inTok, filePath),
            ));
            consume();
          } else if (peek().kind === "KEYWORD" && peek().text === "of") {
            consume();
          }
          // collect iterable expression up to `)`
          const { expr: iterExpr } = collectExpr(")");
          iterable = iterExpr.trim();
          if (peek().kind === "PUNCT" && peek().text === ")") {
            consume(); // consume `)`
          }
        }
      } else {
        // scrml-style: for variable in iterable
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          variable = consume().text;
        }
        // Consume `in` keyword
        if (peek().kind === "KEYWORD" && peek().text === "in") {
          consume();
        }
        const { expr: iterExpr } = collectExpr("{");
        iterable = iterExpr.trim();
      }
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      // Phase 4: detect C-style for-loop and parse parts individually
      const _cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
      const _cStyleParts = _cStyleMatch ? {
        initExpr: safeParseExprToNode(_cStyleMatch[1].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), 0),
        condExpr: safeParseExprToNode(_cStyleMatch[2].trim(), 0),
        updateExpr: safeParseExprToNode(_cStyleMatch[3].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), 0),
      } : undefined;
      return {
        id: ++counter.next,
        kind: "for-stmt",
        variable,
        iterable,
        body,
        iterExpr: safeParseExprToNode(iterable, 0),
        ...(_cStyleParts && _cStyleParts.initExpr && _cStyleParts.condExpr && _cStyleParts.updateExpr ? { cStyleParts: _cStyleParts } : {}),
        span: spanOf(startTok, peek()),
      };
    }

    // IF
    if (tok.kind === "KEYWORD" && tok.text === "if") {
      return parseOneIfStmt();
    }

    // WHILE: `while condition { body }`
    if (tok.kind === "KEYWORD" && tok.text === "while") {
      const startTok = consume();
      const { expr: condition, span: condSpan } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      return {
        id: ++counter.next,
        kind: "while-stmt",
        condition: condition.trim(),
        body,
        condExpr: safeParseExprToNode(condition.trim(), 0),
        span: spanOf(startTok, peek()),
      };
    }

    // DO-WHILE: `do { body } while (condition);`
    if (tok.kind === "KEYWORD" && tok.text === "do") {
      const startTok = consume(); // consume `do`
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      // consume `while`
      if (peek().kind === "KEYWORD" && peek().text === "while") {
        consume();
      }
      // collect condition — while (condition)
      const { expr: condition } = collectExpr();
      // consume optional trailing semicolon
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      return {
        id: ++counter.next,
        kind: "do-while-stmt",
        condition: condition.trim(),
        body,
        condExpr: safeParseExprToNode(condition.trim(), 0),
        span: spanOf(startTok, peek()),
      };
    }

    // BREAK: `break;` or `break label;`
    if (tok.kind === "KEYWORD" && tok.text === "break") {
      const startTok = consume(); // consume `break`
      let label = null;
      // If next token is an identifier on the same line, it's a label target
      const nextBreak = peek();
      if (nextBreak.kind === "IDENT" && nextBreak.span?.line != null && startTok.span?.line != null && nextBreak.span.line === startTok.span.line) {
        label = consume().text;
      }
      // consume optional trailing semicolon
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      return {
        id: ++counter.next,
        kind: "break-stmt",
        label,
        span: spanOf(startTok, peek()),
      };
    }

    // CONTINUE: `continue;` or `continue label;`
    if (tok.kind === "KEYWORD" && tok.text === "continue") {
      const startTok = consume(); // consume `continue`
      let label = null;
      // If next token is an identifier on the same line, it's a label target
      const nextCont = peek();
      if (nextCont.kind === "IDENT" && nextCont.span?.line != null && startTok.span?.line != null && nextCont.span.line === startTok.span.line) {
        label = consume().text;
      }
      // consume optional trailing semicolon
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      return {
        id: ++counter.next,
        kind: "continue-stmt",
        label,
        span: spanOf(startTok, peek()),
      };
    }

    // RETURN: `return expr;`
    // BUG-AST-RETURN-CONST: If the next non-comment token after `return` is a
    // declaration keyword (const, let, function, fn, type), emit a bare return —
    // the declaration is a separate statement, not the return value.
    if (tok.kind === "KEYWORD" && tok.text === "return") {
      const startTok = consume();
      // Peek past comments to find the real next token
      let lookAhead = 0;
      while (peek(lookAhead).kind === "COMMENT") lookAhead++;
      const next = peek(lookAhead);
      // R24-Bug-31 (S139 / known-gaps Bug 31) — JS ASI for `return`. `return`
      // is a JS-spec "restricted production": a line terminator between `return`
      // and its expression triggers ASI (ECMA-262 §12.9). scrml inherits this:
      // the canonical adopter shape is
      //   if (@cell == 0) return
      //   otherCall(...) !{ ... }
      // — bare `return` on its own line followed by an unrelated statement on the
      // next line. Without this guard, `collectExpr` greedily consumes the next
      // statement as the return expression (the first iteration sees parts.length
      // === 0, so all of collectExpr's BUG-ASI-NEWLINE / STMT_KEYWORD / BLOCK_REF
      // boundary checks are gated off). When the consumed next-statement is a
      // failable call (`call() !{...}`), the parent `parseRecursiveBody` then
      // wraps the resulting return-stmt as a `guarded-expr.guardedNode`, and
      // emit-logic's `case "guarded-expr"` emits
      //   let _scrml_result_N = if (cond) { return fn(); };
      // — `if` is a JS STATEMENT, not an expression, producing a SyntaxError.
      // The fix: if the next non-comment token is on a LATER line than the
      // `return` keyword, emit a bare return — exactly mirroring JS ASI.
      //
      // Token line is read off the `.span.line` shape (tokenizer.ts:106 — tokens
      // here are post-tokenizer with `.span: { line, col, start, end }`, no flat
      // `.line` property). The defensive `!= null` guards span absence; line=0
      // is a valid first-line value so we use null-check, not truthy-check.
      {
        const _retLine = startTok?.span?.line;
        const _nextLine = next?.span?.line;
        if (
          next && next.kind !== "EOF" &&
          _nextLine != null && _retLine != null &&
          _nextLine > _retLine
        ) {
          return {
            id: ++counter.next,
            kind: "return-stmt",
            expr: "",
            span: spanOf(startTok, startTok),
          };
        }
      }
      const RETURN_DECL_KW = new Set(["const", "let", "type", "function", "fn"]);
      if (next && next.kind === "KEYWORD" && RETURN_DECL_KW.has(next.text)) {
        return {
          id: ++counter.next,
          kind: "return-stmt",
          expr: "",
          span: spanOf(startTok, startTok),
        };
      }
      // fix-cg-sql-ref-placeholder (S40 follow-up): `return ?{...}.method()` —
      // when the immediate next non-comment token is a SQL BLOCK_REF, build the
      // child SQL node, consume any trailing .all()/.get()/.run() chain, and
      // attach it as `sqlNode` on the return-stmt. emit-logic case "return-stmt"
      // routes through case "sql" when sqlNode is present. Mirrors the
      // lift-expr SQL fix from `fix-lift-sql-chained-call` (S40).
      // Without this, `safeParseExprToNode` parses `?{...}.all()` → preprocesses
      // `?{}` to `__scrml_sql_placeholder__` → emits `return /* sql-ref:-1 */.all();`.
      if (next && next.kind === "BLOCK_REF" && next.block && next.block.type === "sql") {
        // Skip leading comments (already accounted for by lookAhead) — consume them.
        for (let i = 0; i < lookAhead; i++) consume();
        const refTok = consume(); // consume the BLOCK_REF
        const childNode = buildBlock(refTok.block, filePath, parentBlock.type, counter, errors);
        if (childNode && childNode.kind === "sql") {
          consumeSqlChainedCalls(childNode);
          // Optional trailing semicolon
          if (peek().kind === "PUNCT" && peek().text === ";") consume();
          return {
            id: ++counter.next,
            kind: "return-stmt",
            // raw ?{...} source intentionally NOT stored in `expr` — batch-planner
            // string scanner would otherwise double-count the SQL site (structured walk
            // via sqlNode already counts it once). Empty expr matches the bare-return shape.
            expr: "",
            sqlNode: childNode,
            span: spanOf(startTok, peek()),
          };
        }
        // Defensive: child wasn't SQL — fall through to legacy path.
      }
      // Bug 67 (S157) — match-as-expression at return position:
      //   `return match expr { .A => "a" .B => "b" }`
      // Mirror the let-decl / const-decl match-as-expr hooks (above): build a
      // STRUCTURAL match-expr node (header + body) via parseOneMatchAsExpr and
      // attach it as `matchExpr` so the typer's return-stmt walker can route it
      // through checkMatchDiagnostics (§18.8.1 exhaustiveness — E-TYPE-020).
      // Without this, the value collapses to an ExprNode-form match-expr (the
      // `rawArms: string[]` shape from safeParseExprToNode), which the typer's
      // exhaustiveness path never visits — a missing variant was silently
      // accepted. Codegen routes `return match` through `node.matchExpr` too
      // (emit-logic case "return-stmt" — emitMatchExpr, the shared IIFE form),
      // so the structural node is the single source of truth for both the typer,
      // the linear-analysis walker (E-LIN-003), AND codegen.
      if (peek().kind === "KEYWORD" && (peek().text === "match" || (peek().text === "partial" && peek(1)?.text === "match"))) {
        const matchNode = parseOneMatchAsExpr(startTok);
        return {
          id: ++counter.next,
          kind: "return-stmt",
          expr: "",
          matchExpr: matchNode,
          span: spanOf(startTok, peek()),
        };
      }
      const { expr, span } = collectExpr();
      return {
        id: ++counter.next,
        kind: "return-stmt",
        expr: expr.trim(),
        exprNode: safeParseExprToNode(expr.trim(), 0),
        span: spanOf(startTok, peek()),
      };
    }

    // YIELD: SPEC §37 SSE `server function*` per-event yields + general
    // generator support (SPEC §13 generator carve-out per S114). `yield <expr>`
    // is a statement-position emission of one SSE event when inside a
    // `server function*` body, or a generic generator-yield in any
    // `function*` body.
    //
    // R25-Bug-42 (S138): pre-fix the bare-expr default path saw the `yield`
    // KEYWORD then halted at the trailing BLOCK_REF (`?{...}` or other sigil),
    // emitting `yield` as a standalone bare-expr and the BLOCK_REF as a
    // separate sibling statement. Result: `yield ?{\`...\`}.all()` codegen
    // produced `yield; await _scrml_sql\`...\`;` — generator emitted
    // `undefined` per event, SQL value discarded.
    //
    // Mirrors the `return ?{...}` SQL-aware handler (line ~5500) — when the
    // immediate next non-comment token is a SQL BLOCK_REF, build the child
    // SQL node, consume trailing .method() chain, and attach as `sqlNode` on
    // the yield-stmt. emit-logic `case "yield-stmt"` routes through
    // `case "sql"` when sqlNode is present.
    if (tok.kind === "KEYWORD" && tok.text === "yield") {
      const startTok = consume();
      let lookAhead = 0;
      while (peek(lookAhead).kind === "COMMENT") lookAhead++;
      const next = peek(lookAhead);
      // Bare `yield;` — generator returns undefined to .next() consumer.
      if (!next || next.kind === "EOF" || (next.kind === "PUNCT" && (next.text === ";" || next.text === "}"))) {
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        return {
          id: ++counter.next,
          kind: "yield-stmt",
          expr: "",
          span: spanOf(startTok, peek()),
        };
      }
      // `yield ?{...}.method()` — SQL BLOCK_REF + optional chained call.
      // Attach as structured sqlNode so emit-logic routes through case "sql".
      if (next.kind === "BLOCK_REF" && next.block && next.block.type === "sql") {
        for (let _i = 0; _i < lookAhead; _i++) consume();
        const refTok = consume();
        const childNode = buildBlock(refTok.block, filePath, parentBlock.type, counter, errors);
        if (childNode && childNode.kind === "sql") {
          consumeSqlChainedCalls(childNode);
          if (peek().kind === "PUNCT" && peek().text === ";") consume();
          return {
            id: ++counter.next,
            kind: "yield-stmt",
            // raw `?{...}` source intentionally NOT stored in `expr` — mirrors
            // return-stmt sqlNode shape (empty expr matches the bare-yield shape).
            expr: "",
            sqlNode: childNode,
            span: spanOf(startTok, peek()),
          };
        }
        // Defensive: child wasn't SQL — fall through to legacy expression path.
      }
      // General `yield <expr>` — collect the expression, parse to ExprNode.
      const { expr: yieldExpr } = collectExpr();
      return {
        id: ++counter.next,
        kind: "yield-stmt",
        expr: yieldExpr.trim(),
        exprNode: safeParseExprToNode(yieldExpr.trim(), spanOf(startTok, peek())?.start ?? 0),
        span: spanOf(startTok, peek()),
      };
    }

    // THROW: scrml §19 Appendix B replaces `throw` with `fail`. Reject at parse time.
    if (tok.kind === "KEYWORD" && tok.text === "throw") {
      const startTok = consume();
      const { expr } = collectExpr();
      errors.push(new TABError(
        "E-ERROR-006",
        "E-ERROR-006: `throw` is not a scrml keyword — §19 replaces it with `fail`. " +
        "Declare the enclosing function as failable (`function name(...)! -> ErrorType`) " +
        "and use `fail ErrorType::Variant(...)` to surface the error.",
        tokenSpan(startTok, filePath),
      ));
      return {
        id: ++counter.next,
        kind: "throw-stmt",
        expr: expr.trim(),
        exprNode: safeParseExprToNode(expr.trim(), 0),
        span: spanOf(startTok, peek()),
      };
    }

    // GIVEN: `given ident [, ident]* => { body }` — §42.2.3 presence guard
    // Single: `given x => { body }` — execute body if x is not null/undefined
    // Multi: `given x, y => { body }` — all-or-nothing; body runs only if ALL vars present
    if (tok.kind === "KEYWORD" && tok.text === "given") {
      const startTok = consume(); // consume 'given'
      const variables = [];
      // Collect comma-separated plain identifiers (§42.2.3 v1: no property paths)
      while (peek().kind === "IDENT" || peek().kind === "AT_IDENT") {
        const identTok = consume();
        let name = identTok.text;
        if (name.startsWith("@")) name = name.slice(1); // strip @ if user wrote @x
        // §42.2.3: `given` takes plain identifiers, NOT property paths. Reject `given u.name`.
        if (peek().kind === "PUNCT" && peek().text === ".") {
          errors.push(new TABError(
            "E-SYNTAX-044",
            `E-SYNTAX-044: \`given\` takes bare identifiers, not property paths (§42.2.3). ` +
            `Bind the property to a local variable first: \`let n = ${name}.<field>\`, then \`given n { ... }\`.`,
            tokenSpan(identTok, filePath),
          ));
          while (peek().kind === "PUNCT" && peek().text === ".") {
            consume();
            if (peek().kind === "IDENT" || peek().kind === "KEYWORD") consume();
          }
        }
        variables.push(name);
        if (peek().kind === "PUNCT" && peek().text === ",") {
          consume(); // consume ','
        } else {
          break;
        }
      }
      // consume the separator. `:>` canonical, `=>` deprecated alias
      // (§42.2.3, S148) — both single OPERATOR tokens via tokenizeLogic;
      // isMatchArrow accepts either. Record which glyph the source used so the
      // W-GIVEN-ARROW-LEGACY lint + `migrate --fix` can see the deprecated form
      // (mirrors the match-arm `armArrow` field — S147).
      let separatorGlyph = ":>";
      if (isMatchArrow(peek())) {
        separatorGlyph = peek().text === "=>" ? "=>" : ":>";
        consume(); // consume the arm separator
      }
      // parse body
      let body = [];
      if (peek().kind === "PUNCT" && peek().text === "{") {
        consume(); // consume '{'
        body = parseRecursiveBody();
      }
      return {
        id: ++counter.next,
        kind: "given-guard",
        variables,
        separatorGlyph,
        body,
        span: spanOf(startTok, peek()),
      };
    }

    // PARTIAL MATCH: `partial match expr { arms }` — §18.18
    if (tok.kind === "KEYWORD" && tok.text === "partial" && peek(1).kind === "KEYWORD" && peek(1).text === "match") {
      consume(); // consume 'partial'
      const startTok = consume(); // consume 'match'
      const { expr: header } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      return {
        id: ++counter.next,
        kind: "match-stmt",
        header: header.trim(),
        partial: true,
        body,
        headerExpr: safeParseExprToNode(header.trim(), 0),
        span: spanOf(startTok, peek()),
      };
    }

    // SWITCH / TRY / MATCH — minimal handling: store as structured node with raw body
    if (tok.kind === "KEYWORD" && (tok.text === "switch" || tok.text === "try" || tok.text === "match")) {
      const startTok = consume();
      const keyword = startTok.text;
      // §19 explicitly: "There is NO try/catch." Use `!{}` instead.
      if (keyword === "try") {
        errors.push(new TABError(
          "E-ERROR-007",
          "E-ERROR-007: `try` is not a scrml keyword — §19 has no try/catch/finally. " +
          "Handle failable calls with `!{ ::Variant(e) -> ... }`, the `?` propagation " +
          "operator, or by matching the result enum.",
          tokenSpan(startTok, filePath),
        ));
      }
      // S64 debate-04 verdict A+ #1: switch-stmt stays HARD-ERROR (3-of-3 unanimous).
      if (keyword === "switch") {
        errors.push(new TABError(
          "E-SWITCH-FORBIDDEN",
          "E-SWITCH-FORBIDDEN: `switch` is not a scrml keyword. " +
          "Did you mean: " +
          "`<match for=Type> ... </match>` for structural exhaustive case-analysis " +
          "(Tier 1 block form; produces markup or executes statements per arm), " +
          "or `match expr { .Variant -> ... }` for value-return case-analysis " +
          "(Tier 1 JS-style form; produces a value in expression position)? " +
          "See SPEC §18 for match block-form, primer §1 for the tier ladder.",
          tokenSpan(startTok, filePath),
        ));
      }
      const { expr: header } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      const node = {
        id: ++counter.next,
        kind: `${keyword}-stmt`,
        header: header.trim(),
        body,
        headerExpr: safeParseExprToNode(header.trim(), 0),
        span: spanOf(startTok, peek()),
      };

      // For try statements, look for catch/finally clauses
      if (keyword === "try") {
        if (peek().kind === "KEYWORD" && peek().text === "catch") {
          consume(); // consume "catch"
          const { expr: catchHeader } = collectExpr("{");
          let catchBody = [];
          if (peek().text === "{") {
            consume();
            catchBody = parseRecursiveBody();
          }
          node.catchNode = {
            header: catchHeader.trim(),
            body: catchBody,
          };
        }
        if (peek().kind === "KEYWORD" && peek().text === "finally") {
          consume(); // consume "finally"
          const { expr: finallyHeader } = collectExpr("{");
          let finallyBody = [];
          if (peek().text === "{") {
            consume();
            finallyBody = parseRecursiveBody();
          }
          node.finallyNode = {
            header: finallyHeader.trim(),
            body: finallyBody,
          };
        }
        node.span = spanOf(startTok, peek());
      }

      return node;
    }

    // NESTED FUNCTION DECLARATION inside a function body.
    // The main while (true) loop handles top-level function declarations, but
    // parseRecursiveBody() calls parseOneStatement() -- which must also handle
    // the `function` keyword so that nested functions are parsed recursively
    // rather than falling through to the bare-expr default.
    //
    // S89 §13.2 Sub-Phase B — also accepts `async function` inside function
    // bodies (parity with the top-level shape; same isAsync recording).
    const _nestedAsyncFunctionLookahead = tok.kind === "KEYWORD" && tok.text === "async" &&
      peek(1)?.kind === "KEYWORD" && peek(1)?.text === "function";
    if ((tok.kind === "KEYWORD" && tok.text === "function") || _nestedAsyncFunctionLookahead) {
      let isAsync = false;
      let startTok;
      if (_nestedAsyncFunctionLookahead) {
        isAsync = true;
        startTok = consume(); // consume `async`
        consume(); // consume `function`
      } else {
        startTok = consume(); // consume `function`
      }
      let isGenerator = false;
      if (peek().text === "*") {
        isGenerator = true;
        consume(); // consume `*`
      }
      let name = "";
      let nameTok = null;
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        nameTok = peek();
        name = consume().text;
      }
      // §6.8: `reset` is a reserved identifier — declaring `function reset() {}` shadows the keyword.
      if (nameTok && nameTok.kind === "KEYWORD" && name === "reset") {
        errors.push(new TABError(
          "E-RESERVED-IDENTIFIER",
          `E-RESERVED-IDENTIFIER: \`function reset() {...}\` shadows the reserved \`reset\` keyword (§6.8). Rename the function (e.g., \`clearCount\`) or use \`reset(@cell)\` instead.`,
          tokenSpan(nameTok, filePath),
        ));
      }
      const params = parseParamList();
      let canFail = false;
      if (peek().text === "!") {
        consume(); // consume `!`
        canFail = true;
      }
      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Handles: `: Mario`, `-> string`, `: Array<Thing>`, `: number(>0 && <100)`, etc.
      // A1c C16 — capture the annotation text (returnTypeAnnotation) so the
      // typer/codegen can fire §53.9.3 return-stmt boundary checks for
      // refinement-typed return types.
      // Refinement-type fix (C16): track paren-depth so `>`/`<` inside
      // refinement predicates (e.g. `number(>0)`) don't decrement angleDepth
      // and cause the parser to over-consume into the function body.
      let hasReturnType = false;
      let returnTypeAnnotation = "";
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      } else if (peek().text === "-" && peek(1)?.text === ">") {
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        // Skip the type name(s) until `{`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      }
      let body = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        body = parseRecursiveBody();
      }
      return {
        id: ++counter.next,
        kind: "function-decl",
        name,
        params,
        body,
        fnKind: "function",
        isServer: false,
        // S89 §13.2 Sub-Phase B — async modifier on nested function decls.
        ...(isAsync ? { isAsync: true } : {}),
        isGenerator,
        canFail,
        ...(hasReturnType ? { hasReturnType: true } : {}),
        ...(returnTypeAnnotation ? { returnTypeAnnotation } : {}),
        span: spanOf(startTok, peek()),
      };
    }

    // A6 (S99 2026-05-17) — NESTED `fn` KEYWORD-FORM DECLARATION inside a
    // function body. SPEC §7.3.1 explicitly permits nested fn declarations
    // (inheriting the §48 purity contract). SPEC §48.11: `fn` is the canonical
    // pure form (`pure function` is its deprecated synonym; identical contract).
    //
    // Without this handler, `fn testExpr(expr) { ... }` inside an outer
    // `function bodyUsesCompileTimeApis(body) { ... }` falls through to the
    // bare-expr default, causing collectExpr to emit "statement boundary not
    // detected" and TS-stage E-SCOPE-001 (the `testExpr` name never enters
    // the enclosing function's scope).
    //
    // This mirrors the top-level fn handler at line ~7760, adapted for nested
    // bodies: use `parseRecursiveBody()` (which consumes through the matching
    // `}`) rather than the top-level main-loop pattern. Accepted prefixes:
    //   `fn name(...) { ... }`             — bare nested fn
    //   `async fn name(...) { ... }`       — async nested fn
    //   `server fn name(...) { ... }`      — server nested fn
    //   `async server fn name(...) { ... }` — async server nested fn
    //   `pure fn name(...) { ... }`        — deprecated `pure` (W-PURE-DEPRECATED)
    //   `pure server fn name(...) { ... }` — pure + server nested fn
    //
    // `pure` tokenizes as IDENT (not KEYWORD); detect via text + lookahead.
    // `async` and `server` tokenize as KEYWORDs.
    //
    // E-PARSE-002 (top-level "fn only in logic context") is NOT re-fired here:
    // the enclosing function body is already inside a logic block, which the
    // outer parseLogicBody validated when it produced the parent function-decl.
    //
    // Disambiguation note: the bare `fn` keyword may appear in two roles
    // inside a function body — as a DECLARATION (`fn name(...) { ... }`) or
    // as a parameter-name reference (e.g. `return fn(1)` where the enclosing
    // function has a parameter named `fn`). The lookahead helper below
    // requires the token immediately AFTER the `fn` keyword (after any
    // prefix `pure`/`server`/`async`) to be an IDENT or KEYWORD that names
    // the function. A bare `(` after `fn` indicates a call expression, not a
    // declaration — fall through to the bare-expr path so the call is parsed
    // as an expression-statement.
    //
    // The top-level fn handler does not need this guard because the main
    // while-loop does not encounter `fn(...)` call expressions at statement
    // start — those only arise inside function bodies (the parseOneStatement
    // territory). Bug discovered against test fixture
    // `arrow-object-literal-body.test.js §3` where `function process(fn) {
    // return fn(1) }` placed `fn(1)` at parseOneStatement start (because the
    // return-handler's `RETURN_DECL_KW` heuristic strips the return value
    // when next token is `fn` — a pre-existing semantic gap that is out of
    // scope for A6 but did not produce parse-invalid JS until we added the
    // nested `fn`-decl recognizer).
    const _peekAfterFnPrefix = () => {
      // Walk past `pinned`/`async`/`pure`/`server` prefixes and `fn` to the name position.
      // S98 §48.6.4 (parser-recognition impl S105): `pinned` is the OUTERMOST modifier.
      let off = 0;
      // Optional `pinned` (IDENT — not in tokenizer KEYWORDS).
      if (peek(off)?.kind === "IDENT" && peek(off)?.text === "pinned") off++;
      const t0 = peek(off);
      if (t0?.text === "async" && (t0.kind === "KEYWORD" || t0.kind === "IDENT")) off++;
      else if (t0?.text === "pure" && (t0.kind === "IDENT" || t0.kind === "KEYWORD")) off++;
      // Optional `server` (always a KEYWORD).
      if (peek(off)?.kind === "KEYWORD" && peek(off)?.text === "server") off++;
      // Now the next token should be `fn`. If not, this isn't a fn-decl shape.
      if (!(peek(off)?.kind === "KEYWORD" && peek(off)?.text === "fn")) return null;
      off++;
      return peek(off);
    };
    const _nestedFnAsyncLookahead = tok.kind === "KEYWORD" && tok.text === "async" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    const _nestedFnPureLookahead = tok.kind === "IDENT" && tok.text === "pure" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    const _nestedFnServerLookahead = tok.kind === "KEYWORD" && tok.text === "server" &&
      peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn";
    const _bareNestedFn = tok.kind === "KEYWORD" && tok.text === "fn";
    // S98 §48.6.4 — `pinned fn` (parser-recognition impl S105).
    // `pinned` is IDENT (not in tokenizer KEYWORDS); must precede any other prefix.
    // Reuses `_peekAfterFnPrefix` which now accepts a leading `pinned` IDENT.
    const _nestedFnPinnedLookahead = tok.kind === "IDENT" && tok.text === "pinned" &&
      _peekAfterFnPrefix() !== null;
    // Require the post-`fn` token to be IDENT or KEYWORD (the declaration's name).
    // A `(` indicates `fn(args)` call form — fall through to bare-expr.
    const _afterFnName = (_bareNestedFn || _nestedFnAsyncLookahead ||
      _nestedFnPureLookahead || _nestedFnServerLookahead || _nestedFnPinnedLookahead)
      ? _peekAfterFnPrefix()
      : null;
    const _hasName = _afterFnName && (_afterFnName.kind === "IDENT" || _afterFnName.kind === "KEYWORD");
    if (
      _hasName && (
        _bareNestedFn ||
        _nestedFnAsyncLookahead ||
        _nestedFnPureLookahead ||
        _nestedFnServerLookahead ||
        _nestedFnPinnedLookahead
      )
    ) {
      let isAsync = false;
      let isPure = false;
      let isServer = false;
      let isPinned = false;
      let startTok = tok;

      // S98 §48.6.4 — consume `pinned` first (outermost). startTok stays at `pinned`.
      let dispatchText = tok.text;
      if (_nestedFnPinnedLookahead) {
        isPinned = true;
        consume(); // consume `pinned`
        dispatchText = peek().text;
      }
      if (dispatchText === "async") {
        isAsync = true;
        consume(); // consume `async`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (dispatchText === "pure") {
        isPure = true;
        consume(); // consume `pure`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (dispatchText === "server") {
        isServer = true;
        consume(); // consume `server`
      }
      consume(); // consume `fn`

      let name = "";
      let nameTok = null;
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        nameTok = peek();
        name = consume().text;
      }
      // §6.8: `reset` is a reserved identifier — declaring `fn reset {...}` shadows the keyword.
      if (nameTok && nameTok.kind === "KEYWORD" && name === "reset") {
        errors.push(new TABError(
          "E-RESERVED-IDENTIFIER",
          `E-RESERVED-IDENTIFIER: \`fn reset {...}\` shadows the reserved \`reset\` keyword (§6.8). Rename the function (e.g., \`clearCount\`) or use \`reset(@cell)\` instead.`,
          tokenSpan(nameTok, filePath),
        ));
      }

      // fn may optionally have a param list. parseParamList handles default
      // values (A3) and type annotations (§14).
      let params = [];
      if (peek().text === "(") {
        params = parseParamList();
      }

      // Parse optional `!` (canFail) and `-> ErrorType` after parameter list.
      let canFail = false;
      let errorType = undefined;
      if (peek().text === "!") {
        consume(); // consume `!`
        canFail = true;
        // Parse optional `-> ErrorType`
        if (peek().text === "-" && peek(1)?.text === ">") {
          consume(); // consume `-`
          consume(); // consume `>`
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            errorType = consume().text;
          }
        }
      }

      // §19.9.7 (A9 Ext 5): `.idempotent()` modifier (parity with top-level fn).
      let idempotentModifier = false;
      if (peek().text === "." && peek(1)?.text === "idempotent" &&
          peek(2)?.text === "(" && peek(3)?.text === ")") {
        consume(); consume(); consume(); consume();
        idempotentModifier = true;
      }

      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Refinement-type fix (C16): track paren-depth so `>`/`<` inside refinement
      // predicates (e.g. `number(>0)`) don't decrement angleDepth and over-consume.
      let hasReturnType = false;
      let returnTypeAnnotation = "";
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      } else if (!canFail && peek().text === "-" && peek(1)?.text === ">") {
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      }
      let body = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        body = parseRecursiveBody();
      }

      return {
        id: ++counter.next,
        kind: "function-decl",
        name,
        params,
        body,
        fnKind: "fn",
        isServer,
        ...(isAsync ? { isAsync: true } : {}),
        ...(isPure ? { isPure: true } : {}),
        ...(isPinned ? { isPinned: true } : {}),
        canFail,
        errorType,
        ...(hasReturnType ? { hasReturnType: true } : {}),
        ...(returnTypeAnnotation ? { returnTypeAnnotation } : {}),
        ...(idempotentModifier ? { idempotentModifier: true } : {}),
        span: spanOf(startTok, peek()),
      };
    }

    // LIN-DECL: `lin name = expr` → linear type variable declaration (§35.2)
    // lin is now a KEYWORD. Detect before TILDE-DECL so bare `lin` as KEYWORD doesn't fall through.
    // A bare `lin` not followed by `IDENT =` falls through to bare-expr (unusual back-compat).
    if (tok.kind === "KEYWORD" && tok.text === "lin") {
      const nameTok = peek(1);
      const eqTok = peek(2);
      if (nameTok?.kind === "IDENT" &&
          eqTok?.kind === "PUNCT" && eqTok.text === "=" &&
          peek(3)?.text !== "=") {
        const startTok = consume();          // consume "lin"
        const name = consume().text;         // consume IDENT name
        consume();                           // consume "="
        const { expr } = collectExpr();
        return { id: ++counter.next, kind: "lin-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), span: spanOf(startTok, peek()) };
      }
      // fall through: bare `lin` expression (not a declaration)
    }

    // TILDE-DECL: bare `name = expr` (no keyword) → ~-typed must-use variable
    // Same pattern as let-decl but triggered by IDENT (not a keyword)
    // Exclusions: dotted (obj.prop=), bracket (arr[i]=), augmented (name+=), comparison (name==)
    // All exclusions are automatic: peek(1) won't be PUNCT "=" for those cases.
    if (tok.kind === "IDENT") {
      const nextTok = peek(1);
      if (nextTok && nextTok.kind === "PUNCT" && nextTok.text === "=" && peek(2)?.text !== "=") {
        const startTok = consume(); // consume IDENT (the name)
        const name = startTok.text;
        consume(); // consume `=`
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "tilde-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), span: spanOf(startTok, peek()) };
      }
    }


    // MATCH ARM BLOCK BODY: `. VariantName => { ... }`, `else => { ... }`, `not => { ... }`
    // Parse the block body as structured AST nodes rather than including `{ }` as raw text.
    // This ensures the component expander can process lift-expr nodes inside match arm blocks
    // (e.g., `lift <InfoStep>` inside `.Info => { lift <InfoStep> }`).
    //
    // Form 1: `. VariantName :> {` — enum variant arm with block body
    // (`:>` canonical; `=>`/`->` deprecated aliases — §18.2.)
    {
      const _arrow1 = (tok.kind === 'PUNCT' && tok.text === '.' &&
        peek(1) && peek(1).kind === 'IDENT' && /^[A-Z]/.test(peek(1).text))
        ? matchArrowGlyphAt(peek, 2) : null;
      if (_arrow1 && peek(2 + _arrow1.len) && peek(2 + _arrow1.len).kind === 'PUNCT' && peek(2 + _arrow1.len).text === '{') {
        const startTok = tok;
        consume(); // '.'
        const variantNameTok = consume(); // IDENT (PascalCase variant name)
        for (let _a = 0; _a < _arrow1.len; _a++) consume(); // arm arrow
        consume(); // '{'
        const blockBody = parseRecursiveBody(); // parse until matching '}'
        return {
          id: ++counter.next,
          kind: 'match-arm-block',
          variant: variantNameTok.text,
          payloadBindings: [],
          isWildcard: false,
          armArrow: _arrow1.glyph,
          body: blockBody,
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Form 1b: `. VariantName(binding, ...) => {` — payload-destructure arm
    // with block body. Captures comma-separated binding names so the type-
    // system can bind them into the arm body's scope (otherwise references
    // like `n` inside the body fire E-SCOPE-001).
    if (tok.kind === 'PUNCT' && tok.text === '.' &&
        peek(1) && peek(1).kind === 'IDENT' && /^[A-Z]/.test(peek(1).text) &&
        peek(2) && peek(2).kind === 'PUNCT' && peek(2).text === '(') {
      // Lookahead to find the matching `)` then check for `=> {`.
      let i = 3;
      let depth = 1;
      while (peek(i) && depth > 0) {
        const t = peek(i);
        if (t.kind === 'PUNCT' && t.text === '(') depth++;
        else if (t.kind === 'PUNCT' && t.text === ')') depth--;
        if (depth === 0) break;
        i++;
      }
      const _arrow1b = (peek(i) && peek(i).kind === 'PUNCT' && peek(i).text === ')')
        ? matchArrowGlyphAt(peek, i + 1) : null;
      if (_arrow1b &&
          peek(i + 1 + _arrow1b.len) && peek(i + 1 + _arrow1b.len).kind === 'PUNCT' && peek(i + 1 + _arrow1b.len).text === '{') {
        const startTok = tok;
        consume(); // '.'
        const variantNameTok = consume(); // IDENT (PascalCase variant name)
        consume(); // '('
        // Collect binding names by walking tokens until matching `)`.
        // Per SPEC §18.7 there are two payload-binding forms:
        //   - Positional: `.V(localName)` — the FIRST ident is the binding name.
        //   - Named:      `.V(fieldName: localName)` — the binding name is
        //                  the ident AFTER the `:` (the LOCAL), not the
        //                  field name BEFORE the `:`. SPEC §18.7 worked
        //                  example: `.Rectangle(height: h, width: w) => w * h`
        //                  binds `h` and `w` (locals), not `height`/`width`.
        // The strategy: per top-level comma-separated segment, look at the
        // first two non-whitespace tokens; if pattern is `IDENT :`, the
        // binding name is the IDENT following the `:`. Otherwise, the
        // FIRST IDENT in the segment is the binding name. Type annotations
        // (`localName: type`) are out of scope here — the typer infers
        // payload field types from the variant declaration.
        const payloadBindings = [];
        let bdepth = 1;
        // Buffer of tokens for the current comma-separated segment, plus
        // a flat list of all paren-interior tokens (used to reconstruct
        // the raw `binding` text for codegen via parseBindingList).
        let segmentTokens = [];
        const allBindingTokens = [];
        const finalizeSegment = () => {
          if (segmentTokens.length === 0) return;
          // Detect named form `IDENT : ...` — the binding name comes AFTER
          // the colon. Otherwise the FIRST IDENT is the binding name.
          if (
            segmentTokens.length >= 3 &&
            segmentTokens[0].kind === 'IDENT' &&
            segmentTokens[1].kind === 'PUNCT' && segmentTokens[1].text === ':'
          ) {
            // Named binding — find the first IDENT after the `:`.
            for (let k = 2; k < segmentTokens.length; k++) {
              const tk = segmentTokens[k];
              if (tk.kind === 'IDENT' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tk.text)) {
                payloadBindings.push(tk.text);
                break;
              }
            }
          } else if (segmentTokens.length === 1 && segmentTokens[0].kind === 'IDENT' &&
                     segmentTokens[0].text === '_') {
            // Positional discard — `_`. Preserved as a binding so codegen
            // emits no `const` line (parseBindingList treats `_` as discard).
            payloadBindings.push('_');
          } else {
            // Positional — first IDENT in the segment is the binding name.
            // Type annotations (`local: type`) take only the leading ident.
            for (const tk of segmentTokens) {
              if (tk.kind === 'IDENT' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tk.text)) {
                payloadBindings.push(tk.text);
                break;
              }
            }
          }
          segmentTokens = [];
        };
        while (peek() && bdepth > 0) {
          const t = peek();
          if (t.kind === 'PUNCT' && t.text === '(') {
            bdepth++;
            segmentTokens.push(t);
            allBindingTokens.push(t);
          } else if (t.kind === 'PUNCT' && t.text === ')') {
            bdepth--;
            if (bdepth === 0) break;
            segmentTokens.push(t);
            allBindingTokens.push(t);
          } else if (bdepth === 1 && t.kind === 'PUNCT' && t.text === ',') {
            // Top-level comma — end the current segment.
            finalizeSegment();
            allBindingTokens.push(t);
          } else {
            segmentTokens.push(t);
            allBindingTokens.push(t);
          }
          consume();
        }
        // Flush the last segment (no trailing comma).
        finalizeSegment();
        consume(); // ')'
        for (let _a = 0; _a < _arrow1b.len; _a++) consume(); // arm arrow
        consume(); // '{'
        // Reconstruct the raw paren-interior text so codegen's
        // `parseBindingList` (in emit-control-flow.ts) can resolve named
        // bindings (`field: local` → `const local = subject.data.field`).
        const bindingText = allBindingTokens.map(t => t.text).join(' ').replace(/\s+/g, ' ').trim();
        const blockBody = parseRecursiveBody();
        return {
          id: ++counter.next,
          kind: 'match-arm-block',
          variant: variantNameTok.text,
          payloadBindings,
          // `binding`: raw paren contents in the same shape as the inline
          // form's `binding` field — consumed by codegen's parseBindingList
          // to emit `const localName = subject.data.fieldName;` preludes.
          binding: bindingText.length > 0 ? bindingText : null,
          isWildcard: false,
          armArrow: _arrow1b.glyph,
          body: blockBody,
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Form 2: `else :> {` — wildcard arm with block body
    {
      const _arrow2 = (tok.kind === 'KEYWORD' && tok.text === 'else')
        ? matchArrowGlyphAt(peek, 1) : null;
      if (_arrow2 && peek(1 + _arrow2.len) && peek(1 + _arrow2.len).kind === 'PUNCT' && peek(1 + _arrow2.len).text === '{') {
        const startTok = tok;
        consume(); // 'else'
        for (let _a = 0; _a < _arrow2.len; _a++) consume(); // arm arrow
        consume(); // '{'
        const blockBody = parseRecursiveBody();
        return {
          id: ++counter.next,
          kind: 'match-arm-block',
          variant: null,
          isWildcard: true,
          armArrow: _arrow2.glyph,
          body: blockBody,
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Form 3: `not :> {` — absence arm with block body (§42)
    {
      const _arrow3 = (tok.kind === 'KEYWORD' && tok.text === 'not')
        ? matchArrowGlyphAt(peek, 1) : null;
      if (_arrow3 && peek(1 + _arrow3.len) && peek(1 + _arrow3.len).kind === 'PUNCT' && peek(1 + _arrow3.len).text === '{') {
        const startTok = tok;
        consume(); // 'not'
        for (let _a = 0; _a < _arrow3.len; _a++) consume(); // arm arrow
        consume(); // '{'
        const blockBody = parseRecursiveBody();
        return {
          id: ++counter.next,
          kind: 'match-arm-block',
          variant: '__not__',
          isWildcard: false,
          isNotArm: true,
          armArrow: _arrow3.glyph,
          body: blockBody,
          span: spanOf(startTok, peek()),
        };
      }
    }

    // MATCH ARM INLINE: `. VariantName => result`, `else => result`, `not => result`
    // Produce structured `match-arm-inline` nodes instead of falling through to bare-expr.
    // Block arms (with `{` after arrow) are already handled above as match-arm-block.
    // Inline arms are single-expression arms where the result is collected via collectExpr.
    //
    // Inline Form 1: `. VariantName => result` or `. VariantName(binding) => result`
    //                 `:: VariantName => result` (legacy double-colon prefix)
    if ((tok.kind === 'PUNCT' && tok.text === '.') || (tok.kind === 'OPERATOR' && tok.text === '::')) {
      const prefix = tok.text;
      const t1 = peek(1);
      if (t1 && t1.kind === 'IDENT' && /^[A-Z]/.test(t1.text)) {
        // Scan forward past optional payload binding `(...)`
        let arrowIdx = 2;
        let bindingText = null;
        if (peek(arrowIdx)?.text === '(') {
          const parenStart = arrowIdx;
          let d = 1;
          arrowIdx++;
          while (arrowIdx < 40 && d > 0) {
            const tk = peek(arrowIdx);
            if (!tk || tk.kind === 'EOF') break;
            if (tk.text === '(') d++;
            else if (tk.text === ')') d--;
            arrowIdx++;
          }
          // Extract binding text from inside the parens
          if (d === 0) {
            const innerTokens = [];
            for (let j = parenStart + 1; j < arrowIdx - 1; j++) {
              innerTokens.push(peek(j)?.text ?? '');
            }
            bindingText = innerTokens.join(' ').replace(/\s+/g, ' ').trim() || null;
          }
        }
        const _arrowI1 = matchArrowGlyphAt(peek, arrowIdx);
        if (_arrowI1) {
          const afterArrow = peek(arrowIdx + _arrowI1.len);
          // Only match inline arms (no `{` after arrow — block arms handled above)
          if (!afterArrow || afterArrow.text !== '{') {
            const startTok = consume(); // consume '.' or '::'
            const variantNameTok = consume(); // consume IDENT
            const testStr = prefix + variantNameTok.text + (bindingText != null ? '(' + bindingText + ')' : '');
            // Consume optional payload `(...)`
            if (peek().text === '(') {
              consume(); // '('
              while (!(peek().kind === 'PUNCT' && peek().text === ')') && peek().kind !== 'EOF') consume();
              if (peek().text === ')') consume(); // ')'
            }
            for (let _a = 0; _a < _arrowI1.len; _a++) consume(); // arm arrow
            const { expr: result } = collectExpr();
            const trimmedResult = result.trim();
            return {
              id: ++counter.next,
              kind: 'match-arm-inline',
              test: testStr,
              binding: bindingText ?? undefined,
              armArrow: _arrowI1.glyph,
              result: trimmedResult,
              resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
              span: spanOf(startTok, peek()),
            };
          }
        }
      }
    }

    // Inline Form 2: `else :> result` — wildcard arm without block body
    {
      const _arrowI2 = (tok.kind === 'KEYWORD' && tok.text === 'else')
        ? matchArrowGlyphAt(peek, 1) : null;
      if (_arrowI2) {
        const afterArrow = peek(1 + _arrowI2.len);
        if (!afterArrow || afterArrow.text !== '{') {
          const startTok = consume(); // consume 'else'
          for (let _a = 0; _a < _arrowI2.len; _a++) consume(); // arm arrow
          const { expr: result } = collectExpr();
          const trimmedResult = result.trim();
          return {
            id: ++counter.next,
            kind: 'match-arm-inline',
            test: 'else',
            armArrow: _arrowI2.glyph,
            result: trimmedResult,
            resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          };
        }
      }
    }

    // Inline Form 3: `not :> result` — absence arm without block body
    {
      const _arrowI3 = (tok.kind === 'KEYWORD' && tok.text === 'not')
        ? matchArrowGlyphAt(peek, 1) : null;
      if (_arrowI3) {
        const afterArrow = peek(1 + _arrowI3.len);
        if (!afterArrow || afterArrow.text !== '{') {
          const startTok = consume(); // consume 'not'
          for (let _a = 0; _a < _arrowI3.len; _a++) consume(); // arm arrow
          const { expr: result } = collectExpr();
          const trimmedResult = result.trim();
          return {
            id: ++counter.next,
            kind: 'match-arm-inline',
            test: 'not',
            armArrow: _arrowI3.glyph,
            result: trimmedResult,
            resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          };
        }
      }
    }

    // Inline Form 4: `_ :> result` — wildcard alias (legacy)
    {
      const _arrowI4 = (tok.kind === 'IDENT' && tok.text === '_')
        ? matchArrowGlyphAt(peek, 1) : null;
      if (_arrowI4) {
        const afterArrow = peek(1 + _arrowI4.len);
        if (!afterArrow || afterArrow.text !== '{') {
          const startTok = consume(); // consume '_'
          for (let _a = 0; _a < _arrowI4.len; _a++) consume(); // arm arrow
          const { expr: result } = collectExpr();
          const trimmedResult = result.trim();
          return {
            id: ++counter.next,
            kind: 'match-arm-inline',
            test: 'else', // normalize _ to else
            armArrow: _arrowI4.glyph,
            result: trimmedResult,
            resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          };
        }
      }
    }

    // Inline Form 5: `"string" :> result` or `'string' :> result` — string literal arm
    if (tok.kind === 'STRING') {
      const _arrowI5 = matchArrowGlyphAt(peek, 1);
      if (_arrowI5) {
        const afterArrow = peek(1 + _arrowI5.len);
        if (!afterArrow || afterArrow.text !== '{') {
          const startTok = consume(); // consume string literal
          // STRING tokens have their delimiters stripped by the tokenizer.
          // Reconstruct the quoted form for the test field. Use double quotes
          // unless the content contains unescaped double quotes.
          const rawText = startTok.text;
          const testStr = rawText.includes('"') && !rawText.includes("'")
            ? `'${rawText}'`
            : `"${rawText}"`;
          for (let _a = 0; _a < _arrowI5.len; _a++) consume(); // arm arrow
          const { expr: result } = collectExpr();
          const trimmedResult = result.trim();
          return {
            id: ++counter.next,
            kind: 'match-arm-inline',
            test: testStr,
            armArrow: _arrowI5.glyph,
            result: trimmedResult,
            resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          };
        }
      }
    }

    // E-SYNTAX-043: Detect old `(x) =>` presence guard syntax (§42.2.3)
    // The old form `(x) => { body }` is removed; use `given x => { body }` instead.
    if (isOldPresenceGuardPattern()) {
      const guardStart = peek();
      // Consume the entire `( IDENT [, IDENT]* ) =>` header
      consume(); // consume `(`
      while (!(peek().kind === "PUNCT" && peek().text === ")") && peek().kind !== "EOF") consume();
      if (peek().kind === "PUNCT" && peek().text === ")") consume(); // consume `)`
      if (isMatchArrow(peek())) consume(); // consume `=>`
      // Drain the body `{ ... }` if present, to prevent cascade errors
      if (peek().kind === "PUNCT" && peek().text === "{") {
        consume(); // consume `{`
        collectBracedBody(); // drain body tokens
      }
      errors.push(new TABError(
        "E-SYNTAX-043",
        `E-SYNTAX-043: \`(x) =>\` presence guard syntax is no longer valid. ` +
        `Use \`given x => { ... }\` instead. ` +
        `The old \`(x) =>\` form was removed when the \`given\` keyword was introduced (§42.2.3).`,
        tokenSpan(guardStart, filePath),
      ));
      return null;
    }

    // §6.7.1a: ON MOUNT — `on mount { body }` desugars to bare-expr (§6.7.1a)
    // 'on' and 'mount' are both IDENTs (not keywords), so check by text.
    if (tok.kind === "IDENT" && tok.text === "on" &&
        peek(1)?.kind === "IDENT" && peek(1)?.text === "mount" &&
        peek(2)?.text === "{") {
      const startTok = consume(); // consume 'on'
      consume();                  // consume 'mount'
      consume();                  // consume '{'
      const { body, span: bodySpan } = collectBracedBody();
      return { id: ++counter.next, kind: "bare-expr", expr: body, exprNode: safeParseExprToNode(body, 0), span: spanOf(startTok, peek()) };
    }

    // §6.7.1b: ON DISMOUNT — `on dismount { body }` desugars to cleanup(() => { body })
    if (tok.kind === "IDENT" && tok.text === "on" &&
        peek(1)?.kind === "IDENT" && peek(1)?.text === "dismount" &&
        peek(2)?.text === "{") {
      const startTok = consume(); // consume 'on'
      consume();                  // consume 'dismount'
      consume();                  // consume '{'
      const { body, span: bodySpan } = collectBracedBody();
      const _dm1 = `cleanup(() => { ${body} })`;
      return { id: ++counter.next, kind: "bare-expr", expr: _dm1, exprNode: safeParseExprToNode(_dm1, 0), span: spanOf(startTok, peek()) };
    }

    // Phase A1a Step 2 — V5-strict structural state-decl: `<NAME> = expr` (Shape 1).
    // Recognized at expression-statement-start position. Without this hook,
    // `<count> = 0` is silently swallowed as `kind: "html-fragment"` raw text
    // (PARSER-AUDIT §F1c — the deceptive-success pattern). On match, returns
    // a `kind: "state-decl"` node with `structuralForm: true`. On no-match,
    // tokens are unconsumed and execution falls through to the default branch.
    if (tok.kind === "PUNCT" && tok.text === "<") {
      const declNode = tryParseStructuralDecl(tok, false);
      if (declNode) return declNode;
    }

    // Default: bare-expr (or html-fragment for HTML tokens)
    {
      const startTok = peek();
      const { expr, span } = collectExpr();
      if (expr.trim().length > 0) {
        // §19.5: `fallible()?` as a statement — propagate-expr with no binding
        const strippedBare = expr.trimEnd();
        if (strippedBare.endsWith("?")) {
          const innerBare = strippedBare.slice(0, -1).trimEnd();
          return {
            id: ++counter.next,
            kind: "propagate-expr",
            binding: null,
            expr: innerBare,
            exprNode: safeParseExprToNode(innerBare, 0),
            span,
          };
        }
        if (isHtmlFragment(expr)) {
          // §4.15 — Structural-element misplacement in `${...}` logic-body context.
          // The leading tag opener is a scrml-defined structural element (one of
          // schema/engine/channel/page/auth/errors/onTransition/onTimeout/onIdle/match).
          // Without this gate the entire run is silently swallowed as html-fragment
          // raw text and the structural intent disappears from the output. Fire
          // E-STRUCTURAL-ELEMENT-MISPLACED (§34 reuse — "used outside its owning
          // locus"). The html-fragment node is still returned so the AST shape
          // stays stable; the error carries the diagnostic.
          const _seName = leadingTagName(expr);
          if (_seName && Object.prototype.hasOwnProperty.call(STRUCTURAL_ELEMENT_PLACEMENT, _seName)) {
            errors.push(new TABError(
              "E-STRUCTURAL-ELEMENT-MISPLACED",
              `E-STRUCTURAL-ELEMENT-MISPLACED: \`<${_seName}>\` cannot appear inside a \`\${ }\` logic body — ${STRUCTURAL_ELEMENT_PLACEMENT[_seName]}. ` +
              `(§4.15 — scrml-defined structural elements are grammatical only in their owning loci; ` +
              `use outside the owning locus is E-STRUCTURAL-ELEMENT-MISPLACED.)`,
              span,
            ));
          }
          return { id: ++counter.next, kind: "html-fragment", content: expr, span };
        }
        return { id: ++counter.next, kind: "bare-expr", expr, exprNode: safeParseExprToNode(expr, 0), span };
      } else {
        const stuckTok = peek();
        if (stuckTok.kind !== "EOF") {
          const stuckSpan = tokenSpan(stuckTok, filePath);
          if (blockContext === "meta") {
            errors.push(new TABError(
              "E-META-002",
              `E-META-002: \`${stuckTok.text}\` is not valid inside a \`^{ }\` meta block. ` +
              `Meta blocks contain logic code, not direct markup. ` +
              `If you intended to emit markup here, use a \`lift\` expression: \`lift <tag>...</tag>\`.`,
              stuckSpan,
            ));
          } else {
            errors.push(new TABError(
              "E-PARSE-001",
              `E-PARSE-001: \`${stuckTok.text}\` is not valid here. ` +
              `Expected a tag name, expression, or block opener (\`\${}\`/\`#{}\`/\`?{}\`/\`^{}\`). ` +
              `Inside a \`\${ }\` logic block, the compiler expects a statement, a \`let\`/\`const\` declaration, an expression, or a \`lift\`. ` +
              `Check that any surrounding expression is complete and all brackets are balanced.`,
              stuckSpan,
            ));
          }
          consume();
        }
        return null;
      }
    }
  }

  /**
   * Parse an if/else-if/else chain into a structured AST node.
   * Returns { kind: "if-stmt", condition, consequent, alternate }
   */
  /**
   * Collect an if-statement condition.
   *
   * When the condition is paren-wrapped `(...)`, consume EXACTLY the balanced parens
   * (ignoring STMT_KEYWORD boundaries inside the parens). This prevents braceless-if
   * bodies from being absorbed into the condition by the STMT_KEYWORDS/ASI-NEWLINE rules.
   *
   * Falls back to `collectExpr("{")` for non-paren conditions.
   */
  function collectIfCondition() {
    if (peek().text !== "(") {
      return collectExpr("{");
    }
    const parts = [];
    const partLines = [];
    const startTok = peek();
    let lastTok = startTok;
    let depth = 0;

    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      if (tok.kind === "COMMENT") { consume(); continue; }
      // Track depth for all bracket types
      if (tok.kind === "PUNCT" && (tok.text === "(" || tok.text === "[" || tok.text === "{")) depth++;
      if (tok.kind === "PUNCT" && (tok.text === ")" || tok.text === "]" || tok.text === "}")) {
        if (depth === 0) break; // unmatched closer — stop
        depth--;
      }
      lastTok = consume();
      // Re-quote STRING tokens so their delimiters are preserved in the expression
      if (lastTok.kind === "STRING") {
        // A4: preserve backtick templates so `${...}` interpolations

        // remain template-literal interpolations after re-parsing.

        if (lastTok.isTemplate) {

          parts.push('`' + lastTok.text + '`');

        } else {

          parts.push(reemitJsStringLiteral(lastTok.text));

        }
      } else {
        parts.push(lastTok.text);
      }
      partLines.push(lastTok.span?.line ?? 0);
      // After closing the outermost `(`, stop
      if (depth === 0 && parts.length > 0) break;
    }
    return {
      expr: joinWithNewlines(parts, partLines),
      span: parts.length > 0 ? spanOf(startTok, lastTok) : spanOf(startTok, startTok),
    };
  }

  function parseOneIfStmt() {
    const startTok = consume(); // consume `if`
    const { expr: condition } = collectIfCondition();
    let consequent = [];
    if (peek().text === "{") {
      consume();
      consequent = parseRecursiveBody();
    } else if (peek().kind !== "EOF" && !(peek().kind === "PUNCT" && (peek().text === "}" || peek().text === ";"))) {
      // Braceless single-statement if-body: `if (cond) stmt`
      const singleStmt = parseOneStatement();
      if (singleStmt) consequent = [singleStmt];
    }
    let alternate = null;
    // Check for else / else if
    if (peek().kind === "KEYWORD" && peek().text === "else") {
      consume(); // consume `else`
      if (peek().kind === "KEYWORD" && peek().text === "if") {
        // else if → recursive
        alternate = [parseOneIfStmt()];
      } else if (peek().text === "{") {
        consume();
        alternate = parseRecursiveBody();
      }
    }
    return {
      id: ++counter.next,
      kind: "if-stmt",
      condition: condition.trim(),
      consequent,
      alternate,
      condExpr: safeParseExprToNode(condition.trim(), 0),
      span: spanOf(startTok, peek()),
    };
  }

  /**
   * A5 (2026-05-17) — Parse a destructuring pattern from the token stream.
   *
   * Assumes the next token is PUNCT `[` (array pattern) or PUNCT `{` (object
   * pattern). Returns a structured DestructurePattern AST node and consumes
   * all tokens through the matching closer (`]` / `}`).
   *
   * Replaces A1's regex-based `extractDestructuredNames` in type-system.ts.
   * The structural form is recursive: nested patterns inside elements/
   * properties are parsed via the same routine.
   *
   * Grammar:
   *   ArrayPattern   ::= '[' ArrayElement (',' ArrayElement)* (',' '...' IDENT)? ']'
   *   ArrayElement   ::= /(empty: hole)/ | IDENT ('=' DefaultExpr)?
   *                    | DestructurePattern ('=' DefaultExpr)?
   *   ObjectPattern  ::= '{' ObjectProp (',' ObjectProp)* (',' '...' IDENT)? '}'
   *   ObjectProp     ::= IDENT (':' (IDENT | DestructurePattern))? ('=' DefaultExpr)?
   *
   * DefaultExpr is the raw token text between `=` and the next top-level
   * comma / closer; preserved as a string and parsed via safeParseExprToNode.
   */
  function parseDestructurePattern() {
    const startTok = peek();
    if (startTok.kind !== 'PUNCT' || (startTok.text !== '[' && startTok.text !== '{')) {
      return null;
    }
    const isArray = startTok.text === '[';
    consume(); // consume opener

    /** Collect token text up to a top-level `,` or the matching pattern closer.
     *  Returns the raw string; leaves the terminator unconsumed.
     */
    function collectDefaultText(closeText) {
      const buf = [];
      let d = 0;
      while (true) {
        const t = peek();
        if (t.kind === 'EOF') break;
        if (d === 0 && t.kind === 'PUNCT' && (t.text === ',' || t.text === closeText)) {
          break;
        }
        if (t.kind === 'PUNCT' && (t.text === '(' || t.text === '[' || t.text === '{')) d++;
        else if (t.kind === 'PUNCT' && (t.text === ')' || t.text === ']' || t.text === '}')) d--;
        buf.push(consume().text);
      }
      return buf.join(' ').trim();
    }

    if (isArray) {
      const elements = [];
      let rest;
      // Empty array `[]` short-circuit.
      if (peek().kind === 'PUNCT' && peek().text === ']') {
        consume();
        return { kind: 'destructure-array', elements, ...(rest ? { rest } : {}), span: spanOf(startTok, peek()) };
      }
      while (true) {
        // Hole: a top-level `,` with no preceding element.
        if (peek().kind === 'PUNCT' && peek().text === ',') {
          elements.push({ kind: 'hole' });
          consume(); // consume `,`
          continue;
        }
        // Rest: `...name`. Tokenizer emits `...` as a single OPERATOR token,
        // but defensively accept the three-dot PUNCT fallback (in case of
        // tokenizer drift).
        if (peek().kind === 'OPERATOR' && peek().text === '...') {
          consume(); // consume `...`
          if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
            rest = consume().text;
          }
          break; // rest must be last
        }
        if (peek().kind === 'PUNCT' && peek().text === '.' &&
            peek(1)?.kind === 'PUNCT' && peek(1).text === '.' &&
            peek(2)?.kind === 'PUNCT' && peek(2).text === '.') {
          consume(); consume(); consume(); // consume `...`
          if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
            rest = consume().text;
          }
          break; // rest must be last
        }
        // Nested pattern.
        if (peek().kind === 'PUNCT' && (peek().text === '[' || peek().text === '{')) {
          const pattern = parseDestructurePattern();
          let def, defExpr;
          if (peek().text === '=' && peek(1)?.text !== '=') {
            consume();
            def = collectDefaultText(']');
            if (def) defExpr = safeParseExprToNode(def, 0);
          }
          elements.push({ kind: 'nested', pattern, ...(def ? { default: def } : {}), ...(defExpr ? { defaultExpr: defExpr } : {}) });
        } else if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
          const nameTok = consume();
          let def, defExpr;
          if (peek().text === '=' && peek(1)?.text !== '=') {
            consume();
            def = collectDefaultText(']');
            if (def) defExpr = safeParseExprToNode(def, 0);
          }
          elements.push({ kind: 'name', name: nameTok.text, ...(def ? { default: def } : {}), ...(defExpr ? { defaultExpr: defExpr } : {}) });
        } else {
          // Unexpected token — bail out by consuming it to avoid infinite loop.
          consume();
        }
        if (peek().kind === 'PUNCT' && peek().text === ',') {
          consume();
          continue;
        }
        break;
      }
      if (peek().kind === 'PUNCT' && peek().text === ']') {
        consume(); // consume `]`
      }
      const node = { kind: 'destructure-array', elements, span: spanOf(startTok, peek()) };
      if (rest) node.rest = rest;
      return node;
    } else {
      // Object pattern.
      const properties = [];
      let rest;
      if (peek().kind === 'PUNCT' && peek().text === '}') {
        consume();
        return { kind: 'destructure-object', properties, span: spanOf(startTok, peek()) };
      }
      while (true) {
        // Rest: `...name`. Tokenizer emits `...` as a single OPERATOR token;
        // accept the three-dot PUNCT fallback defensively (tokenizer-drift).
        if (peek().kind === 'OPERATOR' && peek().text === '...') {
          consume(); // consume `...`
          if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
            rest = consume().text;
          }
          break; // rest must be last
        }
        if (peek().kind === 'PUNCT' && peek().text === '.' &&
            peek(1)?.kind === 'PUNCT' && peek(1).text === '.' &&
            peek(2)?.kind === 'PUNCT' && peek(2).text === '.') {
          consume(); consume(); consume(); // consume `...`
          if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
            rest = consume().text;
          }
          break; // rest must be last
        }
        if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
          const fieldTok = consume();
          const fieldName = fieldTok.text;
          let def, defExpr;
          // Renamed-or-nested form: `fieldName: <bind>`.
          if (peek().kind === 'PUNCT' && peek().text === ':' && peek(1)?.text !== '=') {
            consume(); // consume `:`
            if (peek().kind === 'PUNCT' && (peek().text === '[' || peek().text === '{')) {
              const pattern = parseDestructurePattern();
              if (peek().text === '=' && peek(1)?.text !== '=') {
                consume();
                def = collectDefaultText('}');
                if (def) defExpr = safeParseExprToNode(def, 0);
              }
              properties.push({ kind: 'nested', fieldName, pattern, ...(def ? { default: def } : {}), ...(defExpr ? { defaultExpr: defExpr } : {}) });
            } else if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
              const bindName = consume().text;
              if (peek().text === '=' && peek(1)?.text !== '=') {
                consume();
                def = collectDefaultText('}');
                if (def) defExpr = safeParseExprToNode(def, 0);
              }
              properties.push({ kind: 'name', fieldName, bindName, ...(def ? { default: def } : {}), ...(defExpr ? { defaultExpr: defExpr } : {}) });
            } else {
              // Malformed `:` — bind to fieldName.
              properties.push({ kind: 'name', fieldName, bindName: fieldName });
            }
          } else {
            // Shorthand: `{ a }` binds `a` as both field and bind.
            if (peek().text === '=' && peek(1)?.text !== '=') {
              consume();
              def = collectDefaultText('}');
              if (def) defExpr = safeParseExprToNode(def, 0);
            }
            properties.push({ kind: 'name', fieldName, bindName: fieldName, ...(def ? { default: def } : {}), ...(defExpr ? { defaultExpr: defExpr } : {}) });
          }
        } else {
          // Unexpected token — bail out by consuming it to avoid infinite loop.
          consume();
        }
        if (peek().kind === 'PUNCT' && peek().text === ',') {
          consume();
          continue;
        }
        break;
      }
      if (peek().kind === 'PUNCT' && peek().text === '}') {
        consume(); // consume `}`
      }
      const node = { kind: 'destructure-object', properties, span: spanOf(startTok, peek()) };
      if (rest) node.rest = rest;
      return node;
    }
  }

  /**
   * Parse a for-loop statement inline — used by for-as-expression:
   *   `const names = for (item of items) { lift item.name }`
   * Assumes the `for` keyword token is next (not yet consumed).
   */
  function parseOneForStmt() {
    const startTok = consume(); // consume `for`
    let variable = 'item';
    let iterable;
    if (peek().kind === 'PUNCT' && peek().text === '(') {
      consume(); // consume `(`
      // Detect C-style: look for `;` at paren depth 1 before closing `)`
      let isCStyleFor = false;
      {
        let d = 1;
        for (let la = 0; ; la++) {
          const t = peek(la);
          if (t.kind === 'EOF') break;
          if (t.kind === 'PUNCT' && (t.text === '(' || t.text === '[' || t.text === '{')) d++;
          if (t.kind === 'PUNCT' && (t.text === ')' || t.text === ']' || t.text === '}')) {
            d--;
            if (d === 0) break;
          }
          if (d === 1 && t.kind === 'PUNCT' && t.text === ';') { isCStyleFor = true; break; }
        }
      }
      if (isCStyleFor) {
        const rawParts = ['('];
        let d = 1;
        while (d > 0 && peek().kind !== 'EOF') {
          const t = consume();
          rawParts.push(t.text);
          if (t.kind === 'PUNCT' && (t.text === '(' || t.text === '[' || t.text === '{')) d++;
          if (t.kind === 'PUNCT' && (t.text === ')' || t.text === ']' || t.text === '}')) d--;
        }
        iterable = rawParts.join(' ');
        variable = null;
      } else {
        // for-of / for-in: for (const|let|var x of|in iterable)
        if (peek().kind === 'KEYWORD' && (peek().text === 'const' || peek().text === 'let' || peek().text === 'var')) {
          consume();
        }
        // A5 (2026-05-17) — destructuring LHS in for-as-expression.
        if (peek().kind === 'PUNCT' && (peek().text === '[' || peek().text === '{')) {
          variable = parseDestructurePattern();
        } else if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
          variable = consume().text;
        }
        if (peek().kind === 'KEYWORD' && (peek().text === 'of' || peek().text === 'in')) {
          consume();
        }
        const { expr: iterExpr } = collectExpr(')');
        iterable = iterExpr.trim();
        if (peek().kind === 'PUNCT' && peek().text === ')') {
          consume(); // consume `)`
        }
      }
    } else {
      // scrml-style: for variable in iterable
      if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
        variable = consume().text;
      }
      if (peek().kind === 'KEYWORD' && peek().text === 'in') {
        consume();
      }
      const { expr: iterRaw } = collectExpr('{');
      iterable = iterRaw.trim();
    }
    let body = [];
    if (peek().text === '{') {
      consume();
      body = parseRecursiveBody();
    }
    return {
      id: ++counter.next,
      kind: 'for-stmt',
      variable,
      iterable,
      iterExpr: safeParseExprToNode(iterable, 0),
      body,
      span: spanOf(startTok, peek()),
    };
  }

  /**
   * Parse a match-as-expression inline — used by match-as-expression:
   *   `const result = match expr { .A => { lift val } else => { lift default } }`
   * Assumes the `match` (or `partial match`) keyword token is next (not yet consumed).
   * Returns a match-expr node.
   */
  function parseOneMatchAsExpr(declStartTok) {
    const isPartial = peek().text === "partial";
    if (isPartial) consume(); // consume 'partial'
    const startTok = consume(); // consume 'match'
    const { expr: header } = collectExpr("{");
    let body = [];
    if (peek().text === "{") {
      consume();
      body = parseRecursiveBody();
    }
    return {
      id: ++counter.next,
      kind: "match-expr",
      header: header.trim(),
      body,
      partial: isPartial || undefined,
      headerExpr: safeParseExprToNode(header.trim(), 0),
      span: spanOf(declStartTok, peek()),
    };
  }

  /**
   * Parse a function parameter list `( param, param, ... )` into a list of
   * param entries.
   *
   * Each entry has shape:
   *   { name: string | DestructurePattern, typeAnnotation?, defaultValue?, isLin? }
   *
   * §53: typed params — "x: number(>0)" → {name: "x", typeAnnotation: "number(>0)"}.
   * §7.3.2: default parameter values via `= expr` — "n = 0" → {name: "n", defaultValue: "0"}.
   *   Defaults compile directly to JavaScript default parameter syntax. The compound forms
   *   (`==`, `===`, `=>`, `+=`, ...) are tokenized as OPERATOR (multi-char) so the
   *   bare PUNCT "=" we detect here is unambiguous — it is always the default-value separator.
   * §35.2.1: lin-annotated params — "lin x" or "lin x: string" → {name: "x", isLin: true, ...}.
   * A5-FUP (2026-05-17): destructured params — `function f([a, b])` / `function f({a, b})` /
   *   `function f({a, b} = {a:0,b:0})`. When the next non-`lin` token at param-start is
   *   `[` or `{`, route through parseDestructurePattern; `param.name` is then a structured
   *   DestructurePattern AST node (codegen via emitDestructurePatternText in
   *   codegen/emit-destructure-pattern.ts, scope-walker via iterDestructuredNames in
   *   type-system.ts).
   *
   * Downstream consumers (emit-functions.ts, emit-server.ts, type-system.ts) already
   * handle both string and structured forms via typeof checks.
   *
   * Assumes next token is `(`.
   */
  function parseParamList() {
    const params = [];
    if (peek().text !== "(") return params;
    consume(); // consume `(`
    // Text-buffer state for bare-ident params (legacy path).
    let depth = 1;
    let cur = "";          // name-and-type part of the current param
    let defBuf = "";       // default-value part (after `=`) of the current param
    let inDefault = false; // true once a top-level `=` has been consumed for this param
    // A5-FUP: when the current param's LHS was a destructure pattern, store it
    // here; pushParam picks it up instead of parsing `cur` as a bare ident.
    let curPattern = null; // DestructurePattern | null
    let curPatternIsLin = false;
    let curPatternTypeAnnotation = null;

    function pushParam(nameRaw, defRaw) {
      const def = defRaw == null ? null : defRaw.trim();
      // A5-FUP — destructured param path: `curPattern` holds the structured
      // DestructurePattern; `cur` may still contain residual type annotation
      // tokens (after a `:`). Emit a structured entry without re-parsing the
      // pattern from text.
      if (curPattern) {
        const entry = { name: curPattern };
        if (curPatternTypeAnnotation) entry.typeAnnotation = curPatternTypeAnnotation;
        if (curPatternIsLin) entry.isLin = true;
        if (def && def.length > 0) entry.defaultValue = def;
        params.push(entry);
        return;
      }
      const s = nameRaw.trim();
      if (!s && !def) return;
      // §35.2.1: detect `lin name` prefix — parameter declared as linear.
      const LIN_PREFIX = /^lin\s+(.+)$/;
      const linMatch = LIN_PREFIX.exec(s);
      const isLin = linMatch !== null;
      const effective = isLin ? linMatch[1].trim() : s;
      const colonIdx = effective.indexOf(':');
      let entry;
      if (colonIdx === -1) {
        entry = { name: effective };
      } else {
        const name = effective.slice(0, colonIdx).trim();
        const typeAnnotation = effective.slice(colonIdx + 1).trim() || null;
        entry = { name, typeAnnotation };
      }
      if (isLin) entry.isLin = true;
      if (def && def.length > 0) entry.defaultValue = def;
      params.push(entry);
    }
    // Helper: append `text` to a buffer, inserting a leading space when needed
    // to prevent concatenation of IDENT/KEYWORD/AT_IDENT tokens. STRING tokens
    // arrive without their delimiter (tokenizer strips it); when appearing in
    // a default-value expression, JSON-encode them so the round-tripped source
    // remains a syntactically-valid JS string literal. Backtick-derived STRING
    // tokens carry `isTemplate: true` and are re-emitted with backticks so any
    // embedded `${...}` interpolations survive.
    function appendTok(bufName, tok) {
      const buf = bufName === 'cur' ? cur : defBuf;
      let next = buf;
      if (buf.length > 0 && (tok.kind === 'IDENT' || tok.kind === 'KEYWORD' || tok.kind === 'AT_IDENT') &&
          buf[buf.length - 1] !== ' ') {
        next += ' ';
      }
      if (tok.kind === 'STRING') {
        next += tok.isTemplate ? '`' + tok.text + '`' : JSON.stringify(tok.text);
      } else {
        next += tok.text;
      }
      if (bufName === 'cur') cur = next;
      else defBuf = next;
    }

    // A5-FUP — at each param-start (i.e. right after `(` or after a `,` that
    // closed the previous param), peek for an optional `lin` keyword followed
    // by `[` or `{`. If so, consume those tokens and parse the destructure
    // pattern in a structured way; subsequent `:` / `=` are handled by the
    // main loop via the text buffer (typeAnnotation captured separately, then
    // promoted into `curPatternTypeAnnotation` at the `=` boundary).
    //
    // Returns true if a destructure pattern was parsed; false otherwise.
    function tryParseDestructureParamStart() {
      let la = 0;
      let sawLin = false;
      if (peek(la).kind === 'KEYWORD' && peek(la).text === 'lin') {
        sawLin = true;
        la++;
      }
      const head = peek(la);
      if (!(head && head.kind === 'PUNCT' && (head.text === '[' || head.text === '{'))) {
        return false;
      }
      if (sawLin) consume(); // consume `lin`
      const pat = parseDestructurePattern();
      if (!pat) return false;
      curPattern = pat;
      curPatternIsLin = sawLin;
      curPatternTypeAnnotation = null;
      return true;
    }

    // Try at the very first param.
    if (peek().kind !== 'PUNCT' || peek().text !== ')') {
      tryParseDestructureParamStart();
    }

    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      if (tok.text === "(" || tok.text === "[" || tok.text === "{") {
        depth++;
        if (inDefault) appendTok('def', tok);
        else appendTok('cur', tok);
        consume();
      } else if (tok.text === ")" || tok.text === "]" || tok.text === "}") {
        depth--;
        if (depth === 0) { consume(); break; }
        if (inDefault) appendTok('def', tok);
        else appendTok('cur', tok);
        consume();
      } else if (tok.text === "," && depth === 1) {
        pushParam(cur, inDefault ? defBuf : null);
        cur = "";
        defBuf = "";
        inDefault = false;
        curPattern = null;
        curPatternIsLin = false;
        curPatternTypeAnnotation = null;
        consume();
        // Try destructure at the next param-start.
        tryParseDestructureParamStart();
      } else if (depth === 1 && !inDefault && tok.kind === "PUNCT" && tok.text === "=") {
        // §7.3.2 default-value separator. PUNCT "=" at top level is unambiguous —
        // `==`/`===`/`=>`/`+=`/`-=`/`*=`/`/=`/`%=`/`&=`/`|=`/`^=`/`<<=`/`>>=`/`**=`/`??=`/`||=`/`&&=`
        // are all tokenized as OPERATOR (multi-char), so they cannot reach this branch.
        // A5-FUP — when the current param is a destructure pattern, any text
        // accumulated in `cur` between the closing `]`/`}` and this `=` is the
        // typeAnnotation (after a `:`). Strip a leading `:` if present and
        // promote to curPatternTypeAnnotation so pushParam carries it.
        if (curPattern && cur.length > 0) {
          const t = cur.trim();
          curPatternTypeAnnotation = t.startsWith(':') ? t.slice(1).trim() : t;
          cur = "";
        }
        inDefault = true;
        consume();
      } else {
        if (inDefault) appendTok('def', tok);
        else appendTok('cur', tok);
        consume();
      }
    }
    // A5-FUP — handle a trailing destructured param without default. Any text
    // accumulated in `cur` after the pattern's closer (typically a `: Type`
    // annotation) is the typeAnnotation.
    if (curPattern && cur.length > 0 && !inDefault) {
      const t = cur.trim();
      curPatternTypeAnnotation = t.startsWith(':') ? t.slice(1).trim() : t;
      cur = "";
    }
    pushParam(cur, inDefault ? defBuf : null);
    return params;
  }

  /**
   * Returns true if the current token position matches the removed presence guard pattern:
   *   `(x) =>` or `(x, y) =>` — §42.2.3 form replaced by `given x => { ... }`, E-SYNTAX-043.
   * Does NOT consume any tokens. Uses the outer peek() closure.
   */
  function isOldPresenceGuardPattern() {
    if (!(peek(0).kind === "PUNCT" && peek(0).text === "(")) return false;
    let la = 1;
    // Must have at least one identifier or @identifier after the open paren
    if (!(peek(la).kind === "IDENT" || peek(la).kind === "AT_IDENT")) return false;
    la++;
    // Skip dot-access chains: `.prop.subprop` (handles `(t.due_date) =>`)
    while (
      peek(la).kind === "PUNCT" && peek(la).text === "." &&
      (peek(la + 1).kind === "IDENT")
    ) {
      la += 2;
    }
    // Skip bracket index access: `[...]` (handles `(arr[i]) =>`, `(arr[i].prop) =>`)
    if (peek(la).kind === "PUNCT" && peek(la).text === "[") {
      let depth = 1;
      la++;
      while (depth > 0 && peek(la).kind !== "EOF") {
        if (peek(la).text === "[") depth++;
        else if (peek(la).text === "]") depth--;
        la++;
      }
    }
    // Skip call parens: `(...)` (handles `(fn()) =>`, `(fn(x)) =>`)
    if (peek(la).kind === "PUNCT" && peek(la).text === "(") {
      let depth = 1;
      la++;
      while (depth > 0 && peek(la).kind !== "EOF") {
        if (peek(la).text === "(") depth++;
        else if (peek(la).text === ")") depth--;
        la++;
      }
    }
    // Skip any comma-separated identifiers (with optional dot chains): `, IDENT[.prop]*`
    while (
      peek(la).kind === "PUNCT" && peek(la).text === "," &&
      (peek(la + 1).kind === "IDENT" || peek(la + 1).kind === "AT_IDENT")
    ) {
      la += 2;
      // Skip dot chains on this param too
      while (
        peek(la).kind === "PUNCT" && peek(la).text === "." &&
        (peek(la + 1).kind === "IDENT")
      ) {
        la += 2;
      }
    }
    // Must close with `)`
    if (!(peek(la).kind === "PUNCT" && peek(la).text === ")")) return false;
    la++;
    // Must be followed by `=>` (isMatchArrow handles both `=>` and `:>`)
    return isMatchArrow(peek(la));
  }

  while (true) {
    const tok = peek();
    if (tok.kind === "EOF") break;

    // Phase 4 / §32 — update tilde context based on last pushed node.
    // Tilde is initialized by EITHER (1) a value-lift `lift-expr`, OR
    // (2) an unassigned expression statement (bare-expr). The next
    // potentially-consuming statement deactivates the flag — see the
    // matching block in parseRecursiveBody for the rationale.
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      if (
        (lastNode.kind === "lift-expr" && lastNode.expr && lastNode.expr.kind === "expr") ||
        lastNode.kind === "bare-expr"
      ) {
        _tildeActive = true;
      } else if (_tildeActive) {
        _tildeActive = false;
      }
    }

    // Skip comments
    if (tok.kind === "COMMENT") { consume(); continue; }

    // Skip bare semicolons
    if (tok.kind === "PUNCT" && tok.text === ";") { consume(); continue; }

    // Skip whitespace tokens (shouldn't appear — tokenizer strips them — but guard anyway)
    if (tok.text.trim() === "" && tok.kind !== "EOF") { consume(); continue; }

    // GUARDED-EXPR (outer loop): error-effect BLOCK_REF after a node wraps previous node
    // If the current token is a BLOCK_REF to error-effect AND we have a previous node,
    // replace the last node with a guarded-expr.
    if (tok.kind === "BLOCK_REF" && tok.block && tok.block.type === "error-effect" && nodes.length > 0) {
      consume();
      const errBlock = buildBlock(tok.block, filePath, parentBlock.type, counter, errors);
      const lastNode = nodes[nodes.length - 1];
      nodes[nodes.length - 1] = {
        id: ++counter.next,
        kind: "guarded-expr",
        guardedNode: lastNode,
        arms: errBlock ? errBlock.arms : [],
        span: { ...lastNode.span, end: tok.block.span.end },
      };
      continue;
    }

    // BLOCK_REF — embedded child block from the block splitter
    if (tok.kind === "BLOCK_REF") {
      consume();
      const child = tok.block;
      if (child) {
        // Build the child AST node — pass the parent block's type as context
        const childNode = buildBlock(child, filePath, parentBlock.type, counter, errors);
        if (childNode) {
          childNode.span = fullSpan(child.span, filePath);
          // §SQL: collect chained method calls (.run(), .all(), .get()) from parent token stream.
          // Uses the shared helper (defined ~L1910) which accepts both IDENT and KEYWORD method
          // names — `.get()` and `.set()` tokenize as KEYWORD per tokenizer.ts:62.
          // (fix-lift-sql-chained-call-parallel-sites, S40 follow-up.)
          consumeSqlChainedCalls(childNode);
          nodes.push(childNode);
        }
      }
      continue;
    }

    // IMPORT — parse structured import data per §21.3
    if (tok.kind === "KEYWORD" && tok.text === "import") {
      const startTok = consume();
      const { expr, span } = collectExpr();
      const rawStr = "import " + expr;

      // Parse structured import: `{ Name1, Name2 } from './path'` or `Name from './path'`
      const importNode = { id: ++counter.next, kind: "import-decl", raw: rawStr, span, names: [], specifiers: [], source: null, isDefault: false };

      // Match: { names } from 'source' or "source"
      const namedMatch = expr.match(/^\s*\{\s*([^}]*)\}\s*from\s+["']([^"']+)["']/);
      if (namedMatch) {
        // ES `as` aliasing: `{ foo as bar }` — resolve against the original export name `foo`;
        // the local alias `bar` is remembered for scope binding.
        // P3.A: also accept quoted import names like `{ "dispatch-board" as dispatchBoard }`
        // — channel exports use kebab-case names that aren't valid JS identifiers, so the
        // import syntax allows quoting. The stored name is the UNquoted form that matches
        // the channel's `name=` attribute value (which is what MOD's exportRegistry keys on).
        const _stripQuotes = (s) => {
          if (typeof s !== "string" || s.length < 2) return s;
          if ((s[0] === '"' && s[s.length - 1] === '"') ||
              (s[0] === "'" && s[s.length - 1] === "'")) {
            return s.slice(1, -1);
          }
          return s;
        };
        // A1a Step 7: detect trailing `pinned` bareword on each import-list item.
        // Per SPEC §21.8.1, `pinned` modifies the imported binding to enforce
        // the §6.10 identity-stability contract in the importing file's scope.
        // The modifier appears AFTER the imported name (and any optional `as <alias>`),
        // separated by whitespace. Disambiguation rule: `pinned` is the modifier
        // ONLY when it is the LAST whitespace-separated token AND the immediately
        // preceding token is NOT `as` (otherwise `foo as pinned` would be ambiguously
        // interpreted as either "alias to name `pinned`" or "modifier on foo with no alias";
        // we choose the former — `pinned` is NOT in global KEYWORDS per AST-CONTRACTS §2.1).
        // A1b will enforce semantic validity (`E-IMPORT-PINNED-INVALID` for non-cell-typed targets).
        const _splitPinned = (entry) => {
          const parts = entry.split(/\s+/).filter(Boolean);
          if (parts.length >= 2 &&
              parts[parts.length - 1] === "pinned" &&
              parts[parts.length - 2] !== "as") {
            return { core: parts.slice(0, -1).join(" "), pinned: true };
          }
          return { core: entry, pinned: false };
        };
        const _entries = namedMatch[1]
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        importNode.names = _entries.map(entry => {
          const { core } = _splitPinned(entry);
          const asMatch = core.match(/^(\S+)\s+as\s+(\S+)$/);
          const importedRaw = asMatch ? asMatch[1] : core;
          return _stripQuotes(importedRaw);
        });
        // P3.A: also record full {imported, local} specifiers so consumers
        // (CHX, future cross-file passes) can map an alias back to the
        // original imported name.
        // A1a Step 7: per-specifier `pinned: boolean` flag; default false.
        importNode.specifiers = _entries.map(entry => {
          const { core, pinned } = _splitPinned(entry);
          const asMatch = core.match(/^(\S+)\s+as\s+(\S+)$/);
          if (asMatch) {
            return { imported: _stripQuotes(asMatch[1]), local: asMatch[2], pinned };
          }
          const bare = _stripQuotes(core);
          return { imported: bare, local: bare, pinned };
        });
        importNode.source = namedMatch[2];
      } else {
        // Match: defaultName from 'source'
        const defaultMatch = expr.match(/^\s*(\w+)\s+from\s+["']([^"']+)["']/);
        if (defaultMatch) {
          importNode.names = [defaultMatch[1]];
          importNode.source = defaultMatch[2];
          importNode.isDefault = true;
        }
      }

      nodes.push(importNode);
      continue;
    }

    // USE — parse use declarations per §40.2
    // Syntax: use scrml:ui { Button, Card } or use vendor:path { name }
    if (tok.kind === "KEYWORD" && tok.text === "use") {
      const startTok = consume();
      const { expr, span } = collectExpr();
      const rawStr = "use " + expr;

      const useNode = { id: ++counter.next, kind: "use-decl", raw: rawStr, span, names: [], source: null };

      // Match: source { names } — e.g., scrml:ui { Button, Card }
      const namedMatch = expr.match(/^\s*([\w:/.@-]+)\s*\{\s*([^}]*)\}/);
      if (namedMatch) {
        useNode.source = namedMatch[1].trim();
        useNode.names = namedMatch[2].split(",").map(s => s.trim()).filter(Boolean);
      } else {
        // Match: just a source — e.g., use scrml:ui (wide import)
        const sourceOnly = expr.match(/^\s*([\w:/.@-]+)\s*$/);
        if (sourceOnly) {
          useNode.source = sourceOnly[1].trim();
        }
      }

      nodes.push(useNode);
      continue;
    }

    // EXPORT — parse structured export data per §21.2
    if (tok.kind === "KEYWORD" && tok.text === "export") {
      const startTok = consume();

      // F-AUTH-002 fix: peek-and-consume optional `pure` / `server` /
      // `pure server` modifier tokens BEFORE collectExpr. Without this, the
      // expression collector stops at the first STMT_KEYWORD (`function`,
      // `fn`) it sees AFTER consuming `server`, because parts.length > 0
      // triggers the statement-boundary guard. The result was an
      // export-decl with raw="export server" and exportedName=null,
      // followed by an unmarked function-decl whose name was lost from
      // the export registry. See docs/changes/f-auth-002/diagnosis.md.
      //
      // S89 §13.2 Sub-Phase B note: `async` is intentionally NOT consumed
      // here. Reason — if `async` is consumed as a prefix and the export
      // handler then calls collectExpr, the entire `function name(...) { body }`
      // gets swallowed by collectExpr as one expression (because `function`
      // is the FIRST token after the prefix → parts.length === 0 → the
      // STMT_KEYWORD boundary check doesn't fire). The synthesized function-
      // decl then has params:[], body:[], which breaks lint walkers that
      // recurse into function bodies (W-TRY-CATCH-IN-SCRML-SOURCE in
      // particular). By leaving `async` in the stream, the export handler
      // produces a broken export-decl (raw="export async",
      // exportedName:null) and the main loop's function-decl handler (which
      // now recognizes `async function` per the S89 §13.2 Sub-Phase B
      // extension at line ~6900) picks up the actual function declaration
      // with full body parsing AND records isAsync:true on the resulting
      // function-decl. The auto-await classifier (Stage 8 CG scheduling.ts)
      // reads isAsync from the function-decl, NOT from the export-decl, so
      // the broken export registration has no effect on auto-await.
      // Practical note: stdlib runtime is hand-written JS shims
      // (compiler/runtime/stdlib/*.js), not compiled from these .scrml
      // sources, so the missing export name registration on `export async`
      // forms does not affect stdlib consumers at S89. Fixing the export
      // registration without breaking lint walkers is a separate concern.
      let isPure = false;
      let isServer = false;
      const prefixParts = [];
      // Allowed modifier sequences: `pure`, `server`, `pure server`.
      // (`server pure` is not a valid scrml form per §33.) We accept either
      // `pure` first OR `server` first followed by an optional companion.
      // Note: `pure` tokenizes as IDENT (not KEYWORD), `server` as KEYWORD.
      // Match either kind for `pure` (defensive against future tokenizer changes).
      const _peekIsPure = peek().text === "pure" && (peek().kind === "IDENT" || peek().kind === "KEYWORD");
      const _peekIsServer = peek().text === "server" && peek().kind === "KEYWORD";
      if (_peekIsPure) {
        isPure = true;
        prefixParts.push(consume().text);
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          prefixParts.push(consume().text);
        }
      } else if (_peekIsServer) {
        isServer = true;
        prefixParts.push(consume().text);
      }

      // ANOMALY-2-FIX (S99): capture token cursor BEFORE collectExpr so we
      // can later slice the consumed tokens and re-parse them as a function-
      // decl with full params + body. The source-text-slice approach is
      // unreliable because token spans use baseOffset against the
      // PRE-PROCESSED (worker/state-ref-substituted) bodyRaw, not the raw
      // file source — a `<#worker>` substitution in an earlier statement
      // shifts subsequent token spans by 11 chars per occurrence.
      // Slicing the token array uses the canonical positions and avoids
      // re-tokenization (which itself produces subtly different tokens for
      // `?.`, `::`, `!{}`, etc. when fed the space-padded `rawStr`).
      const _iBeforeCollect = i;
      const { expr, span } = collectExpr();
      const _iAfterCollect = i;
      const rawStr = prefixParts.length > 0
        ? "export " + prefixParts.join(" ") + " " + expr
        : "export " + expr;

      // S89 §13.2 Sub-Phase B Step 2 — `export async function|fn name` shape.
      // When collectExpr breaks at `async` (per the decl-shape boundary guard
      // at line ~1965), the export-decl receives `expr: ""` / `raw: "export "`.
      // The function-decl handler downstream picks up the real declaration with
      // isAsync:true, but the export-decl is left with exportedName:null which
      // means buildExportRegistry doesn't see the export by name — silencing
      // the auto-await classifier for stdlib Promise<T> functions. Peek ahead:
      // if the next tokens are `async [server] function|fn IDENT`, harvest the
      // name + kind + isAsync flag onto the export-decl. The function-decl is
      // produced by the main loop (not synthesized here) so the body is parsed
      // exactly once.
      let _asyncExportName = null;
      let _asyncExportKind = null;
      let _asyncExportIsAsync = false;
      let _asyncExportIsServer = isServer;
      // Only peek-ahead when collectExpr returned empty — that signals it broke
      // at the `async` decl-shape boundary guard (line ~1965). Without this
      // guard, a normal `export function foo() { ... } async function bar()`
      // sequence would mis-harvest `bar` onto the `foo` export-decl.
      if (expr === "" && peek().kind === "KEYWORD" && peek().text === "async") {
        let _lookOff = 1;
        // optional `server` between `async` and `function|fn`
        if (peek(_lookOff)?.kind === "KEYWORD" && peek(_lookOff)?.text === "server") {
          _asyncExportIsServer = true;
          _lookOff++;
        }
        const _kwTok = peek(_lookOff);
        if (_kwTok?.kind === "KEYWORD" && (_kwTok.text === "function" || _kwTok.text === "fn")) {
          _asyncExportKind = _kwTok.text;
          _lookOff++;
          // optional `*` (generator marker — rejected by §36 but parse it)
          if (peek(_lookOff)?.text === "*") _lookOff++;
          const _nameTok = peek(_lookOff);
          if (_nameTok && (_nameTok.kind === "IDENT" || _nameTok.kind === "KEYWORD")) {
            _asyncExportName = _nameTok.text;
            _asyncExportIsAsync = true;
          }
        }
      }

      const exportNode = {
        id: ++counter.next,
        kind: "export-decl",
        raw: rawStr,
        span,
        exportedName: _asyncExportName,
        exportKind: _asyncExportKind,
        reExportSource: null,
        // F2/F3 grammar fixes (ast-builder-grammar-fixes dispatch):
        //   isReExportAll  — true for `export * from './x'`
        //   renames        — array of { exported, local } pairs for any
        //                    braced export form (re-export, rename, local).
        isReExportAll: false,
        renames: null,
        isPure,
        // S89: `export async function` may have set isServer above; honor either form.
        isServer: _asyncExportIsServer,
        // S89 §13.2 Sub-Phase B Step 2 — propagate async modifier so
        // buildExportRegistry can populate exportRegistry[file].get(name).isAsync
        // for the auto-await classifier (§13.2.1).
        ...(_asyncExportIsAsync ? { isAsync: true } : {}),
      };

      // Helper: parse one name-spec like `A` or `A as B`.
      // Returns { exported, local } where `local` is the source-file name
      // (input) and `exported` is the outward-facing name (output).
      function parseNameSpec(s) {
        const trimmed = s.trim();
        const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) return { exported: asMatch[2], local: asMatch[1] };
        return { exported: trimmed, local: trimmed };
      }

      // F2: `export * from './source'` (re-export-all).
      const reExportAllMatch = expr.match(/^\s*\*\s*from\s+["']([^"']+)["']/);
      // F3: re-export with potential renames: `{ A as B, C } from './x'`.
      const reExportMatch = expr.match(/^\s*\{\s*([^}]*)\}\s*from\s+["']([^"']+)["']/);
      // F3: local rename `export { A as B }` (no `from` clause).
      const localBracedMatch = expr.match(/^\s*\{\s*([^}]*)\}\s*$/);

      if (reExportAllMatch) {
        exportNode.exportKind = "re-export-all";
        exportNode.exportedName = "*";
        exportNode.reExportSource = reExportAllMatch[1];
        exportNode.isReExportAll = true;
      } else if (reExportMatch) {
        const specs = reExportMatch[1]
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
          .map(parseNameSpec);
        exportNode.renames = specs;
        exportNode.exportedName = specs.map(s => s.exported).join(", ");
        exportNode.exportKind = "re-export";
        exportNode.reExportSource = reExportMatch[2];
      } else if (localBracedMatch) {
        // Local braced export — may include renames (`{ A as B }`) OR plain
        // re-statements of locally-declared names (`{ foo, bar }`).
        const specs = localBracedMatch[1]
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
          .map(parseNameSpec);
        exportNode.renames = specs;
        exportNode.exportedName = specs.map(s => s.exported).join(", ");
        exportNode.exportKind = specs.some(s => s.local !== s.exported) ? "rename" : "local";
      } else {
        // export type Name... | export function Name... | export fn Name... | export const Name... | export let Name...
        // F-AUTH-002: `pure`/`server` modifier(s) have already been consumed above; isPure/isServer flags carry that intent.
        const declMatch = expr.match(/^\s*(type|function|fn|const|let)\s+(\w+)/);
        if (declMatch) {
          exportNode.exportKind = declMatch[1];
          exportNode.exportedName = declMatch[2];
        }
      }

      // P3.B (F-ENGINE-001): when exporting a type, ALSO synthesize a type-decl
      // AST node so cross-file machinery (api.js:768-770 importedTypesByFile +
      // type-system.ts processFile) can resolve the imported type. Without this,
      // `<engine for=ImportedType>` failed with E-ENGINE-004 even though the
      // import was valid. Mirrors how `export function helper() {}` produces
      // both function-decl AND export-decl. Per P3 deep-dive §5.1, §5.4.
      // The synthetic type-decl is pushed BEFORE the export-decl so collectHoisted
      // and the logic-block typeDecls filter pick it up in source order.
      if (exportNode.exportKind === "type" && exportNode.exportedName) {
        const parsed = parseExportedTypeBody(expr);
        nodes.push({
          id: ++counter.next,
          kind: "type-decl",
          name: exportNode.exportedName,
          typeKind: parsed.typeKind,
          raw: parsed.raw,
          span,
          // Mark synthesized-from-export for downstream awareness.
          fromExport: true,
        });
      }

      // F1 (ast-builder-grammar-fixes dispatch): when exporting a function or
      // fn, ALSO synthesize a function-decl AST node so AST walkers can see
      // it. Mirrors the `export type` synthesis above.
      //
      // Shape: kind:"function-decl", name, raw (full `function foo() {...}`
      // source), exported:true, fromExport:true, isPure, isServer.
      // The `fromExport: true` flag tells codegen emitters (emit-library.ts,
      // emit-logic.ts case "function-decl") to skip — the paired export-decl
      // raw text already emits the full source verbatim, so without the
      // skip the function would be emitted twice.
      //
      // params/body are intentionally NOT pre-parsed here — the synthetic
      // node exists for *discoverability* in walkers; consumers that need
      // parameter detail can re-tokenize `raw` or read the export-decl raw.
      // S89 §13.2 Sub-Phase B Step 2 — skip F1 synthesis for the
      // `export async function|fn` shape. The export-decl harvested the name
      // via peek-ahead but the body lives entirely with the function-decl
      // produced by the main loop downstream (collectExpr broke at `async`,
      // so `rawStr` here is just "export " with no body). Synthesizing a
      // stub here would (a) duplicate the function-decl walker visibility and
      // (b) leak an empty-body raw into emit-library.ts. The main-loop
      // function-decl already carries isAsync:true and is reachable through
      // logic.body walkers without a synthetic stub.
      if (_asyncExportIsAsync) {
        // intentional no-op: real function-decl comes from the main loop.
      } else if ((exportNode.exportKind === "function" || exportNode.exportKind === "fn") && exportNode.exportedName) {
        // S81 D1 (2026-05-11): propagate `.idempotent()` modifier per §19.9.7.
        // The inline function-decl parser detects this token-by-token at the
        // post-`)` cursor position (ast-builder.js ~6610 for `function`, ~6803
        // for `fn`). The synth path here doesn't tokenize — it stubs a
        // function-decl from the export raw. Without propagation, downstream
        // walkers seeing the synthetic node won't know about the modifier; the
        // monotonicity classifier (Stage 5.5) reads `fnNode.idempotentModifier`
        // and falls back to over-emitting idempotency keys. Detect the
        // modifier here via a targeted regex on the export raw — `)` followed
        // by optional whitespace + `.idempotent()` per §19.9.7 normative
        // placement (between `)` and return-type / route / body).
        // Pattern: `) . idempotent ( )` — `\s*` between every token so the
        // tokenized raw form (space-padded between every token, see test
        // output of buildAST.ast.nodes[].raw) matches the same regex as the
        // source-form `).idempotent()`. The non-export inline parser at
        // ~6610 reads from the token stream directly so doesn't need this
        // tolerance.
        const hasIdempotentModifier = /\)\s*\.\s*idempotent\s*\(\s*\)/.test(rawStr);

        // ANOMALY-2-FIX (S99): re-parse params + body by re-tokenizing the
        // ORIGINAL source text (via parentBlock.raw slice) and recursively
        // invoking parseLogicBody. Pre-fix, the synth stub emitted
        // `params: []` and `body: []` — relying on emit-library.ts's primary
        // path (sourceText.slice from spans) for stdlib bundling. That works
        // for stdlib emit BUT FAILS for the SPA-shape client emit path
        // (emit-functions.ts emits the function-decl as a real JS function
        // from params+body, producing `function _scrml_name_N() {}` with
        // empty body in `.client.js`).
        //
        // Reproducer pre-fix:
        //   ${ export function makeSpan(a,b) { return {a,b} } } <program/>
        //   compiles to `function _scrml_makeSpan_1() {}` (broken).
        //
        // Why slice from parentBlock.raw (original source) NOT from rawStr
        // (collectExpr's space-padded reconstruction): the original source
        // preserves `?.`, `::`, `!{}`, comments, and other syntax the
        // re-tokenizer needs to reproduce identical tokens. rawStr is a
        // space-tokenized reconstruction that loses these distinctions and
        // produces subtly different tokens on re-tokenize (which then
        // corrupts downstream TS scope-resolution and CG emission).
        //
        // The `fromExport: true` flag remains so emit-library.ts continues
        // to skip these (its primary sourceText-slice path is canonical for
        // stdlib; its AST-fallback path explicitly skips fromExport stubs).
        let synthParams = [];
        let synthBody = [];
        let synthCanFail = false;
        let synthIsGenerator = false;
        let synthHasReturnType = false;
        let synthReturnTypeAnnotation = undefined;
        try {
          // Slice the consumed tokens (from cursor before collectExpr to
          // cursor after) and re-parse them via parseLogicBody. The token
          // array IS the canonical representation — its tokens already
          // carry correct positions and have already passed scrml-specific
          // tokenization (`?.`, `::`, `!{}`, etc.), so re-parsing them
          // produces an identical AST shape to what the inline non-export
          // path would produce.
          if (Array.isArray(tokens) && _iBeforeCollect < _iAfterCollect) {
            let subToks = tokens.slice(_iBeforeCollect, _iAfterCollect);
            // Strip leading `pure` / `server` modifier tokens (the `export`
            // token itself was consumed BEFORE _iBeforeCollect was captured,
            // so it's already excluded). The synth function-decl carries
            // isPure/isServer flags via the outer export-decl branch.
            let _stripCount = 0;
            while (
              _stripCount < subToks.length &&
              ((subToks[_stripCount].text === "pure" &&
                (subToks[_stripCount].kind === "IDENT" || subToks[_stripCount].kind === "KEYWORD")) ||
               (subToks[_stripCount].text === "server" && subToks[_stripCount].kind === "KEYWORD"))
            ) {
              _stripCount++;
            }
            if (_stripCount > 0) subToks = subToks.slice(_stripCount);
            // Append a synthetic EOF token so parseLogicBody's loop has a
            // clean termination signal (it expects an EOF terminator from
            // the tokenizer).
            const lastTok = subToks[subToks.length - 1];
            const eofTok = lastTok
              ? { kind: "EOF", text: "", span: { start: lastTok.span?.end ?? 0, end: lastTok.span?.end ?? 0, line: lastTok.span?.line ?? 1, col: lastTok.span?.col ?? 1 } }
              : { kind: "EOF", text: "", span: { start: 0, end: 0, line: 1, col: 1 } };
            subToks = subToks.concat([eofTok]);
            const subNodes = parseLogicBody(
              subToks,
              filePath,
              [],
              parentBlock,
              counter,
              [],            // throw-away errors — duplicate-parse must not double-emit
              blockContext,
            );
            const innerFn = Array.isArray(subNodes)
              ? subNodes.find((n) => n && n.kind === "function-decl")
              : null;
            if (innerFn) {
              synthParams = innerFn.params ?? [];
              synthBody = innerFn.body ?? [];
              synthCanFail = !!innerFn.canFail;
              synthIsGenerator = !!innerFn.isGenerator;
              synthHasReturnType = !!innerFn.hasReturnType;
              synthReturnTypeAnnotation = innerFn.returnTypeAnnotation;
            }
          }
        } catch (_synthErr) {
          // Fall back to empty params/body on re-parse failure — preserves
          // pre-fix behavior so this fix can never regress stdlib emit.
        }

        nodes.push({
          id: ++counter.next,
          kind: "function-decl",
          name: exportNode.exportedName,
          params: synthParams,
          body: synthBody,
          fnKind: exportNode.exportKind,
          isServer,
          ...(isPure ? { isPure: true } : {}),
          ...(hasIdempotentModifier ? { idempotentModifier: true } : {}),
          isGenerator: synthIsGenerator,
          canFail: synthCanFail,
          ...(synthHasReturnType ? { hasReturnType: true } : {}),
          ...(synthReturnTypeAnnotation ? { returnTypeAnnotation: synthReturnTypeAnnotation } : {}),
          raw: rawStr,
          span,
          exported: true,
          fromExport: true,
        });
      }

      nodes.push(exportNode);
      continue;
    }

    // TYPE DECLARATION: `type name:kind = { ... }`
    // Also accepts the alternate `type:kind Name { ... }` form used by
    // self-host files (kind and name swapped, no `=`, body contains `;`-
    // delimited fields). Both forms produce the same AST shape.
    if (tok.kind === "KEYWORD" && tok.text === "type") {
      const startTok = consume();
      const nameTok = peek();
      let typeName = "";
      let typeKind = "";

      // Alternate form: `type:kind Name { ... }` — colon comes first.
      if (peek().text === ":") {
        consume(); // consume `:`
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          typeKind = consume().text;
        }
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          typeName = consume().text;
        }
      } else {
        // Standard form: `type Name:kind = { ... }`.
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          typeName = consume().text;
        }
        if (peek().text === ":") {
          consume(); // consume `:`
          typeKind = peek().kind === "IDENT" || peek().kind === "KEYWORD"
            ? consume().text
            : "";
        }
      }

      // = { ... } (standard form)  OR  { ... } (alternate form)
      let raw = "";
      if (peek().text === "=") {
        consume(); // consume `=`
      }
      if (peek().text === "{") {
        consume(); // consume `{`
        const { body, span: bodySpan } = collectBracedBody();
        raw = "{ " + body + " }";
        nodes.push({
          id: ++counter.next,
          kind: "type-decl",
          name: typeName,
          typeKind,
          raw,
          span: spanOf(startTok, peek()),
        });
      } else if (peek().text !== "}" && peek().kind !== "EOF") {
        // Inline type expression after `=` (union, alias, etc.).
        const { expr, span: exprSpan } = collectExpr();
        raw = expr;
        nodes.push({
          id: ++counter.next,
          kind: "type-decl",
          name: typeName,
          typeKind,
          raw,
          span: spanOf(startTok, peek()),
        });
      } else {
        // Type decl without body.
        nodes.push({
          id: ++counter.next,
          kind: "type-decl",
          name: typeName,
          typeKind,
          raw: "",
          span: tokenSpan(startTok, filePath),
        });
      }
      continue;
    }

    // S79 — `@debounced(N) name = expr` in-function-body keyword-form parse
    // path RETIRED. See the parallel deletion at the top-level parse path
    // above for full rationale.

    // server MODIFIER: `server @varName = expr` → state-decl with isServer: true (§52.4)
    // Guard: only consume `server` when the next token is AT_IDENT.
    // This ensures `server function` and `server fn` fall through to their own handlers.
    if (tok.kind === "KEYWORD" && tok.text === "server" && peek(1)?.kind === "AT_IDENT") {
      const startTok = consume(); // consume `server`
      const atTok = consume(); // consume `@varName`
      const name = atTok.text.slice(1); // strip @
      // §53: optional type annotation — `server @name: Type(pred) = expr`
      const typeAnnotation = collectTypeAnnotation();
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `server @x = ?{...}.method()`.
        // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          const node = { id: ++counter.next, kind: "state-decl", name, init: "", sqlNode: _sqlInit, isServer: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
          if (typeAnnotation) node.typeAnnotation = typeAnnotation;
          nodes.push(node);
          continue;
        }
        const { expr } = collectExpr();
        const node = { id: ++counter.next, kind: "state-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), isServer: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        if (typeAnnotation) node.typeAnnotation = typeAnnotation;
        nodes.push(node);
        continue;
      }
      // Malformed — emit as bare-expr
      const { expr } = collectExpr();
      const _be7 = startTok.text + " " + atTok.text + (expr ? " " + expr : "");
      nodes.push({ id: ++counter.next, kind: "bare-expr", expr: _be7, exprNode: safeParseExprToNode(_be7, 0), span: spanOf(startTok, peek()) });
      continue;
    }

    // @shared MODIFIER: `@shared varName = expr` → state-decl with isShared: true (§37.4)
    if (tok.kind === "AT_IDENT" && tok.text === "@shared") {
      const startTok = consume(); // consume `@shared`
      // Expect: IDENT or KEYWORD (varName), then =, then expr
      if ((peek().kind === "IDENT" || peek().kind === "KEYWORD") && peek(1)?.text === "=" && peek(2)?.text !== "=") {
        const nameTok = consume(); // consume varName
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `@shared x = ?{...}.method()`.
        // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          nodes.push({ id: ++counter.next, kind: "state-decl", name: nameTok.text, init: "", sqlNode: _sqlInit, isShared: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) });
          continue;
        }
        const { expr } = collectExpr();
        nodes.push({ id: ++counter.next, kind: "state-decl", name: nameTok.text, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), isShared: true, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) });
        continue;
      }
      // Malformed @shared — emit as bare-expr
      const { expr } = collectExpr();
      const _be8 = startTok.text + (expr ? " " + expr : "");
      nodes.push({ id: ++counter.next, kind: "bare-expr", expr: _be8, exprNode: safeParseExprToNode(_be8, 0), span: spanOf(startTok, peek()) });
      continue;
    }

    // REACTIVE DECLARATION / NESTED ASSIGN / ARRAY MUTATION: `@name...`
    if (tok.kind === "AT_IDENT") {
      const startTok = consume();
      const name = tok.text.slice(1); // strip @

      // Check for a reactive path: @obj.path.to.prop = value  OR  @arr.push(...)
      // OR (cycles-prereq S168) a bracket-index WRITE @arr[i] = value etc.
      if (peek().text === "." || peek().text === "[") {
        const { segments: pathSegments, reconstruct: pathStr } = collectAtPathSegments();

        // Array mutation patterns: @arr.push(...), @arr.splice(...) — dotted
        // single-segment (string) method only, never a bracket index.
        const ARRAY_MUTATIONS = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
        const lastSeg = pathSegments[pathSegments.length - 1];
        if (pathSegments.length === 1 && typeof lastSeg === "string" && ARRAY_MUTATIONS.includes(lastSeg) && peek().text === "(") {
          consume(); // consume "("
          const argParts = [];
          let parenDepth = 1;
          while (parenDepth > 0 && peek().kind !== "EOF") {
            const t = consume();
            if (t.text === "(") parenDepth++;
            if (t.text === ")") { parenDepth--; if (parenDepth === 0) break; }
            argParts.push(t.text);
          }
          const _ramArgs2 = argParts.join(" ").trim();
          nodes.push({
            id: ++counter.next,
            kind: "reactive-array-mutation",
            target: name,
            method: lastSeg,
            args: _ramArgs2,
            argsExpr: safeParseExprToNode(_ramArgs2, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          });
          continue;
        }

        // Nested assignment: @obj.path = value / @arr[i] = value
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume(); // consume "="
          const { expr, span } = collectExpr();
          nodes.push({
            id: ++counter.next,
            kind: "reactive-nested-assign",
            target: name,
            path: pathSegments,
            value: expr,
            valueExpr: safeParseExprToNode(expr, 0),
            span: spanOf(startTok, peek()),
          });
          continue;
        }

        // Not a write — a READ — reconstruct as bare-expr from the faithful
        // path source-text suffix. Reads are NOT COW'd.
        const { expr, span } = collectExpr();
        const _be9 = startTok.text + pathStr + (expr ? " " + expr : "");
        nodes.push({
          id: ++counter.next,
          kind: "bare-expr",
          expr: _be9,
          exprNode: safeParseExprToNode(_be9, 0),
          span: spanOf(startTok, peek()),
        });
        continue;
      }

      // Type annotation: @name: Type(predicate) = expr  (§53)
      // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
      if (peek().text === ":") {
        const typeAnnotation = collectTypeAnnotation();
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume(); // consume '='
          // fix-cg-cps-return-sql-ref-placeholder: detect `@x: T = ?{...}.method()`.
          const _sqlInit = tryConsumeSqlInit();
          if (_sqlInit) {
            nodes.push({
              id: ++counter.next,
              kind: "state-decl",
              name,
              init: "",
              sqlNode: _sqlInit,
              ...(typeAnnotation ? { typeAnnotation } : {}),
              shape: "plain",
              structuralForm: false,
              isConst: false,
              span: spanOf(startTok, peek()),
            });
            continue;
          }
          const { expr } = collectExpr();
          nodes.push({
            id: ++counter.next,
            kind: "state-decl",
            name,
            init: expr,
            initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
            ...(typeAnnotation ? { typeAnnotation } : {}),
            shape: "plain",
            structuralForm: false,
            isConst: false,
            span: spanOf(startTok, peek()),
          });
          continue;
        }
        // Malformed — fall through to bare-expr
      }

      // Simple reactive decl: @name = expr
      // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
      //
      // Unit CC (S123) — main-loop fire site adds the `_isUnitCCWrite` tag
      // for the IMMEDIATE default-logic body-top case (parentBlock is the
      // synthetic auto-lift wrapper AND _nestedBlockDepth === 0). Tagged
      // nodes fire E-WRITE-NOT-IN-LOGIC-CONTEXT at SYM PASS 3 unless the
      // file path is on the corpus exemption list.
      //
      // Unit CC scope is deliberately narrow: it does NOT extend V-kill's
      // `_isReactiveAssign` tagging to this main-loop site. The
      // parseOneStatement V-kill site (above ~L5096) is the canonical
      // V-kill fire surface (fn / function / nested `${...}` body writes).
      // Extending `_isReactiveAssign` to top-level explicit-`${...}` body
      // writes is a separate V-kill follow-up (out of Unit CC scope) — the
      // existing corpus uses bare `@name = expr` at this site freely (177+
      // legitimate uses) and migrating them is a separate workstream.
      // Therefore the legacy phantom-synth path is preserved for the
      // non-default-logic-body-top case here.
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `@x = ?{...}.method()`.
        // Bare `?{...}` and `?{...}.all()/.get()/.run()` both flow through here.
        // Without this, safeParseExprToNode produces the broken sql-ref placeholder
        // ExprNode that emit-expr renders as `/* sql-ref:-1 */` — the leak this
        // fix targets in combined-007-crud (server.js:38,74 and client.js:55).
        // SQL-init keeps state-decl shape regardless of context (legacy
        // V5-strict declaration syntax flowing through CPS-split).
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          nodes.push({
            id: ++counter.next,
            kind: "state-decl",
            name,
            init: "",
            sqlNode: _sqlInit,
            shape: "plain",
            structuralForm: false,
            isConst: false,
            span: spanOf(startTok, peek()),
          });
          continue;
        }
        const { expr, span } = collectExpr();
        const isDefaultLogicLift_ml = parentBlock && parentBlock._synthetic === true;
        const isAtBodyTopOfSyntheticLift_ml = isDefaultLogicLift_ml && _nestedBlockDepth === 0;
        const isUnitCCWrite_ml = isAtBodyTopOfSyntheticLift_ml;
        nodes.push({
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: expr,
          initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
          shape: "plain",
          structuralForm: false,
          isConst: false,
          ...(isUnitCCWrite_ml ? { _isUnitCCWrite: true } : {}),
          span: spanOf(startTok, peek()),
        });
        continue;
      }

      // @set(@obj, "path", value) — explicit escape hatch
      if (name === "set" && peek().text === "(") {
        consume(); // consume "("
        const argParts = [];
        let parenDepth = 1;
        while (parenDepth > 0 && peek().kind !== "EOF") {
          const t = consume();
          if (t.text === "(") parenDepth++;
          if (t.text === ")") { parenDepth--; if (parenDepth === 0) break; }
          argParts.push(t.text);
        }
        const _resArgs = argParts.join(" ").trim();
        nodes.push({
          id: ++counter.next,
          kind: "reactive-explicit-set",
          args: _resArgs,
          argsExpr: safeParseExprToNode(_resArgs, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        });
        continue;
      }

      // @name used as expression (not declaration)
      const { expr, span } = collectExpr();
      const _be10 = startTok.text + (expr ? " " + expr : "");
      nodes.push({
        id: ++counter.next,
        kind: "bare-expr",
        expr: _be10,
        exprNode: safeParseExprToNode(_be10, 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // LET DECLARATION: `let name = expr` (with optional `?` propagation)
    if (tok.kind === "KEYWORD" && tok.text === "let") {
      const startTok = consume();
      let name = "";
      // A5 (2026-05-17) — destructuring LHS: `let [a, b] = ...` / `let {a, b} = ...`.
      // Top-level parallel to the parseOneStatement let-decl hook above.
      if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
        name = parseDestructurePattern();
      } else if (peek().kind === "IDENT") name = consume().text;
      else if (peek().kind === "KEYWORD") name = consume().text; // e.g. `let in`

      // Optional type annotation: `let name: Type = expr`
      const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;

      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // If-as-expression: `let a = if (cond) { lift val }`
        if (peek().kind === "KEYWORD" && peek().text === "if") {
          const ifNode = parseOneIfStmt();
          nodes.push({
            id: ++counter.next,
            kind: "let-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            ifExpr: { ...ifNode, kind: "if-expr" },
            span: spanOf(startTok, peek()),
          });
        // For-as-expression: `let names = for (item of items) { lift item.name }`
        } else if (peek().kind === "KEYWORD" && peek().text === "for") {
          const forNode = parseOneForStmt();
          nodes.push({
            id: ++counter.next,
            kind: "let-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            forExpr: { ...forNode, kind: "for-expr" },
            span: spanOf(startTok, peek()),
          });
        // Match-as-expression: `let result = match expr { .A => { lift val } }`
        } else if (peek().kind === "KEYWORD" && (peek().text === "match" || (peek().text === "partial" && peek(1)?.text === "match"))) {
          const matchNode = parseOneMatchAsExpr(startTok);
          nodes.push({
            id: ++counter.next,
            kind: "let-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            matchExpr: matchNode,
            span: spanOf(startTok, peek()),
          });
        } else {
        // v0.2.4 bug-1-anomaly-2: `let x = ?{...}.method()` — top-level branch
        // (parallel to parseOneStatement above). Wire tryConsumeSqlInit so the
        // BLOCK_REF flows through the structured sqlNode path.
        const _sqlInitLetTop = tryConsumeSqlInit();
        if (_sqlInitLetTop) {
          nodes.push({
            id: ++counter.next,
            kind: "let-decl",
            name,
            init: "",
            sqlNode: _sqlInitLetTop,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          });
        } else {
        const { expr, span } = collectExpr();
        // Check for `?` propagation suffix
        const stripped = expr.trimEnd();
        if (stripped.endsWith("?")) {
          const innerExpr = stripped.slice(0, -1).trimEnd();
          nodes.push({
            id: ++counter.next,
            kind: "propagate-expr",
            binding: name,
            expr: innerExpr,
            exprNode: safeParseExprToNode(innerExpr, 0),
            span: spanOf(startTok, peek()),
          });
        } else {
          nodes.push({
            id: ++counter.next,
            kind: "let-decl",
            name,
            init: expr,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          });
        }
        }
        }
      } else {
        const { expr, span } = collectExpr();
        nodes.push({
          id: ++counter.next,
          kind: "let-decl",
          name,
          init: expr,
          ...(typeAnnotation ? { typeAnnotation } : {}),
          initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        });
      }
      continue;
    }

    // CONST DECLARATION: `const @name = expr` (legacy expression-form
    // derived, post-Step-11.5 produces state-decl with shape:"derived",
    // isConst:true, structuralForm:false) or `const Name = <element ...>`
    // (component def) or `const name = expr`.
    if (tok.kind === "KEYWORD" && tok.text === "const") {
      const startTok = consume();

      // Check for `const @name = expr` or `const @name: T = expr` — legacy
      // expression-form derived reactive value. Phase A1a Step 11.5: ADR
      // Option A FOLD ratified S60. The legacy `reactive-derived-decl` kind
      // is retired; this path now produces the unified `state-decl` with
      // discriminants (shape:"derived", isConst:true, structuralForm:false).
      // Per AST-CONTRACTS-AND-DECOMPOSITION §1.1 invariant: shape:"derived"
      // ⇒ isConst === true AND initExpr !== null.
      // S26 bug B (top-level branch): parallel to the nested-statement branch
      // above — type annotation must be collected so that `const @x: boolean = true`
      // doesn't silently lose its initializer.
      if (peek().kind === "AT_IDENT") {
        const atTok = consume();
        const derivedName = atTok.text.slice(1); // strip @
        const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;
        if (peek().text === "=" && peek(1)?.text !== "=") {
          consume(); // consume `=`
          const { expr, span } = collectExpr();
          nodes.push({
            id: ++counter.next,
            kind: "state-decl",
            name: derivedName,
            init: expr,
            initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
            shape: "derived",
            isConst: true,
            structuralForm: false,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          });
        } else {
          nodes.push({
            id: ++counter.next,
            kind: "state-decl",
            name: derivedName,
            init: "",
            shape: "derived",
            isConst: true,
            structuralForm: false,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          });
        }
        continue;
      }

      // Phase A1a Step 2 — Shape 3 derived: `const <derived> = expr` (V5-strict).
      // Top-level branch — mirrors the parseOneStatement Shape 3 hook above.
      // Per SPEC §6.6.1, `const <name> = expr` is the canonical declaration
      // syntax for derived reactive values. Returns `kind: "state-decl"`
      // with `isConst: true` and `structuralForm: true`. Step 4 will populate
      // `shape: "derived"`.
      if (peek().kind === "PUNCT" && peek().text === "<") {
        const declNode = tryParseStructuralDecl(startTok, true);
        if (declNode) {
          nodes.push(declNode);
          continue;
        }
        // No match — fall through. Tokens are unconsumed; the const path below
        // will continue with the remaining `<` token.
      }

      let name = "";
      // A5 (2026-05-17) — destructuring LHS at top-level const-decl:
      // `const [a, b] = ...` / `const {a, b} = ...`. Parallels the
      // parseOneStatement const-decl destructure hook above.
      if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
        name = parseDestructurePattern();
      } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") name = consume().text;

      // Optional type annotation: `const name: Type = expr`
      const typeAnnotation = peek().text === ':' ? collectTypeAnnotation() : null;

      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // If-as-expression: `const a = if (cond) { lift val }`
        if (peek().kind === "KEYWORD" && peek().text === "if") {
          const ifNode = parseOneIfStmt();
          nodes.push({
            id: ++counter.next,
            kind: "const-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            ifExpr: { ...ifNode, kind: "if-expr" },
            span: spanOf(startTok, peek()),
          });
        // For-as-expression: `const names = for (item of items) { lift item.name }`
        } else if (peek().kind === "KEYWORD" && peek().text === "for") {
          const forNode = parseOneForStmt();
          nodes.push({
            id: ++counter.next,
            kind: "const-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            forExpr: { ...forNode, kind: "for-expr" },
            span: spanOf(startTok, peek()),
          });
        // Match-as-expression: `const result = match expr { .A => { lift val } }`
        } else if (peek().kind === "KEYWORD" && (peek().text === "match" || (peek().text === "partial" && peek(1)?.text === "match"))) {
          const matchNode = parseOneMatchAsExpr(startTok);
          nodes.push({
            id: ++counter.next,
            kind: "const-decl",
            name,
            init: "",
            ...(typeAnnotation ? { typeAnnotation } : {}),
            matchExpr: matchNode,
            span: spanOf(startTok, peek()),
          });
        } else {
        // v0.2.4 bug-1-anomaly-2: `const x = ?{...}.method()` — top-level branch.
        const _sqlInitConstTop = tryConsumeSqlInit();
        if (_sqlInitConstTop) {
          nodes.push({
            id: ++counter.next,
            kind: "const-decl",
            name,
            init: "",
            sqlNode: _sqlInitConstTop,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          });
        } else {
        const { expr, span } = collectExpr();
        // Check if this is a component definition. Per SPEC §(component defs),
        // a component-def requires BOTH an uppercase-initial name AND markup RHS
        // (`const Button = < button>...</button>`). Uppercase names alone are
        // not sufficient — `const ASCII_WS = new Set(...)` or `const VERSION = "1.0"`
        // must parse as const-decl. Without the markup check the component-def
        // would silently vacuum subsequent sibling declarations into defChildren.
        // In meta context, const declarations are always const-decl regardless of casing.
        const exprStartsWithMarkup = typeof expr === "string" && expr.trimStart().startsWith("<");
        if (blockContext !== "meta" && exprStartsWithMarkup && name && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
          nodes.push({
            id: ++counter.next,
            kind: "component-def",
            name,
            raw: expr,
            span: spanOf(startTok, peek()),
          });
        } else {
          nodes.push({
            id: ++counter.next,
            kind: "const-decl",
            name,
            init: expr,
            ...(typeAnnotation ? { typeAnnotation } : {}),
            initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
            span: spanOf(startTok, peek()),
          });
        }
        }
        }
      } else {
        nodes.push({
          id: ++counter.next,
          kind: "const-decl",
          name,
          init: "",
          ...(typeAnnotation ? { typeAnnotation } : {}),
          span: tokenSpan(startTok, filePath),
        });
      }
      continue;
    }

    // LIFT STATEMENT: `lift expr ;`
    if (tok.kind === "KEYWORD" && tok.text === "lift") {
      const startTok = consume();

      // If the next token is a BLOCK_REF, the lift target is an embedded block
      if (peek().kind === "BLOCK_REF") {
        const refTok = consume();
        const child = refTok.block;
        if (child) {
          // See parseOneStatement lift+BLOCK_REF site (~line 2245) for the
          // matching SQL-aware handling rationale.
          const childNode = buildBlock(child, filePath, parentBlock.type, counter, errors);
          if (childNode && childNode.kind === "sql") {
            consumeSqlChainedCalls(childNode);
            nodes.push({
              id: ++counter.next,
              kind: "lift-expr",
              expr: { kind: "sql", node: childNode },
              span: spanOf(startTok, peek()),
            });
          } else {
            nodes.push({
              id: ++counter.next,
              kind: "lift-expr",
              expr: { kind: "markup", node: childNode },
              span: spanOf(startTok, refTok),
            });
          }
        }
      } else if (peek().text === "<" && peek().kind === "PUNCT" && peek(1) && (peek(1).kind === "IDENT" || peek(1).kind === "KEYWORD")) {
        // Lift Approach C: inline markup → structured MarkupNode
        const markupCursor = i;
        const markupNode = parseLiftTag();
        if (markupNode) {
          nodes.push({
            id: ++counter.next,
            kind: "lift-expr",
            expr: { kind: "markup", node: markupNode },
            span: spanOf(startTok, peek()),
          });
        } else {
          // parseLiftTag failed — reset cursor and fall back to string path
          i = markupCursor;
          const { expr, span } = collectLiftExpr();
          nodes.push({
            id: ++counter.next,
            kind: "lift-expr",
            expr: { kind: "expr", expr, exprNode: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0) },
            span: spanOf(startTok, peek()),
          });
        }
      } else {
        // lift with expression or identifier — use collectLiftExpr
        const { expr, span } = collectLiftExpr();
        nodes.push({
          id: ++counter.next,
          kind: "lift-expr",
          expr: { kind: "expr", expr, exprNode: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0) },
          span: spanOf(startTok, peek()),
        });
      }
      continue;
    }

    // FAIL EXPRESSION: `fail EnumType.Variant(args)` or `fail EnumType::Variant(args)`
    // (§19.3 — `.` is canonical, `::` is alias)
    if (tok.kind === "KEYWORD" && tok.text === "fail") {
      nodes.push(parseFailStmt());
      continue;
    }

    // FUNCTION DECLARATION: `[pure | async] [server] function name(params) [route="path"] [method="METHOD"] { body }`
    // `pure` tokenizes as IDENT; accepted only immediately before `function` or `server function`.
    // `async` tokenizes as KEYWORD; accepted only immediately before `function` or `server function`
    //   (S89 §13.2 Sub-Phase B — extends auto-await classification per §13.2.1).
    const _pureFnLookahead = tok.text === "pure" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "function") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "function")
    );
    const _asyncFunctionLookahead = tok.kind === "KEYWORD" && tok.text === "async" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "function") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "function")
    );
    if (
      tok.kind === "KEYWORD" && tok.text === "function" ||
      (tok.kind === "KEYWORD" && tok.text === "server" && peek(1).kind === "KEYWORD" && peek(1).text === "function") ||
      _pureFnLookahead ||
      _asyncFunctionLookahead
    ) {
      let isServer = false;
      let isPure = false;
      let isAsync = false;
      let startTok = tok;

      if (tok.text === "pure") {
        isPure = true;
        startTok = consume(); // consume `pure`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (tok.kind === "KEYWORD" && tok.text === "async") {
        // S89 §13.2 Sub-Phase B — `async function` (stdlib carve-out per §13.1).
        // The flag is recorded unconditionally here; the user-source rejection
        // (I-ASYNC-USER-SOURCE per §13.1) is a separate post-parse lint, not
        // a TAB-time error (the lint needs filePath context to decide whether
        // the file is inside the stdlib).
        isAsync = true;
        startTok = consume(); // consume `async`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (tok.text === "server") {
        isServer = true;
        startTok = consume(); // consume `server`
      }
      consume(); // consume `function`

      // Detect generator function: `server function*` (§36)
      let isGenerator = false;
      if (peek().text === "*") {
        isGenerator = true;
        consume(); // consume `*`
      }

      let name = "";
      let nameTok = null;
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        nameTok = peek();
        name = consume().text;
      }
      // §6.8: `reset` is a reserved identifier — declaring `function reset() {}` shadows the keyword.
      if (nameTok && nameTok.kind === "KEYWORD" && name === "reset") {
        errors.push(new TABError(
          "E-RESERVED-IDENTIFIER",
          `E-RESERVED-IDENTIFIER: \`function reset() {...}\` shadows the reserved \`reset\` keyword (§6.8). Rename the function (e.g., \`clearCount\`) or use \`reset(@cell)\` instead.`,
          tokenSpan(nameTok, filePath),
        ));
      }

      const params = parseParamList();

      // Parse optional `!` (canFail) and error-type annotation after parameter list.
      // Two recognized shapes:
      //   1. `! -> ErrorType { body }` — arrow form per SPEC §19.4.1 normative grammar.
      //   2. `! ErrorType { body }`    — bare form per SPEC §41.14 examples (and the
      //                                  shape 4/4 R25 adopters reach for; closes
      //                                  R25-Bug-36 silent body-drop on this canonical
      //                                  CRUD-server-fn shape).
      // Disambiguation for the bare form: the IDENT/KEYWORD after `!` is the
      // error-type name UNLESS it's `route`/`method` (the well-known function-decl
      // attribute names — those would be followed by `=`), OR is followed by `(`
      // (call expression — but `!` followed by an unbound call has no valid
      // function-decl reading anyway), OR is the keyword `is` / `or` / `and`
      // (binary-operator continuations from a misplaced earlier expression).
      // We additionally require the IDENT's NEXT token to be `{` (body opener)
      // / `route` / `method` / `.idempotent` / `:` / `->` / `;` / EOF — any of
      // the well-formed continuations of a function-decl head.
      let canFail = false;
      let errorType = undefined;
      if (peek().text === "!") {
        consume(); // consume `!`
        canFail = true;
        if (peek().text === "-" && peek(1)?.text === ">") {
          // `! -> ErrorType` arrow form (SPEC §19.4.1 normative grammar).
          consume(); // consume `-`
          consume(); // consume `>`
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            errorType = consume().text;
          }
        } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          // `! ErrorType` bare form (SPEC §41.14 examples; widely adopted).
          // Skip if the IDENT itself is a function-decl attribute keyword
          // (`route`/`method` are lowercase IDENT — enum-types convention is
          // UpperCase). Also skip if the next token suggests a non-error-type
          // continuation (`=` — `route="..."` attribute; `(` — call expression).
          const tokText = peek().text;
          const tokIsAttrKw = tokText === "route" || tokText === "method";
          const next1 = peek(1);
          const next1Text = next1?.text ?? "";
          const next1IsContinuation = (
            next1Text === "{" ||                                                // body opener
            next1Text === "route" || next1Text === "method" ||                  // route/method= attr
            (next1Text === "." && peek(2)?.text === "idempotent") ||            // .idempotent() modifier
            next1Text === ":" ||                                                // : returnType
            (next1Text === "-" && peek(2)?.text === ">") ||                     // -> returnType
            next1Text === ";" ||                                                // bare statement end
            !next1 || next1.kind === "EOF"
          );
          if (!tokIsAttrKw && next1IsContinuation) {
            errorType = consume().text;
          }
        }
      }

      // §19.9.7 (A9 Ext 5): `.idempotent()` modifier — developer-asserted escape
      // hatch from the §19.9.6 static monotonicity classifier. Positions: between
      // the `!` modifier (if present) and the return-type / route / body. The
      // modifier is a function-decl-level suffix; takes no arguments.
      let idempotentModifier = false;
      if (peek().text === "." && peek(1)?.text === "idempotent" &&
          peek(2)?.text === "(" && peek(3)?.text === ")") {
        consume(); // consume `.`
        consume(); // consume `idempotent`
        consume(); // consume `(`
        consume(); // consume `)`
        idempotentModifier = true;
      }

      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Handles: `: Mario`, `-> string`, `: Array<Thing>`, `: number(>0)`, etc.
      // A1c C16 — capture the annotation text for §53.9.3 return-stmt checks
      // (with paren-depth tracking so refinement predicates don't over-consume).
      let hasReturnType = false;
      let returnTypeAnnotation = "";
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      } else if (!canFail && peek().text === "-" && peek(1)?.text === ">") {
        // Non-failable `-> ReturnType` (failable `-> ErrorType` already handled above)
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      }
      // Parse optional route= and method= attributes after parameter list
      let route = undefined;
      let method = undefined;
      while (peek().kind === "IDENT" && (peek().text === "route" || peek().text === "method")) {
        const attrName = consume().text; // consume attribute name
        if (peek().text === "=") {
          consume(); // consume `=`
          if (peek().kind === "STRING") {
            const value = consume().text;
            if (attrName === "route") route = value;
            else if (attrName === "method") method = value;
          }
        }
      }

      let body = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        body = parseRecursiveBody();
      }

      nodes.push({
        id: ++counter.next,
        kind: "function-decl",
        name,
        params,
        body,
        fnKind: "function",
        isServer,
        ...(isPure ? { isPure: true } : {}),
        // S89 §13.2 Sub-Phase B — async modifier surfaces Promise<T> return.
        ...(isAsync ? { isAsync: true } : {}),
        isGenerator,
        canFail,
        errorType,
        route,
        method,
        // §39.3.2 + §12.2 Trigger 8 (D2, server-keyword-eliminate): the middleware
        // handle() escape hatch is recognized by its RESERVED NAME + SIGNATURE SHAPE,
        // independent of the deprecated `server` keyword. The §39.3.2 signature is
        // `handle(request, resolve)` — exactly two params named `request` + `resolve`.
        // Requiring the signature (not name alone) avoids over-firing on unrelated
        // `function handle()` / `function handle(e, tag)` declarations in user code.
        // CG weaves on this flag (emit-functions.ts / emit-server.ts); RI Trigger 8
        // adds the `middleware-handle` escalation reason when it is set, so a keyword-
        // less `function handle(request, resolve)` still escalates server AND weaves.
        isHandleEscapeHatch:
          !isGenerator &&
          name === 'handle' &&
          Array.isArray(params) &&
          params.length === 2 &&
          params[0] && params[0].name === 'request' &&
          params[1] && params[1].name === 'resolve',
        ...(hasReturnType ? { hasReturnType: true } : {}),
        ...(returnTypeAnnotation ? { returnTypeAnnotation } : {}),
        // §19.9.7 (A9 Ext 5): `.idempotent()` modifier flag.
        ...(idempotentModifier ? { idempotentModifier: true } : {}),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // FN SHORTHAND: `[pinned] [pure|async] [server] fn name { body }` (no parens)
    // `async` and `pure` tokenize as IDENT; `pinned` tokenizes as IDENT — detect via text + lookahead.
    // S98 §48.6.4 (parser-recognition impl S105): `pinned` is the OUTERMOST modifier.
    const _asyncFnLookahead = tok.text === "async" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    // `pure fn` (§48.2, §33.2; deprecated per §33 — W-PURE-DEPRECATED, supersedes W-PURE-REDUNDANT).
    const _pureFnShorthandLookahead = tok.text === "pure" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    // `pinned fn` (S98 §48.6.4) — `pinned` is IDENT; outermost modifier.
    // Recognizes: `pinned fn`, `pinned async [server] fn`, `pinned pure [server] fn`, `pinned server fn`.
    const _pinnedFnLookahead = tok.kind === "IDENT" && tok.text === "pinned" && (() => {
      const p1 = peek(1);
      if (!p1) return false;
      if (p1.kind === "KEYWORD" && p1.text === "fn") return true;
      if (p1.kind === "KEYWORD" && p1.text === "server" &&
          peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn") return true;
      if ((p1.kind === "IDENT" || p1.kind === "KEYWORD") &&
          (p1.text === "async" || p1.text === "pure")) {
        if (peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn") return true;
        if (peek(2)?.kind === "KEYWORD" && peek(2)?.text === "server" &&
            peek(3)?.kind === "KEYWORD" && peek(3)?.text === "fn") return true;
      }
      return false;
    })();
    if (
      tok.kind === "KEYWORD" && tok.text === "fn" ||
      (tok.kind === "KEYWORD" && tok.text === "server" && peek(1).kind === "KEYWORD" && peek(1).text === "fn") ||
      _asyncFnLookahead ||
      _pureFnShorthandLookahead ||
      _pinnedFnLookahead
    ) {
      // E-PARSE-002: `fn` shorthand is only valid in a logic context, not meta or other blocks
      if (blockContext !== "logic") {
        errors.push(new TABError(
          "E-PARSE-002",
          `E-PARSE-002: \`fn\` can only be used inside a \`\${ }\` logic block. ` +
          `Here it appears inside a ${contextLabel(blockContext)} block, where it is not valid. ` +
          `Use a standard \`function\` declaration instead, or move the function definition into a \`\${ }\` block.`,
          tokenSpan(tok, filePath),
        ));
      }

      let isServer = false;
      let isAsync = false;
      let isPure = false;
      let isPinned = false;
      let startTok = tok;

      // S98 §48.6.4 — consume `pinned` first (outermost modifier).
      let dispatchText = tok.text;
      if (_pinnedFnLookahead) {
        isPinned = true;
        consume(); // consume `pinned`
        dispatchText = peek().text;
      }
      if (dispatchText === "async") {
        isAsync = true;
        consume(); // consume `async`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (dispatchText === "pure") {
        isPure = true;
        consume(); // consume `pure`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (dispatchText === "server") {
        isServer = true;
        consume(); // consume `server`
      }
      consume(); // consume `fn`

      let name = "";
      let nameTok = null;
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        nameTok = peek();
        name = consume().text;
      }
      // §6.8: `reset` is a reserved identifier — declaring `fn reset {...}` shadows the keyword.
      if (nameTok && nameTok.kind === "KEYWORD" && name === "reset") {
        errors.push(new TABError(
          "E-RESERVED-IDENTIFIER",
          `E-RESERVED-IDENTIFIER: \`fn reset {...}\` shadows the reserved \`reset\` keyword (§6.8). Rename the function (e.g., \`clearCount\`) or use \`reset(@cell)\` instead.`,
          tokenSpan(nameTok, filePath),
        ));
      }

      // fn can optionally have a param list
      let params = [];
      if (peek().text === "(") {
        params = parseParamList();
      }

      // Parse optional `!` (canFail) and error-type annotation after parameter list.
      // Parallel to the `function`-decl site (~L8552); see that comment for the full
      // shape rationale + disambiguation table. Both arrow form (`! -> ErrorType {`)
      // and bare form (`! ErrorType {`, SPEC §41.14) are recognized.
      let canFail = false;
      let errorType = undefined;
      if (peek().text === "!") {
        consume(); // consume `!`
        canFail = true;
        if (peek().text === "-" && peek(1)?.text === ">") {
          consume(); // consume `-`
          consume(); // consume `>`
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            errorType = consume().text;
          }
        } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          const tokText = peek().text;
          const tokIsAttrKw = tokText === "route" || tokText === "method";
          const next1 = peek(1);
          const next1Text = next1?.text ?? "";
          const next1IsContinuation = (
            next1Text === "{" ||
            next1Text === "route" || next1Text === "method" ||
            (next1Text === "." && peek(2)?.text === "idempotent") ||
            next1Text === ":" ||
            (next1Text === "-" && peek(2)?.text === ">") ||
            next1Text === ";" ||
            !next1 || next1.kind === "EOF"
          );
          if (!tokIsAttrKw && next1IsContinuation) {
            errorType = consume().text;
          }
        }
      }

      // §19.9.7 (A9 Ext 5): `.idempotent()` modifier — see also `function`-decl
      // site above. Same shape; recognized at the `fn` shorthand site for parity.
      let idempotentModifier = false;
      if (peek().text === "." && peek(1)?.text === "idempotent" &&
          peek(2)?.text === "(" && peek(3)?.text === ")") {
        consume(); // consume `.`
        consume(); // consume `idempotent`
        consume(); // consume `(`
        consume(); // consume `)`
        idempotentModifier = true;
      }

      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Handles: `: Mario`, `: HurtResult`, `-> string`, `: Array<Thing>`, `: number(>0)`, etc.
      // A1c C16 — capture the annotation text for §53.9.3 return-stmt checks
      // (with paren-depth tracking so refinement predicates don't over-consume).
      let hasReturnType = false;
      let returnTypeAnnotation = "";
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      } else if (!canFail && peek().text === "-" && peek(1)?.text === ">") {
        // Non-failable `-> ReturnType` (failable `-> ErrorType` already handled above)
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        let angleDepth = 0;
        let parenDepth = 0;
        const _retToks = [];
        while (peek().kind !== "EOF") {
          const _t = peek().text;
          if (_t === "(") { parenDepth++; _retToks.push(consume().text); }
          else if (_t === ")") { parenDepth--; _retToks.push(consume().text); }
          else if (_t === "<" && parenDepth === 0) { angleDepth++; _retToks.push(consume().text); }
          else if (_t === ">" && parenDepth === 0) { angleDepth--; _retToks.push(consume().text); }
          else if (_t === "{" && angleDepth === 0 && parenDepth === 0) break;
          else _retToks.push(consume().text);
        }
        returnTypeAnnotation = _retToks.join(" ").trim();
      }
      let body = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        body = parseRecursiveBody();
      }

      nodes.push({
        id: ++counter.next,
        kind: "function-decl",
        name,
        params,
        body,
        fnKind: "fn",
        isServer,
        ...(isAsync ? { isAsync: true } : {}),
        ...(isPure ? { isPure: true } : {}),
        ...(isPinned ? { isPinned: true } : {}),
        canFail,
        errorType,
        ...(hasReturnType ? { hasReturnType: true } : {}),
        ...(returnTypeAnnotation ? { returnTypeAnnotation } : {}),
        // §19.9.7 (A9 Ext 5): `.idempotent()` modifier flag.
        ...(idempotentModifier ? { idempotentModifier: true } : {}),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // LABEL PREFIX in main loop: `label: while (...)` or `label: do { ... }` or `label: for (...)`
    if (tok.kind === "IDENT" && peek(1)?.kind === "PUNCT" && peek(1)?.text === ":" &&
        peek(2)?.kind === "KEYWORD" && (peek(2)?.text === "while" || peek(2)?.text === "do" || peek(2)?.text === "for")) {
      const labelTok = consume();  // consume label identifier
      const labelName = labelTok.text;
      consume();  // consume ":"
      // Re-read the current token and handle as a loop statement below
      const loopTok = peek();
      let loopNode = null;
      if (loopTok.text === "while") {
        consume(); // consume `while`
        const { expr: condition } = collectExpr("{");
        let body = [];
        if (peek().text === "{") { consume(); body = parseRecursiveBody(); }
        loopNode = { id: ++counter.next, kind: "while-stmt", label: labelName, condition: condition.trim(), condExpr: safeParseExprToNode(condition.trim(), 0), body, span: spanOf(labelTok, peek()) };
      } else if (loopTok.text === "do") {
        consume(); // consume `do`
        let body = [];
        if (peek().text === "{") { consume(); body = parseRecursiveBody(); }
        if (peek().kind === "KEYWORD" && peek().text === "while") consume();
        const { expr: condition } = collectExpr();
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        loopNode = { id: ++counter.next, kind: "do-while-stmt", label: labelName, condition: condition.trim(), condExpr: safeParseExprToNode(condition.trim(), 0), body, span: spanOf(labelTok, peek()) };
      } else if (loopTok.text === "for") {
        const forNode = parseOneForStmt();
        if (forNode) { forNode.label = labelName; loopNode = forNode; }
      }
      if (loopNode) nodes.push(loopNode);
      continue;
    }

    // FOR STATEMENT: `for variable in iterable { body }`
    //   OR JS-style: `for (const x of iterable) { body }`
    if (tok.kind === "KEYWORD" && tok.text === "for") {
      const startTok = consume();
      let variable = "item";
      let iterable;
      if (peek().kind === "PUNCT" && peek().text === "(") {
        // JS-style: for (const|let|var x of|in iterable) or C-style: for (init; cond; update)
        consume(); // consume `(`
        // Detect C-style: look for `;` at paren depth 1 before closing `)`
        let isCStyleFor = false;
        {
          let d = 1;
          for (let la = 0; ; la++) {
            const t = peek(la);
            if (t.kind === "EOF") break;
            if (t.kind === "PUNCT" && (t.text === "(" || t.text === "[" || t.text === "{")) d++;
            if (t.kind === "PUNCT" && (t.text === ")" || t.text === "]" || t.text === "}")) {
              d--;
              if (d === 0) break;
            }
            if (d === 1 && t.kind === "PUNCT" && t.text === ";") { isCStyleFor = true; break; }
          }
        }
        if (isCStyleFor) {
          // C-style for: collect raw tokens from `(` to `)` (inclusive)
          // emitForStmt expects iterable in the form "( init; cond; update )"
          const rawParts = ["("];
          let d = 1;
          while (d > 0 && peek().kind !== "EOF") {
            const t = consume();
            rawParts.push(t.text);
            if (t.kind === "PUNCT" && (t.text === "(" || t.text === "[" || t.text === "{")) d++;
            if (t.kind === "PUNCT" && (t.text === ")" || t.text === "]" || t.text === "}")) d--;
          }
          iterable = rawParts.join(" ");
          variable = null;
        } else {
          // for-of / for-in: for (const|let|var x of|in iterable)
          // skip const/let/var
          if (peek().kind === "KEYWORD" && (peek().text === "const" || peek().text === "let" || peek().text === "var")) {
            consume();
          }
          // A5 (2026-05-17) — destructuring LHS: `for (const [a, b] of xs)` or
          // `for (const {a, b: ren} of xs)`. parseDestructurePattern consumes
          // through the matching closer; the result is stored in `variable`
          // as a structured DestructurePattern node.
          if (peek().kind === "PUNCT" && (peek().text === "[" || peek().text === "{")) {
            variable = parseDestructurePattern();
          } else if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            // variable name
            variable = consume().text;
          }
          // Accept `of` (scrml canonical); reject `in` (JS-reflex).
          if (peek().kind === "KEYWORD" && peek().text === "in") {
            const inTok = peek();
            const varDesc = typeof variable === "string" ? variable : "item";
            errors.push(new TABError(
              "E-CTRL-011",
              "E-CTRL-011: `for (... in ...)` is not supported — scrml uses `for (" + (varDesc || "item") + " of <iterable>)`. " +
              "`in` iterates object keys in JavaScript; scrml iterates values via `of`.",
              tokenSpan(inTok, filePath),
            ));
            consume();
          } else if (peek().kind === "KEYWORD" && peek().text === "of") {
            consume();
          }
          // collect iterable expression up to `)`
          const { expr: iterExpr } = collectExpr(")");
          iterable = iterExpr.trim();
          if (peek().kind === "PUNCT" && peek().text === ")") {
            consume(); // consume `)`
          }
        }
      } else {
        // scrml-style: for variable in iterable
        if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
          variable = consume().text;
        }
        // Consume `in` keyword
        if (peek().kind === "KEYWORD" && peek().text === "in") {
          consume();
        }
        const { expr: iterExpr } = collectExpr("{");
        iterable = iterExpr.trim();
      }
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      // Phase 4: detect C-style for-loop and parse parts individually
      const _cStyleMatch2 = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
      const _cStyleParts2 = _cStyleMatch2 ? {
        initExpr: safeParseExprToNode(_cStyleMatch2[1].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), 0),
        condExpr: safeParseExprToNode(_cStyleMatch2[2].trim(), 0),
        updateExpr: safeParseExprToNode(_cStyleMatch2[3].trim().replace(/\s*\+\s*\+/g, "++").replace(/\s*-\s*-/g, "--"), 0),
      } : undefined;
      nodes.push({
        id: ++counter.next,
        kind: "for-stmt",
        variable,
        iterable,
        body,
        iterExpr: safeParseExprToNode(iterable, 0),
        ...(_cStyleParts2 && _cStyleParts2.initExpr && _cStyleParts2.condExpr && _cStyleParts2.updateExpr ? { cStyleParts: _cStyleParts2 } : {}),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // IF STATEMENT
    if (tok.kind === "KEYWORD" && tok.text === "if") {
      const node = parseOneIfStmt();
      if (node) nodes.push(node);
      continue;
    }

    // WHILE STATEMENT: `while condition { body }`
    if (tok.kind === "KEYWORD" && tok.text === "while") {
      const startTok = consume();
      const { expr: condition } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      nodes.push({
        id: ++counter.next,
        kind: "while-stmt",
        condition: condition.trim(),
        body,
        condExpr: safeParseExprToNode(condition.trim(), 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // DO-WHILE STATEMENT
    if (tok.kind === "KEYWORD" && tok.text === "do") {
      const startTok = consume(); // consume `do`
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      if (peek().kind === "KEYWORD" && peek().text === "while") consume();
      const { expr: condition } = collectExpr();
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      nodes.push({
        id: ++counter.next,
        kind: "do-while-stmt",
        condition: condition.trim(),
        body,
        condExpr: safeParseExprToNode(condition.trim(), 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // BREAK STATEMENT: `break;` or `break label;`
    if (tok.kind === "KEYWORD" && tok.text === "break") {
      const startTok = consume();
      let label = null;
      const nextBreak = peek();
      if (nextBreak.kind === "IDENT" && nextBreak.span?.line != null && startTok.span?.line != null && nextBreak.span.line === startTok.span.line) {
        label = consume().text;
      }
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      nodes.push({
        id: ++counter.next,
        kind: "break-stmt",
        label,
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // CONTINUE STATEMENT: `continue;` or `continue label;`
    if (tok.kind === "KEYWORD" && tok.text === "continue") {
      const startTok = consume();
      let label = null;
      const nextCont = peek();
      if (nextCont.kind === "IDENT" && nextCont.span?.line != null && startTok.span?.line != null && nextCont.span.line === startTok.span.line) {
        label = consume().text;
      }
      if (peek().kind === "PUNCT" && peek().text === ";") consume();
      nodes.push({
        id: ++counter.next,
        kind: "continue-stmt",
        label,
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // RETURN STATEMENT: `return expr;`
    // BUG-AST-RETURN-CONST: If the next non-comment token after `return` is a
    // declaration keyword, emit a bare return — the declaration is a separate statement.
    if (tok.kind === "KEYWORD" && tok.text === "return") {
      const startTok = consume();
      const DECL_KW = new Set(["const", "let", "type", "function", "fn"]);
      let lookAhead = 0;
      while (peek(lookAhead).kind === "COMMENT") lookAhead++;
      const next = peek(lookAhead);
      // R24-Bug-31 (S139 / known-gaps Bug 31) — parallel ASI guard for the
      // parseLogicBody main-loop return handler. Same bug, same fix as the
      // parseOneStatement variant above (~L5491). When `return` is followed by
      // a newline-separated next token, ASI fires — emit a bare return so the
      // next statement (which may carry a failable `!{...}`) parses as its own
      // top-level node and is NOT silently absorbed as the return expression.
      // Uses `.span.line` (tokenizer.ts:106 token shape; no flat `.line`).
      {
        const _retLine = startTok?.span?.line;
        const _nextLine = next?.span?.line;
        if (
          next && next.kind !== "EOF" &&
          _nextLine != null && _retLine != null &&
          _nextLine > _retLine
        ) {
          nodes.push({
            id: ++counter.next,
            kind: "return-stmt",
            expr: "",
            span: spanOf(startTok, startTok),
          });
          continue;
        }
      }
      if (next && next.kind === "KEYWORD" && DECL_KW.has(next.text)) {
        nodes.push({
          id: ++counter.next,
          kind: "return-stmt",
          expr: "",
          span: spanOf(startTok, startTok),
        });
        continue;
      }
      // fix-cg-sql-ref-placeholder (S40 follow-up): mirror parseOneStatement —
      // `return ?{...}.method()` collapses to `return /* sql-ref:-1 */.method()`
      // when the BLOCK_REF is left to fall through collectExpr → safeParseExprToNode.
      // Detect the SQL BLOCK_REF here, build the child, and attach as `sqlNode`.
      if (next && next.kind === "BLOCK_REF" && next.block && next.block.type === "sql") {
        for (let i = 0; i < lookAhead; i++) consume();
        const refTok = consume();
        const childNode = buildBlock(refTok.block, filePath, parentBlock.type, counter, errors);
        if (childNode && childNode.kind === "sql") {
          consumeSqlChainedCalls(childNode);
          if (peek().kind === "PUNCT" && peek().text === ";") consume();
          nodes.push({
            id: ++counter.next,
            kind: "return-stmt",
            // raw ?{...} source intentionally NOT stored in `expr` — batch-planner
            // string scanner would otherwise double-count the SQL site (structured walk
            // via sqlNode already counts it once). Empty expr matches the bare-return shape.
            expr: "",
            sqlNode: childNode,
            span: spanOf(startTok, peek()),
          });
          continue;
        }
        // Defensive: child wasn't SQL — fall through.
      }
      const { expr } = collectExpr();
      nodes.push({
        id: ++counter.next,
        kind: "return-stmt",
        expr: expr.trim(),
        exprNode: safeParseExprToNode(expr.trim(), 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // YIELD STATEMENT: SPEC §37 SSE per-event yield + general generator
    // support (SPEC §13 generator carve-out per S114). Mirror of the parseOne
    // Statement `yield` handler (line ~5546); needed here because parseLogic
    // Body's main loop is the file-top-level / synthetic-logic-block dispatch
    // (separate from parseRecursiveBody → parseOneStatement which handles
    // nested function bodies). R25-Bug-42 (S138): without this, `yield ?{...}.method()`
    // at the top level of a synthetic-${-wrapped logic block emitted as
    // `yield;` + standalone SQL statement, discarding the SQL value.
    if (tok.kind === "KEYWORD" && tok.text === "yield") {
      const startTok = consume();
      let yieldLookAhead = 0;
      while (peek(yieldLookAhead).kind === "COMMENT") yieldLookAhead++;
      const yieldNext = peek(yieldLookAhead);
      // Bare `yield;` — generator returns undefined.
      if (!yieldNext || yieldNext.kind === "EOF" || (yieldNext.kind === "PUNCT" && (yieldNext.text === ";" || yieldNext.text === "}"))) {
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        nodes.push({
          id: ++counter.next,
          kind: "yield-stmt",
          expr: "",
          span: spanOf(startTok, peek()),
        });
        continue;
      }
      // `yield ?{...}.method()` — attach structured sqlNode.
      if (yieldNext.kind === "BLOCK_REF" && yieldNext.block && yieldNext.block.type === "sql") {
        for (let _i = 0; _i < yieldLookAhead; _i++) consume();
        const refTok = consume();
        const childNode = buildBlock(refTok.block, filePath, parentBlock.type, counter, errors);
        if (childNode && childNode.kind === "sql") {
          consumeSqlChainedCalls(childNode);
          if (peek().kind === "PUNCT" && peek().text === ";") consume();
          nodes.push({
            id: ++counter.next,
            kind: "yield-stmt",
            expr: "",
            sqlNode: childNode,
            span: spanOf(startTok, peek()),
          });
          continue;
        }
      }
      // General `yield <expr>`.
      const { expr: yieldExpr } = collectExpr();
      nodes.push({
        id: ++counter.next,
        kind: "yield-stmt",
        expr: yieldExpr.trim(),
        exprNode: safeParseExprToNode(yieldExpr.trim(), spanOf(startTok, peek())?.start ?? 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // THROW STATEMENT: §19 Appendix B replaces `throw` with `fail`.
    if (tok.kind === "KEYWORD" && tok.text === "throw") {
      const startTok = consume();
      const { expr } = collectExpr();
      errors.push(new TABError(
        "E-ERROR-006",
        "E-ERROR-006: `throw` is not a scrml keyword — §19 replaces it with `fail`. " +
        "Declare the enclosing function as failable (`function name(...)! -> ErrorType`) " +
        "and use `fail ErrorType::Variant(...)` to surface the error.",
        tokenSpan(startTok, filePath),
      ));
      nodes.push({
        id: ++counter.next,
        kind: "throw-stmt",
        expr: expr.trim(),
        exprNode: safeParseExprToNode(expr.trim(), 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // PARTIAL MATCH: `partial match expr { arms }` — §18.18
    if (tok.kind === "KEYWORD" && tok.text === "partial" && peek(1).kind === "KEYWORD" && peek(1).text === "match") {
      consume(); // consume 'partial'
      const startTok = consume(); // consume 'match'
      const { expr: header } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      nodes.push({
        id: ++counter.next,
        kind: "match-stmt",
        header: header.trim(),
        partial: true,
        body,
        headerExpr: safeParseExprToNode(header.trim(), 0),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // SWITCH / TRY / MATCH — minimal structured handling
    if (tok.kind === "KEYWORD" && (tok.text === "switch" || tok.text === "try" || tok.text === "match")) {
      const startTok = consume();
      const keyword = startTok.text;
      if (keyword === "try") {
        errors.push(new TABError(
          "E-ERROR-007",
          "E-ERROR-007: `try` is not a scrml keyword — §19 has no try/catch/finally. " +
          "Handle failable calls with `!{ ::Variant(e) -> ... }`, the `?` propagation " +
          "operator, or by matching the result enum.",
          tokenSpan(startTok, filePath),
        ));
      }
      // S64 debate-04 verdict A+ #1: switch-stmt stays HARD-ERROR (3-of-3 unanimous).
      if (keyword === "switch") {
        errors.push(new TABError(
          "E-SWITCH-FORBIDDEN",
          "E-SWITCH-FORBIDDEN: `switch` is not a scrml keyword. " +
          "Did you mean: " +
          "`<match for=Type> ... </match>` for structural exhaustive case-analysis " +
          "(Tier 1 block form; produces markup or executes statements per arm), " +
          "or `match expr { .Variant -> ... }` for value-return case-analysis " +
          "(Tier 1 JS-style form; produces a value in expression position)? " +
          "See SPEC §18 for match block-form, primer §1 for the tier ladder.",
          tokenSpan(startTok, filePath),
        ));
      }
      const { expr: header } = collectExpr("{");
      let body = [];
      if (peek().text === "{") {
        consume();
        body = parseRecursiveBody();
      }
      const node = {
        id: ++counter.next,
        kind: `${keyword}-stmt`,
        header: header.trim(),
        body,
        headerExpr: safeParseExprToNode(header.trim(), 0),
        span: spanOf(startTok, peek()),
      };

      // For try statements, look for catch/finally clauses
      if (keyword === "try") {
        if (peek().kind === "KEYWORD" && peek().text === "catch") {
          consume(); // consume "catch"
          const { expr: catchHeader } = collectExpr("{");
          let catchBody = [];
          if (peek().text === "{") {
            consume();
            catchBody = parseRecursiveBody();
          }
          node.catchNode = {
            header: catchHeader.trim(),
            body: catchBody,
          };
        }
        if (peek().kind === "KEYWORD" && peek().text === "finally") {
          consume(); // consume "finally"
          const { expr: finallyHeader } = collectExpr("{");
          let finallyBody = [];
          if (peek().text === "{") {
            consume();
            finallyBody = parseRecursiveBody();
          }
          node.finallyNode = {
            header: finallyHeader.trim(),
            body: finallyBody,
          };
        }
        node.span = spanOf(startTok, peek());
      }

      nodes.push(node);
      continue;
    }

    // TRANSACTION BLOCK: `transaction { body }`
    if (tok.kind === "KEYWORD" && tok.text === "transaction") {
      const startTok = consume(); // consume `transaction`
      let body = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        body = parseRecursiveBody();
      }
      nodes.push({
        id: ++counter.next,
        kind: "transaction-block",
        body,
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // CLEANUP built-in: `cleanup(() => { ... })`
    if (tok.kind === "KEYWORD" && tok.text === "cleanup") {
      const startTok = consume(); // consume `cleanup`
      if (peek().text === "(") {
        consume(); // consume `(`
        // Collect the callback expression until the matching `)`
        const callbackParts = [];
        let depth = 1;
        let lastTok = peek();
        while (depth > 0) {
          const t = peek();
          if (t.kind === "EOF") break;
          if (t.text === "(") depth++;
          if (t.text === ")") {
            depth--;
            if (depth === 0) { lastTok = consume(); break; }
          }
          lastTok = consume();
          if (lastTok.kind === "STRING") {
            // A4: preserve backtick templates so `${...}` interpolations

            // remain template-literal interpolations after re-parsing.

            if (lastTok.isTemplate) {

              callbackParts.push('`' + lastTok.text + '`');

            } else {

              callbackParts.push(reemitJsStringLiteral(lastTok.text));

            }
          } else {
            callbackParts.push(lastTok.text);
          }
        }
        // Consume optional trailing semicolon
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        nodes.push({
          id: ++counter.next,
          kind: "cleanup-registration",
          callback: callbackParts.join(" "),
          callbackExpr: safeParseExprToNode(callbackParts.join(" "), spanOf(startTok, lastTok)?.start ?? 0),
          span: spanOf(startTok, lastTok),
        });
      }
      continue;
    }

    // WHEN reactive effect: `when @var changes { body }` or `when (@var1, @var2) changes { body }`
    // §4.12.4: WHEN MESSAGE lifecycle: `when message(binding) { body }` — worker message handler
    if (tok.kind === "KEYWORD" && tok.text === "when") {
      const startTok = consume(); // consume `when`

      // §4.12.4: Check for `when message(binding) { ... }` or
      // `when message from _scrml_worker_name (binding) { ... }` or
      // `when error from _scrml_worker_name (binding) { ... }`
      if (peek().kind === "IDENT" && (peek().text === "message" || peek().text === "error")) {
        const eventType = consume().text; // consume `message` or `error`
        let workerName = null; // null = inside-worker (no `from`)
        // Check for `from _scrml_worker_name`
        if ((peek().kind === "KEYWORD" || peek().kind === "IDENT") && peek().text === "from") {
          consume(); // consume `from`
          if (peek().kind === "IDENT") {
            const workerRef = consume().text; // consume `_scrml_worker_name`
            // Extract name from _scrml_worker_NAME pattern
            const m = workerRef.match(/^_scrml_worker_(.+)$/);
            workerName = m ? m[1] : workerRef;
          }
        }
        let binding = "data"; // default binding name
        if (peek().text === "(") {
          consume(); // consume `(`
          if (peek().kind === "IDENT") {
            binding = consume().text;
          }
          if (peek().text === ")") consume(); // consume `)`
        }
        // Parse body: `{ ... }`
        const bodyParts = [];
        if (peek().text === "{") {
          consume(); // consume `{`
          let depth = 1;
          let lastTok = peek();
          while (depth > 0 && peek().kind !== "EOF") {
            const t = peek();
            if (t.text === "{") depth++;
            if (t.text === "}") {
              depth--;
              if (depth === 0) { lastTok = consume(); break; }
            }
            lastTok = consume();
            if (lastTok.kind === "STRING") {
              // A4: preserve backtick templates so `${...}` interpolations

              // remain template-literal interpolations after re-parsing.

              if (lastTok.isTemplate) {

                bodyParts.push('`' + lastTok.text + '`');

              } else {

                bodyParts.push(reemitJsStringLiteral(lastTok.text));

              }
            } else {
              bodyParts.push(lastTok.text);
            }
          }
          const _whenWorkerBody = bodyParts.join(" ");
          nodes.push({
            id: ++counter.next,
            kind: workerName ? "when-worker-" + eventType : "when-message",
            eventType,
            workerName,
            binding,
            bodyRaw: _whenWorkerBody,
            bodyExpr: safeParseExprToNode(_whenWorkerBody, spanOf(startTok, lastTok)?.start ?? 0),
            span: spanOf(startTok, lastTok),
          });
        }
        continue;
      }

      const dependencies = [];

      // Parse dependency list: either single @var or parenthesized (@var1, @var2)
      if (peek().text === "(") {
        consume(); // consume `(`
        while (peek().text !== ")" && peek().kind !== "EOF") {
          if (peek().kind === "AT_IDENT") {
            dependencies.push(consume().text.replace(/^@/, ""));
          } else if (peek().text === ",") {
            consume(); // skip comma
          } else {
            consume(); // skip unexpected token
          }
        }
        if (peek().text === ")") consume(); // consume `)`
      } else if (peek().kind === "AT_IDENT") {
        dependencies.push(consume().text.replace(/^@/, ""));
      }

      // Expect `changes` keyword
      if (peek().kind === "KEYWORD" && peek().text === "changes") {
        consume(); // consume `changes`
      }

      // Parse body: `{ ... }`
      const bodyNodes = [];
      if (peek().text === "{") {
        consume(); // consume `{`
        let depth = 1;
        const bodyParts = [];
        let lastTok = peek();
        while (depth > 0 && peek().kind !== "EOF") {
          const t = peek();
          if (t.text === "{") depth++;
          if (t.text === "}") {
            depth--;
            if (depth === 0) { lastTok = consume(); break; }
          }
          lastTok = consume();
          if (lastTok.kind === "STRING") {
            // A4: preserve backtick templates so `${...}` interpolations

            // remain template-literal interpolations after re-parsing.

            if (lastTok.isTemplate) {

              bodyParts.push('`' + lastTok.text + '`');

            } else {

              bodyParts.push(reemitJsStringLiteral(lastTok.text));

            }
          } else {
            bodyParts.push(lastTok.text);
          }
        }
        // Store body as raw expression string for emit-logic to rewrite
        if (bodyParts.length > 0) {
          bodyNodes.push(bodyParts.join(" "));
        }

        const _whenEffectBody = bodyParts.join(" ");
        nodes.push({
          id: ++counter.next,
          kind: "when-effect",
          dependencies,
          bodyRaw: _whenEffectBody,
          bodyExpr: safeParseExprToNode(_whenEffectBody, spanOf(startTok, lastTok)?.start ?? 0),
          span: spanOf(startTok, lastTok),
        });
      }
      continue;
    }

    // UPLOAD built-in: `upload(file, url)`
    if (tok.kind === "KEYWORD" && tok.text === "upload") {
      const startTok = consume(); // consume `upload`
      if (peek().text === "(") {
        consume(); // consume `(`
        // Collect first arg (file)
        const fileParts = [];
        let depth = 1;
        let lastTok = peek();
        while (true) {
          const t = peek();
          if (t.kind === "EOF") break;
          if (t.text === "(") depth++;
          if (t.text === ")") {
            depth--;
            if (depth === 0) { lastTok = consume(); break; }
          }
          if (t.text === "," && depth === 1) { consume(); break; }
          lastTok = consume();
          fileParts.push(lastTok.text);
        }
        // Collect second arg (url)
        const urlParts = [];
        depth = 1;
        while (depth > 0) {
          const t = peek();
          if (t.kind === "EOF") break;
          if (t.text === "(") depth++;
          if (t.text === ")") {
            depth--;
            if (depth === 0) { lastTok = consume(); break; }
          }
          lastTok = consume();
          if (lastTok.kind === "STRING") {
            // A4: preserve backtick templates so `${...}` interpolations

            // remain template-literal interpolations after re-parsing.

            if (lastTok.isTemplate) {

              urlParts.push('`' + lastTok.text + '`');

            } else {

              urlParts.push(reemitJsStringLiteral(lastTok.text));

            }
          } else {
            urlParts.push(lastTok.text);
          }
        }
        // Consume optional trailing semicolon
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        const _uploadFile = fileParts.join(" ").trim();
        const _uploadUrl = urlParts.join(" ").trim();
        nodes.push({
          id: ++counter.next,
          kind: "upload-call",
          file: _uploadFile,
          fileExpr: safeParseExprToNode(_uploadFile, spanOf(startTok, lastTok)?.start ?? 0),
          url: _uploadUrl,
          urlExpr: safeParseExprToNode(_uploadUrl, spanOf(startTok, lastTok)?.start ?? 0),
          span: spanOf(startTok, lastTok),
        });
      }
      continue;
    }

    // S81 OQ-2 (2026-05-11): `debounce(fn, ms)` / `throttle(fn, ms)` special-
    // form parsing RETIRED. The KEYWORD reservation was dropped at tokenizer.ts
    // around line 70; `debounce`/`throttle` now tokenize as IDENT and fall
    // through to regular expression-parsing (CallExpr with ident callee).
    // Canonical surfaces:
    //   - state-decl attribute `<x debounced=Nms>` per §6.13 (S79 Approach B)
    //   - stdlib `import { debounce, throttle } from "scrml:time"` per §41
    // The companion AST kinds `debounce-call` / `throttle-call` are removed
    // from types/ast.ts; emit-logic / emit-client / component-expander case
    // arms removed; runtime helpers `_scrml_debounce` / `_scrml_throttle`
    // removed from runtime-template.js.

    // GIVEN: `given ident [, ident]* => { body }` — §42.2.3 presence guard
    // Single: `given x => { body }` — execute body if x is not null/undefined
    // Multi: `given x, y => { body }` — all-or-nothing; body runs only if ALL vars present
    if (tok.kind === "KEYWORD" && tok.text === "given") {
      const startTok = consume(); // consume 'given'
      const variables = [];
      // Collect comma-separated plain identifiers (§42.2.3 v1: no property paths)
      while (peek().kind === "IDENT" || peek().kind === "AT_IDENT") {
        const identTok = consume();
        let name = identTok.text;
        if (name.startsWith("@")) name = name.slice(1); // strip @ if user wrote @x
        // §42.2.3: `given` takes plain identifiers, NOT property paths. Reject `given u.name`.
        if (peek().kind === "PUNCT" && peek().text === ".") {
          errors.push(new TABError(
            "E-SYNTAX-044",
            `E-SYNTAX-044: \`given\` takes bare identifiers, not property paths (§42.2.3). ` +
            `Bind the property to a local variable first: \`let n = ${name}.<field>\`, then \`given n { ... }\`.`,
            tokenSpan(identTok, filePath),
          ));
          // Skip past `.ident(.ident)*` to keep parsing going
          while (peek().kind === "PUNCT" && peek().text === ".") {
            consume(); // consume '.'
            if (peek().kind === "IDENT" || peek().kind === "KEYWORD") consume();
          }
        }
        variables.push(name);
        if (peek().kind === "PUNCT" && peek().text === ",") {
          consume(); // consume ','
        } else {
          break;
        }
      }
      // consume the separator. `:>` canonical, `=>` deprecated alias
      // (§42.2.3, S148) — both single OPERATOR tokens via tokenizeLogic;
      // isMatchArrow accepts either. Record which glyph the source used so the
      // W-GIVEN-ARROW-LEGACY lint + `migrate --fix` can see the deprecated form
      // (mirrors the match-arm `armArrow` field — S147).
      let separatorGlyph = ":>";
      if (isMatchArrow(peek())) {
        separatorGlyph = peek().text === "=>" ? "=>" : ":>";
        consume(); // consume the arm separator
      }
      // parse body
      let body = [];
      if (peek().kind === "PUNCT" && peek().text === "{") {
        consume(); // consume '{'
        body = parseRecursiveBody();
      }
      nodes.push({
        id: ++counter.next,
        kind: "given-guard",
        variables,
        separatorGlyph,
        body,
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // LIN-DECL: `lin name = expr` → linear type variable declaration (§35.2)
    // lin is now a KEYWORD. Detect before TILDE-DECL so bare `lin` as KEYWORD doesn't fall through.
    // A bare `lin` not followed by `IDENT =` falls through to bare-expr (unusual back-compat).
    if (tok.kind === "KEYWORD" && tok.text === "lin") {
      const nameTok = peek(1);
      const eqTok = peek(2);
      if (nameTok?.kind === "IDENT" &&
          eqTok?.kind === "PUNCT" && eqTok.text === "=" &&
          peek(3)?.text !== "=") {
        const startTok = consume();          // consume "lin"
        const name = consume().text;         // consume IDENT name
        consume();                           // consume "="
        const { expr } = collectExpr();
        nodes.push({ id: ++counter.next, kind: "lin-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), span: spanOf(startTok, peek()) });
        continue;
      }
      // fall through: bare `lin` expression (not a declaration)
    }

    // TILDE-DECL: bare `name = expr` (no keyword) → ~-typed must-use variable
    // Same pattern as let-decl but triggered by IDENT (not a keyword)
    // Exclusions: dotted (obj.prop=), bracket (arr[i]=), augmented (name+=), comparison (name==)
    // All exclusions are automatic: peek(1) won't be PUNCT "=" for those cases.
    if (tok.kind === "IDENT") {
      const nextTok = peek(1);
      if (nextTok && nextTok.kind === "PUNCT" && nextTok.text === "=" && peek(2)?.text !== "=") {
        const startTok = consume(); // consume IDENT (the name)
        const name = startTok.text;
        consume(); // consume `=`
        const { expr, span } = collectExpr();
        nodes.push({ id: ++counter.next, kind: "tilde-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), span: spanOf(startTok, peek()) });
        continue;
      }
    }

    // E-SYNTAX-043: Detect old `(x) =>` presence guard syntax (§42.2.3)
    // The old form `(x) => { body }` is removed; use `given x => { body }` instead.
    if (isOldPresenceGuardPattern()) {
      const guardStart = peek();
      // Consume the entire `( IDENT [, IDENT]* ) =>` header
      consume(); // consume `(`
      while (!(peek().kind === "PUNCT" && peek().text === ")") && peek().kind !== "EOF") consume();
      if (peek().kind === "PUNCT" && peek().text === ")") consume(); // consume `)`
      if (isMatchArrow(peek())) consume(); // consume `=>`
      // Drain the body `{ ... }` if present, to prevent cascade errors
      if (peek().kind === "PUNCT" && peek().text === "{") {
        consume(); // consume `{`
        collectBracedBody(); // drain body tokens
      }
      errors.push(new TABError(
        "E-SYNTAX-043",
        `E-SYNTAX-043: \`(x) =>\` presence guard syntax is no longer valid. ` +
        `Use \`given x => { ... }\` instead. ` +
        `The old \`(x) =>\` form was removed when the \`given\` keyword was introduced (§42.2.3).`,
        tokenSpan(guardStart, filePath),
      ));
      continue;
    }

    // §6.7.1a: ON MOUNT — `on mount { body }` desugars to bare-expr
    // 'on' and 'mount' are both IDENTs (not keywords), so check by text.
    if (tok.kind === "IDENT" && tok.text === "on" &&
        peek(1)?.kind === "IDENT" && peek(1)?.text === "mount" &&
        peek(2)?.text === "{") {
      const startTok = consume(); // consume 'on'
      consume();                  // consume 'mount'
      consume();                  // consume '{'
      const { body, span: bodySpan } = collectBracedBody();
      nodes.push({ id: ++counter.next, kind: "bare-expr", expr: body, exprNode: safeParseExprToNode(body, 0), span: spanOf(startTok, peek()) });
      continue;
    }

    // §6.7.1b: ON DISMOUNT — `on dismount { body }` desugars to cleanup(() => { body })
    if (tok.kind === "IDENT" && tok.text === "on" &&
        peek(1)?.kind === "IDENT" && peek(1)?.text === "dismount" &&
        peek(2)?.text === "{") {
      const startTok = consume(); // consume 'on'
      consume();                  // consume 'dismount'
      consume();                  // consume '{'
      const { body, span: bodySpan } = collectBracedBody();
      const _dm2 = `cleanup(() => { ${body} })`;
      nodes.push({ id: ++counter.next, kind: "bare-expr", expr: _dm2, exprNode: safeParseExprToNode(_dm2, 0), span: spanOf(startTok, peek()) });
      continue;
    }

    // Phase A1a Step 2 — V5-strict structural state-decl: `<NAME> = expr` (Shape 1).
    // Recognized at top-level statement-start position inside `${...}` logic
    // blocks. Mirrors the parseOneStatement hook for nested bodies. Without
    // this hook, `<count> = 0` is silently swallowed as `kind: "html-fragment"`
    // (PARSER-AUDIT §F1c — the deceptive-success pattern).
    if (tok.kind === "PUNCT" && tok.text === "<") {
      const declNode = tryParseStructuralDecl(tok, false);
      if (declNode) {
        nodes.push(declNode);
        continue;
      }
    }

    // Anything else: BareExpr or html-fragment — collect until statement boundary
    {
      const startTok = peek();
      const { expr, span } = collectExpr();
      if (expr.trim().length > 0) {
        // Check for `?` propagation suffix on bare expressions
        const stripped = expr.trimEnd();
        if (stripped.endsWith("?")) {
          const innerExpr = stripped.slice(0, -1).trimEnd();
          nodes.push({
            id: ++counter.next,
            kind: "propagate-expr",
            binding: null,
            expr: innerExpr,
            exprNode: safeParseExprToNode(innerExpr, 0),
            span,
          });
        } else if (isHtmlFragment(expr)) {
          // §4.15 — Structural-element misplacement in `${...}` logic-body context
          // (top-level loop). See parseOneStatement html-fragment fallback for the
          // full rationale. Fires E-STRUCTURAL-ELEMENT-MISPLACED when the leading
          // tag is in the structural-element registry; the html-fragment node is
          // still pushed so downstream stage shapes stay stable.
          const _seName = leadingTagName(expr);
          if (_seName && Object.prototype.hasOwnProperty.call(STRUCTURAL_ELEMENT_PLACEMENT, _seName)) {
            errors.push(new TABError(
              "E-STRUCTURAL-ELEMENT-MISPLACED",
              `E-STRUCTURAL-ELEMENT-MISPLACED: \`<${_seName}>\` cannot appear inside a \`\${ }\` logic body — ${STRUCTURAL_ELEMENT_PLACEMENT[_seName]}. ` +
              `(§4.15 — scrml-defined structural elements are grammatical only in their owning loci; ` +
              `use outside the owning locus is E-STRUCTURAL-ELEMENT-MISPLACED.)`,
              span,
            ));
          }
          nodes.push({ id: ++counter.next, kind: "html-fragment", content: expr, span });
        } else {
          nodes.push({ id: ++counter.next, kind: "bare-expr", expr, exprNode: safeParseExprToNode(expr, 0), span });
        }
      } else {
        // The current token stopped the collector without being consumed —
        // it is a token this parser cannot classify or advance past.
        // Record an error and consume it to prevent an infinite loop.
        const stuckTok = peek();
        if (stuckTok.kind !== "EOF") {
          const stuckSpan = tokenSpan(stuckTok, filePath);
          // E-META-002 fires inside a meta block; E-PARSE-001 fires everywhere else.
          if (blockContext === "meta") {
            errors.push(new TABError(
              "E-META-002",
              `E-META-002: \`${stuckTok.text}\` is not valid inside a \`^{ }\` meta block. ` +
              `Meta blocks contain logic code, not direct markup. ` +
              `If you intended to emit markup here, use a \`lift\` expression: \`lift <tag>...</tag>\`.`,
              stuckSpan,
            ));
          } else {
            errors.push(new TABError(
              "E-PARSE-001",
              `E-PARSE-001: \`${stuckTok.text}\` is not valid here. ` +
              `Expected a tag name, expression, or block opener (\`\${}\`/\`#{}\`/\`?{}\`/\`^{}\`). ` +
              `Inside a \`\${ }\` logic block, the compiler expects a statement, a \`let\`/\`const\` declaration, an expression, or a \`lift\`. ` +
              `Check that any surrounding expression is complete and all brackets are balanced.`,
              stuckSpan,
            ));
          }
          consume(); // advance past the stuck token to prevent an infinite loop
        }
      }
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// SQL block parser
// ---------------------------------------------------------------------------

/**
 * Parse SQL block tokens into { query, chainedCalls }.
 * @param {Token[]} tokens
 * @param {string} filePath
 * @returns {{ query: string, chainedCalls: ChainCall[] }}
 */
function parseSQLTokens(tokens, filePath) {
  let query = "";
  const chainedCalls = [];
  let i = 0;

  // First token should be SQL_RAW
  if (i < tokens.length && tokens[i].kind === "SQL_RAW") {
    query = tokens[i].text;
    i++;
  }

  // Subsequent tokens: method calls grouped as IDENT, PUNCT((), SQL_ARGS|string, PUNCT())
  while (i < tokens.length && tokens[i].kind !== "EOF") {
    const tok = tokens[i];
    if (tok.kind === "IDENT") {
      const methodName = tok.text;
      i++;
      // Consume `(`
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "(") i++;
      // Consume args
      let args = "";
      if (i < tokens.length && tokens[i].kind === "SQL_ARGS") {
        args = tokens[i].text;
        i++;
      }
      // Consume `)`
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ")") i++;
      chainedCalls.push({
        method: methodName,
        args,
        span: tokenSpan(tok, filePath),
      });
    } else {
      i++;
    }
  }

  return { query, chainedCalls };
}

// ---------------------------------------------------------------------------
// CSS block parser
// ---------------------------------------------------------------------------

/**
 * Parse CSS tokens into CSSRule[].
 * @param {Token[]} tokens
 * @param {string} filePath
 * @returns {CSSRule[]}
 */
/**
 * Scan a CSS value string for `@identifier` reactive variable references and
 * expressions containing them. Returns an array of reactive reference descriptors.
 *
 * Each descriptor: { name: string, expr: string | null }
 *   - `name` is the bare identifier (without `@`)
 *   - `expr` is the full expression string if the `@var` is part of an expression
 *     (e.g., `@x * 2` or `@isDark ? "a" : "b"`), or null for a simple `@var` reference.
 *
 * @param {string} value — the raw CSS value text
 * @returns {{ refs: { name: string, expr: string | null }[], isExpression: boolean }}
 */
function scanCSSValueForReactiveRefs(value) {
  const AT_IDENT_RE = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const refs = [];
  const seenNames = new Set();
  let match;

  while ((match = AT_IDENT_RE.exec(value)) !== null) {
    const name = match[1];
    if (!seenNames.has(name)) {
      seenNames.add(name);
      refs.push({ name });
    }
  }

  if (refs.length === 0) return { refs: [], isExpression: false };

  // Determine if this is a simple @var reference or an expression.
  // A simple reference: the entire value (after trimming) is exactly `@name`
  // or `@name unit` (e.g., `@spacing px`).
  // An expression: contains operators, ternaries, function calls around the @var.
  const trimmed = value.trim();
  const simpleRefRe = /^@[A-Za-z_$][A-Za-z0-9_$]*(\s+[A-Za-z%]+)?$/;
  const isExpression = !simpleRefRe.test(trimmed);

  if (isExpression) {
    // For expressions, attach the full expression string to each ref
    for (const ref of refs) {
      ref.expr = trimmed;
    }
  } else {
    for (const ref of refs) {
      ref.expr = null;
    }
  }

  return { refs, isExpression };
}

function parseCSSTokens(tokens, filePath) {
  const rules = [];
  let i = 0;

  while (i < tokens.length && tokens[i].kind !== "EOF") {
    const tok = tokens[i];
    if (tok.kind === "CSS_PROP") {
      const prop = tok.text;
      const startSpan = tokenSpan(tok, filePath);
      i++;
      // Expect CSS_COLON
      if (i < tokens.length && tokens[i].kind === "CSS_COLON") i++;
      // Expect CSS_VALUE
      let value = "";
      if (i < tokens.length && tokens[i].kind === "CSS_VALUE") {
        value = tokens[i].text;
        i++;
      }
      // Optional CSS_SEMI
      if (i < tokens.length && tokens[i].kind === "CSS_SEMI") i++;

      // Scan for @var reactive references in the CSS value
      const { refs, isExpression } = scanCSSValueForReactiveRefs(value);
      const rule = { prop, value, span: startSpan };
      if (refs.length > 0) {
        rule.reactiveRefs = refs;
        rule.isExpression = isExpression;
      }
      rules.push(rule);
    } else if (tok.kind === "CSS_AT_RULE") {
      // GITI-011: CSS at-rule — store verbatim text for passthrough emission.
      const atRuleSpan = tokenSpan(tok, filePath);
      rules.push({ atRule: tok.text, span: atRuleSpan });
      i++;
      continue;
    } else if (tok.kind === "CSS_SELECTOR") {
      const selector = tok.text;
      const selectorSpan = tokenSpan(tok, filePath);
      i++;
      // If followed by CSS_LBRACE, consume declarations until CSS_RBRACE
      if (i < tokens.length && tokens[i].kind === "CSS_LBRACE") {
        i++; // consume {
        const declarations = [];
        while (i < tokens.length && tokens[i].kind !== "CSS_RBRACE" && tokens[i].kind !== "EOF") {
          if (tokens[i].kind === "CSS_PROP") {
            const prop = tokens[i].text;
            const propSpan = tokenSpan(tokens[i], filePath);
            i++;
            if (i < tokens.length && tokens[i].kind === "CSS_COLON") i++;
            let value = "";
            if (i < tokens.length && tokens[i].kind === "CSS_VALUE") {
              value = tokens[i].text;
              i++;
            }
            if (i < tokens.length && tokens[i].kind === "CSS_SEMI") i++;
            const { refs, isExpression } = scanCSSValueForReactiveRefs(value);
            const decl = { prop, value, span: propSpan };
            if (refs.length > 0) { decl.reactiveRefs = refs; decl.isExpression = isExpression; }
            declarations.push(decl);
          } else {
            i++;
          }
        }
        if (i < tokens.length && tokens[i].kind === "CSS_RBRACE") i++; // consume }
        rules.push({ selector, declarations, span: selectorSpan });
      } else {
        // Selector without braces (unusual, keep as flat selector for backward compat)
        rules.push({ selector, span: selectorSpan });
      }
    } else {
      i++;
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Test block parser (~{})
// ---------------------------------------------------------------------------

/**
 * Parse test block tokens into a TestGroup IR node.
 *
 * Test body syntax:
 *   ~{ ["group name"]
 *     [before { statements }]
 *     test "name" { body }
 *     test "name" { body }
 *     [after { statements }]
 *   }
 *
 * Token kinds produced by tokenizeLogic:
 *   IDENT — identifiers, including "test", "assert", "before", "after"
 *            (these are NOT in the KEYWORDS set so they tokenize as IDENT)
 *   STRING — string literal content (without surrounding quotes)
 *   PUNCT  — single-char punctuation including { and }
 *   OPERATOR — multi-char operators like ==, !=, >=, <=
 *   EOF
 *
 * @param {Token[]} tokens - from tokenizeLogic
 * @param {string} filePath
 * @param {object} span - block span (for line numbers)
 * @param {TABError[]} errors
 * @returns {{ name: string|null, line: number, tests: object[], before: string[]|null, after: string[]|null, testBinds: object[] }}
 */
function parseTestBody(tokens, filePath, span, errors) {
  let i = 0;
  let groupName = null;
  const tests = [];
  let beforeStmts = null;
  let afterStmts = null;
  // SPEC §19.12.6 — `test-bind` declarations at body scope of this `~{}`.
  // Scope-local; does NOT leak to siblings. Phase A6-2 (parser) collects them;
  // A6-3 (typer) validates RHS shape; A6-4 (codegen) emits dispatch hook.
  const testBinds = [];
  // Track declared identifiers for duplicate-detection (SPEC §19.12.6:
  // "A second `test-bind` declaration for the same identifier within the same
  // `~{}` block SHALL be a compile error.").
  const seenBindNames = new Set();

  /**
   * Collect raw statement tokens until a closing } at depth 0, or EOF.
   * Returns an array of raw statement strings.
   */
  function collectBody() {
    const stmts = [];
    let depth = 0;
    let parts = [];

    while (i < tokens.length && tokens[i].kind !== "EOF") {
      const tok = tokens[i];
      if (tok.kind === "PUNCT" && tok.text === "{") {
        depth++;
        parts.push(tokenToSourceText(tok));
        i++;
      } else if (tok.kind === "PUNCT" && tok.text === "}") {
        if (depth === 0) break; // end of this body — do not consume
        depth--;
        parts.push(tokenToSourceText(tok));
        i++;
        if (depth === 0 && parts.length > 0) {
          stmts.push(parts.join(" ").trim());
          parts = [];
        }
      } else {
        parts.push(tokenToSourceText(tok));
        i++;
      }
    }
    if (parts.length > 0) {
      const s = parts.join(" ").trim();
      if (s) stmts.push(s);
    }
    return stmts;
  }

  /**
   * Split a raw assert expression string into { raw, op, lhs, rhs }.
   * Operators checked longest-first to avoid partial matches (>= before >).
   */
  function parseAssertExpr(raw) {
    const ops = ["==", "!=", ">=", "<=", ">", "<"];
    for (const op of ops) {
      const idx = raw.indexOf(op);
      if (idx !== -1) {
        const lhs = raw.slice(0, idx).trim();
        const rhs = raw.slice(idx + op.length).trim();
        if (lhs && rhs) {
          return { raw, op, lhs, rhs };
        }
      }
    }
    return { raw, op: null, lhs: null, rhs: null };
  }

  /**
   * Collect tokens for an assert expression until the next top-level statement
   * boundary: another assert/test/before/after IDENT at depth 0, or } or EOF.
   */
  function collectAssertTokens() {
    const parts = [];
    let depth = 0;
    while (i < tokens.length && tokens[i].kind !== "EOF") {
      const tok = tokens[i];
      if (tok.kind === "PUNCT" && tok.text === "}" && depth === 0) break;
      if (depth === 0 && tok.kind === "IDENT" &&
          (tok.text === "assert" || tok.text === "test" ||
           tok.text === "before" || tok.text === "after")) break;
      // SPEC §19.12.6 — break on `test-bind` sequence at depth 0 so a
      // following `test-bind` declaration is not absorbed into the assert
      // expression. (Mirrors the existing `test`/`assert`/`before`/`after`
      // boundaries above.)
      if (depth === 0 && isTestBindSeq(i)) break;
      if (tok.kind === "PUNCT" && tok.text === "{") depth++;
      else if (tok.kind === "PUNCT" && tok.text === "}") depth--;
      parts.push(tokenToSourceText(tok));
      i++;
    }
    return parts.join(" ").trim();
  }

  /**
   * Reconstruct the source-text shape for a single token when joining tokens
   * back into raw source-text expressions. The tokenizer strips outer quotes
   * from STRING tokens (their `text` field holds unquoted content); naive
   * `tok.text` reuse loses those quotes, producing invalid JS such as
   * `expect(getGreeting ( alice )).toEqual(stubbed-greeting)` instead of
   * `expect(getGreeting("alice")).toEqual("stubbed-greeting")`. Backtick-
   * derived STRING tokens (`isTemplate`) are re-wrapped with backticks so
   * `${...}` substitutions remain live.
   */
  function tokenToSourceText(tok) {
    if (tok.kind === "STRING") {
      if (tok.isTemplate) {
        return "`" + tok.text + "`";
      }
      return JSON.stringify(tok.text);
    }
    return tok.text;
  }

  /**
   * Statement-keyword IDENT tokens that imply a new statement begins when
   * encountered at depth 0 on a source line greater than the previous
   * consumed token's line. Used by the test-case body collector to split
   * newline-separated statements that lack explicit `;` separators.
   *
   * Conservative list — JS keywords that unambiguously begin a statement.
   * Excludes value-keywords (`true`/`false`/`null`/`undefined`/`this`),
   * function-expression starters that may appear mid-expression, and
   * declarations like `class` that may appear mid-RHS.
   */
  function isStmtKeywordToken(text) {
    return (
      text === "let" ||
      text === "const" ||
      text === "var" ||
      text === "return" ||
      text === "throw" ||
      text === "break" ||
      text === "continue" ||
      text === "if" ||
      text === "for" ||
      text === "while" ||
      text === "do" ||
      text === "try" ||
      text === "switch"
    );
  }

  /**
   * Detect the 3-token sequence `IDENT("test") + PUNCT("-") + IDENT("bind")`
   * starting at index `idx`. Returns true iff the sequence is present.
   *
   * SPEC §19.12.6 — `test-bind` declaration syntax. Identifiers in the scrml
   * tokenizer are `[A-Za-z_$][A-Za-z0-9_$]*` (no hyphens), so `test-bind`
   * tokenizes as 3 separate tokens. Detect the sequence here rather than
   * adding `test-bind` to the multi-char keyword set in the tokenizer.
   */
  function isTestBindSeq(idx) {
    return (
      idx + 2 < tokens.length &&
      tokens[idx].kind === "IDENT" && tokens[idx].text === "test" &&
      tokens[idx + 1].kind === "PUNCT" && tokens[idx + 1].text === "-" &&
      tokens[idx + 2].kind === "IDENT" && tokens[idx + 2].text === "bind"
    );
  }

  /**
   * Parse a `test-bind <ident> = <expression>` declaration starting at the
   * `test` IDENT (caller has already verified `isTestBindSeq(i)`). Advances
   * `i` past the entire declaration. Pushes a TestBindDecl to `testBinds`
   * (or, on duplicate identifier, fires E-TEST-005 and skips the duplicate).
   *
   * RHS expression is collected as raw token-text up to the next body-scope
   * statement boundary (next `test`/`assert`/`before`/`after`/`test-bind`
   * keyword at depth 0, closing `}` at depth 0, or EOF). Brace-balanced
   * sub-expressions (object literals, arrow function bodies) are preserved.
   */
  function parseTestBindDecl() {
    const declTok = tokens[i];
    const declLine = (declTok.span && declTok.span.line) ? declTok.span.line : span.line;
    const declSpan = declTok.span
      ? fullSpan(declTok.span, filePath)
      : fullSpan(span, filePath);
    i += 3; // consume test - bind

    // Identifier (LHS)
    let ident = "";
    if (i < tokens.length && tokens[i].kind === "IDENT") {
      ident = tokens[i].text;
      i++;
    } else {
      errors.push(new TABError(
        "E-TEST-005",
        "E-TEST-005: `test-bind` requires an identifier between `test-bind` and `=`. " +
        "Per SPEC §19.12.6, the surface is `test-bind <name> = <expression>` where " +
        "`<name>` resolves to a server function in scope.",
        declSpan,
      ));
      // Skip to next body-scope boundary to recover.
      skipToNextStatement();
      return;
    }

    // `=` separator
    if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "=") {
      i++;
    } else {
      errors.push(new TABError(
        "E-TEST-005",
        `E-TEST-005: \`test-bind ${ident}\` is missing the \`=\` separator. ` +
        "Per SPEC §19.12.6, the surface is `test-bind <name> = <expression>`.",
        declSpan,
      ));
      skipToNextStatement();
      return;
    }

    // RHS expression — collect until next body-scope statement boundary.
    const rhsParts = [];
    let depth = 0;
    while (i < tokens.length && tokens[i].kind !== "EOF") {
      const t = tokens[i];
      if (t.kind === "PUNCT" && t.text === "{") {
        depth++;
        rhsParts.push(tokenToSourceText(t));
        i++;
        continue;
      }
      if (t.kind === "PUNCT" && t.text === "}") {
        if (depth === 0) break; // end of enclosing ~{} body
        depth--;
        rhsParts.push(tokenToSourceText(t));
        i++;
        continue;
      }
      // Statement boundaries at depth 0:
      //   - next `test-bind` sequence
      //   - next `test "..."` (IDENT "test" not followed by `-` `bind`)
      //   - next `assert` IDENT
      //   - next `before` / `after` IDENT
      if (depth === 0 && t.kind === "IDENT") {
        if (isTestBindSeq(i)) break;
        if (t.text === "test" || t.text === "assert" ||
            t.text === "before" || t.text === "after") break;
      }
      rhsParts.push(tokenToSourceText(t));
      i++;
    }
    const expression = rhsParts.join(" ").trim();

    if (!expression) {
      errors.push(new TABError(
        "E-TEST-005",
        `E-TEST-005: \`test-bind ${ident}\` is missing the right-hand-side expression. ` +
        "Per SPEC §19.12.6, the surface is `test-bind <name> = <expression>`.",
        declSpan,
      ));
      return;
    }

    // Duplicate-identifier check (SPEC §19.12.6: "A second `test-bind`
    // declaration for the same identifier within the same `~{}` block SHALL
    // be a compile error.").
    if (seenBindNames.has(ident)) {
      errors.push(new TABError(
        "E-TEST-005",
        `E-TEST-005: duplicate \`test-bind\` declaration for \`${ident}\` in this \`~{}\` block. ` +
        "Per SPEC §19.12.6, a second `test-bind` declaration for the same identifier within " +
        "the same `~{}` block is a compile error. Each declaration binds a distinct server function.",
        declSpan,
      ));
      return;
    }
    seenBindNames.add(ident);

    testBinds.push({
      identifier: ident,
      expression,
      line: declLine,
    });
  }

  /**
   * Recovery helper — advance `i` past the current malformed statement to the
   * next body-scope statement boundary or closing `}`. Mirrors the boundary
   * heuristics used by `parseTestBindDecl`.
   */
  function skipToNextStatement() {
    let depth = 0;
    while (i < tokens.length && tokens[i].kind !== "EOF") {
      const t = tokens[i];
      if (t.kind === "PUNCT" && t.text === "{") { depth++; i++; continue; }
      if (t.kind === "PUNCT" && t.text === "}") {
        if (depth === 0) return;
        depth--; i++; continue;
      }
      if (depth === 0 && t.kind === "IDENT") {
        if (isTestBindSeq(i)) return;
        if (t.text === "test" || t.text === "assert" ||
            t.text === "before" || t.text === "after") return;
      }
      i++;
    }
  }

  // Main parse loop
  while (i < tokens.length && tokens[i].kind !== "EOF") {
    const tok = tokens[i];

    // Group name: leading string literal before any tests or before-block
    if (tok.kind === "STRING" && groupName === null && tests.length === 0 && beforeStmts === null) {
      groupName = tok.text;
      i++;
      continue;
    }

    // before { } block
    if (tok.kind === "IDENT" && tok.text === "before") {
      i++; // consume "before"
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "{") i++;
      beforeStmts = collectBody();
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "}") i++;
      continue;
    }

    // after { } block
    if (tok.kind === "IDENT" && tok.text === "after") {
      i++; // consume "after"
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "{") i++;
      afterStmts = collectBody();
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "}") i++;
      continue;
    }

    // SPEC §19.12.6 — `test-bind <ident> = <expr>` declaration. MUST be
    // checked BEFORE the `IDENT "test"` branch since they share the leading
    // `test` keyword. Body-scope-only at this `~{}` block.
    if (isTestBindSeq(i)) {
      parseTestBindDecl();
      continue;
    }

    // test "name" { } sub-block
    if (tok.kind === "IDENT" && tok.text === "test") {
      const testLine = (tok.span && tok.span.line) ? tok.span.line : span.line;
      i++; // consume "test"

      let testName = "";
      if (i < tokens.length && tokens[i].kind === "STRING") {
        testName = tokens[i].text;
        i++;
      }

      // Consume opening {
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "{") i++;

      const caseBody = [];
      const caseAsserts = [];

      while (i < tokens.length && tokens[i].kind !== "EOF") {
        const inner = tokens[i];
        if (inner.kind === "PUNCT" && inner.text === "}") break;

        // SPEC §19.12.6 — `test-bind` SHALL NOT appear inside a
        // `test "..." {...}` case body. Fire E-TEST-005 and consume the
        // malformed declaration so parsing of subsequent statements proceeds.
        if (isTestBindSeq(i)) {
          const tbTok = tokens[i];
          const tbSpan = tbTok.span
            ? fullSpan(tbTok.span, filePath)
            : fullSpan(span, filePath);
          errors.push(new TABError(
            "E-TEST-005",
            "E-TEST-005: `test-bind` declarations are not legal inside a " +
            "`test \"...\" {...}` case body. Per SPEC §19.12.6, `test-bind` is " +
            "body-scope-only at the `~{}` test-block scope (sibling to `test` " +
            "cases and `assert` statements). Move the `test-bind` declaration " +
            "to the `~{}` block body.",
            tbSpan,
          ));
          // Consume `test - bind <ident> = <expr>` shape if present, else just
          // skip the 3-token sequence to recover.
          i += 3;
          // Skip optional identifier
          if (i < tokens.length && tokens[i].kind === "IDENT") i++;
          // Skip optional `=`
          if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "=") i++;
          // Skip RHS up to next assert/closing-} at depth 0
          let dd = 0;
          while (i < tokens.length && tokens[i].kind !== "EOF") {
            const t2 = tokens[i];
            if (t2.kind === "PUNCT" && t2.text === "}" && dd === 0) break;
            if (dd === 0 && t2.kind === "IDENT" && t2.text === "assert") break;
            if (dd === 0 && isTestBindSeq(i)) break;
            if (t2.kind === "PUNCT" && t2.text === "{") dd++;
            else if (t2.kind === "PUNCT" && t2.text === "}") dd--;
            i++;
          }
          continue;
        }

        if (inner.kind === "IDENT" && inner.text === "assert") {
          i++; // consume "assert"
          const rawExpr = collectAssertTokens();
          const assertNode = parseAssertExpr(rawExpr);
          caseAsserts.push(assertNode);
          caseBody.push("assert " + rawExpr);
        } else {
          // Non-assert statement(s): collect tokens until next assert keyword
          // or }. Split into individual statements on `;` PUNCT at depth 0 OR
          // on a depth-0 statement-keyword IDENT that starts on a new source
          // line. The split-on-newline-keyword case handles the
          // newline-separated form `let a = f()\nlet b = g()` (no explicit
          // `;`); without splitting, the joined-on-spaces output would be
          // `let a = f ( ) let b = g ( )` — invalid JS at bun:test load time.
          // Filed S76 via A6-5 integration testing; closed S77.
          let depth = 0;
          let stmtParts = [];
          let lastLine = -1;
          const flushStmt = () => {
            const s = stmtParts.join(" ").trim();
            if (s) caseBody.push(s);
            stmtParts = [];
          };
          while (i < tokens.length && tokens[i].kind !== "EOF") {
            const t = tokens[i];
            if (t.kind === "PUNCT" && t.text === "}" && depth === 0) break;
            if (depth === 0 && t.kind === "IDENT" && t.text === "assert") break;
            // SPEC §19.12.6 — break on `test-bind` at depth 0 so the outer
            // case-body loop fires the diagnostic above instead of silently
            // absorbing the declaration into the preceding statement.
            if (depth === 0 && isTestBindSeq(i)) break;
            // Explicit `;` at depth 0 → flush + consume the `;` itself.
            if (depth === 0 && t.kind === "PUNCT" && t.text === ";") {
              flushStmt();
              i++;
              continue;
            }
            // Implicit split: depth 0, current parts non-empty, current
            // token is a statement-keyword whose source line is greater than
            // the last consumed token's line. Accept BOTH "KEYWORD" (most
            // entries — `let`/`const`/`return`/etc. are in the tokenizer's
            // KEYWORDS set) and "IDENT" (defensive fallback for any kind
            // discrimination drift).
            if (
              depth === 0 &&
              stmtParts.length > 0 &&
              (t.kind === "KEYWORD" || t.kind === "IDENT") &&
              isStmtKeywordToken(t.text) &&
              t.span && typeof t.span.line === "number" &&
              lastLine >= 0 && t.span.line > lastLine
            ) {
              flushStmt();
            }
            if (t.kind === "PUNCT" && t.text === "{") depth++;
            else if (t.kind === "PUNCT" && t.text === "}") depth--;
            stmtParts.push(tokenToSourceText(t));
            if (t.span && typeof t.span.line === "number") lastLine = t.span.line;
            i++;
          }
          flushStmt();
        }
      }

      // Consume closing }
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "}") i++;

      tests.push({
        name: testName,
        line: testLine,
        body: caseBody,
        asserts: caseAsserts,
      });
      continue;
    }

    // Top-level assert (outside any test "name" {} sub-block)
    if (tok.kind === "IDENT" && tok.text === "assert") {
      i++; // consume "assert"
      const rawExpr = collectAssertTokens();
      const assertNode = parseAssertExpr(rawExpr);

      // Group top-level asserts into an implicit anonymous test case
      if (tests.length === 0 || tests[tests.length - 1].name !== "") {
        tests.push({
          name: "",
          line: (tok.span && tok.span.line) ? tok.span.line : span.line,
          body: [],
          asserts: [],
        });
      }
      const implicit = tests[tests.length - 1];
      implicit.asserts.push(assertNode);
      implicit.body.push("assert " + rawExpr);
      continue;
    }

    // Skip unrecognized tokens at top level
    i++;
  }

  return {
    name: groupName,
    line: span.line,
    tests,
    before: beforeStmts,
    after: afterStmts,
    // SPEC §19.12.6 — body-scope `test-bind` declarations. Always present;
    // empty array for blocks with no declarations.
    testBinds,
  };
}

// ---------------------------------------------------------------------------
// Error effect block parser
// ---------------------------------------------------------------------------

/**
 * Parse error-effect block content into MatchArm[].
 *
 * Error arm syntax: `| ::TypeA e -> handler`
 * We use a best-effort scan through the token stream.
 *
 * @param {Token[]} tokens
 * @param {string} filePath
 * @returns {MatchArm[]}
 */
function parseErrorTokens(tokens, filePath) {
  const arms = [];
  let i = 0;

  while (i < tokens.length && tokens[i].kind !== "EOF") {
    const tok = tokens[i];

    // Arm starts with `|`
    if (tok.kind === "PUNCT" && tok.text === "|") {
      const armStart = tok;
      i++;

      // Pattern: `::TypeName`, `.Variant` (bare-dot per §14.10 / M9), or `_`
      let pattern = "_";
      let binding = "";

      if (i < tokens.length && tokens[i].kind === "OPERATOR" && tokens[i].text === "::") {
        i++; // consume `::`
        if (i < tokens.length && (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD")) {
          pattern = "::" + tokens[i].text;
          i++;
        }
      } else if (
        // S83 B8 follow-on — bare-dot variant pattern `.Variant` (canonical
        // §14.10 / M9 bare-variant inference; used heavily by examples since
        // S83 B1 v0.2.0 rewrite). Pre-S83 the parser only handled `::Type`
        // and `_` here, leaving `.Variant(reason) =>` to be absorbed into
        // the handler body — which then produced E-SCOPE-001 on the binding
        // identifier ("reason") because the binding never reached the arm.
        // Equivalent canonical handling: dot-pattern stores ".Variant" so
        // emit-logic.ts L2229 (which already strips both `::` and `.`)
        // produces correct guarded-expr dispatch.
        i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "." &&
        i + 1 < tokens.length && (tokens[i + 1].kind === "IDENT" || tokens[i + 1].kind === "KEYWORD") &&
        /^[A-Z]/.test(tokens[i + 1].text ?? "")
      ) {
        i++; // consume `.`
        pattern = "." + tokens[i].text;
        i++; // consume IDENT
      } else if (i < tokens.length && tokens[i].text === "_") {
        pattern = "_";
        i++;
      }

      // Binding variable: bare ident, or `(ident, ...)` tuple-style (§19.4.3
      // canonical). A multi-field error variant binds ALL its payload fields
      // positionally — e.g. `::Thrown(message, name)` (HostError, used heavily
      // across stdlib). Consume EVERY comma-separated binding ident inside the
      // parens; a single-ident-only parse left `, name ) -> ...` to leak into
      // the handler -> invalid JS (the gate's E-CODEGEN-INVALID-JS).
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "(") {
        i++; // consume `(`
        const _bindNames = [];
        while (i < tokens.length && !(tokens[i].kind === "PUNCT" && tokens[i].text === ")")) {
          if (tokens[i].kind === "IDENT") {
            _bindNames.push(tokens[i].text);
            i++;
          } else if (tokens[i].kind === "PUNCT" && tokens[i].text === ",") {
            i++;
          } else {
            break; // malformed — stop before consuming the arrow/handler
          }
        }
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ")") i++;
        binding = _bindNames.join(", ");
      } else if (i < tokens.length && (tokens[i].kind === "IDENT")) {
        binding = tokens[i].text;
        i++;
      }

      // Arm arrow — `:>` (canonical), `=>` / `->` (deprecated aliases, §18.2).
      // Record which glyph the source used so the typer can fire the
      // W-MATCH-ARROW-LEGACY lock-step lint for `!{}` handler arms.
      let armArrow = ":>";
      if (i < tokens.length && tokens[i].kind === "OPERATOR" && (tokens[i].text === "=>" || tokens[i].text === ":>")) {
        armArrow = tokens[i].text;
        i++;
      } else if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "-") {
        armArrow = "->";
        i++; // consume `-`
        if (i < tokens.length && tokens[i].kind === "OPERATOR" && tokens[i].text === ">") i++; // won't happen with `>`
        // `>` is emitted as PUNCT `>`
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ">") i++;
      }

      // Handler: collect until next `|`, next simplified arm start, or EOF
      // BUG-ASI-ERROR-ARM: Track source line per token so newlines between statements
      // survive into rewriteBlockBody (which splits on semicolons and newlines).
      const handlerParts = [];
      const handlerPartLines = []; // parallel: source line number for each part
      while (i < tokens.length && tokens[i].kind !== "EOF") {
        if (tokens[i].kind === "PUNCT" && tokens[i].text === "|") break;
        // Also stop at simplified arm start (TypeName => or _ =>)
        if (
          i + 1 < tokens.length &&
          (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD") &&
          tokens[i + 1].kind === "OPERATOR" &&
          (tokens[i + 1].text === "=>" || tokens[i + 1].text === ":>") &&
          (tokens[i].text === "_" || /^[A-Z]/.test(tokens[i].text))
        ) break;
        // Re-quote STRING tokens so their delimiters are preserved in the handler
        if (tokens[i].kind === "STRING") {
          handlerParts.push('"' + tokens[i].text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
        } else {
          handlerParts.push(tokens[i].text);
        }
        handlerPartLines.push(tokens[i].span?.line ?? 0);
        i++;
      }

      // Join with newline when consecutive tokens are on different source lines.
      let handlerJoined = handlerParts.length === 0 ? "" : handlerParts[0];
      for (let pi = 1; pi < handlerParts.length; pi++) {
        const sep = (handlerPartLines[pi] > handlerPartLines[pi - 1]) ? "\n" : " ";
        handlerJoined += sep + handlerParts[pi];
      }

      const _handlerTrimmed = handlerJoined.trim();
      arms.push({
        pattern,
        binding,
        handler: _handlerTrimmed,
        handlerExpr: _parseHandlerExpr(_handlerTrimmed, filePath, tokenSpan(armStart, filePath)?.start ?? 0),
        armArrow,
        span: tokenSpan(armStart, filePath),
      });
    } else if (tok.kind === "OPERATOR" && tok.text === "::") {
      // Canonical arm syntax (§19.4.3): ::TypeName(binding) -> handler
      // No leading pipe. Binding may be bare ident or paren-wrapped `(ident)`.
      const armStart = tok;
      i++; // consume `::`
      let pattern = "_";
      let binding = "";
      if (i < tokens.length && (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD")) {
        pattern = "::" + tokens[i].text;
        i++;
      }
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "(") {
        i++;
        // Multi-field payload binding (e.g. `::Thrown(message, name)`): consume
        // ALL comma-separated idents, not just the first (else the rest leaks
        // into the handler -> invalid JS).
        const _bindNames2 = [];
        while (i < tokens.length && !(tokens[i].kind === "PUNCT" && tokens[i].text === ")")) {
          if (tokens[i].kind === "IDENT") {
            _bindNames2.push(tokens[i].text);
            i++;
          } else if (tokens[i].kind === "PUNCT" && tokens[i].text === ",") {
            i++;
          } else {
            break;
          }
        }
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ")") i++;
        binding = _bindNames2.join(", ");
      } else if (i < tokens.length && tokens[i].kind === "IDENT") {
        binding = tokens[i].text;
        i++;
      }
      // Arm arrow — `:>` (canonical), `=>` / `->` (deprecated aliases, §18.2).
      let armArrow2 = ":>";
      if (i < tokens.length && tokens[i].kind === "OPERATOR" && (tokens[i].text === "=>" || tokens[i].text === ":>")) {
        armArrow2 = tokens[i].text;
        i++;
      } else if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "-") {
        armArrow2 = "->";
        i++;
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ">") i++;
      }
      const handlerParts = [];
      const handlerPartLines = [];
      while (i < tokens.length && tokens[i].kind !== "EOF") {
        if (tokens[i].kind === "PUNCT" && tokens[i].text === "|") break;
        if (tokens[i].kind === "OPERATOR" && tokens[i].text === "::") break;
        if (
          i + 1 < tokens.length &&
          (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD") &&
          tokens[i + 1].kind === "OPERATOR" &&
          (tokens[i + 1].text === "=>" || tokens[i + 1].text === ":>") &&
          (tokens[i].text === "_" || /^[A-Z]/.test(tokens[i].text))
        ) break;
        if (tokens[i].kind === "STRING") {
          handlerParts.push('"' + tokens[i].text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
        } else {
          handlerParts.push(tokens[i].text);
        }
        handlerPartLines.push(tokens[i].span?.line ?? 0);
        i++;
      }
      let handlerJoined = handlerParts.length === 0 ? "" : handlerParts[0];
      for (let pi = 1; pi < handlerParts.length; pi++) {
        const sep = (handlerPartLines[pi] > handlerPartLines[pi - 1]) ? "\n" : " ";
        handlerJoined += sep + handlerParts[pi];
      }
      const _handlerTrimmed3 = handlerJoined.trim();
      arms.push({
        pattern,
        binding,
        handler: _handlerTrimmed3,
        handlerExpr: _parseHandlerExpr(_handlerTrimmed3, filePath, tokenSpan(armStart, filePath)?.start ?? 0),
        armArrow: armArrow2,
        span: tokenSpan(armStart, filePath),
      });
    } else if (
      i + 1 < tokens.length &&
      (tok.kind === "IDENT" || tok.kind === "KEYWORD") &&
      tokens[i + 1].kind === "OPERATOR" &&
      (tokens[i + 1].text === "=>" || tokens[i + 1].text === ":>") &&
      (tok.text === "_" || /^[A-Z]/.test(tok.text))
    ) {
      // Simplified arm syntax (§19 short form): TypeName => handler
      // No leading pipe, no :: prefix, no explicit binding variable name.
      // Produces the same arm shape as pipe-style arms, with implicit binding "e".
      const armStart = tok;
      const typeName = tok.text;
      const pattern = typeName === "_" ? "_" : "::" + typeName;
      const binding = "e";
      // Arm arrow — this short-form gate matches only `=>` / `:>` (both single
      // OPERATOR tokens). Record which glyph the source used for the §18.2
      // W-MATCH-ARROW-LEGACY lock-step lint.
      const armArrow3 = tokens[i + 1] && tokens[i + 1].text === "=>" ? "=>" : ":>";
      i++; // consume TypeName or _
      i++; // consume arm arrow
      const handlerParts = [];
      const handlerPartLines = []; // parallel: source line number for each part
      while (i < tokens.length && tokens[i].kind !== "EOF") {
        // Stop at next simplified arm start (TypeName => or _ =>)
        if (
          i + 1 < tokens.length &&
          (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD") &&
          tokens[i + 1].kind === "OPERATOR" &&
          (tokens[i + 1].text === "=>" || tokens[i + 1].text === ":>") &&
          (tokens[i].text === "_" || /^[A-Z]/.test(tokens[i].text))
        ) break;
        // Stop at pipe-style arm start
        if (tokens[i].kind === "PUNCT" && tokens[i].text === "|") break;
        if (tokens[i].kind === "STRING") {
          handlerParts.push('"' + tokens[i].text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
        } else {
          handlerParts.push(tokens[i].text);
        }
        handlerPartLines.push(tokens[i].span?.line ?? 0);
        i++;
      }
      // Join with newline when consecutive tokens are on different source lines.
      let handlerJoined = handlerParts.length === 0 ? "" : handlerParts[0];
      for (let pi = 1; pi < handlerParts.length; pi++) {
        const sep = (handlerPartLines[pi] > handlerPartLines[pi - 1]) ? "\n" : " ";
        handlerJoined += sep + handlerParts[pi];
      }
      const _handlerTrimmed2 = handlerJoined.trim();
      arms.push({
        pattern,
        binding,
        handler: _handlerTrimmed2,
        handlerExpr: _parseHandlerExpr(_handlerTrimmed2, filePath, tokenSpan(armStart, filePath)?.start ?? 0),
        armArrow: armArrow3,
        span: tokenSpan(armStart, filePath),
      });
    } else {
      i++;
    }
  }

  return arms;
}

/**
 * Phase 4: parse error-arm handler expressions. For non-block handlers, parses the
 * handler string directly. For block handlers `{ body }`, strips the braces and
 * parses the inner content (supports single-expression block bodies like `{ @x = false }`).
 */
function _parseHandlerExpr(handler, filePath, startOffset) {
  if (!handler) return undefined;
  if (handler.startsWith("{") && handler.endsWith("}")) {
    const inner = handler.slice(1, -1).trim();
    if (!inner) return undefined;
    return safeParseExprToNodeGlobal(inner, filePath, startOffset);
  }
  return safeParseExprToNodeGlobal(handler, filePath, startOffset);
}

// ---------------------------------------------------------------------------
// Core block → ASTNode builder
// ---------------------------------------------------------------------------

/**
 * Build an ASTNode from a single Block.
 *
 * `parentContextKind` is the kind of the enclosing block (used for MetaBlock
 * parentContext field). For top-level blocks this is null.
 *
 * @param {object} block  — Block from BS output
 * @param {string} filePath
 * @param {string | null} parentContextKind
 * @param {{ next: number }} counter  — node ID counter shared across the compilation unit
 * @param {TABError[]} errors
 * @returns {ASTNode | null}
 */
/**
 * P1 (uniform opener, SPEC §15.15): tag-vs-state classification gap-fill.
 *
 * BS classifies on whitespace (no-space → markup, with-space → state). For
 * scrml lifecycle keywords, downstream stages expect a specific shape:
 *
 *   markup-shape consumers: channel, timer, poll, request, errorBoundary
 *     (handled in emit-html.ts / emit-reactive-wiring.ts via tag === "...")
 *   state-shape consumers:  db, schema (handled in protect-analyzer / TS via
 *     kind === "state" && stateType === "...")
 *   engine-decl shape:     engine, machine (handled in TS / CG via
 *     kind === "engine-decl")
 *
 * When the user writes the form OPPOSITE to BS classification, we normalize
 * here so both forms produce equivalent downstream behavior. The
 * `openerHadSpaceAfterLt` informational flag is preserved so NR can emit
 * W-WHITESPACE-001 correctly.
 *
 * Same-file user state-types (state-constructor-def with `< Name attr(Type)>`)
 * MUST NOT be normalized — those legitimately use the state path. We only
 * normalize when the name matches a built-in scrml lifecycle keyword.
 */
const _MARKUP_FORM_LIFECYCLE = new Set([
  "channel", "timer", "poll", "request", "errorBoundary", "errorboundary",
]);
const _STATE_FORM_LIFECYCLE = new Set([
  "db", "schema", "engine", "machine",
]);

function buildBlock(block, filePath, parentContextKind, counter, errors, parentStateName = null) {
  // Uniform-opener normalization: rewrite block.type when the BS classification
  // is the wrong half of the markup/state split for this lifecycle keyword. The
  // raw text and openerHadSpaceAfterLt are preserved verbatim so consumers can
  // observe the original opener form.
  if (block && block.name) {
    if (block.type === "state" && _MARKUP_FORM_LIFECYCLE.has(block.name)) {
      block = { ...block, type: "markup" };
    } else if (block.type === "markup" && _STATE_FORM_LIFECYCLE.has(block.name)) {
      block = { ...block, type: "state" };
    }
  }

  const span = fullSpan(block.span, filePath);

  switch (block.type) {

    // ------------------------------------------------------------------ text
    case "text":
      return {
        id: ++counter.next,
        kind: "text",
        value: block.raw,
        span,
      };

    // --------------------------------------------------------------- comment
    case "comment":
      return {
        id: ++counter.next,
        kind: "comment",
        value: block.raw,
        span,
      };

    // -------------------------------------------------------------- markup
    case "markup": {
      // Match block-form (SPEC §18.0.1, S107 Phase 1 of multi-phase impl arc;
      // see docs/changes/match-block-form-scoping/SCOPING.md).
      //
      // Pre-S107: `<match for=Type [on=expr]>...</>` blocks were misclassified
      // by block-splitter's classifyOpenerForCompoundScan and captured as
      // opaque html-fragment text. S107 BS-layer fix added `"match"` to
      // COMPOUND_LIFT_EXEMPT_TAGS — BS now produces a `type=markup name=match`
      // block that lands here. This dispatch intercepts BEFORE the regular
      // markup AST construction and returns a structured `match-block` AST
      // node (Q-MB-1 ratification: NEW kind, not flag-on-markup).
      //
      // Phase 1 (THIS LANDING): produce the AST node with `forType` +
      // `onExprRaw` + `armsRaw`. Mirrors the `engine-decl` shape (armsRaw
      // post-processed by a dedicated parser at SYM time). Phase 2 will add
      // `match-statechild-parser.ts` + new SYM PASS firing the 4 §18.0.2
      // diagnostics (W-MATCH-RULE-INERT / E-MATCH-EFFECT-FORBIDDEN /
      // E-MATCH-ONTRANSITION-FORBIDDEN / E-MATCH-NOT-EXHAUSTIVE) +
      // E-MATCH-ON-REQUIRED (new §34 row per Q-MB-5 ratification). Phase 3
      // adds codegen render dispatch.
      //
      // Q-MB-7 ratification: zero adopter source files use `<match>` today
      // (pre-flight grep S107 — only doc pages REFERENCE it via comment
      // headers; no live use), so the cut-over is safe with no migration
      // window.
      //
      // Phase 1 known limitation (`:`-shorthand body NOT yet supported):
      // arm-children today must use bare-body form `<Variant>...</>` or
      // self-closing `<Variant/>`. The `<Variant> : expr` `:`-shorthand
      // body form (SPEC §18.0.1 line 9592) fires E-CTX-003 at BS-time
      // because the `<Variant>` opener never finds a closer. `:`-shorthand
      // support requires a BS-layer extension parallel to engine state-
      // child `:`-shorthand handling; deferred to Phase 2 (when the arm-
      // parser lands and can coordinate the BS-level shape recognition).
      if (block.name === "match") {
        const matchRaw = (block.raw || "").trim();

        // Brace-aware opener-end finder (mirrors engine-decl's _findOpenerEnd
        // — `>` inside `{...}` is skipped so `on=${expr.contains(">")}`
        // doesn't truncate the header).
        function _findMatchOpenerEnd(s) {
          let depth = 0;
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) return i;
          }
          return -1;
        }

        const firstLineEnd = _findMatchOpenerEnd(matchRaw);
        const headerLine = firstLineEnd >= 0
          ? matchRaw.slice(0, firstLineEnd)
          : matchRaw.split("\n")[0];
        // Strip "<match " prefix (also handles `< match` with leading space).
        let header = headerLine;
        const matchIdx = header.indexOf("match");
        if (matchIdx >= 0) header = header.slice(matchIdx + "match".length).trim();
        // Strip trailing `/` (self-closing — invalid for match but defensive)
        // or `>` fragments from the header.
        header = header.replace(/[/>]+\s*$/, "").trim();

        // Bareword-ident regex — reused for `for=Type`.
        const M_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/;
        const forMatchAttr = header.match(new RegExp(`\\bfor\\s*=\\s*(${M_IDENT.source})\\b`));

        // `on=expr` capture: takes everything after `on=` up to the next
        // standalone attribute boundary OR end of header. Conservative —
        // full expression parsing defers to Phase 2 (routes through the
        // existing ExprNode pipeline). Common shapes `on=@ident`, `on="..."`,
        // `on=${...}` captured verbatim into `onExprRaw`.
        let onExprRaw = null;
        const onPos = header.search(/\bon\s*=/);
        if (onPos >= 0) {
          const afterEq = header.slice(onPos).replace(/^\bon\s*=\s*/, "");
          let end = afterEq.length;
          let depth = 0;
          // S177 bug-48 — track paren + bracket depth too, so a `>` and a
          // whitespace boundary INSIDE an `=>` arrow / call-arg `(...)` / `[...]`
          // (e.g. `on=@nums.filter(c => c == 1)`) is NOT mis-read as the opener's
          // `>` or as an attribute boundary (the `c == 1` arrow body would
          // otherwise look like a `c=` attribute and truncate the capture).
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < afterEq.length; i++) {
            const c = afterEq[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            if (depth === 0 && parenDepth === 0 && bracketDepth === 0 && /\s/.test(c)) {
              let j = i;
              while (j < afterEq.length && /\s/.test(afterEq[j])) j++;
              if (j < afterEq.length && /[A-Za-z_$]/.test(afterEq[j])) {
                let k = j;
                while (k < afterEq.length && /[A-Za-z0-9_$:-]/.test(afterEq[k])) k++;
                while (k < afterEq.length && /\s/.test(afterEq[k])) k++;
                if (afterEq[k] === "=") {
                  end = i;
                  break;
                }
              }
            }
          }
          onExprRaw = afterEq.slice(0, end).trim();
          if (onExprRaw === "") onExprRaw = null;
        }

        const forType = forMatchAttr ? forMatchAttr[1] : "";

        // Capture armsRaw: body text after the opener line, before the closer.
        // BS-layer captures arm-child markup as block.children entries when
        // they parse cleanly (bare-body form). For Phase 1, concatenate the
        // raw text of those children into armsRaw — Phase 2 will re-tokenize.
        let armsRaw = "";
        if (Array.isArray(block.children)) {
          for (const child of block.children) {
            if (child && typeof child === "object" && typeof child.raw === "string") {
              armsRaw += child.raw;
            }
          }
        }
        // Fallback when children parse failed: capture body via raw slice
        // between opener-end and closer.
        if (!armsRaw && firstLineEnd >= 0) {
          armsRaw = matchRaw.slice(firstLineEnd + 1);
          armsRaw = armsRaw.replace(/<\s*\/\s*(?:match)?\s*>\s*$/, "");
        }
        armsRaw = armsRaw.trim();

        // Phase 3 (S108) — preserve walkable body children alongside armsRaw,
        // mirroring engine-decl.bodyChildren (Phase A10 / S78 precedent at
        // ~line 10996). The block-splitter has ALREADY recursively descended
        // into the match body and produced typed walkable children. Phase 1
        // discarded the structure by re-serializing children into armsRaw;
        // Phase 3 retrofits the AST node to ADDITIONALLY carry bodyChildren
        // so codegen (emit-match.ts) can walk arm-body markup as AST nodes
        // and reuse `emitVariantGuardedRender` (the variant-source-agnostic
        // helper originally factored for engines, now consumed by match-block
        // per its variant-source-agnostic design intent).
        //
        // ADDITIVE field: undefined when block has no children; [] on
        // parse-failure; else ASTNode[] mirroring block.children.
        //
        // **Why discard buildBlock errors during this recurse** (mirrors
        // engine-decl rationale at line 11017+): match arm-child openers
        // use the variant-shorthand opener form `<Variant>` /
        // `<Variant(rows)>` / `<Variant attrs>` / `<_>` (wildcard). These
        // diverge from standard HTML markup attribute parsing in ways the
        // authoritative match-statechild-parser handles (SYM PASS 20). The
        // errors buildBlock would generate here are duplicates of (or weaker
        // than) what PASS 20 fires; preserving Phase 2's diagnostic surface
        // requires DROPPING the errors this specific recursive build
        // produces. Real semantic errors fire downstream.
        const bodyChildren = [];
        if (Array.isArray(block.children) && block.children.length > 0) {
          const _bodyErrors = [];
          for (const child of block.children) {
            // Build the child node. parentContextKind="markup" so any nested
            // markup inside arm bodies is walked with markup-tree semantics.
            const childNode = buildBlock(child, filePath, "markup", counter, _bodyErrors);
            if (childNode) bodyChildren.push(childNode);
          }
          // _bodyErrors intentionally discarded — see comment block above.
        }

        // g-formfor-in-match-arm (S177) — assign the match-block's own id
        // FIRST so the per-arm wrapper ids (built below, each `++counter.next`)
        // come AFTER it and do NOT shift the match-block id downstream
        // (`data-scrml-match-mount="match_<id>"` + the render-fn names key on it).
        const _matchBlockId = ++counter.next;
        // build a WALKABLE per-arm body AST
        // (`armBodyChildren`) so the markup-EXPANSION passes (component-expander
        // CE + the type-system formFor walker) can reach a `<formFor>` / a
        // user-component USE-SITE inside a match arm. BS captures the match body
        // as a single raw text run (`armsRaw`) — `bodyChildren` above is that
        // text node, NOT walkable arm bodies. So a `<formFor>`/`<Badge>` inside
        // an arm was NEVER expanded: the raw tag leaked into the arm render fn
        // (silent non-render) and, for formFor, its compound state cell was never
        // hoisted/bound. Mirrors the engine-decl `bodyChildren` shape: one markup
        // WRAPPER per arm (tag = variant name), whose `.children` are the
        // re-parsed arm-body markup nodes. The walkers expand IN PLACE; codegen
        // `buildMatchArms` consumes the (expanded) wrappers when present and
        // hoists the formFor compound to file scope at TS, exactly as the engine
        // path does. Falls back to the existing `armsRaw` re-parse when this is
        // absent (empty / parse-failure). The each-in-arm path keeps using
        // `bodyChildren` (codegen attaches lifted each-blocks there) — left
        // untouched.
        const armBodyChildren = (function buildMatchArmBodyChildren() {
          if (!armsRaw || typeof armsRaw !== "string") return undefined;
          let parsed;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { parseMatchArms } = require("./match-statechild-parser.ts");
            parsed = parseMatchArms(armsRaw);
          } catch (_e) { return undefined; }
          if (!parsed || !Array.isArray(parsed.arms) || parsed.arms.length === 0) return undefined;
          const wrappers = [];
          for (const arm of parsed.arms) {
            // Only bare-body arms host nested markup (formFor / components live in
            // markup bodies). self-closing has no body; `:`-shorthand is a single
            // expression (no nested element to expand). Skip those — codegen's
            // existing per-arm handling renders them.
            // Skip non-bare-body arms (no nested markup to expand) AND
            // each-bearing arm bodies. The each-block transform + globally-unique
            // id re-stamping for an arm-body `<each>` lives in codegen
            // `buildMatchArms` (each-in-block-form-match S153); building a SECOND
            // each-block here (with a different id) would create a phantom
            // each-block that `collectEachBlocks(fileAST)` picks up. A formFor /
            // component never co-occurs with an each in the v1 arm surface, so
            // each-bearing arms keep the codegen `armsRaw` re-parse path intact.
            if (
              arm.bodyForm !== "bare-body" ||
              !arm.bodyRaw ||
              !arm.bodyRaw.trim() ||
              /<\s*each\b/.test(arm.bodyRaw)
            ) {
              wrappers.push({
                id: ++counter.next,
                kind: "markup",
                tag: arm.variantName,
                attrs: [],
                children: [],
                span,
                _matchArmBodyForm: arm.bodyForm,
              });
              continue;
            }
            let armNodes = [];
            try {
              const reBs = _splitBlocksForP2Form1(filePath || "<match-arm>", arm.bodyRaw);
              const reTab = buildAST(reBs);
              if (reTab && reTab.ast && Array.isArray(reTab.ast.nodes)) armNodes = reTab.ast.nodes;
            } catch (_e) { armNodes = []; }
            wrappers.push({
              id: ++counter.next,
              kind: "markup",
              tag: arm.variantName,
              attrs: [],
              children: armNodes,
              span,
              _matchArmBodyForm: arm.bodyForm,
            });
          }
          return wrappers.length > 0 ? wrappers : undefined;
        })();

        return {
          id: _matchBlockId,
          kind: "match-block",
          forType,       // bareword type name (REQUIRED per §18.0.1; SYM PASS validates)
          onExprRaw,     // raw text of on= attribute (Phase 2 parses via ExprNode pipeline)
          armsRaw,       // raw body text — Phase 2's match-statechild-parser produces MatchArmEntry[]
          bodyChildren,  // Phase 3 — walkable arm-body AST mirroring block.children (additive; engine-decl precedent)
          armBodyChildren, // g-formfor-in-match-arm (S177) — walkable per-arm bodies for the expansion passes (undefined when no bare-body arms)
          span,
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
        };
      }

      // ----------------------------------------------------------------
      // Each block-form (SPEC §17.X NEW per S130 HU-1 ratifications;
      // iteration Landing 1 of 5).
      //
      // BS captures <each in=|of=>...</each> as a structural raw-body
      // markup block (block-splitter.js STRUCTURAL_RAW_BODY_ELEMENTS).
      // Mirrors match-block dispatch above — extract header (one of
      // in=/of= required, as= + key= optional), capture body children
      // (per-item template + optional <empty> sub-element).
      //
      // Body composition leverages SPEC §4.14 `:`-shorthand mechanism
      // (Q3 RE-RATIFICATION — no new body-shorthand). Per-item element
      // openers admit `:`-shorthand for single-expression bodies
      // (`<li : @.name>`).
      //
      // Phase 1 (THIS LANDING): produce the each-block AST node carrying
      // the iter shape (in/of), the iter expression, the optional as=
      // name override, the optional key= expression, the body children
      // (walkable AST), the optional `<empty>` sub-element body, and
      // span info.
      if (block.name === "each") {
        const eachRaw = (block.raw || "").trim();

        // Brace+paren+bracket-aware opener-end finder (mirrors match-block,
        // plus R25-Bug-37 paren/bracket extensions).
        //
        // R25-Bug-37: the original finder tracked only braces, so the `>` of
        // an inline arrow (`=>`) inside a parenthesized attribute value —
        // e.g. `<each in=@items.filter(c => c.foo == 1)>` — was treated as
        // the opener terminator and the header was truncated at `(c =`,
        // silently miscompiling the iteration source. Paren + bracket depth
        // tracking mirrors block-splitter `scanAttributes` (which already
        // accepts the full opener at the BS layer) and brings ast-builder's
        // opener-end recognition into agreement with what BS produced in
        // `block.raw`.
        function _findEachOpenerEnd(s) {
          let depth = 0;
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) return i;
          }
          return -1;
        }

        const firstLineEnd = _findEachOpenerEnd(eachRaw);
        const headerLine = firstLineEnd >= 0
          ? eachRaw.slice(0, firstLineEnd)
          : eachRaw.split("\n")[0];
        let header = headerLine;
        const eachIdx = header.indexOf("each");
        if (eachIdx >= 0) header = header.slice(eachIdx + "each".length).trim();
        header = header.replace(/[/>]+\s*$/, "").trim();

        // Attribute capture — `in=expr`, `of=expr`, `as=name`, `key=expr`.
        // Each value runs from after the `=` to the next standalone attribute
        // boundary (whitespace + ident + `=`) or end-of-header. Conservative
        // shape — single-token captures common (`in=@items`, `of=10`, `as=item`).
        // Bracket/brace-balancing handles `in=@items.filter(x => x > 0)` etc.
        function _captureAttrValue(header, attrName) {
          const pat = new RegExp(`\\b${attrName}\\s*=`);
          const m = header.match(pat);
          if (!m) return null;
          const startAfterEq = m.index + m[0].length;
          const afterEq = header.slice(startAfterEq);
          // Trim leading whitespace
          let i = 0;
          while (i < afterEq.length && /\s/.test(afterEq[i])) i++;
          let end = afterEq.length;
          let depth = 0;
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let j = i; j < afterEq.length; j++) {
            const c = afterEq[j];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") j++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") j++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            // Attribute boundary: whitespace at zero-depth followed by
            // ident-start char + ... + `=`. Also stop at standalone `as`
            // keyword (whitespace + `as` + whitespace + ident) per the
            // S130 HU-1 `<each ... as name>` shape — `as name` is a
            // bareword-value attribute, no `=` separator.
            if (depth === 0 && parenDepth === 0 && bracketDepth === 0 && /\s/.test(c)) {
              let k = j;
              while (k < afterEq.length && /\s/.test(afterEq[k])) k++;
              if (k < afterEq.length && /[A-Za-z_$]/.test(afterEq[k])) {
                let l = k;
                while (l < afterEq.length && /[A-Za-z0-9_$:-]/.test(afterEq[l])) l++;
                // Check for `as` followed by whitespace + ident (standalone
                // `as` keyword form) — boundary for in=/of=/key= captures.
                const word = afterEq.slice(k, l);
                if (word === "as" && l < afterEq.length && /\s/.test(afterEq[l])) {
                  let m = l;
                  while (m < afterEq.length && /\s/.test(afterEq[m])) m++;
                  if (m < afterEq.length && /[A-Za-z_$]/.test(afterEq[m])) {
                    end = j;
                    break;
                  }
                }
                while (l < afterEq.length && /\s/.test(afterEq[l])) l++;
                if (afterEq[l] === "=") {
                  end = j;
                  break;
                }
              }
            }
          }
          const val = afterEq.slice(i, end).trim();
          return val === "" ? null : val;
        }

        let inExprRaw = _captureAttrValue(header, "in");
        let ofExprRaw = _captureAttrValue(header, "of");
        let keyExprRaw = _captureAttrValue(header, "key");

        // `as name` — whitespace-separated bareword (no `=` between `as`
        // and the variable name) per HU-1 Q6 canonical form
        // (`<each in=@items as item>`). Capture the next bareword
        // identifier after the `as` keyword. Conservative — `as` must be
        // a standalone word followed by an identifier; embedded `as`
        // inside in= / key= values is not affected because those values
        // were already captured by _captureAttrValue (which is depth-aware).
        //
        // §59.8 / §14.11 (S169): an optional 2-name positional destructure
        // `as ( name1 , name2 )` binds the iteration value's entry-struct
        // fields positionally — `name1 ← .key`, `name2 ← .value`. It is sugar
        // over `as e` + `e.key`/`e.value`; the iterated value stays the
        // `{ key, value }` struct. We capture both names into `asNames` and
        // leave `asName` null for the 2-name form. Try the parenthesized
        // form FIRST (it is more specific), then fall back to single-name.
        let asName = null;
        let asNames = null;
        const asTupleMatch = header.match(
          /\bas\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/,
        );
        const asMatch = asTupleMatch
          ? null
          : header.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
        if (asTupleMatch) {
          // Guard against the `as` falling inside an earlier attribute value
          // (same conservative containment check as the single-name path).
          //
          // `_captureAttrValue` is depth-aware and OVER-READS an unquoted value
          // that is followed by the `as (k, v)` destructure — the balanced
          // `(k, v)` parens make the scanner continue past the value's real end
          // (e.g. `in=@m.entries() as (k, v)` captures the whole tail as the
          // `in=` value). Because the tuple match `\bas\s*\(id, id\)` is the
          // recognised destructure, its match position marks the TRUE end of
          // any preceding value: clip each captured value's effective end at the
          // tuple-match position so the containment check measures the real
          // attribute-value region, not the over-read.
          const asPos = asTupleMatch.index;
          let inside = false;
          for (const prefix of ["in", "of", "key"]) {
            const p = new RegExp(`\\b${prefix}\\s*=`);
            const m = header.match(p);
            if (!m) continue;
            const valStart = m.index + m[0].length;
            const val = _captureAttrValue(header, prefix);
            if (val === null) continue;
            const valEndIdx = header.indexOf(val, valStart);
            if (valEndIdx < 0) continue;
            // Clip the over-read at the tuple-match start (the value cannot
            // legitimately extend past where the `as (k, v)` destructure begins).
            const valEnd = Math.min(valEndIdx + val.length, asPos);
            if (asPos >= valStart && asPos < valEnd) {
              inside = true;
              break;
            }
          }
          if (!inside) asNames = [asTupleMatch[1], asTupleMatch[2]];

          // De-contaminate the iteration-source captures. `_captureAttrValue`'s
          // depth-aware scanner OVER-READS an unquoted value followed by the
          // `as (k, v)` destructure (the balanced `(k, v)` parens make the
          // scanner continue past the value), so e.g. `in=@m.entries()` leaks
          // its `inExprRaw` as `"@m.entries() as (k, v)"`. Strip a trailing
          // ` as (id, id)` destructure tail from each captured source so
          // downstream stages (codegen itemsExpr, key inference, TS) see the
          // clean iteration expression. Only runs when the tuple form matched.
          const _stripDestructureTail = (raw) =>
            typeof raw === "string"
              ? raw.replace(/\s+as\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)\s*$/, "")
              : raw;
          if (asNames) {
            inExprRaw = _stripDestructureTail(inExprRaw);
            ofExprRaw = _stripDestructureTail(ofExprRaw);
            keyExprRaw = _stripDestructureTail(keyExprRaw);
          }
        }
        if (asMatch) {
          // Guard: avoid matching the `as` keyword appearing INSIDE an
          // earlier attribute value (e.g. `in=foo as bar`). Check that
          // the matched `as` index isn't inside an attribute value already
          // captured above. The captured values' positions:
          //   inPos  = header.indexOf("in=")
          //   ofPos  = header.indexOf("of=")
          //   keyPos = header.indexOf("key=")
          // If the `as` match index falls between any of those and the
          // corresponding value's end, skip (it's inside that value).
          const asPos = asMatch.index;
          let inside = false;
          for (const prefix of ["in", "of", "key"]) {
            const p = new RegExp(`\\b${prefix}\\s*=`);
            const m = header.match(p);
            if (!m) continue;
            const valStart = m.index + m[0].length;
            // Find the length of the captured value (conservative — use
            // _captureAttrValue's same scanner).
            const val = _captureAttrValue(header, prefix);
            if (val === null) continue;
            // _captureAttrValue trims leading whitespace then returns the
            // value; the end-of-value position is valStart + leading-ws
            // + val.length. Conservative bound: scan from valStart to find
            // val's end by looking for the val substring after valStart.
            const valEndIdx = header.indexOf(val, valStart);
            if (valEndIdx < 0) continue;
            const valEnd = valEndIdx + val.length;
            if (asPos >= valStart && asPos < valEnd) {
              inside = true;
              break;
            }
          }
          if (!inside) asName = asMatch[1];
        }

        // iterShape: "in" (collection iteration) | "of" (count iteration).
        // Exactly one of in=/of= is required at the type-system layer;
        // ast-builder records what was present and downstream PASS / TS
        // surfaces missing-or-both as E-EACH-ITER-SHAPE (added §34 row at
        // step 9 of this dispatch). Both-present and both-absent are both
        // structurally captured here; we don't fire from ast-builder.
        let iterShape = null;
        if (inExprRaw && !ofExprRaw) iterShape = "in";
        else if (ofExprRaw && !inExprRaw) iterShape = "of";
        else if (inExprRaw && ofExprRaw) iterShape = "in"; // tie-break to in= for downstream walks; PASS surfaces conflict
        else iterShape = null; // neither — PASS surfaces missing

        // Capture body children — walkable AST mirror of the body content.
        // The block-splitter raw-body capture (STRUCTURAL_RAW_BODY_ELEMENTS)
        // collapsed the body to a single text child to avoid `:`-shorthand
        // shape-confusion at BS-time. To get walkable per-item template
        // children + the optional <empty> sub-element, we re-`splitBlocks`
        // the body text in markup mode (where bare `<li : @.name>` openers
        // are tolerated downstream — the `:`-shorthand resolution happens
        // at SYM/codegen time for the per-item element opener).
        //
        // Unlike match-statechild-parser (which tokenizes armsRaw with a
        // custom arm-shape grammar), <each>'s body is plain markup with a
        // designated `<empty>` sub-element — re-`splitBlocks` is the
        // cleanest path. Errors from the recursive parse are discarded
        // (the `:`-shorthand body on per-item openers may surface
        // E-CTX-003-shape diagnostics that PASS / codegen resolve
        // correctly).
        const bodyChildren = [];
        // First, pull the raw body text from block.children (BS raw-body
        // capture concatenates the body into a single text child).
        let _bodyRawForReparse = "";
        if (Array.isArray(block.children)) {
          for (const child of block.children) {
            if (child && typeof child === "object" && typeof child.raw === "string") {
              _bodyRawForReparse += child.raw;
            }
          }
        }
        if (_bodyRawForReparse) {
          // Use the BS factory to re-split the body text. Sub-block-splitter
          // errors are discarded; the body's structural meaning (<empty> +
          // per-item template) survives because the BS scanner handles
          // arbitrary markup, and the `:`-shorthand pattern on per-item
          // openers is captured as a markup child whose `raw` text the
          // downstream resolver inspects.
          const _subBs = _splitBlocksForP2Form1(filePath, _bodyRawForReparse);
          const _subErrors = [];
          for (const subBlock of _subBs.blocks) {
            const subNode = buildBlock(subBlock, filePath, "markup", counter, _subErrors);
            if (subNode) bodyChildren.push(subNode);
          }
          // _subErrors intentionally discarded — see comment block above.
        }

        // Identify the optional <empty> sub-element. Per HU-1 Q4 ratification,
        // `<empty>...</empty>` is the canonical empty-state form inside <each>.
        // Find the first markup child whose tag name is "empty"; capture it
        // separately so codegen can route the empty-branch render distinctly
        // from the per-item template. The remaining children (the
        // per-item template) stay in `templateChildren`.
        let emptyChild = null;
        const templateChildren = [];
        for (const child of bodyChildren) {
          if (child && child.kind === "markup" && (child.tag || child.name) === "empty" && emptyChild === null) {
            emptyChild = child;
          } else {
            templateChildren.push(child);
          }
        }

        // Capture raw body text as a fallback for downstream consumers that
        // want the verbatim source (mirrors match-block.armsRaw). The body
        // text excludes the `</each>` closer.
        let bodyRaw = "";
        if (Array.isArray(block.children)) {
          for (const child of block.children) {
            if (child && typeof child === "object" && typeof child.raw === "string") {
              bodyRaw += child.raw;
            }
          }
        }
        if (!bodyRaw && firstLineEnd >= 0) {
          bodyRaw = eachRaw.slice(firstLineEnd + 1);
          bodyRaw = bodyRaw.replace(/<\s*\/\s*(?:each)?\s*>\s*$/, "");
        }
        bodyRaw = bodyRaw.trim();

        return {
          id: ++counter.next,
          kind: "each-block",
          iterShape,         // "in" | "of" | null
          inExprRaw,         // raw text after `in=` (null when shape is "of")
          ofExprRaw,         // raw text after `of=` (null when shape is "in")
          asName,            // bareword iteration-variable name (optional)
          asNames,           // 2-name positional destructure [k, v] (§59.8/§14.11; null unless `as (k, v)`)
          keyExprRaw,        // raw text after `key=` (optional; null → inferred)
          bodyChildren,      // full walkable AST mirror of block.children (includes <empty>)
          templateChildren,  // bodyChildren minus the <empty> sub-element (the per-item template)
          emptyChild,        // the <empty> sub-element node, or null when absent
          bodyRaw,           // raw body text fallback (matches match-block.armsRaw shape)
          span,
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
        };
      }

      // R25-Bug-40 — SPEC §4.14 `:`-shorthand body handling. When BS
      // recognized the opener as `:`-shorthand (closerForm:"shorthand"),
      // block.raw includes the shorthand body expression (everything
      // between the `:` introducer and the closing `>`). Tokenizing
      // block.raw as-is would parse `@.name` (the body) as two bareword
      // attributes (`@` and `name`) because the TAB tokenizer doesn't
      // know about `:`-shorthand. To fix this:
      //   (a) Slice block.raw at the introducer offset (block.shorthandColonOff)
      //   (b) Replace the slice's tail with `>` so tokenizer terminates
      //       cleanly after the actual attribute region.
      //   (c) Capture the shorthand body expression text from the
      //       remainder so codegen can consume it.
      //
      // The reconstructed slice keeps absolute offsets intact for the
      // attribute region (offsets <= introducer); positions for the
      // synthesized terminator `>` don't matter — no diagnostic fires
      // from inside the synthetic byte.
      let tokenizeSource = block.raw;
      let shorthandBodyRaw = null;
      if (block.closerForm === "shorthand" && typeof block.shorthandColonOff === "number" && block.shorthandColonOff > 0) {
        // attribute region = block.raw[0..shorthandColonOff]; replace the
        // remainder with `>` so the tokenizer terminates correctly.
        const attrPart = block.raw.slice(0, block.shorthandColonOff);
        tokenizeSource = attrPart.replace(/\s+$/, "") + ">";
        // Shorthand body runs from after the `:` to the closing `>` of
        // the opener. The block.raw ends at (just past) the closing `>`,
        // so the body is block.raw[shorthandColonOff+1 .. raw.length-1].
        // Trim leading/trailing whitespace per SPEC §4.14 (" : expr").
        shorthandBodyRaw = block.raw.slice(block.shorthandColonOff + 1, block.raw.length - 1).trim();
      }

      const attrTokens = tokenizeAttributes(
        tokenizeSource,
        block.span.start,
        block.span.line,
        block.span.col,
        "markup"
      );
      const attrs = parseAttributes(attrTokens, filePath, errors, block.isComponent === true);

      // ----------------------------------------------------------------
      // A1b B18 fire-site #1 — multi-statement event-handler validation
      // (E-MULTI-STATEMENT-HANDLER) per SPEC §5.2.3 + §34 row 14260.
      //
      // Scan the opener portion of `block.raw` for top-level `;` outside
      // expression-internal contexts (strings, parens, braces, brackets,
      // template-literal `${...}` interpolations, comments). For each top-
      // level hit, find the nearest preceding `attrName=` and fire if
      // `attrName` is in the event-handler family (`/^on[a-z]+$/i`,
      // `on:`, `onserver:`, `onclient:` per primer §9.6 + §38.6.1).
      //
      // The `${...}` exemption noted in §5.2.3 line 1144 is handled
      // automatically: `${` opens a brace-tracked region in the helper,
      // so any `;` inside is not top-level.
      // ----------------------------------------------------------------
      try {
        const openerScan = scanOpenerForAttrs(block.raw, 0);
        if (openerScan) {
          // Slice the opener attribute region — from after the tag name
          // to the closing `>` (or `/` of `/>`). This is exactly the span
          // where attribute names + values live; we never scan into the
          // body (where `;` is allowed because the body is logic / text).
          const openerSlice = block.raw.slice(openerScan.attrStart, openerScan.openerEnd);
          const hits = scanForTopLevelSemicolon(openerSlice);
          if (hits.length > 0) {
            // Pre-compute attribute-name boundaries within `openerSlice`
            // so each `;` hit maps to its enclosing attribute. We use a
            // regex-based scan over the slice — for each match of
            // `name=`, record the `name` and the offset of its `=`. The
            // owning attribute for a `;` at offset `k` is the latest
            // `name=` whose `=` offset is `< k`.
            //
            // Pattern: identifiers can include `:` (for `on:click`,
            // `onserver:foo`, `class:active`), letters/digits/`-`/`_`,
            // and `.` (for `bind:value` etc.). Keep the regex liberal —
            // we only care about whether the matched `name` later passes
            // `isEventHandlerAttrName`.
            const NAME_EQ_RE = /([A-Za-z_][A-Za-z0-9_:\-]*)\s*=/g;
            const attrBoundaries = [];
            let nameMatch;
            while ((nameMatch = NAME_EQ_RE.exec(openerSlice)) !== null) {
              attrBoundaries.push({
                name: nameMatch[1],
                eqEnd: nameMatch.index + nameMatch[0].length,
              });
            }
            for (const hit of hits) {
              // Find the latest attrBoundary whose eqEnd <= hit.offset.
              let owner = null;
              for (let bi = attrBoundaries.length - 1; bi >= 0; bi--) {
                if (attrBoundaries[bi].eqEnd <= hit.offset) {
                  owner = attrBoundaries[bi];
                  break;
                }
              }
              if (!owner) continue;
              if (!isEventHandlerAttrName(owner.name)) continue;
              // Map relative offset back to absolute file offset for span.
              const absOffset = block.span.start + openerScan.attrStart + hit.offset;
              const fireSpan = {
                file: filePath,
                start: absOffset,
                end: absOffset + 1,
                line: span.line,
                col: span.col,
              };
              errors.push(new TABError(
                "E-MULTI-STATEMENT-HANDLER",
                `E-MULTI-STATEMENT-HANDLER: Event-handler attribute \`${owner.name}\` on ` +
                `\`<${block.name}>\` contains multiple statements (semicolon-separated). ` +
                `A bare-form event handler must be exactly one expression — a call ` +
                `(\`${owner.name}=fn()\`), an assignment (\`${owner.name}=@phase = .Loading\`), ` +
                `or a single expression (\`${owner.name}=@count++\`). For multi-statement ` +
                `intent, lift the body to a named function and wire by name: ` +
                `\`function name() { ... }\` then \`${owner.name}=name()\` ` +
                `(SPEC §5.2.3 / §34).`,
                fireSpan,
              ));
            }
          }
        }
      } catch (_e) {
        // Defensive: scan failure must never block AST building. Leave the
        // attr parse in place; the absent diagnostic is a survivable degradation.
      }

      const children = block.children.map(child =>
        buildBlock(child, filePath, "markup", counter, errors)
      ).filter(Boolean);

      // S159 — SPEC §4.14 HTML-element `:`-shorthand content-model rule
      // (S154 design ruling (a)). For a NON-VOID lowercase HTML element that
      // carries a `:`-shorthand body (`<span : @label>`), the body expression
      // IS the element's single-expression body — byte-identical to the
      // bare-body form `<span>${@label}</span>`. We realize that equivalence
      // by SYNTHESIZING the body child(ren) here (Approach (a) AST-synthesis),
      // so the existing emit-html (iterates children) + dependency-graph
      // (recurses children, clearing the prior E-DG-002 false-fire) + type
      // system all handle it with NO emit-side change.
      //
      // The synthesis re-parses a reconstructed `<tag>BODY</tag>` raw source
      // through the SAME block-splitter + buildBlock path the explicit
      // bare-body form takes — guaranteeing byte-identity rather than
      // hand-crafting an AST node whose shape could drift.
      //
      // Scope (R1/R3/R5):
      //   - Lowercase HTML elements ONLY (`getElementShape(tag) !== null`).
      //   - NON-void (`!getElementShape(tag).isVoid`); void elements are
      //     rejected by the type-system E-COLON-SHORTHAND-ON-VOID guard and
      //     get NO synthesis.
      //   - NOT a component (`block.isComponent !== true`) — component
      //     `:`-shorthand is a separate concern (§4.15), left untouched.
      //   - NOT a `@.`-contextual-sigil body — `<li : @.name>` is the §17.7
      //     `<each>` per-item form, OWNED by emit-each (which reads
      //     `shorthandBodyRaw` directly + ignores children). Synthesizing here
      //     would put a child the iteration-scope rewriter doesn't expect, and
      //     a bare `@.` outside any `<each>` must still surface E-SYNTAX-064.
      //
      // Body interpretation follows §4.18 code-default-body grammar:
      //   - An EXPRESSION body (`@label`, `someFn()`, member access) ->
      //     interpolated form `${expr}` so `<span : @label>` renders the
      //     VALUE (`<span>${@label}</span>`), NOT the literal characters.
      //   - A DISPLAY-TEXT-LITERAL body (`"Static item"`, §4.18.3) -> the
      //     UNQUOTED content as display text (quotes stripped per §4.18.3;
      //     a `"..."` literal may carry one `${...}` interpolation inside,
      //     §4.18.4, which the synthesized free-text body handles).
      if (
        block.closerForm === "shorthand" &&
        typeof shorthandBodyRaw === "string" &&
        shorthandBodyRaw.length > 0 &&
        block.isComponent !== true &&
        children.length === 0
      ) {
        const _shape = getElementShape(block.name || "");
        const _isNonVoidHtml = _shape !== null && _shape.isVoid !== true;
        // `@.` contextual-sigil body — owned by emit-each (R3). Detect the
        // `@.` token (the iteration sigil) anywhere in the body; skip synthesis
        // so the each/lift path keeps ownership and the outside-each misuse
        // still reaches E-SYNTAX-064.
        const _referencesContextualSigil = /(^|[^@\w.])@\./.test(" " + shorthandBodyRaw);
        if (_isNonVoidHtml && !_referencesContextualSigil) {
          // Distinguish a `"..."` display-text literal (§4.18.3) from an
          // expression body. A display-text literal is `"..."` (mirrors the
          // engine-state-child / match-arm `:`-shorthand literal detection).
          const _trimmed = shorthandBodyRaw.trim();
          const _isDisplayLiteral =
            _trimmed.length >= 2 &&
            _trimmed.charAt(0) === '"' &&
            _trimmed.charAt(_trimmed.length - 1) === '"';
          let _synthBodySrc;
          if (_isDisplayLiteral) {
            // Strip the surrounding quotes (§4.18.3 — the literal's CONTENT is
            // the display text). Unescape the three display-text escapes
            // (`\"` -> `"`, `\\` -> `\`, `\${` -> `${`) so the free-text body
            // carries the intended characters. An interior `${...}` is a
            // genuine interpolation (§4.18.4) and is preserved verbatim.
            const _inner = _trimmed.slice(1, -1)
              .replace(/\\\$\{/g, "${")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\");
            _synthBodySrc = _inner;
          } else {
            // Expression body — interpolated form so the VALUE renders
            // (byte-identical to `<tag>${expr}</tag>`).
            _synthBodySrc = "${" + shorthandBodyRaw + "}";
          }
          // Re-parse `<tag>BODY</tag>` through the SAME parse path the explicit
          // bare-body form takes, then lift the produced markup block's
          // children onto this node. `_synthErrors` is discarded — any
          // diagnostic the synthesized body would raise is raised identically
          // by the equivalent explicit bare-body form, which is the canonical
          // diagnostic locus (avoids double-firing for the shorthand sugar).
          try {
            const _synthSrc = "<" + block.name + ">" + _synthBodySrc + "</" + block.name + ">";
            const _synthBs = _splitBlocksForP2Form1(filePath, _synthSrc);
            const _synthErrors = [];
            const _synthBlocks = (_synthBs && Array.isArray(_synthBs.blocks)) ? _synthBs.blocks : [];
            const _synthMarkup = _synthBlocks.find(
              (b) => b && b.type === "markup" && b.name === block.name,
            );
            if (_synthMarkup && Array.isArray(_synthMarkup.children)) {
              for (const _synthChild of _synthMarkup.children) {
                const _childNode = buildBlock(_synthChild, filePath, "markup", counter, _synthErrors);
                if (_childNode) children.push(_childNode);
              }
            }
          } catch (_e) {
            // Defensive: a synthesis failure must never block AST building.
            // The unsynthesized node degrades to the pre-S159 empty-body
            // behavior — survivable, and surfaced by tests if it ever fires.
          }
        }
      }


      return {
        id: ++counter.next,
        kind: "markup",
        tag: block.name,
        attrs,
        children,
        selfClosing: block.closerForm === "self-closing",
        closerForm: block.closerForm,
        // R25-Bug-40: SPEC §4.14 `:`-shorthand body expression (when
        // closerForm:"shorthand"). Otherwise null. Captured from
        // block.raw at the introducer offset above; codegen
        // (emit-each.ts) consumes this when rendering per-item factory
        // bodies for `<each>` iteration. The existing
        // detectShorthandOpener / extractShorthandExpr helpers in
        // emit-each still work from raw scanning, but this field is the
        // authoritative source.
        shorthandBodyRaw: shorthandBodyRaw,
        isComponent: block.isComponent === true,
        openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
        // P3.A: propagate the channel-export markers from liftBareDeclarations
        // through to the AST markup node. CHX (CE phase 2) and MOD use these
        // to distinguish per-page channel decls from cross-file exports.
        _p3aIsExport: block._p3aIsExport === true ? true : undefined,
        _p3aExportName: block._p3aExportName ?? undefined,
        span,
      };
    }

    // --------------------------------------------------------------- state
    case "state": {
      // §51.3: `< machine name=MachineName for=TypeName>` — machine declaration
      // BS creates: block.name = "machine", block.raw = full tag content
      // including the opener line and body text up to the `/` closer.
      // Children contain text nodes with the rule content.
      //
      // S25 — attribute-form migration per S24 ratification (SPEC §51.3.2):
      // the opener uses bareword-ident attribute values, matching the
      // declarative syntactic form used everywhere else (@x: Type, as Type,
      // type Foo, < state for=X>). The pre-S25 sentence form
      // `< machine Name for Type>` is rejected with E-ENGINE-020.
      //
      // P1 (2026-04-30, state-as-primary unification): canonical keyword is now
      // `engine` (DD1 §6.6, design-insight `state-as-primary`). The legacy
      // `machine` keyword continues to compile but emits W-DEPRECATED-001.
      // Both forms produce a `engine-decl` AST node — the internal naming is
      // not renamed in P1 to keep blast radius bounded; that rename moves with
      // P3 when downstream stages consume the renamed shape uniformly.
      if (block.name === "machine" || block.name === "engine") {
        const isLegacyMachineKeyword = block.name === "machine";
        if (isLegacyMachineKeyword) {
          errors.push(new TABError(
            "W-DEPRECATED-001",
            `W-DEPRECATED-001: \`<machine>\` keyword is deprecated; use \`<engine>\` instead. ` +
            `Both forms compile in P1; \`<machine>\` becomes E-DEPRECATED-001 in P3. ` +
            `Migration: rename the keyword (the rest of the declaration is unchanged).`,
            span,
          ));
          errors[errors.length - 1].severity = "warning";
        }
        const keyword = block.name; // "machine" or "engine"
        const machineRaw = (block.raw || "").trim();
        // Extract header: "< {keyword} name=X for=Y [derived=@Z | derived=match @Z {...}]>"
        // S83 B3 — brace-aware opener-end finder. Pre-fix used `indexOf(">")`
        // which returned the `>` inside `=>` for inline-expression bodies on
        // `derived=match @x { .V1 => .V2 }`. The brace-aware scan skips over
        // `{...}` content (and over `=>` arrows, which are inside the brace
        // region) to find the actual closing `>` of the opener.
        function _findOpenerEnd(s) {
          let depth = 0;
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) return i;
          }
          return -1;
        }
        const firstLineEnd = _findOpenerEnd(machineRaw);
        const headerLine = firstLineEnd >= 0
          ? machineRaw.slice(0, firstLineEnd)
          : machineRaw.split("\n")[0];
        // Strip "< {keyword} " prefix
        let header = headerLine;
        const machineIdx = header.indexOf(keyword);
        if (machineIdx >= 0) header = header.slice(machineIdx + keyword.length).trim();
        // Strip trailing `/` (self-closing) or `>` fragments from the header.
        header = header.replace(/[/>]+\s*$/, "").trim();

        // Bareword-ident regex — reused across the three attributes.
        const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/;
        const nameMatch = header.match(new RegExp(`\\bname\\s*=\\s*(${IDENT.source})\\b`));
        const forMatch = header.match(new RegExp(`\\bfor\\s*=\\s*(${IDENT.source})\\b`));
        const derivedMatch = header.match(new RegExp(`\\bderived\\s*=\\s*@(${IDENT.source})\\b`));
        // S83 B3 — Move-14 inline-expression body: `derived=match @VAR { ... }`.
        // SPEC §51.0.J: the rich form lets the derived projection be an arbitrary
        // expression. Today's scope: detect the `match @VAR { BODY }` shape,
        // capture VAR (as the single upstream) and BODY (raw text), and store
        // both for codegen. Codegen (emit-engine.ts) re-uses the existing
        // `rewriteExpr` pipeline to lower the match body to a JS IIFE. Other
        // inline-expression forms (`derived=fn(@x)`, `derived=if ... else ...`,
        // etc.) are NOT covered in this slice — see B3 follow-on.
        const inlineMatchRe = new RegExp(
          `\\bderived\\s*=\\s*match\\s+@(${IDENT.source})\\s*\\{([\\s\\S]*)\\}\\s*$`,
        );
        const inlineMatchMatch = derivedMatch ? null : header.match(inlineMatchRe);
        // §51.0.B (S67/S68 — A1b B14): canonical engine syntax extensions
        //   var=NAME       — override auto-derived variable name (§51.0.C)
        //   initial=.X     — starting variant (§51.0.E; B14 RECORDS, B15 validates)
        //   pinned         — bareword modifier (§51.0.B + §6.10)
        const varMatch = header.match(new RegExp(`\\bvar\\s*=\\s*(${IDENT.source})\\b`));
        const initialMatch = header.match(new RegExp(`\\binitial\\s*=\\s*\\.(${IDENT.source})\\b`));
        // §51.0.S.2.2 (S154 — #14 event-payload-transition, PARSER batch 1) —
        // `accepts=MsgType` engine-OPENER attribute. Value is a bare enum-type
        // identifier (e.g. `accepts=DragMsg`) declaring the message vocabulary
        // the engine's `(state × message)` arms dispatch on. Captured here as
        // RECOGNITION ONLY — the parser records the raw identifier string; the
        // typer (BATCH 2) resolves it to a declared `:enum` (E-ENGINE-ACCEPTS-
        // NOT-ENUM) and checks per-state message-arm exhaustiveness. `null`
        // when absent. The IDENT (not `\.IDENT`) shape mirrors `for=Type` /
        // `var=NAME`: the value is a TYPE identifier, not a `.Variant` literal.
        const acceptsMatch = header.match(new RegExp(`\\baccepts\\s*=\\s*(${IDENT.source})\\b`));
        // `pinned` as a bareword (not `pinned=`). Standalone-token
        // requirement (preceded by whitespace, followed by whitespace / `>`
        // / `/` / end) — defense-in-depth against `.X.pinned`-style
        // mis-matches (mirrors the `historyAttr` regex tightening landed
        // S70 post-A5-3-SHIP for the SPEC §51.0.N `.Variant.history` shape).
        const pinnedMatch = /(?:^|\s)pinned(?=\s|>|\/|$)/.test(header);
        // §51.0.H Form 3 (S148, Insight 33 Fork C1) — `effect=${...}` on the
        // ENGINE OPENER (NOT a state-child): the boot-only init effect, the
        // effect of the implicit init→`initial=` transition (Elm init+Cmd).
        // DISTINCT slot from the state-child `effect=` (§51.0.H Form 1): same
        // attribute name, different host (opener vs state-child), different
        // trigger (construction vs leaving-a-state). Captured here as RAW logic
        // body text (the substring between `${` and the matching `}`, WITHOUT
        // the `${` `}` wrapper) so codegen can lower it via `rewriteExpr`, the
        // same as the state-child effectRaw. `null` when absent.
        //
        // Brace-AND-string-aware scan: the effect body may contain `"}"` or
        // `'}'` string literals, so a naive depth-only scan would terminate
        // early. Mirrors `_findOpenerEnd`'s string-skip discipline (the
        // engine-statechild-parser effectRaw scan is depth-only, which is
        // adequate there because state-child openers are short; the opener
        // effect body is a full logic block, so it gets the stronger scan).
        // S182 (Fix 1) — `effect=` is a §7 logic-context block (§51.0.H Form 3),
        // so the `${...}` form is REQUIRED; the bare single-expression sugar
        // (`onclick=load()`, §5.2.3) does NOT extend here. A bare/unbalanced
        // `effect=` value was previously captured as null → silently tree-shaken
        // (the boot effect never fired). Flag the malformed case so SYM (PASS
        // 10.A `registerEngineDecl`) can fire `E-ENGINE-EFFECT-NOT-INTERPOLATED`
        // (Error). Detect via `effect=` present in the header WITHOUT a following
        // `${`; the `${...}`-capture path below is untouched.
        let openerEffect = null;
        let openerEffectMalformed = false;
        let openerEffectBadSlice = null;
        const openerEffectPresentIdx = header.search(/(?:^|\s)effect\s*=/);
        const openerEffectIdx = header.search(/(?:^|\s)effect\s*=\s*\$\{/);
        if (openerEffectPresentIdx >= 0 && openerEffectIdx < 0) {
          // `effect=` is present but NOT followed by `${` — a bare value.
          openerEffectMalformed = true;
          // Capture a short raw slice for the diagnostic message (the run of
          // characters after `effect=` up to the next top-level `>` / `/` / EOL).
          const afterEq = header.slice(openerEffectPresentIdx).replace(/^\s*effect\s*=\s*/, "");
          const sliceMatch = afterEq.match(/^[^>\n]*/);
          openerEffectBadSlice = sliceMatch ? sliceMatch[0].trim() : afterEq.trim();
          if (openerEffectBadSlice.length === 0) openerEffectBadSlice = null;
        }
        if (openerEffectIdx >= 0) {
          const dollarBrace = header.indexOf("${", openerEffectIdx);
          if (dollarBrace >= 0) {
            let j = dollarBrace + 2;
            let braceDepth = 1;
            let inDQ = false;
            let inSQ = false;
            while (j < header.length && braceDepth > 0) {
              const ch = header[j];
              if (inDQ) { if (ch === '"') inDQ = false; else if (ch === "\\") j++; j++; continue; }
              if (inSQ) { if (ch === "'") inSQ = false; else if (ch === "\\") j++; j++; continue; }
              if (ch === '"') { inDQ = true; j++; continue; }
              if (ch === "'") { inSQ = true; j++; continue; }
              if (ch === "{") { braceDepth++; j++; continue; }
              if (ch === "}") { braceDepth--; if (braceDepth === 0) break; j++; continue; }
              j++;
            }
            if (braceDepth === 0) {
              // The inner expression text between `${` and the matching `}`.
              openerEffect = header.slice(dollarBrace + 2, j).trim();
              if (openerEffect.length === 0) openerEffect = null;
            }
            // Unbalanced braces → openerEffect stays null (best-effort capture;
            // downstream rewriteExpr would surface a parse error if the malformed
            // text reached codegen, but a null here keeps the AST clean).
          }
          // S182 (Fix 1) — `effect=${` was present but the capture failed
          // (unbalanced braces, or an empty `${ }` body): treat as a malformed
          // effect so SYM fires E-ENGINE-EFFECT-NOT-INTERPOLATED rather than
          // silently dropping it.
          if (openerEffect === null) {
            openerEffectMalformed = true;
            if (dollarBrace >= 0) {
              const raw = header.slice(openerEffectIdx).replace(/^\s*/, "").match(/^[^\n]*/);
              openerEffectBadSlice = raw ? raw[0].trim() : null;
            }
          }
        }
        // §51.0.P (S67 ratification, struck 2026-05-08) — `parallel` bareword
        // on file-scope `<engine>` was naming sugar over §51.4 multi-engine
        // pattern. Closed retroactively per parallel-disposition deep-dive
        // (synonym-test failure + SCXML semantic audit). Recognition removed;
        // the keyword in attribute position is now treated as an unknown
        // attribute and ignored silently (no diagnostic, no AST field). The
        // §51.4 pattern (two file-scope `<engine>` declarations) IS the
        // parallel pattern; orthogonality is documented with a comment.

        let engineName = "";
        let governedType = "";
        let sourceVar = null;
        // S83 B3 — Move-14 inline-expression body. When present, codegen
        // emits a richer projection (lower the match body through `rewriteExpr`).
        // `sourceVar` still carries the (single) upstream — same data DG and
        // cycle-detection need — but `inlineMatchBody` is the load-bearing
        // signal for codegen to emit a match-style projection closure instead
        // of the identity projection.
        let inlineMatchBody = null;

        if (nameMatch) {
          engineName = nameMatch[1];
          if (forMatch) governedType = forMatch[1];
          if (derivedMatch) sourceVar = derivedMatch[1];
          else if (inlineMatchMatch) {
            sourceVar = inlineMatchMatch[1];
            inlineMatchBody = inlineMatchMatch[2].trim();
          }
        } else if (forMatch) {
          // §51.0 canonical form: `<engine for=Type ...>` (no `name=`).
          // The auto-declared variable name is derived from the type per §51.0.C
          // (lowercase-first-character). The `engineName` field on the AST node
          // is back-filled with the auto-derived name so legacy consumers
          // (codegen, NR) continue to work transparently. Per audit Phase-0,
          // the `var=` override (if present) supersedes the auto-derived name.
          governedType = forMatch[1];
          if (derivedMatch) sourceVar = derivedMatch[1];
          else if (inlineMatchMatch) {
            sourceVar = inlineMatchMatch[1];
            inlineMatchBody = inlineMatchMatch[2].trim();
          }
          // Backfill engineName via §51.0.C auto-derive rule (literal lowercase-first).
          // The actual var-name resolution (override + auto-derive) lives in the
          // `varName` field below; engineName mirrors it for backcompat with
          // legacy engineName-consumers in codegen / NR.
          if (varMatch) {
            engineName = varMatch[1];
          } else if (governedType.length > 0) {
            engineName = governedType[0].toLowerCase() + governedType.slice(1);
          }
        } else {
          // Pre-S25 sentence form — detect and report. Accept a best-effort
          // extraction so downstream passes don't crash on garbage, but push
          // a hard error so the file fails to compile.
          const forIdx = header.indexOf(" for ");
          if (forIdx >= 0) {
            engineName = header.slice(0, forIdx).trim();
            governedType = header.slice(forIdx + 5).trim();
          } else {
            engineName = header.trim();
          }
          const legacyDerived = governedType.match(/^(.*?)\s+derived\s+from\s+@([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
          if (legacyDerived) {
            governedType = legacyDerived[1].trim();
            sourceVar = legacyDerived[2];
          }
          errors.push(new TABError(
            "E-ENGINE-020",
            `E-ENGINE-020: \`< machine>\` opener uses the pre-S25 sentence form. ` +
            `Use the attribute form: \`< machine name=${engineName || "MachineName"} for=${governedType || "TypeName"}${sourceVar ? ` derived=@${sourceVar}` : ""}>\`. ` +
            `The attribute form aligns with the rest of scrml's declarative syntax (@x: Type, as Type, type Foo).`,
            span,
          ));
        }

        // S171 — §51.0.J derived-engine `derived=match @VAR { ... }` arm-arrow
        // deprecation coverage. `inlineMatchBody` is captured as RAW TEXT (the
        // arms are NOT structured into match-arm nodes, so the `armArrow` field
        // the block-form / value-return loci carry is absent here). Scan the
        // body for its arm-separator glyphs + ABSOLUTE source offsets so the
        // W-MATCH-ARROW-LEGACY lint (type-system.ts `engine-decl` case) and
        // `bun scrml migrate --fix` (commands/migrate.js) can both surface /
        // rewrite a deprecated `=>` / `->` arm separator here in lockstep with
        // every other match-shaped arm. ZERO codegen impact: emit-engine.ts
        // reconstructs `match @VAR {BODY}` and lowers it via `rewriteExpr`,
        // which treats all three arrows identically. `null` for non-derived /
        // legacy `derived=@x` engines; `[]` when the body has no recognizable
        // arm separator. The absolute offset is `block.span.start` (the opener
        // start) + the body's position inside the verbatim `block.raw` slice.
        let inlineMatchArmArrows = null;
        if (inlineMatchBody != null && inlineMatchBody.length > 0 && sourceVar) {
          const rawBlk = typeof block.raw === "string" ? block.raw : "";
          const blkStart = (span && typeof span.start === "number") ? span.start : 0;
          // Locate the body inside the verbatim opener slice. The opener is
          // `... derived = match @VAR { BODY }`; anchor on the `{` that follows
          // the `match @VAR` prefix (brace-aware via the same `derived\s*=\s*
          // match\s+@VAR\s*{` shape the capture regex used). The body starts at
          // the char after that `{`. `inlineMatchBody` was `.trim()`-ed, so we
          // search the untrimmed region for its first non-space char.
          const openerRe = new RegExp(
            `\\bderived\\s*=\\s*match\\s+@${sourceVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
          );
          const m = openerRe.exec(rawBlk);
          if (m) {
            const afterBrace = m.index + m[0].length; // index just past the `{`
            // Skip leading whitespace to align with the `.trim()`-ed body.
            let bodyRel = afterBrace;
            while (bodyRel < rawBlk.length && /\s/.test(rawBlk[bodyRel])) bodyRel++;
            const bodyAbsStart = blkStart + bodyRel;
            inlineMatchArmArrows = scanInlineMatchArmArrows(inlineMatchBody, bodyAbsStart);
          } else {
            inlineMatchArmArrows = [];
          }
        }

        // §51.0.C — compute the auto-declared variable name. Resolution order:
        //   1. `var=NAME` override → use NAME verbatim
        //   2. `name=NAME` legacy form → use NAME verbatim (back-compat)
        //   3. Auto-derive from `for=Type` per §51.0.C lowercase-first-character rule
        //   4. Empty string (parse failed; downstream surfaces a clearer error)
        let varName = "";
        let varNameOverride = null;
        if (varMatch) {
          varName = varMatch[1];
          varNameOverride = varMatch[1];
        } else if (nameMatch) {
          varName = nameMatch[1]; // legacy `name=` IS the variable name
        } else if (governedType.length > 0) {
          // §51.0.C literal rule: lowercase the first character only.
          // Edge cases (all-uppercase types like URL → uRL): per audit §1.2,
          // implement literal rule per spec; surface as small spec amendment if
          // current behavior diverges. See SURVEY.md for deferral notes.
          varName = governedType[0].toLowerCase() + governedType.slice(1);
        }

        // §51.0.E — record initial=.Variant. B14 records; B15 validates against
        // the type's variant set + emits W-ENGINE-INITIAL-MISSING if absent.
        const initialVariant = initialMatch ? initialMatch[1] : null;

        // §51.0.S.2.2 (S154) — record accepts=MsgType. PARSER batch 1 RECORDS
        // the raw enum-type identifier; BATCH 2 (typer) resolves + validates.
        const acceptsType = acceptsMatch ? acceptsMatch[1] : null;

        // §51.0.B + §6.10 — `pinned` bareword modifier.
        const pinned = pinnedMatch === true;

        // Extract rules from children (text nodes containing the rule lines).
        //
        // A5-5b (S77, 2026-05-10): concatenate child `raw` text WITHOUT
        // inserting a `\n` separator. Pre-A5-5b the loop appended `"\n"`
        // between children, which fragmented `${expr}` substrings — the
        // block-splitter parses `${...}` inside a `<machine>` body as a
        // separate `logic` child, so a rule like `.X after ${@d}ms => .Y`
        // arrives as 3 children (text, logic, text) and the inserted `\n`
        // turned them into three broken lines. `splitRuleLines` (in
        // type-system.ts) tracks brace depth and would have kept the rule
        // intact had the children been concatenated cleanly.
        //
        // Behavioral preservation: text-only `<machine>` bodies appear as
        // ONE text child with internal newlines that already delimit the
        // rules; no inserted `\n` is needed. The existing trailing `.trim()`
        // at the end of this block strips any trailing whitespace.
        let rulesRaw = "";
        // Phase A10 (S78, 2026-05-10) — preserve walkable body children
        // alongside the existing rulesRaw concat. The block-splitter has
        // ALREADY recursively descended into the engine body and produced
        // typed walkable children (markup, state, logic, text, comment,
        // <onTimeout>, <onTransition>, <onIdle>, nested <engine>, etc.).
        // Pre-A10 the ast-builder discarded the structure by re-serializing
        // children back into rulesRaw. Per Phase 0 SURVEY §2 the fix is
        // "stop discarding the children" — buildBlock each child to produce
        // proper AST nodes, attach as engine-decl.bodyChildren, and let
        // downstream A1b walkers + body-render codegen consume them.
        //
        // rulesRaw is RETAINED unchanged for engine-statechild-parser's
        // secondary structural pass + legacy-machine arrow-rule grammar +
        // any other consumer that expects the raw substring.
        //
        // bodyChildren is ADDITIVE: undefined when block has no children
        // (legacy zero-child case); empty array on parse-failure (no child
        // produced an AST node); else a non-empty ASTNode[] mirroring the
        // child order of block.children. Each child is built through the
        // same buildBlock entry-point used elsewhere; spans are preserved.
        //
        // **Why discard buildBlock errors during this recurse:**
        // engine state-child openers carry engine-only attribute syntax
        // (`rule=.Variant`, `rule=(.A | .B)`, `rule=*`, `effect=...`, the
        // `:`-shorthand body form, `<onTimeout after=DURATION/>` siblings
        // with bare-token DURATION values). Standard buildBlock attribute
        // parsing produces TAB-time errors (E-ATTR-001 on bare-token attr
        // values; E-SCOPE-001 downstream on bare-token attr values during
        // attribute resolution). The authoritative validator for engine
        // state-child structure is `engine-statechild-parser.ts` (called
        // from SYM PASS 11 — fires E-ENGINE-* family); the authoritative
        // validator for ` body content semantics is the A1b PASS family
        // (Phase A10 Phase 2 extends PASSes 1, 2, 3, 5, 6, 13, 14 to
        // descend into bodyChildren).
        //
        // The errors generated by buildBlock here are duplicates of /
        // weaker than what those authoritative validators produce, AND
        // pre-A10 they were never produced (children were not walked).
        // Preserving the pre-A10 baseline therefore requires DROPPING the
        // errors generated by this specific recursive build. Real semantic
        // errors fire downstream as before.
        const bodyChildren = [];
        if (block.children && block.children.length > 0) {
          // Collect into a local errors buffer that we discard, so this
          // recurse cannot pollute the file-level errors stream.
          const _bodyErrors = [];
          for (const child of block.children) {
            if (child.raw) rulesRaw += child.raw;
            // Build the child node. Use parentContextKind="markup" so any
            // nested state-children inside the engine body are walked with
            // markup-tree semantics (consistent with the block-splitter's
            // recursive descent treating engine bodies as markup).
            const childNode = buildBlock(child, filePath, "markup", counter, _bodyErrors);
            if (childNode) bodyChildren.push(childNode);
          }
          // _bodyErrors intentionally discarded — see comment block above.
        }
        // Also extract from raw content after the header line
        if (!rulesRaw && firstLineEnd >= 0) {
          rulesRaw = machineRaw.slice(firstLineEnd + 1);
          // Strip trailing closer
          rulesRaw = rulesRaw.replace(/\/\s*$/, "");
        }
        rulesRaw = rulesRaw.trim();

        return {
          id: ++counter.next,
          kind: "engine-decl",
          engineName: engineName,
          governedType,
          rulesRaw,
          // Phase A10 (S78, 2026-05-10) — walkable body children. See note
          // above the bodyChildren = [] declaration for full rationale.
          // ADDITIVE field: undefined on legacy zero-child engine bodies,
          // [] on parse-failure, else ASTNode[] mirroring block.children.
          // Consumers (A1b walkers PASS 1/2/3/5/6/13/14, future body-render
          // codegen) descend into it. Non-consumers (existing emit-engine
          // body-shake, engine-statechild-parser secondary pass) ignore it.
          bodyChildren,
          sourceVar, // §51.9: name of the source reactive var (no `@` prefix), or null
          // S83 B3 — Move-14 inline-expression body. When non-null, codegen
          // emits a richer projection closure (lowering `match @x { ... }` via
          // `rewriteExpr`) instead of the identity projection. The string is
          // the body of the inline `match` block (the contents between `{`
          // and `}`). `null` for the legacy `derived=@x` form and for non-
          // derived engines.
          inlineMatchBody,
          // S171 — arm-separator glyphs of the `derived=match` body, in source
          // order, each `{ glyph: ":>"|"=>"|"->", srcOffset: <absolute> }`.
          // Consumed by the W-MATCH-ARROW-LEGACY lint (type-system.ts) +
          // `migrate --fix` (commands/migrate.js). `null` unless this is an
          // inline-match derived engine; `[]` when no arm separator was found.
          inlineMatchArmArrows,
          // §51.0 canonical fields (S67/S68 — A1b B14):
          //   varName            — the resolved auto-declared variable name (§51.0.C).
          //                        Always set when parse succeeds; equals
          //                        varNameOverride if present, else the
          //                        auto-derived form, else legacy `name=` value.
          //   varNameOverride    — non-null iff `var=` was present.
          //   initialVariant     — non-null iff `initial=.X` was present.
          //   pinned             — true iff `pinned` bareword was present.
          //   isExported         — set later by export Form 1 detection (or
          //                        false if the engine was not exported).
          varName,
          varNameOverride,
          initialVariant,
          // §51.0.S.2.2 (S154 — #14 event-payload-transition, PARSER batch 1):
          //   acceptsType — non-null raw enum-type identifier iff `accepts=Type`
          //                 was present on the opener; null otherwise. BATCH 2
          //                 (typer) resolves to a declared `:enum` and runs
          //                 per-state message-arm exhaustiveness.
          acceptsType,
          // §51.0.H Form 3 (S148, Insight 33 Fork C1) — boot-only opener
          // `effect=${...}` raw logic body, or null when absent. SYM
          // (makeEngineRecord) lifts this onto engineMeta.openerEffect;
          // codegen (emit-engine.ts) lowers it as a module-init fire AFTER the
          // onIdle arm (ordering ruling ii); B16 fires E-ENGINE-EFFECT-ON-
          // DERIVED when it is non-null on a derived engine (ruling iii).
          openerEffect,
          // S182 (Fix 1) — `effect=` present on the opener but NOT in the
          // required `${...}` logic-block form (a bare value, or unbalanced/
          // empty braces). SYM (PASS 10.A `registerEngineDecl`) fires
          // `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error). `openerEffectBadSlice`
          // carries the offending raw text for the message (or null).
          openerEffectMalformed,
          openerEffectBadSlice,
          pinned,
          // §51.0.P (S68 ratification, STRUCK 2026-05-08): the `parallelAttr`
          // field on engine-decl nodes was removed alongside the spec strike.
          // No replacement field — orthogonal-region intent is communicated
          // via §51.4 multi-engine pattern (two file-scope `<engine>`
          // declarations) plus comments where the author wants to flag intent.
          // B14 Form 1 detection (`export <engine ...>`) — set by
          // liftBareDeclarations when the immediately preceding text block
          // contains a trailing `export` keyword. Surfaces to MOD's
          // exportRegistry as `kind: "engine"` per §51.0.D + §21.8.
          isExported: block._b14IsExport === true,
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
          legacyMachineKeyword: isLegacyMachineKeyword,
          span,
        };
      }

      // Match block-form (SPEC §18.0.1, S107 Phase 1 of multi-phase impl arc;
      // see docs/changes/match-block-form-scoping/SCOPING.md).
      //
      // NOTE: this dispatch is unreachable because BS produces type=markup
      // for `<match>` blocks (S107 fix routed `<match>` through the regular
      // markup path via the COMPOUND_LIFT_EXEMPT_TAGS addition); the real
      // match-block dispatch lives in `case "markup":` above. Leaving this
      // defensive copy in `case "state":` in case future BS changes route
      // `<match>` through the state-type path (mirrors engine's dual-residence
      // — engine is `type=markup` in S107+ but the dispatch historically lived
      // here for the legacy `< machine>` whitespace-state-opener path).
      if (block.name === "match") {
        const matchRaw = (block.raw || "").trim();

        // Brace-aware opener-end finder (same shape as engine-decl's helper
        // above — `>` inside `{...}` is skipped so `on=${expr.contains(">")}`
        // doesn't truncate the header).
        function _findMatchOpenerEnd(s) {
          let depth = 0;
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) return i;
          }
          return -1;
        }

        const firstLineEnd = _findMatchOpenerEnd(matchRaw);
        const headerLine = firstLineEnd >= 0
          ? matchRaw.slice(0, firstLineEnd)
          : matchRaw.split("\n")[0];
        // Strip "<match " prefix (also handles `< match` with leading space).
        let header = headerLine;
        const matchIdx = header.indexOf("match");
        if (matchIdx >= 0) header = header.slice(matchIdx + "match".length).trim();
        // Strip trailing `/` (self-closing — invalid for match but defensive)
        // or `>` fragments from the header.
        header = header.replace(/[/>]+\s*$/, "").trim();

        // Bareword-ident regex — reused for `for=Type`.
        const M_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/;
        const forMatchAttr = header.match(new RegExp(`\\bfor\\s*=\\s*(${M_IDENT.source})\\b`));

        // `on=expr` capture: takes everything after `on=` up to the next
        // standalone attribute boundary (whitespace + ident + `=`) OR the
        // end of the header. Conservative regex — full expression parsing
        // defers to Phase 2 (which will route through the existing ExprNode
        // pipeline). For Phase 1, the common shapes `on=@ident`, `on="..."`,
        // `on=${...}` are captured verbatim into `onExprRaw`.
        let onExprRaw = null;
        const onPos = header.search(/\bon\s*=/);
        if (onPos >= 0) {
          const afterEq = header.slice(onPos).replace(/^\bon\s*=\s*/, "");
          let end = afterEq.length;
          let depth = 0;
          // S177 bug-48 — track paren + bracket depth too, so a `>` and a
          // whitespace boundary INSIDE an `=>` arrow / call-arg `(...)` / `[...]`
          // (e.g. `on=@nums.filter(c => c == 1)`) is NOT mis-read as the opener's
          // `>` or as an attribute boundary (the `c == 1` arrow body would
          // otherwise look like a `c=` attribute and truncate the capture).
          let parenDepth = 0;
          let bracketDepth = 0;
          let inDQ = false;
          let inSQ = false;
          for (let i = 0; i < afterEq.length; i++) {
            const c = afterEq[i];
            if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
            if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
            if (c === '"') { inDQ = true; continue; }
            if (c === "'") { inSQ = true; continue; }
            if (c === "{") { depth++; continue; }
            if (c === "}") { if (depth > 0) depth--; continue; }
            if (c === "(") { parenDepth++; continue; }
            if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
            if (c === "[") { bracketDepth++; continue; }
            if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
            // Attribute boundary: whitespace followed by ident-start-char + `=`
            // at depth 0. Look ahead.
            if (depth === 0 && parenDepth === 0 && bracketDepth === 0 && /\s/.test(c)) {
              let j = i;
              while (j < afterEq.length && /\s/.test(afterEq[j])) j++;
              if (j < afterEq.length && /[A-Za-z_$]/.test(afterEq[j])) {
                let k = j;
                while (k < afterEq.length && /[A-Za-z0-9_$:-]/.test(afterEq[k])) k++;
                while (k < afterEq.length && /\s/.test(afterEq[k])) k++;
                if (afterEq[k] === "=") {
                  end = i;
                  break;
                }
              }
            }
          }
          onExprRaw = afterEq.slice(0, end).trim();
          if (onExprRaw === "") onExprRaw = null;
        }

        const forType = forMatchAttr ? forMatchAttr[1] : "";

        // Capture armsRaw: body text after the opener line, before the closer.
        // The closer `</>` or `</match>` is excluded; everything else (text +
        // markup tokens for arm-children) is captured verbatim for the Phase 2
        // arm-parser to process.
        let armsRaw = "";
        if (Array.isArray(block.children)) {
          for (const child of block.children) {
            if (child && typeof child === "object" && typeof child.raw === "string") {
              armsRaw += child.raw;
            }
          }
        }
        if (!armsRaw && firstLineEnd >= 0) {
          armsRaw = matchRaw.slice(firstLineEnd + 1);
          armsRaw = armsRaw.replace(/<\s*\/\s*(?:match)?\s*>\s*$/, "");
        }
        armsRaw = armsRaw.trim();

        return {
          id: ++counter.next,
          kind: "match-block",
          forType,       // bareword type name (REQUIRED per §18.0.1; SYM PASS validates)
          onExprRaw,     // raw text of on= attribute (Phase 2 parses via ExprNode pipeline)
          armsRaw,       // raw body text — Phase 2's match-statechild-parser produces MatchArmEntry[]
          span,
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
        };
      }

      const attrTokens = tokenizeAttributes(
        block.raw,
        block.span.start,
        block.span.line,
        block.span.col,
        "state"
      );

      // §35.2: Check for typed attribute declarations. If present, this is a
      // state constructor definition, not a state instantiation.
      const { attrs, typedAttrs, hasTypedDecls } = parseTypedAttributes(attrTokens, filePath, errors);

      // Pass our own name down as parentStateName so nested state blocks
      // (substates per §54.2) can tag themselves with their parent's name.
      const rawChildren = block.children.map(child =>
        buildBlock(child, filePath, "state", counter, errors, block.name)
      ).filter(Boolean);

      // S32 Phase 4b (§54.3): collapse `text-ending-in-signature` + `logic`
      // sibling pairs into `transition-decl` nodes. Non-matching children
      // pass through untouched. Phase 4d: stamp the declaring state's name
      // as `fromSubstate` on each emitted transition-decl so the type
      // system can bind `from` to that state's type inside the body.
      const children = collapseTransitionDecls(rawChildren, filePath, counter, block.name);

      // S32 Phase 3a: if we are nested inside another state block, tag as substate (§54.2).
      const substateMetadata = parentStateName
        ? { isSubstate: true, parentState: parentStateName }
        : {};

      if (hasTypedDecls) {
        // State constructor definition — `< name attrib(type)>` with typed declarations
        return {
          id: ++counter.next,
          kind: "state-constructor-def",
          stateType: block.name,
          typedAttrs,
          attrs,       // any non-typed attrs (e.g., metadata)
          children,    // constructor body
          ...substateMetadata,
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
          span,
        };
      }

      return {
        id: ++counter.next,
        kind: "state",
        stateType: block.name,
        attrs,
        children,
        ...substateMetadata,
        openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
        span,
      };
    }

    // --------------------------------------------------------------- logic
    case "logic": {
      // Body is between the opener and `}`.
      // Regular `${...}` blocks use a 2-char opener; §54.3 transition bodies
      // (Phase 4a) push a `logic` frame on a bare `{` — 1-char opener.
      const prefixLen = block.raw && block.raw.startsWith("${") ? 2 : 1;
      const bodyRaw = preprocessWorkerAndStateRefs(block.raw.slice(prefixLen, block.raw.length - 1));
      // S180 D3.1 — `_bareDeclLift` blocks (liftBareDeclarations 4 sites) PREPEND
      // a FICTIONAL `${` to `raw` but keep `span` at body[0] (the original text).
      // For a REAL `${...}` block, span.start points at the `$`, so the body
      // starts `prefixLen` chars in. For these synthetic blocks span.start ALREADY
      // points at the body, so the body-offset must NOT advance — otherwise every
      // child node span is shifted +prefixLen in source coords (breaking the
      // W-DEPRECATED-SERVER-MODIFIER span Migration 4 reads, and others). We slice
      // `raw` by prefixLen (the `${` IS in raw) but anchor the offset at span.start.
      const _bodyShift = block._bareDeclLift === true ? 0 : prefixLen;
      const bodyOffset = block.span.start + _bodyShift;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + _bodyShift;

      // R25-Bug-42 (S138): synthetic logic blocks created by liftBareDeclarations
      // (file lines ~999/1099/1222/1248/1275/1307/1335) are wrapped in `${...}`
      // AFTER BS has already run, so their child block array is empty even when
      // the wrapped text contains brace-delimited sigil blocks (`?{...}` /
      // `!{...}` / `#{...}` / etc.). Without children, tokenizeLogic emits raw
      // PUNCT tokens for `?` and `{` — the SQL-aware parseOneStatement return-
      // stmt handler (line ~5500) requires a BLOCK_REF of type "sql" to attach
      // a structured sqlNode. The result: `server function getX() { return ?{...}.all() }`
      // at file top-level emits raw `? { \`...\` } . all ( );` tokens in
      // server.js — invalid JS, security-equivalent to E-CG-006 silently fired.
      //
      // Fix: when this is a synthetic logic block AND its children array is empty
      // AND the wrapped body contains a brace-delimited sigil opener, re-run
      // splitBlocks on the wrapped `${bodyRaw}` to derive the proper children.
      // splitBlocks's brace-context detection (line ~1351) creates the nested
      // sql / error-effect / etc. children correctly when wrapped in a logic
      // frame. We then adjust each child's span by block.span.start so the
      // span offsets align with the bodyOffset tokenizeLogic uses.
      //
      // Cross-refs: R25-Bug-42 docs/changes/r25-bug-42-server-fn-star-sql-2026-05-27/;
      // SPEC §13 `?{}` query expressions; SPEC §37 SSE `server function*`;
      // SPEC §40.8 default-logic-mode.
      let _liveChildren = block.children;
      if (block._synthetic === true && (!_liveChildren || _liveChildren.length === 0)) {
        const _hasSigilBlock = /[\$?#!\^~](?:=*\{)/.test(bodyRaw);
        if (_hasSigilBlock) {
          const _wrappedSrc = "${" + bodyRaw + "}";
          const _subResult = _splitBlocksForP2Form1(filePath, _wrappedSrc);
          // Expect a single top-level logic block whose children carry the
          // brace-delimited sigil blocks. Defensive: only adopt children when
          // the result matches the expected shape.
          const _innerLogic = (_subResult && Array.isArray(_subResult.blocks))
            ? _subResult.blocks.find((b) => b && b.type === "logic")
            : null;
          if (_innerLogic && Array.isArray(_innerLogic.children) && _innerLogic.children.length > 0) {
            // Adjust spans: splitBlocks's spans are relative to _wrappedSrc =
            // "${" + bodyRaw + "}" (whose body bytes start at index 2). We need
            // child.span.start - bodyOffset === relativePositionInBodyRaw so
            // tokenizeLogic (relStart = child.span.start - bodyOffset) recovers
            // the position. A child at _wrappedSrc index (2 + relPos) plus _shift
            // must equal (bodyOffset + relPos) → _shift = bodyOffset - 2. For a
            // normal synthetic block bodyOffset = span.start + 2 so _shift =
            // span.start (the prior value); for an S180 D3.1 `_bareDeclLift`
            // block bodyOffset = span.start so _shift = span.start - 2.
            const _shift = bodyOffset - 2;
            function _shiftSpans(n) {
              if (!n || typeof n !== "object") return;
              if (n.span && typeof n.span.start === "number") {
                n.span = {
                  ...n.span,
                  start: n.span.start + _shift,
                  end: n.span.end + _shift,
                };
              }
              if (Array.isArray(n.children)) for (const c of n.children) _shiftSpans(c);
            }
            for (const c of _innerLogic.children) _shiftSpans(c);
            _liveChildren = _innerLogic.children;
            // Also mirror onto the block so downstream consumers (parseLogicBody
            // receives the same array as its childBlocks param) see the children.
            block.children = _liveChildren;
          }
        }
      }

      const tokens = tokenizeLogic(bodyRaw, bodyOffset, bodyLine, bodyCol, _liveChildren);
      const body = parseLogicBody(tokens, filePath, _liveChildren, block, counter, errors, "logic");

      // Hoist imports and exports from the body
      const imports = body.filter(n => n.kind === "import-decl");
      const exports = body.filter(n => n.kind === "export-decl");
      const typeDecls = body.filter(n => n.kind === "type-decl");
      // Attach defChildren to each component-def: siblings that follow it in the body.
      // Mark consumed nodes so they're removed from the body (avoid duplicate CSS output).
      const components = [];
      const consumedIndices = new Set();
      for (let ci = 0; ci < body.length; ci++) {
        if (body[ci].kind === "component-def") {
          const defChildren = [];
          for (let si = ci + 1; si < body.length; si++) {
            if (body[si].kind === "component-def" || body[si].kind === "import-decl" ||
                body[si].kind === "export-decl" || body[si].kind === "type-decl") break;
            defChildren.push(body[si]);
            consumedIndices.add(si);
          }
          body[ci].defChildren = defChildren;
          components.push(body[ci]);
        }
      }
      // Remove consumed nodes from body to prevent duplicate output
      const filteredBody = consumedIndices.size > 0
        ? body.filter((_, i) => !consumedIndices.has(i))
        : body;

      // P3.A: when this logic block was synthesized by liftBareDeclarations
      // for the `export <channel name="X">` Form, rewrite the synthesized
      // export-decl's `exportKind` to "channel" and `exportedName` to the
      // channel's name=value (NOT the synth helper const name). This makes
      // MOD register the export with channel semantics; CHX uses the
      // exportedName to look up the channel-decl in the source file's
      // ast.channelDecls.
      if (block && block._p3aChannelExport) {
        const channelName = block._p3aChannelExport;
        // Walk body[] AND exports[] (both populated by parseLogicBody) and
        // rewrite the export-decl. The synthesized helper-const decl is also
        // dropped from `body` since it's a synth artifact, not a real decl.
        const _rewriteExport = (n) => {
          if (n && n.kind === "export-decl" && typeof n.exportedName === "string"
              && n.exportedName.startsWith("_p3a_channel_export_")) {
            n.exportKind = "channel";
            n.exportedName = channelName;
            n._p3aSynthExport = true;
          }
        };
        for (const n of (body || [])) _rewriteExport(n);
        for (const n of (exports || [])) _rewriteExport(n);
        // Also drop the synthesized const-decl from body (it has no runtime
        // effect; it was only there to give parseLogicBody an export-decl
        // shape to recognize). The export-decl above carries the channel-
        // name semantics; the const-decl can be removed.
        if (Array.isArray(body)) {
          for (let bi = body.length - 1; bi >= 0; bi--) {
            const n = body[bi];
            if (n && n.kind === "const-decl" && typeof n.name === "string"
                && n.name.startsWith("_p3a_channel_export_")) {
              body.splice(bi, 1);
            }
          }
        }
      }
      return {
        id: ++counter.next,
        kind: "logic",
        body: filteredBody,
        imports,
        exports,
        typeDecls,
        components,
        span,
        // P2 §21.2 Form 1 marker — preserved from synthetic logic block
        // produced by liftBareDeclarations when desugaring `export <Foo>...</>`.
        ...(block._p2Form1 ? { _p2Form1: true, _p2Form1Name: block._p2Form1Name } : {}),
        // v0.3 Wave 2 — forward the `_synthetic` marker from liftBareDeclarations
        // so the W-PROGRAM-REDUNDANT-LOGIC walker can distinguish author-written
        // `${...}` blocks from compiler-synthesised lift wrappers. SPEC §40.8.
        ...(block._synthetic ? { _synthetic: true } : {}),
      };
    }

    // --------------------------------------------------------------- sql
    case "sql": {
      const bodyRaw = block.raw.slice(2, block.raw.length - 1);
      const bodyOffset = block.span.start + 2;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + 2;

      const tokens = tokenizeSQL(bodyRaw, bodyOffset, bodyLine, bodyCol);
      const { query, chainedCalls } = parseSQLTokens(tokens, filePath);

      // §8.9.5: `.nobatch()` is a compile-time marker. Strip it from the
      // chain and flag the node so the Batch Planner excludes it from
      // coalescing candidate sets.
      let nobatch = false;
      const filteredCalls = [];
      for (const c of chainedCalls) {
        if (c.method === "nobatch") nobatch = true;
        else filteredCalls.push(c);
      }

      const sqlNode = {
        id: ++counter.next,
        kind: "sql",
        query,
        chainedCalls: filteredCalls,
        span,
      };
      if (nobatch) sqlNode.nobatch = true;
      return sqlNode;
    }

    // --------------------------------------------------------------- css (inline)
    case "css": {
      const bodyRaw = block.raw.slice(2, block.raw.length - 1);
      const bodyOffset = block.span.start + 2;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + 2;

      const tokens = tokenizeCSS(bodyRaw, bodyOffset, bodyLine, bodyCol);
      const rules = parseCSSTokens(tokens, filePath);

      return {
        id: ++counter.next,
        kind: "css-inline",
        rules,
        span,
      };
    }

    // --------------------------------------------------------------- style block
    case "style": {
      // `<style>` blocks: body is everything between `>` and the closer.
      // Since the block splitter treats this as a markup block with name="style",
      // the children already contain the CSS content as text/comment blocks.
      const children = block.children.map(child =>
        buildBlock(child, filePath, "style", counter, errors)
      ).filter(Boolean);

      return {
        id: ++counter.next,
        kind: "style",
        rules: [],        // detailed CSS parsing deferred — body is in children
        children,
        span,
      };
    }

    // --------------------------------------------------------------- error-effect
    case "error-effect": {
      // The raw may have two shapes:
      //   Legacy: `!{ | ::Type e -> body | ... }`
      //   New:    `!{ tryBody } catch Type [as binding] { handlerBody } ...`
      //
      // For legacy we strip `!{` and `}` and tokenize the whole thing.
      // For the new shape we split at the first `}` to get the try body, then
      // parse `catch TYPE [as BINDING] { body }` arms from the remainder.
      const rawContent = block.raw.slice(2); // strip leading `!{`
      const arms = [];

      // Detect whether any `catch` keyword follows the first `}`
      const firstClose = rawContent.indexOf("}");
      const hasCatch = firstClose !== -1 &&
        /\}\s*catch\b/.test(rawContent.slice(firstClose));

      if (hasCatch) {
        // Split: tryBodyRaw is up to first `}`, rest has the catch arms
        const tryBodyRaw = rawContent.slice(0, firstClose);
        let rest = rawContent.slice(firstClose + 1).trim();

        // Parse each `catch TYPE [as BINDING] { handlerBody }` arm
        const catchPattern = /^catch\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*\{/;
        while (rest.length > 0) {
          const m = rest.match(catchPattern);
          if (!m) break;
          const typeName = m[1];
          const binding = m[2] ?? "";
          // Find the matching closing `}` (tracking nesting)
          const openPos = rest.indexOf("{", m.index ?? 0);
          let depth = 0;
          let closePos = openPos;
          for (let ci = openPos; ci < rest.length; ci++) {
            if (rest[ci] === "{") depth++;
            else if (rest[ci] === "}") { depth--; if (depth === 0) { closePos = ci; break; } }
          }
          const handlerBody = rest.slice(openPos + 1, closePos).trim();
          arms.push({
            pattern: typeName,
            binding,
            handler: handlerBody,
            handlerExpr: safeParseExprToNodeGlobal(handlerBody, filePath, block.span?.start ?? 0),
            span: { file: filePath, start: block.span.start, end: block.span.end, line: block.span.line, col: block.span.col },
          });
          rest = rest.slice(closePos + 1).trim();
        }

        // Parse the try body as logic nodes
        const bodyOffset = block.span.start + 2;
        const tryTokens = tokenizeLogic(tryBodyRaw, bodyOffset, block.span.line, block.span.col + 2, []);
        const tryBody = parseLogicBody(tryTokens, filePath, [], block, counter, errors, "logic");

        return {
          id: ++counter.next,
          kind: "error-effect",
          body: tryBody,
          arms,
          span,
        };
      } else {
        // Legacy `| ::Type e -> body` format
        const bodyRaw = rawContent.slice(0, rawContent.length - 1); // strip trailing `}`
        const bodyOffset = block.span.start + 2;
        const tokens = tokenizeError(bodyRaw, bodyOffset, block.span.line, block.span.col + 2);
        const legacyArms = parseErrorTokens(tokens, filePath);
        return {
          id: ++counter.next,
          kind: "error-effect",
          arms: legacyArms,
          span,
        };
      }
    }

    // --------------------------------------------------------------- meta
    case "meta": {
      const bodyRaw = block.raw.slice(2, block.raw.length - 1);
      const bodyOffset = block.span.start + 2;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + 2;

      const tokens = tokenizeLogic(bodyRaw, bodyOffset, bodyLine, bodyCol, block.children);
      const body = parseLogicBody(tokens, filePath, block.children, block, counter, errors, "meta");

      // parentContext: the kind passed in from the enclosing block
      // For top-level meta blocks, default to 'markup'
      const parentContext = parentContextKind
        ? mapParentContext(parentContextKind)
        : "markup";

      return {
        id: ++counter.next,
        kind: "meta",
        body,
        parentContext,
        span,
      };
    }

    // --------------------------------------------------------------- test (~{})
    case "test": {
      const bodyRaw = block.raw.slice(2, block.raw.length - 1);
      const bodyOffset = block.span.start + 2;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + 2;

      const tokens = tokenizeLogic(bodyRaw, bodyOffset, bodyLine, bodyCol, block.children);
      const testGroup = parseTestBody(tokens, filePath, span, errors);

      return {
        id: ++counter.next,
        kind: "test",
        testGroup,
        span,
      };
    }

    default: {
      // E-PARSE-001: unrecognized block structure — returning null would
      // silently drop the block. Record the condition so the user knows what
      // was missed.
      errors.push(new TABError(
        "E-PARSE-001",
        `E-PARSE-001: The construct starting here is not a recognized scrml block. ` +
        `Valid blocks are: markup tags, \`< state>\` blocks, \`\${ }\` logic, \`?{ }\` SQL, \`#{ }\` inline CSS, ` +
        `\`<style>\`, \`!{ }\` error handlers, \`^{ }\` meta, and \`~{ }\` test contexts. ` +
        `If you intended one of these, check that the opening delimiter is spelled correctly.`,
        span,
      ));
      return null;
    }
  }
}

/**
 * Map block.type to the ParentContextKind expected in the MetaBlock contract.
 * @param {string} blockType
 * @returns {string}
 */
function mapParentContext(blockType) {
  switch (blockType) {
    case "markup":      return "markup";
    case "state":       return "state";
    case "logic":       return "logic";
    case "sql":         return "sql";
    case "css":         return "css";
    case "error-effect": return "error";
    case "meta":        return "meta";
    default:            return "markup";
  }
}

// ---------------------------------------------------------------------------
// Hoist collector
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §17.1.1 — else / else-if= chain collapsing
// ---------------------------------------------------------------------------

/** Check if a node is whitespace-only text (doesn't break chains). */
function isWhitespaceText(node) {
  return node.kind === "text" && (!node.value || !node.value.trim());
}

/** Get the named attribute from a markup node's attrs array. */
function getAttr(node, name) {
  if (node.kind !== "markup") return null;
  const attrs = node.attrs ?? [];
  return attrs.find(a => a.name === name) ?? null;
}

/** Has any of the named attributes. */
function hasAttr(node, ...names) {
  return names.some(n => getAttr(node, n) !== null);
}

/**
 * Scan a children array for if=/else-if=/else chains and collapse them
 * into IfChainExpr nodes. Recurses into all children.
 */
function collapseIfChains(nodes, errors, filePath) {
  // First recurse into children of each node
  for (const node of nodes) {
    if (node.children && Array.isArray(node.children)) {
      node.children = collapseIfChains(node.children, errors, filePath);
    }
    // Logic blocks have body arrays with nested markup
    if (node.body && Array.isArray(node.body)) {
      node.body = collapseIfChains(node.body, errors, filePath);
    }
  }

  // Now scan this level for chains
  const result = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    // E-CTRL-005: else or else-if on same element as if=
    if (node.kind === "markup" && hasAttr(node, "if") && (hasAttr(node, "else") || hasAttr(node, "else-if"))) {
      const span = node.span ?? { line: 0, col: 0 };
      errors.push(new TABError(
        "E-CTRL-005",
        `E-CTRL-005: \`else\` or \`else-if=\` and \`if=\` cannot appear on the same element.`,
        span,
      ));
      result.push(node);
      i++;
      continue;
    }

    // E-CTRL-001/002: orphaned else or else-if (no preceding if=)
    if (node.kind === "markup" && !hasAttr(node, "if")) {
      if (hasAttr(node, "else")) {
        const span = node.span ?? { line: 0, col: 0 };
        errors.push(new TABError(
          "E-CTRL-001",
          `E-CTRL-001: \`else\` on line ${span.line} has no preceding \`if=\` element at the same level.`,
          span,
        ));
        result.push(node);
        i++;
        continue;
      }
      if (hasAttr(node, "else-if")) {
        const span = node.span ?? { line: 0, col: 0 };
        errors.push(new TABError(
          "E-CTRL-002",
          `E-CTRL-002: \`else-if=\` on line ${span.line} has no preceding \`if=\` element at the same level.`,
          span,
        ));
        result.push(node);
        i++;
        continue;
      }
    }

    // Not an if= element — pass through
    if (node.kind !== "markup" || !hasAttr(node, "if")) {
      result.push(node);
      i++;
      continue;
    }

    // Found if= — start building chain
    const ifAttr = getAttr(node, "if");
    const branches = [{ condition: ifAttr.value, element: node }];
    let elseBranch = null;
    let j = i + 1;

    while (j < nodes.length) {
      // Skip whitespace-only text nodes
      if (isWhitespaceText(nodes[j])) {
        j++;
        continue;
      }

      const sibling = nodes[j];
      if (sibling.kind !== "markup") break;

      // E-CTRL-004: else/else-if on state opener
      if ((sibling.kind === "state" || sibling.kind === "state-constructor-def") &&
          (hasAttr(sibling, "else") || hasAttr(sibling, "else-if"))) {
        errors.push(new TABError(
          "E-CTRL-004",
          `E-CTRL-004: \`else\` or \`else-if=\` cannot appear on a state object opener.`,
          sibling.span ?? { line: 0, col: 0 },
        ));
        break;
      }

      if (hasAttr(sibling, "else-if")) {
        if (elseBranch) {
          // E-CTRL-003: extending past else
          errors.push(new TABError(
            "E-CTRL-003",
            `E-CTRL-003: The element on line ${(sibling.span?.line ?? 0)} tries to extend a chain that already ended with \`else\`.`,
            sibling.span ?? { line: 0, col: 0 },
          ));
          break;
        }
        const elseIfAttr = getAttr(sibling, "else-if");
        branches.push({ condition: elseIfAttr.value, element: sibling });
        j++;
        continue;
      }

      if (hasAttr(sibling, "else")) {
        if (elseBranch) {
          // E-CTRL-003
          errors.push(new TABError(
            "E-CTRL-003",
            `E-CTRL-003: The element on line ${(sibling.span?.line ?? 0)} tries to extend a chain that already ended with \`else\`.`,
            sibling.span ?? { line: 0, col: 0 },
          ));
          break;
        }
        elseBranch = sibling;
        j++;
        continue;
      }

      // Not an else/else-if — chain ends
      break;
    }

    // If chain has only one branch (just if=, no else/else-if), pass through as-is
    if (branches.length === 1 && !elseBranch) {
      result.push(node);
      i++;
      continue;
    }

    // Produce IfChainExpr node
    result.push({
      id: node.id,
      kind: "if-chain",
      branches,
      elseBranch,
      span: node.span,
    });

    // Skip whitespace nodes between i+1 and j (they were consumed by the chain)
    i = j;
  }

  return result;
}

/**
 * Walk every node reachable from `nodes` and fire E-SWITCH-FORBIDDEN for any
 * `switch-stmt` AST node whose span has NOT already received an
 * E-SWITCH-FORBIDDEN error from one of the inline TAB parser fire sites
 * (parseOneStatement / parseLogicBody main loop).
 *
 * Why a post-parse sweep is required (S99 / A7): the `export function name() {
 * ... }` shape causes the export handler in parseLogicBody's main loop to
 * greedily collect the entire `function ... { body }` into the export-decl's
 * `expr` (collectExpr tracks brace depth and only stops at depth 0 — see
 * ast-builder.js:2390-2395). The body is later re-parsed via the ANOMALY-2
 * synth path at ~L7125 by recursively invoking parseLogicBody on a token
 * slice — but the synth re-parse passes `[]` for `errors` so any inline
 * E-SWITCH-FORBIDDEN emission inside the re-parse is intentionally discarded
 * to avoid double-emit against collectExpr's own pass.
 *
 * The discarded-errors path leaves the `switch-stmt` AST node in place
 * (attached to the synth function-decl's body) but no diagnostic surfaces —
 * a silent soundness hole per SPEC §17 / §34 E-SWITCH-FORBIDDEN row, which
 * forbids the `switch` keyword universally in scrml.
 *
 * This walker runs ONCE at the end of buildAST against the outer-most
 * `errors` array, walking the final AST. Dedup by (code, file, span.start)
 * is exact (the inline fire sites set `tokenSpan(startTok)` whose `start`
 * equals the switch-stmt node's `span.start` from `spanOf(startTok, peek())`).
 * Walker traverses through every `body`, `children`, and `bodyChildren`
 * array — the standard node containers — so nested switch occurrences in
 * function bodies, engine state-children, match arms, etc. are all covered.
 */
function collectForbiddenSwitches(nodes, errors, filePath) {
  // Index existing E-SWITCH-FORBIDDEN errors for dedup. TABError stores its
  // span on `tabSpan` (see L1218 constructor).
  const seen = new Set();
  for (const e of errors) {
    if (e && e.code === "E-SWITCH-FORBIDDEN" && e.tabSpan) {
      seen.add(`${e.tabSpan.file ?? filePath}:${e.tabSpan.start}`);
    }
  }

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "switch-stmt") {
      const sp = node.span;
      const key = sp ? `${sp.file ?? filePath}:${sp.start}` : null;
      if (key && !seen.has(key)) {
        seen.add(key);
        errors.push(new TABError(
          "E-SWITCH-FORBIDDEN",
          "E-SWITCH-FORBIDDEN: `switch` is not a scrml keyword. " +
          "Did you mean: " +
          "`<match for=Type> ... </match>` for structural exhaustive case-analysis " +
          "(Tier 1 block form; produces markup or executes statements per arm), " +
          "or `match expr { .Variant -> ... }` for value-return case-analysis " +
          "(Tier 1 JS-style form; produces a value in expression position)? " +
          "See SPEC §18 for match block-form, primer §1 for the tier ladder.",
          sp ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
      }
      // Continue walking the body — a nested switch inside a switch body is
      // still a violation.
    }
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) visit(item);
      } else if (val && typeof val === "object" && val.kind) {
        visit(val);
      }
    }
  }

  for (const n of nodes) visit(n);
}

/**
 * Walk an ASTNode tree and collect all import-decl, export-decl,
 * type-decl, and component-def nodes that live inside logic blocks.
 * These are hoisted into the FileAST top-level fields.
 */
function collectHoisted(nodes) {
  const imports = [];
  const exports = [];
  const typeDecls = [];
  const components = [];
  const machineDecls = [];
  const channelDecls = [];

  function walk(nodeList) {
    for (const node of nodeList) {
      if (!node) continue;
      // P3.A: collect <channel> markup nodes (top-level + inside <program>
      // and other markup ancestors). channelDecls is consumed by CHX (CE
      // phase 2) when looking up cross-file channel exports.
      if (node.kind === "markup" && node.tag === "channel") {
        channelDecls.push(node);
      }
      if (node.kind === "logic") {
        // Use the pre-filtered arrays cached on the logic node — do NOT also
        // walk node.body here, which would push every import-decl twice.
        imports.push(...(node.imports || []));
        exports.push(...(node.exports || []));
        typeDecls.push(...(node.typeDecls || []));
        components.push(...(node.components || []));
      }
      // §51.3: engine-decl nodes are children of markup (program), not logic
      if (node.kind === "engine-decl") {
        machineDecls.push(node);
        // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — recurse into engine bodyChildren
        // to discover NESTED engines in composite state-children. Phase A10
        // attaches `bodyChildren` (walkable AST) to each engine-decl; a
        // nested engine-decl lives as a child of one of the state-child
        // markup entries inside bodyChildren. Without this recursion, nested
        // engines drop out of `machineDecls` (codegen never emits substrate +
        // dispatcher for them).
        if (Array.isArray(node.bodyChildren)) {
          walk(node.bodyChildren);
        }
      }
      if (node.kind === "markup" || node.kind === "state") {
        walk(node.children || []);
      }
      if (node.kind === "meta") {
        walkBodyNodes(node.body || []);
      }
    }
  }

  function walkBodyNodes(bodyNodes) {
    for (const node of bodyNodes) {
      if (!node) continue;
      if (node.kind === "import-decl") imports.push(node);
      if (node.kind === "export-decl") exports.push(node);
      if (node.kind === "type-decl") typeDecls.push(node);
      if (node.kind === "component-def") components.push(node);
      if (node.kind === "function-decl" && node.body) walkBodyNodes(node.body);
    }
  }

  walk(nodes);
  return { imports, exports, typeDecls, components, machineDecls, channelDecls };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a FileAST from Block Splitter output.
 *
 * @param {{ filePath: string, blocks: import('./block-splitter.js').Block[] }} bsOutput
 * @returns {{ filePath: string, ast: FileAST, errors: TABError[] }}
 */
export function buildAST(bsOutput, tokenizerOverrides) {
  const { filePath, blocks } = bsOutput;

  // When self-hosted tokenizer overrides are provided, install them as the
  // module-level tokenizer functions. Restore defaults after this call.
  if (tokenizerOverrides) {
    tokenizeAttributes = tokenizerOverrides.tokenizeAttributes ?? _defaultTokenizeAttributes;
    tokenizeLogic = tokenizerOverrides.tokenizeLogic ?? _defaultTokenizeLogic;
    tokenizeSQL = tokenizerOverrides.tokenizeSQL ?? _defaultTokenizeSQL;
    tokenizeCSS = tokenizerOverrides.tokenizeCSS ?? _defaultTokenizeCSS;
    tokenizeError = tokenizerOverrides.tokenizeError ?? _defaultTokenizeError;
    tokenizePassthrough = tokenizerOverrides.tokenizePassthrough ?? _defaultTokenizePassthrough;
  }

  // Node ID counter — local to this compilation unit to avoid cross-file collisions
  const counter = { next: 0 };

  // Accumulate all TAB errors encountered during this build pass
  const errors = [];

  // Lift bare top-level declarations (type, fn, function, server fn/function)
  // into synthetic logic blocks before building the AST. This allows users to
  // write them without an explicit ${ } wrapper.
  const liftedBlocks = liftBareDeclarations(blocks, errors, filePath);

  // Build each top-level block into an ASTNode
  let nodes = liftedBlocks.map(block => buildBlock(block, filePath, null, counter, errors)).filter(Boolean);

  // §17.1.1: Collapse if=/else-if=/else sibling chains into IfChainExpr nodes
  nodes = collapseIfChains(nodes, errors, filePath);

  // §17 / §34: Post-parse forbidden-keyword sweep — fire E-SWITCH-FORBIDDEN
  // for any `switch-stmt` AST node that did not receive an error at one of
  // the inline TAB fire sites (parseOneStatement L5089, parseLogicBody main
  // loop L8567). The inline fire sites are span-precise and emit during
  // parsing; this post-walker is the structural guarantee that the detector
  // covers every position where a `switch-stmt` can land in the AST,
  // including paths that re-parse function bodies into a throw-away errors
  // array (see L7131: the `export function name() { ... }` synth re-parse).
  // Per SPEC §17 and the §34 catalog row, `switch` is universally forbidden
  // in scrml — there are no exceptions, so a missing error here would be a
  // soundness hole. Dedup is by (code, span.start, span.file) so the inline
  // fire-site error and this walker emission never both appear for the same
  // switch keyword.
  collectForbiddenSwitches(nodes, errors, filePath);

  // Hoist imports, exports, type decls, components, machine decls, channel decls
  // from logic blocks + top-level markup.
  const { imports, exports, typeDecls, components, machineDecls, channelDecls } = collectHoisted(nodes);

  // W-PROGRAM-001: Check for <program> root element
  const hasProgramRoot = nodes.some(
    n => n.kind === "markup" && n.tag === "program"
  );

  // S115 (DD #27 / F6 / Pivot 2) — `authConfig` / `middlewareConfig`
  // extraction from the <program> attributes is NO LONGER done at TAB time.
  // It is performed by the pipeline-agnostic pre-codegen pass
  // `computeProgramConfig` (compiler/src/compute-program-config.ts), invoked
  // at the post-AST PRECG seam in api.js, which mutates the FileAST with the
  // same field names and reproduces the <program>-node annotation side-effect.
  // The E-MW-002 ratelimit-format validation below is an error-emitting CHECK
  // (not extraction) and STAYS here at TAB time.
  const programNode = nodes.find(n => n.kind === "markup" && n.tag === "program");

  // E-MW-002: ratelimit= value must match N/unit where unit is sec, min, or hour.
  if (programNode) {
    const programAttrs2 = programNode.attrs ?? [];
    const ratelimitAttr = programAttrs2.find(attr => attr.name === 'ratelimit');
    let mwRatelimit = null;
    if (ratelimitAttr && ratelimitAttr.value && ratelimitAttr.value.kind === 'string-literal') {
      mwRatelimit = ratelimitAttr.value.value;
    }
    if (mwRatelimit !== null && !/^\d+\/(sec|min|hour)$/.test(mwRatelimit)) {
      const ratelimitSpan = ratelimitAttr?.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      errors.push(new TABError(
        'E-MW-002',
        'E-MW-002: Invalid ratelimit= value "' + mwRatelimit + '". Expected format: N/unit where unit is sec, min, or hour. Example: ratelimit="100/min".',
        ratelimitSpan,
      ));
    }
  }

  // E-MW-005/E-MW-006: handle() validation across top-level logic blocks.
  // E-MW-005: more than one handle() defined at file top level.
  // E-MW-006: handle() defined nested inside another function body.
  //
  // NOTE: ${ } logic blocks inside <program>...</program> are CHILDREN of the
  // program markup node (ast.nodes[0].children), not top-level nodes. We must
  // search programNode.children (and top-level nodes for files without <program>).
  {
    // Build the list of node arrays to search for top-level logic blocks.
    // Includes both top-level nodes and children of the <program> markup node.
    const nodeListsToSearch = [nodes];
    if (programNode && Array.isArray(programNode.children)) {
      nodeListsToSearch.push(programNode.children);
    }

    const topLevelHandles = [];
    for (const nodeList of nodeListsToSearch) {
      for (const node of nodeList) {
        if (node?.kind === 'logic') {
          for (const stmt of (node.body ?? [])) {
            if (stmt?.kind === 'function-decl' && stmt.isHandleEscapeHatch) {
              topLevelHandles.push(stmt);
            }
          }
        }
      }
    }

    // E-MW-005: duplicate handle()
    if (topLevelHandles.length > 1) {
      const firstSpan = topLevelHandles[0].span;
      const firstLine = firstSpan ? firstSpan.line : '?';
      for (let idx = 1; idx < topLevelHandles.length; idx++) {
        errors.push(new TABError(
          'E-MW-005',
          'E-MW-005: Only one handle() function is allowed per file. A second definition was found here; the first is at line ' + firstLine + '.',
          topLevelHandles[idx].span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
        ));
      }
    }

    // E-MW-006: handle() defined nested inside another function body.
    function findNestedHandles(stmts) {
      for (const stmt of (stmts ?? [])) {
        if (!stmt) continue;
        if (stmt.kind === 'function-decl' && stmt.isHandleEscapeHatch) {
          errors.push(new TABError(
            'E-MW-006',
            'E-MW-006: handle() must be defined at file top level inside a ${ } block. Found definition inside a nested function body.',
            stmt.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
        }
        if (stmt.kind === 'function-decl' && !stmt.isHandleEscapeHatch) {
          findNestedHandles(stmt.body ?? []);
        }
        if (stmt.kind === 'if-stmt') {
          findNestedHandles(stmt.consequent ?? []);
          findNestedHandles(stmt.alternate ?? []);
        }
        if (stmt.kind === 'for-stmt' || stmt.kind === 'while-stmt') {
          findNestedHandles(stmt.body ?? []);
        }
      }
    }

    for (const nodeList of nodeListsToSearch) {
      for (const node of nodeList) {
        if (node?.kind === 'logic') {
          for (const stmt of (node.body ?? [])) {
            if (stmt?.kind === 'function-decl' && !stmt.isHandleEscapeHatch) {
              findNestedHandles(stmt.body ?? []);
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // v0.3 Wave 2 — `<page>` per-route attribute validation + W-PROGRAM-REDUNDANT-LOGIC
  //
  // SPEC §4.15, §40.8, §34 catalog rows:
  //   - E-PAGE-ROUTE-ATTR-FORBIDDEN — `<page route="...">` (doubly forbidden;
  //     routes are filesystem-inferred per §47.9.2).
  //   - E-PAGE-INVALID-ATTR — any `<page>` attribute outside {db, auth, csrf,
  //     ratelimit}.
  //   - W-PROGRAM-REDUNDANT-LOGIC — `<program>` (or `<page>`) body wraps top-
  //     level declarations in an unnecessary `${...}` logic block. v0.3 emits
  //     this as a warning; v0.4 will escalate to error per Q5 deprecation.
  //
  // Walker fires post-AST-build over `programNode`/`<page>` direct children.
  // ---------------------------------------------------------------------------
  {
    const PAGE_ALLOWED_ATTRS = new Set(["db", "auth", "csrf", "ratelimit"]);

    // App-wide attributes belong on <program>. Used in diagnostic hinting.
    const APP_WIDE_ATTRS = new Set([
      "title", "description", "version", "author", "license",
      "cors", "cors-max-age", "log", "headers",
      "idempotency-store", "idempotency-ttl",
      "channel-reconnect", "batch-in-list-cap",
      "loginRedirect", "sessionExpiry",
    ]);

    // Nested-program attributes (worker / sidecar — §43). Used in hinting.
    const NESTED_PROGRAM_ATTRS = new Set([
      "name", "lang", "mode", "build", "port", "health", "protect",
      "callchar", "restart", "max-restarts", "within", "autostart",
    ]);

    // A LogicStatement kind is "declaration-style" when it's a pure
    // declaration: state-decl, function-decl, type-decl, let-decl, const-decl,
    // import/export, use, component-def. These shapes are exactly what v0.3
    // default-logic body mode auto-lifts; if a `${...}` block's body contains
    // ONLY these, the wrapping is redundant. Anything else (bare-expr,
    // if-stmt, for-stmt, return, etc.) signals real work and suppresses the
    // warning per brief §4.3.3.
    const DECL_KINDS = new Set([
      "state-decl",
      "reactive-decl",
      "let-decl",
      "const-decl",
      "function-decl",
      "type-decl",
      "import-decl",
      "export-decl",
      "use-decl",
      "component-def",
      "tilde-decl",
      "lin-decl",
    ]);

    function isAllDeclarationBody(stmts) {
      if (!Array.isArray(stmts) || stmts.length === 0) return false;
      for (const s of stmts) {
        if (!s || !DECL_KINDS.has(s.kind)) return false;
      }
      return true;
    }

    // --- E-PAGE-ROUTE-ATTR-FORBIDDEN + E-PAGE-INVALID-ATTR ---
    // Walk every markup node whose tag === "page" anywhere in the tree (the
    // node may live as a direct child of <program> OR at file top level when
    // the file is a route-file — both are valid block-grammar positions per
    // §4.15). The validation fires per-attribute; multi-violation files
    // emit multiple errors.
    function validatePageAttrs(node) {
      if (!node || typeof node !== "object") return;
      if (node.kind === "markup" && node.tag === "page" && Array.isArray(node.attrs)) {
        for (const attr of node.attrs) {
          const name = attr && attr.name;
          if (!name) continue;
          // E-PAGE-ROUTE-ATTR-FORBIDDEN takes precedence for `route=` (it's a
          // distinct, more-pointed diagnostic per SPEC §34).
          if (name === "route") {
            errors.push(new TABError(
              "E-PAGE-ROUTE-ATTR-FORBIDDEN",
              `E-PAGE-ROUTE-ATTR-FORBIDDEN: \`<page>\` does not accept a \`route=\` attribute; ` +
              `the route URL is inferred from the source filepath (\`path/to/file.scrml\` → \`/path/to/file\`). ` +
              `To rename the route, rename the file. See SPEC §40.8 and §47.9.2.`,
              attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ));
            continue;
          }
          if (!PAGE_ALLOWED_ATTRS.has(name)) {
            let hint;
            if (APP_WIDE_ATTRS.has(name)) {
              hint = `\`${name}=\` is an application-wide concern — move it to the \`<program>\` opener (the app-host scope).`;
            } else if (NESTED_PROGRAM_ATTRS.has(name)) {
              hint = `\`${name}=\` is a nested-program attribute (worker / sidecar — see SPEC §43); it has no meaning on \`<page>\`.`;
            } else {
              hint = `The allowed \`<page>\` attribute set is exactly \`{ db, auth, csrf, ratelimit }\` (per-route concerns). ` +
                `App-wide concerns belong on \`<program>\`; per-element metadata belongs on markup elements inside the page body.`;
            }
            errors.push(new TABError(
              "E-PAGE-INVALID-ATTR",
              `E-PAGE-INVALID-ATTR: \`<page ${name}=…>\` — ${name} is not in the per-route attribute set. ${hint} See SPEC §4.15 and §40.8.`,
              attr.span ?? node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
            ));
          }
        }
      }
      // Recurse into children (page may live inside program; logic blocks
      // don't carry markup-page descendants worth walking, but markup/state
      // children may).
      const kids = node.children ?? null;
      if (Array.isArray(kids)) {
        for (const kid of kids) validatePageAttrs(kid);
      }
    }

    for (const topNode of nodes) {
      validatePageAttrs(topNode);
    }

    // --- W-PROGRAM-REDUNDANT-LOGIC ---
    // Walk direct children of <program> AND every <page> (whether at file top
    // or nested inside <program>). Author-written `${...}` blocks whose body
    // contains ONLY declaration-style statements fire the warning. Synthetic
    // lift-wrappers (carrying `_synthetic: true` forwarded from
    // liftBareDeclarations) are skipped.
    function emitRedundantLogicWarnings(containerNode, containerTagLabel) {
      if (!containerNode || !Array.isArray(containerNode.children)) return;
      for (const child of containerNode.children) {
        if (
          child &&
          child.kind === "logic" &&
          !child._synthetic &&
          isAllDeclarationBody(child.body)
        ) {
          errors.push(new TABError(
            "W-PROGRAM-REDUNDANT-LOGIC",
            `W-PROGRAM-REDUNDANT-LOGIC: A \`<${containerTagLabel}>\` body wraps top-level declarations in a redundant \`\${...}\` logic block. ` +
            `Under v0.3, \`<${containerTagLabel}>\` body parses in default-logic mode — bare top-level declarations auto-lift to the logic context without explicit \`\${...}\` wrapping. ` +
            `Remove the redundant \`\${...}\` for cleaner source. See SPEC §40.8.`,
            child.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 },
          ));
          errors[errors.length - 1].severity = "warning";
        }
      }
    }

    // Walk every <program> and <page> markup node in the AST. Both are
    // valid containers for the v0.3 default-logic body.
    function visitForRedundantLogic(node) {
      if (!node || typeof node !== "object") return;
      if (node.kind === "markup" && (node.tag === "program" || node.tag === "page")) {
        emitRedundantLogicWarnings(node, node.tag);
      }
      const kids = node.children ?? null;
      if (Array.isArray(kids)) {
        for (const kid of kids) visitForRedundantLogic(kid);
      }
    }

    for (const topNode of nodes) {
      visitForRedundantLogic(topNode);
    }
  }

  // ---------------------------------------------------------------------------
  // v0.3 §40.8.1 — W-PROGRAM-SPA-INFERRED (info-level lint)
  //
  // SPEC §40.8.1 RESOLVED (Option C, ratified S86 2026-05-12) + §34 row.
  //
  // Fires when ALL three normative conditions hold:
  //   1. The entry file declares a top-level `<program>` element.
  //      (Per v0.3 "one-program-per-application" §40, ANY file with a
  //      top-level <program> IS the entry file — so this maps to the
  //      existing `programNode` resolution at the top of buildAST.)
  //   2. The `<program>` body contains zero `<page>` siblings.
  //   3. No `pages/` directory exists at the project root.
  //      (Project root = `path.dirname(filePath)` per §41.2.3 "the project
  //      root is the directory containing the <program> file".)
  //
  // Suppression: presence of a `pages/` directory at the project root —
  // even EMPTY — suppresses the lint. This is the adopter's deterministic
  // opt-out per §40.8.1 "Lint suppression mechanism".
  //
  // Emission site: the entry-file <program> opener span.
  // ---------------------------------------------------------------------------
  {
    // Condition (1): top-level <program> present.
    const entryProgramNode = nodes.find(
      n => n && n.kind === "markup" && n.tag === "program"
    );

    if (entryProgramNode) {
      // Condition (2): zero <page> siblings in the <program> body.
      // <page> siblings live in entryProgramNode.children as markup nodes.
      const programChildren = Array.isArray(entryProgramNode.children)
        ? entryProgramNode.children
        : [];
      const hasPageSibling = programChildren.some(
        c => c && c.kind === "markup" && c.tag === "page"
      );

      // Guard: the lint requires filesystem context. In production
      // (`compileScrml`/CLI) filePath is resolved to an absolute path
      // before BS/TAB run AND points at a real file on disk. In
      // synthetic test contexts the filePath is often a stub
      // (`"test.scrml"`, `"/test/app.scrml"`, etc.) that does NOT exist
      // on disk — so there is no meaningful "project root" to check
      // for `pages/`. Skip the lint when filePath is not absolute OR
      // the file does not exist. Tests that want to exercise the lint
      // construct an absolute path under a tmpdir with a real file.
      let filePathIsRealFile = false;
      if (typeof filePath === "string" && _pathIsAbsolute(filePath)) {
        try {
          filePathIsRealFile = existsSync(filePath);
        } catch {
          filePathIsRealFile = false;
        }
      }

      if (!hasPageSibling && filePathIsRealFile) {
        // Condition (3): no `pages/` directory at the project root.
        // Project root = dirname of the file containing <program>.
        // Suppression: if `pages/` EXISTS as a directory (even empty),
        // do not emit.
        let pagesDirPresent = false;
        try {
          const projectRoot = _pathDirname(filePath);
          const pagesPath = _pathJoin(projectRoot, "pages");
          if (existsSync(pagesPath)) {
            // Confirm it is a directory (a stray `pages` FILE does not
            // suppress the lint — the SPEC mechanism is specifically a
            // directory).
            pagesDirPresent = statSync(pagesPath).isDirectory();
          }
        } catch {
          // fs lookup failed (permissions, broken symlink, etc.) —
          // treat as "no pages/ dir" (i.e. lint may fire). This is
          // conservative: the adopter sees the inference signal rather
          // than having it silently suppressed by a transient fs error.
          pagesDirPresent = false;
        }

        if (!pagesDirPresent) {
          const span =
            entryProgramNode.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
          errors.push(new TABError(
            "W-PROGRAM-SPA-INFERRED",
            `W-PROGRAM-SPA-INFERRED: The compiler has inferred SPA (single-page application) shape from the filesystem: ` +
            `the entry file declares a top-level \`<program>\` element, the \`<program>\` body contains zero \`<page>\` siblings, ` +
            `and no \`pages/\` directory exists at the project root. ` +
            `If SPA is your intent, this lint is informational only — no action required. ` +
            `If you intended a multi-page app, add \`<page>\` declarations to the entry-file \`<program>\` body or create a \`pages/\` directory at the project root. ` +
            `To suppress this lint, create an empty \`pages/\` directory at the project root (signals adopter awareness of the multi-page option). ` +
            `Per SPEC §40.8.1 the SPA-vs-multi-page-app shape is filesystem-inferred exclusively; no \`<program spa>\` boolean attribute exists.`,
            span,
          ));
          errors[errors.length - 1].severity = "info";
        }
      }
    }
  }

  // S115 (DD #27 / F5 + F6 / Pivot 2) — the 4 PGO has* flags
  // (hasResetExpr / hasEqualityExpr / hasChunkedMarkupTag / hasForStmt) and
  // the `authConfig` / `middlewareConfig` program-config objects are NO LONGER
  // computed at TAB time. They are derived by the pipeline-agnostic
  // pre-codegen passes `computePGOFlags` / `computeProgramConfig`
  // (compiler/src/compute-pgo-flags.ts, compute-program-config.ts), invoked at
  // the post-AST PRECG seam in api.js, which mutate the FileAST with the same
  // field names. Relocated so the M5 native parser does not have to learn
  // codegen-optimizer caches or program-config extraction. `hasProgramRoot`
  // STAYS here — it drives the isPureModuleFile / isNonEntryPageFile logic
  // below and has no codegen-cache role.
  const ast = {
    filePath,
    nodes,
    imports,
    exports,
    components,
    typeDecls,
    machineDecls,
    channelDecls,
    hasProgramRoot,
  };

  // Bug-batch S93 (Bug 6B — non-entry pure-module file):
  // Per S85 Q2 + SPEC §21.5, a "pure-module file" is a file with NO
  // top-level markup at all — content is exclusively imports/exports/type
  // /function/const/let declarations. Such files are valid non-entry
  // modules (the canonical scrml multi-file shape), and W-PROGRAM-001's
  // "wrap your content in <program>" hint is misleading for them.
  //
  // Detection: a file is pure-module when the top-level `nodes` contain
  // ZERO markup nodes (after liftBareDeclarations has wrapped bare decls
  // into synthetic logic blocks). Logic-decl/type-decl/component-def/
  // import-decl/export-decl/channel-decl nodes are all module-shape;
  // markup nodes (other than embedded inside logic blocks) signal "this
  // file is a page, not a module".
  //
  // When pure-module shape is detected, suppress W-PROGRAM-001 silently
  // — the file is a recognized canonical shape and needs no warning.
  const isPureModuleFile =
    !hasProgramRoot &&
    nodes.length > 0 &&
    nodes.every(n => n && n.kind !== "markup");

  // S98 (combined-lint-additions-s98 — Item 1): non-entry `<page>` file
  // suppression. Per SPEC §40.8: a multi-page app declares its top-level
  // `<program>` exactly ONCE, in the entry file. Non-entry page files
  // declare a `<page>` element at file scope WITHOUT a wrapping `<program>`
  // — the route's `<page>` sits inside the app's `<program>` declared in
  // `app.scrml`, NOT inside the page file. The W-PROGRAM-001 lint fired
  // here was a false positive for every `<page>` file in a multi-page app
  // (17 fires across docs/website/, 20 fires across the trucking-dispatch
  // page subset, all spurious).
  //
  // Detection: file has at least one top-level markup node with `tag ===
  // "page"`. The file-local check is sufficient and consistent with the
  // SPEC norm — what the file DECLARES (a `<page>` opener) is the signal,
  // not what sibling files exist. No cross-file plumbing required.
  const isNonEntryPageFile =
    !hasProgramRoot &&
    nodes.some(n => n && n.kind === "markup" && n.tag === "page");

  if (!hasProgramRoot && !isPureModuleFile && !isNonEntryPageFile) {
    errors.push(new TABError(
      "W-PROGRAM-001",
      `W-PROGRAM-001: No <program> root element found. Consider wrapping your file ` +
      `content in <program> ... </program> for explicit configuration of database ` +
      `connections, protection, and HTML spec version.`,
      { start: 0, end: 0, line: 1, col: 1 },
    ));
    // Mark as warning severity for downstream filtering
    errors[errors.length - 1].severity = "warning";
  }

  // Restore default tokenizer functions if overrides were installed
  if (tokenizerOverrides) {
    tokenizeAttributes = _defaultTokenizeAttributes;
    tokenizeLogic = _defaultTokenizeLogic;
    tokenizeSQL = _defaultTokenizeSQL;
    tokenizeCSS = _defaultTokenizeCSS;
    tokenizeError = _defaultTokenizeError;
    tokenizePassthrough = _defaultTokenizePassthrough;
  }

  return { filePath, ast, errors };
}

/**
 * Pipeline-contract wrapper. Accepts the BS output shape.
 *
 * @param {{ filePath: string, blocks: Block[] }} input
 * @returns {{ filePath: string, ast: FileAST, errors: TABError[] }}
 */
export function runTAB(input) {
  return buildAST(input);
}

export { TABError as default };
