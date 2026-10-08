# BRIEF — s458-refinement-every-position (S458 "refinement next") — PHASE 0 ONLY, then STOP and report

CHANGE-ID: `s458-refinement-every-position`. Agent: scrml-js-codegen-engineer, isolation worktree.
BASE: `git merge --ff-only origin/main` (confirm `git merge-base HEAD origin/main` == `git rev-parse origin/main`).

The gap (HIGH, `docs/known-gaps.md` `g-refinement-checks-absent-in-n-positions-s457`, filed by the S457 `string(url)` review): §53 refinement
checks are not emitted in nine positions — (1) reassignment of a refined cell (`@u = v`); (2) struct fields (`type T:struct = { u: string(url) }`);
(3) top-level `const X: string(url) = f()`; (4) `<endpoint>` payload fields (parseVariant defers — a `javascript:` field returns 200; `<api>`
responses likely the same); (5) schema/table fields; (6) a server function's refined return type; (7) library / tool / value-export function
parameters; (8) a literal call argument (throws at runtime, not judged statically); (9) a refined parameter on a nested worker `<program>`
function. SPEC §53.6.1 lists these under impl#1 status. A refinement type promises a property the program does not have.
Related LOW: `g-server-param-contract-400-string-coercion-throws-s457` (the refined-param 400 path does `String(param)`, which can throw).

bryan ruled the priority ("refinement next"); the SPEC already says SHALL, so this is conformance restoration, not a ruling — EXCEPT where you
find SPEC silent or contradictory for a position: that is a ruling, report it, do not decide it.

WHY PHASE 0 FIRST: the last four S455–S457 arcs each had to "change the boundary, not the patch" after several review rounds. Nine positions
patched one at a time is exactly the per-position bug generator (fork rule row 4: root beats position). Find the ROOT before building.

Phase 0 deliverable (write to `docs/changes/s458-refinement-every-position/PLAN.md`, commit, then STOP and give the PA a final report):
1. Read SPEC §53 IN FULL (three zones §53.4; §53.4.3; §53.6.1; §53.9) and quote the governing sentence for EACH of the nine positions
   (or "searched §X, §Y — none found").
2. Reproduce each position on current origin/main: a minimal `.scrml` + the compile command + observed vs expected (executed where it is
   runtime — e.g. the `<endpoint>` 200, run the server). Mark any that do NOT reproduce.
3. Trace where §53 checks ARE emitted today (the trusted / boundary / runtime zones; `emit-predicates.ts`, the type-system zone classifier,
   parseVariant) — the entry point → decision path, not a grep hit. Name the structural reason the nine positions are missed (one cause or several?).
4. Propose the root design: ONE place that decides "this write/boundary crosses a refined type → judge it" (e.g. a typed-write / boundary-crossing
   classification the emitters consume), with the judges shared (reuse `_scrml_url_shape_ok` and the existing predicate emitters — one reader).
   Give: the files it touches, how each of the nine positions falls out of it by construction, what population a fail-closed default
   would newly refuse (count it by COMPILE over the corpus, base origin/main — a dry-run classification is fine), runtime-cost notes, and how
   bundles without the helpers (worker / tool / library — see `g-worker-bundle-runtime-helpers-not-inlined-s457`) get the judge.
5. Direction-of-change per position (newly-rejecting / semantics-changed — e.g. a reassignment that used to succeed now fails at runtime) with the
   measured corpus population.
6. A size estimate with the survey-first discount stated honestly (you will be wrong by multiples either way — give a range).

Do NOT change compiler source in Phase 0 beyond throwaway probes under `$WT/.tmp/` (delete before reporting). Reproducers you want kept go
in `docs/changes/s458-refinement-every-position/repro/`.

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
   The pre-commit hook runs the core suite (~4-6 min) — give commits a long timeout; never read a commit's success from a piped exit code, check `git log`.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it.
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `125486345`, refreshed S457; the maps PR #1350 may still be merging — if your tree has
the older `ba2712973` stamp, factor in the S457 landings #1340–#1348), follow its Task-Shape Routing to the 2-4 maps for your task,
treat map content as a hypothesis to verify against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour; quote the governing sentence in progress.md.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract),
  `bun conformance/run.ts`, AND the browser-tier gate step exactly as `.github/workflows/ci.yml` runs it (pre-commit excludes it; S457 lost a CI round to stale browser pins),
  plus the empirical check named in your brief (an emitted-artifact / executed check, not "tests pass").
- Corpus measurement is by COMPILING (samples/, examples/, conformance/, stdlib/), base vs head — record command + counts.
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
