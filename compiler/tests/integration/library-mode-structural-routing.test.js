/**
 * library-mode-structural-routing.test.js
 *
 * g-library-mode-no-typed-payload-match (§7.5 / §14.10 cross-mode parity) — a
 * library fn with NO `match` in it must still route through the structured
 * `emitLibraryFnMember`, so scrml-only constructs in its body lower instead of
 * shipping verbatim into the importable `.js`.
 *
 * THE BUG THIS PINS. `emit-library.ts`'s control-flow router opted IN one
 * construct at a time — `if (!fnBodyContainsMatch(node)) continue;` — so a fn
 * without a `match` never reached the structural emitter at all. Two members of
 * that class were open:
 *   · a LOCAL type annotation, `let acc: int = …` (§7.5: *"Type annotations
 *     appear on variable declarations, function parameters, and function return
 *     types throughout scrml logic contexts"*). `cleanFnSignatures` strips only
 *     the SIGNATURE annotations, so the local's `: int` shipped verbatim.
 *   · bare/payload VARIANT construction, `return .Ok(n)` (§14.10: *"A bare
 *     variant reference SHALL be resolved by the compiler when the type at the
 *     position can be inferred from … a function return type"*).
 * Both lowered CORRECTLY the moment a dummy `match` was added to the same body,
 * which is what identified the routing predicate — not the lowering — as the
 * defect. The router now routes by default.
 *
 * ⚑ AND THE FAILURE WAS SILENT, WHICH IS WHY THESE ASSERTIONS DO NOT STOP AT THE
 * ERROR LIST. The §2.2.1 E-CODEGEN-INVALID-LOGIC emit gate is `validateEmit`-
 * flagged (default OFF) and only runs on a WRITING build, so the ordinary
 * compile path emitted `let acc: int = n * 2` at exit 0 with zero diagnostics
 * across `errors` / `warnings` / `lintDiagnostics`. A test that only asserted
 * "no error code" would have passed against the bug. Every case here also
 * IMPORTS AND RUNS the emitted module.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "lib-structural-routing-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

function compileLib(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  // Real source files end in a newline; a bare-fn library file with NO trailing
  // newline trips a separate pre-existing whole-block `}`-strip quirk
  // (g-library-bare-fn-no-trailing-newline-brace-strip), unrelated to routing.
  writeFileSync(filePath, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    mode: "library",
    write: true,
    validateEmit: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const libPath = join(outDir, `${name}.js`);
  return {
    errorCodes: errors.map((e) => e.code),
    libPath,
    libExists: existsSync(libPath),
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
  };
}

async function loadLib(libPath) {
  // Cache-bust so re-emitted modules of the same name are re-read.
  return import(`${pathToFileURL(libPath).href}?t=${Date.now()}`);
}

describe("library-mode structural routing (g-library-mode-no-typed-payload-match)", () => {
  test("LIMB A — a LOCAL type annotation in a match-free fn lowers, and the module runs", async () => {
    const r = compileLib(
      "local-annot",
      `export fn calc(n: int) -> int {
  let acc: int = n * 2
  const label: string = "x"
  return acc
}`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The annotation must not survive into the emitted JS. Anchored on the
    // DECLARATION shape (`: int =`) rather than a bare `: int`, so an object
    // literal or a comment mentioning a type cannot make this pass vacuously.
    expect(/\blet\s+acc\s*:/.test(r.libraryJs)).toBe(false);
    expect(/\bconst\s+label\s*:/.test(r.libraryJs)).toBe(false);
    expect(r.libraryJs).toContain("let acc = n * 2");
    // R26 empirical — the emitted module imports and computes.
    const mod = await loadLib(r.libPath);
    expect(mod.calc(21)).toBe(42);
  });

  test("LIMB B — payload-variant construction in a match-free fn lowers, and the module runs", async () => {
    const r = compileLib(
      "payload-variant",
      `type Res:enum = { Ok(n: int) | Err(m: string) }

export fn wrap(n: int) -> Res {
  return .Ok(n)
}`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(r.libExists).toBe(true);
    // The bare `.Ok(n)` must not survive as raw scrml.
    expect(/\breturn\s+\.Ok\b/.test(r.libraryJs)).toBe(false);
    expect(r.libraryJs).toContain('variant: "Ok"');
    const mod = await loadLib(r.libPath);
    const v = mod.wrap(7);
    expect(v.variant).toBe("Ok");
    expect(v.data.n).toBe(7);
  });

  test("a UNIT bare-variant return lowers too (same §14.10 inference, no payload)", async () => {
    const r = compileLib(
      "unit-variant",
      `type St:enum = { Idle | Busy }

export fn start() -> St {
  return .Idle
}`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(/\breturn\s+\.Idle\b/.test(r.libraryJs)).toBe(false);
    const mod = await loadLib(r.libPath);
    expect(mod.start()).toBeDefined();
  });

  test("§45 — a routed fn's `==` lowers to _scrml_structural_eq AND the helper travels with the module", async () => {
    // A library `.js` is a bare ES module with NO client runtime, so a lowering
    // that reaches for a runtime helper must ship the DEFINITION or the module
    // parses and then throws on first call — strictly worse than the raw path's
    // loud syntax error. This pins the on-use inline (LIB_RUNTIME_HELPERS).
    const r = compileLib(
      "structural-eq",
      `export fn isTag(v, t: string) -> boolean {
  let hit: boolean = v == t
  return hit
}`,
    );
    expect(r.errorCodes).toEqual([]);
    expect(r.libraryJs).toContain("_scrml_structural_eq(");
    expect(/function\s+_scrml_structural_eq\b/.test(r.libraryJs)).toBe(true);
    // No `_scrml_*(…)` call may be left without a definition in the module.
    const called = new Set(
      [...r.libraryJs.matchAll(/\b(_scrml_[A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]),
    );
    for (const name of called) {
      expect(new RegExp(`function\\s+${name}\\b`).test(r.libraryJs)).toBe(true);
    }
    const mod = await loadLib(r.libPath);
    expect(mod.isTag("a", "a")).toBe(true);
    expect(mod.isTag("a", "b")).toBe(false);
  });

  test("SCOPE BOUNDARY — an `if`-expression-value binding is still NOT routed", () => {
    // Browser mode's own `if`-bound-`let` lowering assigns arm values to fresh
    // block-scoped temps, so the binding stays null at runtime
    // (g-if-expression-value-binding-lowers-null). Routing such a fn would trade
    // the raw path's plain-JS `if` for that silent-wrong. `rawFallbackReason`
    // names it as the one standing exclusion; this pins the exclusion so a
    // future widening has to confront it deliberately.
    const r = compileLib(
      "if-expr-excluded",
      `export fn pick(n: int) -> string {
  let out = if (n > 10) { "big" } else { "small" }
  return out
}`,
    );
    // It stays on the raw path, where `let out = if (…) {…}` is not valid JS —
    // so the §2.2.1 emit gate rejects it LOUDLY and writes no artifact. That is
    // the behaviour being preserved: a loud reject beats a quiet `null` binding.
    expect(r.errorCodes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.libExists).toBe(false);
  });

  test("REGRESSION GUARD — an unverifiable function-decl span falls back to raw, never a corrupted splice", async () => {
    // ⚑ `function-decl` spans are NOT reliable. Measured on
    // `compiler/native-parser/ast-expr.scrml`, every top-level `export fn` there
    // reports a span whose start sits ~22 chars INSIDE its own parameter list and
    // whose end overshoots its closing brace into the NEXT statement's comment.
    // Splicing those offsets emitted
    // `export function makeIdent(name, spait — numeric literal.` — neither the
    // raw text nor the structural emit. `verifiedFnRemovalRange` refuses a span
    // it cannot show covers the fn's own text.
    //
    // The invariant asserted here is the one that matters and holds regardless of
    // which spans happen to be accurate today: whatever the router decides, the
    // emitted module never contains a MANGLED declaration head, and it still runs.
    const r = compileLib(
      "span-shape",
      `// leading comment
export fn alpha(name: string, span: int) -> string {
  let out: string = name
  return out
}

// interleaved comment — the overshoot target
export fn beta(value: int, raw: string, span: int) -> int {
  let out: int = value
  return out
}`,
    );
    expect(r.errorCodes).toEqual([]);
    // Every emitted `function` head is well-formed: name then a balanced
    // parameter list, never a comment fragment spliced into the middle.
    for (const m of r.libraryJs.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
      expect(m[2]).not.toContain("—");
      expect(m[2]).not.toContain("//");
    }
    const mod = await loadLib(r.libPath);
    expect(mod.alpha("hi", 0)).toBe("hi");
    expect(mod.beta(5, "5", 0)).toBe(5);
  });
});
