// reset-on.test.js — s449: `reset-on=[@a, @b]` (SPEC §6.8.4) end to end in the
// bootstrap — §66 source → parse → analyze → lower → Core (View.ResetOn) →
// check → print → the slice runtime in happy-dom — plus its four codes, the
// engine (`rule=` graph) case, the refusal of a declaration field's
// `reset-on=` (per-instance resets are OPEN), and Core check C13.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const diagsOf = (src) => run(src).diags;
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const coreOf = (src) => clean(src).core;
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
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
const resets = (core) => walkCore(core, (n) => n.variant === "ResetOn").map((n) => n.data);

/** Count `Date.now()` calls — the outside-world action an `<effect>` body performs. */
function clockSpy() {
  const real = Date.now;
  const spy = { calls: 0, restore: () => { Date.now = real; } };
  Date.now = () => { spy.calls++; return real.call(Date); };
  return spy;
}
function runsOn(label) {
  const spy = clockSpy();
  try { click(btn(label)); } finally { spy.restore(); }
  return spy.calls;
}

// The S447 search page (DD §2 row 12): one keystroke must be ONE search, already on page 1.
export const SEARCH_PROGRAM = `<program>
    <let query:string=""/>
    <let page:int=1 reset-on=[@query]/>
    function search() {
        const t = Date.now()
    }

    <effect deps=[@query, @page]>\${ search() }</>

    <main>
        <p class="out">\${@query}|\${@page}</p>
        <button onclick=(@page = @page + 1)>next</button>
        <button onclick=(@query = @query + "x")>type</button>
    </main>
</program>
`;

describe("§6.8.4 — the reset, end to end", () => {
  test("Core: one View.ResetOn ahead of the program's markup — triggers, ONE Write of the initializer, rank 0", () => {
    const core = coreOf(SEARCH_PROGRAM);
    const rs = resets(core);
    expect(rs.length).toBe(1);
    expect(rs[0].triggers.length).toBe(1);
    expect(rs[0].reset.stmts.length).toBe(1);
    expect(rs[0].reset.stmts[0].variant).toBe("Write");
    expect(rs[0].rank).toBe(0);
  });

  test("printed: `rt.resetOn(scope$, [<trigger>], () => { <the reset write> }, 0)`", async () => {
    const { out } = await loadProgram(coreOf(SEARCH_PROGRAM), "reset-print");
    expect(out.js).toContain("rt.resetOn(scope$, [inst$.fields[0 /* query */]], () => {\n    inst$.fields[1 /* page */].set(1);\n  }, 0);");
  });

  test("rule 4: a change of the trigger resets the cell, and the trigger + its reset are ONE change — one search, already on page 1", async () => {
    await loadProgram(coreOf(SEARCH_PROGRAM), "reset-search");
    expect($("p.out").textContent).toBe("|1");
    expect(runsOn("next")).toBe(1);
    expect(runsOn("next")).toBe(1);
    expect($("p.out").textContent).toBe("|3");
    expect(runsOn("type")).toBe(1);                   // the effect lists BOTH cells: it runs ONCE
    expect($("p.out").textContent).toBe("x|1");       // and the page shows the reset value
    expect(runsOn("type")).toBe(1);                   // already on page 1: the reset is a no-op, still one run
    expect($("p.out").textContent).toBe("xx|1");
  });

  test("rule 3: a chain (`a` resets on `b`, `b` resets on `c`) — ranks 1 and 0; one write of `c` resets both, one change", async () => {
    const src = P(`    <let c:int=0/>\n    <let b:int=5 reset-on=[@c]/>\n    <let a:int=7 reset-on=[@b]/>\n    function ping() {\n        const t = Date.now()\n    }\n    <effect deps=[@a, @b, @c]>\${ ping() }</>`,
      `        <p class="out">\${@a} \${@b} \${@c}</p>\n        <button onclick=(@a = @a + 1)>a</button>\n        <button onclick=(@b = @b + 1)>b</button>\n        <button onclick=(@c = @c + 1)>c</button>`);
    const core = coreOf(src);
    expect(resets(core).map((r) => r.rank).sort()).toEqual([0, 1]);
    await loadProgram(core, "reset-chain");
    runsOn("a");
    runsOn("b");
    expect($("p.out").textContent).toBe("7 6 0");     // `b` changed → `a` reset to its initializer
    runsOn("a");
    runsOn("b");
    expect($("p.out").textContent).toBe("7 7 0");
    expect(runsOn("c")).toBe(1);                      // c → b reset → a reset: one effect run
    expect($("p.out").textContent).toBe("7 5 1");
  });

  test("rule 6: on a `rule=` graph cell the reset is a transition every state admits — `@phase` returns to `.Idle`", async () => {
    const src = `<program>\n    type Phase:enum = { Idle, Loading, Done }\n    <let q:int=0/>\n    <phase:Phase=.Idle single reset-on=[@q]>\n        <Idle rule=.Loading : "idle">\n        <Loading rule=(.Done | .Idle) : "loading">\n        <Done rule=.Idle : "done">\n    </>\n    <main>\n        <p class="out"><*phase/></p>\n        <button onclick=(@phase = .Loading)>load</button>\n        <button onclick=(@q = @q + 1)>q</button>\n    </main>\n</program>\n`;
    await loadProgram(coreOf(src), "reset-engine");
    expect($("p.out").textContent).toBe("idle");
    click(btn("load"));
    expect($("p.out").textContent).toBe("loading");
    click(btn("q"));
    expect($("p.out").textContent).toBe("idle");
    click(btn("q"));                                  // already in the target: a self-write, a no-op
    expect($("p.out").textContent).toBe("idle");
  });
});

describe("§6.8.4 — codes", () => {
  const D = `    <let query:string=""/>\n    <let n:int=0/>\n    <step=1/>\n    <dbl:int=(@n * 2)/>`;
  const page = (attr) => `    <let page:int=1 ${attr}/>`;

  test("E-RESET-ON-INVALID-ENTRY — an empty list, a non-list, undeclared, non-`@`, derived and locked entries (rule 2)", () => {
    for (const attr of ["reset-on=[]", "reset-on=@query", "reset-on=[@nope]", "reset-on=[query]", "reset-on=[@dbl]", "reset-on=[@step]"]) {
      expect([attr, codes(P(`${D}\n${page(attr)}`, ""))]).toEqual([attr, ["E-RESET-ON-INVALID-ENTRY"]]);
    }
    expect(diagsOf(P(`${D}\n${page("reset-on=[@dbl]")}`, ""))[0].message).toMatch(/DERIVED/);
    // negative: mutable cells, one or several
    expect(codes(P(`${D}\n${page("reset-on=[@query]")}`, ""))).toEqual([]);
    expect(codes(P(`${D}\n${page("reset-on=[@query, @n]")}`, ""))).toEqual([]);
  });

  test("E-RESET-ON-CYCLE — a cell listing itself, a pair, a triangle; the message names the cells (rule 3)", () => {
    const self = diagsOf(P(`${D}\n${page("reset-on=[@page]")}`, ""));
    expect(self.map((d) => d.code)).toEqual(["E-RESET-ON-CYCLE"]);
    expect(self[0].message).toContain("`@page` lists itself");
    const pair = diagsOf(P(`    <let a:int=0 reset-on=[@b]/>\n    <let b:int=0 reset-on=[@a]/>`, ""));
    expect(pair.map((d) => d.code)).toEqual(["E-RESET-ON-CYCLE"]);
    expect(pair[0].message).toMatch(/`@a` → `@b` → `@a`|`@b` → `@a` → `@b`/);
    const tri = diagsOf(P(`    <let a:int=0 reset-on=[@c]/>\n    <let b:int=0 reset-on=[@a]/>\n    <let c:int=0 reset-on=[@b]/>`, ""));
    expect(tri.map((d) => d.code)).toEqual(["E-RESET-ON-CYCLE"]);
    // negative: a chain is legal
    expect(codes(P(`    <let a:int=0 reset-on=[@b]/>\n    <let b:int=0 reset-on=[@c]/>\n    <let c:int=0/>`, ""))).toEqual([]);
  });

  test("E-RESET-ON-NOT-WRITABLE — a locked or a derived cell cannot be reset (rule 5)", () => {
    expect(codes(P(`${D}\n    <frozen:int=1 reset-on=[@query]/>`, ""))).toEqual(["E-RESET-ON-NOT-WRITABLE"]);
    expect(codes(P(`${D}\n    <twice:int=(@n * 2) reset-on=[@query]/>`, ""))).toEqual(["E-RESET-ON-NOT-WRITABLE"]);
    expect(diagsOf(P(`${D}\n    <frozen:int=1 reset-on=[@query]/>`, ""))[0].message).toMatch(/LOCKED.*make it writable/);
    // negative: a `let` cell, and a sequence whose type grants `replace`
    expect(codes(P(`${D}\n${page("reset-on=[@query]")}`, ""))).toEqual([]);
    expect(codes(P(`${D}\n    <xs:int[replace]=([1, 2]) reset-on=[@query]/>`, ""))).toEqual([]);
  });

  const engine = (rules) => `<program>\n    type Order:enum = { Draft, Placed, Shipped, Delivered }\n    <let customer:int=0/>\n    <order:Order=.Draft single reset-on=[@customer]>\n${rules}\n    </>\n    <main><p>order</p></main>\n</program>\n`;

  test("E-RESET-ON-ENGINE-REFUSED — a state whose `rule=` does not admit the reset target, each named (rule 6)", () => {
    const refused = diagsOf(engine(`        <Draft rule=.Placed/>\n        <Placed rule=(.Shipped | .Draft)/>\n        <Shipped rule=.Delivered/>\n        <Delivered/>`));
    expect(refused.map((d) => d.code)).toEqual(["E-RESET-ON-ENGINE-REFUSED"]);
    expect(refused[0].message).toContain("`.Shipped` has `rule=.Delivered`; it does not admit the reset target `.Draft`");
    expect(refused[0].message).toContain("`.Delivered` has no `rule=` (no outgoing edge); it does not admit the reset target `.Draft`");
    expect(refused[0].message).not.toContain("`.Placed` has");      // `.Placed` admits `.Draft`
    expect(refused[0].message).not.toContain("`.Draft` has");       // the target needs no self-edge
    // negative: every non-target state admits `.Draft`
    expect(codes(engine(`        <Draft rule=.Placed/>\n        <Placed rule=(.Shipped | .Draft)/>\n        <Shipped rule=(.Delivered | .Draft)/>\n        <Delivered rule=.Draft/>`))).toEqual([]);
  });

  test("a reset value that WRITES (an initializer calling a writer) is refused — the reset chain need not end (no §34 code: fail closed)", () => {
    // Found by measurement (s449): this compiled clean, and each reset re-ran bump(), which wrote the
    // trigger @q again — an endless reset loop at run time.
    const loop = diagsOf(P(`    <let q:int=0/>\n    function bump() -> int {\n        @q = @q + 1\n        return 1\n    }\n    <let page:int=(bump()) reset-on=[@q]/>`, ""));
    expect(loop.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(loop[0].message).toContain("re-evaluates its initializer at every reset, and that initializer writes `@q` (`bump() → @q`)");
    // a writer of an UNRELATED cell is refused too (the reset must write its own cell and nothing else)
    expect(codes(P(`    <let q:int=0/>\n    <let other:int=0/>\n    function note() -> int {\n        @other = 1\n        return 1\n    }\n    <let page:int=(note()) reset-on=[@q]/>`, ""))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    // fix round HIGH-1: the writer reached through a DERIVED cell the initializer reads (its formula runs on the read)
    const viaDerived = diagsOf(P(`    <let q:int=0/>\n    function g() -> int {\n        @q = @q + 1\n        return 1\n    }\n    <d:int=(@q + g())/>\n    <let page:int=(@d) reset-on=[@q]/>`, ""));
    expect(viaDerived.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(viaDerived[0].message).toContain("`formula of @d → g() → @q`");
    // negative: an initializer that calls a write-free function
    expect(codes(P(`    <let q:int=0/>\n    fn one() -> int { return 1 }\n    <let page:int=(one()) reset-on=[@q]/>`, ""))).toEqual([]);
  });

  test("a `reset-on=` on a declaration's field is refused — per-instance resets are OPEN (§6.8.4)", () => {
    const src = `<program>\n    <let query:string=""/>\n    <panel title:string>\n        <let page:int=1 reset-on=[@query]/>\n    </>\n    renders <div>\${page}</div>\n    <main><panel title="a"/></main>\n</program>\n`;
    const ds = diagsOf(src);
    expect(ds.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(ds[0].message).toMatch(/per-instance reset/);
  });
});

describe("Core check — C13 (ResetOn)", () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));

  test("no trigger, a trigger without a write capability, a reset that is not ONE Write, a cell listing itself", () => {
    const core = coreOf(SEARCH_PROGRAM);
    const none = clone(core);
    resets(none)[0].triggers = [];
    expect(mods.check.checkCore(none).join("\n")).toMatch(/C13: a ResetOn has no trigger/);

    const locked = clone(core);
    const prog = locked.decls[locked.decls.length - 1];
    prog.fields[resets(locked)[0].triggers[0].idx].wcap = null;
    prog.fields[resets(locked)[0].triggers[0].idx].grants = { replace: false, edits: [] };
    expect(mods.check.checkCore(locked).join("\n")).toMatch(/C13: a ResetOn trigger .* is not a mutable cell/);

    const two = clone(core);
    resets(two)[0].reset.stmts = [...resets(two)[0].reset.stmts, ...resets(two)[0].reset.stmts];
    expect(mods.check.checkCore(two).join("\n")).toMatch(/C13: a ResetOn's reset is 2 statements/);

    const selfRef = clone(core);
    const r = resets(selfRef)[0];
    r.triggers = [{ ...r.triggers[0], idx: 1 }];     // `page` (field 1) listed as its own trigger
    expect(mods.check.checkCore(selfRef).join("\n")).toMatch(/C13: a ResetOn on <program>\.page lists its own cell/);
  });
});
