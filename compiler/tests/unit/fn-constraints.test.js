/**
 * §48 `fn` Body Prohibition Checks — Layer 1
 *
 * Tests for the five classes of operations prohibited inside a `fn` body,
 * verified at the TS stage (Stage 6, type-system.ts).
 *
 * Error codes covered:
 *   E-FN-001  ?{} SQL access inside fn body
 *   E-FN-002  DOM mutation call inside fn body
 *   E-FN-004  Non-deterministic call inside fn body
 *   E-FN-005  async fn declaration or await inside fn body
 *
 * Invariants verified:
 *   - `function` (fnKind !== "fn") does NOT trigger any E-FN-* errors
 *   - Clean `fn` bodies with no violations produce no E-FN-* errors
 *   - Nested non-fn function decls inside fn bodies are NOT flagged via parent check
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { runTS } from "../../src/type-system.js";
// §8b S133 fix tests — end-to-end compileScrml path (markup false-positive regression)
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSpan(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Build a minimal FileAST for use with runTS.
 * Wraps nodes in a top-level logic block (the normal scrml structure).
 */
function makeFile(nodes, filePath = "/test/app.scrml") {
  return {
    filePath,
    nodes: [
      {
        id: 1,
        kind: "logic",
        body: nodes,
        span: mkSpan(0),
      },
    ],
    typeDecls: [],
    imports: [],
    exports: [],
    components: [],
    spans: {},
  };
}

/**
 * Build a function-decl node with fnKind "fn" (the constrained form).
 */
function makeFnDecl(name, body, opts = {}) {
  return {
    id: opts.id ?? 100,
    kind: "function-decl",
    name,
    params: opts.params ?? [],
    body,
    fnKind: "fn",
    isServer: opts.isServer ?? false,
    isAsync: opts.isAsync ?? false,
    ...(opts.isPure ? { isPure: true } : {}),
    canFail: opts.canFail ?? false,
    span: mkSpan(10),
  };
}

/**
 * Build a function-decl node with fnKind "function" (the unconstrained form).
 */
function makeFunctionDecl(name, body, opts = {}) {
  return {
    id: opts.id ?? 200,
    kind: "function-decl",
    name,
    params: opts.params ?? [],
    body,
    fnKind: "function",
    isServer: opts.isServer ?? false,
    isAsync: opts.isAsync ?? false,
    canFail: opts.canFail ?? false,
    span: mkSpan(20),
  };
}

/**
 * Run runTS and return only fn-boundary errors: E-FN-*, W-FN-*, and
 * E-STATE-COMPLETE (formerly E-FN-006; universalized per §54.6.1 S32 amendment
 * but still reached via the fn-body walker as of Phase 1a).
 */
function getFnErrors(nodes, filePath) {
  const file = makeFile(nodes, filePath);
  const { errors } = runTS({ files: [file] });
  return errors.filter(e =>
    e.code.startsWith("E-FN-") ||
    e.code.startsWith("W-FN-") ||
    e.code === "E-STATE-COMPLETE" ||
    e.code === "W-PURE-DEPRECATED"
  );
}

// ---------------------------------------------------------------------------
// §1  Clean fn — no violations
// ---------------------------------------------------------------------------

describe("§1: clean fn body — no E-FN-* errors", () => {
  test("empty fn body produces no E-FN errors", () => {
    const fnDecl = makeFnDecl("buildEmpty", []);
    const errors = getFnErrors([fnDecl]);
    expect(errors).toHaveLength(0);
  });

  test("fn body with let decl and return produces no E-FN errors", () => {
    const fnDecl = makeFnDecl("buildSimple", [
      { id: 101, kind: "let-decl", name: "x", value: "42", span: mkSpan(15) },
      { id: 102, kind: "return-stmt", value: "x", span: mkSpan(20) },
    ]);
    const errors = getFnErrors([fnDecl]);
    expect(errors).toHaveLength(0);
  });

  test("fn body calling another fn (no text of prohibited patterns) produces no errors", () => {
    const fnDecl = makeFnDecl("buildUser", [
      { id: 101, kind: "expression", value: "buildAddress(city, country)", span: mkSpan(15) },
    ]);
    const errors = getFnErrors([fnDecl]);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2  E-FN-001 — SQL access inside fn body
// ---------------------------------------------------------------------------

describe("§2: E-FN-001 — SQL access inside fn", () => {
  test("sql node inside fn body triggers E-FN-001", () => {
    const sqlNode = {
      id: 101,
      kind: "sql",
      raw: "SELECT * FROM users WHERE id = $id",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildProfile", [sqlNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-001")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-001");
    expect(err.message).toContain("fn buildProfile");
    expect(err.message).toContain("?{}");
    expect(err.message).toContain("pure function");
  });

  test("sql node inside function (not fn) does NOT trigger E-FN-001", () => {
    const sqlNode = {
      id: 201,
      kind: "sql",
      raw: "SELECT * FROM users WHERE id = $id",
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("loadProfile", [sqlNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-001")).toBe(false);
  });

  test("sql node nested inside an if-stmt inside fn body triggers E-FN-001", () => {
    const sqlNode = {
      id: 102,
      kind: "sql",
      raw: "SELECT count FROM logs",
      span: mkSpan(35),
    };
    const ifStmt = {
      id: 101,
      kind: "if-stmt",
      condition: "flag",
      then: [sqlNode],
      else: [],
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildWithSql", [ifStmt]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-001")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3  E-FN-002 — DOM mutation inside fn body
// ---------------------------------------------------------------------------

describe("§3: E-FN-002 — DOM mutation inside fn", () => {
  test("document.createElement in expression triggers E-FN-002", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: 'let el = document.createElement("div")',
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildWidget", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-002");
    expect(err.message).toContain("document.createElement");
  });

  test("document.getElementById in expression triggers E-FN-002", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: 'const el = document.getElementById("root")',
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildRef", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
  });

  test(".appendChild in expression triggers E-FN-002", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "container.appendChild(child)",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildTree", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
  });

  test(".setAttribute in expression triggers E-FN-002", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: 'el.setAttribute("class", "active")',
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildStyled", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
  });

  test("DOM mutation in function (not fn) does NOT trigger E-FN-002", () => {
    const expr = {
      id: 201,
      kind: "expression",
      value: 'document.createElement("div")',
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("buildDomHelper", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(false);
  });

  test("innerHTML assignment triggers E-FN-002", () => {
    const expr = {
      id: 101,
      kind: "let-decl",
      name: "html",
      value: 'wrapper.innerHTML = "<span>test</span>"',
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildHtml", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4  E-FN-004 — Non-deterministic calls inside fn body
// ---------------------------------------------------------------------------

describe("§4: E-FN-004 — non-deterministic calls inside fn", () => {
  test("Math.random() in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "let r = Math.random()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildRandom", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-004");
    expect(err.message).toContain("Math.random");
    expect(err.message).toContain("non-deterministic");
  });

  test("Date.now() in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "const ts = Date.now()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildTimestamp", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-004");
    expect(err.message).toContain("Date.now");
  });

  test("crypto.randomUUID() in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "const id = crypto.randomUUID()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildSession", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-004");
    expect(err.message).toContain("crypto.randomUUID");
  });

  test("crypto.getRandomValues() in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "crypto.getRandomValues(buffer)",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildKey", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("performance.now() in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "const t = performance.now()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildTimer", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("new Date in expression triggers E-FN-004", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "const d = new Date()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildDate", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-004");
    expect(err.message).toContain("new Date");
  });

  test("non-deterministic call in function (not fn) does NOT trigger E-FN-004", () => {
    const expr = {
      id: 201,
      kind: "expression",
      value: "const id = crypto.randomUUID()",
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("generateId", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("non-deterministic call nested inside for-loop inside fn triggers E-FN-004", () => {
    const expr = {
      id: 102,
      kind: "expression",
      value: "ids.push(crypto.randomUUID())",
      span: mkSpan(40),
    };
    const forLoop = {
      id: 101,
      kind: "for-loop",
      body: [expr],
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildIdList", [forLoop]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4b  E-FN-004 — mutable browser/global-state READS inside fn body
//      (GitHub #17 — rjantz3 v0.7.0). A `fn` reading window.location /
//      document.cookie / navigator.* / window.innerWidth etc. is
//      non-deterministic and must fire E-FN-004; a string-arg parse, a
//      shadowed root, and the scrml:math surface must STAY pure.
// ---------------------------------------------------------------------------

describe("§4b: E-FN-004 — mutable browser/global-state reads inside fn", () => {
  test("window.location.search read triggers E-FN-004 (the issue's repro)", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: 'const v = parseInt(new URLSearchParams(window.location.search).get("n"), 10)',
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("getN", [expr]);
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-004");
    expect(err.message).toContain("window.location");
    expect(err.message).toContain("mutable browser/global state");
  });

  test("document.cookie read triggers E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: "const c = document.cookie", span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("readCookie", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
    expect(errors.find(e => e.code === "E-FN-004").message).toContain("document.cookie");
  });

  test("navigator.userAgent read triggers E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: "const a = navigator.userAgent", span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("ua", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("window.innerWidth read triggers E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: "const w = window.innerWidth", span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("vw", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("bare location.search read (window-aliased global) triggers E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: "const s = location.search", span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("qs", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("localStorage read triggers E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: 'const t = localStorage.getItem("k")', span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("readLS", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  // --- MUST-NOT-FIRE (adversarial; over-firing on pure code is the danger) ---

  test("the same window.location read in a `function` (not fn) does NOT fire E-FN-004", () => {
    const expr = { id: 201, kind: "expression", value: "const s = window.location.search", span: mkSpan(30) };
    const errors = getFnErrors([makeFunctionDecl("getN", [expr])]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("a user-shadowed `location` parameter does NOT fire (binding-aware)", () => {
    const expr = { id: 101, kind: "expression", value: "const x = location.value", span: mkSpan(30) };
    const fnDecl = makeFnDecl("pick", [expr], { params: [{ name: "location" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("a user-shadowed local `location` const does NOT fire (binding-aware)", () => {
    const decl = { id: 101, kind: "const-decl", name: "location", value: "s", span: mkSpan(30) };
    const expr = { id: 102, kind: "expression", value: "const x = location.value", span: mkSpan(40) };
    const fnDecl = makeFnDecl("pick2", [decl, expr], { params: [{ name: "s" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("URLSearchParams over a STRING ARGUMENT stays pure (no E-FN-004)", () => {
    const expr = { id: 101, kind: "expression", value: 'const v = new URLSearchParams(s).get("n")', span: mkSpan(30) };
    const fnDecl = makeFnDecl("parseN", [expr], { params: [{ name: "s" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("member access of something else (`foo.window`) does NOT fire", () => {
    const expr = { id: 101, kind: "expression", value: "const x = foo.window", span: mkSpan(30) };
    const fnDecl = makeFnDecl("g", [expr], { params: [{ name: "foo" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("identifier with a global substring (`myLocation.x`) does NOT fire (word boundary)", () => {
    const expr = { id: 101, kind: "expression", value: "const x = myLocation.x", span: mkSpan(30) };
    const fnDecl = makeFnDecl("g2", [expr], { params: [{ name: "myLocation" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("document DOM-node op (`document.querySelector`) is E-FN-002 only — no double E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: 'const el = document.querySelector("div")', span: mkSpan(30) };
    const errors = getFnErrors([makeFnDecl("q", [expr])]);
    expect(errors.some(e => e.code === "E-FN-002")).toBe(true);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });

  test("Math.max (scrml:math pure surface) does NOT fire E-FN-004", () => {
    const expr = { id: 101, kind: "expression", value: "const m = Math.max(a, b)", span: mkSpan(30) };
    const fnDecl = makeFnDecl("biggest", [expr], { params: [{ name: "a" }, { name: "b" }] });
    const errors = getFnErrors([fnDecl]);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5  E-FN-005 — async/await inside fn body
// ---------------------------------------------------------------------------

describe("§5: E-FN-005 — async/await inside fn", () => {
  test("isAsync: true on fn declaration triggers E-FN-005", () => {
    const fnDecl = makeFnDecl("buildProfile", [], { isAsync: true });
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-005");
    expect(err.message).toContain("async");
    expect(err.message).toContain("synchronous");
  });

  test("await-expr node in fn body triggers E-FN-005", () => {
    const awaitNode = {
      id: 101,
      kind: "await-expr",
      value: "fetchData(id)",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildProfile", [awaitNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-005");
    expect(err.message).toContain("await");
  });

  test("node with await:true in fn body triggers E-FN-005", () => {
    const awaitNode = {
      id: 101,
      kind: "expression",
      await: true,
      value: "fetchData(id)",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildProfile", [awaitNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(true);
  });

  test("async:true on fn declaration triggers E-FN-005", () => {
    const fnDecl = {
      id: 100,
      kind: "function-decl",
      name: "buildAsync",
      params: [],
      body: [],
      fnKind: "fn",
      isServer: false,
      async: true,  // alternate field name
      canFail: false,
      span: mkSpan(10),
    };
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(true);
  });

  test("isAsync: true on function (not fn) does NOT trigger E-FN-005", () => {
    const fnDecl = makeFunctionDecl("loadData", [], { isAsync: true });
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(false);
  });

  test("await-expr in function (not fn) does NOT trigger E-FN-005", () => {
    const awaitNode = {
      id: 201,
      kind: "await-expr",
      value: "fetch(url)",
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("loadData", [awaitNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-005")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6  Multiple violations — all errors reported
// ---------------------------------------------------------------------------

describe("§6: multiple violations in one fn", () => {
  test("fn with both SQL and Math.random reports both E-FN-001 and E-FN-004", () => {
    const sqlNode = {
      id: 101,
      kind: "sql",
      raw: "SELECT * FROM users",
      span: mkSpan(20),
    };
    const randExpr = {
      id: 102,
      kind: "expression",
      value: "let r = Math.random()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildComplex", [sqlNode, randExpr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-001")).toBe(true);
    expect(errors.some(e => e.code === "E-FN-004")).toBe(true);
  });

  test("async fn with await inside body — two E-FN-005 errors (one for decl, one for await)", () => {
    const awaitNode = {
      id: 101,
      kind: "await-expr",
      value: "fetch(url)",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildAsync", [awaitNode], { isAsync: true });
    const errors = getFnErrors([fnDecl]);

    const fn005Errors = errors.filter(e => e.code === "E-FN-005");
    // One for the async declaration, one for the await expression
    expect(fn005Errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §7  Nested fn inside fn — inner fn not checked via parent's walkBody
// ---------------------------------------------------------------------------

describe("§7: nested fn inside fn — inner fn has own check", () => {
  test("sql inside inner fn (nested in outer fn) fires on inner fn, not outer", () => {
    const sqlNode = {
      id: 102,
      kind: "sql",
      raw: "SELECT * FROM users",
      span: mkSpan(40),
    };
    // Inner fn-decl — the walkBody should stop recursing here
    const innerFn = {
      id: 101,
      kind: "function-decl",
      name: "innerHelper",
      params: [],
      body: [sqlNode],
      fnKind: "fn",
      isServer: false,
      isAsync: false,
      span: mkSpan(30),
    };
    const outerFn = makeFnDecl("buildOuter", [innerFn]);
    const errors = getFnErrors([outerFn]);

    // E-FN-001 should be reported (the inner fn is also fnKind="fn" and gets checked separately)
    // The outer fn's walkBody does NOT recurse into the inner function-decl
    // but the inner fn itself gets checked when visitNode processes it
    // So we expect at least one E-FN-001 total
    expect(errors.some(e => e.code === "E-FN-001")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8  E-FN-003 — Outer-Scope Variable Mutation
// ---------------------------------------------------------------------------

describe("§8: E-FN-003 — outer-scope variable mutation inside fn", () => {
  /**
   * Build a mkSpan with a specific line number for assertions.
   */
  function mkSpanLine(start, line, file = "/test/app.scrml") {
    return { file, start, end: start + 10, line, col: start + 1 };
  }

  test("assignment node targeting outer-scope variable triggers E-FN-003", () => {
    // `counter` is NOT a param or local decl — it lives in outer scope
    const assignNode = {
      id: 101,
      kind: "assignment",
      target: "counter",
      value: "counter + 1",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildItem", [assignNode], { params: ["name"] });
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-003");
    expect(err.message).toContain("counter");
    expect(err.message).toContain("fn buildItem");
    expect(err.message).toContain("outside the `fn` boundary");
  });

  test("assignment to a param (local) does NOT trigger E-FN-003", () => {
    // `name` is a param — it's local to the fn
    const assignNode = {
      id: 101,
      kind: "assignment",
      target: "name",
      value: "name.trim()",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildItem", [assignNode], { params: ["name"] });
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(false);
  });

  test("assignment to a locally declared let variable does NOT trigger E-FN-003", () => {
    const letDecl = {
      id: 101,
      kind: "let-decl",
      name: "localVar",
      value: "0",
      span: mkSpan(20),
    };
    const assignNode = {
      id: 102,
      kind: "assignment",
      target: "localVar",
      value: "localVar + 1",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildItem", [letDecl, assignNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(false);
  });

  test("expression text with outer-scope assignment pattern triggers E-FN-003", () => {
    // `outerCounter = outerCounter + 1` — outerCounter is not declared locally
    const expr = {
      id: 101,
      kind: "expression",
      value: "outerCounter = outerCounter + 1",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildThing", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-003");
    expect(err.message).toContain("outerCounter");
  });

  test("expression with == (comparison) does NOT trigger E-FN-003", () => {
    // `x == 5` is a comparison, not an assignment
    const expr = {
      id: 101,
      kind: "expression",
      value: "x == 5",
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildCheck", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(false);
  });

  test("outer-scope mutation in function (not fn) does NOT trigger E-FN-003", () => {
    const assignNode = {
      id: 201,
      kind: "assignment",
      target: "globalState",
      value: "newValue",
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("updateState", [assignNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-003")).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// §8b  E-FN-003 — markup-attribute false-positive (S133 fix)
// ---------------------------------------------------------------------------
//
// Bug 12 (queued S132, fixed S133): `${ fn badge(x) { return <span class="b">${x}</span> } }`
// false-fired E-FN-003 because checkOuterScopeMutation's text-heuristic
// (ASSIGN_RE) read attribute serializations like `class="b"` and `href={x}`
// as outer-scope assignments. Broader than first reported — also fires on
// `let m = <span class="c">...` (not just `return`) and on brace-attrs
// (`<a href={x}>`).
//
// Fix: skip the heuristic when the statement's serialized text starts with
// `<` (markup-shaped). Real outer-scope writes inside fn live on their own
// bare-expr / assignment statement and reach checkOuterScopeMutation
// independently — see the negative control below.
//
// These tests exercise the END-TO-END compileScrml path (the §8 tests
// above use synthetic AST nodes and don't exercise the text-heuristic).

describe("§8b: E-FN-003 — markup-attribute false-positive (S133 fix)", () => {
  const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
  let tmpCounter = 0;

  function compileWholeScrml(source, testName = `s133-efn003-${++tmpCounter}`) {
    const tmpDir = resolve(testDir, `_tmp_${testName}`);
    const tmpInput = resolve(tmpDir, `${testName}.scrml`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpInput, source);
    try {
      const result = compileScrml({
        inputFiles: [tmpInput],
        write: false,
        outputDir: resolve(tmpDir, "out"),
      });
      return {
        errors: result.errors ?? [],
        fnErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-FN")),
      };
    } finally {
      if (existsSync(tmpInput)) rmSync(tmpInput);
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  test("fn returning attributed markup (string attr) does NOT trigger E-FN-003 (S133 fix)", () => {
    const src = `\${
    fn badge(x) {
        return <span class="b">\${x}</span>
    }
}
<p>\${badge("hi")}</>`;
    const { fnErrors } = compileWholeScrml(src, "s133-string-attr");
    const efn003 = fnErrors.filter(e => e.code === "E-FN-003");
    expect(efn003).toHaveLength(0);
  });

  test("let-bound attributed markup inside fn does NOT trigger E-FN-003 (S133 fix)", () => {
    const src = `\${
    fn render(x) {
        let m = <span class="c">\${x}</span>
        return m
    }
}
<p>\${render("hi")}</>`;
    const { fnErrors } = compileWholeScrml(src, "s133-let-decl-markup");
    const efn003 = fnErrors.filter(e => e.code === "E-FN-003");
    expect(efn003).toHaveLength(0);
  });

  test("fn returning markup with brace-attribute does NOT trigger E-FN-003 (S133 fix)", () => {
    const src = `\${
    fn link(x) {
        return <a href={x}>click</a>
    }
}
<p>\${link("/home")}</>`;
    const { fnErrors } = compileWholeScrml(src, "s133-brace-attr");
    const efn003 = fnErrors.filter(e => e.code === "E-FN-003");
    expect(efn003).toHaveLength(0);
  });

  test("fn with real outer-scope write alongside attributed markup STILL triggers E-FN-003 (S133 negative control)", () => {
    const src = `\${
    let counter = 0
    fn bump(x) {
        counter = counter + 1
        return <span class="b">\${x}</span>
    }
}
<p>\${bump("hi")}</>`;
    const { fnErrors } = compileWholeScrml(src, "s133-neg-control");
    const efn003 = fnErrors.filter(e => e.code === "E-FN-003");
    // The fix MUST NOT over-suppress purity enforcement. Real writes still fire.
    expect(efn003.length).toBeGreaterThanOrEqual(1);
    // And the fire is on `counter` (the real write), NOT on `class` (the false-positive).
    expect(efn003.some(e => e.message.includes("counter"))).toBe(true);
    expect(efn003.some(e => e.message.includes("`class`"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9  E-STATE-COMPLETE — State literal with unassigned fields (§54.6.1)
//     Amended 2026-04-20 (S32): renamed from E-FN-006; universal scope per §54.
//     Phase 1a: rename + diagnostic-text update only. Phase 1b will widen to
//     `function` bodies (currently still only fires inside `fn`).
// ---------------------------------------------------------------------------

/**
 * Build a state-constructor-def node that, when visited by runTS, registers
 * a user-defined state type in the stateTypeRegistry.
 *
 * This must be placed BEFORE the fn-decl in the logic body so the type is
 * registered before checkFnBodyProhibitions runs.
 */
function makeStateCtorDef(typeName, fieldNames, opts = {}) {
  const typedAttrs = fieldNames.map((name, i) => ({
    id: 200 + i,
    kind: "typed-attr",
    name,
    typeExpr: "string",
    optional: false,
    defaultValue: null,
    span: { file: "/test/app.scrml", start: i * 5, end: i * 5 + 4, line: 1, col: 1 },
  }));
  return {
    id: opts.id ?? 300,
    kind: "state-constructor-def",
    stateType: typeName,
    typedAttrs,
    children: [],
    span: { file: "/test/app.scrml", start: 0, end: 20, line: 1, col: 1 },
  };
}

/**
 * Build a let-decl node representing `let varName = < TypeName>`.
 */
function makeStateInit(varName, typeName, opts = {}) {
  return {
    id: opts.id ?? 400,
    kind: "let-decl",
    name: varName,
    stateType: typeName,  // BPP-structured field indicating state instantiation
    value: `< ${typeName}>`,
    span: opts.span ?? { file: "/test/app.scrml", start: 10, end: 20, line: 2, col: 1 },
  };
}

/**
 * Build an expression node representing `varName.fieldName = value`.
 */
function makeFieldAssign(varName, fieldName, value = "someValue", opts = {}) {
  return {
    id: opts.id ?? 500,
    kind: "expression",
    value: `${varName}.${fieldName} = ${value}`,
    span: opts.span ?? { file: "/test/app.scrml", start: 20, end: 30, line: 3, col: 1 },
  };
}

/**
 * Build a return-stmt node.
 */
function makeReturn(varName, opts = {}) {
  return {
    id: opts.id ?? 600,
    kind: "return-stmt",
    value: varName,
    span: opts.span ?? { file: "/test/app.scrml", start: 40, end: 50, line: 5, col: 1 },
  };
}

/**
 * Run tests with a state-constructor-def registered.
 * The state-ctor-def must precede the fn-decl in the logic body.
 */
function getFnErrorsWithStateDef(stateCtorDefs, fnNodes, filePath = "/test/app.scrml") {
  const allNodes = [...stateCtorDefs, ...fnNodes];
  return getFnErrors(allNodes, filePath);
}

describe("§9: E-STATE-COMPLETE — state literal with unassigned fields (§54.6.1)", () => {
  test("fn returning state instance with all fields assigned — no E-STATE-COMPLETE", () => {
    const stateDef = makeStateCtorDef("User", ["name", "age"]);
    const stateInit = makeStateInit("u", "User");
    const nameAssign = makeFieldAssign("u", "name", '"alice"');
    const ageAssign = makeFieldAssign("u", "age", "30");
    const ret = makeReturn("u");

    const fnDecl = makeFnDecl("buildUser", [stateInit, nameAssign, ageAssign, ret]);
    const errors = getFnErrorsWithStateDef([stateDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-STATE-COMPLETE")).toBe(false);
    // E-FN-006 is retired and SHALL NOT fire (§48.12).
    expect(errors.some(e => e.code === "E-FN-006")).toBe(false);
  });

  test("fn returning state instance with missing field triggers E-STATE-COMPLETE", () => {
    const stateDef = makeStateCtorDef("User", ["name", "age"]);
    const stateInit = makeStateInit("u", "User");
    // Only assigns name, skips age
    const nameAssign = makeFieldAssign("u", "name", '"alice"');
    const ret = makeReturn("u");

    const fnDecl = makeFnDecl("buildUser", [stateInit, nameAssign, ret]);
    const errors = getFnErrorsWithStateDef([stateDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-STATE-COMPLETE")).toBe(true);
    const err = errors.find(e => e.code === "E-STATE-COMPLETE");
    expect(err.message).toContain("age");
    expect(err.message).toContain("User");
    expect(err.message).toContain("`u`");
  });

  test("fn returning state instance with no fields assigned triggers E-STATE-COMPLETE for each field", () => {
    const stateDef = makeStateCtorDef("Product", ["title", "price"]);
    const stateInit = makeStateInit("p", "Product");
    const ret = makeReturn("p");

    const fnDecl = makeFnDecl("buildProduct", [stateInit, ret]);
    const errors = getFnErrorsWithStateDef([stateDef], [fnDecl]);

    const completeErrors = errors.filter(e => e.code === "E-STATE-COMPLETE");
    expect(completeErrors.length).toBeGreaterThanOrEqual(2); // one for title, one for price
  });

  test("E-STATE-COMPLETE fires for `function` bodies too (§54.6.1 universal scope, S32 Phase 1b)", () => {
    // §54.6.1 relocated E-FN-006 → E-STATE-COMPLETE with universal scope.
    // Where the old E-FN-006 only fired inside `fn`, the new rule fires at
    // every state-literal site regardless of containing function form.
    const stateDef = makeStateCtorDef("User", ["name", "age"]);
    const stateInit = makeStateInit("u", "User");
    const nameAssign = makeFieldAssign("u", "name", '"alice"');
    // No age assignment — `function` body, universal check applies
    const ret = makeReturn("u");

    const fnDecl = makeFunctionDecl("buildUser", [stateInit, nameAssign, ret]);
    const errors = getFnErrorsWithStateDef([stateDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-STATE-COMPLETE")).toBe(true);
    const err = errors.find(e => e.code === "E-STATE-COMPLETE");
    expect(err.message).toContain("age");
    expect(err.message).toContain("User");
    expect(err.message).toContain("function buildUser");
  });
});

// ---------------------------------------------------------------------------
// §10  E-FN-007 — Branch Produces Different State Shape
// ---------------------------------------------------------------------------

describe("§10: E-FN-007 — branch produces different state shape", () => {
  test("fn with if/else branches returning same state type — no E-FN-007", () => {
    const userDef = makeStateCtorDef("User", ["name"]);
    const thenBranch = [
      makeStateInit("u", "User", { id: 401 }),
      makeFieldAssign("u", "name", '"alice"', { id: 501 }),
      makeReturn("u", { id: 601 }),
    ];
    const elseBranch = [
      makeStateInit("u2", "User", { id: 402 }),
      makeFieldAssign("u2", "name", '"bob"', { id: 502 }),
      makeReturn("u2", { id: 602 }),
    ];
    const ifStmt = {
      id: 101,
      kind: "if-stmt",
      condition: "kind == \"admin\"",
      then: thenBranch,
      else: elseBranch,
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildUser", [ifStmt]);
    const errors = getFnErrorsWithStateDef([userDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-FN-007")).toBe(false);
  });

  test("fn with if/else returning different state types without union return type triggers E-FN-007", () => {
    const userDef = makeStateCtorDef("User", ["name"]);
    const adminDef = makeStateCtorDef("Admin", ["level"], { id: 301 });

    const thenBranch = [
      makeStateInit("u", "User", { id: 401 }),
      makeFieldAssign("u", "name", '"alice"', { id: 501 }),
      { id: 601, kind: "return-stmt", value: "u", returnType: "User", span: { file: "/test/app.scrml", start: 50, end: 60, line: 5, col: 1 } },
    ];
    const elseBranch = [
      makeStateInit("a", "Admin", { id: 402 }),
      makeFieldAssign("a", "level", "1", { id: 502 }),
      { id: 602, kind: "return-stmt", value: "a", returnType: "Admin", span: { file: "/test/app.scrml", start: 70, end: 80, line: 7, col: 1 } },
    ];
    const ifStmt = {
      id: 101,
      kind: "if-stmt",
      condition: "kind == \"admin\"",
      then: thenBranch,
      else: elseBranch,
      span: mkSpan(30),
    };
    const fnDecl = makeFnDecl("buildEntity", [ifStmt]);
    const errors = getFnErrorsWithStateDef([userDef, adminDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-FN-007")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-007");
    expect(err.message).toContain("fn buildEntity");
    expect(err.message).toContain("User");
    expect(err.message).toContain("Admin");
    expect(err.message).toContain("union return type");
  });

  test("fn with explicit union return type declared — no E-FN-007", () => {
    const userDef = makeStateCtorDef("User", ["name"]);
    const adminDef = makeStateCtorDef("Admin", ["level"], { id: 301 });

    const thenBranch = [
      makeStateInit("u", "User", { id: 401 }),
      { id: 601, kind: "return-stmt", value: "u", returnType: "User", span: { file: "/test/app.scrml", start: 50, end: 60, line: 5, col: 1 } },
    ];
    const elseBranch = [
      makeStateInit("a", "Admin", { id: 402 }),
      { id: 602, kind: "return-stmt", value: "a", returnType: "Admin", span: { file: "/test/app.scrml", start: 70, end: 80, line: 7, col: 1 } },
    ];
    const ifStmt = {
      id: 101,
      kind: "if-stmt",
      condition: "kind",
      then: thenBranch,
      else: elseBranch,
      span: mkSpan(30),
    };
    // Has explicit union returnType on the fn declaration
    const fnDecl = {
      ...makeFnDecl("buildEntity", [ifStmt]),
      returnType: "User | Admin",
    };
    const errors = getFnErrorsWithStateDef([userDef, adminDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-FN-007")).toBe(false);
  });

  test("E-FN-007 not triggered for function (not fn)", () => {
    const userDef = makeStateCtorDef("User", ["name"]);
    const adminDef = makeStateCtorDef("Admin", ["level"], { id: 301 });

    const thenBranch = [
      { id: 601, kind: "return-stmt", value: "u", returnType: "User", span: mkSpan(50) },
    ];
    const elseBranch = [
      { id: 602, kind: "return-stmt", value: "a", returnType: "Admin", span: mkSpan(70) },
    ];
    const ifStmt = {
      id: 101,
      kind: "if-stmt",
      condition: "kind",
      then: thenBranch,
      else: elseBranch,
      span: mkSpan(30),
    };
    const fnDecl = makeFunctionDecl("buildEntity", [ifStmt]);
    const errors = getFnErrorsWithStateDef([userDef, adminDef], [fnDecl]);

    expect(errors.some(e => e.code === "E-FN-007")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §11  E-FN-008 — lift Targeting Outer Scope
// ---------------------------------------------------------------------------

describe("§11: E-FN-008 — lift targeting outer scope", () => {
  test("lift inside fn body with fn-local tilde-decl — no E-FN-008", () => {
    // The ~ is initialized inside the fn body itself
    const tildeDecl = {
      id: 101,
      kind: "tilde-decl",
      name: "~",
      span: mkSpan(10),
    };
    const liftNode = {
      id: 102,
      kind: "lift",
      value: "item",
      span: mkSpan(20),
    };
    const fnDecl = makeFnDecl("buildItems", [tildeDecl, liftNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-008")).toBe(false);
  });

  test("lift inside fn body with no fn-local tilde — triggers E-FN-008", () => {
    // No tilde-decl inside the fn body — the ~ must be from outer scope
    const liftNode = {
      id: 101,
      kind: "lift",
      value: "item",
      span: { file: "/test/app.scrml", start: 20, end: 30, line: 3, col: 1 },
    };
    const fnDecl = makeFnDecl("buildItems", [liftNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-008")).toBe(true);
    const err = errors.find(e => e.code === "E-FN-008");
    expect(err.message).toContain("fn buildItems");
    expect(err.message).toContain("lift");
    expect(err.message).toContain("outside the `fn` boundary");
  });

  test("lift-stmt inside fn body with no fn-local tilde — triggers E-FN-008", () => {
    // Alternate AST kind name for lift
    const liftNode = {
      id: 101,
      kind: "lift-stmt",
      value: "item",
      span: mkSpan(20),
    };
    const fnDecl = makeFnDecl("buildList", [liftNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-008")).toBe(true);
  });

  test("fn with no lift — no E-FN-008 even without tilde-decl", () => {
    const expr = {
      id: 101,
      kind: "expression",
      value: "let x = 42",
      span: mkSpan(20),
    };
    const fnDecl = makeFnDecl("buildSimple", [expr]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-008")).toBe(false);
  });

  test("E-FN-008 not triggered for function (not fn)", () => {
    const liftNode = {
      id: 201,
      kind: "lift",
      value: "item",
      span: mkSpan(20),
    };
    const fnDecl = makeFunctionDecl("buildItems", [liftNode]);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "E-FN-008")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12  W-PURE-DEPRECATED — the `pure` modifier is deprecated (§33, §48.11)
//       Ratified 2026-06-09 (deprecate-pure-modifier): `pure` is deprecated
//       language-wide; `fn` is the canonical pure form. Fires on ANY
//       `pure`-modifier declaration (gated on `isPure` alone) — `pure fn`,
//       `pure function`, `pure server function`. SUPERSEDES W-PURE-REDUNDANT
//       (the redundant-pure case is now just deprecated-pure). Warning,
//       not error — mirrors W-DEPRECATED-001 (`<machine>`->`<engine>`).
// ---------------------------------------------------------------------------

describe("§12: W-PURE-DEPRECATED — the `pure` modifier is deprecated", () => {
  test("`pure fn` emits W-PURE-DEPRECATED", () => {
    const fnDecl = makeFnDecl("double", [], { isPure: true });
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "W-PURE-DEPRECATED")).toBe(true);
    const warn = errors.find(e => e.code === "W-PURE-DEPRECATED");
    expect(warn.severity).toBe("warning");
    expect(warn.message).toContain("double");
    expect(warn.message).toContain("deprecated");
  });

  test("`pure function` (fnKind function) ALSO emits W-PURE-DEPRECATED", () => {
    // The deprecation covers every `pure`-modifier form, not just `pure fn`.
    const fnDecl = { ...makeFunctionDecl("double", []), isPure: true };
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "W-PURE-DEPRECATED")).toBe(true);
    const warn = errors.find(e => e.code === "W-PURE-DEPRECATED");
    expect(warn.severity).toBe("warning");
  });

  test("`pure server function` emits W-PURE-DEPRECATED", () => {
    const fnDecl = { ...makeFunctionDecl("fetchRow", []), isPure: true, isServer: true };
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "W-PURE-DEPRECATED")).toBe(true);
  });

  test("plain `fn` (no pure modifier) does NOT emit W-PURE-DEPRECATED", () => {
    const fnDecl = makeFnDecl("double", []);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "W-PURE-DEPRECATED")).toBe(false);
  });

  test("plain `function` (no pure modifier) does NOT emit W-PURE-DEPRECATED", () => {
    const fnDecl = makeFunctionDecl("doStuff", []);
    const errors = getFnErrors([fnDecl]);

    expect(errors.some(e => e.code === "W-PURE-DEPRECATED")).toBe(false);
  });

  test("W-PURE-REDUNDANT is fully superseded — never emitted", () => {
    const fnDecl = makeFnDecl("double", [], { isPure: true });
    const file = makeFile([fnDecl]);
    const { errors } = runTS({ files: [file] });
    expect(errors.some(e => e.code === "W-PURE-REDUNDANT")).toBe(false);
  });
});
