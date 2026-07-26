# migrations.map.md
# project: scrml
# updated: 2026-07-26T07:00:00Z  commit: f8a138e9

**NEW map this pass.** The conditional check (a real DB-migration-apply tool now exists) fires for
the first time — `scrml migrate` (pre-existing) is a scrml-SOURCE syntax codemod, NOT a DB
schema-migration tool, so this map did not exist before `scrml db-migrate` (§14.8.11.1, S287) landed.
This is why `primary.map.md` previously listed migrations.map.md as absent with that reasoning; that
row is now updated — see primary.map.md's Map Index.

This is NOT a Prisma/Knex/Alembic-shaped versioned-migration-file tool. Read the model section below
before assuming a `migrations/0001_*.sql`-style directory exists — it does not.

## Tool
Library: none — first-party, `compiler/src/commands/db-migrate.js` (the CLI) +
`compiler/src/schema-differ.js` (the differ/DDL emitter, shared with the pre-existing SQLite migrate
path) + `compiler/src/codegen/db-authoritative.ts` (`extractDesiredSchema`, the desired-state seam)
+ `compiler/src/codegen/sql-ident.ts` (`quoteIdent`, mandatory identifier escaping).
Config: none — no config file. Everything is CLI-flag-driven (`--db`, `--dry-run`,
`--allow-destructive`).
Directory: NONE. There is no `migrations/` directory and no per-migration file. The desired state IS
the project's `<schema>` source (parsed fresh on every run); the differ reconciles it against the
LIVE database's actual state on every invocation. See "Model" below.

## Model — desired-state reconciliation, not versioned migration files

`scrml db-migrate <project-dir|entry.scrml> --db <migrator-url>` is the APPLY inverse of
`scrml introspect`'s EMIT (introspect: live DB → `<schema>` source; db-migrate: desired `<schema>` →
reconciling DDL on the live DB). Every run:

1. Parses the project's `<schema>` (all `.scrml` files, live parse pipeline `splitBlocks`→`buildAST`,
   merged first-decl-wins) into the DESIRED table/column/fn set via `extractDesiredSchema`.
2. Reads the ACTUAL live-DB state (`readActualSchemaPg` for Postgres / `readActualSchema` for
   SQLite) PLUS, on Postgres, a narrow scrml-managed-object PRESENCE read (`pg_policies WHERE
   policyname LIKE 'scrml\_%'`, `pg_roles WHERE rolname = 'scrml_app'` — Fork 2, minimal
   object-awareness, NOT a full object-aware policy/trigger/function differ).
3. `diffSchema(desired, actual, {driver, allowDestructive})` computes the reconcile plan: `CREATE
   TABLE`/`ALTER TABLE … ADD/DROP COLUMN` for structural drift, PLUS (Postgres only, per
   `db-authoritative` table) the idempotent §14.8.11 DDL — S1 RLS+policy, S6 bounded-role GRANT
   (S3-reshaped if any column is `immutable`) — PLUS (Postgres only, if any `fn` is declared) the
   §14.8.11.2 S4 SECDEF mutation-choke DDL (`generateScrmlHasCapDDL` once + `generateSecdefDDL` per
   `fn`).
4. Applies the WHOLE plan in ONE transaction under the migrator connection; a statement failure
   rolls the entire run back (no partial-apply state).

Because every piece of DDL the tier emits is IDEMPOTENT (`CREATE ROLE … EXCEPTION WHEN
duplicate_object`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, natural
`GRANT`/`ALTER TABLE ENABLE/FORCE ROW LEVEL SECURITY` idempotency), re-running `db-migrate` against
an already-migrated database is a SAFE no-op re-assertion, not an error — this is what lets the tool
skip a versioned migration-file history entirely.

## Privilege separation (load-bearing, §14.8.11.1)

`--db` is the MIGRATOR/owner connection — a DDL-capable role (`CREATE ROLE`, `ALTER TABLE … FORCE
ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`). The RUNNING APP is a DIFFERENT, bounded principal:
the emitted server connects and, per query, `SET LOCAL ROLE scrml_app` (a `NOLOGIN NOBYPASSRLS` role
with CRUD-only grants) — it is, BY CONSTRUCTION, unable to apply or alter the security DDL (a role
that could install the RLS policy could also `DROP POLICY` it). So the apply step is OUT-OF-APP, run
by an operator/CI under the migrator credential — NEVER by the app runtime. Auto-apply-on-boot is
ELIMINATED for Postgres (a `scrml dev` local auto-apply and a `scrml build`-emitted `.sql` artifact
are separately-scoped, unbuilt fast-follows). Mirrors PostgREST's migrator-vs-authenticator
discipline.

## The ledger — `_scrml_migrations` (thin, NOT a version history)

```sql
CREATE TABLE IF NOT EXISTS "_scrml_migrations" (
  id bigserial PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  object_kind text NOT NULL,
  object_name text NOT NULL,
  ddl_hash text NOT NULL
);
```

One row per applied STATEMENT (not per migration run), recording what scrml authored
(`{table|policy|function|role|grant|revoke|alter|drop-policy|drop-table}` via
`classifyStatement` in `db-migrate.js`) + a content hash (`Bun.hash(stmt)`). Purpose: apply-atomicity
(guarded by a `pg_advisory_xact_lock(<fixed key>)`, transaction-scoped so a dead migrator process
leaks no lock) + OBJECT-AUTHORSHIP (an audit can answer "did scrml author this object" without a
full object-aware differ). There is no per-file migration history and no migration-authoring
surface — the S7-full object-aware policy/trigger/function differ is a separately-scoped, deferred
tail.

## Naming Convention
N/A — no migration files exist. The only naming surface is the ledger's `object_kind`/`object_name`
classification (above) and the DB-authoritative constant names: `scrml_app` (the bounded role),
`scrml_tenant_iso` (the tenant-isolation policy), `scrml.tenant`/`scrml.principal.caps` (the two
txn-scoped GUCs).

## Latest Migration
N/A — desired-state reconciliation has no "latest" concept; every run reconciles against the
project's CURRENT `<schema>` source. The ledger's most recent row (`ORDER BY applied_at DESC LIMIT
1`) is the closest analog, but it is an audit trail, not a migration pointer.

## Rollback
Manual. There is no `scrml db-migrate down` / no-op inverse — the tool is forward-reconcile only.
To remove a table: delete it from `<schema>` and re-run `db-migrate` with `--allow-destructive` (the
never-clobber fence otherwise refuses a bare `DROP TABLE` and fires `W-SCHEMA-DESTRUCTIVE-DROP`,
since a Postgres DROP CASCADEs the table's attached RLS policy/grants/role membership). scrml NEVER
emits `DROP FUNCTION`/`DROP ROLE` for a SECDEF/owner role, so a P2 `fn`/owner is never
auto-rolled-back either — remove it by hand if truly retiring it.

## Never-clobber fence (Fork 3)
A bare `DROP TABLE` for an actual-but-not-desired table is REFUSED by default
(`options.allowDestructive === false`, `diffSchema` in `schema-differ.js`) — fires
`W-SCHEMA-DESTRUCTIVE-DROP` instead, pointing the operator at `--allow-destructive`. The
scrml-managed security objects are roles/policies (never tables), so the table-DROP gate is the
whole fence at the table grain; `DROP POLICY IF EXISTS scrml_tenant_iso` re-creates ONLY the
scrml-managed policy name, never touching a hand-authored one on the same table.

## Known open gaps (`docs/known-gaps.md`, all S287)
`g-db-migrate-check-constraint-oneof-pattern` (MED, open) — a `<schema>` column carrying
`oneOf([...])`/`pattern(/…/)` trips the differ's OWN diff-parser (`parseColumns`/
`parseSharedCorePredicates` in `schema-differ.js`) three ways: (1) `oneOf([...])` emits an UNQUOTED
bareword CHECK (should be a string literal); (2) the table false-fails `E-DBAUTH-NO-TENANT-COLUMN`
even though it DOES declare `tenant_id` (the main compiler's own parse is fine — only the differ's
line-based diff-parser chokes on the `[...]`/`/.../` payload); (3, minor) a `pattern(/…{n}…/)`
quantifier brace can fool the brace/marker matcher and spuriously fire
`W-DBAUTH-MARKER-NEARMISS`. **This is the natural next `scrml db-migrate` fix** — impact: turnkey-
from-source works for simple schemas but not CHECK-carrying ones (most real schemas). Also see
error.map.md/schema.map.md for the exact fire sites.

## Tags
#scrml #map #migrations #db-migrate #dbauth #db-authoritative #schema-differ #privilege-separation #ledger #never-clobber-fence #rls #secdef #postgres

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [build.map.md](./build.map.md)
