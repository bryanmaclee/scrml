/**
 * S462 Q20 (ruling "q20 yes.") — the server Promise trap, EXECUTED.
 *
 * SPEC §13.2: in server code, a boolean-test position whose operand is a direct
 * call to a `scrml:` standard-library import is checked at runtime; a Promise
 * there fails the request with an internal error (HTTP 500), never a truthy pass.
 * It backstops the auto-await classifier: three S462 bypasses (an aliased import,
 * a sync-declared async shim, an optional call) each left `verifyPassword(…)`
 * un-awaited, and a Promise is truthy, so every password was accepted.
 *
 * DEFEATED CLASSIFIER — the test seam `__testOnlyForceAwaitClassifierMiss`
 * (module-resolver.js; nothing in the compiler, CLI or config sets it) makes the
 * classifier MISS `verifyPassword`, so the compiler emits its calls un-awaited:
 * exactly a future classifier bug. Each app is compiled, its server bundle is
 * imported under bun with a real bun:sqlite database, and each route is driven
 * over HTTP through a `Bun.serve` whose `error:` handler is the one the prod
 * entry (`generateServerEntry`) emits.
 *
 *   D — classifier defeated: every direct boolean test of the call answers the
 *       prod entry's fixed 500 ("Internal Server Error"). Never ACCEPTED.
 *   L — the stated limit, pinned: a result stored in a variable and tested later
 *       is NOT covered — under the defeated classifier it still passes.
 *   N — classifier intact: the same routes, wrapped, keep their results: a wrong
 *       password is REJECTED, the right one ACCEPTED.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";
import { __testOnlyForceAwaitClassifierMiss } from "../../src/module-resolver.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";
import { assertOpensDb } from "../helpers/self-host-server-import.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

// Native fetch / Request / Response (see protect-error-egress.test.js: an earlier
// file in the same process can leave happy-dom's globals installed).
beforeAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const APP = `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" tables="users">
    \${
      import { verifyPassword as vp, verifyPassword } from "scrml:auth"

      function loginNot(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        if (!verifyPassword(pass, row.pw)) { return "REJECTED" }
        return "ACCEPTED"
      }
      function loginIf(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        if (vp(pass, row.pw)) { return "ACCEPTED" }
        return "REJECTED"
      }
      function loginOpt(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        if (verifyPassword?.(pass, row.pw)) { return "ACCEPTED" }
        return "REJECTED"
      }
      function loginAnd(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        if (name != "" && vp(pass, row.pw)) { return "ACCEPTED" }
        return "REJECTED"
      }
      function loginTernary(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        return verifyPassword(pass, row.pw) ? "ACCEPTED" : "REJECTED"
      }
      function loginStored(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        const ok = verifyPassword(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"
      }
    }
  </db>
  <out> = ""
  <button onclick={ @out = loginNot("ada", "x") !{ .Transport(_) :> { return } } }>a</button>
  <button onclick={ @out = loginIf("ada", "x") !{ .Transport(_) :> { return } } }>b</button>
  <button onclick={ @out = loginOpt("ada", "x") !{ .Transport(_) :> { return } } }>c</button>
  <button onclick={ @out = loginAnd("ada", "x") !{ .Transport(_) :> { return } } }>d</button>
  <button onclick={ @out = loginTernary("ada", "x") !{ .Transport(_) :> { return } } }>e</button>
  <button onclick={ @out = loginStored("ada", "x") !{ .Transport(_) :> { return } } }>f</button>
</program>
`;

/** The `error(err) { … }` member the prod entry puts on Bun.serve, as a function. */
function prodErrorHandler() {
  const entry = generateServerEntry([]);
  const m = /\n  error\(err\) \{\n[\s\S]*?\n  \},\n/.exec(entry);
  expect(m).not.toBeNull();
  return new Function(`return {${m[0]}};`)().error;
}

const TMP = mkdtempSync(join(tmpdir(), "s462-q20-trap-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
/** Compile APP (optionally with the classifier defeated), seed the db, serve it. */
async function serveApp(defeatClassifier) {
  const dir = join(TMP, `a${seq++}`);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, APP);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('ada', ?)", [await hashPassword("right-password")]);
  db.close();
  const prev = __testOnlyForceAwaitClassifierMiss(defeatClassifier ? ["verifyPassword"] : null);
  let result;
  try {
    result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  } finally {
    __testOnlyForceAwaitClassifierMiss(prev);
  }
  const fatal = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  expect(fatal.map((e) => e.code + " " + e.message)).toEqual([]);
  const serverJsPath = join(outDir, "app.server.js");
  assertOpensDb(serverJsPath, dbPath);
  const serverJs = readFileSync(serverJsPath, "utf8");
  const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const server = Bun.serve({
    port: 0,
    development: true,
    error: prodErrorHandler(),
    async fetch(req) {
      const r = mod.routes.find((x) => x.path === new URL(req.url).pathname);
      return r ? r.handler(req) : new Response("nf", { status: 404 });
    },
  });
  const origError = console.error;
  const post = async (fnName, args) => {
    const route = mod.routes.find((r) => new RegExp(`/__ri_route_${fnName}_\\d+$`).test(r.path));
    expect(route).toBeTruthy();
    console.error = () => {}; // the server-side log line of a 500 is expected
    try {
      const res = await fetch(`http://localhost:${server.port}${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
        body: JSON.stringify(args),
      });
      return { status: res.status, body: await res.text() };
    } finally {
      console.error = origError;
    }
  };
  return { post, serverJs, clientJs, stop: () => server.stop(true) };
}

const WRONG = { name: "ada", pass: "wrong-password" };
const RIGHT = { name: "ada", pass: "right-password" };
const DIRECT = ["loginNot", "loginIf", "loginOpt", "loginAnd", "loginTernary"];

describe("D — classifier defeated: a direct boolean test of the un-awaited call fails CLOSED", () => {
  let app;
  beforeAll(async () => { app = await serveApp(true); }, EXECUTED_DB_TIMEOUT_MS);
  afterAll(() => app?.stop());

  test("the seam really defeated the classifier: verifyPassword is emitted un-awaited", () => {
    expect(app.serverJs).not.toMatch(/await (vp|verifyPassword)\b/);
    expect(app.serverJs).toContain("if (!_scrml_assert_settled(verifyPassword(pass, row.pw)))");
    expect(app.serverJs).toContain("function _scrml_assert_settled(value)");
    expect(app.clientJs).not.toContain("_scrml_assert_settled");
  });

  for (const fn of DIRECT) {
    test(`${fn}: a WRONG password answers 500, not ACCEPTED`, async () => {
      const r = await app.post(fn, WRONG);
      expect(r.status).toBe(500);
      expect(r.body).toBe("Internal Server Error");
      expect(r.body).not.toContain("ACCEPTED");
    }, EXECUTED_DB_TIMEOUT_MS);
    test(`${fn}: the right password answers 500 too (the result was never settled)`, async () => {
      expect((await app.post(fn, RIGHT)).status).toBe(500);
    }, EXECUTED_DB_TIMEOUT_MS);
  }

  test("L — the stated limit: a result stored in a variable and tested later is NOT covered", async () => {
    // Pinned so a change in coverage is a deliberate SPEC change, not a drift.
    expect(app.serverJs).toContain("const ok = verifyPassword(pass, row.pw);");
    expect(await app.post("loginStored", WRONG)).toEqual({ status: 200, body: JSON.stringify("ACCEPTED") });
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("N — classifier intact: the wrapped tests keep their results", () => {
  let app;
  beforeAll(async () => { app = await serveApp(false); }, EXECUTED_DB_TIMEOUT_MS);
  afterAll(() => app?.stop());

  test("the trap wraps the awaited call: one function call on a settled value", () => {
    expect(app.serverJs).toContain("if (!_scrml_assert_settled(await verifyPassword(pass, row.pw)))");
  });

  for (const fn of [...DIRECT, "loginStored"]) {
    test(`${fn}: a WRONG password is REJECTED`, async () => {
      expect(await app.post(fn, WRONG)).toEqual({ status: 200, body: JSON.stringify("REJECTED") });
    }, EXECUTED_DB_TIMEOUT_MS);
    test(`${fn}: the right password is ACCEPTED`, async () => {
      expect(await app.post(fn, RIGHT)).toEqual({ status: 200, body: JSON.stringify("ACCEPTED") });
    }, EXECUTED_DB_TIMEOUT_MS);
  }

  test("an unknown user is NOUSER (the trap does not touch other tests)", async () => {
    expect(await app.post("loginIf", { name: "bob", pass: "x" })).toEqual({ status: 200, body: JSON.stringify("NOUSER") });
  }, EXECUTED_DB_TIMEOUT_MS);
});
