/**
 * gh264-onmount-nested-await-and-dropped-stmt.test.js — GH #264, end-to-end.
 *
 * Adopter (DanceCard) report, verified against `ef8ff508`. Two defects in the
 * `on mount { … }` codegen that GH #237 (`88f9745e`) did not cover:
 *
 *   Defect 2 — a MULTI-statement mount body whose first statement is a complete
 *     expression silently DROPS every statement after the first (0 diagnostics).
 *     Reproduces with NO server call at all — a pure-client body loses its tail.
 *
 *   Defect 1 — a server-fn call in a NON-top position (argument / condition /
 *     template interpolation) is left un-awaited, binding a pending Promise
 *     (fail-OPEN: the `==` is always false, a guard never denies, a cookie
 *     attribute becomes `[object Promise]`).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "gh264-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function clientJsOf(result, name) {
  for (const [k, v] of result.outputs) {
    if (v.clientJs && k.replace(/\\/g, "/").endsWith(`${name}.scrml`)) return v.clientJs;
  }
  // Fallback: the entry file's client output (first with a mount scope).
  for (const [, v] of result.outputs) if (v.clientJs && v.clientJs.includes("§6.7.1a")) return v.clientJs;
  return "";
}

describe("GH #264 Defect 2 — multi-statement mount body (db-free)", () => {
  test("a pure-client mount body emits ALL of its statements, not just the first", () => {
    const f = join(TMP, "pure.scrml");
    writeFileSync(f, `<page>\n  <a> = 0\n  <b> = 0\n  on mount {\n    @a = 1\n    @b = 2\n  }\n  <p>\${@a} \${@b}</p>\n</page>\n`);
    const r = compileScrml({ inputFiles: [f], outputDir: join(TMP, "pure.dist"), write: false, log: () => {} });
    expect((r.errors || []).filter(e => e.severity == null || e.severity === "error")).toHaveLength(0);
    const js = clientJsOf(r, "pure");
    // The mount WRITES (`("a", 1)` / `("b", 2)`) are distinct from the init
    // defaults (`("a", 0)` / `("b", 0)`). Pre-fix, `("b", 2)` was dropped.
    expect(js).toContain(`_scrml_cs_reactive_set("a", 1)`);
    expect(js).toContain(`_scrml_cs_reactive_set("b", 2)`);
  });
});

describe("GH #264 Defect 1 — nested server-fn calls are awaited (end-to-end)", () => {
  let dbPath;
  beforeAll(() => {
    mkdirSync(join(TMP, "models"), { recursive: true });
    writeFileSync(join(TMP, "models", "m.scrml"),
      `\${\n    export fn tag() { return "x" }\n    export fn rolePatron() { return "patron" }\n    export fn sessionTtlSeconds() { return 604800 }\n}\n`);
    dbPath = join(TMP, "t.db");
    const db = new Database(dbPath);
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)");
    db.run("INSERT INTO t (id, n) VALUES (1, 42)");
    db.close();
  });

  function compileCase(name, mountBody, imports, cells) {
    const f = join(TMP, `${name}.scrml`);
    writeFileSync(f,
      `<page>\n  <db src="./t.db" tables="t">\n    \${\n        import { ${imports} } from './models/m.scrml'\n${cells}\n        export function serverRead() {\n            const row = ?{\`SELECT n FROM t WHERE id = 1\`}.get()\n            return ${imports.split(",")[0].trim()}() + row.n\n        }\n        fn eq(a, b) { return a == b }\n        fn checkRole(u, r) { return u == r }\n        on mount {\n${mountBody}\n        }\n    }\n    <p>done</p>\n  </>\n</page>\n`);
    const r = compileScrml({ inputFiles: [f], outputDir: join(TMP, `${name}.dist`), write: false, log: () => {} });
    expect((r.errors || []).filter(e => e.severity == null || e.severity === "error")).toHaveLength(0);
    return clientJsOf(r, name);
  }

  test("Case A — server call in ARGUMENT position is awaited", () => {
    const js = compileCase("caseA", `            @msg = eq("x", tag())`, "tag", "        <msg> = \"\"");
    expect(js).toMatch(/\bawait tag\(\)/);
  });

  test("Case B — the dropped statement returns AND its nested call is awaited", () => {
    const js = compileCase("caseB", `            @n = serverRead()\n            @msg = eq("x", tag())`, "tag", "        <msg> = \"\"\n        <n> = 0");
    expect(js).toMatch(/\bawait tag\(\)/);                                    // Defect 1: nested await
    expect(js).toMatch(/_scrml_cs_reactive_set\("msg", _scrml_eq_\d+\(/);     // Defect 2: statement not dropped
    // statement 1's DIRECT reactive-server write keeps emit-client's IIFE lift
    // (it must NOT be double-awaited by the nested pass).
    expect(js).toMatch(/\(async \(\) => _scrml_cs_reactive_set\("n", await _scrml_fetch_serverRead_\d+\(\)\)\)/);
  });

  test("Case C — server call in an `if` CONDITION is awaited", () => {
    const js = compileCase("caseC", `            if (!checkRole("patron", rolePatron())) {\n                @redir = "/"\n            }`, "rolePatron", "        <redir> = \"\"");
    expect(js).toMatch(/await rolePatron\(\)/);
  });

  test("Case D — server call in a template INTERPOLATION is awaited", () => {
    const js = compileCase("caseD", "            @cookie = `Max-Age=${sessionTtlSeconds()}`", "sessionTtlSeconds", "        <cookie> = \"\"");
    expect(js).toMatch(/\$\{await sessionTtlSeconds\(\)\}/);
  });
});
