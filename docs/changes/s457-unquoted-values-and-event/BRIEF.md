# BRIEF — s457-unquoted-values-and-event (S457 rulings 3a + 4a)

CHANGE-ID: `s457-unquoted-values-and-event`. Agent: scrml-js-codegen-engineer, isolation worktree.

Rulings (user-voice-scrml.md §S457): **4a** an unquoted attribute value is read WHOLE — a handler's assignment
(`onclick=@count = @count + 1`, today compiled to `count = count`) and a member chain in ANY attribute (`if=fn().ok` drops the
condition; `title=fmt(1).trim()` drops `.trim()`; `onclick=fn() .then(g)`); consistent with SPEC §5.2.3's own spaced example
`onclick=@phase = .Loading` and the S457 handler call-chain fix (tokenizer.ts postfix continuation, landed in #1345) — extend
THAT mechanism, one reader for every unquoted value. A value that is still ambiguous must be REFUSED with a diagnostic naming
`${…}` / quotes — never silently truncated. **3a** bare and inline-block handlers do NOT bind `event` (SPEC §5.2 "The native
event object is NOT passed to `fn` — it is available only inside the wrapper closure"; §5.2.3 "This amendment does not add an
event-object binding to the inline block") — rename the wrapper parameter out of the user namespace (`_scrml_event`), refuse a
bare `event` reference in a bare/inline handler with a new diagnostic pointing to `${(e) => …}` (§34 row + SPEC text with
provenance), and MIGRATE the corpus sites (measured 22: `oninput=f(event.target.value)` → `oninput=${(e) => f(e.target.value)}`)
in the same landing. Gaps: g-unquoted-handler-assignment-rhs-dropped-s457, g-unquoted-non-handler-value-chain-truncated-s457,
g-handler-event-binding-unspecified-s457 — read them. Measure corpus impact by compiling; report every newly refused file.
Verification: each repro before/after in happy-dom; corpus differential; conformance cases; full suite incl. the browser-tier
gate step from ci.yml run exactly.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457c && git checkout FETCH_HEAD -- docs/changes/s457-unquoted-values-and-event/` then commit it as your first commit:
   `WIP(s457-unquoted-values-and-event): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-unquoted-values-and-event/progress.md` (append-only, timestamped).
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
