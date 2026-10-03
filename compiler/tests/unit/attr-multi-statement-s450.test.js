/**
 * S450 — E-ATTR-MULTI-STATEMENT (SPEC §5.2.4; ruling (v), user-voice-scrml.md
 * S447 "stamp all": "a multi-statement value in a non-handler attribute is an
 * error").
 *
 * Before S450 a `;`-separated statement list in a NON-handler attribute value
 * compiled at exit 0 with the wrong meaning: `title=(f(); "t")` was not emitted
 * at all (W-CG-VALUE-ATTR-UNLOWERABLE), `title=${f(); "u"}` / `title={f(); "v"}`
 * took the value of `f()`, and `if=(f(); @x)` failed later with
 * E-CODEGEN-INVALID-LOGIC.
 *
 * Coverage:
 *   §1 fires — every value form (`(…)`, `${…}`, `{…}`, quoted `if="…"`), every
 *      non-handler attribute family, real source position, message shape
 *   §2 fires once in nested positions (`<each>` row, `for … lift`, engine
 *      state-child, `<match>` arm, component prop)
 *   §3 handler attributes are untouched (§5.2.3, #1106 / #1212)
 *   §4 single-expression values never fire — the decision is the parsed
 *      statement list, not the text (`;` in a string / template / regex /
 *      comment / nested arrow body / markup text; a trailing `;`)
 *   §5 the forms §5.2.4 leaves NOT DECIDED do not fire (newline-separated)
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const CODE = "E-ATTR-MULTI-STATEMENT";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s450-ams-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    return { errors: [...(r.errors ?? [])] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tabErrors(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs).errors ?? [];
}

const amsOf = (errs) => errs.filter((e) => e.code === CODE);
const lineOf = (e) => e.tabSpan?.line ?? e.span?.line;

const PRE = `<program>
type Phase:enum = { Idle, Loading }
<x> = 1
<items> = [1, 2]
<msg> = ""
\${ function f() { return 1 } }
\${ function g() { @msg = "g" } }
`;
const POST = `\n</program>\n`;
const top = (body) => PRE + body + POST;
// PRE is 7 lines, so the first body line is line 8.
const BODY_LINE = 8;

// ---------------------------------------------------------------------------
// §1 — fires
// ---------------------------------------------------------------------------

describe("§1 a `;`-separated statement list in a non-handler attribute value fires", () => {
  const cases = [
    ["parenthesized `title=(f(); \"t\")`", `<p title=(f(); "t")>A</p>`, "title"],
    ["interpolated `title=${f(); \"u\"}`", `<p title=\${f(); "u"}>B</p>`, "title"],
    ["braced `title={f(); \"v\"}`", `<p title={f(); "v"}>C</p>`, "title"],
    ["condition `if=(f(); @x)`", `<p if=(f(); @x)>D</p>`, "if"],
    ["quoted condition `if=\"f(); @x\"`", `<p if="f(); @x">E</p>`, "if"],
    ["`show=${f(); @x}`", `<p show=\${f(); @x}>F</p>`, "show"],
    ["`class:on=(f(); @x)`", `<p class:on=(f(); @x)>G</p>`, "class:on"],
    ["`class=(f(); \"c\")`", `<p class=(f(); "c")>H</p>`, "class"],
    ["`data-k=${let a = f(); a}`", `<p data-k=\${let a = f(); a}>I</p>`, "data-k"],
    ["`value=(f(); @msg)` on an input", `<input value=(f(); @msg)>`, "value"],
  ];
  for (const [label, body, attr] of cases) {
    test(label, () => {
      const r = compileSource(top(body));
      const f = amsOf(r.errors);
      expect(f.length).toBe(1);
      expect(lineOf(f[0])).toBe(BODY_LINE);
      expect(f[0].message).toContain(`attribute \`${attr}\``);
    });
  }

  // S450 fix round (S239 review bl01/bl03/bl04): a `${…}` / `{…}` value fires on
  // ANY clean parse with 2+ statements, however they are separated.
  test("a block statement then an expression, `${ if (@x) { f() } \"t\" }`", () => {
    const f = amsOf(compileSource(top(`<p title=\${ if (@x) { f() } "t" }>s</p>`)).errors);
    expect(f.length).toBe(1);
    expect(f[0].message).toContain("holds 2 statements");
  });

  test("the braced form, `{ if (@x) { f() } \"t\" }`", () => {
    expect(amsOf(compileSource(top(`<p title={ if (@x) { f() } "t" }>s</p>`)).errors).length).toBe(1);
  });

  test("a declaration and a use on separate lines, `${ let a = f()⏎a }`", () => {
    expect(amsOf(compileSource(top(`<p title=\${ let a = f()\na }>s</p>`)).errors).length).toBe(1);
  });

  test("three statements are counted", () => {
    const f = amsOf(compileSource(top(`<p title=(f(); g(); "t")>A</p>`)).errors);
    expect(f.length).toBe(1);
    expect(f[0].message).toContain("holds 3 statements");
  });

  test("a `;` between statements laid out over several lines still fires", () => {
    const f = amsOf(compileSource(top(`<p title=\${
    f();
    "u"
}>B</p>`)).errors);
    expect(f.length).toBe(1);
    expect(lineOf(f[0])).toBe(BODY_LINE);
  });

  test("the message names the attribute and both fixes", () => {
    const f = amsOf(compileSource(top(`<p title=(f(); "t")>A</p>`)).errors);
    expect(f[0].message).toContain("ONE expression");
    expect(f[0].message).toContain("single expression");
    expect(f[0].message).toContain("into a function");
    expect(f[0].message).toContain("title=compute()");
    expect(f[0].message).toContain("§5.2.4");
  });

  test("each offending attribute fires its own diagnostic", () => {
    const f = amsOf(compileSource(top(`<p title=(f(); "t") data-a=\${g(); 1}>A</p>`)).errors);
    expect(f.length).toBe(2);
  });

  test("the compile fails (the attribute is no longer silently dropped)", () => {
    const r = compileSource(top(`<p title=(f(); "t")>A</p>`));
    expect(r.errors.some((e) => e.code === CODE && (e.severity ?? "error") === "error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — nested positions fire exactly once
// ---------------------------------------------------------------------------

describe("§2 nested positions fire exactly once", () => {
  test("`<each>` row", () => {
    const f = amsOf(compileSource(top(`<ul><each in=@items as it><li title=\${f(); it}>r</li></each></ul>`)).errors);
    expect(f.length).toBe(1);
    expect(lineOf(f[0])).toBe(BODY_LINE);
  });

  test("`for … lift` row", () => {
    const f = amsOf(compileSource(top(`<ul>\${ for (it of @items) { lift <li title=\${f(); it}>r</li> } }</ul>`)).errors);
    expect(f.length).toBe(1);
  });

  test("engine state-child body", () => {
    const f = amsOf(compileSource(top(`<engine for=Phase initial=.Idle>
    <Idle><p title=(f(); "e")>i</p></>
    <Loading><p>l</p></>
</>`)).errors);
    expect(f.length).toBe(1);
  });

  test("`<match>` arm", () => {
    const f = amsOf(compileSource(top(`<ph>: Phase = .Idle
<match on=@ph>
    <Idle><p title=(f(); "m")>i</p></>
    <Loading><p>l</p></>
</>`)).errors);
    expect(f.length).toBe(1);
  });

  test("`<each>` inside an engine body — once, not twice", () => {
    const f = amsOf(compileSource(top(`<engine for=Phase initial=.Idle>
    <Idle><ul><each in=@items as it><li title=\${f(); it}>r</li></each></ul></>
    <Loading><p>l</p></>
</>`)).errors);
    expect(f.length).toBe(1);
  });

  test("component prop at the call site", () => {
    const f = amsOf(compileSource(top(`\${ const Card = <div class="card">\${label}</div> }
<Card label=(f(); "x")/>`)).errors);
    expect(f.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — handler attributes are untouched
// ---------------------------------------------------------------------------

describe("§3 event-handler attributes keep §5.2.3 behaviour", () => {
  const ok = [
    ["inline block `onclick={ f(); g() }`", `<button onclick={ f(); g() }>b</button>`],
    ["`${…}` statement list `onclick=${ f(); g() }`", `<button onclick=\${ f(); g() }>b</button>`],
    ["arrow block `onclick=${() => { f(); g() }}`", `<button onclick=\${() => { f(); g() }}>b</button>`],
    ["`on:click={ f(); g() }`", `<button on:click={ f(); g() }>b</button>`],
    ["`oninput={ f(); g() }`", `<input oninput={ f(); g() }>`],
  ];
  for (const [label, body] of ok) {
    test(`${label} — no E-ATTR-MULTI-STATEMENT`, () => {
      expect(amsOf(compileSource(top(body)).errors).length).toBe(0);
    });
  }

  test("bare `onclick=f(); g()` stays E-MULTI-STATEMENT-HANDLER, not this code", () => {
    const r = compileSource(top(`<button onclick=f(); g()>b</button>`));
    expect(amsOf(r.errors).length).toBe(0);
    expect(r.errors.filter((e) => e.code === "E-MULTI-STATEMENT-HANDLER").length).toBe(1);
  });

  test("engine `effect=${ a(); b() }` (a §51.0.H logic block) is exempt — opener and state-child", () => {
    const r = compileSource(top(`<engine for=Phase initial=.Idle effect=\${ f(); g() }>
    <Idle rule=.Loading><p>i</p></>
    <Loading rule=.Idle effect=\${ f(); g() }><p>l</p></>
</>`));
    expect(amsOf(r.errors).length).toBe(0);
  });

  test("`effect=` on a non-engine element is a plain attribute and fires (review fn05)", () => {
    const f = amsOf(compileSource(top(`<div effect=\${ f(); g() }>d</div>`)).errors);
    expect(f.length).toBe(1);
    expect(f[0].message).toContain("attribute `effect`");
  });
});

// ---------------------------------------------------------------------------
// §4 — single-expression values never fire (decided on the parse, not text)
// ---------------------------------------------------------------------------

describe("§4 a `;` that is not a statement separator never fires", () => {
  const ok = [
    ["`;` in a string", `<p title=\${ "a;b" }>s</p>`],
    ["`;` in a quoted static value", `<p title="a; b">s</p>`],
    ["`;` in a template literal", "<p title=${ `a;b` }>s</p>"],
    ["`;` in a regex", `<p title=(/;/.test("x") ? "y" : "n")>s</p>`],
    ["`;` in a block comment", `<p title=\${ f() /* ; */ }>s</p>`],
    ["`;` in a nested arrow body (IIFE)", `<p title=(() => { f(); return 2 })()>s</p>`],
    ["`;` in an arrow-valued prop body", `<p data-fn=\${ (a) => { f(); return a } }>s</p>`],
    ["`;` in a nested function expression", `<p title=(function() { f(); return 3 })()>s</p>`],
    ["a trailing `;` (`${f();}`)", `<p title=\${ f(); }>s</p>`],
    ["a trailing `;` in parens", `<p title=(f();)>s</p>`],
    ["`;` in an object-literal method body", `<p data-o=\${ { m() { f(); return 1 } } }>s</p>`],
    // S239 review fp27 — the statement grammar splits an anonymous
    // function-expression IIFE (declaration + `()`); the expression parser
    // consumes it whole, so it is one expression.
    ["an unparenthesized anonymous-function IIFE", `<p title=\${ function () { f(); return 1 }() }>s</p>`],
  ];
  for (const [label, body] of ok) {
    test(label, () => {
      expect(amsOf(tabErrors(top(body))).length).toBe(0);
    });
  }

  test("`;` in the TEXT of a markup value (`{<b>a; b</b>}`) is not a separator", () => {
    expect(amsOf(tabErrors(top(`<p data-m={<b>failed; retry</b>}>s</p>`))).length).toBe(0);
  });

  test("a single-expression value compiles without the code", () => {
    expect(amsOf(compileSource(top(`<p title=(f() + 1)>s</p>`)).errors).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4b — the S239 review false-positive set (fp01–fp30), every one silent
// ---------------------------------------------------------------------------

const REVIEW_FP = [
  ["fp01", "<p title=${ \"a;b\" }>s</p>"],
  ["fp02", "<p title=(@msg.replace(/;/g, \",\"))>s</p>"],
  ["fp03", "<p title=${ @msg.split(/;\\s*/).length }>s</p>"],
  ["fp04", "<p title=${ @x > 0 ? /a;b/.source : \"n\" }>s</p>"],
  ["fp05", "<p title=${ `a;${ @x };b` }>s</p>"],
  ["fp06", "<p title=${ `a${ (() => { f(); return 1 })() }b` }>s</p>"],
  ["fp07", "<p title=(() => { for (let i = 0; i < 3; i++) { f() } return \"t\" })()>s</p>"],
  ["fp08", "<p data-o=${ ({ a: 1, b: () => { f(); g() } }) }>s</p>"],
  ["fp09", "<p style=\"color:red; width:1px\">s</p>"],
  ["fp10", "<p style=${ \"color:red; width:\" + @x + \"px;\" }>s</p>"],
  ["fp11", "<p title=${ f() // c; d\n}>s</p>"],
  ["fp12", "<p title=${ f() /* a; b */ }>s</p>"],
  ["fp13", "<p class=\"a-${ @x }; b\">s</p>"],
  ["fp14", "<p title=${ f(); }>s</p>"],
  ["fp15", "<p title=${ @x / 2 + 1 / 3 }>s</p>"],
  ["fp16", "<p title=(@x / 2; )>s</p>"],
  ["fp17", "<p title=${ (@x); }>s</p>"],
  ["fp18", "<p data-m={<b title=\"a;b\">c; d</b>}>s</p>"],
  ["fp19", "<p title=${ @x > 0 ? \"a;\" : \";b\" }>s</p>"],
  ["fp20", "<p title=${ [1,2].map((v) => { const w = v; return w }).join(\";\") }>s</p>"],
  ["fp21", "<p title=${ @x /2/ 1; }>s</p>"],
  ["fp22", "<p title=\"${ f(); }\">s</p>"],
  ["fp23", "<p title=${ \"\\\";\" }>s</p>"],
  ["fp24", "<p title=${ 'a;b' }>s</p>"],
  ["fp25", "<p title=${ String.raw`a;b` }>s</p>"],
  ["fp26", "<p title=(@x < 2 && @x > 0 ? \"a\" : \"b\"; )>s</p>"],
  ["fp27", "<p title=${ function () { f(); return 1 }() }>s</p>"],
  ["fp28", "<p title=${ (function named() { f(); return 1 })() }>s</p>"],
  ["fp29", "<p title=${ (async () => { await f(); })() }>s</p>"],
  ["fp30", "<p title=${ class { m() { f(); } } }>s</p>"],
];

describe("§4b the S239 review false-positive set stays silent (full compile)", () => {
  for (const [id, body] of REVIEW_FP) {
    test(id, () => {
      expect(amsOf(compileSource(top(body)).errors).length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// §5 — §5.2.4 "Not yet detected" forms (a recorded LIMITATION, gap
// g-attr-multi-statement-undetected-forms — these pin today's behaviour so a
// future detector flips them deliberately; they are NOT permitted forms)
// ---------------------------------------------------------------------------

describe("§5 forms the statement parser reads as ONE statement are not yet detected (§5.2.4)", () => {
  test("`title=${f()⏎\"u\"}` (newline-separated, parsed as one statement)", () => {
    expect(amsOf(tabErrors(top(`<p title=\${f()\n"u"}>s</p>`))).length).toBe(0);
  });
  test("`title={f()⏎\"v\"}`", () => {
    expect(amsOf(tabErrors(top(`<p title={f()\n"v"}>s</p>`))).length).toBe(0);
  });
  test("`title=${ f() g() }` (juxtaposed)", () => {
    expect(amsOf(tabErrors(top(`<p title=\${ f() g() }>s</p>`))).length).toBe(0);
  });
  test("`title=(f()⏎\"w\")` — newlines inside parens are whitespace (§7.2.2 rule 4)", () => {
    expect(amsOf(tabErrors(top(`<p title=(f()\n"w")>s</p>`))).length).toBe(0);
  });
});
