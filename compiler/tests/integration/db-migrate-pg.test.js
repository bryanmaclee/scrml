/**
 * §14.8.11 Milestone 2 — the migration-apply seam (`scrml db-migrate`) THROUGH-CLI
 * acceptance gate.
 *
 * THE atomic-milestone proof that the tier is turnkey-from-source: M1 EMITS the
 * db-authoritative DDL; M2 APPLIES it. This test drives the REAL CLI
 * (`scrml db-migrate <project> --db <migrator-url>`) against a live Postgres 16 as
 * a NON-superuser owner/migrator role — exactly the deploy posture — then proves the
 * M1 negative test passes THROUGH the CLI:
 *   (a) a bounded `scrml_app` connection with NO `set_config` reads ZERO rows;
 *   (b) with `set_config('scrml.tenant', <tenantA>)` reads ONLY tenant-A rows.
 * Plus: the thin `_scrml_migrations` ledger records object-authorship, and a re-run
 * is idempotent (the differ + DDL are desired-state / idempotent).
 *
 * PRIVILEGE SEPARATION (the load-bearing invariant): the CLI applies as the MIGRATOR
 * (a LOGIN role with CREATEROLE that OWNS the scratch DB → owns the table it
 * creates). The runtime principal is DIFFERENT — a bounded `SET LOCAL ROLE scrml_app`
 * (NOLOGIN NOBYPASSRLS). This test mirrors that split: it bootstraps the migrator via
 * peer-auth admin, drives the CLI over a TCP `postgres://` URL, then verifies as the
 * bounded role.
 *
 * CI REALITY (mirrors db-authoritative-pg.test.js): the cloud gate CANNOT host live
 * Postgres, so this SKIPS GRACEFULLY when the `/var/run/postgresql` socket is
 * unreachable (or `SCRML_PGTEST=0`). It is the LOCAL acceptance proof.
 *
 * Run locally: `bun test compiler/tests/integration/db-migrate-pg.test.js`
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SUFFIX = `${process.pid}`;
const MIGRATOR = `scrml_m2_migrator_${SUFFIX}`;
const MIGRATOR_PW = "scrml_m2_pw";
const SCRATCH_DB = `scrml_m2_dbmigrate_${SUFFIX}`;
const CLI = join(import.meta.dir, "..", "..", "src", "cli.js");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// The RediLedger `invoices` shape — declared as a project the CLI parses from source.
const PROJECT_SRC = `<program db="postgres://placeholder">
  <schema>
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      amount: decimal not null
      kind: text oneOf(["income","expense"])
    } db-authoritative
  </schema>
</program>
`;

// --- Connectivity probe (load-time; disables the suite on failure) ---------
let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  PG_OK = await probe
    .unsafe("SELECT 1")
    .then(() => true)
    .catch(() => false);
  await probe.close().catch(() => {});
}
if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(
    "[db-migrate-pg] Postgres not reachable on " +
      `${SOCK} — skipping the live through-CLI apply-seam acceptance test (local-only gate).`,
  );
}

const d = PG_OK ? describe : describe.skip;

d("§14.8.11 M2 — scrml db-migrate through-CLI acceptance (live Postgres)", () => {
  let projectDir;
  let migratorUrl;
  let cliExit;
  let cliStdout;
  let m; // the migrator TCP connection used for verification

  beforeAll(async () => {
    // Bootstrap the migrator role + a scratch DB it OWNS (peer-auth admin).
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR}`).catch(() => {});
    await admin.unsafe(
      `CREATE ROLE ${MIGRATOR} LOGIN PASSWORD '${MIGRATOR_PW}' CREATEROLE CREATEDB`,
    );
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB} OWNER ${MIGRATOR}`);

    // Write the project the CLI will read from source.
    projectDir = mkdtempSync(join(tmpdir(), "scrml-m2-"));
    writeFileSync(join(projectDir, "app.scrml"), PROJECT_SRC);

    // Drive the REAL CLI as the migrator over a TCP postgres:// URL (the deploy shape).
    migratorUrl = `postgres://${MIGRATOR}:${MIGRATOR_PW}@localhost:5432/${SCRATCH_DB}`;
    const proc = Bun.spawn(
      [process.execPath, CLI, "db-migrate", join(projectDir, "app.scrml"), "--db", migratorUrl],
      { stdout: "pipe", stderr: "pipe" },
    );
    cliStdout = await new Response(proc.stdout).text();
    await proc.exited;
    cliExit = proc.exitCode;

    // Verify as the bounded principal. The migrator owns the table (would BYPASS
    // FORCE RLS as owner) → drop to scrml_app. Grant scrml_app MEMBERSHIP to the
    // migrator so it can SET LOCAL ROLE — via the peer ADMIN (superuser), because
    // `scrml_app` is cluster-global and may have been created by a SIBLING PG test's
    // migrator (a non-superuser lacks the ADMIN option to grant a role it did not
    // create). Then seed both tenants under the bounded role (WITH CHECK holds).
    await admin.unsafe(`GRANT scrml_app TO ${MIGRATOR}`);
    await admin.close();

    m = new SQL(migratorUrl);
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 100.00)`;
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 200.00)`;
    });
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_B}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_B}, 999.00)`;
    });
  });

  afterAll(async () => {
    if (m) await m.close().catch(() => {});
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR}`).catch(() => {});
    // Leave the cluster-global `scrml_app` role in place (mirrors db-authoritative-pg
    // test) — it is NOLOGIN + harmless, and dropping it can race a parallel PG test.
    await admin.close().catch(() => {});
  });

  test("the CLI applied the M1 db-authoritative DDL and exited 0", () => {
    expect(cliExit).toBe(0);
    // The plan printed by the CLI proves the M1 emitter ran (not a hand-written DDL).
    expect(cliStdout).toContain('CREATE TABLE "invoices"');
    expect(cliStdout).toContain("CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS");
    expect(cliStdout).toContain("FORCE ROW LEVEL SECURITY");
    expect(cliStdout).toContain("CREATE POLICY scrml_tenant_iso");
    // S288 — 7 -> 9: the single table-level GRANT became GRANT + REVOKE UPDATE +
    // column-scoped GRANT UPDATE (PK + tenant_id are auto-immutable).
    expect(cliStdout).toContain("applied 9 statement(s) in 1 transaction.");
  });

  test("(a) bounded role, NO set_config → ZERO rows (fail-closed, THROUGH the CLI apply)", async () => {
    const rows = await m.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT count(*)::int AS n FROM invoices`;
    });
    expect(rows[0].n).toBe(0);
  });

  test("(b) bounded role WITH set_config(tenantA) → ONLY tenant-A rows", async () => {
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT tenant_id FROM invoices`;
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  // S288 — g-db-migrate-check-constraint-oneof-pattern sub-bug 1. The fixture's
  // `kind` column uses the CANONICAL scrml string quote (`"`), which is SQL's
  // IDENTIFIER quote. Emitted verbatim it produced `CHECK (kind IN ("income",…))`
  // and this whole migration FAILED at apply with `column "income" does not
  // exist` (reproduced end-to-end pre-fix). These two tests lock the real applied
  // constraint, not just the emitted text — the "emitted ≠ runs" lesson.
  // Runs inside a DELIBERATELY rolled-back transaction so it leaves no row behind
  // — the later idempotency test asserts an exact tenant-A row count.
  test("S288: a double-quoted oneOf applied a WORKING CHECK — declared value accepted", async () => {
    const ROLLBACK = Symbol("rollback");
    let accepted = null;
    try {
      await m.begin(async (tx) => {
        await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
        await tx.unsafe("SET LOCAL ROLE scrml_app");
        await tx`INSERT INTO invoices (id, tenant_id, amount, kind)
                 VALUES (gen_random_uuid(), ${TENANT_A}, 5.00, 'income')`;
        const r = await tx`SELECT count(*)::int AS n FROM invoices WHERE kind = 'income'`;
        accepted = r[0].n;
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    expect(accepted).toBe(1);
  });

  test("S288: the applied CHECK REJECTS a value outside the oneOf set", async () => {
    let threw = null;
    try {
      await m.begin(async (tx) => {
        await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
        await tx.unsafe("SET LOCAL ROLE scrml_app");
        await tx`INSERT INTO invoices (id, tenant_id, amount, kind)
                 VALUES (gen_random_uuid(), ${TENANT_A}, 5.00, 'bogus')`;
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(String(threw?.message ?? threw)).toMatch(/check constraint/i);
  });

  test("the thin _scrml_migrations ledger recorded object-authorship", async () => {
    const rows = await m`SELECT object_kind, object_name FROM "_scrml_migrations" ORDER BY id`;
    const kinds = rows.map((r) => r.object_kind);
    expect(kinds).toContain("table");
    expect(kinds).toContain("role");
    expect(kinds).toContain("policy");
    // Authorship answers "did scrml author scrml_tenant_iso" — the fence's table-grain sibling.
    expect(rows.some((r) => r.object_name.includes("scrml_tenant_iso"))).toBe(true);
  });

  test("re-running db-migrate is idempotent (desired-state reconcile) and stays enforced", async () => {
    const proc = Bun.spawn(
      [process.execPath, CLI, "db-migrate", join(projectDir, "app.scrml"), "--db", migratorUrl],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    // The table already exists → CREATE TABLE is NOT re-emitted; the idempotent
    // db-authoritative statements re-assert. Enforcement still holds.
    expect(out).not.toContain('CREATE TABLE "invoices"');
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT count(*)::int AS n FROM invoices`;
    });
    expect(rows[0].n).toBe(2);
  });
});

// ── SECURITY (PA-found HIGH) — a malicious live-DB column name must NOT break out
// of its identifier and inject a policy executed as the migrator. The ACTUAL schema
// carries a column named with the injection payload; `scrml db-migrate` diffs it
// (→ DROP COLUMN) and MUST apply it as one escaped statement, leaving tenant
// isolation intact (bounded no-GUC read stays 0 rows; the injected `pleak` policy
// never gets created). ─────────────────────────────────────────────────────────
const MIGRATOR2 = `scrml_m2_secmig_${SUFFIX}`;
const SCRATCH_DB2 = `scrml_m2_secdb_${SUFFIX}`;
// The exact review PoC — a column name that, interpolated naively, closes the
// identifier and appends a permissive policy (USING (true) → all tenants visible).
const INJECT_COL = `amount"; CREATE POLICY pleak ON invoices USING (true); --`;

d("§14.8.11 M2 SECURITY — malicious live-DB identifier cannot inject via db-migrate", () => {
  let projectDir;
  let migratorUrl;
  let run2Exit;
  let m;

  beforeAll(async () => {
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB2}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR2}`).catch(() => {});
    await admin.unsafe(`CREATE ROLE ${MIGRATOR2} LOGIN PASSWORD '${MIGRATOR_PW}' CREATEROLE CREATEDB`);
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB2} OWNER ${MIGRATOR2}`);

    projectDir = mkdtempSync(join(tmpdir(), "scrml-m2-sec-"));
    writeFileSync(join(projectDir, "app.scrml"), PROJECT_SRC);
    migratorUrl = `postgres://${MIGRATOR2}:${MIGRATOR_PW}@localhost:5432/${SCRATCH_DB2}`;

    // Run #1 — normal apply (creates invoices + RLS).
    const p1 = Bun.spawn(
      [process.execPath, CLI, "db-migrate", join(projectDir, "app.scrml"), "--db", migratorUrl],
      { stdout: "pipe", stderr: "pipe" },
    );
    await new Response(p1.stdout).text();
    await p1.exited;

    m = new SQL(migratorUrl);
    // Inject the malicious column into the ACTUAL schema (hand-escaped in THIS setup
    // so the column is LITERALLY named the payload — the hostile/pre-existing state).
    const escaped = INJECT_COL.replace(/"/g, '""');
    await m.unsafe(`ALTER TABLE invoices ADD COLUMN "${escaped}" text`);

    await admin.unsafe(`GRANT scrml_app TO ${MIGRATOR2}`);
    await admin.close();

    // Run #2 — the ATTACK TRIGGER: desired has no payload column → the differ emits
    // ALTER TABLE … DROP COLUMN "<payload>". A correct escape keeps it one statement.
    const p2 = Bun.spawn(
      [process.execPath, CLI, "db-migrate", join(projectDir, "app.scrml"), "--db", migratorUrl],
      { stdout: "pipe", stderr: "pipe" },
    );
    await new Response(p2.stdout).text();
    await p2.exited;
    run2Exit = p2.exitCode;

    // Seed both tenants (bounded role) so a bypass would be observable as >0 rows.
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 100.00)`;
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_A}, 200.00)`;
    });
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_B}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`INSERT INTO invoices (id, tenant_id, amount) VALUES (gen_random_uuid(), ${TENANT_B}, 999.00)`;
    });
  });

  afterAll(async () => {
    if (m) await m.close().catch(() => {});
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB2}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR2}`).catch(() => {});
    await admin.close().catch(() => {});
  });

  test("db-migrate over a malicious-identifier schema applies cleanly (exit 0)", () => {
    expect(run2Exit).toBe(0);
  });

  test("the injected `pleak` policy was NOT created (no break-out)", async () => {
    const rows = await m`SELECT policyname FROM pg_policies WHERE tablename = 'invoices'`;
    const names = rows.map((r) => r.policyname);
    expect(names).toContain("scrml_tenant_iso");
    expect(names).not.toContain("pleak");
  });

  test("tenant isolation HOLDS through the malicious migration (bounded no-GUC → 0 rows)", async () => {
    const rows = await m.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT count(*)::int AS n FROM invoices`;
    });
    // If the injection had installed `pleak ON invoices USING (true)`, this would be 3.
    expect(rows[0].n).toBe(0);
  });
});
