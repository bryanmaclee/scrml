// ---------------------------------------------------------------------------
// g-nominal-foreign-forms-not-failclosed — §23.3 WASM call-char sigils + §23.4
// `use foreign:` sidecars are Nominal/spec-ahead and MUST fail closed with an
// HONEST "not implemented" diagnostic (RULED S231, user "Honest Nominal-
// unimplemented code"; the v1.0 fail-closed-Nominal invariant).
//
// N5 (§23.3): `extern r applyFilter(...)` + `r{ applyFilter(@x) }` previously
//   fired a MISLEADING E-SCOPE-001 on both `extern` and the call char `r`.
//   Now → E-WASM-NOMINAL, no E-SCOPE-001 on `extern`/`r`.
// N6 (§23.4): a `use foreign:ml { predict }` + bare `server function` previously
//   compiled CLEAN (exit 0) and SILENTLY MISCOMPILED — the `use foreign:` line +
//   the server fn leaked as literal HTML, and the nested sidecar `<program>`
//   compiled to a `new Worker(...)` + a client stub. Now → E-FOREIGN-SIDECAR-
//   NOMINAL, no HTML leak, no worker/client stub, fail-closed (exit 1).
//
// ADVERSARIAL (S215): the working siblings must NOT mis-fire —
//   - a `<program callchar=X>` ATTRIBUTE stays legal (only extern/sigil USE forms fail);
//   - `import:host`, plain `use scrml:ui`, and CSS `#{}` are untouched.
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const TMP = mkdtempSync(join(tmpdir(), "nominal-foreign-"));

function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  const result = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
  return { result, path: p };
}

// Cross-stream diagnostic collector — a code can land in result.errors OR
// result.warnings depending on the W-/I- prefix + severity partition (memory:
// feedback_diagnostic_stream_partition). E-* codes are fatal (result.errors),
// but collect both streams so the assertions never silently pass.
function allDiagnostics(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}
function codeCount(result, code) {
  return allDiagnostics(result).filter((d) => (d.code ?? "") === code).length;
}
function hasMessageMatching(result, re) {
  return allDiagnostics(result).some((d) => re.test(d.message ?? ""));
}

// ---------------------------------------------------------------------------
// N5 — §23.3 WASM call-char sigils + `extern`
// ---------------------------------------------------------------------------
describe("N5 §23.3 WASM call-char forms fail closed with E-WASM-NOMINAL", () => {
  const N5_SRC =
    `<program>\n` +
    `    <program name="image-filter" lang="rust" mode="wasm" build="cargo b" source="./crates/x"/>\n` +
    `    \${ extern r applyFilter(brightness, pixels) -> number[] }\n` +
    `    <rawPixels> = []\n` +
    `    <brightness> = 1.0\n` +
    `    \${ const <filtered> = r{ applyFilter(@brightness, @rawPixels) } }\n` +
    `</>`;

  test("the `extern` declaration AND the `r{}` sigil each fire E-WASM-NOMINAL", () => {
    const { result } = compile(N5_SRC);
    // Both the extern line and the call-char sigil are recognised → 2 fires.
    expect(codeCount(result, "E-WASM-NOMINAL")).toBeGreaterThanOrEqual(2);
  });

  test("NO misleading E-SCOPE-001 on `extern` or the call char `r`", () => {
    const { result } = compile(N5_SRC);
    expect(hasMessageMatching(result, /Undeclared identifier `extern`/)).toBe(false);
    expect(hasMessageMatching(result, /Undeclared identifier `r`/)).toBe(false);
    expect(hasMessageMatching(result, /you meant a reactive `@r`/)).toBe(false);
  });

  test("fail-closed — the program does not compile clean", () => {
    const { result } = compile(N5_SRC);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  test("a lone `extern` declaration inside `${}` fires E-WASM-NOMINAL", () => {
    const src =
      `<program>\n` +
      `    <program name="k" lang="zig" mode="wasm" build="b" source="s"/>\n` +
      `    \${ extern z computeFFT(data) -> number[] }\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// N6 — §23.4 `use foreign:` sidecar declarations
// ---------------------------------------------------------------------------
describe("N6 §23.4 `use foreign:` fails closed with E-FOREIGN-SIDECAR-NOMINAL", () => {
  const N6_SRC =
    `<program>\n` +
    `    <program name="ml" lang="go" port="9001" health="/health">\n` +
    `        \${ export function predict(req) -> number }\n` +
    `    </>\n\n` +
    `    use foreign:ml { predict }\n\n` +
    `    server function getPrediction(features, modelId) {\n` +
    `        return predict({ features, modelId })\n` +
    `    }\n` +
    `</>`;

  test("fires E-FOREIGN-SIDECAR-NOMINAL (honest)", () => {
    const { result } = compile(N6_SRC);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBeGreaterThanOrEqual(1);
  });

  test("NO E-USE-001 (the lift is internal, not author placement) and NO E-SCOPE-001 on the sidecar fn", () => {
    const { result } = compile(N6_SRC);
    expect(codeCount(result, "E-USE-001")).toBe(0);
    expect(hasMessageMatching(result, /Undeclared identifier `predict`/)).toBe(false);
  });

  test("fail-closed — the program does not compile clean", () => {
    const { result } = compile(N6_SRC);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  test("NO HTML leak — the `use foreign:` line + the server fn body do not reach the rendered HTML", () => {
    const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
    writeFileSync(p, N6_SRC);
    const result = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
    const out = result.outputs.get(p) ?? {};
    const html = out.html ?? "";
    expect(html).not.toContain("use foreign");
    expect(html).not.toContain("server function");
    expect(html).not.toContain("return predict");
  });

  test("NO client stub — no `new Worker(...)` for the sidecar program, no empty predict stub", () => {
    const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
    writeFileSync(p, N6_SRC);
    const result = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
    const out = result.outputs.get(p) ?? {};
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(foldChunkNamespacing(out.clientJs) ?? ""));
    expect(clientJs).not.toContain("new Worker");
    expect(clientJs).not.toContain(".worker.js");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — the working siblings must compile exactly as before (zero new fires)
// ---------------------------------------------------------------------------
describe("adversarial siblings — zero new E-WASM-NOMINAL / E-FOREIGN-SIDECAR-NOMINAL fires", () => {
  test("a `<program callchar=X>` ATTRIBUTE stays legal (declaring a call char != using a sigil)", () => {
    const src =
      `<program>\n` +
      `    <program name="mathkernel" lang="go" mode="wasm" callchar="g" build="b" source="s"/>\n` +
      `    <count> = 0\n` +
      `    <p>Count: \${@count}</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBe(0);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
  });

  test("plain `use scrml:ui { Button }` is untouched (no foreign-nominal fire)", () => {
    const src =
      `use scrml:ui { Button }\n` +
      `<program>\n` +
      `    <count> = 0\n` +
      `    <p>Count: \${@count}</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBe(0);
  });

  test("CSS `#{}` is untouched (no foreign-nominal fire)", () => {
    const src =
      `<program>\n` +
      `    <count> = 0\n` +
      `    #{\n      .box { color: red; }\n    }\n` +
      `    <p class="box">Count: \${@count}</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBe(0);
  });

  test("`import:host` is untouched (the `import` path is not the `use foreign:` path)", () => {
    const src =
      `import:host { runCG as _runCG } from "../../compiler/src/codegen/index.ts"\n` +
      `<program>\n` +
      `    <count> = 0\n` +
      `    <p>Count: \${@count}</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBe(0);
  });

  test("a derived cell whose RHS merely STARTS with a call-char letter does not false-fire (`const <c> = cards`)", () => {
    const src =
      `<program>\n` +
      `    <cards> = [1, 2, 3]\n` +
      `    \${ const <count> = cards.length }\n` +
      `    <p>Count: \${@count}</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-WASM-NOMINAL")).toBe(0);
  });
});
