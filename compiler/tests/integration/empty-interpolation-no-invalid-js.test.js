/**
 * gate-found-invalid-js-fix-wave (S141 follow-on) — empty `${...}` interpolation
 * inside a lifted markup body must NOT emit `String(() ?? "")`.
 *
 * ROOT CAUSE (example 12-snippets-slots): a `${render <slot>()}` interpolation
 * that the component-expander substitutes away to NOTHING leaves a `bare-expr`
 * whose expression lowers to the empty string. emit-lift.js then emitted
 * `appendChild(document.createTextNode(String(() ?? "")))` — `()` is empty
 * parens, invalid JS (the gate's E-CODEGEN-INVALID-LOGIC). The fix SKIPS the
 * text-node append when the interpolation lowers to empty (an empty
 * interpolation has no text to render).
 *
 * This test compiles a minimal snippet-slot component end-to-end with the
 * emitted-JS parse gate ON and asserts the compile produces NO
 * E-CODEGEN-INVALID-LOGIC (and that the emitted client.js is acorn-parse-clean).
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-empty-interp-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    write: false,
    validateEmit: true,
    log: () => {},
  });
  return result;
}

describe("empty interpolation does not emit invalid JS (gate fix-wave)", () => {
  test("a Card component with a render-slot in a lifted body emits valid client.js", () => {
    const src = `<program>
  \${
    const Card = <div class="card" props={
      header: snippet,
      body:   snippet,
    }>
      <div class="card__header">
        \${render header()}
      </>
      <div class="card__body">
        \${render body()}
      </>
    </>
  }
  <main>
    <Card>
      <h2 slot="header">Welcome</>
      <p slot="body">Body text here.</>
    </>
  </main>
</program>`;
    const result = compileSource(src);
    const invalid = (result.errors ?? []).filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(invalid).toHaveLength(0);
    // The emitted client.js must be acorn-parse-clean and must NOT contain the
    // malformed empty-arrow interpolation.
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    if (out?.clientJs) {
      expect(out.clientJs).not.toContain("String(() ?? \"\")");
      expect(() => acorn.parse(out.clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    }
  });
});
