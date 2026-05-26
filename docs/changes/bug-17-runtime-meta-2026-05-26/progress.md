# Bug 17 — E-META-001 runtime-meta scoping fix

## Phase-0 STOP gate disposition: PROCEED

[2026-05-26T00:00:00Z] Startup verification PASSED:
- pwd = /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-ac6ac78136357f89c
- git rev-parse --show-toplevel matches
- Tree clean at HEAD 874c8fbf
- bun install ran (204 packages)
- bun run pretest populated samples/compilation-tests/dist/ (13 test samples)

[2026-05-26T00:01:00Z] SPEC verifications:
- §22.5 line 14375: "Using `setInterval` / `setTimeout` directly inside a `^{}` body SHALL emit `E-META-001`" — confirmed
- §22.12 line 14687: "JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger `E-META-001`" — confirmed
- §22.11 catalog row: currently reads ONLY "Runtime `^{}` block used when `meta.runtime` is `false`" — drift confirmed (will broaden in this dispatch — disposition (I))

[2026-05-26T00:02:00Z] meta-checker.ts verifications:
- META_BUILTINS at line 127 — matches Step A's narrowed shape (24 strings: JS built-ins + reflect/emit/compiler; no bun/process/Bun/console)
- Early-return at line 1091 confirmed — `if (!isCompileTime) return;` THE GAP
- Active E-META-001 fire-sites: line 1233 (single-ident compile-time) + line 1278 (string-expr compile-time) + line 1622 (meta.runtime=false)
- checkMetaBlock at line 1079; called from line 1615 by runMetaChecker.findMetaBlocks

[2026-05-26T00:03:00Z] Reproducer verified empirically:
- Source: <program>${ ^{ const x = bun.eval("Date.now()") } }</>
- Result: 0 errors, 0 warnings — confirms Bug 17 (silent acceptance of JS-host global in runtime meta)

[2026-05-26T00:04:00Z] Corpus sweep — ZERO legitimate runtime-meta uses found:
- `grep -rn '\^{' --include='*.scrml' examples/ stdlib/ compiler/self-host/ | grep -E 'process|fetch|setInterval|setTimeout|\bBun\b|console'` → empty
- PA pre-dispatch finding holds; no migration backlog blocks this fix

[2026-05-26T00:05:00Z] Baseline test counts:
- meta-checker subset (3 files): 258 pass / 0 fail / 547 expect() calls
- Full suite (unit+integration+conformance): 14566 pass / 88 skip / 1 todo / 0 fail / 48604 expect() calls

## Approach chosen: A (new walker, unconditional pass)

Rationale: PA lean. Keeps compile-time path identical (zero-regression risk for S133 Step A semantics) + adds a parallel unconditional check that runs on EVERY ^{} body (both compile-time and runtime). Cleaner separation of concerns: compile-time runtime-var enforcement vs JS-host-global enforcement are categorically different invariants.

## §22.11 catalog row disposition: (I) — broaden in this dispatch

The row will enumerate the three conditions:
(1) Runtime variable referenced inside compile-time `^{}` meta context (§22.4)
(2) Runtime `^{}` block used when `meta.runtime` is `false` (§22.5)
(3) JS-host ambient global referenced inside any `^{}` body (compile-time OR runtime) per Approach C (§22.5 / §22.12)

## Implementation log

[2026-05-26T00:10:00Z] Step 1 — JS_HOST_FORBIDDEN insertion:
- Added a new exported `JS_HOST_FORBIDDEN = new Set<string>([...])` immediately after META_BUILTINS at meta-checker.ts:163.
- 9 members: bun, Bun, process, console, setInterval, setTimeout, clearInterval, clearTimeout, fetch.
- Self-contained; no behavior change yet.

[2026-05-26T00:11:00Z] Step 2 — new walker + invocation:
- Added exported `checkMetaBlockForJsHostGlobals(metaNode, filePath, errors)` at meta-checker.ts:1167. Mirrors `checkMetaBlock` structure (ExprNode-first + string fallback; bare-expr/let-decl/const-decl; recursive walk into body/children/consequent/alternate + nested ^{}).
- Honors metaLocals so user-declared shadowing (e.g. `const process = 42; process + 1`) does not fire.
- Diagnostic-message shape: per-identifier-class migration hint.
- Invoked from runMetaChecker at line ~1770, AFTER checkMetaBlock and BEFORE checkReflectCalls.

[2026-05-26T00:12:00Z] Reproducer re-verified post-fix (end-to-end via inputFiles API):
- Source: `p "test"\n^{\n  const x = bun.eval("Date.now()")\n}\n`
- Result: 1 error E-META-001 fired by MC stage. Message: "JS-host ambient global 'bun' is not available inside ^{} meta blocks. Per SPEC §22.12 (Approach C), only scrml-native and the enumerated meta primitive set (reflect / emit / emit.raw / meta.*) are in scope. Hint: this surface is not available inside ^{} bodies."

[2026-05-26T00:15:00Z] Step 3 — new test file:
- compiler/tests/unit/meta-checker-bug17.test.js — 33 tests / 65 expect() calls.
- 7 forbidden ids × 3 surfaces (unit + runMetaChecker + compileScrml end-to-end) = 21 RT tests.
- 2 bare-expr-form tests.
- 4 negative-control tests (META_BUILTINS / local let/const / local shadow of `process` / meta.* API).
- 5 diagnostic-message-shape tests.
- 1 canonical reproducer.

[2026-05-26T00:18:00Z] Step 4 — pre-existing test corpus migration:
- §24 in meta-checker.test.js: replaced `bun.eval(...)` initializer with `JSON.parse(...)` (JSON is still META_BUILTIN; compile-time-evaluable; preserves the "clean meta block" test intent).
- 32 console.log(...) sites in meta-integration.test.js + runtime-meta-integration.test.js migrated to meta.emit(...) — scrml-native canonical runtime side-effect surface per §22.5.1.

[2026-05-26T00:20:00Z] Step 5 — final verification:
- meta-checker subset (4 files now incl. bug17): 291 pass / 0 fail / 612 expect() calls
- compiler/tests/unit: 12213 pass / 40 skip / 0 fail
- compiler/tests/integration + conformance: 2386 pass / 48 skip / 1 todo / 0 fail
- Net delta: 14566 → 14599 pass (+33, matching the new bug17 test count)
- 0 regressions

[2026-05-26T00:22:00Z] Step 6 — SPEC §22.11 amendment (disposition I):
- Broadened E-META-001 catalog row to enumerate all three conditions:
  (1) compile-time runtime-variable — §22.4 / line 1233
  (2) runtime block when meta.runtime=false — §22.5 / line ~1622
  (3) JS-host ambient global (any ^{} body) — §22.5 line 14375 + §22.12 line 14687 / S134 new walker
- Closes the documentation drift latent since S114.

## Commits landed (in order)
- d8e20847 — WIP(bug17): start at WORKTREE_ROOT — Phase-0 PROCEED
- 255254fb — fix(s134): Bug 17 — E-META-001 extends to runtime ^{} blocks (Approach A)
- c0b6adb5 — docs(s134): SPEC §22.11 — broaden E-META-001 catalog row (Bug 17 disposition I)

## Files touched (worktree-absolute)
- compiler/src/meta-checker.ts — JS_HOST_FORBIDDEN + checkMetaBlockForJsHostGlobals + call site
- compiler/tests/unit/meta-checker-bug17.test.js — NEW
- compiler/tests/unit/meta-checker.test.js — §24 init swap
- compiler/tests/unit/meta-integration.test.js — console.log → meta.emit (13 sites)
- compiler/tests/unit/runtime-meta-integration.test.js — console.log → meta.emit (19 sites)
- compiler/SPEC.md — §22.11 E-META-001 row broadened
- docs/changes/bug-17-runtime-meta-2026-05-26/progress.md — this file

## Open follow-ups (NOT in scope; surfaced for PA)

1. **Self-host parity** — `stdlib/compiler/meta-checker.scrml` + `compiler/self-host/meta-checker.scrml` mirror files still encode the pre-Step-A META_BUILTINS string list (which already includes bun/process/Bun/console as DATA, not behavior). They do NOT yet have JS_HOST_FORBIDDEN or the new walker. Deferred post-v1.0 per pa.md. The mirror files' tests pass because they test scrml-source META_BUILTINS membership as data, not the runtime behavior.

2. **§22.7** — the `meta.runtime=false` case at meta-checker.ts:~1622 still reads "E-META-001: Runtime `^{}` block is not allowed when `meta.runtime` is `false`." That phrasing is the pre-S134 §22.11 row text. Consider broadening the diagnostic message to reference SPEC §22.5 / §22.11 condition (2) for clarity. NOT IN SCOPE — surfaced as a polish follow-up.

3. **Approach C trigger surveillance** — SPEC §22.12 line 14703 reads: "Trigger for revisiting Approach C: if a future general-developer sample surfaces a `^{}` body that genuinely needs JS-host expression evaluation AND no compiler-managed surface … closes it, revisit." The new walker now enforces this trigger at the diagnostic surface. If an adopter hits E-META-001 for a host-global they genuinely need, that's the §22.12 trigger event — PA should surveil for that signal in subsequent dispatches.

4. **Diagnostic-stream partition** — confirmed via grep: the new walker emits via `errors.push(new MetaError("E-META-001", ...))` matching the existing E-META-001 pattern. CLI stream-partition (S93 info-partition rule per feedback_diagnostic_stream_partition) puts E-* / Error severity into result.errors. Tests assert on result.errors directly via the `hasEMeta001For` helper.

## PATH-DISCIPLINE INCIDENT
None. All file edits applied via Python heredoc scripts on WORKTREE-absolute paths; verified via `git diff` after each. No leak detected.
