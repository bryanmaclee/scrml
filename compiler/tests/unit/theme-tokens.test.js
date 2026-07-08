/**
 * `<theme>` tokens + reactive theming — Phase A (recognition + typer) unit tests.
 *
 * SPEC §65.3.2 (token block) + §65.6 (reactive theming — the `for=@cell` variant
 * binding + bare-variant inference §14.10) + §65.9 (structural-element reclamation).
 *
 * Phase A scope (this file):
 *   RECOGNITION  `<theme for=@cell> … </theme>` parses to a `theme-decl` AST node
 *                (base `name = value;` tokens + `.Variant { … }` sub-blocks +
 *                `@media (…) { … }` auto-bind) — no parse / E-CTX errors.
 *   PARSER       parseThemeBody splits the body into baseTokens / variants /
 *                mediaBinds correctly (direct unit tests).
 *   TYPER        `<mode> = .Light` bound by `<theme for=@mode>` infers its variant
 *                type from the theme (no spurious E-VARIANT-AMBIGUOUS); downstream
 *                `@mode == .Dark` / `@mode = .Dark` resolve; a non-variant reassign
 *                is E-TYPE-063; a bare variant with NO `<theme for=>` stays ambiguous.
 *
 * Phase B (emit-css lowering → `:root` custom properties, use-site `color: brand`
 * → `var(--brand)`, E-THEME-TOKEN-UNKNOWN, reactive `@mode` switching) is a
 * follow-on and is NOT exercised here.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { parseThemeBody, parseTokenBindings } from "../../src/theme-body-parser.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-theme-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    return { errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const codes = (diags) => diags.map((d) => d.code);
const has = (diags, code) => diags.some((d) => d.code === code);

/** Deep-find every AST node of a given `kind`. */
function findKind(nodes, kind, acc = []) {
  for (const n of nodes || []) {
    if (!n || typeof n !== "object") continue;
    if (n.kind === kind) acc.push(n);
    for (const k of ["body", "children", "bodyChildren", "branches", "nodes"]) {
      if (Array.isArray(n[k])) findKind(n[k], kind, acc);
    }
  }
  return acc;
}

/** Build the AST for a source and return all `theme-decl` nodes. */
function themeDecls(source) {
  const bs = splitBlocks("t.scrml", source);
  const out = buildAST(bs);
  const nodes = out.ast?.nodes ?? out.nodes ?? [];
  return findKind(Array.isArray(nodes) ? nodes : [], "theme-decl");
}

// ---------------------------------------------------------------------------
// RECOGNITION — `<theme>` block → theme-decl AST node
// ---------------------------------------------------------------------------

describe("§65.3.2/§65.6 RECOGNITION — <theme> structural element", () => {
  test("`<theme for=@mode>` builds a theme-decl node with forCell + tokens + variants + media", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    brand = #2563eb;
    ink   = #0f172a;
    paper = #ffffff;
    .Dark { ink = #e2e8f0; paper = #0f172a; }
    @media (prefers-color-scheme: dark) { ink = #e2e8f0; }
  </theme>
  <div>hi</div>
</program>`;
    const decls = themeDecls(src);
    expect(decls.length).toBe(1);
    const t = decls[0];
    expect(t.forCell).toBe("mode");
    expect(t.baseTokens.map((x) => `${x.name}=${x.value}`)).toEqual([
      "brand=#2563eb", "ink=#0f172a", "paper=#ffffff",
    ]);
    expect(t.variants.length).toBe(1);
    expect(t.variants[0].variant).toBe("Dark");
    expect(t.variants[0].tokens.map((x) => x.name)).toEqual(["ink", "paper"]);
    expect(t.mediaBinds.length).toBe(1);
    expect(t.mediaBinds[0].condition).toBe("(prefers-color-scheme: dark)");
  });

  test("`<theme>` with NO for= binds no cell (forCell null), still recognized", () => {
    const src = `<program>
  <theme>
    brand = #2563eb;
  </theme>
  <div>hi</div>
</program>`;
    const decls = themeDecls(src);
    expect(decls.length).toBe(1);
    expect(decls[0].forCell).toBeNull();
    expect(decls[0].baseTokens.map((x) => x.name)).toEqual(["brand"]);
  });

  test("a `<theme for=@mode>` program compiles with no parse / context errors", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    ink = #0f172a;
    .Dark { ink = #e2e8f0; }
  </theme>
  <button onclick=(@mode = .Dark)>toggle</button>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-CTX-001")).toBe(false);
    expect(has(errors, "E-CTX-003")).toBe(false);
    expect(has(errors, "E-SYNTAX-002")).toBe(false);
    expect(has(errors, "E-STRUCTURAL-ELEMENT-MISPLACED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PARSER — parseThemeBody
// ---------------------------------------------------------------------------

describe("§65.3.2 parseThemeBody — token grammar", () => {
  test("splits base tokens, a variant sub-block, and a media auto-bind", () => {
    const raw = `
      brand   = #2563eb;
      space-4 = 1rem;
      .Dark { ink = #e2e8f0; paper = #0f172a; }
      @media (prefers-color-scheme: dark) { ink = #e2e8f0; }
    `;
    const b = parseThemeBody(raw);
    expect(b.baseTokens.map((t) => [t.name, t.value])).toEqual([
      ["brand", "#2563eb"], ["space-4", "1rem"],
    ]);
    expect(b.variants.map((v) => v.variant)).toEqual(["Dark"]);
    expect(b.variants[0].tokens.map((t) => t.name)).toEqual(["ink", "paper"]);
    expect(b.mediaBinds[0].condition).toBe("(prefers-color-scheme: dark)");
    expect(b.mediaBinds[0].tokens.map((t) => t.name)).toEqual(["ink"]);
    expect(b.malformed).toEqual([]);
  });

  test("token names allow hyphens; values may carry a function call with a `;`-free body", () => {
    const b = parseThemeBody(`accent = rgb(37, 99, 235); radius-2 = 8px;`);
    expect(b.baseTokens.map((t) => [t.name, t.value])).toEqual([
      ["accent", "rgb(37, 99, 235)"], ["radius-2", "8px"],
    ]);
  });

  test("line + block comments are ignored", () => {
    const b = parseThemeBody(`
      // the brand color
      brand = #2563eb;   /* inline */
      ink = #0f172a;
    `);
    expect(b.baseTokens.map((t) => t.name)).toEqual(["brand", "ink"]);
  });

  test("parseTokenBindings reads a flat run of bindings", () => {
    const toks = parseTokenBindings(`ink = #e2e8f0; paper = #0f172a;`);
    expect(toks.map((t) => [t.name, t.value])).toEqual([
      ["ink", "#e2e8f0"], ["paper", "#0f172a"],
    ]);
  });

  test("spans point back into the source via baseOffset/baseLine", () => {
    const b = parseThemeBody(`\n  brand = #2563eb;`, 100, 5, 1, "x.scrml");
    expect(b.baseTokens[0].span.file).toBe("x.scrml");
    expect(b.baseTokens[0].span.line).toBe(6);
    expect(b.baseTokens[0].span.start).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// TYPER — §65.6 variant inference from for= (bare-variant inference §14.10)
// ---------------------------------------------------------------------------

describe("§65.6 TYPER — variant inference from `<theme for=@cell>`", () => {
  test("bare `<mode> = .Light` bound by `<theme for=@mode>` does NOT fire E-VARIANT-AMBIGUOUS", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    ink = #0f172a;
    .Dark { ink = #e2e8f0; }
  </theme>
  <button onclick=(@mode = .Dark)>toggle</button>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-VARIANT-AMBIGUOUS")).toBe(false);
    expect(has(errors, "E-TYPE-063")).toBe(false);
  });

  test("downstream `@mode == .Dark` comparison resolves against the theme's variant set", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    ink = #0f172a;
    .Dark { ink = #e2e8f0; }
  </theme>
  <p class:on=(@mode == .Dark)>x</p>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-VARIANT-AMBIGUOUS")).toBe(false);
  });

  test("reassigning to a NON-declared variant is E-TYPE-063 (checked against the theme set)", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    ink = #0f172a;
    .Dark { ink = #e2e8f0; }
  </theme>
  <button onclick=(@mode = .Nonexistent)>x</button>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-TYPE-063")).toBe(true);
  });

  test("a theme with NO variant sub-blocks still types the base (single-variant) cell", () => {
    const src = `<program>
  <mode> = .Light
  <theme for=@mode>
    ink = #0f172a;
  </theme>
  <button onclick=(@mode = .Light)>x</button>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-VARIANT-AMBIGUOUS")).toBe(false);
  });

  test("a bare `.Light` with NO `<theme for=>` binding STILL fires E-VARIANT-AMBIGUOUS (no context)", () => {
    const src = `<program>
  <mode> = .Light
  <p>x</p>
</program>`;
    const { errors } = compileSource(src);
    expect(has(errors, "E-VARIANT-AMBIGUOUS")).toBe(true);
  });

  test("the theme's `for=` binds ONLY its named cell — a different bare cell stays ambiguous", () => {
    const src = `<program>
  <mode> = .Light
  <other> = .Big
  <theme for=@mode>
    ink = #0f172a;
    .Dark { ink = #e2e8f0; }
  </theme>
  <p>x</p>
</program>`;
    const { errors } = compileSource(src);
    // @other has no theme binding → its bare `.Big` is still ambiguous.
    expect(has(errors, "E-VARIANT-AMBIGUOUS")).toBe(true);
  });
});
