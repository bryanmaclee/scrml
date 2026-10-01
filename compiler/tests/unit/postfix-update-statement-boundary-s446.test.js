/**
 * S446 — a POSTFIX update (`@a++` / `x--`) ends a statement.
 *
 * Pre-S446 the statement collector (ast-builder collectExpr) did not count a
 * postfix `++`/`--` as value-ending, so
 *   - `@a++⏎ f()` collected as ONE bare-expr `@a ++\nf ( )` whose expression view
 *     stopped at `@a++` — `f()` was silently dropped (exit 0) in every function
 *     body and every multi-statement event handler (both use this collector);
 *   - same-line `@a++ f()` dropped `f()` the same way instead of reporting
 *     E-STMT-MISSING-SEMICOLON like `g() f()` does (S284).
 * A prefix `++` (operand on the NEXT line) is not affected.
 * Runtime acceptance: compiler/tests/browser/handler-stmt-list-residuals-s446.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function fnBody(src) {
  const file = `<program>\n  <a> = 0\n  \${\n    function h() { }\n    function go() {\n${src}\n    }\n  }\n</program>\n`;
  const res = buildAST(splitBlocks("t.scrml", file));
  let body = null;
  const seen = new Set();
  const visit = (n) => {
    if (body || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (n.kind === "function-decl" && n.name === "go") { body = n.body; return; }
    for (const k of Object.keys(n)) if (k !== "span") visit(n[k]);
  };
  visit(res.ast);
  return { body, codes: (res.errors ?? []).map((e) => e.code) };
}

const kinds = (body) => body.map((s) => `${s.kind}:${String(s.expr ?? "").replace(/\s+/g, "")}`);

describe("S446 postfix update is a statement boundary", () => {
  test("`@a++⏎ h()` is two statements", () => {
    const { body } = fnBody("      @a++\n      h()");
    expect(kinds(body)).toEqual(["bare-expr:@a++", "bare-expr:h()"]);
  });
  test("`@a--⏎ h()` is two statements", () => {
    const { body } = fnBody("      @a--\n      h()");
    expect(kinds(body)).toEqual(["bare-expr:@a--", "bare-expr:h()"]);
  });
  test("a local `i++⏎ h()` is two statements", () => {
    const { body } = fnBody("      let i = 0\n      i++\n      h()");
    expect(body.length).toBe(3);
    expect(String(body[2].expr).replace(/\s+/g, "")).toBe("h()");
  });
  test("a member postfix `o.n++⏎ h()` is two statements", () => {
    const { body } = fnBody("      const o = { n: 0 }\n      o.n++\n      h()");
    expect(body.length).toBe(3);
  });
  test("same-line `@a++ h()` reports E-STMT-MISSING-SEMICOLON (was a silent drop)", () => {
    const { codes } = fnBody("      @a++ h()");
    expect(codes).toContain("E-STMT-MISSING-SEMICOLON");
  });
  test("`@a++; h()` stays clean", () => {
    const { body, codes } = fnBody("      @a++; h()");
    expect(codes).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(body.length).toBe(2);
  });
  test("a binary `+` continuation across a newline is NOT split", () => {
    const { body } = fnBody("      @a = 1 +\n        2");
    expect(body.length).toBe(1);
  });
});
