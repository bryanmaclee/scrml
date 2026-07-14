/**
 * §48 `fn` implicit-return (tail-expression) — end-to-end codegen tests
 *
 * Covers the Bug G resolution: `fn name() -> T { <tail-expr> }` must emit
 * `return <tail-expr>` at the end of the generated function body so the
 * function actually returns a value.
 *
 * The tail may be:
 *   - a bare expression statement (`42`, `"hello"`, `x + 1`)
 *   - a `match` expression (lowered to an IIFE)
 *   - a `switch` expression (treated as expression)
 *
 * `function` (non-shorthand) is unchanged — no implicit return; callers
 * must write `return` explicitly.
 *
 * Origin: 6nz Bug G (handOffs/incoming/read/2026-04-20-1624-6nz-to-scrmlTS-fn-decl-body-dropped.md)
 * Reference source using this idiom: `examples/14-mario-state-machine.scrml` (riskBanner).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `fn-implicit-return-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_fn_implicit_return_${tag}`);
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
        clientJs = output.clientJs ?? output.libraryJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
  }
}

/** Extract the body of function `name` from emitted JS (mangled lookup). */
function extractFnBody(js, baseName) {
  if (!js) return null;
  const re = new RegExp(`function\\s+(?:_scrml_)?${baseName}_?\\d*\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = js.match(re);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// §1: fn shorthand with bare-expr tail → implicit return
// ---------------------------------------------------------------------------

describe("fn implicit-return §1: bare-expr tail", () => {
  test("fn with literal tail emits `return <literal>;`", () => {
    const src = `<program>\n\${\n  fn greet() -> string {\n    "hello"\n  }\n  @msg: string = greet()\n}\n<p>\${@msg}</p>\n</program>\n`;
    const { errors, clientJs } = compileSource(src, "bare-expr-literal");
    expect(errors.filter(e => !e.code?.startsWith("W-"))).toEqual([]);
    const body = extractFnBody(clientJs, "greet");
    expect(body).not.toBeNull();
    expect(body).toMatch(/return\s+"hello"\s*;/);
  });

  test("fn with arithmetic tail emits `return <expr>;`", () => {
    const src = `<program>\n\${\n  fn double(x: int) -> int {\n    x * 2\n  }\n  @val: int = double(21)\n}\n<p>\${@val}</p>\n</program>\n`;
    const { errors, clientJs } = compileSource(src, "bare-expr-arith");
    expect(errors.filter(e => !e.code?.startsWith("W-"))).toEqual([]);
    const body = extractFnBody(clientJs, "double");
    expect(body).not.toBeNull();
    expect(body).toMatch(/return\s+x\s*\*\s*2\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §2: fn shorthand with match-stmt tail (Bug G core case)
// ---------------------------------------------------------------------------

describe("fn implicit-return §2: match tail (Bug G)", () => {
  test("fn with match tail emits `return (function(){...})();`", () => {
    const src = `<program>
\${
  type Color:enum = { Red, Green, Blue }

  fn colorName(c: Color) -> string {
    match c {
      .Red => "red"
      .Green => "green"
      .Blue => "blue"
    }
  }

  @current: Color = Color.Red
}
<p>\${colorName(@current)}</p>
</program>
`;
    const { errors, clientJs } = compileSource(src, "match-tail");
    expect(errors.filter(e => !e.code?.startsWith("W-"))).toEqual([]);
    const body = extractFnBody(clientJs, "colorName");
    expect(body).not.toBeNull();
    // Must return the IIFE — not just evaluate it and discard.
    expect(body).toMatch(/return\s+\(function\s*\(\s*\)\s*\{/);
  });

  test("output passes `node --check` (syntactically valid JS)", async () => {
    const src = `<program>
\${
  type Tri:enum = { A, B, C }
  fn name(t: Tri) -> string {
    match t { .A => "a"  .B => "b"  .C => "c" }
  }
  @x: Tri = Tri.A
}
<p>\${name(@x)}</p>
</program>
`;
    const { clientJs } = compileSource(src, "node-check");
    expect(clientJs).not.toBeNull();
    // Use the Function constructor as a syntactic check — throws on parse errors.
    expect(() => new Function(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3: plain `function` keyword — NOT affected (backward compat)
// ---------------------------------------------------------------------------

describe("fn implicit-return §3: function keyword is unchanged", () => {
  test("plain function with bare-expr tail does NOT get implicit return", () => {
    const src = `<program>\n\${\n  function side() {\n    doWork()\n  }\n}\n<p>test</p>\n</program>\n`;
    const { errors, clientJs } = compileSource(src, "function-keyword");
    // Errors other than warnings are unacceptable.
    expect(errors.filter(e => !e.code?.startsWith("W-") && !e.code?.startsWith("E-SCOPE"))).toEqual([]);
    const body = extractFnBody(clientJs, "side");
    expect(body).not.toBeNull();
    // The call should appear as a bare statement, not wrapped in `return`.
    expect(body).toMatch(/doWork\s*\(\s*\)\s*;/);
    expect(body).not.toMatch(/return\s+doWork/);
  });
});
