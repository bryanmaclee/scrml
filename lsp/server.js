#!/usr/bin/env bun
/**
 * scrml Language Server Protocol (LSP) server.
 *
 * Provides diagnostics, completions, hover, definition, document symbols,
 * signature help, and code actions for .scrml files. Imports compiler
 * stages directly for fast in-process analysis.
 *
 * The handler logic lives in `lsp/handlers.js` (L1-L3) and `lsp/l4.js`
 * (L4 — signature help + code actions) so it can be unit-tested without
 * booting an LSP transport (createConnection demands one at module load
 * time). This module is the LSP wiring shell only.
 *
 * L2 (deep-dive 2026-04-24, "See the workspace"):
 *   - On `initialize`, the server bootstraps a workspace-wide cache by
 *     scanning `rootUri`/`rootPath`/`workspaceFolders` for `.scrml` files,
 *     running BS+TAB on each, and computing the cross-file import graph +
 *     export registry.
 *   - On `didChange` / `didOpen` / `didClose`, the workspace slice is
 *     updated and the cross-file graph is rebuilt; if the touched file's
 *     export shape changed, ALL open buffers are re-analyzed so their
 *     diagnostics catch up with the new graph (conservative L2 policy
 *     per Q3 of the deep-dive).
 *   - `onDefinition` consults the workspace for cross-file lookups.
 *
 * L3 (deep-dive 2026-04-24, "Scrml-unique completions"):
 *   - SQL column completion inside `?{}` blocks (driven by PA's `views` map).
 *   - Component prop completion for `<Card |...` tags (same-file + cross-file).
 *   - Cross-file import-clause completion (`import { | } from "./other.scrml"`).
 *   - Cross-file imported components surface in `<Cap...` markup completions.
 *
 * L4 (deep-dive 2026-04-24, "Standards polish"):
 *   - signatureHelpProvider: triggered on `(` and `,`. Resolves the callee,
 *     same-file or cross-file, and emits parameter highlighting.
 *   - codeActionProvider: emits `quickfix` actions for E-IMPORT-004,
 *     E-IMPORT-005, E-LIN-001, E-PA-007, and E-SQL-006.
 *
 * Usage: bun run lsp/server.js --stdio
 */

import { existsSync, readFileSync } from "fs";

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CodeActionKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  analyzeText,
  buildCompletions,
  buildDefinitionLocation,
  buildDocumentSymbols,
  buildHover,
  buildSemanticTokens,
  SEMANTIC_TOKENS_LEGEND,
} from "./handlers.js";

import {
  buildSignatureHelp,
  buildCodeActions,
} from "./l4.js";

import {
  createWorkspace,
  bootstrapWorkspace,
  updateFileInWorkspace,
  removeFileFromWorkspace,
} from "./workspace.js";

// ---------------------------------------------------------------------------
// Connection setup
// ---------------------------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Per-file analysis cache (uri → analysis from analyzeText).
const fileAnalysis = new Map();

// L2 — workspace-wide cache (cross-file imports/exports/diagnostics).
const workspace = createWorkspace();

function uriToPath(uri) {
  if (uri.startsWith("file://")) return decodeURIComponent(uri.slice(7));
  return uri;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

connection.onInitialize((params) => {
  // L2 — pick the workspace root from initialize params. Prefer
  // `workspaceFolders` (LSP 3.6+), fall back to deprecated `rootUri` /
  // `rootPath`. If none are present (single-file mode), the workspace
  // stays empty and the LSP behaves as L1 did.
  let rootPath = null;
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    rootPath = uriToPath(params.workspaceFolders[0].uri);
  } else if (params.rootUri) {
    rootPath = uriToPath(params.rootUri);
  } else if (params.rootPath) {
    rootPath = params.rootPath;
  }
  if (rootPath) {
    bootstrapWorkspace(workspace, rootPath, (msg) => connection.console.log(msg));
  } else {
    connection.console.log("scrml LSP: no workspace root supplied — running in single-file mode");
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        // Trigger chars cover scrml's six contexts: markup `<`, reactive `@`,
        // logic `$`, sql `?`, meta `^`, css `#`, plus member-access `.`,
        // type-annotation `:`, attribute `=`, and a single space — the
        // L3 SQL column completion needs to fire after typing `SELECT u.|`
        // or `SELECT |` where the trailing whitespace is the trigger.
        triggerCharacters: ["<", "@", "$", "?", "^", "#", ".", ":", "=", " "],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      // L1 — phase L1 of the LSP enhancement roadmap (deep-dive 2026-04-24).
      // documentSymbolProvider populates editor outline panels (VS Code,
      // Neovim, etc) from a single AST walk over the .scrml file.
      documentSymbolProvider: true,
      // L4.1 — signature help fires on `(` and `,`. The retrigger char
      // set lets the active-parameter index update as the user advances
      // through the argument list.
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
        retriggerCharacters: [","],
      },
      // L4.2 — code actions of kind "quickfix" for the top-5 mechanical
      // error codes. The client filters by kind via codeActionKinds.
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      // Semantic tokens — context-exact syntax highlighting driven by the
      // compiler's own parse (block-splitter context oracle + native lexer),
      // retiring reliance on regex vim/TextMate grammars. Full-document only
      // for v1 (range/delta = follow-on). The legend maps our emitted
      // type indices to standard SemanticTokenTypes names, cross-editor safe.
      semanticTokensProvider: {
        legend: SEMANTIC_TOKENS_LEGEND,
        full: true,
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log("scrml LSP server initialized");
});

// ---------------------------------------------------------------------------
// Diagnostics — re-analyze on every change
// ---------------------------------------------------------------------------

/**
 * Re-analyze a single open document and publish its diagnostics.
 * Pulls cross-file diagnostics from the workspace cache.
 */
function analyzeAndPublish(doc) {
  const filePath = uriToPath(doc.uri);
  const text = doc.getText();
  const { diagnostics, analysis } = analyzeText(
    filePath,
    text,
    (msg) => connection.console.log(msg),
    workspace,
  );
  fileAnalysis.set(doc.uri, analysis);
  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

documents.onDidChangeContent((change) => {
  const filePath = uriToPath(change.document.uri);
  const text = change.document.getText();
  // L2 — refresh the workspace's TAB record for this file FIRST so the
  // cross-file graph (and any E-IMPORT-* errors derived from it) reflect
  // the latest buffer before per-file analyzeText pulls them in.
  const { exportsChanged } = updateFileInWorkspace(workspace, filePath, text);

  // Now publish diagnostics for the changed buffer using the refreshed cache.
  analyzeAndPublish(change.document);

  // L2 — if exports shifted, re-publish diagnostics for every other open
  // buffer because their cross-file E-IMPORT-* surface may have changed.
  // Conservative policy from deep-dive Q3.
  if (exportsChanged) {
    for (const other of documents.all()) {
      if (other.uri === change.document.uri) continue;
      analyzeAndPublish(other);
    }
  }
});

documents.onDidClose((event) => {
  const filePath = uriToPath(event.document.uri);
  // L2 — keep the on-disk version in the cache if the file still exists.
  // Avoids dead-import false positives when a tab is closed but the file
  // is still on disk and still being imported by other open buffers.
  try {
    if (existsSync(filePath)) {
      const onDisk = readFileSync(filePath, "utf8");
      updateFileInWorkspace(workspace, filePath, onDisk);
    } else {
      removeFileFromWorkspace(workspace, filePath);
    }
  } catch {
    removeFileFromWorkspace(workspace, filePath);
  }
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  fileAnalysis.delete(event.document.uri);
});

// ---------------------------------------------------------------------------
// Per-feature handlers (delegate to handlers.js / l4.js)
// ---------------------------------------------------------------------------

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const analysis = fileAnalysis.get(params.textDocument.uri);
  // L3 — pass workspace so cross-file completions (imports, components) work.
  return buildCompletions(text, offset, analysis, workspace);
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const analysis = fileAnalysis.get(params.textDocument.uri);
  return buildHover(text, offset, analysis);
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const analysis = fileAnalysis.get(params.textDocument.uri);
  const filePath = uriToPath(params.textDocument.uri);
  // L2 — pass workspace + filePath so an unresolved same-file lookup can
  // fall through to the cross-file resolver.
  return buildDefinitionLocation(params.textDocument.uri, text, offset, analysis, workspace, filePath);
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const analysis = fileAnalysis.get(params.textDocument.uri);
  if (!analysis?.ast) return [];
  return buildDocumentSymbols(analysis.ast, analysis.text || document.getText());
});

// L4.1 — Signature help
connection.onSignatureHelp((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const analysis = fileAnalysis.get(params.textDocument.uri);
  const filePath = uriToPath(params.textDocument.uri);
  return buildSignatureHelp(text, offset, analysis, workspace, filePath);
});

// L4.2 — Code actions (quickfix for top-5 error codes)
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const text = document.getText();
  const analysis = fileAnalysis.get(params.textDocument.uri);
  const filePath = uriToPath(params.textDocument.uri);
  return buildCodeActions(
    text,
    params.textDocument.uri,
    params.context,
    analysis,
    workspace,
    filePath,
  );
});

// Semantic tokens (full document) — context-exact highlighting. The handler
// logic lives in handlers.js (`buildSemanticTokens`) so it can be unit-tested
// without a transport. It NEVER throws: on any BS/lex failure it returns an
// empty `{ data: [] }`, so a mid-keystroke broken buffer degrades gracefully
// (the editor keeps the last good highlighting rather than erroring).
connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  const text = document.getText();
  const analysis = fileAnalysis.get(params.textDocument.uri);
  return buildSemanticTokens(text, analysis);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
