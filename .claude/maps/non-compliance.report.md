# non-compliance.report.md
# project: scrml
# generated: 2026-07-19T21:52:34-06:00
# scan mode: TARGETED_REFRESH (S266-S271 catch-up — closes the entire unmapped gap from the 99ae45ca/S265-wrap watermark to df2ac831 in one pass); prior incremental base 99ae45ca; full scan base fbb4d9fd -> f079d0a9

## This pass (S266-S271 catch-up: session-establishment, writer-ownership, colorless-async, GITI-038/039)

Scope: advance the map watermark from 99ae45ca to df2ac831, re-verifying against source the full
feature surface that landed across S266-S271 (six commits — `1e63bbb1`, `510cef8d`, `8931fd59`,
`d8c814d5`, `1c577da5`, `9c950dfe`, `72ba19d6`, `df2ac831`; two recovery/dogfood wraps,
`8fdab116`/`204b1897`, carried no compiler-source change per hand-off.md). Content maps
(structure/dependencies/schema/error/domain/auth/test/primary) rewritten and re-stamped
`df2ac831`. **config.map.md / build.map.md / infra.map.md intentionally LEFT at their prior
stamps** — none of this window's changed files touch env vars, config-file shapes, CLI flags, or
CI/infra; carrying an honest older stamp over a false "verified at df2ac831" (same discipline the
S265-pass non-compliance report applied to config/auth/infra).

### NEW non-compliant item this window — stray root-level `progress.md`

**File:** `/home/bryan-maclee/scrmlMaster/scrml/progress.md`
**Reason:** location-heuristic + content-heuristic (WIP scratch bookkeeping outside its
designated home) + currency (describes work that is now fully LANDED elsewhere).
**Detail:** Added in commit `510cef8d` ("harden(§20.5): session pass-2"), this file is a
`WIP(i29e-pass2): start at .../worktrees/agent-...` crash-recovery scratch note (per
CLAUDE.md's "background/dispatched agents commit a progress.md as a crash-recovery anchor"
convention) tracking the §20.5.1 B4b/B5 session-secure + reserved-key work IN PROGRESS. That
work landed in the SAME commit that added this file — the file was never cleaned up /
archived post-land. It sits at repo ROOT, not in `scratch/` (the designated ad-hoc-script
home) or `docs/changes/i29e-session-pass2-b4b5-2026-07-18/` (the correctly-parked dispatch
archive for this exact work, which DOES have its own BRIEF.md but no progress.md sibling — this
file is the orphaned twin). A dev agent grepping the repo root for current state could mistake
its stale "start at..." framing for in-flight work; it is not — SPEC §20.5.1, the §34 catalog
rows, and docs/changelog.md all mark this LANDED.
**Suggested disposition:** delete (superseded by the landed commit + the SPEC + the
docs/changes/i29e-session-pass2-b4b5-2026-07-18/BRIEF.md dispatch record), or if crash-recovery
value is still wanted, move to `docs/changes/i29e-session-pass2-b4b5-2026-07-18/progress.md`
(its correct archive slot, matching every sibling dispatch dir's convention).

### RESOLVED this pass — map-set self-audit items carried from the S265-pass report

- **Test counts.** The S265-pass report flagged test.map.md/primary.map.md as undercounting HEAD
  by ~8 (a pre-existing methodology drift, not a regression). This pass RE-COUNTED directly via
  `git ls-files` at df2ac831 (unit 821, integration 173, conformance[compiler/tests] 120, browser
  68, total 1221) and cross-verified against the window's actual added-file list (13 new test
  files) — the counts now in test.map.md/structure.map.md/primary.map.md are exact, not
  carried-forward estimates. Resolved.
- **§34 diagnostic count.** The methodology-fork (776-vs-758 depending on extraction range) is
  STILL UNRESOLVED — this pass did not attempt to reconcile it, only confirmed the +4 DELTA via a
  `comm -13` set-diff of every `^| [EWI]-` catalog-row first-cell between the 99ae45ca and
  df2ac831 SPEC.md (see error.map.md). The underlying baseline-count audit remains owed at the
  next FULL_COLD_START, as previously flagged.

### Carried-forward, UNCHANGED this window — native-parser/ GITI-038/039 parity (flagged, not confirmed drift)

**Files:** `compiler/native-parser/*` (37 paired .js/.scrml stages)
**Reason:** uncertain — needs verification, not yet a confirmed compliance violation.
**Detail:** `git diff --stat 99ae45ca df2ac831 -- compiler/native-parser` returns EMPTY — the
native parser had zero changes in this window. The live pipeline's GITI-038 (`return-stmt.
fnExprNode`) and GITI-039 (markup-text-verbatim rejoin) fixes are LIVE-pipeline-only. Two
readings are both plausible without further investigation: (a) the native parser never had
these bugs (a different parse strategy sidesteps them), or (b) the native parser silently
carries the SAME bugs and no one has checked. `--parser=scrml-native` is not yet the default
pipeline (M5 gate), so this is not a shipping-correctness gap today, but a dev agent extending
native-parser/ should not assume parity with the live pipeline on these two fixes without
checking.
**What to check:** run the GITI-038/039 repro `.scrml` files (docs/changes/giti-038-returned-
closure-async/, docs/changes/giti-039-markup-text-expr-lexed/ — check for a repros/ subdir) through
`--parser=scrml-native` and diff against the live-pipeline output, or grep native-parser/*.scrml
for an equivalent `RETURN_DECL_KW`/`joinWithNewlines` construct.

## Carried-forward — Non-compliant docs (unchanged this window; native-parser/ + docs/ untouched by S266-S271 except the new correctly-parked dispatch dirs below)

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** content-heuristic (self-marked "⚠ SUPERSEDED S117 (2026-05-21)") + date (stale vs SPEC.md mtime)
**Detail:** The document declares its own staleness. Unresolved across multiple prior scans; native-parser/ showed no structural change in this window either.
**Suggested disposition:** deref to scrml-support/archive/.

### compiler/native-parser/M5-ast-bridge-scoping.md, M5-divergence-ledger.md
**Reason:** date (2026-05-21, stale) + content-heuristic (native-parser AST-bridge scoping contract as a then-current precondition)
**Detail:** Still unresolved; native-parser/ unchanged this window.
**Suggested disposition:** uncertain — re-verify against current native-parser/ + native-parser-canary/within-node-classifier.ts, or deref to archive if a later contract supersedes.

### compiler/native-parser/M6.6-CONTRACT-DERIVATION.md
**Reason:** date (2026-05-23, stale) + content-heuristic (a b.2-b.4 consumer-migration cookbook contract, migration-in-progress)
**Detail:** Carried "verify current"; still unverified.
**Suggested disposition:** uncertain — needs human review.

### docs/changes/v0next-inventory/{SCOPE-MAP,SCOPE-SUPPLEMENT,ARTICLE-TRUTHFULNESS-AUDIT}-2026-05-0[5-7].md
**Reason:** location (docs/changes/ dispatch-archive, correctly parked) + date (stale) + content-heuristic (v0.next planning inventory, doubly superseded — the repo has since shipped §20.8 Client Router/outlet, §64.9 serve=, §65 CSS Wave-1 emission, §47.9.8 content-hashing, §20.5 session-establishment, §5.5.3/§5.5.4 writer-ownership, and colorless-async)
**Detail:** Unresolved from prior scans.
**Suggested disposition:** already correctly archived under docs/changes/ — no move needed; a dev agent must NOT treat it as a live scope reference.

### docs/audits/{null-audit-compiler-src,undefined-audit-compiler-src}-2026-05-13.md, article-truthfulness-audit-2026-05-21.md, bug-51-class-corpus-coverage-audit-2026-05-28.md, docs/language-inspiration-audit-2026-06-06.md
**Reason:** date (stale vs SPEC.md mtime) + name-heuristic (`-audit-`)
**Detail:** Point-in-time audit snapshots. Risk: a dev agent grepping docs/audits/ for current null/undefined hygiene without checking the date.
**Suggested disposition:** no forced move (audits/ is a reasonable point-in-time home); recommend a "superseded-by" pointer chain if a newer audit exists for the same surface.

## Carried-forward — Uncertain docs (needs human review)

### docs/heads-up/spec-consolidation-2026-05-25.md
**Reason:** frontmatter `status: in-progress` (unlike its ratified/historical siblings) + date + content-heuristic (references an OPEN "state-dynamics-design DD extension question ... active since 2026-04-08" + an unshipped "Mutability-contracts article draft").
**What to check:** whether the state-dynamics-design DD extension question has ratified since 2026-04-08 (scrml-support/archive/deep-dives/ + design-insights.md), and whether the mutability-contracts article draft shipped or was retired.

## Informational — correctly archived / correctly self-labeled, no action needed

`docs/changes/<change-id>/SPEC-DRAFT.md` / `SPEC-AMENDMENT.md` files match the "spec-draft" name-heuristic
but are legitimately parked in dispatch-archive AND verified ratified into `compiler/SPEC.md`:
- css-scrml-native-model-2026-07-07/SPEC-DRAFT.md -> SPEC.md §65 (Wave-1 emission half LANDED).
- realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md -> SPEC.md §38.13.
- standalone-tool-target-2026-07-04/SPEC-AMENDMENT.md -> SPEC.md §64 (+§64.9).
- clean-print-primitive-2026-07-06/SPEC-AMENDMENT.md -> SPEC.md §20.7.
- capability-vocab-v1-2026-06-30/SPEC-DRAFT.md -> SPEC.md §23.5.

**NEW this window — all correctly-parked dispatch records, BRIEF.md/progress.md only, no SPEC-DRAFT
files, checked for the "spec-draft-not-ratified" pattern and clean:**
- docs/changes/colorless-async-seam-a-2026-07-15/{BRIEF.md,BRIEF-phase1-fix-s239.md,progress.md,repros/*} -> ratified into SPEC.md §13.1/§13.2 (colorless-async design, S258) + landed source.
- docs/changes/giti-038-returned-closure-async/BRIEF.md -> landed `72ba19d6`, no SPEC surface change (a completeness/correctness fix, not a new feature).
- docs/changes/giti-039-markup-text-expr-lexed/BRIEF.md -> landed `df2ac831`, no SPEC surface change.
- docs/changes/i29e-session-security-fixes-2026-07-18/{BRIEF.md,progress.md} + i29e-session-pass2-b4b5-2026-07-18/BRIEF.md -> ratified into SPEC.md §20.5/§20.5.1.
- docs/changes/i81-writer-ownership/{BRIEF.md,progress.md} -> ratified into SPEC.md §5.5.3/§5.5.4.
- docs/changes/i87-nested-server-call-autoawait-2026-07-18/{BRIEF.md,progress.md} -> SPEC.md §13.2 (no new normative text, a codegen behavior fix).
- docs/changes/colorless-async-combinators-2026-07-19/{progress.md,repros/*} -> the Phase-2 combinator transform, landed `9c950dfe`.
- handOffs/hand-off-265.md, handOffs/incoming/read/2026-07-18-1105-from-giti-*.md -> historical hand-off record, out-of-scope per the scope principle (handOffs/ excluded).

Reclassified at the base scan (self-labeled, not misrepresenting live state):
- docs/heads-up/const-deep-freeze-2026-05-26.md — `status: ratified`.
- docs/heads-up/lifecycle-annotation-extension-2026-05-25.md — `status: historical`.
- docs/heads-up/iteration-design-2026-05-25.md — `status: historical`.

## Scope notes / exclusions applied
- `docs/changes/` (dispatch-archive dirs) — designated historical-record location (like `handOffs/`); spot-checked, not exhaustively read.
- `spa-lists/`, `handOffs/`, `archive/` — out-of-scope per the scope principle; not scanned. (Note: `handOffs/incoming/2026-07-19-1030-from-giti-GITI-038-safecallasync-in-returned-closure-drops-return.md` sits UNREAD in the incoming/ queue per `git status` at scan time — out-of-scope for this report, flagged only for PA awareness, not a compliance item.)
- No new `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/`, or `docs/research/` content this window — the repo stays clean of that category (those belong in scrml-support).

## CAVEAT
This pass closed the S266-S271 map-content gap (8 maps re-verified against source) but is still
NOT a full `*.md` re-scan of the whole repo — the carried-forward native-parser/ + docs/audits/ +
docs/heads-up/ items above were NOT re-read this pass (their underlying files are unchanged since
the last scan, per prior-pass tracking). config.map.md/build.map.md/infra.map.md's surfaces were
not touched by this window's source changes and were left unverified. A NON_COMPLIANCE_ONLY full
re-scan (including config/build/infra content re-verification + the native-parser parity check
above) is advisable at the next wrap.

## Tags
#non-compliance #project-mapper #cleanup #scrml #colorless-async #giti-037 #giti-038 #giti-039 #writer-ownership #session-establishment #stray-progress-md #native-parser-parity #test-count-drift #native-parser-stale #audit-currency #watermark-advance

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [test.map.md](./test.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
