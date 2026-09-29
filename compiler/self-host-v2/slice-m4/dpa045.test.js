// dpa045.test.js — dpa-045 (plain-markup text; AXIOM-LEVEL, RULED S442 "all
// PA recs") in the bootstrap parser:
//   D    free text has exactly two ways out: `${` and `<` + [a-zA-Z!/?]; `a < b`
//        is content; a stray `\` is content; whitespace is kept exactly; the
//        body's end is set by its delimiters alone.
//   B(1) an interpolation's extent is found by lexing its body and tracking
//        brace-TOKEN depth (lex.scrml lexFrom, the census's canonical walker) —
//        never by counting raw `{` / `}` bytes.
//   B(3) `\"` is DELETED from the code-default display-text literal: the `"`
//        ends the literal, and the parser reports E-PARSE-001.
// Census: docs/changes/s442-dpa045-bootstrap/census.md.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const P = (body, decls = "") => `<program>\n    type Ph:enum = { A, B }\n    <let n:int=5/>\n${decls}\n    <main>\n        ${body}\n        <b>end</b>\n    </main>\n</program>\n`;
const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
let k = 0;
async function html(src) {
  const r = run(src);
  expect(r.diags.map((d) => d.code)).toEqual([]);
  await loadProgram(r.core, "d45-" + k++);
  return document.querySelector("main").innerHTML;
}
const state = (idle) => P(`<p><*ph/></p>`, `    <ph:Ph=.A single>\n        <A rule=.B>${idle}</>\n        <B rule=.A : "B">\n    </>`);

describe("dpa-045 D — the free-text production (behaviour)", () => {
  test("`a < b` and `5 <7` are content (a `<` not followed by [a-zA-Z!/?] opens nothing)", async () => {
    expect(await html(P("<p>a < b and 5 <7</p>"))).toBe("<p>a &lt; b and 5 &lt;7</p><b>end</b>");
  });
  test("twin: `<` + a letter opens a tag", async () => {
    expect(await html(P("<p>x<b>y</b></p>"))).toBe("<p>x<b>y</b></p><b>end</b>");
  });
  test("a stray `\\` is content — no diagnostic on `\\d` / `\\n` / `\\x`", async () => {
    expect(await html(P("<p>C:\\dir\\x \\n</p>"))).toBe("<p>C:\\dir\\x \\n</p><b>end</b>");
  });
  test("whitespace inside a text run is kept exactly", async () => {
    expect(await html(P("<p>a    b\n   c</p>"))).toBe("<p>a    b\n   c</p><b>end</b>");
  });
});

describe("dpa-045 B(1) — an interpolation's extent is brace-TOKEN depth (behaviour)", () => {
  test("`${\"${\"}` — a `${` inside a nested string does not open anything", async () => {
    expect(await html(P('<p>a ${"${"} b</p>'))).toBe("<p>a ${ b</p><b>end</b>");
  });
  test("`${\"}\"}` — a `}` inside a nested string does not close the interpolation", async () => {
    expect(await html(P('<p>a ${"}"} b</p>'))).toBe("<p>a } b</p><b>end</b>");
  });
  test("`${ /* } */ @n }` — a `}` inside a comment does not close it", async () => {
    expect(await html(P("<p>a ${ /* } */ @n } b</p>"))).toBe("<p>a 5 b</p><b>end</b>");
  });
  test("a `}` inside a template literal does not close it (only the template's own expression diagnostics — no closer cascade)", () => {
    const codes = run(P("<p>a ${ `x${@n}}y` } b</p>")).diags.map((d) => d.code);
    expect(codes.some((c) => c === "E-PARSE-CLOSER" || c === "E-PARSE-UNCLOSED")).toBe(false);
  });
});

describe("dpa-045 B(3) — `\\\"` is not an escape in a display-text literal", () => {
  test("in a `:`-shorthand body: E-PARSE-001 first (the `\"` ends the literal)", () => {
    const d = run(P('<p : "a\\"b">')).diags;
    expect(d[0].code).toBe("E-PARSE-001");
    expect(d[0].message).toContain("ENDS the literal");
  });
  test("in a state-child code-default body: E-PARSE-001 first", () => {
    const d = run(state('"a\\"b"')).diags;
    expect(d[0].code).toBe("E-PARSE-001");
  });
  test("twin (behaviour): `\\\\` in a display-text literal still renders one backslash (B(2) is not ruled — the rest of the catalog is untouched)", async () => {
    expect(await html(P('<p : "a\\\\b">'))).toBe("<p>a\\b</p><b>end</b>");
  });
  test("twin: `\\\"` in a LOGIC string is still an escape (the deletion is the display-text literal's only)", async () => {
    expect(await html(P('<p>${"a\\"b"}</p>'))).toBe('<p>a"b</p><b>end</b>');
  });
  test("twin (behaviour): a state-child display-text literal renders without its quotes", async () => {
    expect(await html(state('"Ready"'))).toBe("<p>Ready<!--if--></p><b>end</b>");
  });
});
