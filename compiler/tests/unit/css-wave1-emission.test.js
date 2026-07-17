/**
 * CSS Wave-1 EMISSION — SPEC §65.3.2 / §65.3.4 / §65.6 / §65.2.5 / §25.7
 *
 * The emission half of CSS Wave-1 (the §65.2 conflict-CHECKER is tested
 * separately in conf-STYLE-CONFLICT + conformance/cases/style/*). Covers the
 * ratified `@`-SIGIL token model + the S239 cascade-correctness fixes:
 *
 *   1. <theme> token lowering (§65.3.2 / §65.6 / §25.7) — the `@` sigil.
 *        `@ink` → var(--ink); a BARE identifier (`red`, `bold`) is literal CSS,
 *        NEVER lowered (a token can't shadow a keyword). A non-theme `@cell` keeps
 *        the §25 reactive bridge (`var(--scrml-cell)`). `.Variant` → a reactive
 *        `:root[data-scrml-theme-<cell>="Variant"]` selector; `@media` → auto-bind.
 *        E-THEME-TOKEN-UNKNOWN is the decidable use-site check (an `@name` that is
 *        neither a theme token nor a declared cell) + the variant-rebind check
 *        against the GLOBAL base set.
 *   2. Built-in reset (§65.3.4) — `@layer reset` emitted FIRST (lowest layer);
 *        opt-out via `<program reset="none">`.
 *   3. `:where()`-flat wrapping (§65.2.5) — ONLY unconditional base arms are
 *        flattened; conditional (`:hover`/`[attr]`/`::before`) arms stay unwrapped
 *        (deterministic layers, §65.2.2); a comma-list wraps each arm individually.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  lowerCssValueRefs,
  wrapSelectorWhere,
  emitResetLayer,
  RESET_LAYER_CSS,
} from "../../src/codegen/emit-theme-reset.ts";
import { hoistCharsetAndImports } from "../../src/codegen/emit-css.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileCss(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-css-emit-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out") });
    const outputs = [...(r.outputs?.values() ?? [])];
    const css = outputs.map((o) => o.css ?? "").filter(Boolean).join("\n");
    return { css, errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasCode = (diags, code) => diags.some((d) => d.code === code);

/** A themed program with a component-scoped `#{}` that references tokens via `@`. */
const THEMED = `<program>
  <mode> = .Light
  <theme for=@mode>
      ink = #0f172a;
      bg  = #ffffff;
      .Dark {
          ink = #f8fafc;
          bg  = #0f172a;
      }
  </theme>
  const Card = <div props={}>
      #{
          .card { padding: 16px; color: @ink; background: @bg; }
      }
      <div class="card">hi</div>
  </>
  <Card/>
  <button onclick=(@mode = .Dark)>toggle</button>
</program>`;

// ---------------------------------------------------------------------------
// 1. <theme> token lowering — the `@` sigil (§65.3.2 / §65.6 / §25.7)
// ---------------------------------------------------------------------------

describe("§65.3.2 / §65.6 — <theme> token lowering (`@` sigil)", () => {
  test("base tokens lower to a :root custom-property block", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain(":root { --ink: #0f172a; --bg: #ffffff; }");
  });

  test("a .Variant re-bind lowers to a reactive named-variant :root selector", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain(`:root[data-scrml-theme-mode="Dark"] { --ink: #f8fafc; --bg: #0f172a; }`);
  });

  test("`@ink` lowers to var(--ink); a BARE identifier is literal CSS (never lowered)", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain("color: var(--ink)");
    expect(css).toContain("background: var(--bg)");
    expect(css).toContain("padding: 16px");
    // No accidental lowering of the bare form.
    expect(css).not.toContain("color: ink;");
    expect(css).not.toContain("color: @ink");
  });

  test("finding [5]: a token named `bold` never shadows `font-weight: bold`", () => {
    const { css, errors } = compileCss(`<program>
  <theme> bold = #ff0000; </theme>
  const Card = <div props={}>
      #{ .card { font-weight: bold; color: @bold; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(css).toContain("font-weight: bold;");        // literal keyword, untouched
    expect(css).toContain("color: var(--bold)");        // @bold → the token
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });

  test("@media auto-bind lowers to @media { :root { … } }", () => {
    const { css } = compileCss(`<program>
  <mode> = .Light
  <theme for=@mode>
      ink = #0f172a;
      @media (prefers-color-scheme: dark) { ink = #f8fafc; }
  </theme>
  const Card = <div props={}>
      #{ .card { color: @ink; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(css).toContain("@media (prefers-color-scheme: dark) { :root { --ink: #f8fafc; } }");
  });

  test("a non-theme program emits NO :root token block", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .card { color: red; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(css).not.toContain(":root");
  });
});

// ---------------------------------------------------------------------------
// E-THEME-TOKEN-UNKNOWN — decidable use-site + variant-rebind (§65.10)
// ---------------------------------------------------------------------------

describe("§65.10 — E-THEME-TOKEN-UNKNOWN", () => {
  test("use-site: `@name` matching no theme token / no cell fires (decidable)", () => {
    const { errors } = compileCss(`<program>
  const Card = <div props={}>
      #{ .card { color: @nope; background: red; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(true);
  });

  test("finding [7]: a variant re-binds a token with no base declaration", () => {
    const { errors } = compileCss(`<program>
  <mode> = .Light
  <theme for=@mode>
      ink = #0f172a;
      .Dark { ink = #f8fafc; ghost = #000000; }
  </theme>
  const Card = <div props={}>
      #{ .card { color: @ink; } }
      <div class="card">hi</div>
  </>
  <Card/>
  <button onclick=(@mode = .Dark)>x</button>
</program>`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(true);
  });

  test("finding [6]: base + variant SPLIT across two <theme> blocks is NOT falsely rejected", () => {
    const { css, errors } = compileCss(`<program>
  <mode> = .Light
  <theme for=@mode> ink = #0f172a; </theme>
  <theme for=@mode> .Dark { ink = #f8fafc; } </theme>
  const Card = <div props={}>
      #{ .card { color: @ink; } }
      <div class="card">hi</div>
  </>
  <Card/>
  <button onclick=(@mode = .Dark)>x</button>
</program>`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
    expect(css).toContain(`:root[data-scrml-theme-mode="Dark"] { --ink: #f8fafc; }`);
  });

  test("does NOT fire when every variant token is a base subset + refs resolve", () => {
    const { errors } = compileCss(THEMED);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Built-in reset layer (§65.3.4) — finding [1] order
// ---------------------------------------------------------------------------

describe("§65.3.4 — built-in reset layer", () => {
  test("finding [1]: the reset @layer is emitted FIRST (lowest layer)", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain("@layer reset {");
    expect(css).toContain("box-sizing: border-box;");
    // The reset layer precedes the :root token block (declared first = lowest layer).
    expect(css.indexOf("@layer reset")).toBeLessThan(css.indexOf(":root"));
  });

  test("<program reset=\"none\"> drops the whole reset layer", () => {
    const { css } = compileCss(`<program reset="none">
  const Card = <div props={}>
      #{ .card { color: red; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(css).not.toContain("@layer reset");
    expect(css).not.toContain("box-sizing: border-box");
  });

  test("emitResetLayer returns the frozen reset for a plain <program>, '' when opted out / no program", () => {
    const program = [{ kind: "markup", tag: "program", attrs: [], children: [] }];
    expect(emitResetLayer(program)).toBe(RESET_LAYER_CSS);
    const optOut = [{ kind: "markup", tag: "program", attrs: [{ name: "reset", value: { value: "none" } }], children: [] }];
    expect(emitResetLayer(optOut)).toBe("");
    expect(emitResetLayer([{ kind: "markup", tag: "div", children: [] }])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. :where()-flat wrapping (§65.2.5) — findings [0] + [4]
// ---------------------------------------------------------------------------

describe("§65.2.5 — :where()-flat wrapping", () => {
  test("unconditional base selectors (class + tag) are :where()-wrapped", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .card { color: red; } .title { font-weight: 600; } }
      <div class="card"><span class="title">hi</span></div>
  </>
  <Card/>
</program>`);
    expect(css).toContain(":where(.card) {");
    expect(css).toContain(":where(.title) {");
  });

  test("finding [4]: conditional / state selectors stay UNWRAPPED (deterministic layers)", () => {
    const { css } = compileCss(`<program>
  const Btn = <button props={}>
      #{ .btn { color: green; } .btn:hover { color: blue; } .btn[disabled] { color: gray; } }
      <button class="btn">go</button>
  </>
  <Btn/>
</program>`);
    expect(css).toContain(":where(.btn) {");     // base flattened
    expect(css).toContain(".btn:hover {");        // hover NOT flattened (keeps specificity)
    expect(css).not.toContain(":where(.btn:hover)");
    expect(css).toContain(".btn[disabled] {");    // attribute NOT flattened
    expect(css).not.toContain(":where(.btn[disabled])");
  });

  test("finding [0]: a comma-list wraps each arm individually", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .a, .b::before { color: red; } }
      <div class="a">hi</div>
  </>
  <Card/>
</program>`);
    // `.a` flattened, `.b::before` (pseudo-element) stays unwrapped — per arm.
    expect(css).toContain(":where(.a), .b::before {");
  });

  test("finding [2]: a component scope rule beats a program-global rule via @layer", () => {
    const { css } = compileCss(`<program>
  #{ a { color: red; } }
  const Link = <a props={}>
      #{ .link { color: green; } }
      <a class="link">hi</a>
  </>
  <Link/>
</program>`);
    // The layer-order declaration + the program-global `@layer global` block.
    expect(css).toContain("@layer reset, global;");
    expect(css).toContain("@layer global {");
    expect(css).toContain("a { color: red; }");
    // The component scope rule is UNLAYERED (beats the program-global @layer).
    expect(css).toContain(":where(.link) { color: green; }");
    // The program-global block is a lower layer than the (unlayered) component scope.
    expect(css.indexOf("@layer global")).toBeLessThan(css.indexOf("@scope"));
  });

  test("wrapSelectorWhere: unit — never :is(); per-arm pseudo/attr/pseudo-element rules stay unwrapped", () => {
    expect(wrapSelectorWhere(".card")).toBe(":where(.card)");
    expect(wrapSelectorWhere(".a > .b")).toBe(":where(.a > .b)");
    expect(wrapSelectorWhere(".card:hover")).toBe(".card:hover");
    expect(wrapSelectorWhere(".card[busy]")).toBe(".card[busy]");
    expect(wrapSelectorWhere(".card::before")).toBe(".card::before");
    expect(wrapSelectorWhere(".a, .b::before")).toBe(":where(.a), .b::before");
    expect(wrapSelectorWhere(".card")).not.toContain(":is(");
  });
});

// ---------------------------------------------------------------------------
// lowerCssValueRefs — the `@`-sigil rewriter (unit)
// ---------------------------------------------------------------------------

describe("§25.7 — lowerCssValueRefs", () => {
  const theme = new Set(["ink", "bg", "space-4"]);
  const cells = new Set(["accent"]);

  test("`@token` → var(--token); bare identifiers untouched", () => {
    expect(lowerCssValueRefs("@ink", theme, cells)).toBe("var(--ink)");
    expect(lowerCssValueRefs("red", theme, cells)).toBe("red");
    expect(lowerCssValueRefs("bold", theme, cells)).toBe("bold");
    expect(lowerCssValueRefs("1px solid @ink", theme, cells)).toBe("1px solid var(--ink)");
    expect(lowerCssValueRefs("@space-4", theme, cells)).toBe("var(--space-4)");
  });

  test("a non-theme `@cell` keeps the §25 reactive bridge (var(--scrml-cell))", () => {
    expect(lowerCssValueRefs("@accent", theme, cells)).toBe("var(--scrml-accent)");
  });

  test("an unknown `@name` (no theme / no cell) fires E-THEME-TOKEN-UNKNOWN", () => {
    const errors = [];
    lowerCssValueRefs("@nope", theme, cells, errors);
    expect(errors.some((e) => e.code === "E-THEME-TOKEN-UNKNOWN")).toBe(true);
  });

  test("no `@` → the value is returned verbatim (no scan)", () => {
    expect(lowerCssValueRefs("16px", theme, cells)).toBe("16px");
    expect(lowerCssValueRefs("#0f172a", theme, cells)).toBe("#0f172a");
  });
});

// ---------------------------------------------------------------------------
// TASK 1 [399] — @import / @charset must not be trapped in @layer global {}
// (§65.8 / CSS ordering law)
// ---------------------------------------------------------------------------

describe("§65.8 — @charset / @import hoist out of @layer global {}", () => {
  test("a program-global @import is emitted at top level, NOT inside @layer global", () => {
    const { css } = compileCss(`<program>
  #{ @import url("x.css"); a { color: red; } }
  const Card = <div props={}>
      #{ .card { color: green; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    // The @import is hoisted above the @layer global {} block.
    expect(css).toContain(`@import url("x.css");`);
    // The rest of the program-global rules stay in @layer global.
    expect(css).toContain("@layer global {");
    expect(css).toContain("a { color: red; }");
    // The @import is NOT trapped inside @layer global {} — it precedes it.
    expect(css.indexOf(`@import url("x.css");`)).toBeLessThan(css.indexOf("@layer global {"));
    // And the @layer global block body no longer carries the @import.
    const layerBody = css.slice(css.indexOf("@layer global {"));
    expect(layerBody).not.toContain("@import");
  });

  test("@charset is byte 0; @import follows the @layer name; order decl; both precede any block", () => {
    const { css } = compileCss(`<program>
  #{ @charset "utf-8"; @import url("a.css"); @import url("b.css"); a { color: red; } }
  const Card = <div props={}>
      #{ .card { color: green; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    // @charset is the very first thing in the stylesheet.
    expect(css.startsWith(`@charset "utf-8";`)).toBe(true);
    // Order: @charset < @layer reset, global; < @import < any @layer {} block.
    const iCharset = css.indexOf("@charset");
    const iOrderDecl = css.indexOf("@layer reset, global;");
    const iImportA = css.indexOf(`@import url("a.css");`);
    const iImportB = css.indexOf(`@import url("b.css");`);
    const iResetBlock = css.indexOf("@layer reset {");
    expect(iCharset).toBeLessThan(iOrderDecl);
    expect(iOrderDecl).toBeLessThan(iImportA);
    // Source order among the imports is preserved.
    expect(iImportA).toBeLessThan(iImportB);
    // Both imports precede any @layer {} block.
    expect(iImportB).toBeLessThan(iResetBlock);
  });

  test("hoistCharsetAndImports — unit: extracts depth-0 statements, leaves nested + rules", () => {
    const r = hoistCharsetAndImports(`@charset "utf-8"; @import url("x.css"); a { color: red; } .b { background: url("y.png"); }`);
    expect(r.charset).toEqual([`@charset "utf-8";`]);
    expect(r.imports).toEqual([`@import url("x.css");`]);
    // The remaining rules keep their `url()` values (not mistaken for @import).
    expect(r.rest).toContain("a { color: red; }");
    expect(r.rest).toContain(`.b { background: url("y.png"); }`);
    expect(r.rest).not.toContain("@import");
    expect(r.rest).not.toContain("@charset");
  });

  test("hoistCharsetAndImports — unit: an @import nested in @media is NOT hoisted", () => {
    const r = hoistCharsetAndImports(`@media screen { @import url("nested.css"); } a { color: red; }`);
    expect(r.imports).toEqual([]);
    expect(r.rest).toContain(`@media screen { @import url("nested.css"); }`);
  });
});

// ---------------------------------------------------------------------------
// TASK 2 [86] — flat-inline #{} token lowering (the dominant #{} pattern)
// (§65.3.2 / §65.4 — a flat #{} child of a component root → inline style="")
// ---------------------------------------------------------------------------

/**
 * The dominant corpus pattern: a flat-declaration `#{}` (bare prop:value, no
 * selectors) as a direct child of a component root element compiles to an
 * inline `style=""` attribute (DQ-7). Wave-1 must run the `@`-sigil token
 * lowering there too, not only on the selector path.
 */
function compileHtml(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-css-html-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, outputDir: join(dir, "out") });
    const outputs = [...(r.outputs?.values() ?? [])];
    const html = outputs.map((o) => o.html ?? "").filter(Boolean).join("\n");
    return { html, errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("§65.3.2 / §65.4 — flat-inline #{} token lowering (inline style)", () => {
  test("a flat-inline `@brand` lowers to var(--brand); a bare value is untouched", () => {
    const { html, errors } = compileHtml(`<program>
  <theme> brand = #2563eb; </theme>
  const Card = <div props={}>
      #{ color: @brand; padding: 16px; }
      hi
  </>
  <Card/>
</program>`);
    expect(html).toContain(`style="color: var(--brand); padding: 16px;"`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });

  test("a flat-inline unknown `@nope` fires E-THEME-TOKEN-UNKNOWN (same as the selector path)", () => {
    const { errors } = compileHtml(`<program>
  <theme> brand = #2563eb; </theme>
  const Card = <div props={}>
      #{ color: @nope; }
      hi
  </>
  <Card/>
</program>`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(true);
  });

  test("a flat-inline non-theme `@cell` keeps the §25 reactive bridge (var(--scrml-cell))", () => {
    const { html, errors } = compileHtml(`<program>
  <accent> = "#ff0000"
  const Card = <div props={}>
      #{ color: @accent; }
      hi
  </>
  <Card/>
</program>`);
    expect(html).toContain("var(--scrml-accent)");
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });

  test("a flat-inline with only bare values (no `@`) is byte-identical (untouched)", () => {
    const { html, errors } = compileHtml(`<program>
  const Card = <div props={}>
      #{ color: red; padding: 16px; }
      hi
  </>
  <Card/>
</program>`);
    expect(html).toContain(`style="color: red; padding: 16px;"`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — descendant-combinator SPACE collapse in component-scope selectors
// (pre-existing silent MISCOMPILE — normalizeTokenizedRaw collapsed the space)
// ---------------------------------------------------------------------------

describe("§65.2.5 — component-scope descendant combinator preservation", () => {
  test("a component `.card .title` stays a DESCENDANT selector (space preserved), :where()-wrapped", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .card .title { color: red; } }
      <div class="card"><span class="title">hi</span></div>
  </>
  <Card/>
</program>`);
    // Descendant space survives → :where(.card .title), NOT the compound :where(.card.title).
    expect(css).toContain(":where(.card .title) {");
    expect(css).not.toContain(":where(.card.title)");
  });

  test("a component compound `.card.title` (no space) stays COMPOUND (surgical — not touched)", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .card.title { color: red; } }
      <div class="card title">hi</div>
  </>
  <Card/>
</program>`);
    // No space in source → stays compound.
    expect(css).toContain(":where(.card.title) {");
    expect(css).not.toContain(":where(.card .title)");
  });

  test("a component child combinator `.a > .b` keeps its combinator (not collapsed)", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{ .a > .b { color: red; } }
      <div class="a"><span class="b">hi</span></div>
  </>
  <Card/>
</program>`);
    expect(css).toContain(":where(.a > .b) {");
  });

  test("a component #{} with a theme token in a descendant rule lowers AND keeps the space", () => {
    const { css } = compileCss(`<program>
  <theme> brand = #2563eb; </theme>
  const Card = <div props={}>
      #{ .card .title { color: @brand; } }
      <div class="card"><span class="title">hi</span></div>
  </>
  <Card/>
</program>`);
    expect(css).toContain(":where(.card .title) { color: var(--brand); }");
  });
});
