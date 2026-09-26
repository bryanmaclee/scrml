// parse-ctx.js — JS-host shadow of parse-ctx.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-ctx.scrml's header — see that file.
//
// This is the shared PARSE CONTEXT OBJECT (the seam substrate). It
// extends M1's makeLexContext with a node sink + delegationStack and
// seeds the markup-layer BlockContext engine state. Punch-list P1 (one
// shared ctx) + P2 (the one-cursor invariant) are enforced here.

import { makeLexContext } from "./lex.js";
import { initialBlockContext } from "./block-context.js";

// makeParseContext — STATE constructor. Extends makeLexContext (the
// JS-layer state) with the MK1.1 additions: the AST-node sink + the
// delegation-frame stack + the markup-layer BlockContext slot.
//
// The JS-layer fields are taken from a SINGLE makeLexContext call, so
// there is exactly one cursor-companion bracket counter, one recovery
// instance, one error stream — punch-list P1 holds by construction.
export function makeParseContext() {
    const lexCtx = makeLexContext();
    return {
        // --- inherited from M1's makeLexContext (the JS-layer state) ---
        tokens:            lexCtx.tokens,
        currentMode:       lexCtx.currentMode,
        brackets:          lexCtx.brackets,
        recovery:          lexCtx.recovery,
        templateStack:     lexCtx.templateStack,
        lastCloser:        lexCtx.lastCloser,

        // --- NEW at MK1.1 ---
        // The shared AST-node sink. Whichever layer is active appends
        // produced nodes here; the host layer's open node adopts them.
        nodes:             [],
        // The seam's instance stack — the §51.0.Q.1 inner-instance
        // hierarchy materialized; generalizes M1's templateStack. MK4
        // pushes/pops these for the real markup<->JS delegation.
        delegationStack:   [],

        // --- markup-layer engine state (MK1.1) ---
        // The current BlockContext variant the markup trampoline
        // dispatches on. Live-surface mirror of the engine's
        // auto-declared @blockContext cell (cf. ctx.currentMode for
        // @lexMode in M1).
        blockContext:      initialBlockContext(),

        // --- markup-layer context stack (MK1.2) ---
        // The stack of SUSPENDED outer BlockContext frames — the
        // BlockContext-engine analogue of M1's templateStack. When a
        // nested context opens (the charter Q1.C rule= contract permits
        // it), the outer frame is pushed here so the matching close
        // knows which context to return @blockContext to.
        // block-context.js's ensureBlockContextStack also lazy-inits
        // this so the helpers stay total against an MK1.1-vintage ctx;
        // seeding it here is the canonical form.
        blockContextStack: [],
    };
}

// --- node sink helpers (calculation — pure accumulation) ---

export function appendNode(ctx, node) {
    ctx.nodes.push(node);
}

export function nodeCount(ctx) {
    return ctx.nodes.length;
}

// --- BLOCK-NODE — the markup-layer block-stream node (MK1.3) ---
//
// The markup trampoline produces a typed BLOCK-STREAM — the analogue of the
// current block-splitter's block tree (charter Q1.G). At MK1.3 the trampoline
// emits a FLAT sequence of typed blocks; the nested <tag> tree is MK2.
//
// BlockKind is pure data — the kind is computed once at block-recognition
// time and carried (calculation classification, the same as DelegationKind).
// The block-node struct carries { kind, span, commentForm }.
//
// MK3.1 — the `DisplayTextLiteral` block kind (SPEC §4.18.8). The §4.18
// model splits a body's display text into two node kinds: a free-text-mode
// body produces `Text` blocks (the `TextNode` AST kind — SPEC §4.18.8 —
// SURVIVES); a code-default-mode body's `"..."` display-text literal is a
// distinct `DisplayTextLiteral` block (the node MK3.2's literal scanner
// emits — codegen routes it through the §4.18.6 auto-HTML-escape path).
// MK3.1 declares the kind; MK3.2 emits it.

// blockKinds — the eleven BlockKind variant tags surfaced as values. The
// tag strings read 1:1 with the BlockContext variant names where a context
// maps to a block, plus the three non-context kinds (Text /
// DisplayTextLiteral / Comment).
export function blockKinds() {
    return {
        Text:               "Text",
        DisplayTextLiteral: "DisplayTextLiteral",
        Comment:            "Comment",
        Markup:             "Markup",
        LogicEscape:        "LogicEscape",
        Sql:                "Sql",
        Css:                "Css",
        ErrorEffect:        "ErrorEffect",
        Meta:               "Meta",
        Test:               "Test",
        ForeignCode:        "ForeignCode",
    };
}

// makeBlockNode — calculation (pure data builder). One typed block in the
// markup block-stream. commentForm is the CommentForm for a Comment block,
// null for every other kind.
export function makeBlockNode(kind, span, commentForm) {
    return { kind, span, commentForm };
}

// appendBlock — state write: append a typed block to the block-stream (the
// shared ctx.nodes sink). A thin wrapper over appendNode.
export function appendBlock(ctx, block) {
    ctx.nodes.push(block);
}

// --- DelegationKind / CloseCondition tag tables + DelegationFrame
// constructor + delegationStack helpers moved to delegation-frame.js at
// K9 (S114). Consumers (block-context, conformance harness, MK4) now
// import from "./delegation-frame.js" directly. See delegation-frame.js
// for the surface and the K9 rationale (mirrors K2 — char-classify.js).
