# BRIEF — s457-sql-one-reader (S457)

CHANGE-ID: `s457-sql-one-reader`. Agent: scrml-js-codegen-engineer, isolation worktree.

Two gaps, ONE principle (the S456 durable: "two readers of one text = a bypass; ONE reader whose answer is the runtime's"):
1. `g-sql-slot-reader-regex-division-misreads-s456` (LOW, fails closed). Locus (hypothesis):
   `compiler/src/codegen/code-segments.ts` (`regexAllowedAfter`) + `compiler/src/codegen/sql-lex.ts` (`jsInterpolationEnd`).
   The shared `${…}` slot reader decides regex-vs-division by heuristic and misreads after an object-literal `}`, after `)`
   when a keyword sits in a string or after `.`, and after comment text → false refusals. Fix: end a `${…}` slot by asking
   the JS parser — `acorn.parseExpressionAt(text, start, {ecmaVersion: "latest"})` — so the extent is JS's own answer.
   Keep it fail-closed: if acorn cannot parse, refuse exactly as today. Check every consumer of the reader (S456 said 8);
   list them in progress.md and confirm each still gets a correct extent.
2. `g-rewrite-sql-refs-lowers-inside-js-literals-s456` (MED, pre-existing). Locus (hypothesis): `rewriteSqlRefs` somewhere
   under `compiler/src/codegen/` — FIND it. It lowers a backticked `?{` sitting inside a JS string / regex / comment in raw
   expression text. The rewriter must skip strings, comments, template-literal text and regexes the SAME way the checker
   does — ideally through the same tokenizer/reader, not a second one.
Read the gap entries in `docs/known-gaps.md` (grep the ids) and SPEC §8.1.2 IN FULL first (the "ONE reader of a `${…}` slot
extent, JS-aware" sentence is the governing text — quote it in progress.md).

Verification: unit tests for each misread shape named in the gap entries (object-literal `}` then `/`, `)` after a string
containing a keyword, comment text, regex literals containing `}`/`${`); a `?{` inside a JS string/regex/comment left
untouched; EMPIRICAL corpus compile before/after with artifact + diagnostic diff — expected: inert on the corpus, or only
false refusals removed (newly-accepting ONLY where SPEC §8.1.2 already says the program is legal — quote it); report counts.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457 && git checkout FETCH_HEAD -- docs/changes/s457-sql-one-reader/` then commit it as your first commit:
   `WIP(s457-sql-one-reader): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-sql-one-reader/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it. (Brief 3 is the one exception, named there.)
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `ba2712973`, 2026-10-07; HEAD since then adds only the S456 wrap + maps PRs —
no source change), follow its Task-Shape Routing to the 2-4 maps for your task, treat map content as a hypothesis to verify
against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract)
  plus `bun conformance/run.ts`, and the empirical check named in your brief (an emitted-artifact check, not "tests pass").
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
