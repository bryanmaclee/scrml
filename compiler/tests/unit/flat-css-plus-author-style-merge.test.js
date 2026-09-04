/**
 * Flat #{} declaration + author style= merge — g-flat-css-block-plus-author-style-emits-two-style-attributes.
 *
 * Filed: S328-bryan, LOW; re-verified on HEAD S359-peter. Fixed S400-peter.
 *
 * Symptom (before fix): a DQ-7 flat-declaration `#{ … }` on a component root
 * emits an inline `style="…"`, and an author `style=` on the SAME element was
 * pushed as a SECOND `style` attribute (`emit-html.ts` pushed `flatInlineStyle`
 * unconditionally, then the attr loop emitted the author `style=` too). Two
 * `style` attributes is invalid HTML — a conformant parser keeps the FIRST and
 * silently DROPS the author style.
 *
 * Fix: when a static author `style=` is present, merge it into the single
 * flat-declaration `style=` (author LAST, so a same-property author value wins
 * per CSS last-declaration-wins) and skip the author attr in the loop.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "flat-style-merge-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Compile a component whose root carries `rootAttrs` and a flat `#{cssBody}`,
// instantiate it, and return the emitted widget-root tag string.
function widgetRootTag(name, rootAttrs, cssBody) {
  const fp = join(TMP, `${name}.scrml`);
  const od = join(TMP, `${name}.dist`);
  mkdirSync(od, { recursive: true });
  writeFileSync(fp, `<program>
\${
  const Widget = <div ${rootAttrs} props={ label: string }>
    ${cssBody ? `#{ ${cssBody} }` : ""}
    \${label}
  </>
}
<div><Widget label="x"/></>
</program>
`);
  const result = compileScrml({ inputFiles: [fp], outputDir: od, write: true, mode: "app", log: () => {} });
  expect((result.errors || []).map(e => e.code)).toEqual([]);
  const html = readdirSync(od).find(f => f.endsWith(".html"));
  const body = readFileSync(join(od, html), "utf8");
  const m = body.match(/<div[^>]*data-scrml="Widget"[^>]*>/);
  expect(m).not.toBeNull();
  return m[0];
}

function styleCount(tag) {
  return (tag.match(/style=/g) || []).length;
}
function styleValue(tag) {
  return (tag.match(/style="([^"]*)"/) || [, ""])[1];
}

describe("flat #{} + author style= merge into ONE style attribute (g-flat-css-block-plus-author-style-emits-two-style-attributes)", () => {
  test("flat + author (different properties) → one style attribute carrying both", () => {
    const tag = widgetRootTag("diff", `style="margin: 5px"`, `color: red;`);
    expect(styleCount(tag)).toBe(1);
    const v = styleValue(tag);
    expect(v).toContain("color: red");
    expect(v).toContain("margin: 5px");
  });

  test("flat + author (same property) → author value wins (declared last)", () => {
    const tag = widgetRootTag("same", `style="color: blue"`, `color: red;`);
    expect(styleCount(tag)).toBe(1);
    const v = styleValue(tag);
    // both present, author (blue) after flat (red) → CSS last-wins
    expect(v.indexOf("color: red")).toBeLessThan(v.indexOf("color: blue"));
  });

  test("flat only (no author style) → unchanged single style", () => {
    const tag = widgetRootTag("flatonly", `class="c"`, `color: red;`);
    expect(styleCount(tag)).toBe(1);
    expect(styleValue(tag)).toContain("color: red");
  });

  test("author only (no flat) → unchanged single style", () => {
    const tag = widgetRootTag("authoronly", `style="margin: 5px"`, "");
    expect(styleCount(tag)).toBe(1);
    expect(styleValue(tag)).toContain("margin: 5px");
  });
});
