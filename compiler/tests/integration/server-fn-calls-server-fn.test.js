/**
 * Issue #1 (parent repo bryanmaclee/scrmlTS) — a server function calling
 * another server function fails at runtime: "<callee> is not defined".
 *
 * REPRO (from the issue):
 *   function nextOrder() {
 *     const row = ?{`SELECT COALESCE(MAX(ord),0)+1 AS n FROM items`}.get()
 *     return row.n
 *   }
 *   function addItem(name) {
 *     const ord = nextOrder()      // <-- "nextOrder is not defined" at runtime
 *     ?{`INSERT INTO items (ord, name) VALUES (${ord}, ${name})`}.run()
 *   }
 *
 * ROOT CAUSE. Each server fn is emitted ONLY as a Request->Response route
 * handler (`_scrml_handler_<name>` + `export const __ri_route_<name>`). The
 * handler is NOT a plain callable, so a sibling fn's body-level `nextOrder()`
 * referenced an undefined symbol.
 *
 * FIX. emit-server.ts now emits a plain in-process peer callable
 * `async function <name>(<params>) { <body> }` for every "simple" server fn
 * that another server fn actually calls, and the call site lowers to
 * `await <name>(...)` (emit-expr.ts serverFnNames path) so the async peer's
 * result is awaited.
 *
 * This file asserts BOTH the emit-shape (always) and the live round-trip
 * (guarded against the happy-dom global pollution that other test dirs install
 * — same rationale as sql-server-fn-runtime.test.js).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { patchAndImport, closeOpenedDbHandles, safeRmSync } from "../helpers/self-host-server-import.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_server_fn_calls");

let tmpCounter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(async () => {
  // Close every imported server module's Bun.SQL handle BEFORE removing the
  // temp dir — on Windows an open DB handle would EBUSY the rmSync. See
  // helpers/self-host-server-import.js for the full rationale.
  await closeOpenedDbHandles();
  safeRmSync(TMP_ROOT);
});

function compileToFiles(scrmlSource, testName, seedFiles = {}) {
  const tag = `${testName}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  const outDir = resolve(tmpDir, "dist");
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);

  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const dbPath = resolve(tmpDir, fileName);
    const db = new Database(dbPath, { create: true });
    for (const stmt of stmts) db.exec(stmt);
    db.close();
  }

  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    serverJsPath: join(outDir, `${tag}.server.js`),
    tmpDir,
  };
}

const REPRO_SRC = `
<program>

<db src="./items.db" tables="items">

  \${
    server function nextOrder() {
      const row = ?{\`SELECT COALESCE(MAX(ord),0)+1 AS n FROM items\`}.get()
      return row.n
    }

    server function addItem(name) {
      const ord = nextOrder()
      ?{\`INSERT INTO items (ord, name) VALUES (\${ord}, \${name})\`}.run()
      return ord
    }
  }

  <div>Items</div>

</>

</program>
`;

const SEED = {
  "items.db": [
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, ord INTEGER, name TEXT NOT NULL)",
  ],
};

describe("Issue #1 — server fn calling another server fn", () => {
  test("emit-shape: callee resolves to an awaited in-process peer callable", () => {
    const { errors, serverJsPath } = compileToFiles(REPRO_SRC, "shape", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    expect(existsSync(serverJsPath)).toBe(true);

    const js = readFileSync(serverJsPath, "utf-8");

    // The call site inside addItem must be awaited (the peer is async), NOT a
    // bare `nextOrder()` (the pre-fix shape that referenced an undefined symbol).
    expect(js).toContain("const ord = await nextOrder();");

    // A plain module-scope peer callable for the callee must be emitted.
    expect(js).toMatch(/async function nextOrder\(\) \{/);

    // The route handler + route export are ADDITIVE — they must still exist.
    expect(js).toContain("async function _scrml_handler_nextOrder_1(");
    expect(js).toContain("async function _scrml_handler_addItem_2(");
    expect(js).toMatch(/export const __ri_route_addItem_2 = \{/);

    // The non-composed fn (addItem — nothing calls it in-process) must NOT get a
    // spurious peer callable; the emission stays surgical.
    expect(js).not.toMatch(/async function addItem\(/);
  });

  test("runtime: addItem invokes nextOrder in-process without ReferenceError", async () => {
    // happy-dom-polluted globals strip the CSRF headers (see
    // sql-server-fn-runtime.test.js for the full rationale). Skip the live
    // round-trip in that case — the emit-shape test above is the guard there.
    if (typeof globalThis.document !== "undefined") return;

    const { errors, serverJsPath, tmpDir } = compileToFiles(REPRO_SRC, "runtime", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    // Point the emitted Bun.SQL handle at the absolute seeded DB path, import,
    // and register the module so its handle is closed at teardown.
    const absDbPath = resolve(tmpDir, "items.db");
    const mod = await patchAndImport(serverJsPath, absDbPath);
    const addRoute = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("addItem"),
    );
    expect(addRoute).toBeDefined();

    const TOKEN = "issue1-csrf-token";
    const mkReq = (body) =>
      new Request(`http://localhost${addRoute.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": TOKEN,
          "Cookie": `scrml_csrf=${TOKEN}`,
        },
        body: JSON.stringify(body),
      });

    // Each addItem call internally calls nextOrder(); the returned ord proves
    // the peer executed (1, then 2 as the table fills).
    const r1 = await addRoute.handler(mkReq({ name: "alpha" }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toBe(1);

    const r2 = await addRoute.handler(mkReq({ name: "beta" }));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toBe(2);

    const verify = new Database(absDbPath);
    const rows = verify.query("SELECT ord, name FROM items ORDER BY id").all();
    verify.close();
    expect(rows).toEqual([
      { ord: 1, name: "alpha" },
      { ord: 2, name: "beta" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Review hardening — edge cases surfaced by /code-review.
// ---------------------------------------------------------------------------

describe("Issue #1 — review hardening", () => {
  // Finding 1: a peer call inside a SYNCHRONOUS callback can't be lowered to
  // `await` (invalid JS in a non-async lambda) nor silently made async (would
  // return Promises from .map). It must surface a clear diagnostic, NOT emit
  // code the compiler's own validator rejects.
  test("peer call inside a synchronous callback yields E-SERVER-FN-IN-SYNC-CALLBACK", () => {
    const src = `
<program>
<db src="./items.db" tables="items">
  \${
    server function lookup(x) {
      const row = ?{\`SELECT n FROM items WHERE id = \${x}\`}.get()
      return row.n
    }
    server function bumpAll(ids) {
      const out = ids.map(x => lookup(x))
      return out
    }
  }
  <button onclick=bumpAll([1,2])>Go</button>
</>
</program>`;
    const { errors } = compileToFiles(src, "sync-callback", {
      "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, n INTEGER)"],
    });
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    // It must NOT be the generic "compiler emitted invalid JS" defect framing.
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Finding 2: a peer call that becomes a CPS return-var initializer must be
  // awaited AND its peer callable emitted (previously emitted a bare,
  // unawaited `nextId();` with no peer → ReferenceError + leaked Promise).
  test("peer call as a CPS return-var init is awaited and the peer is emitted", () => {
    const src = `
<program idempotency-store="sqlite">
<db src="./items.db" tables="items">
  \${ @result = 0 }
  \${
    server function nextId() {
      const row = ?{\`SELECT MAX(id) AS m FROM items\`}.get()
      return row.m
    }
    server function make() {
      ?{\`UPDATE items SET n = n + 1 WHERE id = 1\`}.run()
      @result = nextId()
      return @result
    }
  }
  <p>\${@result}</p>
  <button onclick=make()>Make</button>
</>
</program>`;
    const { errors, serverJsPath } = compileToFiles(src, "cps-init", {
      "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, n INTEGER)"],
    });
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");
    expect(js).toMatch(/async function nextId\(\) \{/);
    expect(js).toContain("_scrml_cps_return = await nextId();");
  });

  // Finding 5: a server fn whose name collides with a builtin (navigate/render/
  // log) must dispatch to the user's peer, not the builtin lowering.
  test("a server fn named like a builtin still resolves to the peer", () => {
    const src = `
<program>
<db src="./items.db" tables="items">
  \${
    server function navigate(to) {
      ?{\`INSERT INTO items (name) VALUES (\${to})\`}.run()
      return to
    }
    server function go() {
      const r = navigate("home")
      return r
    }
  }
  <button onclick=go()>Go</button>
</>
</program>`;
    const { errors, serverJsPath } = compileToFiles(src, "builtin-collision", {
      "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)"],
    });
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");
    // The call must resolve to the peer (`await navigate(...)`), not the
    // client-router builtin `_scrml_navigate(...)`.
    expect(js).toContain("const r = await navigate(");
    expect(js).not.toContain("_scrml_navigate(");
    expect(js).toMatch(/async function navigate\(to\) \{/);
  });
});

// ---------------------------------------------------------------------------
// Round-2 upstream adversarial review — three confirmed defects.
//   A: peer name collides with a synthesized binding (`routes`/`fetch`/enum).
//   B: peer call in a sync-callback PARAMETER DEFAULT → invalid `await`.
//   C: peer reached only through a lambda body (block-body sync, or async) was
//      invisible to peer-emission → `await`/bare call to a missing peer (silent
//      ReferenceError). The peer-emission scan must descend into lambdas; the
//      sync-callback diagnostic must cover block bodies + param defaults.
// ---------------------------------------------------------------------------

describe("Issue #1 — round-2 hardening", () => {
  const ITEMS = { "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, ord INTEGER, name TEXT)"] };
  const wrap = (body) => `
<program>
<db src="./items.db" tables="items">
  \${
${body}
  }
  <button onclick=caller([1])>Go</button>
</>
</program>`;

  // Defect A — a server fn named like a compiler-synthesized binding.
  test("A: peer named `routes` yields E-CG-016, not a malformed-output defect", () => {
    const { errors } = compileToFiles(wrap(
`    server function routes(id) { const r = ?{\`SELECT name FROM items WHERE id = \${id}\`}.get(); return r.name }
    server function caller(ids) { ?{\`INSERT INTO items (ord, name) VALUES (0, 'x')\`}.run(); return routes(ids[0]) }`),
      "collide-routes", ITEMS);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-CG-016");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Defect B — peer call in a synchronous-callback parameter default.
  test("B: peer call in a sync-lambda param default → E-SERVER-FN-IN-SYNC-CALLBACK, not invalid JS", () => {
    const { errors } = compileToFiles(wrap(
`    server function lookup(x) { const r = ?{\`SELECT name FROM items WHERE id = \${x}\`}.get(); return r.name }
    server function caller(ids) { ?{\`INSERT INTO items (ord, name) VALUES (0, 'x')\`}.run(); return ids.map((x, y = lookup(0)) => x) }`),
      "param-default", ITEMS);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Defect C1 — sync BLOCK-body callback (the original "peer not defined" shape).
  test("C1: peer in a sync block-body callback → E-SERVER-FN-IN-SYNC-CALLBACK (no silent bare call)", () => {
    const { errors } = compileToFiles(wrap(
`    server function lookup(x) { const r = ?{\`SELECT name FROM items WHERE id = \${x}\`}.get(); return r.name }
    server function caller(ids) { ?{\`INSERT INTO items (ord, name) VALUES (0, 'x')\`}.run(); return ids.map(x => { return lookup(x) }) }`),
      "sync-block", ITEMS);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Defect C2 — async expr-body lambda. §19.9.8 (S114) RETRACTS user-source
  // async/await: a source `async () =>` is a HARD rejection (E-ASYNC-NOT-IN-SCRML).
  // The pre-S114 "peer reached through an async lambda" shape is no longer legal
  // scrml; the direct-peer-call emission invariant is covered by the emit-shape
  // tests above. (2026-07 async/await hard-error migration.)
  test("C2: an async expr-body lambda is rejected (§19.9.8 E-ASYNC-NOT-IN-SCRML)", () => {
    const { errors } = compileToFiles(wrap(
`    server function helper(x) { const r = ?{\`SELECT name FROM items WHERE id = \${x}\`}.get(); return r.name }
    server function caller(ids) { ?{\`INSERT INTO items (ord, name) VALUES (0, 'x')\`}.run(); const run = async () => helper(ids[0]); return run() }`),
      "async-lambda", ITEMS);
    expect(errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
  });

  // Defect C3 — async BLOCK-body lambda: likewise rejected under §19.9.8. The
  // block-body arrow falls back to an escape-hatch in the default parser; the
  // reject validator's leading-`async` backstop still fires E-ASYNC-NOT-IN-SCRML.
  test("C3: an async block-body lambda is rejected (§19.9.8 E-ASYNC-NOT-IN-SCRML)", () => {
    const { errors } = compileToFiles(wrap(
`    server function helper(x) { const r = ?{\`SELECT name FROM items WHERE id = \${x}\`}.get(); return r.name }
    server function caller(ids) { ?{\`INSERT INTO items (ord, name) VALUES (0, 'x')\`}.run(); const run = async () => { return helper(ids[0]) }; return run() }`),
      "async-block", ITEMS);
    expect(errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
  });
});

// ---------------------------------------------------------------------------
// Round-3 self-review — the lambda/callback matrix, closed uniformly by the
// position-accurate `peerAwaitable` lowering + bare-call recording.
// ---------------------------------------------------------------------------

describe("Issue #1 — round-3 hardening (callback matrix)", () => {
  const ITEMS = { "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, ord INTEGER, name TEXT)"] };
  const L = "server function lookup(x) { const r = ?{`SELECT name FROM items WHERE id = ${x}`}.get(); return r.name }";
  const wrap = (decls, body) => `
${decls}
<db src="./items.db" tables="items">
  \${
${body}
  }
  <button onclick=caller([1])>Go</button>
</>
`;
  const prog = (decls, body) => `<program>${wrap(decls, body)}</program>`;
  const codesOf = (errors) => errors.map((e) => e.code);

  // Bug1: a peer call in an ASYNC lambda's param default — `await` is illegal in
  // a parameter default even in an async fn → must diagnose, not emit invalid JS.
  test("async lambda param-default peer call → diagnostic, not invalid JS", () => {
    const { errors } = compileToFiles(
      prog("", `    ${L}\n    server function caller(ids) { const run = async (x, y = lookup(0)) => x; return run(1) }`),
      "async-param-default", ITEMS);
    expect(codesOf(errors)).toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    expect(codesOf(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Cand4: a sync ES5 `function(x){...}` callback (not an arrow) must diagnose.
  test("sync function() callback peer call → diagnostic (not a silent bare call)", () => {
    const { errors } = compileToFiles(
      prog("", `    ${L}\n    server function caller(ids) { ?{\`INSERT INTO items (ord,name) VALUES (0,'x')\`}.run(); return ids.map(function(x){ return lookup(x) }) }`),
      "sync-function-callback", ITEMS);
    expect(codesOf(errors)).toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
    expect(codesOf(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // Bug2: a lambda param that shadows a peer name is a LOCAL — a call to it is a
  // bare call to the param, not lowered to `await` → must compile clean.
  test("lambda param shadowing a peer name compiles clean (bare call to the param)", () => {
    const { errors } = compileToFiles(
      prog("", `    ${L}\n    server function caller(ids) { ?{\`INSERT INTO items (ord,name) VALUES (0,'x')\`}.run(); return ids.map((lookup) => lookup(1)) }`),
      "param-shadow", ITEMS);
    expect(codesOf(errors).filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });

  // Cand5: a peer colliding with a module value-export (`export const X`) must
  // raise E-CG-016 (the export is otherwise silently dropped).
  test("peer colliding with an exported value binding → E-CG-016", () => {
    const { errors } = compileToFiles(
      prog("", `    export const lookup = 5\n    ${L}\n    server function caller(ids) { ?{\`INSERT INTO items (ord,name) VALUES (0,'x')\`}.run(); return lookup(ids[0]) }`),
      "export-collision", ITEMS);
    expect(codesOf(errors)).toContain("E-CG-016");
    expect(codesOf(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  // §19.9.8 (S114): an async block-body lambda calling a peer is REJECTED —
  // user-source async/await is retracted (E-ASYNC-NOT-IN-SCRML via the reject
  // validator's leading-`async` escape-hatch backstop). Was a pre-S114 "legit"
  // shape; the peer-emission invariant lives in the direct-call tests above.
  test("async block-body lambda calling a peer is rejected (§19.9.8 E-ASYNC-NOT-IN-SCRML)", () => {
    const { errors } = compileToFiles(
      prog("", `    ${L}\n    server function caller(ids) { const run = async () => { return lookup(ids[0]) }; return run() }`),
      "async-block-legit", ITEMS);
    expect(codesOf(errors)).toContain("E-ASYNC-NOT-IN-SCRML");
  });
});


// ---------------------------------------------------------------------------
// ss19 #8 (g-pure-fn-rpc-async-unawaited) — peer-call await-threading through
// CONTROL FLOW + RECEIVER positions.
//
// b2bf9959 threaded `await <peer>()` only through the DIRECT statement emit of a
// server-fn body. A peer call appearing inside an `if`/`for`/`while`/`do-while`
// CONDITION or BODY dropped serverFnNames (emit-logic's control-flow dispatch +
// emit-control-flow's ctx construction built a fresh client-mode ctx), so the
// call emitted a BARE unawaited Promise -> silent-wrong (a `!=` against a Promise
// is always true; a `.ok` on a Promise is undefined). Additionally, a peer call
// used as a RECEIVER (`peer().field`) lowered to `await peer().field`, which
// parses as `await (peer().field)` — awaiting the wrong thing; it must be wrapped
// `(await peer()).field`. Both are silent-correctness defects (green compile,
// `node --check` clean) in the same lowering machinery as Issue #1.
// ---------------------------------------------------------------------------

describe("ss19 #8 — peer-call await threading through control flow + receivers", () => {
  const ITEMS = { "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)"] };
  const wrap = (body) => `<program>
<db src="./items.db" tables="items">
  \${
    fn norm(s: string) -> string { return s }
    server function lookup(x) { const r = ?{\`SELECT id, label FROM items WHERE id = \${x}\`}.get(); return { label: r is some ? r.label : "", ok: r is some } }
${body}
  }
  <button onclick=caller(1)>Go</button>
</>
</program>`;

  test("peer call in if/for/while/return + member-receiver all await-wrapped; output parses", () => {
    const caller = `    server function caller(x) {
      ?{\`INSERT INTO items (id, label) VALUES (1, 'a')\`}.run()
      let out = ""
      if (lookup(x).ok) { out = "hit" }
      for (const i of [1, 2]) { const e = lookup(i).ok; out = out }
      let n = 0
      while (n < 1) { const w = lookup(x).label; n = n + 1 }
      return { out: out, done: lookup(x).ok, t: norm(out) }
    }`;
    const { errors, serverJsPath } = compileToFiles(wrap(caller), "ss19-8-shape", ITEMS);
    // No malformed-output / codegen errors (the receiver mis-grouping was a
    // silent miscompile, but the structural threading gap could also produce
    // unparseable output in some shapes — assert clean either way).
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);
    const js = readFileSync(serverJsPath, "utf-8");

    // if-condition: member access on a peer result → (await lookup(x)).ok
    expect(js).toContain("if ((await lookup(x)).ok)");
    // for-body: peer call awaited + receiver-wrapped
    expect(js).toContain("const e = (await lookup(i)).ok;");
    // while-body: peer call awaited + receiver-wrapped
    expect(js).toContain("const w = (await lookup(x)).label;");
    // return statement: member access on peer result wrapped
    expect(js).toContain("(await lookup(x)).ok");
    // pure-fn peer in return value (no member access) → bare await, NO spurious wrap
    expect(js).toContain("await norm(out)");
    expect(js).not.toContain("(await norm(out))");

    // CRITICAL: no BARE unawaited peer call survives in these positions.
    expect(js).not.toMatch(/if \(lookup\(x\)\.ok\)/);
    expect(js).not.toMatch(/const e = lookup\(i\)\.ok;/);
    // and the mis-grouped receiver form must NOT appear.
    expect(js).not.toContain("await lookup(x).ok");
    expect(js).not.toContain("await lookup(i).ok");
  });

  test("runtime: a pure-fn comparison inside `if` resolves the value, not a Promise (silent-wrong fix)", async () => {
    // happy-dom-polluted globals strip the CSRF headers (see the Issue #1 runtime
    // test). Skip the live round-trip there — the emit-shape test guards it.
    if (typeof globalThis.document !== "undefined") return;

    const SRC = `<program>
<db src="./items.db" tables="items">
  \${
    fn norm(s: string) -> string { return s }
    server function check(name) {
      const row = ?{\`SELECT id, label FROM items WHERE label = \${name}\`}.get()
      if (row is not) { return { miss: true } }
      if (row.label != norm(name)) { return { mismatch: true } }
      return { ok: true }
    }
  }
  <button onclick=check("alpha")>Go</button>
</>
</program>`;
    const SEED = { "items.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)", "INSERT INTO items (id, label) VALUES (1, 'alpha')"] };
    const { errors, serverJsPath, tmpDir } = compileToFiles(SRC, "ss19-8-runtime", SEED);
    expect(errors.filter((e) => !e.code?.startsWith("W-"))).toEqual([]);

    const js = readFileSync(serverJsPath, "utf-8");
    // The comparison operand must be the AWAITED value (the post-fix shape).
    expect(js).toContain("await norm(name)");

    const absDbPath = resolve(tmpDir, "items.db");
    const mod = await patchAndImport(serverJsPath, absDbPath);
    const route = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes("check"),
    );
    expect(route).toBeDefined();

    const TOKEN = "ss19-8-csrf";
    const req = new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` },
      body: JSON.stringify({ name: "alpha" }),
    });
    const resp = await route.handler(req);
    expect(resp.status).toBe(200);
    // row.label ("alpha") == norm("alpha") ("alpha") → {ok:true}. The pre-fix bug
    // compared "alpha" against a Promise → always {mismatch:true}.
    expect(await resp.json()).toEqual({ ok: true });
  });
});
