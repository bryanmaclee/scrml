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
import { describe, test, expect } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";

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
  });

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
  });

  test("a non-protect app keeps the §19.9.5 message (nothing to protect)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-protect-error-np-"));
    const file = join(dir, "app.scrml");
    writeFileSync(file, SRC(' auth="none"').replace('<db src="./app.db" tables="users" protect="passwordHash"/>', '<db src="./app.db" tables="users"/>'));
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const serverJs = [...result.outputs.values()][0]?.serverJs ?? "";
    expect(serverJs).toContain("message: String(_scrml_cps_err && _scrml_cps_err.message || _scrml_cps_err)");
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
  });
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
  test("J1, J3, J4, J5 answer 200 without the protected column", async () => {
    const s = await serve(' auth="none"', prodErrorHandler(), SRC_J);
    try {
      for (const [n] of J) {
        const r = await s.post(n);
        expect([n, r.status, r.body.includes(SECRET)]).toEqual([n, 200, false]);
        expect(r.body).toContain('"name":"ada"');
      }
    } finally {
      s.stop();
    }
  });
});
