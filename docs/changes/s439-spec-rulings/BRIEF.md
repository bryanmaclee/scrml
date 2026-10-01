# BRIEF — s439-spec-rulings (write bryan's S439 "all recs" language rulings into SPEC.md)

Dispatched S439-bryan, 2026-09-27. Agent: general-purpose (SPEC-text only), opus, isolation: worktree.
Brief branch: `brief/s439-spec-rulings`.

## 0. STARTUP (mandatory, before anything else)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; else STOP.
2. `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `git fetch origin brief/s439-spec-rulings && git checkout FETCH_HEAD -- docs/changes/s439-spec-rulings/`
4. `bun install` (the pre-commit hook needs node_modules).
5. First commit `WIP(s439-spec-rulings): start at $(pwd)` with BRIEF + empty progress.md.
Rules: Edit/Write only worktree-absolute paths; never `cd` into or write the main checkout; never `git stash`;
never `pkill -f`; never `--no-verify` or hook tampering. Commit after each section amended + a progress.md line.

## 1. The authority — READ IT FIRST, VERBATIM
`/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md`, the section `## S439 — bryan / ASUS —
2026-09-27` (read-only; it is in a sibling repo — do NOT edit it). bryan answered "all recs" to a 14-item list;
the full list text in that entry is ratified, INCLUDING the PA scope notes at its end. **Draft the SPEC from that
answered text, never wider.** Two recent sessions widened rulings in restatement (S435, S437 — "fixed" added,
consequences unstated); the adversarial review of your draft will compare it word-for-word against that entry.
If the answered text does not determine a detail you need, DO NOT invent it: write the SPEC sentence as far as
the text goes and add the gap to an "OPEN — not ruled" list in your report (and, where the section has one,
§66.22's OPEN list style).

## 2. What to amend (SPEC.md only — compiler/SPEC.md; then regen SPEC-INDEX)
For each item: find the governing section(s), QUOTE the current sentence(s) you change in progress.md, write
the amendment, and add a `> **Provenance:** ruling:user-voice-scrml.md S439 #<n> "all recs"` line (plus
`· supersedes: <what>` when you narrow/overturn an existing sentence — Rule 4b).
- **#2** §40.8 — a bare `when` at program/page/channel body-top is LOGIC by its grammar head (lifted, like the
  `on mount {` lift). Close the §40.8 S378 "open operator question per-shape" for THIS shape only.
- **#5** a `<match>` inside an engine state-child is SUPPORTED (and the nested-block-match-in-dispatched-arm
  fork answered the same way — find where that fork / E-IF-IN-DISPATCHED-ARM's "dispatched arm" definition lives).
  impl#1 divergence: `W-ENGINE-MATCH-IN-STATE-CHILD` — check §34 has its row (bryan APPROVED the row as the
  carried-divergence code); if the row text claims it is the language rule, correct it to name the divergence.
- **#7** reserve the `_scrml_` identifier prefix: one SPEC sentence + a named diagnostic (pick a code in the
  existing E-NAME-COLLIDES-RESERVED family if one fits, else name a new one; §34 row lands with impl — mark
  Nominal per the named-codes-land-with-impl rule, as §66.20 does).
- **#8** §50.8.5 / §17.4a — a keywordless loop binder is `const`; name the diagnostic a write to it gets
  (reuse E-ASSIGN-004 if §34 makes it fit, else name one, Nominal).
- **#9** §5.2.1 / §5.2.2 — ONE click/event contract: native bubbling (inner handler first, both fire,
  `stopPropagation` honoured), for page markup and `<each>` rows alike. Note impl#1's page-markup delegation
  (innermost-only) as a carried divergence.
- **#10** an `<engine>` (and, in §66 terms, a `single` declaration) inside an `<each>` row is REFUSED — under
  E-COMPONENT-ENGINE-SCOPE or a named sibling; the message names the per-row form (an ordinary declaration,
  keyed per row, §66.7). Write it in §51.0.K and §66.13 consistently.
- **#11** §51.0.E — `initial=` accepts a payload constructor (`initial=.Ready([…])`); the payload is carried.
  Cross-ref §66's field initializer.
- **#12** §6.7.2.1 / §7.6 — a `${…lift…}` block inside an `if=` scope: declarations run once at file init
  (file scope, §7.6); lift statements run per mount. Make the two sentences agree explicitly.
- **#3** §6.5.6/§6.5.7 are NOT amended toward deep reactivity. Add nothing there beyond, at most, a one-line
  note that §66.10 supersedes the question for the §66 model — only if §66.10 does not already say it.
- **#14** E-ERROR-002 (find its section): the handler exemption follows the unhandled failable call, NOT the
  statement count. ⚑ The all-error DIRECTION is conditional on a MEASURED corpus count: compile the corpus
  (`bun compiler/bin/scrml.js compile` over `examples/ samples/ conformance/ stdlib/ benchmarks/`, or the
  repo's corpus-emit-differential script — find it) with the rule applied mentally: count the programs that
  have a ONE-statement handler block containing an unhandled `!` call (today exempt). If the count is ZERO,
  write the all-error rule. If NON-ZERO, do NOT write the direction: write only "the exemption follows the
  unhandled failable call, not the statement count", list the count + files in your report, and stop there.
Not in scope: #1, #4, #6 (Peter's TS holds carry their own SPEC text — do not touch §7.3.3 or §19.16), #13.

## 3. Mechanics
- SPEC.md is huge: never full-read; `grep -n` headings, targeted Read with offset/limit.
- After all edits: `bun run scripts/regen-spec-index.ts` and commit SPEC-INDEX.md with it. Update the Sections-
  table summaries for any section whose scope changed.
- If `bun scripts/facts.ts --check` or `bun scripts/state.ts --check` exist and cover SPEC line counts, run them
  and regenerate with their --write if they fail for SPEC-length reasons only.
- No code changes. The pre-commit hook may still run tests — run commits in the foreground with a long timeout.

## 4. Report
FINAL_SHA · per-item: § amended + the quoted before-sentence + the new sentence(s) · codes named (and whether
§34 rows were added or marked Nominal) · the #14 measured count + method · the OPEN-not-ruled list · anything
where the answered text and the existing SPEC collide in a way the text does not settle.
