/**
 * Bug 67 (S157) — `return match expr { ... }` in a fn/function body is now
 * exhaustiveness-checked.
 *
 * Before the fix, a value-return `match` used directly as a return-statement
 * value (`return match @phase { .Idle => "i" .Loading => "l" }`) was NOT run
 * through exhaustiveness checking — a missing enum variant was silently
 * accepted (exit 0, no diagnostic). The sibling `let r = match ...` form in
 * the same body DID fire E-TYPE-020.
 *
 * Layer: PARSER gap. The let-decl / const-decl init builders route a match
 * initializer through `parseOneMatchAsExpr` (producing a STRUCTURAL match-expr
 * node with header + body) and store it on a `matchExpr` side-field that the
 * typer's let-decl walker explicitly visits → checkMatchDiagnostics →
 * exhaustiveness (E-TYPE-020). The return-stmt builder had NO such hook: it
 * collected the value via collectExpr + safeParseExprToNode, producing an
 * ExprNode-form match-expr (the `rawArms: string[]` shape) that the typer's
 * exhaustiveness path never visits.
 *
 * Fix: the return-stmt builder now mirrors the let/const hook — `return match`
 * builds a structural match-expr (parseOneMatchAsExpr) stored as
 * `return-stmt.matchExpr`; the typer's return-stmt walker visits it; codegen
 * emits it via the shared expression-form match emitter (the same clean IIFE
 * the `return match` form produced before this fix).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug67-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug67_${tag}`);
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

describe("Bug 67 — `return match` exhaustiveness", () => {
  test("`return match` with a MISSING enum variant fires E-TYPE-020 naming the variant", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  fn label() -> string {
    return match @phase { .Idle => "i" .Loading => "l" }
  }
}
<div>\${@phase} \${label()}</div>
</program>
`;
    const { errors } = compileSource(src, "missing-variant");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    const err = findCode(errors, "E-TYPE-020");
    expect(err.message).toContain("Phase");
    expect(err.message).toContain("::Done");
  });

  test("EXHAUSTIVE `return match` (all variants covered) compiles CLEAN — no E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  fn label() -> string {
    return match @phase { .Idle => "i" .Loading => "l" .Done => "d" }
  }
}
<div>\${@phase} \${label()}</div>
</program>
`;
    const { errors, clientJs } = compileSource(src, "exhaustive-clean");
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    // No over-fire of any exhaustiveness code.
    expect(hasCode(errors, "E-MATCH-NOT-EXHAUSTIVE")).toBe(false);
    // Codegen still emits valid value-return JS for every arm.
    expect(clientJs).toBeTruthy();
    expect(clientJs).toContain('return "i"');
    expect(clientJs).toContain('return "l"');
    expect(clientJs).toContain('return "d"');
  });

  test("PARITY: sibling `let r = match` (same body) still fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  <phase>: Phase = .Idle
  function go() {
    let r: string = match @phase { .Idle => "i" .Loading => "l" }
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

  test("fn-PARAM subject: `return match p` over a typed fn parameter fires E-TYPE-020", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  fn label(p: Phase) -> string {
    return match p { .Idle => "i" .Loading => "l" }
  }
}
<div>\${label(.Idle)}</div>
</program>
`;
    const { errors } = compileSource(src, "fn-param");
    expect(hasCode(errors, "E-TYPE-020")).toBe(true);
    expect(findCode(errors, "E-TYPE-020").message).toContain("::Done");
  });

  test("exhaustive fn-PARAM `return match p` compiles clean (no over-fire)", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  fn label(p: Phase) -> string {
    return match p { .Idle => "i" .Loading => "l" .Done => "d" }
  }
}
<div>\${label(.Idle)}</div>
</program>
`;
    const { errors } = compileSource(src, "fn-param-exhaustive");
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
  });

  test("payload-binding + wildcard `return match` (S95 shape) still emits valid JS", () => {
    const src = `<program>
\${
  type DragPhase:enum = {
    Idle
    Dragging(id: number)
  }
  <dragPhase>: DragPhase = .Idle
  function isDraggingThis(targetId) {
    return match @dragPhase {
      .Dragging(d) => d == targetId
      _ => false
    }
  }
}
<button onclick=isDraggingThis(1)>test</>
</program>
`;
    const { errors, clientJs } = compileSource(src, "payload-wildcard");
    // A wildcard arm makes the match exhaustive — no E-TYPE-020.
    expect(hasCode(errors, "E-TYPE-020")).toBe(false);
    expect(clientJs).toBeTruthy();
    // Payload binding destructured from the tagged-object data field.
    expect(clientJs).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
    // Wildcard arm lowered to a clean else branch.
    expect(clientJs).toContain("else return false;");
  });
});
