/**
 * Bug 71 (S157) — top-level derived `const <x> = match @cell { ... }` is now
 * exhaustiveness-checked.
 *
 * Before the fix, a derived state cell whose RHS is a value-return `match`
 * (`const <label> = match @phase { .Idle :> "i" .Loading :> "l" }` at
 * file/program scope) was NOT run through exhaustiveness checking — a missing
 * enum variant was silently accepted (exit 0, no diagnostic). The sibling
 * `let r = match ...` / `return match ...` (Bug 67) forms DID fire E-TYPE-020.
 *
 * Layer: PARSER gap — the DIRECT sibling of Bug 67. The let-decl / const-decl /
 * return-stmt builders route a match initializer through `parseOneMatchAsExpr`
 * (producing a STRUCTURAL match-expr node with header + parsed `match-arm-inline`
 * body) stored on a `matchExpr` side-field the typer explicitly visits →
 * checkMatchDiagnostics → exhaustiveness (E-TYPE-020). The structural
 * state-decl builder (`tryParseStructuralDecl`, the `<NAME> = ...` path) had NO
 * such hook: it collected the RHS via collectExpr + safeParseExprToNode,
 * producing an ExprNode-form match-expr (the `rawArms: string[]` shape) that the
 * typer's exhaustiveness path never visits.
 *
 * Fix: `tryParseStructuralDecl` now mirrors the let/const/return hook for a
 * match RHS. CRITICAL DIFFERENCE from Bug 67: a derived `const <x> = match` is a
 * REACTIVE cell (recomputes when `@cell` changes; emit-logic.ts shape:"derived"
 * builds `_scrml_derived_declare` + `_scrml_derived_subscribe` from
 * node.init / node.initExpr). To add exhaustiveness WITHOUT disturbing the
 * reactive recompute, the builder DUAL-PARSES the same token range: collectExpr
 * first (init / initExpr byte-identical → reactive emit unchanged), then rewinds
 * and runs parseOneMatchAsExpr to build a STRUCTURAL `matchExpr` that rides
 * alongside as a pure typer side-field (codegen ignores it). The typer's
 * state-decl walker visits node.matchExpr for exhaustiveness.
 *
 * The same structural-decl builder serves the PLAIN form (`<x> = match`, an
 * init-time value match) — that gets exhaustiveness too (same silent-undefined
 * hole), with its init-value emit (_scrml_reactive_set / _scrml_init_set)
 * likewise unchanged.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug71-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug71_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

const hasCode = (diags, code) => diags.some((d) => d.code === code);
const findCode = (diags, code) => diags.find((d) => d.code === code);

describe("Bug 71 — derived `const <x> = match @cell` exhaustiveness", () => {
  test("derived `const <x> = match` with a MISSING enum variant fires E-TYPE-020 naming the variant", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  const <label> = match @phase { .Idle :> "i" .Loading :> "l" }
}
<div>\${@label}</div>
</program>
`;
    const { errors } = compileSource(src, "missing-variant");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    const err = findCode(errors, "E-TYPE-020");
    expect(err.message).toContain("Phase");
    expect(err.message).toContain("::Done");
  });

  test("EXHAUSTIVE derived `const <x> = match` (all variants) compiles CLEAN — no over-fire", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  const <label> = match @phase { .Idle :> "i" .Loading :> "l" .Done :> "d" }
}
<div>\${@label}</div>
</program>
`;
    const { errors } = compileSource(src, "exhaustive-clean");
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    expect(hasCode(errors, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
  });

  // ── CODEGEN PARITY (load-bearing) ────────────────────────────────────────
  // The exhaustive derived cell MUST still emit a working REACTIVE cell: the
  // `_scrml_derived_declare` recompute closure evaluating the match per arm,
  // AND the `_scrml_derived_subscribe("label", "phase")` dependency edge so the
  // cell recomputes when @phase changes. The matchExpr side-field is a
  // TYPER-only artifact; codegen reads node.init/node.initExpr (unchanged).
  test("CODEGEN PARITY: exhaustive derived cell still emits a working REACTIVE recompute + dep edge", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  const <label> = match @phase { .Idle :> "i" .Loading :> "l" .Done :> "d" }
}
<div>\${@label}</div>
</program>
`;
    const { errors, clientJs } = compileSource(src, "codegen-parity");
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    expect(clientJs).toBeTruthy();
    // Reactive derived-cell declaration (the recompute closure).
    expect(clientJs).toContain('_scrml_derived_declare("label",');
    // The recompute reads @phase reactively.
    expect(clientJs).toContain('_scrml_reactive_get("phase")');
    // Every arm emits its value-return (the match IIFE body is intact).
    expect(clientJs).toContain('return "i"');
    expect(clientJs).toContain('return "l"');
    expect(clientJs).toContain('return "d"');
    // The reactive DEPENDENCY EDGE survives — the cell recomputes on @phase change.
    expect(clientJs).toContain('_scrml_derived_subscribe("label", "phase")');
  });

  // ── PARITY with the sibling forms (Bug 67 / let-decl / const-decl) ────────
  test("PARITY: sibling `let r = match` (in-fn) still fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  function go() {
    let r: string = match @phase { .Idle :> "i" .Loading :> "l" }
    return r
  }
}
<div>\${@phase}</div>
</program>
`;
    const { errors } = compileSource(src, "let-parity");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    expect(findCode(errors, "E-TYPE-020").message).toContain("::Done");
  });

  test("PARITY: `return match` (Bug 67) still fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  fn label() -> string {
    return match @phase { .Idle :> "i" .Loading :> "l" }
  }
}
<div>\${@phase} \${label()}</div>
</program>
`;
    const { errors } = compileSource(src, "return-match-parity");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    expect(findCode(errors, "E-TYPE-020").message).toContain("::Done");
  });

  // ── Legacy arrow-separator parity (`=>` arms must check identically) ──────
  test("legacy `=>` arm separator: derived `const <x> = match` missing-variant still fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  const <label> = match @phase { .Idle => "i" .Loading => "l" }
}
<div>\${@label}</div>
</program>
`;
    const { errors } = compileSource(src, "legacy-arrow-missing");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    expect(findCode(errors, "E-TYPE-020").message).toContain("::Done");
  });

  // ── PLAIN (non-const) structural-decl match form ─────────────────────────
  // The same structural-decl builder serves `<x> = match` (init-time value).
  // It carries the identical silent-undefined hole, so exhaustiveness fires
  // there too — and the init-value emit (reactive_set / init_set) is unchanged.
  test("PLAIN `<x> = match` (init-time) with a missing variant fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  <label> = match @phase { .Idle :> "i" .Loading :> "l" }
}
<div>\${@label}</div>
</program>
`;
    const { errors } = compileSource(src, "plain-missing");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    expect(findCode(errors, "E-TYPE-020").message).toContain("::Done");
  });

  test("PLAIN `<x> = match` (init-time) exhaustive compiles clean + emits an init value", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  <label> = match @phase { .Idle :> "i" .Loading :> "l" .Done :> "d" }
}
<div>\${@label}</div>
</program>
`;
    const { errors, clientJs } = compileSource(src, "plain-exhaustive");
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    expect(clientJs).toBeTruthy();
    // Init-value match (not a derived closure) — still emits every arm.
    expect(clientJs).toContain('_scrml_reactive_set("label",');
    expect(clientJs).toContain('return "d"');
  });

  // ── Payload-binding + wildcard derived match (exhaustive via wildcard) ────
  test("payload-binding + wildcard derived `const <x> = match` (S95 shape) emits valid JS, no over-fire", () => {
    const src = `<program>
\${
  type DragPhase:enum = {
    Idle
    Dragging(id: number)
  }
  <dragPhase>: DragPhase = .Idle
  const <isDragging> = match @dragPhase {
    .Dragging(d) :> true
    _ :> false
  }
}
<div>\${@isDragging}</div>
</program>
`;
    const { errors, clientJs } = compileSource(src, "payload-wildcard");
    // A wildcard arm makes the match exhaustive — no E-TYPE-020.
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    expect(clientJs).toBeTruthy();
    // Still a reactive derived cell.
    expect(clientJs).toContain('_scrml_derived_declare("isDragging",');
    expect(clientJs).toContain('_scrml_derived_subscribe("isDragging", "dragPhase")');
  });
});
