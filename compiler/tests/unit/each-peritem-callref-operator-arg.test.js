/**
 * Per-item call-ref arms lower a §42 operator in a call ARG — g-each-peritem-class-call-ref-operator-arg-not-lowered.
 *
 * Filed: S375-peter (S239 review of the show=-in-each fix), LOW, for the `class:`
 * arm. Fixed + CLASS-CONVERGED S400-peter.
 *
 * Symptom (before fix): inside `<each>`, a call-ref attribute value carrying a §42
 * operator in an argument — `class:on=isReady(t.status is some)` — reached the
 * client JS RAW because the call-ref arm used the bare `rewriteIterValueExpr`
 * (which does not lower §42 operators) instead of `lowerEachExpr`. The raw
 * `is some` then tripped E-CODEGEN-INVALID-LOGIC (the emit-parse gate) at build.
 * The already-fixed `show=` arm was the parity oracle (it routes through
 * `lowerEachExpr`).
 *
 * Verifying the CLASS (not just the reported `class:` instance) surfaced two more
 * per-item call-ref arms with the identical bare-`rewriteIterValueExpr` hole — the
 * `value`-property arm (input/textarea/select) and the generic value-attribute arm
 * (`title=fmt(...)`). All three now route through `lowerEachExpr`; byte-identical
 * for an operator-free call.
 *
 * The gate is the emit-parse validation (`write: true`), which is where
 * E-CODEGEN-INVALID-LOGIC fires — a `write: false` compile does NOT exercise it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "each-callref-op-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Compile a <page> with `inner` inside an <each>, WITH emit-parse validation
// (write: true), and return the set of error codes.
function errsFor(name, inner) {
  const fp = join(TMP, `${name}.scrml`);
  const od = join(TMP, `${name}.dist`);
  mkdirSync(od, { recursive: true });
  writeFileSync(fp, `<page>
\${ <items>: list = [{status:"ok"}] }
<each in=@items as=t>
${inner}
</each>
\${ function isReady(v){ return v } function fmt(v){ return v } }
</page>`);
  const result = compileScrml({ inputFiles: [fp], outputDir: od, write: true, mode: "app", log: () => {} });
  return [...new Set((result.errors || []).map(e => e.code))];
}

describe("per-item call-ref arms lower a §42 operator in a call arg (g-each-peritem-class-call-ref-operator-arg-not-lowered)", () => {
  test("class: call-ref with `is some` in an arg compiles (was E-CODEGEN-INVALID-LOGIC)", () => {
    expect(errsFor("class_op", `<div class:on=isReady(t.status is some)>x</div>`)).toEqual([]);
  });

  test("value-property call-ref with `is some` in an arg compiles (sibling)", () => {
    expect(errsFor("value_op", `<input value=fmt(t.status is some)/>`)).toEqual([]);
  });

  test("generic value-attribute call-ref with `is some` in an arg compiles (sibling)", () => {
    expect(errsFor("attr_op", `<div title=fmt(t.status is some)>x</div>`)).toEqual([]);
  });

  // Operator-free call-refs must stay clean (byte-identical path — no escalation).
  test("operator-free call-refs stay clean across all three arms", () => {
    expect(errsFor("class_plain", `<div class:on=isReady(t.status)>x</div>`)).toEqual([]);
    expect(errsFor("value_plain", `<input value=fmt(t.status)/>`)).toEqual([]);
    expect(errsFor("attr_plain", `<div title=fmt(t.status)>x</div>`)).toEqual([]);
  });
});
