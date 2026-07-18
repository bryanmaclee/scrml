# non-compliance.report.md
# project: scrml
# generated: 2026-07-18T03:27:22-06:00  (incremental re-stamp)
# scan mode: INCREMENTAL_UPDATE (S265 source-PR delta 0a79d838 -> c779e606); prior incremental base S264 f079d0a9 -> 0a79d838; full scan base fbb4d9fd -> f079d0a9

## S265 incremental delta (this pass)

This is an INCREMENTAL_UPDATE pass over the five S265 compiler-source PRs (#95 CSS Wave-1
emission, #96 #82 content-hash + cache headers, #97 #29-D reactive bool-attr, #98 CSS-var-bridge
`document.documentElement` fix, #100 #27 link-boost click-interception). A full re-scan of all
in-scope `*.md` was NOT performed; the carried-forward findings below are from the f079d0a9
FULL_COLD_START scan and were NOT re-verified this pass (none of the flagged docs were touched
by the S265 PRs).

S265-specific findings:
- **New non-compliant docs: 0.** The five S265 PRs added 61 new tracked files total, of which the
  only `*.md` additions are: `docs/changes/css-wave1-emission-2026-07-16/{BRIEF-s265-round4,progress}.md`,
  `docs/changes/component-css-var-scrml-el-fix-2026-07-17/progress.md` (dispatch-archive, correctly
  parked under `docs/changes/`), plus `handOffs/hand-off-263.md`, 12 `handOffs/incoming/read/*.md`
  files, and `spa-lists/ss72.progress.md` / `ss74.progress.md` (all explicitly out-of-scope per the
  scope principle). Verified: `git diff --diff-filter=A --name-only 0a79d838..c779e606 -- '*.md'`
  filtered against `docs/changes/|handOffs/|spa-lists/` returns nothing.
- **SPEC.md itself was amended in place this window** (§25.7, §47.9.5-§47.9.8 NEW, §65 status
  banner flip) — this is the NORMATIVE source being updated directly, not a superseded draft
  shadowing it; no non-compliance action (SPEC.md is definitionally compliant with itself).
- No new `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/`, or `docs/research/`
  content this window — the repo stays clean of that category.

CAVEAT — this incremental pass mapped only the S265 source-surface delta. The S256-S263 latent
delta noted at the S264 incremental pass (cross-OS path-canonical.js, block-splitter/type-system
churn, the §34 catalog cleanup) remains unscanned for doc-drift, as does anything outside the
S264/S265 source-PR diffs. A NON_COMPLIANCE_ONLY full re-scan is advisable at the next wrap.

## Summary (carried forward from the f079d0a9 FULL_COLD_START scan — NOT re-verified this pass)

Full read of all in-scope `*.md` files was NOT performed (infeasible at scope/turnaround); the base
scan was a name/date/location-heuristic sweep + spot-checks cross-checked with `grep` against
source. Items below are individually verified as of f079d0a9; anything outside that sweep should be
treated as unscanned, not implicitly compliant.

Carried-forward items: 8 doc clusters (6 non-compliant, 2 uncertain)

## Carried-forward — Non-compliant docs (re-verified still present at f079d0a9, still non-compliant)

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** content-heuristic (self-marked superseded) + date (2026-05-21, stale vs. SPEC.md mtime)
**Detail:** Opens with "⚠ SUPERSEDED S117 (2026-05-21). This Phase-0 decomposition's R1-R5 / 46-78h estimate was itself under-counted..." — the document declares its own staleness. Unresolved since prior scans (948d3f2f, fbb4d9fd, f079d0a9).
**Suggested disposition:** deref to scrml-support/archive/.

### compiler/native-parser/M5-ast-bridge-scoping.md, M5-divergence-ledger.md
**Reason:** date (2026-05-21, stale) + content-heuristic (describes the native-parser's THEN-current AST-bridge scoping contract as a load-bearing precondition for the pipeline-swap)
**Detail:** Still unresolved. compiler/native-parser/ showed no structural change in the S265 window either.
**Suggested disposition:** uncertain — needs human review (re-verify against current native-parser/ + native-parser-canary/within-node-classifier.ts, or deref to archive if superseded by a later contract doc).

### compiler/native-parser/M6.6-CONTRACT-DERIVATION.md
**Reason:** date (2026-05-23, stale) + content-heuristic ("developer reference for b.2-b.4 consumer migration off the live engine-statechild-parser.ts")
**Detail:** Describes a migration-in-progress cookbook contract. Carried as "verify current"; still unverified.
**Suggested disposition:** uncertain — needs human review.

### docs/changes/v0next-inventory/{SCOPE-MAP,SCOPE-SUPPLEMENT,ARTICLE-TRUTHFULNESS-AUDIT}-2026-05-0[5-7].md
**Reason:** location (docs/changes/ dispatch-archive, correctly parked) + date (2026-05-05/07, stale) + content-heuristic (v0.next planning inventory, doubly superseded — behind at the last scan, and the repo has since shipped §20.8 Client Router/outlet, §64.9 serve=, and now §65 CSS Wave-1 emission + §47.9.8 content-hashing)
**Detail:** Unresolved from three prior scans.
**Suggested disposition:** already correctly archived under docs/changes/ — no move needed, but content should not be treated as a live scope reference by any dev agent.

### docs/audits/{null-audit-compiler-src,undefined-audit-compiler-src}-2026-05-13.md, article-truthfulness-audit-2026-05-21.md, bug-51-class-corpus-coverage-audit-2026-05-28.md, docs/language-inspiration-audit-2026-06-06.md
**Reason:** date (stale vs. SPEC.md mtime) + name-heuristic (`-audit-`)
**Detail:** Point-in-time audit snapshots, unresolved. Risk: a dev agent grepping docs/audits/ for current null/undefined hygiene without checking the date.
**Suggested disposition:** no forced move (audits/ is a reasonable point-in-time home), but recommend a one-line "supersedes/superseded-by" pointer chain if a newer audit exists for the same surface.

### docs/heads-up/{const-deep-freeze,lifecycle-annotation-extension,iteration-design}-2026-05-2[5-6].md
**Status: RESOLVED-BY-RECLASSIFICATION at the base scan** — all three carry explicit frontmatter (`status: ratified`/`closed` or `status: historical`, self-labeled). No longer misrepresent themselves as live design state; see "Informational" below.

## Carried-forward — Uncertain docs (needs human review)

### docs/heads-up/spec-consolidation-2026-05-25.md
**Reason:** frontmatter `status: in-progress` (unlike its three siblings) + date + content-heuristic (references an OPEN "state-dynamics-design DD extension question ... status: active since 2026-04-08" and an unshipped "Mutability-contracts article draft").
**What to check:** whether the state-dynamics-design DD extension question has been ratified since 2026-04-08 (check scrml-support/archive/deep-dives/ + design-insights.md), and whether the mutability-contracts article draft has shipped or been retired.

## Informational — correctly archived / correctly self-labeled, no action needed

`docs/changes/<change-id>/SPEC-DRAFT.md` / `SPEC-AMENDMENT.md` files match the "spec-draft" name-heuristic
but are legitimately parked in the dispatch-archive location and VERIFIED RATIFIED into `compiler/SPEC.md`:
- docs/changes/css-scrml-native-model-2026-07-07/SPEC-DRAFT.md -> ratified as SPEC.md §65 (Wave-1 emission half LANDED S265 — see domain.map.md).
- docs/changes/realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §38.13.
- docs/changes/standalone-tool-target-2026-07-04/SPEC-AMENDMENT.md -> ratified as SPEC.md §64 (extended by §64.9, E-TOOL-SERVE-* firing).
- docs/changes/clean-print-primitive-2026-07-06/SPEC-AMENDMENT.md -> ratified as SPEC.md §20.7.
- docs/changes/capability-vocab-v1-2026-06-30/SPEC-DRAFT.md -> ratified as SPEC.md §23.5 (E-FOREIGN-CAPABILITY-UNKNOWN firing).

New this window (not a draft-doc match, but flagging the pattern for consistency): `docs/changes/css-wave1-emission-2026-07-16/BRIEF-s265-round4.md` + `progress.md` and `docs/changes/component-css-var-scrml-el-fix-2026-07-17/progress.md` are correctly parked dispatch-archive records for the S265 landing — same pattern as above, no action.

Reclassified at the base scan:
- docs/heads-up/const-deep-freeze-2026-05-26.md — `status: ratified`, closed decision record.
- docs/heads-up/lifecycle-annotation-extension-2026-05-25.md — `status: historical`, self-labeled.
- docs/heads-up/iteration-design-2026-05-25.md — `status: historical`, self-labeled.

## Scope notes / exclusions applied

- `docs/changes/` (dispatch-archive dirs) — treated as a designated historical-record location (same as `handOffs/`). Only spot-checked, not exhaustively read.
- `spa-lists/` — PA sub-task bookkeeping, not compiler-repo content; not scanned.
- `handOffs/` — explicitly out-of-scope per scope principle; not scanned.
- No new docs under `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/`, or `docs/research/` — the repo stays clean of that category (those belong in scrml-support).

## Tags
#non-compliance #project-mapper #cleanup #scrml #semdiff #outlet #server-shape #native-parser-stale #audit-currency #incremental-update #css-wave1 #link-boost #content-hash

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [error.map.md](./error.map.md)
- [build.map.md](./build.map.md)
- [domain.map.md](./domain.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
