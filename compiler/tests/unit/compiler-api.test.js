/**
 * Compiler API tests — scrml:compiler/* stdlib modules
 *
 * Validates that all pipeline stages are exposed as importable scrml modules
 * and that the umbrella module re-exports everything correctly.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { resolve } from "path";

const STDLIB_DIR = resolve(import.meta.dir, "../../../stdlib/compiler");

// S430 P4 — every stdlib/compiler/*.scrml bridges into the host compiler with a
// file-top `import:host { … } from "../../compiler/src/<stage>"` (§21.3.1),
// admitted by the repo-root `scrml.toml` (`host-import = "self-host-only"`,
// §22.13). The former `^{ await import(...) }` bridge is rejected by
// E-DYNAMIC-IMPORT-NOT-IN-SCRML (§21.3.2); these files compile clean again.

// Helper: compile a scrml file in library mode and return the libraryJs output
function compileLibrary(filename) {
  const r = compileScrml({
    inputFiles: [resolve(STDLIB_DIR, filename)],
    outputDir: "/tmp/compiler-api-test",
    mode: "library",
    write: false,
  });
  let libraryJs = "";
  for (const [, v] of r.outputs) {
    if (v.libraryJs) libraryJs = v.libraryJs;
  }
  return { errors: r.errors, libraryJs };
}

// ---------------------------------------------------------------------------
// §90: Per-stage module compilation
// ---------------------------------------------------------------------------

describe("§90 Compiler API — per-stage modules", () => {
  const stageTests = [
    { file: "bs.scrml", exports: ["splitBlocks", "runBlockSplitter"] },
    { file: "tab.scrml", exports: ["buildAST", "runTAB", "parseLogicBody", "TABError"] },
    { file: "mod.scrml", exports: ["resolveModules"] },
    { file: "ce.scrml", exports: ["runCE", "runCEFile"] },
    { file: "bpp.scrml", exports: ["runBPP", "runBPPFile"] },
    { file: "pa.scrml", exports: ["runPA", "PAError"] },
    { file: "ri.scrml", exports: ["runRI", "RIError", "collectFileFunctions", "generateRouteName", "buildFunctionIndex", "buildPageRouteTree"] },
    { file: "ts.scrml", exports: ["runTS", "TSError"] },
    { file: "mc.scrml", exports: ["runMetaChecker", "MetaError", "buildFileTypeRegistry", "createReflect", "bodyUsesCompileTimeApis"] },
    { file: "me.scrml", exports: ["runMetaEval", "MetaEvalError"] },
    { file: "dg.scrml", exports: ["runDG", "DGError"] },
    { file: "cg.scrml", exports: ["runCG", "CGError"] },
    { file: "expr.scrml", exports: ["parseExpression", "parseStatements", "walk", "extractIdentifiersFromAST", "extractReactiveDepsFromAST", "astToJs", "rewriteReactiveRefsAST", "rewriteServerReactiveRefsAST"] },
  ];

  for (const { file, exports: expectedExports } of stageTests) {
    const stage = file.replace(".scrml", "");

    test(`${stage}: compiles without errors`, () => {
      const { errors } = compileLibrary(file);
      expect(errors).toEqual([]);
    });

    test(`${stage}: exports ${expectedExports.join(", ")}`, () => {
      const { libraryJs } = compileLibrary(file);
      for (const name of expectedExports) {
        expect(libraryJs).toContain(`export const ${name}`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// §91: Umbrella module
// ---------------------------------------------------------------------------

describe("§91 Compiler API — umbrella module", () => {
  test("index.scrml compiles without errors", () => {
    const { errors } = compileLibrary("index.scrml");
    expect(errors).toEqual([]);
  });

  test("umbrella exports full pipeline function", () => {
    const { libraryJs } = compileLibrary("index.scrml");
    expect(libraryJs).toContain("export const compileScrml");
    expect(libraryJs).toContain("export const scanDirectory");
  });

  test("umbrella exports all stage entry points", () => {
    const { libraryJs } = compileLibrary("index.scrml");
    const stages = [
      "splitBlocks", "buildAST", "resolveModules", "runCE", "runBPP",
      "runPA", "runRI", "runTS", "runMetaChecker", "runMetaEval",
      "runDG", "runCG",
    ];
    for (const name of stages) {
      expect(libraryJs).toContain(`export const ${name}`);
    }
  });

  test("umbrella exports expression parser utilities", () => {
    const { libraryJs } = compileLibrary("index.scrml");
    expect(libraryJs).toContain("export const parseExpression");
    expect(libraryJs).toContain("export const extractIdentifiersFromAST");
  });

  test("umbrella uses 'as' syntax for import renames", () => {
    const { libraryJs } = compileLibrary("index.scrml");
    // Should use `import { x as _x }` not `import { x: _x }`
    expect(libraryJs).not.toMatch(/import\s*\{[^}]*\w+:\s*\w+/);
    expect(libraryJs).toMatch(/import\s*\{[^}]*\w+ as \w+/);
  });
});

// ---------------------------------------------------------------------------
// §92: Library codegen rename fix
// ---------------------------------------------------------------------------

describe("§92 Compiler API — library codegen rename fix", () => {
  test("destructuring rename emits 'as' not ':'", () => {
    const { libraryJs } = compileLibrary("bs.scrml");
    expect(libraryJs).toContain("import { splitBlocks as _splitBlocks");
    expect(libraryJs).not.toContain("splitBlocks: _splitBlocks");
  });

  test("non-renamed imports remain unchanged", () => {
    // module-resolver.scrml uses non-renamed imports (path, fs)
    const { libraryJs } = compileLibrary("../compiler/module-resolver.scrml");
    expect(libraryJs).toContain('import { resolve, dirname, join }');
  });
});

// ---------------------------------------------------------------------------
// §93: Compiled exports are callable
// ---------------------------------------------------------------------------

describe("§93 Compiler API — compiled exports are callable", () => {
  test("splitBlocks is callable on simple input", async () => {
    const { splitBlocks } = await import("../../src/block-splitter.js");
    const result = splitBlocks("/test.scrml", "<p>hello</p>");
    expect(result).toBeDefined();
    expect(result.blocks).toBeDefined();
    expect(Array.isArray(result.blocks)).toBe(true);
  });

  test("buildAST is callable on BS output", async () => {
    const { splitBlocks } = await import("../../src/block-splitter.js");
    const { buildAST } = await import("../../src/ast-builder.js");
    const bs = splitBlocks("/test.scrml", "<p>hello</p>");
    const tab = buildAST(bs);
    expect(tab).toBeDefined();
    expect(tab.ast).toBeDefined();
  });

  test("compileScrml runs a full pipeline", async () => {
    const { compileScrml: compile } = await import("../../src/api.js");
    const { writeFileSync, mkdirSync, rmSync } = await import("fs");
    const tmpDir = "/tmp/scrml-api-callable-test";
    mkdirSync(tmpDir, { recursive: true });
    const tmpFile = tmpDir + "/test.scrml";
    writeFileSync(tmpFile, "<p>hello world</p>");
    const result = compile({
      inputFiles: [tmpFile],
      outputDir: tmpDir + "/dist",
      write: false,
    });
    expect(result.errors.length).toBe(0);
    expect(result.outputs.size).toBeGreaterThan(0);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parseExpression parses reactive expressions", async () => {
    const { parseExpression } = await import("../../src/expression-parser.ts");
    const { ast, error } = parseExpression("@count + 1");
    expect(error).toBeNull();
    expect(ast).toBeDefined();
    expect(ast.type).toBe("BinaryExpression");
  });

  test("resolveModules handles empty input", async () => {
    const { resolveModules } = await import("../../src/module-resolver.js");
    const result = resolveModules([]);
    expect(result.errors.length).toBe(0);
    expect(result.compilationOrder).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §94: Namespace import codegen
// ---------------------------------------------------------------------------

describe("§94 Compiler API — namespace import codegen", () => {
  test("namespace import emits import * as", () => {
    const r = compileScrml({
      inputFiles: [],
      mode: "library",
      write: false,
    });
    // Test via inline source — create a minimal module with namespace import
    const { writeFileSync, mkdirSync, rmSync } = require("fs");
    const tmpFile = "/tmp/scrml-ns-test.scrml";
    writeFileSync(tmpFile, `<program>
\${
    ^{
        const bs = await import("fs");
    }
    export const readFile = bs.readFileSync
}
</program>`);
    const result = compileScrml({
      inputFiles: [tmpFile],
      outputDir: "/tmp/scrml-ns-out",
      mode: "library",
      write: false,
    });
    let js = "";
    for (const [, v] of result.outputs) {
      if (v.libraryJs) js = v.libraryJs;
    }
    expect(js).toContain('import * as bs from "fs"');
    expect(js).toContain("export const readFile = bs.readFileSync");
    rmSync(tmpFile, { force: true });
  });
});
