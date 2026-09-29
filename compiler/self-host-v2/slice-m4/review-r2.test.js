// review-r2.test.js — s442 fix round r2 (re-review of 2bd817a9): one test per
// item, each failing on the reviewed behaviour. See progress.md "FIX ROUND r2".

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { auditFixture } from "./fixtures.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const rows = () => [...document.querySelectorAll("main > ul > li")].map((li) => li.textContent);

describe("item 1 — O19 on a CHILD field (own value AND attributes) is refused, not dropped", () => {
  const box = (child) => `<program>\n <box a:int=1>\n${child}\n </>\n renders <p>\${a}|\${c}</p>\n <main><box/></main>\n</program>\n`;
  test("void child `<c:int=0 s:int=7/>` → E-BOOTSTRAP-UNSUPPORTED naming O19", () => {
    const d = run(box(" <c:int=0 s:int=7/>")).diags;
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("O19");
  });
  test("bodied child `<c:int=0 s:int=7></>` → the same", () => {
    expect(codes(box(" <c:int=0 s:int=7>\n </>"))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
  test("a grandchild, too", () => {
    // (`g:struct` itself may carry its own diagnostic; the grandchild's O19 refusal must be among them)
    const d = run(box(" <c:int=0/>\n <g:struct>\n  <h:int=0 t:int=1/>\n </>")).diags;
    expect(d.some((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("`<h>`") && x.message.includes("O19"))).toBe(true);
  });
  test("twin: a child with an own value and NO attributes is fine", async () => {
    const r = run(box(" <c:int=0/>"));
    expect(r.diags).toEqual([]);
    await loadProgram(r.core, "r2-o19-twin");
    expect(document.querySelector("main > p").textContent).toBe("1|0");
  });
});

const seq = (t, b) => `<program>\n <xs:${t}=([])/>\n function f() { ${b} }\n <main><p>x</p></main>\n</program>\n`;

describe("item 2 — shrinking a FIXED-length sequence is E-WRITE-INVARIANT (F7's mirror)", () => {
  test("pop / shift / filter on a type without `free` → E-WRITE-INVARIANT", () => {
    expect(codes(seq("string[pop]", "@xs.pop()"))).toEqual(["E-WRITE-INVARIANT"]);
    expect(codes(seq("string[shift]", "@xs.shift()"))).toEqual(["E-WRITE-INVARIANT"]);
    expect(codes(seq("string[remove]", "@xs = @xs.filter(x => true)"))).toEqual(["E-WRITE-INVARIANT"]);
  });
  test("twin: with `free` they are granted (not lowered: Core has no removal edit)", () => {
    expect(codes(seq("string[free, pop]", "@xs.pop()"))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

describe("item 3 — a duplicate grant token is refused (E-GRANT-UNKNOWN)", () => {
  test("`[free, append, append]` → E-GRANT-UNKNOWN naming the token", () => {
    const d = run(seq("string[free, append, append]", `@xs.push("a")`)).diags;
    expect(d.map((x) => x.code)).toEqual(["E-GRANT-UNKNOWN"]);
    expect(d[0].message).toContain("`append` is granted twice");
  });
  test("twin: `[free, append]` is fine", () => {
    expect(codes(seq("string[free, append]", `@xs.push("a")`))).toEqual([]);
  });
});

describe("item 4 — a sequence spread reads ONE snapshot (RULED S442)", () => {
  let program;
  beforeAll(async () => {
    let src = auditFixture().replace("<li>${e.actor}: ${e.action}</li>", "<li>${e.actor}: ${e.action} @${e.at}</li>");
    src = src.replace("function record(action: string) {", `function mk2() -> Entry {
        @audit.push({ at: 99, actor: "in", action: "inner" })
        const e: Entry = { at: 0, actor: "out", action: "outer" }
        return e
    }
    function snap() { @audit = [...@audit, mk2(), { at: @audit.length, actor: "q", action: "after" }] }
    function snapPre() { @audit = [{ at: @audit.length, actor: "p", action: "pre" }, ...@audit] }
    function record(action: string) {`).replace("<audit:Entry[free, append]=[]/>", "<audit:Entry[free, append, prepend]=[]/>");
    const r = run(src);
    expect(r.diags).toEqual([]);
    ({ program } = await loadProgram(r.core, "r2-snap", ["record", "snap", "snapPre"]));
  });
  test("`@audit.length` inside the literal reads the value from BEFORE the statement, though mk2() pushed", () => {
    program.record("a");
    program.record("b");
    program.snap();
    // mk2's inner push is its own edit (it survives, as a struct spread keeps a
    // write to a field it does not override); the literal's `@audit.length`
    // is the snapshot's 2 — not the live 3
    expect(rows()).toEqual(["ops: a @0", "ops: b @0", "in: inner @99", "out: outer @0", "q: after @2"]);
  });
  test("a front shape reads the snapshot too", () => {
    program.snapPre();
    expect(rows()[0]).toBe("p: pre @5");
  });
});
