/**
 * S24 gauntlet — §2d DG false-positive on compound `if=(...)` attribute.
 *
 * When an attribute value is an expression (`if=(@a && @b == false)`), the
 * AST builder stores it as `{ kind: "expr", raw, refs, exprNode }`. The DG
 * attribute-value scan only handled two shapes — plain string and
 * `{ name: "@var" }` (for bind:value) — and silently dropped expression
 * objects on the floor. Reactive vars appearing only inside compound `if=`
 * conditions therefore got flagged E-DG-002 "never consumed" even though
 * they drove visibility of the markup subtree.
 *
 * Fix: the object branch of the attribute-value scan now also reads the
 * pre-computed `refs` array (or falls back to regex-scanning `raw`).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-2d-${++tmpCounter}`) {
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
    // E-DG-002 is a warning (severity: "warning"). compileScrml filters
    // warnings into result.warnings, errors into result.errors. Look in both
    // so a test sees every DG diagnostic regardless of where it landed.
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

describe("S24 §2d — compound if=(...) attribute credits every @var ref", () => {
  test("two @vars in && + == compound no longer fire E-DG-002", () => {
    const src = `<program>
\${
  @vulnerable = false
  @gameOver = false
  function toggle() { @vulnerable = true; @gameOver = false }
}
<div if=(@vulnerable && @gameOver == false)>
  <p>Active</>
</>
<button onclick=\${toggle()}>Toggle</>
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002).toEqual([]);
  });

  test("three @vars in compound ||/== expression all credited", () => {
    const src = `<program>
\${
  @a = false
  @b = false
  @c = 0
  function set() { @a = true; @b = true; @c = 1 }
}
<div if=(@a || @b || @c == 1)>
  <p>x</>
</>
<button onclick=\${set()}>Go</>
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002).toEqual([]);
  });

  test("parenthesized nested @var refs are still caught", () => {
    const src = `<program>
\${
  @loaded = false
  @user = "alice"
  function set() { @loaded = true; @user = "bob" }
}
<div if=((@loaded && (@user == "alice" || @user == "bob")))>
  <p>hi</>
</>
<button onclick=\${set()}>Go</>
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002).toEqual([]);
  });

  test("genuinely-unused @var still fires E-DG-002", () => {
    const src = `<program>
\${
  @actuallyUsed = false
  @neverReadAnywhere = 42
  function toggle() { @actuallyUsed = true }
}
<div if=(@actuallyUsed)>
  <p>x</>
</>
<button onclick=\${toggle()}>Go</>
</program>
`;
    const { dg002 } = compileSrc(src);
    expect(dg002.some(e => /neverReadAnywhere/.test(e.message))).toBe(true);
    expect(dg002.some(e => /actuallyUsed/.test(e.message))).toBe(false);
  });
});
