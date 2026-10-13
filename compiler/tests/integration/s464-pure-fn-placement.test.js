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

describe("s464 — a local fn whose name another module exports", () => {
  test("the local fn is still defined in the server bundle that calls it", () => {
    const tag = `collide-${++tmpCounter}`;
    const tmpDir = resolve(TMP_ROOT, tag);
    mkdirSync(join(tmpDir, "models"), { recursive: true });
    writeFileSync(join(tmpDir, "models", "m.scrml"), `\${\n  export fn fmt(n: int) -> int { return n + 1000 }\n}\n`);
    writeFileSync(join(tmpDir, "app.scrml"), `<program db="./x.db">
\${
  import { fmt as other } from './models/m.scrml'
  fn fmt(n: int) -> int { return n * 2 }
  function save(n: int) {
    const t = fmt(n)
    ?{\`INSERT INTO t (v) VALUES (\${t})\`}.run()
  }
  function go() { save(@n); @shown = other(@n) }
}
<n> = 3
<shown> = 0
<button onclick=go()>s</button>
<p>\${@shown}</p>
</program>
`);
    const outDir = join(tmpDir, "dist");
    const result = compileScrml({ inputFiles: [join(tmpDir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
    expect((result.errors ?? []).filter((e) => e.severity == null || e.severity === "error")).toEqual([]);
    const server = readFileSync(join(outDir, "app.server.js"), "utf-8");
    expect(server).toContain("const t = fmt(n);");
    expect(server).toMatch(/^function fmt\(n\) \{\n  return n \* 2;/m);
    expect(routesOf(server)).toEqual(["save"]);
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

// ---------------------------------------------------------------------------
// Fix round 1 (S464 adversarial review of 6ce9fcd62).
// ---------------------------------------------------------------------------

function compileFiles(files, entry, name, seedFiles = {}) {
  const tag = `${name}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  for (const [f, txt] of Object.entries(files)) {
    mkdirSync(dirname(join(tmpDir, f)), { recursive: true });
    writeFileSync(join(tmpDir, f), txt);
  }
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const stmt of stmts) db.exec(stmt);
    db.close();
  }
  const outDir = join(tmpDir, "dist");
  const result = compileScrml({ inputFiles: [join(tmpDir, entry)], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity == null || e.severity === "error");
  return { errors, outDir, tmpDir };
}

async function callRoute(serverJsPath, dbPath, routeName, body) {
  const mod = await patchAndImport(serverJsPath, dbPath);
  const route = Object.values(mod).find(
    (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes(routeName),
  );
  expect(route).toBeDefined();
  const TOKEN = "s464-fr1";
  const resp = await route.handler(new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` },
    body: JSON.stringify(body),
  }));
  return { status: resp.status, json: await resp.json() };
}

// happy-dom-polluted globals strip the CSRF headers (see server-fn-calls-server-fn).
const HAPPY_DOM = () => typeof globalThis.document !== "undefined";

const saveProg = (pre, body) => `<program db="./x.db">
\${
${pre}
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (1)\`}.run()
${body}
  }
  function go() { @out = save(@n) }
}
<n> = 3
<out> = 0
<button onclick=go()>s</button>
<p>\${@out}</p>
</program>
`;
const T_SEED = { "x.db": ["CREATE TABLE t (v INTEGER)"] };

describe("s464 fix round 1 F1 — module consts a server-bundle fn helper closes over (D-5)", () => {
  test("the D-5 repro in its `fn` form: `labelFor` reads `ROLES`; describe(1) → \"editor\"", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": `<program>
\${ const ROLES = ["admin", "editor", "viewer"]
   fn labelFor(i) { return ROLES[i] }
   server fn describe(i) -> string { return labelFor(i) } }
<out> = ""
<button onclick=\${@out = describe(1)}>s</button>
<p>\${@out}</p>
</program>` }, "app.scrml", "d5-fn");
    expect(errors).toEqual([]);
    const server = readFileSync(join(outDir, "app.server.js"), "utf-8");
    expect(server).toMatch(/^const ROLES = /m);
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "describe", { i: 1 });
    expect(r.status).toBe(200);
    expect(r.json).toBe("editor");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("same file: `const RATE = 7; fn mul(n) { n * RATE }` via `const r = mul(n)` → 21", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({
      "app.scrml": saveProg("  const RATE = 7\n  fn mul(n: int) -> int { return n * RATE }", "    const r = mul(n)\n    return r"),
    }, "app.scrml", "rate-local", T_SEED);
    expect(errors).toEqual([]);
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "save", { n: 3 });
    expect(r.status).toBe(200);
    expect(r.json).toBe(21);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("cross file: exported `fn mul` reads module-local `RATE`; m.server.js declares it → 21", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({
      "m.scrml": "${\n  const RATE = 7\n  export fn mul(n: int) -> int { return n * RATE }\n}\n",
      "app.scrml": saveProg("  import { mul } from './m.scrml'", "    const r = mul(n)\n    return r"),
    }, "app.scrml", "rate-xfile", T_SEED);
    expect(errors).toEqual([]);
    expect(readFileSync(join(outDir, "m.server.js"), "utf-8")).toMatch(/^const RATE = 7;/m);
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "save", { n: 3 });
    expect(r.status).toBe(200);
    expect(r.json).toBe(21);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 1 F2 — a fn helper named like a server-bundle binding", () => {
  for (const nm of ["routes", "fetch"]) {
    test(`\`fn ${nm}\` called by server code is E-CG-016, not silently rebound`, () => {
      const { errors } = compileFiles({
        "app.scrml": saveProg(`  fn ${nm}(n: int) -> int { return n * 2 }`, `    const r = ${nm}(n)\n    return r`),
      }, "app.scrml", `collide-${nm}`, T_SEED);
      expect(errors.map((e) => e.code)).toContain("E-CG-016");
    });
  }

  test("a route-handler LOCAL with the helper's name is not a collision (shadow) → 300", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({
      "app.scrml": saveProg("  fn a(n) { return n + 1 }", "    const a = (k) => k * 100\n    return a(n)"),
    }, "app.scrml", "shadow-local", T_SEED);
    expect(errors).toEqual([]);
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "save", { n: 3 });
    expect(r.status).toBe(200);
    expect(r.json).toBe(300);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 1 F3 — a fn whose parameter DEFAULT reads a cell", () => {
  test("`fn f(n, k = @n)` reached from server code is E-REACTIVE-003", () => {
    const { errors } = compileFiles({
      "app.scrml": saveProg("  fn f(n: int, k: int = @n) -> int { return n + k }", "    const r = f(n)\n    return r"),
    }, "app.scrml", "param-default-cell", T_SEED);
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });
});

// ---------------------------------------------------------------------------
// Fix round 2 — ONE reader of `@`-references (the parsed expression tree) for
// both the placement decision and E-REACTIVE-003. Literal text never counts.
// ---------------------------------------------------------------------------

const goProg = (pre) => `<program>
\${
${pre}
}
<n> = 7
<out> = ""
<button onclick=\${@out = go(3)}>s</button>
<p>\${@out}</p>
</program>`;

describe("s464 fix round 2 NEW-1 — `@` inside a default's literal text is not a cell read", () => {
  const CASES = [
    ["string", "fn f(m, k: string = \"@n\") { return k + m }", "@n3"],
    ["template, no interpolation", "fn f(m, k: string = `@n`) { return k + m }", "@n3"],
    ["template with an interpolation", "fn f(m, k: string = `@${m}`) { return k }", "@3"],
    ["escaped quote", "fn f(m, k: string = \"a\\\"@n\") { return k }", "a\"@n"],
    ["regex literal", "fn f(m, k = /@n/) { return k.test(\"@n\") }", true],
    ["email-like string", "fn f(m, k: string = 'ops@n.io') { return k }", "ops@n.io"],
  ];
  for (const [label, fnSrc, expected] of CASES) {
    test(`${label}: the fn stays a plain helper and its default applies`, async () => {
      if (HAPPY_DOM()) return;
      const { errors, outDir, tmpDir } = compileFiles({
        "app.scrml": goProg(`  ${fnSrc}\n  server fn go(x) { return f(x) }`),
      }, "app.scrml", "lit-default");
      expect(errors).toEqual([]);
      const server = readFileSync(join(outDir, "app.server.js"), "utf-8");
      expect(routesOf(server)).toEqual(["go"]);
      expect(server).not.toMatch(/async function f\b/);
      const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "go", { x: 3 });
      expect(r.status).toBe(200);
      expect(r.json).toEqual(expected);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

describe("s464 fix round 2 NEW-2 — E-REACTIVE-003 reads the same tree", () => {
  for (const [label, dflt] of [["regex", "/@n/"], ["template, no interpolation", "`@n`"], ["template text", "`a@n.io`"]]) {
    test(`no false positive on a server fn default that is a ${label}`, () => {
      const { errors } = compileFiles({
        "app.scrml": goProg(`  server fn go(x) { return g(x) }\n  server fn g(m, k = ${dflt}) { return k }`),
      }, "app.scrml", "no-fp");
      expect(errors.map((e) => e.code)).not.toContain("E-REACTIVE-003");
    });
  }

  test("a cell read inside a template interpolation reached from server code is E-REACTIVE-003 (was `\"undefined-3\"`)", () => {
    // s464 fix round 3 — owner ruling S464 "(a) Close it": E-REACTIVE-003 reads
    // template-literal interpolations (closes g-template-literal-cell-read-in-fn-undefined-on-server-s464).
    const { errors } = compileFiles({
      "app.scrml": goProg("  fn f(k) { return `${@n}-${k}` }\n  server fn go(x) { return f(x) }"),
    }, "app.scrml", "tpl-cell");
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });

  test("…and directly in a wholly-server function's template", () => {
    const { errors } = compileFiles({
      "app.scrml": goProg("  server fn go(x) { const s = `n=${@n}`\n    return s }"),
    }, "app.scrml", "tpl-cell-direct");
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });
});

// ---------------------------------------------------------------------------
// Fix round 2 items 3-5 — the D-5 module-binding CLOSURE, its order (TDZ), its
// refusals, and the complete E-CG-016 check.
// ---------------------------------------------------------------------------

async function goResult(pre, name, extraFiles = {}) {
  const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": goProg(pre), ...extraFiles }, "app.scrml", name);
  expect(errors).toEqual([]);
  // Plain import (no test patch) — the bundle must LOAD, not just parse.
  const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Math.random()}`);
  const route = mod.routes.find((r) => String(r.path).includes("go"));
  const resp = await route.handler(new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", "Cookie": "scrml_csrf=t" },
    body: JSON.stringify({ n: 3, x: 3 }),
  }));
  expect(resp.status).toBe(200);
  return resp.json();
}

describe("s464 fix round 2 item 3 — D-5 chains", () => {
  const CASES = [
    ["const of a const", "  const BASE = 5\n  const RATE = BASE * 2\n  fn f(n) { return n * RATE }\n  server fn go(n) { return f(n) }", 30],
    ["const from a pure fn call (the fn is emitted too)", "  fn dbl(x) { return x * 2 }\n  const RATE = dbl(4)\n  fn f(n) { return n * RATE }\n  server fn go(n) { return f(n) }", 24],
    ["member read", "  const LIST = [1, 2, 3]\n  const TOTAL = LIST.length\n  fn f(n) { return n + TOTAL }\n  server fn go(n) { return f(n) }", 6],
    ["object destructuring", "  const { a, b } = { a: 1, b: 2 }\n  fn f(n) { return n + a + b }\n  server fn go(n) { return f(n) }", 6],
    ["array destructuring", "  const [p, q] = [10, 20]\n  fn f(n) { return n + p + q }\n  server fn go(n) { return f(n) }", 33],
    ["a lambda in the initializer reads another const", "  const RATE = 2\n  const L = [1, 2, 3].map((q) => q * RATE)\n  fn f(x) { return x + L.length + Math.max(...L) }\n  server fn go(x) { return f(x) }", 12],
  ];
  for (const [label, pre, expected] of CASES) {
    test(`${label} → ${expected}`, async () => {
      if (HAPPY_DOM()) return;
      expect(await goResult(pre, "d5-chain")).toBe(expected);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

describe("s464 fix round 2 item 4 — module-load order (TDZ)", () => {
  test("`export const A = BASE + 1` loads (BASE declared ahead of the exports) → 18", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult("  const BASE = 5\n  export const A = BASE + 1\n  fn f(n) { return n * A }\n  server fn go(n) { return f(n) }", "tdz-a")).toBe(18);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("`export const V = f(2)` with f a pure fn reading a const loads → 9", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult("  const K = 3\n  fn f(x) { return x * K }\n  export const V = f(2)\n  server fn go(n) { return n + V }", "tdz-v")).toBe(9);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a const that reads an exported value is placed after it → 11", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult("  export const A = 4\n  const B = A * 2\n  fn f(x) { return x + B }\n  server fn go(x) { return f(x) }", "tdz-after")).toBe(11);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 2 item 3 — a needed binding that cannot run on the server is refused", () => {
  const REFUSE = [
    ["reads a cell", "  const T = @n * 2\n  fn f(x) { return x + T }\n  server fn go(x) { return f(x) }"],
    ["reads a browser-only global", "  const T = document.title\n  fn f(x) { return x + T }\n  server fn go(x) { return f(x) }"],
    ["calls a client `function`", "  function h(x) { return x * 3 }\n  const T = h(2)\n  fn f(x) { return x + T }\n  server fn go(x) { return f(x) }"],
  ];
  for (const [label, pre] of REFUSE) {
    test(`${label} → E-ROUTE-002 naming the chain`, () => {
      const { errors } = compileFiles({ "app.scrml": goProg(pre) }, "app.scrml", "d5-refuse");
      const e = errors.find((x) => x.code === "E-ROUTE-002");
      expect(e).toBeDefined();
      expect(e.message).toContain("server code → `T`");
    });
  }

  for (const [label, pre, expected] of [
    ["a server local shadowing a client-only module const", "  const total = @n * 2\n  server fn go(x) { const total = x * 10\n    return total }", 30],
    ["an object key named like a client-only module const", "  const total = @n * 2\n  server fn go(x) { return { total: x } }", { total: 3 }],
  ]) {
    test(`no refusal for ${label}`, async () => {
      if (HAPPY_DOM()) return;
      expect(await goResult(pre, "d5-norefuse")).toEqual(expected);
    }, EXECUTED_DB_TIMEOUT_MS);
  }
});

describe("s464 fix round 2 item 5 — E-CG-016 against the COMPLETE server bundle", () => {
  const dbProg = (name) => `<program db="./x.db">
\${
  fn ${name}(x) { return x * 2 }
  function go(x) {
    ?{\`CREATE TABLE IF NOT EXISTS t (v INTEGER)\`}.run()
    const r = ${name}(x)
    return r
  }
}
<n> = 3
<out> = 0
<button onclick=\${@out = go(@n)}>s</button>
<p>\${@out}</p>
</program>`;
  for (const nm of ["SQL", "_SCRML_TENANT_DECLARED"]) {
    test(`\`fn ${nm}\` (a late compiler binding) is E-CG-016, not a generic codegen error`, () => {
      const { errors } = compileFiles({ "app.scrml": dbProg(nm) }, "app.scrml", `late-${nm}`);
      expect(errors.map((e) => e.code)).toEqual(["E-CG-016"]);
    });
  }
});

// ---------------------------------------------------------------------------
// Fix round 3 — N1 one dependency order, N2 imports/types available, N3 a
// non-deterministic value split across bundles, N4 scope-aware / literal-blind.
// ---------------------------------------------------------------------------

describe("s464 fix round 3 N1 — one dependency-ordered sequence for every module value", () => {
  test("exported and non-exported values interleave: B, A=B+1, C=A*2, D=C+1 → go(3) = 8", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  const B = 1\n  export const A = B + 1\n  const C = A * 2\n  export const D = C + 1\n  fn f(n) { return n + D }\n  server fn go(n) { return f(n) }",
      "n1-interleave",
    )).toBe(8);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 3 N2 — what the bundle already provides is not refused", () => {
  test("an enum read in a module value (`const DEF = Color.Green`) → \"Green\"", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  type Color:enum = { Red, Green }\n  const DEF = Color.Green\n  fn f(n) { return DEF }\n  server fn go(n) { return f(n) }",
      "n2-enum",
    )).toBe("Green");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("an imported value in a module value (`const RATE = BASE * 2`) → 30", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  import { BASE } from './lib.scrml'\n  const RATE = BASE * 2\n  fn f(n) { return n * RATE }\n  server fn go(n) { return f(n) }",
      "n2-import-value", { "lib.scrml": "${ export const BASE = 5 }\n" },
    )).toBe(30);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("an imported fn in a module value (`const RATE = dbl(4)`) → 24", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  import { dbl } from './lib.scrml'\n  const RATE = dbl(4)\n  fn f(n) { return n * RATE }\n  server fn go(n) { return f(n) }",
      "n2-import-fn", { "lib.scrml": "${ export fn dbl(x) { return x * 2 } }\n" },
    )).toBe(24);
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 3 N3 — a non-deterministic value used on BOTH sides is refused", () => {
  const prog = (pre) => `<program>
\${
${pre}
  fn f(n) { return R }
  server fn go(n) { return f(n) }
}
<out> = ""
<button onclick=\${@out = go(3)}>s</button>
<p>\${R} \${@out}</p>
</program>`;
  for (const [label, pre, call] of [
    ["Math.random()", "  const R = Math.random()", "Math.random"],
    ["crypto.randomUUID()", "  const R = crypto.randomUUID()", "crypto.randomUUID"],
    ["scrml:time now() under an alias", "  import { now as clock } from 'scrml:time'\n  const R = clock()", "scrml:time.now"],
    ["a value derived from Math.random()", "  const R0 = Math.random()\n  const R = R0 * 2", "Math.random"],
  ]) {
    test(`${label} → E-ROUTE-002 naming the split`, () => {
      const { errors } = compileFiles({ "app.scrml": prog(pre) }, "app.scrml", "n3-split");
      const e = errors.find((x) => x.code === "E-ROUTE-002");
      expect(e).toBeDefined();
      expect(e.message).toContain(`calls \`${call}\``);
      expect(e.message).toContain("DIFFERENT values");
    });
  }

  test("used only on the server: not refused (one evaluation is observed)", async () => {
    if (HAPPY_DOM()) return;
    const v = await goResult("  const R = crypto.randomUUID()\n  fn f(n) { return R }\n  server fn go(n) { return f(n) }", "n3-server-only");
    expect(typeof v).toBe("string");
  }, EXECUTED_DB_TIMEOUT_MS);
});

describe("s464 fix round 3 N4 — scope-aware shadowing; template text is not code", () => {
  test("a local of the same name in an UNRELATED server fn does not hide the refusal", () => {
    const { errors } = compileFiles({
      "app.scrml": goProg("  const W = window.innerWidth\n  fn f(n) { return n + W }\n  server fn other(q) { const W = 1; return W + q }\n  server fn go(n) { return f(n) }"),
    }, "app.scrml", "n4-scope");
    expect(errors.map((e) => e.code)).toContain("E-ROUTE-002");
  });

  test("a column-0 `const LIM = 9` inside a template literal is text → 21", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  const LIM = 3\n  fn f(n) { const s = `\nconst LIM = 9\n`; return n + LIM + s.length }\n  server fn go(n) { return f(n) }",
      "n4-tpl-fn",
    )).toBe(21);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a column-0 `let K = 9` inside a server fn's template literal is text → 17", async () => {
    if (HAPPY_DOM()) return;
    expect(await goResult(
      "  const K = 2\n  fn f(n) { return n * K }\n  server fn go(n) {\n    const s = `\nlet K = 9\n`\n    return f(n) + s.length\n  }",
      "n4-tpl-server",
    )).toBe(17);
  }, EXECUTED_DB_TIMEOUT_MS);
});
