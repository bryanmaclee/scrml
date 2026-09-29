/**
 * §40.2 (S441 ruling) — `csrf="auto"` is the default whenever `auth=` is present.
 *
 * Ruling (bryan, S441, user-voice-scrml.md): "when `auth=` is present,
 * `csrf="auto"` is the default, written into §40.2. It fails closed, and apps
 * that need to opt out can say `csrf="off"`."
 *
 * Closes g-auth-program-without-csrf-attr-emits-no-csrf-check. Before the fix,
 * `<program auth="required">` with no `csrf=` resolved csrf to "off", so the
 * server emitted NO CSRF check at all — while the same app WITHOUT auth= got the
 * baseline double-submit check. Adding authentication removed the CSRF gate.
 *
 * Coverage:
 *   1. effectiveCsrfUnderAuth — the single resolution rule (absent / auto / off /
 *      an invalid literal).
 *   2. absent csrf= under auth="required" emits EXACTLY what explicit csrf="auto"
 *      emits (server, client, html byte-identical).
 *   3. RUNTIME over real HTTP (Bun.serve in a child process — isolated from the
 *      happy-dom globals sibling browser tests install, which strip the Cookie
 *      header): an authenticated forged POST with no token is 403 and writes
 *      nothing; the generated client's flow (token + one retry) is 200;
 *      csrf="off" opts out; the no-auth baseline double-submit is unchanged.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";
import { effectiveCsrfUnderAuth } from "../../src/compute-program-config.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const _tmp = perRunTmp(resolve(testDir, "_tmp_csrf_default_under_auth"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

// The gap's reproducer body: an INSERT behind a button. `ATTRS` is spliced into
// the <program> opener so every variant is otherwise identical.
const appSource = (attrs) => `<program db="./c.db"${attrs}>
<schema>
    notes { id: integer primary key
            body: text }
</>
function add(body) {
    ?{\`INSERT INTO notes (body) VALUES (\${body})\`}.run()
}
<button onclick=add("x")>add</button>
</>
`;

// Each variant compiles into its OWN directory under the SAME file name, so the
// emitted artifacts are directly comparable (ids and routes derive from the name).
function compileVariant(name, attrs) {
  const dir = resolve(_tmp.root, name);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const input = join(dir, "app.scrml");
  writeFileSync(input, appSource(attrs));
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  const read = (f) => (existsSync(join(outDir, f)) ? readFileSync(join(outDir, f), "utf-8") : null);
  return {
    dir,
    outDir,
    errors: (result.errors ?? []).filter((e) => !e.code?.startsWith("W-") && !e.code?.startsWith("I-")),
    serverJs: read("app.server.js"),
    clientJs: read("app.client.js"),
    html: read("app.html"),
  };
}

// Child-process HTTP probe: serve the emitted server.js with Bun.serve, seed an
// authenticated session, then POST to the mutating route
//   forged — the session cookie rides along (ambient credential), no token;
//   client — mirrors the generated `_scrml_fetch_with_csrf_retry`: send the token
//            it holds (none yet), on 403 read the planted `scrml_csrf` and retry once.
const PROBE = `
import { Database } from "bun:sqlite";
const outDir = process.argv[2];
process.chdir(outDir);
const db = new Database("c.db"); db.run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)"); db.close();
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const mod = await import(outDir + "/app.server.js");
const server = Bun.serve({ port: 0, async fetch(req) { return (await mod.fetch(req)) ?? new Response("nf", { status: 404 }); } });
const src = await Bun.file(outDir + "/app.server.js").text();
const cookieName = src.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const sess = cookieName + "=sid-alice";
const route = mod.routes.find((r) => r.method === "POST" && r.path.includes("route_add")).path;
const url = "http://localhost:" + server.port + route;
const forged = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: sess }, body: JSON.stringify({ body: "forged" }) });
let tok = "";
const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": tok, Cookie: sess + (tok ? "; scrml_csrf=" + tok : "") }, body: JSON.stringify({ body: "legit" }) });
let c = await send();
const clientFirst = c.status;
if (c.status === 403) { tok = ((c.headers.get("set-cookie") || "").match(/scrml_csrf=([^;]+)/) || [])[1] || ""; c = await send(); }
const rows = new Database("c.db").query("SELECT body FROM notes ORDER BY id").all().map((r) => r.body);
server.stop(true);
console.log(JSON.stringify({ forged: forged.status, clientFirst, clientFinal: c.status, rows }));
`;

function probe(v) {
  const script = join(v.dir, "probe.mjs");
  writeFileSync(script, PROBE);
  const p = Bun.spawnSync(["bun", script, v.outDir]);
  const out = p.stdout.toString().trim().split("\n").pop();
  if (p.exitCode !== 0) throw new Error(`probe failed: ${p.stderr.toString()}`);
  return JSON.parse(out);
}

describe("effectiveCsrfUnderAuth — the §40.2 default resolution", () => {
  test("absent → auto (the default under auth=)", () => {
    expect(effectiveCsrfUnderAuth(null)).toBe("auto");
    expect(effectiveCsrfUnderAuth(undefined)).toBe("auto");
  });
  test("explicit values keep their meaning", () => {
    expect(effectiveCsrfUnderAuth("auto")).toBe("auto");
    expect(effectiveCsrfUnderAuth("off")).toBe("off");
  });
  test("fails closed: a value outside the §52.13 set (W-ATTR-002) is NOT an opt-out", () => {
    // `csrf="on"` is the retired S80 value — the author wanted protection.
    expect(effectiveCsrfUnderAuth("on")).toBe("auto");
    expect(effectiveCsrfUnderAuth("")).toBe("auto");
    expect(effectiveCsrfUnderAuth("OFF")).toBe("auto");
  });
});

describe("emission — absent csrf= under auth=\"required\" is exactly csrf=\"auto\"", () => {
  test("server.js / client.js / html are byte-identical to the explicit csrf=\"auto\" build", () => {
    const absent = compileVariant("emit-absent", ` auth="required"`);
    const auto = compileVariant("emit-auto", ` auth="required" csrf="auto"`);
    expect(absent.errors).toEqual([]);
    expect(auto.errors).toEqual([]);
    expect(absent.serverJs).toBe(auto.serverJs);
    expect(absent.clientJs).toBe(auto.clientJs);
    expect(absent.html).toBe(auto.html);
    // …and that output carries the §40.2 session synchronizer-token gate.
    expect(absent.serverJs).toContain("_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)");
  });

  test("an invalid csrf= literal under auth= keeps the gate (fails closed)", () => {
    const bad = compileVariant("emit-bad-literal", ` auth="required" csrf="on"`);
    expect(bad.serverJs).toContain("_scrml_validate_csrf(_scrml_req, _scrml_sessionForCsrf)");
  });

  test("explicit csrf=\"off\" under auth= emits no CSRF code", () => {
    const off = compileVariant("emit-off", ` auth="required" csrf="off"`);
    expect(off.errors).toEqual([]);
    expect(off.serverJs.toLowerCase()).not.toContain("csrf");
  });
});

describe("runtime over HTTP — the default fails closed", () => {
  test("auth=\"required\", csrf= absent: forged POST 403 + nothing written; client flow 200", () => {
    const r = probe(compileVariant("rt-absent", ` auth="required"`));
    expect(r.forged).toBe(403);
    expect(r.clientFirst).toBe(403); // no token yet → the gate plants it
    expect(r.clientFinal).toBe(200); // the generated client's one retry succeeds
    expect(r.rows).toEqual(["legit"]);
  });

  test("auth=\"required\" csrf=\"auto\" (explicit): same behaviour", () => {
    const r = probe(compileVariant("rt-auto", ` auth="required" csrf="auto"`));
    expect(r.forged).toBe(403);
    expect(r.clientFinal).toBe(200);
    expect(r.rows).toEqual(["legit"]);
  });

  test("auth=\"required\" csrf=\"off\": the opt-out is honoured (no CSRF gate)", () => {
    const r = probe(compileVariant("rt-off", ` auth="required" csrf="off"`));
    expect(r.forged).toBe(200);
    expect(r.clientFinal).toBe(200);
    expect(r.rows).toEqual(["forged", "legit"]);
  });

  test("no auth=: the baseline double-submit gate is unchanged", () => {
    const r = probe(compileVariant("rt-noauth", ""));
    expect(r.forged).toBe(403);
    expect(r.clientFinal).toBe(200);
    expect(r.rows).toEqual(["legit"]);
  });
});

// ---------------------------------------------------------------------------
// S441 review F1 — making csrf="auto" the default also made its HTML-composition
// route (the §39.2.3 `<meta name="csrf-token">` fill) the default, and that route
// is dispatched BEFORE the static-file branch that carries the §52.13 protected-
// document guard. It never ran the auth check, so an anonymous GET of an
// `auth="required"` page answered 200 with the markup. The compose route now runs
// the same gate. Driven through BOTH hosts' dispatch: the module's own WinterCG
// `fetch` (what the build's _server.js mounts ahead of the static branch) and
// `scrml dev`'s `devDispatch`. Child process — a session cookie has to survive.
const DOC_PROBE = `
const [outDir, devJs] = process.argv.slice(2);
process.chdir(outDir);
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const mod = await import(outDir + "/app.server.js");
const src = await Bun.file(outDir + "/app.server.js").text();
const cookie = (src.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid") + "=sid-alice";
const doc = mod.routes.find((r) => r.method === "GET" && r.path === "/app");
const shape = async (r) => {
  const body = r ? await r.text() : "";
  return {
    status: r ? r.status : 0,
    location: r ? r.headers.get("Location") : null,
    markup: body.includes(">add</button>"),
    metaToken: /<meta name="csrf-token" content="[^"]+">/.test(body),
  };
};
const out = { hasDocRoute: !!doc };
out.anon = await shape(await mod.fetch(new Request("http://localhost/app")));
out.authed = await shape(await mod.fetch(new Request("http://localhost/app", { headers: { Cookie: cookie } })));
const dev = await import(devJs);
await dev.loadServerRoutes(outDir);
out.devAnon = await shape(await dev.devDispatch(new Request("http://localhost/app"), null, outDir, {}));
out.devAuthed = await shape(await dev.devDispatch(new Request("http://localhost/app", { headers: { Cookie: cookie } }), null, outDir, {}));
console.log(JSON.stringify(out));
process.exit(0);
`;

function docProbe(v) {
  const script = join(v.dir, "docprobe.mjs");
  writeFileSync(script, DOC_PROBE);
  const devJs = resolve(testDir, "../../src/commands/dev.js");
  const p = Bun.spawnSync(["bun", script, v.outDir, devJs]);
  if (p.exitCode !== 0) throw new Error(`doc probe failed: ${p.stderr.toString()}`);
  return JSON.parse(p.stdout.toString().trim().split("\n").pop());
}

describe("§52.13 — the csrf=\"auto\" compose route is a document request and is gated", () => {
  test("auth=\"required\" (csrf default): anonymous GET of the page 302s; an authenticated viewer gets the page + a live token", () => {
    const r = docProbe(compileVariant("doc-absent", ` auth="required"`));
    expect(r.hasDocRoute).toBe(true); // the compose route exists (csrf="auto" meta fill)
    for (const k of ["anon", "devAnon"]) {
      expect(r[k].status).toBe(302);
      expect(r[k].location).toBe("/login");
      expect(r[k].markup).toBe(false);
    }
    for (const k of ["authed", "devAuthed"]) {
      expect(r[k].status).toBe(200);
      expect(r[k].markup).toBe(true);
      expect(r[k].metaToken).toBe(true);
    }
  });

  test("explicit csrf=\"auto\" (which had the same hole before the default existed) is gated too", () => {
    const r = docProbe(compileVariant("doc-auto", ` auth="required" csrf="auto"`));
    expect(r.anon.status).toBe(302);
    expect(r.anon.markup).toBe(false);
    expect(r.authed.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// S441 review F3 — `_scrml_get_csrf_token()` prefers the first-paint
// `<meta name="csrf-token">`. When that token is stale (the session changed after
// the page was composed), the CSRF 403 plants the CURRENT session token in the
// `scrml_csrf` cookie — but the one retry re-read the stale meta and 403'd again.
// The retry now syncs the meta from the planted cookie first. Driven with the
// EMITTED client helpers against the EMITTED server over its own fetch handler.
const RETRY_PROBE = `
const [outDir, mode] = process.argv.slice(2);
process.chdir(outDir);
{ const { Database } = await import("bun:sqlite"); const d = new Database("c.db"); d.run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)"); d.close(); }
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-bob", { userId: 2, role: "user" });
const mod = await import(outDir + "/app.server.js");
const serverSrc = await Bun.file(outDir + "/app.server.js").text();
const sessCookie = (serverSrc.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid") + "=sid-bob";
const clientSrc = await Bun.file(outDir + "/app.client.js").text();
const grab = (name) => {
  const m = clientSrc.match(new RegExp("(?:async )?function " + name + "\\\\([^)]*\\\\) \\\\{[\\\\s\\\\S]+?\\\\n\\\\}"));
  if (!m) throw new Error("missing " + name);
  return m[0];
};
// A minimal browser: one meta tag (a STALE first-paint token) + a cookie jar.
const meta = { content: "stale-token-from-an-earlier-session", getAttribute() { return this.content; }, setAttribute(_k, v) { this.content = v; } };
const jar = new Map();
const document = {
  querySelector: (sel) => (sel.includes("csrf-token") ? meta : null),
  get cookie() { return [...jar].map(([k, v]) => k + "=" + v).join("; "); },
  set cookie(s) { const [kv] = s.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); },
};
const statuses = [];
const fetch = async (path, init) => {
  const headers = new Headers(init.headers);
  headers.set("Cookie", [sessCookie, document.cookie].filter(Boolean).join("; "));
  const res = await mod.fetch(new Request("http://localhost" + path, { method: init.method, headers, body: init.body }));
  const sc = res.headers.get("Set-Cookie");
  if (sc && sc.startsWith("scrml_csrf=")) document.cookie = sc; // the browser applies Set-Cookie before fetch resolves
  statuses.push(res.status);
  return res;
};
let code = grab("_scrml_get_csrf_token") + "\\n" + grab("_scrml_fetch_with_csrf_retry");
code += "\\n" + (mode === "no-sync" ? "function _scrml_csrf_sync_meta_from_cookie() {}" : grab("_scrml_csrf_sync_meta_from_cookie"));
const retry = new Function("document", "fetch", "crypto", code + "\\nreturn _scrml_fetch_with_csrf_retry;")(document, fetch, crypto);
const route = mod.routes.find((r) => r.method === "POST" && r.path.includes("route_add")).path;
const res = await retry(route, "POST", JSON.stringify({ body: "legit" }));
console.log(JSON.stringify({ statuses, final: res.status, metaNow: meta.content, sessionToken: store.get("sid-bob").csrfToken }));
process.exit(0);
`;

function retryProbe(v, mode) {
  const script = join(v.dir, `retryprobe-${mode}.mjs`);
  writeFileSync(script, RETRY_PROBE);
  const p = Bun.spawnSync(["bun", script, v.outDir, mode]);
  if (p.exitCode !== 0) throw new Error(`retry probe failed: ${p.stderr.toString()}`);
  return JSON.parse(p.stdout.toString().trim().split("\n").pop());
}

describe("client — a stale first-paint CSRF meta token recovers on the one retry", () => {
  test("403 plants the session token; the retry sends it (200) and the meta now holds it", () => {
    const v = compileVariant("retry-stale-meta", ` auth="required"`);
    expect(v.clientJs).toContain("function _scrml_csrf_sync_meta_from_cookie()");
    const r = retryProbe(v, "sync");
    expect(r.statuses).toEqual([403, 200]);
    expect(r.final).toBe(200);
    expect(r.metaNow).toBe(r.sessionToken);
  });

  test("control — without the meta sync the retry resends the stale token and 403s again", () => {
    const v = compileVariant("retry-stale-meta-control", ` auth="required"`);
    const r = retryProbe(v, "no-sync");
    expect(r.statuses).toEqual([403, 403]);
  });

  test("the baseline (no auth=) client has no meta tag and emits no sync helper", () => {
    const v = compileVariant("retry-baseline", "");
    expect(v.clientJs).not.toContain("_scrml_csrf_sync_meta_from_cookie");
  });
});
