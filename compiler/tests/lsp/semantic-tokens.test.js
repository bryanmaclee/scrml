// LSP — semantic tokens (context-exact syntax highlighting) tests.
//
// Verifies that `computeSemanticTokens` / `buildSemanticTokens` produce
// context-exact tokens from the compiler's own parse (block-splitter context
// oracle + native lexer), and that the handler NEVER throws on broken buffers
// (editors send syntactically-invalid buffers on every keystroke).
//
// Reference: docs/changes/lsp-semantic-tokens-2026-07-08/BRIEF.md
//            docs/changes/lsp-semantic-tokens-2026-07-08/progress.md (Phase 0)

import { describe, it, expect } from "bun:test";
import {
  computeSemanticTokens,
  buildSemanticTokens,
  SEMANTIC_TOKENS_LEGEND,
} from "../../../lsp/handlers.js";

// Standard SemanticTokenTypes names the LSP client understands. Our legend
// must be a subset (cross-editor safety).
const STANDARD_TOKEN_TYPES = new Set([
  "namespace", "type", "class", "enum", "interface", "struct", "typeParameter",
  "parameter", "variable", "property", "enumMember", "event", "function",
  "method", "macro", "keyword", "modifier", "comment", "string", "number",
  "regexp", "operator", "decorator",
]);

// Annotate each computed token with the exact source substring it covers, so
// assertions read as (type, text) pairs.
function annotate(src) {
  const lines = src.split("\n");
  return computeSemanticTokens(src, null).map((t) => ({
    ...t,
    text: (lines[t.line] ?? "").slice(t.char, t.char + t.length),
  }));
}

function has(toks, type, text) {
  return toks.some((t) => t.type === type && t.text === text);
}

function find(toks, type, text) {
  return toks.find((t) => t.type === type && t.text === text);
}

// Reverse the LSP delta encoding back into absolute { line, char, length, type }.
function decode(data, legend) {
  const out = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dLine = data[i];
    const dChar = data[i + 1];
    const len = data[i + 2];
    const typeIdx = data[i + 3];
    if (dLine === 0) {
      char += dChar;
    } else {
      line += dLine;
      char = dChar;
    }
    out.push({ line, char, length: len, type: legend.tokenTypes[typeIdx] });
  }
  return out;
}

describe("LSP — semantic tokens legend", () => {
  it("uses standard, cross-editor-safe SemanticTokenTypes names", () => {
    expect(Array.isArray(SEMANTIC_TOKENS_LEGEND.tokenTypes)).toBe(true);
    expect(SEMANTIC_TOKENS_LEGEND.tokenTypes.length).toBe(9);
    for (const t of SEMANTIC_TOKENS_LEGEND.tokenTypes) {
      expect(STANDARD_TOKEN_TYPES.has(t)).toBe(true);
    }
    expect(SEMANTIC_TOKENS_LEGEND.tokenModifiers).toEqual([]);
  });
});

describe("LSP — computeSemanticTokens (per-construct roles)", () => {
  it("colors keywords, a reactive var and a number inside ${ }", () => {
    const src = "<program>\n${ if (@count) return 5 }\n</program>";
    const toks = annotate(src);
    expect(has(toks, "keyword", "if")).toBe(true);
    expect(has(toks, "keyword", "return")).toBe(true);
    expect(has(toks, "variable", "@count")).toBe(true);
    expect(has(toks, "number", "5")).toBe(true);
  });

  it("colors a markup tag name as type and an attribute name as property", () => {
    const toks = annotate('<div class="hero">hi</div>');
    // Both the opener and the closer tag name are `type`.
    expect(toks.filter((t) => t.type === "type" && t.text === "div").length).toBe(2);
    expect(has(toks, "property", "class")).toBe(true);
    expect(has(toks, "string", '"hero"')).toBe(true);
    // Markup prose ("hi") stays uncolored — not a variable/keyword.
    expect(has(toks, "variable", "hi")).toBe(false);
  });

  it("colors a component (capitalized) tag name as type", () => {
    const toks = annotate("<Counter>\n  @count = 0\n</Counter>");
    expect(has(toks, "type", "Counter")).toBe(true);
    expect(has(toks, "variable", "@count")).toBe(true);
  });

  it("colors a #{ } CSS property (including hyphenated) as property", () => {
    const src = "<Box>\n  #{ color: red; font-size: 12px; }\n</Box>";
    const toks = annotate(src);
    expect(has(toks, "property", "color")).toBe(true);
    expect(has(toks, "property", "font-size")).toBe(true);
    expect(has(toks, "number", "12")).toBe(true);
    // A CSS value ("red") is not a property.
    expect(has(toks, "property", "red")).toBe(false);
  });

  it("colors ?{ } SQL keywords as keyword", () => {
    const src = "${ let rows = ?{ SELECT id, name FROM users WHERE id = 1 } }";
    const toks = annotate(src);
    expect(has(toks, "keyword", "SELECT")).toBe(true);
    expect(has(toks, "keyword", "FROM")).toBe(true);
    expect(has(toks, "keyword", "WHERE")).toBe(true);
    // The surrounding JS keyword is still a keyword.
    expect(has(toks, "keyword", "let")).toBe(true);
    // A column/table identifier inside SQL is not colored as a keyword.
    expect(has(toks, "keyword", "users")).toBe(false);
  });

  it("colors a string literal as string", () => {
    const toks = annotate('${ let a = "hello" }');
    expect(has(toks, "string", '"hello"')).toBe(true);
  });

  it("colors a number literal as number", () => {
    const toks = annotate("${ let a = 42 }");
    expect(has(toks, "number", "42")).toBe(true);
  });

  it("colors a template literal chunk as string", () => {
    const toks = annotate("${ let s = `hi ${x} bye` }");
    expect(toks.some((t) => t.type === "string" && t.text.includes("hi"))).toBe(true);
    // The interpolated identifier is still a variable.
    expect(has(toks, "variable", "x")).toBe(true);
  });

  it("colors a regex literal as regexp", () => {
    const toks = annotate("${ let re = /ab+c/gi }");
    expect(has(toks, "regexp", "/ab+c/gi")).toBe(true);
  });

  it("colors a top-level // comment as comment", () => {
    const toks = annotate("// a top comment\n<div>hi</div>");
    expect(has(toks, "comment", "// a top comment")).toBe(true);
  });

  it("colors an inline // comment inside logic as comment", () => {
    const toks = annotate("${ let a = 1 // trailing note\n}");
    expect(has(toks, "comment", "// trailing note")).toBe(true);
  });

  it("colors a /* */ block comment as comment", () => {
    const toks = annotate("${ let a = /* mid */ 2 }");
    expect(has(toks, "comment", "/* mid */")).toBe(true);
  });

  it("colors a markup <!-- --> comment as comment", () => {
    const toks = annotate("<div><!-- note --></div>");
    expect(has(toks, "comment", "<!-- note -->")).toBe(true);
  });

  it("emits exact (line, char, length, type) for a known number token", () => {
    // "${ let a = 42 }" — "42" begins at char 11 on line 0.
    const num = find(annotate("${ let a = 42 }"), "number", "42");
    expect(num).toBeTruthy();
    expect(num.line).toBe(0);
    expect(num.char).toBe(11);
    expect(num.length).toBe(2);
    expect(num.type).toBe("number");
  });

  it("returns tokens sorted by (line, char) with no overlaps", () => {
    const src = "// hdr\n<div class=\"a\">\n  ${ let n = 7 }\n  #{ color: red; }\n</div>";
    const toks = computeSemanticTokens(src, null);
    for (let i = 1; i < toks.length; i++) {
      const prev = toks[i - 1];
      const cur = toks[i];
      const afterOrEqual =
        cur.line > prev.line || (cur.line === prev.line && cur.char >= prev.char);
      expect(afterOrEqual).toBe(true);
      if (cur.line === prev.line) {
        // no overlap on the same line
        expect(cur.char).toBeGreaterThanOrEqual(prev.char + prev.length);
      }
    }
  });
});

describe("LSP — comment scanning is context-gated (never swallows markup/CSS)", () => {
  // A `//` is a JS line comment only in logic context. In markup prose it's
  // ordinary text (a URL `http://…`) and in CSS it's part of `url(http://…)`;
  // the gap scanner must not fire there and swallow the rest of the line.
  it("does not treat a URL in markup prose as a // line comment", () => {
    const toks = annotate("<p>Visit http://example.com now</p>");
    // The `//` in `http://` must NOT open a comment that swallows the `</p>`
    // close tag. No `comment` token should be produced at all.
    expect(toks.some((t) => t.type === "comment")).toBe(false);
    expect(toks.some((t) => t.type === "comment" && t.text.includes("example.com"))).toBe(false);
    expect(toks.some((t) => t.type === "comment" && t.text.includes("</p>"))).toBe(false);
  });

  it("does not treat url(http://…) in a CSS block as a // line comment", () => {
    const src = "<Box>\n  #{ background: url(http://a.png); color: red }\n</Box>";
    const toks = annotate(src);
    // The `//` in the URL must NOT open a comment that swallows `color: red }`.
    // (Fully re-coloring `color: red` after the URL would require the
    // block-splitter to stop mis-reading `//` inside CSS — out of scope here;
    // the guarantee this test locks is that no false `comment` token appears.)
    expect(toks.some((t) => t.type === "comment")).toBe(false);
    expect(toks.some((t) => t.type === "comment" && t.text.includes("a.png"))).toBe(false);
    expect(toks.some((t) => t.type === "comment" && t.text.includes("color"))).toBe(false);
  });

  it("still emits a genuine // comment inside a ${ } logic block", () => {
    const toks = annotate("<program>\n${ // real comment\n@x = 5 }\n</program>");
    expect(has(toks, "comment", "// real comment")).toBe(true);
  });

  it("excludes the trailing \\r from a CRLF // line comment", () => {
    const toks = annotate("${ let a = 1 // note\r\n}");
    const c = find(toks, "comment", "// note");
    expect(c).toBeTruthy();          // the `\r` is trimmed, so the text is exact
    expect(c.length).toBe(7);        // "// note" — length excludes the trailing \r
    // No comment token may carry a carriage return.
    expect(toks.some((t) => t.type === "comment" && t.text.includes("\r"))).toBe(false);
  });
});

describe("LSP — buildSemanticTokens (LSP encoding)", () => {
  it("returns an encoded { data } whose length is a multiple of 5", () => {
    const built = buildSemanticTokens("${ let a = 42 }", null);
    expect(Array.isArray(built.data)).toBe(true);
    expect(built.data.length % 5).toBe(0);
    expect(built.data.length).toBeGreaterThan(0);
  });

  it("delta-encoding round-trips back to the computed token list", () => {
    const src = "<div class=\"x\">\n  ${ return 1 }\n</div>";
    const computed = computeSemanticTokens(src, null);
    const built = buildSemanticTokens(src, null);
    const decoded = decode(built.data, SEMANTIC_TOKENS_LEGEND);
    expect(decoded.length).toBe(computed.length);
    for (let i = 0; i < computed.length; i++) {
      expect(decoded[i].line).toBe(computed[i].line);
      expect(decoded[i].char).toBe(computed[i].char);
      expect(decoded[i].length).toBe(computed[i].length);
      expect(decoded[i].type).toBe(computed[i].type);
    }
  });

  it("returns an empty { data: [] } for empty input", () => {
    expect(buildSemanticTokens("", null).data).toEqual([]);
    expect(computeSemanticTokens("", null)).toEqual([]);
  });
});

describe("LSP — semantic tokens NEVER throw (broken buffers)", () => {
  const brokenBuffers = [
    '<div class="',            // half-typed tag + unterminated string
    "${ let a = ",             // unterminated logic escape
    "?{ SELECT * FROM",        // unterminated SQL block
    "@@@ ### ??? !!!",         // stray sigils
    "`unterminated ${x",       // unterminated template + interp
    "<Counter attr=${ @n",     // unterminated attribute escape
    "#{ color: ",              // unterminated CSS
    "<!-- unclosed comment",   // unterminated markup comment
    "/* unclosed block",       // unterminated block comment
    "type X:enum = { A, B",    // unterminated type decl
  ];

  for (const buf of brokenBuffers) {
    it(`does not throw on: ${JSON.stringify(buf)}`, () => {
      expect(() => buildSemanticTokens(buf, null)).not.toThrow();
      expect(() => computeSemanticTokens(buf, null)).not.toThrow();
      const built = buildSemanticTokens(buf, null);
      expect(Array.isArray(built.data)).toBe(true);
      const computed = computeSemanticTokens(buf, null);
      expect(Array.isArray(computed)).toBe(true);
    });
  }

  it("still produces partial tokens for a half-typed tag (graceful degradation)", () => {
    // Mid-keystroke, a half-typed tag makes the block-splitter report an
    // unclosed context (no blocks), so the buffer degrades to logic-mode
    // coloring rather than throwing or going blank. The guarantee is:
    // non-empty, still-useful tokens (the `class` keyword + the partial
    // string literal are still surfaced). Full markup roles (tag -> type,
    // attr -> property) require a block-splitter-parseable buffer — see the
    // complete-buffer markup test above. Mid-edit markup-role recovery is a
    // noted follow-on (would need block-splitter partial recovery).
    const toks = annotate('<div class="');
    expect(toks.length).toBeGreaterThan(0);
    expect(toks.some((t) => t.type === "string")).toBe(true);
  });

  it("handles non-string / nullish input without throwing", () => {
    expect(() => buildSemanticTokens(null, null)).not.toThrow();
    expect(() => buildSemanticTokens(undefined, null)).not.toThrow();
    expect(computeSemanticTokens(null, null)).toEqual([]);
    expect(computeSemanticTokens(undefined, null)).toEqual([]);
  });
});
