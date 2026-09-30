// comment-escapes.test.js — the two S444 rulings on the dpa-045 residues
// (scrml-support/user-voice-scrml.md S444, "yes on // revised, A for escapes"),
// in the bootstrap parser:
//   R1  free text (§4.18.1b exit (2)): a `//` opens a comment ONLY at the start
//       of the source or right after a whitespace byte (space, tab, LF, CR —
//       a line start and a line's indentation are both that). The comment runs
//       to end of line and is OPAQUE — a `</p>` in it is comment text. Every
//       other `//` is content: `http://x`, `a//b`, `</b>// x`.
//   R2  code-default display-text literal (§4.18.3): `\"`, `\\`, `\${` are
//       escapes again (supersedes S442 B(3) / B(2)); any other `\` + char is
//       E-PARSE-001 (the S111 catalog's rule, restored exactly). Free text
//       stays escape-free.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const P = (body, decls = "") => `<program>\n    type Ph:enum = { A, B }\n    <let n:int=5/>\n${decls}\n    <main>\n        ${body}\n        <b>end</b>\n    </main>\n</program>\n`;
const W = (inner) => `\n        ${inner}\n        <b>end</b>\n    `;
const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
let k = 0;
async function html(src) {
  const r = run(src);
  expect(r.diags.map((d) => d.code)).toEqual([]);
  await loadProgram(r.core, "s444-" + k++);
  return document.querySelector("main").innerHTML;
}
function collect(r, variant, field) {
  const out = [];
  (function walk(x) { if (Array.isArray(x)) { x.forEach(walk); return; } if (!x || typeof x !== "object") return; if (x.k && x.k.variant === variant) out.push(x.k.data[field]); Object.values(x).forEach(walk); })(r.asts);
  return out;
}
const texts = (r) => collect(r, "Text", "text");
const state = (idle) => P(`<p><*ph/></p>`, `    <ph:Ph=.A single>\n        <A rule=.B>${idle}</>\n        <B rule=.A : "B">\n    </>`);
const stateLast = (idle, closer = "</>") => P(`<p><*ph/></p>`, `    <ph:Ph=.A single>\n        <B rule=.A : "B">\n        <A rule=.B>${idle}${closer}\n    </>`);

// ---------------------------------------------------------------------------
// R1 — free-text `//`
// ---------------------------------------------------------------------------
describe("R1 — a free-text `//` is a comment only at line start or after whitespace", () => {
  test("bryan's example: `<p> // this tag should end with </p>` + `</p>` on the next line — an empty `<p>`, the SECOND `</p>` closes", async () => {
    expect(await html(P("<p> // this tag should end with </p>\n</p>"))).toBe(W("<p> \n</p>"));
  });
  test("bryan's example on ONE line: the comment runs to end of line, so BOTH `</p>` are comment text — the `<p>` closes at the next closer", async () => {
    const src = P("<p> // ends with </p> </p>\nx</p>");
    expect(await html(src)).toBe(W("<p> \nx</p>"));
    expect(texts(run(src)).some((t) => t.includes("</p>") || t.includes("ends"))).toBe(false);
  });
  test("the comment is opaque: a `${`, a `<b>` and a `</p>` inside it are comment text", async () => {
    expect(await html(P("<p>a // </p> ${ <b> #{\n</p>"))).toBe(W("<p>a \n</p>"));
  });
  test("`http://x` and `https://x.y/z` are text", async () => {
    expect(await html(P("<p>see http://x and https://x.y/z ok</p>"))).toBe(W("<p>see http://x and https://x.y/z ok</p>"));
  });
  test("`a//b` is text", async () => {
    expect(await html(P("<p>a//b</p>"))).toBe(W("<p>a//b</p>"));
  });
  test("`a///b` is text (each `/` follows a non-whitespace byte)", async () => {
    expect(await html(P("<p>a///b</p>"))).toBe(W("<p>a///b</p>"));
  });
  test("twin: prose `a // b` IS a comment (a space before the `//`)", async () => {
    expect(await html(P("<p>a // b\n</p>"))).toBe(W("<p>a \n</p>"));
  });
  test("indentation then `//`: a comment", async () => {
    expect(await html(P("<div>\n    // note </div>\n  <i>x</i></div>"))).toBe(W("<div>\n    \n  <i>x</i></div>"));
  });
  test("a tab then `//`: a comment", async () => {
    expect(await html(P("<p>a\t// c </p>\n</p>"))).toBe(W("<p>a\t\n</p>"));
  });
  test("a `//` at the start of a line (column 0): a comment", async () => {
    expect(await html(P("<p>a\n// c </p>\n</p>"))).toBe(W("<p>a\n\n</p>"));
  });
  test("⚑ `</b>// x` — preceded by `>`, not whitespace: TEXT", async () => {
    expect(await html(P("<p><b>y</b>// x</p>"))).toBe(W("<p><b>y</b>// x</p>"));
  });
  test("⚑ `<p>// x` — right after the opener's `>`: TEXT", async () => {
    expect(await html(P("<p>// x</p>"))).toBe(W("<p>// x</p>"));
  });
  test("`${@n}// x` — right after an interpolation's `}`: TEXT", async () => {
    expect(await html(P("<p>${@n}// x</p>"))).toBe(W("<p>5// x</p>"));
  });
  test("twin: `</label>   // note` (spaces before) is still a comment", async () => {
    expect(await html(P("<div><b>a</b>   // note </div>\n</div>"))).toBe(W("<div><b>a</b>   \n</div>"));
  });
  test("a comment ends BEFORE a CR line terminator — the `\\r\\n` is content (§4.18.5)", () => {
    const r = run(P("<p>a // c\r\n</p>"));
    expect(r.diags).toEqual([]);
    expect(texts(r)).toContain("a \r\n");
  });
  test("twin: outside free text §4.7 is unchanged — a `//` right after a code-default literal is still a comment", async () => {
    expect(await html(state('"Ready"// note\n'))).toBe(W("<p>Ready<!--if--></p>"));
  });
  test("twin: in a `<program>` body (default-logic) a `//` right after a `>` is still a comment", () => {
    const src = `<program>\n    <let n:int=5/>// note </program>\n    <main><b>x</b></main>\n</program>\n`;
    expect(codes(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R2 — display-text escapes restored
// ---------------------------------------------------------------------------
describe("R2 — `\\\"` `\\\\` `\\${` are escapes in a display-text literal", () => {
  test("`\"She said \\\"hi\\\"\"` renders `She said \"hi\"` — `:`-shorthand", async () => {
    expect(await html(P('<p : "She said \\"hi\\"">'))).toBe(W('<p>She said "hi"</p>'));
  });
  test("`\"She said \\\"hi\\\"\"` — state-child body", async () => {
    expect(await html(state('"She said \\"hi\\""'))).toBe(W('<p>She said "hi"<!--if--></p>'));
  });
  test("`\"a\\\"b\"` is ONE literal — no leftover, no diagnostic (S442 read it as `a\\` + trailing `b`)", async () => {
    expect(await html(P('<p : "a\\"b">'))).toBe(W('<p>a"b</p>'));
    expect(await html(state('"a\\"b"'))).toBe(W('<p>a"b<!--if--></p>'));
  });
  test("`\"C:\\\\\"` renders `C:\\` — the `\"` after the escaped backslash closes (both loci)", async () => {
    expect(await html(P('<p : "C:\\\\">'))).toBe(W("<p>C:\\</p>"));
    expect(await html(state('"C:\\\\"'))).toBe(W("<p>C:\\<!--if--></p>"));
  });
  test("`\"a\\\\\\\\b\"` (two escaped backslashes) renders two backslashes", async () => {
    expect(await html(state('"a\\\\\\\\b"'))).toBe(W("<p>a\\\\b<!--if--></p>"));
  });
  test("`\"\\${x}\"` renders the literal `${x}` — not an interpolation (both loci)", async () => {
    expect(await html(P('<p : "\\${x}">'))).toBe(W("<p>${x}</p>"));
    expect(await html(state('"\\${x}"'))).toBe(W("<p>${x}<!--if--></p>"));
  });
  test("`\\${` beside a live `${…}`: `\"a \\${x} ${@n}\"` renders `a ${x} 5`", async () => {
    expect(await html(P('<p : "a \\${x} ${@n}">'))).toBe(W("<p>a ${x} 5</p>"));
    expect(await html(state('"a \\${x} ${@n}"'))).toBe(W("<p>a ${x} 5<!--if--></p>"));
  });
  test("twin: an unescaped `${` still interpolates", async () => {
    expect(await html(P('<p : "a ${@n} b">'))).toBe(W("<p>a 5 b</p>"));
  });
  test("a `\\${`-only literal nested in a larger expression is NOT an interpolating literal (no E-BOOTSTRAP-UNSUPPORTED) and renders `${x}`", async () => {
    expect(await html(P('<p : @n == 5 ? "a \\${x}" : "b">'))).toBe(W("<p>a ${x}</p>"));
  });
  test("cooked: the node handed on carries the decoded value", () => {
    const strs = collect(run(state('"She said \\"hi\\" C:\\\\"')), "Str", "v");
    expect(strs).toContain('She said "hi" C:\\');
  });
  test("a malformed escape `\\q` is E-PARSE-001 at the backslash (span 2), once; the literal still closes", () => {
    for (const src of [P('<p : "a\\qb">'), state('"a\\qb"')]) {
      const r = run(src);
      expect(r.diags.map((d) => d.code)).toEqual(["E-PARSE-001"]);
      const at = src.indexOf("\\q");
      expect(r.diags[0].span.start).toBe(at);
      expect(r.diags[0].span.end).toBe(at + 2);
    }
  });
  test("recovery: a malformed escape keeps BOTH characters — the cooked value of `\"a\\qb\"` is `a\\qb` (never the logic decoder's `aqb`)", () => {
    for (const src of [P('<p : "a\\qb">'), state('"a\\qb"')]) {
      expect(collect(run(src), "Str", "v")).toContain("a\\qb");
    }
  });
  test("`\\n`, `\\t` and a `\\$` not followed by `{` are malformed too (E-PARSE-001 each)", () => {
    expect(codes(P('<p : "a\\nb\\tc\\$5">'))).toEqual(["E-PARSE-001", "E-PARSE-001", "E-PARSE-001"]);
  });
  test("a `\\` inside the interpolation's string is the LOGIC string's escape — `\\t` is a tab, no E-PARSE-001", async () => {
    expect(await html(P('<p : "x ${"a\\tb"} y">'))).toBe(W("<p>x a\tb y</p>"));
  });
  test("twin: a LOGIC string in free text keeps the full escape set — `${\"a\\tb\"}` renders a tab (display mode is the code-default regions' only)", async () => {
    expect(await html(P('<p>${"a\\tb"}</p>'))).toBe(W("<p>a\tb</p>"));
  });
  test("twin: free text stays escape-free — `\\\"` / `\\\\` / `\\q` in a `<p>` are content, no diagnostic", async () => {
    expect(await html(P('<p>a \\" b \\\\ c \\q</p>'))).toBe(W('<p>a \\" b \\\\ c \\q</p>'));
  });
});

describe("R2 — the unterminated-literal scan (displayCloseAt) honours the escapes", () => {
  test("`\"abc\\\"` at end of file: the escaped quote does not close — E-CTX-001 at the opening `\"` (`:`-shorthand)", () => {
    const src = `<program>\n    <main>\n        <p : "abc\\"`;
    const r = run(src);
    expect(r.diags[0].code).toBe("E-CTX-001");
    expect(r.diags[0].span.start).toBe(src.indexOf('"abc'));
  });
  test("`\"abc\\\"` at end of file — state-child body: E-CTX-001 at the opening `\"`", () => {
    const src = `<program>\n    type Ph:enum = { A, B }\n    <ph:Ph=.A single>\n        <A rule=.B>"abc\\"`;
    const r = run(src);
    expect(r.diags[0].code).toBe("E-CTX-001");
    expect(r.diags[0].span.start).toBe(src.indexOf('"abc'));
  });
  test("`\"abc\\\"` then the body's `</>` (no other `\"` in the file): exactly E-CTX-001, recovered at the closer", () => {
    const src = stateLast('"abc\\"');
    const r = run(src);
    expect(r.diags.map((d) => d.code)).toEqual(["E-CTX-001"]);
    expect(r.diags[0].span.start).toBe(src.indexOf('"abc'));
  });
  test("twin: `\"C:\\\\\"` at end of file CLOSES (an escaped backslash does not escape the quote) — no E-CTX-001", () => {
    expect(codes(`<program>\n    <main>\n        <p : "C:\\\\"`)).not.toContain("E-CTX-001");
    expect(codes(`<program>\n    type Ph:enum = { A, B }\n    <ph:Ph=.A single>\n        <A rule=.B>"C:\\\\"`)).not.toContain("E-CTX-001");
  });
  test("twin: a closed literal with `\\\"` inside and the last state-child — renders, not E-CTX-001", async () => {
    expect(await html(stateLast('"say \\"x\\""'))).toBe(W('<p>say "x"<!--if--></p>'));
  });
});

// ---------------------------------------------------------------------------
// RULED S444 ("standalone only, your rec"): in a code-default body a `"…"` is a
// display-text literal ONLY when it stands alone as the body statement. A
// string operand inside an expression is an ORDINARY string with the ordinary
// logic-string escapes — no display escape table, no E-PARSE-001.
// ---------------------------------------------------------------------------
describe("standalone only — a `\"…\"` inside an expression is an ordinary string", () => {
  test("`:`-shorthand `@n == 5 ? \"many\\nx\" : \"few\"`: clean, and `\\n` decodes to a NEWLINE in the value", async () => {
    const src = P('<p : @n == 5 ? "many\\nx" : "few">');
    expect(collect(run(src), "Str", "v")).toContain("many\nx");
    expect(await html(src)).toBe(W("<p>many\nx</p>"));
  });
  test("state-child body `@n == 5 ? \"a\\tb\" : \"c\"`: clean, `\\t` is a tab", async () => {
    expect(await html(state('@n == 5 ? "a\\tb" : "c"'))).toBe(W("<p>a\tb<!--if--></p>"));
  });
  test("twin: a call argument `f(\"a\\\"b\\tc\")` is an ordinary string", async () => {
    expect(await html(P('<p : f("a\\"b\\tc")>', "    fn f(s: string) -> string { return s }"))).toBe(W('<p>a"b\tc</p>'));
  });
  test("twin: a concatenation operand `\"a\\tb\" + @s` is an ordinary string", async () => {
    expect(await html(P('<p : "a\\tb" + @s>', '    <let s:string="Z"/>'))).toBe(W("<p>a\tbZ</p>"));
  });
  test("twin: an unknown escape in an ordinary string is NOT E-PARSE-001 (the logic identity escape: `\\q` → `q`)", () => {
    const r = run(P('<p : @n == 5 ? "a\\qb" : "c">'));
    expect(r.diags).toEqual([]);
    expect(collect(r, "Str", "v")).toContain("aqb");
  });
  test("contrast: a STANDALONE `\"x\\n\"` is still a display-text literal — E-PARSE-001 (both loci)", () => {
    expect(codes(P('<p : "x\\n">'))).toEqual(["E-PARSE-001"]);
    expect(codes(state('"x\\n"'))).toEqual(["E-PARSE-001"]);
  });
  test("contrast: a standalone literal keeps its display escapes — `\"\\${x}\"` is literal text; the nested ordinary string's `\\$` is the logic escape", async () => {
    expect(await html(P('<p : "\\${x}">'))).toBe(W("<p>${x}</p>"));
    expect(await html(P('<p : @n == 5 ? "a \\${x}" : "b">'))).toBe(W("<p>a ${x}</p>"));
  });
});
