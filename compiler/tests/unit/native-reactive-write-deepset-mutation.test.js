// native-reactive-write-deepset-mutation.test.js — native translate-bridge fix.
//
// change-id: native-translate-bridge-gaps-2026-06-06 (FIX A)
//
// THE BUG (native-only): a reactive deep-set (`@a.ref = "p"` / `@arr[i] = x`) or
// an array-mutation (`@arr.push(5)`) at statement position routed through the
// generic `makeBareExpr` path in the translate bridge (translate-stmt.js). Its
// translated `exprNode` carried an `assign` with a MEMBER target (or a `call` on
// a member), so codegen emitted an IN-PLACE mutation with NO copy-on-write and
// NO reactive trigger — a reactivity break. The default (LIVE) parser
// synthesizes dedicated `reactive-nested-assign` / `reactive-array-mutation` AST
// kinds which emit-logic.ts lowers to the COW deep-set / triggered form.
//
// THE FIX (translate-stmt.js `tryReactiveWrite`): recognize the same two forms
// at ExprStmt position, gated STRICTLY on the path being rooted at an `@`-cell,
// and synthesize the live node kinds. A non-`@`-cell-rooted write (`obj.x = y`
// on a plain local) stays a bare expression (parity with LIVE).
//
// S449 RE-POINT: this file used to compile under the retired full-pipeline
// `--parser=scrml-native` flag and byte-compare the emitted function body with
// the default pipeline's. The bridge runs in production inside `nativeParseFile`
// (component / `^{}` / `<match>` re-parse), whose nodes go to the same codegen,
// so the fix is now asserted on the native tree: each statement's node kind and
// its structured fields (target, path / method, valueExpr / argsExpr) equal the
// default parser's for the same source. The default-pipeline COW / triggered
// emit for those node kinds is covered by the default-pipeline reactive tests.

import { describe, test, expect } from "bun:test";
import { nativeAst, liveAst, findNodes, withoutPositions, errorsOf } from "../helpers/native-ast.js";

function opBody(result, name = "op") {
  const fn = findNodes(result.ast, (n) => n.kind === "function-decl" && n.name === name)[0];
  return fn ? fn.body : null;
}

// The fields codegen lowers for the two reactive-write kinds, normalized over
// the representational differences between the two parsers that codegen
// already absorbs: the native bridge leaves the legacy string mirrors
// (`value`, a path step's `raw`) empty and carries the structured sibling.
// For an array mutation both parsers carry one ExprNode per argument on
// `argExprs` (s461, §6.5.1), so the argument lists are compared structurally,
// positions aside.
function argsText(stmt) {
  return JSON.stringify(withoutPositions(stmt.argExprs ?? []));
}
function project(stmt) {
  const p = { kind: stmt.kind, target: stmt.target };
  if (stmt.kind === "reactive-nested-assign") {
    p.path = withoutPositions(stmt.path).map((step) =>
      step && typeof step === "object" ? { index: step.index } : step);
    p.valueExpr = withoutPositions(stmt.valueExpr);
  } else {
    p.method = stmt.method;
    p.args = argsText(stmt);
  }
  return p;
}

describe("native reactive-write deep-set + array-mutation node synthesis (FIX A)", () => {
  test("deep-set + array-mutation synthesize the live node kinds (not bare expressions)", () => {
    const src = [
      '<a> = { ref: "" }',
      "<c> = 0",
      "<arr> = []",
      "function multi() {",
      "    @c = 1",
      '    @a.ref = "p"',
      "    @arr.push(5)",
      "}",
      "<button onclick=multi()>go</button>",
      "<p>${@c} ${@a.ref} ${@arr}</p>",
    ].join("\n") + "\n";
    const nat = nativeAst(src);
    expect(errorsOf(nat)).toEqual([]);
    const body = opBody(nat, "multi");
    expect(body).not.toBeNull();
    const deep = body.find((s) => s.kind === "reactive-nested-assign");
    const mut = body.find((s) => s.kind === "reactive-array-mutation");
    expect(deep).toBeDefined();
    expect(deep.target).toBe("a");
    expect(deep.path).toEqual(["ref"]);
    expect(mut).toBeDefined();
    expect(mut.target).toBe("arr");
    expect(mut.method).toBe("push");
    // Never the pre-fix generic statement for these two writes: no bare
    // expression assigns through a member or calls a method.
    const genericWrite = (s) => s.kind === "bare-expr" && s.exprNode
      && ((s.exprNode.kind === "assign" && s.exprNode.target && s.exprNode.target.kind !== "ident")
        || s.exprNode.kind === "call");
    expect(body.filter(genericWrite)).toHaveLength(0);
  });

  const matrix = [
    { name: "dotted deep-set", decls: ['<a> = { ref: "" }'], lines: ['@a.ref = "p"'] },
    { name: "nested dotted deep-set", decls: ["<obj> = { cfg: { deep: 0 } }"], lines: ["@obj.cfg.deep = 9"] },
    { name: "computed-index write (@cell index)", decls: ["<arr> = [1, 2, 3]", "<sel> = 0"], lines: ["@arr[@sel] = 9"] },
    { name: "literal-index write", decls: ["<arr> = [1, 2, 3]"], lines: ["@arr[0] = 9"] },
    { name: "string-index write", decls: ["<m> = { DAL: 0 }"], lines: ['@m["DAL"] = 8'] },
    { name: "single-arg push", decls: ["<arr> = []"], lines: ["@arr.push(5)"] },
    { name: "push @cell arg", decls: ["<arr> = []", "<x> = 7"], lines: ["@arr.push(@x)"] },
    { name: "multi-arg splice", decls: ["<arr> = [1, 2, 3, 4]"], lines: ["@arr.splice(0, 2)"] },
    { name: "arg-less pop", decls: ["<arr> = [1, 2, 3]"], lines: ["@arr.pop()"] },
    { name: "unshift / sort / reverse / fill", decls: ["<arr> = [3, 1, 2]"], lines: ["@arr.unshift(0)", "@arr.sort()", "@arr.reverse()", "@arr.fill(0)"] },
    {
      // NEGATIVE — a plain-local non-cell write must stay a bare expression.
      name: "non-cell local write (negative)",
      decls: ["<arr> = []"],
      lines: ["let obj = { x: 0 }", "obj.x = 5", "obj.list = []", "obj.list.push(9)", "@arr.push(obj.x)"],
    },
  ];

  for (const { name, decls, lines } of matrix) {
    test(`${name}: native statement nodes match the default parser's`, () => {
      const firstCell = (decls[0].match(/^<([A-Za-z_$][\w$]*)>/) || [])[1] || "arr";
      const src = [
        ...decls,
        "function op() {",
        ...lines.map((l) => "    " + l),
        "}",
        "<button onclick=op()>go</button>",
        `<p>\${@${firstCell}}</p>`,
      ].join("\n") + "\n";
      const nat = nativeAst(src);
      const live = liveAst(src);
      expect(errorsOf(nat)).toEqual([]);
      const nb = opBody(nat);
      const lb = opBody(live);
      expect(nb).not.toBeNull();
      expect(lb).not.toBeNull();
      expect(nb.map((s) => s.kind)).toEqual(lb.map((s) => s.kind));
      const reactive = (s) => s.kind === "reactive-nested-assign" || s.kind === "reactive-array-mutation";
      expect(nb.filter(reactive).map(project)).toEqual(lb.filter(reactive).map(project));
    });
  }
});
