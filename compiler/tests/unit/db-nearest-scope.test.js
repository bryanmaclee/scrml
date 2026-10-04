/**
 * §8.1.1 (S451) — the nearest-database-scope resolution, unit level.
 *
 * > "The compiler SHALL resolve the database for each `?{}` block by finding its closest
 * > ancestor database scope — a `<program>` element with a `db=` attribute, or a
 * > `<db src=>` state block. 'Closest' means fewest nesting levels up the element tree,
 * > counting both kinds; the `?{}` runs on that scope's database and on no other."
 *
 * Covers: `resolveDbScopes` (db-ownership.ts) — structural, ancestor-chain resolution
 * and one handle per database; ownership following the same resolution (§8.1.1
 * *Ownership* "that database"); and the server emitter — a function's handle, the
 * §8.9.2 envelope's handle, E-SQL-011 for one function spanning two databases, and
 * E-SQL-004 for a `?{}` outside every scope. Runtime behaviour (which file a query
 * hits) is in integration/db-nearest-scope-runtime.test.js.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { resolve as resolvePath } from "node:path";
import { resolveDbScopes, dbHandlesWithin, decideOwnedDbFiles } from "../../src/db-ownership.ts";
import { collectDbScopes, generateServerJs } from "../../src/codegen/emit-server.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

const FILE = "/test/app.scrml";
let pos = 0;
const span = () => { const s = ++pos * 10; return { file: FILE, start: s, end: s + 5, line: 1, col: 1 }; };
const program = (db, children) => ({
  kind: "markup", tag: "program",
  attributes: db === null ? [] : [{ name: "db", value: { kind: "string-literal", value: db }, span: span() }],
  children, span: span(),
});
const dbBlock = (src, children) => ({
  kind: "state", stateType: "db",
  attrs: [{ name: "src", value: { kind: "string-literal", value: src }, span: span() }],
  children, span: span(),
});
const sql = (query) => ({ kind: "sql", query, chainedCalls: [{ method: "all" }], span: span() });
const logic = (body) => ({ kind: "logic", body, span: span() });
const fn = (name, body) => ({ kind: "function-decl", name, params: [], body, span: span(), isServer: true });
const fileAST = (nodes) => ({ filePath: FILE, nodes, imports: [], exports: [], components: [], typeDecls: [] });

beforeEach(() => resetVarCounter());

describe("resolveDbScopes — nearest scope from the ancestor chain", () => {
  test("nested <program db=b> inside <program db=a>: the inner ?{} resolves to b", () => {
    const inner = sql("SELECT 1");
    const outer = sql("SELECT 2");
    const nodes = [program("./a.db", [logic([outer]), program("./b.db", [logic([inner])])])];
    const res = resolveDbScopes(nodes, FILE);
    expect(res.scopeOf.get(inner).value).toBe("./b.db");
    expect(res.scopeOf.get(outer).value).toBe("./a.db");
  });

  test("<db src=b> beside a ?{} directly in <program db=a>: each resolves to its own scope", () => {
    const inProgram = sql("SELECT 1");
    const inDb = sql("SELECT 2");
    const nodes = [program("./a.db", [logic([inProgram]), dbBlock("./b.db", [logic([inDb])])])];
    const res = resolveDbScopes(nodes, FILE);
    expect(res.scopeOf.get(inProgram).value).toBe("./a.db");
    expect(res.scopeOf.get(inDb).value).toBe("./b.db");
    // The default handle is still the file's first <db src> (fileDefaultDbDecl) — b.
    expect(res.defaultHandle.ident).toBe("_scrml_sql");
    expect(res.defaultHandle.value).toBe("./b.db");
    expect(res.scopeOf.get(inProgram).ident).toBe("_scrml_sql_1");
  });

  test("document order does not decide: a <db src> AFTER the ?{} is not its scope", () => {
    const early = sql("SELECT 1");
    const nodes = [program(null, [logic([early]), dbBlock("./b.db", [])])];
    const res = resolveDbScopes(nodes, FILE);
    expect(res.scopeOf.get(early)).toBe(null);
    expect(res.sites.find((s) => s.node === early).handle).toBe(null);
  });

  test("two spellings of one SQLite file share ONE handle", () => {
    const q1 = sql("SELECT 1");
    const q2 = sql("SELECT 2");
    const nodes = [program("./a.db", [logic([q1]), dbBlock("sqlite:a.db", [logic([q2])])])];
    const res = resolveDbScopes(nodes, FILE);
    expect(res.handles.length).toBe(1);
    expect(res.scopeOf.get(q1)).toBe(res.scopeOf.get(q2));
  });

  test("dbHandlesWithin reports every site's handle inside a subtree", () => {
    const f = fn("f", [sql("SELECT 1")]);
    const nodes = [program("./a.db", [dbBlock("./b.db", [logic([f])])])];
    const res = resolveDbScopes(nodes, FILE);
    expect([...dbHandlesWithin(res, f)].map((h) => h.value)).toEqual(["./b.db"]);
  });
});

describe("ownership follows the same resolution (§8.1.1 *Ownership* — 'that database')", () => {
  test("a CREATE TABLE in the nested <db src=c> owns c, not the file's default database", () => {
    const nodes = [program("./a.db", [logic([sql("SELECT 1")]), dbBlock("./c.db", [logic([fn("setup", [sql("CREATE TABLE t (n INTEGER)")])])])])];
    const owned = decideOwnedDbFiles([{ filePath: FILE, nodes }]);
    expect([...owned]).toEqual([resolvePath("/test/c.db")]);
  });

  test("a CREATE TABLE directly in <program db=a> beside a <db src=b> owns a (it used to own b)", () => {
    const nodes = [program("./a.db", [logic([fn("setup", [sql("CREATE TABLE t (n INTEGER)")])]), dbBlock("./b.db", [])])];
    const owned = decideOwnedDbFiles([{ filePath: FILE, nodes }]);
    expect([...owned]).toEqual([resolvePath("/test/a.db")]);
  });
});

function routeMapFor(fns) {
  const m = new Map();
  for (const f of fns) {
    m.set(`${FILE}::${f.span.start}`, { boundary: "server", generatedRouteName: `_scrml_route_${f.name}_1`, explicitMethod: "POST" });
  }
  return { functions: m };
}

describe("server emission — each function on its own scope's handle", () => {
  test("collectDbScopes declares one handle per database: default _scrml_sql + _scrml_sql_<n>", () => {
    const nodes = [program("./a.db", [dbBlock("./b.db", [])])];
    const scopes = collectDbScopes(fileAST(nodes));
    expect(scopes.get("_scrml_sql").connectionString).toBe("./b.db");
    expect(scopes.get("_scrml_sql_1").connectionString).toBe("./a.db");
  });

  test("a function in <program db=a> beside a <db src=b> queries a's handle; one inside the block queries b's", () => {
    const outer = fn("outer", [sql("SELECT 1")]);
    const inner = fn("inner", [sql("SELECT 2")]);
    const nodes = [program("./a.db", [logic([outer]), dbBlock("./b.db", [logic([inner])])])];
    const errors = [];
    const js = generateServerJs(fileAST(nodes), routeMapFor([outer, inner]), errors, null, null);
    expect(errors.filter((e) => e.code?.startsWith("E-"))).toEqual([]);
    const body = (name) => js.slice(js.indexOf(`function _scrml_handler_${name}`), js.indexOf(`export const _scrml_route_${name}`));
    expect(body("outer")).toMatch(/await _scrml_sql_1`SELECT 1`/);
    expect(body("inner")).toMatch(/await _scrml_sql`SELECT 2`/);
    expect(js).toContain('_scrml_sqlite_referenced("a.db", "./a.db", "app.scrml")');
    expect(js).toContain('_scrml_sqlite_referenced("b.db", "./b.db", "app.scrml")');
  });

  test("the §8.9.2 implicit envelope opens, commits and rolls back on the function's own handle", () => {
    const outer = fn("outer", [sql("UPDATE t SET n = 1"), sql("UPDATE t SET n = 2")]);
    const nodes = [program("./a.db", [logic([outer]), dbBlock("./b.db", [])])];
    const errors = [];
    const batchPlan = { coalescedHandlers: new Map([["outer", [{ envelopeKind: "implicit-handler-tx" }]]]) };
    const js = generateServerJs(fileAST(nodes), routeMapFor([outer]), errors, null, null, batchPlan, []);
    const body = js.slice(js.indexOf("function _scrml_handler_outer"), js.indexOf("export const _scrml_route_outer"));
    expect(body).toContain('await _scrml_sql_1.unsafe("BEGIN DEFERRED");');
    expect(body).toContain('await _scrml_sql_1.unsafe("COMMIT");');
    expect(body).toContain('await _scrml_sql_1.unsafe("ROLLBACK");');
    expect(body).not.toMatch(/\b_scrml_sql\b/);
  });

  test("E-SQL-011: one function whose ?{} sites resolve to two databases is refused", () => {
    // Not reachable from scrml source today (a function body holds no database scope
    // element); the emitter still fails closed rather than pick one database.
    const f = fn("mixed", [sql("SELECT 1"), dbBlock("./b.db", [sql("SELECT 2")])]);
    const nodes = [program("./a.db", [logic([f])])];
    const errors = [];
    generateServerJs(fileAST(nodes), routeMapFor([f]), errors, null, null);
    const e = errors.find((x) => x.code === "E-SQL-011");
    expect(e).toBeDefined();
    expect(e.message).toContain("./a.db");
    expect(e.message).toContain("./b.db");
  });

  test("E-SQL-004: a ?{} outside every scope, in a file that declares two databases, is refused", () => {
    const f = fn("loose", [sql("SELECT 1")]);
    const nodes = [logic([f]), program("./a.db", [dbBlock("./b.db", [])])];
    const errors = [];
    generateServerJs(fileAST(nodes), routeMapFor([f]), errors, null, null);
    expect(errors.some((x) => x.code === "E-SQL-004")).toBe(true);
  });

  test("scope of the fix, pinned: an unscoped ?{} in a file with ONE database still runs on it (pre-S451 divergence, left to a ruling)", () => {
    const f = fn("loose", [sql("SELECT 1")]);
    const nodes = [logic([f]), program("./a.db", [])];
    const errors = [];
    const js = generateServerJs(fileAST(nodes), routeMapFor([f]), errors, null, null);
    expect(errors.some((x) => x.code === "E-SQL-004")).toBe(false);
    expect(js).toMatch(/await _scrml_sql`SELECT 1`/);
  });
});

// ---------------------------------------------------------------------------
// S451 review fix round (HIGH-1, silent fallbacks, MED-2)
// ---------------------------------------------------------------------------

describe("fix round — every pass recognises every handle; no silent default in a multi-database file", () => {
  test("HIGH-1: wrapPrincipalTxn wraps a query on a scoped handle `_scrml_sql_<n>`", async () => {
    const { wrapPrincipalTxn } = await import("../../src/codegen/db-authoritative.ts");
    const src = "async function _scrml_handler_x(_scrml_req) {\n  const r = await _scrml_sql_1`SELECT 1`;\n  return r;\n}\n";
    const out = wrapPrincipalTxn(src);
    expect(out).toContain("_scrml_sql_1.begin(async (tx) =>");
    expect(out).toContain('tx.unsafe("SET LOCAL ROLE scrml_app")');
    expect(out).toContain("set_config('scrml.tenant'");
    expect(out).toContain("return await tx`SELECT 1`");
  });

  test("HIGH-1: wrapPrincipalTxn leaves an identifier that merely starts with the handle name alone", async () => {
    const { wrapPrincipalTxn } = await import("../../src/codegen/db-authoritative.ts");
    const src = "async function h(_scrml_req) {\n  return await _scrml_sql_1x`SELECT 1`;\n}\n";
    expect(wrapPrincipalTxn(src)).toBe(src);
  });

  test("fail closed: an unscoped ?{} in a two-database file lowers onto NO database (internal error), never the file's first one", () => {
    const f = fn("loose", [sql("SELECT 1")]);
    const nodes = [logic([f]), program("./a.db", [dbBlock("./b.db", [])])];
    const errors = [];
    const js = generateServerJs(fileAST(nodes), routeMapFor([f]), errors, null, null);
    expect(js).not.toMatch(/await _scrml_sql(?:_\d+)?`SELECT 1`/);
    expect(errors.some((x) => x.code === "E-INTERNAL-DB-HANDLE-UNRESOLVED")).toBe(true);
    expect(js).not.toMatch(/const _scrml_sql_UNRESOLVED\b/);
  });

  test("single-database file: the fallback is still `_scrml_sql` (unchanged)", () => {
    const f = fn("loose", [sql("SELECT 1")]);
    const nodes = [logic([f]), program("./a.db", [])];
    const errors = [];
    const js = generateServerJs(fileAST(nodes), routeMapFor([f]), errors, null, null);
    expect(js).toMatch(/await _scrml_sql`SELECT 1`/);
    expect(errors.some((x) => x.code === "E-INTERNAL-DB-HANDLE-UNRESOLVED")).toBe(false);
  });

  test("MED-2: two `<db src=\":memory:\">` scopes are two databases (two handles)", () => {
    const q1 = sql("SELECT 1");
    const q2 = sql("SELECT 2");
    const nodes = [program(null, [dbBlock(":memory:", [logic([q1])]), dbBlock(":memory:", [logic([q2])])])];
    const res = resolveDbScopes(nodes, FILE);
    expect(res.handles.length).toBe(2);
    expect(res.scopeOf.get(q1)).not.toBe(res.scopeOf.get(q2));
    const scopes = collectDbScopes(fileAST(nodes));
    expect([...scopes.keys()]).toEqual(["_scrml_sql", "_scrml_sql_1"]);
  });
});
