/**
 * Phase A1b Step B3 — `@name` resolution.
 *
 * Tests the PASS 3 walker added to Stage 3.06 SYM
 * (`compiler/src/symbol-table.ts`). For every `@`-prefixed `IdentExpr` in
 * an ExprNode payload anywhere on the AST, B3 stamps `_resolvedStateCell`
 * (a `StateCellRecord` if a cell with the bare name is registered in any
 * enclosing scope, or `null` if not). B3 fires NO new diagnostics — the
 * resolution-fail catch-all (E-SCOPE-001 / DG sweep) is existing infra.
 *
 * Per A1b SCOPE-AND-DECOMPOSITION §4.6 line 228: B3 → "(resolution-fail
 * catch-all; existing infra)" — so happy paths annotate non-null,
 * unresolved paths annotate null, and downstream B-steps (B5 cell
 * classifier, B7 derived-cell DAG, B22 reset(@cell)) read the annotation.
 *
 * Test §B3.1 — happy path: `@count` in `${@count}` interpolation resolves
 * Test §B3.2 — happy path: `@count + 1` in arithmetic expr resolves
 * Test §B3.3 — happy path: `@items.length` (member access on cell) resolves base
 * Test §B3.4 — compound nav: `@formRes.name` resolves to compound parent
 * Test §B3.5 — compound nav: `@formRes.name.toUpperCase()` resolves base cell
 * Test §B3.6 — failure path: `@undeclared` annotates null (no error fired)
 * Test §B3.7 — discrimination: bare `count` (no `@`) is NOT annotated
 * Test §B3.8 — function-scoped state cell: `@x` inside fn body resolves
 * Test §B3.9 — parent-chain: file-level cell visible from nested function
 * Test §B3.10 — B5-shaped read: every `@`-ident has resolved annotation
 * Test §B3.11 — getResolvedStateCell helper return shape
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runSYM,
  getResolvedStateCell,
} from "../../src/symbol-table.ts";
import { forEachIdentInExprNode } from "../../src/expression-parser.ts";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function buildAndResolve(source) {
  const { ast, errors } = parse(source);
  const sym = runSYM({ filePath: "test.scrml", ast });
  return { ast, errors, sym };
}

/**
 * Walk every ExprNode payload on every AST node and collect every
 * `@`-prefixed IdentExpr along with its `_resolvedStateCell` annotation.
 * Mirrors the shape downstream B-step consumers (B5, B7, B22) use.
 */
function collectAtIdents(ast) {
  const EXPR_FIELDS = [
    "exprNode", "initExpr", "argsExpr", "condExpr", "headerExpr",
    "iterExpr", "conditionExpr", "guardExpr", "valueExpr", "rhsExpr",
    "defaultExpr",
    // s461 — an ExprNode LIST (one per reactive-array-mutation argument).
    "argExprs",
  ];
  const found = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    for (const f of EXPR_FIELDS) {
      for (const v of (Array.isArray(n[f]) ? n[f] : [n[f]])) {
        if (v && typeof v === "object" && v.kind) {
          forEachIdentInExprNode(v, (id) => {
            if (typeof id.name === "string" && id.name.startsWith("@")) {
              found.push({
                name: id.name,
                resolved: getResolvedStateCell(id),
                ident: id,
              });
            }
          });
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent" || k === "block") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return found;
}

// ---------------------------------------------------------------------------
// §B3.1 — happy path: @count in ${@count} interpolation resolves
// ---------------------------------------------------------------------------

describe("§B3.1 happy path — `@count` in markup interpolation resolves", () => {
  test("`<count> = 0` + `${@count}` resolves to the cell", () => {
    const src = `<program>\${ <count> = 0 }<p>\${@count}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    expect(idents.length).toBeGreaterThanOrEqual(1);
    const atCount = idents.find(i => i.name === "@count");
    expect(atCount).toBeDefined();
    expect(atCount.resolved).not.toBeNull();
    expect(atCount.resolved).toBeDefined();
    expect(atCount.resolved.name).toBe("count");
    expect(atCount.resolved.qualifiedPath).toBe("count");
    expect(atCount.resolved.scope).toBe(sym.fileScope);
  });
});

// s461 — a reactive array mutation carries one ExprNode per argument
// (`argExprs`); every `@cell` argument resolves, not only a lone first one.
describe("§B3.1b — `@cell` arguments of a multi-argument mutation resolve", () => {
  test("`@ls.splice(0, 0, @pv, @qv)` — @pv and @qv each resolve to their cell", () => {
    const src = `<program>\${
      <ls> = [1]
      <pv> = 9
      <qv> = 8
      function ins() { @ls.splice(0, 0, @pv, @qv) }
    }<button onclick=ins()>go</button><p>\${@ls.length}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);
    const idents = collectAtIdents(ast);
    for (const name of ["pv", "qv"]) {
      const hit = idents.find(i => i.name === "@" + name);
      expect(hit).toBeDefined();
      expect(hit.resolved).toBeDefined();
      expect(hit.resolved.name).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------
// §B3.2 — happy path: @count + 1 in arithmetic expression
// ---------------------------------------------------------------------------

describe("§B3.2 happy path — `@count + 1` in binary expression resolves", () => {
  test("@count appears inside a BinaryExpr; resolution still annotates", () => {
    const src = `<program>\${ <count> = 0 }<p>\${@count + 1}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    const atCount = idents.find(i => i.name === "@count");
    expect(atCount).toBeDefined();
    expect(atCount.resolved).not.toBeNull();
    expect(atCount.resolved.name).toBe("count");
  });
});

// ---------------------------------------------------------------------------
// §B3.3 — happy path: @items.length (member access on cell)
// ---------------------------------------------------------------------------

describe("§B3.3 happy path — `@items.length` resolves the BASE cell", () => {
  test("MemberExpr base ident is annotated; .length is a static prop string", () => {
    const src = `<program>\${ <items> = [1, 2, 3] }<p>\${@items.length}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    // Only one @-prefixed ident: @items. The `.length` segment is a static
    // property name, not an IdentExpr — forEachIdentInExprNode walks
    // member.object only.
    const atIdents = idents.filter(i => i.name.startsWith("@"));
    expect(atIdents.length).toBeGreaterThanOrEqual(1);
    const atItems = atIdents.find(i => i.name === "@items");
    expect(atItems).toBeDefined();
    expect(atItems.resolved).not.toBeNull();
    expect(atItems.resolved.name).toBe("items");
  });
});

// ---------------------------------------------------------------------------
// §B3.4 — compound nav: @formRes.name resolves to compound parent
// ---------------------------------------------------------------------------

describe("§B3.4 compound nav — `@formRes.name` resolves the compound parent", () => {
  test("Variant C compound + @formRes.name read — base resolves to parent", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" </> }<p>\${@formRes.name}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    const atForm = idents.find(i => i.name === "@formRes");
    expect(atForm).toBeDefined();
    expect(atForm.resolved).not.toBeNull();
    expect(atForm.resolved.name).toBe("formRes");
    expect(atForm.resolved.qualifiedPath).toBe("formRes");
    expect(atForm.resolved.isCompoundParent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §B3.5 — compound nav with method call: @formRes.name.toUpperCase()
// ---------------------------------------------------------------------------

describe("§B3.5 compound nav — `@formRes.name.toUpperCase()` resolves base cell", () => {
  test("CallExpr on chained MemberExpr — root @formRes still annotated", () => {
    const src = `<program>\${ <formRes><name>="" </> }<p>\${@formRes.name.toUpperCase()}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    const atForm = idents.find(i => i.name === "@formRes");
    expect(atForm).toBeDefined();
    expect(atForm.resolved).not.toBeNull();
    expect(atForm.resolved.qualifiedPath).toBe("formRes");
  });
});

// ---------------------------------------------------------------------------
// §B3.6 — failure path: @undeclared annotates null
// ---------------------------------------------------------------------------

describe("§B3.6 failure path — `@undeclared` annotates null", () => {
  test("no cell with that name → resolved is exactly null (NOT undefined)", () => {
    const src = `<program>\${ <count> = 0 }<p>\${@undeclared}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    // B3 fires NO new diagnostic for unresolved @-name. Per A1b plan §4.6
    // line 228: resolution-fail catch-all is "existing infra". B3 records
    // the null annotation; existing infra (or future tightening dispatch)
    // emits the diagnostic.
    const symErrs = sym.errors.filter(e => e.code === "E-NAME-NOT-FOUND" || e.code.startsWith("E-AT-"));
    expect(symErrs.length).toBe(0);

    const idents = collectAtIdents(ast);
    const atUndecl = idents.find(i => i.name === "@undeclared");
    expect(atUndecl).toBeDefined();
    expect(atUndecl.resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §B3.7 — discrimination: bare `count` (no `@`) is NOT annotated
// ---------------------------------------------------------------------------

describe("§B3.7 discrimination — bare `count` (no `@`) is NOT B3-annotated", () => {
  test("bare-name idents are LOCAL identifiers; B3 leaves them alone", () => {
    // We use a function body that has a let-decl `let total = 1` and a
    // non-`@` reference to `total`. Bare-name `total` has no `@` prefix.
    // B3 must NOT stamp `_resolvedStateCell` on it. (B2 fires
    // E-NAME-COLLIDES-STATE if the local shadows a state cell — but here
    // there is no such state cell.)
    const src = `<program>\${
      function inc() { let total = 1; return total + 2 }
    }<p>x</p></program>`;
    const { sym, ast } = buildAndResolve(src);

    // Locate every IdentExpr (regardless of @-prefix) and confirm no
    // non-`@` ident has _resolvedStateCell.
    const EXPR_FIELDS = [
      "exprNode", "initExpr", "argsExpr", "condExpr", "headerExpr",
      "iterExpr", "conditionExpr", "guardExpr", "valueExpr", "rhsExpr",
      "defaultExpr",
      // s461 — an ExprNode LIST (one per reactive-array-mutation argument).
      "argExprs",
    ];
    const seen = new WeakSet();
    const bareIdents = [];
    function walk(n) {
      if (!n || typeof n !== "object") return;
      if (seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) { n.forEach(walk); return; }
      for (const f of EXPR_FIELDS) {
        for (const v of (Array.isArray(n[f]) ? n[f] : [n[f]])) {
          if (v && typeof v === "object" && v.kind) {
            forEachIdentInExprNode(v, (id) => {
              if (typeof id.name === "string" && !id.name.startsWith("@")) {
                bareIdents.push(id);
              }
            });
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === "span" || k === "parent" || k === "block") continue;
        walk(n[k]);
      }
    }
    walk(ast);

    // Anti-folklore: at least one bare ident exists in this corpus.
    expect(bareIdents.length).toBeGreaterThan(0);
    for (const id of bareIdents) {
      // _resolvedStateCell field must be UNDEFINED on bare idents.
      // (PASS 3 only stamps `@`-prefixed idents.)
      expect(getResolvedStateCell(id)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// §B3.8 — function-scoped state cell: `@x` inside fn body resolves
// ---------------------------------------------------------------------------

describe("§B3.8 function-scoped — `@x` inside its declaring fn resolves (V-kill rewrite)", () => {
  test("`@x` reassignment + read in fn body resolves to file-scope structural decl", () => {
    // V-kill (S123): pre-V-kill src was `function f() { @x = 1; return @x + 1 }`
    // — exercising the auto-synth-from-write path where the bare write would
    // silently register `@x` in fn scope. V-kill kills that path. The rewrite
    // adds a structural `<x> = 0` at program top so `@x = 1` is a legal
    // reassignment and `@x + 1` is a legal read. Both resolve to the file-
    // scope structural record. See auto-state-cell-synthesis DD §6 / S123.
    const src = `<program>\${
      <x> = 0
      function f() { @x = 1; return @x + 1 }
    }<p>x</p></program>`;
    const { sym, ast } = buildAndResolve(src);

    const idents = collectAtIdents(ast);
    const atX = idents.filter(i => i.name === "@x");
    expect(atX.length).toBeGreaterThanOrEqual(1);
    for (const at of atX) {
      // All @x references resolve to the FILE-scoped structural decl.
      expect(at.resolved).not.toBeNull();
      expect(at.resolved.name).toBe("x");
      expect(at.resolved.scope.kind).toBe("file");
    }
  });
});

// ---------------------------------------------------------------------------
// §B3.9 — parent-chain: file-level cell visible from nested function
// ---------------------------------------------------------------------------

describe("§B3.9 parent-chain — file-level cell resolves inside fn body", () => {
  test("`<count> = 0` at file root + `@count` in inner fn — resolves via parent walk", () => {
    const src = `<program>\${
      <count> = 0
      function inc() { return @count + 1 }
    }<p>x</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.fileScope.stateCells.has("count")).toBe(true);

    const idents = collectAtIdents(ast);
    const atCount = idents.filter(i => i.name === "@count");
    expect(atCount.length).toBeGreaterThanOrEqual(1);
    for (const at of atCount) {
      expect(at.resolved).not.toBeNull();
      expect(at.resolved.scope).toBe(sym.fileScope); // resolved via parent walk
    }
  });
});

// ---------------------------------------------------------------------------
// §B3.10 — B5-shaped read: every `@`-ident in the AST is annotated
// ---------------------------------------------------------------------------

describe("§B3.10 B5-shaped read — every `@`-prefixed IdentExpr carries annotation", () => {
  test("after runSYM, every reachable @-ident has _resolvedStateCell defined", () => {
    // Mixed corpus: file-level cell, fn body, derived cell, markup interp.
    const src = `<program>\${
      <count> = 0
      const <doubled> = @count * 2
      function inc() { @count = @count + 1 }
    }<p>\${@count} / \${@doubled}</p></program>`;
    const { sym, ast } = buildAndResolve(src);
    expect(sym.errors.length).toBe(0);

    const idents = collectAtIdents(ast);
    expect(idents.length).toBeGreaterThan(0);
    for (const i of idents) {
      // The contract that B5+ relies on: every @-prefixed ident has a
      // STAMPED annotation (StateCellRecord OR null) — never undefined.
      expect(getResolvedStateCell(i.ident)).not.toBeUndefined();
    }
    // And every one in this corpus resolves.
    for (const i of idents) {
      expect(i.resolved).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §B3.11 — getResolvedStateCell return-shape contract
// ---------------------------------------------------------------------------

describe("§B3.11 getResolvedStateCell — return-shape contract", () => {
  test("null input → undefined; resolved-record input → record; null annotation → null", () => {
    expect(getResolvedStateCell(null)).toBeUndefined();
    expect(getResolvedStateCell(undefined)).toBeUndefined();

    const src = `<program>\${ <a> = 0 }<p>\${@a} \${@nope}</p></program>`;
    const { ast } = buildAndResolve(src);
    const idents = collectAtIdents(ast);
    const atA = idents.find(i => i.name === "@a");
    const atNope = idents.find(i => i.name === "@nope");
    expect(atA).toBeDefined();
    expect(atNope).toBeDefined();
    // Resolved → record (truthy, has name).
    expect(getResolvedStateCell(atA.ident)).not.toBeNull();
    expect(getResolvedStateCell(atA.ident).name).toBe("a");
    // Unresolved → null.
    expect(getResolvedStateCell(atNope.ident)).toBeNull();
  });
});
