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
// MK2.2 SCOPE: the `<tag>` TREE — opener/closer PAIRING. dispatchInMarkupTag
// recognizes the opener (recognizeOpener, MK2.1) but DEFERS the Markup
// block for a non-self-closing tag; handleCloser recognizes the `</>` /
// `</name>` closers structurally (tag-frame.js's recognizeCloserForm — a
// closed set, no bare-`/` `looksLikeCloser` guess) and pairs them with
// their open TagFrame. On a clean pop closeMarkupElement emits ONE Markup
// block spanning the whole ELEMENT (opener + children + closer) with the
// children nested — the tree. A self-closing `<ident ... />` is a
// complete element at the opener. A mismatched `</name>` dispatches the
// M1 ErrorRecovery engine (E-MARKUP-002); an unterminated tag at EOF is
// recovered as an inferred `</>` (E-CTX-001 — closeUnterminatedTags).
//
// KNOWN + DOCUMENTED DIVERGENCES from the BS block tree (see the .scrml
// header D-1..D-4): no inner `text` body-captures (the inner grammar is
// later milestones / the compound-match raw-capture is the charter's
// named improvement); SQL permitted from top level (charter Q1.C vs the
// BS's §3.1 SQL-inside-Logic placement); `_{}` foreign-code recognized
// (the BS has no `_{` opener). D-4 is RESOLVED at MK2.2 — the native
// `Markup` block now spans the whole element (opener + children +
// closer), the same as the BS `markup` block.

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
    topBlockContextFrame,
    noteBraceOpen,
    noteBraceClose,
    recognizeCommentForm,
    commentExtent,
} from "./block-context.js";
// MK2.1/MK2.2 — the TagFrame <tag>-tree engine. MK2.1: recognizeOpener
// tokenizes a `<ident ...>` opener in one pass + pushes a TagFrame.
// MK2.2: recognizeCloserForm / tokenizeCloser recognize the `</>` /
// `</name>` closers (a closed set); closeTagFrame / closeSelfClosedFrame
// pop the matching frame (opener/closer pairing); reportUnterminatedTags
// records the EOF E-CTX-001 diagnostics.
// MK2.3 — classifyTagFrame is the TagKind-driven classification (charter
// Q2.A #4 elimination): at frame-close the element's TagClass is computed
// from TagKind + the post-`>` inspection + the first child's
// already-computed TagClass and stamped on the Markup block (the typed
// payload NR consumes downstream).
import {
    recognizeOpener,
    TagFrameKind,
    recognizeCloserForm,
    tokenizeCloser,
    closeTagFrame,
    closeSelfClosedFrame,
    tagFrameDepth,
    popTagFrame,
    reportUnterminatedTags,
    classifyTagFrame,
} from "./tag-frame.js";
// MK3.3 — the §4.18 code-default body dispatch. In a code-default body
// (an engine state-child / match-arm / `:`-shorthand body — currentBodyMode
// CodeDefault) a `"` begins a DisplayTextLiteral; a bare prose run is
// E-UNQUOTED-DISPLAY-TEXT.
import { currentBodyMode, isCodeDefault } from "./body-mode.js";
import {
    scanDisplayTextLiteral,
    doubleQuote,
    makeDiagnostic,
    pushDiagnostic,
} from "./display-text-literal.js";
// MK3.3 — E-UNQUOTED-DISPLAY-TEXT detection. A bare run in a code-default
// body is valid code (no error) iff the M2 expression parser consumes the
// WHOLE run with zero diagnostics. `lex` tokenizes the run; the M2
// expression parser (makeParseExprContext + parseExpression) builds the
// Expr AST; `atEnd` confirms the whole run was consumed (parseExpression
// parses ONE expression — a leftover token means the run was not all code).
import { lex } from "./lex.js";
import { makeParseExprContext, parseExpression } from "./parse-expr.js";
import { parseProgram } from "./parse-stmt.js";
import { atEnd } from "./token-cursor.js";
// MK4 — the markup<->JS seam (R1 spike §3). The seam helpers centralize the
// markup->JS delegate-down direction (the .InLogicEscape body's JS parse) +
// the JS-layer `<`-vs-`LessThan` discriminator (markupValueAllowedAfter,
// used by parse-expr.js's parsePrimary at the LessThan branch).
import {
    delegateLogicEscapeBody,
    findBodyCloseOffset,
} from "./parse-seam.js";
// F7.a (v0.6) — the state-block payload shaper. A `< Ident ...>` element
// is a Markup block whose opener carries TagKind.StateOpener; shapeStateBlock
// derives the live `StateNode` / `StateConstructorDefNode` payload
// (stateNodeKind / stateType / typedAttrs) from its tokenizedAttrs.
import { shapeStateBlock } from "./parse-state-body.js";
// F7.b (v0.6) — the SQL chained-call shaper. After a `?{...}` Sql block
// closes, a `.method(args)` chain may trail it; shapeSqlBlock parses the
// query body + consumes the trailing chain into the live `SQLNode` payload.
import { shapeSqlBlock } from "./parse-sql-body.js";
// F7.c (v0.6) — the CSS declaration/rule shaper. A `#{...}` Css block's
// body is CSS; shapeCssBlock parses it into the live `CSSInlineNode`
// `rules[]` payload (property rules / selector rules / at-rules).
import { shapeCssBlock } from "./parse-css-body.js";
// F8 (v0.6) — the error-effect arm shaper. A `!{...}` ErrorEffect block's
// body is `| ::Type binding -> handler` arms; shapeErrorEffectBlock parses
// it into the live `ErrorEffectNode` `arms[]` payload.
import { shapeErrorEffectBlock } from "./parse-error-body.js";

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

    // F7.a (v0.6) — a `< Ident`-shaped STATE-opener boundary (SPEC §4.3:
    // a `<` then whitespace then a tag-name letter). The live BS routes
    // this to a `state` block; the native parser enters .InMarkupTag and
    // `tokenizeOpener` records `hadSpaceAfterLt` -> TagKind.StateOpener.
    // (A `< /` is a closer — handleCloser runs before this in the
    // dispatch, so the two never collide.)
    if (here === "<" && isStateTagBoundaryAfterLt(cursor)) {
        return { kind: "markupTag", enters: BlockContext.InMarkupTag };
    }

    return { kind: "none" };
}

// isStateTagBoundaryAfterLt — calculation (predicate). The cursor is AT a
// `<`. Look past the inter-`<`-and-name whitespace: a `< Ident` state
// opener (SPEC §4.3) has at least one whitespace char then a tag-name
// start letter. A `<` followed by whitespace then anything else (a bare
// `< ` in free text, a `< 3` numeric) is NOT a tag boundary — it stays
// free-text per §4.6.
export function isStateTagBoundaryAfterLt(cursor) {
    // The char after `<` must be whitespace (a `<ident` opener with NO
    // space is handled by isMarkupTagOpener above — this branch is the
    // space-bearing §4.3 form only).
    let k = 1;
    let ch = peekChar(cursor, k);
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") return false;
    // Skip the whitespace run.
    while (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        k = k + 1;
        ch = peekChar(cursor, k);
    }
    // The first non-whitespace char must be a tag-name start letter.
    return isAsciiTagNameStart(ch);
}

// isAsciiTagNameStart — calculation (predicate). The state-opener name's
// first char — an ASCII letter (mirrors block-context.js's isAsciiLetter,
// the same closed test isMarkupTagOpener uses).
export function isAsciiTagNameStart(ch) {
    if (ch === "" || ch === undefined || ch === null) return false;
    const c = ch.charCodeAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
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
//
// MK4 — for an .InLogicEscape block, parse the body's JS source slice + attach
// the resulting Stmt[] AST as `block.body` (R1 spike §3 — the seam contract's
// markup->JS delegate-down direction produces a real JS AST, not just a span).
// The body text is the source between the `${` (frame.openSpan.end) and the
// matching `}` (endPos - 1). The parse is BEST-EFFORT: the JS-layer parser
// runs over the slice and any diagnostics are forwarded via the seam helper
// into ctx.diagnostics. A body containing markup-as-value (`${ <div/> }`) is
// handled by parsePrimary's LessThan branch (parse-expr.js — the JS->markup
// delegate-up direction), which calls back into the markup layer.
//
// F7.b/F7.c (v0.6) — for an .InSql / .InCss block the body's verbatim text
// is captured as `block.bodyText` (the same slice extraction the
// .InLogicEscape branch does) and the deep payload is shaped:
//   .InCss — shapeCssBlock parses bodyText into `block.rules` (the live
//            CSSInlineNode payload).
//   .InSql — shapeSqlBlock parses bodyText into `block.query` + consumes
//            the trailing `.method(args)` chain into `block.chainedCalls`.
//            The chain bytes trail the closing `}`, so when a `cursor` is
//            supplied (the brace-tracked-extent dispatch path) the cursor
//            is advanced past the consumed chain — the chain bytes belong
//            to the Sql block, not the enclosing TopLevel text run.
export function emitContextBlock(ctx, frame, endPos, cursor) {
    const kind = blockKindForContext(frame.context);
    if (kind === null) return;
    const block = makeBlockNode(
        kind,
        makeSpan(frame.openSpan.start, endPos, frame.openSpan.line, frame.openSpan.col),
        null,
    );
    // MK4 — for .InLogicEscape, attach the body's parsed JS AST. The body
    // extent is [frame.openSpan.end, endPos - 1) (the `}` is one byte before
    // endPos). The source slice is the body's verbatim text; lex + parseProgram
    // builds the Stmt[] AST. An empty body parses to an empty body[]; a body
    // containing a nested context is best-effort (the nested context's own
    // block is emitted separately into ctx.nodes by the markup trampoline; the
    // JS-layer parser sees the body text as-is and may surface its own
    // diagnostics — that is the seam contract working).
    if (frame.context === BlockContext.InLogicEscape) {
        const bodyStart = frame.openSpan.end;
        // For terminated bodies endPos points one past `}`; bodyEnd is endPos-1
        // (the `}` byte). For an EOF-unterminated body endPos is cursor.pos at
        // EOF — the closer never materialized, so the body extends to EOF.
        const bodyEnd = (endPos > bodyStart) ? (endPos - 1) : bodyStart;
        const sourceSlice = cursorSourceFromCtx(ctx);
        if (sourceSlice !== null && bodyEnd >= bodyStart) {
            const bodyText = sourceSlice.substring(bodyStart, bodyEnd);
            block.bodyText = bodyText;
            block.body = parseLogicBodyBestEffort(bodyText, ctx, bodyStart, frame.openSpan.line, frame.openSpan.col);
        }
    }

    // F7.c (v0.6) — a `#{...}` CSS block. Capture the verbatim body slice
    // (the same [openSpan.end, endPos-1) extent the .InLogicEscape branch
    // uses) and shape it into `block.rules` — the live CSSInlineNode payload.
    if (frame.context === BlockContext.InCss) {
        const bodyStart = frame.openSpan.end;
        const bodyEnd = (endPos > bodyStart) ? (endPos - 1) : bodyStart;
        const sourceSlice = cursorSourceFromCtx(ctx);
        if (sourceSlice !== null && bodyEnd >= bodyStart) {
            block.bodyText = sourceSlice.substring(bodyStart, bodyEnd);
        } else {
            block.bodyText = "";
        }
        shapeCssBlock(block);
    }

    // F7.b (v0.6) — a `?{...}` SQL block. Capture the verbatim body slice +
    // shape it into `block.query` + the trailing `.method(args)` chain into
    // `block.chainedCalls`. The chain bytes trail the closing `}` (endPos);
    // when a live `cursor` is supplied, advance it past the consumed chain
    // so the chain bytes are not re-scanned as enclosing TopLevel text.
    if (frame.context === BlockContext.InSql) {
        const bodyStart = frame.openSpan.end;
        const bodyEnd = (endPos > bodyStart) ? (endPos - 1) : bodyStart;
        const sourceSlice = cursorSourceFromCtx(ctx);
        if (sourceSlice !== null && bodyEnd >= bodyStart) {
            block.bodyText = sourceSlice.substring(bodyStart, bodyEnd);
        } else {
            block.bodyText = "";
        }
        const shaped = shapeSqlBlock(block, sourceSlice, endPos);
        // Advance the cursor past the consumed `.method(args)` chain so the
        // markup trampoline resumes AFTER the chain. Only when a cursor is
        // supplied AND the chain extends past `}` (a chain-less Sql block
        // leaves the cursor untouched).
        if (cursor !== undefined && cursor !== null
            && typeof shaped.chainEnd === "number" && shaped.chainEnd > cursor.pos) {
            advance(cursor, shaped.chainEnd - cursor.pos);
        }
    }

    // F8 (v0.6) — a `^{...}` Meta block. Approach C (S114): a meta block's
    // body is scrml-native statements — the SAME catalog the .InLogicEscape
    // branch produces. Capture the verbatim body slice + route it through
    // the existing native M3 statement parser (parseLogicBodyBestEffort) so
    // `block.body` is a native Stmt[] matching the live `MetaNode.body`
    // shape. `parentContext` is "markup" — a top-level `^{}` block; a meta
    // block nested in another context inherits that context at the M5 swap
    // (the markup layer does not yet thread the enclosing-context kind, the
    // same posture the live builder's `mapParentContext` default takes).
    if (frame.context === BlockContext.InMeta) {
        const bodyStart = frame.openSpan.end;
        const bodyEnd = (endPos > bodyStart) ? (endPos - 1) : bodyStart;
        const sourceSlice = cursorSourceFromCtx(ctx);
        if (sourceSlice !== null && bodyEnd >= bodyStart) {
            block.bodyText = sourceSlice.substring(bodyStart, bodyEnd);
            block.body = parseLogicBodyBestEffort(
                block.bodyText, ctx, bodyStart, frame.openSpan.line, frame.openSpan.col);
        } else {
            block.bodyText = "";
            block.body = [];
        }
        block.parentContext = "markup";
    }

    // F8 (v0.6) — a `!{...}` ErrorEffect block. Capture the verbatim body
    // slice + shape it into `block.arms` — the live `ErrorEffectNode.arms`
    // payload (an ErrorArm[]).
    if (frame.context === BlockContext.InErrorEffect) {
        const bodyStart = frame.openSpan.end;
        const bodyEnd = (endPos > bodyStart) ? (endPos - 1) : bodyStart;
        const sourceSlice = cursorSourceFromCtx(ctx);
        if (sourceSlice !== null && bodyEnd >= bodyStart) {
            block.bodyText = sourceSlice.substring(bodyStart, bodyEnd);
        } else {
            block.bodyText = "";
        }
        shapeErrorEffectBlock(block);
    }

    appendBlock(ctx, block);
}

// cursorSourceFromCtx — calculation. The markup trampoline's source string,
// readable for the body-slice extraction in emitContextBlock. The trampoline
// stores it on ctx.source at runMarkup-entry (the parseContext does not yet
// carry it — the markup trampoline threads it explicitly). This helper is a
// thin defensive read.
function cursorSourceFromCtx(ctx) {
    if (ctx === null || ctx === undefined) return null;
    if (typeof ctx.source !== "string") return null;
    return ctx.source;
}

// parseLogicBodyBestEffort — calculation + diagnostic forwarding. Lex +
// parseProgram a logic-escape body's source slice. Diagnostics are forwarded
// into ctx.diagnostics with the body's host-absolute start coordinates
// attached as a delegation-context note (R1 spike §1.4 — cross-seam error
// attribution). Best-effort: a body containing nested markup-as-value will
// surface JS-layer diagnostics for the `<...>` shape until parse-expr's
// LessThan discriminator (C3) is wired; that is the seam contract working,
// not a regression.
function parseLogicBodyBestEffort(bodyText, ctx, bodyAbsStart, bodyAbsLine, bodyAbsCol) {
    if (bodyText === undefined || bodyText === null) return [];
    if (bodyText.length === 0) return [];
    const tokens = lex(bodyText);
    // MK4 — pass bodyText as the source so the JS->markup delegate-up
    // direction (parsePrimary's LessThan branch) can slice it to recognize
    // a markup-as-value `<div/>` inside the logic-escape body. Without
    // source the JS layer falls back to token-range capture (BlockStub
    // shape); with it, the markup-as-value parses to a full Markup block.
    const result = parseProgram(tokens, bodyText);
    // The body's token spans are local to the slice; shift the top-level
    // statement spans into the host coordinate space. (Deep shifts are
    // deferred — downstream consumers (M5 codegen) read the body[] as the
    // LogicEscape block's payload and re-derive spans as needed.)
    const body = (result.body !== undefined && result.body !== null) ? result.body : [];
    let i = 0;
    while (i < body.length) {
        const stmt = body[i];
        if (stmt !== null && stmt !== undefined && stmt.span !== undefined && stmt.span !== null) {
            stmt.span = shiftBodySpan(stmt.span, bodyAbsStart, bodyAbsLine, bodyAbsCol);
        }
        i = i + 1;
    }
    // Forward diagnostics — body-text-local to host-absolute.
    if (result.errors !== undefined && result.errors !== null) {
        let j = 0;
        while (j < result.errors.length) {
            const e = result.errors[j];
            const absSpan = shiftBodySpan(e.span, bodyAbsStart, bodyAbsLine, bodyAbsCol);
            const diag = makeDiagnostic(e.code, e.message, absSpan);
            // R1 spike §1.4 — attach the active delegation frame so a
            // downstream consumer (M5+) sees the attribution chain.
            if (ctx !== null && ctx !== undefined && ctx.delegationStack !== undefined
                && ctx.delegationStack.length > 0) {
                diag.delegationFrame = ctx.delegationStack[ctx.delegationStack.length - 1];
            }
            pushDiagnostic(ctx, diag);
            j = j + 1;
        }
    }
    return body;
}

// shiftBodySpan — calculation (pure). Translate a body-local span (the
// slice-local coordinate space the JS lexer/parser produced) into the host
// source's coordinate space. The body's first byte maps to (bodyAbsStart,
// bodyAbsLine, bodyAbsCol). Best-effort line/col shift: the body's later-line
// columns start at column 1 of the host source (a perfect shift requires
// anchor-line tracking — M5 scope).
function shiftBodySpan(localSpan, bodyAbsStart, bodyAbsLine, bodyAbsCol) {
    if (localSpan === undefined || localSpan === null) {
        return makeSpan(bodyAbsStart, bodyAbsStart, bodyAbsLine, bodyAbsCol);
    }
    const start = bodyAbsStart + (localSpan.start ?? 0);
    const end = bodyAbsStart + (localSpan.end ?? 0);
    const localLine = localSpan.line ?? 1;
    const localCol = localSpan.col ?? 1;
    const hostLine = bodyAbsLine + (localLine - 1);
    const hostCol = (localLine === 1) ? bodyAbsCol + (localCol - 1) : localCol;
    return makeSpan(start, end, hostLine, hostCol);
}

// dispatchTopLevel — the `.TopLevel` BlockContext state-child body (MK2.2 —
// block-stream production + structural comments + closer pairing; MK3.3 —
// the §4.18 code-default body branch).
//
// At each cursor position:
//   - a `//` / `<!-- -->` comment -> flush the text run + emit a Comment
//     block (structural recognition — BS heuristics #6/#7 eliminated);
//   - a `</>` / `</name>` closer -> flush the text run + pair it with
//     its open TagFrame (handleCloser — the tag-tree pairing, MK2.2);
//   - a block-opener SIGIL -> flush the text run + enter the context;
//   - a `<ident` boundary -> flush the text run + enter .InMarkupTag;
//   - MK3.3 — when the cursor sits inside a CODE-DEFAULT body (an engine
//     state-child / match-arm body — SPEC §4.18.1), a `"` begins a
//     DisplayTextLiteral and a bare prose run is E-UNQUOTED-DISPLAY-TEXT.
//     The body-mode-aware recognition is dispatchCodeDefaultBody;
//   - anything else -> accumulate into the open text run.
//
// Closer recognition runs BEFORE the context-entry recognition: a `</`
// is not a `<ident` markup-tag opener (the char after `<` is `/`, not a
// letter), so the two never collide — but handling closers explicitly
// first keeps the dispatch readable and the closed-set recognition
// (recognizeCloserForm) is the heuristic-elimination contract.
export function dispatchTopLevel(run, cursor, ctx) {
    // Structural comment recognition FIRST — a `//` / `<!-- -->` sequence
    // is a comment in `.TopLevel` (a code-default body per §40.8 / a
    // markup-context construct), not text.
    if (emitComment(run, cursor, ctx)) return;

    // A markup closer (`</>` / `</name>`) — pair it with its open
    // TagFrame (the tag-tree pairing). Recognized structurally — a closed
    // set (no bare-`/` `looksLikeCloser` guess).
    if (handleCloser(run, cursor, ctx)) return;

    const recognized = recognizeContextEntryAt(cursor);

    if (recognized.kind === "sigil") {
        flushTextRun(run, cursor, ctx);
        const frame = enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        // MK2.2 — snapshot the tag-tree depth at context-open. A markup
        // tag opened INSIDE this brace context cannot outlive it; on the
        // context's close, recoverTagsInClosedContext recovers any
        // TagFrame pushed since (see dispatchInLogicEscape's close
        // branch). The snapshot is the floor.
        stampTagDepthAtOpen(ctx, frame);
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

    // MK3.3 — the §4.18 code-default body branch. When the innermost open
    // TagFrame's body is a code-default body (an engine state-child /
    // match-arm body — SPEC §4.18.1), bare text is NOT free-text display
    // text: a `"` begins a DisplayTextLiteral and a bare prose run is
    // E-UNQUOTED-DISPLAY-TEXT. The comment / closer / sigil / `<ident`
    // recognizers above run first — they apply in EVERY body mode (a
    // code-default body still has nested `<tag>` and `${...}` and
    // closers). dispatchCodeDefaultBody handles only what the code-default
    // mode changes: the `"` literal + the bare-run text/code decision.
    if (isCodeDefault(currentBodyMode(ctx))) {
        dispatchCodeDefaultBody(run, cursor, ctx);
        return;
    }

    // Ordinary top-level / free-text-body text — open / continue the text
    // run, advance.
    beginTextRun(run, cursor);
    advance(cursor, 1);
}

// --- MK3.3 — the §4.18 CODE-DEFAULT BODY DISPATCH ---------------------------
//
// SPEC §4.18.1 — a code-default body (an engine state-child body §51.0, a
// match block-form arm body §18.0.1, a `:`-shorthand body §4.14) scans
// bare runs as CODE, not free-text display text. SPEC §4.18.2 — a bare run
// is an identifier / keyword / call / member access / literal / nested
// `<tag>` / `${...}`; display text MUST be a `"..."` display-text literal
// (§4.18.3). A bare prose run that is neither valid code nor a literal is
// E-UNQUOTED-DISPLAY-TEXT (§4.18.7).
//
// dispatchTopLevel's comment / closer / sigil / `<ident` recognizers run
// BEFORE this — they cover the nested-`<tag>` and `${...}` cases in EVERY
// body mode. dispatchCodeDefaultBody handles what the code-default mode
// CHANGES relative to free-text mode:
//   - whitespace between values is source FORMATTING (§4.18.5) — skipped,
//     it is not content (unlike a free-text body, where it would be a
//     text run);
//   - a `"` opens a DisplayTextLiteral — scanDisplayTextLiteral consumes
//     the whole literal (incl. `${...}` interpolations — MK3.3) and a
//     DisplayTextLiteral block is emitted;
//   - any other non-whitespace run is a candidate CODE run — it is
//     validated by the M2 expression parser; a run that does NOT parse as
//     valid code is bare prose -> E-UNQUOTED-DISPLAY-TEXT (§4.18.7).
//
// SCOPE — the FULL code-default body grammar (a real code-default-body
// AST node interleaving the parsed code expressions) is the MK4 markup<->JS
// seam. MK3.3 lands the §4.18 quoted-text surface: the `"..."` literal
// recognition + the E-UNQUOTED-DISPLAY-TEXT parse outcome. A valid-code
// bare run is consumed (the cursor advances past it) but its parsed Expr
// is NOT yet woven into a body node — that weaving is MK4. The
// DisplayTextLiteral block + the E-UNQUOTED diagnostic ARE the MK3.3
// deliverables; the code-run consumption keeps the trampoline progressing
// without misclassifying valid code as prose.
export function dispatchCodeDefaultBody(run, cursor, ctx) {
    // Whitespace between values in a code-default body is source
    // formatting (SPEC §4.18.5), not content — skip it. (A free-text
    // body would accumulate it into a text run; the two regimes split by
    // body mode, the §4.18.5 consequence.)
    const here = peekChar(cursor, 0);
    if (isBodyWhitespace(here)) {
        advance(cursor, 1);
        return;
    }

    // A `"` opens a display-text literal (SPEC §4.18.3). scanDisplayText
    // Literal consumes the whole literal — every literal-text segment +
    // every `${...}` interpolation (MK3.3) — and a DisplayTextLiteral
    // block is emitted carrying the node.
    if (here === doubleQuote()) {
        emitDisplayTextLiteral(cursor, ctx);
        return;
    }

    // Any other non-whitespace run is a candidate CODE run. Scan its
    // extent (to the next body-structural boundary) and validate it as
    // code via the M2 expression parser. A run that is NOT valid code is
    // bare prose — E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.7).
    emitCodeDefaultRun(cursor, ctx);
}

// isBodyWhitespace — calculation (predicate). A space / tab / carriage
// return / newline — whitespace that, BETWEEN values in a code-default
// body, is source formatting (SPEC §4.18.5).
export function isBodyWhitespace(ch) {
    return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

// emitDisplayTextLiteral — state write. The cursor is AT the opening `"`
// of a display-text literal in a code-default body. scanDisplayText
// Literal (display-text-literal.js) consumes the whole literal and
// produces the DisplayTextLiteral node (with its `{segments, exprs}` —
// §4.18.4); a DisplayTextLiteral block is appended to the block-stream.
//
// The DisplayTextLiteral node carries its own whole-literal span; the
// emitted block reuses it (the block's span IS the literal's span — the
// opening `"` through the closing `"`). The node is carried on the block
// as `.literal` so a downstream consumer (codegen's §4.18.6 auto-HTML-
// escape path) reads the segments + exprs.
export function emitDisplayTextLiteral(cursor, ctx) {
    const result = scanDisplayTextLiteral(cursor, ctx);
    const node = result.node;
    const k = blockKinds();
    const block = makeBlockNode(k.DisplayTextLiteral, node.span, null);
    // The DisplayTextLiteral node — the §4.18.4 `{segments, exprs}` carrier.
    block.literal = node;
    appendBlock(ctx, block);
}

// scanCodeDefaultRunExtent — calculation. The cursor is AT the first
// character of a candidate code run in a code-default body. Return the
// END offset of the run — the maximal stretch up to the next body-
// structural boundary: a `<` (a nested `<tag>` or a `</` closer), a `${`
// (a sigil context), a `"` (a display-text literal), the `}` that would
// close the body context at brace-depth 0, a `//` line comment, or EOF.
//
// The run between two structural boundaries is the unit the code-default
// body grammar classifies (valid code vs prose). The scan does NOT
// advance the live cursor — it reads ahead; the caller advances.
export function scanCodeDefaultRunExtent(cursor) {
    let i = cursor.pos;
    const src = cursor.source;
    const len = src.length;
    while (i < len) {
        const ch = src.charAt(i);
        // A `<` — a nested `<tag>` opener or a `</` closer. Either way the
        // bare run ends here.
        if (ch === "<") break;
        // A `"` — a display-text literal begins.
        if (ch === doubleQuote()) break;
        // A `${` — a sigil context (logic escape, etc.).
        if (ch === "$" && i + 1 < len && src.charAt(i + 1) === "{") break;
        // A `//` — a line comment.
        if (ch === "/" && i + 1 < len && src.charAt(i + 1) === "/") break;
        i = i + 1;
    }
    return i;
}

// emitCodeDefaultRun — state write. The cursor is AT the first character
// of a candidate code run in a code-default body. Scan the run's extent,
// validate it as code via the M2 expression parser, and either consume it
// (valid code — MK4 weaves the parsed Expr into a body node) or emit
// E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.7 — the run is bare prose).
//
// The validity test: lex the run, run the M2 expression parser, and
// require BOTH zero parser diagnostics AND that the parser consumed the
// WHOLE run (parseExpression parses ONE expression — a leftover non-EOF
// token means the run is more than one expression's worth of tokens,
// i.e. prose like `Ready to fetch`). A trailing-whitespace-only remainder
// is fine (the lexer drops inter-token whitespace). The cursor advances
// past the whole run in BOTH cases — progress is guaranteed; the
// diagnostic, not a stall, is the prose signal.
export function emitCodeDefaultRun(cursor, ctx) {
    const runStart = cursor.pos;
    const runLine = cursor.line;
    const runCol = cursor.col;
    const runEnd = scanCodeDefaultRunExtent(cursor);
    const runText = cursor.source.substring(runStart, runEnd);

    // A run that is only whitespace cannot occur here (dispatchCodeDefault
    // Body skips leading whitespace before calling this) — but stay
    // defensive: an empty run advances nothing, so guard the trampoline
    // sentinel by consuming one char.
    if (runEnd <= runStart) {
        advance(cursor, 1);
        return;
    }

    const valid = isValidCodeRun(runText);

    // Advance past the whole run (valid code OR prose — progress is
    // guaranteed either way; MK4 weaves a valid run's parsed Expr into a
    // code-default-body node).
    advance(cursor, runEnd - runStart);

    if (!valid) {
        // SPEC §4.18.7 — a bare run in a code-default body that is neither
        // valid code nor a `"..."` literal is E-UNQUOTED-DISPLAY-TEXT. The
        // diagnostic identifies the run and suggests the quoted form.
        const trimmed = runText.trim();
        const dq = doubleQuote();
        pushDiagnostic(ctx, makeDiagnostic(
            "E-UNQUOTED-DISPLAY-TEXT",
            "Display text in a code-default body must be a quoted " +
            "display-text literal. Did you mean " + dq + trimmed + dq + " ?",
            makeSpan(runStart, runEnd, runLine, runCol),
        ));
    }
}

// isValidCodeRun — calculation (predicate). Is `runText` a valid scrml
// expression per §4.18.2 (an identifier / keyword / call / member access /
// literal / `${...}`)? It is iff the M2 expression parser parses the WHOLE
// run with zero diagnostics. parseExpression parses ONE (sequence-level)
// expression; a leftover non-EOF token means the run is not a single
// expression's worth of tokens — bare prose (`Ready to fetch` lexes to
// three adjacent identifier tokens; parseExpression consumes only the
// first). An empty / whitespace-only run is vacuously not a code run
// (the caller never passes one — dispatchCodeDefaultBody skips
// whitespace), so this returns false for it.
export function isValidCodeRun(runText) {
    if (runText === undefined || runText === null) return false;
    if (runText.trim().length === 0) return false;
    const tokens = lex(runText);
    const exprCtx = makeParseExprContext(tokens);
    parseExpression(exprCtx);
    // Valid iff the parse produced no diagnostics AND consumed the whole
    // run (the token cursor is at the trailing EOF — no leftover token).
    return exprCtx.errors.length === 0 && atEnd(exprCtx.cursor);
}

// stampTagDepthAtOpen — state write. Record the current tag-tree depth
// on a freshly-entered BlockContext frame. MK2.2's context-scoped
// tag-recovery floor: a TagFrame opened while this brace context is open
// sits ABOVE this depth; on the context's close those frames are
// unterminated-within-the-context and are recovered (a markup tag cannot
// outlive its enclosing brace context).
export function stampTagDepthAtOpen(ctx, frame) {
    if (frame === null || frame === undefined) return;
    frame.tagDepthAtOpen = tagFrameDepth(ctx);
}

// recoverTagsInClosedContext — state write. A brace context just closed;
// recover every TagFrame opened SINCE it opened (above `tagDepthFloor`).
// Each such tag is unterminated within the context — drain it innermost-
// first, emitting its deferred Markup block ending at `closePos`. This
// runs BEFORE the context block is emitted, so the recovered Markup
// blocks precede (and are not spliced into) the context block.
//
// A tag opened inside a brace context that closes before the tag is a
// genuine structural error; MK2.2 recovers it (the deferred Markup block
// is still emitted). The closer-grammar diagnostic for it is the EOF /
// mismatch path — the context-scoped recovery here is a span-correctness
// measure, not a new diagnostic site.
export function recoverTagsInClosedContext(ctx, tagDepthFloor, closePos) {
    while (tagFrameDepth(ctx) > tagDepthFloor) {
        const frame = popTagFrame(ctx);
        if (frame === null) return;
        if (frame.kind === TagFrameKind.OpenSelfClosed) {
            emitMarkupElement(ctx, frame, frame.opener.span.start,
                frame.opener.span.end, []);
        } else {
            closeMarkupElement(ctx, frame, null, closePos);
        }
    }
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
//
// MK2.2 — closer recognition + tag-recovery are CONTEXT-SCOPED to this
// logic body. A markup tag opened inside `${ ... }` (markup-as-value)
// cannot CLOSE a tag opened outside it, and cannot OUTLIVE the logic
// context. The .InLogicEscape BlockContext frame's `tagDepthAtOpen`
// (stamped by stampTagDepthAtOpen at context-open) is the floor: only a
// closer when a tag is open ABOVE the floor pairs; on the context's
// close, recoverTagsInClosedContext recovers any tag still open above it.
export function dispatchInLogicEscape(run, cursor, ctx) {
    // The context-scoped tag floor — the tag-tree depth when THIS logic
    // context opened. A TagFrame above it was opened inside this body.
    const ctxFrame = topBlockContextFrame(ctx);
    const tagFloor = (ctxFrame !== null && ctxFrame.tagDepthAtOpen !== undefined)
        ? ctxFrame.tagDepthAtOpen
        : 0;

    // Matching close `}` of this logic-escape context?
    if (isBlockContextClose(ctx, cursor)) {
        const frame = closeBlockContext(ctx, cursor);
        // MK2.2 — recover any markup tag opened inside this logic body
        // that is still open (a tag cannot outlive its brace context).
        // BEFORE the context block is emitted, so the recovered Markup
        // blocks precede it (and are not spliced into it).
        recoverTagsInClosedContext(ctx, tagFloor, cursor.pos);
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

    // A markup closer (`</>` / `</name>`) — but ONLY when a tag is open
    // WITHIN this logic context (tagFrameDepth > the context-scoped
    // floor). The charter Q1.C contract permits a markup tag inside a
    // logic body (`${ <div> </div> }`); its matching closer must pair. A
    // `</` in a logic body with no tag open INSIDE it is ordinary body
    // content (§4.6 `<` suppression) — and a closer that would reach a
    // tag opened OUTSIDE this `${}` cannot cross the context boundary
    // (E-CTX-002 — a BlockContext-level concern, an MK2.3/MK4 seam, not
    // MK2.2). The floor enforces both.
    if (tagFrameDepth(ctx) > tagFloor && handleCloser(run, cursor, ctx)) return;

    // A nested context-entry boundary inside the body?
    const recognized = recognizeContextEntryAt(cursor);
    if (recognized.kind === "sigil") {
        const nested = enterBlockContext(ctx, cursor, recognized.enters, recognized.sigil);
        // MK2.2 — the nested context gets its own tag floor too.
        stampTagDepthAtOpen(ctx, nested);
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
        // F7.b — pass the cursor so an .InSql block's emitContextBlock can
        // advance it past the trailing `.method(args)` chain (the chain
        // bytes trail the `}` and belong to the Sql block).
        emitContextBlock(ctx, frame, cursor.pos, cursor);
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

// dispatchInMarkupTag — the `.InMarkupTag` state-child body (MK2.2 —
// opener recognition + TagFrame push + the tag-tree pairing seam).
//
// MK2.1 emitted a Markup block EAGERLY at the opener (boundary-then-opener
// granularity). MK2.2 produces the `<tag>` TREE — a Markup block spans the
// whole ELEMENT (opener + children + closer), and children nest under
// their parent. To do that the Markup-block emission for a non-self-
// closing opener is DEFERRED to the matching closer (closeMarkupElement);
// the opener only RECORDS where the element's children begin.
//
// The dispatch (the cursor is at the byte AFTER the `<` —
// enterMarkupTagContext consumed the `<` + pushed the .InMarkupTag
// BlockContext frame whose openSpan is the `<`'s span):
//   1. Pops the .InMarkupTag BlockContext frame — frame.openSpan is the
//      `<`'s span, the opener-span anchor.
//   2. Calls recognizeOpener (tag-frame.js) — tokenizes the opener BODY
//      (name + attributes + `>`) from the cursor, anchored at the `<`,
//      in one pass; computes the opener's TagKind; pushes a TagFrame.
//   3a. SELF-CLOSING opener (`<ident ... />`) — a complete element at the
//       opener. closeSelfClosedFrame completes the .OpenSelfClosed
//       lifecycle (pops the frame); a Markup block is emitted spanning
//       the opener (= the whole element — a self-closed tag has no
//       children).
//   3b. NON-SELF-CLOSING opener (`<ident ...>`) — the element awaits
//       children + a matching closer. The Markup block is NOT emitted
//       yet; the frame records `childStartIndex` (ctx.nodes.length right
//       now) so closeMarkupElement can splice the children out on close.
//   4. Restores @blockContext to the prior context.
//
// The TagFrame the opener pushed STAYS on ctx.tagFrameStack — that is the
// open-tag stack the closer recognizers (handleCloser) pop against.
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

    if (tagFrame.kind === TagFrameKind.OpenSelfClosed) {
        // 3a. A self-closing `<ident ... />` — a complete element at the
        //     opener. Complete the .OpenSelfClosed lifecycle (pop the
        //     frame) and emit the whole-element Markup block (the opener
        //     span IS the whole element — no children, no closer).
        closeSelfClosedFrame(ctx);
        emitMarkupElement(ctx, tagFrame, frame.openSpan.start,
            tagFrame.opener.span.end, []);
    } else {
        // 3b. A non-self-closing `<ident ...>` — the element awaits
        //     children + a matching closer. Defer the Markup block;
        //     record where this element's children begin so the matching
        //     closer can splice them out (the tag-tree pairing).
        tagFrame.childStartIndex = ctx.nodes.length;
    }

    // 4. Restore @blockContext to the prior context.
    setBlockContext(ctx, frame.priorContext);
}

// emitMarkupElement — state write. Emit ONE Markup block for a complete
// `<tag>` element, spanning [startPos, endPos] — the whole-element span
// (opener + children + closer). `children` is the element's child-block
// array (empty for a self-closing tag); it is carried as the Markup
// block's `children` payload — the `<tag>` TREE (charter Q1.G output).
//
// MK2.3 — the SINGLE element-emit locus, so it is where the
// TagKind-driven TagClass classification is stamped. classifyTagFrame
// computes the element's TagClass from `tagFrame`'s TagKind + the
// post-`>` inspection + `children`'s first-child TagClass (a
// typed-payload read — the recursive-descent close order means a child's
// TagClass is set before the parent emits). The Markup block carries
// `.tagClass`; a parent element's classifyTagFrame reads its child's
// `.tagClass` here, and NR (Stage 3.05) consumes it as the
// authoritative-resolution input.
export function emitMarkupElement(ctx, tagFrame, startPos, endPos, children) {
    const k = blockKinds();
    const block = makeBlockNode(
        k.Markup,
        makeSpan(startPos, endPos, tagFrame.opener.span.line, tagFrame.opener.span.col),
        null,
    );
    // The tag-tree payload — the element's name, the child blocks, and
    // the closer form that ended it (null for a self-closing element).
    block.name = tagFrame.name;
    block.children = children;
    block.closerForm = tagFrame.closerForm ?? null;
    // MK2.3 — the TagKind-driven TagClass (charter Q2.A #4 elimination).
    // Stamped on EVERY Markup block (self-closing, paired, and
    // EOF-/context-recovered paths all route through here), so a parent's
    // classification reads this child's payload.
    block.tagClass = classifyTagFrame(tagFrame, children);
    // F1 (v0.6) — the attribute payload. `tokenizeOpener` produced the
    // AttrNode[] AST + the raw ATTR_* token stream over the opener's
    // attribute region; carry both onto the Markup block so the M5 swap
    // exposes the live FileAST's `MarkupNode.attrs` shape directly (no
    // native↔live attribute translation layer). A malformed opener with
    // no descriptor yields empty arrays — the recovered Markup block is
    // still attribute-shaped.
    block.attrs = tagFrame.opener?.attrs ?? [];
    block.tokenizedAttrs = tagFrame.opener?.tokenizedAttrs ?? [];
    // F7.a (v0.6) — carry the opener's TagKind onto the Markup block. The
    // markup-vs-state discriminator: a `< Ident ...>` opener (space after
    // `<` — SPEC §4.3) gets TagKind.StateOpener. The M5 swap reads this to
    // route a StateOpener block to the live `state` / `state-constructor-def`
    // node shape rather than `markup`.
    block.tagKind = tagFrame.tagKind ?? null;
    // F7.a — when the opener is a state opener, stamp the state payload
    // (stateNodeKind / stateType / typedAttrs — the live StateNode /
    // StateConstructorDefNode shape). A non-state Markup block is untouched.
    if (block.tagKind === "StateOpener") {
        shapeStateBlock(block);
    }
    appendBlock(ctx, block);
}

// closeMarkupElement — state write. The opener/closer PAIRING emit. The
// closer has just popped `tagFrame` (an .OpenExpectingChildren frame)
// off the TagFrame stack. The blocks emitted into ctx.nodes since the
// opener (from tagFrame.childStartIndex to the end) ARE this element's
// children — splice them out and nest them under one whole-element
// Markup block spanning [opener.<, closerEnd].
export function closeMarkupElement(ctx, tagFrame, closerForm, closerEnd) {
    const startIndex = tagFrame.childStartIndex ?? ctx.nodes.length;
    // Splice the children out of the flat node stream.
    const children = ctx.nodes.splice(startIndex, ctx.nodes.length - startIndex);
    tagFrame.closerForm = closerForm;
    emitMarkupElement(ctx, tagFrame, tagFrame.opener.span.start, closerEnd, children);
}

// handleCloser — state write. Recognize + consume a closer at the
// cursor and perform the opener/closer pairing. Returns true if a closer
// was recognized + handled, false if no closer opener is at the cursor.
//
// The closer forms (`</>` / `</name>`) are recognized STRUCTURALLY by
// tag-frame.js's recognizeCloserForm — a closed set, no `looksLikeCloser`
// bare-`/` guess. The pairing:
//   - tokenizeCloser consumes the closer token (the cursor advances past
//     the `>`);
//   - closeTagFrame pops the matching TagFrame (the `.Open* -> .Closed`
//     transition) — on a clean pop, closeMarkupElement emits the
//     whole-element Markup block with its children nested;
//   - on a mismatch / stray closer closeTagFrame has already dispatched
//     ErrorRecovery + recorded the diagnostic; the trampoline resumes
//     (the closer is consumed — progress is guaranteed).
//
// The text run is flushed before the closer so the block-stream order is
// children-then-(parent emitted on close).
export function handleCloser(run, cursor, ctx) {
    const form = recognizeCloserForm(cursor);
    if (form === null) return false;

    // A closer ends the current text run (the run is a child of the
    // element being closed — flush it before the pairing splice).
    flushTextRun(run, cursor, ctx);

    // Consume the closer token — the cursor advances past the `>`.
    const closer = tokenizeCloser(cursor);

    // Pair the closer with its open TagFrame.
    const result = closeTagFrame(ctx, closer);
    if (result.ok && result.popped !== null) {
        // A clean pop — emit the whole-element Markup block with the
        // children (the blocks emitted since the opener) nested.
        closeMarkupElement(ctx, result.popped, closer.form, closer.span.end);
    }
    // A mismatch / stray closer: closeTagFrame recorded the E-MARKUP-002
    // / E-CTX-003 diagnostic + dispatched ErrorRecovery. The closer is
    // consumed; the trampoline resumes (no Markup block — recovery).
    return true;
}

// isTagNameChar — calculation (predicate). A character that may continue a
// markup-tag name run: ASCII letter, ASCII digit, or `-`. MK2.1 made
// tag-frame.js the canonical home of the tag-name grammar; this file's
// isTagNameChar mirrors that canonical body 1:1 so existing importers
// (parser-conformance-markup.test.js, MK1.2 suite) keep a single
// binding. K9 (S114): the .scrml form inlines the body (the previous
// `import { isTagNameChar as tagNameCharCanonical }` aliased import
// tripped E-SCOPE-001 — SPEC §21); the .js shadow inlines too so the
// pair stays 1:1. If the canonical grammar ever changes, update BOTH
// this file and tag-frame.js (.scrml + .js).
export function isTagNameChar(ch) {
    if (ch === "") return false;
    if (ch === "-") return true;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;
    if (c >= 65 && c <= 90) return true;
    if (c >= 97 && c <= 122) return true;
    return false;
}

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
    // MK4 — thread the source onto the ctx so emitContextBlock can slice a
    // logic-escape body's text for the markup->JS delegate-down direction
    // (R1 spike §3 seam contract). The source is the SAME string the cursor
    // walks; this is a read-only reference, not a copy (one buffer, one
    // coordinate space — punch-list P2 one-cursor invariant).
    ctx.source = source;
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

    // EOF — flush any open text run. (A brace-delimited context still
    // open at EOF is an unterminated context — it emits NO block and its
    // frame stays on ctx.blockContextStack as the MK4 blame locus; see
    // the header.)
    flushTextRun(run, cursor, ctx);

    // MK2.2 — close out any unterminated `<tag>` elements. A TagFrame
    // still on ctx.tagFrameStack at EOF is an unterminated tag (the
    // opener was never paired with a closer): SPEC §4 line 1072 — the
    // BS oracle emits E-CTX-001 against the opener AND still emits the
    // markup block (closerForm `inferred`). closeUnterminatedTags does
    // both — reportUnterminatedTags records one E-CTX-001 per open
    // frame, and the deferred Markup blocks are emitted (recovery).
    closeUnterminatedTags(ctx, cursor.pos);

    return { ctx, contextTrace };
}

// closeUnterminatedTags — state write. The EOF recovery for unterminated
// `<tag>` elements (SPEC §4 line 1072). For each TagFrame still open at
// EOF (innermost first): record an E-CTX-001 diagnostic against the
// opener (reportUnterminatedTags does the recording) and emit the
// deferred Markup block spanning [opener.<, EOF] with its accumulated
// children. The element is recovered as if an inferred `</>` closed it
// at end-of-input.
export function closeUnterminatedTags(ctx, eofPos) {
    // Record the E-CTX-001 diagnostics for every still-open frame.
    reportUnterminatedTags(ctx);

    // Drain the TagFrame stack innermost-first, emitting each deferred
    // Markup block. A self-closed frame left on the stack at EOF (its
    // lifecycle never completed) is also emitted as a (boundary) block.
    let frame = popTagFrame(ctx);
    while (frame !== null) {
        if (frame.kind === TagFrameKind.OpenSelfClosed) {
            // A self-closed opener whose lifecycle the trampoline never
            // completed — emit the opener-span Markup block (no
            // children, no closer).
            emitMarkupElement(ctx, frame, frame.opener.span.start,
                frame.opener.span.end, []);
        } else {
            // An .OpenExpectingChildren element — recover as if `</>`
            // closed it at EOF; the children are the blocks emitted
            // since the opener.
            closeMarkupElement(ctx, frame, null, eofPos);
        }
        frame = popTagFrame(ctx);
    }
}
