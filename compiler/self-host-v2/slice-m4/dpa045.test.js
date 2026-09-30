// dpa045.test.js — dpa-045 (plain-markup text; AXIOM-LEVEL, RULED S442 "all
// PA recs") in the bootstrap parser:
//   D    free text has exactly two ways out: `${` and `<` + [a-zA-Z!/?]; `a < b`
//        is content; a stray `\` is content; whitespace is kept exactly; the
//        body's end is set by its delimiters alone.
//   B(1) an interpolation's extent is found by lexing its body and tracking
//        brace-TOKEN depth (lex.scrml lexFrom, the census's canonical walker) —
//        never by counting raw `{` / `}` bytes.
//   B(3) `\"` is DELETED from the code-default display-text literal: the `\` is
//        content and the `"` ends the literal — no diagnostic (SPEC §4.18.3:
//        "E-PARSE-001 no longer fires on `\x` here"; s444 r2 fix 1).
// Census: docs/changes/s442-dpa045-bootstrap/census.md.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const P = (body, decls = "") => `<program>\n    type Ph:enum = { A, B }\n    <let n:int=5/>\n${decls}\n    <main>\n        ${body}\n        <b>end</b>\n    </main>\n</program>\n`;
// dpa-045 follow-up 4 (RULED S442, SPEC §4.18.5): the whitespace between
// `<main>`'s children is kept exactly — W wraps the expected body in it.
const W = (inner) => `\n        ${inner}\n        <b>end</b>\n    `;
const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
let k = 0;
async function html(src) {
  const r = run(src);
  expect(r.diags.map((d) => d.code)).toEqual([]);
  await loadProgram(r.core, "d45-" + k++);
  return document.querySelector("main").innerHTML;
}
// Every Text node's text in the parsed ASTs, in order.
function texts(r) {
  const out = [];
  (function walk(x) { if (Array.isArray(x)) { x.forEach(walk); return; } if (!x || typeof x !== "object") return; if (x.k && x.k.variant === "Text") out.push(x.k.data.text); Object.values(x).forEach(walk); })(r.asts);
  return out;
}
const state = (idle) => P(`<p><*ph/></p>`, `    <ph:Ph=.A single>\n        <A rule=.B>${idle}</>\n        <B rule=.A : "B">\n    </>`);

describe("dpa-045 D — the free-text production (behaviour)", () => {
  test("`a < b` and `5 <7` are content (a `<` not followed by [a-zA-Z!/?] opens nothing)", async () => {
    expect(await html(P("<p>a < b and 5 <7</p>"))).toBe(W("<p>a &lt; b and 5 &lt;7</p>"));
  });
  test("twin: `<` + a letter opens a tag", async () => {
    expect(await html(P("<p>x<b>y</b></p>"))).toBe(W("<p>x<b>y</b></p>"));
  });
  test("a stray `\\` is content — no diagnostic on `\\d` / `\\n` / `\\x`", async () => {
    expect(await html(P("<p>C:\\dir\\x \\n</p>"))).toBe(W("<p>C:\\dir\\x \\n</p>"));
  });
  test("whitespace inside a text run is kept exactly", async () => {
    expect(await html(P("<p>a    b\n   c</p>"))).toBe(W("<p>a    b\n   c</p>"));
  });
});

describe("dpa-045 B(1) — an interpolation's extent is brace-TOKEN depth (behaviour)", () => {
  test("`${\"${\"}` — a `${` inside a nested string does not open anything", async () => {
    expect(await html(P('<p>a ${"${"} b</p>'))).toBe(W("<p>a ${ b</p>"));
  });
  test("`${\"}\"}` — a `}` inside a nested string does not close the interpolation", async () => {
    expect(await html(P('<p>a ${"}"} b</p>'))).toBe(W("<p>a } b</p>"));
  });
  test("`${ /* } */ @n }` — a `}` inside a comment does not close it", async () => {
    expect(await html(P("<p>a ${ /* } */ @n } b</p>"))).toBe(W("<p>a 5 b</p>"));
  });
  test("a `}` inside a template literal does not close it (only the template's own expression diagnostics — no closer cascade)", () => {
    const codes = run(P("<p>a ${ `x${@n}}y` } b</p>")).diags.map((d) => d.code);
    expect(codes.some((c) => c === "E-PARSE-CLOSER" || c === "E-PARSE-UNCLOSED")).toBe(false);
  });
});

describe("dpa-045 B(3) — `\\\"` is not an escape in a display-text literal", () => {
  // s444 r2 fix 1 — SPEC §4.18.3 (Amendment S442): "A `\` inside a display-text
  // literal is an ordinary content character; there is no malformed-escape
  // error (`E-PARSE-001` no longer fires on `\x` here). Consequently `\"` is a
  // `\` followed by the closing `"`".
  test("behaviour: a `:`-shorthand `\"C:\\\"` renders `C:\\` — no diagnostic", async () => {
    expect(await html(P('<p : "C:\\">'))).toBe(W("<p>C:\\</p>"));
  });
  test("behaviour: a state-child body `\"C:\\\"` renders `C:\\` — no diagnostic", async () => {
    expect(await html(state('"C:\\"'))).toBe(W("<p>C:\\<!--if--></p>"));
  });
  test("`\"a\\\"b\"`: the `\"` after the `\\` closes the literal, so `b` is what is left over — and never E-PARSE-001", () => {
    const sh = run(P('<p : "a\\"b">')).diags.map((d) => d.code);
    expect(sh[0]).toBe("E-PARSE-TRAILING");
    expect(sh).not.toContain("E-PARSE-001");
    const st = run(state('"a\\"b"')).diags.map((d) => d.code);
    expect(st[0]).toBe("E-UNQUOTED-DISPLAY-TEXT");
    expect(st).not.toContain("E-PARSE-001");
  });
  test("twin (state body): `\\\\` is two backslashes", async () => {
    expect(await html(state('"a\\\\b"'))).toBe(W("<p>a\\\\b<!--if--></p>"));
  });
  test("twin (state body): `\\${@n}` is a `\\` then a live interpolation", async () => {
    expect(await html(state('"a \\${@n} b"'))).toBe(W("<p>a \\5 b<!--if--></p>"));
  });
  test("B(2) RULED delete (follow-up): `\\\\` is no longer an escape — both backslashes are content", async () => {
    expect(await html(P('<p : "a\\\\b">'))).toBe(W("<p>a\\\\b</p>"));
  });
  test("twin: `\\\"` in a LOGIC string is still an escape (the deletion is the display-text literal's only)", async () => {
    expect(await html(P('<p>${"a\\"b"}</p>'))).toBe(W('<p>a"b</p>'));
  });
  test("twin (behaviour): a state-child display-text literal renders without its quotes", async () => {
    expect(await html(state('"Ready"'))).toBe(W("<p>Ready<!--if--></p>"));
  });
});

// ---------------------------------------------------------------------------
// dpa-045 follow-ups (RULED S442): the full closed exit set; cooked; the whole
// display-text escape catalog deleted; whitespace-only text kept.
// ---------------------------------------------------------------------------
describe("follow-up 1 — the closed exit set of free text", () => {
  test("`^{` / `!{` / `~{` are exits (context sigils; `~{` per SPEC §4.18.1b): skipped whole and reported", () => {
    for (const sig of ["^", "!", "~"]) {
      const d = run(P(`<p>a ${sig}{ x = "</p> }" } b</p>`)).diags;
      expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(d[0].message).toContain(sig + "{");
    }
  });
  // s444 r2 fix 2 — SPEC §4.18.1b pin 3: "no byte inside the body may change
  // where the body ends". The block ends at its BALANCING `}` (the canonical
  // walker), not at the `}` inside the string: never text.
  test("`^{` / `!{` / `~{` extent: a `}` (and a `</p>`) inside a string does not end the block — the text around it is exactly `a ` and ` b`", () => {
    for (const sig of ["^", "!", "~"]) {
      const src = P(`<p>a ${sig}{ x = "</p> }" } b</p>`);
      const r = run(src);
      const open = src.indexOf(sig + "{");
      const close = src.indexOf("} b</p>") + 1;
      expect(r.diags[0].span.start).toBe(open);
      expect(r.diags[0].span.end).toBe(close);
      expect(texts(r).filter((t) => t.trim() !== "")).toEqual(["a ", " b", "end"]);
      expect(texts(r).some((t) => t.includes("}") || t.includes('"'))).toBe(false);
    }
  });
  test("`^{` / `!{` / `~{` extent: a nested `{ … }` balances too", () => {
    for (const sig of ["^", "!", "~"]) {
      const r = run(P(`<p>a ${sig}{ f({ k: "}" }) } b</p>`));
      expect(r.diags.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
      expect(texts(r).filter((t) => t.trim() !== "")).toEqual(["a ", " b", "end"]);
    }
  });
  test("twin (behaviour): `?{` is NOT an exit — its §3.1 parent is Logic only, so in free text it is content", async () => {
    expect(await html(P("<p>a ?{ x } b</p>"))).toBe(W("<p>a ?{ x } b</p>"));
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
    expect(await html(P("<p>my_{c} x</p>"))).toBe(W("<p>my_{c} x</p>"));
  });
  test("twin (behaviour): a lone `^` / `!` / `?` (no `{`) is content", async () => {
    expect(await html(P("<p>a ^ b ! c ? d</p>"))).toBe(W("<p>a ^ b ! c ? d</p>"));
  });
  // s444 r2 fix 3: `?` and `!` are in the tag-open class — `<?…` / `<!…` (other
  // than a `<!-- -->` comment) are markup-open attempts, never content.
  test("`<?` opens a tag attempt (not content) — reported at the `<`, and no text holds `<?`", () => {
    const src = P("<p>a <?x b?> c</p>");
    const r = run(src);
    expect(r.diags[0].code).toBe("E-PARSE-TAG");
    expect(r.diags[0].span.start).toBe(src.indexOf("<?"));
    expect(texts(r).some((t) => t.includes("<?") || t.includes("?x"))).toBe(false);
  });
  test("`<!` (not a comment) opens a tag attempt — `<!DOCTYPE html>` in a `<p>` is reported, never text", () => {
    const src = P("<p>a <!DOCTYPE html> b</p>");
    const r = run(src);
    expect(r.diags[0].code).toBe("E-PARSE-TAG");
    expect(r.diags[0].span.start).toBe(src.indexOf("<!"));
    expect(texts(r).some((t) => t.includes("DOCTYPE"))).toBe(false);
  });
  test("twin (behaviour): `<!-- -->` is a comment and `<` + a space / digit / `=` is content", async () => {
    expect(await html(P("<p>a <!-- c --> b < c <3 <= d</p>"))).toBe(W("<p>a  b &lt; c &lt;3 &lt;= d</p>"));
  });
  test("`<_` and `<.` open tags (scrml's own tag forms) — the bootstrap has no `<match>`, so the arm is not built", () => {
    expect(run(P("<p>x <_ y</p>")).diags.length).toBeGreaterThan(0);
    expect(run(P("<p>x <.A y</p>")).diags.length).toBeGreaterThan(0);
  });
  test("the spaced `< tag>` opener is content (behaviour)", async () => {
    expect(await html(P("<p>x < b>y</p>"))).toBe(W("<p>x &lt; b&gt;y</p>"));
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
    expect(await html(P('<p : "Count ${@n} items">'))).toBe(W("<p>Count 5 items</p>"));
  });
  test("behaviour: a `\"` inside the interpolation does not end the literal", async () => {
    expect(await html(P('<p : "x ${ @n == 5 ? "five" : "no" } y">'))).toBe(W("<p>x five y</p>"));
  });
  test("behaviour: a state-child body `\"Loaded ${@n} rows\"`", async () => {
    expect(await html(state('"Loaded ${@n} rows"'))).toBe(W("<p>Loaded 5 rows<!--if--></p>"));
  });
  test("behaviour: `\\${` is no longer an escape — the backslash is content and `${` still interpolates", async () => {
    expect(await html(P('<p : "a \\${@n} b">'))).toBe(W("<p>a \\5 b</p>"));
  });
  test("an interpolating display-text literal nested in a larger expression is reported, not rendered raw", () => {
    expect(run(P('<p : @n == 5 ? "a ${@n}" : "b">')).diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
  });
});

// s444 r2 fix 4 — SPEC §4.18.3: "A display-text literal that reaches end-of-file
// (or the body's closer) before its closing `"` is an unterminated literal —
// `E-CTX-001` against the opening `"`, recovered per §4.18.7".
// PA ruling (s444 r3; §4.18.1b pin 3 — "no character inside can move" the
// body's end): a literal is UNTERMINATED only when the scan from its `"`
// (a `${…}` skipped whole, by token depth) reaches end of file with no closing
// `"`. A CLOSED literal's content is content — never searched for closers.
// Only an unterminated literal is recovered: its content ends at the first body
// closer (`</>` / `</tag>`) after the `"` (or end of file), parsing goes on.
// `stateLast` puts the tested state-child LAST, so no later `"` closes it.
const stateLast = (idle, closer = "</>") => P(`<p><*ph/></p>`, `    <ph:Ph=.A single>\n        <B rule=.A : "B">\n        <A rule=.B>${idle}${closer}\n    </>`);
describe("an unterminated display-text literal is E-CTX-001 against its opening `\"`", () => {
  test("twin (behaviour): the `stateLast` shape renders", async () => {
    expect(await html(stateLast('"Ready"'))).toBe(W("<p>Ready<!--if--></p>"));
  });
  test("`\"abc` then the state-child body's `</>` (no closing `\"` in the file): exactly E-CTX-001, at the `\"`; content `abc`", () => {
    const src = stateLast('"abc');
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-CTX-001"]);
    const q = src.indexOf('"abc');
    expect(r.diags[0].span.start).toBe(q);
    expect(r.diags[0].span.end).toBe(q + 1);
    expect(texts(r)).toContain("abc");
  });
  test("the NAMED closer `</A>` is a recovery point too — exactly E-CTX-001; content `abc`, the `</A>` is not content", () => {
    const r = run(stateLast('"abc', "</A>"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-CTX-001"]);
    expect(texts(r)).toContain("abc");
    expect(texts(r).some((t) => t.includes("</A>"))).toBe(false);
  });
  test("a runaway `${` does not eat the closer — `\"x ${ @n ` then `</>`: exactly E-CTX-001, recovered at the closer", () => {
    const src = stateLast('"x ${ @n ');
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-CTX-001"]);
    expect(r.diags[0].span.start).toBe(src.indexOf('"x'));
    expect(texts(r)).toContain("x ${ @n ");
  });
  test("a `\"` inside an interpolation's string does not close the literal — `\"x ${\"a\"` at end of file is E-CTX-001 (state body and `:`-shorthand)", () => {
    const st = `<program>\n    type Ph:enum = { A, B }\n    <ph:Ph=.A single>\n        <A rule=.B>"x \${"a"`;
    const d1 = run(st).diags;
    expect(d1[0].code).toBe("E-CTX-001");
    expect(d1[0].span.start).toBe(st.indexOf('"x'));
    const sh = `<program>\n    <main>\n        <p : "x \${"a"`;
    const d2 = run(sh).diags;
    expect(d2[0].code).toBe("E-CTX-001");
    expect(d2[0].span.start).toBe(sh.indexOf('"x'));
  });
  test("behaviour: a CLOSED literal containing `</>` is content — never cut at it (the r2 regression)", async () => {
    expect(await html(state('"see </> here"'))).toBe(W("<p>see &lt;/&gt; here<!--if--></p>"));
    expect(await html(stateLast('"see </> here"'))).toBe(W("<p>see &lt;/&gt; here<!--if--></p>"));
  });
  test("behaviour: a CLOSED literal containing the named closer `</A>` is content", async () => {
    expect(await html(state('"see </A> here"'))).toBe(W("<p>see &lt;/A&gt; here<!--if--></p>"));
    expect(await html(stateLast('"see </A> here"', "</A>"))).toBe(W("<p>see &lt;/A&gt; here<!--if--></p>"));
  });
  test("twin (behaviour): a leading `(` does not move the body's end — `(\"see </> here\")` renders the same", async () => {
    expect(await html(state('("see </> here")'))).toBe(W("<p>see &lt;/&gt; here<!--if--></p>"));
  });
  test("a literal running to end of file: E-CTX-001 first, at the `\"`", () => {
    const src = `<program>\n    type Ph:enum = { A, B }\n    <ph:Ph=.A single>\n        <A rule=.B>"abc`;
    const d = run(src).diags;
    expect(d[0].code).toBe("E-CTX-001");
    expect(d[0].span.start).toBe(src.indexOf('"abc'));
    expect(d[0].message).toContain("end of the file");
  });
  test("a `:`-shorthand literal running to end of file: E-CTX-001 at the `\"` (the rest of the file is its content), then only the enclosing elements' unclosed reports", () => {
    const src = `<program>\n    <main>\n        <p : "abc`;
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-CTX-001", "E-PARSE-UNCLOSED", "E-PARSE-UNCLOSED"]);
    expect(r.diags[0].span.start).toBe(src.indexOf('"abc'));
    expect(texts(r)).toContain("abc");
  });
  test("twin: a terminated `:`-shorthand literal at end of file is not E-CTX-001", () => {
    const codes = run(`<program>\n    <main>\n        <p : "abc"`).diags.map((d) => d.code);
    expect(codes).not.toContain("E-CTX-001");
  });
  test("twin (behaviour): a `</b>` (not this body's closer) inside the literal is content", async () => {
    expect(await html(state('"a </b> c"'))).toBe(W("<p>a &lt;/b&gt; c<!--if--></p>"));
  });
  test("twin (behaviour): a `</>` inside an interpolation's string is not the closer (the canonical walker skips the `${…}`)", async () => {
    expect(await html(state('"x ${"</>"} y"'))).toBe(W("<p>x &lt;/&gt; y<!--if--></p>"));
  });
});

// dpa-045 follow-up 4 (RULED S442; SPEC §4.18.5): whitespace-only text between
// elements is kept exactly — L13 (lower dropped whitespace-only text containing
// a newline) is retired. Code-default formatting whitespace is unchanged.
describe("follow-up 4 — whitespace-only text between elements is kept exactly", () => {
  const main = (inner) => `<program>\n    <let n:int=5/>\n    <xs:string[]=(["a", "b"])/>\n    <main>${inner}</main>\n</program>\n`;
  const mainHtml = async (src) => {
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual([]);
    await loadProgram(r.core, "d45-ws-" + k++);
    return document.querySelector("main").innerHTML;
  };
  test("a newline + indentation between two sibling elements is content (behaviour)", async () => {
    expect(await mainHtml(main("<div><b>a</b>\n      <i>b</i>\n   </div>"))).toBe("<div><b>a</b>\n      <i>b</i>\n   </div>");
  });
  test("the newline + indentation after the opener's `>` and before the closer are kept", async () => {
    expect(await mainHtml(main("\n  <b>x</b>\n"))).toBe("\n  <b>x</b>\n");
  });
  test("a dropped comment leaves the bytes around it (the comment is not content, the whitespace is)", async () => {
    expect(await mainHtml(main("<b>a</b>   // note\n  <!-- c -->\n  <i>b</i>"))).toBe("<b>a</b>   \n  \n  <i>b</i>");
  });
  test("an `<each>` row keeps its whitespace", async () => {
    expect(await mainHtml(main("<ul><each in=@xs as x>\n  <li>${x}</li>\n</each></ul>"))).toBe("<ul><!--row-->\n  <li>a</li>\n<!--/row--><!--row-->\n  <li>b</li>\n<!--/row--><!--each--></ul>");
  });
  test("the spaces next to `${…}` in free text are kept (no 'liftedali' content loss)", async () => {
    expect(await mainHtml(main("<p>   lifted   ${@n}   li</p>"))).toBe("<p>   lifted   5   li</p>");
  });
  test("markup-as-value (a `:`-shorthand body) keeps the spaces next to `${…}`", async () => {
    expect(await mainHtml(main("<div : <p>   lifted   ${@n}   li</p>>"))).toBe("<div><p>   lifted   5   li</p></div>");
  });
  test("a display-text literal segment that is only a newline is kept (L13 used to drop it)", async () => {
    expect(await mainHtml(main('<p : "${@n}\n${@n}">'))).toBe("<p>5\n5</p>");
  });
  test("twin: code-default formatting whitespace is NOT content — a state-child body's newlines/indentation render nothing", async () => {
    const src = P("<p><*ph/></p>", `    <ph:Ph=.A single>\n        <A rule=.B>\n            "Ready"\n        </>\n        <B rule=.A : "B">\n    </>`);
    expect(await html(src)).toBe(W("<p>Ready<!--if--></p>"));
  });
  test("the lowered Core carries the whitespace-only Text views (lower no longer filters them)", () => {
    const r = run(main("<b>a</b>\n  <i>b</i>"));
    const kids = r.core.decls[0].renders[0].data.kids;
    expect(kids.map((v) => v.variant)).toEqual(["El", "Text", "El"]);
    expect(kids[1].data.text).toBe("\n  ");
  });
});
