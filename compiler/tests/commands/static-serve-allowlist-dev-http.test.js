/**
 * SPEC §47.13 — a REAL `scrml dev` process serves the static allowlist, over HTTP.
 *
 * g-static-server-serves-db-and-server-source (S441). The gate-tier twin
 * (`compiler/tests/integration/static-serve-allowlist.test.js`) runs the production
 * `_server.js` in a child process and drives `devDispatch` directly; this file closes
 * the remaining distance for dev: the whole `scrml dev` stack — parent proxy, app
 * child, manifest re-read — as an adopter runs it.
 *
 * Commands tier: NOT in the pre-commit gate (it spawns `scrml dev`, like the other
 * dev-process tests here) — run `bun test compiler/tests/commands`.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { rawGet } from "../helpers/raw-http-get.js";

const CLI = resolve(import.meta.dir, "../../bin/scrml.js");

const APP = `<program db="app.db">\${ function secret() { return ?{\`SELECT 1 AS x\`}.get() } }<n> = 0<button onclick=\${ @n = secret().x }>go</button></program>\n`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const dir = mkdtempSync(join(tmpdir(), "scrml-static-allowlist-dev-"));
let proc = null;
let out = "";
afterAll(async () => {
  try { proc && proc.kill(); } catch { /* gone */ }
  try { proc && (await proc.exited); } catch { /* ignore */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("scrml dev serves only the §47.13 allowlist", () => {
  test("client artifacts 200; server modules, databases, dotfiles, sources, traversal 404", async () => {
    const entry = join(dir, "app.scrml");
    const dist = join(dir, "dist");
    writeFileSync(entry, APP);
    // The app's own database, beside app.scrml (s445: `db=` is resolved against the
    // declaring file's directory, and the server never creates it).
    new Database(join(dir, "app.db")).close();
    // Files an attacker would ask for, placed where the dist dir will be.
    mkdirSync(join(dist, "img"), { recursive: true });
    const db = new Database(join(dist, "app.db"));
    db.run("CREATE TABLE users (email TEXT, password_hash TEXT)");
    db.run("INSERT INTO users VALUES ('a@b.c', 'SECRET-HASH')");
    db.close();
    for (const f of [".env", ".scrml-sessions.db", "app.scrml", "notes.txt", "app.client.js.map"]) {
      writeFileSync(join(dist, f), "SECRET-CONTENT");
    }
    writeFileSync(join(dist, "img", "logo.png"), "PNG-BYTES");

    proc = Bun.spawn(["bun", CLI, "dev", entry, "--port", "0", "--output", dist], {
      cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    const pump = async (stream) => { for await (const c of stream) out += new TextDecoder().decode(c); };
    pump(proc.stdout);
    pump(proc.stderr);
    let port = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 30_000; await sleep(50)) {
      const m = /\[dev\] Serving .* at http:\/\/localhost:(\d+)/.exec(out);
      if (m) { port = Number(m[1]); break; }
    }
    if (!port) throw new Error(`scrml dev did not come up.\n${out}`);

    // Wait for the app child behind the proxy.
    for (const t0 = Date.now(); Date.now() - t0 < 30_000; await sleep(100)) {
      try { if ((await rawGet(port, "/app.html")).status === 200) break; } catch { /* not yet */ }
    }

    const manifest = JSON.parse(readFileSync(join(dist, ".scrml-client-assets.json"), "utf8")).clientAssets;
    expect(manifest).toContain("app.html");
    expect(manifest).toContain("app.client.js");
    for (const a of manifest) {
      expect(`${(await rawGet(port, "/" + a)).status} /${a}`).toBe(`200 /${a}`);
    }
    expect((await rawGet(port, "/img/logo.png")).status).toBe(200);

    for (const p of ["/app.db", "/app.server.js", "/.env", "/.scrml-sessions.db", "/.scrml-client-assets.json",
      "/app.scrml", "/notes.txt", "/app.client.js.map", "/../app.scrml", "/%2e%2e/app.scrml",
      "/..%2fapp.scrml", "/..%5capp.scrml", "/APP.SERVER.JS", "/app.db."]) {
      const r = await rawGet(port, p);
      expect(`${r.status} ${p}`).toBe(`404 ${p}`);
      expect(r.body).not.toContain("SECRET");
      expect(r.body).not.toContain("SQLite format");
    }
  }, 90_000);
});
