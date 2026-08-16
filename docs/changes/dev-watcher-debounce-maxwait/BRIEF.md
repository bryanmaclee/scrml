# BRIEF — dev watcher: bound the debounce (max-wait) — fix round on `fix/dev-compile-throw-fail-closed` (S346-bryan)

DONE-PROBE: grep -qiE 'maxWait|MAX_WAIT|oldestPending' compiler/src/commands/dev.js && ls compiler/tests/commands | grep -qiE 'starv|churn|maxwait'

## The regression you are fixing (PA-REPRODUCED — do not re-derive, but DO re-run it)
The branch's watcher half starves hot-reload. **A/B measured by the PA against the real dev server:**

| tree | time to detect a real `.scrml` edit under continuous sibling churn |
|---|---|
| pre-fix `2709e540` | **102 ms** |
| this branch `d3c6cb1b` | **NEVER** — nothing after 12 s |

Harness: `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/67fa3513-8c61-4244-ab2c-8460d0cdd9af/scratchpad/devchurn/run.mjs`
(re-derive if gone: spawn `dev <app>/entry.scrml --port 0`, append to a sibling `noise.log` every 40 ms,
then rewrite `entry.scrml`, and time the `[dev] Change detected` line).

**Mechanism.** Removing the `.scrml` filename filter is CORRECT and must STAY removed — an editor's
atomic save is reported under its TMP name, and a directory event may carry no name at all; that was the
bug the branch set out to fix. The defect is that `scheduleRecompile` is an **unbounded debounce**:
every event does `clearTimeout(debounceTimer)` then re-arms. With no filter, any sibling write in a
watched directory re-arms it forever and the stat sweep never runs. Real triggers: an appended log, a
test watcher, `dist/` output when `-o` is the source dir, an editor's swap/backup churn.

## The fix (ruled by the PA — implement it, do not re-open it)
**Add a MAX-WAIT bound to the debounce.** Record the timestamp of the OLDEST pending (un-swept) event;
when a new event arrives and that timestamp is older than the bound, run the sweep NOW instead of
re-arming. Keep the existing quiet-period debounce for the normal case. Bound: **250 ms** (state it as a
named const with a one-line rationale). Do NOT reintroduce a filename filter. Do NOT make the sweep
cheaper as the fix — the sweep is already correct and returns early when no watched source changed;
the bug is that it never RUNS.

**Why max-wait and not a filter** (record this in the code comment): a filter must enumerate every shape
an event's filename can take (real name, TMP name, null, platform variance) — the enumerate-forever
shape. A max-wait is immune to filename shape entirely and bounds worst-case latency by construction.

## Pins (both must be RED before the fix, GREEN after — prove it and paste the output)
1. **Starvation pin** — the A/B above, as a test in `compiler/tests/commands/`: under continuous sibling
   churn a real source edit is detected within a bounded time (assert < 2 s; the bound is 250 ms + compile).
   RED on `d3c6cb1b` (never detects), GREEN after.
2. **Atomic-save pin must still pass** — the branch's existing `dev-compile-throw-fail-closed.test.js`
   atomic-save case (a save reported under a TMP name) MUST stay green; the max-wait must not
   reintroduce the missed-save bug. If the branch has no such case, add one.
Run `bun test compiler/tests/commands` (that tier is EXCLUDED from pre-commit — run it yourself) plus the
contract gate `bun test compiler/tests/{unit,integration,conformance}` 0 fail.

## Also in scope (small, from the same dead review — verify each, report if it does not reproduce)
- The reviewer claimed a **12,168 ms vs 119 ms** figure; the PA measured *never-detects* instead. If your
  run reproduces a bounded number rather than starvation, SAY SO with the command — the difference
  matters for the ledger entry.
- Confirm the `-o` = source-dir case does not loop: run dev for 30 s with output into the watched dir and
  COUNT compiles (expect 1).

## OUT OF SCOPE
The fail-closed half (`runOnce` try/catch → `noteCompileResult`) is SOUND — do not touch it. `api.js`.
`docs/known-gaps.md` (PA-owned). Do not split the branch.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` §"Task-Shape Routing" + `build.map.md` (commands) + `test.map.md` (the
commands tier is `tracking`-only, NOT pre-commit — that is why pins also live in the unit tier). Stamp
`4f034e13`; main has since moved to `c93a692c` (#537 ghost-lint perf, #536 issue-debt, #535/#538 docs).

## Mechanics (STARTUP VERIFICATION + PATH DISCIPLINE)
isolation: worktree. FIRST `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`;
toplevel equals it; clean tree; else STOP. `bun install`.
**⚑ The worktree is cut from `origin/main`, NOT from any local branch** (S346 finding). So:
`git fetch origin && git checkout -b fix/dev-watcher-maxwait fix/dev-compile-throw-fail-closed && git rebase origin/main`
(resolve any `docs/FACTS.md` conflict by REGENERATING: `bun scripts/facts.ts --write`, never by picking a side).
Then fetch this brief: `git checkout origin/s346/delta-1514 -- docs/changes/dev-watcher-debounce-maxwait/` if it is absent.
Edit/Write on WORKTREE-ABSOLUTE paths only; never the main checkout; `bun --cwd`, `git -C`. Echo pwd in
the first commit; commit per unit; append-only `docs/changes/dev-watcher-debounce-maxwait/progress.md`;
NEVER `--no-verify` and NEVER a `core.hooksPath` override; commit timeout ≥ 8 min; push `-u origin
fix/dev-watcher-maxwait` early + at end. Use an EPHEMERAL port (0) in every test — other agents share this box.

## Final report (raw data)
FINAL_SHA · branch · files touched · the max-wait const + where · both pins' RED output then GREEN ·
whether the 12,168 ms figure or starvation reproduced · the `-o`-in-source-dir compile count · maps finding.
