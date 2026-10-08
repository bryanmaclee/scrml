/**
 * §52.13 — a `<page auth="required">` is an auth scope on its own (S443).
 *
 * g-page-auth-required-protects-nothing (S441, HIGH, PA-reproduced on 6dccbd6cf):
 * a `<page auth="required">` whose file carries no `protect=` columns was never
 * registered as an auth scope. Route inference registered auth middleware only for
 * `<program auth="required">` (Step 8a) and read a page's `auth=` only on the
 * `protect=` auto-escalation path (Step 8b). So, anonymously:
 *
 *   GET  /secret                 → 200 with the page body
 *   GET  /secret.html            → 200 with the page body
 *   POST /_scrml/__ri_route_who_1 → 200 "server-ran:null" (the body RAN)
 *
 * Governing: §52.13 — "`auth="required"` — every request to this scope SHALL be
 * authenticated; unauthenticated requests are redirected to `loginRedirect=`
 * (default `/login`)", and "`csrf="auto"` … The default whenever `auth=` is present".
 *
 * The fix registers the page file's auth-middleware entry in route inference
 * (Step 8a-page), which gives the page exactly what `<program auth="required">`
 * gets: the per-server-fn `_scrml_auth_check`, the protected-document guard the
 * static dispatch mounts, the gated compose route, and `csrf="auto"`.
 *
 * Everything that touches HTTP runs the SHIPPED `_server.js` (built by the real
 * CLI) inside a CHILD process, so no in-process happy-dom global can decide what the
 * assertions observe. The child seeds the in-memory session store before importing
 * `_server.js`, so the authenticated half runs against the real server too.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_page_auth_required"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP = `<program><p>home</p></program>\n`;

// The gap's reproducer page, verbatim in shape: a server fn (reads `session`, so it
// escalates) behind a button, and a marker the anonymous response must not carry.
const SECRET = `<page auth="required">
<out> = ""
function who() {
    return "server-ran:" + session.userId
}
function load() {
    @out = who()
}
<p>secret-marker</p>
<p>\${@out}</p>
<button onclick=load()>load</button>
</page>
`;

const ABOUT = `<page>
<p>about-marker</p>
</page>
`;

const LOGIN = `<page auth="none">
<p>login-marker</p>
</page>
`;

function buildFixture(label, files) {
  const root = join(_tmp.root, label);
  const src = join(root, "src");
  const dist = join(root, "dist");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(src, rel)), { recursive: true });
    writeFileSync(join(src, rel), body);
  }
  const r = Bun.spawnSync(["bun", CLI, "build", src, "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml build failed:\n${r.stdout}\n${r.stderr}`);
  return { root, src, dist };
}

// Child-process probe. Seeds one authenticated session, starts the shipped
// `_server.js` on a free port, and reports every observation as JSON.
const PROBE = `
const dist = process.argv[2];
process.chdir(dist);
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const probeServer = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = probeServer.port;
probeServer.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const base = "http://localhost:" + port;
const serverSrc = await Bun.file(dist + "/secret.server.js").text();
const cookieName = serverSrc.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const sess = cookieName + "=sid-alice";
const get = async (path, cookie) => {
  const r = await fetch(base + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const t = await r.text();
  return { status: r.status, location: r.headers.get("location"), body: t };
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
for (const p of ["/secret", "/secret.html", "/secret/", "//secret", "/about", "/login", "/app"]) {
  const r = await get(p);
  out.anon[p] = { status: r.status, location: r.location, marker: r.body.includes("secret-marker"), about: r.body.includes("about-marker"), login: r.body.includes("login-marker") };
}
// Anonymous server-fn call with a self-minted double-submit token (the pre-fix
// baseline arm accepted exactly this).
out.anon.post = await post("scrml_csrf=anon-token", "anon-token");
const doc = await get("/secret", sess);
const meta = (doc.body.match(/<meta name="csrf-token" content="([^"]*)">/) || [])[1] ?? null;
out.authed.doc = { status: doc.status, marker: doc.body.includes("secret-marker"), meta };
out.authed.postNoToken = await post(sess, null);
out.authed.postToken = await post(sess, meta);
console.log(JSON.stringify(out));
process.exit(0);
`;

function probe(fx) {
  const script = join(fx.root, "probe.mjs");
  writeFileSync(script, PROBE);
  const p = Bun.spawnSync(["bun", script, fx.dist], { stdout: "pipe", stderr: "pipe" });
  const lines = p.stdout.toString().trim().split("\n");
  if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
  return JSON.parse(lines[lines.length - 1]);
}

describe("§52.13 — `<page auth=\"required\">` without protect= is gated (served over HTTP)", () => {
  let result;
  beforeAll(() => {
    const fx = buildFixture("multi", {
      "app.scrml": APP,
      "pages/secret.scrml": SECRET,
      "pages/about.scrml": ABOUT,
      "pages/login.scrml": LOGIN,
    });
    result = probe(fx);
  }, 60_000);

  test("an anonymous request for the page document redirects to /login and carries no page body", () => {
    for (const p of ["/secret", "/secret.html", "/secret/", "//secret"]) {
      const r = result.anon[p];
      expect(`${p} ${r.status} ${r.location}`).toBe(`${p} 302 /login`);
      expect(r.marker).toBe(false);
    }
  });

  test("an anonymous call of the page's server function is rejected and the body does not run", () => {
    expect(result.route).toMatch(/^\/_scrml\/__ri_route_who_\d+$/);
    // Exactly the program-level semantics: `_scrml_auth_check` 302s to loginRedirect.
    expect(result.anon.post.status).toBe(302);
    expect(result.anon.post.location).toBe("/login");
    expect(result.anon.post.body).not.toContain("server-ran");
  });

  test("pages that are not auth=\"required\" still serve anonymously", () => {
    expect(result.anon["/about"].status).toBe(200);
    expect(result.anon["/about"].about).toBe(true);
    expect(result.anon["/login"].status).toBe(200);
    expect(result.anon["/login"].login).toBe(true);
    expect(result.anon["/app"].status).toBe(200);
  });

  test("an authenticated viewer gets the page with a csrf=\"auto\" meta token", () => {
    expect(result.authed.doc.status).toBe(200);
    expect(result.authed.doc.marker).toBe(true);
    // §52.13 / §40.2 — csrf="auto" is the default under auth=: the compose route
    // fills the session-bound synchronizer token.
    expect(typeof result.authed.doc.meta).toBe("string");
    expect(result.authed.doc.meta.length).toBeGreaterThan(0);
  });

  test("an authenticated call needs the session-bound CSRF token (csrf=\"auto\", not the baseline)", () => {
    expect(result.authed.postNoToken.status).toBe(403);
    expect(result.authed.postToken.status).toBe(200);
    expect(JSON.parse(result.authed.postToken.body)).toBe("server-ran:1");
  });
});

describe("§52.13 — emission for a `<page auth=\"required\">` unit", () => {
  function compileOne(label, source, rel = "pages/secret.scrml") {
    const root = join(_tmp.root, label);
    const input = join(root, "src", rel);
    mkdirSync(dirname(input), { recursive: true });
    writeFileSync(input, source);
    const out = join(root, "dist");
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
    // Every shape here is valid scrml — an emission assertion on an erroring
    // compile would pass for the wrong reason.
    expect((r.errors ?? []).filter((e) => e.code?.startsWith("E-")).map((e) => e.code)).toEqual([]);
    const base = rel.split("/").pop().replace(/\.scrml$/, "");
    const read = (f) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf-8") : "");
    return { r, serverJs: read(`${base}.server.js`) };
  }

  test("the page module carries the auth check, the document guard and the auth-path CSRF gate", () => {
    const { serverJs } = compileOne("emit-secret", SECRET);
    expect(serverJs).toContain("function _scrml_auth_check(req)");
    expect(serverJs).toContain("export const _scrml_protected_document");
    expect(serverJs).toContain("_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)");
    // The baseline double-submit arm is NOT what guards it.
    expect(serverJs).not.toContain("function _scrml_validate_csrf(req) {");
  });

  test("a page with NO server function still gets a protected-document guard", () => {
    const { serverJs } = compileOne("emit-static", `<page auth="required">\n<p>static-secret</p>\n</page>\n`);
    expect(serverJs).toContain("export const _scrml_protected_document");
  });

  test("the page scope redirects to the §52.13 default /login and compiles clean", () => {
    // `loginRedirect=` is not a `<page>` attribute (E-PAGE-INVALID-ATTR — the
    // per-route set is db/auth/csrf/ratelimit/keep-alive), so a page scope uses
    // the default target.
    const { r, serverJs } = compileOne("emit-redirect", `<page auth="required">\n<p>x</p>\n</page>\n`);
    expect((r.errors ?? []).filter((e) => e.code?.startsWith("E-"))).toEqual([]);
    expect(serverJs).toContain(`Location: "/login"`);
  });

  test("csrf=\"off\" on the page is the only opt-out", () => {
    const { serverJs } = compileOne("emit-csrf-off", SECRET.replace(`auth="required"`, `auth="required" csrf="off"`));
    expect(serverJs).toContain("function _scrml_auth_check(req)");
    expect(serverJs).not.toContain("_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)");
  });

  const codesOf = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d && d.code);

  test("W-AUTH-FILE-CONFLICT names both declarations when one file mixes required with a laxer auth=", () => {
    for (const [label, src] of [
      ["conflict-a", `<program auth="none">\n<page auth="required">\n<p>x</p>\n</page>\n</program>\n`],
      ["conflict-b", `<program auth="required">\n<page auth="optional">\n<p>x</p>\n</page>\n</program>\n`],
    ]) {
      const { r } = compileOne(label, src, "app.scrml");
      const w = codesOf(r).filter((d) => d.code === "W-AUTH-FILE-CONFLICT");
      expect(w.length).toBe(1);
      expect(w[0].message).toContain(`<page auth=`);
      expect(w[0].message).toContain(`<program auth=`);
      expect(w[0].message).toContain("stricter declaration wins");
    }
  });

  test("W-AUTH-FILE-CONFLICT does not fire when the declarations agree or there is only one", () => {
    for (const [label, src, rel] of [
      ["agree", `<program auth="required">\n<page auth="required">\n<p>x</p>\n</page>\n</program>\n`, "app.scrml"],
      ["single", SECRET, "pages/secret.scrml"],
      ["lax-only", `<program auth="none">\n<page auth="optional">\n<p>x</p>\n</page>\n</program>\n`, "app.scrml"],
    ]) {
      const { r } = compileOne(label, src, rel);
      expect(codesOf(r).map((d) => d.code)).not.toContain("W-AUTH-FILE-CONFLICT");
    }
  });

  test("W-AUTH-REDIRECT-LOOP fires when a gated page IS the login target, and only then", () => {
    const loop = compileOne("loop", `<page auth="required">\n<p>x</p>\n</page>\n`, "pages/login.scrml");
    expect(codesOf(loop.r).map((d) => d.code)).toContain("W-AUTH-REDIRECT-LOOP");
    const loopProgram = compileOne(
      "loop-program",
      `<program auth="required" loginRedirect="/app.html"><p>x</p></program>\n`,
      "app.scrml",
    );
    expect(codesOf(loopProgram.r).map((d) => d.code)).toContain("W-AUTH-REDIRECT-LOOP");
    const fine = compileOne("no-loop", SECRET, "pages/secret.scrml");
    expect(codesOf(fine.r).map((d) => d.code)).not.toContain("W-AUTH-REDIRECT-LOOP");
    const open = compileOne("login-open", `<page auth="none">\n<p>x</p>\n</page>\n`, "pages/login.scrml");
    expect(codesOf(open.r).map((d) => d.code)).not.toContain("W-AUTH-REDIRECT-LOOP");
    // S443 r3 F5 — routing is case-sensitive: /Login is not /login, so no loop.
    const cased = compileOne("login-cased", `<page auth="required">\n<p>x</p>\n</page>\n`, "pages/Login.scrml");
    expect(codesOf(cased.r).map((d) => d.code)).not.toContain("W-AUTH-REDIRECT-LOOP");
  });

  test("a stricter page in the entry file is not shadowed by the program's auth=\"none\"", () => {
    const { serverJs } = compileOne(
      "emit-none-program",
      `<program auth="none">\n<page auth="required">\n<p>x</p>\n</page>\n</program>\n`,
      "app.scrml",
    );
    expect(serverJs).toContain("export const _scrml_protected_document");
  });
});
