/**
 * g-impl1-match-miscompiles-hit-by-the-bootstrap — F12 / F13 / F14 (S438).
 *
 * Every case here is EXECUTED: the file is compiled, the emitted module is
 * imported, and the function is called. Each was a silent miscompile (or a
 * spurious compile failure) on main before the fix:
 *
 *   F12 — a `|` alternation arm lowered only as the FIRST arm of a match. Later
 *         it was glued onto the previous arm's result, or (`_ | .A :>`) dropped
 *         with no diagnostic, so `f(.A)` returned undefined and E-TYPE-020 was
 *         defeated. Siblings: `.A | _`, `::B | ::C`, a continuation line opening
 *         with `|`, number / boolean alternation, a string alternate holding
 *         `|`, a nested match as an alternation arm's body, and the
 *         `const r = match …` lowering, which compared only the first alternate.
 *   F13 — an arm binding five or more NAMED payload fields was not recognised
 *         as an arm (a 20-token cap in the arm-boundary walk). Sibling: a block
 *         arm's named binding read the FIRST field instead of its own.
 *   F14 — a string literal holding `{` / `}` next to another character broke
 *         `${}` block splitting (E-CTX-003 / E-CTX-001).
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { compileScrml } from "../../src/api.js";

let seq = 0;
async function compileAndLoad(source) {
  const dir = mkdtempSync(resolve(tmpdir(), "s438-f1214-"));
  const base = `m${++seq}`;
  const srcPath = resolve(dir, `${base}.scrml`);
  writeFileSync(srcPath, source, "utf8");
  const outDir = resolve(dir, "out");
  const result = compileScrml({ inputFiles: [srcPath], outputDir: outDir, write: true, log: () => {} });
  const errors = (result.errors || []).map((e) => e.code);
  let mod = null;
  let emitted = "";
  if (errors.length === 0) {
    const jsPath = resolve(outDir, `${base}.js`);
    emitted = readFileSync(jsPath, "utf8");
    mod = await import(pathToFileURL(jsPath).href);
  }
  return { errors, mod, emitted, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function compileProgram(source) {
  const dir = mkdtempSync(resolve(tmpdir(), "s438-f13p-"));
  try {
    const srcPath = resolve(dir, "app.scrml");
    writeFileSync(srcPath, source, "utf8");
    const outDir = resolve(dir, "out");
    const result = compileScrml({ inputFiles: [srcPath], outputDir: outDir, write: true, log: () => {} });
    const js = readdirSync(outDir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(resolve(outDir, f), "utf8")).join("\n");
    return { errors: (result.errors || []).map((e) => e.code), js };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("F12 — a `|` alternation arm lowers at EVERY arm position", () => {
  test("the review case: `.B` then `_ | .A` — the wildcard-bearing arm is not dropped", async () => {
    const r = await compileAndLoad(`\${
  type M:enum = { A, B, C, D }
  export function f(m: M) -> string {
    return match m {
      .B :> "b"
      _ | .A :> "a"
    }
  }
  export function f2(m: M) -> string {
    return match m {
      .D :> "d"
      .A | _ :> "a"
    }
  }
}
`);
    try {
      expect(r.errors).toEqual([]);
      expect(r.mod.f("A")).toBe("a");
      expect(r.mod.f("C")).toBe("a");
      expect(r.mod.f("B")).toBe("b");
      expect(r.mod.f2("C")).toBe("a");
      expect(r.mod.f2("D")).toBe("d");
    } finally { r.cleanup(); }
  });

  test("middle, last, 3-way, `::` alias, same-line, continuation-line, block-body, nested and `const r = match` alternation", async () => {
    const r = await compileAndLoad(`\${
  type M:enum = { A, B, C, D }
  export function mid(m: M) -> string {
    return match m {
      .A :> "a"
      .B | .C :> "x"
      .D :> "d"
    }
  }
  export function last3(m: M) -> string {
    return match m {
      .A :> "a"
      .B | .C | .D :> "y"
    }
  }
  export function alias(m: M) -> string {
    return match m {
      ::A :> "a"
      ::B | ::C :> "bc"
      ::D :> "d"
    }
  }
  export function sameLine(m: M) -> string {
    return match m { .A :> "a" .B | .C :> "o" .D :> "d" }
  }
  export function contLine(m: M) -> string {
    return match m {
      .A :> "a"
      .B :> "b"
      .C
      | .D :> "cd"
    }
  }
  export function blockBody(m: M) -> string {
    return match m {
      .A :> "a"
      .B :> "b"
      .C | .D :> {
        const s = "c"
        s + "d"
      }
    }
  }
  export function nested(m: M) -> number {
    return match m {
      .A :> 1
      .B | .C :> match m {
        .B :> 2
        .C | .A | .D :> 3
      }
      .D :> 4
    }
  }
  export function asDecl(m: M) -> string {
    const r = match m {
      .A :> "a"
      .B | .C | .D :> "x"
    }
    return r
  }
}
`);
    try {
      expect(r.errors).toEqual([]);
      const m = r.mod;
      expect([m.mid("A"), m.mid("B"), m.mid("C"), m.mid("D")]).toEqual(["a", "x", "x", "d"]);
      expect([m.last3("A"), m.last3("B"), m.last3("D")]).toEqual(["a", "y", "y"]);
      expect([m.alias("B"), m.alias("C"), m.alias("D")]).toEqual(["bc", "bc", "d"]);
      expect([m.sameLine("A"), m.sameLine("C"), m.sameLine("D")]).toEqual(["a", "o", "d"]);
      expect([m.contLine("B"), m.contLine("C"), m.contLine("D")]).toEqual(["b", "cd", "cd"]);
      expect([m.blockBody("A"), m.blockBody("C")]).toEqual(["a", "cd"]);
      expect([m.nested("A"), m.nested("B"), m.nested("C"), m.nested("D")]).toEqual([1, 2, 3, 4]);
      expect([m.asDecl("A"), m.asDecl("C")]).toEqual(["a", "x"]);
    } finally { r.cleanup(); }
  });

  test("literal alternation: numbers (incl. negative), strings holding `|` / `:>`", async () => {
    const r = await compileAndLoad(`\${
  export function num(n: number) -> string {
    return match n {
      0 :> "zero"
      -1 | -2 :> "neg"
      1 | 2 :> n == 2 ? "two" : "one"
      else :> "big"
    }
  }
  export function str(t: string) -> number {
    return match t {
      "a" :> 0
      "x|y" | "z :> w" :> 1
      else :> 2
    }
  }
}
`);
    try {
      expect(r.errors).toEqual([]);
      expect([r.mod.num(0), r.mod.num(-1), r.mod.num(-2), r.mod.num(1), r.mod.num(2), r.mod.num(5)])
        .toEqual(["zero", "neg", "neg", "one", "two", "big"]);
      expect([r.mod.str("a"), r.mod.str("x|y"), r.mod.str("z :> w"), r.mod.str("x")]).toEqual([0, 1, 1, 2]);
    } finally { r.cleanup(); }
  });

  test("E-TYPE-020 still fires when an alternation leaves a variant uncovered", async () => {
    const r = await compileAndLoad(`\${
  type M:enum = { A, B, C, D }
  export function f(m: M) -> string {
    return match m {
      .A :> "a"
      .B | .C :> "x"
    }
  }
}
`);
    try {
      expect(r.errors).toContain("E-TYPE-020");
    } finally { r.cleanup(); }
  });
});

describe("F13 — payload patterns binding five or more fields", () => {
  test("4/5/6/8 named fields as later arms, inline and one-line", async () => {
    const r = await compileAndLoad(`\${
  type S:enum = {
    Z
    W4(a: number, b: number, c: number, d: number)
    W5(a: number, b: number, c: number, d: number, e: number)
    W6(a: number, b: number, c: number, d: number, e: number, f: number)
    W8(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number)
  }
  export function mk4() -> S { return S.W4(1, 2, 3, 4) }
  export function mk5() -> S { return S.W5(1, 2, 3, 4, 5) }
  export function mk6() -> S { return S.W6(1, 2, 3, 4, 5, 6) }
  export function mk8() -> S { return S.W8(1, 2, 3, 4, 5, 6, 7, 8) }
  export function sum(s: S) -> number {
    return match s {
      .Z :> 0
      .W4(a: a, b: b, c: c, d: d) :> a + b + c + d
      .W5(a: a, b: b, c: c, d: d, e: e) :> a + b + c + d + e
      .W6(a: a, b: b, c: c, d: d, e: e, f: f) :> a + b + c + d + e + f
      .W8(a: a, b: b, c: c, d: d, e: e, f: f, g: g, h: h) :> a + b + c + d + e + f + g + h
    }
  }
  export function oneLine(s: S) -> number {
    return match s { .Z :> 0 .W4(d: d) :> d .W5(a: a, b: b, c: c, d: d, e: e) :> e .W6(f: f) :> f .W8(h: h) :> h }
  }
}
`);
    try {
      expect(r.errors).toEqual([]);
      const m = r.mod;
      expect([m.sum(m.mk4()), m.sum(m.mk5()), m.sum(m.mk6()), m.sum(m.mk8()), m.sum("Z")]).toEqual([10, 15, 21, 36, 0]);
      expect(m.oneLine(m.mk5())).toBe(5);
    } finally { r.cleanup(); }
  });

  test("a block arm's NAMED binding reads its own field (statement and `const r = match` forms)", () => {
    const { errors, js } = compileProgram(`<program>
\${
  type S:enum = { Z, W5(a: number, b: number, c: number, d: number, e: number) }
  function blk(s: S) -> number {
    return match s {
      .Z :> 0
      .W5(e: x) :> {
        const y = x
        y
      }
    }
  }
  function decl(s: S) -> number {
    const r = match s {
      .Z :> 0
      .W5(d: p, e: q) :> {
        const y = p * 10 + q
        y
      }
    }
    return r
  }
  @out = "" + blk(S.W5(1, 2, 3, 4, 5)) + decl(S.W5(1, 2, 3, 4, 5))
}
<p>\${@out}</p>
</program>
`);
    expect(errors).toEqual([]);
    expect(js).toMatch(/const x = _scrml_match_\d+\.data\.e;/);
    expect(js).not.toMatch(/const x = _scrml_match_\d+\.data\.a;/);
    expect(js).toMatch(/const p = _scrml_match_\d+\.data\.d;/);
    expect(js).toMatch(/const q = _scrml_match_\d+\.data\.e;/);
  });
});

describe("F14 — string literals holding braces inside `${}`", () => {
  test("braces adjacent to other characters, escapes, regex and comment neighbours", async () => {
    const r = await compileAndLoad(`\${
  export function a() -> string { return " => {\\n" }
  export function b() -> string { return "{ " }
  export function c() -> string { return " }" }
  export function d() -> string { return "}{" }
  export function e() -> string { return 'q}}' }
  export function f() -> string { return "he said \\"{\\"" }
  export function g(s: string) -> number { if (s.match(/"/)) { return 1 } return 0 }
  export function h(s: string) -> string { return s.replace(/'/g, "{") }
  export function k() -> string { /* it's a { comment */ const q = '}'; return q }
  export function m() -> number { const x = 6; const y = 2; const z = x / y; return z }
  export function n() -> string {
    // it's a comment with a { brace
    return "a { b } c"
  }
  export function o() -> number { let n = 0; for (const ch of "a{b}c") { if (ch == "{" || ch == "}") { n = n + 1 } } return n }
}
`);
    try {
      expect(r.errors).toEqual([]);
      const x = r.mod;
      expect([x.a(), x.b(), x.c(), x.d(), x.e(), x.f()]).toEqual([" => {\n", "{ ", " }", "}{", "q}}", 'he said "{"']);
      expect([x.g('a"b'), x.g("ab")]).toEqual([1, 0]);
      expect(x.h("x'y")).toBe("x{y");
      expect([x.k(), x.m(), x.n(), x.o()]).toEqual(["}", 3, "a { b } c", 2]);
    } finally { r.cleanup(); }
  });

  test("markup with prose apostrophes inside a logic block still splits correctly", () => {
    const { errors } = compileProgram(`<program>
\${
  @items = ["a", "b"]
  @name = "x"
}
<ul>\${ for (x of @items) { lift <li>it's Bob's \${x}</li> } }</ul>
<div>\${ if (@name == "x") { lift <span>it's</span> } }</div>
</program>
`);
    expect(errors).toEqual([]);
  });
});
