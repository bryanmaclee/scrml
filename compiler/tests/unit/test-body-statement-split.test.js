/**
 * Test-block body statement splitting — Unit Tests (S77 codegen tightening)
 *
 * Covers the parser-side fix for the consecutive-`let`-in-`~{}`-body bug
 * filed S76 via A6-5 integration testing. The defect:
 *
 *   ~{ test "x" {
 *     let a = f()
 *     let b = g()
 *     assert a == b
 *   } }
 *
 * Pre-fix: the non-assert body collector joined every token in the test
 * body with single spaces and emitted ONE caseBody entry, producing
 * `let a = f ( ) let b = g ( )` — invalid JS at bun:test load time.
 *
 * Post-fix: the collector splits into multiple statements at depth-0 `;`
 * PUNCT AND at depth-0 statement-keyword tokens (`let`/`const`/`return`/
 * etc.) that begin on a source line greater than the previous consumed
 * token's line. Each statement becomes its own caseBody entry; emit-test
 * pushes each as its own line of generated JS.
 *
 * Coverage:
 *   §1  Newline-separated `let`s split into separate caseBody entries.
 *   §2  Explicit `;`-separated `let`s split (the `;` is consumed).
 *   §3  Mixed newline + `;` shapes both split.
 *   §4  Single-line single-statement test body remains a single entry.
 *   §5  Other statement keywords (const/return/if/throw) split correctly.
 *   §6  Brace-depth respected — statements inside nested `{...}` do not split.
 *   §7  Generated JS loads + runs cleanly under bun:test (end-to-end).
 *
 * Source-of-truth: SPEC §19.12 ~{} test blocks; ast-builder.js parseTestBody.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTestBlock(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const { ast } = buildAST(bsOut);
  const node = ast.nodes.find(n => n.kind === "test");
  return node;
}

function firstCaseBody(source) {
  const node = parseTestBlock(source);
  return node?.testGroup?.tests?.[0]?.body ?? [];
}

// ---------------------------------------------------------------------------
// §1 — Newline-separated lets split into separate entries
// ---------------------------------------------------------------------------

describe("test-body §1: newline-separated lets split", () => {
  test("two newline-separated `let`s produce two body entries", () => {
    const body = firstCaseBody(
      `~{ test "x" {\n  let a = 1\n  let b = 2\n  assert a < b\n} }`,
    );
    // Body: [stmt1, stmt2, "assert a < b"]
    expect(body).toHaveLength(3);
    expect(body[0]).toMatch(/^let a =/);
    expect(body[1]).toMatch(/^let b =/);
    expect(body[2]).toBe("assert a < b");
  });

  test("three newline-separated `let`s produce three body entries", () => {
    const body = firstCaseBody(
      `~{ test "x" {\n  let a = 1\n  let b = 2\n  let c = 3\n  assert a == 1\n} }`,
    );
    expect(body).toHaveLength(4);
    expect(body[0]).toMatch(/^let a =/);
    expect(body[1]).toMatch(/^let b =/);
    expect(body[2]).toMatch(/^let c =/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Explicit `;`-separated lets split (semicolon consumed)
// ---------------------------------------------------------------------------

describe("test-body §2: `;`-separated lets split, `;` consumed", () => {
  test("two `;`-separated `let`s on one line produce two body entries", () => {
    const body = firstCaseBody(
      `~{ test "x" { let a = 1; let b = 2; assert a < b } }`,
    );
    expect(body).toHaveLength(3);
    expect(body[0]).toMatch(/^let a =/);
    expect(body[0]).not.toContain(";"); // `;` was consumed at split
    expect(body[1]).toMatch(/^let b =/);
    expect(body[1]).not.toContain(";");
  });

  test("trailing `;` after last let does not produce empty entry", () => {
    const body = firstCaseBody(
      `~{ test "x" { let a = 1; let b = 2; assert a < b } }`,
    );
    expect(body.every(s => s.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — Mixed newline + `;` separators
// ---------------------------------------------------------------------------

describe("test-body §3: mixed newline + `;` shapes split", () => {
  test("newline then `;` then newline all split", () => {
    const body = firstCaseBody(
      `~{ test "x" {\n  let a = 1\n  let b = 2; let c = 3\n  assert a == 1\n} }`,
    );
    expect(body).toHaveLength(4);
    expect(body[0]).toMatch(/^let a =/);
    expect(body[1]).toMatch(/^let b =/);
    expect(body[2]).toMatch(/^let c =/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Single-statement bodies remain single entries
// ---------------------------------------------------------------------------

describe("test-body §4: single-statement bodies unchanged", () => {
  test("a single `let` produces one body entry", () => {
    const body = firstCaseBody(
      `~{ test "x" { let a = 1\n  assert a == 1 } }`,
    );
    expect(body).toHaveLength(2);
    expect(body[0]).toMatch(/^let a =/);
  });

  test("body with no setup statements is empty", () => {
    const body = firstCaseBody(`~{ test "x" { assert 1 == 1 } }`);
    expect(body).toEqual(["assert 1 == 1"]);
  });
});

// ---------------------------------------------------------------------------
// §5 — Other statement keywords split on newline
// ---------------------------------------------------------------------------

describe("test-body §5: const/return/if/throw split on newline", () => {
  test("const + let on consecutive lines split", () => {
    const body = firstCaseBody(
      `~{ test "x" {\n  const x = 1\n  let y = 2\n  assert x < y\n} }`,
    );
    expect(body).toHaveLength(3);
    expect(body[0]).toMatch(/^const x =/);
    expect(body[1]).toMatch(/^let y =/);
  });

  test("`if` keyword starts a new statement on a new line", () => {
    const body = firstCaseBody(
      `~{ test "x" {\n  let a = 1\n  if (a) { a = 2 }\n  assert a == 2\n} }`,
    );
    expect(body[0]).toMatch(/^let a =/);
    expect(body[1]).toMatch(/^if/);
  });
});

// ---------------------------------------------------------------------------
// §6 — Brace depth respected (no spurious split inside nested {})
// ---------------------------------------------------------------------------

describe("test-body §6: brace depth respected", () => {
  test("`let` inside an inner `{...}` does NOT trigger an outer split", () => {
    // The inner `let` is at depth 1, so the depth-0 split rule does not fire.
    // The outer collector produces a single entry containing the whole arrow.
    const body = firstCaseBody(
      `~{ test "x" {\n  let f = () => { let inner = 1\n  return inner }\n  assert f() == 1\n} }`,
    );
    // Expect 2 entries: the f-decl (with its multi-line arrow body intact)
    // and the assert.
    expect(body).toHaveLength(2);
    expect(body[0]).toMatch(/^let f =/);
    expect(body[0]).toContain("inner");
    expect(body[0]).toContain("return");
  });
});

// ---------------------------------------------------------------------------
// §6.5 — String-literal preservation across all 4 token-joiners (S77 fix)
//
// The tokenizer strips outer quotes from STRING tokens (their `.text` field
// holds unquoted content). Pre-fix, the test-block parsers' raw token-joins
// dropped the quotes, producing `expect(getGreeting ( alice )).toEqual(
// stubbed-greeting)` instead of `expect(getGreeting("alice")).toEqual(
// "stubbed-greeting")`. Same root cause as the consecutive-`let` bug —
// raw token-text reuse at join time. Fix: `tokenToSourceText` helper
// re-wraps STRING tokens (JSON.stringify for plain, backticks for template)
// before joining. Applied to all 4 collectors: collectBody,
// collectAssertTokens, parseTestBindDecl RHS, non-assert test body.
// ---------------------------------------------------------------------------

describe("test-body §6.5: string literals preserved across all token-joiners", () => {
  test("test-bind RHS string literal keeps its quotes", () => {
    const node = parseTestBlock(
      `~{ test-bind getGreeting = "stubbed-greeting"\n` +
      `   test "x" { assert true } }`,
    );
    const bind = node?.testGroup?.testBinds?.[0];
    expect(bind).toBeTruthy();
    expect(bind.expression).toBe('"stubbed-greeting"');
  });

  test("assert LHS+RHS preserve string literals (collectAssertTokens)", () => {
    const node = parseTestBlock(
      `~{ test "x" { assert "alice" == "alice" } }`,
    );
    const stmt = node?.testGroup?.tests?.[0]?.body?.[0];
    expect(stmt).toBe('assert "alice" == "alice"');
    const a = node.testGroup.tests[0].asserts[0];
    expect(a.lhs).toBe('"alice"');
    expect(a.rhs).toBe('"alice"');
  });

  test("non-assert body string-literal preserved (let with string)", () => {
    const body = firstCaseBody(
      `~{ test "x" { let s = "hello"\n  assert s == "hello" } }`,
    );
    expect(body[0]).toMatch(/^let s =/);
    expect(body[0]).toContain('"hello"');
    // Defensive: ensure the unquoted form is NOT present anywhere
    expect(body[0]).not.toMatch(/= hello\b/);
  });

  test("before-block string-literal preserved (collectBody)", () => {
    const node = parseTestBlock(
      `~{ before { let prefix = "Hello, " }\n` +
      `   test "x" { assert true } }`,
    );
    const before = node?.testGroup?.before;
    expect(Array.isArray(before)).toBe(true);
    expect(before.join(" ")).toContain('"Hello, "');
  });

  test("backtick template literal re-wrapped with backticks (preserves ${})", () => {
    const node = parseTestBlock(
      `~{ test-bind greet = \`Hello, \${name}\`\n` +
      `   test "x" { assert true } }`,
    );
    const bind = node?.testGroup?.testBinds?.[0];
    expect(bind.expression).toContain("`");
    expect(bind.expression).toContain("${name}");
  });
});

// ---------------------------------------------------------------------------
// §7 — End-to-end: emitted JS loads + runs under bun:test
// ---------------------------------------------------------------------------

describe("test-body §7: emitted JS loads + passes under bun:test", () => {
  test("compileScrml on multi-let test body emits valid runnable JS", () => {
    const dir = join(tmpdir(), `scrml-s77-stmt-split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
    const appPath = join(dir, "app.scrml");
    writeFileSync(
      appPath,
      `\${\n  server fn double(x) { x * 2 }\n}\n` +
      `~{\n  test-bind double = (x) => x * 2\n  test "two lets" {\n` +
      `    let a = double(2)\n    let b = double(3)\n` +
      `    assert a == 4\n    assert b == 6\n  }\n}\n`,
    );
    const distDir = join(dir, "dist");
    const result = compileScrml({
      inputFiles: [appPath],
      outputDir: distDir,
      write: true,
      testMode: true,
      log: () => {},
    });
    const hardErrors = (result.errors || []).filter(
      e => e.severity !== "warning" && e.severity !== "info",
    );
    expect(hardErrors).toEqual([]);

    const testJsPath = join(distDir, "app.test.js");
    const testJs = readFileSync(testJsPath, "utf8");

    // Each `let` gets its own line of emitted JS — neither collapses onto
    // the other. Pre-fix this regex would not match because both lets were
    // joined into one line.
    expect(testJs).toMatch(/let a = double \( 2 \)\s*\n\s*let b = double \( 3 \)/);

    // Spawn `bun test` on the emitted JS — must load + pass cleanly.
    // Use process.cwd() so this works in both main and worktree checkouts.
    const child = spawnSync("bun", ["test", testJsPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(child.status).toBe(0);
    const combined = (child.stderr || "") + (child.stdout || "");
    expect(combined).toMatch(/1 pass/);
    expect(combined).toMatch(/0 fail/);
  });
});
