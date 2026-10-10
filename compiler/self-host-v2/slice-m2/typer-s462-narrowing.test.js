// typer-s462-narrowing.test.js — a write ends the narrowing (SPEC §42.3.5), ruled S462 "b"
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

// S462 Q11 / Q12 ("a", user-voice §S462). The fixture's `?{}` has no database scope (E-SQL-004,
// beside the point here), so only the narrowing code is asserted.
const SQ = "?" + "{";
const WC = "    function wc(id: string) -> int {\n        const row = " + SQ + "`SELECT body FROM notes WHERE id = ${id}`}.get() !{ _ :> not }\n        return 0\n    }\n";
const narrowing = (decls, markup) => inApp(decls, markup).filter((c) => c === "E-OPERAND-NOT-NARROWED");

describe("S462 Q11 — a server call (a suspension point) ends every cell narrowing", () => {
  test("a call of a server function (its own `?{}` places it on the server)", () => {
    expect(narrowing(O + WC + "    function f() { if (@o.n != not) { @m = wc(\"n1\") !{ .Transport(t) :> 0 }\n @m = @o.n + 1 } }")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a re-test after it narrows again", () => {
    expect(narrowing(O + WC + "    function f() { if (@o.n != not) { @m = wc(\"n1\") !{ .Transport(t) :> 0 }\n if (@o.n != not) { @m = @o.n + 1 } } }")).toEqual([]);
  });
});

describe("S462 Q12 — an event handler re-tests reactive cells", () => {
  test("a handler OUTSIDE the `if=` gate does not inherit the cell narrowing", () => {
    expect(narrowing(O, "<p if=(@o.n != not)>x</p><button onclick={ @m = @o.n + 1 }>b</button>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("`show=` does not gate a handler (it hides, it does not remove)", () => {
    expect(narrowing(O, "<p show=(@o.n != not)><button onclick={ @m = @o.n + 1 }>b</button></p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a re-test inside the handler narrows; the element's children keep the narrowing", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><button onclick={ if (@o.n != not) { @m = @o.n + 1 } }>b</button></p>")).toEqual([]);
    expect(narrowing(O, "<p if=(@o.n != not)>${@o.n + 1}</p>")).toEqual([]);
  });
});

// S462 Q18 ("a", user-voice §S462): a handler inside an `if=` / `else-if=` gate KEEPS the gate's
// narrowing — render-gating removes the subtree and its listener synchronously on the write that ends
// the condition. Other places, `show=`, handlers outside the gate stay as Q12; a write inside still ends.
describe("S462 Q18 — a handler inside an `if=` gate keeps that gate's narrowing", () => {
  test("a handler under `if=` keeps the gated place", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><button onclick={ @m = @o.n + 1 }>b</button></p>")).toEqual([]);
  });
  test("a descendant of the gated element", () => {
    expect(narrowing(O, "<div if=(@o.n != not)><section><button onclick={ @m = @o.n + 1 }>b</button></section></div>")).toEqual([]);
  });
  test("a different place stays un-narrowed in the handler", () => {
    expect(narrowing(O, "<p if=(@o.f != not)><button onclick={ @m = @o.n + 1 }>b</button></p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("a write inside the handler still ends it", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><button onclick={ @o = { v: not, n: not, f: not }\n @m = @o.n + 1 }>b</button></p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
});

// S462 round 6 (F6-2): a focus-family handler (`blur` / `focusout` / `focus` / `focusin`) keeps no gate
// narrowing — the browser fires `blur` / `focusout` while the gated subtree is being removed.
describe("S462 round 6 — focus-family handlers are not exempt", () => {
  test("onblur under `if=` re-tests", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><input onblur={ @m = @o.n + 1 }/></p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("onfocusout under `if=` re-tests", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><input onfocusout={ @m = @o.n + 1 }/></p>")).toEqual(["E-OPERAND-NOT-NARROWED"]);
  });
  test("oninput under `if=` keeps it", () => {
    expect(narrowing(O, "<p if=(@o.n != not)><input oninput={ @m = @o.n + 1 }/></p>")).toEqual([]);
  });
});
