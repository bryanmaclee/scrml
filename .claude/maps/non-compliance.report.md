# non-compliance.report.md
# project: scrml
# generated: 2026-07-18T08:36:53-06:00
# scan mode: TARGETED_REFRESH (S265 CSS deep-verify + watermark advance c779e606 -> 99ae45ca); prior incremental base 0a79d838 -> c779e606; full scan base fbb4d9fd -> f079d0a9

## This pass (targeted CSS/§65/§25/codegen refresh)

Scope: advance the map watermark to the S265 wrap HEAD 99ae45ca and DEEP-VERIFY the two S265
bryan-lane CSS landings (#95 CSS Wave-1 emission §65, #98 §25 CSS-var bridge fix) against the actual
source, because a concurrent-wrap collision had resolved the 6 nav maps to Peter's #101
routing-level versions and left the stamp at c779e606. Only the maps were written; compiler/src was
NOT touched (a concurrent fix agent owns it on a separate branch/worktree).

### RESOLVED this pass — collision-staleness in the map set
- **Stamp drift (8 maps):** structure / dependencies / schema / config[*] / build / error / test /
  domain / primary all carried `commit: c779e606`. The 7 CSS-bearing maps (structure, dependencies,
  schema, build, error, test, domain) + primary are now re-stamped `99ae45ca` @ 2026-07-18.
  ([*] config/auth/infra intentionally LEFT at `f079d0a9`/S264 — they carry no CSS content and were
  NOT re-verified this pass; an honest older stamp is preferable to a false "verified at 99ae45ca".)
- **Deep-verified (were routing-level only under Peter's #101):** `codegen/emit-theme-reset.ts`
  (9 exports, read in full), the §25 bridge fix in `codegen/collect.ts` + `codegen/emit-reactive-wiring.ts:882`,
  the §34 catalog row `E-THEME-TOKEN-UNKNOWN` (SPEC.md:18148 + §65 banner SPEC.md:111-row), and the
  `generateCss` (emit-css.ts:382 → index.ts:1146) CSS pipeline stage. Content confirmed accurate;
  dependencies/schema/primary gained the #98 bridge-fix codegen specifics (dropped
  `isScoped`/`scoped`/`_constructorScoped`; `document.documentElement` target).
- Between c779e606 and 99ae45ca, ONLY docs changed (changelog/known-gaps/hand-off/delta-log/
  master-list + 2 handOffs continuity docs) — verified via `git diff --name-only c779e606..99ae45ca`
  over `compiler/src`, `compiler/tests`, `conformance/` (empty). So no source-derived map claim was
  invalidated by the collision beyond the stamp itself.

### New non-compliant docs this window: 0
`git diff --diff-filter=A --name-only 0a79d838..99ae45ca -- '*.md'` filtered against
`docs/changes/|handOffs/|spa-lists/|archive/` returns NOTHING. Every new `.md` this window is a
correctly-parked dispatch-archive record (`docs/changes/css-wave1-emission-2026-07-16/**` incl. a
`repros/` set, `docs/changes/component-css-var-scrml-el-fix-2026-07-17/progress.md`), a `handOffs/`
hand-off / incoming-read, or `spa-lists/` bookkeeping — all out-of-scope per the scope principle.

## Source-side observations (for the concurrent fix agent — NOT a doc-compliance item, do not action from the map lane)

- **`compiler/src/codegen/emit-theme-reset.ts:189-197` — stale in-source comment.** The docstring on
  `themeVariantAttr` states "the runtime reflection is a DEFERRED follow-on." That is stale: the
  §65.6 runtime theme-switch reflection LANDED in round-4 (`emitThemeSwitchReflection`,
  `emit-client.ts:1337`, wired at `:1994`), is asserted LANDED by SPEC §34 (SPEC.md:18148 area) +
  the §65 banner + `hand-off.md` (tag `#runtime-theme-switch-works`, "re-verified BY EXECUTION").
  A dev agent reading only that comment would wrongly believe theme-switching is unimplemented. The
  maps correctly record it as LANDED; this is a code-comment fix for whoever owns compiler/src.
- **`emit-theme-reset.ts` is the EMISSION half only** — the §65.2 conflict-CHECKER stays in
  `css-conflict-check.ts` (confirmed; maps reflect this). No drift, noted for orientation.

## Map-set self-audit (drift found in maps NOT rewritten this pass — deferred, flagged for the PA)

- **Test counts undercount HEAD (test.map.md + primary.map.md Size line).** `git ls-files` at HEAD:
  unit 813 (map says 807), integration 171 (170), conformance 118 (117), total 1208 (1200); D3
  `conformance/cases/` top-level dirs 51 (map narrative says 49). The tree did NOT change in this
  window, so this is PRE-EXISTING methodology drift, not a S265 regression. Left as-is (out of the
  CSS remit + methodology not cleanly re-derivable this pass); primary.map.md's Size line + Map Index
  now carry an explicit "undercounts HEAD by ~8" caveat pointing here. Reconcile at a full
  test.map.md refresh.
- **error.map.md §34 count (776) is "prior map + confirmed delta", NOT independently re-derived.** The
  map's own caveat (an independent first-cell extraction returns 758) remains unresolved since ~S255.
  The +1 (`E-THEME-TOKEN-UNKNOWN`) IS confirmed from source this pass; the 775 baseline is not. Carry
  the caveat; a count-methodology audit is due at the next FULL_COLD_START.
- **config.map.md / auth.map.md / infra.map.md stamped `f079d0a9` (S264).** Not non-compliant — their
  surfaces (env vars, scrml:auth stdlib, CI/infra) had no S265 CSS touch — but they lag two watermarks
  and were not re-verified. Re-verify on the next full pass.

## Carried-forward — Non-compliant docs (unchanged this window; native-parser/ + docs/ untouched by S265)

### compiler/native-parser/M5-SWAP-residual-decomposition.md
**Reason:** content-heuristic (self-marked "⚠ SUPERSEDED S117 (2026-05-21)") + date (stale vs SPEC.md mtime)
**Detail:** The document declares its own staleness. Unresolved across 948d3f2f/fbb4d9fd/f079d0a9 scans; native-parser/ showed no structural change in the S265 window.
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
**Reason:** location (docs/changes/ dispatch-archive, correctly parked) + date (stale) + content-heuristic (v0.next planning inventory, doubly superseded — the repo has since shipped §20.8 Client Router/outlet, §64.9 serve=, §65 CSS Wave-1 emission, §47.9.8 content-hashing)
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
- css-scrml-native-model-2026-07-07/SPEC-DRAFT.md -> SPEC.md §65 (Wave-1 emission half LANDED S265; the E-THEME-TOKEN-UNKNOWN §34 row + §65.6 theme-switch verified in-source this pass).
- realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md -> SPEC.md §38.13.
- standalone-tool-target-2026-07-04/SPEC-AMENDMENT.md -> SPEC.md §64 (+§64.9).
- clean-print-primitive-2026-07-06/SPEC-AMENDMENT.md -> SPEC.md §20.7.
- capability-vocab-v1-2026-06-30/SPEC-DRAFT.md -> SPEC.md §23.5.

`docs/changes/css-wave1-emission-2026-07-16/{BRIEF,BRIEF-s265-round4,progress}.md` + `repros/*` and
`docs/changes/component-css-var-scrml-el-fix-2026-07-17/progress.md` are correctly-parked dispatch
records for the two S265 CSS landings — same pattern, no action.

Reclassified at the base scan (self-labeled, not misrepresenting live state):
- docs/heads-up/const-deep-freeze-2026-05-26.md — `status: ratified`.
- docs/heads-up/lifecycle-annotation-extension-2026-05-25.md — `status: historical`.
- docs/heads-up/iteration-design-2026-05-25.md — `status: historical`.

## Scope notes / exclusions applied
- `docs/changes/` (dispatch-archive dirs) — designated historical-record location (like `handOffs/`); spot-checked, not exhaustively read.
- `spa-lists/`, `handOffs/`, `archive/` — out-of-scope per the scope principle; not scanned.
- No new `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/`, or `docs/research/` content this window — the repo stays clean of that category (those belong in scrml-support).

## CAVEAT
This was a TARGETED refresh of the CSS/§65/§25/codegen surface + a watermark advance, NOT a full
`*.md` re-scan. The S256-S263 latent delta noted at the S264 watermark remains unscanned for
doc-drift, as does anything outside the S265 CSS surface. A NON_COMPLIANCE_ONLY full re-scan +
test-count/§34-count reconciliation is advisable at the next wrap.

## Tags
#non-compliance #project-mapper #cleanup #scrml #css-wave1 #theme-token #css-var-bridge #comment-drift #test-count-drift #native-parser-stale #audit-currency #watermark-advance

## Links
- [primary.map.md](./primary.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [project master-list](../../master-list.md)
- [project pa.md](../../pa.md)
- [scrml-support archive convention](../../../scrml-support/pa.md)
