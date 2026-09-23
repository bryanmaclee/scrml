# BRIEF — s427-seed-round4: round 4 of #1014 (a failed seed cannot score GREEN) — TIGHTENING, not a rewrite

change-id: `s427-seed-round4` · dispatched S427 (peter / P-Tech1, Windows) · base: `origin/main`

## 0. Startup (mandatory, in order)
1. `pwd` MUST be your worktree (`.../scrml/.claude/worktrees/agent-...`). `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main`. Clean tree. If any check fails: STOP and report.
2. `PUPPETEER_SKIP_DOWNLOAD=1 bun install` (a plain `bun install` fails on this clone: broken puppeteer cache — environment, not repo).
3. Bring #1014's work onto your branch — it is the STARTING POINT and it is right:
   - `git fetch origin fix/s426-seed-loud-doors-land brief/s427-seed-round4`
   - First verify `git log --oneline 8ab7c07a~1..origin/main -- compiler/tests/e2e-render-map/` is EMPTY (nothing landed on main touching those files since #1014's base). If not empty: STOP and report — do not clobber.
   - `git checkout origin/fix/s426-seed-loud-doors-land -- compiler/tests/e2e-render-map/ docs/changes/s426-seed-loud-doors/`
   - `git checkout origin/brief/s427-seed-round4 -- docs/changes/s427-seed-round4/`
   - Commit: `WIP(s427-seed-round4): start at <pwd> — carry #1014 (8ab7c07a) onto origin/main`.
4. Baseline: `bun test compiler/tests/e2e-render-map/` → expect **237 pass / 0 fail**. Record it in progress.md.
5. NEVER use `git stash` (shared across worktrees). NEVER `pkill -f` a shared command string. Edit with Edit/Write on worktree-absolute paths. Commit after each meaningful change; keep `docs/changes/s427-seed-round4/progress.md` (append-only, timestamped). WIP commits expected.

## 1. What #1014 already did (DO NOT REBUILD)
`seedBridgeFailed(obs)` reads two carriers (the `[seed-bridge]` console notice AND `seedReport.errors[]` / a `set-threw` write). `runDetectors` wraps `classifyObservation` and demotes any GREEN result to the new red state `seed-bridge-failed` (with `detail.seedBridgeDemotedFrom`). `GREEN_STATES` is single-sourced in `render-detectors.js`. Two wrong existing assertions were corrected. Keep all of that.

## 2. The two defects to fix (both PA-reproduced last session; every locus below is PA-located-verify — report whether each hypothesis held, was refined, or was wrong)

### Defect 1 — the D1 mount-throw door blames the compiler for a harness artifact
Locus (hypothesis): `classifyObservation`, the D1+D7 block, the `needs-server` early return guarded by `&& !seedBridgeFailed(obs)`.

`mountAndObserve` assigns `setFn` only AFTER `exec()` returns, so ANY mount throw kills the seed side channel → `seedBridgeFailed(obs)` is ALWAYS true at this door for a seeded cell. So the `!seedBridgeFailed` term removes the `needs-server` carve-out unconditionally for every SEEDED server-dependent app, which then scores **`compiles-but-throws`** — a compiler-blaming state for what is a server-absence throw plus a consequential seed failure. That is precisely the mis-attribution `seed-bridge-failed` was minted to prevent (see that state's own comment in `RENDER_STATES`). It bites the moment the coverage ratchet seeds a `needs-server` app: the cell goes permanently red and no compiler fix can clear it.

**Required outcome:** a seeded, server-dependent app whose mount throw IS server-absence-shaped (`isServerAbsenceMessage`) and whose seed failed scores **`seed-bridge-failed`**, with `detail.seedBridgeDemotedFrom === "needs-server"` and the `needsServer` explanation retained in detail. A ReferenceError/TDZ mount throw (NOT server-absence) stays `compiles-but-throws` regardless of the seed.

**Suggested shape (you may overturn it with reasons):** drop the `!seedBridgeFailed(obs)` term at this door and let the terminal guard in `runDetectors` do the demotion. The choke point exists for exactly this; a door-local special case re-creates the per-door pattern #1014 removed.

⚑ **THE CLASS ONE LEVEL AWAY — check it, do not assume.** The state-resolution block's `needs-server` door (the console-error path) carries the same `!seedBridgeFailed(obs)` term. S424 added it because `needs-server` was green and green cells have `detail` stripped by `generate-baseline.js`; the terminal guard now makes that reason obsolete. Determine BY EXECUTION whether a seeded server-dependent app whose only non-notice console error is server-absence-shaped currently scores `compiles-but-throws`, and whether it should be `seed-bridge-failed` by the same argument. Note the `[seed-bridge]` notice is itself a console entry — confirm it matches neither `hasCodegenError` nor `isServerAbsenceMessage`, so the carve-out's `consoleErrors.some(isServerAbsenceMessage)` still requires a REAL server-absence error. Report what you found and what you did either way.

### Defect 2 — the "NO verdict about the compiler" note is stamped on cells that DO carry a verdict
Locus (hypothesis): `SEED_BRIDGE_NOTE` + `noteSeedBridgeFailure`, written unconditionally at the self-demoting doors (the D1 `compiles-but-throws` return; the console-error `compiles-but-throws` return) and by the terminal guard.

Measured: a seeded app whose mount throws `loadContacts is not defined` — genuine codegen, `S-UNBOUND-REF` in the same smell set — carries `detail.seedBridgeFailure = "…this cell carries NO verdict about the compiler"` into the committed baseline. That tells the next triager to disregard a real compiler bug. It is ALSO false for a `[seed-signature]`-only error, where every seed write landed and only the DOM snapshot helper threw.

**Required outcome:** the recorded text is TRUE for the cell it sits on.
- On a cell red for an INDEPENDENT reason (a real throw / a codegen console error): the note says the seed was also not delivered AND that the cell's red verdict stands on its own evidence — never "no verdict".
- On a cell demoted from green by the guard (`seed-bridge-failed`): "no verdict about the compiler" is correct only for what genuinely failed.
- A `[seed-signature]`-only failure (writes landed, snapshot failed) must not be described as "the harness could not deliver the seed". Decide — with the reason stated in source — whether it still demotes a green (D6 is unmeasured there, so the green is unverified), and word the note to what actually failed.
- Keep ONE writer for the note text (no drift between sites); `S-SEED-BRIDGE-FAILED` stays the single greppable smell.

## 3. Ride-along (small; do them)
- The in-source "by construction" claim: doors 3/4 (`renders-empty` / `renders-clean` demotions) are only unit-reachable today, because every harness path that fills `seedReport.errors` also pushes a `[seed-bridge]` console notice, which makes the state-resolution block return first. Make the comment say that honestly.
- The CELL-level gap: `observeCompiled` returns `renders-empty` directly, BEFORE the seed is applied, bypassing `runDetectors`. Do NOT fix it this round unless it is a few lines and clearly safe — MEASURE whether a seeded cell can reach that return and REPORT the answer with the code path. If you do fix it, pin it.

## 4. Tests (`detector-validation.test.js`)
Pin each outcome behaviourally through `runDetectors` (never by source-string grep):
- Defect 1: server-absence throw + seed failure → `seed-bridge-failed`, demotedFrom `needs-server`.
- ReferenceError throw + seed failure → `compiles-but-throws`, `S-UNBOUND-REF` present, note does NOT contain "NO verdict".
- Control: server-absence throw with NO seed failure → still `needs-server`.
- `[seed-signature]`-only → whatever you decide, pinned, note not claiming non-delivery.
- Whatever the Defect-1 sibling investigation decides.

**Mutation bite (required, report numbers):** revert each fix in turn, confirm its pins go red, restore, confirm green.

## 5. Gate + empirical check — DO NOT report DONE without these
- `bun test compiler/tests/e2e-render-map/` → all pass, 0 fail (report count vs 237).
- Baseline cells: confirm ZERO committed-baseline cells move vs origin/main's own detector run. The four live-vs-committed warnings (1 ORPHAN / 3 NEW / 2 GREEN→RED) are pre-existing — measure pre-vs-post, do not assume. If any cell moves, STOP and report which and why.
- Ask of every check "is where it moved CORRECT?", not only "did it move?" — that exact blind spot cost the previous round three times.

## 6. Report
Worktree path · final SHA · files touched · per defect: hypothesis held/refined/wrong, what changed, the pins, mutation-bite numbers · the sibling-door finding · the observeCompiled finding · test count · baseline-movement result · anything deferred.

## MAPS
`.claude/maps/` is stale (stamp `787d4cb4`) and `test.map.md:450` is WRONG about this tier's gate (nothing runs it). Treat maps as hypotheses; the source is the authority.
