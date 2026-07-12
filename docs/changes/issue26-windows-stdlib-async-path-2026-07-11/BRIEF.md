# FIX — Issue #26 P0 security: Windows path-separator breaks the async-stdlib auto-await → auth bypass

This is a P0 SECURITY bug (auth bypass) hit by a real adopter (Peter, Windows 11). The root cause is ALREADY diagnosed and empirically confirmed by the PA — your job is the fix + a Windows-simulating regression test, done thoroughly. Base = current main. Hold on your branch (do NOT merge to main).

## ROOT CAUSE (confirmed — do not re-derive, but confirm as you go)
The auto-await for Promise-returning stdlib fns (`verifyPassword`/`hashPassword`/JWT/crypto) is gated by `isStdlibFilePath(absPath)` in `compiler/src/module-resolver.js` (~line 782): a callee only counts as awaitable-stdlib if its resolved source path is under `<repo>/stdlib/`. That check:
```js
if (absPath === STDLIB_ROOT) return true;
const prefix = STDLIB_ROOT.endsWith("/") ? STDLIB_ROOT : STDLIB_ROOT + "/";   // hardcoded "/"
return absPath.startsWith(prefix);
```
`STDLIB_ROOT` (`resolve(...)`) and the resolved module path (`resolveModulePath` → `join(STDLIB_ROOT, name, "index.scrml")`) both use **native OS separators** — `\` on Windows. So on Windows: `absPath = C:\repo\stdlib\auth\index.scrml`, `prefix = C:\repo\stdlib/` → the `stdlib\` vs `stdlib/` mismatch fails `startsWith` → `isStdlibFilePath` returns **false** → the classifier (`isPromiseReturningStdlibFn` → `isStdlibAsyncCallee`, emit-expr.ts) returns false → `verifyPassword(...)` ships **un-awaited** → a Promise is truthy → wrong password accepted (**accept-all auth bypass**). PA demo (Linux): a native-`\` path → `false`; normalizing `\`→`/` → `true`. On POSIX everything is `/`, so it's invisible — which is why it only reproduces on Windows.

**Scope:** this affects EVERY server fn calling async stdlib on Windows (NOT just SQL-bearing — the reporter's "SQL-free awaits" was a retracted inference). It's pure path normalization, not codegen logic — which is why `304b00cc`'s tests went green on Linux while real auth broke on Windows.

## THE FIX
1. Make the stdlib carve-out **separator-agnostic**. Normalize path separators (`\`→`/`) on BOTH sides of the comparison in `isStdlibFilePath` (both `absPath` and `STDLIB_ROOT`/prefix) before `startsWith`. The codebase already uses `.replace(/\\/g, "/")` for this exact purpose (e.g. emit-server.ts:3908) — mirror that idiom.
2. **AUDIT the rest of the async-classifier path for the SAME hazard** — this is important, don't stop at one line:
   - `isPromiseReturningStdlibFn` (module-resolver.js): it does `exportRegistry.get(sourceModule)` — an EXACT path-string key match. Confirm the registry KEYS and the `sourceModule` (from `buildCalleeImportMap` → `resolveModulePath`) use consistent separators on Windows. If the registry is keyed with one form and looked up with another, that's a SECOND separator bug — fix it (normalize at the key boundary, or normalize `resolveModulePath`'s output).
   - Anywhere else in the classifier chain (`buildCalleeImportMap`, the emit-server.ts mirror at ~1916) that compares or keys on a resolved path.
   Prefer a SINGLE normalization point (e.g. normalize `resolveModulePath`'s returned path, or a small `normalizeSep` helper used at every path-comparison in this path) so the classifier is robust end-to-end, not patched at one gate.
3. Keep the fix scoped to the **async-classifier / stdlib-carve-out path**. Do NOT attempt a whole-compiler path-normalization sweep (that's a separate broader effort, issue #25 territory).

## REGRESSION TEST (the key deliverable — guards Windows without a Windows runner)
Add a unit test that feeds **Windows-style backslash paths** through the classifier and asserts correct resolution:
- `isStdlibFilePath` with a `\`-separator path under a `\`-separator STDLIB_ROOT → true.
- Ideally exercise the FULL chain: construct the classifier inputs (calleeMap + exportRegistry) with backslash-keyed paths (as Windows would produce) and assert `isStdlibAsyncCallee("verifyPassword", ctx)` / `isPromiseReturningStdlibFn` returns TRUE (→ await injected). This proves the auth-await fires on a simulated-Windows path.
- A companion assertion that on POSIX paths it still works (no regression).

## VERIFY (Linux — R26 empirical)
- Compile a server fn calling `verifyPassword`/an async stdlib fn on the normal (POSIX) path → still emits `await verifyPassword(...)` (no regression).
- Demonstrate (in the test) that the previously-failing backslash-path case now resolves true.
- Full gate: `bun test compiler/tests/{unit,integration,conformance} --bail` GREEN + `bun conformance/run.ts` (report count). NEVER `--no-verify`.

## CONSTRAINTS
- Files: `compiler/src/module-resolver.js` (primary) + a unit test; touch other classifier files ONLY if the audit finds a real second separator bug there, and if so keep it minimal. Do NOT touch S250's live navigate footprint (emit-expr.ts / emit-server.ts / runtime-template.js / emit-html.ts / SPEC §20) beyond READING — if the audit implicates emit-server.ts's mirror, STOP and report rather than editing it.
- Commit incrementally to your branch. Archive this brief to `docs/changes/issue26-windows-stdlib-async-path-2026-07-11/BRIEF.md`. HOLD on branch — do NOT merge to main.

## REPORT BACK
The exact normalization change(s) + where · the registry-keying audit result (was there a second separator bug?) · the regression test (what it asserts, how it simulates Windows) · Linux no-regression proof · gate + conformance count · branch name + tip SHA · whether the audit implicated any S250-owned file (and you stopped).
