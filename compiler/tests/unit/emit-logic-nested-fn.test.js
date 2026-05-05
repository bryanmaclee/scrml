/**
 * emit-logic.js — Nested Function Declaration Codegen Tests
 *
 * Tests for the `case "function-decl":` handler added to emitLogicNode.
 *
 * Bug: BUG-R13-002 — Nested function definitions were dropped during compilation.
 * emitLogicNode had no handler for "function-decl" nodes, falling through to
 * `default: return ""` and silently omitting the nested function from output.
 *
 * Fix: Added `case "function-decl":` to emitLogicNode that emits a standard JS
 * function declaration, recursing into the body via emitLogicNode.
 *
 * Coverage:
 *   §1  Simple nested function with no params emits function declaration
 *   §2  Nested function with params emits correct param list
 *   §3  Nested function with multiple params
 *   §4  Nested function body with return statement
 *   §5  Nested function body with reactive read (@var)
 *   §6  Nested function body with if statement
 *   §7  Parent function body contains nested function followed by call
 *   §8  Two nested functions in same parent body
 *   §9  Deeply nested (function inside function inside function)
 *   §10 Nested function with no body emits empty function
 *   §11 Generator function (isGenerator: true) emits function*
 *   §12 Param as object with .name property (TAB param shape)
 *   §13 htmx-forms pattern: checkRequired inside validateForm
 *   §14 typescript-forms pattern: checkLength + checkNotEmpty inside validate
 *   §15 odin-gamelike pattern: applyDelta inside move
 *   §16 react-auth pattern: validate inside handleInput
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

function makeFnDecl(name, params, body, opts = {}) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    fnKind: opts.fnKind ?? "function",
    isServer: false,
    isGenerator: opts.isGenerator ?? false,
    canFail: false,
    span: { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function makeBareExpr(expr) {
  return { kind: "bare-expr", expr };
}

function makeLetDecl(name, init) {
  return { kind: "let-decl", name, init };
}

function makeReturnStmt(expr) {
  return { kind: "return-stmt", expr };
}

function makeIfStmt(condition, consequent) {
  return { kind: "if-stmt", condition, consequent };
}

function makeReactiveDecl(name, init) {
  return { kind: "state-decl", name, init };
}

// ---------------------------------------------------------------------------
// §1: Simple nested function with no params
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §1: simple nested function no params", () => {
  test("emits function declaration with empty param list", () => {
    resetAndRun(() => {
      const node = makeFnDecl("helper", [], [makeBareExpr("doSomething()")]);
      const result = emitLogicNode(node);
      expect(result).toContain("function helper()");
      expect(result).toContain("doSomething()");
    });
  });

  test("output starts with function keyword", () => {
    resetAndRun(() => {
      const node = makeFnDecl("helper", [], []);
      const result = emitLogicNode(node);
      expect(result.trim()).toMatch(/^function helper\(\)/);
    });
  });

  test("output ends with closing brace", () => {
    resetAndRun(() => {
      const node = makeFnDecl("helper", [], []);
      const result = emitLogicNode(node);
      expect(result.trim()).toMatch(/\}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// §2: Nested function with params
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §2: function with params", () => {
  test("single string param", () => {
    resetAndRun(() => {
      const node = makeFnDecl("check", ["field"], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function check(field)");
    });
  });

  test("single object param with .name", () => {
    resetAndRun(() => {
      const node = makeFnDecl("check", [{ name: "field" }], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function check(field)");
    });
  });
});

// ---------------------------------------------------------------------------
// §3: Multiple params
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §3: multiple params", () => {
  test("two string params", () => {
    resetAndRun(() => {
      const node = makeFnDecl("add", ["a", "b"], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function add(a, b)");
    });
  });

  test("three mixed params", () => {
    resetAndRun(() => {
      const node = makeFnDecl("checkRequired", [{ name: "field" }, { name: "label" }], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function checkRequired(field, label)");
    });
  });

  test("param fallback to _scrml_arg_N for unnamed", () => {
    resetAndRun(() => {
      const node = makeFnDecl("fn", [{}], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function fn(_scrml_arg_0)");
    });
  });
});

// ---------------------------------------------------------------------------
// §4: Body with return statement
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §4: return statement in body", () => {
  test("return with expression", () => {
    resetAndRun(() => {
      const node = makeFnDecl("isValid", ["x"], [makeReturnStmt("x > 0")]);
      const result = emitLogicNode(node);
      expect(result).toContain("return x > 0;");
    });
  });

  test("return null literal", () => {
    resetAndRun(() => {
      const node = makeFnDecl("getNull", [], [makeReturnStmt("null")]);
      const result = emitLogicNode(node);
      expect(result).toContain("return null;");
    });
  });
});

// ---------------------------------------------------------------------------
// §5: Body with reactive read
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §5: reactive var in body", () => {
  test("bare-expr with @reactive ref is rewritten", () => {
    resetAndRun(() => {
      const node = makeFnDecl("readName", [], [makeBareExpr("@name")]);
      const result = emitLogicNode(node);
      expect(result).toContain("_scrml_reactive_get");
      expect(result).toContain('"name"');
    });
  });
});

// ---------------------------------------------------------------------------
// §6: Body with if statement
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §6: if statement in body", () => {
  test("if statement emitted inside function", () => {
    resetAndRun(() => {
      const node = makeFnDecl(
        "check",
        ["x"],
        [makeIfStmt("x > 0", [makeReturnStmt("true")])]
      );
      const result = emitLogicNode(node);
      expect(result).toContain("function check(x)");
      expect(result).toContain("if (");
      expect(result).toContain("return true;");
    });
  });
});

// ---------------------------------------------------------------------------
// §7: Parent function contains nested function followed by call
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §7: nested fn + call in same parent body", () => {
  test("nested fn definition appears before the call to it", () => {
    resetAndRun(() => {
      // Simulates: function validate() { function check(x) { return x > 0 } check(@val) }
      const nestedFn = makeFnDecl("check", ["x"], [makeReturnStmt("x > 0")]);
      const call = makeBareExpr("check(@val)");
      const parent = makeFnDecl("validate", [], [nestedFn, call]);
      const result = emitLogicNode(parent);

      // Both definition and call must be present
      expect(result).toContain("function check(x)");
      expect(result).toContain("return x > 0;");
      expect(result).toContain("check");
      expect(result).toContain("_scrml_reactive_get");

      // Definition must precede the call in the output
      const defIndex = result.indexOf("function check(x)");
      const callIndex = result.lastIndexOf("check");
      // The last occurrence of "check" is the call (after the definition)
      expect(defIndex).toBeLessThan(callIndex);
    });
  });
});

// ---------------------------------------------------------------------------
// §8: Two nested functions in same parent body
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §8: two nested functions", () => {
  test("both functions are emitted", () => {
    resetAndRun(() => {
      const fn1 = makeFnDecl("helper1", [], [makeReturnStmt("1")]);
      const fn2 = makeFnDecl("helper2", [], [makeReturnStmt("2")]);
      const call1 = makeBareExpr("helper1()");
      const call2 = makeBareExpr("helper2()");
      const parent = makeFnDecl("parent", [], [fn1, fn2, call1, call2]);
      const result = emitLogicNode(parent);

      expect(result).toContain("function helper1()");
      expect(result).toContain("function helper2()");
      expect(result).toContain("return 1;");
      expect(result).toContain("return 2;");
    });
  });
});

// ---------------------------------------------------------------------------
// §9: Deeply nested (function inside function inside function)
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §9: deeply nested", () => {
  test("three levels deep emits all function declarations", () => {
    resetAndRun(() => {
      // innermost: function deep() { return 42 }
      const innermost = makeFnDecl("deep", [], [makeReturnStmt("42")]);
      // middle: function mid() { function deep() { return 42 } return deep() }
      const middle = makeFnDecl("mid", [], [innermost, makeReturnStmt("deep()")]);
      // outer: function outer() { function mid() { ... } return mid() }
      const outer = makeFnDecl("outer", [], [middle, makeReturnStmt("mid()")]);
      const result = emitLogicNode(outer);

      expect(result).toContain("function outer()");
      expect(result).toContain("function mid()");
      expect(result).toContain("function deep()");
      expect(result).toContain("return 42;");
    });
  });
});

// ---------------------------------------------------------------------------
// §10: Nested function with no body
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §10: empty body", () => {
  test("empty body array emits valid empty function", () => {
    resetAndRun(() => {
      const node = makeFnDecl("noop", [], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function noop()");
      // Should be a valid JS function declaration with empty body
      expect(result.trim()).toMatch(/function noop\(\) \{\s*\}/);
    });
  });

  test("null body emits valid empty function", () => {
    resetAndRun(() => {
      const node = { ...makeFnDecl("noop", [], []), body: null };
      const result = emitLogicNode(node);
      expect(result).toContain("function noop()");
      expect(result.trim()).toMatch(/function noop\(\) \{\s*\}/);
    });
  });
});

// ---------------------------------------------------------------------------
// §11: Generator function
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §11: generator function", () => {
  test("isGenerator true emits function*", () => {
    resetAndRun(() => {
      const node = makeFnDecl("gen", [], [makeBareExpr("yield 1")], { isGenerator: true });
      const result = emitLogicNode(node);
      expect(result).toContain("function* gen()");
    });
  });

  test("isGenerator false emits regular function", () => {
    resetAndRun(() => {
      const node = makeFnDecl("regular", [], [], { isGenerator: false });
      const result = emitLogicNode(node);
      expect(result).not.toContain("function*");
      expect(result).toContain("function regular()");
    });
  });
});

// ---------------------------------------------------------------------------
// §12: Param as object with .name property
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §12: object params", () => {
  test("param object with name property", () => {
    resetAndRun(() => {
      const node = makeFnDecl("fn", [{ name: "x", type: "number" }], []);
      const result = emitLogicNode(node);
      expect(result).toContain("function fn(x)");
    });
  });
});

// ---------------------------------------------------------------------------
// §13: htmx-forms pattern — checkRequired inside validateForm
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §13: htmx-forms pattern", () => {
  test("checkRequired inside validateForm is emitted", () => {
    resetAndRun(() => {
      // function validateForm() {
      //   function checkRequired(field, label) {
      //     if (field.length === 0) { return label + " is required" }
      //     return null
      //   }
      //   let nameErr = checkRequired(@name, "Name")
      //   @errors = [nameErr].filter(e => e !== null)
      //   return @errors.length === 0
      // }
      const checkRequired = makeFnDecl(
        "checkRequired",
        [{ name: "field" }, { name: "label" }],
        [
          makeIfStmt(
            "field.length === 0",
            [makeReturnStmt('label + " is required"')]
          ),
          makeReturnStmt("null"),
        ]
      );
      const letNameErr = makeLetDecl("nameErr", "checkRequired(@name, 'Name')");
      const errorsAssign = makeReactiveDecl("errors", "[nameErr].filter(e => e !== null)");
      const ret = makeReturnStmt("@errors.length === 0");

      const validateForm = makeFnDecl("validateForm", [], [checkRequired, letNameErr, errorsAssign, ret]);
      const result = emitLogicNode(validateForm);

      expect(result).toContain("function validateForm()");
      expect(result).toContain("function checkRequired(field, label)");
      expect(result).toContain("return null;");
      expect(result).toContain("let nameErr");
      expect(result).toContain("_scrml_reactive_set");
    });
  });
});

// ---------------------------------------------------------------------------
// §14: typescript-forms pattern — checkLength + checkNotEmpty inside validate
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §14: typescript-forms pattern", () => {
  test("checkLength and checkNotEmpty both emitted inside validate", () => {
    resetAndRun(() => {
      const checkLength = makeFnDecl(
        "checkLength",
        [{ name: "str" }, { name: "min" }],
        [makeReturnStmt("str.length >= min")]
      );
      const checkNotEmpty = makeFnDecl(
        "checkNotEmpty",
        [{ name: "str" }],
        [makeReturnStmt("checkLength(str, 1)")]
      );
      const validate = makeFnDecl("validate", [], [checkLength, checkNotEmpty, makeReturnStmt("checkNotEmpty('test')")]);
      const result = emitLogicNode(validate);

      expect(result).toContain("function checkLength(str, min)");
      expect(result).toContain("function checkNotEmpty(str)");
      expect(result).toContain("return str.length >= min;");
      expect(result).toContain("return checkLength(str, 1);");
    });
  });
});

// ---------------------------------------------------------------------------
// §15: odin-gamelike pattern — applyDelta inside move
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §15: odin-gamelike pattern", () => {
  test("applyDelta emitted inside move", () => {
    resetAndRun(() => {
      const applyDelta = makeFnDecl(
        "applyDelta",
        [{ name: "pos" }, { name: "delta" }],
        [makeReturnStmt("pos + delta")]
      );
      const move = makeFnDecl(
        "move",
        [{ name: "dir" }],
        [
          applyDelta,
          makeIfStmt("dir === 'North'", [makeReactiveDecl("y", "applyDelta(@y, -1)")]),
        ]
      );
      const result = emitLogicNode(move);

      expect(result).toContain("function move(dir)");
      expect(result).toContain("function applyDelta(pos, delta)");
      expect(result).toContain("return pos + delta;");
    });
  });
});

// ---------------------------------------------------------------------------
// §16: react-auth pattern — validate inside handleInput
// ---------------------------------------------------------------------------

describe("emit-logic nested-fn §16: react-auth pattern", () => {
  test("validate emitted inside handleInput", () => {
    resetAndRun(() => {
      const validate = makeFnDecl(
        "validate",
        [{ name: "v" }],
        [makeReturnStmt("v.length > 0")]
      );
      const setUsername = makeIfStmt("validate(value)", [makeReactiveDecl("username", "value")]);
      const handleInput = makeFnDecl("handleInput", [{ name: "value" }], [validate, setUsername]);
      const result = emitLogicNode(handleInput);

      expect(result).toContain("function handleInput(value)");
      expect(result).toContain("function validate(v)");
      expect(result).toContain("return v.length > 0;");
    });
  });
});
