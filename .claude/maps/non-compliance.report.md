# non-compliance.report.md
# project: scrml
# generated: 2026-07-26T07:00:00Z  commit: f8a138e9
# scan mode: INCREMENTAL_UPDATE (DB-authoritative-security-tier-scoped refresh over the a0344d75 -> f8a138e9 window; the intervening 1c5c2aee chunk-namespacing pass is folded in where its own currency notes carried forward unresolved)

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread.

## OPEN — spec/doc vs code

### 1. SPEC §52.15.5 still describes the retired `<div>` each-mount
`compiler/SPEC.md:31594` (the SSR auto-make-safe prose) says an omitted auth-scoped cell means
"its `<div data-scrml-each-mount>` is left empty". As of `df6d269c` the top-level `<each>` mount is
a comment fence `<!--scrml-each:N--><!--/scrml-each:N-->`; no `<div data-scrml-each-mount>` is
emitted for a top-level each at all. The §52.15.5 BEHAVIOUR is unchanged and correct (the fence is
left unfilled); only the descriptive noun is stale. Not re-verified this pass (outside the
DB-authoritative scope) — carried from S280.
**Reason:** grep-mismatch (normative doc names an emitted shape the compiler no longer produces).
**Suggested disposition:** update in place to "its each-mount fence is left unfilled". One clause;
no ruling needed.

### 2. STILL OPEN — nine live `W-LINT-*` codes have no §34 row
`W-LINT-016` … `W-LINT-024` are real `code:` emit sites in `compiler/src/lint-ghost-patterns.js`
(26 emit sites across the module); §34 catalogs only `W-LINT-001..008` + `010..015`. The set of
codes the compiler can EMIT therefore exceeds the catalog. Not re-verified this pass (unrelated to
the DB-authoritative tier) — carried from S277, last confirmed at `a0344d75`.
**Reason:** spec-vs-impl gap. **Disposition:** catalog the nine, or rule them internal-only.

### 3. `compiler/native-parser/` parity is UNCONFIRMED, with one CONFIRMED gap
`git diff --name-only df2ac831..f8a138e9 -- compiler/native-parser/` returns **0 files** — zero diff
across the whole span, re-verified this pass (the DB-authoritative tier is emit-time + a standalone
CLI, entirely outside the parser layer, so this re-verification is a byproduct, not new evidence).
- **Confirmed gap:** `E-SCRIPT-001`. `parse-markup.js:983-995` carries an explicit `<style>` →
  `E-STYLE-001` mirror written to match the live block-splitter, and has NO `<script>` counterpart.
- **Out of layer, no obligation:** the outlet/landmark surface, the each-mount FENCE, and (NEW this
  pass) the entire §14.8.11 DB-authoritative tier — none of it touches parsing/AST shape.
- **Genuinely unconfirmed:** GITI-038/039 parity.
Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
grounds that nothing changed.

### 4. `docs/tutorial.md` hardcodes a version figure that `docs/FACTS.md` now derives
The tutorial says "as of v0.7.0"; `package.json` is **0.7.1**, and `docs/FACTS.md` derives
`compiler version` mechanically under a CI `--check` gate. Not re-verified this pass (unrelated to
the DB-authoritative tier) — carried from S280.
**Reason:** content-heuristic (a derived figure hardcoded in public content).
**Suggested disposition:** replace the "v0.7.0" labels with a FACTS.md reference.

### 5. NEW — `compiler/SPEC-INDEX.md`'s currency banner is 3+ landings stale; misses all three new §14.8.11 sections and their 4 diagnostic codes
The file's own top-of-file `> Last updated:` banner (`compiler/SPEC-INDEX.md:4`) is dated
**2026-07-20 (S273)** and narrates ONLY the §14.8.10 tenant-floor landing — it has never been
refreshed for the chunk-namespacing arc (#180), the ESM-chunks arc (U1-U3), the each-fence model
(#131), OR (this pass's in-scope subsystem) the §14.8.11/§14.8.11.1/§14.8.11.2 DB-authoritative
security tier (three new SPEC sections, `SPEC.md:8556-8967`, ~410 lines of normative text). Grep
confirms ZERO mentions of "row-level security", "RLS", "db-authoritative", or "SECURITY DEFINER"
anywhere in `SPEC-INDEX.md` — neither in the `## Sections` per-chapter summary table (row `14`'s
Summary column calls out two OLDER deltas, §14.10/§14.11, but never mentions §14.8.9/§14.8.10/
§14.8.11 by number) nor in the `## Quick Lookup: Topic → Section` table. The per-row LINE RANGE for
section 14 (`7642-8959`) does still numerically cover §14.8.11's actual location, so the index is
not factually WRONG — it is INCOMPLETE, and a dev agent searching SPEC-INDEX.md by topic for "RLS"
or "SECURITY DEFINER" or "db-migrate" will find nothing, despite ~410 lines of normative spec text
existing at `SPEC.md:8556-8967`.
**Reason:** content-heuristic / currency gap (an authoritative navigation index missing recent,
substantial normative sections — not a contradiction, an omission).
**Suggested disposition:** append a `## Quick Lookup` row for "DB-authoritative / RLS / SECURITY
DEFINER / db-migrate → §14.8.11" and refresh the top banner to narrate the current HEAD's landings
(or, if the banner convention is meant to be single-most-recent-session only, retarget it to S287
and accept that older deltas rotate out — bryan's call, not this map's). No SPEC.md content change
needed; this is `SPEC-INDEX.md` only.

## OPEN — code defects filed at this HEAD (not doc drift, but they invalidate any doc claiming the relevant surface is sound)

Not re-verified this pass (unrelated to the DB-authoritative tier) — carried from S280/S281:
- `g-composition-strip-eats-last-dep-script` (HIGH) — `codegen/index.ts`'s two `$`-anchored regexes
  eat `depN` instead of the runtime tag.
- `g-runtime-script-tag-not-depth-prefixed` (HIGH) — the runtime tag emits at depth 0; on a
  shell-less nested page that is the ONLY runtime tag, so the page never boots.
- `g-uptoroot-vs-distrel-anchor-mismatch` (MED) — two composition path-anchoring functions disagree
  when the entry is not at the output base.
`docs/known-gaps.md` is CURRENT on all three — it is the authority, not a finding.

**NEW at this HEAD, filed S287, all in `docs/known-gaps.md` (the authority — not re-derived here,
cited for map-set completeness only):**
- `g-db-migrate-check-constraint-oneof-pattern` (MED, open) — `schema-differ.js`'s OWN diff-parser
  (`parseColumns`/`parseSharedCorePredicates`) trips on a `oneOf([...])`/`pattern(/…/)` column three
  ways (unquoted-bareword CHECK; false-fires `E-DBAUTH-NO-TENANT-COLUMN` on a table that DOES
  declare `tenant_id`; a brace-matcher false-positive on `W-DBAUTH-MARKER-NEARMISS`). The main
  compiler's own `type-system.ts` parse is unaffected — only the differ's line-based scan chokes.
  **The natural next `scrml db-migrate` fix.**
- `g-dbauth-p2-caps-provenance` (MED, open) — `tenant-egress.ts`'s `_scrml_active_caps(req)` has no
  real session-caps source (`@currentUser.caps` is always `[]`), so any `requires cap("x")` SECDEF
  is inert-deny until a caps provenance is wired (couples to S8 live revocation).
- `g-dbauth-p2-pk-tenant-not-auto-immutable` (LOW, open, bryan design call) — `id`/`tenant_id` are
  UPDATE-grantable on a db-authoritative table unless explicitly marked `immutable`.
- `g-dbauth-secdef-owner-crud-all-tables` (LOW, open) — a SECDEF owner role gets CRUD on every
  db-authoritative table, not just the ones its `fn` body touches (over-grant, low-impact — the
  owner is NOLOGIN, reachable only via its own author-written SECDEF bodies).
- `g-db-migrate-m1-no-runtime-migration-apply-seam` — **RESOLVED S287** by Milestone 2 itself
  (`scrml db-migrate`, #185). Listed here only so a stale "M1 emits DDL nothing applies it" claim
  is recognized as superseded, not re-filed.

## RESOLVED since the prior report

- **DB-authoritative security tier landed as a full atomic arc (S287) — the SPEC/code pair verified
  current this pass.** §14.8.11/§14.8.11.1/§14.8.11.2 in `compiler/SPEC.md` match
  `schema-differ.js`/`codegen/db-authoritative.ts`/`codegen/sql-ident.ts`/`commands/db-migrate.js`/
  `codegen/tenant-egress.ts` line-for-line on every claim checked (marker syntax, DDL shapes, the
  4 diagnostic codes' §34 rows, the privilege-separation model, the ledger schema, the SECDEF
  hardening invariants). No aspirational/drafted content found in this subsystem — the three
  `docs/changes/db-authoritative-{m1,m2,p2}/` dispatch archives are correctly-located BRIEF+PROGRESS
  bookkeeping (historical, excluded from content-mapping), not stray spec drafts.
- **§34 `E-STYLE-001` row corrected (S279/S280).** Unchanged status, carried.
- **Catalog-count methodology closed; count re-verified + advanced this pass.** **793** at
  `f8a138e9` (was 787 at `a0344d75`) — `comm` set-diff confirmed +6/-0: 4 in-scope DB-authoritative
  codes + 2 reconciled-in-passing (`E-CG-018`, `W-EACH-BIND-ITEM-FIELD-DEFERRED`, both already-landed
  from an unrelated track, never previously counted because no intervening map pass touched
  error.map.md between `a0344d75` and this one). See error.map.md.
- **`W-EACH-TABLE-FOSTER` and its module removed** — no longer a live-but-uncatalogued code.
- **Derived figures are gated** — `docs/FACTS.md` + `scripts/facts.ts --check` in CI `gate`.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

These live under `docs/changes/**` — the per-dispatch archive, excluded from content-mapping by
scope. Listed only because they describe work that does NOT exist at this HEAD (the
db-authoritative-{m1,m2,p2} archives are DELIBERATELY NOT listed here — that work IS built, verified
this pass; see RESOLVED above):
- `docs/changes/esm-chunks/U4-BRIEF.md` + `progress.md` — U4/U5/U6 (cross-chunk navigation on esm,
  a module-capable browser-test harness, the default-flip) are NOT built. `classic` is still the
  default and the only conformance-tested format.
- `docs/changes/chunk-namespacing/{BRIEF,SCOPING}.md` — scoping for unbuilt work.
- `docs/changes/navigate-wave1c-cross-chunk/` — parked. **`W-NAV-CHUNK-LOAD-FAILED` has ZERO
  occurrences in `compiler/src/` and no §34 row.** Any doc naming that code describes planned work.
- `docs/changes/marketing-claim-gate/SCOPING.md` — U3+ of that arc is not built; `scripts/claim-gate.js`
  exists but is deliberately NOT CI-wired (measure-mode). Only `snippet-gate.js` and `facts.ts --check`
  are required checks.

## Uncertain — needs human review

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason:** all unmodified since 2026-06-22 or earlier, while SPEC.md has since gained (among other
things) the entire §14.8.11 DB-authoritative tier. Not content-verified this pass — a full
identifier cross-check of these seven files was out of scope for a DB-authoritative-tier-scoped
incremental refresh.
**What to check:** grep each for identifiers against `compiler/src/`; specifically whether any of
them describe a security/auth/DB model that predates §14.8.9-§14.8.11.

### `docs/website/`
**Reason:** `docs/known-gaps.md` carries `g-docs-website-retained-as-test-fixture` — the site is
retained as a compile fixture after a wiki migration. Whether its authored content is current is a
separate question from whether it compiles. Not re-verified this pass.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · structure · dependencies · schema · domain · build · test · error | `f8a138e9` | current (HEAD), re-verified against source this pass — the DB-authoritative-tier-scoped incremental window |
| migrations | `f8a138e9` | **NEW this pass** — did not exist before `scrml db-migrate` landed |
| config | `f079d0a9` | deliberately older — no env var or config-file shape change (`--db` is a CLI flag; GUC names are compile-time constants, not config) |
| auth | `df2ac831` | deliberately older — no auth/session surface change; the DB-authoritative tier's principal resolvers live in tenant-egress.ts, mapped in domain.map.md/dependencies.map.md instead (matching the pre-existing §14.8.10 precedent, also not in auth.map.md) |
| infra | `f079d0a9` | deliberately older — no CI/infra change; the tier's new tests are skip-graceful against an operator-provided Postgres, not a CI-provisioned resource |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## Tags
#non-compliance #project-mapper #cleanup #scrml #dbauth #db-authoritative #spec-index-stale #esm-chunks #each-fence #native-parser-parity #w-lint-uncatalogued #facts-gate #known-gaps #catalog-count-audit

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [migrations.map.md](./migrations.map.md)
- [build.map.md](./build.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
