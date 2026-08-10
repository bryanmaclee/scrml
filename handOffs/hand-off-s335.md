<!-- ============================================================= -->
<!-- hand-off.md — live session state. ROTATED at S335: prior wraps -->
<!-- handOffs/hand-off-s334.md (S334) + handOffs/hand-off-s332.md (S277–S332) -->
<!-- + hand-off-s276.md etc. Mechanical stream: handOffs/delta-log.md. -->
<!-- ============================================================= -->

# scrml — Session 335 (peter · Windows) — WRAP

**Date:** 2026-08-09. `/boot` Profile A. **2 PRs landed** (#489 review-floor drain · #490 ledger-hygiene) + wrap PR #491. main `ddb924b3` → **`458452a2`** → wrap. Coherence 0/0 both repos. **Review floor: 0 OWED.** Gaps **HIGH 27 · MED 122 · LOW 58 · Nom 7**. Conformance unchanged (docs-only session). Delta-log **[1295]–[130x]**.

## ⏭ NEXT-SESSION PICKUP (read this FIRST — the left-off handshake)

**Two candidates, Peter to pick (per-item, S317). He leaned toward #1 as the safer/clearer-lane fix.**

1. **BUILD THE BOOT-REMEDY — Option 1, CONFIRMED by Peter (S335).** An additive executable gate that closes the wrap→boot seam so no read is silently skipped and the orientation always leads with the pickup. Two parts: (a) `scripts/boot.ts` — one command the `/boot` skill runs: fetch/behind for both repos, run the mandatory probes (review-debt · adopter issues · gh pr/run · board · thread-board), VERIFY every Profile-A read-set source exists+is current (a missing/stale read is LOUD), and EXTRACT+PRINT the required PICKUP block as the top of the digest; (b) a standardized `## ⏭ NEXT-SESSION PICKUP` block `/wrap` always writes (this block IS the prototype). **Additive/scoped — do NOT change bryan's boot contract** (`.pa-base/profile`, `/boot`, `pa-base.md`); wire only Peter's `/boot` to lead with it, and ROUTE the shared-contract amendment to bryan. Peter, verbatim: *"we need the workflow from session to session to be as seamless as possible. Leaving room for misdirection is not okay."* [[feedback-lead-boot-orientation-with-leftoff-handshake]].

2. **SSR-each prerender arc** — the aM-ranked #1 adopter-value pickup (aM = 132 `<each>` + 295 computed-class interps → ~every data list loses SSR first paint). Gap `g-ssr-each-row-template-subset-blocks-all-prerender` + sibling `g-ssr-each-multi-root-client-only-fallback`, module `emit-ssr-render.ts`. ⚠️ **STEP ONE = SPEC-mechanism check BEFORE building:** widening what the SSR renderer prerenders is potentially *newly-accepting* (a language-surface question → maybe bryan's lane, per [[feedback-stay-in-adopter-lane-not-grammar-decisions]]) and carries hydration-mismatch risk. Repro + read the governing SPEC sentence first. NOT a one-liner.

## 🎯 WHAT LANDED (S335)

- **#489** (review-floor drain) — the 7 owed PRs (#481–#487) reviewed: 4 code-bearing got an independent adversarial pass + I ground-truthed the one HIGH myself. Recorded 7 `@review` markers. **The floor's return: a HIGH confidentiality leak in bryan's freshly-merged #486** — a derived cell in a `for`-loop `lift` body evades the §12.2 check, shipping `Bun.password`(argon2id) + the secret to the browser (CONFIRMED on committed HEAD; control fires correctly). Filed `g-derived-server-only-reach-misses-for-loop-lift-body` (HIGH); **routed to bryan, NOT fixed** (his escalate-vs-refuse family, shared substrate `route-inference.ts:1086`).
- **#490** (ledger-hygiene) — 6 MED gaps re-verified-clean-and-resolved (NOT trusting the S334 census, which over-reported); 3 kept-open with re-triage; 4 new gaps filed. The re-verify caught the S334 census being WRONG about `g-nested-flatpage-runtime-bare-ref` (agent tested a flat *page*, but the S302 biting case is `<channel>` shells — untested → stays open). Caught+fixed a self-inflicted `state.ts` parser break (a marker whose `locus` prose held a literal `id=`).

## ⛔ HELD for bryan — do NOT take as compute (unchanged from S334 + new)

- **#486 HIGH leak** (for-loop lift body) — routed `incoming/2026-08-09-from-peter-to-bryan-486-high-leak-for-loop-lift-body.md`. His §12.2 escalate-vs-refuse family (pending-bryan ruling).
- **if-value fork RULED B** → §17.6 amendment off pushed branch `worktree-agent-ad7fea65da10675c1`@`5fc00afa` (his to land).
- **g-263 cross-file-const** (branch `fix/g263-cross-file-const-attr-value-seed`@`b9d68190`) + **§6.8 implicit-multiwrite-reset semantics fork** — both routed notes still UNREAD in his inbox by design (return-leg rule; await his ruling).
- **`g-navigate-soft-nav-full-reload`** (per-chunk namespacing = his architecture lane) · **`g-if-on-structural-element-silently-ignored`** residual (`<empty if=>` silent-drop — minting a diagnostic is language-surface).
- **14 owed-by-bryan** (his S331 hand-off) incl. dpa-022/023 (axiom), dpa-024 (live/fireable). **His wrap PR #488 still OPEN** — his to merge; do not touch.

## 🔑 METHOD NOTES THAT OUTLAST (S335)

- **The boot handshake miss** — I short-booted (skipped both user-voice ledgers + Peter's profile) and presented a fresh menu instead of leading with the agreed left-off pickup. Peter caught it. Durable fix = the boot-remedy above. [[feedback-lead-boot-orientation-with-leftoff-handshake]].
- **Disjoint-from-bryan, sharpened (S335):** *"keep our workflow separate from bryan's"* + *"our notation from session to session shouldn't derail bryan's next session"* + *"do it if we can, bryan not live."* Bryan-not-live clears the COLLISION constraint but NOT the LANGUAGE-AUTHORITY one — the #486 leak fix stayed routed even solo (unruled family). Reviewing/recording/routing is our lane; fixing his surface is not.
- **Verify caught the satellite wrong (again):** the stale-close agent called `g-nested-flatpage` RESOLVED off the wrong shape; reading the S302 note kept it correctly open. Never flip a ledger close on a satellite's word without checking the gap's actual live symptom. [[feedback-gap-report-fix-direction-can-be-wrong]].
- **The floor earns its keep:** a HIGH leak in a merged, green-gated, presumably-reviewed-enough PR — the S328 pattern recurring. The independent adversarial pass on merged code is not ceremony.

## 🧷 STATE / DEFERRED

- **Worktrees (6b):** none created this session (satellites were Agent-tool, not git worktrees). RETAINED from S334: `agent-ad7fea65da10675c1` (if-value, bryan's) + `scrml-pinned`. No new prune.
- **Maps (6c):** docs-only session — maps unchanged (no compiler code landed). project-mapper refresh still owed from S334 (watermark behind) — LOW urgency.
- **Base64→false-E-FN-003 gap** is now FILED (`g-server-fn-template-literal-base64-eq-false-e-fn-003`, MED) but marked **re-verify owed** (carried from S334 census; not re-reproduced on S335 HEAD).
