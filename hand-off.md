# scrml — Session 250 (WRAP) — concurrent→leading; commit-lock built; navigate #27 arc (1a landed, 1b banked)

**Date:** 2026-07-11→12. **Profile:** A (`/boot concurrent` → took the baton → LEADING). Enormous session.
Booted concurrent to S249, took the branch-baton (S249 wrapped+released), became the single writer to main.
**Commit-lock released at this wrap** — next boot: `commit-lock.sh status <uuid>` → FREE → acquire.

## ⚠️ READ FIRST
- **PUSH STATE:** origin/main = **`ac22895e`** (Wave-1a). Everything landed this session is PUSHED (main, scrml-support, flogence all coherence 0/0). No unpushed main work.
- **COMMIT-LOCK RELEASED** (S250). The lock (`scrml-support/handOffs/active-sessions/commit-lock.sh`) is the who-owns-main signal — boot runs `status <your-session-uuid>` FIRST (Discipline step 0), never infer from ps. See [[feedback_commit_lock_main_authority]] + [[feedback_browser_test_regression_triage]].
- **S251 is a LIVE concurrent PA** on its own worktree/branch `s251` (bryan's concurrent workflow). It stays off main. Coordinate via the board + the lock.
- **🔴 Navigate Wave-1b is BANKED, NOT landed** — see the dedicated section. Branch `worktree-agent-ad18282b8c9c2cc10` @ `9c8150fb`.

## ✅ LANDED + PUSHED this session
- **Commit-lock mechanism** (NEW, scrml-support) — explicit single-writer mutex on main's HEAD (mkdir FS-mutex + claims.md CAS row + heartbeat-lease). Hardened twice live: `heartbeat` auto-heals a dead pid (the S251-false-crash class); `session_uuid` in the holder for deterministic identity; README §COMMIT-LOCK + Discipline step 0. Routed to flogence for the flobase continuity module.
- **S249's 58-commit verify-harden wave** — merged s249→main + PUSHED (`a37f11e0..ac22895e`), incl. **2 security fail-opens** (JWT auth-bypass, protect-CTE leak) now on origin.
- **Navigate #27 SPEC §20.8** — the Client Router, Nominal/spec-ahead (`3f4d3917`, pushed). Full axis-by-axis design ruled + banked (scrml-support/docs/deep-dives/navigate-soft-nav-*).
- **Navigate Wave-1a** — `<outlet>` + `<program>`-shell foundation (`ac22895e`, pushed) — recognition + emit + E-OUTLET-DUPLICATE/OUTSIDE-SHELL + W-OUTLET-ABSENT + 7 conformance cases. S239-reviewed (5 bugs caught+fixed pre-land).
- **Pre-push hook fix** — recompiles `samples/compilation-tests/` fixtures before the browser check (stale fixtures faked "16 browser fails" — NOT a regression; [[feedback_browser_test_regression_triage]]). `82b61bb2`.
- **Wrap-debt cleared** — worktrees 51→22, 29 merged branches deleted, board archived (S242-248 → read/).

## 🔴 NAVIGATE WAVE-1b — BANKED (finish next session)
**Branch `worktree-agent-ad18282b8c9c2cc10` @ `9c8150fb`** (worktree retained under `.claude/worktrees/`). Gate-green
(19984/0, conformance 359, browser 15/0) BUT the S239 re-review found 9 findings; 2 fixed, 7 remain.
- **DONE (committed on branch):** M1 region-scope registry (if=/each/if-chains + effects rehydrate + tear down on swap) · `#1` SEVERE mode-inversion regex (rewrite.ts — `.Hard` logout was becoming a soft swap; **security-adjacent**) FIXED `2f374fc3` · `#2` forward-soft-nav hash short-circuit FIXED `9c8150fb`.
- **REMAINING (fix plan):**
  - **#5 SHOWSTOPPER (codegen)** — `_scrml_rehydrate_region`→`_scrml_ssr_seed_apply()` is UN-scoped; the fetched route's seed includes SHELL cells at SSR-initial values → a mutated shell cell (nav counter/sidebar) RESETS on every soft-nav (breaks persistent shell). FIX: emit a compile-time `_scrml_shell_cells` set (program-top-level cells, outside outlet/pages) + skip them in rehydrate seed-apply. No runtime-only shortcut (shell/route distinction is compile-time-only).
  - **#7 leak (codegen)** — `<keyboard>`/`<mouse>`/`<gamepad>` handlers NOT region-routed (only `<timer>`/`<poll>` got `_outletResident`) → global listeners leak on swap. FIX: mirror the `_outletResident` region-cleanup treatment (emit-reactive-wiring.ts:~1108 has the timer pattern).
  - **#3 follow-on (by design)** — outlet `<timer>`/`<poll>` STOPS on nav-away (leak closed) but does NOT restart on return; deferred deliberately. FIX: make the outlet-resident timer setup re-invocable from the rehydrator (agent was mid-way threading `insideOutlet` emit-html→emit-reactive-wiring).
  - **#4** focus: `_scrml_nav_focus` targets an h1/h2 with no tabindex → `.focus()` no-op → apply `tabindex=-1` to the focused node (§20.8.5(3)). **#6** nav-race: recheck nav-token inside `startViewTransition(swap)` before swapping. **#8** `_scrml_find_if_marker` per-marker TreeWalker (perf). **#9** `_scrml_nav_sync_meta`/`_link` copy-paste dedupe.
- **Verify #1 empirically** (rewrite.ts is a binary diff): compile a match value-arm with two navigate calls, confirm each lowers to the correct mode.
- **Then:** S239 re-review the fix delta → merge branch→main (`git merge --no-ff`; the branch merged main in) → the complete same-chunk soft-nav lands.

## 📋 NAVIGATE ARC ROADMAP
**1a** ✓ (outlet+shell) · **1b** banked (same-chunk runtime — finish #5/#7/#3) · **1c** cross-route chunk-loading (a different-chunk route hard-falls-back today) · **Wave 2** link-boost (`<a>` default-soft + `hard`) · **Wave 3** keep-alive (`<page keep-alive>` data-cache; invalidation deep-dive done). Authority: scrml-support/docs/deep-dives/navigate-* (client-router + SPEC-AMENDMENT + rehydration-mechanism [M1 chosen over M2 re-run-boot — double-init landmine] + keepalive-invalidation).

## 📋 OTHER OPEN THREADS
- **#26 P0 (Peter)** — CANNOT reproduce on Linux (all 3 SQL-bearing variants await correctly). Replied asking Peter for a clean `rm -rf dist/` rebuild (likely stale artifact) vs Windows-specific. Ball with Peter. **No Windows CI — Peter is the sole canary (4th OS-path issue).**
- **#25** Windows nested-page `pathFor` `\`vs`/` 404 (clean fix; pathFor partly in api.js).
- **Deferred wrap-debt:** maps refresh (Wave-1a landed; not regenerated), `state.ts` known-gaps regen, master-list §0 currency. ~20 unmerged worktree branches need per-branch triage.

## 🚦 STATE @ CLOSE
- git: main `ac22895e`, origin coherent (0/0). scrml-support + flogence pushed. Wave-1b on its branch (retained). commit-lock RELEASED. conformance 356 at main.
- S251 live concurrent (own branch). Board: active-sessions/S250.md.

## Methodology (the irreducible)
- **S239 review earned its keep repeatedly** — green gate + happy-path browser tests green'd broken soft-nav THREE times (frozen content, no-op teardown, security-adjacent mode-inversion); the adversarial workflow caught each. "It swaps" ≠ "it works." [[feedback_adversarial_verify_not_confirmatory]]
- **Stale-fixture trap** — browser pre-push reads pre-compiled `samples/compilation-tests/dist/`; recompile before trusting; compare WHOLE-SUITE not isolated files. [[feedback_browser_test_regression_triage]]
- **commit-lock false-crash** — wrong/dead pid ≠ crash; tool verdict is authoritative; surface, don't conclude. [[feedback_commit_lock_main_authority]]
- **Repeated transient agent death** — huge-context agent hit stream instability; ~2 crashes → PA-direct; commit-after-each-fix salvages. [[feedback_repeated_dispatch_crash_pa_direct]]

## pa.md directives in force
R1-R5 · S239 adversarial (PA-side workflow review; caught a security-adjacent bug) · S138 R26 · commit-lock (S250, released) · branch-baton (S251 live) · commit-to-main after authz · orchestrate-don't-grind + default-GO.

## Tags
#session-250 #concurrent-to-leading #commit-lock-built #navigate-27-arc #wave-1a-landed-pushed #wave-1b-banked #s239-earned-keep-3x #security-mode-inversion-caught #issue-26-ball-with-peter #enormous-session
