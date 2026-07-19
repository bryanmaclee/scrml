/**
 * CONF-MARKUP-001 | §4.1 / §23 / §34
 *
 * Catalog: E-MARKUP-001 — a markup opener whose element name is not a known
 * HTML element and not a defined component SHALL be a compile error.
 *
 * Normative: SPEC §4.1 — "The compiler SHALL validate the element name against
 * the built-in HTML element registry (see Section 23). A name that is not a
 * known HTML element and not a defined component SHALL be a compile error
 * (E-MARKUP-001)." Per the §34 catalog and the S263 E-STATE-001 retirement
 * note: PascalCase-unknown → E-COMPONENT-035; lowercase-HTML-unknown →
 * E-MARKUP-001 (this code).
 *
 * Firing site: compiler/src/name-resolver.ts (NR, Stage 3.05) — the walker's
 * markup branch. The gate consults the COMPLETE valid-element union
 * (isKnownElementName = HTML ∪ SVG ∪ MathML ∪ custom-hyphen, in
 * compiler/src/html-elements.js) plus the scrml structural / §36 input-state /
 * per-file declared-name exclusions, so SVG/MathML/custom/modern-HTML/declared
 * cells never false-fire. The false-positive rate is the make-or-break metric
 * (the sibling E-MARKUP-002 was retired for 205 corpus false positives).
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

/** Compile `source` (optionally with sibling files) and return all error codes. */
function compileCodes(source, slug, extraFiles = {}) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  writeFileSync(tmpInput, source);
  for (const [fname, fsrc] of Object.entries(extraFiles)) {
    writeFileSync(resolve(tmpDir, fname), fsrc);
  }
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return (result.errors ?? []).map((e) => e.code);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-MARKUP-001: unknown lowercase element name fires E-MARKUP-001 (§4.1)", () => {
  // -------------------------------------------------------------------------
  // POSITIVE — genuine unknown-element typos MUST fire E-MARKUP-001.
  // -------------------------------------------------------------------------
  test("POS: `<blorptag>` (genuinely unknown lowercase tag) fires E-MARKUP-001", () => {
    const codes = compileCodes(`<div><blorptag class="x">hi</blorptag></div>`, "blorptag");
    expect(codes).toContain("E-MARKUP-001");
  });

  test("POS: `<dvi>` (typo of <div>) fires E-MARKUP-001", () => {
    const codes = compileCodes(`<div><dvi>x</dvi></div>`, "dvi");
    expect(codes).toContain("E-MARKUP-001");
  });

  test("POS: `<fizzbuzz>` (unknown element name) fires E-MARKUP-001", () => {
    const codes = compileCodes(`<fizzbuzz>content</fizzbuzz>`, "fizzbuzz");
    expect(codes).toContain("E-MARKUP-001");
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — the whole risk (E-MARKUP-002 lesson): valid tags MUST NOT fire.
  // -------------------------------------------------------------------------
  test("NEG: SVG elements (incl. camelCase + partial-registry gaps) do NOT fire", () => {
    const codes = compileCodes(
      `<svg><circle/><path/><g><rect/></g><foreignObject><div>x</div></foreignObject>` +
        `<filter><feGaussianBlur/><feOffset/></filter>` +
        `<linearGradient><stop/></linearGradient><text>hi</text></svg>`,
      "svg",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: MathML elements do NOT fire", () => {
    const codes = compileCodes(
      `<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>`,
      "mathml",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: custom elements (hyphenated names) do NOT fire", () => {
    const codes = compileCodes(
      `<my-widget></my-widget><x-foo/><ui-date-picker></ui-date-picker>`,
      "custom",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: standard + modern HTML elements do NOT fire", () => {
    const codes = compileCodes(
      `<dialog><details><summary>s</summary></details></dialog>` +
        `<template></template><slot></slot><picture></picture><video></video>` +
        `<pre><code>x</code></pre><strong>b</strong><em>i</em>` +
        `<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>`,
      "modern-html",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: §36 input-state tags (<keyboard>/<mouse>/<gamepad>) do NOT fire", () => {
    const codes = compileCodes(`<keyboard id="k"/><mouse id="m"/><gamepad id="g"/>`, "input-states");
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: §65.9 <defaults> (registered scrml structural element) does NOT fire", () => {
    // S264 review regression: `<defaults>` is a registered structural element
    // (STRUCTURAL_ELEMENT_PLACEMENT / §65.9), not an unknown HTML element.
    const codes = compileCodes(
      `<program>\n  <defaults>\n    a { color: blue; }\n    body { margin: 0; }\n  </defaults>\n</program>`,
      "defaults",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: combined §65 <theme> + <defaults> does NOT fire", () => {
    const codes = compileCodes(
      `<program>\n  <theme>\n    primary = blue;\n  </theme>\n  <defaults>\n    body { margin: 0; }\n  </defaults>\n</program>`,
      "theme-defaults",
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: a locally-declared state cell used as markup does NOT fire", () => {
    const codes = compileCodes(`<div>\${<count> = 0}<count/></div>`, "declared-cell");
    expect(codes).not.toContain("E-MARKUP-001");
  });

  test("NEG: a defined component (imported, PascalCase) does NOT fire", () => {
    const codes = compileCodes(
      `import { Badge } from "./badge.scrml"\n<div><Badge/></div>`,
      "component",
      { "badge.scrml": `export component Badge() {\n  lift <span class="badge">B</span>\n}\n` },
    );
    expect(codes).not.toContain("E-MARKUP-001");
  });
});
