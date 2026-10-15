## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean. After `git fetch origin`, `git merge-base HEAD origin/main` must equal `git rev-parse origin/main`, which must contain `7c8e8f99a`. If any check fails: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never use a main-checkout path; never `cd` into main.
3. NEVER `git stash`. NEVER `pkill -f`/`killall` by command string. NEVER `--no-verify` or hooksPath changes. NEVER force-push.
4. Run `bun install`, then `bun run pretest` plainly from the worktree CWD.
5. TMPDIR must never point inside a repo: use `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-await-probe-pack` per command. The machine is memory-constrained (5 agents running), so never run two full suites at once.
6. `git checkout -b s466-await-probe-pack`. FIRST commit: this prompt verbatim → `docs/changes/s466-await-probe-pack/BRIEF.md` + `progress.md`, with message `WIP(s466-await-probe-pack): start at $(pwd)`. Commit after every step and keep progress.md complete, including gate result lines (reports go missing; the branch is the record).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (stale stamp). Then read `conformance/README.md` in full, plus `docs/changes/conformance-suite-d3-2026-06-29/SCOPE.md`.

## Why (owner ruling S466 "lets move the dpa up" → dpa-023 build arc)
The scoping DD is `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/dpa-023-build-arc-scoping-2026-10-14.md`. Read it. Its recommended phase-1 deliverable needs no ruling: turn the adversarial reviewers' wrong-password probe shapes into a permanent pack.
- The pack pins impl#1's security floor today; nine review rounds' worth of shapes currently exist only in reviewers' scratch dirs.
- It becomes the acceptance gate for the bootstrap's server half (U1c).

## Sources (READ-ONLY — copy what you need)
- `/home/bryan-maclee/.cache/scrml-review-await-r5/` (`harness.mjs`, `probes/s1–s14.mjs`, `probes/pa-verify.mjs`)
- `/home/bryan-maclee/.cache/scrml-review-await-r6/probes2/n1–n8.mjs`
- `/home/bryan-maclee/.cache/scrml-review-await-r7/probes3/m1–m4.mjs`
- `/home/bryan-maclee/.cache/scrml-review-await-r8/probes4/m5–m7.mjs`

Each shape module exports `SHAPES` (lib/app sources + a function body) and `DEFAULT_LIB`. The harness compiles each shape, loads the `.server.js`, seeds bun:sqlite with a real argon2 hash for bob, and calls the route with a wrong password and the right one. Expected: wrong → REJECTED, right → WELCOME.
- Shapes that legitimately refuse at compile time (a §13.2/§13.7 refusal) are a PASS (fail-closed).
- A runtime 500 that never returns WELCOME on a wrong password is a fail-closed pass too, but record it as such.
- "Wrong password accepted" is the FAIL.

## Decide the home (record the reasoning in progress.md)
1. **Can the conformance suite express this?** Its runtime layer is DOM + state-cell snapshot via `adapters/impl1-ts.ts` and `driver.ts`; it may have no server-route execution.
   - If it can (or a small, impl-agnostic extension of the adapter contract can: e.g. an `expected.json` "server" effect = POST a route with a body and assert the response), build it there.
   - Write the extension as a DESIGN NOTE in progress.md. Do NOT change the adapter contract without noting it is a contract change: the conformance corpus is the versioned language contract (§62.2), so a contract change is the owner's call.
2. **Otherwise**, build it as an impl#1 integration suite under `compiler/tests/integration/security-await-pack/`.
   - One data file per probe family; the shapes are data.
   - One runner test that compiles, loads and calls each shape, generated from the data.
   - Also produce a short design note proposing the conformance extension for the owner.

The PA expects (2) for now, with the conformance extension proposed, since impl-agnostic server effects are a contract change.

## Requirements
- All 424 shapes (s1–s14 + pa-verify + n1–n8 + m1–m7). Classify each on CURRENT main as PASS (correct), PASS-REFUSED (compile error, fail closed), PASS-500 (runtime fail closed), or FAIL (wrong password accepted).
  - The DD measured 9 FAIL on main (from m3/m4/m5). Rounds 8–9 on branch `s466-await-r8` close them.
  - Mark the currently-failing shapes as a KNOWN-FAIL list in the data (named, with the gap id `g-imported-async-server-fn-not-awaited-s465`), so the suite is GREEN on main and goes RED if any NEW shape starts accepting a wrong password, or a known-fail one starts passing (prompting its removal from the list).
- Make the runner deterministic and memory-sane: reuse one argon2 hash; temp dirs under TMPDIR, cleaned up; target under ~2 minutes total. If it's slower, put it outside the pre-commit subset and note where it runs: CI `gate` runs `compiler/tests/integration` via the pre-commit set, so measure the time.
- Do NOT modify compiler source. This branch is test data + runner + notes only.

## Gates
- The new suite passes on main.
- Pre-commit suite.
- `bun scripts/facts.ts --check` (regenerate if test counts changed).
- `bun scripts/state.ts --check`.

Push with `git push -u origin s466-await-probe-pack`. No PR.

## Report (short)
- SHA
- the home chosen and why
- the classification table on main (counts per class; the KNOWN-FAIL list)
- suite runtime
- the conformance-extension design note's one-line summary
- gate lines
