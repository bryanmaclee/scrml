/**
 * lin-decl emission integration test — Phase 2 Slice 1
 *
 * Verifies that `lin x = expr` produces a `lin-decl` AST node and that
 * the code generator emits `const x = ...` (not empty string, not bare-expr).
 *
 * Before this slice: `lin x = "hello"` produced:
 *   - bare-expr("lin") — dropped by emit-logic.ts line 246 (bare identifier guard)
 *   - tilde-decl("x", init: '"hello"') — emitted as `const x = "hello"`
 *   (The variable did appear in JS output, but only incidentally via tilde-decl;
 *    checkLinear never saw a lin-decl node, so lin enforcement was bypassed entirely.)
 *
 * After this slice: `lin x = "hello"` produces:
 *   - lin-decl("x", init: '"hello"', initExpr: ...) — emitted as `const x = "hello"`
 *   Now checkLinear receives lin-decl nodes (Slice 2 enables enforcement).
 *
 * @see docs/changes/expr-ast-phase-2-slice-1/anomaly-report.md
 * @see compiler/src/ast-builder.js (lin-decl guard added before tilde-decl)
 * @see compiler/src/codegen/emit-logic.ts (case "lin-decl")
 * @see §35.2 SPEC.md — lin variable declarations
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const projectRoot = resolve(testDir, "..", "..", "..");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Compile a scrml source string through BS → TAB and return the AST.
 * Uses a synthetic filePath for span/error reporting.
 */
function parseToAST(scrmlSource, fileName = "lin-test.scrml") {
  const filePath = resolve(testDir, fileName);
  const bsOutput = splitBlocks(filePath, scrmlSource);
  const { ast, errors } = buildAST(bsOutput);
  return { ast, errors, nodes: ast?.nodes ?? [] };
}

/** Recursively walk an array of AST nodes and collect all with given kind. */
function collectByKind(nodes, kind) {
  const results = [];
  if (!Array.isArray(nodes)) return results;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === kind) results.push(node);
    // Recurse into all array-valued properties that contain AST nodes
    for (const key of Object.keys(node)) {
      if (key === "span" || key === "id" || key === "attrs") continue;
      const val = node[key];
      if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        if (first && typeof first === "object" && typeof first.kind === "string") {
          results.push(...collectByKind(val, kind));
        }
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Suite 1: AST shape — lin-decl emission from the parser
// ---------------------------------------------------------------------------

describe("lin-decl emission — AST shape", () => {
  test("lin x = expr produces a lin-decl node (not tilde-decl)", () => {
    // Minimal scrml: a div with a logic block containing lin x = "hello"
    const source = `<div>
  \${
    lin x = "hello";
    x
  }
</div>`;
    const { nodes, errors } = parseToAST(source);
    const fatalErrors = errors.filter(e => e.severity !== "warning" && !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);

    const allNodes = collectByKind(nodes, "lin-decl");
    expect(allNodes.length).toBeGreaterThanOrEqual(1);

    const linDecl = allNodes[0];
    expect(linDecl.kind).toBe("lin-decl");
    expect(linDecl.name).toBe("x");
    expect(linDecl.init).toBe('"hello"');
  });

  test("lin-decl node has initExpr (parallel ExprNode field)", () => {
    const source = `<div>
  \${
    lin token = fetchToken()
  }
</div>`;
    const { nodes, errors } = parseToAST(source);
    const fatalErrors = errors.filter(e => e.severity !== "warning" && !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);

    const allNodes = collectByKind(nodes, "lin-decl");
    expect(allNodes.length).toBeGreaterThanOrEqual(1);

    const linDecl = allNodes[0];
    expect(linDecl.initExpr).toBeDefined();
    // initExpr should be a structured ExprNode (object, not null/undefined)
    expect(typeof linDecl.initExpr).toBe("object");
  });

  test("lin x = expr does NOT produce a tilde-decl node for x", () => {
    const source = `<div>
  \${
    lin x = "hello"
  }
</div>`;
    const { nodes } = parseToAST(source);
    const tildeDecls = collectByKind(nodes, "tilde-decl");
    const xTildeDecl = tildeDecls.find(n => n.name === "x");
    expect(xTildeDecl).toBeUndefined();
  });

  test("lin x = expr does NOT produce a bare-expr('lin') node", () => {
    const source = `<div>
  \${
    lin x = "hello"
  }
</div>`;
    const { nodes } = parseToAST(source);
    const bareExprs = collectByKind(nodes, "bare-expr");
    const linBareExpr = bareExprs.find(n => (n.expr ?? "").trim() === "lin");
    expect(linBareExpr).toBeUndefined();
  });

  test("lin-decl has correct span (covers full declaration)", () => {
    const source = `<div>
  \${
    lin x = "hello"
  }
</div>`;
    const { nodes } = parseToAST(source);
    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBeGreaterThanOrEqual(1);
    const linDecl = linDecls[0];
    expect(linDecl.span).toBeDefined();
    expect(typeof linDecl.span.start).toBe("number");
    expect(typeof linDecl.span.end).toBe("number");
    expect(linDecl.span.end).toBeGreaterThan(linDecl.span.start);
  });

  test("bare lin not followed by IDENT = does not produce lin-decl", () => {
    // `lin` as a bare keyword (unusual) should not produce lin-decl — no crash.
    const source = `<div>
  \${
    lin
  }
</div>`;
    const { nodes } = parseToAST(source);
    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBe(0);
    // Should produce a bare-expr for the bare `lin` keyword (or drop it — no crash)
  });

  test("multiple lin declarations in one block all produce lin-decl nodes", () => {
    const source = `<div>
  \${
    lin a = fetchTokenA()
    lin b = fetchTokenB()
    use(a)
    use(b)
  }
</div>`;
    const { nodes, errors } = parseToAST(source);
    const fatalErrors = errors.filter(e => e.severity !== "warning" && !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);

    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBeGreaterThanOrEqual(2);

    const names = linDecls.map(n => n.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  test("lin-decl emitted in both parse loops (top-level logic body)", () => {
    // Top-level ${ } logic is parsed by the outer parseLogicBody loop.
    // Function-body ${ } uses parseRecursiveBody.
    // Both must emit lin-decl. This test exercises the outer loop.
    const source = `\${
  lin x = "hello"
  console.log(x)
}`;
    const { nodes, errors } = parseToAST(source);
    // No crash — lin-decl emitted
    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBeGreaterThanOrEqual(1);
    expect(linDecls[0].name).toBe("x");
  });

  test("lin-decl emitted inside function body (recursive parse loop)", () => {
    // Function body uses parseRecursiveBody (the inner loop).
    const source = `\${
  function testFn() {
    lin token = getToken()
    return use(token)
  }
}`;
    const { nodes, errors } = parseToAST(source);
    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBeGreaterThanOrEqual(1);
    expect(linDecls[0].name).toBe("token");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Code generation — JS output from lin-decl
// ---------------------------------------------------------------------------

describe("lin-decl emission — JS codegen output", () => {
  test("lin x = 'hello' emits const x = 'hello' in client JS", () => {
    const tmpInput = resolve(testDir, "_tmp_lin_codegen.scrml");
    const scrmlSource = `<div>
  \${
    lin x = "hello"
    console.log(x)
  }
  <p>test</p>
</div>
`;
    try {
      writeFileSync(tmpInput, scrmlSource);
      const result = compileScrml({
        inputFiles: [tmpInput],
        write: false,
        outputDir: resolve(testDir, "_tmp_lin_out"),
      });

      // E-LIN-001 is expected (lin var not lin-ref consumed — Slice 2 adds that)
      const crashErrors = result.errors.filter(e => !e.code?.startsWith("W-") && e.code !== "E-LIN-001");
      expect(crashErrors).toHaveLength(0);

      // Find the output for our file
      let clientJs = null;
      for (const [fp, output] of result.outputs) {
        if (fp.includes("_tmp_lin_codegen")) {
          clientJs = output.clientJs ?? output.libraryJs ?? null;
        }
      }

      expect(clientJs).not.toBeNull();
      // Must contain `const x = "hello"` — the lin-decl emission
      expect(clientJs).toMatch(/const x = "hello"/);
    } finally {
      if (existsSync(tmpInput)) rmSync(tmpInput);
    }
  });

  test("lin x = expr produces declared variable in JS (regression guard)", () => {
    // Guards against any regression where lin variables become undeclared.
    // Before Slice 1: tilde-decl produced `const val = ...` incidentally.
    // After Slice 1: lin-decl produces `const val = ...` correctly.
    const tmpInput = resolve(testDir, "_tmp_lin_regression.scrml");
    const scrmlSource = `<div>
  \${
    lin val = "test-value"
    console.log(val)
  }
  <p>test</p>
</div>
`;
    try {
      writeFileSync(tmpInput, scrmlSource);
      const result = compileScrml({
        inputFiles: [tmpInput],
        write: false,
        outputDir: resolve(testDir, "_tmp_lin_out2"),
      });

      let clientJs = null;
      for (const [fp, output] of result.outputs) {
        if (fp.includes("_tmp_lin_regression")) {
          clientJs = output.clientJs ?? output.libraryJs ?? null;
        }
      }

      expect(clientJs).not.toBeNull();
      // The variable declaration must appear in the output
      expect(clientJs).toMatch(/const val/);
    } finally {
      if (existsSync(tmpInput)) rmSync(tmpInput);
    }
  });

  test("lin-decl with complex expression emits correctly", () => {
    const tmpInput = resolve(testDir, "_tmp_lin_complex.scrml");
    const scrmlSource = `<div>
  \${
    lin result = fetch("https://example.com/api")
    process(result)
  }
  <p>test</p>
</div>
`;
    try {
      writeFileSync(tmpInput, scrmlSource);
      const result = compileScrml({
        inputFiles: [tmpInput],
        write: false,
        outputDir: resolve(testDir, "_tmp_lin_out3"),
      });

      let clientJs = null;
      for (const [fp, output] of result.outputs) {
        if (fp.includes("_tmp_lin_complex")) {
          clientJs = output.clientJs ?? output.libraryJs ?? null;
        }
      }

      expect(clientJs).not.toBeNull();
      expect(clientJs).toMatch(/const result/);
    } finally {
      if (existsSync(tmpInput)) rmSync(tmpInput);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3: checkLinear compatibility — Slice 2 preconditions
// ---------------------------------------------------------------------------

describe("lin-decl emission — checkLinear preconditions", () => {
  test("lin-decl node shape matches what checkLinear expects", () => {
    // checkLinear dispatches on node.kind === "lin-decl" (type-system.ts line 3656).
    // Verifies the emitted node has the correct shape — kind, name, span.
    // Does NOT invoke checkLinear directly (that's Slice 2).
    const source = `<div>
  \${
    lin token = fetchToken()
    useToken(token)
  }
</div>`;
    const { nodes } = parseToAST(source);
    const linDecls = collectByKind(nodes, "lin-decl");
    expect(linDecls.length).toBeGreaterThanOrEqual(1);

    // Shape expected by checkLinear (type-system.ts lt.declare(node.name)):
    const node = linDecls[0];
    expect(node.kind).toBe("lin-decl");
    expect(typeof node.name).toBe("string");
    expect(node.name.length).toBeGreaterThan(0);
    expect(node.span).toBeDefined();
    expect(typeof node.span.start).toBe("number");
  });
});
