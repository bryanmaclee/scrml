/**
 * AST Builder — Structured Inline Match Arms
 *
 * Tests that the AST builder produces `match-arm-inline` nodes for
 * single-expression match arms (`.Variant => result`, `else => result`,
 * `not => result`, `"string" => result`), and that the codegen pipeline
 * handles them correctly end-to-end.
 *
 * Coverage:
 *   §1  AST: simple variant arm produces match-arm-inline node
 *   §2  AST: variant arm with payload binding
 *   §3  AST: variant arm with named binding (field: local)
 *   §4  AST: else wildcard arm
 *   §5  AST: not absence arm
 *   §6  AST: _ wildcard alias normalizes to else
 *   §7  AST: string literal arm (double-quoted)
 *   §8  AST: multiple inline arms on one line produce separate nodes
 *   §9  AST: mixed block + inline arms produce correct node kinds
 *  §10  AST: result expression is captured correctly
 *  §11  AST: resultExpr is populated (structured ExprNode)
 *  §12  AST: span is present
 *  §13  AST: legacy :: prefix produces match-arm-inline
 *  §14  E2E: single-line exhaustive match compiles without errors
 *  §15  E2E: inline match with payload binding compiles correctly
 *  §16  E2E: string literal match arms compile correctly
 *  §17  E2E: mixed inline + block arms compile correctly
 *  §18  E2E: non-exhaustive inline match reports E-TYPE-020
 *  §19  S27 regression: arm boundary detection works for OPERATOR => tokens
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

/**
 * Recursively find a node by kind in the AST tree (searches children too).
 */
function findNodeDeep(nodes, predicate) {
  for (const node of nodes) {
    if (!node) continue;
    if (predicate(node)) return node;
    if (node.children) {
      const found = findNodeDeep(node.children, predicate);
      if (found) return found;
    }
    if (node.body) {
      const found = findNodeDeep(node.body, predicate);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Parse a source containing a match expression and return the match body nodes.
 */
function parseMatchBody(matchSource) {
  const source = `<program>
\${
  type S:enum = { Loading, Ready(data: string), Error(msg: string) }
  @state: S = S.Loading
  let r = match @state { ${matchSource} }
}
<p>\${r}</p>
</program>`;
  const { ast, errors } = parse(source);
  const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
  const matchExpr = letDecl?.matchExpr;
  return { body: matchExpr?.body ?? [], errors };
}

const tmpRoot = resolve(tmpdir(), "scrml-match-arm-inline");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: outDir,
    });
    return {
      errors: (result.errors ?? []).filter(e => e.severity !== "warning"),
      output: result.outputFiles ?? [],
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1–§13: AST structure tests
// ---------------------------------------------------------------------------

describe("match-arm-inline AST structure", () => {
  test("§1 simple variant arm produces match-arm-inline node", () => {
    const { body } = parseMatchBody('.Loading => "loading" .Ready(data) => data else => "unknown"');
    const arm = body.find(n => n.kind === "match-arm-inline" && n.test === ".Loading");
    expect(arm).toBeDefined();
    expect(arm.kind).toBe("match-arm-inline");
    expect(arm.test).toBe(".Loading");
    expect(arm.result).toBe('"loading"');
  });

  test("§2 variant arm with payload binding", () => {
    const { body } = parseMatchBody('.Ready(data) => data .Loading => "wait" else => "?"');
    const arm = body.find(n => n.kind === "match-arm-inline" && n.test?.includes("Ready"));
    expect(arm).toBeDefined();
    expect(arm.test).toBe(".Ready(data)");
    expect(arm.binding).toBe("data");
    expect(arm.result).toBe("data");
  });

  test("§3 variant arm with named binding (field: local)", () => {
    const { body } = parseMatchBody('.Error(msg: m) => m .Loading => "wait" else => "?"');
    const arm = body.find(n => n.kind === "match-arm-inline" && n.test?.includes("Error"));
    expect(arm).toBeDefined();
    expect(arm.binding).toBe("msg : m");
    expect(arm.result).toBe("m");
  });

  test("§4 else wildcard arm", () => {
    const { body } = parseMatchBody('.Loading => "loading" else => "other"');
    const arm = body.find(n => n.kind === "match-arm-inline" && n.test === "else");
    expect(arm).toBeDefined();
    expect(arm.test).toBe("else");
    expect(arm.result).toBe('"other"');
  });

  test("§5 not absence arm", () => {
    // Use a simpler match without enum type constraint
    const source = `<program>
\${
  let x = null
  let r = match x { not => "absent" else => "present" }
}
<p>\${r}</p>
</program>`;
    const { ast } = parse(source);
    const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
    const matchBody = letDecl?.matchExpr?.body ?? [];
    const arm = matchBody.find(n => n.kind === "match-arm-inline" && n.test === "not");
    expect(arm).toBeDefined();
    expect(arm.test).toBe("not");
    expect(arm.result).toBe('"absent"');
  });

  test("§6 _ wildcard alias normalizes to else", () => {
    const source = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  let r = match @d { .A => "a" _ => "other" }
}
<p>\${r}</p>
</program>`;
    const { ast } = parse(source);
    const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
    const matchBody = letDecl?.matchExpr?.body ?? [];
    const arm = matchBody.find(n => n.kind === "match-arm-inline" && n.test === "else");
    expect(arm).toBeDefined();
    expect(arm.test).toBe("else"); // _ normalized to else
  });

  test("§7 string literal arm (double-quoted)", () => {
    const source = `<program>
\${
  let s = "hello"
  let r = match s { "hello" => "greeting" "bye" => "farewell" else => "unknown" }
}
<p>\${r}</p>
</program>`;
    const { ast } = parse(source);
    const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
    const matchBody = letDecl?.matchExpr?.body ?? [];
    const helloArm = matchBody.find(n => n.kind === "match-arm-inline" && n.test === '"hello"');
    expect(helloArm).toBeDefined();
    expect(helloArm.test).toBe('"hello"');
    expect(helloArm.result).toBe('"greeting"');
  });

  test("§8 multiple inline arms on one line produce separate nodes", () => {
    const { body } = parseMatchBody('.Loading => "loading" .Ready(data) => data .Error(msg) => msg');
    const inlineArms = body.filter(n => n.kind === "match-arm-inline");
    expect(inlineArms).toHaveLength(3);
    expect(inlineArms[0].test).toBe(".Loading");
    expect(inlineArms[1].test).toBe(".Ready(data)");
    expect(inlineArms[2].test).toBe(".Error(msg)");
  });

  test("§9 mixed block + inline arms produce correct node kinds", () => {
    const source = `<program>
\${
  type S:enum = { Loading, Ready, Error }
  @s: S = S.Loading
  let r = match @s {
    .Loading => "loading"
    .Ready => { return "ready" }
    .Error => "error"
  }
}
<p>\${r}</p>
</program>`;
    const { ast } = parse(source);
    const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
    const matchBody = letDecl?.matchExpr?.body ?? [];
    const kinds = matchBody.map(n => n.kind);
    expect(kinds).toContain("match-arm-inline");
    expect(kinds).toContain("match-arm-block");
  });

  test("§10 result expression is captured correctly", () => {
    const { body } = parseMatchBody('.Loading => "loading" .Ready(data) => data.toUpperCase() else => "unknown"');
    const readyArm = body.find(n => n.kind === "match-arm-inline" && n.test?.includes("Ready"));
    expect(readyArm).toBeDefined();
    expect(readyArm.result).toBe("data . toUpperCase ( )");
  });

  test("§11 resultExpr is populated (structured ExprNode)", () => {
    const { body } = parseMatchBody('.Loading => "loading" else => "other"');
    const arm = body.find(n => n.kind === "match-arm-inline" && n.test === ".Loading");
    expect(arm).toBeDefined();
    expect(arm.resultExpr).toBeDefined();
    // Should be a string literal ExprNode
    expect(arm.resultExpr.kind).toBe("lit");
  });

  test("§12 span is present", () => {
    const { body } = parseMatchBody('.Loading => "loading" else => "other"');
    const arm = body.find(n => n.kind === "match-arm-inline");
    expect(arm).toBeDefined();
    expect(arm.span).toBeDefined();
    expect(typeof arm.span.start).toBe("number");
  });

  test("§13 legacy :: prefix produces match-arm-inline", () => {
    const source = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  let r = match @d { ::A => "a" ::B => "b" }
}
<p>\${r}</p>
</program>`;
    const { ast } = parse(source);
    const letDecl = findNodeDeep(ast.nodes, n => n.kind === "let-decl" && n.matchExpr);
    const matchBody = letDecl?.matchExpr?.body ?? [];
    const arm = matchBody.find(n => n.kind === "match-arm-inline" && n.test?.includes("::A"));
    expect(arm).toBeDefined();
    expect(arm.test).toBe("::A");
  });
});

// ---------------------------------------------------------------------------
// §14–§19: End-to-end compilation tests
// ---------------------------------------------------------------------------

describe("match-arm-inline end-to-end compilation", () => {
  test("§14 single-line exhaustive match compiles without errors", () => {
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir { .N => "up" .S => "down" .E => "right" .W => "left" }
}
<p>\${r}</p>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("§15 inline match with payload binding compiles correctly", () => {
    const src = `<program>
\${
  type Shape:enum = { Circle(r: number), Square(s: number), Point }
  @shape: Shape = Shape.Point
  let area: number = match @shape { .Circle(r) => r * r * 3.14 .Square(s) => s * s .Point => 0 }
}
<p>\${area}</p>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("§16 string literal match arms compile correctly", () => {
    const src = `<program>
\${
  let s: string = "hello"
  let r: string = match s { "hello" => "greeting" "bye" => "farewell" else => "unknown" }
}
<p>\${r}</p>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("§17 mixed inline + block arms compile correctly", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @s: S = S.A
  let r = match @s {
    .A => "alpha"
    .B => { return "bravo" }
    .C => "charlie"
  }
}
<p>\${r}</p>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("§18 non-exhaustive inline match reports E-TYPE-020", () => {
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir { .N => "up" .S => "down" }
}
<p>\${r}</p>
</program>
`;
    const { errors } = compile(src);
    const e020 = errors.filter(e => e.code === "E-TYPE-020");
    expect(e020).toHaveLength(1);
    expect(e020[0].message).toContain("Missing variants");
  });

  test("§19 S27 regression: multi-arm single-line match with function calls", () => {
    const src = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  function fn(n: number): number { return n * 2 }
  let r: number = match @d { .A => fn(1) .B => fn(2) }
}
<p>\${r}</p>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });
});
