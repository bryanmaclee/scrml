/**
 * Self-Host Module Resolver — Parity Tests
 *
 * Validates that stdlib/compiler/module-resolver.scrml compiles without errors
 * and that the original JS module (compiler/src/module-resolver.js) passes all
 * the same assertions. This ensures the scrml translation is a faithful 1:1 port.
 *
 * When the compiler's codegen supports library-mode output (ES module exports),
 * these tests should be updated to import from the compiled scrml output instead.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { compileScrml } from "../../src/api.js";

// Import from the original JS source to validate the test assertions.
const compilerModuleResolver = resolve(dirname(fileURLToPath(new URL(import.meta.url))), "../../src/module-resolver.js");
const {
  buildImportGraph,
  detectCircularImports,
  topologicalSort,
  buildExportRegistry,
  validateImports,
  resolveModules,
  ModuleError,
  isStdlibImport,
} = await import(compilerModuleResolver);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(filePath, imports = [], exports = []) {
  return {
    filePath,
    ast: {
      filePath,
      imports: imports.map(imp => ({
        kind: "import-decl",
        names: imp.names,
        source: imp.source,
        isDefault: imp.isDefault || false,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      })),
      exports: exports.map(exp => ({
        kind: "export-decl",
        exportedName: exp.name,
        exportKind: exp.kind || "type",
        reExportSource: exp.reExportSource || null,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Compilation test — scrml file compiles without errors
// ---------------------------------------------------------------------------

describe("self-host: module-resolver.scrml compilation", () => {
  const scrmlFile = resolve(dirname(fileURLToPath(new URL(import.meta.url))), "../../../stdlib/compiler/module-resolver.scrml");

  test("scrml file exists", () => {
    expect(existsSync(scrmlFile)).toBe(true);
  });

  // RESOLVED (A1 — S99 cascade): A2 (c4fc98a) populated body+params on export
  // function synth stubs which unmasked three pre-existing scope-walker gaps
  // in type-system.ts:
  //   §A `export class Foo {...}` — name not bound (preBindExportedNames only
  //       looked at `exportedName`, which the AST builder left null for class).
  //   §B `for (const [a, b] of x)` — destructured names not bound (for-stmt
  //       arm only bound the synth `variable: "item"`).
  //   §C `const { a, b: ren } = e` — destructured names not bound (const-decl
  //       arm only bound when `name` was truthy; LHS pattern lived in sibling
  //       bare-expr).
  // All three fixed in changes/a1-scope-walker-export-class-closures
  // (commits 8f16e01 + 92ce1f3 + de7af98).
  // ⚑ S430 P1 — this used to assert a clean CLI compile. The file now reports
  // exactly one unmigrated site (SPEC §7.2.1):
  //   :32  `export class ModuleError` — the class→struct rewrite is P1b.
  // (S430 P4: its `^{ await import("path"/"fs") }` became static
  // `scrml:path` / `scrml:fs` imports — builtins are not import:host targets.)
  // The A1 scope-walker fixes this test guarded stay guarded: any OTHER error
  // (an E-SCOPE-001 regression included) fails the exact-residue pin.
  // Compiled in LIBRARY mode — how every stdlib/compiler module is consumed
  // (compiler-api §90, emit-library §7). The old CLI call compiled it as a
  // browser APP; with `scrml:path` (a server-only stdlib module with no client
  // chunk) that correctly adds E-STDLIB-CLIENT-CHUNK-MISSING, which says
  // nothing about this library module.
  test("compiles with exactly the known S430 residue [A2-SURFACED — fixed by A1]", () => {
    const r = compileScrml({
      inputFiles: [scrmlFile], outputDir: resolve(dirname(scrmlFile), "dist"),
      mode: "library", write: false, log: () => {},
    });
    const got = (r.errors ?? []).map((e) => `${e.code}@${e.span?.line ?? e.tabSpan?.line}`).sort();
    expect(got).toEqual(["E-CLASS-NOT-IN-SCRML@32"]);
  });
});

// ---------------------------------------------------------------------------
// Parity tests — same assertions as compiler/tests/unit/module-resolver.test.js
// These prove the original JS and the scrml translation implement the same logic.
// ---------------------------------------------------------------------------

describe("self-host parity: import graph construction", () => {
  test("builds graph from single file with no imports", () => {
    const files = [makeFile("/app/main.scrml")];
    const { graph } = buildImportGraph(files);
    expect(graph.size).toBe(1);
    expect(graph.get("/app/main.scrml").imports).toHaveLength(0);
  });

  test("builds graph with imports resolved to absolute paths", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Foo"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Foo", kind: "type" }]),
    ];
    const { graph } = buildImportGraph(files);
    const mainEntry = graph.get("/app/main.scrml");
    expect(mainEntry.imports).toHaveLength(1);
    expect(mainEntry.imports[0].absSource).toBe("/app/types.scrml");
  });

  test("collects exports from files", () => {
    const files = [
      makeFile("/app/types.scrml", [], [
        { name: "Status", kind: "type" },
        { name: "formatDate", kind: "function" },
      ]),
    ];
    const { graph } = buildImportGraph(files);
    expect(graph.get("/app/types.scrml").exports).toHaveLength(2);
  });
});

describe("self-host parity: circular dependency detection", () => {
  test("no cycle for linear chain", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./c.scrml" }]),
      makeFile("/app/c.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    expect(detectCircularImports(graph)).toHaveLength(0);
  });

  test("detects A->B->A cycle", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./a.scrml" }]),
    ];
    const { graph } = buildImportGraph(files);
    const errors = detectCircularImports(graph);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("E-IMPORT-002");
  });

  test("no false positive for diamond dependency", () => {
    const files = [
      makeFile("/app/a.scrml", [
        { names: ["X"], source: "./b.scrml" },
        { names: ["Y"], source: "./c.scrml" },
      ]),
      makeFile("/app/b.scrml", [{ names: ["Z"], source: "./d.scrml" }]),
      makeFile("/app/c.scrml", [{ names: ["W"], source: "./d.scrml" }]),
      makeFile("/app/d.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    expect(detectCircularImports(graph)).toHaveLength(0);
  });
});

describe("self-host parity: topological sort", () => {
  test("dependency comes before dependent", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["X"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    const order = topologicalSort(graph);
    expect(order.indexOf("/app/types.scrml")).toBeLessThan(order.indexOf("/app/main.scrml"));
  });

  test("chain: C before B before A", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./c.scrml" }]),
      makeFile("/app/c.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    const order = topologicalSort(graph);
    expect(order.indexOf("/app/c.scrml")).toBeLessThan(order.indexOf("/app/b.scrml"));
    expect(order.indexOf("/app/b.scrml")).toBeLessThan(order.indexOf("/app/a.scrml"));
  });
});

describe("self-host parity: export registry", () => {
  test("builds registry from exports", () => {
    const files = [
      makeFile("/app/types.scrml", [], [
        { name: "Status", kind: "type" },
        { name: "Config", kind: "type" },
      ]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    expect(registry.get("/app/types.scrml").size).toBe(2);
    expect(registry.get("/app/types.scrml").has("Status")).toBe(true);
  });
});

describe("self-host parity: import validation", () => {
  test("valid import produces no errors", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Foo"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Foo", kind: "type" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    expect(validateImports(graph, registry)).toHaveLength(0);
  });

  test("importing non-existent name produces E-IMPORT-004", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Bar"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Foo", kind: "type" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const errors = validateImports(graph, registry);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-IMPORT-004");
    expect(errors[0].message).toContain("Bar");
  });

  test(".js imports skip validation", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["helper"], source: "./helper.js" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    expect(validateImports(graph, registry)).toHaveLength(0);
  });
});

describe("self-host parity: resolveModules pipeline", () => {
  test("resolves simple two-file dependency", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Status"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Status", kind: "type" }]),
    ];
    const result = resolveModules(files);
    expect(result.errors).toHaveLength(0);
    expect(result.compilationOrder.indexOf("/app/types.scrml")).toBeLessThan(
      result.compilationOrder.indexOf("/app/main.scrml")
    );
  });

  test("empty file list", () => {
    const result = resolveModules([]);
    expect(result.errors).toHaveLength(0);
    expect(result.compilationOrder).toHaveLength(0);
  });

  test("self-import produces circular dependency error", () => {
    const files = [
      makeFile("/app/self.scrml", [{ names: ["X"], source: "./self.scrml" }], [{ name: "X", kind: "type" }]),
    ];
    const result = resolveModules(files);
    expect(result.errors.some(e => e.code === "E-IMPORT-002")).toBe(true);
  });
});

describe("self-host parity: utilities", () => {
  test("isStdlibImport", () => {
    expect(isStdlibImport("scrml:crypto")).toBe(true);
    expect(isStdlibImport("scrml:data")).toBe(true);
    expect(isStdlibImport("./local.scrml")).toBe(false);
    expect(isStdlibImport("vendor:foo")).toBe(false);
  });

  test("ModuleError structure", () => {
    const err = new ModuleError("E-TEST-001", "test message", null, "warning");
    expect(err.code).toBe("E-TEST-001");
    expect(err.message).toBe("test message");
    expect(err.severity).toBe("warning");
    expect(err.span).toBeNull();
  });
});
