/**
 * emit-server handler dangling-refs — two same-class def/ref-gate bugs where the
 * emitted server references a runtime binding whose definition is gated MORE NARROWLY
 * than the reference, so a valid program compiles clean (`node --check` passes on a
 * free variable) but throws `ReferenceError` → HTTP 500 at request time. Verification
 * therefore EXECUTES the real emitted handler; it does not static-check.
 *
 * BUG 1 — g-currentuser-plain-handler-dangling
 *   A plain server-fn (RPC or `function*` SSE) that reads `@currentUser` DIRECTLY
 *   (`return { id: @currentUser.id }`, not via a `?{}` SQL interpolation) lowers to
 *   `_scrml_currentUser` (emit-expr server path). The handler-scope splice binds
 *   `const _scrml_currentUser = _scrml_current_user(_scrml_req)`, but the resolver
 *   `_scrml_current_user` was gated on `_needsSessionInfra`, whose `@currentUser`
 *   detector matched only the SQL-string shape (`astSqlQueryUsesCurrentUser`), NOT a
 *   direct ident read. A no-auth / no-serverLoad / no-`?{}` program therefore emitted
 *   the binding calling an UNEMITTED resolver → ReferenceError → 500. And the §36 SSE
 *   handler never spliced the binding at all → dangling `_scrml_currentUser`. Fixes:
 *   (a) broaden the resolver gate to `astReadsCurrentUserAmbient` (direct ident +
 *   SQL); (b) splice the binding in the SSE handler, mirroring the route handler.
 *   SPEC §52.15.1: `@currentUser` is the "compiler-provided ambient cell carrying the
 *   current request's authenticated identity, resolved server-side from the session
 *   middleware" — so the read must have the resolver present.
 *
 * BUG 2 — g-channel-auth-only-authcheck-dangling
 *   The §38 channel WS-upgrade handler references `_scrml_auth_check(req)` under
 *   `(!!authMiddlewareEntry || hasChannelAuth) && webAppShape`, but the DEFINITION was
 *   gated on `authMiddlewareEntry` ALONE. A `<channel auth=>` with NO `<program auth>`
 *   (hasChannelAuth true, authMiddlewareEntry null) emitted the reference with no
 *   definition → dangling `_scrml_auth_check` → ReferenceError at WS upgrade. Fix:
 *   widen the def gate (and `_needsSessionInfra`, for the `_scrml_session_middleware`
 *   it calls) to also cover `hasChannelAuth` — pure def/ref-gate alignment.
 *
 * Bun's NATIVE Request is required (a happy-dom Request strips the `Cookie` header) —
 * so these tests bail under a DOM global, mirroring gh357-session-sql-interpolation.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

function compileApp(src) {
  const dir = mkdtempSync(join(tmpdir(), "emit-dangling-"));
  const file = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  return { dir, outDir, errors };
}

async function importServer(outDir) {
  const serverJsPath = join(outDir, "app.server.js");
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  return mod;
}

const SID = "sid-dangling";
const TOK = "tok-dangling";
// double-submit CSRF: cookie token === header token passes _scrml_validate_csrf.
function authedReq(path, body) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Cookie": `scrml_csrf=${TOK}; __Host-scrml_sid=${SID}`,
      "X-CSRF-Token": TOK,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

// ---------------------------------------------------------------------------
// BUG 1 — @currentUser direct read in a plain handler
// ---------------------------------------------------------------------------

// A plain server fn that reads `@currentUser` DIRECTLY (no `?{}`), no `<program auth>`,
// no serverLoad — the exact shape whose resolver used to be gated off.
const RPC_DIRECT = `<program db="sqlite:./app.db">
  \${
    server function whoami() {
      return { id: @currentUser.id, role: @currentUser.role }
    }
    whoami()
  }
  <p>me</>
</program>`;

// A serverLoad (§52) app that reads `@currentUser` — must still emit EXACTLY ONE
// `_scrml_currentUser` binding per handler (not doubled by the new gate/splice).
const SERVERLOAD_CU = `<program auth="required" db="sqlite:./app.db">
  \${
    <orders server> = ?{\`SELECT * FROM orders WHERE user_id = \${@currentUser.id}\`}.all()
  }
  <p>\${@orders}</>
</program>`;

describe("BUG 1 — g-currentuser-plain-handler-dangling", () => {
  test("plain RPC handler reading @currentUser directly: resolver is defined, binding is present", () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(RPC_DIRECT);
    try {
      expect(errors).toEqual([]);
      const src = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8");
      // the resolver is now emitted for a direct read (was gated off → dangling)
      expect(src).toContain("function _scrml_current_user(req) {");
      // the handler-scope binding uses the byte-identical serverLoad/SSR construction
      expect(src).toContain("const _scrml_currentUser = _scrml_current_user(_scrml_req);");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("EXECUTED plain RPC handler: an authenticated call returns 200 with the identity (was ReferenceError 500)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(RPC_DIRECT);
    try {
      expect(errors).toEqual([]);
      // seed the session store BEFORE importing (module does `??= new Map()`).
      globalThis.__scrml_session_store = new Map([[SID, { userId: 7, role: "dispatcher" }]]);
      const mod = await importServer(outDir);
      const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
      const route = routes.find((r) => r.path.includes("whoami"));
      expect(route).toBeTruthy();

      const res = await route.handler(authedReq(route.path, {}));
      expect(res instanceof Response).toBe(true);
      expect(res.status).toBe(200); // <-- was a thrown ReferenceError on _scrml_current_user before the fix
      const body = await res.json();
      expect(body).toEqual({ id: 7, role: "dispatcher" });
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("no-regression: a serverLoad/SSR @currentUser app still emits EXACTLY ONE binding (not doubled)", () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(SERVERLOAD_CU);
    try {
      expect(errors).toEqual([]);
      const src = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8");
      const bindings = (src.match(/const _scrml_currentUser = _scrml_current_user\(_scrml_req\);/g) || []).length;
      // one per emitted handler that reads it (serverLoad data route + SSR seed), each
      // exactly once — the direct-read gate/splice must not add a duplicate `const`.
      expect(bindings).toBeGreaterThanOrEqual(1);
      // and never a doubled binding inside a single handler scope: no two consecutive
      // identical binding lines.
      expect(src).not.toContain(
        "const _scrml_currentUser = _scrml_current_user(_scrml_req);\n  const _scrml_currentUser = _scrml_current_user(_scrml_req);",
      );
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — <channel auth=>-only WS upgrade auth_check dangling
// ---------------------------------------------------------------------------

// A `<channel auth=>` with NO `<program auth>`: hasChannelAuth true, authMiddlewareEntry
// null — the WS-upgrade reference emitted, the definition used to not.
const CHANNEL_AUTH_ONLY = `<program db="sqlite:./app.db">
  <channel name="chat" topic="lobby" auth="required">
    \${
      <messages> = []
      server function postMessage(author, body) { return author }
    }
  </>
  <p>hi</>
</program>`;

// A program WITH auth middleware AND a channel: the def must still be emitted EXACTLY
// once (the `else if` must not double it).
const PROGRAM_AUTH_CHANNEL = `<program auth="required" db="sqlite:./app.db">
  <channel name="chat" topic="lobby">
    \${
      <messages> = []
      server function postMessage(author, body) { return author }
    }
  </>
  <p>hi</>
</program>`;

function findWsRoute(mod) {
  return Object.values(mod).find((v) => v && v.isWebSocket && typeof v.handler === "function");
}

describe("BUG 2 — g-channel-auth-only-authcheck-dangling", () => {
  test("<channel auth=>-only: _scrml_auth_check is DEFINED exactly once, with its _scrml_session_middleware dependency", () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(CHANNEL_AUTH_ONLY);
    try {
      expect(errors).toEqual([]);
      const src = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8");
      const defs = (src.match(/function _scrml_auth_check\(req\) \{/g) || []).length;
      expect(defs).toBe(1); // was 0 → dangling reference
      // the reference it must satisfy is present at the WS upgrade
      expect(src).toContain("const _authResult = _scrml_auth_check(req);");
      // and the middleware the def calls is present (was also gated off → nested dangle)
      expect(src).toContain("function _scrml_session_middleware(");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("EXECUTED WS upgrade for a <channel auth=>-only program does NOT throw ReferenceError", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(CHANNEL_AUTH_ONLY);
    try {
      expect(errors).toEqual([]);
      // seed a real authenticated identity BEFORE the single import (the module binds
      // `_scrml_session_store = globalThis.__scrml_session_store ??= new Map()` once at
      // load, so both drives below share this one seeded map).
      globalThis.__scrml_session_store = new Map([[SID, { userId: 3, role: "user" }]]);
      const mod = await importServer(outDir);
      const ws = findWsRoute(mod);
      expect(ws).toBeTruthy();

      // (a) UNAUTHENTICATED — no sid cookie → session.isAuth false → 302. BEFORE the
      // fix this line threw `ReferenceError: _scrml_auth_check is not defined`.
      let upgraded = false;
      const server1 = { upgrade: () => { upgraded = true; return true; } };
      const unauthReq = new Request(`http://localhost${ws.path}`, { method: "GET" });
      const res1 = ws.handler(unauthReq, server1);
      expect(res1 instanceof Response).toBe(true);
      expect(res1.status).toBe(302); // unauthenticated WS upgrade short-circuits (auth_check fired, no crash)
      expect(upgraded).toBe(false);

      // (b) AUTHENTICATED — seeded sid cookie → auth_check returns null → upgrade runs.
      upgraded = false;
      const server2 = { upgrade: () => { upgraded = true; return true; } };
      const authReq = new Request(`http://localhost${ws.path}`, {
        method: "GET",
        headers: { "Cookie": `__Host-scrml_sid=${SID}` },
      });
      const res2 = ws.handler(authReq, server2);
      expect(upgraded).toBe(true); // auth passed → upgrade attempted, no ReferenceError
      expect(res2).toBeUndefined(); // Bun upgrade contract: undefined on success
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("no-regression: a <program auth> program with a channel emits _scrml_auth_check EXACTLY once (else-if never doubles)", () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(PROGRAM_AUTH_CHANNEL);
    try {
      expect(errors).toEqual([]);
      const src = require("fs").readFileSync(join(outDir, "app.server.js"), "utf8");
      const defs = (src.match(/function _scrml_auth_check\(req\) \{/g) || []).length;
      expect(defs).toBe(1);
      // and the WS reference still resolves it
      expect(src).toContain("const _authResult = _scrml_auth_check(req);");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });
});
