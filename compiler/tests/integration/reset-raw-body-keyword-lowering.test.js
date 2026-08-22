/**
 * §6.8.2 reset() in RAW-STRING body positions — regression for
 * `g-cleanup-onclick-raw-body-keyword-call-dangling-ref` (HIGH, S360-peter).
 *
 * THE DEFECT: a statement-bodied handler/cleanup body (e.g.
 * `onclick=${ if (@x > 0) { reset(@x) } }` or `cleanup(() => { reset(@x) })`)
 * has no structured ExprNode — it takes the raw-text fallback
 * (rewrite.ts `rewriteExprWithDerived` → clientPasses). That pipeline carried
 * keyword-preserving pre-passes for `transition` and `replay` but NONE for
 * `reset`, so the generic `@x → _scrml_reactive_get("x")` rewrite clobbered the
 * argument while the bare `reset` identifier survived undefined:
 *     reset(_scrml_cs_reactive_get("x"))
 * which compiles clean (exit 0, no diagnostic) and throws
 * `ReferenceError: reset is not defined` when the handler FIRES.
 *
 * THE DISCRIMINATOR is statement-body vs single-expression body — the
 * expression-bodied forms (`onclick=${ reset(@x) }`) already lowered correctly
 * via the structured `reset-expr` path (emit-expr.ts:737). §6.8 places no
 * body-position restriction on `reset(@cell)`, so this is pure emit-correctness
 * PARITY between the two paths — not a semantics change.
 *
 * THE FIX: `rewriteResetCalls` (rewrite.ts), added to `clientPasses` before
 * `rewriteReactiveRefs`, the exact sibling of `rewriteReplayCalls` /
 * `rewriteTransitionCalls`. It makes the raw-text path emit the SAME output the
 * structured path does (`_scrml_reset("<key>")`, cs-prefixed downstream).
 *
 * `reset` was the SOLE keyword rewritten structurally but missing from
 * clientPasses (transition/replay/navigate all have passes there); `tare` is
 * not on main. So this closes the class on main.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { rewriteResetCalls } from "../../src/codegen/rewrite.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "reset-raw-body-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

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
  try { clientJs = readFileSync(join(outDir, `${name}.client.js`), "utf8"); } catch { /* missing */ }
  return { errors, clientJs };
}

describe("§6.8.2 reset() raw-string body lowering (g-cleanup-onclick-raw-body-keyword-call-dangling-ref)", () => {
  test("statement-body handler `reset(@x)` lowers to _scrml_cs_reset, no dangling bare reset(", () => {
    const src = `<program>
<x> = 5
<button onclick=\${ if (@x > 0) { reset(@x) } }>go</button>
<div>\${@x}</div>
</program>`;
    const { errors, clientJs } = compileSource("stmt-simple", src);
    expect(errors).toEqual([]);
    // Lowered to the runtime helper with the cell KEY (matches the structured path).
    expect(clientJs).toMatch(/_scrml_cs_reset\("x"\)/);
    // THE BUG: the bare, dangling `reset(_scrml_cs_reactive_get(...))` must be gone.
    expect(clientJs).not.toMatch(/[^_]reset\(\s*_scrml_cs_reactive_get/);
  });

  test("statement-body handler with a COMPOUND target `reset(@a.b)` → _scrml_cs_reset(\"a.b\")", () => {
    const src = `<program>
<x> = 5
<a> = { b: 7 }
<button onclick=\${ if (@x > 0) { reset(@a.b) } }>go</button>
<div>\${@x}\${@a.b}</div>
</program>`;
    const { errors, clientJs } = compileSource("stmt-member", src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reset\("a\.b"\)/);
    expect(clientJs).not.toMatch(/[^_]reset\(\s*_scrml_cs_reactive_get/);
  });

  test("expression-body handler `reset(@x)` still lowers correctly (structured-path regression)", () => {
    const src = `<program>
<x> = 5
<button onclick=\${ reset(@x) }>go</button>
<div>\${@x}</div>
</program>`;
    const { errors, clientJs } = compileSource("expr-form", src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reset\("x"\)/);
    expect(clientJs).not.toMatch(/[^_]reset\(\s*_scrml_cs_reactive_get/);
  });

  test("the ledger's NAMED primary form — `cleanup(() => { reset(@x) })` in an element ${} block", () => {
    const src = `<program>
<x> = 5
<div>
\${
  cleanup(() => { reset(@x) })
}
</div>
</program>`;
    const { errors, clientJs } = compileSource("cleanup-form", src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reset\("x"\)/);
    expect(clientJs).not.toMatch(/[^_]reset\(\s*_scrml_cs_reactive_get/);
  });

  test("F2 (S239) — a `reset(@x)` INSIDE a string literal in a raw body is NOT rewritten", () => {
    const src = `<program>
<x> = 5
<button onclick=\${ if (@x > 0) { alert("reset(@x) fired") } }>go</button>
<div>\${@x}</div>
</program>`;
    const { errors, clientJs } = compileSource("string-literal", src);
    expect(errors).toEqual([]);
    // The string literal survives verbatim — string-awareness prevents the pass
    // from corrupting `alert("reset(@x) fired")` into `alert("_scrml_reset("x") fired")`.
    expect(clientJs).toContain("reset(@x) fired");
    expect(clientJs).not.toMatch(/_scrml_reset\("x"\)/);
  });
});

describe("rewriteResetCalls — unit guards", () => {
  test("bare `reset(@x)` → _scrml_reset(\"x\")", () => {
    expect(rewriteResetCalls("reset(@x)")).toBe('_scrml_reset("x")');
  });
  test("compound `reset(@a.b.c)` → _scrml_reset(\"a.b.c\")", () => {
    expect(rewriteResetCalls("reset(@a.b.c)")).toBe('_scrml_reset("a.b.c")');
  });
  test("member call `limiter.reset(@x)` is NOT rewritten (post-dot guard)", () => {
    expect(rewriteResetCalls("limiter.reset(@x)")).toBe("limiter.reset(@x)");
  });
  test("already-lowered `_scrml_reset(\"x\")` is left unchanged (idempotent)", () => {
    expect(rewriteResetCalls('_scrml_reset("x")')).toBe('_scrml_reset("x")');
  });
  test("non-canonical non-@ arg `reset(x)` is left untouched (structured path owns E-RESET-INVALID-TARGET)", () => {
    expect(rewriteResetCalls("reset(x)")).toBe("reset(x)");
  });
  test("an identifier ending in 'reset' is not clipped (`myreset(@x)` untouched)", () => {
    expect(rewriteResetCalls("myreset(@x)")).toBe("myreset(@x)");
  });
  test("F2 (S239) — `reset(@x)` inside a string literal is NOT rewritten (string-aware)", () => {
    expect(rewriteResetCalls('alert("reset(@count) done")')).toBe('alert("reset(@count) done")');
    // real call OUTSIDE the string still lowers; the in-string one is preserved.
    expect(rewriteResetCalls('reset(@a); log("reset(@b)")')).toBe('_scrml_reset("a"); log("reset(@b)")');
  });
  test("F3 (S239) — an `@`-prefixed occurrence `@reset(@x)` is left untouched (no malformed output)", () => {
    expect(rewriteResetCalls("@reset(@x)")).toBe("@reset(@x)");
  });
  test("F1 (S239) — a non-canonical target `reset(@a[0])` is NOT lowered (routed residual; structured path owns E-RESET-INVALID-TARGET)", () => {
    expect(rewriteResetCalls("reset(@a[0])")).toBe("reset(@a[0])");
  });
});
