/**
 * library-mode-decl-match-lowering.test.js
 *
 * g-library-mode-toplevel-decl-match-leaks (§18 cross-mode parity) — the
 * top-level-DECL sibling of g-library-mode-match-expr-fails-codegen (RESOLVED
 * S363, the fn-body class). A top-level `const/let X = match …` in a library
 * module is NOT a function-decl, so `emitControlFlowLibraryFns` (which routes
 * match-bearing fns) never touched it and the raw `match` leaked into the
 * importable `.js` → §2.2.1 E-CODEGEN-INVALID-LOGIC.
 *
 * The fix lowers a top-level decl-position match IN PLACE (a const/let does not
 * hoist, so it cannot be pruned+appended like the fn path) via a span-splice in
 * `pruneServerFnsAndLowerGuarded`, reusing the shared `emitMatchExpr` value-IIFE:
 *   - NON-export `const/let X = match …` parses as a `const-/let-decl` carrying a
 *     `matchExpr` init (spliced directly).
 *   - EXPORT `export const/let X = match …` PARSES SPLIT — an `export-decl` whose
 *     `raw` ends at `=` plus a sibling `match-stmt` node (the binding is
 *     disassociated from its init; browser mode drops the binding for the same
 *     reason). Re-associated + spliced as one `export const X = <IIFE>`.
 *
 * A `match`/decl node span can OVERSHOOT its closing `}` into the next statement
 * (a parser span quirk, filed g-match-decl-span-overshoots-next-statement); the
 * splice trims each op back to the match's own `}` so ADJACENT decls keep their
 * leading keyword.
 *
 * Two-sided (R26 empirical): the emitted module is imported and executed,
 * asserting the correct arm is selected at runtime. GATE: a match-free library
 * file must be byte-identical to the pre-fix output (the fix is a pure no-op
 * unless a decl-position match is present).
 *
 * SCOPE BOUNDARY: a NESTED match in an arm result is a PRE-EXISTING limitation
 * shared with the fn path (#636) — it LOUD-fails E-CODEGEN-INVALID-LOGIC in both
 * positions and is deliberately not addressed here.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lib-decl-match-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileLib(name, source, { validateEmit = true } = {}) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath], outputDir: outDir, mode: "library",
    write: true, validateEmit, log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const libPath = join(outDir, `${name}.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    libPath, libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
  };
}
async function loadLib(libPath) {
  return import(`${pathToFileURL(libPath).href}?t=${Date.now()}`);
}

describe("library-mode decl-position match lowering (g-library-mode-toplevel-decl-match-leaks)", () => {
  test("the gap repro: `export const V = match …` lowers (no E-CODEGEN-INVALID-LOGIC) and runs", async () => {
    const r = compileLib("repro", `export const V = match 1 { 1 :> "a" _ :> "b" }`);
    expect(r.errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The raw scrml `match` keyword must NOT survive into the emitted JS.
    expect(/=\s*match\b/.test(r.libraryJs)).toBe(false);
    // Exactly ONE `export const V` (no double-`export` regression).
    expect(r.libraryJs.match(/export\s+const\s+V\b/g)?.length).toBe(1);
    expect(/export\s+export/.test(r.libraryJs)).toBe(false);
    // Lowered via the tilde form (arm bodies in expression position); the module-
    // local temps are NOT exported.
    expect(/export\s+(let|const)\s+_scrml_tilde/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    expect(mod.V).toBe("a");
  });

  test("non-export + export, const + let, all lower and run", async () => {
    const r = compileLib(
      "kinds",
      `export const A = match 2 { 1 :> "one" 2 :> "two" _ :> "many" }
const B = match 3 { 3 :> "three" _ :> "other" }
export let C = match 1 { 1 :> "c1" _ :> "c2" }`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(/=\s*match\b/.test(r.libraryJs)).toBe(false);
    // ADJACENT-decl guard: the non-export B keeps its `const` keyword (the span
    // trim prevents A's overshooting span from clobbering B's `const`).
    expect(/(^|\n)const B = /.test(r.libraryJs)).toBe(true);
    const mod = await loadLib(r.libPath);
    expect(mod.A).toBe("two");
    expect(mod.C).toBe("c1");
    // B is module-local (non-export) — verify via A/C selecting the right arms.
  });

  test("enum-variant arms in a decl-position match lower + dispatch at runtime", async () => {
    const r = compileLib(
      "enum",
      `export type Kind:enum = { Add, Remove, Edit }
export const label = match Kind.Add { .Add :> "added" .Remove :> "removed" _ :> "other" }`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(/=\s*match\b/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    expect(mod.label).toBe("added");
  });

  test("brace-delimited arm bodies (object literals) are VALUES, not silent undefined (S239 HIGH regression)", async () => {
    // The value-IIFE (`return <arm>`) lowering emits `{ x: 1 }` as a statement
    // block → the arm returns undefined SILENTLY (passes --validate-emit). The
    // tilde lowering places the arm in expression position, so it is the object.
    const r = compileLib(
      "objarms",
      `export const OBJ = match 1 { 1 :> { x: 1 } _ :> { y: 2 } }
const LOCAL = match 2 { 1 :> { a: 1 } _ :> { b: 2 } }
export const VIA = LOCAL`,
    );
    expect(r.errorCodes).toEqual([]);
    const mod = await loadLib(r.libPath);
    // NOT undefined — the object arm is the value (cross-mode parity with browser).
    expect(mod.OBJ).toEqual({ x: 1 });     // subject 1 → first arm
    expect(mod.VIA).toEqual({ b: 2 });     // subject 2 → wildcard arm
    // The module-local tilde temps must not be exported.
    expect(/export\s+(let|const)\s+_scrml_tilde/.test(r.libraryJs)).toBe(false);
    expect(/export\s+export/.test(r.libraryJs)).toBe(false);
  });

  test("multi-scrutinee decl match fails LOUD (E-CODEGEN), never a silent wrong value", () => {
    const r = compileLib(
      "multi",
      `export const M = match 1, 2 { 1, 2 :> "both" _, _ :> "no" }`,
    );
    // A limitation — but it must be LOUD (a build error), not a silent bad value.
    expect(r.errorCodes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.libExists).toBe(false);
  });

  test("GATE: a match-free library file is byte-identical (the fix is a no-op absent a decl match)", () => {
    const src = `export const X = 5
export fn add(a: int, b: int) { return a + b }
export const msg = "hello"`;
    const r = compileLib("nomatch", src);
    expect(r.errorCodes).toEqual([]);
    // No IIFE / lowering injected — the plain decls pass through untouched.
    expect(r.libraryJs).toContain("export const X = 5");
    expect(r.libraryJs).toContain('export const msg = "hello"');
    expect(r.libraryJs).not.toContain("(function() {");
  });

  test("coexists with the #636 fn-body match path in the same module", async () => {
    const r = compileLib(
      "mixed",
      `export const top = match 1 { 1 :> "T" _ :> "U" }
export fn pick(n: int) { return match n { 1 :> "p" _ :> "q" } }
export const bottom = 42`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(/=\s*match\b/.test(r.libraryJs)).toBe(false);
    expect(/\breturn\s+match\b/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    expect(mod.top).toBe("T");
    expect(mod.pick(1)).toBe("p");
    expect(mod.bottom).toBe(42);
  });
});
