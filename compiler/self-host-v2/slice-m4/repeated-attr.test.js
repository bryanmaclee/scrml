// repeated-attr.test.js — s451: an attribute written twice is refused, never
// first-wins-rest-dropped (S239 review of #1254, MED; and the #1260 nit on
// `req req("m")`, LOW).
//
// Governing text: none. §4, §5, §24 and §34 were searched for a rule on a
// repeated attribute (an E-ATTR-* duplicate code) — the SPEC names none — so
// the bootstrap refuses it with E-BOOTSTRAP-UNSUPPORTED (policy: an
// unimplemented / unspecified shape is refused, never ignored). The check sits
// in the parser at the end of EVERY non-declaration opener (parseOpener →
// repeatedAttrDiags): an element, a `<program>`, a state-child, an `<effect>`,
// a `<*x>` reference — one check for every attribute name. Declaration openers
// are judged by analyze's repeatedWordDiags (#1260).
//
// §55.1 / §55.12: a presence validator (`req`, `is some`) is ONE predicate —
// its argument is only a message (§55.10) — so `req req("m")` repeats it; a
// comparing validator with different arguments (`length(>2) length(<9)`) is a
// conjunction and stays legal.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const diags = (src) => run(src).diags.map((d) => `${d.code}: ${d.message}`);
const twice = (src) => run(src).diags.filter((d) => d.code === "E-BOOTSTRAP-UNSUPPORTED" && /written twice/.test(d.message));

const prog = (body, decls = "") => `<program>
    let <step:number=1/>
    let <ok:boolean=true/>
    function go(n: number) { @step = n }
${decls}
    <main>
${body}
    </main>
</program>
`;

describe("a repeated element attribute is refused (every name, one check)", () => {
  const CASES = [
    ["two `if=`", `        <p id="a" if=@ok if=(@step == 2)>x</p>`, "if"],
    ["`else else`", `        <p if=@ok>a</p>\n        <p else else>b</p>`, "else"],
    ["two `else-if=`", `        <p if=@ok>a</p>\n        <p else-if=(@step == 1) else-if=(@step == 2)>b</p>`, "else-if"],
    ["two `class=`", `        <p class="a" class="b">c</p>`, "class"],
    ["`class` / `CLASS` (HTML names are case-insensitive)", `        <p class="a" CLASS="b">c</p>`, "CLASS"],
    ["two `id=`", `        <p id="a" id="b">c</p>`, "id"],
    ["two `onclick=`", `        <button onclick=go(1) onclick=go(2)>b</button>`, "onclick"],
    ["two `title=` (bound)", `        <p title=(@step) title=(@step)>t</p>`, "title"],
    ["two `show=`", `        <p show=@ok show=(@step == 2)>s</p>`, "show"],
  ];
  for (const [label, body, name] of CASES) {
    test(label, () => {
      const t = twice(prog(body));
      expect(t.length).toBe(1);
      expect(t[0].message).toContain("`" + name + "` is written twice");
    });
  }
  test("three of one name → one refusal per repeat", () => {
    expect(twice(prog(`        <p class="a" class="b" class="c">c</p>`)).length).toBe(2);
  });
  test("the refusal points at the repeat, not the first", () => {
    const src = prog(`        <p class="a" class="b">c</p>`);
    const d = twice(src)[0];
    expect(src.slice(d.span.start, d.span.end)).toBe(`class="b"`);
  });
});

describe("other openers take the same check", () => {
  test("`<program reset=\"none\" reset=\"none\">`", () => {
    const t = twice(`<program reset="none" reset="none">\n    <main><p>x</p></main>\n</program>\n`);
    expect(t.length).toBe(1);
    expect(t[0].message).toContain("`<program>`");
  });
  test("a state-child of a declaration", () => {
    const src = `<program>
    <phase:enum={ A, B }=.A>
        <A title="x" title="y">a</A>
        <B>b</B>
    </phase>
    <main><phase/></main>
</program>
`;
    expect(twice(src).length).toBe(1);
  });
  test("a `<*x>` reference", () => {
    const src = prog(`        <*step a="1" a="2"/>`);
    expect(twice(src).length).toBe(1);
  });
});

describe("distinct attributes are not repeats", () => {
  test("`class=` + `class:active=` are distinct names (no repeat refusal)", () => {
    // `class:` itself is not in the bootstrap (refused on its own); what
    // matters here is that the pair is not read as a repeat
    expect(twice(prog(`        <p class="a" class:active=@ok>c</p>`))).toEqual([]);
  });
  test("an ordinary element with distinct attributes is clean", () => {
    expect(diags(prog(`        <p id="a" class="b" title=(@step) if=@ok show=(@step == 1)>c</p>`))).toEqual([]);
  });
});

describe("a declaration opener: a presence validator is one predicate whatever its argument", () => {
  const decl = (words) => `<program>\n    let <name:string="" ${words}/>\n    <main><p>x</p></main>\n</program>\n`;
  for (const words of [`req req`, `req req("m")`, `req("m") req`, `req("a") req("b")`]) {
    test(`\`${words}\` → \`req\` is a repeat`, () => {
      const t = twice(decl(words));
      expect(t.length).toBe(1);
      expect(t[0].message).toContain("`req` is written twice");
    });
  }
  test("`is some is some` → refused as a repeat (the bootstrap reads `is` / `some` as words)", () => {
    expect(twice(decl(`is some is some`)).length).toBeGreaterThanOrEqual(1);
  });
  test("`length(>2) length(<9)` — a conjunction (§55.12), legal", () => {
    expect(diags(decl(`length(>2) length(<9)`))).toEqual([]);
  });
});
