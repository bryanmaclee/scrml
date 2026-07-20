/**
 * collectExpr BLOCK_REF tag-nesting tests
 *
 * Validates that collectExpr() correctly handles BLOCK_REF tokens inside tag
 * bodies vs. at top level in logic blocks.
 *
 * Bug: BLOCK_REF at depth 0 in collectExpr() would break the expression even
 * when the BLOCK_REF was inside a tag body (e.g., SQL query inside <div>).
 *
 * Fix: The block splitter now tracks tag nesting inside brace-delimited
 * contexts and annotates child blocks with tagNesting. collectExpr() checks
 * tok.block.tagNesting before treating BLOCK_REF as a statement boundary.
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

function parseAST(source) {
  return parse(source).ast;
}

/** Get the block splitter output for inspection */
function split(source) {
  return splitBlocks("test.scrml", source);
}

/** Recursively find all blocks of a given type */
function findBlocks(blocks, type) {
  const result = [];
  for (const b of blocks) {
    if (b.type === type) result.push(b);
    if (b.children) result.push(...findBlocks(b.children, type));
  }
  return result;
}

// ---------------------------------------------------------------------------
// S1  Block splitter: tagNesting annotation
// ---------------------------------------------------------------------------

describe("block splitter tagNesting annotation", () => {
  test("BLOCK_REF at top level of logic block has no tagNesting", () => {
    // SQL after a let statement = separate statement, no tag context
    const { blocks } = split('${ let x = 1; ?{ SELECT * FROM t } }');
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    const sqlBlock = sqlBlocks[0];
    // tagNesting should be 0 or undefined (not set when 0)
    expect(sqlBlock.tagNesting ?? 0).toBe(0);
  });

  test("BLOCK_REF inside <div>...</div> has tagNesting > 0", () => {
    const source = [
      '${',
      '  const Card = <div>',
      '    ?{ SELECT * FROM cards }',
      '  </div>',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    expect(sqlBlocks[0].tagNesting).toBe(1);
  });

  test("BLOCK_REF inside nested tags has tagNesting > 1", () => {
    const source = [
      '${',
      '  const Card = <div><span>',
      '    ?{ SELECT * FROM cards }',
      '  </span></div>',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    expect(sqlBlocks[0].tagNesting).toBe(2);
  });

  test("multiple BLOCK_REFs inside tag body all have tagNesting > 0", () => {
    const source = [
      '${',
      '  const Card = <div>',
      '    ?{ SELECT * FROM cards }',
      '    !{ might-fail() }',
      '  </div>',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    const errorBlocks = findBlocks(blocks, "error-effect");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    expect(errorBlocks.length).toBeGreaterThanOrEqual(1);
    expect(sqlBlocks[0].tagNesting).toBe(1);
    expect(errorBlocks[0].tagNesting).toBe(1);
  });

  test("BLOCK_REF after closing tag has tagNesting 0", () => {
    const source = [
      '${',
      '  const Card = <div>text</div>',
      '  ?{ SELECT * FROM cards }',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    // After </div>, tagNesting should be back to 0
    expect(sqlBlocks[0].tagNesting ?? 0).toBe(0);
  });

  test("self-closing tag does not increment tagNesting", () => {
    const source = [
      '${',
      '  const Card = <br/>',
      '  ?{ SELECT * FROM cards }',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(1);
    // <br/> is self-closing, should not increment tagNesting
    expect(sqlBlocks[0].tagNesting ?? 0).toBe(0);
  });

  test("explicit closer </div> decrements tagNesting", () => {
    const source = [
      '${',
      '  const x = <div><p>inner</p>',
      '  ?{ SELECT 1 }',
      '  </div>',
      '  ?{ SELECT 2 }',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(2);
    // First SQL is inside <div> (tagNesting = 1, <p> was closed by </p>)
    expect(sqlBlocks[0].tagNesting).toBe(1);
    // Second SQL is after </div> (tagNesting = 0)
    expect(sqlBlocks[1].tagNesting ?? 0).toBe(0);
  });

  test("</> closer decrements tagNesting", () => {
    const source = [
      '${',
      '  const x = <div>',
      '    <p>text</>',
      '    ?{ SELECT 1 }',
      '  </>',
      '  ?{ SELECT 2 }',
      '}',
    ].join('\n');
    const { blocks } = split(source);
    const sqlBlocks = findBlocks(blocks, "sql");
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(2);
    // First SQL is inside <div> after <p> closed by </> (tagNesting = 1)
    expect(sqlBlocks[0].tagNesting).toBe(1);
    // Second SQL is after <div> closed by </> (tagNesting = 0)
    expect(sqlBlocks[1].tagNesting ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S2  AST builder: collectExpr BLOCK_REF behavior
// ---------------------------------------------------------------------------

describe("collectExpr BLOCK_REF statement boundary", () => {
  test("BLOCK_REF at top level of logic block breaks expression (SQL after let = separate statement)", () => {
    const source = [
      '${',
      '  let x = 1',
      '  ?{ SELECT * FROM cards }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    // The logic block should have two separate nodes:
    // 1. let x = 1
    // 2. sql block
    const logicNode = ast.nodes[0];
    expect(logicNode.kind).toBe("logic");
    expect(logicNode.body.length).toBeGreaterThanOrEqual(2);
    // First statement is a let-decl
    expect(logicNode.body[0].kind).toBe("let-decl");
    // Second statement should be a sql block, not part of the let expression
    expect(logicNode.body[1].kind).toBe("sql");
  });

  test("BLOCK_REF inside tag body does NOT break expression (component expression preserved)", () => {
    const source = [
      '${',
      '  const Card = <div>',
      '    <p>Hello</p>',
      '    ?{ SELECT * FROM cards }',
      '    <p>More</p>',
      '  </div>',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    expect(logicNode.kind).toBe("logic");
    // Because Card starts with uppercase, this becomes a component-def.
    // The entire const Card = <div>..?{..}..</div> should be ONE component-def
    // (not split at the BLOCK_REF).
    const compNode = logicNode.body.find(n => n.kind === "component-def");
    expect(compNode).toBeDefined();
    expect(compNode.name).toBe("Card");
    // The component raw expression should include content AFTER the BLOCK_REF
    // (i.e., it was not truncated at the ?{} boundary). Spacing-agnostic: after
    // GITI-039 markup regions rejoin span-verbatim, so the closing tag may be
    // `</div>` (nested, angleDepth>0) or `< / div >` (root, angleDepth 0).
    expect(compNode.raw).toMatch(/<\s*\/\s*div\s*>/);
  });

  test("BLOCK_REF inside nested tags preserved in expression", () => {
    const source = [
      '${',
      '  const Card = <div><span>',
      '    ?{ SELECT name FROM users }',
      '  </span></div>',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const compNode = logicNode.body.find(n => n.kind === "component-def");
    expect(compNode).toBeDefined();
    // The expression should include closing tags after the BLOCK_REF.
    // Spacing-agnostic (GITI-039): the nested `</span>` rejoins verbatim
    // (angleDepth>0) while the root `</div>` stays spaced (angleDepth 0).
    expect(compNode.raw).toMatch(/<\s*\/\s*span\s*>/);
    expect(compNode.raw).toMatch(/<\s*\/\s*div\s*>/);
  });

  test("multiple BLOCK_REFs inside tag body all preserved", () => {
    const source = [
      '${',
      '  const Card = <div>',
      '    ?{ SELECT * FROM cards }',
      '    !{ might-fail() }',
      '    <p>end</p>',
      '  </div>',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const compNode = logicNode.body.find(n => n.kind === "component-def");
    expect(compNode).toBeDefined();
    // Expression should reach all the way to </div> (spacing-agnostic, GITI-039).
    expect(compNode.raw).toMatch(/<\s*\/\s*div\s*>/);
  });

  test("BLOCK_REF after closing tag breaks expression (SQL is separate defChild)", () => {
    const source = [
      '${',
      '  const Card = <div>content</div>',
      '  ?{ SELECT * FROM cards }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    expect(logicNode.kind).toBe("logic");
    // The component-def should have the SQL as a defChild (sibling consumed
    // by the component-def post-processing), NOT as part of its raw expression.
    const compNode = logicNode.body.find(n => n.kind === "component-def");
    expect(compNode).toBeDefined();
    expect(compNode.name).toBe("Card");
    // The raw expression ends at </div> - SQL is NOT in the expression.
    // GITI-039: the markup region rejoins span-verbatim, so the opening tag +
    // text are tight (`<div>content`); the ROOT close tag stays spaced
    // (`< / div >`) because its `<` drops angleDepth to 0 before the rejoin.
    expect(compNode.raw).toBe("<div>content < / div >");
    // SQL is consumed as a defChild of the component-def
    expect(compNode.defChildren).toBeDefined();
    expect(compNode.defChildren.length).toBeGreaterThanOrEqual(1);
    expect(compNode.defChildren[0].kind).toBe("sql");
  });

  test("lowercase const with BLOCK_REF at top level breaks correctly", () => {
    // Using lowercase name = const-decl (not component-def)
    const source = [
      '${',
      '  const data = getValue()',
      '  ?{ SELECT * FROM cards }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    expect(logicNode.kind).toBe("logic");
    expect(logicNode.body.length).toBeGreaterThanOrEqual(2);
    expect(logicNode.body[0].kind).toBe("const-decl");
    expect(logicNode.body[1].kind).toBe("sql");
  });
});

// ---------------------------------------------------------------------------
// S3  B8 — error-effect BLOCK_REF after value bypasses tagNesting (S83)
//
// Regression: when a `${...}` body contains a structural state-decl
// (`<sending> = false`), BS counts the `<sending>` opener as a tag opener
// (incrementing frame.tagNesting because the closing `>` is followed by `=`).
// Subsequent error-effect BLOCK_REFs inside the same `${...}` then carry
// tagNesting > 0, suppressing the L1888 BLOCK_REF break. The let-decl RHS
// then greedily absorbs the `!{...}` block content as raw text, producing
// E-CTX warnings via expression-parser's trailing-content guard.
//
// Fix: the L1888 BLOCK_REF break extends — when the BLOCK_REF is
// type === "error-effect" and the previous token is value-producing, it is
// unambiguously a failable handler suffix and must terminate the expression
// regardless of tagNesting. The outer parseRecursiveBody loop (L2848) then
// wraps the previous statement as a guarded-expr.
// ---------------------------------------------------------------------------

describe("collectExpr error-effect BLOCK_REF — B8 (let x = call() !{...})", () => {
  test("let x = call() !{ | .A => { return } } parses cleanly with prior state-decl", () => {
    // The state-decl `<sending> = false` causes tagNesting bookkeeping to
    // mark subsequent BLOCK_REFs with tagNesting=1. Pre-fix: this absorbed
    // !{...} into the let-decl RHS. Post-fix: !{...} breaks → guarded-expr.
    const source = [
      '${',
      '  <sending> = false',
      '  type E:enum = { A, B }',
      '  function validate() ! E { fail .A }',
      '  function handle() {',
      '    let validated = validate() !{',
      '      | .A => { @sending = false; return }',
      '      | .B => { return }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    expect(logicNode.kind).toBe("logic");
    // Find the `handle` function-decl
    const handleFn = logicNode.body.find(n => n.kind === "function-decl" && n.name === "handle");
    expect(handleFn).toBeDefined();
    // The body should contain a guarded-expr wrapping the let-decl, NOT a
    // single let-decl with the whole `!{...}` swallowed into init.
    const ge = handleFn.body.find(n => n.kind === "guarded-expr");
    expect(ge).toBeDefined();
    expect(ge.guardedNode).toBeDefined();
    expect(ge.guardedNode.kind).toBe("let-decl");
    expect(ge.guardedNode.name).toBe("validated");
    // The let-decl init must be just `validate ( )` — no `!{...}` content.
    expect(ge.guardedNode.init.includes("!{")).toBe(false);
    // The arms must be parsed from the !{} block.
    expect(ge.arms).toBeDefined();
    expect(Array.isArray(ge.arms)).toBe(true);
  });

  test("let x = call() !{} with no prior state-decl (tagNesting=0) still works", () => {
    // Regression guard: the pre-fix path (tagNesting=0) already worked. Make
    // sure the fix doesn't break it.
    const source = [
      '${',
      '  type E:enum = { A, B }',
      '  function validate() ! E { fail .A }',
      '  function handle() {',
      '    let validated = validate() !{',
      '      | .A => { return }',
      '      | .B => { return }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const handleFn = logicNode.body.find(n => n.kind === "function-decl" && n.name === "handle");
    expect(handleFn).toBeDefined();
    const ge = handleFn.body.find(n => n.kind === "guarded-expr");
    expect(ge).toBeDefined();
    expect(ge.guardedNode.kind).toBe("let-decl");
    expect(ge.guardedNode.init.includes("!{")).toBe(false);
  });

  test("let x = expr; let y = expr (no error-effect) regression — sibling decls preserved", () => {
    // Mirror P-FUP-2/P-FUP-3 regression-guard: ASI-NEWLINE-derived sibling
    // decl boundaries still fire when there is no `!{}` involved.
    const source = [
      '${',
      '  function handle() {',
      '    let a = 1',
      '    let b = 2',
      '    let c = 3',
      '  }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const handleFn = logicNode.body.find(n => n.kind === "function-decl" && n.name === "handle");
    expect(handleFn).toBeDefined();
    const lets = handleFn.body.filter(n => n.kind === "let-decl");
    expect(lets.length).toBe(3);
    expect(lets[0].name).toBe("a");
    expect(lets[1].name).toBe("b");
    expect(lets[2].name).toBe("c");
  });

  test("parseErrorTokens handles `.Variant` bare-dot arm pattern (B8 follow-on)", () => {
    // Pre-S83 parseErrorTokens only matched `::Type` and `_` after `|`.
    // The canonical §14.10 / M9 bare-dot form `.Variant(binding) =>` fell
    // through to the handler body, surfacing as E-SCOPE-001 on the binding.
    // After B8 fix, pattern stores ".Variant" — emit-logic.ts strips both
    // `::` and `.` prefixes per its existing L2229 logic.
    const source = [
      '${',
      '  <sending> = false',
      '  type E:enum = { Ready, Failed(reason: string) }',
      '  function validate() ! E { fail .Ready }',
      '  function handle() {',
      '    let v = validate() !{',
      '      | .Ready          => { @sending = false }',
      '      | .Failed(reason) => { @sending = false }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const handleFn = logicNode.body.find(n => n.kind === "function-decl" && n.name === "handle");
    expect(handleFn).toBeDefined();
    const ge = handleFn.body.find(n => n.kind === "guarded-expr");
    expect(ge).toBeDefined();
    expect(ge.arms.length).toBe(2);
    // Both arms have populated patterns.
    expect(ge.arms[0].pattern).toBe(".Ready");
    expect(ge.arms[1].pattern).toBe(".Failed");
    // The payload binding is captured for `.Failed(reason)`.
    expect(ge.arms[1].binding).toBe("reason");
  });

  test("statement-level call() !{} (not in let-decl) wraps as guarded-expr", () => {
    // Bare-expr `call() !{...}` as a statement (not let-bound) still works.
    const source = [
      '${',
      '  <sending> = false',
      '  type E:enum = { A }',
      '  function validate() ! E { fail .A }',
      '  function handle() {',
      '    validate() !{',
      '      | .A => { @sending = false }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const ast = parseAST(source);
    const logicNode = ast.nodes[0];
    const handleFn = logicNode.body.find(n => n.kind === "function-decl" && n.name === "handle");
    expect(handleFn).toBeDefined();
    const ge = handleFn.body.find(n => n.kind === "guarded-expr");
    expect(ge).toBeDefined();
    // The guarded node is a bare-expr (call), not a let-decl.
    expect(ge.guardedNode).toBeDefined();
    expect(ge.arms).toBeDefined();
    expect(ge.arms.length).toBeGreaterThanOrEqual(1);
  });
});
