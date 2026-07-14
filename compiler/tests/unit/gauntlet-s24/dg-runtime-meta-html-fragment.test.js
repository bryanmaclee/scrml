/**
 * S24 gauntlet — §2e DG false-positive on @var inside runtime ^{} meta bodies
 * whose children are html-fragment nodes carrying raw `.content` strings.
 *
 * The S23 meta-bug fix (2b) only covered compile-time meta at the MC stage.
 * Runtime ^{} meta blocks whose body parses as html-fragment still dropped
 * @var references inside the fragment's `.content` because sweepNodeForAtRefs
 * only scans expr-ish string fields (`expr`, `init`, `condition`, `value`,
 * `test`, `header`, `iterable`) — `content` isn't in the list.
 *
 * Fix: meta-body walk now regex-scans `content` on html-fragment children and
 * credits each @var ref. Plain logic-statement children keep the existing
 * sweep behavior (unchanged).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-2e-${++tmpCounter}`) {
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
    const diagnostics = [...(result.errors ?? []), ...(result.warnings ?? [])];
    return {
      errors: result.errors ?? [],
      dg002: diagnostics.filter(e => e.code === "E-DG-002"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S24 §2e — DG scans @var refs inside runtime ^{} meta html-fragment", () => {
  test("@counter referenced only inside ^{} html-fragment content no longer fires E-DG-002", () => {
    const src = `<program>
\${
  @counter = 0
}
<p>Top</>
<button onclick=\${bump()}>Bump</>
\${
  function bump() {
    ^{
      <p>@counter += 1</p>
      meta.emit(\`<p>ok</p>\`)
    }
  }
}
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002.some(e => /counter/.test(e.message))).toBe(false);
  });

  test("multiple @vars in runtime html-fragment content all credited", () => {
    const src = `<program>
\${
  @a = 1
  @b = 2
  @c = 3
}
<p>Top</>
<button onclick=\${fire()}>Fire</>
\${
  function fire() {
    ^{
      <p>@a + @b + @c</p>
      meta.emit(\`<p>fired</p>\`)
    }
  }
}
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002.some(e => /\b(@)?a\b/.test(e.message))).toBe(false);
    expect(dg002.some(e => /\b(@)?b\b/.test(e.message))).toBe(false);
    expect(dg002.some(e => /\b(@)?c\b/.test(e.message))).toBe(false);
  });

  test("genuinely-unused @var still fires E-DG-002 when only declared", () => {
    const src = `<program>
\${
  @unreadVar = 99
  @readVar = 1
}
<p>Top</>
<button onclick=\${go()}>Go</>
\${
  function go() {
    ^{
      <p>@readVar += 1</p>
      meta.emit(\`<p>ok</p>\`)
    }
  }
}
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002.some(e => /unreadVar/.test(e.message))).toBe(true);
    expect(dg002.some(e => /\breadVar\b/.test(e.message))).toBe(false);
  });
});
