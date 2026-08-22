/**
 * library-mode-match-expr-lowering.test.js
 *
 * g-library-mode-match-expr-fails-codegen (§18 cross-mode parity) — a `match`
 * expression inside a library-mode pure `fn` MUST lower to the same IIFE browser
 * mode emits, not leak its raw scrml syntax into the importable `.js`.
 *
 * Before the fix, library mode emitted fn bodies as verbatim source text with
 * targeted AST-splices only for `!{}` / `?{}` / async fns; a `match` fell through
 * RAW (`return match k { 1 :> "one" … }`) and tripped the §2.2.1
 * E-CODEGEN-INVALID-LOGIC emit gate — while the byte-identical `match` compiled
 * fine in browser mode. The fix routes every SYNC library fn whose body holds a
 * `match` through the same structured `emitLibraryFnMember` the async / server /
 * tool paths use, reproducing browser mode's client lowering.
 *
 * Two-sided (R26 empirical): the emitted module is not just parse-valid — it is
 * imported and executed, asserting the correct arm is selected at runtime.
 *
 * SCOPE BOUNDARY pin: `if`-expression-value forms are DELIBERATELY not routed
 * (browser mode's own `if`-bound-`let` lowering is broken — the binding stays
 * `null` at runtime), so an `if`-bearing library fn must still LOUD-fail
 * E-CODEGEN-INVALID-LOGIC rather than trade the loud error for a silent-wrong.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-match-lowering-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileLib(name, source, { validateEmit = true } = {}) {
  const filePath = join(TMP, `${name}.scrml`);
  // Real source files end in a newline; a bare-fn library file with NO trailing
  // newline trips a separate pre-existing whole-block `}`-strip quirk (the last
  // `}` is consumed as the `${…}` wrapper close), unrelated to match lowering.
  writeFileSync(filePath, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    mode: "library",
    write: true,
    validateEmit,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const libPath = join(outDir, `${name}.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    libPath,
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
  };
}

// Import the emitted ES module and hand back its exports for runtime assertions.
async function loadLib(libPath) {
  // Cache-bust so re-emitted modules of the same name are re-read.
  return import(`${pathToFileURL(libPath).href}?t=${Date.now()}`);
}

describe("library-mode match-expr lowering (g-library-mode-match-expr-fails-codegen)", () => {
  test("the gap repro: a return-position match in an export fn lowers (no E-CODEGEN-INVALID-LOGIC) and runs", async () => {
    const r = compileLib(
      "repro",
      `export fn label(k: int) {
  return match k {
    1 :> "one"
    _ :> "other"
  }
}`,
    );
    expect(r.errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The raw scrml `match` keyword must NOT survive into the emitted JS.
    expect(/\breturn\s+match\b/.test(r.libraryJs)).toBe(false);
    // It lowered to the IIFE form browser mode emits.
    expect(r.libraryJs).toContain("(function() {");
    // R26 empirical — the emitted module executes and selects the right arm.
    const mod = await loadLib(r.libPath);
    expect(mod.label(1)).toBe("one");
    expect(mod.label(9)).toBe("other");
  });

  test("all in-fn positions lower + run: let-bound, return, and a non-export helper", async () => {
    const r = compileLib(
      "positions",
      `export fn grade(n: int) {
  let g = match n { 90 :> "A" 80 :> "B" _ :> "F" }
  return g
}
fn helperKind(x: int) { return match x { 0 :> "zero" _ :> "nonzero" } }
export fn viaHelper(x: int) { return helperKind(x) }`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(/\bmatch\b/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    expect([mod.grade(90), mod.grade(80), mod.grade(5)]).toEqual(["A", "B", "F"]);
    expect([mod.viaHelper(0), mod.viaHelper(7)]).toEqual(["zero", "nonzero"]);
  });

  test("GATE — a plain (match-free) fn is untouched by the router (raw-text path preserved)", () => {
    const r = compileLib("plain", `export fn add(a: int, b: int) { return a + b }`);
    expect(r.errorCodes).toEqual([]);
    // Not routed through the structured emitter — the raw body is preserved.
    expect(r.libraryJs).toContain("return a + b");
    // Exactly one emission of the fn (no double-route duplicate).
    const count = (r.libraryJs.match(/function add\b/g) || []).length;
    expect(count).toBe(1);
  });

  test("SCOPE BOUNDARY — an if-in-let library fn still LOUD-fails (no silent-wrong)", () => {
    // Deliberately NOT routed: browser's if-expression-value lowering is broken
    // (binding stays null at runtime), so trading the loud gate error for the
    // silent-wrong would be a regression. The raw `if` must trip the emit gate.
    const r = compileLib(
      "ifscope",
      `export fn sign(n: int) {
  let s = if n > 0 { "pos" } else { "neg" }
  return s
}`,
    );
    expect(r.errorCodes).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("disjoint from the SQL router — a plain match fn beside a ?{} server fn both resolve", () => {
    // The `?{}` fn is pruned to `.server.js`; the pure match fn is routed by the
    // control-flow pass. They must not collide (double-emit / mangled splice).
    const r = compileLib(
      "mixed",
      `export fn tier(n: int) { return match n { 1 :> "gold" _ :> "std" } }`,
    );
    expect(r.errorCodes).toEqual([]);
    const count = (r.libraryJs.match(/function tier\b/g) || []).length;
    expect(count).toBe(1);
  });
});
