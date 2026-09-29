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

// ---------------------------------------------------------------------------
// Writes (§66.1 rule 5) — every write shape the edit classifier produces.
// ---------------------------------------------------------------------------
describe("writes are type-checked against the target (§66.1 rule 5)", () => {
  const W = [
    { name: "`not` into an `int` cell → E-TYPE-041 (§42.3.1)", want: ["E-TYPE-041"],
      bad: ["    <let x:int=0/>\n    function f() { @x = not }"], ok: ["    <let x:int=0/>\n    function f() { @x = 1 }"] },
    { name: "an end-append of the wrong element type", want: ["E-TYPE-031"],
      bad: ["    <audit:string[free, append]=([])/>\n    function f() { @audit.push(5) }"],
      ok: ["    <audit:string[free, append]=([])/>\n    function f() { @audit.push(\"x\") }"] },
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
  // RULED S440 (JS-WAT 7(a), "enforce `int`"; PA note "§7.5.1's provable domain widens to `int` with it"):
  // supersedes SPEC §7.5.1's "`int` is deliberately OUTSIDE" (SPEC pass 2 owes the text).
  test("E-TYPE-031 (int enforced, S440) — an `int` annotation given a string literal", () => {
    expect(inApp("    <let n:int=\"s\"/>")).toEqual(["E-TYPE-031"]);
    expect(codes([boxLib("export <box n:int=0/>\nrenders <p>${n}</p>\n"), boxApp("<box n=(\"s\")/>")])).toEqual(["E-TYPE-031"]);
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
  test("E-HANDLE-REDECLARE (ruled S442) — a handle named like a declaration (`@dropdown` is its shared instance)", () => {
    expect(inApp("", "<dropdown as=dropdown label=\"1\" options=([\"a\"])/>")).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("E-SCOPE-010 (ruled S442) — a program cell named like a declaration (`@dropdown` would name both)", () => {
    expect(inApp("    <let dropdown:int=0/>")).toEqual(["E-SCOPE-010"]);
  });
  test("E-HANDLE-REDECLARE — two handles of one name in one `<each>` row", () => {
    expect(inApp("    type L:struct = { id: int, name: string }\n    <lines:L[]=([{ id: 1, name: \"a\" }])/>",
      "<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/><dropdown as=q label=\"2\" options=([\"a\"])/></each>"))
      .toEqual(["E-HANDLE-REDECLARE"]);
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
  test("E-CALL-ARITY — in a handler and in markup interpolation", () => {
    expect(inApp("    function g(a: int) -> int { return a }", "<button onclick=g()>x</button>")).toEqual(["E-CALL-ARITY"]);
    expect(inApp("    function g(a: int) -> int { return a }", "<p>${g(1, 2)}</p>")).toEqual(["E-CALL-ARITY"]);
  });
  test("a `-> void` function is legal and its call is silent", () => {
    expect(inApp("    function k() -> void { }\n    function m() { k() }")).toEqual([]);
  });
  test("E-TYPE-UNKNOWN — an unknown return type name (now resolved by the binder)", () => {
    expect(inApp("    function h() -> Nope { return 1 }")).toEqual(["E-TYPE-UNKNOWN"]);
  });
  test("E-EACH-NOT-SEQUENCE — a string, a struct", () => {
    expect(inApp("    <s=\"abc\"/>", "<each in=@s as c><p>${c}</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
    expect(inApp("    type P:struct = { x: int }\n    <p:P=({ x: 1 })/>", "<each in=@p as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
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
// S442: three S439 controls moved OUT of this list because S440 RULED them
// errors — `@s || "x"` on strings (Gotcha Q2), a truthy `if=@label` on a string
// (truthiness (c)), a `number` into an `int` cell (JS-WAT 7(a)); each is now a
// positive test in typer-s440.test.js.
// ---------------------------------------------------------------------------
describe("adversarial controls — adjacent shapes stay silent", () => {
  const C = [
    ["a ternary of ints into an int cell, with a bool test", "    <let b:bool=false/>\n    <let x:int=0/>\n    function f() { @x = @b ? 1 : 2 }"],
    ["an int into a `number` cell", "    <let r:number=0.5/>\n    function f() { @r = 2 }"],
    ["`not` and a value into a `T | not` struct field", "    type O:struct = { let v: string | not }\n    <let o:O=({ v: not })/>\n    function f() { @o.v = not\n @o.v = \"a\" }"],
    ["a `T | not` parameter into a `T` cell (may be `not`: unproven, not wrong)", "    <let t:string=\"\"/>\n    function f(s: string | not) { @t = s }"],
    ["an enum variant into an enum cell", "    <let o:Openness=.Closed/>\n    function f() { @o = .Opened }"],
    ["a seeded `let` (reactive initializer) and a use-site live value", "    <let src:string=\"a\"/>\n    <let draft:string=@src/>", "<dropdown label=(@src) options=([\"a\"]) value=(@draft)/>"],
    ["a sequence's `.length` into an int cell", "    <audit:string[free, append]=([])/>\n    <let n:int=0/>\n    function f() { @audit.push(\"x\")\n @n = @audit.length }"],
    ["a read through a `given` narrowing", "    <let show:bool=false/>\n    <let seen:string=\"\"/>\n    function f() { given c = @color :> { @seen = c.value } }", "<div if=@show><dropdown as=color label=\"1\" options=([\"a\"])/></div>"],
    ["a row alias and `@.` inside `<each>`", "    type L:struct = { id: int, name: string }\n    <lines:L[]=([{ id: 1, name: \"a\" }])/>", "<each in=@lines key=@.id as line><p>${line.name} ${@.id}</p><dropdown label=line.name options=([\"a\"])/></each>"],
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
// ---------------------------------------------------------------------------
// BASE-vs-NEW: the typer adds NOTHING to the §66.19 programs or the fixtures.
// BASE_66_19 is every §66.19 ```scrml block's FULL diagnostic list (sorted)
// from the bootstrap at base b7c863235 (before the typer), measured by running
// that commit's front end over the same blocks. Blocks .2 / .4 / .5 / .6 are
// outside the slice front end, so they carry parse / unsupported codes — the
// point is that the typer changes no list: not E-TYPE-UNKNOWN, not
// E-BOOTSTRAP-UNSUPPORTED, nothing. (If §66.19 changes, re-measure on base.)
// RE-MEASURED s442 (six-programs): the front end grew (slice-m4) — .6 After now
// compiles clean; .2 / .5 carry only their Core-blocked / ⚑ O25 constructs
// (E-BOOTSTRAP-UNSUPPORTED); .4's library now reports `<theme>` (CSS) and its two
// named shared instances as unsupported. Still no typer code in any list.
// ---------------------------------------------------------------------------
const BASE_66_19 = [
  [],
  ["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED"],
  ["E-PROGRAM-MISSING"],
  ["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001", "E-TYPE-VARIANT"],
  ["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-PARSE-EXPECTED", "E-PARSE-EXPECTED", "E-PARSE-TRAILING", "E-PARSE-TRAILING", "E-PROGRAM-MISSING", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001"],
  ["E-DECL-STAR-PREDEFINED", "E-DECL-STAR-PREDEFINED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-IMPORT-NOT-EXPORTED", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001", "E-SCOPE-001"],
  // §66.19.5: SPEC still writes `Entry[free, end]` — the retired place token is refused (RULED S442 grow/shrink
  // split; E-GRANT-UNKNOWN) until the SPEC amendment for §66.12.2 / §66.19.5 lands (PENDING the SPEC PR), which
  // leaves the log ungranted (two E-WRITE-NOT-GRANTED). Re-measure when that PR lands.
  ["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-GRANT-UNKNOWN", "E-WRITE-NOT-GRANTED", "E-WRITE-NOT-GRANTED"],
  ["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-SCOPE-001"],
  [],
];

describe("the §66.19 programs and the M2 fixtures — no typer / scope code; every §66.19 block's diagnostic list pinned (re-measured s442)", () => {
  for (const name of Object.keys(PROGRAMS)) {
    test(`${name}: no diagnostic (base: none either — compileProgram throws on ANY)`, () => {
      expect(() => compileProgram(mods, name)).not.toThrow();
    });
  }
  test("every §66.19 code block: the full diagnostic list equals base's, code for code", () => {
    const spec = readFileSync(join(import.meta.dir, "..", "..", "SPEC.md"), "utf8");
    const sec = spec.slice(spec.indexOf("### 66.19 Worked programs"), spec.indexOf("### 66.20 Diagnostics"));
    const blocks = [...sec.matchAll(/```scrml\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBe(BASE_66_19.length);
    const got = blocks.map((b) => codes([{ path: "p.scrml", src: b }]).sort());
    expect(got).toEqual(BASE_66_19);
  });
});

// ---------------------------------------------------------------------------
// Fix round 1 (adversarial review of the first cut).
// ---------------------------------------------------------------------------
describe("A — a local's type: its annotation, else the join of everything it is given", () => {
  test("legal — `let a = not; a = \"x\"` then `@s = a` (§42.3.1: infer `T | not`; a `T | not` into `T` is unproven, silent)", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { let a = not\n a = \"x\"\n @s = a }")).toEqual([]);
  });
  test("legal — the annotated form `let a: string | not = not` then `@s = a`", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { let a: string | not = not\n @s = a }")).toEqual([]);
  });
  test("legal — the same shape in an inline handler block, and through `.push`", () => {
    expect(inApp("    <audit:string[free, append]=([])/>\n    function f() { let a = not\n a = \"x\"\n @audit.push(a) }",
      "<button onclick={ let b = not; b = \"y\"; @audit.push(b) }>x</button>")).toEqual([]);
  });
  test("silent — `let a = \"s\"; a = 1` then `@x = a` into int: the join is unprovable (was a false E-TYPE-031)", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { let a = \"s\"\n a = 1\n @x = a }")).toEqual([]);
  });
  test("silent — `let a = 1; a = \"s\"` then `@x = a`: same join, same answer (flow-insensitive; not provable either way)", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { let a = 1\n a = \"s\"\n @x = a }")).toEqual([]);
  });
  test("E-TYPE-031 — the join is still a TYPE: `let a = not; a = \"x\"` (`string | not`) into an int cell", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { let a = not\n a = \"x\"\n @x = a }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — an annotated local is its annotation (`let a: string = \"x\"` into an int cell)", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { let a: string = \"x\"\n @x = a }")).toEqual(["E-TYPE-031"]);
  });
  test("twin silent — `let a: int = 1` into an int cell; a rebound local read BEFORE its reassignment is typed from the join", () => {
    expect(inApp("    <let x:int=0/>\n    function f() { let a: int = 1\n @x = a }")).toEqual([]);
    expect(inApp("    <let x:int=0/>\n    function f() { let a = 1\n @x = a\n a = 2 }")).toEqual([]);
  });
});

describe("B — a whole-struct replace by a literal checks every field (spelling-independent, §66.1 rule 5)", () => {
  const P = "    type P:struct = { let x: int, let y: int }\n    <let p:P=({ x: 1, y: 2 })/>\n";
  test("E-TYPE-031 — `@p = { x: 1, y: \"s\" }`", () => {
    expect(inApp(P + "    function f() { @p = { x: 1, y: \"s\" } }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-041 — `@p = { x: 1, y: not }`", () => {
    expect(inApp(P + "    function f() { @p = { x: 1, y: not } }")).toEqual(["E-TYPE-041"]);
  });
  test("twin silent — `@p = { x: 1, y: 2 }`", () => {
    expect(inApp(P + "    function f() { @p = { x: 1, y: 2 } }")).toEqual([]);
  });
  test("E-TYPE-031 — a struct literal inside an appended element", () => {
    const L = "    type L:struct = { id: int, name: string }\n    <ls:L[free, append]=([])/>\n";
    expect(inApp(L + "    function f() { @ls.push({ id: 1, name: 5 }) }")).toEqual(["E-TYPE-031"]);
    expect(inApp(L + "    function f() { @ls.push({ id: 1, name: \"a\" }) }")).toEqual([]);
  });
});

describe("C — no check against what failed to parse", () => {
  test("`@s = #` — only the parse error (the recovery node is not `not`)", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { @s = # }")).toEqual(["E-PARSE-EXPR"]);
  });
  test("a back-tick template — only the parse error", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { @s = `t` }")).toEqual(["E-PARSE-EXPR"]);
  });
  test("`<let x:int|not=0/>` then `@x = not` — only the parse error (the cell's type did not parse)", () => {
    expect(inApp("    <let x:int|not=0/>\n    function f() { @x = not }")).toEqual(["E-PARSE-TAG"]);
  });
  test("`<box n:string|not=\"\"/>` used as `<box n=(not)/>` — only the parse error", () => {
    expect(codes([boxLib("export <box n:string|not=\"\"/>\nrenders <p>x</p>\n"), boxApp("<box n=(not)/>")])).toEqual(["E-PARSE-TAG"]);
  });
  test("no arity check against an untyped / malformed parameter list (default value, `b?:`)", () => {
    const g = inApp("    function g(a: int, b: int = 1) { }\n    function f() { g(1) }");
    expect(g).not.toContain("E-CALL-ARITY");
    expect(g.every((c) => c === "E-BOOTSTRAP-UNSUPPORTED")).toBe(true);
    const h = inApp("    function h(a: int, b?: bool) { }\n    function f() { h(1) }");
    expect(h).not.toContain("E-CALL-ARITY");
  });
  test("a return type that failed to parse is not resolved (no E-TYPE-UNKNOWN \"unknown type ``\")", () => {
    expect(inApp("    function g() -> [int, string] { }")).not.toContain("E-TYPE-UNKNOWN");
  });
});

describe("D / E — names are scoped to what a file can see", () => {
  const other = { path: "lib/other.scrml", src: "<card title:string=\"\"/>\nrenders <p>x</p>\n" };
  test("legal — a program cell named like a declaration that is NOT visible here (not declared, not imported)", () => {
    expect(codes([other, { path: "app.scrml", src: "<program>\n    <let card:int=0/>\n<main><p>x</p></main>\n</program>\n" }])).toEqual([]);
  });
  test("legal — an `as=` handle named like a declaration that is NOT visible here", () => {
    expect(codes([other, boxLib("export <box n:int=0/>\nrenders <p>x</p>\n"), boxApp("<box as=card/>")])).toEqual([]);
  });
  test("E-BOOTSTRAP-UNSUPPORTED (kept, measured) — two PRIVATE `helper`s in two libraries: base b7c863235 resolved BOTH calls to the first (a silent mis-link)", () => {
    const a = { path: "lib/a.scrml", src: "${ function helper() -> int { return 1 }\n export function useA() -> int { return helper() } }\n" };
    const b = { path: "lib/b.scrml", src: "${ function helper() -> string { return \"b\" }\n export function useB() -> string { return helper() } }\n" };
    const main = { path: "app.scrml", src: "${ import { useA } from \"./lib/a.scrml\" }\n${ import { useB } from \"./lib/b.scrml\" }\n<program>\n<main><p>${useA()} ${useB()}</p></main>\n</program>\n" };
    const r = frontEnd(mods, [a, b, main]);
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toContain("the bootstrap links one namespace");
  });
});

describe("F — SPEC-silent duplicates (bootstrap-local, owe rulings)", () => {
  test("F1 E-BOOTSTRAP-REDECLARE — two `type T` in one file", () => {
    expect(inApp("    type T:struct = { a: int }\n    type T:struct = { b: string }")).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("F1 twin silent — two distinct type names", () => {
    expect(inApp("    type T:struct = { a: int }\n    type U:struct = { b: string }")).toEqual([]);
  });
  test("F1 E-BOOTSTRAP-UNSUPPORTED — one type name in two files (one type namespace)", () => {
    const lib = { path: "lib/t.scrml", src: "${ type T:struct = { a: int } }\n" };
    expect(codes([lib, LIB(), app("    type T:struct = { b: string }", "<p>x</p>")])).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("F2 E-BOOTSTRAP-REDECLARE — `function g(a: int, a: int)`", () => {
    expect(inApp("    function g(a: int, a: int) { }")).toEqual(["E-BOOTSTRAP-REDECLARE"]);
  });
  test("F2 twin silent — `function g(a: int, b: int)`", () => {
    expect(inApp("    function g(a: int, b: int) { }")).toEqual([]);
  });
});

describe("G — `<each in=>` literals, row-scoped handles, exclusive arms", () => {
  test("E-EACH-NOT-SEQUENCE — `in=\"abc\"` and `in=not`, like a cell of that type", () => {
    expect(inApp("", "<each in=\"abc\" as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
    expect(inApp("", "<each in=not as c><p>x</p></each>")).toEqual(["E-EACH-NOT-SEQUENCE"]);
  });
  test("twin silent — `in=([1, 2])`", () => {
    expect(inApp("", "<each in=([1, 2]) as c><p>${c}</p></each>")).toEqual([]);
  });
  test("legal — a ROW-scoped `as=q` with no cell `q`: inside the row `@q` is the row's instance (§66.7.4)", () => {
    expect(inApp("    type L:struct = { id: int }\n    <lines:L[]=([{ id: 1 }])/>",
      "<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/><p>${@q.value}</p></each>")).toEqual([]);
  });
  test("still refused — a PROGRAM-scope `as=q` beside a program cell `q`", () => {
    expect(inApp("    <let q:int=0/>", "<dropdown as=q label=\"1\" options=([\"a\"])/>")).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("RULED S440 #5 (iii) (an error for now) — one `as=x` in each of two mutually exclusive `if=` arms", () => {
    expect(inApp("    <let b:bool=false/>", "<div if=@b><dropdown as=x label=\"1\" options=([\"a\"])/></div><div if=(!@b)><dropdown as=x label=\"2\" options=([\"a\"])/></div>"))
      .toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("silent — a mixed-arm ternary (`@b ? 1 : \"s\"`) into an int cell: unprovable", () => {
    expect(inApp("    <let b:bool=false/>\n    <let x:int=0/>\n    function f() { @x = @b ? 1 : \"s\" }")).toEqual([]);
  });
});

// Ruling B1 (ruling:user-voice-scrml.md S439 #6 (B1)): a nested `function x`
// in a body whose PARAMETER is `x` is EXEMPT from E-SCOPE-REDECLARE. The slice
// front end has no nested-function statement (§7.3.1 is front-end growth, M3
// item 4): `function x() { }` in a body parses as expression statements, so no
// declaration reaches the scope pass and the exemption holds by construction.
// This pins that; the exemption must be implemented in `blockRedeclares` the
// day nested functions parse. The let / const twin still fires.
describe("§7.3.3 ruling B1 — a nested function over a parameter", () => {
  test("no E-SCOPE-REDECLARE — `function f(x: int) { function x() { } }`", () => {
    expect(inApp("    function f(x: int) { function x() { } }")).not.toContain("E-SCOPE-REDECLARE");
  });
  test("twin fires — `let x` / `const x` over parameter `x`", () => {
    expect(inApp("    function f(x: int) { let x = 1 }")).toEqual(["E-SCOPE-REDECLARE"]);
    expect(inApp("    function f(x: int) { const x = 1 }")).toEqual(["E-SCOPE-REDECLARE"]);
  });
});

// ---------------------------------------------------------------------------
// Fix round 2.
// ---------------------------------------------------------------------------
const f2 = (path, src) => ({ path, src });
const BOXC = f2("lib/box.scrml", "export <box export let c:int=0/>\nrenders <p>${c}</p>\n");
const MID = (v) => f2("lib/mid.scrml", "${ import { box } from \"./box.scrml\" }\nexport <card t:string=\"\"/>\nrenders <button onclick=(@box.c = " + v + ")>x</button>\n");
const APP_BOXCELL = (cell) => f2("app.scrml", "${ import { card } from \"./lib/mid.scrml\" }\n<program>\n" + cell + "\n    <main>\n<card/>\n    </main>\n</program>\n");

describe("R2-1 — a program cell is visible only in the program's own file (§7.6.1 \"in the same file\")", () => {
  const CELL = "    type B:struct = { let c: string }\n    <let box:B=({ c: \"\" })/>";
  test("E-TYPE-031 — a library's `@box.c = \"s\"` is the IMPORTED `<box>` (c: int), not the app's cell `box` (c: string)", () => {
    expect(codes([BOXC, MID("\"s\""), APP_BOXCELL(CELL)])).toEqual(["E-TYPE-031"]);
  });
  test("twin silent — `@box.c = 2` (right for `<box>`, wrong for the app's cell)", () => {
    expect(codes([BOXC, MID("2"), APP_BOXCELL(CELL)])).toEqual([]);
  });
  test("E-SCOPE-001 — a library's renders reading `@q` does not see the app's cell `q`", () => {
    const lib = f2("lib/b2.scrml", "export <b2 n:int=0/>\nrenders <p>${@q}</p>\n");
    const main = f2("app.scrml", "${ import { b2 } from \"./lib/b2.scrml\" }\n<program>\n    <let q:string=\"c\"/>\n    <main><b2/></main>\n</program>\n");
    expect(codes([lib, main])).toEqual(["E-SCOPE-001"]);
  });
  test("twin silent — the program's own markup reads its cell `@q`", () => {
    expect(inApp("    <let q:string=\"c\"/>", "<p>${@q}</p>")).toEqual([]);
  });
  test("E-SCOPE-001 — `@card` names a declaration the file neither declares nor imports", () => {
    const other = f2("lib/other.scrml", "export <card title:string=\"\"/>\nrenders <p>x</p>\n");
    expect(codes([other, f2("app.scrml", "<program>\n    <let s:string=\"\"/>\n    function f() { @s = @card.title }\n    <main><p>x</p></main>\n</program>\n")]))
      .toContain("E-SCOPE-001");
  });
});

describe("R2-2 — (PA interim S439, RULED S440 #5 (ii) + #7) an `as=` handle may not shadow a cell visible in its file, in ANY scope", () => {
  const LINES = "    type L:struct = { id: int }\n    <lines:L[]=([{ id: 1 }])/>\n    <let q:int=0/>";
  test("E-HANDLE-REDECLARE — a ROW-scoped `as=q` beside the program cell `q`; the message names both", () => {
    const r = frontEnd(mods, [LIB(), app(LINES, "<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/></each>")]);
    expect(r.diags.map((d) => d.code)).toEqual(["E-HANDLE-REDECLARE"]);
    expect(r.diags[0].message).toContain("as=q");
    expect(r.diags[0].message).toContain("cell `@q`");
  });
  test("E-HANDLE-REDECLARE — a same-file declaration's `renders` handle `q` beside the program cell `q`", () => {
    const src = "${ import { dropdown } from \"./lib/dropdown.scrml\" }\n<box n:int=0/>\nrenders <div><dropdown as=q label=\"L\" options=([\"a\"])/></div>\n<program>\n    <let q:string=\"c\"/>\n    <main><box/></main>\n</program>\n";
    expect(codes([LIB(), f2("app.scrml", src)])).toEqual(["E-HANDLE-REDECLARE"]);
  });
  test("legal — a LIBRARY declaration's handle `q` while the app has a cell `q` (not visible there)", () => {
    const lib = f2("lib/box2.scrml", "${ import { dropdown } from \"./dropdown.scrml\" }\nexport <box2 n:int=0/>\nrenders <div><dropdown as=q label=\"L\" options=([\"a\"])/><p>${@q.value}</p></div>\n");
    const main = f2("app.scrml", "${ import { box2 } from \"./lib/box2.scrml\" }\n<program>\n    <let q:string=\"c\"/>\n    <main><box2/></main>\n</program>\n");
    expect(codes([LIB(), lib, main])).toEqual([]);
  });
});

describe("R2-3 — `<each key=…>` is resolved OUTSIDE the row's template (§66.7.3, §66.7.4)", () => {
  const LINES = "    type L:struct = { id: int }\n    <lines:L[]=([{ id: 1 }])/>";
  test("E-SCOPE-001 — `key=@q.value` cannot name the row's own `as=q` instance (a circular key)", () => {
    expect(inApp(LINES, "<each in=@lines key=@q.value as line><dropdown as=q label=\"1\" options=([\"a\"])/></each>"))
      .toEqual(["E-SCOPE-001", "E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("twin silent — `key=@.id` (the row's item) and `key=line.id` (its `as` name)", () => {
    expect(inApp(LINES, "<each in=@lines key=@.id as line><dropdown as=q label=\"1\" options=([\"a\"])/></each>")).toEqual([]);
    expect(inApp(LINES, "<each in=@lines key=line.id as line><dropdown as=q label=\"1\" options=([\"a\"])/></each>")).toEqual([]);
  });
});

describe("R2-4 — §7.5.1 position 1: an annotated `let` / `const` initializer", () => {
  const F = (body) => "    <let s:string=\"\"/>\n    function f() { " + body + " }";
  for (const [body, want] of [
    ["let a: string = 5", ["E-TYPE-031"]],
    ["let a: bool = \"s\"", ["E-TYPE-031"]],
    ["let a: boolean = 1", ["E-TYPE-031"]],
    ["const a: string = true", ["E-TYPE-031"]],
    ["let a: number = \"s\"", ["E-TYPE-031"]],
    ["let a: string = not", ["E-TYPE-041"]],
    ["let x: string = 1\n @s = x", ["E-TYPE-031"]],
  ]) {
    test(`${want.join(", ")} — \`${body.replace(/\n/g, "; ")}\``, () => { expect(inApp(F(body))).toEqual(want); });
  }
  test("twins silent — matching literals; `string | not` given `not`", () => {
    expect(inApp(F("let a: string = \"x\"\n let b: bool = true\n const c: number = 1\n let d: string | not = not"))).toEqual([]);
  });
  test("E-TYPE-031 (int enforced, S440 JS-WAT 7(a)) — `let a: int = \"s\"`", () => {
    expect(inApp(F("let a: int = \"s\""))).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — a struct literal initializer, field by field (`let v: P = { x: 1, y: \"s\" }`)", () => {
    const P = "    type P:struct = { x: int, y: int }\n";
    expect(inApp(P + "    function f() { let v: P = { x: 1, y: \"s\" } }")).toEqual(["E-TYPE-031"]);
    expect(inApp(P + "    function f() { let v: P = { x: 1, y: 2 } }")).toEqual([]);
  });
  test("E-TYPE-031 — a later write to an annotated local; twin silent", () => {
    expect(inApp(F("let a: string = \"x\"\n a = 5"))).toEqual(["E-TYPE-031"]);
    expect(inApp(F("let a: string = \"x\"\n a = \"y\""))).toEqual([]);
  });
});

describe("R2-5 — Rule C: only a component's OWN type expression failing to parse untrusts it", () => {
  const box = (decl, use) => codes([boxLib(decl + "\nrenders <p>x</p>\n"), boxApp(use)]);
  test("E-TYPE-031 kept — a sibling attribute's spaced `=` (stylistic) does not untrust `a`", () => {
    expect(box("export <box a:string=5 n:int = 0/>", "<box/>")).toEqual(["E-PARSE-OPENER-EQ-SPACED", "E-TYPE-031"]);
  });
  test("E-TYPE-031 kept — a sibling attribute's type failing to parse does not untrust `a`", () => {
    expect(box("export <box a:string=\"\" n:string|not=\"\"/>", "<box a=(5)/>")).toEqual(["E-PARSE-TAG", "E-TYPE-031"]);
  });
  test("E-TYPE-031 kept — a cell's own spaced `=` does not untrust its type", () => {
    expect(inApp("    <let z:int = 0/>\n    function g() { @z = \"s\" }")).toEqual(["E-PARSE-OPENER-EQ-SPACED", "E-TYPE-031"]);
  });
  test("E-TYPE-031 kept — `-> string` stays trusted when a PARAMETER's type fails to parse", () => {
    expect(inApp("    <let x:int=0/>\n    function h(a: [int]) -> string { return \"a\" }\n    function g() { @x = h(1) }")).toContain("E-TYPE-031");
  });
  test("still untrusted — the component whose own type failed (`n:string|not` given `(not)`)", () => {
    expect(box("export <box n:string|not=\"\"/>", "<box n=(not)/>")).toEqual(["E-PARSE-TAG"]);
  });
  test("an untyped parameter is unproven, never a placeholder type (`function h(a) { @x = a }`)", () => {
    expect(inApp("    <let x:int=0/>\n    function h(a) { @x = a }")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

describe("R2-7 / R2-8 — the fixpoint bound; compound assignment", () => {
  const chain = (n, cell) => {
    let s = "    <let x:" + cell + "/>\n    function f() {";
    for (let i = 1; i <= n; i++) s += " let a" + i + " = \"s\"\n";
    for (let i = 1; i < n; i++) s += " a" + i + " = a" + (i + 1) + "\n";
    return s + " a" + n + " = not\n @x = a1 }";
  };
  test("E-TYPE-031 — a chain of 8 rebound locals settles (`string | not` reaches `a1`) into an int cell", () => {
    expect(inApp(chain(8, "int=0"))).toEqual(["E-TYPE-031"]);
  });
  test("twin silent — the same chain into a string cell (a `T | not` into `T` is unproven)", () => {
    expect(inApp(chain(8, "string=\"\""))).toEqual([]);
  });
  test("silent — a chain of 8 whose far end is widened to Unknown (`a8 = 1`): `a1` must SETTLE to Unknown, not stop at `string`", () => {
    const src = chain(8, "int=0").replace(" a8 = not\n", " a8 = 1\n");
    expect(inApp(src)).toEqual([]);
  });
  test("`@s += 1` on a string cell — only the unsupported-syntax report (recovered, not typed as `@s = 1`)", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { @s += 1 }")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("twin — `@s = @s + \"1\"` is silent", () => {
    expect(inApp("    <let s:string=\"\"/>\n    function f() { @s = @s + \"1\" }")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Final repair (round 3, H1): a FIELD write `a.n = v` on a local is a field
// edit (§66.11.4: "a field is writable along its own contract"), not a write
// of the local. The binder records it as a local rebinding of the ROOT local
// and computes no field type for it, so it is left unchecked (provable-or-
// silent) and does not widen the local's joined type. Only a BARE `a = v` is
// checked against the local's annotation / joined into its type.
// ---------------------------------------------------------------------------
describe("R3-H1 — a field write through a local is not a write of the whole local", () => {
  const O = "    type O:struct = { let v: string | not, let n: int }\n    <let o:O=({ v: not, n: 0 })/>\n";
  for (const [name, body, markup] of [
    ["`a.n = 2` on `let a: O`", "    function f() { let a: O = { v: \"x\", n: 1 }\n a.n = 2\n @o = a }"],
    ["`a.v = not` on `let a: O` (`v: string | not`)", "    function f() { let a: O = { v: \"x\", n: 1 }\n a.v = not\n @o = a }"],
    ["`a.v = \"q\"` on `let a: O = @o`", "    function f() { let a: O = @o\n a.v = \"q\" }"],
    ["the inline handler block form", "", "<button onclick={ let a: O = @o; a.n = 2; @o = a }>x</button>"],
  ]) {
    test(`legal — ${name}`, () => { expect(inApp(O + body, markup ?? "<p>x</p>")).toEqual([]); });
  }
  test("legal — `d.value = \"x\"` on `let d: dropdown = @dropdown`", () => {
    expect(inApp("    function f() { let d: dropdown = @dropdown\n d.value = \"x\" }")).toEqual([]);
  });
  test("silent (this path computes no field type) — `a.n = \"s\"` on `let a: O`", () => {
    expect(inApp(O + "    function f() { let a: O = @o\n a.n = \"s\" }")).toEqual([]);
  });
  test("still fires — a BARE `a = \"s\"` into `let a: O`", () => {
    expect(inApp(O + "    function f() { let a: O = @o\n a = \"s\" }")).toEqual(["E-TYPE-031"]);
  });
  test("E-TYPE-031 — an unannotated `let a = @o` keeps type `O` after `a.n = 2` (the field write does not join `int` in)", () => {
    expect(inApp(O + "    <let x:int=0/>\n    function f() { let a = @o\n a.n = 2\n @x = a }")).toEqual(["E-TYPE-031"]);
  });
});
