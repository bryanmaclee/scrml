# primary.map.md
# project: scrml
# updated: 2026-07-26T07:00:00Z  commit: f8a138e9
# NOTE (S287): INCREMENTAL refresh, DB-authoritative-security-tier-scoped. This window (`1c5c2aee`
# -> `f8a138e9`) folds in the §14.8.11/.1/.2 DB-authoritative security tier — Milestone 1
# (reads-authoritative Postgres RLS), Milestone 2 (the `scrml db-migrate` migration-apply seam), and
# P2 (writes-authority: immutable columns + the SECURITY-DEFINER mutation choke). Maps regenerated
# this pass: primary, structure, dependencies, schema, domain, build, test, error (all -> `f8a138e9`)
# + a NEW migrations.map.md. config/auth/infra were NOT touched — this window added zero env vars,
# zero auth/session surface change, zero CI/infra change. See the Map Index below for per-map
# currency. For per-session history, see docs/changelog.md (NOT this file).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout — this window's DB-authoritative tier is the first surface to depend on `Bun.SQL`'s transaction API (`sql.begin`) and `bun:sqlite`'s `Database` for the migration-apply loop, both already-bundled)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7053+** git-tracked files (not re-verified whole-repo this pass; the touched subtrees are). `compiler/src/` **187** (143 .ts + 42 .js + 2 other); `compiler/src/codegen/` **85** (81 .ts + 3 .js + 1 .md); `compiler/src/commands/` **12** (was 11 — `db-migrate.js` NEW); `compiler/native-parser/` 79 (still ZERO diff since `df2ac831` — unaffected, emit-time/CLI-only tier); `compiler/tests/` **1255** `*.test.js` (recursive `git ls-files` count, +21 net across this whole window, +9 attributable to the DB-authoritative tier specifically). All counts `git ls-files`-derived this pass; cross-check `docs/FACTS.md` (generated, `--check`-gated in CI) for the published figures.
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml`. No CI-stage change this window; the tier's new live-PG integration tests run in the existing `tracking` tier, skip-graceful.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`).
It is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, **CLI verbs — now 11**, LSP capabilities, gated snippets). **Do not hardcode any of
those figures in a doc — cite FACTS.md.** Where this map states a count it agrees with FACTS.md at
this commit (not independently re-verified this pass; `facts.ts --check` is CI-gated so drift would
already be caught).

## Landings folded in THIS window (`1c5c2aee` -> `f8a138e9`, S287)

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
     `GRANT` to a column-scoped one (byte-identical to M1 when zero columns are immutable — a
     normative anti-regression). S4: a co-located `<schema>` `fn … security definer owner(…)
     requires cap("x") { """plpgsql""" }` — the sole sanctioned mutation path for a
     revoked-from column, hardened as a CODEGEN INVARIANT (`SET search_path = pg_catalog, public` —
     a missing pin is a CVE-2020-25695-class privesc hole, not merely unenforced). The capability
     GUC `scrml.principal.caps`, read by ONE checked `scrml_has_cap(text)` helper. `tenant-egress.ts`
     gained `_scrml_active_tenant`/`_scrml_active_caps` (the server-resolved principal resolvers the
     A1 wrapper injects — shared with the pre-existing §14.8.10 floor).
   - **4 NEW §34 codes:** `E-DBAUTH-SQLITE`, `E-DBAUTH-NO-TENANT-COLUMN`, `W-DBAUTH-MARKER-NEARMISS`,
     `W-SCHEMA-DESTRUCTIVE-DROP`. **+9 new test files** (2 conformance, 3 integration — live-PG
     skip-graceful, 4 unit). **Zero new external dependency** — entirely `Bun.SQL`/`bun:sqlite`,
     already bundled.
   - **Open, non-blocking gaps** (`docs/known-gaps.md`, all S287): `g-db-migrate-check-constraint-
     oneof-pattern` (MED — `schema-differ.js`'s OWN diff-parser trips on a `oneOf([...])`/
     `pattern(/…/)` column, false-firing `E-DBAUTH-NO-TENANT-COLUMN` and emitting an unquoted CHECK —
     **the natural next `db-migrate` fix**); `g-dbauth-p2-caps-provenance` (MED — `_scrml_active_caps`
     has no real session-caps source yet, so a `requires cap` SECDEF is inert-deny until wired);
     `g-dbauth-p2-pk-tenant-not-auto-immutable` / `g-dbauth-secdef-owner-crud-all-tables` (LOW).
2. **Threshold + phasing ruled by bryan (S286), landed same session (S287) as three PA-driven
   dispatches** — each with its own `docs/changes/db-authoritative-{m1,m2,p2}/` BRIEF+PROGRESS
   archive (historical, out of content-mapping scope) and its own live-PG acceptance gate
   (skip-graceful when PG is unreachable, mirroring the pre-existing introspect-pg pattern).

## Landings folded in the PRIOR window (`a0344d75` -> `1c5c2aee`) — still current surface, condensed
1. **chunk-namespacing BUG-6 accessor-rename (#180, closes #27).** Two route chunks coexisting in
   one live document no longer clobber each other's runtime-global token space. NEW
   `codegen/chunk-namespace.ts` + `codegen/cell-accessor-rename.ts`. Zero new §34 codes (the token-
   collision guard `assertChunkTokensDistinct` is a hard error, explicitly NOT `E-CG-010`) — though
   this pass's count reconciliation surfaced that its §34 catalog ROW (`E-CG-018`) had never actually
   been counted; see error.map.md.
2. **Peter's adopter/codegen fixes #171-#175** (batch-hoist completion, client-side-effect batch
   boundary, no dead client destructure, reactive `value=` writes `.value`, per-item `bind:value`
   wiring inside `<each>` — the last of which added `W-EACH-BIND-ITEM-FIELD-DEFERRED`, likewise
   reconciled into the count this pass).
3. **Stage 3.055 Tag-Canonicalizer (#155).** NEW `tag-canonicalizer.ts`.
See prior map generations / `docs/changelog.md` for the full narrative on these three.

## Map Index

| Map                  | Stamp | Contents                                                      |
|----------------------|-------|-----------------------------------------------------------------|
| structure.map.md     | **`f8a138e9`** | directory layout, 5 entry points, 11 subcommands; recounted 187/85/12 + the 3 new DB-authoritative files |
| dependencies.map.md  | **`f8a138e9`** | 6 runtime + 6 dev deps (**unchanged — DB-authoritative tier is first-party, `Bun.SQL`/`bun:sqlite` already bundled; ZERO new dep**), full module graph incl. the NEW DB-authoritative stage |
| schema.map.md        | **`f8a138e9`** | ~114 AST types/interfaces (unchanged — zero new ast.ts shape) + NEW codegen-internal `TableDecl`/`ColumnDecl`/`SecdefFnDecl` (schema-differ.js) |
| domain.map.md        | **`f8a138e9`** | scrml language primitives + the NEW §14.8.11/.1/.2 DB-authoritative concept section (trust-boundary reversal, privilege separation, the doubled negative-test acceptance gate, the honesty-bar threat model) |
| build.map.md         | **`f8a138e9`** | 13 npm scripts, **11 CLI subcommands** (`db-migrate` NEW, full flag doc), 2 CI workflows, git hooks, the 3 claim-gate scripts |
| test.map.md          | **`f8a138e9`** | bun:test, 9 categories, fresh recount **1255** (+21; +9 DB-authoritative-attributable, individually itemized), the NEW live-PG skip-graceful pattern |
| error.map.md         | **`f8a138e9`** | **793** §34 codes (+6: 4 in-scope DB-authoritative + 2 reconciled from an untouched-count gap), the 4 new codes' fire sites + known-gaps cross-refs |
| **migrations.map.md** | **`f8a138e9`** | **NEW conditional map this pass** — the `scrml db-migrate` desired-state reconciliation model, the privilege-separation contract, the thin `_scrml_migrations` ledger, the never-clobber fence |
| config.map.md        | `f079d0a9` | 6 env vars, 3 config files — NOT re-verified; no env-var or config-file shape change (`--db` is a CLI flag, not an env var; GUC names are compile-time string constants) |
| auth.map.md          | `df2ac831` | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session builtin — NOT re-verified; the DB-authoritative tier's principal resolvers (`_scrml_active_tenant`/`_scrml_active_caps`) live in `tenant-egress.ts` and are mapped in domain.map.md/dependencies.map.md instead, matching the pre-existing §14.8.10 tenant-floor precedent (also NOT in auth.map.md) |
| infra.map.md         | `f079d0a9` | GitHub Actions CI, no Docker/cloud resources — NOT re-verified; no infra change (the tier's tests are skip-graceful against an operator-provided Postgres, not a CI-provisioned one) |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature) |
| style.map.md         | absent (Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
| i18n.map.md          | absent (no locales/i18n dirs) |
| jobs.map.md          | absent (scrml:cron is a stdlib module FOR GENERATED APPS, not a job system this repo runs) |

An honest older stamp beats a false "verified at HEAD" — every row above is a decision, made
because no file changed this window touches that map's subject.

## Task-Shape Routing

| If your task is about… | Read |
|---|---|
| **the DB-authoritative security tier — RLS/roles/SECDEF/db-migrate (ACTIVE SURFACE, S287)** | domain.map.md (§14.8.11/.1/.2 concept + threat model) + migrations.map.md (the apply model) + dependencies.map.md (module graph: `schema-differ.js`, `codegen/db-authoritative.ts`, `codegen/sql-ident.ts`, `commands/db-migrate.js`, `tenant-egress.ts`'s caps resolvers) + schema.map.md (`TableDecl`/`ColumnDecl`/`SecdefFnDecl`) + error.map.md (the 4 codes) + build.map.md (`scrml db-migrate` flags) |
| **a `scrml db-migrate` CHECK-constraint / oneOf / pattern fix** | `g-db-migrate-check-constraint-oneof-pattern` in `docs/known-gaps.md` (the reproducer + 3 sub-bugs) + `schema-differ.js`'s `parseColumns`/`parseSharedCorePredicates`/`lowerSharedCoreToChecks` (see schema.map.md's "known parser gap" note + error.map.md's `E-DBAUTH-NO-TENANT-COLUMN`/`W-DBAUTH-MARKER-NEARMISS` entries) |
| **caps-provenance / the SECDEF cap gate** | `g-dbauth-p2-caps-provenance` in `docs/known-gaps.md` + `tenant-egress.ts`'s `_scrml_active_caps(req)` (dependencies.map.md) + the honesty-bar threat model in domain.map.md |
| **P3 integrity / double-entry / DEFERRED constraint triggers** | domain.map.md's §14.8.11.2 section notes S5 is a SEPARATE, not-yet-scoped P3 milestone — read the SPEC §14.8.11.2 cross-references first, there is no code yet |
| chunk namespacing / multi-chunk token isolation | `codegen/chunk-namespace.ts` + `codegen/cell-accessor-rename.ts` + `codegen/index.ts` (the wiring) — mapped in dependencies.map.md + structure.map.md |
| `<each>` codegen + the runtime list reconciler | `codegen/emit-each.ts` + `runtime-template.js` + `codegen/emit-ssr-render.ts` — mapped in dependencies.map.md + structure.map.md |
| chunk / module-format emit | `codegen/runtime-esm.ts` + `codegen/emit-client-esm.ts` + `codegen/index.ts` — mapped in dependencies.map.md + build.map.md |
| batch-hoist / server-call fencing (§19.9.9.2) | `codegen/emit-server.ts` + `codegen/scheduling.ts` |
| types / interfaces / AST node shapes | schema.map.md |
| diagnostic codes / error classes | error.map.md |
| environment variables / config keys | config.map.md |
| test patterns / fixtures | test.map.md |
| build commands / CI stages / CLI flags | build.map.md |
| DB migration / schema-apply / privilege model | migrations.map.md |
| public-claim gates (snippets, derived figures) | build.map.md (the three scripts + CI wiring); `docs/FACTS.md` is the figure authority |
| CI provider / deploy / docker / cloud | infra.map.md |
| directory layout / entry points | structure.map.md |
| external packages / module graph | dependencies.map.md |
| language primitives / SPEC navigation | domain.map.md |
| outlet / `<main>` landmark / MPA shell composition | domain.map.md (four-case table) + error.map.md (E-OUTLET-AND-MAIN) + dependencies.map.md |
| tenant-row isolation floor (§14.8.10) — the SAME-principal sibling of the DB-authoritative tier | domain.map.md + error.map.md (E-TENANT-*/I-TENANT-*) + dependencies.map.md (tenant-egress.ts) |
| SSR auto-make-safe (§52.15.5) / sql-lex | domain.map.md + error.map.md + dependencies.map.md |
| colorless-async classification (Q1/Q2) | dependencies.map.md (mechanism) + error.map.md (E-ASYNC-STDLIB-IN-SYNC-CALLBACK + the discard-HOF narrowing) |
| content-hash / cache-header build contract | build.map.md (mechanism) + domain.map.md (§47.9.8 concept) |
| auth flows / JWT / OAuth / protect-floor / session builtin | auth.map.md |
| non-compliant / stale docs | non-compliance.report.md |

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (**11 subcommands**, `db-migrate` NEW S287); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **The DB-authoritative security tier is OPT-IN and CONDITIONALLY ENGAGED — an app with zero `db-authoritative` `<schema>` tables emits byte-identically to before the tier existed.** `appDeclaresDbAuthoritative(fileAST)` (`codegen/db-authoritative.ts`) is the gate; only when true does `wrapPrincipalTxn` rewrite `?{}` query sites.
- **The DB-authoritative DDL is emitted by the compiler but APPLIED by a separate tool, `scrml db-migrate`, run under a MORE-PRIVILEGED principal than the app itself — never auto-applied on server boot.** The running app connects as the bounded `NOLOGIN NOBYPASSRLS` `scrml_app` role and cannot, by construction, install or alter its own security policy.
- **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY` — the bounded role is MANDATORY, not a hardening nicety.** Without it, the RLS policy is a silent no-op that LOOKS enforced.
- **P2 (writes-authority) deliberately crosses the §14.8.10 "consume, never derive" firewall** — it is the first milestone where scrml computes an authorization decision (column GRANT/REVOKE, a capability-gated SECURITY DEFINER) rather than only relocating an isolation invariant. A `SECURITY DEFINER` function missing `SET search_path = pg_catalog, public` is a CVE-2020-25695-class privilege-escalation hole, not merely unenforced — this is a mandatory codegen invariant.
- **The GUC-based principal (`scrml.tenant`/`scrml.principal.caps`) is self-settable by `scrml_app` — it protects a non-compromised app, not one with an injectable SQL channel.** What DOES survive a fully-compromised `scrml_app`: the immutable-column REVOKE, the SECDEF-only choke, and `NOBYPASSRLS`. Never claim more than this — see domain.map.md's honesty-bar section.
- `scrml db-migrate` and `scrml migrate` are DIFFERENT commands — `migrate` is the pre-existing scrml-SOURCE syntax codemod; `db-migrate` applies `<schema>` to a real database. Do not conflate them.
- Chunk namespacing is a POST-HOC bundle-assembly pass — NO emitter emits `_scrml_cs_` or a namespaced token directly (`renameCellAccessors` in `cell-accessor-rename.ts` PARSES the assembled chunk body and range-SPLICES every cell-accessor call).
- The namespace token is `fnv1aHash(project-root-relative source path)` — always starts with `0`. A token COLLISION is a hard compile error, explicitly NOT `E-CG-010`.
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. Every consumer matches structurally; a pass expecting a typed node silently finds nothing. (Likewise, `TableDecl`/`SecdefFnDecl` — the DB-authoritative tier's shapes — are codegen-internal, not `ast.ts` types; see schema.map.md.)
- **The one-landmark invariant (§20.8.1.1) is enforced across THREE files** communicating only through the emitted `data-scrml-outlet` marker.
- **Confidentiality is four orthogonal axes (§52.15.4)** — route-admission ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). The §14.8.11 DB-authoritative tier is a FIFTH, opt-in, DB-side escalation of the tenant-scope axis — it stacks with, never replaces, the other four.
- SPEC.md is the sole normative source; §14.8.11/§14.8.11.1/§14.8.11.2 are NEW sections this window. PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001) backstops the §14.8.9 protect-floor.
- 21 stdlib modules ship as `scrml:*` imports, each with BOTH a canonical `.scrml` source (stdlib/) and a JS host shim (compiler/runtime/stdlib/). Two self-host efforts run in parallel (compiler/self-host/, compiler/self-host-v2/).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value.
- The compiler ships TWO parsers: the live pipeline and `compiler/native-parser/` (`--parser=scrml-native`). **native-parser/ has ZERO diff since `df2ac831`** — the DB-authoritative tier is emit-time + a standalone CLI, carrying no native-parser parity obligation.

## Tags
#scrml #map #primary #index #compiler #bun #dbauth #db-authoritative #db-migrate #rls #secdef #privilege-separation #trust-boundary-reversal #chunk-namespace #cell-accessor-rename #cs-prefix #ns-token #fnv1a #iife-hoist #esm-chunks #module-format #each-fence #foster-safe #batch-hoist #bind-value #claim-gate #facts-gate #css65 #native-parser #self-host #stdlib #auth #outlet #one-landmark #shell-composition #server-shape #semdiff #ci #infra #content-hash #colorless-async #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #migrations #half-rls-honesty-bar

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
