/**
 * for-of-reactive-plain-fn-peter-23.test.js — GitHub #23 (Peter)
 *
 * A `for (let x of @cell)` in a PLAIN, non-render function / logic body was
 * mis-lowered to the reactive DOM list-render path (`_scrml_render_list` /
 * `_scrml_reconcile_list` + `document.createElement`/`_scrml_lift`) purely
 * because the iterable held a reactive `@`-ref — with no check that the body
 * is a render context.
 *
 * SPEC boundary (§17.4 / §17.4a): the Tier-0 list-render form is a for-of whose
 * body `lift`s markup — `for (item of items) { lift <li/> }`. A for-of WITHOUT
 * `lift` is a plain loop. A reactive-iterable for-of in a plain logic body SHALL
 * therefore lower to a plain `for (const x of _scrml_reactive_get("cell")) { … }`
 * over the cell's CURRENT snapshot value, with `x` properly scoped — NOT a DOM
 * list-render.
 *
 * The render path (a genuine `for…lift`) MUST keep emitting the list-render.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { forBodyLiftsMarkup } from "../../src/codegen/reactive-deps.ts";

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function makeProtectAnalysis() { return { views: new Map() }; }

function parse(source, filePath) {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

/** Compile a scrml source string through BS → TAB → CG and return client JS. */
function compileClient(source, filePath = "/test/peter-23.scrml") {
  const { ast } = parse(source, filePath);
  const fileAST = {
    ...ast,
    errors: [],
    components: [],
    typeDecls: [],
    nodeTypes: new Map(),
    componentShapes: new Map(),
    scopeChain: null,
  };
  const result = runCG({
    files: [fileAST],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis: makeProtectAnalysis(),
  });
  return {
    clientJs: result.outputs.get(filePath)?.clientJs ?? "",
    fatalErrors: (result.errors ?? []).filter((e) => e.severity === "error"),
  };
}

beforeEach(() => resetVarCounter());

// ---------------------------------------------------------------------------
// §1 — the reported bug: plain function iterating a reactive cell
// ---------------------------------------------------------------------------

describe("peter-23 §1: plain function iterating a reactive cell is a plain loop", () => {
  const source = `<div>
    \${
      @unitParts = [{ unit: "A1" }, { unit: "B2" }]
      function unitLabelFor(num) {
        for (let p of @unitParts) {
          if (p.unit == num) { return p.unit }
        }
        return "none"
      }
    }
    \${ unitLabelFor("A1") }
  </div>`;

  test("emits a plain for-of over the cell snapshot (_scrml_reactive_get)", () => {
    const { clientJs } = compileClient(source);
    expect(clientJs).toMatch(/for \(const p of _scrml_reactive_get\("unitParts"\)\)/);
  });

  test("does NOT emit a reactive DOM list-render for the plain function", () => {
    const { clientJs } = compileClient(source);
    expect(clientJs).not.toContain("_scrml_reconcile_list(");
    expect(clientJs).not.toMatch(/function _scrml_render_list_\d+\(\)/);
  });

  test("does NOT emit list-render DOM scaffolding (createElement wrapper / _scrml_lift)", () => {
    const { clientJs } = compileClient(source);
    // No list wrapper div / lift for the plain-function loop.
    expect(clientJs).not.toContain('_scrml_list_wrapper');
    expect(clientJs).not.toContain("_scrml_lift(");
  });

  test("the loop body (return of the matched field) survives", () => {
    const { clientJs } = compileClient(source);
    expect(clientJs).toContain("return p.unit;");
  });

  test("compiles with no fatal errors (no E-SCOPE-001 on the loop var)", () => {
    const { fatalErrors } = compileClient(source);
    expect(fatalErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — render path MUST still emit a list-render (guard against over-fix)
// ---------------------------------------------------------------------------

describe("peter-23 §2: a genuine for…lift over a reactive cell STILL renders", () => {
  const source = `<ul>
    \${
      @items = []
      for (let it of @items) {
        lift <li>\${it}</>
      }
    }
  </ul>`;

  test("for…lift over @items emits a keyed list-render", () => {
    const { clientJs } = compileClient(source);
    expect(clientJs).toContain("_scrml_reconcile_list(");
    expect(clientJs).toMatch(/function _scrml_render_list_\d+\(\)/);
  });

  test("for…lift over @items emits the wrapper div + _scrml_lift mount", () => {
    const { clientJs } = compileClient(source);
    expect(clientJs).toContain('createElement("div")');
    expect(clientJs).toContain("_scrml_lift(");
  });
});

// ---------------------------------------------------------------------------
// §3 — adversarial: reactive-iterable for-of with NO lift stays a plain loop
// ---------------------------------------------------------------------------

describe("peter-23 §3: reactive for-of with no lift = plain snapshot loop", () => {
  test("accumulator loop (no lift) iterates the snapshot, no list-render", () => {
    const source = `<div>
      \${
        @nums = [1, 2, 3]
        function total() {
          let sum = 0
          for (let n of @nums) { sum = sum + n }
          return sum
        }
      }
      \${ total() }
    </div>`;
    const { clientJs, fatalErrors } = compileClient(source);
    expect(clientJs).toMatch(/for \(const n of _scrml_reactive_get\("nums"\)\)/);
    expect(clientJs).not.toContain("_scrml_reconcile_list(");
    expect(fatalErrors).toHaveLength(0);
  });

  test("continue/break in a reactive plain loop lower verbatim (no return-hoist)", () => {
    const source = `<div>
      \${
        @rows = []
        function firstActive() {
          for (let r of @rows) {
            if (r.skip) { continue }
            return r.id
          }
          return 0
        }
      }
      \${ firstActive() }
    </div>`;
    const { clientJs, fatalErrors } = compileClient(source);
    expect(clientJs).toMatch(/for \(const r of _scrml_reactive_get\("rows"\)\)/);
    expect(clientJs).toContain("continue;");
    expect(clientJs).not.toContain("_scrml_reconcile_list(");
    expect(fatalErrors).toHaveLength(0);
  });

  test("nested reactive for-of with no lift emits nested plain loops", () => {
    const source = `<div>
      \${
        @grid = []
        function count() {
          let c = 0
          for (let row of @grid) {
            for (let cell of row.cells) { c = c + 1 }
          }
          return c
        }
      }
      \${ count() }
    </div>`;
    const { clientJs, fatalErrors } = compileClient(source);
    expect(clientJs).toMatch(/for \(const row of _scrml_reactive_get\("grid"\)\)/);
    expect(clientJs).toContain("for (const cell of row.cells)");
    expect(clientJs).not.toContain("_scrml_reconcile_list(");
    expect(fatalErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — forBodyLiftsMarkup classifier unit coverage
// ---------------------------------------------------------------------------

describe("peter-23 §4: forBodyLiftsMarkup render-context classifier", () => {
  test("body with no lift-expr → false", () => {
    const body = [
      { kind: "if-stmt", consequent: [{ kind: "return-stmt" }] },
      { kind: "return-stmt" },
    ];
    expect(forBodyLiftsMarkup(body)).toBe(false);
  });

  test("body with a top-level lift-expr → true", () => {
    const body = [{ kind: "lift-expr", expr: "<li/>" }];
    expect(forBodyLiftsMarkup(body)).toBe(true);
  });

  test("lift nested inside an if-stmt consequent → true", () => {
    const body = [
      { kind: "if-stmt", consequent: [{ kind: "lift-expr", expr: "<li/>" }] },
    ];
    expect(forBodyLiftsMarkup(body)).toBe(true);
  });

  test("lift nested inside a nested for-stmt body → true", () => {
    const body = [
      { kind: "for-stmt", body: [{ kind: "lift-expr", expr: "<li/>" }] },
    ];
    expect(forBodyLiftsMarkup(body)).toBe(true);
  });

  test("non-array / empty → false", () => {
    expect(forBodyLiftsMarkup(null)).toBe(false);
    expect(forBodyLiftsMarkup(undefined)).toBe(false);
    expect(forBodyLiftsMarkup([])).toBe(false);
  });
});
