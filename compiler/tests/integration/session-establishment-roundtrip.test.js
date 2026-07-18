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
      return { userId: session.userId, role: session.role, isAuth: session.isAuth, pref: session.get("pref"), pref2: session.get("pref2") }
    }
    server function switchUser(newId) {
      session.destroy()
      session.set("userId", newId)
      return "switched"
    }
    server function setPref(v) {
      session.set("pref", v)
      return "pref-set"
    }
    server function leakSeq() {
      session.set("pref", "a")
      session.destroy()
      session.set("pref2", "b")
      return "seq"
    }
    server function logout() {
      session.destroy()
      return "bye"
    }
    server function setRoleOnly(r) {
      session.set("role", r)
      return "role-only"
    }
  }
  <main>
    <button onclick=login("a","b")>Login</button>
    <button onclick=whoami()>Who</button>
    <button onclick=logout()>Logout</button>
    <button onclick=switchUser("x")>Sw</button>
    <button onclick=setPref("x")>P</button>
    <button onclick=leakSeq()>Q</button>
    <button onclick=setRoleOnly("admin")>R</button>
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

  // S239-2 FIX A (role bleed) + FIX B (identity-vs-preference rotation).
  test("destroy;set drops the prior role; preference-set keeps the sid + old session authed", async () => {
    if (typeof globalThis.document !== "undefined") return;

    const { dir, outDir, errors } = compileApp();
    try {
      expect(errors).toEqual([]);
      const serverJsPath = join(outDir, "app.server.js");
      const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
      const loginR = routeFor("login"), whoR = routeFor("whoami"),
        switchR = routeFor("switchUser"), prefR = routeFor("setPref"), leakR = routeFor("leakSeq");

      const post = (route, headers, body) =>
        route.handler(new Request(`http://localhost${route.path}`, {
          method: "POST", headers, body: JSON.stringify(body ?? {}),
        }));
      const r0 = await post(loginR, { "Content-Type": "application/json" }, {});
      const csrf = cookieVal(r0, "scrml_csrf").value;
      const base = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };
      const withSid = (sid) => ({ ...base, Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid}` });
      const jsonOf = async (r) => (r instanceof Response ? await r.json() : r);

      // login as admin (role=admin)
      const sidAdmin = cookieVal(await post(loginR, base, { email: "admin@x.com", password: "secret" }), "scrml_sid").value;
      const admin = await jsonOf(await post(whoR, withSid(sidAdmin), {}));
      expect(admin.userId).toBe("u-42");
      expect(admin.role).toBe("admin");

      // --- FIX A: switchUser (destroy(); set("userId","u-lowpriv")) → NO role bleed ---
      const rSwitch = await post(switchR, withSid(sidAdmin), { newId: "u-lowpriv" });
      const sidLow = cookieVal(rSwitch, "scrml_sid").value;
      expect(sidLow).not.toBe(sidAdmin); // rotated
      const low = await jsonOf(await post(whoR, withSid(sidLow), {}));
      expect(low.userId).toBe("u-lowpriv");
      expect(low.role).toBe(null);        // <-- admin role did NOT bleed through
      expect(low.role).not.toBe("admin");
      // old admin sid is gone (deleted on the identity rotation)
      const goneAdmin = await jsonOf(await post(whoR, withSid(sidAdmin), {}));
      expect(goneAdmin.isAuth).toBe(false);

      // --- FIX A: set("a"); destroy(); set("b") → only b, no leak of a or prior role ---
      const sidAdmin2 = cookieVal(await post(loginR, base, { email: "admin@x.com", password: "secret" }), "scrml_sid").value;
      const rLeak = await post(leakR, withSid(sidAdmin2), {});
      const sidLeak = cookieVal(rLeak, "scrml_sid").value;
      const leaked = await jsonOf(await post(whoR, withSid(sidLeak), {}));
      expect(leaked.pref2).toBe("b");
      expect(leaked.pref).toBe(null);     // "a" was cleared by destroy
      expect(leaked.userId).toBe(null);   // no prior identity
      expect(leaked.role).toBe(null);     // no prior role

      // --- FIX B: preference-only set → SAME sid (no rotation), old sid stays authed ---
      const sidPref = cookieVal(await post(loginR, base, { email: "admin@x.com", password: "secret" }), "scrml_sid").value;
      const rPref = await post(prefR, withSid(sidPref), { v: "dark" });
      const prefSid = cookieVal(rPref, "scrml_sid").value;
      expect(prefSid).toBe(sidPref);      // <-- NOT rotated (concurrent-safe)
      const stillAuthed = await jsonOf(await post(whoR, withSid(sidPref), {}));
      expect(stillAuthed.isAuth).toBe(true);   // old sid still valid
      expect(stillAuthed.userId).toBe("u-42");
      expect(stillAuthed.role).toBe("admin");  // preference update preserved identity
      expect(stillAuthed.pref).toBe("dark");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  // B1 (S266) — cookie-name-boundary: an un-anchored `/scrml_sid=([^;]+)/` matched
  // the FIRST substring, so a PREFIXED cookie (`Xscrml_sid=<attackerSid>`) or a
  // crafted cookie VALUE containing `scrml_sid=` (RFC 6265 permits `=` in a value,
  // e.g. `foo=scrml_sid=<atk>`) was read as the session id → session fixation: the
  // victim authenticates as the attacker. The anchored `/(?:^|;\s*)scrml_sid=…/`
  // resolves ANON for both. Driven against the REAL emitted whoami handler with a
  // GENUINE authed attacker sid (so a hit would truly authenticate).
  test("B1: prefixed / value-embedded scrml_sid never authenticates (session-fixation)", async () => {
    if (typeof globalThis.document !== "undefined") return;

    const { dir, outDir, errors } = compileApp();
    try {
      expect(errors).toEqual([]);
      const serverJsPath = join(outDir, "app.server.js");
      const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
      const loginR = routeFor("login"), whoR = routeFor("whoami");

      const post = (route, headers, body) =>
        route.handler(new Request(`http://localhost${route.path}`, {
          method: "POST", headers, body: JSON.stringify(body ?? {}),
        }));
      const jsonOf = async (r) => (r instanceof Response ? await r.json() : r);

      // CSRF handshake + a REAL attacker login → a genuine authed sid + record.
      const r0 = await post(loginR, { "Content-Type": "application/json" }, {});
      const csrf = cookieVal(r0, "scrml_csrf").value;
      const base = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };
      const attackerSid = cookieVal(await post(loginR, base, { email: "admin@x.com", password: "secret" }), "scrml_sid").value;
      expect(attackerSid.length).toBeGreaterThan(0);

      // control: the properly-named cookie DOES authenticate (the attack vector's sid is live).
      const control = await jsonOf(await post(whoR, { ...base, Cookie: `scrml_csrf=${csrf}; scrml_sid=${attackerSid}` }, {}));
      expect(control.isAuth).toBe(true);
      expect(control.userId).toBe("u-42");

      // ATTACK 1 — prefixed name `Xscrml_sid=<real attacker sid>` → ANON.
      const atk1 = await jsonOf(await post(whoR, { ...base, Cookie: `scrml_csrf=${csrf}; Xscrml_sid=${attackerSid}` }, {}));
      expect(atk1.isAuth).toBe(false);
      expect(atk1.userId).toBe(null);

      // ATTACK 2 — prefixed name masks the real (bogus) cookie → the LEGIT (bogus) one wins → ANON.
      const atk2 = await jsonOf(await post(whoR, { ...base, Cookie: `scrml_csrf=${csrf}; evilscrml_sid=${attackerSid}; scrml_sid=bogus-none` }, {}));
      expect(atk2.isAuth).toBe(false);
      expect(atk2.userId).toBe(null);

      // ATTACK 3 — crafted cookie VALUE contains `scrml_sid=` (name NOT attacker-controlled) → ANON.
      const atk3 = await jsonOf(await post(whoR, { ...base, Cookie: `foo=scrml_sid=${attackerSid}; scrml_csrf=${csrf}; scrml_sid=bogus-none` }, {}));
      expect(atk3.isAuth).toBe(false);
      expect(atk3.userId).toBe(null);

      // and the genuine cookie in a middle position (unrelated cookies around it) still resolves.
      const legit = await jsonOf(await post(whoR, { ...base, Cookie: `theme=dark; scrml_csrf=${csrf}; scrml_sid=${attackerSid}; x=1` }, {}));
      expect(legit.isAuth).toBe(true);
      expect(legit.userId).toBe("u-42");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  // B3 (S266) — role decoupled from auth: `session.set("role", x)` with NO userId
  // minted a record `{role}` with no userId, and `role` read independent of `isAuth`
  // (invariant `role ⇒ authenticated` violated). Gated on `userId != null` in BOTH
  // the read-middleware and the write-ctx getter.
  test("B3: a role set without a userId reads role=null + isAuth=false (role ⇒ authenticated)", async () => {
    if (typeof globalThis.document !== "undefined") return;

    const { dir, outDir, errors } = compileApp();
    try {
      expect(errors).toEqual([]);
      const serverJsPath = join(outDir, "app.server.js");
      const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
      const loginR = routeFor("login"), whoR = routeFor("whoami"),
        roleOnlyR = routeFor("setRoleOnly");

      const post = (route, headers, body) =>
        route.handler(new Request(`http://localhost${route.path}`, {
          method: "POST", headers, body: JSON.stringify(body ?? {}),
        }));
      const jsonOf = async (r) => (r instanceof Response ? await r.json() : r);

      const r0 = await post(loginR, { "Content-Type": "application/json" }, {});
      const csrf = cookieVal(r0, "scrml_csrf").value;
      const base = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };

      // Anonymous request → setRoleOnly("admin") mints a record with {role} but NO userId.
      const rRole = await post(roleOnlyR, base, { r: "admin" });
      const sid = cookieVal(rRole, "scrml_sid").value; // a sid IS minted (a preference write)
      const withSid = { ...base, Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid}` };

      // The durable record does carry {role:"admin"} but no userId...
      const dbPath = join(outDir, ".scrml-sessions.db");
      const fresh = new Database(dbPath, { readonly: true });
      const row = fresh.query("SELECT value FROM kv_store WHERE namespace = ? AND key = ?").get("session", sid);
      fresh.close();
      const rec = JSON.parse(row.value);
      expect(rec.role).toBe("admin");
      expect(rec.userId == null).toBe(true);

      // ...yet the role READ gates on a userId: session.role (the write-ctx getter)
      // reads null and isAuth is false. (The read-middleware `role:` line — the
      // identical userId gate consumed by @currentUser / the projection / serverLoad
      // auth — is pinned by the unit test session-context-gate-b2b3 + the
      // server-load-authority impl-gap-#2 assertion.)
      const who = await jsonOf(await post(whoR, withSid, {}));
      expect(who.isAuth).toBe(false);      // write-ctx session.isAuth
      expect(who.userId).toBe(null);
      expect(who.role).toBe(null);         // <-- session.role (write-ctx getter) — no read without userId
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });
});
