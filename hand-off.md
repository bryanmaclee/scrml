# scrml — Session 282 (bryan) — WRAP

**Date:** 2026-07-22/23. Booted `/boot` Profile A on **`bryan-maclee-ASUS-Vivobook`** (the S278 machine) as a successor to two closed XPS sessions. **10 PRs merged**, `main` at `dc146119` before this wrap PR, coherence 0/0. Mechanical detail is in `handOffs/delta-log.md [741]-[752]` and `docs/changelog.md` S282 — not duplicated here. This carries the irreducible: the one open decision, the arc's exact resume state, and the recovered-from anomalies.

---

## 🔴 THE ONE DECISION THAT GATES NEXT SESSION

**BUG-6 is ruled and scoped, but the 16 KB SPA-runtime gzip budget is a pre-existing knife-edge, and it needs your call before the fix lands.** (`g-spa-runtime-gzip-budget-knife-edge`, HIGH.)

`v0-3-x-spa-tree-shake-phase-b.test.js:145` asserts the assembled SPA runtime is `< 16*1024` gzip. Scoping measured base `e8fdd44c` at **16,257 B — 127 B under**, with no chunk-namespacing changes present. So the budget was near-saturated **before this arc existed**.

- The **naive** accessor-rename (remove `_scrml_cell_scope`, keep `_scrml_cell_key`+`_scrml_cell_name` in core) → **17,531 B, FAILS by 1,147.**
- Only the **zero-core-residue** rename (inline key-derivation into each prologue; move the production-dead `_scrml_cell_name` into the test shim; trim the banner) → **16,255 B, passes by 129 B.**

129 B is **smaller than the ~200 B gzip whitespace-noise band** the scoping hit. So the rename is sound and CAN pass, but "passing" is not robust. **The fork:** (a) hold 16 KB, require zero-core-residue forever (every future core addition must be offset); or (b) raise the budget. The rename meets either. **Recommendation deferred to the execution session's re-measurement** — step 1 of the plan re-measures base; if it has drifted over 16 KB by then, (b) is forced regardless.

---

## 🧭 chunk-namespacing — EXACT RESUME STATE (do not re-derive)

**Mechanism COMPLETE and proven.** Acceptance flips CLOBBERED→isolated under **both** module formats; all three purpose-built fixtures (`wide/` N1+N2, `types/` N3, `engine/` N4) isolate in real Chromium. All three were **INCONCLUSIVE at base** — the second chunk threw a redeclaration error and never evaluated, so a naive before==after check would have false-greened the whole arc. The `INCONCLUSIVE` guard is why it didn't.

**Resume from:** agent branch `worktree-agent-a91ad13968b46ab5d` @ `4f816389` (worktree RETAINED). Base `e8fdd44c`.

**What is DONE on that branch:**
- **N1** (numeric node ids) — emission-time `nsId`, built + adversarially verified sound (SSR↔client token identity 19/19/19, zero orphans; the number→string call-shape change actually repairs a latent cross-chunk cache clobber).
- **R2** token anchored to **project root → git root → absolute path** (the third tier RATIFIED this session; `SCOPING.md §8`). D1/D2/D3 closed.
- **D4** — the OQ-3 artifact-diff gate was found **HOLLOW** (compared 8 of 115 files) and hardened to 446 files with the hollow-gate modes designed out. PASSES on all 10 corpora.
- **N2/N3/N4 built and proven** via a chunk-local scope; **partially migrated** — 673→162 test failures across two rounds.
- **6 real bugs** found in migration (the split-key-pair class — see below).

**What is LEFT (the ruled fix, next session):** the BUG-6 **accessor-rename** — the whole plan, ordered with per-step verification, is in **`docs/changes/chunk-namespacing/BUG6-RENAME-SCOPING.md`** (`status: current`). Key facts from it, verified by the agent:
- **ESM-crux: SOUND, no hole.** A renamed local (`_scrml_cs_reactive_get`) has a name distinct from the imported runtime accessor, so it never shadows it — which is exactly what attempt (a) died on. Module scope isolates the body; no IIFE needed for the accessor mechanism (`emit-client-esm.ts:359-362`).
- **Rename surface: ~959 accessor-call occurrences across 37 files** → do it as a **post-hoc Acorn callee-rename pass**, NOT per-emitter edits. The §3.1 enumeration is for verifying the pass's coverage.
- **Migration: 46 files / 160 per-file failures = 129 new vs the authoritative 31-name base set, 0 base failures masked.** Re-migrates **zero** already-done files IF `captureInsideChunkScope` + `unwrapChunkScope` are made rename-aware first (a two-helper change, §3.3).
- **N3/N4 closure preserved** under the rename (IIFE wrap + `nsName` are independent of accessor names) — confirmed by reading.
- **`E-CG-018` needs a §34 catalog row** — lands WITH the impl (named-codes-land-with-impl).

**The verification bar for the landing** (all on the FINAL tree, commit-labelled): acceptance CLOBBERED→isolated both formats real Chromium · both BUG-6 tests (§C10.1 tree-shake + the gzip budget) green · full suite name-diff clean vs `e8fdd44c` (the base set is **31 unique names**, from 34 lines / 3 dups — use 31) · artifact-diff PASS with its file count reported.

**Held branches feeding this — do NOT delete:** `origin/evidence/u4-premise-falsified` · `origin/worktree-agent-a2ed001a5de228134` + local `feat/wave1c-nav` (Wave-1c pieces 2+3, unblocked the moment chunk-namespacing lands). Once the arc lands, BOTH the classic Wave-1c loader and ESM U4 unblock; that closes adopter **#27**.

---

## ⭐ THE SESSION'S LARGEST OUTPUT — the SPLIT-KEY-PAIR bug class

`docs/audits/split-key-pair-sweep-2026-07-23.md` + `g-split-key-pair-class` + `g-pgnotify-listen-case-split`.

**The shape:** a lookup key concatenated from a source-level cell/engine NAME at the write site and rebuilt independently at the read site, with no shared key-builder. Any name transform (namespacing, aliasing, minification) splits the pair, and **the failure is SILENT** — the feature just stops working. **None is caught by the 28k-test suite, because a split pair passes every test that exercises one side.**

The chunk-namespacing arc found 4 (it forces both sides of every name-keyed identifier to move at once, which is the only thing that makes the class visible). A read-only sweep found **14 more, 10 silent.** The sharpest is CONFIRMED LIVE + PA-empirical: `g-pgnotify-listen-case-split` (HIGH) — `pg_notify('scrml_ordersFeed')` is a string literal (case preserved), `LISTEN scrml_ordersFeed` is a bare identifier (PostgreSQL folds lowercase), so any camelCase `<channel>` name delivers zero rows silently, and `sqlSafeIdent`'s docstring claims a lowercasing it never does.

**The durable fix is structural, NOT 14 point repairs:** one exported key-builder per key, called by both sides — the in-repo exemplar is `themeVariantAttr` (`emit-theme-reset.ts:195`, called by both the CSS emitter and the JS setter, cannot drift). §5 of the audit (the §55 validity surface with **five** independent implementations of one key predicate, two self-documented as "Mirror of") is the warning shot. The audit's checked-and-clean list is there so the next sweep does not re-walk it.

---

## 🎬 WHAT LANDED (10 PRs) — pointers, detail in changelog/delta-log

#150 `<each>` multi-root (adopter #141, PA-independent R26) · #151 **windows CI GREEN first time** (6 test-side path assumptions; promotion candidate for the blocking gate) · #152 tracking 15→9 · #153 continuity · #154 E-DG-002 attr-interp false-fire · #155 **NEW Stage 3.055 TC** (capitalized-tag registry resolution) · #156 gap currency · #157 split-key class · #158 the 14-instance sweep · #159 **SPEC §22.10 amended + R2 ratified**.

---

## 🔬 METHOD LESSONS (the durable output)

**The brief-authoring lesson, proven three times.** My symptom descriptions and governing-sentence citations held up; my proposed **mechanisms** did not, and twice the correction prevented a real bug:
- the TC brief proposed keying on `isKnownElementName` — which would have rewritten engine state children (`<Small rule=...>`, `<Title rule=.Playing>`) and corrupted the Mario state machine + 3 samples. The agent keyed on NR's `resolvedKind` stamp instead. PA-verified byte-identical.
- the DG brief scoped the bug to `class` attributes — the miss was in the value SHAPE, so class/style/title/data-*/aria-* all shared it.
- the R2 ruling ("hard error on unresolvable root") failed 434 test files; the agent proposed the strictly-more-injective filesystem-root tier.
**Going forward: a brief states the symptom + governing sentence as findings, and marks the mechanism explicitly as a hypothesis to verify.** The agents did that anyway, which is why it worked.

**Verify-the-hand-off, three times.** S280 said the maps were `9481bc69`/blind to the ESM arc (S281 had refreshed them; refreshed again inside `d3e961de`; all 6 "invisible" symbols present — a cold `project-mapper` run would have been the S248 no-op). S281 said "main fails its own gate" (does not reproduce here, 21129/0 — XPS-clone-local). S280 said #148 was open (merged). **A hand-off is a derived doc; check it against git before spending a dispatch on it.**

**Scope-estimation from a proxy, the agent's own lesson, applied to me too.** Its "143-file migration" came from a classifier matching `globalThis.X=` but not `window.X=`; 149 of 198 "unclassified" were one shared harness. The BUG-6 scope would have said "remove `_scrml_cell_scope` and the size test passes" — measuring showed removal alone leaves it 1,147 B over. **Measure the number that matters; do not reason from the proxy for it.**

**The adversarial gate + R26 earned their cost outright.** They caught a green acceptance test that didn't reproduce (the chunk-namespacing report's SURVIVED table was measured with N2 wired, before N2 was held out), a merge gate that had checked 8 of 115 files, and the two brief-mechanism bugs above.

---

## ⚠️ PA PROCESS SLIPS (3, recorded honestly)

1. **Branch leak onto local `main`.** After `gh pr merge` + `git checkout main && git pull`, I edited + committed without cutting a branch — the commit landed on local main (the S142 class). Caught by the S147 coherence check (`0 1` not `0 0`) + branch protection would have rejected the push. Recovered clean via cherry-pick onto the branch + `git branch -f main origin/main`. **The next edit after a merge+pull is where this happens — cut the branch first.**
2. **E-SQL-009 wrong-shape reproducer.** Nearly closed a live silent-data-loss gap by testing a `<program>` (fires E-SQL-004, the `db=` attribute) instead of a pure-fn file (fires E-SQL-009, the `<db src>` element). Caught by the Rule-4 governing-sentence gate. Trap recorded in the gap.
3. **The wrap-reflex, 4th recurrence** (`~48%`, disguised as care for the next session's quality). bryan: "48% is hardly fumes." Memory updated with the generalized tell: the reflex always arrives as a reason that sounds like good judgment. `[[feedback_dont_wrap_at_43_percent]]`.

**Recurring mechanical friction:** every doc PR that moves a figure `FACTS.md` publishes (compiler LOC, test count, SPEC line count) trips the facts gate — 3 PRs this session round-tripped through a red gate. **Pre-regen `bun scripts/facts.ts --write` before pushing any PR that touches `compiler/src`, tests, or `SPEC.md`.**

---

## 🧷 OTHER OPEN / HELD

- **The inbox message `2026-07-22-2230-from-S282-to-XPS-…`** is MY outbound notice to the XPS clone (union merged, install now, its two HIGHs don't reproduce here). It lives in `handOffs/incoming/` and is unread FOR XPS by design — the boot hook will keep flagging it here until that machine consumes it. Leave it; it is not for this machine.
- **`E-CG-018` §34 row** — with the chunk-namespacing impl.
- **The split-key-pair sweep's 13 non-live instances** — structural fix (one shared key-builder per key). `g-pgnotify` (HIGH) is the one that's live today, but gated behind `<onchange>` being Nominal.
- **Two XPS-clone-local HIGHs narrowed:** `g-main-red-against-its-own-pre-commit-gate` + `g-commit-gate-absent-on-bryan-xps-8950` — both are XPS environment, not tree; the fix there is `bun run pretest` then re-check.

## Tags
#session-282 #windows-canary-green #split-key-pair-class #pgnotify-case-split-live #chunk-ns-mechanism-proven #bug6-accessor-rename-scoped #gzip-budget-knife-edge #brief-mechanism-is-a-hypothesis #branch-leak-recovered

## 🗺️ Maps
`primary.map.md` stamped `e8fdd44c` (content-verified current this session, not regenerated — the ESM-arc symbols S280 flagged as missing are all present). The two new S282 stages/files (`tag-canonicalizer.ts` Stage 3.055, the chunk-namespace codegen once it lands) are NOT yet in the maps — refresh at the chunk-namespacing landing, since that arc adds the bulk of the new surface.
