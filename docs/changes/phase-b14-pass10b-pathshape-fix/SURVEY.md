# SURVEY — B14 PASS 10.B path-shape mismatch fix

## The bug, confirmed

**Site (primary, dispatch scope):** `compiler/src/symbol-table.ts:4088`

```ts
const sourceMap = exportRegistry.get(binding.sourcePath);
```

- `binding.sourcePath` is the **literal** `imp.source` — set at registration in `registerImportBindings` (line 904: `const sourcePath = imp.source;`).
- For relative imports (`import { X } from './engines.scrml'`), the literal is the relative `./engines.scrml`.
- MOD's `exportRegistry` (built by `compiler/src/module-resolver.js:buildExportRegistry`, line 354–403) keys its outer Map by the file's `filePath` from the input `fileASTs`. In the production pipeline (`api.js`), this is the **absolute** path to each compiled file.
- Result: production runs always miss the lookup → silent skip at line 4089's `if (sourceMap) { ... }` → false-negative cross-file mount validation.

**Same bug pattern at `fireImportPinnedInvalid` (line 997)** — `exportRegistry.get(rec.sourcePath)` is the same shape, with an explicit comment ("unknown source (resolveModulePath mismatch); skip") at line 998 acknowledging it.

## Resolution helper

`resolveModulePath(source, importerPath)` (compiler/src/module-resolver.js:514) — takes a literal import source and the absolute path of the importing file, returns the absolute resolved path. Falls through to `source` as-is for non-relative/stdlib/vendor specifiers.

`filePath` is the absolute path of the file being SYM'd. It is available at:
- The call site of `walkValidateCrossFileEngineMounts` (line 6829–6831) — passed as 5th arg.
- The call site of `fireImportPinnedInvalid` (line 6735) — currently NOT passed.

## Symmetry check (PASS 10.A vs PASS 10.B)

PASS 10.A (`walkRegisterEngines`, line 3873) registers SAME-FILE engine cells. It does NOT consult `exportRegistry`. There is no path-shape concern at PASS 10.A; symmetry is moot.

The B4 `fireImportPinnedInvalid` function consults `exportRegistry` and has the IDENTICAL bug. Its current behavior is documented as "best-effort", but the lookup site IS the bug. Fixing it costs ~5 lines and makes the resolution path symmetric across all SYM consumers of `exportRegistry`.

## Choice: option (a) lookup-site fix

- (a) **Lookup-site fix** — apply the try-literal-then-absolute lookup at the call site, mirroring the C15 workaround pattern (which is already deployed in `compiler/src/codegen/emit-engine.ts:1098-1128`).
- (b) Registration-normalization — would change `binding.sourcePath` semantics across all consumers (B4, B14 PASS 10.B, downstream walkers, debug log lines, error messages that print the source path back to users). Several test files depend on the literal-source shape (`engine-binding-b14.test.js` lines 426, 446, 468, 488 set relative-keyed registries AND expect the binding to carry the literal source). Option (b) would break tests + change error message text. Heavier, riskier.

**Choosing (a).** It is the lighter touch, mirrors C15's already-validated pattern, keeps `binding.sourcePath` semantics stable for diagnostics and downstream consumers, and works with both relative-keyed (test harness) and absolute-keyed (production) registries.

## C15 workaround disposition

C15's `lookupSourceMap` (codegen/emit-engine.ts) is in a different module (codegen, not SYM) and serves a different purpose (collecting cross-file engine mount sites for marker emission). Even after this fix, C15's workaround independently protects the codegen path; SYM's fix doesn't make codegen's lookup more robust. The two fixes are parallel, not nested.

**Recommendation: retain C15's workaround.** It is in a different stage (codegen vs SYM), has no dependency on SYM having the same fix, and removing it would make codegen misbehave for any caller that bypasses MOD. A future cleanup could factor `lookupSourceMap` into a shared helper, but that is out of scope for this dispatch.

## Test plan

Add to `compiler/tests/unit/engine-binding-b14.test.js`:

1. Cross-file engine mount with **absolute-keyed** registry (matches production shape) — positive case the bug currently fails.
2. Same with deep-nested relative path `./subdir/engines.scrml` — exercises `resolveModulePath` join behavior.
3. Mount of non-engine import via absolute-keyed registry → still fires `E-ENGINE-MOUNT-NOT-ENGINE` (regression).
4. Mount of user-component via absolute-keyed registry → still suppressed (regression).
5. Test-harness path (no exportRegistry) → still skips silently (regression).

Forecast: +5 tests, all green; existing 6 PASS 10.B tests should remain green (relative-keyed registry path still wins on first lookup).
