/**
 * E-VALUE-FUNCTION-STORED — no value holds a function (§14.3 / §15.11.5, S462 ruling "a").
 *
 * The §14.3 S174 principle "a function is not value data … it SHALL NOT be STORED" extends from
 * struct fields + state cells to EVERY value: an object / array / map literal (or a spread into
 * one) that stores a function value is refused, and so is a state cell holding one. Functions
 * still flow PASSED (arguments, callbacks, props) and CALLED (handlers). An object/array literal
 * written DIRECTLY as an argument to a host-JS call is at the boundary and allowed (S462 "go on
 * the package" (3)).
 *
 * Asserts over BOTH streams so an E- code landing in result.warnings is caught.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "value-fn-stored-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}
function stored(res) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === "E-VALUE-FUNCTION-STORED");
}
const prog = (logic, markup = `<p>x</p>`) => `\${\n${logic}\n}\n<program>${markup}</>\n`;

describe("E-VALUE-FUNCTION-STORED — refused (a value stores a function)", () => {
  test("object literal field holding a declared function", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  const ops = { double: twice }`, `<p>\${ops.double(2)}</p>`));
    const d = stored(res);
    expect(d.length).toBe(1);
    expect(res.errors.some((e) => e.code === "E-VALUE-FUNCTION-STORED")).toBe(true);
    expect(d[0].message).toContain("`twice`");
    expect(d[0].message).toContain("field `double`");
  });

  test("object literal field holding an arrow function", () => {
    const d = stored(compile(prog(`  const ops = { inc: (x) => x + 1 }`, `<p>\${ops.inc(1)}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("arrow function");
  });

  test("object literal field holding a fn expression (unreadable to acorn — read as codegen emits it)", () => {
    const d = stored(compile(prog(`  const ops = { id: fn(x) { return x } }`, `<p>\${ops.id(1)}</p>`)));
    expect(d.length).toBe(1);
  });

  test("shorthand field naming a function", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  const ops = { twice }`, `<p>\${ops.twice(2)}</p>`)));
    expect(d.length).toBe(1);
  });

  test("array literal element", () => {
    const d = stored(compile(prog(`  function a() { return 1 }\n  function b() { return 2 }\n  const fs = [a, b]`, `<p>\${fs.length}</p>`)));
    expect(d.length).toBe(2);
  });

  test("a nested literal", () => {
    const d = stored(compile(prog(`  function a() { return 1 }\n  const t = { inner: { deep: [a] } }`, `<p>\${t.inner}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("array literal");
  });

  test("a spread argument that is itself a function", () => {
    const d = stored(compile(prog(`  function a() { return 1 }\n  const t = { ...a }`, `<p>\${t}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("spread");
  });

  test("ternary / ?? choosing a function is still a function", () => {
    const d = stored(compile(prog(`  function a() { return 1 }\n  function b() { return 2 }\n  const pick = true\n  const t = { f: pick ? a : b }`, `<p>\${t}</p>`)));
    expect(d.length).toBe(1);
  });

  test("state cell initialised with a function (§15.11.5 — was a bug: `<f> = twice` compiled)", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  <f> = twice`, `<p>\${@f}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("state cell `@f`");
  });

  test("state cell assigned a function, a field of a state cell, and a push into one", () => {
    const src = prog(
      `  function twice(x) { return x * 2 }\n  <f> = 0\n  <o> = {}\n  <xs> = []\n` +
      `  function go() {\n    @f = twice\n    @o.k = twice\n    @xs.push(twice)\n  }`,
      `<button onclick=go()>go</button>`,
    );
    const d = stored(compile(src));
    expect(d.length).toBe(3);
  });

  test("an object literal passed to a SCRML function is still a stored value (not the host boundary)", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  function run(cfg) { return cfg }\n  const r = run({ f: twice })`, `<p>\${r}</p>`)));
    expect(d.length).toBe(1);
  });

  test("a function declared after its use is hoisted", () => {
    const d = stored(compile(prog(`  const ops = { later: later }\n  function later() { return 1 }`, `<p>\${ops}</p>`)));
    expect(d.length).toBe(1);
  });
});

describe("E-VALUE-FUNCTION-STORED — allowed (passed / called / host boundary)", () => {
  test("a function passed as an argument / callback", () => {
    const res = compile(prog(
      `  function twice(x) { return x * 2 }\n  function apply(f, v) { return f(v) }\n  const a = apply(twice, 3)\n  const ys = [1, 2].map(twice)\n  const zs = [1, 2].map((x) => x + 1)`,
      `<p>\${a} \${ys} \${zs}</p>`,
    ));
    expect(stored(res).length).toBe(0);
  });

  test("an event handler is CALLED, not stored", () => {
    const res = compile(prog(`  <n> = 0\n  function bump() { @n = @n + 1 }`, `<button onclick=bump()>\${@n}</button>`));
    expect(stored(res).length).toBe(0);
  });

  test("an object/array literal written directly as a host-JS call argument", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  function go() { console.log({ f: twice }, [twice]) }`, `<button onclick=go()>go</button>`));
    expect(stored(res).length).toBe(0);
  });

  test("a parameter shadowing a function name is not a function", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  function wrap(twice) { return { v: twice } }\n  const w = wrap(1)`, `<p>\${w}</p>`));
    expect(stored(res).length).toBe(0);
  });

  test("a value holding only data", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  const o = { n: twice(2), tag: "a", xs: [1, 2] }`, `<p>\${o.n}</p>`));
    expect(stored(res).length).toBe(0);
  });

  test("a local const bound to an arrow is a function definition, not a stored value", () => {
    const res = compile(prog(`  const inc = (x) => x + 1\n  const y = inc(1)`, `<p>\${y}</p>`));
    expect(stored(res).length).toBe(0);
  });

  test("a map literal holding only data, and a map whose value is a call result", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  const m = ["a": 1, "b": twice(2)]`, `<p>\${m["a"]}</p>`));
    expect(stored(res).length).toBe(0);
  });

  test("a storing method on a host receiver is the host boundary", () => {
    const res = compile(prog(`  function twice(x) { return x * 2 }\n  function go() { window.handlers.push(twice) }`, `<button onclick=go()>go</button>`));
    expect(stored(res).length).toBe(0);
  });
});

// S464 "Yes, maps too (Recommended)" — MAP LITERALS are values too: a function-valued map entry is
// refused, whether written in the §59.3 literal or put there by the §59.7 `.insert` write.
describe("E-VALUE-FUNCTION-STORED — maps (§59.3 / §59.7)", () => {
  test("string-key map literal whose value is a declared function", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  const m = ["k": twice]`, `<p>\${m["k"]}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("map literal");
    expect(d[0].message).toContain("`twice`");
  });

  test("identifier-key map literal whose value is an arrow function", () => {
    const d = stored(compile(prog(`  const k = "a"\n  const m = [k: (x) => x + 1]`, `<p>\${m[k]}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("arrow function");
  });

  test("a map literal mixing data and a function reports the function entry", () => {
    const d = stored(compile(prog(`  const m = ["n": 2, "f": (x) => x + 1]`, `<p>\${m["n"]}</p>`)));
    expect(d.length).toBe(1);
  });

  test("a state cell initialised with a function-valued map literal", () => {
    const d = stored(compile(`\${\n  function twice(x) { return x * 2 }\n}\n<m> = ["k": twice]\n<program><p>x</p></>\n`));
    expect(d.length).toBe(1);
  });

  test("`.insert(k, f)` on a local map stores a function in it", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  let m = [:]\n  m = m.insert("k", twice)`, `<p>\${m.size}</p>`)));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain(".insert(");
  });

  test("`@m = @m.insert(k, f)` on a map state cell", () => {
    const d = stored(compile(`\${\n  function twice(x) { return x * 2 }\n}\n<m> = [:]\n<program><button onclick=\${@m = @m.insert("k", twice)}>x</button></>\n`));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("state cell `@m`");
  });

  test("`.push(f)` on a local array stores a function in it", () => {
    const d = stored(compile(prog(`  function twice(x) { return x * 2 }\n  let xs = []\n  xs.push(twice)`, `<p>\${xs.length}</p>`)));
    expect(d.length).toBe(1);
  });

  test("`.update(k, f)` on a map CALLS its updater — not a store", () => {
    const src = `\${\n}\n<fares> = ["a": 1]\n<program><button onclick=\${ @fares = @fares.update("a", (v) => v + 1) }>x</button></>\n`;
    expect(stored(compile(src)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S464 fix round 1 (adversarial review of 5e1ae5ed5). Each case below compiled clean, or was
// wrongly refused, under the round-0 check.
// ---------------------------------------------------------------------------
const TWICE = `  function twice(x) { return x * 2 }\n`;
const cellProg = (logic, cells, markup) => `\${\n${logic}}\n${cells}\n<program>${markup}</>\n`;

describe("fix round 1 — F1: block-bodied arrow / function expression bodies are read", () => {
  test("`onclick=${ () => { @fs.push(twice) } }` (e03)", () => {
    const d = stored(compile(cellProg(TWICE, "<fs> = []", `<button onclick=\${ () => { @fs.push(twice) } }>x</button><p>\${@fs.length}</p>`)));
    expect(d.length).toBe(1);
  });
  test("a block arrow assigning a function-holding literal to a cell (d02)", () => {
    const d = stored(compile(cellProg(TWICE, "<o> = {}", `<button onclick=\${ () => { @o = { f: twice } } }>x</button><p>\${@o}</p>`)));
    expect(d.length).toBe(1);
  });
  test("a `function` expression body pushing a function (e05)", () => {
    const d = stored(compile(cellProg(`${TWICE}  function add() { const h = function () { @fs.push(twice) }\n    h() }\n`, "<fs> = []", `<button onclick=add()>x</button><p>\${@fs.length}</p>`)));
    expect(d.length).toBe(1);
  });
  test("a block arrow RETURNING a function-holding literal (d01, d07)", () => {
    expect(stored(compile(prog(`  const mk = () => { return { f: (x) => x } }\n  const o = mk()`, `<p>\${o.f(1)}</p>`))).length).toBe(1);
    expect(stored(compile(prog(`${TWICE}  const mk = () => { return { f: twice } }`, `<p>\${mk().f(1)}</p>`))).length).toBe(1);
  });
  test("a block-bodied callback building a function-holding literal (d05)", () => {
    const d = stored(compile(prog(`${TWICE}  const xs = [1, 2].map((v) => { return { v: v, f: twice } })`, `<p>\${xs.length}</p>`)));
    expect(d.length).toBe(1);
  });
});

describe("fix round 1 — F2: a function hidden behind a name", () => {
  test("`const g = twice; { d: g }` (b01)", () => {
    expect(stored(compile(prog(`${TWICE}  const g = twice\n  const ops = { d: g }`, `<p>\${ops.d(2)}</p>`))).length).toBe(1);
  });
  test("`<f> = g` with `g` an alias declared in another logic block (c01)", () => {
    expect(stored(compile(cellProg(`${TWICE}  const g = twice\n`, "<f> = g", `<p>\${@f(2)}</p>`))).length).toBe(1);
  });
  test("`@fs.push(g)` with `g` an alias (c12)", () => {
    expect(stored(compile(cellProg(`${TWICE}  const g = twice\n`, "<fs> = []", `<button onclick=\${ @fs.push(g) }>x</button><p>\${@fs.length}</p>`))).length).toBe(1);
  });
  test("an alias of a const arrow (c10)", () => {
    expect(stored(compile(prog(`  const inc = (x) => x + 1\n  const g = inc\n  const xs = [g]`, `<p>\${xs.length}</p>`))).length).toBe(1);
  });
  test("a binding REASSIGNED a function (`let g = 1; g = twice`) (b19)", () => {
    expect(stored(compile(prog(`${TWICE}  let g = 1\n  g = twice\n  const ops = { d: g }`, `<p>x</p>`))).length).toBe(1);
  });
  test("a server fn returning `{ n, h }` with `h` an alias of a lambda (c09 — was silently dropped from JSON)", () => {
    const src = `\${\n  server function get() { const u = { n: 1 }\n    const g = (x) => x\n    const h = g\n    return { n: u.n, h: h } }\n}\n<r> = ""\n<program><button onclick=\${ @r = get() }>x</button><p>\${@r}</p></>\n`;
    expect(stored(compile(src)).length).toBe(1);
  });
});

describe("fix round 1 — a function written INTO a value (field / index write, any storing method)", () => {
  test("`o.f = twice` / `o[\"g\"] = twice` on a plain local", () => {
    const d = stored(compile(prog(`${TWICE}  function go() {\n    const o = { n: 1 }\n    o.f = twice\n    o["g"] = twice\n    return o.n\n  }`, `<p>\${go()}</p>`)));
    expect(d.length).toBe(2);
  });
  test("`u.toJSON = () => …` on a value", () => {
    expect(stored(compile(prog(`  function go() {\n    const u = { n: 1 }\n    u.toJSON = () => 1\n    return u.n\n  }`, `<p>\${go()}</p>`))).length).toBe(1);
  });
  test("`@o[\"k\"] = twice` and `@fs[0] = twice` (b12, b17)", () => {
    expect(stored(compile(cellProg(TWICE, "<o> = {}", `<button onclick=\${ @o["k"] = twice }>x</button>`))).length).toBe(1);
    expect(stored(compile(cellProg(TWICE, "<fs> = [1]", `<button onclick=\${ @fs[0] = twice }>x</button>`))).length).toBe(1);
  });
  test("`.concat(twice)`, `.with(0, twice)`, `[].concat(twice)` (b11, b16, b07)", () => {
    expect(stored(compile(cellProg(TWICE, "<fs> = []", `<button onclick=\${ @fs = @fs.concat(twice) }>x</button>`))).length).toBe(1);
    expect(stored(compile(cellProg(TWICE, "<fs> = [1]", `<button onclick=\${ @fs = @fs.with(0, twice) }>x</button>`))).length).toBe(1);
    expect(stored(compile(prog(`${TWICE}  const xs = [].concat(twice)`, `<p>\${xs.length}</p>`))).length).toBe(1);
  });
  test("a host-rooted target is the host boundary (`el.onclick = tick`)", () => {
    expect(stored(compile(prog(`  function tick() { }\n  const el = document.body\n  el.onclick = tick`, `<p>x</p>`))).length).toBe(0);
  });
});

describe("fix round 1 — F4: enum payloads, defaults, laundering through parameters and returns", () => {
  test("`Op.Apply(twice)` / `Op.Apply((x) => x)` (c08, e01)", () => {
    expect(stored(compile(prog(`  type Op:enum = { Apply(f: number) }\n${TWICE}  const op = Op.Apply(twice)`, `<p>x</p>`))).length).toBe(1);
    expect(stored(compile(prog(`  type Op:enum = { Apply(f: string) }\n  const op = Op.Apply((x) => x)`, `<p>x</p>`))).length).toBe(1);
  });
  test("a function-declaration default parameter `o = { d: twice }` (b03)", () => {
    expect(stored(compile(prog(`${TWICE}  function mk(o = { d: twice }) { return o }\n  const ops = mk()`, `<p>\${ops.d(2)}</p>`))).length).toBe(1);
  });
  test("a destructuring default `const { f = twice } = {}; { f }` (b18)", () => {
    expect(stored(compile(prog(`${TWICE}  const { f = twice } = {}\n  const ops = { f }`, `<p>x</p>`))).length).toBe(1);
  });
  test("a parameter handed a function and stored (`function wrap(cb) { return { cb: cb } }`) (b08)", () => {
    expect(stored(compile(prog(`${TWICE}  function wrap(cb) { return { cb: cb } }\n  const ops = wrap(twice)`, `<p>\${ops.cb(2)}</p>`))).length).toBe(1);
  });
  test("a function laundered through a returning helper (`{ d: id(twice) }`) (b02)", () => {
    expect(stored(compile(prog(`${TWICE}  function id(x) { return x }\n  const ops = { d: id(twice) }`, `<p>\${ops.d(2)}</p>`))).length).toBe(1);
  });
  test("the same helper returning DATA is not a function (`{ d: id(5) }`)", () => {
    expect(stored(compile(prog(`${TWICE}  function id(x) { return x }\n  const a = id(twice)\n  const ops = { d: id(5) }`, `<p>\${ops.d}\${a(1)}</p>`))).length).toBe(0);
  });
  test("a function-TYPED parameter stored into a value", () => {
    expect(stored(compile(prog(`  fn keep(cb: () -> void) { return { cb: cb } }`, `<p>x</p>`))).length).toBe(1);
  });
});

describe("fix round 1 — S464 \"(a) Close it\": a kept host-call result", () => {
  test("`const o = Object.freeze({ f: twice })` / `Object.fromEntries([[\"d\", twice]])` (c13)", () => {
    expect(stored(compile(prog(`${TWICE}  const o = Object.freeze({ f: twice })`, `<p>x</p>`))).length).toBe(1);
    expect(stored(compile(prog(`${TWICE}  const o = Object.fromEntries([["d", twice]])`, `<p>\${o.d(2)}</p>`))).length).toBe(1);
  });
  test("statement-position host calls stay legal", () => {
    const res = compile(prog(`  function tick() { }\n  function go() { console.log({ f: tick }); document.addEventListener("x", tick, { once: true }); setTimeout(tick, 1) }`, `<button onclick=go()>x</button>`));
    expect(stored(res).length).toBe(0);
  });
});

describe("fix round 1 — F5: binders that shadow a file function are not that function", () => {
  test("a statement-`match` arm payload binder (g03)", () => {
    const src = `\${\n  type E:enum = { Bad(email: string), Ok }\n  function email(x) { return x }\n  function show(e: E) {\n    match e {\n      .Bad(email) :> { return [email] }\n      .Ok :> { return [] }\n    }\n  }\n}\n<program><p>\${show(E.Ok)}</p></>\n`;
    expect(stored(compile(src)).length).toBe(0);
  });
  test("an `<each … as it>` binder", () => {
    const src = `\${\n  function it(x) { return x }\n}\n<rows> = [1, 2]\n<program><ul><each in=@rows as it><li>\${ JSON.stringify([it]) }</li></each></ul></>\n`;
    expect(stored(compile(src)).length).toBe(0);
  });
});

describe("fix round 1 — F6: each stored function is reported at its own position with its path", () => {
  test("two literals in one call are two reports; a nested field names its path and line", () => {
    const src = `\${\n${TWICE}  function take(a, b) { return a }\n  const r = take({ a: twice }, { a: twice })\n  const p = {\n    n: 1,\n    deep: { f: twice }\n  }\n}\n<program><p>\${r}\${p.n}</p></>\n`;
    const d = stored(compile(src));
    expect(d.length).toBe(3);
    const lines = d.map((x) => x.span.line).sort();
    expect(lines).toEqual([4, 4, 7]);
    const cols = d.filter((x) => x.span.line === 4).map((x) => x.span.col).sort((a, b) => a - b);
    expect(cols[0]).not.toBe(cols[1]);
    expect(d.find((x) => x.span.line === 7).message).toContain("`deep.f`");
  });
});

// ---------------------------------------------------------------------------
// S464 fix round 2 (re-review of 8e685cc35). Each refusal below compiled clean under round 1.
// ---------------------------------------------------------------------------
describe("fix round 2 — N1: the dot-shorthand enum payload", () => {
  test("`const v: Op = .Apply(twice)` and `return .Apply(twice)` (e3, e1)", () => {
    expect(stored(compile(prog(`  type Op:enum = { Apply(f: string), None }\n${TWICE}  const v: Op = .Apply(twice)`, `<p>\${v}</p>`))).length).toBe(1);
    expect(stored(compile(prog(`  type Op:enum = { Apply(f: string), None }\n${TWICE}  function mk() -> Op { return .Apply(twice) }\n  const v = mk()`, `<p>\${v}</p>`))).length).toBe(1);
  });
});

describe("fix round 2 — S464 \"(a) Close it\": a value built from what a callback RETURNS", () => {
  test("`[1, 2].map(() => twice)` / `.map((n) => (x) => x + n)` / `Array.from([1], () => twice)` (c05, c06, c13)", () => {
    for (const logic of [
      `${TWICE}  const o = [1, 2].map(() => twice)`,
      `  const o = [1, 2].map((n) => (x) => x + n)`,
      `${TWICE}  const o = Array.from([1], () => twice)`,
    ]) {
      const d = stored(compile(prog(logic, `<p>\${o}</p>`)));
      expect(d.length).toBe(1);
      expect(d[0].message).toContain("bind the call at the use site");
    }
  });
  test("`items.map((i) => () => pick(i))` — the closure-array the ruling names", () => {
    const d = stored(compile(prog(`  function pick(i) { return i }\n  const items = [1, 2]\n  const handlers = items.map((i) => () => pick(i))`, `<p>\${handlers.length}</p>`)));
    expect(d.length).toBe(1);
  });
  test("a callback that returns DATA builds data (`.map(twice)`, `Array.from(xs, twice)`)", () => {
    expect(stored(compile(prog(`${TWICE}  const a = [1, 2].map(twice)\n  const b = Array.from([1, 2], twice)\n  const c = [1].map((x) => x + 1)`, `<p>\${a}\${b}\${c}</p>`))).length).toBe(0);
  });
});

describe("fix round 2 — N3: function facts cross an import", () => {
  function compileWithLib(main) {
    const dir = mkdtempSync(join(TMP, "imp-"));
    writeFileSync(join(dir, "lib.scrml"), `\${\n  export function twice(x) { return x * 2 }\n  export function adder(n) { return (x) => x + n }\n  export const inc = (x) => x + 1\n  export const LIMIT = 3\n}\n`);
    const fp = join(dir, "main.scrml");
    writeFileSync(fp, main);
    const res = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} });
    return stored(res).filter((d) => String(d.span?.file ?? fp).endsWith("main.scrml"));
  }
  test("an exported const arrow stored (`[inc]`) and an imported closure-returning call stored (`{ f: adder(2) }`)", () => {
    expect(compileWithLib(`\${\n  import { inc } from './lib.scrml'\n  const o = [inc]\n}\n<program><p>\${o}</p></>\n`).length).toBe(1);
    expect(compileWithLib(`\${\n  import { adder } from './lib.scrml'\n  const o = { f: adder(2) }\n}\n<program><p>\${o.f(1)}</p></>\n`).length).toBe(1);
  });
  test("imported DATA and imported data-returning calls are not functions", () => {
    expect(compileWithLib(`\${\n  import { twice, LIMIT } from './lib.scrml'\n  const o = { n: twice(2), max: LIMIT }\n}\n<program><p>\${o.n}</p></>\n`).length).toBe(0);
  });
});

describe("fix round 2 — N4: host calls that store into a value, kept host results, known host callables", () => {
  test("`Object.assign(o, { f: twice })` / `Object.defineProperty(o, \"f\", { value: twice })` on a scrml value (c02, c03)", () => {
    expect(stored(compile(prog(`${TWICE}  const o = { n: 1 }\n  Object.assign(o, { f: twice })`, `<p>\${o.n}</p>`))).length).toBe(1);
    expect(stored(compile(prog(`${TWICE}  const o = { n: 1 }\n  Object.defineProperty(o, "f", { value: twice })`, `<p>\${o.n}</p>`))).length).toBe(1);
  });
  test("kept host results holding a function: `Array.of(twice)`, `new Array(2).fill(twice)`, `new Set().add(twice)`, `new Map().set(\"k\", twice)` (c14, c15)", () => {
    for (const init of ["Array.of(twice)", "new Array(2).fill(twice)", "new Set().add(twice)", `new Map().set("k", twice)`]) {
      expect(stored(compile(prog(`${TWICE}  const o = ${init}`, `<p>x</p>`))).length).toBe(1);
    }
  });
  test("a local host collection that took a function, then stored in a value (c11, c12)", () => {
    expect(stored(compile(prog(`${TWICE}  const s = new Set()\n  s.add(twice)\n  const o = { s: s }`, `<p>x</p>`))).length).toBe(1);
    expect(stored(compile(prog(`${TWICE}  const m = new Map()\n  m.set("k", twice)\n  const o = { m: m }`, `<p>x</p>`))).length).toBe(1);
  });
  test("a host value KNOWN callable stored: `{ f: Math.max }`, `{ t: String }` (c20)", () => {
    expect(stored(compile(prog(`  const o = { f: Math.max }`, `<p>x</p>`))).length).toBe(1);
    expect(stored(compile(prog(`  const o = { t: String }`, `<p>x</p>`))).length).toBe(1);
  });
  test("host DATA stays legal: `{ pi: Math.PI }`, `Object.assign({}, { a: 1 })`, a statement `new Set().add(twice)`", () => {
    expect(stored(compile(prog(`${TWICE}  const o = { pi: Math.PI, m: Object.assign({}, { a: 1 }) }\n  function go() { new Set().add(twice) }`, `<button onclick=go()>\${o.pi}</button>`))).length).toBe(0);
  });
});

describe("fix round 2 — N5: the fixpoint runs to convergence (no silent 16-pass cap)", () => {
  test("a 17-deep reverse-order alias chain is still refused", () => {
    const lines = [TWICE.trimEnd()];
    for (let i = 17; i >= 1; i--) lines.push(`  function a${i}() { return a${i - 1}() }`);
    lines.push("  function a0() { return twice }", "  const o = { v: a17() }");
    expect(stored(compile(prog(lines.join("\n"), `<p>\${o.v}</p>`))).length).toBe(1);
  });
});
