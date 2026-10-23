// ---------------------------------------------------------------------------
// interpolation-extent.ts — S469: THE one reader of where a `${ … }` ends.
//
// Two kinds of text carry `${ … }` whose extent the compiler must cut out of raw text:
//
//   - a TEMPLATE INTERPOLATION — in a template literal's source or a QUOTED attribute value
//     (`data-v="a ${x} b"`). Its payload is ONE JavaScript expression; codegen emits it inside a
//     template literal and the browser / server ends it where JavaScript does.
//     → `sliceTemplateText`, `templateInterpolationPayloads` (EXPRESSION mode).
//   - a LOGIC BLOCK kept as raw text — an engine state-child / opener `effect=${ … }`, an
//     `<onTransition if=${ … }>` guard or `${ … }` body, a `(state × message)` arm `{ … }`. Its
//     payload is a scrml STATEMENT LIST (`match`, `!{ … }`, `fail`, `::` — no JavaScript parser
//     accepts it whole), parsed afterwards by the block splitter + AST builder.
//     → `logicBlockClose`, `braceBlockClose`, `soleLogicBlockPayload` (BLOCK mode).
//
// Before S469 each site had its own reader (a brace counter blind to strings / comments /
// templates / regular expressions; then two acorn readers — `sliceTemplateText` in
// expression-parser.ts (#1476) and `logic-block-extent.ts` (s469-engine-effect-failable)). They
// are this module now; where the two acorn readers differed, the STRICTER rule is kept:
//
//   1. BOTH GOALS, as the code really runs. A client bundle is a CLASSIC SCRIPT (Annex B: `<!--`
//      and a line-initial `-->` are comments; inside a sloppy function `await` is an identifier),
//      a server bundle a MODULE. The script reading does NOT get `allowAwaitOutsideFunction`
//      (#1476's did): `${ await /}/ }` is a regular expression to a module and a division chain to
//      a script, so the two readings end it at different `}`s — unreadable. A payload is bounded
//      only when both readings agree.
//   2. HTML-LIKE COMMENTS are refused lexically (`hasHtmlLikeComment`), inside strings too.
//   3. EXPRESSION mode admits exactly one expression followed by `}` (#1476's rule) — no token
//      fallback, no markup fallback: a template interpolation that is not one expression is
//      unreadable.
//   4. BLOCK mode reads a statement list by TOKENS when it is not one expression (acorn's own
//      lexer — strings, templates and their `${…}`, comments and regular expressions as JavaScript
//      reads them) to the balancing `}`. Only a block that NO JavaScript lexer can read because it
//      holds a markup value (`${ c = <p>x</p> }`) falls back to the block splitter's brace rule;
//      the body reader that parses the cut text (engine-body-reader.ts) then requires it to read
//      as exactly one logic block, so the cut and the parse cannot disagree.
//
// An unreadable payload is -1 / `unreadable`; every caller refuses it (fail closed) or, for a
// reader of names (route inference), over-approximates with the rest of the text.
// ---------------------------------------------------------------------------

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";
import { ScrmlParser } from "./scrml-acorn.ts";

const GOALS = [
  { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true },
  { ecmaVersion: "latest", sourceType: "script" },
] as const;

/** One segment of template text: literal (quasi) text, or an interpolation's payload. */
export interface TemplateSegment {
  kind: "quasi" | "expr";
  text: string;
  /** Offset of `text[0]` within the original `raw` string. */
  offset: number;
}

/**
 * `text` holds `<!--`, or a `-->` that only white space (or a block comment's close) precedes on
 * its line: Annex B HTML-like comment openers, which a classic script reads as comments and a
 * module does not. Legitimate code never needs them (as text inside a string they are also
 * refused: the check is lexical, fail closed).
 */
export function hasHtmlLikeComment(text: string): boolean {
  if (text.includes("<!--")) return true;
  for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const at = line.indexOf("-->");
    if (at < 0) continue;
    const before = line.slice(0, at);
    if (before.trim() === "" || before.includes("*/")) return true;
  }
  return false;
}

/**
 * A parser over `src` from `start` (just after the `${` / `{`). Not `new ScrmlParser(…, src,
 * start)`: acorn's constructor then counts the lines of everything before `start` (quadratic over
 * many slots — see codegen/sql-lex.ts). Nothing read depends on the text before `start`.
 */
function parserAt(opts: object, src: string, start: number): any {
  // acorn declares the Parser constructor protected in its .d.ts; it is public at run time.
  return new (ScrmlParser as any)(opts, src.slice(start), 0);
}

/** The `}` after ONE expression starting at `start`, under one goal; -1 when there is none. */
function expressionCloseUnder(opts: object, src: string, start: number): number {
  try {
    const p = parserAt(opts, src, start);
    p.nextToken();
    p.parseExpression();
    return p.type === acorn.tokTypes.braceR ? start + p.start : -1;
  } catch {
    return -1;
  }
}

/** The `}` that balances a block whose payload starts at `start`, read by tokens under one goal. */
function tokenCloseUnder(opts: object, src: string, start: number): number {
  try {
    const p = parserAt(opts, src, start);
    p.nextToken();
    const tt = acorn.tokTypes;
    let depth = 0;
    for (;;) {
      const type = p.type;
      if (type === tt.eof) return -1;
      if (type === tt.braceL || type === tt.dollarBraceL) depth++;
      else if (type === tt.braceR) {
        if (depth === 0) return start + p.start;
        depth--;
      }
      p.next();
    }
  } catch {
    return -1;
  }
}

/** Both goals agree (and no HTML-like comment): the close; else -1. `both` = neither goal read it. */
function agree(src: string, start: number, close: (opts: object) => number): { at: number; neither: boolean } {
  const asModule = close(GOALS[0]);
  const asScript = close(GOALS[1]);
  if (asModule < 0 && asScript < 0) return { at: -1, neither: true };
  if (asModule < 0 || asModule !== asScript) return { at: -1, neither: false };
  if (hasHtmlLikeComment(src.slice(start, asModule))) return { at: -1, neither: false };
  return { at: asModule, neither: false };
}

/**
 * EXPRESSION mode — the index of the `}` that closes a template interpolation whose payload
 * starts at `start`, or -1 (not one expression followed by `}` under both goals, or an HTML-like
 * comment).
 */
export function interpolationClose(src: string, start: number): number {
  if (typeof src !== "string") return -1;
  return agree(src, start, (opts) => expressionCloseUnder(opts, src, start)).at;
}

/**
 * BLOCK mode — the index of the `}` that closes a logic block whose payload starts at `start`, or
 * -1 when it cannot be read. One expression first, else tokens; a markup-valued block falls back
 * to the block splitter's brace rule (see the module header, rule 4).
 */
function blockCloseFrom(src: string, start: number): number {
  const asExpr = agree(src, start, (opts) => expressionCloseUnder(opts, src, start));
  if (asExpr.at >= 0) return asExpr.at;
  // One goal reads ONE expression and the other does not (or they end it at different `}`s):
  // the goals disagree on what the text is — unreadable, never settled by the token reading.
  if (!asExpr.neither) return -1;
  const asTokens = agree(src, start, (opts) => tokenCloseUnder(opts, src, start));
  if (asTokens.at >= 0) return asTokens.at;
  return asTokens.neither ? markupBlockClose(src, start) : -1;
}

/**
 * A block JavaScript's lexer cannot read under either goal because it holds a MARKUP VALUE
 * (`${ @card = <p>hi</p> }` — `</p>` lexes as a regular expression): bounded by the block
 * splitter's own rule for a `${` (brace depth), the reader that then parses the body. -1 when the
 * block holds no markup (an unterminated string / template / comment — unreadable), does not
 * close, or holds an HTML-like comment.
 */
function markupBlockClose(src: string, start: number): number {
  let depth = 1;
  let j = start;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return -1;
  const payload = src.slice(start, j);
  if (!/<\/?[A-Za-z][\w:.-]*(?=[\s>\/])/.test(payload)) return -1;
  if (hasHtmlLikeComment(payload)) return -1;
  return j;
}

/**
 * BLOCK mode — the index of the `}` that closes the `${` at `dollarIdx` (`src[dollarIdx]` is `$`,
 * `src[dollarIdx + 1]` is `{`), or -1. The payload is `src.slice(dollarIdx + 2, <result>)`.
 */
export function logicBlockClose(src: string, dollarIdx: number): number {
  if (typeof src !== "string" || src[dollarIdx] !== "$" || src[dollarIdx + 1] !== "{") return -1;
  return blockCloseFrom(src, dollarIdx + 2);
}

/** BLOCK mode for a block whose opening brace is `src[braceIdx]`: an engine message arm `{ …; .T }`. */
export function braceBlockClose(src: string, braceIdx: number): number {
  if (typeof src !== "string" || src[braceIdx] !== "{") return -1;
  return blockCloseFrom(src, braceIdx + 1);
}

/**
 * `text` (trimmed) is exactly ONE `${ … }` logic block: its payload, or null (it does not start
 * with `${`, the block cannot be read, or anything follows its `}`).
 */
export function soleLogicBlockPayload(text: string): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t.startsWith("${")) return null;
  const close = logicBlockClose(t, 0);
  if (close < 0 || close !== t.length - 1) return null;
  return t.slice(2, close);
}

/**
 * EXPRESSION mode over template TEXT. `raw` is a template literal's source (outer backticks
 * stripped) or, with `bare`, a QUOTED attribute value. Quasi text follows the template-literal
 * rules codegen writes it under: a `\` escapes the next character. Returns the segments (offsets
 * into `raw`) and, when an interpolation is not one readable expression closed by `}`,
 * `unreadable` = its text from after the `${` to the end (nothing after it is sliced: the
 * boundaries are no longer known).
 *
 * The one slicer of this text: codegen emits from these segments (`rewriteTemplateAttrValue`,
 * emit-each, SSR `attrValueParts`), the failable walk reads them (`templateTextInterpolationNodes`),
 * and the `await` lint and route inference read their payloads.
 */
export function sliceTemplateText(
  raw: string, opts: { bare?: boolean } = {},
): { segments: TemplateSegment[]; unreadable: string | null } {
  const segments: TemplateSegment[] = [];
  if (typeof raw !== "string") return { segments, unreadable: null };
  let i = 0;
  let end = raw.length;
  if (!opts.bare && raw.startsWith("`")) {
    i = 1;
    if (raw.length >= 2 && raw.endsWith("`")) end = raw.length - 1;
  }
  const src = raw.slice(0, end);
  let quasiStart = i;
  while (i < end) {
    const ch = src.charCodeAt(i);
    if (ch === 92 /* \ */) { i += 2; continue; }
    if (ch === 36 /* $ */ && src.charCodeAt(i + 1) === 123 /* { */) {
      segments.push({ kind: "quasi", text: src.slice(quasiStart, i), offset: quasiStart });
      const exprStart = i + 2;
      const closeAt = interpolationClose(src, exprStart);
      if (closeAt < 0) {
        const rest = src.slice(exprStart);
        segments.push({ kind: "expr", text: rest, offset: exprStart });
        return { segments, unreadable: rest };
      }
      segments.push({ kind: "expr", text: src.slice(exprStart, closeAt), offset: exprStart });
      i = closeAt + 1;
      quasiStart = i;
      continue;
    }
    i++;
  }
  if (quasiStart < end) segments.push({ kind: "quasi", text: src.slice(quasiStart, end), offset: quasiStart });
  return { segments, unreadable: null };
}

/**
 * The interpolation payloads of template text (`sliceTemplateText`); an unreadable one is the
 * rest of the text (a reader of NAMES over-approximates, it never drops the tail).
 */
export function templateInterpolationPayloads(text: string, opts: { bare?: boolean } = {}): string[] {
  return sliceTemplateText(text, opts).segments.filter((s) => s.kind === "expr").map((s) => s.text);
}
