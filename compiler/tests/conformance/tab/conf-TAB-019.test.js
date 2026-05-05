// Conformance test for: Pipeline Stage 3 invariant
// "`@variable` assignments are represented as `ReactiveDecl` nodes."
// (SPEC §6.2: "@variable declarations SHALL be valid anywhere a value
//  assignment is valid: at file top-level, at the top of a state block,
//  inside a logic context `${ }`, and inside a function body.")
// (SPEC §6.2: "Implicit reactive variable creation on first assignment SHALL
//  NOT be supported. The compiler SHALL require an explicit declaration.")

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../../src/block-splitter.js";
import { buildAST } from "../../../src/ast-builder.js";

function run(src) {
  const bsOut = splitBlocks("test.scrml", src);
  return buildAST(bsOut);
}

describe("CONF-TAB-019: @variable assignment produces reactive-decl node", () => {
  test("@counter = 0 inside a logic block produces reactive-decl node", () => {
    const { ast } = run("${ @counter = 0; }");
    const logic = ast.nodes[0];
    const rNode = logic.body.find((n) => n.kind === "state-decl");
    expect(rNode).toBeDefined();
    expect(rNode.kind).toBe("state-decl");
    expect(rNode.name).toBe("counter");
  });

  test("reactive-decl carries the initial value as a string in `init`", () => {
    const { ast } = run("${ @count = 0; }");
    const logic = ast.nodes[0];
    const rNode = logic.body.find((n) => n.kind === "state-decl");
    expect(rNode).toBeDefined();
    expect(rNode.init).toBeDefined();
    expect(typeof rNode.init).toBe("string");
    expect(rNode.init.trim()).toBe("0");
  });

  test("reactive-decl has name without the @ sigil", () => {
    const { ast } = run("${ @myVar = 42; }");
    const logic = ast.nodes[0];
    const rNode = logic.body.find((n) => n.kind === "state-decl");
    expect(rNode).toBeDefined();
    expect(rNode.name).toBe("myVar");
    expect(rNode.name).not.toContain("@");
  });

  test("reactive-decl carries a valid span", () => {
    const { ast } = run("${ @x = 1; }");
    const logic = ast.nodes[0];
    const rNode = logic.body.find((n) => n.kind === "state-decl");
    expect(rNode.span).toBeDefined();
    expect(typeof rNode.span.start).toBe("number");
  });

  test("multiple reactive declarations each produce a reactive-decl node", () => {
    const { ast } = run("${ @a = 1; @b = 2; @c = 3; }");
    const logic = ast.nodes[0];
    const rNodes = logic.body.filter((n) => n.kind === "state-decl");
    expect(rNodes.length).toBe(3);
    const names = rNodes.map((n) => n.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toContain("c");
  });
});
