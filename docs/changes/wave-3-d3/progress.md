# Wave 3 D3b — Phase B Benchmarks Refresh (re-dispatch after D3a crash)

## Progress log (append-only)

### 2026-05-12 — Startup verification

- WORKTREE_ROOT = `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a36d2768c222b7254`
- HEAD = `7a00b1b` (S86 wrap; v0.3 Wave 2 + Approach A spec anchor)
- `bun install` → 117 packages installed
- `bun run pretest` → compilation samples populated OK
- git status clean
- Maps consulted: primary, build (load-bearing finding TBD)

### 2026-05-12 — D3a forensics

- D3a worktree HEAD = `23e6265` (S85 close); D3a's progress log + diff confirms:
  - D3a got as far as refactoring `bench-scrml.js` to indirect-eval `(0, eval)(combinedScript)` but never verified.
  - D3a overwrote runtime-results.json with EMPTY scrml results.
  - D3a did re-install comparator deps (React 19.2.4 / Svelte 5.55.1 / Vue 3.5.32) in todomvc-{react,svelte,vue}/ subdirs.
- Read crash diagnosis at `docs/changes/wave-3-d3/D3a-CRASH-DIAGNOSIS.md`.
- Plan: try indirect-eval (Option A) first since D3a's mechanical refactor looks correct; verify against actual benchmark run BEFORE touching runtime-results.json.

### Next steps
1. Apply indirect-eval refactor to `bench-scrml.js`.
2. Build TodoMVC scrml dist.
3. Run `bench-scrml.js` standalone — verify scrml results emerge.
4. If green: regenerate full runtime-results.json via `runtime-benchmark.js`.
5. Update RESULTS.md Version History.
6. Numbers-honesty audit on README.md line 429.

### 2026-05-12 — Eval-pattern fix verification

- Applied indirect-eval refactor to `benchmarks/bench-scrml.js` (commit `138fbd3`).
- Wrote a diagnostic (`benchmarks/_diag-eval.js`, removed before final commit) that loaded `scrml-runtime.js` via `(0, eval)` and probed `globalThis` for each runtime function. Result: ALL 12 expected runtime functions land on globalThis as expected:
  - `_scrml_reactive_get`, `_scrml_reactive_set`, `_scrml_reactive_subscribe`
  - `_scrml_lift`, `_scrml_reconcile_list`, `_scrml_deep_reactive`
  - `_scrml_effect`, `_scrml_effect_static`, `_scrml_deep_set`
  - `_scrml_register_cleanup`, `_scrml_structural_eq`, `_scrml_default_set`
- This confirms `function`-declarations inside an indirect-eval'd script DO hoist to globalThis, which is the property the harness needs. `let`/`const` declarations like `_scrml_state` stay in script-global scope but remain reachable to the client.js portion eval'd in the same call.

### 2026-05-12 — Compiler-bug workaround for TodoMVC fixture

- First scrml benchmark attempt CRASHED inside the eval'd code with `TypeError: Array.prototype.filter callback must be a function` at `_scrml_activeCount_25 (...)`.
- Investigated: source has `function activeCount() { return @todos.filter(function(t) { return !t.completed }).length }` — correct shape — but compiled output emitted `.filter().length` (callback stripped).
- Diagnosis: a compiler bug in the `.filter(cb).<member>` codegen path drops the inner callback. The bug is part of the 4 latent compiler-bug families surfaced by D2 — out-of-scope per dispatch.
- Mechanical workaround: rewrote source as two-statement form (`let actives = @todos.filter(...); return actives.length`). Compiled output now preserves the callback. Committed as `149c979`.
- Surfaced for follow-up: separate dispatch to fix the `.filter(cb).<member>` codegen path; once landed, this fixture patch can be reverted.

### 2026-05-12 — Full benchmark run + data + RESULTS.md update

- Re-installed comparator deps in benchmarks/todomvc-{react,svelte,vue}/ (worktrees don't inherit node_modules).
- Ran `bun run benchmarks/runtime-benchmark.js` — all 4 frameworks completed cleanly.
- Regenerated `benchmarks/runtime-results.json` against HEAD `149c979` (commit `b511f68`).
- Updated `benchmarks/RESULTS.md`:
  - happy-dom table refreshed with v0.2.6+ HEAD numbers (commit `a3eee02`).
  - 2026-04-05 happy-dom row preserved as "Historical" for trend tracking.
  - 2026-04-13 Chrome row preserved as-is (rerun pending — separate dispatch).
  - Version History entry added.
- Top-line happy-dom outcome: scrml beats React in 9/11, Svelte in 6/11, Vue in 5/11. Significant scrml regression vs 2026-04-05 happy-dom baseline (partial-update ratio: 28.7x → 9.2x faster than React). Likely v0.2.4 → v0.2.6 codegen surface growth.

### 2026-05-12 — README.md numbers-honesty audit

- README.md line 429: `scrml wins 6 of 10 benchmarks. Partial update is 8x faster than React; swap-rows is 13x faster.`
- These ratios are sourced from the 2026-04-13 Chrome row in RESULTS.md (partial-update 0.4/3.3 = 8.25x; swap-rows 1.3/17.0 = 13.08x). That row is PRESERVED unchanged in my RESULTS.md update. README still matches its source — no number-reconciliation update needed.
- README already carries a "Stale (measured 2026-04-13; not yet re-measured against v0.2.0)" callout (lines 391-404). Staleness disclosure is in place; no further README change made.
- Per dispatch's "do not propose new marketing language" rule: did NOT update the warning callout to reference my happy-dom refresh; that's framing-not-numbers and best left to Bryan.
- No other benchmark-number references in README require reconciliation (line 157 + 508 are SQL-batching, not affected by the eval-pattern fix).
- scrml.dev landing page: lives in a separate repo (`scrml-dev`), out-of-scope per dispatch.

### 2026-05-12 — Final state

- 5 commits on branch `worktree-agent-a36d2768c222b7254`:
  - `851ba8e` wip: startup + plan
  - `138fbd3` fix(bench): indirect-eval bench-scrml.js
  - `149c979` fix(bench-fixture): TodoMVC dodge for .filter(cb).length bug
  - `b511f68` data(bench): regen runtime-results.json
  - `a3eee02` docs(bench): RESULTS.md refresh + version history
- (this progress.md update will be a 6th commit.)
- Tests at start + end: 10851 pass / 85 skip / 1 todo / 0 fail / 534 files (pre-commit hook re-ran clean at each commit). None of the changes touched compiler/runtime test paths.
- The original worktree dir at `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a36d2768c222b7254/` was concurrently removed during dispatch (likely another agent's cleanup pass). Branch tip preserved through the disappearance; I recreated the same path via `git worktree add` to land this final progress.md commit.

### Surfaced findings (for PA / follow-up dispatches)

1. **Compiler bug: `.filter(cb).<member>` strips the inner callback.** TodoMVC family from D2's 4 latent compiler-bug list. Repro: `function f() { return arr.filter(function(t){ return t.x }).length }`. Workaround applied in benchmarks/todomvc/app.scrml; should be reverted once compiler fix lands.
2. **scrml runtime regression in happy-dom vs 2026-04-05.** partial-update ratio vs React dropped 28.7x → 9.2x; swap-rows held at ~9x. Possibly Wave 2 / Approach A codegen overhead. Worth a separate perf investigation.
3. **Chrome benchmark row stale.** 2026-04-13 Chrome data is now v0.2.4-era; v0.2.6+ Chrome rerun is a separate dispatch. RESULTS.md preserves the Chrome row with a note.
4. **scrml.dev landing page audit:** lives in a separate repo (per dispatch — confirmed). Out-of-scope.

Maps consulted: `primary.map.md` (Task-Shape Routing), `build.map.md`. **Load-bearing finding:** Maps confirmed the project's Bun + happy-dom benchmark posture but were not surgical for the eval-pattern fix (that was found via direct source-read + diagnostic-probe). Maps treated as starting hypothesis as instructed; verified against source.
