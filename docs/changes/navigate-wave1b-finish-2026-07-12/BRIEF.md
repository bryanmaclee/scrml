# Finish Navigate Wave-1b — the 7 remaining S239 findings (S250's banked arc)

Wave-1b is the same-chunk soft-nav RUNTIME for the navigate() client router (#27). S250 built it
(M1 region-scope registry + outlet-resident timer teardown) and fixed findings #1/#2, but an S239
re-review left 7 findings open. Finish them, browser-verify, hold on the branch.

## Base
Fresh worktree merged `worktree-agent-ad18282b8c9c2cc10` (banked Wave-1b, already carrying current
main `47ea59ac` = reactive-split + #26 + conformance). Merge fast-forwarded to `d17bcace`; both
ancestry gates confirmed (`9c8150fb` in history, `47ea59ac` an ancestor).

## The 7 findings (S250 fix plan) + verify tasks
- #5 SHOWSTOPPER — persistent shell resets on soft-nav (rehydrate seed-apply un-scoped).
- #7 leak — `<keyboard>`/`<mouse>`/`<gamepad>` handlers inside an outlet leak on swap.
- #4 small — `_scrml_nav_focus` no-op (heading has no tabindex).
- #6 small — nav-race: re-check nav token inside `startViewTransition(swap)`.
- #8 perf — `_scrml_find_if_marker` per-marker TreeWalker.
- #9 cleanup — dedupe `_scrml_nav_sync_meta`/`_link`.
- #3 DEFERRED — outlet `<timer>`/`<poll>` stops on nav-away but does not restart on return.
- verify-#1 — confirm a `.Hard` / soft navigate in a match value-arm each lower to the correct mode.

## OUTCOME (this dispatch — held on branch for PA S239 re-review)
- #5 FIXED (df35961f) — compile-time `_scrml_shell_cells` (server-authority cells outside the
  outlet/page region) + `_scrml_ssr_seed_apply(skipShell)`; rehydrate skips shell cells, initial
  load seeds all. Browser-proven: a mutated shell cell survives the nav; seed_apply(false) resets it.
- #7 FIXED (1ec0c43f) — input-state nodes get the `_outletResident` treatment; outlet-resident
  destroy routes into `_scrml_region_cleanups`. Browser-proven: outlet `<keyboard>` listener removed
  on swap; shell `<keyboard>` survives.
- #4 FIXED (9d2ce117) — tabindex="-1" on the focus target (not just the outlet); [autofocus] left native.
- #6 FIXED (345d17a8) — nav token threaded into `_scrml_nav_apply_html`, re-checked at swap top.
  Browser-proven with a deferred startViewTransition shim.
- #9 FIXED (7b0c6741) — folded into `_scrml_nav_sync_head_el(doc, selector, tag, keyAttr, valueAttr)`;
  first browser coverage for the head-sync path.
- #8 DEFERRED — a validated marker cache is clean + correctness-preserving, BUT it lands in a SHARED
  runtime chunk the SPA counter includes even with no `if=`, pushing the shared-runtime gzip 140 B
  over the hard 16 KB gate (pre-#8 margin was only 205 B). Deferring per the MINIMAL-runtime
  discipline + the finding's "skip if it risks..." latitude. Proper home: after the `if=` chunk is
  tree-shaken out of non-`if=` apps (out of scope).
- #3 DEFERRED (by design) — leak already closed by S250 Phase 4; restart-on-return needs the timer
  wiring lifted from module-init into a re-invocable rehydrator (the invasive insideOutlet
  emit-html→emit-reactive-wiring thread S250 started). Not half-done under margin pressure.
- verify-#1 → NEW SECURITY-ADJACENT BUG FOUND + FIXED (2489ef43, separable for re-review). A
  `.Hard` navigate inside a `match` value-arm silently soft-navved: the arm path re-serializes the
  modifier with an interior space (". Hard"), which `rewriteNavigateCalls` (rewrite.ts Pass 11) did
  not match. Fix: whitespace-normalize the modifier before the match. False-positive guarded
  (navigate("Hard") stays a soft path). if/else + sequential paths were already correct.

## Gates
unit+integration 19143 pass / 0 fail; conformance 881 pass / 0 fail + oracle 386/386; navigate
browser suite 22 pass. The 12 pre-existing full-browser-suite failures (render-by-tag / each
per-item markup-value / text-interp lift) are IDENTICAL on the merge base d17bcace — not regressions.
