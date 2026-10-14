# BRIEF — s464-file-s462-gaps (docs-only; dispatched by S464 PA, 2026-10-12). change-id: s464-file-s462-gaps

## Task
The S462 wrap compiled a list of gaps to file; only ONE entry (unquoted `attr=@cell`, landed as #1406) was ever filed. The list survived and is at `/home/bryan-maclee/scrmlMaster/scrml-support/handOffs/s462-wip-patches/s464-salvage/s462-gaps-to-file.md` (41 lines; READ it from that absolute path — read-only). File every remaining entry into `docs/known-gaps.md` in YOUR worktree.

## How
- Read the head of `docs/known-gaps.md` and 3-4 recent `### g-…` entries to match the format exactly: a `### g-<kebab-slug> — <one-line symptom> — \`NEW S462; <SEV>; open\`` heading + an `<!-- @gap id=g-<slug> sev=HIGH|MED|LOW status=open locus=<file[:line] or searched:a,b> prov=<kind>:<pointer> -->` marker + a short body. Severities are ONLY HIGH / MED / LOW / NOMINAL.
- `locus=` is REQUIRED: a path where the behaviour is decided, or `searched:<files>` if you looked and found none. Spend a few minutes per entry locating it (grep), and say "located-not-traced" in the body unless you traced it.
- `prov=review:s462-<context>` (or what the list says).
- BEFORE filing each entry: check it is not already filed (grep the slug and the key symptom words in docs/known-gaps.md — S465 may have filed some) and that it still reproduces if it is cheap to check (a compile of a short snippet via `bun compiler/bin/scrml.js compile <file> --output-dir <scratch>`). Already filed → skip and list it. No longer reproduces on current main → file nothing, list it as "not reproduced" with the command.
- Then `bun scripts/state.ts --write` and `--check` (regenerates §0 counts).

## Rules
- Docs-only: touch ONLY `docs/known-gaps.md` and `docs/changes/s464-file-s462-gaps/`. Commit after every few entries; first commit archives this brief as `docs/changes/s464-file-s462-gaps/BRIEF.md` with message `WIP(s464-file-s462-gaps): start at $(pwd)`. Push branch `s464-file-s462-gaps` to origin at the end. `git merge origin/main` before the final push (keep both sides of gap entries; regenerate §0). Do NOT open a PR.
- Startup: `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` and equal `git rev-parse --show-toplevel`; else STOP. `bun install` in the worktree. Every write uses an absolute path UNDER your worktree; never write into `/home/bryan-maclee/scrmlMaster/scrml/` outside `.claude/worktrees/agent-…`, never into scrml-support. Never `git stash`, never `--no-verify`, never `pkill -f`. Scratch under `<worktree>/.tmp/` (delete before reporting).

## Report
Final SHA, branch pushed, entries filed (slug + sev + locus), skipped-as-already-filed, not-reproduced.
