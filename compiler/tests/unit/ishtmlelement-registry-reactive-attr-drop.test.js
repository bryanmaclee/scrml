/**
 * g-ishtmlelement-registry-incomplete (S362-peter) — a reactive value attribute
 * `attr=(@expr)` was SILENTLY DROPPED on standard HTML render elements the CURATED
 * element registry omits (`details`/`summary`/`output`/`meter`/`pre`/`code`/`em`/
 * `strong`/`thead`/`tbody`/…), while the same attr binds on a registry-listed
 * element (`div`). Exit 0, no diagnostic — the reactive binding just never emits.
 *
 * Root: the curated `REGISTRY` (html-elements.js) is a ~57-element subset carrying
 * per-element attribute/void shapes; it deliberately omits these render elements
 * (`isKnownElementName` is the separate complete union for the E-MARKUP-001 gate).
 * name-resolver stamps a registry-absent element `resolvedKind:"unknown"`, so the
 * value-attr lowering gate `valueAttrElementIsLowerable` (emit-html.ts) returned
 * false → the `attr=(@expr)` was not lowered.
 *
 * FIX: the lowering gate now recognizes a "unknown"-classified node whose tag is a
 * standard HTML RENDER element via `isStandardHtmlRenderElement` (the complete
 * WHATWG HTML set minus document-metadata), WITHOUT bloating the curated REGISTRY
 * (which would pull these elements into attribute-validation/void — the documented
 * blast radius). A component / directive / typo is not a standard render name, so
 * it stays refused.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `ishtml-reg-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    return compileScrml({ inputFiles: [tmpInput], outDir: tmpDir, emitClient: true, emitServer: false });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function outputs(result) {
  let clientJs = null, html = null;
  for (const out of result.outputs?.values?.() ?? []) {
    if (out?.clientJs) clientJs = out.clientJs;
    if (out?.html) html = out.html;
  }
  return { clientJs, html };
}

const HEADER = `<program>\n\${ <sel> = "on" }\n<div>\n`;
const wrap = (body) => `${HEADER}${body}\n</div>\n</program>\n`;

/** Assert the element's reactive class attr lowered: it carries a bind marker in the SSR HTML. */
function expectBound(html, tag) {
  const re = new RegExp(`<${tag}[^>]*data-scrml-bind-attr-class`, "i");
  expect(html).toMatch(re);
}

describe("g-ishtmlelement-registry-incomplete — reactive attr=(@expr) on registry-absent render elements", () => {
  // Each of these is a standard HTML render element ABSENT from the curated REGISTRY;
  // a reactive `class=(@sel)` on it was silently dropped pre-fix.
  for (const tag of ["details", "summary", "output", "meter", "pre", "code", "em", "strong", "thead", "tbody"]) {
    test(`reactive class=(@sel) on <${tag}> lowers to a DOM binding`, () => {
      const result = compileSource(wrap(`  <${tag} class=(@sel)>x</${tag}>`));
      expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
      const { html } = outputs(result);
      expect(html).toBeTruthy();
      expectBound(html, tag);
    });
  }

  test("a registry-listed element (<div>) is unchanged — still binds", () => {
    const result = compileSource(wrap(`  <div class=(@sel)>x</div>`));
    expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
    const { html } = outputs(result);
    expectBound(html, "div");
  });

  // §GATE — the reparse-equivalent is registered to STANDARD render names, so a
  // non-element tag stays refused (E-MARKUP-001) and never emits a phantom binding.
  test("GATE: an unknown lowercase tag does NOT bind and still fires E-MARKUP-001", () => {
    const result = compileSource(wrap(`  <notareal class=(@sel)>x</notareal>`));
    const codes = (result.errors ?? []).map((e) => e.code);
    expect(codes).toContain("E-MARKUP-001");
    const { clientJs } = outputs(result);
    // no phantom reactive class binding for the bogus tag
    expect(clientJs == null || !/_scrml_attr_class_\d+/.test(clientJs)).toBe(true);
  });

  // §GATE — a document-metadata element (non-rendering) is excluded from the render
  // predicate, so a reactive attr on it is NOT newly lowered (matches rendersToDom).
  test("GATE: a non-rendering metadata element (<title>) is not treated as a render target", () => {
    // <title> reactive class is meaningless; assert the fix did not start lowering it
    // via the standard-render branch (title is in NON_RENDERING_HTML_ELEMENTS).
    const result = compileSource(wrap(`  <title class=(@sel)>x</title>`));
    const { html } = outputs(result);
    // Either it compiled without a title class binding, or errored — but it must not
    // carry a reactive class bind marker on <title>.
    if (html) expect(html).not.toMatch(/<title[^>]*data-scrml-bind-attr-class/i);
  });

  // §GATE (S239 finding 3) — <template> content is inert / never rendered, so it is
  // in NON_RENDERING_HTML_ELEMENTS; a reactive attr on it must NOT lower.
  test("GATE: <template> (inert content) is not lowered", () => {
    const result = compileSource(wrap(`  <template class=(@sel)>x</template>`));
    const { clientJs } = outputs(result);
    expect(clientJs == null || !/_scrml_attr_class_\d+/.test(clientJs)).toBe(true);
  });

  // §GATE (S239 finding 2) — the render predicate is CASE-SENSITIVE against the
  // canonical lowercase set, so a mixed-case near-miss of a STANDARD-only element
  // (a typo, blessed by no upstream gate) stays fail-closed rather than lowering
  // onto a phantom tag. (Mixed-case variants of a CURATED-registry element like
  // `textArea`→`textarea` are a separate, pre-existing html-builtin path this fix
  // does not touch, so they are not asserted here.)
  for (const typo of ["dataList", "tBody"]) {
    test(`GATE: mixed-case near-miss <${typo}> does NOT lower (fail-closed)`, () => {
      const result = compileSource(wrap(`  <${typo} class=(@sel)>x</${typo}>`));
      const { clientJs } = outputs(result);
      expect(clientJs == null || !/_scrml_attr_class_\d+/.test(clientJs)).toBe(true);
    });
  }

  // S239 finding 1 — the SAME registry-absent render element inside a <match> arm
  // body (the resolvedKind==null / post-NR-synthesized path) must ALSO lower, not
  // just at top level — else same-markup, context-dependent divergence.
  test("a registry-absent render element (<details>) inside a <match> arm body also lowers", () => {
    const src = `<div>
  \${
    type Phase:enum = { Idle, Loading }
    <phase>: Phase = .Idle
    <sel> = "on"
  }
  <match for=Phase on=@phase>
    <Idle>
      <details class=(@sel)>x</details>
    </>
    <Loading>
      <span>y</span>
    </>
  </match>
</div>`;
    const result = compileSource(src);
    expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
    const { clientJs, html } = outputs(result);
    const bound = /_scrml_attr_class_\d+/.test(clientJs ?? "") || /data-scrml-bind-attr-class/.test(html ?? "");
    expect(bound).toBe(true);
  });
});
