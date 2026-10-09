## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; `git remote -v` names bryanmaclee/scrml (not scrml-support); else STOP + report.
2. `git fetch origin && git checkout -B s460-aprime-ternary origin/main`; assert merge-base == origin/main (expect 3d0e54e21 or later).
3. `bun install`; `bun run pretest` plainly from the worktree dir.
4. Absolute paths under your worktree only; never `cd` into main; no `git stash`; no pattern pkill; never `--no-verify`. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-aprime-ternary/` per command.
5. First commit: this prompt verbatim → `docs/changes/s460-aprime-ternary/BRIEF.md` + `progress.md`. Commit incrementally; code + tests one commit.
## Writing scrml — read before any code: /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md and docs/articles/llm-kickstarter-v2-2026-05-04.md. Match analyze.scrml's idiom.
## MAPS: .claude/maps/primary.map.md first; loci are hypotheses.

## Task — S460 a′ review follow-ups (bootstrap only; impl#1 untouched)
Rulings: bryan S460 "a′, go" + "a on F2, go" (scrml-support/user-voice-scrml.md §S460): a bare unresolved condition, and an unresolved operand of a condition's `!`/`&&`/`||`, are E-COND-NOT-BOOLEAN. Landed in #1372 (SPEC §42.4 statements 5/6/10; compiler/self-host-v2/analyze.scrml `checkCond` → `condWhole` + `condOperands`).
- **N1 (PA decision, within the ruling — "inside a condition"):** a ternary that IS the condition's value (or an operand in its `!`/`&&`/`||` chain) has arms that are the condition's value when taken. Today `if (@b ? !g() : @c)` and `if (@b ? (g() && @c) : @c)` compile clean, while `if (@b ? g() : @c)` already errors — inconsistent. Walk such arms with the same condWhole/condOperands rule (blame per operand as now). Call arguments (`if (h(!g()))`), indexes, and ternaries in VALUE positions stay values (silent). Reproducers: /home/bryan-maclee/.cache/scrml-agent-tmp/s460-rev-aprime/probe/c8, c9 (copy, don't edit).
- **N2:** docs/known-gaps.md g-impl1-condition-rule-s460 prose says the bootstrap "passes 14 of the 17 condition/ cases" — measure the real figure now and correct it.
- **N3:** the operand error message for an `else-if=` operand says "in `if=`" — name the actual attribute.
- SPEC §42.4 statement 10: add one sentence covering ternary arms that are the condition's value, with `> **Provenance:** ruling:user-voice-scrml.md S460 "a on F2, go" (PA reading: ternary arms of the condition's value are inside the condition)`.
Tests: typer rows for both N1 shapes, nested ternary, ternary in a value position (`const v = @b ? !g() : @c` silent), call-arg stays silent, N3 message. One conformance case (xfail.impl1-ts, `--xfail-signature`). Bootstrap self-count delta (report per tree). Gates: core, conformance 0 FAIL, bootstrap suites per ci.yml, bootstrap-conformance --check (--write if it moves), types:check, s34-census, facts/SPEC-INDEX --check, host-global-scan. Report FINAL_SHA. No push.
