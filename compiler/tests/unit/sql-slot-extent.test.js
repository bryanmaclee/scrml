/**
 * S456 fix round F1 — ONE reader of a `?{}` `${…}` slot's extent (codegen/sql-lex.ts
 * `jsInterpolationEnd` via `liveSqlInterpolations`), read the way JavaScript reads the emitted
 * tagged template; and the codegen guard re-reads the emitted driver call with acorn.
 *
 * The S239 review (CONFIRMED, PA-reproduced on main d2bc3a065): the program-body token walk and
 * the emitter brace-counted a slot, so `${ x + '{' }` ended at a later `}` inside a SQL comment —
 * one slot to the compiler, while JS bound `x + '{'` and sent `); CREATE TABLE leak …` /
 * `); DELETE FROM invoices` as SQL. Both compiled clean (0 diagnostics) and ran on Bun.SQL sqlite
 * (the leak table was created; every invoice row deleted under `.acrossTenants()`).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";
import { compileScrml } from "../../src/api.js";
import { liveSqlInterpolations, jsInterpolationEnd, replaceLiveSqlInterpolations } from "../../src/codegen/sql-lex.ts";
import { programStatementCount, programStatementVerdicts } from "../../src/schema-differ.js";
import { judgeDriverCall } from "../../src/codegen/sql-one-statement-guard.ts";
import { sqlSkeleton } from "../../src/codegen/protect-flow.ts";

const BT = "`";

function compileToServer(source) {
  const dir = mkdtempSync(join(tmpdir(), "s456-slot-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, gather: true, log: () => {} });
    const codes = [...new Set((r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code))];
    let serverJs = "";
    for (const out of r.outputs?.values() ?? []) if (out?.serverJs) serverJs += out.serverJs;
    return { codes, serverJs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const app = (q) => `<program db="./app.db">
  <schema>
    notes {
      id: integer primary key
      v: text
    }
    invoices {
      id: integer primary key
      tenant_id: text not null
      amount: real
    }
  </schema>
  \${
    function f(x) {
      ${q}
      return 1
    }
  }
  <button onclick=\${ f("a") }>s</button>
</program>`;

describe("jsInterpolationEnd / liveSqlInterpolations — the slot ends where JavaScript ends it", () => {
  const spans = (sql) => liveSqlInterpolations(sql).map((s) => sql.slice(s.start, s.end));
  test("a brace inside a JS string, template literal, comment or regex does not count", () => {
    expect(spans("VALUES (${ x + '{' }); X /* } */")).toEqual(["${ x + '{' }"]);
    expect(spans('VALUES (${ "}" + y }) , z')).toEqual(['${ "}" + y }']);
    expect(spans('VALUES (${ `a${ "}" }b` })')).toEqual(['${ `a${ "}" }b` }']);
    expect(spans("VALUES (${ a /* } */ })")).toEqual(["${ a /* } */ }"]);
    expect(spans("VALUES (${ /}/.test(a) })")).toEqual(["${ /}/.test(a) }"]);
    expect(spans("VALUES (${ f({ a: 1 }) }, ${ b })")).toEqual(["${ f({ a: 1 }) }", "${ b }"]);
    expect(spans("VALUES (${ a / b }) /* } */")).toEqual(["${ a / b }"]);
  });
  test("the `${ \"{\" } … ${ \"}\" }` pair is TWO slots (the r3 C3 shape), with SQL between", () => {
    const sql = 'SELECT id, ${ "{" } AS a, passwordHash, ${ "}" } AS b FROM users';
    expect(spans(sql)).toEqual(['${ "{" }', '${ "}" }']);
  });
  test("an unterminated slot runs to the end of the body", () => {
    expect(jsInterpolationEnd("x ${ 'a }", 2)).toBe(-1);
    expect(liveSqlInterpolations("x ${ 'a }")[0].end).toBe(9);
  });
  test("replaceLiveSqlInterpolations / sqlSkeleton use the same extents", () => {
    expect(replaceLiveSqlInterpolations("A ${ x + '{' } B /* } */", () => "?")).toBe("A ? B /* } */");
    expect(sqlSkeleton("A ${ x + '{' } B")).toBe("A \u0000 B");
  });
});

describe("the program-body token walk takes its slot extents from the emitter", () => {
  test("the F1 shapes are TWO statements, and the second is read", () => {
    const create = "INSERT INTO notes (v) VALUES (${ x + '{' }); CREATE TABLE leak (tenant_id text, secret text) /* } */";
    expect(programStatementCount(create).statements).toBe(2);
    const verdicts = programStatementVerdicts(create, { dialect: "sqlite" });
    expect(verdicts.map((v) => v.lead)).toEqual(["INSERT", "CREATE"]);
    expect(programStatementCount("INSERT INTO notes (v) VALUES (${ x + '{' }); DELETE FROM invoices /* } */").statements).toBe(2);
  });
  test("a single statement whose slot holds a `{` in a string is ONE readable statement", () => {
    const r = programStatementCount("INSERT INTO notes (v) VALUES (${ x + '{' })");
    expect(r.unreadable).toBe(null);
    expect(r.statements).toBe(1);
  });
});

describe("compile + run on Bun.SQL sqlite (the reviewer's shapes)", () => {
  const runEmitted = async (serverJs, setup) => {
    const dir = mkdtempSync(join(tmpdir(), "s456-slot-db-"));
    const db = new SQL(`sqlite://${join(dir, "app.db")}`);
    try {
      await db.unsafe("CREATE TABLE notes (id integer primary key, v text)");
      await db.unsafe("CREATE TABLE invoices (id integer primary key, tenant_id text, amount real)");
      await db.unsafe("INSERT INTO invoices (tenant_id, amount) VALUES ('A', 1), ('B', 2)");
      const line = serverJs.split("\n").find((l) => /notes \(v\)|E-SQL-/.test(l)) ?? "";
      const m = /(await _scrml_sql`[^]*?`)|\(\(\)=>\{throw[^]*?\}\)\(\)/.exec(line);
      expect(m).not.toBe(null);
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      let threw = null;
      try { await new AsyncFunction("_scrml_sql", "x", `return ${m[0]};`)(db, "a"); } catch (e) { threw = String(e.message); }
      const leak = (await db.unsafe("SELECT count(*) AS n FROM sqlite_master WHERE name = 'leak'"))[0].n;
      const invoices = (await db.unsafe("SELECT count(*) AS n FROM invoices"))[0].n;
      const notes = (await db.unsafe("SELECT v FROM notes")).map((r) => r.v);
      return { threw, leak, invoices, notes };
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  test("`…VALUES (${ x + '{' }); CREATE TABLE leak (tenant_id …) /* } */` — refused; the emitted site creates nothing", async () => {
    const r = compileToServer(app(`?{${BT}INSERT INTO notes (v) VALUES (\${ x + '{' }); CREATE TABLE leak (tenant_id text, secret text) /* } */${BT}}.run()`));
    expect(r.codes).toContain("E-SQL-MULTIPLE-STATEMENTS");
    expect(r.codes).toContain("E-TENANT-UNDECLARED");
    const run = await runEmitted(r.serverJs);
    expect(run.threw).toContain("E-SQL-MULTIPLE-STATEMENTS");
    expect(run.leak).toBe(0);
  });
  test("`…; DELETE FROM invoices /* } */` with `.acrossTenants()` — refused; every invoice survives", async () => {
    const r = compileToServer(app(`?{${BT}INSERT INTO notes (v) VALUES (\${ x + '{' }); DELETE FROM invoices /* } */${BT}}.acrossTenants().run()`));
    expect(r.codes).toContain("E-SQL-MULTIPLE-STATEMENTS");
    const run = await runEmitted(r.serverJs);
    expect(run.threw).toContain("E-SQL-MULTIPLE-STATEMENTS");
    expect(run.invoices).toBe(2);
  });
  test("control: the single statement with `{` in the slot's string compiles clean and binds `a{`", async () => {
    const r = compileToServer(app(`?{${BT}INSERT INTO notes (v) VALUES (\${ x + '{' })${BT}}.run()`));
    expect(r.codes).toEqual([]);
    const run = await runEmitted(r.serverJs);
    expect(run.threw).toBe(null);
    expect(run.notes).toEqual(["a{"]);
  });
});

describe("judgeDriverCall — the emitted call read by acorn", () => {
  test("a tagged template whose quasis equal the compiler's segments, one statement → ok", () => {
    expect(judgeDriverCall("_scrml_sql`SELECT ${x} AS a`", ["SELECT ", " AS a"])).toBe("ok");
    expect(judgeDriverCall("_scrml_sql`SELECT 1;`", ["SELECT 1;"])).toBe("ok");
  });
  test("quasis that differ from the segments → text-not-read (the F1 class, caught at the driver)", () => {
    // The compiler read ONE segment (no slot); JS reads a slot and sends `); DELETE …` as SQL.
    expect(judgeDriverCall("_scrml_sql`A ${ x + '{' }); DELETE FROM t /* } */`", ["A ${ x + '{' }); DELETE FROM t /* } */"])).toBe("text-not-read");
  });
  test("CRLF: JS cooks a template's CR LF to LF — a CRLF body is the same SQL (PR #1335 Windows CI regression)", () => {
    // conformance ssr-auth-scoped-commented-currentuser-not-seeded on a CRLF checkout: an inert slot in a
    // `--` comment ending in CR LF. The compiler's segment keeps the CR; the cooked quasi does not.
    const seg = "SELECT * FROM posts\r\n  -- WHERE user_id = ${@currentUser.id}\r\n";
    const call = "_scrml_sql`" + seg.replace(/\$\{/g, "\\${") + "`";
    expect(judgeDriverCall(call, [seg])).toBe("ok");
    // A LONE CR is cooked to LF too, but no compiler reader ends a line there → still refused.
    const lone = "SELECT 1 -- c\r, secret FROM t";
    expect(judgeDriverCall("_scrml_sql`" + lone + "`", [lone])).toBe("text-not-read");
  });
  test("CRLF and LF sources compile to the same diagnostics and the same SQL (the conformance case)", () => {
    const src = `<program db="sqlite:./app.db" auth="required">
<schema>
  ?{${BT}CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT)${BT}}
</schema>
\${
  <posts server> = ?{${BT}SELECT * FROM posts
  -- WHERE user_id = \${@currentUser.id}
${BT}}.all()
}
<main><ul><each in=@posts key=@.id as p><li>\${p.body}</li></each></ul></main>
</program>
`;
    const lf = compileToServer(src);
    const crlf = compileToServer(src.replace(/\n/g, "\r\n"));
    expect(lf.codes).toEqual([]);
    expect(crlf.codes).toEqual([]);
    const sqlLine = (js) => js.split(/\r?\n/).find((l) => l.includes("_scrml_sql`SELECT * FROM posts")) ?? "";
    expect(sqlLine(crlf.serverJs)).not.toBe("");
    expect(crlf.serverJs).not.toContain("E-SQL-001");
  });
  test("a multi-statement tagged template or `unsafe` string → multiple-statements", () => {
    expect(judgeDriverCall("_scrml_sql`INSERT INTO t VALUES (${x}); DELETE FROM t`", ["INSERT INTO t VALUES (", "); DELETE FROM t"])).toBe("multiple-statements");
    expect(judgeDriverCall('_scrml_sql.unsafe("SELECT 1; SELECT 2")', null)).toBe("multiple-statements");
    expect(judgeDriverCall('_scrml_sql.unsafe("SELECT 1;")', null)).toBe("ok");
  });
});
