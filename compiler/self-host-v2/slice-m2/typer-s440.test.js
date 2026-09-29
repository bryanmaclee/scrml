// typer-s440.test.js — the S440-RULED typer / checker diagnostics in the bootstrap
// (docs/changes/s442-bootstrap-typer-rules/). Every diagnostic: a POSITIVE test (fires on the
// ruled shape) and a NEGATIVE twin (silent on the adjacent legal shape — above all the
// provable-or-silent boundary and the #7 handle-vs-cell carve-out). Provenance per item:
// ../../../../scrml-support/user-voice-scrml.md §S440 (quoted in progress.md).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice } from "./lowered.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });
const app = (decls, markup) => ({
  path: "app.scrml",
  src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }\n<program>\n${decls}\n    <main>\n${markup}\n    </main>\n</program>\n`,
});
const run = (files) => frontEnd(mods, files);
const codes = (files) => run(files).diags.map((d) => d.code);
const inApp = (decls, markup = "<p>x</p>") => codes([LIB(), app(decls, markup)]);
const diagsIn = (decls, markup = "<p>x</p>") => run([LIB(), app(decls, markup)]).diags;

// ---------------------------------------------------------------------------
// #1 — a cell write AND a field write of the wrong type is E-TYPE-031.
// ruling: S440 22-item queue #1 "cell write type mismatch → E-TYPE-031"; three SPEC-text OPEN
// items #1 "a wrong-typed FIELD write is E-TYPE-031 too".
// ---------------------------------------------------------------------------
describe("#1 — cell and field writes are type-checked (E-TYPE-031)", () => {
  const P = "    type P:struct = { let x: int, let s: string }\n    <let p:P=({ x: 1, s: \"a\" })/>\n";
  test("E-TYPE-031 — a string into an `int` cell (the ruling's own example)", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { @x = \"oops\" }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — a string into an `int` FIELD of a struct cell (`@p.x = \"oops\"`)", () => {
    expect(inApp(P + "    function f() { @p.x = \"oops\" }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — a number into a `string` field of a declaration instance (`@country.value = 5`)", () => {
    expect(inApp("    function f() { @country.value = 5 }", "<dropdown as=country label=\"1\" options=([\"a\"])/>")).toEqual(["E-TYPE-031"]);
  });
  test("twins silent — the right type in each position", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { @x = 7 }")).toEqual([]);
    expect(inApp(P + "    function f() { @p.x = 2\n @p.s = \"b\" }")).toEqual([]);
    expect(inApp("    function f() { @country.value = \"CA\" }", "<dropdown as=country label=\"1\" options=([\"a\"])/>")).toEqual([]);
  });
  test("provable-or-silent — an unannotated parameter's value (untyped → Unknown) is never checked", () => {
    // the slice refuses the unannotated parameter itself; the write is not a second report
    expect(inApp("    <let x:int=0/>\n    function f(a) { @x = a }")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("the message names the target's declared type and the value's", () => {
    const d = diagsIn(P + "    function f() { @p.x = \"oops\" }");
    expect(d[0].message).toContain("`int`");
    expect(d[0].message).toContain("`string`");
  });
});

// ---------------------------------------------------------------------------
// #2 — call arity: E-CALL-ARITY (§7.3). ruling: S440 "#2 = PA rec — make extra arguments an error
// now … too few arguments is an error unless the parameter has a default (§7.3.2)".
// ---------------------------------------------------------------------------
describe("#2 — call arity (E-CALL-ARITY)", () => {
  const G = "    function g(a: int, b: int) -> int { return a }\n";
  test("E-CALL-ARITY — an extra argument (statement, value, handler, interpolation)", () => {
    expect(inApp(G + "    function f() { g(1, 2, 3) }")).toEqual(["E-CALL-ARITY"]);
    expect(inApp(G + "    <let x:int=0/>\n    function f() { @x = g(1, 2, 3) }")).toEqual(["E-CALL-ARITY"]);
    expect(inApp(G, "<button onclick=g(1, 2, 3)>x</button>")).toEqual(["E-CALL-ARITY"]);
    expect(inApp(G, "<p>${g(1, 2, 3)}</p>")).toEqual(["E-CALL-ARITY"]);
  });
  test("E-CALL-ARITY — a missing argument (no parameter has a default)", () => {
    expect(inApp(G + "    function f() { g(1) }")).toEqual(["E-CALL-ARITY"]);
    expect(inApp("    function k() -> int { return 1 }\n    function f() { k(1) }")).toEqual(["E-CALL-ARITY"]);
  });
  test("the message says which way the count is wrong", () => {
    expect(diagsIn(G + "    function f() { g(1, 2, 3) }")[0].message).toContain("extra argument");
    expect(diagsIn(G + "    function f() { g(1) }")[0].message).toContain("missing argument");
  });
  test("twins silent — the declared count; a zero-parameter function called with none", () => {
    expect(inApp(G + "    function f() { g(1, 2) }")).toEqual([]);
    expect(inApp("    function k() -> int { return 1 }\n    function f() { k() }")).toEqual([]);
  });
  test("provable-or-silent — a signature that did not parse (a default `b: int = 1`) is never arity-checked", () => {
    const d = inApp("    function g(a: int, b: int = 1) { }\n    function f() { g(1) }");
    expect(d).not.toContain("E-CALL-ARITY");
  });
  test("the retired bootstrap-local code is gone", () => {
    expect(inApp(G + "    function f() { g(1) }")).not.toContain("E-BOOTSTRAP-CALL-ARITY");
  });
});

// ---------------------------------------------------------------------------
// #3 — `<each in=>` over a PROVABLE non-sequence: E-EACH-NOT-SEQUENCE (§17.7.2); an unresolved
// type stays SILENT. ruling: S440 22-item #3 + SPEC-text OPEN #3 ("error only when the value is
// provably not a sequence").
// ---------------------------------------------------------------------------
describe("#3 — `<each in=>` over a non-sequence (E-EACH-NOT-SEQUENCE)", () => {
  const O = "    type O:struct = { let xs: int[] | not, let n: int | not }\n    <let o:O=({ xs: not, n: not })/>\n";
  test("E-EACH-NOT-SEQUENCE — an int, a number, a bool, a string, a struct, an enum, an instance", () => {
    for (const [decls, src] of [
      ["    <n:int=3/>", "@n"], ["    <r:number=0.5/>", "@r"], ["    <b:bool=true/>", "@b"], ["    <s:string=\"ab\"/>", "@s"],
      ["    type P:struct = { x: int }\n    <p:P=({ x: 1 })/>", "@p"], ["    <o:Openness=.Closed/>", "@o"],
    ]) {
      expect(inApp(decls, `<each in=${src} as c><p>x</p></each>`)).toEqual(["E-EACH-NOT-SEQUENCE"]);
    }
    expect(inApp("", "<dropdown as=d label=\"1\" options=([\"a\"])/><each in=@d as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
  });
  test("E-EACH-NOT-SEQUENCE — `T | not` over a NON-sequence (`int | not`) is still provably not a sequence", () => {
    expect(inApp(O, "<each in=@o.n as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
  });
  test("admitted — `S | not` over a sequence (§17.7.2: \"A value typed `S | not`, where `S` is a sequence, is admitted\")", () => {
    expect(inApp(O, "<each in=@o.xs as c><p>${c}</p></each>")).toEqual([]);
  });
  test("twins silent — a sequence cell, an array literal, a row field that is a sequence", () => {
    expect(inApp("    <xs:int[]=([1, 2])/>", "<each in=@xs as c><p>${c}</p></each>")).toEqual([]);
    expect(inApp("", "<each in=([1, 2]) as c><p>${c}</p></each>")).toEqual([]);
  });
  test("provable-or-silent — a call with no declared return type (Unknown) is silent", () => {
    expect(inApp("    function g() { }", "<each in=g() as c><p>x</p></each>")).toEqual([]);
  });
  test("provable-or-silent — a call DECLARED to return a non-sequence fires", () => {
    expect(inApp("    function g() -> int { return 1 }", "<each in=g() as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
  });
  test("the retired bootstrap-local code is gone", () => {
    expect(inApp("    <n:int=3/>", "<each in=@n as c><p>x</p></each>")).not.toContain("E-BOOTSTRAP-EACH-NOT-SEQUENCE");
  });
});

// ---------------------------------------------------------------------------
// #5 / #7 — E-HANDLE-REDECLARE (§66.7.2): (i) a duplicate `as=` in one scope, (ii) a handle named
// like a cell, (iii) the same name under mutually exclusive `if=` (an error for now). #7: a ROW
// handle MAY shadow a program-level HANDLE, NOT a CELL (§66.7.4).
// ruling: S440 "#5 = PA rec — (i) duplicate `as=` in one scope and (ii) a handle named like a cell
// are errors under one code (`E-HANDLE-REDECLARE`); (iii) the same name on mutually exclusive `if=`
// instances is an error for now"; 22-item #7 + SPEC-text OPEN #7 "a row `as=` handle may shadow a
// program-level HANDLE, not a CELL".
// ---------------------------------------------------------------------------
describe("#5 / #7 — handle names (E-HANDLE-REDECLARE)", () => {
  const DD = (as, label = "1") => `<dropdown as=${as} label="${label}" options=(["a"])/>`;
  const LINES = "    type L:struct = { id: int }\n    <lines:L[]=([{ id: 1 }])/>\n";
  const row = (inner) => `<each in=@lines key=@.id as line>${inner}</each>`;
  test("(i) E-HANDLE-REDECLARE — two `as=a` at program scope", () => {
    expect(inApp("", DD("a") + DD("a", "2"))).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("(i) E-HANDLE-REDECLARE — two `as=a` in one `<each>` row", () => {
    expect(inApp(LINES, row(DD("a") + DD("a", "2")))).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("(ii) E-HANDLE-REDECLARE — a program handle named like a program cell", () => {
    expect(inApp("    <let a:int=0/>", DD("a"))).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("(iii) E-HANDLE-REDECLARE — one name under two mutually exclusive `if=` arms; the message names (iii)", () => {
    const d = diagsIn("    <let b:bool=false/>", `<div if=@b>${DD("x")}</div><div if=(!@b)>${DD("x", "2")}</div>`);
    expect(d.map((x) => x.code)).toEqual(["E-HANDLE-REDECLARE"]);
    expect(d[0].message).toContain("mutually exclusive");
  });
  test("#7 legal — a ROW handle named like a PROGRAM-level handle", () => {
    expect(inApp(LINES, DD("a") + row(DD("a", "2")))).toEqual([]);
  });
  test("#7 E-HANDLE-REDECLARE — a ROW handle named like a program-level CELL", () => {
    expect(inApp(LINES + "    <let a:int=0/>", row(DD("a")))).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("twins silent — distinct names in one scope; the same name in two DIFFERENT rows", () => {
    expect(inApp("", DD("a") + DD("b", "2"))).toEqual([]);
    expect(inApp(LINES, row(DD("a")) + row(DD("a", "2")))).toEqual([]);
  });
  test("r4 (d) — a handle named like a visible DECLARATION → E-HANDLE-REDECLARE; a cell → E-SCOPE-010 (ruled S442)", () => {
    expect(inApp("", DD("dropdown"))).toEqual(["E-HANDLE-REDECLARE"]);
    expect(inApp("    <let dropdown:int=0/>")).toEqual(["E-SCOPE-010"]);
  });
  test("r5 R5 — a handle named like a visible declaration in a ROW or a declaration's RENDERS → E-HANDLE-REDECLARE", () => {
    expect(inApp("    <xs:int[]=([1])/>", "<each in=@xs as x>" + DD("dropdown") + "</each>")).toEqual(["E-HANDLE-REDECLARE"]);
    const wrap = { path: "app.scrml", src: "${ import { dropdown, Openness } from \"./lib/dropdown.scrml\" }\n<wrap n:int=0/>\nrenders <div><dropdown as=dropdown label=\"1\" options=([\"a\"])/></div>\n<program>\n    <main><wrap/></main>\n</program>\n" };
    expect(codes([LIB(), wrap])).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("r5 R5 twins — a row binding, a local and a parameter named like the declaration stay silent; a row handle with another name too", () => {
    expect(inApp("    <xs:int[]=([1])/>", "<each in=@xs as dropdown><p>${dropdown}</p></each>")).toEqual([]);
    expect(inApp("    function f(dropdown: int) { let k = dropdown }\n    function g() { let dropdown = 1 }")).toEqual([]);
    expect(inApp("    <xs:int[]=([1])/>", "<each in=@xs as x>" + DD("pick") + "</each>")).toEqual([]);
  });
  test("r4 (d) twins — a name no visible declaration holds; a declaration visible only in ANOTHER file", () => {
    expect(inApp("    <let dropdownOpen:bool=false/>", DD("picker"))).toEqual([]);
    const other = { path: "lib/other.scrml", src: "<card title:string=\"\"/>\nrenders <p>x</p>\n" };
    expect(codes([other, { path: "app.scrml", src: "<program>\n    <let card:int=0/>\n<main><p>x</p></main>\n</program>\n" }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #6 — a duplicate top-level `function` is E-SCOPE-010 (§7.6). ruling: S440 22-item #6
// "duplicate top-level `function` → E-SCOPE-010, §7.6 text fixed to name `function`".
// ---------------------------------------------------------------------------
describe("#6 — a duplicate top-level `function` (E-SCOPE-010)", () => {
  test("E-SCOPE-010 — two `function f` in one `<program>`; two `fn f`; a `function` and a `fn`", () => {
    expect(inApp("    function f() { }\n    function f() { }")).toEqual(["E-SCOPE-010"]);
    expect(inApp("    fn f() -> int { return 1 }\n    fn f() -> int { return 2 }")).toEqual(["E-SCOPE-010"]);
    expect(inApp("    function f() { }\n    fn f() -> int { return 2 }")).toEqual(["E-SCOPE-010"]);
  });
  test("E-SCOPE-010 — two top-level `function f` in one library file", () => {
    const lib = { path: "lib/a.scrml", src: "${ export function f() -> int { return 1 }\n function f() -> int { return 2 } }\n" };
    const main = { path: "app.scrml", src: "${ import { f } from \"./lib/a.scrml\" }\n<program>\n<main><p>${f()}</p></main>\n</program>\n" };
    expect(codes([lib, main])).toEqual(["E-SCOPE-010"]);
  });
  test("twins silent — two distinct names; one name as a function and as a LOCAL in another function", () => {
    expect(inApp("    function f() { }\n    function g() { }")).toEqual([]);
    expect(inApp("    function f() { }\n    function g() { let f = 1 }")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Duplicate keys in ANY struct literal — E-STRUCT-DUPLICATE-KEY (§14.3; the spread-override half:
// front.test.js). ruling: S440 "duplicate keys are an error in ANY struct literal" — "a duplicate
// key in any struct literal (plain, nested, or the spread-override shape) is a compile error".
// ---------------------------------------------------------------------------
describe("duplicate struct-literal keys (E-STRUCT-DUPLICATE-KEY)", () => {
  const P = "    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n";
  const N = "    type Q:struct = { let a: int }\n    type R:struct = { let q: Q, let b: int }\n    <let r:R=({ q: { a: 1 }, b: 2 })/>\n";
  test("a PLAIN literal written to a cell — the ruling's own `{ x: 5, x: 6, y: 1 }`", () => {
    expect(inApp(P + "    function f() { @p = { x: 5, x: 6, y: 1 } }")).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
  });
  test("a NESTED literal", () => {
    expect(inApp(N + "    function f() { @r = { q: { a: 1, a: 2 }, b: 3 } }")).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
  });
  test("a literal as a declaration's initializer, and as an annotated local's", () => {
    expect(inApp("    type P:struct = { x: int, y: int }\n    <p:P=({ x: 1, x: 2, y: 3 })/>")).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
    expect(inApp("    type P:struct = { x: int, y: int }\n    function f() { let v: P = { x: 1, y: 2, y: 3 } }")).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
  });
  test("a literal with NO struct context still reports its duplicate (beside the context error)", () => {
    expect(inApp("    function f() { let v = { x: 1, x: 2 } }")).toEqual(["E-STRUCT-DUPLICATE-KEY", "E-TYPE-STRUCT-CONTEXT"]);
  });
  test("three of one key report twice, at the repeats; the message names the key", () => {
    const d = diagsIn(P + "    function f() { @p = { x: 5, y: 1, x: 6, x: 7 } }");
    expect(d.map((x) => x.code)).toEqual(["E-STRUCT-DUPLICATE-KEY", "E-STRUCT-DUPLICATE-KEY"]);
    expect(d[0].message).toContain("`x` is named twice");
  });
  test("twins silent — each key once (plain, nested, initializer)", () => {
    expect(inApp(P + "    function f() { @p = { x: 5, y: 1 } }")).toEqual([]);
    expect(inApp(N + "    function f() { @r = { q: { a: 1 }, b: 3 } }")).toEqual([]);
    expect(inApp("    type P:struct = { x: int, y: int }\n    <p:P=({ x: 1, y: 3 })/>")).toEqual([]);
  });
  test("the retired bootstrap-local code is gone", () => {
    expect(inApp(P + "    function f() { @p = { ...@p, x: 5, x: 6 } }")).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
  });
});

// A struct cell with `T | not` fields (the slice parses no `T | not` cell opener — S439 M1 — so a
// `T | not` value reaches a condition through a field, a parameter or an annotated local).
const O = "    type O:struct = { let v: string | not, let n: int | not, let f: bool | not }\n    <let o:O=({ v: \"\", n: 0, f: false })/>\n    <let m:int=0/>\n";
const CELLS = "    <let n:int=0/>\n    <let r:number=0.5/>\n    <let s:string=\"\"/>\n    <let b:bool=false/>\n    <xs:int[]=([1])/>\n";
// a one-declaration library and an app that uses it
const boxLibS = (decl) => ({ path: "lib/box.scrml", src: decl });
const boxAppS = (use) => ({ path: "app.scrml", src: `\${ import { box } from "./lib/box.scrml" }\n<program>\n    <main>\n${use}\n    </main>\n</program>\n` });

// ---------------------------------------------------------------------------
// #7 — truthiness (c) + Q1 / Q2: a condition needs a `bool` or a `T | not` presence test.
// ruling: S440 "#4 = (c) — All conditions require a boolean, or a `T | not` presence test, and the
// truthiness of numbers and strings goes"; truthiness Q1 "a bare `@x` of type `T | not` IS a presence
// test (§42.4 already says so); the compiler emits an absence check, never JS truthiness"; Q2 "an
// immediate error wherever the violation is PROVABLE, silence where the type is unknown
// (provable-or-silent); no §63 window". Code PROPOSED (no SPEC text yet): E-COND-NOT-BOOLEAN.
// ---------------------------------------------------------------------------
describe("#7 — conditions (E-COND-NOT-BOOLEAN) and presence tests", () => {
  test("E-COND-NOT-BOOLEAN — `if=` over an int, a number, a string, a sequence", () => {
    for (const x of ["@n", "@r", "@s", "@xs"]) expect(inApp(CELLS, `<p if=${x}>x</p>`)).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("E-COND-NOT-BOOLEAN — an `if` statement, a ternary test, an `if=` on a USE", () => {
    expect(inApp(CELLS + "    function f() { if (@n) { @b = true } }")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inApp(CELLS, "<p>${@s ? \"a\" : \"b\"}</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inApp("    <let label:string=\"\"/>", "<dropdown if=@label label=\"1\" options=([\"a\"])/>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("enforced inside an inline handler block too (JS-WAT 11: \"every rule … is enforced in those bodies too\")", () => {
    expect(inApp(CELLS, "<button onclick={ if (@n) { @b = true } }>x</button>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inApp(CELLS, "<button onclick={ @n = @s - 1 }>x</button>")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("the message names the value's type and the explicit comparison", () => {
    const d = diagsIn(CELLS, "<p if=@n>x</p>");
    expect(d[0].message).toContain("`int`");
    expect(d[0].message).toContain("n > 0");
  });
  test("twins silent — a bool cell, a comparison, `&&` of bools, a negated bool", () => {
    expect(inApp(CELLS, "<p if=@b>x</p><p if=(@n > 0)>x</p><p if=(@b && @n > 0)>x</p><p if=(!@b)>x</p>")).toEqual([]);
    expect(inApp(CELLS + "    function f() { if (@s != \"\") { @b = true } }")).toEqual([]);
  });
  test("Q1 — a bare `T | not` condition is a PRESENCE TEST: silent, and recorded for lowering", () => {
    const r = run([LIB(), app(O, "<p class=\"v\" if=@o.v>V</p>")]);
    expect(r.diags).toEqual([]);
    const t = r.typed.tables;
    expect(t.typing.presence.length).toBe(1);
    expect(mods.analyze.presenceTest(t, t.typing.presence[0])).toBe(true);
  });
  test("Q1 — a CONDITIONALLY-mounted handle is `T | not` (§66.7.5): `if=@color` is a presence test (r4 (b): legal); an always-mounted one is not", () => {
    expect(inApp("    <let show:bool=false/>", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div><p if=@color>x</p>"))
      .toEqual([]);
    expect(inApp("", "<dropdown as=country label=\"1\" options=([\"a\"])/><p if=@country>x</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("r4 (f) — `${@o.n}` in markup WITHOUT narrowing stays silent (ruled S442: `${not}` renders nothing; Q3's \"template\" is string templates only)", () => {
    expect(inApp(O, "<p>${@o.n}</p><p>${@o.v}</p><p>${@o.f}</p>")).toEqual([]);
    // twin: the same value under an operator in markup is still Q3
    expect(inApp(O, "<p>${@o.n + 1}</p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("r4 (a) — a bare `bool | not` condition is E-COND-NOT-BOOLEAN naming both fixes (ruled S442)", () => {
    const d = run([LIB(), app(O, "<p if=@o.f>x</p>")]).diags;
    expect(d.map((x) => x.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(d[0].message).toContain("x != not");
    expect(d[0].message).toContain("x == true");
    expect(inApp(O + "    function f() { if (@o.f) { @m = 1 } }")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("r4 (a) twins — `@o.f == true`, `@o.f != not`, and a NARROWED `bool | not` (a value test) are legal", () => {
    expect(inApp(O, "<p if=(@o.f == true)>x</p><p if=(@o.f != not)>y</p>")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.f != not) { if (@o.f) { @m = 1 } } }")).toEqual([]);
  });
  test("r4 (b) — a presence test of a CONDITIONAL handle is legal and narrows reads inside (ruled S442)", () => {
    const S = "    <let show:bool=false/>\n    <let seen:string=\"\"/>\n";
    const DDC = "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>";
    expect(inApp(S, DDC + "<p if=@color>${@color.value}</p>")).toEqual([]);
    expect(inApp(S + "    function f() { if (@color) { @seen = @color.value } }\n    function g() { @seen = @color ? @color.value : \"\" }", DDC)).toEqual([]);
  });
  test("the typer's table records a conditional handle read as `T | not` (§66.7.5), an always-mounted one as `T`", () => {
    const r = run([LIB(), app("    <let show:bool=false/>", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div><dropdown as=country label=\"2\" options=([\"a\"])/><p if=@color>x</p><p>${@country.value}</p>")]);
    const t = r.typed.tables;
    const atNodes = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.k && n.k.variant === "At") atNodes.push({ nid: n.nid, name: n.k.data.name });
      Object.values(n).forEach(walk);
    })(r.asts);
    const color = atNodes.find((a) => a.name === "color");
    const country = atNodes.find((a) => a.name === "country");
    const cv = mods.analyze.exprType(t, color.nid);
    expect(cv.variant).toBe("Known");
    expect(cv.data.t.variant).toBe("Maybe");
    expect(mods.analyze.exprType(t, country.nid).data.t.variant).toBe("Named");
  });
  test("r5 R3 — a REPEATED presence test inside a region that already narrowed the handle stays legal", () => {
    const S = "    <let show:bool=false/>\n    <let seen:string=\"\"/>\n";
    const DDC = "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>";
    expect(inApp(S, DDC + "<div if=@color><p if=@color>${@color.value}</p></div>")).toEqual([]);
    expect(inApp(S + "    function f() { if (@color) { if (@color) { @seen = @color.value } } }", DDC)).toEqual([]);
    expect(inApp(S + "    function f() { if (@color) { @seen = @color ? @color.value : \"\" } }", DDC)).toEqual([]);
    // twin: an ALWAYS-mounted handle is still not a condition
    expect(inApp(S, "<dropdown as=country label=\"1\" options=([\"a\"])/><div if=@show><p if=@country>x</p></div>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("r4 (b) twins — the S437 rule still binds OUTSIDE the test: a sibling read, an else branch", () => {
    const S = "    <let show:bool=false/>\n    <let seen:string=\"\"/>\n";
    const DDC = "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>";
    expect(inApp(S, DDC + "<p if=@color>x</p><p>${@color.value}</p>")).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
    expect(inApp(S + "    function f() { if (@color) { @seen = \"\" } else { @seen = @color.value } }", DDC)).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });
  test("Q1 — a `bool` condition is NOT recorded as a presence test", () => {
    const r = run([LIB(), app(CELLS, "<p if=@b>x</p>")]);
    expect(r.typed.tables.typing.presence).toEqual([]);
  });
  test("Q2 provable-or-silent — a call with no declared return type (Unknown) as a condition is silent", () => {
    expect(inApp("    function g() { }", "<p if=g()>x</p>")).toEqual([]);
  });
  test("Q2 provable-or-silent — a call DECLARED `-> int` as a condition fires", () => {
    expect(inApp("    function g() -> int { return 1 }", "<p if=g()>x</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
});

// Q1 at RUNTIME: `""` and `0` are PRESENT (S89: defined values, not absence) — a presence test
// renders them where JS truthiness would not.
const PRESENCE = `<program>
    type O:struct = { let v: string | not, let n: int | not }
    <let o:O=({ v: "", n: 0 })/>
    <let out:string="?"/>
    function clear() { @o = { v: not, n: not } }
    function probe() {
        if (@o.n) { @out = "present" } else { @out = "absent" }
    }
    <main>
        <p class="v" if=@o.v>V</p>
        <p class="n" if=@o.n>N</p>
        <p class="t">\${@o.v ? "yes" : "no"}</p>
        <p class="out">\${@out}</p>
        <button class="probe" onclick=probe()>probe</button>
        <button class="clear" onclick=clear()>clear</button>
    </main>
</program>
`;

describe("#7 Q1 at runtime — a presence test lowers to an absence check, never JS truthiness", () => {
  test("`if=` / `if` / ternary over `\"\"` and `0` see them PRESENT; over `not`, absent", async () => {
    const r = run([{ path: "presence.scrml", src: PRESENCE }]);
    expect(codes([{ path: "presence.scrml", src: PRESENCE }])).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "s442-presence");
    expect(document.querySelector("p.v")).not.toBeNull();
    expect(document.querySelector("p.n")).not.toBeNull();
    expect(document.querySelector("p.t").textContent).toBe("yes");
    click(document.querySelector("button.probe"));
    expect(document.querySelector("p.out").textContent).toBe("present");
    click(document.querySelector("button.clear"));
    expect(document.querySelector("p.v")).toBeNull();
    expect(document.querySelector("p.n")).toBeNull();
    expect(document.querySelector("p.t").textContent).toBe("no");
    click(document.querySelector("button.probe"));
    expect(document.querySelector("p.out").textContent).toBe("absent");
  });
});

// r4 (b) at RUNTIME: `if=@color` over a conditionally-mounted handle renders only while it is mounted.
const HANDLE_PRESENCE = `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }
<program>
    <let show:bool=false/>
    function toggle() { @show = !@show }
    <main>
        <div if=@show><dropdown as=color label="C" options=(["a"])/></div>
        <p class="c" if=@color>V=\${@color.value}</p>
        <p class="d">\${@color ? "D" : "-"}</p>
        <button class="t" onclick=toggle()>t</button>
    </main>
</program>
`;

describe("r4 (b) at runtime — a handle presence test is an absence check", () => {
  test("`if=@color` / `if=(@color != not)` render only while the instance is mounted", async () => {
    const files = [LIB(), { path: "app.scrml", src: HANDLE_PRESENCE }];
    const r = run(files);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "s442-handle-presence");
    expect(document.querySelector("p.c")).toBeNull();
    expect(document.querySelector("p.d").textContent).toBe("-");
    click(document.querySelector("button.t"));
    expect(document.querySelector("p.c").textContent).toBe("V=");
    expect(document.querySelector("p.d").textContent).toBe("D");
    click(document.querySelector("button.t"));
    expect(document.querySelector("p.c")).toBeNull();
    expect(document.querySelector("p.d").textContent).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// #7 / #8 — Gotcha Q2: "`!`, `&&`, `||` (and `and`/`or`) take booleans only; defaults use `??`".
// Code PROPOSED: E-OPERATOR-OPERAND-TYPE (a `bool | not` operand un-narrowed: E-OPERAND-NOT-NARROWED).
// ---------------------------------------------------------------------------
describe("#7 / #8 — `!` / `&&` / `||` take booleans only (Gotcha Q2)", () => {
  test("E-OPERATOR-OPERAND-TYPE — `!` of an int; an int under `&&`; both strings of the `||` default idiom", () => {
    expect(inApp(CELLS + "    function f() { @b = !@n }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @b = @b && @n }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @s = @s || \"x\" }")).toEqual(["E-OPERATOR-OPERAND-TYPE", "E-OPERATOR-OPERAND-TYPE"]);
  });
  test("E-OPERATOR-OPERAND-TYPE — a `string | not` under `!` is not a bool even when present (write `x == not`)", () => {
    expect(inApp(O + "    function f() { if (!@o.v) { @m = 1 } }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("E-OPERAND-NOT-NARROWED — a `bool | not` under `!`, un-narrowed", () => {
    expect(inApp(O + "    function f() { if (!@o.f) { @m = 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a legal `&&` / `||` is a `bool` (Q2 supersedes §45.9's JS operand semantics): into an int cell is E-TYPE-031", () => {
    expect(inApp(CELLS + "    function g() { }\n    function f() { @n = @b || g() }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    function g() { }\n    function f() { @b = @b || g() }")).toEqual([]);
    // r1 F1: the `&&` arm pinned the same way
    expect(inApp(CELLS + "    function g() { }\n    function f() { @n = @b && g() }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    function g() { }\n    function f() { @b = @b && g() }")).toEqual([]);
  });
  test("twins silent — bools; a narrowed `bool | not`; a presence comparison", () => {
    expect(inApp(CELLS + "    function f() { @b = !@b && (@n > 0 || @s == \"\") }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.f != not && !@o.f) { @m = 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.v == not) { @m = 1 } }")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #8 — operators. Gotcha Q1: "arithmetic and relational operators take NUMBERS only; `+` takes two
// numbers or two strings; string ordering goes through an explicit compare". Gotcha Q3: "a `T | not`
// operand must be narrowed before `+`, arithmetic, comparison, or use in a template". Codes PROPOSED:
// E-OPERATOR-OPERAND-TYPE, E-OPERAND-NOT-NARROWED.
// ---------------------------------------------------------------------------
describe("#8 — arithmetic / relational / `+` operands (Gotcha Q1)", () => {
  test("E-OPERATOR-OPERAND-TYPE — a string under `-` / `*` / `%`, a bool under `+`, unary `-` of a string", () => {
    expect(inApp(CELLS + "    function f() { @n = @s - 1 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @n = @s * 2 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @n = @s % 2 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @n = @b + 1 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(inApp(CELLS + "    function f() { @n = -@s }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("E-OPERATOR-OPERAND-TYPE — `string + int` (the #1 measured leak), once, at the `+`", () => {
    const d = diagsIn(CELLS + "    function f() { @s = @s + @n }");
    expect(d.map((x) => x.code)).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(d[0].message).toContain("`string + int`");
  });
  test("E-OPERATOR-OPERAND-TYPE — string ordering `<` (both operands)", () => {
    expect(inApp(CELLS + "    function f() { @b = @s < \"m\" }")).toEqual(["E-OPERATOR-OPERAND-TYPE", "E-OPERATOR-OPERAND-TYPE"]);
  });
  test("E-OPERATOR-OPERAND-TYPE — `not` as an operand", () => {
    expect(inApp(CELLS + "    function f() { @n = not + 1 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("a refused operation has no type (no second E-TYPE-031 for the same mistake)", () => {
    expect(inApp(CELLS + "    function f() { @n = @s + 1 }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("twins silent — int / number arithmetic, string + string, numeric relational, `%`", () => {
    expect(inApp(CELLS + "    function f() { @n = @n + 1\n @r = @r * 2 + @n\n @s = @s + \"x\"\n @b = @n < 3 && @r >= 0.5\n @n = @n % 2\n @n = -@n }")).toEqual([]);
  });
  test("Rule C — an operation whose span holds a parser error is not judged (the shape of conformance channel/watches-derived-const-ok)", () => {
    // `const <threshold> = …` misparses as `(const < threshold) > <error>`: the outer `>` would see a bool operand
    const src = "<program>\n  ${ @maxTotal = 5 }\n  <main>\n    ${ const <threshold> = @maxTotal * 2 }\n  </main>\n</program>\n";
    const cs = codes([{ path: "case.scrml", src }]);
    expect(cs).toContain("E-PARSE-EXPR");
    expect(cs).not.toContain("E-OPERATOR-OPERAND-TYPE");
  });
  test("Rule C (r1 F2) — a CONDITION whose span holds a parser error is not judged (`g(#)` is declared `-> int`)", () => {
    const G = "    function g(a: int) -> int { return a }\n";
    expect(inApp(CELLS + G + "    function f() { if (g(#)) { @b = true } }", "<p if=g(#)>x</p>")).toEqual(["E-PARSE-EXPR", "E-PARSE-EXPR"]);
    expect(inApp(CELLS + G + "    function f() { if (g(1)) { @b = true } }")).toEqual(["E-COND-NOT-BOOLEAN"]);   // twin: no parse error → judged
  });
  test("provable-or-silent — an operand of unknown type (a call with no return type) is silent", () => {
    expect(inApp(CELLS + "    function g() { }\n    function f() { @s = @s + g()\n @b = g() < 1 }")).toEqual([]);
  });
});

describe("#8 — a `T | not` operand must be narrowed first (Gotcha Q3)", () => {
  test("E-OPERAND-NOT-NARROWED — `int | not` under `+` / `>`; `string | not` under `+`", () => {
    expect(inApp(O + "    function f() { @m = @o.n + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { if (@o.n > 0) { @m = 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    <let t:string=\"\"/>\n    function f() { @t = @o.v + \"!\" }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("E-OPERAND-NOT-NARROWED — a `T | not` PARAMETER and an ANNOTATED local", () => {
    expect(inApp("    function f(a: int | not) -> int { return a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp("    <let m:int=0/>\n    function f() { let a: int | not = 5\n @m = a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("the message says how to narrow", () => {
    expect(diagsIn(O + "    function f() { @m = @o.n + 1 }")[0].message).toContain("!= not");
  });
  test("narrowed — `if (x != not)`, `x != not && …`, a ternary arm, `if (x)` (a presence test)", () => {
    expect(inApp(O + "    function f() { if (@o.n != not) { @m = @o.n + 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (not != @o.n) { @m = @o.n + 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n != not && @o.n > 0) { @m = 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { @m = @o.n != not ? @o.n + 1 : 0 }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n) { @m = @o.n + 1 } }")).toEqual([]);
  });
  test("narrowed — the `else` of `x == not`, `x == not || …`, after an early `return`, a parameter", () => {
    expect(inApp(O + "    function f() { if (@o.n == not) { @m = 0 } else { @m = @o.n + 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n == not || @o.n > 0) { @m = 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n == not) { return }\n @m = @o.n + 1 }")).toEqual([]);
    expect(inApp("    function f(a: int | not) -> int { if (a == not) { return 0 }\n return a + 1 }")).toEqual([]);
  });
  test("narrowed — an element under `if=(x != not)`: its children and other attributes", () => {
    expect(inApp(O, "<p if=(@o.n != not)>${@o.n + 1}</p>")).toEqual([]);
  });
  test("NOT narrowed — the THEN branch of `x == not`; after a write of the place; outside the `if`", () => {
    expect(inApp(O + "    function f() { if (@o.n == not) { @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { if (@o.n != not) { @o.n = not\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { if (@o.n != not) { @m = 1 }\n @m = @o.n + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O, "<p if=(@o.n != not)>x</p><p>${@o.n + 1}</p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  const CLEAR = "    <let flag:bool=false/>\n    function clear() { @o = { v: not, n: not, f: not } }\n";
  test("r2 F1a — a CALL whose callee writes the place drops the narrowing (statement, handler under `if=`, transitive)", () => {
    expect(inApp(O + CLEAR + "    function f() { if (@o.n != not) { clear()\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CLEAR, "<button if=(@o.n != not) onclick={ clear(); @m = @o.n + 1 }>x</button>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CLEAR + "    function outer() { clear() }\n    function f() { if (@o.n != not) { outer()\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("r3 N1 — the right operand of `&&` / `||` is not narrowed across a call in the LEFT operand that writes the place", () => {
    const CB = "    <let bb:bool=false/>\n    function clearB() -> bool { @o = { v: not, n: not, f: not }\n return true }\n";
    expect(inApp(O + CB + "    function f() { if (@o.n != not && clearB() && @o.n + 1 > 0) { @m = 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CB + "    function f() { @bb = @o.n != not && clearB() && @o.n + 1 > 0 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CB + "    function f() { @bb = @o.n == not || !clearB() || @o.n + 1 > 0 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("r3 N1 twin — a left-operand call that writes OTHER places keeps the narrowing", () => {
    const KB = "    <let bb:bool=false/>\n    function keepB() -> bool { @m = 3\n return true }\n";
    expect(inApp(O + KB + "    function f() { @bb = @o.n != not && keepB() && @o.n + 1 > 0 }")).toEqual([]);
    expect(inApp(O + KB + "    function f() { @bb = @o.n == not || !keepB() || @o.n + 1 > 0 }")).toEqual([]);
  });
  const XS = "    <xs:O[replace]=([{ v: \"\", n: 0, f: false }])/>\n    function clearXs() { @xs = [{ v: not, n: not, f: not }] }\n    function other() { @m = 2 }\n";
  const row = (body) => `<each in=@xs as x><p if=(x.n != not)><button onclick={ ${body}\n @m = x.n + 1 }>b</button></p></each>`;
  test("r3 N3 — a write of an `<each>` source (direct, or by a callee) drops the row binding's narrowing", () => {
    expect(inApp(O + XS, row("clearXs()"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + XS, row("@xs = [{ v: not, n: not, f: not }]"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("r3 N3 twin — a write elsewhere keeps the row narrowing; the narrowed row read itself is silent", () => {
    expect(inApp(O + XS, row("other()"))).toEqual([]);
    expect(inApp(O + XS, row("@o.n = not"))).toEqual([]);
    expect(inApp(O + XS, "<each in=@xs as x><p if=(x.n != not)>${x.n + 1}</p></each>")).toEqual([]);
  });
  test("r5 R1 — N3 at depth: writing the OUTER source of a nested `<each>` drops the inner row's narrowing", () => {
    const G = "    type G:struct = { let name: string, let kids: O[] }\n    <gs:G[replace]=([{ name: \"a\", kids: [{ v: \"\", n: 0, f: false }] }])/>\n    function clearGs() { @gs = [{ name: \"b\", kids: [{ v: not, n: not, f: not }] }] }\n    function other() { @m = 2 }\n";
    const nested = (body) => `<each in=@gs as g><each in=g.kids as y><p if=(y.n != not)><button onclick={ ${body}\n @m = y.n + 1 }>b</button></p></each></each>`;
    expect(inApp(O + G, nested("clearGs()"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + G, nested("@gs = []"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
    // twins: a write elsewhere; the narrowed inner read with no write
    expect(inApp(O + G, nested("other()"))).toEqual([]);
    expect(inApp(O + G, "<each in=@gs as g><each in=g.kids as y><p if=(y.n != not)>${y.n + 1}</p></each></each>")).toEqual([]);
  });
  test("r2 F1a twin — a call whose callee writes OTHER places keeps the narrowing", () => {
    expect(inApp(O + "    function h() { @m = 2\n @o.v = \"x\" }\n    function f() { if (@o.n != not) { h()\n @m = @o.n + 1 } }")).toEqual([]);
  });
  test("r2 F1b — a write in a NESTED block un-narrows after it (the if joins its paths); a local too", () => {
    expect(inApp(O + CLEAR + "    function f() { if (@o.n != not) { if (@flag) { @o.n = not }\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CLEAR + "    function f() { let a: int | not = @o.n\n if (a != not) { if (@flag) { a = not }\n @m = a + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + CLEAR + "    function f() { let a: int | not = @o.n\n if (a != not) { a = not\n @m = a + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("r2 F1b twin — a nested write that keeps the place present, or a nested block that writes nothing", () => {
    expect(inApp(O + CLEAR + "    function f() { if (@o.n != not) { if (@flag) { @o.n = 3 }\n @m = @o.n + 1 } }")).toEqual([]);
    expect(inApp(O + CLEAR + "    function f() { if (@o.n != not) { if (@flag) { @m = 0 }\n @m = @o.n + 1 } }")).toEqual([]);
  });
  test("r2 F3 — a write of a PROVABLY present value narrows the place (inside, and after an `if` both paths leave present)", () => {
    expect(inApp(O + "    function f() { if (@o.n != not) { @o.n = 5\n @m = @o.n + 1 } }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n == not) { @o.n = 5 }\n @m = @o.n + 1 }")).toEqual([]);
    expect(inApp(O + "    function f() { @o.n = 5\n @m = @o.n + 1 }")).toEqual([]);
  });
  test("r2 F3 twin — a write of `not` or of a `T | not` value does not narrow", () => {
    expect(inApp(O + "    function f() { @o.n = not\n @m = @o.n + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f(k: int | not) { @o.n = k\n @m = @o.n + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { if (@o.n == not) { @m = 0 }\n @m = @o.n + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a local joined from `not` and a value: silent where it is PROVABLY present (the write of `5` narrows it)", () => {
    expect(inApp("    <let m:int=0/>\n    function f() { let a = not\n a = 5\n @m = a + 1 }")).toEqual([]);
  });
  test("r2 follow-through — the joined-local carve-out is gone: a local that MAY still be `not` is reported", () => {
    expect(inApp("    <let m:int=0/>\n    <let flag:bool=false/>\n    function f() { let a = not\n if (@flag) { a = 5 }\n @m = a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    // twin: both paths leave it present
    expect(inApp("    <let m:int=0/>\n    <let flag:bool=false/>\n    function f() { let a = not\n if (@flag) { a = 5 } else { a = 6 }\n @m = a + 1 }")).toEqual([]);
  });
  test("r2 F2 — a local that COPIES a `T | not` (a place, a `const`, a call) carries a real `| not`: reported", () => {
    expect(inApp(O + "    function f() { let a = @o.n\n @m = a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    <let t:string=\"\"/>\n    function f() { const z = @o.v\n @t = z + \"!\" }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function g() -> int | not { return 1 }\n    function f() { let a = g()\n @m = a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { let a = 5\n a = @o.n\n @m = a + 1 }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    // (r2 F3: `let a = @o.n; a = 5; @m = a + 1` is SILENT — the write of a present `5` narrows `a`)
    expect(inApp(O + "    function f() { let a = @o.n\n a = 5\n @m = a + 1 }")).toEqual([]);
  });
  test("r2 F2 twin — the copy, narrowed, is silent", () => {
    expect(inApp(O + "    function f() { let a = @o.n\n if (a != not) { @m = a + 1 } }")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #9 — `int` enforced (JS-WAT 7(a): "enforce `int` (bootstrap typer; `7 / 2` into `int` is an error;
// integer division explicit)"; PA note "§7.5.1's provable domain widens to `int` with it") and dpa-054
// #3 ("`/` between two `int`s … is a compile error naming the fix … `div(a, b, .Mode)`"). The `div`
// function and `decimal` are NOT built here (a separate dispatch). Code PROPOSED: E-INT-DIVISION.
// ---------------------------------------------------------------------------
describe("#9 — `int` enforced; `/` on two ints names `div`", () => {
  test("E-INT-DIVISION — `7 / 2` into an int cell, once (no cascading E-TYPE-031)", () => {
    const d = diagsIn(CELLS + "    function f() { @n = 7 / 2 }");
    expect(d.map((x) => x.code)).toEqual(["E-INT-DIVISION"]);
    expect(d[0].message).toContain("div(a, b, .Mode)");
  });
  test("r1 F3 — one report per mistake: un-narrowed `int | not` operands of `/` are reported, and E-INT-DIVISION waits for them", () => {
    expect(inApp(O + "    function f() { @m = @o.n / @o.n }")).toEqual(["E-OPERAND-NOT-NARROWED", "E-OPERAND-NOT-NARROWED"]);
    expect(inApp(O + "    function f() { if (@o.n != not) { @m = @o.n / @o.n } }")).toEqual(["E-INT-DIVISION"]);
  });
  test("E-INT-DIVISION — `/` on two ints in ANY position (into a number cell, a `-> int` return)", () => {
    expect(inApp(CELLS + "    function f() { @r = @n / 2 }")).toEqual(["E-INT-DIVISION"]);
    expect(inApp("    function half(k: int) -> int { return k / 2 }")).toEqual(["E-INT-DIVISION"]);
  });
  test("E-TYPE-031 — a `number` into an `int` (a cell write, a non-integer literal write); the message says `int` is enforced", () => {
    const d = diagsIn(CELLS + "    function f() { @n = @r }");
    expect(d.map((x) => x.code)).toEqual(["E-TYPE-031"]);
    expect(d[0].message).toContain("`int` is enforced");
    expect(inApp(CELLS + "    function f() { @n = 2.5 }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — an `int` annotation given a non-integer literal (JS-WAT #44: `<lit>: int = 1.5`, `let k: int = 1.5`)", () => {
    expect(inApp("    <let q:int=1.5/>")).toEqual(["E-TYPE-031"]);
    expect(inApp("    function f() { let k: int = 1.5 }")).toEqual(["E-TYPE-031"]);
    expect(inApp("    function f() { let k: int = \"s\" }")).toEqual(["E-TYPE-031"]);
  });
  test("r2 F4 — a hex / binary / octal literal is an INTEGER literal (`0xE`'s `E` is a digit, not an exponent)", () => {
    // (the slice lexer scans hex only — `0b…` / `0o…` are E-PARSE-TRAILING there; the classifier covers them anyway)
    expect(inApp("    <let q:int=0xE/>\n    <let p:int=0XFE/>\n    function f() { @q = 0xFE }")).toEqual([]);
    expect(inApp(CELLS + "    function f() { @r = 0xFE / 2 }")).toEqual(["E-INT-DIVISION"]);
    // twin: a real exponent stays a non-integer literal (`1e3` into `int` is bryan's open question — unchanged)
    expect(inApp("    <let q:int=1e3/>")).toEqual(["E-TYPE-031"]);
  });
  test("r4 (c) — `int` enforced at RETURNS (ruled S442)", () => {
    expect(inApp(CELLS + "    function h() -> int { return 2.5 }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    function h() -> int { return @r }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    function h() -> int | not { return @r }")).toEqual(["E-TYPE-031"]);
    // twins: an int; `not` into `int | not`; a non-int return type is not widened
    expect(inApp(CELLS + "    function h() -> int { return @n + 1 }\n    function k() -> int | not { return not }\n    function s() -> string { return 5 }")).toEqual([]);
  });
  test("r4 (c) — `int` enforced at ARGUMENTS into an `int` parameter", () => {
    expect(inApp(CELLS + "    function g(k: int) { }\n    function f() { g(@r) }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    function g(k: int) { }\n    function f() { g(1.5) }")).toEqual(["E-TYPE-031"]);
    // twins: an int argument; a number into a `number` parameter; a string parameter is not widened
    expect(inApp(CELLS + "    function g(k: int, x: number, s: string) { }\n    function f() { g(@n, @r, 5) }")).toEqual([]);
  });
  test("r4 (c) — `int` enforced at ALL initializers (non-literal local / cell / use-site, struct-literal fields, `int[]` elements)", () => {
    expect(inApp(CELLS + "    function f() { let k: int = @r }")).toEqual(["E-TYPE-031"]);
    expect(inApp(CELLS + "    <let q:int=(@r)/>")).toEqual(["E-TYPE-031"]);
    expect(inApp("    type P:struct = { x: int }\n    <p:P=({ x: 2.5 })/>")).toEqual(["E-TYPE-031"]);
    expect(inApp("    <ks:int[]=([1.5])/>")).toEqual(["E-TYPE-031"]);
    expect(inApp("    function f() { let ks: int[] = [1, 2.5] }")).toEqual(["E-TYPE-031"]);
    expect(codes([boxLibS("export <box n:int=0/>\nrenders <p>${n}</p>\n"), boxAppS("<box n=(0.5 * 2)/>")])).toEqual(["E-TYPE-031"]);
  });
  test("r5 R6 — an UN-NARROWED `int | not` into an `int` position is E-TYPE-031 (return, argument, local, cell write)", () => {
    const d = run([LIB(), app(O + "    function f() { @m = @o.n }", "<p>x</p>")]).diags;
    expect(d.map((x) => x.code)).toEqual(["E-TYPE-031"]);
    expect(d[0].message).toContain("narrow it first");
    expect(inApp(O + "    function h() -> int { return @o.n }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + "    function g(k: int) { }\n    function f() { g(@o.n) }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + "    function f() { let k: int = @o.n }")).toEqual(["E-TYPE-031"]);
  });
  test("r5 R6 twins — narrowed, or into `int | not`", () => {
    expect(inApp(O + "    function f() { if (@o.n != not) { @m = @o.n\n let k: int = @o.n } }")).toEqual([]);
    expect(inApp(O + "    function f() { let k: int | not = @o.n }")).toEqual([]);
  });
  // r6 — RULED S442 (user-voice "`T | not` into `T` is an error for all types": "A `T | not` isn't a `T`"; bryan:
  // "if the lifecycle says T | not then it can only end as not"). FLIPPED from the r5 twin `@t = @o.v` (was silent).
  test("r6 — an UN-NARROWED `T | not` into `T` is E-TYPE-031 for EVERY type (string, bool, struct, enum; write, param, return, arg, local)", () => {
    const S = "    <let t:string=\"\"/>\n    <let bb:bool=false/>\n    type P:struct = { x: int }\n    type Q:struct = { let p: P | not, let e: Openness | not }\n    <let q:Q=({ p: not, e: not })/>\n    <let pp:P=({ x: 1 })/>\n    <let oo:Openness=.Closed/>\n";
    expect(inApp(O + S + "    function f() { @t = @o.v }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function f() { @bb = @o.f }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function f() { @pp = @q.p }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function f() { @oo = @q.e }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function f(s: string | not) { @t = s }")).toEqual(["E-TYPE-031"]);
    // every position that takes a `T` — the return / argument / non-literal-initializer positions too
    expect(inApp(O + S + "    function h() -> string { return @o.v }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function g(z: string) { }\n    function f() { g(@o.v) }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + S + "    function f() { let z: string = @o.v }")).toEqual(["E-TYPE-031"]);
    // twin: those positions are NOT widened for other mismatches (§7.5.1 positions 3-5 stay unchecked for non-int types)
    expect(inApp(O + S + "    function h() -> string { return 5 }\n    function g(z: string) { }\n    function f() { g(5) }")).toEqual([]);
    const d = run([LIB(), app(O + S + "    function f() { @t = @o.v }", "<p>x</p>")]).diags;
    expect(d[0].message).toContain("narrow it first");
  });
  test("r6 — a sequence ELEMENT that may be `not` into a non-optional element type (`[@o.n]` into `int[]`)", () => {
    expect(inApp(O + "    function f() { let ks: int[] = [@o.n] }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + "    <ks:int[free, end]=([])/>\n    function f() { @ks.push(@o.n) }")).toEqual(["E-TYPE-031"]);
  });
  // (r7 N1: the `(int | not)[]` twin is deleted — the slice parser cannot spell a parenthesized element type,
  // so it checked nothing; the reachable optional-sequence twins are in "r7 B".)
  test("r6 twins — narrowed; `T | not` into `T | not`; `not` into `T | not`", () => {
    const S = "    <let t:string=\"\"/>\n    type Q:struct = { let v: string | not }\n    <let q:Q=({ v: not })/>\n";
    expect(inApp(O + S + "    function f() { if (@o.v != not) { @t = @o.v } }")).toEqual([]);
    expect(inApp(O + S + "    function f() { @q.v = @o.v\n @q.v = not }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n != not) { let ks: int[] = [@o.n] } }")).toEqual([]);
  });
  test("r7 B — an optional-SEQUENCE target still checks its elements (`[@o.n]` into `int[] | not`)", () => {
    expect(inApp(O + "    function f() { let ks: int[] | not = [@o.n] }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + "    function g(z: int[] | not) { }\n    function f() { g([@o.n]) }")).toEqual(["E-TYPE-031"]);
    expect(inApp(O + "    <let b:bool=false/>\n    function f() { let k2: int[] | not = @b ? [@o.n] : not }")).toEqual(["E-TYPE-031"]);
  });
  // r7 C: code E-TYPE-041 (§42.3.1: `not` into a non-optional type) — the code every other position already
  // emits for the `not` LITERAL (a write, an annotated local, `return not` / `g(not)` into `int`); one shape, one code.
  test("r7 C — the `not` literal into a non-optional return / argument / element is E-TYPE-041 for every type", () => {
    expect(inApp(O + "    function h() -> string { return not }")).toEqual(["E-TYPE-041"]);
    expect(inApp(O + "    function g(z: string) { }\n    function f() { g(not) }")).toEqual(["E-TYPE-041"]);
    expect(inApp(O + "    function f() { let ks: string[] = [not] }")).toEqual(["E-TYPE-041"]);
    expect(inApp(O + "    <ks:string[replace]=([])/>\n    function f() { @ks = [not, not] }")).toEqual(["E-TYPE-041", "E-TYPE-041"]);
    expect(inApp(O + "    function g(z: int[]) { }\n    function f() { g([not]) }")).toEqual(["E-TYPE-041"]);
  });
  test("r7 C twins — `not` into `T | not` (return, argument, element of `T[] | not`… as the whole value); a mixed `[1, not]` reported ONCE (E-TYPE-031)", () => {
    expect(inApp(O + "    function g(z: string | not) -> string | not { return not }\n    function f() { g(not) }")).toEqual([]);
    expect(inApp(O + "    function f() { let ks: int[] | not = not }")).toEqual([]);
    expect(inApp(O + "    function f() { let js: int[] = [1, not] }")).toEqual(["E-TYPE-031"]);
  });
  test("r7 B twins — `not` itself into `int[] | not`; a narrowed element; present elements", () => {
    expect(inApp(O + "    function f() { let ks: int[] | not = not }")).toEqual([]);
    expect(inApp(O + "    function f() { if (@o.n != not) { let ks: int[] | not = [@o.n] } }")).toEqual([]);
    expect(inApp(O + "    function g(z: int[] | not) { }\n    function f() { g([1, 2])\n g(not) }")).toEqual([]);
  });
  test("r4 (c) twins — int-typed initializers stay silent; `1e3` / `2.0` into int stay errors", () => {
    expect(inApp(CELLS + "    <let q:int=(@n * 2)/>\n    <ks:int[]=([1, 2])/>\n    function f() { let k: int = @n }")).toEqual([]);
    expect(inApp("    <let q:int=2.0/>")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — a non-integer element pushed onto an `int[]`", () => {
    expect(inApp("    <ks:int[free, end]=([])/>\n    function f() { @ks.push(1.5) }")).toEqual(["E-TYPE-031"]);
  });
  test("twins silent — `number / int` is float division; int arithmetic; an int into a number; integer literals", () => {
    expect(inApp(CELLS + "    function f() { @r = @r / 2\n @r = 7.0 / 2\n @n = @n * 2 + 1\n @r = @n }")).toEqual([]);
    expect(inApp("    <let q:int=-3/>\n    <let w:number=3/>\n    function f() { let k: int = 4\n let z: number = 4 }")).toEqual([]);
  });
});
