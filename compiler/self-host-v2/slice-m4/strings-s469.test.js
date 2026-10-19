// strings-s469.test.js — s469-boot-strings-1: the typed built-in methods of a
// string and a tape, JavaScript's tape names refused, and the provisional
// W-STRING-INTERP-LITERAL lint. (The program-level cases — compiled, run and
// their output checked — are acceptance/{strings,tapes,interp}, graded in
// acceptance.test.js.)
//
//   B. string methods (SPEC Appendix D; S469: string positions are code points):
//      toUpperCase / toLowerCase / trim / slice / charAt / includes / startsWith /
//      endsWith / split — a typed member call on a `string` receiver.
//   C. tape sort / sort(cmp) / reverse / join — each a NEW tape (§66.12.6 rule 3;
//      S469: natural order by type); push / unshift / splice / toSorted /
//      toReversed / with are E-TAPE-JS-METHOD; append / prepend are the edits.
//   D. W-STRING-INTERP-LITERAL (PROVISIONAL — no §34 row yet): a logic string
//      holding `${`, which is plain text there (§5.5.3, §4.18).
//   A. int→string: NOT built (no ruled spelling; the owner is reconsidering
//      conversions as a whole) — string + int stays E-OPERATOR-OPERAND-TYPE.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code).sort();
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const prog = (decls, body) => `<program>\n${decls}\n    <main>\n${body}\n    </main>\n</program>\n`;
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
let k = 0;
const load = (src) => loadProgram(clean(src).core, "s469s-" + k++, []);
const S = `    let <s:string="Hi"/>`;

// ---------------------------------------------------------------------------
describe("B — string methods are typed member calls", () => {
  test("lowered to Core Prim ops on the receiver — never a generic member call", () => {
    const json = JSON.stringify(clean(prog(S, `        <p>\${@s.toUpperCase()}</p>\n        <p>\${@s.slice(1)}</p>\n        <p>\${@s.split("").length}</p>`)).core);
    for (const op of ["StrUpper", "StrSlice", "StrSplit"]) expect(json).toContain(op);
  });
  test("results are typed: a bool from `includes` is refused where a string is wanted; `split` gives a string tape", () => {
    expect(codes(prog(S, `        <p>\${"x" + @s.includes("H")}</p>`))).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(codes(prog(S + `\n    <t:int=(@s.toUpperCase())/>`, `        <p>\${@t}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.split(",").join("-")}</p>`))).toEqual([]);
  });
  test("chains: the receiver of a method's result is that result's type", () => {
    expect(codes(prog(S, `        <p>\${@s.trim().charAt(0).toLowerCase().startsWith("h")}</p>`))).toEqual([]);
  });
  test("arguments are checked against the signature (E-TYPE-031) and counted (E-CALL-ARITY)", () => {
    expect(codes(prog(S, `        <p>\${@s.includes(1)}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.slice(1, "2")}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.slice(1.5)}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.slice(1, 2, 3)}</p>`))).toEqual(["E-CALL-ARITY"]);
    expect(codes(prog(S, `        <p>\${@s.toUpperCase(1)}</p>`))).toEqual(["E-CALL-ARITY"]);
  });
  test("an argument of unknown type is refused, fail closed (never handed to the host unchecked)", () => {
    const src = prog(S + `\n    function f() { return 1 }`, `        <p>\${@s.charAt(f())}</p>`);
    const d = diag(src, "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("cannot resolve");
  });
  test("an unknown method, or one on a receiver that is not provably a string, is refused BY NAME", () => {
    expect(diag(prog(S, `        <p>\${@s.replace("a", "b")}</p>`), "E-BOOTSTRAP-UNSUPPORTED")?.message).toContain("`.replace(…)`");
    expect(codes(prog(`    let <n:int=1/>`, `        <p>\${@n.trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    let <m:string | not=not/>`, `        <p>\${@m.trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(S + `\n    function f() { return "a" }`, `        <p>\${f().trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("code points (runtime): charAt / slice / split(\"\") never cut an astral character in half", async () => {
    await load(prog(`    let <e:string="😀é😀"/>`,
      `        <p id="a">\${@e.charAt(1)}</p>\n        <p id="b">\${@e.slice(-1)}</p>\n        <p id="c">\${@e.split("").length}</p>\n        <p id="d">\${@e.length}</p>`));
    expect($("#a").textContent).toBe("é");
    expect($("#b").textContent).toBe("😀");
    expect($("#c").textContent).toBe("3");
    expect($("#d").textContent).toBe("5");   // `.length` counts UTF-16 units (S469 documents the difference)
  });
  test("reactive: a method result re-renders when its receiver changes", async () => {
    await load(prog(S, `        <button onclick={ @s = "  yo  " }>set</button>\n        <p id="u">[\${@s.trim().toUpperCase()}]</p>`));
    expect($("#u").textContent).toBe("[HI]");
    click(btn("set"));
    expect($("#u").textContent).toBe("[YO]");
  });
});

// ---------------------------------------------------------------------------
describe("A — int→string is NOT built (no ruled spelling)", () => {
  test("string + int stays E-OPERATOR-OPERAND-TYPE; `String(n)` / `n.toString()` are refused", () => {
    expect(codes(prog(S, `        <p>\${"typed " + @s.length}</p>`))).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(codes(prog(S, `        <p>\${@s.length.toString()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(S, `        <p>\${String(@s.length)}</p>`))).toContain("E-SCOPE-001");
  });
});

// ---------------------------------------------------------------------------
describe("C — tape functions return a NEW tape; JavaScript's names are refused", () => {
  const T = `    <xs:int[free, append, writable]=([3, 1, 2])/>\n    <ws:string[]=(["b", "a"])/>`;
  test("sort() picks the natural order by element type (Core SortNum / SortStr); sort(cmp) is a SeqCall SortBy", () => {
    const json = JSON.stringify(clean(prog(T, `        <p>\${@xs.sort().length}</p>\n        <p>\${@ws.sort().join(",")}</p>\n        <p>\${@xs.sort((a, b) => a - b).length}</p>`)).core);
    for (const op of ["SortNum", "SortStr", "SortBy", "Join"]) expect(json).toContain(op);
  });
  test("the comparator: two parameters typed as the element; a body that is not a number is refused", () => {
    expect(codes(prog(T, `        <p>\${@xs.sort(a => a).length}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(T, `        <p>\${@ws.sort((a, b) => a + b).length}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(T, `        <p>\${@ws.sort((a, b) => a.length - b.length).join(",")}</p>`))).toEqual([]);
  });
  test("`@xs = @xs.sort()` / `.reverse()` is a position write (§66.12.6 rule 3): `writable` grants it, its absence refuses it", () => {
    expect(codes(prog(`    <xs:int[free, append]=([1])/>\n    function go() {\n        @xs = @xs.sort();\n    }`, `        <button onclick=go()>go</button>`))).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(diag(prog(`    <xs:int[free, append]=([1])/>\n    function go() {\n        @xs = @xs.reverse();\n    }`, `        <button onclick=go()>go</button>`), "E-WRITE-NOT-GRANTED")?.message).toContain("position-write");
  });
  test("sort / reverse do not mutate; writing the result back is a position write (runtime)", async () => {
    await load(prog(T, `        <button onclick={ @xs = @xs.sort() }>s</button>\n        <p id="v"><each in=@xs.reverse() as x><b>\${x}</b></each></p>\n        <p id="o"><each in=@xs as x><b>\${x}</b></each></p>`));
    expect($("#v").textContent).toBe("213");
    expect($("#o").textContent).toBe("312");
    click(btn("s"));
    expect($("#o").textContent).toBe("123");
    expect($("#v").textContent).toBe("321");
  });
  test("E-TAPE-JS-METHOD — in a statement and as a value, on a cell and on a local, with the fix-it named", () => {
    const fn = (body) => prog(T + `\n    function go() {\n        ${body}\n    }`, `        <button onclick=go()>go</button>`);
    expect(diag(fn(`@xs.push(4);`), "E-TAPE-JS-METHOD")?.message).toContain(".append(x)");
    expect(diag(fn(`@xs.unshift(4);`), "E-TAPE-JS-METHOD")?.message).toContain(".prepend(x)");
    expect(diag(fn(`@xs.splice(0, 1);`), "E-TAPE-JS-METHOD")?.message).toContain(".remove(i)");
    expect(codes(fn(`const n: int = @xs.toReversed().length;`))).toEqual(["E-TAPE-JS-METHOD"]);
    expect(codes(fn(`const n: int = @xs.with(0, 1).length;`))).toEqual(["E-TAPE-JS-METHOD"]);
    expect(codes(fn(`@xs.reverse();`))).toEqual(["E-TAPE-JS-METHOD"]);
    expect(diag(fn(`@xs.sort();`), "E-TAPE-JS-METHOD")?.message).toContain("@xs = @xs.sort(…);");
    expect(codes(fn(`const t: int[] = @xs;\n        t.push(1);`))).toEqual(["E-TAPE-JS-METHOD"]);
  });
  test("a JavaScript name on a value that is not a tape is not E-TAPE-JS-METHOD (it is simply not in the bootstrap)", () => {
    // (a `push` on a reactive place is still read as a write by the value-position rule — pre-existing, by name)
    const cs = codes(prog(S, `        <p>\${@s.push(1)}</p>`));
    expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(cs).not.toContain("E-TAPE-JS-METHOD");
  });
  test("append / prepend are the grant-named edits, checked against the grants", () => {
    const g = (decl, body) => codes(prog(decl + `\n    function go() {\n        ${body}\n    }`, `        <button onclick=go()>go</button>`));
    expect(g(`    <xs:int[free, append]=([])/>`, `@xs.append(1);`)).toEqual([]);
    expect(g(`    <xs:int[free, append]=([])/>`, `@xs.prepend(1);`)).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(g(`    <xs:int[free, prepend]=([])/>`, `@xs.prepend(1);`)).toEqual([]);
  });
  test("a write in a value position through append is still a write (E-VALUE-WRITES-STATE)", () => {
    expect(codes(prog(T, `        <p>\${@xs.append(1)}</p>`))).toContain("E-VALUE-WRITES-STATE");
  });
});

// ---------------------------------------------------------------------------
describe("D — W-STRING-INTERP-LITERAL (PROVISIONAL): `${` in a logic string", () => {
  test("a Warning (the program still lowers), once per literal, in a function body and in markup logic", () => {
    const r = run(prog(S + `\n    function f() -> string { return "n=\${x}" }`, `        <p>\${f()}</p>\n        <p>\${"a \${b} c"}</p>`));
    expect(r.diags.map((d) => [d.code, d.severity])).toEqual([["W-STRING-INTERP-LITERAL", "Warning"], ["W-STRING-INTERP-LITERAL", "Warning"]]);
    expect(r.core == null).toBe(false);
    expect(r.diags[0].message).toContain("Interpolate in markup");
    expect(r.diags[0].message).toContain("provisional");
  });
  test("silent on markup text, on a string with no `${`, a bare `$`, an ESCAPED `\\${`, and `${\"${\"}` (no `}`: §4.18.1b's literal `${`)", () => {
    expect(codes(prog(S, `        <p>typed \${@s.length} chars</p>\n        <p>\${"cost: $5 {x}"}</p>\n        <p>\${"a \\\${x}"}</p>\n        <p>\${"\${"}</p>`))).toEqual([]);
  });
  test("silent on a code-default body's display-text literal, which DOES interpolate (§4.18.4)", () => {
    expect(codes(`<program>\n    let <n:int=5/>\n    <main>\n        <p : "Count \${@n} items">\n    </main>\n</program>\n`)).toEqual([]);
  });
});
