change-id: s449-bootstrap-conformance-counter

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into main. NEVER `git stash`. NEVER a bare `pkill -f`. Scratch in `<worktree>/.tmp/` (deleted at end).
4. First commit: this prompt verbatim → docs/changes/s449-bootstrap-conformance-counter/BRIEF.md, message `WIP(s449-bootstrap-conformance-counter): start at $(pwd)`. Commit after each change; progress.md append-only. Never --no-verify. Long timeout on foreground commits.
5. MEMORY GATE: check `free -g` "available" before each commit / full run; if < 6 wait (≤10 polls, 60 s).

Model: Opus. Siblings own compiler/self-host-v2/** sources (opener-keywords migration; form validity) — you do NOT edit them; you own a new script under scripts/, a docs/FACTS-style generated section if appropriate, and conformance harness glue (conformance/adapters/ or run.ts flags). docs/known-gaps.md shared — append in `## §S449-bootstrap-conformance-counter`.

## Goal
bryan asked "how far along are we on the bootstrap?" and there is no number. Build an honest, reproducible measure: **how many conformance cases the bootstrap passes**, by area, against the same corpus impl#1 is graded on (conformance/cases/**, the language-1.0 gate, §62.2: the corpus IS the versioned contract).
1. Find how conformance runs today (`bun conformance/run.ts`, conformance/adapters/ — there is an impl1-ts adapter; check whether a bootstrap/hybrid adapter exists (the S449 effect + value-write agents ran §66-dialect cases "through the bootstrap front end" — find how) and whether the bootstrap can run the runtime-half of a case or only the codes-half).
2. Build `scripts/bootstrap-conformance.ts` (or an adapter + run.ts flag) that runs EVERY case against the bootstrap and classifies each: PASS (codes + runtime), CODES-ONLY PASS (runtime-half not executable by the bootstrap), FAIL (wrong codes / wrong runtime), UNSUPPORTED (bootstrap refuses with E-BOOTSTRAP-UNSUPPORTED or can't parse the dialect — note the corpus is mostly the LEGACY dialect `<x> = 0` which the bootstrap does not parse: report legacy-dialect cases as a separate bucket, never as FAIL), CRASH. Output: totals + a per-area table (by case directory) + the list of FAILs (a FAIL is a bug or a divergence — the most useful output). Make the probe state its own scope (N of M cases attempted) and separate exit status from output (pa-base §8 gate-design rules).
3. Run it on current main; record the baseline numbers in progress.md and in a generated section (e.g. docs/FACTS.md has a generator — add a `bootstrap-conformance` row only if its inputs are deterministic per commit; otherwise a standalone report file under docs/).
4. Do NOT wire it as a blocking CI gate (it would be red over a backlog — the §8 cry-wolf shape); a non-blocking tracking step is fine if cheap (< ~60 s); say what you did.
5. File each FAIL family as a gap (one entry per family, locus + prov=empirical:S449-bootstrap-conformance-counter) — unless it's clearly a dialect artefact.
Verification: the script's own tests (a tiny fixture set with known PASS/FAIL/UNSUPPORTED), a bite (inject a wrong expected code into a fixture → FAIL). Do NOT open a PR; push `git push origin HEAD:refs/heads/wip/s449-bootstrap-conformance-counter`.
Final report: worktree, FINAL_SHA, the baseline numbers (totals + top areas), how the runtime half is or isn't executed, FAIL families filed, runtime of the script, path-discipline incidents.
