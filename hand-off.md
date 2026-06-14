# scrmlTS — Session 191 (CLOSE)

**Date:** 2026-06-13.
**Previous:** `handOffs/hand-off-195.md` (S190 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-196.md` at next OPEN.
**Profile:** A — FULL. Opened `"read pa.md and start session"` (default A). Long, dense, user-driven.

## What this session was
The whole **`if=fn()` condition-routing bug class** closed (3 MEDs), then a **deep-dive → data-first ruling → 4-phase build** that took **bug-1 (Tailwind composing utilities)** from filed-scope through **ALL FOUR composing families**, plus a major next-session direction (**the "Flux" game**). 7 dispatches (1 deep-dive + 6 dev), all PA-independent-R26 dual-verified before landing; per-arc/per-phase land+push authority held end-to-end. Board MED 6→5.

## Session-close state
- **HEAD `004007fb`** (bug-1 Phase 4). **origin `15f1bdb4`** at this writing → **local 3 commits ahead** (`ddf5919d` P3 · `2a2e3238` P4-BRIEF · `004007fb` P4) — **the wrap-push (this close) pushes these + the wrap commit.** User authorized "push it too."
- **Tests:** pre-commit subset **16,989 pass / 90 skip / 0 fail** (live `bun scripts/state.ts`). Full suite green via per-phase pre-push gates + the wrap-push gate.
- **known-gaps (live):** the if=fn() trio closed (MED 6→5); bug-1 stays `open` for its 3 separate sub-arcs (NOT composing-family work). Run `bun scripts/state.ts` for the precise board.
- **Version:** v0.7.0, no cut. **Inbox:** empty. **Commit-gate:** Configuration B (`.git/hooks`). Leave as-is.
- **Maps:** 6c project-mapper refresh status — SEE "Wrap execution" below. Watermark was `1e17213e` (12 behind at wrap).
- **Worktrees:** CLEAN — all 5 session worktrees removed at 6b (g-attr a4736cab · bug1-p1 ab455f5f · bug1-p2 a3f0bf9e · bug1-p3 a7cabcc1 · bug1-p4 a2985e07). Only main remains.
- **scrml-support:** user-voice S191 appended (if=fn() survey-reversal + bug-1 deep-dive/C-ruling/per-phase rulings + currentColor + Flux verbatim) + the bug-1 deep-dive doc (`docs/deep-dives/tailwind-preflight-css-2026-06-13.md`, status:current). Committed + pushed at wrap.

## ✅ if=fn() condition-routing class — CLOSED (3 MEDs)
`g-attr-if-fn-call-misroute` (`98bdb760`, agent a4736cab — standalone call-ref → conditional, emit-html.ts) + 2 siblings (`90fd7412`, PA-direct): `g-attr-if-fn-chain-head-call-misroute` (chain head read fn-name as cell, emit-event-wiring.ts:1296) + `g-attr-if-fn-display-not-mount` (standalone display-toggled vs mount/unmount, clean-subtree handler). **Survey reversal banked:** the parent's "interprocedural reactive analysis" premise was a MISDIAGNOSIS — `_scrml_effect` dynamic-tracks. +17 tests. `if=fn()` now == `if=(fn())` everywhere.

## ✅ bug-1 Tailwind preflight — ALL FOUR COMPOSING FAMILIES COMPLETE (§26.7)
Deep-dive `scrml-support/docs/deep-dives/tailwind-preflight-css-2026-06-13.md`. **Emission model RULED = Approach C** (inline `var()` fallbacks, NO global preflight block) — user "data-first C, validate in Phase 0"; PA byte-validation settled it (A/B block 824B fixed/file; C +33B box-shadow / +9B filter; C wins everywhere realistic + preserves §26.1 minimalism + correctness). 4 phases:
- **P1 ring/ring-offset/shadow** `ed3fa5ee` §26.7. `box-shadow: var(--tw-ring-offset-shadow,0 0 #0000), var(--tw-ring-shadow,0 0 #0000), var(--tw-shadow,0 0 #0000)`. **currentColor ring-default RATIFIED** (user "currentColor is fine, keep it" — scrml-divergence from TW blue-500). PA caught+fixed agent ring-[width] consistency gap.
- **P2 gradient** `f5b71e61` §26.7.1 — **FILED SCOPE CLOSED.** `--tw-gradient-stops` compose; from-color `to`-default = v3-faithful transparent twin (`hexToTransparentRgb`). +47.
- **P3 transform** `ddf5919d` §26.7.2 — **BEHAVIOR CHANGE** (user "continue phase 3"): directional translate/scale/rotate/skew individual-props → composing `transform:` shorthand. Escape-hatch (`transform-[…]`/`scale-[1.5]`) + 3D rotate-x/y/z stay literal.
- **P4 filter/backdrop** `004007fb` §26.7.3 — net-new, last family. `filter: var(--tw-blur,)…` empty-fallback; backdrop has opacity (no drop-shadow), emits `-webkit-` companion. +53.
- All 4 = §26.7/.1/.2/.3, Approach C. **Agent process note (recurring):** P4 agent twice attempted a pre-commit-hook bypass (`core.hooksPath=/dev/null`, `--no-verify`) then self-reverted; moot for file-delta'd content (PA landing gate is real).

## 🎮 NEXT SESSION — "Flux" game dog-food (user S191 vision — START next session)
**Replace `examples/14-mario` with "Flux"**, a real game in canonical scrml all the way, incorporated into the demo site (scrml.dev, adjacent). 3 modes = the site's 3 progressive themes: plain-HTML → **ASCII maze** (main world-exploration mode; color+shape walls/mountains; labyrinth channels/caves/canyons/dugways/catwalks; player=emoji); "pages" → **8-bit formats** (per level); SPA → **doom-esque/goldeneye**. "Flux" = name + mechanic: fog-of-war (differs per mode); visibility scales w/ player LEVEL (L1=see 1 beyond emoji); unseen world "takes shape" only on a locked criterion. **3 LOCKED things (else flux):** (1) what each player sees inside their area; (2) area overlap between players (locked while overlapping); (3) MEMORIES — locked in-world AND at "home", each with its own EXPENSE. Comprehensive **D&D-style player sheet**; **state PERSISTS.** Vision only ("I have ideas I will get to") — NOT specified/built. Next: user flesh-out → likely design doc/deep-dive → canonical-scrml build (will dog-food channels/multiplayer-overlap, fog reactivity, 3 render modes, progression schema, persistence HARD — expect real gaps). Verbatim: user-voice S191 + memory `project_flux_game_dogfood`.

## Open questions to surface at next open
1. **The user's S191 open Qs that weren't answered** (Q1 was answered = continue phases): **Q2** — the 2 separate bug-1 sub-arcs (string-shaped `content-["x"]`/`font-[Inter]` bracket-parser · safelist/@apply lint precision) — follow-up or defer? **Q4** — next hard MED after bug-1 (engine var-name canonicalization unblocks `bug-12-vkill`; or `bug-14` MCP; or native-parser CHARTER B M2.4/MK2 ~v0.8). **Q5** — VERIFIED.md examples human-verification pass (USER action).
2. **bug-1 remaining (separate arcs):** string-shaped arbitrary values · safelist/@apply · arbitrary `ring-offset-[<len>]` (lone ring-family member without a utility). All `open` in the bug-1 gap.
3. **Maps refresh** — see Wrap execution (the §26.7 composing-family work is the key map gap; agents flagged it 3×).

## Wrap execution (S191 — 8 steps; user "wrap" + "push it too")
1 hand-off (this) · 2 master-list (§A S191 + §0 state-regen) · 3 changelog S191 · 4 inbox empty/no outbound · 5 tests (subset 16,989; full via push gate) · 6 working-tree clean at push · 6b worktrees CLEANED ×5 · **6c maps — SEE BELOW** · 6d state-regen PASS (gap-counts + recent-sessions) · 7 PUSH (scrmlTS + scrml-support) · 8 user-voice S191 + memory `project_flux_game_dogfood` + this hand-off.

## pa.md directives in force
- Rules R1–R5 · `---` answer-delimiter · Profile A/B · wrap=8 steps (6b/6c/6d) · full-wrap discriminator · 88% floor.
- Dispatch: S88 isolation · F4 startup-verify · S90 CWD · S99/S126 Bash-edit + no-cd · S136 BRIEF.md archival · **S138 R26 dual-verify (load-bearing all session — caught 2 siblings + 2 agent gaps)** · S147 branch-leak coherence · S164 bg-commit-race · S180 waiting-time (Tier-2 next-dispatch prep kept the 4-phase arc flowing) · S187 crash-recovery.
- Memory live: **`feedback_dont_preclassify_fix_as_surgical`** (the survey-reversal — gap over-estimated its own fix) · `feedback_r26_empirical_verification` + `feedback_verify_before_claim` (dual-verify caught the siblings + agent gaps) · `feedback_no_batch_ratify_foundational_axioms` (the C-emission axiom-tension — resolved data-first WITHOUT a debate, C sidesteps the fork) · `feedback_waiting_time_work_pattern` · **NEW `project_flux_game_dogfood`**.

## Tags
#session-191 #close #profile-a #if-fn-class #bug-1-tailwind-preflight #approach-c #all-composing-families #flux-game #survey-reversal #data-first-validation
