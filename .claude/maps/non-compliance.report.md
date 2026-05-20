# non-compliance.report.md
# project: scrmlts
# generated: 2026-05-20T13:42:44-06:00
# scan mode: FULL_COLD_START

## Summary

Total docs scanned: 199 (excluding node_modules, framework-comparison dirs, .git/.jj/.claude, handOffs/, dist/)
Compliant: ~96
Non-compliant: ~99
Uncertain: 4

The dominant non-compliance is `docs/changes/**` — a working area that the S61
and S79 maps-refresh scans already swept (S79 cut it to 4 KEEP-LIVE dirs;
governing matrix: `docs/curation/2026-05-05-changes-dir-disposition.md`). It has
since regrown to **88 dirs** across the S80–S111 arc. Per the "current truth
only" scope principle, completed-and-landed dispatch dirs belong in
`scrml-support/archive/changes/`; in-flight scoping/proposal docs are
non-compliant for a dev-scoped repo map regardless. This is not new drift — it
is the recurring regrowth the prior two scans both flagged.

## Map-set cleanup already performed by this scan

These stale `.claude/maps/` files were deleted (not spec-mandated, predated this
regen, or superseded):
- `events.map.md` — events is not a detected conditional-map trigger for a compiler; stale leftover.
- `native-parser.map.md` — not a spec-defined map type; native-parser is covered in domain.map.md.
- `INDEX.md` — not a spec-defined map; primary.map.md is the index.
- `non-compliance.md` — self-marked DEPRECATED; superseded by this file.

## Non-compliant docs

### docs/changes/** — 88 directories (per-feature working dirs)
**Reason:** combo (location + name-heuristic + content-heuristic)
**Detail:** `docs/changes/` is the in-flight working area. Its files are
`SCOPING.md`, `progress.md`, `BRIEF.md`, `SURVEY.md`, `SCOPE.md`,
`CLOSURE.md`, `DEFERRED.md`, `*-AUDIT-*.md`, `SPIKE-*.md`, `DISPATCH-*.md`,
`anomaly-report.md`, `pre-snapshot.md` — by name and content these are
planning / progress / proposal / audit docs describing in-flight or
just-landed work, not current-truth reference. The changelog confirms many
describe SHIPPED features (null-eradication, undefined-eradication, formFor,
schemaFor, tableFor, §13.2, §36, match-block-form, the a1/a2/a-4 arcs) — those
dirs are completed dispatches.
**Suggested disposition:**
  - Dirs describing SHIPPED-and-merged work → `deref to scrml-support/archive/changes/<dir>/`
    (the S61/S79 precedent — flat layout). This is the large majority:
    e.g. `null-eradication-*` (S89 landed), `undefined-eradication-*` (S89),
    `formFor-*` / `schemaFor-*` / `tableFor-*` (S102-S103), `§13.2-impl-phase-*`,
    `§36-impl-phase-*` / `§36-input-devices-impl`, `a1-closeout`,
    `a2-1-module-scaffold`, `a2-2-component-1`, `a-2-8-emit-reachability-canonical`,
    `a2-reachability-solver-scoping`, `a3-auth-graph-scoping`,
    `a-4-2..a-4-7` + `a-4-per-route-artifact-splitter-SCOPING`,
    `a9-ext4-body-split-min-viable`, `match-block-form-scoping`,
    `m1-1-native-lexer-skeleton`, `m1-2-strings-and-templates`,
    `m-7c-d-12-runtime-sentinel-scoping`, `m-7c-d-paired-migration`,
    `bench-refresh-v0.3.0`, `bs-layer-corpus-friction-bugs`,
    `bug-5-const-interpolation-scoping`, `canonical-examples-sweep`,
    `cg-006-server-only-body-emission`, `combined-lint-additions-s98`,
    `fix-lift-async-iife-paren`, `heads-up-s95-bugs`, `mpa-entity-decoding-fix`,
    `phase-3a-async-jwt`, `s100-tailwind-engine-extension`,
    `scrml-dev-codegen-divergence`, `stdlib-phase-1-5-null-sweep`,
    `tilde-codegen`, `tilde-gaps-567`, `todomvc-edit-mode-landing`,
    `v0.3-approach-a-spec`, `v0.3-todomvc-e2e-reverify`,
    `wave-3-7-audit`, `wave-3-7-backlog-migration`, `wave-4-adopter-content-scoping`,
    `wave-4-d-track`, `wave-4-t-track`, `w-try-catch-lint`,
    `auth-redirect-tightening`, `bare-variant-inference-nested`,
    `03-contact-book-auth-redirect` + `-SCOPING`, `d-ri-pages`, `hos-restructure`,
    `pgo-scoping` / `pgo-phase-2-scoping` / `pgo-phase-3-scoping`,
    `perf-characterization`, `runtime-perf-scoping` + `runtime-perf-phase-*`,
    `v0.3.x-spa-tree-shake`, `serialize-scoping` (STASHED — superseded by schemaFor).
  - Dirs describing the CURRENT in-flight arc may be HELD as KEEP-LIVE until the
    arc lands, then dereffed — see "Uncertain docs" below for `quoted-text-model/`
    and `native-parser-front-end/`.
  - PA must verify per-dir SHIPPED status against the changelog and
    cherry-pick KEEP-LIVE exceptions before any batch deref, exactly as the
    S61/S79 matrix did.

### docs/audits/ — 7 of 9 files (historical audit reports)
**Reason:** location + name-heuristic (filenames carry dates older than the current SPEC mtime)
**Detail:** Audits are point-in-time forensic snapshots; they belong in
`scrml-support/archive/audits/` (the destination the S79 sweep created). The 7:
  - `null-audit-compiler-src-2026-05-13.md` — null-eradication arc audit (work landed S89)
  - `undefined-audit-compiler-src-2026-05-13.md` — undefined-eradication audit (landed S89)
  - `happy-dom-perf-regression-s87-2026-05-12.md` — S87 perf regression snapshot
  - `self-host-spec-conformance-2026-05-11.md` — S-era self-host conformance audit
  - `articles-currency-table-2026-05-13.md` — article currency snapshot
  - `wave-3-7-corpus-ouroboros-2026-05-13.md` — wave-3-7 corpus audit
  - `scrml-dev-content-spec-fidelity-2026-05-19.md` — recent (S109) — verify still active before deref
**Suggested disposition:** deref to `scrml-support/archive/audits/`.
NOT flagged (S79 explicitly designated KEEP-LIVE, still compliant):
  `compiler-forgotten-surface-2026-05-06.md`, `scope-c-findings-tracker.md`
  (the latter is an active findings tracker, not a frozen audit).

### docs/articles/*-devto-*.md + drafts — 16 files (published marketing articles)
**Reason:** location
**Detail:** These are dev.to / blog publications and one tweet draft
(`teej_baiting_tweet.md`, `x-snippet-zod-calibration-2026-05-06.md`). They are
adopter-marketing content, not compiler reference. Two are explicitly
calibration/snippet drafts. Articles describe the language at a past version
snapshot and drift relative to current SPEC by design.
**Suggested disposition:** deref to `scrml-support/docs/articles/` (or an
`articles-published/` subdir). Keep only if the project deliberately ships
its own marketing corpus from the repo — PA decides. The `llm-kickstarter-v1`
and `-v2` files are version-stamped LLM primers; v1 (2026-04-25) is superseded
by v2 — deref v1 at minimum.

### docs/website/ — 3 files (landing-page announcement drafts)
**Reason:** content-heuristic (front-matter `status: draft`) + location
**Detail:**
  - `v0.2.0-announce-2026-05-05.md` — `status: draft`; superseded by the v0.3.0 announce
  - `roadmap-from-v0.3-2026-05-14.md` — `status: draft`; a forward-looking roadmap (aspirational by definition)
  - `v0.3.0-announce-2026-05-14.md` — `status: published` — the current announce; the other two are stale relative to it
**Suggested disposition:** v0.2.0-announce → deref to scrml-support (superseded);
roadmap → deref to scrml-support/docs/ (roadmaps are not current-truth);
v0.3.0-announce → KEEP if the repo ships its own site content, else deref.

### docs/curation/2026-05-05-changes-dir-disposition.md
**Reason:** name-heuristic (dated curation working doc) + content (a one-shot disposition matrix)
**Detail:** This is the S61/S79 curation execution log. Its work is done
(it records "all 10 batches complete; 207 deref operations"). It is a historical
process artifact, not current truth.
**Suggested disposition:** deref to `scrml-support/archive/` — but it is the
authoritative precedent for the `docs/changes/` deref above, so HOLD it until
that deref is executed, then archive it alongside.

### docs/pinned-discussions/w-program-001-warning-scope.md
**Reason:** content-heuristic (a parked decision-needed discussion)
**Detail:** Per `scope-c-findings-tracker.md`'s own description, pinned-discussions
are "decisions the user has parked for later conversation" — i.e. open/unresolved
design questions, not current truth.
**Suggested disposition:** deref to `scrml-support/docs/` (parked-discussions
belong with deep-dives / debates, not in the project map surface). If the
discussion has since been resolved by SPEC, delete.

### docs/m1-benchmark-results.md
**Reason:** name-heuristic + .gitignore says it is a per-run dump
**Detail:** `.gitignore` explicitly lists this path: "raw per-run dump that
should never be tracked ... the curated, committed benchmark file is
benchmarks/RESULTS.md." It is present in the working tree but ignored.
**Suggested disposition:** delete (it is a regenerated artifact; not tracked).

## Uncertain docs (needs human review)

### docs/changes/quoted-text-model/  (4 files: IMPLEMENTATION-ROADMAP, INVESTIGATION-PLAN, SPIKE-bs-mode-flag, wave-1-progress)
**Reason:** Cited by the CURRENT `compiler/SPEC-INDEX.md` (S111 amendment notes)
as the authority for the in-flight quoted-text-model arc. `compiler/SPEC.md`
§4.18 was authored from it (Wave 1 landed 2026-05-20). It is live working
material for an arc that is mid-flight.
**What to check:** Confirm the arc is still in flight. If so, HOLD as KEEP-LIVE.
Once Waves 2-7 land, deref the whole dir to `scrml-support/archive/changes/`.

### docs/changes/native-parser-front-end/  (1 file: SPIKE-markup-js-seam-2026-05-20)
**Reason:** Dated 2026-05-20 (current). The changelog S111-CLOSE entry says the
native-parser "charter B" decision expanded the native-parser project to replace
the whole compiler front-end — this dir is the current charter's working area.
**What to check:** Confirm native-parser-front-end is the active arc. If so,
HOLD as KEEP-LIVE; deref when the arc lands.

### docs/changes/predicate-gaps-deep-dive-prep/ (1 file: SCOPE.md)
**Reason:** S79 matrix explicitly designated this KEEP-LIVE. Whether it is still
live for the current arc is unclear from the changelog.
**What to check:** If the predicate-gaps deep-dive has been completed, deref to
`scrml-support/archive/changes/`. If still prep material, HOLD.

### docs/changes/v0next-audit/ + v0next-inventory/  (PARSER-AUDIT, SCOPE-MAP, SCOPE-SUPPLEMENT, ARTICLE-TRUTHFULNESS-AUDIT — all dated 2026-05-05)
**Reason:** S79 matrix designated both KEEP-LIVE (cited by master-list §0.3 at
the time). The v0.next arc has since progressed through v0.3; these 2026-05-05
audit snapshots are likely now historical.
**What to check:** Confirm master-list no longer cites them as live. If
confirmed stale, deref to `scrml-support/archive/audits/`.

## Compliant — confirmed current-truth (mapped or map-eligible)

compiler/SPEC.md, compiler/SPEC-INDEX.md, compiler/PIPELINE.md — authoritative,
  at current HEAD (SPEC.md mtime == commit time).
README.md, DESIGN.md, scrmlFormula.md — current project reference.
docs/tutorial.md, docs/lin.md, docs/external-js.md — current language reference docs.
docs/known-gaps.md — explicitly the "honest current state" spec-vs-impl drift
  ledger, updated S109; describes drift accurately — compliant by design.
docs/changelog.md — current rolling log (S111 baseline).
docs/PA-SCRML-PRIMER.md — current PA primer.
pa.md, master-list.md, hand-off.md — current project operating docs.
compiler/src/codegen/README.md, compiler/native-parser/README.md — current source-tree READMEs.
e2e/README.md, examples/README.md, examples/VERIFIED.md, editors/neovim/README.md,
  scripts/git-hooks/README.md, benchmarks/README dirs, samples gauntlet READMEs —
  current dir-local READMEs.
examples/23-trucking-dispatch/{README,FRICTION}.md — current example docs.

## Tags
#non-compliance #project-mapper #cleanup #scrmlts #docs-changes #scope-principle

## Links
- [primary.map.md](./primary.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [docs/changes curation matrix](../../docs/curation/2026-05-05-changes-dir-disposition.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
