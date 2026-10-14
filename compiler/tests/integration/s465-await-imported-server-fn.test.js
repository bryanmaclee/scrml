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
 * mechanism) — answers true for them. A CPS wrapper's client continuation (which
 * never ran through the client fn-body await injector) now gets the same
 * injector over the same candidate set.
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
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

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

// A CPS-split function: its server statement runs on the server, its later
// statements in the browser continuation `async function _scrml_cps_<fn>`. That
// continuation never ran through the client fn-body await injector, so
// `if (!check(…))` on the imported async helper tested a pending Promise.
const CPS_APP = `<program db="./app.db">
\${ import { check } from "./lib.scrml" }
<out> = ""
<seen> = ""
function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!check(pass, @out.pw)) { @seen = "REJECTED" } else { @seen = "WELCOME " + @out.name }
}
<button id="go" onclick={ login("wrong-password") }>login</button>
<p id="seen">\${@seen}</p>
</program>
`;

// Executed in happy-dom exactly as the page loads it: the runtime, then
// `lib.client.js` (which registers the imported module), then `app.client.js`,
// each as its own classic script. The server routes are answered by a stub
// fetch keyed by the source fn name (`login` returns the row, `check` answers
// the password test), so the test isolates the browser continuation.
async function runCps(checkAnswer) {
  const d = mkdtempSync(join(tmpdir(), "s465-cps-"));
  try {
    writeFileSync(join(d, "lib.scrml"), LIB);
    const file = join(d, "app.scrml");
    writeFileSync(file, CPS_APP);
    const result = compileScrml({ inputFiles: [file], write: false, outputDir: join(d, "dist"), log: () => {} });
    expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    const app = result.outputs.get(file);
    const lib = result.outputs.get(join(d, "lib.scrml"));
    expect(app?.clientJs).toBeTruthy();
    expect(lib?.clientJs).toBeTruthy();
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    const g = globalThis;
    const RealResponse = g.Response;
    g.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      const m = /__ri_route_([A-Za-z]+)_\d+/.exec(String(url));
      const body = m && m[1] === "login" ? { name: "bob", pw: "h" } : m && m[1] === "check" ? checkAnswer : null;
      return new RealResponse(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const bodyHtml = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(app.html) ?? [null, app.html])[1];
    g.document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    // One function scope (as the conformance adapter does) so the runtime's
    // top-level bindings never leak into the global lexical scope of later test
    // files in the same process; each client bundle is already its own IIFE.
    (0, eval)("(function () {\n" + SCRML_RUNTIME + "\n" + lib.clientJs + "\n" + app.clientJs + "\n})();");
    g.document.dispatchEvent(new g.Event("DOMContentLoaded", { bubbles: true }));
    g.document.querySelector("#go").click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    return g.document.querySelector("#seen").textContent.trim();
  } finally {
    rmSync(d, { recursive: true, force: true });
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  }
}

describe("S465 — a CPS-split function's browser continuation awaits an imported async helper", () => {
  test("the helper answers false → REJECTED", async () => {
    expect(await runCps(false)).toBe("REJECTED");
  }, EXECUTED_DB_TIMEOUT_MS);
  test("the helper answers true → WELCOME", async () => {
    expect(await runCps(true)).toBe("WELCOME bob");
  }, EXECUTED_DB_TIMEOUT_MS);
});
