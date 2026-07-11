/**
 * issue-26-server-auto-await-stdlib.test.js — P0 auth-bypass regression.
 *
 * Issue #26 (pjoliver11, v0.7.1): in a `?{}`-bearing server function the compiler
 * awaited the `?{}` SQL template calls but NOT plain imported `async` stdlib calls
 * (`scrml:auth` `verifyPassword` / `hashPassword`). scrml has no `async`/`await`
 * source surface (compiler-managed CPS), so the leaked `Promise`:
 *   1. `const ok = verifyPassword(...)` → truthy Promise → `if (!ok)` never fires
 *      → every password accepted (AUTH BYPASS).
 *   2. `hashPassword(...)` in an INSERT → stores a stringified Promise, not the digest.
 *
 * Two-layer root cause fixed:
 *   - STDLIB-EXPORT-SEED (api.js) did not resolve `scrml:auth`'s re-export chain
 *     (`export { verifyPassword } from './password.scrml'`), so the classifier saw
 *     `kind:"re-export"` with no `isAsync` and classified the fn as SYNC.
 *   - The server-fn emit path (emit-server.ts) never consulted the auto-await
 *     classifier; the SQL await came from case "sql" always-await, not the classifier.
 *
 * This test compiles server fns exercising EVERY call shape and asserts the emitted
 * SERVER JS awaits the async stdlib callee — and that a SYNC stdlib call
 * (`scrml:host` `safeCall`) is NOT awaited (no over-await regression).
 *
 * SPEC anchors: §13.1 stdlib carve-out, §13.2.1 auto-await classifier,
 * §41.4.1 Promise-always authoring rule, §44 SQL emission.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/issue-26-server-auto-await");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

// Compile one .scrml file; return the emitted SERVER JS + non-warning errors.
// E-PA-002 (DB file missing) is a runtime-only precondition irrelevant to emit
// shape — the server bundle is still emitted — so it is filtered out.
function compileServer(name, src) {
  const dir = join(FIXTURE_DIR, name + "-" + Math.random().toString(36).slice(2, 8));
  mkdirSync(dir, { recursive: true });
  const inputPath = join(dir, name + ".scrml");
  writeFileSync(inputPath, src);
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [inputPath], outputDir: outDir, write: true, log: () => {} });
  function walk(d) {
    if (!existsSync(d)) return [];
    const out = [];
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
  let serverJs = "";
  for (const f of walk(outDir)) {
    if (f.endsWith(".server.js") && !f.includes("/_scrml/")) serverJs = readFileSync(f, "utf8");
  }
  const errors = (result.errors || []).filter(e => e.severity !== "warning" && e.code !== "E-PA-002");
  return { serverJs, errors };
}

const page = (body) => `<page auth="optional">
  <db src="./app.db" protect="password_hash" tables="users">
    \${
      import { verifyPassword, hashPassword } from 'scrml:auth'
      import { safeCall } from 'scrml:host'
${body}
      function noop() { return }
    }
    <form onsubmit=noop()><button type="submit">x</button></form>
  </>
</page>
`;

describe("Issue #26 — (a) verifyPassword predicate bypass closes", () => {
  test("bound const `const ok = verifyPassword(...)` is awaited (ok becomes a boolean, guard fires)", () => {
    const { serverJs, errors } = compileServer("a-bound", page(`
      function loginServer(emailArg, passwordArg) {
        const row = ?{\`SELECT id, password_hash FROM users WHERE email = \${emailArg}\`}.get()
        if (row is not) { return { error: "bad" } }
        const ok = verifyPassword(passwordArg, row.password_hash)
        if (!ok) { return { error: "bad" } }
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const ok = await verifyPassword\(/);
    // Belt: the callee never appears bare (unawaited) as a decl init.
    expect(serverJs).not.toMatch(/const ok = verifyPassword\(/);
  });

  test("inline predicate `if (!verifyPassword(...))` is awaited", () => {
    const { serverJs, errors } = compileServer("a-inline", page(`
      function loginServer(emailArg, passwordArg) {
        const row = ?{\`SELECT id, password_hash FROM users WHERE email = \${emailArg}\`}.get()
        if (!verifyPassword(passwordArg, row.password_hash)) { return { error: "bad" } }
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    // `!await verifyPassword(...)` === `!(await verifyPassword(...))` — the guard fires.
    expect(serverJs).toMatch(/if \(!await verifyPassword\(/);
  });
});

describe("Issue #26 — (b) hashPassword INSERT stores the digest, not a Promise", () => {
  test("bound const `const h = hashPassword(...)` is awaited", () => {
    const { serverJs, errors } = compileServer("b-bound", page(`
      function seedServer(emailArg, passwordArg) {
        const demoHash = hashPassword(passwordArg)
        ?{\`INSERT INTO users (email, password_hash) VALUES (\${emailArg}, \${demoHash})\`}.run()
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const demoHash = await hashPassword\(/);
  });

  test("hashPassword interpolated DIRECTLY into a `?{}` INSERT param is awaited", () => {
    const { serverJs, errors } = compileServer("b-inline", page(`
      function seedServer(emailArg, passwordArg) {
        ?{\`INSERT INTO users (email, password_hash) VALUES (\${emailArg}, \${hashPassword(passwordArg)})\`}.run()
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/\$\{await hashPassword\(passwordArg\)\}/);
  });
});

describe("Issue #26 — (c) NO over-await regression", () => {
  test("a SYNC stdlib call (`scrml:host` safeCall) is NOT awaited; plain exprs untouched", () => {
    const { serverJs, errors } = compileServer("c-sync", page(`
      function syncServer(emailArg) {
        const trimmed = safeCall(() => emailArg)
        const doubled = emailArg + emailArg
        ?{\`INSERT INTO users (email, password_hash) VALUES (\${trimmed}, \${doubled})\`}.run()
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/const trimmed = safeCall\(/);
    expect(serverJs).not.toMatch(/await safeCall\b/);
    // A plain arithmetic decl stays a plain decl (no spurious await).
    expect(serverJs).toMatch(/const doubled = emailArg \+ emailArg;/);
  });
});

describe("Issue #26 — (d) async stdlib call nested in an expression is awaited", () => {
  test("`String(verifyPassword(...))` awaits the inner async call", () => {
    const { serverJs, errors } = compileServer("d-nested", page(`
      function nestedServer(emailArg, passwordArg) {
        const wrapped = String(verifyPassword(passwordArg, emailArg))
        ?{\`INSERT INTO users (email, password_hash) VALUES (\${emailArg}, \${wrapped})\`}.run()
        return { ok: true }
      }`));
    expect(errors).toEqual([]);
    expect(serverJs).toMatch(/String\(await verifyPassword\(/);
  });
});

describe("Issue #26 — idempotency", () => {
  test("emitted server JS never contains `await await`", () => {
    const { serverJs } = compileServer("idem", page(`
      function loginServer(emailArg, passwordArg) {
        const row = ?{\`SELECT id, password_hash FROM users WHERE email = \${emailArg}\`}.get()
        const ok = verifyPassword(passwordArg, row.password_hash)
        if (!ok) { return { error: "bad" } }
        const h = hashPassword(passwordArg)
        ?{\`INSERT INTO users (email, password_hash) VALUES (\${emailArg}, \${h})\`}.run()
        return { ok: true }
      }`));
    expect(serverJs).not.toMatch(/\bawait\s+await\b/);
  });
});
