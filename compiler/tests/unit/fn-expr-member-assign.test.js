/**
 * fn-expr-member-assign.test.js — `obj.field = function() {...}` codegen
 *
 * Regression: 6nz inbound 2026-04-26 Bug M (playground-six WebSocket setup).
 *
 * Bug:
 *   Source: `ws.onopen = function() { @opened = true }`
 *   Pre-fix emit:
 *     ws . onopen =;
 *     function () { _scrml_reactive_set("opened", true); }
 *   bun build / node --check fails: SyntaxError "Unexpected token ;".
 *
 * Two-part root cause:
 *   1. ast-builder.js collectExpr / collectLiftExpr broke at the `function`
 *      keyword when it appeared at depth 0 mid-expression. STMT_KEYWORDS
 *      includes `function` (because top-level `function name() {}` is a
 *      decl), and the existing guard only excluded `lastPart === "."`. So
 *      `obj.x = function...` truncated at `=` and the next iteration parsed
 *      `function ( ) { ... }` as an anonymous function-decl statement.
 *   2. expression-parser.ts esTreeToExprNode AssignmentExpression branch
 *      did NOT thread `rawSource` to recursive calls. Function-expression
 *      RHS (BlockStatement body) fell back to escape-hatch with raw="",
 *      which the emitter dropped. (Same shape as Bug C, fixed for
 *      CallExpression on 2026-04-20.)
 *
 * Fix scope (T2, both files):
 *   1. ast-builder.js — extend STMT_KEYWORDS guard so `function` / `fn`
 *      after expression-RHS context (=, (, ,, [, :, =>, :>, ?, &&, ||,
 *      ??, !, +, -, *, /, %, <, >, <=, >=, ==, !=, return, throw, yield,
 *      await, new) is collected as part of the current expression.
 *   2. expression-parser.ts — thread rawSource into AssignmentExpression's
 *      target/value recursion (mirrors the Bug C / CallExpression fix).
 *
 * Coverage:
 *   §1  Canonical Bug M repro — `ws.onopen = function() { @opened = true }`.
 *   §2  RHS function with `return` — `obj.cb = function() { return 1 }`.
 *   §3  (removed) — scrml's `fn` keyword is a function-decl-only form
 *       (e.g. `fn buildUser() {...}`); there is no `fn` function-expression
 *       syntax. The Fix 1 guard includes `fn` mechanically so the same
 *       boundary logic applies if scrml ever adds a fn-expression form,
 *       but no test is asserted today.
 *   §4  Multi-statement body — two reactive writes inside.
 *   §5  Computed member (bracket) — `obj["k"] = function() {...}` /
 *       `arr[0] = function() {...}`.
 *   §6  Let-decl with function expression — `let cb = function() {...}`
 *       (sanity — distinct codegen path, exercised by the same root cause).
 *   §7  Regression guard — function-as-call-arg still works (this path was
 *       NEVER broken; we're confirming Fix 1 didn't regress it).
 *   §8  Regression guard — top-level `function setup() {...}` is still a
 *       function-decl statement (Fix 1 must NOT make every `function` a
 *       function expression — only when in expression-RHS context).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/fn-expr-member-assign");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let canonicalFx, returnFx, multiFx, computedFx, letFx, callArgFx, declFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // §1 — canonical Bug M
  canonicalFx = fix("canonical.scrml", `<program>
\${
  @opened = false
  function setup() {
    const ws = new window.WebSocket("ws://localhost:65535")
    ws.onopen = function() {
      @opened = true
    }
  }
}
<button onclick=setup()>setup</button>
<div>\${@opened}</div>
</program>
`);

  // §2 — RHS with return
  returnFx = fix("with-return.scrml", `<program>
\${
  @result = 0
  function setup() {
    const obj = { cb: not }
    obj.cb = function() {
      return 42
    }
    @result = obj.cb()
  }
}
<button onclick=setup()>run</button>
<div>\${@result}</div>
</program>
`);

  // §4 — multi-statement body (two sequential reactive writes)
  multiFx = fix("multi-stmt.scrml", `<program>
\${
  @a = 0
  @b = 0
  function setup() {
    const target = { handler: not }
    target.handler = function() {
      @a = 1
      @b = 2
    }
  }
}
<button onclick=setup()>arm</button>
<div>\${@a}/\${@b}</div>
</program>
`);

  // §5 — computed member (bracket access)
  computedFx = fix("computed-member.scrml", `<program>
\${
  @v = 0
  function setup() {
    const arr = [not]
    arr[0] = function() {
      @v = 7
    }
  }
}
<button onclick=setup()>set</button>
<div>\${@v}</div>
</program>
`);

  // §6 — let-decl with function expression
  letFx = fix("let-decl.scrml", `<program>
\${
  @x = 0
  function setup() {
    let cb = function() {
      @x = 1
    }
    cb()
  }
}
<button onclick=setup()>go</button>
<div>\${@x}</div>
</program>
`);

  // §7 — regression guard: function-as-call-arg
  callArgFx = fix("call-arg.scrml", `<program>
\${
  @c = 0
  function setup() {
    const target = document.body
    target.addEventListener("click", function() {
      @c = @c + 1
    })
  }
}
<button onclick=setup()>arm</button>
<div>\${@c}</div>
</program>
`);

  // §8 — regression guard: top-level function-decl is still a decl
  declFx = fix("top-level-decl.scrml", `<program>
\${
  @ran = false
  function helper() {
    @ran = true
  }
  function setup() {
    helper()
  }
}
<button onclick=setup()>run</button>
<div>\${@ran}</div>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

function getJs(path) {
  const result = compile(path);
  expect(result.errors).toEqual([]);
  return result.outputs.get(path).clientJs;
}

// ---------------------------------------------------------------------------
// §1 — canonical Bug M
// ---------------------------------------------------------------------------

describe("§1: ws.onopen = function() { @opened = true }", () => {
  test("compiles without errors", () => {
    const result = compile(canonicalFx);
    expect(result.errors).toEqual([]);
  });

  test("emit does NOT contain a bare `=;` (the orphan-RHS signature)", () => {
    const js = getJs(canonicalFx);
    expect(js).not.toMatch(/=\s*;/);
  });

  test("emit does NOT contain an orphan `function ()` statement", () => {
    const js = getJs(canonicalFx);
    // Pre-fix bug emitted a free-floating `function () { ... }` as a
    // statement. Post-fix, the only `function ()` should be inside an
    // assignment RHS or a call argument — never at line start preceded
    // only by whitespace / `;` / `}`.
    expect(js).not.toMatch(/^\s*function\s*\(\s*\)\s*\{/m);
  });

  test("emit contains the assignment with function RHS", () => {
    const js = getJs(canonicalFx);
    expect(js).toMatch(/ws\.onopen\s*=\s*function\s*\(/);
  });

  test("the reactive write inside the function body is present", () => {
    const js = getJs(canonicalFx);
    expect(js).toContain('_scrml_reactive_set("opened"');
  });

  test("emitted JS is syntactically valid", () => {
    const js = getJs(canonicalFx);
    // new Function() requires the body to parse — same property as `node --check`.
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §2 — RHS function with return
// ---------------------------------------------------------------------------

describe("§2: obj.cb = function() { return 42 }", () => {
  test("function-expression body with `return` survives codegen", () => {
    const js = getJs(returnFx);
    expect(js).not.toMatch(/=\s*;/);
    expect(js).toMatch(/obj\.cb\s*=\s*function\s*\(/);
    expect(js).toContain("return 42");
  });

  test("emitted JS is parseable", () => {
    const js = getJs(returnFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §4 — multi-statement function body
// ---------------------------------------------------------------------------

describe("§4: target.handler = function() { @a = 1; @b = 2 }", () => {
  test("both reactive writes appear inside the function body", () => {
    const js = getJs(multiFx);
    expect(js).not.toMatch(/=\s*;/);
    expect(js).toContain('_scrml_reactive_set("a"');
    expect(js).toContain('_scrml_reactive_set("b"');
  });

  test("emitted JS is parseable", () => {
    const js = getJs(multiFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5 — computed member assignment
// ---------------------------------------------------------------------------

describe("§5: arr[0] = function() { @v = 7 }", () => {
  test("computed member (bracket) assignment with function RHS", () => {
    const js = getJs(computedFx);
    expect(js).not.toMatch(/=\s*;/);
    expect(js).toMatch(/arr\[\s*0\s*\]\s*=\s*function\s*\(/);
    expect(js).toContain('_scrml_reactive_set("v"');
  });

  test("emitted JS is parseable", () => {
    const js = getJs(computedFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §6 — let-decl with function expression
// ---------------------------------------------------------------------------

describe("§6: let cb = function() { @x = 1 }", () => {
  test("let-decl initializer is the function expression", () => {
    const js = getJs(letFx);
    expect(js).not.toMatch(/=\s*;/);
    expect(js).toMatch(/let\s+cb\s*=\s*function\s*\(/);
    expect(js).toContain('_scrml_reactive_set("x"');
  });

  test("emitted JS is parseable", () => {
    const js = getJs(letFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §7 — regression guard: function-as-call-arg
// ---------------------------------------------------------------------------

describe("§7: addEventListener(ev, function() { ... }) — regression guard", () => {
  test("function-as-call-arg still emits a callback", () => {
    const js = getJs(callArgFx);
    expect(js).not.toMatch(/addEventListener\(\s*[^)]*,\s*\)/);
    expect(js).toMatch(/addEventListener\([^)]*,\s*function\s*\(/);
    expect(js).toContain('_scrml_reactive_set("c"');
  });

  test("emitted JS is parseable", () => {
    const js = getJs(callArgFx);
    expect(() => new Function(js)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §8 — regression guard: top-level function-decl is still a decl
// ---------------------------------------------------------------------------

describe("§8: top-level `function helper() {...}` is still a function-decl", () => {
  test("named top-level function compiles to a function declaration, not a stranded expression", () => {
    const js = getJs(declFx);
    // The helper function should appear as a definition the call site can
    // reach. Compiler mangles the name, so we look for a function decl with
    // a `helper`-derived mangled name (e.g. `_scrml_helper_<n>`).
    expect(js).toMatch(/function\s+_scrml_helper/);
    expect(js).toContain('_scrml_reactive_set("ran"');
  });

  test("emitted JS is parseable", () => {
    const js = getJs(declFx);
    expect(() => new Function(js)).not.toThrow();
  });
});
