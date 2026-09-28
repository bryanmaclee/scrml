// css.test.js — the bootstrap STYLESHEET pass (s440-bootstrap-css-theme-t3): the emitter (css.scrml)
// over hand-built Cores (incl. the §66.17 T3 shapes impl#1's front end cannot carry), and the
// stylesheet shim (css-ingest.scrml) over impl#1's FileAST — its mappings and its fail-closed reasons.
//
// Text assertions here pin the emitter's OWN output shape (bootstrap unit tests — never parity with
// impl#1). What the CSS DOES is graded in Chromium by the css oracle (css-oracle.js; hybrid.ts).

import { describe, test, expect } from "bun:test";
import { cgArgsOf, caseSource } from "./harness.js";
import * as sub from "./css-substitute.js";

const C = sub.cssMods.css;
const K = sub.cssMods["css.core"];
const CI = sub.cssMods["css-ingest"];

const RESET = [
  "@layer reset {",
  "  *, ::before, ::after { box-sizing: border-box; }",
  "  body, h1, h2, h3, h4, h5, h6, p, ul, ol, figure, blockquote, hr, fieldset { margin: 0; }",
  "  body { min-height: 100vh; line-height: 1.5; }",
  "  img, picture, video, canvas, svg { display: block; max-width: 100%; }",
  "  input, button, textarea, select { font: inherit; }",
  "}",
];

/** Ingest a source the way the CSS seam sees it: impl#1's front end, then the shim. */
function ingest(source, mode = "browser") {
  const { args, errors } = cgArgsOf(source);
  if (!args) return { frontEnd: errors, results: [] };
  return { frontEnd: errors, results: args.files.map((f) => sub.ingestFile(f.ast, mode)) };
}
const whyOf = (source, mode) => ingest(source, mode).results.flatMap((r) => r.why);
const cssOf = (source) => {
  const r = ingest(source).results[0];
  expect(r.why).toEqual([]);
  return C.emitCss(r.unit);
};

describe("emitter — §66.17 T3 (hand-built Cores)", () => {
  test("items 2 + 3: a constant token → static :root; a recognized match over @mode → one variant block per arm", () => {
    expect(C.emitCss(K.t3Worked())).toBe([
      "@layer reset, global;",
      ...RESET,
      ":root { --brand: #338967; }",
      ':root[data-scrml-theme-mode="Light"] { --ink: #0f172a; }',
      ':root[data-scrml-theme-mode="Dark"] { --ink: #e2e8f0; }',
      '@scope ([data-scrml="Card"]) to ([data-scrml]) {',
      "  :where(.card) { color: var(--ink); background-color: var(--brand); }",
      "}",
    ].join("\n"));
  });

  test("a wildcard arm is the :root default under the variant blocks", () => {
    const css = C.emitCss(K.t3Wildcard());
    expect(css).toContain(":root { --paper: #ffffff; }");
    expect(css).toContain(':root[data-scrml-theme-mode="Dark"] { --paper: #0f172a; }');
    expect(css.indexOf(":root { --paper")).toBeLessThan(css.indexOf(":root[data-scrml-theme-mode"));
  });

  test("item 7: an unrecognized match-over-enum token contributes NO stylesheet definition (script writes)", () => {
    const css = C.emitCss(K.t3ScriptWrites());
    expect(css).not.toContain("--ink:");
    expect(css).toContain("color: var(--ink);");
    expect(C.cssFootprint(K.t3ScriptWrites())).toContain("Token.ScriptWrites");
  });

  test("two cells switch two tokens independently (one attribute per cell)", () => {
    const css = C.emitCss(K.t3TwoCells());
    expect(css).toContain(':root[data-scrml-theme-contrast="High"] { --edge: 3px; }');
    expect(css).toContain(':root[data-scrml-theme-mode="Dark"] { --ink: #eeeeee; }');
  });

  test("nothing to emit → the empty string", () => {
    expect(C.emitCss(K.emptyUnit())).toBe("");
  });
});

describe("emitter — sheet order, flat specificity, the floor", () => {
  const css = C.emitCss(K.everyShape());
  const at = (s) => css.indexOf(s);

  test("§65.8: @charset at byte 0; the layer order statement, then @import, before every block", () => {
    expect(css.startsWith('@charset "UTF-8";\n@layer reset, global;\n@import url("theme.css");\n@import url("print.css") print;\n@layer reset {')).toBe(true);
  });

  test("§65.5: reset < theme :root (unlayered) < @layer global < component scope (unlayered)", () => {
    expect(at("@layer reset {")).toBeLessThan(at(":root { --brand"));
    expect(at(":root { --brand")).toBeLessThan(at("@layer global {"));
    expect(at("@layer global {")).toBeLessThan(at("@scope ("));
    expect(css).toContain("@layer global {\n  a { color: var(--brand); }\n}");
  });

  test("§65.2.5: unconditional arms :where()-wrapped one by one (never :is()); conditional arms and pseudo-elements unwrapped", () => {
    expect(css).toContain(":where(.card .title), :where(ul > li) { margin: 0; }");
    expect(css).toContain(":where(#a + * ~ p) { width: calc(var(--scrml-count) * 1px); }");
    expect(css).toContain('.btn:hover, li:not(.x), input[type="submit"], .card::before { color: red; }');
    expect(css).not.toContain(":is(");
  });

  test("§65.2.4 R1: a universal / bare-root arm is emitted FIRST in its scope (a floor below specific rules)", () => {
    const src = `<program>
  const Card = <div props={}>
      #{
          .btn { padding: 16px; }
          *, .x { padding: 0; }
      }
      <button class="btn">Go</button>
  </>
  <Card/>
</program>
`;
    const out = cssOf(src);
    expect(out).toContain("  :where(*) { padding: 0; }\n  :where(.btn) { padding: 16px; }\n  :where(.x) { padding: 0; }");
  });
});

describe("shim — legacy mappings (graded through the CSS seam)", () => {
  test("a legacy `<theme for=@mode>` base + `.Dark` → a constant-default variant token (§65.6 meaning)", () => {
    const out = cssOf(caseSource("style/theme-emission-clean"));
    expect(out).toContain(":root { --ink: #0f172a; --bg: #ffffff; }");
    expect(out).toContain(':root[data-scrml-theme-mode="Dark"] { --ink: #f8fafc; --bg: #0f172a; }');
    expect(out).toContain("  :where(.card) { padding: 16px; color: var(--ink); background: var(--bg); }");
  });

  test("`<program reset=\"none\">` drops the reset and the layer statement", () => {
    const out = cssOf(caseSource("style/reset-opt-out-clean"));
    expect(out).not.toContain("@layer");
    expect(out).toContain("@scope");
  });

  test("a program-level `@import` is hoisted; the rest of the block goes to @layer global", () => {
    const out = cssOf(caseSource("style/program-import-hoist-clean"));
    expect(out).toContain('@layer reset, global;\n@import url("theme.css");\n@layer reset {');
    expect(out).toContain("@layer global {\n  a { color: red; }\n}");
  });

  test("a flat `#{}` in a component is html's inline style — not in the sheet; its tokens still are", () => {
    const out = cssOf(caseSource("style/flat-inline-token-lowering-clean"));
    expect(out).toContain(":root { --brand: #2563eb; }");
    expect(out).not.toContain("@scope");
  });

  test("a component used twice contributes its rules once", () => {
    const out = cssOf(`<program>
  const Card = <div props={}>
      #{ .card { color: red; } }
      <div class="card">hi</div>
  </>
  <Card/>
  <Card/>
</program>
`);
    expect(out.split(":where(.card)").length - 1).toBe(1);
  });

  test("no `<program>` → no reset (the reset is the app's; §65.3.4 / §65.8 'emitted once')", () => {
    const r = ingest(`<div id="x">hi</div>\n`).results[0];
    expect(r.why).toEqual([]);
    expect(C.emitCss(r.unit)).toBe("");
  });
});

describe("shim — FAIL CLOSED (not-yet, never a guess)", () => {
  const theme = (body, forCell = "") => `<program>
  <mode> = .Light
  <userColor> = "#ff0000"
  <theme${forCell}>
${body}
  </theme>
  <p>x</p>
</program>
`;

  test("O17(c): a `<theme>` `@media (prefers-color-scheme)` auto-bind", () => {
    const why = whyOf(theme("      ink = #000000;\n      @media (prefers-color-scheme: dark) {\n          ink = #ffffff;\n      }", " for=@mode"));
    expect(why.some((w) => w.includes("O17(c)"))).toBe(true);
  });

  test("O17(d): a `<theme>` in a library-mode file", () => {
    const why = whyOf(theme("      ink = #000000;"), "library");
    expect(why.some((w) => w.includes("O17(d)"))).toBe(true);
  });

  test("O47: a theme token whose value reads a cell", () => {
    const why = whyOf(theme("      ink = @userColor;"));
    expect(why.some((w) => w.includes("O47"))).toBe(true);
  });

  test("§66.17 item 4: a token and a cell of one name", () => {
    const why = whyOf(theme("      userColor = #000000;"));
    expect(why.some((w) => w.includes("one namespace"))).toBe(true);
  });

  test("a T3 declaration body (impl#1 rejects the source; the shim never sees a mapped token)", () => {
    const r = ingest(`<program>
  <theme>
      <brand:string="#338967"/>
  </theme>
  <p>x</p>
</program>
`);
    const why = r.results.flatMap((x) => x.why);
    expect(why.some((w) => w.includes("T3")) || r.frontEnd.length > 0).toBe(true);
  });

  test("`!important` (§65.7), an `@media` block, a nesting `&` (lost by impl#1's parser), element-level `#{}`", () => {
    const comp = (body) => `<program>
  const Card = <div props={}>
      #{ ${body} }
      <button class="btn">Go</button>
  </>
  <Card/>
</program>
`;
    expect(whyOf(comp(".btn { color: red !important; }")).some((w) => w.includes("§65.7"))).toBe(true);
    expect(whyOf(comp("@media (min-width: 700px) { .btn { color: red; } }")).some((w) => w.includes("@media"))).toBe(true);
    expect(whyOf(comp(".btn { &:hover { color: red; } }")).some((w) => w.includes("empty value"))).toBe(true);
    const el = whyOf(`<program>\n  <div>\n    #{ .x { color: red; } }\n    <span class="x">x</span>\n  </div>\n</program>\n`);
    expect(el.some((w) => w.includes("non-component element"))).toBe(true);
  });

  test("a variant re-binding a name with no base value (E-THEME-TOKEN-UNKNOWN is analyze's)", () => {
    const why = whyOf(caseSource("style/theme-variant-rebind-unknown"));
    expect(why.some((w) => w.includes("no base value"))).toBe(true);
  });
});

describe("selector parser (§65.2.5: fail loud)", () => {
  const ok = (s) => {
    const r = CI.parseSelector(s);
    expect(r.err).toBe("");
    return r.arms.map((a) => C.complexText(a));
  };
  test("round-trips every shape", () => {
    expect(ok(".a .b, ul > li,  #x + * ~ p")).toEqual([".a .b", "ul > li", "#x + * ~ p"]);
    expect(ok('input[type="a,b"]:not(.x, .y)::before')).toEqual(['input[type="a,b"]:not(.x, .y)::before']);
  });
  test("refuses what it cannot parse", () => {
    for (const bad of ["", ".", "a >", "& .x", ".a,", "a[b", "a:not(b"]) {
      expect(CI.parseSelector(bad).err).not.toBe("");
    }
  });
});

describe("footprint", () => {
  test("a graded style case's constructs; a not-yet case carries its reason", () => {
    const fp = sub.footprint(cgArgsOf(caseSource("style/theme-emission-clean")).args);
    expect(fp.notYet).toEqual([]);
    for (const c of ["Css.Reset", "Css.LayerOrder", "Css.Scope", "Scope.Flat", "Token.OnVariant", "Token.OnVariant.Otherwise", "Value.TokenVar"]) {
      expect(fp.constructs).toContain(c);
    }
    const ny = sub.footprint(cgArgsOf(caseSource("style/theme-variant-rebind-unknown")).args);
    expect(ny.constructs).toEqual([]);
    expect(ny.notYet.length).toBeGreaterThan(0);
  });
});
