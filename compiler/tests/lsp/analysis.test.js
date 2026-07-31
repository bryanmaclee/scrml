// LSP L1 — extractAnalysisInfo regression test.
//
// Pre-L1, the AST-walk in lsp/server.js checked node.kind against
// "FunctionDecl" / "ReactiveAssign" (PascalCase / wrong names) so functions
// and @-vars never populated the analysis cache; hover and definition on
// function names silently failed. L1 fixed the kind-matching to use the
// canonical lowercase-kebab kinds. This test guards against a regression.

import { describe, it, expect } from "bun:test";
import { analyzeText } from "../../../lsp/handlers.js";

describe("LSP L1 — extractAnalysisInfo (regression: canonical AST kinds)", () => {
  it("populates analysis.functions for `function-decl` (not 'FunctionDecl')", () => {
    const src = "<program>\n${\n  function alpha() { return 1 }\n  server function beta(x) { return x }\n}\n</program>\n";
    const { analysis } = analyzeText("/t.scrml", src);
    const names = analysis.functions.map(f => f.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    const beta = analysis.functions.find(f => f.name === "beta");
    expect(beta.isServer).toBe(true);
    // params are objects { name } in the canonical AST.
    expect(beta.params.length).toBe(1);
    const firstParamName = typeof beta.params[0] === "string" ? beta.params[0] : beta.params[0].name;
    expect(firstParamName).toBe("x");
  });

  it("populates analysis.reactiveVars for `state-decl`", () => {
    const src = "<program>\n${\n  @count = 0\n  @name = \"\"\n}\n</program>\n";
    const { analysis } = analyzeText("/t.scrml", src);
    const names = analysis.reactiveVars.map(v => v.name);
    expect(names).toContain("count");
    expect(names).toContain("name");
    expect(analysis.reactiveVars.find(v => v.name === "count").reactiveKind).toBe("reactive");
  });

  it("populates analysis.reactiveVars for derived state-decl (const @x; post-Step-11.5 fold)", () => {
    const src = "<program>\n${\n  @x = 1\n  const @y = @x * 2\n}\n</program>\n";
    const { analysis } = analyzeText("/t.scrml", src);
    const y = analysis.reactiveVars.find(v => v.name === "y");
    expect(y).toBeTruthy();
    expect(y.reactiveKind).toBe("derived");
  });

  it("collects type-decls into analysis.types", () => {
    const src = "<program>\n${\n  type Foo:enum = { A, B }\n  type Bar:struct = { x: number }\n}\n</program>\n";
    const { analysis } = analyzeText("/t.scrml", src);
    const names = analysis.types.map(t => t.name);
    expect(names).toContain("Foo");
    expect(names).toContain("Bar");
    expect(analysis.types.find(t => t.name === "Foo").typeKind).toBe("enum");
  });

  it("collects engine-decls into analysis.machines with governedType", () => {
    const src = [
      "<program>",
      "${",
      "  type T:enum = { A, B }",
      "  @t: TM = T.A",
      "}",
      "< engine name=TM for=T>",
      "  T.A -> T.B : on bump",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { analysis } = analyzeText("/t.scrml", src);
    expect(analysis.machines.length).toBeGreaterThanOrEqual(1);
    const tm = analysis.machines.find(m => m.name === "TM");
    expect(tm).toBeTruthy();
    expect(tm.governedType).toBe("T");
  });

  it("collects components into analysis.components", () => {
    const src = "<program>\n${\n  const Card = <article>x</>\n  @x = 0\n}\n</program>\n";
    const { analysis } = analyzeText("/t.scrml", src);
    expect(analysis.components.map(c => c.name)).toContain("Card");
  });

  it("returns an analysis object even when the file has parse errors", () => {
    const src = "<program>\n${"; // unterminated logic block
    const { analysis, diagnostics } = analyzeText("/t.scrml", src);
    expect(analysis).toBeTruthy();
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
