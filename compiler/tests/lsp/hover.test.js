// LSP L1 — hover signature improvements tests.
//
// Verifies buildHover surfaces meaningful information for: function
// declarations (signature + boundary), reactive vars (kind + type), tilde
// vars, lin vars, machines, components, types, error codes, keywords.

import { describe, it, expect } from "bun:test";
import { analyzeText, buildHover } from "../../../lsp/handlers.js";

/**
 * Position the cursor at the first occurrence of `marker` plus an inset
 * (default 1 — i.e. one char into the marker, which is usually inside the
 * identifier word so getWordAtOffset can find it).
 */
function hoverAt(source, marker, inset = 1) {
  const filePath = "test.scrml";
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error(`marker not found in source: ${marker}`);
  const { analysis } = analyzeText(filePath, source);
  return buildHover(source, offset + inset, analysis);
}

describe("LSP L1 — buildHover", () => {
  it("returns null when there is no word at offset", () => {
    const src = "<program>\n</program>";
    expect(buildHover(src, 0, null)).toBeNull();
  });

  it("describes function with full signature + boundary tag", () => {
    const src = [
      "<program>",
      "${",
      "  server function loadAll(limit) { return limit }",
      "}",
      "</program>",
      "",
    ].join("\n");
    const hover = hoverAt(src, "loadAll");
    expect(hover).toBeTruthy();
    const value = hover.contents.value;
    expect(value).toContain("**loadAll**");
    expect(value).toContain("function loadAll(limit)");
    expect(value).toContain("[server]");
  });

  it("describes a client function with [client] boundary", () => {
    const src = "<program>\n${\n  function clk() { return 1 }\n}\n</program>\n";
    const hover = hoverAt(src, "clk");
    expect(hover.contents.value).toContain("[client]");
    expect(hover.contents.value).toContain("clk()");
  });

  it("describes @reactive with the (reactive) badge", () => {
    const src = "<program>\n${\n  @count = 0\n}\n</program>\n";
    // Position cursor inside the identifier (inset 2 lands on `c`).
    const hover = hoverAt(src, "@count", 2);
    expect(hover).toBeTruthy();
    expect(hover.contents.value).toContain("**@count**");
    expect(hover.contents.value).toContain("(reactive)");
  });

  it("describes a derived reactive with (reactive, derived) badge", () => {
    const src = "<program>\n${\n  @x = 1\n  const @doubled = @x * 2\n}\n</program>\n";
    const hover = hoverAt(src, "@doubled", 2);
    expect(hover).toBeTruthy();
    expect(hover.contents.value).toContain("(reactive, derived)");
  });

  it("describes a machine declaration with governedType detail", () => {
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
    const hover = hoverAt(src, "TierMachine", 1);
    expect(hover).toBeTruthy();
    expect(hover.contents.value).toContain("**TierMachine**");
    expect(hover.contents.value).toContain("machine for `Tier`");
  });

  it("describes a type-decl with the typeKind suffix", () => {
    const src = "<program>\n${\n  type Status:enum = { Open, Closed }\n}\n</program>\n";
    const hover = hoverAt(src, "Status");
    expect(hover.contents.value).toContain("**Status**");
    expect(hover.contents.value).toContain("enum");
  });

  it("describes a component as kind=component", () => {
    const src = "<program>\n${\n  const Card = <article>hi</>\n  @x = 0\n}\n</program>\n";
    const hover = hoverAt(src, "Card");
    expect(hover.contents.value).toContain("**Card**");
    expect(hover.contents.value).toContain("component");
  });

  it("describes scrml keywords (pure)", () => {
    const src = "<program>\n${\n  pure function p() { return 1 }\n}\n</program>\n";
    const hover = hoverAt(src, "pure");
    expect(hover).toBeTruthy();
    expect(hover.contents.value).toContain("pure");
    expect(hover.contents.value).toContain("side effects");
  });

  it("describes error codes with the registered description", () => {
    const word = "E-RI-002";
    const text = `// ${word}`;
    const hover = buildHover(text, text.indexOf(word), {
      reactiveVars: [], functions: [], types: [], machines: [],
      components: [], tildeVars: [], linVars: [],
    });
    expect(hover.contents.value).toContain("E-RI-002");
    expect(hover.contents.value).toContain("Server-escalated");
  });
});
