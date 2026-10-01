// core-additions.test.js — s444 Phase A: the Core additions, each wired
// analyze → lower → print / runtime, and each checked in Core (check.scrml):
//   1. Attr.Bind      — `bind:value` / `bind:checked` (§5.4), the event-value round trip (C8)
//   2. Expr.Host      — the host-call surface: exactly `Date.now()` (function / handler bodies; E-FN-004 in `fn`)
//   3. View.Star      — `<*x/>` renders the EXISTING instance (§66.6.2) (C10)
//   4. removal edits  — `pop()` / `shift()` / `@x = @x.filter(λ)` (RULED S442 grow/shrink tokens) (C3 / C9);
//      index places  — `@xs[i].f = v` (dpa-052 Q3) (C3 ElemAt);
//      lambdas       — `x => e` as the argument of `.filter` / `.map` (Expr.Lambda / Expr.SeqCall).

import { describe, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors, instancesOf } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const toggle = (el) => { el.checked = !el.checked; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const $ = (sel) => document.querySelector(sel);
const texts = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent);
const coreOf = (src) => clean(src).core;
const walkCore = (core, pred) => {
  const out = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== "object") return;
    if (pred(n)) out.push(n);
    Object.values(n).forEach(walk);
  })(core);
  return out;
};

// ===========================================================================
describe("1 — bind (Attr.Bind)", () => {
  const src = P(`    <let name:string="ann"/>\n    <let ok:bool=false/>\n    function shout() { @name = "BOB" }`,
    `        <input bind:value=@name/>\n        <input type="checkbox" bind:checked=@ok/>\n        <p>\${@name}|\${@ok}</p>\n        <button onclick=shout()>shout</button>`);

  test("Core: one Bind per bound element — it reads the place and writes `Local(sink)` back through the place's capability", () => {
    const binds = walkCore(coreOf(src), (n) => n.variant === "Bind").map((n) => n.data);
    expect(binds.map((b) => b.kind)).toEqual(["Value", "Checked"]);
    for (const b of binds) {
      expect(b.write.stmts.length).toBe(1);
      expect(b.write.stmts[0].variant).toBe("Write");
      expect(b.write.stmts[0].data.value).toEqual({ variant: "Local", data: { sym: b.sink } });
    }
  });

  test("runs: the element shows the cell; input / change writes it back; a logic write reaches the element", async () => {
    await loadProgram(coreOf(src), "bind-basic");
    const [text, box] = document.querySelectorAll("main > input");
    expect(text.value).toBe("ann");
    expect(box.checked).toBe(false);
    type(text, "cy");
    toggle(box);
    expect($("main > p").textContent).toBe("cy|true");
    click([...document.querySelectorAll("main > button")][0]);
    expect(text.value).toBe("BOB");
  });

  test("a struct sub-field place (`@p.name`, a `let` field) binds through a FieldAt write", async () => {
    const s = P(`    type Pt:struct = { let name: string, n: int }\n    <p:Pt=({ name: "a", n: 1 })/>`, `        <input bind:value=@p.name/>\n        <b>\${@p.name}</b>`);
    const core = coreOf(s);
    const b = walkCore(core, (n) => n.variant === "Bind")[0].data;
    expect(b.write.stmts[0].data.edit.variant).toBe("FieldAt");
    await loadProgram(core, "bind-fieldat");
    type($("main > input"), "zed");
    expect($("main > b").textContent).toBe("zed");
  });

  test("§5.4 legality: the element and the attribute name", () => {
    const one = (el) => codes(P(`    <let s:string=""/>\n    <let b:bool=false/>`, `        ${el}`));
    expect(one(`<div bind:value=@s></div>`)).toEqual(["E-ATTR-011"]);
    expect(one(`<input type="text" bind:checked=@b/>`)).toEqual(["E-ATTR-011"]);
    expect(one(`<input bind:colour=@s/>`)).toEqual(["E-ATTR-011"]);
    expect(one(`<select bind:selected=@s></select>`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(one(`<input type="radio" value="a" bind:group=@s/>`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(one(`<textarea bind:value=@s></textarea>`)).toEqual([]);
    expect(one(`<select bind:value=@s><option value="a">a</option></select>`)).toEqual([]);
  });

  test("§5.4: the right side must be an `@` place (E-ATTR-010)", () => {
    expect(codes(P(`    <let s:string=""/>\n    function f() { let t = "x" }`, `        <input bind:value="s"/>`))).toEqual(["E-ATTR-010"]);
    expect(codes(P(`    <let s:string=""/>`, `        <input bind:value=(1 + 2)/>`))).toEqual(["E-ATTR-010"]);
  });

  test("the write is judged by the place's own contract: a locked cell, a derived cell", () => {
    expect(codes(P(`    <s:string="x"/>`, `        <input bind:value=@s/>`))).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(codes(P(`    <let a:string="x"/>\n    <d:string=(@a + "!")/>`, `        <input bind:value=@d/>`))).toEqual(["E-DERIVED-WRITE"]);
  });

  test("the value a bind writes must fit the place: a string (`value`), a boolean (`checked`)", () => {
    expect(codes(P(`    <let b:bool=false/>`, `        <input bind:value=@b/>`))).toEqual(["E-TYPE-031"]);
    expect(codes(P(`    <let s:string=""/>`, `        <input type="checkbox" bind:checked=@s/>`))).toEqual(["E-TYPE-031"]);
    // a numeric place needs a coercion the bootstrap does not have (flagged — §5.4 names one only for <select>)
    expect(codes(P(`    <let n:int=0/>`, `        <input type="number" bind:value=@n/>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("C8: a Bind whose read and write name different places is refused in Core", () => {
    const core = coreOf(P(`    <let a:string=""/>\n    <let b:string=""/>`, `        <input bind:value=@a/>\n        <input bind:value=@b/>`));
    const [b1, b2] = walkCore(core, (n) => n.variant === "Bind").map((n) => n.data);
    b1.read = b2.read;                                   // show `b`, write `a`
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C8: a bind reads"))).toBe(true);
  });
  test("C8: a Bind that writes something other than its sink is refused", () => {
    const core = coreOf(P(`    <let a:string=""/>`, `        <input bind:value=@a/>`));
    const b = walkCore(core, (n) => n.variant === "Bind")[0].data;
    b.write.stmts[0].data.value = { variant: "Lit", data: { lit: { variant: "Str", data: { v: "x" } } } };
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C8: a bind's Write stores"))).toBe(true);
  });
});

// ===========================================================================
describe("2 — the host call (Expr.Host: `Date.now()` only)", () => {
  const realNow = Date.now;
  afterAll(() => { Date.now = realNow; });
  const stamp = P(`    <let t:number=0/>\n    function mark() { @t = Date.now() }`, `        <p>\${@t}</p>\n        <button onclick=mark()>mark</button>\n        <button onclick=(@t = Date.now() + 1)>inline</button>`);

  test("in a `function` body and in an event handler: Core Host(DateNow); printed as the host spells it", async () => {
    const core = coreOf(stamp);
    expect(walkCore(core, (n) => n.variant === "Host").map((n) => n.data.call)).toEqual(["DateNow", "DateNow"]);
    Date.now = () => 42;
    const { out } = await loadProgram(core, "host-now");
    expect(out.js).toContain("Date.now()");
    const [mark, inline] = document.querySelectorAll("main > button");
    click(mark);
    expect($("main > p").textContent).toBe("42");
    click(inline);
    expect($("main > p").textContent).toBe("43");
  });

  test("in a pure `fn` body → E-FN-004 (§33.3 item 7, §41.19)", () => {
    const d = run(P(`    fn stamp() -> number { return Date.now() }`, `        <p>x</p>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-FN-004"]);
  });

  test("outside a function / handler body (an initializer, markup) → E-BOOTSTRAP-UNSUPPORTED — the surface is function / handler bodies only", () => {
    expect(codes(P(`    <let t:number=(Date.now())/>`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    <let t:number=0/>`, `        <p>\${Date.now()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("it is a `number`: into an `int` cell is E-TYPE-031; with an argument, refused", () => {
    expect(codes(P(`    <let n:int=0/>\n    function f() { @n = Date.now() }`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(P(`    <let t:number=0/>\n    function f() { @t = Date.now(1) }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("`Date` is a reserved emitted name: a user function called `Date` never shadows the host's", async () => {
    Date.now = () => 5;
    const src = P(`    <let t:number=0/>\n    function Date() -> int { return 1 }\n    function mark() { @t = Date.now() }`, `        <p>\${@t}</p>\n        <button onclick=mark()>m</button>`);
    const { out } = await loadProgram(coreOf(src), "host-date-name");
    expect(out.js).not.toContain("function Date(");
    click($("main > button"));
    expect($("main > p").textContent).toBe("5");
  });

  // r2 F4 (S239 review): the restriction holds through a helper.
  const h = `    function h() -> number { return Date.now() + 1 }`;
  test("a `fn` calling a `function` → E-FN-003 (§48.6.2) — so a `fn` never reaches the clock through a helper", () => {
    const d = run(P(`${h}\n    fn f() -> number { return h() }`, `        <p>x</p>`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-FN-003"]);
    expect(d[0].message).toContain("§48.6.2");
    expect(d[0].message).toContain("reads the clock");
    // two levels: the `fn` calls a `function` that calls the clock helper
    expect(codes(P(`${h}\n    function g() -> number { return h() }\n    fn f() -> number { return g() }`, `        <p>x</p>`))).toEqual(["E-FN-003"]);
    // a `function` with no clock is still not callable from a `fn` (§48.6.2: no purity guarantee)
    const d2 = run(P(`    function k() -> int { return 1 }\n    fn f() -> int { return k() }`, `        <p>x</p>`)).diags;
    expect(d2.map((x) => x.code)).toEqual(["E-FN-003"]);
    expect(d2[0].message).not.toContain("reads the clock");
    // inside a lambda in a `fn` body too
    expect(codes(P(`    <xs:int[]=([1])/>\n    function k(x: int) -> bool { return true }\n    fn f() -> int { return @xs.filter(x => k(x)).length }`, `        <p>x</p>`))).toEqual(["E-FN-003"]);
  });
  test("twin: a `fn` calling a `fn` (§48.6.1), and a `function` calling the clock helper, are clean", () => {
    expect(codes(P(`    fn k() -> int { return 1 }\n    fn f() -> int { return k() }`, `        <p>x</p>`))).toEqual([]);
    expect(codes(P(`${h}\n    <let t:number=0/>\n    function mark() { @t = h() }`, `        <button onclick=mark()>m</button>\n        <button onclick=(@t = h())>n</button>`))).toEqual([]);
  });
  test("a clock helper in an initializer, markup, an attribute value, a lambda in markup → E-BOOTSTRAP-UNSUPPORTED, as `Date.now()` there is", () => {
    for (const [decls, main] of [
      [`${h}\n    <let t:number=(h())/>`, `        <p>\${@t}</p>`],
      [h, `        <p>\${h()}</p>`],
      [h, `        <p title=h()>x</p>`],
      [`${h}\n    <xs:int[]=([1])/>`, `        <p>\${@xs.filter(x => h() > 0).length}</p>`],
      [`${h}\n    function g() -> number { return h() }`, `        <p>\${g()}</p>`],
    ]) {
      const d = run(P(decls, main)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain("reads the clock");
    }
  });
  test("the clock set is closed over mutual recursion; a helper with no clock in markup stays clean", () => {
    const rec = `    function a(n: int) -> number { if (n > 0) { return b(n - 1) }\n return 0 }\n    function b(n: int) -> number { if (n > 5) { return Date.now() }\n return a(n) }`;
    expect(codes(P(rec, `        <p>\${a(1)}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    function k() -> int { return 1 }`, `        <p>\${k()}</p>`))).toEqual([]);
  });

  test("no other host member call is admitted", () => {
    expect(codes(P(`    <let t:number=0/>\n    function f() { @t = Math.random() }`, `        <p>x</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

// ===========================================================================
describe("3 — View.Star (`<*x/>` is the existing instance)", () => {
  const src = P(`    <let show:bool=true/>\n    <counter let n:int=0/>\n    renders <span><b>\${n}</b><button onclick=(@counter.n = n + 1)>+</button></span>`,
    `        <div class="a"><*counter/></div>\n        <div class="b" if=@show><*counter/></div>\n        <button onclick=(@show = !@show)>toggle</button>`);

  test("Core: two Stars of the SHARED instance; nothing constructed", () => {
    const core = coreOf(src);
    const stars = walkCore(core, (n) => n.variant === "Star").map((n) => n.data);
    expect(stars.map((s) => [s.decl.hint, s.inst.variant])).toEqual([["counter", "Shared"], ["counter", "Shared"]]);
    expect(walkCore(core, (n) => n.variant === "Instance").length).toBe(0);
  });

  test("runs: one instance shown twice; a write through either site shows at both", async () => {
    const { rt } = await loadProgram(coreOf(src), "star-twice");
    expect(instancesOf(rt, "counter").length).toBe(1);
    click($("div.a button"));
    expect(texts("main b")).toEqual(["1", "1"]);
    click($("div.b button"));
    expect(texts("main b")).toEqual(["2", "2"]);
  });

  test("a Star in a conditional arm: unmounting disposes ITS view effects and listeners; the instance lives on", async () => {
    const { rt } = await loadProgram(coreOf(src), "star-cond");
    const before = { effects: rt.stats.effects, listeners: rt.stats.listeners };
    const toggleBtn = [...document.querySelectorAll("main > button")].find((b) => b.textContent === "toggle");
    click(toggleBtn);
    expect(document.querySelector("div.b")).toBeNull();
    expect(rt.stats.listeners).toBeLessThan(before.listeners);
    click(toggleBtn);
    expect({ effects: rt.stats.effects, listeners: rt.stats.listeners }).toEqual(before);
    expect(instancesOf(rt, "counter").length).toBe(1);
    click($("div.a button"));
    expect(texts("main b")).toEqual(["1", "1"]);          // the remounted view follows the same instance
  });

  test("a Star of a declaration whose renders holds a CHILD instance: the child's view is the site's too — unmounting disposes it", async () => {
    const src2 = P(`    <let show:bool=true/>\n    <item let k:int=0/>\n    renders <button onclick=(@item.k = k + 1)>\${k}</button>\n    <box note:string="n"/>\n    renders <div><item/></div>`,
      `        <section if=@show><*box/></section>\n        <button onclick=(@show = !@show)>toggle</button>`);
    const { rt } = await loadProgram(coreOf(src2), "star-kid-scope");
    const before = { effects: rt.stats.effects, listeners: rt.stats.listeners };
    const toggleBtn = [...document.querySelectorAll("main > button")].find((b) => b.textContent === "toggle");
    click(toggleBtn);
    // the arm's view AND the child instance's button listener are gone with the site (s444: a prebuilt
    // kid renders into the scope its parent's render was given, not into the kid's own instance scope)
    expect(rt.stats.listeners).toBe(before.listeners - 1);
    click(toggleBtn);
    expect({ effects: rt.stats.effects, listeners: rt.stats.listeners }).toEqual(before);
    click($("section button"));
    expect($("section button").textContent).toBe("1");
  });

  test("C10: a Star through an instance of ANOTHER declaration is refused in Core", () => {
    const core = coreOf(P(`    <a1 x:int=1/>\n    renders <i>\${x}</i>\n    <b1 y:int=2/>\n    renders <u>\${y}</u>`, `        <*a1/>\n        <*b1/>`));
    const [s1, s2] = walkCore(core, (n) => n.variant === "Star").map((n) => n.data);
    s1.inst = s2.inst;
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C10: a Star of <a1>"))).toBe(true);
  });
});

// ===========================================================================
describe("4a — removal edits (RemoveEnd / RemoveFront / RemoveAnywhere)", () => {
  const seq = (t, fns) => P(`    <xs:string[${t}]=(["a", "b", "c"])/>\n${fns}`, `        <ul><each in=@xs as x><li>\${x}</li></each></ul>`);
  const items = () => texts("main li");

  test("`pop()` on `[free, append, pop]`: removes the last element; on an empty sequence nothing happens", async () => {
    const core = coreOf(seq("free, append, pop", `    function p() { @xs.pop() }`));
    const w = walkCore(core, (n) => n.variant === "Write")[0].data;
    expect([w.edit, w.value]).toEqual(["RemoveEnd", { variant: "Lit", data: { lit: { variant: "Int", data: { v: 1 } } } }]);
    const { program } = await loadProgram(core, "rm-pop", ["p"]);
    program.p();
    expect(items()).toEqual(["a", "b"]);
    program.p(); program.p(); program.p();
    expect(items()).toEqual([]);
  });

  test("`shift()` on `[free, shift]`: removes the first", async () => {
    const { program } = await loadProgram(coreOf(seq("free, shift", `    function s() { @xs.shift() }`)), "rm-shift", ["s"]);
    program.s();
    expect(items()).toEqual(["b", "c"]);
  });

  test("`@xs = @xs.filter(λ)` on `[free, remove]`: a RemoveAnywhere of the filtered value (C9: a filter of the field itself)", async () => {
    const core = coreOf(seq("free, remove", `    function f(k: string) { @xs = @xs.filter(x => x != k) }`));
    const w = walkCore(core, (n) => n.variant === "Write")[0].data;
    expect(w.edit).toBe("RemoveAnywhere");
    expect(w.value.variant).toBe("SeqCall");
    expect(w.value.data.f.variant).toBe("Lambda");
    const { program } = await loadProgram(core, "rm-filter", ["f"]);
    program.f("b");
    expect(items()).toEqual(["a", "c"]);
  });

  // r2 F6 (S239 review): the field is not "locked" — it grants `remove`; the
  // write needs `replace`, and the message says so.
  test("`@xs = @ys.filter(λ)` on `[free, remove]` (another sequence's filter) → E-WRITE-NOT-GRANTED naming `replace`, not \"locked\"", () => {
    const src = P(`    <xs:string[free, remove]=(["a"])/>\n    <ys:string[]=(["b"])/>\n    function p() { @xs = @ys.filter(x => x != "a") }`, `        <p>x</p>`);
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(d[0].message).not.toContain("locked");
    expect(d[0].message).toContain("does not grant `replace`");
    expect(d[0].message).toContain("of its OWN value");
    // twin: a field with no grant at all is still "locked"
    expect(run(P(`    <n:string="x"/>\n    function p() { @n = "y" }`, `        <p>x</p>`)).diags[0].message).toContain("is locked");
  });

  test("`@xs = @xs.map(λ)` on `[writable]`: a PositionWrite of the mapped value", async () => {
    const { program } = await loadProgram(coreOf(seq("writable", `    function m() { @xs = @xs.map(x => x + "!") }`)), "rm-map", ["m"]);
    program.m();
    expect(items()).toEqual(["a!", "b!", "c!"]);
  });

  test("`remove` covers end and front (RULED S442): pop and shift on `[free, remove]` are granted, lowered, and C3-clean", async () => {
    const { program } = await loadProgram(coreOf(seq("free, remove", `    function p() { @xs.pop() }\n    function s() { @xs.shift() }`)), "rm-remove-covers", ["p", "s"]);
    program.p();
    program.s();
    expect(items()).toEqual(["b"]);
  });

  test("a removal takes no argument", () => {
    expect(codes(seq("free, pop", `    function p() { @xs.pop(1) }`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("C3: a removal the field does not grant is refused in Core; C9: a count other than an int ≥ 1, a shrink that is not a filter of the field", () => {
    const core = coreOf(seq("free, append, pop", `    function p() { @xs.pop() }\n    function q() { @xs.push("z") }`));
    const [pop, push] = walkCore(core, (n) => n.variant === "Write").map((n) => n.data);
    push.edit = "RemoveFront";
    push.value = { variant: "Lit", data: { lit: { variant: "Int", data: { v: 1 } } } };
    pop.value = { variant: "Lit", data: { lit: { variant: "Int", data: { v: 0 } } } };
    const msgs = mods.check.checkCore(core);
    expect(msgs.some((m) => m.startsWith("C3:") && m.includes("a removal at the front is not granted"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("C9:") && m.includes("int >= 1"))).toBe(true);
  });
  test("C9: a RemoveAnywhere whose value is not `filter` of its own field", () => {
    const core = coreOf(seq("free, remove", `    function f() { @xs = @xs.filter(x => true) }`));
    const w = walkCore(core, (n) => n.variant === "Write")[0].data;
    w.value = { variant: "ArrayOf", data: { elems: [] } };
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C9:") && m.includes("not a filter"))).toBe(true);
  });
});

// ===========================================================================
describe("4b — index places (`@xs[i].f = v`, Core ElemAt)", () => {
  // `Row[]` grants nothing itself: the write capability comes from the ELEMENT field's own `let` (Core: a FieldAt grant over the element struct)
  const rows = (fdecl) => P(`    type Row:struct = { ${fdecl}, id: int }\n    <rows:Row[]=([{ qty: 1, id: 1 }, { qty: 2, id: 2 }])/>\n    function setQ(i: int, q: int) { @rows[i].qty = q }`,
    `        <ul><each in=@rows as r><li>\${r.id}:\${r.qty}</li></each></ul>`);

  test("an element field with its own `let`: granted, lowered to ElemAt, run", async () => {
    const core = coreOf(rows("let qty: int"));
    const w = walkCore(core, (n) => n.variant === "Write")[0].data;
    expect(w.edit.variant).toBe("ElemAt");
    const { program } = await loadProgram(core, "elemat", ["setQ"]);
    program.setQ(1, 9);
    expect(texts("main li")).toEqual(["1:1", "2:9"]);
  });

  test("a position outside the sequence is refused at runtime — nothing is written", async () => {
    const { program } = await loadProgram(coreOf(rows("let qty: int")), "elemat-oob", ["setQ"]);
    expect(() => program.setQ(5, 9)).toThrow("outside the sequence");
    expect(texts("main li")).toEqual(["1:1", "2:2"]);
  });

  // r2 F5(b): the boundary is exact — position `length` is outside, `length - 1` is inside.
  test("the exact boundary: position `length` (2) throws, nothing written; `length - 1` (1) writes", async () => {
    const { program } = await loadProgram(coreOf(rows("let qty: int")), "elemat-boundary", ["setQ"]);
    expect(() => program.setQ(2, 9)).toThrow("position 2 is outside the sequence (its positions are 0..1)");
    expect(texts("main li")).toEqual(["1:1", "2:2"]);
    expect(() => program.setQ(-1, 9)).toThrow("position -1 is outside the sequence");
    expect(texts("main li")).toEqual(["1:1", "2:2"]);
    // reached only past the typer (a caller outside scrml): named as not a position, not as "outside"
    expect(() => program.setQ(0.5, 9)).toThrow("index 0.5 is not a sequence position (an int)");
    expect(() => program.setQ("0", 9)).toThrow('index "0" is not a sequence position (an int)');
    expect(texts("main li")).toEqual(["1:1", "2:2"]);
    program.setQ(1, 7);
    expect(texts("main li")).toEqual(["1:1", "2:7"]);
  });

  // r2 F3: the index is an `int` position. ⚑ No SPEC sentence states the
  // index type (§66.12.2 "positions" names none); the bootstrap holds it to
  // `int` (`int` enforced, RULED S440 JS-WAT 7(a)). A negative int is not a
  // type error — the SPEC says nothing about it — and stays the runtime refusal.
  test("an index that is not an `int` → E-TYPE-031 (a string param, a string literal, a non-integer, a `number`, an `int | not`)", () => {
    const at = (params, ix) => P(`    type Row:struct = { let qty: int }\n    <rows:Row[]=([{ qty: 1 }])/>\n    function p(${params}) { @rows[${ix}].qty = 2 }`, `        <p>x</p>`);
    for (const [params, ix] of [["i: string", "i"], ["", '"0"'], ["", "0.5"], ["n: number", "n"], ["m: int | not", "m"], ["", "true"]]) {
      const d = run(at(params, ix)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-TYPE-031"]);
      expect(d[0].message).toContain("a sequence index is an `int` position");
    }
    // twins: an int literal, an int param, an int expression, a negative int literal — no type error
    for (const [params, ix] of [["", "0"], ["i: int", "i"], ["i: int", "i + 1"], ["", "-1"]]) {
      expect(run(at(params, ix)).diags).toEqual([]);
    }
  });

  test("a fixed element field → E-WRITE-NOT-GRANTED; a value of the wrong type → E-TYPE-031", () => {
    expect(codes(rows("qty: int"))).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(codes(rows("let qty: int").replace("@rows[i].qty = q", "@rows[i].qty = \"x\""))).toEqual(["E-TYPE-031"]);
  });

  test("an element field whose contract grants edits but no `replace`: `= v` is refused (a replace)", () => {
    const src = P(`    type Row:struct = { tags: string[free, append], id: int }\n    <rows:Row[]=([{ tags: [], id: 1 }])/>\n    function f() { @rows[0].tags = ["x"] }`, `        <p>x</p>`);
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(d[0].message).toContain("no `replace`");
  });

  test("C3: an ElemAt whose target element field grants nothing is refused in Core", () => {
    const core = coreOf(rows("let qty: int"));
    const w = walkCore(core, (n) => n.variant === "Write")[0].data;
    w.edit.data.path[0].idx = 1;                         // retarget to `id` (no contract)
    expect(mods.check.checkCore(core).some((m) => m.startsWith("C3:") && m.includes("grants no write (its own contract"))).toBe(true);
  });
});

// ===========================================================================
describe("4c — lambdas as the argument of `.filter` / `.map` (Expr.Lambda, Expr.SeqCall)", () => {
  test("as a value in markup: reactive", async () => {
    const src = P(`    <xs:string[free, append]=(["a", "bb", "c"])/>\n    function add() { @xs.push("dd") }`,
      `        <p>\${@xs.filter(x => x.length > 1).length}</p>\n        <button onclick=add()>add</button>`);
    await loadProgram(coreOf(src), "lam-markup");
    expect($("main > p").textContent).toBe("1");
    click($("main > button"));
    expect($("main > p").textContent).toBe("2");
  });

  test("into a local, in a function", async () => {
    const src = P(`    <xs:string[]=(["a", "b"])/>\n    function marks() -> int {\n        let ys = @xs.map(x => x + "!")\n        return ys.filter(y => y != "a!").length\n    }`, `        <p>x</p>`);
    const { program, out } = await loadProgram(coreOf(src), "lam-local", ["marks"]);
    expect(out.js).not.toContain("unminted$");                 // every lambda parameter is a NameSupply name (walk binds it)
    expect(program.marks()).toBe(1);
  });

  test("the parameter is typed as the element: a string compared to an int is a type error", () => {
    expect(codes(P(`    <xs:string[]=(["a"])/>\n    function f() -> int { return @xs.filter(x => x > 1).length }`, `        <p>x</p>`))).toEqual(["E-OPERATOR-OPERAND-TYPE"]);
  });

  test("refused: a lambda outside `.filter` / `.map`, two parameters, a non-sequence receiver", () => {
    expect(codes(P(`    <let n:int=0/>\n    function f() { let g = x => x }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    <xs:string[]=(["a"])/>\n    function f() -> int { return @xs.filter((a, b) => true).length }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(`    <let n:int=0/>\n    function f() -> int { return @n.filter(x => true).length }`, `        <p>x</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});
