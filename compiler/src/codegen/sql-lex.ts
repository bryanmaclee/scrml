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

import { regexAllowedAfter } from "./code-segments.ts";

/** A JavaScript line terminator (ends a `//` comment; not allowed in a regex or a quoted string). */
const isJsLineTerminator = (c: string | undefined): boolean =>
  c === "\n" || c === "\r" || c === " " || c === " ";

/** Index just past the closing quote of the JS string literal opening at `at`; -1 if unterminated. */
function jsStringEnd(src: string, at: number): number {
  const q = src[at];
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === q) return i + 1;
    if (c === "\n" || c === "\r") return -1;
  }
  return -1;
}

/** Index just past the closing backtick of the JS template literal opening at `at`; -1 if unterminated. */
function jsTemplateEnd(src: string, at: number): number {
  let i = at + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      const e = jsInterpolationEnd(src, i);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    i++;
  }
  return -1;
}

/** Index just past the flags of the JS regular-expression literal opening at `at`; -1 if unterminated. */
function jsRegexEnd(src: string, at: number): number {
  let inClass = false;
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i];
    if (isJsLineTerminator(c)) return -1;
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "/") {
      let j = i + 1;
      while (j < src.length && /[A-Za-z]/.test(src[j]!)) j++;
      return j;
    }
  }
  return -1;
}

/**
 * Index just past the `}` that closes the `${` at `start` (the `$`), read the way
 * JavaScript reads a template-literal substitution: string literals (backslash escapes),
 * nested template literals (and their own `${…}`), `//` and block comments, and regular-
 * expression literals (`regexAllowedAfter`, the codegen's shared regex-vs-division reading)
 * are skipped, so a brace inside any of them does not count. -1 if unterminated.
 *
 * THE single reader of a `?{}` slot's extent (S456 fix round F1). `liveSqlInterpolations`
 * uses it, so the emitter (`rewrite.ts` `extractSqlParams`), the program-body checks (§8.1.2
 * and the §14.8.10 allow-list, via `schema-differ.js` `programSqlTokens`), the tenant subset
 * and the protect floor all split a body where the emitted tagged template's JS parse does.
 * The codegen guard (`sql-one-statement-guard.ts`) re-reads the emitted template with a real
 * JS parser and fails closed on any residual difference.
 */
export function jsInterpolationEnd(src: string, start: number): number {
  let i = start + 2;
  let depth = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') { i = jsStringEnd(src, i); if (i === -1) return -1; continue; }
    if (c === "`") { i = jsTemplateEnd(src, i); if (i === -1) return -1; continue; }
    if (c === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && !isJsLineTerminator(src[j])) j++;
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      if (e === -1) return -1;
      i = e + 2;
      continue;
    }
    if (c === "/" && regexAllowedAfter(src.slice(start + 2, i))) {
      i = jsRegexEnd(src, i);
      if (i === -1) return -1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
    i++;
  }
  return -1;
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
