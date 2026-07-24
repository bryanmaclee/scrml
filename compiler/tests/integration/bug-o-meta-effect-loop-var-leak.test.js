/**
 * Bug O regression — for-of loop variable in markup leaks into meta-effect.
 *
 * Filed: 2026-04-26 by 6nz playground-six. Fixed in scrmlTS by excluding
 * for-loop iteration variables (and any let/const/lin declared inside
 * for-loop bodies) from the runtimeVars map that feeds the meta-effect's
 * frozen-scope object.
 *
 * Source: handOffs/incoming/read/2026-04-26-1041-bug-o-for-loop-var-leaks-into-meta.scrml
 *
 * Symptom (before fix): when markup contained `for (it of @list) { lift ... }`
 * AND the program also contained any `^{ ... }` meta-effect, codegen emitted
 *   _scrml_meta_effect("...", function(meta){...}, Object.freeze({
 *     ...,
 *     it: it          // <-- out-of-scope reference
 *   }), null);
 * The page threw "ReferenceError: it is not defined" at module load.
 *
 * These tests compile small fixtures end-to-end (full pipeline through CG)
 * and assert the emitted client.js does not contain the leaking name.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "bug-o-loop-leak-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let clientJs = "";
  try {
    clientJs = foldChunkNamespacing(readFileSync(join(outDir, `${name}.client.js`), "utf8"));
  } catch {
    // file missing — leave clientJs empty so assertions surface a clear failure
  }
  return { errors, clientJs };
}

// Common preamble: a runtime ^{} meta-effect that references @items, init().
// All fixtures share this shape so the meta-effect's captured-scope object is
// always emitted; the variable being asserted-absent is the loop-local one.
const PREAMBLE = `
\${
    @items = ["a", "b", "c"]
    @tick = 0
    function init() { @tick = 1 }
}

\^{ init() }
`;

describe("Bug O: for-loop variable does NOT leak into meta-effect frozen scope", () => {
  test("for-lift in markup + ^{} meta-effect: 'it' is not in the frozen scope", () => {
    const src = `${PREAMBLE}
<ul> \${
    for (it of @items) {
        lift <li>\${it}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("for-lift-with-meta", src);
    expect(errors).toEqual([]);
    expect(clientJs.length).toBeGreaterThan(0);

    // Locate the _scrml_meta_effect call(s) and verify NONE of them embed
    // the loop variable as a captured binding.
    expect(clientJs).toContain("_scrml_meta_effect");
    expect(clientJs).not.toMatch(/it:\s*it\b/);
    expect(clientJs).not.toMatch(/Object\.freeze\(\{[^}]*\bit:\s*it\b[^}]*\}\)/);

    // The meta-effect's frozen-scope object SHOULD still capture module-scope
    // names: items (reactive getter), tick (reactive getter), init (function).
    expect(clientJs).toMatch(/get items\(\)/);
    expect(clientJs).toMatch(/get tick\(\)/);
    expect(clientJs).toMatch(/init:\s*\w+/);
  });

  test("for-lift alone (no ^{} meta-effect): compiles cleanly", () => {
    const src = `
\${
    @items = ["a", "b", "c"]
}

<ul> \${
    for (it of @items) {
        lift <li>\${it}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("for-lift-no-meta", src);
    expect(errors).toEqual([]);
    expect(clientJs.length).toBeGreaterThan(0);
    // No meta-effect means there should be no Object.freeze captured-scope
    // emission at all in this fixture.
    expect(clientJs).not.toContain("_scrml_meta_effect");
  });

  test("^{} meta-effect alone (no for-loop in markup): compiles cleanly", () => {
    const src = `${PREAMBLE}
<div>tick: \${@tick}</>
`;
    const { errors, clientJs } = compileSource("meta-no-for-loop", src);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_meta_effect");
    expect(clientJs).not.toMatch(/it:\s*it\b/);
  });

  test("multiple ^{} blocks + for-lift: NONE of the meta-effects leak the loop var", () => {
    const src = `
\${
    @items = ["a", "b", "c"]
    @tick = 0
    function init() { @tick = 1 }
    function tick2() { @tick = 2 }
}

\^{ init() }
\^{ tick2() }

<ul> \${
    for (it of @items) {
        lift <li>\${it}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("multi-meta-for-lift", src);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_meta_effect");
    // Two meta-effects, neither should leak the loop variable.
    const occurrences = (clientJs.match(/_scrml_meta_effect/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(clientJs).not.toMatch(/it:\s*it\b/);
  });

  test("different lift binding shape (renamed loop-var): no leak", () => {
    const src = `${PREAMBLE}
<ul> \${
    for (renamedItem of @items) {
        lift <li>\${renamedItem}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("renamed-loop-var", src);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_meta_effect");
    expect(clientJs).not.toMatch(/renamedItem:\s*renamedItem\b/);
  });

  test("let declared INSIDE for-loop body does NOT leak into meta-effect", () => {
    const src = `${PREAMBLE}
<ul> \${
    for (it of @items) {
        let local_inner = "x"
        lift <li>\${it}-\${local_inner}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("let-in-for-body", src);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_meta_effect");
    expect(clientJs).not.toMatch(/it:\s*it\b/);
    expect(clientJs).not.toMatch(/local_inner:\s*local_inner\b/);
  });

  test("indexed for-loop (var + index): neither leaks into meta-effect", () => {
    const src = `${PREAMBLE}
<ul> \${
    for (it, i of @items) {
        lift <li>\${i}: \${it}</li>
    }
} </ul>
`;
    const { errors, clientJs } = compileSource("indexed-for-lift", src);
    // This shape may or may not be supported; if it compiles, neither name
    // should leak. If it doesn't compile, surfacing an error is acceptable —
    // we only care about NO leak in the emitted code.
    if (errors.length === 0) {
      expect(clientJs).toContain("_scrml_meta_effect");
      expect(clientJs).not.toMatch(/it:\s*it\b/);
      expect(clientJs).not.toMatch(/\bi:\s*i\b/);
    }
  });
});
