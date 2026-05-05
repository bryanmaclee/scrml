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
 *   spans:      SpanTable,       // nodeId → Span
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

import { parseExprToNode } from "./expression-parser.ts";
import { splitBlocks as _splitBlocksForP2Form1 } from "./block-splitter.js";

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
  // Leading dot: `.method()` chain continuations (not a standalone expression)
  if (/^\s*\./.test(t)) return true;
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
 * Module-level safe expression parser — wraps parseExprToNode in try/catch.
 * Returns undefined on failure. Used by parseAttributes (module-level scope)
 * and other module-level helpers that need ExprNode but lack access to the
 * closure-scoped safeParseExprToNode inside parseLogicBody.
 */
function safeParseExprToNodeGlobal(expr, filePath, startOffset, errors) {
  if (!expr || typeof expr !== "string" || !expr.trim()) return undefined;
  if (shouldSkipExprParse(expr)) {
    return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, estreeType: "SkippedExpr", raw: expr };
  }
  try {
    const node = parseExprToNode(expr, filePath, startOffset ?? 0);
    // F-SQL-001: surface E-SQL-008 from unbalanced ?{} as a TABError when
    // an errors array is in scope. Falls back to escape-hatch otherwise.
    if (node && node.kind === "escape-hatch" && node.estreeType === "SqlPlaceholderError" && node.sqlDiagnostic) {
      if (errors) {
        errors.push(new TABError(
          node.sqlDiagnostic.code || "E-SQL-008",
          node.sqlDiagnostic.message,
          node.span,
        ));
      }
    }
    return node;
  } catch (_e) {
    return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, estreeType: "ParseError", raw: expr };
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
 * Matches (at the start of the raw content, which may have leading whitespace):
 *   server fn <name>  |  server function <name>  |  fn <name>
 *   function <name>   |  type <name>
 */
const BARE_DECL_RE = /^\s*(server\s+(?:fn|function)\s|type\s+\w|fn\s+\w|function\s+\w)/;

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
function liftBareDeclarations(blocks, errors, filePath, parentType = null, _p3aSynthCounter = { next: 0 }) {
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Recurse into state children — server fns inside <db>/state contexts
    // are real declarations and need the same lift treatment. Pass
    // parentType="state" so a state block nested inside markup still lifts.
    if (block.type === "state") {
      const newChildren = liftBareDeclarations(block.children || [], errors, filePath, "state", _p3aSynthCounter);
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
    // (Fix for Scope C finding A5 — see docs/changes/fix-bare-decl-markup-text-lift/.)
    if (block.type === "markup") {
      // Top-level <program> remains a declaration site for its direct text
      // children. Any other markup tag is prose context — its text children
      // must be passed through unchanged.
      const isProgramRoot = parentType !== "markup" && block.name === "program";
      const childContext = isProgramRoot ? "state" : "markup";
      const newChildren = liftBareDeclarations(block.children || [], errors, filePath, childContext, _p3aSynthCounter);
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
 * Returns true if `tok` is a match arm arrow token.
 * Accepts both the canonical `=>` and the alias `:>` (§18, §19).
 */
function isMatchArrow(tok) {
  return tok != null && tok.kind === "OPERATOR" && (tok.text === "=>" || tok.text === ":>");
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
 * Walk an AST node tree and tag all function-decl nodes with a stateTypeScope.
 * Used to mark functions inside state constructors for state-type dispatch overloading.
 *
 * @param {object[]} nodes  — ASTNode[] (children of a state-constructor-def)
 * @param {string} stateTypeName  — the state type name (e.g., "card", "badge")
 */
function tagFunctionsWithStateType(nodes, stateTypeName) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "function-decl") {
      node.stateTypeScope = stateTypeName;
    }
    // Recurse into logic blocks to find functions declared inside ${} inside the constructor
    if (node.kind === "logic" && Array.isArray(node.body)) {
      for (const stmt of node.body) {
        if (stmt && (stmt.kind === "function-decl")) {
          stmt.stateTypeScope = stateTypeName;
        }
      }
    }
    // Recurse into children
    if (Array.isArray(node.children)) {
      tagFunctionsWithStateType(node.children, stateTypeName);
    }
  }
}

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
      return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, estreeType: "SkippedExpr", raw: expr };
    }
    try {
      // Automatically thread tilde context from the closure-scoped flag
      const node = parseExprToNode(expr, filePath, startOffset ?? 0, _tildeActive ? { tildeActive: true } : undefined);
      // F-SQL-001: surface E-SQL-008 from unbalanced ?{} as a TABError.
      if (node && node.kind === "escape-hatch" && node.estreeType === "SqlPlaceholderError" && node.sqlDiagnostic) {
        errors.push(new TABError(
          node.sqlDiagnostic.code || "E-SQL-008",
          node.sqlDiagnostic.message,
          node.span,
        ));
      }
      return node;
    } catch (_e) {
      // Phase 4d: produce escape-hatch on parse failure instead of undefined
      return { kind: "escape-hatch", span: { file: filePath, start: startOffset ?? 0, end: (startOffset ?? 0) + expr.length, line: 1, col: 1 }, estreeType: "ParseError", raw: expr };
    }
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

  function collectExpr(stopAt = null) {
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
            // Helper: check if a token is an arm arrow (=>, :>, or legacy ->).
            // The tokenizer produces `=>` and `:>` as OPERATOR kind,
            // and `->` as two separate PUNCT tokens — but accept either kind
            // so the boundary detection is robust.
            const isArmArrow = (t) => t && (t.kind === "OPERATOR" || t.kind === "PUNCT") && (t.text === "=>" || t.text === ":>" || t.text === "->");
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
              return isArmArrow(peek(i));
            }
            // `else =>` — wildcard arm
            if (tok.kind === "KEYWORD" && tok.text === "else") {
              return isArmArrow(peek(1));
            }
            // `_ =>` — wildcard alias
            if (tok.kind === "IDENT" && tok.text === "_") {
              return isArmArrow(peek(1));
            }
            // `not …=>` — is-not arm (§42). Scan forward up to 6 tokens
            // for `=>` before hitting a block opener.
            if (tok.kind === "KEYWORD" && tok.text === "not") {
              for (let i = 1; i < 6; i++) {
                const tk = peek(i);
                if (!tk || tk.kind === "EOF") return false;
                if (isArmArrow(tk)) return true;
                if (tk.kind === "PUNCT" && tk.text === "{") return false;
              }
              return false;
            }
            // `"string" =>` or `'string' =>` — string literal arm
            if (tok.kind === "STRING") {
              return isArmArrow(peek(1));
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
          const VALUE_KEYWORDS = new Set(["true", "false", "null", "undefined", "this"]);
          const lastEndsValue = (
            lastKind === "IDENT" ||
            lastKind === "NUMBER" ||
            lastKind === "STRING" ||
            lastKind === "AT_IDENT" ||
            (lastKind === "KEYWORD" && VALUE_KEYWORDS.has(lastText)) ||
            (lastKind === "PUNCT" && (lastText === ")" || lastText === "]" || lastText === "}"))
          );
          // tok starts a new statement if it's an IDENT (function call) or unhandled KEYWORD
          const tokStartsStmt = (
            tok.kind === "IDENT" ||
            (tok.kind === "KEYWORD" && !STMT_KEYWORDS.has(tok.text))
          );
          if (lastEndsValue && tokStartsStmt) break;
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
      return {
        kind: "expr",
        raw: inner,
        refs: [],
        exprNode: safeParseExprToNode(inner, tokenSpan(refTok, filePath)?.start ?? 0),
        span: tokenSpan(refTok, filePath),
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
        parts.push(ct.text);
        consume();
      }
      const raw = parts.join("");
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
    return null;
  }

  /**
   * §53 Inline Type Predicates — type annotation collector (parseLogicBody closure).
   * Called after consuming `@name` when peek() is `:`.
   * Consumes `:` and collects the type expression (including balanced parens and
   * optional [label] suffix) up to `=` or `,` at paren depth 0.
   * Returns the annotation string (e.g. "number(>0 && <10000)[valid_x]") or null.
   */
  function collectTypeAnnotation() {
    if (peek().text !== ':') return null;
    consume(); // consume ':'
    const parts = [];
    let depth = 0;
    while (peek().kind !== 'EOF') {
      const t = peek();
      if (t.text === '(') {
        depth++;
        parts.push(t.text);
        consume();
      } else if (t.text === ')') {
        if (depth === 0) break; // unmatched ')' — stop
        depth--;
        parts.push(t.text);
        consume();
        // Check for label suffix [ident] immediately after closing paren at depth 0
        if (depth === 0 && peek().text === '[') {
          parts.push(peek().text); consume(); // consume '['
          while (peek().kind !== 'EOF' && peek().text !== ']') {
            parts.push(peek().text); consume();
          }
          if (peek().text === ']') { parts.push(peek().text); consume(); } // consume ']'
        }
      } else if (t.text === '=' && depth === 0) {
        // Stop at assignment (but not ==)
        const next = peek(1);
        if (next && next.text === '=') {
          // == operator — include it
          parts.push(t.text); consume();
        } else {
          break;
        }
      } else if (t.text === ',' && depth === 0) {
        break; // stop at comma (param lists)
      } else {
        parts.push(t.text);
        consume();
      }
    }
    const annotation = parts.join('').trim();
    return annotation || null;
  }

  // Phase 4: tilde context tracking. Set to true after a value-lift (lift-expr with
  // expr.kind === "expr"). When active, safeParseExprToNode passes tildeActive to the
  // expression parser so standalone `~` is parsed as the tilde accumulator, not bitwise NOT.
  // Cleared after the next statement that contains `~` is parsed.
  let _tildeActive = false;

  /**
   * Parse a braced body `{ ... }` into a structured LogicNode[] tree.
   * Caller should have already consumed the opening `{`.
   * Consumes up to and including the closing `}`.
   */
  function parseRecursiveBody() {
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
        // Phase 4: track tilde context — value-lift activates, ~ consumption deactivates
        if (node.kind === "lift-expr" && node.expr && node.expr.kind === "expr") {
          _tildeActive = true;
        } else if (_tildeActive) {
          // Any non-lift statement after a value-lift may consume ~; deactivate after one statement
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
  function tryParseStructuralDecl(startTok, isConst) {
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

    // Pattern matched. Consume tokens through the `=` (or fused `>=`).
    while (i < scan.consumeUntil) consume();

    const name = nameTok.text;

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
        return {
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: "",
          initExpr: null,
          renderSpec,
          validators: scan.validators,
          structuralForm: true,
          isConst: !!isConst,
          shape: "decl-with-spec",
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

    // Collect the RHS expression (stops at `;`, unbalanced `}`, STMT_KEYWORDS,
    // BLOCK_REF, or EOF — same boundary rules as the legacy `@NAME = init` path).
    const { expr } = collectExpr();

    // Phase A1a Step 4 — `shape` discriminant per AST-CONTRACTS-AND-DECOMPOSITION
    // §1.1. Step 5 adds `validators` field when present (Shape 1/3 with validators
    // is technically out of brief scope but defensively preserved).
    const node = {
      id: ++counter.next,
      kind: "state-decl",
      name,
      init: expr,
      initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
      structuralForm: true,
      isConst: !!isConst,
      shape: isConst ? "derived" : "plain",
      span: spanOf(startTok, peek()),
    };
    if (scan.validators.length > 0) {
      node.validators = scan.validators;
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

    // Edge: bare `<NAME>` form (no validators) — peek(2) is `>` or `>=`.
    // Handled below by the closer check after the validator loop.

    while (true) {
      const t = tokens[i + scanIdx];
      if (!t || t.kind === "EOF") return null;

      // Closer: PUNCT `>`. Must be followed by PUNCT `=` for state-decl.
      if (t.kind === "PUNCT" && t.text === ">") {
        const eqTok = tokens[i + scanIdx + 1];
        if (!eqTok || eqTok.kind !== "PUNCT" || eqTok.text !== "=") return null;
        // Tighten: reject `>==` (would mean compound `==`) — eqTok.text === "="
        // standalone PUNCT is the canonical assignment-equals shape.
        return {
          consumeUntil: i + scanIdx + 2, // past `>` and `=`
          validators,
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
          fusedGtEq: true,
        };
      }

      // Validator: IDENT bareword or call-form.
      if (t.kind === "IDENT") {
        const validatorName = t.text;
        const validatorStart = t.span;
        // Check for call-form: IDENT `(`
        const next = tokens[i + scanIdx + 1];
        if (next && next.kind === "PUNCT" && next.text === "(") {
          // Call-form: collect args by walking paren-matched tokens.
          let parenDepth = 1;
          let argIdx = scanIdx + 2;
          let argTexts = []; // raw token texts joined back into arg string
          let lastTok = next;
          while (true) {
            const at = tokens[i + argIdx];
            if (!at || at.kind === "EOF") return null; // unbalanced — decline
            if (at.kind === "PUNCT" && at.text === "(") parenDepth++;
            if (at.kind === "PUNCT" && at.text === ")") {
              parenDepth--;
              if (parenDepth === 0) {
                lastTok = at;
                argIdx++;
                break;
              }
            }
            argTexts.push(at.text);
            lastTok = at;
            argIdx++;
          }
          // Args are stored as a single raw string (joined by space). A1b will
          // sub-grammar-parse this into ExprNode[]. Per Step 5 design choice:
          // relational-form args (`>=2`, `<100`) and cross-field args (`@cell`)
          // are out of scope for parser-level ExprNode-ification.
          const argRaw = argTexts.join(" ").trim();
          validators.push({
            name: validatorName,
            args: argRaw.length > 0 ? [argRaw] : [],
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
      if (peek().kind === "IDENT") name = consume().text;
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
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "let-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
      }
    }

    // CONST — may be `const @name = expr` (reactive-derived-decl) or `const name = expr`
    // or `const <name> = expr` (Shape 3 derived state-decl, A1a Step 2).
    if (tok.kind === "KEYWORD" && tok.text === "const") {
      const startTok = consume();
      // Check for `const @name = expr` or `const @name: T = expr` — derived reactive value.
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
          return { id: ++counter.next, kind: "reactive-derived-decl", name: derivedName, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
        } else {
          return { id: ++counter.next, kind: "reactive-derived-decl", name: derivedName, init: "", ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
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
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") name = consume().text;
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
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "const-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), ...(typeAnnotation ? { typeAnnotation } : {}), span: spanOf(startTok, peek()) };
      } else {
        return { id: ++counter.next, kind: "const-decl", name, init: "", ...(typeAnnotation ? { typeAnnotation } : {}), span: tokenSpan(startTok, filePath) };
      }
    }

    // @debounced(N) MODIFIER: `@debounced(N) name = expr`
    if (tok.kind === "AT_IDENT" && tok.text === "@debounced") {
      const startTok = consume();
      let delay = 300;
      if (peek().text === "(") {
        consume();
        const delayParts = [];
        while (peek().text !== ")" && peek().kind !== "EOF") {
          delayParts.push(consume().text);
        }
        if (peek().text === ")") consume();
        delay = parseInt(delayParts.join("").trim(), 10) || 300;
      }
      let name = "";
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") name = consume().text;
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume();
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "reactive-debounced-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), delay, span: spanOf(startTok, peek()) };
      }
      const { expr, span } = collectExpr();
      const _be1 = startTok.text + " " + name + (expr ? " " + expr : "");
      return { id: ++counter.next, kind: "bare-expr", expr: _be1, exprNode: safeParseExprToNode(_be1, 0), span: spanOf(startTok, peek()) };
    }

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

      // Check for dotted path: @obj.path.to.prop = value  OR  @arr.push(...)
      if (peek().text === ".") {
        // Collect the dot-separated path segments
        const pathSegments = [];
        let peekIdx = 0;
        let tempTokens = [];

        // Lookahead to collect .ident chains
        while (peek().text === ".") {
          const dotTok = consume();
          tempTokens.push(dotTok);
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            const segTok = consume();
            tempTokens.push(segTok);
            pathSegments.push(segTok.text);
          } else {
            break;
          }
        }

        // Check for array mutation patterns: @arr.push(...), @arr.splice(...)
        const ARRAY_MUTATIONS = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
        const lastSeg = pathSegments[pathSegments.length - 1];
        if (pathSegments.length === 1 && ARRAY_MUTATIONS.includes(lastSeg) && peek().text === "(") {
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

        // Check for nested assignment: @obj.path = value
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

        // Not a nested assignment or array mutation — reconstruct as bare-expr
        const pathStr = "." + pathSegments.join(".");
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

      // Simple reactive decl: @name = expr
      // Phase A1a Step 4 — `shape: "plain"`, `structuralForm: false`, `isConst: false` for legacy @-form.
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume();
        // fix-cg-cps-return-sql-ref-placeholder: detect `@x = ?{...}.method()`.
        // The bare `?{}` (no chained call) and `?{...}.all()/.get()/.run()` shapes
        // both flow through here. Without this, safeParseExprToNode preprocesses
        // the BLOCK_REF to `__scrml_sql_placeholder__` and emit-expr renders
        // `/* sql-ref:-1 */` — broken in both server CPS and client init contexts.
        const _sqlInit = tryConsumeSqlInit();
        if (_sqlInit) {
          return { id: ++counter.next, kind: "state-decl", name, init: "", sqlNode: _sqlInit, shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
        }
        const { expr, span } = collectExpr();
        return { id: ++counter.next, kind: "state-decl", name, init: expr, initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0), shape: "plain", structuralForm: false, isConst: false, span: spanOf(startTok, peek()) };
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
        const markupNode = parseLiftTag();
        if (markupNode) {
          return { id: ++counter.next, kind: "lift-expr", expr: { kind: "markup", node: markupNode }, span: spanOf(startTok, peek()) };
        }
        // parseLiftTag returned null — fall through to string path
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
          // variable name
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            variable = consume().text;
          }
          // Accept `of` (scrml canonical); reject `in` (JS-reflex).
          if (peek().kind === "KEYWORD" && peek().text === "in") {
            const inTok = peek();
            errors.push(new TABError(
              "E-CTRL-011",
              "E-CTRL-011: `for (... in ...)` is not supported — scrml uses `for (" + (variable || "item") + " of <iterable>)`. " +
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
      if (nextBreak.kind === "IDENT" && nextBreak.line === startTok.line) {
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
      if (nextCont.kind === "IDENT" && nextCont.line === startTok.line) {
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
      const { expr, span } = collectExpr();
      return {
        id: ++counter.next,
        kind: "return-stmt",
        expr: expr.trim(),
        exprNode: safeParseExprToNode(expr.trim(), 0),
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
      // consume '=>' (tokenized as a single OPERATOR token by tokenizeLogic)
      if (isMatchArrow(peek())) {
        consume(); // consume '=>'
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
    if (tok.kind === "KEYWORD" && tok.text === "function") {
      const startTok = consume(); // consume `function`
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
      // Handles: `: Mario`, `-> string`, `: Array<Thing>`, etc.
      let hasReturnType = false;
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
        }
      } else if (peek().text === "-" && peek(1)?.text === ">") {
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        // Skip the type name(s) until `{`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
        }
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
        isGenerator,
        canFail,
        ...(hasReturnType ? { hasReturnType: true } : {}),
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
    // Form 1: `. VariantName => {` — enum variant arm with block body
    if (tok.kind === 'PUNCT' && tok.text === '.' &&
        peek(1) && peek(1).kind === 'IDENT' && /^[A-Z]/.test(peek(1).text) &&
        peek(2) && isMatchArrow(peek(2)) &&
        peek(3) && peek(3).kind === 'PUNCT' && peek(3).text === '{') {
      const startTok = tok;
      consume(); // '.'
      const variantNameTok = consume(); // IDENT (PascalCase variant name)
      consume(); // '=>'
      consume(); // '{'
      const blockBody = parseRecursiveBody(); // parse until matching '}'
      return {
        id: ++counter.next,
        kind: 'match-arm-block',
        variant: variantNameTok.text,
        isWildcard: false,
        body: blockBody,
        span: spanOf(startTok, peek()),
      };
    }

    // Form 2: `else => {` — wildcard arm with block body
    if (tok.kind === 'KEYWORD' && tok.text === 'else' &&
        peek(1) && isMatchArrow(peek(1)) &&
        peek(2) && peek(2).kind === 'PUNCT' && peek(2).text === '{') {
      const startTok = tok;
      consume(); // 'else'
      consume(); // '=>'
      consume(); // '{'
      const blockBody = parseRecursiveBody();
      return {
        id: ++counter.next,
        kind: 'match-arm-block',
        variant: null,
        isWildcard: true,
        body: blockBody,
        span: spanOf(startTok, peek()),
      };
    }

    // Form 3: `not => {` — absence arm with block body (§42)
    if (tok.kind === 'KEYWORD' && tok.text === 'not' &&
        peek(1) && isMatchArrow(peek(1)) &&
        peek(2) && peek(2).kind === 'PUNCT' && peek(2).text === '{') {
      const startTok = tok;
      consume(); // 'not'
      consume(); // '=>'
      consume(); // '{'
      const blockBody = parseRecursiveBody();
      return {
        id: ++counter.next,
        kind: 'match-arm-block',
        variant: '__not__',
        isWildcard: false,
        isNotArm: true,
        body: blockBody,
        span: spanOf(startTok, peek()),
      };
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
        const arrowTok = peek(arrowIdx);
        if (arrowTok && isMatchArrow(arrowTok)) {
          const afterArrow = peek(arrowIdx + 1);
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
            consume(); // consume arrow
            const { expr: result } = collectExpr();
            const trimmedResult = result.trim();
            return {
              id: ++counter.next,
              kind: 'match-arm-inline',
              test: testStr,
              binding: bindingText ?? undefined,
              result: trimmedResult,
              resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
              span: spanOf(startTok, peek()),
            };
          }
        }
      }
    }

    // Inline Form 2: `else => result` — wildcard arm without block body
    if (tok.kind === 'KEYWORD' && tok.text === 'else' &&
        peek(1) && isMatchArrow(peek(1))) {
      const afterArrow = peek(2);
      if (!afterArrow || afterArrow.text !== '{') {
        const startTok = consume(); // consume 'else'
        consume(); // consume arrow
        const { expr: result } = collectExpr();
        const trimmedResult = result.trim();
        return {
          id: ++counter.next,
          kind: 'match-arm-inline',
          test: 'else',
          result: trimmedResult,
          resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Inline Form 3: `not => result` — absence arm without block body
    if (tok.kind === 'KEYWORD' && tok.text === 'not' &&
        peek(1) && isMatchArrow(peek(1))) {
      const afterArrow = peek(2);
      if (!afterArrow || afterArrow.text !== '{') {
        const startTok = consume(); // consume 'not'
        consume(); // consume arrow
        const { expr: result } = collectExpr();
        const trimmedResult = result.trim();
        return {
          id: ++counter.next,
          kind: 'match-arm-inline',
          test: 'not',
          result: trimmedResult,
          resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Inline Form 4: `_ => result` — wildcard alias (legacy)
    if (tok.kind === 'IDENT' && tok.text === '_' &&
        peek(1) && isMatchArrow(peek(1))) {
      const afterArrow = peek(2);
      if (!afterArrow || afterArrow.text !== '{') {
        const startTok = consume(); // consume '_'
        consume(); // consume arrow
        const { expr: result } = collectExpr();
        const trimmedResult = result.trim();
        return {
          id: ++counter.next,
          kind: 'match-arm-inline',
          test: 'else', // normalize _ to else
          result: trimmedResult,
          resultExpr: safeParseExprToNode(trimmedResult, spanOf(startTok, peek())?.start ?? 0),
          span: spanOf(startTok, peek()),
        };
      }
    }

    // Inline Form 5: `"string" => result` or `'string' => result` — string literal arm
    if (tok.kind === 'STRING') {
      const t1 = peek(1);
      if (t1 && isMatchArrow(t1)) {
        const afterArrow = peek(2);
        if (!afterArrow || afterArrow.text !== '{') {
          const startTok = consume(); // consume string literal
          // STRING tokens have their delimiters stripped by the tokenizer.
          // Reconstruct the quoted form for the test field. Use double quotes
          // unless the content contains unescaped double quotes.
          const rawText = startTok.text;
          const testStr = rawText.includes('"') && !rawText.includes("'")
            ? `'${rawText}'`
            : `"${rawText}"`;
          consume(); // consume arrow
          const { expr: result } = collectExpr();
          const trimmedResult = result.trim();
          return {
            id: ++counter.next,
            kind: 'match-arm-inline',
            test: testStr,
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
        if (peek().kind === 'IDENT' || peek().kind === 'KEYWORD') {
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
   * Parse a function parameter list `( param, param, ... )` into string[].
   * Assumes next token is `(`.
   */
  function parseParamList() {
    const params = [];
    if (peek().text !== "(") return params;
    consume(); // consume `(`
    let depth = 1;
    let cur = "";
    // §53: parse param entries into {name, typeAnnotation?} objects.
    // "x: number(>0)" → {name: "x", typeAnnotation: "number(>0)"}
    // "x" → {name: "x"}
    // §35.2.1: lin-annotated params — "lin x" or "lin x: string" → {name: "x", isLin: true, ...}
    // Downstream consumers (emit-functions.ts, emit-server.ts, type-system.ts) already
    // handle both string and {name} forms via typeof checks.
    function pushParam(raw) {
      const s = raw.trim();
      if (!s) return;
      // §35.2.1: detect `lin name` prefix — parameter declared as linear.
      const LIN_PREFIX = /^lin\s+(.+)$/;
      const linMatch = LIN_PREFIX.exec(s);
      const isLin = linMatch !== null;
      const effective = isLin ? linMatch[1].trim() : s;
      const colonIdx = effective.indexOf(':');
      if (colonIdx === -1) {
        params.push(isLin ? { name: effective, isLin: true } : { name: effective });
      } else {
        const name = effective.slice(0, colonIdx).trim();
        const typeAnnotation = effective.slice(colonIdx + 1).trim() || null;
        params.push(isLin ? { name, typeAnnotation, isLin: true } : { name, typeAnnotation });
      }
    }
    while (true) {
      const tok = peek();
      if (tok.kind === "EOF") break;
      if (tok.text === "(" || tok.text === "[" || tok.text === "{") { depth++; cur += tok.text; consume(); }
      else if (tok.text === ")" || tok.text === "]" || tok.text === "}") {
        depth--;
        if (depth === 0) { consume(); break; }
        cur += tok.text;
        consume();
      } else if (tok.text === "," && depth === 1) {
        pushParam(cur);
        cur = "";
        consume();
      } else {
        // Insert a space before IDENT/KEYWORD tokens to prevent concatenation like
        // `lin token` → `lintoken`. Punctuation tokens (: ( ) > etc.) don't need spaces.
        if (cur.length > 0 && (tok.kind === 'IDENT' || tok.kind === 'KEYWORD' || tok.kind === 'AT_IDENT') &&
            cur[cur.length - 1] !== ' ') {
          cur += ' ';
        }
        cur += tok.text;
        consume();
      }
    }
    pushParam(cur);
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

    // Phase 4: update tilde context based on last pushed node
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      if (lastNode.kind === "lift-expr" && lastNode.expr && lastNode.expr.kind === "expr") {
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
        const _entries = namedMatch[1]
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        importNode.names = _entries.map(entry => {
          const asMatch = entry.match(/^(\S+)\s+as\s+(\S+)$/);
          const importedRaw = asMatch ? asMatch[1] : entry;
          return _stripQuotes(importedRaw);
        });
        // P3.A: also record full {imported, local} specifiers so consumers
        // (CHX, future cross-file passes) can map an alias back to the
        // original imported name.
        importNode.specifiers = _entries.map(entry => {
          const asMatch = entry.match(/^(\S+)\s+as\s+(\S+)$/);
          if (asMatch) {
            return { imported: _stripQuotes(asMatch[1]), local: asMatch[2] };
          }
          const bare = _stripQuotes(entry);
          return { imported: bare, local: bare };
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

      const { expr, span } = collectExpr();
      const rawStr = prefixParts.length > 0
        ? "export " + prefixParts.join(" ") + " " + expr
        : "export " + expr;

      const exportNode = {
        id: ++counter.next,
        kind: "export-decl",
        raw: rawStr,
        span,
        exportedName: null,
        exportKind: null,
        reExportSource: null,
        isPure,
        isServer,
      };

      // Re-export: { names } from 'source'
      const reExportMatch = expr.match(/^\s*\{\s*([^}]*)\}\s*from\s+["']([^"']+)["']/);
      if (reExportMatch) {
        exportNode.exportedName = reExportMatch[1].split(",").map(s => s.trim()).filter(Boolean).join(", ");
        exportNode.exportKind = "re-export";
        exportNode.reExportSource = reExportMatch[2];
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

    // @debounced(N) MODIFIER: `@debounced(N) name = expr`
    if (tok.kind === "AT_IDENT" && tok.text === "@debounced") {
      const startTok = consume(); // consume `@debounced`
      let delay = 300; // default debounce delay
      if (peek().text === "(") {
        consume(); // consume `(`
        const delayParts = [];
        while (peek().text !== ")" && peek().kind !== "EOF") {
          delayParts.push(consume().text);
        }
        if (peek().text === ")") consume(); // consume `)`
        delay = parseInt(delayParts.join("").trim(), 10) || 300;
      }
      // Expect `name = expr`
      let name = "";
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
        name = consume().text;
      }
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        const { expr, span } = collectExpr();
        nodes.push({
          id: ++counter.next,
          kind: "reactive-debounced-decl",
          name,
          init: expr,
          initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
          delay,
          span: spanOf(startTok, peek()),
        });
      } else {
        // Malformed — emit as bare-expr
        const { expr, span } = collectExpr();
        const _be6 = startTok.text + " " + name + (expr ? " " + expr : "");
        nodes.push({
          id: ++counter.next,
          kind: "bare-expr",
          expr: _be6,
          exprNode: safeParseExprToNode(_be6, 0),
          span: spanOf(startTok, peek()),
        });
      }
      continue;
    }

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

      // Check for dotted path: @obj.path.to.prop = value  OR  @arr.push(...)
      if (peek().text === ".") {
        const pathSegments = [];
        const tempTokens = [];

        while (peek().text === ".") {
          const dotTok = consume();
          tempTokens.push(dotTok);
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            const segTok = consume();
            tempTokens.push(segTok);
            pathSegments.push(segTok.text);
          } else {
            break;
          }
        }

        // Array mutation patterns: @arr.push(...), @arr.splice(...)
        const ARRAY_MUTATIONS = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
        const lastSeg = pathSegments[pathSegments.length - 1];
        if (pathSegments.length === 1 && ARRAY_MUTATIONS.includes(lastSeg) && peek().text === "(") {
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

        // Nested assignment: @obj.path = value
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

        // Not a nested assignment or array mutation — reconstruct as bare-expr
        const pathStr = "." + pathSegments.join(".");
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
      if (peek().text === "=" && peek(1)?.text !== "=") {
        consume(); // consume `=`
        // fix-cg-cps-return-sql-ref-placeholder: detect `@x = ?{...}.method()`.
        // Bare `?{...}` and `?{...}.all()/.get()/.run()` both flow through here.
        // Without this, safeParseExprToNode produces the broken sql-ref placeholder
        // ExprNode that emit-expr renders as `/* sql-ref:-1 */` — the leak this
        // fix targets in combined-007-crud (server.js:38,74 and client.js:55).
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
        nodes.push({
          id: ++counter.next,
          kind: "state-decl",
          name,
          init: expr,
          initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
          shape: "plain",
          structuralForm: false,
          isConst: false,
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
      if (peek().kind === "IDENT") name = consume().text;
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

    // CONST DECLARATION: `const @name = expr` (reactive derived) or
    //                     `const Name = <element ...>` (component def) or
    //                     `const name = expr`
    if (tok.kind === "KEYWORD" && tok.text === "const") {
      const startTok = consume();

      // Check for `const @name = expr` or `const @name: T = expr` — derived reactive value.
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
            kind: "reactive-derived-decl",
            name: derivedName,
            init: expr,
            initExpr: safeParseExprToNode(expr, spanOf(startTok, peek())?.start ?? 0),
            ...(typeAnnotation ? { typeAnnotation } : {}),
            span: spanOf(startTok, peek()),
          });
        } else {
          nodes.push({
            id: ++counter.next,
            kind: "reactive-derived-decl",
            name: derivedName,
            init: "",
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
      if (peek().kind === "IDENT" || peek().kind === "KEYWORD") name = consume().text;

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
        const markupNode = parseLiftTag();
        if (markupNode) {
          nodes.push({
            id: ++counter.next,
            kind: "lift-expr",
            expr: { kind: "markup", node: markupNode },
            span: spanOf(startTok, peek()),
          });
        } else {
          // parseLiftTag failed — fall back to string path
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

    // FUNCTION DECLARATION: `[pure] [server] function name(params) [route="path"] [method="METHOD"] { body }`
    // `pure` tokenizes as IDENT; accepted only immediately before `function` or `server function`.
    const _pureFnLookahead = tok.text === "pure" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "function") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "function")
    );
    if (
      tok.kind === "KEYWORD" && tok.text === "function" ||
      (tok.kind === "KEYWORD" && tok.text === "server" && peek(1).kind === "KEYWORD" && peek(1).text === "function") ||
      _pureFnLookahead
    ) {
      let isServer = false;
      let isPure = false;
      let startTok = tok;

      if (tok.text === "pure") {
        isPure = true;
        startTok = consume(); // consume `pure`
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

      // Parse optional `!` (canFail) and `-> ErrorType` after parameter list
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

      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Handles: `: Mario`, `-> string`, `: Array<Thing>`, etc.
      let hasReturnType = false;
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
        }
      } else if (!canFail && peek().text === "-" && peek(1)?.text === ">") {
        // Non-failable `-> ReturnType` (failable `-> ErrorType` already handled above)
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
        }
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
        isGenerator,
        canFail,
        errorType,
        route,
        method,
        // §39: handle() escape hatch recognition (§39.3.1).
        // Naming-based: isServer && name === 'handle' (not a generator). CG uses this to weave
        // the middleware pipeline around route handlers.
        isHandleEscapeHatch: isServer && !isGenerator && name === 'handle',
        ...(hasReturnType ? { hasReturnType: true } : {}),
        span: spanOf(startTok, peek()),
      });
      continue;
    }

    // FN SHORTHAND: `[pure|async] [server] fn name { body }` (no parens)
    // `async` and `pure` tokenize as IDENT — detect via text + lookahead.
    const _asyncFnLookahead = tok.text === "async" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    // `pure fn` shorthand (§48.2, §33.2; redundant per §33.6 — W-PURE-REDUNDANT).
    const _pureFnShorthandLookahead = tok.text === "pure" && (
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "fn") ||
      (peek(1)?.kind === "KEYWORD" && peek(1)?.text === "server" &&
       peek(2)?.kind === "KEYWORD" && peek(2)?.text === "fn")
    );
    if (
      tok.kind === "KEYWORD" && tok.text === "fn" ||
      (tok.kind === "KEYWORD" && tok.text === "server" && peek(1).kind === "KEYWORD" && peek(1).text === "fn") ||
      _asyncFnLookahead ||
      _pureFnShorthandLookahead
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
      let startTok = tok;

      if (tok.text === "async") {
        isAsync = true;
        startTok = consume(); // consume `async`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (tok.text === "pure") {
        isPure = true;
        startTok = consume(); // consume `pure`
        if (peek().kind === "KEYWORD" && peek().text === "server") {
          isServer = true;
          consume(); // consume `server`
        }
      } else if (tok.text === "server") {
        isServer = true;
        startTok = consume(); // consume `server`
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

      // Parse optional `!` (canFail) and `-> ErrorType` after parameter list
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

      // Skip return type annotation — `: TypeName` or `-> TypeName` between `)` and `{`
      // Handles: `: Mario`, `: HurtResult`, `-> string`, `: Array<Thing>`, etc.
      let hasReturnType = false;
      if (peek().text === ":") {
        hasReturnType = true;
        consume(); // consume `:`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
        }
      } else if (!canFail && peek().text === "-" && peek(1)?.text === ">") {
        // Non-failable `-> ReturnType` (failable `-> ErrorType` already handled above)
        hasReturnType = true;
        consume(); // consume `-`
        consume(); // consume `>`
        let angleDepth = 0;
        while (peek().kind !== "EOF") {
          if (peek().text === "<") { angleDepth++; consume(); }
          else if (peek().text === ">") { angleDepth--; consume(); }
          else if (peek().text === "{" && angleDepth === 0) break;
          else consume();
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
        fnKind: "fn",
        isServer,
        ...(isAsync ? { isAsync: true } : {}),
        ...(isPure ? { isPure: true } : {}),
        canFail,
        errorType,
        ...(hasReturnType ? { hasReturnType: true } : {}),
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
          // variable name
          if (peek().kind === "IDENT" || peek().kind === "KEYWORD") {
            variable = consume().text;
          }
          // Accept `of` (scrml canonical); reject `in` (JS-reflex).
          if (peek().kind === "KEYWORD" && peek().text === "in") {
            const inTok = peek();
            errors.push(new TABError(
              "E-CTRL-011",
              "E-CTRL-011: `for (... in ...)` is not supported — scrml uses `for (" + (variable || "item") + " of <iterable>)`. " +
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
      if (nextBreak.kind === "IDENT" && nextBreak.line === startTok.line) {
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
      if (nextCont.kind === "IDENT" && nextCont.line === startTok.line) {
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

    // DEBOUNCE built-in: `debounce(fn, ms)`
    if (tok.kind === "KEYWORD" && tok.text === "debounce") {
      const startTok = consume(); // consume `debounce`
      if (peek().text === "(") {
        consume(); // consume `(`
        const fnParts = [];
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
          fnParts.push(lastTok.text);
        }
        const delayParts = [];
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
          delayParts.push(lastTok.text);
        }
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        nodes.push({
          id: ++counter.next,
          kind: "debounce-call",
          fn: fnParts.join(" ").trim(),
          fnExpr: safeParseExprToNode(fnParts.join(" ").trim(), spanOf(startTok, lastTok)?.start ?? 0),
          delay: parseInt(delayParts.join("").trim(), 10) || 300,
          span: spanOf(startTok, lastTok),
        });
      }
      continue;
    }

    // THROTTLE built-in: `throttle(fn, ms)`
    if (tok.kind === "KEYWORD" && tok.text === "throttle") {
      const startTok = consume(); // consume `throttle`
      if (peek().text === "(") {
        consume(); // consume `(`
        const fnParts = [];
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
          fnParts.push(lastTok.text);
        }
        const delayParts = [];
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
          delayParts.push(lastTok.text);
        }
        if (peek().kind === "PUNCT" && peek().text === ";") consume();
        nodes.push({
          id: ++counter.next,
          kind: "throttle-call",
          fn: fnParts.join(" ").trim(),
          fnExpr: safeParseExprToNode(fnParts.join(" ").trim(), spanOf(startTok, lastTok)?.start ?? 0),
          delay: parseInt(delayParts.join("").trim(), 10) || 100,
          span: spanOf(startTok, lastTok),
        });
      }
      continue;
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
      // consume '=>' (tokenized as a single OPERATOR token by tokenizeLogic)
      if (isMatchArrow(peek())) {
        consume(); // consume '=>'
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
 * @returns {{ name: string|null, line: number, tests: object[], before: string[]|null, after: string[]|null }}
 */
function parseTestBody(tokens, filePath, span, errors) {
  let i = 0;
  let groupName = null;
  const tests = [];
  let beforeStmts = null;
  let afterStmts = null;

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
        parts.push(tok.text);
        i++;
      } else if (tok.kind === "PUNCT" && tok.text === "}") {
        if (depth === 0) break; // end of this body — do not consume
        depth--;
        parts.push(tok.text);
        i++;
        if (depth === 0 && parts.length > 0) {
          stmts.push(parts.join(" ").trim());
          parts = [];
        }
      } else {
        parts.push(tok.text);
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
      if (tok.kind === "PUNCT" && tok.text === "{") depth++;
      else if (tok.kind === "PUNCT" && tok.text === "}") depth--;
      parts.push(tok.text);
      i++;
    }
    return parts.join(" ").trim();
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

        if (inner.kind === "IDENT" && inner.text === "assert") {
          i++; // consume "assert"
          const rawExpr = collectAssertTokens();
          const assertNode = parseAssertExpr(rawExpr);
          caseAsserts.push(assertNode);
          caseBody.push("assert " + rawExpr);
        } else {
          // Non-assert statement: collect tokens until next assert keyword or }
          const stmtParts = [];
          let depth = 0;
          while (i < tokens.length && tokens[i].kind !== "EOF") {
            const t = tokens[i];
            if (t.kind === "PUNCT" && t.text === "}" && depth === 0) break;
            if (depth === 0 && t.kind === "IDENT" && t.text === "assert") break;
            if (t.kind === "PUNCT" && t.text === "{") depth++;
            else if (t.kind === "PUNCT" && t.text === "}") depth--;
            stmtParts.push(t.text);
            i++;
          }
          const stmt = stmtParts.join(" ").trim();
          if (stmt) caseBody.push(stmt);
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

      // Pattern: `::TypeName` or `_ `
      let pattern = "_";
      let binding = "";

      if (i < tokens.length && tokens[i].kind === "OPERATOR" && tokens[i].text === "::") {
        i++; // consume `::`
        if (i < tokens.length && (tokens[i].kind === "IDENT" || tokens[i].kind === "KEYWORD")) {
          pattern = "::" + tokens[i].text;
          i++;
        }
      } else if (i < tokens.length && tokens[i].text === "_") {
        pattern = "_";
        i++;
      }

      // Binding variable: bare ident, or `(ident)` tuple-style (§19.4.3 canonical)
      if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "(") {
        i++; // consume `(`
        if (i < tokens.length && tokens[i].kind === "IDENT") {
          binding = tokens[i].text;
          i++;
        }
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ")") i++;
      } else if (i < tokens.length && (tokens[i].kind === "IDENT")) {
        binding = tokens[i].text;
        i++;
      }

      // Arrow `->`
      if (i < tokens.length && tokens[i].kind === "OPERATOR" && (tokens[i].text === "=>" || tokens[i].text === ":>")) {
        i++; // Note: the tokenizer may emit `=>` or `:>` but the spec uses `->`. Handle both.
      } else if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "-") {
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
        if (i < tokens.length && tokens[i].kind === "IDENT") {
          binding = tokens[i].text;
          i++;
        }
        if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === ")") i++;
      } else if (i < tokens.length && tokens[i].kind === "IDENT") {
        binding = tokens[i].text;
        i++;
      }
      // Arrow `->`, `=>`, or `:>`
      if (i < tokens.length && tokens[i].kind === "OPERATOR" && (tokens[i].text === "=>" || tokens[i].text === ":>")) {
        i++;
      } else if (i < tokens.length && tokens[i].kind === "PUNCT" && tokens[i].text === "-") {
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
      i++; // consume TypeName or _
      i++; // consume =>
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
      const attrTokens = tokenizeAttributes(
        block.raw,
        block.span.start,
        block.span.line,
        block.span.col,
        "markup"
      );
      const attrs = parseAttributes(attrTokens, filePath, errors, block.isComponent === true);

      const children = block.children.map(child =>
        buildBlock(child, filePath, "markup", counter, errors)
      ).filter(Boolean);

      return {
        id: ++counter.next,
        kind: "markup",
        tag: block.name,
        attrs,
        children,
        selfClosing: block.closerForm === "self-closing",
        closerForm: block.closerForm,
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
        // Extract header: "< {keyword} name=X for=Y [derived=@Z]>"
        const firstLineEnd = machineRaw.indexOf(">");
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

        let engineName = "";
        let governedType = "";
        let sourceVar = null;

        if (nameMatch) {
          engineName = nameMatch[1];
          if (forMatch) governedType = forMatch[1];
          if (derivedMatch) sourceVar = derivedMatch[1];
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

        // Extract rules from children (text nodes containing the rule lines)
        let rulesRaw = "";
        if (block.children && block.children.length > 0) {
          for (const child of block.children) {
            if (child.raw) rulesRaw += child.raw + "\n";
          }
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
          sourceVar, // §51.9: name of the source reactive var (no `@` prefix), or null
          openerHadSpaceAfterLt: block.openerHadSpaceAfterLt === true,
          legacyMachineKeyword: isLegacyMachineKeyword,
          span,
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
        // Tag all function-decl nodes inside the constructor with stateTypeScope
        // so the type system can build an overload registry for state-type dispatch.
        tagFunctionsWithStateType(children, block.name);

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
      const bodyOffset = block.span.start + prefixLen;
      const bodyLine = block.span.line;
      const bodyCol = block.span.col + prefixLen;

      const tokens = tokenizeLogic(bodyRaw, bodyOffset, bodyLine, bodyCol, block.children);
      const body = parseLogicBody(tokens, filePath, block.children, block, counter, errors, "logic");

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
// Span table builder
// ---------------------------------------------------------------------------

/**
 * Walk the AST and populate a span table: Map<nodeId, Span>.
 * Node IDs are assigned during construction (stored as `id` on each node);
 * this pass only reads them — it does not mutate any node.
 *
 * @param {ASTNode[]} nodes
 * @returns {Map<number, Span>}
 */
function buildSpanTable(nodes) {
  const table = new Map();

  function assign(node) {
    if (!node || typeof node !== "object") return;
    if (node.id !== undefined && node.span) table.set(node.id, node.span);

    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id") continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach(assign);
      else if (val && typeof val === "object" && val.kind) assign(val);
    }
  }

  nodes.forEach(assign);
  return table;
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

  // Hoist imports, exports, type decls, components, machine decls, channel decls
  // from logic blocks + top-level markup.
  const { imports, exports, typeDecls, components, machineDecls, channelDecls } = collectHoisted(nodes);

  // Build span table
  const spanTable = buildSpanTable(nodes);

  // Convert span table Map to plain object for serialisability
  const spans = {};
  for (const [id, span] of spanTable) {
    spans[id] = span;
  }

  // W-PROGRAM-001: Check for <program> root element
  const hasProgramRoot = nodes.some(
    n => n.kind === "markup" && n.tag === "program"
  );

  // ---------------------------------------------------------------------------
  // Session/auth attribute extraction from <program> (Option C hybrid)
  //
  // When <program auth="required" loginRedirect="/login" csrf="auto" sessionExpiry="2h">
  // is present, extract these into a top-level `authConfig` on the AST and annotate the
  // program markup node with the parsed auth properties.
  // ---------------------------------------------------------------------------

  let authConfig = null;
  const programNode = nodes.find(n => n.kind === "markup" && n.tag === "program");
  if (programNode) {
    const programAttrs = programNode.attrs ?? [];

    const getAttrValue = (name) => {
      const a = programAttrs.find(attr => attr.name === name);
      if (!a || !a.value || a.value.kind === "absent") return null;
      if (a.value.kind === "string-literal") return a.value.value;
      return null;
    };

    const authVal = getAttrValue("auth");
    if (authVal) {
      const loginRedirect = getAttrValue("loginRedirect") ?? "/login";
      const csrf = getAttrValue("csrf") ?? "off";
      const sessionExpiry = getAttrValue("sessionExpiry") ?? "1h";

      authConfig = {
        auth: authVal,
        loginRedirect,
        csrf,
        sessionExpiry,
      };

      // Annotate the program node directly for downstream stages
      programNode.auth = authVal;
      programNode.loginRedirect = loginRedirect;
      programNode.csrf = csrf;
      programNode.sessionExpiry = sessionExpiry;
    }
  }

  // ---------------------------------------------------------------------------
  // Middleware attribute extraction from <program> (§39)
  //
  // When <program cors="*" log="structured" csrf="on" ratelimit="100/min" headers="strict">
  // is present, extract these into a top-level `middlewareConfig` on the AST.
  // E-MW-001: csrf="on" without session infrastructure.
  // E-MW-002: ratelimit= value does not match N/unit pattern.
  // ---------------------------------------------------------------------------

  let middlewareConfig = null;
  if (programNode) {
    const programAttrs2 = programNode.attrs ?? [];

    const getMWAttr = (attrName) => {
      const a = programAttrs2.find(attr => attr.name === attrName);
      if (!a || !a.value || a.value.kind === 'absent') return null;
      if (a.value.kind === 'string-literal') return a.value.value;
      return null;
    };

    const mwCors = getMWAttr('cors');
    const mwLog = getMWAttr('log');
    const mwCsrf = getMWAttr('csrf');
    const mwRatelimit = getMWAttr('ratelimit');
    const mwHeaders = getMWAttr('headers');

    if (mwCors !== null || mwLog !== null || mwCsrf !== null || mwRatelimit !== null || mwHeaders !== null) {
      middlewareConfig = { cors: mwCors, log: mwLog, csrf: mwCsrf, ratelimit: mwRatelimit, headers: mwHeaders };
    }

    // E-MW-001: csrf="on" requires session infrastructure (auth= on <program>).
    if (mwCsrf === 'on' && !authConfig) {
      const programSpan2 = programNode.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };
      errors.push(new TABError(
        'E-MW-001',
        'E-MW-001: csrf="on" requires session infrastructure. ' +
        'Add <program auth="required"> or use a session handler, or remove csrf="on".',
        programSpan2,
      ));
    }

    // E-MW-002: ratelimit= value must match N/unit where unit is sec, min, or hour.
    if (mwRatelimit !== null && !/^\d+\/(sec|min|hour)$/.test(mwRatelimit)) {
      const ratelimitAttr = programAttrs2.find(attr => attr.name === 'ratelimit');
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

  const ast = {
    filePath,
    nodes,
    imports,
    exports,
    components,
    typeDecls,
    machineDecls,
    channelDecls,
    spans,
    hasProgramRoot,
    authConfig,
    middlewareConfig,
  };

  if (!hasProgramRoot) {
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
