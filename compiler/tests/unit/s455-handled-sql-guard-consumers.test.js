/**
 * S455 — a HANDLED `?{}` statement is the statement it guards (SPEC §19.8.3 / §19.8.4).
 * change-id: s455-handled-sql-lowering-defects (gap g-impl1-handled-sql-lowering-defects-s455).
 *
 * A `!{}` written after a statement parses as `guarded-expr { guardedNode: <the statement>, arms }`
 * — the WHOLE statement is wrapped, one level down. Every analysis that classified statements by
 * kind (or recursed only through array children) missed it, so a handled query silently changed
 * what the compiler did with the statement. The fix is one shared predicate
 * (`handledSqlGuardInner`, codegen/sql-attempt.ts) used by each statement-classifying consumer.
 *
 * Each test below compiles the UNHANDLED form and the HANDLED form of the same program and
 * requires the same diagnostics (the handler adds a failure path; §19.8.3 changes nothing else),
 * plus the lowering checks for the shapes whose emitted code was wrong.
 *
 * Runtime halves (real bun:sqlite): conformance/cases/server-db/sql-handled-{lift,cell-write,
 * split-write,hoisted-loop}-rt and conformance/cases/fn/sql-access-handled-reject.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { writeFileSync, rmSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { handledSqlGuardInner, handledSqlOfGuardedNode } from "../../src/codegen/sql-attempt.ts";

let TMP_ROOT = "";
let counter = 0;
beforeAll(() => { TMP_ROOT = mkdtempSync(join(tmpdir(), "s455-handled-sql-")); });
afterAll(() => { try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_e) { /* preload cleans up */ } });

function compile(src) {
  const dir = join(TMP_ROOT, `c${++counter}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const out = join(dir, "dist");
  const r = compileScrml({ inputFiles: [file], write: true, outputDir: out, log: () => {} });
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
  const codes = {};
  for (const d of diags) codes[d.code] = (codes[d.code] ?? 0) + 1;
  const read = (suffix) => {
    try {
      const f = readdirSync(out).find((n) => n.endsWith(suffix));
      return f ? readFileSync(join(out, f), "utf8") : "";
    } catch { return ""; }
  };
  return { codes, diags, server: read(".server.js"), client: read(".client.js") };
}

const SCHEMA = `
    <schema>
        notes {
            id: integer primary key
            body: text
        }
    </schema>`;

/** The same program with and without a handler on every marked `?{}` (`/*H*‍/` → handler). */
function both(src) {
  const unhandled = src.replace(/ \/\*H(?::[^*]*)?\*\//g, "");
  const handled = src.replace(/ \/\*H(?::([^*]*))?\*\//g, (_m, h) => " " + (h ?? "!{ _ :> not }"));
  return { unhandled: compile(unhandled), handled: compile(handled) };
}

describe("S455 §0 — the shared predicate", () => {
  test("sees the query through every statement kind a `!{}` can guard", () => {
    const sql = { kind: "sql", query: "SELECT 1", chainedCalls: [{ method: "get", args: "" }] };
    const arms = [{ pattern: "_", handler: "not" }];
    expect(handledSqlOfGuardedNode(sql)).toBe(sql);
    expect(handledSqlOfGuardedNode({ kind: "const-decl", name: "x", sqlNode: sql })).toBe(sql);
    expect(handledSqlOfGuardedNode({ kind: "state-decl", name: "c", sqlNode: sql })).toBe(sql);
    expect(handledSqlOfGuardedNode({ kind: "return-stmt", sqlNode: sql })).toBe(sql);
    expect(handledSqlOfGuardedNode({ kind: "lift-expr", expr: { kind: "sql", node: sql } })).toBe(sql);
    expect(handledSqlOfGuardedNode({ kind: "bare-expr", exprNode: { kind: "call", callee: { kind: "ident", name: "f" }, args: [] } })).toBe(null);
    const inner = { kind: "state-decl", name: "c", sqlNode: sql };
    expect(handledSqlGuardInner({ kind: "guarded-expr", guardedNode: inner, arms })).toBe(inner);
    // A guarded CALL keeps its own semantics — not normalized.
    expect(handledSqlGuardInner({ kind: "guarded-expr", guardedNode: { kind: "bare-expr", exprNode: { kind: "call", callee: { kind: "ident", name: "f" }, args: [] } }, arms })).toBe(null);
    expect(handledSqlGuardInner(inner)).toBe(null);
  });
});

describe("S455 §1 — lowering (items 1, 2, 3, yield)", () => {
  test("(1) `lift ?{…}.all() !{…}` in a server fn returns the guarded value, attempt-wrapped", () => {
    const { handled } = both(`<program db="./app.db">${SCHEMA}
    <r> = "init"
    function f() {
        lift ?{\`SELECT id FROM notes\`}.all() /*H:!{ _ :> [] }*/
    }
    <button id="b" onclick={ @r = f() !{ .Transport(_) :> { return } } }>b</button>
    <p>\${@r}</p>
</program>`);
    expect(handled.server).toMatch(/_scrml_sql_attempt\(\(_scrml_p\) => _scrml_sql`SELECT id FROM notes`/);
    expect(handled.server).toMatch(/return (_scrml_)+result_\d+;/);
    expect(Object.keys(handled.codes).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  test("(2) `@c = ?{…}.get() !{…}` in a function is CPS-split like the unhandled write: server returns the value, the client sets the cell", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <r> = "init"
    function f() {
        @r = ?{\`SELECT body FROM notes\`}.get() /*H*/
    }
    <button id="b" onclick={ f() !{ .Transport(_) :> { return } } }>b</button>
    <p>\${@r}</p>
</program>`);
    expect(handled.codes).toEqual(unhandled.codes);
    // server: no reactive write; the guarded value is the CPS return
    expect(handled.server).not.toMatch(/_scrml_reactive_set\(/);
    expect(handled.server).toMatch(/var _scrml_cps_return = /);
    expect(handled.server).toMatch(/return _scrml_cps_return;/);
    // client: the CPS wrapper writes the cell from the server result
    expect(handled.client).toMatch(/_scrml(_cs)?_reactive_set\("r", _scrml_server_result\)/);
    expect(handled.client).not.toMatch(/_scrml_sql/);
  });

  test("(2) an arm that leaves / writes a cell cannot run server-side in a split: E-RI-002 naming the arm", () => {
    const r = compile(`<program db="./app.db">${SCHEMA}
    <r> = "init"
    function f() {
        @r = ?{\`SELECT body FROM notes\`}.get() !{ _ :> { log("x"); return } }
    }
    <button id="b" onclick={ f() !{ .Transport(_) :> { return } } }>b</button>
    <p>\${@r}</p>
</program>`);
    const ri = r.diags.filter((d) => d.code === "E-RI-002");
    expect(ri.length).toBe(1);
    expect(ri[0].message).toMatch(/cannot be split around the `!\{\}` handler/);
  });

  // S239 review (94265ab3) finding 1 — the arm-admission rule is an AST allow-list, not a text scan.
  const splitWithArm = (arm, params = "") => compile(`<program db="./app.db">${SCHEMA}
    <rC> = "init"
    <s> = "init"
    function mark() {
        @s = "marked"
        return "m"
    }
    function fC(${params}) {
        const fallback = "fb"
        @rC = ?{\`SELECT id, body FROM notes\`}.get() !{ _ :> ${arm} }
        @s = "after"
    }
    <button onclick={ fC(${params ? '"p"' : ""}) !{ .Transport(_) :> { return } } }>c</button>
    <p>\${@rC} \${@s}</p>
</program>`);
  test("(2) an arm reading a CLIENT local (not in the server batch) is refused — E-RI-002, never split", () => {
    const r = splitWithArm("fallback");
    expect(r.codes["E-RI-002"]).toBe(1);
  });
  test("(2) an arm calling a function (it may write a cell transitively) is refused — E-RI-002", () => {
    const r = splitWithArm("mark()");
    expect(r.codes["E-RI-002"]).toBe(1);
  });
  test("(2) a string-literal arm containing `@` is a value, not a cell — admitted (split)", () => {
    const r = splitWithArm('"mail admin@x.io"');
    expect(r.codes["E-RI-002"]).toBeUndefined();
    expect(r.server).toMatch(/= "mail admin@x\.io";/);
  });
  test("(2) an arm reading the function's own parameter is admitted (split)", () => {
    const r = splitWithArm("p", "p");
    expect(r.codes["E-RI-002"]).toBeUndefined();
  });

  test("(3) `for (r of ?{…}.all() !{…})` parses — the handler is part of the iterable", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <r> = "init"
    function f() {
        let n = 0
        for (const x of ?{\`SELECT id FROM notes\`}.all() /*H:!{ _ :> [] }*/) { n = n + 1 }
        return "n=" + n
    }
    <button id="b" onclick={ @r = f() !{ .Transport(_) :> { return } } }>b</button>
    <p>\${@r}</p>
</program>`);
    expect(handled.codes).toEqual(unhandled.codes);
    expect(handled.server).toMatch(/for \(const x of \(await/);
    expect(handled.server).toMatch(/_scrml_sql_attempt\(/);
  });

  test("`yield ?{…} !{…}` in an SSE generator yields the guarded value (was `let r = yield <raw query>`)", () => {
    const r = compile(`<program db="./app.db">${SCHEMA}
    \${
        server function* feed() {
            yield ?{\`SELECT id FROM notes\`}.all() !{ _ :> [] }
        }
    }
    <p>x</p>
</program>`);
    expect(r.server).toMatch(/_scrml_sql_attempt\(/);
    expect(r.server).toMatch(/yield (_scrml_)+result_\d+;/);
    expect(r.server).not.toMatch(/= yield /);
  });
});

describe("S455 §2 — analyses see the guarded statement exactly as the unhandled one (items 5–10)", () => {
  test("(5) E-FN-001 — a handled `?{}` in a `fn` (statement, declaration, return)", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    \${ fn a() {
        ?{\`SELECT body FROM notes\`}.get() /*H*/
        return 1
    } }
    \${ fn b() {
        const r = ?{\`SELECT body FROM notes\`}.get() /*H*/
        return r
    } }
    \${ fn c() {
        return ?{\`SELECT id FROM notes\`}.all() /*H:!{ _ :> [] }*/
    } }
    <p>\${a()} \${b()} \${c()}</p>
</program>`);
    expect(unhandled.codes["E-FN-001"]).toBe(3);
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("(6) E-CPS-MULTIBATCH-REORDER + E-REACTIVE-003 (rails-crud-admin shape) — the handled write keeps its table edge", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <products> = []
    <editId> = 0
    <editName> = ""
    \${
        server function updateNote() {
            ?{\`UPDATE notes SET body = \${@editName} WHERE id = \${@editId}\`}.run() /*H:!{ _ :> {} }*/
            @editId = 0
            @products = ?{\`SELECT id, body FROM notes\`}
        }
    }
    <button onclick={ updateNote() !{ .Transport(_) :> { return } } }>save</button>
    <p>\${@products.length} \${@editId} \${@editName}</p>
</program>`);
    expect(unhandled.codes["E-CPS-MULTIBATCH-REORDER"]).toBe(1);
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("(7) I-PROTECT-STRIP-001 and no E-PROTECT-006 — protect flow models the handled query exactly", () => {
    const src = (h) => `<program auth="none" db="app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT, pin INTEGER)\`}
  </schema>
  <db src="app.db" protect="passwordHash, pin" tables="users">
    \${
      function getUser(id) {
        let a = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()${h}
        let b = ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()${h}
        Object.assign(a, b)
        return a
      }
    }
  </db>
  <user> = not
  <button id="load" onclick={ @user = getUser(1) !{ .Transport(_) :> { return } } }>load</button>
</program>`;
    const unhandled = compile(src(""));
    const handled = compile(src(" !{ _ :> not }"));
    expect(unhandled.codes["I-PROTECT-STRIP-001"]).toBe(1);
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("(8) return-type inference reads a handled SQL declaration (no extra W-TYPE-031-UNPROVEN at the caller)", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <out> = ""
    function load(id) {
        const row = ?{\`SELECT id, body FROM notes WHERE id = \${id}\`}.get() /*H*/
        return { found: row }
    }
    function go() {
        const result = load(1) !{ .Transport(_) :> { return } }
        @out = result.found is not ? "none" : result.found.body
    }
    <button onclick=go()>go</button>
    <p>\${@out}</p>
</program>`);
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("(9) a handled write in a body-split function splits (no E-RI-002)", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <status> = "init"
    function add() {
        ?{\`INSERT INTO notes (body) VALUES ('x')\`}.run() /*H:!{ _ :> {} }*/
        @status = "added"
    }
    <button onclick={ add() !{ .Transport(_) :> { return } } }>add</button>
    <p>\${@status}</p>
</program>`);
    expect(unhandled.codes["E-RI-002"]).toBeUndefined();
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("(10) a handled read in a callee keeps the caller's Promise.all batching", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    <b1> = not
    <b2> = not
    \${ function bodyOf(id: number) {
        return ?{\`SELECT body FROM notes WHERE id = \${id}\`}.get() /*H*/
    } }
    \${ function onRead() {
        @b1 = bodyOf(1)
        @b2 = bodyOf(2)
    } }
    <button onclick=onRead()>read</button>
    <p>\${@b1} \${@b2}</p>
</program>`);
    expect(unhandled.client).toMatch(/Promise\.all/);
    expect(handled.client).toMatch(/Promise\.all/);
    expect(handled.codes).toEqual(unhandled.codes);
  });

  test("a handled top-level `?{}` is still a suppressed top-level SQL block (W-CG-001)", () => {
    const { unhandled, handled } = both(`<program db="./app.db">${SCHEMA}
    \${
        ?{\`DELETE FROM notes WHERE id = 99\`}.run() /*H:!{ _ :> {} }*/
    }
    <p>x</p>
</program>`);
    expect(unhandled.codes["W-CG-001"]).toBe(1);
    expect(handled.codes).toEqual(unhandled.codes);
    expect(handled.client).not.toMatch(/_scrml_sql/);
  });

  test("§8.10 hoisted loop: a handled keyed read is rewritten to the Map lookup (was `null /* client cannot evaluate */`)", () => {
    const r = compile(`<program db="./app.db">${SCHEMA}
    <r> = "init"
    function f(items) {
        let out = []
        for (const it of items) {
            const row = ?{\`SELECT id, body FROM notes WHERE id = \${it.id}\`}.get() !{ _ :> not }
            out.push(row)
        }
        return out
    }
    <button onclick={ @r = f([{ id: 7 }]) !{ .Transport(_) :> { return } } }>go</button>
    <p>\${@r}</p>
</program>`);
    expect(r.server).toMatch(/Tier 2 loop hoist/);
    // S456: the pre-fetch runs through the attempt; its failure (the SqlError envelope)
    // is held and returned by the per-iteration read, which the guard then matches.
    expect(r.server).toMatch(/= await _scrml_sql_attempt\(\(_keys\) => _scrml_batch_fetch_\d+\(_keys, 0\)/);
    expect(r.server).toMatch(/let _scrml__scrml_result_\d+ = \(await _scrml_batch_read_\d+\(it\.id\)\);/);
    expect(r.server).not.toMatch(/client cannot evaluate/);
  });
});
