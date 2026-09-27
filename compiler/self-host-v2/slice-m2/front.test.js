// front.test.js — the bootstrap front end's DIAGNOSTICS and the S437 rulings,
// written as scrml source and run end to end (parse → analyze → lower → print →
// the slice runtime in happy-dom):
//   - every `→ E-…` comment line of §66.19.1 / §66.19.3, uncommented, produces
//     exactly that diagnostic;
//   - more §66.20 diagnostics the subset reaches;
//   - O58 (b): the spread `@x = { ...@x, f: v }` is a field edit judged by f's
//     contract; a genuine replace is authoritative;
//   - O59: construction runs in document order after the cells it reads;
//   - O60: a use-site live value SEEDS a locked field that carries a grant.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice } from "./lowered.js";
import { loadProgram, click, expectNoPageErrors, takePageErrors, instancesOf } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });
const run = (files) => frontEnd(mods, files);
const codes = (r) => r.diags.map((d) => d.code);

// ---------------------------------------------------------------------------
// The SPEC's negative lines. Each `<!-- … → E-CODE … -->` line names the code
// its uncommented form must produce; this table is how each is uncommented, and
// the first test fails if the SPEC gains a negative line the table lacks.
// ---------------------------------------------------------------------------
const NEGATIVE = [
  { file: "counter", code: "E-DERIVED-WRITE", spec: "onclick=(@doubled = 0)", as: "<button onclick=(@doubled = 0)>x</button>" },
  { file: "counter", code: "E-WRITE-NOT-GRANTED", spec: "onclick=(@step = 2)", as: "<button onclick=(@step = 2)>x</button>" },
  { file: "app", code: "E-DECL-HANDLE-NOT-NARROWED", spec: "@color.value = \"\"", as: "<button onclick=(@color.value = \"\")>x</button>" },
  { file: "app", code: "E-DECL-STAR-REF-ATTR-WRITE", spec: "<*dropdown open=.Opened/>", as: "<*dropdown open=.Opened/>" },
];

function negativeLines(src) {
  return src.split("\n").filter((l) => /<!--.*→\s*E-[A-Z-]+/.test(l));
}

function uncomment(src, spec, replacement) {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => /<!--/.test(l) && l.includes(spec) && /→\s*E-/.test(l));
  if (i < 0) throw new Error("negative line not found: " + spec);
  const indent = /^\s*/.exec(lines[i])[0];
  lines[i] = indent + replacement;
  return lines.join("\n");
}

describe("§66.19 negative lines — uncommented, each produces its diagnostic", () => {
  test("the table covers every `→ E-…` line of §66.19.1 and §66.19.3", () => {
    const counter = negativeLines(readSlice("src/counter.scrml"));
    const app = negativeLines(readSlice("src/app.scrml"));
    expect(counter.length + app.length).toBe(NEGATIVE.length);
    for (const n of NEGATIVE) {
      const lines = n.file === "counter" ? counter : app;
      const hit = lines.find((l) => l.includes(n.spec));
      expect(hit).toBeDefined();
      expect(hit).toContain(n.code);
    }
  });

  for (const n of NEGATIVE) {
    test(`${n.spec} → ${n.code}`, () => {
      const files = n.file === "counter"
        ? [{ path: "counter.scrml", src: uncomment(readSlice("src/counter.scrml"), n.spec, n.as) }]
        : [LIB(), { path: "app.scrml", src: uncomment(readSlice("src/app.scrml"), n.spec, n.as) }];
      const r = run(files);
      expect(codes(r)).toEqual([n.code]);
    });
  }

  test("E-DERIVED-WRITE's message names the `let`-seeding trade-off (§66.9 rule 5); E-WRITE-NOT-GRANTED names `let`", () => {
    const d1 = run([{ path: "c.scrml", src: uncomment(readSlice("src/counter.scrml"), NEGATIVE[0].spec, NEGATIVE[0].as) }]).diags[0];
    expect(d1.message).toContain("@count");
    expect(d1.message).toContain("declare it `let`");
    expect(d1.message).toContain("SEEDED");
    const d2 = run([{ path: "c.scrml", src: uncomment(readSlice("src/counter.scrml"), NEGATIVE[1].spec, NEGATIVE[1].as) }]).diags[0];
    expect(d2.message).toContain("let step");
  });
});

// ---------------------------------------------------------------------------
// More §66.20 diagnostics on the subset.
// ---------------------------------------------------------------------------
function withLibLine(from, to) {
  const src = readSlice("src/lib/dropdown.scrml");
  if (!src.includes(from)) throw new Error("lib line not found: " + from);
  return { path: "lib/dropdown.scrml", src: src.replace(from, to) };
}

function appWith(markup, fns = "") {
  return {
    path: "app.scrml",
    src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }\n<program>\n${fns}\n    <main>\n${markup}\n    </main>\n</program>\n`,
  };
}

describe("more §66.20 diagnostics the subset reaches", () => {
  test("E-DECL-RENDERS-BARE-WRITE — a bare projection written inside `renders` (§66.5.2)", () => {
    const lib = withLibLine("<slot/>", "<slot/>\n    <button onclick=(value = \"x\")>x</button>");
    const r = run([lib, appWith("<dropdown label=\"a\" options=([\"x\"])/>")]);
    expect(codes(r)).toEqual(["E-DECL-RENDERS-BARE-WRITE"]);
  });

  test("E-DECL-FIELD-TAG-NEEDS-STAR — a bare `<open/>` in dropdown's renders (§66.6.6)", () => {
    const lib = withLibLine("<slot/>", "<slot/>\n    <open/>");
    expect(codes(run([lib, appWith("<dropdown label=\"a\" options=([\"x\"])/>")]))).toEqual(["E-DECL-FIELD-TAG-NEEDS-STAR"]);
  });

  test("E-DECL-STAR-PREDEFINED — `<*div/>` (§66.6.5)", () => {
    expect(codes(run([LIB(), appWith("<*div/>")]))).toEqual(["E-DECL-STAR-PREDEFINED"]);
  });

  test("E-FIELD-PRIVATE-WRITE — a cross-file write to a field that is not exported (§66.14)", () => {
    const lib = withLibLine("export let value:string=\"\"", "export let value:string=\"\" let note:string=\"\"");
    const app = appWith("<dropdown as=country label=\"a\" options=([\"x\"])/>", "    function f() { @country.note = \"x\" }");
    expect(codes(run([lib, app]))).toEqual(["E-FIELD-PRIVATE-WRITE"]);
    // the same write to the EXPORTED field is fine
    expect(codes(run([lib, appWith("<dropdown as=country label=\"a\" options=([\"x\"])/>", "    function f() { @country.value = \"x\" }")]))).toEqual([]);
  });

  test("a typed parameter lowers to a typed Core Param read as a Local; an unannotated one is reported", () => {
    const app = appWith("<dropdown as=country label=\"a\" options=([\"x\"])/>", "    function setValue(v: string) { @country.value = v }");
    const r = run([LIB(), app]);
    expect(codes(r)).toEqual([]);
    const f = r.core.fns[0];
    expect(f.params.map((p) => [p.sym.hint, p.ty])).toEqual([["v", "Str"]]);
    expect(f.body.stmts[0].data.value).toEqual({ variant: "Local", data: { sym: f.params[0].sym } });
    const bad = appWith("<p>x</p>", "    function g(v) { }");
    expect(codes(run([LIB(), bad]))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("E-WRITE-NOT-GRANTED — `reset` of a field without `replace` (L4: reset IS a replace)", () => {
    const app = appWith("<p>x</p>", "    <audit:string[free, end]=([])/>\n    function f() { reset(@audit) }");
    expect(codes(run([LIB(), app]))).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});

// ---------------------------------------------------------------------------
// O58 (b): the spread is a field edit; a genuine replace is authoritative.
// ---------------------------------------------------------------------------
const DOC = `type Phase:enum = { Draft, Live, Gone, Archived }
<doc title:string>
    export <phase:Phase=.Draft>
        <Draft rule=.Live/>
        <Live rule=.Gone/>
        <Gone rule=.Live/>
    </>
</>
renders <p class="doc">\${title}: \${phase}</p>
`;

function docProgram(fns) {
  return {
    path: "doc.scrml",
    src: `${DOC}
<program>
    type P:struct = { let x: int, y: int }
    <let p:P=({ x: 0, y: 0 })/>
${fns}
    <main>
        <doc as=d title="Spec"/>
        <p class="pt">\${@p.x},\${@p.y}</p>
        <button class="publish" onclick=publish()>publish</button>
        <button class="retract" onclick=retract()>retract</button>
        <button class="bump" onclick=bumpY()>bump</button>
        <button class="replace" onclick=replaceP()>replace</button>
    </main>
</program>
`,
  };
}

const DOC_FNS = `    function publish() { @d = { ...@d, phase: .Live } }
    function retract() { @d = { ...@d, phase: .Draft } }
    function bumpY() { @p = { ...@p, y: 5 } }
    function replaceP() { @p = { x: 1, y: 2 } }`;

describe("O58 (b) — `@x = { ...@x, f: v }` is the field edit `@x.f = v`; a genuine replace is authoritative", () => {
  test("the spread lowers to field writes: a Transition on the instance's graph field, a FieldAt on the struct", () => {
    const r = run([docProgram(DOC_FNS)]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const fn = (name) => r.core.fns.find((f) => f.sym.hint === name).body.stmts;
    expect(fn("publish").map((s) => [s.variant, s.data.edit, s.data.check])).toEqual([["Write", "Transition", "RuntimeEdge"]]);
    expect(fn("bumpY").map((s) => [s.variant, s.data.edit.variant, s.data.check])).toEqual([["Write", "FieldAt", "Static"]]);
    expect(fn("replaceP").map((s) => [s.variant, s.data.edit])).toEqual([["Write", "Replace"]]);
  });

  test("a spread to a state NO write can reach (no incoming edge, not initial) is refused at compile time", () => {
    const r = run([docProgram(DOC_FNS + "\n    function archive() { @d = { ...@d, phase: .Archived } }")]);
    expect(codes(r)).toEqual(["E-ENGINE-INVALID-TRANSITION"]);
  });

  test("the spread follows the graph at runtime: along an edge it moves; off the graph it is refused", async () => {
    const r = run([docProgram(DOC_FNS)]);
    await loadProgram(r.core, "o58-doc");
    const doc = () => document.querySelector("p.doc").textContent;
    expect(doc()).toBe("Spec: Draft");
    click(document.querySelector("button.retract"));          // Draft → Draft: a self-write, a no-op
    expect(doc()).toBe("Spec: Draft");
    click(document.querySelector("button.publish"));          // Draft → Live: an edge
    expect(doc()).toBe("Spec: Live");
    expect(() => click(document.querySelector("button.retract"))).toThrow(/E-ENGINE-INVALID-TRANSITION/);
    takePageErrors();
    expect(doc()).toBe("Spec: Live");
  });

  test("a spread changing a CONTRACT-FREE field is accepted; a genuine replace is authoritative (O57 no, O58 (b))", async () => {
    const r = run([docProgram(DOC_FNS)]);
    await loadProgram(r.core, "o58-p");
    const pt = () => document.querySelector("p.pt").textContent;
    expect(pt()).toBe("0,0");
    click(document.querySelector("button.bump"));
    expect(pt()).toBe("0,5");
    click(document.querySelector("button.replace"));
    expect(pt()).toBe("1,2");
  });
});

// ---------------------------------------------------------------------------
// O59 — construction order; O60 — a use-site value seeds a granted locked field.
// ---------------------------------------------------------------------------
describe("O59 — construction runs in document order after the cells it reads", () => {
  test("a use-site initializer reading a cell declared earlier sees it (seeded once, L6); a locked one tracks", async () => {
    const app = {
      path: "app.scrml",
      src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }
<program>
    <let startCountry:string="CA"/>
    <let title:string="Country"/>
    <main>
        <dropdown as=country label=(@title) options=(["US", "CA"]) value=(@startCountry)/>
        <p class="ship">\${@country.value}</p>
        <button class="change" onclick={ @startCountry = "US"; @title = "Nation" }>change</button>
    </main>
</program>
`,
    };
    const r = run([LIB(), app]);
    expect(codes(r)).toEqual([]);
    await loadProgram(r.core, "o59-order");
    const ship = () => document.querySelector("p.ship").textContent;
    const label = () => document.querySelector("button.dropdown__toggle").textContent;
    expect(ship()).toBe("CA");
    expect(label()).toBe("Country: CA");
    click(document.querySelector("button.change"));
    expect(ship()).toBe("CA");                      // `value` is `let`: seeded once
    expect(label()).toBe("Nation: CA");             // `label` is locked: derived, tracks (L6)
  });
});

describe("O60 — a live use-site value to a LOCKED field that carries a grant SEEDS it", () => {
  const app = {
    path: "app.scrml",
    src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }
<program>
    <let startOpen:Openness=.Opened/>
    <main>
        <dropdown label="A" options=(["x", "y"]) open=(@startOpen)/>
        <button class="shut" onclick=(@startOpen = .Closed)>shut</button>
    </main>
</program>
`,
  };

  test("no E-DERIVED-WRITE: the library's own toggle stays a legal write", () => {
    const r = run([LIB(), app]);
    expect(codes(r)).toEqual([]);
    const inst = r.core.decls[1].renders[0].data.kids[0];
    expect(inst.variant).toBe("Instance");
    expect(inst.data.attrs.map((a) => a.field)).toEqual([0, 1, 3]);
  });

  test("the instance starts from @startOpen, then is its own: the toggle works and the source no longer drives it", async () => {
    const r = run([LIB(), app]);
    await loadProgram(r.core, "o60-seed");
    const menus = () => document.querySelectorAll("ul.dropdown__menu").length;
    expect(menus()).toBe(1);                                  // seeded .Opened
    click(document.querySelector("button.dropdown__toggle"));
    expect(menus()).toBe(0);                                  // the toggle's transition wrote it
    click(document.querySelector("button.dropdown__toggle"));
    expect(menus()).toBe(1);
    click(document.querySelector("button.shut"));             // writing the source does not re-drive a seed
    expect(menus()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F-B (review): `reset` restores THAT INSTANCE's initializer (L4 + L6 / §66.9).
// ---------------------------------------------------------------------------
describe("F-B — reset(@box.v) restores the instance's own initializer (D15 InitOf)", () => {
  const src = `<box export let v:string="init"/>
renders <p class="box"><span>\${v}</span><button class="set" onclick=(@box.v = "changed")>s</button><button class="reset" onclick=reset(@box.v)>r</button></p>

<program>
    <let src:string="live1"/>
    <main>
        <box v="start"/>
        <box/>
        <box v=(@src)/>
        <button class="src" onclick=(@src = "live2")>src</button>
    </main>
</program>
`;

  test("lowers to Write(.Replace, InitOf(box, Lexical(0), v))", () => {
    const r = run([{ path: "box.scrml", src }]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const text = JSON.stringify(r.core);
    expect(text).toContain('"variant":"InitOf"');
  });

  test("use-site value restored; declared default restored; a LIVE-seeded `let` re-evaluates its initializer", async () => {
    const r = run([{ path: "box.scrml", src }]);
    await loadProgram(r.core, "fb-reset");
    const boxes = () => [...document.querySelectorAll("p.box")];
    const val = (i) => boxes()[i].querySelector("span").textContent;
    const btn = (i, cls) => boxes()[i].querySelector("button." + cls);
    expect([val(0), val(1), val(2)]).toEqual(["start", "init", "live1"]);
    click(document.querySelector("button.src"));              // @src = "live2": a seeded `let` does not follow
    expect(val(2)).toBe("live1");
    for (const i of [0, 1, 2]) click(btn(i, "set"));
    expect([val(0), val(1), val(2)]).toEqual(["changed", "changed", "changed"]);
    click(btn(0, "reset"));
    click(btn(1, "reset"));
    click(btn(2, "reset"));
    expect(val(0)).toBe("start");       // the use-site value — NOT the declaration's "init"
    expect(val(1)).toBe("init");        // no use-site value: the declared default
    expect(val(2)).toBe("live2");       // its initializer `(@src)` re-evaluated now (§6.8.2 / L4)
  });
});

// ---------------------------------------------------------------------------
// RULED S437 (bryan: "yes, reads require narrowing"): a READ through a
// conditionally-mounted handle outside a narrowing is E-DECL-HANDLE-NOT-NARROWED.
// ---------------------------------------------------------------------------
describe("reads require narrowing (ruled S437) — E-DECL-HANDLE-NOT-NARROWED", () => {
  const cond = `<div if=@show><dropdown as=color label="C" options=(["red"])/></div>
        <dropdown as=country label="K" options=(["US"]) value="US"/>`;
  const prog = (extraMarkup, fns = "") => appWith(`${cond}\n${extraMarkup}`, `    <let show:bool=false/>\n${fns}`);

  test("an un-narrowed read in markup is refused", () => {
    expect(codes(run([LIB(), prog("<p>${@color.value}</p>")]))).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });

  test("an un-narrowed read in logic is refused", () => {
    const r = run([LIB(), prog("<p>x</p>", "    function f() { return @color.value }")]);
    expect(codes(r)).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
    expect(r.diags[0].message).toContain("dropdown | not");
  });

  test("a narrowed read (`given c = @color :> { … c.value … }`) is accepted", () => {
    const r = run([LIB(), prog("<p>x</p>", "    <let seen:string=\"\"/>\n    function f() { given c = @color :> { @seen = c.value } }")]);
    expect(codes(r)).toEqual([]);
  });

  test("a read of an UNconditional handle is accepted (L12 (b): typed `T`)", () => {
    expect(codes(run([LIB(), prog("<p>${@country.value}</p>")]))).toEqual([]);
  });

  test("the §66.19.3 un-narrowed WRITE still gives exactly one diagnostic (no extra read report)", () => {
    expect(codes(run([LIB(), prog("<button onclick=(@color.value = \"\")>x</button>")]))).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });
});
