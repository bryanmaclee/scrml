/**
 * meta-realm-bound-s458.test.js — compile-time `^{}` evaluation is time-bounded.
 *
 * change-id: s458-meta-allow-list-land. The S457 realm runs a compile-time body as a
 * STRICT-mode function inside a `node:vm` context. Bun's engine (JavaScriptCore)
 * implements proper tail calls in strict mode, so `const f = () => f(); f()` — which on
 * the pre-S457 evaluator overflowed the stack in ~5 ms and reported E-META-EVAL-001 —
 * became an endless loop: the compiler hung (measured: killed at 20 s, no output). Any
 * non-terminating body (`while (true) {}`) hung the compiler on both sides. The body now
 * runs inside `vm.runInContext` with a timeout; exceeding it is E-META-EVAL-001.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { runInMetaRealm, META_EVAL_TIME_LIMIT_MS } from "../../src/meta-eval.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-realm-bound-s458");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

const wrap = (body) => `(function (emit, reflect) {\n"use strict";\n${body}\n})`;

describe("S458 — the compile-time realm is time-bounded", () => {
  test("the default limit is a named, finite constant", () => {
    expect(Number.isFinite(META_EVAL_TIME_LIMIT_MS)).toBe(true);
    expect(META_EVAL_TIME_LIMIT_MS).toBeGreaterThan(0);
  });

  test("a strict-mode tail-recursive arrow (an endless loop under proper tail calls) stops at the limit", () => {
    const t = Date.now();
    const r = runInMetaRealm(wrap(`const f = () => f();\nf();\nemit("<p>x</p>");`), new Map(), 300);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("did not finish within 300 ms");
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("an endless loop stops at the limit", () => {
    const r = runInMetaRealm(wrap(`for (const x of [1]) { while (true) {} }`), new Map(), 300);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("did not finish within 300 ms");
  });

  test("non-tail recursion still reports the stack overflow", () => {
    const r = runInMetaRealm(wrap(`function f() { return f() + 1; }\nf();`), new Map(), 2000);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Maximum call stack size exceeded");
  });

  test("a terminating body is unaffected and the realm's global is left clean", () => {
    const r = runInMetaRealm(wrap(`for (const x of [1, 2]) { emit("<p>" + x + "</p>"); }`), new Map(), 2000);
    expect(r).toEqual({ ok: true, emitted: [{ code: "<p>1</p>", raw: false }, { code: "<p>2</p>", raw: false }] });
  });

  test("end to end: the tail-recursive body is E-META-EVAL-001, not a hung compile", () => {
    const filePath = resolve(join(FIXTURE_DIR, "tail.scrml"));
    writeFileSync(filePath, `^{\n  const f = () => f()\n  f()\n  emit("<p>x</p>")\n}\n`);
    const t = Date.now();
    const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
    const codes = (result.errors ?? []).map((e) => e.code);
    expect(codes).toContain("E-META-EVAL-001");
    expect(Date.now() - t).toBeLessThan(META_EVAL_TIME_LIMIT_MS + 15000);
  }, 60000);
});
