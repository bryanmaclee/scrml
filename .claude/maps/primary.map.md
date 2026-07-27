# primary.map.md
# project: scrml
# updated: 2026-07-27T11:15:00Z  commit: c700c435
# NOTE (S288/S289): INCREMENTAL wrap-time refresh, TARGETED to the schema/db-authoritative surface.
# This window (`f8a138e9` -> `c700c435`) is TWO independent lanes landing concurrently: (1) bryan's
# S288 schema-lowering + db-migrate hardening pass (oneOf/notIn + default() SQL-literal lowering,
# NEW E-SCHEMA-010, auto-immutable PK/tenant_id, db-migrate failing-statement attribution, the
# session-principal wiring fix); (2) Peter's adopter lane (#192 E-MATCH-INVALID-ARM ghost-pattern
# fix, #195/#200 W-DEAD-FUNCTION false-positive fix, #197 nested for-lift reconcile fix). Maps
# RE-VERIFIED and regenerated this pass: error, schema, migrations (full rewrites) + domain
# (two targeted corrections only — the rest of that file was NOT re-walked this window) + this file.
# structure/dependencies/build/test/config/auth/infra were NOT touched — carried at their prior
# stamps, honestly, per the Map Index below (an older-but-honest stamp beats a false
# "verified at HEAD"). For per-session history, see docs/changelog.md (NOT this file).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout — the §14.8.11 DB-authoritative tier depends on `Bun.SQL`'s transaction API (`sql.begin`) and `bun:sqlite`'s `Database` for the migration-apply loop, both already-bundled)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7053+** git-tracked files (not re-verified whole-repo this pass). `compiler/src/` **187** (143 .ts + 42 .js + 2 other, NOT re-verified this window — no file-count-affecting add/remove in this window's diff, only in-place edits to `schema-differ.js`/`gauntlet-phase1-checks.js`/`commands/db-migrate.js`/`codegen/emit-server.ts`/`codegen/tenant-egress.ts`/`match-statechild-parser.ts`/`route-inference.ts`/`emit-lift.js`); `compiler/tests/` **1258** `*.test.js` per `docs/FACTS.md` (was 1255 at `f8a138e9`; **+3 this window**: `compiler/tests/integration/schema-only-tenant-principal.test.js`, `compiler/tests/unit/g-match-invalid-arm-ghost-pattern.test.js`, `compiler/tests/browser/g-nested-for-lift-no-reconcile-on-cell-replace.browser.test.js`). All other subtree counts carried unchanged from the prior stamp.
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml`. No CI-stage change this window.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`).
It is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of
those figures in a doc — cite FACTS.md.** This window: `live compiler source` 229,137 -> **229,952**
lines; `test files` 1,255 -> **1,258**; `specification lines` 36,559 -> **36,575**. Conformance
cases (746), stdlib modules (21), CLI verbs (11) unchanged. **FACTS.md deliberately does NOT publish
a §34 diagnostic-code total** — it states the figure "is load-bearing but not reliably extractable…
a wrong number is worse than an absent one." error.map.md carries the reconciled count instead (795
as of this window), with its own re-derivable `comm`-set-diff methodology and a documented `grep -oP`
tooling caveat (see error.map.md's catalog intro).

## Landings folded in THIS window (`f8a138e9` -> `c700c435`, S288/S289)

**Lane 1 — bryan, S288: schema-lowering + db-migrate hardening (the RediLedger S4/S5 adopter-report
arc).** All in `schema-differ.js` unless noted:
1. **`oneOf`/`notIn` SQL-literal lowering (#191, `103051ad`).** A `oneOf([…])`/`notIn([…])` item was
   previously passed VERBATIM into the SQL `IN (…)` clause; since scrml's canonical string quote
   (`"`) is SQL's IDENTIFIER quote, `oneOf(["income","expense"])` emitted an unquoted-identifier
   CHECK that failed at `db-migrate` apply with `column "income" does not exist`. NEW
   `lowerArrayLiteralToSqlItems`/`lowerArrayItemToSqlLiteral`/`splitTopLevelItems` lower every
   recognized item shape (either quote form, bare-variant `.Admin`, numeric, boolean) to its SQL
   literal, ALL-OR-NOTHING (any unrecognized item leaves the WHOLE list verbatim). §39.5.8 note
   corrected to match.
2. **`E-SCHEMA-010` (NEW §34 code, #196, `1a488c46`) — a bareword `oneOf`/`notIn` item is a compile
   error.** RULED S288 (bryan, option b): reject rather than widen a bareword into a string. Fires
   from `gauntlet-phase1-checks.js` via the NEW exported `findNonLiteralSetItems`. Closes
   `g-schema-oneof-bare-identifier-item`.
3. **`default(...)` balanced-capture + SQL-literal lowering (#196).** `default(now())` previously
   TRUNCATED the whole `CREATE TABLE` (the old `[^)]+` capture stopped at the first `)`); now a
   BALANCED scan via `findMatchingParen`. `default("US")` previously emitted the SQL IDENTIFIER
   `DEFAULT ("US")`; now routed through NEW `lowerDefaultToSql` (a non-literal, e.g. `now()`, STILL
   passes through verbatim — the deliberate opposite disposition from `oneOf`/`notIn`, because a
   `default()` argument is legitimately a SQL expression). Both fixes together un-blocked 7 of
   RediLedger's 10 real tables.
4. **`findMatchingParen` is now quote-aware, two-pass (#196).** A `)` inside a string ARGUMENT
   previously closed a predicate early, silently DROPPING the whole CHECK — now quote-aware first,
   with a quote-BLIND fallback (load-bearing: a `pattern(/o'brien/)` regex literal can carry an
   unpaired apostrophe, which a quote-aware-only pass would swallow).
5. **`scrml db-migrate` failing-statement attribution (#196).** Both apply loops now attribute a
   thrown error to its exact statement index + SQL text (`e.scrmlFailedStatement`), echoed by the
   CLI (`printFailedStatement`) — RediLedger burned a bisection cycle on an opaque Postgres error
   that pointed nowhere near its actual cause (S5 signal).
6. **Auto-immutable PRIMARY KEY + `tenant_id` (#199, `c700c435`, SPEC §14.8.11.2).** A
   `db-authoritative` table's PK and `tenant_id` are now treated as immutable to the bounded
   `scrml_app` role WHETHER OR NOT the author wrote the `immutable` bareword
   (`isEffectivelyImmutable`) — closes `g-dbauth-p2-pk-tenant-not-auto-immutable`. **SEMANTIC
   CHANGE, stated normatively:** the PRIOR guarantee "a `db-authoritative` table with ZERO
   `immutable` columns emits BYTE-IDENTICAL to M1" is **RETIRED** (such a table always has a PK, so
   it always takes the column-scoped grant path now). Non-`db-authoritative` tables unaffected.
7. **Session-principal wiring fix (#193, `d5bccc0f`, closes `g-dbauth-session-principal-not-wired`,
   was HIGH).** The tier was non-functional end-to-end for a `<schema>`-only app: `emit-server.ts`
   gained an `astSqlQueryUsesCurrentUser` walker (widens `_needsSessionInfra`'s gate to a THIRD
   shape — a plain server `function` reading `@currentUser` in `?{}`) plus a handler-scope-entry
   `_scrml_currentUser` binding splice; `tenant-egress.ts`'s `buildTenantContext` gained a second arg
   unioning the `<schema>`-declared tables, so a `<schema>`-only app's tenant floor actually engages.
   Both defects found by RediLedger's BEHAVIORAL (real PG16 + real cookie sessions) run, invisible
   to the tier's own hand-`set_config` tests. Regression lock:
   `compiler/tests/integration/schema-only-tenant-principal.test.js`.
8. Residual, still open: `g-schema-predicate-arg-parse-edges` (MED — `oneOf([])` empty-array emits
   invalid SQL; `escapeSqlString` doesn't escape `\`, latent MySQL-only), `g-dbauth-p2-caps-
   provenance` (MED, carried from S287), `g-dbauth-secdef-owner-crud-all-tables` (LOW, carried),
   `g-dbauth-no-request-path-test` (MED, NEW — emission-only lock, not a full HTTP round trip),
   `g-dbauth-docs-no-do-not-mark-users-example` (LOW, NEW — docs ask).

**Lane 2 — Peter, concurrent adopter fixes:**
1. **`E-MATCH-INVALID-ARM` (NEW §34 code, #192, `235f47c2`, SPEC §18.0.1).** A non-variant/
   non-wildcard tag opener at a block-form `<match>` arm position (the Ghost-Pattern
   `<when is="…">`) previously tree-shook the WHOLE match to zero recognized arms → a dead page
   emitted with 0 errors. Now a Phase-2 STRUCTURAL parse error in `match-statechild-parser.ts`'s
   `parseMatchArms`. Split off `g-match-nofor-block-form-skips-exhaustiveness` (MED, open, flagged
   for bryan — a no-`for=` block-form `<match>` still skips exhaustiveness entirely, a SPEC/impl
   divergence).
2. **`W-DEAD-FUNCTION` false-positive fix (#195/#200, `73e85e64`, SPEC §12.2 Trigger 6).** A
   first-class function reference (not a call) now correctly counts as reachable, and reachability
   descends into nested closure bodies. Not a new code; closes a diagnostic-walk under-count, no
   tree-shake/placement change.
3. **Nested `for … lift` reconcile-on-replace fix (#197, `52585b25`, closes
   `g-nested-for-lift-no-reconcile-on-cell-replace`, was HIGH, silent-correctness).** An inner
   Tier-0 for-lift whose iterable derives from an outer reconciled item was a one-shot
   creation-time loop; on the outer cell's REPLACE, index-keyed reuse skipped re-invoking the
   factory, so the inner list silently kept stale content. Fixed in `emit-lift.js`
   (`emitForStmtWithContainer`) — an inner for-lift now emits its own reactive re-resolving inner
   reconcile. Split off `g-item-derived-local-stale-in-per-item-effect-paths` (MED, open — the OTHER
   per-item effect wrappers, e.g. text bindings over a destructured local, share a narrower version
   of the same staleness).

**Maps re-verified this window:** error.map.md (diagnostic count 793 -> **795**, +`E-SCHEMA-010`
+`E-MATCH-INVALID-ARM`, zero retired), schema.map.md (the lowering-function inventory +
`isEffectivelyImmutable` + the retired byte-identity note), migrations.map.md (failing-statement
attribution + the resolved-gaps rewrite), domain.map.md (two targeted corrections only — the M1
mechanism note gained the session-principal-fix account, and the stale "Known open gaps" paragraph
was corrected; the REST of domain.map.md was not re-walked this window).

## Landings folded in a PRIOR window (`1c5c2aee` -> `f8a138e9`, S287) — still current surface, condensed
1. **§14.8.11 DB-authoritative security tier — the flagship, three milestones, one atomic arc.**
   An OPT-IN, per-table trust-boundary reversal: relocates scrml's isolation invariant (§14.8.10)
   INTO Postgres itself (row-level security), then — deliberately, owner-ruled — extends into
   scrml-authored AUTHORIZATION (column-level write grants, a SECURITY-DEFINER mutation choke).
   Stacks with, never supersedes, the existing §14.8.9/§14.8.10 confidentiality floors.
   - **M1 — reads-authoritative (`8d56c8de`, #183).** The `db-authoritative` opt-in marker; the
     `E-DBAUTH-SQLITE` compile-time fail-closed gate; the S1 RLS + S6 bounded-role DDL emitter
     (`schema-differ.js` `generateDbAuthoritativeDDL`); the A1/S2 per-request principal transaction
     wrapper (NEW `codegen/db-authoritative.ts` `wrapPrincipalTxn` — SCOPE-AWARE, tracks a
     `_scrml_req`-in-scope brace-stack so module-level infra helpers are never wrongly wrapped).
   - **M2 — the migration-apply seam, `scrml db-migrate` (`57789971`, #185).** NEW
     `compiler/src/commands/db-migrate.js` — the FIRST thing that actually APPLIES the M1 DDL to a
     live database. A privileged OUT-OF-APP CLI, never auto-apply-on-boot (the running app is, by
     construction, the bounded `scrml_app` role with no DDL rights). The thin `_scrml_migrations`
     ledger (apply-atomicity + object-authorship, not a versioned migration history); the never-
     clobber `--allow-destructive` fence (`W-SCHEMA-DESTRUCTIVE-DROP`); a `pg_advisory_xact_lock`
     for concurrent-migrator serialization. An adversarial-review-caught identifier-injection HIGH
     was fixed pre-merge — NEW `codegen/sql-ident.ts` (`quoteIdent`), now the SOLE safe way to
     interpolate a DB identifier anywhere in the pipeline.
   - **P2 — writes-authority (`1c8aef79`, #188).** Deliberately CROSSES the §14.8.10 "consume,
     never derive" firewall — scrml now computes an authorization decision, not just relocates an
     invariant. S3: a per-column `immutable` bareword, re-shaping the bounded role's table-level
     `GRANT` to a column-scoped one (auto-immutable PK/tenant_id + the retired byte-identity
     anti-regression are THIS window's S288 update, above — do not trust "byte-identical to M1" as
     current). S4: a co-located `<schema>` `fn … security definer owner(…)
     requires cap("x") { """plpgsql""" }` — the sole sanctioned mutation path for a
     revoked-from column, hardened as a CODEGEN INVARIANT (`SET search_path = pg_catalog, public` —
     a missing pin is a CVE-2020-25695-class privesc hole, not merely unenforced). The capability
     GUC `scrml.principal.caps`, read by ONE checked `scrml_has_cap(text)` helper. `tenant-egress.ts`
     gained `_scrml_active_tenant`/`_scrml_active_caps` (the server-resolved principal resolvers the
     A1 wrapper injects — shared with the pre-existing §14.8.10 floor).
   - **4 §34 codes landed this window:** `E-DBAUTH-SQLITE`, `E-DBAUTH-NO-TENANT-COLUMN`, `W-DBAUTH-MARKER-NEARMISS`,
     `W-SCHEMA-DESTRUCTIVE-DROP`. **+9 new test files** (2 conformance, 3 integration — live-PG
     skip-graceful, 4 unit). **Zero new external dependency** — entirely `Bun.SQL`/`bun:sqlite`,
     already bundled.
2. **Threshold + phasing ruled by bryan (S286), landed same session (S287) as three PA-driven
   dispatches** — each with its own `docs/changes/db-authoritative-{m1,m2,p2}/` BRIEF+PROGRESS
   archive (historical, out of content-mapping scope) and its own live-PG acceptance gate
   (skip-graceful when PG is unreachable, mirroring the pre-existing introspect-pg pattern).

## Landings folded in an EARLIER window (`a0344d75` -> `1c5c2aee`) — still current surface, condensed
1. **chunk-namespacing BUG-6 accessor-rename (#180, closes #27).** Two route chunks coexisting in
   one live document no longer clobber each other's runtime-global token space. NEW
   `codegen/chunk-namespace.ts` + `codegen/cell-accessor-rename.ts`. Zero new §34 codes (the token-
   collision guard `assertChunkTokensDistinct` is a hard error, explicitly NOT `E-CG-010`) — though
   the S287 count reconciliation surfaced that its §34 catalog ROW (`E-CG-018`) had never actually
   been counted; see error.map.md.
2. **Peter's adopter/codegen fixes #171-#175** (batch-hoist completion, client-side-effect batch
   boundary, no dead client destructure, reactive `value=` writes `.value`, per-item `bind:value`
   wiring inside `<each>` — the last of which added `W-EACH-BIND-ITEM-FIELD-DEFERRED`, likewise
   reconciled into the count that pass).
3. **Stage 3.055 Tag-Canonicalizer (#155).** NEW `tag-canonicalizer.ts`.
See prior map generations / `docs/changelog.md` for the full narrative on these three.

## Map Index

| Map                  | Stamp | Contents                                                      |
|----------------------|-------|-----------------------------------------------------------------|
| **error.map.md**      | **`c700c435`** | **795** §34 codes (+2: `E-SCHEMA-010`, `E-MATCH-INVALID-ARM`), both new fire sites' full narrative + a `grep -oP` tooling caveat + updated known-gaps cross-refs |
| **schema.map.md**     | **`c700c435`** | ~114 AST types/interfaces (unchanged) + the S288 `isEffectivelyImmutable`/lowering-function inventory (`lowerArrayLiteralToSqlItems`/`lowerDefaultToSql`/`findNonLiteralSetItems`/two-pass `findMatchingParen`) + the retired byte-identity note |
| **migrations.map.md** | **`c700c435`** | the `scrml db-migrate` desired-state model + NEW failing-statement-attribution section + the fully resolved/still-open known-gaps rewrite |
| **domain.map.md**     | **`c700c435`** | **TARGETED** — only the §14.8.11 M1-mechanism note (session-principal fix) + the "Known open gaps" paragraph were corrected this window; the rest of the file (language primitives, one-landmark, business invariants) was NOT re-walked |
| **primary.map.md**    | **`c700c435`** | this file |
| structure.map.md     | `f8a138e9` | directory layout, 5 entry points, 11 subcommands — NOT re-verified this window; no structural file add/remove in this window's diff |
| dependencies.map.md  | `f8a138e9` | 6 runtime + 6 dev deps, full module graph — NOT re-verified this window; zero new external dependency this window either |
| build.map.md         | `f8a138e9` | 13 npm scripts, 11 CLI subcommands, 2 CI workflows — NOT re-verified this window; no CLI-surface or CI change this window |
| test.map.md          | `f8a138e9` | bun:test, 9 categories, prior recount 1255 — NOT re-verified this window (this map's own count IS now stale: +3 test files landed this window, see Project Fingerprint above for the corrected FACTS.md figure) |
| config.map.md        | `f079d0a9` | 6 env vars, 3 config files — NOT re-verified; no env-var or config-file shape change (`--db` is a CLI flag, not an env var; GUC names are compile-time string constants) |
| auth.map.md          | `df2ac831` | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session builtin — NOT re-verified; the session-principal-wiring fix this window lives in `tenant-egress.ts`/`emit-server.ts`, mapped in domain.map.md/dependencies.map.md instead, matching the pre-existing §14.8.10 tenant-floor precedent (also NOT in auth.map.md) |
| infra.map.md         | `f079d0a9` | GitHub Actions CI, no Docker/cloud resources — NOT re-verified; no infra change this window |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature) |
| style.map.md         | absent (Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
| i18n.map.md          | absent (no locales/i18n dirs) |
| jobs.map.md          | absent (scrml:cron is a stdlib module FOR GENERATED APPS, not a job system this repo runs) |

An honest older stamp beats a false "verified at HEAD" — every row above is a decision, made
because no file changed this window touches that map's subject. **test.map.md is the one exception
worth flagging:** its own test-file counts ARE now stale (+3 this window) even though its stamp is
carried — a future pass should re-verify it, not treat the carried stamp as proof its numbers are
still right.

## Task-Shape Routing

| If your task is about… | Read |
|---|---|
| **the DB-authoritative security tier — RLS/roles/SECDEF/db-migrate/auto-immutable (ACTIVE SURFACE)** | domain.map.md (§14.8.11/.1/.2 concept + threat model + the S288 session-principal fix) + migrations.map.md (the apply model + failing-statement attribution) + dependencies.map.md (module graph) + schema.map.md (`TableDecl`/`ColumnDecl`/`SecdefFnDecl`/`isEffectivelyImmutable`/lowering functions) + error.map.md (the 6 codes total, incl. the 2 new this window) + build.map.md (`scrml db-migrate` flags) |
| **`oneOf`/`notIn`/`default()` SQL-literal lowering, or `E-SCHEMA-010`** | schema.map.md's "Literal-lowering functions" section + error.map.md's `E-SCHEMA-010` fire-site narrative + `docs/known-gaps.md`'s RESOLVED `g-db-migrate-check-constraint-oneof-pattern`/`g-db-migrate-default-emission`/`g-schema-oneof-bare-identifier-item` and the still-open `g-schema-predicate-arg-parse-edges` |
| **caps-provenance / the SECDEF cap gate** | `g-dbauth-p2-caps-provenance` in `docs/known-gaps.md` + `tenant-egress.ts`'s `_scrml_active_caps(req)` (dependencies.map.md) + the honesty-bar threat model in domain.map.md |
| **a `<match>` block-form arm that silently disappears / the Ghost-Pattern `<when>`** | error.map.md's `E-MATCH-INVALID-ARM` note + `docs/known-gaps.md`'s `g-match-nofor-block-form-skips-exhaustiveness` (the still-open no-`for=` exhaustiveness residual) |
| **`W-DEAD-FUNCTION` false positives / dead-code tree-shaking** | error.map.md's Trigger-6 note + `route-inference.ts` + SPEC §12.2 |
| **nested `for … lift` / each staleness on cell REPLACE** | `docs/known-gaps.md`'s resolved `g-nested-for-lift-no-reconcile-on-cell-replace` + the still-open `g-item-derived-local-stale-in-per-item-effect-paths` + `codegen/emit-lift.js` |
| **P3 integrity / double-entry / DEFERRED constraint triggers** | domain.map.md's §14.8.11.2 section notes S5 is a SEPARATE, not-yet-scoped P3 milestone — read the SPEC §14.8.11.2 cross-references first, there is no code yet |
| chunk namespacing / multi-chunk token isolation | `codegen/chunk-namespace.ts` + `codegen/cell-accessor-rename.ts` + `codegen/index.ts` (the wiring) — mapped in dependencies.map.md + structure.map.md |
| `<each>` codegen + the runtime list reconciler | `codegen/emit-each.ts` + `runtime-template.js` + `codegen/emit-ssr-render.ts` — mapped in dependencies.map.md + structure.map.md |
| chunk / module-format emit | `codegen/runtime-esm.ts` + `codegen/emit-client-esm.ts` + `codegen/index.ts` — mapped in dependencies.map.md + build.map.md |
| batch-hoist / server-call fencing (§19.9.9.2) | `codegen/emit-server.ts` + `codegen/scheduling.ts` |
| types / interfaces / AST node shapes | schema.map.md |
| diagnostic codes / error classes | error.map.md |
| environment variables / config keys | config.map.md |
| test patterns / fixtures | test.map.md (counts are stale — see the Map Index note above) |
| build commands / CI stages / CLI flags | build.map.md |
| DB migration / schema-apply / privilege model | migrations.map.md |
| public-claim gates (snippets, derived figures) | build.map.md (the three scripts + CI wiring); `docs/FACTS.md` is the figure authority |
| CI provider / deploy / docker / cloud | infra.map.md |
| directory layout / entry points | structure.map.md |
| external packages / module graph | dependencies.map.md |
| language primitives / SPEC navigation | domain.map.md |
| outlet / `<main>` landmark / MPA shell composition | domain.map.md (four-case table) + error.map.md (E-OUTLET-AND-MAIN) + dependencies.map.md |
| tenant-row isolation floor (§14.8.10) — the SAME-principal sibling of the DB-authoritative tier | domain.map.md + error.map.md (E-TENANT-*/I-TENANT-*) + dependencies.map.md (tenant-egress.ts, incl. this window's `buildTenantContext` second-arg union) |
| SSR auto-make-safe (§52.15.5) / sql-lex | domain.map.md + error.map.md + dependencies.map.md |
| colorless-async classification (Q1/Q2) | dependencies.map.md (mechanism) + error.map.md (E-ASYNC-STDLIB-IN-SYNC-CALLBACK + the discard-HOF narrowing) |
| content-hash / cache-header build contract | build.map.md (mechanism) + domain.map.md (§47.9.8 concept) |
| auth flows / JWT / OAuth / protect-floor / session builtin | auth.map.md |
| non-compliant / stale docs | non-compliance.report.md |

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (**11 subcommands**); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **The DB-authoritative security tier is OPT-IN and CONDITIONALLY ENGAGED — an app with zero `db-authoritative` `<schema>` tables emits byte-identically to before the tier existed.** `appDeclaresDbAuthoritative(fileAST)` (`codegen/db-authoritative.ts`) is the gate; only when true does `wrapPrincipalTxn` rewrite `?{}` query sites. **NOTE the narrower "zero-immutable-columns" byte-identity sub-guarantee is RETIRED as of S288** — a `db-authoritative` table always carries a PK, which is now always effectively-immutable; the OUTER conditional-engagement guarantee above is unaffected.
- **The DB-authoritative DDL is emitted by the compiler but APPLIED by a separate tool, `scrml db-migrate`, run under a MORE-PRIVILEGED principal than the app itself — never auto-applied on server boot.** The running app connects as the bounded `NOLOGIN NOBYPASSRLS` `scrml_app` role and cannot, by construction, install or alter its own security policy. A statement failure during apply is now attributed to its exact index + SQL text (S288) — see migrations.map.md.
- **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY` — the bounded role is MANDATORY, not a hardening nicety.** Without it, the RLS policy is a silent no-op that LOOKS enforced.
- **P2 (writes-authority) deliberately crosses the §14.8.10 "consume, never derive" firewall** — it is the first milestone where scrml computes an authorization decision (column GRANT/REVOKE, a capability-gated SECURITY DEFINER) rather than only relocating an isolation invariant. A `SECURITY DEFINER` function missing `SET search_path = pg_catalog, public` is a CVE-2020-25695-class privilege-escalation hole, not merely unenforced — this is a mandatory codegen invariant. **A `db-authoritative` table's PK + `tenant_id` are AUTO-IMMUTABLE as of S288** (`isEffectivelyImmutable`) — no per-column opt-out.
- **The GUC-based principal (`scrml.tenant`/`scrml.principal.caps`) is self-settable by `scrml_app` — it protects a non-compromised app, not one with an injectable SQL channel.** What DOES survive a fully-compromised `scrml_app`: the immutable-column REVOKE, the SECDEF-only choke, and `NOBYPASSRLS`. Never claim more than this — see domain.map.md's honesty-bar section.
- `scrml db-migrate` and `scrml migrate` are DIFFERENT commands — `migrate` is the pre-existing scrml-SOURCE syntax codemod; `db-migrate` applies `<schema>` to a real database. Do not conflate them.
- **A `oneOf([…])`/`notIn([…])`/`default(…)` value on a `<schema>` column is now LOWERED from scrml literal form to SQL literal form, not passed verbatim** — a bareword item (`oneOf([user, admin])`) is a compile error (`E-SCHEMA-010`), while a non-literal `default()` argument (`default(now())`) is legitimately a SQL expression and stays verbatim. See schema.map.md.
- **A block-form `<match>` arm that isn't a variant name or `<_>` (e.g. `<when is="…">`) is now `E-MATCH-INVALID-ARM`, not a silent zero-arm dead page.** A residual gap remains: a no-`for=` `<match on=@cell>` still skips exhaustiveness entirely.
- Chunk namespacing is a POST-HOC bundle-assembly pass — NO emitter emits `_scrml_cs_` or a namespaced token directly (`renameCellAccessors` in `cell-accessor-rename.ts` PARSES the assembled chunk body and range-SPLICES every cell-accessor call).
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. Every consumer matches structurally; a pass expecting a typed node silently finds nothing. (Likewise, `TableDecl`/`SecdefFnDecl` — the DB-authoritative tier's shapes — are codegen-internal, not `ast.ts` types; see schema.map.md.)
- **Confidentiality is four orthogonal axes (§52.15.4)** — route-admission ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). The §14.8.11 DB-authoritative tier is a FIFTH, opt-in, DB-side escalation of the tenant-scope axis — it stacks with, never replaces, the other four. **The tenant-scope registry now also unions `<schema>`-declared tables, not just `<db>`-derived ones (S288 fix).**
- SPEC.md is the sole normative source; §14.8.11/§14.8.11.1/§14.8.11.2 amended THIS window (auto-immutable clause, retired anti-regression clause, §39.5.8 lowering note, new §34 rows). PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001) backstops the §14.8.9 protect-floor.
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value.
- The compiler ships TWO parsers: the live pipeline and `compiler/native-parser/` (`--parser=scrml-native`). This window's diffs are all live-pipeline/emit-time/CLI — no native-parser parity obligation incurred.

## Tags
#scrml #map #primary #index #compiler #bun #dbauth #db-authoritative #db-migrate #rls #secdef #privilege-separation #trust-boundary-reversal #chunk-namespace #cell-accessor-rename #cs-prefix #ns-token #fnv1a #iife-hoist #esm-chunks #module-format #each-fence #foster-safe #batch-hoist #bind-value #claim-gate #facts-gate #css65 #native-parser #self-host #stdlib #auth #outlet #one-landmark #shell-composition #server-shape #semdiff #ci #infra #content-hash #colorless-async #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #migrations #half-rls-honesty-bar #auto-immutable #is-effectively-immutable #e-schema-010 #e-match-invalid-arm #ghost-pattern #w-dead-function #failing-statement-attribution #session-principal-wiring #resolved-gaps #nested-for-lift-reconcile #lowering-functions

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
