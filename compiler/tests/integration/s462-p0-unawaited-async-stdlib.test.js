/**
 * S462 P0 (SECURITY) — an async stdlib call left un-awaited hands the program a
 * Promise, and a Promise is truthy. Two roots, both closed; every case below is
 * EXECUTED: the program is compiled, its server bundle is imported under bun
 * with a real bun:sqlite database, and each route is driven over a Request.
 * JWKS and http go to a local mock HTTP server.
 *
 * S1 — an ALIASED import was never awaited. `import { verifyPassword as vp }`
 * keyed the auto-await classifier by the LOCAL name `vp`; `scrml:auth` exports
 * no `vp`, so the call was classified sync: `const ok = vp(pass, hash)` held a
 * Promise, `if (!ok)` never fired, and a WRONG PASSWORD WAS ACCEPTED. Same for
 * `get as httpGet` from `scrml:http` (the route read `.status` off a Promise).
 * Fix: `buildCalleeImportMap` carries local → imported names and every
 * classifier site looks the IMPORTED name up (`isPromiseReturningImportedCallee`).
 *
 * S2 — the stdlib `.scrml` sources declared Promise-returning shims SYNC:
 * `verifyJwtJwks`, `resetPassword`, `hmac`, `requestMagicLink`,
 * `requestEmailVerification`, `requestPasswordReset` (and `sleep`). The
 * compiler awaits a stdlib call only when its `.scrml` declaration is `async`,
 * so `verifyJwtJwks(badToken, url).valid == false` read `undefined == false`
 * off a Promise and a forged token was ACCEPTED. Fix: declared `async`; the
 * shim parity test (stdlib-shim-export-parity §6) now pins async-ness.
 *
 * SPEC §13.2: "An async-colored function is one the compiler emits async: a
 * server function, a Promise-returning standard-library function, or any
 * function that (transitively) calls one. … It MAY be called directly (the
 * compiler awaits the call) … Every such position would hand a caller an
 * unawaited Promise, which is always truthy — a check written against it
 * passes for every input."
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHmac } from "crypto";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";
import { assertOpensDb } from "../helpers/self-host-server-import.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;

const APP = `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" tables="users">
    \${
      import { verifyPassword as vp, verifyJwtJwks, resetPassword, requestMagicLink, requestEmailVerification, requestPasswordReset } from "scrml:auth"
      import { get as httpGet } from "scrml:http"
      import { hmac } from "scrml:crypto"
      import { createStore } from "scrml:store"

      function login(name, pass) {
        const row = ?{\`SELECT pw FROM users WHERE name = \${name}\`}.get() !{ _ :> not }
        if (row is not) { return "NOUSER" }
        const ok = vp(pass, row.pw)
        if (!ok) { return "REJECTED" }
        return "ACCEPTED"
      }
      function fetchStatus(url) {
        const row = ?{\`SELECT COUNT(*) AS n FROM users\`}.get() !{ _ :> not }
        const r = httpGet(url)
        return { status: r.status, rows: row.n }
      }
      function checkJwt(token, url) {
        const r = verifyJwtJwks(token, url)
        if (r.valid == false) { return "REJECTED:" + r.reason }
        return "ACCEPTED"
      }
      function sign(key, msg) {
        const sig = hmac(key, msg)
        return "sha256=" + sig
      }
      function reqFlows(email, storePath) {
        const store = createStore(storePath, "flows")
        const a = requestMagicLink(email, { store: store, baseUrl: "https://x/login" }, (to, msg) => { return })
        const b = requestEmailVerification(email, { store: store, baseUrl: "https://x/verify" }, (to, msg) => { return })
        const c = requestPasswordReset(email, { store: store, baseUrl: "https://x/reset" }, (to, msg) => { return })
        return { a: a.ok, b: b.ok, c: c.ok }
      }
      function doReset(token, storePath) {
        const store = createStore(storePath, "pwreset")
        const r = resetPassword(token, "new-password", { store: store }, (to, msg) => { return })
        if (r.valid == false) { return "REJECTED:" + r.reason }
        return "ACCEPTED"
      }
    }
  </db>
  <out> = ""
  <button onclick={ @out = login("ada", "x") !{ .Transport(_) :> { return } } }>a</button>
  <button onclick={ @out = fetchStatus("u") !{ .Transport(_) :> { return } } }>b</button>
  <button onclick={ @out = checkJwt("t", "u") !{ .Transport(_) :> { return } } }>c</button>
  <button onclick={ @out = sign("k", "m") !{ .Transport(_) :> { return } } }>d</button>
  <button onclick={ @out = reqFlows("e", "p") !{ .Transport(_) :> { return } } }>e</button>
  <button onclick={ @out = doReset("t", "p") !{ .Transport(_) :> { return } } }>f</button>
</program>
`;

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

async function signRs256(privateKey, kid, payload) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

let dir, mod, mock, base, jwksKey, otherKey;
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
  jwksKey = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
  otherKey = await crypto.subtle.generateKey(RSA, true, ["sign", "verify"]);
  const pubJwk = { ...(await crypto.subtle.exportKey("jwk", jwksKey.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  mock = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/jwks") return Response.json({ keys: [pubJwk] });
      if (u.pathname === "/teapot") return new Response("short and stout", { status: 418 });
      return new Response("ok", { status: 200 });
    },
  });
  base = `http://127.0.0.1:${mock.port}`;

  dir = mkdtempSync(join(tmpdir(), "s462-p0-unawaited-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, APP);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('ada', ?)", [await hashPassword("right-password")]);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
  const serverJsPath = join(outDir, "app.server.js");
  expect(existsSync(serverJsPath)).toBe(true);
  assertOpensDb(serverJsPath, dbPath);
  mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  for (const r of mod.routes) {
    const m = /__ri_route_([A-Za-z]+)_\d+$/.exec(r.path);
    if (m) routes.set(m[1], r.path);
  }
}, EXECUTED_DB_TIMEOUT_MS);

afterAll(() => {
  mock?.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("S1 — an aliased async stdlib import is awaited", () => {
  test("`verifyPassword as vp`: a WRONG password is rejected", async () => {
    expect(await call("login", { name: "ada", pass: "wrong-password" })).toBe("REJECTED");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`verifyPassword as vp`: the right password is accepted", async () => {
    expect(await call("login", { name: "ada", pass: "right-password" })).toBe("ACCEPTED");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`get as httpGet`: the result has `.status`", async () => {
    expect(await call("fetchStatus", { url: `${base}/teapot` })).toEqual({ status: 418, rows: 1 });
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("S2 — stdlib functions declared sync but Promise-returning are awaited", () => {
  test("verifyJwtJwks: a garbage token is rejected", async () => {
    expect(await call("checkJwt", { token: "garbage", url: `${base}/jwks` })).toBe("REJECTED:malformed");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("verifyJwtJwks: a token signed by a key NOT in the JWKS is rejected", async () => {
    const forged = await signRs256(otherKey.privateKey, "k1", { sub: "admin", exp: Math.floor(Date.now() / 1000) + 600 });
    expect(await call("checkJwt", { token: forged, url: `${base}/jwks` })).toBe("REJECTED:invalid");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("verifyJwtJwks: a token signed by the JWKS key is accepted", async () => {
    const good = await signRs256(jwksKey.privateKey, "k1", { sub: "ada", exp: Math.floor(Date.now() / 1000) + 600 });
    expect(await call("checkJwt", { token: good, url: `${base}/jwks` })).toBe("ACCEPTED");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("hmac returns the digest, not a Promise", async () => {
    const expected = createHmac("sha256", "the-key").update("the-message").digest("hex");
    expect(await call("sign", { key: "the-key", msg: "the-message" })).toBe("sha256=" + expected);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("requestMagicLink / requestEmailVerification / requestPasswordReset results are awaited", async () => {
    const storePath = join(dir, "flows.db");
    expect(await call("reqFlows", { email: "ada@example.com", storePath })).toEqual({ a: true, b: true, c: true });
  }, EXECUTED_DB_TIMEOUT_MS);

  test("resetPassword: an unknown token is rejected", async () => {
    const storePath = join(dir, "reset.db");
    expect(await call("doReset", { token: "no-such-token", storePath })).toBe("REJECTED:used-or-invalid");
  }, EXECUTED_DB_TIMEOUT_MS);
});
