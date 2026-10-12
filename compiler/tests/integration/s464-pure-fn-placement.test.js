/**
 * s464-pure-fn-placement — a plain `fn` is never a route and never async.
 *
 * SPEC: §12.4 "A function that has no client or server classification — a pure
 * function — MAY be called from both server-escalated and client-only functions
 * without restriction."; §13.4 "The callee SHALL NOT generate an additional HTTP
 * route when called from a server-escalated caller."; §48.3.5 "`fn` is always
 * synchronous."
 *
 * BEFORE: route inference's Step 5c (caller-context propagation) promoted a pure
 * `fn` whose only recorded caller was a server function to its OWN public route,
 * with a client fetch stub and an `async` server body. Whether the caller edge
 * was recorded depended on the call's position — `const t = dbl(n)` recorded
 * it, `${dbl(n)}` inside `?{}` or a call inside a lambda did not — so binding a
 * result to a `const` changed the program's routes. In the unrecorded positions
 * the fn was emitted client-only and the server code referenced an undefined
 * name (a ReferenceError at request time).
 *
 * AFTER: a plain `fn` stays unclassified. Its body is emitted, synchronously,
 * into every bundle whose code reaches it: the `.server.js` when a server-placed
 * body does, the `.client.js` when client code does. `server fn` keeps its pin.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { patchAndImport, closeOpenedDbHandles, safeRmSync } from "../helpers/self-host-server-import.js";

const EXECUTED_DB_TIMEOUT_MS = 30_000;
const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_s464_pure_fn_placement");
let tmpCounter = 0;

beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(async () => { await closeOpenedDbHandles(); safeRmSync(TMP_ROOT); });

function compile(src, name, seedFiles = {}) {
  const tag = `${name}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(tmpDir, `${tag}.scrml`), src);
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const stmt of stmts) db.exec(stmt);
    db.close();
  }
  const result = compileScrml({ inputFiles: [resolve(tmpDir, `${tag}.scrml`)], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity == null || e.severity === "error");
  const read = (ext) => {
    const p = join(outDir, `${tag}.${ext}.js`);
    return existsSync(p) ? readFileSync(p, "utf-8") : "";
  };
  return { errors, client: read("client"), server: read("server"), serverJsPath: join(outDir, `${tag}.server.js`), tmpDir };
}

const routesOf = (js) => [...new Set(js.match(/__ri_route_[A-Za-z]+(?=_\d)/g) ?? [])].map((r) => r.slice("__ri_route_".length)).sort();

const REPRO_CONST = `<program db="./x.db">
\${
  type E:enum = { Bad }
  type L:struct = { q: int }
  fn dbl(n: int) -> int { return n * 2 }
  function save(n: int) { const t = dbl(n)
    ?{\`INSERT INTO t (v) VALUES (\${t})\`}.run() }
  function go() { save(@n) }
}
<n> = 3
<button onclick=go()>s</button>
</program>
`;

const REPRO_INLINE = `<program db="./x.db">
\${
  type E:enum = { Bad }
  type L:struct = { q: int }
  fn dbl(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${dbl(n)})\`}.run() }
  function go() { save(@n) }
}
<n> = 3
<button onclick=go()>s</button>
</program>
`;

describe("s464 — a plain fn bound to a const inside a server function", () => {
  test("is not a route, has no client fetch stub, and is a synchronous server function", () => {
    const { errors, client, server } = compile(REPRO_CONST, "repro-const");
    expect(errors).toEqual([]);
    expect(routesOf(client)).toEqual(["save"]);
    expect(routesOf(server)).toEqual(["save"]);
    expect(client).not.toContain("_scrml_fetch_dbl");
    expect(server).toMatch(/^function dbl\(n\) \{/m);
    expect(server).not.toMatch(/async function dbl\b/);
    expect(server).toContain("const t = dbl(n);");
    expect(server).not.toContain("await dbl(");
  });

  test("const-bound and inline call positions place the fn identically", () => {
    const a = compile(REPRO_CONST, "pair-const");
    const b = compile(REPRO_INLINE, "pair-inline");
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(routesOf(a.client)).toEqual(routesOf(b.client));
    expect(routesOf(a.server)).toEqual(routesOf(b.server));
    // Both server bundles DEFINE the helper they call (the inline form used to
    // reference an undefined `dbl` at request time).
    for (const { server } of [a, b]) {
      expect(server).toMatch(/^function dbl\(n\) \{/m);
      expect(server).not.toMatch(/async function dbl\b/);
    }
    // Only server code reaches `dbl`, so neither client bundle carries its body.
    expect(a.client).not.toMatch(/function _scrml_dbl_\d+/);
    expect(b.client).not.toMatch(/function _scrml_dbl_\d+/);
  });
});

const SHOP = `<program db="./shop.db">
\${
  import { round } from 'scrml:math'
  import { now } from 'scrml:time'

  type Line:struct = { sku: string, qty: int, cents: int }
  type CartError:enum = { Empty, OverLimit(cents: int) }

  fn lineTotal(l: Line) -> int { return l.qty * l.cents }
  fn subtotal(lines: Line[]) -> int { return lines.reduce((a, l) => a + lineTotal(l), 0) }
  fn tax(cents: int) -> int { return round(cents * 0.08) }
  fn total(lines: Line[]) -> int { return subtotal(lines) + tax(subtotal(lines)) }

  function checkout(lines: Line[])! -> CartError {
    if (lines.length == 0) { fail CartError::Empty }
    const t = total(lines)
    if (t > 100000) { fail CartError::OverLimit(t) }
    ?{\`INSERT INTO orders (cents, at) VALUES (\${t}, \${now()})\`}.run()
    return t
  }
}

<cart>: Line[] = [{ sku: "a", qty: 2, cents: 1500 }]
<msg> = ""

\${
  function buy() {
    const t = checkout(@cart) !{
      .Empty :> { @msg = "cart is empty"; return }
      .OverLimit(c) :> { @msg = "over limit: " + c; return }
    }
    @msg = "charged " + t
  }
}

<button onclick=buy()>Buy</button>
<p>\${@msg}</p>
</program>
`;

describe("s464 — the shop demo: pure fns called only from a failable server function", () => {
  const FNS = ["lineTotal", "subtotal", "tax", "total"];

  test("no fn is a route or async; all four are server functions; none ships to the client", () => {
    const { errors, client, server } = compile(SHOP, "shop-shape");
    expect(errors).toEqual([]);
    expect(routesOf(client)).toEqual(["checkout"]);
    expect(routesOf(server)).toEqual(["checkout"]);
    for (const f of FNS) {
      expect(server).toMatch(new RegExp(`^function ${f}\\(`, "m"));
      expect(server).not.toMatch(new RegExp(`async function ${f}\\b`));
      expect(server).not.toContain(`await ${f}(`);
      expect(client).not.toMatch(new RegExp(`function _scrml_${f}_\\d+`));
      expect(client).not.toContain(`_scrml_fetch_${f}`);
    }
  });

  test("runtime: checkout computes 2*1500 + round(3000*0.08) = 3240 and writes it", async () => {
    // happy-dom-polluted globals strip the CSRF headers (see server-fn-calls-server-fn).
    if (typeof globalThis.document !== "undefined") return;
    const { errors, serverJsPath, tmpDir } = compile(SHOP, "shop-run", {
      "shop.db": ["CREATE TABLE orders (cents INTEGER, at INTEGER)"],
    });
    expect(errors).toEqual([]);
    const absDbPath = resolve(tmpDir, "shop.db");
    const mod = await patchAndImport(serverJsPath, absDbPath);
    const route = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("checkout"),
    );
    expect(route).toBeDefined();
    const TOKEN = "s464-csrf";
    const resp = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` },
      body: JSON.stringify({ lines: [{ sku: "a", qty: 2, cents: 1500 }] }),
    }));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toBe(3240);
    const db = new Database(absDbPath);
    const rows = db.query("SELECT cents FROM orders").all();
    db.close();
    expect(rows.map((r) => r.cents)).toEqual([3240]);
  }, EXECUTED_DB_TIMEOUT_MS);
});

const MIXED = `<program db="./x.db">
\${
  fn dbl(n: int) -> int { return n * 2 }
  fn onlyServer(n: int) -> int { return n + 100 }
  fn onlyClient(n: int) -> int { return n - 1 }
  server fn pinned(n: int) -> int { return n * 3 }
  function save(n: int) {
    const t = onlyServer(dbl(n))
    ?{\`INSERT INTO t (v) VALUES (\${t})\`}.run()
  }
  function go() { save(@n); @shown = dbl(@n) + onlyClient(@n) }
  function goPinned() { @shown = pinned(@n) }
}
<n> = 3
<shown> = 0
<button onclick=go()>s</button>
<button onclick=goPinned()>p</button>
<p>\${@shown}</p>
</program>
`;

describe("s464 — each fn lands in the bundle(s) whose code calls it", () => {
  test("`server fn` is still the explicit server pin: routed, with a client fetch stub", () => {
    const { errors, client, server } = compile(MIXED, "mixed-pin");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toContain("pinned");
    expect(client).toMatch(/async function _scrml_fetch_pinned_\d+/);
    expect(client).toMatch(/await _scrml_fetch_pinned_\d+\(/);
  });

  test("a fn called from both sides is emitted on both; one-sided fns only on their side", () => {
    const { errors, client, server } = compile(MIXED, "mixed-sides");
    expect(errors).toEqual([]);
    expect(routesOf(server).sort()).toEqual(["pinned", "save"]);
    // dbl — client (`go`) AND server (`save`).
    expect(client).toMatch(/^function _scrml_dbl_\d+\(n\) \{/m);
    expect(server).toMatch(/^function dbl\(n\) \{/m);
    // onlyServer — server bundle only.
    expect(server).toMatch(/^function onlyServer\(n\) \{/m);
    expect(client).not.toMatch(/onlyServer/);
    // onlyClient — client bundle only.
    expect(client).toMatch(/^function _scrml_onlyClient_\d+\(n\) \{/m);
    expect(server).not.toMatch(/onlyClient/);
    // None of the plain fns is async on either side.
    for (const f of ["dbl", "onlyServer", "onlyClient"]) {
      expect(server).not.toMatch(new RegExp(`async function ${f}\\b`));
      expect(client).not.toMatch(new RegExp(`async function _scrml_${f}_`));
    }
  });
});

describe("s464 — fail-closed guard: a fn that reads a client cell, reached from a server function", () => {
  // Regression guard (not a fix): such a fn keeps its prior placement path so the
  // existing E-REACTIVE-003 still rejects the program instead of shipping a
  // client-cell read into the server bundle.
  test("is still rejected with E-REACTIVE-003", () => {
    const src = `<program db="./x.db">
\${
  fn readsCell(n: int) -> int { return n + @n }
  function save(n: int) {
    const t = readsCell(n)
    ?{\`INSERT INTO t (v) VALUES (\${t})\`}.run()
  }
  function go() { save(@n) }
}
<n> = 3
<button onclick=go()>s</button>
</program>
`;
    const { errors } = compile(src, "cell-guard");
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });
});
