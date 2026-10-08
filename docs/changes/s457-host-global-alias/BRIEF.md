# BRIEF — s457-host-global-alias (S457 ruling 2a)

CHANGE-ID: `s457-host-global-alias`. Agent: scrml-js-codegen-engineer, isolation worktree.

Ruling (user-voice-scrml.md §S457, "2a"): compiler-emitted references to host globals go through a runtime alias no user name
can reach. Gap: `g-user-fn-named-host-global-hijacks-compiler-refs-s457` (read it): a user `function fetch` + any server function
makes `_scrml_fetch_with_csrf_retry` call the user's function; a user `function document` breaks `t !== document`. Root:
compiler and user references to a global are both free names; the S457 scope-aware rename (`compiler/src/codegen/fn-name-rename.ts`)
cannot tell them apart. Fix: every host global the compiler's emitted code/runtime uses (ENUMERATE them: grep the runtime
template + every emitter's string output for free identifiers — window, document, fetch, location, history, setTimeout,
clearTimeout, requestAnimationFrame, queueMicrotask, Promise, JSON, Object, Array, Map, Set, Symbol, Error, console, crypto,
URL, Request, Response, Headers, AbortController, Event, CustomEvent, Node, Element, HTMLElement, MutationObserver, …) is
captured once at runtime start into `_scrml_`-namespaced aliases (e.g. `const _scrml_g_fetch = globalThis.fetch`) and every
compiler reference uses the alias; the rename pass then never needs to touch them. User code is unaffected (a user may still
shadow globals in their own code). Server artifacts too. Verification: user functions named after each enumerated global +
every handler kind / server call path run correctly in happy-dom (and Chromium for fetch/document); corpus differential (expect
only the alias rewrite, inert); full suite incl. the browser tier gate step from ci.yml run exactly.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457c && git checkout FETCH_HEAD -- docs/changes/s457-host-global-alias/` then commit it as your first commit:
   `WIP(s457-host-global-alias): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-host-global-alias/progress.md` (append-only, timestamped).
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
