change-id: s440-bootstrap-1109-fixes-reland

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENT counter this session: 0)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` must equal it. `git status --short` clean. Else STOP and report.
2. `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if your base is older, `git reset --hard origin/main` is NOT allowed — instead `git merge --ff-only origin/main`. Report your base SHA.
3. `bun install` then `bun run pretest` (run plainly from the worktree CWD — `bun --cwd <path> run` silently no-ops).
4. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never a path under `/home/bryan-maclee/scrmlMaster/scrml/` that is not inside `.claude/worktrees/agent-…`. Never `cd` into the main checkout. Use Edit/Write (not Bash heredocs) for file edits.
5. NEVER `git stash` (the stash stack is shared across worktrees). NEVER `pkill -f`/`killall` on a command string — kill by PID only.
6. First commit: archive THIS ENTIRE PROMPT verbatim to `docs/changes/s440-bootstrap-1109-fixes-reland/BRIEF.md`, commit message `WIP(s440-bootstrap-1109-fixes-reland): start at $(pwd)` (expand pwd).
7. Commit after every meaningful change; keep `docs/changes/s440-bootstrap-1109-fixes-reland/progress.md` (append-only, timestamped: done / next / blockers). WIP commits expected — the branch is your crash-recovery anchor. Code + its tests go in ONE commit (never a transiently red split). Never `--no-verify`, never override `core.hooksPath`. Pre-commit runs the full core suite (~4-5 min) — use a Bash timeout of 600000 for commits.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `fb21983a`, 2026-09-28) and follow its Task-Shape Routing. The maps PREDATE the bootstrap M2/M3 landings (#1117 typer, #1118 ingest, #1122 six family tables) — treat anything they say about `compiler/self-host-v2/` as a hypothesis to verify against source. Report whether the maps were load-bearing (a "not load-bearing" answer is useful).

## THE TASK
bryan RULED at S440 (verbatim "all recs" on this text): *"Peter's `hold/s438-1109-review-fixes` (fixes to your M2 bootstrap slice; the worst bug is a swap written via spread that gives 2,2 instead of 2,1): merge. I'd dispatch the rebase over the new typer and #1122. Should a spread write be all-or-nothing on a runtime refusal? Yes. Under R3 (runtime values are immutable) the whole new value is built first and then checked, so a partial apply shouldn't be possible."*

So two parts:

### Part 1 — re-land `origin/hold/s438-1109-review-fixes` (@ `eb3de63d`, one commit) onto current main
The ref was cut before the typer (#1117) and the six NodeId-indexed family tables split (#1122); `compiler/self-host-v2/analyze.scrml` changed by ~2270 lines since its base, so a mechanical cherry-pick will conflict. Read the commit (`git show eb3de63d`) and RE-APPLY its intent against current code:
- **F1 HIGH** — spread overrides write in sequence: `@p = { ...@p, x: @p.y, y: @p.x }` yields x=2,y=2 instead of the swap 2,1. Every override value must read ONE snapshot of the pre-write value (§66.11.3 item 1). Read SPEC §66.11 IN FULL (`compiler/SPEC.md`, locate by `grep -n '### 66.11'`) before changing anything.
- **F2 MED** — a direct `@h` read/write inside its own `given` narrowing was refused (§66.7.5, O56). Read §66.7.5 in full.
- **F3 LOW** — the §66.19 SPEC drift guard fails on CRLF (section-scoped, CRLF-safe).
Carry Peter's tests (`slice-m2/front.test.js`, `slice-m2/parse.test.js` changes) and make each RED on current main before your fix (prove it by running the test against main's code first; record the red output in progress.md), GREEN after.
Loci named here come from the hold commit, which predates the current file layout — PA-located-verify: report whether each held, moved, or was wrong.

### Part 2 — spread writes are ALL-OR-NOTHING on a runtime refusal (ruled)
Today a spread-shaped field edit lowers to separate field writes; if a later field write is refused at runtime (its sub-field contract — a transition graph, a lifecycle, a sequence grant — rejects it), the earlier writes stay applied. Make it all-or-nothing: build the whole new value from one snapshot, check every sub-field contract against it, and commit only if all pass; on refusal nothing is applied. Governing text: §66.11 (the spread-override shape is a FIELD EDIT judged by each sub-field's own contract; S437 O58 (b) — a GENUINE replace is authoritative and bypasses sub-field contracts; that is NOT this path). If the SPEC has no sentence stating atomicity, DO NOT edit SPEC.md — record "searched §66.11, §66.10, … — no governing sentence" in progress.md and your report; the PA will write the SPEC line. Add a test: a spread over two contract-carrying fields where the second is refused leaves the value byte-identical to before.

### Part 3 (only if Parts 1-2 are green and committed) — revert Peter's now-dead workarounds
#1119 (impl#1 F12/F13/F14 fixes) landed on main, so these bootstrap workarounds are revertible (from Peter's S438 note; verify each still exists before touching): F12: `lex.scrml:912`, `slice-m1/lint.test.js:95`, notes `print.scrml:24`, `parse.scrml:32`. F13: `check.scrml:91/101`, `print.scrml:431/439/656`, notes in `ast.scrml:21`, lower, analyze. F14: `LB()`/`RB()` in `js.scrml:69`, `parse.scrml:43`, `analyze.scrml:171`. Revert only where the plain form now compiles correctly — verify by compiling. If a revert breaks anything, keep the workaround and report it.

## VERIFICATION (all must pass before DONE)
- `bun test compiler/self-host-v2/slice-m1 compiler/self-host-v2/slice-m2 compiler/self-host-v2/slice-m3` (report counts).
- The slice-m1 mutation harness: `bun compiler/self-host-v2/slice-m1/bench/mutations.js` (~240s; exits 1 on NOT-RUN/GREEN) and the bite matrix `bun compiler/self-host-v2/slice-m3/bench/bite-matrix.js` (~118s) — report before/after; neither may regress.
- The footprint grader (slice-m3; see `docs/changes/s439-bootstrap-m3-ingest/footprint-2026-09-27.md` for how it was run) — runtime passes must not drop below 18/18.
- Adversarial self-check: enumerate where else a spread / multi-field write can occur (nested spreads, spread inside `<each>` rows, spread through an `as=` handle, a spread with zero overrides, override of a contract-free field alongside a contract-carrying one) and add a test for each shape you can express today.

## REPORT (terse)
WORKTREE_PATH · base SHA · FINAL_SHA (branch tip) · files touched · test counts before/after · harness/bite-matrix/footprint numbers · per-locus hypothesis held/moved/wrong · Part 3 reverts done/kept · anything left for the PA (esp. a missing SPEC sentence for atomicity). Clean `git status` before reporting.
