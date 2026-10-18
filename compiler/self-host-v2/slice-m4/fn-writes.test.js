// fn-writes.test.js — s468-bootstrap-failopen-gaps: the WRITE half of E-FN-003.
//
// SPEC §48.3.3: "A `fn` body SHALL NOT write to any variable declared outside
// the `fn`'s own scope boundary. This includes: … Property mutation on a value
// declared outside the `fn` body (`outer.field = value`). Calling a mutating
// method on an `@` reactive variable declared outside the `fn` body (e.g.,
// `@list.push(item)` where `@list` is declared outside)." … "Local
// `let`/`const`/`lin` variables declared inside the `fn` body may be freely
// mutated."
//
// The gap (g-bootstrap-fn-writes-outer-cells-not-refused, review #1202): the
// bootstrap enforced only the CALL half (a `fn` calling a `function`); each of
// `@n = 1`, `@xs.push(2)`, `@xs.pop()`, `@rows[0].qty = 2` in a `fn` body
// compiled with zero diagnostics. impl#1 (reference): `fn f() -> int { @n = 1 … }`
// is E-FN-003 there.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const ROW = "type Row:struct = { let qty: int }\n";
const P = (decls, main = `        <p>\${@n}</p>`) => `${ROW}<program>
    let <n:int=0/>
    <xs:int[free, append, pop]=([1])/>
    <rows:Row[]=([{ qty: 1 }])/>
${decls}
    <main>
${main}
    </main>
</program>
`;

describe("§48.3.3 — a `fn` body that writes a reactive cell is E-FN-003 (it compiled clean)", () => {
  for (const [what, body] of [
    ["an assignment `@n = 1`", "@n = 1"],
    ["a mutating call `@xs.push(2)`", "@xs.push(2)"],
    ["a removal `@xs.pop()`", "@xs.pop()"],
    ["an element field write `@rows[0].qty = 2`", "@rows[0].qty = 2"],
    ["a compound write `@n = @n + 1`", "@n = @n + 1"],
    ["`reset(@n)`", "reset(@n)"],
  ]) {
    test(what, () => {
      const d = run(P(`    fn f() -> int { ${body}\n        return 1 }`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-FN-003"]);
      expect(d[0].message).toContain("`fn f`");
      expect(d[0].message).toContain("§48.3.3");
    });
  }

  test("each write is reported once, where it stands (two writes → two reports)", () => {
    const src = P(`    fn f() -> int { @n = 1\n        @xs.push(3)\n        return 1 }`);
    const d = run(src).diags;
    expect(d.map((x) => x.code)).toEqual(["E-FN-003", "E-FN-003"]);
    expect(src.slice(d[0].span.start, d[0].span.end)).toContain("@n = 1");
    expect(src.slice(d[1].span.start, d[1].span.end)).toContain("@xs.push(3)");
  });

  test("a write inside an `if` of the `fn` body", () => {
    expect(codes(P(`    fn f(k: int) -> int {\n        if (k > 0) { @n = k }\n        return 1 }`))).toEqual(["E-FN-003"]);
  });

  test("a `fn` calling a `fn` that writes: reported once, at the write (the caller is judged through its callee — §48.3 'any reachable call chain')", () => {
    const d = run(P(`    fn g() -> int { @n = 2\n        return 1 }\n    fn f() -> int { return g() }`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-FN-003"]);
    expect(d[0].message).toContain("`fn g`");
  });
});

describe("twins — what §48.3.3 admits stays clean", () => {
  test("a `fn` mutating its OWN locals, reading cells, returning a new value", () => {
    expect(codes(P(`    fn f(k: int) -> int {\n        let acc: int = 0\n        acc = acc + k + @n\n        return acc }`))).toEqual([]);
  });
  test("a `function` writing cells (the impure form) is clean", () => {
    expect(codes(P(`    function f() { @n = 1\n        @xs.push(2) }`, `        <button onclick=f()>b</button>`))).toEqual([]);
  });
  test("the caller writes what the `fn` computed (the fix the message names)", () => {
    expect(codes(P(`    fn next(k: int) -> int { return k + 1 }\n    function bump() { @n = next(@n) }`, `        <button onclick=bump()>b</button>`))).toEqual([]);
  });
});
