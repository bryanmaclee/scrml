# error.map.md
# project: scrml
# updated: 2026-07-27T10:00:00Z  commit: c700c435

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:18010-18723`)
**787 distinct diagnostic codes** cataloged in §34 at `a0344d75` (re-extracted this pass; UNCHANGED from `9481bc69` — the ESM-chunks arc, the #131 each-fence model and the S280 claim-gate landings added **ZERO** catalog codes between them) (`compiler/SPEC.md:18204-19033`,
main table + the §34.1 native-parser sub-table at :18925). §34 is a lookup index only — each code's
normative definition lives in the SPEC section that introduces it (cited in the table's Section
column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX`/
`I-XXX`, or read §34 directly.

**S287 update (prior pass, `a0344d75` -> `f8a138e9`): unique count was 793** (+6, zero removed —
verified by `comm` set-diff of unique `^\| ~?~?[EWI]-` first-cells, bounded at the `## 34.`/`## 35.`
headings, same methodology as below). Four are IN-SCOPE for that pass (§14.8.11 DB-authoritative
tier M2 — `E-DBAUTH-SQLITE`, `E-DBAUTH-NO-TENANT-COLUMN`,
`W-DBAUTH-MARKER-NEARMISS`, `W-SCHEMA-DESTRUCTIVE-DROP`; see the section below). Two more landed
the SAME window from an unrelated track and were reconciled then only because that pass touched the
count anyway: `E-CG-018` (chunk-namespacing BUG-6 token-distinctness guard, `assertChunkTokensDistinct`
— already mechanism-mapped in dependencies.map.md/structure.map.md, just never had its §34 row
counted) and `W-EACH-BIND-ITEM-FIELD-DEFERRED` (i175 per-item `bind:value` write-back-not-yet-lowered
warning, `codegen/emit-each.ts`, `SPEC.md:19361`).

**S288/S289 update (THIS pass, `f8a138e9` -> `c700c435`): unique count is now 795** (+2, zero
removed — re-verified with a UTF-8-safe `awk -F'|'` field-split extraction, NOT the earlier `grep -oP`
methodology, which silently drops at least one row when run over the whole SPEC.md in this
environment — see the caveat below. Cross-checked against the prior 793 baseline via `comm`
set-diff; both legs agree: `793 -> 795`, zero retired). The two additions landed in TWO independent
lanes the same window: **`E-SCHEMA-010`** (§39.5.8, bryan's S288 schema-lowering pass) and
**`E-MATCH-INVALID-ARM`** (§18.0.1, Peter's #192 — the Ghost-Pattern `<match>`-arm fix). See "New fire
sites this window" below for both. `docs/FACTS.md` deliberately does NOT publish this figure (it
states the §34 total "is load-bearing but not reliably extractable — a scan from the §34 heading
over-counts by catching later tables, and in a file whose whole purpose is accuracy, a wrong number
is worse than an absent one") — this map's own `comm`-set-diff methodology (below) is the reconciled
answer, not a naive grep. **If you re-derive this count, do NOT trust a bare `grep -oP` over the
whole file** — verify with `awk -F'|' '{gsub(/^[ \t]+|[ \t]+\$/,"",\$2); ...}'`-style field splitting
instead; a raw `grep -oP '^\|\s*~{0,2}\K[EWI]-\S+'` piped over the full `SPEC.md` was independently
observed to silently omit at least one matching row (`E-CG-013`) that IS extracted correctly when the
same line is isolated — root cause not chased down (this map does not need to own a grep-tooling
defect), but the discrepancy is worth knowing if you hand-roll this count again.

### COUNT-METHODOLOGY AUDIT — RESOLVED at 9481bc69 (was owed since S265)

The persistent off-by-one across every prior map generation is **fully explained and closed**.
Two figures were being conflated:

| Methodology | at df2ac831 | 58c8161d | c48e59a2 | **9481bc69 (HEAD)** |
|---|---|---|---|---|
| raw catalog ROWS (`^\| ~?~?[EWI]-` first-cell) | 780 | 786 | 787 | **788** |
| **UNIQUE code strings** (authoritative) | 779 | 785 | 786 | **787** |

**Root cause:** §34 carries **two distinct rows for the same code `E-MARKUP-003`** — `SPEC.md:18304`
(§4.4.1, closer-in-logic) and `:18507` (§24.1, unknown-attr-on-known-element), both retired-S263
tombstones for two different meanings. Every carried baseline since S265 was a raw-ROW count and
therefore ran exactly +1 high against the unique-code count. **The unique-code count is the
authoritative methodology**; the raw-row count is not (it also cannot be trusted to stay off by
exactly one — a future duplicate row would widen it silently). The prior map's "787 at c48e59a2"
was the raw-row figure; the true unique count there was 786. That today's HEAD figure is *also*
787 is a coincidence of the two errors cancelling, not a confirmation.

Range discipline that makes this reproducible: bound the extraction at the `## 34. Error Codes`
heading and the `## 35.` heading. Within that range there is no sibling-table over-match — the
earlier "the raw grep over-matches sibling tables" suspicion was wrong; the §34.1 native-parser
sub-tables (81 unique codes: `E-EXPR-*`, `E-STMT-*`, `E-MARKUP-VALUE-UNCLOSED`,
`I-NATIVE-BLOCK-*`) are legitimately part of the catalog. Main table = 706 unique, §34.1 = 81,
total 787.

**Delta confirmation, every leg set-diff-verified (`comm` over unique first-cells):**

- `df2ac831..58c8161d` — **779 -> 785**. +7: `E-ERROR-010`, `E-TENANT-AGG`/`-WRITE`/`-RAW-EGRESS`,
  `I-TENANT-STRIP`/`-ACROSS`, `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED`. -1: `W-SSR-PRERENDER-UNSCOPED`
  (renamed to the I-code).
- `58c8161d..c48e59a2` — **785 -> 786**. +1 `E-OUTLET-AND-MAIN`. Zero removed.
- `c48e59a2..9481bc69` (S277, this pass) — **786 -> 787**. +1 **`E-SCRIPT-001`** (#127, row at
  `SPEC.md:18512`). Zero removed. #126 and #128 added ZERO codes — both are behavior/scope
  corrections to codes that already existed.
- `a0344d75..f8a138e9` (S287) — **787 -> 793**. +6, zero removed: `E-DBAUTH-SQLITE`,
  `E-DBAUTH-NO-TENANT-COLUMN`, `W-DBAUTH-MARKER-NEARMISS`, `W-SCHEMA-DESTRUCTIVE-DROP` (§14.8.11
  DB-authoritative tier M2), `E-CG-018`
  (chunk-namespacing BUG-6, already-landed/already-mapped, catalog row only), `W-EACH-BIND-ITEM-
  FIELD-DEFERRED` (i175, already-landed/already-mapped).
- `f8a138e9..c700c435` (S288/S289, THIS pass) — **793 -> 795**. +2, zero removed: `E-SCHEMA-010`
  (§39.5.8, bareword `oneOf`/`notIn` set item, bryan S288) and `E-MATCH-INVALID-ARM` (§18.0.1,
  Ghost-Pattern `<match>` arm, Peter #192).

**`W-EACH-TABLE-FOSTER` is RETIRED and DELETED (#131).** It was a Stage-6.4f info-lint with no §34
row, so the retirement has no count impact — but the code, its module
(`compiler/src/lint-w-each-table-foster.js`), its Stage 6.4f wiring and its unit test are all gone.
The `<each>` mount is now a parse-safe comment fence, so the foster/drop condition the lint warned
about cannot occur; warning would be a false positive. Do not re-add it.

**`W-MODULE-FORMAT-ESM-INCOMPLETE` is NOT a diagnostic code.** It is an OPERATIONAL stderr notice
key printed by `compiler/src/commands/module-format-notice.js` when `--module-format=esm` is
selected. It has no §34 row by design (the freeze-gated catalog is for language-level diagnostics,
not internal build-flag state), never enters `result.errors`/`result.warnings`, and must not be
counted or asserted on as a compiler diagnostic.

**Two catalog-vs-impl defects the audit surfaced — both open, both filed in
non-compliance.report.md:**
1. ~~The `E-STYLE-001` row describes a trigger the code does not fire~~ — **RESOLVED at this HEAD.**
   The §34 row was corrected (S279/S280): it now reads "`<style>` element in scrml source … the
   symmetric twin of `<script>` → `E-SCRIPT-001` (§4.17)", records the exact-match + scan-to-close
   recovery, the `--convert-legacy-css` hint, and the SOURCE-side-only scope. The row and
   `block-splitter.js` now agree.
2. **STILL OPEN — nine LIVE `W-LINT-*` codes have no §34 row at all** — `W-LINT-016` through `W-LINT-024`, all
   real `code:` emit sites in `src/lint-ghost-patterns.js` (:1024, :1072, :1097 … :1299; 26 emit
   sites across the module). §34 catalogs only `W-LINT-001..008` + `010..015`. So the true count of
   codes the compiler can EMIT exceeds the catalog count; 795 is a count of §34, not of the
   implementation.

**NOT implemented — do not add.** `W-NAV-CHUNK-LOAD-FAILED` has ZERO occurrences in
`compiler/src/` (re-grepped at `a0344d75`) and NO §34 row. Wave-1c pieces 2+3 (cross-chunk
navigation) are HELD, not landed — see `docs/changes/navigate-wave1c-cross-chunk/` (a correctly
parked dispatch archive describing UNBUILT work). A doc naming this code describes planned work.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes).

## Diagnostic families by feature area (representative codes, not exhaustive)

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Engine / state machine | E-ENGINE-* | 44 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Type system | E-TYPE-* | 41 | type-system.ts (incl. E-TYPE-082, enum-variant construction payload-arity) |
| Component | E-COMPONENT-* | 22 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 35 | type-system.ts (§14.12) |
| Realtime channel | E-CHANNEL-* | 18 | route-inference.ts, channel-watches.ts, emit-channel.ts (§38) |
| Syntax | E-SYNTAX-* | 14 | ast-builder.js, tokenizer.ts |
| Lint (info-tier) | W-LINT-* | 14 | lint-*.js modules |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* / W-FOREIGN-* | 15 | ast-builder.js, type-system.ts (§23) |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 19 | type-system.ts |
| Codegen | E-CG-* | 12 (+1: E-CG-018, chunk-namespacing token-distinctness) | codegen/*.ts (incl. E-CG-001 protected-field egress) |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64, incl. E-TOOL-SERVE-*/E-TOOL-ROUTE-NEEDS-SERVE §64.9) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts, ast-builder.js (E-SQL-003 runtime-expr body), codegen/emit-server.ts + emit-tool.ts (E-SQL-004 `?{}`-without-`db=`) |
| **DB-authoritative tier (§14.8.11/.1/.2)** | E-DBAUTH-* / W-DBAUTH-* / W-SCHEMA-DESTRUCTIVE-DROP | 4 | `codegen/index.ts` (`annotateDbScopes`, compile-time E-DBAUTH-SQLITE) + `compiler/src/commands/db-migrate.js` (deploy-time E-DBAUTH-SQLITE/E-DBAUTH-NO-TENANT-COLUMN pre-flight) + `codegen/db-authoritative.ts` (`extractDesiredSchema`, W-DBAUTH-MARKER-NEARMISS) + `schema-differ.js` (`diffSchema`, W-SCHEMA-DESTRUCTIVE-DROP) — see the S287 section below |
| Confidentiality — tenant-row floor (§14.8.10, #117/#118) | E-TENANT-AGG/WRITE/RAW-EGRESS / I-TENANT-STRIP/ACROSS | 5 | codegen/tenant-egress.ts (`resolveTenantScoping`/`classifyTenantWrite`/`detectTenantRawEgress`), emitted at codegen/emit-server.ts:1389/1405/1432 (E-WRITE/AGG/RAW-EGRESS) + :4893/4907 (I-STRIP/ACROSS) — the row-level twin of §14.8.9 protect-egress.ts. `tenant-egress.ts` also owns `_scrml_active_tenant`/`_scrml_active_caps` (§14.8.11.2 S4), the SAME server-resolved-principal helpers the DB-authoritative A1 wrapper injects — see below. **S288: `buildTenantContext` now takes a SECOND arg, the `<schema>`-declared tables, unioned into the tenant-scoped set** — see the S288/S289 section below and domain.map.md |
| SSR prerender confidentiality (§52.15.5, RENAMED #120) | I-SSR-AUTH-SCOPED-CLIENT-HYDRATED | 1 | type-system.ts:10894 (server-authority cell) + :10935 (callable-init); auto-omit at codegen/emit-server.ts:~4138. Was retired W-SSR-PRERENDER-UNSCOPED |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| Session (§20.5) | E-SCOPE-012 / E-SESSION-* | 4 | type-system.ts (E-SCOPE-012, ident-walker), codegen/emit-expr.ts (E-SESSION-VALUE/E-SESSION-RESERVED-KEY sinks, drained by emit-server.ts), emit-server.ts (E-SESSION-CONTEXT context scan) |
| Schema | E-SCHEMA-* / W-SCHEMA-* | **13** (+1: W-SCHEMA-DESTRUCTIVE-DROP, counted in the DB-authoritative row above, not double-counted here; includes the **NEW `E-SCHEMA-010`**, S288 — see below) | protect-analyzer.ts, type-system.ts, schema-differ.js, gauntlet-phase1-checks.js |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 (E-ERROR-010 §19.5.4 dedicated, #121) | emit-logic.ts, type-system.ts (E-ERROR-010 emit at type-system.ts:9853, formerly overloaded on E-TYPE-001) |
| Functions | E-FN-* | 9 (E-FN-009 Nominal/deferred — zero fire site) | type-system.ts (§48.5; E-FN-006 retired -> E-STATE-COMPLETE) |
| Route inference (client/server boundary) | E-ROUTE-* | — | route-inference.ts (§12.4 E-ROUTE-002 + E-ROUTE-005 client/server soundness; §12.2 Trigger 6 `W-DEAD-FUNCTION` clarified S288, see below — not a new code) |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js (`isKnownElementName` HTML∪SVG∪MathML∪custom union) |
| Middleware (§40) | E-MW-002/005/006 | 3 live | ast-builder.js §40-block (E-MW-002 emit at ast-builder.js:18190, E-MW-005/006 at :18231; §34 cites corrected #121 to this drift-proof anchor) |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Protect-analyzer | E-PA-* | 7 | protect-analyzer.ts |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 8 (E-ATTR-012 RETIRED tombstone, SPEC-cleaned #121; E-ATTR-WRITER-CONFLICT #81) | attribute-registry.js, validators/attribute-*.ts, codegen/emit-html.ts (`analyzeWriterConflict`) |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| **Client Router / outlet (§20.8, +1 #124)** | E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / **E-OUTLET-AND-MAIN** / W-OUTLET-ABSENT-SOFT-NAV-DISABLED | **4** | symbol-table.ts PASS 15.5 `walkValidateOutlets` (:10210) -> `collectOutlets` (:10318, TOTAL walk since #126) (all three E-codes); W-OUTLET-ABSENT-SOFT-NAV-DISABLED fires at the ast-builder.js filesystem-inference site alongside W-PROGRAM-SPA-INFERRED |
| Async/stdlib callback | E-ASYNC-* | 2 | async-stdlib-in-sync-callback guard, codegen/emit-server.ts, codegen/emit-expr.ts (client-mode sink) |
| Server-derived marshal | W-SERVER-* | 2 | server-fn / client-cell split, §6.6.9 |
| ~~Table-context `<each>` foster~~ | ~~W-EACH-TABLE-FOSTER~~ | **0 — RETIRED** | The code, its module `lint-w-each-table-foster.js` and its api.js Stage 6.4f wiring are DELETED (#131). Nothing emits it. No §34 impact (it never had a row). |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE, E-THEME-TOKEN-UNKNOWN) | **E-STYLE-001 at block-splitter.js:3475** (rejects the `<style>` ELEMENT — NOT what its §34 row says, see the audit above); codegen/css-conflict-check.ts, api.js Stage 3.4 (§65.2); codegen/emit-theme-reset.ts (§65.3.2/§65.6) |
| Foreign element rejection (§4.17) | E-SCRIPT-001 | 1 | block-splitter.js:3498-3528 — the markup-opener path, immediately after the `<style>`/E-STYLE-001 branch. Exact `===` tag compare (never a prefix) so `<noscript>` is untouched; recovery scans to a case-insensitive `</script>` or EOF so a brace-heavy JS body does not cascade. SOURCE-side only |
| Cell render-spec (§6.2/§6.6.17) | E-CELL-NO-RENDER-SPEC / E-CELL-RENDER-SPEC-NOT-BINDABLE / E-CELL-OUT-OF-SCOPE | 3 | symbol-table.ts — two different scopes, deliberately (#128): `E-CELL-NO-RENDER-SPEC` is USE-scoped (PASS 5 `walkRenderByTagUses`); `E-CELL-RENDER-SPEC-NOT-BINDABLE` is DECL-scoped (PASS 5a `walkNonBindableMarkupDecls`) |
| `<each>` per-item bind (i175, NEW) | W-EACH-BIND-ITEM-FIELD-DEFERRED | 1 | codegen/emit-each.ts `renderTemplateAttrToJs` — a per-item `bind:*` writing to an ITERATION-ITEM field (not an outer cell) renders but does not yet write back; `SPEC.md:19361` |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |
| **Block-form `<match>` arm validity (§18.0.1, NEW S288)** | E-MATCH-INVALID-ARM | 1 | match-statechild-parser.ts `parseMatchArms` (Phase 2 tokenizer — STRUCTURAL, distinct from the SYM-pass SEMANTIC E-MATCH-* checks) — see below |

## New fire sites this window (`f8a138e9` -> `c700c435`, S288/S289 — TWO independent lanes)

**`E-SCHEMA-010`** (Error, §39.5.8, bryan S288) — a `oneOf([…])`/`notIn([…])` item on a `<schema>`
column that is not a scrml literal — in practice a BARE IDENTIFIER, `oneOf([user, admin])`. §39.5.8
lowers each item to a SQL literal; a bareword lowers to a SQL IDENTIFIER instead and fails at
`db-migrate` apply with `column "user" does not exist`. **RULED S288 (bryan, option b):** reject
rather than widen a bareword into a string — the reversible direction, and the corpus migration
measured at ZERO (the only two sites teaching the bareword form were scrml's own reference doc,
already corrected in #191). Fires from `compiler/src/gauntlet-phase1-checks.js`'s
`checkSchemaDeclarations`, via the NEW exported `findNonLiteralSetItems` (`schema-differ.js`). §34
row: `SPEC.md` §34 (after `E-SCHEMA-009`). Closes `g-schema-oneof-bare-identifier-item`
(`docs/known-gaps.md`, RESOLVED S288). See schema.map.md for the full lowering-function inventory
this same landing added (`lowerArrayLiteralToSqlItems`/`lowerArrayItemToSqlLiteral`/
`splitTopLevelItems`/`lowerDefaultToSql`) and the sibling `default(...)` position, which takes the
OPPOSITE disposition for the same residue (a non-literal there is a legitimate SQL expression and
passes through verbatim).

**`E-MATCH-INVALID-ARM`** (Error, §18.0.1, Peter #192) — a tag opener at the block-form `<match>` arm
position that is neither a variant-named arm (`<VariantName>…</>`) nor the wildcard `<_>…</_>`
catch-all — the Ghost-Pattern `<when is="…">` a Vue/Svelte-refugee or an LLM reaches for. Previously
such a tag was silently skipped as "stray content between arms", yielding ZERO recognised arms → the
match tree-shook to nothing → a DEAD PAGE emitted with 0 errors (the worst failure shape). Fires from
`compiler/src/match-statechild-parser.ts`'s `parseMatchArms` — Phase 2 is a TOKENIZER emitting only
STRUCTURAL parse errors (this code + the pre-existing `E-MATCH-PARSE-001`); all SEMANTIC checks
(`E-MATCH-NOT-EXHAUSTIVE`, `W-MATCH-RULE-INERT`, `E-MATCH-EFFECT-FORBIDDEN`, etc.) remain SYM-pass.
The fix skips the whole stray element (opener + body + closer) as a UNIT so nested lowercase children
aren't double-flagged and a following real arm still parses. **Note the fix-direction correction:**
the gap's ORIGINAL stated fix ("reject `<match>` without `for=`") would have broken a legitimate,
relied-upon form (`<match on=@cell>` type-inferred from the cell's enum) — the real defect was
arm-validation, not a `for=`-presence check. Closes
`g-match-without-for-plus-when-children-silent-undeclared-dispatch`; split off
`g-match-nofor-block-form-skips-exhaustiveness` (MED, open, `docs/known-gaps.md` — a no-`for=`
block-form `<match>` skips exhaustiveness entirely, a SPEC/impl divergence flagged for bryan) as a
distinct residual.

**Not a new code — `W-DEAD-FUNCTION` Trigger-6 clarified (§12.2, #195/#200, Peter).** SPEC §12.2
Trigger 6 now states explicitly that a first-class function reference (passed as a call argument,
assigned, stored in an array/object, or otherwise named without being called) keeps a function
reachable and un-tree-shakeable, and that reachability DESCENDS into nested closure bodies (an arrow
`=>` or `function` expression) within a reachable function. This closes a FALSE-POSITIVE in the
dead-function diagnostic walk (`route-inference.ts`) — the tree-shaker already retained these values;
only the WARNING under-counted reachability. No placement/tree-shake behavior changed. See
`docs/changes/w-dead-function-fp-closure-and-value-ref/BRIEF.md`.

## New fire sites, prior window (`a0344d75` -> `f8a138e9`, S287 — §14.8.11 DB-authoritative tier)

Four codes, all Postgres-only, all fail-closed. The tier itself (RLS DDL, roles, SECDEF —
none of which are diagnostics) is mapped in domain.map.md (§14.8.11 concept), dependencies.map.md
(module graph), schema.map.md (the `TableDecl`/`SecdefFnDecl` codegen-internal shapes), build.map.md
(`scrml db-migrate`) — this section is diagnostics only.

- **`E-DBAUTH-SQLITE`** (Error) — a `db-authoritative` `<schema>` table OR a SECURITY-DEFINER `fn`
  resolves to a non-Postgres driver (SQLite/MySQL/no `db=`) — RLS/roles/GRANT/SECURITY DEFINER are
  Postgres-only, so a silent degrade to the §14.8.10 egress floor is the exact "looks enforced and
  isn't" trap. Fires at BOTH compile (`codegen/index.ts`'s `annotateDbScopes` driver-resolution
  stage, M1) and deploy (`commands/db-migrate.js`, re-checked against the `--db` target, M2/P2 —
  extended to also trigger on a SECDEF `fn`). §34 row: `SPEC.md:18801`.
- **`E-DBAUTH-NO-TENANT-COLUMN`** (Error) — a `db-authoritative` table declares no `tenant_id` column
  (the M1 tenant-isolation policy is keyed on it — an opaque PG error + full rollback would otherwise
  result at apply time). Pre-flighted in `commands/db-migrate.js`'s `runDbMigrate` BEFORE touching the
  DB, naming the offending table(s). §34 row: `:18802`.
  **The originally-reported false-positive here (`g-db-migrate-check-constraint-oneof-pattern` item
  2) is RESOLVED S288 — see the "Known open gaps" note below.** At S288, 9 shapes were tried
  (single/double-quoted `oneOf`, `pattern` with/without `{n}` quantifiers, offending column
  before/after `tenant_id`, single/multi-table) and the false-fire was NOT REPRODUCED on either
  baseline. If it recurs, open a new gap with the exact table.
- **`W-DBAUTH-MARKER-NEARMISS`** (Warning) — a `db-authoritative`-like token in `<schema>` NOT
  recognized as the opt-in marker (must be the exact lowercase `db-authoritative` immediately after
  a table's closing `}` — a case/separator/placement typo silently downgrades the table to plain).
  Fires in `codegen/db-authoritative.ts`'s `extractDesiredSchema`; `scrml db-migrate` also ECHOES
  the recognized db-authoritative set so a miss is visible at a glance. §34 row: `:18803`.
- **`W-SCHEMA-DESTRUCTIVE-DROP`** (Warning) — `scrml db-migrate`'s reconcile plan found a table that
  exists in the live DB but not in `<schema>`; a bare `DROP TABLE` is refused BY DEFAULT (on Postgres
  a `DROP` CASCADE-drops the table's attached RLS policy/grants/role membership — the exact
  db-authoritative security objects the tier installs). The M2 never-clobber fence (Fork 3). Re-run
  with `--allow-destructive` to opt in (which then ALSO fires the pre-existing `W-SCHEMA-002`).
  Fires in `schema-differ.js`'s `diffSchema` when `options.allowDestructive` is false. §34 row:
  `:19304`.

**Known open gaps riding this tier** (`docs/known-gaps.md`; none blocking the milestones they attach
to). **RESOLVED THIS WINDOW (S288):** `g-dbauth-p2-pk-tenant-not-auto-immutable` — a `db-authoritative`
table's PRIMARY KEY and `tenant_id` are now auto-immutable regardless of the `immutable` bareword (RULED
S288, `isEffectivelyImmutable` — see schema.map.md); `g-db-migrate-check-constraint-oneof-pattern` — all
three original sub-bugs verdicted against real PG16 (see the `E-DBAUTH-NO-TENANT-COLUMN` note above and
schema.map.md's lowering-function section). **Still open:** `g-dbauth-p2-caps-provenance` (MED, S287 —
`tenant-egress.ts`'s `_scrml_active_caps(req)` has no real session-caps source yet, `@currentUser.caps`
is always `[]`, so any `requires cap("x")` SECDEF is inert-deny until a caps source is wired; couples
to S8 live revocation); `g-dbauth-secdef-owner-crud-all-tables` (LOW, S287 — a SECDEF owner role gets
CRUD on every db-authoritative table, not just the ones its `fn` body touches); `g-schema-predicate-
arg-parse-edges` (MED, NEW S288 — two residual edges: `oneOf([])` on an empty array still emits invalid
SQL `CHECK (col IN ())` rather than a compile rejection or `CHECK (false)`; `escapeSqlString` doubles
`'` but doesn't escape `\`, a latent MySQL-only trap, unreachable today since `db-migrate` hard-refuses
MySQL); `g-dbauth-no-request-path-test` (MED, NEW S288 — the tier's regression lock asserts EMISSION,
not a real login-over-HTTP → cookie → per-user-read round trip); `g-dbauth-docs-no-do-not-mark-users-
example` (LOW, NEW S288 — the `db-authoritative` marker reads as "apply to everything"; ask is a worked
counter-example, don't mark the `users` table itself, in the docs pass).

**Also this window (S288, not a new §34 code but adjacent to this tier):** the session-principal
wiring fix (`emit-server.ts`'s `astSqlQueryUsesCurrentUser` walker + the RI-route handler's
`_scrml_currentUser` splice; `tenant-egress.ts`'s `buildTenantContext` second-arg union with
`<schema>`-declared tables) closed `g-dbauth-session-principal-not-wired` (was HIGH — the tier was
non-functional end-to-end for a `<schema>`-only app). See domain.map.md's §14.8.11 section and
dependencies.map.md's module graph.

## New + MOVED fire sites, earlier window (c48e59a2 -> 9481bc69, S277 #126/#127/#128)

- **`E-SCRIPT-001` (Error, NEW — #127 `07901878`)** — §4.17. A `<script>` element in scrml SOURCE.
  Fire site: `compiler/src/block-splitter.js:3498` (a `BSError`), in the markup-opener path
  directly beside the pre-existing `<style>`/`E-STYLE-001` branch, and shaped to mirror it exactly:
  record the diagnostic, then scan past the whole `<script>…</script>` body (case-insensitive close
  match, or EOF) and continue — so a JS body full of braces does not cascade into a storm of parse
  errors. Two details that are load-bearing if you touch this:
    - **Exact `===` compare, never a prefix.** `readIdent()` accumulates the FULL
      `[A-Za-z0-9_-]+` identifier, so `<noscript>` yields `"noscript"` and is unaffected.
    - **Source-side only.** The emitter's own `<script src="scrml-runtime.<hash>.js">` and
      `<script src="<page>.client.js">` tags are produced DOWNSTREAM of the block splitter and
      never pass through this check.
  Test: `compiler/tests/unit/script-element-rejected.test.js`. **Native-parser parity: CONFIRMED
  GAP** — `native-parser/parse-markup.js:983-995` has a `<style>`->E-STYLE-001 mirror and NO
  `<script>` counterpart. See non-compliance.report.md.

- **`E-CELL-RENDER-SPEC-NOT-BINDABLE` — FIRE SITE RELOCATED, use-site -> declaration
  (#128 `9481bc69`).** A MOVE, not a new code: the old `<x/>` render-by-tag use-site fire was
  REMOVED. Now fires in **SYM PASS 5a**, `walkNonBindableMarkupDecls` (`symbol-table.ts:2892`) ->
  `checkDeclRenderSpecBindable` (:2946), wired BEFORE the use-site walk — fires **once per decl**.
  `E-CELL-NO-RENDER-SPEC` stays USE-scoped (mirror-image rationale: SPEC §6.2 Shape 2 states the
  rule as a property of the DECLARATION). Test: `compiler/tests/integration/cell-render-spec-decl-scoped.test.js`.

- **`E-OUTLET-*` family — collector widened, NO code change (#126 `499dd740` + #128 `9481bc69`).**
  `collectOutlets` (SYM PASS 15.5, `symbol-table.ts:10318`) became a TOTAL walk (mirroring its emit
  twin `treeHasAuthorMain`), adopted the shared `isAuthorMainTag` predicate (`landmark-tag.ts`), and
  resets `inRouteScope` at a nested `<program>` boundary (§4.12.1). See domain.map.md's one-landmark
  section for the full mechanism.

## Prior windows (S266-S276) — condensed

`E-OUTLET-AND-MAIN` (NEW, §20.8.1.1, #124, S276) — a `<program>` shell with a bare/sibling author
`<main>` beside its `<outlet>` (the ONE illegal arrangement of four; see domain.map.md's four-case
table). `E-TENANT-AGG`/`E-TENANT-WRITE`/`E-TENANT-RAW-EGRESS`/`I-TENANT-STRIP`/`I-TENANT-ACROSS`
(§14.8.10 tenant-row floor, #117/#118, S273) and `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (renamed from
`W-SSR-PRERENDER-UNSCOPED`, §52.15.5, #120, S274) and `E-ERROR-010` (dedicated code, was overloaded
on `E-TYPE-001`, §19.5.4, #121, S274) are all documented in the feature-area table above and in
domain.map.md; per-fire-site line numbers for this window are not re-verified at this HEAD — see
prior map generations / `docs/changelog.md` for the full narrative if a line-exact cite is needed.
`E-ATTR-WRITER-CONFLICT` (§5.5.3/§5.5.4, S268, #81), `E-SCOPE-012`/`E-SESSION-*` (§20.5, S266), and
`E-THEME-TOKEN-UNKNOWN` (§65.3.2, S265) are likewise carried — see auth.map.md (session) and
domain.map.md (CSS §65) for their current-state mechanism.

## sql-lex (§52.15.5, #120) — a shared LIVE/INERT `${}` classifier, not a new code
`compiler/src/codegen/sql-lex.ts` is the SINGLE source of truth for which `${…}`
interpolations in a `?{}` SQL body are LIVE (code context) vs INERT (inside a string literal,
`""`-quoted identifier, `E'…'` escape string, `$tag$…$tag$` dollar-quoted body, or `--` / nested
`/* */` comment). ONE hand-rolled SQL-lexer-grade scanner feeds BOTH the CLASSIFIER (`collect.ts`
server-var load-kind / row-scope predicate — the `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` omission set)
AND the param EMITTER (`rewrite.ts extractSqlParams`), so the two CANNOT disagree. Exports:
`liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation` (+ the
`SqlInterpolation` interface). Not itself a diagnostic. Known low-sev hardening: the `E'…'` escape
branch assumes Postgres, but the default db is SQLite — `g-ssr-auth-scoped-hardening-trio` finding 2.

## semdiff (#6b P0) — a diagnostic-CONSUMING classifier, not a new code
`compiler/src/semdiff.ts` is not a new diagnostic code — it CONSUMES the compiler's diagnostic set. `classifySemdiff(base, head)` classifies a base-vs-head change by AXIS (`opaque`/`source`/`use-site`/`context`) + soundness TIER (`0` proven cosmetic / `2` behavioral), never a boolean "safe". One of its three P0 signals is a use-site diagnostic-set diff (`diffDiagnostics`) — a diagnostic that appears/disappears between versions is a Tier-2 `use-site` axis. Exposed as `scrml semdiff` (see build.map.md); pure/unit-tested. Consumers: giti MERGE, flogence REVIEW.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:2001 | AST builder |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

`schema-differ.js`/`commands/db-migrate.js`/`codegen/db-authoritative.ts`/`codegen/sql-ident.ts`
declare NO new Error class — `schema-differ.js` returns `{sql, warnings}` structurally (no throw),
and `db-migrate.js` reports via `console.error` + `process.exit(1)` (a CLI, not a pipeline stage
feeding `collectErrors`). **S288: `db-migrate.js` gained non-diagnostic failure ATTRIBUTION** (not a
new Error class) — both apply loops (Postgres tx loop, SQLite loop) now catch a per-statement throw
and attach `e.scrmlFailedStatement = {index, total, sql}` before rethrowing, and the CLI's error path
(`printFailedStatement`) echoes it — see migrations.map.md for the full mechanism. `match-
statechild-parser.ts` likewise declares no Error class for `E-MATCH-INVALID-ARM`; Phase 2 returns a
`diagnostics` array on its `MatchParseResult`, consumed by the caller into the normal
`errors`/`warnings` streams.

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling. Unchanged.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Tags
#scrml #map #error #diagnostics #semdiff #css65 #diagnostic-partition #result-warnings #outlet #e-outlet-and-main #one-landmark #tenant-floor #e-tenant #ssr-auth-scoped #i-ssr-auth-scoped-client-hydrated #sql-lex #e-error-010 #e-fn-009 #e-attr-012-retired #e-mw #w-each-table-foster-retired #each-fence #e-async-stdlib-discard-hof #module-format-notice #e-attr-writer-conflict #session-establishment #e-theme-token-unknown #e-script-001 #e-cell-render-spec-not-bindable #fire-site-relocation #sym-pass-5a #landmark-tag #catalog-count-audit #catalog-vs-impl #w-lint-uncatalogued #dbauth #e-dbauth-sqlite #e-dbauth-no-tenant-column #w-dbauth-marker-nearmiss #w-schema-destructive-drop #db-migrate #rls #secdef #e-cg-018 #w-each-bind-item-field-deferred #e-schema-010 #e-match-invalid-arm #ghost-pattern #w-dead-function #failing-statement-attribution #auto-immutable-pk-tenant #session-principal-wiring #resolved-gaps

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
- [auth.map.md](./auth.map.md)
- [migrations.map.md](./migrations.map.md)
