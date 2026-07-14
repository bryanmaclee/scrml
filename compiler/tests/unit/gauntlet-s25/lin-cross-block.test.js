/**
 * S25 gauntlet — §35.2.2 cross-`${}` block lin.
 *
 * A `lin` variable declared in one program-level `${}` logic block may be
 * consumed in a later `${}` block or in an intervening markup
 * interpolation, within the same parent scope. This is the "cross-block
 * lin" feature from the lin-discontinuous-scoping deep-dive (Approach B).
 *
 * The behavior was already wired up in prior sessions — program-level
 * `checkLinear` walks the full node tree and the JS emitter hoists the
 * `const token = ...;` to the common ancestor. These tests formalize the
 * contract so it doesn't regress.
 *
 * Positive cases (expect no lin errors):
 *   - declare in block A, consume in block B
 *   - declare in block A, consume in markup interpolation
 *
 * Negative cases (expect the exact lin error):
 *   - declared, never consumed → E-LIN-001
 *   - intermediate reference then later consume → E-LIN-002 (any reference
 *     is a consumption under Approach B §35.2)
 *   - consumed twice across blocks → E-LIN-002
 *
 * Deep-dive: scrml-support/docs/deep-dives/lin-discontinuous-scoping-2026-04-13.md
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-crossblock-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, `${testName}.client.js`);
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      lin: (result.errors ?? []).filter(e => String(e.code ?? "").startsWith("E-LIN")),
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §35.2.2 — cross-`${}` block lin", () => {
  test("declare in block A, consume in block B → no lin errors; hoisted to common scope", () => {
    const src = `<program>
\${
  lin token = "xyz"
}
<p>middle</>
\${
  console.log(token)
}
</program>
`;
    const { lin, clientJs } = compileSrc(src);
    expect(lin).toEqual([]);
    // Hoisting: const token emitted once at program scope (not inside a
    // block-local IIFE), and the consumption reference is present.
    expect(clientJs).toContain("const token");
    expect(clientJs).toContain("console.log(token)");
    expect(clientJs.match(/const token/g)?.length ?? 0).toBe(1);
  });

  test("declare in block, consume via markup interpolation → no lin errors", () => {
    const src = `<program>
\${
  lin token = "xyz"
}
<p>Value is \${token}</>
</program>
`;
    const { lin } = compileSrc(src);
    expect(lin).toEqual([]);
  });

  test("declared, never consumed → E-LIN-001", () => {
    const src = `<program>
\${
  lin token = "xyz"
}
<p>nothing uses it</>
</program>
`;
    const { lin } = compileSrc(src);
    expect(lin.some(e => e.code === "E-LIN-001" && /\btoken\b/.test(e.message))).toBe(true);
  });

  test("intermediate reference then later consume → E-LIN-002", () => {
    const src = `<program>
\${
  lin token = "xyz"
}
<p>Peek: \${token}</>
<p>after</>
\${
  console.log(token)
}
</program>
`;
    const { lin } = compileSrc(src);
    expect(lin.some(e => e.code === "E-LIN-002" && /\btoken\b/.test(e.message))).toBe(true);
  });

  test("consumed in two different later blocks → E-LIN-002", () => {
    const src = `<program>
\${
  lin token = "xyz"
}
<p>middle</>
\${
  console.log(token)
}
<p>later</>
\${
  console.log(token)
}
</program>
`;
    const { lin } = compileSrc(src);
    expect(lin.some(e => e.code === "E-LIN-002" && /\btoken\b/.test(e.message))).toBe(true);
  });

  test("two separate lin vars, each consumed once in a later block → no errors", () => {
    const src = `<program>
\${
  lin a = "aval"
  lin b = "bval"
}
<p>between</>
\${
  console.log(a)
  console.log(b)
}
</program>
`;
    const { lin } = compileSrc(src);
    expect(lin).toEqual([]);
  });
});
