/**
 * s447-dev-db-r5 — `scrml build` and the §47.14 data root, S445 review round 4.
 *
 * Rulings (scrml-support/user-voice-scrml.md §S445): a `db=` path resolves against the
 * declaring `.scrml` file; only a file that declares the schema may create the database;
 * a built server records paths project-root-relative and resolves them at runtime against
 * SCRML_DATA_DIR ?? the project root; the Docker/Fly adapters set SCRML_DATA_DIR.
 *
 *   R4-1  An OWNING database outside the project root is recorded ABSOLUTE, so
 *         SCRML_DATA_DIR does not move it. In a container it was created at the build
 *         machine's absolute path (ephemeral layer, lost on redeploy). Now: with
 *         SCRML_DATA_DIR set and the file missing, the owning handle REFUSES (outside
 *         SCRML_DATA_DIR) — and `scrml build` warns on volume targets.
 *   R4-2  No scrml.toml / .git: the recorded path depends on the build's composition —
 *         `scrml build` warns and suggests a scrml.toml.
 *   R4-3  A REFERENCING server passed its health check with the database missing. Now
 *         the server names missing referenced databases at startup and /_scrml/health
 *         answers 503 until they exist.
 *   R4-4  `scrml build` lists the databases expected under $SCRML_DATA_DIR.
 */

import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, cpSync, rmSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname, sep } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry, sqliteBuildReport } from "../../src/commands/build.js";

// Several tests compile, spawn `scrml build`, or start a real server: under a loaded
// full-suite run (parallel hooks, other worktrees) the 5 s default is too tight.
setDefaultTimeout(60_000);

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");

// Declares its own table → OWNS the database (§8.1.1).
const OWNING_APP = (db) => `<program db="${db}">
  \${
    function ensure() {
      ?{\`CREATE TABLE IF NOT EXISTS t (n INTEGER)\`}.run()
      ?{\`INSERT INTO t (n) VALUES (7)\`}.run()
      const rows = ?{\`SELECT n FROM t\`}.all()
      return rows.length
    }
    <n> = 0
  }
  <button onclick=\${@n = ensure()}>go</button>
</program>
`;

// Only reads → REFERENCES the database; never creates it.
const REFERENCING_APP = (db) => `<program db="${db}">
  \${
    function count() {
      const rows = ?{\`SELECT n FROM t\`}.all()
      return rows.length
    }
    <n> = 0
  }
  <button onclick=\${@n = count()}>go</button>
</program>
`;

/** A project OUTSIDE the scrml repo: `<parent>/proj` (+ scrml.toml when `manifest`). */
function project(name, files, { manifest = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), `s447-${name}-`));
  const root = join(parent, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  if (manifest) writeFileSync(join(root, "scrml.toml"), "");
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, "src", rel), text);
  return { parent, root };
}

function compile(root, entries) {
  const r = compileScrml({
    inputFiles: entries.map((e) => join(root, "src", e)),
    write: true,
    outputDir: join(root, "dist"),
    log: () => {},
  });
  const fatal = (r.errors ?? []).filter((e) => e.severity !== "warning" && !String(e.code).startsWith("W-") && !String(e.code).startsWith("I-"));
  expect(fatal).toEqual([]);
  return r;
}

async function withDataDir(dir, fn) {
  const prev = process.env.SCRML_DATA_DIR;
  if (dir === null) delete process.env.SCRML_DATA_DIR; else process.env.SCRML_DATA_DIR = dir;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.SCRML_DATA_DIR; else process.env.SCRML_DATA_DIR = prev;
  }
}

/** A fresh copy of the build (Bun caches a module per path; each run needs its own). */
function copyOf(root) {
  const copy = mkdtempSync(join(tmpdir(), "s447-copy-"));
  cpSync(join(root, "dist"), copy, { recursive: true });
  return copy;
}

const importFresh = (path) => import(`file://${path}?v=${Date.now()}-${Math.random()}`);

async function freePort() {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port;
  s.stop(true);
  return port;
}

// ---------------------------------------------------------------------------
// R4-1 — an owning database outside the project root, with SCRML_DATA_DIR set
// ---------------------------------------------------------------------------

describe("R4-1 an owning db recorded absolute never gets created outside SCRML_DATA_DIR", () => {
  test("SCRML_DATA_DIR set, file missing, path outside it: the module refuses at load and creates nothing", async () => {
    const { parent, root } = project("r41", { "app.scrml": OWNING_APP("../../shared/app.db") });
    compile(root, ["app.scrml"]);
    const js = readFileSync(join(root, "dist", "app.server.js"), "utf8");
    const outside = join(parent, "shared", "app.db");
    // Recorded absolute — the data root does not move it (§47.14).
    expect(js).toContain(`_scrml_sqlite_owned(${JSON.stringify(outside.split(sep).join("/"))}`);

    const data = mkdtempSync(join(tmpdir(), "s447-vol-"));
    let err = null;
    try { await withDataDir(data, () => importFresh(join(copyOf(root), "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("refusing to create database");
    expect(msg).toContain(outside.split(sep).join("/"));
    expect(msg).toContain(`SCRML_DATA_DIR is set (${data.split(sep).join("/")})`);
    // r5b item 4 — the fix is a rebuild or a different SCRML_DATA_DIR, not seeding (the
    // module stops at load). s449 item 4 — only moving the db= path needs the rebuild;
    // SCRML_DATA_DIR is read when the program starts.
    expect(msg).toContain("move the db= path inside the project (so it resolves under SCRML_DATA_DIR) and rebuild");
    expect(msg).toContain("set SCRML_DATA_DIR to a directory that contains this path (read when the program starts; no rebuild needed)");
    expect(msg).not.toContain("then rebuild");
    expect(msg).not.toContain("yourself");
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(dirname(outside))).toBe(false); // not even the directory
  });

  test("a RELATIVE SCRML_DATA_DIR resolves against the working directory before the check", async () => {
    const { root } = project("r41rel", { "app.scrml": OWNING_APP("../../shared/app.db") });
    compile(root, ["app.scrml"]);
    let err = null;
    try { await withDataDir("./some/vol/../vol", () => importFresh(join(copyOf(root), "app.server.js"))); } catch (e) { err = e; }
    expect(String(err?.message)).toContain(`SCRML_DATA_DIR is set (${join(process.cwd(), "some", "vol").split(sep).join("/")})`);
  });

  test("SCRML_DATA_DIR unset: unchanged — the owning handle creates it at the recorded absolute path", async () => {
    const { parent, root } = project("r41unset", { "app.scrml": OWNING_APP("../../shared/app.db") });
    compile(root, ["app.scrml"]);
    await withDataDir(null, () => importFresh(join(copyOf(root), "app.server.js")));
    expect(existsSync(join(parent, "shared", "app.db"))).toBe(true);
  });

  test("an absolute path INSIDE SCRML_DATA_DIR is on the volume: created", async () => {
    const vol = mkdtempSync(join(tmpdir(), "s447-absvol-"));
    const abs = join(vol, "app.db").split(sep).join("/");
    const { root } = project("r41abs", { "app.scrml": OWNING_APP(abs) });
    compile(root, ["app.scrml"]);
    await withDataDir(vol, () => importFresh(join(copyOf(root), "app.server.js")));
    expect(existsSync(abs)).toBe(true);
  });

  test("an existing database at the absolute path still opens with SCRML_DATA_DIR set (only creation is refused)", async () => {
    const { parent, root } = project("r41exists", { "app.scrml": OWNING_APP("../../shared/app.db") });
    compile(root, ["app.scrml"]);
    mkdirSync(join(parent, "shared"), { recursive: true });
    new Database(join(parent, "shared", "app.db"), { create: true }).close();
    const data = mkdtempSync(join(tmpdir(), "s447-vol2-"));
    const mod = await withDataDir(data, () => importFresh(join(copyOf(root), "app.server.js")));
    expect(mod).toBeTruthy();
  });

  test("build report: W-DEPLOY-DB-OUTSIDE-DATA-ROOT on every volume target, not on static / no target / under /data", () => {
    const rec = (dbPath, owns = true) => ({
      kind: "server", dbPath, recordedAbsolute: dbPath.startsWith("/"), absPath: dbPath, owns,
      declaredAs: "../../shared/app.db", declaredIn: "/p/proj/src/app.scrml", projectRoot: "/p/proj", projectRootFrom: "manifest",
    });
    for (const target of ["docker", "fly", "render", "railway"]) {
      const { warnings } = sqliteBuildReport([rec("/p/shared/app.db")], target);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toStartWith("W-DEPLOY-DB-OUTSIDE-DATA-ROOT:");
      expect(warnings[0]).toContain("/p/shared/app.db");
      expect(warnings[0]).toContain(`--target ${target}`);
      expect(warnings[0]).toContain("refuses to create it");
    }
    expect(sqliteBuildReport([rec("/p/shared/app.db", false)], "fly").warnings[0]).toContain("every use fails");
    expect(sqliteBuildReport([rec("/p/shared/app.db")], undefined).warnings).toEqual([]);
    expect(sqliteBuildReport([rec("/data/app.db")], "docker").warnings).toEqual([]);
    expect(sqliteBuildReport([rec("src/app.db")], "docker").warnings).toEqual([]);
    // a kind="tool" program is not part of the built server
    expect(sqliteBuildReport([{ ...rec("/p/shared/app.db"), kind: "tool" }], "docker").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// r5b item 3 — "inside SCRML_DATA_DIR" is decided on real paths
// ---------------------------------------------------------------------------

describe("r5b-3 the R4-1 containment check resolves symlinks", () => {
  test("SCRML_DATA_DIR is a SYMLINK to the volume holding the absolute db path: created, not refused", async () => {
    const vol = realpathSync(mkdtempSync(join(tmpdir(), "s447-realvol-")));
    const link = join(realpathSync(tmpdir()), `s447-vollink-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    symlinkSync(vol, link);
    const abs = join(vol, "app.db").split(sep).join("/");
    const { root } = project("r5b3a", { "app.scrml": OWNING_APP(abs) });
    compile(root, ["app.scrml"]);
    await withDataDir(link, () => importFresh(join(copyOf(root), "app.server.js")));
    expect(existsSync(abs)).toBe(true);
  });

  test("the db= path goes THROUGH a symlink into SCRML_DATA_DIR: created, not refused", async () => {
    const vol = realpathSync(mkdtempSync(join(tmpdir(), "s447-realvol2-")));
    const link = join(realpathSync(tmpdir()), `s447-dblink-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    symlinkSync(vol, link);
    const viaLink = join(link, "sub", "app.db").split(sep).join("/"); // sub/ does not exist yet
    const { root } = project("r5b3b", { "app.scrml": OWNING_APP(viaLink) });
    compile(root, ["app.scrml"]);
    await withDataDir(vol, () => importFresh(join(copyOf(root), "app.server.js")));
    expect(existsSync(join(vol, "sub", "app.db"))).toBe(true);
  });

  test("a symlink pointing OUTSIDE SCRML_DATA_DIR is still refused", async () => {
    const vol = realpathSync(mkdtempSync(join(tmpdir(), "s447-vol3-")));
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "s447-elsewhere-")));
    symlinkSync(elsewhere, join(vol, "escape")); // vol/escape -> elsewhere
    const viaEscape = join(vol, "escape", "app.db").split(sep).join("/");
    const { root } = project("r5b3c", { "app.scrml": OWNING_APP(viaEscape) });
    compile(root, ["app.scrml"]);
    let err = null;
    try { await withDataDir(vol, () => importFresh(join(copyOf(root), "app.server.js"))); } catch (e) { err = e; }
    expect(String(err?.message)).toContain("refusing to create database");
    expect(existsSync(join(elsewhere, "app.db"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// s449 — residuals of the containment check (g-dev-db-data-root-residuals)
//
// §47.14: "'Inside' is decided on real paths (symlinks resolved; a path that does not
// exist yet through its nearest existing ancestor), and a path that cannot be resolved
// counts as outside." A symbolic link EXISTS even when its target does not, so it is not
// a path that "does not exist yet": a link whose target cannot be resolved (dangling, a
// loop) cannot be resolved, and counts as outside. Before s449 the check stepped over it
// to its parent (inside), and SQLite then followed the link and created its target.
// ---------------------------------------------------------------------------

describe("s449-2 a symlink whose target cannot be resolved is not inside SCRML_DATA_DIR", () => {
  /** A project whose owning handle records `src/app.db` (relative → under SCRML_DATA_DIR). */
  function relativeOwning(name) {
    const { root } = project(name, { "app.scrml": OWNING_APP("./app.db") });
    compile(root, ["app.scrml"]);
    expect(readFileSync(join(root, "dist", "app.server.js"), "utf8")).toContain('_scrml_sqlite_owned("src/app.db"');
    return copyOf(root);
  }

  test("a DANGLING database symlink inside the volume is refused; its target is never created", async () => {
    const copy = relativeOwning("s449dang");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "s449-dang-")));
    const vol = join(base, "data");
    mkdirSync(join(vol, "src"), { recursive: true });
    mkdirSync(join(base, "out"));
    symlinkSync("../../out/target.db", join(vol, "src", "app.db")); // data/src/app.db -> out/target.db (missing)
    let err = null;
    try { await withDataDir(vol, () => importFresh(join(copy, "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("refusing to create database");
    expect(msg).toContain(`${vol}/src/app.db`);
    expect(msg).toContain("symbolic link");
    expect(existsSync(join(base, "out", "target.db"))).toBe(false);
  });

  test("a DANGLING intermediate directory symlink is refused; nothing is created behind it", async () => {
    const copy = relativeOwning("s449dangdir");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "s449-dangdir-")));
    const vol = join(base, "data");
    mkdirSync(vol);
    symlinkSync("../out/gone", join(vol, "src")); // data/src -> out/gone (missing)
    let err = null;
    try { await withDataDir(vol, () => importFresh(join(copy, "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("refusing to create database");
    expect(msg).toContain("symbolic link");
    expect(existsSync(join(base, "out"))).toBe(false);
  });

  test("a RELATIVE recorded path through a resolvable symlink pointing OUT is refused, and the message says so", async () => {
    const copy = relativeOwning("s449out");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "s449-out-")));
    const vol = join(base, "data");
    mkdirSync(vol);
    mkdirSync(join(base, "elsewhere"));
    symlinkSync("../elsewhere", join(vol, "src")); // data/src -> elsewhere (exists)
    let err = null;
    try { await withDataDir(vol, () => importFresh(join(copy, "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("refusing to create database");
    expect(msg).toContain("a symbolic link on this path points outside it");
    expect(msg).not.toContain("recorded it as an absolute path"); // that reason is for absolute paths
    expect(existsSync(join(base, "elsewhere", "app.db"))).toBe(false);
  });

  test("an intermediate directory symlink that RESOLVES inside the volume still creates (positive control)", async () => {
    const copy = relativeOwning("s449okdir");
    const vol = realpathSync(mkdtempSync(join(tmpdir(), "s449-okdir-")));
    mkdirSync(join(vol, "real"));
    symlinkSync("real", join(vol, "src")); // data/src -> data/real
    await withDataDir(vol, () => importFresh(join(copy, "app.server.js")));
    expect(existsSync(join(vol, "real", "app.db"))).toBe(true);
  });

  test("a database symlink to an EXISTING file still opens (only creation is refused)", async () => {
    const copy = relativeOwning("s449okfile");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "s449-okfile-")));
    const vol = join(base, "data");
    mkdirSync(join(vol, "src"), { recursive: true });
    mkdirSync(join(base, "seed"));
    new Database(join(base, "seed", "real.db")).close();
    symlinkSync("../../seed/real.db", join(vol, "src", "app.db"));
    await withDataDir(vol, () => importFresh(join(copy, "app.server.js")));
    expect(existsSync(join(base, "seed", "real.db"))).toBe(true);
  });
});

describe("s449-3 a symlink loop surfaces a scrml error naming the path, not a raw EEXIST", () => {
  test("SCRML_DATA_DIR set: a looping directory symlink is refused as unresolvable", async () => {
    const { root } = project("s449loop", { "app.scrml": OWNING_APP("./app.db") });
    compile(root, ["app.scrml"]);
    const copy = copyOf(root);
    const vol = realpathSync(mkdtempSync(join(tmpdir(), "s449-loop-")));
    symlinkSync("src", join(vol, "src")); // data/src -> data/src
    let err = null;
    try { await withDataDir(vol, () => importFresh(join(copy, "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("refusing to create database");
    expect(msg).toContain(`${vol}/src/app.db`);
    expect(msg).not.toMatch(/^EEXIST/);
  });

  test("SCRML_DATA_DIR unset: a loop under the project root is a scrml error naming the path", async () => {
    const { root } = project("s449loop2", { "app.scrml": OWNING_APP("./loop1/app.db") });
    symlinkSync("loop1", join(root, "src", "loop1")); // src/loop1 -> src/loop1
    compile(root, ["app.scrml"]);
    let err = null;
    try { await withDataDir(null, () => importFresh(join(copyOf(root), "app.server.js"))); } catch (e) { err = e; }
    const msg = String(err?.message);
    expect(msg).toContain("scrml: cannot create database");
    expect(msg).toContain(`${root.split(sep).join("/")}/src/loop1/app.db`);
    expect(msg).toContain("loops or points nowhere");
    expect(err?.code).toBeUndefined(); // not the raw fs error
  });
});

// ---------------------------------------------------------------------------
// r5b item 1 — two projects in one build
// ---------------------------------------------------------------------------

describe("r5b-1 a database is a (project root, recorded path) pair", () => {
  const rec = (projectRoot, owns, declaredIn) => ({
    kind: "server", dbPath: "src/app.db", recordedAbsolute: false, absPath: projectRoot + "/src/app.db", owns,
    declaredAs: "./app.db", declaredIn, projectRoot, projectRootFrom: "manifest",
  });

  test("two roots recording src/app.db stay two databases; the referencing one reaches the health check; SHARED-PATH warns", () => {
    const r = sqliteBuildReport([
      rec("/mono/subA", true, "/mono/subA/src/a.scrml"),
      rec("/mono/subB", false, "/mono/subB/src/b.scrml"),
    ], undefined);
    expect(r.databases.map((d) => [d.projectRoot, d.owning])).toEqual([["/mono/subA", true], ["/mono/subB", false]]);
    expect(r.referencedOnly.map((d) => d.projectRoot)).toEqual(["/mono/subB"]);
    expect(r.warnings.some((w) => w.startsWith("W-DEPLOY-DB-SHARED-PATH:") && w.includes("/mono/subA") && w.includes("/mono/subB"))).toBe(true);
    expect(r.lines.some((l) => l.includes("src/app.db  (owning") && l.includes("project /mono/subA"))).toBe(true);
    expect(r.lines.some((l) => l.includes("src/app.db  (referencing") && l.includes("project /mono/subB"))).toBe(true);
    // one root: no shared-path warning, no per-project suffix
    const one = sqliteBuildReport([rec("/p", true, "/p/src/a.scrml"), rec("/p", false, "/p/src/b.scrml")], undefined);
    expect(one.databases.length).toBe(1);
    expect(one.warnings).toEqual([]);
    expect(one.lines.some((l) => l.includes("— project"))).toBe(false);
  });

  test("end to end: `scrml build mono` bakes subB's referenced db into _server.js", async () => {
    const mono = mkdtempSync(join(tmpdir(), "s447-mono-"));
    for (const [sub, file, app] of [["subA", "a.scrml", OWNING_APP("./app.db")], ["subB", "b.scrml", REFERENCING_APP("./app.db")]]) {
      mkdirSync(join(mono, sub, "src"), { recursive: true });
      writeFileSync(join(mono, sub, "scrml.toml"), "");
      writeFileSync(join(mono, sub, "src", file), app);
    }
    const out = join(mono, "out");
    const proc = Bun.spawn(["bun", CLI, "build", mono, "-o", out], { cwd: mono, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(await proc.exited).toBe(0);
    expect(stderr).toContain("W-DEPLOY-DB-SHARED-PATH");
    const entry = readFileSync(join(out, "_server.js"), "utf8");
    expect(entry).toContain(`{ path: "src/app.db", root: ${JSON.stringify(realpathSync(join(mono, "subB")).split(sep).join("/"))}`);
    expect(stdout).toContain("project " + realpathSync(join(mono, "subA")).split(sep).join("/"));
  });
});

// ---------------------------------------------------------------------------
// R4-2 — no project-root anchor
// ---------------------------------------------------------------------------

describe("R4-2 no scrml.toml / .git → the build warns that the recorded path depends on the build", () => {
  test("compileScrml reports where each handle's project root came from", () => {
    const anchored = project("r42a", { "app.scrml": OWNING_APP("./app.db") });
    const r1 = compile(anchored.root, ["app.scrml"]);
    expect(r1.sqliteDatabases.map((d) => [d.kind, d.dbPath, d.owns, d.projectRootFrom])).toEqual([["server", "src/app.db", true, "manifest"]]);

    const bare = project("r42b", { "app.scrml": OWNING_APP("./app.db") }, { manifest: false });
    const r2 = compile(bare.root, ["app.scrml"]);
    // tmpdir() holds no scrml.toml / .git, so the root is the build's.
    expect(r2.sqliteDatabases.map((d) => d.projectRootFrom)).toEqual(["build"]);
    const { warnings } = sqliteBuildReport(r2.sqliteDatabases, undefined);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toStartWith("W-DEPLOY-DB-NO-PROJECT-ROOT:");
    expect(warnings[0]).toContain("Add a scrml.toml at your project root");
    expect(sqliteBuildReport(r1.sqliteDatabases, undefined).warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R4-3 — a referencing server with its database missing fails its health check
// ---------------------------------------------------------------------------

describe("R4-3 referenced-only databases: named at startup, /_scrml/health 503 until they exist", () => {
  test("with no referenced databases the server entry is unchanged", () => {
    expect(generateServerEntry([], null, 120, [], [], [])).toBe(generateServerEntry([]));
  });

  test("the running server answers 503 while the db is missing (SCRML_DATA_DIR) and 200 once seeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s447-entry-"));
    const data = mkdtempSync(join(tmpdir(), "s447-data-"));
    writeFileSync(join(dir, "_server.js"), generateServerEntry([], null, 120, [], [], [
      { dbPath: "src/ref.db", projectRoot: "/nonexistent-build-root", declaredAs: "./ref.db", declaredIn: "src/app.scrml" },
    ]));
    const port = await freePort();
    const proc = Bun.spawn(["bun", "_server.js"], {
      cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, PORT: String(port), SCRML_DATA_DIR: data },
    });
    let err = "";
    (async () => { for await (const c of proc.stderr) err += new TextDecoder().decode(c); })();
    try {
      let res = null;
      for (const t0 = Date.now(); Date.now() - t0 < 15_000 && !res; await Bun.sleep(100)) {
        try { res = await fetch(`http://localhost:${port}/_scrml/health`); } catch { /* not up yet */ }
      }
      expect(res?.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("unavailable");
      expect(JSON.stringify(body)).not.toContain(data); // the public route names no paths
      expect(err).toContain(`database file not found: ${join(data, "src", "ref.db")}`);
      expect(err).toContain('declared as "./ref.db" in src/app.scrml');

      // r5b item 2 — a DIRECTORY at the path is not the database: still 503.
      mkdirSync(join(data, "src", "ref.db"), { recursive: true });
      expect((await fetch(`http://localhost:${port}/_scrml/health`)).status).toBe(503);
      rmSync(join(data, "src", "ref.db"), { recursive: true });

      new Database(join(data, "src", "ref.db"), { create: true }).close();
      const ok = await fetch(`http://localhost:${port}/_scrml/health`);
      expect(ok.status).toBe(200);
      expect((await ok.json()).status).toBe("ok");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("the build passes only databases no server module owns", () => {
    const rec = (dbPath, owns, declaredIn) => ({
      kind: "server", dbPath, recordedAbsolute: false, absPath: "/p/proj/" + dbPath, owns,
      declaredAs: "./x.db", declaredIn, projectRoot: "/p/proj", projectRootFrom: "manifest",
    });
    const { referencedOnly } = sqliteBuildReport([
      rec("src/shared.db", false, "/p/proj/src/reader.scrml"),
      rec("src/shared.db", true, "/p/proj/src/owner.scrml"),
      rec("src/ref.db", false, "/p/proj/src/reader.scrml"),
    ], "fly");
    expect(referencedOnly.map((d) => d.dbPath)).toEqual(["src/ref.db"]);
  });
});

// ---------------------------------------------------------------------------
// R4-4 — the build lists the databases, end to end through the CLI
// ---------------------------------------------------------------------------

describe("R4-4 `scrml build` lists the databases expected under $SCRML_DATA_DIR", () => {
  test("owning and referencing, through `scrml build --target fly`", async () => {
    const { root } = project("r44", {
      "app.scrml": OWNING_APP("./app.db"),
      "report.scrml": REFERENCING_APP("./ref.db"),
    });
    const out = join(root, "out");
    const proc = Bun.spawn(["bun", CLI, "build", join(root, "src"), "--target", "fly", "-o", out], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(await proc.exited).toBe(0);
    const text = stdout + stderr;
    expect(text).toContain("Databases expected under $SCRML_DATA_DIR");
    expect(text).toContain("a relative SCRML_DATA_DIR resolves against the server's working directory");
    expect(text).toContain("  src/app.db  (owning — created on first run)");
    // r5b item 6 — a referencing db says the health check is unavailable until seeded.
    expect(text).toContain("  src/ref.db  (referencing — seed it; /_scrml/health reports unavailable until it is seeded)");
    expect(text).not.toContain("W-DEPLOY-DB-");
    const entry = readFileSync(join(out, "_server.js"), "utf8");
    expect(entry).toContain('{ path: "src/ref.db"');
    expect(entry).not.toContain('{ path: "src/app.db"');
    rmSync(root, { recursive: true, force: true });
  });

  test("an outside-root owning db warns on a volume target and is marked NOT under $SCRML_DATA_DIR", async () => {
    const { root } = project("r44out", { "app.scrml": OWNING_APP("../../shared/app.db") });
    const out = join(root, "out");
    const proc = Bun.spawn(["bun", CLI, "build", join(root, "src"), "--target", "docker", "-o", out], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(await proc.exited).toBe(0);
    expect(stderr).toContain("W-DEPLOY-DB-OUTSIDE-DATA-ROOT");
    expect(stdout).toContain("absolute — NOT under $SCRML_DATA_DIR");
  });
});
