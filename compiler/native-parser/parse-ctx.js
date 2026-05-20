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

// --- DelegationKind / CloseCondition tag tables (pure data) ---

export function delegationKinds() {
    return {
        LogicEscape:   "LogicEscape",
        FunctionBody:  "FunctionBody",
        AttrExpr:      "AttrExpr",
        ShorthandBody: "ShorthandBody",
        MetaBody:      "MetaBody",
        Interpolation: "Interpolation",
        ElementValue:  "ElementValue",
    };
}

export function closeConditionKinds() {
    return {
        BraceDepth:       "BraceDepth",
        TagFrameBalanced: "TagFrameBalanced",
        AttrTerminator:   "AttrTerminator",
        ShorthandEol:     "ShorthandEol",
    };
}

// --- CloseCondition constructors (calculation — pure data builders) ---

export function closeOnBraceDepth(depthAtOpen) {
    return { kind: "BraceDepth", depthAtOpen };
}

export function closeOnTagFrameBalanced(tagDepthAtOpen) {
    return { kind: "TagFrameBalanced", tagDepthAtOpen };
}

export function closeOnAttrTerminator() {
    return { kind: "AttrTerminator" };
}

export function closeOnShorthandEol() {
    return { kind: "ShorthandEol" };
}

// --- DelegationFrame constructor (calculation — pure data builder) ---

export function makeDelegationFrame(kind, closeOn, openSpan, bodyMode) {
    return { kind, closeOn, openSpan, bodyMode };
}

// --- delegationStack helpers (state writes / reads) ---
// The push/pop ARE the §51.0.Q.1 inner-engine init/suspend events;
// MK4 drives them for the real markup<->JS delegation.

export function pushDelegationFrame(ctx, frame) {
    ctx.delegationStack.push(frame);
}

export function popDelegationFrame(ctx) {
    if (ctx.delegationStack.length === 0) return null;
    return ctx.delegationStack.pop();
}

export function topDelegationFrame(ctx) {
    if (ctx.delegationStack.length === 0) return null;
    return ctx.delegationStack[ctx.delegationStack.length - 1];
}

export function delegationDepth(ctx) {
    return ctx.delegationStack.length;
}

export function inDelegation(ctx) {
    return ctx.delegationStack.length > 0;
}
