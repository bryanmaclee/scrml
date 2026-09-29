// review-r1.test.js — the s442 fix round r1 (two adversarial reviews of
// 5ceef638): one test per finding, each written so the finding's original
// behaviour fails it. The findings are listed in
// docs/changes/s442-bootstrap-six-programs/progress.md ("FIX ROUND r1").

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd, replaceLine } from "./harness.js";
import { auditFixture } from "./fixtures.js";
import { loadProgram, click, expectNoPageErrors, instancesOf } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const E = '{ at: 1, actor: "a", action: "b" }';
const withFn = (fn, type) => {
  let s = auditFixture();
  if (type) s = s.replace("<audit:Entry[free, end]=[]/>", type);
  return s.replace("function record(action: string) {", fn + "\n    function record(action: string) {");
};
const rows = () => [...document.querySelectorAll("main > ul > li")].map((li) => li.textContent);
const P = (decls, main) => `<program>\n    type Phase:enum = { Idle, Loading, Done }\n    <let n:int=5/>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;

// ---------------------------------------------------------------------------
describe("F1 — a sequence shape / edit call on a LOCAL is never deleted", () => {
  test("`s = [...s, e]` on a `let` local: refused (Core has no spread value), never compiled to nothing", () => {
    expect(codes(withFn(`function lp() -> int {\n let s = @audit\n s = [...s, ${E}]\n return s.length\n }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("the same on a `const` local keeps E-ASSIGN-CONST", () => {
    expect(codes(withFn(`function lp() -> int {\n const s = @audit\n s = [...s, ${E}]\n return s.length\n }`))).toContain("E-ASSIGN-CONST");
  });
  test("`s = s.filter(…)` on a local, and a parameter: refused", () => {
    expect(codes(withFn(`function lp() -> int {\n let s = @audit\n s = s.filter(e => false)\n return s.length\n }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(withFn(`function lp(s: Entry[free, end]) -> int {\n s = [...s, ${E}]\n return s.length\n }`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("`s.push(e)` / `s.shift()` / `s[0].f = v` on a local: refused (a diagnostic each), not dropped", () => {
    expect(codes(withFn(`function lp() {\n let s = @audit\n s.push(${E})\n }`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
    expect(codes(withFn(`function lp() {\n let s = @audit\n s.shift()\n }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(withFn(`function lp() {\n let s = @audit\n s[0].action = "x"\n }`)).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("F2 / O55 — a plain use of a `single` declaration", () => {
  const card = (main) => P(`    <card title:string="x" single>\n        <k:int=0/>\n    </>\n    renders <article>\${title}</article>`, main);
  test("two plain uses → E-DECL-SINGLE-INSTANTIATED each", () => {
    expect(codes(card(`        <card title="One"/>\n        <card title="Two"/>`))).toEqual(["E-DECL-SINGLE-INSTANTIATED", "E-DECL-SINGLE-INSTANTIATED"]);
  });
  test("`<*card/>` renders the one instance", () => {
    expect(codes(card(`        <*card/>`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("F3 — a `:`-shorthand body and `>`", () => {
  test("`<p : @n >= 3>` renders the comparison (a `>=` never ends the opener)", async () => {
    const r = run(P("", `        <p : @n >= 3>\n        <b>end</b>`));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r1-ge");
    expect(document.querySelector("main").innerHTML).toBe("<p>true</p><b>end</b>");
  });
  test("a bare `>` comparison → E-PARSE-SHORTHAND-GT (parenthesize); the tail is never page text", () => {
    for (const body of ["@n > 3", "@n>3", "@n > 3 ? \"big\" : \"small\""]) {
      expect(codes(P("", `        <p : ${body}>\n        <b>end</b>`))).toEqual(["E-PARSE-SHORTHAND-GT"]);
    }
  });
  test("parenthesized, it is the comparison", async () => {
    const r = run(P("", `        <p : (@n > 3)>`));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r1-gt-paren");
    expect(document.querySelector("main > p").textContent).toBe("true");
  });
  test("nits: a closer right after a shorthand is E-CLOSER-001 alone; markup-as-value is its body; an empty body is one diagnostic", async () => {
    expect(codes(P("", `        <p : @n></>`))).toEqual(["E-CLOSER-001"]);
    expect(codes(P("", `        <p : >`))).toEqual(["E-PARSE-SHORTHAND"]);
    const r = run(P("", `        <div : <p : "x">>\n        <b>end</b>`));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r1-mav");
    expect(document.querySelector("main").innerHTML).toBe("<div><p>x</p></div><b>end</b>");
  });
});

// ---------------------------------------------------------------------------
describe("F4 — a state-child body is CODE-DEFAULT (§4.18.1)", () => {
  const phase = (idle) => P(`    <phase:Phase=.Idle single>\n        <Idle rule=.Loading>${idle}</>\n        <Loading rule=.Done : "L">\n        <Done rule=.Idle : "D">\n    </>`, `        <p><*phase/></p>`);
  test("`\"Ready\"` is a display-text literal: renders Ready (no quotes)", async () => {
    const r = run(phase(`"Ready"`));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r1-cd-lit");
    expect(document.querySelector("main > p").textContent).toBe("Ready");
  });
  test("bare prose `Ready now` → E-UNQUOTED-DISPLAY-TEXT (suggesting the quoted literal)", () => {
    const d = run(phase("Ready now")).diags;
    expect(d.map((x) => x.code)).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
    expect(d[0].message).toContain('"Ready now"');
  });
  test("a nested element keeps its own free-text body; `${…}` is an interpolation", async () => {
    const r = run(phase(`<b>two words</b> \${@n}`));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r1-cd-nested");
    // whitespace between a code body's items is not display text (§4.18.2)
    expect(document.querySelector("main > p").textContent).toBe("two words5");
  });
  test("the same for a user declaration's child-field state-children", () => {
    const src = P(`    <card title:string>\n        <status:Phase=.Idle>\n            <Idle rule=.Loading>Idle text</>\n            <Loading rule=.Done : "L">\n            <Done rule=.Idle : "D">\n        </>\n    </>\n    renders <article><*status/></article>`, `        <card title="a"/>`);
    expect(codes(src)).toEqual(["E-UNQUOTED-DISPLAY-TEXT"]);
  });
  test("nit: a duplicate state-child → E-DECL-STATE-CHILD", () => {
    const src = P(`    <phase:Phase=.Idle single>\n        <Idle rule=.Loading : "a">\n        <Idle rule=.Done : "b">\n        <Loading rule=.Done : "L">\n        <Done rule=.Idle : "D">\n    </>`, `        <p><*phase/></p>`);
    expect(codes(src)).toEqual(["E-DECL-STATE-CHILD"]);
  });
});

// ---------------------------------------------------------------------------
describe("F5 / F6 — a sequence shape is ONE value: its elements are evaluated left to right before any write", () => {
  const fns = `function mk(s: string) -> Entry {
        @actor = s
        const e: Entry = { at: 0, actor: @actor, action: s }
        return e
    }
    function app() { @audit = [...@audit, { at: @audit.length, actor: "p", action: "one" }, { at: @audit.length, actor: "q", action: "two" }] }
    function pre() { @audit = [mk("a"), mk("b"), ...@audit] }`;
  let program;
  beforeAll(async () => {
    const src = withFn(fns, "<audit:Entry[free, end, front]=[]/>").replace("<li>${e.actor}: ${e.action}</li>", "<li>${e.actor}: ${e.action} @${e.at}</li>");
    const r = run(src);
    expect(r.diags).toEqual([]);
    ({ program } = await loadProgram(r.core, "r1-order", ["app", "pre", "record"]));
  });
  test("F6: `[mk(\"a\"), mk(\"b\"), ...@audit]` runs mk(a) then mk(b) — the actor is left at b — and reads a, b", () => {
    program.pre();
    expect(rows()).toEqual(["a: a @0", "b: b @0"]);
    program.record("z");
    expect(rows()[2]).toBe("b: z @0");
  });
  test("F5: both elements read the SAME @audit.length (evaluated before either append)", () => {
    program.app();
    expect(rows().slice(3)).toEqual(["p: one @3", "q: two @3"]);
  });
});

// ---------------------------------------------------------------------------
describe("nits — type error on a non-sequence, `<*field/>` out of scope", () => {
  test("`@phase = [...@phase, .Done]` on an enum cell → E-TYPE-031", () => {
    const src = P(`    <let ph:Phase=.Idle/>\n    function x() { @ph = [...@ph, .Done] }`, `        <p>x</p>`);
    expect(codes(src)).toEqual(["E-TYPE-031"]);
  });
  test("`<*status/>` at program level names the declaration that owns `status` (E-SCOPE-001), not an HTML element", () => {
    const src = P(`    <card title:string="S">\n        <status:Phase=.Idle>\n            <Idle rule=.Loading/>\n            <Loading rule=.Done/>\n            <Done rule=.Idle/>\n        </>\n    </>\n    renders <article>x</article>`, `        <p><*status/></p>`);
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-SCOPE-001"]);
    expect(d[0].message).toContain("<card>");
  });
});

// ---------------------------------------------------------------------------
// G1 — the guards that carry `<*x/>` soundness (resolveStarShared / resolveStarField)
describe("G1 — `<*x/>` guards", () => {
  const box = (renders, main, extra = "") => `<program>\n    <item label:string="i"/>\n    renders <i>\${label}</i>\n    <box note:string="n"${extra}>\n        <let v:int=0/>\n    </>\n    renders ${renders}\n    <main>\n${main}\n    </main>\n</program>\n`;
  test("constructs-nothing: `<*box/>` whose renders USES a declaration is refused (Core has no View.Star)", () => {
    const d = run(box(`<div><item/></div>`, `        <*box/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("constructs instances");
  });
  test("program top level only: `<*item/>` inside another declaration's renders is refused", () => {
    const d = run(box(`<div><*item/></div>`, `        <box/>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("inside a declaration's `renders`");
  });
  test("no renders: `<*x/>` of a declaration with no markup is refused naming O51", () => {
    const src = `<program>\n    <plain note:string="n"/>\n    <main>\n        <*plain/>\n    </main>\n</program>\n`;
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("O51");
  });
  test("an attribute on `<*f/>` of a field → E-DECL-STAR-REF-ATTR-WRITE", () => {
    const src = P(`    <phase:Phase=.Idle single>\n        <Idle rule=.Loading : "I">\n        <Loading rule=.Done : "L">\n        <Done rule=.Idle : "D">\n    </>`, `        <p><*phase x="1"/></p>`);
    expect(codes(src)).toEqual(["E-DECL-STAR-REF-ATTR-WRITE"]);
  });
});

// ---------------------------------------------------------------------------
describe("G2 / G3 — OPEN items refused, not decided", () => {
  test("G2 (O19): an own value AND attributes — nested in <program> and at file level — refused naming O19", () => {
    const nested = `<program>\n    <count:int=0 step:int=1/>\n    <main><p>x</p></main>\n</program>\n`;
    const d = run(nested).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("O19");
    const file = `<count:int=0 step:int=1/>\n<program>\n    <main><p>x</p></main>\n</program>\n`;
    const d2 = run(file).diags;
    expect(d2.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d2[0].message).toContain("O19");
  });
  test("G3 (O33): `<*card/>` where `card` has an attribute with no default → refused at COMPILE time naming O33", () => {
    const src = `<program>\n    <card title:string/>\n    renders <article>\${title}</article>\n    <main>\n        <*card/>\n    </main>\n</program>\n`;
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("O33");
  });
});
