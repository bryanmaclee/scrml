/**
 * S450 — g-transaction-block-not-recognized-inside-a-function-body (RUNTIME half).
 *
 * §19.10.2's normative example is a `transaction { }` inside a `!` function. It did
 * not parse there (E-SCOPE-001), and the lowering it would have reached rolled back
 * only before a `fail` that was a DIRECT child of the block — a `fail` inside an
 * `if` (the §19.10.2 example's own shape) returned with the transaction still OPEN.
 *
 * These tests EXECUTE the emitted server route handlers against a REAL bun:sqlite
 * file and read the result back through a SEPARATE connection:
 *   - commit on normal completion;
 *   - rollback on `fail` (nested in an `if`, and in a `match` arm) — state unchanged;
 *   - rollback on `?` propagation (§19.5.2: `?` is a `fail`) — state unchanged;
 *   - rollback on a SQL error — state unchanged, the error still propagates;
 *   - after every one of them NO transaction is left open (§19.10.4): a second
 *     connection with busy_timeout = 0 can take a write lock immediately.
 * Plus the §19.10.4 compile errors through the real pipeline, and the committed
 * sample `samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml`.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";

import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(testDir, "..", "..", "..");

const APP = (dbPath) => `<program db="${dbPath}">
\${
  type TransferError:enum = {
    InsufficientFunds(balance: number)
    Rejected
  }
  type Mode:enum = { Normal Strict }

  // \`server\`: a plain helper called from a server route is not emitted
  // server-side (pre-existing, unrelated to transactions).
  server function checkAmount(n)! -> TransferError {
    if (n > 1000) { fail TransferError::Rejected }
    return n
  }

  function transfer(from, to, amount)! -> TransferError {
    transaction {
      ?{\`UPDATE accounts SET balance = balance - \${amount} WHERE id = \${from}\`}.run()
      let row = ?{\`SELECT balance FROM accounts WHERE id = \${from}\`}.get()
      if (row.balance < 0) {
        fail TransferError::InsufficientFunds(row.balance)
      }
      ?{\`UPDATE accounts SET balance = balance + \${amount} WHERE id = \${to}\`}.run()
    }
  }

  function viaPropagate(amount)! -> TransferError {
    transaction {
      ?{\`UPDATE accounts SET balance = 555 WHERE id = 1\`}.run()
      let checked = checkAmount(amount)?
      ?{\`UPDATE accounts SET balance = 556 WHERE id = 2\`}.run()
    }
  }

  // EXPRESSION-position match: its arm's \`fail\` returns from the function. (A
  // STATEMENT-position match arm cannot hold a \`fail\` / \`?\` in a transaction —
  // E-TRANSACTION-CONTROL-FLOW, see the compile-error tests below.)
  function viaMatch(mode: Mode)! -> TransferError {
    transaction {
      ?{\`UPDATE accounts SET balance = 777 WHERE id = 1\`}.run()
      let next = match mode {
        .Strict :> fail TransferError::Rejected
        .Normal :> 778
      }
      ?{\`UPDATE accounts SET balance = \${next} WHERE id = 2\`}.run()
      ?{\`INSERT INTO log (msg) VALUES ('after-match')\`}.run()
    }
  }

  function sqlError(id)! -> TransferError {
    transaction {
      ?{\`UPDATE accounts SET balance = 999 WHERE id = 1\`}.run()
      ?{\`INSERT INTO accounts (id, balance) VALUES (\${id}, 0)\`}.run()
    }
  }
}
<p>x</>
</program>`;

let dir, outDir, dbPath, compileErrors, routes;

function seed() {
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS accounts");
  db.run("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)");
  db.run("INSERT INTO accounts (id, balance) VALUES (1, 10), (2, 0)");
  db.run("DROP TABLE IF EXISTS log");
  db.run("CREATE TABLE log (id INTEGER PRIMARY KEY, msg TEXT)");
  db.close();
}

function logRows() {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.query("SELECT msg FROM log ORDER BY id").all();
  db.close();
  return rows.map((r) => r.msg);
}

function balances() {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.query("SELECT id, balance FROM accounts ORDER BY id").all();
  db.close();
  return Object.fromEntries(rows.map((r) => [r.id, r.balance]));
}

/** §19.10.4 — no transaction left open: a SECOND connection gets the write lock at once. */
function noTransactionLeftOpen() {
  const db = new Database(dbPath);
  try {
    db.run("PRAGMA busy_timeout = 0");
    db.run("BEGIN IMMEDIATE");
    db.run("ROLLBACK");
    return true;
  } catch (e) {
    return String(e?.message ?? e);
  } finally {
    db.close();
  }
}

function req(route, body) {
  return new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: {
      "Cookie": "scrml_csrf=tok-s450",
      "X-CSRF-Token": "tok-s450",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

async function call(name, body) {
  const route = routes.find((r) => r.path.includes(`_${name}_`));
  expect(route).toBeTruthy();
  try {
    const res = await route.handler(req(route, body));
    return { status: res.status, body: await res.json() };
  } catch (e) {
    return { threw: String(e?.message ?? e) };
  }
}

beforeAll(async () => {
  if (typeof globalThis.document !== "undefined") return;
  dir = mkdtempSync(join(tmpdir(), "s450-tx-"));
  dbPath = join(dir, "bank.db").replace(/\\/g, "/");
  seed();
  const file = join(dir, "app.scrml");
  outDir = join(dir, "out");
  writeFileSync(file, APP(dbPath));
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  compileErrors = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning");
  const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Date.now()}`);
  routes = mod.routes || [];
});

afterAll(() => {
  try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY on Windows — the OS reclaims it */ }
});

describe("S450 — transaction { } in a `!` function body, EXECUTED against bun:sqlite", () => {
  test("compiles clean (was E-SCOPE-001)", () => {
    if (typeof globalThis.document !== "undefined") return;
    expect(compileErrors.map((e) => e.code)).toEqual([]);
  });

  test("normal completion COMMITs", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("transfer", { from: 1, to: 2, amount: 4 });
    expect(r.status).toBe(200);
    expect(r.body).toBe(null);
    expect(balances()).toEqual({ 1: 6, 2: 4 });
    expect(noTransactionLeftOpen()).toBe(true);
  });

  test("`fail` nested in an `if` ROLLs BACK: state unchanged, error variant returned", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("transfer", { from: 1, to: 2, amount: 100 });
    expect(r.status).toBe(200);
    expect(r.body.__scrml_error).toBe(true);
    expect(r.body.variant).toBe("InsufficientFunds");
    // the debit to -90 ran INSIDE the transaction and must be undone
    expect(balances()).toEqual({ 1: 10, 2: 0 });
    expect(noTransactionLeftOpen()).toBe(true);
  });

  test("`?` propagation ROLLs BACK (§19.5.2: `?` is a `fail`)", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const bad = await call("viaPropagate", { amount: 5000 });
    expect(bad.body?.variant).toBe("Rejected");
    expect(balances()).toEqual({ 1: 10, 2: 0 }); // the 555 write is undone
    expect(noTransactionLeftOpen()).toBe(true);
    const ok = await call("viaPropagate", { amount: 5 });
    expect(ok.status).toBe(200);
    expect(balances()).toEqual({ 1: 555, 2: 556 });
  });

  test("`fail` in an EXPRESSION-position `match` arm ROLLs BACK, and nothing after it runs; the other arm COMMITs", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const bad = await call("viaMatch", { mode: "Strict" });
    expect(bad.body?.variant).toBe("Rejected");
    expect(balances()).toEqual({ 1: 10, 2: 0 });
    expect(logRows()).toEqual([]); // the post-match write never ran
    expect(noTransactionLeftOpen()).toBe(true);
    await call("viaMatch", { mode: "Normal" });
    expect(balances()).toEqual({ 1: 777, 2: 778 });
    expect(logRows()).toEqual(["after-match"]);
  });

  test("a SQL error ROLLs BACK before it propagates; no lock is left behind", async () => {
    if (typeof globalThis.document !== "undefined") return;
    seed();
    const r = await call("sqlError", { id: 2 }); // id 2 exists → UNIQUE / PRIMARY KEY violation
    // the error still propagates out of the handler
    expect(r.threw ?? (r.status >= 400 ? "error-status" : null)).toBeTruthy();
    expect(balances()).toEqual({ 1: 10, 2: 0 }); // the 999 write is undone
    expect(noTransactionLeftOpen()).toBe(true);
    // and the connection is usable: the next transaction commits
    const ok = await call("transfer", { from: 1, to: 2, amount: 1 });
    expect(ok.status).toBe(200);
    expect(balances()).toEqual({ 1: 9, 2: 1 });
  });
});

describe("S450 — §19.10.4 compile errors through the real pipeline", () => {
  function compileCodes(src) {
    const d = mkdtempSync(join(tmpdir(), "s450-tx-neg-"));
    try {
      const f = join(d, "app.scrml");
      writeFileSync(f, src);
      const r = compileScrml({ inputFiles: [f], write: false, log: () => {} });
      return (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code);
    } finally {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  const PROG = (body) => `<program db="./app.db">
    <schema>
        orders {
            id: integer primary key
            name: text
        }
    </schema>
    type E:enum = { Bad }
    ${body}
    <p>x</p>
</program>`;

  test("non-`!` function → E-ERROR-001, not E-SCOPE-001", () => {
    const c = compileCodes(PROG("function f() { transaction { ?{`UPDATE orders SET name = 'a'`}.run() } }"));
    expect(c).toContain("E-ERROR-001");
    expect(c).not.toContain("E-SCOPE-001");
  });
  test("nested → E-ERROR-007", () => {
    const c = compileCodes(PROG("function f()! -> E { transaction { transaction { ?{`UPDATE orders SET name = 'a'`}.run() } } }"));
    expect(c).toEqual(["E-ERROR-007"]);
  });
  test("`return` out of the block → E-TRANSACTION-CONTROL-FLOW", () => {
    const c = compileCodes(PROG("function f(a)! -> E { transaction { if (a) { return 1 } ?{`UPDATE orders SET name = 'a'`}.run() } }"));
    expect(c).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });

  // S450 fix round (S239 review): a STATEMENT-position `match` arm lowers into a
  // nested function, so a `fail` / `?` in it returned from the arm only — the
  // transaction rolled back and the statements after the `match` then ran with NO
  // transaction and persisted (measured: log=["after-match"], and
  // log=["loop","loop","loop"] for a match inside a loop). Rejected at compile time.
  const M = "type M:enum = {\n        A\n        B\n    }\n    server function h(x)! -> E {\n        if (x > 1) { fail E::Bad }\n        return x\n    }\n";
  test("`fail` in a statement-match arm, write after the match → E-TRANSACTION-CONTROL-FLOW", () => {
    const c = compileCodes(PROG(M + "function f(m: M)! -> E { transaction { ?{`UPDATE orders SET name = 'a'`}.run()\n match m {\n .A :> { fail E::Bad }\n .B :> { let y = 1 }\n }\n ?{`UPDATE orders SET name = 'after-match'`}.run() } }"));
    expect(c).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("`?` in a statement-match arm → E-TRANSACTION-CONTROL-FLOW", () => {
    const c = compileCodes(PROG(M + "function f(m: M)! -> E { transaction {\n match m {\n .A :> { let x = h(5)? }\n .B :> { let y = 1 }\n }\n ?{`UPDATE orders SET name = 'after'`}.run() } }"));
    expect(c).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("statement-match with a `fail` arm inside a loop in the block → E-TRANSACTION-CONTROL-FLOW", () => {
    const c = compileCodes(PROG(M + "function f(m: M)! -> E { transaction { for (let i = 0; i < 3; i++) {\n match m {\n .A :> { fail E::Bad }\n .B :> { let z = 0 }\n }\n ?{`UPDATE orders SET name = 'loop'`}.run() } } }"));
    expect(c).toEqual(["E-TRANSACTION-CONTROL-FLOW"]);
  });
  test("expression-position match with a `fail` arm stays legal; a statement match WITHOUT fail/? stays legal", () => {
    const c = compileCodes(PROG(M + "function f(m: M)! -> E { transaction {\n let v = match m {\n .A :> fail E::Bad\n .B :> 2\n }\n match m {\n .A :> { ?{`UPDATE orders SET name = 'a'`}.run() }\n .B :> { let y = 1 }\n }\n ?{`UPDATE orders SET name = 'after'`}.run() } }"));
    expect(c).toEqual([]);
  });
});

describe("S450 — the committed sample", () => {
  test("samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml compiles", () => {
    const f = join(REPO_ROOT, "samples", "compilation-tests", "gauntlet-s20-sql", "sql-transaction-001.scrml");
    const r = compileScrml({ inputFiles: [f], write: false, log: () => {} });
    const errs = (r.errors ?? []).filter((e) => e.severity !== "warning" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code);
    expect(errs).toEqual([]);
  });
});
