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
  test("B(2) RULED delete (follow-up): `\\\\` is no longer an escape — both backslashes are content", async () => {
    expect(await html(P('<p : "a\\\\b">'))).toBe("<p>a\\\\b</p><b>end</b>");
  });
  test("twin: `\\\"` in a LOGIC string is still an escape (the deletion is the display-text literal's only)", async () => {
    expect(await html(P('<p>${"a\\"b"}</p>'))).toBe('<p>a"b</p><b>end</b>');
  });
  test("twin (behaviour): a state-child display-text literal renders without its quotes", async () => {
    expect(await html(state('"Ready"'))).toBe("<p>Ready<!--if--></p><b>end</b>");
  });
});

// ---------------------------------------------------------------------------
// dpa-045 follow-ups (RULED S442): the full closed exit set; cooked; the whole
// display-text escape catalog deleted; whitespace-only text kept.
// ---------------------------------------------------------------------------
describe("follow-up 1 — the closed exit set of free text", () => {
  test("`^{` / `!{` / `~{` are exits (context sigils; `~{` per SPEC §4.18.1b): skipped whole and reported, never text", () => {
    for (const sig of ["^", "!", "~"]) {
      const d = run(P(`<p>a ${sig}{ x = "</p> }" } b</p>`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain(sig + "{");
    }
  });
  test("twin (behaviour): `?{` is NOT an exit — its §3.1 parent is Logic only, so in free text it is content", async () => {
    expect(await html(P("<p>a ?{ x } b</p>"))).toBe("<p>a ?{ x } b</p><b>end</b>");
  });
  test("`_{` / `_={` in a markup body is neither exit nor content: E-FOREIGN-004 (§23.2.4), opaque to its level closer", () => {
    expect(run(P("<p>a _={ } </p> }= b</p>")).diags.map((x) => x.code)).toEqual(["E-FOREIGN-004"]);
    expect(run(P("<p>a _{ { } </p> } b</p>")).diags.map((x) => x.code)).toEqual(["E-FOREIGN-004"]);
    expect(run(P("<p>a _=={ }= }== b</p>")).diags.map((x) => x.code)).toEqual(["E-FOREIGN-004"]);
  });
  test("an unclosed `_={` is E-FOREIGN-002 (§23.2)", () => {
    expect(run(P("<p>a _={ b</p>")).diags.map((x) => x.code)).toContain("E-FOREIGN-002");
  });
  test("twin (behaviour): the E-FOREIGN-004 block renders nothing — the text around it is kept", () => {
    const r = run(P("<p>a _={ x }= b</p>"));
    const texts = [];
    (function walk(x) { if (Array.isArray(x)) { x.forEach(walk); return; } if (!x || typeof x !== "object") return; if (x.k && x.k.variant === "Text") texts.push(x.k.data.text); Object.values(x).forEach(walk); })(r.asts);
    expect(texts).toContain("a ");
    expect(texts).toContain(" b");
    expect(texts.some((t) => t.includes("x"))).toBe(false);
  });
  test("twin (behaviour): `_` ending an identifier is not an opener — `my_{c}` is content", async () => {
    expect(await html(P("<p>my_{c} x</p>"))).toBe("<p>my_{c} x</p><b>end</b>");
  });
  test("twin (behaviour): a lone `^` / `!` / `?` (no `{`) is content", async () => {
    expect(await html(P("<p>a ^ b ! c ? d</p>"))).toBe("<p>a ^ b ! c ? d</p><b>end</b>");
  });
  test("`<_` and `<.` open tags (scrml's own tag forms) — the bootstrap has no `<match>`, so the arm is not built", () => {
    expect(run(P("<p>x <_ y</p>")).diags.length).toBeGreaterThan(0);
    expect(run(P("<p>x <.A y</p>")).diags.length).toBeGreaterThan(0);
  });
  test("the spaced `< tag>` opener is content (behaviour)", async () => {
    expect(await html(P("<p>x < b>y</p>"))).toBe("<p>x &lt; b&gt;y</p><b>end</b>");
  });
});

describe("follow-up 2 — cooked: the node handed on has its delimiters removed", () => {
  test("a display-text literal's value carries no quotes; free text is its bytes", () => {
    const r = run(state('"Ready"'));
    const strs = [];
    (function walk(x) { if (Array.isArray(x)) { x.forEach(walk); return; } if (!x || typeof x !== "object") return; if (x.k && x.k.variant === "Str") strs.push(x.k.data.v); Object.values(x).forEach(walk); })(r.asts);
    expect(strs).toContain("Ready");
    expect(strs.some((v) => v.includes('"'))).toBe(false);
  });
});

describe("follow-up 3 — a display-text literal has no character escapes; `${…}` inside it interpolates (§4.18.4)", () => {
  test("behaviour: `:`-shorthand `\"Count ${@n} items\"` renders the interpolation", async () => {
    expect(await html(P('<p : "Count ${@n} items">'))).toBe("<p>Count 5 items</p><b>end</b>");
  });
  test("behaviour: a `\"` inside the interpolation does not end the literal", async () => {
    expect(await html(P('<p : "x ${ @n == 5 ? "five" : "no" } y">'))).toBe("<p>x five y</p><b>end</b>");
  });
  test("behaviour: a state-child body `\"Loaded ${@n} rows\"`", async () => {
    expect(await html(state('"Loaded ${@n} rows"'))).toBe("<p>Loaded 5 rows<!--if--></p><b>end</b>");
  });
  test("behaviour: `\\${` is no longer an escape — the backslash is content and `${` still interpolates", async () => {
    expect(await html(P('<p : "a \\${@n} b">'))).toBe("<p>a \\5 b</p><b>end</b>");
  });
  test("an interpolating display-text literal nested in a larger expression is reported, not rendered raw", () => {
    expect(run(P('<p : @n == 5 ? "a ${@n}" : "b">')).diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});
