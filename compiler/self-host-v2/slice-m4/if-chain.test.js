// if-chain.test.js — s451: `if=` / `else-if=` / `else` chains (SPEC §17.1.1),
// compiled from source by the bootstrap front end and run in happy-dom.
//
// The defect this closes (g-bootstrap-else-if-else-attrs-ignored, HIGH): the
// bootstrap read `else` as a static HTML attribute and `else-if=(…)` as a
// bound one, so EVERY branch of a chain rendered — `#one,#two,#rest` at step 1.
//
// Governing text, §17.1.1: "An if-chain desugars to a single
// `${ if / else if / else }` block" — "Only one span exists in the DOM at any
// time." Structure: E-CTRL-001 (`else` not immediately preceded by an `if=` /
// `else-if=` element), E-CTRL-002 (the same for `else-if=`), E-CTRL-003
// (extending a chain past its `else`), E-CTRL-005 (`else` / `else-if=` on the
// `if=` element).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors, click } from "../slice-m1/load-program.js";

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
const $$ = (sel) => document.querySelectorAll(sel);
/** The ids of `sel`'s matches, in document order. */
const ids = (sel) => [...$$(sel)].map((n) => n.id).join(",");

/** A program: `body` inside `<main>`, `@step` / `@label` cells and a setter. */
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

// The brief's repro, verbatim in shape.
const THREE = prog(`        <p id="one" if=(@step == 1)>ONE \${@label}</p>
        <p id="two" else-if=(@step == 2)>TWO \${@label}</p>
        <p id="rest" else>REST \${@label}</p>`);

describe("§17.1.1 — exactly the first true branch is in the DOM, reactively", () => {
  let program;
  beforeAll(async () => { ({ program } = await loadProgram(clean(THREE), "chain-three", ["go", "relabel"])); });

  test("step 1 → only #one exists (not hidden — absent)", () => {
    expect(ids("main p")).toBe("one");
    expect($$("#two").length).toBe(0);
    expect($$("#rest").length).toBe(0);
    expect($$("main p")[0].textContent).toBe("ONE alpha");
  });
  test("step 2 → only #two", () => {
    program.go(2);
    expect(ids("main p")).toBe("two");
    expect($$("#two")[0].textContent).toBe("TWO alpha");
  });
  test("step 3 → only #rest (the `else`)", () => {
    program.go(3);
    expect(ids("main p")).toBe("rest");
  });
  test("an interpolation inside the mounted branch stays reactive", () => {
    program.relabel("beta");
    expect($$("#rest")[0].textContent).toBe("REST beta");
  });
  test("back to step 1 → #one again, #rest removed", () => {
    program.go(1);
    expect(ids("main p")).toBe("one");
    expect($$("#one")[0].textContent).toBe("ONE beta");
  });
  test("the structural attributes are consumed — none reaches the DOM", () => {
    for (const n of [1, 2, 3]) {
      program.go(n);
      const p = $$("main p")[0];
      expect(p.hasAttribute("if")).toBe(false);
      expect(p.hasAttribute("else-if")).toBe(false);
      expect(p.hasAttribute("else")).toBe(false);
    }
  });
});

describe("the chain is ONE conditional (one View.Cond, arms in declaration order)", () => {
  test("Core: the three members are the three arms of a single Cond", () => {
    const core = clean(THREE);
    const conds = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      if (n.variant === "Cond") conds.push(n);
      Object.values(n).forEach(walk);
    };
    walk(core);
    expect(conds.length).toBe(1);
    expect(conds[0].data.arms.length).toBe(3);
  });
});

describe("chains without an `else`, several chains, chains in nested markup", () => {
  test("if / else-if with no else: nothing renders when no condition holds", async () => {
    const src = prog(`        <p id="a" if=(@step == 1)>A</p>
        <p id="b" else-if=(@step == 2)>B</p>
        <p id="tail">tail</p>`);
    const { program } = await loadProgram(clean(src), "chain-noelse", ["go"]);
    expect(ids("main p")).toBe("a,tail");
    program.go(2);
    expect(ids("main p")).toBe("b,tail");
    program.go(9);
    expect(ids("main p")).toBe("tail");
  });
  test("an `if=` after an `else` opens a NEW chain (no E-CTRL-003)", async () => {
    const src = prog(`        <p id="a" if=(@step == 1)>A</p>
        <p id="b" else>B</p>
        <p id="c" if=(@step == 2)>C</p>
        <p id="d" else>D</p>`);
    const { program } = await loadProgram(clean(src), "chain-two", ["go"]);
    expect(ids("main p")).toBe("a,d");
    program.go(2);
    expect(ids("main p")).toBe("b,c");
    program.go(3);
    expect(ids("main p")).toBe("b,d");
  });
  test("a chain inside nested markup, between static siblings", async () => {
    const src = prog(`        <section>
            <h2 id="h">head</h2>
            <span id="x" if=(@step > 1)>big</span>
            <span id="y" else>small</span>
            <i id="z">after</i>
        </section>`);
    const { program } = await loadProgram(clean(src), "chain-nested", ["go"]);
    expect(ids("section > *")).toBe("h,y,z");
    program.go(5);
    expect(ids("section > *")).toBe("h,x,z");
  });
  test("a member may be a USE of a declaration (§17.1.1: \"any HTML element or component\")", async () => {
    const src = prog(`        <card if=(@step == 1)/>
        <p id="v" else>no card</p>`, `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card">card</b>
`);
    const { program } = await loadProgram(clean(src), "chain-use", ["go"]);
    expect($$("main b.card").length).toBe(1);
    expect($$("#v").length).toBe(0);
    program.go(2);
    expect($$("main b.card").length).toBe(0);
    expect($$("#v").length).toBe(1);
  });
});

describe("§17.1.1 structure diagnostics", () => {
  test("E-CTRL-001 — `else` after a plain element (§17 Worked Example 2)", () => {
    expect(codes(prog(`        <p>Static content</p>
        <span else>Fallback</span>`))).toEqual(["E-CTRL-001"]);
  });
  test("E-CTRL-001 — `else` first in its parent", () => {
    expect(codes(prog(`        <span else>Fallback</span>`))).toEqual(["E-CTRL-001"]);
  });
  test("E-CTRL-002 — `else-if=` with no preceding `if=`", () => {
    expect(codes(prog(`        <p>x</p>
        <p else-if=(@step == 1)>One</p>`))).toEqual(["E-CTRL-002"]);
  });
  test("E-CTRL-003 — extending a chain past its `else` (§17 Worked Example 5); 001 co-fires", () => {
    const c = codes(prog(`        <span if=(@step == 1)>Admin panel</span>
        <span else>User view</span>
        <span else>Guest view</span>`));
    expect(c).toContain("E-CTRL-003");
    expect(c).toContain("E-CTRL-001");
    expect(c).not.toContain("E-CTRL-005");
  });
  test("E-CTRL-003 — an `else-if=` after the `else`; 002 co-fires", () => {
    const c = codes(prog(`        <span if=(@step == 1)>a</span>
        <span else>b</span>
        <span else-if=(@step == 2)>c</span>`));
    expect(c).toContain("E-CTRL-003");
    expect(c).toContain("E-CTRL-002");
  });
  test("E-CTRL-005 — `if=` and `else` on the same element", () => {
    expect(codes(prog(`        <span if=(@step == 1) else>Welcome back</span>`))).toEqual(["E-CTRL-005"]);
  });
  test("E-CTRL-005 — `if=` and `else-if=` on the same element", () => {
    expect(codes(prog(`        <span if=(@step == 1) else-if=(@step == 2)>x</span>`))).toEqual(["E-CTRL-005"]);
  });
  test("whitespace between members does not break a chain; text does", () => {
    expect(codes(prog(`        <p if=(@step == 1)>a</p>

        <p else>b</p>`))).toEqual([]);
    expect(codes(prog(`        <p if=(@step == 1)>a</p>
        words
        <p else>b</p>`))).toEqual(["E-CTRL-001"]);
  });
  test("an interpolation between members breaks the chain", () => {
    expect(codes(prog(`        <p if=(@step == 1)>a</p>\${@label}<p else>b</p>`))).toEqual(["E-CTRL-001"]);
  });
  test("a chain does not reach across a parent boundary", () => {
    expect(codes(prog(`        <p if=(@step == 1)>a</p>
        <div><p else>b</p></div>`))).toEqual(["E-CTRL-001"]);
  });
  test("the well-formed chains compile clean (no co-fires)", () => {
    expect(codes(THREE)).toEqual([]);
  });
});

describe("fail closed — what the bootstrap cannot honor is refused, never rendered unconditionally", () => {
  const refused = (src) => {
    const c = codes(src);
    expect(c).toContain("E-BOOTSTRAP-UNSUPPORTED");
  };
  test("a quoted `if=` condition (it used to render the element always)", () => {
    refused(prog(`        <p if="@step == 1">a</p>`));
  });
  test("a valueless `if`", () => {
    refused(prog(`        <p if>a</p>`));
  });
  test("a quoted `else-if=` condition", () => {
    refused(prog(`        <p if=(@step == 1)>a</p>
        <p else-if="@step == 2">b</p>`));
  });
  test("`else` with a value", () => {
    refused(prog(`        <p if=(@step == 1)>a</p>
        <p else=(@step == 2)>b</p>`));
  });
  test("`else` and `else-if=` on one element", () => {
    refused(prog(`        <p if=(@step == 1)>a</p>
        <p else-if=(@step == 2) else>b</p>`));
  });
  test("`if=` on a `<*x/>` reference (it used to be ignored)", () => {
    refused(prog(`        <*card if=(@step == 1)/>`, `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card">card</b>
`));
  });
  test("`else` on a `<*x/>` reference", () => {
    refused(prog(`        <p if=(@step == 1)>a</p>
        <*card else/>`, `    <card note:string="n">
        let <x:int=0/>
    </>
    renders <b class="card">card</b>
`));
  });
  test("`else` on `<each>`", () => {
    refused(prog(`        <p if=(@step == 1)>a</p>
        <each in=[1, 2] else><i>\${item}</i></each>`));
  });
});
