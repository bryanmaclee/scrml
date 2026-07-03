/**
 * errarm-refail-lowering.test.js
 *
 * Re-`fail` from a `!{}` / `match` arm is canonical scrml — it is the literal
 * §19.5.2 desugaring of the `?` propagation operator and the §41.13 worked
 * example uses it. Two layers were broken before this fix (gap
 * g-errarm-fail-and-parsevariant-handler):
 *
 *   Layer 1 — TYPER (E-SCOPE-001): a `!{}` handler arm body `{ fail … }` ran
 *     through checkLogicExprIdents, which mis-read `fail` as an undeclared
 *     identifier (the body never reached a `fail-expr` node).
 *   Layer 2 — CODEGEN (E-CODEGEN-INVALID-JS): an arm-VALUE `fail` (`:> fail …`,
 *     incl. the `?` desugaring) emitted `fail` LITERALLY.
 *
 * Shared root: `fail` in arm contexts was captured as a STRING/ExprNode where
 * `fail` is a leading identifier, never the `fail-expr` node `parseFailStmt`
 * produces at statement position. The fix recognizes the bare re-`fail` arm
 * body/value and lowers it via the shared `fail-expr` emitter
 * (`return { __scrml_error, … }`).
 *
 * These are FULL-PIPELINE tests (compileScrml) — the R26/S138 doctrine: a
 * regression test that synthesizes AST would pass even if the real parser/typer
 * path stayed broken. Coverage:
 *   §1  `!{}` legacy block arm `{ fail … }` — no E-SCOPE-001, fail-expr emitted
 *   §2  JS-style `match` value-arm `:> fail …` — no E-CODEGEN, fail-expr emitted
 *   §3  `const v = inner()?` — `?` propagation desugars (was a const-path gap)
 *   §4  control: statement-position `fail` STILL works (no regression)
 *   §5  NEGATIVE (NS-1): re-`fail` from a `!{}` arm in a NON-`!` function fires
 *       E-ERROR-001
 *   §6  NEGATIVE (NS-1): re-`fail` from a `match` value-arm in a NON-`!` function
 *       fires E-ERROR-001
 *   §7  route-to-state arm idiom (`@phase = .Error(msg)`, non-`!`) STILL compiles
 *       clean (no regression — the route-to-state idiom is NOT a re-fail)
 *   §8  emitted JS is node-parseable for all three positive shapes
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileSrc(src, baseName) {
  const tmp = join(tmpdir(), `scrml-errarm-refail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// ---------------------------------------------------------------------------
// §1: `!{}` legacy block arm `{ fail … }` (repro-1)
// ---------------------------------------------------------------------------

describe("errarm-refail §1: `!{}` block arm re-fail (Layer 1 — TYPER)", () => {
  const src = [
    "type BErr:enum = { X(reason: string), Y }",
    "type AErr:enum = { Wrapped(reason: string) }",
    "function inner()! -> BErr { fail BErr::X(\"boom\") }",
    "function outer()! -> AErr {",
    "    const v = inner() !{",
    "        | ::X reason :> { fail AErr::Wrapped(reason) }",
    "        | ::Y        :> { fail AErr::Wrapped(\"y\") }",
    "    }",
    "    return v",
    "}",
  ].join("\n");

  test("no spurious E-SCOPE-001 on `fail`", () => {
    const { result, cleanup } = compileSrc(src, "errarm-block");
    expect(codes(result)).not.toContain("E-SCOPE-001");
    cleanup();
  });

  test("no E-CODEGEN-INVALID-JS; fail-expr lowered to the tagged-error envelope", () => {
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-block-2");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    // The arm bodies emit the canonical fail-expr shape (not a literal `fail …`).
    // §51.3.2 — a payload variant's `.data` is a field-keyed object whose keys
    // are the declared field names, for single- AND multi-field variants alike
    // (Wrapped(reason) -> `data: { reason: … }`), matching the enum constructor.
    expect(clientJs).toMatch(/return \{ __scrml_error: true, type: "AErr", variant: "Wrapped", data: \{ reason: reason \} \};/);
    expect(clientJs).toMatch(/return \{ __scrml_error: true, type: "AErr", variant: "Wrapped", data: \{ reason: "y" \} \};/);
    // Literal `fail` keyword must NOT appear in emitted JS.
    expect(clientJs).not.toMatch(/\bfail\b/);
    cleanup();
  });

  test("the `::X reason` payload binding is in scope inside the re-fail arm", () => {
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-block-3");
    expect(result.errors ?? []).toHaveLength(0);
    // §51.3.2 — single-field binding projects the declared field (`.data.reason`),
    // the same way `match` / `<errorBoundary>` read it (g-single-field-handler-bind).
    expect(clientJs).toMatch(/const reason = _scrml_\w+\.data\.reason;/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §2: JS-style `match` value-arm `:> fail …` (repro-2, Layer 2 — CODEGEN)
// ---------------------------------------------------------------------------

describe("errarm-refail §2: JS-style match value-arm re-fail (Layer 2 — CODEGEN)", () => {
  const src = [
    "type BErr:enum = { X(reason: string), Y }",
    "type AErr:enum = { Wrapped(reason: string) }",
    "function inner()! -> BErr { fail BErr::X(\"boom\") }",
    "function outer()! -> AErr {",
    "    const v = match inner() {",
    "        ::Ok(val)    :> val",
    "        ::X(reason)  :> fail AErr::Wrapped(reason)",
    "        ::Y          :> fail AErr::Wrapped(\"y\")",
    "    }",
    "    return v",
    "}",
  ].join("\n");

  test("no E-CODEGEN-INVALID-JS; arm-value fail lowers to the tagged-error envelope", () => {
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-match");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    // §51.3.2 field-keyed `.data` (see §1 above).
    expect(clientJs).toMatch(/return \{ __scrml_error: true, type: "AErr", variant: "Wrapped", data: \{ reason: reason \} \};/);
    expect(clientJs).toMatch(/return \{ __scrml_error: true, type: "AErr", variant: "Wrapped", data: \{ reason: "y" \} \};/);
    expect(clientJs).not.toMatch(/=\s*fail\b/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §3: `const v = inner()?` — `?` propagation in const-decl (repro-3)
// ---------------------------------------------------------------------------

describe("errarm-refail §3: `?` propagation desugars in a const-decl", () => {
  const src = [
    "type AErr:enum = { Wrapped(reason: string) }",
    "function inner()! -> AErr { fail AErr::Wrapped(\"boom\") }",
    "function outer()! -> AErr {",
    "    const v = inner()?",
    "    return v",
    "}",
  ].join("\n");

  test("no E-CODEGEN-INVALID-JS; emits the propagate-expr desugaring", () => {
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-propagate");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    // The `?` must NOT survive into emitted JS as a literal suffix.
    expect(clientJs).not.toMatch(/\(\s*\)\s*\?\s*;/);
    // propagate-expr lowering: const tmp = …; if (tmp.__scrml_error) return tmp; const v = tmp;
    expect(clientJs).toMatch(/if \(_scrml_\w+\.__scrml_error\) return _scrml_\w+;/);
    cleanup();
  });

  test("parity with the `let` form (which already worked)", () => {
    const letSrc = src.replace("const v = inner()?", "let v = inner()?");
    const { result, cleanup } = compileSrc(letSrc, "errarm-propagate-let");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §4: control — statement-position `fail` STILL works (no regression)
// ---------------------------------------------------------------------------

describe("errarm-refail §4: statement-position fail control (no regression)", () => {
  test("`if (x) fail …` still lowers to the tagged-error envelope", () => {
    const src = [
      "type AErr:enum = { Bad(reason: string) }",
      "function check(amount)! -> AErr {",
      "    if (amount <= 0) fail AErr::Bad(\"must be positive\")",
      "    return amount",
      "}",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-control");
    expect(codes(result)).not.toContain("E-SCOPE-001");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    // §51.3.2 field-keyed `.data` — Bad(reason) -> `data: { reason: … }`.
    expect(clientJs).toMatch(/return \{ __scrml_error: true, type: "AErr", variant: "Bad", data: \{ reason: "must be positive" \} \};/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §5: NEGATIVE (NS-1) — re-fail from a `!{}` arm in a NON-`!` function
// ---------------------------------------------------------------------------

describe("errarm-refail §5: NS-1 — `!{}` arm re-fail in a non-! function fires E-ERROR-001", () => {
  test("E-ERROR-001 fires (fail is valid only inside a `!` function body)", () => {
    const src = [
      "type BErr:enum = { X(reason: string) }",
      "type AErr:enum = { Wrapped(reason: string) }",
      "function inner()! -> BErr { fail BErr::X(\"boom\") }",
      "function outer() {",   // NON-! enclosing function
      "    const v = inner() !{",
      "        | ::X reason :> { fail AErr::Wrapped(reason) }",
      "    }",
      "    return v",
      "}",
    ].join("\n");
    const { result, cleanup } = compileSrc(src, "errarm-ns1-block");
    const e001 = (result.errors ?? []).find((e) => e.code === "E-ERROR-001");
    expect(e001).toBeDefined();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §6: NEGATIVE (NS-1) — re-fail from a match value-arm in a NON-`!` function
// ---------------------------------------------------------------------------

describe("errarm-refail §6: NS-1 — match value-arm re-fail in a non-! function fires E-ERROR-001", () => {
  test("E-ERROR-001 fires", () => {
    const src = [
      "type BErr:enum = { X(reason: string), Y }",
      "type AErr:enum = { Wrapped(reason: string) }",
      "function inner()! -> BErr { fail BErr::X(\"boom\") }",
      "function outer() {",   // NON-! enclosing function
      "    const v = match inner() {",
      "        ::X(reason)  :> fail AErr::Wrapped(reason)",
      "        ::Y          :> fail AErr::Wrapped(\"y\")",
      "    }",
      "    return v",
      "}",
    ].join("\n");
    const { result, cleanup } = compileSrc(src, "errarm-ns1-match");
    const e001 = (result.errors ?? []).find((e) => e.code === "E-ERROR-001");
    expect(e001).toBeDefined();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §7: route-to-state arm idiom (non-`!`, NOT a re-fail) STILL compiles clean
// ---------------------------------------------------------------------------

describe("errarm-refail §7: route-to-state arm idiom (non-! function) — no regression", () => {
  test("`load() !{ | ::X msg :> { @phase = .Error(msg) } }` compiles clean", () => {
    const src = [
      "<program>",
      "${",
      "  type LoadError:enum = { NetworkError(msg: string) }",
      "  type Phase:enum = { Idle, Error(msg: string) }",
      "  @phase: Phase = Phase.Idle",
      "  server function load()! -> LoadError { lift [] }",
      "  function init() {",
      "    load() !{",
      "      | ::NetworkError msg :> { @phase = Phase.Error(msg) }",
      "    }",
      "  }",
      "}",
      "<p>${@phase}</p>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "errarm-route-to-state");
    // The route-to-state idiom is NOT a re-fail — it must compile clean and emit
    // a reactive write, not a tagged-error return (no regression from errarm-refail).
    expect(result.errors ?? []).toHaveLength(0);
    expect(codes(result)).not.toContain("E-SCOPE-001");
    expect(codes(result)).not.toContain("E-ERROR-001");
    expect(codes(result)).not.toContain("E-CODEGEN-INVALID-JS");
    // The route-to-state arm emits a reactive write to @phase (NOT a tagged-error
    // return). The `__scrml_error` envelope CHECK on the guarded result is normal
    // (it is how `!{}` tests the failable call's result); what matters is the arm
    // BODY routes to state — assert the reactive write to `phase` is present.
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*Phase\.Error/);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// §8: emitted JS is node-parseable for all three positive shapes
// ---------------------------------------------------------------------------

describe("errarm-refail §8: emitted JS parses (node --check equivalent)", () => {
  const cases = [
    {
      name: "!{} block arm",
      base: "parse-block",
      src: [
        "type BErr:enum = { X(reason: string), Y }",
        "type AErr:enum = { Wrapped(reason: string) }",
        "function inner()! -> BErr { fail BErr::X(\"boom\") }",
        "function outer()! -> AErr {",
        "    const v = inner() !{",
        "        | ::X reason :> { fail AErr::Wrapped(reason) }",
        "        | ::Y        :> { fail AErr::Wrapped(\"y\") }",
        "    }",
        "    return v",
        "}",
      ].join("\n"),
    },
    {
      name: "match value-arm",
      base: "parse-match",
      src: [
        "type BErr:enum = { X(reason: string), Y }",
        "type AErr:enum = { Wrapped(reason: string) }",
        "function inner()! -> BErr { fail BErr::X(\"boom\") }",
        "function outer()! -> AErr {",
        "    const v = match inner() {",
        "        ::X(reason)  :> fail AErr::Wrapped(reason)",
        "        ::Y          :> fail AErr::Wrapped(\"y\")",
        "    }",
        "    return v",
        "}",
      ].join("\n"),
    },
    {
      name: "const ?-propagation",
      base: "parse-propagate",
      src: [
        "type AErr:enum = { Wrapped(reason: string) }",
        "function inner()! -> AErr { fail AErr::Wrapped(\"boom\") }",
        "function outer()! -> AErr {",
        "    const v = inner()?",
        "    return v",
        "}",
      ].join("\n"),
    },
  ];

  for (const c of cases) {
    test(`${c.name} — emitted client.js parses as valid JS`, () => {
      const { result, clientJs, cleanup } = compileSrc(c.src, c.base);
      expect(result.errors ?? []).toHaveLength(0);
      // Strip ESM imports (the runtime shim imports aren't resolvable in new Function).
      const stripped = clientJs.replace(/^\s*import\s.*$/gm, "");
      expect(() => new Function(stripped)).not.toThrow();
      cleanup();
    });
  }
});
