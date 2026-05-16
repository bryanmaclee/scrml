# Pre-existing TodoMVC browser tree-shake bug — S96 dispatch candidate

**Filed:** 2026-05-16 (S95 wrap)
**Severity:** Medium-High — 38 browser tests failing; blocks pre-push gate without `--no-verify`
**Status:** dispatch candidate for S96
**Surfaced through:** S95 bug-fix dispatch wave — confirmed pre-existing by 3 separate agent revert-and-rerun verifications (Bug 17, Bug 5, Bug 2 agents each independently reverted their own changes and confirmed the failures persisted)

---

## Symptom

Running `bun run test` produces 38 failures in `compiler/tests/browser/browser-todomvc.test.js`. Sample fail:

```
(fail) TodoMVC §1: initial render — HTML structure > HTML contains .main section[data-scrml-bind-if]
ReferenceError: _scrml_reconcile_list is not defined
    at <anonymous> (compiler/tests/browser/browser-todomvc.test.js:1088:57)
```

All 38 failures share the same root cause: `_scrml_reconcile_list` is not defined in the emitted runtime that the browser test loads.

## Root cause

`_scrml_reconcile_list` is **defined** in `compiler/src/runtime-template.js` at approximately line 938 (verify exact line at dispatch time). It is **missing** from the emitted `dist/scrml-runtime.*.js` chunks for TodoMVC.

**This is a tree-shake bug in the chunked runtime emission.** When the v0.3 Approach A runtime chunking determines which runtime functions to include in a given app's runtime bundle, `_scrml_reconcile_list` is being elided incorrectly. The function is needed (TodoMVC's `<ul>` iteration emits a call to it), but the tree-shake analysis is missing the call-site reference.

## Where to start (PA's pre-investigation)

1. **Confirm the function is defined in the runtime template.** `grep -n "_scrml_reconcile_list" compiler/src/runtime-template.js` should find its definition.
2. **Confirm the function is missing from the TodoMVC dist.** Compile TodoMVC then `grep -n "_scrml_reconcile_list" benchmarks/todomvc/dist/scrml-runtime.*.js` — should find usage but no definition.
3. **Find the tree-shake reference-tracking site.** Likely in `compiler/src/codegen/runtime-chunks.ts` or adjacent — wherever the chunk decides which runtime helpers to include based on the app's emitted client.js usage. The bug is probably:
   - The reference-tracker doesn't recognize the call-site shape (`_scrml_lift_target.appendChild` followed by `_scrml_reconcile_list(...)` may pattern-mismatch the recognizer), OR
   - The function has a missing "needed-by-X" annotation in the runtime template's metadata, OR
   - A recent runtime-chunks edit (perhaps from Bug 18's stdlib-chunks work) introduced a regression in the reference tracker

## Verification context

Three independent verifications during S95 dispatches confirmed pre-existing:

- **Bug 17 agent:** *"verified pre-existing by reverting fixes and re-running — same 38 failures occurred when reverting emit-lift.js to ec12412"*
- **Bug 5 agent:** *"38 pre-existing failures in compiler/tests/browser/browser-todomvc.test.js. Verified pre-existing; unrelated to Bug 5 surface."*
- **Bug 2 agent:** *"Pre-existing TodoMVC browser failures (_scrml_reconcile_list is not defined): verified pre-existing by reverting fixes and re-running — same 38 failures occurred when reverting emit-lift.js to ec12412."*

**Caveat:** the S94 close hand-off claimed "12,826 pass / 117 skip / 1 todo / 0 fail / 650 files / 42,968 expect (full bun run test chained pretest)." If that claim is accurate, the failures were introduced sometime between `ec12412` (S94 close) and the start of the S95 bug-fix wave. Possible explanations:

1. **S94 hand-off claim was actually a subset run** (unit + integration + conformance), not full `bun run test`. Browser tests excluded. The 38 failures may have existed at S94 close but were invisible to the claimed test command. Most likely explanation.
2. **A commit between ec12412 and S95-start introduced the regression.** Less likely; nothing landed between S94 close and S95 start.
3. **Test environment flakiness** (happy-dom timing, etc.). Possible but agents reproduced consistently via revert.

The dispatch should not assume any of these; the dispatched agent should `git bisect` if needed to identify the actual introduction point.

## Why this matters

- **Blocks pre-push gate.** Every push requires `--no-verify` until fixed. Pre-push gate is meant to be load-bearing.
- **Hides regressions.** If pre-push is bypassed routinely, a real regression introduced after this bug becomes much harder to detect.
- **Adopter-shape concern.** TodoMVC is the canonical "does this language work" benchmark. If `_scrml_reconcile_list` is missing from TodoMVC's runtime, then any adopter app with `<ul>` iteration (which is most of them) has the same tree-shake gap, just maybe with different symptoms.

## Dispatch shape recommendation

**Agent:** `scrml-js-codegen-engineer` with `isolation: "worktree"` per S95 hardened path-discipline protocol.

**Brief skeleton:**

1. Standard F4 startup verification + path-discipline block (use the hardened version from S95 dispatches — see `feedback_agent_main_repo_path_leak.md`).
2. Maps reference (will need refresh; HEAD at S96-start).
3. Required pre-reads: `compiler/SPEC.md` §47 + §40.9 (chunking), `runtime-chunks.ts` source.
4. Reproducer: `bun run test compiler/tests/browser/browser-todomvc.test.js` from main; observe 38 failures.
5. Investigation steps (as above).
6. Fix: ensure `_scrml_reconcile_list` is included in TodoMVC's emitted runtime chunk.
7. Regression test: post-fix, full `bun run test` should produce 0 fails (or document any other unrelated failures separately).
8. Commit discipline + final-report format per the S95 brief template.

## Adjacent concerns to consider during dispatch

- **Are other runtime functions also missing?** Audit the full set of runtime helpers + verify each is referenced by at least one needed-by-X annotation OR there's a fall-through "always include" set.
- **Is the bug introduced by Bug 18's stdlib chunks work?** Bug 18 added new `stdlib-<name>` chunks to `runtime-chunks.ts`. If that touched the reference-tracking shape, the tree-shake regression might trace to Bug 18 specifically. `git bisect` between `ec12412` (S94 close) and `f57d881` (Bug 18 landing) would isolate it.

## Cross-references

- `docs/changes/heads-up-s95-bugs/FOLLOWUPS.md` — main S95 bug catalog
- `docs/changes/heads-up-s95-bugs/bug-17-progress.md` — first agent confirmation
- `docs/changes/heads-up-s95-bugs/bug-5-progress.md` — second confirmation
- `docs/changes/heads-up-s95-bugs/bug-2-progress.md` — third confirmation
- `hand-off.md` S95 CLOSE — "Process incident: rebase silently dropped 8 commits" (separate concern, also surfaced this session)
- `pa.md` §"Per-machine setup — git hooks (S78 baseline + S88 amendment)" — pre-push gate rules; `--no-verify` standing rule

## Tags

#s96-dispatch-candidate #pre-existing #tree-shake #runtime-chunks #todomvc #pre-push-gate-blocked
