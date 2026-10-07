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
  /**
   * A `?{` + backtick … backtick + `}` query; `body` is the SQL text codegen lowers, `at` the
   * index of its `?`, `end` the index just past its closing `}`.
   */
  sql(body: string, at: number, end: number): void;
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
 *
 * REGEX OR DIVISION (S457 fix round 1). Whether a `/` opens a regular-expression literal is asked
 * of `regexAllowedAfter` — but over the CODE read so far, not the raw text before the `/`: a
 * string, regex, template literal or `?{}` query read so far stands as one value token (`0`), a
 * comment as whitespace, and a property name after `.` / `?.` as a plain identifier (`_`). The
 * raw prefix let a comment's words, a keyword spelled inside a string, or a property named like a
 * keyword decide the question: `x.if(1) / ?{…}`, `g("if(") / ?{…}`, `x // (⏎ / ?{…}` were read as
 * a regex holding the query, so the query was neither checked nor lowered (emitted raw — invalid
 * JS, fail closed). The compile checks and `rewriteSqlRefs` both locate sites through this one
 * function, so they cannot disagree about which `?{` is code.
 */
export function scanExpressionTextForSql(text: string, visit: ExprTextSqlVisitor, base = 0): void {
  if (typeof text !== "string" || !text.includes("?{")) return;
  const n = text.length;
  // The code read so far, with every literal / comment / query collapsed (see above).
  const code = new CodeSoFar();
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') { i = stringEnd(text, i); code.push("0"); continue; }
    if (c === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl === -1 ? n : nl + 1; code.push("\n"); continue; }
    if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; code.push(" "); continue; }
    if (c === "/" && regexAllowedAfter(code.tail())) {
      // A regular-expression literal.
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
      code.push("0");
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
      code.push("0");
      continue;
    }
    if (c === "?" && text[i + 1] === "{") {
      const at = base + i;
      code.push("0");
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
      visit.sql(text.slice(i + 3, close), at, base + close + 2);
      i = close + 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      // A whole identifier / keyword. After `.` or `?.` it is a property name — a value, whatever
      // it is spelled like (`x.if(1)`, `o.return`) — so it enters the code read as `_`.
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j]!)) j++;
      code.push(code.lastNonSpace() === "." ? "_" : text.slice(i, j));
      i = j;
      continue;
    }
    code.push(c);
    i++;
  }
}

/**
 * The code read so far by `scanExpressionTextForSql`, as a list of units (a token, a collapsed
 * literal, one space for a whitespace run). `tail()` hands `regexAllowedAfter` the suffix it
 * reads — the last few units; after a trailing `)`, the few units before its matching `(` plus
 * an empty `()` — so each `/` costs O(its context), not O(text): re-joining (or flattening a
 * `+=`-built string) up to every `/` made the scan quadratic, and so did re-reading a long
 * parenthesised inside. `regexAllowedAfter` gives the same answer on this suffix as on the whole:
 * it reads back over trailing whitespace, the last token, the word and `.` before it, the token
 * before `of`, a `+` / `-` run, and for `)` only the word before its matching `(` — all inside the
 * suffix.
 */
class CodeSoFar {
  private readonly parts: string[] = [];
  /** For a `)` unit: the index of its matching `(` unit, or -1 when it has none. */
  private readonly openOf = new Map<number, number>();
  private readonly opens: number[] = [];
  private static readonly LOOKBACK = 64;

  push(unit: string): void {
    if (/^\s+$/.test(unit)) {
      if (this.parts.length > 0 && this.parts[this.parts.length - 1] === " ") return;
      this.parts.push(" ");
      return;
    }
    const k = this.parts.length;
    if (unit === "(") this.opens.push(k);
    else if (unit === ")") this.openOf.set(k, this.opens.length > 0 ? this.opens.pop()! : -1);
    this.parts.push(unit);
  }

  private lastNonSpaceIndex(): number {
    let k = this.parts.length - 1;
    if (k >= 0 && this.parts[k] === " ") k--;
    return k;
  }

  /** The last non-whitespace character of the code read so far, or "". */
  lastNonSpace(): string {
    const k = this.lastNonSpaceIndex();
    if (k < 0) return "";
    const u = this.parts[k]!;
    return u[u.length - 1]!;
  }

  /** The suffix of the code read so far that `regexAllowedAfter` reads (see the class note). */
  tail(): string {
    const last = this.lastNonSpaceIndex();
    if (last >= 0 && this.parts[last] === ")") {
      const open = this.openOf.get(last) ?? -1;
      // unmatched: regexAllowedAfter finds no `(` (division) — on ")" alone too
      if (open < 0) return ")";
      // After a `)`, regexAllowedAfter reads only what OPENED it: it walks back to the matching
      // `(` and asks for the word before. Hand it the units before that `(` and an empty `()` —
      // the same answer, without the parenthesised text: re-reading the whole inside on every
      // `/` after a `)` made `((((x) / x) / x) …` quadratic (16k levels: 6.5 s, S457
      // g-sql-site-locator-nested-paren-quadratic-s457).
      return this.parts.slice(Math.max(0, open - CodeSoFar.LOOKBACK), open).join("") + "()";
    }
    return this.parts.slice(Math.max(0, this.parts.length - CodeSoFar.LOOKBACK)).join("");
  }
}

/** A `?{` + backtick … backtick + `}` query in code context: `[at, end)` and its SQL body. */
export interface ExprTextSqlSite {
  at: number;
  end: number;
  body: string;
}

/**
 * Every query codegen's text path lowers in `text`, in source order — the `sql` visits of
 * `scanExpressionTextForSql`. THE one reader of where a `?{}` sits in expression text: the
 * compile checks (`sql-one-statement.ts`) read these bodies, and `codegen/rewrite.ts`
 * `rewriteSqlRefs` lowers exactly these sites and no other text (S457,
 * `g-rewrite-sql-refs-lowers-inside-js-literals-s456`: a whole-text regex lowered a `?{` inside a
 * JS string / regex / comment / template text the checks had skipped — two readers of one text).
 */
export function sqlSitesInExpressionText(text: string): ExprTextSqlSite[] {
  const out: ExprTextSqlSite[] = [];
  scanExpressionTextForSql(text, {
    sql: (body, at, end) => { out.push({ at, end, body }); },
    unreadable: () => {},
  });
  return out;
}
