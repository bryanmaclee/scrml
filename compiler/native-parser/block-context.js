// block-context.js — JS-host shadow of block-context.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors block-context.scrml's header.
//
// BlockContext is the markup-layer context-grid engine (charter Q1.C) —
// the top-level engine of the markup-layer engine graph. It is to the
// markup layer what LexMode is to the JS layer.
//
// MK1.2 SCOPE: the engine declaration is complete (all 9 variants, full
// rule= contract — see the .scrml). MK1.1 made the `.TopLevel` body
// substantive at a RECOGNITION level (the context-entry recognizers);
// MK1.2 deepens this to actual CONSUMPTION + TRANSITION: the seven
// block-opener sigils are consumed and `@blockContext` (the live
// `ctx.blockContext` slot) transitions to the matching variant; a
// brace-depth marker is recorded so the matching `}` at depth-0 closes
// the context back to the prior one; the `<ident` markup-tag boundary
// transitions to `.InMarkupTag`; entering `.InLogicEscape` pushes a
// DelegationFrame (punch-list P3).

import { peekChar, peekStr, advance } from "./cursor.js";
import { makeSpan } from "./span.js";
import {
    push as pushBracket,
    pop as popBracket,
    depth as bracketDepth,
    BracketKind,
} from "./bracket-stack.js";
import {
    delegationKinds,
    closeOnBraceDepth,
    makeDelegationFrame,
    pushDelegationFrame,
    popDelegationFrame,
} from "./parse-ctx.js";

// BlockContext variant tags — all 9 per charter Q1.C.
export const BlockContext = Object.freeze({
    TopLevel:      "TopLevel",
    InMarkupTag:   "InMarkupTag",
    InLogicEscape: "InLogicEscape",
    InCss:         "InCss",
    InSql:         "InSql",
    InErrorEffect: "InErrorEffect",
    InMeta:        "InMeta",
    InTest:        "InTest",
    InForeignCode: "InForeignCode",
});

// initialBlockContext — calculation. Matches `initial=.TopLevel`.
export function initialBlockContext() {
    return BlockContext.TopLevel;
}

// setBlockContext — STATE write (ctx.blockContext). Canonical form:
// `@blockContext = .NewContext`.
export function setBlockContext(ctx, context) {
    ctx.blockContext = context;
}

// getBlockContext — calculation (read).
export function getBlockContext(ctx) {
    return ctx.blockContext;
}

// LEGAL_FROM_TOP_LEVEL — the rule= matrix on the <TopLevel> state-child
// as a lookup table. (.InForeignCode is reached from a tag context, not
// directly from .TopLevel — matching the charter Q1.C contract.)
export const LEGAL_FROM_TOP_LEVEL = Object.freeze({
    InMarkupTag:   true,
    InLogicEscape: true,
    InCss:         true,
    InSql:         true,
    InErrorEffect: true,
    InMeta:        true,
    InTest:        true,
});

// makeSigilTable — calculation. Builds the closed map from a two-char
// block-opener sigil to the BlockContext it enters. Mirrors the
// .scrml's character-concatenation form 1:1 (the .scrml uses concat as
// the README ANOMALY-1 string-literal workaround; the .js shadow keeps
// the same structure so the pair stays 1:1). Replaces the
// block-splitter's sigil-guessing — a closed lookup, not a heuristic.
export function makeSigilTable() {
    const brace = "{";
    const table = {};
    table["$" + brace] = BlockContext.InLogicEscape;
    table["?" + brace] = BlockContext.InSql;
    table["#" + brace] = BlockContext.InCss;
    table["!" + brace] = BlockContext.InErrorEffect;
    table["^" + brace] = BlockContext.InMeta;
    table["~" + brace] = BlockContext.InTest;
    table["_" + brace] = BlockContext.InForeignCode;
    return table;
}

// SIGIL_TO_CONTEXT — the closed sigil->BlockContext map (built once).
export const SIGIL_TO_CONTEXT = makeSigilTable();

// contextForSigil — calculation. Returns the BlockContext a two-char
// sigil enters, or null if the two chars are not a block-opener sigil.
export function contextForSigil(twoChar) {
    const ctxName = SIGIL_TO_CONTEXT[twoChar];
    if (ctxName === undefined) return null;
    return ctxName;
}

// isBlockOpenerSigil — calculation (predicate).
export function isBlockOpenerSigil(twoChar) {
    return contextForSigil(twoChar) !== null;
}

// isMarkupTagOpener — calculation (predicate). A `<` immediately
// followed by an ASCII letter opens a markup-tag context. The deep
// tag-tree recognition is MK2 — this only recognizes the boundary.
export function isMarkupTagOpener(lessThanChar, nextChar) {
    if (lessThanChar !== "<") return false;
    return isAsciiLetter(nextChar);
}

// isAsciiLetter — calculation (predicate). ASCII a-z / A-Z.
export function isAsciiLetter(ch) {
    if (ch === "") return false;
    const c = ch.charCodeAt(0);
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    return isUpper || isLower;
}

// ===========================================================================
// MK1.2 — CONTEXT CONSUMPTION + TRANSITION.
//
// MK1.1 stopped at recognition (contextForSigil / isMarkupTagOpener answer
// "what would the cursor enter here?"). MK1.2 consumes the boundary and
// performs the @blockContext transition, recording the datum that lets the
// matching close return to the prior context.
// ===========================================================================

// --- The BlockContext stack -------------------------------------------------
//
// The charter Q1.C rule= contract permits nested contexts (`<InLogicEscape
// rule=(.TopLevel | .InMarkupTag | .InSql)>` — a logic-escape body may itself
// enter a markup tag or a SQL block). MK1.2 therefore models the open-context
// chain as a STACK, exactly as M1 models nested template interpolations with
// `ctx.templateStack`. The live `ctx.blockContext` slot is the CURRENT
// variant (the engine's @blockContext cell); `ctx.blockContextStack` holds
// the suspended outer frames so a close knows which context to return to.
//
// Each frame records:
//   context     — the BlockContext variant this frame opened
//   priorContext — the variant the engine was in BEFORE this frame opened
//                   (the variant a matching close returns @blockContext to)
//   depthAtOpen — the ctx.brackets depth BEFORE the sigil's `{` was pushed.
//                 The matching close `}` is the one where depth returns to
//                 depthAtOpen + 1 (only this frame's own `{` still open).
//                 This is the CloseCondition.BraceDepth datum (R1 spike §3.2).
//   openSpan    — the sigil's span (the blame locus for an unterminated body).

// ensureBlockContextStack — lazy init the per-ctx BlockContext stack.
// Mirrors lex-in-template.js's ensureTemplateStack: makeParseContext may
// predate this field (MK1.1 ctx objects), so a defensive init keeps the
// helpers total.
export function ensureBlockContextStack(ctx) {
    if (ctx.blockContextStack === undefined || ctx.blockContextStack === null) {
        ctx.blockContextStack = [];
    }
}

// pushBlockContextFrame — STATE write: a context opens. Records the frame
// on ctx.blockContextStack.
export function pushBlockContextFrame(ctx, frame) {
    ensureBlockContextStack(ctx);
    ctx.blockContextStack.push(frame);
}

// popBlockContextFrame — STATE write: a context closes. Returns the popped
// frame, or null if the stack was empty (an unbalanced close — the caller
// dispatches ErrorRecovery).
export function popBlockContextFrame(ctx) {
    ensureBlockContextStack(ctx);
    if (ctx.blockContextStack.length === 0) return null;
    return ctx.blockContextStack.pop();
}

// topBlockContextFrame — calculation (peek). The frame whose close the
// cursor is currently watching for.
export function topBlockContextFrame(ctx) {
    ensureBlockContextStack(ctx);
    if (ctx.blockContextStack.length === 0) return null;
    return ctx.blockContextStack[ctx.blockContextStack.length - 1];
}

// blockContextDepth — calculation (read). How many block contexts are open.
export function blockContextDepth(ctx) {
    ensureBlockContextStack(ctx);
    return ctx.blockContextStack.length;
}

// --- Sigil consumption + transition -----------------------------------------

// enterBlockContext — STATE transition. Consumes a recognized two-char
// block-opener sigil at the cursor and transitions @blockContext into the
// matching variant.
//
// Steps (the order matters — the brace-depth datum is recorded BEFORE the
// sigil's `{` is pushed, mirroring lex-in-template.js's isTemplateInterpClose
// depth bookkeeping):
//   1. Snapshot the open position (the sigil's span — the blame locus).
//   2. Record depthAtOpen = the ctx.brackets depth BEFORE the `{` is pushed.
//   3. Consume the two sigil characters (`X{`).
//   4. Push a Brace frame for the sigil's `{` onto ctx.brackets — so inner
//      `{`/`}` nest correctly and the matching close is recognizable by
//      depth alone.
//   5. Push a BlockContext frame recording { context, priorContext,
//      depthAtOpen, openSpan }.
//   6. For `.InLogicEscape` (punch-list P3): also push a DelegationFrame of
//      kind .LogicEscape, closeOn .BraceDepth(depthAtOpen) — the markup→JS
//      delegation point. The JS-layer parse-delegation is not wired until
//      MK4; at MK1.2 the frame is the substrate (the delegated body is
//      captured as a span by the trampoline).
//   7. Write @blockContext to the entered variant.
//
// Returns the pushed BlockContext frame.
export function enterBlockContext(ctx, cursor, context, sigil) {
    const openSpan = makeSpan(
        cursor.pos,
        cursor.pos + sigil.length,
        cursor.line,
        cursor.col,
    );

    const depthAtOpen = bracketDepth(ctx.brackets);

    // Consume the two sigil characters.
    advance(cursor, sigil.length);

    // Push a Brace frame for the sigil's `{`. The `{` is a real brace; inner
    // `{`/`}` push/pop against this same stack so the matching close is a
    // pure depth calculation.
    pushBracket(
        ctx.brackets,
        BracketKind.Brace,
        makeSpan(openSpan.start + 1, openSpan.start + 2, openSpan.line, openSpan.col),
    );

    const priorContext = getBlockContext(ctx);
    const frame = {
        context,
        priorContext,
        depthAtOpen,
        openSpan,
    };
    pushBlockContextFrame(ctx, frame);

    // Punch-list P3 — entering .InLogicEscape pushes a DelegationFrame.
    // The §51.0.Q.1 composite-state-child realized as a frame-stack push;
    // the close datum is CloseCondition.BraceDepth(depthAtOpen). The JS
    // layer parse-delegation lands at MK4 — MK1.2 establishes the frame.
    if (context === BlockContext.InLogicEscape) {
        const kinds = delegationKinds();
        // bodyMode is MK3's BodyMode type — carried as a tag here (null
        // until MK3 threads the §4.18 mode; the field is part of the
        // DelegationFrame struct per R1 spike §3.2).
        const frameDelegation = makeDelegationFrame(
            kinds.LogicEscape,
            closeOnBraceDepth(depthAtOpen),
            openSpan,
            null,
        );
        pushDelegationFrame(ctx, frameDelegation);
    }

    setBlockContext(ctx, context);
    return frame;
}

// enterMarkupTagContext — STATE transition. The `<ident` markup-tag-context
// boundary. MK1.2 recognizes + transitions on the BOUNDARY only; the actual
// `<tag>` TREE (opener/closer pairing, TagFrame) is MK2.
//
// Unlike a block-opener sigil, a markup tag is NOT brace-delimited — the tag
// context closes on a TagFrame-balanced condition (MK2's datum), not a
// brace-depth-0 `}`. MK1.2 therefore consumes ONLY the `<` (the boundary
// marker) and transitions @blockContext; it pushes a BlockContext frame with
// a sentinel depthAtOpen of -1 ("not brace-delimited — closes via MK2's
// TagFrame, not a `}`"). The tag NAME and the `>` are MK2's to consume.
//
// Returns the pushed BlockContext frame.
export function enterMarkupTagContext(ctx, cursor) {
    const openSpan = makeSpan(cursor.pos, cursor.pos + 1, cursor.line, cursor.col);

    // Consume the `<` boundary marker only — the tag name + `>` are MK2.
    advance(cursor, 1);

    const priorContext = getBlockContext(ctx);
    const frame = {
        context:      BlockContext.InMarkupTag,
        priorContext,
        // -1 = not brace-delimited. A markup tag closes on a TagFrame
        // balance (MK2), not a brace-depth-0 `}`. isBlockContextClose
        // treats a -1 depthAtOpen as "never a brace close".
        depthAtOpen:  -1,
        openSpan,
    };
    pushBlockContextFrame(ctx, frame);

    setBlockContext(ctx, BlockContext.InMarkupTag);
    return frame;
}

// --- Context closing --------------------------------------------------------

// isBlockContextClose — calculation (predicate). Is the cursor at the
// closing brace that closes the CURRENT brace-delimited block context?
//
// True when ALL of:
//   - a block context is open (the stack is non-empty);
//   - the open frame is brace-delimited (depthAtOpen >= 0 — a markup-tag
//     frame's -1 sentinel never matches here);
//   - the character at the cursor is a closing brace;
//   - the ctx.brackets depth is exactly depthAtOpen + 1 — i.e. the only
//     brace still open is this frame's own sigil brace, so this is the
//     matching close. (Mirrors lex-in-template.js's isTemplateInterpClose
//     bracket-depth check.)
export function isBlockContextClose(ctx, cursor) {
    const frame = topBlockContextFrame(ctx);
    if (frame === null) return false;
    if (frame.depthAtOpen < 0) return false;
    if (peekChar(cursor, 0) !== closingBrace()) return false;
    return bracketDepth(ctx.brackets) === frame.depthAtOpen + 1;
}

// closingBrace — calculation. The one-character closing brace string.
// Mirrors the .scrml's String.fromCharCode form 1:1 — the .scrml needs
// it as the README ANOMALY-1 string-literal workaround (a literal
// closing brace inside a logic-escape block trips the BS-layer bracket
// matcher); the .js shadow keeps the same structure so the pair is 1:1
// (the same reason makeSigilTable mirrors the .scrml's concat form).
export function closingBrace() {
    return String.fromCharCode(125);
}

// closeBlockContext — STATE transition. Consumes the matching `}` of the
// current brace-delimited block context and transitions @blockContext back
// to the prior context.
//
// Steps:
//   1. Pop the BlockContext frame (the open-context being closed).
//   2. Consume the `}`.
//   3. Pop the sigil `{`'s Brace frame off ctx.brackets — depth returns to
//      frame.depthAtOpen.
//   4. For .InLogicEscape: pop the DelegationFrame pushed at open (P3).
//   5. Write @blockContext back to frame.priorContext.
//
// Returns the popped BlockContext frame, or null if no context was open
// (an unbalanced close — the caller dispatches ErrorRecovery).
export function closeBlockContext(ctx, cursor) {
    const frame = popBlockContextFrame(ctx);
    if (frame === null) return null;

    // Consume the `}`.
    advance(cursor, 1);

    // Pop the sigil `{`'s Brace frame — ctx.brackets depth returns to
    // frame.depthAtOpen.
    popBracket(ctx.brackets);

    // Punch-list P3 — closing .InLogicEscape pops the DelegationFrame.
    if (frame.context === BlockContext.InLogicEscape) {
        popDelegationFrame(ctx);
    }

    setBlockContext(ctx, frame.priorContext);
    return frame;
}

// --- Inner-brace bookkeeping ------------------------------------------------
//
// While the cursor is INSIDE a brace-delimited block context, ordinary
// (non-sigil, non-closing) `{`/`}` characters in the body must push/pop
// against ctx.brackets so that isBlockContextClose's depth calculation stays
// accurate. These are the body-position brace counters.

// noteBraceOpen — STATE write. Push a Brace frame for an ordinary `{` in a
// block-context body. The caller has already verified the char is `{` and
// is NOT a block-opener sigil's `{`.
export function noteBraceOpen(ctx, cursor) {
    pushBracket(
        ctx.brackets,
        BracketKind.Brace,
        makeSpan(cursor.pos, cursor.pos + 1, cursor.line, cursor.col),
    );
}

// noteBraceClose — STATE write. Pop a Brace frame for an ordinary `}` in a
// block-context body (a `}` that is NOT the context's matching close —
// isBlockContextClose returned false for it).
export function noteBraceClose(ctx) {
    popBracket(ctx.brackets);
}
