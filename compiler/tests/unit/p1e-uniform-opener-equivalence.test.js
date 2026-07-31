// P1.E.A — Uniform-opener equivalence: both `<id>` and `< id>` produce
// equivalent downstream AST shapes for every scrml lifecycle keyword.
//
// "Equivalent" here means: the AST node kind, lifecycle category, and
// canonical attributes match across the two opener forms. The
// `openerHadSpaceAfterLt` informational flag preserves which form the user wrote
// so NR can emit W-WHITESPACE-001.

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(src) {
  const bs = splitBlocks("test.scrml", src);
  const tab = buildAST(bs);
  return tab.ast;
}

describe("P1.E.A: uniform opener — db", () => {
  test("`<db tables=...>` (no-space) and `< db tables=...>` (with-space) both produce kind:state, stateType:db", () => {
    const a = build("<db src=\"x.db\" tables=\"users\"></>");
    const b = build("< db src=\"x.db\" tables=\"users\"></>");
    expect(a.nodes[0].kind).toBe("state");
    expect(a.nodes[0].stateType).toBe("db");
    expect(b.nodes[0].kind).toBe("state");
    expect(b.nodes[0].stateType).toBe("db");
  });

  test("self-closing forms also normalize", () => {
    const a = build("<db src=\"x.db\" tables=\"users\"/>");
    const b = build("< db src=\"x.db\" tables=\"users\"/>");
    expect(a.nodes[0].kind).toBe("state");
    expect(a.nodes[0].stateType).toBe("db");
    expect(b.nodes[0].kind).toBe("state");
    expect(b.nodes[0].stateType).toBe("db");
  });
});

describe("P1.E.A: uniform opener — schema", () => {
  test("both opener forms produce a schema state node (no typed-attr declarations)", () => {
    // Use a non-typed-attr opener — `name=Foo` has no `attr(Type)` parens, so this is a
    // state instantiation rather than a state-constructor-def. Both forms must normalize
    // to kind:state, stateType:schema.
    const a = build("<schema name=Foo/>");
    const b = build("< schema name=Foo/>");
    expect(a.nodes[0].kind).toBe("state");
    expect(a.nodes[0].stateType).toBe("schema");
    expect(b.nodes[0].kind).toBe("state");
    expect(b.nodes[0].stateType).toBe("schema");
  });
});

describe("P1.E.A: uniform opener — engine + machine", () => {
  test("`<engine name=Foo for=Bar>` (no-space) produces engine-decl AST", () => {
    const ast = build("<engine name=AdminFlow for=OrderStatus>\n  .Pending => .Done\n</>");
    expect(ast.nodes[0].kind).toBe("engine-decl");
    expect(ast.nodes[0].engineName).toBe("AdminFlow");
    expect(ast.nodes[0].governedType).toBe("OrderStatus");
  });

  test("`< engine name=Foo for=Bar>` (with-space) produces same engine-decl AST", () => {
    const ast = build("< engine name=AdminFlow for=OrderStatus>\n  .Pending => .Done\n</>");
    expect(ast.nodes[0].kind).toBe("engine-decl");
    expect(ast.nodes[0].engineName).toBe("AdminFlow");
    expect(ast.nodes[0].governedType).toBe("OrderStatus");
  });

  test("`<machine name=Foo for=Bar>` (no-space) also produces engine-decl AST AND emits E-DEPRECATED-001", () => {
    const bs = splitBlocks("test.scrml", "<machine name=AdminFlow for=OrderStatus>\n  .Pending => .Done\n</>");
    const tab = buildAST(bs);
    expect(tab.ast.nodes[0].kind).toBe("engine-decl");
    expect(tab.ast.nodes[0].engineName).toBe("AdminFlow");
    const codes = tab.errors.map(e => e.code);
    expect(codes).toContain("E-DEPRECATED-001");
  });

  test("`< machine ...>` and `<machine ...>` both emit E-DEPRECATED-001", () => {
    const ws = buildAST(splitBlocks("test.scrml", "< machine name=Foo for=Bar>\n  .a => .b\n</>"));
    const ns = buildAST(splitBlocks("test.scrml", "<machine name=Foo for=Bar>\n  .a => .b\n</>"));
    expect(ws.errors.some(e => e.code === "E-DEPRECATED-001")).toBe(true);
    expect(ns.errors.some(e => e.code === "E-DEPRECATED-001")).toBe(true);
  });
});

describe("P1.E.A: uniform opener — channel/timer/poll/request/errorBoundary", () => {
  test("`<channel name=...>` (no-space) and `< channel name=...>` (with-space) both produce kind:markup, tag:channel", () => {
    const a = build("<channel name=\"chat\" topic=\"general\"></>");
    const b = build("< channel name=\"chat\" topic=\"general\"></>");
    expect(a.nodes[0].kind).toBe("markup");
    expect(a.nodes[0].tag).toBe("channel");
    expect(b.nodes[0].kind).toBe("markup");
    expect(b.nodes[0].tag).toBe("channel");
  });

  test("timer forms equivalent", () => {
    const a = build("<timer interval=1000 running=@on></>");
    const b = build("< timer interval=1000 running=@on></>");
    expect(a.nodes[0].kind).toBe("markup");
    expect(a.nodes[0].tag).toBe("timer");
    expect(b.nodes[0].kind).toBe("markup");
    expect(b.nodes[0].tag).toBe("timer");
  });

  test("poll forms equivalent", () => {
    const a = build("<poll id=\"p1\" interval=2000></>");
    const b = build("< poll id=\"p1\" interval=2000></>");
    expect(a.nodes[0].kind).toBe("markup");
    expect(a.nodes[0].tag).toBe("poll");
    expect(b.nodes[0].kind).toBe("markup");
    expect(b.nodes[0].tag).toBe("poll");
  });

  test("errorBoundary forms equivalent", () => {
    const a = build("<errorBoundary></>");
    const b = build("< errorBoundary></>");
    expect(a.nodes[0].kind).toBe("markup");
    expect(a.nodes[0].tag).toBe("errorBoundary");
    expect(b.nodes[0].kind).toBe("markup");
    expect(b.nodes[0].tag).toBe("errorBoundary");
  });
});

describe("P1.E.A: uniform opener — non-lifecycle names are NOT normalized", () => {
  test("`<div>` (no-space) stays markup, `< div>` (with-space) stays state — only NR will reconcile via the registry", () => {
    const a = build("<div>x</>");
    const b = build("< div>x</>");
    expect(a.nodes[0].kind).toBe("markup");
    expect(a.nodes[0].tag).toBe("div");
    // `< div>` remains a state block at TAB level — NR is responsible for
    // emitting W-CASE-001 / W-WHITESPACE-001 and resolving the kind.
    expect(b.nodes[0].kind).toBe("state");
    expect(b.nodes[0].stateType).toBe("div");
  });

  test("`< addressCard addr(Address)>` (user state-constructor-def) stays state", () => {
    const ast = build("< addressCard addr(Address)></>");
    expect(ast.nodes[0].kind).toBe("state-constructor-def");
    expect(ast.nodes[0].stateType).toBe("addressCard");
  });

  test("`<UserCard>` PascalCase (component) stays markup", () => {
    const ast = build("<UserCard name=\"Alex\"/>");
    expect(ast.nodes[0].kind).toBe("markup");
    expect(ast.nodes[0].tag).toBe("UserCard");
    expect(ast.nodes[0].isComponent).toBe(true);
  });
});
