// parse-file.js — JS-host shadow of parse-file.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-file.scrml's header.
//
// C1 (v0.7 M5-swap) — the native-parser analogue of the live pipeline's
// `buildAST` (compiler/src/ast-builder.js ~L11971). `nativeParseFile` is the
// ASSEMBLER: it turns a scrml source file into the live `FileAST` shape every
// downstream stage (NR / RI / AG / CG) expects, using the native parser's
// block-stream plus the already-landed A1/A2/A3 bridges.
//
// THE LIVE CONTRACT (the behavioral spec — ast-builder.js `buildAST`):
//   buildAST(blockSplitterOutput) -> { filePath, ast: FileAST, errors }
//   The FileAST it assembles is:
//     { filePath, nodes, imports, exports, components, typeDecls,
//       machineDecls, channelDecls, hasProgramRoot, authConfig,
//       middlewareConfig }
//   - `nodes` is the lowercase `ASTNode` union (markup / text / comment /
//     logic / sql / css-inline / meta / error-effect / ...).
//   - the hoisted collections (imports / exports / typeDecls / components /
//     machineDecls / channelDecls) are folded by `collectHoisted`.
//   - `hasProgramRoot` — true iff a top-level `markup` node has tag "program".
//   - `authConfig` / `middlewareConfig` — S115 (DD #27 / F6 / Pivot 2): NO
//     LONGER computed here. The pipeline-agnostic pre-codegen pass
//     `computeProgramConfig` (invoked at the api.js PRECG seam, Stage 3.004)
//     mutates the FileAST with these — `buildAST` leaves them out of its
//     literal entirely, and the PGO `has*` flags are derived the same way by
//     `computePGOFlags`. `nativeParseFile` mirrors that: it sets BOTH to
//     `null` (the FileAST interface declares them non-optional — ast.ts:1508),
//     and PRECG overwrites them downstream.
//
// THE NATIVE NODE-CATALOG ADAPTATION. The native parser's per-file output is a
// flat `Block[]` (parse-markup.js's `parseMarkup`). Each Block carries a
// PascalCase `kind`; the live `FileAST.nodes` is the lowercase `ASTNode`
// union. The BlockKind -> ASTNode kind map (DD §C1 / R3):
//     "Markup"      -> "markup"
//     "Text"        -> "text"
//     "Comment"     -> "comment"
//     "Sql"         -> "sql"
//     "Css"         -> "css-inline"
//     "Meta"        -> "meta"
//     "ErrorEffect" -> "error-effect"
//     "LogicEscape" -> "logic"
//   Three native BlockKinds are NOT in the DD's map:
//     "DisplayTextLiteral" — a code-default-mode `"..."` display-text literal
//        (SPEC §4.18.8). The live pipeline has no top-level `DisplayTextLiteral`
//        ASTNode; the literal is a §4.18.4 segments/exprs carrier consumed by
//        codegen's auto-HTML-escape path. `nativeParseFile` maps it to a `text`
//        node carrying the verbatim literal source (the faithful best-effort —
//        a downstream §4.18.6 escape pass owns the segment expansion). Surfaced
//        as a deferred item.
//     "Test"        — a `_{...}` test block. The live pipeline strips test
//        blocks before codegen; there is no live `test` ASTNode kind. Dropped
//        from `nodes` (the live behavior). Surfaced as a deferred item.
//     "ForeignCode" — a `^^{...}` foreign-code block. No live ASTNode kind
//        today. Dropped from `nodes`. Surfaced as a deferred item.
//   Dropping a kind is logged onto the result's `errors` as an `I-`-prefixed
//   info diagnostic so the disposition is observable, never silent.
//
// THE BRIDGE SEAM. A `LogicEscape` / `Meta` block carries a native `Stmt[]`
// body (`block.body`, produced by parse-markup's `parseLogicBodyBestEffort`).
// The A1 bridge `translateStmtList(nativeBody, idGen)` (translate-stmt.js)
// translates it to the live `LogicStatement[]`. A1 internally calls the A2
// expression bridge (`translateExpr` — translate-expr.js) so `nativeParseFile`
// does not call A2 directly; the catalog translation is fully encapsulated.
//
// THE SHARED idGen. Every synthesized node (the `nodes` ASTNodes, the
// translated `LogicStatement`s, the hoisted EngineDecl/ComponentDef/TypeDecl
// nodes) needs a numeric `id` (the live `BaseNode` contract — ast.ts:204).
// `nativeParseFile` creates ONE `{ next }` counter and threads the SAME
// instance through `collectHoisted`, every `translateStmtList` call, and every
// directly-synthesized node's `id` — so the whole native->live FileAST shares
// one id space (the discipline collect-hoisted.js + translate-stmt.js document
// in their headers).

import { parseMarkupTrace } from "./parse-markup.js";
import { collectHoisted } from "./collect-hoisted.js";
import { translateStmtList } from "./translate-stmt.js";

// =============================================================================
// nativeParseFile — the C1 entry point. Parse `source` with the native parser,
// assemble the live `FileAST`, and return `{ filePath, ast, errors }` — the
// drop-in analogue of `buildAST`'s output.
//
//   filePath — the absolute source path (threaded onto the FileAST verbatim).
//   source   — the scrml source text.
//
// Returns `{ filePath, ast: FileAST, errors }`. `errors` collects the native
// parser's diagnostics plus any synthesis-side info diagnostics (a dropped
// non-mappable BlockKind). Defensive: a non-string `source` folds to an empty
// FileAST with no nodes.
// =============================================================================
export function nativeParseFile(filePath, source) {
    const safeSource = typeof source === "string" ? source : "";
    const safePath = typeof filePath === "string" ? filePath : "";

    // ONE shared id allocator for the whole compilation unit. `stampId` is
    // `++counter.next` — the live ast-builder discipline (ast-builder.js
    // L11991). Threaded through collectHoisted + every translateStmtList call
    // + every directly-synthesized node so ids are globally unique in the file.
    const idGen = { next: 0 };

    // The diagnostic accumulator — the native parser's parse errors plus any
    // synthesis-side info diagnostics. Returned as the result `errors` array.
    const errors = [];

    // 1. PARSE — drive the native parser. `parseMarkupTrace` returns the full
    //    run record `{ ctx, contextTrace }`; `parseMarkup` returns only the
    //    block-stream. The trace form is used so the run's `ctx.diagnostics`
    //    (the native parse-error stream) is reachable — a plain `parseMarkup`
    //    call would discard it.
    const run = parseMarkupTrace(safeSource);
    const ctx = (run !== undefined && run !== null) ? run.ctx : null;
    const blocks = (ctx !== undefined && ctx !== null && Array.isArray(ctx.nodes))
        ? ctx.nodes
        : [];

    // 1a. Collect the native parser's diagnostics. `ctx.diagnostics` is
    //     lazily-created (tag-frame.js `ensureDiagnostics`) — it is `undefined`
    //     on a clean parse. Each diagnostic is `{ code, message, span }`.
    if (ctx !== undefined && ctx !== null && Array.isArray(ctx.diagnostics)) {
        for (const diag of ctx.diagnostics) {
            if (diag !== undefined && diag !== null) {
                errors.push(diag);
            }
        }
    }

    // 2. MAP BlockKinds -> ast.nodes. Translate each native block into its
    //    live ASTNode. A `LogicEscape` / `Meta` block's native `Stmt[]` body
    //    runs through the A1 bridge; a non-mappable BlockKind is dropped with
    //    an info diagnostic.
    const nodes = mapBlocksToNodes(blocks, idGen, safeSource, errors);

    // 3. ASSEMBLE the hoisted collections — the A3 bridge. `collectHoisted`
    //    folds the native block-stream into the seven file-level outputs,
    //    sharing the same `idGen` so synthesized declaration nodes draw from
    //    the one id space. `source` is threaded so a synthesized engine's
    //    `rulesRaw` can be sliced.
    const hoisted = collectHoisted(blocks, idGen, safeSource);

    // 4. PRODUCE the FileAST. The shape is the live `buildAST` literal
    //    (ast-builder.js L12408) plus `authConfig` / `middlewareConfig` set to
    //    `null` — PRECG (Stage 3.004) derives those + the PGO `has*` flags
    //    pipeline-agnostically downstream (the FileAST interface declares them
    //    non-optional, so they are present-as-null here, not omitted).
    const ast = {
        filePath: safePath,
        nodes,
        imports: hoisted.imports,
        exports: hoisted.exports,
        components: hoisted.components,
        typeDecls: hoisted.typeDecls,
        machineDecls: hoisted.machineDecls,
        channelDecls: hoisted.channelDecls,
        hasProgramRoot: hoisted.hasProgramRoot,
        authConfig: null,
        middlewareConfig: null,
    };

    return { filePath: safePath, ast, errors };
}

// =============================================================================
// mapBlocksToNodes — calculation (pure-ish; appends to the shared `errors`).
// Translate a native `Block[]` into the live `ASTNode[]`. Each block is mapped
// by `mapOneBlock`; a block that maps to nothing (a dropped Test / ForeignCode
// block) contributes no node.
// =============================================================================
function mapBlocksToNodes(blocks, idGen, source, errors) {
    const out = [];
    if (Array.isArray(blocks) === false) return out;
    for (const block of blocks) {
        if (block === undefined || block === null) continue;
        const node = mapOneBlock(block, idGen, source, errors);
        if (node !== null) out.push(node);
    }
    return out;
}

// mapOneBlock — calculation. Translate ONE native block into its live ASTNode,
// or `null` when the BlockKind has no live ASTNode (Test / ForeignCode — the
// drop is logged onto `errors`). The id allocator stamps every synthesized
// node.
function mapOneBlock(block, idGen, source, errors) {
    const kind = block.kind;

    if (kind === "Markup") {
        return synthMarkupNode(block, idGen, source, errors);
    }
    if (kind === "Text") {
        return synthTextNode(block, idGen, source);
    }
    if (kind === "DisplayTextLiteral") {
        // No live top-level `DisplayTextLiteral` ASTNode — map it to a `text`
        // node carrying the verbatim literal source. The §4.18.4 segments/
        // exprs payload is preserved on the block (`block.literal`) for a
        // downstream escape pass; the assembler emits the faithful text form.
        return synthTextNode(block, idGen, source);
    }
    if (kind === "Comment") {
        return synthCommentNode(block, idGen, source);
    }
    if (kind === "Sql") {
        return synthSqlNode(block, idGen);
    }
    if (kind === "Css") {
        return synthCssNode(block, idGen);
    }
    if (kind === "Meta") {
        return synthMetaNode(block, idGen);
    }
    if (kind === "ErrorEffect") {
        return synthErrorEffectNode(block, idGen);
    }
    if (kind === "LogicEscape") {
        return synthLogicNode(block, idGen);
    }
    if (kind === "Test" || kind === "ForeignCode") {
        // No live ASTNode kind — the live pipeline strips test blocks before
        // codegen and has no foreign-code node. Drop the block; log an info
        // diagnostic so the disposition is observable.
        errors.push({
            code: "I-NATIVE-BLOCK-DROPPED",
            message: "I-NATIVE-BLOCK-DROPPED: native block kind \"" + kind
                + "\" has no live ASTNode and was dropped from FileAST.nodes.",
            span: block.span !== undefined ? block.span : null,
            severity: "info",
        });
        return null;
    }

    // An unrecognized BlockKind — surface it, do not silently drop.
    errors.push({
        code: "I-NATIVE-BLOCK-UNMAPPED",
        message: "I-NATIVE-BLOCK-UNMAPPED: native block kind \"" + String(kind)
            + "\" is not in the BlockKind->ASTNode map and was dropped.",
        span: block.span !== undefined ? block.span : null,
        severity: "info",
    });
    return null;
}

// =============================================================================
// Per-kind ASTNode synthesizers — calculations (pure data builders).
// =============================================================================

// synthMarkupNode — SYNTHESIZE a live `MarkupNode` (ast.ts:214) from a native
// `Markup` block. The native block carries `name` / `children` (Block[]) /
// `attrs` (AttrNode[]) / `closerForm` / `tagClass` / `tagKind`. The live node
// needs `tag` / `attrs` / `children` (recursively mapped ASTNodes) /
// `selfClosing` / `closerForm` / `isComponent`.
//   - `tag`         — the native `name`.
//   - `children`    — recurse `mapBlocksToNodes` over `block.children`.
//   - `selfClosing` — true iff the native block has no closer form (a
//                     self-closing `<br/>` element emits `closerForm: null`;
//                     a paired element emits a non-null closer form).
//   - `isComponent` — the live ast-builder gate: an UPPERCASE-initial tag name
//                     is a component call site (ast-builder.js L2993).
function synthMarkupNode(block, idGen, source, errors) {
    const tag = typeof block.name === "string" ? block.name : "";
    const children = mapBlocksToNodes(block.children, idGen, source, errors);
    const closerForm = (block.closerForm !== undefined && block.closerForm !== null)
        ? block.closerForm
        : "";
    return {
        id: stampId(idGen),
        kind: "markup",
        tag,
        attrs: Array.isArray(block.attrs) ? block.attrs : [],
        children,
        selfClosing: block.closerForm === undefined || block.closerForm === null,
        closerForm,
        isComponent: isUpperInitial(tag),
        span: block.span !== undefined ? block.span : null,
    };
}

// synthTextNode — SYNTHESIZE a live `TextNode` (ast.ts:249) from a native
// `Text` (or `DisplayTextLiteral`) block. The native Text block carries a span
// but no text payload; the `value` is sliced verbatim out of `source` via the
// span (the live `text` node's `value` is the raw block text — ast-builder.js
// L10504). An out-of-range span folds to "".
function synthTextNode(block, idGen, source) {
    return {
        id: stampId(idGen),
        kind: "text",
        value: sliceSpan(source, block.span),
        span: block.span !== undefined ? block.span : null,
    };
}

// synthCommentNode — SYNTHESIZE a live `CommentNode` (ast.ts:256) from a native
// `Comment` block. As with `text`, the native Comment block carries only a
// span; `value` is the verbatim source slice (the live `comment` node's
// `value` is `block.raw` — the whole comment including delimiters —
// ast-builder.js L10513).
function synthCommentNode(block, idGen, source) {
    return {
        id: stampId(idGen),
        kind: "comment",
        value: sliceSpan(source, block.span),
        span: block.span !== undefined ? block.span : null,
    };
}

// synthSqlNode — SYNTHESIZE a live `SQLNode` (ast.ts:311) from a native `Sql`
// block. The native block already carries `query` (string) + `chainedCalls`
// ({ method, args }[]) — the F7.b shaper produced the live payload shape
// directly. The synthesizer adds the live `kind` tag + the BaseNode `id`.
function synthSqlNode(block, idGen) {
    return {
        id: stampId(idGen),
        kind: "sql",
        query: typeof block.query === "string" ? block.query : "",
        chainedCalls: Array.isArray(block.chainedCalls) ? block.chainedCalls : [],
        span: block.span !== undefined ? block.span : null,
    };
}

// synthCssNode — SYNTHESIZE a live `CSSInlineNode` (ast.ts:330) from a native
// `Css` block. The native block carries `rules` (CSSRule[]) — the F7.c shaper
// produced the live payload directly.
function synthCssNode(block, idGen) {
    return {
        id: stampId(idGen),
        kind: "css-inline",
        rules: Array.isArray(block.rules) ? block.rules : [],
        span: block.span !== undefined ? block.span : null,
    };
}

// synthMetaNode — SYNTHESIZE a live `MetaNode` (ast.ts:359) from a native
// `Meta` block. F8 — the native Meta block carries a parsed native `Stmt[]`
// body (the SAME catalog a LogicEscape body carries); the A1 bridge
// `translateStmtList` translates it to the live `LogicStatement[]`. The native
// block also carries `parentContext` ("markup" — the F8 default).
function synthMetaNode(block, idGen) {
    return {
        id: stampId(idGen),
        kind: "meta",
        body: translateStmtList(block.body, idGen),
        parentContext: typeof block.parentContext === "string"
            ? block.parentContext
            : "markup",
        span: block.span !== undefined ? block.span : null,
    };
}

// synthErrorEffectNode — SYNTHESIZE a live `ErrorEffectNode` (ast.ts:350) from
// a native `ErrorEffect` block. The native block carries `arms` (ErrorArm[]) —
// the F8 shaper produced the live payload directly.
function synthErrorEffectNode(block, idGen) {
    return {
        id: stampId(idGen),
        kind: "error-effect",
        arms: Array.isArray(block.arms) ? block.arms : [],
        span: block.span !== undefined ? block.span : null,
    };
}

// synthLogicNode — SYNTHESIZE a live `LogicNode` (ast.ts:294) from a native
// `LogicEscape` block. The native block carries a parsed native `Stmt[]` body;
// the A1 bridge `translateStmtList` translates it to the live
// `LogicStatement[]`.
//
// The live `LogicNode` ALSO carries pre-filtered `imports` / `exports` /
// `typeDecls` / `components` arrays — the live ast-builder pre-filters them
// onto the node and `collectHoisted` spreads them up. In the native pipeline
// the file-level hoist is done by A3's `collectHoisted` folding directly over
// the BLOCK stream (not the translated nodes) — so the per-node hoist arrays
// would be redundant double-counting if populated here. They are set to empty
// arrays: the live `LogicNode` interface requires the four fields, but the
// authoritative file-level collections live on the FileAST (assembled in step
// 3), and no downstream stage re-derives the file hoist from `logic.imports`
// (collectHoisted is the single source). Leaving them empty keeps the node
// interface-complete without duplicating the hoist.
function synthLogicNode(block, idGen) {
    return {
        id: stampId(idGen),
        kind: "logic",
        body: translateStmtList(block.body, idGen),
        imports: [],
        exports: [],
        typeDecls: [],
        components: [],
        span: block.span !== undefined ? block.span : null,
    };
}

// =============================================================================
// Helpers — calculations (pure).
// =============================================================================

// stampId — the id allocator. `++counter.next` — the live ast-builder
// discipline (ast-builder.js L11991). Mutates the shared counter.
function stampId(idGen) {
    idGen.next = idGen.next + 1;
    return idGen.next;
}

// sliceSpan — the verbatim source slice for a span, or "" when `source` is
// unavailable or the span is out of range. The native Text / Comment blocks
// carry spans but no text payload; their live `value` is recovered here.
function sliceSpan(source, span) {
    if (typeof source !== "string") return "";
    if (span === undefined || span === null) return "";
    const start = span.start;
    const end = span.end;
    if (typeof start !== "number" || typeof end !== "number") return "";
    if (start < 0 || end > source.length || start > end) return "";
    return source.slice(start, end);
}

// isUpperInitial — predicate. True iff `name`'s first character is an ASCII
// uppercase letter (the live component-call gate — ast-builder.js L2993
// `/^[A-Z]/`).
function isUpperInitial(name) {
    if (typeof name !== "string" || name.length === 0) return false;
    const code = name.charCodeAt(0);
    return code >= 65 && code <= 90;
}
