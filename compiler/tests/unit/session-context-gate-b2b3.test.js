/**
 * §20.5 session builtin — S266 (i29e) security-fix round: B1 + B2 + B3.
 *
 * B1 — every emitted `scrml_sid`/`scrml_csrf` cookie parse is anchored to a cookie
 *      name boundary (`/(?:^|;\s*)<name>=…/`), so a prefixed cookie or a crafted
 *      cookie VALUE containing `<name>=` cannot be read as the id (session fixation).
 * B2 — no bare `session` identifier ever reaches emitted JS: a `session` reference
 *      is EITHER a valid member/index/call (correctly lowered to
 *      `_scrml_req._scrml_sess.*`) OR a clean compile error (E-SESSION-VALUE), across
 *      all five previously-leaking shapes (index, optional-member, optional-call,
 *      bare-value, file-scope-shadow).
 * B3 — `role` reads gate on a real authenticated identity (`userId != null`) in BOTH
 *      the read-middleware line and the write-ctx getter (invariant role ⇒ authed).
 *
 * The `emit + execute` case (S265 lesson: emitted ≠ runs) drives the emitted server
 * through the CSRF handshake and asserts the INDEX + OPTIONAL lowered reads RUN and
 * return the authed values — not merely that the text lowered.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "session-b2b3-"));
  const file = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  let serverJs = "";
  try { serverJs = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8"); } catch { /* may not emit */ }
  return { dir, outDir, errors, errorCodes: errors.map((e) => e.code), serverJs };
}

// A single server fn `go` becomes a route via its onclick. `bodyStmts` is the
// server-fn body; `extraTop` seeds file-scope logic (used for the shadow case).
function appWith(bodyStmts, extraTop = "") {
  return `<program>
  \${
${extraTop}    server function go() {
${bodyStmts}
    }
  }
  <main><button onclick=go()>go</button></main>
</program>`;
}

// Strip the internal `_scrml_req._scrml_sess` token so a residual BARE `session`
// (the bug) is detectable independently of the lowered form.
function hasBareSession(serverJs) {
  const stripped = serverJs.replace(/_scrml_req\._scrml_sess/g, "§");
  return {
    bareIndex: /(?:^|[^.\w@])session\s*\[/.test(stripped),
    bareOptMember: /(?:^|[^.\w@])session\?\./.test(stripped),
    bareIdent: /(?:^|[^.\w@$])session(?![\w$.[?(])/.test(stripped),
  };
}

describe("B2 — no bare `session` reaches emitted JS (5 context-gate shapes)", () => {
  test("B2.1 index `session[\"theme\"]` lowers to `.get(\"theme\")`, no bare session[", () => {
    const { errorCodes, serverJs } = compile(appWith(`      let t = session["theme"]; return t`));
    expect(errorCodes).toEqual([]);
    expect(serverJs).toContain('_scrml_req._scrml_sess.get("theme")');
    expect(hasBareSession(serverJs).bareIndex).toBe(false);
  });

  test("B2.1 index canonical key `session[\"userId\"]` lowers to `.userId`", () => {
    const { errorCodes, serverJs } = compile(appWith(`      let u = session["userId"]; return u`));
    expect(errorCodes).toEqual([]);
    expect(serverJs).toContain("_scrml_req._scrml_sess.userId");
    expect(hasBareSession(serverJs).bareIndex).toBe(false);
  });

  test("B2.2 optional member `session?.userId` lowers to `.userId`, no bare session?.", () => {
    const { errorCodes, serverJs } = compile(appWith(`      let u = session?.userId; return u`));
    expect(errorCodes).toEqual([]);
    expect(serverJs).toContain("_scrml_req._scrml_sess.userId");
    expect(hasBareSession(serverJs).bareOptMember).toBe(false);
  });

  test("B2.3 optional call `session?.set(...)` lowers the WRITE (durable store emitted)", () => {
    const { errorCodes, serverJs } = compile(appWith(`      session?.set("userId", "x"); return "ok"`));
    expect(errorCodes).toEqual([]);
    expect(serverJs).toContain('_scrml_req._scrml_sess.set("userId", "x")');
    expect(hasBareSession(serverJs).bareOptMember).toBe(false);
    // the WRITE triggers the RULED durable SQLite session store
    expect(serverJs).toContain(".scrml-sessions.db");
  });

  test("B2.4 bare value-use `return session` is a clean compile error (E-SESSION-VALUE), never bare", () => {
    const { errorCodes, serverJs } = compile(appWith(`      return session`));
    expect(errorCodes).toContain("E-SESSION-VALUE");
    // build failed on the error; the placeholder (not a bare `session`) is all that emits
    expect(serverJs).not.toMatch(/return session\b/);
  });

  test("B2.4 bare value-use as an argument `log(session)` is E-SESSION-VALUE", () => {
    const { errorCodes } = compile(appWith(`      log(session); return "x"`));
    expect(errorCodes).toContain("E-SESSION-VALUE");
  });

  test("B2.5 file-scope `let session = {...}` is HONORED (not hijacked to _scrml_sess)", () => {
    const src = appWith(`      let u = session.userId; return u`, `    let session = { userId: "MINE" }\n`);
    const { errorCodes, serverJs } = compile(src);
    expect(errorCodes).toEqual([]);
    // the user's file-scope `session` value is honored — the read is NOT lowered to
    // the request-session context.
    expect(serverJs).not.toContain("_scrml_req._scrml_sess.userId");
  });

  test("a SIBLING handler still lowers `session` when another handler locally shadows it", () => {
    // handler `a` locally shadows `session` (declaredNames), handler `b` must STILL
    // lower the builtin — the file-scope shadow flag must NOT be set by a local.
    const src = `<program>
  \${
    server function a() { let session = { userId: "LOCAL" }; return session.userId }
    server function b() { return session.userId }
  }
  <main><button onclick=a()>a</button><button onclick=b()>b</button></main>
</program>`;
    const { errorCodes, serverJs } = compile(src);
    expect(errorCodes).toEqual([]);
    // handler b lowered to the request session context...
    expect(serverJs).toContain("_scrml_req._scrml_sess.userId");
    // ...and handler a honored its local `session` (no hijack of the local read).
    const strip = serverJs.replace(/_scrml_req\._scrml_sess/g, "§");
    expect(/session\s*=\s*\{\s*userId:\s*"LOCAL"/.test(strip)).toBe(true);
  });
});

describe("B2 — emit + EXECUTE: the index + optional lowered reads RUN (not just lower)", () => {
  const EXEC_APP = `<program>
  \${
    server function login(email, password) {
      if (email == "admin@x.com" && password == "secret") {
        session.set("userId", "u-77")
        session.set("role", "admin")
        return "ok"
      }
      return "bad"
    }
    server function who() {
      return { userId: session["userId"], role: session?.role, isAuth: session?.["isAuth"], pref: session?.get("pref") }
    }
  }
  <main><button onclick=login("a","b")>L</button><button onclick=who()>W</button></main>
</program>`;

  test("login then who() (index + optional forms) resolves the authed identity — no ReferenceError", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only

    const { dir, outDir, errorCodes } = compile(EXEC_APP);
    try {
      expect(errorCodes).toEqual([]);
      const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Date.now()}-${Math.random()}`);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const routeFor = (frag) => routes.find((r) => r.path.includes(frag));
      const loginR = routeFor("login"), whoR = routeFor("who");
      const post = (route, headers, body) =>
        route.handler(new Request(`http://localhost${route.path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) }));
      const cookieVal = (resp, name) => {
        const all = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [resp.headers.get("Set-Cookie") ?? ""];
        for (const c of all) { const m = c.match(new RegExp(`${name}=([^;]*)`)); if (m) return m[1]; }
        return null;
      };
      const jsonOf = async (r) => (r instanceof Response ? await r.json() : r);

      const r0 = await post(loginR, { "Content-Type": "application/json" }, {});
      const csrf = cookieVal(r0, "scrml_csrf");
      const base = { "Content-Type": "application/json", Cookie: `scrml_csrf=${csrf}`, "X-CSRF-Token": csrf };
      const sid = cookieVal(await post(loginR, base, { email: "admin@x.com", password: "secret" }), "scrml_sid");
      const withSid = { ...base, Cookie: `scrml_csrf=${csrf}; scrml_sid=${sid}` };

      // These reads exercise session["userId"] (index), session?.role + session?.["isAuth"]
      // (optional member/index) and session?.get("pref") (optional call) — all lowered.
      const who = await jsonOf(await post(whoR, withSid, {}));
      expect(who.userId).toBe("u-77");   // index read RAN
      expect(who.role).toBe("admin");    // optional member read RAN
      expect(who.isAuth).toBe(true);     // optional index read RAN
      expect(who.pref).toBe(null);       // optional call read RAN (no pref set)
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("no emitted app.server.js contains a bare undefined `session` reference", () => {
    const { serverJs } = compile(EXEC_APP);
    expect(hasBareSession(serverJs).bareIndex).toBe(false);
    expect(hasBareSession(serverJs).bareOptMember).toBe(false);
  });
});

describe("B1 — all five emitted cookie-name parses are name-anchored", () => {
  // An auth + session app that exercises all five parse sites (middleware,
  // session-begin, destroy route, csrf existing + cookieToken).
  const B1_APP = `<program>
  \${
    server function login(email, password) {
      session.set("userId", "u-1")
      return "ok"
    }
    server function out() { session.destroy(); return "bye" }
  }
  <main><button onclick=login("a","b")>L</button><button onclick=out()>O</button></main>
</program>`;

  test("no un-anchored /scrml_sid=([^;]+)/ or /scrml_csrf=([^;]+)/ survives", () => {
    const { serverJs, errorCodes } = compile(B1_APP);
    expect(errorCodes).toEqual([]);
    // the anchored form is present...
    expect(serverJs).toMatch(/match\(\/\(\?:\^\|;\\s\*\)scrml_sid=\(\[\^;\]\+\)\//);
    // ...and the un-anchored form is GONE at every site.
    expect(serverJs).not.toMatch(/match\(\/scrml_sid=\(\[\^;\]\+\)\//);
    expect(serverJs).not.toMatch(/match\(\/scrml_csrf=\(\[\^;\]\+\)\//);
  });

  test("the emitted anchored regex resolves the genuine sid past a prefix / crafted value", () => {
    // Reproduce the EMITTED parse behavior (the regex is emitted verbatim).
    const parse = (h) => h.match(/(?:^|;\s*)scrml_sid=([^;]+)/)?.[1] || null;
    expect(parse("foo=scrml_sid=ATK; scrml_sid=LEGIT")).toBe("LEGIT");
    expect(parse("Xscrml_sid=ATK; scrml_sid=LEGIT")).toBe("LEGIT");
    expect(parse("scrml_sid=LEGIT")).toBe("LEGIT");
    expect(parse("Xscrml_sid=ATK")).toBe(null);
  });
});

describe("B3 — role gates on a real userId in BOTH read paths", () => {
  const B3_APP = `<program>
  \${
    server function setRoleOnly(r) { session.set("role", r); return "role-only" }
    server function whoami() { return { role: session.role, isAuth: session.isAuth } }
  }
  <main><button onclick=setRoleOnly("a")>R</button><button onclick=whoami()>W</button></main>
</program>`;

  test("both the read-middleware `role:` line and the write-ctx `get role()` gate on userId", () => {
    const { serverJs, errorCodes } = compile(B3_APP);
    expect(errorCodes).toEqual([]);
    // read-middleware line (consumed by @currentUser / projection / serverLoad auth)
    expect(serverJs).toContain("role: (_rec && _rec.userId != null) ? (_rec.role ?? null) : null,");
    // write-ctx getter (the per-request session establishment context)
    expect(serverJs).toContain("get role() { return this._rec.userId != null ? (this._rec.role ?? null) : null; }");
    // the un-gated forms are gone
    expect(serverJs).not.toContain("role: _rec ? (_rec.role ?? null) : null,");
    expect(serverJs).not.toContain("get role() { return this._rec.role ?? null; }");
  });
});
