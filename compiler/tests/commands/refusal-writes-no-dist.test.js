/**
 * g-session-config-refusal-still-writes-dist — an application-scope refusal
 * (E-MW-008 §20.5.1, E-MW-007 §40.3.4: "two applications in one compiled server")
 * writes NOTHING to the output directory, driven through the REAL CLI.
 *
 * Before: both codes exited 1 but `scrml build` and `scrml compile --output-dir`
 * still wrote a complete dist/ holding the split-cookie / two-onion server units,
 * so a deploy script that ignored the exit code shipped the refused split. Worse,
 * a refused rebuild over a PREVIOUS good dist overwrote the units in place and left
 * the previous `_server.js` beside them — a runnable server on the refused split.
 *
 * After: the refusal is decided BEFORE ANY WRITE (compileScrml's `beforeWrite`,
 * `commands/refusal-gate.js`) — E-MW-008 from the compile's diagnostics, E-MW-007
 * over the unit set dist/ would hold after the write (existing units this build
 * does not overwrite ∪ planned units) — so the output directory is left exactly as
 * it was (absent, or byte-identical to the last good build). No staging directory:
 * nothing beyond the output directory itself needs to be writable, and nothing is
 * created beside it.
 *
 * SCOPE: the ruling landed. SPEC §2.2.1 (S451 5(b); impl#1 exception granted S457
 * "1a") — a compile that reports ANY Error writes no artifact; the former SCOPE PIN
 * test (a non-refusal hard error still wrote) is flipped below, as this header said
 * it would be. The general rule: compiler/tests/integration/s457-no-artifacts-on-error.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync, renameSync } from "fs";
import { join, dirname, relative } from "path";
import { tmpdir } from "os";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { compileScrml } from "../../src/api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "..", "bin", "scrml.js");

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "refusal-nodist-")); });
afterAll(() => { try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {} });

const prog = (attrs, fn) => `<program csrf="off"${attrs}>
  \${
    export server function ${fn}() {
      session.set("userId", "u-1")
      return "ok"
    }
  }
  <button onclick=${fn}()>go</button>
</program>`;

const SESSION = ` sessionExpiry="7d" session-secure="false"`;

let _n = 0;
function project(files) {
  const root = join(TMP, `p${_n++}`);
  const src = join(root, "src");
  writeSources(src, files);
  return { root, src, dist: join(root, "dist") };
}
function writeSources(src, files) {
  for (const [rel, s] of Object.entries(files)) {
    const abs = join(src, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s);
  }
}
function run(args, cwd) {
  try {
    const out = execFileSync("bun", [CLI, ...args], { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: String(out ?? "") };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
const build = (p) => run(["build", p.src, "--output", p.dist], p.root);
const compile = (p) => run(["compile", p.src, "--output-dir", p.dist], p.root);

/** Every file under `dir` → its bytes, keyed by POSIX relative path. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(dir, abs).split(/[\\/]/).join("/")] = readFileSync(abs, "latin1");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
// Nothing is ever created BESIDE the output directory (no stage, no temp dir).
const nothingBeside = (p) => readdirSync(p.root).filter((n) => n !== "src" && n !== "dist");

describe("an application-scope refusal writes no dist (real CLI)", () => {
  test("scrml build — E-MW-008 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(SESSION, "aGo"), "other/zzz.scrml": prog("", "bGo") });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-008");
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("scrml build — E-MW-007 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(` log="minimal"`, "aGo"), "other/zzz.scrml": prog(` log="minimal"`, "bGo") });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-007");
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("scrml compile --output-dir — E-MW-008 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(SESSION, "aGo"), "other/zzz.scrml": prog("", "bGo") });
    const r = compile(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-008");
    expect(existsSync(p.dist)).toBe(false);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("a refused REBUILD leaves the previous good dist byte-identical (no mixed server)", () => {
    // Build #1 is legal: both programs declare their own session config (§20.5).
    const p = project({ "index.scrml": prog(SESSION, "aGo"), "other/zzz.scrml": prog(SESSION, "bGo") });
    const first = build(p);
    expect(first.code).toBe(0);
    expect(existsSync(join(p.dist, "_server.js"))).toBe(true);
    const before = snapshot(p.dist);

    // Build #2 drops zzz's declaration → E-MW-008. On base this rewrote both units
    // in place (zzz now minting a different cookie) beside build #1's _server.js.
    writeSources(p.src, { "other/zzz.scrml": prog("", "bGo") });
    const second = build(p);
    expect(second.code).not.toBe(0);
    expect(second.out).toContain("E-MW-008");
    expect(snapshot(p.dist)).toEqual(before);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("a successful build over an existing dist merges exactly like the in-place write did", () => {
    const p = project({ "index.scrml": prog("", "aGo") });
    mkdirSync(p.dist, { recursive: true });
    writeFileSync(join(p.dist, "keep.txt"), "adopter file");
    const r = build(p);
    expect(r.code).toBe(0);
    expect(readFileSync(join(p.dist, "keep.txt"), "utf8")).toBe("adopter file");
    expect(existsSync(join(p.dist, "_server.js"))).toBe(true);
    expect(existsSync(join(p.dist, "index.server.js"))).toBe(true);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("SCOPE PIN, FLIPPED (S457 \"1a\") — any other hard error writes nothing too (SPEC §2.2.1)", () => {
    const p = project({ "index.scrml": `<program>\n  <p>\${@nope}</p>\n</program>\n` });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
    expect(nothingBeside(p)).toEqual([]);
  });

  test("E-MW-007 counts a STALE unit already in dist, and still writes nothing (rename)", () => {
    // Build #1: one application with an onion, as index.scrml — legal.
    const p = project({ "index.scrml": prog(` log="minimal"`, "aGo") });
    expect(build(p).code).toBe(0);
    const before = snapshot(p.dist);
    expect(Object.keys(before)).toContain("index.server.js");

    // Rename the source. dist/ still holds build #1's index.server.js (with its
    // onion), so the server this dist would become has TWO onions → E-MW-007 —
    // decided over the post-write unit set, before main.* is written beside it.
    renameSync(join(p.src, "index.scrml"), join(p.src, "main.scrml"));
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-007");
    expect(r.out).toContain("No files were written");
    expect(snapshot(p.dist)).toEqual(before);
  });

  test("E-MW-007 is reported AFTER the warnings, as the post-write check reported it", () => {
    const p = project({ "index.scrml": prog(` log="minimal"`, "aGo"), "other/zzz.scrml": prog(` log="minimal"`, "bGo") });
    // stdout and stderr are separate pipes, so order is asserted WITHIN stderr
    // (warnings and the failure both go there) and presence on stdout.
    const r = spawnSync("bun", [CLI, "build", p.src, "--output", p.dist], { encoding: "utf8", cwd: p.root });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("Compiled 2 file(s)");
    const warnAt = r.stderr.indexOf("[warn]");
    const failAt = r.stderr.indexOf("E-MW-007");
    expect(warnAt).toBeGreaterThan(-1);
    expect(failAt).toBeGreaterThan(warnAt);
  });

  // The output directory is writable but its PARENT denies creating entries — a
  // writable volume mounted under a read-only root (/app/dist, /srv/www). Building
  // must need write on the output directory only. (icacls: Windows-only.)
  test.skipIf(process.platform !== "win32")("a build needs no write permission on the output directory's PARENT", () => {
    const p = project({ "index.scrml": prog("", "aGo") });
    const locked = join(p.root, "locked");
    const dist = join(locked, "dist");
    mkdirSync(dist, { recursive: true });
    const user = process.env.USERNAME;
    const deny = spawnSync("icacls", [locked, "/deny", `${user}:(AD,WD)`], { encoding: "utf8" });
    try {
      expect(deny.status).toBe(0);
      // The deny is real: nothing can be created directly in `locked`.
      expect(() => mkdirSync(join(locked, "probe"))).toThrow();
      const r = run(["build", p.src, "--output", dist], p.root);
      expect(r.code).toBe(0);
      expect(existsSync(join(dist, "_server.js"))).toBe(true);
      expect(existsSync(join(dist, "index.server.js"))).toBe(true);
      expect(readdirSync(locked)).toEqual(["dist"]);
    } finally {
      spawnSync("icacls", [locked, "/remove:d", user]);
    }
  });
});

// A case-only rename is only a hazard where the FS folds case: a write to the new
// spelling lands on the old file, which KEEPS its old name. Detected, not assumed
// from the platform (macOS can be either; Windows dirs can be case-sensitive).
function fsFoldsCase() {
  const probe = mkdtempSync(join(tmpdir(), "caseprobe-"));
  try {
    writeFileSync(join(probe, "CaseProbe.txt"), "x");
    return existsSync(join(probe, "caseprobe.txt"));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const FOLDS_CASE = fsFoldsCase();
// Rename through a temp name: a direct case-only rename is a no-op on some folding FSes.
function caseRename(from, to) {
  const mid = `${to}.case-rename-tmp`;
  renameSync(from, mid);
  renameSync(mid, to);
}

describe("E-MW-007 before the write — a CASE-ONLY rename is not a second onion", () => {
  // Skipped (with this reason) on a case-SENSITIVE filesystem: there the rename
  // produces two genuinely distinct files, and base's post-write check counts two.
  const onFoldingFs = test.skipIf(!FOLDS_CASE);

  onFoldingFs("file case: App.scrml → app.scrml rebuilds clean, as the post-write check did", () => {
    const p = project({ "App.scrml": prog(` log="minimal"`, "aGo"), "other.scrml": prog("", "bGo") });
    expect(build(p).code).toBe(0);
    caseRename(join(p.src, "App.scrml"), join(p.src, "app.scrml"));
    const r = build(p);
    expect(r.out).not.toContain("E-MW-007");
    expect(r.code).toBe(0);
    expect(existsSync(join(p.dist, "_server.js"))).toBe(true);
  });

  onFoldingFs("dir case: Web/main.scrml → web/main.scrml rebuilds clean, as the post-write check did", () => {
    const p = project({ "index.scrml": prog("", "aGo"), "Web/main.scrml": prog(` log="minimal"`, "bGo") });
    expect(build(p).code).toBe(0);
    caseRename(join(p.src, "Web"), join(p.src, "web"));
    const r = build(p);
    expect(r.out).not.toContain("E-MW-007");
    expect(r.code).toBe(0);
    expect(existsSync(join(p.dist, "_server.js"))).toBe(true);
  });
});

describe("E-MW-007 names each competing source once", () => {
  test("two units whose declaring files share a basename are told apart by dist path", async () => {
    const { selectRequestOnion } = await import("../../src/commands/select-request-onion.js");
    const mw = { middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "main.scrml" };
    const { error } = selectRequestOnion([
      { ...mw, filename: "a/main.server.js" },
      { ...mw, filename: "b\\main.server.js" },
    ]);
    expect(error.code).toBe("E-MW-007");
    expect(new Set(error.sources).size).toBe(error.sources.length);
    expect(error.sources).toEqual(["main.scrml (a/main.server.js)", "main.scrml (b/main.server.js)"]);
    expect(error.message).not.toContain("main.scrml, main.scrml");
  });

  test("distinct declaring files keep the plain name (message unchanged from base)", async () => {
    const { selectRequestOnion } = await import("../../src/commands/select-request-onion.js");
    const { error } = selectRequestOnion([
      { middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "index.scrml", filename: "index.server.js" },
      { middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "zzz.scrml", filename: "other/zzz.server.js" },
    ]);
    expect(error.sources).toEqual(["index.scrml", "zzz.scrml"]);
  });
});

describe("beforeWrite (compileScrml) — the planned units ARE the written units", () => {
  test("every planned .server.js relPath is exactly a written file, nested and pages/-stripped included", () => {
    const p = project({
      "index.scrml": prog("", "aGo"),
      "other/zzz.scrml": prog("", "bGo"),
      // S445 items 1 + 5: a route file's <program> is nested under the application
      // program, and `csrf=` is application-level (E-PROGRAM-NESTED-ATTR) — so the
      // route file's program carries no app-level attribute.
      "pages/admin/panel.scrml": prog("", "cGo").replace(' csrf="off"', ""),
    });
    const inputFiles = ["index.scrml", "other/zzz.scrml", "pages/admin/panel.scrml"].map((f) => join(p.src, f));
    let planned = null;
    const res = compileScrml({
      inputFiles, outputDir: p.dist, write: true, log: () => {},
      beforeWrite: ({ plannedServerUnits }) => { planned = plannedServerUnits.map((u) => u.relPath).sort(); return true; },
    });
    expect(res.errors.filter((e) => !String(e.code).startsWith("W-"))).toEqual([]);
    const written = Object.keys(snapshot(p.dist)).filter((f) => f.endsWith(".server.js")).sort();
    expect(planned).toEqual(written);
    expect(written).toContain("admin/panel.server.js");
  });

  test("returning false writes nothing at all — not even the stdlib bundle", () => {
    const p = project({ "index.scrml": `<program>\n  \${ import { formatDate } from "scrml:format" }\n  <p>\${formatDate(new Date())}</p>\n</program>\n` });
    const res = compileScrml({ inputFiles: [join(p.src, "index.scrml")], outputDir: p.dist, write: true, log: () => {}, beforeWrite: () => false });
    expect(res.fileCount).toBe(0);
    expect(existsSync(p.dist)).toBe(false);
  });
});
