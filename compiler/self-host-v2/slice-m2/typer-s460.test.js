// typer-s460.test.js — ONE condition rule (SPEC §42.4), ruled S460 "a′, go"
// (docs/changes/s460-presence-a-prime/). Provenance: ../../../../scrml-support/user-voice-scrml.md §S460
// "RULED — a′, go": a bare `x` in a condition (logic `if` / ternary test; markup `if=` / `else-if=`) of
// type `T | not` IS the presence test (`""` / `0` present) and narrows; `bool` is a boolean test; any other
// KNOWN type is E-COND-NOT-BOOLEAN (S440 #4 (c)); a bare `bool | not` is an error naming both fixes (S442);
// NEW — a bare `x` whose type the compiler CANNOT resolve is an ERROR naming the fixes (annotate it, or
// write `x is given` / `x == true`), superseding S440 Truthiness Q2 for CONDITIONS; `x is given` / `x is not`
// are the explicit pair for value positions and compounds; `!` / `&&` / `||` take booleans only.
// Each rule: a POSITIVE test (fires) and a NEGATIVE twin (silent on the adjacent legal shape). The
// bootstrap has no `while` statement, so the `while` position is covered by the conformance case only.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd } from "./lowered.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const prog = (decls, markup = "<p>x</p>") => `<program>\n${decls}\n    <main>${markup}</main>\n</program>\n`;
const run = (src) => frontEnd(mods, [{ path: "app.scrml", src }]);
const codes = (decls, markup) => run(prog(decls, markup)).diags.map((d) => d.code);
const diags = (decls, markup) => run(prog(decls, markup)).diags;
const SQ = "?" + "{";   // the SQL sigil, spelled in two pieces (impl#1 pre-scans source text for it)

// `T | not` values reach a condition through a struct field (the slice parses no `T | not` cell opener).
const O = "    type O:struct = { let v: string | not, let n: int | not, let f: bool | not }\n    let <o:O=({ v: \"\", n: 0, f: false })/>\n    let <m:int=0/>\n    let <b:bool=false/>\n";
const UNRESOLVED_MSG = "cannot resolve";

describe("S460 — a bare `T | not` condition is the presence test, in every condition position", () => {
  test("admitted — `if=`, `else-if=`, an `if` statement, a ternary test", () => {
    expect(codes(O, "<p if=@o.v>${@o.v}</p>")).toEqual([]);
    expect(codes(O, "<p if=@b>a</p><p else-if=@o.v>${@o.v}</p>")).toEqual([]);
    expect(codes(O + "    function f() { if (@o.n) { @m = @o.n + 1 } }")).toEqual([]);
    expect(codes(O + "    function f() { @m = @o.n ? @o.n + 1 : 0 }")).toEqual([]);
  });
  test("each is recorded as a presence test (lowered to an absence check)", () => {
    const r = run(prog(O, "<p if=@o.v>a</p><p else-if=@o.n>b</p>"));
    expect(r.diags).toEqual([]);
    expect(r.typed.tables.typing.presence.length).toBe(2);
  });
  test("`bool` is a boolean test (not a presence test)", () => {
    const r = run(prog(O, "<p if=@b>a</p>"));
    expect(r.diags).toEqual([]);
    expect(r.typed.tables.typing.presence).toEqual([]);
  });
});

describe("S460 — a KNOWN non-bool, non-optional type stays E-COND-NOT-BOOLEAN (S440 #4 (c) kept)", () => {
  const C = "    let <n:int=0/>\n    let <s:string=\"\"/>\n    <xs:int[]=([1])/>\n    let <b:bool=false/>\n";
  test("int / string / array in `if=`, `else-if=`, `if`, a ternary", () => {
    for (const x of ["@n", "@s", "@xs"]) {
      expect(codes(C, `<p if=${x}>a</p>`)).toEqual(["E-COND-NOT-BOOLEAN"]);
      expect(codes(C, `<p if=@b>a</p><p else-if=${x}>b</p>`)).toEqual(["E-COND-NOT-BOOLEAN"]);
    }
    expect(codes(C + "    function f() { if (@s) { @b = true } }")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(C, "<p>${@n ? \"a\" : \"b\"}</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("the message names the type (not the unresolved-type message)", () => {
    const d = diags(C, "<p if=@n>a</p>");
    expect(d[0].message).toContain("`int`");
    expect(d[0].message).not.toContain(UNRESOLVED_MSG);
  });
});

describe("S460 — a bare `bool | not` stays an error naming both fixes (S442 kept)", () => {
  test("fires in `if=`, `if`, a ternary; the message names `x is given` and `x == true`", () => {
    const d = diags(O, "<p if=@o.f>a</p>");
    expect(d.map((x) => x.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(d[0].message).toContain("x is given");
    expect(d[0].message).toContain("x == true");
    expect(codes(O + "    function f() { if (@o.f) { @m = 1 } }")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(O, "<p>${@o.f ? \"a\" : \"b\"}</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("twins — both fixes are legal", () => {
    expect(codes(O, "<p if=(@o.f is given)>a</p><p if=(@o.f == true)>b</p>")).toEqual([]);
  });
});

describe("S460 NEW — a condition whose type the compiler cannot resolve is E-COND-NOT-BOOLEAN", () => {
  const G = "    function g() { }\n";   // no declared return type: its value is unresolved
  test("a call with no declared return type in `if=`, `else-if=`, `show=`, an `if`, a ternary", () => {
    expect(codes(G, "<p if=g()>a</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G + "    let <b:bool=false/>\n", "<p if=@b>a</p><p else-if=g()>b</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G, "<p show=g()>a</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G + "    let <m:int=0/>\n    function f() { if (g()) { @m = 1 } }")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G, "<p>${g() ? \"a\" : \"b\"}</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("the message says the type is unresolved and names the fixes (annotate; `x is given`; `x == true`)", () => {
    const m = diags(G, "<p if=g()>a</p>")[0].message;
    expect(m).toContain(UNRESOLVED_MSG);
    expect(m).toContain("annotate");
    expect(m).toContain("x is given");
    expect(m).toContain("x == true");
  });
  test("an unannotated parameter — the slice refuses the parameter, and the condition is still reported", () => {
    const cs = codes("    let <m:int=0/>\n    function f(a) { if (a) { @m = 1 } }");
    expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(cs).toContain("E-COND-NOT-BOOLEAN");
  });
  test("a value from the SQL boundary (no row type in the bootstrap, §42.9) — and its explicit twin is legal", () => {
    const fn = (cond) => `<program db="./app.db">\n    function f() -> int {\n        const r = ${SQ}\`SELECT a FROM t\`}.get() !{ _ :> not }\n        if (${cond}) { return 1 }\n        return 0\n    }\n    <main><p>x</p></main>\n</program>\n`;
    expect(run(fn("r")).diags.map((d) => d.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(run(fn("r is given")).diags.map((d) => d.code)).toEqual([]);
  });
  test("twins — annotating the return type resolves it: `-> bool` is a boolean test; `-> int` is the known-type error", () => {
    expect(codes("    function g() -> bool { return true }\n", "<p if=g()>a</p>")).toEqual([]);
    const d = diags("    function g() -> int { return 1 }\n", "<p if=g()>a</p>");
    expect(d.map((x) => x.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(d[0].message).not.toContain(UNRESOLVED_MSG);
  });
  test("twins — the explicit forms over the unresolved value are legal (`is given`, `== true`)", () => {
    expect(codes(G, "<p if=(g() is given)>a</p>")).toEqual([]);
  });
  test("non-condition rules stay provable-or-silent: an unresolved operand, `<each in=>`, an argument", () => {
    const C = "    let <s:string=\"\"/>\n    let <b:bool=false/>\n";
    expect(codes(C + G + "    function f() { @s = @s + g()\n @b = g() < 1 }")).toEqual([]);
    expect(codes(G, "<each in=g() as c><p>x</p></each>")).toEqual([]);
  });
});

describe("S460 statement 6 — no second report: an unresolved type an error already explains", () => {
  const M = "    let <m:int=0/>\n";
  test("an undeclared name (E-SCOPE-001 only)", () => {
    expect(codes(M + "    function f() { if (zz) { @m = 1 } }")).toEqual(["E-SCOPE-001"]);
  });
  test("a refused operator (E-OPERATOR-OPERAND-TYPE only)", () => {
    expect(codes(M + "    let <s:string=\"\"/>\n    function f() { if (@s - 1) { @m = 1 } }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("a parameter / return type that did not resolve (E-TYPE-UNKNOWN only — Rule C, r8)", () => {
    expect(codes(M + "    function f(a: Nope) { if (a) { @m = 1 } }")).toEqual(["E-TYPE-UNKNOWN"]);
    expect(codes(M + "    function g() -> Nope { }\n    function f() { if (g()) { @m = 1 } }")).toEqual(["E-TYPE-UNKNOWN"]);
  });
  test("a field that does not exist (E-SCOPE-001 only)", () => {
    expect(codes(O, "<p if=@o.qq>a</p>")).toEqual(["E-SCOPE-001"]);
  });
  test("a condition inside a construct already refused (`if=` on a `<db>`: E-BOOTSTRAP-UNSUPPORTED only)", () => {
    expect(codes("    let <n:int=0/>\n    <db src=\"./a.db\" if=@n><p>a</p></db>")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    // an operator the binder never resolved there (found by the S460 corpus self-count)
    expect(codes("    let <n:int=0/>\n    <db src=\"./a.db\" if=(@n > 0)><p>a</p></db>")).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a call of an undeclared function (E-SCOPE-001 only)", () => {
    expect(codes("", "<p if=nope()>a</p>")).toEqual(["E-SCOPE-001"]);
  });
  test("a parse error inside the condition (Rule C — the condition is not judged)", () => {
    const cs = codes("    function g() { }\n    let <m:int=0/>\n    function f() { if (g(#)) { @m = 1 } }");
    expect(cs).toContain("E-PARSE-EXPR");
    expect(cs).not.toContain("E-COND-NOT-BOOLEAN");
  });
});

describe("S460 — `x is given` / `x is not`: the explicit pair (parsed, typed `bool`, narrowing)", () => {
  test("parsed as the postfix presence tests (`!x is not` is `!(x is not)`)", () => {
    const r = run(prog(O + "    function f() { if (!@o.n is not) { @m = @o.n + 1 } }"));
    expect(r.diags).toEqual([]);
    const un = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.k && n.k.variant === "Unary") un.push(n.k.data.op.variant ?? n.k.data.op);
      Object.values(n).forEach(walk);
    })(r.asts);
    expect(un).toEqual(["Not", "IsNot"]);
  });
  test("value positions — a `const`, an assignment, a `return`, an argument", () => {
    expect(codes(O + "    function g(x: bool) -> bool { return x }\n    function f() -> bool { const ok: bool = @o.v is given\n @b = @o.v is not\n @b = g(@o.n is given)\n return ok }")).toEqual([]);
  });
  test("compounds narrow: `x is given && x > 0`; `x is not || …`; an early `if (x is not) return`", () => {
    expect(codes(O + "    function f() { if (@o.n is given && @o.n > 0) { @m = @o.n + 1 } }")).toEqual([]);
    expect(codes(O + "    function f() { if (@o.n is not || @o.n > 0) { @m = 1 } }")).toEqual([]);
    expect(codes(O + "    function f() { if (@o.n is not) return\n @m = @o.n + 1 }")).toEqual([]);
    expect(codes(O, "<p if=(@o.v is given)>${@o.v + \"!\"}</p>")).toEqual([]);
  });
  test("twins — no narrowing where the test does not prove presence", () => {
    expect(codes(O + "    function f() { if (@o.n is not) { @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(codes(O + "    function f() { if (@o.n is given || @b) { @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a write drops the narrowing — directly, and inside a NESTED block (the join, r2 F1 / F3)", () => {
    expect(codes(O + "    function f() { if (@o.n is given) { @o = { v: not, n: not, f: not }\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    expect(codes(O + "    function f() { if (@o.n is given) { if (@b) { @o = { v: not, n: not, f: not } }\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
    // twin: a nested block that writes something else keeps it
    expect(codes(O + "    function f() { if (@o.n is given) { if (@b) { @m = 2 }\n @m = @o.n + 1 } }")).toEqual([]);
  });
  test("a newline before `is` does not continue the line (§7.2.2)", () => {
    expect(codes(O + "    function f() { const q: bool = @o.n\n        is given }").some((c) => c.startsWith("E-PARSE-"))).toBe(true);
  });
});

describe("S460 — `!` / `&&` / `||` take booleans only: a bare `T | not` is a presence test only as a WHOLE condition (S440 Gotcha Q2 kept)", () => {
  test("`!x` / `x && …` / `x || …` on a `T | not` is E-OPERATOR-OPERAND-TYPE, and the hint names `x is given`", () => {
    const d = diags(O + "    function f() { if (!@o.v) { @m = 1 } }");
    expect(d.map((x) => x.code)).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(d[0].message).toContain("x is given");
    expect(codes(O + "    function f() { if (@o.v && @b) { @m = 1 } }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(codes(O + "    function f() { if (@b || @o.v) { @m = 1 } }")).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });
  test("twins — `!(x is not)`, `x is given && …` are legal", () => {
    expect(codes(O + "    function f() { if (!(@o.v is not)) { @m = 1 } }")).toEqual([]);
    expect(codes(O + "    function f() { if (@o.v is given && @b) { @m = 1 } }")).toEqual([]);
  });
});

// S460 F2 — ruled "a on F2, go" (user-voice-scrml.md §S460): inside a CONDITION, an operand of `!` / `&&` /
// `||` whose type cannot be resolved is E-COND-NOT-BOOLEAN (unresolved message), like a bare unresolved
// condition; operands OUTSIDE a condition stay provable-or-silent (S440 Q2). SPEC §42.4 statement 10.
describe("S460 F2 — an unresolved operand of `!` / `&&` / `||` in a condition is E-COND-NOT-BOOLEAN", () => {
  const G = "    function g() { }\n    let <b:bool=false/>\n    let <c:bool=false/>\n    let <m:int=0/>\n";
  const inIf = (cond) => codes(G + `    function f() { if (${cond}) { @m = 1 } }`);
  test("fires — `!g()`, `g() && @b`, `g() || false` in an `if`", () => {
    expect(inIf("!g()")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inIf("g() && @b")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inIf("@b && g()")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inIf("g() || false")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("fires — markup `if=!g()`, `show=(g() && @b)`, a ternary test", () => {
    expect(codes(G, "<p if=!g()>a</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G, "<p show=(g() && @b)>a</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(codes(G + "    function f() { @m = (g() && @b) ? 1 : 0 }")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("nested logical operators are walked — `!(g() && @b)` is ONE report, at `g()`", () => {
    const r = run(prog(G + "    function f() { if (!(g() && @b)) { @m = 1 } }"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(inIf("g() && g()")).toEqual(["E-COND-NOT-BOOLEAN", "E-COND-NOT-BOOLEAN"]);
  });
  test("the message: an operand, the type is unresolved, the fixes, the ruling", () => {
    const m = diags(G + "    function f() { if (!g()) { @m = 1 } }")[0].message;
    expect(m).toContain("operand of `!`");
    expect(m).toContain(UNRESOLVED_MSG);
    expect(m).toContain("annotate");
    expect(m).toContain("x is given");
    expect(m).toContain("x == true");
    expect(m).toContain("a on F2");
  });
  test("twins — `!(g() is given)` and `@b && @c` (bools) are legal", () => {
    expect(inIf("!(g() is given)")).toEqual([]);
    expect(inIf("@b && @c")).toEqual([]);
    expect(inIf("(g() is given) && @b")).toEqual([]);
  });
  test("twins — OUTSIDE a condition an unresolved operand stays silent (S440 Q2): a value, an argument inside a condition", () => {
    expect(codes(G + "    function f() { @b = !g() }")).toEqual([]);
    expect(codes(G + "    function f() { @b = g() && @c }")).toEqual([]);
    expect(codes(G + "    function h(x: bool) -> bool { return x }\n    function f() { if (h(!g())) { @m = 1 } }")).toEqual([]);
  });
  test("statement 6 per operand — an operand an error already explains is not reported again", () => {
    expect(inIf("zz && @b")).toEqual(["E-SCOPE-001"]);
    expect(inIf("!nope()")).toEqual(["E-SCOPE-001"]);
  });
});

// At RUNTIME: `x is given` / `x is not` are absence checks — `""` and `0` are PRESENT (S89, §42.1.1).
const EXPLICIT = `<program>
    type O:struct = { let v: string | not, let n: int | not }
    let <o:O=({ v: "", n: 0 })/>
    let <out:string="?"/>
    function clear() { @o = { v: not, n: not } }
    function probe() {
        if (@o.n is given) { @out = "present" } else { @out = "absent" }
    }
    <main>
        <p class="v" if=(@o.v is given)>V</p>
        <p class="nv" if=(@o.v is not)>none</p>
        <p class="t">\${@o.n is not ? "no" : "yes"}</p>
        <p class="out">\${@out}</p>
        <button class="probe" onclick=probe()>probe</button>
        <button class="clear" onclick=clear()>clear</button>
    </main>
</program>
`;

describe("S460 at runtime — `is given` / `is not` lower to absence checks, never JS truthiness", () => {
  test("over `\"\"` and `0` they are PRESENT; over `not`, absent", async () => {
    const r = run(EXPLICIT);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "s460-explicit-presence");
    expect(document.querySelector("p.v")).not.toBeNull();
    expect(document.querySelector("p.nv")).toBeNull();
    expect(document.querySelector("p.t").textContent).toBe("yes");
    click(document.querySelector("button.probe"));
    expect(document.querySelector("p.out").textContent).toBe("present");
    click(document.querySelector("button.clear"));
    expect(document.querySelector("p.v")).toBeNull();
    expect(document.querySelector("p.nv")).not.toBeNull();
    expect(document.querySelector("p.t").textContent).toBe("no");
    click(document.querySelector("button.probe"));
    expect(document.querySelector("p.out").textContent).toBe("absent");
  });
});

// S460 N1 — PA reading of "a on F2, go" (user-voice-scrml.md §S460; SPEC §42.4 statement 10): a ternary
// that IS the condition's value, or an operand in its `!` / `&&` / `||` chain, has ARMS that are the
// condition's value when taken — walked with the same rule (an unresolved arm or arm operand is
// E-COND-NOT-BOOLEAN, blamed at the arm / operand; a `T | not` arm is a presence test). A ternary in a VALUE
// position (an initializer, a call argument) stays a value: silent (S440 Q2).
describe("S460 N1 — ternary arms of the condition's value are inside the condition", () => {
  const G = "    function g() { }\n    function h(x: bool) -> bool { return x }\n    let <b:bool=false/>\n    let <c:bool=false/>\n    let <m:int=0/>\n";
  const inIf = (cond) => diags(G + `    function f() { if (${cond}) { @m = 1 } }`);
  const blamed = (cond) => {
    const src = prog(G + `    function f() { if (${cond}) { @m = 1 } }`);
    return run(src).diags.map((d) => [d.code, src.slice(d.span.start, d.span.end)]);
  };
  test("fires — `@b ? !g() : @c` and `@b ? (g() && @c) : @c` (were clean), blamed at `g()`", () => {
    expect(blamed("@b ? !g() : @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
    expect(blamed("@b ? (g() && @c) : @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
    const m = inIf("@b ? !g() : @c")[0].message;
    expect(m).toContain("a ternary arm of an `if` condition");
    expect(m).toContain(UNRESOLVED_MSG);
  });
  test("a bare unresolved arm is blamed at the ARM (not the whole ternary)", () => {
    expect(blamed("@b ? g() : @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
  });
  test("nested ternaries — `@b ? (@c ? !g() : @b) : @c`, `@b ? (@c ? g() : @b) : @c`", () => {
    expect(blamed("@b ? (@c ? !g() : @b) : @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
    expect(blamed("@b ? (@c ? g() : @b) : @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
  });
  test("a ternary operand of `!` / `&&` — `!(@b ? !g() : @c)`, `(@b ? g() : @c) && @c` — blamed at `g()`", () => {
    expect(blamed("!(@b ? !g() : @c)")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
    expect(blamed("(@b ? g() : @c) && @c")).toEqual([["E-COND-NOT-BOOLEAN", "g()"]]);
  });
  test("a non-bool arm of an unresolved ternary is judged too (whole: E-COND-NOT-BOOLEAN; operand: E-OPERATOR-OPERAND-TYPE)", () => {
    expect(blamed("@b ? 1 : g()")).toEqual([["E-COND-NOT-BOOLEAN", "1"], ["E-COND-NOT-BOOLEAN", "g()"]]);
    expect(blamed("(@b ? 1 : g()) && @c")).toEqual([["E-OPERATOR-OPERAND-TYPE", "1"], ["E-COND-NOT-BOOLEAN", "g()"]]);
  });
  test("a RESOLVED non-bool ternary is still judged whole (one report)", () => {
    expect(blamed("@b ? 1 : 2")).toEqual([["E-COND-NOT-BOOLEAN", "@b ? 1 : 2"]]);
  });
  test("markup `if=` — the same walk", () => {
    expect(codes(G, "<p if=(@b ? !g() : @c)>a</p>")).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("statement 6 per arm — an arm an error explains is not reported; its sibling still is", () => {
    expect(blamed("@b ? zz : g()")).toEqual([["E-SCOPE-001", "zz"], ["E-COND-NOT-BOOLEAN", "g()"]]);
    expect(blamed("@b ? zz : @c")).toEqual([["E-SCOPE-001", "zz"]]);
  });
  test("twins — VALUE positions stay silent: an initializer, a call argument", () => {
    expect(codes(G + "    function f() { const v = @b ? !g() : @c\n @b = v }")).toEqual([]);
    expect(inIf("h(@b ? !g() : @c)")).toEqual([]);
    expect(inIf("h(!g())")).toEqual([]);
  });
  test("twins — resolved arms are legal; a `T | not` arm is a presence test of its own", () => {
    expect(inIf("@b ? !(g() is given) : @c")).toEqual([]);
    const r = run(prog(O + "    let <c:bool=false/>\n    function f() { if (@b ? @o.n : @c) { @m = 1 } }"));
    expect(r.diags).toEqual([]);
    expect(r.typed.tables.typing.presence.length).toBe(1);
  });
});

describe("S460 N3 — the condition message names the attribute it stands in", () => {
  const G = "    function g() { }\n    let <b:bool=false/>\n    let <c:bool=false/>\n";
  test("an `else-if=` operand and a whole `else-if=` say `else-if=`, not `if=`", () => {
    const d = diags(G, "<p if=@c>a</p><p else-if=(@b || g())>b</p>");
    expect(d.map((x) => x.code)).toEqual(["E-COND-NOT-BOOLEAN"]);
    expect(d[0].message).toContain("in `else-if=`");
    expect(d[0].message).not.toContain("`if=`");
    expect(diags(G, "<p if=@c>a</p><p else-if=g()>b</p>")[0].message).toContain("`else-if=` is a value");
  });
  test("twin — an `if=` operand still says `if=`", () => {
    expect(diags(G, "<p if=(@b || g())>a</p>")[0].message).toContain("in `if=`");
  });
});

// At RUNTIME: a `T | not` arm of the condition's value lowers to an absence check — `0` is PRESENT.
const ARM_PRESENCE = `<program>
    type O:struct = { let n: int | not }
    let <o:O=({ n: 0 })/>
    let <b:bool=true/>
    let <c:bool=false/>
    function clear() { @o = { n: not } }
    <main>
        <p class="a" if=(@b ? @o.n : @c)>A</p>
        <button class="clear" onclick=clear()>clear</button>
    </main>
</program>
`;

describe("S460 N1 at runtime — a `T | not` ternary arm of a condition is an absence check", () => {
  test("`0` is present (shown); `not` is absent (hidden)", async () => {
    const r = run(ARM_PRESENCE);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "s460-arm-presence");
    expect(document.querySelector("p.a")).not.toBeNull();
    click(document.querySelector("button.clear"));
    expect(document.querySelector("p.a")).toBeNull();
  });
});
