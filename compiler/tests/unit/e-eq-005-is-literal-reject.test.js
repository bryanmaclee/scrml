/**
 * E-EQ-005 (§45.5, S237) — reject `is <value>` (steer to `==`).
 *
 * The `is` RHS is bounded: `not` / `some` / `given` / `not not` (absence /
 * presence) or an enum-variant pattern `.Variant` / `Type.Variant`. A VALUE
 * RHS on `is` — a literal (`x is 0`, `x is "text"`, `x is true`, `x is 3.14`)
 * or a value-expression (`x is @other`, `x is someLocal`) — is NOT valid:
 * `is` is the absence / variant-discrimination keyword, not a value-equality
 * operator (limit-the-primitive, §14.1.1). It is the mirror of E-EQ-002
 * (`x == not` → `x is not`) and fires E-EQ-005, steering to `==`.
 *
 * Before this rule `x is 0` mis-lowered silently to a misleading `E-DG-002`
 * or an internal `E-CODEGEN-INVALID-JS`. These tests pin that the clean reject
 * fires AND that the old misleading codes do NOT (notCodes half).
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileWholeScrml(source, testName = `eq005-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(items) {
  return items.map(e => e.code);
}

describe("E-EQ-005 — reject `is <value>` (steer to `==`)", () => {

  // ------------------------------------------------------------------
  // MUST FIRE — value literal RHS on `is`.
  // ------------------------------------------------------------------

  test("`x is 0` (int literal) → E-EQ-005", () => {
    const src = `<n> = 5
\${
  if (@n is 0) {
    log("zero")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-int");
    expect(codes(errors)).toContain("E-EQ-005");
    // The clean reject REPLACES the old misleading mis-lowering.
    expect(codes(errors)).not.toContain("E-DG-002");
    expect(codes(errors)).not.toContain("E-CODEGEN-INVALID-JS");
  });

  test('`x is "text"` (string literal) → E-EQ-005', () => {
    const src = `<s> = "hi"
\${
  if (@s is "text") {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-str");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("`x is true` (bool literal) → E-EQ-005", () => {
    const src = `<b> = true
\${
  if (@b is true) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-bool");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("`x is 3.14` (float literal) → E-EQ-005", () => {
    const src = `<n> = 5
\${
  if (@n is 3.14) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-float");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  // ------------------------------------------------------------------
  // MUST FIRE — value-expression RHS on `is`.
  // ------------------------------------------------------------------

  test("`x is @other` (cell value-expr) → E-EQ-005", () => {
    const src = `<n> = 5
<m> = 3
\${
  if (@n is @m) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-cell");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("`x is someLocal` (local ident value-expr) → E-EQ-005", () => {
    const src = `<n> = 5
\${
  const someLocal = 7
  if (@n is someLocal) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-local");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("`x is @cell.field` (member value-expr) → E-EQ-005", () => {
    const src = `<u> = { name: "a", age: 3 }
<n> = 5
\${
  if (@n is @u.age) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-member");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("`x is fn()` (call value-expr) → E-EQ-005", () => {
    const src = `<n> = 5
\${
  fn getX() -> int { 3 }
  if (@n is getX()) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-call");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  test("bare TypeName RHS `x is string` → E-EQ-005 (steers to `==`)", () => {
    const src = `<s> = "hi"
\${
  if (@s is string) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "fire-typename");
    expect(codes(errors)).toContain("E-EQ-005");
  });

  // ------------------------------------------------------------------
  // MUST NOT FIRE — sanctioned absence / presence keyword RHS.
  // ------------------------------------------------------------------

  test("`x is not` (absence) → NO E-EQ-005", () => {
    const src = `<n>: int | not
\${
  if (@n is not) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-isnot");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("`x is some` (presence) → NO E-EQ-005", () => {
    const src = `<n>: int | not
\${
  if (@n is some) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-issome");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("`x is given` (presence alias) → NO E-EQ-005", () => {
    const src = `<n>: int | not
\${
  if (@n is given) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-isgiven");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("`x is not not` (double-negation presence) → NO E-EQ-005", () => {
    const src = `<n>: int | not
\${
  if (@n is not not) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-isnotnot");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  // ------------------------------------------------------------------
  // MUST NOT FIRE — enum-variant pattern RHS.
  // ------------------------------------------------------------------

  test("`x is .Variant` (bare variant pattern) → NO E-EQ-005", () => {
    const src = `\${
  type Phase:enum = {
    Idle,
    Loading,
    Ready
  }
  <phase>: Phase = .Idle
  if (@phase is .Loading) {
    log("loading")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-variant");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("`x is .Variant(payload)` (payload variant pattern) → NO E-EQ-005", () => {
    const src = `\${
  type Shape:enum = {
    Circle(radius: int),
    Square
  }
  <shape>: Shape = .Square
  if (@shape is .Circle(r)) {
    log("circle")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-variant-payload");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("bare `.Variant(p)` payload-bind arm in match → NO E-EQ-005", () => {
    const src = `\${
  type Shape:enum = {
    Circle(radius: int),
    Square
  }
  <shape>: Shape = .Square
  <label> = match @shape {
    .Circle(r) :> "circle"
    .Square :> "square"
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-match-arm");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  // ------------------------------------------------------------------
  // MUST NOT FIRE — `==` / `!=` value equality is fine.
  // ------------------------------------------------------------------

  test("`x == 0` (value equality) → NO E-EQ-005", () => {
    const src = `<n> = 5
\${
  if (@n == 0) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-eq");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

  test("`x != y` (value inequality) → NO E-EQ-005", () => {
    const src = `<n> = 5
<m> = 3
\${
  if (@n != @m) {
    log("x")
  }
}`;
    const { errors } = compileWholeScrml(src, "sup-neq");
    expect(codes(errors)).not.toContain("E-EQ-005");
  });

});
