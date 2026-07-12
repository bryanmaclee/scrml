/**
 * issue-26-windows-stdlib-async-path.test.js — P0 auth-bypass regression
 * (Windows path-separator variant).
 *
 * Issue #26 (Peter, Windows 11): the server-fn auto-await classifier gates
 * every awaitable stdlib callee behind `isStdlibFilePath(absPath)` — a callee
 * is awaitable-stdlib only if its resolved source path is under `<repo>/stdlib/`.
 * That gate built its prefix with a HARDCODED `/`:
 *
 *     const prefix = STDLIB_ROOT.endsWith("/") ? STDLIB_ROOT : STDLIB_ROOT + "/";
 *     return absPath.startsWith(prefix);
 *
 * `STDLIB_ROOT` (`resolve(...)`) and the resolved module path
 * (`resolveModulePath` → `join(STDLIB_ROOT, name, "index.scrml")`) both use
 * NATIVE OS separators — `\` on Windows. So on Windows:
 *
 *     absPath = C:\repo\stdlib\auth\index.scrml
 *     prefix  = C:\repo\stdlib/                     (hardcoded "/")
 *     absPath.startsWith(prefix) === false          (stdlib\ vs stdlib/)
 *
 * → `isStdlibFilePath` returns FALSE → `isPromiseReturningStdlibFn` /
 * `isStdlibAsyncCallee` classify `verifyPassword`/`hashPassword`/JWT as SYNC →
 * the compiler ships the `Promise`-returning call UN-AWAITED → a truthy Promise
 * accepts EVERY password (accept-all auth bypass). Invisible on POSIX (all `/`),
 * only reproduced on Windows — which is why `304b00cc`'s tests went green on
 * Linux while real auth broke on Windows.
 *
 * The fix normalizes BOTH operands (`\` → `/`) before the `startsWith`/equality
 * comparison, making the carve-out separator-agnostic.
 *
 * THIS TEST simulates Windows WITHOUT a Windows runner: it renders a real
 * under-STDLIB_ROOT path into all-backslash form (exactly what `path.join`
 * emits on Windows) and drives it through the classifier chain, asserting the
 * auth-await fires. On POSIX the same paths (forward-slash) must still resolve
 * true — no regression.
 *
 * SPEC anchors: §13.1 stdlib carve-out, §13.2.1 auto-await classifier.
 */

import { describe, test, expect } from "bun:test";
import {
  isStdlibFilePath,
  isPromiseReturningStdlibFn,
  resolveModulePath,
} from "../../src/module-resolver.js";
import { isStdlibAsyncCallee } from "../../src/codegen/emit-expr.ts";

// The REAL absolute path of `scrml:auth`'s module under this repo's STDLIB_ROOT,
// in native (POSIX, forward-slash) form. Deriving it from `resolveModulePath`
// (rather than hardcoding) keeps the test root-relocatable and exercises the
// exact string the compiler feeds the classifier at runtime.
const POSIX_AUTH = resolveModulePath("scrml:auth", "/any/importer.scrml");

// Simulate the Windows rendering: `path.resolve`/`path.join` emit `\` on
// Windows, so STDLIB_ROOT and every resolved module path would be all-backslash.
const WIN_AUTH = POSIX_AUTH.replace(/\//g, "\\");

// A NON-stdlib path (user source) in both forms — the carve-out must EXCLUDE
// these regardless of separator, so a user `async function` cannot leak into
// the auto-await classifier.
const POSIX_USER = "/home/dev/project/src/app.scrml";
const WIN_USER = "C:\\Users\\peter\\project\\src\\app.scrml";

// Build a MOD-style exportRegistry keyed by an absolute stdlib path, declaring
// `verifyPassword` as an async function export (kind:"function" + isAsync:true).
function registryFor(key) {
  const names = new Map();
  names.set("verifyPassword", {
    kind: "function",
    category: "function",
    isComponent: false,
    isAsync: true,
  });
  const reg = new Map();
  reg.set(key, names);
  return reg;
}

describe("Issue #26 (Windows) — isStdlibFilePath carve-out is separator-agnostic", () => {
  test("POSIX forward-slash stdlib path resolves under STDLIB_ROOT (baseline)", () => {
    expect(isStdlibFilePath(POSIX_AUTH)).toBe(true);
  });

  test("Windows backslash stdlib path resolves under STDLIB_ROOT (THE FIX)", () => {
    // Pre-fix: `\repo\stdlib\auth\index.scrml`.startsWith(`/repo/stdlib/`)
    // === false → auth-await never injected → accept-all bypass.
    expect(isStdlibFilePath(WIN_AUTH)).toBe(true);
  });

  test("a NON-stdlib user path is EXCLUDED in both separator forms (no carve-out leak)", () => {
    expect(isStdlibFilePath(POSIX_USER)).toBe(false);
    expect(isStdlibFilePath(WIN_USER)).toBe(false);
  });
});

describe("Issue #26 (Windows) — isPromiseReturningStdlibFn resolves the async export", () => {
  test("POSIX: forward-slash key + forward-slash sourceModule → true (baseline)", () => {
    expect(
      isPromiseReturningStdlibFn("verifyPassword", POSIX_AUTH, registryFor(POSIX_AUTH)),
    ).toBe(true);
  });

  test("Windows: backslash-keyed registry + backslash sourceModule → true (THE FIX)", () => {
    // Both the registry KEY and the lookup `sourceModule` are what
    // `resolveModulePath` produces on Windows (all-backslash), so the exact-match
    // `.get()` succeeds — the only failing gate was `isStdlibFilePath`.
    expect(
      isPromiseReturningStdlibFn("verifyPassword", WIN_AUTH, registryFor(WIN_AUTH)),
    ).toBe(true);
  });

  test("a sync (no isAsync) stdlib export is NOT classified async (no over-await)", () => {
    const names = new Map();
    names.set("safeCall", { kind: "function", category: "function", isComponent: false });
    const reg = new Map([[WIN_AUTH, names]]);
    expect(isPromiseReturningStdlibFn("safeCall", WIN_AUTH, reg)).toBe(false);
  });
});

describe("Issue #26 (Windows) — full classifier chain (isStdlibAsyncCallee) injects await", () => {
  // ctx.asyncCalleeMap maps a bare callee name → its resolved source module
  // (what buildCalleeImportMap produces via resolveModulePath). On Windows both
  // the map value and the registry key are all-backslash.
  test("Windows backslash calleeMap + registry → verifyPassword classifies async (await injected)", () => {
    const ctx = {
      asyncCalleeMap: new Map([["verifyPassword", WIN_AUTH]]),
      asyncExportRegistry: registryFor(WIN_AUTH),
    };
    expect(isStdlibAsyncCallee("verifyPassword", ctx)).toBe(true);
  });

  test("POSIX forward-slash calleeMap + registry → still async (no regression)", () => {
    const ctx = {
      asyncCalleeMap: new Map([["verifyPassword", POSIX_AUTH]]),
      asyncExportRegistry: registryFor(POSIX_AUTH),
    };
    expect(isStdlibAsyncCallee("verifyPassword", ctx)).toBe(true);
  });

  test("a user-source (non-stdlib) callee is NOT classified async even with isAsync (carve-out holds)", () => {
    const userNames = new Map();
    userNames.set("verifyPassword", {
      kind: "function", category: "function", isComponent: false, isAsync: true,
    });
    const ctx = {
      asyncCalleeMap: new Map([["verifyPassword", WIN_USER]]),
      asyncExportRegistry: new Map([[WIN_USER, userNames]]),
    };
    expect(isStdlibAsyncCallee("verifyPassword", ctx)).toBe(false);
  });
});
