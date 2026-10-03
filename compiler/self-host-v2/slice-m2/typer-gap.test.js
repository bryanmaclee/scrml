// typer-gap.test.js — the eleven shapes review F-A found compiling SILENTLY
// (slice-m2/progress.md "F-A (MED) — NOT YET CHECKED"), now decided by the M3
// typer / scope pass (analyze.scrml "THE TYPER", "THE SCOPE PASS").
//
// The M2 pins named a code per shape as a HYPOTHESIS. Each was resolved
// against compiler/SPEC.md before it was implemented (the governing-sentence
// gate, docs/changes/s439-bootstrap-m3-typer/progress.md), and S440 then RULED
// the shapes that SPEC left open (docs/changes/s442-bootstrap-typer-rules/):
// every shape below now asserts a code the ruling / SPEC names — E-CALL-ARITY
// (§7.3), E-EACH-NOT-SEQUENCE (§17.7.2), E-HANDLE-REDECLARE (§66.7.2),
// E-SCOPE-010 for `function` (§7.6), E-COND-NOT-BOOLEAN for a non-bool
// condition (S440 #4 = (c)). The earlier "the SPEC names no rule" /
// "STAYS SILENT" outcomes are superseded by those rulings.
// Every shape carries a well-typed TWIN that must stay silent: a checker that
// fires on everything would pass the negative tests, the twins would not.

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

// `want`: the exact diagnostic list ([] = the SPEC accepts it). `twin`: the
// well-typed neighbour, which must produce no diagnostic.
const SHAPES = [
  { name: "`@x = \"oops\"` into an `int` cell",
    // §66.1 rule 5: "Every cell and field write SHALL be type-checked against the target's declared type";
    // the §34 row E-TYPE-031: "a value is assigned to a position whose declared type it does not satisfy".
    want: ["E-TYPE-031"],
    files: () => [LIB(), app("    let <x:int=0/>\n    function f() { @x = \"oops\" }", "<p>x</p>")],
    twin: () => [LIB(), app("    let <x:int=0/>\n    function f() { @x = 5 }", "<p>x</p>")] },
  { name: "a call with the wrong arity (too few)",
    // RULED S440 #2; §7.3: "A call that passes FEWER is a compile error too, unless each omitted parameter
    // has a default (§7.3.2)." (§34 row E-CALL-ARITY.)
    want: ["E-CALL-ARITY"],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g() }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1) }", "<p>x</p>")] },
  { name: "a call with the wrong arity (too many)",
    // §7.3: "A call that passes MORE arguments than the function declares parameters is a compile error".
    want: ["E-CALL-ARITY"],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1, 2) }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int, b: int) { }\n    function f() { g(1, 2) }", "<p>x</p>")] },
  { name: "a call with a wrong argument type into an `int` parameter",
    // RULED S442: "`int` enforcement reaches every §7.5.1 position (returns, arguments, all initializers)" —
    // supersedes, for `int`-bearing parameters, §7.5.1's "Positions 3-5 are NOT YET CHECKED" (other types: still unchecked).
    want: ["E-TYPE-031"],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(\"s\") }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1) }", "<p>x</p>")] },
  { name: "`<each in=@x>` over an int",
    // RULED S440 #3; §17.7.2: "`<each in=expr>` over a value that is not a sequence is a compile error,
    // `E-EACH-NOT-SEQUENCE` (§34)."
    want: ["E-EACH-NOT-SEQUENCE"],
    files: () => [LIB(), app("    <x=3/>", "<each in=@x as i><p>${i}</p></each>")],
    twin: () => [LIB(), app("    <xs:int[]=([1, 2, 3])/>", "<each in=@xs as i><p>${i}</p></each>")] },
  { name: "a non-bool `if=`",
    // RULED S440 #4 = (c): "All conditions require a boolean, or a `T | not` presence test, and the truthiness
    // of numbers and strings goes." Q2: "an immediate error wherever the violation is PROVABLE". Supersedes the
    // S439 "boolean-coercible" reading of §17.1.1 / §49.2.3. Code PROPOSED (no SPEC text yet): E-COND-NOT-BOOLEAN.
    want: ["E-COND-NOT-BOOLEAN"],
    files: () => [LIB(), app("    <x=3/>", "<p if=@x>x</p>")],
    twin: () => [LIB(), app("    <x=true/>", "<p if=@x>x</p>")] },
  { name: "a non-bool ternary condition",
    // RULED S440 #4 = (c) — "it touches every `if=`, `if`, `while` and ternary".
    want: ["E-COND-NOT-BOOLEAN"],
    files: () => [LIB(), app("    <x=3/>", "<p>${@x ? \"a\" : \"b\"}</p>")],
    twin: () => [LIB(), app("    <x=3/>", "<p>${@x > 0 ? \"a\" : \"b\"}</p>")] },
  { name: "`label=(5)` for a `string` attribute",
    // §66.9 rule 8: "A use-site attribute is that field's INITIALIZER FOR THAT INSTANCE"; §7.5.1: "The compiler
    // SHALL emit `E-TYPE-031` at … position 2 — a state-cell declaration — carrying an unpredicated primitive
    // annotation (`number`, `string`, `boolean`) whose initializer is a syntactically-determined literal of a
    // different primitive type."
    want: ["E-TYPE-031"],
    files: () => [LIB(), app("", "<dropdown label=(5) options=([\"a\"])/>")],
    twin: () => [LIB(), app("", "<dropdown label=(\"5\") options=([\"a\"])/>")] },
  { name: "a duplicate `let <x>`",
    // §7.3.3: "File-scope duplicates are E-SCOPE-010 (§7.6), not this code."; §7.6: "Re-declaring a name with
    // `let` … when that name was already declared at file scope SHALL be a compile error (E-SCOPE-010)";
    // §7.6.1: a file-level cell declaration takes part in file scope "identically to file-level `let`/`const`".
    want: ["E-SCOPE-010"],
    files: () => [LIB(), app("    let <x:int=0/>\n    let <x:int=1/>", "<p>x</p>")],
    twin: () => [LIB(), app("    let <x:int=0/>\n    let <y:int=1/>", "<p>x</p>")] },
  { name: "duplicate `as=` names",
    // RULED S440 #5 (i); §66.7.2: "two `as=` handles of the same name in one scope" is `E-HANDLE-REDECLARE`.
    want: ["E-HANDLE-REDECLARE"],
    files: () => [LIB(), app("", "<dropdown as=a label=\"1\" options=([\"a\"])/>\n<dropdown as=a label=\"2\" options=([\"a\"])/>")],
    twin: () => [LIB(), app("", "<dropdown as=a label=\"1\" options=([\"a\"])/>\n<dropdown as=b label=\"2\" options=([\"a\"])/>")] },
  { name: "duplicate function names",
    // RULED S440 #6; §7.6: "Two top-level `function` declarations of one name SHALL be a compile error
    // (E-SCOPE-010: duplicate binding in file scope)".
    want: ["E-SCOPE-010"],
    files: () => [LIB(), app("    function f() { }\n    function f() { }", "<p>x</p>")],
    twin: () => [LIB(), app("    function f() { }\n    function g() { }", "<p>x</p>")] },
  { name: "a handle named like a cell",
    // RULED S440 #5 (ii); §66.7.2: "an `as=` handle named like a cell" is `E-HANDLE-REDECLARE`.
    want: ["E-HANDLE-REDECLARE"],
    files: () => [LIB(), app("    let <country:string=\"\"/>", "<dropdown as=country label=\"1\" options=([\"a\"])/>")],
    twin: () => [LIB(), app("    let <countryName:string=\"\"/>", "<dropdown as=country label=\"1\" options=([\"a\"])/>")] },
];

describe("F-A — value types, arity, redeclaration (M3 item 1), each resolved against the SPEC", () => {
  for (const s of SHAPES) {
    test(`${s.want.length === 0 ? "legal" : s.want.join(", ")} — ${s.name}`, () => {
      expect(codes(s.files())).toEqual(s.want);
    });
    test(`well-typed twin stays silent — ${s.name}`, () => {
      expect(codes(s.twin())).toEqual([]);
    });
  }
});
