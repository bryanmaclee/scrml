/**
 * E-STRUCT-FUNCTION-FIELD — function-typed struct field REJECTED (§14.3 / §34).
 *
 * A `:struct` field (or inline-struct annotation field) whose TYPE is a
 * function type (`() -> void`, `fn()`, `(x: int) => string`) is REJECTED at
 * declaration with a hard `E-STRUCT-FUNCTION-FIELD` error (S174 ruling — a
 * function is not value data; the limit-the-primitive axiom, §14.1.1). This is
 * the STORED face of the passed-vs-stored rule (§15.11): a function may be
 * PASSED (a component prop, W-COMPONENT-001) or CALLED (an event handler /
 * inline) but never STORED as a struct field or state cell.
 *
 * The field now resolves to a distinguishable `FunctionType` (not `asIs`) via
 * the resolveTypeExpr function-type branch — that precise resolution closed the
 * thin-arrow `() -> void` silent hole (formerly a plain `asIs` indistinguishable
 * from a typo'd type) and lets the reject fire on exactly the function shapes.
 *
 * E- prefix → result.errors (fatal, CLI exit 1). Tests assert via the
 * CROSS-STREAM helper so a stream-partition regression (an E- code silently
 * moving into result.warnings) is caught rather than silently passing.
 *
 * (Was W-TYPE-FN-FIELD — ratified S171 (item) + S173 (severity/code/scope) as
 * an info-level nudge; ESCALATED to the hard error S174.) SHARED fire site
 * (type-system.ts) — covers BOTH the default BS+Acorn pipeline AND the
 * scrml-native parser (native defers all type decomposition to the same stage).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "struct-fn-field-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src, parser) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  const opts = { inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} };
  if (parser) opts.parser = parser;
  return compileScrml(opts);
}

// Cross-stream helper: E- codes partition to result.errors, but assert over
// BOTH streams so a partition regression (E- code landing in result.warnings)
// is caught rather than silently passing.
function fnFieldDiags(res) {
  return [...(res.errors || []), ...(res.warnings || [])]
    .filter((d) => d.code === "E-STRUCT-FUNCTION-FIELD");
}

// ---------------------------------------------------------------------------
// POSITIVE — each function-type shape REJECTS with E-STRUCT-FUNCTION-FIELD
// ---------------------------------------------------------------------------

describe("E-STRUCT-FUNCTION-FIELD — positive (named struct decl)", () => {
  test("fn() field is rejected", () => {
    const res = compile(`<ul>
\${ type T:struct = { cb: fn(), label: string } }
<li>x</li>
</ul>`);
    const hits = fnFieldDiags(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("cb");
    // Routes to errors, never warnings (it is a hard reject).
    expect((res.warnings || []).some((e) => e.code === "E-STRUCT-FUNCTION-FIELD")).toBe(false);
    expect((res.errors || []).some((e) => e.code === "E-STRUCT-FUNCTION-FIELD")).toBe(true);
  });

  test("(x) => T fat-arrow function-type field is rejected", () => {
    const res = compile(`<ul>
\${ type T:struct = { transform: (x: int) => string, label: string } }
<li>x</li>
</ul>`);
    const hits = fnFieldDiags(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("transform");
  });

  test("() -> void thin-arrow function-type field is rejected (closes the int-for-fn silent hole)", () => {
    // Pre-S174, `() -> void` fell all the way through resolveTypeExpr to a plain
    // `asIs` (no isFunctionField sidecar) — indistinguishable from a typo'd type.
    // The FunctionType branch now resolves it to a real function kind, so the
    // reject fires precisely.
    const res = compile(`<ul>
\${ type T:struct = { onClick: () -> void, label: string } }
<li>x</li>
</ul>`);
    const hits = fnFieldDiags(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("onClick");
  });

  test("all three shapes in one struct reject exactly three times", () => {
    const res = compile(`<ul>
\${ type T:struct = { a: () -> void, b: fn(), c: (x: int) => string, d: string } }
<li>x</li>
</ul>`);
    expect(fnFieldDiags(res).length).toBe(3);
  });

  test("inline-struct annotation function field is rejected", () => {
    const res = compile(`<ul>
\${ <h>: { f: fn(), label: string } = { f: someHandler, label: "" } }
<li>x</li>
</ul>`);
    const hits = fnFieldDiags(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("f");
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — lifecycle annotations + plain scalar/struct/enum/array/map fields
// REJECT NOTHING (the lifecycle disambiguation must survive the escalation)
// ---------------------------------------------------------------------------

describe("E-STRUCT-FUNCTION-FIELD — negative (lifecycle + plain fields)", () => {
  test("(not to string) lifecycle field does NOT reject", () => {
    const res = compile(`<ul>
\${ type T:struct = { passwordHash: (not to string), label: string } }
<li>x</li>
</ul>`);
    expect(fnFieldDiags(res).length).toBe(0);
  });

  test("(Idle to Done) lifecycle field does NOT reject", () => {
    const res = compile(`<ul>
\${ type T:struct = { status: (Idle to Done), label: string } }
<li>x</li>
</ul>`);
    expect(fnFieldDiags(res).length).toBe(0);
  });

  test("(A -> B) legacy-arrow lifecycle field does NOT reject E-STRUCT-FUNCTION-FIELD", () => {
    const res = compile(`<ul>
\${ type T:struct = { legacy: (Draft -> Published), label: string } }
<li>x</li>
</ul>`);
    // It DOES fire W-LIFECYCLE-LEGACY-ARROW (existing behavior), but NOT the
    // function-field reject — the lifecycle form is the arrow wrapped in outer
    // parens and is never a function type.
    expect(fnFieldDiags(res).length).toBe(0);
  });

  test("plain scalar / struct / enum / array / map fields reject nothing", () => {
    const res = compile(`<ul>
\${
  type Inner:struct = { x: number }
  type E:enum = { Red, Green }
  type T:struct = { n: number, s: string, b: bool, inner: Inner, e: E, arr: number[], m: [string: number] }
}
<li>x</li>
</ul>`);
    expect(fnFieldDiags(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SHARED — rejects identically on the native parser (defers to same type-system)
// ---------------------------------------------------------------------------

describe("E-STRUCT-FUNCTION-FIELD — native parser parity", () => {
  test("rejects on --parser=scrml-native for each shape", () => {
    const src = `<ul>
\${ type T:struct = { a: () -> void, b: fn(), c: (x: int) => string, d: string } }
<li>x</li>
</ul>`;
    expect(fnFieldDiags(compile(src, "scrml-native")).length).toBe(3);
  });

  test("does NOT reject a lifecycle field under --parser=scrml-native", () => {
    const src = `<ul>
\${ type T:struct = { passwordHash: (not to string), label: string } }
<li>x</li>
</ul>`;
    expect(fnFieldDiags(compile(src, "scrml-native")).length).toBe(0);
  });
});
