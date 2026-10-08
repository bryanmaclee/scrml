/**
 * payload-variants.test.js — Regression tests for S22 §1a: enum payload variant
 * construction (precondition for §51.3.2 payload binding in machine rules).
 *
 * Before S22:
 *   `Shape.Circle(10)` compiled to a frozen enum object with only string unit
 *   variants; payload variants had no constructor function. At runtime the call
 *   resolved to `undefined(10)` and threw.
 *   An enum whose variants were ALL payload variants produced no `const Shape`
 *   declaration at all (short-circuit on zero unit variants).
 *
 * After S22 §1a:
 *   - Unit variant:    `Shape.Unit`     === "Unit"
 *   - Payload variant: `Shape.Circle(r)` === { variant: "Circle", data: { r } }
 *   - Aligned with §19.3.2 `fail` format (same shape minus the __scrml_error
 *     sentinel) so one runtime can dispatch both.
 *
 * Match destructuring against the tagged-object shape is S22 §1a slice 2
 * (separate test file: payload-variants-match.test.js when landed).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/payload-variants");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
  const allErrors = result.errors || [];
  const fatalErrors = allErrors.filter((e) => e.severity !== "warning");
  const outPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
  const clientJs = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  return { errors: allErrors, fatalErrors, clientJs };
}

// Evaluate the emitted enum-constructor block in isolation. The emitter
// produces `const Shape = Object.freeze({...})`; we rewrite `const` → `var`
// and expose it through a Function expression so we can inspect runtime shape.
function evalEnum(enumConstLine, expr) {
  const rewritten = enumConstLine.replace(/^const\s+/, "var ");
  // `_scrml_g`: the runtime's host-global alias (S457 2a) the emitted line reads through.
  return new Function("_scrml_g", rewritten + "; return (" + expr + ");")(globalThis);
}

// Find the single-line `const Name = Object.freeze({...});` declaration by
// walking the emitted JS and balancing parens — a regex cannot safely skip
// the `;` characters inside the constructor function bodies.
function enumLineFor(clientJs, enumName) {
  const marker = `const ${enumName} = _scrml_g.Object.freeze(`;
  const start = clientJs.indexOf(marker);
  if (start === -1) throw new Error(`Could not find const ${enumName} in emitted client JS`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < clientJs.length; i++) {
    const ch = clientJs[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        // Expect trailing `;`
        let end = i + 1;
        while (end < clientJs.length && clientJs[end] === ";" || clientJs[end] === " ") end++;
        return clientJs.slice(start, i + 2); // include the `)` and `;`
      }
    }
  }
  throw new Error(`Unbalanced Object.freeze() for ${enumName}`);
}

describe("S22 §1a — enum payload variant construction", () => {
  test("all-payload enum emits a frozen object with per-variant constructors", () => {
    const source = `\${\n  type Shape:enum = { Circle(r: number), Rect(w: number, h: number) }\n  let a:Shape = Shape.Circle(10)\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "all-payload.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toContain("const Shape = _scrml_g.Object.freeze(");
    expect(clientJs).toContain("Circle: function(r) { return { variant: \"Circle\", data: { r } }; }");
    expect(clientJs).toContain("Rect: function(w, h) { return { variant: \"Rect\", data: { w, h } }; }");
  });

  test("mixed enum keeps unit variants as strings and payload variants as constructors", () => {
    const source = `\${\n  type Shape:enum = { Circle(r: number), Square, Triangle }\n  let a:Shape = Shape.Square\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "mixed.scrml");
    expect(fatalErrors).toEqual([]);
    const line = enumLineFor(clientJs, "Shape");
    expect(line).toContain("Square: \"Square\"");
    expect(line).toContain("Triangle: \"Triangle\"");
    expect(line).toContain("Circle: function(r)");
    // Runtime round-trip
    expect(evalEnum(line, "Shape.Square")).toBe("Square");
    expect(evalEnum(line, "Shape.Triangle")).toBe("Triangle");
    expect(evalEnum(line, "Shape.Circle(7)")).toEqual({ variant: "Circle", data: { r: 7 } });
  });

  test("single-field payload constructor round-trips the spec-aligned shape", () => {
    const source = `\${\n  type Shape:enum = { Circle(radius: number) }\n  let a:Shape = Shape.Circle(10)\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "single-field.scrml");
    expect(fatalErrors).toEqual([]);
    const line = enumLineFor(clientJs, "Shape");
    expect(evalEnum(line, "Shape.Circle(10)")).toEqual({ variant: "Circle", data: { radius: 10 } });
  });

  test("multi-field payload constructor preserves declared field order", () => {
    const source = `\${\n  type Shape:enum = { Rect(w: number, h: number) }\n  let a:Shape = Shape.Rect(3, 4)\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "multi-field.scrml");
    expect(fatalErrors).toEqual([]);
    const line = enumLineFor(clientJs, "Shape");
    expect(evalEnum(line, "Shape.Rect(3, 4)")).toEqual({ variant: "Rect", data: { w: 3, h: 4 } });
  });

  test(".variants array lists ALL variant names (unit + payload), in declaration order", () => {
    const source = `\${\n  type Shape:enum = { Circle(r: number), Square, Rect(w: number, h: number) }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "variants-order.scrml");
    expect(fatalErrors).toEqual([]);
    const line = enumLineFor(clientJs, "Shape");
    expect(evalEnum(line, "Shape.variants")).toEqual(["Circle", "Square", "Rect"]);
  });

  test("tagged-object shape aligns with §19.3.2 fail (minus the __scrml_error sentinel)", () => {
    // §19.3.2 fail objects are { __scrml_error: true, type, variant, data }.
    // Regular payload variants must use the same .variant/.data field names
    // so a single runtime helper can dispatch both by inspecting tag/variant.
    const source = `\${\n  type R:enum = { Ok(val: number), Err(msg: string) }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "fail-alignment.scrml");
    expect(fatalErrors).toEqual([]);
    const line = enumLineFor(clientJs, "R");
    const ok = evalEnum(line, "R.Ok(1)");
    expect(Object.keys(ok).sort()).toEqual(["data", "variant"]);
    expect(ok).not.toHaveProperty("__scrml_error");
  });
});
