/**
 * §40.2 / §39.2.3 — `POST /_scrml/session/destroy` is CSRF-gated under `csrf="auto"`
 * (S449, g-session-destroy-route-has-no-csrf-check).
 *
 * Governing:
 *   §40.2  "When a `<program>` declares `auth=` and carries no `csrf=` attribute, the
 *          compiler SHALL treat it exactly as if it declared `csrf="auto"`".
 *   §39.2.3 csrf="auto" generates "A server-side validator that checks the `X-CSRF-Token`
 *          header on state-mutating routes and returns `403 Forbidden` if the token is
 *          missing or invalid"; "CSRF protection SHALL apply only to requests that mutate
 *          state (POST, PUT, PATCH, DELETE)".
 * Destroying a session is a state-mutating POST. Before S449 the route had no check: a
 * cross-site POST carrying the session cookie logged the viewer out (MEASURED on the base
 * emitter: forged destroy -> 200, session record deleted).
 *
 * Pinned, all against the SHIPPED `_server.js` in a child process:
 *   1. a forged destroy (session cookie, no / wrong token) -> 403, the record survives;
 *      the session's own token -> 200, the record is gone; a cookie naming NO record ->
 *      200 (nothing to destroy, the stale cookie is still cleared);
 *   2. the generated client's `session.destroy()` (the emitted projection, executed with a
 *      cookie-jar fetch against the real server) logs out even from a page whose
 *      `<meta name="csrf-token">` is STALE: 403, then one retry with the planted token;
 *   3. `csrf="off"` is the opt-out — the destroy route stays ungated there.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_session_destroy_csrf"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP = (attrs) => `<program auth="required" loginRedirect="/login"${attrs}>
<who> = ""
function whoami() {
    return "user=" + session.userId
}
function load() {
    @who = whoami()
}
<button onclick=load()>who</button>
<button id="out" onclick=session.destroy()>logout</button>
<p>\${@who}</p>
</program>
`;

function build(label, source) {
  const root = join(_tmp.root, label);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.scrml"), source);
  const dist = join(root, "dist");
  const r = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml build failed:\n${r.stdout}\n${r.stderr}`);
  const clientFile = readdirSync(dist).find((f) => /^app\.client\..*\.js$/.test(f));
  return { root, dist, clientJs: readFileSync(join(dist, clientFile), "utf-8") };
}

const PROBE = `
const [dist, clientPath] = process.argv.slice(2);
process.chdir(dist);
const store = (globalThis.__scrml_session_store ??= new Map());
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const base = "http://localhost:" + port;
const src = await Bun.file(dist + "/app.server.js").text();
const ck = src.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const destroy = (cookie, tok) => fetch(base + "/_scrml/session/destroy", { method: "POST", headers: { Cookie: cookie, ...(tok ? { "X-CSRF-Token": tok } : {}) } });
const out = {};

store.set("sid-a", { userId: "alice" });
const forged = await destroy(ck + "=sid-a");
const planted = ((forged.headers.get("set-cookie") || "").match(/scrml_csrf=([^;]+)/) || [])[1] || "";
out.forged = { status: forged.status, kept: store.has("sid-a") };
const wrong = await destroy(ck + "=sid-a", "attacker-guess");
out.wrong = { status: wrong.status, kept: store.has("sid-a") };
const legit = await destroy(ck + "=sid-a; scrml_csrf=" + planted, planted);
out.legit = { status: legit.status, kept: store.has("sid-a") };
const none = await destroy(ck + "=sid-nobody");
out.none = { status: none.status };

// Client half: run the EMITTED @session projection against the real server, with a
// cookie jar standing in for the browser (the HttpOnly session cookie is sent but not
// visible to document.cookie; scrml_csrf is both).
store.set("sid-b", { userId: "bob" });
const jar = new Map([[ck, "sid-b"]]);
const visible = () => [...jar].filter(([k]) => k === "scrml_csrf").map(([k, v]) => k + "=" + v).join("; ");
const calls = [];
globalThis.fetch = (orig => async (path, init = {}) => {
  const headers = { ...(init.headers || {}), Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; ") };
  const r = await orig(base + path, { ...init, headers });
  calls.push({ path, method: init.method || "GET", tok: (init.headers || {})["X-CSRF-Token"] || null, status: r.status });
  const sc = r.headers.get("set-cookie") || "";
  const m = sc.match(/^([^=;]+)=([^;]*)/);
  if (m) { if (/Expires=Thu, 01 Jan 1970/.test(sc)) jar.delete(m[1]); else jar.set(m[1], m[2]); }
  return r;
})(globalThis.fetch);
const meta = { content: "stale-token-from-first-paint", getAttribute() { return this.content; }, setAttribute(_, v) { this.content = v; } };
globalThis.document = { get cookie() { return visible(); }, querySelector: (s) => (s.includes("csrf-token") ? meta : null) };
globalThis.window = { location: { href: "/" } };
const clientSrc = await Bun.file(clientPath).text();
const start = clientSrc.indexOf("// --- @session reactive projection");
const end = clientSrc.indexOf("\\n  })();", start) + "\\n  })();".length;
const block = clientSrc.slice(start, end);
const session = new Function(block + "\\nreturn session;")();
await new Promise((r) => setTimeout(r, 50));
await session.destroy();
out.client = { kept: store.has("sid-b"), redirect: globalThis.window.location.href, posts: calls.filter((c) => c.method === "POST").map((c) => ({ status: c.status, tok: c.tok })) };
console.log(JSON.stringify(out));
process.exit(0);
`;

function probe(fx) {
  writeFileSync(join(fx.root, "probe.mjs"), PROBE);
  const clientFile = readdirSync(fx.dist).find((f) => /^app\.client\..*\.js$/.test(f));
  const p = Bun.spawnSync(["bun", join(fx.root, "probe.mjs"), fx.dist, join(fx.dist, clientFile)], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
  const lines = p.stdout.toString().trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

describe("csrf=\"auto\" (the default under auth=) — the destroy route is gated", () => {
  let res;
  beforeAll(() => {
    res = probe(build("auto", APP("")));
  }, 60_000);

  test("a forged destroy (session cookie, no token) is 403 and the session survives", () => {
    expect(res.forged).toEqual({ status: 403, kept: true });
  });
  test("a wrong token is 403 and the session survives", () => {
    expect(res.wrong).toEqual({ status: 403, kept: true });
  });
  test("the session's own token destroys it (200)", () => {
    expect(res.legit).toEqual({ status: 200, kept: false });
  });
  test("a cookie naming no session record is not gated (nothing to destroy)", () => {
    expect(res.none.status).toBe(200);
  });
  test("the generated session.destroy() logs out from a stale-meta page: 403, one retry with the planted token, 200", () => {
    expect(res.client.kept).toBe(false);
    expect(res.client.redirect).toBe("/login");
    expect(res.client.posts.length).toBe(2);
    expect(res.client.posts[0]).toEqual({ status: 403, tok: "stale-token-from-first-paint" });
    expect(res.client.posts[1].status).toBe(200);
    expect(res.client.posts[1].tok).not.toBe("stale-token-from-first-paint");
  });
});

describe("csrf=\"off\" — the opt-out leaves the destroy route ungated", () => {
  test("a token-less destroy succeeds", () => {
    const res = probe(build("off", APP(` csrf="off"`)));
    expect(res.forged).toEqual({ status: 200, kept: false });
  }, 60_000);
});
