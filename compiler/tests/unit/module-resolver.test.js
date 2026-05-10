/**
 * Module Resolver — Unit Tests
 *
 * Tests for src/module-resolver.js
 *
 * Test coverage:
 *   §A  Import graph construction
 *   §B  Circular dependency detection (E-IMPORT-002)
 *   §C  Topological sort
 *   §D  Export registry construction
 *   §E  Import validation (E-IMPORT-004)
 *   §F  Full resolveModules pipeline
 *   §G  Edge cases
 */

import { describe, test, expect } from "bun:test";
import {
  buildImportGraph,
  detectCircularImports,
  topologicalSort,
  buildExportRegistry,
  validateImports,
  resolveModules,
  ModuleError,
} from "../../src/module-resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal FileAST-like object for testing.
 */
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
        renames: exp.renames || null,
        span: { file: filePath, start: 0, end: 0, line: 1, col: 1 },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// §A  Import graph construction
// ---------------------------------------------------------------------------

describe("§A — import graph construction", () => {
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

  test("handles multiple imports from different files", () => {
    const files = [
      makeFile("/app/main.scrml", [
        { names: ["Foo"], source: "./types.scrml" },
        { names: ["bar"], source: "./utils.scrml" },
      ]),
      makeFile("/app/types.scrml"),
      makeFile("/app/utils.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    expect(graph.get("/app/main.scrml").imports).toHaveLength(2);
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
    expect(graph.get("/app/types.scrml").exports[0].name).toBe("Status");
    expect(graph.get("/app/types.scrml").exports[1].name).toBe("formatDate");
  });
});

// ---------------------------------------------------------------------------
// §B  Circular dependency detection
// ---------------------------------------------------------------------------

describe("§B — circular dependency detection (E-IMPORT-002)", () => {
  test("no cycle for linear dependency chain", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./c.scrml" }]),
      makeFile("/app/c.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    const errors = detectCircularImports(graph);
    expect(errors).toHaveLength(0);
  });

  test("detects direct A->B->A cycle", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./a.scrml" }]),
    ];
    const { graph } = buildImportGraph(files);
    const errors = detectCircularImports(graph);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("E-IMPORT-002");
  });

  test("detects A->B->C->A cycle", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./c.scrml" }]),
      makeFile("/app/c.scrml", [{ names: ["Z"], source: "./a.scrml" }]),
    ];
    const { graph } = buildImportGraph(files);
    const errors = detectCircularImports(graph);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === "E-IMPORT-002")).toBe(true);
  });

  test("no false positive for diamond dependency", () => {
    // A -> B, A -> C, B -> D, C -> D (no cycle)
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
    const errors = detectCircularImports(graph);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §C  Topological sort
// ---------------------------------------------------------------------------

describe("§C — topological sort", () => {
  test("single file", () => {
    const files = [makeFile("/app/main.scrml")];
    const { graph } = buildImportGraph(files);
    const order = topologicalSort(graph);
    expect(order).toEqual(["/app/main.scrml"]);
  });

  test("dependency comes before dependent", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["X"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    const order = topologicalSort(graph);
    const mainIdx = order.indexOf("/app/main.scrml");
    const typesIdx = order.indexOf("/app/types.scrml");
    expect(typesIdx).toBeLessThan(mainIdx);
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

  test("independent files are all included", () => {
    const files = [
      makeFile("/app/a.scrml"),
      makeFile("/app/b.scrml"),
      makeFile("/app/c.scrml"),
    ];
    const { graph } = buildImportGraph(files);
    const order = topologicalSort(graph);
    expect(order).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// §D  Export registry construction
// ---------------------------------------------------------------------------

describe("§D — export registry", () => {
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
    expect(registry.get("/app/types.scrml").has("Config")).toBe(true);
  });

  test("file with no exports has empty set", () => {
    const files = [makeFile("/app/main.scrml")];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    expect(registry.get("/app/main.scrml").size).toBe(0);
  });

  // §C15.13 (S76) — Re-export resolution. Without pass 2, a re-exported
  // engine landed as `kind: "re-export"` / `category: "other"`, causing
  // SYM PASS 10.B to fire false-positive E-ENGINE-MOUNT-NOT-ENGINE on
  // `<X/>` use-sites resolved through a re-exporter.

  test("§D-C15.13.1 — single-level re-export of an engine inherits engine kind+category", () => {
    const files = [
      makeFile("/app/engines.scrml", [], [
        { name: "phase", kind: "engine" },
      ]),
      makeFile("/app/reexport.scrml",
        [{ names: ["phase"], source: "./engines.scrml" }],
        [{ name: "phase", kind: "re-export", reExportSource: "./engines.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const reexportEntry = registry.get("/app/reexport.scrml").get("phase");
    expect(reexportEntry.kind).toBe("engine");
    expect(reexportEntry.category).toBe("engine");
    expect(reexportEntry.isComponent).toBe(false);
  });

  test("§D-C15.13.2 — re-export inherits function kind+category", () => {
    const files = [
      makeFile("/app/utils.scrml", [], [
        { name: "compute", kind: "function" },
      ]),
      makeFile("/app/reexport.scrml",
        [{ names: ["compute"], source: "./utils.scrml" }],
        [{ name: "compute", kind: "re-export", reExportSource: "./utils.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const reexportEntry = registry.get("/app/reexport.scrml").get("compute");
    expect(reexportEntry.kind).toBe("function");
    expect(reexportEntry.category).toBe("function");
  });

  test("§D-C15.13.3 — re-export inherits user-component category for PascalCase const", () => {
    const files = [
      makeFile("/app/comp.scrml", [], [
        { name: "Card", kind: "const" },
      ]),
      makeFile("/app/reexport.scrml",
        [{ names: ["Card"], source: "./comp.scrml" }],
        [{ name: "Card", kind: "re-export", reExportSource: "./comp.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const reexportEntry = registry.get("/app/reexport.scrml").get("Card");
    expect(reexportEntry.kind).toBe("const");
    expect(reexportEntry.category).toBe("user-component");
    expect(reexportEntry.isComponent).toBe(true);
  });

  test("§D-C15.13.4 — transitive re-export chain (A → B → C) collapses to source kind", () => {
    const files = [
      makeFile("/app/source.scrml", [], [
        { name: "phase", kind: "engine" },
      ]),
      makeFile("/app/middle.scrml",
        [{ names: ["phase"], source: "./source.scrml" }],
        [{ name: "phase", kind: "re-export", reExportSource: "./source.scrml" }],
      ),
      makeFile("/app/top.scrml",
        [{ names: ["phase"], source: "./middle.scrml" }],
        [{ name: "phase", kind: "re-export", reExportSource: "./middle.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    expect(registry.get("/app/middle.scrml").get("phase").kind).toBe("engine");
    expect(registry.get("/app/top.scrml").get("phase").kind).toBe("engine");
    expect(registry.get("/app/top.scrml").get("phase").category).toBe("engine");
  });

  test("§D-C15.13.5 — rename through re-export uses localName for source lookup", () => {
    const files = [
      makeFile("/app/source.scrml", [], [
        { name: "phase", kind: "engine" },
      ]),
      makeFile("/app/reexport.scrml",
        [{ names: ["phase"], source: "./source.scrml" }],
        [{
          name: "phaseAlias",
          kind: "re-export",
          reExportSource: "./source.scrml",
          renames: [{ exported: "phaseAlias", local: "phase" }],
        }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const aliasEntry = registry.get("/app/reexport.scrml").get("phaseAlias");
    expect(aliasEntry.kind).toBe("engine");
    expect(aliasEntry.category).toBe("engine");
  });

  test("§D-C15.13.6 — re-export of non-existent source name stays as re-export (E-IMPORT-004 elsewhere)", () => {
    const files = [
      makeFile("/app/source.scrml", [], [
        { name: "phase", kind: "engine" },
      ]),
      makeFile("/app/reexport.scrml",
        [{ names: ["nonExistent"], source: "./source.scrml" }],
        [{ name: "nonExistent", kind: "re-export", reExportSource: "./source.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const entry = registry.get("/app/reexport.scrml").get("nonExistent");
    expect(entry.kind).toBe("re-export");
    expect(entry.category).toBe("other");
  });

  test("§D-C15.13.7 — re-export from external (.js) source stays as re-export (graph-absent)", () => {
    // External .js sources are not in the graph; resolver leaves the entry
    // unresolved (caller treats `kind: "re-export"` as opaque).
    const files = [
      makeFile("/app/reexport.scrml",
        [{ names: ["external"], source: "./external.js" }],
        [{ name: "external", kind: "re-export", reExportSource: "./external.js" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const entry = registry.get("/app/reexport.scrml").get("external");
    expect(entry.kind).toBe("re-export");
  });

  test("§D-C15.13.8 — public registry entries do NOT expose internal underscore fields", () => {
    const files = [
      makeFile("/app/source.scrml", [], [{ name: "phase", kind: "engine" }]),
      makeFile("/app/reexport.scrml",
        [{ names: ["phase"], source: "./source.scrml" }],
        [{ name: "phase", kind: "re-export", reExportSource: "./source.scrml" }],
      ),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    for (const [, names] of registry) {
      for (const [, entry] of names) {
        expect(entry).not.toHaveProperty("_reExportSource");
        expect(entry).not.toHaveProperty("_localName");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §E  Import validation (E-IMPORT-004)
// ---------------------------------------------------------------------------

describe("§E — import validation (E-IMPORT-004)", () => {
  test("valid import produces no errors", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Foo"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "Foo", kind: "type" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const errors = validateImports(graph, registry);
    expect(errors).toHaveLength(0);
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

  test("importing from .js file skips validation", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["helper"], source: "./helper.js" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const errors = validateImports(graph, registry);
    expect(errors).toHaveLength(0);
  });

  test("multiple invalid imports produce multiple errors", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["X", "Y", "Z"], source: "./types.scrml" }]),
      makeFile("/app/types.scrml", [], [{ name: "X", kind: "type" }]),
    ];
    const { graph } = buildImportGraph(files);
    const registry = buildExportRegistry(graph);
    const errors = validateImports(graph, registry);
    expect(errors).toHaveLength(2); // Y and Z not found
  });
});

// ---------------------------------------------------------------------------
// §F  Full resolveModules pipeline
// ---------------------------------------------------------------------------

describe("§F — resolveModules pipeline", () => {
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

  test("returns errors for circular + invalid imports", () => {
    const files = [
      makeFile("/app/a.scrml", [{ names: ["X"], source: "./b.scrml" }]),
      makeFile("/app/b.scrml", [{ names: ["Y"], source: "./a.scrml" }]),
    ];
    const result = resolveModules(files);
    // Should have E-IMPORT-002 (cycle) and E-IMPORT-004 (names not found)
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.code === "E-IMPORT-002")).toBe(true);
  });

  test("no errors for files with no imports/exports", () => {
    const files = [
      makeFile("/app/main.scrml"),
      makeFile("/app/other.scrml"),
    ];
    const result = resolveModules(files);
    expect(result.errors).toHaveLength(0);
    expect(result.compilationOrder).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §G  Edge cases
// ---------------------------------------------------------------------------

describe("§G — edge cases", () => {
  test("empty file list produces empty graph", () => {
    const result = resolveModules([]);
    expect(result.errors).toHaveLength(0);
    expect(result.compilationOrder).toHaveLength(0);
  });

  test("file importing from file not in compilation set", () => {
    const files = [
      makeFile("/app/main.scrml", [{ names: ["Ext"], source: "./external.scrml" }]),
    ];
    const result = resolveModules(files);
    // No E-IMPORT-004 since external.scrml is not in the compilation set
    const importErrors = result.errors.filter(e => e.code === "E-IMPORT-004");
    expect(importErrors).toHaveLength(0);
  });

  test("self-import produces circular dependency error", () => {
    const files = [
      makeFile("/app/self.scrml", [{ names: ["X"], source: "./self.scrml" }], [{ name: "X", kind: "type" }]),
    ];
    const result = resolveModules(files);
    expect(result.errors.some(e => e.code === "E-IMPORT-002")).toBe(true);
  });

  test("ModuleError has correct structure", () => {
    const err = new ModuleError("E-TEST-001", "test message", null, "warning");
    expect(err.code).toBe("E-TEST-001");
    expect(err.message).toBe("test message");
    expect(err.severity).toBe("warning");
    expect(err.span).toBeNull();
  });
});
