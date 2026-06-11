/**
 * ast-builder-nested-fn-keyword — A6 regression suite (S99 2026-05-17).
 *
 * Gap (pre-A6): `fn name(...) { ... }` (the §48 keyword form) declared INSIDE
 * another function body parsed as a bare-expr — collectExpr saw `fn` mid-body
 * with parts.length>0 and emitted "statement boundary not detected — trailing
 * content would be silently dropped" and the TS stage emitted three
 * E-SCOPE-001 errors (one on the `fn` token, two on call-site references).
 *
 * Fix (commit db2dd3c): added a nested-fn handler in parseOneStatement
 * mirroring the top-level handler at ast-builder.js:~7760. SPEC §7.3.1
 * "Function declarations inside ${} logic blocks MAY be nested" + SPEC
 * §48.11 (`fn` is the canonical pure form; `pure function` is its deprecated
 * synonym — identical contract). Downstream stages (type-system scope walker,
 * §48 purity checker, codegen emit-functions) already recurse into body and
 * already handle function-decl nodes with `fnKind: "fn"`.
 *
 * Expected AST node shape:
 *   {
 *     kind: "function-decl",
 *     name: <string>,
 *     params: <Param[]>,
 *     body: <AstNode[]>,
 *     fnKind: "fn",
 *     isServer: <boolean>,
 *     isPure?: true,        // only when `pure fn` was explicit (rare)
 *     isAsync?: true,       // only when `async fn`
 *     canFail: <boolean>,
 *     ...
 *   }
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(src) {
  const filePath = "/test/fixture.scrml";
  const bs = splitBlocks(filePath, src);
  return buildAST(bs);
}

function findAllNodesOfKind(ast, kind) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === kind) out.push(n);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && k !== "span") walk(v);
    }
  }
  walk(ast);
  return out;
}

function getFn(result, name) {
  return findAllNodesOfKind(result.ast, "function-decl").find(f => f.name === name);
}

// ---------------------------------------------------------------------------
// Primary shapes — nested fn keyword-form
// ---------------------------------------------------------------------------

describe("nested fn keyword-form — basic shapes (SPEC §7.3.1 + §48.11)", () => {
  test("bare nested fn — `fn helper() { ... }` inside function body", () => {
    const result = parse(`\${
      function outer() {
        fn helper() {
          return 42
        }
        return helper()
      }
    }`);
    const helper = getFn(result, "helper");
    expect(helper).toBeDefined();
    expect(helper.kind).toBe("function-decl");
    expect(helper.fnKind).toBe("fn");
    expect(helper.params).toEqual([]);
    expect(helper.body).toBeDefined();
    expect(helper.body.length).toBeGreaterThan(0);
    // Nested fn must appear INSIDE outer.body, not in the top-level AST.
    const outer = getFn(result, "outer");
    expect(outer).toBeDefined();
    const outerBodyFns = (outer.body || []).filter(n => n.kind === "function-decl");
    expect(outerBodyFns).toHaveLength(1);
    expect(outerBodyFns[0].name).toBe("helper");
  });

  test("nested fn with bare param — `fn testExpr(expr) { ... }`", () => {
    // The meta-checker.scrml repro case.
    const result = parse(`\${
      function bodyUsesCompileTimeApis(body) {
        fn testExpr(expr) {
          return COMPILE_TIME_API_PATTERNS.some(p => p.test(expr))
        }
        return testExpr("foo")
      }
    }`);
    const fn = getFn(result, "testExpr");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.params).toEqual([{ name: "expr" }]);
    // No "statement boundary not detected" warning — buildAST.errors should be free of it.
    const errs = (result.errors || []).map(e => e.message || String(e));
    expect(errs.some(m => /statement boundary not detected/.test(m))).toBe(false);
  });

  test("nested fn with typed param — `fn typeToString(type: ResolvedType) { ... }`", () => {
    const result = parse(`\${
      function outer() {
        fn typeToString(type: ResolvedType) {
          return type.kind
        }
      }
    }`);
    const fn = getFn(result, "typeToString");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toBe("type");
    expect(fn.params[0].typeAnnotation).toBe("ResolvedType");
  });

  test("nested fn with default-value param (A3) — `fn clamp(v, min = 0)`", () => {
    const result = parse(`\${
      function outer() {
        fn clamp(v, min = 0) {
          return v < min ? min : v
        }
      }
    }`);
    const fn = getFn(result, "clamp");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.params).toEqual([
      { name: "v" },
      { name: "min", defaultValue: "0" },
    ]);
  });

  test("multiple sibling nested fns share scope", () => {
    const result = parse(`\${
      function outer() {
        fn first(x) { return x + 1 }
        fn second(x) { return first(x) * 2 }
        return second(0)
      }
    }`);
    const first = getFn(result, "first");
    const second = getFn(result, "second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.fnKind).toBe("fn");
    expect(second.fnKind).toBe("fn");
    // Both must be in the OUTER body, not at top level.
    const outer = getFn(result, "outer");
    const innerFns = (outer.body || []).filter(n => n.kind === "function-decl");
    expect(innerFns.map(f => f.name).sort()).toEqual(["first", "second"]);
  });

  test("nested fn closing over outer let — closure semantics (§7.3.1)", () => {
    // SPEC §7.3.1: "Inner fn declarations are subject to the same purity
    // constraints as top-level fn — they may read outer bindings but may
    // not mutate them." Read-only closure is permitted.
    const result = parse(`\${
      function outer(seed) {
        let counter = 0
        fn report() {
          return seed + counter
        }
        return report()
      }
    }`);
    const report = getFn(result, "report");
    expect(report).toBeDefined();
    expect(report.fnKind).toBe("fn");
    // Body must reference `seed` and `counter` — verifies the body parsed
    // structurally (not as truncated bare-expr).
    const bodyText = JSON.stringify(report.body);
    expect(bodyText).toMatch(/seed/);
    expect(bodyText).toMatch(/counter/);
  });

  test("recursive nested fn — references itself by name", () => {
    const result = parse(`\${
      function outer(n) {
        fn rec(k) {
          if (k <= 0) return 1
          return k * rec(k - 1)
        }
        return rec(n)
      }
    }`);
    const rec = getFn(result, "rec");
    expect(rec).toBeDefined();
    expect(rec.fnKind).toBe("fn");
    // Body must contain the recursive call — not truncated.
    const bodyText = JSON.stringify(rec.body);
    expect(bodyText).toMatch(/rec/);
  });
});

// ---------------------------------------------------------------------------
// Modifier prefixes — async / server / pure
// ---------------------------------------------------------------------------

describe("nested fn keyword-form — modifier prefixes", () => {
  test("nested `server fn name(...)` — isServer:true", () => {
    const result = parse(`\${
      function outer() {
        server fn fetchSomething(id) {
          return id
        }
      }
    }`);
    const fn = getFn(result, "fetchSomething");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.isServer).toBe(true);
  });

  test("nested `async fn name(...)` — isAsync:true", () => {
    const result = parse(`\${
      function outer() {
        async fn doWork() {
          return 1
        }
      }
    }`);
    const fn = getFn(result, "doWork");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.isAsync).toBe(true);
  });

  test("nested `pure fn name(...)` — isPure:true (deprecated per §33, W-PURE-DEPRECATED)", () => {
    const result = parse(`\${
      function outer() {
        pure fn validate(x) {
          return x > 0
        }
      }
    }`);
    const fn = getFn(result, "validate");
    expect(fn).toBeDefined();
    expect(fn.fnKind).toBe("fn");
    expect(fn.isPure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Return-type annotation + canFail
// ---------------------------------------------------------------------------

describe("nested fn keyword-form — annotations", () => {
  test("nested fn with arrow return type — `fn n(x) -> number { ... }`", () => {
    const result = parse(`\${
      function outer() {
        fn double(x) -> number {
          return x * 2
        }
      }
    }`);
    const fn = getFn(result, "double");
    expect(fn).toBeDefined();
    expect(fn.hasReturnType).toBe(true);
    expect(fn.returnTypeAnnotation).toBe("number");
  });

  test("nested fn with canFail `!` — canFail:true", () => {
    const result = parse(`\${
      function outer() {
        fn divide(a, b)! -> DivError {
          if (b == 0) fail DivError::ByZero
          return a / b
        }
      }
    }`);
    const fn = getFn(result, "divide");
    expect(fn).toBeDefined();
    expect(fn.canFail).toBe(true);
    expect(fn.errorType).toBe("DivError");
  });
});

// ---------------------------------------------------------------------------
// Regression guard — top-level fn unchanged
// ---------------------------------------------------------------------------

describe("top-level fn keyword-form still works (regression guard)", () => {
  test("top-level `fn name(...)` parses identically", () => {
    const result = parse(`\${
      fn doStuff(x) {
        return x + 1
      }
    }`);
    const fn = getFn(result, "doStuff");
    expect(fn).toBeDefined();
    expect(fn.kind).toBe("function-decl");
    expect(fn.fnKind).toBe("fn");
    expect(fn.params).toEqual([{ name: "x" }]);
  });
});

// ---------------------------------------------------------------------------
// Statement-boundary regression — no "trailing content silently dropped"
// ---------------------------------------------------------------------------

describe("nested fn no longer triggers statement-boundary warning", () => {
  test("nested fn followed by sibling statement — both parse cleanly", () => {
    const result = parse(`\${
      function outer() {
        fn helper(x) { return x }
        let y = helper(5)
        return y
      }
    }`);
    const helper = getFn(result, "helper");
    expect(helper).toBeDefined();
    // Outer must contain BOTH the nested fn AND the let-decl AND a return.
    // Before the fix, collectExpr consumed `fn helper(x) { return x } let y = ...`
    // as one bare-expr and emitted the boundary warning.
    const outer = getFn(result, "outer");
    const kinds = (outer.body || []).map(n => n.kind);
    expect(kinds).toContain("function-decl");
    expect(kinds).toContain("let-decl");
    // No statement-boundary warnings should be emitted by buildAST.
    const errs = (result.errors || []).map(e => e.message || String(e));
    expect(errs.some(m => /statement boundary not detected/.test(m))).toBe(false);
  });
});
