/**
 * scrml LSP — pure handler logic.
 *
 * This module exports the analysis + per-feature handler functions used by
 * `lsp/server.js`. They are split out so they can be unit-tested without
 * booting an LSP transport (which `createConnection` requires at module
 * load time).
 *
 * No side effects on import. No I/O. Inputs are already-parsed TextDocument
 * contents; outputs are LSP-shaped (DocumentSymbol[], CompletionItem[],
 * Hover, Diagnostic[], etc).
 *
 * L3 (deep-dive 2026-04-24, "Scrml-unique completions"):
 *   - SQL column completion inside `?{}` blocks driven by PA's `views` Map.
 *   - Component prop completion inside `<Card |...` tags.
 *   - Cross-file completion: `import { | } from "./other.scrml"` lists
 *     exported symbols of the target file. Cross-file imported components
 *     also surface in `<Cap...` markup completions.
 */

import { dirname, resolve, join } from "path";
import { existsSync } from "fs";

import {
  DiagnosticSeverity,
  CompletionItemKind,
  MarkupKind,
  SymbolKind,
  SemanticTokensBuilder,
  SemanticTokenTypes,
} from "vscode-languageserver/node";

// Import compiler stages directly. Same set as server.js.
// NOTE: BPP (Stage 3.5) was retired as a no-op in PIPELINE.md v0.6.0
// (2026-04-02). The stage is no longer in the pipeline; we run TAB →
// PA → RI → TS → DG and pass `tabResult` directly through.
import { splitBlocks } from "../compiler/src/block-splitter.js";
import { buildAST } from "../compiler/src/ast-builder.js";
import { runPA } from "../compiler/src/protect-analyzer.js";
import { runRI } from "../compiler/src/route-inference.js";
import { runTS } from "../compiler/src/type-system.js";
import { runDG } from "../compiler/src/dependency-graph.js";

// Semantic-tokens leaf tokenizer — the native lexer. Verified tolerant (never
// throws) across the whole .scrml corpus + truncation fuzz; carries a maxIters
// guard + error recovery + always-appends-EOF. See docs/changes/
// lsp-semantic-tokens-2026-07-08/progress.md (Phase 0).
import { lex } from "../compiler/native-parser/lex.js";
import { TokenKind } from "../compiler/native-parser/token.js";

// L2 — workspace cache for cross-file go-to-def + diagnostics.
import {
  lookupCrossFileDefinition,
  getCrossFileDiagnosticsFor,
} from "./workspace.js";

// ---------------------------------------------------------------------------
// Span / Range helpers
// ---------------------------------------------------------------------------

/**
 * Convert a byte offset to LSP { line, character } position.
 */
export function offsetToPosition(text, offset) {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}

/**
 * Convert a span { line, col, start?, end? } to an LSP Range.
 * Span line/col are 1-based; LSP ranges are 0-based.
 */
export function spanToRange(span, text) {
  if (!span) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const line = Math.max(0, (span.line ?? 1) - 1);
  const col = Math.max(0, (span.col ?? 1) - 1);

  if (span.start != null && span.end != null && text) {
    const startPos = offsetToPosition(text, span.start);
    const endPos = offsetToPosition(text, Math.min(span.end, text.length));
    return { start: startPos, end: endPos };
  }

  return {
    start: { line, character: col },
    end: { line, character: col + 20 },
  };
}

/**
 * Build a selection range covering just an identifier name within a span.
 */
export function nameRange(span, name, text) {
  if (!span || !name || !text) return spanToRange(span || { line: 1, col: 1 }, text);
  const fullRange = spanToRange(span, text);
  if (span.start == null || span.end == null) return fullRange;
  const segment = text.slice(span.start, span.end);
  const idx = segment.indexOf(name);
  if (idx < 0) return fullRange;
  const nameStart = span.start + idx;
  const nameEnd = nameStart + name.length;
  return {
    start: offsetToPosition(text, nameStart),
    end: offsetToPosition(text, nameEnd),
  };
}

/**
 * Convert an absolute filesystem path to a `file://` URI. Used by L2
 * cross-file go-to-def so the LSP client can open the foreign file.
 */
export function pathToUri(filePath) {
  if (!filePath) return "";
  if (filePath.startsWith("file://")) return filePath;
  // Encode each path segment but preserve the slashes.
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return "file://" + encoded;
}

// ---------------------------------------------------------------------------
// Diagnostics — error code → human-readable source/severity
// ---------------------------------------------------------------------------

export function extractSpan(error) {
  if (error.span) {
    return {
      line: error.span.line ?? 1,
      col: error.span.col ?? 1,
      endLine: error.span.endLine,
      endCol: error.span.endCol,
      start: error.span.start,
      end: error.span.end,
    };
  }
  if (error.bsSpan) {
    return {
      line: error.bsSpan.line ?? 1,
      col: error.bsSpan.col ?? 1,
      start: error.bsSpan.start,
      end: error.bsSpan.end,
    };
  }
  if (error.tabSpan) {
    return {
      line: error.tabSpan.line ?? 1,
      col: error.tabSpan.col ?? 1,
      start: error.tabSpan.start,
      end: error.tabSpan.end,
    };
  }
  return { line: 1, col: 1 };
}

export function getDiagnosticSeverity(error) {
  if (error.severity === "warning") return DiagnosticSeverity.Warning;
  if (error.code?.startsWith("W-")) return DiagnosticSeverity.Warning;
  if (error.code?.startsWith("E-ROUTE-")) return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Error;
}

export function getErrorSource(code) {
  if (!code) return "scrml";
  if (code.startsWith("E-CTX-") || code.startsWith("E-BS-")) return "scrml/block-splitter";
  if (code.startsWith("E-TAB-") || code.startsWith("E-MARKUP-") || code.startsWith("E-STATE-")) return "scrml/tokenizer";
  if (code.startsWith("E-BPP-")) return "scrml/body-pre-parser";
  if (code.startsWith("E-IMPORT-")) return "scrml/module-resolver";
  if (code.startsWith("E-PA-") || code.startsWith("E-PROTECT-")) return "scrml/protect-analyzer";
  if (code.startsWith("E-RI-") || code.startsWith("E-ROUTE-")) return "scrml/route-inference";
  if (
    code.startsWith("E-TYPE-") ||
    code.startsWith("E-SCOPE-") ||
    code.startsWith("E-PURE-") ||
    code.startsWith("E-LIN-") ||
    code.startsWith("E-TILDE-") ||
    code.startsWith("W-MATCH-") ||
    code.startsWith("E-MATCH-") ||
    code.startsWith("E-VARIANT-") ||
    code.startsWith("E-NAME-") ||
    code.startsWith("E-CTRL-") ||
    code.startsWith("E-LOOP-") ||
    code.startsWith("E-ASSIGN-") ||
    code.startsWith("W-ASSIGN-") ||
    code.startsWith("E-EQ-") ||
    code.startsWith("W-EQ-") ||
    code.startsWith("E-SYNTAX-") ||
    code.startsWith("E-FN-") ||
    code.startsWith("E-MU-") ||
    code.startsWith("E-USE-") ||
    code.startsWith("E-PARSE-") ||
    code.startsWith("E-PARSEVARIANT-") ||
    code.startsWith("E-RESERVED-")
  ) return "scrml/type-system";
  if (code.startsWith("E-DG-") || code.startsWith("E-LIFT-") || code.startsWith("W-DG-")) return "scrml/dependency-graph";
  if (code.startsWith("E-CG-") || code.startsWith("W-CG-")) return "scrml/code-generator";
  if (
    code.startsWith("E-ENGINE-") ||
    code.startsWith("W-ENGINE-") ||
    code.startsWith("E-DERIVED-ENGINE-") ||
    code.startsWith("E-HISTORY-") ||
    code.startsWith("E-INTERNAL-RULE-") ||
    code.startsWith("E-IDLE-") ||
    code.startsWith("E-TIMER-") ||
    code.startsWith("E-ONTRANSITION-") ||
    code.startsWith("E-TIMEOUT-") ||
    code.startsWith("E-REPLAY-")
  ) return "scrml/engine";
  if (
    code.startsWith("E-CELL-") ||
    code.startsWith("E-DERIVED-") ||
    code.startsWith("E-REACTIVE-") ||
    code.startsWith("E-VALIDATOR-") ||
    code.startsWith("E-SYNTHESIZED-") ||
    code.startsWith("E-DEBOUNCED-") ||
    code.startsWith("E-REACTIVITY-") ||
    code.startsWith("E-RESET-") ||
    code.startsWith("E-STATE-PINNED-") ||
    code.startsWith("W-DERIVED-")
  ) return "scrml/reactive";
  if (
    code.startsWith("E-CHANNEL-") ||
    code.startsWith("W-CHANNEL-")
  ) return "scrml/channel";
  if (
    code.startsWith("E-COMPONENT-") ||
    code.startsWith("W-COMPONENT-") ||
    code.startsWith("E-EXPORT-")
  ) return "scrml/component";
  if (
    code.startsWith("E-AUTH-") ||
    code.startsWith("W-AUTH-") ||
    code.startsWith("E-MW-") ||
    code.startsWith("W-ATTR-") ||
    code.startsWith("E-ATTR-")
  ) return "scrml/attributes";
  if (
    code.startsWith("E-CONTRACT-") ||
    code.startsWith("E-CPS-") ||
    code.startsWith("W-CPS-")
  ) return "scrml/contracts";
  if (
    code.startsWith("E-LIFECYCLE-") ||
    code.startsWith("W-LIFECYCLE-")
  ) return "scrml/lifecycle";
  if (code.startsWith("E-SQL-") || code.startsWith("E-BATCH-") || code.startsWith("W-BATCH-")) return "scrml/sql";
  if (code.startsWith("E-META-") || code.startsWith("E-META-EVAL-")) return "scrml/meta";
  if (
    code.startsWith("E-TEST-") ||
    code.startsWith("W-LINT-") ||
    code.startsWith("E-CLOSER-") ||
    code.startsWith("E-STRUCTURAL-") ||
    code.startsWith("E-MULTI-STATEMENT-") ||
    code.startsWith("E-WHITESPACE-") ||
    code.startsWith("E-DEPRECATED-") ||
    code.startsWith("W-DEPRECATED-") ||
    code.startsWith("I-MATCH-") ||
    code.startsWith("E-INPUT-") ||
    code.startsWith("E-TAILWIND-") ||
    code.startsWith("W-TAILWIND-") ||
    code.startsWith("E-FOREIGN-") ||
    code.startsWith("W-FOREIGN-") ||
    code.startsWith("E-WASM-")
  ) return "scrml";
  return "scrml";
}

// ---------------------------------------------------------------------------
// Analysis (compiler pipeline → analysis cache entry)
// ---------------------------------------------------------------------------

/**
 * Run the compiler pipeline on `text` and return both diagnostics and an
 * analysis object containing the AST + extracted symbol info.
 *
 * `logger` is an optional `(msg) => void` for non-fatal stage warnings.
 * If omitted, warnings are silently dropped.
 *
 * `workspace` (L2, optional): when provided, cross-file `E-IMPORT-*`
 * diagnostics from the workspace cache are merged into the diagnostics
 * array so import-resolution errors surface in the editor on the importer's
 * line.
 */
export function analyzeText(filePath, text, logger, workspace) {
  const log = logger || (() => {});
  const diagnostics = [];
  const analysis = {
    ast: null,
    text,
    filePath,
    reactiveVars: [],
    tildeVars: [],
    linVars: [],
    functions: [],
    types: [],
    machines: [],
    components: [],
    stateBlocks: [],
    stateConstructors: [],
  };

  let bsResult;
  try {
    bsResult = splitBlocks(filePath, text);
  } catch (e) {
    pushError(diagnostics, e, text, "E-BS-000");
    return { diagnostics, analysis };
  }

  let tabResult;
  try {
    tabResult = buildAST(bsResult);
  } catch (e) {
    pushError(diagnostics, e, text, "E-TAB-000");
    return { diagnostics, analysis };
  }

  if (tabResult.errors?.length > 0) {
    for (const e of tabResult.errors) pushError(diagnostics, e, text);
  }

  if (tabResult.ast) {
    analysis.ast = tabResult.ast;
    extractAnalysisInfo(tabResult.ast, analysis);
  }

  // BPP (Stage 3.5) was retired in PIPELINE.md v0.6.0 (no-op pass-through).
  // We feed `tabResult` directly into PA so the file shape used by downstream
  // stages is the TAB output.
  const files = [tabResult];

  let paResult = { protectAnalysis: { views: new Map() }, errors: [] };
  try {
    paResult = runPA({ files });
    if (paResult.errors?.length > 0) {
      for (const e of paResult.errors) pushError(diagnostics, e, text);
    }
  } catch (e) {
    log(`PA error: ${e.message}`);
  }

  // L3 — surface PA's `views` Map on the analysis cache so per-completion
  // handlers (SQL column completion) can resolve table → ColumnDef[] lookups
  // without re-running PA.
  analysis.protectAnalysis = paResult.protectAnalysis;

  let riResult = { routeMap: { functions: new Map() }, errors: [] };
  try {
    riResult = runRI({ files, protectAnalysis: paResult.protectAnalysis });
    if (riResult.errors?.length > 0) {
      for (const e of riResult.errors) pushError(diagnostics, e, text);
    }
  } catch (e) {
    log(`RI error: ${e.message}`);
  }

  try {
    const tsResult = runTS({
      files,
      protectAnalysis: paResult.protectAnalysis,
      routeMap: riResult.routeMap,
    });
    if (tsResult.errors?.length > 0) {
      for (const e of tsResult.errors) pushError(diagnostics, e, text);
    }
    try {
      const dgResult = runDG({
        files: tsResult.files || files,
        routeMap: riResult.routeMap,
      });
      if (dgResult.errors?.length > 0) {
        for (const e of dgResult.errors) pushError(diagnostics, e, text);
      }
    } catch (e) {
      log(`DG error: ${e.message}`);
    }
  } catch (e) {
    log(`TS error: ${e.message}`);
  }

  // L2 — append cross-file diagnostics from the workspace cache. The cache
  // owns the latest E-IMPORT-* errors for this file's import declarations
  // (e.g. importing a non-exported name surfaces here).
  if (workspace) {
    const crossFile = getCrossFileDiagnosticsFor(workspace, filePath);
    for (const e of crossFile) pushError(diagnostics, e, text);
  }

  return { diagnostics, analysis };
}

function pushError(diagnostics, e, text, fallbackCode) {
  const span = extractSpan(e);
  diagnostics.push({
    severity: getDiagnosticSeverity(e),
    range: spanToRange(span, text),
    message: e.message || String(e),
    source: getErrorSource(e.code),
    code: e.code || fallbackCode || "E-UNKNOWN",
  });
}

/**
 * Walk the AST and populate analysis.{reactiveVars, functions, types, ...}.
 *
 * NOTE: AST node `kind` is lowercase-kebab in the canonical AST shape
 * (`function-decl`, `state-decl`, etc).
 */
export function extractAnalysisInfo(ast, analysis) {
  if (!ast) return;

  if (Array.isArray(ast.typeDecls)) {
    for (const td of ast.typeDecls) {
      analysis.types.push({
        name: td.name,
        span: td.span,
        typeKind: td.typeKind || "type",
        raw: td.raw || "",
      });
    }
  }
  if (Array.isArray(ast.machineDecls)) {
    for (const md of ast.machineDecls) {
      analysis.machines.push({
        name: md.engineName,
        span: md.span,
        governedType: md.governedType || "",
        sourceVar: md.sourceVar || null,
      });
    }
  }
  if (Array.isArray(ast.components)) {
    for (const c of ast.components) {
      analysis.components.push({
        name: c.name,
        span: c.span,
        raw: c.raw || "",
      });
    }
  }

  if (!ast.nodes) return;

  function walkNodes(nodes, parentStateType) {
    for (const node of nodes) {
      if (!node) continue;
      switch (node.kind) {
        case "state": {
          analysis.stateBlocks.push({
            stateType: node.stateType,
            span: node.span,
            attrs: node.attrs || [],
          });
          if (Array.isArray(node.children)) walkNodes(node.children, node.stateType);
          break;
        }
        case "state-constructor-def": {
          analysis.stateConstructors.push({
            stateType: node.stateType,
            span: node.span,
            typedAttrs: node.typedAttrs || [],
          });
          if (Array.isArray(node.children)) walkNodes(node.children, node.stateType);
          break;
        }
        case "engine-decl":
          break; // already captured via ast.machineDecls
        case "logic": {
          if (Array.isArray(node.body)) walkLogicNodes(node.body, parentStateType);
          if (Array.isArray(node.components)) {
            for (const c of node.components) {
              if (!analysis.components.find(x => x.name === c.name)) {
                analysis.components.push({ name: c.name, span: c.span, raw: c.raw || "" });
              }
            }
          }
          if (Array.isArray(node.typeDecls)) {
            for (const td of node.typeDecls) {
              if (!analysis.types.find(x => x.name === td.name)) {
                analysis.types.push({
                  name: td.name,
                  span: td.span,
                  typeKind: td.typeKind || "type",
                  raw: td.raw || "",
                });
              }
            }
          }
          break;
        }
        case "markup":
          if (Array.isArray(node.children)) walkNodes(node.children, parentStateType);
          break;
        case "meta":
          if (Array.isArray(node.body)) walkLogicNodes(node.body, parentStateType);
          break;
        default:
          break;
      }
    }
  }

  function walkLogicNodes(nodes, parentStateType) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node) continue;
      switch (node.kind) {
        case "function-decl": {
          analysis.functions.push({
            name: node.name,
            span: node.span,
            params: node.params || [],
            isServer: !!node.isServer,
            fnKind: node.fnKind || "function",
            isGenerator: !!node.isGenerator,
            canFail: !!node.canFail,
            errorType: node.errorType || null,
            stateTypeScope: node.stateTypeScope || parentStateType || null,
            isHandleEscapeHatch: !!node.isHandleEscapeHatch,
          });
          if (Array.isArray(node.body)) walkLogicNodes(node.body, parentStateType);
          break;
        }
        case "state-decl": {
          // Phase A1a Step 11.5 — fold of `reactive-derived-decl`. State-decl
          // with shape:"derived" + structuralForm:false is the post-fold
          // representation of legacy `const @x = expr`. Surface it via the
          // existing "derived" reactiveKind label so hover/symbol/analysis
          // outputs are unchanged.
          // S79 — `reactive-debounced-decl` retired; debounced cells now ride
          // on state-decl with a `reactivity.debounced` field (SPEC §6.13).
          // Surface as the "debounced" reactiveKind so the hover/completion
          // detail strings render the timing rule.
          const isFoldedDerived = node.shape === "derived" && node.structuralForm === false;
          let reactiveKind = isFoldedDerived ? "derived" : "reactive";
          let delay = undefined;
          if (node.reactivity && node.reactivity.debounced) {
            reactiveKind = "debounced";
            const dur = node.reactivity.debounced;
            delay = dur.kind === "literal" ? dur.ms : (dur.kind === "computed" ? "computed" : undefined);
          } else if (node.reactivity && node.reactivity.throttled) {
            reactiveKind = "throttled";
            const dur = node.reactivity.throttled;
            delay = dur.kind === "literal" ? dur.ms : (dur.kind === "computed" ? "computed" : undefined);
          }
          analysis.reactiveVars.push({
            name: node.name?.startsWith("@") ? node.name.slice(1) : node.name,
            span: node.span,
            type: node.typeAnnotation || null,
            reactiveKind,
            isShared: !!node.isShared,
            ...(delay !== undefined ? { delay } : {}),
          });
          break;
        }
        case "reactive-derived-decl": {
          analysis.reactiveVars.push({
            name: node.name?.startsWith("@") ? node.name.slice(1) : node.name,
            span: node.span,
            type: null,
            reactiveKind: "derived",
          });
          break;
        }
        // S79 — case "reactive-debounced-decl" retired; debounced cells ride
        // on state-decl with reactivity.debounced (handled in the case above).
        case "tilde-decl":
          analysis.tildeVars.push({ name: node.name, span: node.span });
          break;
        case "lin-decl":
          analysis.linVars.push({ name: node.name, span: node.span });
          break;
        case "type-decl":
          if (!analysis.types.find(x => x.name === node.name)) {
            analysis.types.push({
              name: node.name,
              span: node.span,
              typeKind: node.typeKind || "type",
              raw: node.raw || "",
            });
          }
          break;
        case "component-def":
          if (!analysis.components.find(x => x.name === node.name)) {
            analysis.components.push({ name: node.name, span: node.span, raw: node.raw || "" });
          }
          break;
        case "if-stmt":
          if (Array.isArray(node.consequent)) walkLogicNodes(node.consequent, parentStateType);
          if (Array.isArray(node.alternate)) walkLogicNodes(node.alternate, parentStateType);
          break;
        case "for-stmt":
        case "while-stmt":
        case "transaction-block":
          if (Array.isArray(node.body)) walkLogicNodes(node.body, parentStateType);
          break;
        case "switch-stmt":
          if (Array.isArray(node.cases)) {
            for (const c of node.cases) {
              if (Array.isArray(c.body)) walkLogicNodes(c.body, parentStateType);
            }
          }
          break;
        case "try-stmt":
          if (Array.isArray(node.body)) walkLogicNodes(node.body, parentStateType);
          if (Array.isArray(node.catchBody)) walkLogicNodes(node.catchBody, parentStateType);
          if (Array.isArray(node.finallyBody)) walkLogicNodes(node.finallyBody, parentStateType);
          break;
        case "match-stmt":
          if (Array.isArray(node.arms)) {
            for (const arm of node.arms) {
              if (Array.isArray(arm.body)) walkLogicNodes(arm.body, parentStateType);
            }
          }
          break;
        case "markup":
          if (Array.isArray(node.children)) walkNodes(node.children, parentStateType);
          break;
        default:
          break;
      }
    }
  }

  walkNodes(ast.nodes, null);
}

// ---------------------------------------------------------------------------
// Function signature formatter (used by hover and document-symbol detail)
// ---------------------------------------------------------------------------

export function formatFunctionSignature(fn) {
  const boundary = fn.isServer ? "server" : "client";
  const kindWord = fn.fnKind === "fn" ? "fn" : "function";
  const generator = fn.isGenerator ? "*" : "";
  const failMarker = fn.canFail ? (fn.errorType ? `! -> ${fn.errorType}` : "!") : "";
  const params = (fn.params || [])
    .map(p => (typeof p === "string" ? p : p?.name || ""))
    .filter(Boolean)
    .join(", ");
  return `${kindWord}${generator} ${fn.name}(${params})${failMarker ? " " + failMarker : ""} [${boundary}]`;
}

// ---------------------------------------------------------------------------
// Document symbols (L1)
// ---------------------------------------------------------------------------

/**
 * Build a hierarchical DocumentSymbol[] tree for an analyzed AST.
 *
 * Symbol mapping:
 *   - <state> block (e.g. < db>)        → Module    (children = nested decls)
 *   - state-constructor-def              → Class     (children = constructor body)
 *   - engine-decl                       → Class
 *   - type-decl  (typeKind=enum)         → Enum
 *   - type-decl  (typeKind=struct)       → Struct
 *   - type-decl  (other)                 → Interface
 *   - function-decl (server)             → Method
 *   - function-decl (client)             → Function
 *   - component-def                      → Class
 *   - state-decl / -derived / -debounced → Variable
 *   - tilde-decl                         → Variable
 *   - lin-decl                           → Variable
 */
export function buildDocumentSymbols(ast, text) {
  if (!ast || !ast.nodes) return [];

  function symbolFor(node, parentStateScope) {
    if (!node) return null;
    switch (node.kind) {
      case "state": {
        const sym = {
          name: `<${node.stateType}>`,
          detail: "state block",
          kind: SymbolKind.Module,
          range: spanToRange(node.span, text),
          selectionRange: nameRange(node.span, node.stateType, text),
          children: [],
        };
        if (Array.isArray(node.children)) {
          for (const ch of node.children) {
            for (const cs of collectChildSymbols(ch, node.stateType)) sym.children.push(cs);
          }
        }
        return sym;
      }
      case "state-constructor-def": {
        const sym = {
          name: node.stateType,
          detail: "state constructor definition",
          kind: SymbolKind.Class,
          range: spanToRange(node.span, text),
          selectionRange: nameRange(node.span, node.stateType, text),
          children: [],
        };
        if (Array.isArray(node.typedAttrs)) {
          for (const ta of node.typedAttrs) {
            sym.children.push({
              name: ta.name,
              detail: ta.typeExpr + (ta.optional ? "?" : "") + (ta.defaultValue != null ? ` = ${ta.defaultValue}` : ""),
              kind: SymbolKind.Field,
              range: spanToRange(ta.span, text),
              selectionRange: nameRange(ta.span, ta.name, text),
              children: [],
            });
          }
        }
        if (Array.isArray(node.children)) {
          for (const ch of node.children) {
            for (const cs of collectChildSymbols(ch, node.stateType)) sym.children.push(cs);
          }
        }
        return sym;
      }
      case "engine-decl":
        return {
          name: node.engineName,
          detail: `machine for ${node.governedType}${node.sourceVar ? ` (derived @${node.sourceVar})` : ""}`,
          kind: SymbolKind.Class,
          range: spanToRange(node.span, text),
          selectionRange: nameRange(node.span, node.engineName, text),
          children: [],
        };
      case "logic": {
        const children = [];
        if (Array.isArray(node.body)) {
          for (const stmt of node.body) {
            const cs = logicStatementSymbol(stmt, parentStateScope);
            if (cs) children.push(cs);
          }
        }
        if (Array.isArray(node.components)) {
          for (const c of node.components) {
            if (!children.find(s => s.name === c.name)) {
              children.push({
                name: c.name,
                detail: "component",
                kind: SymbolKind.Class,
                range: spanToRange(c.span, text),
                selectionRange: nameRange(c.span, c.name, text),
                children: [],
              });
            }
          }
        }
        if (Array.isArray(node.typeDecls)) {
          for (const td of node.typeDecls) {
            if (!children.find(s => s.name === td.name)) {
              children.push(typeDeclSymbol(td));
            }
          }
        }
        return { __flatten: true, children };
      }
      case "markup": {
        const children = [];
        if (Array.isArray(node.children)) {
          for (const ch of node.children) {
            for (const cs of collectChildSymbols(ch, parentStateScope)) children.push(cs);
          }
        }
        return { __flatten: true, children };
      }
      case "meta": {
        const children = [];
        if (Array.isArray(node.body)) {
          for (const stmt of node.body) {
            const cs = logicStatementSymbol(stmt, parentStateScope);
            if (cs) children.push(cs);
          }
        }
        if (children.length === 0) return null;
        return {
          name: "^{ meta }",
          detail: "compile-time block",
          kind: SymbolKind.Namespace,
          range: spanToRange(node.span, text),
          selectionRange: spanToRange(node.span, text),
          children,
        };
      }
      default:
        return null;
    }
  }

  function collectChildSymbols(node, parentStateScope) {
    const sym = symbolFor(node, parentStateScope);
    if (!sym) return [];
    if (sym.__flatten) return sym.children;
    return [sym];
  }

  function logicStatementSymbol(stmt, parentStateScope) {
    if (!stmt) return null;
    switch (stmt.kind) {
      case "function-decl": {
        const detail = formatFunctionSignature({
          name: stmt.name,
          isServer: !!stmt.isServer,
          fnKind: stmt.fnKind,
          isGenerator: !!stmt.isGenerator,
          canFail: !!stmt.canFail,
          errorType: stmt.errorType,
          params: stmt.params || [],
        });
        return {
          name: stmt.name,
          detail,
          kind: stmt.isServer ? SymbolKind.Method : SymbolKind.Function,
          range: spanToRange(stmt.span, text),
          selectionRange: nameRange(stmt.span, stmt.name, text),
          children: [],
        };
      }
      case "state-decl":
      case "reactive-derived-decl": {
        // S79 — `reactive-debounced-decl` retired (§6.13 reactivity attribute).
        const baseName = stmt.name?.startsWith("@") ? stmt.name.slice(1) : stmt.name;
        // Phase A1a Step 11.5 — fold: state-decl with shape:"derived" +
        // structuralForm:false is the post-fold representation of the legacy
        // `const @x = expr` form (formerly reactive-derived-decl). Surface
        // the `@derived` label for it so hover/symbol output is unchanged.
        const isFoldedDerived =
          stmt.kind === "state-decl" &&
          stmt.shape === "derived" &&
          stmt.structuralForm === false;
        // S79 — surface the new reactivity-attribute timing rule in the
        // detail string when present. Mirrors the pre-S79 `@debounced(N)`
        // detail format adapted for the new attribute syntax.
        let stateDetail;
        if (isFoldedDerived) {
          stateDetail = "@derived";
        } else if (stmt.kind === "state-decl" && stmt.reactivity?.debounced) {
          const dur = stmt.reactivity.debounced;
          const msStr = dur.kind === "literal" ? `${dur.ms}ms` : (dur.kind === "computed" ? "computed" : "?");
          stateDetail = `<${baseName} debounced=${msStr}>`;
        } else if (stmt.kind === "state-decl" && stmt.reactivity?.throttled) {
          const dur = stmt.reactivity.throttled;
          const msStr = dur.kind === "literal" ? `${dur.ms}ms` : (dur.kind === "computed" ? "computed" : "?");
          stateDetail = `<${baseName} throttled=${msStr}>`;
        } else {
          stateDetail = "@reactive" + (stmt.isShared ? " (shared)" : "");
        }
        const detailMap = {
          "state-decl": stateDetail,
          "reactive-derived-decl": "@derived",
        };
        return {
          name: `@${baseName}`,
          detail: detailMap[stmt.kind] || "@reactive",
          kind: SymbolKind.Variable,
          range: spanToRange(stmt.span, text),
          selectionRange: nameRange(stmt.span, baseName, text),
          children: [],
        };
      }
      case "tilde-decl":
        return {
          name: stmt.name,
          detail: "~ (must-use)",
          kind: SymbolKind.Variable,
          range: spanToRange(stmt.span, text),
          selectionRange: nameRange(stmt.span, stmt.name, text),
          children: [],
        };
      case "lin-decl":
        return {
          name: stmt.name,
          detail: "lin (linear)",
          kind: SymbolKind.Variable,
          range: spanToRange(stmt.span, text),
          selectionRange: nameRange(stmt.span, stmt.name, text),
          children: [],
        };
      case "type-decl":
        return typeDeclSymbol(stmt);
      case "component-def":
        return {
          name: stmt.name,
          detail: "component",
          kind: SymbolKind.Class,
          range: spanToRange(stmt.span, text),
          selectionRange: nameRange(stmt.span, stmt.name, text),
          children: [],
        };
      case "transaction-block": {
        const children = [];
        if (Array.isArray(stmt.body)) {
          for (const s of stmt.body) {
            const cs = logicStatementSymbol(s, parentStateScope);
            if (cs) children.push(cs);
          }
        }
        if (children.length === 0) return null;
        return {
          name: "transaction",
          detail: "transaction block",
          kind: SymbolKind.Namespace,
          range: spanToRange(stmt.span, text),
          selectionRange: spanToRange(stmt.span, text),
          children,
        };
      }
      default:
        return null;
    }
  }

  function typeDeclSymbol(td) {
    const kindMap = {
      "enum": SymbolKind.Enum,
      "struct": SymbolKind.Struct,
    };
    const symKind = kindMap[td.typeKind] || SymbolKind.Interface;
    return {
      name: td.name,
      detail: td.typeKind ? `type :${td.typeKind}` : "type",
      kind: symKind,
      range: spanToRange(td.span, text),
      selectionRange: nameRange(td.span, td.name, text),
      children: [],
    };
  }

  const symbols = [];
  for (const node of ast.nodes) {
    for (const cs of collectChildSymbols(node, null)) symbols.push(cs);
  }

  // Deduplicate sibling symbols by (kind, name, line) to avoid double-emit
  // when a node appears both in ast.machineDecls and ast.nodes top-level.
  const seen = new Set();
  const out = [];
  for (const s of symbols) {
    const key = `${s.kind}::${s.name}::${s.range.start.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export const ERROR_DESCRIPTIONS = {
  // Block Splitter
  "E-CTX-001": "Wrong closer for current context. Mismatched closing tag, or wrong delimiter for the current block type.",
  "E-CTX-002": "Bare `/` or trailing `/` used inside a logic/sql/css/error-effect/meta context. Use explicit closers in brace-delimited blocks.",
  "E-CTX-003": "Unclosed context at end of file. A tag or brace-delimited block was opened but never closed.",
  // Tokenizer / AST Builder
  "E-TAB-001": "Syntax error in tokenization. The token stream could not be parsed.",
  "E-TAB-002": "Unexpected token in AST construction.",
  // Body Pre-Parser
  "E-BPP-001": "Parse failure in a function/pure/fn body. The body could not be tokenized or parsed into a LogicNode tree.",
  // Module Resolver (L2)
  "E-IMPORT-002": "Circular import detected. Break the cycle by extracting shared code into a third file.",
  "E-IMPORT-004": "Imported name is not exported by the target file. Check the file's exports or add the missing export.",
  "E-IMPORT-005": "Bare npm-style import specifier. scrml requires `./relative`, `scrml:stdlib`, or `vendor:vendor` prefixes.",
  "E-IMPORT-006": "Cannot resolve import — no file found at the given path.",
  // Protect Analyzer
  "E-PA-001": "src= database file does not exist on disk.",
  "E-PA-003": "Bun SQLite schema introspection failed.",
  "E-PA-004": "tables= references a table not found in the database.",
  "E-PA-005": "tables= attribute is absent or its parsed value is empty.",
  "E-PA-006": "src= attribute is absent from a <db> block.",
  "E-PA-007": "protect= field matches no column in any listed table (security error).",
  // Route Inference
  "E-RI-002": "Server-escalated function assigns to @reactive variable. Server functions cannot write client-side reactive state.",
  "E-ROUTE-001": "Unresolvable callee. A function call target could not be statically resolved.",
  // Type System
  "E-SCOPE-001": "Unquoted identifier attribute value cannot be resolved in current scope.",
  "E-TYPE-004": "Struct field does not exist on the given type.",
  "E-TYPE-006": "Non-exhaustive match over union type. Not all members are covered.",
  "E-TYPE-020": "Non-exhaustive match over enum type. Not all variants are covered.",
  "E-TYPE-023": "Duplicate arm for the same variant in a match expression.",
  "E-TYPE-050": "Two tables (or a table + user type) produce the same generated type name.",
  "E-TYPE-051": "ColumnDef.sqlType not mappable to a scrml type. Typed as-is (warning).",
  "E-TYPE-052": "InitCap algorithm produces an invalid scrml identifier from a table name.",
  "E-PURE-001": "Pure function body contains a purity violation (side effect).",
  "E-PURE-002": "Pure function calls a non-pure function.",
  "E-LIN-001": "Linear variable not consumed before scope exit.",
  "E-LIN-002": "Linear variable consumed more than once (or inside a loop).",
  "E-LIN-003": "Linear variable consumed in some branches but not others.",
  "E-TILDE-001": "~ read without initialization.",
  "E-TILDE-002": "~ reinitialized without consumption (or unconsumed at scope exit).",
  "W-MATCH-001": "Redundant wildcard arm when all variants are already covered (warning).",
  // Dependency Graph
  "E-DG-001": "Cyclic dependency detected in 'awaits' edges.",
  "E-DG-002": "Reactive variable has no readers (warning).",
  "E-LIFT-001": "Independent lift-bearing nodes in the same logic block. Two parallel operations both use `lift`, which creates ordering ambiguity.",
  // Code Generator
  "E-CG-001": "Node with unknown type encountered during codegen.",
  "E-CG-002": "Server-boundary function has no generated route name.",
  "E-CG-003": "Dependency graph edge references unknown node ID.",
  "E-CG-004": "CSS scoping collision.",
  "E-CG-005": "Non-deterministic MetaBlock with meta.runtime === false.",
  "E-CG-006": "Codegen invariant violation (e.g., transaction in client-boundary function, unresolvable scheduling primitive). Message names the specific violation.",
  // Reactive — derived / synthesized / pinned / reactivity attrs (v0.2.0)
  "E-DERIVED-WRITE": "Reassignment to a const-derived reactive cell. Derived cells are read-only.",
  "E-DERIVED-VALUE-MUTATE": "In-place value-mutation of a const-derived reactive cell (array mutating method, property assign, delete). Mutate the upstream cell instead. (SPEC §6.6.18 / L21)",
  "E-DERIVED-WITH-VALIDATORS": "Validators applied to a derived cell. Use a refinement type instead: const <x>: number(>=0) = expr. (SPEC §55.14)",
  "E-DEBOUNCED-WITH-DERIVED": "debounced= or throttled= applied to a derived cell. Debounce the upstream source instead. (SPEC §6.13)",
  "E-DEBOUNCED-WITH-SERVER": "debounced= or throttled= applied to a <x server> server-authoritative cell. Server-side timing semantics are out of scope this revision. (SPEC §6.13)",
  "E-REACTIVITY-ATTR-CONFLICT": "Both debounced= and throttled= declared on the same cell. Pick one. (SPEC §6.13)",
  "E-CELL-NO-RENDER-SPEC": "<varname/> used as render-by-tag but the cell has no render-spec (plain or non-markup derived). Use ${@varname} interpolation instead. (SPEC §6.4)",
  "E-CELL-RENDER-SPEC-NOT-BINDABLE": "Shape 2 declaration with non-bindable RHS markup (e.g., <div>). Use const <name> for display-only markup cells. (SPEC §6.2)",
  "E-STATE-PINNED-FORWARD-REF": "Read of a pinned state declaration before its declaration site. pinned opts out of hoisting. (SPEC §6.10)",
  "E-SYNTHESIZED-WRITE": "Assignment to an auto-synthesized validity surface property (e.g., @signup.isValid). Synthesized cells are read-only. (SPEC §55)",
  "E-RESET-NO-ARG": "reset() requires an explicit cell argument: reset(@cell). (SPEC §6.8)",
  "E-RESET-INVALID-TARGET": "reset target must be reset(@cell), reset(@compound), or reset(@compound.field). (SPEC §6.8.2)",
  "E-VALIDATOR-INLINE-DYNAMIC": "Inline validator message override must be a static string literal (i18n extraction requires static discoverability). (SPEC §55.10)",
  "E-VALIDATOR-CIRCULAR-DEP": "Cycle in validator-arg cross-field references. The validator dependency graph is a DAG. (SPEC §55.11)",
  // Engine — Tier-2 state machines (v0.2.0)
  "E-ENGINE-INVALID-TRANSITION": "Direct write or .advance() violates the from-state's rule= contract. (SPEC §51.0.F-G)",
  "E-ENGINE-EFFECT-AMBIGUOUS": "effect= on a multi-target rule. Use <onTransition> child(ren) instead. (SPEC §51.0.H)",
  "E-ENGINE-VAR-DUPLICATE": "Engine's auto-declared variable name collides with another declaration. Use var= to override the auto-derived name. (SPEC §51.0.C)",
  "E-ENGINE-MOUNT-NOT-ENGINE": "Self-closing <EngineName/> mounts an import whose source export is not an engine. (SPEC §51.0.D / §21.8)",
  "E-ENGINE-STATE-CHILD-MISSING": "Variant of for=Type has no matching state-child tag in the engine body. (SPEC §51.0.B-F)",
  "E-ENGINE-STATE-CHILD-INVALID-VARIANT": "State-child tag does not match any variant of for=Type. (SPEC §51.0.B)",
  "E-ENGINE-INITIAL-INVALID-VARIANT": "initial=.X references a variant not in for=Type. (SPEC §51.0.E)",
  "E-ENGINE-RULE-INVALID-VARIANT": "rule= value references a variant not in for=Type. (SPEC §51.0.F)",
  "E-ENGINE-RULE-LEGACY-SYNTAX": "rule= uses legacy event-arrow form (rule=\"event -> Variant\"). Use one of the three §51.0.F target-only forms. (SPEC §51.0.F)",
  "W-ENGINE-INITIAL-MISSING": "initial= omitted on a non-derived <engine>. Compiler defaults to the first state-child's variant. (SPEC §51.0.E)",
  "E-DERIVED-ENGINE-NO-RULES": "rule= on a state-child of a derived engine. Derived engines compute transitions from the source expression. (SPEC §51.0.J)",
  "E-DERIVED-ENGINE-NO-INITIAL": "initial= on a derived engine. The initial value is computed at engine-init time. (SPEC §51.0.J / §51.0.E)",
  "E-DERIVED-ENGINE-NO-WRITE": "Direct write to a derived engine's variable. Derived-engine variables are read-only. (SPEC §51.0.J)",
  "E-DERIVED-ENGINE-CIRCULAR": "Cycle in chained derived-engine derivation. (SPEC §51.0.J)",
  "E-COMPONENT-ENGINE-SCOPE": "Component body contains an <engine> element. Engines are singletons; declare the engine outside the component and mount via <EngineName/>. (SPEC §51.0.K)",
  "E-HISTORY-NO-INNER-ENGINE": "history attribute on a state-child without a nested <engine>. history is meaningful only on composite state-children. (SPEC §51.0.N)",
  "E-INTERNAL-RULE-NOT-COMPOSITE": "internal:rule= prefix on a non-composite state-child. Use canonical rule= instead. (SPEC §51.0.O)",
  "E-ONTRANSITION-NO-TARGET": "<onTransition> with neither to= nor from=. Exactly one must appear. (SPEC §51.0.H)",
  // onTimeout / onIdle (S77 / S79)
  "E-IDLE-MISPLACED": "<onIdle> inside a state-child body. <onIdle> is engine-wide and must sit at engine-root scope. For per-state semantics use <onTimeout>. (SPEC §51.0.R)",
  "E-IDLE-INVALID-VARIANT": "<onIdle to=.X/> references a variant not in for=Type, or to= is missing/malformed. (SPEC §51.0.R)",
  "E-IDLE-DUPLICATE": "More than one <onIdle> in the same engine. At most one watchdog per engine. (SPEC §51.0.R)",
  "E-TIMER-NAME-INVALID": "<onTimeout name=...> is not a valid identifier — must match /^[A-Za-z_][A-Za-z0-9_]*$/. (SPEC §51.0.M.1)",
  "E-TIMER-NAME-DUPLICATE": "Two <onTimeout> elements share the same name= within one state-child. Names must be scope-local-unique for cancelTimer disambiguation. (SPEC §51.0.M.1)",
  // Channel (v0.2.0)
  "E-CHANNEL-001": "<channel> missing required name= attribute. (SPEC §38)",
  "E-CHANNEL-003": "Duplicate channel name in the same file. (SPEC §38)",
  "E-CHANNEL-004": "broadcast() called outside a <channel> scope. (SPEC §38)",
  "E-CHANNEL-005": "onserver:message handler accepts at most one parameter. (SPEC §38)",
  "E-CHANNEL-006": "onclient:* handler declared as server function. Client-side handler must be a plain function. (SPEC §38)",
  "E-CHANNEL-007": "name= (or topic=) contains ${...} interpolation. Channel identity must be compile-time stable. (SPEC §38)",
  "E-CHANNEL-008": "Two cross-file channel imports share the same name= — WS route conflict. Rename one channel. (SPEC §38)",
  "E-CHANNEL-INSIDE-PROGRAM": "<channel> nested inside <program>. v0.next channels are file-level. (SPEC §38.1)",
  "E-CHANNEL-SHARED-MODIFIER": "@shared modifier removed in v0.next. Cells declared inside a channel body auto-sync by virtue of being declared there. (SPEC §38.4)",
  "E-CHANNEL-EXPORT-001": "export <channel> requires a static string-literal name=. (SPEC §38.12)",
  // Variant / Match / Control-flow / Reserved-name (v0.2.0)
  "E-VARIANT-AMBIGUOUS": "Bare variant reference is ambiguous (union with multiple members declaring the variant, or no static enum context). Qualify: TypeName.Variant. (SPEC §14.10 / §18.0.3)",
  "E-NAME-COLLIDES-STATE": "Local identifier shadows a registered state cell name. Rename the local. (SPEC §6.1)",
  "E-NAME-COLLIDES-RESERVED": "Component or state-type name collides with a reserved scrml structural-element identifier (engine, match, errors, onTransition, onTimeout, onIdle). (SPEC §4.15 / §24.4)",
  "E-STRUCTURAL-ELEMENT-MISPLACED": "scrml-defined structural element used outside its owning locus. (SPEC §4.15)",
  "E-MULTI-STATEMENT-HANDLER": "Inline event handler attribute (or :-shorthand body) contains multiple statements. Extract to a named function and call it. (SPEC §5.2.3 / §4.14)",
  "E-CLOSER-001": "Tag uses :-shorthand body with an explicit closer. Choose one form. (SPEC §4.14)",
  "E-MATCH-EFFECT-FORBIDDEN": "effect= on a state-child inside <match>. Transitions don't occur in match; use <engine>. (SPEC §18.0.2)",
  "E-MATCH-ONTRANSITION-FORBIDDEN": "<onTransition> inside <match>. Transition handlers are engine-only. (SPEC §18.0.2)",
  "E-MATCH-NOT-EXHAUSTIVE": "Block-form <match for=Type> missing variants and no wildcard <_> catch-all. (SPEC §18.0.1)",
  "E-MATCH-012": "match on a T|not (optional) type lacks both a not arm and a wildcard/else. (SPEC §18.14)",
  "W-MATCH-RULE-INERT": "rule= declared on a state-child inside <match>. Rules are read-only in match; promote to <engine> to activate. (SPEC §18.0.2)",
  "E-IMPORT-PINNED-INVALID": "pinned modifier on a non-cell, non-engine import. Remove pinned for function or type imports. (SPEC §21.8.1)",
  "E-DERIVED-CIRCULAR-DEP": "Derived cell expression depends on itself directly or transitively. Break the cycle. (SPEC §31.5 / §6.6)",
  "E-USE-INVALID-CTX": "registerMessages() (or another project-level registration API) called from a non-top-level context. (SPEC §41.12)",
  "E-USE-001": "use declaration inside a ${ } context or other nested scope. use is only valid at file top level. (SPEC §41)",
  "E-USE-002": "use declaration appears after the first markup element or logic context. All use declarations must precede file body content. (SPEC §41)",
  "E-USE-005": "use specifier uses an unrecognized protocol prefix. Must begin with scrml:, vendor:, ./, or ../. (SPEC §41)",
  "E-RESERVED-IDENTIFIER": "Local identifier shadows a reserved language keyword (e.g., function reset() shadows the reset keyword). Rename. (SPEC §6.8)",
  // Equality / null / syntax-shape (v0.2.0)
  "E-EQ-001": "== applied to incompatible types. (SPEC §45)",
  "E-EQ-002": "== not used instead of `is not`. The absence check is the keyword form `x is not`. (SPEC §45)",
  "E-EQ-003": "== applied to a type containing function fields. Functions are not value-comparable. (SPEC §45)",
  "E-EQ-004": "=== used in scrml source. scrml has a single equality operator == (with strict type-matching). (SPEC §45)",
  "E-SYNTAX-042": "null or undefined in a scrml value position. The absence sentinel is `not`. (SPEC §17.6 / §45)",
  "E-SYNTAX-043": "(x) => presence-guard syntax used. Replaced by `given x =>`. (SPEC §17.6)",
  "E-SYNTAX-044": "Property path in given position. given accepts only simple identifiers in v1. (SPEC §17.6)",
  "E-SYNTAX-050": "Bare / is no longer a valid closer. Use </> to close the most recently opened tag. (SPEC §4)",
  "E-TYPE-041": "`not` assigned to a non-optional type T. `not` is only assignable to T|not. (SPEC §14 / §17.6)",
  "E-TYPE-042": "Absence checked with == not, == null, etc. The only normative absence check is `x is not`. (SPEC §17.6 / §45)",
  "E-TYPE-045": "`not` used as a boolean negation operator. `not` is the absence value; use ! for boolean negation. (SPEC §17.6)",
  "E-SWITCH-FORBIDDEN": "switch keyword is not part of scrml's vocabulary. Use if-else (Tier 0), <match for=Type> (Tier 1), match expr {} (value-return), or <engine for=Type> (Tier 2). (SPEC §17)",
  "E-CTRL-001": "else attribute without a preceding if= or else-if= sibling at the same level. (SPEC §17.5)",
  "E-CTRL-002": "else-if= attribute without a preceding if= or else-if= sibling. (SPEC §17.5)",
  "E-CTRL-003": "Element extends an if= chain after a terminal else. else terminates the chain. (SPEC §17.5)",
  "E-CTRL-005": "else or else-if= appears on the same element as if=. Mutually exclusive. (SPEC §17.5)",
  "E-CTRL-011": "for (... in ...) is not a valid scrml loop. scrml iterates via `of`: for (item of @items). (SPEC §17.4)",
  // Errors element (v0.2.0)
  "E-ERRORS-001": "<errors> element missing required of= attribute. (SPEC §55.8)",
  "E-ERRORS-002": "<errors of=...> attribute is not a @-rooted scrml expression. (SPEC §55.8)",
  // parseVariant family (S65)
  "E-PARSEVARIANT-TYPE-NOT-ENUM": "Second argument to parseVariant must be a bare :enum type identifier. (SPEC §41.13 / §53.14)",
  "E-PARSEVARIANT-DISCRIMINATOR-MISSING": "Runtime: parseVariant input has no `tag` field. Surface via ::ParseError::MissingDiscriminator. (SPEC §41.13)",
  "E-PARSEVARIANT-UNKNOWN-VARIANT": "Runtime: parseVariant input has a tag not matching any variant in the enum. Surface via ::ParseError::UnknownVariant(tag). (SPEC §41.13)",
  "E-PARSEVARIANT-INVALID-PAYLOAD": "Runtime: variant payload field has wrong type or fails a payload predicate. Surface via ::ParseError::InvalidPayload. (SPEC §41.13)",
  // Test blocks (S74)
  "E-TEST-001": "~{} test block: assertion failed.",
  "E-TEST-002": "~{} test block: unexpected error during execution.",
  "E-TEST-003": "~{} test block: timeout exceeded.",
  "E-TEST-004": "~{} test block: references variable from outer scope.",
  "E-TEST-005": "~{} test block: invalid test structure.",
  "E-TEST-006": "~{} test block: server-function call inside an active test-bind context references a server function with no test-bind declaration in scope. (SPEC §19.12.7)",
  // Lifecycle state types
  "E-LIFECYCLE-009": "<timer> or <poll> missing required interval attribute. (SPEC §28.1)",
  "E-LIFECYCLE-010": "<timer> or <poll> interval is zero or negative. Must be positive ms. (SPEC §28.1)",
  "E-LIFECYCLE-012": "<poll> has no logic body. (SPEC §28.2)",
  "E-LIFECYCLE-015": "animationFrame() called with zero arguments or a non-function argument. (SPEC §28.5)",
  "E-LIFECYCLE-017": "animationFrame() called outside any element scope. (SPEC §28.5)",
  "E-LIFECYCLE-018": "<request> element has no id attribute. (SPEC §28.3)",
  "W-LIFECYCLE-002": "<timer> has no body (self-closing). Probable dead code. (SPEC §28.1)",
  "W-LIFECYCLE-007": "running=false literal on <timer>/<poll>. The element can never become un-paused. Use running=@flag or remove. (SPEC §28.1)",
  // Auth / middleware / attrs
  "E-AUTH-001": "Client-local @var used as bound parameter in ?{}-INSERT/UPDATE/DELETE outside server function. (SPEC §52.11)",
  "E-AUTH-002": "server @var initial value derived from a client-local @var. (SPEC §52.11)",
  "E-AUTH-003": "State type declares authority=\"server\" without table=. (SPEC §52.11)",
  "E-AUTH-004": "Two declarations of the same state type with conflicting authority= values. (SPEC §52.11)",
  "E-AUTH-005": "server @var declared inside a client-only component. (SPEC §52.11)",
  "E-MW-002": "ratelimit= value does not match the canonical N/unit pattern (e.g., 100/minute). (SPEC §40)",
  "E-MW-005": "More than one handle() function in the same file. (SPEC §40)",
  "E-MW-006": "handle() defined outside file top-level ${ } logic. (SPEC §40)",
  "W-ATTR-001": "Attribute not recognized on a scrml-special element (informational; forwarded to HTML as-is). (SPEC §52.13)",
  "W-ATTR-002": "Attribute value-shape not recognized — silently accepted but no compile-time effect. (SPEC §52.13)",
  "E-ATTR-013": "class: directive value is invalid (bare identifier, string literal, or empty). class: requires a boolean expression. (SPEC §5.5.2)",
  // SQL / batch / component-overload (v0.2.0)
  "E-SQL-006": ".prepare() called on a ?{} SQL result. .prepare() is removed; Bun.SQL caches internally. Use .get() / .all() / .run(). (SPEC §44.3 / §8.1.1)",
  "E-SQL-008": "?{ SQL block has no matching `}` — unterminated SQL template, backtick literal, or ${} interpolation. (SPEC §8.1.1 / §44.8)",
  "E-COMPONENT-013": "bind:propName at call site where propName is not declared as a bind prop. Declare with bind, or remove bind:. (SPEC §15.10)",
  "E-COMPONENT-014": "bind prop declared with a non-primitive type. Use state projection (§15.11.2) instead. (SPEC §15.10)",
  "E-COMPONENT-020": "More than one ${...} spread in a component body. (SPEC §15.14 / §16.4)",
  "E-COMPONENT-021": "Caller provides unslotted children but the component has no ${...} spread. (SPEC §16.4)",
  // Meta blocks
  "E-META-001": "^{ } block requires runtime but meta.runtime is false.",
  "E-META-003": "reflect() called on an unknown type identifier inside a compile-time ^{} block. (SPEC §22.4)",
  "E-META-005": "^{} block mixes compile-time API (reflect()) with runtime-only values. A meta block must be entirely one mode. (SPEC §22.6)",
  "E-META-006": "lift call inside a ^{} meta block. lift is a markup-emission form. (SPEC §22.6)",
  "E-META-007": "?{} SQL context inside a runtime ^{} meta block. Runtime meta has no DB driver in scope. (SPEC §22.6)",
  "E-META-008": "reflect() called outside any ^{} meta block. (SPEC §22.11)",
  "E-META-EVAL-001": "Compile-time meta evaluation threw at runtime. (SPEC §22.4)",
  "E-META-EVAL-002": "Re-parsing the code emitted by a ^{} meta block failed. (SPEC §22.4)",
  // Ghost-pattern lints (W-LINT-*)
  "W-LINT-001": "Bare <style> block. CSS lives inside the #{ } CSS context. (Ghost-pattern lint)",
  "W-LINT-002": "oninput=${...} arrow handler that assigns to a reactive cell — React/Svelte ghost binding. scrml uses bind:value=@cell. (Ghost-pattern lint)",
  "W-LINT-003": "className= attribute — React's class-attribute alias. scrml uses class=\"...\" and class:name=@cond. (Ghost-pattern lint)",
  "W-LINT-004": "camelCase event-handler attribute (onChange=, onSubmit=, etc.) — React's convention. scrml uses lowercase: onchange=handler(). (Ghost-pattern lint)",
  "W-LINT-005": "value={expr} JSX brace-literal. scrml's reactive form is value=@cell. (Ghost-pattern lint)",
  "W-LINT-006": "JS-style `for (item of @items)` in markup context. scrml's markup-context iteration is `for @items / lift item /`. (Ghost-pattern lint)",
  "W-LINT-007": "<Comp prop={val}> JSX brace-literal on a component. scrml uses <Comp prop=val>. (Ghost-pattern lint)",
  "W-LINT-008": "{cond && <El>} React conditional. scrml uses <El if=@cond>. (Ghost-pattern lint)",
  "W-LINT-010": "${...} interpolation inside a #{ } CSS context. CSS accepts @var directly. (Ghost-pattern lint)",
  "W-LINT-011": "Vue-style :attr= colon-prefixed attribute. scrml uses attr=@var; the colon-prefix is reserved for class:, bind:, etc. (Ghost-pattern lint)",
  "W-LINT-012": "Vue directive (v-if, v-for, v-model, …). See §5/§10/§17 for the scrml equivalent. (Ghost-pattern lint)",
  "W-LINT-013": "Vue-style @event= attribute. scrml's @ sigil is for VALUES (reactive cell access), not attribute names. Use onclick=fn(). (Ghost-pattern lint)",
  "W-LINT-014": "Svelte block directive ({#if}, {/each}, …). scrml uses <el if=@cond>, `for @items / lift … /`, and <match> blocks. (Ghost-pattern lint)",
  "W-LINT-015": "Svelte {@html expr} directive. Use ${ rawHtml(expr) } if raw-HTML emission is required (XSS risk). (Ghost-pattern lint)",
  "W-CG-001": "A top-level decl / SQL block was suppressed from the client output (server-only emit, or unused). (SPEC §6)",
  // Lifecycle warnings (existing reverberation)
  "W-LIFECYCLE-CANDIDATE": "More than 2 reactive boolean cells gating the same UI region. Consider promoting to <match> (Tier 1) or <engine> (Tier 2). (SPEC §1.5)",
  "I-MATCH-PROMOTABLE": "if= chain over an enum-typed cell is mechanically promotable to <match for=Type on=@cell>. Run `bun scrml promote --match <file>[:line]`. (SPEC §56)",
};

const KEYWORD_DOCS = {
  "lift": "**lift** -- Lifts markup content from a loop body into the parent rendering context.\n\nUsed inside `for` loops within `${}` blocks to emit markup for each iteration.",
  "protect": "**protect=** -- Specifies which database fields should be protected from client exposure.\n\nFields listed in `protect=` are only accessible in server-routed functions.",
  "match": "**match** -- Pattern matching expression (Rust-style).\n\nMatches a value against enum variants, union types, or literal patterns. Must be exhaustive.",
  "pure": "**pure** -- Declares a pure function with no side effects.\n\nPure functions cannot read/write @reactive state, perform I/O, or call non-pure functions.",
  "server": "**server** -- Marks a function as server-only.\n\nThe compiler generates a server route and client-side fetch stub automatically.",
  "lin": "**lin** -- Linear type declaration.\n\nA `lin` variable must be consumed exactly once before scope exit. Cannot be used in loops.",
  // v0.2.0 keyword surface — scrml structural elements + modifiers + sentinels
  "engine": "**engine** -- Tier-2 state machine declaration (`<engine for=Type initial=.Variant>`).\n\nSingleton-by-design; one declaration mounts the singleton. Auto-declares a variable matching the lowercased type name. State-children declare legal transitions via `rule=`. See SPEC §51.0.",
  "machine": "**machine** -- Deprecated alias for `<engine>` (W-DEPRECATED-001).\n\n`bun scrml migrate` auto-rewrites to `<engine>`. Hard-removal scheduled for v0.3.0.",
  "errors": "**<errors of=expr/>** -- First-class element rendering validator errors for a cell or rollup.\n\n`of=@signup.name` renders errors for one field; `of=@signup` renders the compound rollup. `all` attribute toggles full-array vs first-error rendering. See SPEC §55.8.",
  "onTransition": "**<onTransition from=.A to=.B>** -- Cross-state effect handler inside `<engine>`.\n\nExactly one of `to=` or `from=` MUST appear. Body runs on transition. See SPEC §51.0.H.",
  "onTimeout": "**<onTimeout after=DURATION to=.Variant [name=IDENT]/>** -- Per-state time-driven transition.\n\nSelf-closing. Inside an engine state-child only. Reset on re-entry. Optional `name=` makes the timer addressable for `cancelTimer(\"name\")`. See SPEC §51.0.M.",
  "onIdle": "**<onIdle after=DURATION to=.Variant/>** -- Engine-wide event-timeout watchdog.\n\nSelf-closing. Engine-root scope only (sibling of state-children). Resets on every successful transition; fires after N ms of silence. One per engine maximum. See SPEC §51.0.R.",
  "channel": "**<channel name=\"...\">** -- File-level reactive pub/sub topic.\n\nWebSocket/SSE backed. Cells declared inside auto-sync across subscribed clients. Sibling of `<program>`, never a child (E-CHANNEL-INSIDE-PROGRAM). See SPEC §38.",
  "schema": "**<schema>** -- SQL schema declaration block.\n\nSQL-mirror canonical (`not null`, `unique`, `references`, …) + shared-core additive (`req`, `length`, `pattern`, `min`, `max`, …). See SPEC §39.",
  "program": "**<program>** -- File-level program scope.\n\nTop-level wraps the page; nested for workers / sidecars. Documentary attributes (`title=`, `description=`, …) meaningful only at top level. See SPEC §4.12.",
  "not": "**not** -- The absence sentinel.\n\nscrml's unification of null+undefined. Only assignable to `T|not` optional types. Absence check via `x is not`. NOT a boolean negation operator (use `!`). See SPEC §17.6 / §42.",
  "req": "**req** -- Universal-core predicate.\n\nValue must be non-empty / meaningful. Empty string fails `req` (distinct from `is some`, which empty string passes). See SPEC §55.1.",
  "fail": "**fail .Variant(args)** -- Surface a failable function's error.\n\nUsed inside a `function name() ! ErrorType { ... }` body. The caller handles via `let x = f() !{ | ::Variant arg -> ... }`. scrml has no `throw` keyword. See SPEC §19.",
  "pinned": "**pinned** -- Opts a declaration out of hoisting.\n\nForward reads of a pinned cell fire E-STATE-PINNED-FORWARD-REF. Legal on state declarations and imports. See SPEC §6.10 / §21.8.1.",
  "reset": "**reset(@cell)** -- Reset keyword.\n\nResets a cell to its `default=` target (or zero-value). Three canonical shapes: `reset(@cell)`, `reset(@compound)`, `reset(@compound.field)`. See SPEC §6.8.",
  "derived": "**derived=expr** -- Engine attribute making the engine derive its variant from a reactive expression.\n\nNo `rule=`, no writes (E-DERIVED-ENGINE-NO-WRITE); no `initial=` (E-DERIVED-ENGINE-NO-INITIAL). See SPEC §51.0.J.\n\nAlso: `const <name> = expr` declares a derived reactive cell (read-only). See SPEC §6.6.",
  "history": "**history** -- Bareword attribute on a composite state-child.\n\nThe compiler synthesizes a reactive cell that captures the inner-engine's last variant on outer-exit and restores it on outer-re-entry. Shallow only this revision. See SPEC §51.0.N.",
  "given": "**given x => ...** -- Presence-guard. Replaces the legacy `(x) =>` form (E-SYNTAX-043).\n\nAccepts only simple identifiers in v1 — property paths fire E-SYNTAX-044. See SPEC §17.6.",
  "partial": "**partial match expr { ... }** -- Match modifier that relaxes exhaustiveness — the match may return undefined when no arm matches.\n\nNot valid in rendering / lift contexts (E-TYPE-081). See SPEC §18.16.",
  "when": "**when @var changes { ... }** -- Reactive effect block.\n\nBody runs each time `@var` changes value. See SPEC §6.7.4.",
  "transaction": "**transaction { ... }** -- Transaction block (v0.2.0 stub; SPEC §44.6, SPEC-ISSUE-018 open).\n\nGroups SQL operations into a single transaction. Composes with the implicit per-handler envelope per §8.9.3.",
  "test-bind": "**test-bind** -- Test-mode bind declaration.\n\nDeclares a function-stub binding active inside `~{}` test blocks. References without an in-scope `test-bind` fire E-TEST-006 (fail-fast over silent passthrough). See SPEC §19.12.7.",
};

/**
 * Return Hover for the word at `offset`, or null.
 */
export function buildHover(text, offset, analysis) {
  const word = getWordAtOffset(text, offset);
  if (!word) return null;

  // @variable
  if (word.startsWith("@")) {
    const varName = word.slice(1);
    if (analysis?.reactiveVars) {
      const rv = analysis.reactiveVars.find(
        (v) => (v.name?.startsWith("@") ? v.name.slice(1) : v.name) === varName
      );
      if (rv) {
        const kindBadge = rv.reactiveKind === "derived"
          ? "(reactive, derived)"
          : rv.reactiveKind === "debounced"
            ? `(reactive, debounced ${rv.delay ?? 300}ms)`
            : rv.reactiveKind === "throttled"
              ? `(reactive, throttled ${rv.delay ?? 300}ms)`
              : "(reactive)";
        const sharedTag = rv.isShared ? " (shared)" : "";
        const lines = [`**@${varName}** ${kindBadge}${sharedTag}`];
        if (rv.type) lines.push("", `Type: \`${rv.type}\``);
        return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
      }
    }
    return { contents: { kind: MarkupKind.Markdown, value: `**@${varName}** (reactive)` } };
  }

  // Error codes
  if (/^[EW]-[A-Z]+-\d+$/.test(word)) {
    const desc = ERROR_DESCRIPTIONS[word];
    if (desc) return { contents: { kind: MarkupKind.Markdown, value: `**${word}**\n\n${desc}` } };
  }

  // Keywords
  if (KEYWORD_DOCS[word]) {
    return { contents: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS[word] } };
  }

  // Tilde (must-use) variable
  if (analysis?.tildeVars) {
    const tv = analysis.tildeVars.find((v) => v.name === word);
    if (tv) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${word}** (must-use, ~)\n\nA tilde-typed variable must be read at least once before reassignment or scope exit.`,
        },
      };
    }
  }

  // Linear variable
  if (analysis?.linVars) {
    const lv = analysis.linVars.find((v) => v.name === word);
    if (lv) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${word}** (linear)\n\nA linear variable must be consumed exactly once before scope exit. Cannot be used inside loops.`,
        },
      };
    }
  }

  // Function names — full signature, boundary, failure modes.
  if (analysis?.functions) {
    const fn = analysis.functions.find((f) => f.name === word);
    if (fn) {
      const lines = [`**${word}**`, "", "```scrml", formatFunctionSignature(fn), "```"];
      if (fn.stateTypeScope) lines.push("", `_Defined inside state \`${fn.stateTypeScope}\`._`);
      if (fn.isHandleEscapeHatch) lines.push("", "_handle() escape hatch: receives the raw request and bypasses route inference._");
      return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
    }
  }

  // Type names
  if (analysis?.types) {
    const t = analysis.types.find((td) => td.name === word);
    if (t) {
      const lines = [`**${word}** -- ${t.typeKind || "type"}`];
      if (t.raw) {
        lines.push("", "```scrml", `type ${t.name}${t.typeKind ? ":" + t.typeKind : ""} = ${t.raw}`, "```");
      }
      return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
    }
  }

  // Machine names
  if (analysis?.machines) {
    const m = analysis.machines.find((md) => md.name === word);
    if (m) {
      const lines = [`**${word}** -- machine for \`${m.governedType}\``];
      if (m.sourceVar) lines.push("", `_Derived from @${m.sourceVar}._`);
      return { contents: { kind: MarkupKind.Markdown, value: lines.join("\n") } };
    }
  }

  // Component names
  if (analysis?.components) {
    const c = analysis.components.find((co) => co.name === word);
    if (c) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${word}** -- component\n\n_Cross-file prop completion lands in L3._`,
        },
      };
    }
  }

  return null;
}

export function getWordAtOffset(text, offset) {
  if (offset < 0 || offset >= text.length) return null;
  let start = offset;
  while (start > 0 && /[\w@\-]/.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && /[\w\-]/.test(text[end])) end++;
  const word = text.substring(start, end);
  return word.length > 0 ? word : null;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

/**
 * Resolve the declaration site of the symbol under the cursor.
 *
 * `uri`       LSP URI of the file the user is editing.
 * `text`      current buffer contents.
 * `offset`    cursor offset.
 * `analysis`  same-file analysis cache.
 * `workspace` (L2, optional) workspace cache. When provided, an unresolved
 *             same-file lookup falls through to a cross-file lookup that
 *             walks the file's import declarations and follows them to the
 *             foreign declaration. The returned Location's `uri` points
 *             into the foreign file.
 * `filePath`  (L2, optional) absolute path of the importing file. Required
 *             when `workspace` is supplied so the cross-file lookup can
 *             find the importer's import-graph entry. Falls back to
 *             converting `uri` if omitted.
 *
 * Returns an LSP Location, or null if no definition was found.
 */
export function buildDefinitionLocation(uri, text, offset, analysis, workspace, filePath) {
  if (!analysis && !workspace) return null;
  const word = getWordAtOffset(text, offset);
  if (!word) return null;
  const varName = word.startsWith("@") ? word.slice(1) : word;

  if (analysis) {
    if (word.startsWith("@") && analysis.reactiveVars) {
      const rv = analysis.reactiveVars.find(
        (v) => (v.name?.startsWith("@") ? v.name.slice(1) : v.name) === varName
      );
      if (rv?.span) return { uri, range: spanToRange(rv.span, text) };
    }
    if (analysis.functions) {
      const fn = analysis.functions.find((f) => f.name === word);
      if (fn?.span) return { uri, range: spanToRange(fn.span, text) };
    }
    if (analysis.types) {
      const t = analysis.types.find((td) => td.name === word);
      if (t?.span) return { uri, range: spanToRange(t.span, text) };
    }
    if (analysis.machines) {
      const m = analysis.machines.find((md) => md.name === word);
      if (m?.span) return { uri, range: spanToRange(m.span, text) };
    }
    if (analysis.components) {
      const c = analysis.components.find((co) => co.name === word);
      if (c?.span) return { uri, range: spanToRange(c.span, text) };
    }
  }

  // L2 — fall through to cross-file lookup. Reactive vars (`@x`) are scoped
  // per-file by spec, so skip cross-file search for `@`-prefixed words.
  if (workspace && !word.startsWith("@")) {
    const importerPath = filePath || uriToFilePath(uri);
    if (importerPath) {
      const hit = lookupCrossFileDefinition(workspace, importerPath, word);
      if (hit && hit.span) {
        return {
          uri: pathToUri(hit.filePath),
          range: spanToRange(hit.span, hit.sourceText || ""),
        };
      }
    }
  }
  return null;
}

/**
 * Convert an LSP URI back to an absolute path. Mirror of `pathToUri`.
 * Used by `buildDefinitionLocation` when `filePath` isn't passed explicitly.
 */
export function uriToFilePath(uri) {
  if (!uri) return null;
  if (uri.startsWith("file://")) return decodeURIComponent(uri.slice(7));
  return uri;
}

// ---------------------------------------------------------------------------
// Completions — common data
// ---------------------------------------------------------------------------

export const HTML_TAGS = [
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins",
  "kbd",
  "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "picture", "pre", "progress",
  "q",
  "rp", "rt", "ruby",
  "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track",
  "u", "ul",
  "var", "video",
  "wbr",
];

export const HTML_ATTRIBUTES = [
  "id", "class", "style", "title", "lang", "dir", "hidden", "tabindex",
  "accesskey", "draggable", "spellcheck", "contenteditable", "translate",
  "role", "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden",
  "aria-live", "aria-atomic", "aria-busy", "aria-controls", "aria-current",
  "aria-disabled", "aria-expanded", "aria-haspopup", "aria-pressed", "aria-selected",
  "data-", "name", "value", "type", "href", "src", "alt", "width", "height",
  "action", "method", "target", "rel", "placeholder", "required", "disabled",
  "checked", "selected", "multiple", "readonly", "autofocus", "autocomplete",
  "min", "max", "step", "pattern", "maxlength", "minlength", "for", "form",
  "accept", "enctype", "novalidate",
];

export const SCRML_ATTRIBUTES = [
  { label: "protect=", detail: "Protect database fields from client exposure", kind: CompletionItemKind.Property },
  { label: "tables=", detail: "Specify database tables for a state block", kind: CompletionItemKind.Property },
  { label: "src=", detail: "Database file path for state blocks", kind: CompletionItemKind.Property },
  { label: "bind:value", detail: "Two-way binding for input value", kind: CompletionItemKind.Property },
  { label: "bind:checked", detail: "Two-way binding for checkbox state", kind: CompletionItemKind.Property },
  { label: "bind:selected", detail: "Two-way binding for select value", kind: CompletionItemKind.Property },
  { label: "bind:group", detail: "Two-way binding for radio group", kind: CompletionItemKind.Property },
  { label: "if=", detail: "Conditional rendering", kind: CompletionItemKind.Property },
  { label: "else-if=", detail: "Continuation of an if= chain", kind: CompletionItemKind.Property },
  { label: "else", detail: "Terminator of an if= / else-if= chain", kind: CompletionItemKind.Property },
  { label: "each=", detail: "List rendering", kind: CompletionItemKind.Property },
  { label: "key=", detail: "Unique key for list items", kind: CompletionItemKind.Property },
  // Engine + state-child attributes (§51.0)
  { label: "for=", detail: "Engine / match `for=Type` — declares the discriminating type", kind: CompletionItemKind.Property },
  { label: "initial=", detail: "Engine `initial=.Variant` — starting variant (§51.0.E)", kind: CompletionItemKind.Property },
  { label: "var=", detail: "Engine `var=name` — override the auto-derived engine variable name (§51.0.C)", kind: CompletionItemKind.Property },
  { label: "derived=", detail: "Engine `derived=expr` — derived engine; no rules, no writes (§51.0.J)", kind: CompletionItemKind.Property },
  { label: "rule=", detail: "State-child legal-transitions contract (§51.0.F)", kind: CompletionItemKind.Property },
  { label: "internal:rule=", detail: "Composite state-child internal-transition prefix (§51.0.O)", kind: CompletionItemKind.Property },
  { label: "effect=", detail: "State-child inline per-rule effect (single-target only; §51.0.H)", kind: CompletionItemKind.Property },
  { label: "to=", detail: "<onTransition> / <onTimeout> / <onIdle> target variant", kind: CompletionItemKind.Property },
  { label: "from=", detail: "<onTransition> source variant", kind: CompletionItemKind.Property },
  { label: "after=", detail: "<onTimeout> / <onIdle> duration (e.g. 300ms, ${expr}s)", kind: CompletionItemKind.Property },
  { label: "once", detail: "<onTransition> once-only modifier", kind: CompletionItemKind.Property },
  { label: "name=", detail: "<onTimeout name=IDENT> — addressable for cancelTimer() (S79)", kind: CompletionItemKind.Property },
  { label: "history", detail: "Composite state-child history attribute (§51.0.N)", kind: CompletionItemKind.Property },
  // Reactivity attrs (§6.13 / S79)
  { label: "debounced=", detail: "Debounced cell write path (e.g. debounced=300ms; §6.13)", kind: CompletionItemKind.Property },
  { label: "throttled=", detail: "Throttled cell write path (e.g. throttled=100ms; §6.13)", kind: CompletionItemKind.Property },
  // State-decl attrs
  { label: "default=", detail: "Cell reset target (used by reset(@cell); §6.8)", kind: CompletionItemKind.Property },
  { label: "pinned", detail: "Opts a decl out of hoisting (§6.10)", kind: CompletionItemKind.Property },
  // Universal-core predicates (bare attrs on Shape 2; §55.1)
  { label: "req", detail: "Universal-core predicate — value non-empty (§55.1)", kind: CompletionItemKind.Property },
  { label: "is some", detail: "Universal-core predicate — value exists (§55.1; null+undefined fail)", kind: CompletionItemKind.Property },
  // Errors element (§55.8)
  { label: "of=", detail: "<errors of=expr/> — cell or rollup whose errors to render (§55.8)", kind: CompletionItemKind.Property },
  { label: "all", detail: "<errors all/> — render full array vs first error (§55.8)", kind: CompletionItemKind.Property },
  // Channel attrs (§38)
  { label: "topic=", detail: "Channel topic (defaults to name=)", kind: CompletionItemKind.Property },
  { label: "reconnect=", detail: "Channel reconnect cadence (ms; per-channel; §38.3.1)", kind: CompletionItemKind.Property },
  // Auth attrs (§52.13 / S80)
  { label: "auth=", detail: "Auth gate: \"required\" | \"optional\" | \"none\" (§52.13)", kind: CompletionItemKind.Property },
  { label: "csrf=", detail: "CSRF mode: \"auto\" | \"off\" (§52.13)", kind: CompletionItemKind.Property },
  { label: "loginRedirect=", detail: "Auth login redirect URL (§52.13)", kind: CompletionItemKind.Property },
  { label: "sessionExpiry=", detail: "Auth session expiry duration (§52.13)", kind: CompletionItemKind.Property },
  // Program adopter-override attrs (S79 / S81)
  { label: "idempotency-store=", detail: "Idempotency backend: \"auto\" | \"sqlite\" | \"postgres\" | \"mysql\" | \"redis\" | \"none\" (§39.2.6)", kind: CompletionItemKind.Property },
  { label: "idempotency-ttl=", detail: "Idempotency key TTL (default 24h; §19.9.6)", kind: CompletionItemKind.Property },
  { label: "batch-in-list-cap=", detail: "SQL IN-list batch cap (default 32766; §8.10.6)", kind: CompletionItemKind.Property },
  { label: "cors-max-age=", detail: "Access-Control-Max-Age override (default 86400s; §39.2.1)", kind: CompletionItemKind.Property },
  { label: "channel-reconnect=", detail: "Project-level WS reconnect cadence (default 2000ms; §38.3.1)", kind: CompletionItemKind.Property },
  // Lifecycle state-type attrs
  { label: "interval=", detail: "<timer> / <poll> tick interval (ms; §28.1)", kind: CompletionItemKind.Property },
  { label: "running=", detail: "<timer> / <poll> running flag (typically @flag; §28.1)", kind: CompletionItemKind.Property },
  { label: "delay=", detail: "<timeout> delay (ms; §51.0.M)", kind: CompletionItemKind.Property },
  // class binding
  { label: "class:", detail: "Reactive single-class toggle: class:name=@cell (§5.5)", kind: CompletionItemKind.Property },
];

export const SCRML_KEYWORDS = [
  { label: "lift", detail: "Lift markup into parent rendering context", kind: CompletionItemKind.Keyword },
  { label: "match", detail: "Pattern matching expression / block (Tier 1)", kind: CompletionItemKind.Keyword },
  { label: "is", detail: "Type check in pattern matching", kind: CompletionItemKind.Keyword },
  { label: "is some", detail: "Universal-core predicate — value exists (§55.1)", kind: CompletionItemKind.Keyword },
  { label: "is not", detail: "Absence check (the only normative form; §17.6)", kind: CompletionItemKind.Keyword },
  { label: "enum", detail: "Enum type declaration", kind: CompletionItemKind.Keyword },
  { label: "struct", detail: "Struct type declaration", kind: CompletionItemKind.Keyword },
  { label: "fn", detail: "Pure function shorthand", kind: CompletionItemKind.Keyword },
  { label: "pure", detail: "Pure function declaration", kind: CompletionItemKind.Keyword },
  { label: "server", detail: "Server-only function annotation (deprecated keyword form; W-DEPRECATED-SERVER-MODIFIER)", kind: CompletionItemKind.Keyword },
  { label: "let", detail: "Variable declaration (mutable)", kind: CompletionItemKind.Keyword },
  { label: "const", detail: "Variable declaration (immutable)", kind: CompletionItemKind.Keyword },
  { label: "lin", detail: "Linear type variable declaration", kind: CompletionItemKind.Keyword },
  { label: "type", detail: "Type declaration", kind: CompletionItemKind.Keyword },
  { label: "import", detail: "Import declaration", kind: CompletionItemKind.Keyword },
  { label: "export", detail: "Export declaration", kind: CompletionItemKind.Keyword },
  { label: "from", detail: "Import source", kind: CompletionItemKind.Keyword },
  { label: "function", detail: "Function declaration", kind: CompletionItemKind.Keyword },
  { label: "return", detail: "Return statement", kind: CompletionItemKind.Keyword },
  { label: "if", detail: "Conditional statement", kind: CompletionItemKind.Keyword },
  { label: "else", detail: "Else branch", kind: CompletionItemKind.Keyword },
  { label: "for", detail: "For loop", kind: CompletionItemKind.Keyword },
  { label: "while", detail: "While loop", kind: CompletionItemKind.Keyword },
  { label: "of", detail: "For-of iteration (the only scrml form — E-CTRL-011 rejects `in`)", kind: CompletionItemKind.Keyword },
  { label: "async", detail: "Async function modifier", kind: CompletionItemKind.Keyword },
  { label: "await", detail: "Await expression", kind: CompletionItemKind.Keyword },
  { label: "navigate", detail: "Client-side navigation", kind: CompletionItemKind.Keyword },
  // v0.2.0 keywords
  { label: "engine", detail: "Tier-2 state machine declaration (§51.0)", kind: CompletionItemKind.Keyword },
  { label: "errors", detail: "First-class validator-errors element <errors of=expr/> (§55.8)", kind: CompletionItemKind.Keyword },
  { label: "onTransition", detail: "Engine cross-state effect handler (§51.0.H)", kind: CompletionItemKind.Keyword },
  { label: "onTimeout", detail: "Engine state-child temporal transition (§51.0.M)", kind: CompletionItemKind.Keyword },
  { label: "onIdle", detail: "Engine-wide event-timeout watchdog (§51.0.R)", kind: CompletionItemKind.Keyword },
  { label: "channel", detail: "File-level reactive pub/sub topic (§38)", kind: CompletionItemKind.Keyword },
  { label: "schema", detail: "SQL schema declaration (§39)", kind: CompletionItemKind.Keyword },
  { label: "program", detail: "File-level program scope (§4.12)", kind: CompletionItemKind.Keyword },
  { label: "not", detail: "Absence sentinel (scrml's null+undefined unification; §17.6 / §42)", kind: CompletionItemKind.Keyword },
  { label: "req", detail: "Universal-core predicate — non-empty (§55.1)", kind: CompletionItemKind.Keyword },
  { label: "fail", detail: "Surface a failable function's error (§19)", kind: CompletionItemKind.Keyword },
  { label: "pinned", detail: "Opt-out hoisting modifier (§6.10)", kind: CompletionItemKind.Keyword },
  { label: "reset", detail: "Reset a cell to its default= target (§6.8)", kind: CompletionItemKind.Keyword },
  { label: "derived", detail: "Derived engine attribute (§51.0.J) / derived cell (const <x> = expr; §6.6)", kind: CompletionItemKind.Keyword },
  { label: "history", detail: "Composite state-child history attribute (§51.0.N)", kind: CompletionItemKind.Keyword },
  { label: "given", detail: "Presence-guard (replaces (x) =>; §17.6)", kind: CompletionItemKind.Keyword },
  { label: "partial", detail: "partial match — relaxes exhaustiveness; not valid in lift/markup (§18.16)", kind: CompletionItemKind.Keyword },
  { label: "when", detail: "Reactive effect block: when @var changes { ... } (§6.7.4)", kind: CompletionItemKind.Keyword },
  { label: "transaction", detail: "Transaction block (§44.6; SPEC-ISSUE-018 open)", kind: CompletionItemKind.Keyword },
  { label: "test-bind", detail: "Test-mode function-stub binding inside ~{} (§19.12.7)", kind: CompletionItemKind.Keyword },
  // Built-in functions
  { label: "cancelTimer", detail: "Cancel a named <onTimeout> by name (§51.0.M.1)", kind: CompletionItemKind.Function },
  { label: "parseVariant", detail: "Parse JSON to a tagged variant (scrml:data; §41.13 / §53.14)", kind: CompletionItemKind.Function },
  { label: "reflect", detail: "Compile-time type reflection (^{} meta blocks only; §22.4)", kind: CompletionItemKind.Function },
  { label: "broadcast", detail: "Channel-injected: broadcast(data) to subscribers (§38)", kind: CompletionItemKind.Function },
  { label: "disconnect", detail: "Channel-injected: disconnect the current connection (§38)", kind: CompletionItemKind.Function },
  { label: "cleanup", detail: "Scope-exit teardown (§6.7.3)", kind: CompletionItemKind.Function },
  { label: "flush", detail: "Flush pending derived re-evaluation (NOT valid in derived bodies; §6.6.5)", kind: CompletionItemKind.Function },
  { label: "animationFrame", detail: "animationFrame(fn) — requestAnimationFrame loop within an element scope (§6.7.9)", kind: CompletionItemKind.Function },
  // Sigils
  { label: "@", detail: "Reactive variable sigil", kind: CompletionItemKind.Variable },
  { label: "@derived", detail: "Derived reactive value", kind: CompletionItemKind.Variable },
];

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR",
  "NOT", "IN", "LIKE", "BETWEEN", "ORDER", "BY", "ASC", "DESC", "LIMIT",
  "OFFSET", "GROUP", "HAVING", "DISTINCT", "AS", "COUNT", "SUM", "AVG",
  "MIN", "MAX", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "VIEW",
  "NULL", "IS", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END",
];

/**
 * Detect the context at a given offset in the source text.
 * Returns: 'markup', 'logic', 'sql', 'meta', 'css', or 'top-level'.
 */
export function detectContext(text, offset) {
  let depth = { logic: 0, sql: 0, meta: 0, css: 0 };
  // L1 fix: track plain `{` openers separately so bare braces inside a
  // logic/sql/meta/css context balance correctly (e.g. `${ type T = { ... } }`).
  // Plain braces are only counted when we are already inside one of the
  // language contexts — at top-level, plain `{` is meaningless.
  let plainDepth = 0;
  function inAnyContext() {
    return depth.logic > 0 || depth.sql > 0 || depth.meta > 0 || depth.css > 0;
  }
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < offset && i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      if (ch === stringChar && text[i - 1] !== "\\") {
        inString = false;
        stringChar = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      const eol = text.indexOf("\n", i);
      if (eol !== -1) i = eol;
      continue;
    }

    if (ch === "$" && next === "{") { depth.logic++; i++; continue; }
    if (ch === "?" && next === "{") { depth.sql++;   i++; continue; }
    if (ch === "^" && next === "{") { depth.meta++;  i++; continue; }
    if (ch === "#" && next === "{") { depth.css++;   i++; continue; }

    if (ch === "{" && inAnyContext()) { plainDepth++; continue; }

    if (ch === "}") {
      if (plainDepth > 0) { plainDepth--; continue; }
      if (depth.css > 0) depth.css--;
      else if (depth.sql > 0) depth.sql--;
      else if (depth.meta > 0) depth.meta--;
      else if (depth.logic > 0) depth.logic--;
    }
  }

  if (depth.sql > 0) return "sql";
  if (depth.meta > 0) return "meta";
  if (depth.css > 0) return "css";
  if (depth.logic > 0) return "logic";

  const before = text.substring(0, offset);
  const lastOpen = before.lastIndexOf("<");
  const lastClose = before.lastIndexOf(">");
  if (lastOpen > lastClose) return "markup";

  return "top-level";
}

/**
 * Reactive-variable completion items (with kind/type detail).
 */
export function reactiveVarCompletions(reactiveVars) {
  const items = [];
  const seen = new Set();
  for (const rv of reactiveVars || []) {
    const name = rv.name?.startsWith("@") ? rv.name.slice(1) : rv.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    // S79 — `@debounced(N)` keyword-form retired (SPEC §6.13). The new
    // attribute-form details surface as `<name debounced=Nms>` /
    // `<name throttled=Nms>` to mirror the canonical declaration syntax
    // the developer types.
    const kindLabel = rv.reactiveKind === "derived"
      ? "@derived"
      : rv.reactiveKind === "debounced"
        ? `<${rv.name?.replace(/^@/, "") ?? "x"} debounced=${rv.delay ?? 300}ms>`
        : rv.reactiveKind === "throttled"
          ? `<${rv.name?.replace(/^@/, "") ?? "x"} throttled=${rv.delay ?? 300}ms>`
          : "@reactive";
    const sharedTag = rv.isShared ? " (shared)" : "";
    items.push({
      label: name,
      kind: CompletionItemKind.Variable,
      detail: `@${name}${rv.type ? ": " + rv.type : ""} -- ${kindLabel}${sharedTag}`,
      documentation: "Reactive variable",
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// L3 — SQL column completion
// ---------------------------------------------------------------------------

/**
 * Test whether `offset` is inside a span (start <= offset <= end). Tolerant
 * of missing fields.
 */
function offsetInSpan(span, offset) {
  if (!span || span.start == null || span.end == null) return false;
  return offset >= span.start && offset <= span.end;
}

/**
 * Find the deepest `<db>` state block that contains `offset`. The set comes
 * from `analysis.stateBlocks` (which is filtered on stateType === 'db').
 *
 * Returns the matching stateBlock object or null.
 */
export function findEnclosingDbBlock(stateBlocks, offset) {
  if (!Array.isArray(stateBlocks)) return null;
  let best = null;
  let bestSize = Infinity;
  for (const sb of stateBlocks) {
    if (sb.stateType !== "db") continue;
    if (!offsetInSpan(sb.span, offset)) continue;
    const size = sb.span.end - sb.span.start;
    if (size < bestSize) {
      best = sb;
      bestSize = size;
    }
  }
  return best;
}

/**
 * Locate the enclosing `?{` and return the SQL body slice from just after
 * `?{` to `offset`. Returns null if `offset` is not inside any `?{}`.
 *
 * Thin wrapper over `findEnclosingSqlContext` for callers that only need
 * the body up to the cursor (not the full body of the enclosing `?{}`).
 */
export function findEnclosingSqlBody(text, offset) {
  const ctx = findEnclosingSqlContext(text, offset);
  return ctx ? ctx.bodyToCursor : null;
}

/**
 * Locate the enclosing `?{` and return:
 *   - bodyStart    — offset of the first character inside the `?{`
 *   - bodyEnd      — offset of the matching `}` (or text.length if unclosed)
 *   - bodyToCursor — text from bodyStart to `offset`
 *   - fullBody     — text from bodyStart to bodyEnd
 *
 * Returns null when `offset` is not inside any `?{}`. Mirrors the
 * brace-balancing semantics of `detectContext` but tracks the START
 * position of the deepest enclosing sql frame so we can extract its body
 * for SQL alias parsing in both directions (FROM may follow the cursor).
 */
export function findEnclosingSqlContext(text, offset) {
  // Phase 1: walk text up to `offset` to find the deepest enclosing `?{` start.
  const sqlStarts = []; // stack of start-of-body offsets (just past `?{`)
  let plainDepth = 0;
  let inString = false;
  let stringChar = null;
  let logic = 0, meta = 0, css = 0;
  function inAnyContext() {
    return sqlStarts.length > 0 || logic > 0 || meta > 0 || css > 0;
  }
  for (let i = 0; i < offset && i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      if (ch === stringChar && text[i - 1] !== "\\") {
        inString = false;
        stringChar = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const eol = text.indexOf("\n", i);
      if (eol !== -1) i = eol;
      continue;
    }
    if (ch === "$" && next === "{") { logic++; i++; continue; }
    if (ch === "?" && next === "{") { sqlStarts.push(i + 2); i++; continue; }
    if (ch === "^" && next === "{") { meta++; i++; continue; }
    if (ch === "#" && next === "{") { css++; i++; continue; }
    if (ch === "{" && inAnyContext()) { plainDepth++; continue; }
    if (ch === "}") {
      if (plainDepth > 0) { plainDepth--; continue; }
      if (css > 0) css--;
      else if (sqlStarts.length > 0) sqlStarts.pop();
      else if (meta > 0) meta--;
      else if (logic > 0) logic--;
    }
  }
  if (sqlStarts.length === 0) return null;
  const bodyStart = sqlStarts[sqlStarts.length - 1];

  // Phase 2: scan forward from `offset` to find the matching close brace
  // for the deepest enclosing `?{`. The stack starts with one outstanding
  // `?{` so the first un-balanced `}` ends our body.
  let bodyEnd = text.length;
  let plain = 0;
  let logic2 = 0, sql2 = 1, meta2 = 0, css2 = 0;
  let inStr = false;
  let strCh = null;
  function any2() { return logic2 > 0 || sql2 > 0 || meta2 > 0 || css2 > 0; }
  for (let i = offset; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      if (ch === strCh && text[i - 1] !== "\\") {
        inStr = false;
        strCh = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = true;
      strCh = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const eol = text.indexOf("\n", i);
      if (eol !== -1) i = eol;
      continue;
    }
    if (ch === "$" && next === "{") { logic2++; i++; continue; }
    if (ch === "?" && next === "{") { sql2++; i++; continue; }
    if (ch === "^" && next === "{") { meta2++; i++; continue; }
    if (ch === "#" && next === "{") { css2++; i++; continue; }
    if (ch === "{" && any2()) { plain++; continue; }
    if (ch === "}") {
      if (plain > 0) { plain--; continue; }
      if (css2 > 0) css2--;
      else if (sql2 > 0) {
        sql2--;
        if (sql2 === 0) { bodyEnd = i; break; }
      }
      else if (meta2 > 0) meta2--;
      else if (logic2 > 0) logic2--;
    }
  }

  return {
    bodyStart,
    bodyEnd,
    bodyToCursor: text.slice(bodyStart, offset),
    fullBody: text.slice(bodyStart, bodyEnd),
  };
}

/**
 * Tiny SQL alias pre-parser. Given a SQL body (the contents of a `?{}`),
 * extract `FROM table [alias]` and `JOIN table [alias]` pairs. Aliases
 * preceded by the `AS` keyword are also captured. Backtick-quoted identifiers
 * are stripped of their backticks. Comma-separated FROM tables are parsed.
 *
 * Returns:
 *   {
 *     tables: Set<string>,            // all tables referenced
 *     aliases: Map<string, string>,   // alias → table (alias may equal table)
 *   }
 */
export function parseSqlAliases(sql) {
  const tables = new Set();
  const aliases = new Map();
  if (!sql || typeof sql !== "string") return { tables, aliases };

  // Strip leading/trailing backtick wrappers and inline backticks. SQL bodies
  // in scrml are inside `?{`...`}` and the body itself is often wrapped in
  // backtick template literals: `?{`SELECT ...`}`. The backticks are not
  // SQL semantics — we drop them for parsing.
  const stripped = sql.replace(/`/g, " ");

  // Lowercase the body to a parallel array for keyword detection while
  // preserving original-cased identifiers for emission.
  const lower = stripped.toLowerCase();

  function captureFromList(startIdx) {
    // Walk forward through identifier-comma sequences until we hit a SQL
    // keyword that ends the FROM clause (WHERE/GROUP/ORDER/HAVING/LIMIT/JOIN).
    let i = startIdx;
    while (i < stripped.length) {
      // Skip whitespace
      while (i < stripped.length && /\s/.test(stripped[i])) i++;
      if (i >= stripped.length) break;

      // Identifier
      const idMatch = stripped.slice(i).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (!idMatch) break;
      const tableName = idMatch[1];
      const tableLower = tableName.toLowerCase();
      // Stop on terminating keywords
      if (["where", "group", "order", "having", "limit", "offset", "join",
           "left", "right", "inner", "outer", "on", "union"].includes(tableLower)) {
        break;
      }
      tables.add(tableName);
      aliases.set(tableName, tableName); // self-alias
      i += tableName.length;

      // Skip whitespace, optional AS, then optional alias identifier
      while (i < stripped.length && /\s/.test(stripped[i])) i++;
      if (lower.slice(i, i + 3) === "as " || lower.slice(i, i + 3) === "as\n" || lower.slice(i, i + 3) === "as\t") {
        i += 2;
        while (i < stripped.length && /\s/.test(stripped[i])) i++;
      }
      const aliasMatch = stripped.slice(i).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (aliasMatch) {
        const alias = aliasMatch[1];
        const aliasLower = alias.toLowerCase();
        if (!["where", "group", "order", "having", "limit", "offset", "join",
              "left", "right", "inner", "outer", "on", "union"].includes(aliasLower)) {
          aliases.set(alias, tableName);
          i += alias.length;
        }
      }

      // Skip whitespace, then expect comma to continue the list
      while (i < stripped.length && /\s/.test(stripped[i])) i++;
      if (stripped[i] === ",") { i++; continue; }
      break;
    }
  }

  // Find every FROM and JOIN keyword (case-insensitive, word-boundaried).
  const re = /\b(from|join)\b/gi;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    captureFromList(m.index + m[0].length);
  }

  return { tables, aliases };
}

/**
 * Build SQL column completions for a cursor inside `?{...}` SQL context.
 * Looks up the enclosing `<db>` block, fetches its DBTypeViews from
 * `analysis.protectAnalysis.views`, walks the SQL body (in BOTH directions
 * — FROM/JOIN may appear after the cursor) to find the table aliases, and
 * emits CompletionItem[] for the columns of the resolved table(s).
 *
 * If no alias prefix is detected (e.g. cursor is bare "SELECT |"), columns
 * from every FROM/JOIN-referenced table in scope are emitted; if no FROM
 * has been typed yet, every column from every table the <db> block exposes.
 */
export function buildSqlColumnCompletions(text, offset, analysis) {
  if (!analysis?.protectAnalysis?.views || !analysis.stateBlocks) return [];

  const dbBlock = findEnclosingDbBlock(analysis.stateBlocks, offset);
  if (!dbBlock) return [];

  const stateBlockId = `${analysis.filePath}::${dbBlock.span.start}`;
  const view = analysis.protectAnalysis.views.get(stateBlockId);
  if (!view || !view.tables) return [];

  const sqlCtx = findEnclosingSqlContext(text, offset);
  if (!sqlCtx) return [];

  // Parse aliases from the FULL ?{} body so a cursor placed before the
  // FROM clause still resolves the eventual tables (real-world flow:
  // `SELECT u.|` is typed before `FROM users u`, but the editor may
  // re-trigger completion after FROM is added).
  const { aliases } = parseSqlAliases(sqlCtx.fullBody);

  // Detect `<alias>.<partial>` immediately to the LEFT of the cursor.
  const prefixMatch = sqlCtx.bodyToCursor.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/);
  let targetTables = null;
  if (prefixMatch) {
    const aliasName = prefixMatch[1];
    const tableName = aliases.get(aliasName);
    if (tableName && view.tables.has(tableName)) {
      targetTables = [tableName];
    } else if (view.tables.has(aliasName)) {
      // Bare table-name prefix (no FROM clause yet, or table self-reference).
      targetTables = [aliasName];
    } else {
      // Unknown alias — fall back to nothing so we don't pollute.
      return [];
    }
  }

  // Without an alias prefix, emit every column from every table we know
  // about. Prefer the FROM/JOIN-referenced subset; if that's empty (cursor
  // before any FROM clause), fall back to every table in the <db> view.
  if (!targetTables) {
    const fromTables = [...aliases.values()].filter(t => view.tables.has(t));
    targetTables = fromTables.length > 0
      ? Array.from(new Set(fromTables))
      : Array.from(view.tables.keys());
  }

  const items = [];
  const seen = new Set();
  for (const tableName of targetTables) {
    const tableView = view.tables.get(tableName);
    if (!tableView) continue;
    for (const col of tableView.fullSchema || []) {
      const key = `${tableName}.${col.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const protectedTag = tableView.protectedFields?.has(col.name) ? " (protected)" : "";
      items.push({
        label: col.name,
        kind: CompletionItemKind.Field,
        detail: `${col.sqlType}${col.isPrimaryKey ? " PK" : ""}${col.nullable ? "" : " NOT NULL"} -- ${tableName}${protectedTag}`,
        documentation: `Column \`${col.name}\` of table \`${tableName}\` (from <db src="${view.dbPath}">).`,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// L3 — Component prop completion
// ---------------------------------------------------------------------------

// Cache parsed props per (componentDef.raw) so we don't re-parse on every
// completion request. Keyed by raw because raw is the only identifier that
// reflects the user's edits to the component body.
const componentPropsCache = new Map();

/**
 * Normalize a tokenized `raw` string (logic-tokenizer output) back to
 * parseable scrml markup source. Mirrors compiler/src/component-expander.ts
 * `normalizeTokenizedRaw` — kept LSP-local to avoid touching CE.
 */
function normalizeTokenizedComponentRaw(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/< \/ >/g, "</>");
  s = s.replace(/< \/ ([A-Za-z][A-Za-z0-9_-]*) >/g, "</$1>");
  s = s.replace(/< ([A-Za-z])/g, "<$1");
  s = s.replace(/([A-Za-z0-9_"])\s+>/g, "$1>");
  s = s.replace(/\s+\/\s+>(\s*)$/, "/>");
  s = s.replace(/\s+\/>\s*$/, "/>");
  s = s.replace(/\s+>\s*$/, ">");
  s = s.replace(/(\w)\s+-\s+(\w)/g, "$1-$2");
  s = s.replace(/(\w)\s+\?\s*:/g, "$1?:");
  s = s.replace(/(\w)\s+=\s+/g, "$1=");
  s = s.replace(/\s+=\s+/g, "=");
  return s;
}

/**
 * Extract the prop declarations from a component-def's `raw` text. Runs
 * BS+TAB on the normalized raw so we get the same `propsDecl` structure
 * the AST builder produces for `props={ ... }` attributes.
 *
 * Returns PropDecl[] (possibly empty) or null if parsing failed.
 *
 * PropDecl = {
 *   name: string,
 *   type: string,
 *   optional: boolean,
 *   default: string | null,
 *   bindable: boolean,
 *   isFunctionProp: boolean,
 * }
 */
export function extractComponentProps(componentDef, filePath) {
  if (!componentDef || !componentDef.raw) return [];
  const cacheKey = `${componentDef.name}::${componentDef.raw}`;
  if (componentPropsCache.has(cacheKey)) return componentPropsCache.get(cacheKey);

  let result = [];
  try {
    const normalized = normalizeTokenizedComponentRaw(componentDef.raw);
    const bs = splitBlocks((filePath || "/lsp-virtual.scrml") + "#" + componentDef.name, normalized);
    const tab = buildAST(bs);
    if (tab && tab.ast && Array.isArray(tab.ast.nodes)) {
      // First markup root is the primary node where `props={...}` lives.
      const primary = tab.ast.nodes.find(n => n && n.kind === "markup");
      if (primary && Array.isArray(primary.attrs)) {
        const propsAttr = primary.attrs.find(a => a && a.name === "props");
        if (propsAttr && propsAttr.value && propsAttr.value.kind === "props-block") {
          result = Array.isArray(propsAttr.value.propsDecl) ? propsAttr.value.propsDecl : [];
        }
      }
    }
  } catch {
    result = [];
  }

  componentPropsCache.set(cacheKey, result);
  return result;
}

/**
 * Detect whether the cursor is inside an open `<Component ...|` tag. Returns
 * the component name plus the partial attribute text already typed (so the
 * caller can filter the prop list by prefix).
 *
 * Walks backwards from `offset` looking for the most recent `<` whose tag
 * name starts with an uppercase ASCII letter (component tag, not an HTML
 * element). If a `>` closes the tag before we reach that `<`, returns null.
 *
 * Returns { componentName, prefix } or null.
 */
export function detectOpenComponentTag(text, offset) {
  let i = offset - 1;
  let inString = false;
  let stringChar = null;
  while (i >= 0) {
    const ch = text[i];
    if (inString) {
      if (ch === stringChar && text[i - 1] !== "\\") {
        inString = false;
        stringChar = null;
      }
      i--;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      i--;
      continue;
    }
    if (ch === ">" || ch === "{" || ch === "}") return null;
    if (ch === "<") {
      // Look at the tag name immediately after `<`.
      const after = text.slice(i + 1);
      const m = after.match(/^([A-Z][A-Za-z0-9_]*)/);
      if (!m) return null;
      const componentName = m[1];
      // Compute the in-tag prefix: everything between the tag name and
      // the cursor, minus leading whitespace and any partial identifier
      // immediately before the cursor.
      const tagPrefix = text.slice(i + 1 + componentName.length, offset);
      const prefixIdent = tagPrefix.match(/([A-Za-z_:][A-Za-z0-9_-]*)$/);
      const prefix = prefixIdent ? prefixIdent[1] : "";
      return { componentName, prefix };
    }
    i--;
  }
  return null;
}

/**
 * Build prop-name completions for an open component tag at `offset`. Looks
 * the component up first in `analysis.components`, then (if `workspace` is
 * provided) walks the file's import graph to find a foreign component with
 * the same name and reads its props from the workspace's TAB cache.
 */
export function buildComponentPropCompletions(text, offset, analysis, workspace) {
  const tag = detectOpenComponentTag(text, offset);
  if (!tag) return [];
  const { componentName, prefix } = tag;

  // 1. Same-file lookup — propsCache keyed by componentDef.raw.
  let propsDecl = null;
  let foundFilePath = analysis?.filePath || null;
  let isCrossFile = false;
  if (analysis?.components) {
    const local = analysis.components.find(c => c.name === componentName);
    if (local) {
      propsDecl = extractComponentProps(local, foundFilePath);
    }
  }

  // 2. Cross-file lookup — walk workspace.fileASTMap for an exported component
  //    of this name, then read its componentDef.raw.
  if ((!propsDecl || propsDecl.length === 0) && workspace?.fileASTMap) {
    const hit = findCrossFileComponent(workspace, analysis?.filePath, componentName);
    if (hit) {
      propsDecl = extractComponentProps(hit.componentDef, hit.filePath);
      foundFilePath = hit.filePath;
      isCrossFile = true;
    }
  }

  if (!propsDecl || propsDecl.length === 0) return [];

  const items = [];
  for (const decl of propsDecl) {
    if (prefix && !decl.name.startsWith(prefix)) continue;
    const typeStr = decl.type || "any";
    const optTag = decl.optional ? "?" : "";
    const bindTag = decl.bindable ? " (bind)" : "";
    items.push({
      label: decl.name,
      kind: CompletionItemKind.Property,
      detail: `${decl.name}${optTag}: ${typeStr}${bindTag}`,
      documentation: isCrossFile
        ? `Prop of <${componentName}> (defined in ${foundFilePath || "another file"}).`
        : `Prop of <${componentName}>.`,
      insertText: decl.name + "=",
    });
  }
  return items;
}

/**
 * Walk an importer's import declarations; when one names `componentName`,
 * look up the target file's AST in workspace.fileASTMap and find the
 * matching component-def. Returns { filePath, componentDef } or null.
 *
 * The importer's imports come from the workspace.importGraph (resolveModules
 * output keyed by absolute path).
 */
function findCrossFileComponent(workspace, importerPath, componentName) {
  if (!workspace || !importerPath) return null;
  const entry = workspace.importGraph?.get(importerPath);
  if (!entry) return null;
  for (const imp of entry.imports || []) {
    const names = imp.names || [];
    if (!names.includes(componentName)) continue;
    const targetPath = imp.absSource;
    if (!targetPath) continue;
    const targetRec = workspace.fileASTMap?.get(targetPath);
    if (!targetRec || !targetRec.ast) continue;
    const def = findComponentDefInAST(targetRec.ast, componentName);
    if (def) return { filePath: targetPath, componentDef: def };
  }
  return null;
}

/**
 * Search a FileAST for a component-def with the given name. Looks at hoisted
 * `ast.components`, then walks logic blocks (component-defs nest inside `${
 * }` logic blocks).
 */
function findComponentDefInAST(ast, name) {
  if (!ast) return null;
  for (const c of ast.components || []) {
    if (c.name === name) return c;
  }
  // Cross-file exports often appear as export-decl wrappers around a const
  // markup definition ("export const Card = < article ...>"). The hoisted
  // ast.components list is empty in that case (the AST builder didn t lift
  // the wrapped definition into ast.components). Synthesize a componentDef
  // by stripping the export-const-name= prefix from export.raw.
  for (const e of ast.exports || []) {
    if (e.exportedName !== name || e.exportKind !== "const") continue;
    if (typeof e.raw !== "string") continue;
    const m = e.raw.match(/^\s*export\s+const\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*([\s\S]+)$/);
    if (m && m[1].trim().startsWith("<")) {
      return { kind: "component-def", name, raw: m[1] };
    }
  }
  function walk(nodes) {
    for (const node of nodes || []) {
      if (!node) continue;
      if (node.kind === "logic" || node.kind === "meta") {
        for (const stmt of node.body || []) {
          if (stmt && stmt.kind === "component-def" && stmt.name === name) return stmt;
        }
        for (const c of node.components || []) {
          if (c.name === name) return c;
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

// ---------------------------------------------------------------------------
// L3 — Cross-file import completion
// ---------------------------------------------------------------------------

/**
 * Resolve a relative scrml import specifier to an absolute path. LSP-local
 * mirror of `compiler/src/module-resolver.js::resolveModulePath` — kept here
 * to avoid changing the compiler's resolver. Only supports `./` and `../`
 * forms (the forms used in import-clause completion); other forms return
 * null and the caller should give up gracefully.
 */
function resolveScrmlImport(source, importerPath) {
  if (!source || !importerPath) return null;
  if (!source.startsWith("./") && !source.startsWith("../")) return null;
  const baseDir = dirname(importerPath);
  const resolved = resolve(baseDir, source);
  if (existsSync(resolved)) return resolved;
  if (!resolved.endsWith(".scrml") && !resolved.endsWith(".js")) {
    const withExt = resolved + ".scrml";
    if (existsSync(withExt)) return withExt;
    const asDir = join(resolved, "index.scrml");
    if (existsSync(asDir)) return asDir;
  }
  return resolved;
}

/**
 * Detect whether the cursor is inside an `import { ... | ... } from "..."`
 * clause. Returns { source, prefix } where `source` is the literal between
 * `from "` and the closing quote (may be undefined if the source hasn't
 * been typed yet) and `prefix` is the partial identifier already typed
 * before the cursor inside the brace list.
 *
 * Returns null if the cursor is not inside an import-clause brace pair.
 */
export function detectImportClauseContext(text, offset) {
  // Find the start of the current line.
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineToCursor = text.slice(lineStart, offset);
  // Match a partially-typed import line: optional `import`, then `{` and
  // anything before the cursor.
  const m = lineToCursor.match(/(?:^|\s)import\s*\{([^}]*)$/);
  if (!m) return null;
  const inBrace = m[1];
  // Compute the partial identifier under the cursor.
  const prefMatch = inBrace.match(/([A-Za-z_][A-Za-z0-9_]*)?$/);
  const prefix = prefMatch ? (prefMatch[1] || "") : "";

  // Look ahead from the cursor to see if a `from "..."` source string is
  // already on the line. The line may be incomplete; try to find a quoted
  // string after `from`.
  const restOfLine = text.slice(offset, text.indexOf("\n", offset) === -1 ? text.length : text.indexOf("\n", offset));
  const fromMatch = restOfLine.match(/\}\s*from\s*["']([^"']+)["']/);
  let source = null;
  if (fromMatch) {
    source = fromMatch[1];
  }
  return { source, prefix };
}

/**
 * Build completion items for `import { | }` clauses. Reads the workspace's
 * exportRegistry to enumerate exports of the target file.
 *
 * Returns an empty array when the workspace cache or target file is missing,
 * or when the source path can't be resolved.
 */
export function buildImportCompletions(text, offset, analysis, workspace) {
  if (!workspace || !workspace.exportRegistry) return [];
  const ctx = detectImportClauseContext(text, offset);
  if (!ctx || !ctx.source) return [];

  const importerPath = analysis?.filePath || null;
  if (!importerPath) return [];
  const targetPath = resolveScrmlImport(ctx.source, importerPath);
  if (!targetPath) return [];

  const exports = workspace.exportRegistry.get(targetPath);
  if (!exports) return [];

  const items = [];
  for (const [name, info] of exports) {
    if (ctx.prefix && !name.startsWith(ctx.prefix)) continue;
    // P3-FOLLOW: prefer info.category (NR-authoritative); fall back to
    // info.isComponent for older registry entries.
    const isComp =
      info?.category === "user-component" ||
      (info?.category == null && info?.isComponent === true);
    const kind = isComp
      ? CompletionItemKind.Class
      : info?.kind === "type"
        ? CompletionItemKind.TypeParameter
        : info?.kind === "function"
          ? CompletionItemKind.Function
          : CompletionItemKind.Variable;
    items.push({
      label: name,
      kind,
      detail: info?.kind ? `exported ${info.kind} from ${ctx.source}` : `exported from ${ctx.source}`,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// L3 — Cross-file component completion (for `<Cap...` in markup)
// ---------------------------------------------------------------------------

/**
 * Enumerate cross-file component names that are imported by `importerPath`.
 * Reads the workspace's importGraph for the file, then for each import that
 * resolves to a file with an exported component, returns the component
 * name + its source-file path.
 */
export function listImportedCrossFileComponents(workspace, importerPath) {
  const out = [];
  if (!workspace || !importerPath) return out;
  const entry = workspace.importGraph?.get(importerPath);
  if (!entry) return out;
  for (const imp of entry.imports || []) {
    const targetPath = imp.absSource;
    if (!targetPath) continue;
    const targetExports = workspace.exportRegistry?.get(targetPath);
    if (!targetExports) continue;
    for (const importedName of imp.names || []) {
      const info = targetExports.get(importedName);
      // P3-FOLLOW: prefer info.category (NR-authoritative); fall back to
      // info.isComponent for older registry entries.
      const isComp =
        info?.category === "user-component" ||
        (info?.category == null && info?.isComponent === true);
      if (isComp) {
        out.push({ name: importedName, sourcePath: targetPath });
      }
    }
  }
  return out;
}

/**
 * Build completion items for `text` at `offset`. `analysis` is the cached
 * symbol info from `analyzeText`, or null if analysis hasn't run yet.
 *
 * `workspace` (L2/L3, optional) lets the completion consult the multi-file
 * cross-file import graph + export registry. When omitted, completions
 * degrade to single-file behavior.
 */
export function buildCompletions(text, offset, analysis, workspace) {
  const line = text.substring(text.lastIndexOf("\n", offset - 1) + 1, offset);
  const items = [];
  const context = detectContext(text, offset);

  // L1 fix #3a: `@var.|` member access — generic property completion stub.
  const memberAccessMatch = line.match(/(@[A-Za-z_$][A-Za-z0-9_$]*)\.(\w*)$/);
  if (memberAccessMatch && analysis?.reactiveVars) {
    const targetVarName = memberAccessMatch[1].slice(1);
    const targetVar = analysis.reactiveVars.find(v => {
      const n = v.name?.startsWith("@") ? v.name.slice(1) : v.name;
      return n === targetVarName;
    });
    if (targetVar) {
      items.push({
        label: "length",
        kind: CompletionItemKind.Property,
        detail: `${memberAccessMatch[1]}.length`,
        documentation: "Array/string length (member access — type-aware completions land in L3).",
      });
    }
  }

  // L3.2 — Component prop completion when cursor is inside `<Card |...`.
  // Run before generic markup-context completions because the component-prop
  // surface is more specific. Falls through to generic if no open component
  // tag is detected.
  const propItems = buildComponentPropCompletions(text, offset, analysis, workspace);
  if (propItems.length > 0) {
    for (const it of propItems) items.push(it);
  }

  // L3.3 — Cross-file import-clause completion. Only fires inside
  // `import { ... }` braces; takes precedence over the generic logic
  // completion list because the surface is narrow.
  if (workspace) {
    const importItems = buildImportCompletions(text, offset, analysis, workspace);
    if (importItems.length > 0) {
      for (const it of importItems) items.push(it);
    }
  }

  if (context === "markup" || context === "top-level") {
    if (line.endsWith("<") || /^\s*<[a-z]*$/.test(line) || /<[A-Z][A-Za-z0-9_]*$/.test(line)) {
      for (const tag of HTML_TAGS) {
        items.push({ label: tag, kind: CompletionItemKind.Class, detail: `<${tag}>` });
      }
      if (analysis?.components) {
        for (const c of analysis.components) {
          items.push({
            label: c.name,
            kind: CompletionItemKind.Class,
            detail: `<${c.name}> -- component`,
          });
        }
      }
      // L3 — also offer cross-file imported components (those in scope via
      // the importer's import graph).
      if (workspace && analysis?.filePath) {
        const crossComps = listImportedCrossFileComponents(workspace, analysis.filePath);
        const seen = new Set(items.map(i => i.label));
        for (const cc of crossComps) {
          if (seen.has(cc.name)) continue;
          seen.add(cc.name);
          items.push({
            label: cc.name,
            kind: CompletionItemKind.Class,
            detail: `<${cc.name}> -- imported from ${cc.sourcePath}`,
          });
        }
      }
    }

    if (/^\s*<\w+[\s]/.test(line)) {
      for (const attr of HTML_ATTRIBUTES) {
        items.push({ label: attr, kind: CompletionItemKind.Property });
      }
      for (const attr of SCRML_ATTRIBUTES) items.push(attr);
    }
  }

  if (context === "logic" || context === "top-level") {
    for (const kw of SCRML_KEYWORDS) items.push(kw);

    // L1 fix #3b: trigger reactive-var completion after `@` or `@<partial>`.
    const atMatch = line.match(/@([A-Za-z_$][A-Za-z0-9_$]*)?$/);
    if (atMatch && analysis?.reactiveVars) {
      const prefix = atMatch[1] || "";
      const allItems = reactiveVarCompletions(analysis.reactiveVars);
      for (const it of allItems) {
        if (!prefix || it.label.startsWith(prefix)) items.push(it);
      }
    }

    if (context === "logic") {
      if (analysis?.functions) {
        for (const fn of analysis.functions) {
          items.push({
            label: fn.name,
            kind: fn.isServer ? CompletionItemKind.Method : CompletionItemKind.Function,
            detail: formatFunctionSignature(fn),
            documentation: fn.isServer ? "server function" : "client function",
          });
        }
      }
      if (analysis?.types) {
        for (const t of analysis.types) {
          items.push({
            label: t.name,
            kind: CompletionItemKind.TypeParameter,
            detail: `${t.typeKind} ${t.name}`,
          });
        }
      }
    }
  }

  if (context === "sql") {
    // L3.1 — SQL column completion driven by PA's views Map. Emit column
    // items FIRST (more specific) so an editor that surfaces only the top N
    // shows column names ahead of generic SQL keywords.
    const sqlColumnItems = buildSqlColumnCompletions(text, offset, analysis);
    for (const it of sqlColumnItems) items.push(it);

    for (const kw of SQL_KEYWORDS) {
      items.push({ label: kw, kind: CompletionItemKind.Keyword, detail: "SQL keyword" });
    }
  }

  return items;
}

// ===========================================================================
// Semantic tokens (LSP `textDocument/semanticTokens/full`)
// ===========================================================================
//
// Context-exact syntax highlighting driven by the compiler's own parse
// (compiler-as-oracle), retiring reliance on regex vim/TextMate grammars.
//
// Two compiler surfaces cooperate:
//   1. block-splitter (`splitBlocks`) is the CONTEXT ORACLE — it paints each
//      byte of the source with its scrml context (markup / logic / css / sql /
//      state / comment / ...). This is what makes highlighting context-exact:
//      a `class` inside `<div class=…>` is an attribute (property), not the JS
//      `class` keyword; a bareword inside `#{…}` is a CSS property, not a var.
//   2. the native lexer (`lex`) is the LEAF TOKENIZER — it returns positioned
//      `{ kind, text, span:{start,end,line,col} }` tokens over the whole
//      document. Verified tolerant (never throws) across the whole .scrml
//      corpus + truncation fuzz.
//
// Both are wrapped in try/catch here; on any failure the handler returns an
// empty token set rather than throwing (editors send broken buffers on every
// keystroke — mirrors how `analyzeText` guards BS/TAB).
//
// TokenKind -> LSP SemanticTokenTypes mapping (STANDARD names, cross-editor
// safe). v1 is LEXICAL: roles come from the lexer + context, not from deep AST
// analysis (AST role-enrichment — enumMember, function-call targets, type vs
// var — is a noted follow-on).
//
//   context   construct                       -> SemanticTokenType
//   -------   ---------                        -> ------------------
//   any       Kw* / BoolLit (if/return/is/fn…) -> keyword
//   any       StringLit / TemplateChunk        -> string
//   any       NumberLit                        -> number
//   any       RegexLit                         -> regexp
//   any       // and /* */ (lexer-skipped)     -> comment  (gap scan)
//   any       <!-- --> (markup)                -> comment  (BS comment block)
//   logic     Ident                            -> variable
//   logic     @reactive (ScrmlAt)              -> variable
//   logic     operators / sigils (+,=>,~,?. …) -> operator
//   markup    tag / component name             -> type
//   markup    attribute name                   -> property
//   markup    type annotation `field(Type)`    -> type
//   markup    @reactive ref                    -> variable
//   markup    ${ … } embedded logic            -> (logic mapping)
//   css       property before `:`              -> property
//   sql       ?{ … } keyword (SELECT/FROM/…)   -> keyword
//   sql       string / number                  -> string / number
//   sql       -- and /* */                     -> comment
//
// Full-document only (`full: true`). Range/delta tokens = follow-on.

const SEM_TOKEN_TYPES = [
  SemanticTokenTypes.keyword,   // 0
  SemanticTokenTypes.string,    // 1
  SemanticTokenTypes.number,    // 2
  SemanticTokenTypes.comment,   // 3
  SemanticTokenTypes.variable,  // 4
  SemanticTokenTypes.operator,  // 5
  SemanticTokenTypes.type,      // 6
  SemanticTokenTypes.property,  // 7
  SemanticTokenTypes.regexp,    // 8
];

/**
 * The semantic-tokens legend. `server.js` advertises this in the
 * `semanticTokensProvider` capability; the client uses it to decode the
 * flat token-type indices we emit. No modifiers in v1.
 */
export const SEMANTIC_TOKENS_LEGEND = {
  tokenTypes: SEM_TOKEN_TYPES,
  tokenModifiers: [],
};

const SEM_TYPE_INDEX = Object.fromEntries(SEM_TOKEN_TYPES.map((t, i) => [t, i]));

// Every `Kw*` TokenKind plus the boolean literal -> keyword.
const SEM_KEYWORD_KINDS = new Set([
  ...Object.keys(TokenKind).filter((k) => k.startsWith("Kw")).map((k) => TokenKind[k]),
  TokenKind.BoolLit,
]);

// Brackets, separators and trivia get NO semantic token (kept uncolored to
// reduce noise). Everything that is not a keyword / literal / identifier and
// not in this set is treated as an operator.
const SEM_SKIP_KINDS = new Set([
  TokenKind.LParen, TokenKind.RParen, TokenKind.LBrace, TokenKind.RBrace,
  TokenKind.LBracket, TokenKind.RBracket, TokenKind.Comma, TokenKind.Semicolon,
  TokenKind.Newline, TokenKind.Whitespace, TokenKind.EOF,
]);

// SQL keywords for the `?{ … }` sub-scanner (uppercased lookup). Reuses the
// completion provider's list so the two never drift.
const SEM_SQL_KEYWORDS = new Set(SQL_KEYWORDS);

/**
 * Map a lexer token to its semantic type when it appears in LOGIC context
 * (inside `${ … }`, function bodies, `!{}`/`^{}` blocks, top-level code, or
 * an embedded escape). Returns a legend type name or null (no token).
 */
function semLogicType(tok) {
  const kind = tok.kind;
  if (SEM_KEYWORD_KINDS.has(kind)) return "keyword";
  switch (kind) {
    case TokenKind.StringLit:
    case TokenKind.TemplateChunk:
      return "string";
    case TokenKind.NumberLit:
      return "number";
    case TokenKind.RegexLit:
      return "regexp";
    case TokenKind.Ident:
      // A lone `$` is the logic-escape sigil, not a variable.
      return tok.text === "$" ? "operator" : "variable";
    case TokenKind.ScrmlAt:
    case TokenKind.BareVariant:
    case TokenKind.InputStateRef:
      return "variable";
    default:
      return SEM_SKIP_KINDS.has(kind) ? null : "operator";
  }
}

/**
 * Build an offset -> { line, char } positioner (both 0-based for LSP). Line
 * starts are precomputed once so each lookup is a binary search.
 */
function makePositioner(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  return function posOf(offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    let line = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) {
        line = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { line, char: offset - lineStarts[line] };
  };
}

/**
 * Emit a semantic token for the span [start, end), splitting on newlines so no
 * single token ever crosses a line (semantic tokens are single-line).
 */
function semEmit(out, text, posOf, start, end, type) {
  if (type == null || end <= start) return;
  let segStart = start;
  for (let i = start; i < end; i++) {
    if (text[i] === "\n") {
      if (i > segStart) {
        const p = posOf(segStart);
        out.push({ line: p.line, char: p.char, length: i - segStart, type });
      }
      segStart = i + 1;
    }
  }
  if (end > segStart) {
    const p = posOf(segStart);
    out.push({ line: p.line, char: p.char, length: end - segStart, type });
  }
}

/**
 * Build a per-offset context map from the block-splitter. Each offset carries
 * the nearest non-`text` ancestor context (so CSS/SQL bodies, which the
 * splitter stores as `text` children, keep their parent context). Returns null
 * if the splitter throws (the caller then treats everything as logic).
 */
function buildSemContextMap(text) {
  let bs;
  try {
    bs = splitBlocks("<lsp-semantic-tokens>", text);
  } catch {
    return null;
  }
  const map = new Array(text.length).fill(null);
  const paint = (block, inherited) => {
    const eff = block.type === "text" ? inherited : block.type;
    const s = block.span?.start ?? 0;
    const e = Math.min(block.span?.end ?? 0, text.length);
    for (let i = s; i < e; i++) map[i] = eff;
    for (const c of block.children || []) paint(c, eff);
  };
  // Top-level uncovered regions (top-level type decls, imports, statements)
  // stay null -> treated as logic. Top-level text blocks inherit logic too.
  for (const b of bs.blocks || []) paint(b, null);
  return { map, blocks: bs.blocks || [] };
}

// Context groups: collapse the splitter's fine-grained contexts to the four
// tokenization strategies below.
function semGroupOf(ctx) {
  switch (ctx) {
    case "markup":
    case "state":
      return "markup";
    case "css":
      return "css";
    case "sql":
      return "sql";
    // logic / error-effect / meta / foreign / comment / null -> logic mapping.
    default:
      return "logic";
  }
}

/**
 * Sub-scan a `?{ … }` SQL block (the native lexer emits it as one atomic
 * `SqlBlock` token). Colors SQL keywords, string/number literals and
 * `--` / `/* *​/` comments; leaves identifiers and punctuation uncolored.
 */
function semScanSql(out, text, posOf, sqlText, base) {
  const n = sqlText.length;
  let i = 0;
  while (i < n) {
    const c = sqlText[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    // -- line comment (SQL native)
    if (c === "-" && sqlText[i + 1] === "-") {
      let j = i + 2;
      while (j < n && sqlText[j] !== "\n" && sqlText[j] !== "\r") j++;
      semEmit(out, text, posOf, base + i, base + j, "comment");
      i = j;
      continue;
    }
    // /* */ block comment
    if (c === "/" && sqlText[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(sqlText[j] === "*" && sqlText[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      semEmit(out, text, posOf, base + i, base + j, "comment");
      i = j;
      continue;
    }
    // // line comment (universal)
    if (c === "/" && sqlText[i + 1] === "/") {
      let j = i + 2;
      while (j < n && sqlText[j] !== "\n" && sqlText[j] !== "\r") j++;
      semEmit(out, text, posOf, base + i, base + j, "comment");
      i = j;
      continue;
    }
    // string literal
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n && sqlText[j] !== c) {
        if (sqlText[j] === "\\") j++;
        j++;
      }
      j = Math.min(n, j + 1);
      semEmit(out, text, posOf, base + i, base + j, "string");
      i = j;
      continue;
    }
    // number literal
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9._]/.test(sqlText[j])) j++;
      semEmit(out, text, posOf, base + i, base + j, "number");
      i = j;
      continue;
    }
    // word — keyword or bareword
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sqlText[j])) j++;
      const word = sqlText.slice(i, j);
      if (SEM_SQL_KEYWORDS.has(word.toUpperCase())) {
        semEmit(out, text, posOf, base + i, base + j, "keyword");
      }
      i = j;
      continue;
    }
    i++;
  }
}

/**
 * Scan the GAPS between adjacent lexer tokens for `//` and `/* *​/` comments.
 * The native lexer consumes (and drops) these comments, so a gap that contains
 * a comment marker is genuinely a comment — strings/templates/regex have
 * already been carved out as their own tokens, so there are no false hits from
 * markers inside literals.
 *
 * CONTEXT-GATED (context-exact guarantee): the block-splitter context at the
 * marker offset decides whether a marker is a comment at all —
 *   - `//`  is a comment ONLY in JS `logic` context. In markup prose it is
 *           ordinary text (a URL `http://…`) and in CSS it is a URL inside
 *           `url(http://…)`; firing there swallows the rest of the line
 *           (e.g. a `</p>` close tag or `color: red }`). The splitter carves
 *           genuine `//` comments as their own `comment` blocks, so a real
 *           comment always resolves to a NON-null logic-group context; a `//`
 *           in markup/CSS makes the splitter fail (unclosed context) and leaves
 *           the offset unpainted (null) — so we require a non-null logic ctx.
 *   - `/* *​/` is a comment in `logic` AND `css` (CSS block comments), but not
 *           in markup prose or SQL. The splitter does NOT carve these as
 *           `comment` blocks, and a genuine top-level `/* *​/` sits in an
 *           unpainted (null → logic) region, so null is allowed for this marker.
 * SQL (`--`, `//`, `/* *​/`) is handled by `semScanSql` on the atomic `?{…}`
 * SqlBlock token, so it never reaches the gap scanner and is not double-handled.
 */
function semScanCommentGaps(out, text, posOf, tokens, ctxMap) {
  // Same context-lookup idiom as `semWalkTokens`: null ctx → logic group.
  const rawCtxAt = (off) => (ctxMap ? ctxMap[off] : null);
  const groupAt = (off) => semGroupOf(rawCtxAt(off) ?? "logic");
  const scanGap = (s, e) => {
    let i = s;
    while (i < e) {
      const c = text[i];
      if (c === "/" && (text[i + 1] === "/" )) {
        // `//` comment only in a *painted* logic context (never in markup/CSS,
        // where a null-fallback logic group would otherwise mis-fire on a URL).
        if (rawCtxAt(i) != null && groupAt(i) === "logic") {
          let j = i + 2;
          while (j < e && text[j] !== "\n" && text[j] !== "\r") j++;
          semEmit(out, text, posOf, i, j, "comment");
          i = j;
          continue;
        }
        i++;
        continue;
      }
      if (c === "/" && text[i + 1] === "*") {
        // `/* *​/` comment in logic OR css (null → logic allowed: genuine
        // top-level block comments sit in unpainted regions).
        const g = groupAt(i);
        if (g === "logic" || g === "css") {
          let j = i + 2;
          while (j < e && !(text[j] === "*" && text[j + 1] === "/")) j++;
          j = Math.min(e, j + 2);
          semEmit(out, text, posOf, i, j, "comment");
          i = j;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
  };
  let prevEnd = 0;
  for (const t of tokens) {
    if (t.kind === TokenKind.EOF) continue;
    const s = t.span?.start ?? 0;
    if (s > prevEnd) scanGap(prevEnd, s);
    prevEnd = Math.max(prevEnd, t.span?.end ?? 0);
  }
  if (prevEnd < text.length) scanGap(prevEnd, text.length);
}

/** Emit comment tokens for every block the splitter classified as `comment`
 *  (covers markup `<!-- -->`, which the lexer tokenizes as operators). */
function semScanCommentBlocks(out, text, posOf, blocks) {
  const walk = (b) => {
    if (b.type === "comment" && b.span) {
      // A line-comment block spans up to and including its trailing CRLF; trim
      // the newline chars so a CRLF `//` comment token doesn't carry the
      // invisible `\r`. Block comments (`/* */`, `<!-- -->`) end at their closer
      // and carry no trailing newline, so this is a no-op for them.
      let end = Math.min(b.span.end, text.length);
      while (end > b.span.start && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
      semEmit(out, text, posOf, b.span.start, end, "comment");
    }
    for (const c of b.children || []) walk(c);
  };
  for (const b of blocks) walk(b);
}

/**
 * Walk the lexer token stream, assigning a semantic type per token based on
 * its block-splitter context. Markup and CSS use small state machines; `${…}`
 * escapes inside markup/css switch to logic mapping until their braces close;
 * `?{…}` (atomic SqlBlock) is sub-scanned.
 */
function semWalkTokens(out, text, posOf, tokens, ctxMap) {
  const ctxAt = (off) => {
    if (!ctxMap) return "logic";
    const c = ctxMap[off];
    return c == null ? "logic" : c;
  };
  const emit = (tok, type) => semEmit(out, text, posOf, tok.span.start, tok.span.end, type);

  // Markup state machine flags.
  let expectTagName = false;   // just saw `<` (or `</`) — next ident is the tag
  let tagContinuation = false; // just saw `.` after a tag name — namespaced tag
  let tagJustEmitted = false;  // the previous markup token was a tag-name part
  let inTag = false;           // between tag name and `>` — reading attributes
  let attrValueNext = false;   // just saw `=` — next token is the attr value
  let parenDepth = 0;          // inside `field(Type)` — annotation parens

  // `${ … }` escape state (used inside markup/css).
  let escapeReturn = null;     // non-null while inside an escape (group to resume)
  let escapeDepth = 0;

  const resetMarkup = () => {
    expectTagName = false;
    tagContinuation = false;
    tagJustEmitted = false;
    inTag = false;
    attrValueNext = false;
    parenDepth = 0;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const kind = t.kind;
    if (kind === TokenKind.EOF || kind === TokenKind.Newline || kind === TokenKind.Whitespace) {
      continue;
    }

    // `?{ … }` — atomic in any context; sub-scan and move on.
    if (kind === TokenKind.SqlBlock) {
      semScanSql(out, text, posOf, t.text, t.span.start);
      continue;
    }

    // Inside a `${ … }` escape: full logic mapping + brace tracking.
    if (escapeReturn !== null) {
      if (kind === TokenKind.LBrace) { escapeDepth++; emit(t, "operator"); continue; }
      if (kind === TokenKind.RBrace) {
        escapeDepth--;
        emit(t, "operator");
        if (escapeDepth <= 0) escapeReturn = null;
        continue;
      }
      const ty = semLogicType(t);
      if (ty) emit(t, ty);
      continue;
    }

    const group = semGroupOf(ctxAt(t.span.start));

    // `${` escape opener inside markup/css: `$` immediately followed by `{`.
    if (
      (group === "markup" || group === "css") &&
      kind === TokenKind.Ident && t.text === "$" &&
      i + 1 < tokens.length &&
      tokens[i + 1].kind === TokenKind.LBrace &&
      tokens[i + 1].span.start === t.span.end
    ) {
      emit(t, "operator");
      emit(tokens[i + 1], "operator");
      escapeReturn = group;
      escapeDepth = 1;
      attrValueNext = false;
      i++; // consume the `{`
      continue;
    }

    if (group === "logic") {
      const ty = semLogicType(t);
      if (ty) emit(t, ty);
      continue;
    }

    if (group === "css") {
      if (kind === TokenKind.StringLit || kind === TokenKind.TemplateChunk) { emit(t, "string"); continue; }
      if (kind === TokenKind.NumberLit) { emit(t, "number"); continue; }
      if (kind === TokenKind.Ident) {
        // Property name: an identifier (or a contiguous hyphenated run like
        // `font-size` — the lexer splits it into Ident `-` Ident) whose next
        // meaningful token is `:`. Merge the run into one `property` token.
        let last = i;
        while (
          tokens[last + 1] && tokens[last + 2] &&
          tokens[last + 1].kind === TokenKind.Minus &&
          tokens[last + 2].kind === TokenKind.Ident &&
          tokens[last + 1].span.start === tokens[last].span.end &&
          tokens[last + 2].span.start === tokens[last + 1].span.end
        ) {
          last += 2;
        }
        const after = tokens[last + 1];
        if (after && after.kind === TokenKind.Colon) {
          semEmit(out, text, posOf, t.span.start, tokens[last].span.end, "property");
          i = last;
        }
        continue;
      }
      continue; // selectors, values, punctuation -> uncolored
    }

    // group === "markup" (also `state` declaration openers). Snapshot whether
    // the previous markup token was a tag-name part, then clear the flag — only
    // the tag-name emit below re-sets it.
    const prevWasTag = tagJustEmitted;
    tagJustEmitted = false;

    if (kind === TokenKind.ScrmlAt) { emit(t, "variable"); attrValueNext = false; continue; }
    if (kind === TokenKind.StringLit || kind === TokenKind.TemplateChunk) { emit(t, "string"); attrValueNext = false; continue; }
    if (kind === TokenKind.NumberLit) { if (attrValueNext) emit(t, "number"); attrValueNext = false; continue; }
    if (kind === TokenKind.RegexLit) { emit(t, "regexp"); attrValueNext = false; continue; }

    if (kind === TokenKind.LessThan) { resetMarkup(); expectTagName = true; continue; }
    if (kind === TokenKind.Slash) { continue; }   // part of `</` or `/>`
    if (kind === TokenKind.GreaterThan) { resetMarkup(); continue; }

    if (kind === TokenKind.LParen) { if (inTag) parenDepth++; continue; }
    if (kind === TokenKind.RParen) { if (inTag && parenDepth > 0) parenDepth--; continue; }

    // Namespaced tag `<Foo.Bar>` — a `.` right after a tag-name part means the
    // next identifier continues the tag name (still a `type`).
    if (kind === TokenKind.Dot) {
      if (inTag && prevWasTag) tagContinuation = true;
      continue;
    }

    if (kind === TokenKind.Assign) { if (inTag) attrValueNext = true; continue; }

    // Identifier-like: tag name, attribute name, type annotation, or the attr
    // value. `class` etc. arrive here as `Kw*`, so accept keyword kinds too.
    const identLike = kind === TokenKind.Ident || SEM_KEYWORD_KINDS.has(kind);
    if (identLike) {
      if (expectTagName || tagContinuation) {
        emit(t, "type");
        expectTagName = false;
        tagContinuation = false;
        tagJustEmitted = true;
        inTag = true;
      } else if (attrValueNext) {
        // bareword attribute value -> treat as a variable reference
        emit(t, "variable");
        attrValueNext = false;
      } else if (inTag) {
        emit(t, parenDepth > 0 ? "type" : "property");
      }
      continue;
    }

    // Any other token in markup structural position -> uncolored.
    attrValueNext = false;
  }
}

/**
 * Compute the readable (pre-encoding) semantic-token list for `text`. Returns
 * a sorted, overlap-free array of `{ line, char, length, type }` (all 0-based;
 * `type` is a legend type name). NEVER throws — returns `[]` on any failure.
 *
 * `analysis` is accepted for signature parity / future AST role-enrichment but
 * v1 derives everything from the source text (robust even when analysis is
 * null, e.g. a buffer that failed BS/TAB).
 */
export function computeSemanticTokens(text, analysis) {
  if (typeof text !== "string" || text.length === 0) return [];
  try {
    const posOf = makePositioner(text);
    const out = [];

    const ctx = buildSemContextMap(text);
    const ctxMap = ctx?.map ?? null;

    let tokens = [];
    try {
      tokens = lex(text);
    } catch {
      tokens = [];
    }

    semWalkTokens(out, text, posOf, tokens, ctxMap);
    semScanCommentGaps(out, text, posOf, tokens, ctxMap);
    if (ctx?.blocks) semScanCommentBlocks(out, text, posOf, ctx.blocks);

    // Sort by (line, char) — required by SemanticTokensBuilder's delta encoding.
    out.sort((a, b) => a.line - b.line || a.char - b.char || b.length - a.length);

    // Drop exact duplicates and overlaps (a comment gap + a BS comment block can
    // both cover the same `//`; overlapping tokens break the delta encoding).
    const result = [];
    let lastLine = -1;
    let lastEnd = -1;
    let seen = "";
    for (const tk of out) {
      const key = `${tk.line}:${tk.char}:${tk.length}:${tk.type}`;
      if (key === seen) continue;
      if (tk.line === lastLine && tk.char < lastEnd) continue; // overlap
      result.push(tk);
      seen = key;
      lastLine = tk.line;
      lastEnd = tk.char + tk.length;
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Build the LSP-encoded semantic tokens for `text` (the value returned from a
 * `textDocument/semanticTokens/full` request). Uses `SemanticTokensBuilder` to
 * delta-encode. NEVER throws — returns an empty `{ data: [] }` on any failure.
 */
export function buildSemanticTokens(text, analysis) {
  const builder = new SemanticTokensBuilder();
  let tokens = [];
  try {
    tokens = computeSemanticTokens(text, analysis);
  } catch {
    tokens = [];
  }
  for (const tk of tokens) {
    const typeIndex = SEM_TYPE_INDEX[tk.type];
    if (typeIndex == null) continue;
    builder.push(tk.line, tk.char, tk.length, typeIndex, 0);
  }
  return builder.build();
}
