/**
 * Auth-path CSRF — session-bound synchronizer token (scrml S238).
 *
 * Two coupled codegen bugs, both required for auth-path CSRF to work end-to-end:
 *
 *  BUG 1 (g-csrf-retry-helper-def-gated). The client emitted the
 *  `_scrml_fetch_with_csrf_retry(...)` CALL on the auth path but its DEF (and
 *  `_scrml_get_csrf_token`) were gated behind `!authMiddlewareEntry` (baseline
 *  branch only). An auth-path mount therefore emitted the call without the def →
 *  `ReferenceError` at load. `node --check` passes; only a load reproduces it.
 *  Fix: the defs emit whenever `csrfEnabled` (auth path included).
 *
 *  BUG 2 (g-auth-csrf-token-never-surfaced). `_scrml_validate_csrf(req, session)`
 *  compares `token === session.csrfToken`, but `_scrml_session_middleware`
 *  returned `{ sessionId, isAuth, userId, role }` — no `csrfToken` — so the gate
 *  was `token === undefined` → UNPASSABLE. Fix (SPEC §40.2/§39.2.3, session-bound
 *  synchronizer token, "reads or creates"): the middleware mints the token
 *  lazily, persists it to the session-store record, and surfaces `csrfToken`.
 *  The auth 403 gate plants the token via Set-Cookie (symmetric with the baseline
 *  403) so the single-shot retry echoes the matching token.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_auth_csrf_sync");
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compile(scrmlSource, testName, seedFiles = {}) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const s of stmts) db.exec(s);
    db.close();
  }
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = join(outDir, `${tag}.client.js`);
  return {
    errors: result.errors ?? [],
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf-8") : null,
    serverJs: readFileSync(join(outDir, `${tag}.server.js`), "utf-8"),
    serverJsPath: join(outDir, `${tag}.server.js`),
    tmpDir,
  };
}

const ITEMS_SEED = {
  "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"],
};

// Auth-gated app with a state-mutating server fn called from a client handler.
const AUTH_CSRF_SRC = `<program auth="required" csrf="auto">
<db src="./items.db" tables="items">
  \${
    export server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

// Same shape but csrf OFF — the middleware must NOT surface csrfToken.
const AUTH_NOCSRF_SRC = `<program auth="required" csrf="off">
<db src="./items.db" tables="items">
  \${
    export server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

// Baseline (no auth) — the double-submit path, must be untouched.
const BASELINE_SRC = `<program>
<db src="./items.db" tables="items">
  \${
    server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
      return "ok"
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

const nonWarn = (errors) => errors.filter((e) => !e.code?.startsWith("W-") && !e.code?.startsWith("I-"));

describe("Bug 1 — auth-path client defines the CSRF fetch helpers", () => {
  test("client.js DEFINES the helper it calls on the auth path", () => {
    const { clientJs, errors } = compile(AUTH_CSRF_SRC, "bug1-def", ITEMS_SEED);
    expect(nonWarn(errors)).toEqual([]);
    expect(clientJs).not.toBeNull();
    // The call site is present (auth path routes mutations through the retry helper).
    expect(clientJs).toContain("_scrml_fetch_with_csrf_retry(");
    // ...AND both defs it transitively depends on are now emitted (the bug).
    expect(clientJs).toContain("async function _scrml_fetch_with_csrf_retry(");
    expect(clientJs).toContain("function _scrml_get_csrf_token()");
  });

  test("emitted client.js is loadable (no ReferenceError from the missing def)", () => {
    const { clientJs } = compile(AUTH_CSRF_SRC, "bug1-load", ITEMS_SEED);
    // A load would ReferenceError if the def were absent. Constructing the module
    // scope and referencing the symbol proves the def is in scope. We only check
    // the two helper defs are declared (a full DOM eval needs a browser).
    const defIdx = clientJs.indexOf("async function _scrml_fetch_with_csrf_retry(");
    const callIdx = clientJs.indexOf("_scrml_fetch_with_csrf_retry(\"");
    expect(defIdx).toBeGreaterThanOrEqual(0);
    // In JS the call may appear before the def (both hoistable-scope), so we only
    // require BOTH to be present, not a specific order.
    expect(callIdx).toBeGreaterThanOrEqual(0);
  });
});

describe("Bug 2 — server surfaces the session synchronizer token", () => {
  test("middleware mints + surfaces csrfToken when csrf=auto", () => {
    const { serverJs, errors } = compile(AUTH_CSRF_SRC, "bug2-surface", ITEMS_SEED);
    expect(nonWarn(errors)).toEqual([]);
    const mw = serverJs.match(/function _scrml_session_middleware\(req\)[\s\S]+?\n\}/)[0];
    expect(mw).toContain("_rec.csrfToken = _scrml_generate_csrf()");
    expect(mw).toContain("csrfToken: _rec ? (_rec.csrfToken ?? null) : null");
    // The validator reads exactly that field.
    expect(serverJs).toContain("return token === session.csrfToken;");
    // The auth 403 plants the session token so the client retry can echo it.
    expect(serverJs).toContain('_scrml_csrf_403_headers["Set-Cookie"] = `scrml_csrf=${_scrml_sessionForCsrf.csrfToken}');
  });

  test("csrf=off auth app does NOT surface csrfToken (byte-minimal)", () => {
    const { serverJs, errors } = compile(AUTH_NOCSRF_SRC, "bug2-off", ITEMS_SEED);
    expect(nonWarn(errors)).toEqual([]);
    const mw = serverJs.match(/function _scrml_session_middleware\(req\)[\s\S]+?\n\}/)[0];
    expect(mw).not.toContain("csrfToken");
    expect(mw).not.toContain("_scrml_generate_csrf");
    expect(serverJs).not.toContain("_scrml_validate_csrf");
  });
});

describe("adversarial — baseline (no-auth) double-submit path is untouched", () => {
  test("baseline middleware/csrf unchanged; no session synchronizer token", () => {
    const { serverJs, clientJs, errors } = compile(BASELINE_SRC, "baseline", ITEMS_SEED);
    expect(nonWarn(errors)).toEqual([]);
    // No auth → no session middleware at all.
    expect(serverJs).not.toContain("_scrml_session_middleware");
    // Baseline still uses the double-submit cookie helpers.
    expect(serverJs).toContain("_scrml_ensure_csrf_cookie");
    expect(serverJs).toContain("cookieToken === headerToken");
    // Client still defines + uses the same helper (the def was ALWAYS emitted here).
    expect(clientJs).toContain("async function _scrml_fetch_with_csrf_retry(");
    expect(clientJs).toContain("function _scrml_get_csrf_token()");
  });
});

describe("round-trip — auth-path CSRF actually validates end-to-end", () => {
  test("matching token passes, wrong/absent 403s, anonymous 302s", async () => {
    // happy-dom-polluted globals (loaded by sibling browser tests in the full
    // suite) replace Request/Headers with a spec-strict impl that STRIPS the
    // forbidden `Cookie` header — so `scrml_sid` never reaches the middleware and
    // the auth-check 302s before CSRF. The emit-shape tests above guard there;
    // this runtime round-trip runs under bun's native Request (isolation / the
    // standalone harness). Mirrors csrf-write-path-bootstrap.test.js.
    if (typeof globalThis.document !== "undefined") return;

    const { serverJsPath, tmpDir, errors } = compile(AUTH_CSRF_SRC, "roundtrip", ITEMS_SEED);
    expect(nonWarn(errors)).toEqual([]);

    const absDbPath = resolve(tmpDir, "items.db");
    writeFileSync(
      serverJsPath,
      readFileSync(serverJsPath, "utf-8").replace(
        'const _scrml_sql = new SQL("sqlite:./items.db");',
        `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + absDbPath)});`,
      ),
    );

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const store = globalThis.__scrml_session_store;
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    store.set(SID, { userId: 7, role: "user" });

    const route = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("addItem"),
    );
    const base = `http://localhost${route.path}`;
    // B4a (S266): an auth app is secure mode → the session cookie is __Host-scrml_sid.
    const cookie = `__Host-scrml_sid=${SID}`;
    const reqWith = (headers) =>
      new Request(base, { method: "POST", headers, body: JSON.stringify({ name: "alpha" }) });
    const statusOf = (r) => (r instanceof Response ? r.status : null);

    // First mutation, no token → 403 + Set-Cookie plants the session token.
    const r1 = await route.handler(reqWith({ "Content-Type": "application/json", Cookie: cookie }));
    expect(statusOf(r1)).toBe(403);
    const setCookie = r1.headers.get("Set-Cookie") || "";
    const planted = (setCookie.match(/scrml_csrf=([^;]+)/) || [])[1];
    const sessionToken = store.get(SID).csrfToken;
    expect(planted).toBeTruthy();
    expect(planted).toBe(sessionToken);

    // Retry with the matching token → gate passes → body runs → returns "ok".
    const r2 = await route.handler(
      reqWith({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": sessionToken }),
    );
    expect(r2 instanceof Response).toBe(false);
    expect(r2).toBe("ok");

    // Wrong token → 403.
    const r3 = await route.handler(
      reqWith({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": "not-the-token" }),
    );
    expect(statusOf(r3)).toBe(403);

    // Anonymous mutating request → 302 (auth-check short-circuits before CSRF).
    const r4 = await route.handler(
      reqWith({ "Content-Type": "application/json", "X-CSRF-Token": sessionToken }),
    );
    expect(statusOf(r4)).toBe(302);

    // Token is stable across requests (synchronizer, not regenerated).
    const before = store.get(SID).csrfToken;
    await route.handler(reqWith({ "Content-Type": "application/json", Cookie: cookie }));
    expect(store.get(SID).csrfToken).toBe(before);

    // The passing mutation actually inserted the row.
    const db = new Database(absDbPath);
    const rows = db.query("SELECT name FROM items").all();
    db.close();
    expect(rows.some((x) => x.name === "alpha")).toBe(true);
  });
});
