/**
 * error-handler-arm-body-emission.test.js
 *
 * Regression test for R25-Bug-38 (known-gaps Bug 38 / S138) — the BROADER
 * `!{}` arm-body codegen case. R24-BUG-2 (Bug 29 narrow, S136) closed the
 * terminator-tail shape (`{ return }` / `{ throw err }` / etc.) by skipping
 * the `_result = ...` wrap when the LAST top-level statement was a JS
 * terminator. R25 gauntlet (4/4 devs tripped it) surfaced the broader case:
 *
 *   `someCall() !{ | ::V arg -> { @x = "v"; @y = 0 } | ::Other -> { ... } }`
 *
 * — multi-statement reactive-write arm bodies that DO NOT end with a
 * terminator. Pre-fix, these emitted the corrupt shape:
 *
 *     _result = _scrml_reactive_set("x", "v"); _scrml_reactive_set("y", 0);
 *
 * (valid JS, but `_result` ends up bound to the first reactive_set's return-
 * value — a meaningless side-effect discard. The actual user-intent "fire
 * both side-effects" was satisfied by the trailing bare stmt, but the wrap
 * shape is wrong and breaks the `const r = call() !{...}` workaround form
 * where `r` should hold the original call's result not the reactive_set's
 * return.)
 *
 * The fix in emit-logic.ts:emitArmAssign:
 *   (A) When `splitTopLevelStmts(trimmed).length > 1` (multi-stmt body):
 *       emit each statement as a bare stmt; no `_result =` wrap.
 *   (B) When the single statement is a known side-effect call (reactive
 *       write, engine write, navigate, effect/cleanup register, init-set):
 *       emit as a bare stmt; no wrap.
 *   (C) Otherwise (value-producing single stmt): keep existing wrap.
 *   (D) Terminator-tail R24-BUG-2 path: PRESERVED unchanged.
 *
 * Coverage matrix:
 *   §1  Multi-line/multi-stmt arm body (R25 dev-1-react minimal repro)
 *   §2  Single-line collapsed reactive-write arm (R25 dev-2-elixir minimal repro)
 *   §3  `const r = ...` value-binding form — workaround pattern
 *   §4  Multi-stmt body with TERMINATOR at end — regression-guard R24-BUG-2
 *   §5  Multi-arm mixed: terminator + value-producing + side-effect-only
 *   §6  Empty arm body `{ }` — no-op emit
 *   §7  Arm body with `if`/branch — emits the if (regression-guard nested ctrl)
 *   §8  Negative control — value-producing single stmt STILL wraps
 *   §9  navigate() / single-stmt side-effect call detection
 *   §10 End-to-end via compileScrml — multi-line arm body, no corrupt wrap
 *   §11 End-to-end via compileScrml — `const r = ...` workaround form
 *   §12 End-to-end — node-parseable function body slice
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Helpers (mirrors error-handler-terminator-arms.test.js)
// ---------------------------------------------------------------------------

function resetAndRun(fn) {
  resetVarCounter();
  return fn();
}

function makeBareExpr(expr) {
  return { kind: "bare-expr", expr };
}

function makeLetDecl(name, init) {
  return { kind: "let-decl", name, init };
}

function makeArm(pattern, binding, handler) {
  return { pattern, binding, handler };
}

function makeGuardedExpr(guardedNode, arms) {
  return { kind: "guarded-expr", guardedNode, arms };
}

// ---------------------------------------------------------------------------
// §1: Multi-stmt arm body (R25 dev-1-react minimal repro)
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §1: multi-stmt reactive-write arm body", () => {
  test("`{ @x = \"v\"; @y = 0 }` — emits two reactive_set as bare stmts, no wrap", () => {
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::NotFound", null, '{ @x = "missing"; @y = 0 }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // R25-Bug-38 corrupt wrap MUST NOT appear:
    //   _scrml_result_N = _scrml_reactive_set("x", "missing"); _scrml_reactive_set("y", 0);
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x",/);
    // Both reactive_set calls present
    expect(result).toContain('_scrml_reactive_set("x", "missing")');
    expect(result).toContain('_scrml_reactive_set("y", 0)');
    // Variant guard still emitted
    expect(result).toContain('.variant === "NotFound"');
  });

  test("multi-arm — both arms emit as bare stmts (no wrap on either)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [
        makeArm("::NotFound", null, '{ @x = "missing"; @y = 0 }'),
        makeArm("_", "e", '{ @x = "other"; @y = 1 }'),
      ]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // No corrupt wrap on either arm
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", "missing"\)/);
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", "other"\)/);
    // Four reactive_set calls total
    const setCount = (result.match(/_scrml_reactive_set\(/g) || []).length;
    expect(setCount).toBeGreaterThanOrEqual(4);
    // Wildcard binding for `e` is still emitted
    expect(result).toContain("const e = _scrml__scrml_result_1.data");
  });
});

// ---------------------------------------------------------------------------
// §2: Single-line collapsed reactive-write arm (R25 dev-2-elixir repro)
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §2: single-line collapsed reactive-write arm", () => {
  test("`| ::Variant -> @x = 1` (no braces) — emits as bare stmt, no wrap", () => {
    // Bare arm body (no braces) → emitArmBody routes through emitExprField,
    // which returns `_scrml_reactive_set("x", 1);` as a single stmt. The fix
    // detects this as a side-effect single stmt and emits without wrap.
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::Bad", null, "@x = 1")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", 1\)/);
    expect(result).toContain('_scrml_reactive_set("x", 1)');
  });

  test("braced single-stmt collapsed form `{ @x = 1 }` — same shape", () => {
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::Bad", null, "{ @x = 1 }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", 1\)/);
    expect(result).toContain('_scrml_reactive_set("x", 1)');
  });
});

// ---------------------------------------------------------------------------
// §3: `let r = ... !{ ... }` (`const r = ...`) workaround value-binding form
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §3: const r = ... workaround value-binding form", () => {
  test("`let r = call() !{ | ::X -> { @y = 1 } }` — emits var r + arm body fires", () => {
    const node = makeGuardedExpr(
      makeLetDecl("r", "loadThing()"),
      [makeArm("::Bad", null, "{ @y = 1 }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // The trailing var r = _result binding is still emitted
    expect(result).toMatch(/var r = _scrml_\w+_\d+\s*;/);
    // Arm body still emits the reactive_set
    expect(result).toContain('_scrml_reactive_set("y", 1)');
    // The corrupt wrap MUST NOT appear
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("y", 1\)/);
  });

  test("workaround form with multi-stmt arm — r still binds; arm fires both", () => {
    const node = makeGuardedExpr(
      makeLetDecl("r", "loadThing()"),
      [makeArm("::Bad", null, '{ @x = "v"; @y = 0 }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/var r = _scrml_\w+_\d+\s*;/);
    expect(result).toContain('_scrml_reactive_set("x", "v")');
    expect(result).toContain('_scrml_reactive_set("y", 0)');
  });
});

// ---------------------------------------------------------------------------
// §4: Multi-stmt with TERMINATOR at end — regression-guard R24-BUG-2
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §4: R24-BUG-2 regression — terminator-tail still works", () => {
  test("`{ @phase = .Error(msg); return }` — reactive_set THEN bare `return`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::Network", "msg", '{ @phase = .Error(msg); return }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // No wrap of any kind on the arm body
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set/);
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // Reactive set fires
    expect(result).toContain("_scrml_reactive_set");
    // Bare return is present
    expect(result).toMatch(/\breturn\s*;/);
    // Order: side-effect BEFORE return
    const setIdx = result.indexOf("_scrml_reactive_set");
    const retIdx = result.lastIndexOf("return");
    expect(setIdx).toBeGreaterThan(0);
    expect(retIdx).toBeGreaterThan(setIdx);
  });

  test("plain `{ return }` body still emits bare `return;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("::Bad", null, "{ return }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    expect(result).toMatch(/\breturn\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §5: Multi-arm mixed — terminator + value-producing + side-effect-only
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §5: mixed multi-arm — terminator + value + side-effect", () => {
  test("three arms — terminator-tail / value / side-effect — each emits its shape", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchData()"),
      [
        // Arm 1: terminator-tail (R24-BUG-2 shape)
        makeArm("::Network", "msg", "{ return }"),
        // Arm 2: value-producing (negative control)
        makeArm("::Validation", "e", '{ "fallback" }'),
        // Arm 3: side-effect-only (R25-Bug-38 shape)
        makeArm("_", "e", '{ @phase = "error" }'),
      ]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // Arm 1: bare return
    expect(result).toMatch(/\breturn\s*;/);
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // Arm 2: value wrap PRESERVED (single value-producing stmt)
    expect(result).toMatch(/_scrml_\w+\s*=\s*"fallback"\s*;/);
    // Arm 3: bare reactive_set, no wrap
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("phase", "error"\)/);
    expect(result).toContain('_scrml_reactive_set("phase", "error")');
  });
});

// ---------------------------------------------------------------------------
// §6: Empty arm body — no-op emit
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §6: empty arm body", () => {
  test("`{ }` empty body still emits `_result = null;` (M-7C-D-12 retained)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::Bad", null, "{ }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // Existing M-7C-D-12 behavior preserved: empty body → `_result = null;`
    expect(result).toMatch(/_scrml_\w+\s*=\s*null\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §7: Arm body with nested if — multi-line route still works
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §7: arm body with internal if-branch", () => {
  test("`{ if (msg) { @x = \"v\" } @y = 0 }` — nested if + trailing stmt", () => {
    // This shape contains a nested `{...}` for the if-body, so rewriteBlockBody
    // produces multi-line output → emitArmAssign goes through the multi-line
    // branch (existing behavior). Verify it still works post-fix.
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::NotFound", "msg", '{ if (msg) { @x = "v" } @y = 0 }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain("if (msg)");
    expect(result).toContain('_scrml_reactive_set("x", "v")');
    expect(result).toContain('_scrml_reactive_set("y", 0)');
    // No corrupt wrap
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*if\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §8: Negative control — value-producing single stmt STILL wraps
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §8: negative control — value-producing single stmt still wraps", () => {
  test("`{ \"fallback\" }` arm — wrap preserved", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", '{ "fallback" }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*"fallback"\s*;/);
  });

  test("`{ computeFallback(e) }` arm — wrap preserved (unknown call = value-shape)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "{ computeFallback(e) }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*computeFallback\(e\)\s*;/);
  });

  test("bareword (no braces) value arm still wraps", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "fallback(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*fallback\(e\)\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §9: navigate() / single-stmt side-effect detection
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §9: single-stmt side-effect call detection", () => {
  test("emitted form contains `_scrml_navigate(...)` — detection includes navigate", () => {
    // We can't easily go from scrml-source `navigate("/login", .Hard)` to the
    // emitted `_scrml_navigate(...)` without compiling the full source, so
    // here we test the detection list by passing a handler that's already in
    // emitted form via the bareword arm path. emitArmBody trims and appends
    // `;` to a non-block handler.
    //
    // The arm body `_scrml_navigate("/login")` arrives at emitArmAssign as
    // `_scrml_navigate("/login");`. Detection: starts with `_scrml_navigate(`
    // → emit bare, no wrap.
    const node = makeGuardedExpr(
      makeBareExpr("loadThing()"),
      [makeArm("::Unauthorized", null, '_scrml_navigate("/login")')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_navigate\(/);
    expect(result).toContain('_scrml_navigate("/login")');
  });
});

// ---------------------------------------------------------------------------
// §10-§12: End-to-end via compileScrml
// ---------------------------------------------------------------------------

describe("R25-Bug-38 §10: end-to-end — multi-line arm body compiles to clean JS", () => {
  test("PRIMER §6.8 canonical adopter shape (without trailing return) — no corrupt wrap", () => {
    const tmp = join(tmpdir(), `scrml-r25-bug-38-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type LoadError:enum = { NotFound, Empty }",
      '  @phase = ""',
      '  @x = ""',
      "  @y = 0",
      "  server function loadDashboard()! -> LoadError {",
      "    lift []",
      "  }",
      "  function init() {",
      "    loadDashboard() !{",
      '      | ::NotFound -> { @x = "missing"; @y = 0 }',
      '      | ::Empty    -> { @x = "empty"; @y = 1 }',
      "    }",
      '    @phase = "loaded"',
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r25-bug-38.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs = readFileSync(join(outDir, "r25-bug-38.client.js"), "utf8");
    // The R25-Bug-38 corrupt wrap MUST NOT appear
    expect(clientJs).not.toMatch(/_scrml_\w+\s*=\s*_scrml_reactive_set\("x", "missing"\)/);
    expect(clientJs).not.toMatch(/_scrml_\w+\s*=\s*_scrml_reactive_set\("x", "empty"\)/);
    // All four reactive_set calls present
    expect(clientJs).toContain('_scrml_reactive_set("x", "missing")');
    expect(clientJs).toContain('_scrml_reactive_set("y", 0)');
    expect(clientJs).toContain('_scrml_reactive_set("x", "empty")');
    expect(clientJs).toContain('_scrml_reactive_set("y", 1)');
    // Variant guards
    expect(clientJs).toContain('.variant === "NotFound"');
    expect(clientJs).toContain('.variant === "Empty"');

    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("R25-Bug-38 §11: end-to-end — `let r = ...` workaround form", () => {
  test("`let r = call() !{ ... }` workaround — r binds + arm fires", () => {
    const tmp = join(tmpdir(), `scrml-r25-bug-38-letr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type LoadError:enum = { NotFound, Empty }",
      '  @x = ""',
      "  @y = 0",
      "  server function loadRow()! -> LoadError {",
      "    lift []",
      "  }",
      "  function init() {",
      "    let r = loadRow() !{",
      '      | ::NotFound -> { @x = "miss"; @y = 0 }',
      "      | ::Empty    -> { @y = 1 }",
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r25-bug-38-letr.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs = readFileSync(join(outDir, "r25-bug-38-letr.client.js"), "utf8");
    // r binds to _result (the call's tagged-object on error, success value on ok)
    expect(clientJs).toMatch(/var r = _scrml_\w+_\d+\s*;/);
    // Reactive sets fire
    expect(clientJs).toContain('_scrml_reactive_set("x", "miss")');
    expect(clientJs).toContain('_scrml_reactive_set("y", 0)');
    expect(clientJs).toContain('_scrml_reactive_set("y", 1)');
    // No corrupt wrap
    expect(clientJs).not.toMatch(/_scrml_\w+\s*=\s*_scrml_reactive_set\("x", "miss"\)/);

    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("R25-Bug-38 §12: end-to-end — emitted function is node-parseable", () => {
  test("multi-line arm body — emitted handler function parses as valid JS", () => {
    const tmp = join(tmpdir(), `scrml-r25-bug-38-parse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type Err:enum = { A, B(msg: string) }",
      "  @flag = 0",
      '  @label = ""',
      "  server function doThing()! -> Err {",
      "    lift []",
      "  }",
      "  function attempt() {",
      "    doThing() !{",
      '      | ::A     -> { @flag = 1; @label = "a" }',
      '      | ::B msg -> { @flag = 2; @label = msg }',
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r25-bug-38-parse.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs = readFileSync(join(outDir, "r25-bug-38-parse.client.js"), "utf8");
    // Slice the _scrml_attempt_N function body and parse via new Function.
    // S138 Bug 9 L1 — accept optional `async` prefix; the L1 fix populates
    // route.functionName so transitive client-callers correctly emit as
    // `async function` when calling server fns. The body still parses;
    // outer `async` keyword is fine inside `new Function` wrap.
    const fnHeaderRe = /(?:async\s+)?function\s+_scrml_attempt_\d+\s*\([^)]*\)\s*\{/;
    const headerMatch = clientJs.match(fnHeaderRe);
    expect(headerMatch).not.toBeNull();
    const start = headerMatch.index;
    const bodyStart = start + headerMatch[0].length;
    let depth = 1;
    let end = bodyStart;
    while (end < clientJs.length && depth > 0) {
      const ch = clientJs[end];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      end++;
    }
    const fnSrc = clientJs.slice(start, end);
    expect(() => new Function(fnSrc)).not.toThrow();

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// C5 (R27): a `;` (or newline) INSIDE a STRING LITERAL in an `!{}` arm body
// must NOT be treated as a statement separator. The arm-body statement
// splitter (rewriteBlockBody in emit-control-flow.ts) was string-naive and
// split `@msg = "write failed; rolled back"` mid-string into
// `_scrml_reactive_set("msg", "write failed)` + orphaned `rolled back";`
// (invalid JS at compile-exit-0). The splitter is now string-literal-aware
// across double-quote, single-quote, and template-literal spans.
// ---------------------------------------------------------------------------

describe("C5 (R27): `;` inside a string literal in an `!{}` arm body", () => {
  function compileSrc(src, baseName) {
    const tmp = join(tmpdir(), `scrml-r27-c5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const srcFile = join(tmp, `${baseName}.scrml`);
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });
    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    const clientJs = readFileSync(join(outDir, `${baseName}.client.js`), "utf8");
    return { result, clientJs, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
  }

  test("double-quoted string with embedded `;` — value preserved, JS valid", () => {
    const src = [
      "<program>",
      "${",
      "  type E:enum = { Bad }",
      '  <msg> = ""',
      "  server function risky() ! E { fail E::Bad }",
      "  function g() {",
      "    risky() !{",
      '      | ::Bad -> { @msg = "write failed; rolled back"; return }',
      "    }",
      "  }",
      "}",
      "<button onclick=g()>go</button>",
      "<p>${@msg}</p>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "c5-double");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).toContain('_scrml_reactive_set("msg", "write failed; rolled back")');
    expect(clientJs).not.toContain('"write failed)');
    expect(() => new Function(clientJs.replace(/^import .*$/gm, ""))).not.toThrow();
    cleanup();
  });

  test("single-quote + template-literal strings with embedded `;` — preserved, multi-stmt split intact", () => {
    const src = [
      "<program>",
      "${",
      "  type E:enum = { Bad }",
      '  <msg> = ""',
      '  <other> = ""',
      '  <tpl> = ""',
      "  server function risky() ! E { fail E::Bad }",
      "  function g() {",
      "    risky() !{",
      "      | ::Bad -> { @msg = 'single; quoted; semis'; @other = \"double; quote\"; @tpl = `templ; with; semi`; return }",
      "    }",
      "  }",
      "}",
      "<button onclick=g()>go</button>",
      "<p>${@msg}</p><p>${@other}</p><p>${@tpl}</p>",
      "</program>",
    ].join("\n");
    const { result, clientJs, cleanup } = compileSrc(src, "c5-multi");
    expect(result.errors).toHaveLength(0);
    expect(clientJs).toContain("single; quoted; semis");
    expect(clientJs).toContain("double; quote");
    expect(clientJs).toContain("templ; with; semi");
    const setCount = (clientJs.match(/_scrml_reactive_set\("(?:msg|other|tpl)"/g) || []).length;
    expect(setCount).toBeGreaterThanOrEqual(3);
    cleanup();
  });
});
