/**
 * S469 round 2 (s469-impl1-arm-commas, review of 2f9176de0 F1 / F2) — raw arm text is read with
 * the LEXER (compiler/src/arm-list-split.ts), so a regular-expression literal in an arm body is
 * the regex's own: a `,` in it is not an arm separator (F1: a valid arm was refused) and a quote
 * in it does not flip the string scan (F2: the next arm was silently dropped and the previous arm
 * returned its pattern — `return (c ? "q" : "n", "b")`).
 *
 * For each shape: the newline list, the comma list and a mixed list compile to BYTE-IDENTICAL
 * output, with no diagnostics, and the output is CORRECT (every arm is lowered, the regex is
 * emitted as written).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitArmSeparatorCommas, rawArmHasStrayComma, literalSpans } from "../../src/arm-list-split.ts";
import { splitMultiArmString } from "../../src/codegen/emit-control-flow.ts";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "arm-commas-regex-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileAt(src, slot) {
  const dir = join(TMP, slot);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const outs = {};
  let js = "";
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) { outs[k] = v; js += (v && v.clientJs) || ""; }
  return { codes: (r.errors || []).map((e) => e.code), messages: (r.errors || []).map((e) => e.message), out: JSON.stringify(outs), js };
}

/** `@1` `@2` `@3`: the separator after arm 1 / 2 / 3. */
const SPELLINGS = {
  newline: ["", "", ""],
  comma: [",", ",", ","],
  mixed: [",", "", ","],
};
function spell(template, which) {
  const [a, b, c] = SPELLINGS[which];
  return template.replace("@1", a).replace("@2", b).replace("@3", c);
}

const fnPage = (arms) => `<k> = "b"
<s> = ""
\${
  function f(x, y) { return x }
  function go() {
    const a = 6
    const b = 2
    @s = match @k {
${arms}
    }
  }
}
<button onclick=go()>go</>
<p>\${@s}</>`;

const SHAPES = {
  "regex with `\"` (the review's F2 shape)": [fnPage(`      "a" :> /"/.test(@k) ? "q" : "n"@1
      "b" :> "bee"@2
      else :> "z"@3`), [`/"/`, `=== "b") return "bee"`]],
  "regex with `'`": [fnPage(`      "a" :> /'/.test(@k) ? "q" : "n"@1
      "b" :> "bee"@2
      else :> "z"@3`), [`/'/`, `=== "b") return "bee"`]],
  "regex with a backtick": [fnPage("      \"a\" :> /`/.test(@k) ? \"q\" : \"n\"@1\n      \"b\" :> \"bee\"@2\n      else :> \"z\"@3"), ["/`/", `=== "b") return "bee"`]],
  "regex with `/` and `\"` inside a class, and flags": [fnPage(`      "a" :> /[/"]x/gi.test(@k) ? "q" : "n"@1
      "b" :> "bee"@2
      else :> "z"@3`), [`/[/"]x/gi`, `=== "b") return "bee"`]],
  "regex with `,` (the review's F1 shape)": [fnPage(`      "a" :> /a,b/.test(@k) ? "q" : "n"@1
      "b" :> "bee"@2
      else :> "z"@3`), [`/a,b/`, `=== "b") return "bee"`]],
  "regex with `,` and a quote, and division in a call": [fnPage(`      "a" :> f(a / b, a / b)@1
      "b" :> /,"/.test(@k) ? a / b : "x"@2
      else :> "z"@3`), [`a / b , a / b`, `/,"/`, `else return "z"`]],
};

describe("§1 a regex literal in an expression-position arm body: newline = comma = mixed, and correct", () => {
  let slot = 0;
  for (const [name, [template, mustContain]] of Object.entries(SHAPES)) {
    test(name, () => {
      const id = `r-${++slot}`;
      const lines = compileAt(spell(template, "newline"), id);
      const commas = compileAt(spell(template, "comma"), id);
      const mixed = compileAt(spell(template, "mixed"), id);
      expect(lines.codes).toEqual([]);
      expect(commas.codes).toEqual([]);
      expect(mixed.codes).toEqual([]);
      expect(commas.out).toBe(lines.out);
      expect(mixed.out).toBe(lines.out);
      for (const s of mustContain) expect(lines.js).toContain(s);
      // never a JS comma sequence returning the next arm's pattern
      expect(lines.js).not.toMatch(/"n" , ?"b"|"n", "b"/);
    });
  }

  test("the derived-cell form (review F1 case 2)", () => {
    const t = `type Role:enum = { Admin, Editor }
<role>:Role = .Admin
<lbl> = match @role { .Admin :> /a,b/.source@1 .Editor :> "e"@2 }
<p>\${@lbl}</>`;
    const lines = compileAt(spell(t, "newline"), "derived");
    const commas = compileAt(spell(t, "comma"), "derived");
    expect(lines.codes).toEqual([]);
    expect(commas.codes).toEqual([]);
    expect(commas.out).toBe(lines.out);
    expect(lines.js).toContain("/a,b/");
  });
});

describe("§2 the lexer's reading, unit level", () => {
  test("splitArmSeparatorCommas: a `,` in a regex / string / template / call is the arm's own", () => {
    expect(splitArmSeparatorCommas(`"a" :> /a,b/ . test ( x ) , "b" :> 2`)).toEqual([`"a" :> /a,b/ . test ( x )`, `"b" :> 2`]);
    expect(splitArmSeparatorCommas(`"a" :> /"/ . test ( x ) ? "q" : "n" , "b" :> "bee" ,`)).toEqual([`"a" :> /"/ . test ( x ) ? "q" : "n"`, `"b" :> "bee"`]);
    expect(splitArmSeparatorCommas("\"a\" :> `x, ${ y }, z` , else :> /[/,]/gi . source")).toEqual(["\"a\" :> `x, ${ y }, z`", "else :> /[/,]/gi . source"]);
    expect(splitArmSeparatorCommas(`. A :> f ( a / b , c / d ) , . B :> 2`)).toEqual([`. A :> f ( a / b , c / d )`, `. B :> 2`]);
    // after the deprecated `->` arrow too
    expect(splitArmSeparatorCommas(`"a" -> /a,b/ . source , "b" -> 2`)).toEqual([`"a" -> /a,b/ . source`, `"b" -> 2`]);
  });

  test("splitArmSeparatorCommas fails closed: `,,`, a leading `,`, a piece with no arm arrow", () => {
    expect(splitArmSeparatorCommas(`. X :> 1 , , . Y :> 2`)).toEqual([`. X :> 1 , , . Y :> 2`]);
    expect(splitArmSeparatorCommas(`, . X :> 1 , . Y :> 2`)).toEqual([`, . X :> 1 , . Y :> 2`]);
    expect(splitArmSeparatorCommas(`. X :> f ( 1 ) , 2`)).toEqual([`. X :> f ( 1 ) , 2`]);
  });

  test("rawArmHasStrayComma: only a depth-0 `,` token", () => {
    expect(rawArmHasStrayComma(`"a" :> /a,b/ . test ( x )`)).toBe(false);
    expect(rawArmHasStrayComma(`"a" :> "p, q"`)).toBe(false);
    expect(rawArmHasStrayComma("\"a\" :> `p, ${ q }`")).toBe(false);
    expect(rawArmHasStrayComma(`"a" :> f ( a / b , c / d )`)).toBe(false);
    expect(rawArmHasStrayComma(`. X :> f ( 1 ) , 2`)).toBe(true);
    expect(rawArmHasStrayComma(`. X :> 1 , , . Y :> 2`)).toBe(true);
  });

  test("literalSpans reads a regex holding a quote as one literal", () => {
    const s = `"a" :> /"/ . test ( x ) ? "q" : "n" "b" :> "bee"`;
    const spans = literalSpans(s);
    expect(spans.get(7)).toEqual({ end: 10, kind: "regex" });
  });

  test("splitMultiArmString: a quote in a regex does not hide the next arm head", () => {
    const s = `"a" :> /"/ . test ( x ) ? "q" : "n" "b" :> "bee" else :> "z"`;
    expect(splitMultiArmString(s)).toEqual([`"a" :> /"/ . test ( x ) ? "q" : "n"`, `"b" :> "bee"`, `else :> "z"`]);
  });
});

describe("§3 a regex after a binary `+` (the lexer reads that `/` as division) is refused, with the way out", () => {
  test("E-PARSE-001 names the parenthesized spelling; the parenthesized spelling compiles", () => {
    const t = (re) => fnPage(`      "a" :> "x" + ${re}.source,
      else :> "y",`);
    const bad = compileAt(t("/a,b/"), "plus-bad");
    expect(bad.codes).toContain("E-PARSE-001");
    expect(bad.messages.join("\n")).toContain("(/a,b/)");
    const good = compileAt(t("(/a,b/)"), "plus-good");
    expect(good.codes).toEqual([]);
    expect(good.js).toContain("/a,b/");
  });
});

describe("§4 the deprecated `->` arrow in a comma list (S469 r4, final review F2)", () => {
  test("`\"a\" -> f(2, 3),` / `else -> \"z\"` — the token-joined `- >` is read as an arm arrow", () => {
    const t = fnPage(`      "a" -> f(2, 3)@1
      "b" -> f("x, y", 1)@2
      else -> "z"@3`);
    const lines = compileAt(spell(t, "newline"), "arrow-dash");
    const commas = compileAt(spell(t, "comma"), "arrow-dash");
    const mixed = compileAt(spell(t, "mixed"), "arrow-dash");
    expect(lines.codes.filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(commas.codes).toEqual(lines.codes);
    expect(mixed.codes).toEqual(lines.codes);
    expect(commas.out).toBe(lines.out);
    expect(mixed.out).toBe(lines.out);
    expect(lines.js).toContain(`=== "b"`);
    // (a regex right after a source `->` is lexed as division at the SOURCE — `-` `>` are two
    // PUNCT tokens there — the g-impl1-regex-after-binary-operator-lexed-as-division-s469 class)
  });

  test("splitArmSeparatorCommas reads the joined `- >`", () => {
    expect(splitArmSeparatorCommas(`"a" - > f ( 2 , 3 ) , else - > "y"`)).toEqual([`"a" - > f ( 2 , 3 )`, `else - > "y"`]);
    expect(rawArmHasStrayComma(`"a" - > f ( 2 , 3 )`)).toBe(false);
  });
});
