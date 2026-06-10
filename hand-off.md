# scrmlTS — Session 177 (CLOSE)

**Date:** 2026-06-09
**Previous:** `handOffs/hand-off-181.md` (= S176 CLOSE).
**Next-session pickup:** rotate THIS file → `handOffs/hand-off-182.md` at next OPEN.
**Profile:** opened **A (FULL)** ("read pa.md and start session"). `/effort` → **ultracode**.
**Wrap:** plain "wrap" → then **"changed mind, push"** — 8-step wrap executed (6b worktree-cleanup + 6c maps-refresh + 6d state-doc) **+ step 7 PUSH**.

## 🟢 S177 CLOSE — bug-tail registry clearance + two latent-bug escalations (3 pushed arcs)

A Profile-A/ultracode session aimed at the open-gap registry. R26 reverse-direction triage cleared the bug-tail; two picked threads (g-formfor, g-stdlib) escalated into more significant latent bugs than filed — both fixed with the render/runtime coverage that was missing.

### STATE AS OF CLOSE
- **HEAD:** the wrap commit (hand-off + changelog S177 + master-list + maps 6c + state-doc 6d) on top of the 3 arc landings: `b1931f02` (bug-tail) · `75f724af` (g-formfor) · `c48c4f71` (g-stdlib). **PUSHED** (origin/main == local).
- **Tests:** full suite **23,734 / 0 fail / 220 skip / 1 todo** (S176 close 23,680; +54). `state.ts --check` PASS.
- **known-gaps:** **HIGH 0 · MED 7 · LOW 12 · Nominal 9** (was MED 10 · LOW 22 — **13 cleared net**). Closed: r27-c4/bug-45/26/34/27/r27-c8 (stale) + bug-74/4/48/r28-7b/s169/r27-c6 (bug-tail fixes) + g-formfor + g-stdlib. Filed-then-closed: g-formfor-in-match-arm.
- **Version:** v0.7.0, no cut. **stdlib:** 18 modules (no change).
- **Worktrees:** **main only** (all 3 agent worktrees cleaned per-landing). **Stray stash** `stash@{0}` = a 1-line `api.js` WIP from S170 (orphaned worktree gone) — LEFT in place; next session may `git stash show -p stash@{0}` + drop if confirmed dead.
- **Maps:** refreshed 6c (project-mapper incremental on the 10 S177 source files); watermark → the wrap commit (or c48c4f71 — trails by the docs-only wrap commit, WARN-only).
- **Inbox:** empty. No cross-repo notices sent.

### S177 ARCS (all pushed, all PA-independently verified)
1. **`b1931f02` — bug-tail (R26-triage of 18 gaps).** 6 fixes (bug-74 E-CLOSER-001 · bug-4 looksLikeCloser refine [corrected 2 spec-divergent locked tests] · bug-48 opener-finder parenDepth + emit-match 2nd locus · r28-7b schemaFor union-recovery · s169 inline-map-assign · r27-c6 MED formFor-in-engine [root differed — never EXPANDED]) + 6 stale closes (cited sibling commits) + 6 defer re-confirms (incl. bug-75 KEEP-OPEN per user). +29 tests.
2. **`75f724af` — g-formfor: silent-non-render CLASS.** formFor + components + tableFor don't render in engine state-children / match arms (the expansion walkers skipped `.bodyChildren`/`.arms`). NEW walkable `match-block.armBodyChildren` (ast-builder) + emit-match consume + component-expander/type-system walker recursion + within-node STRIP_KEYS. 4 slices, all **render-verified in the DOM** (13 happy-dom tests). +13.
3. **`c48c4f71` — g-stdlib: client inliner follows sibling-shim imports.** `_loadStdlibChunk` new `_inlineSiblingShimImports` (relative `./x.js` inlined transitively/deduped/renamed-to-local; external `bun`/`node:*` stripped). data.js + auth.js Math de-leaked through scrml:math (aliased to dodge data's min/max validators + auth's local `max`). **RUNTIME-callability verified** (executed `_scrml_stdlib.data.clamp(15,0,10)===10`). +7.

### PROCESS NOTES (for next session)
- **The methodology earned its keep:** R26 reverse-verification → 6 stale-opens were free closes (already fixed, never re-marked). The canary doctrine (render-not-just-compile / run-not-just-compile) turned a 1-line gate-catch into the g-formfor class fix + verified the g-stdlib ReferenceError gap. Both escalations surfaced to the user (signal-scope) before the expanded dispatch.
- **Two agent Rule-3/4 catches (sound, surfaced):** g-formfor — a `<match>` stores arm bodies as raw `armsRaw`, so "purely walker recursion" was wrong; needed the new armBodyChildren AST. g-stdlib — the brief's `import {min,max}` would COLLIDE (data's own validators / auth's local max); agent aliased (the `as`-path the brief told the inliner to honor).
- **`--no-verify` reflexes:** g-formfor agent's progress commit + g-stdlib agent's WIP commit both hit `--no-verify`; the auto-classifier DENIED one, and PA lands via file-delta through main's own gate, so moot. The guard works.

### CARRY-FORWARD QUEUE (all need user direction)
- **DEFERRED follow-on (NEW):** auth.js's 6 `Date.now()` wall-clock reads → scrml:time.now() (a separate clock-leak class; security-sensitive JWT/TOTP timing — not filed as a gap, noted in g-stdlib's resolved entry).
- **DD1 remaining forks (close the DD):** Fork 2 (global-reactive-store — ratify-the-omission) · Fork 5 (escape door — keep `import:host` platform-only). Deliberation, no build; closes the JS-host-boundary DD.
- **MED tail:** `r28-c2` (kickstarter `< db>` leading-space + print()) · `bug-1` (Tailwind arbitrary-value — needs preflight-CSS infra) · `bug-12-vkill` (var-name canonicalization gated) · `bug-14` (MCP V0.E) · `bug-16` (generator policy — design Q) · `bug-17-l19` (L19 relaxation — design Q).
- **LOW canon-scrub:** `g-server-keyword-drift` (the deprecated `server` modifier pervades canon) · `g-route-arg-fn` · `g-sql-row-protect-leak` + bug-75 (KEEP-OPEN, real bug) + the LOW bug tail.
- **Native-parser swap Wave 3** (strategic #1; design-gated; DEFER to M6). TRIAGE: `docs/changes/native-swap-retriage-s166/`.

### pa.md directives in force
- Rules R1–R5. `---` answer-delimiter. Profile A/B. `full wrap`/88% floor. wrap = 8 steps (6b/6c/6d).
- Dispatch: S88 isolation · F4 startup-verify · S90 CWD-routing · S99/S126 Bash-edit+no-`cd` (+ S176 hook-Bash-blindspot) · S136 BRIEF.md · S138 R26+independent-verify · S147 branch-leak coherence · S164 bg-commit-race.
- Memory: `feedback_canary_metric_class_lesson` (render/run-not-just-compile — the load-bearing one this session) · `feedback_dont_preclassify_fix_as_surgical` · `feedback_verify_before_claim` · `feedback_signal_ruling_scope` · `feedback_no_batch_ratify_foundational_axioms` · `feedback_file_delta_vs_cherry_pick`.

## Tags
#session-177 #profile-a-full-start #bug-tail #r26-triage #g-formfor-silent-render-class #g-stdlib-clientinline #13-gaps-cleared #wrap-and-push
