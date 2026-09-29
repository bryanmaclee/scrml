// grants.test.js — RULED S442 (user-voice "the tape 'where it changes' axis
// splits grow from shrink; `anywhere` covers end/front"; tokens: "spellings
// are fine"): grow and shrink are separate grants at each place —
// `append`/`pop` (end), `prepend`/`shift` (front), `insert`/`remove`
// (anywhere) — and `insert` / `remove` cover end and front. The retired bare
// `end` / `front` / `anywhere` are refused naming both halves.
//
// A GRANTED removal (pop / shift / filter) is still E-BOOTSTRAP-UNSUPPORTED:
// Core has no removal edit (core.scrml is outside this slice) — so "granted"
// below means "not a grant error".

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const prog = (type, body) => `<program>\n    <xs:${type}=([])/>\n    function f() { ${body} }\n    <main><ul><each in=@xs as x><li>\${x}</li></each></ul></main>\n</program>\n`;
const codes = (type, body) => frontEnd(mods, [{ path: "g.scrml", src: prog(type, body) }]).diags.map((d) => d.code);
const GRANTED_NOT_LOWERED = ["E-BOOTSTRAP-UNSUPPORTED"];

describe("the audit log `[free, append]` is append-only", () => {
  const T = "string[free, append]";
  test("push and `[...@xs, e]` are granted", () => {
    expect(codes(T, `@xs.push("a")`)).toEqual([]);
    expect(codes(T, `@xs = [...@xs, "a"]`)).toEqual([]);
  });
  test("pop, shift, filter and a front-prepend are REFUSED (E-WRITE-NOT-GRANTED)", () => {
    for (const b of [`@xs.pop()`, `@xs.shift()`, `@xs = @xs.filter(x => true)`, `@xs.unshift("a")`, `@xs = ["a", ...@xs]`]) {
      expect(codes(T, b)).toEqual(["E-WRITE-NOT-GRANTED"]);
    }
  });
});

describe("a stack `[free, append, pop]`", () => {
  const T = "string[free, append, pop]";
  test("push granted; pop granted (not a grant error — Core has no removal edit)", () => {
    expect(codes(T, `@xs.push("a")`)).toEqual([]);
    expect(codes(T, `@xs.pop()`)).toEqual(GRANTED_NOT_LOWERED);
  });
  test("shift is still refused (a front removal)", () => {
    expect(codes(T, `@xs.shift()`)).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});

describe("`[free, insert, remove, writable]` — anywhere covers end and front", () => {
  const T = "string[free, insert, remove, writable]";
  test("push and unshift (grow) granted and lowered; pop, shift, filter (shrink) granted", () => {
    expect(codes(T, `@xs.push("a")`)).toEqual([]);
    expect(codes(T, `@xs.unshift("a")`)).toEqual([]);
    expect(codes(T, `@xs.pop()`)).toEqual(GRANTED_NOT_LOWERED);
    expect(codes(T, `@xs.shift()`)).toEqual(GRANTED_NOT_LOWERED);
    expect(codes(T, `@xs = @xs.filter(x => true)`)).toEqual(GRANTED_NOT_LOWERED);
  });
  test("runs: an `insert` grant appends AND prepends", async () => {
    const src = `<program>\n    <xs:string[free, insert]=([])/>\n    function f() { @xs.push("b")\n @xs.unshift("a")\n @xs = [...@xs, "c"] }\n    <main><button onclick=f()>go</button><ul><each in=@xs as x><li>\${x}</li></each></ul></main>\n</program>\n`;
    const r = frontEnd(mods, [{ path: "g.scrml", src }]);
    expect(r.diags).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    const { program } = await loadProgram(r.core, "grants-insert", ["f"]);
    program.f();
    expect([...document.querySelectorAll("main li")].map((li) => li.textContent)).toEqual(["a", "b", "c"]);
  });
  test("`filter` is a SHRINK: granted by `remove`, refused under `insert` alone", () => {
    expect(codes("string[free, remove]", `@xs = @xs.filter(x => true)`)).toEqual(GRANTED_NOT_LOWERED);
    expect(codes("string[free, insert]", `@xs = @xs.filter(x => true)`)).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
  test("a SHRINK-only type (`[free, pop]`) grants pop (no growing grant needed)", () => {
    expect(codes("string[free, pop]", `@xs.pop()`)).toEqual(GRANTED_NOT_LOWERED);
  });
  test("`remove` alone grants no growing edit", () => {
    expect(codes("string[free, remove]", `@xs.push("a")`)).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});

describe("`[free, prepend, shift]` — a queue at the front", () => {
  const T = "string[free, prepend, shift]";
  test("unshift and `[e, ...@xs]` granted; shift granted; push and pop refused", () => {
    expect(codes(T, `@xs.unshift("a")`)).toEqual([]);
    expect(codes(T, `@xs = ["a", ...@xs]`)).toEqual([]);
    expect(codes(T, `@xs.shift()`)).toEqual(GRANTED_NOT_LOWERED);
    expect(codes(T, `@xs.push("a")`)).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(codes(T, `@xs.pop()`)).toEqual(["E-WRITE-NOT-GRANTED"]);
  });
});

describe("the retired place tokens are refused, naming both halves", () => {
  for (const [tok, grow, shrink] of [["end", "append", "pop"], ["front", "prepend", "shift"], ["anywhere", "insert", "remove"]]) {
    test(`\`${tok}\` → E-GRANT-UNKNOWN naming \`${grow}\` and \`${shrink}\``, () => {
      const d = frontEnd(mods, [{ path: "g.scrml", src: prog(`string[free, ${tok}]`, `@xs = @xs`) }]).diags;
      const g = d.filter((x) => x.code === "E-GRANT-UNKNOWN");
      expect(g.length).toBe(1);
      expect(g[0].message).toContain("`" + grow + "`");
      expect(g[0].message).toContain("`" + shrink + "`");
    });
  }
  test("an unknown word keeps the old message (no `any` / `all`)", () => {
    const d = frontEnd(mods, [{ path: "g.scrml", src: prog(`string[free, any]`, `@xs = @xs`) }]).diags;
    expect(d.filter((x) => x.code === "E-GRANT-UNKNOWN")[0].message).toContain("no `any`");
  });
});
