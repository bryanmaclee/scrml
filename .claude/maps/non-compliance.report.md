# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-13T23:00:00Z
# scan mode: FULL_COLD_START (S89 close — commit 71305fe)
# prior baseline: 2026-05-13T15:00:00Z @ 9b98118 (S88 close)

## Summary

Total docs scanned: 118 (excluding node_modules, .git, .claude, handOffs/, dist/, build/)
Compliant: 104
Non-compliant: 4
Uncertain: 10

---

## Non-compliant docs

### docs/articles/llm-kickstarter-v0-2026-04-25.md
**Reason:** content-heuristic — doc self-identifies as RETRACTED/SUPERSEDED
**Detail:** Header states "Status: RETRACTED / SUPERSEDED — archived 2026-05-13 (S89 Wave 4.A D-3)." Body is a stub. Belongs in archive, not live docs tree.
**Suggested disposition:** deref to archive/ or delete (stub; no informational content remaining)

### docs/changes/undefined-eradication-self-host/SUPERSEDED-CLOSURE.md
**Reason:** content-heuristic — doc self-identifies as CLOSED-AS-NO-OP / SUPERSEDED
**Detail:** Header states "Status: CLOSED-AS-NO-OP (work already complete on main at dispatch time)" — an agent was dispatched against work already done. Historical artifact only.
**Suggested disposition:** deref to scrml-support/archive/ or delete

### docs/changes/wave-4-adopter-content/SCOPING.md
**Reason:** content-heuristic — describes future/aspirational work that is now CLOSED
**Detail:** Header states "Status: SCOPED — awaits PA dispatch sequencing" with HEAD at `9b98118` (S88 close). Wave 4 adopter content CLOSED at S89. This SCOPING predates the closure — it no longer describes current state. The work described is done.
**Suggested disposition:** Archive to scrml-support/archive/ or note as closed in-file header

### docs/changes/promotion-ergonomics/TIER-C-SCOPE.md
**Reason:** content-heuristic — describes future planned work not yet implemented
**Detail:** Status "SCOPED — queued, not yet dispatched" from S66. No corresponding implementation found in compiler/src or test suite. Describes aspirational `--engine` flag + `W-MATCH-TRANSITIONS-ACCRUING` lint that grep cannot find in source. Nearly 1 year old relative to current HEAD.
**Suggested disposition:** Verify if this work has been deferred indefinitely; if so, deref to scrml-support/archive/

---

## Uncertain docs (needs human review)

### docs/changes/v0next-audit/PARSER-AUDIT-2026-05-05.md
**Reason:** old dated audit doc referencing `"reactive-decl"` kind (now `"state-decl"`) with a mass-rename banner; may contain stale AST identifiers
**What to check:** Verify the 25+ feature-probe entries are still accurate against current parser. If primarily historical context, deref to scrml-support/archive/.

### docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md
**Reason:** dated 2026-05-05 (S59), references B4 self-host as "DEFERRED to post-v1.0.0" and v0.2.0 scope tracking — both now historical
**What to check:** Is this still consulted for active planning, or is it pure historical context? If historical, deref to scrml-support/archive/.

### docs/changes/v0next-inventory/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md
**Reason:** dated 2026-05-05 (S59) audit of article accuracy at that commit; articles have been updated significantly since
**What to check:** Does this audit still reflect current article state? If not, deref to scrml-support/archive/.

### docs/changes/scrml-dev-codegen-divergence/progress.md
**Reason:** progress.md describes a worktree-based fix to `emit-server.ts`/`emit-client.ts` channel import filtering. Content is well-curated implementation history. Uncertain whether this belongs here or in scrml-support.
**What to check:** Did this dispatch produce committed code on main? (It references commit artifacts; grep confirms `cross-file-channel-import-emit.test.js` exists.) If so, compliant as implementation record. If worktree-only, uncertain.

### docs/changes/predicate-gaps-deep-dive-prep/SCOPE.md
**Reason:** content-heuristic — status "SCOPE PREPARED — awaits convener authorization to fire deep-dive (when corpus signal warrants)"; trigger conditions unmet; aspirational
**What to check:** Has the deep-dive been authorized? If trigger conditions remain unmet, this is a queued-but-unfired scope. Deref to scrml-support/archive/ if no active dispatch planned.

### docs/changes/v0.3-approach-a-impl/SCOPING.md
**Reason:** parent scoping for "Approach A impl" — may be superseded now that A-1 CLOSED and A-2 is active with its own sub-docs
**What to check:** Is this SCOPING still the living authority for A-2..A-5, or has authority transferred to a2-reachability-solver-scoping/SCOPING.md? If superseded, note in-file or deref.

### docs/changes/v0.3-approach-a-spec/SCOPING.md
**Reason:** "spec" variant of approach-a scoping. Separate from impl scoping. Check if still current authority.
**What to check:** Is §40.9 SPEC contract now locked in SPEC.md or does this SCOPING still carry forward-contract content? If content landed in SPEC, deref.

### docs/changes/v0.3-todomvc-e2e-reverify/progress.md
**Reason:** uncertain whether this dispatch closed. Title implies a re-verify task post LIFT fixes.
**What to check:** Did the todomvc e2e reverify complete? The `browser-todomvc.test.js` and `todomvc-e2e.test.js` pass. If re-verify is done, mark this closed or deref.

### docs/audits/scope-c-findings-tracker.md
**Reason:** uncertain whether Scope C audit findings are still open or resolved
**What to check:** Are Scope C findings tracked here still open issues? Or have they been resolved by subsequent dispatches? If resolved, deref to scrml-support/archive/.

### docs/articles/llm-kickstarter-v1-2026-04-25.md
**Reason:** dated 2026-04-25 but references commit `b1ce432` which predates S89 by weeks. Null/absence rules (§42.1.1) and §36 input devices and §13.2 auto-await are not in this version.
**What to check:** Has this kickstarter been superseded by v2 (llm-kickstarter-v2-2026-05-04.md)? If v2 is the live authority, mark v1 as historical or confirm v1 is still distributed.

---

## Compliant (no action needed)

The following categories were scanned and found compliant:
- compiler/SPEC.md, compiler/SPEC-INDEX.md, compiler/PIPELINE.md — authoritative specs, current
- docs/articles/* (14 articles) — devto content; VERIFIED.md confirms status per examples/
- docs/audits/* (null-audit, undefined-audit, articles-currency-table, happy-dom-perf, self-host-spec-conformance, wave-3-7-corpus-ouroboros) — dated audit snapshots, compliant as historical records
- docs/changes/§13.2-*, §36-*, a1-closeout, a2-1, a2-2, a2-reachability-solver-scoping, a3-auth-graph-scoping — active/closed dispatch records, compliant
- docs/changes/null-eradication-*, undefined-eradication-*, stdlib-phase-1-5-null-sweep — S89 eradication dispatch records, compliant
- docs/changes/m-7c-d-12-runtime-sentinel-scoping, m-7c-d-paired-migration — active SCOPING, compliant
- docs/changes/w-try-catch-lint, fix-lift-async-iife-paren, phase-3a-async-jwt, todomvc-edit-mode-landing — closed dispatch records, compliant
- docs/changes/wave-4-t-track, wave-4-d-track, wave-4-adopter-content-scoping — Wave 4 execution records, compliant
- docs/changes/wave-3-7-audit, wave-3-7-backlog-migration, v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md — planning records, compliant
- docs/changelog.md, docs/PA-SCRML-PRIMER.md, docs/tutorial.md, docs/lin.md, docs/external-js.md — reference docs, compliant
- docs/pinned-discussions/w-program-001-warning-scope.md — pinned decision record, compliant
- docs/curation/2026-05-05-changes-dir-disposition.md — curation record, compliant
- docs/website/v0.2.0-announce-2026-05-05.md — historic announcement stub, compliant
- DESIGN.md, README.md, scrmlFormula.md, pa.md, master-list.md, hand-off.md — live project documents, compliant
- examples/, e2e/, samples/, benchmarks/, lsp/, editors/, scripts/ READMEs — operational docs, compliant
- compiler/src/codegen/README.md, compiler/tests/ READMEs — test fixtures docs, compliant

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #s89

## Links
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [primary.map.md](./primary.map.md)
