# DB-authoritative Milestone 2 — migration-apply seam (`scrml db-migrate`)

Ruled arc (bryan "your recs" on the DD's 5 forks, 2026-07-26).
DD: `scrml-support/docs/deep-dives/db-authoritative-migration-apply-seam-2026-07-26.md`.

## Goal
A privileged out-of-app `scrml db-migrate <project> --db <migrator-url>` CLI that applies a
project's `<schema>` + the M1 db-authoritative RLS/role DDL to a real DB — turning the tier
turnkey-from-source. The M1 negative test must pass THROUGH the CLI.

## Ruling (do not re-open)
1. Privileged out-of-app `scrml db-migrate` CLI is canonical; auto-apply-on-boot ELIMINATED for PG.
2. PG state-reader: extend minimally (narrow scrml-managed policy/role presence read).
3. Fence: `scrml_*` naming + hard no-bare-`DROP TABLE` (behind `--allow-destructive`) + ledger authorship.
4. Ledger: stateless desired-state-diff + a THIN `_scrml_migrations` (atomicity + advisory lock + authorship).
5. Scope: build general (both drivers), acceptance-gate Postgres-db-authoritative first.

## Empirical de-risking (this session, real PG16)
- No `postgres://` URL string form peer-auths the local socket via Bun.SQL; the object form
  `{path, database, username}` does. Real deployments use a TCP URL w/ creds → `new SQL(url)` works.
  Acceptance test bootstraps a password LOGIN migrator role (CREATEROLE/CREATEDB, owns scratch DB)
  via peer, then drives the CLI with a `postgres://migrator:pw@localhost:5432/db` TCP URL.
- Verified the FULL migrator privilege chain as a NON-superuser DB-owner: advisory_xact_lock,
  CREATE TABLE in public, CREATE _scrml_migrations, CREATE ROLE scrml_app, GRANT CRUD, ENABLE/FORCE
  RLS, CREATE POLICY, read pg_policies/pg_roles, GRANT scrml_app TO migrator — all OK.

## Build status
- [x] Fence: `diffSchema` `allowDestructive` gate — no bare DROP TABLE by default (W-SCHEMA-DESTRUCTIVE-DROP). (bff46efe)
- [x] `extractDesiredSchema(fileAST)` in db-authoritative.ts (reuses the schema-body walk).
- [x] `compiler/src/commands/db-migrate.js` — argv, PG apply flow, SQLite apply, dry-run.
- [x] `cli.js` registration (guard + dispatch + help).
- [x] SPEC §14.8.11.1 (apply seam) + W-SCHEMA-DESTRUCTIVE-DROP §34/§39.12 registration. (28ee1921)
- [x] Tests: through-CLI PG acceptance (skip-graceful), argv/fence/diff unit, SQLite smoke.

## Acceptance gate — PASSED (this session, real PG16)
Through-CLI: `scrml db-migrate <invoices-project> --db postgres://migrator:pw@localhost:5432/db`
applies 7 stmts in 1 txn; then a bounded scrml_app conn: NO set_config → 0 rows; set_config(tenantA)
→ tenant-A-only. Ledger records authorship. Re-run idempotent. Cross-test order-independent (the
cluster-global scrml_app membership grant goes through the peer superuser, not the migrator).

## Advisory-lock note
Used `pg_advisory_xact_lock(<key>)` INSIDE the apply txn (auto-released at commit/rollback) rather
than session-level `pg_advisory_lock` + explicit `pg_advisory_unlock`. Strictly better: no lock leak
if the process dies mid-apply, and it is the atomicity property the DD's ledger argument wants.

## PA adversarial review (S239) — HIGH/MED/LOW fixed in-place
- **HIGH (blocking) — unescaped identifier interpolation → injection as the migrator.** Routed EVERY
  identifier interpolation in `schema-differ.js`'s DDL-emit path (RENAME/DROP COLUMN, DROP TABLE,
  CREATE TABLE, ADD COLUMN, REFERENCES, generateDbAuthoritativeDDL, the SQLite 12-step rebuild, the
  CHECK-clause helper, PRAGMA) through a shared `quoteIdent` (new `compiler/src/codegen/sql-ident.ts`,
  `"` → `""`). Lifted `emit-channel.ts`'s local `pgQuoteIdent` to import from the shared util (no dup).
  Regression: unit (schema-differ SECURITY — the PoC payload quote-doubles, no break-out) + live-PG
  (db-migrate-pg SECURITY — ACTUAL schema carries the injection-payload column; through-CLI migration
  applies cleanly, `pleak` policy NOT created, bounded no-GUC read still 0 rows).
- **MED — mis-detected marker → silent downgrade.** `db-migrate` ECHOES the recognized db-authoritative
  set; `extractDesiredSchema` fires `W-DBAUTH-MARKER-NEARMISS` on a case/spacing/placement near-miss.
- **LOW — db-authoritative table with no tenant_id.** Pre-flight `E-DBAUTH-NO-TENANT-COLUMN` (fail-closed
  before touching the DB, names the table) instead of an opaque PG error + rollback.
- SPEC: §14.8.11.1 identifier-escaping invariant + near-miss/echo/preflight prose; §34 registers
  `E-DBAUTH-NO-TENANT-COLUMN` + `W-DBAUTH-MARKER-NEARMISS`.

## Explicitly OUT (fast-follow M2-part-2 — NOT built here)
- Approach B: `scrml build` `.sql` artifact emission.
- `scrml dev` auto-apply overlay.
- S7-full object-aware diff (arbitrary policy/trigger/function diffing).
