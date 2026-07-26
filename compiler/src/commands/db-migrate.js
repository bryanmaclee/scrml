/**
 * @module commands/db-migrate
 * `scrml db-migrate` — apply a project's `<schema>` (incl. the §14.8.11
 * db-authoritative RLS/role DDL) to a REAL database (§14.8.11 Milestone 2, the
 * migration-apply seam). This is the APPLY inverse of `scrml introspect`'s EMIT:
 * introspect reads a live DB and emits `<schema>` source; db-migrate reads the
 * desired `<schema>` and applies the reconciling DDL to the live DB.
 *
 * Usage:
 *   scrml db-migrate <project-dir|entry.scrml> --db <connection-url> [options]
 *
 * Options:
 *   --db <url>            REQUIRED. The MIGRATOR connection string (a privileged
 *                        owner/migrator role — postgres:// or a SQLite path).
 *   --dry-run            Print the plan; apply NOTHING.
 *   --allow-destructive  Permit a bare `DROP TABLE` for a table that exists in the
 *                        DB but not in `<schema>` (default: refused — on Postgres a
 *                        DROP CASCADE-drops attached RLS policies/grants).
 *   --help, -h           Show this message.
 *
 * ── PRIVILEGE SEPARATION (load-bearing, §14.8.11) ──────────────────────────────
 * `--db` is the MIGRATOR/owner connection — a DDL-capable role that can `CREATE
 * ROLE`, `ALTER TABLE … FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, and `GRANT`.
 * The RUNNING APP is a DIFFERENT, bounded principal: the emitted server connects
 * as a login role that only ever `SET LOCAL ROLE scrml_app` (a `NOLOGIN
 * NOBYPASSRLS` role with CRUD-only grants). The app process is, BY DESIGN, unable
 * to apply or alter the security DDL — a role that could install the RLS policy
 * could also `DROP POLICY` it. So the apply step is out-of-app, run by an operator
 * / CI under the migrator credential — NEVER by the app runtime (auto-apply-on-boot
 * is eliminated for Postgres). This mirrors PostgREST's migrator-vs-authenticator
 * discipline.
 *
 * Postgres is the acceptance-gated, db-authoritative-capable target. SQLite gets a
 * general `<schema>`-apply (no roles/policies) so a plain `<schema>` finally
 * does-something-at-deploy for every adopter.
 */

import { readFileSync, statSync } from "fs";
import { resolve } from "path";
import { SQL } from "bun";
import { Database } from "bun:sqlite";
import { resolveDbDriver } from "../codegen/db-driver.ts";
import { splitBlocks } from "../block-splitter.js";
import { buildAST } from "../ast-builder.js";
import { extractDesiredSchema } from "../codegen/db-authoritative.ts";
import {
  diffSchema,
  readActualSchema,
  readActualSchemaPg,
  DBAUTH_ROLE,
} from "../schema-differ.js";
import { scanDirectory } from "../api.js";

const isTTY = process.stderr.isTTY;
const c = {
  red: (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// A fixed advisory-lock key so concurrent `scrml db-migrate` runs against the same
// database serialize (the ledger's concurrency job — Fork 4). Taken transaction-
// scoped (`pg_advisory_xact_lock`) so it auto-releases at commit/rollback — no lock
// leak if the migrator process dies mid-apply.
const ADVISORY_LOCK_KEY = 6432346327;

// The THIN `_scrml_migrations` ledger (Fork 4): apply-atomicity + object-authorship,
// NOT a versioned migration-file history. One row per applied statement records what
// scrml authored (kind/name) + a content hash — so an audit can answer "did scrml
// author this object" without an S7-full object-aware differ.
const LEDGER_DDL =
  `CREATE TABLE IF NOT EXISTS "_scrml_migrations" (\n` +
  `  id bigserial PRIMARY KEY,\n` +
  `  applied_at timestamptz NOT NULL DEFAULT now(),\n` +
  `  object_kind text NOT NULL,\n` +
  `  object_name text NOT NULL,\n` +
  `  ddl_hash text NOT NULL\n` +
  `);`;

function printHelp() {
  console.log(`scrml db-migrate — apply a project's <schema> (incl. the db-authoritative
RLS/role DDL) to a real database (§14.8.11 Milestone 2).

Usage:
  scrml db-migrate <project-dir|entry.scrml> --db <connection-url> [options]

Options:
  --db <url>            REQUIRED. The MIGRATOR connection string — a privileged
                        owner/migrator role (postgres://... ) or a SQLite path
                        (./app.db, sqlite:./app.db, :memory:).
  --dry-run             Print the reconcile plan; apply NOTHING.
  --allow-destructive   Permit a bare DROP TABLE for a table present in the DB but
                        absent from <schema> (default: refused — on Postgres a DROP
                        CASCADE-drops attached RLS policies/grants).
  --help, -h            Show this message.

Privilege separation (§14.8.11): --db is the MIGRATOR/owner credential (can run
CREATE ROLE / FORCE ROW LEVEL SECURITY / CREATE POLICY / GRANT). The running app
connects as a DIFFERENT, bounded principal (SET LOCAL ROLE scrml_app — NOLOGIN
NOBYPASSRLS, CRUD-only) and can NEVER apply or alter the security DDL. Run this as
an operator / CI step, never from the app process.`);
}

/**
 * Parse the db-migrate argv. Returns { input, dbUrl, dryRun, allowDestructive,
 * help } or exits(1) on a malformed / unrecognized flag. Exported for unit tests.
 */
export function parseArgs(args) {
  let input = null;
  let dbUrl = null;
  let dryRun = false;
  let allowDestructive = false;
  let help = false;

  const requireValue = (flag, i, what) => {
    if (i + 1 >= args.length) {
      console.error(c.red("error:") + ` ${flag} requires ${what}`);
      console.error(c.dim("Run `scrml db-migrate --help` for usage."));
      process.exit(1);
    }
  };
  const requireNonEmpty = (flag, value, what) => {
    if (value === "") {
      console.error(c.red("error:") + ` ${flag} requires ${what}`);
      console.error(c.dim("Run `scrml db-migrate --help` for usage."));
      process.exit(1);
    }
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--db") {
      requireValue("--db", i, "a connection URL");
      dbUrl = args[++i];
    } else if (a.startsWith("--db=")) {
      dbUrl = a.slice("--db=".length);
      requireNonEmpty("--db", dbUrl, "a connection URL");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--allow-destructive") {
      allowDestructive = true;
    } else if (!a.startsWith("-") && input === null) {
      input = a;
    } else {
      console.error(c.red("error:") + ` unrecognized argument: ${a}`);
      console.error(c.dim("Run `scrml db-migrate --help` for usage."));
      process.exit(1);
    }
  }

  return { input, dbUrl, dryRun, allowDestructive, help };
}

/**
 * Parse a project (a single `.scrml` entry or a directory of them) into the
 * desired `<schema>` table set. Reuses the live parse pipeline (splitBlocks →
 * buildAST) + `extractDesiredSchema`. Merges tables across files (first
 * declaration of a name wins). Returns { tables, parseErrors } or { error }.
 */
function parseProjectSchema(input) {
  const abs = resolve(process.cwd(), input);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { error: `cannot find file or directory: ${input}` };
  }

  let files;
  if (st.isDirectory()) {
    files = scanDirectory(abs);
    if (files.length === 0) return { error: `no .scrml files found in ${input}` };
  } else {
    files = [abs];
  }

  const tables = [];
  const seenNames = new Set();
  const parseErrors = [];
  for (const f of files) {
    let source;
    try {
      source = readFileSync(f, "utf8");
    } catch (e) {
      parseErrors.push(`${f}: ${e.message}`);
      continue;
    }
    let ast;
    try {
      ast = buildAST(splitBlocks(f, source)).ast;
    } catch (e) {
      parseErrors.push(`${f}: ${e.message}`);
      continue;
    }
    if (!ast) continue;
    for (const t of extractDesiredSchema(ast).tables) {
      if (!seenNames.has(t.name)) {
        seenNames.add(t.name);
        tables.push(t);
      }
    }
  }
  return { tables, parseErrors };
}

/**
 * Classify a DDL statement into { kind, name } for the ledger's object-authorship
 * row. Coarse-grained on purpose (authorship, not a parser). Exported for unit tests.
 */
export function classifyStatement(stmt) {
  const s = stmt.trim();
  let m;
  if ((m = /^CREATE TABLE(?: IF NOT EXISTS)?\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "table", name: m[1] };
  if ((m = /^CREATE POLICY\s+(\w+)\s+ON\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "policy", name: `${m[1]} ON ${m[2]}` };
  if ((m = /CREATE ROLE\s+(\w+)/i.exec(s))) return { kind: "role", name: m[1] };
  if ((m = /^GRANT\b[\s\S]*?\bON\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "grant", name: m[1] };
  if ((m = /^ALTER TABLE\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "alter", name: m[1] };
  if ((m = /^DROP POLICY IF EXISTS\s+(\w+)\s+ON\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "drop-policy", name: `${m[1]} ON ${m[2]}` };
  if ((m = /^DROP TABLE IF EXISTS\s+"?([A-Za-z_][\w$]*)"?/i.exec(s)))
    return { kind: "drop-table", name: m[1] };
  return { kind: "ddl", name: "" };
}

/** Render a (possibly multi-line) statement on one line for plan display. */
function oneLine(stmt) {
  const flat = stmt.replace(/\s+/g, " ").trim().replace(/;$/, "");
  return flat.length > 140 ? flat.slice(0, 137) + "…" : flat;
}

function printPlan(plan, actualTableCount) {
  console.log(c.dim(`reading actual state … ${actualTableCount} table(s)`));
  if (plan.length === 0) {
    console.log(c.green("plan: up to date — 0 statements."));
    return;
  }
  console.log(`plan (desired vs actual) — ${plan.length} statement(s):`);
  for (const stmt of plan) console.log(`  ${c.green("+")} ${oneLine(stmt)}`);
}

/** Close a Bun.SQL handle, tolerating .end()/.close() presence + teardown errors. */
async function closeSql(sql) {
  try {
    if (typeof sql.end === "function") await sql.end();
    else if (typeof sql.close === "function") await sql.close();
  } catch {
    /* never let teardown mask a successful apply */
  }
}

// --- Postgres apply (the acceptance-gated, db-authoritative-capable path) ------

/**
 * Read actual PG state for the diff PLUS a narrow scrml-managed policy/role
 * presence read (Fork 2 — minimal object-awareness, NOT the S7-full object-aware
 * differ). `diffSchema` consumes only `.tables`; the presence fields feed the
 * honest plan + the fence.
 */
async function readActualForApply(handle) {
  const { tables, warnings } = await readActualSchemaPg(handle);
  const policyRows = await handle`
    SELECT policyname, tablename FROM pg_policies WHERE policyname LIKE 'scrml\\_%'
  `;
  const roleRows = await handle`SELECT rolname FROM pg_roles WHERE rolname = ${DBAUTH_ROLE}`;
  return {
    tables,
    warnings: warnings ?? [],
    managedPolicies: policyRows.map((r) => ({ name: r.policyname, table: r.tablename })),
    hasAppRole: roleRows.length > 0,
  };
}

async function runPgApply({ connectionString, desired, dryRun, allowDestructive }) {
  let sql;
  try {
    sql = new SQL(connectionString);
  } catch (e) {
    console.error(c.red("error:") + ` failed to connect to Postgres: ${e.message}`);
    process.exit(1);
  }

  try {
    if (dryRun) {
      // Read-only: no lock, no ledger, no txn — just read/diff/print.
      const actual = await readActualForApply(sql);
      for (const w of actual.warnings) console.error(c.yellow(w));
      const { sql: plan, warnings } = diffSchema(desired, actual, {
        driver: "postgres",
        allowDestructive,
      });
      for (const w of warnings) console.error(c.yellow(w));
      printPlan(plan, actual.tables.length);
      if (actual.hasAppRole || actual.managedPolicies.length > 0) {
        console.log(
          c.dim(
            `scrml-managed objects present: role ${DBAUTH_ROLE}=${actual.hasAppRole}, ` +
              `policies=[${actual.managedPolicies.map((p) => `${p.name} on ${p.table}`).join(", ")}] ` +
              `— idempotent DDL re-asserts them.`,
          ),
        );
      }
      console.error(c.dim("--dry-run: no statements applied."));
      return;
    }

    const result = await sql.begin(async (tx) => {
      // (1) serialize concurrent migrators — auto-released at commit/rollback.
      await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
      // (2) ensure the thin authorship+atomicity ledger.
      await tx.unsafe(LEDGER_DDL);
      // (3) actual state (+ narrow scrml-managed presence).
      const actual = await readActualForApply(tx);
      // (4) reconcile.
      const { sql: plan, warnings } = diffSchema(desired, actual, {
        driver: "postgres",
        allowDestructive,
      });
      printPlan(plan, actual.tables.length);
      // (5) apply each statement in the txn + record authorship. If any statement
      // throws, `sql.begin` rolls the WHOLE run back (atomicity — the ledger is
      // never left half-written).
      for (const stmt of plan) {
        await tx.unsafe(stmt);
        const { kind, name } = classifyStatement(stmt);
        await tx`
          INSERT INTO "_scrml_migrations" (object_kind, object_name, ddl_hash)
          VALUES (${kind}, ${name}, ${String(Bun.hash(stmt))})
        `;
      }
      const fenced = warnings.filter((w) => w.includes("W-SCHEMA-DESTRUCTIVE-DROP"));
      return { count: plan.length, warnings, fencedCount: fenced.length };
    });

    for (const w of result.warnings) console.error(c.yellow(w));
    console.log(
      c.green(`applied ${result.count} statement(s) in 1 transaction.`) +
        (result.fencedCount > 0
          ? c.dim(
              ` fence: ${result.fencedCount} unmanaged table(s) left untouched ` +
                `(re-run with --allow-destructive to drop).`,
            )
          : ""),
    );
  } catch (e) {
    console.error(c.red("error:") + ` migration failed (rolled back): ${e.message}`);
    await closeSql(sql);
    process.exit(1);
  }
  await closeSql(sql);
}

// --- SQLite apply (Fork 5 — general <schema>-does-something-at-deploy) ----------

function sqlitePath(connectionString) {
  if (connectionString.startsWith("sqlite:")) return connectionString.slice("sqlite:".length);
  return connectionString;
}

function runSqliteApply({ connectionString, desired, dryRun, allowDestructive }) {
  const path = sqlitePath(connectionString);
  let db;
  try {
    db = new Database(path);
  } catch (e) {
    console.error(c.red("error:") + ` failed to open SQLite database "${path}": ${e.message}`);
    process.exit(1);
  }

  try {
    const actual = readActualSchema(db);
    const { sql: plan, warnings } = diffSchema(desired, actual, {
      driver: "sqlite",
      allowDestructive,
    });
    for (const w of warnings) console.error(c.yellow(w));
    printPlan(plan, actual.tables.length);

    if (dryRun) {
      console.error(c.dim("--dry-run: no statements applied."));
      return;
    }

    // Atomicity: apply the whole plan in one transaction (SQLite is single-writer,
    // so no advisory lock / role model is needed — the Postgres path's concurrency
    // + privilege machinery is additive on top of this general base).
    db.run("BEGIN");
    try {
      for (const stmt of plan) db.run(stmt);
      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
    console.log(c.green(`applied ${plan.length} statement(s) in 1 transaction.`));
  } catch (e) {
    console.error(c.red("error:") + ` migration failed (rolled back): ${e.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

export async function runDbMigrate(args) {
  const { input, dbUrl, dryRun, allowDestructive, help } = parseArgs(args);

  if (help) {
    printHelp();
    return;
  }
  if (!input) {
    console.error(c.red("error:") + " scrml db-migrate requires a project directory or entry .scrml file");
    console.error(c.dim("Run `scrml db-migrate --help` for usage."));
    process.exit(1);
  }
  if (!dbUrl) {
    console.error(c.red("error:") + " scrml db-migrate requires --db <connection-url> (the MIGRATOR credential)");
    console.error(c.dim("Run `scrml db-migrate --help` for usage."));
    process.exit(1);
  }

  const resolved = resolveDbDriver(dbUrl);
  if (!resolved.ok) {
    console.error(c.red("error:") + " " + resolved.error.message);
    process.exit(1);
  }
  const driver = resolved.info.driver;
  if (driver === "mysql") {
    console.error(
      c.red("error:") +
        " scrml db-migrate does not support MySQL (Phase 3). Target Postgres or SQLite.",
    );
    process.exit(1);
  }

  const parsed = parseProjectSchema(input);
  if (parsed.error) {
    console.error(c.red("error:") + " " + parsed.error);
    process.exit(1);
  }
  for (const pe of parsed.parseErrors ?? []) {
    console.error(c.yellow("warning:") + ` skipped a source file that failed to parse — ${pe}`);
  }

  const desired = { tables: parsed.tables };
  if (desired.tables.length === 0) {
    console.error(c.dim("no <schema> tables found — nothing to apply."));
    return;
  }

  // db-authoritative is Postgres-only (SQLite has no roles/policies/RLS). Applying
  // a db-authoritative schema against a non-Postgres target is the E-DBAUTH-SQLITE
  // trap at the deploy layer — fail closed, mirroring the compile-time gate.
  const hasDbAuth = desired.tables.some((t) => t.dbAuthoritative);
  if (hasDbAuth && driver !== "postgres") {
    console.error(
      c.red("error:") +
        " E-DBAUTH-SQLITE: this project declares db-authoritative table(s), which require a " +
        `Postgres target (RLS / roles / GRANT are Postgres-only). The --db URL resolves to the ` +
        `"${driver}" driver. Provide a postgres:// migrator URL.`,
    );
    process.exit(1);
  }

  if (driver === "postgres") {
    await runPgApply({
      connectionString: resolved.info.connectionString,
      desired,
      dryRun,
      allowDestructive,
    });
  } else {
    runSqliteApply({
      connectionString: resolved.info.connectionString,
      desired,
      dryRun,
      allowDestructive,
    });
  }
}
