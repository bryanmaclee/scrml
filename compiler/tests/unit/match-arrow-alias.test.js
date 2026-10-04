/**
 * Match Arrow Alias — Unit Tests
 *
 * Tests that `:>` works as a syntactic alias for `=>` in all match arm positions.
 * By the time codegen runs the AST node is identical regardless of which arrow was used.
 *
 * Coverage:
 *   §1  tokenizer — :> is tokenized as OPERATOR with text ":>"
 *   §2  match-stmt — :> works in match arms (logic body)
 *   §3  match-stmt — :> and => can be mixed in the same match block
 *   §4  match-arm-block — `. Variant :> { ... }` produces match-arm-block node
 *   §5  match-arm-block — `else :> { ... }` produces wildcard match-arm-block
 *   §6  match-arm-block — `not :> { ... }` produces absence match-arm-block
 *   §7  error-effect — `TypeName :> handler` works in parseErrorTokens
 *   §8  error-effect — `_ :> handler` wildcard works in parseErrorTokens
 *   §9  regression — => still works in all positions (no regressions)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { tokenizeLogic } from "../../src/tokenizer.js";

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

/**
 * Parse `${ <content> }` and return the single logic node.
 * This is the correct pattern for testing logic body parsing
 * without a surrounding <program> tag (which would shift node[0] to markup).
 */
function parseLogic(content) {
  const src = `\${ ${content} }`;
  return parseAST(src).nodes[0];
}

/**
 * Parse a source with a logic block containing `expr !{ armsSource }` and
 * return the arms array from the resulting guarded-expr node.
 */
function parseErrorArms(expr, armsSource) {
  const source = `\${ ${expr} !{ ${armsSource} } }`;
  const { ast } = parse(source);
  const logic = ast.nodes[0];
  const ge = logic.body.find(n => n.kind === "guarded-expr");
  return { ge, arms: ge ? ge.arms : null };
}

// ---------------------------------------------------------------------------
// §1: tokenizer — :> is tokenized as OPERATOR
// ---------------------------------------------------------------------------

describe("match-arrow-alias §1: tokenizer recognizes :>", () => {
  test(":> produces an OPERATOR token", () => {
    const tokens = tokenizeLogic(":>", 0, 1, 1, []);
    const op = tokens.find(t => t.text === ":>");
    expect(op).toBeDefined();
    expect(op.kind).toBe("OPERATOR");
  });

  test(":> token text is exactly ':>'", () => {
    const tokens = tokenizeLogic("x :> y", 0, 1, 1, []);
    const op = tokens.find(t => t.text === ":>");
    expect(op).not.toBeUndefined();
    expect(op.text).toBe(":>");
  });

  test("=> is still tokenized as OPERATOR (regression guard)", () => {
    const tokens = tokenizeLogic("x => y", 0, 1, 1, []);
    const op = tokens.find(t => t.text === "=>");
    expect(op).toBeDefined();
    expect(op.kind).toBe("OPERATOR");
  });

  test(":> and => are distinct tokens", () => {
    const tokens = tokenizeLogic(":> =>", 0, 1, 1, []);
    const colon = tokens.find(t => t.text === ":>");
    const fat = tokens.find(t => t.text === "=>");
    expect(colon).toBeDefined();
    expect(fat).toBeDefined();
    expect(colon.text).not.toBe(fat.text);
  });
});

// ---------------------------------------------------------------------------
// §2: match-stmt — :> in match arms
// ---------------------------------------------------------------------------

describe("match-arrow-alias §2: :> in match-stmt arms", () => {
  test(":> in match arms produces logic node", () => {
    const logic = parseLogic('match x { .A :> "a", .B :> "b" }');
    expect(logic.kind).toBe("logic");
  });

  test(":> in match arms produces match-stmt in body", () => {
    const logic = parseLogic('match x { .A :> "a", .B :> "b" }');
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
  });

  test("match-stmt with :> has correct header expression", () => {
    const logic = parseLogic("match status { .Loading :> 1, .Done :> 2 }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    expect(matchNode.header).toContain("status");
  });

  test("match-stmt with :> has a body array", () => {
    const logic = parseLogic("match x { .A :> 1, .B :> 2 }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    expect(Array.isArray(matchNode.body)).toBe(true);
  });

  test("match-stmt with :> has a span", () => {
    const logic = parseLogic("match x { .A :> 1 }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    expect(matchNode.span).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §3: match-stmt — mixing :> and => in same block
// ---------------------------------------------------------------------------

describe("match-arrow-alias §3: :> and => mixed in same match block", () => {
  test("mixed arrows in match block produce a match-stmt", () => {
    const logic = parseLogic('match x { .A => "a", .B :> "b", .C => "c" }');
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
  });

  test("mixing does not produce TAB parse errors (W-PROGRAM-001 is expected)", () => {
    const { errors } = parse('${ match x { .A => 1, .B :> 2 } }');
    // W-PROGRAM-001 is always raised when there is no <program> root — exclude it
    const parseErrors = errors.filter(e => e.name === "TABError" && e.code !== "W-PROGRAM-001");
    expect(parseErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4: match-arm-block — `. Variant :> { ... }`
// ---------------------------------------------------------------------------

describe("match-arrow-alias §4: match-arm-block with :> (variant form)", () => {
  test(". Variant :> { } produces match-arm-block node", () => {
    const logic = parseLogic("match status { .Active :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const arm = matchNode.body.find(n => n.kind === "match-arm-block");
    expect(arm).toBeDefined();
    expect(arm.variant).toBe("Active");
  });

  test("match-arm-block with :> is not a wildcard", () => {
    const logic = parseLogic("match status { .Active :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const arm = matchNode.body.find(n => n.kind === "match-arm-block");
    expect(arm).toBeDefined();
    expect(arm.isWildcard).toBe(false);
  });

  test("match-arm-block with :> has body array", () => {
    const logic = parseLogic("match x { .Info :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const arm = matchNode.body.find(n => n.kind === "match-arm-block");
    expect(arm).toBeDefined();
    expect(Array.isArray(arm.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5: match-arm-block — `else :> { ... }`
// ---------------------------------------------------------------------------

describe("match-arrow-alias §5: match-arm-block with :> (else wildcard)", () => {
  test("else :> { } produces wildcard match-arm-block", () => {
    const logic = parseLogic("match x { .A :> { } else :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const wildcard = matchNode.body.find(n => n.kind === "match-arm-block" && n.isWildcard);
    expect(wildcard).toBeDefined();
  });

  test("else :> { } has null variant", () => {
    const logic = parseLogic("match x { .A :> { } else :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const wildcard = matchNode.body.find(n => n.kind === "match-arm-block" && n.isWildcard);
    expect(wildcard).toBeDefined();
    expect(wildcard.variant).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §6: match-arm-block — `not :> { ... }`
// ---------------------------------------------------------------------------

describe("match-arrow-alias §6: match-arm-block with :> (not absence arm)", () => {
  test("not :> { } produces isNotArm match-arm-block", () => {
    const logic = parseLogic("match val { .Some :> { } not :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const notArm = matchNode.body.find(n => n.kind === "match-arm-block" && n.isNotArm);
    expect(notArm).toBeDefined();
  });

  test("not :> { } has variant '__not__'", () => {
    const logic = parseLogic("match val { .Some :> { } not :> { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const notArm = matchNode.body.find(n => n.kind === "match-arm-block" && n.isNotArm);
    expect(notArm).toBeDefined();
    expect(notArm.variant).toBe("__not__");
  });
});

// ---------------------------------------------------------------------------
// §7: error-effect — TypeName :> handler in parseErrorTokens
// ---------------------------------------------------------------------------

describe("match-arrow-alias §7: :> in error-effect arms (simplified form)", () => {
  test("NetworkError :> handler produces correct arm pattern", () => {
    const { arms } = parseErrorArms("fetch(url)", "NetworkError :> null");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("::NetworkError");
  });

  test("NetworkError :> handler has implicit binding 'e'", () => {
    const { arms } = parseErrorArms("call()", "NetworkError :> handleErr(e)");
    expect(arms[0].binding).toBe("e");
  });

  test("NetworkError :> handler captures the handler expression", () => {
    const { arms } = parseErrorArms("call()", "NetworkError :> handleErr(e)");
    expect(arms[0].handler).toContain("handleErr");
  });

  test("ValidationError :> handler produces correct pattern", () => {
    const { arms } = parseErrorArms("validate(x)", "ValidationError :> null");
    expect(arms[0].pattern).toBe("::ValidationError");
  });
});

// ---------------------------------------------------------------------------
// §8: error-effect — _ :> wildcard arm
// ---------------------------------------------------------------------------

describe("match-arrow-alias §8: :> wildcard arm in error-effect", () => {
  test("_ :> handler produces wildcard pattern '_'", () => {
    const { arms } = parseErrorArms("call()", "_ :> fallback()");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("_");
  });

  // S452 — a pipe-less `_ :>` is the §18.2 wildcard arm, parsed by the same
  // path as `| _ :>`, and binds NOTHING (§19.4.3 S451). Pre-S452 the
  // short-form path gave it an implicit `e`.
  test("_ :> binds nothing (S452: same as `| _ :>`)", () => {
    const { arms } = parseErrorArms("call()", "_ :> fallback()");
    expect(arms[0].binding).toBe("");
  });

  test("multiple :> arms in error-effect produce correct count", () => {
    const { arms } = parseErrorArms("call()", "NetworkError :> null  ValidationError :> null");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(2);
    expect(arms[0].pattern).toBe("::NetworkError");
    expect(arms[1].pattern).toBe("::ValidationError");
  });
});

// ---------------------------------------------------------------------------
// §9: regression — => still works everywhere
// ---------------------------------------------------------------------------

describe("match-arrow-alias §9: => regression guard", () => {
  test("match-stmt with => arms still produces match-stmt", () => {
    const logic = parseLogic('match x { .A => "a", .B => "b" }');
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
  });

  test("match-arm-block Form 1 with => still works", () => {
    const logic = parseLogic("match status { .Active => { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const arm = matchNode.body.find(n => n.kind === "match-arm-block");
    expect(arm).toBeDefined();
  });

  test("match-arm-block else => still works", () => {
    const logic = parseLogic("match x { .A => { } else => { } }");
    const matchNode = logic.body.find(n => n.kind === "match-stmt");
    expect(matchNode).toBeDefined();
    const wildcard = matchNode.body.find(n => n.kind === "match-arm-block" && n.isWildcard);
    expect(wildcard).toBeDefined();
  });

  test("error-effect => arm still works (simplified form)", () => {
    const { arms } = parseErrorArms("fetch(url)", "NetworkError => null");
    expect(arms).not.toBeNull();
    expect(arms.length).toBe(1);
    expect(arms[0].pattern).toBe("::NetworkError");
  });

  test("error-effect _ => wildcard still works", () => {
    const { arms } = parseErrorArms("call()", "_ => fallback()");
    expect(arms[0].pattern).toBe("_");
  });
});
