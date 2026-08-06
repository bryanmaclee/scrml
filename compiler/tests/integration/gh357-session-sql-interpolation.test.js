/**
 * GH #357 — `session.*` inside a `?{}` SQL interpolation survives into `.server.js`
 * as a bare, UNBOUND identifier → the emitted handler closes over a free variable →
 * `ReferenceError: session is not defined` → HTTP 500 on every authenticated call.
 *
 * The `?{}` interpolation is captured as a STRING, so `session` there is invisible to
 * BOTH the AST member/index lowering (emit-expr) AND the AST-keyed session-infra gate.
 * Direction B (bryan, S316; dpa-021 ratified S319): emit a handler-scoped `session`
 * binding in the server prologue so the bare identifier resolves everywhere. The
 * binding is a PROXY, not a raw `const session = _scrml_req._scrml_sess` — a raw bind
 * turns `session[<request-key>]` into a raw property read at the wrong object level,
 * disclosing the live session id (`sid`) and the full record incl. the §40.2
 * `csrfToken` (`_rec`) at HTTP 200: a confidentiality break. The AST lowering is KEPT
 * (three security gates match the literal `_scrml_req._scrml_sess.`); the Proxy AGREES
 * with it (both route custom/dynamic keys through `.get()`).
 *
 * `node --check` PASSES on the broken artifact (a free var is legal JS), so this drives
 * the REAL emitted handler end-to-end. Bun's NATIVE Request is required — a happy-dom
 * Request (loaded by sibling browser tests) strips the forbidden `Cookie` header, so
 * the sid/csrf cookies never reach the handler. Mirrors session-establishment-roundtrip.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";

// The #357 reproducer: an ORDINARY `session.isAuth` (AST-lowered) AND an INTERPOLATED
// `${session.userId}` (text-carried, the bug) in one server fn.
const MIX_APP = (dbPath) => `<program db="${dbPath}">
  \${
    server function loadMe() {
      if (!session.isAuth) {
        return not
      }
      const rows = ?{ select id, email from users where id = \${session.userId} }
      return rows[0]
    }
    loadMe()
  }
  <p>me</>
</program>`;

// The index/confidentiality reproducer: `${session[k]}` with `k` from the request
// body, echoed back through SQL so the disclosed value is observable.
const IDX_APP = (dbPath) => `<program db="${dbPath}">
  \${
    server function peek(k) {
      const rows = ?{ select \${session[k]} as leaked }
      return rows[0]
    }
    peek("x")
  }
  <p>x</>
</program>`;

function compileApp(appFor) {
  const dir = mkdtempSync(join(tmpdir(), "gh357-"));
  const dbPath = join(dir, "test.db").replace(/\\/g, "/");
  const file = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(file, appFor(dbPath));
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  return { dir, outDir, dbPath, errors };
}

function seedUsers(dbPath) {
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS users");
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)");
  db.run("INSERT INTO users (id, email) VALUES (1, 'a@b.c')");
  db.close();
}

async function importServer(outDir) {
  const serverJsPath = join(outDir, "app.server.js");
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const routes = mod.routes || Object.values(mod).filter((v) => v && v.path && v.handler);
  return { mod, routes };
}

const SID = "sid-gh357";
const TOK = "tok-gh357";
// double-submit CSRF: cookie token === header token passes _scrml_validate_csrf.
function authedReq(route, body) {
  return new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: {
      "Cookie": `scrml_csrf=${TOK}; __Host-scrml_sid=${SID}`,
      "X-CSRF-Token": TOK,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

describe("GH #357 — session inside a ?{} SQL interpolation", () => {
  test("emitted prologue binds `session` (Proxy), KEEPS the AST lowering, and does not add a `session` case to rewriteServerAtRef", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, errors } = compileApp(MIX_APP);
    try {
      expect(errors).toEqual([]);
      const src = await Bun.file(join(outDir, "app.server.js")).text();

      // (a) the prologue Proxy binding is emitted...
      expect(src).toContain("const session = _scrml_session_bind(_scrml_req._scrml_sess);");
      expect(src).toContain("function _scrml_session_bind(_s) {");
      expect(src).toContain("return new Proxy(_s, {");
      // ...and it is a Proxy that routes non-canonical keys through `.get()` (NOT a
      // raw property read) — the confidentiality-preserving shape.
      expect(src).toContain("return t.get(k);");

      // (b) the AST lowering STAYS — the ordinary `session.isAuth` still lowers to
      // the literal `_scrml_req._scrml_sess.` that the three security gates match.
      expect(src).toContain("_scrml_req._scrml_sess.isAuth");

      // (c) the interpolation still carries a bare `session.userId` (text-level) —
      // now RESOLVED by the prologue binding rather than left free.
      expect(src).toMatch(/where id = \$\{session\.userId\}/);
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("EXECUTED handler: an authenticated call returns 200 (was ReferenceError 500)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, dbPath, errors } = compileApp(MIX_APP);
    try {
      expect(errors).toEqual([]);
      seedUsers(dbPath);
      // seed the session store BEFORE importing (module does `??= new Map()`).
      globalThis.__scrml_session_store = new Map([[SID, { userId: 1, role: "user" }]]);
      const { routes } = await importServer(outDir);
      const route = routes.find((r) => r.path.includes("loadMe"));
      expect(route).toBeTruthy();

      const res = await route.handler(authedReq(route, {}));
      expect(res instanceof Response).toBe(true);
      expect(res.status).toBe(200); // <-- was a thrown ReferenceError before the fix
      const body = await res.json();
      expect(body).toEqual({ id: 1, email: "a@b.c" });
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("ordinary position unchanged: `session.isAuth` false-path early-returns (no leak of the SQL row)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, dbPath, errors } = compileApp(MIX_APP);
    try {
      expect(errors).toEqual([]);
      seedUsers(dbPath);
      // an UN-authenticated session record (no userId) → session.isAuth is false.
      globalThis.__scrml_session_store = new Map([[SID, { role: "user" }]]);
      const { routes } = await importServer(outDir);
      const route = routes.find((r) => r.path.includes("loadMe"));
      const res = await route.handler(authedReq(route, {}));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBe(null); // early return `not` — the ordinary lowering still gates
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });

  test("index form keeps `.get()`: `session[reqKey]` reads the record value but NEVER discloses `sid`/`_rec` (confidentiality)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    const { dir, outDir, dbPath, errors } = compileApp(IDX_APP);
    try {
      expect(errors).toEqual([]);
      const src = await Bun.file(join(outDir, "app.server.js")).text();
      // the interpolation carries a bare `session[k]` (text-level), bound by the Proxy.
      expect(src).toMatch(/select \$\{session\[k\]\} as leaked/);
      expect(src).toContain("const session = _scrml_session_bind(_scrml_req._scrml_sess);");

      seedUsers(dbPath);
      globalThis.__scrml_session_store = new Map([[SID, {
        userId: 1, role: "user", email: "secret@corp.com", csrfToken: "CSRFSECRET",
      }]]);
      const { routes } = await importServer(outDir);
      const route = routes.find((r) => r.path.includes("peek"));

      const call = async (k) => {
        const res = await route.handler(authedReq(route, { k }));
        expect(res.status).toBe(200); // never a throw
        return (await res.json()).leaked;
      };

      // a real custom key routes through `.get()` → the record value.
      expect(await call("email")).toBe("secret@corp.com");
      expect(await call("userId")).toBe(1);
      // THE SECURITY PROPERTY — a request-controlled key can NOT read the raw
      // accessor internals: `sid` (live session id) and `_rec` (full record +
      // csrfToken) both resolve to null via `.get()`, NOT the raw property.
      expect(await call("sid")).toBe(null);
      expect(await call("_rec")).toBe(null);
      // a missing key → null (scrml `not`), never `undefined`.
      expect(await call("missing")).toBe(null);
    } finally {
      try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    }
  });
});
