/**
 * S465 P0 (SECURITY) — an ASYNC function imported from another `.scrml` module
 * was called un-awaited from server-emitted code. Every case below is EXECUTED:
 * the program is compiled, its server bundle is imported under bun with a real
 * bun:sqlite database, and each route is driven over a Request.
 *
 *   lib.scrml:  export function check(p, h) { return verifyPassword(p, h) }
 *   app.scrml:  import { check } from "./lib.scrml"
 *               function login(pass) { … if (!check(pass, row.pw)) { return "REJECTED" } … }
 *
 * `lib.server.js` exports `async function check` (it awaits `verifyPassword`),
 * but `app.server.js` emitted `if (!check(pass, row.pw))` — `!Promise` is
 * false, so a WRONG PASSWORD WAS ACCEPTED. A same-file helper was awaited; an
 * imported one was not, because the server await classifier knew only same-file
 * peers and stdlib exports.
 *
 * Fix: the importing file's cross-module async facts (`asyncImportedLocalsOf`,
 * codegen/index.ts — resolved from the IMPORTED module's own analysis, following
 * `as` aliases and §21.4 re-export chains) ride on the callee map
 * (`buildCalleeImportMap(...).asyncImportedLocals`), and the ONE classifier every
 * await site already asks — `isPromiseReturningImportedCallee` (the #1399 S462
 * mechanism) — answers true for them. Under §19.9.9.8 a CPS-split function's
 * check runs in the server batch, where the same classifier awaits it.
 *
 * SPEC §13.2: "An async-colored function is one the compiler emits async: a
 * server function, a Promise-returning standard-library function, or any
 * function that (transitively) calls one. … It MAY be called directly (the
 * compiler awaits the call)".
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const LIB = `\${
  import { verifyPassword } from "scrml:auth"
  export function check(p, h) { return verifyPassword(p, h) }
}
`;

// A module that only RE-EXPORTS the async helper, under a new name (§21.4).
const MID = `\${
  export { check as reCheck } from "./lib.scrml"
}
`;

const ROW = "const row = ?{`SELECT name, pw FROM users WHERE name = ${name}`}.get()";

const APP = `<program db="./app.db">
\${
  import { check } from "./lib.scrml"
  import { check as ck } from "./lib.scrml"
  import { reCheck } from "./mid.scrml"
  function login(name: string, pass: string) {
    ${ROW}
    if (!check(pass, row.pw)) { return "REJECTED" }
    return "WELCOME " + row.name
  }
  function loginAlias(name: string, pass: string) {
    ${ROW}
    if (!ck(pass, row.pw)) { return "REJECTED" }
    return "WELCOME " + row.name
  }
  function loginReExport(name: string, pass: string) {
    ${ROW}
    if (!reCheck(pass, row.pw)) { return "REJECTED" }
    return "WELCOME " + row.name
  }
  function loginAnd(name: string, pass: string) {
    ${ROW}
    if (pass.length > 0 && check(pass, row.pw)) { return "WELCOME " + row.name }
    return "REJECTED"
  }
  function loginTernary(name: string, pass: string) {
    ${ROW}
    return check(pass, row.pw) ? "WELCOME " + row.name : "REJECTED"
  }
  function loginEvery(name: string, pass: string) {
    ${ROW}
    if ([pass].every(p => check(p, row.pw))) { return "WELCOME " + row.name }
    return "REJECTED"
  }
  function loginBound(name: string, pass: string) {
    ${ROW}
    const ok = check(pass, row.pw)
    if (!ok) { return "REJECTED" }
    return "WELCOME " + row.name
  }
}
<out> = ""
<button onclick={ @out = login("bob", "x") }>a</button>
<button onclick={ @out = loginAlias("bob", "x") }>b</button>
<button onclick={ @out = loginReExport("bob", "x") }>c</button>
<button onclick={ @out = loginAnd("bob", "x") }>d</button>
<button onclick={ @out = loginTernary("bob", "x") }>e</button>
<button onclick={ @out = loginEvery("bob", "x") }>f</button>
<button onclick={ @out = loginBound("bob", "x") }>g</button>
<p>\${@out}</p>
</program>
`;

let dir, mod, serverJs;
const routes = new Map();

async function call(fn, args) {
  const path = routes.get(fn);
  expect(path).toBeDefined();
  const res = await mod.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify(args),
  }));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "s465-await-imported-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(dir, "lib.scrml"), LIB);
  writeFileSync(join(dir, "mid.scrml"), MID);
  const file = join(dir, "app.scrml");
  writeFileSync(file, APP);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
  const serverJsPath = join(outDir, "app.server.js");
  expect(existsSync(serverJsPath)).toBe(true);
  serverJs = await Bun.file(serverJsPath).text();
  mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  for (const r of mod.routes) {
    const m = /__ri_route_([A-Za-z]+)_\d+$/.exec(r.path);
    if (m) routes.set(m[1], r.path);
  }
}, EXECUTED_DB_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const SHAPES = [
  ["login", "`if (!check(…))` — imported helper"],
  ["loginAlias", "`import { check as ck }` — aliased import"],
  ["loginReExport", "`export { check as reCheck } from` — re-exported import"],
  ["loginAnd", "`a && check(…)` — helper under `&&`"],
  ["loginTernary", "`check(…) ? … : …` — helper as a ternary test"],
  ["loginEvery", "`[…].every(p => check(…))` — helper in a combinator lambda"],
  ["loginBound", "`const ok = check(…)` — helper bound, then tested"],
];

describe("S465 — an async function imported from another .scrml module is awaited on the server", () => {
  for (const [fn, label] of SHAPES) {
    test(`${label}: a WRONG password is rejected`, async () => {
      expect(await call(fn, { name: "bob", pass: "wrong-password" })).toBe("REJECTED");
    }, EXECUTED_DB_TIMEOUT_MS);
    test(`${label}: the right password is accepted`, async () => {
      expect(await call(fn, { name: "bob", pass: "right-password" })).toBe("WELCOME bob");
    }, EXECUTED_DB_TIMEOUT_MS);
  }

  test("no bare call of an imported async helper survives in the server bundle", () => {
    // Every call site reads `await check(` / `await ck(` / `await reCheck(`, or the
    // combinator lift's `async (p) => await check(`.
    const bare = serverJs.match(/(?<!await |function |\.)\b(check|ck|reCheck)\(/g) ?? [];
    expect(bare).toEqual([]);
  });
});

// A CPS-split function (it writes cells). On origin/main the statements after
// the server statement ran in the browser continuation, where `check(…)` was a
// bare fetch-stub call. Under §19.9.9.8 (s462-p0-cps) a statement that reads a
// server-originated value is server-tier, so the check runs IN the server batch
// — and there it must be awaited like any other server call site.
const CPS_APP = `<program db="./app.db">
\${ import { check } from "./lib.scrml" }
<seen> = ""
<busy> = false
function login(pass: string) {
  @busy = true
  const row = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!check(pass, row.pw)) { @seen = "REJECTED" } else { @seen = "WELCOME " + row.name }
  @busy = false
}
<button id="go" onclick={ login("wrong-password") }>login</button>
<p id="seen">\${@seen}</p>
</program>
`;

let cpsDir, cpsMod, cpsRoute;

beforeAll(async () => {
  cpsDir = mkdtempSync(join(tmpdir(), "s465-cps-"));
  const outDir = join(cpsDir, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(cpsDir, "lib.scrml"), LIB);
  const file = join(cpsDir, "app.scrml");
  writeFileSync(file, CPS_APP);
  const db = new Database(join(cpsDir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [await hashPassword("right-password")]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
  cpsMod = await import(`file://${join(outDir, "app.server.js")}?v=${Date.now()}-${Math.random()}`);
  cpsRoute = cpsMod.routes.find((r) => /__ri_route_login_\d+/.test(r.path));
}, EXECUTED_DB_TIMEOUT_MS);

afterAll(() => {
  if (cpsDir) rmSync(cpsDir, { recursive: true, force: true });
});

async function cpsCall(pass) {
  expect(cpsRoute).toBeDefined();
  const res = await cpsMod.fetch(new Request(`http://localhost${cpsRoute.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify({ pass }),
  }));
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("$argon2");
  return JSON.parse(text);
}

describe("S465 — a CPS-split function: the imported async helper runs in the server batch, awaited", () => {
  test("a WRONG password is rejected", async () => {
    expect((await cpsCall("wrong-password")).__scrml_cells.seen).toBe("REJECTED");
  }, EXECUTED_DB_TIMEOUT_MS);
  test("the right password is accepted", async () => {
    expect((await cpsCall("right-password")).__scrml_cells.seen).toBe("WELCOME bob");
  }, EXECUTED_DB_TIMEOUT_MS);
});
