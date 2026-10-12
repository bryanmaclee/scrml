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
});
