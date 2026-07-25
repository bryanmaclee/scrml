/**
 * error-handler-terminator-arms.test.js
 *
 * Regression test for R24-BUG-2 (known-gaps Bug 29 / S136) — `!{}` error
 * handler arm bodies that end with a JS terminator (`return`, `throw`,
 * `break`, `continue`) must NOT be wrapped by the `_result = ...` assignment.
 *
 * Bug: when the arm body is `{ return }` (or any other terminator-ending
 * body), the codegen previously emitted invalid JS like
 *   _scrml_result_46 = return;
 * which fails `node --check` with `SyntaxError: Unexpected token 'return'`.
 *
 * Fix: emit-logic.ts:emitArmAssign now detects terminator-tail bodies and
 * emits each top-level statement as-is (no wrap). For `return`, this exits
 * the enclosing function — the canonical early-return-on-error idiom from
 * PRIMER §6 / SPEC §19.4.
 *
 * Coverage matrix (per dispatch brief step 3):
 *   §1  Single-arm handler with `{ return }` body
 *   §2  Multi-arm handler with all arms terminating (R24 reproducer shape)
 *   §3  Mixed handler — some arms terminating, some producing values
 *   §4  Terminator: `throw new Error("x")`
 *   §5  Terminator: `break`
 *   §6  Terminator: `continue`
 *   §7  Mid-body conditional early-return — value-producing tail (wrap stays)
 *   §8  Negative-control — value-producing arm still emits `_result = expr;`
 *   §9  Side-effect + terminal `return` — both stmts execute before exit
 *   §10 End-to-end via compileScrml — R24 reproducer pattern; node --check passes
 *   §11 End-to-end via compileScrml — multi-arm all-return handler emits no
 *       `_result = return;` patterns
 */

import { describe, test, expect } from "bun:test";
import { emitLogicNode } from "../../src/codegen/emit-logic.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors emit-logic-s19-error-handling.test.js shape)
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
// §1: Single-arm handler with `{ return }` body
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §1: single-arm handler with `{ return }` body", () => {
  test("named arm `{ return }` emits bare `return;` with no `_result = ...` wrap", () => {
    const node = makeGuardedExpr(
      makeBareExpr("createTicket(values)"),
      [makeArm("::Validation", "msg", "{ return }")]
    );
    // S142 gate-tail: the early-return-on-error arm idiom is in-function-only
    // (a top-level `return` is invalid JS — the emit gate catches it).
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    // No `_scrml_result_N = return;` SyntaxError shape
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // The terminator IS emitted
    expect(result).toMatch(/\breturn\s*;/);
  });

  test("named arm `{ return }` keeps the `if (... === \"Variant\")` variant check", () => {
    const node = makeGuardedExpr(
      makeBareExpr("createTicket(values)"),
      [makeArm("::Validation", "msg", "{ return }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain('.variant === "Validation"');
    expect(result).toContain("__scrml_error");
  });

  test("wildcard arm `{ return }` emits bare `return;` with no `_result = ...` wrap", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "{ return }")]
    );
    // S142 gate-tail: in-function early-return idiom — insideFunctionBody:true.
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    expect(result).toMatch(/\breturn\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §2: Multi-arm handler with all arms terminating (R24 reproducer shape)
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §2: multi-arm handler — all arms `{ return }`", () => {
  test("three terminating arms — no `_result = return;` anywhere", () => {
    const node = makeGuardedExpr(
      makeBareExpr("updateStatus(ticketId, newStatus)"),
      [
        makeArm("::NotFound", null, "{ return }"),
        makeArm("::IllegalTransition", "data", "{ return }"),
        makeArm("::DbWrite", "msg", "{ return }"),
      ]
    );
    // S142 gate-tail: in-function early-return idiom — insideFunctionBody:true.
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // All three `return;` statements present
    const returnCount = (result.match(/^\s*return\s*;/gm) || []).length;
    // 3 arm bodies + 1 propagate `else { return resultVar; }` = 4 returns total
    expect(returnCount).toBeGreaterThanOrEqual(3);
  });

  test("three terminating arms — variant guards still emitted for each arm", () => {
    const node = makeGuardedExpr(
      makeBareExpr("updateStatus(ticketId, newStatus)"),
      [
        makeArm("::NotFound", null, "{ return }"),
        makeArm("::IllegalTransition", "data", "{ return }"),
        makeArm("::DbWrite", "msg", "{ return }"),
      ]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toContain('.variant === "NotFound"');
    expect(result).toContain('.variant === "IllegalTransition"');
    expect(result).toContain('.variant === "DbWrite"');
  });
});

// ---------------------------------------------------------------------------
// §3: Mixed handler — some arms terminating, some producing values
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §3: mixed handler — terminating + value-producing arms", () => {
  test("terminating arm emits bare terminator; value arm emits `_result = expr;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchData()"),
      [
        makeArm("::NetworkError", "e", "{ return }"),
        makeArm("::ValidationError", "e", '{ "fallback" }'),
      ]
    );
    // S142 gate-tail: in-function (arm 1's bare `return`) — insideFunctionBody:true.
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    // No `_result = return;`
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // Value-producing arm DOES get the wrap
    expect(result).toMatch(/_scrml_\w+\s*=\s*"fallback";/);
    // Terminating arm gets a bare return
    expect(result).toMatch(/\breturn\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §4: Terminator — `throw new Error("x")`
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §4: arm body ending with `throw`", () => {
  test("`{ throw err }` emits bare throw, no `_result = throw err;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "err", "{ throw err }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*throw\b/);
    expect(result).toMatch(/\bthrow\s+err\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §5: Terminator — `break`
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §5: arm body ending with `break`", () => {
  test("`{ break }` emits bare `break;`, no `_result = break;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("processItem()"),
      [makeArm("_", "e", "{ break }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*break\s*;/);
    expect(result).toMatch(/\bbreak\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §6: Terminator — `continue`
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §6: arm body ending with `continue`", () => {
  test("`{ continue }` emits bare `continue;`, no `_result = continue;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("processItem()"),
      [makeArm("_", "e", "{ continue }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*continue\s*;/);
    expect(result).toMatch(/\bcontinue\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §7: Mixed multi-statement bodies (no terminator) — UPDATED for R25-Bug-38
//
// PRE-R25-Bug-38 (pre-S136-R25): the §7 expectations asserted that any non-
// terminator-tail single-line body kept the `_result = <bare>;` wrap. That
// shape was the R25-Bug-38 BUG — multi-stmt reactive-write bodies emitted as
// `_result = _scrml_reactive_set("x", "v"); _scrml_reactive_set("y", 0);`,
// a corrupt shape where the first reactive_set's return-value bound to
// _result (a meaningless side-effect discard) and the second emitted as a
// bare statement (semantically correct only by accident).
//
// POST-R25-Bug-38: arm bodies with MORE THAN ONE top-level statement emit
// each statement as a bare stmt (no `_result =` wrap). Single-statement
// bodies whose statement is a known side-effect call (reactive write, engine
// write, navigate, effect/cleanup register, init-set) ALSO emit as bare
// stmts. Single-statement value-producing bodies (`"fallback"` /
// `computeFallback(e)`) STILL wrap — see §8 negative-control.
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §7: mixed multi-statement bodies — R25-Bug-38 emit-as-statements", () => {
  test("`{ helper(); @x = 5 }` — multi-stmt body emits both as bare statements (no wrap)", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "{ helper(); @x = 5 }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    // The arm body has > 1 top-level statement → each emits as a bare stmt.
    // The R25-Bug-38 corrupt wrap (`_result = helper(); _scrml_reactive_set(...);`)
    // must NOT appear. We assert the LACK of a wrap matching the arm body shape
    // (`_result = helper();` or `_result = _scrml_reactive_set("x", 5);`).
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*helper\(\)\s*;/);
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", 5\)/);
    // Both statements emit as bare side-effects.
    expect(result).toContain("helper();");
    expect(result).toContain('_scrml_reactive_set("x", 5)');
  });

  test("`{ @x = 99 }` — single-stmt reactive write emits as bare stmt (no wrap)", () => {
    // R25-Bug-38: a SINGLE reactive-write stmt is statement-shaped, NOT a
    // value to bind to _result. The canonical adopter shape `| .V -> @x = 1`
    // (no braces, single side-effect) routes through the same emitArmAssign
    // path; the wrap was the bug.
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "{ @x = 99 }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).not.toMatch(/_scrml_\w+_\d+\s*=\s*_scrml_reactive_set\("x", 99\)/);
    expect(result).toContain('_scrml_reactive_set("x", 99)');
  });
});

// ---------------------------------------------------------------------------
// §8: Negative-control — value-producing arm still emits `_result = expr;`
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §8: negative-control — value arm wrap preserved", () => {
  test("`{ \"fallback\" }` arm emits `_result = \"fallback\";`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", '{ "fallback" }')]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*"fallback"\s*;/);
  });

  test("`{ computeFallback(e) }` arm emits `_result = computeFallback(e);`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "{ computeFallback(e) }")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*computeFallback\(e\)\s*;/);
  });

  test("bareword (no braces) arm still emits `_result = expr;`", () => {
    const node = makeGuardedExpr(
      makeBareExpr("riskyOp()"),
      [makeArm("_", "e", "fallback(e)")]
    );
    const result = resetAndRun(() => emitLogicNode(node));
    expect(result).toMatch(/_scrml_\w+\s*=\s*fallback\(e\)\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §9: Side-effect + terminal `return` — both stmts execute before exit
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §9: side-effect + terminal `return` — both emit as stmts", () => {
  test("`{ @phase = .Error(msg); return }` emits reactive_set THEN return — no wrap", () => {
    const node = makeGuardedExpr(
      makeBareExpr("fetchItems()"),
      [makeArm("::Network", "msg", "{ @phase = .Error(msg); return }")]
    );
    // S142 gate-tail: in-function (terminal `return`) — insideFunctionBody:true.
    const result = resetAndRun(() => emitLogicNode(node, { boundary: "client", insideFunctionBody: true }));
    // No `_result = ...` wrap on the terminator
    expect(result).not.toMatch(/_scrml_\w+\s*=\s*[^;]*return\s*;/);
    // The reactive set IS emitted
    expect(result).toContain("_scrml_reactive_set");
    expect(result).toContain('"phase"');
    // The terminator IS emitted
    expect(result).toMatch(/\breturn\s*;/);
    // Side-effect MUST come BEFORE the return
    const setIdx = result.indexOf("_scrml_reactive_set");
    const retIdx = result.lastIndexOf("return");
    expect(setIdx).toBeGreaterThan(0);
    expect(retIdx).toBeGreaterThan(setIdx);
  });
});

// ---------------------------------------------------------------------------
// §10-§11: End-to-end via compileScrml
// ---------------------------------------------------------------------------

describe("R24-BUG-2 §10: end-to-end — R24 reproducer compiles to valid JS at the handler site", () => {
  test("multi-arm handler with `{ return }` arms — no `_result = return;` in emitted client.js", () => {
    const tmp = join(tmpdir(), `scrml-r24-bug-2-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type MoveError:enum = {",
      "    NotFound",
      "    IllegalTransition(data: string)",
      "    DbWrite(msg: string)",
      "  }",
      "  @tickets = []",
      "  server function updateStatus(id, status)! -> MoveError {",
      "    lift \"ok\"",
      "  }",
      "  server function loadTickets() {",
      "    lift []",
      "  }",
      "  function moveTo(ticketId, newStatus) {",
      "    updateStatus(ticketId, newStatus) !{",
      "      | ::NotFound -> { return }",
      "      | ::IllegalTransition data -> { return }",
      "      | ::DbWrite msg -> { return }",
      "    }",
      "    @tickets = loadTickets()",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r24-bug-2.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "r24-bug-2.client.js"), "utf8")));
    // The exact bug shape from R24 — must not appear
    expect(clientJs).not.toMatch(/_scrml_\w+\s*=\s*return\s*;/);
    // All three variant arms must still fire bare `return;`
    expect(clientJs).toContain('.variant === "NotFound"');
    expect(clientJs).toContain('.variant === "IllegalTransition"');
    expect(clientJs).toContain('.variant === "DbWrite"');

    rmSync(tmp, { recursive: true, force: true });
  });

  test("emitted handler function — `node`-parseable at the moveTo() function boundaries", () => {
    const tmp = join(tmpdir(), `scrml-r24-bug-2-parse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type MoveError:enum = { NotFound, DbWrite(msg: string) }",
      "  @count = 0",
      "  server function tryMove()! -> MoveError { lift \"ok\" }",
      "  function attempt() {",
      "    tryMove() !{",
      "      | ::NotFound -> { return }",
      "      | ::DbWrite msg -> { return }",
      "    }",
      "    @count = @count + 1",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r24-bug-2-parse.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "r24-bug-2-parse.client.js"), "utf8")));
    // Extract just the `_scrml_attempt_N(...)` function — slicing the file
    // avoids fighting unrelated R24 bugs elsewhere in the output. We assert
    // the slice is parseable by `new Function`. Use depth-tracked brace
    // matching because the function body contains nested `if`-arm blocks.
    // S138 Bug 9 L1 — accept optional `async` prefix since the function
    // now correctly emits as `async function` (calls tryMove server fn).
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

describe("R24-BUG-2 §11: end-to-end — side-effect + terminal return arm", () => {
  test("`{ @phase = msg; return }` — reactive_set fires, then return, no wrap", () => {
    const tmp = join(tmpdir(), `scrml-r24-bug-2-side-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmp, { recursive: true });
    const src = [
      "<program>",
      "${",
      "  type LoadError:enum = { Network(msg: string), Empty }",
      "  @phase = \"\"",
      "  server function fetchItems()! -> LoadError { lift [] }",
      "  function load() {",
      "    const rows = fetchItems() !{",
      "      | ::Network msg -> { @phase = msg; return }",
      "      | ::Empty -> { @phase = \"empty\"; return }",
      "    }",
      "    @phase = \"loaded\"",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "r24-bug-2-side.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "r24-bug-2-side.client.js"), "utf8")));
    // No invalid wrap
    expect(clientJs).not.toMatch(/_scrml_\w+\s*=\s*[^;]*return\s*;/);
    // Reactive sets for .phase fire
    expect(clientJs).toContain('_scrml_reactive_set("phase"');
    // Bare `return;` in both arms
    const retCount = (clientJs.match(/^\s+return\s*;/gm) || []).length;
    expect(retCount).toBeGreaterThanOrEqual(2);

    rmSync(tmp, { recursive: true, force: true });
  });
});
