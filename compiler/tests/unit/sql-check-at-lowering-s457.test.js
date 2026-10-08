/**
 * S457 — g-sql-checker-and-lowering-read-different-text-s457 (HIGH, security).
 *
 * The §14.8.10 item (1) program-body statement allow-list was decided by the TENANT-SCHEMA stage
 * over RAW scrml text, while codegen lowered REWRITTEN text (the text path, after `@cell` →
 * `_scrml_body["cell"]`), a STRUCTURAL parse (a server template-literal slot), or text whose `?{`
 * the parser had hidden behind a marker (`<#name>` in the same template). Each shape compiled at
 * exit 0 and its `DROP TABLE` ran on SQLite. The allow-list is now ALSO decided at every lowering,
 * on the SQL text the emitted driver call sends (codegen/sql-one-statement-guard.ts
 * `judgeDriverCallDetail`): a site lowered is a site checked.
 *
 * Also: g-sql-site-locator-nested-paren-quadratic-s457 — `sqlSitesInExpressionText` was quadratic
 * on deeply nested `((((x) / x) / x) …`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";
import { compileScrml } from "../../src/api.js";
import {
  judgeDriverCall,
  judgeDriverCallDetail,
  programStatementRefusal,
  setProgramBodySqlPolicy,
} from "../../src/codegen/sql-one-statement-guard.ts";
import { rewriteSqlRefs } from "../../src/codegen/rewrite.ts";
import { sqlSitesInExpressionText } from "../../src/sql-in-expression-text.ts";

const BT = "`";

/** Compile one server function body `stmt` (with `decl` before it) in a database program. */
function compileFn(stmt, decl = "") {
  const dir = mkdtempSync(join(tmpdir(), "s457-lowering-"));
  try {
    const file = join(dir, "app.scrml");
    const src = `<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      v: text
    }
  </schema>
  \${
    ${decl}
    function f(x) {
      ${stmt}
      return 1
    }
  }
  <button onclick=\${ f("a") }>s</button>
</program>`;
    writeFileSync(file, src);
    const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? ""));
    let serverJs = "";
    for (const out of r.outputs?.values() ?? []) if (out?.serverJs) serverJs += out.serverJs;
    return { errors, codes: [...new Set(errors.map((e) => e.code))], serverJs, src };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every driver call the server module makes that carries `word` in its SQL text. */
function driverCallsWith(serverJs, word) {
  const out = [];
  const re = /_scrml_sql(?:`[^`]*`|\.unsafe\("[^"]*")/g;
  let m;
  while ((m = re.exec(serverJs)) !== null) if (m[0].includes(word)) out.push(m[0]);
  return out;
}

/** Run the emitted `let a = …` line against a real Bun.SQL sqlite database; report what survived. */
async function execEmittedLine(serverJs, cell = "new") {
  const line = serverJs.split("\n").map((l) => l.trim()).find((l) => l.startsWith("let a ="));
  const dir = mkdtempSync(join(tmpdir(), "s457-exec-"));
  const db = new SQL(`sqlite://${join(dir, "app.db")}`);
  try {
    await db.unsafe("CREATE TABLE notes (id integer primary key, v text)");
    const fn = new Function("_scrml_sql", "_scrml_body", "_scrml_input_state_registry",
      `return (async () => { ${line} return a; })();`);
    let threw = null;
    try { await fn(db, { [cell]: 4 }, new Map([["x", "v"]])); } catch (e) { threw = String(e.message); }
    const tables = await db.unsafe("SELECT name FROM sqlite_master WHERE name = 'notes'");
    const dbs = await db.unsafe("PRAGMA database_list");
    return { notesPresent: tables.length === 1, attached: dbs.length, threw };
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const drop = `?{${BT}DROP TABLE notes${BT}}.run()`;
const shapes = {
  "F2 — a reactive cell before `/` (text path after @cell rewriting)": { stmt: `let a = ${BT}t \${ @new / ${drop} }${BT}`, decl: "@new = 4" },
  "F3 — an object literal before `/` (server template slot, parsed structurally)": { stmt: `let a = ${BT}t \${ { y: 1 } / ${drop} }${BT}` },
  "F4 — `<#name>` in the same template (the `?{` hidden behind a marker)": {
    stmt: `?{${BT}SELECT id FROM notes${BT}}.get()\n      let a = ${BT}t \${ ${drop} } \${ <#x> }${BT}`,
  },
};

describe("the three executed bypasses are refused at compile and send nothing", () => {
  for (const [name, { stmt, decl }] of Object.entries(shapes)) {
    test(name, async () => {
      const { codes, serverJs } = compileFn(stmt, decl);
      expect(codes).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
      expect(driverCallsWith(serverJs, "DROP")).toEqual([]);
      const run = await execEmittedLine(serverJs);
      expect(run.notesPresent).toBe(true);
      expect(run.threw).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
    });
  }

  test("every keyword-named cell before `/` (the regex-vs-division misread)", () => {
    for (const kw of ["in", "delete", "typeof", "void", "return", "await", "yield", "else", "finally", "throw", "instanceof", "do", "new"]) {
      const { codes, serverJs } = compileFn(`let a = ${BT}t \${ @${kw} / ${drop} }${BT}`, `@${kw} = 4`);
      expect({ kw, codes }).toEqual({ kw, codes: ["E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED"] });
      expect(driverCallsWith(serverJs, "DROP")).toEqual([]);
    }
  });

  test("the bare `.unsafe` form: `ATTACH DATABASE` is refused and attaches nothing", async () => {
    const { codes, serverJs } = compileFn(`let a = ${BT}t \${ @new / ?{${BT}ATTACH DATABASE 'x.db' AS y${BT}} }${BT}`, "@new = 4");
    expect(codes).toEqual(["E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED"]);
    expect(driverCallsWith(serverJs, "ATTACH")).toEqual([]);
    const run = await execEmittedLine(serverJs);
    expect(run.attached).toBe(1);
    expect(run.threw).toContain("E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
  });

  test("E-TENANT-UNDECLARED is enforced at the lowering too (a hidden CREATE TABLE … tenant_id)", () => {
    const { codes, serverJs } = compileFn(
      `let a = ${BT}t \${ @new / ?{${BT}CREATE TABLE leak (id integer, tenant_id text)${BT}}.run() }${BT}`, "@new = 4");
    expect(codes).toEqual(["E-TENANT-UNDECLARED"]);
    expect(driverCallsWith(serverJs, "CREATE TABLE leak")).toEqual([]);
    expect(serverJs).toContain("E-TENANT-UNDECLARED: this ?{} statement gives leak tenant data");
  });
});

describe("§8.1.2 at the lowering — a multi-statement body in F2/F3/F4 position is a COMPILE error (review nit a)", () => {
  const multi = `?{${BT}SELECT 1; DROP TABLE notes${BT}}.run()`;
  const multiShapes = {
    F2: { stmt: `let a = ${BT}t \${ @new / ${multi} }${BT}`, decl: "@new = 4" },
    F3: { stmt: `let a = ${BT}t \${ { y: 1 } / ${multi} }${BT}` },
    F4: { stmt: `?{${BT}SELECT id FROM notes${BT}}.get()\n      let a = ${BT}t \${ ${multi} } \${ <#x> }${BT}` },
  };
  for (const [name, { stmt, decl }] of Object.entries(multiShapes)) {
    test(`${name} × \`SELECT 1; DROP TABLE notes\` → E-SQL-MULTIPLE-STATEMENTS, nothing sent`, async () => {
      const { codes, serverJs, errors, src } = compileFn(stmt, decl);
      expect(codes).toEqual(["E-SQL-MULTIPLE-STATEMENTS"]);
      expect(src.slice(errors[0].span.start, errors[0].span.start + 2)).toBe("?{");
      expect(driverCallsWith(serverJs, "DROP")).toEqual([]);
      const run = await execEmittedLine(serverJs);
      expect(run.notesPresent).toBe(true);
      expect(run.threw).toContain("E-SQL-MULTIPLE-STATEMENTS");
    });
  }

  test("the bare `.unsafe` form too", () => {
    const { codes } = compileFn(`let a = ${BT}t \${ @new / ?{${BT}SELECT 1; DROP TABLE notes${BT}} }${BT}`, "@new = 4");
    expect(codes).toEqual(["E-SQL-MULTIPLE-STATEMENTS"]);
  });

  test("a body the stage already counted is reported ONCE (the stage's)", () => {
    const { errors } = compileFn(multi);
    const hits = errors.filter((e) => e.code === "E-SQL-MULTIPLE-STATEMENTS");
    expect(hits.length).toBe(1);
    expect(hits[0].stage).toBe("TENANT-SCHEMA");
  });

  test("`scrml compile` exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "s457-cli-"));
    try {
      const file = join(dir, "app.scrml");
      writeFileSync(file, compileFn(multiShapes.F2.stmt, multiShapes.F2.decl).src);
      const cli = join(import.meta.dir, "../../bin/scrml.js");
      const p = Bun.spawnSync(["bun", cli, "compile", file, "-o", join(dir, "out")], { stdout: "pipe", stderr: "pipe" });
      expect(p.exitCode).toBe(1);
      expect(p.stdout.toString() + p.stderr.toString()).toContain("E-SQL-MULTIPLE-STATEMENTS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database-less compilation is not governed at compile (the site still throws)", () => {
    setProgramBodySqlPolicy({ hasDatabase: false, tenantTables: [] });
    const out = rewriteSqlRefs("?{`SELECT 1; DROP TABLE notes`}.run()");
    setProgramBodySqlPolicy(null);
    expect(out).toContain("E-SQL-MULTIPLE-STATEMENTS");
    expect(out).not.toContain("_scrml_sql`");
  });
});

describe("diagnostics", () => {
  test("a lowering-only refusal points at the source `?{`, not the statement or emitted JS", () => {
    const { errors, src } = compileFn(`let a = ${BT}t \${ @new / ${drop} }${BT}`, "@new = 4");
    expect(errors.length).toBe(1);
    const sp = errors[0].span;
    expect(src.slice(sp.start, sp.start + 2)).toBe("?{");
    const lines = src.split("\n");
    expect(lines[sp.line - 1].slice(sp.col - 1, sp.col + 1)).toBe("?{");
  });

  test("a body the stage already refused is reported ONCE (the stage's report)", () => {
    const { errors } = compileFn(drop);
    const hits = errors.filter((e) => e.code === "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED");
    expect(hits.length).toBe(1);
    expect(hits[0].stage).toBe("TENANT-SCHEMA");
  });

  test("two different refused bodies are both named", () => {
    const { errors } = compileFn(
      `let a = ${BT}t \${ @new / ${drop} }${BT}\n      let b = ${BT}t \${ @new / ?{${BT}VACUUM${BT}}.run() }${BT}`, "@new = 4");
    expect(errors.filter((e) => e.code === "E-SQL-PROGRAM-STATEMENT-NOT-ADMITTED").length).toBe(2);
  });
});

describe("admitted shapes in the same positions still lower (no over-refusal)", () => {
  test("DML in a template slot after `@cell /` lowers to its driver call", () => {
    const { codes, serverJs } = compileFn(`let a = ${BT}t \${ @new / ?{${BT}SELECT id FROM notes WHERE v = \${x}${BT}}.get() }${BT}`, "@new = 4");
    expect(codes).toEqual([]);
    expect(serverJs).toContain("_scrml_sql`SELECT id FROM notes WHERE v = ${x}`");
  });
  test("a bare `.unsafe` with parameters is judged as the compiler's segments", () => {
    setProgramBodySqlPolicy({ hasDatabase: true, tenantTables: [] });
    const out = rewriteSqlRefs("?{`INSERT INTO notes (v) VALUES (${a}, ${b})`}");
    setProgramBodySqlPolicy(null);
    expect(out).toBe('await _scrml_sql.unsafe("INSERT INTO notes (v) VALUES (?1, ?2)", [(a), (b)])');
  });
});

describe("judgeDriverCallDetail — the SQL text the call sends", () => {
  afterEach(() => setProgramBodySqlPolicy(null));

  test("tagged template and .unsafe: refused off-list statements, admitted DML", () => {
    setProgramBodySqlPolicy({ hasDatabase: true, tenantTables: [] });
    expect(judgeDriverCall("_scrml_sql`DROP TABLE notes`", ["DROP TABLE notes"])).toBe("not-admitted");
    expect(judgeDriverCall('_scrml_sql.unsafe("ATTACH DATABASE \'x\' AS y")', ["ATTACH DATABASE 'x' AS y"])).toBe("not-admitted");
    expect(judgeDriverCall("_scrml_sql`SELECT ${x} AS a`", ["SELECT ", " AS a"])).toBe("ok");
    expect(judgeDriverCall('_scrml_sql.unsafe("SELECT ?1 AS a", [(x)])', ["SELECT ", " AS a"])).toBe("ok");
    // an author `?` is outside the closed lexical subset — refused, as the stage refuses it
    expect(judgeDriverCall('_scrml_sql.unsafe("SELECT * FROM t WHERE id = ?", [x])', ["SELECT * FROM t WHERE id = ?"])).toBe("not-admitted");
    const d = judgeDriverCallDetail("_scrml_sql`CREATE TABLE leak (tenant_id text)`", ["CREATE TABLE leak (tenant_id text)"]);
    expect(d.verdict).toBe("not-admitted");
    expect(d.refusal?.code).toBe("E-TENANT-UNDECLARED");
  });

  test("the compilation's tenant set: a declared tenant table may carry tenant_id", () => {
    setProgramBodySqlPolicy({ hasDatabase: true, tenantTables: ["Leak"] });
    expect(programStatementRefusal("CREATE TABLE leak (tenant_id text)")).toBe(null);
  });

  test("a database-less compilation is not governed; no policy fails closed", () => {
    setProgramBodySqlPolicy({ hasDatabase: false, tenantTables: [] });
    expect(judgeDriverCall("_scrml_sql`DROP TABLE notes`", ["DROP TABLE notes"])).toBe("ok");
    setProgramBodySqlPolicy(null);
    expect(judgeDriverCall("_scrml_sql`DROP TABLE notes`", ["DROP TABLE notes"])).toBe("not-admitted");
  });

  test("the one-statement rule still decides first", () => {
    expect(judgeDriverCall('_scrml_sql.unsafe("SELECT 1; DROP TABLE t")', null)).toBe("multiple-statements");
  });
});

describe("g-sql-site-locator-nested-paren-quadratic-s457 — linear on nested parentheses", () => {
  test("16k nesting levels locate the site in well under a second", () => {
    const n = 16000;
    const s = "(".repeat(n) + "x" + ") / x".repeat(n) + " / ?{`SELECT 1`}";
    const t0 = performance.now();
    const sites = sqlSitesInExpressionText(s);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(sites.length).toBe(1);
  });

  test("after `)` the answer still comes from what opened it", () => {
    // `if (c) /re/` — a regex holding the `?{` (not a site); `f(c) / ?{…}` — division (a site)
    expect(sqlSitesInExpressionText("if (c) /?{`SELECT 1`}/.test(x)")).toEqual([]);
    expect(sqlSitesInExpressionText("f(g(c)) / ?{`SELECT 1`}").length).toBe(1);
    expect(sqlSitesInExpressionText("while ((a) + (b)) /?{`X`}/.test(y)")).toEqual([]);
    expect(sqlSitesInExpressionText("x) / ?{`SELECT 1`}").length).toBe(1);
  });
});
