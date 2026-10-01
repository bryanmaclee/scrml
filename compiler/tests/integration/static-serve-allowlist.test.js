/**
 * SPEC §47.13 — both static servers serve an ALLOWLIST, never "whatever exists".
 *
 * g-static-server-serves-db-and-server-source (S441, CRITICAL). Before the fix, the
 * production `_server.js` that `scrml build` emits and the `scrml dev` dispatch both
 * answered ANY path that resolved to a file under the output dir. For
 * `<program db="app.db">` run from its dist dir that meant, anonymously:
 *
 *   GET /app.db             → 200, the whole SQLite database (protect= columns too)
 *   GET /app.server.js      → 200, the server source (SQL, auth logic)
 *   GET /_server.js         → 200
 *   GET /.scrml-sessions.db → 200, the live session store
 *
 * The fix: a file is served iff it is NOT in a denied class AND it is either in the
 * build's client-asset manifest or a passive media/font asset. The policy is ONE
 * source (`static-serve-policy-emitted.js`) that dev imports and build copies into
 * `_server.js`.
 *
 * The production server is exercised over a REAL socket in a CHILD process — the
 * shipped `_server.js`, run exactly as an adopter runs it — so no in-process global
 * (happy-dom or otherwise) can make an assertion pass for the wrong reason. The dev
 * half runs the real dev APP server (`scrml dev --__dev-child`, the process behind
 * the dev proxy) the same way; `compiler/tests/commands/
 * static-serve-allowlist-dev-http.test.js` drives a whole `scrml dev` (proxy
 * included) and sits in the commands tier with the other dev-process tests.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { rawGet } from "../helpers/raw-http-get.js";
import {
  _scrml_static_request_path,
  _scrml_static_denied,
  _scrml_static_servable,
  collectClientAssets,
  CLIENT_ASSET_MANIFEST,
  STATIC_POLICY_EMIT_SOURCE,
} from "../../src/static-serve-policy.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_static_serve_allowlist"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP = `<program db="app.db">\${ function secret() { return ?{\`SELECT 1 AS x\`}.get() } }<n> = 0<button onclick=\${ @n = secret().x }>go</button></program>\n`;

/** Paths that MUST 404 on both servers, whatever is on disk. */
const DENIED = [
  "/app.db",
  "/app.db-wal",
  "/app.db-shm",
  "/data.sqlite",
  "/data.sqlite3",
  "/app.server.js",
  "/app.server.js.map",
  "/_server.js",
  "/.env",
  "/.git/config",
  "/.scrml-sessions.db",
  "/" + CLIENT_ASSET_MANIFEST,
  "/app.client.js.map",
  "/app.scrml",
  "/serverfns.json",
  "/notes.txt",
  // traversal and aliasing — the target is the source file one level ABOVE dist
  "/../src/app.scrml",
  "/%2e%2e/src/app.scrml",
  "/%2E%2E/src/app.scrml",
  "/..%2fsrc%2fapp.scrml",
  "/..%5csrc%5capp.scrml",
  "/img/..%2f..%2fsrc%2fapp.scrml",
  "/img%2f..%2f_server.js",
  "/APP.SERVER.JS",
  "/App.Db",
  "/app.db.",
  "/app.db%20",
  "/app.db%00",
  "/app.db::$DATA",
  "/%",
];

/** Build the fixture with the real CLI, seed the files an attacker would ask for. */
function buildFixture(label) {
  const root = join(_tmp.root, label);
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "app.scrml"), APP);
  const r = Bun.spawnSync(["bun", CLI, "build", src, "-o", dist], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`scrml build failed:\n${r.stdout}\n${r.stderr}`);

  // The server's own database: `db="app.db"` names src/app.db — beside app.scrml,
  // the declaring file (s445) — and the server never creates it.
  new Database(join(src, "app.db")).close();
  // A REAL sqlite database in dist/ as the leak probe: the file an adopter who keeps
  // a database beside the bundle would have there.
  const db = new Database(join(dist, "app.db"));
  db.run("CREATE TABLE users (email TEXT, password_hash TEXT)");
  db.run("INSERT INTO users VALUES ('a@b.c', 'SECRET-HASH')");
  db.close();
  for (const f of ["app.db-wal", "app.db-shm", "data.sqlite", "data.sqlite3", ".env", ".scrml-sessions.db",
    "app.server.js.map", "app.client.js.map", "app.scrml", "serverfns.json", "notes.txt"]) {
    writeFileSync(join(dist, f), "SECRET-CONTENT");
  }
  mkdirSync(join(dist, ".git"), { recursive: true });
  writeFileSync(join(dist, ".git", "config"), "SECRET-CONTENT");
  mkdirSync(join(dist, "img"), { recursive: true });
  writeFileSync(join(dist, "img", "logo.png"), "PNG-BYTES");
  writeFileSync(join(dist, "favicon.ico"), "ICO-BYTES");
  return { root, src, dist };
}

/** The client artifacts the build wrote, read back from the manifest. */
function clientArtifacts(dist) {
  return JSON.parse(readFileSync(join(dist, CLIENT_ASSET_MANIFEST), "utf8")).clientAssets;
}

// ---------------------------------------------------------------------------
// §1 — the policy functions
// ---------------------------------------------------------------------------

describe("§1 policy — request-path normalization", () => {
  test("traversal, dot-paths, backslashes, colons and bad escapes are refused", () => {
    for (const p of ["/../x", "/%2e%2e/x", "/..%2fx", "/a/..%2f..%2fx", "/..%5cx", "/a%5cb", "/.env",
      "/a/.git/config", "/x.db.", "/x.db%20", "/x%00", "/c:/x", "/x::$DATA", "/%"]) {
      expect(_scrml_static_request_path(p)).toBe(false);
    }
  });

  test("ordinary paths normalize, collapsing duplicate and trailing slashes", () => {
    expect(_scrml_static_request_path("/")).toBe("/");
    expect(_scrml_static_request_path("/app.html")).toBe("/app.html");
    expect(_scrml_static_request_path("/admin/")).toBe("/admin");
    expect(_scrml_static_request_path("//a//b.css")).toBe("/a/b.css");
    expect(_scrml_static_request_path("/my%20page.html")).toBe("/my page.html");
  });
});

describe("§1 policy — denied classes", () => {
  test("server modules, databases, dotfiles, sources, maps and escapes are denied", () => {
    for (const rel of ["_server.js", "app.server.js", "sub/app.server.js", "app.server.js.map", "x.server.mjs",
      "app.db", "app.db-wal", "app.db-shm", "app.db-journal", "x.sqlite", "x.sqlite3", "x.sqlite-wal",
      ".env", ".scrml-sessions.db", ".git/config", "a/.hidden/x.js", "app.scrml", "app.client.js.map",
      "../src/app.scrml", "/etc/passwd", "", "APP.SERVER.JS", "App.DB", "x.db.", "a\\b.js"]) {
      expect(_scrml_static_denied(rel)).toBe(true);
    }
  });

  test("client artifacts are not denied", () => {
    for (const rel of ["app.html", "app.css", "app.1a2b3c4d.css", "app.client.js", "app.client.1a2b3c4d.js",
      "scrml-runtime.01c0u4ke.js", "customer/loads.html", "_scrml/math.js", "img/logo.png"]) {
      expect(_scrml_static_denied(rel)).toBe(false);
    }
  });

  test("servable = not denied AND (manifest member OR passive media)", () => {
    const manifest = new Set(["app.html", "app.client.js", "app.server.js"]);
    expect(_scrml_static_servable("app.html", manifest)).toBe(true);
    expect(_scrml_static_servable("app.client.js", manifest)).toBe(true);
    // a denied class wins even over a (corrupted) manifest entry
    expect(_scrml_static_servable("app.server.js", manifest)).toBe(false);
    // not in the manifest, not media → refused
    expect(_scrml_static_servable("other.html", manifest)).toBe(false);
    expect(_scrml_static_servable("helper.js", manifest)).toBe(false);
    expect(_scrml_static_servable("notes.txt", manifest)).toBe(false);
    expect(_scrml_static_servable("chunks.json", manifest)).toBe(false);
    // passive media needs no manifest entry
    for (const rel of ["img/logo.png", "favicon.ico", "a.SVG", "f.woff2", "v.mp4"]) {
      expect(_scrml_static_servable(rel, manifest)).toBe(true);
    }
    // ...but a media extension does not launder a dot-path
    expect(_scrml_static_servable(".secret/logo.png", manifest)).toBe(false);
  });

  test("the emitted source is the policy file, verbatim and readable (not transpiled)", () => {
    expect(STATIC_POLICY_EMIT_SOURCE).toContain("function _scrml_static_request_path(pathname) {");
    expect(STATIC_POLICY_EMIT_SOURCE).toContain("function _scrml_static_denied(rel) {");
    expect(STATIC_POLICY_EMIT_SOURCE).toContain("function _scrml_static_servable(rel, clientAssets) {");
    expect(STATIC_POLICY_EMIT_SOURCE).not.toMatch(/\bexport\b\s+function/);
    expect(STATIC_POLICY_EMIT_SOURCE).not.toMatch(/return !\d;/);
    expect(STATIC_POLICY_EMIT_SOURCE).not.toMatch(/^import /m);
  });
});

// ---------------------------------------------------------------------------
// §2 — the manifest
// ---------------------------------------------------------------------------

describe("§2 the client-asset manifest", () => {
  test("lists exactly the browser artifacts — no server module, no database", () => {
    const { dist } = buildFixture("manifest");
    const assets = clientArtifacts(dist);
    expect(assets).toContain("app.html");
    expect(assets.some((a) => /^app\.client\.[a-z0-9]+\.js$/.test(a))).toBe(true);
    expect(assets.some((a) => /^app\.[a-z0-9]+\.css$/.test(a))).toBe(true);
    expect(assets.some((a) => /^scrml-runtime\.[a-z0-9]+\.js$/.test(a))).toBe(true);
    for (const a of assets) expect(_scrml_static_denied(a)).toBe(false);
    expect(assets).not.toContain("app.server.js");
    expect(assets).not.toContain("_server.js");
  }, 30_000); // a real `scrml build` subprocess

  test("the import closure admits what a client bundle imports, and only that", () => {
    const { dist } = buildFixture("closure");
    mkdirSync(join(dist, "_scrml"), { recursive: true });
    writeFileSync(join(dist, "entry.client.js"), `import { a } from "./_scrml/used.js";\nimport("./lazy.js");\nimport { s } from "./app.server.js";\n`);
    writeFileSync(join(dist, "_scrml", "used.js"), `export { b } from "./dep.js";\nexport const a = 1;\n`);
    writeFileSync(join(dist, "_scrml", "dep.js"), `export const b = 2;\n`);
    writeFileSync(join(dist, "_scrml", "server-only.js"), `export const c = 3;\n`);
    writeFileSync(join(dist, "lazy.js"), `export default 1;\n`);
    const assets = collectClientAssets(dist, ["entry.client.js"]);
    expect(assets).toEqual(["_scrml/dep.js", "_scrml/used.js", "entry.client.js", "lazy.js"]);
  }, 30_000); // a real `scrml build` subprocess
});


// ---------------------------------------------------------------------------
// Child-process servers. EVERYTHING that touches HTTP runs in a child and is
// probed with raw sockets: this file shares a process with DOM-emulating test
// files in the pre-commit gate, and a leaked happy-dom `fetch` / `Request` /
// `Response` global would otherwise decide what these assertions observe.
// ---------------------------------------------------------------------------

async function freePort() {
  const s = Bun.serve({ port: 0, fetch: () => undefined });
  const port = s.port;
  s.stop(true);
  return port;
}

/** Collect a child's output and resolve when `re` matches it (or reject on timeout). */
async function waitForOutput(proc, re, label) {
  let out = "";
  const pump = async (stream) => { for await (const c of stream) out += new TextDecoder().decode(c); };
  pump(proc.stdout);
  pump(proc.stderr);
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    const m = re.exec(out);
    if (m) return m;
    await Bun.sleep(25);
  }
  throw new Error(`${label} did not come up:\n${out}`);
}

/** The production server: the shipped `_server.js`, run the way an adopter runs it. */
async function startProdServer(dist) {
  const port = await freePort();
  const proc = Bun.spawn(["bun", "_server.js"], {
    cwd: dist,
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForOutput(proc, /scrml server listening/, "_server.js");
  return { proc, port };
}

/**
 * The `scrml dev` APP server: the real dev child (`scrml dev --__dev-child`), which
 * runs `loadServerRoutes` + `Bun.serve(buildServeConfig(...))` → `devDispatch` —
 * exactly the process that answers every request under `scrml dev`.
 */
async function startDevChild(serveDir, inputFiles) {
  const cfgPath = join(serveDir, "..", `dev-child-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(cfgPath, JSON.stringify({ serveDir, opts: { inputFiles, port: 0 } }));
  const proc = Bun.spawn(["bun", CLI, "dev", "--__dev-child", cfgPath], { stdout: "pipe", stderr: "pipe" });
  const m = await waitForOutput(proc, /__SCRML_DEV_CHILD_READY__ (\d+)/, "scrml dev child");
  return { proc, port: Number(m[1]) };
}

async function stop(server) {
  if (!server) return;
  try { server.proc.kill(); } catch { /* gone */ }
  try { await server.proc.exited; } catch { /* ignore */ }
}

/** The shared contract, asserted identically against both servers. */
async function assertAllowlist(port, dist) {
  const assets = clientArtifacts(dist);
  expect(assets.length).toBeGreaterThanOrEqual(4);
  for (const a of assets) {
    expect(`${(await rawGet(port, "/" + a)).status} /${a}`).toBe(`200 /${a}`);
  }
  expect((await rawGet(port, "/app")).status).toBe(200); // clean URL → app.html
  expect((await rawGet(port, "/img/logo.png")).status).toBe(200);
  expect((await rawGet(port, "/favicon.ico")).status).toBe(200);
  for (const p of DENIED) {
    const r = await rawGet(port, p);
    expect(`${r.status} ${p}`).toBe(`404 ${p}`);
    expect(r.body).not.toContain("SECRET");
    expect(r.body).not.toContain("SQLite format");
    expect(r.body).not.toContain("_scrml_sql");
  }
}

// ---------------------------------------------------------------------------
// §3 — production `_server.js`
// ---------------------------------------------------------------------------

describe("§3 production _server.js (child process, raw socket)", () => {
  test("client artifacts + media 200; every denied class and traversal form 404, no leak", async () => {
    const fx = buildFixture("prod");
    const server = await startProdServer(fx.dist);
    try {
      await assertAllowlist(server.port, fx.dist);
    } finally {
      await stop(server);
    }
  }, 60_000);

  test("the emitted _server.js carries the policy readably and bakes the manifest", () => {
    const fx = buildFixture("prod-text");
    const entry = readFileSync(join(fx.dist, "_server.js"), "utf8");
    expect(entry).toContain(STATIC_POLICY_EMIT_SOURCE);
    expect(entry).toContain("const _SCRML_CLIENT_ASSETS = new Set(");
    expect(entry).toContain("if (!_scrml_static_servable(rel, _SCRML_CLIENT_ASSETS)) continue;");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// §4 — the `scrml dev` app server agrees with the production server
// ---------------------------------------------------------------------------

describe("§4 scrml dev app server agrees with _server.js (child process, raw socket)", () => {
  test("the same paths are served and refused; a stale bundle is not served", async () => {
    const fx = buildFixture("dev-parity");
    // `scrml dev` compiles with UN-hashed names: recompile the fixture the way it does.
    const { compileScrml } = await import("../../src/api.js");
    const entry = join(fx.src, "app.scrml");
    const r = compileScrml({ inputFiles: [entry], outputDir: fx.dist, write: true, log: () => {} });
    expect(r.errors).toEqual([]);
    expect(clientArtifacts(fx.dist)).toContain("app.client.js"); // dev's un-hashed bundle

    const server = await startDevChild(fx.dist, [entry]);
    try {
      await assertAllowlist(server.port, fx.dist);
      // The hashed bundle from the `scrml build` above is still on disk, but it is no
      // longer in the manifest — `scrml dev` never cleans its output dir, and a
      // leftover artifact must not be served.
      const stale = readdirSync(fx.dist).find((f) => /^app\.client\.[a-z0-9]+\.js$/.test(f));
      expect(stale).toBeDefined();
      expect((await rawGet(server.port, "/" + stale)).status).toBe(404);
    } finally {
      await stop(server);
    }
  }, 60_000);

  test("a dist with no manifest serves nothing but passive media (fail closed)", async () => {
    const dir = join(_tmp.root, "no-manifest", "dist");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<p>hi</p>");
    writeFileSync(join(dir, "logo.png"), "PNG");
    expect(existsSync(join(dir, CLIENT_ASSET_MANIFEST))).toBe(false);
    const server = await startDevChild(dir, []);
    try {
      expect((await rawGet(server.port, "/")).status).toBe(404);
      expect((await rawGet(server.port, "/index.html")).status).toBe(404);
      expect((await rawGet(server.port, "/logo.png")).status).toBe(200);
    } finally {
      await stop(server);
    }
  }, 60_000);
});
