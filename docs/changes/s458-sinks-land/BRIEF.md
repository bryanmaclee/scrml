# BRIEF — s458-sinks-land (bring the reviewed S457 srcdoc/SVG executable-sinks change onto current main)

CHANGE-ID: `s458-sinks-land`. Agent: scrml-js-codegen-engineer, isolation worktree.
BASE: `git merge --ff-only origin/main` (main now includes #1345 — scope-aware rename + `_scrml_` compiler locals — which shares 5 emitter files with this change).

The change: branch `worktree-agent-a885fd5687d9b5ebe` @ `847719d0a`, base `b6a6b64f0`. Read its `docs/changes/` progress.md + BRIEF.md on that branch (`git show 847719d0a:docs/changes/<id>/progress.md` — find the id with `git diff --stat b6a6b64f0 847719d0a`). It closes `g-srcdoc-unquoted-expression-not-refused-s457` and the SVG half of `g-svg-animation-and-meta-refresh-url-sinks-s456`; ruling "(a)" = lift wires every rule-1 `on…` name as a listener. It was reviewed three rounds, final verdict LAND-WITH-NITS (0 dialogs over 16 declared-prop variants; corpus: only 3 trucking/gauntlet files change — `setAttribute("onX", fn)` → a dead listener became a live one, intended).

Do: `git diff b6a6b64f0 847719d0a -- . ':!docs/known-gaps.md' ':!docs/FACTS.md' ':!compiler/SPEC-INDEX.md' ':!docs/bootstrap-conformance.md' | git apply -3`. Resolve every conflict as a REAL 3-way merge preserving BOTH sides — especially where #1345 renamed compiler-emitted locals into the `_scrml_` namespace or made the user-fn rename scope-aware: the sinks code must use the new spellings and must not reintroduce a bare compiler local. Then regenerate (this is your one exception to F4 rule 9, regenerate only, never hand-edit): `bun run scripts/regen-spec-index.ts`, `bun scripts/facts.ts --write`, the bootstrap-conformance report (`--write`, if the change touches conformance cases), `bun run types:check` (`--write` the baseline in the same commit if the set changes). Commit as ONE landing commit (+ your BRIEF commit first), message naming the source branch + SHA.

Verify: full gates per house rules incl. the browser-tier CI step; re-run the change's own tests and the review's executed probes from its progress.md on the merged tree (srcdoc unquoted expression refused; SVG `<animate>/<set>` href sinks refused or guarded per the change; lift `on…` listener wiring) and show base (origin/main) vs head; corpus emit differential base vs head — expect only the 3 trucking/gauntlet files the review found; any other delta → STOP and report.

Gap text for the PA in your final report: the two flips above RESOLVED-by-this-landing, plus NEW LOW entries for the review's nits: (1) top-level camelCase `onClick` wiring, (2) call-ref on a non-event attribute, (3) each/emit-html still wire `one=` / `online=` / `onboarding=` data values as listeners (contradicts §5.2 rule 1). Note: a concurrent agent (D1, declared props never reach a component root) touches emit-html/emit-each/emit-lift too; do not anticipate it.

[SHARED BLOCK FOLLOWS]
## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Base: `git fetch origin`; follow the BASE line of your brief exactly.
3. Your FIRST commit archives this entire prompt verbatim to `docs/changes/<CHANGE-ID>/BRIEF.md` with the message
   `WIP(<CHANGE-ID>): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/<CHANGE-ID>/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
   The pre-commit hook runs the core suite (~4-8 min under load) — give commits a long timeout; never read a commit's success from a piped exit code, check `git log`. If one test fails only under load, re-run it alone and retry the commit; report it.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it.
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `125486345`), follow its Task-Shape Routing to the 2-4 maps for your task,
treat map content as a hypothesis to verify against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract),
  `bun conformance/run.ts`, AND the browser-tier gate step exactly as `.github/workflows/ci.yml` runs it,
  plus the empirical checks named in your brief.
- Corpus measurement is by COMPILING, base vs head — record command + counts.
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class with the measurement · gap-entry text for the PA · anything deferred.
