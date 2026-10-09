/**
 * §14.8.9 — a `protect=` column must not leave the server through the response
 * an author `handle()` builds, however the `Response` constructor is reached.
 * S456, `g-handle-globalthis-response-ships-protected-columns` (SECURITY, HIGH).
 *
 * THE DEFECT, MEASURED at base 2dd6d35d9: in a `protect="passwordHash"` app,
 *
 *     function handle(request, resolve) {
 *         const u = ?{`select id, name, passwordHash from users where id = 1`}.get() !{ _ :> not }
 *         return new globalThis.Response(JSON.stringify(u))
 *     }
 *
 * compiled at exit 0 and the emitted server answered HTTP 200
 * `{"id":1,"name":"ada","passwordHash":"SECRET"}` — while the bare spelling
 * `new Response(…)` was E-PROTECT-006. So were `self.Response`,
 * `globalThis["Response"]`, an alias, a destructure, and `.json(u)` through any
 * of them; and a `handle()` POST-middleware header write of the column.
 *
 * TWO ROOTS, BOTH FIXED (`compiler/src/codegen/protect-flow.ts`):
 *   1. the value `handle()` returns is sent to the client as-is (no redact, no
 *      mediation check) but was not a sink of the provenance analysis — now it
 *      is (`HANDLE_RESULT_BINDING`, sink kind "handle"), so anything the
 *      fail-closed unknown-callee rule taints is rejected when it leaves there;
 *   2. the author-`Response` sink recognized the constructor by its SPELLED
 *      path (`path === "Response"`) — now by VALUE (`responseCtorOf`: the
 *      value's global names), so every spelling is the same sink.
 *
 * Layers: compile-time leaks; compile-time negatives; EXECUTED negatives.
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { assertOpensDb } from "../helpers/self-host-server-import.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const QUERY = "const u = ?{`SELECT id, name, passwordHash FROM users WHERE id = 1`}.get() !{ _ :> not }";
const handleProg = (lines) => `<program db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="./app.db" protect="passwordHash" tables="users">
    \${
      function handle(request, resolve) {
        ${[QUERY, ...lines].join("\n        ")}
      }
    }
  </db>
  <p>hi</p>
</program>
`;
const serverFnProg = (lines) => `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)\`}
  </schema>
  <db src="./app.db" protect="passwordHash" tables="users">
    \${
      function getUser() {
        ${[QUERY, ...lines].join("\n        ")}
      }
    }
  </db>
  <user> = not
  <button onclick={ @user = getUser() !{ .Transport(_) :> { return } } }>load</button>
</program>
`;

function compileMem(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-handle-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  const diags = [...(result.errors ?? []), ...(result.warnings ?? [])];
  return { result, diags, codes: diags.map((d) => d.code) };
}

// ---------------------------------------------------------------------------
// 1. every spelling of the Response constructor in handle() is rejected
// ---------------------------------------------------------------------------
const HANDLE_LEAKS = {
  "bare `new Response` (already caught at base — pinned)": ["return new Response(JSON.stringify(u))"],
  "bare `Response.json` (already caught at base — pinned)": ["return Response.json(u)"],
  "`new globalThis.Response` (the reported shape)": ["return new globalThis.Response(JSON.stringify(u))"],
  "`new self.Response`": ["return new self.Response(JSON.stringify(u))"],
  '`new globalThis["Response"]`': ['return new globalThis["Response"](JSON.stringify(u))'],
  "an alias `const R = globalThis.Response`": ["const R = globalThis.Response", "return new R(JSON.stringify(u))"],
  "a destructure `const { Response: R } = globalThis`": ["const { Response: R } = globalThis", "return new R(JSON.stringify(u))"],
  "`globalThis.Response.json(u)`": ["return globalThis.Response.json(u)"],
  "`R.json(u)`, R an alias": ["const R = globalThis.Response", "return R.json(u)"],
  "`R.json(u)`, R a destructure": ["const { Response: R } = globalThis", "return R.json(u)"],
  "a null-body Response whose HEADER carries the column": [
    'return new globalThis.Response(not, { status: 302, headers: { Location: "/x?h=" + u.passwordHash } })'],
};
// Shapes no Response recognizer names — caught only because handle()'s return is a sink.
const EXIT_SINK_LEAKS = {
  "a BOUND `Response.json`": ["const mk = globalThis.Response.json.bind(globalThis.Response)", "return mk(u)"],
  "a POST-middleware header write on the routed response": [
    "const r = resolve(request)", 'r.headers.set("x-h", u.passwordHash)', "return r"],
};

describe("S456 — handle() + any spelling of Response: E-PROTECT-006", () => {
  for (const [name, lines] of Object.entries(HANDLE_LEAKS)) {
    test(`${name} is rejected`, () => {
      expect(compileMem(handleProg(lines)).codes).toContain("E-PROTECT-006");
    });
  }
  for (const [name, lines] of Object.entries(EXIT_SINK_LEAKS)) {
    test(`${name} is rejected at the handle() exit`, () => {
      const { diags } = compileMem(handleProg(lines));
      const e = diags.find((d) => d.code === "E-PROTECT-006");
      expect(e).toBeDefined();
      expect(e.message).toContain("the response `handle()` returns");
    });
  }
});

describe("S456 — the same spellings in a SERVER FUNCTION stay rejected", () => {
  const SF = {
    "`new globalThis.Response`": ["return new globalThis.Response(JSON.stringify(u))"],
    "an alias": ["const R = globalThis.Response", "return new R(JSON.stringify(u))"],
    "`R.json(u)`, R a destructure": ["const { Response: R } = globalThis", "return R.json(u)"],
    "a null-body header leak through `globalThis.Response`": [
      'return new globalThis.Response(not, { status: 302, headers: { Location: "/x?h=" + u.passwordHash } })'],
  };
  for (const [name, lines] of Object.entries(SF)) {
    test(`${name} is rejected`, () => {
      expect(compileMem(serverFnProg(lines)).codes).toContain("E-PROTECT-006");
    });
  }
});

// ---------------------------------------------------------------------------
// 2. negatives — handle() stays an author-owned escape hatch for clean data
// ---------------------------------------------------------------------------
const HANDLE_CLEAN = {
  "an un-protected value through `new globalThis.Response`": [
    "return new globalThis.Response(JSON.stringify({ id: 1, name: \"ada\" }))"],
  "non-protected fields of the protected row, through an alias": [
    "const R = globalThis.Response", "return new R(JSON.stringify({ id: u.id, name: u.name }))"],
  "a non-protected field as the body": ["return new globalThis.Response(u.name)"],
  "reveal — the deliberate admit path": ['return new globalThis.Response(JSON.stringify(u.reveal("passwordHash")))'],
  "plain pass-through `return resolve(request)`": ["return resolve(request)"],
  "a POST-middleware header of a NON-protected field": [
    "const r = resolve(request)", 'r.headers.set("x-name", u.name)', "return r"],
};

describe("S456 — negatives compile", () => {
  for (const [name, lines] of Object.entries(HANDLE_CLEAN)) {
    test(`${name} compiles`, () => {
      const { codes } = compileMem(handleProg(lines));
      expect(codes).not.toContain("E-PROTECT-006");
      expect(codes).not.toContain("E-PROTECT-005");
    });
  }
});

// ---------------------------------------------------------------------------
// 3. EXECUTED — what compiles serves the right bytes
// ---------------------------------------------------------------------------
async function serve(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-handle-run-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)");
  db.run("INSERT INTO users VALUES (1, 'ada', 'SECRET-HASH-123')");
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
  const serverJsPath = join(outDir, "app.server.js");
  expect(existsSync(serverJsPath)).toBe(true);
  assertOpensDb(serverJsPath, dbPath);
  return import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
}

describe("S456 EXECUTED — the negatives still work on the wire", () => {
  test("non-protected fields through an aliased globalThis.Response: 200, no hash", async () => {
    const mod = await serve(handleProg(HANDLE_CLEAN["non-protected fields of the protected row, through an alias"]));
    const res = await mod.fetch(new Request("http://localhost/anything"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("SECRET-HASH-123");
    expect(JSON.parse(body)).toEqual({ id: 1, name: "ada" });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("reveal ships the column deliberately", async () => {
    const mod = await serve(handleProg(HANDLE_CLEAN["reveal — the deliberate admit path"]));
    const res = await mod.fetch(new Request("http://localhost/anything"));
    expect(JSON.parse(await res.text()).passwordHash).toBe("SECRET-HASH-123");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("POST-middleware header of a non-protected field is set", async () => {
    const mod = await serve(handleProg(HANDLE_CLEAN["a POST-middleware header of a NON-protected field"]));
    // the `fetch` aggregate maps an untouched no-match 404 to null; drive the onion directly
    const res = await mod._scrml_mw_pipeline(async () => null)(new Request("http://localhost/anything"));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-name")).toBe("ada");
  }, EXECUTED_DB_TIMEOUT_MS);
});
