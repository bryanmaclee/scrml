// termination-rulings-s469.test.js — s469-boot-termination-rulings: the BOOTSTRAP builds bryan's S469
// statement-termination follow-up rulings (user-voice S469 "⭐ RULED — statement termination follow-ups,
// §7.2.2": "Attach to the line above" · "Keyword at statement start" · "Build both"), SPEC §7.2.2:
//
//   rule 4   a line break is whitespace: `x⏎!{ … }` handles `x`, `x⏎is given` / `is not` tests `x`, and a
//            `?` is decided by ADJACENCY only (glued `x?` = §19.5 propagation, spaced = the conditional) —
//            the end-of-line test is dropped;
//   rule 10  `fail` / `defer` / `transaction` are keywords at statement start whenever the next token can
//            begin their operand, regardless of line; the bare name `fail` is reserved in statement position;
//   rule 9   E-STMT-NO-EFFECT: an expression statement with no effect is an error, on either line,
//            including right after a block-like `}`;
//   rule 5   E-STMT-SPLIT-CONTINUATION: an expression continuing into a line that starts with `(`, `[` or a
//            template — "add `;` to the line above, or join the lines", at the empty span ending the line above.
//
// Still INTERIM (unruled — pinned UNCHANGED here): the `return⏎expr` / `lift⏎expr` refusal, a spaced same-line
// `x [y]`, `break⏎label` / `continue⏎label`, and the §40.8 display-text reading (R7).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const only = (src, code) => run(src).diags.filter((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
// the parse tree without positions — two spellings that mean the same read the same
const tree = (src) => JSON.stringify(mods.parse.parseFile("t.scrml", src, 0).ast ?? mods.parse.parseFile("t.scrml", src, 0),
  (k, v) => (k === "span" || k === "nid" || k === "lines" || k === "start" || k === "end" || k === "split" ? undefined : v));

const TYPES = `    type E:enum = { A, B }\n    type L:enum = { NotFound(id: string), Timeout }`;
const LOAD = `    function load(id: string)! L {\n        if (id == "x") fail L.NotFound(id);\n        return id;\n    }`;
const P = (decls, main = "        <p>x</p>") => `<program>\n    let <n:int=0/>\n    let <s:string=""/>\n${TYPES}\n${LOAD}\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const fn = (body) => `    function f(k: E) -> int {\n${body}\n        return 0;\n    }`;
// the text a diagnostic's span covers
const spanText = (src, d) => src.slice(d.span.start, d.span.end);

let k = 0;
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

// ---------------------------------------------------------------------------
describe("rule 4 — line starts attach to the line above (a newline is whitespace)", () => {
  test("`x⏎!{ … }` handles `x` — the same tree, and the same run, as the one-line form", async () => {
    const one = P(`    function go() {\n        @s = load("x") !{ .NotFound(m) :> "nf:" + m, .Timeout :> "t" };\n    }`, `        <button onclick=go()>go</button>\n        <p id="s">\${@s}</p>`);
    const two = one.replace(`load("x") !{`, `load("x")\n            !{`);
    expect(two).not.toBe(one);
    expect(tree(two)).toBe(tree(one));
    const r = clean(two);
    await loadProgram(r.core, "tr-guard" + k++);
    click(btn("go"));
    expect($("#s").textContent).toBe("nf:x");
  });

  test("`x⏎is given` / `x⏎is not` test `x`", () => {
    const O = `    type O:struct = { let n: int | not }\n    let <o:O=({ n: 0 })/>`;
    expect(codes(P(`${O}\n    function g() -> bool {\n        const q: bool = @o.n\n            is given;\n        return q;\n    }`))).toEqual([]);
    expect(codes(P(`${O}\n    function g() {\n        if (@o.n\n            is not) { @n = 1; }\n    }`))).toEqual([]);
    const one = P(`${O}\n    function g() -> bool {\n        return @o.n is given;\n    }`);
    expect(tree(one.replace("@o.n is given", "@o.n\n            is given"))).toBe(tree(one));
  });

  test("a GLUED `?` is propagation — at a line end or not, whatever follows it", () => {
    const one = P(`    function g(id: string)! L {\n        const v = load(id)?;\n        @s = v;\n    }`);
    expect(codes(one)).toEqual([]);
    // the line break after a glued `?` changes nothing
    expect(tree(one.replace("load(id)?;", "load(id)?\n            ;"))).toBe(tree(one));
    // `a == 1? 2 : 3` is NOT the conditional (adjacency decides): the `?` propagates and the expression ends
    // there — E-STMT-MISSING-SEMICOLON after the `?`, its message naming the conditional's spelling
    const glued = P(`    function g(a: int) -> int {\n        const c = a == 1? 2 : 3;\n        return c;\n    }`);
    const ds = run(glued).diags;
    expect(ds[0].code).toBe("E-STMT-MISSING-SEMICOLON");
    expect(spanText(glued, ds[0])).toBe("");
    expect(glued.slice(ds[0].span.start - 1, ds[0].span.start)).toBe("?");
    expect(ds[0].message).toContain("put a space before it: `c ? a : b`");
  });

  test("a SPACED `?` is the conditional — even with nothing after it; a leading `?` line continues", () => {
    const sp = P(`    function g(id: string)! L {\n        const v = load(id) ?;\n        @s = v;\n    }`);
    const d = run(sp).diags[0];
    expect(d.code).toBe("E-PARSE-EXPR");
    expect(spanText(sp, d)).toBe("?");
    expect(d.message).toContain("for propagation (§19.5) write the `?` directly against what it follows");
    // the conditional across lines (rule 4: a leading `?` / `:` continues the expression)
    expect(codes(P(`    function g(a: int) -> int {\n        const c = a == 1\n            ? 2\n            : 3;\n        return c;\n    }`))).toEqual([]);
    expect(codes(P(`    function g(a: int) -> int {\n        const c = a == 1 ? 2 : 3;\n        return c;\n    }`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("rule 10 — `fail` / `defer` / `transaction` are keywords at statement start, regardless of line", () => {
  const G = (body) => P(`    function g(id: string)! L {\n${body}\n        return id;\n    }`);
  test("`fail⏎.V;` is `fail .V;` (bare, qualified, `::`, glued) — the same tree, clean", () => {
    const one = G(`        if (id == "y") fail .Timeout;`);
    expect(codes(one)).toEqual([]);
    expect(tree(one.replace("fail .Timeout", "fail\n            .Timeout"))).toBe(tree(one));
    const q = G(`        if (id == "y") fail L.NotFound(id);`);
    expect(tree(q.replace("fail L.", "fail\n            L."))).toBe(tree(q));
    expect(codes(G(`        if (id == "y") fail\n            ::Timeout;`))).toEqual([]);
    expect(codes(G(`        if (id == "y") fail.Timeout;`))).toEqual([]);
  });

  test("the bare name `fail` is reserved in statement position — E-PARSE-EXPECTED on `fail`, never E-SCOPE-001", () => {
    for (const body of [`        fail;`, `        fail = 1;`, `        fail(id);`, `        if (id == "y") { fail }`, `        if (id == "y") {\n            fail\n            return id;\n        }`]) {
      const src = G(body);
      const ds = run(src).diags;
      expect([body, ds.map((d) => d.code)]).toEqual([body, ["E-PARSE-EXPECTED"]]);
      expect(spanText(src, ds[0])).toBe("fail");
      expect(ds[0].message).toContain("the name `fail` is reserved there");
    }
    // where `fail` is not at statement start it is still a name (here: undeclared)
    expect(codes(G(`        @s = fail;`))).toEqual(["E-SCOPE-001"]);
  });

  test("`defer⏎stmt` defers it (runtime); `transaction⏎{ … }` is the (refused) `transaction` block", async () => {
    const r = clean(P(`    function go() {\n        @s = @s + "a";\n        defer\n            @s = @s + "1";\n        @s = @s + "b";\n    }`, `        <button onclick=go()>go</button>\n        <p id="s">\${@s}</p>`));
    await loadProgram(r.core, "tr-defer" + k++);
    click(btn("go"));
    expect($("#s").textContent).toBe("ab1");
    const t = P(fn(`        transaction\n        {\n            @n = 1;\n        }`));
    const ds = run(t).diags;
    expect(ds.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(ds[0].message).toContain("`transaction { … }` (§19.10) is not in the bootstrap");
  });
});

// ---------------------------------------------------------------------------
describe("rule 9 — E-STMT-NO-EFFECT: a pure expression statement is an error, on either line", () => {
  const NE = "E-STMT-NO-EFFECT";
  test("each pure shape is reported, its span the statement (no `;`)", () => {
    for (const [stmt, text] of [["-1;", "-1"], ["(@n);", "(@n)"], ["[1];", "[1]"], ["`t`;", "`t`"], ["\"a\";", "\"a\""], ["404;", "404"],
      ["k;", "k"], ["@n;", "@n"], ["@n == 1;", "@n == 1"], ["!(@n == 1);", "!(@n == 1)"], ["k == .A ? 1 : 2;", "k == .A ? 1 : 2"], ["`n=${@n}`;", "`n=${@n}`"]]) {
      const src = P(fn(`        ${stmt}`));
      const ds = run(src).diags;
      expect([stmt, ds.map((d) => d.code)]).toEqual([stmt, [NE]]);
      expect([stmt, spanText(src, ds[0])]).toEqual([stmt, text]);
    }
    expect(only(P(fn(`        @n;`)), NE)[0].message).toContain("has no effect — `@n` computes a value and discards it");
  });

  test("right after a block-like `}` — the next line or the same line", () => {
    for (const lead of [`        if (k == .A) { @n = 1; }`, `        for (const x of [1, 2]) { @n = x; }`, `        defer { @n = 2; }`, `        match k { .A :> @n = 3, .B :> @n = 4 }`]) {
      expect([lead, codes(P(fn(`${lead}\n        -1;`)))]).toEqual([lead, [NE]]);
      if (!lead.includes("match")) expect([lead, codes(P(fn(`${lead} (@n);`)))]).toEqual([lead, [NE]]);
    }
  });

  test("in every statement list: a braceless `if` body, a deferred statement, a handler block, an arm block", () => {
    expect(codes(P(fn(`        if (k == .A) @n;`)))).toEqual([NE]);
    expect(codes(P(fn(`        defer @n;`)))).toEqual([NE]);
    expect(codes(P("", `        <button onclick={ @n; }>b</button>`))).toEqual([NE]);
    // an arm block's statements before its last, in either position
    expect(codes(P(fn(`        match k { .A :> { 9; @n = 1; }, .B :> @n = 2 }`)))).toEqual([NE]);
    expect(codes(P(fn(`        const v = match k { .A :> { 9; lift 1; }, .B :> 2 };\n        @n = v;`)))).toContain(NE);
    // a STATEMENT match's block yields nothing (§18.5): its last statement is a statement too
    expect(codes(P(fn(`        match k { .A :> { @n = 1; 9; }, .B :> @n = 2 }`)))).toEqual([NE]);
  });

  test("two on one line, one after the other, are one report (§40.8)", () => {
    expect(codes(P(fn(`        @n; k;`)))).toEqual([NE]);
    expect(codes(P(fn(`        @n;\n        k;`)))).toEqual([NE, NE]);
  });

  test("NOT reported: an effect anywhere, a handling form, a value position, a handler reference", () => {
    for (const stmt of [`@n = 1;`, `load("y") !{ _ :> 0 };`, `@s = load("y") !{ _ :> "e" };`, `f(k);`, `@n = @n + 1;`,
      `match k { .A :> 1, .B :> 2 }`]) {
      expect([stmt, codes(P(fn(`        ${stmt}`)))]).toEqual([stmt, []]);
    }
    // a value-position block arm's last statement IS its value (no report)
    expect(codes(P(fn(`        const v = match k { .A :> { 1; }, .B :> 2 };\n        @n = v;`)))).toEqual([]);
    // a one-name handler block is a REFERENCE — the event calls it (§19.4.3)
    clean(P(`    function bump() {\n        @n = @n + 1;\n    }`, `        <button onclick={ bump; }>b</button>`));
    // a `?` statement propagates (it can leave the function)
    expect(codes(P(`    function g(id: string)! L {\n        load(id)?;\n        return id;\n    }`))).toEqual([]);
  });

  test("one root cause, one report: beside a missing `;` or a split continuation it is not reported", () => {
    expect(codes(P(fn(`        k\n        @n;`)))).toEqual(["E-STMT-MISSING-SEMICOLON"]);
    expect(codes(P(fn(`        k\n        [1];`)))).toEqual(["E-STMT-SPLIT-CONTINUATION"]);
  });

  test("§40.8 display text (R7, INTERIM — unchanged): a state-child display literal / value is not a statement", () => {
    const S = (body) => `<program>\n    type Ph:enum = { A, B }\n    let <n:int=5/>\n    <ph:Ph=.A single>\n        <A rule=.B>${body}</>\n        <B rule=.A : "B">\n    </>\n    <main>\n        <p><*ph/></p>\n    </main>\n</program>\n`;
    expect(codes(S(`"Ready"`))).toEqual([]);
    expect(codes(S(`\${@n}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("rule 5 — E-STMT-SPLIT-CONTINUATION: a continuation into a `(` / `[` / template line", () => {
  const SC = "E-STMT-SPLIT-CONTINUATION";
  test("each opener, with the ruled message, at the EMPTY span ending the line above (the fix-it)", () => {
    for (const [what, next] of [["(", "(@n + 1);"], ["[", "[1];"], ["a template", "`t`;"]]) {
      const src = P(fn(`        const b = @n\n        ${next}`));
      const ds = only(src, SC);
      expect([what, ds.length]).toEqual([what, 1]);
      expect(ds[0].span.end).toBe(ds[0].span.start);
      expect(ds[0].span.start).toBe(src.indexOf("= @n\n") + 4);
      expect(ds[0].message.startsWith("add `;` to the line above, or join the lines")).toBe(true);
    }
    // the generic codes are gone for this shape
    const t = codes(P(fn(`        const b = @n\n        (@n + 1).toString();`)));
    expect(t).toContain(SC);
    expect(t).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(codes(P(fn(`        const b = @n\n        \`t\`;`)))).not.toContain("E-PARSE-TEMPLATE");
  });

  test("inside brackets too (`f(a⏎(b))`), and after a value `match`", () => {
    expect(codes(P(`    fn id(x: int) -> int { return x; }\n${fn(`        @n = id(@n\n            (1));`)}`))).toContain(SC);
    expect(codes(P(fn(`        const v = match k { .A :> 1, .B :> 2 }\n        (@n);`)))).toEqual([SC]);
  });

  test("NOT a continuation: the same line (call / index), a `( … ) :>` arm head, a multi-line template's own line", () => {
    expect(codes(P(`    fn id(x: int) -> int { return x; }\n${fn(`        @n = id(1);`)}`))).toEqual([]);
    // a call on the line where a multi-line template ENDS is on that line — no split
    expect(codes(P(fn(`        const t = \`a\nb\`(1);`)))).not.toContain(SC);
  });
});

// ---------------------------------------------------------------------------
describe("INTERIM (unruled) — unchanged", () => {
  test("`return⏎expr` and `lift⏎expr` stay refused (E-STMT-MISSING-SEMICOLON after the keyword), and nothing else", () => {
    const r = P(`    function g(a: int) -> int {\n        return\n            a;\n    }`);
    const ds = run(r).diags;
    expect(ds.map((d) => d.code)).toEqual(["E-STMT-MISSING-SEMICOLON"]);
    expect(r.slice(ds[0].span.start - 6, ds[0].span.start)).toBe("return");
    const l = run(P(fn(`        const v = match k { .A :> { @n = 1; lift\n            2; }, .B :> 3 };\n        @n = v;`))).diags.map((d) => d.code);
    expect(l[0]).toBe("E-STMT-MISSING-SEMICOLON");
    expect(l).not.toContain("E-STMT-NO-EFFECT");
  });

  test("a spaced same-line `x [y]` still splits (E-STMT-MISSING-SEMICOLON only); `break⏎label` too", () => {
    expect(codes(P(fn(`        const b = @n [1];`)))).toEqual(["E-STMT-MISSING-SEMICOLON"]);
    expect(codes(P(fn(`        outer: for (const x of [1, 2]) {\n            for (const y of [1, 2]) {\n                break\n                outer;\n            }\n        }`)))).toEqual(["E-STMT-MISSING-SEMICOLON", "E-SCOPE-001"]);   // (as before s469)
  });
});

// ---------------------------------------------------------------------------
// review round (LAND-W-F/U of 147323d51): one report per root cause; messages
describe("review — E-TYPE-043 stays primary; refusals are not doubled; messages", () => {
  test("a declared-return body ending in a pure expression: E-TYPE-043 (no implicit tail return), not E-STMT-NO-EFFECT", () => {
    for (const f of [`    fn hd(p: string) -> string { p; }`, `    function hd(p: string) -> string { p; }`, `    function hd(p: int) -> int { const q = p + 1; q; }`]) {
      const ds = run(P(f)).diags;
      expect([f, ds.map((d) => d.code)]).toEqual([f, ["E-TYPE-043"]]);
      expect(ds[0].message).toContain("ends in an expression it does not `return`");
    }
    // not the tail, or no declared return: still E-STMT-NO-EFFECT
    expect(codes(P(`    function hd(p: int) -> int { p; return p; }`))).toEqual(["E-STMT-NO-EFFECT"]);
    expect(codes(P(`    function hd(p: int) { p; }`))).toEqual(["E-STMT-NO-EFFECT"]);
  });

  test("a statement a later phase refuses is not also E-STMT-NO-EFFECT", () => {
    expect(codes(P(`    function g() { (x) => x; }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    function g() { y; }`))).toEqual(["E-SCOPE-001"]);
    expect(codes(P(`    function bump() { @n = @n + 1; }`, `        <button onclick={ bump(); bump; }>b</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("`break fail;` is one report (the keyword is consumed with it)", () => {
    expect(codes(P(`    function g() { for (;;) { break fail; } }`))).toEqual(["E-PARSE-EXPECTED"]);
  });

  test("`fail⏎h(1);`: E-ERROR-009 says the operand was read from the next line", () => {
    const src = P(`    function h(x: int) { @n = x; }\n    function g(id: string)! L {\n        fail\n        h(1);\n        return id;\n    }`);
    expect(only(src, "E-ERROR-009")[0].message).toContain("the operand of `fail` was read from the next line");
    expect(only(P(`    function g(id: string)! L {\n        fail .Nope;\n        return id;\n    }`), "E-ERROR-009")[0].message).not.toContain("read from the next line");
  });

  test("the glued-`?` note reaches call arguments and template slots (messages only)", () => {
    const hint = "for the conditional, put a space before it";
    const arg = run(P(`    fn id(x: int) -> int { return x; }\n    function g(a: int) { @n = id(a == 1? 2 : 3); }`)).diags;
    expect(arg[0].code).toBe("E-PARSE-EXPECTED");
    expect(arg[0].message).toContain(hint);
    const slot = run(P(`    function g(a: int) -> string { return \`v=\${a == 1? "y" : "n"}\`; }`)).diags;
    expect(slot[0].code).toBe("E-PARSE-TEMPLATE");
    expect(slot[0].message).toContain(hint);
    // a glued `?` at the end of its line gets no note
    expect(run(P(`    function g(id: string)! L {\n        const v = load(id)?\n        @s = v;\n    }`)).diags[0].message).not.toContain(hint);
  });
});
