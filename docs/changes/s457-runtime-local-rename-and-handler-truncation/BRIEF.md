# BRIEF — s457-runtime-local-rename-and-handler-truncation (S457) — HIGH, two silent defects

CHANGE-ID: `s457-runtime-local-rename-and-handler-truncation`. Agent: scrml-js-codegen-engineer, isolation worktree.
REPRODUCE FIRST (both PA-reproduced at 0d8e9d8ce; re-check on current main).
1. `g-user-function-named-id-breaks-click-dispatch-s457` (HIGH): with a user `function id(x)`, the emitted click dispatcher reads
   `const id = t.getAttribute("data-scrml-bind-onclick"); if (id && _scrml_click[_scrml_id_3]) …` — every click handler is dead,
   exit 0. The user-identifier rename pass reaches a COMPILER-emitted local. Fix the ROOT: compiler-emitted runtime/boot code
   must be immune to user-name mangling — find every emitted local that the rename can hit (enumerate: grep the boot/dispatch
   emitters for bare locals like `id`, `t`, `el`, `event`, `key`, `i`, `name`, `value`…; and test by declaring user functions with
   each such name). Prefer making the rename structural (only rename user bindings) over renaming the runtime locals to
   `_scrml_` names (but the latter is acceptable as a belt-and-braces if the rename is text-based). Test every handler kind.
2. `g-onclick-unquoted-call-chain-drops-callback-s457` (HIGH): `<button onclick=Promise.resolve(5).then(function (v) { @msg = "x" })>`
   emits `Promise.resolve(5);` — the callback vanishes, exit 0 (only an irrelevant W-LINT-013). Read SPEC §5 (§5.1-§5.2.3, the
   attribute value forms and how an unquoted value ends) IN FULL. Governing-sentence gate: quote the sentence that decides
   whether this source is legal. If legal → make it compile correctly; if illegal → refuse it with a diagnostic that names the
   `${…}` / inline-block form; if SPEC is silent or ambiguous → STOP that item and report the question with the quotes (it is
   then bryan's ruling). Either way it must never be silent. Measure the corpus impact of any refusal by compiling.
Verification: repros before/after, browser tests, corpus differential, direction-of-change per item.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457b && git checkout FETCH_HEAD -- docs/changes/s457-runtime-local-rename-and-handler-truncation/` then commit it as your first commit:
   `WIP(s457-runtime-local-rename-and-handler-truncation): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-runtime-local-rename-and-handler-truncation/progress.md` (append-only, timestamped).
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
