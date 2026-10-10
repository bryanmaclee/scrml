// show.test.js — s451: `show=` (SPEC §17.2), compiled from source by the
// bootstrap front end and run in happy-dom.
//
// The defect this closes (S239 review of #1254, HIGH): `show=` did nothing —
// the bootstrap read it as a plain bound attribute, so `<p show=(@step == 2)>`
// rendered VISIBLE at step 1 and grew a meaningless `show=""` attribute at
// step 2.
//
// Governing text, §17.2: "The element EXISTS in the DOM regardless of `expr`.
// When `expr` evaluates to false, the element is hidden. The compiler
// generates a CSS `display: none` toggle. When `expr` evaluates to true, the
// element is visible. `show=` is distinct from `if=`: `show=` hides, `if=`
// removes." §17.1.1: "`if=`, `else-if=`, and `else` MAY coexist on the same
// element with `show=` … the element is first conditionally included in the
// DOM by the if-chain rule and then additionally subject to the `show=`
// visibility rule (§17.2). The two attributes compose without conflict."
// §5.5.4 / E-ATTR-WRITER-CONFLICT: a wholesale `style=(expr)` "with
// `if=`/`show=`" shares the display surface. §17.1 / §5.2: the condition
// rules of `if=` apply to `show=` (here: the typer's E-COND-NOT-BOOLEAN; a
// quoted / valueless condition is refused, as for `if=`).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
/** Hidden by `show=`: in the DOM with inline `display: none`. */
const hidden = (sel) => $(sel) !== null && $(sel).style.display === "none";
const visible = (sel) => $(sel) !== null && $(sel).style.display !== "none";

const prog = (body, extra = "") => `<program>
    let <step:number=1/>
    let <label:string="alpha"/>
    function go(n: number) { @step = n }
    function relabel(s: string) { @label = s }
${extra}
    <main>
${body}
    </main>
</program>
`;

const CARD = `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card">card</b>
`;

describe("§17.2 — the element stays in the DOM; `display: none` while false", () => {
  let program;
  beforeAll(async () => {
    ({ program } = await loadProgram(clean(prog(`        <p id="s" show=(@step == 2)>S \${@label}</p>`)), "show-basic", ["go", "relabel"]));
  });
  test("step 1 → #s exists and is hidden (the brief's repro: it was visible)", () => {
    expect($$("#s").length).toBe(1);
    expect(hidden("#s")).toBe(true);
  });
  test("step 2 → #s visible", () => {
    program.go(2);
    expect(visible("#s")).toBe(true);
    expect($("#s").textContent).toBe("S alpha");
  });
  test("no `show` attribute reaches the DOM (it rendered `show=\"\"`)", () => {
    expect($("#s").hasAttribute("show")).toBe(false);
  });
  test("back to step 1 → hidden again; the SAME node (not re-created)", () => {
    const node = $("#s");
    program.go(1);
    expect($("#s")).toBe(node);
    expect(hidden("#s")).toBe(true);
  });
  test("its content stays reactive while hidden", () => {
    program.relabel("beta");
    expect($("#s").textContent).toBe("S beta");
    program.go(2);
    expect(visible("#s")).toBe(true);
  });
});

describe("show= keeps the element's own inline display", () => {
  test("static `style=\"display: flex\"` → flex when shown, none when hidden", async () => {
    const { program } = await loadProgram(clean(prog(`        <div id="f" style="display: flex; color: red" show=(@step == 1)>f</div>`)), "show-style", ["go"]);
    expect($("#f").style.display).toBe("flex");
    program.go(2);
    expect($("#f").style.display).toBe("none");
    expect($("#f").style.color).toBe("red");
    program.go(1);
    expect($("#f").style.display).toBe("flex");
  });
  test("no inline display → shown means no inline display set", async () => {
    const { program } = await loadProgram(clean(prog(`        <p id="n" show=(@step == 1)>n</p>`)), "show-none", ["go"]);
    expect($("#n").style.display).toBe("");
    program.go(2);
    expect($("#n").style.display).toBe("none");
  });
});

describe("§17.1.1 — show= composes with if= / else-if= / else", () => {
  test("if= + show= on one element: absent / hidden / visible", async () => {
    const { program } = await loadProgram(clean(prog(`        <p id="c" if=(@step != 3) show=(@step == 1)>C</p>`)), "show-if", ["go"]);
    expect(visible("#c")).toBe(true);      // present, shown
    program.go(2);
    expect(hidden("#c")).toBe(true);       // present, hidden
    program.go(3);
    expect($$("#c").length).toBe(0);      // removed (if=)
    program.go(1);
    expect(visible("#c")).toBe(true);
  });
  test("an if-chain whose members carry show=", async () => {
    const src = prog(`        <p id="a" if=(@step == 1) show=(@label == "alpha")>A</p>
        <p id="b" else-if=(@step == 2) show=(@label == "alpha")>B</p>
        <p id="z" else show=(@label != "alpha")>Z</p>`);
    const { program } = await loadProgram(clean(src), "show-chain", ["go", "relabel"]);
    expect([...$$("main p")].map((n) => n.id).join(",")).toBe("a");
    expect(visible("#a")).toBe(true);
    program.relabel("beta");
    expect(hidden("#a")).toBe(true);
    program.go(2);
    expect([...$$("main p")].map((n) => n.id).join(",")).toBe("b");
    expect(hidden("#b")).toBe(true);
    program.relabel("alpha");
    expect(visible("#b")).toBe(true);
    program.go(3);
    expect([...$$("main p")].map((n) => n.id).join(",")).toBe("z");
    expect(hidden("#z")).toBe(true);
    program.relabel("gamma");
    expect(visible("#z")).toBe(true);
  });
  test("a show= element nested inside an if= element", async () => {
    const { program } = await loadProgram(clean(prog(`        <section if=(@step < 3)><p id="i" show=(@step == 2)>i</p></section>`)), "show-nested", ["go"]);
    expect(hidden("#i")).toBe(true);
    program.go(2);
    expect(visible("#i")).toBe(true);
    program.go(3);
    expect($$("#i").length).toBe(0);
    program.go(2);
    expect(visible("#i")).toBe(true);
  });
});

describe("the condition is judged like if=", () => {
  test("a non-boolean condition → E-COND-NOT-BOOLEAN (no truthiness)", () => {
    expect(codes(prog(`        <p show=(@step)>x</p>`))).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("a valueless `show` → refused (it would never hide)", () => {
    expect(codes(prog(`        <p show>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a quoted condition → refused (as for if=)", () => {
    expect(codes(prog(`        <p show="@step == 1">x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("an unresolved name → reported", () => {
    expect(codes(prog(`        <p show=@nope>x</p>`)).length).toBeGreaterThan(0);
  });
});

describe("§5.5.4 — a wholesale style=(expr) conflicts with show=", () => {
  test("style=(expr) + show= → E-ATTR-WRITER-CONFLICT", () => {
    expect(codes(prog(`        <p style=(@label) show=(@step == 1)>x</p>`))).toEqual(["E-ATTR-WRITER-CONFLICT"]);
  });
  test("a static style= composes (no conflict)", () => {
    expect(codes(prog(`        <p style="color: red" show=(@step == 1)>x</p>`))).toEqual([]);
  });
});

describe("show= on a host the bootstrap cannot toggle is refused, never ignored", () => {
  // s462 (O18 RULED, SPEC §66.6.9 rules 2-3): a use is not an element — `show=` there is an undeclared
  // attribute, E-DECL-USE-ATTR (was E-BOOTSTRAP-UNSUPPORTED); the message keeps the wrap hint.
  test("on a use of a declaration", () => {
    const d = run(prog(`        <card show=(@step == 1)/>`, CARD)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-DECL-USE-ATTR"]);
    expect(d[0].message).toContain("<div show=");
  });
  test("a declaration FIELD named `show` is a construction value, not §17.2", () => {
    const src = prog(`        <card show=true/>`, `    <card show:boolean=false>
        let <x:int=0/>
    </>
    renders <b class="card">card</b>
`);
    expect(codes(src)).toEqual([]);
  });
  test("on a `<*x/>` reference", () => {
    expect(codes(prog(`        <*card show=(@step == 1)/>`, CARD))).toEqual(["E-DECL-USE-ATTR"]);
  });
  test("on `<slot>`", () => {
    const src = prog(`        <card>x</card>`, `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card"><slot show=(@step == 1)/></b>
`);
    expect(codes(src)).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("on `<each>`", () => {
    expect(codes(prog(`        <each in=[1, 2] show=(@step == 1)><i>\${item}</i></each>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("on a state-child (any attribute but rule= was ignored there)", () => {
    const src = `<program>
    type Ph:enum = { A, B }
    <phase:Ph=.A single>
        <A show=(1 == 1) : "a">
        <B : "b">
    </>
    <main><p><*phase/></p></main>
</program>
`;
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});
