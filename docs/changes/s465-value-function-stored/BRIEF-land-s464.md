# BRIEF — s465-value-function-stored: land E-VALUE-FUNCTION-STORED (dispatched by S464 PA, 2026-10-12). change-id: s465-value-function-stored

## Rulings this rests on (verbatim, scrml-support/user-voice-scrml.md)
- S462 "a" — no value holds a function: object/array literals (and spreads) storing a function are refused (extends §14.3 E-STRUCT-FUNCTION-FIELD). S462 "go on the package" — no-function-in-value migration.
- S464 "(a) Migrate the tests" + "Yes, maps too (Recommended)": migrate the conformance case and the test fixtures to PASS functions instead of storing them; the historical `docs/changes/s441-*` repros stay as records (mark them, do not migrate); MAP LITERALS are values too — a function-valued map entry is refused. Rejected: a host-protocol carve-out for then/toString/iterator shapes.

## Where the work is
Branch `origin/auto/s465-value-function-stored` @ `51f2b60cb` — the check is built (`compiler/src/value-function-stored.ts`, wired in `type-system.ts`, 18 unit tests), read from the tree. Start: `git fetch origin auto/s465-value-function-stored && git switch -c s465-value-fn-land origin/auto/s465-value-function-stored && git merge origin/main`. Read its progress.md first.

## Remaining work
1. Map literals: confirm `["k": fn]` / `[k: fn]` map literals are refused (add if not). Unit tests.
2. Migrate: `conformance/cases/error/handler-failable-reference-exempt-neg` (`<fns> = [plain]`) and the ~108 test fixtures in 11 test files that store functions in values (mostly a thenable prelude `{ then: (f) => f(x) }` in the s457 handler tests, `toString`/iterator hooks in protect egress tests, #284 dispatch maps). Rewrite each to pass functions instead of storing them WHILE PRESERVING WHAT THE TEST TESTS — if a test's whole point needs a stored function (e.g. it tests that a stored thenable is handled), convert it to a NEGATIVE test asserting E-VALUE-FUNCTION-STORED, and list every such conversion in the report. Never weaken a security test silently.
3. SPEC: §34 row for E-VALUE-FUNCTION-STORED; sentences at §14.3 and §15.11.5 (and wherever map literals are specified, §59.3) with the Provenance line. Conformance: a positive-rejection case pinning it.
4. Measure the whole corpus (compile), report counts; non-zero outside the ruled migration set → list them and STOP short of migrating unknown files.

Done when: refusal + migration + SPEC + conformance case on a pushed branch `s465-value-fn-land`, pre-commit gate green.

$(F4)

## Rules (all dispatches) — delivered as a PA correction replacing the `$(F4)` placeholder
- Commit after each change (WIP commits fine); append timestamped lines to your change's `progress.md`. First commit: archive your brief (plus this block) verbatim as `docs/changes/s465-value-function-stored/BRIEF-land-s464.md`, message `WIP(s465-value-function-stored): start at $(pwd)`. Push your branch to origin at least once mid-way and at the end.
- Governing-sentence gate: quote the SPEC sentence(s) your change implements in progress.md + the final report. Any surface change carries a `> **Provenance:**` line at the amended SPEC section (`ruling:user-voice-scrml.md S464 "<verbatim>"`).
- Newly-rejecting changes: MEASURE corpus impact by compiling (not grepping) samples/, examples/, stdlib/, conformance/, benchmarks/; report counts + files. Prove each new test FAILS without the fix.
- Generated docs (`docs/known-gaps.md` §0, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/bootstrap-conformance.md`): regenerate with their scripts (`bun scripts/state.ts --write`, `bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/bootstrap-conformance.ts --write`), never hand-edit. Other PRs land on main while you work: `git merge origin/main` before your final push; resolve generated docs by regenerating, gap entries by keeping both sides.
- Keep tool output small (pipe through tail/grep). Scratch in `<worktree>/.tmp/`; TMPDIR=~/.cache/scrml-agent-tmp/s465-value-function-stored/ set per command; delete .tmp before reporting. Never `git stash`; never a bare `pkill -f`/`killall`; never `--no-verify`. Do NOT open or merge a PR — the PA reviews and lands.
- MAPS: `.claude/maps/primary.map.md` (stamp 41af4153a; ~10 commits behind HEAD — treat as a hypothesis, verify against source). Report whether it was load-bearing.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents so far this session: 0)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` must equal it; tree clean. If not → STOP and report.
2. `bun install`, then `bun run pretest` from the worktree CWD (NOT `bun --cwd <path> run`, which silently no-ops).
3. Every Read/Edit/Write uses an absolute path UNDER your worktree. Never write to `/home/bryan-maclee/scrmlMaster/scrml/<anything not under .claude/worktrees/agent-…>`. Never `cd` into the main checkout; use `git -C <worktree>`.

## Final report
Worktree path, final SHA, branch pushed, files touched, governing sentences, corpus counts, tests (before/after), deferred items, maps load-bearing?
