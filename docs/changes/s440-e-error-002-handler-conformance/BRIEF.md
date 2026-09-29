change-id: s440-e-error-002-handler-conformance

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENT counter this session: 0)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` must equal it. `git status --short` clean. Else STOP and report.
2. `git fetch origin && git merge --ff-only origin/main`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Report your base SHA.
3. `bun install` then `bun run pretest` (plainly from the worktree CWD — `bun --cwd <path> run` silently no-ops).
4. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root; never a main-checkout path; never `cd` into main. Edit/Write for edits, not Bash heredocs.
5. NEVER `git stash` (shared across worktrees). NEVER `pkill -f`/`killall` on a command string — kill by PID.
6. First commit: archive THIS ENTIRE PROMPT verbatim to `docs/changes/s440-e-error-002-handler-conformance/BRIEF.md`, message `WIP(s440-e-error-002-handler-conformance): start at $(pwd)` (expanded).
7. Commit after every meaningful change; append-only timestamped `docs/changes/s440-e-error-002-handler-conformance/progress.md`. Code + its tests in ONE commit. Never `--no-verify`, never touch `core.hooksPath`. Commits run the full core suite (~4-5 min): Bash timeout 600000.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `fb21983a`, 2026-09-28) first; follow its Task-Shape Routing (error/type-system maps). Verify against source; report load-bearing or not.

## THE RULING
bryan RULED at S440 ("all recs" on this text): *"#14 E-ERROR-002 (the SPEC has no handler exemption; only the TS compiler grants one): restore conformance. That means migrating 6 bare `onX=fn()` handlers across 5 files."* This builds on the S439 ruling #14: *"make the exemption follow the unhandled failable call, not the statement count. Either every handler block containing an unhandled `!` call errors, or none does. I lean all of them (closed wins)"* — now decided: ALL error.

## GOVERNING TEXT — read IN FULL before any change
`compiler/SPEC.md` §19.4.3 and §19.4.4 (locate by `grep -n '19.4.3\|19.4.4' compiler/SPEC.md`), including the "⚑ OPEN (not ruled) — the direction" block under §19.4.3, which lists the measured corpus. Quote the governing SHALL sentences in progress.md (Rule 4 governing-sentence gate).

## THE WORK
1. **impl#1:** remove the event-handler exemption so an unhandled call to a `!`-failable function inside ANY event-handler value fires E-ERROR-002 — bare `onX=fn()`, braced `{ fn() }`, `${fn()}`, and multi-statement blocks alike (the exemption must no longer depend on statement count or form). Locus hypothesis (PA-located-verify — found by grepping the code name, NOT traced): `compiler/src/type-system.ts` (and a mention in `compiler/src/validators/lint-defer.ts`). Report where the exemption is actually DECIDED and whether the hypothesis held.
   - Do NOT flag function REFERENCES: `<formFor onsubmit=persistSignup/>` passes a reference, and §41.14 (`E-FORMFOR-ONSUBMIT-SIGNATURE`) REQUIRES it be failable. Likewise a handler reference `onclick=handler` (no call) is not an unhandled call. Only CALLS.
   - A call handled with `!{}` or propagated inside a failable context must stay legal.
2. **Migrate the measured corpus** (from the §19.4.3 OPEN block; re-verify each): `conformance/cases/defer/control-flow-neg/case.scrml` (`onclick=b()`, `onclick=c()`), `conformance/cases/error/propagate-in-non-failable-fn-neg/case.scrml` (`onclick=caller()`), `conformance/cases/error/propagate-non-failable-callee-neg/case.scrml` (`onclick=caller()`), `conformance/cases/error/propagate-non-failable-callee-pos/case.scrml` (`onclick=caller()`, a positive case expecting a clean compile), `samples/compilation-tests/gauntlet-s20-error-test/server-failable-001.scrml` (`onclick=getUser(1)`). Migrate each so the case still tests what it was written to test (read the case's expectations file) — typically by handling the call with an exhaustive `!{}` or by routing through a non-failable wrapper. Do NOT change what a neg case asserts except where the new E-ERROR-002 must be added to its expected codes because the ruling makes it fire — prefer migrating the source so the case's original intent is preserved.
3. **Re-measure by COMPILING the corpus** (not grepping): run the compiler over `examples/ samples/ conformance/ stdlib/ benchmarks/` before and after; the only newly-failing files must be the 5 above (then fixed by migration). Record the command, the file counts and any surprise. A newly-failing file NOT in the list → STOP that part and report it (the ruling covers the measured 6 sites only).
4. **SPEC:** replace the §19.4.3 "⚑ OPEN (not ruled) — the direction" block with the ruled text: every unhandled `!` call in an event-handler value is E-ERROR-002 regardless of statement count or form; references are not calls; add `> **Provenance:** ruling:user-voice-scrml.md S439 #14 + S440 "all recs" (restore conformance)`. Also update the §34 E-ERROR-002 row if it mentions the exemption. Then `bun run scripts/regen-spec-index.ts` if line ranges moved.
5. **Conformance pin:** add a case pinning the rule (a braced multi-statement handler with an unhandled `!` call → E-ERROR-002; a one-statement braced form → E-ERROR-002; a reference → clean). Follow the existing `conformance/cases/error/` layout.
6. If `docs/known-gaps.md` has a gap for this exemption, mark it resolved (edit the entry only; never regenerate by `--theirs`).

## VERIFICATION
- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` green; `bun conformance/run.ts` — report before/after counts.
- Adversarial self-check: handler inside an `<each>` row, inside an engine state-child, in a component prop callback, `on mount { }` body (is that a handler? read the SPEC — only change what §19.4.3/§19.4.4 govern), a call nested in a ternary/argument, a `?`-propagated call in a handler. Add tests for each shape the SPEC governs.
- Direction-of-change: newly-rejecting only. If anything becomes newly-ACCEPTED, STOP and report.

## REPORT (terse)
WORKTREE_PATH · base SHA · FINAL_SHA · files touched · where the exemption lived (hypothesis held/wrong) · corpus measure before/after (command + counts) · test + conformance counts · anything for the PA. Clean `git status` before reporting.
