// templates-s469.test.js — s469 (bootstrap blocker #5): logic backtick
// templates, SPEC §14.13.3 — `` `typed ${n} chars` `` is a `string`; each
// `${…}` slot is a text sink (§14.13.1) holding ONE expression.
//
//   L. the ONE reader of a slot's extent (lex.scrml): strings, nested
//      templates, comments, regular expressions and braces inside a slot; what
//      a JavaScript reader could read the other way is refused (E-PARSE-TEMPLATE);
//      and the fuzz (template-slot-fuzz.js) — the bootstrap's extents against
//      acorn's, both goals, as impl#1 reads them (interpolation-extent.ts).
//   P. parse: the template node, E-PARSE-TEMPLATE refusals, a tagged template
//      refused by name, a template as one operand of a match arm.
//   T. types (§14.13.2): primitives accepted; E-TEXT-NON-PRIMITIVE,
//      E-OPERAND-NOT-NARROWED; `+` stays strict (S440).
//   E. emitted JS: concatenation of strings, a non-string slot through
//      `rt.textOf` (String(): ECMAScript Number::toString); the runtime refuses a
//      non-primitive (a compiler defect, never `[object Object]`).
// (Programs compiled, run and their text checked: acceptance/templates/*, graded
// in acceptance.test.js.)

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { bootLex, acornRead, acornTokRead, judge, runFuzz } from "./template-slot-fuzz.js";
import * as runtime from "../slice-m1/runtime/runtime.js";
const { textOf } = runtime;

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => [...new Set(run(src).diags.map((d) => d.code))].sort();
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const js = (src) => mods.print.printProgram(clean(src).core, "t.client.js", "scrml-runtime.js").js;
// a function returning `body` (a template), in a program that renders it
const fnProg = (decls, params, body) =>
  `<program>\n${decls}\n    fn f(${params}) -> string {\n        return ${body};\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
const lexWhy = (tpl) => bootLex(mods, tpl);

// ---------------------------------------------------------------------------
describe("L — the slot's extent: one reader, refused where JavaScript could read it the other way", () => {
  // [what, template, the payload of each top-level slot]
  const reads = [
    ["a string holding `}`", "`a${ \"}\" }b`", [" \"}\" "]],
    ["a string holding a backtick and `${`", "`${ \"`${\" }`", [" \"`${\" "]],
    ["a nested template holding `}`", "`${ `}${x}` }`", [" `}${x}` "]],
    ["a block comment holding `}`", "`${ /* } */ a }`", [" /* } */ a "]],
    ["a line comment holding `}`", "`${ a // }\n }`", [" a // }\n "]],
    ["an object literal", "`${ { a: \"}\" }.a }`", [" { a: \"}\" }.a "]],
    ["a division after `)`", "`${ (a) / 2 }`", [" (a) / 2 "]],
    ["a division after a complete template", "`${ `x`.length / 2 }`", [" `x`.length / 2 "]],
    ["a division after a name", "`${ n / 2 }${m}`", [" n / 2 ", "m"]],
    ["a `/` after `(` (a regular expression in both readers)", "`${ f(/}/) }`", [" f(/}/) "]],
  ];
  for (const [what, tpl, payloads] of reads) {
    test(`reads ${what} — where acorn ends it`, () => {
      const l = lexWhy(tpl);
      expect(l.ok).toBe(true);
      expect(l.slots.map(([s, e]) => tpl.slice(s, e))).toEqual(payloads);
      expect(acornTokRead(tpl)).toEqual({ ok: true, slots: l.slots });
    });
  }
  const refused = [
    ["`/` after `}`", "`${ { a: 1 } / 2 }`", "after `}`"],
    ["`/` after `)` inside braces", "`${ { a: (b) / 2 } }`", "after `)` inside braces"],
    ["`/` after `of` (a name to JavaScript, a keyword here)", "`${ of / 2 }`", "after `of`"],
    ["`/` after `await` (an operator to a module, a name to a script)", "`${ await / 2 }`", "after `await`"],
    ["`/` after `case` (a name here, an operator to JavaScript)", "`${ case / 2 }`", "after `case`"],
    ["`/` after `++`", "`${ a++ / 2 }`", "after `++`"],
    ["a closer with no opener", "`${ a ) }`", "no opener"],
    ["a mismatched closer", "`${ (a] }`", "different bracket"],
    ["a line break in a string", "`${ \"a\nb\" }`", "line break"],
    ["a legacy octal escape in a string", "`${ \"\\1\" }`", "legacy octal"],
    ["`\\0` and a digit in a string", "`${ \"\\08\" }`", "legacy octal"],
    ["a short `\\x` in a string", "`${ \"\\x4\" }`", "`\\x`"],
    ["an unclosed `\\u{` in a string (never runs past its quote)", "`${ \"\\u{\" }`", "`\\u`"],
    ["`<!--` in a slot (inside a string too)", "`${ \"<!--\" }`", "HTML-like"],
    ["a line-initial `-->` in a slot", "`${ a\n--> b }`", "HTML-like"],
    ["`-->` after a block comment's close", "`${ a /* x */ --> b }`", "HTML-like"],
  ];
  for (const [what, tpl, why] of refused) {
    test(`refuses ${what}`, () => {
      const l = lexWhy(tpl);
      expect(l.ok).toBe(false);
      expect(l.why).toContain(why);
    });
  }
  const chunks = [
    ["`\\1`", "legacy octal"], ["`\\08`", "legacy octal"], ["`\\x4`", "`\\x`"], ["`\\u12`", "`\\u`"],
    ["`\\u{110000}`", "`\\u`"], ["`\\u{`", "`\\u`"], ["`\\u{zz}`", "`\\u`"],
  ];
  for (const [tpl, why] of chunks) {
    test(`a template's text with ${tpl} is refused (no JavaScript template reads it)`, () => {
      const l = lexWhy(tpl);
      expect(l.ok).toBe(false);
      expect(l.why).toContain(why);
      expect(acornRead(tpl).ok).toBe(false);
    });
  }
  test("the escapes a template does read: `\\``, `\\${`, `\\u{1F600}`, `\\0`, line continuation", () => {
    for (const tpl of ["`a\\`b`", "`\\${x}`", "`\\u{1F600}`", "`\\0`", "`a\\\nb`", "`\\x41\\u0041`", "`\\q`"]) {
      expect(lexWhy(tpl)).toEqual({ ok: true, why: "", slots: [] });
      expect(acornRead(tpl).ok).toBe(true);
    }
  });
  test("an unclosed `\\u{` in a template's text does not swallow the closing backtick", () => {
    const toks = mods.lex.lex("`\\u{` + 1");
    expect(toks.map((t) => t.text)).toEqual(["\\u{`", "+", "1", ""]);
  });
  test("a CR or CR LF in a template's text reads as LF (as the emitted JavaScript reads it)", () => {
    const toks = mods.lex.lex("`a\r\nb\rc`");
    expect(toks[0].kind.data.cooked).toBe("a\nb\nc");
  });

  test("FUZZ — the bootstrap's slot extents against acorn's (both goals), 4000 generated templates; every one it reads is a Template node; every one it compiles clean RUNS to JavaScript's own text", () => {
    const res = runFuzz(mods, 4000, 469, { frontEnd, rt: runtime });
    const bad = res.disagreements.map((d) => `${d.verdict}: ${JSON.stringify(d.tpl)}`);
    expect(bad).toEqual([]);
    // coverage: every verdict class is exercised
    expect(res.tally["agree-read"]).toBeGreaterThan(300);
    expect(res.tally["agree-refuse"]).toBeGreaterThan(1000);
    expect(res.tally["scrml-content"]).toBeGreaterThan(50);
    expect(res.tally["e2e-same"]).toBeGreaterThan(200);
  });
  test("judge: a scrml form acorn's expression reader refuses is bounded by its tokens, as here", () => {
    const j = judge(mods, "`${ match n { .A :> \"}\", .B :> \"b\" } }`");
    expect(j.verdict).toBe("scrml-content");
    expect(j.lex.slots).toEqual(j.tok.slots);
  });
});

// ---------------------------------------------------------------------------
describe("P — parse", () => {
  test("a template is AExprK.Template: decoded static text, one slot per `${…}`", () => {
    const ast = mods.parse.parseFile("t.scrml", fnProg("", "n: int", "`a\\`b ${n} c\\${d}`"), 0).ast;
    const s = JSON.stringify(ast);
    expect(s).toContain("\"variant\":\"Template\"");
    expect(s).toContain("\"quasis\":[\"a`b \",\" c${d}\"]");
  });
  test("E-PARSE-TEMPLATE — an empty slot, two expressions in a slot, an unterminated template", () => {
    expect(codes(fnProg("", "n: int", "`a${}`"))).toEqual(["E-PARSE-TEMPLATE"]);
    expect(codes(fnProg("", "n: int", "`a${n n}`"))).toEqual(["E-PARSE-TEMPLATE"]);
    expect(codes(fnProg("", "n: int", "`a${n}"))).toContain("E-PARSE-TEMPLATE");
  });
  test("E-PARSE-TEMPLATE names the lexer's reason (a slot read two ways)", () => {
    const d = diag(fnProg("", "n: int", "`${ { a: 1 } / n }`"), "E-PARSE-TEMPLATE");
    expect(d.message).toContain("after `}`");
    expect(d.message).toContain("cannot be read one way");
  });
  test("a tagged template is refused by name (E-BOOTSTRAP-UNSUPPORTED), not read as a call or a name", () => {
    const r = run(fnProg("    fn tag(s: string) -> string { return s; }", "n: int", "tag`a${n}`"));
    const d = r.diags.find((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.message).toContain("tagged template");
  });
  test("a template is ONE operand of a match arm, across lines and holding `,` / `|`", () => {
    const src = fnProg("    type C:enum = { A, B }", "c: C, n: int",
      "match c {\n            .A :> `a, ${n}\n| x`,\n            .B :> `b`\n        };");
    expect(codes(src)).toEqual([]);
  });
  test("a closer with no opener in a slot is named — it does not pop the brackets around the template", () => {
    const src = fnProg("    fn g(t: string) -> string { return t; }", "a: int", "g(`${ a ) }`)");
    const d = diag(src, "E-PARSE-TEMPLATE");
    expect(d.message).toContain("with no opener inside the slot");
    expect(codes(src)).toEqual(["E-PARSE-TEMPLATE"]);
  });
  test("a `?{}` bound parameter is read by the same reader: one it cannot bound one way is refused (§8.1.2)", () => {
    const SQ = "?" + "{";
    const prog = (slot) => `<program db="./app.db">\n    function f(id: int) {\n        ${SQ}\`UPDATE t SET a = 1 WHERE id = \${${slot}}\`}.run();\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
    const bad = run(prog(" { a: id } / 2 "));
    const d = bad.diags.find((x) => x.code === "E-PARSE-TEMPLATE");
    expect(d.message).toContain("bound parameter cannot be read one way");
    expect(bad.diags.map((x) => x.code)).not.toContain("E-SQL-008");
    // twin: a readable parameter is no template refusal
    expect(run(prog("id")).diags.map((x) => x.code)).not.toContain("E-PARSE-TEMPLATE");
  });
  test("`${\"${\"}` spells the characters `${` (no W-STRING-INTERP-LITERAL)", () => {
    expect(codes(fnProg("", "", "`a${\"${\"}b`"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("T — a slot is a text sink (§14.13.2)", () => {
  const D = "    type P:struct = { name: string }\n    type C:enum = { Red, Green }\n    type R:enum = { Ok(v: int), Bad }";
  test("accepted: string, int, number, bool, a unit enum value — and nested templates", () => {
    expect(codes(fnProg(D, "s: string, i: int, x: number, b: bool, c: C", "`${s} ${i} ${x} ${b} ${c} ${`<${i}>`}`"))).toEqual([]);
  });
  test("the result is a `string`", () => {
    expect(codes(fnProg(D, "i: int", "`${i}`.length"))).toContain("E-TYPE-031");
    expect(codes(fnProg(D, "i: int", "`${i}`.toUpperCase()"))).toEqual([]);
  });
  for (const [what, params, slot] of [
    ["a struct", "p: P", "p"],
    ["a tape", "xs: int[]", "xs"],
    ["a payload enum value", "r: R", "r"],
    ["`not`", "", "not"],
  ]) {
    test(`E-TEXT-NON-PRIMITIVE — ${what}`, () => {
      expect(codes(fnProg(D, params, "`v=${" + slot + "}`"))).toEqual(["E-TEXT-NON-PRIMITIVE"]);
    });
  }
  test("E-TEXT-NON-PRIMITIVE — a value of unresolved type (fail closed); its message names the fixes", () => {
    const src = fnProg("    fn g(a) { return a; }", "n: int", "`v=${g(n)}`");
    const d = diag(src, "E-TEXT-NON-PRIMITIVE");
    expect(d).toBeDefined();
    expect(d.message).toContain("cannot resolve");
  });
  test("a field read of a struct is text", () => {
    expect(codes(fnProg(D, "p: P", "`hi ${p.name}`"))).toEqual([]);
  });
  test("E-OPERAND-NOT-NARROWED — a `T | not` slot; narrowed, it is text", () => {
    expect(codes(fnProg(D, "m: int | not", "`v=${m}`"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
    const narrowed = `<program>\n    fn f(m: int | not) -> string {\n        if (m is given) {\n            return \`v=\${m}\`;\n        }\n        return "none";\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
    expect(codes(narrowed)).toEqual([]);
  });
  test("an undeclared name in a slot is reported once (E-SCOPE-001), not again as text", () => {
    expect(codes(fnProg(D, "", "`v=${nope}`"))).toEqual(["E-SCOPE-001"]);
  });
  test("`+` stays strict (S440): string + int is still refused; the template is the spelling", () => {
    expect(codes(fnProg(D, "n: int", "\"typed \" + n"))).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
    expect(codes(fnProg(D, "n: int", "`typed ${n}`"))).toEqual([]);
  });
  test("a slot's reads are tracked: a template in markup re-renders when the cell changes", () => {
    const src = `<program>\n    let <n:int=1/>\n    fn label(k: int) -> string {\n        return \`n=\${k}\`;\n    }\n    <main>\n        <p>\${\`[\${@n}]\`}</p>\n    </main>\n</program>\n`;
    expect(codes(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("E — emitted JavaScript", () => {
  test("concatenation of strings; a non-string slot through rt.textOf; a string slot as it is", () => {
    const out = js(fnProg("", "n: int, s: string", "`typed ${n} chars, ${s}!`"));
    expect(out).toContain("\"typed \" + rt.textOf(n) + \" chars, \" + s + \"!\"");
  });
  test("a template with no slots is its text; `${s}` alone is `s`", () => {
    expect(js(fnProg("", "", "`plain`"))).toContain("return \"plain\";");
    expect(js(fnProg("", "s: string", "`${s}`"))).toContain("return s;");
  });
  test("the static text is a printed string literal (quotes and backslashes escaped)", () => {
    const out = js(fnProg("", "n: int", "`a\"b\\\\c ${n}`"));
    expect(out).toContain("\"a\\\"b\\\\c \" + rt.textOf(n)");
  });
  test("textOf is the §20.7.2 text: Number::toString, true / false", () => {
    expect(textOf(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(textOf(1e21)).toBe("1e+21");
    expect(textOf(-0)).toBe("0");
    expect(textOf(1e-7)).toBe("1e-7");
    expect(textOf(-42)).toBe("-42");
    expect(textOf(true)).toBe("true");
    expect(textOf("Red")).toBe("Red");
  });
  test("textOf refuses a non-primitive (a compiler defect) — never `[object Object]` or `null`", () => {
    expect(() => textOf({ a: 1 })).toThrow("has no text");
    expect(() => textOf(null)).toThrow("has no text");
    expect(() => textOf([1])).toThrow("has no text");
  });
});

// ---------------------------------------------------------------------------
// Review round 1 (s469-boot-templates r1): H1, the Recovered backstop, M1, L1, P1.
// ---------------------------------------------------------------------------
const jsOf = (src) => {
  const r = run(src);
  expect(r.diags.filter((d) => !d.code.startsWith("W-")).map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  return mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;
};

describe("H1 — a WARNING in a slot does not refuse the template", () => {
  test("`is some` (W-IS-SOME-DEPRECATED) in a slot: the template stands, the slot is typed", () => {
    const src = fnProg("", "m: int | not", "`given=${m is some}`");
    expect(codes(src)).toEqual(["W-IS-SOME-DEPRECATED"]);
    const out = jsOf(src);
    expect(out).toContain("return \"given=\" + rt.textOf(");
    expect(out).not.toContain("return null;");
  });
  test("a quoted `${…}` (W-STRING-INTERP-LITERAL) in a slot: the text stands", () => {
    const src = fnProg("", "n: int", "`v=${\"${n}\"}`");
    expect(codes(src)).toEqual(["W-STRING-INTERP-LITERAL"]);
    expect(jsOf(src)).toContain("return \"v=\" + \"${n}\";");
  });
  test("a struct slot beside a warning slot is still E-TEXT-NON-PRIMITIVE", () => {
    const src = fnProg("    type P:struct = { name: string }", "p: P, m: int | not", "`${m is some} ${p}`");
    expect(codes(src)).toEqual(["E-TEXT-NON-PRIMITIVE", "W-IS-SOME-DEPRECATED"]);
  });
});

describe("BACKSTOP — a Recovered node never reaches the printer when the file reported no error", () => {
  test("a placeholder with no Error diagnostic is E-INTERNAL-RECOVERED-UNREPORTED, and nothing is lowered", () => {
    const src = fnProg("", "n: int", "`v=${n}`");
    const linked = mods.link.parseProgram([{ path: "t.scrml", src }], "t.scrml");
    expect(linked.diags).toEqual([]);
    // forge what a parser bug would leave behind: the returned template as a placeholder, no error reported
    const json = JSON.stringify(linked.files);
    const at = json.indexOf("{\"variant\":\"Template\"");
    expect(at).toBeGreaterThan(0);
    let depth = 0;
    let end = at;
    for (; end < json.length; end++) {
      if (json[end] === "{") depth++;
      else if (json[end] === "}") { depth--; if (depth === 0) break; }
    }
    const forged = JSON.parse(json.slice(0, at) + "\"Recovered\"" + json.slice(end + 1));
    const tp = mods.analyze.analyze(forged, "t.scrml");
    expect(tp.diags.map((d) => d.code)).toContain("E-INTERNAL-RECOVERED-UNREPORTED");
    expect(mods.lower.lower(tp).core ?? null).toBe(null);
  });
  // r3 F1: every position — a write target, a field write, `reset(…)`, a handler —
  // forged by swapping the name ZZZ for a placeholder in a file that reported nothing
  const forgeAt = (src) => {
    const linked = mods.link.parseProgram([{ path: "t.scrml", src }], "t.scrml");
    expect(linked.diags.filter((d) => d.code.startsWith("E-"))).toEqual([]);
    const json = JSON.stringify(linked.files);
    const name = "{\"variant\":\"Name\",\"data\":{\"name\":\"ZZZ\"}}";
    expect(json).toContain(name);
    return JSON.parse(json.split(name).join("\"Recovered\""));
  };
  const D = "    type P:struct = { let x: int }\n    let <n:int=0/>\n    let <p:P=({ x: 1 })/>\n";
  for (const [where, body] of [
    ["a handler's write target", "    <main>\n        <button onclick={ ZZZ = 1; }>b</button>\n    </main>"],
    ["a function's write target", "    function f() {\n        ZZZ = 1;\n    }\n    <main>\n        <p>x</p>\n    </main>"],
    ["a field write's object", "    function f() {\n        ZZZ.x = 1;\n    }\n    <main>\n        <p>x</p>\n    </main>"],
    ["reset's argument", "    function f() {\n        reset(ZZZ);\n    }\n    <main>\n        <p>x</p>\n    </main>"],
  ]) {
    test(`F1 — a placeholder as ${where} is E-INTERNAL-RECOVERED-UNREPORTED; nothing lowers`, () => {
      const forged = forgeAt("<program>\n" + D + body + "\n</program>\n");
      const tp = mods.analyze.analyze(forged, "t.scrml");
      expect(tp.diags.map((d) => d.code)).toContain("E-INTERNAL-RECOVERED-UNREPORTED");
      expect(mods.lower.lower(tp).core ?? null).toBe(null);
    });
  }
  test("F1 — the LOWER-side guard: a placeholder that reaches Core is checkCore C-R1, never a silent `not`", () => {
    const forged = forgeAt(fnProg("", "n: int", "`v=${ZZZ}`"));
    const tp = mods.analyze.analyze(forged, "t.scrml");
    // simulate a front end that missed it: drop the analyze report, lower anyway
    const missed = { ...tp, diags: tp.diags.filter((d) => d.code !== "E-INTERNAL-RECOVERED-UNREPORTED") };
    const core = mods.lower.lower(missed).core;
    expect(core).toBeTruthy();
    expect(mods.check.checkCore(core).some((f) => f.startsWith("C-R1:"))).toBe(true);
    expect(JSON.stringify(core)).toContain("Unreadable");
  });
  test("twin: the same kind of node beside a parse error is the parse error's (no internal report)", () => {
    expect(codes(fnProg("", "n: int", "`v=${}`"))).toEqual(["E-PARSE-TEMPLATE"]);
  });
});

describe("found by the end-to-end fuzz — a call of a value is never silently `not`", () => {
  test("`total()` on a `number` parameter is refused (it printed `null === 1`)", () => {
    const src = "<program>\n    fn f(total: number) -> bool {\n        return total() == 1;\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n";
    const d = diag(src, "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.message).toContain("only a declared scrml function is callable");
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("r3 F2: not piled onto a parse error in the file (the parse error is the report)", () => {
    const src = "<program>\n    fn f(total: number) -> bool {\n        return total() == 1;\n    }\n    fn g() -> string {\n        return `a${}`\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n";
    expect(codes(src)).toEqual(["E-PARSE-TEMPLATE"]);
  });
  test("r3 F2: E-EQ-001 is not piled onto a parse error inside the comparison", () => {
    expect(codes(fnProg("", "n: int, s: string", "`${(n == s) + ${}`"))).not.toContain("E-EQ-001");
  });
});

describe("found by the end-to-end fuzz — `==` across types is E-EQ-001 (§45), never a silent strict compare", () => {
  test("int == string, string != int, bool == int are refused; int == number and like types are not", () => {
    expect(codes(fnProg("", "n: int, s: string", "`${n == s}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg("", "n: int", "`${\"\" != n}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg("", "n: int, b: bool", "`${b == n}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg("", "n: int, x: number", "`${n == x}`"))).toEqual([]);
    expect(codes(fnProg("", "s: string, t: string", "`${s != t}`"))).toEqual([]);
    // a tape against a string, an enum against a string: different kinds too
    expect(codes(fnProg("", "xs: int[], s: string", "`${xs == s}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg("    type C:enum = { Red, Green }", "c: C", "`${c == \"Red\"}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg("    type C:enum = { Red, Green }", "c: C", "`${c == .Red}`"))).toEqual([]);
  });
  // RULED (user-voice S469, "Ratify: same type only (Rec)")
  const T3 = "    type Pt:struct = { x: int }\n    type Color:enum = { Red, Green }\n    type Shape:enum = { Sq, Ci }";
  test("different named types are E-EQ-001: a struct against an enum, two different enums", () => {
    expect(codes(fnProg(T3, "p: Pt, c: Color", "`${p == c}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg(T3, "c: Color, s: Shape", "`${c != s}`"))).toEqual(["E-EQ-001"]);
  });
  test("tapes of different element types are E-EQ-001; int[] against number[] is not", () => {
    expect(codes(fnProg(T3, "a: int[], b: string[]", "`${a == b}`"))).toEqual(["E-EQ-001"]);
    expect(codes(fnProg(T3, "a: int[], b: number[]", "`${a == b}`"))).toEqual([]);
  });
  test("no false refusal: the same struct, the same enum, int against number, `T | not` against `not` (E-EQ-002 only)", () => {
    expect(codes(fnProg(T3, "p: Pt, q: Pt", "`${p == q}`"))).toEqual([]);
    expect(codes(fnProg(T3, "c: Color, d: Color", "`${c == d}`"))).toEqual([]);
    expect(codes(fnProg(T3, "n: int, x: number", "`${n != x}`"))).toEqual([]);
    expect(codes(fnProg(T3, "m: int | not, n: int", "`${m == n}`"))).toEqual([]);
    expect(codes(fnProg(T3, "m: int | not", "`${m == not}`"))).toEqual(["E-EQ-002"]);
  });
});

describe("M1 — a backslash before U+2028 / U+2029 is a line continuation", () => {
  for (const [name, ch] of [["U+2028", " "], ["U+2029", " "]]) {
    test(`${name} in a template and in a quoted string`, () => {
      expect(mods.lex.lex("`a\\" + ch + "b`")[0].kind.data.cooked).toBe("ab");
      expect(mods.lex.lex("\"a\\" + ch + "b\"")[0].kind.data.cooked).toBe("ab");
      expect(eval("`a\\" + ch + "b`")).toBe("ab");   // JavaScript agrees
    });
  }
});

describe("L1 — a template on the line after an expression reads two ways", () => {
  // s469 (§7.2.2 rule 5, F4 (ii); the code RULED "Build both"): E-STMT-SPLIT-CONTINUATION, at the end of the line
  // above (was E-PARSE-TEMPLATE). The template line is then read as its own statement, which lacks its `;`.
  test("refused by name (E-STMT-SPLIT-CONTINUATION), never dropped as a second statement", () => {
    const src = "<program>\n    fn f(s: string, n: int) -> string {\n        const t: string = s\n        `x${n}`\n        return t;\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n";
    const d = diag(src, "E-STMT-SPLIT-CONTINUATION");
    expect(d.message).toContain("add `;` to the line above, or join the lines");
    expect(d.span.start).toBe(src.indexOf("= s") + 3);
    expect(d.span.end).toBe(d.span.start);
    expect(codes(src)).toEqual(["E-STMT-MISSING-SEMICOLON", "E-STMT-SPLIT-CONTINUATION"]);   // (sorted)
    // with both `;`s written there is nothing to refuse — and the template statement does nothing
    expect(codes(src.replace("= s\n", "= s;\n").replace("`x${n}`\n", "`x${n}`;\n"))).toEqual(["E-STMT-NO-EFFECT"]);
  });
});

describe("P1 — the printer never merges a prefix `-` with its operand's sign", () => {
  const P1 = (body, params) => "<program>\n    fn f(" + params + ") -> number {\n        return " + body + ";\n    }\n    <main>\n        <p>${f(3)}</p>\n    </main>\n</program>\n";
  const fnText = (src) => {
    const out = jsOf(src);
    const at = out.indexOf("function f(");
    return out.slice(at, out.indexOf("\n}", at) + 2);
  };
  test("-(-x) prints `-(-x)`, never the decrement `--x`, and computes x", () => {
    const f = fnText(P1("-(-x)", "x: int"));
    expect(f).toContain("-(-x)");
    expect(f).not.toContain("--");
    expect(new Function(f + "; return f(3);")()).toBe(3);
  });
  test("-(-1.0) never prints the SyntaxError `--1`", () => {
    const f = fnText(P1("-(-1.0)", "x: int"));
    expect(f).not.toContain("--");
    expect(new Function(f + "; return f(3);")()).toBe(1);
  });
  test("-(-(-x)) and x - -1 stay what they say", () => {
    const f = fnText(P1("-(-(-x)) + (x - -1)", "x: int"));
    expect(f).not.toContain("--");
    expect(new Function(f + "; return f(3);")()).toBe(1);
  });
});
