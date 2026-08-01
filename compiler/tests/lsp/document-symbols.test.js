// LSP L1 — document symbols (outline panel) tests.
//
// Verifies that buildDocumentSymbols produces a sensible hierarchical
// DocumentSymbol[] tree from the AST + analysis output of analyzeText.
//
// Reference: docs/deep-dives/lsp-enhancement-scoping-2026-04-24.md (L1 phase).

import { describe, it, expect } from "bun:test";
import { SymbolKind } from "vscode-languageserver/node";
import {
  analyzeText,
  buildDocumentSymbols,
} from "../../../lsp/handlers.js";

function symbolize(source, name = "test.scrml") {
  const { diagnostics, analysis } = analyzeText(name, source);
  return {
    diagnostics,
    analysis,
    symbols: buildDocumentSymbols(analysis.ast, source),
  };
}

describe("LSP L1 — buildDocumentSymbols", () => {
  it("returns an empty array for empty input", () => {
    const { symbols } = symbolize("");
    expect(symbols).toEqual([]);
  });

  it("emits Function symbols for client function declarations", () => {
    const src = "<program>\n${\n  function greet() { return 1 }\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const fn = symbols.find(s => s.name === "greet");
    expect(fn).toBeTruthy();
    expect(fn.kind).toBe(SymbolKind.Function);
    expect(fn.detail).toContain("greet()");
    expect(fn.detail).toContain("[client]");
  });

  it("emits Method symbols for server function declarations inside a state block", () => {
    const src = [
      "<program>",
      "< db src=\"x.db\" tables=\"users\">",
      "  ${",
      "    server function load() { return 0 }",
      "  }",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { symbols } = symbolize(src);
    const dbBlock = symbols.find(s => s.name === "<db>");
    expect(dbBlock).toBeTruthy();
    expect(dbBlock.kind).toBe(SymbolKind.Module);
    const fn = dbBlock.children.find(c => c.name === "load");
    expect(fn).toBeTruthy();
    expect(fn.kind).toBe(SymbolKind.Method);
    expect(fn.detail).toContain("[server]");
  });

  it("emits Variable symbols for reactive declarations with kind detail", () => {
    const src = "<program>\n${\n  @count = 0\n  const @doubled = @count * 2\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const count = symbols.find(s => s.name === "@count");
    const doubled = symbols.find(s => s.name === "@doubled");
    expect(count).toBeTruthy();
    expect(count.kind).toBe(SymbolKind.Variable);
    expect(count.detail).toBe("@reactive");
    expect(doubled).toBeTruthy();
    expect(doubled.kind).toBe(SymbolKind.Variable);
    expect(doubled.detail).toBe("@derived");
  });

  it("emits Enum symbols for type-decl with typeKind=enum", () => {
    const src = "<program>\n${\n  type Status:enum = { Active, Closed }\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const status = symbols.find(s => s.name === "Status");
    expect(status).toBeTruthy();
    expect(status.kind).toBe(SymbolKind.Enum);
    expect(status.detail).toBe("type :enum");
  });

  it("emits Struct symbols for type-decl with typeKind=struct", () => {
    const src = "<program>\n${\n  type User:struct = { name: string }\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const user = symbols.find(s => s.name === "User");
    expect(user).toBeTruthy();
    expect(user.kind).toBe(SymbolKind.Struct);
  });

  it("emits Class symbols for components (PascalCase const)", () => {
    const src = "<program>\n${\n  const Card = <article>hello</>\n  @x = 0\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const card = symbols.find(s => s.name === "Card");
    expect(card).toBeTruthy();
    expect(card.kind).toBe(SymbolKind.Class);
    expect(card.detail).toBe("component");
  });

  it("emits Class symbols for engine-decl with governedType detail", () => {
    // Note: the machine body is empty here; the AST builder records the
    // declaration regardless and PA reports a separate W-MACHINE-005 warning,
    // which is fine for this test — we only assert the symbol shape.
    const src = [
      "<program>",
      "${",
      "  type Tier:enum = { A, B }",
      "  @t: TierMachine = Tier.A",
      "}",
      "< engine name=TierMachine for=Tier>",
      "  Tier.A -> Tier.B : on bump",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { symbols } = symbolize(src);
    const machine = symbols.find(s => s.name === "TierMachine");
    expect(machine).toBeTruthy();
    expect(machine.kind).toBe(SymbolKind.Class);
    expect(machine.detail).toBe("machine for Tier");
  });

  it("nests state-block children under the state symbol", () => {
    const src = [
      "<program>",
      "< db src=\"x.db\" tables=\"t\">",
      "  ${",
      "    @x = 1",
      "    function f() { return 1 }",
      "  }",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { symbols } = symbolize(src);
    const db = symbols.find(s => s.name === "<db>");
    expect(db).toBeTruthy();
    expect(db.kind).toBe(SymbolKind.Module);
    const childNames = db.children.map(c => c.name);
    expect(childNames).toContain("@x");
    expect(childNames).toContain("f");
  });

  it("each symbol carries a range and selectionRange contained within range", () => {
    const src = "<program>\n${\n  function alpha() { return 1 }\n}\n</program>\n";
    const { symbols } = symbolize(src);
    const fn = symbols.find(s => s.name === "alpha");
    expect(fn).toBeTruthy();
    expect(fn.range).toBeDefined();
    expect(fn.selectionRange).toBeDefined();
    expect(fn.range.start.line).toBeGreaterThanOrEqual(0);
    expect(fn.range.end.line).toBeGreaterThanOrEqual(fn.range.start.line);
    // selectionRange should fit inside range.
    expect(fn.selectionRange.start.line).toBeGreaterThanOrEqual(fn.range.start.line);
    expect(fn.selectionRange.end.line).toBeLessThanOrEqual(fn.range.end.line);
  });

  it("populates outline for examples/14-mario-state-machine.scrml fixture", async () => {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixture = path.resolve(here, "../../../examples/14-mario-state-machine.scrml");
    if (!fs.existsSync(fixture)) {
      // Fixture not present in this layout; skip rather than fail spuriously.
      return;
    }
    const text = fs.readFileSync(fixture, "utf8");
    const { symbols, diagnostics } = symbolize(text, fixture);
    // Filter out advisory warnings introduced by Insight 26 Batch 1
    // (W-DEAD-FUNCTION, W-DEPRECATED-SERVER-MODIFIER) — this test asserts
    // on structural diagnostics only. Also filter the v0.3 info-level
    // W-PROGRAM-SPA-INFERRED lint (SPEC §40.8.1) which fires for SPA-
    // shaped examples like the Mario fixture (no <page>, no pages/).
    // Also filter the S147 info-level W-MATCH-ARROW-LEGACY lint (SPEC §18.2):
    // the Mario fixture uses the (now-deprecated) `=>` match arm separator,
    // which is fully valid during the `:>`-canonical deprecation window — an
    // advisory nudge, not a structural diagnostic. (Same class as the lints
    // above; corpus arm-arrow migration is deferred, so the fixture keeps `=>`.)
    const errs = diagnostics.filter(d =>
      d.code !== "W-DEAD-FUNCTION" &&
      d.code !== "W-DEPRECATED-SERVER-MODIFIER" &&
      d.code !== "W-PROGRAM-SPA-INFERRED" &&
      d.code !== "W-MATCH-ARROW-LEGACY"
    );
    expect(errs.length).toBe(0);
    // Should at minimum surface the three enum types. Post-v0.2.0 rewrite
    // (B1, 2026-05-11), the engine declarations no longer carry name= —
    // they auto-derive their variable name from for= per §51.0.C. The
    // legacy "MarioMachine"/"HealthMachine" names are gone; assert only
    // the enum types which the LSP outline still surfaces structurally.
    const names = symbols.map(s => s.name);
    expect(names).toContain("PowerUp");
    expect(names).toContain("MarioState");
    expect(names).toContain("HealthRisk");
  });
});
