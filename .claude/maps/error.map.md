# error.map.md
# project: scrml
# updated: 2026-07-28T16:50:00Z  commit: 115e8b1b

## HOW TO LOOK UP A DIAGNOSTIC CODE (read this first)

This map is the FIRST stop for any `E-*` / `W-*` / `I-*` lookup, and as of this pass it is
answerable for **every** code family, not only the ones a recent window happened to touch. The
`g-maps-error-map-missing-diagnostics-and-emit-client` gap (filed independently by two lanes at
S295) was exactly this: a lookup for `E-PA-002` or `TAILWIND` routed here and found **zero hits**,
so both loci had to be found by grep. Both families now have rows below.

**The reliable procedure, in order:**
1. Read the **"Diagnostic families by feature area"** table below and take its `Fire site` column.
   It is keyed by PREFIX, so a code this map does not name individually is still routed by its
   family (`E-PA-*` -> protect-analyzer.ts, `*-TAILWIND-*` -> tailwind-classes.js, and so on).
2. If the family row is not enough, `grep -rn "<CODE>" compiler/src/` — the fire site is always a
   `code:` field, a `"<CODE>"` string argument, or an interpolated message prefix.
3. For the NORMATIVE definition, grep `compiler/SPEC.md` for the code. §34 is a lookup index only;
   each code's meaning lives in the section that introduces it (cited in §34's Section column).

**Do not** assume a code is unimplemented because §34 lists it — nine live `W-LINT-*` codes have no
§34 row at all (below), and until this window `W-NAV-CHUNK-LOAD-FAILED` was the mirror case (a §34
row now exists AND it fires; the prior "NOT implemented — do not add" note here is RETIRED).

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md` §34 through §35)

**799 distinct diagnostic codes** cataloged in §34 at `115e8b1b` — re-extracted this pass with the
UTF-8-safe `awk -F'|'` field-split methodology, `comm` set-diff-verified against the 795 baseline at
`c700c435`. **+4, zero removed.**

### Count methodology (re-derivable; do NOT hand-roll it with a bare grep)

Bound the extraction at the `## 34. Error Codes` heading and the `## 35.` heading, split on `|`,
strip `~~`-tombstone markers, and count UNIQUE code strings (not raw rows). The §34.1 native-parser
sub-tables (`E-EXPR-*`, `E-STMT-*`, `E-MARKUP-VALUE-UNCLOSED`, `I-NATIVE-BLOCK-*`) are legitimately
part of the catalog and are included.

- **UNIQUE code strings is the authoritative figure.** The raw-ROW count runs +1 high because §34
  carries TWO rows for `E-MARKUP-003` (two different retired-S263 meanings). Do not carry a
  raw-row baseline forward.
- **A bare `grep -oP '^\|\s*~{0,2}\K[EWI]-\S+'` over the whole `SPEC.md` silently omits at least one
  matching row** (`E-CG-013`) in this environment, though it extracts correctly when that line is
  isolated. Root cause not chased (this map does not need to own a grep-tooling defect) — use the
  `awk` field split.
- `docs/FACTS.md` deliberately does NOT publish this figure: it states the total "is load-bearing
  but not reliably extractable — a scan from the §34 heading over-counts by catching later tables,
  and in a file whose whole purpose is accuracy, a wrong number is worse than an absent one." **This
  map is the reconciled answer.**

### Delta ledger, every leg `comm`-set-diff-verified

| Window | Count | Delta |
|---|---|---|
| `df2ac831..58c8161d` | 779 -> 785 | +7 (`E-ERROR-010`, `E-TENANT-AGG`/`-WRITE`/`-RAW-EGRESS`, `I-TENANT-STRIP`/`-ACROSS`), -1 (`W-SSR-PRERENDER-UNSCOPED` renamed to the I-code) |
| `58c8161d..c48e59a2` | 785 -> 786 | +1 `E-OUTLET-AND-MAIN` |
| `c48e59a2..9481bc69` | 786 -> 787 | +1 `E-SCRIPT-001` |
| `a0344d75..f8a138e9` | 787 -> 793 | +6: `E-DBAUTH-SQLITE`, `E-DBAUTH-NO-TENANT-COLUMN`, `W-DBAUTH-MARKER-NEARMISS`, `W-SCHEMA-DESTRUCTIVE-DROP`, `E-CG-018`, `W-EACH-BIND-ITEM-FIELD-DEFERRED` |
| `f8a138e9..c700c435` | 793 -> 795 | +2: `E-SCHEMA-010`, `E-MATCH-INVALID-ARM` |
| **`c700c435..115e8b1b` (THIS pass)** | **795 -> 799** | **+4, zero removed: `E-SCHEMA-011`, `W-SCHEMA-CONSTRAINT-TIGHTENED`, `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED`, `W-NAV-CHUNK-LOAD-FAILED`** |

### Two standing catalog-vs-impl facts

1. **STILL OPEN — nine LIVE `W-LINT-*` codes have no §34 row at all.** `W-LINT-016` through
   `W-LINT-024`, all real `code:` emit sites in `compiler/src/lint-ghost-patterns.js` (26 emit sites
   across the module, :1024, :1072, :1097 … :1299). §34 catalogs only `W-LINT-001..008` +
   `010..015`. So the true count of codes the compiler can EMIT exceeds 799; **799 is a count of
   §34, not of the implementation.**
2. **`W-MODULE-FORMAT-ESM-INCOMPLETE` is NOT a diagnostic code.** It is an OPERATIONAL stderr notice
   key printed by `compiler/src/commands/module-format-notice.js` for `--module-format=esm`. No §34
   row by design; never enters `result.errors`/`result.warnings`; must not be counted or asserted on.
3. **`W-EACH-TABLE-FOSTER` is RETIRED and DELETED (#131).** Code, module
   (`compiler/src/lint-w-each-table-foster.js`), Stage-6.4f wiring and unit test are all gone. No
   §34 impact (it never had a row). Do not re-add it.
4. **RETIRED NOTE — `W-NAV-CHUNK-LOAD-FAILED`.** Prior generations of this map said "NOT implemented
   — do not add" and treated any doc naming it as describing planned work. **That is no longer
   true at this HEAD**: navigate-wave1c landed, the code fires from `runtime-template.js`'s
   `_scrml_nav_chunk_failed`, and §34 carries its row. See "New fire sites this window" below.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged).
Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check
BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition
logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes).

**Third stream — `lintDiagnostics[]`.** The ghost-pattern lint pre-pass (runs BEFORE Stage 2/BS) and
the two Tailwind detectors return into `allLintDiagnostics`, NOT into `errors[]`. A test asserting
on `W-LINT-*` / `W-TAILWIND-*` must read that array (or the CLI's `[LINT]` output), not
`result.errors`.

**Span lift (`api.js` `collectErrors`).** `bsSpan -> span` and, **NEW this window (S294)**,
`tabSpan -> span`. `TABError` (`compiler/src/ast-builder.js`) bakes `(line X, col Y)` into
`.message` for the compile-path formatter but sets no `.span`; without the lift, EVERY TABError
reached `dev.js`/`build.js` with `filePath` stamped but no `:line:col`, while sibling
CGError/protect diagnostics (which carry `span`) showed it. Closes
`g-estmt-missing-semicolon-no-source-span`.

## Diagnostic families by feature area — THE ROUTING TABLE

Keyed by PREFIX. A code not named individually below is still routed by its family row.

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Engine / state machine | E-ENGINE-* | 44 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Type system | E-TYPE-* | 41 | type-system.ts |
| Component | E-COMPONENT-* | 22 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 35 | type-system.ts (§14.12) |
| Realtime channel | E-CHANNEL-* | 18 | route-inference.ts, channel-watches.ts, emit-channel.ts (§38) |
| Syntax | E-SYNTAX-* | 14 | ast-builder.js, tokenizer.ts |
| Lint (info-tier) | W-LINT-* | 14 cataloged / **23 live** | `lint-ghost-patterns.js` + the other `lint-*.js` modules. **Returns into `lintDiagnostics[]`, not `errors[]`.** `W-LINT-016..024` have no §34 row — see above. |
| **Tailwind / utility-class lint (§26.3 / §26.5)** | **W-TAILWIND-001 · W-TAILWIND-UNRECOGNIZED-CLASS · E-TAILWIND-001** | **3** | **`compiler/src/tailwind-classes.js` is the SOLE fire site for all three.** `findUnsupportedTailwindShapes(source)` -> `W-TAILWIND-001` (a class whose SHAPE suggests Tailwind variant/arbitrary-value syntax but does not match the registered utility set). `findUnrecognizedClasses(source)` -> `W-TAILWIND-UNRECOGNIZED-CLASS` (any `class="…"` name that does not resolve via the registry — typos, unsupported arbitrary values, AND custom CSS classes, which are acknowledged false positives at floor level). `validateArbitraryCss` -> `E-TAILWIND-001` (invalid arbitrary-value syntax: empty `[]`, whitespace inside `[]`, illegal characters, backtick, embedded quote, empty `_`-list segment, unbalanced parens, malformed `url()`/`var()`, unknown CSS function). **WIRING:** both detectors are invoked from `compiler/src/api.js`'s ghost-error lint pre-pass (~:1025-1050), which runs BEFORE Stage 2/BS and pushes into `allLintDiagnostics`. **SUPPRESSION:** `compilerSettings.lintTailwindUnrecognizedClass = "off"` (default `"warn"`) — the SPEC §28 `lint.*` knob family; unknown keys are silently ignored. **A false-fire here is a REAL bug, not noise** — see the D-3 `outline-*` narrative below. |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* / W-FOREIGN-* | 15 | ast-builder.js, type-system.ts (§23). `W-FOREIGN-UNDECLARED-CAPABILITY` is suppressible via `compilerSettings.lintForeignUndeclaredCapability` (SPEC §28 `lint.foreign-undeclared-capability = off`). |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 19 | type-system.ts |
| Codegen | E-CG-* | 13 (incl. E-CG-018 chunk-token distinctness) | codegen/*.ts (incl. E-CG-001 protected-field egress). **`E-CODEGEN-INVALID-LOGIC` is the emitted-JS validity backstop** — a `let` redeclaration from a per-item reconcile prelude is the shape S294's shadow-safe selection prevents. |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts, ast-builder.js (E-SQL-003 runtime-expr body), codegen/emit-server.ts + emit-tool.ts (E-SQL-004 `?{}`-without-`db=`) |
| **Protect-analyzer (§14.8.9 protect-floor + shadow-DB schema resolution)** | **E-PA-001 … E-PA-007** | **7** | **`compiler/src/protect-analyzer.ts` is the SOLE fire site** (`PAError`, :127). `E-PA-001` legacy/superseded for the missing-file case; **`E-PA-002`** = `src=` file does not exist AND one or more `tables=` names have no `CREATE TABLE` (emit at :828, in `resolveDb`); `E-PA-003` = cannot open. **CHANGED THIS WINDOW (S292):** `E-PA-002`'s message now LEADS with the `<schema>` + `scrml db-migrate` remedy and demotes hand-written `CREATE TABLE` advice to an "Otherwise" fallback — see below. The file also documents two historical FALSE-FIRE classes at :415 / :493 / :626 / :948 (a `db` shape whose DDL the analyzer could not see); read those comments before "fixing" a spurious E-PA-002. |
| **DB-authoritative tier (§14.8.11/.1/.2)** | E-DBAUTH-* / W-DBAUTH-* | 3 | `codegen/index.ts` (`annotateDbScopes`, compile-time `E-DBAUTH-SQLITE`) + `commands/db-migrate.js` (deploy-time `E-DBAUTH-SQLITE` / `E-DBAUTH-NO-TENANT-COLUMN` pre-flight) + `codegen/db-authoritative.ts` (`extractDesiredSchema`, `W-DBAUTH-MARKER-NEARMISS`) |
| **Schema (§38.6 / §39.5)** | E-SCHEMA-* / W-SCHEMA-* | **16** | protect-analyzer.ts, type-system.ts, **schema-differ.js** (`diffSchema` — `W-SCHEMA-002`, `W-SCHEMA-DESTRUCTIVE-DROP`, and NEW this window `W-SCHEMA-CONSTRAINT-TIGHTENED` :843/:857/:876/:895 + `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` :916), **gauntlet-phase1-checks.js** (`E-SCHEMA-010` via `findNonLiteralSetItems`; NEW `E-SCHEMA-011` :796-810 via `parseColumns`'s `malformedReferences` + `referencesHint`) |
| Confidentiality — tenant-row floor (§14.8.10) | E-TENANT-AGG/WRITE/RAW-EGRESS / I-TENANT-STRIP/ACROSS | 5 | codegen/tenant-egress.ts, emitted at codegen/emit-server.ts:1389/1405/1432 + :4893/4907 |
| SSR prerender confidentiality (§52.15.5) | I-SSR-AUTH-SCOPED-CLIENT-HYDRATED | 1 | type-system.ts:10894 / :10935; auto-omit at codegen/emit-server.ts |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| Session (§20.5) | E-SCOPE-012 / E-SESSION-* | 4 | type-system.ts, codegen/emit-expr.ts, emit-server.ts |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts (E-ERROR-010 at type-system.ts:9853) |
| Functions | E-FN-* | 9 (E-FN-009 Nominal/deferred — zero fire site) | type-system.ts (§48.5) |
| Route inference (client/server boundary) | E-ROUTE-* / **W-DEAD-FUNCTION** | — | route-inference.ts (§12.4 E-ROUTE-002/005; §12.2 Trigger 6 `W-DEAD-FUNCTION`) |
| **Server-import cross-file invariant** | **W-SERVER-IMPORT-UNEMITTED** + W-SERVER-* | 2 | **`compiler/src/api.js` `checkServerImportInvariant`** — runs on the COMPILE, before the write gate. **Reverses the emitted specifier in DIST space via `serverImportTargetSource` since D-4 (S296); a source-space reversal made this guard blind to the exact class it exists to catch.** See dependencies.map.md's "Coordinate space" section. |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js |
| Middleware (§40) | E-MW-002/005/006 | 3 live | ast-builder.js §40-block (:18190, :18231) |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 8 (E-ATTR-012 RETIRED tombstone — DROPPED-BY-DESIGN, S249; E-ATTR-WRITER-CONFLICT #81) | attribute-registry.js, validators/attribute-*.ts, codegen/emit-html.ts (`analyzeWriterConflict`) |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| Client Router / outlet (§20.8) | E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / E-OUTLET-AND-MAIN / W-OUTLET-ABSENT-SOFT-NAV-DISABLED | 4 | symbol-table.ts PASS 15.5 `walkValidateOutlets` (:10210) -> `collectOutlets` (:10318); the W-code fires at the ast-builder.js filesystem-inference site |
| **Client Router — cross-chunk soft nav (§20.8.2/§20.8.7)** | **W-NAV-CHUNK-LOAD-FAILED** | **1 — NEW, IMPLEMENTED** | **`compiler/src/runtime-template.js` `_scrml_nav_chunk_failed`** (:2660-2667). Info-level, emitted by the RUNTIME in the generated app (a `console` line, not a compile diagnostic). See below. |
| Async/stdlib callback | E-ASYNC-* | 2 | async-stdlib-in-sync-callback guard, codegen/emit-server.ts, codegen/emit-expr.ts |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live | E-STYLE-001 at block-splitter.js:3475; codegen/css-conflict-check.ts; api.js Stage 3.4; codegen/emit-theme-reset.ts |
| Foreign element rejection (§4.17) | E-SCRIPT-001 | 1 | block-splitter.js:3498-3528. Exact `===` tag compare (never a prefix), so `<noscript>` is untouched; recovery scans to a case-insensitive `</script>` or EOF. SOURCE-side only. |
| Cell render-spec (§6.2/§6.6.17) | E-CELL-NO-RENDER-SPEC / E-CELL-RENDER-SPEC-NOT-BINDABLE / E-CELL-OUT-OF-SCOPE | 3 | symbol-table.ts — deliberately two different scopes (#128): NO-RENDER-SPEC is USE-scoped (PASS 5 `walkRenderByTagUses`); NOT-BINDABLE is DECL-scoped (PASS 5a `walkNonBindableMarkupDecls`) |
| `<each>` per-item bind (i175) | W-EACH-BIND-ITEM-FIELD-DEFERRED | 1 | codegen/emit-each.ts `renderTemplateAttrToJs` |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |
| Block-form `<match>` arm validity (§18.0.1) | E-MATCH-INVALID-ARM | 1 | match-statechild-parser.ts `parseMatchArms` (Phase-2 tokenizer — STRUCTURAL, distinct from the SYM-pass SEMANTIC E-MATCH-* checks) |

## New fire sites this window (`c700c435` -> `115e8b1b`) — 4 new codes, 2 changed messages

### `E-SCHEMA-011` (Error, §39.5.5, S290) — a `references` clause that parses to no foreign key
`compiler/src/gauntlet-phase1-checks.js:796-810`, fed by `schema-differ.js`'s `parseColumns`
(`malformedReferences`) and `referencesHint(raw)` (the "you wrote X, the only form is Y" hint).
§39.5.5 declares exactly ONE production — `references <table>(<column>)`, the table name OUTSIDE the
parens — and **every other shape was silently DROPPED**: `references(owners.id)`, `references owners
(id)`, `references owners.id` all compiled and migrated clean with no `REFERENCES` clause and NO
diagnostic. An adopter declared 34 foreign keys in a real 19-table ledger schema and got zero rows
in `pg_constraint`; an INSERT naming a non-existent parent was accepted. **RULED S290: reject rather
than admit a second form** — admitting is newly-ACCEPTING beyond the contract (§8 one-way door)
while rejecting is recoverable, and the corpus migration was MEASURED at 17 sites, every one of them
scrml's own documentation. `schema-differ.js:232` (`blankLiteralBodies`) exists so
`default('see references')` and comment text do not false-fire it; `//` comments are stripped.

### `W-SCHEMA-CONSTRAINT-TIGHTENED` (Warning, §38.6.2, S290)
`compiler/src/schema-differ.js` `diffSchema`, emitted at :843 (NOT NULL), :857 / :895 (UNIQUE), :876
(FOREIGN KEY). The reconcile plan ADDS a constraint to a column that ALREADY EXISTS in the live DB.
The DDL is emitted, but it can only succeed if existing rows already satisfy it — a NULL, a
duplicate or an orphan row fails the migration. **The failure is CORRECT** (the data does not match
the declared schema) and the transaction rolls back; the warning exists so an operator can backfill
first rather than discover it from a driver error. Backed by NEW exported
`columnConstraintDrift(desiredCol, actualCol)` -> `{notNull, unique, references, default}` — PK-aware
(a PRIMARY KEY is implicitly NOT NULL and UNIQUE; do not fight the driver over it) and using a
tolerant `sameDefaultText` normalizer (drops a PG `::type` cast suffix, unwraps one quote layer,
case-folds) so a driver's echoed default never reads as permanent phantom drift. That tolerance is
deliberate gate design: a gate that cries wolf gets bypassed, then deleted.

### `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` (Warning, §38.6.3, S290)
`schema-differ.js` `diffSchema` :916. On **SQLite**, which cannot change a constraint via `ALTER` at
all, reconciling requires the §38.6.3 full-table rebuild — destructive, refused by default. NOTHING
is applied for that column. **The load-bearing half is the REPORTING:** `commands/db-migrate.js`'s
`printPlan(plan, actualTableCount, warnings)` (:291) now filters for this code and, when present,
prints `plan: 0 statements — but N column(s) have constraint drift that was NOT applied. NOT up to
date.` An empty plan and a SUPPRESSED plan are different states, and printing them identically told
the operator the database matched the schema when it did not.

### `W-NAV-CHUNK-LOAD-FAILED` (Info, §20.8.2/§20.8.7, navigate-wave1c) — now REAL
`compiler/src/runtime-template.js` `_scrml_nav_chunk_failed(path, token, url, reason)` (:2660-2667).
A cross-chunk soft navigation targeted a route whose client chunk is not in the live document and
that chunk could not be loaded — a network/`onerror` failure, or the `_SCRML_NAV_CHUNK_TIMEOUT_MS`
budget elapsed. The runtime falls back to a HARD navigation rather than swapping in markup it cannot
wire (the route's reactive wiring ships in the chunk that failed, so a swap would render
correct-looking but completely inert content). **A failure arriving AFTER a newer navigation
superseded this one bails SILENTLY** — no log, no hard-nav; the newer navigation owns the outcome
(last-nav-wins, §20.8.5). **This is a RUNTIME diagnostic emitted inside the generated app**, not a
compile-time one — it never appears in `result.errors`/`result.warnings`, so a compiler test cannot
assert on it; the browser suite (`compiler/tests/browser/browser-navigate-cross-chunk.test.js`) and
`compiler/tests/conformance/conf-NAV-CROSS-CHUNK.test.js` are the coverage.

### CHANGED — `E-PA-002`'s message leads with the `scrml db-migrate` remedy (S292, not a new code)
`compiler/src/protect-analyzer.ts:828-840`. The message now opens with *"First remedy: declare
`<tables>` in a `<schema>` block, then run `scrml db-migrate . --db <dbPath>` to create it. The
compiler generates that DDL from your `<schema>` — do NOT hand-write the schema or rebuild it by
hand against `bun:sqlite`."* The two prior branches (driver-URI `src=` vs file `src=`) survive
verbatim but are demoted behind "Otherwise". **Why this is a diagnostic-QUALITY fix and not
cosmetics:** the old message's only actionable advice was "add a CREATE TABLE statement", which
taught adopters to hand-build a schema the compiler already generates. Test:
`compiler/tests/unit/e-pa-002-db-migrate-remedy.test.js`.

### CHANGED — the `outline-*` Tailwind family stops false-firing (D-3, not a new code)
`compiler/src/tailwind-classes.js` NEW `registerOutline()` (:629-690), called from the registry
bootstrap. The WHOLE family was absent, so every real `outline-*` utility false-fired
`W-TAILWIND-UNRECOGNIZED-CLASS`. `outline-none` is the one adopters hit constantly (the standard
companion to a custom ring focus treatment: `focus:outline-none focus:ring-2`), and **a
typo-detector that cries wolf on a real utility teaches adopters to ignore it** — which is why this
is filed as a diagnostic bug, not a feature gap. Only the ARBITRARY forms (`outline-[2px]`,
`outline-offset-[3px]`) resolved before, and those come from the arbitrary-value property map, not
named registration.

**v3-vs-v4 semantics are load-bearing here.** This engine is Tailwind v3 throughout (bare `ring` is
3px; gradients are `bg-gradient-to-*`). v3: `outline-none` = the TRANSPARENT-outline trick
(`outline: 2px solid transparent; outline-offset: 2px` — which stays visible under forced-colors /
Windows High Contrast), and bare `outline` = `outline-style: solid`. v4: `outline-none` =
`outline-style: none`, and the trick moved to `outline-hidden`. **Emitting v4's `outline-style:
none` here would silently delete an accessibility affordance v3 authors rely on**, so v3 it is, and
`outline-hidden` is deliberately NOT registered. Test:
`compiler/tests/unit/tailwind-outline-family.test.js`.

## Prior window (`f8a138e9` -> `c700c435`, S288/S289) — carried, still current

**`E-SCHEMA-010`** (Error, §39.5.8) — a `oneOf([…])`/`notIn([…])` item on a `<schema>` column that is
not a scrml literal, in practice a bare identifier `oneOf([user, admin])`. A bareword lowers to a SQL
IDENTIFIER and fails at `db-migrate` apply with `column "user" does not exist`. RULED S288 (option
b): reject rather than widen a bareword into a string. Fires from `gauntlet-phase1-checks.js`'s
`checkSchemaDeclarations` via `findNonLiteralSetItems` (`schema-differ.js`).

**`E-MATCH-INVALID-ARM`** (Error, §18.0.1) — a tag opener at a block-form `<match>` arm position that
is neither a variant-named arm nor the wildcard `<_>` (the Ghost-Pattern `<when is="…">`). Previously
skipped as "stray content between arms", yielding ZERO recognised arms -> the match tree-shook to
nothing -> a DEAD PAGE with 0 errors. Fires from `match-statechild-parser.ts`'s `parseMatchArms`
(Phase-2 tokenizer). The fix skips the stray element as a UNIT. Residual:
`g-match-nofor-block-form-skips-exhaustiveness` (MED, open).

**Not a new code — `W-DEAD-FUNCTION` Trigger-6 clarified (§12.2).** A first-class function reference
(passed as an argument, assigned, stored) keeps a function reachable, and reachability DESCENDS into
nested closure bodies. Closes a false positive in the diagnostic walk (`route-inference.ts`); the
tree-shaker already retained these values.

## Prior window (`a0344d75` -> `f8a138e9`, S287) — §14.8.11 DB-authoritative tier, carried

- **`E-DBAUTH-SQLITE`** — a `db-authoritative` table OR a SECURITY-DEFINER `fn` resolves to a
  non-Postgres driver. Fires at BOTH compile (`codegen/index.ts` `annotateDbScopes`) and deploy
  (`commands/db-migrate.js`). A silent degrade to the §14.8.10 egress floor is the exact "looks
  enforced and isn't" trap.
- **`E-DBAUTH-NO-TENANT-COLUMN`** — a `db-authoritative` table declares no `tenant_id`. Pre-flighted
  in `runDbMigrate` BEFORE touching the DB. Its originally-reported false positive was tried at 9
  shapes and NOT REPRODUCED (S288).
- **`W-DBAUTH-MARKER-NEARMISS`** — a `db-authoritative`-LIKE token not recognized as the opt-in
  marker (must be the exact lowercase bareword immediately after the table's closing `}`). Fires in
  `codegen/db-authoritative.ts`'s `extractDesiredSchema`; `db-migrate` also ECHOES the recognized set.
- **`W-SCHEMA-DESTRUCTIVE-DROP`** — the never-clobber fence: a bare `DROP TABLE` for an
  actual-but-not-desired table is refused by default (a Postgres DROP CASCADE-drops the attached RLS
  policy/grants/role membership). `--allow-destructive` opts in and then ALSO fires `W-SCHEMA-002`.

## Earlier windows — condensed

`E-SCRIPT-001` (§4.17, #127) at `block-splitter.js:3498`, mirroring the `<style>`/E-STYLE-001 branch;
**native-parser parity: CONFIRMED GAP** (`parse-markup.js:983-995` has the `<style>` mirror and no
`<script>` counterpart) — see non-compliance.report.md. `E-CELL-RENDER-SPEC-NOT-BINDABLE` RELOCATED
use-site -> declaration (SYM PASS 5a, #128). `E-OUTLET-*` collector widened to a total walk (#126/#128).
`E-OUTLET-AND-MAIN` (§20.8.1.1, #124), the §14.8.10 tenant family (#117/#118),
`I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (§52.15.5, #120), `E-ERROR-010` (§19.5.4, #121),
`E-ATTR-WRITER-CONFLICT` (§5.5.3/§5.5.4, #81), `E-SCOPE-012`/`E-SESSION-*` (§20.5),
`E-THEME-TOKEN-UNKNOWN` (§65.3.2) — all in the family table above; per-fire-site line numbers for
those windows are not re-verified at this HEAD.

## sql-lex (§52.15.5) — a shared LIVE/INERT `${}` classifier, not a code
`compiler/src/codegen/sql-lex.ts` is the SINGLE source of truth for which `${…}` interpolations in a
`?{}` body are LIVE (code context) vs INERT (inside a string literal, `""`-quoted identifier, `E'…'`
escape string, `$tag$…$tag$` body, or `--` / nested `/* */` comment). ONE scanner feeds BOTH the
CLASSIFIER (`collect.ts`) and the param EMITTER (`rewrite.ts extractSqlParams`), so the two cannot
disagree. Exports `liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation`.
Known low-sev hardening: the `E'…'` branch assumes Postgres while the default db is SQLite
(`g-ssr-auth-scoped-hardening-trio` finding 2).

## sql-table-refs (§14.8.11, NEW S292) — a bounded scanner, not a code and not a parser
`compiler/src/sql-table-refs.js` extracts the table identifiers a `?{}` body references, paired with
the PRIVILEGE each reference implies. **Its contract is two-valued and the second value is the
load-bearing one:** `{tables, privileges, undetermined}`. A caller MUST NOT treat an empty `tables`
as "touches nothing" — `commands/db-migrate.js` prints an explicit operator warning naming every
`undetermined` fragment, because an unreported miss re-creates
`g-dbauth-migrate-no-grants-for-unmarked-identity-table` on a different table and fails CLOSED at
runtime as an opaque `permission denied`. Not itself a diagnostic (no §34 row).

## semdiff (#6b P0) — a diagnostic-CONSUMING classifier, not a code
`compiler/src/semdiff.ts` `classifySemdiff(base, head)` classifies a change by AXIS
(`opaque`/`source`/`use-site`/`context`) + soundness TIER (`0` proven cosmetic / `2` behavioral),
never a boolean "safe". One of its three P0 signals is a use-site diagnostic-set diff
(`diffDiagnostics`) — a diagnostic that appears/disappears between versions is a Tier-2 `use-site`
axis. Exposed as `scrml semdiff`.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:2001 | AST builder — carries `tabSpan`, lifted to `.span` in api.js since S294 |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

`schema-differ.js` / `commands/db-migrate.js` / `codegen/db-authoritative.ts` / `codegen/sql-ident.ts`
/ `sql-table-refs.js` / `tailwind-classes.js` declare NO Error class. `schema-differ.js` returns
`{sql, warnings}` structurally; `db-migrate.js` reports via `console.error` + `process.exit(1)` (a
CLI, not a pipeline stage feeding `collectErrors`) and since S288 attaches
`e.scrmlFailedStatement = {index, total, sql}` to a per-statement throw, echoed by
`printFailedStatement`. `tailwind-classes.js` returns `{error: {code, reason}}` objects.
`match-statechild-parser.ts` returns a `diagnostics` array on its `MatchParseResult`.

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError,
NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}`
error-handling / failable-fn machinery — not this compiler's own error handling.

**Also runtime-side (this window):** `_scrml_error_boundary_log("on mount", err)` is the `.catch(…)`
sink the GH #237 `on mount` async wrap attaches, so a rejected server call in a mount block surfaces
instead of becoming an unhandled rejection.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error`; `compiler/src/api.js` wraps each stage
call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into
`{code, message, severity, stage, …}`, lift `bsSpan`/`tabSpan` to `span`, stamp `filePath`, and
partition the error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?`
propagation (ErrorArm/FailExprNode/PropagateExprNode — see schema.map.md) lowered to try/catch
envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — the scrml-level component error boundary; ast-builder.js recognizes it
as a structural element and codegen/emit-error-boundary.ts emits the boundary wiring (re-parsing via
block-splitter/ast-builder). **`<errors of=…/>` is ALSO a runtime-chunk trigger** — its wiring
references `_scrml_message_for` from the `messages` chunk as a VALUE, which is why GH #234 needed a
POST-EMIT reference gate in `emit-client.ts` rather than a pre-emit AST gate. See
dependencies.map.md's "Runtime-chunk gating" section.

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md`.

## Tags
#scrml #map #error #diagnostics #routing #semdiff #css65 #diagnostic-partition #result-warnings #lint-diagnostics #tab-span-lift #outlet #tenant-floor #ssr-auth-scoped #sql-lex #sql-table-refs #catalog-count-audit #catalog-vs-impl #w-lint-uncatalogued #dbauth #e-dbauth-sqlite #e-dbauth-no-tenant-column #w-dbauth-marker-nearmiss #w-schema-destructive-drop #db-migrate #rls #secdef #e-cg-018 #w-each-bind-item-field-deferred #e-schema-010 #e-schema-011 #w-schema-constraint-tightened #w-schema-constraint-drift-unapplied #w-nav-chunk-load-failed #navigate-wave1c #e-match-invalid-arm #ghost-pattern #w-dead-function #e-pa-002 #protect-analyzer #tailwind #w-tailwind-unrecognized-class #e-tailwind-001 #outline-family #w-server-import-unemitted #dist-space #d4 #on-mount #gh237 #gh234 #messages-chunk

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
- [non-compliance.report.md](./non-compliance.report.md)
