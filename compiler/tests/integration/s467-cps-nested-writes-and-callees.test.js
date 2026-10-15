/**
 * S467 (s462-p0-cps fix round 4) — SPEC §19.9.9.8: a value a statement derives from
 * a server-originated value is itself server-originated, WHEREVER the statement
 * writes it and WHATEVER it calls to do so.
 *
 * Round 3 tracked only the locals a statement declared at its TOP level, and read
 * each statement on its own. Four holes the S467 review reproduced (forged requests
 * ran the INSERT without the password):
 *
 *   - a nested write: `if (!@ok) { alert("wrong"); blk = true }; if (!blk) { INSERT }`
 *     — `blk` was never marked server-derived, so the INSERT's batch read it from the
 *     request (`_scrml_body["blk"]`) and trusted it;
 *   - a mutation: `flags.push(1)` / `st.stop = true` under the same check;
 *   - the same through a server-read role (`if (@role == "admin") { …; admin = true }`);
 *   - a callee: `if (!@ok) { deny(); return }` with `function deny() { alert(…) }` —
 *     `deny` was promoted to the server by that very call, so `alert` ran in the
 *     server process.
 *
 * Each of those statements reads a server value and needs the browser, so it must
 * stay on the server and cannot: E-RI-002 (§19.9.9.8 rule 3). The same shapes
 * WITHOUT a browser need compile, and are executed: every route is forged, nothing
 * is written without the right password, and the right password writes.
 *
 * Also: a string-literal `match` arm guard (`"y" :> { @msg = "ok" }`) was refused
 * with the internal E-CG-006 — the batch planner did not see a cell write the parser
 * kept as arm text. It now compiles and runs.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";

const T = 30_000;
const dirs = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

let HASH;
beforeAll(async () => { HASH = await hashPassword("right-password"); }, T);

const program = (fnSrc, extraTop = "") => `<program db="./app.db">
  import { verifyPassword as vp } from "scrml:auth"
  ${extraTop}
  <ok> = false
  <msg> = ""
  <role> = ""
  ${fnSrc}
  <button id="go" onclick={ post("bob", "wrong-password", "hi") }>post</button>
  <p id="msg">\${@msg}</p>
</program>
`;

const SEL = "?{`SELECT pw FROM users WHERE name = ${name}`}.get().pw";
const ROW = "?{`SELECT pw, role FROM users WHERE name = ${name}`}.get()";
const INS = "?{`INSERT INTO posts (author, body) VALUES (${name}, ${body})`}.run()";
const F = (b) => `function post(name: string, pass: string, body: string) {\n${b}\n}`;

async function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s467-cps-"));
  dirs.push(dir);
  const out = join(dir, "dist");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dir, "app.scrml"), src);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT, role TEXT)");
  db.run("CREATE TABLE posts (id INTEGER PRIMARY KEY, author TEXT, body TEXT)");
  db.run("INSERT INTO users (name, pw, role) VALUES ('bob', ?, 'user')", [HASH]);
  db.close();
  const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: out, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  if (errors.length > 0) return { errors, dir, out };
  const mod = await import(`file://${join(out, "app.server.js")}?v=${Date.now()}-${Math.random()}`);
  return {
    errors,
    dir,
    out,
    mod,
    routes: mod.routes.filter((r) => /__ri_route_post_\d+/.test(r.path)).map((r) => r.path),
    clientJs: readFileSync(join(out, "app.client.js"), "utf8"),
    serverJs: readFileSync(join(out, "app.server.js"), "utf8"),
  };
}

async function call(b, path, body) {
  const res = await b.mod.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, text: await res.text() };
}

function posts(b) {
  const db = new Database(join(b.dir, "app.db"));
  const n = db.query("SELECT count(*) AS n FROM posts").get().n;
  db.close();
  return n;
}

// Every forged value a later batch could have trusted, on every route.
const FORGED = [{}, { ok: true }, { ok: true, msg: "posted", role: "admin", blk: false, admin: true, flags: [], st: { stop: false }, k: "y" }];

// `carried`: the pre-first locals the real client stub sends (§19.9.9.8 rule 4 —
// client data, like a parameter); the right-password call sends what the browser would.
async function forgeThenRight(b, carried = {}) {
  expect(b.routes.length).toBeGreaterThan(0);
  for (const path of b.routes) {
    for (const f of FORGED) {
      const r = await call(b, path, { name: "bob", pass: "wrong-password", body: "forged", ...f });
      expect(r.text).not.toContain("$argon2");
    }
  }
  expect(posts(b)).toBe(0);
  for (const path of b.routes) {
    const r = await call(b, path, { name: "bob", pass: "right-password", body: "ok", ...carried });
    expect(r.text).not.toContain("$argon2");
  }
  expect(posts(b)).toBe(1);
  expect(b.clientJs).not.toMatch(/\$argon2|\.pw\b/);
}

function expectRefusedE_RI_002(b) {
  const codes = [...new Set(b.errors.map((e) => e.code))];
  expect(codes).toContain("E-RI-002");
  // never an internal codegen error
  expect(codes.filter((c) => c.startsWith("E-CG-") || c.startsWith("E-INTERNAL"))).toEqual([]);
}

describe("S467 — a server-derived value written in a nested statement or a callee (§19.9.9.8)", () => {
  test("a nested local write under a server check that needs the browser is E-RI-002 (`if (!@ok) { alert; blk = true }`)", async () => {
    const b = await build(program(F(`let blk = false\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); blk = true }\n if (!blk) { ${INS} }`)));
    expectRefusedE_RI_002(b);
  }, T);

  test("the same, then `if (blk) { return }` before the write, is E-RI-002", async () => {
    const b = await build(program(F(`let blk = false\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); blk = true }\n if (blk) { return }\n ${INS}`)));
    expectRefusedE_RI_002(b);
  }, T);

  test("a local set under a server-read role (`if (@role == \"admin\") { alert; admin = true }`) is E-RI-002", async () => {
    const b = await build(program(F(`let admin = false\n const r = ${ROW}\n @role = r.role\n if (@role == "admin") { alert("hi admin"); admin = true }\n if (admin) { ${INS} }`)));
    expectRefusedE_RI_002(b);
  }, T);

  test("an array mutated under a server check that needs the browser (`flags.push(1)`) is E-RI-002", async () => {
    const b = await build(program(F(`const flags = []\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); flags.push(1) }\n if (flags.length == 0) { ${INS} }`)));
    expectRefusedE_RI_002(b);
  }, T);

  test("an object field set under a server check that needs the browser (`st.stop = true`) is E-RI-002", async () => {
    const b = await build(program(F(`const st = { stop: false }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); st.stop = true }\n if (!st.stop) { ${INS} }`)));
    expectRefusedE_RI_002(b);
  }, T);

  test("a guard that calls a browser-needing helper (`if (!@ok) { deny(); return }`) is E-RI-002 — `alert` never reaches the server", async () => {
    const b = await build(program(F(`@ok = vp(pass, ${SEL})\n if (!@ok) { deny(); return }\n ${INS}`), `\${ function deny() { alert("denied") } }`));
    expectRefusedE_RI_002(b);
    const msg = b.errors.find((e) => e.code === "E-RI-002").message;
    expect(msg).toContain("@ok");
  }, T);
});

describe("S467 — the same shapes without the browser compile, and hold under forged requests (executed)", () => {
  test("a nested local write under a server check, no browser need: one batch; forged requests write nothing", async () => {
    const b = await build(program(F(`let blk = false\n @ok = vp(pass, ${SEL})\n if (!@ok) { @msg = "wrong"; blk = true }\n if (!blk) { ${INS} }`)));
    expect(b.errors).toEqual([]);
    // `blk` is the author's pre-first `let` (carried client data, reassigned on the server)
    expect(b.serverJs).toMatch(/let blk = _scrml_body\["blk"\];/);
    await forgeThenRight(b, { blk: false });
  }, T);

  test("an array mutated under a server check, no browser need: forged requests write nothing", async () => {
    const b = await build(program(F(`const flags = []\n @ok = vp(pass, ${SEL})\n if (!@ok) { @msg = "wrong"; flags.push(1) }\n if (flags.length == 0) { ${INS} }`)));
    expect(b.errors).toEqual([]);
    await forgeThenRight(b, { flags: [] });
  }, T);

  test("a guard that calls a pure helper (`@msg = note(\"w\"); return`): forged requests write nothing", async () => {
    const b = await build(program(F(`@ok = vp(pass, ${SEL})\n if (!@ok) { @msg = note("w"); return }\n ${INS}`), `\${ function note(s) { return "x" + s } }`));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeThenRight(b);
  }, T);

  test("a string-literal match-arm guard compiles (no internal E-CG-006) and holds", async () => {
    const b = await build(program(F(`@ok = vp(pass, ${SEL})\n const k: string = @ok ? "y" : "n"\n match (k) {\n "y" :> { @msg = "ok" }\n else :> { return }\n }\n ${INS}`)));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeThenRight(b);
    // the arm's cell write comes back to the client
    const r = await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "again" });
    expect(JSON.parse(r.text).__scrml_cells.msg).toBe("ok");
  }, T);
});
