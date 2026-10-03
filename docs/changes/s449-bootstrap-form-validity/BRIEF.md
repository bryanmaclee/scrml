change-id: s449-bootstrap-form-validity

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash`. NEVER a bare `pkill -f`. Scratch in `<worktree>/.tmp/` (deleted at end); `TMPDIR` never inside a repo.
4. First commit: this prompt verbatim → docs/changes/s449-bootstrap-form-validity/BRIEF.md, message `WIP(s449-bootstrap-form-validity): start at $(pwd)`. Commit after each change; progress.md append-only. Code + tests = ONE commit. Never --no-verify, never touch core.hooksPath. Long timeout on foreground commits.
5. MEMORY GATE: check `free -g` "available" before each commit / full run; if < 6 wait (≤10 polls, 60 s).

Model: Opus. You write scrml: read BOTH before any code and re-read before each feature — /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md and docs/articles/llm-kickstarter-v2-2026-05-04.md.
Siblings: an opener-keywords agent OWNS compiler/self-host-v2/parse.scrml + lex.scrml and is migrating the §66 opener spelling (`let <x/>` replaces `<let x/>`) across bootstrap tests — **do NOT edit parse.scrml/lex.scrml**; write your new test sources in the CURRENT spelling (they'll be migrated at landing; keep them few and simple). You own analyze/lower/core/print/runtime changes for this. docs/known-gaps.md shared — append in `## §S449-bootstrap-form-validity`.

## The defect (HIGH) — `g-bootstrap-validated-form-fields-fail-open-no-surface-no-gate` (read it)
The bootstrap emits `novalidate` on every `<form>` carrying lowered validator attributes (S442 (3)) but has NO §55 validity surface and NO submit gate: the browser's own block is removed and nothing replaces it — every validated field in a form gates nothing (fail-open).
## The ruling + normative text
bryan S447 (user-voice-scrml.md §S447 "validated top-level cells get a validity surface (Edge A reversed)" + "validity calls 2-6"): the bound top-level validated scalar is legal, has a surface, and is gated in a form. SPEC §55.5.1, §55.5.2, §55.17 (change docs/changes/s447-spec-validity-surface/) + §55.5/§55.6 (surface: isValid / errors / touched / submitted), §55.7 (read-only synthesized properties), §55.8 `<errors of=…/>`, §55.9–§55.12 (ValidationError, message chain, cross-field, multi-errors), §55.13 reset interaction. Read §55 IN FULL; quote the governing sentence for every behaviour.
## Build (in this order; push after each)
1. The validity surface for validated cells (per-field + compound per §55.5/§55.6), read-only (writes refused per §55.7), recomputed reactively; `<errors of=…/>`.
2. The compiler submit gate (§55.17): a `<form>` containing validated fields does not run its submit handler while any is invalid; `submitted`/`touched` transitions; keeps `novalidate` only now that the gate replaces the browser block. Prove fail-CLOSED: an invalid field → submit handler NOT called (runtime test).
3. Flip `topLevelValidatorsLower()` (per the gap) so top-level validated scalars lower and gate.
4. If the full surface is too large for one dispatch, land 1+2 (the fail-open is the HIGH) and file the rest precisely.
## Verification
Runtime tests (happy-dom, the slice runtime harness): invalid → no submit; valid → submit; errors render; reset clears; bite (disable the gate → the no-submit test fails). Slice gates (ci.yml "Bootstrap slice" step) green at ≥ current counts (m2 448, m4 504); `bun test compiler/tests/{unit,integration,conformance}`; `bun conformance/run.ts`; add conformance cases for the gate (codes-half + runtime-half) — impl#1 xfail where it diverges (file/locate the impl#1 gap). Do NOT open a PR; push `git push origin HEAD:refs/heads/wip/s449-bootstrap-form-validity`.
Final report: worktree, FINAL_SHA, what was built per step, governing sentences, the gate's fail-closed proof, gate counts, what remains filed, path-discipline incidents.
