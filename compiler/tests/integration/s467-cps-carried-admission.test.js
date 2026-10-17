/**
 * S467 (s462-p0-cps fix round 5) — SPEC §19.9.9.8: "a server value never travels to
 * the client and back as later-batch input". The ADMISSION ALLOW-LIST
 * (route-inference.ts `carriedValueAdmission`).
 *
 * Rounds 1–4 asked "is this value derived from a server value?" and each review
 * found a write the taint pass could not see. The S467 review of round 4 ran seven
 * more shapes, all of which wrote a row with the WRONG password: a later batch read a
 * pre-first local from the request (`let blk = _scrml_body["blk"]`) after the
 * browser had changed it under a server check —
 *
 *   arrow_closure   `const set = () => { blk = true }` … `if (!@ok) { alert(); set() }`
 *   fnexpr_closure  the same with `function () { … }`
 *   forof_destr     `for ([blk] of [[true]]) {}` in the check
 *   closure_obj     `const mark = () => { st.blk = true }`
 *   alias_mut       `const a = st` … `a.blk = true` (the INSERT reads `st.blk`)
 *   alias_arr       `const a = [st]` … `a[0][0] = true`
 *   alias_destr     `const [a] = [st]` … `a.blk = true`
 *
 * The rule is now the converse, and fails closed: a value is read from the request
 * only when it is PROVABLY browser-only data nothing after the first server
 * statement can have changed — by any route (direct write, member write, `for…of`
 * head, destructuring, a body-defined function value, an alias, a call that may
 * keep it). Anything else is E-RI-002. The legal flows still compile, and hold
 * under requests forged with EVERY name the server reads from the request.
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

const program = (fnSrc) => `<program db="./app.db">
  import { verifyPassword as vp } from "scrml:auth"
  <ok> = false
  <msg> = ""
  ${fnSrc}
  <button id="go" onclick={ post("bob", "wrong-password", "hi") }>post</button>
  <p id="msg">\${@msg}</p>
</program>
`;

const SEL = "?{`SELECT pw FROM users WHERE name = ${name}`}.get().pw";
const INS = "?{`INSERT INTO posts (author, body) VALUES (${name}, ${body})`}.run()";
const F = (b) => `function post(name: string, pass: string, body: string) {\n${b}\n}`;

async function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s467-adm-"));
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

// Forge every name the server reads from the request (cells and carried locals),
// with every value shape a check could be steered by, on every route.
async function forgeEverythingThenRight(b, carried = {}) {
  expect(b.routes.length).toBeGreaterThan(0);
  const names = [...new Set([...b.serverJs.matchAll(/_scrml_body\[["'`]([A-Za-z_$][\w$]*)["'`]\]/g)].map((m) => m[1]))]
    .filter((n) => !["name", "pass", "body"].includes(n));
  const all = (v) => Object.fromEntries(names.map((n) => [n, v]));
  const FORGED = [{}, all(true), all(false), all(1), all(0), all("admin"), all(null), all({ blk: false }), all([false])];
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

function expectRefused(b, value) {
  const codes = [...new Set(b.errors.map((e) => e.code))];
  expect(codes).toContain("E-RI-002");
  expect(codes.filter((c) => c.startsWith("E-CG-") || c.startsWith("E-INTERNAL"))).toEqual([]);
  const msg = b.errors.filter((e) => e.code === "E-RI-002").map((e) => e.message).join("\n");
  expect(msg).toContain(`reads \`${value}\` from the request`);
}

const REFUSED = {
  arrow_closure: ["blk", `let blk = false\n const set = () => { blk = true }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); set() }\n if (!blk) { ${INS} }`],
  fnexpr_closure: ["blk", `let blk = false\n const set = function() { blk = true }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); set() }\n if (!blk) { ${INS} }`],
  forof_destr: ["blk", `let blk = false\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); for ([blk] of [[true]]) {} }\n if (!blk) { ${INS} }`],
  closure_obj: ["st", `const st = { blk: false }\n const mark = () => { st.blk = true }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); mark() }\n if (!st.blk) { ${INS} }`],
  alias_mut: ["st", `const st = { blk: false }\n const a = st\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); a.blk = true }\n if (!st.blk) { ${INS} }`],
  alias_arr: ["st", `const st = [false]\n const a = [st]\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("wrong"); a[0][0] = true }\n if (!st[0]) { ${INS} }`],
  alias_destr: ["st", `const st = { blk: false }\n const [a] = [st]\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); a.blk = true }\n if (!st.blk) { ${INS} }`],
  // further routes to the same hole
  closure_alias: ["blk", `let blk = false\n const set = () => { blk = true }\n const s2 = set\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); s2() }\n if (!blk) { ${INS} }`],
  closure_returns_obj: ["st", `const st = { blk: false }\n const get = () => st\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); get().blk = true }\n if (!st.blk) { ${INS} }`],
  nested_alias: ["st", `const st = { blk: false }\n const box = { inner: st }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); box.inner.blk = true }\n if (!st.blk) { ${INS} }`],
  forof_element_alias: ["st", `const st = { blk: false }\n const all = [st]\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); for (const q of all) { q.blk = true } }\n if (!st.blk) { ${INS} }`],
  pushed_alias: ["st", `const st = { blk: false }\n const all = []\n all.push(st)\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); all[0].blk = true }\n if (!st.blk) { ${INS} }`],
  param_closure: ["body", `const clr = () => { body = "" }\n @ok = vp(pass, ${SEL})\n if (!@ok) { alert("w"); clr() }\n if (body != "") { ${INS} }`],
};

describe("S467 r5 — a value the browser can change after the server work begins is never read from the request (E-RI-002)", () => {
  for (const [name, [value, fnBody]] of Object.entries(REFUSED)) {
    test(name, async () => {
      const b = await build(program(F(fnBody)));
      expectRefused(b, value);
    }, T);
  }
});

describe("S467 r5 — legal flows compile and hold under requests forging every request name (executed)", () => {
  test("a check on a server value, then the work, then a browser alert", async () => {
    const b = await build(program(F(`@ok = vp(pass, ${SEL})\n if (!@ok) { @msg = "wrong"; return }\n ${INS}\n alert("posted")`)));
    expect(b.errors).toEqual([]);
    await forgeEverythingThenRight(b);
  }, T);

  test("a check on a server-computed local", async () => {
    const b = await build(program(F(`const h = ${SEL}\n const good = vp(pass, h)\n if (!good) { @msg = "wrong"; return }\n ${INS}\n @msg = "posted"`)));
    expect(b.errors).toEqual([]);
    await forgeEverythingThenRight(b);
  }, T);

  test("a browser closure used only before the first server statement", async () => {
    const b = await build(program(F(`let n = 0\n const bump = () => { n = n + 1 }\n bump()\n @ok = vp(pass, ${SEL})\n if (!@ok) { @msg = "wrong"; return }\n ${INS}\n @msg = "posted " + n`)));
    expect(b.errors).toEqual([]);
    await forgeEverythingThenRight(b);
  }, T);

  test("a pre-first browser value the server reads and nothing changes afterwards is carried", async () => {
    const b = await build(program(F(`const tag = name.trim()\n @ok = vp(pass, ${SEL})\n if (!@ok) { @msg = "wrong"; return }\n ?{\`INSERT INTO posts (author, body) VALUES (\${tag}, \${body})\`}.run()`)));
    expect(b.errors).toEqual([]);
    expect(b.serverJs).toMatch(/_scrml_body\["tag"\]/);
    await forgeEverythingThenRight(b, { tag: "bob" });
  }, T);
});
