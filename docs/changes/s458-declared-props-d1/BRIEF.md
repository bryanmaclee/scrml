# BRIEF — s458-declared-props-d1 (S458 ruling "D1")

CHANGE-ID: `s458-declared-props-d1`. Agent: scrml-js-codegen-engineer, isolation worktree.
BASE: `git merge --ff-only origin/main` (your worktree is cut from origin/main; confirm `git merge-base HEAD origin/main` == `git rev-parse origin/main`).

Read first, IN FULL: the deep-dive `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/declared-props-reach-root-2026-10-07.md`
(read-only — it is outside your worktree; do not write there), the gap entry `g-declared-prop-reaches-expanded-root-s457` in `docs/known-gaps.md`,
SPEC §15 (Component System — especially §15.5, §15.10, and E-COMPONENT-012) and §66.15 (components retire into declarations: use-site attributes are
construction data, never DOM attributes).

Ruling (bryan, S458 verbatim "D1"): impl#1 converges on §66 NOW —
1. A DECLARED component prop never reaches the expanded root element as a DOM attribute. Every emitter must agree (the gap names
   `emit-html.ts` (`isDeclaredPropAttr`), `emit-each.ts`, `emit-lift.js` — PA HYPOTHESIS, located not traced; find EVERY expansion path, the
   S457 lesson is that these emitters disagree — enumerate them and say how you know the list is complete).
2. Narrow E-COMPONENT-012 so a component body CAN write a root attribute from a prop explicitly (`href=${href}` at its root). Quote the
   current E-COMPONENT-012 sentence; amend SPEC §15 with the narrowed rule and `> **Provenance:** ruling:user-voice-scrml.md S458 "D1"` ·
   `supersedes:` the sentence you change.
3. Fix the two explicit-write miscompiles the DD found.
4. Resolve the §15.5 vs §15.10 `id=` contradiction the DD names IN THE DIRECTION §66 states (if §66 does not decide it, STOP that sub-item
   and report it as a ruling — do not choose). O18 fallthrough: report only, do not decide. Add the missing `E-DECL-USE-ATTR` §34 row ONLY if
   the DD shows a governing sentence names it; otherwise report.
5. Interaction with in-flight work: a separate S457 branch (`worktree-agent-a885fd5687d9b5ebe`, srcdoc / SVG executable sinks) refuses
   executable writes at the attribute-write site and touches the same emitters. Do not reimplement its work; keep your change minimal at the
   shared sites and note every file you share with it (`git diff --stat b6a6b64f0 847719d0a`) so the PA can sequence the landing.

Direction: semantics-changed + newly-rejecting for accidental leaks. MEASURE by COMPILE: the DD says 13 of 14 attribute-named props in the corpus
leak accidentally (titles → tooltips). Report every artifact delta file-by-file (base origin/main vs head), and for each say "accidental leak removed"
or "intended attribute — now needs an explicit root write" (migrate the latter in the source, same commit, so behaviour is preserved).
STOP and report before landing if any delta is neither.

Empirical check: compile a component with declared props `title`, `href`, `disabled`, `id` used at a call site, in four positions (top level,
inside `<each>`, inside a `lift`, inside an engine/match arm): show the emitted HTML/JS has none of them on the root unless the body writes it,
and that `href=${href}` written at the root does appear (execute in happy-dom if the tests already have a harness for it).

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
