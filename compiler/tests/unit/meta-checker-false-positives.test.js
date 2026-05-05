/**
 * Meta Checker — False Positive Regression Tests
 *
 * Covers fixes to extractIdentifiers() that eliminate spurious E-META-001
 * warnings for:
 *   1. Object literal keys and property accesses (original fix)
 *   2. Callback parameters in forEach/map/filter/reduce (BUG-R15-001 fix)
 *   3. For-of/for-in iterator variable declarations (BUG-R15-001 fix)
 *   4. Arrow function parameters (BUG-R15-001 fix)
 *
 * Before fix #1, expressions like:
 *   emit(`${JSON.stringify({title: x})}`)
 * would falsely flag `title` as a runtime variable.
 *
 * Before fix #2 (BUG-R15-001), expressions like:
 *   cards.forEach(function(card) { emit(`...`); })
 *   routes.map(route => route.icon)
 *   for (const route of routes) { emit(`...`); }
 * would falsely flag `card`, `route` as runtime variables.
 *
 *   §61  extractIdentifiers — object literal key is NOT extracted
 *   §62  extractIdentifiers — multiple object keys are NOT extracted, values ARE
 *   §63  extractIdentifiers — nested object in function call: keys excluded, values included
 *   §64  extractIdentifiers — ternary expression: true-branch value IS extracted (regression guard)
 *   §65  extractIdentifiers — dot-property access NOT extracted (existing behavior preserved)
 *   §66  checkExprForRuntimeVars — emit with object literal produces no false positives
 *   §67  checkExprForRuntimeVars — emit with multiple keys produces no false positives
 *   §68  checkExprForRuntimeVars — actual runtime var in same expr as object key still fires
 *   §69  extractIdentifiers — forEach named function callback param NOT extracted
 *   §70  extractIdentifiers — map arrow function single param NOT extracted
 *   §71  extractIdentifiers — for-of iterator variable NOT extracted
 *   §72  extractIdentifiers — reduce two-param arrow NOT extracted
 *   §73  extractIdentifiers — outer variable used inside forEach body IS still extracted
 *   §74  checkExprForRuntimeVars — forEach callback param produces no E-META-001
 *   §75  checkExprForRuntimeVars — for-of iterator produces no E-META-001
 *   §76  checkExprForRuntimeVars — outer var inside forEach still fires E-META-001
 */

import { parseExprToNode } from "../../src/expression-parser.ts";
import { describe, test, expect } from "bun:test";
import {
  extractIdentifiers,
  checkExprForRuntimeVars,
  runMetaChecker,
  bodyMixesPhases,
} from "../../src/meta-checker.ts";

function span(start = 0, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

// ---------------------------------------------------------------------------
// §61-65: extractIdentifiers — false positive fixes (object keys, property access)
// ---------------------------------------------------------------------------

describe("extractIdentifiers — false positive fixes", () => {
  test("§61 object literal key is NOT extracted", () => {
    // {title: "Dashboard"} — `title` is a key, not a variable reference
    const ids = extractIdentifiers('JSON.stringify({title: "Dashboard"})');
    expect(ids).not.toContain("title");
  });

  test("§62 multiple object keys NOT extracted, values ARE extracted", () => {
    // {title: x, active: y} — keys excluded, values included
    const ids = extractIdentifiers("{title: x, active: y}");
    expect(ids).not.toContain("title");
    expect(ids).not.toContain("active");
    expect(ids).toContain("x");
    expect(ids).toContain("y");
  });

  test("§63 nested object in function call: keys excluded, values included", () => {
    // Mirrors the pattern that was causing 10-17 false positives per file:
    //   emit(`<div>${JSON.stringify({name: item.name, count: items.length})}</div>`)
    // After string stripping, the relevant part is: JSON.stringify({name: , count: })
    // `name` and `count` are keys, should not be extracted.
    const ids = extractIdentifiers('JSON.stringify({name: result, count: total})');
    expect(ids).not.toContain("name");
    expect(ids).not.toContain("count");
    expect(ids).toContain("result");
    expect(ids).toContain("total");
  });

  test("§64 ternary expression: true-branch value IS extracted (regression guard)", () => {
    // condition ? myVar : defaultVal — myVar is a value, not an object key.
    // The `?` context means `:` here is a ternary separator, not an object key colon.
    // `myVar` appears after `?`, not after `{` or `,`, so it should be extracted.
    const ids = extractIdentifiers("condition ? myVar : defaultVal");
    expect(ids).toContain("condition");
    expect(ids).toContain("myVar");
    expect(ids).toContain("defaultVal");
  });

  test("§65 dot-property access NOT extracted (existing behavior preserved)", () => {
    // obj.prop.deep — only `obj` is a variable reference, `prop` and `deep` are accesses
    const ids = extractIdentifiers("obj.prop.deep");
    expect(ids).toContain("obj");
    expect(ids).not.toContain("prop");
    expect(ids).not.toContain("deep");
  });
});

// ---------------------------------------------------------------------------
// §66-68: checkExprForRuntimeVars — no false positives for object keys
// ---------------------------------------------------------------------------

describe("checkExprForRuntimeVars — object literal key false positives", () => {
  test("§66 emit with object literal produces no false positives for keys", () => {
    // emit(`<p class="${cls}">${JSON.stringify({title: x, active: true})}</p>`)
    // After string stripping, extracts from: emit(  {  }  )
    // `title` and `active` are keys — should NOT be flagged as runtime vars.
    const errors = [];
    const locals = new Set(["cls", "x"]);
    const registry = new Map();
    checkExprForRuntimeVars(
      'emit(`<p class="${cls}">${JSON.stringify({title: x, active: true})}</p>`)',
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const meta001s = errors.filter(e => e.code === "E-META-001");
    // Neither `title` nor `active` should be flagged — they're object keys
    const flagged = meta001s.map(e => {
      const m = e.message.match(/Runtime variable '(\w+)'/);
      return m ? m[1] : null;
    });
    expect(flagged).not.toContain("title");
    expect(flagged).not.toContain("active");
  });

  test("§67 emit with multiple keys produces no false positives", () => {
    // Realistic emit() call: emit the HTML with metadata passed via JSON
    // None of the object keys should be flagged
    const errors = [];
    const locals = new Set(["items"]);
    const registry = new Map();
    checkExprForRuntimeVars(
      'emit(`<ul>${items.map(i => JSON.stringify({id: i, label: i, checked: false})).join("")}</ul>`)',
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const meta001s = errors.filter(e => e.code === "E-META-001");
    const flagged = meta001s.map(e => {
      const m = e.message.match(/Runtime variable '(\w+)'/);
      return m ? m[1] : null;
    });
    expect(flagged).not.toContain("id");
    expect(flagged).not.toContain("label");
    expect(flagged).not.toContain("checked");
  });

  test("§68 actual runtime var in same expr as object key still fires E-META-001", () => {
    // The fix must not suppress real runtime variable errors.
    // `runtimeCard` is a real variable ref (not preceded by `{` or `,`),
    // so it SHOULD still produce E-META-001.
    const errors = [];
    const locals = new Set();
    const registry = new Map();
    checkExprForRuntimeVars(
      'emit(`<div>${JSON.stringify({title: "ok"})}</div>` + runtimeCard)',
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const meta001s = errors.filter(e => e.code === "E-META-001");
    const flagged = meta001s.map(e => {
      const m = e.message.match(/Runtime variable '(\w+)'/);
      return m ? m[1] : null;
    });
    // runtimeCard is a true runtime var — should be flagged
    expect(flagged).toContain("runtimeCard");
    // `title` is an object key — should NOT be flagged
    expect(flagged).not.toContain("title");
  });
});

// ---------------------------------------------------------------------------
// §69-76: BUG-R15-001 — callback params, arrow params, for-of iterators
// ---------------------------------------------------------------------------

describe("extractIdentifiers — callback and iterator false positives (BUG-R15-001)", () => {
  test("§69 forEach named function callback param NOT extracted", () => {
    // cards.forEach(function(card) { ... }) — `card` is a callback param, not a runtime var
    const ids = extractIdentifiers("cards.forEach(function(card) { emit(card); })");
    expect(ids).not.toContain("card");
    // But `cards` IS a real outer variable and should be extracted
    expect(ids).toContain("cards");
  });

  test("§70 map arrow function single param NOT extracted", () => {
    // routes.map(route => route.icon) — `route` is an arrow param, not a runtime var
    const ids = extractIdentifiers("routes.map(route => route.icon)");
    expect(ids).not.toContain("route");
    // `routes` is an outer variable reference — should be extracted
    expect(ids).toContain("routes");
  });

  test("§71 for-of iterator variable NOT extracted", () => {
    // for (const route of routes) { ... } — `route` is the iterator var
    const ids = extractIdentifiers("for (const route of routes) { emit(route.path); }");
    expect(ids).not.toContain("route");
    // `routes` is an outer variable — should be extracted
    expect(ids).toContain("routes");
  });

  test("§72 reduce two-param arrow params NOT extracted", () => {
    // items.reduce((acc, item) => acc + item.value, 0) — `acc` and `item` are arrow params
    const ids = extractIdentifiers("items.reduce((acc, item) => acc + item.value, 0)");
    expect(ids).not.toContain("acc");
    expect(ids).not.toContain("item");
    // `items` is an outer variable — should be extracted
    expect(ids).toContain("items");
  });

  test("§73 outer variable used inside forEach body IS still extracted", () => {
    // The callback param `c` is local, but `outerList` from the outer scope is real.
    // `outerList` is not a callback param so it should still be extracted.
    const ids = extractIdentifiers("outerList.forEach(function(c) { emit(c); })");
    expect(ids).not.toContain("c");
    expect(ids).toContain("outerList");
  });
});

describe("checkExprForRuntimeVars — callback and iterator false positives (BUG-R15-001)", () => {
  test("§74 forEach callback param produces no E-META-001", () => {
    // cards is a compile-time local; `card` is the callback param — neither should fire
    const errors = [];
    const locals = new Set(["cards"]);
    const registry = new Map();
    checkExprForRuntimeVars(
      "cards.forEach(function(card) { emit(card.title); })",
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const flagged = errors
      .filter(e => e.code === "E-META-001")
      .map(e => { const m = e.message.match(/Runtime variable '(\w+)'/); return m?.[1]; });
    expect(flagged).not.toContain("card");
    expect(flagged).not.toContain("cards");
  });

  test("§75 for-of iterator produces no E-META-001", () => {
    // `cols` is a compile-time local; `col` is the iterator var — neither should fire
    const errors = [];
    const locals = new Set(["cols"]);
    const registry = new Map();
    checkExprForRuntimeVars(
      "for (const col of cols) { emit(col.name); }",
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const flagged = errors
      .filter(e => e.code === "E-META-001")
      .map(e => { const m = e.message.match(/Runtime variable '(\w+)'/); return m?.[1]; });
    expect(flagged).not.toContain("col");
    expect(flagged).not.toContain("cols");
  });

  test("§76 outer runtime var inside forEach body still fires E-META-001", () => {
    // `outerRuntimeVar` is NOT declared anywhere — it should still trigger E-META-001
    // even though the callback param `c` correctly does not.
    const errors = [];
    const locals = new Set();  // no compile-time locals
    const registry = new Map();
    checkExprForRuntimeVars(
      "someList.forEach(function(c) { emit(c + outerRuntimeVar); })",
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const flagged = errors
      .filter(e => e.code === "E-META-001")
      .map(e => { const m = e.message.match(/Runtime variable '(\w+)'/); return m?.[1]; });
    // `c` is a callback param — must NOT be flagged
    expect(flagged).not.toContain("c");
    // `outerRuntimeVar` is a real runtime reference — MUST be flagged
    expect(flagged).toContain("outerRuntimeVar");
    // `someList` is also a real runtime reference — MUST be flagged
    expect(flagged).toContain("someList");
  });
});

// ---------------------------------------------------------------------------
// §77-82: fix-emeta001-destr-arrows — destructuring arrow function params
// ---------------------------------------------------------------------------

describe("extractIdentifiers — destructuring arrow params (fix-emeta001-destr-arrows)", () => {
  test("§77 object destructuring arrow params NOT extracted", () => {
    const ids = extractIdentifiers("({ title, priority }) => emit(title)");
    expect(ids).not.toContain("title");
    expect(ids).not.toContain("priority");
  });

  test("§78 array destructuring arrow params NOT extracted", () => {
    const ids = extractIdentifiers("([x, y]) => x + y");
    expect(ids).not.toContain("x");
    expect(ids).not.toContain("y");
  });

  test("§79 nested object destructuring arrow params NOT extracted", () => {
    const ids = extractIdentifiers("({ user: { name } }) => name");
    expect(ids).not.toContain("name");
    expect(ids).not.toContain("user");
  });

  test("§80 rest in destructuring arrow params NOT extracted", () => {
    const ids = extractIdentifiers("({ title, ...rest }) => rest");
    expect(ids).not.toContain("title");
    expect(ids).not.toContain("rest");
  });

  test("§81 defaults in destructuring arrow params NOT extracted", () => {
    const ids = extractIdentifiers('({ title = "default" }) => title');
    expect(ids).not.toContain("title");
  });
});

describe("checkExprForRuntimeVars — destructuring arrow params (fix-emeta001-destr-arrows)", () => {
  test("§82 destructuring arrow params produce no E-META-001", () => {
    const errors = [];
    const locals = new Set(["items"]);
    const registry = new Map();
    checkExprForRuntimeVars(
      "items.map(({ title, priority }) => emit(title))",
      locals,
      registry,
      span(),
      "/test.scrml",
      errors,
    );
    const flagged = errors
      .filter(e => e.code === "E-META-001")
      .map(e => { const m = e.message.match(/Runtime variable '(\w+)'/); return m?.[1]; });
    expect(flagged).not.toContain("title");
    expect(flagged).not.toContain("priority");
    expect(flagged).not.toContain("items");
  });
});


// ---------------------------------------------------------------------------
// §83-§88: BUG-META-COMPTIME-VARS — compile-time loop variable propagation
//
// Regression suite for the fix that propagates "compile-time-ness" through
// program-scope const bindings into compile-time ^{} meta blocks.
//
// Before the fix: `for (const color of palette)` where `palette` is a
// top-level `const` would falsely flag `color.hex` and `color.name` as
// E-META-001 (runtime variable), and the block as E-META-005 (phase separation).
//
// After the fix: top-level `const` declarations are tracked as compile-time-safe
// outer references. They are NOT considered runtime variables when referenced
// inside a compile-time ^{} block.
//
//   §83  runMetaChecker — top-level const used directly in emit() produces no E-META-001
//   §84  runMetaChecker — for-of over top-level const produces no E-META-001 for iterable
//   §85  runMetaChecker — loop var from top-level const iterable produces no E-META-001
//   §86  runMetaChecker — E-META-005 NOT fired when block only references top-level consts
//   §87  runMetaChecker — reactive var (@) still fires E-META-001 (regression guard)
//   §88  bodyMixesPhases — returns false when outer const is provided as compile-time
// ---------------------------------------------------------------------------

function fp_span(start = 0, file = "/test/palette.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function fp_makeFileAST({ filePath = "/test/palette.scrml", nodes = [], typeDecls = [] } = {}) {
  return { filePath, nodes, typeDecls, imports: [], exports: [], components: [], spans: {} };
}

function fp_makeMetaNode(body, id = 200) {
  return { id, kind: "meta", body, parentContext: "markup", span: fp_span(0) };
}

function fp_makeConstDecl(name, init = null, id = 10) {
  return { id, kind: "const-decl", name, init, span: fp_span(0) };
}

function fp_makeBareExpr(expr, id = 10) {
  return { id, kind: "bare-expr", expr, exprNode: parseExprToNode(expr, "/test/palette.scrml", 0), span: fp_span(0) };
}

function fp_makeForStmt(variable, iterable, body = [], id = 10) {
  return { id, kind: "for-stmt", variable, iterable, body, span: fp_span(0) };
}

function fp_makeReactiveDecl(name, init = null, id = 10) {
  return { id, kind: "state-decl", name, init, span: fp_span(0) };
}

describe("BUG-META-COMPTIME-VARS — compile-time outer const propagation", () => {
  test("§83 top-level const used directly in emit() produces no E-META-001", () => {
    // Mirrors: const palette = [...]; ^{ emit(palette.length) }
    // `palette` is a top-level const — must not be flagged as runtime.
    const result = runMetaChecker({
      files: [fp_makeFileAST({
        nodes: [
          fp_makeConstDecl("palette", '[{name:"red",hex:"#f00"}]'),
          fp_makeMetaNode([
            fp_makeBareExpr("emit(palette.length)"),
          ]),
        ],
      })],
    });
    const e001 = result.errors.filter(e => e.code === "E-META-001");
    const paletteErrors = e001.filter(e => e.message.includes("'palette'"));
    expect(paletteErrors).toHaveLength(0);
  });

  test("§84 for-of over top-level const: iterable not flagged E-META-001", () => {
    // Mirrors: for (const color of palette) { ... }
    // `palette` appears as the iterable expression — must not be flagged.
    const result = runMetaChecker({
      files: [fp_makeFileAST({
        nodes: [
          fp_makeConstDecl("palette", '[{name:"red",hex:"#f00"}]'),
          fp_makeMetaNode([
            fp_makeForStmt("color", "palette", [
              fp_makeBareExpr("emit(color.hex)"),
            ]),
            fp_makeBareExpr("emit('done')"),
          ]),
        ],
      })],
    });
    const e001 = result.errors.filter(e => e.code === "E-META-001");
    const paletteErrors = e001.filter(e => e.message.includes("'palette'"));
    expect(paletteErrors).toHaveLength(0);
  });

  test("§85 for-of loop variable from top-level const: loop var not flagged E-META-001", () => {
    // Loop variable `color` is derived from compile-time `palette` — must not fire.
    const result = runMetaChecker({
      files: [fp_makeFileAST({
        nodes: [
          fp_makeConstDecl("palette", '[{name:"red",hex:"#f00"}]'),
          fp_makeMetaNode([
            fp_makeForStmt("color", "palette", [
              fp_makeBareExpr("emit(color.hex)"),
            ]),
            fp_makeBareExpr("emit('done')"),
          ]),
        ],
      })],
    });
    const e001 = result.errors.filter(e => e.code === "E-META-001");
    const colorErrors = e001.filter(e => e.message.includes("'color'"));
    expect(colorErrors).toHaveLength(0);
  });

  test("§86 E-META-005 NOT fired when compile-time block only references top-level consts", () => {
    // Phase separation check must not fire when the only outer refs are program-scope consts.
    const result = runMetaChecker({
      files: [fp_makeFileAST({
        nodes: [
          fp_makeConstDecl("palette", '[{name:"red",hex:"#f00"}]'),
          fp_makeMetaNode([
            fp_makeForStmt("color", "palette", [
              fp_makeBareExpr("emit(color.name)"),
            ]),
            fp_makeBareExpr("emit('done')"),
          ]),
        ],
      })],
    });
    const e005 = result.errors.filter(e => e.code === "E-META-005");
    expect(e005).toHaveLength(0);
  });

  test("§87 reactive var in compile-time ^{} still fires E-META-001 (regression guard)", () => {
    // @count is a reactive var — it MUST still be flagged even with the outer-const fix.
    const result = runMetaChecker({
      files: [fp_makeFileAST({
        nodes: [
          fp_makeReactiveDecl("count", "0"),
          fp_makeMetaNode([
            fp_makeBareExpr("emit(count)"),
          ]),
        ],
      })],
    });
    const e001 = result.errors.filter(e => e.code === "E-META-001");
    const countErrors = e001.filter(e => e.message.includes("'count'"));
    expect(countErrors.length).toBeGreaterThanOrEqual(1);
  });

  test("§88 bodyMixesPhases returns false when outer const provided as compile-time", () => {
    // The body references `palette` — without the fix this would return true (phase violation).
    // With outerCompileTimeConsts = Set{"palette"}, it must return false.
    const body = [
      fp_makeForStmt("color", "palette", [
        fp_makeBareExpr("emit(color.name)"),
      ]),
      fp_makeBareExpr("emit('done')"),
    ];
    const registry = new Map();
    const outerConsts = new Set(["palette"]);
    expect(bodyMixesPhases(body, registry, outerConsts)).toBe(false);
  });
});
