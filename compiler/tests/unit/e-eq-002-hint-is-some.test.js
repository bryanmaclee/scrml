/**
 * e-eq-002-hint-is-some.test.js — g-e-eq-002-hint-suggests-the-double-negative (S410).
 *
 * `E-EQ-002` fires on `== not` / `!= not`. Its `!=` arm used to advise `is not not`,
 * which IS legal scrml but is exactly the double-negative the language provides
 * `is some` to avoid:
 *
 *   SPEC.md:24944 (§45) — "`is some` exists to avoid the double-negative
 *   `not (x is not)` in common presence checks."
 *
 * A diagnostic that hands the author the discouraged form is teaching the wrong idiom
 * at the one moment they are guaranteed to be reading. `x != not` means "x is present",
 * and §42.2.5 makes `is some` the canonical spelling of that.
 *
 * ⚑ Both arms are pinned. The `==` arm is the REGRESSION GUARD: it must keep saying
 * `is not`, because `== not` means "x is absent" and `is some` would be the exact
 * inverse. A one-sided test would let a careless "fix" invert it.
 *
 * ⚑ Message-text assertions are usually brittle, and that is accepted here on purpose:
 * the hint STRING is the whole defect, so pinning the code alone would not have caught
 * this and would not catch a regression. The pre-existing `equality-semantics.test.js`
 * §14/§15 assert only `e.code`, which is why this shipped unnoticed.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
function eqDiag(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "e-eq-002-hint-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const r = compileScrml({
    inputFiles: [file],
    outputDir: join(TMP, `${name}.dist`),
    mode: "browser",
    write: false,
    log: () => {},
  });
  const all = [...(r.errors || []), ...(r.warnings || [])];
  return all.find((e) => e.code === "E-EQ-002") || null;
}

describe("E-EQ-002 hint (g-e-eq-002-hint-suggests-the-double-negative)", () => {
  test("`!= not` advises `is some`, NOT the double-negative `is not not`", () => {
    const d = eqDiag("${ let x = a != not }\n<div>hi</div>", "neq-not");
    expect(d).not.toBeNull();
    expect(d.message).toContain("is some");
    // The whole point of the fix — the discouraged form must be gone.
    expect(d.message).not.toContain("is not not");
  });

  test("REGRESSION GUARD — `== not` still advises `is not` (the inverse must not flip)", () => {
    const d = eqDiag("${ let x = a == not }\n<div>hi</div>", "eq-not");
    expect(d).not.toBeNull();
    expect(d.message).toContain("is not");
    // `== not` asks "is x absent?"; `is some` there would be exactly backwards.
    expect(d.message).not.toContain("is some");
  });
});
