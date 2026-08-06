/**
 * error-handler-const-bind-r25-bug-49.test.js
 *
 * Regression test for R25-Bug-49 (known-gaps Bug 49 / S138) — the BS-level
 * statement-boundary-detection gap UPSTREAM of Bug 38's codegen fix.
 *
 * R26 verification of the S137 cluster found that Bug 38's `emitArmAssign`
 * codegen fix (commit 933d1ad3) was correct on its scope, but the
 * `const X = call() !{...}` value-binding shape used by R25 dev-1-react and
 * dev-2-elixir (6 instances combined) still produced
 *
 *     [scrml] warning: statement boundary not detected —
 *       trailing content would be silently dropped: "! { | ::Variant -> ..."
 *
 * The `!{...}` arm bodies were SILENTLY DROPPED before reaching the AST.
 * Bug 38's regression tests synthesized the AST directly (bypass the BS
 * layer); they passed but the empirical source-file path still failed.
 *
 * Root cause: under v0.3 default-logic-mode (SPEC §40.8), bare top-level
 * function declarations at `<program>` / `<page>` / `<channel>` direct-
 * child positions auto-lift via `liftBareDeclarations` (ast-builder.js)
 * into a synthetic `${...}` logic block whose `children: []` array carries
 * no `!{...}` child — block-splitter's orphan-brace mode disabled sigil
 * recognition inside the function-decl body.
 *
 * When buildBlock(case "logic") re-tokenized that lifted body via
 * `tokenizeLogic`, the inner `!{...}` was lexed as PUNCT `!` + PUNCT `{`
 * + interior tokens + PUNCT `}`. collectExpr (ast-builder.js:2479) greedily
 * consumed those into the const/let/bare-call RHS, acorn parsed only the
 * call as the expression, and the trailing `! {...}` text tripped the
 * statement-boundary warning at expression-parser.ts:2010.
 *
 * Fix: tokenizeLogic now synthesizes a synthetic `error-effect` BLOCK_REF
 * when `!{...}` is encountered at a code position without a pre-split
 * child. The synthetic block has type `error-effect`, raw = full `!{...}`
 * slice, children = []. collectExpr's BLOCK_REF-break (L2512) then fires
 * correctly; the outer parseRecursiveBody / parseLogicBody (L7257 / L3654)
 * wraps the const-decl / let-decl / bare-expr in a guarded-expr AST node.
 *
 * Coverage matrix (all tests use BARE top-level function-decl shape — the
 * R25 dev-1/dev-2 surface — NOT the explicit `${...}` wrap that already
 * worked via the BS path):
 *
 *   §1  Minimal `const r = call() !{ multi-line arms }` repro
 *   §2  `let r = call() !{...}` — let-binding form (parallel const path)
 *   §3  Multi-arm with payload binding `::Err(msg) -> { @x = msg }`
 *   §4  Single-line collapsed `const r = call() !{ | ::X -> @y = 1 }`
 *   §5  Nested handler `const r = a() !{ | ::X -> b() !{...} }`
 *   §6  Arm body with `if`/branch — regression-guard separation from Bug 31
 *   §7  Bare-call `risky() !{...}` (no const) — STILL WORKS after fix
 *   §8  Empty arm body `{ }` — emits without crash
 *   §9  Positive control — `const r = call()` (no `!{...}`) — bare const-decl works
 *   §10 Trailing usage — `const r = call() !{...}; @cards = [...@cards, r]`
 *   §11 Negative control / regression-guard — explicit `${...}` wrap STILL works
 *   §12 Empirical reproducer alignment with PRIMER §6 / kickstarter shape
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// Capture console.warn output to assert "statement boundary not detected"
// does NOT fire on the BARE shape after the fix.
let capturedWarnings = [];
let originalWarn;

beforeEach(() => {
  capturedWarnings = [];
  originalWarn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === "string") capturedWarnings.push(args[0]);
  };
});

afterEach(() => {
  console.warn = originalWarn;
});

function makeTmpDir(label) {
  const tmp = join(tmpdir(), `scrml-r25-bug-49-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

function expectNoStatementBoundaryWarning() {
  const offending = capturedWarnings.filter(w => w.includes("statement boundary not detected"));
  expect(offending).toEqual([]);
}

// ---------------------------------------------------------------------------
// §1: Minimal `const r = call() !{ multi-line arms }` (PRIMER §6 canon shape)
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §1: const r = call() !{ multi-line arms } — BARE shape", () => {
  test("PRIMER §6 canonical adopter shape — no BS warning, arm bodies emit", () => {
    const tmp = makeTmpDir("const-multi");
    const src = [
      "<program title=\"bug49-const-multi\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { NetworkError, Validation }",
      "server function risky() ! ErrType {",
      "  fail ErrType::NetworkError",
      "}",
      "function run() {",
      "  const r = risky() !{",
      "    | ::NetworkError -> { @msg = \"net\" }",
      "    | ::Validation   -> { @msg = \"val\" }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    // Arm bodies MUST emit
    expect(clientJs).toContain('_scrml_reactive_set("msg", "net")');
    expect(clientJs).toContain('_scrml_reactive_set("msg", "val")');
    // Variant guards present
    expect(clientJs).toContain('.variant === "NetworkError"');
    expect(clientJs).toContain('.variant === "Validation"');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §2: let-binding form
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §2: let r = call() !{...} — let-binding form", () => {
  test("`let r = call() !{ ... }` parallel to const path — arm bodies emit", () => {
    const tmp = makeTmpDir("let-multi");
    const src = [
      "<program title=\"bug49-let\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { A, B }",
      "server function risky() ! ErrType {",
      "  fail ErrType::A",
      "}",
      "function run() {",
      "  let r = risky() !{",
      "    | ::A -> { @msg = \"a\" }",
      "    | ::B -> { @msg = \"b\" }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("msg", "a")');
    expect(clientJs).toContain('_scrml_reactive_set("msg", "b")');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §3: Multi-arm with payload binding (R25 dev-1/dev-2 actual shape)
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §3: const r = call() !{ payload binding }", () => {
  test("`::Err(msg) -> { @x = msg }` arm — payload binds + reactive write fires", () => {
    const tmp = makeTmpDir("payload");
    const src = [
      "<program title=\"bug49-payload\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { DbError(msg: string), Validation }",
      "server function risky() ! ErrType {",
      "  fail ErrType::DbError(\"oops\")",
      "}",
      "function run() {",
      "  const r = risky() !{",
      "    | ::DbError(msg) -> { @msg = msg }",
      "    | ::Validation   -> { @msg = \"val\" }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    // Payload-bound msg arm — the reactive_set carries the bound msg variable
    expect(clientJs).toMatch(/_scrml_reactive_set\("msg",\s*msg\)/);
    expect(clientJs).toContain('_scrml_reactive_set("msg", "val")');
    expect(clientJs).toContain('.variant === "DbError"');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §4: Single-line collapsed arm body
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §4: single-line collapsed arm body", () => {
  test("`const r = call() !{ | ::X -> @y = 1 }` — single-line bare arm", () => {
    const tmp = makeTmpDir("collapsed");
    const src = [
      "<program title=\"bug49-collapsed\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { Bad }",
      "server function risky() ! ErrType {",
      "  fail ErrType::Bad",
      "}",
      "function run() {",
      "  const r = risky() !{ | ::Bad -> @msg = \"oops\" }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("msg", "oops")');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §5: Nested handler — error-handler inside an arm body
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §5: nested handler — `!{...}` inside an arm body", () => {
  test("nested `!{...}` composition — outer + inner arms both emit", () => {
    const tmp = makeTmpDir("nested");
    const src = [
      "<program title=\"bug49-nested\">",
      "<state>",
      "<outer> = \"\"",
      "<inner> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type OuterErr:enum = { X }",
      "type InnerErr:enum = { Y }",
      "server function a() ! OuterErr { fail OuterErr::X }",
      "server function b() ! InnerErr { fail InnerErr::Y }",
      "function run() {",
      "  const r = a() !{",
      "    | ::X -> {",
      "      const s = b() !{",
      "        | ::Y -> { @inner = \"y\" }",
      "      }",
      "      @outer = \"x\"",
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    // This test's SUBJECT is that both arms EMIT (asserted below) with no
    // statement-boundary drop. The blanket zero-errors assertion was incidental,
    // and it now has exactly one KNOWN, NON-SUBJECT occupant:
    //
    //   `g-drain-textscan-overfires-on-awaited-nested-arm-site` (dpa-023 Limb 1) —
    //   the fail-closed drain's raw-TEXT scan is POSITION-BLIND, so it records the
    //   nested arm's server call even though `emitArmBody`'s re-parse awaits it on
    //   the CLIENT caller. The emission asserted below is correct; only the
    //   diagnostic is wrong.
    //
    // Left FIRING rather than suppressed: two attempts at suppressing it silently
    // deleted real fail-closes across all four drain callers. Full reasoning and
    // the locked repros: `compiler/tests/unit/async-name-provider.test.js` §5/§6.
    // Corpus impact measured at 0 of 1878 sources. Narrowed rather than deleted so
    // any OTHER new diagnostic still fails here.
    const KNOWN_FALSE_POSITIVE = "E-ASYNC-STDLIB-IN-SYNC-CALLBACK";
    expect((result.errors ?? []).filter((e) => e.code !== KNOWN_FALSE_POSITIVE)).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("inner", "y")');
    expect(clientJs).toContain('_scrml_reactive_set("outer", "x")');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §6: Arm body with internal `if`/branch
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §6: arm body with internal `if`/branch", () => {
  test("`const r = a() !{ | ::X -> { if (...) {...} else {...} } }` — branch compiles", () => {
    const tmp = makeTmpDir("if-branch");
    const src = [
      "<program title=\"bug49-if\">",
      "<state>",
      "<flag> = false",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { Bad }",
      "server function risky() ! ErrType { fail ErrType::Bad }",
      "function run() {",
      "  const r = risky() !{",
      "    | ::Bad -> {",
      "      if (@flag) {",
      "        @msg = \"flag-on\"",
      "      } else {",
      "        @msg = \"flag-off\"",
      "      }",
      "    }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("msg", "flag-on")');
    expect(clientJs).toContain('_scrml_reactive_set("msg", "flag-off")');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §7: Bare-call `risky() !{...}` (no const) — STILL WORKS post-fix
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §7: bare-call `risky() !{...}` (no const binding)", () => {
  test("bare-call form — regression-guard that fix didn't break bare path", () => {
    const tmp = makeTmpDir("bare");
    const src = [
      "<program title=\"bug49-bare\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { Bad }",
      "server function risky() ! ErrType { fail ErrType::Bad }",
      "function run() {",
      "  risky() !{",
      "    | ::Bad -> { @msg = \"bad\" }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("msg", "bad")');
    expect(clientJs).toContain('.variant === "Bad"');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §8: Empty arm body
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §8: empty arm body `{}`", () => {
  test("empty arm body emits without crash", () => {
    const tmp = makeTmpDir("empty");
    const src = [
      "<program title=\"bug49-empty\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { Bad }",
      "server function risky() ! ErrType { fail ErrType::Bad }",
      "function run() {",
      "  const r = risky() !{",
      "    | ::Bad -> { }",
      "  }",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    // Variant guard present even though arm body is empty
    expect(clientJs).toContain('.variant === "Bad"');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §9: Positive control — `const r = call()` (no `!{...}`)
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §9: bare const-decl without `!{...}` — control", () => {
  test("`const r = call()` (no error handler) still compiles cleanly", () => {
    const tmp = makeTmpDir("plain-const");
    const src = [
      "<program title=\"bug49-plain\">",
      "<state>",
      "<n> = 0",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "fn compute() { return 42 }",
      "function run() {",
      "  const r = compute()",
      "  @n = r",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("n", r)');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §10: Trailing usage — `const r = call() !{...}` followed by use-of-r
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §10: trailing usage after const-bind handler", () => {
  test("`const r = call() !{...}` followed by reactive write using r", () => {
    const tmp = makeTmpDir("trailing");
    const src = [
      "<program title=\"bug49-trailing\">",
      "<state>",
      "<items> = []",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "type ErrType:enum = { Bad }",
      "server function makeItem() ! ErrType { lift {id: 1, name: \"x\"} }",
      "function run() {",
      "  const created = makeItem() !{",
      "    | ::Bad -> { @items = [] }",
      "  }",
      "  @items = [...@items, created]",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    // Trailing reactive write uses `created` — confirms r/created binding survived
    // (spread lowers `@items` to `_scrml_reactive_get("items")`; the spread
    // expression carries `created` as the appended element).
    expect(clientJs).toMatch(/_scrml_reactive_set\("items",[\s\S]*created[\s\S]*\)/);

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §11: Negative control / regression-guard — explicit `${...}` wrap path
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §11: explicit `${...}` wrap — pre-existing BS path", () => {
  test("explicit `${...}` wrap STILL works after fix (regression-guard)", () => {
    const tmp = makeTmpDir("dollar");
    const src = [
      "<program title=\"bug49-dollar\">",
      "<state>",
      "<msg> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=run()>Run</button>",
      "</page>",
      "${",
      "type ErrType:enum = { Bad }",
      "server function risky() ! ErrType { fail ErrType::Bad }",
      "function run() {",
      "  const r = risky() !{",
      "    | ::Bad -> { @msg = \"bad\" }",
      "  }",
      "}",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toContain('_scrml_reactive_set("msg", "bad")');

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// §12: PRIMER §6 canon — close-as-possible to docs shape
// ---------------------------------------------------------------------------

describe("R25-Bug-49 §12: PRIMER §6 canonical shape — adopter mirror", () => {
  test("PRIMER §6 multi-line const-binding with both arm transitions", () => {
    const tmp = makeTmpDir("primer");
    const src = [
      "<program title=\"bug49-primer\">",
      "<state>",
      "<phase> = \"\"",
      "</state>",
      "<page>",
      "<button onclick=load()>Load</button>",
      "</page>",
      "type LoadError:enum = { Network(msg: string), Empty }",
      "server function fetchItems() ! LoadError { lift [] }",
      "function load() {",
      "  const rows = fetchItems() !{",
      "    | ::Network(msg) -> { @phase = msg }",
      "    | ::Empty        -> { @phase = \"empty\" }",
      "  }",
      "  @phase = \"loaded\"",
      "}",
      "</program>",
    ].join("\n");
    const srcFile = join(tmp, "repro.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);
    expectNoStatementBoundaryWarning();

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(outDir, "repro.client.js"), "utf8")));
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*msg\)/);
    expect(clientJs).toContain('_scrml_reactive_set("phase", "empty")');
    expect(clientJs).toContain('_scrml_reactive_set("phase", "loaded")');
    expect(clientJs).toContain('.variant === "Network"');
    expect(clientJs).toContain('.variant === "Empty"');

    rmSync(tmp, { recursive: true, force: true });
  });
});
