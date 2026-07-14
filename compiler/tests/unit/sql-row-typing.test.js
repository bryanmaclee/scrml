/**
 * sql-row-typing.test.js — typed SQL projection rows (SPEC §14.8.7, Tranche 1).
 *
 * End-to-end (BS -> AST -> PA -> TS) coverage of the read-site row typing wired
 * into type-system.ts `resolveSqlRowType`:
 *   - a single-table / qualified-JOIN SELECT with an explicit column list types
 *     the bound variable as a projection row (no spurious diagnostics);
 *   - graceful degradation fires the info-level W-SQL-ROW-UNTYPED lint
 *     (computed column / `SELECT *` over a JOIN / CTE) WITHOUT breaking the build.
 *
 * The row is typed from the generated (full) table view. Every `?{}`-bearing
 * function auto-escalates to server (§12.2 Trigger 1), so there is no
 * client-boundary `?{}` context — the full/client view discrimination and the
 * projection-side protected-column check are DEFERRED to a return-boundary
 * (server-fn-return / data-flow) follow-on. Plain `function` is used throughout;
 * the `?{}` inside escalates it to server via RI.
 *
 * The shadow DB is built from CREATE TABLE statements harvested from a `?{}`
 * block (PA shadow-DB path) so the test needs no on-disk .db file.
 *
 * DIAGNOSTIC-STREAM PARTITION (memory: feedback_diagnostic_stream_partition):
 * W-SQL-ROW-UNTYPED is INFO-level -> it partitions to result.warnings, NOT
 * result.errors. The helper below searches BOTH streams so an assertion on a
 * W-/I- code in the wrong stream does not silently pass.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, tag) {
  const t = tag ?? `tsqlrow-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_tsqlrow_${t}`);
  const tmpInput = resolve(tmpDir, `${t}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

/** Cross-stream diagnostic lookup (handles the info/warning partition). */
function hasCode({ errors, warnings }, code) {
  return [...errors, ...warnings].some((d) => d.code === code);
}

// A self-contained `< db>` block: the CREATE TABLE in a startup `?{}` block
// builds the shadow schema; `users` has a protected `passwordHash`.
const DB_HEADER = `<program db="./shadow.db">
<db src="./shadow.db" protect="passwordHash" tables="users">
  \${
    function _bootstrap() {
      ?{\`CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        createdAt TEXT
      )\`}.run()
    }
`;

const DB_FOOTER = `  }
</>
</>`;

describe("typed SQL projection rows — read-site typing (§14.8.7)", () => {
  test("explicit single-table SELECT types the row with no spurious diagnostics", () => {
    const src = DB_HEADER + `
    function loadUser(uid) {
      const u = ?{\`SELECT id, email FROM users WHERE id = \${uid}\`}.get()
      return u.email
    }
` + DB_FOOTER;
    const r = compileSource(src, "explicit");
    // No spurious row-untyped lint — every column resolved.
    expect(hasCode(r, "W-SQL-ROW-UNTYPED")).toBe(false);
    // No protect error — the read-site row is typed from the generated (full)
    // table view; projection-side protect checking is deferred.
    expect(hasCode(r, "E-PROTECT-001")).toBe(false);
  });

  test("projection of a protected column types from the full view (no E-PROTECT-001)", () => {
    const src = DB_HEADER + `
    function verify(uid) {
      const u = ?{\`SELECT id, passwordHash FROM users WHERE id = \${uid}\`}.get()
      return u.passwordHash
    }
` + DB_FOOTER;
    const r = compileSource(src, "full-view");
    // The full/client view discrimination + projection-side E-PROTECT-001 are
    // deferred — the column resolves from the generated full view, no error.
    expect(hasCode(r, "E-PROTECT-001")).toBe(false);
    expect(hasCode(r, "W-SQL-ROW-UNTYPED")).toBe(false);
  });

  test("computed column degrades that ONE field — W-SQL-ROW-UNTYPED (info)", () => {
    const src = DB_HEADER + `
    function counts() {
      const rows = ?{\`SELECT id, (SELECT COUNT(1) FROM users) AS n FROM users\`}.all()
      return rows
    }
` + DB_FOOTER;
    const r = compileSource(src, "computed");
    expect(hasCode(r, "W-SQL-ROW-UNTYPED")).toBe(true);
    // INFO partition: the lint lands in result.warnings, NOT result.errors.
    expect(r.warnings.some((w) => w.code === "W-SQL-ROW-UNTYPED")).toBe(true);
    expect(r.errors.some((e) => e.code === "W-SQL-ROW-UNTYPED")).toBe(false);
  });

  test("CTE query degrades the whole row — W-SQL-ROW-UNTYPED (info), build survives", () => {
    const src = DB_HEADER + `
    function viaCte() {
      const rows = ?{\`WITH active AS (SELECT id FROM users) SELECT id FROM active\`}.all()
      return rows
    }
` + DB_FOOTER;
    const r = compileSource(src, "cte");
    expect(hasCode(r, "W-SQL-ROW-UNTYPED")).toBe(true);
    // Build is not broken by the deferred long tail.
    expect(r.errors.some((e) => e.code && e.code.startsWith("E-"))).toBe(false);
  });
});
