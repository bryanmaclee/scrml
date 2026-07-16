/**
 * CSS Wave-1 EMISSION — SPEC §65.3.2 / §65.3.4 / §65.6 / §65.2.5 / §25.7
 *
 * The emission half of CSS Wave-1 (the §65.2 conflict-CHECKER is tested
 * separately in conf-STYLE-CONFLICT + conformance/cases/style/*). Covers:
 *
 *   1. <theme> token lowering (§65.3.2 / §65.6 / §25.7)
 *        base tokens        → `:root { --name: value }`
 *        use-site `color: ink` → `color: var(--ink)` (a non-token literal is
 *                                left untouched)
 *        `.Variant { … }`   → `:root[data-scrml-theme-<cell>="Variant"] { … }`
 *        `@media (…) { … }`  → `@media (…) { :root { … } }`
 *        E-THEME-TOKEN-UNKNOWN on a variant-only token (no base)
 *   2. Built-in reset (§65.3.4) — `@layer reset` present by default,
 *        opt-out via `<program reset="none">`
 *   3. `:where()`-flat wrapping (§65.2.5) of component-scope author selectors
 *
 * Emission is inspected end-to-end through the real pipeline (compileScrml →
 * result.outputs.get(file).css) so CE / theme-parse / codegen all execute.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  lowerTokenRefsInValue,
  wrapSelectorWhere,
  emitResetLayer,
  RESET_LAYER_CSS,
} from "../../src/codegen/emit-theme-reset.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile a source string through the full pipeline; return { css, errors, warnings }. */
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

/** A themed program with a component-scoped `#{}` that references tokens. */
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
          .card { padding: 16px; color: ink; background: bg; }
      }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`;

// ---------------------------------------------------------------------------
// 1. <theme> token lowering (§65.3.2 / §65.6 / §25.7)
// ---------------------------------------------------------------------------

describe("§65.3.2 / §65.6 — <theme> token lowering", () => {
  test("base tokens lower to a :root custom-property block", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain(":root { --ink: #0f172a; --bg: #ffffff; }");
  });

  test("a .Variant re-bind lowers to a reactive named-variant :root selector", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain(`:root[data-scrml-theme-mode="Dark"] { --ink: #f8fafc; --bg: #0f172a; }`);
  });

  test("a use-site token reference lowers to var(--token), a literal is untouched", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain("color: var(--ink)");
    expect(css).toContain("background: var(--bg)");
    // The literal `16px` padding is NOT a token — passes through unchanged.
    expect(css).toContain("padding: 16px");
    expect(css).not.toContain("color: ink;");
    expect(css).not.toContain("background: bg;");
  });

  test("@media auto-bind lowers to @media { :root { … } }", () => {
    const { css } = compileCss(`<program>
  <mode> = .Light
  <theme for=@mode>
      ink = #0f172a;
      @media (prefers-color-scheme: dark) {
          ink = #f8fafc;
      }
  </theme>
  const Card = <div props={}>
      #{ .card { color: ink; } }
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
// E-THEME-TOKEN-UNKNOWN (§65.10) — the decidable variant-rebind case
// ---------------------------------------------------------------------------

describe("§65.10 — E-THEME-TOKEN-UNKNOWN", () => {
  test("fires when a variant re-binds a token with no base declaration", () => {
    const { errors } = compileCss(`<program>
  <mode> = .Light
  <theme for=@mode>
      ink = #0f172a;
      .Dark {
          ink = #f8fafc;
          ghost = #000000;
      }
  </theme>
  const Card = <div props={}>
      #{ .card { color: ink; } }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(true);
  });

  test("does NOT fire when every variant token is a base subset", () => {
    const { errors } = compileCss(THEMED);
    expect(hasCode(errors, "E-THEME-TOKEN-UNKNOWN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Built-in reset layer (§65.3.4)
// ---------------------------------------------------------------------------

describe("§65.3.4 — built-in reset layer", () => {
  test("a program emits the reset in a bottom @layer reset by default", () => {
    const { css } = compileCss(THEMED);
    expect(css).toContain("@layer reset {");
    expect(css).toContain("box-sizing: border-box;");
    expect(css).toContain("min-height: 100vh;");
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

  test("emitResetLayer returns the frozen reset for a plain <program>", () => {
    const nodes = [{ kind: "markup", tag: "program", attrs: [], children: [] }];
    expect(emitResetLayer(nodes)).toBe(RESET_LAYER_CSS);
  });

  test("emitResetLayer returns '' when reset=none, and '' when no <program>", () => {
    const optOut = [{ kind: "markup", tag: "program", attrs: [{ name: "reset", value: { value: "none" } }], children: [] }];
    expect(emitResetLayer(optOut)).toBe("");
    expect(emitResetLayer([{ kind: "markup", tag: "div", children: [] }])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. :where()-flat wrapping (§65.2.5)
// ---------------------------------------------------------------------------

describe("§65.2.5 — :where()-flat wrapping", () => {
  test("component-scope author selectors are :where()-wrapped", () => {
    const { css } = compileCss(`<program>
  const Card = <div props={}>
      #{
          .card { color: red; }
          .card:hover { color: blue; }
      }
      <div class="card">hi</div>
  </>
  <Card/>
</program>`);
    expect(css).toContain(":where(.card) {");
    expect(css).toContain(":where(.card:hover) {");
  });

  test("wrapSelectorWhere never emits :is(); a pseudo-element stays unwrapped", () => {
    expect(wrapSelectorWhere(".card")).toBe(":where(.card)");
    expect(wrapSelectorWhere(".a > .b")).toBe(":where(.a > .b)");
    expect(wrapSelectorWhere(".card:hover")).toBe(":where(.card:hover)");
    // Pseudo-element rules are emitted UNWRAPPED (:where(::before) matches nothing).
    expect(wrapSelectorWhere(".card::before")).toBe(".card::before");
    expect(wrapSelectorWhere("::before")).toBe("::before");
    // NEVER :is().
    expect(wrapSelectorWhere(".card")).not.toContain(":is(");
  });
});

// ---------------------------------------------------------------------------
// lowerTokenRefsInValue — the conservative whole-identifier rewriter
// ---------------------------------------------------------------------------

describe("§25.7 — lowerTokenRefsInValue", () => {
  const toks = new Set(["ink", "bg", "line", "space-4"]);

  test("rewrites a whole-identifier token, leaves non-tokens alone", () => {
    expect(lowerTokenRefsInValue("ink", toks)).toBe("var(--ink)");
    expect(lowerTokenRefsInValue("red", toks)).toBe("red");
  });

  test("rewrites a token embedded mid-value, keeps the rest", () => {
    expect(lowerTokenRefsInValue("1px solid line", toks)).toBe("1px solid var(--line)");
    expect(lowerTokenRefsInValue("space-4", toks)).toBe("var(--space-4)");
  });

  test("never touches a hex color, an existing custom property, or a longer ident", () => {
    expect(lowerTokenRefsInValue("#0f172a", toks)).toBe("#0f172a");
    expect(lowerTokenRefsInValue("var(--ink)", toks)).toBe("var(--ink)");
    // `line-height` is a longer maximal ident — NOT the `line` token.
    expect(lowerTokenRefsInValue("line-height", toks)).toBe("line-height");
  });

  test("does not rewrite a function name, but does rewrite a token argument", () => {
    // `rgb` is a function name (followed by `(`) — untouched.
    expect(lowerTokenRefsInValue("rgb(0, 0, 0)", toks)).toBe("rgb(0, 0, 0)");
    // A token inside calc() IS rewritten.
    expect(lowerTokenRefsInValue("calc(space-4 * 2)", toks)).toBe("calc(var(--space-4) * 2)");
  });

  test("copies url() contents verbatim", () => {
    expect(lowerTokenRefsInValue("url(ink/bg.png)", toks)).toBe("url(ink/bg.png)");
  });

  test("no-op when the token set is empty", () => {
    expect(lowerTokenRefsInValue("ink", new Set())).toBe("ink");
  });
});
