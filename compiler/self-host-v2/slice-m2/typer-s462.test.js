// typer-s462.test.js — a write ends the narrowing (SPEC §42.3.5), ruled S462 "b"
// (docs/changes/s462-narrowing-ends-on-write/). Provenance: ../../../../scrml-support/user-voice-scrml.md
// §S462: "A write to the narrowed place — direct, in a nested block, or by a call that writes it or whose
// write set cannot be determined — ends the narrowing from that point; a later member access through it is
// E-TYPE-046."
//
// The bootstrap already ended a narrowing on a direct write, a nested write and a callee that writes the
// place (typer-s440.test.js r2 F1a / F1b, r3 N1 / N3). S462 adds the fourth limb — a call whose write set
// cannot be determined ends every CELL narrowing (`callKeys` answers UNKNOWN, "*"). In the current slice
// no source reaches that limb: function values, function-typed parameters and braced arrows are refused.
// So the limb is pinned at the function itself, and the source-level tests pin that the existing limbs are
// unchanged by it.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice } from "./lowered.js";
import { expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });
const app = (decls, markup) => ({
  path: "app.scrml",
  src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }\n<program>\n${decls}\n    <main>\n${markup}\n    </main>\n</program>\n`,
});
const inApp = (decls, markup = "<p>x</p>") => frontEnd(mods, [LIB(), app(decls, markup)]).diags.map((d) => d.code);
const O = "    type O:struct = { let v: string | not, let n: int | not, let f: bool | not }\n    let <o:O=({ v: \"\", n: 0, f: false })/>\n    let <m:int=0/>\n";

describe("S462 — the unresolvable-call limb (`callKeys`)", () => {
  const ws = [
    { name: "clear", keys: ["@o"], params: [] },
    { name: "bump", keys: ["@m"], params: [] },
  ];
  test("a call of a function of the program: its write set", () => {
    expect([...mods.analyze.callKeys(ws, "clear")]).toEqual(["@o"]);
    expect([...mods.analyze.callKeys(ws, "bump")]).toEqual(["@m"]);
  });
  test("a call of a name that is no function of the program: UNKNOWN — ends every cell narrowing", () => {
    expect([...mods.analyze.callKeys(ws, "cb")]).toEqual(["*"]);
  });
});

describe("S462 — the known-write limbs are unchanged", () => {
  const CLEAR = "    function clear() { @o = { v: not, n: not, f: not } }\n";
  test("a callee that writes the place ends the narrowing", () => {
    expect(inApp(O + CLEAR + "    function f() { if (@o.n != not) { clear()\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a callee that writes other places keeps it", () => {
    expect(inApp(O + "    function h() { @m = 2 }\n    function f() { if (@o.n != not) { h()\n @m = @o.n + 1 } }")).toEqual([]);
  });
  test("a host call (`Date.now()`) keeps it", () => {
    expect(inApp(O + "    function f() { if (@o.n != not) { const t = Date.now()\n @m = @o.n + 1 } }")).toEqual([]);
  });
});
