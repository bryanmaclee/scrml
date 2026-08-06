/**
 * A server-fn route handler SHALL return a `Response` — driven over HTTP.
 *
 * g-authed-server-fn-route-returns-bare-value-not-response (HIGH, S325).
 *
 * THE DEFECT. A server-fn handler emitted a real `Response` only when
 * `useBaselineCsrf` (`!authMiddlewareEntry && isStateMutating && _webAppShape`)
 * or the A9-Ext-5 idempotency flag was set. Otherwise the adopter's `return`
 * became the HANDLER's `return` verbatim, or was wrapped only by
 * `_egressRedact`. Both hosts the compiler ships dispatch with
 * `return route.handler(req)` (`dev.js`, the built `_server.js`) and so does the
 * emitted WinterCG `fetch` aggregate — so a bare value went straight to Bun.
 *
 * WHAT BUN ACTUALLY DOES WITH IT, measured over a real socket on Bun 1.3.14.
 * The two halves differ, and the difference is why this leaked so quietly:
 *   WIRE   `200 text/plain;charset=utf-8`, body = the CONSTANT
 *          "Welcome to Bun! To get started, return a Response object."
 *          for EVERY non-Response return — string, number, object, undefined,
 *          null alike. The adopter's value is DROPPED, never transmitted.
 *   STDERR `error: Expected a Response object, but received '<value>'`, and
 *          ONLY for `undefined` / `null`. A bare `"ok"` / `42` / `{…}` logs
 *          NOTHING AT ALL.
 * So the auth gate passed, the CSRF gate passed, the body ran, the value was
 * correct — the client received a fixed English sentence, and for the common
 * return shapes the server said nothing about it.
 *
 * The predicate is WIDER than `auth=`: `auth=` is sufficient (it zeroes
 * `useBaselineCsrf`) but not necessary — `protect=` / tenant-active does it too.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SHAPED LIKE THIS. The class survived
 * because of how the tests were written, not because of a coding mistake. The
 * pre-existing round-trips called `route.handler(req)` DIRECTLY and inspected
 * the raw return, with helpers that tolerated either shape
 * (`r instanceof Response ? await r.json() : r`, `statusOf → null`) — and one
 * that asserted the defect outright
 * (`expect(r2 instanceof Response).toBe(false); expect(r2).toBe("ok")`).
 * A test written that way CANNOT observe this bug.
 *
 * So this file NEVER calls `route.handler(req)`. Every runtime assertion goes
 * through `Server.fetch(new Request(...))` on a real `Bun.serve` server built
 * over the emitted WinterCG `fetch` aggregate — the same seam a deployment
 * dispatches through. Per the S273 ruling there is NO real socket: a
 * full-bundle-over-HTTP round trip is cloud-runner-infra-flaky. `Server.fetch`
 * gives host dispatch without the port.
 *
 * (Fidelity note: `Server.fetch()` hands a bare return straight back to the
 * caller rather than synthesizing the `Welcome to Bun!` text/plain 200 — that
 * synthesis is on the socket path. Either way a bare return fails
 * `expect(res).toBeInstanceOf(Response)`, and a fall-off-the-end handler makes
 * `Server.fetch` throw `fetch() returned an empty value`. The gate bites.)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { parse as acornParse } from "acorn";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_authed_server_fn_response");
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

const ITEMS_SEED = [
  "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, secret TEXT)",
  "INSERT INTO items (name, secret) VALUES ('alpha', 'hunter2')",
];

function compile(scrmlSource, tagBase) {
  const tag = `${tagBase}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(outDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  writeFileSync(tmpInput, scrmlSource);

  const dbPath = resolve(tmpDir, "items.db");
  const db = new Database(dbPath, { create: true });
  for (const s of ITEMS_SEED) db.exec(s);
  db.close();

  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const serverJsPath = join(outDir, `${tag}.server.js`);
  // The emitted handle is `new SQL("sqlite:./items.db")`, relative to CWD —
  // rewrite to the absolute seeded file so the module resolves it wherever the
  // suite runs from. (Same rewrite the sibling auth round-trips perform.)
  if (existsSync(serverJsPath)) {
    writeFileSync(
      serverJsPath,
      readFileSync(serverJsPath, "utf-8").replace(
        'const _scrml_sql = new SQL("sqlite:./items.db");',
        `const _scrml_sql = new SQL(${JSON.stringify("sqlite:" + dbPath)});`,
      ),
    );
  }
  return {
    errors: (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "")),
    serverJs: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf-8") : null,
    serverJsPath,
    dbPath,
  };
}

/**
 * Load the emitted bundle and stand up a real `Bun.serve` server over its
 * WinterCG `fetch` aggregate. `port: 0` = never binds a fixed port; every call
 * goes through `server.fetch(Request)`, so no socket is ever opened.
 */
async function serveBundle(serverJsPath) {
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const server = Bun.serve({
    port: 0,
    fetch: (req) => mod.fetch(req),
  });
  return { mod, server, stop: () => server.stop(true) };
}

/**
 * Assert the fundamental contract on one HTTP exchange and hand back the parsed
 * body. THIS is the assertion the whole file exists for.
 */
async function expectJsonResponse(res, status = 200) {
  expect(res).toBeInstanceOf(Response);
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  return await res.json();
}

// happy-dom (registered globally by sibling browser tests in a full-suite run)
// replaces Request/Headers with a spec-strict implementation that STRIPS the
// forbidden `Cookie` header — so no session or double-submit cookie can reach a
// handler and every gate short-circuits. The runtime exchanges below need bun's
// native Request. The EMISSION-shape describe block at the bottom has no such
// dependency and always runs.
const domPolluted = () => typeof globalThis.document !== "undefined";

// ---------------------------------------------------------------------------
// The four app shapes the brief names.
// ---------------------------------------------------------------------------

// (1) auth="required" — `authMiddlewareEntry` is set, so `useBaselineCsrf` is
//     FALSE and this is the headline shape of the defect.
const AUTH_REQUIRED = `<program auth="required" csrf="auto">
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

// (2) protect= WITHOUT auth — proves the predicate is wider than `auth=`.
//     A protected column turns on `_protectActive`, which took the
//     `return _egressRedact(_scrml_result);` raw-value exit.
const PROTECT_NO_AUTH = `<program>
<db src="./items.db" tables="items" protect="secret">
  \${
    server function loadNames() {
      <rows> = ?{\`SELECT id, name FROM items\`}.all()
      return @rows
    }
  }
  <button onclick=loadNames()>Load</button>
</>
</program>`;

// (3) BOTH — auth= and protect= together.
const AUTH_AND_PROTECT = `<program auth="required" csrf="auto">
<db src="./items.db" tables="items" protect="secret">
  \${
    export server function loadNames() {
      <rows> = ?{\`SELECT id, name FROM items\`}.all()
      return @rows
    }
  }
  <button onclick=loadNames()>Load</button>
</>
</program>`;

// (4) NO-AUTH CONTROL — state-mutating, no auth, no protect → `useBaselineCsrf`
//     is TRUE. This path ALREADY returned a `Response` and must be unchanged,
//     including its baseline double-submit `Set-Cookie: scrml_csrf=…`.
const NO_AUTH_CONTROL = `<program>
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

// (5) A VOID body — no `return` at all. Must still produce a well-formed
//     `Response`; before the fix control fell off the end of the handler and
//     `Server.fetch` throws `fetch() returned an empty value`.
const AUTH_VOID_RETURN = `<program auth="required" csrf="auto">
<db src="./items.db" tables="items">
  \${
    export server function addItem(name) {
      ?{\`INSERT INTO items (name) VALUES (\${name})\`}.run()
    }
  }
  <button onclick=addItem("x")>Add</button>
</>
</program>`;

// (6) SESSION ESTABLISHMENT — `session.set` with no `auth=`. The login fn is
//     state-mutating so it rides `useBaselineCsrf`; the WHOAMI read-back proves
//     the sid cookie actually reached the client. See the describe block for
//     why this is part of the same defect.
const SESSION_LOGIN = `<program>
  \${
    server function login(email, password) {
      if (email == "admin@x.com" && password == "secret") {
        session.set("userId", "u-42")
        return "ok"
      }
      return "bad"
    }
    server function whoami() {
      return { userId: session.userId, isAuth: session.isAuth }
    }
  }
  <button onclick=login("a","b")>L</button>
  <button onclick=whoami()>W</button>
</program>`;

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Emission-shape analysis, via the real parser.
//
// A text/regex "does the tail contain `return new Response(`" check is exactly
// the kind of approximation that let this class hide. These helpers parse the
// emitted module with acorn and reason over the handler's OWN scope: an IIFE's
// `return` is NOT a handler exit, and a handler that can reach its closing brace
// returns `undefined`.
// ---------------------------------------------------------------------------

/** Every `return` in this function's own scope (never descends into a nested fn). */
function ownScopeReturns(fnNode) {
  const out = [];
  const rec = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) rec(c); return; }
    if (!n.type) return;
    if (n !== fnNode && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) return;
    if (n.type === "ReturnStatement") out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      rec(n[k]);
    }
  };
  rec(fnNode.body);
  return out;
}

/**
 * Return statements narrowed by an `if (<id> instanceof Response)` test that
 * return that same `<id>` — the passthrough guard. Collected as a node Set so
 * the exit analysis can honour the narrowing instead of reporting the guard's
 * own `return _scrml_result;` as a bare exit.
 */
function responseGuardedReturns(fnNode) {
  const guarded = new Set();
  const rec = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) rec(c); return; }
    if (!n.type) return;
    if (n !== fnNode && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) return;
    if (n.type === "IfStatement"
        && n.test.type === "BinaryExpression" && n.test.operator === "instanceof"
        && n.test.left.type === "Identifier"
        && n.test.right.type === "Identifier" && n.test.right.name === "Response") {
      const narrowed = n.test.left.name;
      const arm = n.consequent.type === "BlockStatement" ? n.consequent.body : [n.consequent];
      for (const s of arm) {
        if (s.type === "ReturnStatement" && s.argument?.type === "Identifier" && s.argument.name === narrowed) {
          guarded.add(s);
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      rec(n[k]);
    }
  };
  rec(fnNode.body);
  return guarded;
}

/** `new Response(…)`, or a compiler guard variable that only ever holds one. */
function yieldsResponse(expr) {
  if (!expr) return false;
  if (expr.type === "NewExpression" && expr.callee.type === "Identifier" && expr.callee.name === "Response") return true;
  // `const _scrml_authResult = _scrml_auth_check(req); if (_scrml_authResult) return _scrml_authResult;`
  if (expr.type === "Identifier" && /^_scrml_(authResult|csrf_403|slAuth)/.test(expr.name)) return true;
  if (expr.type === "AwaitExpression") return yieldsResponse(expr.argument);
  if (expr.type === "ConditionalExpression") return yieldsResponse(expr.consequent) && yieldsResponse(expr.alternate);
  return false;
}

/** Conservatively: can control reach the end of this statement list? */
function completesNormally(stmts) {
  for (const s of stmts) {
    if (!s) continue;
    if (s.type === "ReturnStatement" || s.type === "ThrowStatement") return false;
    if (s.type === "BlockStatement" && !completesNormally(s.body)) return false;
    if (s.type === "IfStatement" && s.alternate) {
      const arm = (a) => (a.type === "BlockStatement" ? completesNormally(a.body) : completesNormally([a]));
      if (!arm(s.consequent) && !arm(s.alternate)) return false;
    }
    if (s.type === "TryStatement") {
      const b = completesNormally(s.block.body);
      const h = s.handler ? completesNormally(s.handler.body.body) : true;
      const f = s.finalizer ? completesNormally(s.finalizer.body) : true;
      if (!f) return false;
      if (!b && !h) return false;
    }
  }
  return true;
}

/**
 * Every function the emitted `routes` array names as a handler, with its
 * non-Response exits and whether control can fall off its end.
 */
function analyzeHandlers(js) {
  const ast = acornParse(js, { ecmaVersion: "latest", sourceType: "module" });
  const named = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if (!n.type) return;
    if (n.type === "ObjectExpression") {
      const props = n.properties.filter((p) => p.type === "Property" && p.key);
      const key = (p) => p.key.name ?? p.key.value;
      const h = props.find((p) => key(p) === "handler");
      if (h && props.some((p) => key(p) === "path")) {
        if (h.value.type === "Identifier") named.add(h.value.name);
        // `handler: _scrml_session_cookie_wrap(_scrml_mw_wrap(fn))` — unwrap.
        let c = h.value;
        while (c && c.type === "CallExpression" && c.arguments[0]) {
          c = c.arguments[0];
          if (c.type === "Identifier") named.add(c.name);
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
      walk(n[k]);
    }
  };
  walk(ast);

  const out = [];
  for (const stmt of ast.body) {
    const fn = stmt.type === "FunctionDeclaration" ? stmt
      : (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "FunctionDeclaration") ? stmt.declaration
      : null;
    // Only the server-fn route handlers. `serverLoad` / `<endpoint>` /
    // `/_scrml/*` handlers are covered by their own suites and are deliberately
    // not this file's subject.
    if (!fn || !fn.id || !named.has(fn.id.name) || !/handler_/.test(fn.id.name)) continue;
    const guarded = responseGuardedReturns(fn);
    out.push({
      name: fn.id.name,
      fallsOff: completesNormally(fn.body.body),
      bareReturns: ownScopeReturns(fn)
        .filter((r) => !yieldsResponse(r.argument) && !guarded.has(r))
        .map((r) => js.slice(r.start, Math.min(r.end, r.start + 90)).replace(/\s+/g, " ")),
    });
  }
  return out;
}

/** Find a route record by a fragment of its path. */
function routeFor(mod, frag) {
  const routes = mod.routes ?? [];
  const r = routes.find((x) => typeof x.path === "string" && x.path.includes(frag));
  expect(r).toBeTruthy();
  return r;
}

function readSetCookie(res, name) {
  const all = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("Set-Cookie") ?? ""];
  for (const c of all) {
    const m = c.match(new RegExp(`${name}=([^;]*)`));
    if (m) return { value: m[1], raw: c };
  }
  return null;
}

/**
 * Drive one POST on an app that carries an auth middleware entry — either an
 * explicit `<program auth="required">` OR a `protect=`/tenant app, where the
 * compiler AUTO-INJECTS the auth middleware. (That auto-injection is precisely
 * why the defect's predicate is wider than `auth=`: it sets
 * `authMiddlewareEntry`, which zeroes `useBaselineCsrf`.)
 *
 * Performs the §40.2 session-synchronizer handshake a real client performs:
 * a first POST with no token 403s and plants the token on the session record;
 * the retry echoes it as `X-CSRF-Token`. Returns the FINAL response.
 */
async function authedPost(server, path, body) {
  const store = globalThis.__scrml_session_store;
  const sid = `sid-${Math.random().toString(36).slice(2)}`;
  store.set(sid, { userId: 7, role: "user" });
  // An auth-bearing app is secure cookie mode (B4a) → `__Host-scrml_sid`.
  const cookie = `__Host-scrml_sid=${sid}`;
  const send = (headers) =>
    server.fetch(new Request(`http://localhost${path}`, {
      method: "POST", headers, body: JSON.stringify(body ?? {}),
    }));

  const first = await send({ "Content-Type": "application/json", Cookie: cookie });
  // The gate short-circuits above the body, so this was already a Response
  // before the fix — assert it anyway so a regression here is not silent.
  expect(first).toBeInstanceOf(Response);
  if (first.status !== 403) return { res: first, sid, first };

  const token = store.get(sid).csrfToken;
  const res = await send({ "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": token });
  return { res, sid, first };
}

/**
 * Drive one POST on a no-auth app — the baseline double-submit cookie path
 * (`useBaselineCsrf`). First POST 403s and mints `scrml_csrf`; the retry echoes
 * it in both the cookie and the header.
 */
async function baselinePost(server, path, body) {
  const send = (headers) =>
    server.fetch(new Request(`http://localhost${path}`, {
      method: "POST", headers, body: JSON.stringify(body ?? {}),
    }));
  const first = await send({ "Content-Type": "application/json" });
  expect(first).toBeInstanceOf(Response);
  if (first.status !== 403) return { res: first, csrf: null, first };
  const csrf = readSetCookie(first, "scrml_csrf").value;
  const res = await send({
    "Content-Type": "application/json",
    Cookie: `scrml_csrf=${csrf}`,
    "X-CSRF-Token": csrf,
  });
  return { res, csrf, first };
}

describe("auth=\"required\" — the handler answers a real 200 JSON Response over HTTP", () => {
  test("the authenticated, CSRF-valid mutation returns a Response, not the bare body value", async () => {
    if (domPolluted()) return; // native Request required (see note above)

    const { serverJsPath, dbPath, errors } = compile(AUTH_REQUIRED, "auth-required");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res, first } = await authedPost(server, routeFor(mod, "addItem").path, { name: "alpha-http" });
      // The handshake's first leg 403s and plants the §40.2 session token.
      expect(first.status).toBe(403);
      // The retry passes the gate, the body RUNS, and the handler must answer a
      // real Response. THIS is the exchange that was broken: correct value,
      // garbage response.
      expect(await expectJsonResponse(res)).toBe("ok");

      // …and the body really executed (not a short-circuit that happens to
      // serialize the right constant).
      const db = new Database(dbPath);
      const rows = db.query("SELECT name FROM items").all();
      db.close();
      expect(rows.some((x) => x.name === "alpha-http")).toBe(true);
    } finally { stop(); }
  });

  test("a void (no-`return`) body still produces a well-formed Response", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(AUTH_VOID_RETURN, "auth-void");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res } = await authedPost(server, routeFor(mod, "addItem").path, { name: "void-body" });
      // Before the fix control fell off the end of the handler, and
      // `Server.fetch` throws `fetch() returned an empty value` on that.
      expect(await expectJsonResponse(res)).toBe(null);
    } finally { stop(); }
  });
});

describe("protect= without an explicit auth= — the predicate is wider than auth=", () => {
  // `protect=` AUTO-INJECTS the auth middleware, which is exactly the mechanism
  // of the widening: it sets `authMiddlewareEntry`, which zeroes
  // `useBaselineCsrf`, which took the handler off the Response-emitting path.
  // The source declares no `auth=` anywhere.
  test("the app has NO source-level auth= yet still carries an auth gate", async () => {
    if (domPolluted()) return;

    expect(PROTECT_NO_AUTH).not.toContain("auth=");
    const { serverJsPath, errors } = compile(PROTECT_NO_AUTH, "protect-gate");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      // An anonymous request is redirected by the auto-injected gate — proof the
      // entry exists without the author writing `auth=`.
      const anon = await server.fetch(new Request(`http://localhost${routeFor(mod, "loadNames").path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }));
      expect(anon).toBeInstanceOf(Response);
      expect(anon.status).toBe(302);
    } finally { stop(); }
  });

  test("a protect-active read returns a 200 JSON Response with the protected column stripped", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(PROTECT_NO_AUTH, "protect-no-auth");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res } = await authedPost(server, routeFor(mod, "loadNames").path, {});
      const body = await expectJsonResponse(res);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body.some((r) => r.name === "alpha")).toBe(true);
      // §14.8.9 confidentiality floor — the redact runs BEFORE serialization, so
      // the protected column is absent from the wire payload. Enveloping the
      // value must never have moved the redact after `JSON.stringify`.
      for (const row of body) expect(row.secret).toBeUndefined();
    } finally { stop(); }
  });

  test("the RAW serialized payload never contains the protected value", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(PROTECT_NO_AUTH, "protect-no-auth-text");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res } = await authedPost(server, routeFor(mod, "loadNames").path, {});
      expect(res).toBeInstanceOf(Response);
      // Read the RAW bytes — a redact applied AFTER serialization would still
      // show the secret here even if the parsed object looked clean.
      expect(await res.text()).not.toContain("hunter2");
    } finally { stop(); }
  });
});

describe("auth= AND protect= together", () => {
  test("both gates active still yields a 200 JSON Response with the column stripped", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(AUTH_AND_PROTECT, "auth-and-protect");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res } = await authedPost(server, routeFor(mod, "loadNames").path, {});
      const body = await expectJsonResponse(res);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      for (const row of body) expect(row.secret).toBeUndefined();
      expect(await res.clone().text()).not.toContain("hunter2");
    } finally { stop(); }
  });
});

describe("no-auth control — the useBaselineCsrf path must be UNCHANGED", () => {
  test("still a 200 JSON Response AND still carries the baseline double-submit Set-Cookie", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(NO_AUTH_CONTROL, "no-auth-control");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res, first } = await baselinePost(server, routeFor(mod, "addItem").path, { name: "baseline-http" });
      expect(first.status).toBe(403);
      expect(await expectJsonResponse(res)).toBe("ok");
      // The baseline path's OWN `Set-Cookie` is still on the 200. This is the
      // header the unconditional envelope must NOT have dropped: it is emitted
      // by the `useBaselineCsrf` branch, not by the branch that changed.
      expect(readSetCookie(res, "scrml_csrf")).toBeTruthy();
    } finally { stop(); }
  });
});

describe("session establishment — the sid cookie survives the response envelope", () => {
  // A SECOND-ORDER consequence of the same defect, found while reading the fix
  // site. `_scrml_session_cookie_wrap` does:
  //
  //   if (_ck && _resp && _resp.headers && typeof _resp.headers.append === 'function')
  //     _resp.headers.append('Set-Cookie', _ck);
  //
  // A bare-value `_resp` has no `.headers`, so the §20.5 session-establishment
  // cookie was SILENTLY DROPPED — the store record was written and the browser
  // never received the sid. Login "succeeded" server-side and the user stayed
  // anonymous. (This particular app rides `useBaselineCsrf`, so it was already
  // correct; the assertion exists so the coupling is pinned for the shapes that
  // were not.)
  test("login sets the sid cookie and a follow-up carrying it resolves the identity", async () => {
    if (domPolluted()) return;

    const { serverJsPath, errors } = compile(SESSION_LOGIN, "session-login");
    expect(errors).toEqual([]);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const loginPath = routeFor(mod, "login").path;
      const whoPath = routeFor(mod, "whoami").path;
      const post = (path, headers, body) =>
        server.fetch(new Request(`http://localhost${path}`, {
          method: "POST", headers, body: JSON.stringify(body ?? {}),
        }));

      // Baseline CSRF handshake.
      const r0 = await post(loginPath, { "Content-Type": "application/json" }, {});
      const csrf = readSetCookie(r0, "scrml_csrf").value;
      const authed = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };

      const rLogin = await post(loginPath, authed, { email: "admin@x.com", password: "secret" });
      expect(await expectJsonResponse(rLogin)).toBe("ok");
      // The cookie rides on the Response — which requires there to BE a Response.
      const sid = readSetCookie(rLogin, "scrml_sid");
      expect(sid).toBeTruthy();
      expect(sid.raw).toContain("HttpOnly");

      const rWho = await post(
        whoPath,
        { ...authed, Cookie: `scrml_csrf=${csrf}; __Host-scrml_sid=${sid.value}` },
        {},
      );
      const who = await expectJsonResponse(rWho);
      expect(who.isAuth).toBe(true);
      expect(who.userId).toBe("u-42");
    } finally { stop(); }
  });
});

describe("emission shape — every server-fn route handler terminates in a Response", () => {
  // No native-Request dependency, so this runs even under happy-dom pollution.
  // It is a STRUCTURAL backstop for the runtime assertions above: it reads the
  // emitted text rather than executing it, and would catch a shape regression on
  // a combination no runtime test above happens to drive.
  const cases = {
    "auth=required": AUTH_REQUIRED,
    "protect= without auth": PROTECT_NO_AUTH,
    "auth= and protect=": AUTH_AND_PROTECT,
    "no-auth control": NO_AUTH_CONTROL,
    "void return": AUTH_VOID_RETURN,
  };

  for (const [label, src] of Object.entries(cases)) {
    test(`${label}: EVERY exit of every route handler is a Response`, () => {
      const { serverJs, errors } = compile(src, "shape");
      expect(errors).toEqual([]);
      expect(serverJs).not.toBeNull();

      const handlers = analyzeHandlers(serverJs);
      expect(handlers.length).toBeGreaterThan(0);
      for (const h of handlers) {
        // `bareReturns` is every `return <expr>` in the HANDLER's OWN scope
        // (the capture IIFE's own `return` is not a handler exit) whose value is
        // not a `new Response(...)` or a guard variable holding one.
        expect({ handler: h.name, bareReturns: h.bareReturns }).toEqual({ handler: h.name, bareReturns: [] });
        // …and control cannot reach the end of the handler, which would be an
        // implicit `undefined` return (`Server.fetch` → "returned an empty value").
        expect({ handler: h.name, fallsOffTheEnd: h.fallsOff }).toEqual({ handler: h.name, fallsOffTheEnd: false });
      }
    });
  }

  test("the protect= egress redact runs BEFORE serialization, never after", () => {
    const { serverJs, errors } = compile(PROTECT_NO_AUTH, "shape-redact-order");
    expect(errors).toEqual([]);
    // §14.8.9 is a confidentiality floor: the value handed to `JSON.stringify`
    // must ALREADY be redacted. `JSON.stringify(_scrml_protect_redact(x))`,
    // never `_scrml_protect_redact(JSON.stringify(x))`.
    expect(serverJs).toContain("JSON.stringify(_scrml_protect_redact(_scrml_result)");
    expect(serverJs).not.toContain("_scrml_protect_redact(JSON.stringify");
  });
});

// ---------------------------------------------------------------------------
// The `Response` PASSTHROUGH guard — the fail-open shape the envelope creates.
//
// `_scrml_result` is whatever the body produced. If the body produced a
// `Response`, enveloping it does
// `new Response(JSON.stringify(<a Response>), { status: 200 })`. A `Response`
// has no enumerable own properties, so `JSON.stringify` yields `"{}"` — an
// adopter's deliberate 403 / 404 / redirect would be re-emitted as a 200 with
// an empty-object body. A DENY silently becoming a SUCCESS.
//
// HONEST SCOPE. This shape is NOT reachable from clean scrml source today: a
// body naming `Response` build-blocks on `E-SCOPE-001` (asserted below, so the
// day that gate changes these tests say so), and the `_{}` escape-hatch forms
// fail earlier still. But codegen EMITS the handler regardless of the
// downstream diagnostic, so the emitted code path is real and executable — and
// §14.8.9/§14.8.10 already model a manual-`Response`/`handle()` body as a live
// server-fn egress kind, so the shape is anticipated rather than hypothetical.
// A fail-OPEN shape is the exact category this change exists to remove, so it
// is guarded and pinned rather than left to the upstream gate alone.
// ---------------------------------------------------------------------------
describe("a body-built Response is passed THROUGH, never re-enveloped", () => {
  // A server fn that hand-builds a 403. `Response` is not a declared scrml
  // identifier, so this reports E-SCOPE-001 — but codegen still emits the
  // handler, which is what we execute.
  const BODY_BUILDS_RESPONSE = `<program auth="required">
  \${
    export server function deny() {
      return new Response("no", { status: 403 })
    }
  }
  <button onclick=deny()>D</button>
</program>`;

  test("the shape still build-blocks on E-SCOPE-001 (pins the upstream gate)", () => {
    const { errors } = compile(BODY_BUILDS_RESPONSE, "resp-passthrough-gate");
    // If this ever stops firing, the shape becomes adopter-reachable and the
    // passthrough guard below stops being belt-and-braces and becomes load-bearing.
    expect(errors.map((e) => e.code)).toContain("E-SCOPE-001");
  });

  test("the guard is emitted ahead of the envelope, in that order", () => {
    const { serverJs } = compile(BODY_BUILDS_RESPONSE, "resp-passthrough-emit");
    expect(serverJs).toContain("if (_scrml_result instanceof Response) return _scrml_result;");
    // Order matters: the guard must precede the JSON.stringify envelope, or the
    // Response is already destroyed by the time it runs.
    const guardIdx = serverJs.indexOf("if (_scrml_result instanceof Response) return _scrml_result;");
    const envIdx = serverJs.indexOf("const _scrml_resp_body = JSON.stringify(", guardIdx);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThan(guardIdx);
  });

  test("EXECUTED: the body's 403 survives — it is NOT re-emitted as 200 {}", async () => {
    if (domPolluted()) return;

    const { serverJsPath } = compile(BODY_BUILDS_RESPONSE, "resp-passthrough-run");
    // The compile reported E-SCOPE-001 but the artifact was still written; we
    // execute the emitted handler, which is the code an adopter would run if the
    // upstream gate ever admitted this shape.
    expect(existsSync(serverJsPath)).toBe(true);
    const { mod, server, stop } = await serveBundle(serverJsPath);
    try {
      const { res } = await authedPost(server, routeFor(mod, "deny").path, {});
      expect(res).toBeInstanceOf(Response);
      // THE ASSERTION: the adopter's own status and body, not the envelope's.
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("no");
      // …and specifically NOT the fail-open shape.
      expect(res.status).not.toBe(200);
    } finally { stop(); }
  });
});
