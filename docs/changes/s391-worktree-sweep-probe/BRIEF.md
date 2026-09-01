# BRIEF — S391 worktree-sweep probe (scrml-js-codegen-engineer, isolation:worktree)

Archived verbatim per pa-base §5. Dispatched 2026-08-31 from main `63f4e3e5`.
The worktree is cut from `origin/main` so this file is not inside it; the brief is carried
inline in the dispatch prompt.

Builds the unbuilt fix for the OPEN MED gap
`g-wrap-6b-worktree-sweep-probes-branch-merged-which-file-delta-landings-never-satisfy`,
whose own locus records `searched:scripts/,compiler/scripts/ — no script implements wrap 6b;
the step is manual prose`. Owed since S268. Filed S326. Still unbuilt at S391.

## The premise, PA-VERIFIED by execution — do not re-derive, but DO re-check

The natural probe (`git branch --merged origin/main`, or `merge-base --is-ancestor`) answers
the WRONG QUESTION on this project. We land by copying file CONTENT onto a feature branch and
squash-merging, so an agent branch tip is NEVER an ancestor of `origin/main` even when its work
fully landed. PA-measured at S391 across all 81 non-protected worktrees: **77 "UNLANDED", 0
"LANDED and clean"** — which is not a backlog, it is a broken test.

The discriminator that DOES work is CONTENT, not ancestry. For each file the branch modified
relative to its own merge-base, compare the blob on the branch against the blob on
`origin/main`; if every one matches, the work landed.

PA-verified two-sided, on deliberately chosen controls:

| control | expectation | touched | content-unlanded |
|---|---|---|---|
| `worktree-agent-ab043497a0c7c809c` (maps, merged as #795 today) | LANDED | 13 | **0** |
| `worktree-agent-add7025319a51cbb9` (arc (b), deliberately retained) | HELD | 3 | **3** |

⚑ **One known noise source, and it must be excluded:** `progress.md` (and `BRIEF.md`) are agent
crash-recovery artifacts that never land by design. Before excluding them the LANDED control
read 1-of-14 unlanded; after, 0-of-13. Exclude by basename, and SAY SO in the output.

## Build

`scripts/worktree-sweep.ts`, following the conventions of the existing probes in `scripts/`
(`review-debt.ts`, `state.ts`, `dock.ts` are the nearest models — read them first and match
their output shape, flag style and exit-code discipline).

Requirements:

1. **DRY-RUN BY DEFAULT. The script MUST NOT delete anything, ever, in this increment.** It
   classifies and reports. Removal stays a separate, explicitly authorized act. A destructive
   default on a 100-workspace population is not recoverable.
2. **Cover BOTH populations.** `.claude/worktrees/agent-*` AND the sibling `scrml-spa-ss<N>`
   checkouts (e.g. `/home/bryan-maclee/scrmlMaster/scrml-spa-ss56`, branch `spa/ss56`). Use
   `git worktree list --porcelain`; do not assume a path shape.
3. **Classify each worktree** as: `SWEEPABLE` (content fully landed AND tree clean) ·
   `HOLDS-WORK` (content differs) · `DIRTY` (uncommitted changes — never sweepable regardless
   of content) · `PROTECTED` (an explicit keep-list) · `NO-BRANCH`/`GONE` (degenerate).
4. **Report its own totals as `N of M`.** A probe that enumerates a population can be silently
   truncated, and a truncated enumeration reads exactly like a complete one. Print the total
   scanned, and make any cap visible in the output rather than inferable from it.
5. **Per-row evidence.** For a `HOLDS-WORK` row, name how many files differ and list up to
   three. A row nobody can act on is a row nobody acts on.
6. **Exit code**: 0 always in dry-run. This is DETECTION, not a control — do not gate anything
   on it, and do not put it in CI. A gate that is instantly red over an existing backlog gets
   bypassed and then deleted.

## Verification you owe — the bite proof is the deliverable

A probe that has never been shown to discriminate is indistinguishable from one that cannot.

- Run it and confirm it classifies BOTH controls above correctly (the maps worktree
  `SWEEPABLE`, arc (b) `HOLDS-WORK` with 3 differing files).
- Confirm the `progress.md` exclusion is actually load-bearing: report the LANDED control's
  numbers WITH and WITHOUT the exclusion.
- Report the full classification counts across the whole population.
- Do NOT sweep. Do NOT remove a worktree or delete a branch. Report only.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Confirm `git rev-parse --show-toplevel` equals it, `git status --short` clean. Else STOP.
2. Absolute paths under YOUR worktree root for every write. Never relative, never main-rooted.
3. NEVER `cd` into the main checkout. `git -C "$WORKTREE_ROOT"`, `--cwd=<path>`.
4. NEVER `git stash` — `refs/stash` is SHARED across every worktree and the PA is live in main.
5. NEVER a bare `pkill -f` / `killall` on a shared command string.
6. `bun install` first. `bun --cwd <path> run <x>` with a SPACE silently no-ops at exit 0 — use
   `--cwd=<path>`; never judge a bun call by exit code alone, check the artifact.
7. ⚑ Your script INSPECTS other worktrees. Reading them is fine. Writing to them, checking out
   in them, or running `git worktree remove` is NOT — several hold live or deliberately
   retained work, including the PA's own.
8. Commit per unit, append-only `progress.md`.
