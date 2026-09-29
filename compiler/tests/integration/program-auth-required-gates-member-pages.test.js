/**
 * §52.13 — a member page of a `<program auth="required">` application is inside
 * that program's auth scope (S443 round 2).
 *
 * Governing: §52.13 "`auth="required"` — every request to this scope SHALL be
 * authenticated"; §34 W-AUTH-PAGE-INFERRED — a `<page>` without `auth=` under a
 * `<program auth="required">`: "program-level auth still enforces at the request
 * boundary". Before S443 it did not. Auth entries are per FILE and the program's
 * entry covered only the entry file, so a member route file with no `auth=` served
 * its document (`/plain` → 200 with the page body) and ran its server functions for
 * anonymous callers. PA-reproduced on main 6dccbd6cf.
 *
 * Pinned here, all served by the SHIPPED `_server.js` in a child process:
 *   - an unannotated member page (`<page>` with no auth=) is gated exactly like an
 *     explicit `<page auth="required">`: document, clean/.html/trailing-slash URLs,
 *     its server functions, and csrf="auto";
 *   - a bare-markup route file (no `<page>` wrapper) is gated too — it renders a
 *     served document of the same application;
 *   - explicit `auth="optional"` / `auth="none"` pages stay open EXACTLY as before
 *     (whether they may relax a required program is an open ruling, preserved);
 *   - the program's `loginRedirect=` reaches every page scope — inherited and
 *     explicit `<page auth="required">` alike (`loginRedirect=` is not a `<page>`
 *     attribute, so the program is the only place it can be declared).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_member_pages_gated"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const FILES = (programAttrs) => ({
  "app.scrml": `<program${programAttrs}><p>home-marker</p></program>\n`,
  // Unannotated member page with a server function (reads `session`, so it escalates).
  "pages/plain.scrml": `<page>
<out> = ""
function who() {
    return "server-ran:" + session.userId
}
function load() {
    @out = who()
}
<p>plain-marker</p>
<p>\${@out}</p>
<button onclick=load()>load</button>
</page>
`,
  "pages/opt.scrml": `<page auth="optional">\n<p>opt-marker</p>\n</page>\n`,
  "pages/signin.scrml": `<page auth="none">\n<p>signin-marker</p>\n</page>\n`,
  "pages/secret.scrml": `<page auth="required">\n<p>secret-marker</p>\n</page>\n`,
  "side.scrml": `<p>side-marker</p>\n`,
});

function build(label, files) {
  const root = join(_tmp.root, label);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "src", rel)), { recursive: true });
    writeFileSync(join(root, "src", rel), body);
  }
  const dist = join(root, "dist");
  const r = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml build failed:\n${r.stdout}\n${r.stderr}`);
  return { root, dist };
}

const PROBE = `
const dist = process.argv[2];
process.chdir(dist);
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const base = "http://localhost:" + port;
const serverSrc = await Bun.file(dist + "/plain.server.js").text();
const cookieName = serverSrc.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const sess = cookieName + "=sid-alice";
const get = async (path, cookie) => {
  const r = await fetch(base + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const t = await r.text();
  const m = t.match(/([a-z]+-marker)/);
  return { status: r.status, location: r.headers.get("location"), marker: m ? m[1] : null, body: t };
};
const route = (serverSrc.match(/path: "(\\/_scrml\\/__ri_route_who_\\d+)"/) || [])[1];
const post = async (cookie, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-CSRF-Token"] = token;
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + route, { method: "POST", redirect: "manual", headers, body: "{}" });
  return { status: r.status, location: r.headers.get("location"), body: await r.text() };
};
const out = { route, anon: {}, authed: {} };
for (const p of ["/plain", "/plain.html", "/plain/", "/side", "/side.html", "/opt", "/signin", "/secret", "/app"]) {
  const r = await get(p);
  out.anon[p] = { status: r.status, location: r.location, marker: r.marker };
}
out.anon.post = await post("scrml_csrf=anon-token", "anon-token");
const doc = await get("/plain", sess);
out.authed.doc = { status: doc.status, marker: doc.marker };
// The generated client's flow (_scrml_fetch_with_csrf_retry): send the token it
// holds (none), on 403 read the planted scrml_csrf cookie and retry once. The
// meta-tag route is not used here: in a multi-module build only ONE module's
// same-named compose route is mounted by _server.js (pre-existing, not auth).
const first = await (async () => {
  const r = await fetch(base + route, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: sess }, body: "{}" });
  return { status: r.status, token: ((r.headers.get("set-cookie") || "").match(/scrml_csrf=([^;]+)/) || [])[1] ?? null };
})();
out.authed.postNoToken = { status: first.status };
// A self-minted double-submit pair — accepted by the no-auth baseline arm, refused
// by the session-bound csrf="auto" check.
out.authed.postSelfMinted = await post(sess + "; scrml_csrf=forged", "forged");
out.authed.postToken = await post(sess + (first.token ? "; scrml_csrf=" + first.token : ""), first.token);
console.log(JSON.stringify(out));
process.exit(0);
`;

function probe(fx) {
  writeFileSync(join(fx.root, "probe.mjs"), PROBE);
  const p = Bun.spawnSync(["bun", join(fx.root, "probe.mjs"), fx.dist], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
  const lines = p.stdout.toString().trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

describe("member pages of <program auth=\"required\"> are gated (served over HTTP)", () => {
  let res;
  beforeAll(() => {
    res = probe(build("default-redirect", FILES(` auth="required"`)));
  }, 60_000);

  test("an unannotated member page's document redirects to /login in every URL form, no body", () => {
    for (const p of ["/plain", "/plain.html", "/plain/"]) {
      expect(res.anon[p]).toEqual({ status: 302, location: "/login", marker: null });
    }
  });

  test("a bare-markup route file is gated too", () => {
    for (const p of ["/side", "/side.html"]) {
      expect(res.anon[p]).toEqual({ status: 302, location: "/login", marker: null });
    }
  });

  test("its server function rejects an anonymous caller (the body does not run)", () => {
    expect(res.route).toMatch(/^\/_scrml\/__ri_route_who_\d+$/);
    expect(res.anon.post.status).toBe(302);
    expect(res.anon.post.location).toBe("/login");
    expect(res.anon.post.body).not.toContain("server-ran");
  });

  test("explicit auth=\"optional\" / auth=\"none\" pages stay open, exactly as before", () => {
    expect(res.anon["/opt"]).toEqual({ status: 200, location: null, marker: "opt-marker" });
    expect(res.anon["/signin"]).toEqual({ status: 200, location: null, marker: "signin-marker" });
  });

  test("the entry file and an explicit <page auth=\"required\"> stay gated", () => {
    expect(res.anon["/app"].status).toBe(302);
    expect(res.anon["/secret"]).toEqual({ status: 302, location: "/login", marker: null });
  });

  test("an authenticated viewer gets the page, and its server fn needs the csrf=\"auto\" token", () => {
    expect(res.authed.doc.status).toBe(200);
    expect(res.authed.doc.marker).toBe("plain-marker");
    // csrf="auto" (session-bound token), not the baseline double-submit arm.
    expect(res.authed.postNoToken.status).toBe(403);
    expect(res.authed.postSelfMinted.status).toBe(403);
    expect(res.authed.postToken.status).toBe(200);
    expect(JSON.parse(res.authed.postToken.body)).toBe("server-ran:1");
  });
});

describe("the program's loginRedirect= reaches every page scope", () => {
  let res;
  beforeAll(() => {
    res = probe(build("program-redirect", FILES(` auth="required" loginRedirect="/signin"`)));
  }, 60_000);

  test("inherited and explicit page scopes redirect to the program's /signin", () => {
    expect(res.anon["/app"].location).toBe("/signin");
    expect(res.anon["/plain"]).toEqual({ status: 302, location: "/signin", marker: null });
    expect(res.anon["/secret"]).toEqual({ status: 302, location: "/signin", marker: null });
    expect(res.anon.post.location).toBe("/signin");
    // The login page itself stays reachable.
    expect(res.anon["/signin"]).toEqual({ status: 200, location: null, marker: "signin-marker" });
  });
});

describe("the protect=-escalated page scope takes the program's loginRedirect= too", () => {
  test("a protect= member page redirects to the program's /signin, not a hard-coded /login", () => {
    const fx = build("protect-redirect", {
      "app.scrml": `<program auth="required" loginRedirect="/signin"><p>home-marker</p></program>\n`,
      "pages/p.scrml": `<page>
<db src="./app.db" protect="ssn" tables="orders">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, item TEXT, ssn TEXT)\`}.run()
    function items() { return ?{\`SELECT * FROM orders\`}.all() }
  }
  <p>prot-marker</p>
</db>
</page>
`,
    });
    const js = readFileSync(join(fx.dist, "p.server.js"), "utf8");
    expect(js).toContain("function _scrml_auth_check(req)");
    expect(js).toContain(`Location: "/signin"`);
    expect(js).not.toContain(`Location: "/login"`);
  }, 60_000);
});

describe("no required program → nothing is inherited", () => {
  let res;
  beforeAll(() => {
    res = probe(build("no-auth", FILES("")));
  }, 60_000);

  test("an unannotated member page of an app without auth= stays public", () => {
    expect(res.anon["/plain"]).toEqual({ status: 200, location: null, marker: "plain-marker" });
    expect(res.anon["/side"]).toEqual({ status: 200, location: null, marker: "side-marker" });
    // The explicit <page auth="required"> is still its own scope.
    expect(res.anon["/secret"]).toEqual({ status: 302, location: "/login", marker: null });
  });
});
