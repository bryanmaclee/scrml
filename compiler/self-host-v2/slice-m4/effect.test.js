// effect.test.js — s449: `<effect deps=[…]>${ … }</>` (SPEC §6.7.4) end to end
// in the bootstrap — §66 source → parse → analyze → lower → Core (View.Effect)
// → check → print → the slice runtime in happy-dom — plus every code the
// section names, the no-write rule (the transitive write summary, failing
// closed), the soft-deprecated keyword spelling, the refusals (fail closed),
// Core checks C11 / C12, and the Suspend layer through the printer.
//
// An effect may not write reactive state, so a test cannot watch one through
// a cell. The bootstrap's host surface is one call, `Date.now()`; the effect
// bodies here call it (through `ping()`), and the test counts the calls — an
// outside-world action, which is exactly what an effect is for.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors, takePageErrors } from "../slice-m1/load-program.js";

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
const tick = () => new Promise((r) => setTimeout(r, 0));
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
const effects = (core) => walkCore(core, (n) => n.variant === "Effect").map((n) => n.data);

/** Count `Date.now()` calls — the outside-world action the effect bodies perform. */
function clockSpy() {
  const real = Date.now;
  const spy = { calls: 0, restore: () => { Date.now = real; } };
  Date.now = () => { spy.calls++; return real.call(Date); };
  return spy;
}
/** Click `label` and return how many effect runs (clock reads) it caused. */
function runsOn(label) {
  const spy = clockSpy();
  try { click(btn(label)); } finally { spy.restore(); }
  return spy.calls;
}

const PING = `    function ping() {\n        const t = Date.now()\n    }`;

// ===========================================================================
// The empirical programs (also pasted, with their output, in
// docs/changes/s449-bootstrap-effect/progress.md).
// ===========================================================================
export const TOP_PROGRAM = `<program>
    <let price:int=10/>
    <let qty:int=2/>
    <total:int=(@price * @qty)/>
    function ping() {
        const t = Date.now()
    }

    <effect deps=[@price]>\${ ping() }</>

    <main>
        <p class="out">\${@total}</p>
        <button onclick=(@price = @price + 1)>price</button>
        <button onclick=(@qty = @qty + 1)>qty</button>
        <button onclick=(@price = @price)>same</button>
    </main>
</program>
`;

export const SCOPED_PROGRAM = `<program>
    <let n:int=0/>
    <let show:bool=true/>
    function ping() {
        const t = Date.now()
    }

    <main>
        <section if=@show><effect deps=[@n]>\${ ping() }</><b>mounted</b></section>
        <p class="out">\${@n}</p>
        <button onclick=(@n = @n + 1)>inc</button>
        <button onclick=(@show = !@show)>toggle</button>
    </main>
</program>
`;

describe("§6.7.4 — an `<effect>` at the program body top", () => {
  test("Core: one View.Effect with one dependency (the `let` cell), the body lowered", () => {
    const core = coreOf(TOP_PROGRAM);
    const es = effects(core);
    expect(es.length).toBe(1);
    expect(es[0].deps.length).toBe(1);
    expect(es[0].body.stmts.length).toBe(1);
  });

  test("printed: `rt.effectOn(scope$, [<the cell>], () => { … })` — readable, the cell itself as the dependency", async () => {
    const { out } = await loadProgram(coreOf(TOP_PROGRAM), "effect-print");
    expect(out.js).toContain("rt.effectOn(scope$, [inst$.fields[0 /* price */]], () => {\n    ping();\n  });");
  });

  test("runs: NOT on mount; once per change of the listed cell; an unlisted read never triggers; a same-value write is no change", async () => {
    const spy = clockSpy();
    let mountRuns;
    try { await loadProgram(coreOf(TOP_PROGRAM), "effect-top"); } finally { mountRuns = spy.calls; spy.restore(); }
    expect(mountRuns).toBe(0);                        // S447 2b: does not run on mount
    expect(runsOn("price")).toBe(1);
    expect($("p.out").textContent).toBe("22");
    expect(runsOn("qty")).toBe(0);                    // @qty is read (through @total) but not listed
    expect(runsOn("same")).toBe(0);                   // a write of the same value is not a change
    expect(runsOn("price")).toBe(1);
  });
});

describe("§6.7.4 Scope and teardown — an `<effect>` inside an `if=` element", () => {
  test("Core: the Effect sits in the Cond arm's views (owned by the arm's scope)", () => {
    const core = coreOf(SCOPED_PROGRAM);
    const conds = walkCore(core, (n) => n.variant === "Cond").map((n) => n.data);
    expect(conds.length).toBe(1);
    expect(effects(conds[0]).length).toBe(1);
  });

  test("fires while mounted; closing unregisters it (it stops firing); reopening re-registers ONE, without running", async () => {
    const { rt } = await loadProgram(coreOf(SCOPED_PROGRAM), "effect-scoped");
    expect(rt.stats.depEffects).toBe(1);
    expect(runsOn("inc")).toBe(1);
    expect(runsOn("toggle")).toBe(0);                 // closing the section runs nothing
    expect($("section")).toBe(null);
    expect(rt.stats.depEffects).toBe(0);
    expect(runsOn("inc")).toBe(0);                    // stopped firing
    expect(runsOn("inc")).toBe(0);
    expect(runsOn("toggle")).toBe(0);                 // re-registered WITHOUT running
    expect(rt.stats.depEffects).toBe(1);              // one registration, not two
    expect(runsOn("inc")).toBe(1);                    // exactly one run per change
  });
});

describe("§6.7.4 — forms", () => {
  test("two dependencies; one handler batch writing both runs the body once", async () => {
    const src = P(`    <let a:int=0/>\n    <let b:int=0/>\n${PING}\n    function both() {\n        @a = @a + 1\n        @b = @b + 1\n    }\n    <effect deps=[@a, @b]>\${ ping() }</>`,
      `        <button onclick=(@a = @a + 1)>a</button>\n        <button onclick=(@b = @b + 10)>b</button>\n        <button onclick=both()>both</button>`);
    const core = coreOf(src);
    expect(effects(core)[0].deps.length).toBe(2);
    await loadProgram(core, "effect-multi");
    expect(runsOn("a")).toBe(1);
    expect(runsOn("b")).toBe(1);
    expect(runsOn("both")).toBe(1);                    // a handler is one batch
  });

  test("an `<effect>` in an <each> row is one effect per row, unregistered with its row", async () => {
    const src = P(`    type Row:struct = { id: int }\n    <rows:Row[replace]=([{ id: 1 }, { id: 2 }])/>\n    <let n:int=0/>\n${PING}\n    function drop() { @rows = [{ id: 1 }] }`,
      `        <ul><each in=@rows key=@.id as r><li class="row">\${r.id}<effect deps=[@n]>\${ ping() }</></li></each></ul>\n        <button onclick=(@n = @n + 1)>inc</button>\n        <button onclick=drop()>drop</button>`);
    const { rt } = await loadProgram(coreOf(src), "effect-each");
    expect(rt.stats.depEffects).toBe(2);
    expect(runsOn("inc")).toBe(2);
    expect(runsOn("drop")).toBe(0);
    expect(rt.stats.depEffects).toBe(1);
    expect(runsOn("inc")).toBe(1);
  });

  test("the body may read row bindings, read unlisted cells, call write-free functions and the host", async () => {
    const src = P(`    <let n:int=0/>\n    <let k:int=5/>\n    fn dbl(x: int) -> int { return x * 2 }\n    function stamp(v: int) {\n        const t = Date.now()\n        const w = dbl(v)\n    }\n    <effect deps=[@n]>\${\n        const sum = @n + @k\n        stamp(sum)\n    }</>`,
      `        <button onclick=(@n = @n + 1)>inc</button>`);
    await loadProgram(coreOf(src), "effect-calls");
    expect(runsOn("inc")).toBe(1);
  });

  test("a self-closing `<effect deps=[…]/>` is an empty body (W-LIFECYCLE-010) and still lowers", () => {
    const r = run(P(`    <let n:int=0/>\n    <effect deps=[@n]/>`, ""));
    expect(r.diags.map((d) => d.code)).toEqual(["W-LIFECYCLE-010"]);
    expect(effects(r.core).length).toBe(1);
  });
});

describe("§6.7.4 the retiring keyword form — `when … changes { }` parses identically (§63 Stage 1)", () => {
  const KEYWORD = `<program>\n    <let n:int=0/>\n    <let show:bool=true/>\n${PING}\n    <main>\n        <section if=@show>\${ when @n changes { ping() } }</section>\n        <button onclick=(@n = @n + 1)>inc</button>\n        <button onclick=(@show = !@show)>toggle</button>\n    </main>\n</program>\n`;

  test("W-WHEN-EFFECT-DEPRECATED at every site, naming the canonical `<effect>` spelling", () => {
    const ds = diagsOf(KEYWORD);
    expect(ds.map((d) => d.code)).toEqual(["W-WHEN-EFFECT-DEPRECATED"]);
    expect(ds[0].message).toContain("`<effect deps=[@n]>");
    expect(codes(P(`    <let a:int=0/>\n    <let b:int=0/>\n${PING}\n    when (@a, @b) changes {\n        ping()\n    }`, ""))).toEqual(["W-WHEN-EFFECT-DEPRECATED"]);
  });

  test("same Core, same runtime: no mount run, teardown with the `if=` region", async () => {
    const r = run(KEYWORD);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    expect(effects(r.core).length).toBe(1);
    const spy = clockSpy();
    let mountRuns;
    let loaded;
    try { loaded = await loadProgram(r.core, "effect-keyword"); } finally { mountRuns = spy.calls; spy.restore(); }
    expect(mountRuns).toBe(0);
    expect(runsOn("inc")).toBe(1);
    runsOn("toggle");
    expect(loaded.rt.stats.depEffects).toBe(0);
    expect(runsOn("inc")).toBe(0);
  });

  test("the SAME no-write rule — a writing keyword body is E-EFFECT-WRITES-STATE now (RULED S447), plus the deprecation", () => {
    const ds = diagsOf(P(`    <let n:int=0/>\n    <let hits:int=0/>\n    when @n changes {\n        @hits = @hits + 1\n    }`, ""));
    expect(ds.map((d) => d.code).sort()).toEqual(["E-EFFECT-WRITES-STATE", "W-WHEN-EFFECT-DEPRECATED"]);
    expect(ds.find((d) => d.code === "E-EFFECT-WRITES-STATE").message).toMatch(/`when … changes` effect writes `@hits`/);
  });

  test("syntax: `()`, a missing `changes`, a non-`@` entry, and the retired `reads` clause are parse errors", () => {
    const D = `    <let n:int=0/>\n${PING}`;
    expect(codes(P(`${D}\n    when () changes {\n        ping()\n    }`, ""))).toContain("E-PARSE-WHEN");
    expect(codes(P(`${D}\n    when @n {\n        ping()\n    }`, ""))).toContain("E-PARSE-WHEN");
    expect(codes(P(`${D}\n    when (@n, m) changes {\n        ping()\n    }`, ""))).toContain("E-PARSE-WHEN");
    const reads = diagsOf(P(`${D}\n    <let q:int=0/>\n    when @n changes reads @q {\n        ping()\n    }`, ""));
    expect(reads.map((d) => d.code)).toContain("E-PARSE-WHEN");
    expect(reads.find((d) => d.code === "E-PARSE-WHEN").message).toMatch(/`reads` clause is retired.*needs no annotation/);
  });

  test("`when` stays an ordinary name where it is not a `when … changes` statement", () => {
    expect(codes(P(`    <let m:int=0/>\n    fn when(x: int) -> int { return x }\n    function g() { @m = when(1) }`, ""))).toEqual([]);
  });
});

describe("§6.7.4 — codes", () => {
  const D = `    <let n:int=0/>\n    <let m:int=0/>\n    <step=1/>\n    <dbl:int=(@n * 2)/>\n${PING}`;
  const body = `>\${ ping() }</>`;

  test("E-EFFECT-NO-DEPS — no `deps=`, or `deps=[]` (an effect never runs on mount, so it would never run)", () => {
    expect(codes(P(D, "") .replace("<main>", `<effect${body}\n    <main>`))).toEqual(["E-EFFECT-NO-DEPS"]);
    expect(codes(P(`${D}\n    <effect deps=[]${body}`, ""))).toEqual(["E-EFFECT-NO-DEPS"]);
    // negative: one dependency is enough
    expect(codes(P(`${D}\n    <effect deps=[@n]${body}`, ""))).toEqual([]);
  });

  test("E-LIFECYCLE-007 — an entry that is not a declared mutable cell: undeclared, non-`@`, locked, derived", () => {
    expect(codes(P(`${D}\n    <effect deps=[@nope]${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    <effect deps=[n]${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    <effect deps=[@step]${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    <effect deps=[@dbl]${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    <effect deps=[@n, @dbl]${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(diagsOf(P(`${D}\n    <effect deps=[@dbl]${body}`, ""))[0].message).toMatch(/DERIVED/);
    // negative: a `let` cell
    expect(codes(P(`${D}\n    <effect deps=[@m]${body}`, ""))).toEqual([]);
  });

  test("E-LIFECYCLE-016 — an effect inside another effect's body, in either spelling", () => {
    expect(codes(P(`${D}\n    <effect deps=[@n]>\${\n        ping()\n        <effect deps=[@m]>\${ ping() }</>\n    }</>`, ""))).toEqual(["E-LIFECYCLE-016"]);
    expect(codes(P(`${D}\n    <effect deps=[@n]>\${\n        ping()\n        when @m changes { ping() }\n    }</>`, ""))).toEqual(["E-LIFECYCLE-016"]);
    // negative: two SIBLING effects are fine
    expect(codes(P(`${D}\n    <effect deps=[@n]${body}\n    <effect deps=[@m]${body}`, ""))).toEqual([]);
  });

  test("W-LIFECYCLE-010 — an empty body, `/>` or `${ }` (a warning; the program still lowers)", () => {
    expect(codes(P(`${D}\n    <effect deps=[@n]/>`, ""))).toEqual(["W-LIFECYCLE-010"]);
    expect(codes(P(`${D}\n    <effect deps=[@n]>\${ }</>`, ""))).toEqual(["W-LIFECYCLE-010"]);
    expect(codes(P(`${D}\n    <effect deps=[@n]${body}`, ""))).toEqual([]);
  });

  test("E-PARSE-EFFECT — an attribute other than `deps=`, a non-list `deps=`, markup or text in the body", () => {
    expect(codes(P(`${D}\n    <effect deps=[@n] id="x"${body}`, ""))).toContain("E-PARSE-EFFECT");
    expect(codes(P(`${D}\n    <effect deps=@n${body}`, ""))).toContain("E-PARSE-EFFECT");
    expect(codes(P(`${D}\n    <effect deps=[@n]>hello</>`, ""))).toContain("E-PARSE-EFFECT");
    expect(codes(P(`${D}\n    <effect deps=[@n]>\${ ping() }<b>x</b></>`, ""))).toContain("E-PARSE-EFFECT");
  });
});

describe("§6.7.4 the no-write rule — E-EFFECT-WRITES-STATE (the transitive write summary)", () => {
  const D = `    <let query:string=""/>\n    <let page:int=1/>\n    <let hits:int=0/>\n    <xs:int[free, append]=[]/>\n${PING}`;
  const writes = (bodyOrDecls, eff) => diagsOf(P(`${D}\n${bodyOrDecls}\n    ${eff}`, ""));
  const W = (src) => src.map((d) => d.code);

  test("rule 1: a direct write in the body — assignment, `reset`, an edit call — each is an error", () => {
    expect(W(writes("", `<effect deps=[@query]>\${ @page = 1 }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(W(writes("", `<effect deps=[@query]>\${ reset(@page) }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(W(writes("", `<effect deps=[@query]>\${ @xs.push(1) }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(W(writes("", `<effect deps=[@query]>\${\n        if (@page > 1) {\n            @hits = @hits + 1\n        }\n    }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
  });

  test("the message names the cell and the fix BY SHAPE (S447 1a): reset → `reset-on=`; a call result → `<request>`; otherwise → the writer / derive", () => {
    const reset = writes("", `<effect deps=[@query]>\${ @page = 1 }</>`)[0].message;
    expect(reset).toContain("writes `@page`");
    expect(reset).toContain("declare it on the cell: `reset-on=[@query]` (§6.8.4)");
    expect(writes("", `<effect deps=[@query]>\${ reset(@page) }</>`)[0].message).toContain("`reset-on=[@query]`");
    const req = writes(`    fn load(q: string) -> int { return 3 }`, `<effect deps=[@query]>\${ @page = load(@query) }</>`)[0].message;
    expect(req).toContain("`<request>`'s job");
    const other = writes("", `<effect deps=[@query]>\${ @hits = @hits + 1 }</>`)[0].message;
    expect(other).toContain("Move the write into the code that writes the trigger");
  });

  test("rule 2: a write THROUGH a called function — one level and two — names the call chain down to the write", () => {
    const one = writes(`    function logFilter() {\n        @hits = @hits + 1\n    }`, `<effect deps=[@query]>\${ logFilter() }</>`);
    expect(W(one)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(one[0].message).toContain("`logFilter() → @hits`");
    // mutation RED (bite proof, progress.md): `propagated` returning `s` unchanged — the summary no
    // longer reaches through a call, so `track()` (which writes nothing itself) looks write-free
    const two = writes(`    function logFilter() {\n        @hits = @hits + 1\n    }\n    function track() {\n        logFilter()\n    }`, `<effect deps=[@query]>\${ track() }</>`);
    expect(W(two)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(two[0].message).toContain("`track() → logFilter() → @hits`");
  });

  test("across a module boundary: a writer imported from a `.scrml` library is summarized too (its body is linked)", () => {
    const lib = `// lib/log.scrml\nexport <counter let n:int=0/>\nexport function bumpCount() { @counter.n = @counter.n + 1 }\nexport function readCount() { const c = @counter.n }\n`;
    const app = (call) => `<program>\n    \${ import { bumpCount, readCount } from "./lib/log.scrml" }\n    <let query:string=""/>\n    <effect deps=[@query]>\${ ${call} }</>\n    <main></main>\n</program>\n`;
    const files = (call) => [{ path: "lib/log.scrml", src: lib }, { path: "app.scrml", src: app(call) }];
    const ds = frontEnd(mods, files("bumpCount()")).diags;
    expect(ds.map((d) => d.code)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(ds[0].message).toContain("`bumpCount() → @counter.n`");
    expect(frontEnd(mods, files("readCount()")).diags.map((d) => d.code)).toEqual([]);
  });

  test("a read that CONSTRUCTS a shared instance runs its initializers — a `let` seed calling a writer is a write of the effect", async () => {
    // Found by measurement (s449): this program compiled clean, and one click wrote `@a` from inside the
    // effect body (`shared_box()` constructed `box` on first read; its seed ran `bumpA()`).
    const decls = `    <let a:int=0/>\n    function bumpA() -> int {\n        @a = @a + 1\n        return 1\n    }\n    <box let k:int=(bumpA())/>\n    renders <div>\${k}</div>`;
    const ds = writes(decls, `<effect deps=[@query]>\${\n        const v = @box.k\n    }</>`);
    expect(W(ds)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(ds[0].message).toContain("`construction of <box> → bumpA() → @a`");
    // …and through a function that reads it
    expect(W(writes(`${decls}\n    function peek() -> int { return @box.k }`, `<effect deps=[@query]>\${\n        const v = peek()\n    }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    // …and through a declaration the constructed one renders (built with it)
    const nested = `    <let a:int=0/>\n    function bumpA() -> int {\n        @a = @a + 1\n        return 1\n    }\n    <inner let k:int=(bumpA())/>\n    renders <i>\${k}</i>\n    <outer let j:int=0/>\n    renders <div><inner/></div>`;
    expect(W(writes(nested, `<effect deps=[@query]>\${\n        const v = @outer.j\n    }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    // negative: a shared instance whose initializers write nothing
    expect(W(writes(`    <box let k:int=3/>\n    renders <div>\${k}</div>`, `<effect deps=[@query]>\${\n        const v = @box.k\n    }</>`))).toEqual([]);
  });

  test("recursion: the summary is a fixed point — mutual recursion that writes is found; that does not, is clean", () => {
    const rec = `    function a(k: int) {\n        if (k > 0) {\n            b(k - 1)\n        }\n    }\n    function b(k: int) {\n        a(k)\n        @hits = k\n    }`;
    expect(W(writes(rec, `<effect deps=[@query]>\${ a(3) }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
    const pure = `    function c(k: int) {\n        if (k > 0) {\n            d(k - 1)\n        }\n    }\n    function d(k: int) {\n        c(k)\n        const t = Date.now()\n    }`;
    expect(W(writes(pure, `<effect deps=[@query]>\${ c(3) }</>`))).toEqual([]);
  });

  test("rule 3: a function VALUE counts as called — an arrow function's call inside `.map` reaches a writer", () => {
    const decls = `    <ids:int[]=([1, 2])/>\n    function bump(x: int) -> int {\n        @hits = @hits + x\n        return x\n    }`;
    const ds = writes(decls, `<effect deps=[@query]>\${\n        const ys = @ids.map(x => bump(x))\n    }</>`);
    expect(W(ds)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(ds[0].message).toContain("`bump() → @hits`");
    // a writer NAMED as a value, never called in scrml — whatever receives it may call it
    const named = writes(`    function logFilter() {\n        @hits = @hits + 1\n    }`, `<effect deps=[@query]>\${\n        const handler = logFilter\n    }</>`);
    expect(W(named)).toEqual(["E-EFFECT-WRITES-STATE"]);
    expect(named[0].message).toContain("hands `logFilter` on as a function value");
  });

  test("negatives: writing a local, calling a write-free `function` / `fn`, the host — all clean", () => {
    expect(W(writes(`    fn dbl(x: int) -> int { return x * 2 }\n    function readOnly() {\n        const v = @page + 1\n        const t = Date.now()\n    }`,
      `<effect deps=[@query]>\${\n        let local = 0\n        local = dbl(@page)\n        readOnly()\n        ping()\n    }</>`))).toEqual([]);
  });

  test("a write to a cell an effect LISTS is the same error (E-LIFECYCLE-006 is subsumed)", () => {
    expect(W(writes("", `<effect deps=[@page]>\${ @page = @page + 1 }</>`))).toEqual(["E-EFFECT-WRITES-STATE"]);
  });

  test("a write the binder refuses (a locked cell) is still a write of the effect", () => {
    const ds = writes(`    <locked=3/>`, `<effect deps=[@query]>\${ @locked = 4 }</>`);
    expect(W(ds)).toContain("E-EFFECT-WRITES-STATE");
  });
});

describe("§6.7.4 rule 4 — E-EFFECT-WRITE-UNPROVEN (fails closed)", () => {
  const D = `    <let query:string=""/>\n${PING}`;

  test("a call through a local holding a function value — the compiler cannot resolve it", () => {
    const ds = diagsOf(P(`${D}\n    <effect deps=[@query]>\${\n        const g = ping\n        g()\n    }</>`, ""));
    expect(ds.map((d) => d.code)).toEqual(["E-EFFECT-WRITE-UNPROVEN"]);
    expect(ds[0].message).toMatch(/`g\(…\)` calls through `g`.*fails closed/);
  });

  test("…reached through a called function: the message names the chain", () => {
    const ds = diagsOf(P(`${D}\n    function viaLocal() {\n        const g = ping\n        g()\n    }\n    <effect deps=[@query]>\${ viaLocal() }</>`, ""));
    expect(ds.map((d) => d.code)).toEqual(["E-EFFECT-WRITE-UNPROVEN"]);
    expect(ds[0].message).toContain("through `viaLocal()`");
  });

  test("negative: the same function called by its name is proven write-free", () => {
    expect(codes(P(`${D}\n    <effect deps=[@query]>\${ ping() }</>`, ""))).toEqual([]);
  });
});

describe("fail closed — forms the bootstrap does not lower are refused, never dropped", () => {
  const D = `    <let n:int=0/>\n    <let m:int=0/>\n${PING}`;
  const E = `<effect deps=[@n]>\${ ping() }</>`;

  test("an effect in a function body / a handler block", () => {
    expect(codes(P(`${D}\n    function f() {\n        ${E}\n    }`, ""))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(D, `        <button onclick={ when @n changes { ping() } }>x</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("an effect in a user declaration's renders", () => {
    const src = `<program>\n    <let n:int=0/>\n    function ping() {\n        const t = Date.now()\n    }\n    <box let k:int=0/>\n    renders <div><effect deps=[@n]>\${ ping() }</></div>\n    <main><*box/></main>\n</program>\n`;
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toMatch(/renders/);
  });

  test("a dependency naming a whole instance (`@decl`)", () => {
    const src = `<program>\n    <box let k:int=0/>\n    function ping() {\n        const t = Date.now()\n    }\n    <effect deps=[@box]>\${ ping() }</>\n    <main></main>\n</program>\n`;
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toMatch(/whole instance/);
  });

  // Slot content is rendered once per `<slot/>` in the renders — with none the effect would be
  // dropped, with two it would run twice per change. Refused.
  const slotProg = (renders) => `<program>\n${D}\n    <card title:string/>\n    renders ${renders}\n    <main>\n        <card title="a"><b>x</b>${E}</card>\n    </main>\n</program>\n`;

  test("an effect in use-site slot content — renders with NO <slot/> (would be dropped), with TWO (would run twice)", () => {
    for (const renders of ["<div>card</div>", "<div><slot/><slot/></div>"]) {
      const r = run(slotProg(renders));
      expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(r.diags[0].message).toMatch(/slot content/);
    }
  });

  // `<slot>` FALLBACK content has no Core form and SPEC §66.15.2 rules only `<slot/>`.
  const fallbackProg = (fallback) => `<program>\n${D}\n    <card title:string/>\n    renders <div><slot>${fallback}</slot></div>\n    <main>\n        <card title="a"></card>\n    </main>\n</program>\n`;

  test("slot fallback content — an effect, an unresolved read, plain markup — is refused; an empty slot is a slot", () => {
    // mutation RED: resolveElem returning MSlot for `slot` without resolveSlot
    for (const fb of [E, "${@nope}", "<b>default</b>", "default"]) {
      const r = run(fallbackProg(fb));
      expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(r.diags[0].message).toMatch(/inside `<slot>…<\/slot>`/);
    }
    expect(codes(fallbackProg(""))).toEqual([]);
    expect(codes(fallbackProg("\n        "))).toEqual([]);
  });

  test("a `${…}` block in markup holding anything after its `when`", () => {
    expect(codes(P(D, `        <div>\${ when @n changes {\n            ping()\n        } @m = 3 }</div>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });

  test("an effect outside `<program>`", () => {
    expect(codes(`${E}\n<program>\n${D}\n    <main></main>\n</program>\n`)).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

describe("Core checks — C11 (Effect) and C12 (Suspend placement)", () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const src = P(`    <let n:int=0/>\n    <let m:int=0/>\n${PING}\n    function bump() { @m = @m + 1 }`, `        <div><effect deps=[@n]>\${ ping() }</></div>\n        <button onclick=bump()>b</button>`);

  test("C11: an empty dependency list, a dependency without a write capability, a body that writes — directly or through a call", () => {
    const core = coreOf(src);
    const empty = clone(core);
    effects(empty)[0].deps = [];
    expect(mods.check.checkCore(empty).join("\n")).toMatch(/C11: an Effect has an empty dependency list/);

    const locked = clone(core);
    const prog = locked.decls[locked.decls.length - 1];
    const dep = effects(locked)[0].deps[0];
    prog.fields[dep.idx].wcap = null;
    prog.fields[dep.idx].grants = { replace: false, edits: [] };
    expect(mods.check.checkCore(locked).join("\n")).toMatch(/C11: an Effect dependency .* is not a mutable cell/);

    // the handler's body is a Write of @m and a call of `bump` — graft each into the effect body
    const handler = walkCore(core, (n) => n.variant === "On")[0].data.body;
    const bumpFn = core.fns.find((f) => f.sym.hint === "bump");
    const direct = clone(core);
    effects(direct)[0].body = clone(bumpFn.body);
    expect(mods.check.checkCore(direct).join("\n")).toMatch(/C11: an Effect body writes reactive state — a Write of <program>\.m/);
    const through = clone(core);
    effects(through)[0].body = clone(handler);
    expect(mods.check.checkCore(through).join("\n")).toMatch(/C11: an Effect body writes reactive state — through `bump\(\)`: a Write of <program>\.m/);
  });

  test("C11: a body that reads a shared instance whose construction writes (a seed calling a writer) — through a call", () => {
    const cons = P(`    <let n:int=0/>\n    <let a:int=0/>\n${PING}\n    function bumpA() -> int {\n        @a = @a + 1\n        return 1\n    }\n    <box let k:int=(bumpA())/>\n    renders <div>\${k}</div>\n    function peek() {\n        const v = @box.k\n    }`,
      `        <div><effect deps=[@n]>\${ ping() }</></div>\n        <button onclick=peek()>p</button>`);
    const core = coreOf(cons);
    const handler = walkCore(core, (n) => n.variant === "On")[0].data.body;
    const grafted = clone(core);
    effects(grafted)[0].body = clone(handler);
    expect(mods.check.checkCore(grafted).join("\n")).toMatch(/C11: an Effect body writes reactive state — through `peek\(\)`: through the construction of <box>: through `bumpA\(\)`: a Write of <program>\.a/);
  });

  test("C12: a Suspend at the tail of an Effect body is legal; anywhere else it is not", () => {
    const core = coreOf(src);
    const ok = clone(core);
    const e = effects(ok)[0];
    e.body.stmts = [{ variant: "Suspend", data: { bind: { id: 90001, hint: "v" }, on: { variant: "Lit", data: { lit: { variant: "Int", data: { v: 1 } } } }, then: { stmts: e.body.stmts } } }];
    expect(mods.check.checkCore(ok)).toEqual([]);

    const notLast = clone(ok);
    const e2 = effects(notLast)[0];
    e2.body.stmts = [...e2.body.stmts, ...e2.body.stmts[0].data.then.stmts];
    expect(mods.check.checkCore(notLast).join("\n")).toMatch(/C12: 1 Suspend/);
  });
});

describe("the Suspend layer through the printer (no source form until server calls land)", () => {
  // The SCOPED program with its effect body rewritten in Core to
  //   Suspend(v, <a host value>, { …the original body… })
  // so the outside-world action happens only after the suspension settles.
  function suspended(onValue) {
    const core = JSON.parse(JSON.stringify(coreOf(SCOPED_PROGRAM)));
    const e = effects(core)[0];
    e.body.stmts = [{ variant: "Suspend", data: { bind: { id: 90002, hint: "v" }, on: onValue, then: { stmts: e.body.stmts } } }];
    expect(mods.check.checkCore(core)).toEqual([]);
    return core;
  }
  const settled = { variant: "Lit", data: { lit: { variant: "Str", data: { v: "settled" } } } };

  test("the printed effect suspends: the action lands after the value settles", async () => {
    const { out } = await loadProgram(suspended(settled), "effect-suspend");
    expect(out.js).toContain("rt.effectOn(scope$, [inst$.fields[0 /* n */]], task$ => {");
    expect(out.js).toContain(`rt.suspend(task$, "settled", v => {`);
    const spy = clockSpy();
    try {
      click(btn("inc"));
      expect(spy.calls).toBe(0);
      await tick();
      expect(spy.calls).toBe(1);
    } finally { spy.restore(); }
  });

  test("closing the scope while the effect is suspended cancels it — it never resumes", async () => {
    const { rt } = await loadProgram(suspended(settled), "effect-suspend-cancel");
    const spy = clockSpy();
    try {
      click(btn("inc"));
      click(btn("toggle"));                           // destroy the section while the run is suspended
      expect(rt.stats.depEffects).toBe(0);
      await tick();
      await tick();
      expect(spy.calls).toBe(0);
    } finally { spy.restore(); }
    expect(takePageErrors()).toEqual([]);
  });

  test("the newest run wins: two changes while suspended — only the newest continuation runs", async () => {
    await loadProgram(suspended(settled), "effect-suspend-newest");
    const spy = clockSpy();
    try {
      click(btn("inc"));
      click(btn("inc"));                               // the second run cancels the first's continuation
      await tick();
      await tick();
      expect(spy.calls).toBe(1);
    } finally { spy.restore(); }
  });
});
