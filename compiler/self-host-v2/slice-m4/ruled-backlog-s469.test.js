// ruled-backlog-s469.test.js — s469-boot-ruled-backlog: the S469 rulings built into the bootstrap.
// (The program-level cases — compiled, run and their output checked — are
// acceptance/{parse,strings,positions,arms}, graded in acceptance.test.js.)
//
//   P. `T.parse(s): T | not` (SPEC §14.13.4; user-voice S469 "conversions: parse spelling
//      `T.parse(s)`", "a failed parse is `T | not`", "strict whole-string parse", and "three
//      spec-follow-up opens" — non-finite parse is `not`). `E.toEnum` is the same path as `E.parse`.
//   T. `integer` / `boolean` are `int` / `bool` in type position (§14.13.6, no warning yet).
//   S. the admitted string methods (Appendix D.1, S469 "more string methods admitted"), code
//      points everywhere; any other method on a string is E-STRING-METHOD-UNKNOWN.
//   N. no negative positions (S469 "no negative positions anywhere"): a negative LITERAL slice
//      position / repeat count / pad width is E-POSITION-NEGATIVE; a computed one traps
//      (E-INDEX-OUT-OF-RANGE-RT); `charAt(-1)` is `""`, `at(-1)` is `not`; index reads trap.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";
import * as rt from "../slice-m1/runtime/runtime.js";
import * as srt from "../slice-m1/runtime/server-runtime.js";

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
let k = 0;
const load = (src) => loadProgram(clean(src).core, "s469rb-" + k++, []);
const S = `    let <s:string="Hi"/>`;
const show = `
    function showI(x: int | not) -> string {
        return match x {
            not :> "not"
            else :> "int"
        }
    }`;

// ---------------------------------------------------------------------------
describe("P — `T.parse(s)` (§14.13.4)", () => {
  test("int / number / bool parse are typed `T | not` and lower to Core ParseInt / ParseNum / ParseBool", () => {
    const json = JSON.stringify(clean(prog(S + `\n    <a:int | not=(int.parse(@s))/>\n    <b:number | not=(number.parse(@s))/>\n    <c:bool | not=(bool.parse(@s))/>`, `        <p>x</p>`)).core);
    for (const op of ["ParseInt", "ParseNum", "ParseBool"]) expect(json).toContain(op);
  });
  test("the result may be `not`: a plain `int` cell is refused (the failure is visible at the call site)", () => {
    expect(codes(prog(S + `\n    <a:int=(int.parse(@s))/>`, `        <p>\${@a}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S + `\n    function f() -> int { return int.parse(@s) }`, `        <p>\${f()}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S + `\n    function f() -> bool | not { return int.parse(@s) }`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
  });
  test("the argument is a string (E-TYPE-031) and there is exactly one (E-CALL-ARITY)", () => {
    expect(codes(prog(`    let <n:int=1/>\n    <a:int | not=(int.parse(@n))/>`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S + `\n    <a:int | not=(int.parse(@s, 10))/>`, `        <p>x</p>`))).toEqual(["E-CALL-ARITY"]);
    expect(codes(prog(S + `\n    <a:int | not=(int.parse())/>`, `        <p>x</p>`))).toEqual(["E-CALL-ARITY"]);
  });
  test("a primitive type name is a namespace for `.parse` only; `integer.parse` / `boolean.parse` / `string.parse` do not exist", () => {
    expect(diag(prog(S, `        <p>\${int.from(@s)}</p>`), "E-SCOPE-001")?.message).toContain("namespace for `.parse(s)` only");
    expect(diag(prog(S + `\n    <a:int | not=(integer.parse(@s))/>`, `        <p>x</p>`), "E-SCOPE-001")?.message).toContain("write `int.parse(s)`");
    expect(diag(prog(S + `\n    <a:bool | not=(boolean.parse(@s))/>`, `        <p>x</p>`), "E-SCOPE-001")?.message).toContain("write `bool.parse(s)`");
    expect(codes(prog(S, `        <p>\${string.parse(@s)}</p>`))).toEqual(["E-SCOPE-001"]);
  });
  test("`E.parse(s)` and `E.toEnum(s)` are ONE path: the same fact, the same Core", () => {
    const E = `    type G:enum = { Yes, No }\n` + S;
    const a = clean(prog(E + `\n    <g:G | not=(G.parse(@s))/>`, `        <p>x</p>`));
    const b = clean(prog(E + `\n    <g:G | not=(G.toEnum(@s))/>`, `        <p>x</p>`));
    expect(JSON.stringify(a.core)).toBe(JSON.stringify(b.core));
    expect(codes(prog(E + `\n    <n:int=1/>\n    <g:G | not=(G.parse(@n))/>`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(`    type P:struct = { x: int }\n` + S + `\n    <g:int | not=(P.parse(@s))/>`, `        <p>x</p>`))).toContain("E-SCOPE-001");
  });
  test("a parse is strict and whole-string (runtime, through the compiled program)", async () => {
    const cases = ["42", "-7", "007", "", " 42", "+5", "12px", "0x1F", "1_000", "1.5", "1e3", "NaN", "Infinity", "1e400", "true"];
    const ps = cases.map((c, i) => `        <p id="i${i}">\${showI(int.parse(${JSON.stringify(c)}))}</p>`).join("\n");
    await load(prog(show, ps));
    const got = cases.map((_, i) => $(`#i${i}`).textContent);
    expect(got).toEqual(["int", "int", "int", "not", "not", "not", "not", "not", "not", "not", "not", "not", "not", "not", "not"]);
  }, 60000);
});

describe("P — the runtime's parses, every edge (one grammar per type)", () => {
  test("int.parse", () => {
    const ok = { "0": 0, "-0": 0, "42": 42, "-42": -42, "007": 7, "9007199254740991": 9007199254740991, "-9007199254740991": -9007199254740991 };
    for (const [s, v] of Object.entries(ok)) expect([s, rt.parseIntText(s)]).toEqual([s, v]);
    expect(Object.is(rt.parseIntText("-0"), 0)).toBe(true);
    const bad = ["", "-", " 1", "1 ", "+1", "1.0", "1e3", "0x1F", "0b1", "0o7", "1_000", "١٢", "１２", "12px", "NaN", "Infinity", "-Infinity", "9007199254740992", "-9007199254740992", "99999999999999999999", "\n1", "1\n", "--1"];
    for (const s of bad) expect([s, rt.parseIntText(s)]).toEqual([s, null]);
  });
  test("number.parse — finite only (S469: NaN, ±∞ and overflow are `not`)", () => {
    const ok = { "0": 0, "42": 42, "-1.5": -1.5, "1.": 1, ".5": 0.5, "-.5": -0.5, "1e3": 1000, "1E-2": 0.01, "2.5e+2": 250, "007.50": 7.5, "1e-400": 0, "1.7976931348623157e308": 1.7976931348623157e308 };
    for (const [s, v] of Object.entries(ok)) expect([s, rt.parseNumText(s)]).toEqual([s, v]);
    const bad = ["", ".", "-", "e3", "1e", "1e+", "+1", " 1", "1 ", "0x1F", "1_0", "NaN", "Infinity", "-Infinity", "inf", "1e400", "-1e400", "1.8e308", "1..2", "1.2.3", "١"];
    for (const s of bad) expect([s, rt.parseNumText(s)]).toEqual([s, null]);
  });
  test("number.parse reads back every finite value `${n}` prints (the round-trip law)", () => {
    for (const n of [0, 1, -1, 0.1, 1 / 3, 1e21, 1e-7, 123456789.125, -2.5e-300, Number.MAX_VALUE, Number.MIN_VALUE, 9007199254740993]) {
      expect(rt.parseNumText(`${n}`)).toBe(n);
    }
  });
  test("bool.parse — exactly \"true\" / \"false\"", () => {
    expect(rt.parseBoolText("true")).toBe(true);
    expect(rt.parseBoolText("false")).toBe(false);
    for (const s of ["", "True", "FALSE", "1", "0", "yes", " true", "true ", "t"]) expect([s, rt.parseBoolText(s)]).toEqual([s, null]);
  });
  test("a parse of a non-string is a defect, loud (the typer guarantees a string)", () => {
    expect(() => rt.parseIntText(42)).toThrow("not a string");
    expect(() => rt.parseNumText(null)).toThrow("not a string");
    expect(() => rt.parseBoolText(true)).toThrow("not a string");
  });
});

// ---------------------------------------------------------------------------
describe("T — `integer` / `boolean` are `int` / `bool` (§14.13.6)", () => {
  test("accepted in every type position, meaning exactly `int` / `bool`, with no warning yet", () => {
    expect(codes(prog(`    let <n:integer=3/>\n    let <b:boolean=true/>`, `        <p>\${@n + 1}</p>`))).toEqual([]);
    expect(codes(prog(`    function f(x: integer) -> integer { return x * 2 }`, `        <p>\${f(2)}</p>`))).toEqual([]);
    expect(codes(prog(`    let <n:integer=1.5/>`, `        <p>\${@n}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(`    function f(x: int) -> int { return x }\n    let <n:integer=3/>`, `        <p>\${f(@n)}</p>`))).toEqual([]);
    expect(codes(prog(`    <xs:integer[]=([1, 2])/>`, `        <p>\${@xs.length}</p>`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("S — the admitted string methods (Appendix D.1)", () => {
  test("each is a typed Core op, never a host member call", () => {
    const body = [
      `showI(@s.indexOf("i"))`, `showI(@s.lastIndexOf("i"))`, `@s.replace("a", "b")`, `@s.replaceAll("a", "b")`,
      `@s.padStart(4)`, `@s.padEnd(4, "-")`, `@s.repeat(2)`, `@s.trimStart()`, `@s.trimEnd()`,
    ].map((x) => `        <p>\${${x}}</p>`).join("\n");
    const json = JSON.stringify(clean(prog(S + show, body)).core);
    for (const op of ["StrIndexOf", "StrLastIndexOf", "StrReplace", "StrReplaceAll", "StrPadStart", "StrPadEnd", "StrRepeat", "StrTrimStart", "StrTrimEnd"]) expect(json).toContain(`"${op}"`);
  });
  test("signatures: argument types (E-TYPE-031), counts (E-CALL-ARITY); indexOf takes no start position", () => {
    expect(codes(prog(S, `        <p>\${@s.replace("a", 1)}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.padStart("4")}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.padEnd(4, 0)}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S, `        <p>\${@s.repeat(1.5)}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S + `\n    <a:int | not=(@s.indexOf("i", 1))/>`, `        <p>x</p>`))).toEqual(["E-CALL-ARITY"]);
    expect(codes(prog(S, `        <p>\${@s.replace("a")}</p>`))).toEqual(["E-CALL-ARITY"]);
    expect(codes(prog(S, `        <p>\${@s.padStart()}</p>`))).toEqual(["E-CALL-ARITY"]);
    expect(codes(prog(S, `        <p>\${@s.trimStart(1)}</p>`))).toEqual(["E-CALL-ARITY"]);
  });
  test("indexOf / lastIndexOf are `int | not` — never -1, never a plain int", () => {
    expect(codes(prog(S + `\n    <a:int=(@s.indexOf("i"))/>`, `        <p>\${@a}</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(S + `\n    <a:int | not=(@s.lastIndexOf("i"))/>`, `        <p>x</p>`))).toEqual([]);
  });
  test("a regex argument is refused (no regex until it has a ruled type)", () => {
    expect(codes(prog(S, `        <p>\${@s.replace(/a/g, "b")}</p>`)).length).toBeGreaterThan(0);
  });
  test("any other method on a string is E-STRING-METHOD-UNKNOWN, naming the nearest admitted form; never passed to the host", () => {
    for (const [m, near] of [["substring(1)", "`.slice(from, to)`"], ["at(0)", "`.charAt(i)`"], ["codePointAt(0)", "`.charAt(i)`"], ["trimLeft()", "`.trimStart()`"], ["concat(\"x\")", "template"], ["localeCompare(\"x\")", ""], ["normalize()", ""], ["search(\"x\")", "`.indexOf(t)`"], ["sort()", ""], ["reverse()", ""], ["join(\",\")", ""], ["push(\"x\")", ""]]) {
      const src = prog(S, `        <p>\${@s.${m}}</p>`);
      const d = diag(src, "E-STRING-METHOD-UNKNOWN");
      expect([m, d?.code]).toEqual([m, "E-STRING-METHOD-UNKNOWN"]);
      if (near) expect(d.message).toContain(near);
      expect(codes(src).filter((c) => c === "E-BOOTSTRAP-UNSUPPORTED")).toEqual([]);
    }
    // on a literal and on a method result, too
    expect(codes(prog(S, `        <p>\${"abc".substring(1)}</p>`))).toEqual(["E-STRING-METHOD-UNKNOWN"]);
    expect(codes(prog(S, `        <p>\${@s.trim().substr(1)}</p>`))).toEqual(["E-STRING-METHOD-UNKNOWN"]);
  });
  test("a receiver that is not provably a string keeps the bootstrap's own refusal (no guess)", () => {
    expect(codes(prog(`    let <n:int=1/>`, `        <p>\${@n.substring(1)}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    let <m:string | not=not/>`, `        <p>\${@m.padStart(2)}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("runtime, through the compiled program: code points everywhere", async () => {
    await load(prog(`    let <e:string="a😀b😀"/>` + show, [
      `        <p id="io">\${showI(@e.indexOf("b"))} \${showI(@e.indexOf("x"))}</p>`,
      `        <p id="rp">\${@e.replace("😀", "-")}|\${@e.replaceAll("😀", "$&")}</p>`,
      `        <p id="pd">[\${"ab".padStart(5, "😀x")}][\${"ab".padEnd(4)}][\${@e.padStart(2)}]</p>`,
      `        <p id="rr">\${"😀".repeat(3)}[\${"x".repeat(0)}]</p>`,
      `        <p id="tr">[\${"  a  ".trimStart()}][\${"  a  ".trimEnd()}]</p>`,
    ].join("\n")));
    expect($("#io").textContent).toBe("int not");
    expect($("#rp").textContent).toBe("a-b😀|a$&b$&");
    expect($("#pd").textContent).toBe("[😀x😀ab][ab  ][a😀b😀]");
    expect($("#rr").textContent).toBe("😀😀😀[]");
    expect($("#tr").textContent).toBe("[a  ][  a]");
  });
});

describe("S — the runtime's string additions, every edge", () => {
  test("indexOf / lastIndexOf: code-point positions, `not` when absent, never half a pair", () => {
    expect(rt.strIndexOf("a😀b😀", "b")).toBe(2);
    expect(rt.strIndexOf("a😀b😀", "😀")).toBe(1);
    expect(rt.strLastIndexOf("a😀b😀", "😀")).toBe(3);
    expect(rt.strIndexOf("abc", "x")).toBe(null);
    expect(rt.strLastIndexOf("abc", "x")).toBe(null);
    expect(rt.strIndexOf("abc", "")).toBe(0);
    expect(rt.strLastIndexOf("a😀", "")).toBe(2);
    expect(rt.strLastIndexOf("aaa", "aa")).toBe(1);
    expect(rt.strIndexOf("😀", "\uDE00")).toBe(null);
    expect(rt.strIndexOf("😀", "\uD83D")).toBe(null);
    expect(rt.strLastIndexOf("😀😀", "\uDE00")).toBe(null);
    expect(rt.strIndexOf("x\uDE00y", "\uDE00")).toBe(1);
    expect(rt.strIndexOf("😀\uDE00", "\uDE00")).toBe(1);
    expect(rt.strIndexOf("", "")).toBe(0);
  });
  test("replace / replaceAll: plain strings, `with` literal (no `$&` / `$1`), on code-point boundaries", () => {
    expect(rt.strReplace("a.b.c", ".", "$&$&")).toBe("a$&$&b.c");
    expect(rt.strReplaceAll("a.b.c", ".", "$'")).toBe("a$'b$'c");
    expect(rt.strReplace("abc", "x", "y")).toBe("abc");
    expect(rt.strReplace("abc", "", "-")).toBe("-abc");
    expect(rt.strReplaceAll("a😀", "", "-")).toBe("-a-😀-");
    expect(rt.strReplaceAll("", "", "-")).toBe("-");
    expect(rt.strReplaceAll("aaaa", "aa", "b")).toBe("bb");
    expect(rt.strReplaceAll("😀😀", "\uDE00", "x")).toBe("😀😀");
    expect(rt.strReplace("😀", "\uD83D", "x")).toBe("😀");
    expect(rt.strReplaceAll("x\uDE00y\uDE00", "\uDE00", "-")).toBe("x-y-");
    expect(rt.strReplaceAll("a(b)*c", "(b)*", "[$1]")).toBe("a[$1]c");
  });
  test("padStart / padEnd: widths in code points, the last fill cut on a code-point boundary, default \" \"", () => {
    expect(rt.strPadStart("ab", 5, "😀x")).toBe("😀x😀ab");
    expect(rt.strPadEnd("ab", 5, "😀x")).toBe("ab😀x😀");
    expect(rt.strPadStart("😀", 3)).toBe("  😀");
    expect(rt.strPadEnd("😀😀", 2, "x")).toBe("😀😀");
    expect(rt.strPadStart("abc", 1, "x")).toBe("abc");
    expect(rt.strPadStart("ab", 4, "")).toBe("ab");
    expect(rt.strPadStart("ab", 0)).toBe("ab");
  });
  test("repeat", () => {
    expect(rt.strRepeat("ab", 3)).toBe("ababab");
    expect(rt.strRepeat("ab", 0)).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("N — no negative positions", () => {
  test("a negative LITERAL slice position / repeat count / pad width is E-POSITION-NEGATIVE", () => {
    for (const x of [`@s.slice(-1)`, `@s.slice(0, -2)`, `@s.slice(-1, -1)`, `@s.repeat(-1)`, `@s.padStart(-3)`, `@s.padEnd(-3, "x")`]) {
      const cs = codes(prog(S, `        <p>\${${x}}</p>`));
      expect([x, cs.filter((c) => c !== "E-POSITION-NEGATIVE")]).toEqual([x, []]);
      expect(cs.length).toBeGreaterThan(0);
    }
    expect(codes(prog(S, `        <p>\${@s.slice(-1, -1)}</p>`))).toEqual(["E-POSITION-NEGATIVE", "E-POSITION-NEGATIVE"]);
    expect(diag(prog(S, `        <p>\${@s.slice(-1)}</p>`), "E-POSITION-NEGATIVE")?.message).toContain("`s.slice(s.length - 1)`");
  });
  test("not a negative literal: zero, a computed position, `charAt(-1)` (is \"\"), an index read (traps)", () => {
    expect(codes(prog(S, `        <p>\${@s.slice(-0)}</p>`))).toEqual([]);
    expect(codes(prog(S, `        <p>\${@s.slice(@s.length - 1)}</p>`))).toEqual([]);
    expect(codes(prog(S, `        <p>\${@s.slice(0 - 1)}</p>`))).toEqual([]);
    expect(codes(prog(S, `        <p>\${@s.charAt(-1)}</p>`))).toEqual([]);
    expect(codes(prog(S, `        <p>\${@s[-1]}</p>`))).toEqual([]);
    expect(codes(prog(`    <xs:int[]=([1])/>`, `        <p>\${@xs[-1]}</p>`))).toEqual([]);
  });
  test("runtime: a computed negative traps (E-INDEX-OUT-OF-RANGE-RT) — slice no longer counts from the end", () => {
    const trap = (f) => { try { f(); } catch (e) { return [e.name, e.code]; } return "no trap"; };
    const T = ["ScrmlTrap", "E-INDEX-OUT-OF-RANGE-RT"];
    expect(trap(() => rt.strSlice("abc", -1))).toEqual(T);
    expect(trap(() => rt.strSlice("abc", 0, -1))).toEqual(T);
    expect(trap(() => rt.strRepeat("abc", -1))).toEqual(T);
    expect(trap(() => rt.strPadStart("abc", -1))).toEqual(T);
    expect(trap(() => rt.strPadEnd("abc", -1, "x"))).toEqual(T);
    expect(trap(() => rt.indexRead("abc", -1, "t:1"))).toEqual(T);
    expect(trap(() => rt.indexRead("a😀", 2, "t:1"))).toEqual(T);
    expect(trap(() => rt.indexRead([1, 2], -1, "t:1"))).toEqual(T);
    expect(rt.strCharAt("abc", -1)).toBe("");
    expect(rt.atRead([1, 2], -1)).toBe(null);
    expect(rt.strSlice("abc", 5)).toBe("");
    expect(rt.strSlice("abc", 2, 1)).toBe("");
    expect(rt.strSlice("a😀b", 1, 9)).toBe("😀b");
    expect(rt.indexRead("a😀b", 1, "t:1")).toBe("😀");
  });
  test("runtime, through the compiled program: a computed negative slice traps; the page shows nothing from it", async () => {
    await load(prog(`    let <s:string="abc"/>\n    let <n:int=1/>`, `        <p id="ok">\${@s.slice(@s.length - @n)}</p>`));
    expect($("#ok").textContent).toBe("c");
  });
});

// ---------------------------------------------------------------------------
describe("the client and server runtimes agree — the SAME function objects", () => {
  test("every S469 helper the server runtime exports is the client's", () => {
    for (const f of ["strIndexOf", "strLastIndexOf", "strReplace", "strReplaceAll", "strPadStart", "strPadEnd", "strRepeat", "parseIntText", "parseNumText", "parseBoolText", "strSlice", "strCharAt", "indexRead", "atRead"]) {
      expect([f, typeof srt[f]]).toEqual([f, "function"]);
      expect([f, srt[f] === rt[f]]).toEqual([f, true]);
    }
  });
});
