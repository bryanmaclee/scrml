/**
 * tare-emit-and-diagnostics.test.js — SPEC §6.8.4 `tare(@cell)` /
 * `tare(@cell, <expr>)`: lowering shape + diagnostics.
 *
 * The RUNTIME behaviour (does reset actually restore the right value) is proved
 * by execution in `compiler/tests/browser/browser-tare-reset-baseline.test.js`.
 * This file pins the two things a runtime test cannot see:
 *
 *   1. the LOWERING — bare form to a runtime promotion, two-argument form to
 *      the same `_scrml_default_set` thunk `default=` already emits; and that
 *      the promotion lands at the AUTHOR'S source position, since that position
 *      is the entire discriminator;
 *   2. the DIAGNOSTICS — arity, target shape, derived-cell prohibition, and the
 *      reserved name.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { resolve } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { foldChunkAccessors } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-tare-emit");

function compile(source, baseName = "tare_case") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  // Fold the per-chunk `_scrml_cs_` accessor rename at the READ site, so these
  // assertions pin the LOWERING contract (`_scrml_tare("x")`) rather than the
  // chunk-namespacing wrapper. The chunk-identity axis has its own coverage in
  // chunk-namespacing.test.js, which pins tokens directly and must NOT fold.
  const clientJs = existsSync(clientPath)
    ? foldChunkAccessors(readFileSync(clientPath, "utf8"))
    : "";
  const diags = [...(result.errors ?? []), ...(result.warnings ?? [])];
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  return {
    clientJs,
    codes: diags.map((d) => d.code),
    messages: diags.map((d) => d.message ?? ""),
    errorCodes: (result.errors ?? [])
      .filter((e) => (e.severity ?? "error") === "error")
      .map((e) => e.code),
  };
}

describe("§6.8.4 tare — lowering", () => {
  test("bare form lowers to the runtime promotion `_scrml_tare(<key>)`", () => {
    const { clientJs, errorCodes } = compile(`<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
}
</program>`);
    expect(errorCodes).toEqual([]);
    expect(clientJs).toContain(`_scrml_tare("x")`);
    // No static "which write is the baseline" decision leaked into codegen:
    // BOTH init-thunk registrations are still emitted, unchanged.
    expect(clientJs).toContain(`_scrml_init_set("x", () => 0)`);
    expect(clientJs).toContain(`_scrml_init_set("x", () => _scrml_reactive_get("x") + 1)`);
  });

  test("the promotion lands at the AUTHOR'S source position, between the writes", () => {
    const { clientJs } = compile(`<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
}
</program>`);
    const firstInit = clientJs.indexOf(`_scrml_init_set("x", () => 0)`);
    const tareAt = clientJs.indexOf(`_scrml_tare("x")`);
    const secondInit = clientJs.indexOf(`_scrml_init_set("x", () => _scrml_reactive_get("x") + 1)`);
    expect(firstInit).toBeGreaterThan(-1);
    expect(tareAt).toBeGreaterThan(firstInit);
    expect(secondInit).toBeGreaterThan(tareAt);
  });

  test("a tare AFTER both writes emits after both — source order, not a rule", () => {
    const { clientJs } = compile(`<program>
\${
    @x = 0
    @x = @x + 1
    tare(@x)
}
</program>`);
    const secondInit = clientJs.indexOf(`_scrml_init_set("x", () => _scrml_reactive_get("x") + 1)`);
    const tareAt = clientJs.indexOf(`_scrml_tare("x")`);
    expect(secondInit).toBeGreaterThan(-1);
    expect(tareAt).toBeGreaterThan(secondInit);
  });

  test("two-argument form lowers to the `default=` thunk, not a snapshot", () => {
    const { clientJs, errorCodes } = compile(`<program>
<factor> = 10
\${
    @n = 1
    tare(@n, @factor * 2)
}
</program>`);
    expect(errorCodes).toEqual([]);
    // A THUNK closing over the cell read — the SAME lowering `default=` uses.
    expect(clientJs).toContain(`_scrml_default_set("n", () => _scrml_reactive_get("factor") * 2)`);
    // And no value snapshot: the emitted default must not be a literal 20.
    expect(clientJs).not.toContain(`_scrml_default_set("n", () => 20)`);
  });

  test("two-argument object-literal default is paren-wrapped (GITI-014)", () => {
    const { clientJs, errorCodes } = compile(`<program>
\${
    @cfg = { a: 1 }
    tare(@cfg, { a: 0 })
}
</program>`);
    expect(errorCodes).toEqual([]);
    expect(clientJs).toContain(`_scrml_default_set("cfg", () => ({a: 0}))`);
  });

  test("compound-nav target uses the dotted storage key", () => {
    const { clientJs, errorCodes } = compile(`<program>
<formRes>
  <name> = "a"
</>
\${
    tare(@formRes.name)
}
</program>`);
    expect(errorCodes).toEqual([]);
    expect(clientJs).toContain(`_scrml_tare("formRes.name")`);
  });

  test("a tare-only page still gets the runtime chunk that DEFINES _scrml_tare", () => {
    // The definition must never be gated more narrowly than the reference: a
    // page may tare without ever calling reset, and the pre-emit AST probe is
    // short-circuited by the `hasResetExpr` PGO flag.
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tmpDir = resolve(tmpRoot, `chunk-${uniq}`);
    const tmpInput = resolve(tmpDir, "tare_only.scrml");
    const outDir = resolve(tmpDir, "out");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, `<program>
\${
    @x = 0
    tare(@x)
}
</program>`);
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    const runtimeJs = existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "";
    const clientJs = readFileSync(resolve(outDir, "tare_only.client.js"), "utf8");
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });

    expect(clientJs).toContain("_scrml_tare(");
    expect(runtimeJs).toContain("function _scrml_tare(name)");
  });
});

describe("§6.8.4 tare — diagnostics", () => {
  test("zero-arg `tare()` fires E-TARE-NO-ARG", () => {
    const { codes } = compile(`<program>
\${
    @x = 0
    tare()
}
</program>`);
    expect(codes).toContain("E-TARE-NO-ARG");
  });

  test("three-arg `tare(a, b, c)` fires E-TARE-NO-ARG", () => {
    const { codes } = compile(`<program>
\${
    @x = 0
    tare(@x, 1, 2)
}
</program>`);
    expect(codes).toContain("E-TARE-NO-ARG");
  });

  test("a non-cell target fires E-TARE-INVALID-TARGET, not the reset code", () => {
    const { codes, messages } = compile(`<program>
\${
    @x = 0
    tare(42)
}
</program>`);
    expect(codes).toContain("E-TARE-INVALID-TARGET");
    expect(codes).not.toContain("E-RESET-INVALID-TARGET");
    // The message names the keyword the author actually wrote.
    expect(messages.join("\n")).toContain("`tare(42)`");
  });

  test("a bare identifier target (no `@`) fires E-TARE-INVALID-TARGET", () => {
    const { codes } = compile(`<program>
\${
    @x = 0
    tare(x)
}
</program>`);
    expect(codes).toContain("E-TARE-INVALID-TARGET");
  });

  test("tare on an undeclared cell fires E-STATE-UNDECLARED (reused, not a new code)", () => {
    const { codes } = compile(`<program>
\${
    @x = 0
    tare(@nope)
}
</program>`);
    expect(codes).toContain("E-STATE-UNDECLARED");
  });

  test("tare on a `const` derived cell fires E-DERIVED-WRITE (§6.8.1 mirror)", () => {
    const { codes, messages } = compile(`<program>
<x> = 1
const <doubled> = @x * 2
\${
    tare(@doubled)
}
</program>`);
    expect(codes).toContain("E-DERIVED-WRITE");
    expect(messages.join("\n")).toContain("tare(@doubled)");
  });

  test("`tare` is a reserved name — `function tare()` fires E-RESERVED-IDENTIFIER", () => {
    const { codes, messages } = compile(`<program>
\${
    function tare() { return 1 }
}
</program>`);
    expect(codes).toContain("E-RESERVED-IDENTIFIER");
    expect(messages.join("\n")).toContain("`tare`");
  });

  test("`fn tare` fires E-RESERVED-IDENTIFIER too", () => {
    const { codes } = compile(`<program>
\${
    fn tare() { 1 }
}
</program>`);
    expect(codes).toContain("E-RESERVED-IDENTIFIER");
  });

  test("the `reset` reserved-name diagnostic still reads as before (no regression)", () => {
    const { codes, messages } = compile(`<program>
\${
    function reset() { return 1 }
}
</program>`);
    expect(codes).toContain("E-RESERVED-IDENTIFIER");
    expect(messages.join("\n")).toContain("`function reset() {...}` shadows the reserved `reset` keyword (§6.8)");
  });

  test("tare on a lifecycle-annotated struct FIELD is not a READ — no false E-TYPE-001", () => {
    // §6.8.3's struct-field tracker intercepts a structured `reset-expr` and
    // suppresses its target text so the target is not counted as a read. A tare
    // needs the same suppression for the same reason: `tare(@user.token)` names
    // the cell whose reset-DEFAULT is being set; it reads nothing. Before the
    // fix this fired E-TYPE-001 twice while the byte-identical `reset` program
    // compiled clean.
    const { codes } = compile(`<program>
\${
    type User:struct = { name: string, token: (not to string) }
    <user>: User = { name: "a", token: not }
    tare(@user.token)
}
</program>`);
    expect(codes).not.toContain("E-TYPE-001");
  });

  test("reset/tare DIAGNOSTIC PARITY on a lifecycle field target", () => {
    // The durable form of the assertion above: whatever the lifecycle tracker
    // decides about this target shape, the two family members must decide it
    // together. This keeps holding if §6.8.3's rules change.
    const src = (kw) => `<program>
\${
    type User:struct = { name: string, token: (not to string) }
    <user>: User = { name: "a", token: not }
    ${kw}(@user.token)
}
</program>`;
    expect(compile(src("tare")).codes.filter((c) => c === "E-TYPE-001"))
      .toEqual(compile(src("reset")).codes.filter((c) => c === "E-TYPE-001"));
  });

  test("tare does NOT revert §6.8.3 per-access lifecycle state — reset does", () => {
    // The discriminating pair, and the reason the fix is NOT simply "route tare
    // through reset's arm". §6.8.3 reverts transition state "based on the
    // resulting WRITTEN VALUE". A reset writes the cell, so the field goes back
    // to `pre` and the following read fires. A tare writes only the default
    // slot — the cell's value, and therefore its transition state, is untouched.
    const src = (kw) => `<program>
\${
    type User:struct = { name: string, token: (not to string) }
    <user>: User = { name: "a", token: not }
    @user.token = "t"
    ${kw}(@user)
    @n = @user.token
}
</program>`;
    expect(compile(src("tare")).errorCodes).not.toContain("E-TYPE-001");
    expect(compile(src("reset")).errorCodes).toContain("E-TYPE-001");
  });

  test("a tare's SECOND argument is still analysed — the suppression is target-only", () => {
    // The span covers `tare(@target` and stops there, so a genuine
    // pre-transition read in the explicit-default expression still fires. A
    // whole-call span (which is what `reset` uses, safely, having no second
    // argument) would have silently swallowed it.
    const { errorCodes } = compile(`<program>
\${
    type User:struct = { name: string, token: (not to string) }
    <user>: User = { name: "a", token: not }
    @n = 1
    tare(@n, @user.token)
}
</program>`);
    expect(errorCodes).toContain("E-TYPE-001");
  });

  test("a MODULE-INIT tare above the cell's first write fires E-TARE-BEFORE-DECL", () => {
    // The defect this closes: declarations hoist, but module-init EMITS IN
    // SOURCE ORDER, so the promotion ran before any thunk existed, no-opped
    // silently, and reset() fell back to the last write — the exact
    // increment-instead-of-restore behaviour §6.8.4 exists to dissolve,
    // re-created by the feature meant to fix it.
    const { codes } = compile(`<program>
\${
    tare(@x)
    @x = 0
    @x = @x + 1
}
</program>`);
    expect(codes).toContain("E-TARE-BEFORE-DECL");
  });

  test("E-TARE-BEFORE-DECL also fires for a structural decl and a compound", () => {
    const structural = compile(`<program>
\${
    tare(@x)
    <x> = 0
}
</program>`);
    expect(structural.codes).toContain("E-TARE-BEFORE-DECL");
    const compound = compile(`<program>
\${
    tare(@form.a)
    <form>
      <a> = 1
    </>
}
</program>`);
    expect(compound.codes).toContain("E-TARE-BEFORE-DECL");
  });

  test("E-TARE-BEFORE-DECL does NOT fire on the correctly-ordered worked case", () => {
    // The flagship shape. An earlier draft of the check compared against the
    // resolved scope record, which for an IMPLICIT cell is LAST-WINS — it
    // pointed at `@x = @x + 1` and rejected this. A false positive here would
    // reject the canonical program the feature was built for.
    const { codes } = compile(`<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
}
</program>`);
    expect(codes).not.toContain("E-TARE-BEFORE-DECL");
  });

  test("E-TARE-BEFORE-DECL does NOT fire on DEFERRED code written above the decl", () => {
    // A function / handler / lambda body runs after module-init, so a tare
    // there is legal wherever it is written. Each of these is a separate
    // traversal path: the walker's function-decl arm, and the reset-family
    // walker's `skipDeferredBodies` lambda arm.
    const inFn = compile(`<program>
\${
    function f() { tare(@x) }
    <x> = 0
}
</program>`);
    expect(inFn.codes).not.toContain("E-TARE-BEFORE-DECL");
    const inLambda = compile(`<program>
\${
    <go> = () => tare(@x)
    <x> = 0
}
</program>`);
    expect(inLambda.codes).not.toContain("E-TARE-BEFORE-DECL");
  });

  test("the ordering rule is tare-only — `reset` above a declaration is untouched", () => {
    const { codes } = compile(`<program>
\${
    function f() { reset(@x) }
    <x> = 0
}
</program>`);
    expect(codes).not.toContain("E-TARE-BEFORE-DECL");
  });

  test("object-literal compound: tare and reset AGREE (both address no per-field target)", () => {
    // §6.8.4 known limit. `<form> = { a: 1 }` registers ONE reset target,
    // `form` — so `@form.a` is not a target for EITHER keyword. That is a
    // whole-family property that pre-dates §6.8.4 (verified against the base
    // compiler), not something tare introduced. What must hold is that the two
    // keywords agree; this assertion survives a future family-wide fix, whereas
    // pinning the current no-op would have to be deleted by it.
    const src = (kw) => `<program>
\${
    <form> = { a: 1, b: 2 }
    ${kw}(@form.b)
}
</program>`;
    expect(compile(src("tare")).errorCodes).toEqual(compile(src("reset")).errorCodes);
  });

  test("an ordinary method call `obj.tare(x)` is NOT lifted and NOT diagnosed", () => {
    const { errorCodes, clientJs } = compile(`<program>
\${
    @scale = makeScale()
    function makeScale() { return { tare: fixture, value: 0 } }
    function fixture(v) { return v }
    function zeroIt() { @scale.tare(0) }
}
</program>`);
    expect(errorCodes).toEqual([]);
    expect(clientJs).not.toContain("_scrml_tare(");
  });
});
