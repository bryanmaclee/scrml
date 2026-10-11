/**
 * S462 P0 — END TO END: the emitted client bundle, executing in happy-dom, drives the
 * emitted server module (real bun:sqlite database, real argon2id hash) through its own
 * generated fetch stub.
 *
 *   server function login(pass: string) {
 *     @out = ?{`SELECT name, pw FROM users WHERE name = 'bob'`}.get()
 *     if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
 *   }
 *
 * On a9aa81eff the split put the `if` on the CLIENT: the server answered with the row
 * (hash included) and the page ran `!vp(...)` from the client copy of `scrml:auth`,
 * un-awaited — `!Promise` is false, so a WRONG password rendered "WELCOME bob". This
 * test clicks a wrong-password and a right-password button and checks the rendered
 * result, every raw response body that crossed the wire, and the shipped bundle.
 * The server-handler-level twin is
 * compiler/tests/integration/cps-server-logic-stays-server-s462.test.js.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register({ url: "http://localhost/" });

const RIGHT = "right-password";

const SRC = (keyword) => `<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp, hashPassword } from "scrml:auth" }
${keyword}function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!vp(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}
<button id="wrong" onclick={ login("wrong-password") }>wrong</button>
<button id="right" onclick={ login("${RIGHT}") }>right</button>
<p id="o">\${@out}</p>
</program>
`;

async function buildAndMount(src, tag) {
  // A fresh document per mount: each bundle installs a delegated click listener
  // on `document`, and an earlier program's listener would otherwise catch a
  // later program's click.
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register({ url: "http://localhost/" });
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpdir(), "scrml-cps-s462-browser", `${tag}-${uniq}`);
  const out = resolve(dir, "out");
  mkdirSync(out, { recursive: true });
  const hash = await Bun.password.hash(RIGHT);
  const db = new Database(resolve(dir, "n1.db"), { create: true });
  db.exec("CREATE TABLE users (name TEXT, pw TEXT, kind TEXT)");
  db.query("INSERT INTO users (name, pw, kind) VALUES ('bob', ?, 'admin'), ('amy', 'x', 'user')").run(hash);
  db.exec("CREATE TABLE secrets (s TEXT)");
  db.exec("INSERT INTO secrets (s) VALUES ('keep-me')");
  db.close();
  writeFileSync(resolve(dir, "app.scrml"), src);
  const result = compileScrml({ inputFiles: [resolve(dir, "app.scrml")], write: true, outputDir: out });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length > 0) return { errors };

  const html = readFileSync(join(out, "app.html"), "utf8");
  const clientJs = readFileSync(join(out, "app.client.js"), "utf8");
  const runtimeJs = readdirSync(out).filter((f) => /^scrml-runtime.*\.js$/.test(f)).map((f) => readFileSync(join(out, f), "utf8")).join("\n");
  const mod = await import(`file://${join(out, "app.server.js")}?v=${uniq}`);

  // Route the bundle's own fetches to the server module. `Cookie` is a forbidden
  // header for a Fetch `Request`, so — exactly like the conformance adapter — the
  // handler gets a duck-typed request carrying the page's cookie jar.
  const wire = [];
  const requests = [];
  // `atSend` — a hook the test sets to snapshot cell values the moment a request
  // leaves (the spinner / optimistic / submit shapes must have rendered by then).
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    if (typeof globalThis.__s462p0_atSend === "function") sent.push(globalThis.__s462p0_atSend());
    const hmap = {};
    const src = init.headers ?? {};
    if (typeof src.forEach === "function") src.forEach((v, k) => { hmap[k.toLowerCase()] = v; });
    else for (const k of Object.keys(src)) hmap[k.toLowerCase()] = String(src[k]);
    if (document.cookie) hmap["cookie"] = document.cookie;
    const bodyStr = init.body != null ? String(init.body) : "";
    requests.push(bodyStr);
    const resp = await mod.fetch({
      url: "http://localhost" + url,
      method: init.method ?? "GET",
      headers: { get: (k) => hmap[String(k).toLowerCase()] ?? null },
      json: async () => JSON.parse(bodyStr || "null"),
      text: async () => bodyStr,
    });
    const raw = await resp.text();
    wire.push(raw);
    return new Response(raw, { status: resp.status, headers: { "Content-Type": "application/json" } });
  };

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function("window", "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__s462p0_get = _scrml_reactive_get;\n`),
  )(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs, runtimeJs, wire, requests, sent, hash, dir };
}

async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5));
}

for (const [label, keyword] of [["`server function`", "server "], ["body-escalated `function`", ""]]) {
  describe(`S462 P0 — login, executed end to end (${label})`, () => {
    test("wrong password → REJECTED, right password → WELCOME bob; no hash ever crosses the wire", async () => {
      const b = await buildAndMount(SRC(keyword), keyword ? "kw" : "esc");
      expect(b.errors).toEqual([]);

      document.querySelector("#wrong").click();
      await settle();
      expect(globalThis.__s462p0_get("out")).toBe("REJECTED");
      expect(document.querySelector("#o").textContent).toBe("REJECTED");

      document.querySelector("#right").click();
      await settle();
      expect(globalThis.__s462p0_get("out")).toBe("WELCOME bob");
      expect(document.querySelector("#o").textContent).toBe("WELCOME bob");

      // Every response body the page received: only the final cell values.
      expect(b.wire.length).toBeGreaterThanOrEqual(2);
      for (const raw of [...b.wire, ...b.requests]) {
        expect(raw).not.toContain("argon2");
        expect(raw).not.toContain(b.hash);
        expect(raw).not.toContain('"pw"');
      }
    }, 30_000);

    test("the shipped client carries no scrml:auth code", async () => {
      const b = await buildAndMount(SRC(keyword), keyword ? "kw-bundle" : "esc-bundle");
      expect(b.errors).toEqual([]);
      expect(b.clientJs).not.toContain("verifyPassword");
      expect(b.clientJs).not.toContain("_scrml_stdlib.auth");
      expect(b.runtimeJs).not.toContain("chunk: stdlib-auth");
      expect(b.runtimeJs).not.toContain("argon2");
    }, 30_000);
  });
}

// ===========================================================================
// S462 P0 fix round 1 — the review's H-shapes, executed end to end. Each one
// put the auth decision or the hash on the client on 533609165 (H1 and H3 also
// on base a9aa81eff). Every request AND response body is checked for the hash.
// ===========================================================================

const LOGIN_PAGE = (fns) => `<program db="sqlite:./n1.db">
<out> = ""
\${ import { verifyPassword as vp } from "scrml:auth" }
${fns}
<button id="wrong" onclick={ login("wrong-password") }>wrong</button>
<button id="right" onclick={ login("${RIGHT}") }>right</button>
<p id="o">\${@out}</p>
</program>
`;

const H_E2E = {
  "H1 helper check": `function check(p, h) { return vp(p, h) }
server function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  if (!check(pass, @out.pw)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}`,
  "H2a hash via a local": `function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  const hash = @out.pw
  if (!vp(pass, hash)) { @out = "REJECTED" } else { @out = "WELCOME " + @out.name }
}`,
  "H2b hash via a destructure": `function login(pass: string) {
  @out = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.get()
  const { pw, name } = @out
  if (!vp(pass, pw)) { @out = "REJECTED" } else { @out = "WELCOME " + name }
}`,
  "H4 loop after a cell write": `function login(pass: string) {
  const rows = ?{\`SELECT name, pw FROM users WHERE name = 'bob'\`}.all()
  @out = "REJECTED"
  for (const u of rows) {
    if (vp(pass, u.pw)) { @out = "WELCOME " + u.name }
  }
}`,
};

describe("S462 P0 fix round 1 — H-shapes executed end to end", () => {
  for (const [label, fns] of Object.entries(H_E2E)) {
    test(`${label}: wrong → REJECTED, right → WELCOME bob; no hash in any request or response`, async () => {
      const b = await buildAndMount(LOGIN_PAGE(fns), label.split(" ")[0].toLowerCase());
      expect(b.errors).toEqual([]);
      document.querySelector("#wrong").click();
      await settle();
      expect(globalThis.__s462p0_get("out")).toBe("REJECTED");
      document.querySelector("#right").click();
      await settle();
      expect(globalThis.__s462p0_get("out")).toBe("WELCOME bob");
      expect(document.querySelector("#o").textContent).toBe("WELCOME bob");
      expect(b.requests.length).toBeGreaterThanOrEqual(2);
      for (const raw of [...b.wire, ...b.requests]) {
        expect(raw).not.toContain("argon2");
        expect(raw).not.toContain(b.hash);
        expect(raw).not.toContain('"pw"');
      }
    }, 30_000);
  }

  test("H3 — the role check runs on the server; the request never carries the row", async () => {
    const b = await buildAndMount(`<program db="sqlite:./n1.db">
<row> = { name: "", role: "" }
<busy> = false
<msg> = "none"
function purge(id: number) {
  @row = ?{\`SELECT name, kind AS role FROM users WHERE rowid = \${id}\`}.get()
  @busy = true
  if (@row.role == "admin") {
    ?{\`DELETE FROM secrets\`}.run()
    @msg = "purged"
  }
}
<button id="amy" onclick={ purge(2) }>amy</button>
<button id="bob" onclick={ purge(1) }>bob</button>
<p id="m">\${@msg}</p>
</program>
`, "h3");
    expect(b.errors).toEqual([]);
    const secrets = () => {
      const db = new Database(resolve(b.dir, "n1.db"));
      const n = db.query("SELECT count(*) AS n FROM secrets").get().n;
      db.close();
      return n;
    };
    document.querySelector("#amy").click();
    await settle();
    expect(globalThis.__s462p0_get("msg")).toBe("none");
    expect(secrets()).toBe(1);
    for (const raw of b.requests) expect(raw).not.toContain('"row"');
    document.querySelector("#bob").click();
    await settle();
    expect(globalThis.__s462p0_get("msg")).toBe("purged");
    expect(secrets()).toBe(0);
  }, 30_000);
});

// Rule (3): the UX shapes keep their semantics — a client write BEFORE the first
// server statement renders before the request leaves.
describe("S462 P0 fix round 1 — spinner, optimistic update and submit keep their UX", () => {
  test("spinner / optimistic / submit: the pre-request write is visible when the request leaves", async () => {
    const b = await buildAndMount(`<program db="sqlite:./n1.db">
<busy> = false
<rows> = []
<items> = []
<status> = ""
function load() {
  @busy = true
  @rows = ?{\`SELECT name FROM users\`}.all()
  @busy = false
}
function add(n: string) {
  @items = [...@items, n]
  ?{\`INSERT INTO users (name, pw, kind) VALUES (\${n}, 'x', 'u')\`}.run()
}
function submit(n: string) {
  @status = "saving"
  ?{\`INSERT INTO users (name, pw, kind) VALUES (\${n}, 'x', 'u')\`}.run()
  @status = "saved"
}
<button id="load" onclick={ load() }>l</button>
<button id="add" onclick={ add("zed") }>a</button>
<button id="submit" onclick={ submit("yan") }>s</button>
<p id="b">\${@busy}</p>
</program>
`, "ux");
    expect(b.errors).toEqual([]);
    globalThis.__s462p0_atSend = () => ({
      busy: globalThis.__s462p0_get("busy"),
      items: globalThis.__s462p0_get("items").length,
      status: globalThis.__s462p0_get("status"),
      dom: document.querySelector("#b").textContent,
    });
    try {
      document.querySelector("#load").click();
      await settle();
      expect(b.sent[0].busy).toBe(true);          // the spinner was on while the request ran
      expect(b.sent[0].dom).toBe("true");         // …and rendered
      expect(globalThis.__s462p0_get("busy")).toBe(false);
      expect(globalThis.__s462p0_get("rows").length).toBe(2);

      document.querySelector("#add").click();
      await settle();
      expect(b.sent[1].items).toBe(1);            // the optimistic item was in before the request

      document.querySelector("#submit").click();
      await settle();
      expect(b.sent[2].status).toBe("saving");    // "saving" showed while the request ran
      expect(globalThis.__s462p0_get("status")).toBe("saved");
    } finally {
      delete globalThis.__s462p0_atSend;
    }
  }, 30_000);
});
