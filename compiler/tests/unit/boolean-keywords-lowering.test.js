/**
 * Word-form boolean operator lowering — Unit Tests (R24-BUG-1, S136)
 *
 * scrml admits `or` / `and` as word-form boolean operators in expression
 * position (alongside JS-form `||` / `&&`). The compiler MUST lower these to
 * `||` / `&&` at JS-host emission.
 *
 * Bug R24-BUG-1: Before this fix, `or` / `and` tokens leaked verbatim into
 * emitted JS for any expression that contained `is`, `match`, `?{`, or `::`
 * (which force the AST-rewriteReactiveRefsAST path to bail and the
 * string-rewrite fallback to take over). The string-rewrite pipeline had no
 * pass that lowered `or` / `and`, so the emitted client.js failed
 * `node --check` with `SyntaxError: Unexpected identifier 'or'`. Surfaced
 * in gauntlet R24 by 2 of 4 devs (dev-1-react + dev-4-pascal).
 *
 * Two-site fix:
 *   - expression-parser.ts:preprocessForAcorn  → lowers BEFORE acorn parses
 *   - codegen/rewrite.ts:rewriteBooleanKeywords → lowers in fallback pipeline
 *
 * Tests below exercise BOTH sites:
 *   §1  rewriteBooleanKeywords direct: `or` / `and` lowering
 *   §2  rewriteBooleanKeywords direct: identifier-substring safety
 *   §3  rewriteBooleanKeywords direct: code-segment fence (strings/comments/regex)
 *   §4  rewriteExpr full client pipeline: end-to-end behavior
 *   §5  preprocessForAcorn → AST path: `BinaryExpr { op: "||" }` produced
 *   §6  Mixed-precedence: `or` (lower) + `and` (higher) binds correctly
 *   §7  Regression — `==` / `is` / `not` lowering still works alongside
 *   §8  Gauntlet R24 reproducer — full compile from source to client.js
 */

import { describe, test, expect } from "bun:test";
import {
  rewriteBooleanKeywords,
  rewriteExpr,
  rewriteServerExpr,
} from "../../src/codegen/rewrite.ts";
import { parseExprToNode } from "../../src/expression-parser.ts";
import { emitExprField } from "../../src/codegen/emit-expr.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// §1: rewriteBooleanKeywords direct — canonical lowering
// ---------------------------------------------------------------------------

describe("§1 — rewriteBooleanKeywords canonical lowering", () => {
  test("§1.1 bare `a or b` → `a || b`", () => {
    expect(rewriteBooleanKeywords("a or b")).toBe("a || b");
  });

  test("§1.2 bare `a and b` → `a && b`", () => {
    expect(rewriteBooleanKeywords("a and b")).toBe("a && b");
  });

  test("§1.3 mixed `a or b and c` (and binds tighter — JS native) → `a || b && c`", () => {
    expect(rewriteBooleanKeywords("a or b and c")).toBe("a || b && c");
  });

  test("§1.4 paren-wrapped `(a or b) and c` preserves grouping", () => {
    expect(rewriteBooleanKeywords("(a or b) and c")).toBe("(a or b) && c".replace("or", "||"));
  });

  test("§1.5 chained `a or b or c` lowers all sites", () => {
    expect(rewriteBooleanKeywords("a or b or c")).toBe("a || b || c");
  });

  test("§1.6 multi-line `a\\n    and b` (newline before `and`) lowers correctly", () => {
    expect(rewriteBooleanKeywords("a\n    and b")).toBe("a\n    && b");
  });

  test("§1.7 fast-path: no `or` or `and` substring → identity", () => {
    expect(rewriteBooleanKeywords("a + b")).toBe("a + b");
    expect(rewriteBooleanKeywords("foo(x, y)")).toBe("foo(x, y)");
  });
});

// ---------------------------------------------------------------------------
// §2: rewriteBooleanKeywords direct — identifier-substring safety
// ---------------------------------------------------------------------------

describe("§2 — identifier-substring safety (lookbehind/lookahead)", () => {
  test("§2.1 `orange` unchanged (or-prefix in ident)", () => {
    expect(rewriteBooleanKeywords("orange")).toBe("orange");
  });

  test("§2.2 `xor` unchanged (or-suffix in ident)", () => {
    expect(rewriteBooleanKeywords("xor")).toBe("xor");
  });

  test("§2.3 `vendor` / `border` / `Author` / `operator` unchanged", () => {
    expect(rewriteBooleanKeywords("vendor")).toBe("vendor");
    expect(rewriteBooleanKeywords("border")).toBe("border");
    expect(rewriteBooleanKeywords("Author")).toBe("Author");
    expect(rewriteBooleanKeywords("operator")).toBe("operator");
  });

  test("§2.4 `andrew` / `brand` / `demand` unchanged (and-substring)", () => {
    expect(rewriteBooleanKeywords("andrew")).toBe("andrew");
    expect(rewriteBooleanKeywords("brand")).toBe("brand");
    expect(rewriteBooleanKeywords("demand")).toBe("demand");
  });

  test("§2.5 `random` / `understand` unchanged", () => {
    expect(rewriteBooleanKeywords("random")).toBe("random");
    expect(rewriteBooleanKeywords("understand")).toBe("understand");
  });

  test("§2.6 member-access `obj.or` / `this.and` unchanged (dot excluded)", () => {
    expect(rewriteBooleanKeywords("obj.or")).toBe("obj.or");
    expect(rewriteBooleanKeywords("this.and")).toBe("this.and");
  });

  test("§2.7 sigil-prefixed `@or` / `@and` unchanged (@ excluded)", () => {
    expect(rewriteBooleanKeywords("@or")).toBe("@or");
    expect(rewriteBooleanKeywords("@and")).toBe("@and");
  });

  test("§2.8 mixed-case `Or` / `OR` / `And` / `AND` unchanged (case-sensitive lowering only)", () => {
    expect(rewriteBooleanKeywords("Or")).toBe("Or");
    expect(rewriteBooleanKeywords("OR")).toBe("OR");
    expect(rewriteBooleanKeywords("And")).toBe("And");
    expect(rewriteBooleanKeywords("AND")).toBe("AND");
  });
});

// ---------------------------------------------------------------------------
// §3: rewriteBooleanKeywords direct — code-segment fence
// ---------------------------------------------------------------------------

describe("§3 — code-segment fence (strings/comments/regex)", () => {
  test("§3.1 string-literal interior preserved: `\"a or b\"`", () => {
    const result = rewriteBooleanKeywords('"a or b"');
    expect(result).toBe('"a or b"');
  });

  test("§3.2 string-literal interior preserved: single-quoted", () => {
    expect(rewriteBooleanKeywords("'x and y'")).toBe("'x and y'");
  });

  test("§3.3 template-literal interior preserved: backtick", () => {
    expect(rewriteBooleanKeywords("`a or b`")).toBe("`a or b`");
  });

  test("§3.4 line comment preserved: `// a or b`", () => {
    expect(rewriteBooleanKeywords("// a or b\n")).toBe("// a or b\n");
  });

  test("§3.5 block comment preserved: `/* a and b */`", () => {
    expect(rewriteBooleanKeywords("/* a and b */")).toBe("/* a and b */");
  });

  test("§3.6 regex literal preserved: `/orange or apple/i`", () => {
    // Note: requires expression-start context for `/` to be a regex literal.
    expect(rewriteBooleanKeywords("return /orange or apple/i")).toBe("return /orange or apple/i");
  });

  test("§3.7 code AROUND a string literal still lowers: `a or \"x or y\" or b`", () => {
    const result = rewriteBooleanKeywords('a or "x or y" or b');
    expect(result).toBe('a || "x or y" || b');
  });

  test("§3.8 code AROUND a comment still lowers", () => {
    const result = rewriteBooleanKeywords("a or /* skip */ b and c");
    expect(result).toContain("||");
    expect(result).toContain("&&");
    expect(result).toContain("/* skip */");
  });
});

// ---------------------------------------------------------------------------
// §4: rewriteExpr full client pipeline — end-to-end
// ---------------------------------------------------------------------------

describe("§4 — rewriteExpr full client pipeline", () => {
  test("§4.1 `@a or @b` lowers to reactive-get with `||`", () => {
    const result = rewriteExpr("@a or @b");
    expect(result).toContain('_scrml_reactive_get("a")');
    expect(result).toContain('_scrml_reactive_get("b")');
    expect(result).toContain("||");
    expect(result).not.toMatch(/[^|]or[^a-zA-Z_$|]/);
  });

  test("§4.2 `@a and @b` lowers to reactive-get with `&&`", () => {
    const result = rewriteExpr("@a and @b");
    expect(result).toContain('_scrml_reactive_get("a")');
    expect(result).toContain('_scrml_reactive_get("b")');
    expect(result).toContain("&&");
    expect(result).not.toMatch(/[^&]and[^a-zA-Z_$&]/);
  });

  test("§4.3 mixed `@a or @b and @c` — `and` binds tighter (JS native precedence)", () => {
    const result = rewriteExpr("@a or @b and @c");
    expect(result).toContain("||");
    expect(result).toContain("&&");
    // Sanity: structure is `<a> || <b> && <c>`, which JS evaluates as
    // `<a> || (<b> && <c>)` per native operator precedence.
  });

  test("§4.4 `is .Variant or @b == 1` — `is` rewrite + `or` lowering coexist", () => {
    const result = rewriteExpr("@x is .All or @y == 1");
    expect(result).toContain("||");
    expect(result).toContain('=== "All"');
    expect(result).not.toMatch(/[^|]or[^a-zA-Z_$|]/);
  });

  test("§4.5 `not @x and @y` — `not` lowering + `and` lowering coexist", () => {
    const result = rewriteExpr("not @x and @y");
    expect(result).toContain('!_scrml_reactive_get("x")');
    expect(result).toContain('_scrml_reactive_get("y")');
    expect(result).toContain("&&");
  });
});

// ---------------------------------------------------------------------------
// §5: preprocessForAcorn → AST path
// ---------------------------------------------------------------------------

describe("§5 — preprocessForAcorn → AST path (BinaryExpr op produced)", () => {
  test("§5.1 parseExprToNode on `a or b` produces BinaryExpr with op: '||'", () => {
    const node = parseExprToNode("a or b", "test.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("||");
  });

  test("§5.2 parseExprToNode on `a and b` produces BinaryExpr with op: '&&'", () => {
    const node = parseExprToNode("a and b", "test.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("&&");
  });

  test("§5.3 parseExprToNode on `a or b and c` produces nested op nodes with correct precedence", () => {
    // `a or b and c` should parse as `a || (b && c)` — `&&` binds tighter.
    const node = parseExprToNode("a or b and c", "test.scrml", 0);
    expect(node.kind).toBe("binary");
    expect(node.op).toBe("||");
    expect(node.right.kind).toBe("binary");
    expect(node.right.op).toBe("&&");
  });

  test("§5.4 emitExprField on `a or b` emits `a || b`", () => {
    const node = parseExprToNode("a or b", "test.scrml", 0);
    const out = emitExprField(node, "a or b", { mode: "client" });
    expect(out).toContain("||");
    expect(out).not.toMatch(/[^|]or[^a-zA-Z_$|]/);
  });

  test("§5.5 emitExprField on `@a and @b` emits reactive-get + `&&`", () => {
    const node = parseExprToNode("@a and @b", "test.scrml", 0);
    const out = emitExprField(node, "@a and @b", { mode: "client" });
    expect(out).toContain('_scrml_reactive_get("a")');
    expect(out).toContain('_scrml_reactive_get("b")');
    expect(out).toContain("&&");
  });
});

// ---------------------------------------------------------------------------
// §6: Mixed-precedence semantic verification
// ---------------------------------------------------------------------------

describe("§6 — mixed precedence semantics", () => {
  test("§6.1 `a or b and c` evaluates as `a || (b && c)` (JS native precedence)", () => {
    // Simulate the JS evaluation order via a manual check.
    // Constants: a=false, b=true, c=false → a || (b && c) === false || (true && false) === false
    // BUT (a || b) && c === (false || true) && false === false (same answer for this set)
    // Use: a=true, b=true, c=false → a || (b && c) === true || (true && false) === true
    // vs:  (a || b) && c === (true || true) && false === false. Different.
    const result = rewriteExpr("@a or @b and @c");
    const a = true, b = true, c = false;
    const _scrml_reactive_get = (n) => ({ a, b, c })[n];
    // eslint-disable-next-line no-eval
    const evaluated = eval(result);
    expect(evaluated).toBe(true);  // a || (b && c) === true || false === true
  });

  test("§6.2 `(a or b) and c` evaluates as `(a || b) && c`", () => {
    const result = rewriteExpr("(@a or @b) and @c");
    const a = true, b = true, c = false;
    const _scrml_reactive_get = (n) => ({ a, b, c })[n];
    // eslint-disable-next-line no-eval
    const evaluated = eval(result);
    expect(evaluated).toBe(false);  // (a || b) && c === true && false === false
  });
});

// ---------------------------------------------------------------------------
// §7: Negative-control regression — other operators still work
// ---------------------------------------------------------------------------

describe("§7 — negative control: other operators preserved", () => {
  test("§7.1 `@a == 1` still lowers `==` to `===`", () => {
    const result = rewriteExpr("@a == 1");
    expect(result).toContain("===");
  });

  test("§7.2 `not @x` still lowers `not` to `!`", () => {
    const result = rewriteExpr("not @x");
    expect(result).toContain("!_scrml_reactive_get");
  });

  test("§7.3 `@x is .A` still lowers `is .Variant` to `=== \"A\"`", () => {
    const result = rewriteExpr("@x is .A");
    expect(result).toContain('=== "A"');
  });

  test("§7.4 `@a + @b` arithmetic unchanged (no boolean substitution)", () => {
    const result = rewriteExpr("@a + @b");
    expect(result).toContain('_scrml_reactive_get("a")');
    expect(result).toContain('_scrml_reactive_get("b")');
    expect(result).toContain("+");
  });

  test("§7.5 already-lowered `||` / `&&` unchanged", () => {
    expect(rewriteBooleanKeywords("a || b")).toBe("a || b");
    expect(rewriteBooleanKeywords("a && b")).toBe("a && b");
  });
});

// ---------------------------------------------------------------------------
// §8: Gauntlet R24 reproducer — full compile path
// ---------------------------------------------------------------------------

describe("§8 — gauntlet R24 reproducer (full compile)", () => {
  test("§8.1 `.filter(t => (a is .X or t.s == a) and (b == \"\" or t.t == b))` — emit `||` + `&&`, never raw `or`/`and`", () => {
    const tmp = mkdtempSync(join(tmpdir(), "r24-bug-1-"));
    const src = `\${
    type Status:enum = { All, Active }
    type T:struct = { id: int, status: Status, title: string }
    <tickets>: T[] = []
    <statusFilter>: Status = .All
    <searchTerm> = ""

    const <visibleTickets> = @tickets.filter(t =>
        (@statusFilter is .All or t.status == @statusFilter)
        and (@searchTerm == "" or t.title.toLowerCase().includes(@searchTerm.toLowerCase()))
    )
}
<page>
    <p>\${@visibleTickets.length}</>
</>
`;
    const inFile = join(tmp, "r24-repro.scrml");
    writeFileSync(inFile, src);
    const outDir = join(tmp, "dist");
    const result = compileScrml({ inputFiles: [inFile], outputDir: outDir });
    expect(result.errors?.length || 0).toBe(0);

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "r24-repro.client.js"), "utf8")));

    // The emitted JS MUST NOT contain bare `or` / `and` tokens (operator position).
    // Pattern: whitespace + `or` + whitespace (operator context, never identifier).
    expect(clientJs).not.toMatch(/\s+or\s+/);
    expect(clientJs).not.toMatch(/\s+and\s+/);

    // The emitted JS MUST contain `||` and `&&` lowering targets.
    expect(clientJs).toContain("||");
    expect(clientJs).toContain("&&");

    // Sanity: visibleTickets derived cell is emitted at all.
    expect(clientJs).toContain('_scrml_derived_declare("visibleTickets"');
  });

  test("§8.2 server-side rewrite pipeline also lowers `or`/`and`", () => {
    const result = rewriteServerExpr("@a or @b and @c");
    expect(result).toContain("||");
    expect(result).toContain("&&");
    expect(result).not.toMatch(/\s+or\s+/);
    expect(result).not.toMatch(/\s+and\s+/);
  });
});
