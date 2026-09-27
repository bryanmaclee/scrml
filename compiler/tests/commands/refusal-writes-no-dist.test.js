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
 * After: the command compiles into a sibling stage (`commands/staged-output.js`)
 * and discards it on refusal, so the output directory is left exactly as it was
 * (absent, or byte-identical to the last good build).
 *
 * SCOPE PIN: every OTHER hard error keeps its pre-existing posture (artifacts land,
 * exit 1). The last test pins that on purpose; widening fail-closed to all hard
 * errors is an open ruling, and flipping that test is how the ruling would land.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

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
const noStageLeft = (p) => readdirSync(p.root).filter((n) => n.includes("scrml-stage"));

describe("an application-scope refusal writes no dist (real CLI)", () => {
  test("scrml build — E-MW-008 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(SESSION, "aGo"), "other/zzz.scrml": prog("", "bGo") });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-008");
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
    expect(noStageLeft(p)).toEqual([]);
  });

  test("scrml build — E-MW-007 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(` log="minimal"`, "aGo"), "other/zzz.scrml": prog(` log="minimal"`, "bGo") });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-007");
    expect(r.out).toContain("No files were written");
    expect(existsSync(p.dist)).toBe(false);
    expect(noStageLeft(p)).toEqual([]);
  });

  test("scrml compile --output-dir — E-MW-008 exits non-zero and creates no output directory", () => {
    const p = project({ "index.scrml": prog(SESSION, "aGo"), "other/zzz.scrml": prog("", "bGo") });
    const r = compile(p);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E-MW-008");
    expect(existsSync(p.dist)).toBe(false);
    expect(noStageLeft(p)).toEqual([]);
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
    expect(noStageLeft(p)).toEqual([]);
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
    expect(noStageLeft(p)).toEqual([]);
  });

  test("SCOPE PIN — a non-refusal hard error still writes artifacts (pre-existing posture)", () => {
    const p = project({ "index.scrml": `<program>\n  <p>\${@nope}</p>\n</program>\n` });
    const r = build(p);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("No files were written");
    expect(existsSync(join(p.dist, "index.html"))).toBe(true);
    expect(noStageLeft(p)).toEqual([]);
  });
});
