# scrml — Session 227 (CLOSE)

**Date:** 2026-06-27. **Profile:** A — FULL (booted via `/boot A`). A **board-sweep + inversion-build** session: HIGH cleared + 3 MEDs resolved via a 4-lane dispatch sweep, dpa-015 ratified, **inversion domino-1 (investigation-as-query) WIRED**, the transcript-parse validation run, and two design threads kicked to flogence. Mechanical stream → `handOffs/delta-log.md` [176]–[185] + flogence digest (`bun ../flogence/scripts/digest.ts scrml --fresh`).

## 🚨 NEXT-START
Boot Profile A. Board @ close: **HIGH 0 · MED 8 · LOW 11 · Nom 7 · v0.7.0** (known-gaps §0). **NO design gates block the board.** Suite 25680/0/214 (1118 files). **PUSHED** (4 commits: scrml 3 + scrml-support 1 — see §push). **Maps refreshed to HEAD** (hand-update; watermark dec70dce).

**The strategic frontier (carried):** the PA-continuity INVERSION is staged-LIVE; this session WIRED domino-1 (dock investigation-as-query) + VALIDATED the 85/15 thesis by token. The next inversion lever is **tier-2 judgment-capture** (the transcript-validation's crux — see §design). The board remainder (8 MED / 11 LOW / 7 Nom) is fresh cold work for a clean boot.

## ⏸️ OPEN — S228 board
**Fireable lanes (sPA — user fires; PA slots; use `dock --units <file>` to scope owned-blocks per the S227 dock-wiring):**
- **Tier-2 Round-2:** `g-component-body-markup-parser-absent` (ast-builder.js, open-ended — component bodies w/ `<engine>` unreachable) · `g-native-inline-struct-return-twin` (native-parser; S222-frozen, robustness-only).
- **Tier-2 Round-3 (collision-hub / lower-value):** `g-tier1-ssr-prerender` (open-ended; collides type-system + emit-server) · `g-library-mode-sql-no-db-context` (multi-stage; shares emit-server w/ g-tier1) · `bug-14` (MCP runtime) · `r28-c2` (docs).
- **Tier-3:** 11 LOWs → one `low-ingestion-cleanup` sPA (ss27 precedent). `a5` is friction-GATED (defer).
- **dpa-012 lints + §40 phase-spec** (ratified S225, queued build).

**Inversion build path (no design gate):**
- **dpa-015 `conflictsWith` build** — RATIFIED-direction (Q2-collapse), STAGED: WARN-now @object-grain buildable; GATE gated on the field-grain DG redesign (BREAK-1) + the R/W-partition query. Not adopter-facing → deprioritized. scrml owes: `conflictsWith`/`--emit-region-touch-map` (W3.5).
- **Tier-2 judgment-capture (the transcript-validation crux)** — the ~1/3-of-warm-context bookkeeping-write mass; its mechanism = the flogence doc-maintenance / docs↔code-ID thread (kicked to flogence S227). The make-or-break for the big amortization (~1.5x vs ~5.5-8.5x).
- **token-set emit contract** — scrml owes this to flogence when it fires the docs↔code-ID DD.
- **dock polish:** bare `dock --units` (no file arg) crashes (`toRel(undefined)`) — print usage instead.

## 🎯 Design narrative (IRREDUCIBLE)
**1. dpa-015 markup-lease RATIFIED (Q2-collapse).** scrml's compiler subsumes block-lease's FACTS (block-analysis + §40.9 `conflictsWith`); flogence keeps the thin lease-COORDINATION. **Cost corrected from "near-free"** by the OQ-1/OQ-2 fact-checks: §40.9 solver output is reads-only/undifferentiated (no R/W partition — a query BUILD), §31 DG coarsens `@obj.field` to OBJECT grain (field-grain GATE needs a DG redesign = BREAK-1). STAGED WARN-now@object / GATE-gated. Authority: dpa-queue dpa-015 PA-resolution + delta-log [176][177].

**2. Inversion domino-1 WIRED — investigation-as-query via dock.** dock `--units <file>` (def-map, anti-blind-grep) + `--diff-scope --owns` (post-landing stray-check) codified into pa-scrml.md (scrml-support 5084f56). Empirical motivation: this session's gap LOCUS-hypotheses were **3/3 WRONG** (g-mount-hang→emit-client not nativeParseFile · g-ternary→ast-builder not tokenizer · g-auto-await already-fixed) — all from blind-grep/stale-prose. dpa-010 constraint locked: dock = NAVIGATION, never the GATE. (`.scrml`=AST; `.ts`=regex — the `#dock` provenance tokens stay dormant 0/628.)

**3. Transcript-parse validation — the 85/15 holds, and located the crux.** By total-token (the warm-context-filling metric): churn 81.8% (S226) / 88.3% (S220), bracketing 85%; judgment 11-18% (lower bound — redacted-thinking). 3-TIER amortization: (1) ~30-37% cleanly-offloadable (find/test/intake → ~1.5x live-now win); (2) **~27-33% THE CRUX = bookkeeping-writes (churn mechanism, judgment substance — offloadable only if judgment-CAPTURE solved)**; (3) ~11-18% irreducible floor. Ceiling: substrate-only ~1.5x; +bookkeeping-externalized ~5.5-8.5x. **The crux IS the flogence doc-maintenance/judgment-capture thread.** n=2 PRE-inversion sessions; a post-inversion session is the real test (re-run `scratchpad/churn_judgment.mjs`).

**4. Compiler-self-block-lease = a SELF-HOST DIVIDEND.** TS does NOT ride the compiler (regex, not AST). Compiler-source block-lease is usable NOW at regex/navigation-grade; AST-grade drift-free block-lease ON THE COMPILER ITSELF materializes when the compiler is scrml (Road-B reimagining, S222) — a new compounding argument FOR Road-B (compiler = first-class citizen of its own provenance graph).

## 🛟 Recovered anomalies / lessons
- **isolation-omission fumble** — I omitted `isolation:"worktree"` on the first dispatch of lane1+lane2 (the S88 trap, right after reading the S88 addendum). Both F4 gates STOPped clean (no writes/leak); re-fired correct. Watch the param.
- **crashed-lane salvage caught a real defect** — lane B (g-ternary) disconnected (ConnectionRefused) mid-work; salvaged its uncommitted ast-builder.js + test, and verifying caught an INCOMPLETE alternate-arm (its own test flagged it) → PA completed. Don't land crashed-agent work without running its tests (S215 validation).
- **gap locus-hypotheses 3/3 wrong** — see §design-2; the ingestion-disjoint scoping survived on luck; `dock --units` is now the locus-verification step.
- **commit-timeout-but-landed (×2)** — foreground commits timed out at 5min on the post-commit full-suite re-run but LANDED (S226 anomaly); verify HEAD before assuming failure.
- **import-resolution fixtures** — deleted by their OWN test during the suite run (not a stray leak — boot-time restore was futile); benign, suite green. Candidate LOW test-hygiene gap (a test mutating tracked fixtures).

## Board @ close
**HIGH 0 · MED 8 · LOW 11 · Nom 7 · v0.7.0.** Suite 25680/0/214. Landings: `02b4e71d` (lane1+2) · `dec70dce` (laneB) · `67ed2103` (boot-bookkeeping) · scrml-support `5084f56` (dock-wiring). 4 worktrees cleaned at wrap. Maps → dec70dce. Delta-log [176]-[185].

## §push
**4 commits pushed** (user "bank wrap"): scrml `67ed2103`+`02b4e71d`+`dec70dce` → origin/main; scrml-support `5084f56` → origin/main. **flogence:** 1 inbox message delivered (untracked, for flogence's PA): `handOffs/incoming/2026-06-27-1822-scrml-to-flogence-s227-pa-changes-and-docs-id-provenance.md` (PA-system changes + docs↔code-ID thread + compiler-self-block-lease addendum).

## pa.md directives in force
R1–R5 · `---` delimiter · Profile A · S219 PRIMARY-GOAL + flogence digest-boot · **S227 dock investigation-as-query** (structured-lookup front WIRED) · S226 inversion op + landing-concurrency · S88/S99/S126 path-discipline · S136 BRIEF archival · S138 R26 · S147 coherence · S215 adversarial-verify · wrap 8-step.

## Tags
#session-227 #close #board-HIGH-0 #4-lane-sweep #dpa-015-ratified-q2-collapse #domino-1-wired-dock-investigation-as-query #transcript-validation-85-15-holds #judgment-capture-is-the-crux #compiler-self-block-lease-selfhost-dividend #2-threads-to-flogence #3of3-loci-wrong-lesson #salvage-caught-defect
