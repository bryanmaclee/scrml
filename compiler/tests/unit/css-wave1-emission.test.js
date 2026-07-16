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
