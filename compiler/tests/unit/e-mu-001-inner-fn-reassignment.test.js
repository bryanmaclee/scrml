/* SPDX-License-Identifier: MIT
 *
 * Unit — g-e-mu-001-overfires-on-binding-mutated-from-inner-fn (S412).
 *
 * `E-MU-001` reported a variable "declared but never used before this scope closes"
 * for a binding that a `return` statement in the same function plainly reads:
 *
 *     export function outer() {
 *       let col = 0
 *       function setCol() { col = 7
 *         return 0 }
 *       let r = setCol()
 *       return col + r        // ← `col` IS read, right here
 *     }
 *
 * `type-system.ts`'s `checkLinear` withheld `parentBindings` from EVERY inner-function
 * body, justified as *"function bodies are a closed scope; outer names cannot be
 * reassigned from inside (E-FN-003 enforces that)."*
 *
 * ⚑ E-FN-003 enforces that for `fn` ONLY. SPEC.md:5986 is explicit: *"Inner `function`
 * declarations MAY mutate outer `let` bindings. Inner `fn` declarations are subject to
 * the same purity constraints as top-level `fn` (§48) — they may read outer bindings
 * but may not mutate them (E-FN-003)."* The comment generalised an `fn`-only rule to
 * both forms.
 *
 * Without `parentBindings`, §48.3.3's reassignment-vs-declaration discriminator could
 * not see that `col` was already bound outside, so `col = 7` registered a FRESH must-use
 * entry scoped to the inner body — which nothing there reads.
 *
 * ⚑ SAME ROOT AS THE S412 `emit-logic.ts` FIX, IN A SECOND CONSUMER. Two independent
 * places each re-derived "what is bound in the enclosing scope?" and each got the
 * inner-function case wrong. In both, the justifying COMMENT was the giveaway.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
function codes(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "e-mu-001-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const r = compileScrml({
    inputFiles: [file], outputDir: join(TMP, `${name}.dist`), mode: "library",
    write: true, verbose: false, log: () => {},
  });
  return (r.errors || []).map((e) => e.code);
}

describe("E-MU-001 and an inner-function reassignment (§5986 / §48.3.3, S412)", () => {
  test("the reported shape — written in an inner `function`, read in the outer scope", () => {
    expect(codes(
      `\${\n  export function outer() {\n    let col = 0\n    function setCol() { col = 7\n      return 0 }\n    let r = setCol()\n    return col + r\n  }\n}`,
      "reported",
    )).toEqual([]);
  });

  test("nested deeper — the reassignment is inside an `if` inside the inner fn", () => {
    expect(codes(
      `\${\n  export function outer() {\n    let col = 0\n    function setCol(n) { if (n > 0) { col = 7 }\n      return 0 }\n    let r = setCol(1)\n    return col + r\n  }\n}`,
      "nested",
    )).toEqual([]);
  });

  // --- CONTROLS: the discriminator is `function` vs `fn`, and it must stay sharp ----
  test("CONTROL — an `fn` still may NOT mutate an outer binding (E-FN-003)", () => {
    // For `fn` the original "closed scope" reasoning genuinely holds: mutation is
    // forbidden and E-FN-003 is the diagnostic that should fire. Passing
    // parentBindings there would be wrong, so the fix is conditioned on fnKind.
    expect(codes(
      `\${\n  export fn outer() {\n    let col = 0\n    fn setCol() { col = 7\n      return 0 }\n    let r = setCol()\n    return col + r\n  }\n}`,
      "fn-purity",
    )).toContain("E-FN-003");
  });

  test("CONTROL — a genuine must-use declaration inside an inner fn STILL fires", () => {
    // The canonical `must-use-unread-pos` shape: a bare assignment to a name bound in
    // NO enclosing scope is a DECLARATION (§48.3.3), and never reading it is E-MU-001.
    // `parentBindings` must not swallow this — it only reclassifies names already bound.
    expect(codes(
      `\${\n  export function outer() {\n    function go() { unusedThing = 42\n      return 1 }\n    return go()\n  }\n}`,
      "genuine-must-use",
    )).toContain("E-MU-001");
  });

  test("CONTROL — the same declaration READ in its own scope is clean", () => {
    expect(codes(
      `\${\n  export function outer() {\n    function go() { usedThing = 42\n      return usedThing }\n    return go()\n  }\n}`,
      "genuine-read",
    )).toEqual([]);
  });

  test("CONTROL — no inner function at all is unaffected", () => {
    expect(codes(
      `\${\n  export function outer() {\n    let col = 0\n    col = 7\n    return col\n  }\n}`,
      "no-inner-fn",
    )).toEqual([]);
  });
});
