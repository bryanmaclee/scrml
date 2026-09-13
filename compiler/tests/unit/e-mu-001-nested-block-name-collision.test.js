/* SPDX-License-Identifier: MIT
 *
 * Unit — g-must-use-suppressed-by-out-of-scope-name-collision (S413).
 *
 * A regression from #931 (S412). #931 correctly stopped `E-MU-001` over-firing when an
 * inner `function` reassigns a binding of its enclosing scope — SPEC.md:5986 admits that
 * mutation — by handing the enclosing frame's binding set across the function boundary
 * as `parentBindings`. The set it handed across was `knownBindings`, and `knownBindings`
 * is FLAT: `_collectScopeBindings` recurses into every nested block of the frame, so it
 * carries names from blocks the inner function is lexically OUTSIDE of.
 *
 *     export function render(rows) {
 *       let out = ""
 *       for (let i = 0; i < rows.length; i = i + 1) {
 *         let row = rows[i]              // ← block-scoped to the `for` BODY
 *         out = out + row
 *       }
 *       function tally() { row = ""      // ← a FRESH must-use; nothing here reads it
 *         return 1 }
 *       let n = tally()
 *       return out + n
 *     }
 *
 * §48.3.3's reassignment-vs-declaration discriminator saw `row` in the flat set, read
 * `row = ""` as a REASSIGNMENT rather than a declaration, and dropped the must-use
 * entry. The program compiled at exit 0 with 3 warnings and threw
 * `ReferenceError: row is not defined` the moment `render(["a","b"])` ran.
 *
 * ⚑ WHY NONE OF #931'S SIX PINS SAW THIS: every one of them puts the colliding binding
 * at the SAME BODY LEVEL as the inner function, which is the one placement where the
 * flat set and the lexical set agree. The axis this file pins is NESTING, and it pins
 * it two-sidedly — a binding in an ENCLOSING block must still suppress (that is #931's
 * fix, one level deeper), a binding in a SIBLING block must not.
 *
 * ⚑ AND IT ASSERTS EXECUTION, NOT TEXT. A `toContain` on the emitted JS cannot see
 * placement and a line filter cannot see nesting: the defective emission was
 * TEXTUALLY correct scrml→JS, byte-for-byte what the source said. Only running it
 * shows the `ReferenceError`. So the accepting shapes here are imported and CALLED.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function build(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "e-mu-001-nested-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode: "library",
    write: true, verbose: false, log: () => {},
  });
  let artifact = null;
  try {
    for (const f of readdirSync(outDir)) if (f.endsWith(".js")) artifact = join(outDir, f);
  } catch { /* no artifact */ }
  return { codes: (r.errors || []).map((e) => e.code), artifact };
}

/* ⛑ The compiler is fail-open at the FILESYSTEM level (S397): a fatal `E-*` exits
 * non-zero and STILL writes the artifact. So `artifact !== null` proves nothing about
 * acceptance — the `codes` assertion is the one that does. */

describe("E-MU-001 and a nested-block name collision (§48.3.3, S413)", () => {
  test("the reported shape — the collision is in a SIBLING `for` body, so it must fire", () => {
    const { codes } = build(
      `\${\n  export function render(rows) {\n    let out = ""\n    for (let i = 0; i < rows.length; i = i + 1) {\n      let row = rows[i]\n      out = out + row\n    }\n    function tally() { row = ""\n      return 1 }\n    let n = tally()\n    return out + n\n  }\n}`,
      "sibling-for-body",
    );
    expect(codes).toEqual(["E-MU-001"]);
  });

  test("⚑ CONTROL — renaming the block-local away changes NOTHING; the collision was the mechanism", () => {
    // Identical program with the `for`-body binding renamed `row` -> `other`. This shape
    // fired E-MU-001 both before and after the fix. Pinning it is what makes the test
    // above a REGRESSION pin rather than a restatement of "E-MU-001 exists": the two
    // differ by a name and nothing else, and pre-fix they disagreed.
    const { codes } = build(
      `\${\n  export function render(rows) {\n    let out = ""\n    for (let i = 0; i < rows.length; i = i + 1) {\n      let other = rows[i]\n      out = out + other\n    }\n    function tally() { row = ""\n      return 1 }\n    let n = tally()\n    return out + n\n  }\n}`,
      "renamed-control",
    );
    expect(codes).toEqual(["E-MU-001"]);
  });

  test("CONTROL — two SIBLING `if` blocks collide the same way and must also fire", () => {
    const { codes } = build(
      `\${\n  export function render(flag) {\n    let total = 0\n    if (flag) {\n      let row = 1\n      total = total + row\n    }\n    if (total > 0) {\n      function bump() { row = 5\n        return 0 }\n      total = total + bump()\n    }\n    return total\n  }\n}`,
      "sibling-if-blocks",
    );
    expect(codes).toEqual(["E-MU-001"]);
  });

  // --- THE OTHER SIDE: an ENCLOSING block still suppresses, and the module RUNS -----

  test("⚑ RUNTIME-VERIFY — an ENCLOSING `for` body's binding still suppresses, and it runs", async () => {
    // #931's fix, one nesting level deeper than any of its pins. `row` IS lexically in
    // scope at `bump`'s position, so `row = row + \"!\"` is a reassignment and must not
    // register a must-use. Narrowing the crossing set to the ancestor chain must not
    // clip this — and only EXECUTION proves it, because the defective and correct
    // emissions are textually identical.
    const { codes, artifact } = build(
      `\${\n  export function render(rows) {\n    let out = ""\n    for (let i = 0; i < rows.length; i = i + 1) {\n      let row = rows[i]\n      function bump() { row = row + "!"\n        return 0 }\n      let z = bump()\n      out = out + row + z\n    }\n    return out\n  }\n}`,
      "enclosing-for-body",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.render(["a", "b"])).toBe("a!0b!0");
  });

  test("⚑ RUNTIME-VERIFY — an ENCLOSING `if` block's binding still suppresses, and it runs", async () => {
    const { codes, artifact } = build(
      `\${\n  export function render(flag) {\n    let total = 0\n    if (flag) {\n      let row = 1\n      function bump() { row = 5\n        return 0 }\n      total = total + bump() + row\n    }\n    return total\n  }\n}`,
      "enclosing-if-block",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.render(true)).toBe(5);
  });

  test("⚑ RUNTIME-VERIFY — #931's own same-body-level shape is untouched, and it runs", async () => {
    const { codes, artifact } = build(
      `\${\n  export function outer() {\n    let col = 0\n    function setCol() { col = 7\n      return 0 }\n    let r = setCol()\n    return col + r\n  }\n}`,
      "s412-same-level",
    );
    expect(codes).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.outer()).toBe(7);
  });

  test("CONTROL — `fn` is unaffected; it never received parentBindings at all", () => {
    const { codes } = build(
      `\${\n  export fn render(rows) {\n    let out = ""\n    for (let i = 0; i < rows.length; i = i + 1) {\n      let row = rows[i]\n      out = out + row\n    }\n    fn tally() { row = ""\n      return 1 }\n    let n = tally()\n    return out + n\n  }\n}`,
      "fn-kind",
    );
    expect(codes).toContain("E-FN-003");
  });
});
