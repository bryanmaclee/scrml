# Anomaly Report: fix-lift-async-iife-paren

Comparison against `pre-snapshot.md` recorded before any code changes.

## Test Behavior Changes

### Expected
- `compiler/tests/unit/request-tag-and-server-fn-reactive.test.js`: +5 test cases in new §6 block. All pass after fix. Total test count: 11463 → 11468 (+5). Matches expectation.
- All previously passing tests still pass. 0 regressions.

### Unexpected (Anomalies)
- None.

## E2E Output Changes

### Expected
- `examples/dist/18-state-authority.client.js`: now parses as valid JS. Lines 159–160 now read `await ((async () => _scrml_reactive_set(...))())` instead of `await ((async () => _scrml_reactive_set(...))();)`. Line 78 (statement-context IIFE wrap) is UNCHANGED — still emits trailing `;`. Both are correct.
- 16/21 example client.js parse pass (up from 15/21 baseline). The newly-passing file is 18-state-authority.
- The 5 remaining client.js parse failures (07-admin-dashboard, 05-multi-step-form, 21-navigation, 13-worker, 12-snippets-slots) are all pre-existing per the pre-snapshot and are unrelated to this bug.

### Unexpected (Anomalies)
- None.

## New Warnings or Errors

None. Compiler warning/error counts on 18-state-authority unchanged (still emits W-DEAD-FUNCTION on `addTask` and W-AUTH-001 on `@tasks` — both pre-existing and not related to this bug).

## Out-of-Scope Observations

While diagnosing, I noted but did NOT fix:

1. **`on mount` block generating a markup placeholder.** The 18-state-authority example emits `<span data-scrml-logic="_scrml_logic_6"></span>` before `<div class="tasks">` despite the `on mount { @tasks = loadTasks() }` having no markup-rendering intent. Whatever stage routes this to reactive-display wiring is likely a separate bug. The S84 fix here makes the *emitted JS valid* regardless, but does not address why the placeholder exists. This deserves its own ticket.

2. **5 other example client.js parse failures.** Pre-existing per pre-snapshot. Should be filed as separate anomalies if not already tracked.

3. **The original ticket framed this as a "lift+async" bug.** The actual root cause is in GITI-001 (server-fn-call rewrite), not in lift codegen at all. The `lift <li>` in the example was a red herring. The bug fires for any markup expression involving a `@var = serverFn()` assignment, with or without `lift`.

## Anomaly Count: 0
## Status: CLEAR FOR MERGE

## Tags
#tag-pipeline-anomaly-report #tag-s84 #tag-fix-lift-async-iife-paren

## Links
- PRE-SNAPSHOT: /home/bryan/scrmlMaster/scrmlTS/docs/changes/fix-lift-async-iife-paren/pre-snapshot.md
- PROGRESS: /home/bryan/scrmlMaster/scrmlTS/docs/changes/fix-lift-async-iife-paren/progress.md
- FIX: /home/bryan/scrmlMaster/scrmlTS/compiler/src/codegen/emit-client.ts:892-905
- TEST: /home/bryan/scrmlMaster/scrmlTS/compiler/tests/unit/request-tag-and-server-fn-reactive.test.js (§6)
