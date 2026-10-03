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

// SPEC §6.15 (S449 item 3): a render expression may not write reactive state — a program whose render hole
// calls a writer is now E-VALUE-WRITES-STATE. The S440 runtime guarantees below (a render-hole write loop
// converges; a Commit outside a handler batch is atomic) are no longer reachable from SOURCE, but the runtime
// still promises them, so they stay tested at the Core level: the test compiles the write-free TWIN (each
// render-hole function `f` returns without writing; the writing body is declared as `fW`, called by nothing),
// then grafts `fW`'s lowered body into `f` — the pattern slice-m4 effect.test.js uses for C11.
const graftWriters = (core, names) => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const out = clone(core);
  for (const n of names) {
    const into = out.fns.find((f) => f.sym.hint === n);
    const from = out.fns.find((f) => f.sym.hint === n + "W");
    if (!into || !from) throw new Error(`graftWriters: no fn ${n} / ${n}W in the lowered Core`);
    into.body = clone(from.body);
  }
  return out;
};

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
    const app = appWith("<p>x</p>", "    <audit:string[free, append]=([])/>\n    function f() { reset(@audit) }");
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
// O58 (b) + §66.10 item 1 / §66.11.3 item 1 — the spread literal is ONE value
// built from ONE snapshot: every override value is read before any is written,
// so the spread means exactly what the equivalent genuine replace means
// (review of #1109, F1: sequential per-override writes let a later value read
// an earlier override's write — a swap yielded 2,2).
// ---------------------------------------------------------------------------
const PAIR = `<pair export let a:string="1" export let b:string="2">
</>
renders <p class="pair">\${a},\${b}</p>
`;

function snapshotProgram(fns) {
  return {
    path: "snap.scrml",
    src: `${PAIR}
<program>
    type P:struct = { let x: int, y: int }
    <let p:P=({ x: 1, y: 2 })/>
${fns}
    <main>
        <pair as=pp/>
        <p class="pt">\${@p.x},\${@p.y}</p>
        <button class="go" onclick=go()>go</button>
    </main>
</program>
`,
  };
}

async function spreadOutcome(fn, tag) {
  const r = run([snapshotProgram(fn)]);
  expect(codes(r)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  await loadProgram(r.core, tag);
  click(document.querySelector("button.go"));
  return { pt: document.querySelector("p.pt").textContent, pair: document.querySelector("p.pair").textContent, r };
}

describe("O58 (b) — a spread reads ONE snapshot: it means what the genuine replace means (§66.10.1, §66.11.3.1)", () => {
  test("a struct-cell swap `{ ...@p, x: @p.y, y: @p.x }` swaps (the genuine replace's 2,1 — never 2,2)", async () => {
    const genuine = await spreadOutcome("    function go() { @p = { x: @p.y, y: @p.x } }", "snap-genuine");
    expect(genuine.pt).toBe("2,1");
    const spread = await spreadOutcome("    function go() { @p = { ...@p, x: @p.y, y: @p.x } }", "snap-swap");
    expect(spread.pt).toBe(genuine.pt);
  });

  test("override order does not matter: `{ ...@p, y: @p.x + 10, x: @p.y }` → 2,11", async () => {
    expect((await spreadOutcome("    function go() { @p = { ...@p, y: @p.x + 10, x: @p.y } }", "snap-order")).pt).toBe("2,11");
  });

  test("a value reading its own and a sibling field sees the pre-write snapshot: `{ ...@p, x: @p.x + @p.y, y: @p.x }` → 3,1", async () => {
    expect((await spreadOutcome("    function go() { @p = { ...@p, x: @p.x + @p.y, y: @p.x } }", "snap-self")).pt).toBe("3,1");
  });

  test("an INSTANCE spread swap `{ ...@pp, a: @pp.b, b: @pp.a }` swaps (the instance path, not only the struct path)", async () => {
    expect((await spreadOutcome("    function go() { @pp = { ...@pp, a: @pp.b, b: @pp.a } }", "snap-inst")).pair).toBe("2,1");
  });

  test("the classification is unchanged: still one contract-checked FieldAt Write per override, values evaluated first", async () => {
    const { r } = await spreadOutcome("    function go() { @p = { ...@p, x: @p.y, y: @p.x } }", "snap-shape");
    const st = r.core.fns.find((f) => f.sym.hint === "go").body.stmts;
    // S440: the instance is resolved once (Let inst = Handle(…)); the pre-statement value is read
    // once (Let before = @p, strict snapshot); the writes are grouped in one all-or-nothing Commit
    // through the instance local (was: Let, Let, Write, Write)
    expect(st.map((s) => s.variant)).toEqual(["Let", "Let", "Let", "Let", "Commit"]);
    expect(st[0].data.init.variant).toBe("Handle");
    const before = st[1].data.sym;
    expect(st[1].data.init.variant).toBe("Read");
    const ws = st[4].data.writes;
    expect(ws.map((s) => s.variant)).toEqual(["Write", "Write"]);
    expect(ws.map((s) => [s.data.edit.variant, s.data.check])).toEqual([["FieldAt", "Static"], ["FieldAt", "Static"]]);
    for (const w of ws) expect(w.data.inst).toEqual({ variant: "Narrowed", data: { sym: st[0].data.sym } });
    // each override value reads the SNAPSHOT (`before.y`, `before.x`), never the live cell
    for (const k of [2, 3]) {
      expect(st[k].data.init.variant).toBe("Read");
      expect(st[k].data.init.data.place.variant).toBe("LocalPath");
      expect(st[k].data.init.data.place.data.sym).toEqual(before);
    }
    // each Write stores the local its Let evaluated — the value was read before either write
    expect(ws[0].data.value).toEqual({ variant: "Local", data: { sym: st[2].data.sym } });
    expect(ws[1].data.value).toEqual({ variant: "Local", data: { sym: st[3].data.sym } });
  });

  test("a LONE override stays a single Write (no Commit); a snapshot Let only when its value reads `@p`", async () => {
    const lone = (await spreadOutcome("    function go() { @p = { ...@p, x: 4 } }", "snap-lone")).r;
    expect(lone.core.fns.find((f) => f.sym.hint === "go").body.stmts.map((s) => s.variant)).toEqual(["Write"]);
    const reads = (await spreadOutcome("    function go() { @p = { ...@p, x: @p.y } }", "snap-lone-reads")).r;
    expect(reads.core.fns.find((f) => f.sym.hint === "go").body.stmts.map((s) => s.variant)).toEqual(["Let", "Write"]);
  });
});

// ---------------------------------------------------------------------------
// RULED S440 (bryan: "Should a spread write be all-or-nothing on a runtime
// refusal? Yes. Under R3 … the whole new value is built first and then checked,
// so a partial apply shouldn't be possible."): a spread over several
// contract-carrying fields is ONE edit — every override's contract is checked
// against the one snapshot first; if any is refused, NOTHING is applied.
// ---------------------------------------------------------------------------
const GATES = `type Phase:enum = { Draft, Live, Gone }
<gate title:string export let note:string="n0">
    export <phase:Phase=.Draft>
        <Draft rule=.Live/>
        <Live rule=.Gone/>
        <Gone rule=.Live/>
    </>
    export <stage:Phase=.Draft>
        <Draft rule=.Live/>
        <Live rule=.Gone/>
        <Gone rule=.Live/>
    </>
</>
renders <p class="gate">\${title}: \${phase}/\${stage}/\${note}</p>
`;

function gateProgram(fns) {
  return {
    path: "gate.scrml",
    src: `${GATES}
<program>
    type P:struct = { let x: int, y: int }
    <let p:P=({ x: 1, y: 2 })/>
${fns}
    <main>
        <gate as=g title="G"/>
        <p class="pt">\${@p.x},\${@p.y}</p>
        <button class="live" onclick=live()>live</button>
        <button class="go" onclick=go()>go</button>
    </main>
</program>
`,
  };
}

// `live()` moves phase Draft → Live (so phase → Gone is then an edge while stage → Gone is not).
const LIVE = "    function live() { @g = { ...@g, phase: .Live } }";

async function atomicRun(fn, tag) {
  const r = run([gateProgram(`${LIVE}\n${fn}`)]);
  expect(codes(r)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  const { rt } = await loadProgram(r.core, tag);
  const gate = () => instancesOf(rt, "gate")[0];
  const text = () => document.querySelector("p.gate").textContent;
  click(document.querySelector("button.live"));
  expect(text()).toBe("G: Live/Draft/n0");
  const before = JSON.stringify(rt.snapshot(gate()));
  const beforeText = text();
  expect(() => click(document.querySelector("button.go"))).toThrow(/E-ENGINE-INVALID-TRANSITION/);
  takePageErrors();
  return { r, rt, before, after: JSON.stringify(rt.snapshot(gate())), beforeText, afterText: text() };
}

describe("RULED S440 — a spread write is ALL-OR-NOTHING on a runtime refusal", () => {
  test("two contract-carrying fields, the SECOND refused: the instance is byte-identical to before", async () => {
    const o = await atomicRun("    function go() { @g = { ...@g, phase: .Gone, stage: .Gone } }", "atomic-second");
    expect(o.after).toBe(o.before);
    expect(o.afterText).toBe(o.beforeText);
  });

  test("the FIRST refused (override order does not matter): nothing applied", async () => {
    const o = await atomicRun("    function go() { @g = { ...@g, stage: .Gone, phase: .Gone } }", "atomic-first");
    expect(o.after).toBe(o.before);
  });

  test("a contract-free-of-graph (`let`) field alongside a refused graph field: the `let` write is not applied either", async () => {
    const o = await atomicRun("    function go() { @g = { ...@g, note: \"n1\", stage: .Gone } }", "atomic-let");
    expect(o.after).toBe(o.before);
    expect(o.afterText).toBe("G: Live/Draft/n0");
  });

  test("a granted move (`stage` Draft → Live) alongside a refused one (`phase` Live → Draft, the initial state): neither applied", async () => {
    const o = await atomicRun("    function go() { @g = { ...@g, stage: .Live, phase: .Draft } }", "atomic-move");
    const fn = o.r.core.fns.find((f) => f.sym.hint === "go").body.stmts;
    expect(fn.map((s) => s.variant)).toEqual(["Let", "Let", "Let", "Commit"]);
    expect(fn[3].data.writes.map((s) => [s.data.edit, s.data.check])).toEqual([["Transition", "RuntimeEdge"], ["Transition", "RuntimeEdge"]]);
    expect(o.after).toBe(o.before);
  });

  test("a spread through a ROW-scoped `as=` handle inside `<each>` (an inline handler): all-or-nothing, per row", async () => {
    const r = run([{
      path: "rows.scrml",
      src: `${GATES}
<program>
    <names:string[]=(["a", "b"])/>
    <main>
        <each in=@names as n>
            <gate as=rg title=n/>
            <button class="bad" onclick=(@rg = { ...@rg, phase: .Live, stage: .Gone })>bad</button>
            <button class="ok" onclick=(@rg = { ...@rg, phase: .Live, stage: .Live })>ok</button>
        </each>
    </main>
</program>
`,
    }]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "atomic-rows");
    const texts = () => [...document.querySelectorAll("p.gate")].map((p) => p.textContent);
    expect(texts()).toEqual(["a: Draft/Draft/n0", "b: Draft/Draft/n0"]);
    expect(() => click(document.querySelectorAll("button.bad")[0])).toThrow(/E-ENGINE-INVALID-TRANSITION/);
    takePageErrors();
    expect(texts()).toEqual(["a: Draft/Draft/n0", "b: Draft/Draft/n0"]);   // `phase: .Live` NOT applied
    click(document.querySelectorAll("button.ok")[1]);
    expect(texts()).toEqual(["a: Draft/Draft/n0", "b: Live/Live/n0"]);     // only row b, both fields
  });

  test("a spread with ZERO overrides (`@g = { ...@g }`, `@p = { ...@p }`) is the same value: nothing is written", () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g }\n @p = { ...@p } }`)]);
    expect(codes(r)).toEqual([]);
    expect(r.core.fns.find((f) => f.sym.hint === "go").body.stmts).toEqual([]);
  });

  test("check.scrml C7 bites: a one-write Commit, a Commit holding a non-Write, a Commit write storing a non-Local", () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, phase: .Gone, stage: .Gone } }`)]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const fn = r.core.fns.find((f) => f.sym.hint === "go");
    const commit = fn.body.stmts[3];
    const orig = commit.data.writes;
    const w0 = orig[0];
    const redo = (writes) => { commit.data.writes = writes; const out = mods.check.checkCore(r.core); commit.data.writes = orig; return out; };
    expect(redo([w0]).some((m) => m.startsWith("C7:"))).toBe(true);
    expect(redo([w0, fn.body.stmts[0]]).some((m) => m.startsWith("C7:"))).toBe(true);
    const inline = { variant: "Write", data: { ...w0.data, value: { variant: "Lit", data: { lit: { variant: "Str", data: { v: "Gone" } } } } } };
    expect(redo([w0, inline]).some((m) => m.startsWith("C7:"))).toBe(true);
  });

  test("the printed commit checks every edge BEFORE the first write (the emitted JS, read as a developer would)", async () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, stage: .Live, phase: .Draft } }`)]);
    const { out } = await loadProgram(r.core, "atomic-js");
    const body = /function go\(\) \{([\s\S]*?)\n\}/.exec(out.js)[1];
    const at = (re) => body.search(re);
    const lastCheck = Math.max(...[...body.matchAll(/checkEdge\(/g)].map((m) => m.index));
    expect([...body.matchAll(/checkEdge\(/g)].length).toBe(2);
    expect(at(/\.set\(/)).toBeGreaterThan(lastCheck);
    expect(body).not.toContain("transition(");
    // the writes run inside ONE rt.batch, after the checks; the handle is resolved once
    expect(at(/rt\.batch\(\(\) => \{/)).toBeGreaterThan(lastCheck);
    expect(at(/\.set\(/)).toBeGreaterThan(at(/rt\.batch\(/));
    expect([...body.matchAll(/handles\[/g)].length).toBe(1);
  });

  test("when every override is granted, ALL apply (the commit is not a no-op)", async () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, phase: .Gone, note: \"n1\" } }`)]);
    expect(codes(r)).toEqual([]);
    const { rt } = await loadProgram(r.core, "atomic-ok");
    click(document.querySelector("button.live"));
    click(document.querySelector("button.go"));
    expect(document.querySelector("p.gate").textContent).toBe("G: Gone/Draft/n1");
    expect(rt.snapshot(instancesOf(rt, "gate")[0])).toEqual({ title: "G", phase: "Gone", stage: "Draft", note: "n1" });
  });

  test("through a `given`-narrowed handle (`given c = @g :> { @g = { ...@g, … } }`): all-or-nothing too", async () => {
    const o = await atomicRun("    function go() { given c = @g :> { @g = { ...@g, phase: .Gone, stage: .Gone } } }", "atomic-given");
    expect(o.after).toBe(o.before);
  });
});

// ---------------------------------------------------------------------------
// RULED S440 (bryan, "all recs"): STRICT SNAPSHOT — in a spread-override
// literal every `@x` read (including reads of fields also being overridden,
// and reads after a call that writes `@x`) sees the value from BEFORE the
// statement. A call's own write to a field NOT overridden survives (the
// Commit writes only the overridden fields).
// ---------------------------------------------------------------------------
const TRIPLE = (fns) => ({
  path: "triple.scrml",
  src: `<program>
    type P:struct = { let x: int, let y: int, let z: int }
    <let p:P=({ x: 1, y: 2, z: 3 })/>
    function bump() -> int { @p.z = 99
 return 5 }
    function touch() -> int { @p.x = 99
 return 7 }
${fns}
    <main>
        <p class="pt">\${@p.x},\${@p.y},\${@p.z}</p>
        <button class="go" onclick=go()>go</button>
    </main>
</program>
`,
});

async function tripleAfter(fn, tag) {
  const r = run([TRIPLE(fn)]);
  expect(codes(r)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  await loadProgram(r.core, tag);
  click(document.querySelector("button.go"));
  return document.querySelector("p.pt").textContent;
}

describe("RULED S440 — STRICT SNAPSHOT: every `@x` read in a spread-override literal sees the pre-statement value", () => {
  test("the bump case `{ ...@p, x: bump(), y: @p.z }` (bump writes @p.z = 99) → 5,3,99 (was 5,99,99)", async () => {
    expect(await tripleAfter("    function go() { @p = { ...@p, x: bump(), y: @p.z } }", "strict-bump")).toBe("5,3,99");
  });

  test("a swap with a call in between `{ ...@p, x: @p.y, y: touch(), z: @p.x }` (touch writes @p.x = 99) → 2,7,1 (was 2,7,99)", async () => {
    expect(await tripleAfter("    function go() { @p = { ...@p, x: @p.y, y: touch(), z: @p.x } }", "strict-swap-call")).toBe("2,7,1");
  });

  test("rotate-3 `{ ...@p, x: @p.y, y: @p.z, z: @p.x }` → 2,3,1", async () => {
    expect(await tripleAfter("    function go() { @p = { ...@p, x: @p.y, y: @p.z, z: @p.x } }", "strict-rotate3")).toBe("2,3,1");
  });

  test("a LONE override reading after a call in its own value `{ ...@p, y: bump() + @p.z }` → 1,8,99 (was 1,104,99)", async () => {
    expect(await tripleAfter("    function go() { @p = { ...@p, y: bump() + @p.z } }", "strict-lone")).toBe("1,8,99");
  });

  test("an INSTANCE spread: `{ ...@g, note: mark(), stage: @g.phase }` (mark moves phase Draft → Live) — stage gets the pre-statement Draft; mark's phase write survives", async () => {
    const r = run([{
      path: "strict-inst.scrml",
      src: `${GATES}
<program>
    function mark() -> string { @g.phase = .Live
 return "m" }
    function go() { @g = { ...@g, note: mark(), stage: @g.phase } }
    <main>
        <gate as=g title="G"/>
        <button class="go" onclick=go()>go</button>
    </main>
</program>
`,
    }]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    await loadProgram(r.core, "strict-inst");
    click(document.querySelector("button.go"));
    expect(document.querySelector("p.gate").textContent).toBe("G: Live/Draft/m");
  });
});

// ---------------------------------------------------------------------------
// S440 re-review N1 (PA-reproduced on c673c39aa): the strict snapshot must not
// WIDEN the reactive read set. A whole-instance snapshot (`rt.snapshot(inst)`)
// `.get()`s every field, so a spread in a render hole subscribed to fields it
// never reads; a sibling hole writing one of them re-ran the spread, whose
// side-effecting override re-ran the sibling… (guarded: box=1,0,39, log 41;
// unguarded: "Maximum call stack size exceeded"). Only the fields the
// override values read lexically are snapshotted, each read as that lexical
// read was.
// ---------------------------------------------------------------------------
describe("S440 N1 — the spread snapshot reads only the fields the override values read (no widened subscriptions)", () => {
  const BOX = `<box title:string export let a:int=0 export let b:int=0 export let c:int=0>
</>
renders <p class="box">\${a},\${b},\${c}</p>
`;
  // `twin`: e1 / e2 write nothing; their writing bodies are e1W / e2W (grafted in Core — see graftWriters)
  const loopProgram = (guard, twin = false) => ({
    path: "n1.scrml",
    src: `${BOX}<program>
    <let n:int=0/>
    <log:int[free, append]=([])/>
    function stamp() -> int {
        @log.push(1)
        return 1
    }
    function e1${twin ? "W" : ""}() -> int {
        if (@n > 0) { @h = { ...@h, a: stamp() + @h.b * 0 } }
        return 0
    }
    function e2${twin ? "W" : ""}() -> int {
        ${guard ? "if (@log.length < 40) { @h.c = @log.length }" : "@h.c = @log.length"}
        return 0
    }
${twin ? "    function e1() -> int { return 0 }\n    function e2() -> int { return 0 }\n" : ""}    function go() { @n = 1 }
    <main>
        <box as=h title="B"/>
        <p class="e1">\${e1()}</p>
        <p class="e2">\${e2()}</p>
        <p class="len">\${@log.length}</p>
        <button class="go" onclick=go()>go</button>
    </main>
</program>
`,
  });

  for (const guard of [true, false]) {
    test(`a side-effecting override in a render hole beside a sibling writer converges (${guard ? "guarded" : "unguarded"}): box=1,0,1, log length 1`, async () => {
      // §6.15: the source program is now rejected — both render holes call a writer
      expect(codes(run([loopProgram(guard)]))).toEqual(["E-VALUE-WRITES-STATE", "E-VALUE-WRITES-STATE"]);
      const r = run([loopProgram(guard, true)]);
      expect(codes(r)).toEqual([]);
      const core = graftWriters(r.core, ["e1", "e2"]);
      expect(mods.check.checkCore(core)).toEqual([]);
      await loadProgram(core, guard ? "n1-guarded" : "n1-unguarded");
      click(document.querySelector("button.go"));
      expect(document.querySelector("p.box").textContent).toBe("1,0,1");
      expect(document.querySelector("p.len").textContent).toBe("1");
    });
  }

  test("the snapshot Lets name only the fields read (instance spread: `before_phase`, `before_title`; never a whole-instance snapshot)", async () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, stage: @g.phase, note: @g.title } }`)]);
    expect(codes(r)).toEqual([]);
    const { out } = await loadProgram(r.core, "n1-shape");
    const body = /function go\(\) \{([\s\S]*?)\n\}/.exec(out.js)[1];
    expect(body).not.toContain("rt.snapshot(");
    expect(body).toContain("const before_phase = ");
    expect(body).toContain("const before_title = ");
    expect(body).not.toContain("before_note");
    expect(body).not.toContain("before_stage");
  });

  test("a read of the WHOLE `@g` in an override takes the whole snapshot — only then (it reads every field lexically anyway)", async () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, stage: .Live, note: (@g == @g ? "same" : "diff") } }`)]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const { out } = await loadProgram(r.core, "n1-whole");
    const body = /function go\(\) \{([\s\S]*?)\n\}/.exec(out.js)[1];
    expect([...body.matchAll(/rt\.snapshot\(/g)].length).toBe(1);
    expect(body).not.toContain("before_");
    click(document.querySelector("button.go"));
    expect(document.querySelector("p.gate").textContent).toBe("G: Draft/Live/same");
  });
});

// ---------------------------------------------------------------------------
// RULED S440: a DUPLICATE override key in a spread-override literal is a
// compile error — E-STRUCT-DUPLICATE-KEY (§14.3 / §66.11.3, §34; the
// bootstrap-local E-BOOTSTRAP-DUP-OVERRIDE is retired, s442). The plain /
// nested literal half of the same rule: slice-m2/typer-s440.test.js.
// ---------------------------------------------------------------------------
describe("RULED S440 — a duplicate override key is a compile error (E-STRUCT-DUPLICATE-KEY)", () => {
  test("an INSTANCE spread `{ ...@g, phase: .Gone, phase: .Live }` is refused, once, at the second key", () => {
    const r = run([gateProgram(`${LIVE}\n    function go() { @g = { ...@g, phase: .Gone, phase: .Live } }`)]);
    expect(codes(r)).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
    expect(r.diags[0].message).toContain("`phase` is named twice");
  });

  test("a STRUCT-CELL spread `{ ...@p, x: 5, x: 6 }` is refused", () => {
    expect(codes(run([TRIPLE("    function go() { @p = { ...@p, x: 5, x: 6 } }")]))).toEqual(["E-STRUCT-DUPLICATE-KEY"]);
  });

  test("three of one key report twice; distinct keys are fine", () => {
    expect(codes(run([TRIPLE("    function go() { @p = { ...@p, x: 5, y: 1, x: 6, x: 7 } }")]))).toEqual(["E-STRUCT-DUPLICATE-KEY", "E-STRUCT-DUPLICATE-KEY"]);
    expect(codes(run([TRIPLE("    function go() { @p = { ...@p, x: 5, y: 6 } }")]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S440 review F-A (PA-reproduced on 41f8416de): a Commit reached OUTSIDE a
// handler batch — from a render hole, i.e. inside an effect flush at batch
// depth 0 — must still be all-or-nothing to its observers: each `.set` there
// flushed its observers synchronously, so an observer saw (and a watcher could
// act on) the half-applied value. The writes now run in one `rt.batch`.
// ---------------------------------------------------------------------------
describe("S440 F-A — a Commit outside a handler batch: no observer sees the half-applied value", () => {
  // `twin`: react / watch write nothing; their writing bodies are reactW / watchW (grafted in Core)
  const REACT = (spread, twin) => `    <let n:int=0/>
    function react${twin ? "W" : ""}() -> int {
        if (@n > 0) { @g = { ...@g, ${spread} } }
        return @n
    }${twin ? "\n    function react() -> int { return @n }" : ""}`;
  const prog = (spread, fns, view, twin = false) => ({
    path: "fa.scrml",
    src: `${GATES}
<program>
${REACT(spread, twin)}
${twin ? fns.replace("function watch()", "function watchW()") + (fns ? '\n    function watch() -> string { return "w" }' : "") : fns}
    <main>
        <gate as=g title="G"/>
        <p class="r">\${react()}</p>
${view}
        <button class="b" onclick=(@n = 1)>b</button>
    </main>
</program>
`,
  });

  async function runFA(tag, spread, fns = "", view = "") {
    // §6.15: the source program is now rejected — `react()` (and `watch()`) write from a render hole
    const src = codes(run([prog(spread, fns, view)]));
    expect(src.length).toBeGreaterThan(0);
    expect(src.every((c) => c === "E-VALUE-WRITES-STATE")).toBe(true);
    const r = run([prog(spread, fns, view, true)]);
    expect(codes(r)).toEqual([]);
    const core = graftWriters(r.core, fns ? ["react", "watch"] : ["react"]);
    expect(mods.check.checkCore(core)).toEqual([]);
    const { rt } = await loadProgram(core, tag);
    const g = instancesOf(rt, "gate")[0];
    const pi = g.decl.fields.indexOf("phase"), si = g.decl.fields.indexOf("stage");
    const seen = [];
    rt.effect(rt.root, () => { seen.push(g.fields[pi].get() + "/" + g.fields[si].get()); });
    const before = JSON.stringify(rt.snapshot(g));
    let err = null;
    try { click(document.querySelector("button.b")); } catch (e) { err = e; }
    takePageErrors();
    return { seen, before, after: JSON.stringify(rt.snapshot(g)), final: rt.snapshot(g), err };
  }

  test("case A (probe): an observer sees Draft/Draft → Live/Live, never Live/Draft", async () => {
    const o = await runFA("fa-a", "phase: .Live, stage: .Live");
    expect(o.err).toBe(null);
    expect(o.seen).toEqual(["Draft/Draft", "Live/Live"]);
    expect([o.final.phase, o.final.stage]).toEqual(["Live", "Live"]);
  });

  test("case B (probe): a watcher that refuses on the half state never fires — final Live/Live", async () => {
    const watch = `    function watch() -> string {
        if (@g.phase == .Live) { if (@g.stage == .Draft) { @g = { ...@g, stage: .Gone } } }
        return "w"
    }`;
    const o = await runFA("fa-b", "phase: .Live, stage: .Live", watch, `        <p class="w">\${watch()}</p>`);
    expect(o.err).toBe(null);
    expect(o.seen).toEqual(["Draft/Draft", "Live/Live"]);
    expect([o.final.phase, o.final.stage]).toEqual(["Live", "Live"]);
  });

  test("a Commit REFUSED outside a batch leaves the instance byte-identical, and no observer ran", async () => {
    const o = await runFA("fa-refused", "phase: .Live, stage: .Gone");
    expect(o.err).not.toBe(null);
    expect(String(o.err.message)).toContain("E-ENGINE-INVALID-TRANSITION");
    expect(o.after).toBe(o.before);
    expect(o.seen).toEqual(["Draft/Draft"]);
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
    const inst = r.core.decls[1].renders[0].data.kids.find((k) => k.variant !== "Text");   // dpa-045 fu4: whitespace Text kept
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

// ---------------------------------------------------------------------------
// §66.7.5 (O56 RULED S435; reads S437 #1108): inside its own narrowed block
// `given c = @h :> { … }`, `@h` IS narrowed — a direct `@h.f = …` and a direct
// `@h.f` read there are legal and go through `c` (review of #1109, F2: both
// were refused E-DECL-HANDLE-NOT-NARROWED).
// ---------------------------------------------------------------------------
describe("§66.7.5 — `@h` is narrowed inside its own `given c = @h :> { … }`", () => {
  const cond = `<div if=@show><dropdown as=color label="C" options=(["red", "blue"])/></div>
        <dropdown as=country label="K" options=(["US", "CA"]) value="US"/>`;
  const prog = (fns, show = "false", extra = "<p>x</p>") =>
    appWith(`${cond}\n        ${extra}`, `    <let show:bool=${show}/>\n    <let seen:string=""/>\n${fns}`);
  const fnStmts = (r, name) => r.core.fns.find((f) => f.sym.hint === name).body.stmts;

  test("a direct READ `@color.value` inside the block is accepted", () => {
    expect(codes(run([LIB(), prog("    function f() { given c = @color :> { @seen = @color.value } }")]))).toEqual([]);
  });

  test("a direct WRITE `@color.value = …` inside the block is accepted", () => {
    expect(codes(run([LIB(), prog("    function f() { given c = @color :> { @color.value = \"x\" } }")]))).toEqual([]);
  });

  test("the direct write lowers exactly as the write through `c` does (the same Narrowed place)", () => {
    const r = run([LIB(), prog("    function f() { given c = @color :> { @color.value = \"x\" } }\n    function g() { given c = @color :> { c.value = \"x\" } }")]);
    expect(codes(r)).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const inner = (name) => fnStmts(r, name)[1].data.thenB.stmts[0];
    const f = inner("f"), g = inner("g");
    expect(f.variant).toBe("Write");
    expect(f.data.inst).toEqual({ variant: "Narrowed", data: { sym: fnStmts(r, "f")[0].data.sym } });
    expect(g.data.inst).toEqual({ variant: "Narrowed", data: { sym: fnStmts(r, "g")[0].data.sym } });
    expect([f.data.edit, f.data.check, f.data.value]).toEqual([g.data.edit, g.data.check, g.data.value]);
  });

  test("at runtime the direct write lands while mounted", async () => {
    const r = run([LIB(), prog("    function f() { given c = @color :> { @color.value = \"blue\" } }", "true",
      "<button class=\"go\" onclick=f()>go</button>")]);
    expect(codes(r)).toEqual([]);
    await loadProgram(r.core, "narrow-direct-write");
    const toggles = () => [...document.querySelectorAll("button.dropdown__toggle")].map((b) => b.textContent);
    expect(toggles()).toContain("C: ");
    click(document.querySelector("button.go"));
    expect(toggles()).toContain("C: blue");
  });

  // bite: the narrowing is scoped to the block and to the handle it names
  test("outside the block (after it) `@color` is still refused", () => {
    const r = run([LIB(), prog("    function f() { given c = @color :> { @seen = c.value }\n return @color.value }")]);
    expect(codes(r)).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });

  test("a write after the block is still refused", () => {
    const r = run([LIB(), prog("    function f() { given c = @color :> { @seen = c.value }\n @color.value = \"x\" }")]);
    expect(codes(r)).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });

  test("a DIFFERENT handle's block does not narrow `@color` (read and write)", () => {
    expect(codes(run([LIB(), prog("    function f() { given c = @country :> { @seen = @color.value } }")]))).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
    expect(codes(run([LIB(), prog("    function f() { given c = @country :> { @color.value = \"x\" } }")]))).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });

  test("nested: an outer narrowing holds inside an inner `given`; an inner one ends with its block", () => {
    expect(codes(run([LIB(), prog("    function f() { given c = @color :> { given d = @country :> { @color.value = @country.value } } }")]))).toEqual([]);
    expect(codes(run([LIB(), prog("    function f() { given d = @country :> { given c = @color :> { @seen = @color.value }\n @color.value = \"x\" } }")]))).toEqual(["E-DECL-HANDLE-NOT-NARROWED"]);
  });

  test("a `given` over an UNconditional handle: a direct write inside is accepted and lands", async () => {
    const r = run([LIB(), prog("    function f() { given c = @country :> { @country.value = \"CA\" } }", "false",
      "<button class=\"go\" onclick=f()>go</button>")]);
    expect(codes(r)).toEqual([]);
    await loadProgram(r.core, "narrow-uncond");
    const toggles = () => [...document.querySelectorAll("button.dropdown__toggle")].map((b) => b.textContent);
    expect(toggles()).toContain("K: US");
    click(document.querySelector("button.go"));
    expect(toggles()).toContain("K: CA");
  });
});
