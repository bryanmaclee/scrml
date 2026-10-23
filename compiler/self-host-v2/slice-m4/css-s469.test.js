// css-s469.test.js — s469-boot-css: `#{}` CSS through the bootstrap, end to end — the reader
// (css-syntax.scrml), the placement (analyze cssPass), the Core sheet + root stamping (lower), the
// printed `<style>` and the §25.7 bridge (print + runtime), run in happy-dom.
//
// Governing text:
//  - §9.1 DQ-6: "A `#{}` block MAY appear at the top level of a file … Top-level `#{}` compiles to a
//    stylesheet that is included in the page's global styles"; "`#{}` inside a markup element that is
//    not inside a component … is program-global: its rules compile exactly as a program-level `#{}`".
//  - §9.1 DQ-7: "`#{}` inside a state type constructor compiles to a native CSS `@scope
//    ([data-scrml="ConstructorName"]) to ([data-scrml]) { ... }` block … Class names are NOT mangled";
//    "The constructor's root element SHALL carry the attribute `data-scrml="ConstructorName"`";
//    "Flat-declaration `#{}` blocks … inside a constructor scope compile to inline `style="prop: value;
//    ..."` on the containing element"; "Donut scope is implicit". §66.15.1: a declaration with typed
//    attributes and a `renders` clause IS the component.
//  - §65.2.5: scoped unconditional arms are `:where()`-flat; "validate author selectors and fail loud".
//  - §65.5 / §65.8: `@layer reset, global;`, program-global `#{}` in `@layer global`, the component
//    scope unlayered; `@charset` / `@import` hoisted out of the layer.
//  - §25.2: `name = value;` → `--name: value;`. §25.7 / §65.3.2: `@name` of a declared cell →
//    `var(--scrml-name)`; a `@name` naming neither a token nor a cell is E-THEME-TOKEN-UNKNOWN.
//
// happy-dom 20 resolves `@scope` (with its donut limit), `:where()` and `var()` but IGNORES `@layer`
// entirely (probed: a rule only inside `@layer global {}` never applies; slice-m3/css-oracle.js says
// the same) — so the program-global rules are checked by the printed sheet's shape and by the parsed
// CSSOM, and the component / inline / bridge styles by computed style.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const diags = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const printed = (core) => mods.print.printProgram(core, "c.client.js", "scrml-runtime.js");
const sheetOf = (core) => {
  const m = /<style>([\s\S]*?)<\/style>/.exec(printed(core).html);
  return m ? m[1] : null;
};
/** The author part of a sheet: the reset block removed. */
const author = (css) => css.replace(/@layer reset \{[\s\S]*?\n\}\n?/, "");
const $ = (sel) => document.querySelector(sel);
const color = (sel) => window.getComputedStyle($(sel)).color;
/** The one diagnostic `src` reports, with the source text its span covers. */
const only = (src) => {
  const ds = run(src).diags;
  expect(ds.map((d) => d.code).length).toBe(1);
  return { code: ds[0].code, at: src.slice(ds[0].span.start, ds[0].span.end), start: ds[0].span.start, message: ds[0].message };
};

const P = (body, decls = "") => `<program>\n${decls}    <main>\n${body}\n    </main>\n</program>\n`;
const CARD = `    <card title:string/>
    renders <div class="card">
        #{
            .card { padding: 16px; border: 1px solid #e5e7eb; }
            h2 { color: green; }
        }
        <h2 class="t">\${title}</h2>
    </div>
`;

describe("placement and the printed sheet (§9.1 DQ-6 / DQ-7, §65.5, §65.8)", () => {
  test("program-level, file top-level and plain-element `#{}` are program-global: `@layer global`, in source order", () => {
    const core = clean(`#{ body { font-family: sans-serif; } }\n<program>\n    #{ p { color: red; } }\n    <main>\n        <section>#{ .note { margin: 0 auto; } }<p class="note">x</p></section>\n    </main>\n</program>\n`);
    expect(author(sheetOf(core))).toBe([
      "@layer reset, global;",
      "@layer global {",
      "  body { font-family: sans-serif; }",
      "  p { color: red; }",
      "  .note { margin: 0 auto; }",
      "}",
    ].join("\n"));
  });

  test("a component's `#{}` is its `@scope` donut, unconditional arms `:where()`-flat, conditional ones kept; its root carries data-scrml", () => {
    const core = clean(P(`        <card title="hello"/>`, `    <card title:string/>
    renders <div class="card">
        #{
            .card > h2, .card:hover { color: green; }
            [data-k="1"] { margin: 0; }
            p::first-line { color: red; }
        }
        <h2>\${title}</h2>
    </div>
`));
    const css = sheetOf(core);
    expect(author(css)).toBe([
      "@layer reset, global;",
      '@scope ([data-scrml="card"]) to ([data-scrml]) {',
      "  :where(.card > h2), .card:hover { color: green; }",
      '  [data-k="1"] { margin: 0; }',
      "  p::first-line { color: red; }",
      "}",
    ].join("\n"));
    // the `>` combinator is printed verbatim in the raw-text `<style>`, never as `&gt;`
    expect(css).not.toContain("&gt;");
    expect(printed(core).html).toContain('<div class="card" data-scrml="card">');
  });

  test("§65.2.4 R1: a universal / bare-root arm is emitted FIRST in its scope (a floor below specific rules)", () => {
    const core = clean(P(`        <k t="a"/>`, `    <k t:string/>\n    renders <div>#{ .x { padding: 1px; } * { padding: 0; } }<p class="x">\${t}</p></div>\n`));
    expect(author(sheetOf(core))).toContain(':where(*) { padding: 0; }\n  :where(.x) { padding: 1px; }');
  });

  test("once any component has a scoped sheet, EVERY component root is stamped (the donut's limit); with none, nothing is", () => {
    const plain = `    <chip label:string/>\n    renders <span>\${label}</span>\n`;
    const scoped = clean(P(`        <card title="a"/>\n        <chip label="b"/>`, CARD + plain));
    expect(printed(scoped).html).toContain('<span data-scrml="chip">');
    const none = clean(P(`        <chip label="b"/>`, `    #{ p { color: red; } }\n` + plain));
    expect(printed(none).html).not.toContain("data-scrml");
  });

  test("a flat `#{}` directly in a component's root → that root's inline style= (and not in the sheet)", () => {
    const core = clean(P(`        <chip label="x"/>`, `    <chip label:string/>\n    renders <span class="chip">\n        #{ color: navy; font-weight: 700; }\n        \${label}\n    </span>\n`));
    expect(printed(core).html).toContain('<span class="chip" style="color: navy; font-weight: 700;">');
    expect(sheetOf(core)).not.toContain("navy");
  });

  test("§65.8: `@charset` / `@import` are hoisted — charset at byte 0, import after the layer order, before every block", () => {
    const core = clean(P(`        <p>x</p>`, `    #{\n        p { color: red; }\n        @import url("a.css") screen;\n        @charset "utf-8";\n    }\n`));
    const css = sheetOf(core);
    expect(css.startsWith('@charset "utf-8";\n@layer reset, global;\n@import url("a.css") screen;\n@layer reset {')).toBe(true);
  });

  test("§25.2: `name = value;` inside a rule is the custom property `--name`; comments are dropped", () => {
    const core = clean(P(`        <p>x</p>`, `    #{ /* tokens */ p { gap = 4px; margin: var(--gap) /* m */; } }\n`));
    expect(author(sheetOf(core))).toContain("p { --gap: 4px; margin: var(--gap); }");
  });

  test("`<program reset=\"none\">` with author CSS: no reset layer, the order statement still names both layers", () => {
    const core = clean(`<program reset="none">\n    #{ p { color: red; } }\n    <main><p>x</p></main>\n</program>\n`);
    expect(sheetOf(core)).toBe("@layer reset, global;\n@layer global {\n  p { color: red; }\n}");
  });

  test("a `#{}` between `if=` and `else` does not break the chain (it renders nothing where it stands)", () => {
    const core = clean(`<program>\n    <ok:bool=true/>\n    <main>\n        <p if=@ok>a</p>\n        #{ p { color: red; } }\n        <p else>b</p>\n    </main>\n</program>\n`);
    expect(author(sheetOf(core))).toContain("p { color: red; }");
  });

  test("a CSS-free program prints exactly the reset (unchanged)", () => {
    const css = sheetOf(clean(P(`        <p>x</p>`)));
    expect(css.startsWith("@layer reset, global;\n@layer reset {")).toBe(true);
    expect(css).not.toContain("@layer global {");
  });
});

describe("the §25.7 bridge — `@cell` → var(--scrml-cell)", () => {
  test("a program cell in a scoped rule and in a flat block prints var(--scrml-…), and the client calls rt.cssVar once per cell", () => {
    const core = clean(P(`        <k t="a"/>`, `    <accent:string="teal"/>\n    <k t:string/>\n    renders <div>\n        #{ color: @accent; }\n        <p class="x">#{ }\${t}</p>\n    </div>\n    #{ .x { border-color: @accent; } }\n`));
    const out = printed(core);
    expect(out.html).toContain('style="color: var(--scrml-accent);"');
    expect(out.html).toContain(".x { border-color: var(--scrml-accent); }");
    expect(out.js.match(/rt\.cssVar\(/g).length).toBe(1);
    expect(out.js).toContain('rt.cssVar(program$.scope, "--scrml-accent", () => ');
  });
});

describe("diagnostics — E-CSS-SYNTAX (malformed CSS) with spans the author can act on", () => {
  const G = (css) => `<program>\n    let <c:string="red"/>\n    #{\n${css}\n    }\n    <main><p>x</p></main>\n</program>\n`;
  test("a missing `;` between two declarations: the EMPTY span where the `;` goes", () => {
    const src = G(`        p { color: red background: blue; }`);
    const d = only(src);
    expect(d.code).toBe("E-CSS-SYNTAX");
    expect(d.at).toBe("");
    expect(src.slice(d.start - 3, d.start)).toBe("red");
    expect(d.message).toContain("`;` is missing before `background`");
  });
  for (const [name, css, at, words] of [
    ["a declaration with no `:`", `        p { color red; }`, "color red", "is not a declaration"],
    ["a declaration with no value", `        p { color: ; }`, ":", "has no value"],
    ["a property that is not a name", `        p { 9x: red; }`, "9x", "is not a CSS property name"],
    ["an unparseable selector (§65.2.5 fail loud)", `        p..x { color: red; }`, "p..x", "does not parse"],
    ["an unclosed `(`", `        p { width: calc(1px + 2px; }`, " calc(1px + 2px; ", "unclosed `(`"],
    ["a stray `@`", `        p { color: @; }`, "@", "stray `@`"],
    ["a malformed `@import`", `        @import foo;`, "@import foo", "takes a url"],
  ]) {
    test(name, () => {
      const d = only(G(css));
      expect([d.code, d.at]).toEqual(["E-CSS-SYNTAX", at]);
      expect(d.message).toContain(words);
    });
  }
  test("an unclosed `#{`: reported at the `#{`, and the block ends at the markup that follows (no cascade)", () => {
    const src = `<program>\n    #{ p { color: red; }\n    <main><p>x</p></main>\n</program>\n`;
    const d = only(src);
    expect([d.code, d.at]).toEqual(["E-CSS-SYNTAX", "#{"]);
  });
  test("an unclosed comment", () => {
    const ds = run(`<program>\n    #{ p { color: red; } /* x }\n    <main><p>x</p></main>\n</program>\n`).diags.map((d) => d.code);
    expect(ds).toEqual(["E-CSS-SYNTAX", "E-CSS-SYNTAX"]);
  });
  test("any `<` — in a selector, a value, or a string — is refused (the sheet is printed inside `<style>`)", () => {
    for (const css of [`        p<a { color: red; }`, `        p::before { content: "</style><script>alert(1)</script>"; }`, `        p { color: <x>; }`]) {
      const d = only(G(css));
      expect([d.code, d.at]).toEqual(["E-CSS-SYNTAX", "<"]);
      expect(d.message).toContain("\\3c");
    }
  });
});

describe("diagnostics — ruled CSS the bootstrap refuses by name, and the use-site check", () => {
  const G = (css, decls = "") => `<program>\n    <c:string="red"/>\n    <n:int=3/>\n    <b:bool=true/>\n${decls}    #{\n${css}\n    }\n    <main><p>x</p></main>\n</program>\n`;
  for (const [name, css, at, words] of [
    ["`@media` (and every other block at-rule)", `        @media (min-width: 1px) { p { color: red; } }`, "@media", "`@media`"],
    ["a rule nested in a rule", `        p { color: red; a { color: blue; } }`, "a", "nested"],
    ["`&` nesting", `        &.x { color: red; }`, "&.x", "`&`"],
    ["`@apply` (§26.8)", `        p { @apply p-4; }`, "@apply", "§26.8"],
    ["`!important` (§65.7 unclassified)", `        p { color: red !important; }`, "!important", "§65.7"],
    ["`${…}` in a value (unruled; `@name` is the channel)", `        p { color: \${@c}; }`, "${", "§25.7"],
    ["a bool cell", `        p { color: @b; }`, "@b", "a bool cell"],
    ["a flat block outside a component's root (§9.1 ⚑ OPEN)", `        color: red;`, null, "§9.1"],
    ["a flat block mixed with rules", `        color: red;\n        p { color: blue; }`, null, "mixes"],
  ]) {
    test(name, () => {
      const d = only(G(css));
      expect(d.code).toBe("E-BOOTSTRAP-UNSUPPORTED");
      if (at !== null) expect(d.at).toBe(at);
      expect(d.message).toContain(words);
    });
  }
  test("`@name` naming no token and no cell → E-THEME-TOKEN-UNKNOWN at the reference (§65.3.2); an int cell is fine", () => {
    const d = only(G(`        p { color: @nope; }`));
    expect([d.code, d.at]).toEqual(["E-THEME-TOKEN-UNKNOWN", "@nope"]);
    expect(diags(G(`        p { width: @n; }`))).toEqual([]);
  });
  test("a component's own field in its CSS (per-instance — no `:root` home) is refused by name", () => {
    const d = only(`<program>\n    <k t:string/>\n    renders <div>#{ .x { color: @t; } }</div>\n    <main><k t="a"/></main>\n</program>\n`);
    expect([d.code, d.at]).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "@t"]);
  });
  test("`@import` in a component, a flat block below a component's root, a flat block on a root that has style=", () => {
    const K = (root) => `<program>\n    <k t:string/>\n    renders ${root}\n    <main><k t="a"/></main>\n</program>\n`;
    expect(only(K(`<div>#{ @import "a.css"; .x { color: red; } }</div>`)).message).toContain("§65.8");
    expect(only(K(`<div><span>#{ color: red; }</span></div>`)).message).toContain("below its `renders` root");
    expect(only(K(`<div style="margin: 0">#{ color: red; }</div>`)).message).toContain("already has `style=`");
  });
  test("a top-level `#{}` in a module file (no `<program>`) is refused (DQ-6 names no page for it)", () => {
    const r = frontEnd(mods, [
      { path: "lib.scrml", src: `#{ p { color: red; } }\nexport fn f() -> int { return 1; }\n` },
      { path: "app.scrml", src: `import { f } from "./lib.scrml"\n<program>\n    <main><p>x</p></main>\n</program>\n` },
    ], "app.scrml");
    expect(r.diags.filter((d) => d.code !== "E-STMT-MISSING-SEMICOLON").map((d) => [d.code, d.file])).toEqual([["E-BOOTSTRAP-UNSUPPORTED", "lib.scrml"]]);
  });
  test("two components of one name cannot share a scope key: the linker refuses the second declaration", () => {
    const r = frontEnd(mods, [
      { path: "a.scrml", src: `export <card t:string/>\nrenders <div>#{ .x { color: red; } }\${t}</div>\n` },
      { path: "app.scrml", src: `import { card } from "./a.scrml";\n<program>\n    <card x:string/>\n    renders <p>\${x}</p>\n    <main><p>x</p></main>\n</program>\n` },
    ], "app.scrml");
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.diags[0].message).toContain("is also declared in");
  });
  test("a library component's `#{}` is its scope in the consuming program's sheet", () => {
    const r = frontEnd(mods, [
      { path: "a.scrml", src: `export <card t:string/>\nrenders <div class="c">#{ .c { color: red; } }\${t}</div>\n` },
      { path: "app.scrml", src: `import { card } from "./a.scrml";\n<program>\n    <main><card t="a"/></main>\n</program>\n` },
    ], "app.scrml");
    expect(r.diags).toEqual([]);
    const html = mods.print.printProgram(r.core, "x.client.js", "scrml-runtime.js").html;
    expect(html).toContain('@scope ([data-scrml="card"]) to ([data-scrml]) {\n  :where(.c) { color: red; }\n}');
    expect(html).toContain('<div class="c" data-scrml="card">');
  });
});

describe("in the browser (happy-dom): the styles apply", () => {
  test("a component's scoped rule styles its own elements, not the page's, and not a nested component's (the donut)", async () => {
    const core = clean(P(`        <outer k="own"/>\n        <p class="hit" id="page">page</p>`, `    <inner k:string/>
    renders <div class="inner"><p class="hit" id="in">\${k}</p></div>
    <outer k:string/>
    renders <div class="outer">
        #{ .hit { color: green; } }
        <p class="hit" id="own">\${k}</p>
        <inner k="inner"/>
    </div>
`));
    await loadProgram(core, "css-donut", []);
    expect(color("#own")).toBe("green");
    expect(color("#in")).not.toBe("green");
    expect(color("#page")).not.toBe("green");
    expect($(".outer").getAttribute("data-scrml")).toBe("outer");
    expect($(".inner").getAttribute("data-scrml")).toBe("inner");
  });

  test("a flat block's inline style applies to the root", async () => {
    const core = clean(P(`        <chip label="x"/>`, `    <chip label:string/>\n    renders <span id="chip">#{ color: navy; }\${label}</span>\n`));
    await loadProgram(core, "css-flat", []);
    expect(color("#chip")).toBe("navy");
  });

  test("the program-global rules reach the page's stylesheet (happy-dom parses `@layer` but never applies it)", async () => {
    const core = clean(P(`        <p id="g">x</p>`, `    #{ #g { color: red; } }\n`));
    await loadProgram(core, "css-global", []);
    const style = document.querySelector("head style");
    expect(style).not.toBeNull();
    expect(style.textContent).toContain("@layer global {\n  #g { color: red; }\n}");
  });

  test("§25.7: the cell's value is on :root at mount and follows every write; a var() use resolves to it", async () => {
    const core = clean(P(`        <k t="a"/>\n        <button id="b" onclick=(@accent = "purple")>go</button>`,
      `    let <accent:string="teal"/>\n    <k t:string/>\n    renders <div>#{ .x { color: @accent; } }<p class="x" id="x">\${t}</p></div>\n`));
    await loadProgram(core, "css-bridge", []);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--scrml-accent")).toBe("teal");
    expect(color("#x")).toBe("teal");
    click($("#b"));
    expect(root.getPropertyValue("--scrml-accent")).toBe("purple");
    expect(color("#x")).toBe("purple");
  });
});

describe("§65.2.5 — a selector the browser would DROP is refused (fail loud), never shipped", () => {
  const G = (css) => `<program>\n    #{\n${css}\n    }\n    <main><p>x</p></main>\n</program>\n`;
  for (const [name, css, words] of [
    ["an unknown pseudo-class (`:hovr`)", `        a:hovr { color: red; }`, "`:hovr` is not a pseudo-class"],
    ["an unknown pseudo-element (`::befor`)", `        p::befor { content: "x"; }`, "`::befor` is not a pseudo-element"],
    ["an unparseable arm inside `:is()` (a forgiving list would hide it)", `        :is(.a, ..b) p { color: red; }`, "`:is(.a, ..b)`"],
    ["an unparseable arm inside `:not()`", `        p:not(#) { color: red; }`, "`:not(#)`"],
  ]) {
    test(name, () => {
      const d = only(G(css));
      expect(d.code).toBe("E-CSS-SYNTAX");
      expect(d.message).toContain(words);
    });
  }
  test("valid logical pseudos, a relative `:has()`, a CSS2 single-colon pseudo-element, a vendor pseudo, and a non-ASCII class all pass", () => {
    const core = clean(G(`        :is(h1, h2) > a:not(.x):hover, li:has(> img), p:first-line, input::-webkit-inner-spin-button, .café { color: red; }`));
    expect(author(sheetOf(core))).toContain(":is(h1, h2) > a:not(.x):hover, li:has(> img), p:first-line, input::-webkit-inner-spin-button, .café { color: red; }");
  });
  test("a `<` inside a CSS comment is harmless (comments never reach the sheet)", () => {
    const core = clean(G(`        /* <b> is bold */ p { color: red; /* <i> */ }`));
    expect(sheetOf(core)).not.toContain("<");
  });
});

describe("`@name` resolution — the nearest scope first", () => {
  test("in a component, `@x` names the component's own field before a program cell of the same name (refused: per-instance)", () => {
    const d = only(`<program>\n    <t:string="red"/>\n    <k t:string/>\n    renders <div>#{ .x { color: @t; } }</div>\n    <main><k t="a"/></main>\n</program>\n`);
    expect([d.code, d.at]).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "@t"]);
    expect(d.message).toContain("is a field of `<k>`");
  });
  test("a member path `@a.b` is refused by name (it would print `var(--scrml-a).b`)", () => {
    const d = only(`<program>\n    <a:string="red"/>\n    #{ p { color: @a.b; } }\n    <main><p>x</p></main>\n</program>\n`);
    expect([d.code, d.at]).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "@a.b"]);
  });
});
