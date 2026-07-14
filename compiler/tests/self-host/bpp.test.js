/**
 * Self-Host BPP (Body Pre-Parser) — Parity Tests
 *
 * Validates the JS original (compiler/src/codegen/compat/parser-workarounds.js)
 * against representative inputs for all exported functions. When the scrml build
 * pipeline produces compiled output, these tests should also import the compiled
 * scrml version and assert identical results.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Resolve paths (works in both main repo and worktrees)
// ---------------------------------------------------------------------------

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

function findProjectRoot() {
  // In a worktree, --show-toplevel returns the worktree root which has the files
  // Unset GIT_DIR so -C works correctly when invoked from pre-commit hooks
  const gitEnv = { ...process.env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  return execSync(
    "git -C " + testDir + " rev-parse --show-toplevel",
    { encoding: "utf-8", env: gitEnv },
  ).trim();
}

function findMainProjectRoot() {
  // Prefer the local worktree if it has parser-workarounds.js (so that a
  // cross-cut rename / refactor under development tests its own SUT, not the
  // out-of-date main worktree's SUT). Fall back to main worktree if local is
  // missing the file (some worktrees only modify .scrml without the JS).
  const localRoot = findProjectRoot();
  if (existsSync(resolve(localRoot, "compiler/src/codegen/compat/parser-workarounds.js"))) {
    return localRoot;
  }
  const gitEnv = { ...process.env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_WORK_TREE;
  try {
    const wtList = execSync("git -C " + testDir + " worktree list --porcelain", { encoding: "utf-8", env: gitEnv });
    const firstLine = wtList.split("\n").find(l => l.startsWith("worktree "));
    if (firstLine) {
      const mainRoot = firstLine.replace("worktree ", "");
      if (existsSync(resolve(mainRoot, "compiler/src/codegen/compat/parser-workarounds.js"))) {
        return mainRoot;
      }
    }
  } catch { /* fall through */ }
  return localRoot;
}

const projectRoot = findMainProjectRoot();
const localRoot = findProjectRoot();
const jsPath = resolve(projectRoot, "compiler/src/codegen/compat/parser-workarounds.js");
// scrml file is in the local worktree (may differ from main repo)
const scrmlPath = resolve(localRoot, "compiler/self-host/bpp.scrml");

// ---------------------------------------------------------------------------
// Import JS original
// ---------------------------------------------------------------------------

const {
  isLeakedComment,
  stripLeakedComments,
  splitBareExprStatements,
  splitMergedStatements,
} = await import(jsPath);

// ---------------------------------------------------------------------------
// isLeakedComment
// ---------------------------------------------------------------------------

describe("isLeakedComment", () => {
  test("returns false for falsy/non-string input", () => {
    expect(isLeakedComment(null)).toBe(false);
    expect(isLeakedComment(undefined)).toBe(false);
    expect(isLeakedComment("")).toBe(false);
    expect(isLeakedComment(42)).toBe(false);
  });

  test("detects em-dash as leaked comment", () => {
    expect(isLeakedComment("This is a comment — with em-dash")).toBe(true);
  });

  test("detects en-dash as leaked comment", () => {
    expect(isLeakedComment("Some text – with en-dash")).toBe(true);
  });

  test("detects natural language sentence starting with capital", () => {
    expect(isLeakedComment("This is a natural language sentence")).toBe(true);
  });

  test("rejects code-like text with operators/parens", () => {
    expect(isLeakedComment("Foo(bar)")).toBe(false);
    expect(isLeakedComment("Ctx.value = 42")).toBe(false);
    expect(isLeakedComment("Array[0]")).toBe(false);
  });

  test("rejects lowercase-starting text", () => {
    expect(isLeakedComment("foo bar baz")).toBe(false);
  });

  test("rejects code expressions", () => {
    expect(isLeakedComment("ctx.items.map(x => x.id)")).toBe(false);
    expect(isLeakedComment("@count = 0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripLeakedComments
// ---------------------------------------------------------------------------

describe("stripLeakedComments", () => {
  test("returns falsy input as-is", () => {
    expect(stripLeakedComments(null)).toBe(null);
    expect(stripLeakedComments(undefined)).toBe(undefined);
    expect(stripLeakedComments("")).toBe("");
  });

  test("strips pure natural language lines", () => {
    const input = "ctx.update()\nThis is a comment line\nctx.render()";
    const result = stripLeakedComments(input);
    expect(result).toBe("ctx.update()\nctx.render()");
  });

  test("strips trailing comment after code ending with )", () => {
    const input = "saveTodos()  Save the todo items";
    const result = stripLeakedComments(input);
    expect(result).toBe("saveTodos()");
  });

  test("preserves pure code lines", () => {
    const input = "ctx.items.map(x => x.id)\nctx.count = 0";
    expect(stripLeakedComments(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// splitBareExprStatements
// ---------------------------------------------------------------------------

describe("splitBareExprStatements", () => {
  test("returns falsy input wrapped in array", () => {
    expect(splitBareExprStatements(null)).toEqual([null]);
    expect(splitBareExprStatements(undefined)).toEqual([undefined]);
    expect(splitBareExprStatements("")).toEqual([""]);
  });

  test("single expression stays as-is", () => {
    expect(splitBareExprStatements("ctx.update()")).toEqual(["ctx.update()"]);
  });

  test("splits two function calls separated by whitespace", () => {
    const result = splitBareExprStatements("saveTodos() renderList()");
    expect(result).toEqual(["saveTodos()", "renderList()"]);
  });

  test("does not split inside parentheses", () => {
    const result = splitBareExprStatements("foo(bar baz)");
    expect(result).toEqual(["foo(bar baz)"]);
  });

  test("does not split inside braces", () => {
    const result = splitBareExprStatements("{ foo bar }");
    expect(result).toEqual(["{ foo bar }"]);
  });

  test("does not split when next word is a JS operator (of, in)", () => {
    // When nextWord IS in JS_OPERATORS, the split is prevented at that boundary.
    // "for (x of arr)" — inside parens, no split. But at top level "arr of" would
    // not split before "of". Test with a call followed by "of": the "of" boundary is safe.
    const result = splitBareExprStatements("getItems() of");
    // "of" is in JS_OPERATORS so no split before it
    expect(result).toEqual(["getItems() of"]);
  });

  test("does not split after expression keywords (return, await)", () => {
    const result = splitBareExprStatements("return foo");
    expect(result).toEqual(["return foo"]);
  });

  test("does not split after incomplete expressions ending with =", () => {
    const result = splitBareExprStatements("x = foo");
    expect(result).toEqual(["x = foo"]);
  });

  test("handles string literals without splitting inside them", () => {
    const result = splitBareExprStatements('"hello world" callback()');
    expect(result.length).toBe(2);
    expect(result[0]).toBe('"hello world"');
    expect(result[1]).toBe("callback()");
  });

  test("splits match expression followed by function call", () => {
    const input = 'match powerUp { .Mushroom => MarioState.Big .Flower => MarioState.Fire } updateDisplay()';
    const result = splitBareExprStatements(input);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("match powerUp");
    expect(result[0]).toEndWith("}");
    expect(result[1]).toBe("updateDisplay()");
  });

  test("does not split } else in if/else", () => {
    const result = splitBareExprStatements("if (x) { a() } else { b() }");
    expect(result).toEqual(["if (x) { a() } else { b() }"]);
  });

  test("does not split } catch in try/catch", () => {
    const result = splitBareExprStatements("try { a() } catch { b() }");
    expect(result).toEqual(["try { a() } catch { b() }"]);
  });

  test("does not split } finally in try/finally", () => {
    const result = splitBareExprStatements("try { a() } finally { b() }");
    expect(result).toEqual(["try { a() } finally { b() }"]);
  });
});

// ---------------------------------------------------------------------------
// splitMergedStatements
// ---------------------------------------------------------------------------

describe("splitMergedStatements", () => {
  test("single let declaration", () => {
    const result = splitMergedStatements("x", "42", "let");
    expect(result).toContain("let x = 42;");
  });

  test("single const declaration", () => {
    const result = splitMergedStatements("y", '"hello"', "const");
    expect(result).toContain('const y = "hello";');
  });

  test("reactive declaration uses _scrml_reactive_set", () => {
    const result = splitMergedStatements("count", "0", "reactive");
    expect(result).toContain('_scrml_reactive_set("count", 0);');
  });

  test("state-decl also uses _scrml_reactive_set", () => {
    const result = splitMergedStatements("count", "0", "state-decl");
    expect(result).toContain('_scrml_reactive_set("count", 0);');
  });

  test("splits merged reactive declarations (value @name = value)", () => {
    const result = splitMergedStatements("a", "1 @b = 2", "reactive");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('"a"');
    expect(lines[1]).toContain('"b"');
  });

  test("splits merged let declarations (value let name = value)", () => {
    const result = splitMergedStatements("x", "1 let y = 2", "let");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("let x =");
    expect(lines[1]).toContain("let y =");
  });

  test("handles trailing bare expression statements", () => {
    const result = splitMergedStatements("x", '"" saveTodos()', "let");
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    // First is the let declaration, second is the trailing call
    expect(lines[0]).toContain("let x =");
    expect(lines[1]).toContain("saveTodos()");
  });
});

// ---------------------------------------------------------------------------
// Compilation smoke test — scrml file exists
// ---------------------------------------------------------------------------

describe("bpp.scrml", () => {
  test("scrml source file exists", () => {
    expect(existsSync(scrmlPath)).toBe(true);
  });

  test("scrml source contains all exported function names", () => {
    const { readFileSync } = require("fs");
    const source = readFileSync(scrmlPath, "utf-8");
    expect(source).toContain("export function isLeakedComment");
    expect(source).toContain("export function stripLeakedComments");
    expect(source).toContain("export function splitBareExprStatements");
    expect(source).toContain("export function splitMergedStatements");
  });

  test("scrml source imports rewriteExpr", () => {
    const { readFileSync } = require("fs");
    const source = readFileSync(scrmlPath, "utf-8");
    expect(source).toContain("rewriteExpr");
  });
});
