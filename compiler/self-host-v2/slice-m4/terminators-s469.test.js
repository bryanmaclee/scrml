// terminators-s469.test.js — s469: the bootstrap ENFORCES dpa-073 (user-voice
// S469 "⭐⭐⭐ RULED — dpa-073 F1 = (a)", "⭐ RULED — dpa-073 F2(i) / F3(i) / F4(ii)",
// "⭐ RULED — dpa-073 F5 Bootstrap enforces"):
//
//   F1 (a)  `;` terminates a statement; a newline ends nothing.
//   F3 (i)  `;` after every non-block-like statement, the last one before a `}`
//           included (`onclick={ @n = @n + 1; }`); block-like statements and
//           closer-delimited items take none.
//   F2      arms are a comma list — a `,` between every pair of arms, block arms
//           included, the trailing one optional.
//   F5 (4)  the BOOTSTRAP enforces both by construction (impl#1 keeps reading
//           newline-terminated code — a carried divergence).
//
// A missing `;` is E-STMT-MISSING-SEMICOLON and a missing `,` is
// E-MATCH-ARM-SEPARATOR; each report's span is the EMPTY span where the
// terminator goes (the fix-it). Graded on codes, spans and the runtime effect.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const semis = (src) => run(src).diags.filter((d) => d.code === "E-STMT-MISSING-SEMICOLON");
// the line up to each missing-`;` report (where the `;` goes), trimmed; every span is empty
const at = (src) => semis(src).map((d) => {
  expect(d.span.end).toBe(d.span.start);
  return src.slice(src.lastIndexOf("\n", d.span.start - 1) + 1, d.span.start).trim();
});

const TYPES = `    type E:enum = { A, B }\n    type L:enum = { NotFound(id: string), Timeout }`;
const LOAD = `    function load(id: string)! L {\n        if (id == "x") fail L.NotFound(id);\n        return id;\n    }`;
const P = (decls, main = "        <p>x</p>") => `<program>\n    let <n:int=0/>\n    let <s:string=""/>\n${TYPES}\n${LOAD}\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const fn = (body) => `    function f(k: E) -> int {\n${body}\n    }`;

let k = 0;
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

// ---------------------------------------------------------------------------
describe("F1 / F3 — every non-block-like statement ends with `;`", () => {
  test("each statement kind that takes a `;` is refused without one — at the end of the statement", () => {
    const cases = [
      ["const", `        const a = 1\n        return a;`, ["const a = 1"]],
      ["let", `        let a = 1\n        return a;`, ["let a = 1"]],
      ["an assignment", `        let a = 1;\n        a = 2\n        return a;`, ["a = 2"]],
      ["a cell write", `        @n = 2\n        return 1;`, ["@n = 2"]],
      ["a call", `        load("y") !{ _ :> 0 };\n        @s = "a"\n        return 1;`, ["@s = \"a\""]],
      ["return (the last statement before `}`)", `        return 1`, ["return 1"]],
    ];
    for (const [what, body, want] of cases) {
      expect([what, at(P(fn(body)))]).toEqual([what, want]);
    }
  });

  test("a `fail` and a `break` / `continue` take a `;` too", () => {
    const src = P(`    function g(id: string)! L {\n        fail L.Timeout\n    }\n    function h() -> int {\n        for (const x of [1, 2]) {\n            if (x == 1) { continue }\n            break\n        }\n        return 0;\n    }`);
    expect(at(src)).toEqual(["fail L.Timeout", "if (x == 1) { continue", "break"]);
  });

  test("the last statement before a `}` included — a handler body (`onclick={ @n = @n + 1; }`)", () => {
    expect(at(P("", `        <button onclick={ @n = @n + 1 }>b</button>`))).toEqual(["<button onclick={ @n = @n + 1"]);
    expect(codes(P("", `        <button onclick={ @n = @n + 1; }>b</button>`))).toEqual([]);
  });

  test("block-like statements take none: `if` / `else`, `for`, a statement `match`, `given`, `<effect>` / `when`, `defer { }`", () => {
    const body = [
      `        if (k == .A) { @n = 1; } else { @n = 2; }`,
      `        for (const x of [1, 2]) { @n = x; }`,
      `        match k { .A :> @n = 3, .B :> @n = 4 }`,
      `        defer { @n = 5; }`,
      `        return 0;`,
    ].join("\n");
    expect(codes(P(fn(body)))).toEqual([]);
  });

  test("a braceless body takes its own `;` (`if (c) x = 1;`), and a stray `;` after a block is an empty statement", () => {
    expect(codes(P(fn(`        if (k == .A) @n = 1;\n        if (k == .B) { @n = 2; };\n        return 0;`)))).toEqual([]);
    expect(at(P(fn(`        if (k == .A) @n = 1\n        return 0;`)))).toEqual(["if (k == .A) @n = 1"]);
  });

  test("a `match` as a VALUE is not block-like: `const v = match … { … };` takes the `;`", () => {
    expect(at(P(fn(`        const v = match k { .A :> 1, .B :> 2 }\n        return v;`)))).toEqual(["const v = match k { .A :> 1, .B :> 2 }"]);
  });

  test("PA reading (S469, fail closed): a `!{}` handler statement is not in F3's block-like list — it takes a `;`", () => {
    expect(at(P(fn(`        load("y") !{ _ :> 0 }\n        return 0;`)))).toEqual(["load(\"y\") !{ _ :> 0 }"]);
    expect(codes(P(fn(`        load("y") !{ _ :> 0 };\n        return 0;`)))).toEqual([]);
  });

  test("an `import` is a statement (`;`); `type` and `function` declarations are closer-delimited items (none)", () => {
    const lib = { path: "lib.scrml", src: `\${\n    export type C:enum = { R, G }\n    export fn one() -> int { return 1; }\n}\n` };
    const ok = frontEnd(mods, [lib, { path: "app.scrml", src: `\${ import { C, one } from "./lib.scrml"; }\n<program>\n    let <c:C=.R/>\n    <main><p>\${one()}</p></main>\n</program>\n` }]);
    expect(ok.diags.map((d) => d.code)).toEqual([]);
    const src = `\${ import { C, one } from "./lib.scrml" }\n<program>\n    let <c:C=.R/>\n    <main><p>\${one()}</p></main>\n</program>\n`;
    const bad = frontEnd(mods, [lib, { path: "app.scrml", src }]);
    expect(bad.diags.map((d) => d.code)).toEqual(["E-STMT-MISSING-SEMICOLON"]);
    expect(src.slice(0, bad.diags[0].span.start).endsWith(`"./lib.scrml"`)).toBe(true);
  });

  test("`lift <expr>` (the last statement of an arm block) takes its `;`", () => {
    const src = (lift) => P(`    function g(id: string) -> string {\n        const v = load(id) !{ .NotFound(m) :> { @n = 1; ${lift} }, .Timeout :> "t" };\n        return v;\n    }`);
    expect(codes(src("lift m;"))).toEqual([]);
    expect(at(src("lift m"))).toEqual(["const v = load(id) !{ .NotFound(m) :> { @n = 1; lift m"]);
  });

  test("a newline ends nothing: an expression continues across lines in both directions", () => {
    const body = `        const a = 1\n            + 2;\n        const b = a +\n            3;\n        return b;`;
    expect(codes(P(fn(body)))).toEqual([]);
  });

  test("two statements on one line need the `;` between them (`let a = 1 let b = 2`)", () => {
    expect(at(P(fn(`        let a = 1 let b = 2;\n        return a + b;`)))).toEqual(["let a = 1"]);
  });

  test("the fix-it: writing a `;` at every report's span makes the program clean, and it RUNS", async () => {
    const src = P(`    function bump() {\n        @n = @n + 1\n        @s = "b"\n    }`, `        <button onclick=bump()>go</button>\n        <p id="n">\${@n}</p>`);
    const ds = semis(src);
    expect(ds.length).toBe(2);
    let fixed = src;
    for (const d of [...ds].sort((a, b) => b.span.start - a.span.start)) fixed = fixed.slice(0, d.span.start) + ";" + fixed.slice(d.span.start);
    const r = run(fixed);
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "term-" + k++);
    click(btn("go"));
    expect($("#n").textContent).toBe("1");
  });

  test("cascade guard: once a block has a (non-terminator) error, its later statements are not also reported for their `;`", () => {
    const c = codes(P(fn(`        @n = (1 + \n        @s = "a"\n        return 0`)));
    expect(c).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(c.length).toBeGreaterThan(0);
  });

  test("one missing `;` does not hide the next (each is reported)", () => {
    expect(at(P(fn(`        @n = 1\n        @n = 2\n        return 0`)))).toEqual(["@n = 1", "@n = 2", "return 0"]);
  });

  test("PA reading (S469, fail closed): `return` followed by a line break is refused — the fix-it is the legacy `return;`, the message names the other repair", () => {
    const src = P(`    function g() {\n        return\n        @n = 1;\n    }`);
    const ds = semis(src);
    expect(ds.length).toBe(1);
    expect(src.slice(0, ds[0].span.start).endsWith("return")).toBe(true);
    expect(ds[0].message).toContain("put the returned value on the `return` line");
    expect(codes(P(`    function g() {\n        return;\n    }`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("F2 — arms are a comma list (E-MATCH-ARM-SEPARATOR at every missing `,`)", () => {
  const seps = (src) => run(src).diags.filter((d) => d.code === "E-MATCH-ARM-SEPARATOR");
  test("a `match`, a `!{}` handler: every missing `,` is reported, at the end of the arm before; the trailing `,` is optional", () => {
    const m = P(fn(`        return match k {\n            .A :> 1\n            .B :> 2\n        };`));
    const ds = seps(m);
    expect(ds.length).toBe(1);
    expect(ds[0].span.end).toBe(ds[0].span.start);
    expect(m.slice(0, ds[0].span.start).endsWith(".A :> 1")).toBe(true);
    expect(codes(P(fn(`        return match k {\n            .A :> 1,\n            .B :> 2,\n        };`)))).toEqual([]);
    expect(codes(P(fn(`        return match k { .A :> 1, .B :> 2 };`)))).toEqual([]);
    const g = P(`    function g(id: string) -> string {\n        const v = load(id) !{ .NotFound(m) :> m .Timeout :> "t" };\n        return v;\n    }`);
    expect(seps(g).length).toBe(1);
  });

  test("block arms included — no Rust block-arm exemption (F2 (i))", () => {
    const src = P(fn(`        match k {\n            .A :> { @n = 1; }\n            .B :> { @n = 2; }\n        }\n        return 0;`));
    expect(seps(src).length).toBe(1);
    expect(codes(P(fn(`        match k {\n            .A :> { @n = 1; },\n            .B :> { @n = 2; },\n        }\n        return 0;`)))).toEqual([]);
  });

  test("a newline does not end an arm (F1): a body continues onto the next line, in both directions", async () => {
    const src = P(`    function g(id: string) -> string {\n        const v = load(id) !{\n            .NotFound(m) :> "nf:"\n                + m,\n            .Timeout :> "t",\n        };\n        return v;\n    }\n    function go() {\n        @s = g("x");\n    }`,
      `        <button onclick=go()>go</button>\n        <p id="s">\${@s}</p>`);
    const r = run(src);
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "term-" + k++);
    click(btn("go"));
    expect($("#s").textContent).toBe("nf:x");
  });

  test("r2: a qualified head (`E.A`, `E::A`) starts the next arm — one missing `,`, reported right after the arm before", () => {
    for (const q of ["E.", "E::"]) {
      const src = P(fn(`        return match k {\n            ${q}A :> 1\n            ${q}B :> 2\n        };`));
      const ds = seps(src);
      expect([q, ds.length]).toEqual([q, 1]);
      expect(src.slice(0, ds[0].span.start).endsWith(`${q}A :> 1`)).toBe(true);
      expect(codes(src)).toEqual(["E-MATCH-ARM-SEPARATOR"]);
      expect(codes(P(fn(`        return match k {\n            ${q}A :> 1,\n            ${q}B :> 2\n        };`)))).toEqual([]);
    }
  });

  test("r2: the same inside a `!{}` handler", () => {
    const src = P(`    function g(id: string) -> string {\n        const v = load(id) !{\n            L.NotFound(m) :> m\n            L::Timeout :> "t"\n        };\n        return v;\n    }`);
    const ds = seps(src);
    expect(ds.length).toBe(1);
    expect(src.slice(0, ds[0].span.start).endsWith("L.NotFound(m) :> m")).toBe(true);
  });
});

describe("r2 — `lift` followed by a line break is refused, like `return` (fail closed)", () => {
  test("`lift⏎expr;` is E-STMT-MISSING-SEMICOLON right after `lift`; `lift expr;` is clean", () => {
    const src = (body) => P(`    function g(id: string) -> string {\n        const v = load(id) !{ .NotFound(m) :> { @n = 1; ${body} }, .Timeout :> "t" };\n        return v;\n    }`);
    const s1 = src("lift\n            m;");
    const ds = semis(s1);
    expect(ds.length).toBe(1);
    expect(s1.slice(0, ds[0].span.start).endsWith("lift")).toBe(true);
    expect(ds[0].message).toContain("put the lifted value on the `lift` line");
    expect(codes(src("lift m;"))).toEqual([]);
  });
});

describe("r3 — a `match` that starts a statement ends at its `}` (F3 (i): block-like)", () => {
  // the statements of f's body, as kinds (Eval:<expr kind>)
  const kinds = (body) => {
    const r = run(P(fn(body)));
    const f = r.asts[0].items.flatMap((i) => i.k?.data?.p?.items ?? [i]).find((i) => i.k?.variant === "FnItem" && i.k.data.f.name === "f");
    return { codes: r.diags.map((d) => d.code), kinds: f.k.data.f.body.stmts.map((s) => s.k.variant + (s.k.variant === "Eval" ? ":" + s.k.data.e.k.variant : "")) };
  };
  const M = `        match k { .A :> @n = 1, .B :> @n = 2 }`;
  for (const [what, next] of [["-1", "-1;"], [".A", ".A;"], ["(x)", "(@n);"], ["[1]", "[1];"], ["a template", "`t`;"]]) {
    test(`\`match k { … }⏎${what}\` is two statements — the match, then \`${next}\` — never one glued expression`, () => {
      const r = kinds(`${M}\n        ${next}\n        return 0;`);
      expect(r.kinds[0]).toBe("Eval:Handled");
      // (the match is its own statement; what follows is read on its own — `.A` may itself split further)
      expect(r.kinds.length).toBeGreaterThanOrEqual(3);
      expect(r.kinds[r.kinds.length - 1]).toBe("Return");
      // s469 (§7.2.2 rule 9, RULED "Build both"): the second statement does nothing — E-STMT-NO-EFFECT, no
      // longer silent (the table row "A pure expression after a block-like `}`")
      if (what !== ".A") expect(r.codes).toEqual(["E-STMT-NO-EFFECT"]);   // (`.A` there is a parse error, unchanged)
    });
  }
  test("on the SAME line, a continuing token after the `}` is refused (E-PARSE-TRAILING), not glued and not split", () => {
    const r = kinds(`${M} + 2;\n        return 0;`);
    expect(r.codes).toContain("E-PARSE-TRAILING");
    expect(r.kinds[0]).toBe("Eval:Handled");
    const d = run(P(fn(`${M} + 2;\n        return 0;`))).diags.find((x) => x.code === "E-PARSE-TRAILING");
    expect(d.message).toContain("(match … { … }) +");
  });
  test("a statement match needs no `;`, and a following statement on the same line needs none either (the `}` ends it)", () => {
    expect(kinds(`${M}\n        return 0;`).codes).toEqual([]);
    expect(kinds(`${M} @n = 3;\n        return 0;`).codes).toEqual([]);
  });
  test("a VALUE match keeps needing its `;` — and keeps reading the next line as its continuation (`const v = match …`)", () => {
    expect(kinds(`        const v = match k { .A :> 1, .B :> 2 }\n        return v;`).codes).toEqual(["E-STMT-MISSING-SEMICOLON"]);
    expect(kinds(`        const v = match k { .A :> 1, .B :> 2 }\n            + 1;\n        return v;`).codes).toEqual([]);
    expect(kinds(`        @n = match k { .A :> 1, .B :> 2 } + 1;\n        return 0;`).codes).toEqual([]);
  });
});
