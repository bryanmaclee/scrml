/**
 * S23 gauntlet — S20-deferred meta bug fixes.
 *
 * Covers the meta-related bugs carried forward in hand-off-23.md §2:
 *   - 2c: DG false-positive for @var via meta.get() / meta.bindings.X
 *         (regression tests live in unit/dependency-graph.test.js alongside
 *         the other BUG-META tests; this file doesn't duplicate them.)
 *   - 2a: lin + ^{} capture not counted as consumption (§22.5.3)
 *         Tested here: single capture compiles clean, double capture fires
 *         E-LIN-002, member-chain / template-literal paths also consume.
 *   - 2b: compile-time-only phase separation at checker-time (queued)
 *   - 2d: nested ^{} in compile-time meta crashes eval (queued)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s23-meta-${++tmpCounter}`) {
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
      linErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-LIN")),
      dgErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-DG")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S23 gauntlet 2a — lin + ^{} capture consumes (§22.5.3)", () => {
  test("single ^{} capture via meta.bindings.token → clean compile", () => {
    const src = `<program>
\${
  lin token = "secret-123"
}
<div>
  ^{
    meta.emit(\`<p>Token: \${meta.bindings.token}</p>\`)
  }
</div>
</program>
`;
    const { linErrors } = compileSrc(src);
    // No E-LIN-001 ("never consumed") and no E-LIN-002.
    expect(linErrors).toEqual([]);
  });

  test("two ^{} blocks capturing the same lin via meta.bindings → E-LIN-002", () => {
    const src = `<program>
\${
  lin token = "secret-123"
}
<div>
  ^{ meta.emit(\`<p>1: \${meta.bindings.token}</p>\`) }
  ^{ meta.emit(\`<p>2: \${meta.bindings.token}</p>\`) }
</div>
</program>
`;
    const { linErrors } = compileSrc(src);
    expect(linErrors.some(e => e.code === "E-LIN-002" && /token/.test(e.message))).toBe(true);
  });

  test("^{} capture via meta.bindings.token + later markup ${token} → E-LIN-002", () => {
    const src = `<program>
\${
  lin token = "secret-123"
}
<div>
  ^{ meta.emit(\`<p>\${meta.bindings.token}</p>\`) }
  <p>\${token}</>
</div>
</program>
`;
    const { linErrors } = compileSrc(src);
    // Capture consumes once; the outer ${token} is a second consumption.
    expect(linErrors.some(e => e.code === "E-LIN-002" && /token/.test(e.message))).toBe(true);
  });

  test("^{} with template-literal interpolation ${x} consumes lin", () => {
    // Template literals with interpolations degrade to escape-hatch in the
    // ExprNode, so a plain forEachIdentInExprNode walk misses the `x` ref.
    // The §22.5.3 meta-capture scanner must fall back to a raw-string scan.
    const src = `<program>
\${
  function fnConsume(v) { return v }
  lin x = 42
  ^{ fnConsume(\`\${x}\`) }
}
<p>ok</>
</program>
`;
    const { linErrors } = compileSrc(src);
    expect(linErrors).toEqual([]);
  });

  test("^{} that doesn't reference lin does NOT consume it", () => {
    // Guard against over-consumption: a meta block that doesn't mention the
    // lin var should not be treated as capturing it.
    const src = `<program>
\${
  lin token = "secret-123"
  function fnConsume(v) { return v }
  ^{ meta.emit("<p>hi</p>") }
  fnConsume(token)
}
<p>ok</>
</program>
`;
    const { linErrors } = compileSrc(src);
    // fnConsume(token) is the single consumption; the meta doesn't touch it.
    expect(linErrors).toEqual([]);
  });
});

describe("S23 gauntlet 2b — phase separation at checker-time, not eval-time", () => {
  test("compile-time meta referencing @var fires E-META-005 at MC, not E-META-EVAL-001 at ME", () => {
    const src = `<program>
\${
  @counter = 0
}
<div>
  ^{
    emit("<p>Hello</p>")
    @counter += 1
  }
</div>
</program>
`;
    const { errors } = compileSrc(src);
    // Must fire E-META-005 at MC.
    const mc = errors.find(e => e.code === "E-META-005");
    expect(mc).toBeDefined();
    // Must NOT fire E-META-EVAL-001 at ME (the eval pass was previously
    // crashing with "Invalid character: '@'" — that's the bug).
    const evalCrash = errors.find(e => e.code === "E-META-EVAL-001");
    expect(evalCrash).toBeUndefined();
  });

  test("pure compile-time meta still compiles clean", () => {
    const src = `<program>
\${ const title = "Test" }
<div>
  ^{
    emit(\`<p>\${title}</p>\`)
  }
</div>
</program>
`;
    const { errors } = compileSrc(src);
    const fatal = errors.filter(e => e.severity !== "warning");
    expect(fatal).toEqual([]);
  });
});

describe("S23 gauntlet 2d — nested ^{} flagged at checker-time, not crash at eval", () => {
  test("nested compile-time ^{} inside compile-time ^{} fires E-META-009 at MC only", () => {
    const src = `<program>
^{
  emit("<div>")
  ^{
    emit("<p>Inner meta</p>")
  }
  emit("</div>")
}
</program>
`;
    const { errors } = compileSrc(src);
    const nested = errors.find(e => e.code === "E-META-009");
    expect(nested).toBeDefined();
    // The eval-stage crash must not fire.
    const evalCrash = errors.find(e => e.code === "E-META-EVAL-001");
    expect(evalCrash).toBeUndefined();
  });

  test("non-nested sibling ^{} blocks compile fine", () => {
    // Guard: two adjacent ^{} blocks are not "nested" — they're siblings.
    const src = `<program>
<div>
  ^{ emit("<p>a</p>") }
  ^{ emit("<p>b</p>") }
</div>
</program>
`;
    const { errors } = compileSrc(src);
    const nested = errors.find(e => e.code === "E-META-009");
    expect(nested).toBeUndefined();
  });
});
