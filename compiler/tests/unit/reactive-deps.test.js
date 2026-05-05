/**
 * reactive-deps.ts — Unit Tests
 *
 * Tests for string-aware @var extraction and reactive variable name collection.
 *
 * Coverage:
 *   §1  extractReactiveDeps — basic @var extraction
 *   §2  extractReactiveDeps — string literal awareness (single, double, template)
 *   §3  extractReactiveDeps — escaped characters inside strings
 *   §4  extractReactiveDeps — knownReactiveVars filtering
 *   §5  extractReactiveDeps — edge cases (empty, null, no @vars)
 *   §6  collectReactiveVarNames — reactive-decl collection from AST
 */

import { describe, test, expect } from "bun:test";
import { extractReactiveDeps, collectReactiveVarNames } from "../../src/codegen/reactive-deps.ts";

// ---------------------------------------------------------------------------
// §1  Basic @var extraction
// ---------------------------------------------------------------------------

describe("extractReactiveDeps — basic extraction", () => {
  test("extracts a single @var", () => {
    const result = extractReactiveDeps("@count + 1");
    expect(result).toEqual(new Set(["count"]));
  });

  test("extracts multiple @vars", () => {
    const result = extractReactiveDeps("@x + @y * @z");
    expect(result).toEqual(new Set(["x", "y", "z"]));
  });

  test("deduplicates repeated @vars", () => {
    const result = extractReactiveDeps("@count + @count");
    expect(result).toEqual(new Set(["count"]));
    expect(result.size).toBe(1);
  });

  test("handles @var with underscores and dollars", () => {
    const result = extractReactiveDeps("@_private + @$special + @name_2");
    expect(result).toEqual(new Set(["_private", "$special", "name_2"]));
  });

  test("does not extract @ followed by non-identifier chars", () => {
    const result = extractReactiveDeps("@ + @123 + @@");
    expect(result).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// §2  String literal awareness
// ---------------------------------------------------------------------------

describe("extractReactiveDeps — string literal awareness", () => {
  test("ignores @var inside double-quoted strings", () => {
    const result = extractReactiveDeps('"use @theme here" + @count');
    expect(result).toEqual(new Set(["count"]));
  });

  test("ignores @var inside single-quoted strings", () => {
    const result = extractReactiveDeps("'email: @user' + @total");
    expect(result).toEqual(new Set(["total"]));
  });

  test("ignores @var inside template literals", () => {
    const result = extractReactiveDeps("`template @ignored` + @visible");
    expect(result).toEqual(new Set(["visible"]));
  });

  test("extracts @var before and after string literals", () => {
    const result = extractReactiveDeps('@before + "string @inside" + @after');
    expect(result).toEqual(new Set(["before", "after"]));
  });

  test("handles multiple string types in one expression", () => {
    const result = extractReactiveDeps(`@a + "b @c" + 'd @e' + \`f @g\` + @h`);
    expect(result).toEqual(new Set(["a", "h"]));
  });
});

// ---------------------------------------------------------------------------
// §3  Escaped characters inside strings
// ---------------------------------------------------------------------------

describe("extractReactiveDeps — escaped characters", () => {
  test("handles escaped quotes inside double-quoted strings", () => {
    const result = extractReactiveDeps('"escaped \\" @notvar" + @real');
    expect(result).toEqual(new Set(["real"]));
  });

  test("handles escaped quotes inside single-quoted strings", () => {
    const result = extractReactiveDeps("'it\\'s @notvar' + @real");
    expect(result).toEqual(new Set(["real"]));
  });

  test("handles escaped backslash before closing quote", () => {
    const result = extractReactiveDeps('"path\\\\" + @after');
    expect(result).toEqual(new Set(["after"]));
  });
});

// ---------------------------------------------------------------------------
// §4  knownReactiveVars filtering
// ---------------------------------------------------------------------------

describe("extractReactiveDeps — knownReactiveVars filtering", () => {
  test("filters to only known vars when set is provided", () => {
    const known = new Set(["count", "total"]);
    const result = extractReactiveDeps("@count + @unknown + @total", known);
    expect(result).toEqual(new Set(["count", "total"]));
  });

  test("returns empty set when no vars match the known set", () => {
    const known = new Set(["x"]);
    const result = extractReactiveDeps("@a + @b", known);
    expect(result).toEqual(new Set());
  });

  test("returns all vars when knownReactiveVars is null", () => {
    const result = extractReactiveDeps("@a + @b", null);
    expect(result).toEqual(new Set(["a", "b"]));
  });
});

// ---------------------------------------------------------------------------
// §5  Edge cases
// ---------------------------------------------------------------------------

describe("extractReactiveDeps — edge cases", () => {
  test("returns empty set for empty string", () => {
    expect(extractReactiveDeps("")).toEqual(new Set());
  });

  test("returns empty set for null", () => {
    expect(extractReactiveDeps(null)).toEqual(new Set());
  });

  test("returns empty set for undefined", () => {
    expect(extractReactiveDeps(undefined)).toEqual(new Set());
  });

  test("returns empty set for non-string", () => {
    expect(extractReactiveDeps(42)).toEqual(new Set());
  });

  test("returns empty set for expression with no @vars", () => {
    expect(extractReactiveDeps("x + y * z")).toEqual(new Set());
  });

  test("handles unterminated string gracefully", () => {
    // Unterminated quote — @var inside should be treated as in-string
    const result = extractReactiveDeps('"unterminated @inside');
    expect(result).toEqual(new Set());
  });

  test("handles @var at end of string", () => {
    const result = extractReactiveDeps("something + @last");
    expect(result).toEqual(new Set(["last"]));
  });

  test("handles @var at start of string", () => {
    const result = extractReactiveDeps("@first + something");
    expect(result).toEqual(new Set(["first"]));
  });
});

// ---------------------------------------------------------------------------
// §6  collectReactiveVarNames
// ---------------------------------------------------------------------------

describe("collectReactiveVarNames", () => {
  test("collects reactive-decl names from top-level logic", () => {
    const fileAST = {
      nodes: [
        {
          kind: "logic",
          body: [
            { kind: "state-decl", name: "count" },
            { kind: "state-decl", name: "total" },
            { kind: "let-decl", name: "x" },
          ],
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result).toEqual(new Set(["count", "total"]));
  });

  test("collects from nested logic blocks", () => {
    const fileAST = {
      nodes: [
        {
          kind: "logic",
          body: [
            {
              kind: "logic",
              body: [{ kind: "state-decl", name: "nested" }],
            },
          ],
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result).toEqual(new Set(["nested"]));
  });

  test("returns empty set for AST with no reactive decls", () => {
    const fileAST = {
      nodes: [
        { kind: "markup", tag: "div", children: [] },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result).toEqual(new Set());
  });

  test("handles fileAST.ast.nodes fallback", () => {
    const fileAST = {
      ast: {
        nodes: [
          {
            kind: "logic",
            body: [{ kind: "state-decl", name: "alt" }],
          },
        ],
      },
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result).toEqual(new Set(["alt"]));
  });

  test("handles empty fileAST", () => {
    const result = collectReactiveVarNames({});
    expect(result).toEqual(new Set());
  });
});
