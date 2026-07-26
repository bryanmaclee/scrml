# BRIEF — DB-authoritative Milestone 2: the migration-apply seam (`scrml db-migrate`)

**Dispatched:** S287-bryan, 2026-07-26 · agent `scrml-js-codegen-engineer` · `isolation: worktree`
**DONE-PROBE:** test -f compiler/src/commands/db-migrate.js
**Authority (READ FIRST, in full — absolute paths, sibling scrml-support repo, read-only):**
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/db-authoritative-migration-apply-seam-2026-07-26.md` — the ruled DD. **bryan ruled "your recs" on ALL FIVE forks** (2026-07-26). Do not re-litigate.
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/db-authoritative-security-PHASING-PLAN-2026-07-25.md` + `.../db-authoritative-security-design-2026-07-25.md` — M1 context (this continues them).

Fire-sites below are PA-verified against `main @ 50478f0e` this session — trust them over the DD's line numbers.

## 0. The ruling (do NOT re-open)
1. **Apply model:** a **privileged, out-of-app `scrml db-migrate` CLI** is canonical. **Auto-apply-on-boot is ELIMINATED for Postgres** (the app runs as the bounded `scrml_app` role — a process that could apply the RLS DDL could also *undo* the authority). `scrml dev` local auto-apply + a build-emitted `.sql` artifact (Approach B) are **FAST-FOLLOW, NOT this dispatch** (see §7).
2. **PG state-reader:** extend the existing reader **minimally** (columns/constraints exist; add a narrow scrml-managed policy/role *presence* read). NO S7-full object-aware diff.
3. **Fence:** `scrml_*` naming + a hard **no-bare-`DROP TABLE`** rule (behind `--allow-destructive`) + authorship in the ledger.
4. **Ledger:** **stateless desired-state-diff** + a **thin `_scrml_migrations` table** (apply-atomicity + `pg_advisory_lock` + object-authorship) — **NOT** a versioned migration-file history.
5. **Scope:** build **general** (both drivers — `diffSchema` is already driver-parameterized + both readers exist), **deliver + acceptance-gate Postgres-db-authoritative first**.

## 1. The atomic-milestone unit (the acceptance gate — NON-NEGOTIABLE)
`scrml db-migrate <project> --db <MIGRATOR-postgres-url>` applies a project's `<schema>` — **including the M1 db-authoritative DDL** — to a real Postgres, and:

> the M1 negative test now passes **THROUGH the CLI**: after `db-migrate` runs (as a migrator/owner), a bounded `scrml_app` connection with no `set_config` reads **0 rows** of the `db-authoritative` `invoices` table; with `set_config(tenantA)` reads only tenant-A rows.

That is what turns the tier **turnkey-from-source** (M1 emitted the DDL; M2 applies it). The M1 test currently applies DDL directly in the harness — M2's acceptance re-runs that proof driven by the actual command.

## 2. The head start (verified — you are wiring existing pieces, not building from scratch)
- **PG actual-state reader EXISTS:** `readActualSchemaPg(sql, {tableFilter})` (`schema-differ.js:996+`) returns `{tables, warnings}` (same shape as the sync SQLite `readActualSchema` at `:283`). Used today by the live-PG `scrml introspect` command.
- **The diff EXISTS:** `diffSchema(desired, actual, {driver})` (`schema-differ.js:327`) already emits the db-authoritative DDL for a `dbAuthoritative` table (calls `generateDbAuthoritativeDDL` at `:408-410`). Feed it `{driver:'postgres'}`.
- **The command pattern to MIRROR:** `compiler/src/commands/introspect.js` (`run()` at `:118-175`) — argv parse + `resolveDbDriver` (postgres gate) + `new SQL(resolved.info.connectionString)` + `readActualSchemaPg` + `closeSql` + clean error/exit. `db-migrate` is the *apply* inverse of introspect's *emit*.
- **Desired-schema extraction:** reuse the AST walk in `compiler/src/codegen/db-authoritative.ts:42-81` (`appDeclaresDbAuthoritative` / `collectSchemaBody` — finds the `kind:"state" stateType:"schema"` node + collects its body text) → `parseSchemaBlock(body)` (`schema-differ.js:16`) → desired `{tables}`, each carrying `dbAuthoritative`. Parse the project entry `.scrml` to a fileAST first (see how `compile.js` / the pipeline builds the AST).
- **`_scrml_migrations`** is a **reserved-but-uncreated** name (excluded in every actual-state reader: `schema-differ.js:286` SQLite, `:989/:1023/:1032` PG). Nothing creates it — M2's thin ledger does.

## 3. Build: `compiler/src/commands/db-migrate.js` (new) + register in `cli.js`
- **cli.js:** add `db-migrate` to the subcommand guard (`~:120`) + the dispatch chain (`~:152`, `else if (subcommand === "db-migrate") { const { runDbMigrate } = await import("./commands/db-migrate.js"); await runDbMigrate(subArgs); }`). Name is **`db-migrate`** — NOT `migrate` (that verb is the existing SOURCE codemod, `commands/migrate.js`; do not touch it).
- **argv:** `scrml db-migrate <project-dir-or-entry.scrml> --db <postgres-url> [--dry-run] [--allow-destructive] [--help]`. Mirror introspect's argv parser + help/exit discipline.
- **The apply flow (Postgres):**
  1. `resolveDbDriver(--db url)` → require postgres for a db-authoritative project (a `db-authoritative` table on a non-PG `--db` → reuse/echo the `E-DBAUTH-SQLITE` spirit; a plain `<schema>` on SQLite is the general path, §7-lite below).
  2. Parse the project entry → fileAST → find `<schema>` → `parseSchemaBlock` → **desired**.
  3. `new SQL(url)` as the **MIGRATOR** (owner/superuser — document that `--db` must be a privileged connection string, distinct from the app's bounded runtime creds; this is the whole point of the split, PostgREST authenticator-vs-migrator).
  4. `pg_advisory_lock(<fixed key>)` → begin txn.
  5. Ensure `_scrml_migrations` exists (thin: e.g. `id serial, applied_at timestamptz default now(), object_kind text, object_name text, ddl_hash text` — enough for authorship + atomicity; stateless, NOT a version log).
  6. `actual` = `readActualSchemaPg(sql)` **+ your minimal extension**: read scrml-managed policy presence (`SELECT policyname FROM pg_policies WHERE policyname LIKE 'scrml\_%'`) + role presence (`SELECT rolname FROM pg_roles WHERE rolname = 'scrml_app'`). Used for the fence + to skip already-applied objects (the DDL is already idempotent — DO-block role, `IF NOT EXISTS`, but `CREATE POLICY` is NOT idempotent, so guard it against the presence read).
  7. `diffSchema(desired, actual, {driver:'postgres'})` → the SQL statements.
  8. **Apply each statement** in the txn, recording authorship in `_scrml_migrations`. `--dry-run` prints the plan without applying.
  9. commit + `pg_advisory_unlock`.
- **General/SQLite path (Fork 5):** wire it (`readActualSchema` sync + `diffSchema({driver:'sqlite'})` + apply via a Bun.SQL/`bun:sqlite` handle) so `scrml db-migrate` also applies a plain `<schema>` for SQLite apps — but a **basic** apply + one smoke test suffices; the **acceptance gate + depth is the Postgres-db-authoritative path**. Don't over-invest in SQLite here.

## 4. The fence — FIX a real live hole (`schema-differ.js:414-419`)
The "Dropped tables" loop emits an **unconditional** `sql.push(\`DROP TABLE IF EXISTS "${actualTable.name}";\`)` on EVERY driver for a table in actual-but-not-desired (with `W-SCHEMA-002`). On Postgres this **CASCADE-drops attached RLS policies/roles** — the never-clobber violation. Gate it: **never emit a bare `DROP TABLE` unless `--allow-destructive`**; and never DROP a scrml-authored security object. (Emit a `W-`/error pointing the operator at `--allow-destructive` instead.) This is part of M2, not optional — the fence is a ruled deliverable.

## 5. SPEC + conformance
- SPEC: a section for `scrml db-migrate` + the apply seam (extend §14.8.11 or a sibling §; the migration is the privileged out-of-app step; the app runtime never applies DDL). State the privilege-separation normatively. Register any new codes/warnings (e.g. a `W-` for the destructive-drop gate).
- Conformance/tests: (a) the **live-PG acceptance test** (§1 — extend or sibling `compiler/tests/integration/db-authoritative-pg.test.js`; **skip-graceful when PG is unreachable**, socket `/var/run/postgresql`, like M1 — the cloud gate can't host live PG); (b) unit tests for the argv parser + the fence gate (no-bare-DROP unless `--allow-destructive`) + the desired/actual diff plan; (c) a basic SQLite apply smoke test.

## 6. Privilege-separation — get this RIGHT (the load-bearing invariant)
`db-migrate`'s `--db` is a **migrator/owner** connection. The app's runtime `_scrml_sql` handle is the **bounded `scrml_app`**. These are DIFFERENT principals by design. After `db-migrate` creates the role + policy as owner, the app connects as `scrml_app` (or a role that `SET ROLE`s to it). Do NOT make the app process capable of applying/altering the security DDL. Document this in the command help + the SPEC.

## 7. Explicitly OUT of this dispatch (fast-follow M2-part-2 — note in PROGRESS.md, do NOT build)
- **Approach B** — `scrml build` emitting a `.sql` migration artifact for CI/review.
- **`scrml dev` auto-apply overlay** — the local inner-loop convenience.
- **S7-full** object-aware diff (policies/triggers/functions as first-class managed objects).
Keep this dispatch to the canonical `db-migrate` CLI + the acceptance gate + the fence + the thin ledger.

## 8. Discipline (MANDATORY)
- **NEVER `--no-verify`; never disable/override the hooks.** Pre-commit runs the full suite (~110-125s) — wait it out. Commit INCREMENTALLY (your branch is the crash anchor). Keep `docs/changes/db-authoritative-m2/PROGRESS.md` updated.
- `bun scripts/facts.ts --write` before any commit touching `compiler/src`/tests/SPEC.
- Existing suite green: `bun test compiler/tests/{unit,integration,conformance}`.
- WORKTREE: gitignored `dist/` absent in a fresh worktree — recompile as needed; not a regression. Local PG16 is available (socket `/var/run/postgresql`, peer-auth as your OS user, which has CREATEDB/CREATEROLE) for the acceptance test.
- Land on your worktree branch only; do NOT push to main. Report: branch + tip SHA, the `db-migrate` help output, the acceptance-test result WITH the actual PG run (the through-CLI negative test), the fence-gate test, full suite counts, and any place the brief was wrong. The PA runs an adversarial `/code-review high` + re-runs the through-CLI acceptance test independently before landing.
