/**
 * §20.5 session-establishment primitive — i29e (S265) integration round-trip.
 *
 * Drives the emitted route handlers end-to-end (the same seam a booted server
 * dispatches to), proving the WRITE half connects to the S233 READ half through
 * the durable store:
 *
 *   1. login → server fn calls `session.set("userId", …)`/`session.set("role", …)`;
 *      the response carries `Set-Cookie: scrml_sid=…; HttpOnly; SameSite=Lax`.
 *   2. a follow-up request carrying that cookie resolves `session.userId` /
 *      `session.isAuth` (via the same middleware store) → authed.
 *   3. no cookie → anon.
 *   4. `session.destroy()` clears the cookie + deletes the record → anon after.
 *   5. durability — the record is on disk in `.scrml-sessions.db`, resolvable by a
 *      FRESH bun:sqlite handle (survives a process/store-handle restart).
 *
 * Login is a state-mutating POST → baseline double-submit CSRF applies, so the
 * driver performs the same 2-step handshake a real client does (first POST mints
 * `scrml_csrf`; retry echoes it as `X-CSRF-Token`). Bun's NATIVE Request is
 * required — a happy-dom Request (loaded by sibling browser tests) strips the
 * forbidden `Cookie` header, so `scrml_sid`/`scrml_csrf` never reach the handler.
 * Mirrors auth-csrf-synchronizer-token.test.js's guard.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";

// A DB-free login app — the login fn verifies a hardcoded cred (no `?{}`, so no
// db seed / Bun.SQL handle to lock). `session.set` alone server-escalates it.
const APP = `<program>
  \${
    server function login(email, password) {
      if (email == "admin@x.com" && password == "secret") {
        session.set("userId", "u-42")
        session.set("role", "admin")
        return "ok"
      }
      return "bad"
    }
    server function whoami() {
      return { userId: session.userId, role: session.role, isAuth: session.isAuth }
    }
    server function logout() {
      session.destroy()
      return "bye"
    }
  }
  <main>
    <button onclick=login("a","b")>Login</button>
    <button onclick=whoami()>Who</button>
    <button onclick=logout()>Logout</button>
  </main>
</program>`;

function compileApp() {
  const dir = mkdtempSync(join(tmpdir(), "session-roundtrip-"));
  const file = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(file, APP);
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const nonWarn = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  return { dir, outDir, file, errors: nonWarn, result };
}

// pull the value of a named Set-Cookie from a Response (native Headers preserves
// multiple Set-Cookie via getSetCookie()).
function cookieVal(resp, name) {
  const all = typeof resp.headers.getSetCookie === "function"
    ? resp.headers.getSetCookie()
    : [resp.headers.get("Set-Cookie") ?? ""];
  for (const c of all) {
    const m = c.match(new RegExp(`${name}=([^;]*)`));
    if (m) return { value: m[1], raw: c };
  }
  return null;
}

describe("§20.5 session establishment — full HTTP round-trip", () => {
  test("login sets scrml_sid; the cookie resolves authed; destroy clears it; record is durable", async () => {
    // Native-Request only (see file header).
    if (typeof globalThis.document !== "undefined") return;

    const { dir, outDir, errors } = compileApp();
    try {
      expect(errors).toEqual([]);

      // Import the emitted server module + collect its routes.
      const serverJsPath = join(outDir, "app.server.js");
      const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
      const loginR = routeFor("login");
      const whoR = routeFor("whoami");
      const logoutR = routeFor("logout");
      expect(loginR && whoR && logoutR).toBeTruthy();

      const post = (route, headers, body) =>
        route.handler(new Request(`http://localhost${route.path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body ?? {}),
        }));

      // --- CSRF handshake: first login mints scrml_csrf on the 403 ---
      const r0 = await post(loginR, { "Content-Type": "application/json" }, { email: "admin@x.com", password: "secret" });
      expect(r0.status).toBe(403);
      const csrf = cookieVal(r0, "scrml_csrf").value;
      expect(csrf).toBeTruthy();

      const authed = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };

      // --- SESSION FIXATION (S239 FIX 1): login carrying a PLANTED sid must get a
      // DIFFERENT fresh sid, and the planted value must NOT become authenticated ---
      const PLANTED = "planted-attacker-sid-000";
      const rFix = await post(
        loginR,
        { ...authed, Cookie: `scrml_csrf=${csrf}; scrml_sid=${PLANTED}` },
        { email: "admin@x.com", password: "secret" },
      );
      const fixSid = cookieVal(rFix, "scrml_sid").value;
      expect(fixSid).not.toBe(PLANTED); // rotated, never reflected
      // the planted sid resolves anon (no record was ever written under it)
      const rPlanted = await post(whoR, { ...authed, Cookie: `scrml_csrf=${csrf}; scrml_sid=${PLANTED}` }, {});
      const planted = rPlanted instanceof Response ? await rPlanted.json() : rPlanted;
      expect(planted.isAuth).toBe(false);
      expect(planted.userId).toBe(null);

      // --- login (good creds) → 200 "ok" + Set-Cookie scrml_sid HttpOnly SameSite=Lax ---
      const rLogin = await post(loginR, authed, { email: "admin@x.com", password: "secret" });
      expect(rLogin instanceof Response).toBe(true);
      expect(rLogin.status).toBe(200);
      const sidCookie = cookieVal(rLogin, "scrml_sid");
      expect(sidCookie).toBeTruthy();
      const sid = sidCookie.value;
      expect(sid.length).toBeGreaterThan(0);
      expect(sidCookie.raw).toContain("HttpOnly");
      expect(sidCookie.raw).toContain("SameSite=Lax");
      expect(sidCookie.raw).toContain("Max-Age=");
      // dev (http localhost) → NO Secure so the cookie round-trips locally...
      expect(sidCookie.raw).not.toContain("Secure");
      // ...but an https request (x-forwarded-proto) → Secure IS emitted (FIX 3).
      const rHttps = await post(
        loginR,
        { ...authed, "x-forwarded-proto": "https" },
        { email: "admin@x.com", password: "secret" },
      );
      expect(cookieVal(rHttps, "scrml_sid").raw).toContain("Secure");

      // --- whoami WITH the cookie → authed, userId/role resolved via the middleware ---
      const withSid = { ...authed, Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid}` };
      const rWho = await post(whoR, withSid, {});
      const who = rWho instanceof Response ? await rWho.json() : rWho;
      expect(who.isAuth).toBe(true);
      expect(who.userId).toBe("u-42");
      expect(who.role).toBe("admin");

      // --- isAuth BYPASS (S239 FIX 2): a BOGUS sid with no record → anon ---
      const rBogus = await post(whoR, { ...authed, Cookie: `scrml_csrf=${csrf}; scrml_sid=totally-bogus-nonexistent` }, {});
      const bogus = rBogus instanceof Response ? await rBogus.json() : rBogus;
      expect(bogus.isAuth).toBe(false);
      expect(bogus.userId).toBe(null);

      // --- whoami WITHOUT the cookie → anon ---
      const rAnon = await post(whoR, authed, {});
      const anon = rAnon instanceof Response ? await rAnon.json() : rAnon;
      expect(anon.isAuth).toBe(false);
      expect(anon.userId).toBe(null);

      // --- durability (S239 FIX 9): the record is on disk beside the bundle,
      // resolvable by a FRESH bun:sqlite handle (survives a store-handle restart) ---
      const dbPath = join(outDir, ".scrml-sessions.db");
      const fresh = new Database(dbPath, { readonly: true });
      const row = fresh.query("SELECT value FROM kv_store WHERE namespace = ? AND key = ?").get("session", sid);
      fresh.close();
      expect(row).toBeTruthy();
      const rec = JSON.parse(row.value);
      expect(rec.userId).toBe("u-42");
      expect(rec.role).toBe("admin");

      // --- logout → clears scrml_sid; whoami with the (now destroyed) sid → anon ---
      const rLogout = await post(logoutR, withSid, {});
      const clear = cookieVal(rLogout, "scrml_sid");
      expect(clear).toBeTruthy();
      expect(clear.raw).toContain("Expires=Thu, 01 Jan 1970");
      const rAfter = await post(whoR, withSid, {});
      const after = rAfter instanceof Response ? await rAfter.json() : rAfter;
      expect(after.isAuth).toBe(false);
      expect(after.userId).toBe(null);
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });
});
