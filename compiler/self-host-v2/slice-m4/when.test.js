// when.test.js — s446 (U0): `when <deps> changes { body }` (SPEC §6.7.4)
// end-to-end in the bootstrap — §66 source → parse → analyze → lower → Core
// (View.When) → check → print → the slice runtime in happy-dom — plus the
// codes, the refusals (fail closed), the Core checks C11 / C12 and the
// Suspend layer through the printer.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors, takePageErrors } from "../slice-m1/load-program.js";

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
const whens = (core) => walkCore(core, (n) => n.variant === "When").map((n) => n.data);

// ===========================================================================
// The two empirical programs (also pasted, with their output, in
// docs/changes/s446-bootstrap-u0-when-effects/progress.md).
// ===========================================================================
export const DERIVED_PROGRAM = `<program>
    <let price:int=10/>
    <let qty:int=2/>
    <total:int=(@price * @qty)/>
    <let lastTotal:int=0/>
    <let runs:int=0/>

    when @price changes {
        @lastTotal = @total
        @runs = @runs + 1
    }

    <main>
        <p class="out">\${@runs} \${@lastTotal}</p>
        <button onclick=(@price = @price + 1)>price</button>
        <button onclick=(@qty = @qty + 1)>qty</button>
    </main>
</program>
`;

export const SCOPED_PROGRAM = `<program>
    <let n:int=0/>
    <let hits:int=0/>
    <let last:int=0/>
    <let show:bool=true/>

    <main>
        <section if=@show>\${ when @n changes {
            @hits = @hits + 1
            @last = @n
        } }<b>mounted</b></section>
        <p class="out">\${@hits} \${@last}</p>
        <button onclick=(@n = @n + 1)>inc</button>
        <button onclick=(@show = !@show)>toggle</button>
    </main>
</program>
`;

describe("§6.7.4 — a `when` at the program body top, reading a derived value", () => {
  test("Core: one View.When with one dep (the `let` cell), the body lowered", () => {
    const core = coreOf(DERIVED_PROGRAM);
    const ws = whens(core);
    expect(ws.length).toBe(1);
    expect(ws[0].deps.length).toBe(1);
    expect(ws[0].body.stmts.length).toBe(2);
  });

  test("runs: not on mount; once per change of the dep; an unlisted read never triggers; the derived read is fresh", async () => {
    await loadProgram(coreOf(DERIVED_PROGRAM), "when-derived");
    expect($("p.out").textContent).toBe("0 0");      // the body did NOT run on mount
    click(btn("price"));                              // price 11 → total 22, read in the body
    expect($("p.out").textContent).toBe("1 22");
    click(btn("qty"));                                // @qty is read (through @total) but not listed
    expect($("p.out").textContent).toBe("1 22");
    click(btn("price"));                              // price 12, qty 3 → 36
    expect($("p.out").textContent).toBe("2 36");
  });
});

describe("§6.7.2 — a `when` in an `if=` scope", () => {
  test("Core: the When sits in the Cond arm's views (owned by the arm's scope)", () => {
    const core = coreOf(SCOPED_PROGRAM);
    const conds = walkCore(core, (n) => n.variant === "Cond").map((n) => n.data);
    expect(conds.length).toBe(1);
    expect(whens(conds[0]).length).toBe(1);
  });

  test("runs: fires while mounted; destroy unregisters it (it stops firing); remount registers ONE again", async () => {
    const { rt } = await loadProgram(coreOf(SCOPED_PROGRAM), "when-scoped");
    const base = rt.stats.whens;
    expect(base).toBe(1);
    expect($("p.out").textContent).toBe("0 0");
    click(btn("inc"));
    expect($("p.out").textContent).toBe("1 1");
    click(btn("toggle"));                            // destroy the section scope
    expect($("section")).toBe(null);
    expect(rt.stats.whens).toBe(0);
    click(btn("inc"));
    click(btn("inc"));
    expect($("p.out").textContent).toBe("1 1");      // stopped firing
    click(btn("toggle"));                            // remount
    expect(rt.stats.whens).toBe(1);                  // one registration, not two
    click(btn("inc"));
    expect($("p.out").textContent).toBe("2 4");      // exactly one run per change
  });
});

describe("§6.7.4 — forms", () => {
  test("a parenthesized dep-list; one batch writing two deps runs the body once", async () => {
    const src = P(`    <let a:int=0/>\n    <let b:int=0/>\n    <let runs:int=0/>\n    <let sum:int=0/>\n    when (@a, @b) changes {\n        @runs = @runs + 1\n        @sum = @a + @b\n    }\n    function both() {\n        @a = @a + 1\n        @b = @b + 1\n    }`,
      `        <p class="out">\${@runs} \${@sum}</p>\n        <button onclick=(@a = @a + 1)>a</button>\n        <button onclick=(@b = @b + 10)>b</button>\n        <button onclick=both()>both</button>`);
    const core = coreOf(src);
    expect(whens(core)[0].deps.length).toBe(2);
    await loadProgram(core, "when-multi");
    click(btn("a"));
    click(btn("b"));
    expect($("p.out").textContent).toBe("2 11");
    click(btn("both"));                               // a handler is one batch
    expect($("p.out").textContent).toBe("3 13");
  });

  test("`reads` is informational: parsed and resolved, no trigger, no semantics", async () => {
    const src = P(`    <let a:int=0/>\n    <let q:int=5/>\n    <let got:int=0/>\n    <let runs:int=0/>\n    when @a changes reads @q {\n        @got = @q\n        @runs = @runs + 1\n    }`,
      `        <p class="out">\${@runs} \${@got}</p>\n        <button onclick=(@a = @a + 1)>a</button>\n        <button onclick=(@q = @q + 1)>q</button>`);
    const core = coreOf(src);
    expect(whens(core)[0].deps.length).toBe(1);
    await loadProgram(core, "when-reads");
    click(btn("q"));
    expect($("p.out").textContent).toBe("0 0");
    click(btn("a"));
    expect($("p.out").textContent).toBe("1 6");
    expect(codes(P(`    <let a:int=0/>\n    <let b:int=0/>\n    when @a changes reads @nope {\n        @b = 1\n        @b = 2\n    }`, ""))).toEqual(["E-SCOPE-001"]);
  });

  test("a `${ when }` in an <each> row registers per row and is disposed with the row", async () => {
    const src = P(`    type Row:struct = { id: int }\n    <rows:Row[replace]=([{ id: 1 }, { id: 2 }])/>\n    <let n:int=0/>\n    <let hits:int=0/>\n    <let seen:int=0/>\n    function drop() { @rows = [{ id: 1 }] }`,
      `        <ul><each in=@rows key=@.id as r><li class="row">\${r.id}\${ when @n changes {\n            @hits = @hits + 1\n            @seen = @n\n        } }</li></each></ul>\n        <p class="out">\${@hits}</p>\n        <button onclick=(@n = @n + 1)>inc</button>\n        <button onclick=drop()>drop</button>`);
    const { rt } = await loadProgram(coreOf(src), "when-each");
    expect(rt.stats.whens).toBe(2);
    click(btn("inc"));
    expect($("p.out").textContent).toBe("2");
    click(btn("drop"));
    expect(rt.stats.whens).toBe(1);
    click(btn("inc"));
    expect($("p.out").textContent).toBe("3");
  });

  test("the body may read row bindings and call functions; a host call stands in it (as in a handler)", async () => {
    const src = P(`    <let n:int=0/>\n    <let stamp:number=0/>\n    <let twice:int=0/>\n    fn dbl(x: int) -> int { return x * 2 }\n    when @n changes {\n        @stamp = Date.now()\n        @twice = dbl(@n)\n    }`,
      `        <p class="out">\${@twice}</p>\n        <button onclick=(@n = @n + 1)>inc</button>`);
    await loadProgram(coreOf(src), "when-calls");
    click(btn("inc"));
    expect($("p.out").textContent).toBe("2");
  });
});

describe("s446 F2 — two whens writing each other's deps (a cycle SPEC is silent on)", () => {
  test("compiles clean; one click is bounded (no stack overflow), reported loudly, and the page stays alive", async () => {
    const src = P(`    <let n:int=0/>\n    <let m:int=0/>\n    <let hits:int=0/>\n    when @n changes {\n        @m = @m + 1\n        @hits = @hits + 1\n    }\n    when @m changes {\n        @n = @n + 1\n        @hits = @hits + 1\n    }`,
      `        <p class="out">\${@hits}</p>\n        <button onclick=(@n = @n + 1)>inc</button>`);
    await loadProgram(coreOf(src), "when-cycle");
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try { click(btn("inc")); } finally { console.error = saved; }
    expect(Number($("p.out").textContent)).toBeLessThan(10);
    expect(errs.some((e) => /E-LIFECYCLE-006 — re-triggered during its re-run; dropped/.test(e))).toBe(true);
    expect(takePageErrors()).toEqual([]);
  });

  // review round 3, R2-2: a row `when` that grows its own collection creates a NEW when per run —
  // never a cycle by provenance. It used to recurse to "Maximum call stack size exceeded" (4189
  // whens, an uncaught page error, no diagnostic). Now the ancestry-depth backstop (RULED S447 Q7,
  // provisional 256) stops it.
  test("R2-2: a row `when` that grows its own <each> — bounded by the runaway budget, reported loudly (one page error), no crash, page alive", async () => {
    // mutation RED: admit() without the depth check (RULED S447 Q7) → the page never stops growing
    const src = P(`    type Row:struct = { id: int }\n    <rows:Row[replace, free]=([{ id: 1 }])/>\n    <let k:int=0/>\n    <let hits:int=0/>\n    <let pokes:int=0/>\n    function grow() {\n        @k = @k + 1\n        @rows.push({ id: @k + 1 })\n    }`,
      `        <ul><each in=@rows key=@.id as r><li>\${ when @k changes {\n            @hits = @hits + 1\n            grow()\n        } }</li></each></ul>\n        <p class="out">\${@hits}</p>\n        <p class="pokes">\${@pokes}</p>\n        <button onclick=(@k = @k + 1)>go</button>\n        <button onclick=(@pokes = @pokes + 1)>poke</button>`);
    const { rt } = await loadProgram(coreOf(src), "when-runaway");   // compiles clean (no diagnostic governs it — DESIGN §5 (7))
    const errs = [];
    const saved = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    // (a raw dispatch: `click()` fails on ANY page error, and one is expected here)
    try { btn("go").dispatchEvent(new window.MouseEvent("click", { bubbles: true })); } finally { console.error = saved; }
    // exactly ONE page error: the backstop's own loud report (r3b F2) — no crash, no stack overflow
    const pageErrs = takePageErrors().map((e) => String(e && e.message ? e.message : e));
    expect(pageErrs.length).toBe(1);
    expect(pageErrs[0]).toMatch(/runaway growth — one change's causal chain passed 256 when runs deep .* page state may now be inconsistent/);
    expect(errs.some((e) => /runaway growth — one change's causal chain passed 256 when runs deep/.test(e))).toBe(true);
    const hits = Number($("p.out").textContent);
    expect(hits).toBe(256);
    expect(rt.stats.whens).toBe(257);
    // the page is alive: the DOM agrees with the state; a SECOND `go` — whose leftover row whens all
    // re-run — is stopped at depth 256 again (depth = the longest causal chain, so breadth cannot hide
    // it); and an unrelated handler still runs and renders.
    expect(document.querySelectorAll("li").length).toBe(rt.stats.whens);
    console.error = () => {};
    try { btn("go").dispatchEvent(new window.MouseEvent("click", { bubbles: true })); } finally { console.error = saved; }
    const pageErrs2 = takePageErrors().map((e) => String(e && e.message ? e.message : e));
    expect(pageErrs2.length).toBe(1);
    expect(pageErrs2[0]).toMatch(/runaway growth — one change's causal chain passed 256 when runs deep/);
    expect(rt.stats.whens).toBe(513);
    expect(document.querySelectorAll("li").length).toBe(513);
    click(btn("poke"));
    expect($("p.pokes").textContent).toBe("1");
    expect(takePageErrors()).toEqual([]);
  }, 60000);
});

describe("§6.7.4 — codes", () => {
  const D = `    <let n:int=0/>\n    <let m:int=0/>\n    <step=1/>\n    <dbl:int=(@n * 2)/>`;

  test("E-LIFECYCLE-006 — the body writes a dep (any write form, at any depth)", () => {
    expect(codes(P(`${D}\n    when @n changes {\n        @n = 1\n        @m = 2\n    }`, ""))).toEqual(["E-LIFECYCLE-006"]);
    expect(codes(P(`${D}\n    when (@m, @n) changes {\n        if (@m > 0) {\n            reset(@n)\n        }\n    }`, ""))).toEqual(["E-LIFECYCLE-006"]);
    expect(codes(P(`${D}\n    <xs:int[free, append]=[]/>\n    when @xs changes {\n        @xs.push(1)\n        @m = 1\n    }`, ""))).toEqual(["E-LIFECYCLE-006"]);
    // writing a NON-dep is fine
    expect(codes(P(`${D}\n    when @n changes {\n        @m = 1\n        @m = 2\n    }`, ""))).toEqual([]);
  });

  test("E-LIFECYCLE-007 — a dep that is not a declared mutable @variable: undeclared, locked, derived (EC-1)", () => {
    const body = ` changes {\n        @m = 1\n        @m = 2\n    }`;
    expect(codes(P(`${D}\n    when @nope${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    when @step${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    when @dbl${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    expect(codes(P(`${D}\n    when (@n, @dbl)${body}`, ""))).toEqual(["E-LIFECYCLE-007"]);
    const msg = run(P(`${D}\n    when @dbl${body}`, "")).diags[0].message;
    expect(msg).toMatch(/DERIVED/);
  });

  test("E-LIFECYCLE-016 — a `when` directly inside another `when`'s body", () => {
    expect(codes(P(`${D}\n    when @n changes {\n        @m = 1\n        when @m changes {\n            @m = 3\n        }\n    }`, ""))).toEqual(["E-LIFECYCLE-016"]);
  });

  test("W-LIFECYCLE-010 — an empty body (a warning; the program still lowers)", () => {
    const r = run(P(`${D}\n    when @n changes {}`, ""));
    expect(r.diags.map((d) => d.code)).toEqual(["W-LIFECYCLE-010"]);
    expect(whens(r.core).length).toBe(1);
  });

  test("W-LIFECYCLE-006 — the body is one `@v = <pure expression of @variables>`; not otherwise", () => {
    expect(codes(P(`${D}\n    when @n changes {\n        @m = @n * 2 + 1\n    }`, ""))).toEqual(["W-LIFECYCLE-006"]);
    // S446 amendment: an ACCUMULATOR (the right-hand side reads the assigned cell) is not derivable — no warning
    expect(codes(P(`${D}\n    when @n changes {\n        @m = @m + 1\n    }`, ""))).toEqual([]);
    expect(codes(P(`${D}\n    when @n changes {\n        @m = @n * 2 + @m\n    }`, ""))).toEqual([]);
    // a constant (no @ read), a call, a second statement: no warning
    expect(codes(P(`${D}\n    when @n changes {\n        @m = 1\n    }`, ""))).toEqual([]);
    expect(codes(P(`${D}\n    fn f(x: int) -> int { return x }\n    when @n changes {\n        @m = f(@n)\n    }`, ""))).toEqual([]);
    expect(codes(P(`${D}\n    when @n changes {\n        @m = @n\n        @m = @m + 1\n    }`, ""))).toEqual([]);
  });

  test("W-LIFECYCLE-006 — r2 N3: a self-read THROUGH derived cells is an accumulator too; an unrelated derived read is not", () => {
    // mutation RED: derivableWhen without the readsThroughDerived exclusion
    const DD = `${D}\n    <dm:int=(@m + 1)/>\n    <dd:int=(@dm * 2)/>`;
    // `@dm` derives from `@m` (one hop), `@dd` through `@dm` (two hops): the derived form would be circular
    expect(codes(P(`${DD}\n    when @n changes {\n        @m = @n + @dm\n    }`, ""))).toEqual([]);
    expect(codes(P(`${DD}\n    when @n changes {\n        @m = @n + @dd\n    }`, ""))).toEqual([]);
    // `@dbl` derives from `@n`, not `@m` — still derivable, still warned
    expect(codes(P(`${DD}\n    when @n changes {\n        @m = @n + @dbl\n    }`, ""))).toEqual(["W-LIFECYCLE-006"]);
    // a derived read of the assigned cell's derived — but assigning a DIFFERENT cell: still warned
    expect(codes(P(`${DD}\n    <let k:int=0/>\n    when @n changes {\n        @k = @n + @dm\n    }`, ""))).toEqual(["W-LIFECYCLE-006"]);
  });

  test("syntax: an empty dep-list `()` and a missing `changes` are parse errors", () => {
    expect(codes(P(`${D}\n    when () changes {\n        @m = 1\n    }`, ""))).toContain("E-PARSE-WHEN");
    expect(codes(P(`${D}\n    when @n {\n        @m = 1\n    }`, ""))).toContain("E-PARSE-WHEN");
    expect(codes(P(`${D}\n    when (@n, m) changes {\n        @m = 1\n    }`, ""))).toContain("E-PARSE-WHEN");
  });

  test("`when` stays an ordinary name where it is not a `when` statement", () => {
    expect(codes(P(`    <let m:int=0/>\n    fn when(x: int) -> int { return x }\n    function g() { @m = when(1) }`, ""))).toEqual([]);
  });
});

describe("fail closed — forms the bootstrap does not lower are refused, never dropped", () => {
  const D = `    <let n:int=0/>\n    <let m:int=0/>`;
  const W = `when @n changes {\n        @m = 1\n        @m = 2\n    }`;

  test("a `when` in a function body / a handler block", () => {
    expect(codes(P(`${D}\n    function f() {\n        ${W}\n    }`, ""))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(P(D, `        <button onclick={ ${W.replaceAll("\n", " ")} }>x</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("a `when` in a user declaration's renders", () => {
    const src = `<program>\n    <let n:int=0/>\n    <box let k:int=0/>\n    renders <div>\${ when @n changes {\n        @box.k = 1\n        @box.k = 2\n    } }</div>\n    <main><*box/></main>\n</program>\n`;
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toMatch(/renders/);
  });

  test("a dep naming a whole instance (`@decl`)", () => {
    const src = `<program>\n    <let m:int=0/>\n    <box let k:int=0/>\n    when @box changes {\n        @m = 1\n        @m = 2\n    }\n    <main></main>\n</program>\n`;
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toMatch(/whole instance/);
  });

  // s446 F1: slot content is rendered once per `<slot/>` in the renders — with none the
  // effect would be dropped, with two it would run twice per change. Refused.
  const slotProg = (renders) => `<program>\n    <let n:int=0/>\n    <let hits:int=0/>\n    <let m:int=0/>\n    <card title:string/>\n    renders ${renders}\n    <main>\n        <card title="a"><b>x</b>\${ when @n changes {\n            @hits = @hits + 1\n            @m = @n\n        } }</card>\n    </main>\n</program>\n`;

  test("a `when` in use-site slot content — renders with NO <slot/> (would be dropped)", () => {
    const r = run(slotProg("<div>card</div>"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toMatch(/slot content/);
  });

  test("a `when` in use-site slot content — renders with TWO <slot/>s (would run twice)", () => {
    const r = run(slotProg("<div><slot/><slot/></div>"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("a `when` nested deeper in slot content (inside an element) is refused too", () => {
    const src = slotProg("<div><slot/></div>").replace("<b>x</b>${", "<b>x</b><i>${").replace("} }</card>", "} }</i></card>");
    expect(codes(src)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  // r2 N2: `<slot>` FALLBACK content (written inside the declaration's `<slot>…</slot>`)
  // has no Core form (View.Slot carries none) and SPEC §66.15.2 rules only `<slot/>`;
  // it used to be dropped unvisited (a `when` there ran 0 times; `${@nope}` raised nothing).
  const fallbackProg = (fallback) => `<program>\n    <let n:int=0/>\n    <let hits:int=0/>\n    <card title:string/>\n    renders <div><slot>${fallback}</slot></div>\n    <main>\n        <card title="a"></card>\n    </main>\n</program>\n`;

  test("r2 N2: slot fallback content — a `when`, an unresolved read, plain markup — is refused", () => {
    // mutation RED: resolveElem returning MSlot for `slot` without resolveSlot
    for (const fb of ["${ when @n changes { @hits = @hits + 1 } }", "${@nope}", "<b>default</b>", "default"]) {
      const r = run(fallbackProg(fb));
      expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(r.diags[0].message).toMatch(/inside `<slot>…<\/slot>`/);
    }
  });

  test("r2 N2: an empty or whitespace-only `<slot></slot>` is still a plain slot", () => {
    expect(codes(fallbackProg(""))).toEqual([]);
    expect(codes(fallbackProg("\n        "))).toEqual([]);
  });

  test("a `${…}` block in markup holding anything after its `when`", () => {
    expect(codes(P(D, `        <div>\${ when @n changes {\n            @m = 1\n            @m = 2\n        } @m = 3 }</div>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });

  test("a `when` outside `<program>`", () => {
    const src = `when @n changes {\n    @m = 1\n}\n<program>\n${D}\n    <main></main>\n</program>\n`;
    expect(codes(src)).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

describe("Core checks — C11 (When) and C12 (Suspend placement)", () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const src = P(`    <let n:int=0/>\n    <let m:int=0/>`, `        <div>\${ when @n changes {\n            @m = 1\n            @m = 2\n        } }</div>`);

  test("C11: an empty dep-list, a dep without a write capability, a body writing its dep", () => {
    const core = coreOf(src);
    const empty = clone(core);
    whens(empty)[0].deps = [];
    expect(mods.check.checkCore(empty).join("\n")).toMatch(/C11: a When has an empty dep-list/);

    const locked = clone(core);
    const prog = locked.decls.find((d) => d.kind === "Program" || d.kind?.variant === "Program") ?? locked.decls[locked.decls.length - 1];
    const dep = whens(locked)[0].deps[0];
    const f = prog.fields[dep.idx];
    f.wcap = null;
    f.grants = { replace: false, edits: [] };
    expect(mods.check.checkCore(locked).join("\n")).toMatch(/C11: a When dep .* is not a mutable cell/);

    const selfWrite = clone(core);
    const w = whens(selfWrite)[0];
    const write = w.body.stmts[0];
    const depField = selfWrite.decls.find((d) => d.sym.id === w.deps[0].decl.id).fields[w.deps[0].idx];
    write.data.cap = depField.wcap;
    expect(mods.check.checkCore(selfWrite).join("\n")).toMatch(/C11: a When body writes its own dep/);
  });

  test("C12: a Suspend at the tail of a When body is legal; anywhere else it is not", () => {
    const core = coreOf(src);
    const ok = clone(core);
    const w = whens(ok)[0];
    w.body.stmts = [{ variant: "Suspend", data: { bind: { id: 90001, hint: "v" }, on: { variant: "Lit", data: { lit: { variant: "Int", data: { v: 1 } } } }, then: { stmts: w.body.stmts } } }];
    expect(mods.check.checkCore(ok)).toEqual([]);

    const notLast = clone(ok);
    const w2 = whens(notLast)[0];
    w2.body.stmts = [...w2.body.stmts, ...w2.body.stmts[0].data.then.stmts];
    expect(mods.check.checkCore(notLast).join("\n")).toMatch(/C12: 1 Suspend/);
  });
});

describe("the Suspend layer through the printer (U1 groundwork — no source form yet)", () => {
  // The SCOPED program with its `when` body rewritten in Core to
  //   Suspend(v, <a value>, { …the original body… })
  // so the body's writes happen only after the suspension settles.
  function suspended() {
    const core = JSON.parse(JSON.stringify(coreOf(SCOPED_PROGRAM)));
    const w = whens(core)[0];
    w.body.stmts = [{ variant: "Suspend", data: { bind: { id: 90002, hint: "v" }, on: { variant: "Lit", data: { lit: { variant: "Str", data: { v: "settled" } } } }, then: { stmts: w.body.stmts } } }];
    expect(mods.check.checkCore(core)).toEqual([]);
    return core;
  }

  test("the printed effect suspends: the writes land after the value settles, in order, in one batch", async () => {
    const { out } = await loadProgram(suspended(), "when-suspend");
    expect(out.js).toContain("rt.when(scope$, [inst$.fields[0 /* n */]], task$ => {");
    expect(out.js).toContain(`rt.suspend(task$, "settled", v => {`);
    click(btn("inc"));
    expect($("p.out").textContent).toBe("0 0");
    await tick();
    expect($("p.out").textContent).toBe("1 1");
  });

  test("destroying the scope while the effect is suspended cancels it — it never resumes, never writes", async () => {
    const { rt } = await loadProgram(suspended(), "when-suspend-cancel");
    click(btn("inc"));
    click(btn("toggle"));                           // destroy the section while the run is suspended
    expect(rt.stats.whens).toBe(0);
    await tick();
    await tick();
    expect($("p.out").textContent).toBe("0 0");
    expect(takePageErrors()).toEqual([]);
  });
});
