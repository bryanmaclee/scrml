// loops-s469.test.js — s469: the FIRST LOOP SLICE of the bootstrap — SPEC §49,
// "one `for`" (user-voice S469 "⭐ RULED — loops"):
//
//   1. the four heads, as statements in function and handler bodies:
//      `for (x of xs)`, `for (cond)`, `for (init; cond; step)`, `for { … }` /
//      `for (;;)`; ranges `a..b` / `a..=b` in an iterate head; `break` /
//      `continue`, with labels; per-iteration binding (a `let` binder copies
//      the counter, so writing it never moves the loop);
//   2. `xs[i]` — type `T`, the E-INDEX-OUT-OF-RANGE-RT trap at run time (§19.17,
//      naming the index and the length); `xs.at(i)` — `T | not`, never a trap;
//   3. the refusals: `while` (E-LOOP-WHILE-RETIRED), `do … while`
//      (E-LOOP-DO-WHILE-RETIRED), the braceless `for x in xs`
//      (E-FOR-UNPARENTHESIZED-HEAD), `for (… in …)` (E-CTRL-011), a range
//      outside a loop head (E-RANGE-OUTSIDE-LOOP-HEAD), a bound that is not an
//      int (E-RANGE-BOUND-NOT-INT), `break` / `continue` outside a loop or to a
//      label that encloses nothing (E-LOOP-001 … -004), a duplicate label
//      (E-LOOP-006);
//   4. THE GRANT LENS: a write in a loop body is the same write anywhere — a
//      loop never gets a write past §66.12.6.
//
// Graded on diagnostic codes, the Core shape, and the RUNTIME effect.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors, takePageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => [...new Set(run(src).diags.map((d) => d.code))].sort();
const diag = (src, code) => run(src).diags.find((d) => d.code === code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
let k = 0;
const load = (src, expose = []) => loadProgram(clean(src).core, "s469l-" + k++, expose);
const js = (src) => mods.print.printProgram(clean(src).core, "t.client.js", "scrml-runtime.js").js;

const prog = (decls, body) => `<program>\n${decls}\n    <main>\n${body}\n    </main>\n</program>\n`;
// one function `f` with body `b` (its return type `ret`), shown in `#o`
const fnProg = (b, ret = "int", decls = "", call = "f()") => prog(`${decls}\n    function f() -> ${ret} {\n${b}\n    }`, `        <p id="o">\${${call}}</p>`);
const fnCodes = (b, ret = "int", decls = "") => codes(fnProg(b, ret, decls));

// ---------------------------------------------------------------------------
describe("the four heads — statements, compiled and run", () => {
  test("`for (x of xs)` sums a tape; the sum is shown in markup (runtime)", async () => {
    const src = prog(`    <xs:int[]=([3, 4, 5])/>\n    function sum(ys: int[]) -> int {\n        let total = 0\n        for (y of ys) {\n            total = total + y\n        }\n        return total\n    }`,
      `        <p id="s">\${sum(@xs)}</p>`);
    await load(src);
    expect($("#s").textContent).toBe("12");
  });
  test("`for (i of a..b)` is half-open, `a..=b` inclusive; an empty range runs zero times (runtime)", async () => {
    const src = prog(`    function half(n: int) -> int {\n        let s = 0\n        for (i of 0..n) { s = s * 10 + i }\n        return s\n    }\n    function incl(n: int) -> int {\n        let s = 0\n        for (i of 1..=n) { s = s * 10 + i }\n        return s\n    }`,
      `        <p id="a">\${half(4)}</p>\n        <p id="b">\${incl(3)}</p>\n        <p id="c">\${half(0)}</p>\n        <p id="d">\${incl(0)}</p>`);
    await load(src);
    expect([$("#a").textContent, $("#b").textContent, $("#c").textContent, $("#d").textContent]).toEqual(["123", "123", "0", "0"]);
  });
  test("a range's bounds are evaluated once: `0..n` where the body rebinds `n` (runtime)", async () => {
    const src = fnProg(`        let n = 3\n        let c = 0\n        for (i of 0..n) {\n            n = n + 1\n            c = c + 1\n        }\n        return c`);
    await load(src);
    expect($("#o").textContent).toBe("3");
  });
  test("a `let` binder is the iteration's own: writing it never moves the loop (§49.3.5, runtime)", async () => {
    const src = fnProg(`        let c = 0\n        for (let i of 0..4) {\n            i = i + 10\n            c = c + 1\n        }\n        let s = 0\n        for (let x of [1, 2]) {\n            x = x * 100\n            s = s + x\n        }\n        return c * 1000 + s`);
    await load(src);
    expect($("#o").textContent).toBe("4300");
  });
  test("`for (cond)` runs while the condition holds; zero times when it starts false (runtime)", async () => {
    const src = fnProg(`        let m = 0\n        for (m < 5) { m = m + 1 }\n        let z = 7\n        for (z < 0) { z = 0 }\n        return m * 10 + z`);
    await load(src);
    expect($("#o").textContent).toBe("57");
  });
  test("`for (init; cond; step)`: `continue` runs the step (runtime)", async () => {
    const src = fnProg(`        let s = 0\n        for (let i = 0; i < 6; i = i + 1) {\n            if (i == 2) { continue }\n            s = s + i\n        }\n        let a = 0\n        let b = 0\n        for (a = 1, b = 10; a < 4; a = a + 1, b = b - 1) { s = s + 0 }\n        return s * 100 + a * 10 + b`);
    await load(src);
    expect($("#o").textContent).toBe("1347");
  });
  test("`for { … }` and `for (;;)` loop until a `break` (runtime)", async () => {
    const src = fnProg(`        let n = 0\n        for {\n            n = n + 1\n            if (n == 3) { break }\n        }\n        for (;;) {\n            n = n + 10\n            if (n > 40) { break }\n        }\n        return n`);
    await load(src);
    expect($("#o").textContent).toBe("43");
  });
  test("labels: `break outer` leaves both loops, `continue outer` skips to the outer's next iteration (runtime)", async () => {
    const src = fnProg(`        let s = 0\n        outer: for (r of 0..3) {\n            for (c of 0..3) {\n                if (c == 1) { continue outer }\n                s = s + 1\n            }\n        }\n        let t = 0\n        rows: for (r of 0..5) {\n            for (c of 0..5) {\n                if (r * c == 6) { break rows }\n                t = t + 1\n            }\n        }\n        return s * 100 + t`);
    await load(src);
    expect($("#o").textContent).toBe("313");
  });
  test("a forever loop with no `break` ends its block: no fall-off is reported after it", () => {
    expect(fnCodes(`        let n = 0\n        for {\n            n = n + 1\n            if (n > 3) { return n }\n        }`)).toEqual([]);
    // with a `break` it may complete: the missing return is reported
    expect(fnCodes(`        let n = 0\n        for {\n            n = n + 1\n            if (n > 3) { break }\n        }`)).toEqual(["E-TYPE-043"]);
  });
  test("a string iterates by code point (runtime)", async () => {
    const src = fnProg(`        let n = 0\n        for (ch of "a😀b") { n = n + 1 }\n        return n`);
    await load(src);
    expect($("#o").textContent).toBe("3");
  });
  test("a loop in an event handler, writing a granted cell (runtime)", async () => {
    const src = prog(`    let <total:int=0/>\n    <xs:int[]=([1, 2, 3])/>`, `        <button onclick={ for (x of @xs) { @total = @total + x } }>add</button>\n        <p id="t">\${@total}</p>`);
    await load(src);
    click(btn("add"));
    click(btn("add"));
    expect($("#t").textContent).toBe("12");
  });
  test("the emitted JavaScript reads as the loop it is", () => {
    const out = js(fnProg(`        let s = 0\n        for (y of [1, 2]) { s = s + y }\n        for (i of 0..=2) { s = s + i }\n        for (s < 100) { s = s * 2 }\n        for (let j = 0; j < 2; j = j + 1) { s = s + j }\n        outer: for {\n            for (q of 0..2) { if (q == 1) { break outer } }\n        }\n        return s`));
    expect(out).toContain("for (const y of [1, 2]) {");
    expect(out).toContain("for (let i = 0, end = 2; i <= end; i = i + 1) {");
    expect(out).toContain("while (s < 100) {");
    expect(out).toContain("for (let j = 0; j < 2; j = j + 1) {");
    expect(out).toContain("outer: for (;;) {");
    expect(out).toContain("break outer;");
  });
});

// ---------------------------------------------------------------------------
describe("index reads — `xs[i]` traps out of range, `xs.at(i)` is `T | not` (§49.13, §19.17)", () => {
  const P = prog(`    <xs:int[]=([10, 20, 30])/>\n    let <msg:string="-"/>\n    let <got:int=0/>\n    function pick(i: int) -> int { return @xs[i] }\n    function show(i: int) {\n        @msg = "before"\n        @got = pick(i)\n        @msg = "after"\n    }\n    function soft(i: int) -> string {\n        return match @xs.at(i) {\n            not :> "none"\n            else :> "some"\n        }\n    }`,
    `        <button onclick=show(1)>in</button>\n        <button onclick=show(3)>past</button>\n        <button onclick=show(-1)>neg</button>\n        <p id="m">\${@msg} \${@got}</p>\n        <p id="a">\${soft(2)} \${soft(3)} \${soft(-1)}</p>`);
  test("in range: the element; `at` gives the element or `not` — a negative index is `not` (runtime)", async () => {
    await load(P);
    click(btn("in"));
    expect($("#m").textContent).toBe("after 20");
    expect($("#a").textContent).toBe("some none none");
  });
  test("out of range (past the end, negative): the trap stops the handler, naming the index and the length (runtime)", async () => {
    await load(P);
    for (const [b, i] of [["past", 3], ["neg", -1]]) {
      // the test's OWN capture (not only the shared page-error capture, which a
      // combined run once left dead): the handler's error reaches `window`
      const errs = [];
      const onErr = (e) => errs.push(e.error);
      window.addEventListener("error", onErr);
      btn(b).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      window.removeEventListener("error", onErr);
      takePageErrors();      // drained: the trap is this test's expected page error
      expect(errs.length).toBe(1);
      expect(errs[0].code).toBe("E-INDEX-OUT-OF-RANGE-RT");
      expect(errs[0].detail).toEqual({ index: i, length: 3, at: "t.scrml:5" });
      expect(String(errs[0].message)).toContain("index " + i + " is out of range for a tape of length 3");
      // no later statement of the handler ran: the write before it stands, the one after it does not
      expect($("#m").textContent).toBe("before 0");
    }
  });
  test("the trap is not a `!` error: a function holding an index read is not failable, and the read is not `T | not`", () => {
    expect(codes(prog(`    function g(xs: int[]) -> int { return xs[0] + 1 }`, `        <p>\${g([1])}</p>`))).toEqual([]);
  });
  test("the index is an `int` (E-TYPE-031); a string index / an un-narrowed tape are refused", () => {
    expect(codes(prog(`    function g(xs: int[], s: string) -> int { return xs[s] }`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(`    function g(xs: int[]) -> int { return xs[0.5] }`, `        <p>x</p>`))).toEqual(["E-TYPE-031"]);
    expect(codes(prog(`    function g(s: string) -> string { return s[0] }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    function g(xs: int[] | not) -> int { return xs[0] }`, `        <p>x</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a field of an index read is refused, never lowered to a placeholder", () => {
    const d = diag(prog(`    type P:struct = { x: int }\n    function g(ps: P[]) -> int { return ps[0].x }`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(d?.message).toContain("bind the element first");
  });
  test("printed: `rt.indexRead(xs, i, \"file:line\")` and `rt.atRead(xs, i)`", () => {
    const out = js(prog(`    function g(xs: int[]) -> int { return xs[1] }\n    function h(xs: int[]) -> int | not { return xs.at(1) }`, `        <p>\${g([1, 2])}</p>`));
    expect(out).toContain('rt.indexRead(xs, 1, "t.scrml:2")');
    expect(out).toContain("rt.atRead(xs_1, 1)");
  });
});

// ---------------------------------------------------------------------------
describe("refusals — each with its §34 code", () => {
  test("`while` is E-LOOP-WHILE-RETIRED; `do … while` is E-LOOP-DO-WHILE-RETIRED", () => {
    expect(fnCodes(`        let n = 0\n        while (n < 3) { n = n + 1 }\n        return n`)).toEqual(["E-LOOP-WHILE-RETIRED"]);
    expect(diag(fnProg(`        let n = 0\n        while (n < 3) { n = n + 1 }\n        return n`), "E-LOOP-WHILE-RETIRED").message).toContain("for (cond)");
    expect(fnCodes(`        let n = 0\n        do { n = n + 1 } while (n < 3)\n        return n`)).toEqual(["E-LOOP-DO-WHILE-RETIRED"]);
  });
  test("the braceless head is E-FOR-UNPARENTHESIZED-HEAD; `for (… in …)` is E-CTRL-011", () => {
    expect(fnCodes(`        let n = 0\n        for x in [1, 2] { n = n + x }\n        return n`)).toEqual(["E-FOR-UNPARENTHESIZED-HEAD"]);
    expect(fnCodes(`        let n = 0\n        for x of [1, 2] { n = n + x }\n        return n`)).toEqual(["E-FOR-UNPARENTHESIZED-HEAD"]);
    expect(fnCodes(`        let n = 0\n        for (x in [1, 2]) { n = n + 1 }\n        return n`)).toEqual(["E-CTRL-011"]);
    expect(fnCodes(`        let n = 0\n        for (const x in [1, 2]) { n = n + 1 }\n        return n`)).toEqual(["E-CTRL-011"]);
  });
  test("a range anywhere but the whole iterable is E-RANGE-OUTSIDE-LOOP-HEAD", () => {
    expect(fnCodes(`        const r = 0..10\n        return 1`)).toEqual(["E-RANGE-OUTSIDE-LOOP-HEAD"]);
    expect(fnCodes(`        let s = 0\n        for (i of (0..3)) { s = s + 1 }\n        return s`)).toEqual(["E-RANGE-OUTSIDE-LOOP-HEAD"]);
    expect(fnCodes(`        let s = 0\n        for (i of 0..3 > 1) { s = s + 1 }\n        return s`)).toEqual(["E-RANGE-OUTSIDE-LOOP-HEAD"]);
    expect(fnCodes(`        return g(1..=2)`, "int", `    function g(x: int) -> int { return x }`)).toEqual(["E-RANGE-OUTSIDE-LOOP-HEAD"]);
  });
  test("a range bound that is not an `int` is E-RANGE-BOUND-NOT-INT", () => {
    expect(fnCodes(`        let s = 0\n        for (i of 0..1.5) { s = s + 1 }\n        return s`)).toEqual(["E-RANGE-BOUND-NOT-INT"]);
    expect(fnCodes(`        let s = 0\n        for (i of "a"..3) { s = s + 1 }\n        return s`)).toEqual(["E-RANGE-BOUND-NOT-INT"]);
  });
  test("`break` / `continue` outside any loop: E-LOOP-001 / E-LOOP-002 — in a function and in a handler", () => {
    expect(fnCodes(`        break\n        return 1`)).toEqual(["E-LOOP-001"]);
    expect(fnCodes(`        continue\n        return 1`)).toEqual(["E-LOOP-002"]);
    expect(codes(prog(``, `        <button onclick={ break }>b</button>`))).toEqual(["E-LOOP-001"]);
  });
  test("a label that encloses nothing: E-LOOP-003 / E-LOOP-004 (a sibling loop's label is not one)", () => {
    expect(fnCodes(`        for (i of 0..2) { break nope }\n        return 1`)).toEqual(["E-LOOP-003"]);
    expect(fnCodes(`        for (i of 0..2) { continue nope }\n        return 1`)).toEqual(["E-LOOP-004"]);
    expect(fnCodes(`        a: for (i of 0..2) { }\n        for (j of 0..2) { break a }\n        return 1`)).toEqual(["E-LOOP-003"]);
  });
  test("two loops of one body sharing a label: E-LOOP-006", () => {
    expect(fnCodes(`        a: for (i of 0..2) { }\n        a: for (j of 0..2) { }\n        return 1`)).toEqual(["E-LOOP-006"]);
  });
  test("a condition is a `bool` or a `T | not` presence test (E-COND-NOT-BOOLEAN)", () => {
    expect(fnCodes(`        let n = 3\n        for (n) { n = n - 1 }\n        return n`)).toEqual(["E-COND-NOT-BOOLEAN"]);
  });
  test("what the bootstrap does not iterate, or cannot do in a loop yet, is refused (fail closed)", () => {
    expect(fnCodes(`        let s = 0\n        for (x of 5) { s = s + 1 }\n        return s`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(fnCodes(`        let s = 0\n        for ({ a } of [{ a: 1 }]) { s = s + a }\n        return s`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(fnCodes(`        let s = 0\n        for (x of [1]) { defer { s = 0 } }\n        return s`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    let <c:int=0/>`, `        <button onclick={ for (let i = 0; i < 2; @c = 1) { } }>b</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    // the value form (§49.6) is not in the bootstrap yet
    expect(codes(prog(``, `        <p>\${for (x of [1]) { lift x }}</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

// ---------------------------------------------------------------------------
describe("the grant lens — a loop never gets a write past §66.12.6", () => {
  test("a locked cell written in a loop body: E-WRITE-NOT-GRANTED, as outside one", () => {
    const D = `    <n:int=0/>`;
    const outside = codes(prog(D, `        <button onclick={ @n = 1 }>b</button>`));
    expect(outside).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(codes(prog(D, `        <button onclick={ for (x of [1, 2]) { @n = x } }>b</button>`))).toEqual(outside);
    expect(codes(prog(D, `        <button onclick={ for { @n = 1; break } }>b</button>`))).toEqual(outside);
  });
  test("an ungranted tape edited in a loop: E-WRITE-NOT-GRANTED; a granted one appends (runtime)", async () => {
    expect(codes(prog(`    <xs:int[]=([])/>`, `        <button onclick={ for (i of 0..3) { @xs.append(i) } }>b</button>`))).toEqual(["E-WRITE-NOT-GRANTED"]);
    const src = prog(`    <xs:int[free, append]=([])/>`, `        <button onclick={ for (i of 0..3) { @xs.append(i * 2) } }>b</button>\n        <p id="n">\${@xs.length}</p>`);
    await load(src);
    click(btn("b"));
    expect($("#n").textContent).toBe("3");
  });
  test("a local tape is edited by no loop (the existing local-edit refusal holds in a body)", () => {
    expect(fnCodes(`        let ys: int[free, append] = []\n        for (i of 0..3) { ys.append(i) }\n        return ys.length`)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a server wait in a loop is refused — the loop cannot wait yet (C19)", () => {
    const S = `    function g(id: string) -> string {\n        const r: string = ?{\`SELECT name FROM t WHERE id = \${id}\`}.get() !{ _ :> { return "" } }\n        return r\n    }`;
    const src = prog(`    <program db="sqlite::memory:">\n${S}\n    function f() -> string {\n        let s = ""\n        for (x of ["a"]) { s = s + g(x) }\n        return s\n    }`, `        <p>x</p>`);
    expect(codes(src)).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

// ---------------------------------------------------------------------------
describe("Core — the loop nodes and C19", () => {
  test("a `for` is ONE Core Loop; `break` names its loop's label", () => {
    const r = clean(fnProg(`        let n = 0\n        for { n = n + 1; if (n > 2) { break } }\n        return n`));
    const json = JSON.stringify(r.core);
    expect(json).toContain('"Loop"');
    expect(json).toContain('"Forever"');
    expect(json).toContain('"Break"');
  });
  test("C19 rejects a Break whose loop does not enclose it", () => {
    const r = clean(fnProg(`        let n = 0\n        for { n = n + 1; if (n > 2) { break } }\n        return n`));
    // graft: move the Break out of its loop
    const f = r.core.fns.find((x) => x.sym.hint === "f");
    const loop = f.body.stmts.find((s) => s.variant === "Loop");
    const brk = JSON.parse(JSON.stringify(loop)).data.body.stmts[1].data.thenB.stmts[0];
    f.body.stmts.splice(f.body.stmts.length - 1, 0, brk);
    expect(mods.check.checkCore(r.core).join("\n")).toContain("C19");
  });
});

// ---------------------------------------------------------------------------
describe("review fixes (s469-boot-loops-1 adversarial review)", () => {
  test("HIGH 1: junk in a condition head is reported and the head is skipped forward — never compiled as `while (c)`", () => {
    const r = run(fnProg(`        let c = 0\n        for (c < 3 c) { c = c + 1 }\n        return c`));
    expect([...new Set(r.diags.map((d) => d.code))]).toEqual(["E-PARSE-EXPECTED"]);
    expect(r.core).toBeFalsy();
    expect(codes(fnProg(`        for (true q) { }\n        return 1`))).toEqual(["E-PARSE-EXPECTED"]);
  });
  test("HIGH 1: node ids are not reused after the head's error (no two expression nodes share an id)", () => {
    const f = mods.parse.parseFile("t.scrml", fnProg(`        let c = 0\n        for (c < 3 c) { c = c + 1 }\n        return c`), 0);
    const ids = [];
    const walk = (x) => {
      if (x && typeof x === "object") {
        if (typeof x.nid === "number" && x.k && x.span) ids.push(x.nid);
        for (const v of Object.values(x)) walk(v);
      }
    };
    walk(f);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("HIGH 1 (audit): junk in an iterate / counted head is E-PARSE-EXPECTED, not a compiled loop", () => {
    expect(fnCodes(`        let s = 0\n        for (x of [1] q) { s = s + x }\n        return s`)).toEqual(["E-PARSE-EXPECTED"]);
    expect(fnCodes(`        let s = 0\n        for (let i = 0; i < 2; i = i + 1 q) { s = s + 1 }\n        return s`)).toEqual(["E-PARSE-EXPECTED"]);
  });
  test("HIGH 2: a field / element write through a local is refused, never a rebinding of the whole local", () => {
    const P = `    type P:struct = { name: string }\n    <ps:P[]=([{ name: "a" }])/>`;
    expect(codes(prog(P, `        <button onclick={ for (let p of @ps) { p.name = "z" } }>b</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(P, `        <button onclick={ let p = @ps[0]; p.name = "z" }>b</button>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(P + `\n    function g() -> string {\n        let q: P = { name: "q" }\n        q.name = "z"\n        return q.name\n    }`, `        <p>\${g()}</p>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(codes(prog(`    function g() -> int {\n        let ys: int[] = [1]\n        ys[0] = 2\n        return 1\n    }`, `        <p>\${g()}</p>`))).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
  test("LOW: `for (c < 3) (c) {` is E-CONDITION-HEAD-UNPARENTHESIZED; `0..3 q` and `1..=` at the end are plain syntax errors", () => {
    expect(fnCodes(`        let c = 0\n        for (c < 3) (c) { c = c + 1 }\n        return c`)).toContain("E-CONDITION-HEAD-UNPARENTHESIZED");   // §49.2.3: rejection only — what follows parses as it stands
    expect(fnCodes(`        let c = 0\n        for (c) + 1 { c = c + 1 }\n        return c`)).toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
    expect(fnCodes(`        let s = 0\n        for (i of 0..3 q) { s = s + 1 }\n        return s`)).toEqual(["E-PARSE-EXPECTED"]);
    expect(codes(`<program>\n    function f() -> int {\n        for (i of 1..=`)).not.toContain("E-RANGE-OUTSIDE-LOOP-HEAD");
  });
  test("LOW: `for (const i = 0; …)` is reported once (E-PARSE-FOR-HEAD), with no E-ASSIGN-CONST cascade", () => {
    expect(fnCodes(`        let s = 0\n        for (const i = 0; i < 2; i = i + 1) { s = s + 1 }\n        return s`)).toEqual(["E-PARSE-FOR-HEAD"]);
  });
  test("the shared page-error capture is live (a throwing listener is captured)", () => {
    takePageErrors();
    const b = document.createElement("button");
    document.body.appendChild(b);
    b.addEventListener("click", () => { throw new Error("probe"); });
    b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const errs = takePageErrors();
    expect(errs.map((e) => String(e && e.message))).toEqual(["probe"]);
    b.remove();
  });
});

// ---------------------------------------------------------------------------
describe("review round 3 (s469-boot-loops-1 delta review)", () => {
  const count = (src) => run(src).diags.length;
  test("L1: a missing `)` in a `for` head stops at the body's `{` — the report is no longer than the same slip in an `if`", () => {
    // The loop parser stops at the `{` (the first report). What follows is the
    // CODE-REGION scanner's: an unclosed `(` keeps the function's region open
    // to the end of the file, for an `if` exactly as for a `for` — the same
    // count, and no longer the 18 the round-2 recovery produced.
    const ifCount = count(fnProg(`        let c = 0\n        if (c < 3 { c = c + 1 }\n        return c`));
    for (const head of ["c < 3", "x of [1, 2]", "let i = 0; i < 2; i = i + 1"]) {
      const r = run(fnProg(`        let c = 0\n        for (${head} { c = c + 1 }\n        return c`));
      expect([head, r.diags[0].code, r.diags[0].message.includes("found `{`")]).toEqual([head, "E-PARSE-EXPECTED", true]);
      expect([head, r.diags.length <= ifCount]).toEqual([head, true]);
    }
  });
  test("L3: a condition that continues past its `)` is reported once and the continuation skipped", () => {
    const a = fnProg(`        let c = 0\n        for (c) + 1 < 3 { c = c + 1 }\n        return c`);
    expect(codes(a)).toEqual(["E-CONDITION-HEAD-UNPARENTHESIZED"]);
    expect(count(a)).toBe(1);
    expect(codes(fnProg(`        let c = 0\n        for (c < 3) (c) { c = c + 1 }\n        return c`))).toEqual(["E-CONDITION-HEAD-UNPARENTHESIZED"]);
  });
  test("L2: the part-write advice names a `let` copy when the local cannot be rebound", () => {
    const P = `    type P:struct = { name: string }\n    <ps:P[]=([{ name: "a" }])/>`;
    const binder = diag(prog(P, `        <button onclick={ for (p of @ps) { p.name = "z" } }>b</button>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(binder.message).toContain("cannot be rebound");
    expect(binder.message).not.toContain("rebind it (`p = …`)");
    const param = diag(prog(P + `\n    function g(q: P) { q.name = "z" }`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(param.message).toContain("copy it into a `let`");
    const mut = diag(prog(P + `\n    function g() { let q: P = { name: "q" }\n q.name = "z" }`, `        <p>x</p>`), "E-BOOTSTRAP-UNSUPPORTED");
    expect(mut.message).toContain("rebind it (`q = …`)");
  });
  test("capture root cause: a throw planted right after the conformance adapter swaps the window is captured", async () => {
    const adapter = await import("../../../conformance/adapters/impl1-ts.ts");
    await adapter.run("<p>x</p>\n");          // unregister + register: a FRESH window
    // no helper call in between — the adapter's swap hook re-attached the capture
    const b = document.createElement("button");
    document.body.appendChild(b);
    b.addEventListener("click", () => { throw new Error("after-swap"); });
    b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const errs = takePageErrors();
    expect(errs.map((e) => String(e && e.message))).toEqual(["after-swap"]);
  }, 60000);
});
