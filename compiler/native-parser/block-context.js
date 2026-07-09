// block-context.js — JS-host shadow of block-context.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors block-context.scrml's header.
//
// BlockContext is the markup-layer context-grid engine (charter Q1.C) —
// the top-level engine of the markup-layer engine graph. It is to the
// markup layer what LexMode is to the JS layer.
//
// MK1.3 SCOPE: the engine declaration is complete (all 9 variants, full
// rule= contract — see the .scrml). MK1.1/MK1.2 made context-entry +
// transition substantive (the seven block-opener sigils, brace-depth
// closing, the `<ident` markup-tag boundary, the .InLogicEscape
// DelegationFrame). MK1.3 adds STRUCTURAL COMMENT RECOGNITION — the `//`
// line comment + `<!-- -->` HTML comment recognized by a closed sigil
// test, NOT by the block-splitter's heuristic quote-flag /
// orphanBraceDepth gate (charter Q2.A #6/#7 elimination). See the
// COMMENT RECOGNITION section at the bottom of this file; the
// recognizers are pure calculations (recognizeCommentForm /
// lineCommentExtent / htmlCommentExtent) — the trampoline consumes.
//
// MK2.1 amendment: the TagFrame <tag>-tree engine lands in tag-frame.js
// (a SIBLING engine of BlockContext — it tracks the open-tag stack
// ACROSS .InMarkupTag entries; charter Q1.G). BlockContext itself is
// UNCHANGED at MK2.1 — enterMarkupTagContext keeps its MK1.2 contract
// (consume the `<`, push the .InMarkupTag frame). MK2.1's opener
// tokenizer (tag-frame.js's tokenizeOpener) tokenizes the opener BODY
// from the byte AFTER the `<`, reading the .InMarkupTag frame's openSpan
// as the opener-span anchor.

import { peekChar, peekStr, advance } from "./cursor.js";
import { makeSpan } from "./span.js";
// K9 (S114) — de-aliased to mirror the .scrml import form (SPEC §21:
// unquoted-name `import {x}` binds literally; aliasing requires the
// quoted-name form). Call sites below renamed: pushBracket -> push,
// popBracket -> pop, bracketDepth -> depth.
import {
    push,
    pop,
    depth,
    BracketKind,
} from "./bracket-stack.js";
// K9 (S114) — moved from "./parse-ctx.js" to break the
// block-context.js <-> parse-ctx.js circular import. See
// delegation-frame.js header for the K9 rationale (mirrors K2).
import {
    delegationKinds,
    closeOnBraceDepth,
    makeDelegationFrame,
    pushDelegationFrame,
    popDelegationFrame,
} from "./delegation-frame.js";
// MK3.1 — punch-list P7: thread the §4.18 body mode into every markup->JS
// DelegationFrame. currentBodyMode reads the innermost open TagFrame's
// bodyMode payload (a plain ctx data field — no tag-frame.js import, so
// no import cycle). body-mode.js imports nothing, so block-context.js ->
// body-mode.js is acyclic.
import { currentBodyMode } from "./body-mode.js";

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
// followed by an ASCII letter OR `_` opens a markup-tag context. SPEC
// §4.1 (line 307) normative: "any `<` immediately followed by an ASCII
// letter or underscore (with zero intervening characters)" — the live
// oracle `compiler/src/block-splitter.js:1617` admits `/[A-Za-z_]/` here
// for the same reason. The deep tag-tree recognition is MK2 — this only
// recognizes the boundary. Wave 6 Unit A added the `_` admission so
// `<_>` (the match block-form wildcard arm opener) is recognized as the
// start of a markup-tag context, not silently emitted as text.
export function isMarkupTagOpener(lessThanChar, nextChar) {
    if (lessThanChar !== "<") return false;
    if (nextChar === "_") return true;
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

    const depthAtOpen = depth(ctx.brackets);

    // Consume the two sigil characters.
    advance(cursor, sigil.length);

    // Push a Brace frame for the sigil's `{`. The `{` is a real brace; inner
    // `{`/`}` push/pop against this same stack so the matching close is a
    // pure depth calculation.
    push(
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
        // PUNCH-LIST P7 (MK3.1) — thread the §4.18 body mode into the
        // markup->JS DelegationFrame. The mode is currentBodyMode(ctx) —
        // the mode of the innermost enclosing markup/state body (the
        // body the `${...}` logic-escape sits inside; SPEC §4.18.1
        // statement 3). The JS layer reads this frame field so the
        // display-text rules for the delegated body are known (MK4 wires
        // the JS-parse delegation that consumes it). MK1.2 carried `null`
        // here as a placeholder; MK3.1 supplies the real mode.
        const frameDelegation = makeDelegationFrame(
            kinds.LogicEscape,
            closeOnBraceDepth(depthAtOpen),
            openSpan,
            currentBodyMode(ctx),
        );
        pushDelegationFrame(ctx, frameDelegation);
    }

    setBlockContext(ctx, context);
    return frame;
}

// enterMarkupTagContext — STATE transition. The `<ident` markup-tag-context
// boundary. Recognizes + transitions on the BOUNDARY; the actual `<tag>`
// TREE (opener/closer pairing, TagFrame) is MK2.
//
// Unlike a block-opener sigil, a markup tag is NOT brace-delimited — the tag
// context closes on a TagFrame-balanced condition (MK2's datum), not a
// brace-depth-0 `}`. The pushed frame carries a sentinel depthAtOpen of -1
// ("not brace-delimited — closes via MK2's TagFrame, not a `}`").
//
// Consumes ONLY the `<` (the boundary marker). The frame's openSpan spans the
// `<` (one char) — MK2.1's opener tokenizer reads it as the opener-span
// anchor (tokenizeOpener tokenizes the opener BODY — name + attributes + `>`
// — from the byte AFTER the `<`; the openSpan anchor lets the opener's span
// still cover the `<`). The openSpan is also the unterminated-tag blame locus.
//
// Returns the pushed BlockContext frame.
export function enterMarkupTagContext(ctx, cursor) {
    const openSpan = makeSpan(cursor.pos, cursor.pos + 1, cursor.line, cursor.col);

    // Consume the `<` boundary marker only — the tag name + the attributes +
    // the `>` are MK2's (tokenizeOpener, run from parse-markup's .InMarkupTag
    // dispatcher).
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
    return depth(ctx.brackets) === frame.depthAtOpen + 1;
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
    pop(ctx.brackets);

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
    push(
        ctx.brackets,
        BracketKind.Brace,
        makeSpan(cursor.pos, cursor.pos + 1, cursor.line, cursor.col),
    );
}

// noteBraceClose — STATE write. Pop a Brace frame for an ordinary `}` in a
// block-context body (a `}` that is NOT the context's matching close —
// isBlockContextClose returned false for it).
export function noteBraceClose(ctx) {
    pop(ctx.brackets);
}

// ===========================================================================
// MK1.3 — COMMENT RECOGNITION (structural, not heuristic).
//
// SPEC §27.2 names two comment forms: the `//` line comment and the
// `<!-- -->` HTML markup-comment. The block-splitter recognizes them with two
// heuristics — #6 (`//`-comment suppression, block-splitter.js:972-992;
// gated by quote flags + an orphanBraceDepth check) and #7 (`<!-- -->`
// suppression, block-splitter.js:1014-1052; gated by quote flags +
// !topIsBraceContext()). Both guesses exist because the BS is a single
// linear scan WITHOUT a grammar.
//
// The native parser COMPUTES instead (charter Q2.A): a comment is recognized
// by a closed sigil test, and where a comment is legal is a fact of the
// BlockContext (and, from MK3, the BodyMode). The recognizers below are the
// heuristic-elimination contract; the trampoline (parse-markup.js) consults
// them in the contexts where a comment is legal and never consults a quote
// flag.
//
// PILLAR 5b: CommentForm is PURE DATA (a recognizer tag). recognizeCommentForm
// / lineCommentExtent / htmlCommentExtent / commentExtent are CALCULATIONS
// (pure fns over the cursor's position — no state write, no cursor advance).
// ===========================================================================

// CommentForm — pure data tags. The two SPEC §27.2 comment forms.
export const CommentForm = Object.freeze({
    Line: "Line",
    Html: "Html",
});

// doubleSlash / htmlCommentOpen / htmlCommentClose — calculation. The comment
// sigil strings. Mirror the .scrml's String.fromCharCode assembly form 1:1
// (the .scrml uses the assembly form per the README ANOMALY-1 class, keeping
// the pair 1:1 with the closingBrace / openBrace concat shape).
export function doubleSlash() {
    return String.fromCharCode(47) + String.fromCharCode(47);
}
export function htmlCommentOpen() {
    return "<" + "!" + String.fromCharCode(45) + String.fromCharCode(45);
}
export function htmlCommentClose() {
    return String.fromCharCode(45) + String.fromCharCode(45) + ">";
}

// recognizeCommentForm — calculation. Returns the CommentForm a comment
// STARTING at the cursor would be, or null if no comment opener is at the
// cursor. A closed sigil test — the heuristic-elimination shape (Q2.A #6/#7).
// Does NOT advance the cursor and does NOT decide where a comment is legal
// (that is the trampoline's per-context dispatch).
export function recognizeCommentForm(cursor) {
    if (peekStr(cursor, 2) === doubleSlash()) return CommentForm.Line;
    if (peekStr(cursor, 4) === htmlCommentOpen()) return CommentForm.Html;
    return null;
}

// lineCommentExtent — calculation. Given a cursor at a `//` opener, return
// the END offset of the comment (one past its last consumed character).
//
// A `//` line comment runs from the `//` to the line terminator. The BS
// oracle (block-splitter.js:979-980) INCLUDES the `\n` in the comment's raw
// slice — it scans to the newline then consumes it. lineCommentExtent matches:
// the returned end is one past the `\n` (or the source length if the comment
// runs to EOF with no newline).
export function lineCommentExtent(cursor) {
    const source = cursor.source;
    const len = source.length;
    let p = cursor.pos;
    // Scan to the line terminator (do not include it yet).
    while (p < len && source.charCodeAt(p) !== 10) {
        p = p + 1;
    }
    // Consume the newline too, if present (BS-oracle parity).
    if (p < len) {
        p = p + 1;
    }
    return p;
}

// htmlCommentExtent — calculation. Given a cursor at a `<!--` opener, return
// the END offset of the comment (one past the closing `-->`, or the source
// length if the comment runs to EOF without a closer).
//
// Nested HTML comments are not a thing per the HTML spec — the first `-->`
// closes (BS-oracle parity, block-splitter.js:1030-1036). An unterminated
// `<!--` runs to EOF (best-effort recovery — the same disposition the BS
// uses; an unterminated-comment diagnostic is a later milestone, matching the
// M1 string-body precedent).
export function htmlCommentExtent(cursor) {
    const source = cursor.source;
    const len = source.length;
    const close = htmlCommentClose();
    // Start scanning past the four-character `<!--` opener.
    let p = cursor.pos + 4;
    while (p < len) {
        if (source.substr(p, 3) === close) {
            return p + 3;
        }
        p = p + 1;
    }
    // Unterminated — runs to EOF.
    return len;
}

// commentExtent — calculation. Dispatch on the recognized CommentForm: the
// END offset of the comment at the cursor. Returns null if no comment opener
// is at the cursor.
export function commentExtent(cursor) {
    const form = recognizeCommentForm(cursor);
    if (form === null) return null;
    if (form === CommentForm.Line) return lineCommentExtent(cursor);
    return htmlCommentExtent(cursor);
}

// urlSlashesAt — calculation. TRUE when the `//` at the cursor is part of a URL
// VALUE (a scheme separator `://`, or inside a CSS `url(...)` token) rather than
// a `//` line comment. Mirrors the JS block-splitter's urlSlashesAt.
//
// SPEC §27.1 keeps `//` a UNIVERSAL comment valid in ALL contexts, but a bare
// URL is DATA, not a comment: markup prose (`Visit http://x`) must not have its
// `//` eaten as a Line comment (swallowing the line's `</p>` closer → spurious
// E-MARKUP-002 / E-CTX-001). The markup trampoline (emitComment) consults this
// so a prose URL survives as text. Logic bodies (`${...}`, dispatchInLogic)
// keep JS `//` semantics — their URLs are quoted strings — so they do NOT
// consult this. Pure: reads cursor.source around cursor.pos, no advance/write.
export function urlSlashesAt(cursor) {
    const source = cursor.source;
    const slashPos = cursor.pos;
    // (a) Scheme separator: a `:` immediately before the `//`.
    if (slashPos > 0 && source.charAt(slashPos - 1) === ":") return true;
    // (b) Inside a CSS `url(...)` token on the current physical line.
    let lineStart = slashPos;
    while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) {
        lineStart = lineStart - 1;
    }
    let inUrl = false;
    for (let i = lineStart; i < slashPos; i = i + 1) {
        if (inUrl) {
            if (source.charAt(i) === ")") inUrl = false;
            continue;
        }
        // Detect a `url(` token (case-insensitive) at an identifier boundary —
        // so `curl(` / `blur(` do not false-match.
        if (
            (source.charAt(i) === "u" || source.charAt(i) === "U") &&
            (source.charAt(i + 1) === "r" || source.charAt(i + 1) === "R") &&
            (source.charAt(i + 2) === "l" || source.charAt(i + 2) === "L") &&
            source.charAt(i + 3) === "("
        ) {
            const before = i > 0 ? source.charAt(i - 1) : "";
            if (!/[A-Za-z0-9_\-]/.test(before)) {
                inUrl = true;
                i = i + 3;
            }
        }
    }
    return inUrl;
}
