/**
 * value-form-if-empty-string-branch.test.js
 *
 * g-value-form-if-empty-string-branch-renders-nothing — a §17.6 value-form
 * `${ if cond { "" } else { "msg" } }` (an EMPTY-STRING branch, either side)
 * rendered NOTHING — even the non-empty branch was dropped. Root: the logic-body
 * parser's blank-token skip (ast-builder.js: `tok.text.trim() === ""`) also
 * consumed an empty-string STRING literal token, so `{ "" }` parsed to an EMPTY
 * block. That empty branch failed value-form recognition (isSoleBareExprBranch),
 * the `if` lowered as a plain STATEMENT with branch values discarded, and nothing
 * rendered — SILENT-WRONG, in the very common "conditional text, one empty branch"
 * pattern (error messages, optional labels). Found dog-fooding a signup form (S369).
 *
 * FIX: exclude STRING tokens from the blank-token skip, so an empty-string literal
 * `""` reaches the statement parser as a `bare-expr` and `{ "" }` → `[bare-expr ""]`
 * (distinguishable from a truly-empty `{}` → `[]`). The value-form recognition +
 * ternary emission then work unchanged (`emitStringFromTree("")` already yields `""`).
 *
 * Conditions use DIRECT cell reads (`@c`) deliberately — a value-if whose CONDITION
 * is a fn-call has a separate, pre-existing reactive-tracking gap (filed
 * g-value-form-if-fn-condition-not-reactive) unrelated to this parser fix.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const D = "$";
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "vf-if-empty-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileApp(source, name = "app") {
  const fp = join(TMP, `${name}.scrml`);
  writeFileSync(fp, source.endsWith("\n") ? source : source + "\n");
  const out = join(TMP, `${name}.dist`);
  const r = compileScrml({ inputFiles: [fp], outputDir: out, write: true, validateEmit: true, log: () => {} });
  const errors = (r.errors || []).filter((e) => (e.severity ?? "error") === "error");
  const jsPath = join(out, `${name}.client.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    warnCodes: (r.warnings || []).map((e) => e.code),
    js: existsSync(jsPath) ? readFileSync(jsPath, "utf8") : "",
  };
}

describe("value-form if with an empty-string branch (g-value-form-if-empty-string-branch-renders-nothing)", () => {
  test("the gap repro: `${ if @c { \"\" } else { \"msg\" } }` emits a reactive ternary, not a discarded statement", () => {
    const r = compileApp(`<program>
${D}{ <c>: bool = false }
<div><p>${D}{ if @c { "" } else { "shown-when-false" } }</p></div>
</program>`);
    expect(r.errorCodes).toEqual([]);
    // §17.6 value-form: a reactive ternary with BOTH branch values present …
    expect(/_scrml_cf_/.test(r.js)).toBe(true);
    expect(/\?\s*""\s*:\s*"shown-when-false"/.test(r.js)).toBe(true);
    // … NOT the pre-fix statement mode (a bare `"shown-when-false";` discarded value).
    expect(/^\s*"shown-when-false";\s*$/m.test(r.js)).toBe(false);
  });

  test("empty ELSE branch also emits the ternary", () => {
    const r = compileApp(`<program>
${D}{ <c>: bool = false }
<div><p>${D}{ if @c { "then-text" } else { "" } }</p></div>
</program>`, "elseempty");
    expect(r.errorCodes).toEqual([]);
    expect(/\?\s*"then-text"\s*:\s*""/.test(r.js)).toBe(true);
    expect(/^\s*"then-text";\s*$/m.test(r.js)).toBe(false);
  });

  test("NON-REGRESSION: both-non-empty value-form if still emits its ternary", () => {
    const r = compileApp(`<program>
${D}{ <c>: bool = false }
<div><p>${D}{ if @c { "yes" } else { "no" } }</p></div>
</program>`, "both");
    expect(r.errorCodes).toEqual([]);
    expect(/\?\s*"yes"\s*:\s*"no"/.test(r.js)).toBe(true);
  });

  test("the empty-string branch works inside an <each> value-if too", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, done: bool }
  <rows>: Row[] = [ { id: 1, done: true } ]
}
<ul><each in=@rows key=r.id as r><li>${D}{ if r.done { "" } else { "open" } }</li></each></ul>
</program>`, "each");
    expect(r.errorCodes).toEqual([]);
    // the each per-item text node lowers the ternary with the empty branch …
    expect(/\?\s*""\s*:\s*"open"/.test(r.js)).toBe(true);
    // … and is NOT dropped as an empty interpolation.
    expect(r.js).not.toContain("empty logic interpolation skipped");
  });

  test("NON-REGRESSION: a bare empty-string STATEMENT is a clean no-op (no error, no spurious warning) in a fn body", () => {
    // The blank-skip change keeps an empty-string statement rather than dropping
    // it; verify a fn with a leading no-op `""` compiles clean AND draws no
    // unused-expression/dead-code diagnostic on the newly-kept bare-expr.
    const r = compileApp(`<program>
${D}{
  fn f(n: int) { "" return n + 1 }
  <x>: int = 0
}
<p>${D}{ f(@x) }</p>
</program>`, "noop");
    expect(r.errorCodes).toEqual([]);
    expect(r.js).toMatch(/function _scrml_f_\d+/);
    // no NEW diagnostic keyed on the kept empty-string statement
    expect(r.warnCodes.filter((c) => /DEAD|UNUSED|EXPR|NOOP/i.test(c))).toEqual([]);
  });

  test("NON-REGRESSION: a top-level `${ \"\" }` and a whitespace string literal compile clean (both blank-skip loops patched)", () => {
    // The outer (top-level) statement loop's blank-skip was patched in lockstep
    // with the nested one; a top-level bare empty-string + a whitespace-only string
    // literal must both compile without error.
    const r = compileApp(`<program>
${D}{ <c>: bool = false }
<p>${D}{ "" }</p>
<p>${D}{ if @c { "  " } else { "x" } }</p>
</program>`, "toplevel");
    expect(r.errorCodes).toEqual([]);
    // the whitespace-string branch is a VALUE (kept), so the value-form ternary emits it
    expect(/\?\s*"  "\s*:\s*"x"/.test(r.js)).toBe(true);
  });
});
