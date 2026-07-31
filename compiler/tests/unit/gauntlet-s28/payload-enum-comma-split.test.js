/**
 * S28 gauntlet — payload-variant enum on a single line with comma separators.
 *
 * Pre-S28 `parseEnumBody` split the variants section on `\n` only:
 *
 *   type Result:enum = { Pending, Success(value: number), Failed(error: string) }
 *
 * This collapsed into a single "line" that entered the payload branch
 * (because `(` was present), failed the identifier regex on
 * `Pending, Success` as the "name", and skipped. Result: zero registered
 * variants. Downstream, any `< engine for=Result>` referencing a variant
 * by name fired E-ENGINE-004 "Valid variants: ." (empty list).
 *
 * Fix: split on `["\n", ","]` at top level — commas inside payload field
 * lists stay with their variant because splitTopLevel tracks `()` depth.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { buildTypeRegistry } from "../../../src/type-system.js";

function span() {
  return { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };
}

const tmpRoot = resolve(tmpdir(), "scrml-s28-payload-enum-comma");
let tmpCounter = 0;

function compileSrc(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, "app.client.js");
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S28 parseEnumBody — single-line payload enum", () => {
  test("three comma-separated variants (mix of unit + payload) register correctly", () => {
    const raw = "{ Pending, Success(value: number), Failed(error: string) }";
    const decl = { kind: "type-decl", name: "Result", typeKind: "enum", raw, span: span() };
    const registry = buildTypeRegistry([decl], [], span());
    const t = registry.get("Result");
    expect(t.kind).toBe("enum");
    expect(t.variants.map(v => v.name)).toEqual(["Pending", "Success", "Failed"]);
    // Payload fields survive the split.
    expect(t.variants[1].payload.get("value")).toBeDefined();
    expect(t.variants[2].payload.get("error")).toBeDefined();
  });

  test("multi-field payload: comma inside `(...)` stays with its variant", () => {
    const raw = "{ Circle(r: number), Rect(w: number, h: number), Unit }";
    const decl = { kind: "type-decl", name: "Shape", typeKind: "enum", raw, span: span() };
    const registry = buildTypeRegistry([decl], [], span());
    const t = registry.get("Shape");
    expect(t.variants.map(v => v.name)).toEqual(["Circle", "Rect", "Unit"]);
    expect(t.variants[1].payload.size).toBe(2);
    expect(t.variants[1].payload.get("w")).toBeDefined();
    expect(t.variants[1].payload.get("h")).toBeDefined();
  });

  test("newline-separated payload variants still work (backward compat)", () => {
    const raw = "{\n  Pending\n  Success(value: number)\n  Failed(error: string)\n}";
    const decl = { kind: "type-decl", name: "R", typeKind: "enum", raw, span: span() };
    const registry = buildTypeRegistry([decl], [], span());
    const t = registry.get("R");
    expect(t.variants.map(v => v.name)).toEqual(["Pending", "Success", "Failed"]);
  });

  test("mixed newlines + commas in the same declaration", () => {
    const raw = "{ A, B\n  Payload(x: number), C }";
    const decl = { kind: "type-decl", name: "Mix", typeKind: "enum", raw, span: span() };
    const registry = buildTypeRegistry([decl], [], span());
    const t = registry.get("Mix");
    expect(t.variants.map(v => v.name)).toEqual(["A", "B", "Payload", "C"]);
  });

  test("end-to-end: single-line payload enum governed by `< engine>` compiles", () => {
    const src = `<program>
\${
  type Result:enum = { Pending, Success(value: number), Failed(error: string) }
  @r: M = Result.Pending
  function finish() { @r = Result.Success(1) }
}
< engine name=M for=Result>
  .Pending => .Success
  .Pending => .Failed
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Variant constructors emitted.
    expect(clientJs).toContain('Success: function(value)');
    expect(clientJs).toContain('Failed: function(error)');
    expect(clientJs).toContain('Pending: "Pending"');
  });
});
