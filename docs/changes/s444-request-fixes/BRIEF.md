change-id: s444-request-fixes

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-` (WORKTREE_ROOT) else STOP, report, exit.
2. Toplevel == WORKTREE_ROOT; clean; `git fetch origin`; assert merge-base HEAD origin/main == origin/main.
3. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT).
4. ABSOLUTE paths under WORKTREE_ROOT only; never `cd` into /home/bryan/scrmlMaster/scrml; never `git stash`; never `pkill -f`/`killall` on shared command strings (kill by captured PID).
5. First commit: this prompt verbatim → docs/changes/s444-request-fixes/BRIEF.md + progress.md, msg `WIP(s444-request-fixes): start at <pwd>`. Commit per unit. Branch `fix/s444-request-defects`. Never `--no-verify`. (If the live-Postgres hook test times out under machine load, `SCRML_PGTEST=0` is bryan-authorized on this machine; say so in the commit body.)

## MAPS
.claude/maps/ refreshed to 108ca89be (#1181) — read primary.map.md first; treat as hypothesis, verify against source; report load-bearing yes/no.

## Normative source — read it, quote it
compiler/SPEC.md §6.7.7 `<request>` in full (grep -n '6.7.7'). Governing sentences include: "When present, `deps` overrides inference." · Re-execution: "Any `@variable` in `deps=` changes" · "`<#id>.refetch()` | `() -> void` | Imperatively re-execute the fetch body" · "The `<request>` body calls a server function." Also §13.2 (auto-await at visible call sites).

## The three HIGH defects (filed on branch gaps/s444-dd059-061 in docs/known-gaps.md §S444b — read those entries: `git show origin/gaps/s444-dd059-061:docs/known-gaps.md`; repros in /tmp/claude-1000/-home-bryan-scrmlMaster-scrml/89e0ed5f-944e-4b25-b028-46392493e556/scratchpad/r/ and .../scratchpad/dd060/repro/). Loci are PA-relayed hypotheses — verify and report held / refined / wrong.
1. g-request-deps-attr-ignored-both-forms — `deps=[@x]` arrives as `{kind:"expr", raw, refs, exprNode:{kind:"array", elements:[ident]}}`; readers at emit-reactive-wiring.ts ~:2525 and reactive-deps.ts ~:1102 accept only array-kind or string `.value` → []. `url=` form falls back to one-shot; body form falls back to inference and drops explicit deps. Fix both readers (one shared helper), incl. `deps=[]` meaning mount-only.
2. g-request-body-client-wrapper-unawaited-one-shot — a `<request>` body `@hits = wrap(@q)` where `wrap` is a CLIENT function that calls a server fn: emitted `@hits = _scrml_wrap_8(...)` (a Promise), fetch-init section empty, `.loading` stuck true. Locus hypothesis emit-client.ts ~:3284 (post-server-fn-iife-wrap / collectRequestBodyCells). The request machinery must treat any async-colored callee (the same async-color analysis E-ASYNC-FN-ESCAPES-AS-VALUE uses — js-async-analysis.ts) as the fetch.
3. g-request-refetch-statement-dropped — `<#id>.refetch()` as a statement inside a function body (emits an empty function) or an inline multi-statement handler (only other statements survive). Locus not traced (searched ast-builder.js, emit-logic.ts) — trace it.

For each: reproduce on your base FIRST; fix; add unit/integration tests that assert RUNTIME-relevant emission (re-fire effect deps list; awaited/sequenced fetch; refetch call present) and conformance cases if a conformance shape exists for <request> (look under conformance/cases); R26: recompile real sources that use <request> (grep examples/ samples/ for `<request`) before/after and diff the emitted client JS — report every changed artifact and why. Direction-of-change: these are silent-wrong-output fixes (semantics-changed toward the SPEC); state that with the governing sentences quoted.
Run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` + `bun conformance/run.ts`. Push `git push -u origin fix/s444-request-defects`. No PR, no merge.

Report terse: WORKTREE_ROOT, SHA, per defect (reproduced-before, root cause, fix, tests), R26 artifact diff summary, test numbers.
