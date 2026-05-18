# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-18T00:00:00-06:00
# scan mode: INCREMENTAL_UPDATE (S101 / v0.3.1 era — commit dae8ff1)
# prior baseline: 2026-05-14 @ 13154ba (S92 / v0.3.0 STABLE)

## Summary

Total docs scanned: ~165 (prior ~147 + ~18 new docs from S93-S101 wave: m1-1/m1-2/m1-3/m1-4 dispatch records, combined-lint-additions-s98, mpa-entity-decoding-fix, s100-tailwind-engine-extension, heads-up-s95-bugs wave, benchmarks/llm-efficiency, compiler/native-parser/README.md)
Compliant: ~158
Non-compliant: 4 (3 carried from S92; 1 new)
Uncertain: 3 (same 3 carried from S92)

---

## Non-compliant docs

### docs/articles/llm-kickstarter-v0-2026-04-25.md
**Reason:** content-heuristic — doc self-identifies as RETRACTED/SUPERSEDED
**Detail:** Header states "Status: RETRACTED / SUPERSEDED — archived 2026-05-13 (S89 Wave 4.A D-3)." Body is a stub.
**Suggested disposition:** deref to archive/ or delete (stub; no informational content remaining)

### docs/changes/undefined-eradication-self-host/SUPERSEDED-CLOSURE.md
**Reason:** content-heuristic — doc self-identifies as CLOSED-AS-NO-OP / SUPERSEDED
**Detail:** Header states "Status: CLOSED-AS-NO-OP (work already complete on main at dispatch time)" — historical artifact only.
**Suggested disposition:** deref to scrml-support/archive/ or delete

### docs/changes/wave-4-adopter-content/SCOPING.md
**Reason:** content-heuristic — describes future/aspirational work that is now CLOSED
**Detail:** Status "SCOPED — awaits PA dispatch sequencing" from S88. Wave 4 adopter content CLOSED at S89. The work described is done; this SCOPING no longer describes current state.
**Suggested disposition:** Archive to scrml-support/archive/ or note as closed in-file header

### docs/changes/promotion-ergonomics/TIER-C-SCOPE.md
**Reason:** content-heuristic + grep-mismatch — describes future planned work not yet implemented
**Detail:** Status "SCOPED — queued, not yet dispatched" from S66. `W-MATCH-TRANSITIONS-ACCRUING` found ONLY in promote.js error console message (not a fire-site). `--engine` flag not found in compiler/src. Original filing age is now ~S66 relative to S101 HEAD.
**Suggested disposition:** Verify if deferred indefinitely; if so, deref to scrml-support/archive/

---

## Uncertain docs (needs human review)

### docs/changes/predicate-gaps-deep-dive-prep/SCOPE.md
**Reason:** content-heuristic — status "SCOPE PREPARED — awaits convener authorization to fire deep-dive (when corpus signal warrants)"; trigger conditions may still be unmet.
**What to check:** Has the deep-dive been authorized? If trigger conditions remain unmet, deref to scrml-support/archive/ if no active dispatch planned.

### docs/changes/v0.3-approach-a-impl/SCOPING.md
**Reason:** parent scoping for "Approach A impl" — A-1 through A-5 ALL CLOSED at S92 (v0.3.0 STABLE). This SCOPING is now fully superseded.
**What to check:** Confirm whether this is still authoritative for any remaining work. If all sub-waves closed (they are), note in-file as CLOSED or deref to archive.

### docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md
**Reason:** content-heuristic — top-level status line reads "Status: DRAFT — awaits PA + user OQ disposition before any A-4.* sub-phase dispatches." A-4 is FULLY CLOSED at S91 (A-4.1..A-4.7 all committed). The SCOPING body contains historical OQ dispositions and is now a post-hoc record.
**What to check:** Update status to CLOSED in-file header, or confirm PA has already noted it as a historical record to preserve.

---

## S93-S101 Changes vs S92 Baseline

**New compliant docs added S93-S101:**
- compiler/native-parser/README.md — authoritative M1.x status table, file listing, anomaly log; consistent with code ✓
- docs/changes/m1-1-native-lexer-skeleton/ — M1.1 dispatch records; implementations match code ✓
- docs/changes/m1-2-strings-and-templates/ — M1.2 dispatch records; implementations match code ✓
- docs/changes/combined-lint-additions-s98/ — S98 lint dispatch records; match code ✓
- docs/changes/s100-tailwind-engine-extension/ — §26.6 typography dispatch; matches tailwind-classes.js ✓
- docs/changes/mpa-entity-decoding-fix/ — $& regex-injection fix dispatch; matches codegen/index.ts ✓
- docs/changes/heads-up-s95-bugs/ — S95 bug catalog and progress files; closed items match code ✓
- docs/changes/heads-up-s95-bugs/MISSING-PRIMITIVE.md — v0.4+ language-design candidate; correctly scoped as future ✓
- benchmarks/llm-efficiency/ — LLM efficiency benchmark infrastructure (specs, prompts); compliant ✓
- master-list.md updated — S93-S101 close addenda, A1c table row corrected (stale "Wave 4 next" → "FULLY CLOSED" per S101 correction) ✓
- docs/changelog.md — v0.3.x patch arc entries ✓

**S101 A1c table-row correction noted (not flagging as non-compliant since corrected):**
The master-list.md A1 phase-progress table row previously contained a stale status fragment "Wave 4 (C12-C15 engines, sequential) next" within the longer status cell for the A1 row. The narrative at line 98 correctly said "A1c FULLY CLOSED (Waves 1-6, C0-C23 ALL SHIPPED)". The row was corrected in S101 as part of the A9 Ext 4 sub-agent sanity-check that surfaced the drift. The table status column and the narrative are now consistent.

**No new non-compliant docs at S93-S101.** The 4 non-compliant docs are: 3 carried unchanged from S92 + TIER-C-SCOPE.md (unchanged, restated). Uncertain count unchanged at 3.

---

## Compliant (no action needed)

The following categories were scanned and found compliant:
- compiler/SPEC.md, compiler/SPEC-INDEX.md, compiler/PIPELINE.md (v0.7.2) — authoritative specs, current
- compiler/native-parser/README.md — M1.4 status consistent with code
- docs/articles/* (15 articles) — devto content; articles-currency-table + VERIFIED.md confirm status
- docs/audits/* — dated audit snapshots, compliant as historical records
- docs/changes/§13.2-*, §36-*, a1-closeout, a2-1, a2-2, a2-reachability-solver-scoping, a-2-8-* — closed dispatch records
- docs/changes/a3-auth-graph-scoping/ — A-3 all sub-phases closed S91
- docs/changes/a-4-2-* through a-4-7-* — A-4 sub-phase dispatch records (all closed S91)
- docs/changes/a-5-1-* through a-5-5-* — A-5 sub-phase dispatch records (all closed S92)
- docs/changes/m-7c-d-12-runtime-sentinel-scoping/ — M-7C-D-12 completed S90
- docs/changes/03-contact-book-auth-redirect-SCOPING/ + 03-contact-book-auth-redirect/ — closed dispatch record
- docs/changes/null-eradication-*, undefined-eradication-*, stdlib-phase-1-5-null-sweep — closed dispatch records
- docs/changes/wave-4-*, v0next-inventory/ — closed or current inventory
- docs/changelog.md, docs/PA-SCRML-PRIMER.md, docs/tutorial.md, docs/lin.md, docs/external-js.md — reference docs, compliant
- docs/website/v0.3.0-announce-2026-05-14.md — release announcement, compliant
- docs/pinned-discussions/w-program-001-warning-scope.md — pinned decision record, compliant
- DESIGN.md, README.md, scrmlFormula.md, pa.md, master-list.md, hand-off.md — live project documents, compliant
- examples/, e2e/, samples/, benchmarks/, lsp/, editors/, scripts/ READMEs — operational docs, compliant
- compiler/src/codegen/README.md, compiler/tests/ READMEs — test fixtures docs, compliant

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #s101 #v0.3.1

## Links
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [primary.map.md](./primary.map.md)
