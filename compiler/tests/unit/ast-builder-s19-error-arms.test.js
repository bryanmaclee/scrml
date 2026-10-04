/**
 * AST Builder — §19 Error Arm Parsing Tests
 *
 * Tests for the simplified `TypeName => handler` arm syntax in parseErrorTokens.
 * The simplified form is a short-hand alternative to the pipe form:
 *
 *   Pipe form (existing):    `| ::NetworkError e -> handler`
 *   Simplified form (new):   `NetworkError => handler`
 *
 * Both forms produce the same arm shape:
 *   { pattern: "::TypeName", binding: "e", handler: "..." }
 *
 * The codegen (emit-logic.ts: case "guarded-expr") handles both forms identically.
 *
 * Coverage:
 *   §1  simplified arm — single type arm produces correct pattern and binding
 *   §2  simplified arm — implicit binding is always "e"
 *   §3  simplified arm — handler body is captured correctly
 *   §4  simplified arm — reactive assignment handler (@err = e)
 *   §5  simplified arm — wildcard `_` produces pattern "_"
 *   §6  simplified arm — multiple arms produce correct array
 *   §7  simplified arm — multiple arms stop at next arm start
 *   §8  simplified arm — wildcard arm at end of multi-arm list
 *   §9  simplified arm — mixed pipe and simplified arms coexist
 *   §10 simplified arm — guarded-expr node is produced correctly
 *   §11 simplified arm — arm has a span
 *   §12 simplified arm — all 8 built-in error types are recognized
 *   §13 pipe arm — existing pipe syntax still works (regression guard)
 *   §14 pipe arm — pipe syntax with binding still works
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

/**
 * Parse a source with a logic block containing `expr !{ armsSource }` and
 * return the arms array from the resulting guarded-expr node.
 *
 * Source pattern: ${ expr !{ ...armsSource... } }
 */
function parseErrorArms(expr, armsSource) {
  const source = `\${ ${expr} !{ ${armsSource} } }`;
  const { ast } = parse(source);
  const logic = ast.nodes[0];
  const ge = logic.body.find(n => n.kind === "guarded-expr");
  return { ge, arms: ge ? ge.arms : null };
}

// ---------------------------------------------------------------------------
// §1: simplified arm — single type arm pattern
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §1: single type arm pattern", () => {
  test("NetworkError => handler produces pattern ::NetworkError", () => {
    const { arms } = parseErrorArms("fetch(url)", "NetworkError => null");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("::NetworkError");
  });

  test("ValidationError => handler produces pattern ::ValidationError", () => {
    const { arms } = parseErrorArms("validate(x)", "ValidationError => null");
    expect(arms[0].pattern).toBe("::ValidationError");
  });
});

// ---------------------------------------------------------------------------
// §2: simplified arm — implicit binding is always "e"
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §2: implicit binding", () => {
  test("simplified arm binding is e (implicit)", () => {
    const { arms } = parseErrorArms("call()", "NetworkError => handleErr(e)");
    expect(arms[0].binding).toBe("e");
  });

  // S452 — a pipe-less `_ =>` is the §18.2 wildcard arm, parsed by the same
  // path as `| _ =>`, and binds NOTHING (§19.4.3 S451: "`| _ :>` and
  // `| else :>` still bind nothing"; the whole-error binder is the explicit
  // `_ err`). Pre-S452 the short-form path gave it an implicit `e`.
  test("wildcard _ arm binds nothing (S452: same as `| _ =>`)", () => {
    const { arms } = parseErrorArms("call()", "_ => fallback()");
    expect(arms[0].pattern).toBe("_");
    expect(arms[0].binding).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §3: simplified arm — handler body capture
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §3: handler body", () => {
  test("simple function call handler is captured", () => {
    const { arms } = parseErrorArms("call()", "NetworkError => handleErr(e)");
    expect(arms[0].handler).toBe("handleErr ( e )");
  });

  test("null literal handler is captured", () => {
    const { arms } = parseErrorArms("call()", "NetworkError => null");
    expect(arms[0].handler).toBe("null");
  });

  test("return statement handler is captured", () => {
    const { arms } = parseErrorArms("call()", "NetworkError => return");
    expect(arms[0].handler).toBe("return");
  });
});

// ---------------------------------------------------------------------------
// §4: simplified arm — reactive assignment handler (task example)
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §4: reactive assignment handler", () => {
  test("NetworkError => @err = e captures handler correctly", () => {
    const { arms } = parseErrorArms("serverCall()", "NetworkError => @err = e");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[0].binding).toBe("e");
    // Handler contains the reactive assignment
    expect(arms[0].handler).toContain("@err");
    expect(arms[0].handler).toContain("=");
    expect(arms[0].handler).toContain("e");
  });
});

// ---------------------------------------------------------------------------
// §5: simplified arm — wildcard _
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §5: wildcard _ arm", () => {
  test("_ => handler produces pattern _", () => {
    const { arms } = parseErrorArms("call()", "_ => fallback()");
    expect(arms[0].pattern).toBe("_");
  });

  test("wildcard arm still captures handler body", () => {
    const { arms } = parseErrorArms("call()", "_ => fallback(e)");
    expect(arms[0].handler).toBe("fallback ( e )");
  });
});

// ---------------------------------------------------------------------------
// §6: simplified arm — multiple arms
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §6: multiple arms", () => {
  test("two simplified arms produce correct array length", () => {
    const { arms } = parseErrorArms(
      "fetch(url)",
      "NetworkError => retry() AuthError => login()"
    );
    expect(arms.length).toBe(2);
  });

  test("multiple arms have correct patterns in order", () => {
    const { arms } = parseErrorArms(
      "fetch(url)",
      "NetworkError => retry() AuthError => login()"
    );
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[1].pattern).toBe("::AuthError");
  });

  test("multiple arms each have implicit binding e", () => {
    const { arms } = parseErrorArms(
      "fetch(url)",
      "NetworkError => retry() AuthError => login()"
    );
    expect(arms[0].binding).toBe("e");
    expect(arms[1].binding).toBe("e");
  });
});

// ---------------------------------------------------------------------------
// §7: simplified arm — arms stop at next arm start
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §7: handler terminus at next arm", () => {
  test("first arm handler does not bleed into second arm", () => {
    const { arms } = parseErrorArms(
      "apiCall()",
      "NetworkError => retry() SQLError => rollback()"
    );
    // First arm handler should be just "retry ( )" — not include SQLError
    expect(arms[0].handler).not.toContain("SQLError");
    expect(arms[0].handler).toBe("retry ( )");
  });

  test("second arm handler is correctly isolated", () => {
    const { arms } = parseErrorArms(
      "apiCall()",
      "NetworkError => retry() SQLError => rollback()"
    );
    expect(arms[1].handler).toBe("rollback ( )");
    expect(arms[1].pattern).toBe("::SQLError");
  });
});

// ---------------------------------------------------------------------------
// §8: simplified arm — wildcard at end of multi-arm list
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §8: wildcard at end", () => {
  test("wildcard arm at end of multi-arm list is parsed correctly", () => {
    const { arms } = parseErrorArms(
      "fetch(url)",
      "NetworkError => retry() _ => showError(e)"
    );
    expect(arms.length).toBe(2);
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[1].pattern).toBe("_");
  });

  test("wildcard handler at end captures its body", () => {
    const { arms } = parseErrorArms(
      "fetch(url)",
      "NetworkError => retry() _ => showError(e)"
    );
    expect(arms[1].handler).toBe("showError ( e )");
  });
});

// ---------------------------------------------------------------------------
// §9: simplified arm — mixed pipe and simplified arms
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §9: mixed pipe and simplified arms", () => {
  test("pipe arm followed by simplified arm both parse correctly", () => {
    const { arms } = parseErrorArms(
      "call()",
      "| ::NetworkError e -> retry() ValidationError => showMsg(e)"
    );
    expect(arms.length).toBe(2);
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[1].pattern).toBe("::ValidationError");
  });

  test("simplified arm followed by pipe arm both parse correctly", () => {
    const { arms } = parseErrorArms(
      "call()",
      "NetworkError => retry() | ::AuthError e -> login()"
    );
    expect(arms.length).toBe(2);
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[1].pattern).toBe("::AuthError");
  });
});

// ---------------------------------------------------------------------------
// §10: simplified arm — guarded-expr node is produced
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §10: guarded-expr node", () => {
  test("!{} with simplified arm produces guarded-expr node", () => {
    const { ge } = parseErrorArms("call()", "NetworkError => null");
    expect(ge).toBeDefined();
    expect(ge.kind).toBe("guarded-expr");
  });

  test("guarded-expr has guardedNode and arms", () => {
    const { ge } = parseErrorArms("call()", "NetworkError => null");
    expect(ge.guardedNode).toBeDefined();
    expect(Array.isArray(ge.arms)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11: simplified arm — arm has a span
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §11: arm span", () => {
  test("simplified arm has a span object", () => {
    const { arms } = parseErrorArms("call()", "NetworkError => null");
    expect(arms[0].span).toBeDefined();
    expect(typeof arms[0].span.start).toBe("number");
    expect(typeof arms[0].span.end).toBe("number");
    expect(typeof arms[0].span.file).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// §12: simplified arm — all 8 built-in error types
// ---------------------------------------------------------------------------

describe("ast-builder §19 simplified arm §12: all 8 built-in error types", () => {
  const builtins = [
    "NetworkError",
    "ValidationError",
    "SQLError",
    "AuthError",
    "TimeoutError",
    "ParseError",
    "NotFoundError",
    "ConflictError",
  ];

  for (const typeName of builtins) {
    test(`${typeName} => handler is recognized as simplified arm`, () => {
      const { arms } = parseErrorArms("call()", `${typeName} => null`);
      expect(arms).not.toBeNull();
      expect(arms.length).toBe(1);
      expect(arms[0].pattern).toBe(`::${typeName}`);
    });
  }
});

// ---------------------------------------------------------------------------
// §13-§14: pipe arm — regression guard
// ---------------------------------------------------------------------------

describe("ast-builder §19 pipe arm §13: existing pipe syntax regression guard", () => {
  test("| ::NetworkError e -> handler still works", () => {
    const { arms } = parseErrorArms("call()", "| ::NetworkError e -> null");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("::NetworkError");
  });

  test("| _ e -> handler still works (pipe wildcard)", () => {
    const { arms } = parseErrorArms("call()", "| _ e -> fallback()");
    expect(arms[0].pattern).toBe("_");
  });
});

describe("ast-builder §19 pipe arm §14: pipe arm binding", () => {
  test("pipe arm explicit binding is preserved", () => {
    const { arms } = parseErrorArms("call()", "| ::NetworkError err -> handle(err)");
    expect(arms[0].binding).toBe("err");
  });

  test("pipe arm handler is captured correctly", () => {
    const { arms } = parseErrorArms("call()", "| ::NetworkError e -> retry()");
    expect(arms[0].handler).toBe("retry ( )");
  });
});
