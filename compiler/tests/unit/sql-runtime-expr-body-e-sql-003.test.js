/**
 * E-SQL-003 — a `?{}` SQL template body that is a pure RUNTIME EXPRESSION
 * (no literal SQL text, only `${...}` interpolation) is a hard compile error.
 *
 * SPEC §8.1.1: "Developers SHALL NOT construct SQL strings dynamically in
 * JavaScript and pass them to `?{}`" and "The `?{}` template body SHALL remain a
 * literal string at compile time (E-SQL-003); fragment reuse is achieved via the
 * call graph, not via runtime template assembly." A runtime-assembled SQL string
 * (`?{`${sqlString}`}`) is an injection vector Bun.SQL cannot bind — the emitted
 * `_scrml_sql`${q}`` would bind the whole query text as a single parameter.
 *
 * The diagnostic fires in ast-builder's `case "sql"` — the common SQLNode
 * construction point reached by EVERY `?{}` shape (top-level, expression-position,
 * and let/const/state/return initializers). Detection (`sqlBodyIsRuntimeExpr`):
 * >=1 `${...}` interpolation AND no literal SQL text outside the interpolations.
 *
 * BOUNDARY (the E-ATTR-012 lesson — a false positive that hard-errors valid code
 * is worse than a non-firing diagnostic): a single literal (non-whitespace) SQL
 * char suppresses the error, so valid parameterized queries never false-fire.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

/**
 * Compile a `<program db=...>` whose server function returns the given inline
 * `?{...}` SQL block, and return the array of diagnostic codes from the
 * ast-build pass. The `q`/`id`/`name` params are function parameters (runtime
 * values) so the compiler cannot constant-fold the SQL body — E-SQL-003 keys off
 * the STRUCTURE of the template (literal-vs-interpolation), never a param value.
 */
function codesForSqlBlock(sqlBlock) {
  const src =
    `<program db="sqlite:./app.db">\n` +
    `\${ function loadRows(q, id, name, x, y, prefix, suffix, pattern) { return ${sqlBlock}.all() } }\n` +
    `</program>\n`;
  const bs = splitBlocks("/test/app.scrml", src);
  const { errors } = buildAST(bs);
  return (errors ?? []).map((e) => e.code);
}

/** As above, but returns the diagnostic MESSAGES (S290 — the message must name
 *  the shape the author wrote; the two E-SQL-003 forms read differently). */
function messagesForSqlBlock(sqlBlock) {
  const src =
    `<program db="sqlite:./app.db">\n` +
    `\${ function loadRows(q, id, name, x, y, prefix, suffix, pattern) { return ${sqlBlock}.all() } }\n` +
    `</program>\n`;
  const bs = splitBlocks("/test/app.scrml", src);
  const { errors } = buildAST(bs);
  return (errors ?? []).map((e) => e.message ?? "");
}

// ---------------------------------------------------------------------------
// §A — MUST FIRE E-SQL-003 (pure runtime-expression bodies, no literal SQL)
// ---------------------------------------------------------------------------

describe("§A: runtime-expression `?{}` bodies fire E-SQL-003", () => {
  test("§A.1 — `?{`${q}`}` (single interpolation, no literal SQL)", () => {
    expect(codesForSqlBlock("?{`${q}`}")).toContain("E-SQL-003");
  });

  test("§A.2 — `?{`${prefix}${suffix}`}` (multiple interpolations, no literal SQL)", () => {
    expect(codesForSqlBlock("?{`${prefix}${suffix}`}")).toContain("E-SQL-003");
  });

  test("§A.3 — whitespace-padded body `?{` ${q} `}` is still no-literal-SQL", () => {
    expect(codesForSqlBlock("?{` ${q} `}")).toContain("E-SQL-003");
  });

  test("§A.4 — whitespace BETWEEN interpolations `?{`${prefix} ${suffix}`}` is still no-literal-SQL", () => {
    expect(codesForSqlBlock("?{`${prefix} ${suffix}`}")).toContain("E-SQL-003");
  });

  test("§A.5 — nested-brace interpolation `?{`${loadRows({q})}`}` skips whole ${...} (no literal SQL)", () => {
    // The brace-depth scan consumes the nested `{q}` inside the interpolation,
    // so the body is recognized as pure-interpolation and fires (no false-negative).
    expect(codesForSqlBlock("?{`${loadRows({q})}`}")).toContain("E-SQL-003");
  });

  // --- comment-cloak hardening (S264 adversarial-review item 1) ---
  // A leading/trailing SQL comment is NOT literal SQL — it does not make the body
  // validatable or param-bindable, so a comment + all-interpolation body still
  // emits the runtime-assembled `_scrml_sql`…${q}`` injection vector and fires.

  test("§A.6 — `--` line-comment prefix then interpolation (real newline, no real SQL)", () => {
    // The `\n` here is a REAL newline in the JS string; the SQL line-comment ends
    // at it, so the following `${q}` is live interpolation with no literal SQL.
    expect(codesForSqlBlock("?{`-- note\n${q}`}")).toContain("E-SQL-003");
  });

  test("§A.7 — slash-star block-comment prefix then interpolation (no real SQL)", () => {
    expect(codesForSqlBlock("?{`/* c */${q}`}")).toContain("E-SQL-003");
  });

  test("§A.8 — interpolation then trailing `--` comment (no real SQL)", () => {
    expect(codesForSqlBlock("?{`${q} -- trailing`}")).toContain("E-SQL-003");
  });
});

// ---------------------------------------------------------------------------
// §B — MUST NOT FIRE E-SQL-003 (valid parameterized / literal queries)
// ---------------------------------------------------------------------------

describe("§B: valid parameterized `?{}` bodies do NOT fire E-SQL-003", () => {
  test("§B.1 — literal SQL + one bound param", () => {
    expect(codesForSqlBlock("?{`SELECT * FROM users WHERE id = ${id}`}")).not.toContain("E-SQL-003");
  });

  test("§B.2 — literal SQL + multiple bound params", () => {
    expect(codesForSqlBlock("?{`SELECT * FROM users WHERE id = ${id} AND name = ${name}`}")).not.toContain("E-SQL-003");
  });

  test("§B.3 — params at various positions (INSERT VALUES)", () => {
    expect(codesForSqlBlock("?{`INSERT INTO t (a,b) VALUES (${x}, ${y})`}")).not.toContain("E-SQL-003");
  });

  test("§B.4 — pure literal, no interpolation", () => {
    expect(codesForSqlBlock("?{`SELECT 1`}")).not.toContain("E-SQL-003");
  });

  test("§B.5 — trailing param (LIKE ${pattern})", () => {
    expect(codesForSqlBlock("?{`SELECT * FROM users WHERE name LIKE ${pattern}`}")).not.toContain("E-SQL-003");
  });

  test("§B.6 — leading literal keyword before the only interpolation", () => {
    // A single non-whitespace literal char is enough to mark it a real query.
    expect(codesForSqlBlock("?{`SELECT ${x}`}")).not.toContain("E-SQL-003");
  });

  // --- comment-cloak hardening regression guard (S264 review item 1) ---
  // Comment-stripping MUST NOT cause an over-fire: a valid query always carries
  // non-comment SQL keywords (SELECT/INSERT/...) that survive stripping.

  test("§B.7 — pure literal query WITH a trailing `--` comment stays clean", () => {
    expect(codesForSqlBlock("?{`SELECT 1 -- get one row`}")).not.toContain("E-SQL-003");
  });

  test("§B.8 — block-comment + real parameterized query stays clean", () => {
    expect(codesForSqlBlock("?{`/* fetch */ SELECT id FROM users WHERE id = ${id}`}")).not.toContain("E-SQL-003");
  });
});

// ---------------------------------------------------------------------------
// §C — the BARE-IDENTIFIER body (S290). Adopter-reported via scrml-site.
//
// The detector above keyed on `interpolations >= 1`, so `?{q}` — zero
// interpolations — fell through as literal SQL TEXT and was emitted verbatim
// as ``_scrml_sql`q```: the identifier as the query, exit 0, no diagnostic,
// failing only at runtime against the database. §8.4 has said
// "Developers SHALL NOT construct SQL strings dynamically in JavaScript and
// pass them to `?{}`" the whole time, so this is a conformance restoration.
// ---------------------------------------------------------------------------

describe("§C E-SQL-003 — bare-identifier `?{}` body (S290)", () => {
  test("§C.1 — the reported shape `?{q}` fires", () => {
    expect(codesForSqlBlock("?{q}")).toContain("E-SQL-003");
  });

  test("§C.2 — any identifier shape fires (the class, not the one name)", () => {
    for (const id of ["q", "sqlText", "_q", "$q", "QUERY2", "myQuery"]) {
      expect(codesForSqlBlock(`?{${id}}`)).toContain("E-SQL-003");
    }
  });

  test("§C.3 — whitespace and comments around the identifier do not cloak it", () => {
    expect(codesForSqlBlock("?{  q  }")).toContain("E-SQL-003");
    expect(codesForSqlBlock("?{-- pick one\nq}")).toContain("E-SQL-003");
    expect(codesForSqlBlock("?{/* pick */ q}")).toContain("E-SQL-003");
  });

  test("§C.4 — SINGLE-WORD SQL STATEMENTS still compile (the allowlist)", () => {
    for (const stmt of ["VACUUM", "ANALYZE", "BEGIN", "COMMIT", "END", "ROLLBACK", "CHECKPOINT"]) {
      expect(codesForSqlBlock(`?{${stmt}}`)).not.toContain("E-SQL-003");
      expect(codesForSqlBlock(`?{${stmt.toLowerCase()}}`)).not.toContain("E-SQL-003");
    }
  });

  test("§C.5 — a real multi-token query is never mistaken for an identifier", () => {
    for (const q of ["SELECT 1", "select * from t", "DELETE FROM t", "PRAGMA foreign_keys = ON"]) {
      expect(codesForSqlBlock(`?{${q}}`)).not.toContain("E-SQL-003");
    }
  });

  test("§C.6 — the message names the shape the author actually wrote", () => {
    const bare = messagesForSqlBlock("?{q}").join(" ");
    expect(bare).toContain("bare identifier");
    expect(bare).toContain("does not read the variable");
    // and the interpolation form keeps its own, different lead
    const interp = messagesForSqlBlock("?{`${q}`}").join(" ");
    expect(interp).toContain("runtime expression");
    expect(interp).not.toContain("bare identifier");
  });
});
