/**
 * Comments in a parameter list — Unit Tests
 *
 * `parseParamList` (ast-builder.js) reassembles a parameter's name, type
 * annotation and default value from RAW TOKEN TEXT into two string buffers:
 * `cur` (name + type) and `defBuf` (default value). NEITHER buffer is
 * JavaScript — `cur` is consumed by string surgery in `pushParam`
 * (`/^lin\s+/`, `indexOf(':')`, `.trim()`), so a comment appearing anywhere in
 * a signature used to be welded into whichever buffer was open.
 *
 * A COMMENT token is now SKIPPED, with a single space emitted in its place when
 * the buffer is non-empty and does not already end in one.
 *
 * WHY SKIP AND NOT RE-EMIT. Re-emitting a comment FAITHFULLY still breaks
 * `cur`: `greet(/* the message *​/ msg)` would record the parameter name
 * `/* the message *​/ msg`, which is exactly as unusable as the pre-fix
 * `the message *​/ msg`. Skipping is the only strategy that fixes both buffers,
 * and it is the same strategy the S184 lifecycle-field-comment-leak fix used in
 * `collectBracedBody`.
 *
 * WHY THE SPACE IS LOAD-BEARING (§4). `appendTok`'s existing separator rule only
 * fires for an INCOMING IDENT / KEYWORD / AT_IDENT. A bare skip would therefore
 * weld `msg = 1 /*c*​/ 2` into the default `12` — a silently wrong VALUE that
 * compiles clean. With the space it becomes `1 2`, which fails to parse. That is
 * the correct outcome: `1 2` was never a valid default and neither was the
 * source that produced it. Failing loud beats emitting a plausible wrong number.
 *
 * Every "before" value quoted below was MEASURED at base commit c159f1a2, not
 * inferred.
 *
 * Coverage:
 *   §1  Parameter NAME positions            (before: `the message *​/ msg`)
 *   §2  Default-value positions             (before: `join *​/1`)
 *   §3  Type-annotation positions           (before: `t *​/ string`)
 *   §4  THE GLUE PROOF — `1 /*c*​/ 2` must NOT become `12`
 *   §5  `lin` linearity survives            (before: `linc*​/ msg`, isLin LOST)
 *   §6  Comments do not mint phantom params (before: `greet(/*c*​/)` had 1 param)
 *   §7  Destructure patterns
 *   §8  Comment-free signatures are BYTE-IDENTICAL to before
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

/** Compile a bare logic body and return the first function-like node's params. */
function paramsOf(logicSource) {
  const bs = splitBlocks("param-comment.scrml", "${\n" + logicSource + "\n}\n");
  const ast = buildAST(bs);
  const found = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (Array.isArray(n.params) && n.name) found.push(n.params);
    for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
  };
  walk(ast);
  return found[0] ?? null;
}

describe("comments in a parameter list are skipped, not welded", () => {
  // ---------------------------------------------------------------------------
  // §1 Parameter NAME positions
  // ---------------------------------------------------------------------------

  test("§1 a block comment before the name does not become part of the name", () => {
    // Before: [{ name: "the message */ msg" }] -> E-SCOPE-001 on the real `msg`.
    expect(paramsOf("function greet(/* the message */ msg) { return msg }"))
      .toEqual([{ name: "msg" }]);
  });

  test("§1 a comment before the SECOND parameter does not become part of its name", () => {
    // Before: [{ name: "a" }, { name: "c */ b" }]
    expect(paramsOf("function greet(a, /* c */ b) { return a }"))
      .toEqual([{ name: "a" }, { name: "b" }]);
  });

  test("§1 a comment AFTER the name, before `)`, does not become part of the name", () => {
    // Before: [{ name: "msg c */" }]
    expect(paramsOf("function greet(msg /* c */) { return msg }"))
      .toEqual([{ name: "msg" }]);
  });

  test("§1 two adjacent block comments before the name", () => {
    // Before: [{ name: "a*/b*/ msg" }]
    expect(paramsOf("function greet(/*a*/ /*b*/ msg) { return msg }"))
      .toEqual([{ name: "msg" }]);
  });

  // ---------------------------------------------------------------------------
  // §2 Default-value positions
  // ---------------------------------------------------------------------------

  test("§2 a LINE comment before the default keeps the default", () => {
    // Before: defaultValue "join\n1" -> E-CODEGEN-INVALID-LOGIC (`msg = join 1`).
    expect(paramsOf("function greet(msg = // join\n  1) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "1" }]);
  });

  test("§2 a BLOCK comment before the default keeps the default", () => {
    // Before: defaultValue "join */1"
    expect(paramsOf("function greet(msg = /* join */ 1) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "1" }]);
  });

  test("§2 a trailing line comment AFTER the default keeps the default", () => {
    // Before: defaultValue "1 tail"
    expect(paramsOf("function greet(msg = 1 // tail\n) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "1" }]);
  });

  test("§2 a comment inside a nested call in the default", () => {
    // Before: defaultValue "f(c*/1)" — not valid JS.
    expect(paramsOf("function greet(msg = f(/*c*/ 1)) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "f( 1)" }]);
  });

  test("§2 a comment before a STRING default leaves the string re-quoted", () => {
    // Before: defaultValue "c*/\"hi\""
    expect(paramsOf('function greet(msg = /*c*/ "hi") { return msg }'))
      .toEqual([{ name: "msg", defaultValue: '"hi"' }]);
  });

  test("§2 a comment-only default records NO default — same as a bare `msg =`", () => {
    // Before: defaultValue "x */". `greet(msg =)` has ALWAYS recorded no default,
    // so this joins an existing class rather than opening a new one.
    const withComment = paramsOf("function greet(msg = /* x */) { return msg }");
    const bare = paramsOf("function greet(msg =) { return msg }");
    expect(withComment).toEqual([{ name: "msg" }]);
    expect(withComment).toEqual(bare);
  });

  // ---------------------------------------------------------------------------
  // §3 Type-annotation positions
  // ---------------------------------------------------------------------------

  test("§3 a comment inside a type annotation does not become part of the type", () => {
    // Before: typeAnnotation "t */ string"
    expect(paramsOf("function greet(msg: /* t */ string) { return msg }"))
      .toEqual([{ name: "msg", typeAnnotation: "string" }]);
  });

  // ---------------------------------------------------------------------------
  // §4 THE GLUE PROOF — this is the reason the skip emits a space
  // ---------------------------------------------------------------------------

  test("§4 `1 /*c*/ 2` must NOT weld into the default `12`", () => {
    const params = paramsOf("function greet(msg = 1 /*c*/ 2) { return msg }");
    expect(params[0].defaultValue).not.toBe("12");
    expect(params[0].defaultValue).toBe("1 2");
  });

  test("§4 `1 /* c */ 2` (inner spaces) also does not weld", () => {
    const params = paramsOf("function greet(msg = 1 /* c */ 2) { return msg }");
    expect(params[0].defaultValue).not.toBe("12");
    expect(params[0].defaultValue).toBe("1 2");
  });

  test("§4 `a /*c*/ b` must NOT weld into the identifier `ab`", () => {
    const params = paramsOf("function greet(msg = a /*c*/ b) { return msg }");
    expect(params[0].defaultValue).not.toBe("ab");
    expect(params[0].defaultValue).toBe("a b");
  });

  test("§4 the space is emitted ONCE — a comment after an existing space does not double it", () => {
    const params = paramsOf("function greet(msg = 1 /*a*/ /*b*/ 2) { return msg }");
    expect(params[0].defaultValue).toBe("1 2");
  });

  // ---------------------------------------------------------------------------
  // §5 `lin` linearity — the silently-lost one
  // ---------------------------------------------------------------------------

  test("§5 a comment after `lin` does not defeat the linearity marker", () => {
    // Before: [{ name: "linc*/ msg" }] — `isLin` SILENTLY ABSENT, because
    // pushParam's /^lin\s+/ no longer matched. A linear parameter compiled as a
    // non-linear one with zero diagnostics.
    expect(paramsOf("function greet(lin /*c*/ msg) { return msg }"))
      .toEqual([{ name: "msg", isLin: true }]);
  });

  test("§5 control — `lin msg` with no comment is unchanged", () => {
    expect(paramsOf("function greet(lin msg) { return msg }"))
      .toEqual([{ name: "msg", isLin: true }]);
  });

  // ---------------------------------------------------------------------------
  // §6 Comments must not mint parameters out of thin air
  // ---------------------------------------------------------------------------

  test("§6 a comment in an otherwise EMPTY parameter list yields no parameters", () => {
    // Before: [{ name: "c*/" }] — a phantom parameter, silently.
    expect(paramsOf("function greet(/*c*/) { return 1 }")).toEqual([]);
  });

  test("§6 control — a truly empty parameter list yields no parameters", () => {
    expect(paramsOf("function greet() { return 1 }")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // §7 Destructure patterns
  // ---------------------------------------------------------------------------

  test("§7 a comment between a destructure pattern and its `=` is not a type annotation", () => {
    // Before: the pattern carried typeAnnotation "c*/".
    const params = paramsOf("function greet({ a, b } /*c*/ = { a: 1, b: 2 }) { return a }");
    expect(params).toHaveLength(1);
    expect(params[0].typeAnnotation).toBeUndefined();
    expect(params[0].name.kind).toBe("destructure-object");
    expect(params[0].defaultValue).toBe("{ a:1, b:2}");
  });

  // ---------------------------------------------------------------------------
  // §8 Comment-free signatures are untouched
  // ---------------------------------------------------------------------------

  test("§8 comment-free signatures parse exactly as before", () => {
    expect(paramsOf("function greet(msg) { return msg }"))
      .toEqual([{ name: "msg" }]);
    expect(paramsOf("function greet(msg = 1) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "1" }]);
    expect(paramsOf("function greet(msg: string) { return msg }"))
      .toEqual([{ name: "msg", typeAnnotation: "string" }]);
    expect(paramsOf("function greet(a, b, c) { return a }"))
      .toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);
    expect(paramsOf('function greet(msg = "hi") { return msg }'))
      .toEqual([{ name: "msg", defaultValue: '"hi"' }]);
    expect(paramsOf("function greet(msg = f(1)) { return msg }"))
      .toEqual([{ name: "msg", defaultValue: "f(1)" }]);
  });
});
