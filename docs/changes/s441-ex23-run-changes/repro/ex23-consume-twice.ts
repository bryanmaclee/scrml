// s441-ex23-run-changes repro (verified on 5c366fe15). Drives the REAL compiled
// example-23 handlers. Usage: compile examples/23-trucking-dispatch to <dist>, then
//   bun ex23-consume-twice.ts <dist> examples/23-trucking-dispatch
// Execution repro for s441-ex23-run-changes.
// Usage: bun repro.ts <compiled-dist-dir> <example-src-dir>
// Drives the REAL compiled example-23 server handlers against a seeded copy
// of dispatch.db and calls each one-time-token consume path.
import { Database } from "bun:sqlite";
import { copyFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";

const dist = resolve(process.argv[2]);
const src = resolve(process.argv[3]);
process.chdir(dist);
for (const f of ["dispatch.db", "dispatch.db-wal", "dispatch.db-shm", "dispatch-sessions.db", "dispatch-sessions.db-wal", "dispatch-sessions.db-shm"]) {
  if (existsSync(f)) rmSync(f);
}
copyFileSync(resolve(src, "dispatch.db"), resolve(dist, "dispatch.db"));

const db = new Database(resolve(dist, "dispatch.db"));
db.exec(`
  INSERT INTO users (id, email, password_hash, role) VALUES (1, 'd@x', 'h', 'driver'), (2, 'c@x', 'h', 'customer');
  INSERT INTO drivers (id, user_id, name, current_status) VALUES (1, 1, 'Dee', 'off-duty');
  INSERT INTO customers (id, user_id, name, payment_terms, account_status) VALUES (1, 2, 'Cust', 'net30', 'active');
  INSERT INTO loads (id, customer_id, status) VALUES (1, 1, 'InTransit'), (2, 1, 'Booked'), (3, 1, 'Booked'), (4, 1, 'Delivered'), (5, 1, 'Delivered'), (6, 1, 'Booked');
  INSERT INTO invoices (id, load_id, customer_id, amount_dollars) VALUES (1, 4, 1, 100), (2, 5, 1, 200);
  INSERT INTO lin_tokens (token, load_id, kind) VALUES
    ('bol-tok', 1, 'bol'), ('acc-tok', 2, 'acceptance'), ('acc-tok-race', 6, 'acceptance'), ('pay-tok', 4, 'payment');
`);

// Framework session (auth gate + CSRF) — shared Map, read via globalThis.
const sess = new Map();
sess.set("sid-driver", { userId: 1, role: "driver", csrfToken: "csrf-d" });
sess.set("sid-cust", { userId: 2, role: "customer", csrfToken: "csrf-c" });
(globalThis as any).__scrml_session_store = sess;

// App-level session store (models/auth getCurrentUser(sessionToken)).
const { createSessionStore } = await import(resolve(dist, "_scrml/store.js"));
const appStore = createSessionStore("./dispatch-sessions.db");
appStore.set("app-driver", 1);
appStore.set("app-cust", 2);

async function route(mod: string, name: string) {
  const m = await import(resolve(dist, mod));
  const r = m.routes.find((r: any) => r.path.includes(`__ri_route_${name}_`));
  if (!r) throw new Error(`route ${name} not found in ${mod}`);
  return r;
}
function call(r: any, sid: string, csrf: string, body: any) {
  return r.handler(new Request(`http://localhost${r.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": `__Host-scrml_sid=${sid}`, "X-CSRF-Token": csrf },
    body: JSON.stringify(body),
  })).then(async (res: Response) => `${res.status} ${await res.text()}`);
}
const q = (s: string) => db.query(s).all();

const bol = await route("driver/load-detail.server.js", "uploadBolServer");
const acc = await route("customer/load-detail.server.js", "signRateConfirmationServer");
const pay = await route("customer/invoices.server.js", "markPaidServer");

console.log("== BOL (driver/load-detail uploadBolServer) — same token twice ==");
console.log("  1st:", await call(bol, "sid-driver", "csrf-d", { sessionToken: "app-driver", loadId: 1, filename: "a.pdf", token: "bol-tok" }));
console.log("  2nd:", await call(bol, "sid-driver", "csrf-d", { sessionToken: "app-driver", loadId: 1, filename: "b.pdf", token: "bol-tok" }));
console.log("  bogus token:", await call(bol, "sid-driver", "csrf-d", { sessionToken: "app-driver", loadId: 1, filename: "c.pdf", token: "never-issued" }));
console.log("  bol_received rows:", q("select payload from log_entries where type='bol_received'").length);

console.log("== Acceptance (customer/load-detail signRateConfirmationServer) ==");
console.log("  1st:", await call(acc, "sid-cust", "csrf-c", { sessionToken: "app-cust", loadId: 2, token: "acc-tok" }));
console.log("  2nd (same token):", await call(acc, "sid-cust", "csrf-c", { sessionToken: "app-cust", loadId: 2, token: "acc-tok" }));
console.log("  bogus token on a Booked load:", await call(acc, "sid-cust", "csrf-c", { sessionToken: "app-cust", loadId: 3, token: "never-issued" }));
const race = await Promise.all([
  call(acc, "sid-cust", "csrf-c", { sessionToken: "app-cust", loadId: 6, token: "acc-tok-race" }),
  call(acc, "sid-cust", "csrf-c", { sessionToken: "app-cust", loadId: 6, token: "acc-tok-race" }),
]);
console.log("  concurrent double-submit same token:", race);
console.log("  loads:", q("select id, status from loads where id in (2,3,6)"));

console.log("== Payment (customer/invoices markPaidServer) ==");
const payRace = await Promise.all([
  call(pay, "sid-cust", "csrf-c", { sessionToken: "app-cust", invoiceId: 1, token: "pay-tok" }),
  call(pay, "sid-cust", "csrf-c", { sessionToken: "app-cust", invoiceId: 1, token: "pay-tok" }),
]);
console.log("  concurrent double-submit same token:", payRace);
console.log("  2nd sequential (same token):", await call(pay, "sid-cust", "csrf-c", { sessionToken: "app-cust", invoiceId: 1, token: "pay-tok" }));
console.log("  bogus token on unpaid invoice 2:", await call(pay, "sid-cust", "csrf-c", { sessionToken: "app-cust", invoiceId: 2, token: "never-issued" }));
console.log("  invoices:", q("select id, paid_at is not null as paid from invoices"));
console.log("  lin_tokens:", q("select token, consumed_at is not null as consumed from lin_tokens"));
process.exit(0);
