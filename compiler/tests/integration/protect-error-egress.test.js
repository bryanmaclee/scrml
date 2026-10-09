/**
 * §14.8.9 × §19.9.5 — ERROR egress (S443 round 6, P3,
 * `g-protect-egress-round-6-residuals`).
 *
 * MEASURED before the fix, over real HTTP against a `scrml build` prod server:
 *   - a CPS server function whose query fails inside SQLite
 *     (`json_extract('{}', passwordHash)` → "bad JSON path: '<the hash>'") answered
 *     500 `{"__scrml_error":true,…,"data":{"message":"bad JSON path: 'SECRET-HASH-123'"}}`;
 *   - a plain server function with the same query threw out of its handler, and the
 *     prod `_server.js` (no `error:` handler) answered with Bun's development error
 *     page — message and source excerpt — unless NODE_ENV=production.
 *
 * This file drives the REAL emitted handler against a REAL SQLite database behind a
 * REAL `Bun.serve` whose `error:` handler is the one `generateServerEntry` emits.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

// Harness isolation (no expectation changes). This file serves REAL HTTP through
// `Bun.serve` + the native `fetch` / `Request` / `Response`. Bun runs every test
// file in ONE process, and an earlier file can leave happy-dom's globals installed
// (the conformance adapter `run()` registers and never unregisters, e.g. via
// cell-assign-server-call-awaited.test.js). Then `Response` is happy-dom's, and
// `Bun.serve` refuses it ("Expected a Response object") while `fetch` reports a
// network error, so every over-HTTP case fails for a reason that has nothing to
// do with §14.8.9. The pairing reproduces on clean main: run
// cell-assign-server-call-awaited.test.js before this file and 5 cases fail.
// Restore the native globals first.
beforeAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const SECRET = "SECRET-HASH-123";

const SRC = (auth) => `<program${auth} db="./app.db">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash"/>
function getIt() {
    const u = ?{\`SELECT json_extract('{}', passwordHash) AS x FROM users WHERE id = 1\`}.get()
    return u
}
function getCps() {
    @msg = ?{\`SELECT json_extract('{}', passwordHash) AS x FROM users WHERE id = 1\`}.get()
}
<resultCell> = ""
<msg> = ""
<button onclick=\${ @resultCell = getIt() }>x</button>
<button onclick=\${ getCps() }>y</button>
<p>\${@resultCell} \${@msg}</p>
</program>
`;

/** The `error(err) { … }` member the prod entry puts on Bun.serve, as a function. */
function prodErrorHandler() {
  const entry = generateServerEntry([]);
  const m = /\n  error\(err\) \{\n[\s\S]*?\n  \},\n/.exec(entry);
  expect(m).not.toBeNull();
  return new Function(`return {${m[0]}};`)().error;
}

async function serve(auth, errorHandler, src = SRC(auth)) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-error-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)");
  db.run(`INSERT INTO users VALUES (1, 'ada', '${SECRET}')`);
  db.close();
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  const fatal = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  expect(fatal.map((e) => e.code)).toEqual([]);
  const sp = join(outDir, "app.server.js");
  const js = readFileSync(sp, "utf8");
  writeFileSync(sp, js.replace('new SQL("sqlite:./app.db")', `new SQL(${JSON.stringify("sqlite:" + dbPath)})`));
  const mod = await import(`file://${sp}?v=${Date.now()}-${Math.random()}`);
  const origError = console.error;
  const server = Bun.serve({
    port: 0,
    development: true, // the case the fix must hold in: NODE_ENV unset
    error: errorHandler,
    async fetch(req) {
      const r = mod.routes.find((x) => x.path === new URL(req.url).pathname);
      return r ? r.handler(req) : new Response("nf", { status: 404 });
    },
  });
  const post = async (fnName) => {
    const route = mod.routes.find((r) => r.path.startsWith(`/_scrml/__ri_route_${fnName}`));
    expect(route).toBeTruthy();
    console.error = () => {}; // the server-side log line is expected; keep the test output clean
    try {
      const res = await fetch(`http://localhost:${server.port}${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
        body: "{}",
      });
      const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
      return { status: res.status, body: await res.text(), headers };
    } finally {
      console.error = origError;
    }
  };
  return { post, stop: () => server.stop(true), serverJs: js };
}

describe("§14.8.9 P3 — an error never carries a protected value to the client", () => {
  test("the CPS ServerError envelope carries a fixed message under protect=, not err.message", async () => {
    const s = await serve(' auth="none"', prodErrorHandler());
    try {
      const r = await s.post("getCps");
      expect(r.status).toBe(500);
      expect(r.body).not.toContain(SECRET);
      expect(r.headers).not.toContain(SECRET);
      const payload = JSON.parse(r.body);
      expect(payload).toMatchObject({ __scrml_error: true, type: "CpsError", variant: "ServerError", data: { fn: "getCps" } });
      expect(typeof payload.data.message).toBe("string");
      // The real error is logged server-side instead.
      expect(s.serverJs).toContain("console.error(\"[scrml] server function `getCps` failed:\", _scrml_cps_err)");
    } finally {
      s.stop();
    }
  }, EXECUTED_DB_TIMEOUT_MS);

  test("an uncaught handler error answers the prod entry's fixed 500, even in development mode", async () => {
    const s = await serve(' auth="none"', prodErrorHandler());
    try {
      const r = await s.post("getIt");
      expect(r.status).toBe(500);
      expect(r.body).toBe("Internal Server Error");
      expect(r.headers).not.toContain(SECRET);
    } finally {
      s.stop();
    }
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a non-protect app keeps the §19.9.5 message (nothing to protect)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-protect-error-np-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, SRC(' auth="none"').replace('<db src="./app.db" tables="users" protect="passwordHash"/>', '<db src="./app.db" tables="users"/>'));
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const serverJs = [...result.outputs.values()][0]?.serverJs ?? "";
    expect(serverJs).toContain("message: _scrml_g.String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err)");
  });
});

// S447 round 7 (item 4) — `scrml dev` answered an uncaught route error with
// `{"error":"Internal server error","detail": err.message}` — measured with a
// real `scrml dev`: `detail: "bad JSON path: 'SECRET-HASH-123'"`. Now it answers
// the fixed 500 and logs the error; and the dev serve config carries an `error:`
// handler for anything that throws past the route catch (Bun's development error
// page otherwise prints the message and source, `scrml dev` not being
// NODE_ENV=production).
describe("§14.8.9 round 7 — `scrml dev` never echoes an error message", () => {
  test("devDispatch: a failing route answers a fixed 500; the message goes to the server log", async () => {
    const { loadServerRoutes, devDispatch } = await import("../../src/commands/dev.js");
    const dir = mkdtempSync(join(tmpdir(), "scrml-protect-error-dev-"));
    const outDir = join(dir, "dist");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(dir, "app.scrml"), SRC(' auth="none"'));
    const dbPath = join(dir, "app.db");
    const db = new Database(dbPath, { create: true });
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT)");
    db.run(`INSERT INTO users VALUES (1, 'ada', '${SECRET}')`);
    db.close();
    compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
    const sp = join(outDir, "app.server.js");
    writeFileSync(sp, readFileSync(sp, "utf8").replace('new SQL("sqlite:./app.db")', `new SQL(${JSON.stringify("sqlite:" + dbPath)})`));
    await loadServerRoutes(outDir);
    const mod = await import(`file://${sp}`);
    const route = mod.routes.find((r) => r.path.startsWith("/_scrml/__ri_route_getIt"));
    const logged = [];
    const origError = console.error;
    console.error = (...a) => logged.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
    let res;
    try {
      res = await devDispatch(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
        body: "{}",
      }), null, outDir, {});
    } finally {
      console.error = origError;
    }
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).not.toContain(SECRET);
    expect(JSON.parse(body)).toEqual({ error: "Internal server error" });
    expect(logged.join("\n")).toContain(SECRET); // the developer still sees it, server-side
  }, EXECUTED_DB_TIMEOUT_MS);

  test("the dev serve config's error: handler answers the fixed 500, never the message", async () => {
    const { buildServeConfig } = await import("../../src/commands/dev.js");
    const cfg = buildServeConfig({ port: 0 }, mkdtempSync(join(tmpdir(), "scrml-dev-errh-")));
    const origError = console.error;
    console.error = () => {};
    let res;
    try {
      res = cfg.error(new Error(`bad JSON path: '${SECRET}'`));
    } finally {
      console.error = origError;
    }
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(JSON.parse(body)).toEqual({ error: "Internal server error" });
  });
});

// S443 round 6b (MUST 4) — round 6 made the descriptor non-writable, and
// `Object.assign(a, b)` on two tagged rows (a refresh in place) answered HTTP 500
// where base answered 200 stripped (review, measured). Over real HTTP: it works
// and still strips; merging rows unions their protected columns.
describe("§14.8.9 round 6b — row-onto-row assignment and merges over HTTP", () => {
  const MERGE_SRC = `<program auth="none" db="./app.db">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash"/>
function getIt() {
    const a = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
    const b = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
    Object.assign(a, b)
    return a
}
function getCps() {
    const a = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
    const b = ?{\`SELECT id, name FROM users WHERE id = 1\`}.get()
    return { ...a, ...b }
}
<resultCell> = ""
<button onclick=\${ @resultCell = getIt() }>x</button>
<button onclick=\${ @resultCell = getCps() }>y</button>
<p>\${@resultCell}</p>
</program>
`;
  test("Object.assign(rowA, rowB) answers 200 stripped; {...a, ...b} keeps a's strip", async () => {
    const s = await serve(' auth="none"', prodErrorHandler(), MERGE_SRC);
    try {
      const r1 = await s.post("getIt");
      expect(r1.status).toBe(200);
      expect(JSON.parse(r1.body)).toEqual({ id: 1, name: "ada" });
      const r2 = await s.post("getCps");
      expect(r2.status).toBe(200);
      expect(r2.body).not.toContain(SECRET);
      expect(JSON.parse(r2.body)).toEqual({ id: 1, name: "ada" });
    } finally {
      s.stop();
    }
  }, EXECUTED_DB_TIMEOUT_MS);
});

// S443 round 6c — `JSON.stringify` invokes `toJSON` after the redact walk; these
// four served the full row (passwordHash included) over HTTP, base AND 6b tip
// (J2, a toJSON METHOD returning a spread, is already rejected at compile time).
describe("§14.8.9 round 6c — toJSON cannot re-introduce a stripped column, over HTTP", () => {
  const J = [
    ["j1", "return { toJSON: () => u }"],
    ["j3", "u.toJSON = () => ({ ...u })\n    return u"],
    ["j4", "const c = { ...u, toJSON: () => u }\n    return c"],
    ["j5", "return { data: { toJSON: () => [u] } }"],
    // Round 6d — a getter answering "ok" on the first read and the row on the
    // second: round 6c walked it once, then JSON.stringify read it again (full row).
    ["j9", 'let n = 0\n    const o = Object.create({ z: 1 })\n    Object.defineProperty(o, "x", { get: () => { n = n + 1; return n > 1 ? u : "ok" }, enumerable: true })\n    return o'],
    ["j10", 'let n = 0\n    const o = Object.create({ z: 1 })\n    Object.defineProperty(o, "x", { get: () => { n = n + 1; return n > 1 ? u : "ok" }, enumerable: true })\n    return { wrap: o }'],
    ["j17", 'let n = 0\n    const o = {}\n    Object.defineProperty(o, "x", { get: () => { n = n + 1; return n > 1 ? u : "ok" }, enumerable: true })\n    return o'],
  ];
  const SRC_J = `<program auth="none" db="./app.db">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash"/>
${J.map(([n, b]) => `function ${n}() {\n    const u = ?{\`SELECT * FROM users WHERE id = 1\`}.get()\n    ${b}\n}`).join("\n")}
<resultCell> = ""
${J.map(([n]) => `<button onclick=\${ @resultCell = ${n}() }>${n}</button>`).join("\n")}
<p>\${@resultCell}</p>
</program>
`;
  test("J1, J3, J4, J5, J9, J10, J17 answer 200 without the protected column", async () => {
    const s = await serve(' auth="none"', prodErrorHandler(), SRC_J);
    try {
      for (const [n] of J) {
        const r = await s.post(n);
        expect([n, r.status, r.body.includes(SECRET)]).toEqual([n, 200, false]);
        if (["j9", "j10", "j17"].includes(n)) expect(r.body).toContain('"x":"ok"'); else expect(r.body).toContain('"name":"ada"');
      }
    } finally {
      s.stop();
    }
  }, EXECUTED_DB_TIMEOUT_MS);
});

// S443 round 6e — a function stored on a row runs with `this` = the row. MEASURED
// (review, base AND 6d): `Object.defineProperty(u, "pw3", { get: function () {
// return this.passwordHash } })` shipped pw3 through the server-fn response,
// `/__mountHydrate` and the SSR state script; `u.toJSON = function () { return {
// pw: this.passwordHash } }` shipped it on 6c/6d. Both layers now hold: the
// compile rejects it (E-PROTECT-006), AND — driven here with the emitted module
// anyway — the runtime sink invokes every author function with `this` = a
// marker-stripped copy, so all three sinks serve no protected value.
describe("§14.8.9 round 6e — `this` in a function stored on a row, all three sinks", () => {
  const SRC_T = `<program db="./app.db" auth="none">
<schema>
  users {
    id: integer primary key
    name: text
    passwordHash: text
    pin: integer
  }
</schema>
<db src="./app.db" tables="users" protect="passwordHash, pin"/>
\${
  server function loadUsers() { return ?{\`SELECT * FROM users\`}.all() }
  server function loadOne() {
    const u = ?{\`SELECT * FROM users WHERE id = 1\`}.get()
    Object.defineProperty(u, "pw3", { get: function () { return this.passwordHash }, enumerable: true })
    return u
  }
  server function loadTo() {
    const rs = ?{\`SELECT * FROM users\`}.all()
    for (const r of rs) { r.toJSON = function () { return [this.passwordHash, this.name] } }
    return rs
  }
  <userCell server> = loadUsers()
  <oneCell server> = loadOne()
  <toCell server> = loadTo()
}
<main>
  <ul><each in=@userCell key=@.id as u><li class="u">\${u.name}</li></each></ul>
  <p>ok</p>
</main>
</program>
`;
  test("compile-time: E-PROTECT-006; run-time: fn response, /__mountHydrate and SSR state serve no protected value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-protect-this-"));
    const out = join(dir, "dist");
    mkdirSync(out);
    writeFileSync(join(dir, "app.scrml"), SRC_T);
    const dbPath = join(dir, "app.db");
    const db = new Database(dbPath, { create: true });
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, passwordHash TEXT, pin INTEGER)");
    db.run(`INSERT INTO users VALUES (1, 'ada', '${SECRET}', 4321)`);
    db.close();
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: out, log: () => {} });
    expect((r.errors ?? []).map((e) => e.code)).toContain("E-PROTECT-006");
    // SPEC §2.2.1 (S457 "1a"): the refused compile writes NO file …
    expect(readdirSync(out)).toEqual([]);
    // … and the run-time strip is defense in depth PAST that refusal, so drive the
    // refused compile's in-memory server codegen directly (plus the document its SSR
    // route reads beside it).
    const emitted = r.outputs.get(join(dir, "app.scrml"));
    writeFileSync(join(out, "app.html"), emitted.html);
    const sp = join(out, "app.server.js");
    writeFileSync(sp, emitted.serverJs.replace(/new SQL\("sqlite:[^"]*"\)/g, `new SQL(${JSON.stringify("sqlite:" + dbPath)})`));
    const mod = await import(`file://${sp}?v=${Date.now()}`);
    const bodies = [];
    for (const rt of mod.routes) {
      const res = await rt.handler(new Request("http://x" + rt.path, {
        method: rt.method, headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
        body: rt.method === "POST" ? "{}" : undefined,
      }));
      bodies.push([rt.path, res.status, await res.text()]);
    }
    const hit = (p) => bodies.find(([path]) => path.includes(p));
    for (const p of ["loadOne", "loadTo", "__mountHydrate", "/app"]) {
      const b = hit(p);
      expect([p, !!b]).toEqual([p, true]);
      expect([p, b[1], b[2].includes(SECRET) || b[2].includes("4321")]).toEqual([p, 200, false]);
    }
    expect(hit("loadTo")[2]).toContain('"ada"'); // the toJSON ran, on a stripped `this`
  }, EXECUTED_DB_TIMEOUT_MS);
});
