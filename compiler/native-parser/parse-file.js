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

import { parseMarkupTrace, liftBareBlocks } from "./parse-markup.js";
import { collectHoisted, isEngineBlock, synthEngineDecl } from "./collect-hoisted.js";
import { translateStmtList } from "./translate-stmt.js";
import { isStateBlock } from "./parse-state-body.js";

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
    const rawBlocks = (ctx !== undefined && ctx !== null && Array.isArray(ctx.nodes))
        ? ctx.nodes
        : [];

    // 1b. LIFT bare-declaration Text blocks (P4-2 — the bare-markup-statement
    //     segmentation fix). The native markup trampoline accumulates a bare
    //     `type` / `export` / `import` / `fn` / `~`-decl line sitting directly
    //     inside a `<program>` / `<page>` / `<channel>` body (or at file top
    //     level) into a plain `Text` block; the LIVE pipeline's
    //     `liftBareDeclarations` post-pass converts such a text block into a
    //     synthetic `logic` block so the hoisted `typeDecls` / `exports` /
    //     `imports` see the decls. `liftBareBlocks` is the native analogue —
    //     it runs over the block stream BEFORE both `mapBlocksToNodes` (so the
    //     lifted block maps to a `logic` ASTNode) AND `collectHoisted` (so its
    //     parsed body is walked for hoistable decls). `parentType` is `null`
    //     at file top level (a declaration site); the recursion propagates
    //     "state" / "markup" exactly as the live oracle does. `ctx` is
    //     threaded so a lifted logic body's diagnostics route into
    //     `ctx.diagnostics` — collected by step 1a below (the lift runs
    //     BEFORE the collection so a lifted-body diagnostic is not missed).
    const blocks = liftBareBlocks(rawBlocks, safeSource, null, ctx);

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
    const mapped = mapBlocksToNodes(blocks, idGen, safeSource, errors);

    // 2a. §17.1.1 — COLLAPSE if=/else-if=/else sibling chains into `if-chain`
    //     ASTNodes. The live pipeline runs `collapseIfChains` as a post-pass
    //     over the assembled `nodes` (ast-builder.js L12005); the native
    //     assembler mirrors it here. Purely additive — a node-array that
    //     carries no if-chains passes through unchanged.
    const nodes = collapseIfChainNodes(mapped, errors);

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

    if (kind === "Markup" && isStateBlock(block)) {
        // A state block — either a `< Ident ...>` state opener
        // (TagKind.StateOpener — §4.3 space-after-`<`) OR a no-space
        // `<db>` / `<schema>` lifecycle-keyword element (the live
        // `_STATE_FORM_LIFECYCLE` name-set). The markup layer's
        // `shapeStateBlock` already stamped the live state payload
        // (`stateNodeKind` / `stateType` / `typedAttrs`) onto the block at
        // parse time — `emitMarkupElement` runs it for either recognition
        // path — so route the block to the live `state` /
        // `state-constructor-def` ASTNode rather than `markup`. This is
        // depth-agnostic: a `<db>` nested inside a `<program>` body
        // synthesizes a `state` node identically to a top-level one.
        return synthStateNode(block, idGen, source, errors);
    }
    if (kind === "Markup" && isEngineBlock(block)) {
        // M5 gap-ledger DIFF-engine-in-nodes. The native parser models an
        // `<engine ...>` / `<machine ...>` element as a plain `Markup`
        // block. The LIVE pipeline emits an `engine-decl` ASTNode in
        // `FileAST.nodes` (ast-builder.js `buildBlock` L11099) AND ALSO
        // pushes it into `machineDecls` (ast-builder.js L11930). A3's
        // `collectHoisted` already mirrors the `machineDecls` side; this
        // branch mirrors the `nodes` side — route an engine block to a
        // live-parity `engine-decl` ASTNode rather than `markup`. (The
        // `machineDecls` count stays equal: both pipelines carry the
        // engine in `machineDecls` exactly once — A3 there, the live
        // file-level pass here. No double-count.)
        return synthEngineNode(block, idGen, source);
    }
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

// synthStateNode — SYNTHESIZE a live `StateNode` (ast.ts:265) or
// `StateConstructorDefNode` (ast.ts:279) from a native `Markup` block the
// markup layer classified as a state opener (TagKind.StateOpener — §4.3).
// The shaping already ran: parse-markup.js's `shapeStateBlock` stamped
// `block.stateNodeKind` ("state" | "state-constructor-def"),
// `block.stateType` (the opener name), and `block.typedAttrs`
// (TypedAttrDecl[] — non-empty only for a `state-constructor-def`, §35.2).
// This synthesizer is the C1-assembler counterpart of the live builder's
// `case "state"` arm (ast-builder.js L11302 / L11317).
//   - `kind`        — `block.stateNodeKind`; `state` for a state
//                     INSTANTIATION, `state-constructor-def` for a state
//                     TYPE declaration carrying `name(type)` typed decls.
//   - `stateType`   — `block.stateType` (the opener name).
//   - `attrs`       — the native AttrNode[] (`block.attrs` — the F1 layer
//                     already excludes the typed decls; the live `state`
//                     node's `attrs` is exactly the non-typed attrs).
//   - `typedAttrs`  — emitted ONLY for `state-constructor-def` (the live
//                     `StateConstructorDefNode` field; `StateNode` has no
//                     `typedAttrs`).
//   - `children`    — recurse `mapBlocksToNodes` over `block.children`
//                     (verbatim — the same recursion `synthMarkupNode`
//                     uses; a nested `<state>` child re-synthesizes here).
//   - `openerHadSpaceAfterLt` — the live builder stamps this on both state
//                     literals. A state opener is BY DEFINITION the
//                     space-after-`<` form, so it is always true; derived
//                     `block.tagKind === "StateOpener"` (the collect-hoisted
//                     `synthEngineDecl` precedent — collect-hoisted.js L356).
//
// SCOPE — this is the SHALLOW synth (the M5 gap-ledger flip). The live
// builder ALSO runs `collapseTransitionDecls` (§54.3 — folds `text + logic`
// child pairs into `transition-decl` nodes) and stamps substate metadata
// (`isSubstate` / `parentState`, §54.2). Neither is done here: the corpus
// canary diffs only the top-level node-kind sequence + hoist counts +
// `hasProgramRoot`, and `state` / `state-constructor-def` is the top kind
// regardless of child shaping. Deep fidelity is a tracked follow-up needed
// before `--parser=scrml-native` drives codegen.
function synthStateNode(block, idGen, source, errors) {
    const stateNodeKind = block.stateNodeKind === "state-constructor-def"
        ? "state-constructor-def"
        : "state";
    const children = mapBlocksToNodes(block.children, idGen, source, errors);
    const node = {
        id: stampId(idGen),
        kind: stateNodeKind,
        stateType: typeof block.stateType === "string" ? block.stateType : "",
        attrs: Array.isArray(block.attrs) ? block.attrs : [],
        children,
        openerHadSpaceAfterLt: block.tagKind === "StateOpener",
        span: block.span !== undefined ? block.span : null,
    };
    // §35.2 — `typedAttrs` is a `state-constructor-def`-only field. The live
    // `StateNode` interface (ast.ts:265) has no `typedAttrs`; only the
    // `StateConstructorDefNode` literal (ast-builder.js L11308) carries it.
    if (stateNodeKind === "state-constructor-def") {
        node.typedAttrs = Array.isArray(block.typedAttrs) ? block.typedAttrs : [];
    }
    return node;
}

// synthEngineNode — SYNTHESIZE a live `EngineDeclNode` (ast.ts:878) from a
// native `Markup` block named "engine" / "machine", for placement in
// `FileAST.nodes`. M5 gap-ledger DIFF-engine-in-nodes.
//
// The 14-field `EngineDeclNode` derivation (governedType / varName /
// rulesRaw / ...) is A3's — `synthEngineDecl` in collect-hoisted.js. This
// is a thin wrapper that REUSES it (not a re-implementation): A3 already
// owns the attribute-read field derivation and the §51.0.C varName-
// resolution rule. The wrapper adapts the id allocator — `synthEngineDecl`
// takes a zero-arg `stamp()`, `parse-file.js`'s allocator is
// `stampId(idGen)` — and threads `source` so the engine's `rulesRaw` body
// slice is recoverable.
//
// The same engine block is ALSO walked by A3's `collectHoisted` into
// `machineDecls` (an independent `synthEngineDecl` call). Two synthesized
// nodes for one engine is intentional and matches the live pipeline: the
// live `buildBlock` emits the `engine-decl` into `nodes`, and the live
// file-level pass (ast-builder.js L11930) ALSO pushes that node into
// `machineDecls`. The ids differ between the `nodes` copy and the
// `machineDecls` copy here (two `stampId` draws) — the canary counts
// nodes, never compares ids, so this is faithful for the ledger flip. A
// deep follow-up could share ONE node instance across both collections.
function synthEngineNode(block, idGen, source) {
    return synthEngineDecl(block, () => stampId(idGen), source);
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
// §17.1.1 — if=/else-if=/else chain collapse.
//
// The C1-assembler counterpart of the live `collapseIfChains`
// (ast-builder.js L11673). The live pipeline runs this as a post-pass over
// the assembled `nodes`: it scans each sibling array for the maximal
// contiguous run of `if=` / `else-if=` / `else` conditional-attributed
// `markup` siblings (intervening whitespace-only `text` nodes do NOT break
// the chain — SPEC §17.1.1) and folds the run into ONE `if-chain` ASTNode.
//
// THE ORACLE — ast-builder.js `collapseIfChains`. This mirror reproduces it
// arm-for-arm:
//   - recurse FIRST into every node's `children` / `body` array (an
//     if-chain can be nested inside markup or a logic block);
//   - E-CTRL-005 — `else` / `else-if=` on the SAME element as `if=`;
//   - E-CTRL-001 — orphan `else` (no preceding `if=` at the same level);
//   - E-CTRL-002 — orphan `else-if=`;
//   - E-CTRL-004 — `else` / `else-if=` on a state opener;
//   - E-CTRL-003 — an element extending a chain that already ended `else`;
//   - a lone `if=` with no `else-if=` / `else` continuation is NOT
//     collapsed — it passes through as the raw `markup` node (live L11801).
//
// THE `if-chain` NODE SHAPE — the live `IfChainExpr` literal
// (ast-builder.js L11808): `{ id, kind: "if-chain", branches, elseBranch,
// span }`. `id` / `span` are REUSED from the chain-opening `if=` node (no
// fresh `stampId` — the live builder reuses `node.id` / `node.span`).
// `branches` is `{ condition, element }[]` — `condition` is the attr value
// object (`if=` / `else-if=`), `element` is the member `markup` node.
// `elseBranch` is the terminal `else` markup node or `null`.
//
// ERROR SHAPE — the live builder pushes `TABError`s; the native assembler's
// diagnostic stream is the plain `{ code, message, span }` shape
// (`makeDiagnostic`, tag-frame.js L1848). These E-CTRL diagnostics are hard
// parse errors per SPEC §34.1 — no `severity` field, so they partition into
// `result.errors` exactly like every other native parse diagnostic.
// =============================================================================

// collapseIfChainNodes — calculation (appends E-CTRL diagnostics to the
// shared `errors`). Scan a sibling `ASTNode[]` for if-chains, recurse into
// children/body, and return the rewritten array.
function collapseIfChainNodes(nodes, errors) {
    if (Array.isArray(nodes) === false) return nodes;

    // Recurse FIRST into every node's child containers — an if-chain may be
    // nested inside a markup element's `children` or a logic block's `body`.
    for (const node of nodes) {
        if (node === undefined || node === null) continue;
        if (Array.isArray(node.children)) {
            node.children = collapseIfChainNodes(node.children, errors);
        }
        if (Array.isArray(node.body)) {
            node.body = collapseIfChainNodes(node.body, errors);
        }
    }

    // Scan THIS level for chains.
    const result = [];
    let i = 0;

    while (i < nodes.length) {
        const node = nodes[i];

        // E-CTRL-005 — `else` / `else-if=` on the same element as `if=`.
        if (isMarkupNode(node) && hasNodeAttr(node, "if")
            && (hasNodeAttr(node, "else") || hasNodeAttr(node, "else-if"))) {
            errors.push({
                code: "E-CTRL-005",
                message: "E-CTRL-005: `else` or `else-if=` and `if=` cannot "
                    + "appear on the same element.",
                span: nodeSpan(node),
            });
            result.push(node);
            i = i + 1;
            continue;
        }

        // E-CTRL-001 / E-CTRL-002 — orphan `else` / `else-if=` (no `if=`).
        if (isMarkupNode(node) && hasNodeAttr(node, "if") === false) {
            if (hasNodeAttr(node, "else")) {
                const span = nodeSpan(node);
                errors.push({
                    code: "E-CTRL-001",
                    message: "E-CTRL-001: `else` on line " + spanLine(span)
                        + " has no preceding `if=` element at the same level.",
                    span,
                });
                result.push(node);
                i = i + 1;
                continue;
            }
            if (hasNodeAttr(node, "else-if")) {
                const span = nodeSpan(node);
                errors.push({
                    code: "E-CTRL-002",
                    message: "E-CTRL-002: `else-if=` on line " + spanLine(span)
                        + " has no preceding `if=` element at the same level.",
                    span,
                });
                result.push(node);
                i = i + 1;
                continue;
            }
        }

        // Not an `if=` element — pass through.
        if (isMarkupNode(node) === false || hasNodeAttr(node, "if") === false) {
            result.push(node);
            i = i + 1;
            continue;
        }

        // Found `if=` — start building a chain.
        const ifAttr = getNodeAttr(node, "if");
        const branches = [{ condition: ifAttr.value, element: node }];
        let elseBranch = null;
        let j = i + 1;

        while (j < nodes.length) {
            // Whitespace-only `text` siblings do not break a chain (§17.1.1).
            if (isWhitespaceTextNode(nodes[j])) {
                j = j + 1;
                continue;
            }

            const sibling = nodes[j];

            // E-CTRL-004 — `else` / `else-if=` on a state opener. A state
            // node carries `else` / `else-if=` in its `attrs` exactly as a
            // markup node would; check before the markup-kind gate below.
            if ((sibling.kind === "state"
                    || sibling.kind === "state-constructor-def")
                && (hasNodeAttr(sibling, "else")
                    || hasNodeAttr(sibling, "else-if"))) {
                errors.push({
                    code: "E-CTRL-004",
                    message: "E-CTRL-004: `else` or `else-if=` cannot appear "
                        + "on a state object opener.",
                    span: nodeSpan(sibling),
                });
                break;
            }

            if (isMarkupNode(sibling) === false) break;

            if (hasNodeAttr(sibling, "else-if")) {
                if (elseBranch !== null) {
                    // E-CTRL-003 — extending a chain past a terminal `else`.
                    const span = nodeSpan(sibling);
                    errors.push({
                        code: "E-CTRL-003",
                        message: "E-CTRL-003: The element on line "
                            + spanLine(span) + " tries to extend a chain "
                            + "that already ended with `else`.",
                        span,
                    });
                    break;
                }
                const elseIfAttr = getNodeAttr(sibling, "else-if");
                branches.push({ condition: elseIfAttr.value, element: sibling });
                j = j + 1;
                continue;
            }

            if (hasNodeAttr(sibling, "else")) {
                if (elseBranch !== null) {
                    // E-CTRL-003 — a second `else` extends past the terminal.
                    const span = nodeSpan(sibling);
                    errors.push({
                        code: "E-CTRL-003",
                        message: "E-CTRL-003: The element on line "
                            + spanLine(span) + " tries to extend a chain "
                            + "that already ended with `else`.",
                        span,
                    });
                    break;
                }
                elseBranch = sibling;
                j = j + 1;
                continue;
            }

            // A markup sibling carrying none of if=/else-if=/else — the
            // chain ends here.
            break;
        }

        // A lone `if=` with no continuation is NOT a chain — the live
        // builder passes the raw `markup` node through (L11801).
        if (branches.length === 1 && elseBranch === null) {
            result.push(node);
            i = i + 1;
            continue;
        }

        // Fold the run into one `if-chain` ASTNode. `id` / `span` are
        // REUSED from the chain-opening `if=` node — the live builder does
        // not draw a fresh id (ast-builder.js L11808-L11814).
        result.push({
            id: node.id,
            kind: "if-chain",
            branches,
            elseBranch,
            span: node.span !== undefined ? node.span : null,
        });

        // The chain consumed every node up to `j` — including the
        // whitespace `text` siblings skipped between members.
        i = j;
    }

    return result;
}

// isMarkupNode — predicate. True iff the node is a `markup` ASTNode (the
// only kind that can open or continue an if-chain — a state opener is
// handled separately for E-CTRL-004).
function isMarkupNode(node) {
    return node !== undefined && node !== null && node.kind === "markup";
}

// isWhitespaceTextNode — predicate. True iff the node is a `text` ASTNode
// whose value is empty or whitespace-only. Mirrors the live
// `isWhitespaceText` (ast-builder.js L11653) — such nodes do NOT break an
// if-chain.
function isWhitespaceTextNode(node) {
    if (node === undefined || node === null) return false;
    if (node.kind !== "text") return false;
    const value = node.value;
    if (typeof value !== "string" || value.length === 0) return true;
    return value.trim().length === 0;
}

// getNodeAttr — calculation. Return the named attribute record
// (`{ name, value, span }`) from a markup-or-state node's `attrs` array, or
// `null` when absent. Mirrors the live `getAttr` (ast-builder.js L11658).
function getNodeAttr(node, name) {
    if (node === undefined || node === null) return null;
    const attrs = Array.isArray(node.attrs) ? node.attrs : [];
    for (const attr of attrs) {
        if (attr !== undefined && attr !== null && attr.name === name) {
            return attr;
        }
    }
    return null;
}

// hasNodeAttr — predicate. True iff the node carries the named attribute.
// Mirrors the live `hasAttr` (ast-builder.js L11665).
function hasNodeAttr(node, name) {
    return getNodeAttr(node, name) !== null;
}

// nodeSpan — calculation. The node's `span`, or a `{ line: 0, col: 0 }`
// fallback (the live builder's `node.span ?? { line: 0, col: 0 }` shape).
function nodeSpan(node) {
    if (node !== undefined && node !== null
        && node.span !== undefined && node.span !== null) {
        return node.span;
    }
    return { line: 0, col: 0 };
}

// spanLine — calculation. The 1-based source line of a span, or 0 when the
// span carries no line (the live error messages interpolate `span.line`).
function spanLine(span) {
    if (span !== undefined && span !== null && typeof span.line === "number") {
        return span.line;
    }
    return 0;
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
