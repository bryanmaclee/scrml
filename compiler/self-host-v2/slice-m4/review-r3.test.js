// review-r3.test.js — the O19 residue (an own TYPE with no initializer plus typed
// attributes) and the sub-field removal message. See progress.md "O19 RESIDUE".

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const box = (child, use = "<box/>") => `<program>\n <box a:int=1>\n${child}\n </>\n renders <p>\${a}|\${c}</p>\n <main>${use}</main>\n</program>\n`;

describe("O19 — an own TYPE without an initializer, plus typed attributes, is refused", () => {
  test("at program level: `<c:int s:int=7/>` → E-BOOTSTRAP-UNSUPPORTED naming O19 (was: renders [object Object])", () => {
    const d = run(`<program>\n <c:int s:int=7/>\n <main><p>\${@c}</p></main>\n</program>\n`).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("O19");
  });
  test("as a child field, with and without a use-site value (was: `s` dropped from Core)", () => {
    expect(run(box(" <c:int s:int=7/>")).diags.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(run(box(" <c:int s:int=7/>", "<box c=3/>")).diags.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("twin: an own type with no initializer and NO attributes compiles and takes the use-site value", async () => {
    const r = run(box(" <c:int/>", "<box c=3/>"));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r3-o19-twin");
    expect(document.querySelector("main > p").textContent).toBe("1|3");
  });
  test("twin: the `:struct` container marker with typed attributes is not an own value", () => {
    expect(run(`<program>\n <g:struct x:int=1/>\n <main><p>x</p></main>\n</program>\n`).diags.map((x) => x.code)).not.toContain("E-BOOTSTRAP-UNSUPPORTED");
  });
});

describe("a removal on a SUB-field sequence names the place (`@r.xs`) and is refused like `.push`", () => {
  const prog = (t) => `<program>\n type R:struct = { xs: ${t} }\n <let r:R=({ xs: [] })/>\n function f() { @r.xs.pop() }\n <main><p>x</p></main>\n</program>\n`;
  test("`@r.xs.pop()` → E-BOOTSTRAP-UNSUPPORTED naming `@r.xs.pop()` (never judged by `r`'s own `let`)", () => {
    for (const t of ["string[free, pop]", "string[free, append]"]) {
      const d = run(prog(t)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain("`@r.xs.pop()`");
      expect(d[0].message).toContain("sub-field sequence");
    }
  });
  test("twin: a removal on a whole cell still names `@xs`", () => {
    const d = run(`<program>\n <xs:string[free, append]=([])/>\n function f() { @xs.pop() }\n <main><p>x</p></main>\n</program>\n`).diags;
    expect(d.map((x) => x.code)).toEqual(["E-WRITE-NOT-GRANTED"]);
    expect(d[0].message).toContain("`@xs.pop()`");
  });
});
