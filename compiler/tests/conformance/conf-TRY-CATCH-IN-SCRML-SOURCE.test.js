/**
 * CONF-TRY-CATCH-IN-SCRML-SOURCE | §34 / §19.1
 *
 * Catalog: W-TRY-CATCH-IN-SCRML-SOURCE — Phase 3a regression guard. Per
 * §19.1, scrml's error model is values-not-exceptions: there is NO
 * try/catch and there are NO exceptions. The lint fires a warning on every
 * `try-stmt` AST node in scrml source so the safeCall / safeCallAsync
 * migration cannot silently regress.
 *
 * Firing site: `compiler/src/validators/lint-try-catch.ts:runTryCatchLint`,
 * invoked from `compiler/src/api.js` Stage 3.007 post-Gauntlet.
 *
 * The W-* prefix routes the diagnostic through `result.warnings` per
 * `api.js` classification.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const repoRoot = resolve(testDir, "../../..");
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
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

describe("CONF-TRY-CATCH-IN-SCRML-SOURCE: try/catch in scrml source fires warning", () => {
  test("POS: try/catch inside a function body fires W-TRY-CATCH-IN-SCRML-SOURCE", () => {
    const src = `\${
    function thrower() {
        try {
            let x = 1
        } catch (e) {
            let y = 2
        }
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-pos-fn");
    const hit = warnings.find(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warning");
    expect(hit.message).toMatch(/safeCall/);
    expect(hit.message).toMatch(/§19\.1/);
  });

  test("POS: try/catch/finally inside a server function fires W-TRY-CATCH-IN-SCRML-SOURCE", () => {
    const src = `\${
    server function risky() {
        try {
            let x = 1
        } catch (e) {
            let y = 2
        } finally {
            let z = 3
        }
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-pos-server");
    const hits = warnings.filter(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE");
    expect(hits.length).toBe(1);
  });

  test("POS: nested try/catch fires TWO warnings (one per try-stmt node)", () => {
    const src = `\${
    function outer() {
        try {
            try {
                let x = 1
            } catch (inner) {
                let y = 2
            }
        } catch (outer) {
            let z = 3
        }
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-pos-nested");
    const hits = warnings.filter(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE");
    expect(hits.length).toBe(2);
  });

  test("NEG: safeCall + !{} arm does NOT fire W-TRY-CATCH-IN-SCRML-SOURCE", () => {
    const src = `\${
    import { safeCall } from 'scrml:host'

    function safe() {
        let result = safeCall(() => thrower()) !{
            | ::Thrown(message, name) -> {
                let x = 0
            }
        }
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-neg-safecall");
    expect(warnings.some(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE")).toBe(false);
  });

  test("NEG: source without try/catch does NOT fire (clean baseline)", () => {
    const src = `\${
    function plain() {
        let x = 1
        return x + 1
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-neg-clean");
    expect(warnings.some(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE")).toBe(false);
  });

  test("NEG: source containing the literal string \"try\" in a quoted block does NOT fire", () => {
    const src = `\${
    function explain() {
        let msg = "try the new API"
        let advice = "we don't use try/catch here"
        return msg + " " + advice
    }
}
<p>x</>`;
    const { warnings } = compile(src, "try-catch-neg-string");
    expect(warnings.some(w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE")).toBe(false);
  });
});

describe("CONF-TRY-CATCH-IN-SCRML-SOURCE: stdlib/http regression-fire verification", () => {
  // Phase 3a context: 2 of 4 async stdlib sites remain unmigrated as of S89.
  // The lint MUST fire on these so they are surfaced regression-wise until
  // Phase 3c closes them (see master-list §0).
  const httpFile = resolve(repoRoot, "stdlib/http/index.scrml");

  test("stdlib/http/index.scrml fires W-TRY-CATCH-IN-SCRML-SOURCE on the 2 remaining sites", () => {
    // Sanity check: file exists.
    expect(existsSync(httpFile)).toBe(true);

    const result = compileScrml({
      inputFiles: [httpFile],
      write: false,
    });
    const hits = (result.warnings || []).filter(
      w => w.code === "W-TRY-CATCH-IN-SCRML-SOURCE",
    );

    // Hand-off-89 inventory: the two remaining try/catch sites pending Phase 3c
    // migration. (Line numbers shifted +4 by the scrml:random de-leak import added
    // at the top of the ${} block — DD1 Fork 1 follow-on.) Exactly two fires expected.
    expect(hits.length).toBe(2);

    // Sites carry span info; collect line numbers and assert they match the
    // known pending positions.
    const lines = hits
      .map(h => h.span?.line ?? h.tabSpan?.line)
      .filter(n => typeof n === "number")
      .sort((a, b) => a - b);

    expect(lines).toContain(69);
    expect(lines).toContain(268);
  });
});
