/**
 * §44 / operator ruling S385 A1 — the emitted §20.5 durable session store gets the same
 * sqlite concurrency defaults as every emitted `Bun.SQL` handle (S449,
 * g-emitted-session-store-opens-sqlite-with-no-busy-timeout-or-wal).
 *
 * Governing: user-voice S385 A1 "WAL + 5s busy-timeout as the safe default"; §20.5.1
 * "The server-side session store SHALL be durable (SQLite-backed KV …)". The store is a raw
 * `bun:sqlite` Database under an aliased constructor, so #1062's `Bun.SQL` sweep missed it.
 * MEASURED before: `journal_mode=delete busy_timeout=0`; a login under a competing writer
 * answered 500 (`database is locked`) in ~1 ms.
 *
 * Pinned:
 *   1. emitted text: busy_timeout FIRST, each pragma in its OWN try, both BEFORE the
 *      store's CREATE TABLE (so the init waits a held lock out too);
 *   2. executed over HTTP by the shipped `_server.js`: after a login the store file is in
 *      WAL mode, and a login issued while another connection holds `BEGIN IMMEDIATE`
 *      waits for the lock and answers 200 (negative control: the pre-fix behaviour was a
 *      500 in ~1 ms — asserted as "took at least as long as the lock was held").
 *   3. an app with NO session write keeps the in-memory Map store, untouched.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import { perRunTmp } from "../helpers/per-run-tmp.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_session_store_sqlite_defaults"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const LOGIN_APP = `<program auth="optional" csrf="off">
<out> = ""
function login() {
    session.set("userId", "alice")
    return "ok"
}
function doLogin() {
    @out = login()
}
<button onclick=doLogin()>login</button>
<p>\${@out}</p>
</program>
`;

function build(label, source) {
  const root = join(_tmp.root, label);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.scrml"), source);
  const dist = join(root, "dist");
  const r = Bun.spawnSync(["bun", CLI, "build", join(root, "src"), "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml build failed:\n${r.stdout}\n${r.stderr}`);
  return { dist, serverJs: readFileSync(join(dist, "app.server.js"), "utf-8") };
}

describe("emitted text", () => {
  test("busy_timeout first, each pragma in its own try, both before CREATE TABLE", () => {
    const { serverJs } = build("text", LOGIN_APP);
    const iBusy = serverJs.indexOf('try { _db.run("PRAGMA busy_timeout = 5000"); }');
    const iWal = serverJs.indexOf('try { _db.run("PRAGMA journal_mode = WAL"); }');
    const iCreate = serverJs.indexOf("CREATE TABLE IF NOT EXISTS kv_store");
    const iOpen = serverJs.indexOf("new _ScrmlSessionDatabase(_scrml_session_db_path)");
    expect(iOpen).toBeGreaterThan(-1);
    expect(iBusy).toBeGreaterThan(iOpen);
    expect(iWal).toBeGreaterThan(iBusy);
    expect(iCreate).toBeGreaterThan(iWal);
  });

  test("an app with no session write keeps the in-memory Map store (no pragmas)", () => {
    const { serverJs } = build("nowrite", `<program auth="optional" csrf="off">
<out> = ""
function who() {
    return "u=" + session.userId
}
function load() {
    @out = who()
}
<button onclick=load()>who</button>
</program>
`);
    expect(serverJs).toContain("const _scrml_session_store = (_scrml_g.__scrml_session_store ??= new _scrml_g.Map());");
    expect(serverJs).not.toContain("PRAGMA busy_timeout");
  });
});

// Probe process: spawn the shipped server as its OWN process (bun:sqlite is synchronous — a
// server in the probe's process would block the event loop while it waits on the lock, so the
// releasing COMMIT could never fire), warm one login, then hold BEGIN IMMEDIATE from a second
// connection for HOLD_MS while issuing another login.
const PROBE = `
import { Database } from "bun:sqlite";
import { spawn } from "child_process";
const [dist, holdMs] = process.argv.slice(2);
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
const srv = spawn("bun", ["_server.js"], { cwd: dist, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = "http://127.0.0.1:" + port;
for (let i = 0; i < 100; i++) { try { await fetch(base + "/"); break; } catch { await Bun.sleep(100); } }
const post = () => fetch(base + "/_scrml/__ri_route_login_1", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "t0k", Cookie: "scrml_csrf=t0k" }, body: "{}" });
const warm = await post();
const other = new Database(dist + "/.scrml-sessions.db");
const mode = other.query("PRAGMA journal_mode").get().journal_mode;
other.run("BEGIN IMMEDIATE");
other.run("INSERT OR REPLACE INTO kv_store (namespace, key, value, expires_at) VALUES ('x','y','1',NULL)");
const t0 = Date.now();
const pending = post();
setTimeout(() => other.run("COMMIT"), Number(holdMs));
const r = await pending;
const ms = Date.now() - t0;
other.close();
srv.kill();
console.log(JSON.stringify({ warm: warm.status, mode, status: r.status, ms }));
process.exit(0);
`;

describe("executed — a login under a competing writer waits the lock out", () => {
  test("WAL on disk; contended login -> 200 after the lock is released (was 500 in ~1 ms)", () => {
    const { dist } = build("exec", LOGIN_APP);
    const probePath = join(dist, "..", "probe.mjs");
    writeFileSync(probePath, PROBE);
    const HOLD_MS = 300;
    const r = Bun.spawnSync(["bun", probePath, dist, String(HOLD_MS)], { stdout: "pipe", stderr: "pipe", timeout: 30000 });
    const line = r.stdout.toString().trim().split("\n").pop();
    const out = JSON.parse(line);
    expect(out.warm).toBe(200);
    expect(out.mode).toBe("wal");
    expect(out.status).toBe(200);
    expect(out.ms).toBeGreaterThanOrEqual(HOLD_MS - 50);
  }, EXECUTED_DB_TIMEOUT_MS);
});
