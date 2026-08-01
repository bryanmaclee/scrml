/**
 * §51.3 Machine Declaration Parsing — AST Builder Unit Tests
 *
 * Tests that `< engine MachineName for TypeName { rules } />` produces
 * kind: "engine-decl" AST nodes with correct engineName, governedType,
 * and rulesRaw fields.
 */

import { describe, test, expect } from "bun:test";
import { buildAST } from "../../src/ast-builder.js";

// Helper: compile a .scrml snippet through BS + AST builder
function parseSnippet(source) {
  const { splitBlocks } = require("../../src/block-splitter.js");
  const bsOutput = splitBlocks("test.scrml", source);
  const result = buildAST(bsOutput);
  return result;
}

// Helper: find engine-decl nodes in AST (walks the full tree)
function findMachineDecls(result) {
  const results = [];
  function walk(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      if (!node) continue;
      if (node.kind === "engine-decl") results.push(node);
      if (node.children) walk(node.children);
    }
  }
  // buildAST returns { ast: { nodes }, errors }
  const nodes = result.ast?.nodes || result.nodes || [];
  walk(nodes);
  return results;
}

describe("§51.3 engine-decl parsing", () => {
  test("< engine> produces engine-decl AST node", () => {
    const source = `<program>
< engine name=UserFlow for=Column>
    .Todo => .InProgress
    .InProgress => .Done
</>
</program>`;
    const ast = parseSnippet(source);
    const machines = findMachineDecls(ast);
    expect(machines).toHaveLength(1);
    expect(machines[0].kind).toBe("engine-decl");
    expect(machines[0].engineName).toBe("UserFlow");
    expect(machines[0].governedType).toBe("Column");
  });

  test("rulesRaw contains the transition rules text", () => {
    const source = `<program>
< engine name=Flow for=Status>
    .A => .B
    .B => .C
</>
</program>`;
    const ast = parseSnippet(source);
    const machines = findMachineDecls(ast);
    expect(machines).toHaveLength(1);
    expect(machines[0].rulesRaw).toContain(".A => .B");
    expect(machines[0].rulesRaw).toContain(".B => .C");
  });

  test("machine with guards in rules", () => {
    const source = `<program>
< engine name=AdminFlow for=Column>
    .Done => .Todo given @isAdmin
</>
</program>`;
    const ast = parseSnippet(source);
    const machines = findMachineDecls(ast);
    expect(machines).toHaveLength(1);
    expect(machines[0].rulesRaw).toContain("given");
  });

  test("multiple machines produce multiple engine-decl nodes", () => {
    const source = `<program>
< engine name=UserFlow for=Status>
    .A => .B
</>
< engine name=AdminFlow for=Status>
    .A => .B
    .B => .A
</>
</program>`;
    const ast = parseSnippet(source);
    const machines = findMachineDecls(ast);
    expect(machines).toHaveLength(2);
    expect(machines[0].engineName).toBe("UserFlow");
    expect(machines[1].engineName).toBe("AdminFlow");
  });
});
