/**
 * g-show-false-flashes-pre-hydration (FOUC) — Unit Tests
 *
 * SPEC §17.2 (SPEC.md:11388-11389): a `show=`-bound element EXISTS in the DOM
 * regardless of `expr`; "When `expr` evaluates to false, the element is hidden.
 * The compiler generates a CSS `display: none` toggle." On HEAD the SSR `.html`
 * rendered a `show=false` element with NO inline style, so the browser painted it
 * visible and only the client controller collapsed it after hydration — a flash
 * of unstyled content (FOUC).
 *
 * The fix: at the `show=` SSR emit sites (compiler/src/codegen/emit-html.ts), when
 * the predicate's INITIAL value is SSR-determinable false, ALSO emit an inline
 * `display:none` so the first paint matches the §17.2 hidden end-state. This is a
 * conformance restoration (the end-state is already mandated), not a semantics
 * change.
 *
 * WHY A UNIT TEST (not a conformance case): the property under test is the
 * PRE-hydration SSR `.html`. The conformance runtime half (run.ts `domAnchored`)
 * asserts on the live <body> AFTER hydration — where the controller has set
 * display:none for a false cell regardless of this fix, so it cannot discriminate
 * fix-vs-base. The only pre-hydration assertion (`firstPaint`) requires SSR
 * compose mode (`serverDb`), which a client-only page has no way to opt into.
 * Asserting the emitted SSR `.html` string directly is therefore the correct gate.
 *
 * Coverage:
 *   §1  show=@cell with initial `false`        → inline display:none emitted
 *   §2  show=(false) literal                    → inline display:none emitted
 *   §3  show=@cell with initial `true`          → NO inline style (byte-inert)
 *   §4  show=(true) literal                     → NO inline style (byte-inert)
 *   §5  MERGE into a static author style=        → "color:red;display:none"
 *   §6  author style already sets display        → prefer author, no duplicate
 *   §7  reactive/interpolated author style        → NOT clobbered (left to controller)
 *   §8  show=@dotted.path (not determinable)      → NO inline style
 *   §9  reassigned cell (indeterminate)           → NO inline style
 *   §10 element without show= is byte-inert
 *   §11 the client hydration controller is unchanged (reveal still works)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

/** Compile a full-page scrml source string through the real CG pipeline. */
function compileSource(src) {
  resetVarCounter();
  const bs = splitBlocks("test.scrml", src);
  const built = buildAST(bs);
  const ast = built.ast;
  const res = runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const out = res.outputs.get(ast.filePath) ?? [...res.outputs.values()][0];
  return out;
}

/** Return the single emitted `<p id="...">` opening tag line for an id. */
function tagOf(html, id) {
  const m = html.match(new RegExp(`<p id="${id}"[^>]*>`));
  return m ? m[0] : null;
}

beforeEach(() => {
  resetVarCounter();
});

describe("§1: show=@cell initial-false → SSR display:none", () => {
  test("false-initialized cell is SSR-hidden", () => {
    const { html } = compileSource(
      `<page>\n  <shown>: bool = false\n  <p id="a" show=@shown>SECRET</p>\n</page>`,
    );
    const tag = tagOf(html, "a");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).toContain('style="display:none"');
  });
});

describe("§2: show=(false) literal → SSR display:none", () => {
  test("syntactic false is SSR-hidden", () => {
    const { html } = compileSource(
      `<page>\n  <p id="b" show=(false)>SECRET2</p>\n</page>`,
    );
    const tag = tagOf(html, "b");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).toContain('style="display:none"');
  });
});

describe("§3: show=@cell initial-true → NO inline style (byte-inert)", () => {
  test("true-initialized cell gets no inline style", () => {
    const { html } = compileSource(
      `<page>\n  <yes>: bool = true\n  <p id="c" show=@yes>VISIBLE</p>\n</page>`,
    );
    const tag = tagOf(html, "c");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).not.toContain("style=");
    expect(tag).not.toContain("display:none");
  });
});

describe("§4: show=(true) literal → NO inline style (byte-inert)", () => {
  test("syntactic true gets no inline style", () => {
    const { html } = compileSource(
      `<page>\n  <p id="d" show=(true)>VISIBLE2</p>\n</page>`,
    );
    const tag = tagOf(html, "d");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).not.toContain("style=");
    expect(tag).not.toContain("display:none");
  });
});

describe("§5: MERGE display:none into a static author style=", () => {
  test("style=color:red is merged, not clobbered", () => {
    const { html } = compileSource(
      `<page>\n  <shown>: bool = false\n  <p id="e" show=@shown style="color:red">SECRET3</p>\n</page>`,
    );
    const tag = tagOf(html, "e");
    expect(tag).toContain('style="color:red;display:none"');
    // The author declaration survives verbatim (not replaced).
    expect(tag).toContain("color:red");
    // Exactly one display:none, no duplicate/broken style attr.
    expect((tag.match(/display:none/g) || []).length).toBe(1);
    expect((tag.match(/style=/g) || []).length).toBe(1);
  });
});

describe("§6: author style already sets display → prefer author, no dup", () => {
  test("display:block author style is left untouched", () => {
    const { html } = compileSource(
      `<page>\n  <p id="g" show=(false) style="display:block">X</p>\n</page>`,
    );
    const tag = tagOf(html, "g");
    expect(tag).toContain('style="display:block"');
    expect(tag).not.toContain("display:none");
  });
});

describe("§7: reactive/interpolated author style is NOT clobbered", () => {
  test("interpolated style= on a false element is left to the controller", () => {
    const { html } = compileSource(
      `<page>\n  <shown>: bool = false\n  <red>: text = "red"\n  <p id="h" show=@shown style="color:\${@red}">X</p>\n</page>`,
    );
    const tag = tagOf(html, "h");
    // The reactive-style path owns first-paint; we do NOT inject display:none
    // (merging into a template placeholder would be fragile — constraint: never
    // clobber the author style).
    expect(tag).not.toContain("display:none");
  });
});

describe("§8: show=@dotted.path (not statically determinable) → no style", () => {
  test("dotted-path predicate is left to the controller", () => {
    const { html } = compileSource(
      `<page>\n  <obj>: { on: bool } = { on: false }\n  <p id="i" show=@obj.on>X</p>\n</page>`,
    );
    const tag = tagOf(html, "i");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).not.toContain("display:none");
  });
});

describe("§9: reassigned cell (indeterminate) → no style", () => {
  test("a cell reassigned at top level is not treated as determinable-false", () => {
    const { html } = compileSource(
      `<page>\n  <shown>: bool = false\n  @shown = true\n  <p id="j" show=@shown>X</p>\n</page>`,
    );
    const tag = tagOf(html, "j");
    expect(tag).toContain("data-scrml-bind-show=");
    expect(tag).not.toContain("display:none");
  });
});

describe("§10: element without show= is byte-inert", () => {
  test("a plain element gets no injected style", () => {
    const { html } = compileSource(
      `<page>\n  <p id="k">PLAIN</p>\n</page>`,
    );
    const tag = tagOf(html, "k");
    expect(tag).toBe('<p id="k">');
  });
});

describe("§11: client hydration controller is unchanged (reveal works)", () => {
  test("controller still sets display = cond ? '' : 'none'", () => {
    const { clientJs } = compileSource(
      `<page>\n  <shown>: bool = false\n  <p id="a" show=@shown>SECRET</p>\n</page>`,
    );
    // The controller keeps `none` while false and clears (reveals) on flip-true.
    expect(clientJs).toContain('.style.display =');
    expect(clientJs).toContain('? "" : "none"');
  });
});
