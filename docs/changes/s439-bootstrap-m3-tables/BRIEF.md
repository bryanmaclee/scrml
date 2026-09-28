# BRIEF — s439-bootstrap-m3-tables (bootstrap M3 item 2: split the analyze tables by fact family + index by NodeId)

Dispatched S439-bryan. Agent: scrml-js-codegen-engineer, opus, isolation: worktree. Brief branch: `brief/s439-bootstrap-m3-tables`.
**PRECONDITION:** the typer (PR #1117, `feat/s439-bootstrap-m3-typer`) must be ON origin/main. Verify at startup: `grep -n "THE TYPER" compiler/self-host-v2/analyze.scrml` must hit. If it does not, STOP and report — do not start on the pre-typer tree.

## 0. STARTUP — CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; else STOP.
2. `git rev-parse --show-toplevel` == pwd; clean status; `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `git fetch origin brief/s439-bootstrap-m3-tables && git checkout FETCH_HEAD -- docs/changes/s439-bootstrap-m3-tables/`
4. `bun install`; `bun run pretest` (plainly, from the worktree CWD).
5. First commit `WIP(s439-bootstrap-m3-tables): start at $(pwd)` with BRIEF + empty progress.md.
Edit/Write only worktree-absolute paths; never write the main checkout; NEVER `git stash`; NEVER `pkill -f`/`killall`;
NEVER `--no-verify`/hook tampering. Commit after every unit + a progress.md line; code + tests in one commit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` → routing → structure/dependencies/test. The maps predate M2 and M3; verify against source.

## 1. The problem
`compiler/self-host-v2/analyze.scrml` records every node fact in ONE `Tables.facts: NodeFact[]` of a 22-variant `Fact`
enum, looked up by a LINEAR scan (`factOf`). Consumers (`lower.scrml`, the typer, `check.scrml`) therefore write total
`match` accessors that list all 22 variants to extract one family — M2 measured lower at 427 match-arm lines of 961 for
this reason, and the typer added ~1,500 lines largely of the same shape. dpa-051 §3.5 (read it: `../scrml-support/docs/
deep-dives/bootstrap-codegen-architecture-dpa-051-2026-09-26.md` §3.4–§3.5) requires facts either on the node or in a
side-table keyed by NodeId, produced by exactly one pass, immutable, passed together in ONE `Tables` record, and a
pass's signature naming the tables it consumes.

## 2. The task — an INERT refactor
Split `Fact` into per-family side-tables (e.g. names/references · writes · literals+operators · markup/uses · binders —
choose families by which CONSUMER asks, and justify each split in progress.md), each an enum small enough that its
consumer's `match` is naturally total, each indexed by NodeId for O(1)/O(log n) lookup instead of the linear scan.
Consumers ask the family table they need. Keep ONE `Tables` record carrying them. Keep §3.4 totality: every enum
`match` stays total, no default arms (the lint gates it).

**INERT is the acceptance bar — no behaviour change of any kind:**
- every Core oracle equal (`slice-m2/lower.test.js`, `SLICE_CORE=lowered` slice-m1);
- every diagnostic list byte-equal on: all slice programs + fixtures, every §66.19 block (BASE_66_19), and every probe
  set the typer's reviewers left (copy from `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/820ec157-101e-4471-8045-a73c0290c70f/scratchpad/typer-review-r3/.probe-r3/`
  if still present — else build a differential over the typer tests' own program sources);
- if `compiler/self-host-v2/ingest.scrml` / slice-m3 is on main when you start, the footprint grade must reproduce its
  numbers exactly (`bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint`).
Build the differential FIRST (capture base outputs before any edit), and re-run it after every commit.

## 3. Also required
- Update `slice-m1/bench/mutations.js` sites that move (it now exits 1 on a NOT RUN — keep it at 0 problems, all RED).
- Report the line counts before/after for analyze/lower/check (the point is to remove bloat — measure it), and the
  wall time of the slice suites before/after (the linear `factOf` scan is the suspected cost).
- Do NOT change what any pass computes, the Core IR, or any diagnostic. Do NOT grow the front end. Rule 7 applies.

## 4. Report
WORKTREE_PATH · FINAL_SHA · files · the family partition + rationale · differential totals (N programs, 0 changed
required) · line counts + wall times before/after · mutation-harness exit · suites + exit codes · maps load-bearing?
