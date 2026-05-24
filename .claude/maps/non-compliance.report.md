# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-23T00:00:00Z
# scan mode: FULL_COLD_START

## Summary

Total docs scanned: ~295 `.md` files (excluding node_modules, .git, .jj, .claude, archive, handOffs, dist/build/target).
Compliant: ~15 (core spec, READMEs, reference docs, progress artifacts — all correctly placed or in-scope).
Non-compliant: 5 categories (same as prior scans — no new categories surfaced at HEAD).
Uncertain: 3 (unchanged).

SPEC.md modification watermark: 2026-05-23 (current). Last additions: §6.1.1/§6.1.2 V-kill; §34 E-STATE-UNDECLARED + E-WRITE-NOT-IN-LOGIC-CONTEXT; §40.8 amendment. No prior sections invalidated.

S124 changes (d570341d → 73dd816c — 5 commits in scope description, plus ~8 more commits from earlier that were part of the watermark delta):
- NEW `docs/changes/mcp-v0-devtools-scoping/` — SCOPING + progress for MCP V0; in-flight process artifact; falls into docs/changes/** aggregate. NOT non-compliant by category — it's a current-dated scoping doc.
- NEW `docs/changes/m65-b0-within-node-canary/progress.md` — current progress artifact.
- MODIFIED `docs/changes/m65-path-b-adapter-scoping/` — SCOPING.md + progress.md + fixtures/ + tools/; active work; compliant placement.
- NEW `docs/changes/m66-b1-5-attr-tokenizer-extension/progress.md` — compliant.
- NEW `docs/changes/m66-b2-symbol-table-migration/progress.md` — compliant; M6.6.b.2 LANDED, eligible for deref post-session.
- NEW `docs/changes/m66-b3-legacy-helper-migration/progress.md` — compliant; LANDED, eligible for deref.
- MODIFIED `docs/changes/m67-phase-a-flag-flip/progress.md` — M6.7 STOP recorded; compliant.
- MODIFIED `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md` — current reference; compliant.
- No newly-flagged stale-claim docs. Specifically: M6.6.b.2 is now LANDED (not pending); MCP V0 SCOPING correctly self-identifies as planning-only.

## Non-compliant docs

### docs/changes/** (~230+ files across ~120+ directories)
**Reason:** location + name-heuristic (combo)
**Detail:** Every directory under `docs/changes/` is a per-dispatch artifact set (BRIEF.md, SCOPE.md, progress.md for completed or in-flight work). S124 added new dirs: mcp-v0-devtools-scoping, m65-path-b-adapter-scoping (expanded), m65-b0-within-node-canary, m66-b1-5-attr-tokenizer-extension, m66-b2-symbol-table-migration, m66-b3-legacy-helper-migration, m67-phase-a-flag-flip. All fall into the same aggregate class as prior scans. The standing curation matrix at `docs/curation/2026-05-05-changes-dir-disposition.md` dispositions these to `scrml-support/archive/dispatches/`. Newly-completed dirs (M6.6.b.2, M6.6.b.3, M6.2b, V-kill, Unit CC, GITI-017, 6nz-Bug-P) are eligible for post-session deref.
**Suggested disposition:** deref completed-arc dirs to scrml-support/archive/dispatches/; keep actively-in-flight dirs (m65-path-b-adapter-scoping, mcp-v0-devtools-scoping, m6.6.b.4+). At scale (~230+ files), a batched deref after M6.8 close is cleaner than per-dir handling.

### docs/website/roadmap-from-v0.3-2026-05-14.md
**Reason:** content-heuristic + name-heuristic
**Detail:** `status: draft`; adopter-facing roadmap describing aspirational direction from v0.3. Package.json is now v0.6.0. Predates current state by 3 minor versions.
**Suggested disposition:** deref to scrml-support/docs/.

### docs/website/v0.2.0-announce-2026-05-05.md  and  docs/website/v0.3.0-announce-2026-05-14.md
**Reason:** location + currency
**Detail:** Version-announcement copy for superseded releases.
**Suggested disposition:** deref both to scrml-support/docs/ (or archive v0.2.0).

### docs/audits/** (11 audit docs)
**Reason:** location
**Detail:** articles-currency-table, article-truthfulness-audit, compiler-forgotten-surface, null-audit, undefined-audit, wave-3-7-corpus-ouroboros, self-host-spec-conformance, happy-dom-perf-regression, scrml-dev-content-spec-fidelity, scrml-support-currency-sweep, scope-c-findings-tracker. Point-in-time investigation artifacts that belong in scrml-support per the "audits live in scrml-support" rule.
**Suggested disposition:** deref to scrml-support/docs/ (or scrml-support/archive/). scope-c-findings-tracker.md may still be live — see Uncertain.

### docs/curation/2026-05-05-changes-dir-disposition.md
**Reason:** location + currency
**Detail:** Curation matrix (S61) for the docs/changes/ deref. Snapshot count ("103 dirs total") is stale — docs/changes/ is now ~120+ dirs / 230+ .md files.
**Suggested disposition:** deref to scrml-support/docs/ once the docs/changes/ deref is executed; or update count and keep as standing checklist.

## Uncertain docs (needs human review)

### docs/known-gaps.md
**Reason:** This doc explicitly catalogs spec-vs-implementation drift — by construction it describes things the compiler does NOT yet do. Looks non-compliant under grep cross-check but is the intentionally-maintained drift ledger.
**What to check:** Confirm whether known-gaps.md should stay as a project-repo reference (current-state-honest) or move to scrml-support. Recommendation: KEEP — it is the opposite of aspirational-pretending-to-be-current.

### docs/pinned-discussions/w-program-001-warning-scope.md
**Reason:** "pinned discussion" is debate-shaped, which the scope rule says belongs in scrml-support. But "pinned" suggests an intentionally-retained active design note.
**What to check:** Determine if the W-PROGRAM-001 scope question is resolved. If resolved, deref to scrml-support/docs/. If still open, keep.

### docs/external-js.md  and  docs/lin.md
**Reason:** Reference-shaped docs (external-js integration; `lin` token feature) but not cross-checked at scan time.
**What to check:** Grep identifiers each cites against compiler/src. Both features resolve in source (`LinDeclNode` in ast.ts; `LinDecl` StmtKind in native parser as of B4; api.js handles .js imports) — recommend KEEP pending quick grep confirmation.

## Notes on compliant / in-scope docs (NOT flagged)

- `compiler/SPEC.md`, `SPEC-INDEX.md`, `PIPELINE.md` — authoritative spec; mapped.
- `README.md`, `DESIGN.md`, `docs/tutorial.md`, `docs/changelog.md`, `scrmlFormula.md` — current reference.
- `docs/PA-SCRML-PRIMER.md` — adopter-side primer; in-scope.
- `compiler/native-parser/README.md`, `M5-ast-bridge-scoping.md`, `M5-divergence-ledger.md`, `M5-SWAP-residual-decomposition.md` — current native-parser reference; in-scope.
- `compiler/native-parser/M6.6-CONTRACT-DERIVATION.md` (540L; updated M6.6.b.1.5) — current cookbook for M6.6.b.4..b.6; IN-SCOPE (active dispatch target).
- `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md` — current roadmap; updated M6.7 STOP; in-scope.
- `docs/changes/mcp-v0-devtools-scoping/SCOPING.md` — current in-flight SCOPING; correctly self-labels as planning-only.
- `compiler/src/codegen/README.md`, `compiler/tests/.../REGISTRY.md`, `compiler/tests/commands/migrate-program-shape-fixtures/README.md` — module-local reference; in-scope.
- `hand-off.md`, `master-list.md`, `pa.md` — project orchestration; in-scope.

## Tags
#non-compliance #project-mapper #cleanup #scrmlts

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
