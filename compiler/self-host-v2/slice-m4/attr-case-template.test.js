// attr-case-template.test.js — s451 fix round (S239 review of 40902674c).
//
// MED: a case variant of a scrml control attribute (`SHOW=`, `If=`, `ELSE`,
// `Else-If=`, `onClick=`, `BIND:value`) fell through to a plain HTML attribute
// and did nothing — every reader matches names exactly. The SPEC names no rule
// for attribute-name case (§4, §5, §24 searched), so on every element that is
// not a USE, and on `<program>`, a case variant is refused
// (E-BOOTSTRAP-UNSUPPORTED). `ref=` (§6.7.1a) is not in the bootstrap and was
// emitted as a plain attribute — refused on an HTML element.
// LOW-1: case folding applies to HTML elements and `<program>` only — a use's
// attribute names are its declaration's (case-sensitive) field names.
// LOW-2: §5.5.3 "The `${...}` interpolation inside a quoted attribute value
// SHALL be recognized by the compiler" — the bootstrap emitted it literally;
// not implemented → refused.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const msgs = (src) => run(src).diags.map((d) => `${d.code}: ${d.message}`);
const DOLLAR = "$";

const prog = (body, extra = "") => `<program>
    let <step:number=1/>
    let <ok:boolean=true/>
    let <label:string="a"/>
    function go(n: number) { @step = n }
${extra}
    <main>
${body}
    </main>
</program>
`;

describe("MED — a case variant of a scrml control attribute is refused, never a plain HTML attribute", () => {
  const CASES = [
    `<p SHOW=(@step == 1)>x</p>`,
    `<p Show=(@step == 1)>x</p>`,
    `<p If=(@step == 1)>x</p>`,
    `<p if=@ok>a</p>\n        <p ELSE>b</p>`,
    `<p if=@ok>a</p>\n        <p Else-If=(@step == 2)>b</p>`,
    `<button onClick=go(2)>b</button>`,
    `<input BIND:value=@label/>`,
    `<p Class:on=@ok>x</p>`,
    `<p REF=@label>x</p>`,
  ];
  for (const body of CASES) {
    test(body.split("\n").pop().trim(), () => {
      const c = codes(prog(`        ${body}`));
      expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
    });
  }
  test("the refusal names the exact spelling to write", () => {
    expect(msgs(prog(`        <p SHOW=(@step == 1)>x</p>`)).join("\n")).toContain("case variant of the scrml attribute `show`");
  });
  test("exact `ref=` on an HTML element is refused (it was a plain `ref` attribute)", () => {
    expect(msgs(prog(`        <p ref=@label>x</p>`)).join("\n")).toContain("`ref=` on `<p>`");
  });
  test("on `<*x>` and `<slot>` too (they read no attributes)", () => {
    const D = `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card"><slot IF=@ok/></b>
`;
    expect(codes(prog(`        <card>x</card>`, D))).toContain("E-BOOTSTRAP-UNSUPPORTED");
    // s462 (O18 RULED, SPEC §66.6.9 rule 3): `If` is no chain attribute — on a `<*x>` reference it is undeclared
    expect(codes(prog(`        <*card If=@ok/>`, D.replace("<slot IF=@ok/>", "c")))).toEqual(["E-DECL-USE-ATTR"]);
  });
  test("ordinary mixed-case HTML attributes stay legal", async () => {
    const src = prog(`        <p id="m" tabIndex="1" Title="t">x</p>`);
    expect(codes(src)).toEqual([]);
    await loadProgram(run(src).core, "case-legal");
    expect(document.querySelector("#m").getAttribute("title")).toBe("t");
  });
});

describe("`<program>`: a case variant of a program / control attribute is refused (was W-ATTR-001 only)", () => {
  const P = (attrs) => `<program ${attrs}>\n    <main><p>x</p></main>\n</program>\n`;
  test("`RESET=\"none\"`", () => { expect(codes(P(`RESET="none"`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]); });
  test("`reset` + `RESET` (a case-variant repeat)", () => { expect(codes(P(`reset="none" RESET="none"`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]); });
  test("`loginredirect=` (the name is `loginRedirect`)", () => { expect(codes(P(`loginredirect="/x"`))).toContain("E-BOOTSTRAP-UNSUPPORTED"); });
  test("`SHOW=`", () => { expect(codes(P(`SHOW=(1 == 1)`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]); });
  test("an unknown name stays W-ATTR-001 (§52.13.3)", () => { expect(codes(P(`foo="x"`))).toEqual(["W-ATTR-001"]); });
});

describe("HTML elements: names equal up to case are one attribute", () => {
  test("`class` + `CLASS` → a repeat", () => {
    expect(msgs(prog(`        <p class="a" CLASS="b">c</p>`)).join("\n")).toContain("`CLASS` is written twice");
  });
});

describe("LOW-1 — a use's attribute names are case-sensitive field names", () => {
  test("fields `a` and `A` are distinct; `<card a=\"1\" A=\"2\"/>` is clean", async () => {
    const src = prog(`        <card a="1" A="2"/>`, `    <card a:string="x" A:string="y">
        let <n:int=0/>
    </>
    renders <b id="k">\${a}-\${A}</b>
`);
    expect(msgs(src)).toEqual([]);
    await loadProgram(run(src).core, "case-use");
    expect(document.querySelector("#k").textContent).toBe("1-2");
  });
});

describe("LOW-2 — a quoted value holding `${…}` is refused, never emitted literally", () => {
  const I = DOLLAR + "{@label}";
  for (const body of [
    `<p title="t${I}">x</p>`,
    `<p style="display: ${I}">x</p>`,
    `<p class="c-${I}">x</p>`,
  ]) {
    test(body, () => {
      expect(msgs(prog(`        ${body}`)).join("\n")).toContain("interpolation");
    });
  }
  test("on a use's attribute", () => {
    const src = prog(`        <card note="n${I}"/>`, `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b>c</b>
`);
    expect(codes(src)).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("a plain quoted value (no interpolation) stays static", () => {
    expect(codes(prog(`        <p title="t $ { x }">x</p>`))).toEqual([]);
  });
});
