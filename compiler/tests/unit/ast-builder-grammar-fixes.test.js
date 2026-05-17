/**
 * ast-builder-grammar-fixes — three small grammar findings.
 *
 * F1: `export function NAME() {...}` — synthesize a sibling function-decl
 *     AST node so walkers can discover the function. The export-decl is
 *     unchanged; the function-decl is marked `fromExport: true` and
 *     `exported: true` and is skipped by codegen emitters (export-decl
 *     raw text already covers emission).
 *
 * F2: `export * from './x'` — re-export-all parses; export-decl carries
 *     `exportKind: "re-export-all"`, `isReExportAll: true`, and the
 *     `reExportSource` path. Module-resolver emits a `name: "*"` entry.
 *
 * F3: `export { A as B } from './x'` and `export { A as B }` — renamed
 *     re-export and local rename. export-decl carries a `renames` array
 *     of `{ exported, local }` pairs. `exportedName` is the comma-joined
 *     OUTWARD names. Module-resolver attaches a `localName` to each
 *     per-name entry.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(src) {
  const filePath = "/test/fixture.scrml";
  const bs = splitBlocks(filePath, src);
  return buildAST(bs);
}

function findExports(result) {
  return result.ast?.exports ?? [];
}

function findAllNodesOfKind(ast, kind) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === kind) out.push(n);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && k !== "span") walk(v);
    }
  }
  walk(ast);
  return out;
}

// ---------------------------------------------------------------------------
// F1 — `export function` synthesizes a reachable function-decl
// ---------------------------------------------------------------------------

describe("F1: export function synthesizes a sibling function-decl", () => {
  test("export function foo() {} produces export-decl AND function-decl", () => {
    const result = parse("${ export function foo() { return 1 } }");
    const exports = findExports(result);
    expect(exports.length).toBe(1);
    expect(exports[0].exportedName).toBe("foo");
    expect(exports[0].exportKind).toBe("function");

    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.filter(n => n.fromExport === true);
    expect(synthetic.length).toBe(1);
    expect(synthetic[0].name).toBe("foo");
    expect(synthetic[0].exported).toBe(true);
    expect(synthetic[0].fromExport).toBe(true);
    expect(synthetic[0].fnKind).toBe("function");
  });

  test("export server function foo() {} carries isServer flag on synthetic fn-decl", () => {
    const result = parse("${ export server function getUser(id) { return id } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true);
    expect(synthetic).toBeDefined();
    expect(synthetic.name).toBe("getUser");
    expect(synthetic.isServer).toBe(true);
    expect(synthetic.exported).toBe(true);
  });

  test("export pure function foo() {} carries isPure flag on synthetic fn-decl", () => {
    const result = parse("${ export pure function clamp(x) { return x } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true);
    expect(synthetic).toBeDefined();
    expect(synthetic.name).toBe("clamp");
    expect(synthetic.isPure).toBe(true);
  });

  test("export fn shorthand also synthesizes function-decl", () => {
    const result = parse("${ export fn double(n) { return n * 2 } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true);
    expect(synthetic).toBeDefined();
    expect(synthetic.name).toBe("double");
    expect(synthetic.fnKind).toBe("fn");
  });

  test("regular `function foo() {}` (no export) NOT marked fromExport", () => {
    const result = parse("${ function bar() { return 2 } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    expect(fnDecls.length).toBe(1);
    expect(fnDecls[0].fromExport).toBeUndefined();
    expect(fnDecls[0].name).toBe("bar");
  });

  // -------------------------------------------------------------------------
  // Anomaly 2 (S99) — synth function-decl populates params + body
  //
  // Pre-fix, the synth function-decl emitted `params: []` and `body: []`,
  // relying on emit-library.ts's sourceText-slice path for stdlib emit.
  // That assumption failed for the SPA-shape client emit path
  // (emit-functions.ts) which compiles function-decl into JS using
  // params + body — empty body produced `function _scrml_NAME_N() {}`
  // in `.client.js` output (M1.1 native-parser .scrml reproducer).
  //
  // Fix: re-parse the original source-text slice for `export function|fn`
  // shapes so params + body are populated alongside the existing
  // `fromExport: true` flag. The flag is preserved so emit-library.ts
  // continues to skip these stubs.
  // -------------------------------------------------------------------------

  test("Anomaly 2: synth function-decl has populated params (named)", () => {
    const result = parse("${ export function makeSpan(start, end, line, col) { return { start, end, line, col } } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true && n.name === "makeSpan");
    expect(synthetic).toBeDefined();
    expect(Array.isArray(synthetic.params)).toBe(true);
    expect(synthetic.params.length).toBe(4);
    expect(synthetic.params.map(p => (typeof p === "string" ? p : p.name))).toEqual([
      "start", "end", "line", "col",
    ]);
  });

  test("Anomaly 2: synth function-decl has populated body (return-stmt)", () => {
    const result = parse("${ export function makeSpan(start, end) { return { start, end } } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true && n.name === "makeSpan");
    expect(synthetic).toBeDefined();
    expect(Array.isArray(synthetic.body)).toBe(true);
    expect(synthetic.body.length).toBe(1);
    expect(synthetic.body[0].kind).toBe("return-stmt");
    // The return-stmt expr should reference the original idents.
    expect(synthetic.body[0].expr).toContain("start");
    expect(synthetic.body[0].expr).toContain("end");
  });

  test("Anomaly 2: export fn shorthand also has populated body", () => {
    const result = parse("${ export fn double(n) { n * 2 } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true && n.name === "double");
    expect(synthetic).toBeDefined();
    expect(synthetic.fnKind).toBe("fn");
    expect(Array.isArray(synthetic.params)).toBe(true);
    expect(synthetic.params.length).toBe(1);
    expect((typeof synthetic.params[0] === "string" ? synthetic.params[0] : synthetic.params[0].name)).toBe("n");
    expect(Array.isArray(synthetic.body)).toBe(true);
    expect(synthetic.body.length).toBeGreaterThan(0);
  });

  test("Anomaly 2: synth function-decl body preserves multi-statement structure", () => {
    const result = parse(`\${
      export function compute(a, b) {
        const sum = a + b
        const product = a * b
        return { sum, product }
      }
    }`);
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.fromExport === true && n.name === "compute");
    expect(synthetic).toBeDefined();
    expect(Array.isArray(synthetic.body)).toBe(true);
    // 2 const-decls + 1 return-stmt = 3 body nodes.
    expect(synthetic.body.length).toBe(3);
    const kinds = synthetic.body.map(s => s.kind);
    expect(kinds).toContain("return-stmt");
  });

  test("Anomaly 2: synth function-decl preserves fromExport flag for emit-library skip", () => {
    // Regression: the fix must NOT drop fromExport: true. emit-library.ts
    // (AST-fallback path) skips synth stubs via `fromExport === true`.
    // Dropping the flag would cause double-emission in stdlib bundle output.
    const result = parse("${ export function helper(x) { return x + 1 } }");
    const fnDecls = findAllNodesOfKind(result.ast, "function-decl");
    const synthetic = fnDecls.find(n => n.name === "helper");
    expect(synthetic).toBeDefined();
    expect(synthetic.fromExport).toBe(true);
    expect(synthetic.exported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F2 — `export *` re-export-all
// ---------------------------------------------------------------------------

describe("F2: export * from './path' parses as re-export-all", () => {
  test("export * from './x.scrml'", () => {
    const result = parse("${ export * from './x.scrml' }");
    const exports = findExports(result);
    expect(exports.length).toBe(1);
    const exp = exports[0];
    expect(exp.exportKind).toBe("re-export-all");
    expect(exp.exportedName).toBe("*");
    expect(exp.isReExportAll).toBe(true);
    expect(exp.reExportSource).toBe("./x.scrml");
  });

  test("export * from \"./y\" with double quotes", () => {
    const result = parse('${ export * from "./y.scrml" }');
    const exp = findExports(result)[0];
    expect(exp.isReExportAll).toBe(true);
    expect(exp.reExportSource).toBe("./y.scrml");
  });
});

// ---------------------------------------------------------------------------
// F3 — `export { A as B }` renamed re-export and local rename
// ---------------------------------------------------------------------------

describe("F3: renamed re-exports and local renames", () => {
  test("export { A as B } from './x' captures rename", () => {
    const result = parse("${ export { A as B } from './x.scrml' }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("re-export");
    expect(exp.exportedName).toBe("B");
    expect(exp.reExportSource).toBe("./x.scrml");
    expect(Array.isArray(exp.renames)).toBe(true);
    expect(exp.renames).toEqual([{ exported: "B", local: "A" }]);
  });

  test("export { A, B as C, D } from './x' — mixed rename", () => {
    const result = parse("${ export { A, B as C, D } from './x.scrml' }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("re-export");
    expect(exp.exportedName).toBe("A, C, D");
    expect(exp.renames).toEqual([
      { exported: "A", local: "A" },
      { exported: "C", local: "B" },
      { exported: "D", local: "D" },
    ]);
  });

  test("export { A as B } (local rename, no `from`)", () => {
    const result = parse("${ export { A as B } }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("rename");
    expect(exp.exportedName).toBe("B");
    expect(exp.reExportSource).toBeNull();
    expect(exp.renames).toEqual([{ exported: "B", local: "A" }]);
  });

  test("export { A } (local re-statement, no rename) tagged `local`", () => {
    const result = parse("${ export { A } }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("local");
    expect(exp.exportedName).toBe("A");
    expect(exp.reExportSource).toBeNull();
    expect(exp.renames).toEqual([{ exported: "A", local: "A" }]);
  });
});

// ---------------------------------------------------------------------------
// Regression — existing forms still parse the same
// ---------------------------------------------------------------------------

describe("regression: existing export forms unchanged", () => {
  test("export const NAME = ...", () => {
    const result = parse("${ export const MAX = 100 }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("const");
    expect(exp.exportedName).toBe("MAX");
    expect(exp.isReExportAll).toBe(false);
  });

  test("export type Name:enum = {...}", () => {
    const result = parse("${ export type Status:enum = { On Off } }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("type");
    expect(exp.exportedName).toBe("Status");
    // Type synthesis still produces a sibling type-decl (pre-existing).
    const typeDecls = findAllNodesOfKind(result.ast, "type-decl");
    expect(typeDecls.find(t => t.name === "Status" && t.fromExport)).toBeDefined();
  });

  test("export { A, B } from './x' — multi-name re-export still works", () => {
    const result = parse("${ export { A, B } from './x.scrml' }");
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("re-export");
    expect(exp.exportedName).toBe("A, B");
    expect(exp.reExportSource).toBe("./x.scrml");
  });

  test("export { Button } from './ui' — single-name re-export (canary)", () => {
    const result = parse('${ export { Button } from "./ui" }');
    const exp = findExports(result)[0];
    expect(exp.exportKind).toBe("re-export");
    expect(exp.exportedName).toBe("Button");
    expect(exp.reExportSource).toBe("./ui");
    // No rename → renames carries identity entry.
    expect(exp.renames).toEqual([{ exported: "Button", local: "Button" }]);
  });
});

// ---------------------------------------------------------------------------
// Module-resolver propagation — new shapes reach the import graph
// ---------------------------------------------------------------------------

describe("module-resolver propagates F2/F3 shapes", () => {
  test("export * from './x' produces a re-export-all graph entry", async () => {
    const filePath = "/test/index.scrml";
    const result = parse("${ export * from './x.scrml' }");
    result.ast.filePath = filePath;
    const { resolveModules } = await import("../../src/module-resolver.js");
    const resolved = resolveModules([{ filePath, ast: result.ast }]);
    const graphEntry = resolved.importGraph.get(filePath);
    expect(graphEntry).toBeDefined();
    const reExportAll = graphEntry.exports.find(e => e.isReExportAll === true);
    expect(reExportAll).toBeDefined();
    expect(reExportAll.kind).toBe("re-export-all");
    expect(reExportAll.name).toBe("*");
    expect(reExportAll.reExportSource).toBeDefined();
  });

  test("export { A as B } from './x' — entry carries localName='A', name='B'", async () => {
    const filePath = "/test/index.scrml";
    const result = parse("${ export { A as B } from './x.scrml' }");
    result.ast.filePath = filePath;
    const { resolveModules } = await import("../../src/module-resolver.js");
    const resolved = resolveModules([{ filePath, ast: result.ast }]);
    const graphEntry = resolved.importGraph.get(filePath);
    const entry = graphEntry.exports.find(e => e.name === "B");
    expect(entry).toBeDefined();
    expect(entry.localName).toBe("A");
    expect(entry.name).toBe("B");
    expect(entry.kind).toBe("re-export");
  });

  test("export { A } from './x' — entry has localName === name", async () => {
    const filePath = "/test/index.scrml";
    const result = parse("${ export { A } from './x.scrml' }");
    result.ast.filePath = filePath;
    const { resolveModules } = await import("../../src/module-resolver.js");
    const resolved = resolveModules([{ filePath, ast: result.ast }]);
    const graphEntry = resolved.importGraph.get(filePath);
    const entry = graphEntry.exports.find(e => e.name === "A");
    expect(entry).toBeDefined();
    expect(entry.localName).toBe("A");
  });
});
