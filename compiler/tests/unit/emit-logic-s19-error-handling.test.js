/**
 * emit-logic.js — §19 Error Handling Codegen Tests
 *
 * Tests for throw-stmt and guarded-expr cases in emitLogicNode, and for the
 * §19 built-in error type classes in scrml-runtime.js.
 *
 * Coverage:
 *   §1  throw-stmt — basic throw codegen
 *   §2  throw-stmt — auto new-prefix for constructor calls
 *   §3  throw-stmt — passes through non-constructor throws unchanged
 *   §4  throw-stmt — reactive ref in throw expression
 *   §5  guarded-expr — null guardedNode re-throws
 *   §6  guarded-expr — bare-expr guardedNode in try block
 *   §7  guarded-expr — let-decl guardedNode hoisted outside try block
 *   §8  guarded-expr — const-decl guardedNode hoisted outside try block
 *   §9  guarded-expr — wildcard arm produces else-branch handler
 *   §10 guarded-expr — named type arm produces instanceof check
 *   §11 guarded-expr — named type arm checks .type field (serialization)
 *   §12 guarded-expr — no wildcard arm produces else re-throw
 *   §13 guarded-expr — multiple arms emitted in order (if/else if/else)
 *   §14 guarded-expr — arm binding is declared as const in handler
 *   §15 guarded-expr — empty arms array re-throws
 *   §16 guarded-expr — arm handler with @reactive ref is rewritten
 *   §17 runtime — NetworkError extends Error with .type and .cause
 *   §18 runtime — ValidationError extends Error with .type
 *   §19 runtime — SQLError extends Error with .type
 *   §20 runtime — AuthError extends Error with .type
 *   §21 runtime — TimeoutError extends Error with .type
 *   §22 runtime — ParseError extends Error with .type
 *   §23 runtime — NotFoundError extends Error with .type
 *   §24 runtime — ConflictError extends Error with .type
 *   §25 runtime — error .cause defaults to null
 *   §26 runtime — error .cause is set from options
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeThrowStmt(expr) {
  return { kind: "throw-stmt", expr };
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

function makeArm(pattern, binding, handler) {
  return { pattern, binding, handler };
}

function makeGuardedExpr(guardedNode, arms) {
  return { kind: "guarded-expr", guardedNode, arms };
}

// ---------------------------------------------------------------------------
// Runtime class extraction
// ---------------------------------------------------------------------------

// Extract and evaluate just the §19 error type class definitions from the
// runtime template string. The full template references `window` and `document`
// which are unavailable in the test environment. We only need the error classes
// which have no DOM dependencies.
function extractRuntimeClasses() {
  // Find the section from _ScrmlError through the end of ConflictError class
  const match = SCRML_RUNTIME.match(
    /(class _ScrmlError[\s\S]*?class ConflictError[\s\S]*?\n\})/
  );
  if (!match) {
    throw new Error("Could not find §19 error class section in SCRML_RUNTIME");
  }
  const evalFn = new Function(`
    ${match[1]}
    return { _ScrmlError, NetworkError, ValidationError, SQLError, AuthError,
             TimeoutError, ParseError, NotFoundError, ConflictError };
  `);
  return evalFn();
}

let runtimeClasses;
let runtimeClassesError = null;
try {
  runtimeClasses = extractRuntimeClasses();
} catch (e) {
  runtimeClasses = null;
  runtimeClassesError = e;
}

// ⚑ S410 — THE PRECONDITION MUST FAIL LOUDLY, because 12 tests below guard with
// `if (!runtimeClasses) return;` and would otherwise pass HAVING ASSERTED NOTHING.
// That shape is live elsewhere in this repo: `browser-reactive-arrays.test.js`
// reported **35 pass / 0 fail with zero assertions executed** for exactly this
// reason, and `self-host-smoke.test.js` turns 12 real parity checks into silent
// no-ops the moment its module fails to load. The sibling `browser-todomvc.test.js`
// has the correct shape and is the model copied here: assert the precondition once,
// in its own test, so a broken harness is a RED, never a quieter green.
// This is currently PASSING (extraction succeeds); the assertion exists so that a
// future breakage cannot silently disable the 12 without anyone noticing.
describe("emit-logic §19 §0: harness precondition", () => {
  test("the runtime error classes were extracted (else the 12 guarded tests below are vacuous)", () => {
    if (runtimeClassesError) {
      throw new Error(
        `extractRuntimeClasses() threw, so 12 tests in this file would silently ` +
        `early-return and pass without asserting anything: ${runtimeClassesError.message}`,
      );
    }
    expect(runtimeClasses).not.toBeNull();
    expect(typeof runtimeClasses._ScrmlError).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// §1-§4: throw-stmt
// ---------------------------------------------------------------------------

describe("emit-logic §19 §1: throw-stmt basic", () => {
  test("throws with new-prefix for ErrorType constructor", () => {
    const node = makeThrowStmt("NetworkError(\"connection failed\")");
    const result = emitLogicNode(node);
    expect(result).toBe("throw new NetworkError(\"connection failed\");");
  });

  test("emits throw statement (not return)", () => {
    const node = makeThrowStmt("ValidationError(\"invalid\")");
    const result = emitLogicNode(node);
    expect(result).toContain("throw ");
    expect(result).not.toContain("return ");
  });
});

describe("emit-logic §19 §2: throw-stmt auto new-prefix", () => {
  test("uppercase constructor gets new prefix added", () => {
    const node = makeThrowStmt("AuthError(\"forbidden\")");
    const result = emitLogicNode(node);
    expect(result).toContain("throw new AuthError");
  });

  test("already-prefixed new is not doubled", () => {
    const node = makeThrowStmt("new ParseError(\"bad input\")");
    const result = emitLogicNode(node);
    expect(result).not.toContain("throw new new");
    expect(result).toContain("throw new ParseError");
  });

  test("all 8 built-in types get new prefix", () => {
    const types = [
      "NetworkError", "ValidationError", "SQLError", "AuthError",
      "TimeoutError", "ParseError", "NotFoundError", "ConflictError"
    ];
    for (const t of types) {
      const node = makeThrowStmt(`${t}("msg")`);
      const result = emitLogicNode(node);
      expect(result).toBe(`throw new ${t}("msg");`);
    }
  });
});

describe("emit-logic §19 §3: throw-stmt non-constructor passthrough", () => {
  test("lowercase expression passed through without new", () => {
    const node = makeThrowStmt("someError");
    const result = emitLogicNode(node);
    expect(result).toBe("throw someError;");
  });

  test("throw expression with no parens passed through", () => {
    const node = makeThrowStmt("existingErrorObj");
    const result = emitLogicNode(node);
    expect(result).toBe("throw existingErrorObj;");
  });
});

describe("emit-logic §19 §4: throw-stmt reactive ref", () => {
  test("@reactive ref in throw expr is rewritten", () => {
    const node = makeThrowStmt("NetworkError(@errorMsg)");
    const result = emitLogicNode(node);
    expect(result).toContain("_scrml_reactive_get");
    expect(result).toContain('"errorMsg"');
  });
});

// ---------------------------------------------------------------------------
// §5: guarded-expr — null guardedNode
// ---------------------------------------------------------------------------

describe("emit-logic §19 §5: guarded-expr null guardedNode", () => {
  test("null guardedNode emits empty output", () => {
    // With the __scrml_error return-value model, a guarded-expr with no
    // guarded node has nothing to check, so codegen emits empty string.
    const node = makeGuardedExpr(null, [makeArm("_", "e", "null")]);
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §6: guarded-expr — bare-expr guardedNode (new __scrml_error model)
// ---------------------------------------------------------------------------

describe("emit-logic §19 §6: guarded-expr bare-expr guardedNode", () => {
  test("bare-expr initializer is captured to result var", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetch(url)"),
      [makeArm("_", "e", "console.error(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/let _scrml_\w+ = fetch\(url\)/);
  });

  test("__scrml_error check follows the initializer", () => {
    const node = makeGuardedExpr(
      makeBareExpr("doSomethingRisky()"),
      [makeArm("_", "e", "handleError(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    const initIdx = result.indexOf("doSomethingRisky");
    const checkIdx = result.indexOf("__scrml_error");
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeGreaterThan(initIdx);
  });
});

// ---------------------------------------------------------------------------
// §7: guarded-expr — let-decl guardedNode (new model)
// ---------------------------------------------------------------------------

describe("emit-logic §19 §7: guarded-expr let-decl guardedNode", () => {
  test("let-decl initializer captured to result var", () => {
    const node = makeGuardedExpr(
      makeLetDecl("data", "fetchData()"),
      [makeArm("_", "e", "null")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("fetchData()");
    expect(result).toMatch(/let _scrml_\w+ = fetchData\(\)/);
  });

  test("let-decl variable exposed via var after check", () => {
    const node = makeGuardedExpr(
      makeLetDecl("data", "fetchData()"),
      [makeArm("_", "e", "null")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("var data =");
  });

  test("result var is declared first (as initializer)", () => {
    const node = makeGuardedExpr(
      makeLetDecl("data", "fetchData()"),
      [makeArm("_", "e", "null")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    const letResultIdx = result.indexOf("let _scrml_");
    const ifIdx = result.indexOf("if (");
    expect(letResultIdx).toBeGreaterThanOrEqual(0);
    expect(letResultIdx).toBeLessThan(ifIdx);
  });
});

// ---------------------------------------------------------------------------
// §8: guarded-expr — const-decl guardedNode (new model)
// ---------------------------------------------------------------------------

describe("emit-logic §19 §8: guarded-expr const-decl guardedNode", () => {
  test("const-decl initializer captured to result var", () => {
    const node = makeGuardedExpr(
      makeConstDecl("resp", "http.get(url)"),
      [makeArm("_", "e", "null")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("http.get(url)");
  });

  test("const-decl variable exposed via var", () => {
    const node = makeGuardedExpr(
      makeConstDecl("resp", "http.get(url)"),
      [makeArm("_", "e", "null")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("var resp =");
  });
});

// ---------------------------------------------------------------------------
// §9: guarded-expr — wildcard arm
// ---------------------------------------------------------------------------

describe("emit-logic §19 §9: guarded-expr wildcard arm", () => {
  test("wildcard arm _ produces a catch handler block", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "handleError(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("handleError");
  });

  test("wildcard arm with _ binding does not emit binding const", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "_", "fallback()")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // No spurious `const _ = ...` emitted
    expect(result).not.toContain("const _ =");
  });

  test("wildcard arm with named binding emits const binding", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "err", "log(err)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("const err =");
  });
});

// ---------------------------------------------------------------------------
// §10-§11: guarded-expr — named type arm
// ---------------------------------------------------------------------------

describe("emit-logic §19 §10: guarded-expr named type arm variant check", () => {
  test("named arm emits .variant === 'VariantName' check", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchUser(id)"),
      [makeArm("::NetworkError", "e", "retry()")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain('.variant === "NetworkError"');
  });

  test("named arm uses if keyword", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchUser(id)"),
      [makeArm("::AuthError", "e", "redirectToLogin()")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/if\s*\(/);
  });
});

describe("emit-logic §19 §11: guarded-expr named type arm binds .data", () => {
  test("named arm binding reads .data from the error object", () => {
    const node = makeGuardedExpr(
      makeBareExpr("callServer()"),
      [makeArm("::NetworkError", "err", "retry()")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/const err = _scrml_\w+\.data;/);
  });
});

// ---------------------------------------------------------------------------
// §12: guarded-expr — no wildcard arm re-throws
// ---------------------------------------------------------------------------

describe("emit-logic §19 §12: guarded-expr no wildcard propagates", () => {
  // S142 gate-tail: the `return resultVar` error-propagation is only valid
  // INSIDE a function body (a top-level `${...}` !{} has no enclosing function,
  // so a bare `return` is `'return' outside of function` — invalid JS the emit
  // gate catches). These two tests exercise the in-function shape and so MUST
  // pass insideFunctionBody:true (a `!{}` that propagates via `return` only
  // makes sense inside a function). The top-level no-return shape is covered by
  // the companion test below.
  test("when no wildcard arm, unmatched errors return up to the enclosing ! (in fn)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("parse(text)"),
      [makeArm("::ParseError", "e", "handleParse(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    expect(result).toMatch(/else \{ return _scrml_\w+; \}/);
  });

  test("propagate uses the result variable holding the error (in fn)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("parse(text)"),
      [makeArm("::ParseError", "e", "handleParse(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    const m = result.match(/else \{ return (_scrml_\w+); \}/);
    expect(m).not.toBeNull();
  });

  test("at TOP-LEVEL ${...} (no enclosing fn) the no-wildcard case emits NO return", () => {
    const node = makeGuardedExpr(
      makeBareExpr("parse(text)"),
      [makeArm("::ParseError", "e", "handleParse(e)")]
    );
    // Default opts — no insideFunctionBody. A bare `return` here would be
    // invalid JS; the unhandled error stays in resultVar instead.
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/\breturn\b/);
  });
});

// ---------------------------------------------------------------------------
// §13: guarded-expr — multiple arms
// ---------------------------------------------------------------------------

describe("emit-logic §19 §13: guarded-expr multiple arms", () => {
  test("two named arms use if/else if with variant checks", () => {
    const node = makeGuardedExpr(
      makeBareExpr("apiCall()"),
      [
        makeArm("::NetworkError", "e", "retry()"),
        makeArm("::AuthError", "e", "reauth()"),
      ]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("else if (");
    expect(result).toContain('.variant === "NetworkError"');
    expect(result).toContain('.variant === "AuthError"');
  });

  test("named arm followed by wildcard arm uses else block", () => {
    const node = makeGuardedExpr(
      makeBareExpr("apiCall()"),
      [
        makeArm("::NetworkError", "e", "retry()"),
        makeArm("_", "e", "showError(e)"),
      ]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("if (");
    expect(result).toContain("else {");
    // No propagate since wildcard handles all remaining variants
    expect(result).not.toMatch(/else \{ return _scrml_\w+; \}/);
  });
});

// ---------------------------------------------------------------------------
// §14: guarded-expr — arm binding
// ---------------------------------------------------------------------------

describe("emit-logic §19 §14: guarded-expr arm binding reads .data", () => {
  test("named arm binding is declared as const = resultVar.data", () => {
    const node = makeGuardedExpr(
      makeBareExpr("getResource()"),
      [makeArm("::NotFoundError", "err", "handle404(err)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/const err = _scrml_\w+\.data;/);
  });
});

// ---------------------------------------------------------------------------
// §15: guarded-expr — empty arms
// ---------------------------------------------------------------------------

describe("emit-logic §19 §15: guarded-expr empty arms propagate", () => {
  test("empty arms array emits a bare propagate (return resultVar) inside the check (in fn)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("risky()"),
      []
    );
    // S142 gate-tail: the bare-propagate `return resultVar` is in-function-only
    // (top-level would be invalid JS); pass insideFunctionBody:true.
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    expect(result).toContain("__scrml_error");
    expect(result).toMatch(/return _scrml_\w+;/);
  });

  test("empty arms array at TOP-LEVEL emits the __scrml_error check with NO return", () => {
    const node = makeGuardedExpr(
      makeBareExpr("risky()"),
      []
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("__scrml_error");
    expect(result).not.toMatch(/\breturn\b/);
  });
});

// ---------------------------------------------------------------------------
// §16: guarded-expr — reactive ref in arm handler
// ---------------------------------------------------------------------------

describe("emit-logic §19 §16: guarded-expr arm handler reactive ref", () => {
  test("arm handler with @reactive ref is rewritten", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchData()"),
      [makeArm("_", "e", "setError(@lastError)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("_scrml_reactive_get");
    expect(result).toContain('"lastError"');
  });
});

// ---------------------------------------------------------------------------
// §17-§26: Runtime error type classes
// ---------------------------------------------------------------------------

// We test the runtime error types by evaluating the class definitions extracted
// from the SCRML_RUNTIME template string. The full template references `window`
// and `document` which are unavailable in the test environment — the error
// classes have no DOM dependencies and can be isolated.

describe("emit-logic §19 §17: runtime NetworkError", () => {
  test("NetworkError is constructable", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.NetworkError("connection refused");
    expect(err.message).toBe("connection refused");
  });

  test("NetworkError.type is 'NetworkError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.NetworkError("msg");
    expect(err.type).toBe("NetworkError");
  });

  test("NetworkError extends Error", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.NetworkError("msg");
    expect(err instanceof Error).toBe(true);
  });
});

describe("emit-logic §19 §18: runtime ValidationError", () => {
  test("ValidationError.type is 'ValidationError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.ValidationError("invalid field");
    expect(err.type).toBe("ValidationError");
  });
});

describe("emit-logic §19 §19: runtime SQLError", () => {
  test("SQLError.type is 'SQLError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.SQLError("constraint violated");
    expect(err.type).toBe("SQLError");
  });
});

describe("emit-logic §19 §20: runtime AuthError", () => {
  test("AuthError.type is 'AuthError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.AuthError("unauthorized");
    expect(err.type).toBe("AuthError");
  });
});

describe("emit-logic §19 §21: runtime TimeoutError", () => {
  test("TimeoutError.type is 'TimeoutError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.TimeoutError("request timed out");
    expect(err.type).toBe("TimeoutError");
  });
});

describe("emit-logic §19 §22: runtime ParseError", () => {
  test("ParseError.type is 'ParseError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.ParseError("unexpected token");
    expect(err.type).toBe("ParseError");
  });
});

describe("emit-logic §19 §23: runtime NotFoundError", () => {
  test("NotFoundError.type is 'NotFoundError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.NotFoundError("resource not found");
    expect(err.type).toBe("NotFoundError");
  });
});

describe("emit-logic §19 §24: runtime ConflictError", () => {
  test("ConflictError.type is 'ConflictError'", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.ConflictError("duplicate key");
    expect(err.type).toBe("ConflictError");
  });
});

describe("emit-logic §19 §25: runtime error .cause defaults to null", () => {
  test("error constructed without options has .cause = null", () => {
    if (!runtimeClasses) return;
    const err = new runtimeClasses.NetworkError("msg");
    expect(err.cause).toBeNull();
  });
});

describe("emit-logic §19 §26: runtime error .cause from options", () => {
  test("error constructed with cause option has .cause set", () => {
    if (!runtimeClasses) return;
    const original = new Error("original");
    const err = new runtimeClasses.NetworkError("wrapped", { cause: original });
    expect(err.cause).toBe(original);
  });
});
