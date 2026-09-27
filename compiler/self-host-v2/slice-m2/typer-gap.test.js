// typer-gap.test.js — NOT YET CHECKED (review F-A): analyze has no value-type
// checker and no redeclaration check. Each shape below compiles SILENTLY today
// and would run wrong. Two tests per shape keep the gap visible in the suite:
//   - "today: silent" pins the CURRENT behaviour (no diagnostic) — it breaks,
//     on purpose, the day the typer lands, so this file must be updated then;
//   - `test.failing` states the REQUIRED behaviour (an E-TYPE-* /
//     E-SCOPE-REDECLARE diagnostic) and passes only while it is not met.
// The typer is M3's FIRST item (slice-m2/progress.md "NOT YET CHECKED").

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2 } from "./harness.js";
import { frontEnd, readSlice } from "./lowered.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const LIB = () => ({ path: "lib/dropdown.scrml", src: readSlice("src/lib/dropdown.scrml") });
const app = (decls, markup) => ({
  path: "app.scrml",
  src: `\${ import { dropdown, Openness } from "./lib/dropdown.scrml" }\n<program>\n${decls}\n    <main>\n${markup}\n    </main>\n</program>\n`,
});
const codes = (files) => frontEnd(mods, files).diags.map((d) => d.code);

const SHAPES = [
  { name: "`@x = \"oops\"` into an `int` cell", want: "E-TYPE-",
    files: () => [LIB(), app("    <let x:int=0/>\n    function f() { @x = \"oops\" }", "<p>x</p>")] },
  { name: "a call with the wrong arity", want: "E-TYPE-",
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g() }", "<p>x</p>")] },
  { name: "a call with a wrong argument type", want: "E-TYPE-",
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(\"s\") }", "<p>x</p>")] },
  { name: "`<each in=@x>` over an int", want: "E-TYPE-",
    files: () => [LIB(), app("    <x=3/>", "<each in=@x as i><p>${i}</p></each>")] },
  { name: "a non-bool `if=`", want: "E-TYPE-",
    files: () => [LIB(), app("    <x=3/>", "<p if=@x>x</p>")] },
  { name: "a non-bool ternary condition", want: "E-TYPE-",
    files: () => [LIB(), app("    <x=3/>", "<p>${@x ? \"a\" : \"b\"}</p>")] },
  { name: "`label=(5)` for a `string` attribute", want: "E-TYPE-",
    files: () => [LIB(), app("", "<dropdown label=(5) options=([\"a\"])/>")] },
  { name: "a duplicate `<let x>`", want: "E-SCOPE-REDECLARE",
    files: () => [LIB(), app("    <let x:int=0/>\n    <let x:int=1/>", "<p>x</p>")] },
  { name: "duplicate `as=` names", want: "E-SCOPE-REDECLARE",
    files: () => [LIB(), app("", "<dropdown as=a label=\"1\" options=([\"a\"])/>\n<dropdown as=a label=\"2\" options=([\"a\"])/>")] },
  { name: "duplicate function names", want: "E-SCOPE-REDECLARE",
    files: () => [LIB(), app("    function f() { }\n    function f() { }", "<p>x</p>")] },
  { name: "a handle named like a cell", want: "E-SCOPE-REDECLARE",
    files: () => [LIB(), app("    <let country:string=\"\"/>", "<dropdown as=country label=\"1\" options=([\"a\"])/>")] },
];

describe("NOT YET CHECKED — value types, arity, redeclaration (M3 item 1)", () => {
  for (const s of SHAPES) {
    test(`today: silent — ${s.name}`, () => {
      expect(codes(s.files())).toEqual([]);
    });
    test.failing(`required: ${s.want}… — ${s.name}`, () => {
      expect(codes(s.files()).some((c) => c.startsWith(s.want))).toBe(true);
    });
  }
});
