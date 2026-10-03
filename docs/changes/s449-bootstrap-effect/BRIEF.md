change-id: s449-bootstrap-effect

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD — `bun --cwd <p> run` silently no-ops).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash` (the stash is shared across worktrees) — base/build flips by FILE COPY. NEVER a bare `pkill -f` — kill only PIDs you captured. Scratch goes in `<worktree>/.tmp/` (delete before your final report); `TMPDIR` must NOT point inside any repo.
4. First commit: this prompt verbatim → docs/changes/s449-bootstrap-effect/BRIEF.md, message `WIP(s449-bootstrap-effect): start at $(pwd)`. Commit after each meaningful change (WIP commits expected); keep docs/changes/s449-bootstrap-effect/progress.md append-only with timestamps. Code + its tests = ONE commit. Never --no-verify, never touch core.hooksPath. Foreground commits need a long timeout (the pre-commit hook runs ~2-4 min).
5. MEMORY GATE: two sibling agents run full suites on this 15 GB machine concurrently. Before every commit and every full-suite run, check `free -g` "available"; if < 6, wait (poll at most 10 times, 60 s apart, then proceed and note it) — an OOM SIGKILL mid-commit loses the commit.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 6a592ed5c, 2026-10-02; main has since landed only #1231 (docs/maps/SPEC prose) — read the copy in YOUR worktree). Follow its Task-Shape Routing. Treat map content as a hypothesis; report whether it was load-bearing.

Model: you are on Opus. All loci named below are PA-located-verify: report whether each held, was refined, or was wrong.

## You are writing scrml (the bootstrap compiler, compiler/self-host-v2/, is authored IN scrml)
Read BOTH before any code, and re-read before each feature: `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` and `docs/articles/llm-kickstarter-v2-2026-05-04.md` (in your worktree). The bootstrap is a from-scratch, human-quality scrml program — not a mechanical port of the TS compiler. Match the surrounding code's idiom. Read compiler/self-host-v2/progress.md and the slice dirs' progress first.

## Context — a re-scope of bootstrap unit U0
U0 was built as a runtime for the OLD keyword `when … changes` reactive effect, over rounds r1–r3c (branch `origin/wip/s447-bootstrap-u0-r3` @ 9835b80a4; local worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7c65fefac89c3297` on branch `s447-u0-r3` — READ-ONLY to you; take content by `git show <sha>:<path>` / file copy, never by editing that tree). Its DESIGN is `docs/changes/s446-bootstrap-u0-when-effects/DESIGN.md` on that branch. Most of it was a runaway backstop (provenance `Cause` links, per-segment cyclic check, LIFO re-run stack, depth-256 limit) for effects that write state.

**bryan ruled S447 (user-voice-scrml.md §S447, "`when` → outside-world effects only, spelled `<effect>`"):** a reactive effect may NOT write any reactive cell, directly or through a called function — compile error. Cascades are therefore impossible by construction, and the runtime backstop is DELETABLE. Spelled `<effect deps=[@a, @b]>${ … }</>`; does NOT run on mount. Page reset → `reset-on=[…]` on the cell being reset; autosave → a write `<request>` (no mount run, user edits only, server-origin writes re-baseline). Q7 (depth 256) and Q8 (polling) LAPSED.

**Normative text — read IN FULL in compiler/SPEC.md (your worktree), and quote the governing sentence for every rule you implement:**
- §6.7.4 `<effect deps=[…]>` (≈ line 4521–4830)
- §6.8 incl. §6.8.4 `reset-on=` (from ≈ line 6394)
- §6.7.7 + §6.7.7.1 + §6.7.7.3 write requests (≈ 5088–5504)
- §34 rows for E-EFFECT-*, E-RESET-ON-*, W-WHEN-EFFECT-DEPRECATED.
The full owed list is docs/known-gaps.md `g-bootstrap-effect-reset-on-owed` — that entry is your scope checklist.

## Phases (push `git push origin HEAD:refs/heads/wip/s449-bootstrap-effect` at the end of EACH phase)
**A — salvage the independent keepers from the U0 branch onto a fresh base:** the `<each>` row cleanup O(rows²) leak fix (5eecc60ec — real and independent), the iterative flush, and provenance-ORDER of re-runs (F1) only insofar as it still applies to derived/effect flush ordering without writes. Do NOT bring the cascade backstop. Record in progress.md what you took and what you left, with the reason per item.
**B — `<effect deps=[…]>` + the no-write rule:** parse/scope association by tree position (`if=` teardown, one per `<each>` row, route regions), no mount run, `E-EFFECT-NO-DEPS`, newest-run-wins with the §6.7.7.1 transport rule, derived flush before effect bodies. The compile-time rule: `E-EFFECT-WRITES-STATE` from a transitive per-function write summary (direct writes, resolved scrml calls incl. server functions, function values in the body), `E-EFFECT-WRITE-UNPROVEN` fail-closed for `^{}` / unresolvable calls, the message naming the fix by shape. The legacy `when … changes` spelling carries the same rule + `W-WHEN-EFFECT-DEPRECATED`.
**C — `reset-on=[…]`:** reset in the triggering flush before readers; `E-RESET-ON-INVALID-ENTRY`, `E-RESET-ON-CYCLE` (static), `E-RESET-ON-NOT-WRITABLE`; on a transition-graph (engine) cell `E-RESET-ON-ENGINE-REFUSED` when any non-target state's `rule=` refuses the target, and the reset fires `<onTransition>`.
**D — write requests (§6.7.7.3):** "provably writes" classification (its OWN test, not §6.7.7.1's unclassifiable=write); no mount run unless `deps=[]`; server-origin writes tagged at their emit sites re-baseline instead of triggering and bypass `debounced=`/`throttled=`; `reset-on=` resets inherit their trigger's origin; skip a save whose deps all `==` their baselines; baseline moves on a successful save. If the bootstrap does not yet have `<request>` write lowering at all, implement what the SPEC requires of the parts that exist and file the rest precisely.

**Do not decide silently** anything SPEC lists as ⚑ OPEN in §6.7.4 / §6.8.4 (cross-module write summaries, `navigate()` in an effect, `lift` in an effect body, server/channel cells under `reset-on=`, per-instance resets, cascades through engine transition effects, pending local debounced write vs server-origin write). Where the build forces a choice, choose FAIL-CLOSED (reject), note it in progress.md under "PA readings for veto", and keep going.

**STOP CONDITION:** if you find yourself rebuilding a runtime limit (budget/depth/counter) for anything, stop — under the ruling the hazard is impossible by construction; a limit means the compile-time rule has a hole. Report the hole.

## Verification
- Every new diagnostic: a positive AND a negative test; the conformance cases under conformance/cases/ that pin these codes (add them if absent — the codes-half and runtime-half are the merge blocker).
- Runtime: an e2e proving an effect body runs on dep change, not on mount, tears down with its `if=` region, and a `reset-on=` reset is seen as ONE change by dependents.
- The bootstrap's own gates (see compiler/self-host-v2/progress.md for the slice test commands) + `bun test compiler/tests/{unit,integration,conformance}`.
- Bite proof for the no-write rule: disable the summary propagation through a called function → the transitive-write negative test must go red; restore.
- Update docs/known-gaps.md `g-bootstrap-effect-reset-on-owed` (what landed, what remains) and compiler/self-host-v2/progress.md.
- Do NOT open a PR.

Final report: worktree path, FINAL_SHA per phase, files touched, what was salvaged vs deleted from U0, the write-summary mechanism in ≤8 lines, PA readings for veto, test counts, open items filed, path-discipline incidents.
