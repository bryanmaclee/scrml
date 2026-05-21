// parse-markup.js — JS-host shadow of parse-markup.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-markup.scrml's header.
//
// The markup-layer trampoline (charter Q1.G) — the same shape as M1's
// lex.js: a loop dispatching by the BlockContext engine, with a safety
// bound and a cursor-progress sentinel.
//
// MK1.3 SCOPE: the trampoline PRODUCES A BLOCK-STREAM — a typed block
// per construct: a Text block for a plain-text run, a Comment block for
// a `//` or `<!-- -->` comment, a context block (LogicEscape / Sql /
// Css / ErrorEffect / Meta / Test / ForeignCode) for each brace-delimited
// context, and a Markup block per markup tag. Comments are recognized
// STRUCTURALLY (block-context.js's recognizeCommentForm / commentExtent
// — the elimination of BS heuristics #6 / #7). The five sub-context
// stubs have SKETCH-DEPTH per-context dispatchers (dispatchInCss /
// dispatchInSql / dispatchInErrorEffect / dispatchInMeta /
// dispatchInTest) — extent + close recognition.
//
// MK2.1 SCOPE: dispatchInMarkupTag is substantive — recognizeOpener
// (tag-frame.js) tokenizes the opener BODY (name + attributes + `>`) in
// one pass, computes its TagKind, and pushes a TagFrame. The `Markup`
// block now spans the full opener (D-4 below). enterMarkupTagContext
// keeps its MK1.2 contract (consume the `<`, push the .InMarkupTag
// frame); the opener tokenizer reads the frame's openSpan as the
// opener-span anchor. The closer forms + opener/closer PAIRING are MK2.2.
//
// KNOWN + DOCUMENTED DIVERGENCES from the BS block tree (see the .scrml
// header D-1..D-4): no inner `text` body-captures (the inner grammar is
// later milestones / the compound-match raw-capture is the charter's
// named improvement); SQL permitted from top level (charter Q1.C vs the
// BS's §3.1 SQL-inside-Logic placement); `_{}` foreign-code recognized
// (the BS has no `_{` opener); the `Markup` block spans the full OPENER
// (MK2.1) — the whole-element span (children + closer) is MK2.2.

import { makeCursor, isEof, peekChar, peekStr, advance } from "./cursor.js";
import { makeSpan } from "./span.js";
import { makeParseContext, blockKinds, makeBlockNode, appendBlock } from "./parse-ctx.js";
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
    recognizeCommentForm,
    commentExtent,
} from "./block-context.js";
// MK2.1 — the TagFrame <tag>-tree engine. The .InMarkupTag dispatcher
// calls recognizeOpener to tokenize a `<ident ...>` opener in one pass,
// compute its TagKind, and push a TagFrame.
import { recognizeOpener } from "./tag-frame.js";

// blockKindForContext — calculation. Maps a BlockContext variant to the
// BlockKind a closed context of that variant emits. The seven
// brace-delimited contexts + the markup-tag context each map to one
// BlockKind; .TopLevel never closes into a block (defensive null).
export function blockKindForContext(context) {
    const k = blockKinds();
    if (context === BlockContext.InLogicEscape) return k.LogicEscape;
    if (context === BlockContext.InSql)         return k.Sql;
    if (context === BlockContext.InCss)         return k.Css;
    if (context === BlockContext.InErrorEffect) return k.ErrorEffect;
    if (context === BlockContext.InMeta)        return k.Meta;
    if (context === BlockContext.InTest)        return k.Test;
    if (context === BlockContext.InForeignCode) return k.ForeignCode;
    if (context === BlockContext.InMarkupTag)   return k.Markup;
    return null;
}

// recognizeContextEntryAt — calculation. Does a context-entry boundary
// begin at the cursor right now, and if so which BlockContext does it
// enter? Returns { kind: "sigil"|"markupTag"|"none", ... }. Recognition
// only — no cursor advance, no engine transition.
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

// --- The TEXT-RUN accumulator -----------------------------------------------
//
// The trampoline's equivalent of the BS's beginText / flushText. A plain-text
// run is a maximal stretch of ordinary characters between two structural
// constructs. `run` is a record { at } where `at` is { start, line, col } or
// null (not accumulating).

// beginTextRun — state write. Mark the start of a text run at the cursor IF a
// run is not already open (idempotent — matching the BS's beginText).
export function beginTextRun(run, cursor) {
    if (run.at === null || run.at === undefined) {
        run.at = { start: cursor.pos, line: cursor.line, col: cursor.col };
    }
}

// flushTextRun — state write. If a text run is open, emit a Text block
// spanning [run.at.start, cursor.pos] and clear the marker. A zero-length run
// emits nothing (matching the BS's flushText, which skips empty raw slices).
export function flushTextRun(run, cursor, ctx) {
    if (run.at === null || run.at === undefined) return;
    const start = run.at.start;
    if (cursor.pos > start) {
        const k = blockKinds();
        appendBlock(ctx, makeBlockNode(
            k.Text,
            makeSpan(start, cursor.pos, run.at.line, run.at.col),
            null,
        ));
    }
    run.at = null;
}

// emitComment — state write. Consume a recognized comment at the cursor and
// emit a Comment block. Returns true if a comment was recognized + emitted,
// false if no comment opener is at the cursor.
//
// Recognition is block-context.js's recognizeCommentForm + commentExtent (the
// closed structural recognizers). The trampoline flushes the open text run
// before the comment block so the block-stream order is
// text-then-comment-then-text (matching the BS block-tree order).
export function emitComment(run, cursor, ctx) {
    const form = recognizeCommentForm(cursor);
    if (form === null) return false;

    // The comment ends a text run.
    flushTextRun(run, cursor, ctx);

    const startPos = cursor.pos;
    const startLine = cursor.line;
    const startCol = cursor.col;
    const end = commentExtent(cursor);

    // Consume the comment's full extent.
    advance(cursor, end - startPos);

    const k = blockKinds();
    appendBlock(ctx, makeBlockNode(
        k.Comment,
        makeSpan(startPos, end, startLine, startCol),
        form,
    ));
    return true;
}

// emitContextBlock — state write. Emit a context block for a just-closed (or
// unterminated) block context. `frame` is the BlockContext frame (carrying
// openSpan); `endPos` is one past the context's last consumed character.
export function emitContextBlock(ctx, frame, endPos) {
    const kind = blockKindForContext(frame.context);
    if (kind === null) return;
    appendBlock(ctx, makeBlockNode(
        kind,
        makeSpan(frame.openSpan.start, endPos, frame.openSpan.line, frame.openSpan.col),
        null,
    ));
}

// dispatchTopLevel — the `.TopLevel` BlockContext state-child body (MK1.3 —
// block-stream production + structural comments).
//
// At each cursor position:
//   - a `//` / `<!-- -->` comment -> flush the text run + emit a Comment
//     block (structural recognition — BS heuristics #6/#7 eliminated);
//   - a block-opener SIGIL -> flush the text run + enter the context;
//   - a `<ident` boundary -> flush the text run + enter .InMarkupTag;
//   - anything else -> accumulate into the open text run.
export function dispatchTopLevel(run, cursor, ctx) {
    // Structural comment recognition FIRST — a `//` / `<!-- -->` sequence
    // is a comment in `.TopLevel` (a code-default body per §40.8 / a
    // markup-context construct), not text.
    if (emitComment(run, cursor, ctx)) return;

    const recognized = recognizeContextEntryAt(cursor);

    if (recognized.kind === "sigil") {
        flushTextRun(run, cursor, ctx);
        enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        return;
    }

    if (recognized.kind === "markupTag") {
        flushTextRun(run, cursor, ctx);
        // enterMarkupTagContext consumes the `<` + transitions
        // @blockContext to .InMarkupTag; the NEXT trampoline iteration
        // dispatches .InMarkupTag (dispatchInMarkupTag) to tokenize the
        // opener body. The `<` consumption is the iteration's progress.
        enterMarkupTagContext(ctx, cursor);
        return;
    }

    // Ordinary top-level text — open / continue the text run, advance.
    beginTextRun(run, cursor);
    advance(cursor, 1);
}

// dispatchInLogicEscape — the `.InLogicEscape` state-child body (MK1.3 —
// brace-depth body scan + matching-close + block emit).
//
// The logic-escape body is JS; its actual lexing + parsing is the M1 JS-layer
// LexMode engine graph, which the MK4 seam delegates to. At MK1.3 the JS-layer
// parse-delegation is NOT wired — the body is scanned character by character,
// tracking ordinary braces against ctx.brackets, until the matching
// brace-depth-0 close, at which point a LogicEscape block is emitted.
//
// `//` line comments inside a logic-escape body ARE recognized structurally (a
// logic body is code — `//` is a code comment, BS heuristic #6 eliminated).
// `<!-- -->` is NOT a comment in a logic body (it is not a markup-context
// construct — BS heuristic #7's `!topIsBraceContext()` gate is the BS's
// equivalent decision). At MK1.3 a context body has no inner block-stream
// (the body sub-grammar is a later milestone), so a `//` comment's extent is
// consumed as part of the logic body — no inner Comment block.
//
// A nested block-opener sigil inside the body (charter Q1.C `<InLogicEscape
// rule=(.TopLevel | .InMarkupTag | .InSql)>`) is recognized and entered.
export function dispatchInLogicEscape(run, cursor, ctx) {
    // Matching close `}` of this logic-escape context?
    if (isBlockContextClose(ctx, cursor)) {
        const frame = closeBlockContext(ctx, cursor);
        emitContextBlock(ctx, frame, cursor.pos);
        return;
    }

    // A `//` line comment is a code comment inside a logic body.
    // `<!-- -->` is NOT a comment here — restrict to the Line form.
    if (recognizeCommentForm(cursor) === "Line") {
        const end = commentExtent(cursor);
        advance(cursor, end - cursor.pos);
        return;
    }

    // A nested context-entry boundary inside the body?
    const recognized = recognizeContextEntryAt(cursor);
    if (recognized.kind === "sigil") {
        enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        return;
    }
    if (recognized.kind === "markupTag") {
        // enterMarkupTagContext consumes the `<` + transitions
        // @blockContext; the next iteration dispatches .InMarkupTag (see
        // dispatchTopLevel's markupTag branch).
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

// dispatchInForeignCode — the `.InForeignCode` state-child body (MK1.3 — the
// §23 opaque passthrough + block emit).
//
// Per §23 a foreign-code block passes through VERBATIM — no inner recognition.
// The body is opaque: no nested sigil, no `<ident`, no comment is recognized.
// The ONLY structural recognition is the matching `}` — a pure brace-depth
// calculation. On close a ForeignCode block is emitted.
export function dispatchInForeignCode(run, cursor, ctx) {
    // Matching close `}` of this foreign-code block?
    if (isBlockContextClose(ctx, cursor)) {
        const frame = closeBlockContext(ctx, cursor);
        emitContextBlock(ctx, frame, cursor.pos);
        return;
    }

    // Opaque body — track inner braces for the depth calculation; do NOT
    // recognize sigils / `<ident` / comments (§23 — verbatim passthrough).
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

// --- SKETCH-DEPTH SUB-CONTEXT DISPATCHERS (MK1.3) ---------------------------
//
// The .InCss / .InSql / .InErrorEffect / .InMeta / .InTest contexts each ARE
// brace-delimited (entered by a two-char sigil, closed by a matching `}`).
// MK1.3 gives each a SKETCH-DEPTH body dispatcher: it recognizes the context's
// EXTENT (by brace depth) and its CLOSE, and emits the context block. The DEEP
// per-context grammar — a CSS tokenizer, a SQL tokenizer, the error-effect arm
// tokenizer, the meta logic-grammar, the test-block tokenizer — is a LATER
// milestone. At sketch depth the five dispatchers share the
// brace-tracked-extent shape (scanBraceDelimitedSketch); they are NAMED
// per-context so the engine's per-state-child dispatch is 1:1 with the
// BlockContext engine's state-children and the later-milestone deep grammars
// drop into the matching named dispatcher without restructuring.

// scanBraceDelimitedSketch — the shared sketch-depth body scan. Track inner
// braces against ctx.brackets; on the matching brace-depth-0 close, close the
// context + emit its block.
export function scanBraceDelimitedSketch(cursor, ctx) {
    if (isBlockContextClose(ctx, cursor)) {
        const frame = closeBlockContext(ctx, cursor);
        emitContextBlock(ctx, frame, cursor.pos);
        return;
    }

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

// dispatchInCss — the `.InCss` state-child body (sketch depth). The deep CSS
// sub-tokenizer engine is a later milestone.
export function dispatchInCss(run, cursor, ctx) {
    scanBraceDelimitedSketch(cursor, ctx);
}

// dispatchInSql — the `.InSql` state-child body (sketch depth). The deep SQL
// sub-tokenizer engine is a later milestone.
export function dispatchInSql(run, cursor, ctx) {
    scanBraceDelimitedSketch(cursor, ctx);
}

// dispatchInErrorEffect — the `.InErrorEffect` state-child body (sketch
// depth). The deep error-effect arm tokenizer is a later milestone.
export function dispatchInErrorEffect(run, cursor, ctx) {
    scanBraceDelimitedSketch(cursor, ctx);
}

// dispatchInMeta — the `.InMeta` state-child body (sketch depth). A meta
// block's body is logic-grammar (charter Q1.B) — the deep dispatcher delegates
// to the JS layer at a later milestone.
export function dispatchInMeta(run, cursor, ctx) {
    scanBraceDelimitedSketch(cursor, ctx);
}

// dispatchInTest — the `.InTest` state-child body (sketch depth). The deep
// test-block tokenizer is a later milestone.
export function dispatchInTest(run, cursor, ctx) {
    scanBraceDelimitedSketch(cursor, ctx);
}

// dispatchInMarkupTag — the `.InMarkupTag` state-child body (MK2.1 —
// opener recognition + TagFrame push + Markup block emit).
//
// MK1.3's placeholder consumed the tag-name run char-by-char and emitted a
// Markup block at BOUNDARY granularity (the `<ident` run). MK2.1 makes the
// dispatch substantive: enterMarkupTagContext has consumed the `<` and
// pushed the .InMarkupTag BlockContext frame (whose openSpan is the `<`'s
// span). The cursor is now at the byte AFTER the `<`. The dispatch:
//   1. Pops the .InMarkupTag BlockContext frame — frame.openSpan is the
//      `<`'s span, the opener-span anchor.
//   2. Calls recognizeOpener (tag-frame.js) — tokenizes the opener BODY
//      (name + attributes + `>`) from the cursor, anchored at the `<`,
//      in one pass; computes the opener's TagKind; pushes a TagFrame.
//   3. Emits a Markup block spanning the FULL opener (`<ident ...>`) —
//      a real improvement over MK1.3's boundary granularity (see the
//      .scrml header's updated D-4 note). The whole-ELEMENT span (opener
//      + children + closer) is MK2.2.
//   4. Restores @blockContext to the prior context.
//
// The TagFrame the opener pushed STAYS on ctx.tagFrameStack — that is the
// open-tag stack MK2.2's closer-form recognizers pop against.
export function dispatchInMarkupTag(run, cursor, ctx) {
    // 1. Pop the .InMarkupTag BlockContext frame — its openSpan is the
    //    `<`'s span (the opener-span anchor). enterMarkupTagContext
    //    always pushes this frame, but stay defensive.
    const frame = popBlockContextFrame(ctx);
    if (frame === null) {
        setBlockContext(ctx, BlockContext.TopLevel);
        return;
    }

    // 2. recognizeOpener tokenizes the opener BODY (name + attributes +
    //    `>`) from the cursor (positioned after the `<`), anchored at the
    //    `<`'s span; it computes TagKind and pushes a TagFrame.
    const tagFrame = recognizeOpener(ctx, cursor, frame.openSpan);

    // 3 + 4. Emit a Markup block spanning the FULL opener
    //    (frame.openSpan.start is the `<`; tagFrame.opener.span.end is one
    //    past the opener's `>`); restore the prior context.
    emitContextBlock(ctx, frame, tagFrame.opener.span.end);
    setBlockContext(ctx, frame.priorContext);
}

// isTagNameChar — calculation (predicate). A character that may continue a
// markup-tag name run: ASCII letter, ASCII digit, or `-`. MK2.1 made
// tag-frame.js the canonical home of the tag-name grammar; this is a
// re-export so existing importers of parse-markup.js's isTagNameChar (the
// MK1.2 conformance suite) keep a single source of truth.
export { isTagNameChar } from "./tag-frame.js";

// openBrace / closeBraceChar — calculation. The one-character open / close
// brace strings. Mirror the .scrml's String.fromCharCode form 1:1 — the
// .scrml needs it as the README ANOMALY-1 string-literal workaround; the .js
// shadow keeps the same structure so the pair is 1:1.
export function openBrace() {
    return String.fromCharCode(123);
}
export function closeBraceChar() {
    return String.fromCharCode(125);
}

// parseMarkup — entry point. Pure fn over the source string; the loop is a
// thin trampoline dispatching by BlockContext, mirroring lex.js. Returns the
// typed block-stream (ctx.nodes).
export function parseMarkup(source) {
    return runMarkup(source).ctx.nodes;
}

// parseMarkupTrace — like parseMarkup, but returns the full run record
// { ctx, contextTrace } so unit tests can observe the BlockContext transition
// sequence + the final ctx state (brackets / delegationStack /
// blockContextStack / nodes). The contextTrace is the @blockContext value
// recorded at the TOP of every trampoline iteration.
export function parseMarkupTrace(source) {
    return runMarkup(source);
}

// runMarkup — the shared trampoline. Returns { ctx, contextTrace }.
//
// The dispatch table mirrors the BlockContext engine's state-children. MK1.3
// threads a `run` text-accumulator through the dispatchers and flushes any
// open text run at EOF.
//
// A context block is emitted ONLY when a context properly CLOSES (in the
// per-context dispatchers). An UNTERMINATED context emits NO block — its
// frame stays on ctx.blockContextStack as the MK4 unterminated-body blame
// locus. This matches the BS oracle: the BS emits NO block for an
// unterminated context (it emits an E-CTX-003 error instead). The native
// layer's unterminated-context diagnostic is a later milestone; the frame
// persistence is the MK1.2 contract this dispatch preserves.
function runMarkup(source) {
    const cursor = makeCursor(source);
    const ctx = makeParseContext();
    const contextTrace = [];

    // The text-run accumulator (see beginTextRun / flushTextRun).
    const run = { at: null };

    const maxIters = (source.length + 1) * 4;
    let iters = 0;

    while (!isEof(cursor) && iters < maxIters) {
        const context = getBlockContext(ctx);
        contextTrace.push(context);
        const beforePos = cursor.pos;

        if (context === BlockContext.TopLevel) {
            dispatchTopLevel(run, cursor, ctx);
        } else if (context === BlockContext.InMarkupTag) {
            dispatchInMarkupTag(run, cursor, ctx);
        } else if (context === BlockContext.InLogicEscape) {
            dispatchInLogicEscape(run, cursor, ctx);
        } else if (context === BlockContext.InCss) {
            dispatchInCss(run, cursor, ctx);
        } else if (context === BlockContext.InSql) {
            dispatchInSql(run, cursor, ctx);
        } else if (context === BlockContext.InErrorEffect) {
            dispatchInErrorEffect(run, cursor, ctx);
        } else if (context === BlockContext.InMeta) {
            dispatchInMeta(run, cursor, ctx);
        } else if (context === BlockContext.InTest) {
            dispatchInTest(run, cursor, ctx);
        } else if (context === BlockContext.InForeignCode) {
            dispatchInForeignCode(run, cursor, ctx);
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

    // EOF — flush any open text run. (A context still open at EOF is an
    // unterminated context — it emits NO block and its frame stays on
    // ctx.blockContextStack as the MK4 blame locus; see the header.)
    flushTextRun(run, cursor, ctx);

    return { ctx, contextTrace };
}
