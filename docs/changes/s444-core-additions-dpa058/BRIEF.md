change-id: s444-core-additions-dpa058

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-` (WORKTREE_ROOT) else STOP, report, exit.
2. Toplevel == WORKTREE_ROOT; clean; `git fetch origin`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main` (main @ 29eb80c31 or later — includes #1189 typer r8, #1190 dpa-045 parser, #1195 comment/escapes). If your worktree is stale but clean with no commits of yours, `git reset --hard origin/main`.
3. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT).
4. ABSOLUTE paths under WORKTREE_ROOT only; never `cd` into /home/bryan/scrmlMaster/scrml; never `git stash`; never `pkill -f`/`killall` on shared strings.
5. First commit: this prompt verbatim → docs/changes/s444-core-additions-dpa058/BRIEF.md + progress.md, msg `WIP(s444-core-additions-dpa058): start at <pwd>`. Commit after every unit; timestamped progress.md lines. Branch `feat/s444-core-additions-dpa058`. Never `--no-verify` (SCRML_PGTEST=0 is bryan-authorized on this machine if the live-PG test times out under load; say so in the commit body).

## MAPS
.claude/maps/primary.map.md (stamp 108ca89be — bootstrap files changed since; verify against source). Report load-bearing yes/no.

## Context (read first)
- compiler/self-host-v2/progress.md and docs/changes/s442-bootstrap-six-programs/progress.md (the §66.19 program status table + the exact Core gaps: rows 66.19.5 audit log and 66.19.2 validated form are PARTIAL; `core.scrml` was off-limits then — it is FREE now).
- SPEC §66.19 (the six worked programs), §66.5 (renders), §66.6 (`<*x/>`), §66.12 (sequences: removal edits, index places), §5.4.1 bind dispatch, §55 validity surface. Rulings: /home/bryan/scrmlMaster/scrml-support/user-voice-scrml.md — S442 "RULED — dpa-058 (O25) = all PA recs" (verbatim items 1–6) and the dpa-058 deep-dive scrml-support/docs/deep-dives/renders-bind-and-validator-landing-o25-dpa-058-2026-09-29.md. Quote rulings, don't paraphrase.
- The bootstrap design rules: S437 R2–R5 (thin Core IR, immutable runtime values, the program is internally a `single` declaration), dpa-051 §3.4 total matches (lint-no-default-arm), the S233 four-phase re-cut (lex·parse·analyze·lower+emit, each phase its own IR).

## PHASE A — Core additions (commit + full verification at the end of the phase before starting B)
Add to Core (core.scrml) and wire through analyze → lower → emit/runtime, each with tests + mutation rows (slice-m1/bench/mutations.js, all RED):
1. a `bind:` attribute form (value/checked per §5.4.1) — the event-value round trip;
2. a host call Expr (e.g. `Date.now()`) — decide the bounded surface (which host calls are admitted and how that relates to §41.19 `scrml:time.now()` / purity in `fn`); state your decision + governing sentences in progress.md; if the SPEC is silent on what the bootstrap should admit, pick the NARROWEST form that makes §66.19.5 run and flag it for the PA;
3. `View.Star` (`<*x/>` renders the existing instance, §66.6);
4. removal edits (pop/shift/remove per the S442 grow/shrink grant tokens), index places (`@xs[i].f = v`, dpa-052 Q3), lambdas (for `filter` etc.) — the AExprK Spread/Index/Lambda arms exist in analyze; Core + lowering are what's missing.
Goal: §66.19.5 (audit log) and §66.19.2 (validated form, minus validators) run FROM SOURCE, not fixture-derived; update the status table.
Phase-A verification: lint, slice-m1/m2/m3/m4, lowered m1, v2-lexer, mutations (all RED), bite matrix, conformance (impl#1 untouched), ALL top-level compiler/tests/*.test.js (the cloud gate runs them; the hook doesn't), the gate. Push after Phase A (`git push -u origin feat/s444-core-additions-dpa058`) and write a PHASE-A-DONE line in progress.md.

## PHASE B — dpa-058 build (on top of A)
Per the S442 ruling: (1) bind always written in `renders` (no implicit bind); (2) the HTML-native validator subset (`required`, `minlength`/`maxlength`, `min`/`max`, `pattern` only when exact) lands on every native input/textarea/select whose `bind:` targets that declaration's value; no bind → validity surface only; (3) the compiler adds `novalidate` to any form carrying lowered attributes; (4) O54 = (a) `@email` inside `email`'s own `renders` is this instance; (5) silently dead validators are errors (validators on a top-level scalar with no surface, or on a declaration nothing binds; `@x.isValid` on a no-surface cell). Decide + name the diagnostic codes (check §34/§55 for existing ones; new codes get §34 rows marked Nominal/lands-with-impl). §66.19.2 validators then run.
Full verification again. Push.

## Report (terse)
WORKTREE_ROOT, SHA per phase, per item: what landed + governing sentences + tests/mutations; every decision you made where the SPEC was silent (PA must see these); §66.19 status table after; verification numbers; anything deferred.
