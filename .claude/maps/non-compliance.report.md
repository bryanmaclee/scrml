# non-compliance.report.md
# project: scrml
# generated: 2026-07-28T17:35:00Z  commit: 115e8b1b
# scan mode: INCREMENTAL_UPDATE (S297 map refresh over the `c700c435` -> `115e8b1b` window, 39 commits,
#            carrying forward three sessions of owed landings: S292, S295, S296)

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread.

## NEW at this HEAD

### N1. The MAP SET itself carried the third-party adopter identity the repo just scrubbed — FIXED THIS PASS
`89db7981` ("chore(privacy): anonymize third-party adopter identity across the public tree")
sanitized 47 files, moved 9 inbound correspondence files out of the public tree into
`scrml-support/handOffs/adopter-confidential/`, and renamed 5 `spa-lists/` files. **`.claude/maps/`
was not in that sweep** — and the maps ARE force-tracked (`git add -f`), so they publish with the
repo. At scan start, 11 mentions of the named application survived across five map files:
`primary.map.md` (4), `migrations.map.md` (4), `domain.map.md` (1), `schema.map.md` (1),
`structure.map.md` (1).
**Reason:** privacy / operator-directive violation, not doc drift.
**Disposition:** SCRUBBED in every map rewritten this pass. Engineering rationale preserved verbatim
throughout — only the identity was replaced ("an adopter" / "the adopter" / "adopter report").
**Standing rule for future map passes: a map generation must not reintroduce it.** The adopter's
bug reports stay, sanitized; the applications, their owner and their engineering artifacts do not.

### N2. STILL LEAKING — `hand-off.md` and `master-list.md` carry the scrubbed identity
Two tracked files in the PUBLIC tree still name the application (`hand-off.md` at 3 sites: an open
Q2 item, a BaaS-parity item, and a provenance note; `master-list.md` at 1 site, in a landed-commit
line). **This is outside this refresh's write footprint** (`.claude/maps/` only), so it is reported,
not fixed.
**Reason:** incomplete privacy scrub in the public tree.
**Suggested disposition:** same treatment as the 47 files in `89db7981` — neutral codename in
`hand-off.md`'s two live items, and either sanitize or leave the `master-list.md` commit-title echo
depending on whether the commit subject itself was rewritten upstream (it was not — `258ff020`'s
subject still names it in git history, which cannot be rewritten on a pushed public branch; that is
a separate, irreducible exposure worth an explicit operator decision rather than a silent carry).

### N3. `cloud-maps` CI has failed **17 of 17 runs**, and prior map generations described it wrongly
The scheduled nav-map regeneration workflow has failed every run since its first `workflow_dispatch`
on 2026-07-15: **3 `workflow_dispatch` runs and all 14 daily schedules** through 2026-07-28. Meanwhile `build.map.md` and
`infra.map.md` both described it as *"exists on branch `feat/cloud-maps-beachhead`, NOT merged into
main, needs the `scrml-maps-bot` GitHub App + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY`"*. **Every clause
of that was false at this HEAD:** it merged at `1971a87d` (2026-07-14), the App-token approach was
replaced by the fine-grained `MAPS_PAT` at `b5ec120b`, and it is on a daily cron.
**Reason:** map-vs-reality drift on the very automation that was supposed to keep the maps current —
the compounding failure the `g-maps-*` gap called out.
**Disposition:** both maps CORRECTED this pass; the full step list, design constraints and failure
analysis now live in build.map.md. The failure cause itself is reported in the refresh summary and
in build.map.md: agent errors on turn 1 after ~0.55-0.60s at **$0 cost** with zero permission
denials, i.e. an API-level rejection of the first request (credential/entitlement/quota on
`ANTHROPIC_API_KEY`), NOT a mapper-agent or repo-content fault. The workflow file has not changed
since 2026-07-16 12:31, which is AFTER the last long-running (12m31s) run, so the workflow is not
the regression. `show_full_output: false` suppresses the actual error text — flipping it (or adding
`--debug` to `claude_args`) on one `workflow_dispatch` run is the one-line diagnostic.
**Not fixed here:** `.github/` is outside this refresh's write footprint.

### N4. `docs/changes/navigate-wave1c-cross-chunk/` is no longer aspirational — the prior flag is RETIRED
Prior reports listed this archive under "Aspirational-content inventory" with the line
*"`W-NAV-CHUNK-LOAD-FAILED` has ZERO occurrences in `compiler/src/` and no §34 row. Any doc naming
that code describes planned work."* **Both halves are now false.** The code fires from
`runtime-template.js`'s `_scrml_nav_chunk_failed` (:2660-2667), §34 carries its row (`SPEC.md`
:18912), and §20.8.2/§20.8.7 are amended to require the behaviour. error.map.md's "NOT implemented —
do not add" note has been retired accordingly.
**Reason:** resolved. Listed so the retraction is explicit and the old note is not re-propagated.

### N5. NEW aspirational-content entry — `docs/changes/navigate-wave1c-piece1-landmark/`
A second parked navigate-wave1c archive sits beside the (now-built) cross-chunk one. Not
content-verified this pass.
**Reason:** uncertain — a dispatch archive whose sibling has since shipped is exactly the shape that
gets misread as current.
**What to check:** whether piece-1 landed under a different commit subject, or is genuinely still
parked. `docs/changes/**` is excluded from content-mapping by scope, so this is a heads-up only.

## CARRIED — spec/doc vs code

### C1. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
`compiler/SPEC.md:32121` says an omitted auth-scoped cell means "its `<div data-scrml-each-mount>`
is left empty". Since `df6d269c` the top-level `<each>` mount is a comment fence
`<!--scrml-each:N--><!--/scrml-each:N-->`; no `<div data-scrml-each-mount>` is emitted for a
top-level each at all. **Re-verified at this HEAD — still present, single site.** The §52.15.5
BEHAVIOUR is unchanged and correct (the fence is left unfilled); only the descriptive noun is stale.
**Reason:** grep-mismatch (a normative doc naming an emitted shape the compiler no longer produces).
**Suggested disposition:** update in place to "its each-mount fence is left unfilled". One clause; no
ruling needed.

### C2. Nine live `W-LINT-*` codes have no §34 row — **re-verified at this HEAD, still open**
`compiler/src/lint-ghost-patterns.js` carries **26 `code:` emit sites across 23 distinct codes**:
`W-LINT-001..008` + `010..024`. §34 catalogs `W-LINT-001..008` + `010..015` (14). So
**`W-LINT-016` … `W-LINT-024` — exactly nine — are live-but-uncatalogued.** The count of codes the
compiler can EMIT therefore exceeds the §34 catalog total (799) by at least nine.
**Correction to a plausible mis-read:** `W-LINT-009` is NOT a live code. A naive
`grep -o "W-LINT-0[0-9]+"` finds it at :868, but that hit is the COMMENT *"(No separate entry for
W-LINT-009 — W-LINT-004 subsumes it.)"*. Grep on `code:\s*"W-LINT-` to enumerate emit sites, not on
the bare code string. The absence of `009` from §34 is correct, not a gap.
**Reason:** spec-vs-impl gap.
**Disposition:** catalog the nine, or rule them internal-only. Whichever is chosen, the §34 total
should carry a footnote saying it counts the catalog, not the implementation.

### C3. `compiler/SPEC-INDEX.md` — the bloat half RESOLVED, the CURRENCY half still open
`0d95c364` (S290) did real work here: the ~72 KB inline amendment history (45% of a file that is a
mandatory full-read at every Profile-A PA boot, none of it current truth) was **dereffed** to
`scrml-support/archive/spec-index-changelog.md`, and the totals line became an `@generated` block
regenerated by `scripts/regen-spec-index.ts` and gated by `--check` in CI `gate` + the pre-push
currency hook. It now reads a correct `Total lines: 36,641 | Total sections: 65 + appendices`.
**What is still open:** the top-of-file `> Last updated:` banner still reads **2026-07-20 (S273)**
and narrates only the §14.8.10 tenant-floor landing. And `grep -c` for
`db-authoritative|SECURITY DEFINER|RLS` across the whole file returns **0** — the entire §14.8.11
tier (three normative sections, ~410 lines) has no Quick-Lookup entry and no Sections-table mention,
five sessions after it landed. A dev agent searching the navigation index by topic for "RLS",
"SECURITY DEFINER" or "db-migrate" finds nothing.
**Reason:** currency gap — an omission, not a contradiction (the section-14 line range still
numerically covers §14.8.11's location, so the index is not factually WRONG).
**Suggested disposition:** append Quick-Lookup rows for DB-authoritative / RLS / SECURITY DEFINER /
db-migrate → §14.8.11, and either refresh the banner to the current HEAD's landings or retarget it
to single-most-recent-session and accept that older deltas rotate out (bryan's call, not this map's).
No `SPEC.md` change needed.

### C4. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
Re-verified: :9, :646, :1039, :1121. `docs/FACTS.md` derives `compiler version` mechanically under a
CI `--check` gate, so this is a hardcoded figure that has a generated authority.
**Reason:** content-heuristic (a derived figure hardcoded in public content).
**Suggested disposition:** replace the version labels with a FACTS.md reference. **Note the tutorial
is NOT under the snippet gate as prose** — the S292 corpus widening covers `docs/website`, and even
there it gates only that a page COMPILES, never that its prose is true.

### C5. `compiler/native-parser/` parity — UNCONFIRMED, with one CONFIRMED gap
`git diff --name-only c700c435..115e8b1b -- compiler/native-parser/` returns **0 files**. Zero diff
across this window, and none was owed: every landing is emit-time, runtime, CLI or
diagnostic-message, none of it parsing/AST-shape.
- **Confirmed gap (unchanged):** `E-SCRIPT-001`. `parse-markup.js:983-995` carries an explicit
  `<style>` → `E-STYLE-001` mirror and has NO `<script>` counterpart.
- **Out of layer, no obligation this window:** D-4/D-5 coordinate space, the runtime-chunk gates,
  navigate-wave1c, the per-item reconcile family, i225, the Tailwind `outline-*` registrations, the
  queried-table grants — none of it touches the parser layer.
- **Genuinely unconfirmed:** GITI-038/039 parity; `E-SCHEMA-011` (schema-column parsing is
  `schema-differ.js`'s own line-based scan, not the native parser, so probably no obligation — but
  that has not been executed).
Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
grounds that nothing changed.

## OPEN — code defects filed at this HEAD

`docs/known-gaps.md` is the authority; these are cited for map-set completeness only, not re-derived.

**The map-routing gap this refresh was dispatched to close:**
- `g-maps-error-map-missing-diagnostics-and-emit-client` (MED, was OPEN) — **BOTH HALVES ADDRESSED
  THIS PASS.** (a) error.map.md now opens with an explicit lookup procedure and its family table
  routes `E-PA-*` → protect-analyzer.ts and `*-TAILWIND-*` → tailwind-classes.js, with wiring,
  suppression knob and stream (`lintDiagnostics[]`, not `errors[]`) spelled out. (b) primary.map.md's
  Task-Shape Routing gained a runtime-chunk row naming `emit-client.ts` `detectRuntimeChunks` +
  `POST_EMIT_HELPER_CHUNK_GATES` + `runtime-chunks.ts` `CHUNK_DEPENDENCIES`, and the two rows that
  wrongly pointed chunk work at `codegen/index.ts` were corrected. structure.map.md,
  dependencies.map.md and domain.map.md each carry the same locus. **The gap entry itself is not
  edited by this pass** (`docs/` is outside the write footprint) — the PA should close it.

**Carried, not re-verified this pass** (unrelated to this window's surfaces):
- `g-composition-strip-eats-last-dep-script` (HIGH) — **likely superseded by GH #235**, which
  replaced `codegen/index.ts`'s two `$`-anchored single-tag strips with one repeated-group
  `(…)+\s*$` regex for exactly this failure. **Verify and close, or re-scope.**
- `g-runtime-script-tag-not-depth-prefixed` (HIGH) — the runtime tag emits at depth 0. GH #235
  rebuilt the composed script set including a depth-prefixed runtime tag, so this may also be
  superseded. **Verify.**
- `g-uptoroot-vs-distrel-anchor-mismatch` (MED) — two composition path-anchoring functions disagree
  when the entry is not at the output base. **This is the same COORDINATE-SPACE class as D-4**
  (see domain.map.md's new section); GH #235's `hostFilePath` parameter explicitly anchors on the
  HOST rather than prefixing with `upToRoot` "for a shell that does not sit at the dist root, which
  `upToRoot` assumes". **Verify whether that closes it.**
- `g-item-derived-local-stale-in-per-item-effect-paths` — filed S288, appears **RESOLVED S293** by
  `computeItemDerivedReplay` + its browser regression lock. **Verify and close.**
- `g-nested-each-inner-binding-reads-outer-var-stale-on-reconcile` — appears **RESOLVED S294**.
- `g-schema-predicate-arg-parse-edges` (MED), `g-dbauth-p2-caps-provenance` (MED),
  `g-dbauth-secdef-owner-crud-all-tables` (LOW), `g-dbauth-no-request-path-test` (MED),
  `g-dbauth-docs-no-do-not-mark-users-example` (LOW), `g-match-nofor-block-form-skips-exhaustiveness`
  (MED), `g-tailwind-class-scan-skips-engine-non-initial-arms` (MED, filed `ed708cdf` this window).

**Nine further items were filed this window** by `3a1f431c` ("file the nine deferred items from the
three-lane adopter arc"). Not enumerated here — `docs/known-gaps.md` is the authority and it is
current.

## RESOLVED since the prior report

- **The §34 catalog count advanced 795 → 799**, `comm` set-diff verified, +4/-0: `E-SCHEMA-011`,
  `W-SCHEMA-CONSTRAINT-TIGHTENED`, `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED`, `W-NAV-CHUNK-LOAD-FAILED`.
  All four have live fire sites, verified by grep. See error.map.md.
- **`W-SERVER-IMPORT-UNEMITTED` is no longer blind to the class it exists to catch** (D-4, S296).
  Both `api.js` reversal sites route through the dist-keyed forward index.
- **`g-dbauth-migrate-no-grants-for-unmarked-identity-table`** (was HIGH) — closed S292 by the
  queried-table grant branch. The residual (a query shape the bounded scanner cannot resolve) is
  REPORTED to the operator, not silently skipped.
- **`g-db-migrate-ignores-constraint-drift-on-existing-columns`** — closed S290; §38.6.2 rows 6/7/8
  restored, with the §38.6.3 SQLite withheld-plan reporting fix beside it.
- **The `references` silent-drop** — closed S290 as `E-SCHEMA-011`. An adopter had declared 34
  foreign keys and gotten zero rows in `pg_constraint`, with no diagnostic.
- **`g-estmt-missing-semicolon-no-source-span`** — closed S294 by the `tabSpan → span` lift in
  `api.js`'s `collectErrors`; every TABError regains `:line:col` in the build/dev path.
- **The `outline-*` Tailwind false-fire** (D-3) — closed. A typo-detector that cries wolf on a real
  utility teaches adopters to ignore it, which is why this was a diagnostic BUG and not a gap.
- **`E-PA-002`'s remedy** now leads with `<schema>` + `scrml db-migrate` instead of teaching adopters
  to hand-write DDL against `bun:sqlite`.
- **SPEC-INDEX bloat** — 45% of a mandatory-full-read file dereffed; totals now generated + CI-gated.
- **Local pre-push now mirrors the cloud gate's cheap currency checks** (~261ms) — the S292 loop of
  three CI-rejected pushes in one session was a MISSING GATE, not a memory failure. Deliberately
  excludes `snippet-gate.js` (~48s): a hook that expensive gets bypassed, and a bypassed gate gets
  deleted.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

Under `docs/changes/**`, the per-dispatch archive, excluded from content-mapping by scope. Listed
only because they describe work that does NOT exist at this HEAD:
- `docs/changes/esm-chunks/U4-BRIEF.md` + `progress.md` — U4/U5/U6 (cross-chunk navigation ON ESM, a
  module-capable browser-test harness, the default-flip) are NOT built. `classic` is still the
  default and the only conformance-tested format. **Note the sharpened distinction: cross-chunk
  navigation IS built for CLASSIC (navigate-wave1c) — the esm variant is not.**
- `docs/changes/chunk-namespacing/{BRIEF,SCOPING}.md` — scoping for unbuilt work.
- `docs/changes/navigate-wave1c-piece1-landmark/` — see N5; unverified.
- `docs/changes/marketing-claim-gate/SCOPING.md` — U3+ of that arc is not built; `scripts/claim-gate.js`
  exists but is deliberately NOT CI-wired (measure-mode). Only `snippet-gate.js`, `facts.ts --check`
  and now `regen-spec-index.ts --check` are required checks.
- **RETIRED from this list:** `docs/changes/navigate-wave1c-cross-chunk/` — that work IS built. See N4.
- **RETIRED from this list:** the `db-authoritative-{m1,m2,p2}` archives — that work IS built.

## Uncertain — needs human review

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** all unmodified since 2026-06-22 or earlier, while SPEC.md has since gained the entire
§14.8.11 DB-authoritative tier plus this window's §23.2.4a / §38.6.2 / §39.5.5 / §20.8.2 amendments.
Not content-verified this pass — a full identifier cross-check of these seven files was out of scope
for an incremental refresh, as it was at the prior two stamps. **This has now been deferred three
passes running; it should either be scheduled or explicitly ruled out of scope.**
**What to check:** grep each for backticked identifiers against `compiler/src/`; specifically whether
any describes a security/auth/DB model predating §14.8.9-§14.8.11, or a path/coordinate model
predating the §47.9.5 dist-space clarification.

### `docs/website/`
**Reason:** `docs/known-gaps.md` carries `g-docs-website-retained-as-test-fixture` — the site is
retained as a compile fixture after a wiki migration. **This window it was added to the snippet
gate** (98 `.scrml` files, all compiling), which raises the stakes: a compile-gated directory reads
as endorsed content. Whether its authored PROSE is current is a separate question from whether it
compiles — and S292 corrected seven false claims in prose on a page that compiled fine.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture,
now that it is gated.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · structure · dependencies · error · test | `115e8b1b` | **FULL rewrite this pass**, re-verified against source |
| schema · migrations · domain · build · config · infra | `115e8b1b` | **TARGETED corrections this pass** — each map's own header states exactly what was and was not re-walked |
| auth | `df2ac831` | **deliberately older.** No auth/session/JWT/OAuth/protect-floor surface changed this window. The one adjacent item — `E-PA-002`'s message — is a diagnostic-quality change mapped in error.map.md + structure.map.md, matching the pre-existing precedent that the §14.8.10/§14.8.11 principal machinery is mapped in domain/dependencies rather than auth. |
| non-compliance | `115e8b1b` | this file |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## Tags
#non-compliance #project-mapper #cleanup #scrml #privacy-scrub #adopter-identity #cloud-maps-failing #ci-red #spec-index-currency #each-fence #native-parser-parity #w-lint-uncatalogued #facts-gate #snippet-gate #known-gaps #catalog-count-audit #maps-routing-gap #d4 #coordinate-space #navigate-wave1c #w-nav-chunk-load-failed #e-schema-011 #tutorial-version-hardcode

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [migrations.map.md](./migrations.map.md)
- [build.map.md](./build.map.md)
- [infra.map.md](./infra.map.md)
- [test.map.md](./test.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
