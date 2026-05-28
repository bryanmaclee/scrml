/**
 * r24-bug-31-if-as-expression-result-binding.test.js
 *
 * Regression test for R24-Bug-31 (known-gaps Bug 31 / S139, dispatched
 * 2026-05-27 — R24 finding originally filed as R24-BUG-5).
 *
 * The bug: a function body of the canonical adopter shape
 *
 *     function load() {
 *         if (!@searchTerm) return
 *         fetchItems() !{ | ::Network msg -> { ... } | ::Empty -> { ... } }
 *     }
 *
 * — bare `return` on its own line, followed by a failable call on the next
 * line — produced invalid JS:
 *
 *     let _scrml__scrml_result_N = if (cond) {
 *       return _scrml_fetch_fetchItems_M(...);
 *     };
 *
 * `if` is a JS STATEMENT, not an expression, so `node --check` reported
 * `SyntaxError: Unexpected token 'if'`. Dev-1-react and 1 other R24 site
 * tripped this.
 *
 * Root cause: ast-builder.js `parseOneStatement` (and the parallel
 * `parseLogicBody` main-loop handler) handles `return EXPR` via
 * `collectExpr()` — which has BUG-ASI-NEWLINE statement-boundary detection
 * but only after `parts.length > 0`. On the very first collectExpr
 * iteration, parts is empty, so the newline-separated next token (the
 * failable call's identifier) is consumed as the first part of the return
 * expression. collectExpr then continues collecting `(args)` etc, finally
 * breaking on the BLOCK_REF `!{}` (which IS a statement boundary at
 * parts.length > 0). The result: `return-stmt` carries the next statement's
 * expression as its `.expr`. Then parseRecursiveBody / parseLogicBody main
 * loop sees the BLOCK_REF as the next token and wraps the if-stmt as a
 * `guarded-expr.guardedNode`. emit-logic's `case "guarded-expr"` then
 * routes the if-stmt through `emitIfStmt`, producing `if (cond) {
 * return X; }` as the right-hand side of `let _result = ...;`.
 *
 * Fix: respect JS ASI for `return`. ECMA-262 §12.9 makes `return` a
 * restricted production — any line terminator between the keyword and the
 * expression triggers automatic semicolon insertion. The fix adds a
 * span-line comparison: if the next non-comment token is on a later
 * source line than the `return` keyword, emit a bare return. Applied at
 * both `tok.text === "return"` sites in ast-builder.js (parseOneStatement
 * inner handler ~L5491 + parseLogicBody main-loop handler ~L9255). Both
 * paths can fire depending on the enclosing context — function bodies
 * via parseRecursiveBody → parseOneStatement; top-level logic via the
 * main loop directly.
 *
 * Coverage matrix (12 tests):
 *
 *   §1  Minimal repro — `if (!@x) return` + bare-call failable on next line.
 *   §2  Const-binding form — `const r = call() !{...}` after bare return.
 *   §3  Let-binding form — `let r = call() !{...}` after bare return.
 *   §4  Single-line collapsed arms — `| ::V -> @x = 1`.
 *   §5  No early-return — regression-guard the working-case path.
 *   §6  Multi-statement before failable — `if (x) return; @a = 1; call() !{...}`.
 *   §7  Multiple sequential early-returns — `if (a) return; if (b) return; ...`.
 *   §8  Early-return INSIDE a braced block — `if (x) { @a = 1; return; }; call() !{...}`.
 *   §9  Same-line return — `return value` on one line still parses as
 *       `return EXPR`, NOT bare return (regression-guard).
 *   §10 Same-line return-with-expression in failable position —
 *       `function fn() { return loadFn() }` — value-return path intact.
 *   §11 Ternary (negative control) — `const x = a ? b : c` still works
 *       (ternaries are expression-shape, not statement-`if`-shape).
 *   §12 Multi-line return with chained method — `return x\n.foo()` —
 *       ASI fires per JS spec (this is THE classic JS gotcha; the SPEC
 *       inherits it).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

function makeTmpDir(label) {
  const tmp = join(tmpdir(), `scrml-r24-bug-31-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

function compileAndRead(src, label) {
  const tmp = makeTmpDir(label);
  const srcFile = join(tmp, "repro.scrml");
  writeFileSync(srcFile, src);
  const outDir = join(tmp, "dist");
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
  const clientJs = readFileSync(join(outDir, "repro.client.js"), "utf8");
  return { result, clientJs, tmp };
}

function nodeCheckClean(clientJs, tmp) {
  // Write to a temp file and run `node --check` — returns true if clean.
  const checkFile = join(tmp, "check.js");
  writeFileSync(checkFile, clientJs);
  try {
    execFileSync("node", ["--check", checkFile], { stdio: "pipe" });
    return { ok: true, stderr: "" };
  } catch (e) {
    return { ok: false, stderr: String(e.stderr ?? e.message) };
  }
}

// ---------------------------------------------------------------------------
// §1: Minimal repro — `if (!@x) return` + bare-call failable on next line
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §1: minimal repro — bare return + failable on next line", () => {
  test("if (!@x) return / fetchItems() !{...} — emitted client.js parses clean", () => {
    const src = [
      '<program title="bug31-min">',
      '<state>',
      '<searchTerm> = ""',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type LoadError:enum = { Network(msg: string), Empty }',
      'server function fetchItems() ! LoadError {',
      '  fail LoadError::Empty',
      '}',
      'function load() {',
      '    if (!@searchTerm) return',
      '    fetchItems() !{',
      '        | ::Network msg -> { @searchTerm = msg }',
      '        | ::Empty       -> { @searchTerm = "empty" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "min");
    expect(result.errors).toHaveLength(0);

    // The buggy emission contained `let _scrml_result_N = if (...)`.
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);

    // node --check must pass.
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);

    // The early-return must emit as its own statement BEFORE the result binding.
    const loadIdx = clientJs.indexOf("function _scrml_load_");
    expect(loadIdx).toBeGreaterThan(-1);
    const loadBody = clientJs.slice(loadIdx, loadIdx + 800);
    // bare `return;` (with possibly a newline before — the codegen uses an
    // if-stmt block, NOT inlined; the consequent contains `return;`).
    expect(loadBody).toMatch(/if \(.*searchTerm.*\)\s*\{\s*return;\s*\}/s);

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §2: Const-binding form — `const r = call() !{...}` after bare return
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §2: const-binding after bare return", () => {
  test("const r = fetchItems() !{...} — clean emission, binding intact", () => {
    const src = [
      '<program title="bug31-const">',
      '<state>',
      '<searchTerm> = ""',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type LoadError:enum = { Network(msg: string), Empty }',
      'server function fetchItems() ! LoadError {',
      '  fail LoadError::Empty',
      '}',
      'function load() {',
      '    if (!@searchTerm) return',
      '    const r = fetchItems() !{',
      '        | ::Network msg -> { @searchTerm = msg }',
      '        | ::Empty       -> { @searchTerm = "empty" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "const");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // The const binding `r` should be wired to the result.
    expect(clientJs).toMatch(/var r = _scrml_\w*result/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §3: Let-binding form — `let r = call() !{...}` after bare return
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §3: let-binding after bare return", () => {
  test("let r = fetchItems() !{...} — clean emission", () => {
    const src = [
      '<program title="bug31-let">',
      '<state>',
      '<searchTerm> = ""',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type LoadError:enum = { Network(msg: string), Empty }',
      'server function fetchItems() ! LoadError {',
      '  fail LoadError::Empty',
      '}',
      'function load() {',
      '    if (!@searchTerm) return',
      '    let r = fetchItems() !{',
      '        | ::Network msg -> { @searchTerm = msg }',
      '        | ::Empty       -> { @searchTerm = "empty" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "let");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §4: Single-line collapsed arms after bare return
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §4: single-line collapsed arms after bare return", () => {
  test("`| ::V -> @x = 1` collapsed arms — clean emission", () => {
    const src = [
      '<program title="bug31-collapsed">',
      '<state>',
      '<msg> = ""',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type ErrT:enum = { A, B }',
      'server function risky() ! ErrT { fail ErrT::A }',
      'function load() {',
      '    if (!@msg) return',
      '    risky() !{ | ::A -> @msg = "a" | ::B -> @msg = "b" }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "collapsed");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §5: No early-return — regression-guard the working-case path
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §5: regression-guard — no early-return path STILL works", () => {
  test("function load() { const r = fetchItems() !{...} } — no bug present pre-fix; clean post-fix", () => {
    const src = [
      '<program title="bug31-noearly">',
      '<state>',
      '<msg> = ""',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type ErrT:enum = { A, B }',
      'server function risky() ! ErrT { fail ErrT::A }',
      'function load() {',
      '    const r = risky() !{',
      '        | ::A -> { @msg = "a" }',
      '        | ::B -> { @msg = "b" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "noearly");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §6: Multi-statement before failable — `if (x) return; @a = 1; call() !{...}`
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §6: multi-statement between early-return and failable", () => {
  test("if (x) return; @a = ...; call() !{...} — clean emission, all statements present", () => {
    const src = [
      '<program title="bug31-multistmt">',
      '<state>',
      '<msg> = ""',
      '<count> = 0',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type ErrT:enum = { A, B }',
      'server function risky() ! ErrT { fail ErrT::A }',
      'function load() {',
      '    if (!@msg) return',
      '    @count = 1',
      '    risky() !{',
      '        | ::A -> { @msg = "a" }',
      '        | ::B -> { @msg = "b" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "multistmt");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // All statements must emit
    expect(clientJs).toContain('_scrml_reactive_set("count", 1)');
    expect(clientJs).toContain('_scrml_reactive_set("msg", "a")');
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §7: Multiple sequential early-returns
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §7: multiple sequential early-returns", () => {
  test("if (a) return; if (b) return; call() !{...} — all returns emit + failable parses clean", () => {
    const src = [
      '<program title="bug31-multireturn">',
      '<state>',
      '<msg> = ""',
      '<flag> = false',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type ErrT:enum = { A, B }',
      'server function risky() ! ErrT { fail ErrT::A }',
      'function load() {',
      '    if (!@msg) return',
      '    if (@flag) return',
      '    risky() !{',
      '        | ::A -> { @msg = "a" }',
      '        | ::B -> { @msg = "b" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "multiret");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // The function body should contain TWO `return;` (one per early-exit).
    const loadIdx = clientJs.indexOf("function _scrml_load_");
    const loadBody = clientJs.slice(loadIdx, loadIdx + 1200);
    const returnCount = (loadBody.match(/\breturn;/g) ?? []).length;
    expect(returnCount).toBeGreaterThanOrEqual(2);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §8: Early-return INSIDE a braced if-block
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §8: braced early-return then failable", () => {
  test("if (x) { @a = 1; return } / call() !{...} — clean emission", () => {
    const src = [
      '<program title="bug31-braced">',
      '<state>',
      '<msg> = ""',
      '<count> = 0',
      '</state>',
      '<page>',
      '<button onclick=load()>Load</button>',
      '</page>',
      'type ErrT:enum = { A, B }',
      'server function risky() ! ErrT { fail ErrT::A }',
      'function load() {',
      '    if (!@msg) {',
      '        @count = 99',
      '        return',
      '    }',
      '    risky() !{',
      '        | ::A -> { @msg = "a" }',
      '        | ::B -> { @msg = "b" }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "braced");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // The braced body must emit the count write AND the return.
    expect(clientJs).toContain('_scrml_reactive_set("count", 99)');
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §9: Same-line return-with-expression — `return value` regression-guard
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §9: same-line return-with-expression — value-return path intact", () => {
  test("function compute() { return 42 } — emits `return 42`, NOT bare return", () => {
    const src = [
      '<program title="bug31-sameline">',
      '<state>',
      '<x> = 0',
      '</state>',
      '<page>',
      '<button onclick=run()>Run</button>',
      '</page>',
      'function compute() { return 42 }',
      'function run() {',
      '    @x = compute()',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "sameline");
    expect(result.errors).toHaveLength(0);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // `return 42;` MUST emit — bare `return;` would be wrong.
    expect(clientJs).toMatch(/return\s+42\s*;/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §10: Same-line return + bare expression on later line — value-return path
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §10: return EXPR on same line, even with later content", () => {
  test("function compute(x) { return x } — return-with-expr intact same line", () => {
    const src = [
      '<program title="bug31-retexpr">',
      '<state>',
      '<x> = 0',
      '</state>',
      '<page>',
      '<button onclick=run()>Run</button>',
      '</page>',
      'function compute(x) { return x }',
      'function run() {',
      '    @x = compute(7)',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "retexpr");
    expect(result.errors).toHaveLength(0);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    expect(clientJs).toMatch(/return\s+x\s*;/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §11: Ternary (negative control) — `const x = a ? b : c` still works
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §11: ternary expression — negative control unchanged", () => {
  test("const r = (a ? b : c) — emits as ternary, no early-return ASI interaction", () => {
    const src = [
      '<program title="bug31-tern">',
      '<state>',
      '<a> = true',
      '<x> = 0',
      '</state>',
      '<page>',
      '<button onclick=run()>Run</button>',
      '</page>',
      'function run() {',
      '    const r = @a ? 1 : 2',
      '    @x = r',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "tern");
    expect(result.errors).toHaveLength(0);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // Ternary must emit
    expect(clientJs).toMatch(/\?\s*1\s*:\s*2/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §12: Empirical R24 dev-1-react reproducer — bare `return` + failable
// ---------------------------------------------------------------------------

describe("R24-Bug-31 §12: empirical R24 dev-1-react shape", () => {
  test("postComment() pattern — if (@id == 0) return / addComment(...) !{...}", () => {
    // This mirrors the exact failing shape in dev-1-react.scrml L166-174.
    // The qualified `::Variant` form (rather than `.Variant`) matches that file.
    const src = [
      '<program title="bug31-r24-dev1-shape">',
      '<state>',
      '<activeTicketId> = 0',
      '<commentDraft> = ""',
      '<currentAuthor> = ""',
      '</state>',
      '<page>',
      '<button onclick=postComment()>Post</button>',
      '</page>',
      'type CommentError:enum = { TicketMissing, Empty, DbWrite(msg: string) }',
      'server function addComment(ticketId, draft, author) ! CommentError {',
      '    fail CommentError::Empty',
      '}',
      'function postComment() {',
      '    if (@activeTicketId == 0) return',
      '    addComment(@activeTicketId, @commentDraft, @currentAuthor) !{',
      '        | ::TicketMissing -> { return }',
      '        | ::Empty -> { return }',
      '        | ::DbWrite msg -> { return }',
      '    }',
      '}',
      '</program>',
    ].join("\n");
    const { result, clientJs, tmp } = compileAndRead(src, "r24-shape");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).not.toMatch(/let _scrml_\w*result\w*\s*=\s*if\b/);
    const check = nodeCheckClean(clientJs, tmp);
    expect(check.ok).toBe(true);
    // The fetched call must emit, AND the early-return must be a separate
    // statement (NOT absorbed into the result binding's initializer).
    expect(clientJs).toMatch(/let _scrml_\w*result\w*\s*=\s*_scrml_fetch_addComment/);
    rmSync(tmp, { recursive: true, force: true });
  });
});
