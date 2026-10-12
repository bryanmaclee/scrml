# BRIEF — s462-given-body-text-as-code (finish) + s464-q24-markup-statement-refused (dispatched by S464 PA, 2026-10-12)

Two sequential parts, ONE branch, ONE agent. Finish part A, commit + push, then part B on top.

## Rulings (verbatim, scrml-support/user-voice-scrml.md)
- S462 Q24 "a": statement-position markup in a logic body that would not be rendered is a compile ERROR whose message says it is not rendered and names the fix (`lift <…>`, or make it the arm's single element); `lift` stays the one explicit way to render from logic; nothing vanishes silently. "Corpus to be MEASURED before landing; if the count is not small, it returns to bryan."
- S464 "E-MARKUP-STATEMENT-NOT-RENDERED" — the code name; message: "this markup is in statement position and is not rendered — write `lift <p>…</p>`".

## Part A — finish the display-text fix (markup display text parsed as code)
Branch `origin/wip/s464-markup-text-not-code` @ `5d0debf23`. Start: `git fetch origin wip/s464-markup-text-not-code && git switch -c s464-markup-text-q24 origin/wip/s464-markup-text-not-code && git merge origin/main`. Read `docs/changes/s462-given-body-text-as-code/progress.md` FIRST. The S465 cloud run left it "done except the error-code name"; reverting commit `dee0e1d5d` restores the full draft that used the name E-MARKUP-STATEMENT-NOT-RENDERED — verify that against progress.md before reverting. Then: SPEC §34 row + the governing section sentence with `> **Provenance:** ruling:user-voice-scrml.md S464 "E-MARKUP-STATEMENT-NOT-RENDERED"`, gates, corpus differential. Includes the HIGH gap `g-statement-markup-after-statement-text-runs-s462` (`let k = 1⏎<b>…</b>` in an arm runs display text as code).
⚑ Another branch (`s465-await-r5`, the await P0 fix, in review) also edits `compiler/src/ast-builder.js` in `parseLogicBody` (regions ~6441-7263 and ~13634). Keep your edits out of those regions where you can; mention any hunk that lands near them in the report.

## Part B — Q24: every statement-position markup that would not render → E-MARKUP-STATEMENT-NOT-RENDERED
Shapes (S465 list): two elements in one `if`/`given` arm; an element after a statement in an arm; a `for` body without `lift`; a logic `match` arm `{ <p>…</p> }`; a nested `${ if }` inside an implied-lift element; an arm the implied-lift desugar declines (`a < b` or a quoted `"</p>"` in its text); plain `${ <p>hello</p> }`; markup after a statement in a `${}` block. Read SPEC §17.6.10 (single-markup-arm implied lift) and §10 (`lift`) in full first; quote the governing sentences.
FIRST measure: compile the corpus (samples/, examples/, stdlib/, conformance/, benchmarks/, and `/home/bryan-maclee/scrmlMaster/{giti,flogence}` read-only) with the refusal on; count files + sites. If more than ~5 files outside test fixtures are newly refused → STOP part B, push what you have, and report the list (the owner decides). Otherwise build it, migrate the affected fixtures to `lift`, add a conformance negative case.

## Rules (all dispatches)
- Commit after each change (WIP commits fine); append timestamped lines to progress.md. First commit: archive THIS brief verbatim as `docs/changes/s464-q24-markup-statement-refused/BRIEF.md`, message `WIP(s464-markup-text-q24): start at $(pwd)`. Push branch `s464-markup-text-q24` to origin after part A and at the end.
- Governing-sentence gate: quote the SPEC sentence(s) your change implements. Any surface change carries a `> **Provenance:**` line at the amended SPEC section.
- Newly-rejecting changes: MEASURE corpus impact by compiling (not grepping); report counts + files. Prove each new test FAILS without the fix.
- Generated docs (`docs/known-gaps.md` §0, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/bootstrap-conformance.md`): regenerate with their scripts (`bun scripts/state.ts --write`, `bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/bootstrap-conformance.ts --write`), never hand-edit. `git merge origin/main` before your final push; resolve generated docs by regenerating, gap entries by keeping both sides.
- Keep tool output small. Scratch in `<worktree>/.tmp/`; TMPDIR=~/.cache/scrml-agent-tmp/s464-markup-text-q24/ set per command; delete .tmp before reporting. Never `git stash`; never a bare `pkill -f`/`killall`; never `--no-verify`. Do NOT open or merge a PR.
- MAPS: `.claude/maps/primary.map.md` (stamp 41af4153a, ~12 commits behind — a hypothesis). Report whether load-bearing.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents so far this session: 0)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` must equal it; tree clean. If not → STOP and report.
2. `bun install`, then `bun run pretest` from the worktree CWD (NOT `bun --cwd <path> run`).
3. Every Read/Edit/Write uses an absolute path UNDER your worktree. Never write to `/home/bryan-maclee/scrmlMaster/scrml/<anything not under .claude/worktrees/agent-…>`. Never `cd` into the main checkout; use `git -C <worktree>`.

## Final report
Worktree path, final SHA, branch pushed, files touched, governing sentences, corpus counts (part A and B separately), tests before/after, deferred items, maps load-bearing?
