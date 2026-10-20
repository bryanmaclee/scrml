// ---------------------------------------------------------------------------
// logic-block-extent.ts — S469 (s469-engine-effect-failable, SECURITY): where a
// `${ … }` logic block written inside RAW TEXT ends — an engine state-child's
// `effect=${…}`, the engine opener's `effect=${…}`, an `<onTransition if=${…}>`
// guard, an `<onTransition>` body `${…}` — read by THE JavaScript reader, not a
// brace counter.
//
// The engine body is kept as raw text (`engine-decl.rulesRaw`) and re-scanned by
// `engine-statechild-parser.ts`; before this, each scan bounded a `${` by counting
// `{` / `}` characters, blind to strings, comments, templates and regular
// expressions (`effect=${ @msg = "}" + … }`). The text it cut out is the text the
// failable walk reads and codegen emits, so a cut that differs from where the
// browser ends the block lets the walk and the run disagree.
//
// THE READER. The block's payload is read by acorn (`ScrmlParser`, acorn plus the
// scrml `@` sigil and `Type::Variant` tokens — the same parser `codegen/sql-lex.ts`
// `jsInterpolationEnd` bounds a `?{}` slot with): parsed as one expression when it
// is one, otherwise read TOKEN BY TOKEN (strings, templates and their `${…}`,
// comments and regular-expression literals as acorn's lexer reads them) to the `}`
// that balances the `${`. A logic block is a statement list in scrml syntax
// (`match`, `!{ … }`, `fail`, `::`), which no JavaScript parser accepts whole; its
// TOKENS are JavaScript's, which is what decides where it ends.
//
// BOTH GOALS. The client bundle runs as a CLASSIC SCRIPT, a server bundle as a
// MODULE, and the two lexers differ on text that can move a `}`: Annex B makes
// `<!--` (and a line-initial `-->`) a comment in a script only, and `await` is an
// identifier in a script function but a keyword in a module (`await /}/` is a
// division chain in one and a regular expression in the other). A block is bounded
// only when both readings end it at the same `}` and it holds no HTML-like comment;
// otherwise it is UNREADABLE (-1) and every caller refuses it (fail closed).
// ---------------------------------------------------------------------------

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";
import { ScrmlParser } from "./scrml-acorn.ts";

const GOALS = [
  { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true },
  { ecmaVersion: "latest", sourceType: "script" },
] as const;

/**
 * A parser over `src` from `start` (just after the `${`). Not `new ScrmlParser(…, src, start)`:
 * acorn's constructor then counts the lines of everything before `start` — see sql-lex.ts.
 */
function parserAt(opts: object, src: string, start: number): any {
  // acorn declares the Parser constructor protected in its .d.ts; it is public at run time.
  return new (ScrmlParser as any)(opts, src.slice(start), 0);
}

/** Index of the `}` that closes a block whose payload starts at `start`, under one goal; -1 when unprovable. */
function closeUnder(opts: object, src: string, start: number): number {
  // 1. The payload is one expression: the block ends at the token after it.
  try {
    const p = parserAt(opts, src, start);
    p.nextToken();
    p.parseExpression();
    if (p.type === acorn.tokTypes.braceR) return start + p.start;
  } catch { /* not one expression — read tokens */ }
  // 2. Read tokens to the `}` that balances the `${`.
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

/**
 * `text` holds `<!--`, or a `-->` that only white space (or a block comment's close) precedes on
 * its line: Annex B HTML-like comment openers, which a classic script reads as comments and a
 * module does not. Checked lexically over the whole text (inside a string too): fail closed.
 */
export function hasHtmlLikeCommentText(text: string): boolean {
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
 * The index of the `}` that closes the `${` at `dollarIdx` in `src` (`src[dollarIdx]` is `$`,
 * `src[dollarIdx + 1]` is `{`), or -1 when the block cannot be read: it does not close, the
 * module and script readings close it at different `}`s, or its payload holds an HTML-like
 * comment. The payload is `src.slice(dollarIdx + 2, <result>)`.
 */
export function logicBlockClose(src: string, dollarIdx: number): number {
  if (typeof src !== "string" || src[dollarIdx] !== "$" || src[dollarIdx + 1] !== "{") return -1;
  const start = dollarIdx + 2;
  const asModule = closeUnder(GOALS[0], src, start);
  if (asModule < 0) return -1;
  const asScript = closeUnder(GOALS[1], src, start);
  if (asScript !== asModule) return -1;
  if (hasHtmlLikeCommentText(src.slice(start, asModule))) return -1;
  return asModule;
}

/**
 * `text` (trimmed) is exactly ONE `${ … }` block, read by `logicBlockClose`: returns its payload,
 * or null when `text` is not one whole block (it does not start with `${`, the block cannot be
 * read, or anything follows its `}`).
 */
export function soleLogicBlockPayload(text: string): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t.startsWith("${")) return null;
  const close = logicBlockClose(t, 0);
  if (close < 0 || close !== t.length - 1) return null;
  return t.slice(2, close);
}
