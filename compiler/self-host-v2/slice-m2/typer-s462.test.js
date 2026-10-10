// typer-s462.test.js — O35(d), RULED S462 ("go on the package"): a non-literal own value's type
// (SPEC §66.3 rules 5–10; docs/changes/s462-own-value-inference/). Every rule: the shape it fires
// on and the adjacent legal shape it stays silent on. Provenance:
// ../../../../scrml-support/user-voice-scrml.md §S462 · dd own-value-type-annotation-o35d-dpa-065.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd } from "./lowered.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const prog = (decls, markup = "<p>x</p>") => ({
  path: "app.scrml",
  src: `<program>\n${decls}\n    <main>\n${markup}\n    </main>\n</program>\n`,
});
const run = (decls, markup) => frontEnd(mods, [prog(decls, markup)]);
const codes = (decls, markup) => run(decls, markup).diags.map((d) => d.code);
const typeOf = (decls, name) => {
  const r = run(decls);
  const p = r.typed.tables.decls.find((d) => d.sym.id === r.typed.tables.program.id);
  const f = p.fields.find((x) => x.sym.hint === name);
  return { ty: f.ty, trusted: f.trusted, origin: f.origin };
};
// an enum value: a unit variant is its name; a payload variant is `{ variant, data }`
const tag = (v) => (v && typeof v === "object" && "variant" in v ? v.variant : v);

// ---------------------------------------------------------------------------
// Rule 5 — the inferable set (literals; a typed @ref; arithmetic, comparison, ternary, `.length`
// over members; a call with a declared or inferred-and-proven return).
// ---------------------------------------------------------------------------
describe("rule 5 — every member of the set infers, unannotated, with no diagnostic", () => {
  const BASE = "    let <b:int=2/>\n    let <s:string=\"ab\"/>\n    let <n:number=1.5/>\n";
  for (const [label, decl] of [
    ["a typed @ref", "<r=(@b)/>"],
    ["arithmetic over two ints", "<r=(@b * 2)/>"],
    ["`/` over numbers", "<r=(@n / 2)/>"],
    ["a comparison", "<r=(@b > 1)/>"],
    ["a ternary", "<r=(@b > 1 ? @n : 2)/>"],
    ["`.length` of a string", "<r=(@s.length)/>"],
    ["`+` over two strings", "<r=(@s + \"!\")/>"],
    ["unary `-` of a member", "<r=(-@b)/>"],
    ["a sequence literal of one type", "<r=([1, 2, 3])/>"],
    ["a chain through another inferred cell", "<q=(@b + 1)/>\n    <r=(@q * 2)/>"],
    ["a cell declared later (order does not matter)", "<r=(@later + 1)/>\n    <later=(@b * 3)/>"],
    ["a call with a declared return", "fn tw(x: int) -> int { return x * 2 }\n    <r=(tw(@b))/>"],
    ["a call with an inferred-and-proven return (params by annotation)", "function h(y: number) { if (y > 0) { return y } else { return 0 } }\n    <r=(h(@n))/>"],
    ["a call whose proven return reads a cell", "function g() { return @b + 1 }\n    <r=(g())/>"],
  ]) {
    test(label, () => { expect(codes(BASE + "    " + decl)).toEqual([]); });
  }
  test("the inferred types — int, number, bool, string, int[]", () => {
    expect(tag(typeOf("    let <b:int=2/>\n    <r=(@b * 2)/>", "r").ty)).toBe("Int");
    expect(tag(typeOf("    let <b:int=2/>\n    <r=(@b / 2.0)/>", "r").ty)).toBe("Num");
    expect(tag(typeOf("    let <b:int=2/>\n    <r=(@b == 2)/>", "r").ty)).toBe("Bool");
    expect(tag(typeOf("    let <s:string=\"a\"/>\n    <r=(@s + \"b\")/>", "r").ty)).toBe("Str");
    const seq = typeOf("    <r=([1, 2])/>", "r").ty;
    expect(tag(seq)).toBe("Seq");
    expect(tag(typeOf("    <r=(1 + 2.5)/>", "r").ty)).toBe("Num");
  });
  test("a QUALIFIED variant `E.V` is a literal of `E` (rule 5 (a)) — typed, though the binder still refuses the form (dd D5)", () => {
    const t = typeOf("    type Phase:enum = { Idle, Serving }\n    <m=(Phase.Serving)/>", "m");
    expect(tag(t.ty)).toBe("Named");
    expect(t.trusted).toBe(true);
    // D5 (pre-existing, not this change): the binder reports `Phase` undeclared; no own-value code piles on
    expect(codes("    type Phase:enum = { Idle, Serving }\n    <m=(Phase.Serving)/>")).not.toContain("E-DECL-TYPE-NOT-INFERABLE");
  });
  test("the origin: Literal for a literal, Inferred for a non-literal member", () => {
    expect(tag(typeOf("    <r=1/>", "r").origin)).toBe("Literal");
    expect(tag(typeOf("    let <b:int=2/>\n    <r=(@b)/>", "r").origin)).toBe("Inferred");
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — the BASE type: no singleton, no grants.
// ---------------------------------------------------------------------------
describe("rule 6 — the inferred type is the base type", () => {
  test("`(1 + 2)` is an `int` cell any int may be written into", () => {
    expect(codes("    let <k=(1 + 2)/>\n    function f() { @k = 7 }")).toEqual([]);
  });
  test("the inferred `int` is a write contract — a number literal into it is E-TYPE-031", () => {
    expect(codes("    let <k=(1 + 2)/>\n    function f() { @k = 2.5 }")).toEqual(["E-TYPE-031"]);
  });
  test("a sequence read carries no grant: a copy of `int[append]` is `int[]` (an append is refused)", () => {
    const t = typeOf("    <xs:int[append]=([1])/>\n    <ys=(@xs)/>", "ys").ty;
    expect(tag(t)).toBe("Seq");
    expect(t.data.grants.at.length).toBe(0);
    expect(tag(t.data.grants.length)).toBe("Fixed");
    expect(codes("    <xs:int[append]=([1])/>\n    <ys=(@xs)/>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — outside the set: E-DECL-TYPE-NOT-INFERABLE (never unknown); no cascade.
// ---------------------------------------------------------------------------
describe("rule 7 — outside the set is E-DECL-TYPE-NOT-INFERABLE", () => {
  const S = "    type U:struct = { name: string }\n    <u:U=({ name: \"a\" })/>\n    let <f:bool=true/>\n";
  for (const [label, decl] of [
    ["a member path", "<r=(@u.name)/>"],
    ["`!`", "<r=(!@f)/>"],
    ["`&&`", "<r=(@f && @f)/>"],
    ["`is given`", "<r=(@f is given)/>"],
    ["a call whose return reads a local", "function k() { const v: int = 1\n return v }\n    <r=(k())/>"],
    ["a call that is recursive", "function rec(x: int) { if (x > 0) { return rec(x - 1) } else { return 0 } }\n    <r=(rec(2))/>"],
    ["a call that does not return on every path", "function half(x: int) { if (x > 0) { return 1 } }\n    <r=(half(2))/>"],
    ["a ternary with arms of two kinds", "<r=(@f ? 1 : \"x\")/>"],
  ]) {
    test(label, () => { expect(codes(S + "    " + decl)).toContain("E-DECL-TYPE-NOT-INFERABLE"); });
  }
  test("`(!0)` is no longer an `int` literal (dd D3) — the typer refuses the `!`, and that report owns it (no cascade)", () => {
    expect(codes("    <r=(!0)/>")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(typeOf("    <r=(!0)/>", "r").trusted).toBe(false);
  });
  test("the message names the part outside the set and the fix", () => {
    const d = run(S + "    <r=(@u.name)/>").diags.find((x) => x.code === "E-DECL-TYPE-NOT-INFERABLE");
    expect(d.message).toContain("`.name`");
    expect(d.message).toContain("r:T=");
    expect(d.severity).toBe("Error");
  });
  test("a field that failed is UNTRUSTED (no cascade at its readers) — not the old placeholder `string`", () => {
    const t = typeOf(S + "    <r=(@u.name)/>", "r");
    expect(t.trusted).toBe(false);
    // a reader of the failed cell reports nothing of its own (rule 7's no-cascade clause)
    expect(codes(S + "    <r=(@u.name)/>\n    <r2=(@r * 2)/>").filter((c) => c === "E-DECL-TYPE-NOT-INFERABLE")).toHaveLength(1);
  });
  test("no report when an Error already lies inside the initializer (E-SCOPE-001 owns `@nope`)", () => {
    expect(codes("    <r=(@nope + 1)/>")).toEqual(["E-SCOPE-001"]);
  });
  test("UNSUPPORTED — an untyped ATTRIBUTE is refused by the bootstrap parser whole (literal or not), so the attribute limb has no fire site", () => {
    const c = frontEnd(mods, [{ path: "app.scrml", src: "<chip a:int=1 b=(@base * 2)/> renders <p>${a}</p>\n<program>\n    let <base:int=1/>\n    <main><chip/></main>\n</program>\n" }]).diags.map((d) => d.code);
    expect(c).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a CHILD field of a declaration infers like a program cell (its `@ref` reads the program's cells)", () => {
    const src = "<card:struct>\n    let <n=(@base * 2)/>\n</> renders <p>${n}</p>\n<program>\n    let <base:int=1/>\n    <main><card/></main>\n</program>\n";
    expect(frontEnd(mods, [{ path: "app.scrml", src }]).diags.map((d) => d.code)).toEqual([]);
    const bad = "<card:struct>\n    let <n=(!@flag)/>\n</> renders <p>x</p>\n<program>\n    let <flag:bool=true/>\n    <main><card/></main>\n</program>\n";
    expect(frontEnd(mods, [{ path: "app.scrml", src: bad }]).diags.map((d) => d.code)).toEqual(["E-DECL-TYPE-NOT-INFERABLE"]);
  });
  test("E-TYPE-ANNOTATION-REQUIRED is retired (dd D1)", () => {
    expect(codes("    <r=(@nope.x)/>")).not.toContain("E-TYPE-ANNOTATION-REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — a cycle outranks the inference code.
// ---------------------------------------------------------------------------
describe("rule 8 — the cycle diagnostic wins", () => {
  test("two unannotated derived cells reading each other: E-DERIVED-CIRCULAR-DEP, not NOT-INFERABLE", () => {
    expect(codes("    <a=(@b + 1)/>\n    <b=(@a + 1)/>")).toEqual(["E-DERIVED-CIRCULAR-DEP"]);
  });
  test("a self-reference: one E-DERIVED-CIRCULAR-DEP", () => {
    expect(codes("    <a=(@a + 1)/>")).toEqual(["E-DERIVED-CIRCULAR-DEP"]);
  });
  test("an ANNOTATED derived cycle is E-DERIVED-CIRCULAR-DEP too (the check is not keyed on annotation)", () => {
    expect(codes("    <a:int=(@b + 1)/>\n    <b:int=(@a + 1)/>")).toEqual(["E-DERIVED-CIRCULAR-DEP"]);
  });
  test("a reader of a cycle member reports nothing of its own", () => {
    expect(codes("    <a=(@b + 1)/>\n    <b=(@a + 1)/>\n    <c=(@a * 2)/>")).toEqual(["E-DERIVED-CIRCULAR-DEP"]);
  });
  test("⚑ a cycle through a SEEDED member has no cycle code: NOT-INFERABLE names the cycle", () => {
    const d = run("    let <a=(@b + 1)/>\n    <b=(@a + 1)/>").diags;
    expect(d.map((x) => x.code)).toEqual(["E-DECL-TYPE-NOT-INFERABLE", "E-DECL-TYPE-NOT-INFERABLE"]);
    expect(d[0].message).toContain("@a → @b");
  });
  test("an annotation breaks an inference cycle (a seeded member written `:int`)", () => {
    expect(codes("    let <a:int=(@b + 1)/>\n    <b=(@a + 1)/>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 9 — `:T` required at persist= / export (server: the bootstrap refuses `server` whole).
// ---------------------------------------------------------------------------
describe("rule 9 — boundaries need a written type", () => {
  const SEED = "    let <seed:int=1/>\n";
  test("a non-literal persist= cell: E-DECL-TYPE-REQUIRED-AT-BOUNDARY (instead of, not beside, an inference code)", () => {
    expect(codes(SEED + "    let <p=(@seed * 2) persist=\"local\" key=\"a.p\"/>")).toEqual(["E-DECL-TYPE-REQUIRED-AT-BOUNDARY"]);
  });
  test("a non-inferable persist= cell: still only the boundary code", () => {
    expect(codes("    let <f:bool=true/>\n    let <p=(!@f) persist=\"local\" key=\"a.p\"/>")).toEqual(["E-DECL-TYPE-REQUIRED-AT-BOUNDARY"]);
  });
  test("a literal persist= cell is unaffected (§6.14's `= \"all\"`)", () => {
    expect(codes("    let <tab=\"all\" persist=\"session\" key=\"a.t\"/>")).toEqual([]);
  });
  test("an annotated non-literal persist= cell is fine", () => {
    expect(codes(SEED + "    let <p:int=(@seed * 2) persist=\"local\" key=\"a.p\"/>")).toEqual([]);
  });
  test("a non-literal exported own value: required (the default while O2 / O39 is open); a literal one is not", () => {
    expect(codes(SEED + "    export <t=(@seed * 2)/>")).toEqual(["E-DECL-TYPE-REQUIRED-AT-BOUNDARY"]);
    expect(codes(SEED + "    export <t=10/>")).toEqual([]);
    expect(codes(SEED + "    export <t:int=(@seed * 2)/>")).toEqual([]);
  });
  test("UNSUPPORTED — `server` on a declaration is refused by the bootstrap parser, so the server limb has no fire site", () => {
    expect(codes(SEED + "    let <s=(@seed * 2) server/>")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

// ---------------------------------------------------------------------------
// Rule 10 — `:T` over an unresolvable initializer: E-DECL-TYPE-UNPROVEN.
// ---------------------------------------------------------------------------
describe("rule 10 — an unproven annotation is an error", () => {
  const MK = "    function mk() { const k: int = 5\n return k }\n";
  test("`:int` over a call whose return is neither declared nor proven", () => {
    expect(codes(MK + "    <v:int=(mk())/>")).toEqual(["E-DECL-TYPE-UNPROVEN"]);
  });
  test("reached through an operator (`mk() + 1`) — still unproven", () => {
    expect(codes(MK + "    <v:int=(mk() + 1)/>")).toEqual(["E-DECL-TYPE-UNPROVEN"]);
  });
  test("a call's ARGUMENT is not its value — `tw(mk())` with `tw -> int` is proven", () => {
    expect(codes(MK + "    fn tw(x: int) -> int { return x * 2 }\n    <v:int=(tw(mk()))/>")).toEqual([]);
  });
  test("a declared return, or a proven one, is silent", () => {
    expect(codes("    function mk() -> int { const k: int = 5\n return k }\n    <v:int=(mk())/>")).toEqual([]);
    expect(codes("    function six() { return 6 }\n    <v:int=(six() + 1)/>")).toEqual([]);
  });
  test("a written type over a value merely OUTSIDE the inference set (a member path) is not 'unproven'", () => {
    expect(codes("    type U:struct = { name: string }\n    <u:U=({ name: \"a\" })/>\n    <l:string=(@u.name)/>")).toEqual([]);
  });
  test("the message names the cause and the two fixes", () => {
    const d = run(MK + "    <v:int=(mk())/>").diags[0];
    expect(d.message).toContain("`mk(…)`");
    expect(d.message).toContain("`-> T`");
    expect(d.message).toContain("`:asIs`");
    expect(d.severity).toBe("Error");
  });
});
