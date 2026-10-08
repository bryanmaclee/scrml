# s459-hgs-thrown-by-name — host-global-scan: pin the known-throwing units by NAME, not a count

## STARTUP (stop and report if any fails)
1. `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (=WT); toplevel == WT; clean tree; `bun install`; `bun run pretest` plainly from WT.
2. Absolute WT paths only; never `cd` into the main checkout; never `git stash`; no pattern `pkill`. Scratch under $HOME/.cache/scrml-agent-tmp/s459-hgs-thrown.
3. Copy this brief to `$WT/docs/changes/s459-hgs-thrown-by-name/BRIEF.md`; progress.md beside it; commit after each change; pre-commit hook always (never --no-verify).
Base: `git -C "$WT" fetch origin && git -C "$WT" checkout -B s459-hgs-thrown origin/main` (6fcde7f7e, includes the host-global alias #1361).

## The defect (S459 review, LOW-2, read from code)
`scripts/host-global-scan.ts` lists thrown compiles but gates only `thrown.length > THROWN_CEILING` (119). A newly-throwing unit (its artifacts then go UNCHECKED by R1–R4) can hide behind a known thrower getting fixed: the count stays ≤ 119 and the gate exits 0.

## Fix
Replace the count with a pinned SET of `[mode] <unit-path>` keys (a small data file next to the script, e.g. `scripts/host-global-scan.known-throws.txt`, sorted, one per line, each with the error class as a trailing comment). The gate: exit non-zero (same code the ceiling used) on ANY thrown key not in the set; print keys in the set that NO LONGER throw as an informational "fixed — remove from the list" line (do NOT fail on those — removal is the lower-only direction; optionally a `--prune` flag rewrites the file). Seed the file from a full `--check` run on main. Prove the bite on a scratch COPY of a corpus unit you make throw (e.g. a source that triggers the known esm `emit-client-esm` throw added under a temp path the scan covers — or by injecting a throw via an env var hook if the script has one): new key → red; restore → green. Update the CI comment in .github/workflows/ci.yml if it mentions the ceiling. Keep the script's runtime about the same.
Final report: WT, SHA, files, the seeded key count (expect 119), bite proof (executed), CI step unchanged. Do NOT push.
