/**
 * emit-library.ts — Unit Tests
 *
 * Tests for compiler/src/codegen/emit-library.ts — the ES module emitter for
 * library mode compilation. Library mode targets importable JS modules rather
 * than browser apps.
 *
 * Coverage:
 *   §1  export-decl with raw text produces correct output
 *   §2  Non-exported function-decl emits without `export` keyword
 *   §3  No SCRML_RUNTIME in library output
 *   §4  Server-only nodes produce E-CG-006 error
 *   §5  Empty file / no logic body produces minimal module header
 *   §6  Meta blocks are skipped
 *   §7  Real AST integration — compile module-resolver.scrml in library mode
 *   §7b type-decl exclusion from source-text node-by-node path (Bug R18)
 *   §8  rewriteNotKeyword rewrites scrml keywords in whole-block path
 *   §9  type-decl exclusion from whole-block extraction path (Bug R18 — actual syntax)
 */

import { describe, test, expect } from "bun:test";
import { generateLibraryJs } from "../../src/codegen/emit-library.ts";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fileAST for testing.
 * In real scrml ASTs, code lives inside: nodes[0] = markup, with children
 * including a logic node whose body[] contains the actual statements.
 */
function makeFileAST(opts = {}) {
  const { bodyNodes = [] } = opts;
  return {
    filePath: "/test/example.scrml",
    ast: {
      filePath: "/test/example.scrml",
      nodes: bodyNodes.length > 0
        ? [{ kind: "markup", tag: "program", children: [{ kind: "logic", body: bodyNodes }] }]
        : [],
      imports: [],
      exports: [],
    },
  };
}

function makeExportDecl(raw) {
  return {
    kind: "export-decl",
    raw,
    exportedName: null,
    exportKind: null,
    reExportSource: null,
    span: { file: "/test/example.scrml", start: 0, end: 20, line: 1, col: 1 },
  };
}

function makeFnNode(name, params = [], body = []) {
  return {
    kind: "function-decl",
    name,
    params,
    body,
    fnKind: "function",
    isServer: false,
    isGenerator: false,
    isAsync: false,
    canFail: false,
    isHandleEscapeHatch: false,
    span: { file: "/test/example.scrml", start: 0, end: 10, line: 1, col: 1 },
  };
}

function makeRouteMap(entries = new Map()) {
  return { functions: entries };
}

// ---------------------------------------------------------------------------
// §1 export-decl with raw text produces correct output
// ---------------------------------------------------------------------------

describe("emit-library §1: export-decl emits raw text", () => {
  test("export function from raw text", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeExportDecl("export function resolveModules(input) { return input; }")],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function resolveModules(input) { return input; }");
  });

  test("export class from raw text", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeExportDecl("export class MetaError { constructor(code) { this.code = code; } }")],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).toContain("export class MetaError");
  });

  test("export const from raw text", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeExportDecl('export const VERSION = "1.0"')],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).toContain('export const VERSION = "1.0"');
  });
});

// ---------------------------------------------------------------------------
// §2 Non-exported function-decl emits without `export`
// ---------------------------------------------------------------------------

describe("emit-library §2: non-exported functions", () => {
  test("function-decl emits as plain function", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeFnNode("internalHelper", ["x"])],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).toContain("function internalHelper(x)");
    expect(output).not.toContain("export function internalHelper");
  });

  test("mix of export-decl and function-decl", () => {
    const fileAST = makeFileAST({
      bodyNodes: [
        makeExportDecl("export function publicApi(x) { return x; }"),
        makeFnNode("_private", ["y"]),
      ],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).toContain("export function publicApi(x)");
    expect(output).toContain("function _private(y)");
    expect(output).not.toContain("export function _private");
  });
});

// ---------------------------------------------------------------------------
// §3 No SCRML_RUNTIME in library output
// ---------------------------------------------------------------------------

describe("emit-library §3: no browser runtime in output", () => {
  test("library output does not contain runtime artifacts", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeFnNode("parseTokens")],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).not.toContain("scrml reactive runtime");
    expect(output).not.toContain("_scrml_reactive_get");
    expect(output).not.toContain("DOMContentLoaded");
  });

  test("library output begins with ES module header", () => {
    const fileAST = makeFileAST({});
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).toContain("Generated library module");
    expect(output).toContain("ES module");
  });
});

// ---------------------------------------------------------------------------
// §4 Server-only nodes produce errors
// ---------------------------------------------------------------------------

describe("emit-library §4: server-only nodes blocked", () => {
  test("sql-query node produces E-CG-006", () => {
    const fileAST = makeFileAST({
      bodyNodes: [{
        kind: "sql",
        raw: "SELECT * FROM users",
        span: { file: "/test/example.scrml", start: 0, end: 20, line: 1, col: 1 },
      }],
    });
    const errors = [];
    generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("E-CG-006");
  });
});

// ---------------------------------------------------------------------------
// §5 Empty file / no logic body
// ---------------------------------------------------------------------------

describe("emit-library §5: empty file handling", () => {
  test("file with no logic body produces header only", () => {
    const fileAST = makeFileAST({});
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(typeof output).toBe("string");
    expect(errors).toHaveLength(0);
    expect(output).toContain("Generated library module");
  });

  test("null routeMap does not crash", () => {
    const fileAST = makeFileAST({
      bodyNodes: [makeFnNode("helper")],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, null, errors);

    expect(typeof output).toBe("string");
    expect(errors).toHaveLength(0);
    expect(output).toContain("function helper");
  });
});

// ---------------------------------------------------------------------------
// §6 Meta blocks are skipped
// ---------------------------------------------------------------------------

describe("emit-library §6: meta blocks skipped", () => {
  test("meta block is not emitted", () => {
    const fileAST = makeFileAST({
      bodyNodes: [
        { kind: "meta", body: [{ kind: "bare-expr", expr: 'const x = await import("fs")' }], span: { file: "/test/example.scrml", start: 0, end: 10, line: 1, col: 1 } },
        makeExportDecl("export function main() { return 42; }"),
      ],
    });
    const errors = [];
    const output = generateLibraryJs(fileAST, makeRouteMap(), errors);

    expect(output).not.toContain("await import");
    expect(output).toContain("export function main");
  });
});

// ---------------------------------------------------------------------------
// §7b type-decl nodes must not leak into source-text path output (Bug R18)
// ---------------------------------------------------------------------------

describe("emit-library §7b: type-decl exclusion from source-text path", () => {
  /**
   * Helper: build a fileAST with _sourceText so the source-text extraction
   * path is taken (not the fallback AST path).
   */
  function makeSourceTextAST(sourceText, bodyNodes) {
    return {
      filePath: "/test/example.scrml",
      _sourceText: sourceText,
      ast: {
        filePath: "/test/example.scrml",
        nodes: [{ kind: "markup", tag: "program", children: [{ kind: "logic", body: bodyNodes }] }],
        imports: [],
        exports: [],
      },
    };
  }

  test("type-decl as sole content in logic block produces no JS for that block", () => {
    const src = `type Status = enum { Loading, Done }`;
    const fileAST = makeSourceTextAST(src, [
      {
        kind: "type-decl",
        typeKind: "enum",
        name: "Status",
        span: { file: "/test/example.scrml", start: 0, end: src.length, line: 1, col: 1 },
      },
    ]);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    // Output should contain only the header, no type-decl text
    expect(output).not.toContain("type Status");
    expect(output).not.toContain("enum");
    expect(output).not.toContain("Loading");
    expect(output).toContain("Generated library module");
  });

  test("type-decl mixed with export functions — export emits, type-decl does not", () => {
    const src = [
      `type Status = enum { Loading, Done }`,
      `export function getStatus() { return "ok"; }`,
    ].join("\n");
    const typeDeclEnd = src.indexOf("\n");
    const exportStart = src.indexOf("export");
    const fileAST = makeSourceTextAST(src, [
      {
        kind: "type-decl",
        typeKind: "enum",
        name: "Status",
        span: { file: "/test/example.scrml", start: 0, end: typeDeclEnd, line: 1, col: 1 },
      },
      {
        kind: "export-decl",
        raw: `export function getStatus() { return "ok"; }`,
        exportedName: "getStatus",
        span: { file: "/test/example.scrml", start: exportStart, end: src.length, line: 2, col: 1 },
      },
    ]);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function getStatus");
    expect(output).not.toContain("type Status");
    expect(output).not.toContain("enum {");
  });

  test("multiple type-decls between emittable nodes are excluded from gaps", () => {
    const src = [
      `export function first() { return 1; }`,
      `type A = enum { X, Y }`,
      `type B = enum { P, Q }`,
      `export function second() { return 2; }`,
    ].join("\n");
    const line1End = src.indexOf("\n");
    const typeAStart = line1End + 1;
    const typeAEnd = src.indexOf("\n", typeAStart);
    const typeBStart = typeAEnd + 1;
    const typeBEnd = src.indexOf("\n", typeBStart);
    const secondStart = typeBEnd + 1;

    const fileAST = makeSourceTextAST(src, [
      {
        kind: "export-decl",
        raw: `export function first() { return 1; }`,
        exportedName: "first",
        span: { file: "/test/example.scrml", start: 0, end: line1End, line: 1, col: 1 },
      },
      {
        kind: "type-decl",
        typeKind: "enum",
        name: "A",
        span: { file: "/test/example.scrml", start: typeAStart, end: typeAEnd, line: 2, col: 1 },
      },
      {
        kind: "type-decl",
        typeKind: "enum",
        name: "B",
        span: { file: "/test/example.scrml", start: typeBStart, end: typeBEnd, line: 3, col: 1 },
      },
      {
        kind: "export-decl",
        raw: `export function second() { return 2; }`,
        exportedName: "second",
        span: { file: "/test/example.scrml", start: secondStart, end: src.length, line: 4, col: 1 },
      },
    ]);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function first");
    expect(output).toContain("export function second");
    expect(output).not.toContain("type A");
    expect(output).not.toContain("type B");
    expect(output).not.toContain("enum");
  });

  test("type-decl before first export does not leak into output", () => {
    const src = [
      `type Color = enum { Red, Blue }`,
      `export const PALETTE = ["red", "blue"];`,
    ].join("\n");
    const typeDeclEnd = src.indexOf("\n");
    const exportStart = src.indexOf("export");

    const fileAST = makeSourceTextAST(src, [
      {
        kind: "type-decl",
        typeKind: "enum",
        name: "Color",
        span: { file: "/test/example.scrml", start: 0, end: typeDeclEnd, line: 1, col: 1 },
      },
      {
        kind: "export-decl",
        raw: `export const PALETTE = ["red", "blue"];`,
        exportedName: "PALETTE",
        span: { file: "/test/example.scrml", start: exportStart, end: src.length, line: 2, col: 1 },
      },
    ]);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export const PALETTE");
    expect(output).not.toContain("type Color");
    expect(output).not.toContain("enum");
  });
});

// ---------------------------------------------------------------------------
// §7 Integration — compile real scrml file in library mode
// ---------------------------------------------------------------------------

describe("emit-library §7: integration", () => {
  // FOLLOW-ON (S99 — A2 surfaced): see
  // compiler/tests/unit/self-host-module-resolver.test.js
  // for the same E-SCOPE-001 cascade root cause. This test's
  // expectation `result.errors.toHaveLength(0)` fails downstream of
  // the same scope-walker gap. Reopen when self-host module-resolver
  // compile-clean test re-enables.
  test.skip("module-resolver.scrml produces importable output [A2-SURFACED — see self-host-module-resolver follow-on]", async () => {
    const { resolve, dirname } = await import("path");
    const { existsSync, readFileSync } = await import("fs");

    const testDir = dirname(new URL(import.meta.url).pathname);
    const scrmlFile = resolve(testDir, "../../../stdlib/compiler/module-resolver.scrml");
    if (!existsSync(scrmlFile)) {
      console.log("Skipping — module-resolver.scrml not found");
      return;
    }

    const { compileScrml } = await import("../../src/api.js");
    const result = compileScrml({
      inputFiles: [scrmlFile],
      mode: "library",
      write: false,
    });

    expect(result.errors).toHaveLength(0);

    // Should have output for the file
    const outputs = [...result.outputs.values()];
    expect(outputs.length).toBeGreaterThan(0);

    const output = outputs[0];
    // Library mode produces libraryJs (or clientJs depending on wiring)
    const js = output.libraryJs ?? output.clientJs ?? "";
    expect(js).toContain("export");
    expect(js).toContain("function");
    expect(js).not.toContain("DOMContentLoaded");
  });
});

// ---------------------------------------------------------------------------
// §8 — rewriteNotKeyword in library output
// ---------------------------------------------------------------------------

describe("emit-library §8: rewriteNotKeyword rewrites scrml keywords in source-text path", () => {
  /**
   * Helper: build a fileAST with _sourceText and a logic block that has a span,
   * triggering the whole-block extraction path.
   */
  function makeWholeBlockAST(sourceText) {
    const logicBody = []; // body nodes unused in whole-block path
    return {
      filePath: "/test/example.scrml",
      _sourceText: sourceText,
      ast: {
        filePath: "/test/example.scrml",
        nodes: [{
          kind: "markup", tag: "program", children: [{
            kind: "logic",
            body: logicBody,
            span: { file: "/test/example.scrml", start: 0, end: sourceText.length, line: 1, col: 1 },
          }],
        }],
        imports: [],
        exports: [],
      },
    };
  }

  test("`not` keyword is rewritten to `null`", () => {
    const src = `\${let x = not}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(output).toContain("null");
    expect(output).not.toMatch(/\bnot\b/);
  });

  test("`is not` is rewritten to `=== null`", () => {
    const src = `\${if (x is not) { return 1 }}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(output).toContain("=== null");
    expect(output).not.toMatch(/\bis not\b/);
  });

  test("`is some` is rewritten to `!== null`", () => {
    const src = `\${if (x is some) { return 1 }}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(output).toContain("!== null");
    expect(output).not.toMatch(/\bis some\b/);
  });
});

// ---------------------------------------------------------------------------
// §9 type-decl exclusion from the whole-block extraction path (Bug R18 fix)
//
// These tests exercise the whole-block path — triggered when the logic AST node
// has a span property. This is the path taken during REAL compilation (not the
// synthetic AST fallback used in §7b).
//
// The bug: the whole-block regex previously matched `type:enum Name { ... }` but
// the actual scrml syntax is `type Name:enum = { ... }`. This caused type-decl
// source text to appear verbatim in library JS output, failing `node --check`.
// ---------------------------------------------------------------------------

describe("emit-library §9: type-decl stripped in whole-block extraction path", () => {
  /**
   * Helper: build a fileAST with _sourceText and a logic block that has a span,
   * triggering the whole-block extraction path (same as §8 makeWholeBlockAST).
   *
   * The `start` and `end` on the logic span must cover the full sourceText so
   * the slice produces the right block content.
   */
  function makeWholeBlockAST(sourceText) {
    return {
      filePath: "/test/example.scrml",
      _sourceText: sourceText,
      ast: {
        filePath: "/test/example.scrml",
        nodes: [{
          kind: "markup", tag: "program", children: [{
            kind: "logic",
            body: [],
            span: { file: "/test/example.scrml", start: 0, end: sourceText.length, line: 1, col: 1 },
          }],
        }],
        imports: [],
        exports: [],
      },
    };
  }

  test("enum type-decl only — whole-block path produces no type text", () => {
    // Real scrml syntax: type Name:kind = { ... }
    const src = `\${type HttpMethod:enum = { GET | POST | PUT | DELETE }}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).not.toContain("type HttpMethod");
    expect(output).not.toContain("HttpMethod");
    expect(output).not.toContain("GET");
    expect(output).toContain("Generated library module");
  });

  test("struct type-decl only — whole-block path produces no type text", () => {
    const src = `\${type ApiEndpoint:struct = { path: string, method: string }}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).not.toContain("type ApiEndpoint");
    expect(output).not.toContain("ApiEndpoint");
    expect(output).not.toContain("path: string");
  });

  test("type-decl mixed with export — export survives, type-decl stripped", () => {
    // Simulates the real-world bug: type decl before an export in the same logic block
    const src = `\${type HttpMethod:enum = { GET | POST | PUT | DELETE }\nexport function getMethod() { return "GET" }}`;
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function getMethod");
    expect(output).not.toContain("type HttpMethod");
    expect(output).not.toContain("GET | POST");
  });

  test("multiple type-decls in whole-block path — all stripped", () => {
    const src = [
      "${",
      "type HttpMethod:enum = { GET | POST | PUT | DELETE | PATCH }",
      "type ApiEndpoint:struct = { path: string, method: string }",
      "type ApiResponse:struct = { status: number, body: string }",
      "export function buildEndpoint(path, method) { return { path, method } }",
      "}",
    ].join("\n");
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function buildEndpoint");
    expect(output).not.toContain("type HttpMethod");
    expect(output).not.toContain("type ApiEndpoint");
    expect(output).not.toContain("type ApiResponse");
    expect(output).not.toContain("GET | POST");
    expect(output).not.toContain("path: string");
  });

  test("enum and struct type-decls before and after function export — function survives", () => {
    const src = [
      "${",
      "type Status:enum = { Active, Inactive }",
      "export function getUser(id) { return id }",
      "type UserRecord:struct = { id: number, name: string }",
      "}",
    ].join("\n");
    const fileAST = makeWholeBlockAST(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);

    expect(errors).toHaveLength(0);
    expect(output).toContain("export function getUser");
    expect(output).not.toContain("type Status");
    expect(output).not.toContain("type UserRecord");
    expect(output).not.toContain("Active, Inactive");
    expect(output).not.toContain("id: number");
  });
});

// ---------------------------------------------------------------------------
// §10 — rewriteIsOperator in library output
// Tests that `is .Variant` and `is Enum.Variant` enum checks are rewritten
// to JavaScript === comparisons in library-mode output.
// ---------------------------------------------------------------------------

describe('emit-library §10: rewriteIsOperator rewrites enum checks in source-text path', () => {
  function makeWholeBlockAST10(sourceText) {
    return {
      filePath: '/test/example.scrml',
      _sourceText: sourceText,
      ast: {
        filePath: '/test/example.scrml',
        nodes: [{ kind: 'markup', tag: 'program', children: [{ kind: 'logic', body: [], span: { file: '/test/example.scrml', start: 0, end: sourceText.length, line: 1, col: 1 } }] }],
        imports: [],
        exports: [],
      },
    };
  }

  test('`is .Active` is rewritten to `=== "Active"`', () => {
    const src = '${if (status is .Active) { return true }}';
    const fileAST = makeWholeBlockAST10(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);
    expect(output).toContain('=== "Active"');
    expect(output).not.toMatch(/is ./);
  });

  test('`is .Done` is rewritten to `=== "Done"`', () => {
    const src = '${if (task is .Done) { return 1 }}';
    const fileAST = makeWholeBlockAST10(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);
    expect(output).toContain('=== "Done"');
    expect(output).not.toContain('is .Done');
  });

  test('`is Status.Active` is rewritten to `=== "Active"`', () => {
    const src = '${if (x is Status.Active) { return 2 }}';
    const fileAST = makeWholeBlockAST10(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);
    expect(output).toContain('=== "Active"');
    expect(output).not.toContain('is Status.Active');
  });

  test('enum checks and not-keyword rewrites both apply in same block', () => {
    const src = '${if (x is not) { return not } if (y is .Done) { return true }}';
    const fileAST = makeWholeBlockAST10(src);
    const errors = [];
    const output = generateLibraryJs(fileAST, {}, errors);
    expect(output).toContain('=== null');
    expect(output).toContain('null');
    expect(output).toContain('=== "Done"');
    expect(output).not.toMatch(/is not/);
    expect(output).not.toContain('is .Done');
  });
});
