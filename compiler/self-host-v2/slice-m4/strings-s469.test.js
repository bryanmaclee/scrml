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
    // s469 (S469 "more string methods admitted" — "Anything not admitted is refused"): an unknown
    // method on a string is E-STRING-METHOD-UNKNOWN (Appendix D.1), naming the nearest admitted form
    expect(diag(prog(S, `        <p>\${@s.substring(1)}</p>`), "E-STRING-METHOD-UNKNOWN")?.message).toContain("`.substring(…)`");
    expect(codes(prog(S, `        <p>\${@s.substring(1)}</p>`))).toEqual(["E-STRING-METHOD-UNKNOWN"]);
    expect(codes(prog(`    let <n:int=1/>`, `        <p>\${@n.trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    let <m:string | not=not/>`, `        <p>\${@m.trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(S + `\n    function f() { return "a" }`, `        <p>\${f().trim()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("code points (runtime): charAt / slice / split(\"\") never cut an astral character in half", async () => {
    await load(prog(`    let <e:string="😀é😀"/>`,
      `        <p id="a">\${@e.charAt(1)}</p>\n        <p id="b">\${@e.slice(@e.length - 1)}</p>\n        <p id="c">\${@e.split("").length}</p>\n        <p id="d">\${@e.length}</p>`));
    expect($("#a").textContent).toBe("é");
    expect($("#b").textContent).toBe("😀");
    expect($("#c").textContent).toBe("3");
    expect($("#d").textContent).toBe("3");   // bryan, S469: code points everywhere, `.length` included
  });
  test("ONE unit for every string position (runtime): the idioms that broke when `.length` counted UTF-16 units", async () => {
    await load(prog(`    let <e:string="a😀"/>`,
      `        <p id="len">\${@e.length}</p>\n        <p id="init">[\${@e.slice(0, @e.length - 1)}]</p>\n        <p id="last">\${@e.charAt(@e.length - 1)}</p>\n        <p id="split">\${@e.split("").length}</p>\n        <p id="tail">[\${@e.slice(@e.length)}]</p>`));
    expect($("#len").textContent).toBe("2");
    expect($("#init").textContent).toBe("[a]");
    expect($("#last").textContent).toBe("😀");
    expect($("#split").textContent).toBe("2");   // the count `for (ch of s)` yields (the loop lane's iterate head)
    expect($("#tail").textContent).toBe("[]");
  });
  test("a tape's `.length` is still its element count; a string's lowers to Core StrLength", () => {
    const json = JSON.stringify(clean(prog(S + `\n    <xs:int[]=([1, 2])/>`, `        <p>\${@s.length}</p>\n        <p>\${@xs.length}</p>`)).core);
    expect(json).toContain("StrLength");
    expect(json).toContain('"Length"');
  });
  test("the runtime length agrees with `for (ch of s)` for every kind of string (BMP, astral, combining, lone surrogate)", async () => {
    const rt = await import("../slice-m1/runtime/runtime.js");
    for (const s of ["", "abc", "a😀", "😀😀", "é", "\uD83D", "x\uDE00y", "👍🏽"]) {
      let n = 0;
      for (const _ of s) n++;
      expect([s, rt.strLength(s)]).toEqual([s, n]);
      expect([s, rt.strSplit(s, "").length]).toEqual([s, n]);
    }
  });
  test("round 3 (runtime): the code-point helpers agree with a code-point REFERENCE on random strings (surrogates, pairs, ASCII, regex metacharacters)", async () => {
    const rt = await import("../slice-m1/runtime/runtime.js");
    const cps = (s) => [...s];
    const refIndex = (a, b, from) => {
      for (let i = from; i + b.length <= a.length; i++) if (b.every((c, j) => a[i + j] === c)) return i;
      return -1;
    };
    const refIncludes = (s, t) => refIndex(cps(s), cps(t), 0) >= 0;
    const refSplit = (s, t) => {
      const a = cps(s), b = cps(t), out = [];
      let start = 0, i = refIndex(a, b, 0);
      while (i >= 0) { out.push(a.slice(start, i).join("")); start = i + b.length; i = refIndex(a, b, start); }
      out.push(a.slice(start).join(""));
      return out;
    };
    const A = ["a", "b", "😀", "\uD83D", "\uDE00", ".", "*", "(", "\\", "$", "|", "/", "-", "é"];
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const str = (max) => { let s = ""; const n = rnd(max + 1); for (let i = 0; i < n; i++) s += A[rnd(A.length)]; return s; };
    for (let k = 0; k < 3000; k++) {
      const s = str(10), t = str(3);
      expect([s, t, rt.strIncludes(s, t)]).toEqual([s, t, refIncludes(s, t)]);
      if (t !== "") expect([s, t, rt.strSplit(s, t)]).toEqual([s, t, refSplit(s, t)]);
      const n = cps(s).length;
      expect([s, rt.strLength(s)]).toEqual([s, n]);
      const i = rnd(n + 2) - 1;
      expect([s, i, rt.strCharAt(s, i)]).toEqual([s, i, i >= 0 && i < n ? cps(s)[i] : ""]);
    }
  });
  test("round 3 (runtime): includes / split are linear on adversarial input (the pre-fix search took ~350 ms here)", async () => {
    const rt = await import("../slice-m1/runtime/runtime.js");
    const s = "😀".repeat(1e5);
    const t = "\uDE00" + "😀".repeat(1e4) + "\uD83D";
    const t0 = performance.now();
    expect(rt.strIncludes(s, t)).toBe(false);
    expect(rt.strSplit(s, t)).toEqual([s]);
    const big = "a😀".repeat(5e4);
    let n = 0;
    for (let i = 0; i < 200; i++) n += rt.strCharAt(big, i).length;
    expect(n).toBe(300);
    expect(performance.now() - t0).toBeLessThan(150);       // generous: about 5 ms measured
  });
  test("F/U-2 (runtime): includes / startsWith / endsWith / split match only on code-point boundaries — a lone surrogate never matches half of an astral character", async () => {
    const rt = await import("../slice-m1/runtime/runtime.js");
    const hi = "\uD83D", lo = "\uDE00";            // the two halves of 😀
    expect(rt.strIncludes("a😀b", hi)).toBe(false);
    expect(rt.strIncludes("a😀b", lo)).toBe(false);
    expect(rt.strIncludes("a😀b", "😀")).toBe(true);
    expect(rt.strIncludes(hi + "x", hi)).toBe(true);   // a lone surrogate in the string itself is a whole code point
    expect(rt.strStartsWith("😀a", hi)).toBe(false);
    expect(rt.strEndsWith("a😀", lo)).toBe(false);
    expect(rt.strStartsWith("😀a", "😀")).toBe(true);
    expect(rt.strEndsWith("a😀", "😀")).toBe(true);
    expect(rt.strSplit("a😀b😀c", lo)).toEqual(["a😀b😀c"]);
    expect(rt.strSplit("a😀b😀c", "😀")).toEqual(["a", "b", "c"]);
    expect(rt.strSplit("a,b,,c", ",")).toEqual(["a", "b", "", "c"]);
    expect(rt.strIncludes("abc", "")).toBe(true);
    expect(rt.strSplit("x" + hi + "y" + hi, hi)).toEqual(["x", "y", ""]);   // lone surrogates split as whole code points
    expect(() => rt.strSlice("abc", 1.5)).toThrow("not an int");
    expect(() => rt.strCharAt("abc", "1")).toThrow("not an int");
  });
  test("reactive: a method result re-renders when its receiver changes", async () => {
    await load(prog(S, `        <button onclick={ @s = "  yo  " }>set</button>\n        <p id="u">[\${@s.trim().toUpperCase()}]</p>`));
    expect($("#u").textContent).toBe("[HI]");
    click(btn("set"));
    expect($("#u").textContent).toBe("[YO]");
  });
});

// ---------------------------------------------------------------------------
// Cross-lane (strings × loops, merged after #1474): ONE unit for every string position.
describe("strings × loops — a range over `s.length`, `for (ch of s)` and `charAt` agree (code points)", () => {
  const FNS = `    let <s:string="a😀b"/>
    function viaRange(t: string) -> string {
        let out: string = ""
        for (i of 0..t.length) { out = out + "[" + t.charAt(i) + "]" }
        return out
    }
    function viaOf(t: string) -> string {
        let out: string = ""
        for (ch of t) { out = out + "[" + ch + "]" }
        return out
    }
    function countRange(t: string) -> int {
        let n: int = 0
        for (i of 0..t.length) { n = n + 1 }
        return n
    }
    function countOf(t: string) -> int {
        let n: int = 0
        for (ch of t) { n = n + 1 }
        return n
    }`;
  test("on \"a😀b\": `0..s.length` runs 3 times, as `for (ch of s)` does, and `charAt(i)` is each code point (runtime)", async () => {
    await load(prog(FNS, `        <p id="r">\${viaRange(@s)}</p>\n        <p id="o">\${viaOf(@s)}</p>\n        <p id="cr">\${countRange(@s)}</p>\n        <p id="co">\${countOf(@s)}</p>`));
    expect($("#r").textContent).toBe("[a][😀][b]");
    expect($("#o").textContent).toBe("[a][😀][b]");
    expect($("#cr").textContent).toBe("3");
    expect($("#co").textContent).toBe("3");
  });
  test("s469: `s[i]` on a string is ruled (§66.12.8 rule 6) — the code point at `i`, a `string` (runtime)", async () => {
    expect(codes(prog(`    let <s:string="ab"/>`, `        <p>\${@s[0]}</p>`))).toEqual([]);
    expect(codes(prog(`    let <s:string="ab"/>\n    <t:int=(@s[0])/>`, `        <p>\${@t}</p>`))).toEqual(["E-TYPE-031"]);
    await load(prog(`    let <s:string="a😀b"/>`, `        <p id="i">[\${@s[1]}][\${@s[2]}]</p>`));
    expect($("#i").textContent).toBe("[😀][b]");
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
  test("F/U-4: a discarded sort / reverse inside a ternary or a `&&` / `||` statement is E-TAPE-JS-METHOD, once per branch", () => {
    const fn = (body) => prog(T + `\n    let <n:int=0/>\n    function go() {\n        ${body}\n    }`, `        <button onclick=go()>go</button>`);
    expect(codes(fn(`@n == 0 ? @xs.sort() : @xs.reverse();`))).toEqual(["E-TAPE-JS-METHOD", "E-TAPE-JS-METHOD"]);
    expect(codes(fn(`@n == 0 ? @xs.sort() : @n;`))).toContain("E-TAPE-JS-METHOD");
    expect(codes(fn(`(@n == 0) && @xs.reverse().length == 0;`)).filter((c) => c === "E-TAPE-JS-METHOD")).toEqual([]);   // the value is compared, not discarded
  });
  test("F/U-5: a sort / reverse / comparator-sort / filter / map result carries NO grants (its own type's), never the receiver's", () => {
    const r = clean(prog(T, `        <p>\${@xs.sort().length}</p>\n        <p>\${@xs.reverse().length}</p>\n        <p>\${@xs.sort((a, b) => a - b).length}</p>\n        <p>\${@xs.filter(x => x > 1).length}</p>`));
    const seqs = r.typed.tables.typing.exprs.map((x) => x.vt?.data?.t).filter((t) => t && t.variant === "Seq");
    const granted = seqs.filter((t) => t.data.grants.positionsWritable || t.data.grants.at.length > 0);
    const plain = seqs.filter((t) => t.data.grants.length === "Fixed" && !t.data.grants.positionsWritable && t.data.grants.at.length === 0);
    expect(plain.length).toBe(4);                  // the four calls
    expect(granted.length).toBe(4);                // the four receivers `@xs`
  });
  test("F/U-6: C9 — a PositionWrite's value must be a map / sort / reverse OF THE FIELD (checked in Core)", () => {
    const src = prog(T + `\n    <ys:int[free, append, writable]=([9])/>\n    function go() {\n        @xs = @xs.sort();\n    }`, `        <button onclick=go()>go</button>`);
    const r = clean(src);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    // graft: the same write with another field's tape as its value
    const core = JSON.parse(JSON.stringify(r.core));
    let grafted = 0;
    const visit = (x) => {
      if (Array.isArray(x)) { x.forEach(visit); return; }
      if (!x || typeof x !== "object") return;
      if (x.variant === "Prim" && x.data?.op === "SortNum") { x.data.op = "Neg"; grafted++; }
      Object.values(x).forEach(visit);
    };
    visit(core);
    expect(grafted).toBe(1);
    expect(mods.check.checkCore(core).join("\n")).toContain("C9");
  });
  test("round 3: a discarded sort / reverse on a NON-place receiver says bind the result (no write-back to offer)", () => {
    const fn = (body) => prog(S + `\n    function go() {\n        ${body}\n    }`, `        <button onclick=go()>go</button>`);
    const m = diag(fn(`@s.split(",").reverse();`), "E-TAPE-JS-METHOD")?.message ?? "";
    expect(m).toContain("bind the result");
    expect(m).not.toContain("writable");
  });
  test("F/U-8: the arity message of `sort` names its two forms", () => {
    expect(diag(prog(T, `        <p>\${@xs.sort((a, b) => a - b, 1).length}</p>`), "E-CALL-ARITY")?.message).toContain("no argument (the natural order) or one comparator");
  });
  test("F/U-8: a payload-variant construction is refused AS a construction", () => {
    const src = `<program>\n    type E:enum = { Missing(id: string), Ok }\n    let <s:string=""/>\n    <main><p>\${match E.Missing("x") { .Missing(id) :> id, .Ok :> "ok", }}</p></main>\n</program>\n`;
    const d = diag(src, "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("constructing the payload variant `E.Missing(…)`");
  });
  test("a JavaScript name on a value that is not a tape is not E-TAPE-JS-METHOD (it is simply not in the bootstrap)", () => {
    // (a `push` on a reactive place is still read as a write by the value-position rule — pre-existing, by name)
    const cs = codes(prog(S, `        <p>\${@s.push(1)}</p>`));
    expect(cs).toContain("E-STRING-METHOD-UNKNOWN");   // s469: on a string, an unknown method is D.1's refusal
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
