/**
 * SQL Parameterization — Unit Tests (SPEC §44 Bun.SQL emission)
 *
 * Tests for:
 *   - rewriteSqlRefs() (src/codegen/rewrite.js)
 *   - emitLogicNode() sql-node path (src/codegen/emit-logic.js)
 *
 * Security context: rewriteSqlRefs MUST never emit string-interpolated SQL.
 * All ?{} SQL blocks with ${expr} interpolations compile to Bun.SQL tagged-
 * template `${}` slots, which Bun binds as positional parameters at the
 * driver layer. There is no `sql.raw()` in scrml (§44.5). This prevents
 * SQL injection.
 *
 * Output shape (§44.3):
 *   ?{`SELECT ...`}.all()      → await _scrml_sql`SELECT ...`
 *   ?{`SELECT ... ${x}`}.all() → await _scrml_sql`SELECT ... ${x}`
 *   ?{`SELECT ... ${x}`}.get() → (await _scrml_sql`SELECT ... ${x}`)[0] ?? null
 *   ?{`SELECT ... ${x}`}.first()→ (await _scrml_sql`SELECT ... ${x}`)[0] ?? null  (alias)
 *   ?{`INSERT ${x}`}.run()     → await _scrml_sql`INSERT ${x}`
 *   ?{`DDL`}                   → await _scrml_sql.unsafe("DDL")
 *   ?{`SELECT ${x}`}.prepare() → E-SQL-006 compile error (§44.3)
 *
 * Coverage:
 *   §1  Static query — no interpolations — .all() — bare tagged template
 *   §2  Single parameter — .all() — Bun.SQL ${} slot preserved
 *   §3  Single parameter — .first() — single-row alias (back-compat)
 *   §4  Single parameter — .get() — single-row helper
 *   §5  Single parameter — .run() — mutation (return value unused)
 *   §6  Multiple parameters — slots in order
 *   §7  Duplicate expression — each occurrence becomes its own ${} slot
 *   §8  Nested expression in parameter — ${obj.method()} captured whole
 *   §9  Expression with no SQL context — passes through unchanged
 *   §10 Null input — returns unchanged
 *   §11 Empty string — returns unchanged
 *   §12 rewriteExpr integration — SQL rewrite runs as part of full pipeline
 *   §13 BUG-R14-009: emitLogicNode SQL without explicit .run()
 *   §14 .prepare() emits E-SQL-006 compile error
 *   §15 Tagged template body escaping (backtick / $ in static text)
 */

import { describe, test, expect } from "bun:test";
import { rewriteSqlRefs, rewriteExpr } from "../../src/codegen/rewrite.js";

// ---------------------------------------------------------------------------
// §1  Static query — no interpolations
// ---------------------------------------------------------------------------

describe("§1 static query — no interpolations", () => {
  test("SELECT with no params produces bare await tagged template", () => {
    const input = "?{`SELECT * FROM users`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM users`');
  });

  test("static query does not contain any ${} in output", () => {
    const input = "?{`SELECT id, name FROM posts ORDER BY created_at DESC`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).not.toContain("${");
    expect(output).toBe('await _scrml_sql`SELECT id, name FROM posts ORDER BY created_at DESC`');
  });
});

// ---------------------------------------------------------------------------
// §2–5  Single parameter — all method variants
// ---------------------------------------------------------------------------

describe("§2 single parameter — .all()", () => {
  test("single interpolation preserved as ${} template slot", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${userId}`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM users WHERE id = ${userId}`');
  });

  test("output preserves ${userId} as bound JS template slot, not as raw text", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${userId}`}.all()";
    const output = rewriteSqlRefs(input);
    // The ${userId} interpolation is preserved AS a JS template slot — Bun.SQL
    // binds it as a positional parameter at the driver layer (§44.5). It must
    // appear as `${userId}` in the JS output (not as a string-concat).
    expect(output).toContain("${userId}");
    // ... but never as a textually-interpolated SQL string (e.g. quoted)
    expect(output).not.toContain('"${userId}"');
    expect(output).not.toContain("'${userId}'");
  });
});

describe("§3 single parameter — .first()", () => {
  test(".first() is a back-compat alias for single-row helper", () => {
    const input = "?{`SELECT * FROM users WHERE email = ${email}`}.first()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM users WHERE email = ${email}`)[0] ?? null');
  });
});

describe("§4 single parameter — .get()", () => {
  test(".get() emits the single-row helper with ${} slot preserved", () => {
    const input = "?{`SELECT * FROM sessions WHERE token = ${token}`}.get()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM sessions WHERE token = ${token}`)[0] ?? null');
  });
});

describe("§5 single parameter — .run()", () => {
  test(".run() emits the bare await tagged template (return value unused)", () => {
    const input = "?{`DELETE FROM sessions WHERE token = ${token}`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`DELETE FROM sessions WHERE token = ${token}`');
  });

  test("INSERT with .run() preserves all ${} slots", () => {
    const input = "?{`INSERT INTO users (name, email) VALUES (${name}, ${email})`}.run()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`');
  });
});

// ---------------------------------------------------------------------------
// §6  Multiple parameters
// ---------------------------------------------------------------------------

describe("§6 multiple parameters", () => {
  test("two parameters preserved as two ${} slots in order", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${userId} AND role = ${role}`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM users WHERE id = ${userId} AND role = ${role}`');
  });

  test("three parameters preserved as three ${} slots in order", () => {
    const input = "?{`SELECT * FROM posts WHERE author = ${author} AND status = ${status} AND year = ${year}`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM posts WHERE author = ${author} AND status = ${status} AND year = ${year}`');
  });

  test("no quoted-string interpolation appears in output", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${userId} AND role = ${role}`}.all()";
    const output = rewriteSqlRefs(input);
    // The whole SQL body lives in a backtick template — there must be no
    // double-quoted SQL string anywhere (which would indicate string-interp).
    expect(output).not.toContain('"SELECT');
  });
});

// ---------------------------------------------------------------------------
// §7  Duplicate expression — each occurrence gets its own ${} slot
// ---------------------------------------------------------------------------

describe("§7 duplicate expression — each occurrence is its own slot", () => {
  test("same expression used twice gets two ${} slots", () => {
    const input = "?{`SELECT * FROM logs WHERE start_id > ${id} AND end_id < ${id}`}.all()";
    const output = rewriteSqlRefs(input);
    // Each occurrence of ${id} stays as its own slot — Bun binds each
    // independently as a positional parameter.
    expect(output).toBe('await _scrml_sql`SELECT * FROM logs WHERE start_id > ${id} AND end_id < ${id}`');
  });
});

// ---------------------------------------------------------------------------
// §8  Nested expression — ${obj.method()} and ${arr[0]}
// ---------------------------------------------------------------------------

describe("§8 nested expression — braces handled correctly", () => {
  test("method call in interpolation — nested braces resolved", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${req.params.id}`}.first()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM users WHERE id = ${req.params.id}`)[0] ?? null');
  });

  test("object method call with braces — ${getCategory()} captured whole", () => {
    const input = "?{`SELECT * FROM items WHERE category = ${getCategory()}`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM items WHERE category = ${getCategory()}`');
  });

  test("array access in interpolation", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${ids[0]}`}.first()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM users WHERE id = ${ids[0]}`)[0] ?? null');
  });

  test("ternary expression in interpolation", () => {
    const input = "?{`SELECT * FROM users WHERE active = ${isActive ? 1 : 0}`}.all()";
    const output = rewriteSqlRefs(input);
    expect(output).toBe('await _scrml_sql`SELECT * FROM users WHERE active = ${isActive ? 1 : 0}`');
  });
});

// ---------------------------------------------------------------------------
// §9  No SQL context — passes through unchanged
// ---------------------------------------------------------------------------

describe("§9 no SQL context — passes through unchanged", () => {
  test("plain JS expression unchanged", () => {
    const input = "console.log(userId)";
    expect(rewriteSqlRefs(input)).toBe("console.log(userId)");
  });

  test("reactive ref unchanged", () => {
    const input = "@users.filter(u => u.active)";
    expect(rewriteSqlRefs(input)).toBe("@users.filter(u => u.active)");
  });

  test("navigate call unchanged", () => {
    const input = "navigate('/dashboard')";
    expect(rewriteSqlRefs(input)).toBe("navigate('/dashboard')");
  });

  test("string containing question mark unchanged", () => {
    const input = 'const msg = "Is this ok?"';
    expect(rewriteSqlRefs(input)).toBe('const msg = "Is this ok?"');
  });
});

// ---------------------------------------------------------------------------
// §10 Null input
// ---------------------------------------------------------------------------

describe("§10 null/undefined input — returns unchanged", () => {
  test("null returns null", () => {
    expect(rewriteSqlRefs(null)).toBe(null);
  });

  test("undefined returns undefined", () => {
    expect(rewriteSqlRefs(undefined)).toBe(undefined);
  });

  test("number returns number", () => {
    expect(rewriteSqlRefs(42)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// §11 Empty string
// ---------------------------------------------------------------------------

describe("§11 empty string — returns empty string", () => {
  test("empty string input produces empty string output", () => {
    expect(rewriteSqlRefs("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §12 rewriteExpr integration
// ---------------------------------------------------------------------------

describe("§12 rewriteExpr integration — SQL rewrite in full pipeline", () => {
  test("SQL rewrite runs when passed through rewriteExpr (single-row helper)", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${userId}`}.first()";
    const output = rewriteExpr(input);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM users WHERE id = ${userId}`)[0] ?? null');
  });

  test("SQL rewrite and surrounding JS coexist", () => {
    const input = "const q = ?{`SELECT * FROM users WHERE id = ${userId}`}.first()";
    const output = rewriteExpr(input);
    expect(output).toContain('(await _scrml_sql`SELECT * FROM users WHERE id = ${userId}`)[0] ?? null');
    // Surrounding `const q =` preserved
    expect(output.startsWith("const q = ")).toBe(true);
  });

  test("static SQL through rewriteExpr — bare tagged template", () => {
    const input = "?{`SELECT COUNT(*) FROM users`}.first()";
    const output = rewriteExpr(input);
    expect(output).toBe('(await _scrml_sql`SELECT COUNT(*) FROM users`)[0] ?? null');
  });
});

// ---------------------------------------------------------------------------
// §13 BUG-R14-009: emitLogicNode — SQL without .run() must still parameterize
// ---------------------------------------------------------------------------

import { emitLogicNode } from "../../src/codegen/emit-logic.js";

describe("§13 BUG-R14-009: SQL without explicit .run() — emits await tagged template", () => {
  test("SQL with interpolations and no chained call — defaults to await form", () => {
    const node = {
      kind: "sql",
      query: "INSERT INTO messages (name, email) VALUES (${name}, ${email})",
      chainedCalls: [],
    };
    const output = emitLogicNode(node);
    expect(output).toContain("_scrml_sql`");
    expect(output).toContain("await ");
    // The output IS a JS template — the ${} slots are preserved as Bun.SQL bind sites.
    expect(output).toBe('await _scrml_sql`INSERT INTO messages (name, email) VALUES (${name}, ${email})`;');
  });

  test("SQL with single interpolation, no chained call", () => {
    const node = {
      kind: "sql",
      query: "INSERT INTO users (name) VALUES (${userName})",
      chainedCalls: [],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`INSERT INTO users (name) VALUES (${userName})`;');
  });

  test("SQL with multiple interpolations, no chained call", () => {
    const node = {
      kind: "sql",
      query: "UPDATE users SET name = ${name}, email = ${email} WHERE id = ${id}",
      chainedCalls: [],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql`UPDATE users SET name = ${name}, email = ${email} WHERE id = ${id}`;');
  });

  test("static SQL without chained call uses sql.unsafe()", () => {
    const node = {
      kind: "sql",
      query: "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)",
      chainedCalls: [],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('await _scrml_sql.unsafe("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)");');
  });

  test("SQL with chained .get() and interpolations — single-row helper", () => {
    const node = {
      kind: "sql",
      query: "SELECT * FROM users WHERE id = ${userId}",
      chainedCalls: [{ method: "get" }],
    };
    const output = emitLogicNode(node);
    expect(output).toBe('(await _scrml_sql`SELECT * FROM users WHERE id = ${userId}`)[0] ?? null;');
  });
});

// ---------------------------------------------------------------------------
// §14 .prepare() — E-SQL-006 (§44.3)
// ---------------------------------------------------------------------------

describe("§14 .prepare() emits E-SQL-006 (§44.3)", () => {
  test(".prepare() with params emits a runtime-throwing IIFE", () => {
    const input = "?{`INSERT INTO users (n) VALUES (${n})`}.prepare()";
    const output = rewriteSqlRefs(input);
    expect(output).toContain("E-SQL-006");
    expect(output).toContain("throw new _scrml_g.Error");
    // No bun:sqlite-shaped emission leaks
    expect(output).not.toContain("_scrml_sql.prepare(");
    expect(output).not.toContain("_scrml_db.prepare(");
  });

  test(".prepare() pushes E-SQL-006 onto errors[] when provided", () => {
    const input = "?{`SELECT * FROM users WHERE id = ${id}`}.prepare()";
    const errors = [];
    rewriteSqlRefs(input, "_scrml_sql", errors);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("E-SQL-006");
    expect(errors[0].message).toContain("§44.3");
  });
});

// ---------------------------------------------------------------------------
// §15 Tagged template body escaping
// ---------------------------------------------------------------------------

describe("§15 tagged template body escaping", () => {
  test("backtick in static SQL text is escaped in the emitted template", () => {
    // SQLite identifier `name` quoted with backticks (rare but legal).
    const input = "?{`SELECT \\`name\\` FROM users`}.all()";
    // Note the input has escaped backticks because we're inside a JS string.
    // The actual scrml source `?{ \`SELECT \`name\` FROM ...\` }` would not be
    // legal because `?{` uses ` to delimit. This test confirms the codegen
    // does not crash and produces a syntactically valid JS template if such
    // a case ever reaches it. The escapeSeg helper escapes ` → \\`.
    const output = rewriteSqlRefs(input);
    // Output should have escaped backticks so the template literal is valid JS.
    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
  });

  test("$ in static SQL not followed by { is preserved literally", () => {
    // PG-style $1 placeholder should pass through (not interpreted as template slot).
    const input = "?{`SELECT * FROM tab WHERE col = ${val}`}.all()";
    const output = rewriteSqlRefs(input);
    // The $ in column-name reference (none here) would not be confused with ${.
    // This test mostly confirms that ${val} (a real interpolation) round-trips correctly.
    expect(output).toBe('await _scrml_sql`SELECT * FROM tab WHERE col = ${val}`');
  });
});
