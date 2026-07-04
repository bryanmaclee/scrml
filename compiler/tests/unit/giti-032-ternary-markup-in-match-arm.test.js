/**
 * giti-032-ternary-markup-in-match-arm.test.js — regression gate for GITI-032.
 *
 * BUG: a `${ cond ? <markup> : "" }` interpolation (a ternary whose CONSEQUENT
 * is markup-as-value, Pillar 1 §1.4/§7.4) works at TOP LEVEL (landed S201,
 * `g-markup-value-ternary-fnreturn-codegen`) but was BROKEN inside a `<match>`
 * arm body: the emitted client.js showed `cond ? : ""` — the markup consequent
 * was DROPPED, failing the E-CODEGEN-INVALID-LOGIC gate.
 *
 * ROOT CAUSE: the `<match>` arm bare-body re-parse routes through the native
 * parser (`nativeParseFile`). The native parser DID recognize the markup in
 * expression position (`ExprKind.MarkupValue`), but the native→live AST bridge
 * (native-parser/translate-expr.js) translated it to an EMPTY escape-hatch
 * (`makeEscapeHatch("MarkupValue", "", span)`) — dropping the markup body.
 *
 * FIX: translate-expr.js MarkupValue case now builds the LIVE `markup-value`
 * ExprNode (`{kind:"markup-value", node}`) via translate-stmt.js's M6.2a bridge
 * `translateMarkupValueToLiveNode` (the SAME conversion the lift-expr markup path
 * uses). emit-expr.ts `case "markup-value"` then lowers it to a real DOM-node
 * IIFE (emit-lift.js `emitMarkupValueExpr`). Coupled: the arm-body interpolation
 * DISPLAY (emit-variant-guard.ts `wireableLogic` loop) now routes through the
 * node-aware `_scrml_render_value(el, v)` runtime helper (parity with the
 * top-level S201 path) — a bare `el.textContent =` would stringify a DOM node to
 * "[object HTMLParagraphElement]".
 *
 * This file asserts the CODEGEN SHAPE (no E-CODEGEN-INVALID-LOGIC, the consequent
 * markup IIFE present, node-aware display wiring). The same root class lowered
 * the top-level control in g-markup-value-in-expression.test.js.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToClient(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const SINGLE = [
  "<program>",
  "type P:enum = { Loading  Loaded(d: string) }",
  "<x> = P.Loading",
  "<div>",
  "  <match for=P on=@x>",
  "    <Loading><p>loading</p></Loading>",
  '    <Loaded(d)>${ d == "yes" ? <p>SHOWN</p> : "" }</Loaded>',
  "  </match>",
  "</div>",
  "</program>",
].join("\n");

const MULTI = [
  "<program>",
  "type P:enum = { Loading  Loaded(d: string) }",
  "<x> = P.Loading",
  "<div>",
  "  <match for=P on=@x>",
  "    <Loading><p>loading</p></Loading>",
  "    <Loaded(d)>",
  '      ${ d == "a" ? <p>A</p> : "" }',
  '      ${ d == "b" ? <p>B</p> : "" }',
  '      ${ d == "c" ? <p>C</p> : "" }',
  "    </Loaded>",
  "  </match>",
  "</div>",
  "</program>",
].join("\n");

describe("GITI-032 — ternary-returning-markup inside a <match> arm body", () => {
  test("single block: no E-CODEGEN-INVALID-LOGIC; the markup consequent is present (not a dropped `? : `)", () => {
    const { errors, clientJs } = compileToClient(SINGLE, "giti032-single");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    // The smoking gun was `_scrml_structural_eq(d, "yes") ? : ""` — the consequent
    // GONE. Assert it is NOT present and the markup IIFE consequent IS.
    expect(clientJs).not.toMatch(/\?\s*:\s*""/);
    expect(clientJs).toContain('createElement("p")');
    expect(clientJs).toContain('document.createTextNode("SHOWN")');
  });

  test("single block: arm-body display routes through node-aware _scrml_render_value", () => {
    const { clientJs } = compileToClient(SINGLE, "giti032-single-render");
    // The arm-body `${...}` display must use the node-aware helper (a DOM node
    // is the ternary consequent value), NOT a bare `el.textContent =`.
    expect(clientJs).toMatch(/_scrml_render_value\(el,\s*_scrml_structural_eq\(d,\s*"yes"\)\s*\?/);
    expect(clientJs).not.toMatch(/el\.textContent\s*=\s*_scrml_structural_eq/);
  });

  test("multiple blocks in one arm: no E-CODEGEN-INVALID-LOGIC; all three consequents present (not whitespace-only)", () => {
    const { errors, clientJs } = compileToClient(MULTI, "giti032-multi");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(clientJs).not.toMatch(/\?\s*:\s*""/);
    expect(clientJs).toContain('document.createTextNode("A")');
    expect(clientJs).toContain('document.createTextNode("B")');
    expect(clientJs).toContain('document.createTextNode("C")');
  });

  test("the markup-value IIFE is emitted inside the arm wire fn (render_Loaded body is not empty)", () => {
    const { clientJs } = compileToClient(SINGLE, "giti032-wire");
    // The wire fn for the Loaded arm carries the markup-value IIFE.
    expect(clientJs).toMatch(/function\s+\(\s*\)\s*\{[\s\S]*createElement\("p"\)/);
  });
});

// ---------------------------------------------------------------------------
// Shared-helper coverage: an <engine> state-child arm body has the SAME class.
//
// The <engine> state-child bare body does NOT route through emit-match's
// nativeParseFile re-parse — it uses the structural children directly. The
// structural parser (ast-builder parseLogicBody) was lowering a markup-bearing
// `${...}` interpolation to a raw `html-fragment` (isHtmlFragment fired on the
// tokenizer-spaced `< / p >`), so the arm rendered EMPTY (`render_Loaded`
// returns ""). The fix adds a markup-value-bearing gate: a `${...}` whose expr
// leads with a JS expression (not `<`) and parses to a markup-value-bearing
// ExprNode routes to bare-expr (the markup-value lowering), bringing the engine
// path to match-path parity. The shared DISPLAY mechanism (emit-variant-guard
// _scrml_render_value) already covers both surfaces.
// ---------------------------------------------------------------------------

const ENGINE = [
  "<program>",
  "type P:enum = { Loading  Loaded(d: string) }",
  "<div>",
  "  <engine for=P initial=.Loading>",
  "    <Loading><p>loading</p></Loading>",
  '    <Loaded(d)>${ d == "yes" ? <p>SHOWN</p> : "" }</Loaded>',
  "  </engine>",
  "</div>",
  "</program>",
].join("\n");

describe("GITI-032 — engine state-child arm body (shared-helper parity)", () => {
  test("no E-CODEGEN-INVALID-LOGIC; the markup consequent is present (not an empty render fn)", () => {
    const { errors, clientJs } = compileToClient(ENGINE, "giti032-engine");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(clientJs).not.toMatch(/\?\s*:\s*""/);
    expect(clientJs).toContain('createElement("p")');
    expect(clientJs).toContain('document.createTextNode("SHOWN")');
    // The Loaded render fn must carry a render slot (NOT `return "";`).
    expect(clientJs).not.toMatch(/_render_Loaded\([^)]*\)\s*\{\s*return\s*"";\s*\}/);
  });

  test("engine arm-body display routes through node-aware _scrml_render_value", () => {
    const { clientJs } = compileToClient(ENGINE, "giti032-engine-render");
    expect(clientJs).toMatch(/_scrml_render_value\(el,\s*_scrml_structural_eq\(d,\s*"yes"\)\s*\?/);
  });
});

// ---------------------------------------------------------------------------
// markup-as-value in an <each> per-item interpolation. The GITI-032 ast-builder
// gate hands the each path a markup-value-bearing exprNode; the ss17 item-2 fix
// (emitEachPerItemMarkupValue) now LOWERS it — builds the markup DOM, resolves
// the iter-scope `@.` to the item binding, and live-keys it on reconcile —
// instead of the prior deferred skip marker. Still clean-compile (no raw
// tokenizer-spaced `< span >` leak, no E-CODEGEN-INVALID-LOGIC).
// ---------------------------------------------------------------------------

const EACH = [
  "<program>",
  '<items> = ["a", "b", "c"]',
  "<div>",
  "  <each in=@items>",
  '    <li>${ @. == "a" ? <span>FIRST</span> : "" }</li>',
  "  </each>",
  "</div>",
  "</program>",
].join("\n");

describe("GITI-032 — markup-value in an <each> per-item interpolation (ss17 item-2: lowered)", () => {
  test("compiles clean — no E-CODEGEN-INVALID-LOGIC (raw `< span >` is not emitted)", () => {
    const { errors, clientJs } = compileToClient(EACH, "giti032-each");
    expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    // The markup must NOT leak as a raw tokenizer-spaced fragment.
    expect(clientJs).not.toMatch(/<\s+span\s+>/);
  });

  test("markup-value is now LOWERED (DOM build + live-keyed wrapper), not deferred", () => {
    const { clientJs } = compileToClient(EACH, "giti032-each-lowered");
    // The deferred-skip marker is GONE — the real lowering replaced it.
    expect(clientJs).not.toContain("markup-as-value in per-item interpolation not yet lowered");
    // The markup DOM is built: a <span> element + its "FIRST" text node.
    expect(clientJs).toContain('document.createElement("span")');
    expect(clientJs).toContain('document.createTextNode("FIRST")');
    // A stable per-item wrapper carries the live-keyed markup-value slot.
    expect(clientJs).toContain('data-scrml-mv');
  });
});
