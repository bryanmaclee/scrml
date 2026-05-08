# non-compliance.report.md
# project: scrmlTS
# generated: 2026-05-08T00:00:00Z
# scan mode: INCREMENTAL_UPDATE (S69 close — commit f59bbcc)

## Summary

Total docs scanned: ~95 (top-3-depth `*.md` excluding `.git/`, `node_modules/`, `handOffs/`, `.claude/`, `dist/`, `build/`, `target/`)
Compliant:          ~72
Non-compliant:      10
Uncertain:          6

This S69 refresh adds B11-B22 dispatch dirs (all now SHIPPED), the S68-S69 test files, the A5-1 SPEC amendment, docs/audits new entries, and hand-off-68/69 as new items to assess. Items carried forward from the S67 report are marked.

## Non-compliant docs

### docs/articles/lsp-and-giti-advantages-draft-2026-04-25.md
**Reason:** name-heuristic (`-draft-` in filename) + superseded (CARRY-FORWARD from S67 report)
**Detail:** Published version exists at `docs/articles/lsp-and-giti-advantages-devto-2026-04-28.md`. Draft also references `BPP` as a live pipeline stage; PIPELINE.md v0.7.0 removed BPP.
**Suggested disposition:** deref to `scrml-support/archive/articles/` or delete.

### docs/articles/npm-myth-draft-2026-04-25.md
**Reason:** name-heuristic (`-draft-` in filename) + superseded (CARRY-FORWARD from S67 report)
**Detail:** Published version exists at `docs/articles/npm-myth-devto-2026-04-28.md`.
**Suggested disposition:** deref to `scrml-support/archive/articles/` or delete.

### docs/changes/ — completed dispatch dirs (CARRY-FORWARD + S68/S69 additions)
**Reason:** location + completed-work-as-current
**Detail:** All SHIPPED/LANDED/CLOSED dispatch dirs belong in `scrml-support/archive/dispatches/`. At S69 close the following are COMPLETE and accumulate in-tree:

**A1a (all COMPLETE at S61):**
- All `phase-a1a-step-*` dirs (20 sub-steps)
- `phase-4d-completion-sweep/` (DONE)
- `phase-a1a-lex-parse/` (DONE)

**Pre-S67 A1b (LANDED S63-S66):**
- `stage-0c.a-overload-deletion/` (LANDED S64)
- `parsevariant-impl/` (SHIPPED S65)
- `a-plus-verdict-execution/` (CLOSED S65)
- `ast-builder-grammar-fixes/` (LANDED S65)
- `api-js-stdlib-enum-reexport/` (LANDED S65)
- `phase-a1b-step-b1-symbol-table-extension/` (LANDED S63)
- `phase-a1b-step-b2-name-collides-state/` (LANDED S64)
- `phase-a1b-step-b3-name-resolution/` (LANDED S65)
- `phase-a1b-step-b5-cell-classifier/` (LANDED S65)
- `phase-a1b-step-b4-import-pinned-cycles/` (SHIPPED S66)
- `phase-a1b-step-b6-render-by-tag/` (SHIPPED S66)

**S67 A1b (SHIPPED S67):**
- `phase-a1b-step-b7-derived-dep-tracking/` (SHIPPED S67)
- `phase-a1b-step-b8-l21-walker/` (SHIPPED S67)
- `phase-a1b-step-b9-validator-arg-exprnode/` (SHIPPED S67)

**NEW S68 A1b (SHIPPED S68):**
- `phase-a1b-step-b11-compound-rollup-synth/` (SHIPPED S68 `e4a12fd`)
- `phase-a1b-step-b12-per-field-synth/` (SHIPPED S68 `0671286`)
- `phase-a1b-step-b13-derived-with-validators/` (SHIPPED S68 `336e66a`)
- `phase-a1b-step-b14-engine-binding/` (SHIPPED S68 `934100e`)
- `phase-a1b-step-b15-engine-statechild-typer/` (SHIPPED S68 `40e0511`)
- `phase-a1b-step-b16-derived-engines/` (SHIPPED S68 `773c38b`)
- `phase-a1b-step-b17-ontransition-component-engine/` (SHIPPED S68 `0ca232e`)

**NEW S69 A1b (SHIPPED S69):**
- `phase-a1b-step-b18-multi-statement-handler/` (SHIPPED S69 `87cbd36`)
- `phase-a1b-step-b19-channel-placement-shared-removal/` (SHIPPED S69 `7ce01e4`)
- `phase-a1b-step-b20-bare-variant-inference/` (SHIPPED S69 `79a1a96`)
- `phase-a1b-step-b21-refinement-three-zone/` (SHIPPED S69 `c5f9dcf`)
- `phase-a1b-step-b22-reset-target-shape/` (SHIPPED S69 `a294815`)

Note: `phase-a1b-step-b18-multi-statement-handler/` also contains `progress-failed-dispatch-1.md` and `SURVEY-failed-dispatch-1.md` — artifacts from a failed background dispatch (documented PA-debug recovery). These are shipping artifacts and move with the dispatch dir.

**Active (still current) dispatch dirs:** `phase-a1b-resolve-type/`, `phase-a1c-codegen/`, `promotion-ergonomics/` (Tier C pending), `v0next-inventory/`, `v0next-spec-impact/`, `v0next-audit/`, `predicate-gaps-deep-dive-prep/`, `reactive-derived-decl-divergence/`.
**Suggested disposition:** Run the PA's pending disposition (per curation matrix). Move all SHIPPED/LANDED/CLOSED dirs to `scrml-support/archive/dispatches/`.

### docs/deep-dives/boundary-security-indirect-refs-2026-04-24.md
**Reason:** location (deep-dive belongs in scrml-support per project-mapper rules) (CARRY-FORWARD)
**Suggested disposition:** deref to `scrml-support/docs/deep-dives/`.

### docs/deep-dives/boundary-security-progress.md
**Reason:** location (same as above) (CARRY-FORWARD)
**Suggested disposition:** deref to `scrml-support/docs/deep-dives/`.

### docs/deep-dives/lsp-enhancement-scoping-2026-04-24.md
**Reason:** location (same as above) (CARRY-FORWARD)
**Suggested disposition:** deref to `scrml-support/docs/deep-dives/`.

### benchmarks/fullstack-react/CLAUDE.md
**Reason:** name-heuristic + location (CARRY-FORWARD)
**Detail:** `CLAUDE.md` is an agent-instruction file; content is boilerplate. Anomalous inside a benchmark subdir.
**Suggested disposition:** delete.

### docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md
**Reason:** content-heuristic — self-declares "SUPERSEDED" in header (CARRY-FORWARD)
**Detail:** Doc explicitly states: "SUPERSEDED by `master-list.md` §0 live dashboard." A7/A8 ratified at S67, A5-1 LANDED S68, A1b COMPLETE at S69 — none reflected here. Live state is in master-list.md.
**Suggested disposition:** deref to `scrml-support/archive/dispatches/v0next-spec-impact/`.

### docs/changes/reactive-derived-decl-divergence/ADR.md
**Reason:** location — ADR files belong in scrml-support per project-mapper rules (CARRY-FORWARD)
**Detail:** ADR on reactive vs derived decl divergence. Decision locked and COMPLETE (S59 rename to `kind: "state-decl"` SHIPPED). ADR is historical rationale, not current truth.
**Suggested disposition:** deref to `scrml-support/docs/adrs/`.

### docs/audits/a1b-b11-rule4-audit-2026-05-07.md through a1b-b17-rule4-audit-2026-05-07.md (7 files)
**Reason:** content-heuristic — S67 these were flagged compliant as "forward-audit records (not yet dispatched)". At S69 close, B11-B17 are ALL SHIPPED (S68). The audits describe pre-dispatch planning for work that is now historical.
**Detail:** Same disposal path as the companion dispatch dirs above. The audits served their purpose; they are now post-hoc records of shipped work, identical in kind to B7-B10 audits (which were already noted as historical at S67).
**Suggested disposition:** Move to `scrml-support/archive/dispatches/` alongside B11-B17 dispatch dirs, OR keep in `docs/audits/` as historical record (lower priority than dispatch dirs). Human choice.

## Uncertain docs (needs human review)

### docs/audits/scope-c-stage-1-2026-04-25.md
**Reason:** age — dated 2026-04-25 (CARRY-FORWARD)
**What to check:** Confirm whether scope-c stage-1 is still the active audit baseline or superseded. If superseded, deref to scrml-support/archive/.

### docs/audits/scope-c-stage-1-sample-classification.md
**Reason:** age — companion to above (CARRY-FORWARD)
**What to check:** Same as above.

### docs/audits/kickstarter-v0-verification-matrix.md
**Reason:** age — references kickstarter-v0; v2 article exists (CARRY-FORWARD)
**What to check:** Has v0 been retired? If so, deref. If matrix still drives a verification gate, mark current and update header.

### docs/recon/* (8 files, all dated 2026-04-29)
**Reason:** age + location (CARRY-FORWARD)
**What to check:** Each file: was the recon target completed? If yes, deref to scrml-support/archive/recon/. Files: audit-remaining-phantoms, audit-spec-only-rows, compiler-dot-api-decision, lin-approach-b-verification, phase2-completion-status, phase2c-test-impact, tailwind-arbitrary-values-and-variants, tutorial-pass2-edit-list.

### docs/experiments/* (5 files, all dated 2026-04-25)
**Reason:** age + location (CARRY-FORWARD)
**What to check:** clueless-agent-* runs and SYNTHESIS/VALIDATION docs are research artefacts. If kickstarter-v0→v2 transition closed these out, they belong in scrml-support/docs/experiments/.

### docs/changes/v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md
**Reason:** uncertain — describes A7, A8 scope ratified but not yet dispatched (CARRY-FORWARD)
**What to check:** A5-1 SPEC amendments landed S68; A5-2+ implementation still pending. Does master-list.md §A7 sub-steps now capture all detail from this supplement? If yes and fully reflected, it becomes a dispatch artefact. If it contains timelines/OQ-links/debate-synthesis not in master-list, keep in-tree until A7 dispatch briefs absorb it.

## Compliant S68-S69 additions (new since S67 report)

- `docs/audits/a1b-b7-rule4-audit-2026-05-07.md` through `a1b-b10-rule4-audit-2026-05-07.md` — CARRY-FORWARD compliant from S67. Work SHIPPED; audits are historical records.
- `docs/audits/a1b-b18-b22-wave5-rule4-audit-2026-05-07.md` — Wave 5 bundled audit for B18-B22; work now SHIPPED (S69). Compliant as historical audit record.
- `docs/audits/a1c-roadmap-rule4-audit-2026-05-07.md` — A1c roadmap audit. Compliant (A1c still pending; audit is current planning doc).
- `docs/audits/item-c-temporal-engine-rule-migration-rule4-audit-2026-05-07.md` — Item C temporal surface migration audit. Compliant (A7 A5-1 LANDED S68; compiler pending; audit still current planning reference).
- `docs/audits/compiler-forgotten-surface-2026-05-06.md` — Forgotten surface audit S64. Compliant (historical).
- `docs/audits/scope-c-findings-tracker.md` — scope-c findings tracker. Compliant (active tracking doc).
- B11-B22 dispatch artefacts (BRIEF/SURVEY/progress.md files under `phase-a1b-step-b11-*` through `phase-a1b-step-b22-*`) — Compliant at scan time; move to `scrml-support/archive/` recommended (see non-compliant batch above).
- `compiler/SPEC.md` — authoritative; A5-1 amendments LANDED S68 `1de05ef`. Compliant.
- `compiler/SPEC-INDEX.md` — last regen S58; A5-1 amendments not yet reflected. Note: SPEC-INDEX.md is a generated file (`bash scripts/update-spec-index.sh`), not a docs file. Stale but not non-compliant by doc-hygiene rules; flag as needing regeneration.
- `docs/PA-SCRML-PRIMER.md` — updated S68 for A5-1 (§51.0.K/M/N/O/P/Q machine-cohesion + temporal surface). Compliant.
- `master-list.md` — current at S69 close (A1b COMPLETE, 9,626 pass). Compliant.
- `pa.md` — current at S69. Compliant.
- `docs/changelog.md` — current through S69. Compliant.
- `handOffs/hand-off-68.md`, `handOffs/hand-off-69.md` — historical hand-offs in `handOffs/` (excluded from scan scope).

## What changed since S67 baseline report

- **B11-B17 dispatch dirs:** now SHIPPED (S68); added to completed-dispatch batch.
- **B18-B22 dispatch dirs:** SHIPPED (S69); added to completed-dispatch batch.
- **NEW non-compliant:** B11-B17 audit docs — at S67 these were "forward-audit records" (compliant); at S69 the work is SHIPPED so they are historical-record artefacts.
- **B18-B22 audit docs:** The bundled `a1b-b18-b22-wave5` audit is still current (work shipped same session; audit is the post-hoc record). Treat as compliant-historical.
- **Persistent CARRY-FORWARD (5 items):** article drafts, deep-dives location, CLAUDE.md, IMPLEMENTATION-ROADMAP, ADR.
- **New uncertain:** none added (SCOPE-SUPPLEMENT carry-forward status unchanged).
- **Closed:** none since S67. SCOPE-SUPPLEMENT still uncertain.
- **SPEC-INDEX.md regen note added:** A5-1 amendments not yet reflected in index (stale but generated artifact, not a doc-hygiene violation).

## Tags
#non-compliance #project-mapper #cleanup #scrmlTS #s69-refresh #a1b-complete #docs-changes-batch #rule4-audits #b18-b22-shipped

## Links
- [primary.map.md](./primary.map.md)
- [docs/curation/2026-05-05-changes-dir-disposition.md](../../docs/curation/2026-05-05-changes-dir-disposition.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [scrml-support pa.md](../../../scrml-support/pa.md)
