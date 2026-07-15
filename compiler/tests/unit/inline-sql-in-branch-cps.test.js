/**
 * inline-sql-in-branch-cps.test.js
 *
 * change-id: inline-sql-in-branch-cps-2026-06-01
 *
 * An inline `?{}` SQL buried inside a CONDITIONAL BRANCH (a JS-style `match`
 * arm body, or an `if`/`else` branch) of a CLIENT handler is a server-call
 * boundary exactly as a TOP-LEVEL `?{}` statement is (SPEC §12.2 Trigger 1/3;
 * §19.9.9.1 tier table — `server` = "own `?{}` SQL ... or other server-only
 * resource"). Before this fix the CPS body-split classifier
 * (`analyzeCPSEligibility` → `isServerTriggerStatement`) only inspected the
 * TOP-LEVEL statement grain and missed the nested `?{}`:
 *   - in a `match` arm  → the literal `?{...}` leaked into the client JS raw
 *                         → E-CG-006 + E-CODEGEN-INVALID-LOGIC;
 *   - in an `if` branch → whole-fn server-escalation won, and a following
 *                         `@cell = ...` write tripped E-RI-002.
 *
 * The fix recurses into control-flow nested bodies (skipping nested
 * `function-decl`) so the control-flow statement is classified server-tier and
 * routed through the SAME CPS split a server-function call in that position
 * already gets (P3): the client wrapper replaces it with a single server-stub
 * fetch; the server stub emits the control-flow + nested SQL; the surrounding
 * `@`-writes stay client-side as the continuation. The coupled match-stmt
 * server-emit half (server-mode `@cell` → `_scrml_body[...]`, async-wrapped
 * IIFE for nested `await _scrml_sql`) lands in emit-control-flow.ts.
 *
 * Coverage:
 *   §1  inline `?{}` in a `match` arm — CPS-split, no raw leak, client parses
 *   §2  inline `?{}` in an `if` branch — no spurious E-RI-002, CPS-split
 *   §3  loop body (`for`) with inline `?{}` — same boundary recognition
 *   §4  regression — top-level `?{}` (P1) still CPS-splits
 *   §5  regression — server-fn call in a `match` arm (P3) still compiles
 *   §6  regression — the named-function form (`function f(){ ?{} }` called
 *       from an arm) still compiles
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { tmpdir } from "node:os";

// OS-portable temp root (see note in s144 test): hardcoded "/tmp/…" is drive-less
// on Windows and mismatches the compiler's resolve()-to-absolute output key.
const TMP_ROOT = join(tmpdir(), "scrml-inline-sql-branch-tests");

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}
function compile(dir, fileName, source) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(dir, "dist"),
    write: false,
  });
  return { result, filePath };
}
function serverJsFor(result, filePath) {
  return result.outputs?.get(filePath)?.serverJs ?? "";
}
function clientJsFor(result, filePath) {
  return result.outputs?.get(filePath)?.clientJs ?? "";
}
function errorsByCode(result, code) {
  return (result.errors ?? []).filter((e) => e.code === code);
}
// The CG invalid-JS / security codes the fix must NOT produce.
function fatalCodes(result) {
  return (result.errors ?? []).map((e) => e.code);
}

// A SQLite `db=` lets the §19.9.6 default idempotency-store resolution emit a
// shadow table for the non-monotone (INSERT/UPDATE/DELETE) server batches —
// otherwise E-CPS-NONIDEM-NO-STORAGE fires (correct, but orthogonal to the
// boundary-recognition under test).
const DB_DECL = (dir) => `${join(dir, "todos.db")}`;

// ---------------------------------------------------------------------------
// §1 — inline ?{} in a `match` arm — the user's S152 repro shape
// ---------------------------------------------------------------------------

describe("§1 inline ?{} in a match arm → server-call boundary + client continuation", () => {
  const NAME = "match-arm";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT, done INTEGER)\`}
      <items> = []
      <draft> = ""
      function run(action: string, id: number) {
        match action {
          "add" => {
            ?{\`INSERT INTO todos (text, done) VALUES (\${@draft}, 0)\`}.run()
          }
          "done" => {
            ?{\`UPDATE todos SET done = 1 WHERE id = \${id}\`}.run()
          }
          "delete" => {
            ?{\`DELETE FROM todos WHERE id = \${id}\`}.run()
          }
        }
        @items = ?{\`SELECT id, text, done FROM todos\`}.all()
      }
    }
    <input bind:value=@draft>
    <button on:click=run("add", 0)>Add</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles with no E-CODEGEN-INVALID-LOGIC / E-CG-006 / E-RI-002", () => {
    const { result } = compile(dir, "app.scrml", SOURCE(dir));
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errorsByCode(result, "E-CG-006")).toHaveLength(0);
    expect(errorsByCode(result, "E-RI-002")).toHaveLength(0);
    // No fatal errors at all.
    expect(result.errors ?? []).toEqual([]);
  });

  test("the inline ?{} lowers to a server SQL call inside the match arm (server.js), NOT raw", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    const serverJs = serverJsFor(result, filePath);
    // The arm INSERT runs server-side as a real SQL call.
    expect(serverJs).toContain("INSERT INTO todos");
    // The match IIFE is async-wrapped so the nested `await _scrml_sql` is valid.
    expect(serverJs).toContain("await (async function() {");
    // `@draft` (a client reactive cell) read inside the server batch is the
    // marshalled request payload, NOT the client-only reactive store getter.
    expect(serverJs).toContain('_scrml_body["draft"]');
    expect(serverJs).not.toContain('_scrml_reactive_get("draft")');
  });

  test("client.js contains NO raw SQL token / no _scrml_sql leak and parses as a classic script", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(clientJs).not.toContain("?{");
    expect(clientJs).not.toContain("INSERT INTO todos");
    // The classic-script parse invariant (the E-CODEGEN-INVALID-LOGIC the bug hit).
    expect(() => new Script(clientJs)).not.toThrow();
  });

  test("the following `@items = ?{SELECT}` stays client-side as the CPS continuation", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    const clientJs = clientJsFor(result, filePath);
    // The reactive cell write is performed on the client from the server result.
    expect(clientJs).toContain('_scrml_reactive_set("items"');
    // The client fetches the server route exactly once (single server batch).
    expect(clientJs).toContain("__ri_route_run");
  });
});

// ---------------------------------------------------------------------------
// §2 — inline ?{} in an `if` branch — P2 (was E-RI-002)
// ---------------------------------------------------------------------------

describe("§2 inline ?{} in an if branch → no spurious E-RI-002; CPS-split", () => {
  const NAME = "if-branch";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT)\`}
      <items> = []
      <draft> = ""
      function add() {
        if (@draft != "") {
          ?{\`INSERT INTO todos (text) VALUES (\${@draft})\`}.run()
        }
        @items = ?{\`SELECT id, text FROM todos\`}.all()
      }
    }
    <input bind:value=@draft>
    <button on:click=add()>Add</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles with no E-RI-002 and no E-CODEGEN-INVALID-LOGIC", () => {
    const { result } = compile(dir, "app.scrml", SOURCE(dir));
    expect(errorsByCode(result, "E-RI-002")).toHaveLength(0);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errorsByCode(result, "E-CG-006")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("the if-branch INSERT runs server-side with @draft marshalled as _scrml_body", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    const serverJs = serverJsFor(result, filePath);
    expect(serverJs).toContain("INSERT INTO todos");
    expect(serverJs).toContain('_scrml_body["draft"]');
  });

  test("client.js has no SQL leak, parses, and sets @items client-side", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(clientJs).not.toContain("INSERT INTO todos");
    expect(clientJs).toContain('_scrml_reactive_set("items"');
    expect(() => new Script(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3 — inline ?{} in a `for` loop body — same boundary recognition
// ---------------------------------------------------------------------------

describe("§3 inline ?{} in a for-loop body → server-call boundary", () => {
  const NAME = "for-body";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT)\`}
      <items> = []
      <texts> = []
      function seed() {
        for (let txt of @texts) {
          ?{\`INSERT INTO todos (text) VALUES (\${txt})\`}.run()
        }
        @items = ?{\`SELECT id, text FROM todos\`}.all()
      }
    }
    <button on:click=seed()>Seed</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles with no E-RI-002 / E-CODEGEN-INVALID-LOGIC / E-CG-006", () => {
    const { result } = compile(dir, "app.scrml", SOURCE(dir));
    expect(errorsByCode(result, "E-RI-002")).toHaveLength(0);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errorsByCode(result, "E-CG-006")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("the loop-body INSERT runs server-side; client.js carries no SQL and parses", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    expect(serverJsFor(result, filePath)).toContain("INSERT INTO todos");
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(() => new Script(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4 — REGRESSION: top-level inline ?{} (P1) still CPS-splits
// ---------------------------------------------------------------------------

describe("§4 regression — top-level inline ?{} still CPS-splits (P1)", () => {
  const NAME = "top-level";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT)\`}
      <items> = []
      <draft> = ""
      function add() {
        ?{\`INSERT INTO todos (text) VALUES (\${@draft})\`}.run()
        @items = ?{\`SELECT id, text FROM todos\`}.all()
      }
    }
    <input bind:value=@draft>
    <button on:click=add()>Add</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles clean; server runs SQL; client parses with no SQL leak", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    expect(result.errors ?? []).toEqual([]);
    expect(serverJsFor(result, filePath)).toContain("INSERT INTO todos");
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(clientJs).toContain('_scrml_reactive_set("items"');
    expect(() => new Script(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5 — REGRESSION: server-fn call in a `match` arm (P3) still compiles
// ---------------------------------------------------------------------------

describe("§5 regression — server-fn call in a match arm still compiles (P3)", () => {
  const NAME = "fncall-arm";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT, done INTEGER)\`}
      <items> = []
      <draft> = ""
      function doAdd(text: string) {
        ?{\`INSERT INTO todos (text, done) VALUES (\${text}, 0)\`}.run()
      }
      function doDone(id: number) {
        ?{\`UPDATE todos SET done = 1 WHERE id = \${id}\`}.run()
      }
      function run(action: string, id: number) {
        match action {
          "add" => { doAdd(@draft) }
          "done" => { doDone(id) }
        }
        @items = ?{\`SELECT id, text, done FROM todos\`}.all()
      }
    }
    <input bind:value=@draft>
    <button on:click=run("add", 0)>Add</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles clean; client.js parses; no SQL leak", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errorsByCode(result, "E-CG-006")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(() => new Script(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §6 — REGRESSION: the named-function form (current working idiom)
// ---------------------------------------------------------------------------

describe("§6 regression — named server fn with a match+?{} called from a handler", () => {
  const NAME = "named-fn";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = (dir) => `<program db="${DB_DECL(dir)}">
  <db src="${DB_DECL(dir)}" tables="todos">
    \${
      ?{\`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, text TEXT, done INTEGER)\`}
      function mutate(action: string, id: number, text: string) {
        match action {
          "add" => {
            ?{\`INSERT INTO todos (text, done) VALUES (\${text}, 0)\`}.run()
          }
          "done" => {
            ?{\`UPDATE todos SET done = 1 WHERE id = \${id}\`}.run()
          }
        }
        return ?{\`SELECT id, text, done FROM todos\`}.all()
      }
      <items> = []
      function refresh() {
        @items = mutate("add", 0, "x")
      }
    }
    <button on:click=refresh()>Go</button>
    <ul>\${ for (let t of @items) { lift <li>\${t.text}</li> } }</ul>
  </db>
</program>`;

  test("compiles clean; server runs the match SQL; client parses; no SQL leak", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE(dir));
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(errorsByCode(result, "E-CG-006")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
    const serverJs = serverJsFor(result, filePath);
    expect(serverJs).toContain("INSERT INTO todos");
    expect(serverJs).toContain("await (async function() {");
    const clientJs = clientJsFor(result, filePath);
    expect(clientJs).not.toContain("_scrml_sql");
    expect(() => new Script(clientJs)).not.toThrow();
  });
});
