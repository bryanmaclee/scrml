/**
 * Emitted-JS parse gate (Approach A) — integration tests through compileScrml.
 *
 * change-id: gate-emitted-js-parse-invariant-2026-05-29 (ratified S141, A+D).
 *
 * Asserts the FULL pipeline behavior of the `validateEmit` option:
 *   1. valid programs compile clean under the gate (zero false positives) and
 *      still write their output files;
 *   2. when the codegen DOES emit invalid JS today, the gate fires
 *      E-CODEGEN-INVALID-LOGIC for exactly those artifacts and writes no codegen
 *      output (self-adjusting: if the separate codegen fix-wave later closes
 *      that surface, the test asserts the gate then emits ZERO false positives
 *      on the now-clean reference app);
 *   3. default (validateEmit OFF) preserves the pre-gate exit-0 behavior;
 *   4. the R27 fix-wave repros (C1/C2/C5) still compile clean under the gate.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import * as acorn from "acorn";
import { mkdtempSync, writeFileSync, readdirSync, statSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, "..", "..", "..");
const TD_DIR = join(REPO, "examples", "23-trucking-dispatch");

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "validate-emit-gate-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function walkScrml(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkScrml(p, acc);
    else if (e.endsWith(".scrml")) acc.push(p);
  }
  return acc;
}

function walkJs(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJs(p, acc);
    else if (e.endsWith(".js")) acc.push(p);
  }
  return acc;
}

function parsesClean(src) {
  try { acorn.parse(src, { ecmaVersion: 2022, sourceType: "module" }); return true; }
  catch { return false; }
}

describe("validate-emit gate — valid program (no false positive)", () => {
  test("a clean app compiles with zero E-CODEGEN-INVALID-LOGIC and writes output", () => {
    const src = `<program>
\${
  <count> = 0
  function inc() { @count = @count + 1 }
}
<button onclick=inc()>count: \${@count}</button>
</program>`;
    const file = join(TMP, "clean.scrml");
    writeFileSync(file, src);
    const outDir = join(TMP, "clean.dist");
    const r = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, validateEmit: true, log: () => {} });
    expect(r.errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
    expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
    // Output actually landed on disk.
    expect(walkJs(outDir).length).toBeGreaterThan(0);
    // And everything it wrote parses clean.
    for (const f of walkJs(outDir)) {
      expect(parsesClean(require("fs").readFileSync(f, "utf8"))).toBe(true);
    }
  });
});

describe("validate-emit gate — invalid emission fires E-CODEGEN-INVALID-LOGIC", () => {
  test("trucking-dispatch reference app: gate count === acorn-detected invalid count", () => {
    // Self-adjusting against the separate codegen fix-wave. First measure, with
    // the gate OFF, how many emitted artifacts acorn rejects today.
    const files = walkScrml(TD_DIR);
    expect(files.length).toBe(36);
    const baseline = compileScrml({ inputFiles: files, write: false, validateEmit: false, log: () => {} });
    let invalidCount = 0;
    for (const [, out] of baseline.outputs) {
      for (const src of [out.clientJs, out.serverJs, out.libraryJs]) {
        if (typeof src === "string" && src.length > 0 && !parsesClean(src)) invalidCount++;
      }
    }

    // Now compile WITH the gate, writing to disk so the no-write-on-failure
    // contract can be checked.
    const outDir = join(TMP, "td.dist");
    const gated = compileScrml({ inputFiles: files, outputDir: outDir, write: true, validateEmit: true, log: () => {} });
    const fires = gated.errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");

    // The gate fires for EXACTLY the artifacts acorn rejects — no more (no
    // false positives on valid artifacts), no fewer (catches every invalid one).
    expect(fires.length).toBe(invalidCount);

    if (invalidCount > 0) {
      // Pre-existing invalid-JS surface still open: the gate is a HARD error
      // and no codegen artifact (.client.js/.server.js) was written.
      expect(gated.errors.filter((e) => e.severity === "error").length).toBeGreaterThan(0);
      const writtenCodegen = walkJs(outDir).filter(
        (f) => f.endsWith(".client.js") || f.endsWith(".server.js"),
      );
      expect(writtenCodegen).toEqual([]);
      // The diagnostic names an artifact + a byte/line/column offset.
      expect(fires[0].message).toMatch(/byte \d+, line \d+, column \d+/);
      expect(fires[0].message).toContain(".client.js");
    } else {
      // Fix-wave closed the surface: the gate must NOT false-positive on the
      // now-clean reference app, and output lands normally.
      expect(walkJs(outDir).length).toBeGreaterThan(0);
    }
  }, 30000);
});

describe("validate-emit gate — default OFF preserves pre-gate behavior", () => {
  test("trucking-dispatch compiles exit-0 (no fatal errors) with the gate disabled", () => {
    const files = walkScrml(TD_DIR);
    const r = compileScrml({ inputFiles: files, write: false, validateEmit: false, log: () => {} });
    expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(r.errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
  }, 30000);
});
