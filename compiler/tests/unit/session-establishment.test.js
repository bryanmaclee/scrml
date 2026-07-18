/**
 * §20.5 session-establishment primitive (`session.set`) — i29e (S265) unit tests.
 *
 * Covers the WRITE half activated in this build (the READ half — `scrml_sid`
 * cookie → store → `_scrml_session_middleware` → `@currentUser` — shipped S233):
 *
 *   U1  `session.set(k,v)` in a server fn lowers to `_scrml_req._scrml_sess.set(k,v)`
 *   U2  the hosting handler is wrapped with `_scrml_session_cookie_wrap(...)`
 *   U3  the durable SQLite store is emitted (bun:sqlite Database, .scrml-sessions.db);
 *       the in-memory `new Map()` store is NOT used
 *   U4  the commit emits the establishment cookie
 *       `Set-Cookie: __Host-scrml_sid=…; HttpOnly; SameSite=Lax; Max-Age=<expiry>; Secure`
 *       (B4a secure-mode default; plain `scrml_sid` under `session-secure="false"`)
 *   U5  multiple `session.set` calls coalesce to ONE store write + ONE cookie
 *   U6  `session.destroy()` lowers + commit deletes the record + clears the cookie
 *   U7  `session.userId` / `.role` / `.isAuth` reads lower to the per-request ctx
 *   U8  a bare-`session` read is server-escalated (route-inference trigger) — no
 *       E-SCOPE-001; and a genuinely CLIENT-side `session` read is E-SCOPE-012
 *   U9  webAppShape gate — a headless `kind="tool"` program emits NO cookie-session
 *       write infra (store / begin / commit / cookie-wrap) — bearer-auth territory
 *   U10 no-regression — an app that never touches `session` emits none of the
 *       WRITE infra (no `_scrml_session_begin` / cookie-wrap)
 *   U11 the read middleware consults the SAME durable store the write side uses
 *       (unification — else a login sets a cookie the middleware can't resolve)
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

// Compile a source string and return the emitted serverJs + diagnostics. A
// `?{}` block that names a table needs a CREATE TABLE (compile-time schema
// validation) — sources below either declare one or avoid `?{}` entirely.
function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "session-establishment-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  try {
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    return {
      serverJs: out?.serverJs ?? "",
      clientJs: out?.clientJs ?? "",
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
  }
}

const nonWarn = (errs) => errs.filter((e) => !/^[WI]-/.test(e.code ?? ""));
const hasCode = (res, code) =>
  [...res.errors, ...res.warnings].some((d) => d && d.code === code);

// A login page: no `auth=` (you are not logged in yet). The server fn is
// server-escalated purely by touching the `session` builtin (route-inference
// trigger), so the durable session infra is forced ON even without `auth=`.
const LOGIN = `<program>
  \${
    server function doLogin() {
      session.set("userId", "u-1")
      session.set("role", "admin")
      return "ok"
    }
  }
  <button onclick=doLogin()>Login</button>
</program>`;

describe("§20.5 session.set — lowering + write infra", () => {
  test("U1/U2 session.set lowers to the per-request ctx + handler is cookie-wrapped", () => {
    const res = compile(LOGIN);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).toContain(`_scrml_req._scrml_sess.set("userId", "u-1")`);
    expect(res.serverJs).toContain(`_scrml_req._scrml_sess.set("role", "admin")`);
    expect(res.serverJs).toContain("_scrml_session_cookie_wrap(");
    // the route registration wraps the handler
    expect(res.serverJs).toMatch(/handler:\s*_scrml_session_cookie_wrap\(/);
  });

  test("U3 durable SQLite store is emitted (keyed by a deterministic path); the Map is not", () => {
    const res = compile(LOGIN);
    expect(res.serverJs).toContain('import { Database as _ScrmlSessionDatabase } from "bun:sqlite"');
    expect(res.serverJs).toContain("new _ScrmlSessionDatabase(_scrml_session_db_path)");
    // S239 FIX 9 — deterministic path beside the bundle, keyed cache (no bleed).
    expect(res.serverJs).toContain("import.meta.dir");
    expect(res.serverJs).toContain("globalThis.__scrml_session_stores");
    // a session-WRITE app must NOT use the read-only in-memory Map
    expect(res.serverJs).not.toContain("globalThis.__scrml_session_store ??= new Map()");
  });

  test("U4 commit emits the establishment cookie with HttpOnly; SameSite=Lax; Max-Age; Secure", () => {
    const res = compile(LOGIN);
    expect(res.serverJs).toContain("function _scrml_session_commit(sess, secure)");
    // S239 FIX 1 — the cookie carries a FRESH rotated sid (`_newSid`), never the
    // incoming one. B4a (S266) — LOGIN is a no-auth session app → secure mode
    // (default): the cookie is `__Host-scrml_sid` and ALWAYS `Secure` (a `__Host-`
    // cookie is browser-rejected without Secure; it still round-trips over
    // http://localhost since localhost is a secure context).
    expect(res.serverJs).toContain(
      "return `__Host-scrml_sid=${_newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${_scrml_session_max_age}` + _sec",
    );
    expect(res.serverJs).toContain("const _sec = '; Secure';");
    // default expiry is 1h (3600s) when no sessionExpiry= is present
    expect(res.serverJs).toContain("const _scrml_session_max_age = 3600;");
    // the wrapper appends the cookie (a second Set-Cookie, never a clobber)
    expect(res.serverJs).toContain("_resp.headers.append('Set-Cookie', _ck)");
  });

  test("U5 multiple session.set calls coalesce to ONE store write + ONE cookie", () => {
    const res = compile(LOGIN);
    // commit does exactly one durable write and returns exactly one cookie —
    // regardless of how many session.set calls ran in the body.
    const commit = res.serverJs.slice(
      res.serverJs.indexOf("function _scrml_session_commit(sess, secure)"),
      res.serverJs.indexOf("function _scrml_session_cookie_wrap"),
    );
    const setCalls = (commit.match(/_scrml_session_store\.set\(_newSid,/g) || []).length;
    const cookieReturns = (commit.match(/scrml_sid=\$\{_newSid\}/g) || []).length;
    expect(setCalls).toBe(1);
    expect(cookieReturns).toBe(1);
    // the wrapper appends the cookie exactly once
    const wrap = res.serverJs.slice(res.serverJs.indexOf("function _scrml_session_cookie_wrap"));
    expect((wrap.match(/headers\.append\('Set-Cookie'/g) || []).length).toBe(1);
  });

  test("U3b session fixation — an identity commit mints a FRESH sid and deletes the incoming one", () => {
    const res = compile(LOGIN);
    const commit = res.serverJs.slice(
      res.serverJs.indexOf("function _scrml_session_commit(sess, secure)"),
      res.serverJs.indexOf("function _scrml_session_cookie_wrap"),
    );
    // an identity write mints a fresh uuid; NEVER reuse the incoming `sess.sid`.
    expect(commit).toContain("const _newSid = crypto.randomUUID();");
    expect(commit).not.toContain("sess.sid || crypto.randomUUID()");
    // the old (incoming) record is deleted so a planted sid is not resurrectable.
    expect(commit).toContain("if (sess.sid && sess.sid !== _newSid) _scrml_session_store.delete(sess.sid)");
  });

  test("U4b isAuth requires a real record WITH a userId (no cookie-only bypass)", () => {
    const res = compile(LOGIN);
    // middleware + write-ctx unified on the same rule.
    expect(res.serverJs).toContain("isAuth: !!_rec && _rec.userId != null,");
    expect(res.serverJs).not.toContain("isAuth: !!sessionId,");
    expect(res.serverJs).toContain("get isAuth() { return this._rec.userId != null && !this._destroy; }");
  });

  test("U7b destroy() then set() establishes (set clears _destroy)", () => {
    const res = compile(LOGIN);
    // B5 (S266) — the reserved-key guard prefixes the setter (a `csrfToken` write
    // is refused); `userId`/`role`/preferences still establish + clear _destroy.
    expect(res.serverJs).toContain(
      "set(key, value) { if (key === \"csrfToken\") return; this._rec[key] = value; this._changes[key] = value; this._dirty = true; this._destroy = false; }",
    );
  });

  test("U6 session.destroy lowers + commit deletes the record + clears the cookie", () => {
    const res = compile(`<program>
      \${
        server function doLogout() {
          session.destroy()
          return "bye"
        }
      }
      <button onclick=doLogout()>Logout</button>
    </program>`);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).toContain("_scrml_req._scrml_sess.destroy()");
    expect(res.serverJs).toContain("_scrml_session_store.delete(sess.sid)");
    // B4a (S266) — secure mode (no-auth default): the clearing cookie is
    // `__Host-scrml_sid` (same name as the establishment cookie, or the browser
    // won't clear it).
    expect(res.serverJs).toContain(
      "return '__Host-scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax'",
    );
  });

  test("U7 session field reads lower to the per-request ctx", () => {
    const res = compile(`<program>
      \${
        server function who() {
          let a = session.userId
          let b = session.role
          let c = session.isAuth
          session.set("seen", true)
          return "x"
        }
      }
      <button onclick=who()>Who</button>
    </program>`);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).toContain("_scrml_req._scrml_sess.userId");
    expect(res.serverJs).toContain("_scrml_req._scrml_sess.role");
    expect(res.serverJs).toContain("_scrml_req._scrml_sess.isAuth");
  });
});

describe("§20.5 session — scope classification (E-SCOPE-012)", () => {
  test("U8a a bare-session read escalates to server — no E-SCOPE-001", () => {
    const res = compile(LOGIN);
    expect(hasCode(res, "E-SCOPE-001")).toBe(false);
    expect(hasCode(res, "E-SCOPE-012")).toBe(false);
  });

  test("U8b a session read outside a server-escalated function body is E-SCOPE-012", () => {
    // Bare `session` AUTO-escalates the enclosing FUNCTION to the server (the
    // route-inference trigger), so the E-SCOPE-012 fire site is a `session`
    // reference that is NOT inside a function body — e.g. top-level `${ }` markup
    // logic, which is evaluated client/SSR-side and is never server-escalated.
    // There the ident walker (which binds `session` only in a server boundary)
    // upgrades the reference to the tailored E-SCOPE-012 rather than a generic
    // E-SCOPE-001.
    const res = compile(`<program>
      \${ let x = session.userId }
      <main>\${x}</main>
    </program>`);
    expect(hasCode(res, "E-SCOPE-012")).toBe(true);
    expect(hasCode(res, "E-SCOPE-001")).toBe(false);
  });
});

describe("§20.5 session — context gate (FIX 6, default-deny) + no-regression", () => {
  test("U9 a headless kind=\"tool\" session.set is a COMPILE ERROR (E-SESSION-CONTEXT)", () => {
    const res = compile(`<program kind="tool">
      \${
        server function stash() {
          session.set("userId", "u-1")
          return "ok"
        }
        fn main() -> int { 0 }
      }
    </program>`);
    // Headless is bearer-auth territory — session.* has no cookie context there,
    // so it must fire a COMPILE ERROR, not silently emit a crashing ref.
    expect(hasCode(res, "E-SESSION-CONTEXT")).toBe(true);
    // and no cookie-session write infra leaks into the headless bundle
    expect(res.serverJs).not.toContain(".scrml-sessions.db");
  });

  test("U9b session.set in a peer-called in-process server fn is E-SESSION-CONTEXT", () => {
    // `helper` is called in-process by `route` → it is peer-emitted (no request
    // context). session.set in it must compile-error, not ReferenceError at runtime.
    const res = compile(`<program>
      \${
        server function helper() {
          session.set("userId", "u-1")
          return "ok"
        }
        server function route() {
          let r = helper()
          return r
        }
      }
      <button onclick=route()>go</button>
    </program>`);
    expect(hasCode(res, "E-SESSION-CONTEXT")).toBe(true);
  });

  test("U10 an app that never touches session emits no WRITE infra", () => {
    const res = compile(`<program>
      <count> = 0
      <button onclick=\${@count = @count + 1}>\${@count}</button>
    </program>`);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).not.toContain("_scrml_session_begin");
    expect(res.serverJs).not.toContain("_scrml_session_cookie_wrap");
    expect(res.serverJs).not.toContain(".scrml-sessions.db");
  });

  test("U10b FIX 8 — a read-only-auth app (no session.set) does NOT get durable SQLite", () => {
    // auth="required" + a server fn that never calls session.set → the read infra
    // still emits, but the store stays the in-memory Map (no unrequested on-disk db).
    const res = compile(`<program auth="required">
      <db src="./app.db" tables="notes">
        \${
          export server function addNote(t) {
            ?{\`INSERT INTO notes (t) VALUES (\${t})\`}.run()
            return "ok"
          }
        }
        <button onclick=addNote("x")>add</button>
      </>
    </program>`);
    expect(res.serverJs).toContain("_scrml_session_middleware");
    // FIX 8 — Map store, NOT the durable bun:sqlite one.
    expect(res.serverJs).toContain("globalThis.__scrml_session_store ??= new Map()");
    expect(res.serverJs).not.toContain(".scrml-sessions.db");
    expect(res.serverJs).not.toContain('from "bun:sqlite"');
    // and no write helpers (no session builtin used)
    expect(res.serverJs).not.toContain("_scrml_session_begin");
  });
});

describe("§20.5 session — read/write store unification", () => {
  test("U11 the read middleware reads the SAME durable store the write side writes", () => {
    const res = compile(LOGIN);
    // one store handle, referenced by BOTH the read middleware and the write ctx.
    expect(res.serverJs).toContain("function _scrml_session_middleware(req)");
    expect(res.serverJs).toContain("function _scrml_session_begin(req)");
    // both resolve the record from the identical `_scrml_session_store.get(...)`.
    const mw = res.serverJs.slice(
      res.serverJs.indexOf("function _scrml_session_middleware(req)"),
      res.serverJs.indexOf("function _scrml_current_user"),
    );
    expect(mw).toContain("_scrml_session_store.get(sessionId)");
    const begin = res.serverJs.slice(res.serverJs.indexOf("function _scrml_session_begin(req)"));
    expect(begin).toContain("_scrml_session_store.get(sid)");
  });
});

describe("§20.5 session — S239-2 destroy-clear + identity-vs-preference commit", () => {
  const commitOf = (res) =>
    res.serverJs.slice(
      res.serverJs.indexOf("function _scrml_session_commit(sess, secure)"),
      res.serverJs.indexOf("function _scrml_session_cookie_wrap"),
    );

  test("A1 destroy() performs a REAL clear (wipes _rec + _changes, sets sticky _reset)", () => {
    const res = compile(LOGIN);
    expect(res.serverJs).toContain(
      "destroy() { this._destroy = true; this._dirty = false; this._rec = {}; this._changes = {}; this._reset = true; }",
    );
  });

  test("A2 an identity-establishing commit builds the record from changes ALONE (no old-record merge)", () => {
    const commit = commitOf(compile(LOGIN));
    // identity write = userId in changes OR a destroy happened (_reset)
    expect(commit).toContain("Object.prototype.hasOwnProperty.call(sess._changes, 'userId') || sess._reset");
    // the rotated record is `{ ...sess._changes }` — NOT merged with the prior/destroyed principal
    expect(commit).toContain("_scrml_session_store.set(_newSid, { ...sess._changes }, _scrml_session_max_age)");
    expect(commit).toContain("if (sess.sid && sess.sid !== _newSid) _scrml_session_store.delete(sess.sid)");
  });

  test("B1 a preference-only (non-identity) commit updates IN PLACE under the same sid (no rotation/delete)", () => {
    const commit = commitOf(compile(LOGIN));
    // reuse the incoming sid only when a live record exists (never write under a
    // recordless attacker-suppliable sid); merge preserves userId/role/csrf.
    expect(commit).toContain("const _existing = sess.sid ? _scrml_session_store.get(sess.sid) : null;");
    expect(commit).toContain("const _sid = _existing ? sess.sid : crypto.randomUUID();");
    expect(commit).toContain("const _merged = { ...(_existing || {}), ...sess._changes };");
    expect(commit).toContain("_scrml_session_store.set(_sid, _merged, _scrml_session_max_age)");
    // the preference path returns the SAME sid — it must NOT delete the old record
    const prefPath = commit.slice(commit.indexOf("const _existing ="));
    expect(prefPath).not.toContain("_scrml_session_store.delete");
  });
});
