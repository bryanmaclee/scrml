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
//   compiled to a `new Worker(...)` + a client stub. Now: no HTML leak, no
//   worker/client stub, fail-closed (exit 1).
//
// CODE CHANGED S356 r4. The N6 refusal used to be `E-FOREIGN-SIDECAR-NOMINAL`,
// fired at the `use foreign:` USE site. That code is RETIRED: it said the same
// thing as `E-NESTED-PROGRAM-CONTEXT-NOMINAL` (§4.12.9) — *this execution context
// is specified but unbuilt; refuse rather than emit a stub* — and the two were
// told apart only by which site noticed. Three rounds of drawing that line
// produced three defects. The DECLARATION is now the single fire site for all
// four unbuilt §4.12.3 contexts, sidecar included. The BEHAVIOUR N6 pins is
// unchanged in every other respect: still exactly one error, still no HTML leak,
// still no `new Worker(...)`, still exit 1.
//
// The use site keeps a diagnostic for its OWN condition, `E-FOREIGN-010` (§23.4,
// "references a name that matches no nested `<program>`") — ratified in §34 since
// the section landed, unimplemented until r4, and the reason retirement did not
// open a hole. See the `E-FOREIGN-010` describe block below.
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
describe("N6 §23.4 `use foreign:` fails closed at the sidecar DECLARATION", () => {
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

  test("fires E-NESTED-PROGRAM-CONTEXT-NOMINAL (honest) — EXACTLY once", () => {
    const { result } = compile(N6_SRC);
    expect(codeCount(result, "E-NESTED-PROGRAM-CONTEXT-NOMINAL")).toBe(1);
  });

  // The retirement guard. This is the assertion the r3 conformance corpus did NOT
  // have: neither capability case listed the co-firing code in `notCodes`, so a
  // genuine double fire passed 894/894. A count of ZERO on the retired code plus a
  // count of ONE on the surviving one is what makes "consolidated" checkable.
  test("E-FOREIGN-SIDECAR-NOMINAL is RETIRED — it fires nowhere", () => {
    const { result } = compile(N6_SRC);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
  });

  test("a CLAIMED sidecar is refused exactly ONCE in total (no double fire)", () => {
    const { result } = compile(N6_SRC);
    const nominalish = allDiagnostics(result).filter((d) =>
      (d.code ?? "") === "E-NESTED-PROGRAM-CONTEXT-NOMINAL" ||
      (d.code ?? "") === "E-FOREIGN-SIDECAR-NOMINAL");
    expect(nominalish.length).toBe(1);
  });

  test("the message makes NO claim about whether a `use foreign:` exists", () => {
    const { result } = compile(N6_SRC);
    // r3's wording asserted "NOTHING IN THIS FILE CLAIMS IT: there is no
    // `use foreign:ml { … }` declaration in the parent" — provably false on this
    // very fixture, whose line 6 is exactly that declaration.
    expect(hasMessageMatching(result, /NOTHING IN THIS FILE CLAIMS IT/)).toBe(false);
    expect(hasMessageMatching(result, /there is no `use foreign:/)).toBe(false);
  });

  test("a CLAIMED sidecar does NOT fire E-FOREIGN-010 — the name resolves", () => {
    const { result } = compile(N6_SRC);
    expect(codeCount(result, "E-FOREIGN-010")).toBe(0);
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
// E-FOREIGN-010 — the hole retirement WOULD have opened, closed with the code
// SPEC already requires for it.
//
// §23.4 normative: "The `name` in `use foreign:name` MUST match the `name=`
// attribute of a nested `<program>` declared within the same top-level
// `<program>`. An unresolved name SHALL be a compile error (E-FOREIGN-010 …)."
//
// MEASURED BEFORE ANYTHING WAS DELETED (S356 r4): a `use foreign:ghost { run }`
// with no `<program name="ghost">` anywhere fired `E-FOREIGN-SIDECAR-NOMINAL` and
// nothing else. Not E-SCOPE-001 — the `foreign:` branch keeps `names` in scope on
// purpose, so a `run(...)` call site does not double-report. Not E-IMPORT-005 —
// it leaves `source` null on purpose, so MOD skips resolution. Both suppressions
// are right; together they left an unresolved reference with NO diagnostic. So
// the retired code was load-bearing for a condition that has nothing to do with
// Nominal-ness, and this is that condition's own code.
// ---------------------------------------------------------------------------
describe("E-FOREIGN-010 §23.4 — `use foreign:` naming a sidecar nothing declares", () => {
  const GHOST_SRC =
    `<program>\n` +
    `    use foreign:ghost { run }\n\n` +
    `    <p>hi</p>\n` +
    `</>`;

  test("fires E-FOREIGN-010 — exactly once", () => {
    const { result } = compile(GHOST_SRC);
    expect(codeCount(result, "E-FOREIGN-010")).toBe(1);
  });

  test("fails closed — the file does not compile clean", () => {
    const { result } = compile(GHOST_SRC);
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  test("does NOT also fire the declaration-site Nominal code — there is no declaration", () => {
    const { result } = compile(GHOST_SRC);
    expect(codeCount(result, "E-NESTED-PROGRAM-CONTEXT-NOMINAL")).toBe(0);
  });

  test("names the sidecars that ARE declared, so a typo is diagnosable from the message", () => {
    const src =
      `<program>\n` +
      `    <program name="ml" lang="go" port="9001">\n` +
      `        \${ export function predict(req) -> number }\n` +
      `    </>\n\n` +
      `    use foreign:mml { predict }\n\n` +
      `    <p>hi</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-010")).toBe(1);
    expect(hasMessageMatching(result, /E-FOREIGN-010.*use foreign:mml/)).toBe(true);
    expect(hasMessageMatching(result, /nested programs declared here are: `ml`/)).toBe(true);
  });

  test("a `use foreign:` INSIDE the sidecar's own subtree still resolves (the r3 double-fire shape)", () => {
    // The two ratified capability conformance cases put the `use foreign:` here
    // deliberately — it is how §23.5.4 closest-wins inheritance gets exercised.
    // r3's `excludeSubtree` walk called this UNCLAIMED and double-fired; there is
    // no exclusion now, and `probe` resolves against its own declaration.
    const src =
      `<program capabilities=[network("api.example.com")]>\n` +
      `  <program name="probe" lang="ts">\n` +
      `    use foreign:probe { run }\n` +
      `  </>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-010")).toBe(0);
    expect(codeCount(result, "E-NESTED-PROGRAM-CONTEXT-NOMINAL")).toBe(1);
    expect(codeCount(result, "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
  });

  test("resolution is by NAME, not by execution context — a WASM-shaped target is not 'unresolved'", () => {
    // `E-FOREIGN-010` means "matches no nested `<program>`". Pointing a
    // `use foreign:` at a `mode="wasm"` program is a WRONG-CONTEXT mistake
    // (E-FOREIGN-011/012 territory, landing with the sidecar layer), and reporting
    // it as an unresolved NAME would be false.
    const src =
      `<program>\n` +
      `    <program name="calc" lang="rust" mode="wasm" build="b" source="s"/>\n` +
      `    use foreign:calc { run }\n\n` +
      `    <p>hi</p>\n` +
      `</>`;
    const { result } = compile(src);
    expect(codeCount(result, "E-FOREIGN-010")).toBe(0);
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
