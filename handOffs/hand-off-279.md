# scrml — Session 279 (bryan) — WRAP

**Date:** 2026-07-22. A dense multi-arc session: **#131 adopter each-mount fix landed**, the **two carried S277 rulings resolved**, a **cross-machine Wave-1c rebase caught a severe blocker → deferred to ESM U4**, and an **E-ASYNC over-fire ruling + Case-1 fix**. Machine = **`bryan-XPS-8950`** (the previously-262-behind clone). Solo, but the **other machine (`bryan-maclee`) went LIVE mid-session** (pushed the Wave-1c branch) — treat as a concurrent sibling next boot.

## ⚠️ READ FIRST — state as of close
- **scrml main = `df6d269c`** (#131 + S279 rulings, PR #137). The **E-ASYNC Case-1 fix + this session's continuity** land via a **`wrap/s279` PR** (held for bryan's merge at close — see Open).
- Mechanical stream is in `handOffs/delta-log.md` **[715]–[722]** — not duplicated here. This hand-off carries the irreducible.
- **CROSS-MACHINE:** this machine lacked `gh` (installed+authed HTTPS this session), the canonical `scrml-js-codegen-engineer` agent (used `general-purpose` fallback throughout), and the live `assetManagement` adopter corpus (R26 used gauntlet-r25 + samples + reproes). The `active-sessions/` board doesn't exist on this clone. **Boot next time fetches BOTH scrml + scrml-support AND checks `gh issue list` / `gh pr list` (now that gh works).**

## 🎬 WHAT LANDED (main `df6d269c`, PR #137)
- **#131 — each mount is a foster-safe comment fence (A-unified).** `emitEachMountHtml` now emits `<!--scrml-each:N-->…<!--/scrml-each:N-->` with rows as SIBLINGS (foster-safe + drop-safe in every insertion mode; `<option>`s land as direct `<select>` children). 6 consumers moved. Closes GH **#131** (`<select>` empty in Firefox) + the S272 `<tbody>` foster report. Interim `W-EACH-TABLE-FOSTER` lint removed. Also closed the `$`-pattern `String.replace` injection across all 3 SSR splice loci (mount fill + seed-state + CSRF-meta) + memoized the anchor lookup (was a full-document walk per reconcile). Verified: parse5 spec-accurate proof (fences survive in select+tbody; old-div controls confirm the bug = Firefox) + 3-lens adversarial + committed pin `each-mount-fence-foster-safe.test.js`.
- **S279 RULINGS (both carried from S277):**
  - **Ruling 1 = A** (Shape-1 markup) — SPEC §1.4 tightened with the **five-doors** markup-as-value partition + Shape-1 exclusion; PRIMER §4 condensed. *Reactive markup = derivation/state-keying, never imperative reassignment.*
  - **Ruling 2** (§34 `E-STYLE-001`) — corrected the stale row (it's the `<style>`-element rejection, `E-SCRIPT-001`'s twin — not a `#{}` CSS syntax error).

## 🟡 LANDING IN THIS WRAP PR (`wrap/s279`)
- **E-ASYNC Case-1 fix** (compiler code, from agent worktree `a09ca727`, verified 134/0 + identical 52-fail baseline). `KNOWN_DISCARD_HOF` set (setTimeout/setInterval/setImmediate/queueMicrotask/requestAnimationFrame/requestIdleCallback) — an async callback to a bare-ident global discard-HOF is re-emitted async (inner call auto-awaits inside the discarded-return callback) instead of firing the backstop. Message softened. **Unblocks flogence's RED gate on merge.** (Exclude the agent's stray `…workflow-union.md` + `progress.md` at land.)
- The continuity docs (this hand-off, changelog, master-list, delta-log [715]-[722], known-gaps updates).

## 🧭 THE BIG DEFERRAL — Wave-1c cross-chunk soft-nav → ESM U4 (bryan RULED B)
The other machine pushed the held Wave-1c pieces-2+3 (`origin/worktree-agent-a2ed001a5de228134`, `8fd5fd07`, stale pre-S277 base). **This machine rebased it** (`--onto df6d269c 86ee7b97`, dropping the already-landed piece1) → local branch **`feat/wave1c-nav`** (RETAINED as the U4 reference). Two findings stopped the land:
1. **★ S277-drift landmine — the stale branch re-introduced the pre-S277 OVERBROAD `E-OUTLET-AND-MAIN` in FOUR places** (2 SPEC conflict regions + the outlet test + the conf-NAV nested test + [adversarially] a duplicate §34 row + a §20.8.1 bullet). All resolved to S277 on the branch. **Watch this: any future Wave-1c port must preserve the S277 one-landmark invariant (nested `<main><outlet/></main>` is LEGAL; only bare/sibling fires).**
2. **★ SEVERE BLOCKER (empirically confirmed) — cross-chunk global collision.** Per-file each-ids/cells in shared classic globals: two routes both emit `scrml-each:6` + register `_scrml_each_renderers["each_6"]` at module top-level → soft-nav coexistence clobbers → route B's rows render into route A's fence. **This is the exact collision ESM module scope dissolves.** → **bryan RULED B: cross-chunk nav is an esm/module-scope feature; fold into ESM U4, NOT classic.** Wave-1c-classic REJECTED; loader/flag-gate-boot/S277-outlet/tests PORT to U4.
- **U4 DESIGN CONSTRAINT (record):** cross-chunk nav requires per-module chunk scope (esm) OR per-chunk id/cell namespacing — the classic shared-global model is unsound for coexisting chunks. Also (Finder A, MEDIUM): a lost-race nav still runs its chunk's module-init (pollutes globals); `_scrml_chunk_loading` is not nav-scoped.

## 🔴 OPEN — needs bryan / next session
1. **Merge the `wrap/s279` PR** (held at close — the one main-touching step; E-ASYNC fix + continuity). Cloud `gate` is the authority. On merge, close nothing new but flogence's gate unblocks.
2. **E-ASYNC Case 2 — an R2 DESIGN QUESTION (deferred, not rushed under freeze).** An async thunk passed to a USER HOF that awaits it (`runGatedAgentic(() => runAider())`) still fails closed — the compiler can't verify a user HOF awaits its callback param without cross-fn coloring. Design options: a typed async-thunk/`snippet` param the compiler colors, vs document-the-workaround (inline, don't thunk). Gap `g-async-stdlib-in-sync-callback-over-fires` (status now `in-progress`; Case 1 fixed, Case 2 open).
3. **ESM U4 — the next arc.** The `import()` nav-time chunk loader on the esm/module path (closes adopter #27 soft-nav + is the sound home for Wave-1c cross-chunk nav). Reference: `feat/wave1c-nav` + `origin/worktree-agent-a2ed001a5de228134` + `docs/changes/navigate-wave1c-cross-chunk/`. Then U5 (module browser harness) · U6 (default-flip).

## 📌 gaps filed this session (all in `docs/known-gaps.md`)
- `g-each-mount-div-foster-parented-in-table` → **RESOLVED** (fence model).
- `g-nested-each-div-mount-in-restricted-parent` (MED) — nested each under select/tbody still div-wraps (same class as #131, out of scope; the "nested is immune" reasoning was incomplete — foster-immune ≠ render-correct).
- `g-each-anchor-lookup-first-match-document-wide` (LOW, pre-existing).
- `g-navigate-soft-nav-full-reload` (#27, MED) — carries the Wave-1c/U4 deferral + the collision finding + the U4 module-scope constraint.
- `g-async-stdlib-in-sync-callback-over-fires` (HIGH, in-progress) — Case 1 fixed, Case 2 design-Q open.
- `g-css-syntax-error-in-hash-block-no-diagnostic` (LOW) · `g-tailwind-lint-false-positive-on-same-file-hash-class` (LOW, master-PA report) · `g-e-style-001-row` (resolved via Ruling 2).
- **Unfiled edge:** `<each ... key=@>` (bare-item key on primitives) → `E-CODEGEN-INVALID-LOGIC`; proper `key=@.id` compiles clean. Likely pre-existing — verify on a clean main before filing.

## 🧷 Held / retained
- **`feat/wave1c-nav`** (local) + **`origin/worktree-agent-a2ed001a5de228134`** — the U4 cross-chunk-nav reference. Do NOT delete.
- **E-ASYNC worktree `agent-a09ca727`** — its work rides the `wrap/s279` PR; clean at wrap 6b once the PR is cut.
- The #131 each-fix worktree — already removed (landed).

## 🧪 THE SESSION'S METHOD-LESSONS (for the next PA)
- **The boot nearly shipped thin.** bryan caught a "caught up" report that had SKIPPED the full contract + 3 mandatory boot steps (adopter-issue channel, CI/PR state, concurrent-session board) under a false "context economy." The S277 doctrine (empirical-sufficiency illusion, governing-sentence gate, direction-of-change) was exactly what the thin boot skipped. **Boot the full read-set; the "economy" that skips the contract is the expensive miss.**
- **The adversarial gate earned its keep THREE times:** #131 (the dev-agent's "ran real Chromium+Firefox" claim was UNVERIFIABLE — S265 false-browser-pass; parse5 proved it instead), the Wave-1c rebase (4 S277-drift sites + the SEVERE collision blocker — stopped an unsound land), and the perf regression on the #131 anchor lookup. **Never trust a dev-agent's green self-report; the PA-side adversarial + empirical gate is non-delegable.**
- **A stale-based cross-machine branch carries superseded decisions.** The Wave-1c branch (pre-S277) would have silently regressed the exact E-OUTLET overreach bryan reversed in S277. **Sweep newest-first; re-ground SPEC drift against the newest ruling, not the branch's base.**

## Tags
#session-279 #131-each-fence-landed #s279-rulings-shape1-A-estyle001 #wave1c-deferred-to-esm-u4 #cross-chunk-collision-blocker #s277-drift-caught-4-sites #e-async-case1-fixed-case2-deferred #adversarial-gate-3-catches #other-machine-live #next-esm-u4
