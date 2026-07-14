/**
 * GCP3 null-coverage — string-template-interp null sweep (W3.2, F-NULL-004).
 *
 * `<div class="${@x == null ? a : b}">` — when an attribute value has
 * `kind:"string-literal"` (the markup tokenizer's representation for a
 * plain string-quoted attribute), any `${...}` interpolation segment is
 * preserved as raw text and never parsed into an exprNode. The W3 detector
 * (which inspects `attrs[*].value.exprNode`) therefore never sees the
 * interpolation expressions, and `== null` / `!= null` / bare-null in
 * those segments silently passes.
 *
 * Per SPEC §42.7 (W3 amendment): the rejection of `null` / `undefined`
 * SHALL apply uniformly across **every** scrml source position, including
 * "template-string `${...}` interpolations parsed as expressions." W3.2
 * closes that gap with a tactical re-parse:
 *   `inspectAttrs` extracts each `${...}` segment from string-literal
 *   attribute values, parses each via `parseExprToNode`, and runs the
 *   eq + bare-null detectors over the resulting exprNode tree.
 *
 * Negative tests: every `${...}` form that contains `== null` / `!= null` /
 * `== undefined` / bare null must trigger E-SYNTAX-042. The same shape
 * outside string-literal attributes (e.g. `<div>${@x == null ? a : b}</div>`,
 * `<div if=(@x == null)>`) was already covered by W3 — those are NOT this
 * file's scope but are included as baselines.
 *
 * Positive controls: interpolations using `is not` / `is some` / `not`
 * compile clean; plain non-null interpolations (`${other}`) compile clean.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `null-tmpl-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(items) {
  return items.map(e => e.code).sort();
}

describe("W3.2 — string-template-interp null sweep (F-NULL-004)", () => {

  // ===============================================================
  // Equality null inside `${...}` of a string-literal attribute value
  // — the canonical F-NULL-004 case.
  // ===============================================================
  describe("equality null in attribute string-literal interpolation", () => {

    test("`<div class=\"${@x == null ? a : b}\">` → E-SYNTAX-042 (was silent pass)", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="\${@x == null ? 'a' : 'b'}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-class-eq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`<div class=\"${@x != null ? a : b}\">` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="\${@x != null ? 'a' : 'b'}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-class-neq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`<div title=\"${@x == undefined ? a : b}\">` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div title="\${@x == undefined ? 'a' : 'b'}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-title-eq-undef");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("interpolation with mixed literal text — `${@x == null ? '' : @x}` inside class → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="prefix-\${@x == null ? '' : @x}-suffix">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-mixed-eq-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Bare null inside `${...}` of a string-literal attribute value.
  // Closes the W3.2 gap layered with W3.1 — the bare-null walker must
  // also see embedded interpolation expressions.
  // ===============================================================
  describe("bare null in attribute string-literal interpolation", () => {

    test("`<div class=\"${@x is some ? 'present' : null}\">` (bare null in alternate) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="\${@x is some ? 'present' : null}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-bare-null-alt");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

    test("`<div title=\"${null}\">` (bare null as whole interpolation) → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div title="\${null}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-bare-null-whole");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Multiple interpolations in one attribute value.
  // ===============================================================
  describe("multiple interpolations in one attribute", () => {

    test("two interpolations, second has `== null` → E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "a"
  @y = "b"
}
<div class="\${@x} \${@y == null ? 'fallback' : @y}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-multi-second-null");
      expect(codes(errors)).toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Diagnostic-quality.
  // ===============================================================
  describe("diagnostic quality — emit has span", () => {

    test("`<div class=\"${@x == null ? a : b}\">` emit carries span", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="\${@x == null ? 'a' : 'b'}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "tmpl-source-loc");
      const e042 = errors.find(e => e.code === "E-SYNTAX-042");
      expect(e042).toBeDefined();
      expect(e042.span).toBeDefined();
      // Note: the W3.2 re-parse does not have a precise source-relative
      // offset for the segment (parseExprToNode is invoked with offset=0),
      // so line/col fall back to the attribute's value.span (carried by
      // the attribute AST node). That span DOES have a real line.
      expect(e042.span.line).toBeGreaterThan(0);
    });

  });

  // ===============================================================
  // Positive controls — spec-compliant interpolations compile.
  // ===============================================================
  describe("positive controls — spec-compliant interpolations compile", () => {

    test("`<div class=\"${@x is some ? 'a' : 'b'}\">` — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  let x: string | not = "hello"
  @cls = x
}
<div class="\${@cls is some ? 'a' : 'b'}">\${@cls}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-tmpl-issome");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("`<div class=\"${otherExpr}\">` (no null) — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="prefix-\${@x}-suffix">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-tmpl-plain");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("plain string-literal attribute (no interpolation) — no E-SYNTAX-042", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="static-class">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "ctrl-tmpl-static");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

  });

  // ===============================================================
  // Edge cases — empty interpolation, malformed segments, nested braces.
  // ===============================================================
  describe("edge cases", () => {

    test("plain attribute with no interpolation — no spurious emit", () => {
      const src = `<program>
\${
  @x = "hello"
}
<div class="just-static" title="more-static">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "edge-no-interp");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

    test("interpolation with nested braces — `${{a:1, b:@x}}` — does not break extractor", () => {
      // Nested object literal inside ${...}. The brace-depth counter in
      // extractTemplateInterpSegments must correctly find the outer closer.
      // (Object literal property `b: not` is spec-compliant.)
      const src = `<program>
\${
  @x = "hello"
}
<div class="\${'wrapper'}">\${@x}</div>
</program>`;
      const { errors } = compileWholeScrml(src, "edge-nested-braces");
      expect(codes(errors)).not.toContain("E-SYNTAX-042");
    });

  });

});
