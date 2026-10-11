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
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpdir(), "scrml-cps-s462-browser", `${tag}-${uniq}`);
  const out = resolve(dir, "out");
  mkdirSync(out, { recursive: true });
  const hash = await Bun.password.hash(RIGHT);
  const db = new Database(resolve(dir, "n1.db"), { create: true });
  db.exec("CREATE TABLE users (name TEXT, pw TEXT)");
  db.query("INSERT INTO users (name, pw) VALUES ('bob', ?)").run(hash);
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
  globalThis.fetch = async (url, init = {}) => {
    const hmap = {};
    const src = init.headers ?? {};
    if (typeof src.forEach === "function") src.forEach((v, k) => { hmap[k.toLowerCase()] = v; });
    else for (const k of Object.keys(src)) hmap[k.toLowerCase()] = String(src[k]);
    if (document.cookie) hmap["cookie"] = document.cookie;
    const bodyStr = init.body != null ? String(init.body) : "";
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
  return { errors, clientJs, runtimeJs, wire, hash };
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
      for (const raw of b.wire) {
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
