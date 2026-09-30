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
import { compileScrml } from "../../src/api.js";

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

// ---------------------------------------------------------------------------
// S443 round 3 (adversarial review of 5390820dd)
// ---------------------------------------------------------------------------

// GET-only child probe over the shipped _server.js: { path: {status, location, marker} }.
const GET_PROBE = `
const dist = process.argv[2];
const paths = JSON.parse(process.argv[3]);
process.chdir(dist);
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const out = {};
for (const p of paths) {
  const r = await fetch("http://localhost:" + port + p, { redirect: "manual" });
  const t = await r.text();
  const m = t.match(/([a-z]+-marker)/);
  out[p] = { status: r.status, location: r.headers.get("location"), marker: m ? m[1] : null };
}
console.log(JSON.stringify(out));
process.exit(0);
`;
function getProbe(fx, paths) {
  writeFileSync(join(fx.root, "get-probe.mjs"), GET_PROBE);
  const p = Bun.spawnSync(["bun", join(fx.root, "get-probe.mjs"), fx.dist, JSON.stringify(paths)], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
  const lines = p.stdout.toString().trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}
function buildWithDiagnostics(label, files) {
  const root = join(_tmp.root, label);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "src", rel)), { recursive: true });
    writeFileSync(join(root, "src", rel), body);
  }
  const dist = join(root, "dist");
  const r = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", dist], { stdout: "pipe", stderr: "pipe" });
  return { root, dist, exitCode: r.exitCode, out: `${r.stdout}${r.stderr}` };
}

const TYPOS = { upper: "Required", misspelt: "requird", spaced: " required", off: "off", falsy: "false" };
const typoFiles = (programAttrs) => {
  const files = { "app.scrml": `<program${programAttrs}><p>home-marker</p></program>\n` };
  for (const [k, v] of Object.entries(TYPOS)) files[`pages/t${k}.scrml`] = `<page auth="${v}">\n<p>typo-marker</p>\n</page>\n`;
  return files;
};

describe("r3 F1 — an unrecognized auth= literal on a member page is not a declaration (fail closed)", () => {
  test("under a required application program, every typo inherits the gate", () => {
    const fx = buildWithDiagnostics("typo-required", typoFiles(` auth="required"`));
    expect(fx.exitCode).toBe(0);
    const res = getProbe(fx, Object.keys(TYPOS).map((k) => `/t${k}`));
    for (const k of Object.keys(TYPOS)) {
      const r = res[`/t${k}`];
      expect(`${k} ${r.status} ${r.location} ${r.marker}`).toBe(`${k} 302 /login null`);
    }
    // The W-ATTR-002 text states the real effect on a <page> (read via the API —
    // the CLI truncates messages).
    const r = compileScrml({ inputFiles: [join(fx.root, "src", "pages", "tupper.scrml")], write: false, outputDir: join(fx.root, "api-out"), log: () => {} });
    const w = [...(r.errors ?? []), ...(r.warnings ?? [])].find((d) => d.code === "W-ATTR-002");
    expect(w).toBeDefined();
    expect(w.message).toContain("is not an auth declaration");
    expect(w.message).toContain("inherits");
  }, 60_000);

  test("with no required application program, a typo gates nothing (unchanged)", () => {
    const fx = buildWithDiagnostics("typo-public", typoFiles(""));
    const res = getProbe(fx, ["/tupper", "/toff"]);
    expect(res["/tupper"]).toEqual({ status: 200, location: null, marker: "typo-marker" });
    expect(res["/toff"]).toEqual({ status: 200, location: null, marker: "typo-marker" });
  }, 60_000);
});

describe("r3 F2 — only the APPLICATION's top-level <program> is inherited", () => {
  // S445 item 1 (ruling:user-voice-scrml.md S445 — "This removes §40.2's 'route file's
  // own program' sentence"): when an application program exists, a <program> in a
  // route file is NESTED (implied ancestor, §4.12), so `auth=` on it is
  // E-PROGRAM-NESTED-AUTH and the build writes nothing. The per-route remedy is
  // `<page auth="required">` — it gates its own file only, never the public app's pages.
  test("S445 #1: a required <program> inside a route file is E-PROGRAM-NESTED-AUTH (refused)", () => {
    const fx = buildWithDiagnostics("overgate-nested", {
      "app.scrml": `<program><p>home-marker</p></program>\n`,
      "pages/admin.scrml": `<program auth="required"><p>admin-marker</p></program>\n`,
      "pages/about.scrml": `<page>\n<p>about-marker</p>\n</page>\n`,
    });
    expect(fx.exitCode).not.toBe(0);
    expect(fx.out).toContain("E-PROGRAM-NESTED-AUTH");
  }, 60_000);

  test("a required <page> in a route file gates its own file only, not the public app's pages", () => {
    const fx = buildWithDiagnostics("overgate", {
      "app.scrml": `<program><p>home-marker</p></program>\n`,
      "pages/admin.scrml": `<page auth="required"><p>admin-marker</p></page>\n`,
      "pages/about.scrml": `<page>\n<p>about-marker</p>\n</page>\n`,
      "pages/login.scrml": `<page>\n<p>login-marker</p>\n</page>\n`,
    });
    expect(fx.exitCode).toBe(0);
    expect(fx.out).not.toContain("W-AUTH-REDIRECT-LOOP");
    const res = getProbe(fx, ["/app", "/about", "/login", "/admin"]);
    expect(res["/app"]).toEqual({ status: 200, location: null, marker: "home-marker" });
    expect(res["/about"]).toEqual({ status: 200, location: null, marker: "about-marker" });
    expect(res["/login"]).toEqual({ status: 200, location: null, marker: "login-marker" });
    expect(res["/admin"].status).toBe(302);
  }, 60_000);

  test("an extra non-route file with its own top-level <program> does not un-gate a required app's pages (fail closed)", () => {
    // S443 PA review of r3: with two root candidates the application was
    // "unidentified" and nothing was inherited — /about served anonymously.
    const fx = buildWithDiagnostics("ambiguous-root", {
      "app.scrml": `<program auth="required"><p>home-marker</p></program>\n`,
      "aaa.scrml": `<program><p>extra-marker</p></program>\n`,
      "pages/about.scrml": `<page>\n<p>about-marker</p>\n</page>\n`,
    });
    const res = getProbe(fx, ["/app", "/about"]);
    expect(res["/app"].status).toBe(302);
    expect(res["/about"]).toEqual({ status: 302, location: "/login", marker: null });
  }, 60_000);

  test("several root candidates, none required: member pages stay public", () => {
    const fx = buildWithDiagnostics("ambiguous-root-public", {
      "app.scrml": `<program><p>home-marker</p></program>\n`,
      "aaa.scrml": `<program><p>extra-marker</p></program>\n`,
      "pages/about.scrml": `<page>\n<p>about-marker</p>\n</page>\n`,
    });
    expect(getProbe(fx, ["/about"])["/about"]).toEqual({ status: 200, location: null, marker: "about-marker" });
  }, 60_000);
});

describe("r3 nit — an unresolvable redirect target is said out loud", () => {
  test("no single application program + disagreeing loginRedirect= → W-AUTH-LOGIN-REDIRECT-AMBIGUOUS, /login", () => {
    const fx = buildWithDiagnostics("ambiguous", {
      "a.scrml": `<program auth="none" loginRedirect="/a"><p>a-marker</p></program>\n`,
      "b.scrml": `<program loginRedirect="/b"><p>b-marker</p></program>\n`,
      "pages/s.scrml": `<page auth="required">\n<p>s-marker</p>\n</page>\n`,
    });
    expect(fx.out).toContain("W-AUTH-LOGIN-REDIRECT-AMBIGUOUS");
    expect(getProbe(fx, ["/s"])["/s"]).toEqual({ status: 302, location: "/login", marker: null });
  }, 60_000);

  test("an identified application program answers; a route file's (nested, S445 #1) program's loginRedirect= does not make it ambiguous", () => {
    // S445 item 1: the route file's `<program>` is nested (implied ancestor), so it is
    // not a competing redirect declaration; `auth=` on it would be E-PROGRAM-NESTED-AUTH.
    const fx = buildWithDiagnostics("root-answers", {
      "app.scrml": `<program><p>home-marker</p></program>\n`,
      "pages/admin.scrml": `<program loginRedirect="/admin-login"><p>admin-marker</p></program>\n`,
      "pages/s.scrml": `<page auth="required">\n<p>s-marker</p>\n</page>\n`,
    });
    expect(fx.out).not.toContain("W-AUTH-LOGIN-REDIRECT-AMBIGUOUS");
    const res = getProbe(fx, ["/s"]);
    expect(res["/s"]).toEqual({ status: 302, location: "/login", marker: null });
  }, 60_000);
});
