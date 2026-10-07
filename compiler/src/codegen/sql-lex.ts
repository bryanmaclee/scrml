// ---------------------------------------------------------------------------
// sql-lex.ts — §52.15.5 (S255) the SINGLE source of truth for "which `${...}`
// interpolations in a `?{}` SQL body are LIVE" (in code context) vs INERT (text
// inside a comment / string literal / dollar-quoted body).
//
// This ONE function feeds BOTH:
//   - the CLASSIFIER (collect.ts serverVarDeclLoadKind / row-scope predicate) —
//     which `${@cell}` interpolations decide param-bearing vs sql-load + row-scope;
//   - the EMITTER (rewrite.ts extractSqlParams) — which `${expr}` become bound
//     `$N` params vs literal segment text.
// Sharing it makes the two CANNOT disagree: a `${}` the classifier ignores is the
// same `${}` the emitter does NOT bind (round-3 defect 3 — the classifier/emitter
// divergence that emitted a `$N` inside a comment → Postgres bind-count 500).
//
// A hand-rolled scanner is used (not a full SQL parser) but it is SQL-lexer-grade
// on the token boundaries that hide a `${}`: single-quoted strings (`''` escape),
// double-quoted identifiers (`""` escape, round-3 defect 2 — `"audit--log"`),
// `E'...'` backslash-escaped strings, `$tag$...$tag$` dollar-quoting, `--` line
// comments, and NESTED `/* /* */ */` block comments (round-3 defect 5). A `${` is
// recognised as a scrml interpolation ONLY in code context.
// ---------------------------------------------------------------------------

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";
import { ScrmlParser } from "../scrml-acorn.ts";

/**
 * The parser options a slot payload is read with: the server module's (an ES module —
 * strict code, top-level `await` allowed), at the newest syntax acorn knows.
 */
const SLOT_PARSE_OPTIONS = {
  ecmaVersion: "latest",
  sourceType: "module",
  allowAwaitOutsideFunction: true,
} as const;

/**
 * Index just past the `}` that closes the `${` at `start` (the `$`); -1 when no reader can
 * prove where it ends.
 *
 * THE single reader of a `?{}` slot's extent (§8.1.2 "One reader of a slot's extent"; S456
 * fix round F1, S457). `liveSqlInterpolations` uses it, so the emitter (`rewrite.ts`
 * `extractSqlParams`), the program-body checks (§8.1.2 and the §14.8.10 allow-list, via
 * `schema-differ.js` `programSqlTokens`), the tenant subset, the protect floor, §52 write
 * detection and the §8.10 hoist all split a body where the emitted tagged template's JS
 * parse does. The codegen guard (`sql-one-statement-guard.ts`) re-reads the emitted template
 * with acorn and fails closed on any residual difference.
 *
 * HOW IT READS (S457 — `g-sql-slot-reader-regex-division-misreads-s456`). The slot is ended by
 * the JavaScript PARSER, not by a scanner that guesses: the payload is parsed as one
 * expression from just after `${` (acorn, extended only by the scrml `@` sigil and
 * `Type::Variant` tokens — `scrml-acorn.ts`), and the slot ends at the `}` token the parser
 * reaches next. String literals, nested template literals, comments and regular-expression
 * literals are read by the parser itself, so whether a `/` opens a regex or divides is the
 * grammar's answer (`${ x.if(1) / 2 }`, `${ ({a:1}) / 2 }`, `${ x // (⏎ / 2 }` — misread by
 * the old preceding-character heuristic, `regexAllowedAfter`, which ended the slot later or
 * not at all and refused a valid single statement).
 *
 * A payload in scrml-only expression syntax that is not JavaScript (`${ x is not ? 1 : 2 }`,
 * `${ not x }`, a `?{…}` inside a template slot of expression text) cannot be parsed by a
 * JavaScript parser before codegen lowers it. For those — and only those — the extent is
 * read with the SAME parser's tokenizer: tokens are read in order (strings, templates and
 * their `${…}`, comments and regex literals as the tokenizer reads them) and the slot ends at
 * the `}` that balances the `${`. This is not a second scanner: it is acorn's own lexer, and
 * the codegen guard still judges the emitted call. When neither reading reaches a `}` — the
 * tokenizer throws (an unterminated string / template / comment / regex) or the text ends —
 * the result is -1 and every consumer refuses the slot (fail closed).
 */
export function jsInterpolationEnd(src: string, start: number): number {
  const parsed = parsedSlotEnd(src, start);
  if (parsed !== -1) return parsed;
  return tokenizedSlotEnd(src, start);
}

/**
 * A parser over the text FROM the slot's `$` on, positioned just after its `${`. Positions it
 * reports are relative to `start` (callers add `start` back). Not `new ScrmlParser(…, src,
 * start + 2)`: given a start offset, acorn's constructor counts the lines of everything before
 * it (`input.slice(0, lineStart).split(lineBreak)`), O(body) per slot and so quadratic over a
 * body of many slots (S457 review: 16k one-per-line slots took ~10 s). Nothing acorn reads
 * depends on the text before the start offset — the tokenizer starts in its initial context
 * either way, and line numbers are only used for `locations`, which is off.
 */
function slotParser(src: string, start: number): any {
  // acorn declares the Parser constructor protected in its .d.ts; it is public at run time (plugins are built this way).
  return new (ScrmlParser as any)(SLOT_PARSE_OPTIONS, src.slice(start), 2);
}

/** The slot end by PARSING the payload as one expression; -1 when the payload is not one. */
function parsedSlotEnd(src: string, start: number): number {
  try {
    // @ts-ignore — acorn's Parser constructor / nextToken / parseExpression are untyped here
    const p = slotParser(src, start);
    p.nextToken();
    p.parseExpression();
    // The token after the expression — whitespace and comments already skipped by acorn.
    if (p.type === acorn.tokTypes.braceR) return start + p.end;
    return -1;
  } catch {
    return -1;
  }
}

/** The slot end by READING TOKENS to the `}` that balances the `${`; -1 when unprovable. */
function tokenizedSlotEnd(src: string, start: number): number {
  try {
    // @ts-ignore — see parsedSlotEnd
    const p = slotParser(src, start);
    p.nextToken();
    let depth = 0;
    const tt = acorn.tokTypes;
    for (;;) {
      const type = p.type;
      if (type === tt.eof) return -1;
      if (type === tt.braceL || type === tt.dollarBraceL) depth++;
      else if (type === tt.braceR) {
        if (depth === 0) return start + p.end;
        depth--;
      }
      p.next();
    }
  } catch {
    return -1;
  }
}

/** A live (code-context) `${expr}` interpolation span within a SQL body. */
export interface SqlInterpolation {
  /** The interpolation payload — the text between `${` and its matching `}`. */
  expr: string;
  /** Index of the `$` of `${`. */
  start: number;
  /** Index just past the closing `}` (exclusive). */
  end: number;
}

/**
 * Return the LIVE `${expr}` interpolations of a SQL body, in left-to-right order.
 * `${}` sequences inside a string literal, quoted identifier, dollar-quoted body,
 * or `--` / `/* *​/` comment are NOT live (they are inert SQL text) and are omitted.
 */
export function liveSqlInterpolations(sql: string): SqlInterpolation[] {
  const out: SqlInterpolation[] = [];
  if (typeof sql !== "string") return out;
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];

    // scrml interpolation `${...}` in CODE context — the only live case. Its extent is
    // read the way JavaScript reads a template-literal slot (`jsInterpolationEnd`): the
    // payload is written back into the emitted tagged template, and the JS engine — not
    // this function — decides where the bound expression ends and the SQL text resumes.
    // S456 fix round F1: a brace count ended `${ x + '{' }` at a later `}` (`… /* } */`),
    // so the compile checks read ONE slot while JS bound `x + '{'` and sent the text
    // between as SQL (`; CREATE TABLE …` / `; DELETE FROM …` ran — executed on sqlite).
    if (c === "$" && sql[i + 1] === "{") {
      const end = jsInterpolationEnd(sql, i);
      if (end === -1) {
        // Unterminated — the rest of the body is the slot (no SQL text follows it).
        out.push({ expr: sql.slice(i + 2), start: i, end: n });
        i = n;
        continue;
      }
      out.push({ expr: sql.slice(i + 2, end - 1), start: i, end });
      i = end;
      continue;
    }

    // `E'...'` / `e'...'` escape string — backslash escapes AND `''` doubling.
    if ((c === "E" || c === "e") && sql[i + 1] === "'") {
      i += 2;
      while (i < n) {
        if (sql[i] === "\\") { i += 2; continue; }        // backslash escape
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }   // '' escape
          i++; break;
        }
        i++;
      }
      continue;
    }

    // single-quoted string literal `'...'` (`''` escape).
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }

    // double-quoted identifier `"..."` (`""` escape) — round-3 defect 2: a `--`
    // or `${...}` inside a quoted identifier is NOT a comment / live interpolation.
    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }

    // dollar-quoted string `$tag$ ... $tag$` (tag = `[A-Za-z0-9_]*`, `$$` = empty
    // tag). NOTE `${` is handled above; `$1` positional params fall through as text.
    if (c === "$") {
      let k = i + 1;
      while (k < n && /[A-Za-z0-9_]/.test(sql[k]!)) k++;
      if (sql[k] === "$") {
        const tag = sql.slice(i, k + 1); // `$...$`
        const close = sql.indexOf(tag, k + 1);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
      i++; // a lone `$` / `$1` positional param — plain text
      continue;
    }

    // `--` line comment to end of line.
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    // `/* ... */` block comment — NESTED (round-3 defect 5).
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }

    i++;
  }
  return out;
}

/**
 * The SQL body with every LIVE `${…}` slot replaced by `repl(slot)` — the slot extents of
 * `liveSqlInterpolations` (the emitter's, JS-aware). Every reader that blanks or skips the
 * bound parameters of a `?{}` body to look at its SQL text uses this, so none re-derives where
 * a slot ends (S456 fix round F1: a brace count or `[^}]*` disagreed with the emitted template).
 */
export function replaceLiveSqlInterpolations(sql: string, repl: (slot: SqlInterpolation) => string): string {
  if (typeof sql !== "string") return sql;
  let out = "";
  let cursor = 0;
  for (const slot of liveSqlInterpolations(sql)) {
    out += sql.slice(cursor, slot.start) + repl(slot);
    cursor = slot.end;
  }
  return out + sql.slice(cursor);
}

/** The live-interpolation payload expressions (convenience over the spans). */
export function liveSqlInterpolationExprs(sql: string): string[] {
  return liveSqlInterpolations(sql).map((x) => x.expr);
}

/** Does the SQL body carry at least one LIVE `${...}` interpolation? */
export function sqlHasLiveInterpolation(sql: string): boolean {
  return liveSqlInterpolations(sql).length > 0;
}
