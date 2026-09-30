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

async function serve(auth, errorHandler) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-protect-error-"));
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, SRC(auth));
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
