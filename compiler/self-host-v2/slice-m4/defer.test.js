// defer.test.js — s451: `defer` (SPEC §19.16) in the bootstrap, end to end —
// §66 source → parse → analyze → lower (Stmt.Defer) → check (C16) → print
// (`try … finally` per block) → the slice runtime (`runDefers`) in happy-dom —
// plus the static codes and the contextual-keyword reading.
//
// Before s451 the bootstrap read `defer { … }` as an undeclared identifier
// (E-SCOPE-001) and still printed a program that ran the deferred statements
// in place (g-bootstrap-defer-scope-001-and-runs-anyway).

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";
import * as rtDirect from "../slice-m1/runtime/runtime.js";

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
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

// A program with a string log, an int cell, the given functions and one button per name.
const P = (fns, buttons) =>
  `<program>\n    let <log:string=""/>\n    let <n:int=0/>\n    let <out:int=0/>\n${fns}\n    <main>\n${buttons
    .map((b) => `        <button onclick=${b}()>${b}</button>`)
    .join("\n")}\n        <p id="log">\${@log}</p>\n        <p id="n">\${@n}</p>\n        <p id="out">\${@out}</p>\n    </main>\n</program>\n`;

let k = 0;
async function runProgram(fns, buttons, press) {
  const r = clean(P(fns, buttons));
  await loadProgram(r.core, "defer-" + k++);
  for (const b of press) click(btn(b));
  return { log: $("#log").textContent, n: $("#n").textContent, out: $("#out").textContent };
}

describe("§19.16.2 semantics, executed", () => {
  test("fall-through: deferred bodies run at the block's exit, last registered first (LIFO)", async () => {
    const o = await runProgram(
      `    function go() {\n        @log = @log + "a"\n        defer @log = @log + "1"\n        defer { @log = @log + "2" }\n        @log = @log + "b"\n    }`,
      ["go"], ["go"]);
    expect(o.log).toBe("ab21");
  });

  test("return: the value is evaluated BEFORE the deferred body runs; the deferred write still lands", async () => {
    const o = await runProgram(
      `    function f() -> int {\n        @n = 1\n        defer @n = 5\n        return @n\n    }\n    function go() {\n        @out = f()\n    }`,
      ["go"], ["go"]);
    expect(o.out).toBe("1");
    expect(o.n).toBe("5");
  });

  test("an early return from a nested block runs the outer block's deferred body", async () => {
    const o = await runProgram(
      `    function go() {\n        defer @log = @log + "d"\n        if (@n == 0) {\n            @log = @log + "r"\n            return\n        }\n        @log = @log + "x"\n    }`,
      ["go"], ["go"]);
    expect(o.log).toBe("rd");
  });

  test("block-scoped: a defer in an `if` branch runs at THAT branch's exit, before the rest of the function", async () => {
    const o = await runProgram(
      `    function go() {\n        if (@n == 0) {\n            defer @log = @log + "x"\n            @log = @log + "i"\n        }\n        @log = @log + "o"\n    }`,
      ["go"], ["go"]);
    expect(o.log).toBe("ixo");
  });

  test("not reached, not registered: a defer after an early return never runs", async () => {
    const o = await runProgram(
      `    function go() {\n        @log = @log + "s"\n        if (@n == 0) {\n            return\n        }\n        defer @log = @log + "d"\n    }`,
      ["go"], ["go"]);
    expect(o.log).toBe("s");
  });

  test("evaluated at exit: the deferred body reads the binding's value at exit, not at the defer", async () => {
    const o = await runProgram(
      `    function go() {\n        let v = 1\n        defer @n = v\n        v = 2\n    }`,
      ["go"], ["go"]);
    expect(o.n).toBe("2");
  });

  test("each call gets its own stack (two calls, two runs)", async () => {
    const o = await runProgram(
      `    function go() {\n        defer @n = @n + 1\n    }`,
      ["go"], ["go", "go"]);
    expect(o.n).toBe("2");
  });

  test("the printed shape: a try/finally per block that holds a defer, a push where it stands", () => {
    const r = clean(P(`    function go() {\n        defer @n = 1\n        @log = "x"\n    }`, ["go"]));
    const js = mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;
    expect(js).toContain("const defers$ = [];");
    expect(js).toContain("try {");
    expect(js).toContain("defers$.push(() => {");
    expect(js).toContain("rt.runDefers(defers$);");
  });

  test("twin: a function with no defer prints no try/finally", () => {
    const r = clean(P(`    function go() {\n        @n = 1\n    }`, ["go"]));
    expect(mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js).not.toContain("defers$");
  });
});

describe("runDefers — the runtime half of §19.16.2", () => {
  test("LIFO; a host error in one does not stop the rest; the FIRST error is rethrown after all ran", () => {
    const seen = [];
    const e1 = new Error("first");
    const stack = [() => seen.push("a"), () => { seen.push("b"); throw new Error("second"); }, () => { seen.push("c"); throw e1; }];
    let caught;
    try { rtDirect.runDefers(stack); } catch (e) { caught = e; }
    expect(seen).toEqual(["c", "b", "a"]);
    expect(caught).toBe(e1);
  });

  test("no error: nothing thrown", () => {
    const seen = [];
    rtDirect.runDefers([() => seen.push(1), () => seen.push(2)]);
    expect(seen).toEqual([2, 1]);
  });
});

describe("the static codes (§19.16.1–§19.16.3)", () => {
  test("E-DEFER-OUTSIDE-FUNCTION — a braced handler body", () => {
    const src = `<program>\n    let <n:int=0/>\n    <main>\n        <button onclick={ defer @n = 1 }>x</button>\n    </main>\n</program>\n`;
    expect(codes(src)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
    expect(run(src).core == null).toBe(true);
  });

  test("E-DEFER-OUTSIDE-FUNCTION — an effect body", () => {
    const src = `<program>\n    let <n:int=0/>\n    function ping() {\n        const t = Date.now()\n    }\n    <effect deps=[@n]>\${ defer ping() }</>\n    <main><p>\${@n}</p></main>\n</program>\n`;
    expect(codes(src)).toEqual(["E-DEFER-OUTSIDE-FUNCTION"]);
  });

  test("E-DEFER-UNSUPPORTED-SITE — the whole unbraced arm of an `if` / an `else`", () => {
    expect(codes(P(`    function go() {\n        if (@n == 0) defer @n = 1\n    }`, ["go"]))).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
    expect(codes(P(`    function go() {\n        if (@n == 0) {\n            @n = 2\n        } else defer @n = 1\n    }`, ["go"]))).toEqual(["E-DEFER-UNSUPPORTED-SITE"]);
  });

  test("E-DEFER-CONTROL-FLOW — a `return` in the deferred body, at any depth", () => {
    expect(codes(P(`    function go() {\n        defer {\n            return\n        }\n    }`, ["go"]))).toEqual(["E-DEFER-CONTROL-FLOW"]);
    expect(codes(P(`    function go() {\n        defer {\n            if (@n == 0) {\n                return\n            }\n        }\n    }`, ["go"]))).toEqual(["E-DEFER-CONTROL-FLOW"]);
  });

  test("E-DEFER-NESTED — a `defer` in the deferred body", () => {
    expect(codes(P(`    function go() {\n        defer {\n            defer @n = 1\n        }\n    }`, ["go"]))).toEqual(["E-DEFER-NESTED"]);
  });

  test("E-DEFER-LATER-SHADOW — the deferred body reads a name a LATER declaration of an enclosing block rebinds", () => {
    const src = P(`    function go() {\n        const v = 1\n        if (@n == 0) {\n            defer @n = v\n            const v = 2\n        }\n    }`, ["go"]);
    const ds = run(src).diags;
    expect(ds.map((d) => d.code)).toEqual(["E-DEFER-LATER-SHADOW"]);
    expect(ds[0].message).toContain("`v`");
    // a later declaration in an ENCLOSING block (the closure would see it in its TDZ)
    expect(codes(P(`    function v() -> int {\n        return 3\n    }\n    function go() {\n        if (@n == 0) {\n            defer @n = v()\n        }\n        const v = 2\n    }`, ["go"]))).toEqual(["E-DEFER-LATER-SHADOW"]);
  });

  test("twins: a later declaration of a name the body does NOT read, or one inside a later nested block, is fine", () => {
    clean(P(`    function go() {\n        const v = 1\n        defer @n = v\n        const w = 2\n        if (@n == 0) {\n            const v = 3\n            @out = v + w\n        }\n    }`, ["go"]));
  });

  test("E-DEFER-AMBIGUOUS-LEAD — `defer [` while a binding named `defer` is visible", () => {
    expect(codes(P(`    function go(defer: int) {\n        defer [1, 2]\n    }`, []))).toEqual(["E-DEFER-AMBIGUOUS-LEAD"]);
  });

  test("§19.16.4 — a deferred body in a pure `fn` meets every prohibition the same statement would at the exit", () => {
    // (the bootstrap's §48 surface: a `fn` calling a `function` — E-FN-003; a `fn` reading the clock — E-FN-004)
    const G = `    function g() {\n        @n = 1\n    }\n`;
    const direct = codes(P(`${G}    fn f(x: int) -> int {\n        g()\n        const t = Date.now()\n        return x\n    }`, []));
    expect(direct).toEqual(["E-FN-003", "E-FN-004"]);
    expect(codes(P(`${G}    fn f(x: int) -> int {\n        defer {\n            g()\n            const t = Date.now()\n        }\n        return x\n    }`, []))).toEqual(direct);
  });

  test("narrowing at the defer: kept for a local nothing rebinds, dropped for one that is rebound (the exit may see `not`)", () => {
    clean(P(`    function go(x: int | not) {\n        if (x != not) {\n            defer @n = x + 1\n        }\n    }\n    function h() {\n        go(3)\n    }`, ["h"]));
    expect(codes(P(`    function go(y: int | not) {\n        let x: int | not = y\n        if (x != not) {\n            defer @n = x + 1\n            x = not\n        }\n    }`, []))).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });

  test("a clean defer in a pure `fn` (no prohibited effect)", () => {
    clean(P(`    fn f(x: int) -> int {\n        let y = x\n        defer y = 0\n        return y\n    }`, []));
  });
});

describe("`defer` is a contextual keyword (§19.16.1) — everywhere else an identifier", () => {
  test("a local named `defer`: `defer = …` is a write, `@n = defer` a read — no defer statement", () => {
    clean(P(`    function go() {\n        let defer = 1\n        defer = 2\n        @n = defer\n    }`, ["go"]));
  });

  test("`defer(…)` is a call of a function named `defer`", () => {
    clean(P(`    function defer(x: int) {\n        @n = x\n    }\n    function go() {\n        defer(3)\n    }`, ["go"]));
  });

  test("the deferred statement must start on the SAME line — a lone `defer` is a read (here: undeclared)", () => {
    expect(codes(P(`    function go() {\n        defer\n        @n = 1\n    }`, ["go"]))).toEqual(["E-SCOPE-001"]);
  });
});
