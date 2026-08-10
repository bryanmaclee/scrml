<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S336: prior wraps -->
<!-- handOffs/hand-off-s335.md (S335) + handOffs/hand-off-s334.md (S334) -->
<!-- + hand-off-s332.md (S277–S332) etc. Mechanical stream: handOffs/delta-log.md. -->
<!-- ============================================================= -->

# scrml — Session 336 (peter · Windows) — WRAP

**Date:** 2026-08-09. `/boot` Profile A. **1 PR merged** (#492 `scripts/boot.ts`) + this wrap. main `458452a2` → **`ec639bc4`** → wrap. Coherence 0/0 both repos. Cloud gate GREEN incl. Windows. **Review floor: 0 owed** (#491 carve-out · #492 finding). Gaps **HIGH 27 · MED 122 · LOW 58 · Nom 7** (headline table regen'd from stale 26/126/56). Delta-log **[1301]–[1305]**. SOLO (bryan wrapped; his #488 open, his to merge).

## ⏭ NEXT-SESSION PICKUP (read this FIRST — the left-off handshake)

**FIRST, prove the boot-remedy fired** — this session BUILT it, so your boot is the first dogfood: `/boot` step 0 should have run `bun scripts/boot.ts` and led orientation with THIS block. If it didn't (you're reading a menu, or you ran the reads by hand), the wiring in `~/.claude/commands/boot.md` didn't take — say so; it's the exact seam we closed. (`scripts/boot.ts` is landed on main; the step-0 wiring is in the installed `/boot`.)

**THEN the standing next adopter-value work — the SSR-each prerender arc** (was S335's Option 2, deferred to build the boot-remedy; now #1). Gap `g-ssr-each-row-template-subset-blocks-all-prerender` + sibling `g-ssr-each-multi-root-client-only-fallback`, module `compiler/src/emit-ssr-render.ts`. aM = 132 `<each>` + 295 computed-class interps → ~every data list loses SSR first paint (client-only fallback). ⚠️ **STEP ONE = read the governing SPEC sentence + repro BEFORE building:** widening what the SSR renderer prerenders is potentially *newly-accepting* (a language-surface question → maybe bryan's lane, per [[feedback-stay-in-adopter-lane-not-grammar-decisions]]) and carries hydration-mismatch risk (the gap body flags it). NOT a one-liner. If it resolves newly-accepting → route/hold for bryan; if inert widening → build in-lane.

## 🎯 WHAT LANDED (S336) — the wrap→boot seam closed by an executable gate

The S335 short-boot remedy, Peter-confirmed as this session's first pickup. Both halves now interlock: `/wrap` **writes** the exact `## ⏭ NEXT-SESSION PICKUP` heading → `scripts/boot.ts` **extracts** it and leads orientation → the seam a memory couldn't gate is now gated.

- **#492 (`ec639bc4`) — `scripts/boot.ts`.** Read-only boot gate: fetch both repos; VERIFY every Profile-A read-set source exists+current (missing/stale LOUD; both voice ledgers + per-user profile in the set BY CONSTRUCTION); DELEGATE the mandatory probes to their authoritative sources (review-debt/threads/gh); EXTRACT+PRINT the PICKUP block first; drift-guard each item vs its mandating contract. Modes: digest·`--json`·`--check`·`--no-probes`. **S239 caught a gate-defeating unanchored-`indexOf` false-pass** (matched the heading in a code-span mention — the wrap template has one) + 2 minor; all fixed + re-verified in a sandbox. [1302][1303].
- **Wiring (piece 1+2).** Conditional step-0 in `/boot` (run helper if present, lead with PICKUP, FAIL=hard-stop; no-op otherwise) + `/wrap` step-1 now REQUIRES the exact PICKUP heading. Applied to Peter's INSTALLED `~/.claude/commands/{boot,wrap}.md` (operative now) + flogenceP fork source (branch `feat/boot-command-project-helper-wiring`, pushed to pjoliver11/flogenceP — **Peter to merge in his fork**). [1304].
- **Fold-in:** `state.ts --write` regen of the pre-existing gap-counts drift (26/126/56 → true 27/122/58; NOT mine — state+facts --check both PASS now).

## ⛔ HELD / ROUTED — do NOT take as compute (carried + new)

- **NEW — canonical boot-remedy amendment → bryan** (`incoming/2026-08-09-from-peter-to-bryan-boot-helper-canonical-amendment.md`): `.pa-base/profile` + `pa-base.md` + upstream flobase `commands/boot.md` + the shared `/wrap` PICKUP block. His to ratify; nothing blocked on him (Peter's installed boot already has it).
- **#486 HIGH leak** (for-loop lift body evades §12.2) — routed S335; his escalate-vs-refuse family (pending ruling).
- **if-value fork RULED B** → §17.6 amendment off `worktree-agent-ad7fea65da10675c1`@`5fc00afa` (his to land). **g-263 cross-file-const** (`b9d68190`) + **§6.8 implicit-multiwrite-reset semantics fork** — routed, await his ruling.
- **14 owed-by-bryan** (his S331 hand-off) incl. dpa-022/023/024. **His wrap PR #488 still OPEN** — his to merge; do not touch.

## 🔑 METHOD NOTES THAT OUTLAST (S336)

- **The gate had a gate-defeating bug, and S239 caught it** — an unanchored match that false-passed on a code-span mention of its own heading. Ground-truthed, fixed, re-bit in a sandbox. Even a correctness-tooling PR gets the independent adversarial pass; a green self-report is not proof. [[s239-review-falsify-the-claim-dont-confirm-a-hypothesis]].
- **A memory navigates, an executable gate gates** — the whole point of this session. The remedy is a script `/boot` runs, not a note the PA might skip. [[feedback-lead-boot-orientation-with-leftoff-handshake]] → now BUILT [[scrml-boot-remedy-executable-gate-built]].
- **Installed command drift is real** — `~/.claude/commands/boot.md` was 7-step-stale vs the 8-step flogenceP source, AND untracked. The fork source is the durable home (Peter's ruling); route canonical to bryan so a reinstall can't silently regress it.

## 🧷 STATE / DEFERRED

- **flogenceP wiring** — MERGED to pjoliver11/flogenceP `main` (`96f7ade`, S336 post-wrap; branch deleted, coherence 0/0). The durable boot/wrap source is on the fork's main line now. ⚠ Peter's INSTALLED `~/.claude/commands/{boot,wrap}.md` were hand-edited to match (operative) — a flobase reinstall regenerates them from flogenceP main (which now carries the wiring), so no regression risk. Canonical shared-contract amendment still ROUTED-not-ratified (bryan's).
- **Maps (6c):** one new script (`scripts/boot.ts`); no compiler-code modules changed. project-mapper refresh still owed from S334/S335 (watermark behind) — LOW urgency, deferred.
- **Worktrees (6b):** created none this session (Agent-tool satellites). Retained (not mine): `agent-a0742fe4795045e91`, `agent-a4e6b5f2562ae9eaa`, `onmount-c` (feat/onmount-c-build), `scrml-pinned` (leave).
- **Base64→false-E-FN-003 gap** (`g-server-fn-template-literal-base64-eq-false-e-fn-003`, MED) — still marked re-verify-owed (carried from S334 census; not re-reproduced).
