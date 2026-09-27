// typer.test.js — the M3 typer and scope pass (analyze.scrml "THE TYPER",
// "THE SCOPE PASS") beyond the eleven F-A pins (typer-gap.test.js):
//   - every check family, each negative with its well-typed twin;
//   - the adversarial self-probe: the adjacent shapes a value-type or
//     redeclaration check could FALSE-fire on, each asserted silent;
//   - the typer's own table: a type per expression node, keyed by NodeId;
//   - the §66.19 worked programs and the M2 fixtures: no typer / scope
//     diagnostic.
// Codes: see the governing-sentence table in
// docs/changes/s439-bootstrap-m3-typer/progress.md.

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice, compileProgram, PROGRAMS } from "./lowered.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });
const app = (decls, markup) => ({
  path: "app.scrml",
  src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }\n<program>\n${decls}\n    <main>\n${markup}\n    </main>\n</program>\n`,
});
const codes = (files) => frontEnd(mods, files).diags.map((d) => d.code);
const inApp = (decls, markup = "<p>x</p>") => codes([LIB(), app(decls, markup)]);

// A one-declaration library `lib/box.scrml` and an app that uses it.
const boxLib = (decl) => ({ path: "lib/box.scrml", src: decl });
const boxApp = (use) => ({
  path: "app.scrml",
  src: `\${ import { box } from "./lib/box.scrml" }\n<program>\n    <main>\n${use}\n    </main>\n</program>\n`,
});

// Every code the typer / scope pass can emit.
const TYPER_CODES = ["E-TYPE-031", "E-TYPE-041", "E-BOOTSTRAP-CALL-ARITY", "E-BOOTSTRAP-EACH-NOT-SEQUENCE",
  "E-SCOPE-010", "E-SCOPE-REDECLARE", "E-BOOTSTRAP-REDECLARE"];

// ---------------------------------------------------------------------------
// Writes (§66.1 rule 5) — every write shape the edit classifier produces.
// ---------------------------------------------------------------------------
describe("writes are type-checked against the target (§66.1 rule 5)", () => {
  const W = [
    { name: "`not` into an `int` cell → E-TYPE-041 (§42.3.1)", want: ["E-TYPE-041"],
      bad: ["    <let x:int=0/>\n    function f() { @x = not }"], ok: ["    <let x:int=0/>\n    function f() { @x = 1 }"] },
    { name: "an end-append of the wrong element type", want: ["E-TYPE-031"],
      bad: ["    <audit:string[free, end]=([])/>\n    function f() { @audit.push(5) }"],
      ok: ["    <audit:string[free, end]=([])/>\n    function f() { @audit.push(\"x\") }"] },
    { name: "a spread override of a struct cell (O58 (b) field edit)", want: ["E-TYPE-031"],
      bad: ["    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n    function f() { @p = { ...@p, y: \"s\" } }"],
      ok: ["    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n    function f() { @p = { ...@p, y: 5 } }"] },
    { name: "a field-at write `@p.y = …`", want: ["E-TYPE-031"],
      bad: ["    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n    function f() { @p.y = true }"],
      ok: ["    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n    function f() { @p.y = 3 }"] },
    { name: "a spread override of an INSTANCE", want: ["E-TYPE-031"],
      bad: ["    function f() { @country = { ...@country, value: 5 } }", "<dropdown as=country label=\"1\" options=([\"a\"])/>"],
      ok: ["    function f() { @country = { ...@country, value: \"CA\" } }", "<dropdown as=country label=\"1\" options=([\"a\"])/>"] },
    { name: "a transition-graph field given a non-variant", want: ["E-TYPE-031"],
      bad: ["    function f() { @country.open = 5 }", "<dropdown as=country label=\"1\" options=([\"a\"])/>"],
      ok: ["    function f() { @country.open = .Opened }", "<dropdown as=country label=\"1\" options=([\"a\"])/>"] },
    { name: "a write through a `given` narrowing", want: ["E-TYPE-031"],
      bad: ["    <let show:bool=false/>\n    function f() { given c = @color :> { c.value = 5 } }", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>"],
      ok: ["    <let show:bool=false/>\n    function f() { given c = @color :> { c.value = \"\" } }", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>"] },
    { name: "a call's declared return type", want: ["E-TYPE-031"],
      bad: ["    <let x:int=0/>\n    function h() -> string { return \"a\" }\n    function f() { @x = h() }"],
      ok: ["    <let x:int=0/>\n    function h() -> int { return 1 }\n    function f() { @x = h() }"] },
    { name: "a handler write", want: ["E-TYPE-031"],
      bad: ["    <let x:int=0/>", "<button onclick=(@x = \"s\")>x</button>"],
      ok: ["    <let x:int=0/>", "<button onclick=(@x = @x + 1)>x</button>"] },
    { name: "a write inside an inline handler block", want: ["E-TYPE-031"],
      bad: ["    <let x:int=0/>", "<button onclick={ let a = \"s\"; @x = a }>x</button>"],
      ok: ["    <let x:int=0/>", "<button onclick={ let a = 2; @x = a }>x</button>"] },
  ];
  for (const w of W) {
    test(`${w.want.join(", ")} — ${w.name}`, () => { expect(inApp(...w.bad)).toEqual(w.want); });
    test(`twin silent — ${w.name}`, () => { expect(inApp(...w.ok)).toEqual([]); });
  }
});

// ---------------------------------------------------------------------------
// Initializers (§7.5.1 position 2; a use-site value is the field's
// initializer for that instance, §66.9 rule 8).
// ---------------------------------------------------------------------------
describe("initializers — §7.5.1 position 2, exactly", () => {
  test("E-TYPE-031 — a `string` cell's own value is a number literal", () => {
    expect(inApp("    <let s:string=5/>")).toEqual(["E-TYPE-031"]);
  });
  test("twin silent — the same cell with a string literal", () => {
    expect(inApp("    <let s:string=\"5\"/>")).toEqual([]);
  });
  test("E-TYPE-031 — a quoted use-site value for a `bool` attribute", () => {
    expect(codes([boxLib("export <box ok:bool=false/>\nrenders <p>x</p>\n"), boxApp("<box ok=\"yes\"/>")])).toEqual(["E-TYPE-031"]);
  });
  test("twin silent — `ok=(true)`", () => {
    expect(codes([boxLib("export <box ok:bool=false/>\nrenders <p>x</p>\n"), boxApp("<box ok=(true)/>")])).toEqual([]);
  });
  test("E-TYPE-031 — a declaration's attribute default of the wrong primitive", () => {
    expect(codes([boxLib("export <box label:string=5/>\nrenders <p>${label}</p>\n"), boxApp("<box/>")])).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-041 — `not` as the initializer of a non-optional annotation", () => {
    expect(codes([boxLib("export <box label:string=\"\"/>\nrenders <p>${label}</p>\n"), boxApp("<box label=(not)/>")])).toEqual(["E-TYPE-041"]);
  });
  test("stays silent (SPEC-exact) — an `int` annotation is OUTSIDE §7.5.1's set (\"firing on `<n>: int = \\\"s\\\"` would invent a rule\")", () => {
    expect(inApp("    <let n:int=\"s\"/>")).toEqual([]);
    expect(codes([boxLib("export <box n:int=0/>\nrenders <p>${n}</p>\n"), boxApp("<box n=(\"s\")/>")])).toEqual([]);
  });
  test("stays silent (SPEC-exact) — a NON-literal use-site value is outside position 2's literal rule", () => {
    expect(inApp("    <n:int=3/>", "<dropdown label=(@n) options=([\"a\"])/>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Redeclaration — §7.3.3 (function-body blocks), E-SCOPE-010 (file scope),
// bootstrap-local where the SPEC is silent.
// ---------------------------------------------------------------------------
describe("a scope binds each name once", () => {
  test("E-SCOPE-REDECLARE — `let a` twice in one function block (§7.3.3)", () => {
    expect(inApp("    function f() { let a = 1\n let a = 2 }")).toEqual(["E-SCOPE-REDECLARE"]);
  });
  test("E-SCOPE-REDECLARE — a local redeclaring a parameter in the function's top-level block", () => {
    expect(inApp("    function g(a: int) { let a = 1 }")).toEqual(["E-SCOPE-REDECLARE"]);
  });
  test("legal — shadowing in a NESTED block (§7.3.3: \"legal and unaffected\")", () => {
    expect(inApp("    <let n:int=0/>\n    function f() { let a = 1\n if (@n > 0) { let a = 2 } }")).toEqual([]);
    expect(inApp("    <let n:int=0/>\n    function g(a: int) { if (@n > 0) { let a = 2 } else { let a = 3 } }")).toEqual([]);
  });
  test("legal — the same local name in two functions", () => {
    expect(inApp("    function f() { let a = 1 }\n    function g() { let a = 2 }")).toEqual([]);
  });
  test("E-BOOTSTRAP-REDECLARE — `let a` twice in an inline handler block (§7.3.3 names function bodies only)", () => {
    expect(inApp("    <let n:int=0/>", "<button onclick={ let a = 1; let a = 2; @n = a }>x</button>")).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("twin silent — one `let` per handler block", () => {
    expect(inApp("    <let n:int=0/>", "<button onclick={ let a = 1; @n = a }>x</button>")).toEqual([]);
  });
  test("E-BOOTSTRAP-REDECLARE — a handle named like a declaration (`@dropdown` is its shared instance)", () => {
    expect(inApp("", "<dropdown as=dropdown label=\"1\" options=([\"a\"])/>")).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("E-BOOTSTRAP-REDECLARE — two handles of one name in one `<each>` row", () => {
    expect(inApp("    type L:struct = { id: int, name: string }\n    <lines:L[]=([{ id: 1, name: \"a\" }])/>",
      "<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/><dropdown as=q label=\"2\" options=([\"a\"])/></each>"))
      .toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("legal — a ROW-scoped handle may reuse a program-level handle's name (§66.7.4: \"It is not an error\")", () => {
    expect(inApp("    type L:struct = { id: int, name: string }\n    <lines:L[]=([{ id: 1, name: \"a\" }])/>",
      "<dropdown as=q label=\"0\" options=([\"a\"])/>\n<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/></each>"))
      .toEqual([]);
  });
  test("E-BOOTSTRAP-REDECLARE — two fields of one declaration", () => {
    expect(codes([boxLib("export <box label:string=\"\" label:string=\"x\"/>\nrenders <p>${label}</p>\n"), boxApp("<box/>")]))
      .toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("E-BOOTSTRAP-REDECLARE — two declarations of one name in one file", () => {
    const lib = "export <box label:string=\"\"/>\nrenders <p>${label}</p>\nexport <box label:string=\"\"/>\nrenders <p>${label}</p>\n";
    expect(codes([boxLib(lib), boxApp("<box/>")])).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("E-BOOTSTRAP-UNSUPPORTED — one function name in two files (the bootstrap links one namespace)", () => {
    const lib = { path: "lib/a.scrml", src: "${ export function helper() { } }\n" };
    const main = { path: "app.scrml", src: "${ import { helper } from \"./lib/a.scrml\" }\n<program>\nfunction helper() { }\n<main><p>x</p></main>\n</program>\n" };
    expect(codes([lib, main])).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

// ---------------------------------------------------------------------------
// Calls and `<each>` (bootstrap-local codes) beyond the pins.
// ---------------------------------------------------------------------------
describe("calls and `<each in=…>`", () => {
  test("E-BOOTSTRAP-CALL-ARITY — in a handler and in markup interpolation", () => {
    expect(inApp("    function g(a: int) -> int { return a }", "<button onclick=g()>x</button>")).toEqual(["E-BOOTSTRAP-CALL-ARITY"]);
    expect(inApp("    function g(a: int) -> int { return a }", "<p>${g(1, 2)}</p>")).toEqual(["E-BOOTSTRAP-CALL-ARITY"]);
  });
  test("a `-> void` function is legal and its call is silent", () => {
    expect(inApp("    function k() -> void { }\n    function m() { k() }")).toEqual([]);
  });
  test("E-TYPE-UNKNOWN — an unknown return type name (now resolved by the binder)", () => {
    expect(inApp("    function h() -> Nope { return 1 }")).toEqual(["E-TYPE-UNKNOWN"]);
  });
  test("E-BOOTSTRAP-EACH-NOT-SEQUENCE — a string, a struct", () => {
    expect(inApp("    <s=\"abc\"/>", "<each in=@s as c><p>${c}</p></each>")).toEqual(["E-BOOTSTRAP-EACH-NOT-SEQUENCE"]);
    expect(inApp("    type P:struct = { x: int }\n    <p:P=({ x: 1 })/>", "<each in=@p as c><p>x</p></each>")).toEqual(["E-BOOTSTRAP-EACH-NOT-SEQUENCE"]);
  });
  test("twin silent — a sequence field read bare inside a declaration's renders (the library's `<each in=options>`)", () => {
    expect(codes([LIB(), app("", "<dropdown label=\"1\" options=([\"a\"])/>")])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The adversarial self-probe: shapes adjacent to the checks that must NOT
// fire. (Function-typed attributes, O8, are not parseable by the slice's front
// end — `<cb:fn()…>` is E-PARSE-TAG — so they have no control yet; neither has a
// `T | not` cell opener, `<x:string|not=…/>`, same reason.)
// ---------------------------------------------------------------------------
describe("adversarial controls — adjacent shapes stay silent", () => {
  const C = [
    ["`||` of strings into a string cell (an operand, not a bool)", "    <let s:string=\"\"/>\n    function f() { @s = @s || \"x\" }"],
    ["a ternary of ints into an int cell, with a bool test", "    <let b:bool=false/>\n    <let x:int=0/>\n    function f() { @x = @b ? 1 : 2 }"],
    ["an int into a `number` cell", "    <let r:number=0.5/>\n    function f() { @r = 2 }"],
    ["a `number` into an `int` cell (int refines number, S404 — not provable here)", "    <let r:number=0.5/>\n    <let x:int=0/>\n    function f() { @x = @r }"],
    ["`not` and a value into a `T | not` struct field", "    type O:struct = { let v: string | not }\n    <let o:O=({ v: not })/>\n    function f() { @o.v = not\n @o.v = \"a\" }"],
    ["a `T | not` parameter into a `T` cell (may be `not`: unproven, not wrong)", "    <let t:string=\"\"/>\n    function f(s: string | not) { @t = s }"],
    ["an enum variant into an enum cell", "    <let o:Openness=.Closed/>\n    function f() { @o = .Opened }"],
    ["a seeded `let` (reactive initializer) and a use-site live value", "    <let src:string=\"a\"/>\n    <let draft:string=@src/>", "<dropdown label=(@src) options=([\"a\"]) value=(@draft)/>"],
    ["a sequence's `.length` into an int cell", "    <audit:string[free, end]=([])/>\n    <let n:int=0/>\n    function f() { @audit.push(\"x\")\n @n = @audit.length }"],
    ["a read through a `given` narrowing", "    <let show:bool=false/>\n    <let seen:string=\"\"/>\n    function f() { given c = @color :> { @seen = c.value } }", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>"],
    ["a row alias and `@.` inside `<each>`", "    type L:struct = { id: int, name: string }\n    <lines:L[]=([{ id: 1, name: \"a\" }])/>", "<each in=@lines key=@.id as line><p>${line.name} ${@.id}</p><dropdown label=line.name options=([\"a\"])/></each>"],
    ["a truthy `if=` on a use and a `not`-able condition", "    <let label:string=\"\"/>", "<dropdown if=@label label=\"1\" options=([\"a\"])/>"],
    ["`reset(@x)` of a `let` cell", "    <let x:int=0/>\n    function f() { reset(@x) }"],
    ["a local rebinding (§66.11.5 is out of the write contracts)", "    function f() { let a = 1\n a = 2 }"],
  ];
  for (const [name, decls, markup] of C) {
    test(name, () => { expect(inApp(decls, markup ?? "<p>x</p>")).toEqual([]); });
  }
});

// ---------------------------------------------------------------------------
// The typer's own table.
// ---------------------------------------------------------------------------
const EXPR_KINDS = new Set(["Name", "At", "AtItem", "Num", "Str", "Bool", "NotLit", "Variant", "Member", "Call",
  "Unary", "Binary", "Ternary", "Assign", "ArrayLit", "ObjectLit"]);

// Every AExpr node reachable in the ASTs, except binding NAMES (`as=` values)
// and `rule=` alternations (state-child graph syntax, not values).
function exprNids(node, skip = false, out = []) {
  if (Array.isArray(node)) { for (const x of node) exprNids(x, skip, out); return out; }
  if (node === null || typeof node !== "object") return out;
  const isAttr = typeof node.name === "string" && node.value && typeof node.value === "object" && "variant" in node.value;
  const skipHere = skip || (isAttr && (node.name === "as" || node.name === "rule"));
  if (!skipHere && typeof node.nid === "number" && node.k && EXPR_KINDS.has(node.k.variant)) out.push(node.nid);
  for (const v of Object.values(node)) exprNids(v, skipHere, out);
  return out;
}

describe("the typer's table — a type per expression node (Tables.typing)", () => {
  for (const name of ["counter", "dropdown", "valuesem"]) {
    test(`${name}: every expression node has exactly one entry`, () => {
      const r = compileProgram(mods, name);
      const typed = r.typed.tables.typing.exprs.map((x) => x.nid);
      expect(new Set(typed).size).toBe(typed.length);
      const want = [...new Set(exprNids(r.asts))];
      expect(want.length).toBeGreaterThan(10);
      const missing = want.filter((n) => !typed.includes(n));
      expect(missing).toEqual([]);
    });
  }
  test("counter: `@count * 2` and `@count + @step` are `int`; exprType answers by NodeId", () => {
    const r = compileProgram(mods, "counter");
    const t = r.typed.tables;
    const known = t.typing.exprs.filter((x) => x.vt.variant === "Known");
    expect(known.length).toBeGreaterThan(5);
    // every Binary node of the counter is int arithmetic
    const bins = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.k && n.k.variant === "Binary") bins.push(n.nid);
      Object.values(n).forEach(walk);
    })(r.asts);
    expect(bins.length).toBe(2);
    for (const nid of bins) expect(mods.analyze.exprType(t, nid)).toEqual({ variant: "Known", data: { t: "Int" } });
  });
  test("dropdown: the toggle's ternary is `Openness`; `.length`-free sequences stay sequences", () => {
    const r = compileProgram(mods, "dropdown");
    const t = r.typed.tables;
    let tern = -1;
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.k && n.k.variant === "Ternary") tern = n.nid;
      Object.values(n).forEach(walk);
    })(r.asts[0]);
    const vt = mods.analyze.exprType(t, tern);
    expect(vt.variant).toBe("Known");
    expect(vt.data.t.variant).toBe("Named");
    expect(vt.data.t.data.sym.hint).toBe("Openness");
  });
});

// ---------------------------------------------------------------------------
// The worked programs and fixtures produce no typer / scope diagnostic.
// ---------------------------------------------------------------------------
describe("no typer / scope diagnostic on the §66.19 programs and the M2 fixtures", () => {
  for (const name of Object.keys(PROGRAMS)) {
    test(`${name} (compileProgram throws on ANY diagnostic)`, () => {
      expect(() => compileProgram(mods, name)).not.toThrow();
    });
  }
  test("every §66.19 code block: none of the typer's codes (blocks .2/.4/.5/.6 are outside the slice front end — their other diagnostics are front-end growth, M3 item 4)", () => {
    const spec = readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8");
    const sec = spec.slice(spec.indexOf("### 66.19 Worked programs"), spec.indexOf("### 66.20 Diagnostics"));
    const blocks = [...sec.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const b of blocks) {
      const found = codes([{ path: "p.scrml", src: b }]).filter((c) => TYPER_CODES.includes(c));
      expect(found).toEqual([]);
    }
  });
});
