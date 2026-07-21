# error.map.md
# project: scrml
# updated: 2026-07-21T13:40:00Z  commit: 9481bc69

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:18010-18723`)
**787 distinct diagnostic codes** cataloged in §34 at `9481bc69` (`compiler/SPEC.md:18204-19033`,
main table + the §34.1 native-parser sub-table at :18925). §34 is a lookup index only — each code's
normative definition lives in the SPEC section that introduces it (cited in the table's Section
column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX`/
`I-XXX`, or read §34 directly.

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

`W-EACH-TABLE-FOSTER` (#115) remains a Stage-6.4f info-lint with no §34 row (no count impact).

**Two catalog-vs-impl defects the audit surfaced — both open, both filed in
non-compliance.report.md:**
1. The `E-STYLE-001` row (`SPEC.md:18516`) reads "CSS: syntax error in `#{}` style block", but the
   code rejects the `<style>` ELEMENT (`block-splitter.js:3475-3495`). The row describes a trigger
   the compiler does not have — and it now sits four rows below the new, accurate `E-SCRIPT-001`
   row that explicitly calls itself "the symmetric twin of `<style>` -> `E-STYLE-001`".
2. **Nine LIVE `W-LINT-*` codes have no §34 row at all** — `W-LINT-016` through `W-LINT-024`, all
   real `code:` emit sites in `src/lint-ghost-patterns.js` (:1024, :1072, :1097 … :1299; 26 emit
   sites across the module). §34 catalogs only `W-LINT-001..008` + `010..015`. So the true count of
   codes the compiler can EMIT exceeds the catalog count; 787 is a count of §34, not of the
   implementation.

**NOT implemented — do not add.** `W-NAV-CHUNK-LOAD-FAILED` has ZERO occurrences in
`compiler/src/` (re-grepped at 9481bc69) and NO §34 row. Wave-1c pieces 2+3 (cross-chunk
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
| Codegen | E-CG-* | 11 | codegen/*.ts (incl. E-CG-001 protected-field egress) |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64, incl. E-TOOL-SERVE-*/E-TOOL-ROUTE-NEEDS-SERVE §64.9) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts, ast-builder.js (E-SQL-003 runtime-expr body), codegen/emit-server.ts + emit-tool.ts (E-SQL-004 `?{}`-without-`db=`) |
| Confidentiality — tenant-row floor (§14.8.10, #117/#118) | E-TENANT-AGG/WRITE/RAW-EGRESS / I-TENANT-STRIP/ACROSS | 5 | codegen/tenant-egress.ts (`resolveTenantScoping`/`classifyTenantWrite`/`detectTenantRawEgress`), emitted at codegen/emit-server.ts:1389/1405/1432 (E-WRITE/AGG/RAW-EGRESS) + :4893/4907 (I-STRIP/ACROSS) — the row-level twin of §14.8.9 protect-egress.ts |
| SSR prerender confidentiality (§52.15.5, RENAMED #120) | I-SSR-AUTH-SCOPED-CLIENT-HYDRATED | 1 | type-system.ts:10894 (server-authority cell) + :10935 (callable-init); auto-omit at codegen/emit-server.ts:~4138. Was retired W-SSR-PRERENDER-UNSCOPED |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| Session (§20.5) | E-SCOPE-012 / E-SESSION-* | 4 | type-system.ts (E-SCOPE-012, ident-walker), codegen/emit-expr.ts (E-SESSION-VALUE/E-SESSION-RESERVED-KEY sinks, drained by emit-server.ts), emit-server.ts (E-SESSION-CONTEXT context scan) |
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 (E-ERROR-010 §19.5.4 dedicated, #121) | emit-logic.ts, type-system.ts (E-ERROR-010 emit at type-system.ts:9853, formerly overloaded on E-TYPE-001) |
| Functions | E-FN-* | 9 (E-FN-009 Nominal/deferred — zero fire site) | type-system.ts (§48.5; E-FN-006 retired -> E-STATE-COMPLETE) |
| Route inference (client/server boundary) | E-ROUTE-* | — | route-inference.ts (§12.4 E-ROUTE-002 + E-ROUTE-005 client/server soundness) |
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
| Table-context `<each>` foster (#115, info-lint, NOT §34-catalogued) | W-EACH-TABLE-FOSTER | 1 | lint-w-each-table-foster.js, wired api.js:2218 Stage 6.4f |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE, E-THEME-TOKEN-UNKNOWN) | **E-STYLE-001 at block-splitter.js:3475** (rejects the `<style>` ELEMENT — NOT what its §34 row says, see the audit above); codegen/css-conflict-check.ts, api.js Stage 3.4 (§65.2); codegen/emit-theme-reset.ts (§65.3.2/§65.6) |
| **Foreign element rejection (§4.17, NEW #127)** | **E-SCRIPT-001** | **1** | **block-splitter.js:3498-3528** — the markup-opener path, immediately after the `<style>`/E-STYLE-001 branch. Exact `===` tag compare (never a prefix) so `<noscript>` is untouched; recovery scans to a case-insensitive `</script>` or EOF so a brace-heavy JS body does not cascade. SOURCE-side only — the emitter's own `<script src=…>` tags are produced downstream of BS |
| **Cell render-spec (§6.2/§6.6.17)** | E-CELL-NO-RENDER-SPEC / **E-CELL-RENDER-SPEC-NOT-BINDABLE** / E-CELL-OUT-OF-SCOPE | 3 | symbol-table.ts — **two different scopes, deliberately** (#128): `E-CELL-NO-RENDER-SPEC` is USE-scoped (PASS 5 `walkRenderByTagUses` :3060 -> `checkRenderByTag` :3000); `E-CELL-RENDER-SPEC-NOT-BINDABLE` is **DECL-scoped** (PASS 5a `walkNonBindableMarkupDecls` :2892 -> `checkDeclRenderSpecBindable` :2946). See the relocation note below |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |

## New + MOVED fire sites this pass (c48e59a2 -> 9481bc69, S277 #126/#127/#128)

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
  What it closes: before #127 a `<script>` element compiled **clean** and its body reached the
  emitted document **verbatim**. SPEC §4.17 had claimed `<script>` was "a Ghost-Pattern lint
  surface (W-LINT-018 family)" — false in both halves (`W-LINT-018` is `lint-ghost-patterns.js`
  Pattern 19, *Svelte store API calls*; no ghost-pattern rule targeted `<script>` at all). #127
  corrected §4.17 (`SPEC.md:1144-1149`, with an explicit S277 correction note) and added the §34
  row at `:18512`. Test: `compiler/tests/unit/script-element-rejected.test.js`.
  **Native-parser parity: CONFIRMED GAP** — `native-parser/parse-markup.js:983-995` carries a P5-4
  `<style>`->E-STYLE-001 mirror written precisely to match the live BS (its own comment names the
  D-void phantom-node divergence family it fixed) and has NO `<script>` counterpart. See
  non-compliance.report.md.

- **`E-CELL-RENDER-SPEC-NOT-BINDABLE` — FIRE SITE RELOCATED, use-site -> declaration
  (#128 `9481bc69`).** This is a MOVE, not a new code, and it is the kind of change a stale map
  gets wrong: **the old `<x/>` render-by-tag use-site fire was REMOVED.**
    - **Before:** fired inside `checkRenderByTag` (PASS 5), only when a `<x/>` render-by-tag use
      was reached. Consequence: `${@x}` interpolation of the offending cell, and a decl with NO use
      at all, were **silently accepted** and lowered to `_scrml_reactive_set(name, null)` with the
      authored markup discarded — no diagnostic.
    - **Now:** fires in **SYM PASS 5a**, `walkNonBindableMarkupDecls` (`symbol-table.ts:2892`) ->
      `checkDeclRenderSpecBindable` (:2946), wired at `:12425` and run BEFORE the use-site walk so
      the decl diagnostic is reported ahead of anything on the markup that references it. Fires
      **once per decl**, on the decl's own span; `makeNotBindableDiagnostic` (:2857) now takes only
      the decl (its `use` parameter is gone) and its message was rewritten to lead with the decl
      shape (`` `<x> = <div>...` — the RHS markup is a non-input element ``).
    - **Rationale (SPEC §6.2 Shape 2):** the rule is stated as a property of the DECLARATION ("the
      RHS markup is a non-input element") and names the alternative (Shape 3 `const`). Nothing
      about it depends on a use site. `E-CELL-NO-RENDER-SPEC` stays USE-scoped for the mirror-image
      reason — "you rendered `<x/>` but that cell has nothing to render" is genuinely a property of
      the use, and the same decl is legal when read with `${@x}`.
    - **The predicate is B5's `_cellKind`, NEVER the RHS markup shape.** A LEGAL Shape 2 bindable
      cell (`<userName req> = <input type="text"/>`) also has a markup RHS and also lowers to
      `_scrml_reactive_set(…, null)` — the emitted symptom is byte-identical between the legal and
      the illegal form. Any check keying on "the RHS is markup" or on the emitted null-set turns
      every form input in the corpus into an error.
    - PascalCase (component) RHS is still deferred silently at BOTH sites (Phase 0 §3.2, awaiting
      the B14/M18/M20 component prop catalog) — deliberately spelled the same way (`isConst ===
      true`, `charCodeAt(0)` 65-90) so decl and use cannot drift.
    - Test: `compiler/tests/integration/cell-render-spec-decl-scoped.test.js`.

- **`E-OUTLET-*` family — collector widened, NO code change (#126 `499dd740` + #128 `9481bc69`).**
  `collectOutlets` (SYM PASS 15.5, `symbol-table.ts:10318`) changed shape in three ways that alter
  WHEN the existing three E-OUTLET codes fire:
    1. **TOTAL walk** (#126) — every object-valued property, `span` excluded, WeakSet-guarded (the
       guard moved ABOVE the array branch, so arrays are guarded too). It replaced a hand-listed
       edge set copied from `walkChannelPlacement`, which silently missed `armBodyChildren` (match
       block-form), `bodyChildren` (engine state-children) and `<each>` bodies. It now deliberately
       mirrors its emit twin `treeHasAuthorMain`.
    2. **Shared `<main>` predicate** (#126) — the `nodeTag === "main"` compare became
       `isAuthorMainTag(node)` from the NEW `compiler/src/landmark-tag.ts`, imported by BOTH this
       pass and `codegen/emit-html.ts`. Case-insensitive (`<MAIN>` is a landmark to a browser) but
       NR-guarded so a legal component named `Main` is not mistaken for it.
    3. **Nested-`<program>` route-scope reset** (#128) — `inRouteScope` now resets to `false` at a
       nested `<program>`, the sibling of the existing `openMains` reset (§4.12.1: a nested
       `<program>` inherits nothing). Without it `inRouteScope` latched true for a whole `<page>`
       subtree, so a nested shell's `<main>` was never collected and a textbook case-4 violation in
       the INNER shell was silently exempted — while its `<div>`-wrapped twin always fired.
  Also new (#126): a `reportSpans` WeakMap. Nodes reached through a SUB-PARSED subtree (match-arm
  bodies, `<each>` bodies) carry spans measured from the start of that sub-parse and never rebased
  to file coordinates, so their own span reads L1:C1. Detected structurally (a span starting BEFORE
  its own ancestor cannot be a real descendant position), falling back to the nearest
  file-absolute ancestor span. `fireOutletOutsideShell` / `fireOutletDuplicate` /
  `fireOutletAndMain` all take the resolved span as a 4th argument. **This is a general ast-builder
  gap, not an outlet one** — an unrelated `E-STATE-UNDECLARED` inside a match arm mislocates the
  same way.

## New fire sites this session (58c8161d -> c48e59a2, S276 #124)

- **`E-OUTLET-AND-MAIN` (Error, NEW)** — §20.8.1.1 THE ONE-LANDMARK INVARIANT (navigate Wave-1c
  PR-1). A `<program>` shell declares an author `<main>` as a **SIBLING** of its `<outlet>`: two
  candidate route-content regions, two `<main>` landmarks, and nothing in the source says which one
  the route content belongs in. **Narrowly scoped to the bare/sibling shape ONLY** — the other
  three arrangements of §20.8.1.1 are all LEGAL and fire NOTHING (the compiler resolves each by
  tag-demotion, never by diagnostic):
    1. `<outlet>` alone — the outlet emits AS `<main data-scrml-outlet>`;
    2. `<main><outlet/></main>` (WRAPPING) — author's `<main>` is the landmark, outlet demotes to a
       marked `<div>`;
    3. a `<page>`-scoped or `pages/*.scrml` route `<main>` — route content owns the landmark, slot
       demotes to a marked `<div>`.
  Fired ON the `<main>` (the element the author must move or remove), naming all three
  resolutions: WRAP the outlet · REMOVE the `<main>` · MOVE the `<main>` inside the `<page>` whose
  content it is. Fire site: `compiler/src/symbol-table.ts` SYM PASS 15.5 — `walkValidateOutlets`
  (:10096) collects per-shell author `<main>`s (`shellMains`) with an `inRouteScope` flag that
  EXCLUDES `<page>` and `<outlet>` bodies (case 3) and a `wrappingMains` WeakSet marking any
  `<main>` open on the walk path when an outlet is reached (case 2); the survivors fire via
  `fireOutletAndMain` (:10372, code string at :10393). SPEC: §20.8.1.1 (`SPEC.md:15080`), §34 row
  at `:18388`, §34 narrative at `:15141`/`:15150`.
  **Note for anyone touching this:** `<outlet>` is NOT a dedicated AST node — it is a
  `kind: "markup"` node with `tag: "outlet"`, and so is `<main>`. There is no typed edge set; every
  check here is structural. See domain.map.md.

## New fire sites prior window (df2ac831 -> 58c8161d, S272-S274)
> The map's df2ac831 base was the **S271** watermark, so this window folded the S272 each-foster
> (#115) + S273 tenant-floor (#117/#118) landings in with #120/#121/#122.

- **`E-TENANT-AGG` / `E-TENANT-WRITE` / `E-TENANT-RAW-EGRESS` (Errors) + `I-TENANT-STRIP` /
  `I-TENANT-ACROSS` (Info)** (§14.8.10 tenant-row isolation floor, #117 SPEC / #118 impl, S273) —
  the ROW-level twin of the §14.8.9 protect-floor (which strips protected COLUMNS). A `<schema>`
  table carrying a `tenant_id` column is tenant-scoped by that column's PRESENCE (no opt-in
  attribute); its rows are tagged (`Symbol.for("scrml.tenant.origin")`) at `?{SELECT}` lowering
  and redacted at the SAME compiler-owned client-egress sinks §14.8.9 uses (server-fn return, SSR
  seed), fail-closed when `@currentUser.tenantId is not`. The three HARD-FAILS fire where
  redaction/injection is unsound: `E-TENANT-AGG` — an aggregate/scalar (`COUNT`/`SUM`/…) with no
  per-tenant output discriminator (`GROUP BY tenant_id`); `E-TENANT-WRITE` — an UPDATE/DELETE or an
  un-injectable INSERT against a tenant-scoped table (a parseable single-row INSERT omitting
  `tenant_id` is AUTO-injected, no error); `E-TENANT-RAW-EGRESS` — tenant rows reaching a
  compiler-unanalyzable egress (`_{}` foreign block, manual `Response`/`handle()`, `asIs`).
  `.acrossTenants()` is the deliberate cross-tenant opt-out (emits `I-TENANT-ACROSS` for audit
  grep); `I-TENANT-STRIP` records a non-silent redaction. Fire sites:
  `compiler/src/codegen/tenant-egress.ts` (`resolveTenantScoping` [agg + select-scope],
  `classifyTenantWrite`, `detectTenantRawEgress`), emitted at `codegen/emit-server.ts:1389`
  (E-TENANT-WRITE) / `:1405` (E-TENANT-AGG) / `:1432` (E-TENANT-RAW-EGRESS) / `:4893`
  (I-TENANT-STRIP) / `:4907` (I-TENANT-ACROSS). V1-minimal = redact-floor + hard-fails; SQL-WHERE
  injection = v1.next. Residual: the §38.13 realtime `watches=` / SSE per-subscriber tenant filter
  is NOT built (Nominal — `g-tenant-channel-sse-per-subscriber-filter`).
- **`I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (Info) — RENAMED from the retired
  `W-SSR-PRERENDER-UNSCOPED`** (§52.15.5, #120, S274) — an auth-scoped server-authority cell whose
  SSR pre-render would be UNSCOPED (a Tier-1 `SELECT *`, a Pattern-C query with no LIVE
  `${@currentUser.…}` row-scope interpolation, or a coalesced callable-init cell that batches into
  `/__mountHydrate`) is AUTO-OMITTED from the anonymous SSR seed (no first-paint markup fill, no
  `window.__scrml_ssr_state` entry) and hydrates client-side behind its gated `/__serverLoad` (or
  per-cell `/__mountHydrate`) fetch — closing a cross-user first-paint data leak. Info-level,
  auto-make-safe (mirrors the §14.8.9 auto-redaction shape), never fatal. #120 brought the
  CODE in line with the S255-spec-ahead catalog (§34 already carried the I-name; the emitter still
  fired `W-SSR-PRERENDER-UNSCOPED` until #120). **Re-verified at c48e59a2:**
  `W-SSR-PRERENDER-UNSCOPED` has ZERO occurrences in `compiler/src/` — the retirement is complete,
  not partial. Fire sites: `type-system.ts:10894` (server-authority cell) + `:10935` (callable-init
  cell); the SSR-seed auto-omission at `codegen/emit-server.ts:~4138-4221`; the per-cell
  `/__mountHydrate` gate at `codegen/emit-server.ts:~3918`. Row-scope is decided by the shared
  `codegen/sql-lex.ts` LIVE-interpolation predicate (see "sql-lex" below), so the codegen omission
  and this lint PROVABLY coincide. Non-blocking S239 hardening tracked as
  `g-ssr-auth-scoped-hardening-trio`.
- **`E-ERROR-010`** (§19.5.4, #121, S274 — SPEC-catalog addition + repoint, no NEW fire site) —
  `?`-propagation where a called failable fn's error variant(s) are incompatible with the
  enclosing fn's declared error type. Now a DEDICATED code (was overloaded on E-TYPE-001);
  §19.5.3/.4 repointed. Emitted at `type-system.ts:9853` — the check was already live; #121 is the
  catalog/cite reconciliation, not a codegen change.
- **`W-EACH-TABLE-FOSTER`** (info-lint, #115, S272 — NOT a §34-catalog code) — a top-level
  `<each>` inside a table section (`<table>/<thead>/<tbody>/<tfoot>/<tr>`) emits a `<div>` mount
  the HTML parser foster-parents OUT of the table -> the reactive list silently renders 0 rows.
  The lint turns it loud and points at the `<div>`-layout workaround. Module
  `compiler/src/lint-w-each-table-foster.js`, wired at `api.js:2218` (Stage 6.4f). The real
  foster-safe mount fix is DEFERRED (`g-each-mount-div-foster-parented-in-table`).

### Freeze-spec doc-reconciliation (#121, S274 — SPEC-text only, no fire-site change)
- **`E-ATTR-012`** stays RETIRED (S249-drop: `bind:`+same-event-handler is composable by design);
  #121 cleaned the lingering SPEC prose (§5.4 + §34 tombstone rows now read "Retired (S249-drop,
  SPEC-cleaned S274)"). ZERO fire site — the `ast-builder.js:13399` mention is a comment recording
  "the E-ATTR-012 lesson", not an emit.
- **`E-FN-009`** marked **Nominal / spec-ahead — DEFERRED** (§48.5.4) — reactive-`@variable`
  live-subscription-capture inside a `fn` body. Specified (S31 "Fate of fn" retained) but the check
  needs call-graph analysis `type-system.ts` defers; ZERO fire site as of c48e59a2.
- **`E-MW-002` / `E-MW-005` / `E-MW-006`** (§40 middleware) — §34 cites CORRECTED to a drift-proof
  `ast-builder.js §40-block` anchor; the checks are wired + LIVE (the S263 "zero fire sites" was a
  stale-cite mis-diagnosis — Fork-B verify-flipped a proposed wire to a cite-fix). Real emits at
  `ast-builder.js:18190` (E-MW-002) / `:18231` (E-MW-005/006).
- **E-MARKUP-002 native-parity note** (§3.2 / §4.4.1) — impl#1 (live pipeline) surfaces closer-name
  mismatch as the live `E-CTX-001`; impl#2/native still emits it under the now-retired
  `E-MARKUP-002`. Migrating native to E-CTX-001 (`tag-frame.js`) is a pending native-parity item,
  tracked separately (thread `e-markup-002-native-emit`), NOT a compliance violation.

## New fire sites prior window (99ae45ca -> df2ac831, S266-S271 — carried, unchanged)
- **`E-ATTR-WRITER-CONFLICT`** (§5.5.3/§5.5.4, S268, #81) — a WHOLESALE reactive value writer
  (`class=(expr)`/`style=(expr)`/`value=(expr)`) sharing a physical DOM surface with ANOTHER writer
  on the same element (a per-token composer `class:name=`, `if=`/`show=`/transitions on `style`, or
  `bind:value`). Both sites named; the conflicting attribute is NOT emitted. Fires at
  `codegen/emit-html.ts`'s `analyzeWriterConflict`.
- **`E-SCOPE-012`** (§20.5, RESERVED -> LIVE) — `session` accessed outside a server-escalated
  function body. Fires in `type-system.ts`'s ident-walker (`checkLogicExprIdents`).
- **`E-SESSION-CONTEXT`** (§20.5.1) — `session.*` in a server-escalated body with NO cookie-session
  request/response context (SSE `server function*`, `<endpoint>` arm, `<machine>` method,
  serverLoad cell, in-process server-fn helper, headless `kind="tool"`).
- **`E-SESSION-VALUE`** (§20.5) — a BARE `session` value-use (returned/assigned/passed). Fires in
  `codegen/emit-expr.ts:emitIdent`, drained by `emit-server.ts:generateServerJs`.
- **`E-SESSION-RESERVED-KEY`** (§20.5.1, B5) — a LITERAL `session.set("csrfToken", …)`. Fires in
  `codegen/emit-expr.ts:emitCall`; a DYNAMIC-key write is additionally a runtime no-op via the
  `_scrml_session_begin` setter guard.
- **`E-THEME-TOKEN-UNKNOWN`** (§65.3.2/§65.6/§65.10, S265) — a `@`-sigil `#{}`-value reference
  resolving to neither an in-scope `<theme>` token nor a declared cell. Fires in
  `codegen/emit-theme-reset.ts`.
- Colorless-async Seam-A (S267/S269/S271) widened `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` fire-site
  coverage (no new code). GITI-038/039 and i87 add no codes.

## sql-lex (§52.15.5, #120) — a shared LIVE/INERT `${}` classifier, not a new code
`compiler/src/codegen/sql-lex.ts` is the SINGLE source of truth for which `${…}`
interpolations in a `?{}` SQL body are LIVE (code context) vs INERT (inside a string literal,
`""`-quoted identifier, `E'…'` escape string, `$tag$…$tag$` dollar-quoted body, or `--` / nested
`/* */` comment). ONE hand-rolled SQL-lexer-grade scanner feeds BOTH the CLASSIFIER (`collect.ts`
server-var load-kind / row-scope predicate — the `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` omission set)
AND the param EMITTER (`rewrite.ts extractSqlParams`), so the two CANNOT disagree (round-3 defect:
a `$N` param emitted inside a comment -> Postgres bind-count mismatch). Exports:
`liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation` (+ the
`SqlInterpolation` interface). Importers verified at c48e59a2: `codegen/rewrite.ts:2` and
`codegen/collect.ts:2` — exactly the two the no-divergence guarantee depends on. Not itself a
diagnostic. Known low-sev hardening: the `E'…'` escape branch assumes Postgres, but the default db
is SQLite — `g-ssr-auth-scoped-hardening-trio` finding 2.

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

Line numbers not re-verified this incremental pass. The S277 diff (#126/#127/#128) touched `symbol-table.ts`, `block-splitter.js`, `codegen/emit-html.ts` and added `landmark-tag.ts`; `block-splitter.js:59` (BSError) sits ~3400 lines above the E-SCRIPT-001 insertion and is unmoved, and none of the other three declare an Error class. (Prior-window note carried: the S276 diff touched only
`codegen/emit-html.ts`, `codegen/index.ts` and `symbol-table.ts`, none of which declare an Error
class; the S272-S274 diff touched type-system.ts, codegen/{collect,emit-logic,emit-server,emit-sync,rewrite}.ts, api.js and added codegen/{sql-lex,tenant-egress}.ts + lint-w-each-table-foster.js, likewise none of the ten declaration lines; carried forward from the df2ac831 watermark.)

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling. Unchanged.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Tags
#scrml #map #error #diagnostics #semdiff #css65 #diagnostic-partition #result-warnings #outlet #e-outlet-and-main #one-landmark #tenant-floor #e-tenant #ssr-auth-scoped #i-ssr-auth-scoped-client-hydrated #sql-lex #e-error-010 #e-fn-009 #e-attr-012-retired #e-mw #w-each-table-foster #e-attr-writer-conflict #session-establishment #e-theme-token-unknown #e-script-001 #e-cell-render-spec-not-bindable #fire-site-relocation #sym-pass-5a #landmark-tag #catalog-count-audit #catalog-vs-impl #w-lint-uncatalogued

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
- [auth.map.md](./auth.map.md)
