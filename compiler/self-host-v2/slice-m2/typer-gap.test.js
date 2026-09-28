// typer-gap.test.js — the eleven shapes review F-A found compiling SILENTLY
// (slice-m2/progress.md "F-A (MED) — NOT YET CHECKED"), now decided by the M3
// typer / scope pass (analyze.scrml "THE TYPER", "THE SCOPE PASS").
//
// The M2 pins named a code per shape as a HYPOTHESIS. Each was resolved
// against compiler/SPEC.md before it was implemented (the governing-sentence
// gate, docs/changes/s439-bootstrap-m3-typer/progress.md). The outcome per
// shape is one of:
//   - the SPEC names the rule and the code — the test asserts that code;
//   - the SPEC names no rule — the bootstrap rejects with a bootstrap-local
//     `E-BOOTSTRAP-*` code (the reversible direction; the shape owes a ruling);
//   - the SPEC ACCEPTS the shape — the test asserts it stays silent, quoting
//     the sentence. The bootstrap never rejects what the SPEC accepts.
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
    files: () => [LIB(), app("    <let x:int=0/>\n    function f() { @x = \"oops\" }", "<p>x</p>")],
    twin: () => [LIB(), app("    <let x:int=0/>\n    function f() { @x = 5 }", "<p>x</p>")] },
  { name: "a call with the wrong arity (too few)",
    // SPEC-silent (searched §7.3, §7.3.2, §7.5.1, §48, §34): bootstrap-local, owes a ruling.
    want: ["E-BOOTSTRAP-CALL-ARITY"],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g() }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1) }", "<p>x</p>")] },
  { name: "a call with the wrong arity (too many)",
    want: ["E-BOOTSTRAP-CALL-ARITY"],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1, 2) }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int, b: int) { }\n    function f() { g(1, 2) }", "<p>x</p>")] },
  { name: "a call with a wrong argument type — STAYS SILENT",
    // §7.5.1: "Positions 3-5 are NOT YET CHECKED. A program that assigns a non-assignable value at those
    // positions SHALL compile." (position 3 = argument; "BLOCKED" on the S404 int-refinement landing).
    want: [],
    files: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(\"s\") }", "<p>x</p>")],
    twin: () => [LIB(), app("    function g(a: int) { }\n    function f() { g(1) }", "<p>x</p>")] },
  { name: "`<each in=@x>` over an int",
    // SPEC-silent (searched §17.7, §17.4, §59, §66.7.3/.4, the E-EACH-* rows): bootstrap-local, owes a ruling.
    want: ["E-BOOTSTRAP-EACH-NOT-SEQUENCE"],
    files: () => [LIB(), app("    <x=3/>", "<each in=@x as i><p>${i}</p></each>")],
    twin: () => [LIB(), app("    <xs:int[]=([1, 2, 3])/>", "<each in=@xs as i><p>${i}</p></each>")] },
  { name: "a non-bool `if=` — STAYS SILENT",
    // §17.1.1: "The TS pass performs type-checking over `IfChainExpr` directly, treating each condition
    // expression as `boolean`-coercible."; §17.1's own example `if=@errorMessage`; §49.2.3: "The compiler
    // applies the same boolean coercion rules as `if`. No special restriction applies to the type of the condition."
    want: [],
    files: () => [LIB(), app("    <x=3/>", "<p if=@x>x</p>")],
    twin: () => [LIB(), app("    <x=true/>", "<p if=@x>x</p>")] },
  { name: "a non-bool ternary condition — STAYS SILENT",
    // No sentence restricts a ternary test (§17.6.7, §45, §42 searched); the SPEC's condition rule is the
    // `if` boolean coercion above, so rejecting here would reject what `if` accepts. Owes an explicit ruling.
    want: [],
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
  { name: "a duplicate `<let x>`",
    // §7.3.3: "File-scope duplicates are E-SCOPE-010 (§7.6), not this code."; §7.6: "Re-declaring a name with
    // `let` … when that name was already declared at file scope SHALL be a compile error (E-SCOPE-010)";
    // §7.6.1: a file-level cell declaration takes part in file scope "identically to file-level `let`/`const`".
    want: ["E-SCOPE-010"],
    files: () => [LIB(), app("    <let x:int=0/>\n    <let x:int=1/>", "<p>x</p>")],
    twin: () => [LIB(), app("    <let x:int=0/>\n    <let y:int=1/>", "<p>x</p>")] },
  { name: "duplicate `as=` names",
    // SPEC-silent (searched §66.7.2, §66.7.4, §66.20, §7.3.3, §7.6): bootstrap-local, owes a ruling.
    want: ["E-BOOTSTRAP-REDECLARE"],
    files: () => [LIB(), app("", "<dropdown as=a label=\"1\" options=([\"a\"])/>\n<dropdown as=a label=\"2\" options=([\"a\"])/>")],
    twin: () => [LIB(), app("", "<dropdown as=a label=\"1\" options=([\"a\"])/>\n<dropdown as=b label=\"2\" options=([\"a\"])/>")] },
  { name: "duplicate function names",
    // §7.3.3 (a function-BODY block rule): "Two `function` declarations of one name in one block are outside this
    // rule." / "File-scope duplicates are E-SCOPE-010 (§7.6), not this code." §7.6 itself names only `let`, and
    // §19.16.6 says "§7.3.3 deliberately does not reject duplicate `function` declarations in general" — the
    // code follows §7.3.3's routing bullet; the shape owes a ruling.
    want: ["E-SCOPE-010"],
    files: () => [LIB(), app("    function f() { }\n    function f() { }", "<p>x</p>")],
    twin: () => [LIB(), app("    function f() { }\n    function g() { }", "<p>x</p>")] },
  { name: "a handle named like a cell",
    // SPEC-silent (searched §66.7.2 — a handle lives in the `@` namespace; §6.1 / §7.6.1 E-NAME-COLLIDES-STATE is
    // local-vs-cell only; §66.20): bootstrap-local, owes a ruling.
    want: ["E-BOOTSTRAP-REDECLARE"],
    files: () => [LIB(), app("    <let country:string=\"\"/>", "<dropdown as=country label=\"1\" options=([\"a\"])/>")],
    twin: () => [LIB(), app("    <let countryName:string=\"\"/>", "<dropdown as=country label=\"1\" options=([\"a\"])/>")] },
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
