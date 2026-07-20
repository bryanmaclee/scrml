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

    // scrml interpolation `${...}` in CODE context — the only live case. Brace
    // depth-matches (mirrors extractSqlParams' historical matcher, incl. nested
    // `{}` in the expr; a `}` inside a string in the expr is a known naive edge).
    if (c === "$" && sql[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "{") depth++;
        else if (sql[j] === "}") depth--;
        if (depth > 0) j++;
      }
      out.push({ expr: sql.slice(i + 2, j), start: i, end: j + 1 });
      i = j + 1;
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

/** The live-interpolation payload expressions (convenience over the spans). */
export function liveSqlInterpolationExprs(sql: string): string[] {
  return liveSqlInterpolations(sql).map((x) => x.expr);
}

/** Does the SQL body carry at least one LIVE `${...}` interpolation? */
export function sqlHasLiveInterpolation(sql: string): boolean {
  return liveSqlInterpolations(sql).length > 0;
}
