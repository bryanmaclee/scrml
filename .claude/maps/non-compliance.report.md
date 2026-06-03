# non-compliance.report.md
# project: scrmlts
# generated: 2026-06-02T21:33:23-06:00
# scan mode: INCREMENTAL_UPDATE (watermark c665714c → 57edc794, S154-S156 arcs)
# prior scans: INCREMENTAL_UPDATE at c665714c (S153 sweep); INCREMENTAL_UPDATE at 4e1f9492 (S148-S152); FULL_COLD_START at 948d3f2f (2026-05-30)

## Summary

Total docs scanned (incremental delta — new/modified docs c665714c → HEAD): 22 new/modified
Compliant (new docs): 20
Non-compliant (new findings): 0
Uncertain (new findings): 1 (Bug 69 / NON-GAP tension)
New infra finding: 1 (map header-commit drift carried from prior scan — four maps still carry older hashes; see below)

## New Docs Added S154-S156 — Incremental Findings

### docs/changes/s154-spec-landing-event-payload-enum-subset/{BRIEF.md, progress.md} — COMPLIANT
S154 batch 1 dispatch archive. Describes `engine-statechild-parser.ts` `accepts=` recognition + `parseMessageArms()`. Both functions grep-resolve in current source. Historical dispatch record.

### docs/changes/s155-14-parser-accepts-message-arms/BRIEF.md — COMPLIANT
S155 batch 1 (parser coordination) dispatch archive. Describes `acceptsType` field on `EngineDeclNode` and `messageArms: MessageArmEntry[]` on `EngineStateChildEntry`. Both grep-resolve in ast.ts + symbol-table.ts. Historical dispatch record.

### docs/changes/s155-14-typer-advance-exhaustiveness/BRIEF.md — COMPLIANT
S155 batch 2 (typer) dispatch archive. Describes `E-ENGINE-ACCEPTS-NOT-ENUM`, `E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE`, `E-ENGINE-MSG-WITHOUT-ACCEPTS`, `E-ENGINE-MSG-UNKNOWN`. All four error codes grep-resolve in symbol-table.ts and type-system.ts. Historical dispatch record.

### docs/changes/s155-14-codegen-message-dispatch/BRIEF.md — COMPLIANT
S155 batch 3 (codegen) dispatch archive. Describes `emitEngineMessageArmTable()`, `_scrml_engine_dispatch_message`. Both grep-resolve in emit-engine.ts and runtime-template.js. Historical dispatch record.

### docs/changes/s156-bug62-each-render-engine-ctx/{BRIEF.md, progress.md} — COMPLIANT
Bug 62 dispatch archive. Describes `buildEachEngineCtx`, `emitEngineHandlerBody`, `EachEngineCtx`. All grep-resolve in emit-each.ts. Historical dispatch record; matches landed code.

### docs/changes/s156-dA-batch1-enum-subset-type-system/{BRIEF.md, progress.md} — COMPLIANT
(d)-A batch 1 dispatch archive. Describes `parseEnumSubsetRefinement()`, `makeEnumSubsetPredicatedType()`, `subsetVariants`. All grep-resolve in type-system.ts. Historical dispatch record.

### docs/changes/s156-dA-batch2-enum-subset-exhaustiveness/{BRIEF.md, progress.md} — COMPLIANT
(d)-A batch 2 dispatch archive. Describes `parseEnumSubsetAnnotation()` in enum-subset-refinement.ts + `E-MATCH-SUBSET-DEAD-ARM`. Both grep-resolve in current source. Historical dispatch record.

### docs/changes/s156-dA-batch3-schemafor-validator-subset/{BRIEF.md, progress.md} — COMPLIANT
(d)-A batch 3 dispatch archive. Describes `subsetVariants` path in `classifyFieldForSql()` (emit-schema-for.ts), `kind: "variant-set"` in `predicateToJsExpr()` (emit-predicates.ts). Both grep-resolve. Historical dispatch record.

### docs/changes/s156-dA-batch4-enum-subset-enforcement-reach/{BRIEF.md, progress.md} — COMPLIANT
(d)-A batch 4 dispatch archive. Describes `E-MATCH-SUBSET-DEAD-ARM` reach to constructor-form + member-access match paths in symbol-table.ts PASS 20 (Bug 66). Grep-resolves. Historical dispatch record.

### docs/changelog.md — COMPLIANT
S154-S156 sections added; describes shipped behavior matching landed commits. Bug 62 RESOLVED + (d)-A enum-subset enum-subset four batches described. Forward-looking Bug 65 noted as NEXT. Honest, current.

### docs/known-gaps.md — COMPLIANT (with one noted tension — see Uncertain below)
S154-S156 closure entries added; Bug 62 RESOLVED + (d)-A batch 1-4 RESOLVED. Bug 65 (`emit-lift.js` engine-ctx gap) carries as OPEN MED. Bug 69 status has an internal tension (see Uncertain section). Current otherwise.

### docs/PA-SCRML-PRIMER.md — COMPLIANT (1-line update)
Minor update; describes no aspirational features. Current.

### docs/website-viewer/README.md — COMPLIANT
Website viewer doc; describes the C1 self-demo app structure. No forward-looking claims.

## Uncertain Docs — S154-S156 (needs human review)

### hand-off.md (Bug 69 / NON-GAP tension)
**Reason:** Map-level inconsistency between two authoritative documents
**Detail:** `hand-off.md` line 49-52 records a tension: (a) user stated "fold Bug 69 in too" at S156 (carry-forward as (d)-A batch 5); (b) the S156 CLOSE DONE block in hand-off-161 classified Bug 69 as "NON-GAP (display-subset-irrelevant for v1.0)." These two claims contradict. `known-gaps.md` entries for Bug 69 reflect this ambiguity as "NON-GAP-or-batch-5." The maps have been written consistent with the DONE block (Bug 65 is the next open dispatch; batch 5 is not yet scheduled), but if the user intends batch 5 to run, `domain.map.md` and `error.map.md` should add tableFor §41.16.6 subset reach as a pending item.
**What to check:** Confirm with user: does (d)-A batch 5 (Bug 69 / tableFor subset reach in `emit-table-for.ts` `_processTableForNode`) still run as part of the (d)-A arc, or is Bug 69 retired as NON-GAP?

## Prior Incremental Findings (S153, at c665714c — unchanged, not re-checked this pass)

### docs/heads-up/spec-consolidation-2026-05-25.md — UNCERTAIN (carried)
**Reason:** Frontmatter `status: in-progress`; Phase 2 amendment TBD landings (§6.10, §52.4, §55)
not yet executed.
**What to check:** Whether the open TBD landings are scheduled or deferred-indefinitely.

(All other S148-S153 dispatch archives under docs/changes/ were classed COMPLIANT in the prior scan.)

## New Infra Finding (S154-S156) — map header-commit drift

### .claude/maps/{dependencies,schema,config,build}.map.md — HEADER STALE (content current-but-unverified for some)
**Reason:** infra / header-heuristic
**Detail:** `schema.map.md` is NOW REFRESHED to commit `57edc794` (this pass). The remaining three maps carry older headers:
- `config.map.md` → `948d3f2f` (2026-05-30)
- `build.map.md` → `948d3f2f` (2026-05-30)
- `dependencies.map.md` → `4e1f9492` (S148-S152 pass)
The S154-S156 source changes (emit-each / emit-engine / emit-predicates / emit-schema-for / symbol-table / type-system / enum-subset-refinement / engine-statechild-parser / runtime-template) did NOT touch dependencies (no manifest change), config (no `.env`, no `process.env.*` additions), or build (no scripts/Dockerfile/CI changes) so per the incremental-update routing table their CONTENT is NOT regenerated and remains accurate.
**Suggested disposition:** No action required for the S154-S156 dispatch. At the next FULL_COLD_START, re-stamp all map headers to a single watermark.

## Prior FULL_COLD_START Findings (at 948d3f2f — unchanged, retained for reference)

### Non-compliant
- compiler/native-parser/M5-SWAP-residual-decomposition.md — content-heuristic + spec-draft (`status: superseded`) → deref to scrml-support/archive/
- docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md — content-heuristic + location → deref to scrml-support/archive/
- docs/changes/v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md — content-heuristic + location → deref to scrml-support/archive/
- docs/changes/v0next-inventory/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md — location (superseded by 2026-05-21 audit) → deref to scrml-support/archive/
- docs/audits/articles-currency-table-2026-05-13.md — location → deref to scrml-support/archive/ or docs/
- docs/audits/wave-3-7-corpus-ouroboros-2026-05-13.md — location → deref to scrml-support/archive/
- docs/audits/scrml-support-currency-sweep-2026-05-21.md — location (cross-repo audit in wrong repo) → deref to scrml-support/docs/
- docs/audits/self-host-spec-conformance-2026-05-11.md — location (self-host post-v1.0) → deref to scrml-support/archive/
- docs/changes/match-block-form-scoping/SCOPING.md — gap partially/fully closed → update or deref
- docs/changes/serialize-scoping/SCOPING.md — `status: STASHED S103` planning-debt → deref to scrml-support/archive/
- docs/changes/v0.3.x-spa-tree-shake/SCOPING.md — planned/deferred arc → uncertain, needs human review
- docs/audits/scrml-dev-content-spec-fidelity-2026-05-19.md — location (website content audit) → deref to scrml-support/docs/

### Uncertain (from prior FULL_COLD_START scan — carried; not re-checked)
- compiler/native-parser/M5-ast-bridge-scoping.md — active but M5-swap incomplete; verify bridge contract (NOTE: S153 re-confirmed the native parser does NOT promote each/match — a hard M5-swap precondition; this doc's bridge contract should capture that)
- compiler/native-parser/M5-divergence-ledger.md — M6.6.b.x landings may have closed entries (NOTE: S153 each/match-no-structural-promotion is a NEW divergence-ledger candidate)
- compiler/native-parser/M6.6-CONTRACT-DERIVATION.md — verify M6.6.b.1 contract is current
- docs/changes/schemaFor-impl/SCOPE-AND-DECOMPOSITION.md — schemaFor shipped; verify sub-items closed (NOTE: S156 batch 3 added enum-subset CHECK IN — if this doc listed schemaFor-subset as open, it may now be closeable)
- docs/changes/tilde-codegen/SURVEY.md + ROUND-TRIP-SURVEY.md + FOLLOWUPS.md — tilde shipped; verify open items
- docs/changes/tilde-gaps-567/SURVEY.md — verify gap items against current type-system.ts
- docs/audits/spec-consolidation-inventory-2026-05-24.md — Phase 1a companion to in-progress HU
- docs/audits/spec-corroboration-canons-pipeline-2026-05-24.md — Phase 1b companion
- docs/audits/spec-feature-canon-coverage-2026-05-25.md — verify post-2026-05-25 closures
- docs/changes/v0.3-approach-a-spec/SCOPING.md — v0.3 shipped; verify all items landed
- docs/changes/a3-auth-graph-scoping/SCOPING.md — auth-graph.ts live; verify items landed
- docs/changes/runtime-perf-scoping/SCOPING.md — P3.B PGO landed; other arcs unknown
- docs/changes/tableFor-scoping/SCOPING.md — tableFor shipped; verify landed
- docs/changes/schemaFor-scoping/SCOPING.md — schemaFor shipped; verify landed
- docs/audits/null-audit-compiler-src-2026-05-13.md + undefined-audit-compiler-src-2026-05-13.md — historical sweep; deref if clean
- docs/pinned-discussions/w-program-001-warning-scope.md — verify W-PROGRAM-001 disposition
- docs/changes/v0next-audit/PARSER-AUDIT-2026-05-05.md — historical; deref if no open items
- docs/website/roadmap-from-v0.3-2026-05-14.md — now at v0.7.0; verify stale vs current roadmap items

---

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #enum-subset #message-dispatch #bug62 #bug65 #bug69 #header-drift #s154 #s155 #s156

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
