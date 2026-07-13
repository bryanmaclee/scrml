/**
 * error-handling-codegen.test.js — Regression tests for §19 error handling codegen
 *
 * Fixed in S21:
 *   1. `fail` inside nested bodies (if/for/function) was emitted as literal `fail;`
 *      — caused by parseOneStatement not recognizing the `fail` keyword.
 *   2. `fail Type.Variant` (canonical `.` separator) was rejected — parser only
 *      accepted `::` alias.
 *   3. `fail Type.Variant` (no args) emitted `data: ` (syntax error) instead of
 *      a defined value. S90 (M-7C-D-12 Track 3, OQ-5(a)): the canonical fallback
 *      is `data: null` (scrml absence sentinel per §42.5/§42.8).
 *   4. `?` propagation inside nested bodies emitted literal `?;` — same parser
 *      issue as #1.
 *   5. `!{}` inline catch used try/catch, but `fail` returns a tagged object
 *      (not a throw) per §19.3.2 — mismatch meant nothing was ever caught.
 *   6. E-ERROR-001 (fail in non-failable function) was unreachable because
 *      `fail` never parsed inside function bodies.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/error-handling-codegen");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
  const allErrors = result.errors || [];
  const fatalErrors = allErrors.filter((e) => e.severity !== "warning");
  const outPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
  const clientJs = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  return { errors: allErrors, fatalErrors, clientJs };
}

// ---------------------------------------------------------------------------
// fail codegen
// ---------------------------------------------------------------------------

describe("fail codegen (§19.3)", () => {
  test("fail Type.Variant(args) inside if-body emits tagged return", () => {
    const source = `\${
  type E:enum = { Bad(reason:string) }
  function f(x)! -> E {
    if (x < 0) { fail E.Bad("negative") }
    return "ok"
  }
}
<p>x</>`;
    const { fatalErrors, clientJs } = compileSource(source, "fail-nested.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`return { __scrml_error: true, type: "E", variant: "Bad", data: { reason: "negative" } };`);
    expect(clientJs).not.toContain(`fail;`);
  });

  test("fail with :: alias is equivalent to fail with . separator", () => {
    const source = `\${
  type E:enum = { A(v:string) }
  function f()! -> E {
    fail E::A("one")
  }
  function g()! -> E {
    fail E.A("one")
  }
}
<p>x</>`;
    const { fatalErrors, clientJs } = compileSource(source, "fail-alias.scrml");
    expect(fatalErrors.length).toBe(0);
    // Both function bodies emit the same tagged return shape
    const matches = clientJs.match(/__scrml_error: true, type: "E", variant: "A", data: \{ v: "one" \}/g);
    expect(matches?.length).toBe(2);
  });

  test("fail Type.Variant (no args) emits data: null", () => {
    // M-7C-D-12 Track 3 (S90 OQ-5(a) ratified): the missing-payload fallback in
    // fail-expr codegen is `null`, not `undefined`. scrml absence is JS `null`
    // per §42.5/§42.8; the literal `undefined` JS keyword is no longer
    // interpolated into compiled output.
    const source = `\${
  type E:enum = { Empty }
  function f()! -> E {
    fail E.Empty
  }
}
<p>x</>`;
    const { fatalErrors, clientJs } = compileSource(source, "fail-no-args.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toContain(`data: null`);
    expect(clientJs).not.toContain(`data: undefined`);
    expect(clientJs).not.toMatch(/data:\s*}/);
  });

  test("generated JS is syntactically valid", async () => {
    const source = `\${
  type E:enum = { Bad(reason:string), Empty }
  function f(x)! -> E {
    if (x == 0) { fail E.Bad("zero") }
    if (x == 1) { fail E.Empty }
    return "ok"
  }
}
<p>x</>`;
    const { clientJs } = compileSource(source, "fail-syntax.scrml");
    // Parsing with Function ctor is a full JS syntax check
    expect(() => new Function(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ? propagation
// ---------------------------------------------------------------------------

describe("? propagation codegen (§19.5)", () => {
  test("let x = fallible()? inside function body emits propagate check", () => {
    const source = `\${
  type E:enum = { Bad(reason:string) }
  function risky(n)! -> E {
    if (n < 0) { fail E.Bad("neg") }
    return n
  }
  function caller(n)! -> E {
    let x = risky(n)?
    return x
  }
}
<p>x</>`;
    const { fatalErrors, clientJs } = compileSource(source, "propagate-let.scrml");
    expect(fatalErrors.length).toBe(0);
    // Must emit a check-and-return pattern, not leave `?` in the source
    expect(clientJs).toMatch(/if \(_scrml_\w+\.__scrml_error\) return _scrml_\w+;/);
    expect(clientJs).not.toMatch(/risky\([^)]*\)\s*\?\s*;/);
  });

  test("generated JS for propagation is syntactically valid", () => {
    const source = `\${
  type E:enum = { Bad }
  function risky()! -> E { fail E.Bad("x") }
  function caller()! -> E {
    let x = risky()?
    return x
  }
}
<p>x</>`;
    const { clientJs } = compileSource(source, "propagate-syntax.scrml");
    expect(() => new Function(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// !{} inline catch
// ---------------------------------------------------------------------------

describe("!{} inline catch codegen (§19.4.3)", () => {
  test("!{} checks __scrml_error and matches on .variant", () => {
    const source = `\${
  type E:enum = { NotFound(msg:string), Forbidden }
  function load(id)! -> E {
    if (id == 0) { fail E.NotFound("missing") }
    return "ok"
  }
}
<div>
\${
  let item = load(1) !{
    | ::NotFound(msg) -> "fallback-missing"
    | ::Forbidden -> "fallback-denied"
  }
}
<p>\${item}</>
</div>`;
    const { fatalErrors, clientJs } = compileSource(source, "inline-catch-basic.scrml");
    expect(fatalErrors.length).toBe(0);
    // Must NOT use try/catch — fail does not throw
    expect(clientJs).not.toMatch(/try\s*\{[\s\S]*load\(1\)[\s\S]*catch/);
    // Must check __scrml_error on result
    expect(clientJs).toMatch(/if\s*\([^)]*\.__scrml_error\)/);
    // Must match by variant name
    expect(clientJs).toContain(`.variant === "NotFound"`);
    expect(clientJs).toContain(`.variant === "Forbidden"`);
    // Binding reads the named payload field off .data
    expect(clientJs).toContain(`const msg =`);
    expect(clientJs).toMatch(/const msg = _scrml_\w+\.data\.msg;/);
  });

  test("!{} without wildcard still emits else-return as fallback", () => {
    // The exhaustiveness checker (§18.8) requires all variants or a wildcard
    // be covered, so in typed scrml this fallback is unreachable. But the
    // codegen emits the else-return for defence-in-depth. Confirm the shape.
    const source = `\${
  type E:enum = { OnlyBad(e:string) }
  function f()! -> E { fail E.OnlyBad("x") }
  function g()! -> E {
    let x = f() !{
      | ::OnlyBad(e) -> "handled"
    }
    return x
  }
}
<p>x</>`;
    const { fatalErrors, clientJs } = compileSource(source, "inline-catch-single.scrml");
    expect(fatalErrors.length).toBe(0);
    expect(clientJs).toMatch(/else \{ return _scrml_\w+; \}/);
  });

  test("generated JS for !{} is syntactically valid and behaves correctly", () => {
    const source = `\${
  type E:enum = { Bad(reason:string) }
  function f(x)! -> E {
    if (x == 0) { fail E.Bad("zero") }
    return "ok"
  }
}
<div>
\${
  let item = f(0) !{
    | ::Bad(m) -> "recovered"
  }
}
<p>\${item}</>
</div>`;
    const { clientJs } = compileSource(source, "inline-catch-runtime.scrml");
    expect(() => new Function(clientJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// E-ERROR-001: fail in non-failable function
// ---------------------------------------------------------------------------

describe("E-ERROR-001: fail in non-failable function (§19.3.3)", () => {
  test("fail inside a function without ! modifier fires E-ERROR-001", () => {
    const source = `\${
  function normalFn(x) {
    if (x < 0) {
      fail "should not work"
    }
    return x
  }
}
<p>x</>`;
    const { fatalErrors } = compileSource(source, "fail-non-failable.scrml");
    const e001 = fatalErrors.filter((e) => e.code === "E-ERROR-001");
    expect(e001.length).toBeGreaterThanOrEqual(1);
    expect(e001[0].message).toContain("normalFn");
  });

  test("fail inside a ! function does NOT fire E-ERROR-001", () => {
    const source = `\${
  type E:enum = { Bad }
  function failableFn(x)! -> E {
    if (x < 0) { fail E.Bad("neg") }
    return x
  }
}
<p>x</>`;
    const { fatalErrors } = compileSource(source, "fail-failable.scrml");
    const e001 = fatalErrors.filter((e) => e.code === "E-ERROR-001");
    expect(e001.length).toBe(0);
  });
});
