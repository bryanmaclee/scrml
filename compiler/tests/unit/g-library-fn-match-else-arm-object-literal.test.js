/**
 * g-library-fn-match-else-arm-object-literal-returns-the-bare-identifier (HIGH,
 * S368-bryan filed; S373-peter fixed) — the ELSE/wildcard block-form arm of a
 * value-position `match` whose body is an OBJECT LITERAL was mis-lowered.
 *
 * #664 fixed the object-literal arm on the INLINE path (`1 :> { x: 1 }`, a
 * `match-arm-inline` node carrying a `result` STRING). It left the sibling
 * ELSE arm untouched: `else :> { x: 0 }` is parsed by the AST builder as a
 * `match-arm-block` (a `structuredBody` of statement nodes), and `{ x: 0 }`
 * was read as a labeled-statement block whose "tail" is the bare ident `x` —
 * so the arm emitted `return x` (the parameter value) instead of `{ x: 0 }`.
 *
 * SILENT when the key name is in scope: `pick(9, 77)` returned `77`, not
 * `{ x: 0 }`, at exit 0 with no diagnostic. The fix routes an object-literal
 * structuredBody through the SAME object-vs-block classifier the inline path
 * uses (`_matchArmResultIsBlockBody`), so the two arm forms lower in lockstep;
 * genuine statement blocks (`else :> { let z = 5  z + 1 }`) are unaffected.
 *
 * Both halves are asserted: the emitted CODE shape (no bare `return x`) AND the
 * executed RUNTIME value (emitted ≠ runs — R26).
 */

import { describe, it, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function compileLib(src, base = "lib") {
  const tmpDir = mkdtempSync(join(tmpdir(), "g-else-obj-"));
  const srcPath = join(tmpDir, `${base}.scrml`);
  const outDir = join(tmpDir, "dist");
  writeFileSync(srcPath, src);
  const result = compileScrml({ inputFiles: [srcPath], outputDir: outDir, log: () => {} });
  const outPath = join(outDir, `${base}.js`);
  let out = "";
  try { out = readFileSync(outPath, "utf8"); } catch {}
  return { result, out, outPath };
}

describe("g-library-fn-match-else-arm-object-literal — the reported silent-wrong HIGH", () => {
  const SRC = `export fn pick(n: number, x: number) {
    return match n {
        1 :> { x: 1 }
        else :> { x: 0 }
    }
}`;

  it("emits the else arm's object literal in RETURN position, not the bare identifier", () => {
    const { out } = compileLib(SRC);
    // The bug's signature: the else arm returned the bare param `x`.
    expect(out).not.toMatch(/else\s*\{\s*return x\s*;/);
    // The fix: both arms return the object literal.
    expect(out).toMatch(/else\s*\{\s*return\s*\{\s*x\s*:\s*0\s*\}\s*;/);
    expect(out).toMatch(/return\s*\{\s*x\s*:\s*1\s*\}\s*;/);
  });

  it("EXECUTES to the object value, not the in-scope parameter (the silent half)", async () => {
    const { outPath } = compileLib(SRC);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.pick(1, 77)).toEqual({ x: 1 }); // matching arm
    expect(mod.pick(9, 77)).toEqual({ x: 0 }); // else arm — was 77 (silent-wrong)
  });
});

describe("g-library-fn-match-else-arm-object-literal — class coverage", () => {
  it("multi-key object else arm returns the whole object", async () => {
    const SRC = `export fn kind(n: number) {
    return match n {
        1 :> { code: "hit", ok: true }
        else :> { code: "other", ok: false }
    }
}`;
    const { out, outPath } = compileLib(SRC, "multi");
    expect(out).not.toMatch(/return code\s*;/);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.kind(1)).toEqual({ code: "hit", ok: true });
    expect(mod.kind(9)).toEqual({ code: "other", ok: false });
  });

  it("string-scrutinee else arm object literal is a value", async () => {
    const SRC = `export fn tag(v: string, x: number) {
    return match v {
        "hit" :> { x: 1 }
        else :> { x: 0 }
    }
}`;
    const { outPath } = compileLib(SRC, "strscrut");
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.tag("hit", 5)).toEqual({ x: 1 });
    expect(mod.tag("miss", 5)).toEqual({ x: 0 });
  });

  it("empty-object else arm returns {} (parity with the inline `1 :> {}` path)", async () => {
    const SRC = `export fn e(n: number) {
    return match n {
        1 :> { ok: true }
        else :> {}
    }
}`;
    const { out, outPath } = compileLib(SRC, "empty");
    // The bug's signature for the empty case: the arm fell through → undefined.
    expect(out).toMatch(/else\s*\{\s*return\s*\{\s*\}\s*;/);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.e(1)).toEqual({ ok: true });
    expect(mod.e(9)).toEqual({}); // was undefined (fell off the IIFE end)
  });

  it("object-SHORTHAND else arm `{ x }` matches the inline arm (both return { x }, not the tail value)", async () => {
    // The parser resolves `{ x }` to an object shorthand, so BOTH arms return `{ x }`.
    // This pins parity with the inline `1 :> { x }` path (#664) — the else arm must
    // NOT diverge to the pre-fix block-tail value `x`.
    const SRC = `export fn sh(n: number, x: number) {
    return match n {
        1 :> { x }
        else :> { x }
    }
}`;
    const { out, outPath } = compileLib(SRC, "shorthand");
    // Both arms identical — the fix's whole purpose.
    expect(out).toMatch(/if \(_scrml_match_\d+ === 1\) \{ return \{ x \}; \}/);
    expect(out).toMatch(/else \{ return \{ x \}; \}/);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.sh(1, 42)).toEqual({ x: 42 });
    expect(mod.sh(9, 42)).toEqual({ x: 42 }); // parity with the matching arm
  });

  it("single-EXPRESSION block else arm `{ x + 1 }` stays a block-tail value (not diverted)", async () => {
    // `{ x + 1 }` is NOT an object (no colon / shorthand) → the classifier calls it a
    // block → the arm keeps its §18.5 tail lowering and returns the VALUE `x + 1`.
    const SRC = `export fn expr(n: number, x: number) {
    return match n {
        1 :> { 100 }
        else :> { x + 1 }
    }
}`;
    const { out, outPath } = compileLib(SRC, "exprblock");
    expect(out).toMatch(/else \{ return x \+ 1; \}/);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.expr(9, 41)).toBe(42);
  });

  it("does NOT divert a genuine STATEMENT block else arm (regression guard)", async () => {
    const SRC = `export fn calc(n: number) {
    return match n {
        1 :> { 100 }
        else :> {
            let z = 5
            z + 1
        }
    }
}`;
    const { out, outPath } = compileLib(SRC, "block");
    // The genuine block keeps its statement lowering + §18.5 tail lift.
    expect(out).toMatch(/let z = 5/);
    expect(out).toMatch(/return z \+ 1\s*;/);
    const mod = await import(pathToFileURL(outPath).href);
    expect(mod.calc(1)).toBe(100);
    expect(mod.calc(9)).toBe(6);
  });
});
