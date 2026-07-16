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
 * The fix makes the carve-out comparison separator-agnostic. Per the cross-OS
 * path-model deep-dive (`windows-path-model-canonicalization-2026-07-14.md`,
 * §"stdlib carve-out separator normalization"), the normalizer is separator-
 * AWARE: it folds `\`→`/` ONLY when `\` is the host separator (`path.sep`), so a
 * POSIX file literally named `stdlib\evil.scrml` does NOT falsely enter the
 * carve-out (the widening `normalizeSep` allowed). That ruling has a consequence
 * for THIS test's method:
 *
 *   The synthetic `WIN_AUTH` (a real stdlib path with `/`→`\`) is a genuine
 *   Windows path ONLY on a Windows host. On POSIX it is — correctly, under the
 *   sep-aware contract — a forward-slash path that happens to contain literal
 *   backslashes, i.e. NOT a stdlib path. So the "backslash resolves true"
 *   assertions are meaningful ONLY when `sep === "\\"`. They now run FOR REAL on
 *   the `windows-latest` CI job (added precisely to catch this `\`-vs-`/` class —
 *   the Windows runner the original "WITHOUT a Windows runner" note predates) and
 *   are SKIPPED on the Linux gate. The POSIX baselines + the both-forms exclusion
 *   assertions still guard the Linux gate against a carve-out regression.
 *
 * SPEC anchors: §13.1 stdlib carve-out, §13.2.1 auto-await classifier.
 */

import { describe, test, expect } from "bun:test";
import { sep } from "node:path";
import {
  isStdlibFilePath,
  isPromiseReturningStdlibFn,
  resolveModulePath,
} from "../../src/module-resolver.js";
import { isStdlibAsyncCallee } from "../../src/codegen/emit-expr.ts";

// Under the sep-aware carve-out (deep-dive ruling), a backslash-rendered stdlib
// path is a genuine Windows path only when `\` is the host separator. Gate the
// Windows-synthesis assertions to a real Windows host; they run on windows-latest.
const ON_WINDOWS = sep === "\\";

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

  test.skipIf(!ON_WINDOWS)("Windows backslash stdlib path resolves under STDLIB_ROOT (THE FIX)", () => {
    // Pre-fix: `\repo\stdlib\auth\index.scrml`.startsWith(`/repo/stdlib/`)
    // === false → auth-await never injected → accept-all bypass. Runs on
    // windows-latest (sep-aware: a backslash path is only a Windows path there).
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

  test.skipIf(!ON_WINDOWS)("Windows: backslash-keyed registry + backslash sourceModule → true (THE FIX)", () => {
    // Both the registry KEY and the lookup `sourceModule` are what
    // `resolveModulePath` produces on Windows (all-backslash), so the exact-match
    // `.get()` succeeds — the only failing gate was `isStdlibFilePath`. Windows-only
    // under the sep-aware carve-out; runs on windows-latest.
    expect(
      isPromiseReturningStdlibFn("verifyPassword", WIN_AUTH, registryFor(WIN_AUTH)),
    ).toBe(true);
  });

  test("a sync (no isAsync) stdlib export is NOT classified async (no over-await)", () => {
    // Uses POSIX_AUTH so the carve-out ACCEPTS the path on both OSes and the
    // assertion actually exercises the `isAsync`-absent gate (with WIN_AUTH the
    // sep-aware carve-out would reject it on POSIX and pass vacuously).
    const names = new Map();
    names.set("safeCall", { kind: "function", category: "function", isComponent: false });
    const reg = new Map([[POSIX_AUTH, names]]);
    expect(isPromiseReturningStdlibFn("safeCall", POSIX_AUTH, reg)).toBe(false);
  });
});

describe("Issue #26 (Windows) — full classifier chain (isStdlibAsyncCallee) injects await", () => {
  // ctx.asyncCalleeMap maps a bare callee name → its resolved source module
  // (what buildCalleeImportMap produces via resolveModulePath). On Windows both
  // the map value and the registry key are all-backslash.
  test.skipIf(!ON_WINDOWS)("Windows backslash calleeMap + registry → verifyPassword classifies async (await injected)", () => {
    // Windows-only under the sep-aware carve-out; runs on windows-latest.
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
