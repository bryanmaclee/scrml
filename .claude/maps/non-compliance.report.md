# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-21T09:04:37-06:00
# scan mode: INCREMENTAL_UPDATE (S114 CLOSE — refresh against e613621 → 092fa90a)

## Summary

Refresh scope: the S114 19-commit native-parser arc landed M4.2 + M4.3 + MK4
(front-end COMPLETE) + K8-K12 K-ledger closure + M5-LIGHT flag + v0.4.0 + SPEC
amendments (no-async/await + Approach C ^{} primitives). Notable doc changes:

  - `docs/changes/quoted-text-model/` — DEREF'd to scrml-support/archive/ at
    S114 (commit `b61c4cbe`). Was the dominant "needs deref" finding in the prior
    scan; now GONE from the working tree. Prior non-compliance item CLOSED.
  - `compiler/native-parser/M5-ast-bridge-scoping.md` + `M5-divergence-ledger.md`
    — NEW S114. In-repo scoping docs for the M5-FULL dispatch. KEEP-LIVE
    (load-bearing reference for the next MD-ladder dispatch).
  - `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md` — updated
    S114 (K-ledger 12/12 RESOLVED; M4.2/M4.3/MK4 ✅; M5/M6 pending). CURRENT.
  - `docs/changes/native-parser-front-end/SPIKE-markup-js-seam-2026-05-20.md`
    — carried from prior scan; KEEP-LIVE (MK4 reference spike).
  - No new `progress-*.md` files added (the 13 arc-progress files from the prior
    scan are unchanged; MK4/M4.2/M4.3/K3-K5/K9-K12 dispatches wrote to the
    existing IMPLEMENTATION-ROADMAP §5 table + individual progress files already
    counted in prior scan; no net new progress files appear at HEAD).
  - `compiler/native-parser/README.md` — STALE. M-ladder table still shows the
    S112 OPEN status (M2/MK1 "in flight"). Surfaced as NON-COMPLIANT new item
    (see below).

Total docs scanned: ~200 (excluding node_modules, framework-comparison dirs,
.git/.jj/.claude, handOffs/, dist/, docs/website/**/dist/)
Compliant: ~102
Non-compliant: ~96 (net -3 from prior: quoted-text-model 4 files GONE; +1 README stale)
Uncertain: 4 (carried; §4.18.3 editorial item still open)

## RESOLVED since prior scan (e613621)

### RESOLVED — `docs/changes/quoted-text-model/` (4 files)
DEREF'd to scrml-support/archive/changes/quoted-text-model/ at S114 commit
`b61c4cbe`. Files no longer in the working tree. Prior-scan finding CLOSED.

## NEW since prior scan (e613621 → 092fa90a)

### NEW item 1 — `compiler/native-parser/README.md` M-ladder table STALE
**Reason:** grep-mismatch + content-heuristic
**Detail:** The README's M-ladder table (near the bottom of the file) shows the
S112 OPEN status — M2 "in flight", MK1 "in flight", M3/M4/MK2/MK3/MK4 "pending".
At HEAD `092fa90a` the actual status is: M1+M2+M3+M4 ✅ COMPLETE, MK1+MK2+MK3+MK4
✅ COMPLETE. The body text above the table also references M1.5 as "pending — minor
polish, non-blocking M2" and describes M2 as "in flight — M2.1 dispatched S112".
Both are false at HEAD. Every backticked identifier in the file does grep-resolve
into native-parser/*.js — the content issue is status correctness, not missing code.
The IMPLEMENTATION-ROADMAP §5 progress table IS current (updated per each dispatch);
the README table was not updated in any of the 19 S114 commits.
**Suggested disposition:** Update the README M-ladder table to match the
IMPLEMENTATION-ROADMAP §5 status at HEAD (JS chain M1-M4 ✅, markup chain MK1-MK4 ✅,
K-ledger 12/12 RESOLVED, M5/M6 pending). Also update the body text references to M2
being "in flight" and M1.5 being pending. This is a README-only edit; no code change.

### NEW item 2 — `compiler/native-parser/M5-ast-bridge-scoping.md`
**Type:** current in-flight scoping doc; KEEP-LIVE.
**Location:** `compiler/native-parser/M5-ast-bridge-scoping.md`
**Detail:** NEW S114. The load-bearing scoping pass for the M5-FULL pipeline-swap
dispatch. References `M5-ast-bridge-scoping.md` as the downstream-bridge rationale
in the CLI help text and api.js comments added at M5-LIGHT. Current + authoritative.
**Suggested disposition:** HOLD as KEEP-LIVE. This is the primary reference for
the M5-FULL scope-revision DD outcome (MD-ladder, ~98-180h). Once M5-FULL lands and
the pipeline is swapped, deref to scrml-support/archive/.

### NEW item 3 — `compiler/native-parser/M5-divergence-ledger.md`
**Type:** current in-flight scope artifact; KEEP-LIVE.
**Location:** `compiler/native-parser/M5-divergence-ledger.md`
**Detail:** NEW S114. Surface gap inventory for M5-FULL — what the native parser
CAN parse at M5.1 (per M4.3 + MK4) vs what diverges from the live pipeline
(because downstream routing hasn't happened yet). References real surface data
(conformance test counts, histogram of corpus files clean vs not). Current.
**Suggested disposition:** HOLD as KEEP-LIVE alongside M5-ast-bridge-scoping.md.

## Carried from prior scan (e613621) — UNCHANGED

### Carried — SPEC §4.18.3 vs §4.18.4 escape-count editorial inconsistency
**Reason:** uncertain — SPEC editorial (no code to deref)
**Detail:** §4.18.3 says "only two escape sequences" but §4.18.4 introduces a
third (`\${`). The native parser implements the correct 3-escape union. UNCHANGED
since prior scan — no SPEC amendment landed in S114 to resolve it.
**Suggested disposition:** SPEC editorial amendment to §4.18.3 — replace "the
only two" with the correct enumeration. Spec-only edit; no code change required.

### Carried — Native-parser-local `E-STMT-*` / `E-EXPR-*` codes not in SPEC §34
**Type:** intentional pre-M5 gap; flag for M5-FULL §34 reconciliation.
**Detail:** 32 distinct `E-STMT-*`/`E-EXPR-*` codes emitted by parse-stmt.js /
parse-expr.js; zero in SPEC §34. Intentional until M5-FULL makes them user-visible.
**Suggested disposition:** Track as part of the M5-FULL dispatch brief.

### Carried — `docs/changes/native-parser-front-end/` (15 files)
**Type:** in-flight progress notes and arc reference docs; KEEP-LIVE.
**Files:** IMPLEMENTATION-ROADMAP.md (✅ current) + SPIKE-markup-js-seam-2026-05-20.md
+ 13 progress-*.md files (progress-m1x-cluster, m2.4, m3.1..m3.4, m4.1, mk2.1..mk2.3,
mk3.1..mk3.3). Note: no MK4 / M4.2 / M4.3 / K3-K12 individual progress files were
created — those dispatches wrote directly to the IMPLEMENTATION-ROADMAP §5 table.
**Suggested disposition:** HOLD all as KEEP-LIVE. Deref `docs/changes/native-parser-front-end/`
to `scrml-support/archive/changes/` only when M6 lands (the entire arc closes together).
The `compiler/native-parser/` in-source docs (M5-ast-bridge-scoping.md, M5-divergence-ledger.md,
README.md) are a separate deref decision (post-M6).

### Carried — `docs/changes/` completed-dispatch dirs (89 directories; was 89)
The S114 arc added no new docs/changes/ dirs (dispatches used existing
IMPLEMENTATION-ROADMAP). Net count unchanged. The dominant non-compliance remains:
completed-and-landed dispatch dirs that should deref to scrml-support/archive/changes/.
Per the S61/S79 precedent and the S91 + S113 maps refresh decisions, this is a
PA-decided batch deref item. Disposition matrix at:
`docs/curation/2026-05-05-changes-dir-disposition.md`.

### Carried — `docs/audits/` (7 of 9 historical → deref; 2 KEEP-LIVE)
DEREF to scrml-support/archive/audits/:
  articles-currency-table-2026-05-13.md
  compiler-forgotten-surface-2026-05-06.md (KEEP-LIVE until actioned)
  happy-dom-perf-regression-s87-2026-05-12.md
  null-audit-compiler-src-2026-05-13.md
  self-host-spec-conformance-2026-05-11.md
  undefined-audit-compiler-src-2026-05-13.md
  wave-3-7-corpus-ouroboros-2026-05-13.md
KEEP-LIVE (active trackers):
  scope-c-findings-tracker.md (open scope-C work)
  scrml-dev-content-spec-fidelity-2026-05-19.md (recent — uncertain; see below)

### Carried — `docs/articles/*-devto-*.md` + drafts (16 marketing files)
Deref to scrml-support/docs/articles/.

### Carried — `docs/website/` (3 source files)
Deref the 1 superseded announcement; HOLD the current 2 (v0.3.0 announce + roadmap)
per prior PA call. The v0.4.0 changelog entry is in docs/changelog.md (compliant).

### Carried — `docs/curation/2026-05-05-changes-dir-disposition.md`
HOLD until the docs/changes/ deref executes, then archive.

### Carried — `docs/pinned-discussions/w-program-001-warning-scope.md`
Deref to scrml-support/docs/.

### Carried — `docs/m1-benchmark-results.md`
Gitignored per-run dump; delete.

## Uncertain docs (needs human review)

### Carried — `compiler/SPEC.md` §4.18.3 vs §4.18.4 escape-count
**Reason:** Editorial inconsistency between two adjacent normative subsections.
**What to check:** PA-decide whether to land this as a SPEC editorial amendment
now (small surface; ~2-line edit to §4.18.3), or batch with a future §4.18 amendment.

### Carried — `docs/changes/predicate-gaps-deep-dive-prep/SCOPE.md`
**Reason:** S79 matrix KEEP-LIVE; status unchanged.

### Carried — `docs/changes/v0next-audit/` + `v0next-inventory/`
**Reason:** Likely now historical; PA should confirm against current master-list.

### Carried — `docs/audits/scrml-dev-content-spec-fidelity-2026-05-19.md`
**Reason:** Recent enough that it may still be an active tracker.

## Compliant — confirmed current-truth (mapped or map-eligible)

compiler/SPEC.md, compiler/SPEC-INDEX.md, compiler/PIPELINE.md — authoritative,
  at current HEAD. SPEC.md updated S114 (§21.3.1 + §22.5.1 + §22.12 + §22.13
  Approach C; no-async/await §19.9.8; §34 +3 no-async/await codes + +2 Approach C
  codes; SPEC-INDEX.md regenerated). NOTE: §4.18.3 editorial item still open.
README.md, DESIGN.md, scrmlFormula.md — current project reference.
docs/tutorial.md, docs/lin.md, docs/external-js.md — current language reference docs.
docs/known-gaps.md — current honest drift ledger.
docs/changelog.md — updated at S114 (v0.4.0 release entry + S114 session entries).
docs/PA-SCRML-PRIMER.md — current PA primer; updated S114.
pa.md, master-list.md, hand-off.md — current project operating docs (hand-off.md
  rotated to S114 CLOSE at 092fa90a).
compiler/src/codegen/README.md — current source-tree README.
compiler/native-parser/M5-ast-bridge-scoping.md — NEW S114; current scoping doc.
compiler/native-parser/M5-divergence-ledger.md — NEW S114; current scope artifact.
docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md — the
  authoritative M-ladder + K-ledger tracker; §5 progress table is the single
  source of truth. UPDATED S114 (K8-K12 RESOLVED; M4.2/M4.3/MK4 ✅). CURRENT.
e2e/README.md, examples/README.md, examples/VERIFIED.md, editors/neovim/README.md,
  scripts/git-hooks/README.md, benchmarks/README dirs, samples gauntlet READMEs —
  current dir-local READMEs.
examples/23-trucking-dispatch/{README,FRICTION}.md — current example docs.
compiler/tests/commands/migrate-program-shape-fixtures/README.md — current.
compiler/tests/conformance/s32-fn-state-machine/REGISTRY.md — current.
docs/changes/full-body-split/EXT-1-IMPL-BRIEF.md — NEW S114; current Ext 1 impl
  brief authored at S114 CLOSE (~88-112h impl pending). KEEP-LIVE.

## Map-set state

This refresh updated 9 map files:
  structure.map.md  — native-parser 27→29 modules; M-ladder COMPLETE; K-ledger 12/12; MK4 seam
  dependencies.map.md — native-parser module graph +2 (parse-seam, delegation-frame); K9 fix
  schema.map.md     — ExprKind +MarkupValue; TokenKind +K3/K4/K5 tokens; seam layer schema
  config.map.md     — --parser=scrml-native note updated (was "forthcoming", now wired)
  build.map.md      — --parser=scrml-native documented as live; v0.4.0 note
  error.map.md      — I-PARSER-NATIVE-SHADOW documented; K-ledger closure noted
  test.map.md       — 731→732 files; S113→S114 pass counts; 4→6 parser-conformance files
  domain.map.md     — M4 COMPLETE; MK4 COMPLETE; K-ledger 12/12; M5-LIGHT documented
  non-compliance.report.md — this file
  primary.map.md    — watermarks + key facts updated

No new conditional map files created; no conditional-map trigger fired.
Total maps at HEAD: 9 (8 substantive + primary) + this report.

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #docs-changes #scope-principle #native-parser #spec-editorial #mk4 #k-ledger

## Links
- [primary.map.md](./primary.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [docs/changes curation matrix](../../docs/curation/2026-05-05-changes-dir-disposition.md)
- [native-parser IMPLEMENTATION-ROADMAP](../../docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md)
- [M5 AST bridge scoping](../../compiler/native-parser/M5-ast-bridge-scoping.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
