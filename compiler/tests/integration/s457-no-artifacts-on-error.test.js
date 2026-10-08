/**
 * SPEC §2.2.1 (S451 5(b); impl#1 exception granted S457 "1a") — a compile that
 * reports any Error-severity diagnostic writes NO artifact.
 *
 *   "A compile that reports one or more diagnostics of Error severity (§34) SHALL
 *    NOT produce a runnable artifact. After such a compile, either no output file
 *    of that compile exists, or the compile wrote no file — an output directory
 *    left by an earlier compile is left exactly as it was, neither overwritten in
 *    part nor deleted. This holds for the whole compile, not per file [...]
 *    Diagnostics of Warning or Info severity do not trigger it."
 *
 * Before S457 only ten "application-scope" codes refused the write
 * (commands/refusal-gate.js); any other Error exited 1 and wrote a complete,
 * runnable dist (g-impl1-artifacts-written-on-error-s451). This file pins the
 * rule at the ONE place it is enforced, `compileScrml` (api.js), which every
 * entry point calls — compile, build, dev / --watch, serve. The CLI-level pins
 * live in compiler/tests/commands/s457-no-artifacts-on-error-cli.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { serializeOutputs } from "../../src/commands/serve.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s457-noart-")); });
afterAll(() => { try { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch {} });

// Three refused programs of three different stages (the brief's verification set).
const QUOTED_ONCLICK = `<program>\n<x> = 0\n<button onclick="\${@x}">hi</button>\n</program>\n`;
const JAVASCRIPT_URL = `<program>\n<x> = "a"\n<a href="javascript:\${@x}">go</a>\n</program>\n`;
const MULTI_STATEMENT = `<program db="./app.db">
    \${
        function record() {
            ?{\`INSERT INTO log (msg) VALUES ('a'); INSERT INTO log (msg) VALUES ('b')\`}.run()
            return 1
        }
    }
    <button onclick=\${ record() }>record</button>
</program>
`;
const REFUSED = [
  ["quoted onclick=\"${@x}\"", QUOTED_ONCLICK, "E-ATTR-INTERP-EXECUTABLE"],
  ["href=\"javascript:${@x}\"", JAVASCRIPT_URL, "E-ATTR-INTERP-EXECUTABLE"],
  ["§8.1.2 two statements in one ?{}", MULTI_STATEMENT, "E-SQL-MULTIPLE-STATEMENTS"],
];
const GOOD = `<program>\n<x> = 0\n<p>\${@x}</p>\n<button onclick=\${() => { @x = @x + 1 }}>inc</button>\n</program>\n`;

let _n = 0;
function project(files) {
  const root = join(TMP, `p${_n++}`);
  for (const [rel, s] of Object.entries(files)) {
    const abs = join(root, "src", rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, s);
  }
  return { root, src: join(root, "src"), dist: join(root, "dist") };
}
function compileInto(p, entries, extra = {}) {
  return compileScrml({
    inputFiles: entries.map((e) => join(p.src, e)),
    outputDir: p.dist,
    write: true,
    log: () => {},
    ...extra,
  });
}
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

describe("§2.2.1 — an Error writes nothing (compileScrml, every entry point's writer)", () => {
  for (const [label, src, code] of REFUSED) {
    test(`${label} → ${code}, no output directory, artifactsWritten false`, () => {
      const p = project({ "app.scrml": src });
      const r = compileInto(p, ["app.scrml"]);
      expect(r.errors.map((e) => e.code)).toContain(code);
      expect(r.artifactsWritten).toBe(false);
      expect(r.fileCount).toBe(0);
      expect(r.serverModules).toEqual([]);
      expect(r.clientAssets).toEqual([]);
      expect(existsSync(p.dist)).toBe(false);
    });

    test(`${label} over a previous good build → that build is left byte-identical`, () => {
      const p = project({ "app.scrml": GOOD });
      const ok = compileInto(p, ["app.scrml"]);
      expect(ok.errors).toEqual([]);
      expect(ok.artifactsWritten).toBe(true);
      const before = snapshot(p.dist);
      expect(Object.keys(before)).toContain("app.html");

      writeFileSync(join(p.src, "app.scrml"), src);
      const r = compileInto(p, ["app.scrml"]);
      expect(r.errors.map((e) => e.code)).toContain(code);
      expect(r.artifactsWritten).toBe(false);
      expect(snapshot(p.dist)).toEqual(before);
    });
  }

  test("multi-file: one failing file refuses the WHOLE compile (no file of it is written)", () => {
    const p = project({ "a.scrml": GOOD, "b.scrml": QUOTED_ONCLICK });
    const r = compileInto(p, ["a.scrml", "b.scrml"], { gather: false });
    expect(r.errors.map((e) => e.code)).toContain("E-ATTR-INTERP-EXECUTABLE");
    expect(r.artifactsWritten).toBe(false);
    expect(existsSync(p.dist)).toBe(false);
  });

  test("a non-application-scope Error (E-STATE-UNDECLARED) — the old SCOPE PIN — now writes nothing", () => {
    const p = project({ "app.scrml": `<program>\n  <p>\${@nope}</p>\n</program>\n` });
    const r = compileInto(p, ["app.scrml"]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.artifactsWritten).toBe(false);
    expect(existsSync(p.dist)).toBe(false);
  });

  test("Warnings / Info never block: a warning-only compile writes", () => {
    const p = project({ "app.scrml": GOOD });
    const r = compileInto(p, ["app.scrml"]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0); // W-PROGRAM-SPA-INFERRED at least
    expect(r.artifactsWritten).toBe(true);
    expect(existsSync(join(p.dist, "app.html"))).toBe(true);
    expect(existsSync(join(p.dist, "app.client.js"))).toBe(true);
  });

  test("E-CG-015 (two sources, one dist path) is decided before the first byte — nothing written", () => {
    // `pages/` is stripped from the dist path (§47.9.5), so `pages/a.scrml` and
    // `a.scrml` both compile to `dist/a.*`. Before S457 the collision was found
    // mid-write: the runtime and every artifact staged before it were on disk.
    const p = project({ "a.scrml": GOOD, "pages/a.scrml": GOOD.replace("<p>", "<p>other ") });
    const r = compileInto(p, ["a.scrml", "pages/a.scrml"], { gather: false });
    expect(r.errors.map((e) => e.code)).toContain("E-CG-015");
    expect(r.artifactsWritten).toBe(false);
    expect(existsSync(p.dist)).toBe(false);
  });

  test("the beforeWrite callback is still consulted on a failed compile (a command can add its own refusal)", () => {
    const p = project({ "app.scrml": QUOTED_ONCLICK });
    let asked = null;
    const r = compileInto(p, ["app.scrml"], { beforeWrite: ({ errors }) => { asked = errors.map((e) => e.code); return true; } });
    expect(asked).toContain("E-ATTR-INTERP-EXECUTABLE");
    // Returning true does not override the rule.
    expect(r.artifactsWritten).toBe(false);
    expect(existsSync(p.dist)).toBe(false);
  });

  test("write:false is unchanged — in-memory outputs and diagnostics are still returned for tooling", () => {
    const p = project({ "app.scrml": QUOTED_ONCLICK });
    const r = compileScrml({ inputFiles: [join(p.src, "app.scrml")], outputDir: p.dist, write: false, log: () => {} });
    expect(r.errors.map((e) => e.code)).toContain("E-ATTR-INTERP-EXECUTABLE");
    expect(r.artifactsWritten).toBe(false);
    expect(existsSync(p.dist)).toBe(false);
  });
});

describe("§2.2.1 — the stdlib bundle is planned before the write, copied only after it is committed", () => {
  const DEFERRED = (extra) => `<program>\n\${ import { compileScrml } from 'scrml:compiler' }\n<x> = 0\n<p>hi</p>\n${extra}</program>\n`;
  const count = (r, code) => [...r.errors, ...r.warnings].filter((d) => d.code === code).length;

  test("a clean compile: the shim is copied, its warning reported ONCE", () => {
    const p = project({ "app.scrml": DEFERRED("") });
    const r = compileInto(p, ["app.scrml"]);
    expect(r.errors).toEqual([]);
    expect(count(r, "W-STDLIB-COMPILER-DEFERRED")).toBe(1);
    expect(existsSync(join(p.dist, "_scrml", "compiler.js"))).toBe(true);
  });

  test("a failed compile: the same warning, still once, and no `_scrml/` shim on disk", () => {
    const p = project({ "app.scrml": DEFERRED(`<button onclick="\${@x}">b</button>\n`) });
    const r = compileInto(p, ["app.scrml"]);
    expect(r.errors.map((e) => e.code)).toContain("E-ATTR-INTERP-EXECUTABLE");
    expect(count(r, "W-STDLIB-COMPILER-DEFERRED")).toBe(1);
    expect(existsSync(p.dist)).toBe(false);
  });

  test("runtimeSource() hands tooling the runtime a failed compile did not write", () => {
    const p = project({ "app.scrml": QUOTED_ONCLICK });
    const r = compileInto(p, ["app.scrml"]);
    expect(r.artifactsWritten).toBe(false);
    expect(r.runtimeSource()).toContain("_scrml_reactive_set");
  });
});

describe("§2.2.1 — scrml serve returns no emitted code for a failed compile", () => {
  test("serializeOutputs: errors → {} ; success → every output", () => {
    const p = project({ "bad.scrml": QUOTED_ONCLICK, "good.scrml": GOOD });
    const bad = compileScrml({ inputFiles: [join(p.src, "bad.scrml")], write: false, log: () => {} });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.outputs.size).toBeGreaterThan(0); // the API still has them in memory …
    expect(serializeOutputs(bad)).toEqual({});   // … the endpoint does not hand them out
    const good = compileScrml({ inputFiles: [join(p.src, "good.scrml")], write: false, log: () => {} });
    expect(good.errors).toEqual([]);
    const out = serializeOutputs(good);
    expect(Object.keys(out).length).toBe(1);
    expect(typeof Object.values(out)[0].clientJs).toBe("string");
  });
});
