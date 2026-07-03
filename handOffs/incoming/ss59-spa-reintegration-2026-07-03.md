# ss59 sPA re-integration → PA

**List:** `spa-lists/ss59-conformance-reactivity-6.md` (conformance authoring — V5-strict reactivity §6 edges, freeze-gate foundational pillar #4)
**Branch:** `spa/ss59` · **tip:** `ee88c692` · **base:** `origin/main` @ `cfba6295` (7 commits ahead, 0 behind)
**Date:** 2026-07-03 · **Built:** sPA-direct in sibling worktree `../scrml-spa-ss59` (pure-additive `conformance/cases/reactive/` data — empirical golden-capture loop; full §6 SPEC pre-ingested)

## Landed (per-item)
| item | cases | status | SHA |
|---|---|---|---|
| 1 — compound Variant-C §6.3 (RT) | reactive/compound-variant-c | **landed** | `f50bdb73` |
| 2 — Shape-4 no-RHS typed defaults §6.2 (RT+codes) | reactive/shape4-{canonical-empty, struct-not-lifecycle, refinement-no-default, refinement-satisfied-neg} | **landed** | `d790b05a` |
| 3 — array reassignment reactivity §6.5 (RT) | reactive/array-reassign-reactive | **landed** | `ef54cd16` |
| 4 — default= / reset(@cell) §6.8 (RT) | reactive/reset-to-default, reset-compound-field, reset-compound-all | **landed** | `84eda797` |
| 5 — pinned §6.10 / hoisting §6.9 (codes) | reactive/pinned-forward-ref, hoist-forward-ref-neg, fn-mutual-recursion-hoist | **landed** | `618f1567` |
| 6 — debounce/throttle §6.13 (codes; trailing-RT bug-blocked) | reactive/debounce-on-{derived,server}, reactivity-attr-conflict, debounce-valid-neg | **landed** | `013a8f16` |
| close-out (progress SHA fill) | — | — | `ee88c692` (tip) |

**16 cases added: 72 baseline → 88, all green** (`bun conformance/run.ts`). **Parked:** none (all 6 items landed; the debounce/throttle TRAILING runtime is bug-blocked, see #2). **Dropped:** none.

## What landed
§6 V5-strict reactivity moves from SHALLOW (5 counter/interp/reset/toggle/derived cases) to edge-covered:
- **Compound Variant-C** (§6.3.2): `<formRes>` structural-child fields; dot-nav write updates the nested cell; fields snapshot under dotted keys (`formRes.name`).
- **Shape-4 typed no-RHS** (§6.2): canonical-empty defaults (int→0, string→"", bool→false, T[]→[]); bare-`:struct` read-before-assign → E-TYPE-001 (implicit `(not to T)`); refinement-violating `number(>0)` → E-REFINEMENT-NO-DEFAULT; satisfying `number(>=0)` clean.
- **Array reassignment** (§6.5.5): `@items = [...@items, x]` re-renders `<each>` + re-reads `.length` (DQ-2).
- **default= / reset** (§6.8): reset targets `default=` (distinct from init proves it); multi-level compound reset (field-only vs whole-compound, each field to its own default=).
- **pinned / hoisting** (§6.9/§6.10): pinned forward-ref → E-STATE-PINNED-FORWARD-REF; identical-minus-pinned hoists clean; `fn` mutual-recursion file-scope hoist.
- **debounce/throttle** (§6.13): the 3 reject codes (E-DEBOUNCED-WITH-DERIVED, E-REACTIVITY-ATTR-CONFLICT, E-DEBOUNCED-WITH-SERVER) + a valid-decl neg.

## Verification
- **88/88** conformance cases green at tip `ee88c692` (re-run standalone after the doc-only close-out commit).
- Each per-item commit passed the **full pre-commit suite** (the corpus-bridge runs the new cases on the gate).
- Golden-capture: every RT state/DOM assertion matched impl#1's actual output first-run; all cross-checked against the cited §.

## ESCALATIONS / NOTES (PA-facing — NOT decided by sPA)

### #1 — `reset` reserved-identifier NOT enforced (§6.8.2 vs impl) — possible divergence, OUT of list scope
§6.8.2: "`reset` is a RESERVED IDENTIFIER — declaring a local `function reset()` … is E-RESERVED-IDENTIFIER." But the **pre-existing** `conformance/cases/reactive/reset-handler` case declares `function reset() { @count = 0 }` and passes (72/72 baseline) — E-RESERVED-IDENTIFIER never fires. Surfaced incidentally while authoring Item 4 (I named my handlers non-`reset`). **PA ruling:** impl gap (enforce E-RESERVED-IDENTIFIER, then that existing case must rename) vs spec-relaxation. Not on this list; flagged only. My Item-4 cases use the `reset(@cell)` KEYWORD correctly and are clean.

### #2 — Item 6 runtime: CURRENCY CORRECTION + an open bug (NOT a new divergence)
The list said §6.13 timing runtime is "harness-gated on virtual-clock (deferred, driver.ts:19-21)". **STALE** — the virtual clock LANDED (`conformance-virtual-clock-2026-07-03`): `driver.ts` documents the ratified `{ "advance-time": N }` verb (fake-clock.ts) and `reactive/throttle-leading` already ships as a runtime case. So §6.13 is no longer harness-gated. The real blocker for the debounce/throttle **TRAILING** (coalesced) write runtime is the OPEN bug **G-DEBOUNCE-THROTTLE-TRAILING-NO-COMMIT** (docs/known-gaps.md, MED, S235) — the reactivity-bypass re-route re-arms the timer instead of committing the trailing value (confirmed with real timers, not a virtual-clock artifact). I did NOT author a trailing-fire runtime case (would enshrine the bug). **Follow-on** (already in known-gaps): once fixed, add debounce-trailing + throttle-trailing runtime siblings via `advance-time`. `reactive/debounce-valid-neg/NOTES.md` documents this at the site.

## Notes for the PA
- **Re-integration:** `conformance/cases/reactive/**` is pure-additive data (16 new dirs, disjoint from compiler source + sibling lists) — clean S67 file-delta onto main; confirm `bun conformance/run.ts` = 88/88 independently.
- **Worktree** `../scrml-spa-ss59` left in place (clean tree); `node_modules` symlinked → main. Remove at re-integration (`git worktree remove ../scrml-spa-ss59`).
- Branch based on `origin/main` @ `cfba6295` per the boot contract; local `main` may be ahead — file-delta applies cleanly regardless (pure-additive dirs).
- `spa-lists/ss59.progress.md` (on the branch) carries the full per-item log + both escalations with inline reproducers. Probe scripts were in the sPA scratchpad (session-local); the escalations/NOTES contain the exact snippets + observed codes.
