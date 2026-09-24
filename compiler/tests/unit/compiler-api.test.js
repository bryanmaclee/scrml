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

// ⚑ S430 P4 — every stdlib/compiler/*.scrml bridges into the host compiler with
// `^{ const { … } = await import("../../compiler/src/<stage>") }`. SPEC §21.3.2
// now rejects dynamic `import(...)` (E-DYNAMIC-IMPORT-NOT-IN-SCRML), and
// §21.3.1 names exactly this `^{ await import(...) }` bridge as the path
// `import:host` replaces. These files are NOT migrated here — the
// import:host conversion is the bootstrap track's first unit (a separate
// dispatch). Until it lands, each file compiles with EXACTLY its bridge
// sites as residue (line-pinned, the S430 P2 meta-checker precedent): a new
// error class fails the test, and so does a migration that clears a site
// without updating the pin.
const S430_P4_RESIDUE = (...lines) => lines.map((l) => `E-DYNAMIC-IMPORT-NOT-IN-SCRML@${l}`);
const residueOf = (errors) =>
  (errors ?? []).map((e) => `${e.code}@${e.span?.line ?? e.tabSpan?.line}`).sort();

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
    { file: "bs.scrml", exports: ["splitBlocks", "runBlockSplitter"], residue: S430_P4_RESIDUE(15) },
    { file: "tab.scrml", exports: ["buildAST", "runTAB", "parseLogicBody", "TABError"], residue: S430_P4_RESIDUE(15) },
    { file: "mod.scrml", exports: ["resolveModules"], residue: S430_P4_RESIDUE(16) },
    { file: "ce.scrml", exports: ["runCE", "runCEFile"], residue: S430_P4_RESIDUE(15) },
    { file: "bpp.scrml", exports: ["runBPP", "runBPPFile"], residue: S430_P4_RESIDUE(15) },
    { file: "pa.scrml", exports: ["runPA", "PAError"], residue: S430_P4_RESIDUE(15) },
    { file: "ri.scrml", exports: ["runRI", "RIError", "collectFileFunctions", "generateRouteName", "buildFunctionIndex", "buildPageRouteTree"], residue: S430_P4_RESIDUE(15) },
    { file: "ts.scrml", exports: ["runTS", "TSError"], residue: S430_P4_RESIDUE(15) },
    { file: "mc.scrml", exports: ["runMetaChecker", "MetaError", "buildFileTypeRegistry", "createReflect", "bodyUsesCompileTimeApis"], residue: S430_P4_RESIDUE(17) },
    { file: "me.scrml", exports: ["runMetaEval", "MetaEvalError"], residue: S430_P4_RESIDUE(15) },
    { file: "dg.scrml", exports: ["runDG", "DGError"], residue: S430_P4_RESIDUE(15) },
    { file: "cg.scrml", exports: ["runCG", "CGError"], residue: S430_P4_RESIDUE(15) },
    { file: "expr.scrml", exports: ["parseExpression", "parseStatements", "walk", "extractIdentifiersFromAST", "extractReactiveDepsFromAST", "astToJs", "rewriteReactiveRefsAST", "rewriteServerReactiveRefsAST"], residue: S430_P4_RESIDUE(16) },
  ];

  for (const { file, exports: expectedExports, residue } of stageTests) {
    const stage = file.replace(".scrml", "");

    test(`${stage}: compiles with exactly the known S430 P4 residue (pending import:host)`, () => {
      const { errors } = compileLibrary(file);
      expect(residueOf(errors)).toEqual(residue.slice().sort());
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
  test("index.scrml compiles with exactly the known S430 P4 residue (pending import:host)", () => {
    const { errors } = compileLibrary("index.scrml");
    expect(residueOf(errors)).toEqual(
      S430_P4_RESIDUE(32, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 49).sort());
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
