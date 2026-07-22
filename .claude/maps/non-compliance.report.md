# non-compliance.report.md
# project: scrml
# generated: 2026-07-22T17:10:00Z  commit: a0344d75
# scan mode: INCREMENTAL_UPDATE (currency-driven refresh over the 9481bc69 -> a0344d75 window)

Docs/specs/maps that do NOT match current code. Findings live here rather than being returned
inline, because inline findings go stale unread.

## OPEN — spec/doc vs code

### 1. SPEC §52.15.5 still describes the retired `<div>` each-mount
`compiler/SPEC.md:31594` (the SSR auto-make-safe prose) says an omitted auth-scoped cell means
"its `<div data-scrml-each-mount>` is left empty". As of `df6d269c` the top-level `<each>` mount is
a comment fence `<!--scrml-each:N--><!--/scrml-each:N-->`; no `<div data-scrml-each-mount>` is
emitted for a top-level each at all. The §52.15.5 BEHAVIOUR is unchanged and correct (the fence is
left unfilled); only the descriptive noun is stale.
**Reason:** grep-mismatch (normative doc names an emitted shape the compiler no longer produces).
**Suggested disposition:** update in place to "its each-mount fence is left unfilled". One clause;
no ruling needed. Filed S280 by this pass.

### 2. STILL OPEN — nine live `W-LINT-*` codes have no §34 row
`W-LINT-016` … `W-LINT-024` are real `code:` emit sites in `compiler/src/lint-ghost-patterns.js`
(26 emit sites across the module); §34 catalogs only `W-LINT-001..008` + `010..015`. The set of
codes the compiler can EMIT therefore exceeds the catalog. 787 is a count of §34, not of the
implementation. Carried from S277, re-verified at this HEAD.
**Reason:** spec-vs-impl gap. **Disposition:** catalog the nine, or rule them internal-only.

### 3. `compiler/native-parser/` parity is UNCONFIRMED, with one CONFIRMED gap
`git diff --name-only df2ac831..HEAD -- compiler/native-parser/` returns **0 files** — zero diff
across the whole df2ac831 → a0344d75 span, re-verified this pass.
- **Confirmed gap:** `E-SCRIPT-001`. `parse-markup.js:983-995` carries an explicit `<style>` →
  `E-STYLE-001` mirror written to match the live block-splitter, and has NO `<script>` counterpart.
- **Out of layer, no obligation:** the outlet/landmark surface and the each-mount FENCE (an
  emit-time string; the native parser produces no HTML).
- **Genuinely unconfirmed:** GITI-038/039 parity.
Do not upgrade to "drifted" without executing the native path; do not downgrade to "fine" on the
grounds that nothing changed. Carried from S276.

### 4. `docs/tutorial.md` hardcodes a version figure that `docs/FACTS.md` now derives
The tutorial says "as of v0.7.0" (lines 9, 646, 1039); `package.json` is **0.7.1**, and
`docs/FACTS.md` now derives `compiler version` mechanically under a CI `--check` gate. The S280
convention is explicit: a public document SHALL cite FACTS.md rather than hardcode a figure that
rots. The tutorial's SYNTAX is gated (its 11 snippets are real files under `snippet-gate.js`), but
its prose version label is not.
**Reason:** content-heuristic (a derived figure hardcoded in public content).
**Suggested disposition:** replace the three "v0.7.0" labels with a FACTS.md reference, or extend
`scripts/facts.ts` to own a version anchor in the tutorial.

## OPEN — code defects filed at this HEAD (not doc drift, but they invalidate any doc claiming the classic cross-file path is sound)

Three gaps were filed in `docs/known-gaps.md` alongside the `38aec2a9` dep-script depth fix and are
**open at this HEAD**. They matter to any agent touching chunk/module-format emit:
- `g-composition-strip-eats-last-dep-script` (HIGH) — `codegen/index.ts:~2198`'s two `$`-anchored
  regexes were written for a pre-S152 body shape and now eat `depN` instead of the runtime tag.
- `g-runtime-script-tag-not-depth-prefixed` (HIGH) — `codegen/index.ts:1781/:2517` emit the runtime
  tag at depth 0; on a shell-less nested page that is the ONLY runtime tag, so the page never boots.
- `g-uptoroot-vs-distrel-anchor-mismatch` (MED) — the composition `upToRoot` anchors on the entry
  dir, `computeDependencyClientScripts` on `outputBaseDir`; they disagree when the entry is not at
  the output base.
`docs/known-gaps.md` is CURRENT on all three (and on the resolved each-fence gap) — it is the
authority, not a finding. Recorded here so the map set does not imply the surface is clean.

## RESOLVED since the prior report

- **§34 `E-STYLE-001` row corrected (S279/S280).** The row now describes the `<style>` ELEMENT
  rejection, its exact-match + scan-to-close recovery, the `--convert-legacy-css` hint and the
  source-side-only scope. Row and `block-splitter.js` agree. (Was OWED item 3.)
- **Catalog-count methodology closed.** Unique-code extraction bounded at the `## 34.` / `## 35.`
  headings is the authoritative method; **787** at this HEAD, unchanged from `9481bc69`. (Was OWED
  item 2.)
- **`W-EACH-TABLE-FOSTER` and its module removed** — no longer a live-but-uncatalogued code.
- **README-vs-SPEC contradictions closed (`2e7a32e3`)** — the flagship example is now a real file
  (`docs/readme-snippets/tasks-app.scrml`) under the CI snippet gate, so this class of drift is now
  mechanically caught rather than reported.
- **Derived figures are now gated** — `docs/FACTS.md` + `scripts/facts.ts --check` in CI `gate`.
  The class of finding "a doc hardcodes a stale count" is largely retired for figures FACTS.md owns.

## Aspirational-content inventory (correctly located, flagged so no one mistakes it for shipped)

These live under `docs/changes/**` — the per-dispatch archive, excluded from content-mapping by
scope. They are listed only because they describe work that does NOT exist at this HEAD:
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
**Reason:** all unmodified since 2026-06-22 or earlier (NERDME.md 2026-07-03), while SPEC.md moved
to 36,114 lines on 2026-07-22. The dated `-audit-` filename trips the name heuristic. Not
content-verified this pass — a full identifier cross-check of these seven files was out of scope for
a currency-driven incremental refresh.
**What to check:** grep each for identifiers against `compiler/src/`; specifically whether
`DESIGN.md` and `NERDME.md` still describe the pre-§20.8 shell model, the pre-fence each mount, or a
single client module format.

### `docs/website/`
**Reason:** `docs/known-gaps.md` carries `g-docs-website-retained-as-test-fixture` — the site is
retained as a compile fixture after a wiki migration. Whether its authored content is current is a
separate question from whether it compiles.
**What to check:** confirm with bryan whether `docs/website/` is authoritative content or a fixture;
if fixture, it should be excluded from public-claim gating explicitly.

## Map currency at this stamp

| map | stamp | status |
|---|---|---|
| primary · structure · dependencies · build · test · error | `a0344d75` | current (HEAD), re-verified against source this pass |
| domain | `9481bc69` | one window stale — SPEC §5 gained the five-door markup-value partition (S279 ruling); no compiler-behaviour change behind it. Refresh next pass. |
| schema | `df2ac831` | deliberately older — this window added no AST node type (`moduleFormat` is a codegen input option; the each fence is an emitted string) |
| auth | `df2ac831` | deliberately older — no auth/session surface change |
| config · infra | `f079d0a9` | deliberately older — no env var or config-file shape change; the two new CI gate steps are in build.map.md |

An honest older stamp beats a false "verified at HEAD". Every row above is a decision.

## Tags
#non-compliance #project-mapper #cleanup #scrml #esm-chunks #each-fence #native-parser-parity #w-lint-uncatalogued #facts-gate #snippet-gate #known-gaps

## Links
- [primary.map.md](./primary.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [build.map.md](./build.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
