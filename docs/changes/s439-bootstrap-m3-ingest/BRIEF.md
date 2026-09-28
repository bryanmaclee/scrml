# BRIEF — s439-bootstrap-m3-ingest (bootstrap M3 item 3: ingest shim + conformance-FOOTPRINT harness)

Dispatched S439-bryan, 2026-09-27. Agent: scrml-js-codegen-engineer, opus, isolation: worktree.
Brief branch: `brief/s439-bootstrap-m3-ingest`. A SIBLING dispatch (`s439-bootstrap-m3-typer`) is concurrently
editing `compiler/self-host-v2/analyze.scrml` + `slice-m2/typer*.test.js` + `slice-m1/bench/mutations.js`.
**You MUST NOT edit those files** (ingestion-disjoint invariant). If you find you need to, STOP and report.

## 0. STARTUP — CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; else STOP, report, exit.
2. `git rev-parse --show-toplevel` == pwd; `git status --short` clean.
3. `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main`.
4. `git fetch origin brief/s439-bootstrap-m3-ingest && git checkout FETCH_HEAD -- docs/changes/s439-bootstrap-m3-ingest/`
5. `bun install`, then `bun run pretest` plainly from the worktree CWD (`bun --cwd <p> run` SILENTLY no-ops).
6. First commit `WIP(s439-bootstrap-m3-ingest): start at $(pwd)` with BRIEF + empty progress.md.
Edit/Write ONLY worktree-absolute paths; never `cd` into / write the main checkout; NEVER `git stash` (shared
across worktrees); NEVER `pkill -f`/`killall` (kill by captured PID); NEVER `--no-verify` / hooksPath tampering.
Commit after every meaningful unit + a timestamped progress.md line; code + its tests in ONE commit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `9941a504c`) → Task-Shape Routing → structure / dependencies / test maps.
⚑ The maps predate #1109 (bootstrap M2) — treat as verify-against-source. Report whether they were load-bearing.

## 1. Why (the problem this solves)
The conformance corpus (`conformance/cases/**`, 1063 `.scrml`) is the language gate (§62.2). It is written in
pre-§66 syntax that the bootstrap front end (`compiler/self-host-v2/parse.scrml`) does not parse, so TODAY NOTHING
CAN GRADE THE BOOTSTRAP ON THE CORPUS. dpa-051 (ruled R5, S437: "build the throwaway ingest shim now") gives the
answer: `../scrml-support/docs/deep-dives/bootstrap-codegen-architecture-dpa-051-2026-09-26.md` §8.2 (module-done by
conformance footprint), §8.3 (the ingest shim), §8.4 (emit order), §8.5 (runtime). READ §3, §5, §6, §8 IN FULL.

## 2. What to build
**(a) The ingest shim** — a scrml module in `compiler/self-host-v2/` (e.g. `ingest.scrml`): impl#1's `FileAST` +
tables (what the CG stage receives) → the bootstrap's Core (`core.scrml`). It is the ONE sanctioned early hybrid:
confined to that module, NEVER graded by parity with impl#1's output (S337), deleted when bootstrap `analyze`
produces a TypedProgram for the corpus — put that deletion condition in the module header. It may re-parse
impl#1's text arms where it must (a contained PARSE_REENTRY) — record every such site in progress.md.
Legacy forms map to their §66 Core meaning per SPEC §66.21 (the retired-form table): `<x> = v` → a cell with the
transitional all-grant; `const <x> = e` → locked+reactive initializer (derived); components → declarations;
`<engine>` → a `single` declaration with a field transition graph. A legacy shape with no Core mapping yet →
the case is `not-yet` (never a guessed mapping).
**(b) A CG substitute** that wires ingest → Core → the bootstrap printer (`print.scrml` + the M1 runtime) and
returns the `FileOutput` shape through the EXISTING stage seam: `compiler/src/pipeline-seam.ts` (the `CG` entry,
`runCG`), `conformance/adapters/hybrid.ts`, `scripts/hybrid.ts --swap CG=<module> --conformance` (#1044). Reuse that
machinery; do not build a second harness.
**(c) The FOOTPRINT grader** (dpa-051 §8.2): for each case, compute the set of Core constructs its ingested Core
uses; a case whose footprint lies within the implemented set is GRADED (pass/fail on the case's own
expected.json — codes half + runtime half, via the existing runner); a case outside it reports `not-yet`, never
red. Output a table: implemented construct set · graded / pass / fail / not-yet counts · the fail list with the
first-diverging reason per case · the top not-yet constructs by case count (that list IS the M3/M4 work queue).
Make the grader report its own totals (`N of M`) so a truncated run is visible.

## 3. Phase 0 — measure before you build (write the result to progress.md, then CONTINUE)
Before writing the shim, measure: which impl#1 AST node kinds appear across the 1063 cases, how many cases each
kind appears in, and which of those have an obvious Core counterpart today. Estimate the graded fraction the
first slice can reach. If the measurement shows the shim cannot grade ANY meaningful slice (e.g. <25 cases), STOP
there and report the measurement — do not build a shim that grades nothing. Otherwise continue.

## 4. Scope limits
- TS changes: only what the seam needs (a small TS change is allowed under the "one customer" policy — the TS
  compiler serves the bootstrap). No behaviour change to impl#1's default pipeline: the full suite must be
  byte-identical with the hybrid NOT installed.
- Rule 7: no source-text scanning post-parse except the recorded PARSE_REENTRY sites inside the shim.
- Every enum `match` total (the no-default-arm lint).
- Do NOT touch the frozen `compiler/self-host/`, `compiler/native-parser/`, or the sibling's files (top).
- Human-quality scrml, following the idioms in core.scrml / lower.scrml / print.scrml.

## 5. Verification (do not mark DONE without all)
1. The grader run: the full table above, with exit code, committed as `docs/changes/s439-bootstrap-m3-ingest/footprint-<date>.md`.
2. Every GRADED case that passes is really executed (runtime half reads the post-run live DOM through the
   bootstrap's output) — prove it with one deliberate corruption of the printer that turns graded passes RED, then restore.
3. Existing suites green: `bun test ./compiler/self-host-v2/slice-m1/`, `./compiler/self-host-v2/slice-m2/`,
   `SLICE_CORE=lowered bun test ./compiler/self-host-v2/slice-m1/`, the v2 lexer tests, the no-default-arm lint,
   `bun conformance/run.ts` on pure impl#1 (unchanged count), and the pre-commit hook.
4. A test for the ingest module over at least 5 cases' Core (structural), and one for the grader's classifier
   (a synthetic case in, a synthetic case out → not-yet).
5. Read exit codes directly; prove each probe can see a difference.

## 6. Final report
WORKTREE_PATH · FINAL_SHA (== tip) · files touched · Phase-0 measurement · the footprint table · PARSE_REENTRY
sites · legacy shapes left not-yet and why · TS lines changed and proof the default pipeline is unchanged ·
suite counts + exit codes · maps load-bearing? · surfaced-not-done.
