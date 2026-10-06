/**
 * §8.1.2 / §14.8.10 (S456 fix round F2) — the `?{}` queries inside EXPRESSION TEXT the parser
 * held unparsed: an `escape-hatch` expression's `raw` (an `if (…)` / `while (…)` condition the
 * expression parser did not structure), a template literal's `raw` (`\`… ${?{…}.run()} …\``),
 * and a `match` expression's raw arm bodies.
 *
 * Codegen lowers these through the TEXT path (`codegen/rewrite.ts` `rewriteSqlRefs`), whose
 * pattern is exactly `?{` + backtick + body-without-backtick + backtick + `}`. The program-body
 * checks (one statement per `?{}`, the closed allow-list) read the SAME body: this scanner finds
 * every `?{` in code context (outside JS string literals and comments; inside a template
 * literal's `${…}` slots, recursively — the slot extent from `codegen/sql-lex.ts`
 * `jsInterpolationEnd`) and reports the body codegen would send. A `?{` the text path does NOT
 * lower (no backtick right after `?{`, a backtick inside the body, no `}` right after the closing
 * backtick) is reported as UNREADABLE — the compile refuses it (fail closed) rather than emit a
 * query no check read (S239 review F2/F4: the unbackticked `if (?{ SELECT …; select … })` was
 * emitted unrewritten as invalid JS with no diagnostic).
 */

import { jsInterpolationEnd } from "./codegen/sql-lex.ts";
import { regexAllowedAfter } from "./codegen/code-segments.ts";

export interface ExprTextSqlVisitor {
  /** A `?{` + backtick … backtick + `}` query; `body` is the SQL text codegen lowers. */
  sql(body: string, at: number): void;
  /** A `?{` the text-path lowering does not read; `why` names the shape. */
  unreadable(why: string, at: number): void;
}

/** Index just past the JS string literal opening at `at` (escape-aware); the text end if unterminated. */
function stringEnd(text: string, at: number): number {
  const q = text[at];
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === q) return i + 1;
  }
  return text.length;
}

/**
 * Walk `text` (expression source) and report every `?{` query in code context. `base` offsets the
 * reported positions (for recursion into template slots).
 */
export function scanExpressionTextForSql(text: string, visit: ExprTextSqlVisitor, base = 0): void {
  if (typeof text !== "string" || !text.includes("?{")) return;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') { i = stringEnd(text, i); continue; }
    if (c === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl === -1 ? n : nl + 1; continue; }
    if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "/" && regexAllowedAfter(text.slice(0, i))) {
      // A regular-expression literal (the codegen's shared regex-vs-division reading).
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (inClass) { if (text[j] === "]") inClass = false; }
        else if (text[j] === "[") inClass = true;
        else if (text[j] === "/") break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "`") {
      // A template literal: its text is data; its `${…}` slots are code (recurse).
      let j = i + 1;
      while (j < n && text[j] !== "`") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "$" && text[j + 1] === "{") {
          const end = jsInterpolationEnd(text, j);
          const stop = end === -1 ? n : end;
          scanExpressionTextForSql(text.slice(j + 2, end === -1 ? n : end - 1), visit, base + j + 2);
          j = stop;
          continue;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "?" && text[i + 1] === "{") {
      const at = base + i;
      // The text-path lowering's exact shape: `?{` BACKTICK body BACKTICK `}`.
      if (text[i + 2] !== "`") {
        visit.unreadable("a `?{ … }` written without the backtick template, in expression text the compiler holds unparsed (it is not lowered)", at);
        // Skip the braced body (JS-aware: `?{` reads like `${`).
        const end = jsInterpolationEnd(text, i);
        i = end === -1 ? n : end;
        continue;
      }
      const close = text.indexOf("`", i + 3);
      if (close === -1) { visit.unreadable("an unterminated `?{` SQL template", at); return; }
      if (text[close + 1] !== "}") {
        visit.unreadable("a `?{` SQL template whose body holds a backtick, or whose closing backtick is not followed by `}` (the compiler does not lower it)", at);
        i = close + 1;
        continue;
      }
      visit.sql(text.slice(i + 3, close), at);
      i = close + 2;
      continue;
    }
    i++;
  }
}
