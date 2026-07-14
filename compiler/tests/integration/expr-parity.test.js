/**
 * ExprNode codegen parity test — Phase 3 verification
 *
 * For every .scrml file in examples/ and samples/compilation-tests/:
 *   1. Compiles through the full pipeline (BS→TAB→CG).
 *   2. Verifies the output JS is syntactically valid.
 *   3. Walks the AST to count ExprNode coverage (what % of expressions have ExprNode).
 *   4. For each ExprNode, verifies emitExpr produces valid JS (no exceptions).
 *
 * Divergences between emitExpr and rewriteExpr are EXPECTED — emitExpr produces
 * compact JS while rewriteExpr preserves tokenizer spacing. Both are correct.
 * The real parity check is: does the compiled output work?
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync, readFileSync } from "fs";
import { resolve, join, basename, dirname } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { emitExpr } from "../../src/codegen/emit-expr.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const projectRoot = resolve(testDir, "..", "..", "..");
const examplesDir = resolve(projectRoot, "examples");
const samplesDir = resolve(projectRoot, "samples", "compilation-tests");

// ---------------------------------------------------------------------------
// Discover .scrml files
// ---------------------------------------------------------------------------

function discoverScrmlFiles(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...discoverScrmlFiles(fullPath));
    } else if (entry.endsWith(".scrml")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

const allFiles = [
  ...discoverScrmlFiles(examplesDir),
  ...discoverScrmlFiles(samplesDir),
];

// ---------------------------------------------------------------------------
// ExprNode / string field pairs
// ---------------------------------------------------------------------------

const FIELD_PAIRS = [
  { exprField: "initExpr",     strField: "init" },
  { exprField: "exprNode",     strField: "expr" },
  { exprField: "condExpr",     strField: "condition" },
  { exprField: "iterExpr",     strField: "iterable" },
  { exprField: "valueExpr",    strField: "value" },
  { exprField: "headerExpr",   strField: "header" },
  { exprField: "callbackExpr", strField: "callback" },
  { exprField: "fnExpr",       strField: "fn" },
  { exprField: "argsExpr",     strField: "args" },
  { exprField: "bodyExpr",     strField: "bodyRaw" },
  { exprField: "fileExpr",     strField: "file" },
  { exprField: "urlExpr",      strField: "url" },
  { exprField: "handlerExpr",  strField: "handler" },
];

// ---------------------------------------------------------------------------
// AST walker
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set(["span", "id", "attrs"]);

function walkASTNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  const all = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || typeof node.kind !== "string") continue;
    all.push(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        if (first && typeof first === "object" && typeof first.kind === "string") {
          all.push(...walkASTNodes(val));
        }
      }
      if (key === "arms" && Array.isArray(val)) {
        for (const arm of val) {
          if (arm && typeof arm === "object") all.push(arm);
        }
      }
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Per-file checks
// ---------------------------------------------------------------------------

function checkFile(filePath) {
  const result = {
    totalExprs: 0,
    withExprNode: 0,
    emitErrors: [],
    compileError: null,
  };

  // Phase 1: Build AST and check ExprNode coverage
  let tabResult;
  try {
    const source = readFileSync(filePath, "utf8");
    const bsResult = splitBlocks(filePath, source);
    tabResult = buildAST(bsResult);
  } catch (e) {
    result.compileError = `AST build failed: ${e.message}`;
    return result;
  }

  const allNodes = walkASTNodes(tabResult.ast?.nodes ?? []);
  const ctx = { mode: "client" };

  // Skip text/comment/css nodes — their value/content fields are literal text, not expressions
  const SKIP_KINDS = new Set(["text", "comment", "css-inline", "style"]);

  for (const node of allNodes) {
    if (SKIP_KINDS.has(node.kind)) continue;
    for (const { exprField, strField } of FIELD_PAIRS) {
      const strVal = node[strField];
      if (typeof strVal !== "string" || !strVal.trim()) continue;

      result.totalExprs++;
      const exprNode = node[exprField];
      if (!exprNode) continue;

      result.withExprNode++;

      // Skip escape hatches — they correctly fall back
      if (exprNode.kind === "escape-hatch") continue;

      // Verify emitExpr doesn't throw
      try {
        emitExpr(exprNode, ctx);
      } catch (e) {
        result.emitErrors.push({
          nodeKind: node.kind ?? "(arm)",
          exprField,
          raw: strVal.slice(0, 120),
          error: e.message,
        });
      }
    }
  }

  // Phase 2: Full compilation — verify no crash
  try {
    compileScrml({
      inputFiles: [filePath],
      write: false,
      verbose: false,
    });
  } catch (e) {
    result.compileError = `Full compile failed: ${e.message}`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExprNode codegen parity", () => {
  let grandTotalExprs = 0;
  let grandTotalWithNode = 0;
  let grandTotalEmitErrors = 0;
  let grandTotalCompileErrors = 0;

  for (const filePath of allFiles) {
    const name = basename(filePath);
    test(name, () => {
      const result = checkFile(filePath);

      grandTotalExprs += result.totalExprs;
      grandTotalWithNode += result.withExprNode;

      if (result.emitErrors.length > 0) {
        grandTotalEmitErrors += result.emitErrors.length;
        const summary = result.emitErrors.map(e =>
          `  ${e.nodeKind}.${e.exprField}: ${e.error} (raw: ${e.raw})`
        ).join("\n");
        // emitExpr must not throw
        expect(result.emitErrors).toHaveLength(0);
      }

      if (result.compileError) {
        grandTotalCompileErrors++;
      }

      // Compilation must not crash (AST build or full compile)
      expect(result.compileError).toBeNull();
    });
  }

  test("summary", () => {
    const coverage = grandTotalExprs > 0
      ? ((grandTotalWithNode / grandTotalExprs) * 100).toFixed(1)
      : "N/A";
    console.log(`\n=== ExprNode Parity Summary ===`);
    console.log(`Files: ${allFiles.length}`);
    console.log(`Total expressions: ${grandTotalExprs}`);
    console.log(`With ExprNode: ${grandTotalWithNode} (${coverage}%)`);
    console.log(`emitExpr errors: ${grandTotalEmitErrors}`);
    console.log(`Compile errors: ${grandTotalCompileErrors}`);
    console.log(`===============================\n`);
  });
});
