/**
 * Bug H — function with return-type annotation + match body drops return
 *
 * Reproducer: `function colorName(c: Color) -> string { match c { .Red => "red" ... } }`
 * Expected compiled: `return (function() { ... })();`
 * Actual (before fix): `(function() { ... })();` — missing `return`, function returns undefined
 *
 * Root cause: `emitFnShortcutBody` only applied implicit tail-expression return for
 * `fnKind === "fn"`. Regular `function` declarations with return-type annotations
 * (`-> T` or `: T`) had `fnKind: "function"` and were skipped.
 *
 * Fix: AST builder now records `hasReturnType: true` on function-decl nodes when a
 * return-type annotation is present. `emitFnShortcutBody` applies implicit return
 * when either `fnKind === "fn"` or `hasReturnType` is set.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bugh-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bugh_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

describe("Bug H — function return-type + match implicit return", () => {

  test("function with -> ReturnType and match body emits return before IIFE", () => {
    const src = `<program>
\${
  type Color:enum = { Red, Green, Blue }
  function colorName(c: Color) -> string {
    match c {
      .Red => "red"
      .Green => "green"
      .Blue => "blue"
    }
  }
  @result = colorName(Color.Red)
}
<div>\${@result}</div>
</program>`;
    const { clientJs } = compileSource(src, "arrow-rettype-match");
    expect(clientJs).toBeTruthy();
    // The function body should contain `return (function()` — not bare `(function()`
    expect(clientJs).toContain("return (function()");
  });

  test("function with : ReturnType (colon form) and match body emits return", () => {
    const src = `<program>
\${
  type Dir:enum = { Up, Down }
  function dirName(d: Dir) : string {
    match d {
      .Up => "up"
      .Down => "down"
    }
  }
  @r = dirName(Dir.Up)
}
<div>\${@r}</div>
</program>`;
    const { clientJs } = compileSource(src, "colon-rettype-match");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain("return (function()");
  });

  test("function WITHOUT return-type annotation does NOT get implicit return", () => {
    const src = `<program>
\${
  type Mode:enum = { A, B }
  function getMode(m: Mode) {
    match m {
      .A => "a"
      .B => "b"
    }
  }
  @r = getMode(Mode.A)
}
<div>\${@r}</div>
</program>`;
    const { clientJs } = compileSource(src, "no-rettype-no-implicit-return");
    expect(clientJs).toBeTruthy();
    // Find the getMode function body and verify no implicit return was added
    // The IIFE should appear without a preceding `return`
    const lines = clientJs.split("\n");
    let foundFn = false;
    let hasReturnBeforeIIFE = false;
    for (const line of lines) {
      if (line.match(/function\s+\w*getMode/)) foundFn = true;
      if (foundFn && line.includes("return (function()")) hasReturnBeforeIIFE = true;
      if (foundFn && line.match(/^\s*\}\s*$/)) break;
    }
    expect(foundFn).toBe(true);
    expect(hasReturnBeforeIIFE).toBe(false);
  });

  test("fn shorthand with match body still works (regression check)", () => {
    const src = `<program>
\${
  type AB:enum = { A, B }
  fn pick(x: AB) -> string {
    match x {
      .A => "alpha"
      .B => "beta"
    }
  }
  @r = pick(AB.A)
}
<div>\${@r}</div>
</program>`;
    const { clientJs } = compileSource(src, "fn-match-regression");
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain("return (function()");
  });

  test("function with return-type and bare expression tail gets implicit return", () => {
    const src = `<program>
\${
  function double(n: number) -> number {
    n * 2
  }
  @r = double(5)
}
<div>\${@r}</div>
</program>`;
    const { clientJs } = compileSource(src, "rettype-bare-expr");
    expect(clientJs).toBeTruthy();
    // Should have `return n * 2;` or `return _scrml_... * 2;`
    expect(clientJs).toMatch(/return\s+.*\*\s*2/);
  });

});
