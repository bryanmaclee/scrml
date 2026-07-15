# non-compliance.report.md
# project: scrml
# generated: 2026-07-14T18:58:34-06:00
# scan mode: FULL_COLD_START (maps refresh fbb4d9fd -> f079d0a9, 137 commits)

## Summary

This pass is a re-verification of the prior FULL_COLD_START scan (fbb4d9fd, 2026-07-09) plus a
targeted sweep of the 137-commit delta since then. Full read of all ~1240 in-scope `*.md` files
was NOT performed (infeasible at this scope/turnaround, same constraint noted in the prior scan);
this is a name/date/location-heuristic sweep + spot-checks of the biggest landings this window
(§20.8 Client Router/outlet, §64.9 `serve=` tool target, the jwt-auth-bypass fix, the real-DB
conformance adapter), cross-checked with `grep` against current source where a doc makes a
falsifiable claim. Items below are individually verified; anything outside this sweep should be
treated as unscanned, not implicitly compliant.

Carried-forward items (re-verified, unchanged): 8 doc clusters (6 non-compliant, 2 uncertain)
New this window: 0 non-compliant, 1 new-but-compliant (dated, current)
Resolved since last scan: 0 (no previously-flagged items were fixed/moved this window)

## Carried-forward — Non-compliant docs (re-verified still present, still non-compliant)

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** content-heuristic (self-marked superseded) + date (2026-05-21, 54+ days stale vs. current SPEC.md mtime 2026-07-14)
**Detail:** Opens with "⚠ SUPERSEDED S117 (2026-05-21). This Phase-0 decomposition's R1-R5 / 46-78h estimate was itself under-counted..." — the document declares its own staleness. Unresolved since the prior two scans (948d3f2f, fbb4d9fd).
**Suggested disposition:** deref to scrml-support/archive/.

### compiler/native-parser/M5-ast-bridge-scoping.md, M5-divergence-ledger.md
**Reason:** date (2026-05-21, 54+ days stale) + content-heuristic (describes the native-parser's THEN-current AST-bridge scoping contract as a load-bearing precondition for the pipeline-swap)
**Detail:** Still unresolved. The native-parser has grown further since (37 paired .js/.scrml files, unchanged count vs. last scan, but the M5/M6 milestone ladder referenced by these docs has continued to move — this window's compiler/native-parser/ diff shows no structural change, so these docs' currency status is unchanged from the prior finding, not newly stale).
**Suggested disposition:** uncertain — needs human review (re-verify against current native-parser/ + native-parser-canary/within-node-classifier.ts, or deref to archive if superseded by a later contract doc).

### compiler/native-parser/M6.6-CONTRACT-DERIVATION.md
**Reason:** date (2026-05-23, 52+ days stale) + content-heuristic ("developer reference for b.2-b.4 consumer migration off the live engine-statechild-parser.ts")
**Detail:** Describes a migration-in-progress cookbook contract. Carried from two prior scans as "verify current"; still unverified this pass.
**Suggested disposition:** uncertain — needs human review.

### docs/changes/v0next-inventory/{SCOPE-MAP,SCOPE-SUPPLEMENT,ARTICLE-TRUTHFULNESS-AUDIT}-2026-05-0[5-7].md
**Reason:** location (docs/changes/ dispatch-archive, correctly parked) + date (2026-05-05/07, 70+ days stale) + content-heuristic (v0.next planning inventory, now doubly superseded — was already behind at the last scan, and the repo has since shipped §20.8 Client Router/outlet and §64.9 serve= on top of the v0.3+/v1.0-Wave-1 surface it was already behind)
**Detail:** Unresolved from two prior scans. No change this window.
**Suggested disposition:** already correctly archived under docs/changes/ (designated dispatch-archive location) — no move needed, but content should not be treated as a live scope reference by any dev agent.

### docs/audits/{null-audit-compiler-src,undefined-audit-compiler-src}-2026-05-13.md, article-truthfulness-audit-2026-05-21.md, bug-51-class-corpus-coverage-audit-2026-05-28.md, docs/language-inspiration-audit-2026-06-06.md
**Reason:** date (39-62 days stale vs. current SPEC.md mtime) + name-heuristic (`-audit-`)
**Detail:** Point-in-time audit snapshots, unresolved from the prior scan. By nature these age (an audit records "as of date X"); the risk is a dev agent grepping docs/audits/ for current null/undefined hygiene status without checking the date. Contrast the two NEW audits this window — `docs/audits/stdlib-completeness-2026-07-08.md` and `docs/audits/windows-canary-2026-07-14.md` — both current (0-6 days old), NOT flagged.
**Suggested disposition:** no forced move (audits/ is a reasonable point-in-time home), but recommend a one-line "supersedes/superseded-by" pointer chain if a newer audit exists for the same surface.

### docs/heads-up/{const-deep-freeze,lifecycle-annotation-extension,iteration-design}-2026-05-2[5-6].md
**Reason:** date (49-50 days stale) + name/location heuristic (docs/heads-up/, open-question-resolution genre)
**Detail:** RE-VERIFIED this pass (not just carried forward blind): all three now carry explicit frontmatter status. `const-deep-freeze-2026-05-26.md`: `status: ratified`, `phase: closed` — a settled decision record, not aspirational; reclassifying from "uncertain" (prior scan) to compliant/informational. `lifecycle-annotation-extension-2026-05-25.md` and `iteration-design-2026-05-25.md`: both `status: historical`, `last-reviewed: 2026-05-29`, explicitly self-labeled "historical record" with an arc-complete note. Reclassifying these two from "uncertain" (prior scan) to compliant/informational as well — they no longer misrepresent themselves as live design state.
**Status: DOWNGRADED from non-compliant/uncertain to informational** (see "Informational" section below) — this is the one item resolved-by-reclassification this pass, driven by frontmatter this mapper had not previously read closely.

## Carried-forward — Uncertain docs (needs human review)

### docs/heads-up/spec-consolidation-2026-05-25.md
**Reason:** frontmatter `status: in-progress` (STILL, unlike its three siblings above) + date (2026-06-25 last touch, 19 days stale) + content-heuristic (references an explicitly OPEN question: "state-dynamics-design DD extension question ... status: active since 2026-04-08 — open extension question" and a "Mutability-contracts article draft (status: draft, not shipped; revise before publication)")
**Detail:** This is the one heads-up doc that genuinely differs from its siblings — it still declares itself in-progress and points at an unresolved DD + an unshipped draft article. Unresolved from the prior scan (carried as "uncertain").
**What to check:** whether the state-dynamics-design DD extension question has been ratified since 2026-04-08 (check scrml-support/archive/deep-dives/ + design-insights.md), and whether the mutability-contracts article draft has shipped or been retired.

## New this window (spot-checked, verified compliant)

### docs/audits/windows-canary-2026-07-14.md
**Reason for spot-check:** newest doc in the repo, same-day as HEAD.
**Verdict: compliant.** Dated today, describes the Windows CI canary pass (`.pathname` → `fileURLToPath` codemod verification) — content matches the actual landed commit 95a912c3. Not flagged.

### docs/changes/server-program-shape-v1/SCOPING.md
**Reason for spot-check:** a "SCOPING" doc (per the memory note that SCOPING/cookbook claims can be wrong) for the flagship §64.9 `serve=` feature.
**Verdict: compliant, correctly archived.** Describes the Unit 1/Unit 2 dispatch decomposition that has since landed (commits 0bb16591, 74e22ea3) — verified against SPEC.md §64.9 and the E-TOOL-SERVE-* fire sites (see error.map.md). Parked in the designated docs/changes/ dispatch-archive location; not a live scope reference.

### docs/changes/navigate-wave1a-outlet-shell/BRIEF.md, navigate-wave1b-finish-2026-07-12/BRIEF.md, navigate-wave1b-runtime/BRIEF.md
**Reason for spot-check:** the §20.8 Client Router flagship, whose own SPEC section carries a "Nominal / spec-ahead" banner that could mislead if a dev agent treated it as fully unshipped.
**Verdict: compliant, correctly archived.** Dispatch-prompt archives for work verified landed (E-OUTLET-*/W-OUTLET-* fire sites + browser tests, see domain.map.md / error.map.md for the landed-vs-spec-ahead split). Not flagged.

## Informational — correctly archived / correctly self-labeled, no action needed

These `docs/changes/<change-id>/SPEC-DRAFT.md` / `SPEC-AMENDMENT.md` files match the "spec-draft"
name-heuristic but are legitimately parked in the designated dispatch-archive location and their
content is VERIFIED RATIFIED into `compiler/SPEC.md` (carried forward, re-verified present this pass):
- docs/changes/css-scrml-native-model-2026-07-07/SPEC-DRAFT.md -> ratified as SPEC.md §65.
- docs/changes/realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §38.13.
- docs/changes/standalone-tool-target-2026-07-04/SPEC-AMENDMENT.md -> ratified as SPEC.md §64 (now further extended by §64.9 this window, verified E-TOOL-SERVE-* firing).
- docs/changes/clean-print-primitive-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §20.7.
- docs/changes/capability-vocab-v1-2026-06-30/SPEC-DRAFT.md -> ratified as SPEC.md §23.5 (verified E-FOREIGN-CAPABILITY-UNKNOWN firing, new this window).

Reclassified this pass (see "Carried-forward — Non-compliant" above for the re-verification detail):
- docs/heads-up/const-deep-freeze-2026-05-26.md — `status: ratified`, closed decision record.
- docs/heads-up/lifecycle-annotation-extension-2026-05-25.md — `status: historical`, self-labeled.
- docs/heads-up/iteration-design-2026-05-25.md — `status: historical`, self-labeled.

## Scope notes / exclusions applied this pass

- `docs/changes/` (569 dispatch-archive dirs) — treated as a designated historical-record location (same treatment as `handOffs/`), per prior-scan precedent and the repo's own "archive BRIEF.md at dispatch time" convention. Only spot-checked (SPEC-DRAFT/SPEC-AMENDMENT name-heuristic + the 3 flagship dirs above), not exhaustively read.
- `spa-lists/` (120 files) — PA sub-task bookkeeping, not compiler-repo content; not scanned (consistent with the prior scan, which also did not scan it).
- `handOffs/` — explicitly out-of-scope per this mapper's own scope principle; not scanned.
- No new docs under `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/`, or `docs/research/` were found — confirms the repo stays clean of that category (those belong in scrml-support).
- No new `SPEC-DRAFT.md`/`SPEC-AMENDMENT.md` files were added in the 137-commit window — all landed work this window went straight to `SPEC.md` + a plain `BRIEF.md`/`SCOPE.md`/`progress.md` archive, not through a staged-draft process.

## Tags
#non-compliance #project-mapper #cleanup #scrml #outlet #server-shape #native-parser-stale #audit-currency #heads-up-reclassified #full-cold-start

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
