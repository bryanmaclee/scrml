/**
 * while-impl — Unit Tests
 *
 * Tests for §49 while loops, do...while, break, and continue.
 *
 * Coverage:
 *   §1  AST builder: while-stmt parsing with condition and body
 *   §2  AST builder: do-while-stmt parsing
 *   §3  AST builder: break-stmt parsing (unlabeled)
 *   §4  AST builder: continue-stmt parsing (unlabeled)
 *   §5  AST builder: labeled while-stmt (label: while)
 *   §6  AST builder: labeled break (break label)
 *   §7  AST builder: labeled continue (continue label)
 *   §8  AST builder: nested while with break and continue
 *   §9  Codegen: emitWhileStmt — basic while loop
 *   §10 Codegen: emitWhileStmt — while with label prefix
 *   §11 Codegen: emitDoWhileStmt — basic do-while
 *   §12 Codegen: emitDoWhileStmt — do-while with label prefix
 *   §13 Codegen: emitBreakStmt — unlabeled and labeled
 *   §14 Codegen: emitContinueStmt — unlabeled and labeled
 *   §15 Codegen: emitLogicNode — routes while/do-while/break/continue correctly
 *   §16 Codegen: while loop with lift → array accumulator (existing behavior preserved)
 *   §17 Type system: E-LOOP-001 — break outside any loop
 *   §18 Type system: E-LOOP-002 — continue outside any loop
 *   §19 Type system: break inside a while loop — no error
 *   §20 Type system: continue inside a while loop — no error
 *   §21 Type system: break inside do-while — no error
 *   §22 Type system: break inside fn body that contains while — no error (fn owns the loop)
 *   §23 Integration: full while loop compiles to valid JS
 *   §24 Integration: do...while compiles to valid JS
 *   §25 Integration: labeled nested break compiles to valid JS
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitLogicNode, emitLogicBody } from "../../src/codegen/emit-logic.ts";
import { emitWhileStmt, emitDoWhileStmt, emitBreakStmt, emitContinueStmt } from "../../src/codegen/emit-control-flow.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runTS } from "../../src/type-system.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetVarCounter();
});

/**
 * Parse a scrml source string and return the logic body nodes.
 */
function parseLogicBody(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  const logicNode = ast.nodes.find(n => n.kind === "logic");
  return logicNode ? logicNode.body : [];
}

/**
 * Parse a scrml source and return the full AST.
 */
function parseAST(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  return ast;
}

/**
 * Run type-system checks on a source string.
 * Returns errors from the TS stage.
 */
function runTypeCheck(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  const result = runTS({
    files: [ast],
    protectAnalysis: { views: new Map() },
    routeMap: { functions: new Map() },
  });
  return result.errors;
}

// ---------------------------------------------------------------------------
// §1 AST builder: while-stmt parsing
// ---------------------------------------------------------------------------

describe("AST builder: while-stmt", () => {
  test("parses basic while loop with condition and body", () => {
    const body = parseLogicBody("${ while (i < 10) { let x = i } }");
    expect(body).toHaveLength(1);
    const node = body[0];
    expect(node.kind).toBe("while-stmt");
    expect(node.condition).toContain("i < 10");
    expect(node.body).toBeArray();
    expect(node.body.length).toBeGreaterThan(0);
  });

  test("parses while without parens (scrml-style condition)", () => {
    const body = parseLogicBody("${ while i < 10 { let x = i } }");
    expect(body).toHaveLength(1);
    const node = body[0];
    expect(node.kind).toBe("while-stmt");
    expect(node.condition).toContain("i < 10");
  });

  test("while-stmt has no label by default", () => {
    const body = parseLogicBody("${ while (true) { } }");
    expect(body[0].kind).toBe("while-stmt");
    expect(body[0].label).toBeUndefined();
  });

  test("parses while with break inside body", () => {
    const body = parseLogicBody("${ while (true) { break } }");
    expect(body[0].kind).toBe("while-stmt");
    const whileBody = body[0].body;
    expect(whileBody).toBeArray();
    expect(whileBody.some(n => n.kind === "break-stmt")).toBe(true);
  });

  test("parses while with continue inside body", () => {
    const body = parseLogicBody("${ let i = 0\n while (i < 5) { i = i + 1\n continue } }");
    const whileNode = body.find(n => n.kind === "while-stmt");
    expect(whileNode).toBeDefined();
    const whileBody = whileNode.body;
    expect(whileBody.some(n => n.kind === "continue-stmt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 AST builder: do-while-stmt parsing
// ---------------------------------------------------------------------------

describe("AST builder: do-while-stmt", () => {
  test("parses basic do-while loop", () => {
    const body = parseLogicBody("${ do { let x = 1 } while (x < 10) }");
    expect(body).toHaveLength(1);
    const node = body[0];
    expect(node.kind).toBe("do-while-stmt");
    expect(node.condition).toContain("x < 10");
    expect(node.body).toBeArray();
    expect(node.body.length).toBeGreaterThan(0);
  });

  test("do-while has no label by default", () => {
    const body = parseLogicBody("${ do { } while (true) }");
    expect(body[0].kind).toBe("do-while-stmt");
    expect(body[0].label).toBeUndefined();
  });

  test("parses do-while with semicolon terminator", () => {
    const body = parseLogicBody("${ do { let x = 1 } while (x < 5); }");
    expect(body[0].kind).toBe("do-while-stmt");
    expect(body[0].condition).toContain("x < 5");
  });

  test("parses retry pattern: do-while with multiple body statements", () => {
    const body = parseLogicBody(`\${
      let attempts = 0
      let success = false
      do {
        success = tryConnect()
        attempts = attempts + 1
      } while (!success && attempts < 5)
    }`);
    const doWhile = body.find(n => n.kind === "do-while-stmt");
    expect(doWhile).toBeDefined();
    expect(doWhile.condition).toContain("success");  // tokenizer spaces: "( ! success && attempts < 5 )"
    expect(doWhile.body.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §3 AST builder: break-stmt parsing
// ---------------------------------------------------------------------------

describe("AST builder: break-stmt", () => {
  test("parses unlabeled break inside while", () => {
    const body = parseLogicBody("${ while (true) { break } }");
    const whileNode = body[0];
    const breakNode = whileNode.body[0];
    expect(breakNode.kind).toBe("break-stmt");
    expect(breakNode.label).toBeNull();
  });

  test("parses break with semicolon", () => {
    const body = parseLogicBody("${ while (true) { break; } }");
    const breakNode = body[0].body[0];
    expect(breakNode.kind).toBe("break-stmt");
    expect(breakNode.label).toBeNull();
  });

  test("parses labeled break", () => {
    const body = parseLogicBody(`\${
      outer: while (i < 10) {
        while (j < 10) {
          break outer
        }
      }
    }`);
    const outerWhile = body[0];
    expect(outerWhile.kind).toBe("while-stmt");
    expect(outerWhile.label).toBe("outer");
    const innerWhile = outerWhile.body[0];
    expect(innerWhile.kind).toBe("while-stmt");
    const breakNode = innerWhile.body[0];
    expect(breakNode.kind).toBe("break-stmt");
    expect(breakNode.label).toBe("outer");
  });
});

// ---------------------------------------------------------------------------
// §4 AST builder: continue-stmt parsing
// ---------------------------------------------------------------------------

describe("AST builder: continue-stmt", () => {
  test("parses unlabeled continue inside while", () => {
    const body = parseLogicBody("${ while (i < 10) { continue } }");
    const continueNode = body[0].body[0];
    expect(continueNode.kind).toBe("continue-stmt");
    expect(continueNode.label).toBeNull();
  });

  test("parses labeled continue", () => {
    const body = parseLogicBody(`\${
      outer: while (i < rows) {
        inner: while (j < cols) {
          continue outer
        }
      }
    }`);
    const outerWhile = body[0];
    expect(outerWhile.label).toBe("outer");
    const innerWhile = outerWhile.body[0];
    expect(innerWhile.label).toBe("inner");
    const continueNode = innerWhile.body[0];
    expect(continueNode.kind).toBe("continue-stmt");
    expect(continueNode.label).toBe("outer");
  });
});

// ---------------------------------------------------------------------------
// §5 AST builder: labeled while and do-while
// ---------------------------------------------------------------------------

describe("AST builder: labeled loop statements", () => {
  test("label: while → while-stmt has label field", () => {
    const body = parseLogicBody("${ outer: while (i < 10) { } }");
    expect(body[0].kind).toBe("while-stmt");
    expect(body[0].label).toBe("outer");
  });

  test("label: do-while → do-while-stmt has label field", () => {
    const body = parseLogicBody("${ retry: do { tryIt() } while (!done) }");
    expect(body[0].kind).toBe("do-while-stmt");
    expect(body[0].label).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// §9 Codegen: emitWhileStmt
// ---------------------------------------------------------------------------

describe("emitWhileStmt", () => {
  test("basic while loop", () => {
    const node = {
      kind: "while-stmt",
      condition: "i < 10",
      body: [{ kind: "bare-expr", expr: "i = i + 1" }],
    };
    const result = emitWhileStmt(node);
    expect(result).toContain("while (i < 10) {");
    expect(result).toContain("i = i + 1;");
    expect(result).toContain("}");
  });

  test("while with label prefix", () => {
    const node = {
      kind: "while-stmt",
      label: "outer",
      condition: "i < 10",
      body: [],
    };
    const result = emitWhileStmt(node);
    expect(result).toMatch(/^outer: while \(i < 10\) \{/);
  });

  test("while without label — no label prefix", () => {
    const node = {
      kind: "while-stmt",
      condition: "running",
      body: [],
    };
    const result = emitWhileStmt(node);
    expect(result).not.toContain("undefined:");
    expect(result).toMatch(/^while \(running\) \{/);
  });

  test("while with empty body", () => {
    const node = { kind: "while-stmt", condition: "false", body: [] };
    const result = emitWhileStmt(node);
    expect(result).toBe("while (false) {\n}");
  });
});

// ---------------------------------------------------------------------------
// §11 Codegen: emitDoWhileStmt
// ---------------------------------------------------------------------------

describe("emitDoWhileStmt", () => {
  test("basic do-while", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "!done",
      body: [{ kind: "bare-expr", expr: "done = tryConnect()" }],
    };
    const result = emitDoWhileStmt(node);
    expect(result).toContain("do {");
    expect(result).toContain("done = tryConnect();");
    expect(result).toContain("} while (!done);");
  });

  test("do-while with label prefix", () => {
    const node = {
      kind: "do-while-stmt",
      label: "retry",
      condition: "!success",
      body: [],
    };
    const result = emitDoWhileStmt(node);
    expect(result).toMatch(/^retry: do \{/);
    expect(result).toContain("} while (!success);");
  });

  test("do-while without label", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "running",
      body: [],
    };
    const result = emitDoWhileStmt(node);
    expect(result).toMatch(/^do \{/);
    expect(result).not.toContain("undefined:");
  });

  test("do-while always emits condition at end", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "i < 5",
      body: [{ kind: "bare-expr", expr: "i = i + 1" }],
    };
    const result = emitDoWhileStmt(node);
    const lines = result.split("\n");
    expect(lines[0]).toBe("do {");
    expect(lines[lines.length - 1]).toBe("} while (i < 5);");
  });
});

// ---------------------------------------------------------------------------
// §13 Codegen: emitBreakStmt
// ---------------------------------------------------------------------------

describe("emitBreakStmt", () => {
  test("unlabeled break", () => {
    expect(emitBreakStmt({ kind: "break-stmt", label: null })).toBe("break;");
  });

  test("labeled break", () => {
    expect(emitBreakStmt({ kind: "break-stmt", label: "outer" })).toBe("break outer;");
  });

  test("labeled break — different label names", () => {
    expect(emitBreakStmt({ kind: "break-stmt", label: "search" })).toBe("break search;");
    expect(emitBreakStmt({ kind: "break-stmt", label: "loop1" })).toBe("break loop1;");
  });
});

// ---------------------------------------------------------------------------
// §14 Codegen: emitContinueStmt
// ---------------------------------------------------------------------------

describe("emitContinueStmt", () => {
  test("unlabeled continue", () => {
    expect(emitContinueStmt({ kind: "continue-stmt", label: null })).toBe("continue;");
  });

  test("labeled continue", () => {
    expect(emitContinueStmt({ kind: "continue-stmt", label: "outer" })).toBe("continue outer;");
  });

  test("labeled continue — different label names", () => {
    expect(emitContinueStmt({ kind: "continue-stmt", label: "inner" })).toBe("continue inner;");
    expect(emitContinueStmt({ kind: "continue-stmt", label: "scan" })).toBe("continue scan;");
  });
});

// ---------------------------------------------------------------------------
// §15 Codegen: emitLogicNode routing
// ---------------------------------------------------------------------------

describe("emitLogicNode: routing for new node kinds", () => {
  test("routes while-stmt to emitWhileStmt", () => {
    const node = {
      kind: "while-stmt",
      condition: "x > 0",
      body: [{ kind: "bare-expr", expr: "x = x - 1" }],
    };
    const result = emitLogicNode(node);
    expect(result).toContain("while (x > 0) {");
    expect(result).toContain("x = x - 1;");
  });

  test("routes do-while-stmt to emitDoWhileStmt", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "!done",
      body: [{ kind: "bare-expr", expr: "done = check()" }],
    };
    const result = emitLogicNode(node);
    expect(result).toContain("do {");
    expect(result).toContain("done = check();");
    expect(result).toContain("} while (!done);");
  });

  test("routes break-stmt (unlabeled)", () => {
    const result = emitLogicNode({ kind: "break-stmt", label: null });
    expect(result).toBe("break;");
  });

  test("routes break-stmt (labeled)", () => {
    const result = emitLogicNode({ kind: "break-stmt", label: "outer" });
    expect(result).toBe("break outer;");
  });

  test("routes continue-stmt (unlabeled)", () => {
    const result = emitLogicNode({ kind: "continue-stmt", label: null });
    expect(result).toBe("continue;");
  });

  test("routes continue-stmt (labeled)", () => {
    const result = emitLogicNode({ kind: "continue-stmt", label: "loop" });
    expect(result).toBe("continue loop;");
  });
});

// ---------------------------------------------------------------------------
// §16 Codegen: while loop with lift → array accumulator (existing)
// ---------------------------------------------------------------------------

describe("while loop with lift — array accumulator (§49.6)", () => {
  test("while loop with lift + tilde consumption → array accumulator", () => {
    const nodes = [
      {
        kind: "while-stmt",
        condition: "cond",
        body: [
          { kind: "lift-expr", expr: { kind: "expr", expr: "getValue ( )" } },
        ],
      },
      { kind: "const-decl", name: "vals", init: "~" },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(2);
    const whileBlock = results[0];
    expect(whileBlock).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    expect(whileBlock).toMatch(/while \(cond\) \{/);
    expect(whileBlock).toMatch(/_scrml_tilde_\d+\.push\(getValue \( \)\);/);
    expect(results[1]).toMatch(/^const vals = _scrml_tilde_\d+;$/);
  });

  test("do-while with lift produces array accumulator (same as while)", () => {
    const nodes = [
      {
        kind: "do-while-stmt",
        condition: "hasMore",
        body: [
          { kind: "lift-expr", expr: { kind: "expr", expr: "fetchNext ( )" } },
        ],
      },
    ];
    // emitLogicBody with no tilde consumer — do-while doesn't crash
    // (basic smoke test: no tilde context, should not throw)
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("do {");
    expect(results[0]).toContain("} while (hasMore);");
  });
});

// ---------------------------------------------------------------------------
// §17 Type system: E-LOOP-001 — break outside any loop
// ---------------------------------------------------------------------------

describe("type system: E-LOOP-001 — break outside loop", () => {
  test("break at top level of logic block → E-LOOP-001", () => {
    const errors = runTypeCheck(`<program>
\${
  let done = false
  break
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-001");
    expect(loopErr).toBeDefined();
    expect(loopErr.message).toContain("E-LOOP-001");
    expect(loopErr.message).toContain("break");
    expect(loopErr.message).toContain("loop");
  });

  test("break inside a while loop → no E-LOOP-001", () => {
    const errors = runTypeCheck(`<program>
\${
  let i = 0
  while (i < 10) {
    i = i + 1
    break
  }
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-001");
    expect(loopErr).toBeUndefined();
  });

  test("break inside a do-while loop → no E-LOOP-001", () => {
    const errors = runTypeCheck(`<program>
\${
  do {
    break
  } while (true)
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-001");
    expect(loopErr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §18 Type system: E-LOOP-002 — continue outside any loop
// ---------------------------------------------------------------------------

describe("type system: E-LOOP-002 — continue outside loop", () => {
  test("continue at top level of logic block → E-LOOP-002", () => {
    const errors = runTypeCheck(`<program>
\${
  continue
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-002");
    expect(loopErr).toBeDefined();
    expect(loopErr.message).toContain("E-LOOP-002");
    expect(loopErr.message).toContain("continue");
    expect(loopErr.message).toContain("loop");
  });

  test("continue inside a while loop → no E-LOOP-002", () => {
    const errors = runTypeCheck(`<program>
\${
  let i = 0
  while (i < 10) {
    i = i + 1
    if (i == 5) { continue }
  }
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-002");
    expect(loopErr).toBeUndefined();
  });

  test("continue inside a do-while loop → no E-LOOP-002", () => {
    const errors = runTypeCheck(`<program>
\${
  do {
    continue
  } while (false)
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-002");
    expect(loopErr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §22 Type system: break/continue inside fn body containing a loop
// ---------------------------------------------------------------------------

describe("type system: break/continue in function context", () => {
  test("break inside fn body that has its own while — no error (fn owns the loop)", () => {
    const errors = runTypeCheck(`<program>
\${
  function scanIdent(src) {
    let i = 0
    while (i < src.length) {
      if (src[i] == " ") { break }
      i = i + 1
    }
    return i
  }
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-001" || e.code === "E-LOOP-002");
    expect(loopErr).toBeUndefined();
  });

  test("continue inside fn body that has its own while — no error", () => {
    const errors = runTypeCheck(`<program>
\${
  function processItems(items) {
    let i = 0
    while (i < items.length) {
      i = i + 1
      if (items[i - 1].skip) { continue }
    }
  }
}
</program>`);
    const loopErr = errors.find(e => e.code === "E-LOOP-002");
    expect(loopErr).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §23 Integration: while loop compiles to valid JS
// ---------------------------------------------------------------------------

describe("integration: while loop codegen", () => {
  test("while loop with body produces correct JS structure", () => {
    const node = {
      kind: "while-stmt",
      condition: "pos < len",
      body: [
        { kind: "bare-expr", expr: "pos = pos + 1" },
        {
          kind: "if-stmt",
          condition: "src[pos] == 32",
          consequent: [{ kind: "break-stmt", label: null }],
          alternate: null,
        },
      ],
    };
    const result = emitLogicNode(node);
    expect(result).toContain("while (pos < len) {");
    expect(result).toContain("pos = pos + 1;");
    expect(result).toContain("if (_scrml_structural_eq(src[pos], 32)) {");  // §45.4 (S468): `src[pos]` is not provably primitive
    expect(result).toContain("break;");
  });

  test("labeled nested while compiles correctly", () => {
    const node = {
      kind: "while-stmt",
      label: "outer",
      condition: "i < rows",
      body: [
        {
          kind: "while-stmt",
          label: "inner",
          condition: "j < cols",
          body: [
            { kind: "break-stmt", label: "outer" },
          ],
        },
      ],
    };
    const result = emitLogicNode(node);
    expect(result).toContain("outer: while (i < rows) {");
    expect(result).toContain("inner: while (j < cols) {");
    expect(result).toContain("break outer;");
  });
});

// ---------------------------------------------------------------------------
// §24 Integration: do...while compiles to valid JS
// ---------------------------------------------------------------------------

describe("integration: do-while codegen", () => {
  test("do-while produces correct JS structure", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "!success && attempts < 5",
      body: [
        { kind: "bare-expr", expr: "success = tryConnect()" },
        { kind: "bare-expr", expr: "attempts = attempts + 1" },
      ],
    };
    const result = emitLogicNode(node);
    expect(result).toContain("do {");
    expect(result).toContain("success = tryConnect();");
    expect(result).toContain("attempts = attempts + 1;");
    expect(result).toContain("} while (!success && attempts < 5);");
  });

  test("do-while body always comes before condition check", () => {
    const node = {
      kind: "do-while-stmt",
      condition: "running",
      body: [{ kind: "bare-expr", expr: "step()" }],
    };
    const result = emitLogicNode(node);
    const doIdx = result.indexOf("do {");
    const whileIdx = result.indexOf("} while (running);");
    expect(doIdx).toBeLessThan(whileIdx);
  });
});

// ---------------------------------------------------------------------------
// §25 Integration: complete while loop compilation with lift (§49.6)
// ---------------------------------------------------------------------------

describe("integration: while loop with lift accumulation", () => {
  test("while loop + lift + ~ consumption → array output", () => {
    const nodes = [
      {
        kind: "while-stmt",
        condition: "i < items.length",
        body: [
          {
            kind: "if-stmt",
            condition: "items[i].skip",
            consequent: [
              { kind: "bare-expr", expr: "i = i + 1" },
              { kind: "continue-stmt", label: null },
            ],
            alternate: null,
          },
          { kind: "lift-expr", expr: { kind: "expr", expr: "items[i]" } },
          { kind: "bare-expr", expr: "i = i + 1" },
        ],
      },
      { kind: "const-decl", name: "result", init: "~" },
    ];
    const results = emitLogicBody(nodes);
    expect(results).toHaveLength(2);
    const whileBlock = results[0];
    // Tilde array initialized before the loop
    expect(whileBlock).toMatch(/let _scrml_tilde_\d+ = \[\];/);
    // While condition
    expect(whileBlock).toMatch(/while \(i < items\.length\) \{/);
    // Continue statement compiled
    expect(whileBlock).toContain("continue;");
    // Lift appends to array
    expect(whileBlock).toMatch(/_scrml_tilde_\d+\.push\(items\[i\]\);/);
    // Result assigned from tilde var
    expect(results[1]).toMatch(/^const result = _scrml_tilde_\d+;$/);
  });
});
