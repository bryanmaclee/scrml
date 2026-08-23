/**
 * library-mode-fn-match-object-arm-lowering.test.js
 *
 * g-library-fn-match-object-or-block-arm-body-returns-undefined — the FN-body
 * sibling of the decl-position object-arm bug the S364 decl fix already dodged
 * (see library-mode-decl-match-lowering.test.js). A library-mode `fn` whose
 * `match` ARM BODY is a brace-delimited object literal (`1 :> { x: 1 }`) is
 * lowered by the shared value-IIFE match emitter (emit-control-flow.ts
 * `emitIifeBlockArmBody`). Pre-fix, the object-literal branch emitted the arm
 * BARE — `if (cond) { x: 1 }` — which JS reads as a labeled-statement block
 * (`x:` label, `1` expr-stmt), NOT an object. The IIFE fell off its end and the
 * fn returned `undefined` SILENTLY (a clean compile that passes --validate-emit).
 *
 * FIX (S369): the object-literal arm is emitted in RETURN position —
 * `if (cond) { return { x: 1 }; }` — so the braces are an object literal, mirror-
 * ing the bare-value arm path (`return emitExprField(...)`) and the decl/tilde
 * path (`_scrml_tilde = { x: 1 }`, also expression position). Cross-mode parity
 * (§18). A GENUINE `{ statement* expression? }` block still routes through the
 * §18.5 tail-lift (`planBlockArmLift`) and is UNCHANGED — the fix touches only the
 * `object`-node branch, so a value-tail block still lifts and a void-tail block
 * still voids.
 *
 * Two-sided (R26 empirical): the emitted module is imported and executed, so an
 * arm that emits without SyntaxError but returns the WRONG value (the silent
 * failure mode this gap is about) is caught. Non-regression fences: a genuine
 * block arm's value tail is still returned, a void-tail block still yields
 * undefined, and a string-arm fn still emits the untouched `return "…"` value
 * path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "lib-fn-objarm-")); });
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

describe("library-mode fn-body match object-arm lowering (g-library-fn-match-object-or-block-arm-body-returns-undefined)", () => {
  test("the gap repro: an object-literal arm is the RETURNED VALUE, not silent undefined", async () => {
    const r = compileLib(
      "repro",
      `export fn pick(n: int) { return match n { 1 :> { x: 1 } _ :> { y: 2 } } }`,
    );
    expect(r.errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The raw scrml `match` keyword must NOT survive into the emitted JS.
    expect(/=\s*match\b/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    // The bite: pre-fix BOTH were undefined (the object arm emitted as a bare
    // labeled-statement block). Post-fix each arm returns its object.
    expect(mod.pick(1)).toEqual({ x: 1 });
    expect(mod.pick(2)).toEqual({ y: 2 });
    expect(mod.pick(1)).not.toBeUndefined();
  });

  test("multi-key object arms + a wildcard presence-binding object arm", async () => {
    const r = compileLib(
      "multikey",
      `export fn tag(n: int) { return match n { 1 :> { kind: "one", n: 1 } (x) :> { kind: "other", n: x } } }`,
    );
    expect(r.errorCodes).toEqual([]);
    const mod = await loadLib(r.libPath);
    expect(mod.tag(1)).toEqual({ kind: "one", n: 1 });
    // The presence-binding wildcard binds the scrutinee AND returns an object
    // referencing it.
    expect(mod.tag(7)).toEqual({ kind: "other", n: 7 });
  });

  test("the EMPTY object arm (`1 :> {}`) returns an empty object, not undefined (S239 finding 2)", async () => {
    // `{}` is an empty OBJECT literal (the scrml parser resolves it to an `object`
    // node), NOT a void block — the decl path returns `{}`. Pre-fix, the empty-
    // `inner` early return in emitIifeBlockArmBody intercepted it before the
    // object branch and emitted a bare empty block → the IIFE returned undefined.
    const r = compileLib(
      "empty",
      `export fn e(n: int) { return match n { 1 :> {} _ :> { z: 1 } } }`,
    );
    expect(r.errorCodes).toEqual([]);
    const mod = await loadLib(r.libPath);
    expect(mod.e(1)).toEqual({});
    expect(mod.e(1)).not.toBeUndefined();
    expect(mod.e(9)).toEqual({ z: 1 });
  });

  test("NON-REGRESSION: a genuine block arm still lifts its value tail (§18.5)", async () => {
    const r = compileLib(
      "blocktail",
      `export fn calc(n: int) { return match n { 1 :> { const a = 5; a + 1 } _ :> { const b = 2; b * 10 } } }`,
    );
    expect(r.errorCodes).toEqual([]);
    const mod = await loadLib(r.libPath);
    // The real-block path (planBlockArmLift) is UNTOUCHED by the object-arm fix.
    expect(mod.calc(1)).toBe(6);
    expect(mod.calc(9)).toBe(20);
  });

  test("NON-REGRESSION: a void-tail block arm still yields undefined (§18.5 void)", async () => {
    const r = compileLib(
      "voidtail",
      `export fn maybe(n: int) { return match n { 1 :> { const a = 5; } _ :> "x" } }`,
    );
    expect(r.errorCodes).toEqual([]);
    const mod = await loadLib(r.libPath);
    // A block whose last segment is a decl produces §18.5 void — unchanged.
    expect(mod.maybe(1)).toBeUndefined();
    expect(mod.maybe(9)).toBe("x");
  });

  test("NON-REGRESSION FENCE: a string-arm fn still emits the untouched value path", async () => {
    const r = compileLib(
      "strarm",
      `export fn s(n: int) { return match n { 1 :> "a" _ :> "b" } }`,
    );
    expect(r.errorCodes).toEqual([]);
    // The bare-value arm path (`return "…"`) the fix mirrors — must be untouched:
    // no brace-wrapping, a direct `return "a"`.
    expect(/return\s+"a"/.test(r.libraryJs)).toBe(true);
    expect(/return\s+"b"/.test(r.libraryJs)).toBe(true);
    const mod = await loadLib(r.libPath);
    expect(mod.s(1)).toBe("a");
    expect(mod.s(9)).toBe("b");
  });

  test("the emitted object arm is in RETURN position (structural pin against the labeled-block regression)", async () => {
    const r = compileLib(
      "structural",
      `export fn one(n: int) { return match n { 1 :> { z: 9 } _ :> { z: 0 } } }`,
    );
    expect(r.errorCodes).toEqual([]);
    // The object literal must be RETURNED (`return { z : 9 }`), never emitted as
    // a bare `{ z: 9 }` statement (the labeled-block failure mode).
    expect(/return\s*\{\s*z\s*:\s*9\s*\}/.test(r.libraryJs)).toBe(true);
  });
});
