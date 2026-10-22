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
import { textOf } from "../slice-m1/runtime/runtime.js";

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
  `<program>\n${decls}\n    fn f(${params}) -> string {\n        return ${body}\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
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

  test("FUZZ — the bootstrap's slot extents against acorn's (both goals), 4000 generated templates", () => {
    const res = runFuzz(mods, 4000, 469);
    const bad = res.disagreements.map((d) => `${d.verdict}: ${JSON.stringify(d.tpl)}`);
    expect(bad).toEqual([]);
    // coverage: every verdict class is exercised
    expect(res.tally["agree-read"]).toBeGreaterThan(300);
    expect(res.tally["agree-refuse"]).toBeGreaterThan(1000);
    expect(res.tally["scrml-content"]).toBeGreaterThan(50);
  });
  test("judge: a scrml form acorn's expression reader refuses is bounded by its tokens, as here", () => {
    const j = judge(mods, "`${ match n { .A :> \"}\" .B :> \"b\" } }`");
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
    const r = run(fnProg("    fn tag(s: string) -> string { return s }", "n: int", "tag`a${n}`"));
    const d = r.diags.find((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED");
    expect(d.message).toContain("tagged template");
  });
  test("a template is ONE operand of a match arm, across lines and holding `,` / `|`", () => {
    const src = fnProg("    type C:enum = { A, B }", "c: C, n: int",
      "match c {\n            .A :> `a, ${n}\n| x`\n            .B :> `b`\n        }");
    expect(codes(src)).toEqual([]);
  });
  test("a closer with no opener in a slot is named — it does not pop the brackets around the template", () => {
    const src = fnProg("    fn g(t: string) -> string { return t }", "a: int", "g(`${ a ) }`)");
    const d = diag(src, "E-PARSE-TEMPLATE");
    expect(d.message).toContain("with no opener inside the slot");
    expect(codes(src)).toEqual(["E-PARSE-TEMPLATE"]);
  });
  test("a `?{}` bound parameter is read by the same reader: one it cannot bound one way is refused (§8.1.2)", () => {
    const SQ = "?" + "{";
    const prog = (slot) => `<program db="./app.db">\n    function f(id: int) {\n        ${SQ}\`UPDATE t SET a = 1 WHERE id = \${${slot}}\`}.run()\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
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
    const src = fnProg("    fn g(a) { return a }", "n: int", "`v=${g(n)}`");
    const d = diag(src, "E-TEXT-NON-PRIMITIVE");
    expect(d).toBeDefined();
    expect(d.message).toContain("cannot resolve");
  });
  test("a field read of a struct is text", () => {
    expect(codes(fnProg(D, "p: P", "`hi ${p.name}`"))).toEqual([]);
  });
  test("E-OPERAND-NOT-NARROWED — a `T | not` slot; narrowed, it is text", () => {
    expect(codes(fnProg(D, "m: int | not", "`v=${m}`"))).toEqual(["E-OPERAND-NOT-NARROWED"]);
    const narrowed = `<program>\n    fn f(m: int | not) -> string {\n        if (m is given) {\n            return \`v=\${m}\`\n        }\n        return "none"\n    }\n    <main>\n        <p>x</p>\n    </main>\n</program>\n`;
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
    const src = `<program>\n    let <n:int=1/>\n    fn label(k: int) -> string {\n        return \`n=\${k}\`\n    }\n    <main>\n        <p>\${\`[\${@n}]\`}</p>\n    </main>\n</program>\n`;
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
