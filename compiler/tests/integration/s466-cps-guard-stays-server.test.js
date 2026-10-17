/**
 * S466 (s462-p0-cps fix round 3) — SPEC §19.9.9.8 rule 3, ruling user-voice-scrml.md
 * S464 "(a) Guards stay server": in a CPS-split function, a statement that reads a
 * server-originated value and can end the function before later server work (a
 * `return`, a `fail`, a `?`, a `break` leaving it) — or a control statement whose
 * body holds server work — decides on the SERVER whether that work runs. Every
 * statement between it and the work joins the same batch, so the check and the work
 * share ONE request; a guard that needs the browser is E-RI-002.
 *
 * The motivating hole (PA-reproduced S465): `@ok = vp(pass, ?{SELECT pw…}.get().pw);
 * if (!@ok) { alert("wrong"); return }; ?{INSERT …}.run()` split the guard into the
 * browser and left the INSERT in its own batch route — callable by anyone, without
 * the password check.
 *
 * Every accepting shape below is EXECUTED: the server bundle is imported under bun
 * with a real bun:sqlite database (bob has a real argon2 hash), and EVERY route the
 * function has is driven with forged requests (wrong password, and a forged
 * `ok: true` cell) — no write may land without the right password. The main shape
 * is also run end-to-end in happy-dom with the browser's fetch wired to the server.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { hashPassword } from "../../runtime/stdlib/auth.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

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
  ${fnSrc}
  <button id="go" onclick={ post("bob", "wrong-password", "hi") }>post</button>
  <p id="msg">\${@msg}</p>
</program>
`;

const SELECT_PW = "?{`SELECT pw FROM users WHERE name = ${name}`}.get().pw";
const INSERT = "?{`INSERT INTO posts (author, body) VALUES (${name}, ${body})`}.run()";

async function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s466-guard-"));
  dirs.push(dir);
  const out = join(dir, "dist");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dir, "app.scrml"), src);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("CREATE TABLE posts (id INTEGER PRIMARY KEY, author TEXT, body TEXT)");
  db.run("INSERT INTO users (name, pw) VALUES ('bob', ?)", [HASH]);
  db.close();
  const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: out, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  if (errors.length > 0) return { errors };
  const mod = await import(`file://${join(out, "app.server.js")}?v=${Date.now()}-${Math.random()}`);
  return {
    errors,
    dir,
    mod,
    routes: mod.routes.filter((r) => /__ri_route_post_\d+/.test(r.path)).map((r) => r.path),
    clientJs: readFileSync(join(out, "app.client.js"), "utf8"),
    serverJs: readFileSync(join(out, "app.server.js"), "utf8"),
    html: readFileSync(join(out, "app.html"), "utf8"),
  };
}

async function call(b, path, body) {
  const res = await b.mod.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

function posts(b) {
  const db = new Database(join(b.dir, "app.db"));
  const n = db.query("SELECT count(*) AS n FROM posts").get().n;
  db.close();
  return n;
}

// Forge every route the function has: a wrong password, with and without a forged
// `ok: true` cell in the request. Nothing may be written.
async function forgeEveryRoute(b) {
  expect(b.routes.length).toBeGreaterThan(0);
  for (const path of b.routes) {
    for (const forged of [{}, { ok: true }, { ok: true, msg: "posted" }]) {
      await call(b, path, { name: "bob", pass: "wrong-password", body: "forged", ...forged });
    }
  }
  expect(posts(b)).toBe(0);
}

describe("S466 — a guard that reads a server value stays on the server (executed)", () => {
  test("the S465 shape with a cell-write guard: one route; forged requests write nothing; the right password writes", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { @msg = "wrong"; return }
    ${INSERT}
    @msg = "posted"
  }`));
    expect(b.errors).toEqual([]);
    // The check and the write it guards are ONE batch: there is no write-only route.
    expect(b.routes.length).toBe(1);
    expect(b.clientJs).not.toMatch(/__batch_1/);
    await forgeEveryRoute(b);
    const wrong = await call(b, b.routes[0], { name: "bob", pass: "wrong-password", body: "x" });
    expect(wrong.json.__scrml_cells).toEqual({ ok: false, msg: "wrong" });
    expect(wrong.json.__scrml_exit).toEqual({});
    expect(posts(b)).toBe(0);
    const right = await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    // (`@msg = "posted"` reads no server value and follows the server work: it runs
    // in the browser, after the batch — and only when the batch did not end the function.)
    expect(right.json.__scrml_cells).toEqual({ ok: true });
    expect(b.clientJs).toMatch(/if \("__scrml_exit" in _scrml_server_result\) return _scrml_server_result\.__scrml_exit\.value;\n\s*_scrml_cs_reactive_set\("msg", "posted"\);/);
    expect("__scrml_exit" in right.json).toBe(false);
    expect(posts(b)).toBe(1);
    expect(right.text).not.toContain("$argon2");
  }, T);

  test("the same shape, executed in the browser (happy-dom) against the real server: a wrong password posts nothing", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { @msg = "wrong"; return }
    ${INSERT}
    @msg = "posted"
  }`));
    expect(b.errors).toEqual([]);
    const RealRequest = Request;
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    try {
      const g = globalThis;
      const sent = [];
      g.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const headers = { ...(init?.headers ?? {}), Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok", "Content-Type": "application/json" };
        sent.push(String(init?.body ?? ""));
        return b.mod.fetch(new RealRequest(`http://localhost${url}`, { method: "POST", headers, body: init?.body }));
      };
      const bodyHtml = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(b.html) ?? [null, b.html])[1];
      g.document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
      (0, eval)("(function () {\n" + SCRML_RUNTIME + "\n" + b.clientJs + "\n})();");
      g.document.dispatchEvent(new g.Event("DOMContentLoaded", { bubbles: true }));
      g.document.querySelector("#go").click();
      for (let i = 0; i < 100 && g.document.querySelector("#msg").textContent.trim() === ""; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(g.document.querySelector("#msg").textContent.trim()).toBe("wrong");
      expect(sent.length).toBe(1);
      expect(sent.join("")).not.toContain("$argon2");
      expect(posts(b)).toBe(0);
    } finally {
      if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    }
  }, T);

  test("`return` with no cell write in the guard", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { return }
    ${INSERT}
    @msg = "posted"
  }`));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeEveryRoute(b);
    await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    expect(posts(b)).toBe(1);
  }, T);

  test("a browser-safe statement between the guard and the write joins the batch", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { @msg = "wrong"; return }
    @msg = "posting"
    ${INSERT}
  }`));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeEveryRoute(b);
    const right = await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    expect(right.json.__scrml_cells.msg).toBe("posting");
    expect(posts(b)).toBe(1);
  }, T);

  test("`fail` in the guard: the error envelope comes back, nothing is written", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string)! -> PostError {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { fail PostError.Denied }
    ${INSERT}
    @msg = "posted"
  }`, "type PostError:enum = { Denied }").replace(
      `onclick={ post("bob", "wrong-password", "hi") }`, `onclick={ post("bob", "wrong-password", "hi") !{ _ :> @msg = "denied" } }`));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeEveryRoute(b);
    const wrong = await call(b, b.routes[0], { name: "bob", pass: "wrong-password", body: "x" });
    expect(wrong.json.__scrml_error).toBe(true);
    expect(wrong.json.variant).toBe("Denied");
    const right = await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    expect(right.json.__scrml_cells.ok).toBe(true);
    expect(posts(b)).toBe(1);
  }, T);

  test("`break` out of a loop whose body holds the write", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    for (const r of [1, 2]) {
      if (!@ok) { break }
      ${INSERT}
    }
    @msg = "done"
  }`));
    expect(b.errors).toEqual([]);
    await forgeEveryRoute(b);
    await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    expect(posts(b)).toBe(2);
  }, T);

  test("an `if` whose body holds the write", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (@ok) {
      ${INSERT}
      @msg = "posted"
    }
  }`));
    expect(b.errors).toEqual([]);
    expect(b.routes.length).toBe(1);
    await forgeEveryRoute(b);
    await call(b, b.routes[0], { name: "bob", pass: "right-password", body: "x" });
    expect(posts(b)).toBe(1);
  }, T);

  test("a guard AFTER the function's last server work guards nothing on the server: it stays in the browser", async () => {
    const b = await build(program(`function post(name: string, pass: string, body: string) {
    ${INSERT}
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { alert("wrong"); return }
    @msg = "welcome"
  }`));
    expect(b.errors).toEqual([]);
    expect(b.clientJs).toContain("alert(");
    expect(b.serverJs).not.toContain("alert(");
  }, T);
});

describe("S466 — a guard that needs the browser is refused (E-RI-002)", () => {
  const FIX = "move the browser work after the server work, or split the function";
  const refused = async (fnSrc) => {
    const b = await build(program(fnSrc));
    const e = b.errors.filter((x) => x.code === "E-RI-002");
    expect(e.length).toBeGreaterThan(0);
    expect(e.map((x) => x.message).join("\n")).toContain(FIX);
    return e;
  };

  test("the S465 repro: `if (!@ok) { alert(…); return }` before the INSERT", async () => {
    const e = await refused(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { alert("wrong"); return }
    ${INSERT}
  }`);
    expect(e[0].message).toContain("`@ok`");
    expect(e[0].message).toContain("alert");
  }, T);

  test("a browser statement between the guard and the work it guards", async () => {
    await refused(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (!@ok) { @msg = "wrong"; return }
    alert("posting")
    ${INSERT}
  }`);
  }, T);

  test("an `if` that reads the server value and holds browser work beside the write", async () => {
    await refused(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    if (@ok) {
      alert("posting")
      ${INSERT}
    }
    @msg = "done"
  }`);
  }, T);

  test("a guard on a value derived in the browser from a server value", async () => {
    const e = (await build(program(`function post(name: string, pass: string, body: string) {
    @ok = vp(pass, ${SELECT_PW})
    @msg = localStorage.getItem(@ok ? "y" : "n") ?? "n"
    if (@msg != "y") { return }
    ${INSERT}
  }`))).errors.filter((x) => x.code === "E-RI-002");
    expect(e.length).toBeGreaterThan(0);
  }, T);
});
