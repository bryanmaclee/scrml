# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-29T00:00:00-06:00  commit: 9ab7aa38
# scan mode: INCREMENTAL_UPDATE

## Summary

Docs scanned (incremental — new/changed .md files since feab1207): 18
Prior non-compliant (resolved by S141 doc-currency cleanup): 2
New non-compliant: 0
Uncertain (carried from prior report, unchanged): 6

---

## Non-compliant docs

No new non-compliant docs found in the S141 changed set.

**Prior non-compliant docs now resolved:**

- `docs/heads-up/iteration-design-2026-05-25.md` — was flagged at feab1207 (status: in-progress). **RESOLVED**: updated to `status: historical` as of 2026-05-29 S141 doc-currency cleanup. Compliant.
- `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md` — was flagged at feab1207 (status: in-progress). **RESOLVED**: updated to `status: historical` as of 2026-05-29 S141 doc-currency cleanup. Compliant.

---

## Uncertain docs (needs human review — carried from prior report)

### docs/heads-up/spec-consolidation-2026-05-25.md
**Reason:** `status: in-progress` from S129 (2026-05-25). `findings-closed: 1` of multiple findings. Spec consolidation work may or may not be fully complete at S141.
**What to check:** grep known-gaps + master-list §0.6 for "spec-consolidation" completion signal; update status or deref.

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** describes a decomposition plan for M5-swap; M5 landed but M6.6 arc is still in progress. Some residual items may be complete; others may still be open.
**What to check:** verify each line-item against landed M6.6 arc commits; strike completed items or add resolved-sha markers.

### compiler/native-parser/M5-divergence-ledger.md
**Reason:** a divergence ledger for the M5 arc. M5 has shipped but M6 (Acorn removal) has not. Content may be partially stale.
**What to check:** review each tracked divergence against current native-parser state; mark resolved items.

### compiler/native-parser/M5-ast-bridge-scoping.md
**Reason:** scoping doc for M5 AST bridge work. Content may be stale if bridge work has shipped or been superseded by M6.6 arc direction.
**What to check:** verify the scoping is still an active work item or deref to scrml-support.

### docs/audits/scope-c-findings-tracker.md
**Reason:** opened S42 (2026-04-25). Long-running findings tracker. Scope C work is substantially complete at HEAD; individual findings may be stale or remain genuinely open.
**What to check:** audit each finding entry against known-gaps.md and master-list §0.6 close history.

### docs/curation/2026-05-05-changes-dir-disposition.md
**Reason:** a curation/disposition doc dated 2026-05-05. Some changes-dir entries may have been actioned since then.
**What to check:** verify each named item against current `docs/changes/` directory state; if all items actioned, deref to scrml-support.

---

## Current-Truth Assessment of Key Docs (refreshed S141 / 9ab7aa38)

| Doc | Status | Notes |
|---|---|---|
| `compiler/SPEC.md` | COMPLIANT | Updated S141 — §2.2.1 + §34 now include E-CODEGEN-INVALID-JS (gate backstop) and E-CG-003 (no-arm match hard error); verified in source |
| `compiler/SPEC-INDEX.md` | COMPLIANT — not re-audited | Unchanged by S141; assumed current |
| `compiler/PIPELINE.md` | COMPLIANT — not re-audited | Unchanged by S141 |
| `docs/PA-SCRML-PRIMER.md` | COMPLIANT — not re-audited | Unchanged by S141 |
| `docs/known-gaps.md` | COMPLIANT | Updated 2026-05-29 S141; HIGH=2 (Bug 54 DEFERRED + C10 gate-found open); R27 cluster §R27 section present; §GATE-FOUND section present; Bug 46 RESOLVED-VERIFIED |
| `docs/changelog.md` | COMPLIANT | Updated 2026-05-29 S141; v0.6.8/v0.6.9/v0.6.10 blocks present; 22,129 pass / 0 fail / 219 skip |
| `master-list.md` | COMPLIANT — not re-audited | Hand-off update expected at S141 close |
| `docs/heads-up/iteration-design-2026-05-25.md` | COMPLIANT | `status: historical` as of S141 cleanup (2026-05-29) |
| `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md` | COMPLIANT | `status: historical` as of S141 cleanup (2026-05-29); NB: C4 object-literal E-TYPE-001 gap found R27 and tracked in known-gaps R27 cluster |
| `docs/heads-up/const-deep-freeze-2026-05-26.md` | COMPLIANT | `status: ratified` (S134) |
| `docs/audits/bug-51-class-corpus-coverage-audit-2026-05-28.md` | COMPLIANT | `status: current`; method: parallel empirical probes; last-reviewed 2026-05-28 |
| `docs/changes/gate-emitted-js-parse-invariant-2026-05-29/BRIEF.md` | COMPLIANT | Archived dispatch brief per pa.md S133 convention |
| `docs/changes/gate-found-invalid-js-fix-wave-2026-05-29/BRIEF.md` | COMPLIANT | Archived dispatch brief per pa.md S133 convention |
| `docs/changes/r27-fix-wave-c1-c2-c3-c5-2026-05-29/BRIEF.md` | COMPLIANT | Archived dispatch brief per pa.md S133 convention |

---

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #v0.6.10

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
