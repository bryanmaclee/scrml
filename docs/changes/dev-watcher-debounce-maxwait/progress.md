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

## 2. Pins + fix

- Pin 1 (NEW `compiler/tests/commands/dev-watcher-churn-starvation.test.js`): real edit
  under 40 ms sibling churn must be DETECTED < 2 s. RED pre-fix: 0 pass 1 fail,
  "real edit NEVER detected under sibling churn" (Received: null after 8 s wait).
- Pin 2 (existing `dev-compile-throw-fail-closed.test.js` §3 atomic-save, TMP-name
  rename-over): GREEN pre-fix (3 pass 0 fail) — baseline recorded.
- FIX (`compiler/src/commands/dev.js`): MAX-WAIT bound on the debounce.
  - `WATCH_DEBOUNCE_QUIET_MS = 100` (named, was inline literal) and
    `WATCH_DEBOUNCE_MAX_WAIT_MS = 250` + `oldestPendingEventAt` beside `debounceTimer`.
  - `scheduleRecompile`: stamp oldest pending event; if it has aged >= 250 ms, run the
    sweep NOW (clear timer + clear stamp) instead of re-arming; else normal quiet-period
    re-arm. Sweep body extracted to named `async function sweepAndRecompile()` (unchanged
    logic, both paths call it). NO filename filter reintroduced; code comment records why
    max-wait beats a filter (enumerate-forever filename shapes vs bounded-by-construction).
- Post-fix: pin 1 GREEN (1 pass, 1.1 s incl. server startup); pin 2 GREEN (3 pass);
  PA harness re-run => TIME-TO-DETECT: 89 ms (sweep phase-dependent, bound ~290 ms worst
  case = 250 + one 40 ms churn interval). Commands tier full: 188 pass 0 fail (10 files).
