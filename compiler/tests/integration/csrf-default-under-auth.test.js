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
