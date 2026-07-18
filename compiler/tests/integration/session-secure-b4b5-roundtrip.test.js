/**
 * §20.5.1 session hardening — S266 (i29e) pass-2 EXECUTE coverage (B4a + B5).
 *
 * The S265 "emitted ≠ runs" rule: drive the REAL emitted server, not the text.
 *
 *  B5 — the reserved-key guard actually holds at runtime: a DYNAMIC
 *       `session.set(k, v)` with `k === "csrfToken"` (the mass-assignment vector
 *       the compile-time literal check cannot see) CANNOT overwrite the
 *       middleware-minted synchronizer token. The real token survives, and a
 *       mutating request bearing the attacker's chosen token is still 403'd.
 *
 *  B4a — the opt-out cookie (`session-secure="false"` → plain `scrml_sid`, no
 *        Secure) authenticates end-to-end over http://localhost.
 *
 * Bun's NATIVE Request is required (a happy-dom Request strips the forbidden
 * `Cookie` header — same guard as the sibling round-trip tests).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";

import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_session_secure_b4b5");
let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compile(scrmlSource, testName) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(outDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  writeFileSync(tmpInput, scrmlSource);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  return {
    errors: result.errors ?? [],
    serverJsPath: join(outDir, `${tag}.server.js`),
    outDir,
    tag,
  };
}

const nonWarn = (errors) => errors.filter((e) => !/^[WI]-/.test(e.code ?? ""));

describe("B5 runtime guard — a dynamic session.set(csrfToken) cannot pin the token", () => {
  // auth=required + csrf=auto → the middleware mints a session-bound synchronizer
  // token. `pin(k,v)` is a DYNAMIC-key setter (compiles clean; the compile-time
  // literal check can't see the key) → the RUNTIME guard is the only defense.
  const APP = `<program auth="required" csrf="auto">
  \${
    export server function pin(k, v) {
      session.set(k, v)
      return "pinned"
    }
  }
  <button onclick=pin("x","y")>P</button>
</program>`;

  test("the middleware-minted token survives a session.set(\"csrfToken\", attacker) + still gates", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only

    const { serverJsPath, outDir, errors } = compile(APP, "b5-guard");
    expect(nonWarn(errors)).toEqual([]);

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);

    // Seed an authenticated session with a KNOWN real token, directly into the
    // durable store the module created beside its bundle (same handle it uses).
    const dbPath = join(outDir, ".scrml-sessions.db");
    const store = globalThis.__scrml_session_stores[dbPath];
    expect(store).toBeTruthy();
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    const REAL = "real-minted-token-abc";
    store.set(SID, { userId: "u-1", role: "user", csrfToken: REAL }, 3600);

    const route = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("pin"),
    );
    expect(route).toBeTruthy();
    const call = (headers, body) =>
      route.handler(new Request(`http://localhost${route.path}`, {
        method: "POST", headers, body: JSON.stringify(body ?? {}),
      }));
    const statusOf = (r) => (r instanceof Response ? r.status : null);

    // Attacker attempts to PIN csrfToken to a value they know, using the valid
    // real token to pass the gate. The runtime guard must no-op the write.
    const rPin = await call(
      { "Content-Type": "application/json", Cookie: `scrml_sid=${SID}`, "X-CSRF-Token": REAL },
      { k: "csrfToken", v: "attacker-known-token" },
    );
    // the mutation itself is admitted (valid session + valid token) and returns.
    expect(rPin instanceof Response ? await rPin.json() : rPin).toBe("pinned");

    // THE GUARD: the stored token is UNCHANGED (the pin was refused).
    expect(store.get(SID).csrfToken).toBe(REAL);
    expect(store.get(SID).csrfToken).not.toBe("attacker-known-token");

    // integrity: a mutating request bearing the ATTACKER's chosen token is 403'd
    // (the real token was never replaced), while the real token still passes.
    const rAttacker = await call(
      { "Content-Type": "application/json", Cookie: `scrml_sid=${SID}`, "X-CSRF-Token": "attacker-known-token" },
      { k: "x", v: "y" },
    );
    expect(statusOf(rAttacker)).toBe(403);

    const rReal = await call(
      { "Content-Type": "application/json", Cookie: `scrml_sid=${SID}`, "X-CSRF-Token": REAL },
      { k: "x", v: "y" },
    );
    expect(rReal instanceof Response ? await rReal.json() : rReal).toBe("pinned");
  });
});

describe("B4a opt-out — a session-secure=\"false\" app authenticates over http://localhost", () => {
  const APP = `<program session-secure="false">
  \${
    server function login(email, password) {
      if (email == "admin@x.com" && password == "secret") {
        session.set("userId", "u-9")
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

  test("plain scrml_sid (no Secure) round-trips → authed", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only

    const { serverJsPath, errors } = compile(APP, "b4a-optout");
    expect(nonWarn(errors)).toEqual([]);

    const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
    const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
    const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
    const loginR = routeFor("login");
    const whoR = routeFor("whoami");

    const post = (route, headers, body) =>
      route.handler(new Request(`http://localhost${route.path}`, {
        method: "POST", headers, body: JSON.stringify(body ?? {}),
      }));
    const cookieVal = (resp, name) => {
      const all = typeof resp.headers.getSetCookie === "function"
        ? resp.headers.getSetCookie() : [resp.headers.get("Set-Cookie") ?? ""];
      for (const c of all) { const m = c.match(new RegExp(`${name}=([^;]*)`)); if (m) return { value: m[1], raw: c }; }
      return null;
    };

    // baseline CSRF handshake (no auth → double-submit cookie).
    const r0 = await post(loginR, { "Content-Type": "application/json" }, { email: "admin@x.com", password: "secret" });
    const csrf = cookieVal(r0, "scrml_csrf").value;
    const authed = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };

    const rLogin = await post(loginR, authed, { email: "admin@x.com", password: "secret" });
    const sidCookie = cookieVal(rLogin, "scrml_sid");
    // opt-out: the cookie is the PLAIN name and carries NO Secure over http localhost.
    expect(sidCookie.raw).toContain("scrml_sid=");
    expect(sidCookie.raw).not.toContain("__Host-");
    expect(sidCookie.raw).not.toContain("Secure");
    const sid = sidCookie.value;

    // the plain cookie authenticates on the follow-up.
    const rWho = await post(whoR, { ...authed, Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid}` }, {});
    const who = rWho instanceof Response ? await rWho.json() : rWho;
    expect(who.isAuth).toBe(true);
    expect(who.userId).toBe("u-9");
  });
});
