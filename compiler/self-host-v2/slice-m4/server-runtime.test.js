// server-runtime.test.js — s468 bootstrap unit U1c: the server runtime
// (slice-m1/runtime/server-runtime.js) by itself — the pieces every printed
// server artifact runs through, each in ONE place: the connection (§8.1.1
// resolution base), the query (bound values only; a driver error is a SqlError
// VALUE, §19.8.1), the `fail` envelope (§19.9.1 / §57.8) and its status
// (§19.9.2), and the route (§39.2.3 CSRF, §57.4 strict decode, §12.5.3 a
// complete response on every path) — with the host's own `Response` when no
// `respond` is injected.

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { SQL } from "bun";

const srt = await import(join(import.meta.dir, "..", "slice-m1", "runtime", "server-runtime.js"));
const rt = await import(join(import.meta.dir, "..", "slice-m1", "runtime", "runtime.js"));

const INT = { defs: [], root: { k: "int" } };
const E = {
  defs: [{ k: "enum", name: "E", variants: [
    { name: "NotFoundUser", fields: [] },
    { name: "Invalid", fields: [{ name: "why", ty: { k: "str" } }] },
    { name: "AuthExpired", fields: [] },
    { name: "Boom", fields: [] },
  ] }],
  root: { k: "ref", def: 0 },
};

describe("sqlText — a query site's literal runs, frozen, with `raw` (what a tagged-template driver takes)", () => {
  test("frozen, `raw` equal to the runs, never a value", () => {
    const t = srt.sqlText(["SELECT a FROM t WHERE id = ", ""]);
    expect(Object.isFrozen(t)).toBe(true);
    expect([...t]).toEqual(["SELECT a FROM t WHERE id = ", ""]);
    expect([...t.raw]).toEqual([...t]);
  });
  test("Bun.SQL binds the values (a hostile value stays a value)", async () => {
    const sql = new SQL(":memory:");
    await sql.unsafe("CREATE TABLE t (id INTEGER, s TEXT)");
    const conn = srt.connection({ connect: () => sql }, { driver: "sqlite", target: ":memory:", file: "a.scrml" });
    const evil = "x'); DROP TABLE t; --";
    expect(await srt.query(conn, "run", srt.sqlText(["INSERT INTO t (id, s) VALUES (", ", ", ")"]), [1, evil], [0, 1])).toBe(null);
    expect(await srt.query(conn, "all", srt.sqlText(["SELECT s FROM t"]), [], [])).toEqual([{ s: evil }]);
    expect(await srt.query(conn, "get", srt.sqlText(["SELECT s FROM t WHERE id = ", ""]), [2], [0])).toBe(null);   // no row is not a failure
  });
  test("slots map the template's `${}`s to the DISTINCT values (§8.2: one value, two slots)", async () => {
    const seen = [];
    const conn = srt.connection({ connect: () => (strings, ...values) => { seen.push(values); return Promise.resolve([]); } }, { driver: "sqlite", target: ":memory:", file: "a.scrml" });
    await srt.query(conn, "all", srt.sqlText(["A ", " B ", " C ", ""]), ["x", "y"], [0, 1, 0]);
    expect(seen).toEqual([["x", "y", "x"]]);
  });
});

describe("a driver error is a SqlError VALUE (§19.8.1), with a server log line — never a throw", () => {
  test("a UNIQUE violation → ConstraintViolation(field); a bad query → QueryFailed(message); a lost connection → ConnectionLost", async () => {
    const sql = new SQL(":memory:");
    await sql.unsafe("CREATE TABLE m (id INTEGER PRIMARY KEY, email TEXT UNIQUE)");
    await sql.unsafe("INSERT INTO m (email) VALUES ('a@x')");
    const logs = [];
    const conn = srt.connection({ connect: () => sql, log: (l) => logs.push(l) }, { driver: "sqlite", target: ":memory:", file: "a.scrml" });
    const dup = await srt.query(conn, "run", srt.sqlText(["INSERT INTO m (email) VALUES (", ")"]), ["a@x"], [0]);
    expect(rt.failed(dup)).toBe(true);
    expect(dup.error).toEqual({ variant: "ConstraintViolation", data: ["m.email"] });
    const bad = await srt.query(conn, "all", srt.sqlText(["SELECT nope FROM m"]), [], []);
    expect(bad.error.variant).toBe("QueryFailed");
    expect(logs.length).toBe(2);
    expect(srt.sqlErrorOf({ code: "ECONNREFUSED", message: "x" })).toBe("ConnectionLost");
    expect(srt.sqlErrorOf({ code: "23505", message: "duplicate key", constraint: "m_email_key" })).toEqual({ variant: "ConstraintViolation", data: ["m_email_key"] });
  });
});

describe("the default host: Bun.SQL, a relative SQLite path resolved against the DECLARING file's directory (§8.1.1)", () => {
  test("`./app.db` declared in `sub/app.scrml` under root R opens R/sub/app.db", async () => {
    const root = mkdtempSync(join(tmpdir(), "u1c-root-"));
    const conn = srt.connection({ root }, { driver: "sqlite", target: "./app.db", file: "sub/app.scrml" });
    // the directory must exist for SQLite to create the file
    require("node:fs").mkdirSync(join(root, "sub"), { recursive: true });
    expect(await srt.query(conn, "run", srt.sqlText(["CREATE TABLE t (a INTEGER)"]), [], [])).toBe(null);
    expect(existsSync(join(root, "sub", "app.db"))).toBe(true);
  });
});

describe("the `fail` envelope and its status", () => {
  test("encodeError — the same variant shape as a value, plus `__scrml_error` and `type` (§19.9.1 / §57.8)", () => {
    expect(srt.encodeError(E, "NotFoundUser")).toEqual({ ok: true, wire: { __scrml_error: true, type: "E", variant: "NotFoundUser", data: {} } });
    expect(srt.encodeError(E, { variant: "Invalid", data: ["no"] })).toEqual({ ok: true, wire: { __scrml_error: true, type: "E", variant: "Invalid", data: { why: "no" } } });
    expect(srt.encodeError(E, "Nope").ok).toBe(false);
  });
  test("the client decodes exactly what the server encodes (one wire, both ends)", () => {
    const w = srt.encodeError(E, { variant: "Invalid", data: ["no"] }).wire;
    expect(rt.decodeError(E, w, { canonicalOnly: true })).toEqual({ ok: true, value: { variant: "Invalid", data: ["no"] } });
  });
  test("§19.9.2 heuristic: NotFound 404, Auth/Forbidden/Unauthorized 403, Validation/Invalid 400, else 500", () => {
    expect([srt.failStatus("NotFoundUser"), srt.failStatus("AuthExpired"), srt.failStatus("Forbidden"), srt.failStatus("Unauthorized"),
            srt.failStatus("ValidationFailed"), srt.failStatus("Invalid"), srt.failStatus("Boom")]).toEqual([404, 403, 403, 403, 400, 400, 500]);
  });
});

describe("the route, through the host's OWN Response (no `respond` injected)", () => {
  const route = { path: "/_scrml/call/7", params: [INT], result: INT, error: E };
  const run = async (args) => {
    if (args[0] === 1) return rt.failure("NotFoundUser");
    if (args[0] === 2) throw new Error("secret detail");
    return args[0] + 1;
  };
  const logs = [];
  const server = srt.server({ log: (l) => logs.push(l) }, [srt.route(route, run)]);
  // The request as the runtime reads it (url, method, headers.get, text) — a plain record: when an
  // earlier test file registered happy-dom, the GLOBAL Request is a page-side class that drops `Cookie`.
  const bag = (h) => { const m = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])); return { get: (n) => m.get(n.toLowerCase()) ?? null }; };
  const req = (body, headers = { "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" }, method = "POST", path = route.path) =>
    ({ url: "http://localhost" + path, method, headers: bag({ "Content-Type": "application/json", ...headers }), text: async () => body });

  test("a host Response on every path: 200, the envelope with its status, a fixed 500, 400, 403, 404, 405", async () => {
    const answer = async (r) => { const res = await server.fetch(r); return [res instanceof globalThis.Response, res.status, await res.text()]; };
    expect(await answer(req("[41]"))).toEqual([true, 200, "42"]);
    expect(await answer(req("[1]"))).toEqual([true, 404, JSON.stringify({ __scrml_error: true, type: "E", variant: "NotFoundUser", data: {} })]);
    const boom = await answer(req("[2]"));
    expect(boom.slice(0, 2)).toEqual([true, 500]);
    expect(boom[2]).not.toContain("secret");
    expect(logs.join("\n")).toContain("secret detail");
    expect((await answer(req("[\"x\"]")))[1]).toBe(400);
    expect((await answer(req("[1, 2]")))[1]).toBe(400);
    const forbidden = await server.fetch(req("[41]", {}));
    expect(forbidden.status).toBe(403);
    // (its Set-Cookie is asserted through an injected `respond` in server-artifact.test.js: a page-side
    // Response — happy-dom's, when registered — drops `Set-Cookie` by design)
    expect((await answer(req("[41]", undefined, "POST", "/nope")))[1]).toBe(404);
    expect((await answer(req("", undefined, "GET")))[1]).toBe(405);
  });
  test("a mismatched token is refused even with both present; an empty cookie never matches an empty header", async () => {
    expect((await server.fetch(req("[41]", { "X-CSRF-Token": "a", Cookie: "scrml_csrf=b" }))).status).toBe(403);
    expect((await server.fetch(req("[41]", { "X-CSRF-Token": "", Cookie: "scrml_csrf=" }))).status).toBe(403);
  });
});
