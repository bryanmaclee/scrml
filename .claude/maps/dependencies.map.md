# dependencies.map.md
# project: scrml
# updated: 2026-07-26T07:00:00Z  commit: f8a138e9

## Runtime Dependencies — root package.json (v0.7.1)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for the scrml MCP integration
pg@^8.22.0 — bundled Postgres client; drives §38.13 realtime LISTEN bridge + `scrml introspect`
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Runtime Dependencies — compiler/package.json (compiler workspace, v0.2.0)
acorn@^8.16.0 — JS parser for escape-hatch (`_{}`) expressions + the E-CG-001 acorn-exact egress scan + the chunk-namespace cell-accessor-rename pass
astring@^1.9.0 — JS AST-to-source printer, paired with acorn for re-serializing escape-hatch nodes

## Dev / Build Dependencies — root package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for browser-suite Bun tests
happy-dom@^20.8.9 — fast in-process DOM used by compiler/tests/browser
@playwright/test@^1.49.0 — Playwright e2e framework (e2e/)
marked@^14.1.3 — Markdown parser used by docs/build.ts
puppeteer@^24.40.0 — headless browser support for e2e/docs tooling

## Dev Dependencies — compiler/package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for compiler-workspace browser tests

## Editor-tooling Dev Dependencies — editors/vscode/package.json
vscode-textmate, vscode-oniguruma — bundled TextMate-grammar test harness (tokenize.js / regression-scan.js); not part of the compiler pre-commit gate, needs its own `npm i`.

## CI-only External Actions (not npm deps — GitHub Actions)
actions/checkout@v4/v6, oven-sh/setup-bun@v2, anthropics/claude-code-action@v1 — see build.map.md / infra.map.md for CI wiring; anthropics/claude-code-action needs the `ANTHROPIC_API_KEY` repo secret to activate.

## Runtime Engine
bun>=1.3.13 — required; no Node support (Bun-specific APIs used throughout: Bun.serve, bun:sqlite, Bun.$, Bun.SQL). **The DB-authoritative tier (below) is the first surface to depend on `Bun.SQL`'s transaction API (`sql.begin(async (tx) => …)`) and `bun:sqlite`'s `Database` for the `scrml db-migrate` apply loop** — both already-bundled Bun APIs, so this adds ZERO new external dependency.

No dependency-manifest change at this HEAD — root `package.json` and `compiler/package.json` are untouched by every landing in this window, including the S287 DB-authoritative tier (M1 reads/M2 apply-seam/P2 writes): it is entirely first-party (`Bun.SQL`/`bun:sqlite`, already-bundled) and adds ZERO external dependency. The chunk-namespacing BUG-6 arc (prior window) likewise added none.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,**db-migrate**,promote,generate,init,introspect,semdiff}.js — **11 verbs** (was 10; `db-migrate` NEW S287, see below) |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen. Carries the GITI-038/039 `return-stmt.fnExprNode` structural parse + `joinWithNewlines` span-adjacency rejoin (see schema.map.md). |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js |
| Tag-canonicalize (Stage 3.055 TC) | tag-canonicalizer.ts | landmark-tag.ts + api.js — a capitalized tag (`<Button>`) emits what the §15.X registry resolved it to (§4.2/§4.3 casing-irrelevant). |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts. `substitutePropsInLogicStmt`/`expandComponentNode` carry the GITI-038 fnExprNode + #81 `_componentPropNames` work. |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001). `collectFunctionNodes`/`walkBodyForTriggers` descend into `fnExprNode` (GITI-038); `AuthMiddleware.sessionSecure?` (§20.5.1). |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts. `annotateNodes` binds the `session` server builtin (§20.5, E-SCOPE-012). The SSR auth-scoped omission LINT fires `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` off the shared `codegen/sql-lex.ts` row-scope predicate (§52.15.5, #120). `E-ERROR-010` dedicated (#121). |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen. **symbol-table.ts PASS 15.5 owns the `<outlet>` placement pass** (E-OUTLET-OUTSIDE-SHELL / E-OUTLET-DUPLICATE / E-OUTLET-AND-MAIN). |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts (client, server, html, css, each, match, engine, ssr, channel, worker, functions, validators, library, table-for, form-for, tool, test, theme-reset, async-combinators). **Also decides `E-DBAUTH-SQLITE` at compile time** (`annotateDbScopes` driver-resolution stage) for a `db-authoritative` table or a SECDEF `fn` on a non-Postgres target. |
| **DB-authoritative tier — §14.8.11/.1/.2, NEW S287 (M1 reads / M2 apply-seam / P2 writes)** | `schema-differ.js` (`parseSchemaBlock` — brace-depth-aware, returns `{tables, fns}`; `parseColumns`'s `immutable` keyword; `generateDbAuthoritativeDDL` S1 RLS + S6 role + S3 column-scoped GRANT reshape; `generateSecdefDDL` + `generateScrmlHasCapDDL` S4 SECDEF choke; the `allowDestructive` never-clobber fence in `diffSchema`) + `codegen/db-authoritative.ts` (NEW file — `appDeclaresDbAuthoritative`, `wrapPrincipalTxn` the A1/S2 per-request principal-txn wrapper, `extractDesiredSchema` the migration-apply desired-state seam) + `codegen/sql-ident.ts` (NEW file — `quoteIdent`, the sole safe SQL-identifier escaper) + `codegen/tenant-egress.ts` (extended: `_scrml_active_tenant`/`_scrml_active_caps` server-resolved principal resolvers, part of `SERVER_TENANT_HELPER`) + `compiler/src/commands/db-migrate.js` (NEW file — the `scrml db-migrate` CLI) | `codegen/index.ts` :4663-4672 wires `appDeclaresDbAuthoritative`/`wrapPrincipalTxn` into `emit-server.ts`'s `generateServerJs`; `emit-channel.ts` also imports `quoteIdent` (aliased `pgQuoteIdent`) for channel-DDL identifier safety. See error.map.md (E-DBAUTH-*/W-DBAUTH-*/W-SCHEMA-DESTRUCTIVE-DROP), domain.map.md (§14.8.11 concept), schema.map.md (`TableDecl`/`SecdefFnDecl` codegen-internal shapes), build.map.md (`scrml db-migrate` flags). |
| Confidentiality — tenant-row floor (#117/#118, §14.8.10) | codegen/tenant-egress.ts (`buildTenantContext`, `resolveTenantScoping`, `classifyTenantWrite`, `detectTenantRawEgress`, `rewriteSelectAddTenantId`, `rewriteInsertAddTenantId`, **+ `_scrml_active_tenant`/`_scrml_active_caps`, NEW S287**) | consumed by codegen/emit-server.ts: E-TENANT-WRITE/AGG/RAW-EGRESS hard-fails + I-TENANT-STRIP/ACROSS. The ROW-level twin of protect-egress.ts (§14.8.9 column floor). `_scrml_active_tenant`/`_scrml_active_caps` are the SAME server-resolved-principal helpers the DB-authoritative A1 wrapper (`wrapPrincipalTxn`) injects into the reserved txn — one principal, two consumers. See error.map.md + domain.map.md. |
| Client Router — landmark + shell composition (§20.8.1.1/§40.8.2) | codegen/emit-html.ts (`treeHasAuthorMain`) + codegen/index.ts (`findOutletMarkedOpenTag`/`findBareMainOpenTag` slot detection, `retagOpenTag`, `findMatchingCloseIdx`) | TWO STAGES, one invariant, communicating ONLY through the emitted `data-scrml-outlet` marker. See domain.map.md. |
| SSR auth-scoped omission + SQL-interp classifier (#120, §52.15.5) | codegen/sql-lex.ts (`liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation`) | the SINGLE LIVE-vs-INERT `${}` classifier, imported by codegen/collect.ts AND codegen/rewrite.ts so they CANNOT diverge; the omission itself is emitted in type-system.ts (the lint) + codegen/emit-server.ts (the SSR-seed drop + per-cell /__mountHydrate gate). |
| Colorless-async classification | codegen/emit-library-shared.ts (`computeAsyncFnNames`, `computeNestedAsyncFnHolders`), codegen/scheduling.ts (`buildCalleeImportMap`, `injectPromiseAwait`), codegen/emit-expr.ts (`setServerAsyncClassifier`, `clientAsyncFnNames`) | emit-library.ts, emit-server.ts, emit-tool.ts, emit-logic.ts, emit-control-flow.ts, emit-functions.ts — see "Colorless-async" section below |
| Batch-hoist / server-call fencing (§19.9.9.2) | codegen/emit-server.ts + codegen/scheduling.ts | full control-transfer set + filler-distance across control-flow guards; a client side-effect between two server calls is a batch boundary. |
| Reactive value= form-control write | codegen/emit-bindings.ts | a reactive `value=` on a form control writes the `.value` PROPERTY (not the attribute). |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission | codegen/emit-css.ts (`generateCss`, invoked from codegen/index.ts), codegen/emit-theme-reset.ts | §65 Wave-1: built-in `@layer reset`, `:where()`-flat, `<theme>` token→`:root` lowering; the §65.6 runtime theme-switch reflection is emitted in emit-client.ts (`emitThemeSwitchReflection`) |
| CSS conflict check | codegen/css-conflict-check.ts | run post-CE at api.js Stage 3.4 over `collectCssBlocks`; emits E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Reactive-attr writer-ownership (#81) | codegen/emit-html.ts (`analyzeWriterConflict`) | detects two writers on ONE physical DOM surface and emits `E-ATTR-WRITER-CONFLICT`, or a `LogicBinding` with `isReactiveValueAttr`/`valueAttrName`/`valueAttrKey` (codegen/binding-registry.ts) when there is no conflict |
| Session establishment | compute-program-config.ts, route-inference.ts (`AuthMiddleware.sessionSecure`), codegen/emit-server.ts, codegen/emit-expr.ts | §20.5 `session.*` server builtin — see auth.map.md |
| Content-hash asset naming | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` (cache-header policy); see build.map.md |
| Validate emit | codegen/validate-emit.ts | final artifact sanity (single-JS-expression checks etc.) |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution. `serializeNode`'s return-stmt case serializes `fnExprNode` (GITI-038). |

## §14.8.11 DB-authoritative tier — the `scrml db-migrate` command graph (NEW S287)

`commands/db-migrate.js`'s `runDbMigrate(args)` is the CLI entry: `parseArgs` (`--db`, `--dry-run`,
`--allow-destructive`, exported for unit tests) -> `parseProjectSchema` (reuses the live parse
pipeline `splitBlocks`->`buildAST`, then `extractDesiredSchema` per file, merging tables/fns
first-decl-wins) -> the `E-DBAUTH-SQLITE` / `E-DBAUTH-NO-TENANT-COLUMN` pre-flights -> either
`runPgApply` (Postgres: `pg_advisory_xact_lock` -> ensure the `_scrml_migrations` ledger DDL ->
`readActualSchemaPg` + a narrow `pg_policies`/`pg_roles` presence read -> `diffSchema({driver:
"postgres"})` -> apply each statement in ONE txn, recording `{object_kind, object_name, ddl_hash}`
via `classifyStatement` — a statement failure rolls the WHOLE txn back) or `runSqliteApply`
(general `<schema>`-apply, no roles/policies, one txn — Fork 5, "finally makes `<schema>` do
something at deploy for every adopter"). `classifyStatement` (exported for unit tests) coarsely
names an applied DDL statement's `{kind, name}` for the ledger row (table/policy/function/role/
grant/revoke/alter/drop-policy/drop-table).

`schema-differ.js`'s `parseSchemaBlock` is the SHARED parser both `db-migrate` (via
`extractDesiredSchema`) and the pre-existing SQLite migrate path consume — brace-depth-aware
(`findSchemaBlockEnd` skips `"""…"""`-quoted plpgsql bodies so a P2 `fn`'s `IF…END IF` braces don't
truncate a table scan), returns `{tables, fns}` (the `fns` array is ADDITIVE — empty for a schema
with no `fn`, so all five pre-existing consumers of `.tables` are unaffected: protect-analyzer.ts,
channel-watches.ts, gauntlet-phase1-checks, codegen/index.ts, db-authoritative.ts).

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| codegen/db-authoritative.ts (NEW S287) | §14.8.11 M1/P2 server-emission: `appDeclaresDbAuthoritative(fileAST)` — the conditional-engagement gate (an app with ZERO `db-authoritative` tables emits byte-identically); `wrapPrincipalTxn(src)` — the A1/S2 SCOPE-AWARE hot-path transform, rewriting a `_scrml_sql`/`_scrml_sql_<n>` query site into a `.begin(async (tx) => …)` transaction that pins `scrml.tenant` + `scrml.principal.caps` (`set_config`, txn-scoped) then `SET LOCAL ROLE scrml_app`, ONLY inside a lexical scope where `_scrml_req` is bound (tracked via a brace-scope stack, not a name-blacklist — so a module-level infra helper like `_scrml_idempotency_ensure_table` is never wrongly wrapped); `extractDesiredSchema(fileAST)` — walks every `<schema>` block, merges tables+fns, and detects `W-DBAUTH-MARKER-NEARMISS`. Imported by codegen/index.ts (wired into emit-server.ts's `generateServerJs`) and commands/db-migrate.js. |
| codegen/sql-ident.ts (NEW S287) | `quoteIdent(name)` — doubles an embedded `"` (`a"b` -> `"a""b"`), the ONLY safe way to interpolate a table/column/constraint name into emitted DDL. Security-critical: `readActualSchemaPg`/`readActualSchema` read names from the LIVE database (introspection), which an attacker who can influence the schema controls — `db-migrate` runs the resulting SQL as the MIGRATOR (most-privileged principal). Imported by schema-differ.js and codegen/emit-channel.ts (aliased `pgQuoteIdent`). |
| schema-differ.js (extended S287) | Was §38.6 SQLite-only migration-SQL differ; now ALSO the desired-vs-actual Postgres differ + the DB-authoritative DDL emitter. NEW exports: `DBAUTH_ROLE` ("scrml_app"), `DBAUTH_POLICY` ("scrml_tenant_iso"), `DBAUTH_TENANT_GUC` ("scrml.tenant"), `DBAUTH_CAPS_GUC` ("scrml.principal.caps"), `generateBoundedRoleDDL`, `generateDbAuthoritativeDDL(table)` (S1 RLS+policy + S6/S3 GRANT — byte-identical to M1 when zero columns are `immutable`), `generateScrmlHasCapDDL()` (the `scrml_has_cap(text)` read helper, emitted once when any `fn` is declared), `generateSecdefDDL(fn, dbAuthTables)` (the hardened SECURITY-DEFINER emitter: bounded NOLOGIN owner role, `SET search_path = pg_catalog, public`, `REVOKE EXECUTE FROM PUBLIC` + `GRANT … TO scrml_app`), `readActualSchemaPg`/`readTableNamesPg` (async Postgres introspection, pre-existing), `emitScrmlSchemaSource` (pre-existing, `scrml introspect`'s self-verifying emit). `diffSchema`'s new `options.allowDestructive` fence (default false) suppresses a bare `DROP TABLE` for an actual-but-not-desired table (`W-SCHEMA-DESTRUCTIVE-DROP`) — Postgres DROP CASCADE-drops attached RLS/grants. |
| codegen/chunk-namespace.ts | per-compilation-unit namespace for the runtime-global token space (N1 node-ids / N2 cell-keys / N3 type-names / N4 engine-names). Owns the module-level state + `nsId`/`nsName`/`nsCellKey`/`stripNsName`, the `fnv1aHash`-of-project-relative-path token (`chunkNamespaceToken`), the project-root walk (`resolveProjectRoot`), the cross-file cell owner map (`buildCellOwnerMap`), and the D2 distinctness guard (`assertChunkTokensDistinct` — a hard error, not `E-CG-010`). Imported ONLY by codegen/index.ts + the emit sites that call `nsId`. |
| codegen/cell-accessor-rename.ts | `renameCellAccessors` — the Acorn-parse + range-SPLICE pass that rewrites every cell-accessor CALL in the assembled chunk body to its `_scrml_cs_` chunk-local wrapper. Only the callee moves; the store-key argument stays byte-identical. The SOLE producer of `_scrml_cs_*` — no emitter emits it. `CS_PREFIX`, `AccessorRenameResult{code,used,valueReferences}`. Imported ONLY by codegen/index.ts. |
| codegen/fnv1a-hash.ts | the shared FNV-1a 32-bit -> 8-char base36 primitive (§47.1.3 normative). Three call-site classes: §47.1.2 per-binding type-encoding, §47.5 per-chunk content-address, and the chunk-NAMESPACE token — the only site that enforces token distinctness. Every token starts with `0`. |
| codegen/sql-lex.ts (#120) | pure SQL-lexer-grade LIVE-vs-INERT `${}` classifier (§52.15.5). One function feeds BOTH `collect.ts` and `rewrite.ts` so a `${}` the classifier ignores is the SAME `${}` the emitter does not bind. |
| codegen/tenant-egress.ts (#117/#118, extended S287) | the §14.8.10 tenant-row isolation floor — the ROW-level twin of protect-egress.ts (§14.8.9). Consumed by codegen/emit-server.ts. NOW ALSO owns `_scrml_active_tenant`/`_scrml_active_caps` (part of `SERVER_TENANT_HELPER`) — the server-resolved principal resolvers §14.8.11.2's A1 wrapper injects into the GUC-pinning txn. |
| codegen/index.ts (= code-generator.js) | the codegen dispatcher AND the owner of the chunk-namespace WIRING AND §40.8.2 multi-file shell composition AND (S287) the `E-DBAUTH-SQLITE` compile-time driver-resolution gate (`annotateDbScopes`) AND the `appDeclaresDbAuthoritative`/`wrapPrincipalTxn` call sites (:4663-4672, feeding emit-server.ts's `generateServerJs`). |
| codegen/emit-html.ts | markup emission; owns `analyzeWriterConflict` (#81, E-ATTR-WRITER-CONFLICT) and the §20.8.1.1 landmark decision (`treeHasAuthorMain`). |
| codegen/emit-channel.ts | §38 realtime channel emission; imports `quoteIdent` (S287, aliased `pgQuoteIdent`) for identifier-safe channel-trigger DDL. |
| codegen/emit-bindings.ts | event/logic binding emission; a reactive `value=` on a form control writes the `.value` property. |
| codegen/reactive-deps.ts | cross-cutting reactive-cell/request/set/map dependency collectors, consumed by most emit-*.ts |
| codegen/collect.ts | FileAST-shape collectors; imports `sql-lex.ts` for the §52.15.5 row-scope predicate + the GITI-038 fnExprNode descent + the #98 `collectCssVariableBridges` :root retarget. |
| codegen/rewrite.ts | imports `sql-lex.ts` — `extractSqlParams` binds `$N` params off the SAME live-interpolation set the classifier uses. |
| codegen/emit-theme-reset.ts | §65 CSS Wave-1 EMISSION half (the §65.2 conflict-CHECKER stays in css-conflict-check.ts). Imported by emit-css.ts, emit-html.ts, emit-client.ts, codegen/collect.ts. |
| codegen/async-combinators.ts | pure async-combinator classification + runtime-helper-block synthesis; imported by emit-library.ts only |
| codegen/binding-registry.ts | pure data registry for event/logic bindings, no imports. Carries (#81) `isReactiveValueAttr`/`valueAttrName`/`valueAttrIsFormValue`/`valueAttrKey` on `LogicBinding`. |
| codegen/log-loc.ts | source-location resolver, standalone |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`) |
| codegen/mcp-descriptors.ts | MCP tool descriptor synthesis (`buildMcpDescriptors`) |
| codegen/db-driver.ts | `resolveDbDriver(url)` — classifies a `--db`/`db=` connection string into `{driver: "postgres"|"sqlite"|"mysql", connectionString}`; consumed by db-migrate.js and codegen/index.ts's driver-resolution gate. |
| tag-canonicalizer.ts | Stage 3.055 TC — a capitalized tag emits its registry-resolved kind (§4.2/§4.3). Imported by landmark-tag.ts + api.js. |
| engine-statechild-grammar.ts | pure constants shared by type-system.ts + codegen (no cycle) |
| channel-watches.ts | shared §38.13 `watches=` schema/RowChange derivation, consumed by symbol-table.ts + type-system.ts |
| theme-body-parser.ts | §65 `<theme>`/`<defaults>` BODY-FORM parser (declaration side); emit-theme-reset.ts owns EMISSION |
| module-resolver.js | resolves `scrml:*` stdlib imports + relative imports; STDLIB_ROOT via `fileURLToPath`. Also consulted by chunk-namespace.ts `resolveExporterPath` for the cross-file cell owner map. |
| semdiff.ts | emit-identity Tier-0 compare; `canonicalizeChunkNamespaceToken` discovers each chunk-namespace token from its structural emission sites and replaces it with a stable placeholder, so two byte-identical programs at different paths are not flagged behavioral. |

## Colorless-async (Seam-A / Phase-2 combinators, GITI-037/GITI-038)

A plain (non-`?{}`) function calling a Promise-returning host primitive (`safeCallAsync`, a `scrml:auth`/`scrml:http` async export) — directly, transitively through a local peer, or as a returned closure — is compiler-classified `async` and auto-awaited; there is no `async`/`await` in scrml source (§13.1/§13.2). Landed in 3 units:

- **Seam-A Phase-1 (GITI-037 fix)** — unified the async classifiers onto `computeAsyncFnNames` (codegen/emit-library-shared.ts), closing 3 seed-holes. No-silent-leak backstop: a stdlib-async call in a non-awaitable position drains into a fatal `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`.
- **Phase-2 combinator transform (FORK 1)** — the async-aware collection-callback combinator rewrite. `codegen/async-combinators.ts`: `ASYNC_COMBINATOR_METHODS` (`some`/`every`/`find`/`filter`/`map`/`forEach`/`reduce`/`flatMap`; `.sort` fail-closed), `callbackReachesAsync`, `asyncCombinatorHelperBlock` (emits the on-use `_scrml_someAsync`… helpers as a module FOOTER). Consumed by `emit-library.ts`'s `withAsyncCombinators`.
- **GITI-038 fix — Q1/Q2 async-classification split.** `computeAsyncFnNames` gained a `guardNestedFnValues` param: Q1 (own-signature async) a nested closure's async call does NOT color its factory; Q2 (needs AST re-emission) `computeNestedAsyncFnHolders` identifies factories whose returned closure (`fnExprNode`) itself needs `async`+`await`. `emit-logic.ts`'s `return-stmt` case emits `fnExprNode` inline via the `function-decl` case.
- **i87 §13.2 position-invariant auto-await (#87)** — a server-fn/stdlib-async call one block deep inside an `if`/`else`/`for`/`while`/`do-while` body now gets its `await`. `EmitLogicOpts.awaitNestedPromises` gates `codegen/scheduling.ts`'s `injectPromiseAwait`, called from `emitLogicBody`.

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose {kind, isAsync} cannot be resolved FAILS CLOSED (defaults to async) instead of fail-open to sync — hardened after the 2026-07-11 jwt-auth-bypass regression. Unchanged.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5 provider sub-modules: discord/github/google/microsoft/pkce), path, process, random, redis, regex, router, store, test, time. Each ships BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Unchanged this window.

## Tags
#scrml #map #dependencies #module-graph #stdlib #chunk-namespace #cell-accessor-rename #cs-prefix #ns-token #fnv1a #iife-hoist #semdiff #css-conflict-check #pipeline #bun #acorn #sql-lex #tenant-egress #tenant-floor #ssr-auth-scoped #theme-reset #content-hash #css-wave1 #colorless-async #async-combinators #writer-ownership #bind-value #batch-hoist #session-establishment #outlet #one-landmark #shell-composition #e-outlet-and-main #esm-chunks #module-format #runtime-esm #emit-client-esm #each-fence #foster-safe #dep-script-depth #tag-canonicalizer #dbauth #db-migrate #db-authoritative #rls #secdef #quoteIdent #sql-ident #wrapPrincipalTxn #scrml-migrations-ledger #bun-sql #privilege-separation

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [migrations.map.md](./migrations.map.md)
