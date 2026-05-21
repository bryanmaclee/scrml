// collect-hoisted.js — JS-host shadow of collect-hoisted.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors collect-hoisted.scrml's header.
//
// F3 / Cluster B — the native-parser analogue of the live pipeline's
// `collectHoisted` (compiler/src/ast-builder.js ~L12132) + the
// `hasProgramRoot` computation (~L12296). A pure fold over the native
// parser's block-stream producing the file-level surface the downstream
// compiler stages consume.
//
// THE LIVE CONTRACT (the behavioral spec — ast-builder.js):
//   collectHoisted(nodes) -> { imports, exports, typeDecls, components,
//                              machineDecls, channelDecls }
//   The live walk visits each AST node:
//     - `logic`       — spreads its pre-filtered imports/exports/typeDecls/
//                       components arrays in;
//     - `engine-decl` — pushes to machineDecls; recurses `bodyChildren` to
//                       discover NESTED engines;
//     - `markup`/`state` — recurses `children`;
//     - `markup` tag "channel" — pushes to channelDecls;
//     - `meta`        — walks `body` for import/export/type/component-def
//                       (and recurses `function-decl` bodies).
//   hasProgramRoot is computed by the caller: true iff a top-level `markup`
//   node has tag "program".
//
// THE NATIVE NODE-CATALOG ADAPTATION (Phase 0 — see the .scrml header for
// the full live->native kind map). The native parser's per-file output is a
// flat `Block[]` (parse-markup.js's `parseMarkup`). Each Block is
// `{ kind, span, commentForm, ...payload }`:
//   - "Markup"      — { name, children:Block[], closerForm, tagClass, span }
//   - "LogicEscape" — { bodyText, body:Stmt[], span }   (body = parseProgram)
//   - "Meta"        — sketch-depth; no parsed body at this milestone
//   Stmt nodes (ast-stmt.js) carry kind "Import" / "Export" for module decls.
//   There is NO native kind for engine/type/component/state declarations at
//   v0.5 — those land at v0.6 F7. The walker collects what the native parser
//   PRODUCES TODAY (imports/exports/channelDecls/hasProgramRoot) and keeps
//   the typeDecls/components/machineDecls slots so v0.6 lights them up with
//   no structural rewrite.

import { StmtKind } from "./ast-stmt.js";

// =============================================================================
// collectHoisted — calculation (pure). One fold over the block-stream,
// producing all seven outputs (Cluster B — one walk, all outputs).
//
// `blocks` is the `Block[]` from parse-markup.js's `parseMarkup`. Defensive:
// a missing / non-array `blocks` folds to the empty surface.
//
// Returns { imports, exports, typeDecls, components, machineDecls,
//           channelDecls, hasProgramRoot }.
// =============================================================================
export function collectHoisted(blocks) {
    const imports = [];
    const exports = [];
    const typeDecls = [];      // v0.5: always empty — no native type-decl kind
    const components = [];     // v0.5: always empty — no native component kind
    const machineDecls = [];   // v0.5: always empty — no native engine kind
    const channelDecls = [];

    if (blocks === undefined || blocks === null || Array.isArray(blocks) === false) {
        return {
            imports, exports, typeDecls, components,
            machineDecls, channelDecls, hasProgramRoot: false,
        };
    }

    // hasProgramRoot — TOP-LEVEL only (the live check is `nodes.some(...)`
    // over the top-level node list, NOT a recursive search). Computed in the
    // same pass per Cluster B; the top-level scan happens here so it is not
    // contaminated by a nested `<program>` deeper in the tree.
    let programRoot = false;

    // walkBlocks — recurse the block-stream. Markup blocks recurse their
    // `children` (the nested element tree); LogicEscape blocks have their
    // parsed `body` Stmt[] scanned for Import/Export statements.
    function walkBlocks(blockList) {
        for (const block of blockList) {
            if (block === undefined || block === null) continue;

            if (block.kind === "Markup") {
                // live: `markup` tag "channel" -> channelDecls.
                if (block.name === "channel") {
                    channelDecls.push(block);
                }
                // live: `markup`/`state` -> recurse `children`.
                if (Array.isArray(block.children)) {
                    walkBlocks(block.children);
                }
            } else if (block.kind === "LogicEscape") {
                // live: a `logic` node hands pre-filtered imports/exports.
                // The native LogicEscape carries the RAW parsed Stmt[] body;
                // the walker filters it for Import/Export statements (the
                // native equivalent of the live `logic` node's cached arrays).
                if (Array.isArray(block.body)) {
                    walkStmts(block.body);
                }
            }
            // "Meta" / "Sql" / "Css" / "ErrorEffect" / "Test" / "ForeignCode"
            // / "Text" / "DisplayTextLiteral" / "Comment" blocks carry no
            // hoistable declarations at v0.5 (Meta is sketch-depth — no parsed
            // body; the live `meta` body-walk activates at v0.6 F7 when the
            // Meta block gains a typed payload).
        }
    }

    // walkStmts — scan a Stmt[] for the module-declaration kinds. Recurses
    // FunctionDecl bodies — the live `walkBodyNodes` recursion (a nested
    // `import` inside a function body is still hoisted). Block statements
    // are recursed too (a `{ import ... }` block — defensive parity with the
    // live walker's structural reach).
    function walkStmts(stmtList) {
        for (const stmt of stmtList) {
            if (stmt === undefined || stmt === null) continue;

            if (stmt.kind === StmtKind.Import) {
                imports.push(stmt);
            } else if (stmt.kind === StmtKind.Export) {
                exports.push(stmt);
            } else if (stmt.kind === StmtKind.FunctionDecl) {
                // live walkBodyNodes recurses `function-decl` bodies.
                if (Array.isArray(stmt.body)) {
                    walkStmts(stmt.body);
                }
            } else if (stmt.kind === StmtKind.Block) {
                if (Array.isArray(stmt.body)) {
                    walkStmts(stmt.body);
                }
            }
        }
    }

    // The top-level scan — drives hasProgramRoot off the top-level blocks
    // ONLY, then recurses every block for the deeper collections.
    for (const block of blocks) {
        if (block === undefined || block === null) continue;
        if (block.kind === "Markup" && block.name === "program") {
            programRoot = true;
        }
    }
    walkBlocks(blocks);

    return {
        imports, exports, typeDecls, components,
        machineDecls, channelDecls, hasProgramRoot: programRoot,
    };
}

// =============================================================================
// hasProgramRoot — calculation (pure predicate). True iff a TOP-LEVEL block
// is a Markup block named "program". The live pipeline's W-PROGRAM-001 check
// (ast-builder.js L12296). Exported standalone for callers that want only the
// boolean; collectHoisted folds the same computation in per Cluster B.
// =============================================================================
export function hasProgramRoot(blocks) {
    if (blocks === undefined || blocks === null || Array.isArray(blocks) === false) {
        return false;
    }
    for (const block of blocks) {
        if (block === undefined || block === null) continue;
        if (block.kind === "Markup" && block.name === "program") {
            return true;
        }
    }
    return false;
}
