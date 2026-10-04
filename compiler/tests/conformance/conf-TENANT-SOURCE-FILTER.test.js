/**
 * CONF-TENANT-SOURCE-FILTER | §14.8.10 (S452 ruling "a") — the tenant floor
 * filters at the SOURCE.
 *
 * Rows read from a tenant-scoped table are filtered to the request's active
 * tenant IMMEDIATELY after the query, before any program code sees them; an
 * unpinned request (or code outside any request) sees zero rows; the explicit
 * `?{…}.acrossTenants()` opt-out (I-TENANT-ACROSS) keeps reading every tenant.
 *
 * THE LEAK THIS PINS CLOSED (dpa-067 §C4, measured at e7fb5fba5 and again at
 * d23e6cc6 before the fix, executing the emitted handlers in-process):
 *
 *   function namesOut() {
 *     let rows = ?{`SELECT id, name, tenant_id FROM assets`}.all()
 *     return rows.map(r => r.name)
 *   }
 *
 *   unpinned  namesOut  200 ["A-secret-asset","B-secret-asset"]
 *   pinned A  namesOut  200 ["A-secret-asset","B-secret-asset"]
 *
 * The S273 floor tagged the rows and stripped foreign ones only at the client
 * egress sink, and `_scrml_tenant_redact` passes non-objects unchanged — so any
 * value EXTRACTED from the rows (a field, a count, a sum, a joined string, a
 * serialized blob) carried every tenant's data past it, while `I-TENANT-STRIP`
 * claimed the response was scoped.
 *
 * EXECUTED, not grepped: each case compiles a real program, seeds a real SQLite
 * file with two tenants, imports the emitted `app.server.js`, and calls the
 * route handlers in-process with real `Request`s (no socket — the S273 note on
 * full-bundle-over-HTTP flakiness does not apply). A tenant is pinned the way an
 * app pins it: a server function calls `session.set("tenantId", t)` and the
 * returned session cookie rides on the next request.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { SERVER_TENANT_HELPER } from "../../src/codegen/tenant-egress.ts";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const PROGRAM = `<program db="app.db">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)\`}
    ?{\`CREATE TABLE orders (id INTEGER PRIMARY KEY, asset_id INTEGER, label TEXT, tenant_id TEXT)\`}
  </schema>
  \${
    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }
    function rowsOut() {
      return ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
    }
    function namesOut() {
      let rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      return rows.map(r => r.name)
    }
    function countOut() {
      let rows = ?{\`SELECT id FROM assets\`}.all()
      return rows.length
    }
    function costOut() {
      let rows = ?{\`SELECT id, cost FROM assets\`}.all()
      return rows.reduce((s, r) => s + r.cost, 0)
    }
    function joinedNames() {
      let rows = ?{\`SELECT id, name FROM assets ORDER BY id\`}.all()
      return rows.map(r => r.name).join(",")
    }
    function rawText() {
      let rows = ?{\`SELECT id, name FROM assets ORDER BY id\`}.all()
      return JSON.stringify(rows)
    }
    function getById(id: int) {
      return ?{\`SELECT id, name FROM assets WHERE id = \${id}\`}.get()
    }
    function firstOut() {
      return ?{\`SELECT id, name FROM assets ORDER BY id\`}.get()
    }
    function ordersOut() {
      return ?{\`SELECT o.id, o.label, a.name FROM orders o LEFT JOIN assets a ON a.id = o.asset_id ORDER BY o.id\`}.all()
    }
    function allTenants() {
      return ?{\`SELECT id, name, tenant_id FROM assets ORDER BY id\`}.acrossTenants().all()
    }
    server function* assetFeed() {
      let rows = ?{\`SELECT id, name FROM assets ORDER BY id\`}.all()
      yield rows.map(r => r.name)
    }
    function innerRows() {
      return ?{\`SELECT id, name FROM assets\`}.all()
    }
    function viaPeer() {
      let rows = innerRows()
      let orders = ?{\`SELECT id FROM orders\`}.all()
      return rows.length * 100 + orders.length
    }
  }
  <button onclick=\${ rowsOut() }>x</button>
  <button onclick=\${ namesOut() }>x</button>
  <button onclick=\${ countOut() }>x</button>
  <button onclick=\${ costOut() }>x</button>
  <button onclick=\${ joinedNames() }>x</button>
  <button onclick=\${ rawText() }>x</button>
  <button onclick=\${ getById(2) }>x</button>
  <button onclick=\${ firstOut() }>x</button>
  <button onclick=\${ ordersOut() }>x</button>
  <button onclick=\${ allTenants() }>x</button>
  <button onclick=\${ viaPeer() }>x</button>
  <button onclick=\${ pinTenant("A") }>x</button>
</program>
`;

// Two tenants. Asset 1 and order 10 belong to A; asset 2 and order 20 to B.
// Order 11 is A's but points at B's asset 2 (a cross-tenant reference), and
// order 12 is A's but points at no asset at all (a LEFT JOIN miss).
const SEED = [
  "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)",
  "CREATE TABLE orders (id INTEGER PRIMARY KEY, asset_id INTEGER, label TEXT, tenant_id TEXT)",
  "INSERT INTO assets (id, name, cost, tenant_id) VALUES (1, 'A-secret-asset', 10, 'A'), (2, 'B-secret-asset', 500, 'B')",
  "INSERT INTO orders (id, asset_id, label, tenant_id) VALUES (10, 1, 'A-order', 'A'), (11, 2, 'A-order-on-B-asset', 'A'), (12, 99, 'A-order-orphan', 'A'), (20, 2, 'B-order', 'B')",
  // a NON-tenant table whose key names B's asset (the subquery-existence probe)
  "CREATE TABLE config (k TEXT, v TEXT)",
  "INSERT INTO config (k, v) VALUES ('B-secret-asset', 'probe'), ('other', 'x')",
];

// Compile `source`, seed its database, import the emitted server module. Returns
// null routes when the compile reported an error (no module to import).
async function buildApp(source) {
  const dir = mkdtempSync(join(tmpdir(), "conf-tenant-source-"));
  _tmp.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  const db = new Database(join(dir, "app.db"), { create: true });
  for (const s of SEED) db.exec(s);
  db.close();
  const outDir = join(dir, "out");
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  if ((result.errors ?? []).some((e) => !/^[WI]-/.test(e.code ?? ""))) return { result, routes: null, server: "" };
  const serverPath = join(outDir, "app.server.js");
  const mod = await import(`${serverPath}?v=${Date.now()}-${Math.random()}`);
  const routes = {};
  for (const r of mod.routes) routes[r.path.replace(/^.*__ri_route_/, "").replace(/_\d+$/, "")] = r;
  return { result, routes, server: readFileSync(serverPath, "utf8") };
}

let app = null;
beforeAll(async () => { app = await buildApp(PROGRAM); });

const CSRF = "conf-tenant-source-csrf";
async function call(name, { cookie = "", body = {} } = {}, target = app) {
  const route = target.routes[name];
  const res = await route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `scrml_csrf=${CSRF}${cookie ? `; ${cookie}` : ""}`,
      "X-CSRF-Token": CSRF,
    },
    body: JSON.stringify(body),
  }));
  expect(res).toBeInstanceOf(Response);
  expect(res.status).toBe(200);
  return await res.json();
}
async function pin(tenant, target = app) {
  const route = target.routes.pinTenant;
  const res = await route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", Cookie: `scrml_csrf=${CSRF}`, "X-CSRF-Token": CSRF },
    body: JSON.stringify({ t: tenant }),
  }));
  const sid = res.headers.getSetCookie().map((c) => /(?:__Host-)?scrml_sid=[^;]+/.exec(c)).find(Boolean);
  expect(sid).toBeTruthy();
  return sid[0];
}
const codes = () => new Set([...(app.result.errors ?? []), ...(app.result.warnings ?? [])].map((d) => d.code));

describe("CONF-TENANT-SOURCE-FILTER — compile surface", () => {
  test("the program compiles clean; every scoped read is named (I-TENANT-STRIP) and the opt-out audited (I-TENANT-ACROSS)", () => {
    expect((app.result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""))).toEqual([]);
    expect(codes().has("I-TENANT-STRIP")).toBe(true);
    expect(codes().has("I-TENANT-ACROSS")).toBe(true);
  });
  test("I-TENANT-STRIP describes the SOURCE filter, not an egress strip", () => {
    const strip = [...(app.result.errors ?? []), ...(app.result.warnings ?? [])].find((d) => d.code === "I-TENANT-STRIP");
    expect(strip.message).toContain("before any server code sees them");
    expect(strip.message).not.toContain("egress floor scopes the client response");
  });
  test("the filter wraps the driver result itself; `.get()` takes [0] of the FILTERED rows", () => {
    // the key is ALWAYS a floor-added reserved alias (an author column can never forge it)
    expect(app.server).toContain('_scrml_tenant_scope(await _scrml_sql`SELECT id, name, tenant_id, assets.tenant_id AS __scrml_tenant_0 FROM assets`, ["__scrml_tenant_0"], ["__scrml_tenant_0"])');
    expect(app.server).toContain('(_scrml_tenant_scope(await _scrml_sql`SELECT id, name, assets.tenant_id AS __scrml_tenant_0 FROM assets ORDER BY id`, ["__scrml_tenant_0"], ["__scrml_tenant_0"]))[0] ?? null');
    // every route handler carries its request to the filter
    expect(app.server).toMatch(/_scrml_route\.handler = _scrml_tenant_request_scope\(_scrml_route\.handler\)/);
    // the opt-out read is NOT filtered
    expect(app.server).toContain("await _scrml_sql`SELECT id, name, tenant_id FROM assets ORDER BY id`;");
  });
});

describe("CONF-TENANT-SOURCE-FILTER — UNPINNED request: zero rows, whatever the program derives", () => {
  test("C4: the rows AND the names extracted from them are empty", async () => {
    expect(await call("rowsOut")).toEqual([]);
    expect(await call("namesOut")).toEqual([]);
  });
  test("a count, an aggregate-in-code, a joined string and a serialized string see nothing", async () => {
    expect(await call("countOut")).toBe(0);
    expect(await call("costOut")).toBe(0);
    expect(await call("joinedNames")).toBe("");
    expect(await call("rawText")).toBe("[]");
  });
  test("`.get()` → not; a JOIN → no rows; a peer server function → no rows", async () => {
    expect(await call("getById", { body: { id: 1 } })).toBeNull();
    expect(await call("firstOut")).toBeNull();
    expect(await call("ordersOut")).toEqual([]);
    expect(await call("viaPeer")).toBe(0);
  });
  test(".acrossTenants() still reads every tenant", async () => {
    expect((await call("allTenants")).map((r) => r.tenant_id)).toEqual(["A", "B"]);
  });
});

async function sse(name, cookie = "") {
  const route = app.routes[name];
  const res = await route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: { Cookie: cookie },
  }));
  expect(res).toBeInstanceOf(Response);
  const text = await res.text();
  return text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

describe("CONF-TENANT-SOURCE-FILTER — an SSE stream (server function*) is scoped to its request", () => {
  test("unpinned → the streamed value is built from zero rows", async () => {
    expect(await sse("assetFeed")).toEqual([[]]);
  });
  test("pinned B → only B's names are streamed", async () => {
    expect(await sse("assetFeed", await pin("B"))).toEqual([["B-secret-asset"]]);
  });
});

describe("CONF-TENANT-SOURCE-FILTER — request PINNED to a tenant: only that tenant's rows", () => {
  test("C4: pinned A → only A's rows and only A's names", async () => {
    const a = await pin("A");
    expect(await call("rowsOut", { cookie: a })).toEqual([{ id: 1, name: "A-secret-asset", tenant_id: "A" }]);
    expect(await call("namesOut", { cookie: a })).toEqual(["A-secret-asset"]);
  });
  test("count / sum / join / serialize are A's alone (B's cost 500 never enters the sum)", async () => {
    const a = await pin("A");
    expect(await call("countOut", { cookie: a })).toBe(1);
    expect(await call("costOut", { cookie: a })).toBe(10);
    expect(await call("joinedNames", { cookie: a })).toBe("A-secret-asset");
    // reading 6: the floor-ADDED tenant_id column is gone before server code sees
    // the row — a string built from the rows does not carry it.
    expect(await call("rawText", { cookie: a })).toBe('[{"id":1,"name":"A-secret-asset"}]');
  });
  test("reading 1: `.get()` of another tenant's primary key → not; the first row is the first AFTER the filter", async () => {
    const a = await pin("A");
    const b = await pin("B");
    expect(await call("getById", { cookie: a, body: { id: 2 } })).toBeNull();
    expect(await call("getById", { cookie: a, body: { id: 1 } })).toEqual({ id: 1, name: "A-secret-asset" });
    // ORDER BY id puts A's row 1 first in the table; B's first row is still B's own.
    expect(await call("firstOut", { cookie: b })).toEqual({ id: 2, name: "B-secret-asset" });
  });
  test("reading 3: a JOIN row is kept only when EVERY tenant source is the active tenant; a LEFT JOIN miss drops", async () => {
    const a = await pin("A");
    // order 11 (A) → asset 2 (B): dropped; order 12 (A) → no asset: dropped.
    expect(await call("ordersOut", { cookie: a })).toEqual([{ id: 10, label: "A-order", name: "A-secret-asset" }]);
    const b = await pin("B");
    expect(await call("ordersOut", { cookie: b })).toEqual([{ id: 20, label: "B-order", name: "B-secret-asset" }]);
  });
  test("a server function called in-process (a peer, no request parameter) is scoped to the caller's request", async () => {
    // B: one asset (from the peer) × 100 + one order (read directly).
    expect(await call("viaPeer", { cookie: await pin("B") })).toBe(101);
    // A: one asset × 100 + three orders.
    expect(await call("viaPeer", { cookie: await pin("A") })).toBe(103);
  });
  test(".acrossTenants() reads every tenant for a pinned request too", async () => {
    expect((await call("allTenants", { cookie: await pin("A") })).map((r) => r.name))
      .toEqual(["A-secret-asset", "B-secret-asset"]);
  });
});

// The S354 raw-egress EVASION (g-tenant-raw-egress-is-a-byte-identical-twin-of-the-protect-gate):
// `new globalThis.Response(...)` slips past the E-TENANT-RAW-EGRESS text scan and past
// the egress strip (a Response passes through it). EXECUTED at d23e6cc6 before this
// fix it served both tenants' rows to an unpinned request and to tenant A. Under the
// source filter the rows the Response is built from are already the request's own.
const EVASION = `<program db="app.db">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)\`}
  </schema>
  \${
    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }
    function rawResponse() {
      let rows = ?{\`SELECT id, name FROM assets ORDER BY id\`}.all()
      return new globalThis.Response(JSON.stringify(rows))
    }
  }
  <button onclick=\${ pinTenant("A") }>p</button>
  <button onclick=\${ rawResponse() }>r</button>
</program>
`;

describe("CONF-TENANT-SOURCE-FILTER — a hand-built Response carries only the request tenant's rows", () => {
  test("unpinned → []; pinned A → only A (or the compile gate rejects the shape outright)", async () => {
    const ev = await buildApp(EVASION);
    if (ev.routes === null) {
      // A future E-TENANT-RAW-EGRESS fix may reject this shape at compile — also closed.
      expect([...(ev.result.errors ?? [])].map((e) => e.code)).toContain("E-TENANT-RAW-EGRESS");
      return;
    }
    expect(await call("rawResponse", {}, ev)).toEqual([]);
    const a = await pin("A", ev);
    expect(await call("rawResponse", { cookie: a }, ev)).toEqual([{ id: 1, name: "A-secret-asset" }]);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND r2 — the bypasses the S452 security review of 1239366814c found.
// Every repro here compiled AND leaked tenant B's data to an unpinned request
// or to tenant A on 1239366814c (or, for L3, wrongly refused a safe query).
// The rule they pin (S451 durable: "text classification cannot prove a query
// safe"): every tenant SQL check runs on ONE normalized text (comments and
// string literals blanked), and a tenant-table read is a plain row read only on
// an ALLOW-LIST — anything else is E-TENANT-AGG (refused) or zero rows.
// ---------------------------------------------------------------------------
function probeProgram(body) {
  const names = [...body.matchAll(/function\*?\s+(\w+)\s*\(/g)].map((m) => m[1]);
  return `<program db="app.db">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)\`}
    ?{\`CREATE TABLE orders (id INTEGER PRIMARY KEY, asset_id INTEGER, label TEXT, tenant_id TEXT)\`}
    ?{\`CREATE TABLE config (k TEXT, v TEXT)\`}
  </schema>
  \${
    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }
${body}
  }
${names.map((n) => `  <button onclick=\${ ${n}() }>x</button>`).join("\n")}
  <button onclick=\${ pinTenant("A") }>p</button>
</program>
`;
}
const fatal = (r) => (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "")).map((e) => e.code);

// The query is either REFUSED at compile (E-TENANT-AGG) or, executed, shows no
// trace of tenant B to an unpinned request or to tenant A, nor of A to tenant B.
async function expectRefusedOrNoLeak(body, fn) {
  const p = await buildApp(probeProgram(body));
  if (p.routes === null) {
    expect(fatal(p.result)).toContain("E-TENANT-AGG");
    return "refused";
  }
  const unpinned = JSON.stringify(await call(fn, {}, p));
  const asA = JSON.stringify(await call(fn, { cookie: await pin("A", p) }, p));
  expect(unpinned).not.toContain("B-secret");
  expect(asA).not.toContain("B-secret");
  expect(asA).not.toContain("500");   // B's cost
  const asB = JSON.stringify(await call(fn, { cookie: await pin("B", p) }, p));
  expect(asB).not.toContain("A-secret");
  return "executed";
}

describe("CONF-TENANT-SOURCE-FILTER r2 — H1: comments never hide a subquery", () => {
  test("block comment before a projection subquery", async () => {
    await expectRefusedOrNoLeak(`    function h1a() { return ?{\`SELECT (/**/SELECT group_concat(name) FROM assets) AS names\`}.get() }`, "h1a");
  });
  test("line comment before a projection subquery", async () => {
    await expectRefusedOrNoLeak(`    function h1b() { return ?{\`SELECT ( -- hidden\n SELECT group_concat(name) FROM assets) AS names\`}.get() }`, "h1b");
  });
  test("block comment before a WHERE subquery over a non-tenant outer table (existence probe)", async () => {
    await expectRefusedOrNoLeak(`    function h1c() { return ?{\`SELECT k FROM config WHERE k IN (/* x */SELECT name FROM assets)\`}.all() }`, "h1c");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — H2: the §8.10 loop hoist cannot bypass the filter", () => {
  test("a per-row asset lookup inside a loop over A's orders never yields B's asset", async () => {
    const out = await expectRefusedOrNoLeak(
      `    function h2() {
      let ords = ?{\`SELECT id, asset_id FROM orders ORDER BY id\`}.all()
      let found = []
      for (let o of ords) {
        let a = ?{\`SELECT id, name FROM assets WHERE id = \${o.asset_id}\`}.get()
        found.push(a)
      }
      return found
    }`, "h2");
    expect(out).toBe("executed");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — H3 / L2: aggregates are an allow-list, not a name list", () => {
  test("json_group_array folds every tenant into one value", async () => {
    await expectRefusedOrNoLeak(`    function h3a() { return ?{\`SELECT json_group_array(name) AS names FROM assets\`}.get() }`, "h3a");
  });
  test("an unknown function is refused (fail-closed), even a harmless one", async () => {
    const p = await buildApp(probeProgram(`    function h3b() { return ?{\`SELECT hex(name) AS h FROM assets\`}.all() }`));
    expect(fatal(p.result)).toContain("E-TENANT-AGG");
  });
  test("L2: a window function sees the other tenant's rows", async () => {
    await expectRefusedOrNoLeak(`    function l2() { return ?{\`SELECT id, lead(name) OVER (ORDER BY id) AS nxt FROM assets\`}.all() }`, "l2");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — H4: GROUP BY tenant_id is read structurally", () => {
  test("a GROUP BY on another column + ORDER BY tenant_id does not exempt the aggregate", async () => {
    await expectRefusedOrNoLeak(`    function h4() { return ?{\`SELECT tenant_id, count(*) AS n, group_concat(name) AS names FROM assets GROUP BY cost > 0 ORDER BY tenant_id\`}.all() }`, "h4");
  });
  test("a real GROUP BY tenant_id stays allowed and scoped", async () => {
    const p = await buildApp(probeProgram(`    function h4ok() { return ?{\`SELECT tenant_id, count(*) AS n FROM assets GROUP BY tenant_id\`}.all() }`));
    expect(fatal(p.result)).toEqual([]);
    expect(await call("h4ok", { cookie: await pin("A", p) }, p)).toEqual([{ tenant_id: "A", n: 1 }]);
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — L1: the filter key cannot be forged by the projection", () => {
  test("`SELECT *, 'A' AS tenant_id` does not admit B's row for A", async () => {
    await expectRefusedOrNoLeak(`    function l1a() { return ?{\`SELECT *, 'A' AS tenant_id FROM assets\`}.all() }`, "l1a");
  });
  test("`SELECT id, name, 'A' AS tenant_id` does not admit B's row for A", async () => {
    const out = await expectRefusedOrNoLeak(`    function l1b() { return ?{\`SELECT id, name, 'A' AS tenant_id FROM assets\`}.all() }`, "l1b");
    expect(out).toBe("executed");
  });
  test("an author projection naming the reserved key alias is refused", async () => {
    const p = await buildApp(probeProgram(`    function l1c() { return ?{\`SELECT id, 'A' AS __scrml_tenant_0 FROM assets\`}.all() }`));
    expect(fatal(p.result)).toContain("E-TENANT-AGG");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — L3: a string literal is data, not SQL", () => {
  test("a literal that LOOKS like a subquery does not refuse a plain read", async () => {
    const p = await buildApp(probeProgram(`    function l3() { return ?{\`SELECT id, name FROM assets WHERE name != '(SELECT 1 FROM assets)'\`}.all() }`));
    expect(fatal(p.result)).toEqual([]);
    expect(await call("l3", { cookie: await pin("A", p) }, p)).toEqual([{ id: 1, name: "A-secret-asset" }]);
  });
});

// ---------------------------------------------------------------------------
// INSERT with no active tenant (ruling user-voice-scrml.md S452 "your rec" = (a)):
// an INSERT into a tenant-scoped table outside a tenant (boot, a job, an unpinned
// request, a server function reached outside a request) is a NAMED runtime
// refusal — `E-TENANT-WRITE (runtime)` — unless it is `.acrossTenants()` AND
// names the tenant column. Before: the injected value read a lexical `_scrml_req`,
// so an in-process peer threw an accidental ReferenceError, and an unpinned
// request wrote a row with a NULL tenant.
// ---------------------------------------------------------------------------
async function callRaw(name, { cookie = "", body = {} } = {}, target = app) {
  const route = target.routes[name];
  try {
    const res = await route.handler(new Request(`https://localhost${route.path}`, {
      method: route.method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `scrml_csrf=${CSRF}${cookie ? `; ${cookie}` : ""}`,
        "X-CSRF-Token": CSRF,
      },
      body: JSON.stringify(body),
    }));
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { thrown: String(e && e.message) };
  }
}

const INSERTS = `    function addOwn() {
      ?{\`INSERT INTO assets (name, cost) VALUES ('own-new', 1)\`}.run()
      return "added"
    }
    function addViaPeer() {
      let r = addOwn()
      let rows = ?{\`SELECT id FROM assets\`}.all()
      return rows.length
    }
    function addAcrossExplicit() {
      ?{\`INSERT INTO assets (name, cost, tenant_id) VALUES ('job-made', 2, 'B')\`}.acrossTenants().run()
      return "added"
    }
    function countAll() {
      let rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.acrossTenants().all()
      return rows.map(r => r.name + ":" + r.tenant_id)
    }`;

describe("CONF-TENANT-SOURCE-FILTER r2 — INSERT with no active tenant is a named refusal", () => {
  test("from a route with a pinned tenant: injected (and through an in-process peer too)", async () => {
    const p = await buildApp(probeProgram(INSERTS));
    expect(fatal(p.result)).toEqual([]);
    expect(p.server).toContain("${_scrml_tenant_write_key()}");
    const a = await pin("A", p);
    expect(await call("addViaPeer", { cookie: a }, p)).toBe(2);
    expect(await call("countAll", {}, p)).toContain("own-new:A");
  });
  test("with no active tenant: refused by name, nothing written", async () => {
    const p = await buildApp(probeProgram(INSERTS));
    const r = await callRaw("addOwn", {}, p);
    expect(JSON.stringify(r)).not.toContain("ReferenceError");
    expect(r.status === 200).toBe(false);
    expect(await call("countAll", {}, p)).toEqual(["A-secret-asset:A", "B-secret-asset:B"]);
  });
  test("outside ANY request (boot / a background job): the shipped write key refuses by name", async () => {
    const H = new Function(SERVER_TENANT_HELPER + "\nreturn { _scrml_tenant_write_key };")();
    expect(() => H._scrml_tenant_write_key()).toThrow(/E-TENANT-WRITE \(runtime\)/);
    expect(() => H._scrml_tenant_write_key()).toThrow(/acrossTenants\(\)/);
  });
  test(".acrossTenants() + an explicit tenant column, with no active tenant: allowed", async () => {
    const p = await buildApp(probeProgram(INSERTS));
    expect(await call("addAcrossExplicit", {}, p)).toBe("added");
    expect(await call("countAll", {}, p)).toContain("job-made:B");
  });
  test(".acrossTenants() WITHOUT the tenant column: refused at compile (E-TENANT-WRITE)", async () => {
    const p = await buildApp(probeProgram(`    function addAcrossBare() {
      ?{\`INSERT INTO assets (name, cost) VALUES ('orphan', 3)\`}.acrossTenants().run()
      return "added"
    }`));
    expect(fatal(p.result)).toContain("E-TENANT-WRITE");
  });
  test(".acrossTenants() with NO column list: refused at compile (the tenant column is not named)", async () => {
    const p = await buildApp(probeProgram(`    function addAcrossNoList() {
      ?{\`INSERT INTO assets VALUES (9, 'x', 3, 'B')\`}.acrossTenants().run()
      return "added"
    }`));
    expect(fatal(p.result)).toContain("E-TENANT-WRITE");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — every SQL spelling meets the same refusals (the audit's bare-brace hole)", () => {
  test("`?{ select count(*) … }` and `?{ update … }` are refused like the backtick spelling", async () => {
    const p = await buildApp(probeProgram(`    function cnt() {
      const r = ?{ select count(*) as n from assets }
      return r
    }
    function wipe() {
      ?{ update assets set name = 'x' }
      return "ok"
    }`));
    expect(fatal(p.result)).toContain("E-TENANT-AGG");
    expect(fatal(p.result)).toContain("E-TENANT-WRITE");
  });
});

describe("CONF-TENANT-SOURCE-FILTER r2 — a kind=\"tool\" program runs outside any request", () => {
  test("its tenant reads see zero rows; .acrossTenants() sees all (EXECUTED)", () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-tenant-tool-"));
    _tmp.push(dir);
    writeFileSync(join(dir, "tool.scrml"), `<program kind="tool" db="app.db">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)\`}
  </schema>
  function main(args) -> int {
    let rows = ?{\`SELECT id, name FROM assets\`}.all()
    let all = ?{\`SELECT id, name FROM assets\`}.acrossTenants().all()
    print(rows.length + ":" + all.length)
    return 0
  }
</program>
`);
    const db = new Database(join(dir, "app.db"), { create: true });
    for (const s of SEED) db.exec(s);
    db.close();
    const r = compileScrml({ inputFiles: [join(dir, "tool.scrml")], write: true, outputDir: join(dir, "out"), log: () => {} });
    expect(fatal(r)).toEqual([]);
    const run = Bun.spawnSync(["bun", join(dir, "out", "tool.js")], { cwd: dir });
    expect(run.stdout.toString().trim()).toBe("0:2");
  });
});
