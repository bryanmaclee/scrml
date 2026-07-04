/**
 * g-failable-arm-nested-constructor-crash (S195 HIGH / S196 prereq-bug Bucket 1)
 *
 * A payload-bearing variant CONSTRUCTOR CALL used inside an `!{}` (or held-error-
 * routing) arm body must lower to a valid runtime constructor — NOT to a string
 * invoked as a function (`"NotFound"(id)` → runtime crash `"NotFound" is not a
 * function`).
 *
 * Root cause (rewrite.ts:rewriteEnumVariantAccess): the legacy qualified-`::`
 * unit-variant strip (`Enum::Variant` → `"Variant"`) fired on a payload-bearing
 * CONSTRUCTOR CALL too, dropping the type prefix and leaving a bare string in
 * call position. The fix guards the `::` strips with `(?!\s*\()` and collapses a
 * surviving qualified constructor call to the frozen-enum member-access form
 * (`Enum.Variant(args)`) — byte-identical to how the structured-AST path lowers
 * the SAME construct in a plain `function` body (the control).
 *
 * FULL-PIPELINE tests (compileScrml) per the R26/S138 HIGH-CODEGEN doctrine: a
 * synthesized-AST regression test would MISS the upstream string-rewrite path.
 *
 * Coverage:
 *   §1  NESTED constructor `.Failed(LoadError::NotFound(@id))` in an `!{}` arm
 *   §2  QUALIFIED-DIRECT constructor `@held = LoadError::NotFound(@id)` in an arm
 *   §3  CONTROL — the same nested constructor in a plain `fn` body is unchanged
 *   §4  qualified UNIT-variant READ (no parens) still strips to the string tag
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileSrc(src, baseName) {
  const tmp = join(tmpdir(), `scrml-g-fanc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const srcFile = join(tmp, `${baseName}.scrml`);
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  let clientJs = "";
  try { clientJs = readFileSync(join(outDir, `${baseName}.client.js`), "utf8"); } catch { /* compile failed */ }
  return { result, clientJs, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const codes = (result) => [...(result.errors ?? []), ...(result.warnings ?? [])].map((e) => e.code);
// A PascalCase string literal directly in call position — the mangle signature.
const STRING_CALL_MANGLE = /"[A-Z][A-Za-z0-9_]*"\s*\(/;

// ---------------------------------------------------------------------------
// §1: NESTED payload constructor in an `!{}` arm (the gate shape)
// ---------------------------------------------------------------------------

describe("g-failable-arm-nested-constructor-crash §1: nested ctor in `!{}` arm", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound(id: string), Forbidden }",
    "    type Phase:enum = { Idle, Failed(err: LoadError) }",
    "    <phase>: Phase = .Idle",
    "    <id> = \"abc\"",
    "    function loadIt(rid: string) ! LoadError { if (rid == \"\") fail .Forbidden }",
    "    function tryLoad() {",
    "      loadIt(@id) !{",
    "        | err :> { @phase = .Failed(LoadError::NotFound(@id)); return }",
    "      }",
    "    }",
    "  }",
    "  <div><button onclick=tryLoad()>Load</button></div>",
    "</program>",
  ].join("\n");

  test("compiles without E-CODEGEN-INVALID-LOGIC", () => {
    const { result, cleanup } = compileSrc(src, "fanc-nested-1");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    cleanup();
  });

  test("no string-invoked-as-function mangle in emitted JS", () => {
    const { clientJs, cleanup } = compileSrc(src, "fanc-nested-2");
    expect(clientJs).not.toMatch(STRING_CALL_MANGLE);
    cleanup();
  });

  test("the inner constructor lowers to a valid frozen-enum constructor call", () => {
    const { clientJs, cleanup } = compileSrc(src, "fanc-nested-3");
    // err: LoadError.NotFound( ... )  — NOT  err: "NotFound"( ... )
    expect(clientJs).toMatch(/variant:\s*"Failed",\s*data:\s*\{\s*err:\s*LoadError\.NotFound\s*\(/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §2: QUALIFIED-DIRECT payload constructor as the direct arm RHS
// ---------------------------------------------------------------------------

describe("g-failable-arm-nested-constructor-crash §2: qualified-direct ctor in arm", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound(id: string), Forbidden }",
    "    <held>: LoadError = .Forbidden",
    "    <id> = \"abc\"",
    "    function loadIt(rid: string) ! LoadError { if (rid == \"\") fail .Forbidden }",
    "    function tryLoad() {",
    "      loadIt(@id) !{",
    "        | err :> { @held = LoadError::NotFound(@id); return }",
    "      }",
    "    }",
    "  }",
    "  <div><button onclick=tryLoad()>Load</button></div>",
    "</program>",
  ].join("\n");

  test("no string-call mangle; collapses to frozen-enum constructor call", () => {
    const { result, clientJs, cleanup } = compileSrc(src, "fanc-qual-1");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(clientJs).not.toMatch(STRING_CALL_MANGLE);
    expect(clientJs).toMatch(/_scrml_reactive_set\("held",\s*LoadError\.NotFound\s*\(/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §3: CONTROL — the same nested constructor in a plain `fn` body
// ---------------------------------------------------------------------------

describe("g-failable-arm-nested-constructor-crash §3: plain-fn-body control", () => {
  const src = [
    "<program>",
    "  ${",
    "    type LoadError:enum = { NotFound(id: string), Forbidden }",
    "    fn buildErr(rid: string) -> LoadError { return LoadError::NotFound(rid) }",
    "  }",
    "  <div>x</div>",
    "</program>",
  ].join("\n");

  test("plain-fn body lowers the qualified ctor to a member-access call (unchanged)", () => {
    const { clientJs, cleanup } = compileSrc(src, "fanc-control-1");
    expect(clientJs).not.toMatch(STRING_CALL_MANGLE);
    expect(clientJs).toMatch(/return LoadError\.NotFound\(rid\)/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §4: a qualified UNIT-variant READ (no parens) still strips to the string tag
// ---------------------------------------------------------------------------

describe("g-failable-arm-nested-constructor-crash §4: unit-variant read unaffected", () => {
  const src = [
    "<program>",
    "  ${",
    "    type Mode:enum = { Small, Big }",
    "    <mode>: Mode = .Small",
    "    <isBig> = false",
    "    function check() { @isBig = @mode == Mode::Big }",
    "  }",
    "  <div><button onclick=check()>Check</button></div>",
    "</program>",
  ].join("\n");

  test("qualified unit-variant read resolves to the variant value, not a call", () => {
    const { clientJs, cleanup } = compileSrc(src, "fanc-unitread-1");
    // The qualified unit READ `Mode::Big` (no parens) must resolve to the variant
    // value (`Mode.Big`, which === "Big" at runtime) — it must NOT collapse to a
    // `Mode.Big(...)` constructor CALL (the collapse only applies to the call form
    // `Enum::Variant(args)`), and must NOT leak a `::` into emitted JS.
    expect(clientJs).toMatch(/Mode\.Big\b(?!\s*\()/);
    expect(clientJs).not.toMatch(/::/);
    expect(clientJs).not.toMatch(STRING_CALL_MANGLE);
    cleanup();
  });
});
