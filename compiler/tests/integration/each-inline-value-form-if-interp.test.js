/**
 * each-inline-value-form-if-interp.test.js
 *
 * g-each-inline-value-form-if-interp-dropped — a §17.6 value-form
 * `${ if cond { a } else { b } }` (and else-if cascade) as the SOLE content of an
 * interpolation INSIDE an `<each>` body was SILENTLY DROPPED: it is neither a
 * `bare-expr` nor carries `stmt.raw`, so the each-interp emitter fell to
 * `inner = ""` and emitted `// each: empty logic interpolation skipped` → an empty
 * text node, no diagnostic. The IDENTICAL value-form `if` at TOP level compiles
 * correctly (emit-html.ts `isValueFormControlFlowStmt` → emit-control-flow.ts
 * `emitIfValueExpr` → a reactive ternary), so this was an each-path-only codegen
 * hole (found by dog-fooding a fresh order-dashboard app, S369-peter).
 *
 * FIX: the each-interp emitter now lowers a value-form `if` to the RAW ternary
 * (`emit-each.ts` `_eachValueFormIfRaw`, built from `emitStringFromTree` sub-expr
 * text), so the shared `lowerEachExpr` does the `@.`/`@cell`/iter-var lowering
 * uniformly and the value renders as a live per-item text node.
 *
 * SCOPE: value-form `if`/else-if with NON-markup value branches. A value-form
 * `match` in an each interp remains a residual (filed
 * g-each-inline-value-form-match-interp-dropped), and a markup-valued branch is
 * the separate GITI-032 markup-value path.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const D = "$";
let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "each-vf-if-")); });
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

describe("each inline value-form `if` interp (g-each-inline-value-form-if-interp-dropped)", () => {
  test("the gap repro: `${ if item.n > 50 { \"big\" } else { \"small\" } }` renders a ternary, not skipped", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, n: number }
  <rows>: Row[] = [ { id: 1, n: 10 }, { id: 2, n: 90 } ]
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{ if r.n > 50 { "big" } else { "small" } }</li>
  </each>
</ul>
</program>`);
    expect(r.errorCodes).toEqual([]);
    // The value-form `if` is no longer dropped as an empty interpolation …
    expect(r.js).not.toContain("empty logic interpolation skipped");
    // … it emits the §17.6 ternary as a per-item text node.
    expect(/\(\s*r\.n > 50 \? "big" : "small"\s*\)/.test(r.js)).toBe(true);
    expect(/_scrml_each_tn_\d+\.textContent = String\(\(\s*r\.n > 50/.test(r.js)).toBe(true);
    // "big"/"small" must actually appear (they were absent pre-fix).
    expect(r.js).toContain('"big"');
    expect(r.js).toContain('"small"');
  });

  test("else-if cascade nests into a right-associated ternary", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, n: number }
  <rows>: Row[] = [ { id: 1, n: 5 } ]
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{ if r.n > 90 { "hi" } else if r.n > 10 { "mid" } else { "lo" } }</li>
  </each>
</ul>
</program>`, "cascade");
    expect(r.errorCodes).toEqual([]);
    expect(r.js).not.toContain("empty logic interpolation skipped");
    // nested ternary: (n>90 ? "hi" : (n>10 ? "mid" : "lo"))
    expect(/r\.n > 90 \? "hi" : \(\s*r\.n > 10 \? "mid" : "lo"\s*\)/.test(r.js)).toBe(true);
  });

  test("condition referencing an OUTER reactive `@cell` lowers to reactive_get (still live)", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, n: number }
  <rows>: Row[] = [ { id: 1, n: 5 } ]
  <threshold>: number = 3
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{ if r.n > @threshold { "over" } else { "under" } }</li>
  </each>
</ul>
</program>`, "cell");
    expect(r.errorCodes).toEqual([]);
    expect(r.js).not.toContain("empty logic interpolation skipped");
    // the @cell read is lowered by the shared each path, the item ref passes through
    expect(/r\.n > _scrml_cs_reactive_get\("threshold"\) \? "over" : "under"/.test(r.js)).toBe(true);
  });

  test("NON-REGRESSION: a plain bare-expr interp in an each still emits its text node", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, name: string }
  <rows>: Row[] = [ { id: 1, name: "Ada" } ]
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{r.name}</li>
  </each>
</ul>
</program>`, "plain");
    expect(r.errorCodes).toEqual([]);
    expect(/_scrml_each_tn_\d+\.textContent = String\(r\.name\)/.test(r.js)).toBe(true);
  });

  test("RESIDUAL PIN (filed g-each-inline-value-form-match-interp-dropped): a value-form `match` in an each interp is still skipped — flip when fixed", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, n: number }
  <rows>: Row[] = [ { id: 1, n: 10 } ]
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{ match r.n { 10 :> "ten" _ :> "other" } }</li>
  </each>
</ul>
</program>`, "matchresidual");
    expect(r.errorCodes).toEqual([]);
    // Documents the CURRENT residual so it is tracked; the value-form MATCH path is
    // a follow-on to this if-only fix (its fix should ALSO make the drop loud —
    // g-each-inline-value-form-control-flow-interp-silently-dropped).
    expect(r.js).toContain("empty logic interpolation skipped");
  });

  test("RESIDUAL PIN: a value-form `if` with a MARKUP branch is still skipped — flip when the markup-value-in-each path lands", () => {
    const r = compileApp(`<program>
${D}{
  type Row:struct = { id: number, n: number }
  <rows>: Row[] = [ { id: 1, n: 90 } ]
}
<ul>
  <each in=@rows key=r.id as r>
    <li>${D}{ if r.n > 50 { <span>big</span> } else { "small" } }</li>
  </each>
</ul>
</program>`, "markupbranch");
    expect(r.errorCodes).toEqual([]);
    // A markup-valued branch is left to the (open) GITI-032 markup-value-in-each
    // lowering; _eachValueFormIfRaw returns null so it stays on the skip path.
    expect(r.js).toContain("empty logic interpolation skipped");
  });
});
