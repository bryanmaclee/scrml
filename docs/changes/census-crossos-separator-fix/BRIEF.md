# BRIEF — census-crossos-separator-fix (S345-bryan dispatch)

DONE-PROBE: `bun scripts/source-text-regex-census.ts --summary` exits 0 AND `grep -c 'split(sep)\|sep,\|from "path"' scripts/source-text-regex-census.ts` finds separator normalization present (win32-shaped unit check in the test or script self-check passes)

## Task
Fix the cross-OS separator bug in `scripts/source-text-regex-census.ts` reported by S344-peter
(gap `g-source-text-regex-census-crossos-separator-misclassifies-preast`, MED). Verified by PA
at dispatch time (locus held):

- `ROOT` is built with `join()` (platform separators); `rel = f.replace(ROOT + "/", "")` (line ~99)
  hardcodes `/`, so on Windows the strip never matches and `rel` stays the full absolute
  backslash path.
- `PRE_AST_MARKERS` (lines ~60-64) contain `/`-separated entries (`"native-parser/"`,
  `"commands/migrate"`, `"commands/promote"`); `rel.includes(p)` then fails on Windows →
  `commands\migrate.js` (27 hits) + `commands\promote.js` (2) counted POST-AST instead of
  PRE-AST. Headline becomes OS-dependent: 261/51 (Windows) vs 232/49 (authority host).
  Also the by-file listing leaks absolute `C:\Users\...` paths (LOW corollary).

## The fix
Normalize separators ONCE so both the strip and the marker match operate on forward-slash
relative paths regardless of OS. Peter's suggested shape (adapt as you see fit, keep it minimal):

    import { sep } from "path";
    const rel = f.split(sep).join("/").replace(ROOT.split(sep).join("/") + "/", "");

Prefer normalizing ROOT once outside the loop. Do NOT change any classification logic,
marker list, regex, or output format beyond the separator normalization.

## Verification (required before DONE)
1. On THIS host (Linux) the fix MUST be a no-op: capture `bun scripts/source-text-regex-census.ts --summary`
   output BEFORE your edit and AFTER — byte-identical (or diff-clean modulo nothing). Report both.
2. Windows-shape check without Windows: extract the rel-computation into a small pure helper
   (e.g. `toRel(absPath, root, sepChar)`) and add a direct check (inline test file under
   `compiler/tests/unit/` or a self-check invoked by a `--selftest` flag — your call, smallest
   footprint wins) that feeds a `C:\\Users\\x\\scrml\\compiler\\src\\commands\\migrate.js`-shaped
   path with `\\` sep and asserts it classifies PRE-AST and rel is relative + forward-slash.
3. `bun scripts/source-text-regex-census.ts --json` still parses as JSON.

## Discipline
- isolation: worktree. FIRST ACTION: `pwd` — must start with
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel`
  must equal it; clean tree. If ANY check fails: STOP, report, exit. Echo the pwd in your first
  commit message (`WIP(census-crossos): start at $(pwd)`).
- `bun install` at startup (worktree does not inherit node_modules; pre-commit needs acorn).
- Edit via Edit/Write on WORKTREE-ABSOLUTE paths only. Never cd into or write to
  `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). No heredoc/redirect writes.
- Commit after every meaningful edit (WIP commits expected); append-only timestamped
  `progress.md` in the worktree root; NEVER `--no-verify`.
- Maps note: `.claude/maps/primary.map.md` stamp is 6+ commits stale — not load-bearing for this
  single-file scripts/ change; do not chase it.
- Report at end: FINAL_SHA, branch name, files touched, before/after --summary output, whether
  the PA-held locus survived or was refined.
