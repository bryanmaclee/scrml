/**
 * §20.5.1 session hardening — S266 (i29e) pass-2: B4a + B4b + B5 (emit-shape).
 *
 * B4a — `__Host-scrml_sid` + always-`Secure` is the DEFAULT (secure mode). A
 *       `session-secure="false"` opt-out emits the plain `scrml_sid` cookie with
 *       the dev-gated `_scrml_is_secure_req` Secure (a conscious TLS-less deploy).
 *       The read side resolves EITHER cookie name (both boundary-anchored) in
 *       BOTH modes, at no cost.
 * B4b — the `session-secure=` attribute parses + threads; a bad value surfaces
 *       W-ATTR-002 and re-defaults to the safe secure mode. Secure mode emits a
 *       once-per-process runtime warn for the Secure-over-bare-http case.
 * B5  — a LITERAL `session.set("csrfToken", …)` is a clean E-SESSION-RESERVED-KEY;
 *       the runtime setter refuses the compiler-owned `csrfToken` key (no-op).
 *
 * Execute coverage (the S265 emitted-≠-runs rule) lives in the sibling
 * integration file session-secure-b4b5-roundtrip.test.js.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "session-secure-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  try {
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    return {
      serverJs: out?.serverJs ?? "",
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

// A no-auth session app (a login page): session.set alone server-escalates it.
// No `auth=` → secure mode is the default (nothing to opt into).
const SESSION_APP = `<program>
  \${
    server function doLogin() {
      session.set("userId", "u-1")
      return "ok"
    }
    server function out() { session.destroy(); return "bye" }
  }
  <button onclick=doLogin()>Login</button>
</program>`;

// Same app, opting OUT of Secure via `session-secure="false"` on <program>.
const OPTOUT_APP = `<program session-secure="false">
  \${
    server function doLogin() {
      session.set("userId", "u-1")
      return "ok"
    }
    server function out() { session.destroy(); return "bye" }
  }
  <button onclick=doLogin()>Login</button>
</program>`;

describe("B4a — __Host-scrml_sid + always-Secure is the default (secure mode)", () => {
  test("the establishment cookie is __Host-scrml_sid; Secure is unconditional", () => {
    const res = compile(SESSION_APP);
    expect(nonWarn(res.errors)).toEqual([]);
    // identity + preference commit + destroy-clear all use the __Host- name.
    expect(res.serverJs).toContain("return `__Host-scrml_sid=${_newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${_scrml_session_max_age}` + _sec");
    expect(res.serverJs).toContain("return `__Host-scrml_sid=${_sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${_scrml_session_max_age}` + _sec");
    expect(res.serverJs).toContain("return '__Host-scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax' + _sec");
    // Secure is ALWAYS on (a __Host- cookie requires it) — not `_scrml_is_secure_req`-gated.
    expect(res.serverJs).toContain("const _sec = '; Secure';");
    expect(res.serverJs).not.toContain("const _sec = secure ? '; Secure' : '';");
    // no PLAIN scrml_sid Set-Cookie leaks (only the read helper mentions it).
    expect(res.serverJs).not.toContain("'scrml_sid=;");
    expect(res.serverJs).not.toContain("`scrml_sid=${_newSid}");
  });

  test("the read side resolves EITHER cookie name, both boundary-anchored", () => {
    const res = compile(SESSION_APP);
    expect(res.serverJs).toContain("function _scrml_read_session_id(cookieHeader)");
    // __Host- first, then plain, both anchored (B1 fixation defense preserved).
    expect(res.serverJs).toContain("cookieHeader.match(/(?:^|;\\s*)__Host-scrml_sid=([^;]+)/)?.[1]");
    expect(res.serverJs).toContain("cookieHeader.match(/(?:^|;\\s*)scrml_sid=([^;]+)/)?.[1]");
    // every read site routes through the shared reader (no inline unanchored parse).
    expect(res.serverJs).toContain("const sessionId = _scrml_read_session_id(cookieHeader);");
    expect(res.serverJs).toContain("const sid = _scrml_read_session_id(cookieHeader);");
    expect(res.serverJs).not.toMatch(/match\(\/scrml_sid=\(\[\^;\]\+\)\//);
  });
});

describe("B4b — session-secure=\"false\" opts out (plain scrml_sid, dev-gated Secure)", () => {
  test("opt-out emits the plain scrml_sid cookie with dev-gated Secure + no warn helper", () => {
    const res = compile(OPTOUT_APP);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).toContain("return `scrml_sid=${_newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${_scrml_session_max_age}` + _sec");
    expect(res.serverJs).toContain("return 'scrml_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax' + _sec");
    // dev-gated Secure (the S239 FIX 3 behavior) — NOT unconditional.
    expect(res.serverJs).toContain("const _sec = secure ? '; Secure' : '';");
    // no __Host- Set-Cookie is emitted (the read helper still references the name).
    expect(res.serverJs).not.toContain("`__Host-scrml_sid=${_newSid}");
    expect(res.serverJs).not.toContain("'__Host-scrml_sid=;");
    // the bare-http warn helper is secure-mode-only — absent on the opt-out path.
    expect(res.serverJs).not.toContain("_scrml_warn_insecure_cookie");
    // the read side STILL resolves both names (mode-independent).
    expect(res.serverJs).toContain("function _scrml_read_session_id(cookieHeader)");
    expect(res.serverJs).toContain("cookieHeader.match(/(?:^|;\\s*)__Host-scrml_sid=([^;]+)/)?.[1]");
  });

  test("session-secure=\"false\" on <page> threads the same opt-out", () => {
    const res = compile(`<program>
      <page route="/x" auth="optional" session-secure="false">
        \${
          server function doLogin() { session.set("userId", "u-1"); return "ok" }
        }
        <button onclick=doLogin()>Login</button>
      </page>
    </program>`);
    // page-level session-secure="false" reaches the cookie emission (opt-out mode).
    expect(res.serverJs).toContain("return `scrml_sid=${_newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${_scrml_session_max_age}` + _sec");
    expect(res.serverJs).not.toContain("`__Host-scrml_sid=${_newSid}");
  });

  test("a bad session-secure value → W-ATTR-002 and re-defaults to secure mode", () => {
    const res = compile(SESSION_APP.replace("<program>", '<program session-secure="nope">'));
    expect(hasCode(res, "W-ATTR-002")).toBe(true);
    // safe default: an unrecognized value is treated as secure (the __Host- cookie).
    expect(res.serverJs).toContain("`__Host-scrml_sid=${_newSid}");
    expect(res.serverJs).toContain("const _sec = '; Secure';");
  });

  test("secure mode emits a once-per-process bare-http warn", () => {
    const res = compile(SESSION_APP);
    expect(res.serverJs).toContain("let _scrml_insecure_cookie_warned = false;");
    expect(res.serverJs).toContain("function _scrml_warn_insecure_cookie(req)");
    // the warn fires only for non-https AND non-local (the browser-reject case).
    expect(res.serverJs).toContain("if (_proto !== 'https' && !_isLocal) {");
    // it is invoked on the cookie-set seam.
    expect(res.serverJs).toContain("_scrml_warn_insecure_cookie(_scrml_req);");
  });
});

describe("B5 — reserved-key guard closes the csrfToken mass-assign", () => {
  test("the runtime setter refuses the compiler-owned csrfToken key (no-op)", () => {
    const res = compile(SESSION_APP);
    expect(res.serverJs).toContain('set(key, value) { if (key === "csrfToken") return;');
    // userId / role stay writable (the login primitive).
    expect(res.serverJs).toContain("this._rec[key] = value; this._changes[key] = value; this._dirty = true; this._destroy = false;");
  });

  test("a LITERAL session.set(\"csrfToken\", …) is a clean E-SESSION-RESERVED-KEY", () => {
    const res = compile(`<program>
      \${
        server function pinToken() {
          session.set("csrfToken", "attacker-known")
          return "ok"
        }
      }
      <button onclick=pinToken()>x</button>
    </program>`);
    expect(hasCode(res, "E-SESSION-RESERVED-KEY")).toBe(true);
  });

  test("session.set with a NON-reserved literal key is unaffected", () => {
    const res = compile(`<program>
      \${
        server function setPref() {
          session.set("theme", "dark")
          return "ok"
        }
      }
      <button onclick=setPref()>x</button>
    </program>`);
    expect(hasCode(res, "E-SESSION-RESERVED-KEY")).toBe(false);
    expect(nonWarn(res.errors)).toEqual([]);
    expect(res.serverJs).toContain('_scrml_req._scrml_sess.set("theme", "dark")');
  });
});
