# scrml — Session 245 (CLOSE)

**Date:** 2026-07-07. **Profile:** A — FULL (`/boot`). A large build/fix session run CONCURRENTLY with **S244** (its CSS-native §65 arc) on the SHARED local checkout — I am S245, the pre-wrap successor (S244 wrapped mid-session at `f9d37153`; its hand-off names me correctly). **6 landings, all PA-adversarially-reviewed**, batched under a mid-session "hold commits" directive then landed on release. Mechanical stream → delta-log `[438]`–`[446]`.

## ⚠️ READ FIRST
- **PUSHED** (this wrap authorized "wrap and push"). Coherence 0/0 at close. If a re-check shows ahead>0, push again.
- **Boot mis-ID (resolved):** `/boot` first concluded "S244 continuing"; user corrected "244 is live." I am S245. The flobase `/boot` STILL lacks the concurrent-session step that would have prevented this (the S244-filed gap — routed to flogence). Watch for it on the next boot.
- **Open follow-ups (see below):** flogence `Kind` migration (notice sent) · standalone-build `pg` bundling (MED) · markup-context-§52-recognition · realtime live-PG e2e verify.
- **Live siblings at close:** S244's CSS worktree `a7888cfc` (locked) + S244's parked string-blind `a43632` — both RETAINED (not mine).

## ✅ LANDED THIS SESSION (S245) — all pushed
| Feature | commit | notes |
|---|---|---|
| Realtime **`<channel watches=>` Phase 2** (runtime) | `bfaf9ae5` | trigger install + bundled-`pg` LISTEN bridge + client `__change` dispatch + protect-egress. SPEC §38.13 Nominal→Implemented. 3 LOW residuals in the change-dir GAPS.md. |
| **http client-inline** private-helper closure (MED) | `19282549` | `_inlineSiblingShimImports` transitive same-file closure; member-access-exclusion keeps §3-Math clean. |
| **E-CG-001** protected-field regex-division evasion (**HIGH**) | `bb3a73b2` | S244's finding; acorn-exact FAIL-CLOSED egress scan; decouples security scan from the mangle scanner (root fix); closed computed+destructuring siblings free. |
| **export-enum library emit** (MED, rediagnosed) | `43e72e0d` | `emit-library.ts` now EMITS exported enum runtime reps (was erasing them + dangling `export`); companion typed-fn-sig strip. |
| **§52-composition** (watches← authority) | `325ceb36` | `collectSchemaTables` sources shape from a §52 `authority="server" table=` decl; SPEC §38.13 example→`${}` form. |
| **E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE** | `9485a006` | error (not silent-drop) on lowercase enum names (§14.4); the "lets error" ruling; +coupled export-enum §8 test reconcile. |

## 📋 NEXT-START / OPEN THREADS
1. **flogence `delta-log` `Kind` uppercase migration** — its `Kind:enum = {rule,disp,land,…}` now errors `E-ENUM-VARIANT-CASE` (loud, intended). Notice sent to flogence inbox. Until migrated, `delta-log.scrml` won't compile. (Or the user relaxes the §14.4 rule later — the deliberation `[442]` is on record.)
2. **standalone-build `pg` bundling** (MED) — `scrml build` deploy doesn't bundle `pg`; realtime dev-verifiable now, production-deployable after. GAPS.md in `docs/changes/realtime-channel-watches-phase2-2026-07-07/`.
3. **markup-context §52 recognition** — a `<Order authority="server" table=…>` as a direct `<program>` child is silently NOT recognized as a §52 decl (default-logic §40.8 auto-lift doesn't cover it); the `${}` form works. A separate pre-existing default-logic gap surfaced by §52-composition.
4. **Realtime live-PG e2e verify** — the one thing no test env covers (real commit→NOTIFY→client-patch); owed before realtime GA. Also: the compiler-bundled-`pg` decision means the emitted server needs `pg` present.
5. **3 realtime LOW review residuals** (GAPS.md): LISTEN-retry client `.end()` · multi-instance trigger-install race · pre-existing arm-scanner backtick/regex/comment blindness (reuse S244's `literal-scan.ts` if it revives).
6. **Pre-existing surfaced (not filed as formal gaps):** false `W-WHITESPACE-001` on every §52 authority type-decl (`tryParseServerAuthorityDecl` hardcodes `openerHadSpaceAfterLt`); `W-LINT-013` Vue-`@click` ghost on `@x=@x.map(...)`; `E-CHANNEL-WATCHES-UNKNOWN-TABLE` message could mention the §52 alternative.

## 🧭 METHODOLOGY / ANOMALIES (the irreducible reasoning)
- **S239 adversarial review earned its keep again — on OUR OWN dispatches.** The auto-reviewer STALLED on realtime P2 (stream watchdog) → I completed it MANUALLY by reading the parser+emitter (structural proof) backed by the agent's tests. Lesson: reading the emitter proves byte-identical/structural properties MORE reliably than spot-compiles; the manual review is a valid S239 pass when the automated one dies + Bash is flaky.
- **Triage can be wrong TWICE and the agent catches it.** (a) `g-block-analysis-emit-foreign-underscore` filed as foreign-`_{}` → actually export-enum-erasure (I reproduced + minimized). (b) §52-composition: my "markup-context §52 compiles clean" was FALSE — it compiled because the decl was IGNORED as a dead markup node; the agent verified + corrected + implemented the recognized `${}` form. **Reproduce + verify the agent's premise, and let the agent correct YOURS.**
- **Landing-order test interaction.** The enum-error fix made flogence delta-log's `Kind` error → broke the already-landed export-enum §8 R26 test (which asserted delta-log compiles clean). Caught by the pre-commit gate on the enum-error commit. Fix = a coupled reconcile (update §8 to expect the error) in the same commit. **A fix that changes a shared adopter-fixture's compile result must reconcile the sibling test that used it.**
- **Concurrent SPEC.md on a shared checkout.** S244's CSS §65 + my §52 (§38.13) + enum-error (§14.4/§34) all edited SPEC.md from divergent bases. Landing rule: **file-delta the code (disjoint), but apply the SPEC sections by `git apply` patch** (§38.13/§14.4 untouched by §65 → clean context) — NEVER wholesale file-delta SPEC.md (clobbers §65). Verified §65 intact after each apply.
- **Design ruling `[442]` — uppercase enum variants.** The casing is load-bearing for the parser's `Type.Variant`/`.Variant` vs `receiver.member` disambiguation (not merely convention); user ruled keep-the-rule-but-error. The silent-drop was a real miscompile class. `E-ENUM-TYPE-CASE` is a hard error, distinct from the name-resolver `W-CASE-001` warning.

## 🚦 STATE @ CLOSE
- **git:** scrml HEAD `9485a006`; PUSHED (coherence 0/0). Branch = main. Working tree clean post-wrap.
- **Board:** live via `bun scripts/state.ts`. Resolved this session: g-block-analysis-emit-foreign-underscore · g-http-client-inline-private-helper-drop · g-ecg001-protected-field-regex-division-evasion (HIGH→0) · g-realtime-external-db-writes (Nominal→Implemented, Phase 2) · g-channel-watches-schema-vs-52-authority-composition. NEW: standalone-build-pg-bundling (MED) + the pre-existing surfaced items.
- **Worktrees:** MINE cleaned (adb1d08f/aa8308cf/afff7ab7). RETAINED: `a43632` (S244 parked string-blind) + `a7888cfc` (S244 CSS, locked/live).
- **Tests:** full pre-commit gate green at each landing (final 19598/0 at enum-error).
- **Maps: REFRESH OWED (deferred again).** Watermark `66a3afb1` / 2026-07-04 — now ~40+ commits stale (deferred S243/S244/S245). A mid-wrap incremental on that staleness is marginal; needs a dedicated full `project-mapper` pass at a clean session (the S244 CSS worktree `a7888cfc` was also live at this wrap). Not silently skipped — explicitly carried.

## pa.md directives in force (Profile A)
R1–R5 · S239 adversarial review (incl. manual-when-auto-dies) · S138 R26 · S67 file-delta + `git apply` for concurrent SPEC.md · S147 coherence · S88/S90/S99/S126 · S136 BRIEF archival · S219 orchestrate + default-GO · concurrent-session board · commit-to-main only after authz (given; "hold commits" honored then lifted).

## Tags
#session-245 #close #6-landings #realtime-p2-runtime #ecg001-high-security #export-enum-rep #52-composition #enum-case-error #lets-error-ruling #hold-commits-honored #concurrent-css-65 #pushed
