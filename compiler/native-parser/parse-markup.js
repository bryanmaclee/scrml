// parse-markup.js — JS-host shadow of parse-markup.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-markup.scrml's header.
//
// The markup-layer trampoline (charter Q1.G) — the same shape as M1's
// lex.js: a loop dispatching by the BlockContext engine, with a safety
// bound and a cursor-progress sentinel.
//
// MK1.2 SCOPE: the trampoline now RECOGNIZES, CONSUMES, and TRANSITIONS
// THROUGH context boundaries. The `.TopLevel` dispatch consumes a
// recognized block-opener sigil / `<ident` boundary and transitions
// @blockContext. The `.InLogicEscape` dispatch scans the logic-escape
// body tracking brace depth and closes the context (popping the
// DelegationFrame) at the matching `}`. The `.InForeignCode` dispatch is
// the §23 opaque passthrough. The `.InSql`/`.InCss`/`.InErrorEffect`/
// `.InMeta`/`.InTest` dispatches track brace depth and close correctly
// at the matching `}` but do NOT yet recognize their inner sub-context
// grammar — that is MK1.3. The `.InMarkupTag` dispatch returns to the
// prior context at the tag boundary's end; the `<tag>` TREE is MK2.

import { makeCursor, isEof, peekChar, peekStr, advance } from "./cursor.js";
import { makeParseContext } from "./parse-ctx.js";
import {
    BlockContext,
    getBlockContext,
    setBlockContext,
    contextForSigil,
    isMarkupTagOpener,
    enterBlockContext,
    enterMarkupTagContext,
    closeBlockContext,
    isBlockContextClose,
    popBlockContextFrame,
    noteBraceOpen,
    noteBraceClose,
} from "./block-context.js";

// recognizeContextEntryAt — calculation. Does a context-entry boundary
// begin at the cursor right now, and if so which BlockContext does it
// enter? Returns { kind: "sigil"|"markupTag"|"none", ... }. Recognition
// only — no cursor advance, no engine transition (the transition is
// performed by the MK1.2 dispatch helpers below).
export function recognizeContextEntryAt(cursor) {
    // Two-character block-opener sigil? (${ ?{ #{ !{ ^{ ~{ _{)
    const twoChar = peekStr(cursor, 2);
    const sigilContext = contextForSigil(twoChar);
    if (sigilContext !== null) {
        return { kind: "sigil", enters: sigilContext, sigil: twoChar };
    }

    // `<ident`-shaped markup-tag-context boundary?
    const here = peekChar(cursor, 0);
    const next = peekChar(cursor, 1);
    if (isMarkupTagOpener(here, next)) {
        return { kind: "markupTag", enters: BlockContext.InMarkupTag };
    }

    return { kind: "none" };
}

// dispatchTopLevel — the `.TopLevel` BlockContext state-child body
// (MK1.2 — substantive: recognize, consume, transition).
//
// At MK1.2 this:
//   - recognizes whether a context-entry boundary begins at the cursor;
//   - if a block-opener SIGIL begins here: consumes it and transitions
//     @blockContext into the matching variant (enterBlockContext);
//   - if a `<ident` markup-tag boundary begins here: consumes the `<`
//     and transitions into .InMarkupTag (enterMarkupTagContext);
//   - otherwise: advances ONE character (ordinary top-level text — the
//     §40.8 default-logic body content recognition is MK1.3).
//
// Returns the recognition record (the trampoline surfaces it for tests).
export function dispatchTopLevel(cursor, ctx) {
    const recognized = recognizeContextEntryAt(cursor);

    if (recognized.kind === "sigil") {
        enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        return recognized;
    }

    if (recognized.kind === "markupTag") {
        enterMarkupTagContext(ctx, cursor);
        return recognized;
    }

    // Ordinary top-level text — advance one char. (MK1.3 recognizes `//`
    // line comments + `<!-- -->` HTML comments here structurally.)
    advance(cursor, 1);
    return recognized;
}

// dispatchInLogicEscape — the `.InLogicEscape` BlockContext state-child
// body (MK1.2 — substantive: brace-depth body scan + matching-close).
//
// The logic-escape body is JS; its actual lexing + parsing is the M1
// JS-layer LexMode engine graph, which the MK4 seam delegates to. At
// MK1.2 the JS-layer parse-delegation is NOT wired — the delegated body
// is consumed as a SPAN (the DelegationFrame pushed at enterBlockContext
// is the substrate MK4 widens). This dispatch therefore scans the body
// character by character, tracking ordinary `{`/`}` against ctx.brackets,
// until the matching `}` at brace-depth-0 closes the context.
//
// A nested block-opener sigil inside the body (the charter Q1.C
// `<InLogicEscape rule=(.TopLevel | .InMarkupTag | .InSql)>` contract
// permits `.InMarkupTag` / `.InSql`) is recognized and entered — the
// BlockContext stack handles the nesting.
export function dispatchInLogicEscape(cursor, ctx) {
    // Matching close `}` of this logic-escape context?
    if (isBlockContextClose(ctx, cursor)) {
        closeBlockContext(ctx, cursor);
        return;
    }

    // A nested context-entry boundary inside the body? (rule= permits
    // .InMarkupTag and .InSql; a nested ${...} is also legal.)
    const recognized = recognizeContextEntryAt(cursor);
    if (recognized.kind === "sigil") {
        enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        return;
    }
    if (recognized.kind === "markupTag") {
        enterMarkupTagContext(ctx, cursor);
        return;
    }

    // Ordinary body character — track inner braces so the matching-close
    // depth calculation stays accurate, then advance.
    const here = peekChar(cursor, 0);
    if (here === openBrace()) {
        noteBraceOpen(ctx, cursor);
        advance(cursor, 1);
        return;
    }
    if (here === closeBraceChar()) {
        // Not the matching close (isBlockContextClose was false above) —
        // an ordinary inner close brace. Pop its frame, then advance.
        noteBraceClose(ctx);
        advance(cursor, 1);
        return;
    }

    advance(cursor, 1);
}

// dispatchInForeignCode — the `.InForeignCode` BlockContext state-child
// body (MK1.2 — the §23 opaque passthrough).
//
// Per §23 a foreign-code block passes through VERBATIM — no inner
// recognition. The body is opaque: no nested sigil is recognized, no
// `<ident` boundary is recognized. The ONLY structural recognition is
// the matching `}` that closes the block — and even that is a pure
// brace-depth calculation: ordinary `{`/`}` inside the foreign code are
// tracked against ctx.brackets (so the matching close is found) but are
// otherwise uninterpreted.
export function dispatchInForeignCode(cursor, ctx) {
    // Matching close `}` of this foreign-code block?
    if (isBlockContextClose(ctx, cursor)) {
        closeBlockContext(ctx, cursor);
        return;
    }

    // Opaque body — track inner braces for the depth calculation; do NOT
    // recognize sigils or `<ident` (§23 — verbatim passthrough).
    const here = peekChar(cursor, 0);
    if (here === openBrace()) {
        noteBraceOpen(ctx, cursor);
        advance(cursor, 1);
        return;
    }
    if (here === closeBraceChar()) {
        noteBraceClose(ctx);
        advance(cursor, 1);
        return;
    }

    advance(cursor, 1);
}

// dispatchBraceDelimitedStub — the brace-depth-aware body shared by the
// `.InSql` / `.InCss` / `.InErrorEffect` / `.InMeta` / `.InTest`
// state-children at MK1.2.
//
// These five contexts ARE brace-delimited (entered by a two-char sigil,
// closed by a matching `}`). MK1.2's job for them is the CONTEXT
// BOUNDARY: enter on the sigil, track brace depth, close on the matching
// `}`. The INNER sub-context grammar (the SQL tokenizer, the CSS
// tokenizer, the error-effect arm tokenizer, the meta logic-grammar, the
// test-block tokenizer) is MK1.3 — these dispatches stub the body as a
// brace-tracked span, exactly as .InLogicEscape captures its body as a
// span pending the MK4 JS delegation.
export function dispatchBraceDelimitedStub(cursor, ctx) {
    // Matching close `}` of this context?
    if (isBlockContextClose(ctx, cursor)) {
        closeBlockContext(ctx, cursor);
        return;
    }

    // Body character — track inner braces for the depth calculation,
    // then advance. (Inner sub-context grammar is MK1.3.)
    const here = peekChar(cursor, 0);
    if (here === openBrace()) {
        noteBraceOpen(ctx, cursor);
        advance(cursor, 1);
        return;
    }
    if (here === closeBraceChar()) {
        noteBraceClose(ctx);
        advance(cursor, 1);
        return;
    }

    advance(cursor, 1);
}

// dispatchInMarkupTag — the `.InMarkupTag` BlockContext state-child body
// (MK1.2 — boundary-only).
//
// MK1.2 recognizes + transitions on the markup-tag BOUNDARY; the actual
// `<tag>` TREE (opener/closer pairing, attributes, TagFrame, the three
// closer forms) is MK2. At MK1.2 the dispatch consumes the rest of the
// tag-name run (ASCII letters / digits / `-`) and then returns to the
// prior context — it does NOT build the tag tree and does NOT recurse
// into the tag body. This keeps the trampoline progressing and the
// .InMarkupTag boundary observable to MK1.2 tests; MK2 replaces this
// dispatch with the TagFrame engine.
export function dispatchInMarkupTag(cursor, ctx) {
    // Consume the tag-name run (the boundary's identifier). MK2 will
    // instead tokenize the full opener (name + attributes + closer form).
    const here = peekChar(cursor, 0);
    if (isTagNameChar(here)) {
        advance(cursor, 1);
        return;
    }

    // The tag-name run has ended — the boundary is fully recognized.
    // MK1.2 returns to the prior context here (the `<tag>` body + closer
    // pairing is MK2). Pop the .InMarkupTag frame and restore.
    const frame = popBlockContextFrame(ctx);
    if (frame !== null) {
        setBlockContext(ctx, frame.priorContext);
    } else {
        setBlockContext(ctx, BlockContext.TopLevel);
    }
}

// isTagNameChar — calculation (predicate). A character that may continue
// a markup-tag name run: ASCII letter, ASCII digit, or `-`. (MK2 owns
// the full tag-name grammar; MK1.2 needs only enough to consume the
// boundary identifier so the trampoline progresses past it.)
export function isTagNameChar(ch) {
    if (ch === "") return false;
    if (ch === "-") return true;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;   // 0-9
    if (c >= 65 && c <= 90) return true;   // A-Z
    if (c >= 97 && c <= 122) return true;  // a-z
    return false;
}

// openBrace / closeBraceChar — calculation. The one-character open /
// close brace strings. Mirror the .scrml's String.fromCharCode form
// 1:1 — the .scrml needs it as the README ANOMALY-1 string-literal
// workaround; the .js shadow keeps the same structure so the pair is
// 1:1 (the same reason makeSigilTable mirrors the .scrml's concat).
export function openBrace() {
    return String.fromCharCode(123);
}
export function closeBraceChar() {
    return String.fromCharCode(125);
}

// parseMarkup — entry point. Pure fn over the source string; the loop
// is a thin trampoline dispatching by BlockContext, mirroring lex.js.
//
// MK1.2 returns ctx.nodes (the shared node sink). At MK1.2 no AST nodes
// are produced yet — the trampoline recognizes/consumes/transitions
// through context boundaries; node production lands as the per-context
// grammars fill in (MK1.3 + MK2/MK3). Tests at MK1.2 observe the
// transition behaviour via parseMarkupTrace below.
export function parseMarkup(source) {
    return runMarkup(source).ctx.nodes;
}

// parseMarkupTrace — like parseMarkup, but returns the full run record
// { ctx, contextTrace } so MK1.2 unit tests can observe the BlockContext
// transition sequence + the final ctx state (brackets / delegationStack
// / blockContextStack). The contextTrace is the @blockContext value
// recorded at the TOP of every trampoline iteration.
export function parseMarkupTrace(source) {
    return runMarkup(source);
}

// runMarkup — the shared trampoline. Returns { ctx, contextTrace }.
function runMarkup(source) {
    const cursor = makeCursor(source);
    const ctx = makeParseContext();
    const contextTrace = [];

    const maxIters = (source.length + 1) * 4;
    let iters = 0;

    while (!isEof(cursor) && iters < maxIters) {
        const context = getBlockContext(ctx);
        contextTrace.push(context);
        const beforePos = cursor.pos;

        if (context === BlockContext.TopLevel) {
            dispatchTopLevel(cursor, ctx);
        } else if (context === BlockContext.InMarkupTag) {
            dispatchInMarkupTag(cursor, ctx);
        } else if (context === BlockContext.InLogicEscape) {
            dispatchInLogicEscape(cursor, ctx);
        } else if (context === BlockContext.InCss) {
            dispatchBraceDelimitedStub(cursor, ctx);
        } else if (context === BlockContext.InSql) {
            dispatchBraceDelimitedStub(cursor, ctx);
        } else if (context === BlockContext.InErrorEffect) {
            dispatchBraceDelimitedStub(cursor, ctx);
        } else if (context === BlockContext.InMeta) {
            dispatchBraceDelimitedStub(cursor, ctx);
        } else if (context === BlockContext.InTest) {
            dispatchBraceDelimitedStub(cursor, ctx);
        } else if (context === BlockContext.InForeignCode) {
            dispatchInForeignCode(cursor, ctx);
        } else {
            // Defensive safety net for an unreachable future
            // BlockContext variant — return to .TopLevel.
            setBlockContext(ctx, BlockContext.TopLevel);
        }

        // Loop-progress sentinel — every iteration must consume input.
        if (cursor.pos === beforePos && !isEof(cursor)) {
            cursor.pos = cursor.pos + 1;
        }
        iters = iters + 1;
    }

    return { ctx, contextTrace };
}
