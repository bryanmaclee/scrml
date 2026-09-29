# BRIEF — s442-bootstrap-six-programs (S442, bryan/XPS PA)

You are the canonical dev agent working in an ISOLATED WORKTREE on the scrml bootstrap compiler
(`compiler/self-host-v2/`, scrml source compiled by impl#1). Task: grow the bootstrap FRONT END (parse →
analyze → lower → print) so all six SPEC §66.19 worked programs compile and run end-to-end.

## 0. CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENT counter: 0 this session)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit.
2. `git rev-parse --show-toplevel` == that path. `git status --short` clean.
3. `git merge-base HEAD origin/main` == `git rev-parse origin/main` (your base is origin/main; assert it).
4. `git fetch origin brief/s442-bootstrap && git checkout FETCH_HEAD -- docs/changes/s442-bootstrap-six-programs/`
   (this BRIEF lives on that branch). Commit it as your first commit: `WIP(s442-six-programs): start at $(pwd)`.
5. `bun install` then `bun run pretest` run PLAINLY from the worktree CWD (NOT `bun --cwd <path> run` — that
   silently no-ops and exits 0).
6. Every Edit/Write uses an ABSOLUTE path under your worktree root. Never `cd` into
   `/home/bryan/scrmlMaster/scrml` (the main checkout). Use `git -C "$WT"` / `--cwd=` forms.
7. NEVER `git stash` (shared across all worktrees). Flip base-vs-build by FILE COPY.
8. NEVER `pkill -f` / `killall` on a shared command string — kill only by the PID you captured.
9. Commit after EVERY meaningful unit (WIP commits expected) and append a timestamped line to
   `docs/changes/s442-bootstrap-six-programs/progress.md`. Branch + progress.md = crash-recovery anchor.

## 1. MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing. ⚑ The map stamp is `fb21983a`
(S438) — it PREDATES the bootstrap M3 typer (#1117), tables split (#1122), ingest/bite matrix (#1118) and the
S440 re-land (#1129). Treat every map claim about `compiler/self-host-v2/` as a HYPOTHESIS. A refresh runs in
parallel; do not wait for it. Report whether the maps were load-bearing.

## 2. Anti-pattern briefing
The bootstrap is WRITTEN IN scrml, and the six programs are scrml. Read
`../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` and `docs/articles/llm-kickstarter-v2-2026-05-04.md`
before any code; re-read before each program. Mirror the bootstrap's established idioms and the impl#1
workarounds recorded in `compiler/self-host-v2/progress.md` (F1-F10) and the slice progress files.

## 3. Authority
- The six programs: SPEC `compiler/SPEC.md` §66.19.1-§66.19.6 (`grep -n '^#### 66.19' compiler/SPEC.md`).
  Read each IN FULL plus the §66 sections each one exercises. §66 is normative; the programs are the target.
- Rulings that post-date SPEC text: `../scrml-support/user-voice-scrml.md` §S437, §S439, §S440 (SPEC pass 2
  is not written). Where a §66.19 program's comments and a later ruling disagree, the RULING wins — report it.
- §66.22 lists OPEN (unruled) items. If a program needs an OPEN item decided to compile: do NOT decide it.
  Implement the rest, stop at that construct, and report the OPEN id + the smallest ruling that unblocks it.
- The grant spelling (`Entry[free, end]`, O10) is NOT ruled final — implement it as SPEC writes it, isolated
  behind one parse helper so a respelling is one edit.

## 4. The work
Starting state: the front end handles the counter (`slice-m2/src/counter.scrml`) and `app.scrml`; S439 held
this growth behind #1122 (tables split, now merged). First, a SURVEY commit: for each of the six programs,
compile it through the bootstrap as-is and record in progress.md exactly where it fails (stage + construct).
That table is your plan; post it in progress.md before building. Then take the programs in order of least
missing surface.

Ownership: you OWN `compiler/self-host-v2/{parse,lex,ast,lower,print,html,js,walk}.scrml`, new fixtures/tests
under `slice-m2/` (or a new `slice-m4/` if the survey says it's cleaner — your call, justify it). A parallel agent
owns `analyze.scrml`/`check.scrml`/`names.scrml` (implementing S440 typer diagnostics). You WILL need analyze
edits for new constructs: keep them ADDITIVE (new cases/functions, no rewrites of existing logic), group them in
dedicated commits, and list every analyze hunk in your report — the PA 3-way merges at landing. Do NOT touch
`core.scrml` or any `slice-m3/` CSS file (another session holds a branch on them); if a program needs CSS/
`<theme>` (§66.19.4 likely does), stop at that construct and report it.

## 5. Verification — a grade is only evidence if breaking the thing breaks it (S439)
- Each program: an end-to-end test that compiles it and RUNS it (the slice-m1 browser/runtime harness shape),
  asserting behaviour the program's comments promise — including its negative lines (the `// → E-...`
  comments: each commented-out illegal line becomes a test that the bootstrap emits that code; if a code is
  owned by the parallel typer agent and not yet emitted, mark the test `todo` with the code name, don't fake it).
- Extend the bite matrix (`slice-m3/bench/bite-matrix.js`) so each new construct is CERTIFIED: a named
  corruption of the construct must kill ≥1 runtime pass. An uncertified construct is not "done".
- Suites before/after: slice-m1, slice-m2, slice-m3, `bun conformance/run.ts` (impl#1 unchanged).
- Footprint grade before/after.
- Do NOT mark a program DONE without its run test and bite certification.

## 6. Report (final message)
WORKTREE_PATH · FINAL_SHA (== branch tip) · files-touched (every analyze.scrml hunk listed) · the survey table ·
per program: DONE / PARTIAL (stopped at X) / BLOCKED (OPEN id + needed ruling) · new constructs + bite
certification · suites + footprint before/after · rulings found ambiguous or mis-stated here · maps
load-bearing? · deferred items.
