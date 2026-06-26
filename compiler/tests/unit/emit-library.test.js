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
 *   §11 §19 host-containment `!{}` call-site handler lowered in library mode
 *       (ss23 item 1 — was E-CODEGEN-INVALID-JS, verbatim `!{}` survived)
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
  // RESOLVED (A1 — S99 cascade): see
  // compiler/tests/unit/self-host-module-resolver.test.js — the
  // scope-walker gap that caused module-resolver.scrml's E-SCOPE-001
  // cascade is fixed in changes/a1-scope-walker-export-class-closures
  // (commits 8f16e01 + 92ce1f3 + de7af98).
  test("module-resolver.scrml produces importable output [A2-SURFACED — fixed by A1]", async () => {
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

// ---------------------------------------------------------------------------
// §11 — GITI-018: rewriteStdlibImports rewrites EVERY scrml: import per file
//
// Regression: the rewriter's regex anchored `^import` with no allowance for
// leading indentation. In library emit only the FIRST import is de-indented
// to column 0; subsequent imports keep their source indentation, so they did
// not match and stayed as bare `scrml:NAME` specifiers (Bun then fails with
// `Cannot resolve invalid URL 'scrml:fs'`). A leading comment before the
// imports also defeated even the first one. The fix tolerates leading
// horizontal whitespace and round-trips it.
// ---------------------------------------------------------------------------

describe("emit-library §11: GITI-018 — all scrml: imports rewritten (not first-only)", () => {
  test("indented + de-indented imports all rewrite (unit on rewriteStdlibImports)", async () => {
    const { rewriteStdlibImports } = await import("../../src/api.js");
    // Mirrors real library emit: first import at column 0, rest indented.
    const jsCode =
      'import { resolve } from "scrml:path"\n' +
      '    import { existsSync } from "scrml:fs"\n' +
      '    import { cwd } from "scrml:process"\n' +
      '    export function probe() { return resolve(cwd(), existsSync("/")); }\n';
    const bundled = new Set(["path", "fs", "process"]);
    const out = rewriteStdlibImports(jsCode, "/out", "/out", bundled);

    // All three rewritten — zero bare `scrml:` specifiers remain.
    expect(out).not.toMatch(/scrml:/);
    expect(out).toContain('"./_scrml/path.js"');
    expect(out).toContain('"./_scrml/fs.js"');
    expect(out).toContain('"./_scrml/process.js"');
    // Indentation of the non-first imports is preserved.
    expect(out).toContain('    import { existsSync } from "./_scrml/fs.js"');
    expect(out).toContain('    import { cwd } from "./_scrml/process.js"');
  });

  test("leading comment before imports does not suppress rewriting", async () => {
    const { rewriteStdlibImports } = await import("../../src/api.js");
    const jsCode =
      '// leading comment\n' +
      '    import { resolve } from "scrml:path"\n' +
      '    import { existsSync } from "scrml:fs"\n';
    const bundled = new Set(["path", "fs"]);
    const out = rewriteStdlibImports(jsCode, "/out", "/out", bundled);
    expect(out).not.toMatch(/scrml:/);
    expect(out).toContain('"./_scrml/path.js"');
    expect(out).toContain('"./_scrml/fs.js"');
  });

  test("unbundled names are left bare (no shim available)", async () => {
    const { rewriteStdlibImports } = await import("../../src/api.js");
    const jsCode =
      'import { resolve } from "scrml:path"\n' +
      '    import { foo } from "scrml:notbundled"\n';
    const bundled = new Set(["path"]); // notbundled deliberately absent
    const out = rewriteStdlibImports(jsCode, "/out", "/out", bundled);
    expect(out).toContain('"./_scrml/path.js"');
    expect(out).toContain('"scrml:notbundled"'); // untouched — fails loudly at runtime by design
  });

  test("integration: 3-stdlib-import file compiles to disk with zero bare scrml: specifiers", async () => {
    const { resolve } = await import("path");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { compileScrml } = await import("../../src/api.js");

    const dir = mkdtempSync(resolve(tmpdir(), "giti-018-"));
    try {
      const srcPath = resolve(dir, "probe.scrml");
      writeFileSync(
        srcPath,
        '${\n' +
        '    import { resolve } from "scrml:path"\n' +
        '    import { existsSync } from "scrml:fs"\n' +
        '    import { cwd } from "scrml:process"\n' +
        '    export function probe() {\n' +
        '        return resolve(cwd(), existsSync("/") ? "yes" : "no")\n' +
        '    }\n' +
        '}\n',
        "utf8",
      );
      const outDir = resolve(dir, "out");
      const result = compileScrml({
        inputFiles: [srcPath],
        outputDir: outDir,
        mode: "library",
        write: true,
      });
      expect(result.errors).toHaveLength(0);

      const emitted = readFileSync(resolve(outDir, "probe.js"), "utf8");
      // No bare scrml: specifiers anywhere in the emitted module.
      expect(emitted).not.toMatch(/scrml:/);
      // All three shims rewritten to ./_scrml/*.js
      expect(emitted).toContain('"./_scrml/path.js"');
      expect(emitted).toContain('"./_scrml/fs.js"');
      expect(emitted).toContain('"./_scrml/process.js"');
      // The shim files were actually bundled.
      const shims = readdirSync(resolve(outDir, "_scrml"));
      expect(shims).toContain("path.js");
      expect(shims).toContain("fs.js");
      expect(shims).toContain("process.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §11 — §19 host-containment `!{}` call-site handler lowered in library mode
//
// ss23 item 1 (g-safecall-bang-handler-not-lowered-in-library-mode): the
// `safeCall(...) !{ | ::Thrown(...) :> ... }` host-containment handler (the
// public try/catch replacement) lowered correctly in BROWSER mode (via
// emit-logic.ts `case "guarded-expr"`) but the library whole-block extraction
// path only regex-transformed source text — so the `!{}` survived VERBATIM and
// tripped the §2.2.1 emit gate (E-CODEGEN-INVALID-JS, byte 238). The fix wires
// the SAME emit-logic.ts lowering into the library path via span-splicing
// (collectGuardedExprs + lowerGuardedExprsInBlock in emit-library.ts).
//
// These are full-pipeline tests (write-to-disk + compileScrml) so they exercise
// the real AST → whole-block path the CLI uses — the synthetic-AST §8/§9 helpers
// carry an empty logic.body and cannot reach the guarded-expr nodes.
// ---------------------------------------------------------------------------

describe("emit-library §11: §19 host-containment `!{}` lowered in library mode", () => {
  async function compileLibToDisk(source, basename = "probe") {
    const { resolve } = await import("path");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { compileScrml } = await import("../../src/api.js");

    const dir = mkdtempSync(resolve(tmpdir(), "ss23-safecall-"));
    try {
      const srcPath = resolve(dir, `${basename}.scrml`);
      writeFileSync(srcPath, source, "utf8");
      const outDir = resolve(dir, "out");
      const result = compileScrml({
        inputFiles: [srcPath],
        outputDir: outDir,
        mode: "library",
        write: true,
      });
      const emitted = readFileSync(resolve(outDir, `${basename}.js`), "utf8");
      return { result, emitted };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // `new Function` rejects a SyntaxError exactly like `node --check`; the body
  // is the ESM-stripped emitted module — `import` lines removed and the `export`
  // keyword dropped (both are module-only; `new Function` compiles a script
  // body). What's left is the lowered function bodies, which must parse cleanly.
  function assertParsesAsJs(emitted) {
    const body = emitted
      .replace(/^\s*import\b[^\n]*$/gm, "")
      .replace(/\bexport\s+/g, "");
    expect(() => new Function(body)).not.toThrow();
  }

  const REPRO = [
    "${",
    '    import { safeCall, HostError } from "scrml:host"',
    "",
    "    export function tryParse(raw) {",
    "        return safeCall(() => JSON.parse(raw)) !{",
    "            | ::Thrown(message, name) :> not",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");

  test("RED→GREEN: the giti repro lowers to valid JS (no verbatim `!{}`, no E-CODEGEN)", async () => {
    const { result, emitted } = await compileLibToDisk(REPRO);

    // No E-CODEGEN-INVALID-JS (the byte-238 verbatim-`!{}` failure).
    expect(result.errors.map((e) => e.code)).not.toContain("E-CODEGEN-INVALID-JS");
    expect(result.errors).toHaveLength(0);

    // The `!{}` host-containment shape is GONE — lowered to the sentinel guard.
    expect(emitted).not.toContain("!{");
    expect(emitted).toContain("__scrml_error");
    expect(emitted).toContain('.variant === "Thrown"');
    // The arm's payload binding lowers from `.data` (single-field bare value).
    expect(emitted).toContain(".data.message");
    expect(emitted).toContain(".data.name");
    assertParsesAsJs(emitted);
  });

  test("adversarial: multiple `!{}` in one library file both lower", async () => {
    const src = [
      "${",
      '    import { safeCall, HostError } from "scrml:host"',
      "",
      "    export function tryParseTwo(a, b) {",
      "        let first = safeCall(() => JSON.parse(a)) !{",
      "            | ::Thrown(message, name) :> not",
      "        }",
      "        let second = safeCall(() => JSON.parse(b)) !{",
      "            | ::Thrown(message, name) :> not",
      "        }",
      "        return first",
      "    }",
      "}",
      "",
    ].join("\n");
    const { result, emitted } = await compileLibToDisk(src, "two");

    expect(result.errors).toHaveLength(0);
    expect(emitted).not.toContain("!{");
    // Both call sites lowered → two sentinel guards.
    const guardCount = (emitted.match(/&& [\w$]+\.__scrml_error\)/g) ?? []).length;
    expect(guardCount).toBe(2);
    // Each guarded value is wired to its `let` binding.
    expect(emitted).toContain("first");
    expect(emitted).toContain("second");
    assertParsesAsJs(emitted);
  });

  test("adversarial: `!{}` with a wildcard arm lowers (Thrown + `_`)", async () => {
    const src = [
      "${",
      '    import { safeCall, HostError } from "scrml:host"',
      "",
      "    export function tryParse(raw) {",
      "        return safeCall(() => JSON.parse(raw)) !{",
      "            | ::Thrown(message, name) :> message",
      "            | _ :> not",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n");
    const { result, emitted } = await compileLibToDisk(src, "wild");

    expect(result.errors).toHaveLength(0);
    expect(emitted).not.toContain("!{");
    expect(emitted).toContain('.variant === "Thrown"');
    // Wildcard arm lowers to the trailing `else { ... }` branch.
    expect(emitted).toContain("else {");
    assertParsesAsJs(emitted);
  });

  test("regression: program-mode (`!{}` browser) lowering unaffected", async () => {
    // Browser mode already lowered correctly — assert the fix did not perturb it.
    const { resolve } = await import("path");
    const { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { compileScrml } = await import("../../src/api.js");

    const dir = mkdtempSync(resolve(tmpdir(), "ss23-safecall-br-"));
    try {
      const srcPath = resolve(dir, "br.scrml");
      writeFileSync(srcPath, REPRO.replace("br.scrml", ""), "utf8");
      const outDir = resolve(dir, "out");
      const result = compileScrml({
        inputFiles: [srcPath],
        outputDir: outDir,
        mode: "browser",
        write: true,
      });
      expect(result.errors).toHaveLength(0);
      const clientFile = readdirSync(outDir).find((f) => f.endsWith(".client.js"));
      const emitted = readFileSync(resolve(outDir, clientFile), "utf8");
      expect(emitted).not.toContain("!{");
      expect(emitted).toContain("__scrml_error");
      expect(emitted).toContain('.variant === "Thrown"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("regression: a library file with NO `!{}` is unchanged (no spurious lowering)", async () => {
    const src = [
      "${",
      "    export function add(a, b) {",
      "        return a + b",
      "    }",
      "}",
      "",
    ].join("\n");
    const { result, emitted } = await compileLibToDisk(src, "plain");

    expect(result.errors).toHaveLength(0);
    expect(emitted).toContain("export function add");
    expect(emitted).toContain("return a + b");
    // No sentinel machinery injected where there was no `!{}`.
    expect(emitted).not.toContain("__scrml_error");
    assertParsesAsJs(emitted);
  });
});
