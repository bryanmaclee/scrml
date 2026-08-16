# progress — dev-watcher-debounce-maxwait (fix/dev-watcher-maxwait)

Append-only. Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a87ed219a82f83d80

## 1. Setup + RED reproduction (pre-fix)

- Worktree cut from origin/main; branch `fix/dev-watcher-maxwait` created from
  `origin/fix/dev-compile-throw-fail-closed` (d3c6cb1b) and rebased onto origin/main
  (c93a692c). FACTS.md conflict resolved by REGENERATING (`bun scripts/facts.ts --write`).
- Defect locus confirmed: `compiler/src/commands/dev.js` `scheduleRecompile` (~:1125) —
  `clearTimeout(debounceTimer)` + re-arm on EVERY dir event, no bound. Sibling churn at
  40 ms < 100 ms quiet period => the stat sweep never runs.
- PA churn harness re-run against THIS worktree (agent-unique copy, ephemeral port):
  `bun $SCRATCH/devchurn-a87/run.mjs $WORKTREE_ROOT $SCRATCH/devchurn-a87/app`
  => `TIME-TO-DETECT: NOT DETECTED within 12000 ms of churn`
  Reproduces the PA's STARVATION (never-detects), NOT the dead reviewer's bounded
  12,168 ms figure.
