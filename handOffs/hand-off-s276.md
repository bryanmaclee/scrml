# scrml — Session 276 (bryan) — WRAP

**Date:** 2026-07-20 → 2026-07-21. A **recovery + adversarial-gate** session. Recovered S275's stranded continuity (the 4th unwrapped death), then took adopter #27 navigate Wave-1c from "complete, staged, uncommitted" to **PR-1 LANDED (#124)** — through THREE rounds of adversarial review that found **six BLOCKING defects**, every one past a green suite. Solo.

## ⚠️ READ FIRST — state as of close
- **scrml main = `c48e59a2`** (#124 Wave-1c PR-1). Coherence **0/0** both repos. Gate GREEN.
- **Suite: 21012 pass / 0 fail / 68 skip.** Outlet suite 16 → **25**.
- Mechanical state (counts / recent deltas / board) lives in `handOffs/delta-log.md` **[667]-[676]** and the flogence digest — not duplicated here.

## 🎬 WHAT LANDED — #124 (`c48e59a2`) Wave-1c PR-1
Marker-driven MPA shell composition + the **ONE-LANDMARK invariant** (bryan-ruled S276):
> *Exactly one `<main>` landmark per composed document; the MARKER decides the slot, never the tag.*

Four cases: (1) `<outlet>` alone → `<main data-scrml-outlet tabindex="-1">`; (2) `<outlet>` inside an author `<main>` → `<div>`, author's main is the landmark, LEGAL; (3) route body owns a `<main>` → slot demotes, LEGAL; (4) BARE/SIBLING `<main>` + `<outlet>` → `E-OUTLET-AND-MAIN`, the ONLY error. SPEC §20.8.1.1 + §40.8.2 (composition was previously UNSPECIFIED) + §34.

**Measured gap-closure** (`docs/website`, 98 route docs, shell `<main>`→`<outlet>`): base **0/98** had exactly one `<main>`, 1/98 carried the marker, 1/98 had shell chrome — composition never ran for 97/98. After: **98/98** on all three.

**§20.8 banner deliberately NOT flipped** — pieces 2+3 are held, so cross-chunk soft-nav stays Nominal (Rule 4: no false spec-ahead claim).

## 🔴 OPEN — needs bryan (nothing else is blocked)
1. **MED-1 conditional-`<main>` fork — bryan RULED "your leans" = DIAGNOSE it.** A `<main>` only in a non-initial match/engine arm, or behind `if=` (parked in a `<template>`), is absent on first paint and present after the flip. Demote-conservatively → ZERO landmarks initially; ignore → TWO after the flip (invalid HTML). **Neither satisfies "exactly one" at all times.** Ruled resolution: extend the case-4 family to a conditional shell `<main>` coexisting with an `<outlet>` ("two candidates, only the author can resolve it"). NOT implemented; deliberately NOT pinned by a test — pinning either behaviour turns the eventual fix red.
2. **MED-3 component-mounted `<main>` under-fires case 4 — ruled "your leans" = reconcile.** `collectOutlets` (SYM) runs pre-expansion, `treeHasAuthorMain` (emit) post-expansion. Emit is CORRECT (demotes); only the diagnostic disagrees. Reconciling the two phases was bigger than PR-1's scope.
3. **Wave-1c pieces 2+3 remain HELD** behind 3 confirmed HIGH gaps (below). bryan RULED **option (a) IIFE-wrap chunk top-level lexicals** for the collision — scoped as its OWN arc (it changes how every chunk is emitted).

## 🧪 THE THREE ADVERSARIAL ROUNDS (the session's real content)
Every finding was **PA-reproduced before acceptance**; nothing taken on a reviewer's argument or an agent's self-report.

**Round 1 — the full 3-piece Wave-1c (agent `a2ed…` @ `8fd5fd07`, never landed): 5 BLOCKING.**
- cross-chunk **lexical collision** — two chunks each declaring a top-level type/enum of the same name emit duplicate top-level `const`s; executed both real chunks in ONE shared `vm` context → `SyntaxError: Can't create duplicate variable: 'Phase_toEnum'` → onerror → hard-nav. Feature silently degrades to the full reload #27 was filed about. Exposure MEASURED: imported types compile to one shared chunk and are NOT re-declared per importer (trucking clean), so it needs two files each declaring locally.
- **concurrent-nav flag race** — `_scrml_chunk_loading` is one module-scope boolean cleared by a per-script `settle()`; drove two overlapping navs through the real loader → `chunkB flagAtExec=false booted=FALSE`, and nav2's onDone STILL fired → swap proceeds with dead markup, permanently.
- **basename-collision** in already-loaded detection → unhydrated swap.
- `E-OUTLET-AND-MAIN` scoped wrong in **both** directions.
- **The browser harness is structurally blind** to the first two: direct `eval` (fresh declarative scope) + an `appendChild` override that returns nodes WITHOUT connecting them.

**Round 2 — PR-1 as built (`01aaad71`): 2 BLOCKING + 5 MED.** Splice with no depth counting (a stray close **reparented `<footer>` out of its container** and silently destroyed content); landmark decision invocation-scoped → nested `<main>` from a match arm. **The test oracle shared the implementation's blind spot** (`mainCount()` counted `<main` inside `<template>`/`<script>`) — which is why 16 green tests missed an entire ZERO-landmark class.

**Round 3 — on the PA's OWN fix delta: 1 BLOCKING.** An outlet **PLACEHOLDER** `<main>` (content composition discards) counted as the document landmark → composed routes had ZERO landmarks. **The obvious one-liner was WRONG** and I verified both shapes on base before choosing: skipping `<outlet>` bodies in `treeHasAuthorMain` fixes the composed case and breaks the rendered one (single-file, no pages → TWO `<main>`). Emit-time cannot tell those futures apart; composition can — so the fix is the mirror of `routeOwnsLandmark`, applied at composition.

## 🧭 RECOVERED-FROM ANOMALIES (reasoning, for the next PA)
- **S275 died pre-wrap — the 4th unwrapped death** (S266→S268, S269→S271, S273→S274, S275→S276). Its record survived ONLY in delta-log [662]-[666]; hand-off was stale at S274, no board file, no user-voice. All reconstructed this session, S275's user-voice entry recovered VERBATIM from its session JSONL.
- **I reported a drift conclusion BACKWARDS and bryan caught it.** On the `<main><outlet/></main>` contradiction I said "SPEC is self-consistent; only RULING.md is stale." bryan: *"go deeper… look in .claude sessions dir for the transcript."* The JSONL showed the approved text was *"a shell with both a **bare** `<main>` and an `<outlet>` → error"* — **"bare" is load-bearing**. RULING.md was FAITHFUL; the IMPLEMENTATION dropped the word, errored on any co-occurrence, dragged the SPEC text along, and **locked the overreach in with a test literally titled "…(nested) ALSO fires E-OUTLET-AND-MAIN"** — so it read as intent. **DURABLE: when a derived artifact and the impl disagree, go to the verbatim session log before deciding which drifted. A terse "A"/"go" ratifies the FULL text it answered, sub-choices included. A test asserting a behaviour is NOT evidence it was ruled.**
- **A false-green R26.** A run printed `DIFF: NONE` while `wc`/`head` had transiently dropped off PATH and the tip compile produced nothing — `diff` was comparing MISSING directories. Caught only because the file counts came back empty. **Every later R26 asserts both trees are non-empty BEFORE trusting the compare.**
- **I destroyed my own uncommitted work.** Running `git checkout` to revert source (to prove a fixture fails pre-fix) wiped the promotion fix, which wasn't committed yet. Caught by checking the fix was still present rather than trusting "restore". Re-applied + committed immediately. Don't run revert experiments with uncommitted source in the tree.
- **The main checkout was a HOLDING PEN** all session (old 3-piece staged tree on `feat/navigate-wave1c`). It blocked the post-merge fast-forward twice. Resolved by backing up, confirming the staged content was byte-identical to agent branch `8fd5fd07` before discarding, and proving the continuity edits were a clean **prefix match** before restoring.

## 📌 known-gaps filed this session (6)
`g-nav-chunk-lexical-collision` (HIGH, IIFE-wrap RULED) · `g-nav-chunk-loading-flag-race` (HIGH) · `g-nav-chunk-basename-collision-key` (HIGH) · `g-nav-browser-harness-fidelity` (MED) · `g-mpa-composed-page-duplicate-runtime-script` (MED, PRE-EXISTING — composed route pages emit the runtime `<script>` twice, one 404s) · `g-nav-cross-chunk-hardening-tail` (LOW, 7 items incl. no same-origin check on injected chunk URLs).

## 🧷 Held branches / worktrees
- `worktree-agent-a2ed001a5de228134` @ `8fd5fd07` — **RETAINED**: the only copy of Wave-1c pieces 2+3. Do NOT delete until 2+3 land.
- `feat/navigate-wave1c` (local, 0 commits) — holding-pen branch, now empty of value; safe to delete.

## 🗺️ 6c maps — REFRESHED (S274's partial run closed)
5 maps rewritten to stamp **`c48e59a2`** (watermark verified advanced): `domain.map.md` (the S274 miss — now carries §14.8.10 tenant floor, §52.15.5 SSR auto-make-safe, and a dedicated §20.8.1.1/§40.8.2 section with the four-case table + the three-stage ownership split: emit-html = landmark, index.ts = composition slot, symbol-table = diagnostic) · `error.map.md` (+`E-OUTLET-AND-MAIN`) · `structure.map.md` (counts were stale) · `dependencies.map.md` · `primary.map.md`. **Deliberately left at older stamps** (recorded in-map, not silently skipped): `schema`/`test`/`auth` @ `df2ac831`, `build` @ `99ae45ca`, `config`/`infra` @ `f079d0a9` — #124 added no AST type, CLI flag, env var, or CI change; an honest older stamp beats a false "verified at HEAD".

**Non-compliance — 3 FIXED this wrap, 3 OWED:**
- ✅ FIXED — `docs/changes/navigate-wave1c-cross-chunk/progress.md` claimed *"FINAL STATUS — Wave-1c COMPLETE (all 3 pieces)"*, **false at HEAD** and never true of main. Correcting banner added; the file is retained as the forensic record of the survey + 3-piece build, and now points at `navigate-wave1c-piece1-landmark/progress.md` as current truth. **Committing it uncorrected would have planted a false landed-claim** — the single highest-value catch of the maps pass.
- ✅ FIXED — SPEC gap: slot **RE-PROMOTION** was implemented (`index.ts` `slotShouldPromote`) but unspecified; §40.8.2 specified demotion only. Normative clause added (land-with-impl, Rule 4).
- ✅ FIXED — `symbol-table.ts:10081` referenced a bare `W-OUTLET-ABSENT`, which is not a real code (no fire site, no §34 row); it read as a fifth outlet code to anyone grepping. Corrected to `W-OUTLET-ABSENT-SOFT-NAV-DISABLED`.
- ⬜ OWED — `compiler/native-parser/` has had **ZERO diff** across the whole `df2ac831`→`c48e59a2` window; parity for GITI-038/039 and the new outlet/landmark surface is **unconfirmed, not confirmed-drifted**. Carried from the prior map report.
- ⬜ OWED — `error.map.md`'s catalog-count methodology is unresolved (carried 787 vs a raw §34 extraction differ by ~1; the raw grep over-matches sibling tables, so neither is authoritative). Flagged in-map as not independently re-verified; a full count audit is owed at the next cold-start. Both of this window's legs ARE set-diff-confirmed against the actual SPEC diff.
- ⬜ OWED — `.claude/maps/non-compliance.report.md` still carries its `df2ac831` stamp; the six items above were returned inline rather than written to it.

## pa.md directives in force / lessons
Adversarial-not-confirmatory is now **4-for-4** on this arc (#111, #120, and twice here) — confirmatory green is worthless as a landing signal · verify-before-claim in BOTH directions · **fix the test ORACLE before the code** when the oracle shares the implementation's blind spot · `tracking`/`ai-review` CI failures are pre-existing (verified on #120-#123); only `gate` is required · PR-flow: branch → PR → gate → squash-merge → re-sync → 0/0.

## Tags
#session-276 #wave1c-pr1-LANDED-124 #one-landmark-invariant #six-blocking-caught-past-green #oracle-shared-the-blind-spot #s275-continuity-recovered #transcript-adjudicates-drift #pieces-2-3-held #iife-wrap-ruled
