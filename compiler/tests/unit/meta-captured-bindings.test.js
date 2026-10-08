/**
 * meta-captured-bindings.test.js — capturedBindings Codegen Tests
 *
 * Tests for the emitCapturedBindings() helper in emit-logic.ts.
 * Covers SPEC §22.5.2: captured bindings object generation for runtime ^{} meta blocks.
 *
 * The emitCapturedBindings() function reads node.capturedScope (a ScopeVarEntry[] set
 * by the meta-checker pass) and emits an Object.freeze({...}) literal.
 *
 * Coverage:
 *   CB-1  Meta node with no capturedScope emits "null" for capturedBindings
 *   CB-2  Meta node with one @var emits getter using _scrml_reactive_get
 *   CB-3  Meta node with multiple @vars emits getters for each
 *   CB-4  Meta node with let binding emits direct reference
 *   CB-5  Meta node with const binding emits direct reference
 *   CB-6  Mixed @vars and let/const bindings emits correct combination
 *   CB-7  Emitted object is wrapped in Object.freeze()
 *   CB-8  @var getter uses the source variable name (not encoded)
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetaNodeWithScope(body, id, capturedScope) {
  return {
    kind: "meta",
    body,
    ...(id != null ? { id } : {}),
    ...(capturedScope != null ? { capturedScope } : {}),
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

// S458 r3: fixture bodies call a meta primitive (`meta.emit`), not a free `x()` — a runtime
// ^{} body may read only body-locals, meta primitives and captured bindings.
function makeBareExpr(expr) {
  return { kind: "bare-expr", expr };
}

// ---------------------------------------------------------------------------
// CB-1: No capturedScope → null
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-1: no capturedScope → null", () => {
  test("meta node with no capturedScope emits null for capturedBindings", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 1, undefined);
    const output = emitLogicNode(node);
    // Should end with "}, null, null);" (both capturedBindings and typeRegistry are null)
    expect(output).toContain("}, null, null);");
  });

  test("meta node with empty capturedScope emits null for capturedBindings", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 1, []);
    const output = emitLogicNode(node);
    expect(output).toContain("}, null, null);");
  });
});

// ---------------------------------------------------------------------------
// CB-2: Single @var → getter
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-2: single @var emits getter", () => {
  test("@var binding emits Object.freeze getter using _scrml_reactive_get", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 2, [
      { name: "count", kind: "reactive" },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain("_scrml_reactive_get(");
    expect(output).toContain("count");
    // The getter form: get count() { return _scrml_reactive_get("count"); }
    expect(output).toMatch(/get count\(\)\s*\{\s*return _scrml_reactive_get\("count"\)/);
  });
});

// ---------------------------------------------------------------------------
// CB-3: Multiple @vars → getters for each
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-3: multiple @vars emit multiple getters", () => {
  test("multiple @var bindings each emit a getter", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 3, [
      { name: "count", kind: "reactive" },
      { name: "items", kind: "reactive" },
    ]);
    const output = emitLogicNode(node);
    expect(output).toMatch(/get count\(\)/);
    expect(output).toMatch(/get items\(\)/);
    expect(output).toContain('_scrml_reactive_get("count")');
    expect(output).toContain('_scrml_reactive_get("items")');
  });
});

// ---------------------------------------------------------------------------
// CB-4: let binding → direct reference
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-4: let binding emits direct reference", () => {
  test("let binding emits varName: varName (direct reference)", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 4, [
      { name: "localVar", kind: "let" },
    ]);
    const output = emitLogicNode(node);
    // Direct reference form: localVar: localVar
    expect(output).toContain("localVar: localVar");
    // Should NOT use reactive_get for let bindings
    expect(output).not.toContain('_scrml_reactive_get("localVar")');
  });
});

// ---------------------------------------------------------------------------
// CB-5: const binding → direct reference
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-5: const binding emits direct reference", () => {
  test("const binding emits varName: varName (direct reference)", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 5, [
      { name: "maxCount", kind: "const" },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain("maxCount: maxCount");
    expect(output).not.toContain('_scrml_reactive_get("maxCount")');
  });
});

// ---------------------------------------------------------------------------
// CB-6: Mixed @vars and let/const
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-6: mixed bindings", () => {
  test("mixed @var and let bindings emit correct forms for each", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 6, [
      { name: "count", kind: "reactive" },
      { name: "localVar", kind: "let" },
      { name: "MAX", kind: "const" },
    ]);
    const output = emitLogicNode(node);
    // Reactive getter
    expect(output).toMatch(/get count\(\)/);
    expect(output).toContain('_scrml_reactive_get("count")');
    // Direct references
    expect(output).toContain("localVar: localVar");
    expect(output).toContain("MAX: MAX");
  });
});

// ---------------------------------------------------------------------------
// CB-7: Object.freeze wrapping
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-7: Object.freeze wrapping", () => {
  test("capturedBindings object is wrapped in Object.freeze()", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 7, [
      { name: "count", kind: "reactive" },
    ]);
    const output = emitLogicNode(node);
    expect(output).toContain("Object.freeze({");
  });

  test("Object.freeze appears in the third argument position", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 7, [
      { name: "x", kind: "let" },
    ]);
    const output = emitLogicNode(node);
    const funcCloseIdx = output.lastIndexOf("function(meta) {");
    const freezeIdx = output.indexOf("Object.freeze({");
    // Object.freeze appears AFTER the function body opener
    expect(freezeIdx).toBeGreaterThan(funcCloseIdx);
  });
});

// ---------------------------------------------------------------------------
// CB-9: Multi-property object literal is syntactically valid JS (separator regression)
// Regression for bug where Object.freeze({ ... }) emitted no commas between
// properties, producing `get count() {...} get label() {...} inc: ...` which
// fails at node --check / in the browser with SyntaxError: Unexpected token 'get'.
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-9: multi-property output is valid JS", () => {
  test("two getters emit a comma between them", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 9, [
      { name: "count", kind: "reactive" },
      { name: "label", kind: "reactive" },
    ]);
    const output = emitLogicNode(node);
    // A comma must appear between the two getter declarations
    expect(output).toMatch(/get count\(\)[^}]*\}\s*,\s*get label\(\)/);
  });

  test("mixed getter + let property emits comma between them", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 10, [
      { name: "count", kind: "reactive" },
      { name: "inc", kind: "let" },
    ]);
    const output = emitLogicNode(node);
    expect(output).toMatch(/get count\(\)[^}]*\}\s*,\s*inc: inc/);
  });

  test("the emitted Object.freeze literal is parseable as JS", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 11, [
      { name: "count", kind: "reactive" },
      { name: "label", kind: "reactive" },
      { name: "inc", kind: "let" },
    ]);
    const output = emitLogicNode(node);
    // Extract just the Object.freeze(...) argument and parse it as an expression.
    // If the old buggy emission returns, this throws SyntaxError.
    const match = output.match(/Object\.freeze\(\{[\s\S]*?\}\)/);
    expect(match).not.toBeNull();
    // Define a local `inc` so the direct-reference property doesn't fail resolution at parse.
    // We only care about syntactic validity — `new Function` performs a parse.
    expect(() => new Function("_scrml_reactive_get", "inc", `return ${match[0]};`))
      .not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CB-8: @var getter uses source name (not encoded)
// ---------------------------------------------------------------------------

describe("meta-captured-bindings CB-8: source name used in getter", () => {
  test("@var getter uses source variable name as key and as reactive_get argument", () => {
    const node = makeMetaNodeWithScope([makeBareExpr('meta.emit("x")')], 8, [
      { name: "myVar", kind: "reactive" },
    ]);
    const output = emitLogicNode(node);
    // Property name is source name
    expect(output).toContain("get myVar()");
    // Argument to reactive_get is also source name
    expect(output).toContain('_scrml_reactive_get("myVar")');
    // Not encoded (no _scrml_ prefix in the argument)
    expect(output).not.toContain('_scrml_reactive_get("_scrml_');
  });
});
