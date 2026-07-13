/**
 * error-samples-compile-clean.test.js
 *
 * Green-trap guard (S253 — mint-e-type-082 adversarial review). The flagship §19
 * error-handling samples under samples/compilation-tests/gauntlet-s20-error-test/
 * are annotated `// Should compile clean` but had NO compile-clean assertion — they
 * are not in compile-test-samples.sh's 13-file allowlist and no unit test compiled
 * them. That gap let four samples silently regress 0->1 error (E-TYPE-082) when the
 * enum-variant construction arity check landed (each declared a NULLARY error
 * variant then `fail`ed it with a payload — the exact bug E-TYPE-082 closes).
 *
 * This data-driven guard compiles EVERY sample in that directory whose header says
 * "Should compile clean" and asserts zero fatal (error-severity) diagnostics. It is
 * self-maintaining: new compile-clean samples are covered automatically; samples
 * annotated with an EXPECTED error code (negative fixtures) are skipped.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";

const SAMPLES_DIR = resolve(
  join(import.meta.dir, "../../../../samples/compilation-tests/gauntlet-s20-error-test"),
);

/** Samples whose first few lines declare the compile-clean contract. */
function compileCleanSamples() {
  return readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".scrml"))
    .filter((f) => {
      const head = readFileSync(join(SAMPLES_DIR, f), "utf8").split("\n").slice(0, 4).join("\n");
      return /should compile clean/i.test(head);
    })
    .sort();
}

describe("gauntlet-s20 error samples — compile-clean contract (§19)", () => {
  const samples = compileCleanSamples();

  test("the compile-clean sample set is non-empty (guard is wired)", () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  for (const name of samples) {
    test(`${name} compiles with zero error-severity diagnostics`, () => {
      const filePath = join(SAMPLES_DIR, name);
      const result = compileScrml({
        inputFiles: [filePath],
        write: false,
        log: () => {},
      });
      const fatal = (result.errors || []).filter(
        (e) => e && e.severity !== "warning" && e.severity !== "info",
      );
      const shown = fatal.map((e) => `${e.code}: ${e.message}`).join("\n");
      expect(shown).toBe("");
      expect(fatal).toHaveLength(0);
    });
  }
});
