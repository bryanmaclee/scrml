/**
 * scrml LSP — workspace cache (L2 "See the workspace").
 *
 * Owns the multi-file state needed by cross-file features:
 *   - exportRegistry  Map<absPath, Map<exportName, { kind, category, isComponent }>>
 *                     P3-FOLLOW: category is NR-authoritative; isComponent is a derived legacy field.
 *   - fileASTMap      Map<absPath, { filePath, ast, errors, _sourceText }>
 *   - importGraph     Map<absPath, { imports: [...], exports: [...] }>
 *   - moduleErrors    Map<absPath, ModuleError[]>  (E-IMPORT-* per importer)
 *
 * Operations:
 *   createWorkspace()
 *     Allocate an empty cache. The LSP creates one per session.
 *
 *   bootstrapWorkspace(ws, rootPath, log)
 *     Recursively scan `rootPath` for .scrml files, run BS+TAB on each, and
 *     populate the workspace caches. Idempotent (safe to call again on
 *     workspace re-init).
 *
 *   updateFileInWorkspace(ws, filePath, text, log)
 *     Re-run BS+TAB on a single file (open or changed buffer) and update
 *     the workspace caches. Recomputes the import graph + export registry
 *     across the whole workspace because a single export change may affect
 *     downstream files.
 *
 *   removeFileFromWorkspace(ws, filePath)
 *     Drop a file's cache entries on close/delete. Recomputes the cross-file
 *     graph so downstream importers re-validate.
 *
 *   lookupCrossFileDefinition(ws, importerPath, name)
 *     Given an importer file and an unresolved local symbol, walk the
 *     importer's import declarations; if `name` is in some target file's
 *     exports, return { filePath, span, kind } for the foreign declaration.
 *     Returns null if unresolved.
 *
 *   lookupCrossFileFunction(ws, importerPath, name)  [L4]
 *     Same shape as lookupCrossFileDefinition but ALSO returns a function-decl
 *     shaped record (synthesizing one from `export-decl.raw` if needed) so
 *     signature help can render parameters from a foreign function without
 *     re-parsing the foreign source.
 *
 *   getCrossFileDiagnosticsFor(ws, filePath)
 *     Return E-IMPORT-* diagnostics whose importer is `filePath`.
 *
 * No I/O on import. The bootstrap path uses `fs.readdirSync` / `readFileSync`
 * intentionally (synchronous LSP analysis is the existing pattern).
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { resolve, join } from "path";

import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { resolveModules } from "../compiler/src/module-resolver.js";

// ---------------------------------------------------------------------------
// Workspace state
// ---------------------------------------------------------------------------

/**
 * Allocate a fresh workspace cache.
 * @returns {{
 *   rootPath: string|null,
 *   fileASTMap: Map<string, object>,
 *   exportRegistry: Map<string, Map<string, {kind:string, category?:string, isComponent:boolean}>>,
 *   importGraph: Map<string, {imports: object[], exports: object[]}>,
 *   moduleErrors: Map<string, object[]>,
 *   sourceTextByPath: Map<string, string>,
 * }}
 */
export function createWorkspace() {
  return {
    rootPath: null,
    fileASTMap: new Map(),
    exportRegistry: new Map(),
    importGraph: new Map(),
    moduleErrors: new Map(),
    sourceTextByPath: new Map(),
  };
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Recursively list `.scrml` files under `dirPath`.
 * Skips common heavyweight directories (`node_modules`, `dist`, `.git`).
 *
 * @param {string} dirPath
 * @returns {string[]}
 */
export function scanScrmlFiles(dirPath) {
  const out = [];
  if (!dirPath || !existsSync(dirPath)) return out;

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".scrml")) out.push(full);
    }
  }

  walk(resolve(dirPath));
  return out.sort();
}

// ---------------------------------------------------------------------------
// Per-file BS+TAB analysis (bootstrap-quality; no PA/RI/TS)
// ---------------------------------------------------------------------------

/**
 * Run only BS + TAB on a single file. Sufficient for the workspace-level
 * import/export graph — PA/RI/TS run per-file in `analyzeText` (handlers.js).
 *
 * Tolerant of failure: returns a record with `ast: null` when BS/TAB throw.
 *
 * @param {string} filePath — absolute path
 * @param {string} text — file contents
 * @returns {{ filePath: string, ast: object|null, errors: object[] }}
 */
export function tabFile(filePath, text) {
  let bsResult;
  try {
    bsResult = splitBlocks(filePath, text);
  } catch {
    return { filePath, ast: null, errors: [] };
  }
  let tabResult;
  try {
    tabResult = buildAST(bsResult);
  } catch {
    return { filePath, ast: null, errors: [] };
  }
  return {
    filePath,
    ast: tabResult.ast || null,
    errors: tabResult.errors || [],
  };
}

// ---------------------------------------------------------------------------
// Cross-file graph rebuild
// ---------------------------------------------------------------------------

/**
 * Recompute the cross-file `importGraph`, `exportRegistry`, and per-file
 * `moduleErrors` from the current `fileASTMap`. Called after any file is
 * added, updated, or removed.
 *
 * The MOD pass (`resolveModules`) consumes TAB records keyed by
 * `record.filePath` + `record.ast` and returns:
 *   - `importGraph`     Map<absPath, { imports, exports }>
 *   - `exportRegistry`  Map<absPath, Map<name, ExportInfo>>
 *   - `errors`          ModuleError[]  (with `.span.file` set to the importer)
 *
 * We re-bucket the errors by importer so a per-file diagnostic publish can
 * pull just the slice it needs without re-walking the whole list.
 */
export function rebuildCrossFileGraph(ws) {
  const tabRecords = [];
  for (const rec of ws.fileASTMap.values()) {
    if (rec && rec.filePath) tabRecords.push(rec);
  }

  const result = resolveModules(tabRecords);

  ws.importGraph = result.importGraph || new Map();
  ws.exportRegistry = result.exportRegistry || new Map();

  // Bucket module errors by importing file. ModuleError.span.file is set when
  // the import had a span (built in module-resolver.js:buildImportGraph).
  ws.moduleErrors = new Map();
  for (const err of result.errors || []) {
    const importerPath = err?.span?.file || null;
    if (!importerPath) continue;
    if (!ws.moduleErrors.has(importerPath)) ws.moduleErrors.set(importerPath, []);
    ws.moduleErrors.get(importerPath).push(err);
  }
}

// ---------------------------------------------------------------------------
// Workspace operations
// ---------------------------------------------------------------------------

/**
 * Populate the workspace by scanning `rootPath`. Per-file failures are
 * tolerated; the workspace continues with whatever files parsed.
 *
 * @param {object} ws — workspace from createWorkspace()
 * @param {string} rootPath — absolute path to the workspace root
 * @param {(msg:string)=>void} [log]
 */
export function bootstrapWorkspace(ws, rootPath, log) {
  const logger = log || (() => {});
  if (!rootPath) {
    logger("workspace: no rootPath given; skipping bootstrap");
    return;
  }
  ws.rootPath = resolve(rootPath);
  if (!existsSync(ws.rootPath)) {
    logger(`workspace: rootPath does not exist: ${ws.rootPath}`);
    return;
  }

  const files = scanScrmlFiles(ws.rootPath);
  logger(`workspace: scanning ${files.length} .scrml file(s) under ${ws.rootPath}`);
  for (const filePath of files) {
    let text;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rec = tabFile(filePath, text);
    ws.fileASTMap.set(filePath, rec);
    ws.sourceTextByPath.set(filePath, text);
  }

  rebuildCrossFileGraph(ws);
  logger(
    `workspace: bootstrapped ${ws.fileASTMap.size} file(s); ` +
    `${ws.exportRegistry.size} file(s) with exports; ` +
    `${ws.moduleErrors.size} file(s) with import errors`,
  );
}

/**
 * Update or insert a file in the workspace. Recomputes the cross-file graph
 * because export shape may have changed.
 *
 * @param {object} ws
 * @param {string} filePath — absolute path
 * @param {string} text — current buffer contents
 * @returns {{ rec: object, exportsChanged: boolean }}
 */
export function updateFileInWorkspace(ws, filePath, text) {
  const prev = ws.fileASTMap.get(filePath);
  const rec = tabFile(filePath, text);
  ws.fileASTMap.set(filePath, rec);
  ws.sourceTextByPath.set(filePath, text);

  // Detect whether the file's export set shifted; this is the cheap check
  // used by the LSP to decide whether to re-publish diagnostics for other
  // open buffers (the conservative L2 policy from the deep-dive Q3).
  const exportsChanged = !exportSetsEqual(
    prev?.ast?.exports || [],
    rec?.ast?.exports || [],
  );

  rebuildCrossFileGraph(ws);
  return { rec, exportsChanged };
}

/**
 * Remove a file from the workspace (close/delete). Recomputes the cross-file
 * graph so importers re-validate.
 *
 * @param {object} ws
 * @param {string} filePath — absolute path
 */
export function removeFileFromWorkspace(ws, filePath) {
  ws.fileASTMap.delete(filePath);
  ws.sourceTextByPath.delete(filePath);
  rebuildCrossFileGraph(ws);
}

function exportSetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const aNames = new Set(a.map(e => e.exportedName).filter(Boolean));
  const bNames = new Set(b.map(e => e.exportedName).filter(Boolean));
  if (aNames.size !== bNames.size) return false;
  for (const n of aNames) if (!bNames.has(n)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cross-file lookups
// ---------------------------------------------------------------------------

/**
 * Locate the source-file definition of an imported symbol.
 *
 * Walks the importer's import declarations; for each import that names
 * `symbolName`, the target file's AST is searched for a matching declaration
 * (export-decl, type-decl, component-def, function-decl, reactive-decl).
 *
 * Returns { filePath, span, kind, sourceText } on hit; null on miss.
 *
 * @param {object} ws
 * @param {string} importerPath — absolute path of the file that contains the use site
 * @param {string} symbolName — the symbol the user invoked go-to-def on
 * @returns {null | {
 *   filePath: string,
 *   span: object,
 *   kind: string,
 *   sourceText: string,
 * }}
 */
export function lookupCrossFileDefinition(ws, importerPath, symbolName) {
  if (!ws || !importerPath || !symbolName) return null;
  const importerEntry = ws.importGraph.get(importerPath);
  if (!importerEntry) return null;

  for (const imp of importerEntry.imports || []) {
    const names = imp.names || [];
    if (!names.includes(symbolName)) continue;
    const targetPath = imp.absSource;
    if (!targetPath) continue;
    const targetRec = ws.fileASTMap.get(targetPath);
    if (!targetRec || !targetRec.ast) continue;

    const hit = findDeclarationInFile(targetRec.ast, symbolName);
    if (hit) {
      return {
        filePath: targetPath,
        span: hit.span,
        kind: hit.kind,
        sourceText: ws.sourceTextByPath.get(targetPath) || "",
      };
    }
  }
  return null;
}

/**
 * L4 — Locate a foreign function-decl by name and return either the AST node
 * (when the function is declared bare inside a logic block) or a synthesized
 * function-decl-shaped record (when the function is wrapped in an
 * `export function ...` declaration that the AST builder records as an
 * `export-decl` with `exportKind: "function"`).
 *
 * Used by signature help to render parameters from a cross-file function
 * without re-parsing the foreign source.
 *
 * Walks the importer's import declarations; for each import that names
 * `symbolName`, scans the target file for either:
 *   a. a `function-decl` inside a logic block, or
 *   b. an `export-decl` with `exportKind === "function"` whose `raw` text
 *      lifts the function signature out via regex (param list only —
 *      sufficient for signature help).
 *
 * Returns { filePath, fnNode } or null. `fnNode` always exposes
 * `{ name, params, isServer, fnKind, isGenerator?, canFail?, errorType? }`.
 *
 * @param {object} ws
 * @param {string} importerPath — absolute path of the importing file
 * @param {string} symbolName — the function name
 * @returns {null | { filePath: string, fnNode: object }}
 */
export function lookupCrossFileFunction(ws, importerPath, symbolName) {
  if (!ws || !importerPath || !symbolName) return null;
  const importerEntry = ws.importGraph?.get(importerPath);
  if (!importerEntry) return null;

  for (const imp of importerEntry.imports || []) {
    const names = imp.names || [];
    if (!names.includes(symbolName)) continue;
    const targetPath = imp.absSource;
    if (!targetPath) continue;
    const targetRec = ws.fileASTMap.get(targetPath);
    if (!targetRec || !targetRec.ast) continue;

    const fnNode = findFunctionDeclInAST(targetRec.ast, symbolName);
    if (fnNode) {
      return { filePath: targetPath, fnNode };
    }
  }
  return null;
}

/**
 * Walk a file AST for a function declaration named `name`. Looks at:
 *   - logic.body for `function-decl` nodes (bare functions inside `${}`),
 *   - logic.body for `export-decl` nodes with `exportKind === "function"`
 *     (synthesizing a function-decl-shaped record from the `raw` text), and
 *   - the file's hoisted `ast.exports` array (same synthesis).
 *
 * Returns the AST node (or synthesized record) or null.
 */
function findFunctionDeclInAST(ast, name) {
  if (!ast) return null;

  // 1. Hoisted exports — try synthesize from the export-decl's `raw` text.
  for (const e of ast.exports || []) {
    if (e?.exportedName === name && e?.exportKind === "function") {
      const synth = synthesizeFunctionFromExportRaw(e.raw, name);
      if (synth) return synth;
    }
  }

  // 2. Walk logic blocks for bare `function-decl` and `export-decl` (function).
  function walk(nodes) {
    for (const node of nodes || []) {
      if (!node) continue;
      if (node.kind === "logic" || node.kind === "meta") {
        for (const stmt of node.body || []) {
          if (!stmt) continue;
          if (stmt.kind === "function-decl" && stmt.name === name) {
            return stmt;
          }
          if (
            stmt.kind === "export-decl" &&
            stmt.exportKind === "function" &&
            stmt.exportedName === name
          ) {
            const synth = synthesizeFunctionFromExportRaw(stmt.raw, name);
            if (synth) return synth;
          }
        }
      }
      if (Array.isArray(node.children)) {
        const hit = walk(node.children);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(ast.nodes || []);
}

/**
 * Parse the `raw` text of an export-decl whose `exportKind === "function"`
 * and synthesize a function-decl-shaped record carrying `params`.
 *
 * Accepts both:
 *   `export function foo ( a , b )` (TAB-tokenized form, spaces around tokens)
 *   `export function foo(a, b)`     (compact source form)
 *   `export server function foo ( a )`
 *   `export pure function* foo (...)`
 *
 * Returns null if the regex doesn't lock onto a known shape.
 */
function synthesizeFunctionFromExportRaw(raw, name) {
  if (typeof raw !== "string" || !raw) return null;
  // Match `export [server] [pure] function[*] NAME ( ... )` ignoring
  // surrounding whitespace; capture the param list. The raw string from
  // TAB lifts inner identifiers separated by spaces (e.g. "a , b") so we
  // tolerate both ", " and " ,".
  const re = new RegExp(
    "export\\s+(server\\s+)?(pure\\s+)?function(\\*)?\\s+" +
      name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") +
      "\\s*\\(([^)]*)\\)",
  );
  const m = raw.match(re);
  if (!m) return null;
  const isServer = !!m[1];
  const isGenerator = !!m[3];
  const paramListRaw = (m[4] || "").trim();
  // Split on commas, normalize whitespace around each segment.
  const params = paramListRaw
    ? paramListRaw.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  // Detect a trailing `! -> ErrorType` failure marker.
  let canFail = false;
  let errorType = null;
  const tailMatch = raw.slice(m.index + m[0].length).match(/^\s*(!)\s*(?:->\s*([A-Za-z_][A-Za-z0-9_]*))?/);
  if (tailMatch) {
    canFail = true;
    if (tailMatch[2]) errorType = tailMatch[2];
  }

  return {
    kind: "function-decl",
    name,
    params,
    isServer,
    fnKind: "function",
    isGenerator,
    canFail,
    errorType,
    _synthesizedFromExportRaw: true,
  };
}

/**
 * Search a file's AST for a top-level declaration of `name`. Looks at
 * hoisted typeDecls, components, and the export list, plus walks logic
 * bodies for function-decl / reactive-decl.
 *
 * Returns the first matching node's { span, kind } or null.
 */
function findDeclarationInFile(ast, name) {
  if (!ast || !name) return null;

  // 1. Hoisted typeDecls (covers `export type Foo:enum = { ... }` and bare
  //    `type Foo:enum = { ... }`).
  for (const td of ast.typeDecls || []) {
    if (td.name === name) return { span: td.span, kind: "type" };
  }

  // 2. Hoisted components.
  for (const c of ast.components || []) {
    if (c.name === name) return { span: c.span, kind: "component" };
  }

  // 3. Hoisted machineDecls (engineName === name).
  for (const md of ast.machineDecls || []) {
    if (md.engineName === name) return { span: md.span, kind: "machine" };
  }

  // 4. Walk logic blocks for functions / reactive decls.
  const found = walkForDecl(ast.nodes || [], name);
  if (found) return found;

  // 5. Fallback: hoisted exports — span the export-decl line itself if no
  //    underlying decl was located. Better than null for go-to-def UX.
  for (const e of ast.exports || []) {
    if (e.exportedName === name) return { span: e.span, kind: "export" };
  }

  return null;
}

function walkForDecl(nodes, name) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.kind === "logic" || node.kind === "meta") {
      for (const stmt of node.body || []) {
        const hit = matchLogicDecl(stmt, name);
        if (hit) return hit;
      }
      // logic.components / logic.typeDecls are already on the file-level
      // hoists, but a defensive scan covers nested edge cases.
      for (const c of node.components || []) {
        if (c.name === name) return { span: c.span, kind: "component" };
      }
      for (const td of node.typeDecls || []) {
        if (td.name === name) return { span: td.span, kind: "type" };
      }
    }
    if (Array.isArray(node.children)) {
      const hit = walkForDecl(node.children, name);
      if (hit) return hit;
    }
  }
  return null;
}

function matchLogicDecl(stmt, name) {
  if (!stmt) return null;
  switch (stmt.kind) {
    case "function-decl":
      if (stmt.name === name) return { span: stmt.span, kind: "function" };
      break;
    case "state-decl":
    case "reactive-derived-decl":
    case "reactive-debounced-decl": {
      const base = stmt.name?.startsWith("@") ? stmt.name.slice(1) : stmt.name;
      if (stmt.name === name || base === name) {
        return { span: stmt.span, kind: "reactive" };
      }
      break;
    }
    case "tilde-decl":
    case "lin-decl":
      if (stmt.name === name) return { span: stmt.span, kind: "variable" };
      break;
    case "type-decl":
      if (stmt.name === name) return { span: stmt.span, kind: "type" };
      break;
    case "component-def":
      if (stmt.name === name) return { span: stmt.span, kind: "component" };
      break;
    default:
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cross-file diagnostics surface
// ---------------------------------------------------------------------------

/**
 * Return the cross-file ModuleError[] whose importer is `filePath`. May be
 * empty.
 */
export function getCrossFileDiagnosticsFor(ws, filePath) {
  if (!ws || !filePath) return [];
  return ws.moduleErrors.get(filePath) || [];
}
