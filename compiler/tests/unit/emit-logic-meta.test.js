/**
 * emit-logic.js — Meta Block Codegen Tests
 *
 * Tests for the `case "meta":` handler added to emitLogicNode.
 * Covers SPEC §22.5 / §22.6: runtime ^{} meta blocks are emitted as _scrml_meta_effect calls.
 *
 * Phase 2 change: meta blocks no longer emit as IIFEs. They now emit as:
 *   _scrml_meta_effect(scopeId, function(meta) { ...body... });
 *
 * The meta object (meta.get/set/subscribe/emit/cleanup/scopeId) is now injected by the
 * runtime _scrml_meta_effect function, not by codegen.
 *
 * Coverage:
 *   §1  Empty meta body produces no output
 *   §2  Runtime meta block wraps body in _scrml_meta_effect call
 *   §3  Function body provides scope isolation (variables don't leak)
 *   §4  Meta body with reactive var reference uses rewriteExpr
 *   §5  Meta body with let-decl is emitted
 *   §6  Meta body with const-decl is emitted
 *   §7  Meta body with bare-expr is emitted
 *   §8  Multi-statement meta body — all statements emitted
 *   §9  Null/undefined meta node returns empty string
 *   §10 Meta body with reactive-decl (@var = value) is emitted
 *   §11 Meta body indentation — each body line indented inside the function body
 *   §12 meta object is provided by runtime (NOT injected by codegen)
 *   §13 scopeId is passed as first argument to _scrml_meta_effect
 *   §14 body is passed as second argument (a function) to _scrml_meta_effect
 *   §15 meta parameter is named "meta" in the function signature
 *   §16 meta.scopeId uses node.id when present
 *   §17 meta.scopeId falls back to genVar when node.id is absent
 *   §18 _scrml_meta_effect call uses stable scopeId derived from node.id
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode, rewriteReflectForRuntime } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetaNode(body, id) {
  return {
    kind: "meta",
    body,
    ...(id != null ? { id } : {}),
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function makeBareExpr(expr) {
  return { kind: "bare-expr", expr };
}

function makeLetDecl(name, init) {
  return { kind: "let-decl", name, init };
}

function makeConstDecl(name, init) {
  return { kind: "const-decl", name, init };
}

function makeReactiveDecl(name, init) {
  return { kind: "state-decl", name, init };
}

// ---------------------------------------------------------------------------
// §1: Empty meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §1: empty body", () => {
  test("empty body array produces empty string", () => {
    const node = makeMetaNode([]);
    expect(emitLogicNode(node)).toBe("");
  });

  test("null body produces empty string", () => {
    const node = { kind: "meta", body: null };
    expect(emitLogicNode(node)).toBe("");
  });

  test("undefined body produces empty string", () => {
    const node = { kind: "meta", body: undefined };
    expect(emitLogicNode(node)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §2: _scrml_meta_effect wrapping
// ---------------------------------------------------------------------------

describe("emit-logic meta §2: _scrml_meta_effect wrapping", () => {
  test("meta body is wrapped in _scrml_meta_effect call", () => {
    const node = makeMetaNode([makeBareExpr("console.log('hello')")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("_scrml_meta_effect(");
    expect(output).toContain("function(meta) {");
    // Phase 3: 4-argument form — closer is "}, null, null);" (no capturedScope on plain test node)
    expect(output).toContain("}, null, null);");
  });

  test("_scrml_meta_effect call opener and closer are on their own lines", () => {
    const node = makeMetaNode([makeBareExpr("x = 1")], 2);
    const output = emitLogicNode(node);
    const lines = output.split("\n");
    expect(lines[0].trim()).toMatch(/^_scrml_meta_effect\(/);
    // Phase 3: 4-argument form — last line is "}, null, null);"
    expect(lines[lines.length - 1].trim()).toBe("}, null, null);");
  });

  test("output does NOT use the old IIFE pattern", () => {
    const node = makeMetaNode([makeBareExpr("x = 1")], 3);
    const output = emitLogicNode(node);
    expect(output).not.toContain("(() => {");
    expect(output).not.toContain("})();");
  });
});

// ---------------------------------------------------------------------------
// §3: Scope isolation
// ---------------------------------------------------------------------------

describe("emit-logic meta §3: scope isolation", () => {
  test("variables declared inside meta function body cannot leak (syntactic test)", () => {
    // The function(meta) { ... } body prevents variables from leaking into the
    // surrounding scope. This is a JavaScript runtime property of function scopes.
    const node = makeMetaNode([makeConstDecl("internalVar", "42")], 1);
    const output = emitLogicNode(node);
    // Starts with _scrml_meta_effect(
    expect(output.trimStart()).toMatch(/^_scrml_meta_effect\(/);
    // Ends with }, null, null); (Phase 3: 4-argument form)
    expect(output.trimEnd()).toMatch(/\},\s*null,\s*null\);$/);
    // The const declaration is INSIDE the function body
    const innerContent = output.replace(/^_scrml_meta_effect\([^,]+,\s*function\(meta\)\s*\{/, "").replace(/\},\s*null,\s*null\);$/, "");
    expect(innerContent).toContain("internalVar");
  });
});

// ---------------------------------------------------------------------------
// §4: rewriteExpr applied to meta body expressions
// ---------------------------------------------------------------------------

describe("emit-logic meta §4: rewriteExpr applied", () => {
  test("@reactive ref in bare-expr is rewritten by rewriteExpr", () => {
    // rewriteExpr converts @count → _scrml_reactive_get("count")
    const node = makeMetaNode([makeBareExpr("@count + 1")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain('_scrml_reactive_get("count")');
    expect(output).not.toContain("@count");
  });

  test("@reactive ref in const-decl init is rewritten", () => {
    const node = makeMetaNode([makeConstDecl("doubled", "@value * 2")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain('_scrml_reactive_get("value")');
  });

  test("@reactive ref in let-decl init is rewritten", () => {
    const node = makeMetaNode([makeLetDecl("result", "@items.length")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain('_scrml_reactive_get("items")');
  });
});

// ---------------------------------------------------------------------------
// §5: let-decl in meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §5: let-decl", () => {
  test("let-decl with init is emitted as let statement", () => {
    const node = makeMetaNode([makeLetDecl("x", "10")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("let x = 10;");
  });

  test("let-decl without init is emitted as uninitialized let", () => {
    const node = makeMetaNode([makeLetDecl("x", null)], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("let x;");
  });
});

// ---------------------------------------------------------------------------
// §6: const-decl in meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §6: const-decl", () => {
  test("const-decl is emitted as const statement", () => {
    const node = makeMetaNode([makeConstDecl("CONFIG", '{ port: 3000 }')], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("const CONFIG = { port: 3000 };");
  });
});

// ---------------------------------------------------------------------------
// §7: bare-expr in meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §7: bare-expr", () => {
  test("bare-expr is emitted as expression statement", () => {
    const node = makeMetaNode([makeBareExpr("doSomething()")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("doSomething();");
  });

  test("empty bare-expr produces no output inside function body", () => {
    const node = makeMetaNode([makeBareExpr("")], 1);
    // Empty bare-expr → empty string from emitLogicNode(bare-expr node)
    // With nothing to emit, the meta node itself produces empty string
    const output = emitLogicNode(node);
    expect(output).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §8: Multi-statement meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §8: multi-statement body", () => {
  test("all body statements are emitted inside the function body", () => {
    const node = makeMetaNode([
      makeLetDecl("x", "1"),
      makeLetDecl("y", "2"),
      makeBareExpr("console.log(x + y)"),
    ], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("let x = 1;");
    expect(output).toContain("let y = 2;");
    expect(output).toContain("console.log(x + y);");
    // All inside _scrml_meta_effect
    expect(output).toContain("_scrml_meta_effect(");
  });

  test("statements appear in original order", () => {
    const node = makeMetaNode([
      makeBareExpr("first()"),
      makeBareExpr("second()"),
      makeBareExpr("third()"),
    ], 1);
    const output = emitLogicNode(node);
    const firstPos = output.indexOf("first()");
    const secondPos = output.indexOf("second()");
    const thirdPos = output.indexOf("third()");
    expect(firstPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(thirdPos);
  });
});

// ---------------------------------------------------------------------------
// §9: Null/undefined input
// ---------------------------------------------------------------------------

describe("emit-logic meta §9: null/undefined input", () => {
  test("null node returns empty string", () => {
    expect(emitLogicNode(null)).toBe("");
  });

  test("undefined node returns empty string", () => {
    expect(emitLogicNode(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §10: reactive-decl in meta body
// ---------------------------------------------------------------------------

describe("emit-logic meta §10: reactive-decl", () => {
  test("reactive-decl inside meta body is emitted as reactive set call", () => {
    const node = makeMetaNode([makeReactiveDecl("count", "0")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain('_scrml_reactive_set("count", 0)');
  });
});

// ---------------------------------------------------------------------------
// §11: Indentation
// ---------------------------------------------------------------------------

describe("emit-logic meta §11: indentation", () => {
  test("body lines are indented with two spaces inside the function body", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 1);
    const output = emitLogicNode(node);
    const lines = output.split("\n");
    // Line 0: "_scrml_meta_effect(..."
    // Line 1: "  x();"   ← body line, indented
    // Line 2: "}, null, null);" (Phase 3: 4-argument form)
    expect(lines[0].trim()).toMatch(/^_scrml_meta_effect\(/);
    // Phase 3: 4-argument form — last line is the 4-arg closer
    expect(lines[lines.length - 1].trim()).toBe("}, null, null);");
    // The body line (second-to-last line) must be indented with two spaces
    const bodyLine = lines[lines.length - 2];
    expect(bodyLine).toMatch(/^  /);
    expect(bodyLine.trim()).toBe("x();");
  });
});

// ---------------------------------------------------------------------------
// §12: meta object is NOT injected by codegen (it's provided by the runtime)
// ---------------------------------------------------------------------------

describe("emit-logic meta §12: meta object NOT in codegen output", () => {
  test("codegen output does NOT contain 'const meta = {'", () => {
    // Phase 2: the meta object is injected by _scrml_meta_effect at runtime.
    // Codegen must NOT emit 'const meta = { get: ..., set: ..., ... }'.
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("const meta = {");
  });

  test("codegen output does NOT contain meta.get property wiring", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("get: _scrml_reactive_get");
  });

  test("codegen output does NOT contain meta.set property wiring", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("set: _scrml_reactive_set");
  });

  test("codegen output does NOT contain meta.subscribe property wiring", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("subscribe: _scrml_reactive_subscribe");
  });

  test("codegen output does NOT contain meta.cleanup property wiring", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("cleanup: (fn)");
  });

  test("codegen output does NOT contain meta.emit property wiring", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 5);
    const output = emitLogicNode(node);
    expect(output).not.toContain("emit: (htmlString)");
  });
});

// ---------------------------------------------------------------------------
// §13: scopeId as first argument to _scrml_meta_effect
// ---------------------------------------------------------------------------

describe("emit-logic meta §13: scopeId as first argument", () => {
  test("scopeId is the first argument to _scrml_meta_effect", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 99);
    const output = emitLogicNode(node);
    // Output starts with: _scrml_meta_effect("_scrml_meta_99", function(meta) {
    expect(output).toMatch(/^_scrml_meta_effect\("_scrml_meta_99",/);
  });

  test("scopeId uses _scrml_meta_<id> format when node.id is present", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 42);
    const output = emitLogicNode(node);
    expect(output).toContain('"_scrml_meta_42"');
  });
});

// ---------------------------------------------------------------------------
// §14: body as second argument (a named function) to _scrml_meta_effect
// ---------------------------------------------------------------------------

describe("emit-logic meta §14: body as second argument", () => {
  test("second argument to _scrml_meta_effect is a function expression", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("function(meta) {");
  });

  test("body statements appear inside the function body", () => {
    const node = makeMetaNode([makeBareExpr("doWork()")], 7);
    const output = emitLogicNode(node);
    // "doWork()" must appear after "function(meta) {" and before "})"
    const funcStart = output.indexOf("function(meta) {");
    const bodyPos = output.indexOf("doWork()");
    // Phase 3: the function body close "}" is followed by ", null, null);"
    // Find the last "}" before the 4-arg arguments
    const closer = "}, null, null);";
    const funcEnd = output.lastIndexOf(closer);
    expect(funcStart).toBeGreaterThan(-1);
    expect(bodyPos).toBeGreaterThan(funcStart);
    expect(bodyPos).toBeLessThan(funcEnd);
  });
});

// ---------------------------------------------------------------------------
// §15: meta parameter name
// ---------------------------------------------------------------------------

describe("emit-logic meta §15: meta parameter name", () => {
  test("the function parameter is named 'meta'", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 1);
    const output = emitLogicNode(node);
    expect(output).toContain("function(meta)");
  });
});

// ---------------------------------------------------------------------------
// §16: scopeId from node.id
// ---------------------------------------------------------------------------

describe("emit-logic meta §16: scopeId from node.id", () => {
  test("scopeId is _scrml_meta_<id> when node.id is present", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 99);
    const output = emitLogicNode(node);
    expect(output).toContain('"_scrml_meta_99"');
  });

  test("scopeId appears exactly once in output (only as first arg to _scrml_meta_effect)", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 12);
    const output = emitLogicNode(node);
    // In Phase 2, the scopeId only appears once — as the first argument.
    // (Unlike Phase 1 where it appeared in meta.emit, meta.cleanup, and meta.scopeId.)
    const count = (output.match(/"_scrml_meta_12"/g) || []).length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §17: scopeId fallback via genVar (no node.id)
// ---------------------------------------------------------------------------

describe("emit-logic meta §17: scopeId fallback via genVar", () => {
  test("scopeId falls back to genVar when node.id is absent", () => {
    resetVarCounter();
    // No id field — genVar("meta_scope") produces "_scrml_meta_scope_1"
    const node = { kind: "meta", body: [makeBareExpr("x()")] };
    const output = emitLogicNode(node);
    expect(output).toContain("_scrml_meta_scope_");
    // The generated scope ID must appear in the _scrml_meta_effect call
    expect(output).toContain("_scrml_meta_effect(");
    expect(output).toContain("function(meta)");
  });
});

// ---------------------------------------------------------------------------
// §18: Stable scopeId in _scrml_meta_effect call
// ---------------------------------------------------------------------------

describe("emit-logic meta §18: stable scopeId", () => {
  test("_scrml_meta_effect is called with a string scopeId as first arg", () => {
    const node = makeMetaNode([makeBareExpr("x()")], 7);
    const output = emitLogicNode(node);
    // First arg must be a string literal
    expect(output).toMatch(/_scrml_meta_effect\("[^"]+",/);
  });
});

// ---------------------------------------------------------------------------
// §19-§25: reflect() rewriting in runtime meta blocks (hybrid resolution)
// ---------------------------------------------------------------------------

describe("rewriteReflectForRuntime", () => {
  test("§19 PascalCase type name is quoted: reflect(Color) -> meta.types.reflect(\"Color\")", () => {
    expect(rewriteReflectForRuntime('reflect(Color)')).toBe('meta.types.reflect("Color")');
  });

  test("§20 camelCase variable is unquoted: reflect(typeName) -> meta.types.reflect(typeName)", () => {
    expect(rewriteReflectForRuntime('reflect(typeName)')).toBe('meta.types.reflect(typeName)');
  });

  test("§21 already-quoted string passes through: reflect(\"Color\") -> meta.types.reflect(\"Color\")", () => {
    expect(rewriteReflectForRuntime('reflect("Color")')).toBe('meta.types.reflect("Color")');
  });

  test("§22 @var reference is unquoted: reflect(@selectedType) is not matched (@ not in ident regex)", () => {
    // The regex only matches [A-Za-z_$] identifiers — @var would come through
    // as a complex expression. If the expr has meta.get("selectedType") it passes through.
    const result = rewriteReflectForRuntime('reflect(selectedType)');
    expect(result).toBe('meta.types.reflect(selectedType)');
  });

  test("§23 complex expression passes through: reflect(meta.get(\"x\"))", () => {
    const result = rewriteReflectForRuntime('reflect(meta.get("x"))');
    expect(result).toBe('meta.types.reflect(meta.get("x"))');
  });

  test("§24 null/empty input is safe", () => {
    expect(rewriteReflectForRuntime("")).toBe("");
    expect(rewriteReflectForRuntime(null)).toBe(null);
  });
});

describe("emit-logic meta: reflect() in runtime meta bodies", () => {
  test("§25 reflect(KnownType) in runtime meta -> meta.types.reflect(\"KnownType\")", () => {
    const node = makeMetaNode([makeBareExpr('reflect(User)')], 1);
    const output = emitLogicNode(node);
    expect(output).toContain('meta.types.reflect("User")');
    expect(output).not.toContain('reflect(User)');
  });

  test("§26 reflect(variable) in runtime meta -> meta.types.reflect(variable)", () => {
    const node = makeMetaNode([makeBareExpr('reflect(selectedType)')], 2);
    const output = emitLogicNode(node);
    expect(output).toContain('meta.types.reflect(selectedType)');
  });

  test("§27 reflect(variable) in let initializer", () => {
    const node = makeMetaNode([makeLetDecl("info", "reflect(typeName)")], 3);
    const output = emitLogicNode(node);
    expect(output).toContain('meta.types.reflect(typeName)');
  });

  test("§28 reflect(KnownType) in const initializer", () => {
    const node = makeMetaNode([makeConstDecl("info", "reflect(User)")], 4);
    const output = emitLogicNode(node);
    expect(output).toContain('meta.types.reflect("User")');
  });
});
