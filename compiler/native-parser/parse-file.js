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

    // 5. NORMALIZE — M6.5.b.5 (Class F shape) + M6.5.b.6 (Class G span.file).
    //    Single boundary normalizer (SCOPING §4 Decision A) over the assembled
    //    FileAST: stamps `span.file`, lowercases `closerForm`, defaults
    //    `openerHadSpaceAfterLt` / `_p3a*` on markup nodes, and strips the
    //    native-only `attrs[].value.sourceText` from translated markup-family
    //    node attrs (via clone — the raw native blocks the engine walker reads
    //    keep it). Native-path-only; cannot affect the live default.
    normalizeNativeFileAST(ast, safePath);

    return { filePath: safePath, ast, errors };
}

// =============================================================================
// mapBlocksToNodesForBridge — calculation. The PUBLIC entry point through
// which translate-stmt.js's M6.2a `translateMarkupValueToLiveNode` bridge
// recursively converts a markup-as-value subtree's children. Same surface as
// `mapBlocksToNodes` (the file-internal helper); exported under a distinct
// name to keep the bridge call-site self-documenting and the existing module
// API undisturbed. The bridge passes `source = ""` (it has no source
// available — the lift-expr lives inside a logic body whose own source slice
// is owned by the JS-host expression layer, not the markup-block stream).
// =============================================================================
export function mapBlocksToNodesForBridge(blocks, idGen, source, errors) {
    return mapBlocksToNodes(blocks, idGen, source, errors);
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

    if (kind === "Markup" && isMatchBlock(block)) {
        // Match block-form (SPEC §18.0.1, P5-7 / S121 Wave 9 Unit J — closes
        // the final DIFF-deep-seq residual). A `<match for=Type [on=expr]> ...
        // </>` element is the Tier 1 case-analysis container (§17.0 ladder).
        // The LIVE pipeline routes it to a dedicated `match-block` ASTNode
        // (ast-builder.js L10688-L10697); native must mirror that placement.
        //
        // Routed BEFORE the state-block check so a `< match>` opener (space
        // after `<` — TagKind.StateOpener) is not mis-claimed by the state
        // path. Both `<match>` (ScrmlStructural) and `< match>` (StateOpener)
        // resolve here.
        return synthMatchBlockNode(block, idGen, source);
    }
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
    // M6.5.b.5 (Class F) — `openerHadSpaceAfterLt` + the P3a re-export markers
    // are NOT stamped at this synth site. Live stamps them in `buildBlock`
    // (ast-builder.js L11036/L11040-41) for BLOCK-PATH markup ONLY; live OMITS
    // them on lift/match/for-expr markup-as-value SUBTREES (verified: 361 of 361
    // field-less live markup nodes are under an expr/node/exprNode ancestor, 0
    // outside). `synthMarkupNode` is reached on BOTH paths (the top-level block
    // tree AND, via `mapBlocksToNodesForBridge`, a lift-expr markup subtree), so
    // stamping here would over-stamp the subtree case. The context-aware stamp
    // lives in `normalizeNativeFileAST` (it tracks the expr-context ancestor and
    // stamps only block-path markup) — the faithful single-locus home.
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

// =============================================================================
// MATCH BLOCK — SPEC §18.0.1 (P5-7 / Wave 9 Unit J, S121).
//
// A `<match for=Type [on=expr]> ... </>` element is the Tier 1 case-analysis
// container of the §17.0 ladder. The LIVE pipeline emits it as a dedicated
// `match-block` ASTNode (ast-builder.js L10688-L10697); native must mirror
// that placement to close the final DIFF-deep-seq residual.
//
// THE LIVE SHAPE — `match-block` carries:
//   { id, kind: "match-block", forType, onExprRaw, armsRaw, bodyChildren,
//     span, openerHadSpaceAfterLt }
// NO `children` field — the canary's `nodeKindSequence` walks `children` only,
// so `match-block` is a LEAF in the deep walk (the arm bodies are reachable
// via `bodyChildren` but not visible to the canary).
//
//   forType                — REQUIRED bareword type name (the `for=Type`
//                            attribute). Empty string when absent (a parse-
//                            time gap surfaced by SYM PASS downstream).
//   onExprRaw              — the `on=expr` attribute value text, or `null`
//                            when absent (SPEC §18.0.1 auto-implies on= from a
//                            scoped `<engine for=Type>`).
//   armsRaw                — the body text after the opener line, before the
//                            closer. Phase 2 `match-statechild-parser` re-
//                            tokenizes this into MatchArmEntry[].
//   bodyChildren           — the walkable arm-body block array (the native
//                            children, preserved verbatim). Mirrors live's
//                            `bodyChildren` field (engine-decl precedent).
//                            ADDITIVE field; deep walk does not see it.
//   openerHadSpaceAfterLt  — true iff the opener was `< match` (a TagKind
//                            StateOpener). Mirrors live's stamp.
//
// DISCRIMINATOR — `block.name === "match"`. The `<engine>` block has
// `block.name === "engine"` — distinct, no collision. The `for=` attribute is
// shared between match and engine but the tag name is the authoritative gate.
// =============================================================================

// isMatchBlock — calculation (predicate). True iff `block` is a native `Markup`
// block named "match" — i.e. a `<match ...>` / `< match ...>` element. The
// `<match>` element is the SPEC §18.0.1 block-form Tier 1 case-analysis
// container; routed to `match-block` ASTNode in `mapOneBlock`.
function isMatchBlock(block) {
    if (block === undefined || block === null) return false;
    if (block.kind !== "Markup") return false;
    return block.name === "match";
}

// synthMatchBlockNode — SYNTHESIZE a live `MatchBlockNode` (ast-builder.js
// L10688) from a native `Markup` block named "match". The native attrs already
// carry `for=` and `on=` as parsed AttrNode values; bodyChildren is the native
// children array (preserved verbatim for downstream walking).
function synthMatchBlockNode(block, idGen, source) {
    const attrs = Array.isArray(block.attrs) ? block.attrs : [];

    // forType — the `for=Type` bareword. Native attribute tokenizer admits
    // `for=Phase` as a `variable-ref` value (value.name === "Phase"); the
    // quoted form `for="Phase"` lands as `string-literal` (value.value ===
    // "Phase"). Recover the bare identifier from either shape; "" when the
    // attribute is missing or unrecoverable (a parse-time gap surfaced
    // downstream by SYM PASS — §18.0.1 REQUIRES `for=`).
    const forType = readForType(attrs);

    // onExprRaw — the `on=expr` attribute value text. The native attr value
    // already carries a `span`; slice the source verbatim to capture the
    // author's expression in its original syntactic form. `null` when `on=`
    // is absent (per §18.0.1 the `on=` attribute is OPTIONAL — auto-implied
    // when a scoped `<engine for=Type>` is in scope).
    const onExprRaw = readOnExprRaw(attrs, source);

    // armsRaw — the body text between the opener-end and the closer. Use the
    // first-child / last-child spans to bracket the body range. When the
    // block has no children (an empty body), armsRaw is "".
    const armsRaw = collectArmsRaw(block, source);

    // bodyChildren — the native children array, preserved verbatim. Mirrors
    // live's `bodyChildren` field (the engine-decl precedent). ADDITIVE: the
    // canary's deep walk only follows `children`, so leaving `bodyChildren`
    // here does not contribute to the deep-kind sequence.
    const bodyChildren = Array.isArray(block.children) ? block.children : [];

    return {
        id: stampId(idGen),
        kind: "match-block",
        forType,
        onExprRaw,
        armsRaw,
        bodyChildren,
        span: block.span !== undefined ? block.span : null,
        // A `< match` opener (space after `<`) is classified TagKind.StateOpener
        // by the native opener scanner; `<match>` is ScrmlStructural. Mirrors
        // the engine-decl `openerHadSpaceAfterLt` stamp.
        openerHadSpaceAfterLt: block.tagKind === "StateOpener",
    };
}

// readForType — read the `for=` attribute as a bareword type identifier, or ""
// when absent / unrecoverable. Both `variable-ref` (unquoted `for=Phase`) and
// `string-literal` (quoted `for="Phase"`) attribute values yield the bare
// identifier text.
function readForType(attrs) {
    for (const attr of attrs) {
        if (attr === undefined || attr === null) continue;
        if (attr.name !== "for") continue;
        const value = attr.value;
        if (value === undefined || value === null) return "";
        if (value.kind === "variable-ref") {
            return typeof value.name === "string" ? value.name : "";
        }
        if (value.kind === "string-literal") {
            return typeof value.value === "string" ? value.value : "";
        }
        return "";
    }
    return "";
}

// readOnExprRaw — read the `on=` attribute value as its verbatim source slice,
// or null when absent. The attr value's span (set by the tag-frame tokenizer)
// brackets the source range; slicing recovers the author's expression in its
// original syntactic form (`@phase`, `${expr}`, `"literal"`, etc.).
function readOnExprRaw(attrs, source) {
    for (const attr of attrs) {
        if (attr === undefined || attr === null) continue;
        if (attr.name !== "on") continue;
        const value = attr.value;
        if (value === undefined || value === null) return null;
        // `absent` valued — the `on` bareword with no `=`. Treat as null
        // (a parse-time degenerate; SYM PASS downstream surfaces it as
        // E-MATCH-ON-REQUIRED when no scoped engine auto-implies it).
        if (value.kind === "absent") return null;
        // Span-slice the verbatim source. The value's span brackets the
        // attribute value text — for `on=@phase` this is "@phase"; for
        // `on=${expr}` this is "${expr}"; for `on="literal"` this is "literal"
        // (the span excludes the surrounding quotes — that's the live shape).
        const span = value.span;
        if (span !== undefined && span !== null
            && typeof span.start === "number" && typeof span.end === "number"
            && typeof source === "string"
            && span.start >= 0 && span.end <= source.length
            && span.start <= span.end) {
            return source.slice(span.start, span.end);
        }
        // Span unavailable — fall back to the typed-payload text.
        if (value.kind === "variable-ref" && typeof value.name === "string") {
            return value.name;
        }
        if (value.kind === "expr" && typeof value.raw === "string") {
            return value.raw;
        }
        if (value.kind === "string-literal" && typeof value.value === "string") {
            return value.value;
        }
        return null;
    }
    return null;
}

// collectArmsRaw — the body text of a match block (between the opener `>` and
// the closer `</...>`). Bracketed by the first-child's span.start and the
// last-child's span.end; "" when the block has no children. Trimmed of leading
// / trailing whitespace to match live's `armsRaw.trim()`.
function collectArmsRaw(block, source) {
    const children = Array.isArray(block.children) ? block.children : [];
    if (children.length === 0) return "";
    if (typeof source !== "string") return "";
    let lo = -1;
    let hi = -1;
    for (const child of children) {
        if (child === undefined || child === null) continue;
        const span = child.span;
        if (span === undefined || span === null) continue;
        if (typeof span.start !== "number" || typeof span.end !== "number") continue;
        if (lo < 0 || span.start < lo) lo = span.start;
        if (hi < 0 || span.end > hi) hi = span.end;
    }
    if (lo < 0 || hi < 0 || lo > hi) return "";
    if (lo < 0 || hi > source.length) return "";
    return source.slice(lo, hi).trim();
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
        // M6.5.b.5 (Class F) — forward the `_synthetic` lift-wrapper marker the
        // native `liftBareBlocks` stamps (parse-markup.js synthLiftedLogicBlock
        // L2074 / synthPairedLogicBlock) onto the live `logic` node, EXACTLY as
        // the live ast-builder does (ast-builder.js L11648). Present-only-when-
        // true (a non-lifted logic node has NO `_synthetic` key on either
        // pipeline). Consumed by the W-PROGRAM-REDUNDANT-LOGIC lint (live-only);
        // surfaced here for within-node parity.
        ...(block._synthetic === true ? { _synthetic: true } : {}),
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

// =============================================================================
// M6.5.b.5 (Class F) + M6.5.b.6 (Class G) — native→live FileAST shape + span
// normalization. ONE explicit post-`nativeParseFile` normalizer (SCOPING §4
// Decision A: a single boundary normalizer, NOT N consumer-side adapters).
// Native-path-only by construction (nativeParseFile runs only when
// `--parser=scrml-native`; api.js:849), so this CANNOT affect the live default.
//
// Per-node rules (all ADAPT — shape parity, no parser-behavior change):
//   - span.file       (G) — stamp `span.file = filePath` on every span object
//                           lacking it. Live `Span` carries `file` (ast.ts:21
//                           `file?`); native spans omit it. ADDITIVE: adding a
//                           `file` key does not change start/end/line/col, so
//                           any consumer that shares a span object (e.g. the
//                           engine state-child walker reading `_nativeEngineBlock`
//                           offsets) is unaffected. Closes the SPAN-COORD
//                           file-missing key-set divergences.
//   - closerForm      (F) — lowercase the value on `markup` nodes. Native emits
//                           PascalCase "Explicit"/"Inferred" via the TagFrame
//                           close lifecycle (tag-frame.js CloserForm enum);
//                           live emits "explicit"/"inferred" (ast-builder.js
//                           L11034). `.toLowerCase()` is exact: corpus-wide the
//                           ONLY native values are "Explicit"/"Inferred"/"" (no
//                           "SelfClosing" — the self-close case is `""`, already
//                           lowercase; the native ""-vs-live-"self-closing"
//                           DISTINCTION gap is a separate parser-fidelity issue,
//                           NOT a case adapter — out of this unit's scope).
//   - openerHadSpaceAfterLt (F) — default `false` on a `markup` node missing it.
//                           Faithful: a `markup` node is NEVER a StateOpener (a
//                           `< Foo` space-opener routes to `synthStateNode`;
//                           `<match>`/`< match` route to `synthMatchBlockNode`,
//                           which already stamps the tagKind-derived value) — so
//                           a markup node always had NO space after `<` ⇒ false.
//                           Mirrors live ast-builder.js L11036.
//   - _p3aIsExport / _p3aExportName (F) — default `undefined` (present-as-key)
//                           on a `markup` node missing them. Live stamps them on
//                           every markup node (ast-builder.js L11040-41),
//                           present-as-undefined for normal markup (the
//                           `true`/name re-export case is a `<channel>`-export
//                           P3a shape, a separate divergence left as-is).
//   - attrs[].value.sourceText (F) — STRIP from `markup`/`state`/`match-block`
//                           node attrs, via a NON-MUTATING clone of the attr +
//                           value. CRITICAL: the synth* builders pass
//                           `block.attrs` BY REFERENCE, and those same AttrValue
//                           objects are reachable via `machineDecls[].bodyChildren`
//                           / `_nativeEngineBlock` (collect-hoisted.js L421/452)
//                           where the engine state-child walker's `readIfExprRaw`
//                           (engine-statechild-walker.ts:144) reads `sourceText`
//                           for `ifExprRaw` legacy parity. Cloning (never
//                           deleting in place) leaves the raw native blocks —
//                           PascalCase `kind:"Markup"` — intact for the walker.
//                           The discriminator is the LOWERCASE live `kind`: this
//                           pass only touches translated FileAST nodes, never the
//                           raw native blocks it transitively reaches.
// =============================================================================

// MARKUP_FAMILY_KINDS — the live lowercase markup-family node kinds whose attrs
// carry the native-only `sourceText` debt. `match-block` keeps its attrs raw on
// the node (forType/onExprRaw are read from them), but its translated attr
// values still carry sourceText — strip there too.
const MARKUP_ATTR_KINDS = new Set(["markup", "state", "state-constructor-def", "match-block"]);

// stripSourceTextFromAttrs — calculation. Return a NEW attrs array with each
// attr's `value.sourceText` removed via shallow clone. Never mutates the input
// objects (they are shared with the raw native block stream the engine walker
// reads). An attr whose value has no `sourceText` is passed through by
// reference (no needless clone).
function stripSourceTextFromAttrs(attrs) {
    if (Array.isArray(attrs) === false) return attrs;
    let changed = false;
    const out = attrs.map((attr) => {
        if (attr === null || attr === undefined) return attr;
        const value = attr.value;
        if (value === null || value === undefined || typeof value !== "object") return attr;
        if (Object.prototype.hasOwnProperty.call(value, "sourceText") === false) return attr;
        changed = true;
        const newValue = {};
        for (const k of Object.keys(value)) {
            if (k === "sourceText") continue;
            newValue[k] = value[k];
        }
        const newAttr = {};
        for (const k of Object.keys(attr)) {
            newAttr[k] = (k === "value") ? newValue : attr[k];
        }
        return newAttr;
    });
    return changed ? out : attrs;
}

// normalizeNode — calculation (mutates the translated node in place; the node
// was freshly synthesized by the synth* builders, so in-place is safe for
// everything EXCEPT attrs[].value, which is shared — handled via clone above).
// `inExprContext` is true when the node sits inside a lift/match/for-expr
// markup-as-value subtree (under an `expr`/`node`/`exprNode` ancestor); live
// OMITS `openerHadSpaceAfterLt` + `_p3a*` on those, so they are gated on it.
// Returns nothing; the caller walks children separately.
function normalizeNode(node, filePath, inExprContext) {
    if (node === null || node === undefined || typeof node !== "object") return;

    // (G) span.file — additive stamp on a plain-object span lacking `file`.
    const span = node.span;
    if (span !== null && span !== undefined && typeof span === "object"
        && Array.isArray(span) === false
        && Object.prototype.hasOwnProperty.call(span, "file") === false) {
        span.file = filePath;
    }

    const kind = node.kind;

    // (F) closerForm case — markup nodes carry a non-null closerForm on BOTH
    // the block path (synthMarkupNode) AND the lift-expr path
    // (translate-stmt synthLiveMarkupNodeFromBlock); live lowercases on both,
    // so lowercase here (a node-shape pass, path-agnostic).
    if (kind === "markup" && typeof node.closerForm === "string" && node.closerForm.length > 0) {
        node.closerForm = node.closerForm.toLowerCase();
    }

    // (F) openerHadSpaceAfterLt + _p3a* — BLOCK-PATH markup nodes ONLY. Live
    // stamps them in `buildBlock` (ast-builder.js L11036/L11040-41) for the
    // top-level/child markup TREE, and OMITS them on lift/match/for-expr
    // markup-as-value subtrees (verified empirically: 361 of 361 field-less
    // live markup nodes are under an expr/node/exprNode ancestor; 0 outside).
    // The `inExprContext` gate reproduces that exact rule. A `markup` node is
    // never a StateOpener (a `< Foo` space-opener routes to synthStateNode), so
    // openerHadSpaceAfterLt is always `false`. _p3a* are present-as-`undefined`
    // for normal markup (the `true`/name re-export is a `<channel>`-export P3a
    // shape, a separate divergence left as-is). Present-as-key, value undefined.
    if (kind === "markup" && inExprContext === false) {
        if (Object.prototype.hasOwnProperty.call(node, "openerHadSpaceAfterLt") === false) {
            node.openerHadSpaceAfterLt = false;
        }
        if (Object.prototype.hasOwnProperty.call(node, "_p3aIsExport") === false) {
            node._p3aIsExport = undefined;
        }
        if (Object.prototype.hasOwnProperty.call(node, "_p3aExportName") === false) {
            node._p3aExportName = undefined;
        }
    }

    // (F) sourceText strip — clone the attrs of a translated markup-family node.
    // Path-agnostic (live carries no sourceText on either path).
    if (MARKUP_ATTR_KINDS.has(kind) && Array.isArray(node.attrs)) {
        node.attrs = stripSourceTextFromAttrs(node.attrs);
    }
}

// EXPR_CONTEXT_KEYS — the field names whose subtree is a markup-as-value /
// expression context (lift-expr `{kind:"markup", node}`, for-expr / match-expr
// `expr`, structured `exprNode`). Crossing any of these flips `inExprContext`
// true for the descendant subtree, mirroring live's field-omission rule.
const EXPR_CONTEXT_KEYS = new Set(["expr", "node", "exprNode"]);

// normalizeNativeFileAST — state write. Walk the assembled FileAST and apply
// the per-node F+G normalizations. Iterative stack walk (the live AST nests
// deeply — engine fixtures ~12 levels; mirrors the within-node-classifier
// walker discipline). Walks the FileAST node collections (`nodes` + the seven
// hoisted decl arrays) and recurses every object/array value so nested
// `children` / `body` / lift-expr markup subtrees are reached. The raw native
// block escape hatches (`_nativeEngineBlock` / `_source`) are NOT descended
// (the sourceText strip already discriminates by lowercase `kind`; skipping
// them also avoids redundant span.file stamps on the shared raw blocks).
export function normalizeNativeFileAST(ast, filePath) {
    if (ast === null || ast === undefined || typeof ast !== "object") return ast;
    const fp = typeof filePath === "string" ? filePath : "";
    // Roots: every FileAST collection that carries nodes/spans.
    const roots = [
        ast.nodes, ast.imports, ast.exports, ast.components,
        ast.typeDecls, ast.machineDecls, ast.channelDecls,
    ];
    // Each frame carries `{ value, inExprContext }`. Crossing an
    // EXPR_CONTEXT_KEY flips the flag true for the descendant subtree.
    const stack = [];
    for (const root of roots) {
        if (Array.isArray(root)) {
            for (const item of root) stack.push({ value: item, inExprContext: false });
        }
    }
    const seen = new Set();
    while (stack.length > 0) {
        const frame = stack.pop();
        const cur = frame.value;
        const inExpr = frame.inExprContext;
        if (cur === null || cur === undefined || typeof cur !== "object") continue;
        if (seen.has(cur)) continue;
        seen.add(cur);
        if (Array.isArray(cur)) {
            for (const item of cur) {
                if (item !== null && typeof item === "object") {
                    stack.push({ value: item, inExprContext: inExpr });
                }
            }
            continue;
        }
        // Object — normalize THIS node, then descend its own fields.
        normalizeNode(cur, fp, inExpr);
        for (const k of Object.keys(cur)) {
            // Do NOT descend the raw native-block escape hatches (they are the
            // engine walker's source; the span.file stamp and sourceText strip
            // must not reach them). Their PascalCase-`kind` blocks would also be
            // skipped by normalizeNode's lowercase-kind guards, but pruning the
            // recursion is cheaper and removes any chance of mutating them.
            if (k === "_nativeEngineBlock" || k === "_source") continue;
            const v = cur[k];
            if (v !== null && typeof v === "object") {
                // A markup-as-value / expression subtree is entered by crossing
                // an EXPR_CONTEXT_KEY; once inside it stays inside (the flag is
                // monotone — a markup tree nested in an expr stays expr-context,
                // matching live's omission across the whole subtree).
                const childInExpr = inExpr || EXPR_CONTEXT_KEYS.has(k);
                stack.push({ value: v, inExprContext: childInExpr });
            }
        }
    }
    return ast;
}
