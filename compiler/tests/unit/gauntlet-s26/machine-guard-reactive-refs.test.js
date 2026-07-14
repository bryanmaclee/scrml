/**
 * S26 bug A — machine guard expressions with @reactive references.
 *
 * Before this fix, `rule.guard` flowed from type-system.ts into emit-machines.ts
 * as raw scrml text. The emitter interpolated it into the JS output verbatim:
 *
 *   if (__key === "Open:Closed" && !(@allow)) { throw ... }
 *
 * which is a syntax error (raw `@` is not a JS token). `@reactive` guards
 * compiled but produced invalid JS that failed at load time with
 * `SyntaxError: Invalid or unexpected token`.
 *
 * The fix applies `rewriteExpr` to the guard string before emitting the JS
 * evaluation, so `@allow` becomes `_scrml_reactive_get("allow")`. The
 * diagnostic "Guard:" text in the error message keeps the original scrml
 * form so users see the source they wrote.
 *
 * This covers:
 *   - guard with one @reactive ref compiles to valid JS
 *   - guard with multiple @reactive refs compiles to valid JS
 *   - guard with mixed @reactive + literal compiles to valid JS
 *   - emitted guard evaluates truthy/falsy correctly when exercised
 *     through a reactive store
 *   - projection-machine (derived) guards also get rewritten
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

// Use a per-compile random suffix so parallel tests in the same file cannot
// collide on the tmp path or output filename.
function compileAndInspect(source, label = "s26-guard") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${label}-${uniq}`;
  // Place tmp dirs under /tmp, not under compiler/tests/ — writing output
  // files into the test tree causes bun test to re-glob them and spuriously
  // re-execute the suite, which observably changes compiler output on the
  // second pass.
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S26 bug A — machine guard @reactive refs rewritten to _scrml_reactive_get", () => {
  test("guard with single @reactive ref: emitted JS is syntactically valid", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  @allow: boolean = true
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@allow) [canClose]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, clientJs } = compileAndInspect(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // The guard evaluation must use the reactive-getter, not raw @
    expect(clientJs).toContain('!(_scrml_reactive_get("allow"))');
    // The diagnostic string keeps the raw @ form (user-facing)
    expect(clientJs).toContain("Guard: @allow");
    // Post-fix: no raw @name tokens outside string literals in the guard block.
    // We assert the specific pre-fix bug shape is gone.
    expect(clientJs).not.toContain("!(@allow)");
  });

  test("guard with multiple @reactive refs: all rewritten", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  @a: boolean = true
  @b: boolean = true
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@a && @b) [both]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, clientJs } = compileAndInspect(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("a")');
    expect(clientJs).toContain('_scrml_reactive_get("b")');
    expect(clientJs).not.toContain("!(@a && @b)");
  });

  test("guard with @ mixed with literals and operators: rewritten correctly", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  @count: number = 5
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@count > 3) [threshold]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, clientJs } = compileAndInspect(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("count") > 3');
  });

  test("guard with no @reactive (literal true): still valid JS (regression guard)", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (true) [always]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, clientJs } = compileAndInspect(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Literal true survives rewriteExpr unchanged
    expect(clientJs).toContain("&& !(true)");
  });

  test("emitted guard actually evaluates correctly at runtime (truthy path)", async () => {
    // Compile a file with a reactive-ref guard, then dynamically eval the
    // guard expression against a synthetic reactive store.
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  @allow: boolean = true
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@allow) [canClose]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, clientJs } = compileAndInspect(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Extract the guard JS from the compiled output and evaluate it directly
    // against a stub reactive-getter. This isolates "guard expression is
    // valid JS and reads the reactive value" from the rest of the pipeline.
    const guardMatch = clientJs.match(/!\((_scrml_reactive_get\("allow"\))\)/);
    expect(guardMatch).not.toBeNull();
    const exprText = guardMatch[1];
    // Evaluate truthy
    let storeValue = true;
    const readerTruthy = new Function("_scrml_reactive_get", `return ${exprText};`);
    expect(readerTruthy((k) => storeValue)).toBe(true);
    // Evaluate falsy
    storeValue = false;
    expect(readerTruthy((k) => storeValue)).toBe(false);
  });

  // Projection-machine (derived) guard coverage is intentionally deferred
  // from this slice — the projection emit path (emitProjectionFunction) also
  // applies the rewrite, but the scrml surface for derived-machine guards is
  // more finicky (attribute vs sentence form, rule ordering) and deserves
  // its own focused test file rather than riding the bug-A coverage.
});
