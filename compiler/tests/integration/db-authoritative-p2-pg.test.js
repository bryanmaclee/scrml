/**
 * §14.8.11.2 DB-authoritative P2 (writes-authority) — the atomic-milestone
 * acceptance gate. THROUGH-CLI, against a real Postgres 16, as a NON-superuser
 * migrator/owner (the deploy posture).
 *
 * P2 is the FIRST milestone that crosses the §14.8.10 invariant/policy firewall —
 * scrml begins emitting AUTHORIZATION. "Looks enforced and isn't" risk is DOUBLED
 * (a mis-hardened SECDEF is a CVE-2020-25695 privesc vector, WORSE than none), so
 * the negative test is the only real proof. On the RediLedger `invoices` shape (an
 * `immutable` column + a SECDEF `fn`), after `scrml db-migrate` applies:
 *   (1) bounded scrml_app direct UPDATE of an immutable column           → DENIED;
 *   (2) bounded scrml_app mutation of a locked column NOT via the SECDEF → DENIED;
 *   (3) the SECDEF fn enforces the cap check — WITH scrml.principal.caps → succeeds,
 *       WITHOUT → raises `denied`;
 *   (4) the emitted SECDEF is hardened — pg_proc.prosecdef is true AND proconfig
 *       carries `search_path=pg_catalog, public` (+ EXECUTE not granted to PUBLIC).
 *
 * CI REALITY (mirrors db-migrate-pg.test.js): the cloud gate cannot host live PG, so
 * this SKIPS GRACEFULLY when the /var/run/postgresql socket is unreachable (or
 * SCRML_PGTEST=0). It is the LOCAL acceptance proof.
 *
 * Run locally: `bun test compiler/tests/integration/db-authoritative-p2-pg.test.js`
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SUFFIX = `${process.pid}`;
const MIGRATOR = `scrml_p2_migrator_${SUFFIX}`;
const MIGRATOR_PW = "scrml_p2_pw";
const SCRATCH_DB = `scrml_p2_dbauth_${SUFFIX}`;
const CLI = join(import.meta.dir, "..", "..", "src", "cli.js");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// The bounded SECDEF owner role is CLUSTER-GLOBAL (a PG role is not per-DB), so use a
// per-run-unique name — the migrator then always CREATEs it and holds ADMIN OPTION,
// making the ownership reassignment deterministic across re-runs (no residue clash).
const OWNER_ROLE = `invoice_admin_${SUFFIX}`;

// The RediLedger writes-authority shape: `status` + `amount` are immutable (only the
// SECDEF may void; the posted amount never changes); `memo` is freely mutable.
const PROJECT_SRC = `<program db="postgres://placeholder">
  <schema>
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      status: text not null immutable
      amount: decimal not null immutable
      memo: text
    } db-authoritative

    fn void_invoice(id: uuid) security definer owner(${OWNER_ROLE}) requires cap("void") {
      """
      UPDATE invoices SET status = 'void' WHERE invoices.id = void_invoice.id;
      """
    }
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
    "[db-authoritative-p2-pg] Postgres not reachable on " +
      `${SOCK} — skipping the live P2 writes-authority acceptance gate (local-only).`,
  );
}

const d = PG_OK ? describe : describe.skip;

d("§14.8.11.2 P2 writes-authority — through-CLI acceptance (live Postgres)", () => {
  let projectDir;
  let migratorUrl;
  let cliExit;
  let cliStdout;
  let cliStderr;
  let m; // migrator connection (verification)
  let invoiceA; // a seeded tenant-A invoice id

  beforeAll(async () => {
    // Bootstrap the migrator role + a scratch DB it OWNS (peer-auth admin).
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR}`).catch(() => {});
    await admin.unsafe(
      `CREATE ROLE ${MIGRATOR} LOGIN PASSWORD '${MIGRATOR_PW}' CREATEROLE CREATEDB`,
    );
    await admin.unsafe(`CREATE DATABASE ${SCRATCH_DB} OWNER ${MIGRATOR}`);

    projectDir = mkdtempSync(join(tmpdir(), "scrml-p2-"));
    writeFileSync(join(projectDir, "app.scrml"), PROJECT_SRC);

    // Drive the REAL CLI as the migrator over a TCP postgres:// URL (deploy shape).
    migratorUrl = `postgres://${MIGRATOR}:${MIGRATOR_PW}@localhost:5432/${SCRATCH_DB}`;
    const proc = Bun.spawn(
      [process.execPath, CLI, "db-migrate", join(projectDir, "app.scrml"), "--db", migratorUrl],
      { stdout: "pipe", stderr: "pipe" },
    );
    cliStdout = await new Response(proc.stdout).text();
    cliStderr = await new Response(proc.stderr).text();
    await proc.exited;
    cliExit = proc.exitCode;

    // Grant scrml_app membership to the migrator (so it can SET LOCAL ROLE for the
    // negative assertions) via the peer ADMIN — scrml_app is cluster-global and may
    // have been created by a sibling PG test's migrator.
    await admin.unsafe(`GRANT scrml_app TO ${MIGRATOR}`);
    await admin.close();

    m = new SQL(migratorUrl);
    // Seed a tenant-A + a tenant-B invoice under the bounded role (WITH CHECK holds).
    invoiceA = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      const r = await tx`INSERT INTO invoices (id, tenant_id, status, amount, memo)
        VALUES (gen_random_uuid(), ${TENANT_A}, 'open', 100.00, 'a') RETURNING id`;
      return r[0].id;
    });
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_B}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`INSERT INTO invoices (id, tenant_id, status, amount, memo)
        VALUES (gen_random_uuid(), ${TENANT_B}, 'open', 999.00, 'b')`;
    });
  });

  afterAll(async () => {
    if (m) await m.close().catch(() => {});
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    const admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${MIGRATOR}`).catch(() => {});
    // The per-run-unique owner role is dropped (its DB is gone, so nothing owns it).
    await admin.unsafe(`DROP ROLE IF EXISTS "${OWNER_ROLE}"`).catch(() => {});
    // Leave the cluster-global scrml_app role in place (NOLOGIN, harmless; dropping
    // can race a parallel PG test).
    await admin.close().catch(() => {});
  });

  test("the CLI applied the P2 DDL (S3 reshape + scrml_has_cap + the SECDEF) and exited 0", () => {
    if (cliExit !== 0) {
      // Surface the failure for triage (the plan/rollback reason is on stderr).
      // eslint-disable-next-line no-console
      console.error("db-migrate stderr:\n" + cliStderr + "\nstdout:\n" + cliStdout);
    }
    expect(cliExit).toBe(0);
    expect(cliStdout).toContain('CREATE TABLE "invoices"');
    expect(cliStdout).toContain("GRANT SELECT, INSERT, DELETE"); // S3 reshape (no table UPDATE)
    expect(cliStdout).toContain("REVOKE UPDATE");
    expect(cliStdout).toContain("scrml_has_cap");
    expect(cliStdout).toContain("void_invoice");
  });

  test("(1) bounded scrml_app direct UPDATE of an IMMUTABLE column → DENIED", async () => {
    let denied = false;
    try {
      await m.begin(async (tx) => {
        await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
        await tx.unsafe("SET LOCAL ROLE scrml_app");
        await tx`UPDATE invoices SET amount = 1 WHERE id = ${invoiceA}`;
      });
    } catch (e) {
      denied = /permission denied|not.*privilege/i.test(String(e.message ?? e));
    }
    expect(denied).toBe(true);
  });

  test("(2) bounded scrml_app mutation of the LOCKED status (not via the SECDEF) → DENIED", async () => {
    let denied = false;
    try {
      await m.begin(async (tx) => {
        await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
        await tx.unsafe("SET LOCAL ROLE scrml_app");
        await tx`UPDATE invoices SET status = 'void' WHERE id = ${invoiceA}`;
      });
    } catch (e) {
      denied = /permission denied|not.*privilege/i.test(String(e.message ?? e));
    }
    expect(denied).toBe(true);
    // And the status is untouched (still 'open').
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT status FROM invoices WHERE id = ${invoiceA}`;
    });
    expect(rows[0].status).toBe("open");
  });

  test("(3a) the SECDEF WITHOUT the cap raises `denied` (fail-closed capability gate)", async () => {
    let msg = "";
    try {
      await m.begin(async (tx) => {
        await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
        // no scrml.principal.caps set → scrml_has_cap('void') is false
        await tx.unsafe("SET LOCAL ROLE scrml_app");
        await tx`SELECT void_invoice(${invoiceA})`;
      });
    } catch (e) {
      msg = String(e.message ?? e);
    }
    expect(msg).toContain("denied");
    // status still 'open' — the SECDEF refused before mutating.
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT status FROM invoices WHERE id = ${invoiceA}`;
    });
    expect(rows[0].status).toBe("open");
  });

  test("(3b) the SECDEF WITH the cap succeeds — the sole sanctioned mutation path", async () => {
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx`SELECT set_config('scrml.principal.caps', ${'["void"]'}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`SELECT void_invoice(${invoiceA})`;
    });
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT status FROM invoices WHERE id = ${invoiceA}`;
    });
    expect(rows[0].status).toBe("void");
  });

  test("(4) the emitted SECDEF is HARDENED — prosecdef + search_path pin + no PUBLIC EXECUTE", async () => {
    const rows = await m`
      SELECT p.prosecdef, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
             has_function_privilege('scrml_app', p.oid, 'EXECUTE') AS app_exec
      FROM pg_proc p WHERE p.proname = 'void_invoice'
    `;
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.prosecdef).toBe(true); // SECURITY DEFINER
    const cfg = (r.proconfig ?? []).join(" | ");
    expect(cfg).toContain("search_path=pg_catalog, public"); // CVE-2020-25695 pin
    expect(cfg).not.toContain("pg_temp");
    expect(r.public_exec).toBe(false); // REVOKE EXECUTE FROM PUBLIC held
    expect(r.app_exec).toBe(true); // GRANT EXECUTE TO scrml_app held
  });

  test("bonus: scrml_app CAN update a MUTABLE column (memo) — the reshape is precise, not a blanket lock", async () => {
    await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      await tx`UPDATE invoices SET memo = 'edited' WHERE id = ${invoiceA}`;
    });
    const rows = await m.begin(async (tx) => {
      await tx`SELECT set_config('scrml.tenant', ${TENANT_A}, true)`;
      await tx.unsafe("SET LOCAL ROLE scrml_app");
      return await tx`SELECT memo FROM invoices WHERE id = ${invoiceA}`;
    });
    expect(rows[0].memo).toBe("edited");
  });
});
