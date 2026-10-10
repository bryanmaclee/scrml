// is-some-s462.test.js — the soft-deprecated `is some` (SPEC §42.2.2a, §63.1 Stage 1), ruled S462
// "a, validator too, go" (docs/changes/s462-is-some-deprecate/). Provenance:
// ../../../../scrml-support/user-voice-scrml.md §S462.
// `x is some` is the same-meaning spelling of `x is given`: it parses IDENTICALLY (the same presence
// test, the same narrowing) and surfaces W-IS-SOME-DEPRECATED (Info) once per site. §63.5: an
// implementation that REJECTS the deprecated spelling is a conformance bug, not a stricter language.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd } from "./lowered.js";
import { expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const prog = (decls, markup = "<p>x</p>") => `<program>\n${decls}\n    <main>${markup}</main>\n</program>\n`;
const run = (src) => frontEnd(mods, [{ path: "app.scrml", src }]);
const O = "    type O:struct = { let v: string | not, let n: int | not }\n    let <o:O=({ v: \"\", n: 0 })/>\n    let <m:int=0/>\n    let <b:bool=false/>\n";

describe("S462 — `x is some` reads as `x is given` and surfaces W-IS-SOME-DEPRECATED", () => {
  test("one Info lint per `is some`; `is given` draws none", () => {
    const some = run(prog(O + "    function f() { if (@o.n is some && @o.v is some) { @m = @o.n + 1 } }"));
    const lints = some.diags.filter((d) => d.code === "W-IS-SOME-DEPRECATED");
    expect(lints.length).toBe(2);
    for (const d of lints) expect(d.severity).toBe("Info");
    expect(some.diags.filter((d) => d.code !== "W-IS-SOME-DEPRECATED")).toEqual([]);
    const given = run(prog(O + "    function f() { if (@o.n is given && @o.v is given) { @m = @o.n + 1 } }"));
    expect(given.diags).toEqual([]);
  });

  test("the same presence test: the narrowing and the recorded tests match `is given`", () => {
    const some = run(prog(O + "    function f() { if (@o.n is some) { @m = @o.n + 1 } }"));
    const given = run(prog(O + "    function f() { if (@o.n is given) { @m = @o.n + 1 } }"));
    expect(some.diags.map((d) => d.code)).toEqual(["W-IS-SOME-DEPRECATED"]);
    expect(given.diags).toEqual([]);
    expect(some.typed.tables.typing.presence.length).toBe(given.typed.tables.typing.presence.length);
  });

  test("the message names `is given`, `scrml fix` and §42.2.2a; the span covers `is some`", () => {
    const src = prog(O + "    function f() { @b = @o.v is some }");
    const r = run(src);
    const [d] = r.diags.filter((x) => x.code === "W-IS-SOME-DEPRECATED");
    expect(d.message).toContain("`x is given`");
    expect(d.message).toContain("scrml fix");
    expect(d.message).toContain("§42.2.2a");
    expect(src.slice(d.span.start, d.span.end)).toBe("is some");
  });
});
