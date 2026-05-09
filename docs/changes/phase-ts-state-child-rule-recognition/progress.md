# Progress — TS state-child `rule=` recognition (S75)

## Phase 0 — Survey (DONE — awaiting PA approval)

**Date:** 2026-05-09
**Worktree:** `agent-a19a090a55016837d`
**Branch:** `main` (worktree on direct-commit policy)
**Baseline:** 10702 / 69 / 1 / 3 (3 fails are pre-existing self-host parity)

### Steps completed

1. Startup verification: pwd / git rev-parse / git status / bun install /
   bun run pretest / bun run test — baseline confirmed.
2. Located `parseMachineRules` at `compiler/src/type-system.ts:2500-2716`.
   Read end-to-end. Confirmed it accepts arrow-rule grammar only.
3. Located `parseEngineStateChildren` at
   `compiler/src/engine-statechild-parser.ts:1017`. Read end-to-end.
   Confirmed it accepts the §51.0.B + §51.0.F modern state-child grammar.
4. Mapped buildMachineRegistry call sites — `parseMachineRules` is invoked from
   both projection (line 2095) and non-projection (line 2125) paths in
   `buildMachineRegistry`.
5. Mapped downstream `MachineType.rules` consumers:
   - `emit-machines.ts:emitTransitionTable` — emits transition lookup table
   - `emit-machines.ts:emitProjectionFunction` — derived-engine projection
   - `emit-reactive-wiring.ts:buildMachineBindingsMap` — binds
     transition-guards to assignments
   - `validateDerivedMachines` — derived exhaustiveness
   - All harmless when `rules` is empty (iteration over empty array).
6. Confirmed `engine-decl.legacyMachineKeyword` is the keyword discriminator
   (ast-builder.js:9015). Confirmed `<engine>` keyword is permitted over the
   LEGACY arrow body shape (existing samples). Body-shape dispatch is the
   correct boundary — keyword alone is insufficient.
7. Reproduced the bug via
   `docs/changes/phase-ts-state-child-rule-recognition/repro.test.ts` —
   modern `<engine for=Phase initial=.Idle>` with `<Idle rule=.Loading>` etc.
   fires `E-ENGINE-005: Machine 'phase' has no transition rules.`
   Legacy `<machine name=PhaseM for=Phase>` with `.Idle => .Loading` etc.
   compiles cleanly.
8. Surveyed why the bug never surfaced in tests:
   - Zero modern-form `<engine for=>` samples exist in `samples/`.
   - B15 unit tests (`engine-statechild-b15.test.js`) use `runUpToSYM` —
     they NEVER invoke runTS. End-to-end engine tests (`c12`, `c14`, `c15`)
     all use the legacy keyword/body form.
9. Drafted `SURVEY.md` with option matrix (A / B / C / D), recommendation
   (Option A — body-shape dispatch in `buildMachineRegistry`), and Phase 1
   implementation outline.

### Recommendation

**Option A — body-shape dispatch in buildMachineRegistry.** Smallest blast
radius, re-uses B15's existing `isLegacyArrowRulesBody` helper, preserves
`MachineType` shape for downstream codegen, fully aligned with §51.0 vs §51.3
normative split.

### Estimated revised scope

**~1-1.5h for Phase 1+** (below S74 hand-off estimate of 3-5h). Depth-of-survey
discount: B15 already does the modern-form parsing work; we just need to wire
one dispatch in TS-stage `buildMachineRegistry`.

### STOP — awaiting PA approval

Per dispatch instructions: STOP after Phase 0, surface for PA approval before
Phase 1.

## Phase 1+ — Implementation (DONE — S75)

**Date:** 2026-05-09
**Worktree:** `agent-a84e0eb6450096a61`
**Branch:** rebased onto `main @ 97b0355` (post-A6-3 SHIP commit)
**Baseline (post-rebase):** 10725 / 69 / 1 / 3

### Decision deltas vs. SURVEY

The SURVEY recommended `isLegacyArrowRulesBody(rulesRaw) === false` as the
modern-body discriminator. **That heuristic is too permissive on its own**:
`isLegacyArrowRulesBody` returns false for an empty body and for a
comment-only body, but existing tests
(`compiler/tests/unit/machine-declarations.test.js:332-360`) require those
cases to STILL fire E-ENGINE-005 for the legacy `<machine>` form. Implementation
therefore uses the precise positive condition `hasStateChildOpener` (inline
regex `/<\s*[A-Z]/.test(rulesRaw)`) — the same primitive `isLegacyArrowRulesBody`
checks, applied as the modern discriminator rather than the legacy
discriminator. Empty/comment-only bodies fall through to the legacy path,
preserving E-ENGINE-005.

### Steps completed

1. Rebased agent branch onto `main @ 97b0355` so the Phase 0 SURVEY +
   sibling fixes (a6-2, a6-3, b14-pass10b) were available locally.
2. Re-baselined: 10725 / 69 / 1 / 3.
3. Read `compiler/src/type-system.ts:2012-2148` (`buildMachineRegistry`) and
   confirmed both call sites — projection (line 2095) and non-projection
   (line 2125).
4. Read `compiler/src/engine-statechild-parser.ts:88` (`isLegacyArrowRulesBody`).
   Discovered the helper alone wouldn't preserve E-ENGINE-005 for empty legacy
   bodies (see "Decision deltas" above).
5. Implemented body-shape dispatch in `buildMachineRegistry`:
   - Added `const hasStateChildOpener = /<\s*[A-Z]/.test(rulesRaw);` before
     each `parseMachineRules` call.
   - **Non-projection path:** when `hasStateChildOpener` is true, register a
     `MachineType` entry with `rules: []` and SKIP `parseMachineRules`.
   - **Projection (derived) path:** mirrored — when `hasStateChildOpener` is
     true, register a derived `MachineType` entry with `rules: []` and skip
     `parseMachineRules`. Modern derived engines surface diagnostics through
     B15 + B16, not through `parseMachineRules`.
6. Compiled the Phase 0 repro harness — modern `<engine>` now produces zero
   errors; legacy `<machine>` still parses correctly.
7. Authored two sample fixtures under
   `samples/compilation-tests/`:
   - `engine-modern-001-basic.scrml` — minimal three-variant modern engine
     (positive case) — compiles with no errors.
   - `engine-modern-002-effects.scrml` — modern engine with `<onTransition>`
     hooks (B17 family) — compiles with no errors (only W-DEAD-FUNCTION
     warnings; RI doesn't yet track function references from
     `<onTransition>` bodies, a pre-existing limitation).
8. Authored unit tests at
   `compiler/tests/unit/engine-modern-form-rules.test.js` covering:
   - End-to-end modern form: basic single-target, multi-target,
     with-`<onTransition>` (3 tests).
   - Regression-guards: legacy `<machine>` arrow-form still parses;
     `<engine>` keyword over legacy body still parses (2 tests).
   - Unit-level `buildMachineRegistry`: modern body produces empty-rules
     entry without E-ENGINE-005; empty legacy body fires E-ENGINE-005;
     comment-only legacy body fires E-ENGINE-005; arrow rules still parse
     (4 tests).
9. Full test run: **10736 / 69 / 1 / 3** — same 3 pre-existing self-host
   parity fails. **+11 tests** (9 new tests in the new file + 2 from
   expr-parity walker discovering the new sample files).

### Files touched

```
compiler/src/type-system.ts                                   (+38 / -1)
compiler/tests/unit/engine-modern-form-rules.test.js          (+218 / 0, NEW)
samples/compilation-tests/engine-modern-001-basic.scrml       (+34 / 0,  NEW)
samples/compilation-tests/engine-modern-002-effects.scrml     (+39 / 0,  NEW)
docs/changes/phase-ts-state-child-rule-recognition/progress.md (this file, updated)
```

### Test delta

Pre-fix baseline (post-rebase): **10725 / 69 / 1 / 3**
Post-fix:                       **10736 / 69 / 1 / 3**
Delta:                          **+11 pass / 0 regressions / 0 new fails**

### Spec amendments

**None.** §51.0 is authoritative for the modern engine form; §51.3 / §51.9
for the legacy arrow form. The fix aligns code with the existing spec —
no spec drift.

### Deferred (orthogonal follow-ups)

1. **Cosmetic empty `__scrml_transitions_<Name> = {}` emission for modern
   engines** (PA OQ #4 already deferred per dispatch). Modern engines have
   their own `__scrml_engine_<Name>_transitions` table emitted by C12; the
   legacy `__scrml_transitions_<Name>` table is dead code for modern
   engines. Tree-shake-friendly + harmless. Guard at
   `emit-reactive-wiring.ts:310-323` would skip emission when the
   `MachineType.rules` is empty; orthogonal cleanup.
2. **`validateDerivedMachines` may fire false-positive E-ENGINE-018 if a
   user authors a modern derived engine.** The function iterates
   `machine.rules` (now empty for modern derived); every source variant
   appears "missing." Today no tests OR samples cover modern derived
   engines, so no actual regression. When modern derived engines gain
   coverage (likely B16 follow-up), guard `validateDerivedMachines` to
   skip machines whose rules are empty AND whose engineMeta.stateChildren
   is non-empty.
3. **C15 §C15.11–§C15.14 skipped tests** at
   `compiler/tests/unit/c15-cross-file-engine-mount.test.js:740-1000`
   were waiting on this fix (gap #1) AND b14-pass10b (gap #2). Gap #2
   landed in commit `4ec1b3d`; gap #1 landed in this dispatch. The
   skipped tests CAN now be unskipped; out of scope for this dispatch
   per HARDLY-EVER (don't widen). Surface as a follow-up dispatch.
4. **Inline `${@var = X}` event-handler attributes route through plain
   `_scrml_reactive_set` for modern engines** instead of
   `_scrml_engine_direct_set` (the C13 hook). This is pre-existing
   behavior in `rewriteBlockBody` (`emit-control-flow.ts:940`) — that
   function is invoked WITHOUT engineBindings from `emit-event-wiring.ts`.
   Out of scope for this dispatch (transition-validation parity for inline
   handlers is a separate concern, not the rule= recognition bug).

### Sample inventory

```
samples/compilation-tests/engine-modern-001-basic.scrml    (NEW — basic modern form)
samples/compilation-tests/engine-modern-002-effects.scrml  (NEW — modern form + onTransition hooks)
```

### Commit policy

Per S67 worktree-as-scratch + master-only-push retired S72: PA reviews diff
in main, pulls files via `git checkout <agent-branch> -- <files>`, PA-commits
on main directly. No agent-side commit beyond the local working tree.
