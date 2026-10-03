// typing.test.js — the typer's table covers the slice-M4 programs: every
// expression node the binder resolved — including the new places markup lives
// (state-child bodies, a child field's own `renders`) and the new expression
// kinds (`...e`, `a[i]`) — has exactly one Typing entry, and the scope pass /
// typer add no diagnostic to a clean program.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd, programFiles } from "./harness.js";
import { auditFixture, auditShapesFixture, formFixture } from "./fixtures.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const EXPR_KINDS = new Set(["Name", "At", "AtItem", "Num", "Str", "Bool", "NotLit", "Variant", "Member", "Call",
  "Unary", "Binary", "Ternary", "Assign", "ArrayLit", "ObjectLit", "Spread", "Index", "Lambda"]);

// Every AExpr node reachable in the ASTs, except binding names (`as=`) and
// `rule=` alternations (graph syntax, not values).
function exprNids(node, skip = false, out = []) {
  if (Array.isArray(node)) { for (const x of node) exprNids(x, skip, out); return out; }
  if (node === null || typeof node !== "object") return out;
  const isAttr = typeof node.name === "string" && node.value && typeof node.value === "object" && "variant" in node.value;
  const skipHere = skip || (isAttr && (node.name === "as" || node.name === "rule"));
  if (!skipHere && typeof node.nid === "number" && node.k && EXPR_KINDS.has(node.k.variant)) out.push(node.nid);
  for (const v of Object.values(node)) exprNids(v, skipHere, out);
  return out;
}

const PROGRAMS = [
  ["§66.19.6 engine (verbatim)", () => programFiles("engine")],
  ["§66.19.5 audit fixture", () => [{ path: "audit.scrml", src: auditFixture() }]],
  ["§66.19.5 audit shapes fixture", () => [{ path: "audit.scrml", src: auditShapesFixture() }]],
  ["§66.19.2 form fixture", () => [{ path: "signup.scrml", src: formFixture() }]],
  // a child field whose own renders holds expressions (§66.4 rule 2), rendered through `<*note/>`
  ["a child field's renders with expressions", () => [{ path: "c.scrml", src: [
    "<program>",
    "    <card title:string>",
    "        let <note:string=\"hi\"/>",
    "        renders <em>${note} of ${title}</em>",
    "    </>",
    "    renders <article><*note/></article>",
    "    <main><card title=\"x\"/><card title=\"y\"/></main>",
    "</program>",
    "",
  ].join("\n") }]],
];

describe("the typer's table — a type per expression node, slice-M4 programs", () => {
  for (const [name, files] of PROGRAMS) {
    test(`${name}: every expression node has exactly one entry, and no diagnostic`, () => {
      const r = frontEnd(mods, files());
      expect(r.diags.map((d) => d.code)).toEqual([]);
      const typed = r.typed.tables.typing.exprs.map((x) => x.nid);
      expect(new Set(typed).size).toBe(typed.length);
      const want = [...new Set(exprNids(r.asts))];
      expect(want.length).toBeGreaterThan(1);
      expect(want.filter((n) => !typed.includes(n))).toEqual([]);
    });
  }

  test("a state-child body's literal and a spread element's operand are typed", () => {
    const r = frontEnd(mods, programFiles("engine"));
    const t = r.typed.tables;
    // `: "Ready"` (the .Idle state-child body) is a string
    const ready = exprNids(r.asts).map((n) => [n, mods.analyze.exprType(t, n)]).filter(([, vt]) => vt.variant === "Known" && vt.data.t === "Str");
    expect(ready.length).toBeGreaterThan(0);
    const a = frontEnd(mods, [{ path: "audit.scrml", src: auditFixture() }]);
    const spreadOps = [];
    (function walk(x) {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (!x || typeof x !== "object") return;
      if (x.k && x.k.variant === "Spread") spreadOps.push(x.k.data.e.nid);
      Object.values(x).forEach(walk);
    })(a.asts);
    expect(spreadOps.length).toBe(1);
    const vt = mods.analyze.exprType(a.typed.tables, spreadOps[0]);
    expect(vt.variant).toBe("Known");
    expect(vt.data.t.variant).toBe("Seq");
  });
});
