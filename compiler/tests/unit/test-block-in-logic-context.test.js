/**
 * test-block-in-logic-context.test.js
 *
 * jwt-auth-bypass follow-on (2026-07-11) — a `~{ … }` test block nested inside a
 * `${ … }` logic block (the redundant-`${}` shape every stdlib module uses, e.g.
 * stdlib/auth/jwt.scrml) was SILENTLY DROPPED: tokenizeLogic's BLOCKREF_TYPES set
 * omitted "test", so the pre-split `test` child was NOT substituted as a
 * BLOCK_REF. parseLogicBody then collected the raw `~{ … }` as a bare expression,
 * emitting "statement boundary not detected — trailing content would be silently
 * dropped" and discarding the whole test group.
 *
 * `meta` (`^{}`) was already in BLOCKREF_TYPES; adding `test` (`~{}`) mirrors it —
 * the pre-split test child becomes a BLOCK_REF, collectExpr breaks at it, and it
 * is built via buildBlock case "test".
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(src) {
  return buildAST(splitBlocks("t.scrml", src));
}

function countKind(ast, kind) {
  let n = 0;
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === kind) n++;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(ast);
  return n;
}

describe("~{} test block nested inside a ${} logic block", () => {
  test("a multi-line ~{} inside ${} is built as a test node, not a dropped bare-expr", () => {
    const src = [
      "<program>",
      "${",
      "    export function decodeJwt(token) {",
      "        return { sub: \"x\" }",
      "    }",
      "",
      "    ~{",
      "        import { assertTruthy } from 'scrml:test'",
      "        const decoded = decodeJwt(\"a.b.c\") !{",
      "            | ::DecodeFailed(m) -> not",
      "        }",
      "        assertTruthy(decoded is some)",
      "    }",
      "}",
      "</program>",
    ].join("\n");
    const tab = build(src);
    // The test block is recognized + built (was 0 pre-fix — dropped).
    expect(countKind(tab.ast, "test")).toBe(1);
    // Its content was NOT leaked into a bare-expr statement.
    const leaked = countKind(tab.ast, "bare-expr");
    // (No assertion on exact bare-expr count — just that the test node exists
    // AND the assertTruthy body did not survive as inert bare-expr text.)
    function anyBareExprHasAssert(node, hit = { v: false }) {
      if (!node || typeof node !== "object") return hit.v;
      if (node.kind === "bare-expr" && typeof node.raw === "string" && node.raw.includes("assertTruthy")) hit.v = true;
      for (const k of Object.keys(node)) {
        const val = node[k];
        if (Array.isArray(val)) val.forEach((c) => anyBareExprHasAssert(c, hit));
        else if (val && typeof val === "object") anyBareExprHasAssert(val, hit);
      }
      return hit.v;
    }
    expect(anyBareExprHasAssert(tab.ast)).toBe(false);
    expect(leaked).toBeGreaterThanOrEqual(0);
  });

  test("regression: a canonical top-level ~{} (no ${} wrapper) still builds one test node", () => {
    const src = [
      "<program>",
      "export function decodeJwt(token) {",
      "    return { sub: \"x\" }",
      "}",
      "",
      "~{",
      "    import { assertTruthy } from 'scrml:test'",
      "    assertTruthy(decodeJwt(\"a.b.c\") is some)",
      "}",
      "</program>",
    ].join("\n");
    const tab = build(src);
    expect(countKind(tab.ast, "test")).toBe(1);
  });

  test("regression: a ^{} meta block nested in ${} still builds (BLOCKREF parity)", () => {
    const src = [
      "<program>",
      "${",
      "    ^{ const x = 1 }",
      "    export function f() { return 1 }",
      "}",
      "</program>",
    ].join("\n");
    const tab = build(src);
    expect(countKind(tab.ast, "meta")).toBe(1);
  });
});
