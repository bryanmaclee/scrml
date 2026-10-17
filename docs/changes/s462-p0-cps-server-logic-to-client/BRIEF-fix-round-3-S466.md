## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean. Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never a main-checkout path; never `cd` into main.
3. NEVER `git stash`, NEVER `pkill -f`/`killall` by command string, NEVER `--no-verify`/hooksPath changes, NEVER force-push.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists).
5. TMPDIR never inside a repo: `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-cps-r3` per command. Memory-constrained machine (several agents): targeted tests while iterating, full gates once at the end; never two full suites at once.
6. Branch: `git fetch origin && git checkout -b s466-cps-r3 origin/wip/s464-p0-cps-r1` (tip `82856e8c7`). FIRST commit: this prompt verbatim → `docs/changes/s462-p0-cps-server-logic-to-client/BRIEF-fix-round-3-S466.md`, message `WIP(s466-cps-r3): start at $(pwd)`. Commit after every step; append to that dir's `progress.md`. Code + tests one unit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`; stale by #1414–#1424). Then read `docs/changes/s462-p0-cps-server-logic-to-client/progress.md` IN FULL (rounds 1–2, S462/S465) and both BRIEFs there.

## The P0
In a CPS-split function, server logic and server values (incl. a password hash) ended up on the CLIENT; a forged client value (`role`) ran a DELETE (H1–H4, M1 in progress.md). Rounds 1–2 implemented SPEC §19.9.9.8 (read it IN FULL in compiler/SPEC.md).

## Owner rulings since round 2 (user-voice-scrml.md §S464 — read the entries verbatim)
- **"Ratify (Recommended)"** — §19.9.9.8 is normative: a statement reading a server-originated value is server-tier; no server value round-trips through the client as later-batch input; a browser-only statement that would have to move is E-RI-002; statements before the first server statement never move. Supersedes §19.9.9.7 bullet 1. The SPEC provenance line becomes `ruling:user-voice-scrml.md S464` (not `pa-ruled:`).
- **"(a) Guards stay server"** — amend §19.9.9.8 rule 3: a statement that reads a server-originated value and can skip or end the function (`return` / `fail` / `break`, or an `if` whose body holds later server statements) is server-tier; if it also needs the browser → E-RI-002 with the message: move the browser work after the server work, or split the function. Newly-rejecting (reviewer measured 0 sites in 951 example/sample files). The motivating hole (PA-reproduced S465): `@ok = vp(pass, ?{SELECT pw…}.get().pw); if (!@ok) { alert("wrong"); return }; ?{INSERT …}.run()` split the guard into the browser, leaving the INSERT route callable by anyone. progress.md calls this control-dependence g1/g4.

## Work
1. **Merge origin/main** (now `7f2b81418`, incl. #1424 the await P0 — it rewrote async-name handling across the same codegen files: `file-async-fns.ts`, `scheduling.ts`, `emit-server.ts`, `emit-functions.ts`, `index.ts`, plus #1418/#1422/#1419/#1416/#1417). Real 3-way merges; where this branch and #1424 both decide "is this call async/awaited", the result SHALL read #1424's ONE per-file set (`computeFileAsyncFnNames` / `isGlobalSchedulerCallee`) — do not reintroduce a second reader. Regenerate generated docs; union known-gaps. Commit the merge.
2. **Implement the guard ruling** (rule 3 amendment) at the root of tier classification: control dependence on a server value makes a statement server-tier. Amend §19.9.9.8 rule 3 text + `> **Provenance:** ruling:user-voice-scrml.md S464 "(a) Guards stay server"`; flip the "Ratify" provenance line. Tests: the S465 repro (guard + INSERT — the INSERT must not be reachable without the guard passing server-side; execute it: forge a request to the INSERT batch route without the guard and show it is refused/unreachable), `return`/`fail`/`break` variants, an `if` holding later server statements, the E-RI-002 case (guard that needs the browser, e.g. `alert`).
3. **Re-verify H1–H4 + M1** (progress.md) still closed on the merged tree, by execution.
4. Leave a1/g5 fail-closed 500s as recorded (KNOWN LOW) unless trivially fixed.

## Acceptance (do NOT report DONE without all)
- The S465 guard repro: no server-gated write route callable without the server-side guard (executed).
- H1–H4/M1 closed (executed); a wrong password is never accepted in any CPS shape in your tests.
- Corpus differential vs origin/main over examples/ samples/ conformance/cases/ + read-only ../giti ../flogence: report newly refused (real programs newly refused → STOP and report; the ruling measured 0) and every emit diff.
- Gates: pre-commit suite; `bun test compiler/tests/*.test.js`; lsp+commands; types --check; bootstrap slice; facts/state/spec-index/bootstrap-conformance/corpus-compile-floor/host-global-scan/browser-baseline --check; `bun scripts/s34-census.ts --check-new --base origin/main`.
- Push `git push -u origin s466-cps-r3`. No PR.
## Report (short)
Worktree; final SHA; merge conflicts + how resolved (esp. async-name readers); rule-3 implementation locus; executed evidence for the guard + H1–H4; corpus diff; gate lines; open questions.
