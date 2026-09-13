# s414-loop-head-truncation — progress

## 2026-09-13T15:55:17Z — start
Worktree: /c/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-a6bfe61870b03ff5a
Base: origin/main 2f03b3c6 (clean, merge-base == origin/main)
bun install OK (puppeteer chrome download fails pre-existing; PUPPETEER_SKIP_DOWNLOAD=true clean)
Next: measure conformance baseline BEFORE change; reproduce the three defect cases.

## 2026-09-13 — repro + fix landed in ast-builder
- Conformance baseline MEASURED BEFORE any change: `bun test compiler/tests/conformance/`
  → **1608 pass / 30 skip / 0 fail, 1638 tests across 133 files**. The brief's "905/905"
  does not match anything this suite prints; reporting the measured figure.
- Reproduced all three defect cases on 2f03b3c6 exactly as briefed (silent exit-0 empty
  loop for `while`/`if`; E-CODEGEN-INVALID-LOGIC for the `&&` shape).
- Corpus population: **0 hits across 2,553 tracked `.scrml` files** — confirms the
  dispatcher. Control: the scanner HIT on 5 synthetic positives (`<`, `&&`, `is`, `??`,
  the `if` half) and no-hit on 10 negatives incl. the regex-body and double-parens forms.
- LOCUS HELD: `collectIfCondition()`'s `if (depth === 0 && parts.length > 0) break;`.
- Fix: `continuesConditionHead()` + a `recovering` flag; fires
  E-CONDITION-HEAD-UNPARENTHESIZED once, then keeps collecting to a depth-0 `{`/`;`/
  statement keyword. All three defect cases now emit a CORRECT loop; all 10 controls
  byte-identical to HEAD.
- ⚑ SURFACING NOTE (pre-existing, out of scope): a bare-`${…}` file with no `<program>`
  shell DROPS ast-builder logic-body errors from `result.errors` — the shipped
  E-FOR-UNPARENTHESIZED-HEAD behaves identically there. The diagnostic fires and
  partitions into `result.errors` under a `<program>` shell in every mode.
- Next: tests, then SPEC §34/§49/§50 + SPEC-INDEX regen.

## 2026-09-13 — tests + SPEC + full verification
- `compiler/tests/unit/loop-head-truncated-at-first-close-paren.test.js` — 23 tests, 23 pass.
  ⚑ BITE PROVEN: run against the pre-fix collector (working file swapped via a scratchpad
  copy — NO `git stash`), **8 fail / 15 pass** — every diagnostic and recovery case fails
  pre-fix, every control passes pre-fix. The code has a real producer.
- Diagnostic cases use the `<program>` shell (the shape in which ast-builder logic-body
  errors reach `result.errors`); recovery/artifact cases use the library harness.
- SPEC: §34 catalog row (styled on the E-FOR-UNPARENTHESIZED-HEAD row), §49.2.3 normative
  note, §50.2.3 corollary + cross-reference, `provenance:` marker at both sections.
- Regen gates: `regen-spec-index.ts --check` OK · `facts.ts --check` OK (FACTS.md
  regenerated: SPEC lines 37,947→37,970; compiler/src 253,027→253,113; test files
  1,450→1,451) · `s34-census.ts --check-new` PASS (1 new row, provenance resolves).
  `state.ts --write` touched only master-list.md's recent-sessions rollup with UNRELATED
  s413 drift — REVERTED to keep this change focused (ci.yml does not gate state.ts).

### Verification
- conformance: **1608 pass / 30 skip / 0 fail (1638 across 133 files)** — IDENTICAL before
  and after. (`docs/FACTS.md` "conformance cases | 905" is the CASE-DIRECTORY count and is
  also unchanged; it is not a test pass/fail figure.)
- unit: **18,583 pass / 17 skip / 1 fail (18,607 across 963 files)**. The 1 fail is the
  known Windows-local flake and is ROOT-CAUSED, not waved off: it is a DIFFERENT test on
  each run (`giti-035-sse-generator-seed-clobber` then `giti-016-match-identifier-contextual`),
  each failing at exactly ~5053 ms — bun's 5 s per-test timeout on an
  `execSync("node --check …")` subprocess under 963-file concurrency. Both pass in
  ISOLATION (12/12 and 24/24).
- corpus-compile-floor --check PASS (1 tracked baselined failure, pre-existing,
  E-ERROR-009/examples/09) · conflict-marker-gate PASS (8188 files) · snippet-gate
  110/110 · delta-lint PASS.
- types-gate --check cannot run on this Windows clone: it resolves
  `node_modules/.bin/tsc` with no extension and Windows ships `tsc.exe`/`tsc.bunx`.
  Pre-existing environment limitation; this change touches no `.ts` file, so the gate is
  unaffected by construction.
- ⚑ `E-DG-002` appears in `warnings` for the defect programs — it fires IDENTICALLY on the
  legal control (`while (n + 1 < 4)`), so it is incidental to the probe program shape, not
  introduced here. Measured, not assumed.

### Deferred
- The bare-`${…}` (no `<program>` shell) file shape drops ast-builder logic-body errors
  from `result.errors`. PRE-EXISTING and not this gap: the shipped
  E-FOR-UNPARENTHESIZED-HEAD is dropped there too (measured). Worth its own gap entry.
- master-list.md's `state.ts` recent-sessions rollup is stale by one s413 entry.
