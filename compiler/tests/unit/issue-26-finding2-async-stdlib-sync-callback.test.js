/**
 * issue-26-finding2-async-stdlib-sync-callback.test.js — FAIL-CLOSED regression.
 *
 * Issue #26 Finding-2 (S239 adversarial review of the auth-bypass auto-await fix).
 * The #26 fix auto-awaits a Promise-returning stdlib call (`scrml:auth`
 * verifyPassword / hashPassword, crypto, redis, http …) in an AWAITABLE server-fn
 * position. But where `peerAwaitable === false` — an async stdlib call inside a
 * SYNC callback body (`.some`/`.find`/`.filter`/`.map` lambda), a nested lambda,
 * or a parameter default — `await` is illegal, so the #26 await branch was gated
 * OFF and the call emitted BARE with NO await AND NO diagnostic. A bare
 * `verifyPassword(...)` returns a truthy Promise, so
 * `hashes.some(h => verifyPassword(pw, h))` accepts EVERY password (an accept-all
 * auth bypass, shipped with zero errors).
 *
 * The peer-server-fn equivalent in the same position is a HARD ERROR
 * (E-SERVER-FN-IN-SYNC-CALLBACK). This fix mirrors that fail-closed path for
 * async-stdlib callees: a non-awaitable async-stdlib call now raises
 * `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` (§34) instead of leaking silently.
 *
 * Matrix:
 *   (a) FAIL-CLOSED — each sync-callback / param-default / block-body async-stdlib
 *       shape ERRORS with the new code.
 *   (c) NO OVER-FIRE — a SYNC stdlib call (safeCall / generatePassword) or a plain
 *       expression in a sync callback does NOT error; only an async stdlib call
 *       that cannot be awaited does.
 *   (b) NO REGRESSION — an async stdlib call in an AWAITABLE position still emits
 *       `await` (the #26 behavior; full coverage in issue-26-server-auto-await-stdlib).
 *
 * SPEC anchors: §34 E-ASYNC-STDLIB-IN-SYNC-CALLBACK, §13.1 stdlib carve-out,
 * §13.2.1 auto-await classifier.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/issue-26-finding2");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {} });

// Compile one .scrml file; return emitted SERVER JS + non-warning error codes.
// E-PA-002 (DB file missing) is a runtime-only precondition irrelevant to emit
// shape (the server bundle is still emitted), so it is filtered out.
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
  return { serverJs, codes: errors.map(e => e.code) };
}

const page = (body) => `<page auth="optional">
  <db src="./app.db" protect="password_hash" tables="users">
    \${
      import { verifyPassword, hashPassword, generatePassword } from 'scrml:auth'
      import { safeCall } from 'scrml:host'
${body}
      function noop() { return }
    }
    <form onsubmit=noop()><button type="submit">x</button></form>
  </>
</page>
`;

const CODE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";

describe("Finding-2 (a) FAIL-CLOSED — async stdlib in a sync callback ERRORS", () => {
  test(".some expr-body verifyPassword → E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const { codes } = compileServer("a-some", page(`
      function f(emailArg, pw) {
        const rows = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const any = rows.some(h => verifyPassword(pw, h.password_hash))
        if (!any) { return { error: "bad" } }
        return { ok: true }
      }`));
    expect(codes).toContain(CODE);
  });

  test(".find expr-body verifyPassword → error", () => {
    const { codes } = compileServer("a-find", page(`
      function f(emailArg, pw) {
        const rows = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const m = rows.find(h => verifyPassword(pw, h.password_hash))
        return { ok: m is not }
      }`));
    expect(codes).toContain(CODE);
  });

  test(".filter expr-body verifyPassword → error", () => {
    const { codes } = compileServer("a-filter", page(`
      function f(emailArg, pw) {
        const rows = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const good = rows.filter(h => verifyPassword(pw, h.password_hash))
        return { n: good }
      }`));
    expect(codes).toContain(CODE);
  });

  test(".map expr-body hashPassword → error", () => {
    const { codes } = compileServer("a-map", page(`
      function f(emailArg, pws) {
        const rows = ?{\`SELECT id FROM users WHERE email = \${emailArg}\`}.all()
        const hs = pws.map(p => hashPassword(p))
        return { hs }
      }`));
    expect(codes).toContain(CODE);
  });

  test("nested lambda — async stdlib in an INNER sync callback → error", () => {
    const { codes } = compileServer("a-nested", page(`
      function f(emailArg, pw) {
        const groups = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const any = groups.some(g => [g].some(h => verifyPassword(pw, h.password_hash)))
        return { ok: any }
      }`));
    expect(codes).toContain(CODE);
  });

  test("parameter default — async stdlib in a callback param default → error", () => {
    const { codes } = compileServer("a-paramdefault", page(`
      function f(emailArg, pw) {
        const rows = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const out = rows.map((h, ok = verifyPassword(pw, "x")) => ok)
        return { out }
      }`));
    expect(codes).toContain(CODE);
  });

  test("BLOCK-body callback (escape-hatch raw text) — async stdlib → error (not silent)", () => {
    const { codes } = compileServer("a-blockbody", page(`
      function f(emailArg, pw) {
        const rows = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.all()
        const any = rows.some(h => { return verifyPassword(pw, h.password_hash) })
        if (!any) { return { error: "bad" } }
        return { ok: true }
      }`));
    expect(codes).toContain(CODE);
  });
});

describe("Finding-2 (c) NO OVER-FIRE — sync stdlib / plain exprs in a sync callback do NOT error", () => {
  test(".map safeCall (SYNC stdlib) in a callback → no E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const { serverJs, codes } = compileServer("c-safecall", page(`
      function f(emailArg) {
        const rows = ?{\`SELECT email FROM users WHERE email = \${emailArg}\`}.all()
        const trimmed = rows.map(r => safeCall(() => r.email))
        return { trimmed }
      }`));
    expect(codes).not.toContain(CODE);
    // The sync call stays bare (no spurious await).
    expect(serverJs).toMatch(/rows\.map\(\(r\) => safeCall\(/);
    expect(serverJs).not.toMatch(/await safeCall\b/);
  });

  test(".some generatePassword (SYNC stdlib) in a callback → no error", () => {
    const { codes } = compileServer("c-genpw", page(`
      function f(emailArg) {
        const rows = ?{\`SELECT email FROM users WHERE email = \${emailArg}\`}.all()
        const any = rows.some(r => generatePassword(8, {}).length > 0)
        return { any }
      }`));
    expect(codes).not.toContain(CODE);
  });

  test(".map plain expression in a callback → no error", () => {
    const { codes } = compileServer("c-plain", page(`
      function f(emailArg) {
        const rows = ?{\`SELECT id FROM users WHERE email = \${emailArg}\`}.all()
        const ids = rows.map(r => r.id + 1)
        return { ids }
      }`));
    expect(codes).not.toContain(CODE);
  });
});

describe("Finding-2 (b) NO REGRESSION — async stdlib in an AWAITABLE position still awaits", () => {
  test("const predicate `const ok = verifyPassword(...)` emits `await`, no error", () => {
    const { serverJs, codes } = compileServer("b-await", page(`
      function f(emailArg, pw) {
        const row = ?{\`SELECT password_hash FROM users WHERE email = \${emailArg}\`}.get()
        const ok = verifyPassword(pw, row.password_hash)
        if (!ok) { return { error: "bad" } }
        return { ok: true }
      }`));
    expect(codes).not.toContain(CODE);
    expect(serverJs).toMatch(/const ok = await verifyPassword\(/);
  });
});
