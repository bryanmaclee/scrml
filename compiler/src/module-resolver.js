/**
 * Module Resolver — handles import/export resolution for the scrml compiler.
 *
 * Per §21: scrml files MAY export and import types, components, and functions.
 * The module system uses ES module syntax with scrml-specific constraints.
 *
 * This module provides:
 *   1. Import graph construction from FileAST import declarations
 *   2. Circular dependency detection (E-IMPORT-002)
 *   3. Topological sort for compilation order
 *   4. Export registry building from FileAST export declarations
 *   5. Import validation (E-IMPORT-004: name not found in exports)
 *   6. Import specifier validation (E-IMPORT-005: bare specifier — npm without vendor:)
 *
 * Error codes:
 *   E-IMPORT-001  export used outside a ${ } context (detected at AST builder level)
 *   E-IMPORT-002  Circular import detected
 *   E-IMPORT-003  import inside a function body (detected at AST builder level)
 *   E-IMPORT-004  Imported name not found in target file's exports
 *   E-IMPORT-005  Import specifier is a bare (npm-style) name — must use vendor: prefix
 *
 * Design: v1 — named exports only, no default exports, no re-exports resolution,
 * relative paths only.
 */

import { resolve, dirname, join } from "path";
import { existsSync } from "fs";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ModuleError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ file: string, start: number, end: number, line: number, col: number }|null} span
   * @param {'error'|'warning'} [severity]
   */
  constructor(code, message, span = null, severity = "error") {
    this.code = code;
    this.message = message;
    this.span = span;
    this.severity = severity;
  }
}

// ---------------------------------------------------------------------------
// Import specifier classification
// ---------------------------------------------------------------------------

/**
 * Legal import specifier shapes (§21.6, §40.4):
 *   - relative:  './foo.scrml', '../bar.scrml'
 *   - stdlib:    'scrml:crypto', 'scrml:ui'
 *   - vendor:    'vendor:lodash', 'vendor:stripe/client'
 *   - .js:       legacy ES-module interop (e.g. './glue.js')
 *
 * Any other shape — in particular a bare npm-style specifier like 'lodash'
 * or '@scope/pkg' — is rejected with E-IMPORT-005.
 *
 * @param {string} source
 * @returns {boolean}
 */
function isLegalImportSpecifier(source) {
  if (typeof source !== "string" || source.length === 0) return false;
  if (source.startsWith("./") || source.startsWith("../")) return true;
  if (source.startsWith("scrml:")) return true;
  if (source.startsWith("vendor:")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Import graph construction
// ---------------------------------------------------------------------------

/**
 * Build an import graph from a set of FileASTs.
 *
 * Returns a Map where:
 *   key = absolute file path
 *   value = { imports: [{ names: string[], source: string, absSource: string, span }], exports: [{ name, kind, span }] }
 *
 * Also returns E-IMPORT-005 errors for any import with a bare npm-style
 * specifier (non-relative, non-scrml:, non-vendor:).
 *
 * @param {object[]} fileASTs — array of { filePath, ast } objects from TAB stage
 * @returns {{ graph: Map<string, object>, errors: ModuleError[] }}
 */
export function buildImportGraph(fileASTs) {
  const graph = new Map();
  const errors = [];

  // Collect the set of files being compiled so we can distinguish "this import
  // points to a file that's in the compile set" (present by definition) from
  // "this import points to a file that must exist on disk but doesn't" (E-IMPORT-006).
  const compileSet = new Set();
  for (const file of fileASTs) {
    const fp = file.filePath || file.ast?.filePath;
    if (fp) compileSet.add(fp);
  }

  for (const file of fileASTs) {
    const filePath = file.filePath || file.ast?.filePath;
    if (!filePath) continue;

    const imports = [];
    const exports = [];

    // Collect imports from AST
    const astImports = file.ast?.imports || [];
    for (const imp of astImports) {
      if (!imp.source) continue;

      // E-IMPORT-005: bare npm-style specifier — only vendor: imports may reach
      // third-party code. §40.4 requires the `vendor:` prefix so the compiler
      // can enforce project-scoped vendor directories.
      if (!isLegalImportSpecifier(imp.source)) {
        errors.push(new ModuleError(
          "E-IMPORT-005",
          `E-IMPORT-005: Import specifier \`${imp.source}\` is a bare npm-style name. ` +
          `scrml imports must be relative (\`./foo.scrml\`), stdlib (\`scrml:name\`), or vendor (\`vendor:name\`). ` +
          `To import from an npm package, add it to your project's \`vendor/\` directory and write \`import { ... } from 'vendor:${imp.source}'\`.`,
          imp.span ? { ...imp.span, file: filePath } : null,
        ));
        // Skip graph entry — the specifier cannot be resolved anyway.
        continue;
      }

      // Resolve relative path to absolute
      const absSource = resolveModulePath(imp.source, filePath);

      // E-IMPORT-006: target file does not exist.
      //
      // Skip the check when:
      //   - the target is a .js import (standard ES module semantics — the bundler resolves),
      //   - the target is already in the compile set (will be compiled; presence is implicit),
      //   - the importer isn't a real on-disk file (synthetic paths used by unit tests).
      if (
        !imp.source.endsWith(".js") &&
        !compileSet.has(absSource) &&
        existsSync(filePath) &&
        !existsSync(absSource)
      ) {
        errors.push(new ModuleError(
          "E-IMPORT-006",
          `E-IMPORT-006: Cannot resolve import \`${imp.source}\` — no file found at \`${absSource}\`. ` +
          `Check the path and file name. Relative imports are resolved against the importing file's directory.`,
          imp.span ? { ...imp.span, file: filePath } : null,
        ));
        continue;
      }

      imports.push({
        names: imp.names || [],
        source: imp.source,
        absSource,
        isDefault: imp.isDefault || false,
        span: imp.span || null,
      });
    }

    // ENGINE EXPORTS (Phase A1b B14, M18 / §51.0.D + §21.8) — engines that
    // were parsed with `isExported: true` (set by ast-builder Form 1 detection;
    // not yet wired) flow into the export registry as `{kind: "engine"}` so
    // SYM PASS 10.B can validate cross-file `<EngineName/>` mounts. The
    // primer §13.7 B4 deferral note ("export <engine var=…> desugars to
    // export const, indistinguishable today") is closed for the engine surface
    // here — engines are now visible in MOD's exportRegistry as engine-kind.
    //
    // Today's parser leaves `isExported: false` on every engine-decl; the
    // hookup point lands ahead of parser support so a future ast-builder
    // change that detects `export <engine ...>` (Form 1) or
    // `export const X = <engine ...>` (Form 2) only needs to set the flag.
    const machineDecls = file.ast?.machineDecls || [];
    for (const eng of machineDecls) {
      if (!eng || eng.isExported !== true) continue;
      const engineVarName = typeof eng.varName === "string" && eng.varName.length > 0
        ? eng.varName
        : (typeof eng.engineName === "string" ? eng.engineName : "");
      if (engineVarName.length === 0) continue;
      exports.push({
        name: engineVarName,
        localName: engineVarName,
        kind: "engine",
        reExportSource: null,
        span: eng.span || null,
      });
    }

    // Collect exports from AST
    const astExports = file.ast?.exports || [];
    for (const exp of astExports) {
      // F2 (ast-builder-grammar-fixes): `export * from './x'` — emit a
      // single `re-export-all` entry. The seeder/resolver chase via
      // `isReExportAll` rather than name matching.
      if (exp.isReExportAll) {
        exports.push({
          name: "*",
          kind: "re-export-all",
          isReExportAll: true,
          reExportSource: exp.reExportSource ? resolveModulePath(exp.reExportSource, filePath) : null,
          span: exp.span || null,
        });
        continue;
      }
      if (exp.exportedName) {
        // Handle comma-separated re-export names
        const names = exp.exportedName.split(",").map(s => s.trim()).filter(Boolean);
        // F3 (ast-builder-grammar-fixes): `renames` carries the
        // local→exported mapping for braced exports. Build a lookup so
        // each per-name entry can carry its source-side `localName`.
        const renames = Array.isArray(exp.renames) ? exp.renames : null;
        const localFor = renames
          ? new Map(renames.map(r => [r.exported, r.local]))
          : null;
        for (const name of names) {
          exports.push({
            name,
            // F3: localName is the source-side name in the dep file, used by
            // the api.js seeder when chasing `export { A as B } from '...'`.
            // For non-rename forms, localName === name.
            localName: localFor && localFor.has(name) ? localFor.get(name) : name,
            kind: exp.exportKind || "unknown",
            reExportSource: exp.reExportSource ? resolveModulePath(exp.reExportSource, filePath) : null,
            span: exp.span || null,
          });
        }
      }
    }

    graph.set(filePath, { imports, exports });
  }

  return { graph, errors };
}

// ---------------------------------------------------------------------------
// Circular dependency detection (E-IMPORT-002)
// ---------------------------------------------------------------------------

/**
 * Detect circular imports in the import graph.
 *
 * @param {Map<string, object>} graph — import graph from buildImportGraph
 * @returns {ModuleError[]} — E-IMPORT-002 errors for each cycle detected
 */
export function detectCircularImports(graph) {
  const errors = [];
  const visited = new Set();
  const inStack = new Set();

  function dfs(filePath, path) {
    if (inStack.has(filePath)) {
      // Found a cycle
      const cycleStart = path.indexOf(filePath);
      const cycle = path.slice(cycleStart).concat(filePath);
      const cycleStr = cycle.map(p => p.split("/").pop()).join(" -> ");
      errors.push(new ModuleError(
        "E-IMPORT-002",
        `E-IMPORT-002: Circular import detected: ${cycleStr}. ` +
        `Break the cycle by extracting shared code into a third file that both can import.`,
        null,
      ));
      return;
    }
    if (visited.has(filePath)) return;

    visited.add(filePath);
    inStack.add(filePath);

    const entry = graph.get(filePath);
    if (entry) {
      for (const imp of entry.imports) {
        dfs(imp.absSource, [...path, filePath]);
      }
    }

    inStack.delete(filePath);
  }

  for (const filePath of graph.keys()) {
    dfs(filePath, []);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Topological sort for compilation order
// ---------------------------------------------------------------------------

/**
 * Produce a topological ordering of files based on the import graph.
 * Files with no imports come first; files that depend on others come after
 * their dependencies.
 *
 * @param {Map<string, object>} graph
 * @returns {string[]} — file paths in compilation order
 */
export function topologicalSort(graph) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();

  function visit(filePath) {
    if (visited.has(filePath)) return;
    if (temp.has(filePath)) return; // cycle — already reported by detectCircularImports
    temp.add(filePath);

    const entry = graph.get(filePath);
    if (entry) {
      for (const imp of entry.imports) {
        if (graph.has(imp.absSource)) {
          visit(imp.absSource);
        }
      }
    }

    temp.delete(filePath);
    visited.add(filePath);
    sorted.push(filePath);
  }

  for (const filePath of graph.keys()) {
    visit(filePath);
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Export registry
// ---------------------------------------------------------------------------

/**
 * Build an export registry: Map<filePath, Map<name, {kind, category, isComponent}>>
 *
 * P3.A: each entry carries a `category` field that downstream stages
 * (NR's importedRegistry, CE's cross-file lookup, CHX's channel inlining)
 * branch on.
 *
 * P3-FOLLOW: category vocabulary aligned with NR's `resolvedCategory`. The
 * value set is now:
 *   ("user-component" | "channel" | "type" | "function" | "const" | "other")
 * Components use "user-component" (matching NR's resolvedCategory). The
 * legacy `isComponent` boolean is retained as a derived field
 * (`category === "user-component"`) for backwards compatibility with
 * non-routing consumers.
 *
 * §C15.13 (S76 — A1c follow-up): braced re-exports (`export { X } from
 * './source'`) are resolved to inherit the source export's kind/category.
 * Without this, re-exports landed as `kind: "re-export"` falling through
 * to `category: "other"`, which caused SYM PASS 10.B to fire false-positive
 * `E-ENGINE-MOUNT-NOT-ENGINE` on `<X/>` use-sites that resolved through a
 * re-exporter file. Resolution is iterative-to-fixed-point so transitive
 * chains (A re-exports from B re-exports from C) collapse correctly. Cycles
 * are bounded by an iteration cap; cyclic re-exports stay as
 * `kind: "re-export"` (also surfaced separately by `detectCircularImports`).
 * `re-export-all` (`export * from './x'`) is NOT enumerated here — those
 * entries don't carry per-name shape; the importer-side resolver (api.js
 * seeder) chases them via `isReExportAll`. Future work (B-step) can extend
 * this pass to enumerate `*` against the source's full export set if
 * cross-file mount validation through star-re-exports becomes necessary.
 *
 * @param {Map<string, object>} graph
 * @returns {Map<string, Map<string, {kind: string, category: string, isComponent: boolean}>>}
 */
export function buildExportRegistry(graph) {
  const registry = new Map();

  // ---- Pass 1 — build initial registry from direct + engine + per-name entries.
  // Re-exports land with `kind: "re-export"` and carry `_reExportSource` +
  // `_localName` for pass 2 resolution. Underscore-prefixed fields are
  // internal; pass 3 strips them.
  for (const [filePath, entry] of graph) {
    const names = new Map();
    for (const exp of entry.exports) {
      const kind = exp.kind ?? "const";
      const name = exp.name;
      // Components are const exports with PascalCase names (uppercase first letter)
      const isComponent = kind === "const" && name.length > 0 &&
        name[0] >= "A" && name[0] <= "Z";
      // P3.A: derive a state-type category from the export kind. The TAB's
      // P3.A channel-export synthesis sets `kind === "channel"`; type
      // exports have `kind === "type"`; function exports have
      // `kind === "function"` or `"fn"`. Component is the special-cased
      // PascalCase const path (legacy).
      // P3-FOLLOW: align category vocabulary with NR (`resolvedCategory`).
      // NR uses "user-component" for resolved component references; this
      // registry now uses the same name so cross-file CE routing reads from
      // a single canonical category. The legacy "component" category name
      // is gone (was used only here and in doc comments — no other
      // consumers per `grep -rn "category === \"component\""`).
      let category;
      if (kind === "engine") {
        // Phase A1b B14 (M18) — engine exports per §51.0.D + §21.8. Assigned
        // `category: "engine"` so SYM PASS 10.B's cross-file mount validator
        // distinguishes engine mounts from component instantiations + other
        // imports. The legacy `isComponent` boolean is `false` for engines
        // (engines are NOT components, per §51.0.K Components-vs-Engines).
        category = "engine";
      } else if (kind === "channel") {
        category = "channel";
      } else if (isComponent) {
        category = "user-component";
      } else if (kind === "type") {
        category = "type";
      } else if (kind === "function" || kind === "fn") {
        category = "function";
      } else if (kind === "const") {
        category = "const";
      } else {
        category = "other";
      }
      names.set(name, {
        kind,
        category,
        isComponent,
        _reExportSource: exp.reExportSource ?? null,
        _localName: exp.localName ?? name,
      });
    }
    registry.set(filePath, names);
  }

  // ---- Pass 2 — resolve re-exports to fixed-point. Cap iterations at
  // graph.size + 2 so transitive chains converge but cycles can't loop
  // forever. Within an iteration, only re-export entries whose source
  // entry is ALREADY non-re-export get inherited (so we converge in
  // depth-of-chain iterations regardless of registry traversal order).
  const MAX_ITERATIONS = graph.size + 2;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    for (const [, names] of registry) {
      for (const [, entry] of names) {
        if (entry.kind !== "re-export") continue;
        if (!entry._reExportSource) continue;
        const sourceNames = registry.get(entry._reExportSource);
        if (!sourceNames) continue; // source file not in graph (external/.js)
        const sourceEntry = sourceNames.get(entry._localName);
        if (!sourceEntry) continue; // source name missing (E-IMPORT-004 elsewhere)
        if (sourceEntry.kind === "re-export") continue; // chase next iter
        entry.kind = sourceEntry.kind;
        entry.category = sourceEntry.category;
        entry.isComponent = sourceEntry.isComponent;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ---- Pass 3 — strip internal underscore-prefixed fields so the public
  // registry shape stays {kind, category, isComponent}.
  for (const [, names] of registry) {
    for (const [, entry] of names) {
      delete entry._reExportSource;
      delete entry._localName;
    }
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Import validation (E-IMPORT-004)
// ---------------------------------------------------------------------------

/**
 * Validate that all imported names exist in the target file's exports.
 *
 * @param {Map<string, object>} graph
 * @param {Map<string, Set<string>>} exportRegistry
 * @returns {ModuleError[]}
 */
export function validateImports(graph, exportRegistry) {
  const errors = [];

  for (const [filePath, entry] of graph) {
    for (const imp of entry.imports) {
      // Skip .js imports — they follow standard ES module semantics
      if (imp.source.endsWith(".js")) continue;

      const targetExports = exportRegistry.get(imp.absSource);
      if (!targetExports) {
        // Target file is not in the compilation set — could be an external file
        // We only validate imports between files in the compilation set
        continue;
      }

      for (const name of imp.names) {
        if (!targetExports.has(name)) {
          errors.push(new ModuleError(
            "E-IMPORT-004",
            `E-IMPORT-004: \`${name}\` is not exported by \`${imp.source}\`. ` +
            `Check the file for available exports, or add \`export ${name}\` to \`${imp.source}\`.`,
            imp.span,
          ));
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

/**
 * Run the full module resolution pipeline:
 * 1. Build import graph
 * 2. Detect circular imports
 * 3. Validate imports against exports
 * 4. Return compilation order
 *
 * @param {object[]} fileASTs — array of TAB output objects
 * @returns {{ compilationOrder: string[], exportRegistry: Map<string, Set<string>>, errors: ModuleError[] }}
 */
export function resolveModules(fileASTs) {
  const allErrors = [];

  // Step 1: Build the import graph
  const { graph, errors: graphErrors } = buildImportGraph(fileASTs);
  allErrors.push(...graphErrors);

  // Step 2: Detect circular imports
  const circularErrors = detectCircularImports(graph);
  allErrors.push(...circularErrors);

  // Step 3: Build export registry
  const exportRegistry = buildExportRegistry(graph);

  // Step 4: Validate imports
  const importErrors = validateImports(graph, exportRegistry);
  allErrors.push(...importErrors);

  // Step 5: Topological sort
  const compilationOrder = topologicalSort(graph);

  return {
    compilationOrder,
    exportRegistry,
    importGraph: graph,
    errors: allErrors,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The root directory for stdlib modules.
 * `scrml:crypto` resolves to `<STDLIB_ROOT>/crypto/index.scrml` or `<STDLIB_ROOT>/crypto.scrml`.
 */
const STDLIB_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../stdlib");

/**
 * Resolve a module path relative to the importing file.
 *
 * EXPORTED for use by `api.js` cross-file auto-gather pre-pass (W2 §21.7).
 *
 * Supports three forms:
 *   - Relative: `./types.scrml`, `../shared.scrml` → resolved from importer directory
 *   - Stdlib:   `scrml:crypto`, `scrml:auth` → resolved from stdlib/ directory
 *   - Other:    returned as-is (future extensibility)
 *
 * @param {string} source — the path from the import statement
 * @param {string} importerPath — absolute path of the importing file
 * @returns {string} — absolute path of the target module
 */
export function resolveModulePath(source, importerPath) {
  if (source.startsWith("./") || source.startsWith("../")) {
    const resolved = resolve(dirname(importerPath), source);
    // Exact path exists — return it (covers explicit `.scrml`, `.js`, etc.).
    if (existsSync(resolved)) return resolved;
    // Extension-less fallback: `./foo` → `./foo.scrml`, then `./foo/index.scrml`.
    // Skip when the specifier already has a recognized extension so we don't
    // double-append or silently redirect `.js` specifiers.
    if (!resolved.endsWith(".scrml") && !resolved.endsWith(".js")) {
      const withExt = resolved + ".scrml";
      if (existsSync(withExt)) return withExt;
      const asDir = join(resolved, "index.scrml");
      if (existsSync(asDir)) return asDir;
    }
    return resolved;
  }
  if (source.startsWith("scrml:")) {
    const moduleName = source.slice("scrml:".length);
    // Try <stdlib>/<name>/index.scrml first, then <stdlib>/<name>.scrml
    const dirPath = join(STDLIB_ROOT, moduleName, "index.scrml");
    const filePath = join(STDLIB_ROOT, `${moduleName}.scrml`);
    // Prefer directory form (allows multi-file modules)
    if (existsSync(dirPath)) return dirPath;
    return filePath;
  }
  if (source.startsWith("vendor:")) {
    // §40.4: vendor: resolves to <project>/vendor/<path>/index.scrml or .scrml
    const vendorName = source.slice("vendor:".length);
    const projectRoot = resolve(dirname(importerPath), "..");
    const vendorDirPath = join(projectRoot, "vendor", vendorName, "index.scrml");
    const vendorFilePath = join(projectRoot, "vendor", `${vendorName}.scrml`);
    if (existsSync(vendorDirPath)) return vendorDirPath;
    return vendorFilePath;
  }
  // Non-relative, non-stdlib, non-vendor paths: return as-is
  return source;
}

/**
 * Check if a source path is a stdlib import.
 * @param {string} source
 * @returns {boolean}
 */
export function isStdlibImport(source) {
  return source.startsWith("scrml:");
}
