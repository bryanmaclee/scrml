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
    CloserForm,
    tokenizeCloser,
    closeTagFrame,
    closeSelfClosedFrame,
    tagFrameDepth,
    popTagFrame,
    topTagFrame,
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
// `isStateBlock` is the recognition predicate — it ALSO matches the no-space
// `<db>` / `<schema>` lifecycle-keyword form (the live `_STATE_FORM_LIFECYCLE`
// name-set), so the shaping runs for both opener forms at any nesting depth.
import { shapeStateBlock, isStateBlock } from "./parse-state-body.js";
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

// isTopLevelEmittingContext — calculation (predicate). M5 gap-ledger 2b.
// A just-closed brace context emits a TOP-LEVEL block ONLY when its
// `priorContext` is `.TopLevel` (a file-level `${...}` / `?{...}` / ...)
// or `.InMarkupTag` (a context inside a markup element body — the closer
// path's `closeMarkupElement` splices it under the element on close).
//
// A context whose `priorContext` is ITSELF a brace-delimited context
// (`.InLogicEscape` / `.InSql` / ...) is NESTED inside another body —
// `${ a ${ b } c }` / `${ a ?{ q } b }`. It does NOT emit a top-level
// block: the live BS folds the inner block into the ENCLOSING context's
// verbatim body (`popBraceContext` pushes a nested brace block into the
// PARENT frame's children, never `rootBlocks`). The native parser has a
// flat top-level block-stream, so the faithful analogue is to suppress
// the inner block's emission — its bytes are already inside the outer
// context's `bodyText` slice.
export function isTopLevelEmittingContext(priorContext) {
    return priorContext === BlockContext.TopLevel
        || priorContext === BlockContext.InMarkupTag;
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
//
// P5-12b — TIGHTEN: the bare letter-start test was over-admissive. The
// `< p.low_stock_threshold)` substring in `@products.filter(p => p.stock_qty
// < p.low_stock_threshold).length` matched (`<`, ws, `p` — a letter), so
// the predicate admitted it as a state-opener boundary. The opaque opener
// scan then phantom-opened a state frame the file never closes (an
// arrow-body less-than comparison is a code expression, not a tag).
//
// The tighten: after the tag-name-start letter, walk the maximal tag-name
// run, then require the FIRST non-tag-name char to be a tag-shape
// terminator — whitespace, `>`, `/`, `=`, or EOF. A `.`, `(`, `,`, `+`,
// `-`, `*`, etc. immediately after the identifier proves this is an
// expression (`< p.low_*`, `< n+1`, `< fn()`), not a `< Ident ...>` opener.
//
// Mirrors live block-splitter's `\s/.test(next)` rule TIGHTER — live admits
// the same broken shapes, but its `scanAttributes` keeps consuming until
// EOF, so the phantom-state silently swallows the rest of the file in a
// way the canary diff happens to compare clean here. Native's P5-12 abort
// stops the scan at the first depth-0 closer, so the phantom-state is
// closed early; the structural divergence surfaces in the deep-seq diff.
// Tightening the boundary predicate eliminates the admission entirely, the
// correct behaviour for both pipelines.
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
    if (!isAsciiTagNameStart(ch)) return false;
    // P5-12b — walk the maximal tag-name run and require a tag-shape
    // terminator after it. `< p.` is rejected (`.` after the identifier);
    // `< db src=...>` is admitted (whitespace after `db`).
    k = k + 1;
    ch = peekChar(cursor, k);
    while (isTagNameContinue(ch)) {
        k = k + 1;
        ch = peekChar(cursor, k);
    }
    // After the identifier the next char must be a tag-shape terminator.
    // Whitespace / `>` / `/` / `=` (attribute) / EOF — anything else
    // (`.`, `(`, `,`, `+`, `-`, ...) proves this is an expression.
    if (ch === "" || ch === undefined || ch === null) return true;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") return true;
    if (ch === ">" || ch === "/" || ch === "=") return true;
    return false;
}

// isTagNameContinue — calculation (predicate). A continuation character
// for a markup/state tag name — ASCII letter, digit, `_`, or `-`. Mirrors
// block-splitter.js's readIdent regex `[A-Za-z0-9_\-]`.
export function isTagNameContinue(ch) {
    if (ch === "" || ch === undefined || ch === null) return false;
    if (ch === "_" || ch === "-") return true;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;                           // 0-9
    if (c >= 65 && c <= 90) return true;                           // A-Z
    if (c >= 97 && c <= 122) return true;                          // a-z
    return false;
}

// isAsciiTagNameStart — calculation (predicate). The state-opener name's
// first char — an ASCII letter OR `_`. SPEC §4.1 (line 307) normative:
// the tag-name start char is letter-or-underscore (live oracle
// `compiler/src/block-splitter.js:1617`). Wave 6 Unit A added `_` so
// `< _name>` (space + underscore + name + tag terminator) composes
// correctly with P5-12b's `isStateTagBoundaryAfterLt` tighten — the
// post-ws letter check now admits `_`, the post-ident terminator check
// then rejects `< _.foo` (`.` after the ident proves it's an expression).
export function isAsciiTagNameStart(ch) {
    if (ch === "" || ch === undefined || ch === null) return false;
    if (ch === "_") return true;
    const c = ch.charCodeAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// P5-1 — STATE-DECL OPENER SUPPRESSION ---------------------------------------
//
// The native trampoline recognizes `<query debounced=300ms> = ""` (SPEC §6.2
// Shape-1 state-decl) as a `<query>` MARKUP element opener — it enters
// `.InMarkupTag` and consumes every following sibling as the element's
// children, collapsing the whole `<program>` body into one unclosed
// `Markup<query>` block. The LIVE pipeline does NOT: block-splitter.js's
// `peekTopLevelStateDeclSignal` (L529) peeks past the opener's `>` for a
// state-decl signal (`= expr` — not `==` / `=>` — or `: T`) and, when it
// fires at a declaration site, emits the line as a `text` block instead of a
// markup opener. `liftBareDeclarations`'s `TOPLEVEL_STATE_DECL_RE` then lifts
// that text block into a synthetic `logic` node.
//
// `isStateDeclOpenerAt` is the native analogue of `peekTopLevelStateDeclSignal`
// — a non-mutating cursor peek. The trampoline (`dispatchTopLevel`) consults it
// at a `<ident` boundary: when the cursor sits at a declaration site (file
// top-level OR a `<program>` / `<page>` / `<channel>` direct-child body) AND
// the opener's `>` is followed by a state-decl signal, the markup-tag entry is
// SUPPRESSED — the `<` falls through to the text-run accumulator and the
// downstream `liftBareBlocks` `TOPLEVEL_STATE_DECL_RE` rule lifts it, exactly
// as the live pipeline does.

// isStateDeclOpenerAt — calculation (predicate, non-mutating cursor peek). The
// cursor is AT a `<` that `isMarkupTagOpener` already accepted as a `<ident`
// opener. Peek past the opener body to its `>`, then past horizontal
// whitespace: a `=` (not `==` / `=>`) or a `:` is the state-decl signal (SPEC
// §6.2 Shape 1 / §35.2 typed-decl). A `/>` self-closer or no signal -> false.
// A VERBATIM port of block-splitter.js's `peekTopLevelStateDeclSignal` (L529)
// — the live oracle's recognition. The opener-body scan mirrors that oracle's
// brace / paren / string balancing so an attribute value containing `>` (a
// `={ a > b }` expression attr, a quoted `">"`) does not end the scan early.
export function isStateDeclOpenerAt(cursor) {
    const src = cursor.source;
    const len = src.length;
    let p = cursor.pos + 1; // past `<`
    // Read the tag-name identifier.
    while (p < len && isTagNameChar(src.charAt(p))) p = p + 1;
    if (p === cursor.pos + 1) return false; // no ident — not a `<ident` opener
    // Skip the opener's attribute region up to its `>` — balance braces,
    // parens, and quoted strings so a `>` inside an attr value is not the
    // opener's close.
    let braceDepth = 0;
    let parenDepth = 0;
    let inDouble = false;
    let inSingle = false;
    while (p < len) {
        const c = src.charAt(p);
        if (braceDepth > 0) {
            if (c === "{") braceDepth = braceDepth + 1;
            else if (c === "}") braceDepth = braceDepth - 1;
            p = p + 1;
            continue;
        }
        if (parenDepth > 0) {
            if (c === "(") parenDepth = parenDepth + 1;
            else if (c === ")") parenDepth = parenDepth - 1;
            p = p + 1;
            continue;
        }
        if (!inDouble && !inSingle) {
            if (c === ">") { p = p + 1; break; }
            // A `/>` self-closer is a markup leaf — never a state-decl.
            if (c === "/" && p + 1 < len && src.charAt(p + 1) === ">") return false;
            // A sigil-prefixed brace context (`${ ?{ #{ !{ ^{ ~{`) inside an
            // attr value — enter brace-depth balancing.
            if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~")
                && p + 1 < len && src.charAt(p + 1) === "{") {
                braceDepth = 1;
                p = p + 2;
                continue;
            }
            if (c === "{") { braceDepth = braceDepth + 1; p = p + 1; continue; }
            if (c === "(") { parenDepth = parenDepth + 1; p = p + 1; continue; }
            if (c === "\"") { inDouble = true; p = p + 1; continue; }
            if (c === "'") { inSingle = true; p = p + 1; continue; }
        } else if (inDouble && c === "\"") { inDouble = false; p = p + 1; continue; }
        else if (inSingle && c === "'") { inSingle = false; p = p + 1; continue; }
        else if (c === "\\") { p = p + 2; continue; }
        p = p + 1;
    }
    if (p > len) return false; // ran past EOF — no `>`
    // Skip HORIZONTAL whitespace only — a newline ends the statement, so a
    // signal on the next line is NOT this opener's state-decl signal.
    while (p < len && (src.charAt(p) === " " || src.charAt(p) === "\t")) p = p + 1;
    if (p >= len) return false;
    const sig = src.charAt(p);
    if (sig === "=") {
        const nxt = p + 1 < len ? src.charAt(p + 1) : "";
        // `==` is comparison, `=>` is an arrow — neither is a decl signal.
        if (nxt === "=" || nxt === ">") return false;
        return true;
    }
    if (sig === ":") {
        // A `:` after the opener is the §35.2 typed-state-decl signal.
        return true;
    }
    return false;
}

// atStateDeclSite — calculation (predicate). Is the trampoline at a
// declaration site — file top-level (no open TagFrame) OR a `<program>` /
// `<page>` / `<channel>` direct-child body? Mirrors the live oracle's
// `peekTopLevelStateDeclSignal` gate (block-splitter.js L1667 — fires when
// `stack.length === 0 || isChannelBody || isProgramBody || isPageBody`) and
// the `liftBareBlocks` `isProgramFamilyRoot` declaration-site set. A state-decl
// opener inside ANY other markup element is prose — the suppression is gated
// off so ordinary `<div> = …`-shaped prose markup is untouched.
export function atStateDeclSite(ctx) {
    const frame = topTagFrame(ctx);
    if (frame === null || frame === undefined) return true; // file top-level
    const name = typeof frame.name === "string" ? frame.name : "";
    return isProgramFamilyRoot(name);
}

// peekTagNameLower — calculation. The cursor sits at a `<` markup-tag
// opener; return the LOWERCASED tag name (the `isTagNameChar` run after
// `<`), or "" when no name char follows. Used by the `<style>` recognizer
// in dispatchTopLevel — peeking the name without consuming the opener.
export function peekTagNameLower(cursor) {
    let k = 1;
    let name = "";
    let ch = peekChar(cursor, k);
    while (isTagNameChar(ch)) {
        name = name + ch;
        k = k + 1;
        ch = peekChar(cursor, k);
    }
    return name.toLowerCase();
}

// scanPastStyleBlock — calculation. The cursor sits at a `<style` opener.
// Return the offset just past the matching `</style>` closer (case-
// insensitive), or the source length when no closer materializes (an
// unterminated `<style>` runs to EOF — the live BS does the same: its
// scan loop at block-splitter.js L1732-1738 terminates at `</style>` OR
// `len`).
export function scanPastStyleBlock(cursor) {
    const src = cursor.source;
    const len = src.length;
    let p = cursor.pos;
    while (p < len) {
        if (src.charAt(p) === "<" && src.substr(p, 8).toLowerCase() === "</style>") {
            return p + 8;
        }
        p = p + 1;
    }
    return len;
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

    // M5 gap-ledger 2b — emit the context block to the top-level stream
    // ONLY when this context sits at top level (or directly inside a
    // markup body). A context nested inside another brace context
    // (`${ ... ${ ... } ... }`, `${ ... ?{ ... } ... }`) is NOT a
    // top-level block — its bytes are folded into the enclosing
    // context's `bodyText`. The body-slice extraction + the F7.b SQL
    // chain-advance side-effects above ALL still run (the suppression is
    // ONLY the top-level append) so cursor progress + nested-context
    // bookkeeping are unaffected.
    if (isTopLevelEmittingContext(frame.priorContext)) {
        appendBlock(ctx, block);
    }
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
export function parseLogicBodyBestEffort(bodyText, ctx, bodyAbsStart, bodyAbsLine, bodyAbsCol) {
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

// --- P4-3 — the ORPHAN-BRACE counter ----------------------------------------
//
// `markupOrphanBraceDepth` / `handleOrphanBrace` are the native analogue of
// the live block-splitter's `orphanBraceDepth` (block-splitter.js L223). A
// bare `{` sitting directly in markup-child position (no preceding sigil) is
// the body-opener of an inline control-flow / expression construct (`match`,
// `for`, an `&&` ghost) — its body is one verbatim run the downstream lift
// pass re-parses, NOT a markup subtree. While the counter is `> 0`,
// dispatchTopLevel suppresses every structural recognizer (see its header).

// markupOrphanBraceDepth — calculation (read). The current orphan-brace
// nesting depth. The counter is lazily initialized on `ctx` — a ctx from an
// older makeParseContext has no slot, so a missing slot reads as 0.
export function markupOrphanBraceDepth(ctx) {
    if (ctx === null || ctx === undefined) return 0;
    const d = ctx.markupOrphanBraceDepth;
    return (typeof d === "number" && d > 0) ? d : 0;
}

// handleOrphanBrace — state write. Recognize a bare `{` / `}` at the cursor
// and maintain the orphan-brace counter. Returns true when a brace was
// recognized + consumed (the `{` / `}` is accumulated as TEXT — it is
// expression-body content, not a structural block boundary), false otherwise.
//
//   `{`  — opens (or nests) an orphan-brace region; the counter increments.
//          A `${` / `?{` / ... is a SIGIL — its `{` is the second char of a
//          two-char sigil, never the cursor char here (recognizeContextEntryAt
//          runs the sigil path before any bare-`{` could be seen, and at
//          depth 0 this helper is called first; a `{` whose PRECEDING char is
//          a sigil sigil-char was already consumed by the sigil path). So a
//          `{` reaching this helper is genuinely bare.
//   `}`   — closes an orphan-brace region when the counter is `> 0`; the
//          counter decrements. A `}` at depth 0 is NOT consumed here (it is a
//          stray close brace — left to the existing fall-through text path,
//          matching the live BS which records E-CTX-001 for it; the native
//          layer's stray-`}` diagnostic is a later milestone, so depth-0 `}`
//          simply falls through to text, the trampoline's current behaviour).
export function handleOrphanBrace(run, cursor, ctx) {
    const here = peekChar(cursor, 0);
    if (here === openBrace()) {
        const cur = markupOrphanBraceDepth(ctx);
        ctx.markupOrphanBraceDepth = cur + 1;
        beginTextRun(run, cursor);
        advance(cursor, 1);
        return true;
    }
    if (here === closeBraceChar() && markupOrphanBraceDepth(ctx) > 0) {
        ctx.markupOrphanBraceDepth = markupOrphanBraceDepth(ctx) - 1;
        beginTextRun(run, cursor);
        advance(cursor, 1);
        return true;
    }
    return false;
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
    // P4-3 — the ORPHAN-BRACE suppression. A bare `{` at markup / top
    // level (no preceding sigil) opens an orphan-brace region — the body
    // of a bare control-flow / expression construct sitting directly in
    // markup-child position: `match @s { ... }`, `for (x of @xs) { ... }`,
    // an `&&` ghost `{@cond && <El>}`. The LIVE block-splitter tracks an
    // `orphanBraceDepth` counter (block-splitter.js L223 / L1505) and,
    // while it is `> 0`, treats EVERY structural construct inside the
    // region as raw text — `<tag>` openers (L1619), `< Ident>` state
    // openers (L1907), `</>` / `</name>` closers (L1530 / L1551), the
    // sigil block-openers `${ ?{ #{ !{ ^{ ~{` (L1439), and `//` comments
    // (L972) — because the region is one verbatim expression body the
    // downstream lift pass re-parses, not a markup subtree.
    //
    // The native trampoline mirrors that counter on `ctx`. While
    // `markupOrphanBraceDepth > 0` the recognizers below are SUPPRESSED:
    // the `<` / `$` / `</` falls through to the text run, exactly as the
    // live BS does. This is the P4-3 extension of the Phase-3 2a
    // `<`-suppression (which covered the `.InLogicEscape` body) to the
    // expression-position-in-markup variants the 2a fix did not reach.
    //
    // SCOPE — the orphan-brace mechanism is GATED OFF in a code-default
    // body (an engine state-child / match-arm body — SPEC §4.18.1). A
    // code-default body has its own `{`-bearing grammar (the §4.18 body
    // dispatch) and is not the markup-child position the 7 D-matchexpr
    // / T2 files exercise; suppressing there would be over-reach. All
    // P4-3 target files are free-text markup body (`<div>` / `<ul>` /
    // `<program>` children), where the live BS orphan-brace counter is
    // the exact oracle.
    //
    // The counter is mutated ONLY by handleOrphanBrace — it recognizes a
    // bare `{` / `}` and advances over it as text. A `${...}` (or any
    // sigil) is a SIGIL, not a bare brace: its `{` never reaches this
    // path (recognizeContextEntryAt consumes the two-char sigil and the
    // inner `}` is handled by the sigil context's own dispatcher), so the
    // counter is unaffected by a properly-nested `${}`.
    const orphanActive = !isCodeDefault(currentBodyMode(ctx));
    if (orphanActive && handleOrphanBrace(run, cursor, ctx)) return;
    const inOrphan = orphanActive && markupOrphanBraceDepth(ctx) > 0;

    // Structural comment recognition FIRST — a `//` / `<!-- -->` sequence
    // is a comment in `.TopLevel` (a code-default body per §40.8 / a
    // markup-context construct), not text. SUPPRESSED inside an
    // orphan-brace region (the live BS gates `//` on `orphanBraceDepth`).
    if (!inOrphan && emitComment(run, cursor, ctx)) return;

    // A markup closer (`</>` / `</name>`) — pair it with its open
    // TagFrame (the tag-tree pairing). Recognized structurally — a closed
    // set (no bare-`/` `looksLikeCloser` guess). SUPPRESSED inside an
    // orphan-brace region — a `</>` there pairs with a `<tag>` opener
    // that is itself being treated as text (live BS L1530 / L1551).
    //
    // P5-4 — STRAY ANONYMOUS-CLOSER SUPPRESSION. An anonymous `</>` with
    // NOTHING open is a stray closer the live block-splitter keeps as
    // ordinary TEXT (block-splitter.js L1535-1540: an empty-stack `</>`
    // does `beginText()` + advances — it never pops). A NAMED `</name>`
    // stray is treated differently by the live BS (L1567-1574: it is
    // CONSUMED + discarded with an E-CTX-001, splitting the text run), and
    // a `</name>` mismatch against an open frame POPS that frame
    // (L1576-1587). So the gate is narrow: suppress handleCloser ONLY for
    // an anonymous `</>` (`CloserForm.Inferred`) with an empty TagFrame
    // stack — everything else still routes through handleCloser. Without
    // the gate native consumes the stray `</>` as a closer (handleCloser
    // returns true even on a stray closer — it dispatches recovery + a
    // diagnostic, then advances past the `>`), SPLITTING the surrounding
    // text run and emitting two `text` nodes where the live pipeline emits
    // one (`phase3-for-arith-iterable-090`: a third `</>` after the tag
    // tree has fully closed). The .InLogicEscape / .InMarkupTagBody closer
    // paths carry the equivalent `tagFrameDepth > tagFloor` gate already.
    if (!inOrphan) {
        const strayAnonCloser =
            tagFrameDepth(ctx) === 0 &&
            recognizeCloserForm(cursor) === CloserForm.Inferred;
        if (!strayAnonCloser && handleCloser(run, cursor, ctx)) return;
    }

    // Inside an orphan-brace region every context-entry boundary (a `<`
    // markup/state opener, a `${ ?{ #{ ...` sigil) is raw text — skip the
    // recognizer entirely and fall through to the text-run accumulation.
    if (inOrphan) {
        beginTextRun(run, cursor);
        advance(cursor, 1);
        return;
    }

    const recognized = recognizeContextEntryAt(cursor);

    if (recognized.kind === "sigil") {
        // P5-6 — `?{` IS NOT A MARKUP-LEVEL SQL OPENER. Per SPEC §3.1 + §8.1
        // (S108 Bug 4 C-narrow), `?{` opens a SQL context ONLY inside Logic
        // — the live block-splitter at L1446-1495 deliberately omits `?{`
        // from its markup-loop sigil list (the companion ctx-loop branch at
        // L1245 IS the §3.1 SQL-inside-Logic case and still recognizes it).
        // A bare `?{...}` at markup level (a file-level child or a child of
        // `<program>` / `<page>` / etc.) is text + an orphan-brace region —
        // the `?` accumulates as text and the `{` increments the live BS's
        // `orphanBraceDepth`. Native's `recognizeContextEntryAt` treats every
        // sigil uniformly; suppress `?{` here so it falls through to text +
        // the orphan-brace counter. A `?{...}` NESTED inside `${...}` reaches
        // `dispatchInLogicEscape`'s sigil branch (the §3.1 path), untouched.
        if (recognized.sigil === "?" + openBrace()) {
            // Fall through to the text-run accumulator below — the `?` is
            // plain text, the `{` is an orphan brace (handleOrphanBrace
            // already ran at the top of this dispatch and would have
            // consumed any bare `{`, but `?{` is two chars so we need to
            // consume only the `?` here; the `{` reaches handleOrphanBrace
            // on the next iteration).
            beginTextRun(run, cursor);
            advance(cursor, 1);
            return;
        }
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
        // P5-1 — STATE-DECL OPENER SUPPRESSION. A `<query debounced=300ms> = ""`
        // (SPEC §6.2 Shape-1 state-decl) at a declaration site is NOT a markup
        // element — it is a state declaration the live pipeline emits as a
        // `text` block (block-splitter.js `peekTopLevelStateDeclSignal`) and
        // `liftBareBlocks`'s `TOPLEVEL_STATE_DECL_RE` lifts into a `logic`
        // node. Suppress the markup-tag entry so the `<` falls through to the
        // text-run accumulator; the lift pass then handles it. Gated on the
        // declaration site (file top-level / `<program>` / `<page>` /
        // `<channel>` body) so ordinary nested prose markup is untouched.
        if (atStateDeclSite(ctx) && isStateDeclOpenerAt(cursor)) {
            beginTextRun(run, cursor);
            advance(cursor, 1);
            return;
        }
        // P5-4 — `<style>` IS NOT A SCRML MARKUP ELEMENT. The live
        // block-splitter rejects `<style>` with E-STYLE-001 (block-
        // splitter.js L1721-1742: "<style> blocks are not supported in
        // scrml. Use #{} for CSS.") — it records the diagnostic, scans
        // past the whole `<style>...</style>` block, and emits NO node for
        // it (the text runs before / after are flushed as two separate
        // Text blocks). The native parser previously parsed `<style>` as
        // an ordinary Markup element, emitting a phantom `markup<style>`
        // subtree the live FileAST never carries (the D-void divergence
        // family: `rust-state-machine`, `kanban-r11`, `recipe-book`,
        // `gauntlet-r11-elixir-chat`). Mirror the live BS: flush the run
        // (it ends at `<style>`), skip the whole block, record E-STYLE-001
        // — and leave the run closed so a fresh Text run begins after.
        if (peekTagNameLower(cursor) === "style") {
            flushTextRun(run, cursor, ctx);
            const styleStart = cursor.pos;
            const styleLine = cursor.line;
            const styleCol = cursor.col;
            const styleEnd = scanPastStyleBlock(cursor);
            advance(cursor, styleEnd - styleStart);
            pushDiagnostic(ctx, makeDiagnostic(
                "E-STYLE-001",
                "<style> blocks are not supported in scrml. Use #{} for CSS.",
                makeSpan(styleStart, cursor.pos, styleLine, styleCol),
            ));
            return;
        }
        flushTextRun(run, cursor, ctx);
        // enterMarkupTagContext consumes the `<` + transitions
        // @blockContext to .InMarkupTag; the NEXT trampoline iteration
        // dispatches .InMarkupTag (dispatchInMarkupTag) to tokenize the
        // opener body. The `<` consumption is the iteration's progress.
        enterMarkupTagContext(ctx, cursor);
        return;
    }

    // P5-6 — `<#name>` HASH-REF BOUNDARY. SPEC §36 / §46 / §43 reserve
    // the `<#name>` shape for worker-message refs (`<#name>.send(expr)`),
    // when-from input-state refs (`when message from <#name>`), and
    // standalone input-state refs (`<#name>`). The live block-splitter at
    // L1593-1614 keeps the whole `<#name ...>` slice as TEXT — but it
    // FLUSHES the open text run at the `<` boundary first, splitting the
    // pre-`<#` content into its own text node, then re-opens a text run
    // starting at the `<`. The downstream stages (rewriteWorkerRefs /
    // preprocessWorkerAndStateRefs / rewriteInputStateRefs) read the
    // `<#name>` substring from the resulting text node and rewrite it.
    //
    // The native trampoline previously did neither — `<` followed by `#`
    // failed isMarkupTagOpener (a `#` is not an ASCII letter) and fell
    // through to the text accumulator. The text run was NOT split; the
    // pre-`<#` whitespace and the `<#name>` slice merged into one text
    // node. The D-interp-markup gap (phase3-is-in-when-guard-093): the
    // `<#tick when @s is .Active />` line is part of `<program>` body —
    // live emits it as a SEPARATE text-after-text-break child, native
    // emits one merged text child, deep-walk lengths diverge by one.
    //
    // Mirror live's flush-and-restart: at a `<#` boundary flush the
    // open run (start..`<`), then re-open a run at the `<` and consume
    // the `<#name...>` slice as text (scan to `>` or `\n`). The new run
    // stays open so trailing whitespace + content fuses into it,
    // matching live's `textStart = refStart` posture.
    const hereChar = peekChar(cursor, 0);
    const nextChar = peekChar(cursor, 1);
    if (hereChar === "<" && nextChar === "#") {
        flushTextRun(run, cursor, ctx);
        beginTextRun(run, cursor); // start the post-`<#` run at the `<`
        advance(cursor, 1); // consume `<`
        advance(cursor, 1); // consume `#`
        // Scan to `>` or `\n` — the live BS L1606-1609 reads the
        // identifier then scans-to-`>` or `\n`. We collapse both into one
        // bounded walk; the inter-`<#`-and-`>` content is text-of-the-
        // hashref, the same shape live captures.
        while (!isEof(cursor)) {
            const ch = peekChar(cursor, 0);
            if (ch === ">") { advance(cursor, 1); break; }
            if (ch === "\n") break;
            advance(cursor, 1);
        }
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

    // §51.0.S (S154 — #14 event-payload-transition) — the leading
    // `(state × message)` arm region. A code-default body that is an engine
    // state-child / match-arm body MAY open with a contiguous run of
    // leading-`|` arms (`| .Variant(bind) :> target` / `| _ :> @engineVar`).
    // The arm region is NOT bare prose — it is a known §51.0.S construct the
    // native→live walker re-parses via `parseMessageArms`
    // (engine-statechild-parser.ts). The MARKUP layer's job here is only to
    // CONSUME the arm region verbatim (so its leading `|` + arm-arrow `:>`
    // + bare-target syntax does NOT reach the M2 expression validator and
    // mis-fire E-UNQUOTED-DISPLAY-TEXT); the walker reads the same span back
    // out as `bodyRaw` and parses the arms structurally.
    //
    // The recognition MIRRORS the live `parseMessageArms` leading-`|` rule:
    // the arm region is the leading contiguous `|`-run; if the first
    // non-trivia char is not `|` (already true here — the cursor is at a
    // non-whitespace, non-`"` char), or the `|` does not form a real arm (no
    // arm-arrow), there is no arm region and the body is render content.
    // A render body AFTER the arm region keeps normal code-default treatment
    // (bare display text THERE still correctly fires E-UNQUOTED — §4.18).
    if (peekChar(cursor, 0) === "|") {
        const armEnd = scanMessageArmRegionExtent(cursor);
        if (armEnd > cursor.pos) {
            // Consume the whole arm region verbatim — NO block emitted, NO
            // diagnostic. The walker re-parses it from `bodyRaw`.
            advance(cursor, armEnd - cursor.pos);
            return;
        }
    }

    // Any other non-whitespace run is a candidate CODE run. Scan its
    // extent (to the next body-structural boundary) and validate it as
    // code via the M2 expression parser. A run that is NOT valid code is
    // bare prose — E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.7).
    emitCodeDefaultRun(cursor, ctx);
}

// scanMessageArmRegionExtent — calculation. The cursor is AT a `|` in a
// code-default body. Return the END offset of the leading contiguous
// `(state × message)` arm region (SPEC §51.0.S), or `cursor.pos` (no
// advance) when the `|` does not begin a real arm.
//
// This MIRRORS the live `parseMessageArms` scan (engine-statechild-
// parser.ts:1824) at the EXTENT level only — it recognizes the region's
// bounds so the markup layer can consume it verbatim; the structural arm
// parse (variant / payload bindings / arm body) is the walker's job.
//
// An arm is `| pattern (payload)? arrow body` where:
//   - pattern — `_` wildcard OR `.Variant` / `MsgType.Variant`;
//   - payload — an optional balanced `( ... )` (string-aware);
//   - arrow   — `:>` / `=>` / `->` (the S147 arm-arrow set);
//   - body    — a balanced `{ ... }` block (string-aware) OR a bare target
//               expression terminated by the next top-level `|` (NOT `||`)
//               / the body end.
// The scan stops at the first `|` that has no arm-arrow (malformed / the
// arm region has ended and render content follows); the bytes BEFORE that
// `|` are the arm region. A `|` with no following arm at all returns
// `cursor.pos` (no arm region — the body is render content).
function scanMessageArmRegionExtent(cursor) {
    const src = cursor.source;
    const len = src.length;
    const start = cursor.pos;

    // Skip leading whitespace to the first arm candidate.
    function skipWs(at) {
        let p = at;
        while (p < len && isBodyWhitespace(src.charAt(p))) p++;
        return p;
    }
    // An arm-arrow glyph (`:>` / `=>` / `->`) at `at`? Return its length or 0.
    function arrowLenAt(at) {
        const two = src.substring(at, at + 2);
        if (two === ":>" || two === "=>" || two === "->") return 2;
        return 0;
    }

    let pos = skipWs(start);
    if (pos >= len || src.charAt(pos) !== "|") return start;

    // `regionEnd` tracks the end of the LAST recognized arm; it is the
    // returned extent. It only advances when a full arm is recognized.
    let regionEnd = start;

    while (pos < len) {
        const armStart = skipWs(pos);
        if (armStart >= len || src.charAt(armStart) !== "|") break;
        let p = armStart + 1; // consume `|`
        p = skipWs(p);

        // -- Pattern: `_` wildcard OR `.Variant` / `MsgType.Variant`. -------
        if (src.charAt(p) === "_" && !/[A-Za-z0-9_$]/.test(src.charAt(p + 1) || "")) {
            p += 1;
        } else {
            if (src.charAt(p) === ".") p += 1;
            while (p < len && /[A-Za-z0-9_$.]/.test(src.charAt(p))) p++;
        }

        // -- Optional payload bindings `( ... )` (balanced, string-aware). --
        {
            let q = skipWs(p);
            if (q < len && src.charAt(q) === "(") {
                let depth = 1;
                let r = q + 1;
                let inDQ = false;
                let inSQ = false;
                while (r < len && depth > 0) {
                    const c = src.charAt(r);
                    if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") r++; r++; continue; }
                    if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") r++; r++; continue; }
                    if (c === '"') { inDQ = true; r++; continue; }
                    if (c === "'") { inSQ = true; r++; continue; }
                    if (c === "(") { depth++; r++; continue; }
                    if (c === ")") { depth--; if (depth === 0) break; r++; continue; }
                    r++;
                }
                if (depth === 0) p = r + 1; else p = q;
            } else {
                p = q;
            }
        }

        // -- Arm arrow `:>` / `=>` / `->`. ----------------------------------
        p = skipWs(p);
        const arrowLen = arrowLenAt(p);
        if (arrowLen === 0) {
            // Malformed arm (no arm-arrow) — the arm region ends BEFORE this
            // `|`. Stop; the render body (if any) starts here.
            break;
        }
        p += arrowLen;
        p = skipWs(p);

        // -- Arm body: `{ ... }` block OR bare target expression. -----------
        if (p < len && src.charAt(p) === "{") {
            let depth = 1;
            let r = p + 1;
            let inDQ = false;
            let inSQ = false;
            let inTick = false;
            while (r < len && depth > 0) {
                const c = src.charAt(r);
                if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") r++; r++; continue; }
                if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") r++; r++; continue; }
                if (inTick) { if (c === "`") inTick = false; else if (c === "\\") r++; r++; continue; }
                if (c === '"') { inDQ = true; r++; continue; }
                if (c === "'") { inSQ = true; r++; continue; }
                if (c === "`") { inTick = true; r++; continue; }
                if (c === "{") { depth++; r++; continue; }
                if (c === "}") { depth--; if (depth === 0) break; r++; continue; }
                r++;
            }
            p = depth === 0 ? r + 1 : len; // include `{` .. `}`, or to EOF
        } else {
            // Bare target — terminated by the next top-level `|` (NOT `||`),
            // a top-level newline, or the body end.
            let depth = 0;
            let inDQ = false;
            let inSQ = false;
            let inTick = false;
            while (p < len) {
                const c = src.charAt(p);
                if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") p++; p++; continue; }
                if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") p++; p++; continue; }
                if (inTick) { if (c === "`") inTick = false; else if (c === "\\") p++; p++; continue; }
                if (c === '"') { inDQ = true; p++; continue; }
                if (c === "'") { inSQ = true; p++; continue; }
                if (c === "`") { inTick = true; p++; continue; }
                if (c === "(" || c === "[" || c === "{") { depth++; p++; continue; }
                if (c === ")" || c === "]" || c === "}") { if (depth > 0) depth--; p++; continue; }
                if (depth === 0 && c === "|") {
                    if (src.charAt(p + 1) === "|") { p += 2; continue; } // `||` is not a separator
                    break;
                }
                if (depth === 0 && c === "\n") break;
                p++;
            }
        }

        // A full arm was recognized — extend the region to its end and
        // continue scanning for the next arm.
        regionEnd = p;
        pos = p;
    }

    return regionEnd;
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

    // P5-13 — brace-in-string skip (BS-narrow 3-char pattern). A `{` / `}` of
    // the form `"{"` / `"}"` / `'{'` / `'}'` is string-literal content, not a
    // structural brace. Suppress the structural actions (matching-close test,
    // noteBraceOpen, noteBraceClose) on it so the body-extent brace-depth
    // calculation balances — without this, `${ const c = "{" }` never finds
    // its matching `}`, depth runs to EOF, and the whole block degrades to a
    // Text node, dropping every declaration inside. Mirrors the live BS at
    // block-splitter.js L1163-1185 ("Bug 2 C-narrow S109"). Placed BEFORE
    // isBlockContextClose so a string `}` at depth-0 cannot close the
    // context. (Two parallel concerns NOT handled here, matching the oracle:
    // full string-state tracking — strings longer than the 3-char pattern
    // need the `String.fromCharCode(123/125)` workaround; and a `${` / `?{`
    // / ... sigil INSIDE a string literal — the oracle and the native parser
    // both treat that as a nested context-open, an SPEC §4.6 edge case.)
    const hereForStrSkip = peekChar(cursor, 0);
    if ((hereForStrSkip === openBrace() || hereForStrSkip === closeBraceChar())
        && braceIsInStringLiteral(cursor)) {
        advance(cursor, 1);
        return;
    }

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
    // M5 gap-ledger 2a — a `<ident>` / `< Ident>` opener inside a
    // logic-escape body is NOT a markup-tag context boundary. Per §4.6
    // the `<` inside a `${...}` body is body content the JS layer owns:
    // a markup-AS-VALUE `${ <div/> }` is recognized by the JS-layer
    // expression parser (parse-expr.js's parsePrimary LessThan branch),
    // which runs over the body-text slice at emitContextBlock time —
    // NOT by the markup trampoline. The live BS matches this exactly:
    // inside a brace context a `<ident` is consumed as raw text and
    // never becomes a block (block-splitter.js L1381 — "the BS does not
    // create block nodes"). Entering `.InMarkupTag` here would emit a
    // SPURIOUS top-level Markup sibling of the `logic` node — the 2a
    // defect. So a `markupTag`-shaped recognition is ignored: the `<`
    // falls through to the ordinary-body-character path below and is
    // advanced over as body content.

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
    // P5-13 — brace-in-string skip (BS-narrow 3-char pattern). Same rationale
    // as dispatchInLogicEscape: a `{` / `}` of the form `"{"` / `"}"` / `'{'`
    // / `'}'` is string-literal content, not a structural brace. Suppress the
    // matching-close test + noteBraceOpen + noteBraceClose so the body-extent
    // brace-depth calculation balances on the SAME inputs the live BS
    // balances on (block-splitter.js L1163-1185). The sketch-depth sub-
    // dispatchers (InCss / InSql / InErrorEffect / InMeta / InTest) all share
    // this scan, so the fix lands once here for all five.
    const here = peekChar(cursor, 0);
    if ((here === openBrace() || here === closeBraceChar())
        && braceIsInStringLiteral(cursor)) {
        advance(cursor, 1);
        return;
    }

    if (isBlockContextClose(ctx, cursor)) {
        const frame = closeBlockContext(ctx, cursor);
        // F7.b — pass the cursor so an .InSql block's emitContextBlock can
        // advance it past the trailing `.method(args)` chain (the chain
        // bytes trail the `}` and belong to the Sql block).
        emitContextBlock(ctx, frame, cursor.pos, cursor);
        return;
    }

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
    } else if (tagFrame.colonShorthandBody !== undefined
               && tagFrame.colonShorthandBody !== null) {
        // 3a'. M6.6.b.1 — `:`-SHORTHAND BODY (SPEC §4.14 / §51.0.I —
        //      `<Tag attrs : single-expression>`). The body lives INSIDE
        //      the opener's `>` terminator; tokenizeOpener captured the
        //      verbatim post-`:` text on `opener.colonShorthandBody` and
        //      recognizeOpener carried it onto `frame.colonShorthandBody`.
        //      The cursor is ALREADY positioned one past the opener's
        //      `>` (tokenizeOpener advances over the whole opener span);
        //      no further advance needed. SPEC §4.14 line 968 forbids
        //      any closer (`</>`, `/>`) on a `:`-shorthand body — treat
        //      the opener as a LEAF: pop the TagFrame the opener pushed
        //      (so a later `</>` does not pair against this frame) and
        //      emit a child-less whole-element Markup block spanning the
        //      opener's span. The block carries `colonShorthandBody`
        //      (stamped by emitMarkupElement from tagFrame.
        //      colonShorthandBody) — the b.2-b.4 engine state-child /
        //      `<onTransition>` consumers read it as the live
        //      `EngineStateChildEntry.isColonShorthand` (boolean test:
        //      `!== null`) and `.bodyRaw` discriminators (null =
        //      bare-body / self-close; string = `:`-shorthand, verbatim
        //      post-`:` bytes — leading whitespace stripped at capture).
        popTagFrame(ctx);
        emitMarkupElement(ctx, tagFrame, frame.openSpan.start,
            tagFrame.opener.span.end, []);
    } else if (isRawContentElement(tagFrame.name)) {
        // 3c. P5-6 — RAW-CONTENT ELEMENT (SPEC §4.17). Inside `<pre>` /
        //     `<code>` the body is verbatim: scrml tokens (`${...}`,
        //     `<TagName>`, `?{}`, `#{}`, `!{}`, `^{}`, `_{...}`) are NOT
        //     recognized; the entire body is one text run terminated by
        //     the matching `</NAME>` closer. Mirrors the live block-
        //     splitter at L1832-1897 — `RAW_CONTENT_ELEMENTS = {pre, code}`.
        //
        //     The native trampoline previously parsed `<code>`'s body
        //     character-by-character, opening `${...}` logic contexts for
        //     interpolations and emitting `logic` blocks where the live
        //     pipeline carries a single text child. The D-interp gap:
        //     three trucking-dispatch files (driver/profile, driver/
        //     messages, customer/profile) all have `<code class="…">
        //     ${@var}</code>` substrings where the native pipeline
        //     opened a sub-context the live oracle did not.
        //
        //     Recognize the opener, then SHORT-CIRCUIT the body: scan
        //     forward for `</NAME>` (case-insensitive), emit one text
        //     child for the body (if non-empty), advance past the closer,
        //     and emit the whole-element Markup block via
        //     emitMarkupElement. popTagFrame removes the frame the
        //     opener pushed (no later closer-pairing — already paired
        //     inline).
        emitRawContentElement(ctx, cursor, tagFrame, frame.openSpan);
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

// isRawContentElement — calculation (predicate). SPEC §4.17 raw-content
// element name set — mirror of live block-splitter.js L89 `RAW_CONTENT_
// ELEMENTS`. The live oracle's `!isComp && lowerTagName` check is
// covered here by comparing against the lowercase literal: a PascalCase
// component opener (`<Pre>` / `<Code>`) has `tagFrame.name === "Pre"`
// (NOT lowercased — the native preserves case) and so does NOT match,
// matching the live gate.
export function isRawContentElement(tagName) {
    return tagName === "pre" || tagName === "code";
}

// emitRawContentElement — state write. The cursor sits just past the
// opener's `>`. Scan forward for the matching `</NAME>` closer
// (case-insensitive — the live BS L1846-1856 needle), capture the body
// as one Text child, advance the cursor past the closer, and emit the
// whole-element Markup block. An unterminated raw-content element
// (no `</NAME>` before EOF) records E-CTX-001 and is recovered as if
// the closer materialised at EOF.
export function emitRawContentElement(ctx, cursor, tagFrame, openSpan) {
    const src = cursor.source;
    const len = src.length;
    const lowerName = tagFrame.name;
    const closeNeedle = "</" + lowerName + ">";
    const needleLen = closeNeedle.length;

    // The body extent — [bodyStart, bodyEnd]. `bodyStart` is cursor.pos
    // (just past `>`); `bodyEnd` is the first byte of the closer match
    // (or EOF when no closer materialises).
    const bodyStart = cursor.pos;
    const bodyStartLine = cursor.line;
    const bodyStartCol = cursor.col;
    let p = bodyStart;
    while (p < len) {
        if (src.charAt(p) === "<"
            && src.substr(p, needleLen).toLowerCase() === closeNeedle) {
            break;
        }
        p = p + 1;
    }
    const bodyEnd = p;

    // One Text child for the body (live parity — see block-splitter.js
    // L1858-1875). A zero-length body emits no child.
    const children = [];
    if (bodyEnd > bodyStart) {
        const k = blockKinds();
        children.push(makeBlockNode(
            k.Text,
            makeSpan(bodyStart, bodyEnd, bodyStartLine, bodyStartCol),
            null,
        ));
    }

    // Advance the cursor past the closer (or to EOF when unterminated).
    let closerForm = "explicit";
    if (p < len) {
        advance(cursor, (bodyEnd - bodyStart) + needleLen);
    } else {
        // Unterminated raw-content element — E-CTX-001 per live BS
        // L1881-1885. Recover as if the closer materialised at EOF.
        advance(cursor, bodyEnd - bodyStart);
        pushDiagnostic(ctx, makeDiagnostic(
            "E-CTX-001",
            "Unclosed <" + tagFrame.name + "> raw-content element (expected '"
                + closeNeedle + "'). Add the matching close tag.",
            makeSpan(openSpan.start, cursor.pos, openSpan.line, openSpan.col),
        ));
        closerForm = "inferred";
    }

    // Pop the TagFrame the opener pushed — closer pairing is INLINE here,
    // so the frame must not linger on ctx.tagFrameStack (otherwise a
    // later `</>` could pair against it).
    popTagFrame(ctx);

    // Emit the whole-element Markup block. emitMarkupElement carries the
    // closerForm + children + the standard payload-stamping (tagClass,
    // attrs, tagKind, etc.).
    tagFrame.closerForm = closerForm;
    emitMarkupElement(ctx, tagFrame, openSpan.start, cursor.pos, children);
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
    // M6.6.b.1 — `:`-SHORTHAND BODY DISCRIMINATOR (SPEC §4.14 line 973 +
    // §51.0.I). When the opener carries a `:`-shorthand body (e.g.
    // `<Idle rule=.Playing : @t.now`), recognizeOpener captured the
    // verbatim post-`:` bytes (up to newline / EOF, leading whitespace
    // retained) onto `tagFrame.colonShorthandBody`; carry it onto the
    // Markup block here so the b.2-b.4 engine state-child / `<onTransition>`
    // consumers read it as the live `EngineStateChildEntry.isColonShorthand`
    // (boolean test: `block.colonShorthandBody !== null`) and `.bodyRaw`
    // (post-`:` text) discriminators. Null on every other Markup block
    // (bare-body, self-close, void-element) — additive, existing consumers
    // ignore the field.
    block.colonShorthandBody = tagFrame.colonShorthandBody ?? null;
    // F7.a — when the block is a state block, stamp the state payload
    // (stateNodeKind / stateType / typedAttrs — the live StateNode /
    // StateConstructorDefNode shape). `isStateBlock` matches BOTH the §4.3
    // space-after-`<` opener (`TagKind.StateOpener`) AND the no-space
    // `<db>` / `<schema>` lifecycle-keyword form — so the shaping runs for
    // a nested `<db>` inside a `<program>` body identically to a top-level
    // `< state ...>`. A non-state Markup block is untouched.
    if (isStateBlock(block)) {
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
// P5-14 v2 (S121): the `allowMismatchPop` option to closeTagFrame is
// derived from `ctx.inMarkupValueSlice`. File-level parses (the default —
// inMarkupValueSlice = false) get pop-on-mismatch recovery, mirroring
// live-BS `popTagContext("explicit")` at block-splitter.js L1576-1586 —
// the popped frame's Markup block is emitted with the closer's span end
// standing in for the close. Slice-mode parses (the substring path
// parseMarkupValue takes via parse-expr.js — inMarkupValueSlice = true)
// keep the bail-no-pop semantics so a mismatched closer inside an
// in-expression markup-value substring does not prematurely pop the
// slice's root and truncate the MarkupValue (the LIVE pipeline takes
// the parseLiftTag BAIL path at ast-builder.js L3098-3099 — falls
// through to the raw-text component-def detector).
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

    // Pair the closer with its open TagFrame. The slice-vs-file mode
    // flag picks the mismatch-recovery shape (see fn header).
    const allowMismatchPop = ctx.inMarkupValueSlice !== true;
    const result = closeTagFrame(ctx, closer, { allowMismatchPop });
    if (result.popped !== null) {
        // A clean pop OR a recovery pop (file-mode mismatch with
        // allowMismatchPop=true). closeMarkupElement emits the
        // whole-element Markup block with the children (the blocks
        // emitted since the opener) nested. The closer.form is recorded
        // on the popped TagFrame for downstream emit-time
        // discrimination — a recovery pop still records the mismatched
        // explicit form so the assembler can see the closer shape.
        closeMarkupElement(ctx, result.popped, closer.form, closer.span.end);
    }
    // A stray closer / slice-mode mismatch: closeTagFrame recorded the
    // E-CTX-003 / E-MARKUP-002 diagnostic + dispatched ErrorRecovery.
    // The closer is consumed; the trampoline resumes (no Markup block —
    // recovery, the open frame stays for a later closer or EOF
    // unterminated path).
    return true;
}

// isTagNameChar — calculation (predicate). A character that may continue a
// markup-tag name run: ASCII letter, ASCII digit, `-`, or `_`. SPEC §4.1
// (line 308) normative. MK2.1 made tag-frame.js the canonical home of the
// tag-name grammar; this file's isTagNameChar mirrors that canonical body
// 1:1 so existing importers (parser-conformance-markup.test.js, MK1.2
// suite) keep a single binding. K9 (S114): the .scrml form inlines the
// body (the previous `import { isTagNameChar as tagNameCharCanonical }`
// aliased import tripped E-SCOPE-001 — SPEC §21); the .js shadow inlines
// too so the pair stays 1:1. If the canonical grammar ever changes,
// update BOTH this file and tag-frame.js (.scrml + .js). Wave 6 Unit A
// added `_` to match SPEC + the sibling `isTagNameContinue`.
export function isTagNameChar(ch) {
    if (ch === "") return false;
    if (ch === "-" || ch === "_") return true;
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

// braceIsInStringLiteral — calculation. A `{` / `}` at the cursor is brace-in-
// string content, NOT a structural brace, when it is the exact 3-character
// pattern `"{"` / `"}"` / `'{'` / `'}'` — a brace immediately surrounded by
// matching quotes. This is the SAME narrow detection the live block-splitter
// uses (block-splitter.js L1163-1185, "Bug 2 C-narrow S109"): full string-state
// tracking is impractical because a quote char is ambiguous (regex, template
// interpolation, apostrophe-in-comment), so the BS detects only the exact
// quote-brace-quote shape. The native parser MIRRORS that narrow detection so
// the body-extent brace-depth count balances on the SAME inputs the live BS
// balances on — a wider rule would diverge the dual-pipeline FileAST. Without
// this skip a `{` inside a string literal (`const c = "{"`) is counted as a
// real brace, depth never balances, the `${...}` opener's matching `}` is
// never found, and the whole block degrades to a `Text` node — every
// declaration inside it is lost.
export function braceIsInStringLiteral(cursor) {
    const prev1 = peekChar(cursor, -1);
    const next1 = peekChar(cursor, 1);
    const doubleQuote = String.fromCharCode(34);
    const singleQuote = String.fromCharCode(39);
    if (prev1 === doubleQuote && next1 === doubleQuote) return true;
    if (prev1 === singleQuote && next1 === singleQuote) return true;
    return false;
}

// --- P4-2 — the BARE-MARKUP-STATEMENT lift pass -----------------------------
//
// The native markup trampoline accumulates a bare statement-shaped line
// sitting directly inside a markup element body — `type ...`, `export ...`,
// `import ...`, `fn ...` / `server fn ...`, a `~`-pipeline decl — into a plain
// `Text` block. The LIVE pipeline does not: `liftBareDeclarations`
// (ast-builder.js L740) is a post-pass over the BS block tree that converts a
// `text` block whose trimmed content STARTS with a bare declaration keyword
// into a synthetic `logic` block (it wraps the raw text with `${`/`}` so
// `buildBlock case "logic"` parses it). The hoisted `typeDecls` / `exports` /
// `imports` / `components` then see the decls inside that synthetic logic.
//
// `liftBareBlocks` is the native analogue — a post-pass over the native
// `Block[]`, mirroring `liftBareDeclarations` 1:1:
//   - it runs ONLY at file top-level OR inside a `<program>` / `<page>` /
//     `<channel>` direct-child body (`liftBareDeclarations`'s `parentType`
//     propagation: those three markup roots set `childContext = "state"`, a
//     declaration site; any OTHER markup element sets `childContext =
//     "markup"`, prose context, lift SUPPRESSED). A `state` block's children
//     are a declaration site too.
//   - it converts a `Text` block whose raw matches a bare-declaration regex
//     (`BARE_DECL_RE` — the canonical decl-keyword set; `TILDE_TOKEN_RE` — a
//     bare `~` pipeline token at a `state`-context child) into a synthetic
//     `LogicEscape` block carrying a parsed native `Stmt[]` body, so the
//     downstream `collectHoisted` + `synthLogicNode` see a `logic` node and
//     the hoisted decls, exactly as the live pipeline does.
//
// SCOPE — this mirrors the THREE single-Text-block lift triggers
// (`BARE_DECL_RE`, `TOPLEVEL_STATE_DECL_RE`, `TILDE_TOKEN_RE`) PLUS the two
// component-def PAIRING forms (`BARE_EXPORT_AT_END_RE` /
// `BARE_DECL_NAME_EQ_AT_END_RE` — a `text` block paired with a FOLLOWING
// markup block; P5-2).
//
// P5-2 CORRECTION — the pre-P5-2 pass-comment claimed the pairing forms had
// "no native `Text`-then-`Markup` shape to match" because the `<` opener was
// supposedly consumed before a `Text` block formed. That is WRONG: the native
// trampoline DOES emit a `Text` block (`export ` / `const Name = `) followed
// by a `Markup` block — the declarator keyword run flushes the text run at
// the `<ident` boundary, exactly the live BS shape. `liftBareBlocks` simply
// never ran the pairing pass. P5-2 adds it (`liftPairedExport` /
// `liftPairedDeclEq`), mirroring `liftBareDeclarations`'s pairing branches
// (ast-builder.js L807 / L1092).
//
// `TOPLEVEL_STATE_DECL_RE` rarely has a native `Text` block to match — a bare
// `<x> = 0` is recognized as a `Markup` element opener by the trampoline; the
// state-decl mis-segmentation is the P4-1 / P5-1 unit's concern.
// `TOPLEVEL_STATE_DECL_RE` is still applied here for the case where a merged
// text run genuinely opens with a `<x> =` shape.

// BARE_DECL_RE — the canonical bare-declaration keyword set. A VERBATIM copy
// of ast-builder.js's `BARE_DECL_RE` (L399) — the live oracle's recognition
// set, including the R25-Bug-42 (S138) generator-admitting `[*\s]` form
// (`server function*` / `fn*` / `function*`). If the live regex
// changes, this copy must change in lockstep (re-synced this session).
const BARE_DECL_RE = /^\s*(?:export\s+)?(server\s+(?:fn|function)[*\s]|type\s+\w|fn[*\s]\w?|function[*\s]\w?|let\s+[A-Za-z_]|const\s+[A-Za-z_]|import\s+[{a-zA-Z_*"'])/;

// TOPLEVEL_STATE_DECL_RE — VERBATIM copy of ast-builder.js L369. A text run
// opening with a `<Ident ...>` then `=` / `:` / a nested `<Ident` (a Variant C
// compound state-decl).
const TOPLEVEL_STATE_DECL_RE =
    /^\s*(?:export\s+)?(?:const\s+)?<\s*[A-Za-z_][A-Za-z0-9_]*[^>]*>\s*(?:[=:]|<[A-Za-z_])/;

// BARE_EXPORT_AT_END_RE — VERBATIM copy of ast-builder.js L396. A `Text` block
// whose TRAILING portion is a bare `export` keyword awaiting a `<markup>` RHS
// — the P5-2 `export <channel ...>` / `export <Component ...>` pairing form.
// The leading payload (comments / whitespace / a preceding state-decl) is
// preserved verbatim as its own re-lifted text block.
const BARE_EXPORT_AT_END_RE = /(^|\s)export\s*$/;

// BARE_DECL_NAME_EQ_AT_END_RE — VERBATIM copy of ast-builder.js L430. A `Text`
// block whose TRAILING portion is a const-or-let component-def header awaiting
// its `<markup>` RHS: `const Name = ` / `let Name = ` / `export const Name = `
// / `export let Name = `. The P5-2 `const Name = <markup>` Form-2 pairing.
// Group 1 captures the leading prefix; group 2 captures the keyword + name +
// `=` trailer. The binding name MUST start UPPERCASE — a lowercase
// `const m = <main>...</>` is an ordinary const-decl whose init happens to be
// markup, not a component-def (ast-builder.js L422 case discrimination).
const BARE_DECL_NAME_EQ_AT_END_RE =
    /^([\s\S]*?)((?:^|\s)(?:export\s+)?(?:const|let)\s+[A-Z][A-Za-z0-9_]*\s*=\s*)$/;

// EXPORT_PREFIX_SPLIT_RE — splits a `BARE_EXPORT_AT_END_RE`-matching text
// block into [prefix, `export` trailer]. Mirrors ast-builder.js L814 / L957.
const EXPORT_PREFIX_SPLIT_RE = /^([\s\S]*?)((?:^|\s)export\s*)$/;

// CHANNEL_NAME_ATTR_RE — extracts the string-literal `name="..."` attribute
// value from a `<channel ...>` opener's raw text. The live oracle requires a
// compile-time-stable string-literal name for a cross-file channel export
// (E-CHANNEL-EXPORT-001); a reactive `name=@var` form yields no match.
const CHANNEL_NAME_ATTR_RE = /\bname\s*=\s*"([^"]*)"/;

// TILDE_TOKEN_RE — VERBATIM copy of ast-builder.js L385. A bare `~` token
// (not adjacent to an identifier char) — the unambiguous logic-mode signal
// (SPEC §32). Lifted ONLY at a `state`-context child (the live oracle gates
// `TILDE_TOKEN_RE` on `parentType === "state"`).
const TILDE_TOKEN_RE = /(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/;

// isProgramFamilyRoot — predicate. The three markup roots whose direct-child
// body is a declaration site (the live `liftBareDeclarations` `childContext`
// = "state" set): `<program>` (SPEC §40.8 default-logic mode), `<channel>`
// (§38.4 channel body), `<page>` (§4.15 / §40.8 per-route container).
function isProgramFamilyRoot(name) {
    return name === "program" || name === "channel" || name === "page";
}

// sliceBlockRaw — calculation. The verbatim source text a Text block spans.
// Native Text blocks carry only a span; the raw text is recovered from source.
function sliceBlockRaw(source, span) {
    if (typeof source !== "string") return "";
    if (span === undefined || span === null) return "";
    const start = span.start;
    const end = span.end;
    if (typeof start !== "number" || typeof end !== "number") return "";
    if (start < 0 || end > source.length || start > end) return "";
    return source.slice(start, end);
}

// synthLiftedLogicBlock — calculation. Build a synthetic `LogicEscape` block
// from a bare-declaration `Text` block. The native analogue of the live
// `liftBareDeclarations` synthetic `logic` block: the Text run's raw IS the
// logic-escape body text; `parseLogicBodyBestEffort` parses it into a native
// `Stmt[]` so `collectHoisted` (`walkStmts(block.body)`) finds the decls and
// `synthLogicNode` (`translateStmtList(block.body)`) emits a live `logic`
// node. `bodyText` is carried so `collectHoisted`'s `rulesRaw`-style slicing
// is consistent with a real `${...}` LogicEscape block.
//
// The block REUSES the Text block's span (the live synthetic logic block
// reuses the text block's span verbatim — ast-builder.js L1151). `_synthetic`
// marks the disposition for downstream observability.
function synthLiftedLogicBlock(textBlock, source, ctx) {
    const k = blockKinds();
    const span = textBlock.span;
    const bodyText = sliceBlockRaw(source, span);
    const block = makeBlockNode(k.LogicEscape, span, null);
    block.bodyText = bodyText;
    // Parse the body. `ctx` is the live parse-context — `parseLogicBody
    // BestEffort` forwards a lifted body's diagnostics into `ctx.diagnostics`
    // (the same stream `nativeParseFile` collects), the live oracle's
    // behaviour. The body text is plain scrml statements (the same parser
    // path a `${...}` LogicEscape body takes). The body's host-absolute
    // anchor is the text run's span start.
    const anchorLine = (span !== undefined && span !== null && typeof span.line === "number")
        ? span.line : 1;
    const anchorCol = (span !== undefined && span !== null && typeof span.col === "number")
        ? span.col : 1;
    const anchorStart = (span !== undefined && span !== null && typeof span.start === "number")
        ? span.start : 0;
    block.body = parseLogicBodyBestEffort(bodyText, ctx, anchorStart, anchorLine, anchorCol);
    block._synthetic = true;
    return block;
}

// synthPairedLogicBlock — calculation. The P5-2 pairing analogue of
// `synthLiftedLogicBlock`. Where `synthLiftedLogicBlock` slices a SINGLE Text
// block's source span as the body, this builds a synthetic `LogicEscape` from
// a CONSTRUCTED body text (the `export` / `const Name =` trailer spliced with
// a following markup block's raw, or a synthetic channel-export decl). The
// span is supplied by the caller — it covers `[trailerStart, markupEnd]` so
// the synthetic logic node maps back into the host coordinate space.
//
//   bodyText — the constructed scrml statement source (e.g.
//              `const Card = <div>...</>` or
//              `export const _native_channel_export_1 = "topic"`).
//   span     — the host-coordinate span the synthetic node spans.
//   ctx      — the live parse-context (diagnostics forwarding).
//
// Mirrors the live `liftBareDeclarations` pairing branches, which build a
// `${ ... }` raw and re-parse it (ast-builder.js L892 / L1121). The native
// side parses `bodyText` directly — `parseLogicBodyBestEffort` is the same
// parser path a real `${...}` LogicEscape body takes.
function synthPairedLogicBlock(bodyText, span, ctx) {
    const k = blockKinds();
    const block = makeBlockNode(k.LogicEscape, span, null);
    block.bodyText = bodyText;
    const anchorLine = (span !== undefined && span !== null && typeof span.line === "number")
        ? span.line : 1;
    const anchorCol = (span !== undefined && span !== null && typeof span.col === "number")
        ? span.col : 1;
    const anchorStart = (span !== undefined && span !== null && typeof span.start === "number")
        ? span.start : 0;
    block.body = parseLogicBodyBestEffort(bodyText, ctx, anchorStart, anchorLine, anchorCol);
    block._synthetic = true;
    return block;
}

// synthPrefixTextBlock — calculation. A pairing pass that splits a Text block
// into [prefix, decl-trailer] re-emits the prefix as its own Text block so the
// prefix's own lift rules (BARE_DECL_RE / TOPLEVEL_STATE_DECL_RE / a preceding
// state-decl) still fire. Mirrors ast-builder.js L817 / L1106 — the prefix
// block reuses the original span's start, ending `prefixRaw.length` chars in.
// Returns null when the prefix is empty (nothing to re-emit).
function synthPrefixTextBlock(textBlock, prefixRaw) {
    if (typeof prefixRaw !== "string" || prefixRaw.length === 0) return null;
    const span = textBlock.span;
    const newSpan = (span !== undefined && span !== null)
        ? { ...span, end: span.start + prefixRaw.length }
        : span;
    return { ...textBlock, span: newSpan };
}

// =============================================================================
// M6.4a — P2-Form1 (SPEC §21.2) desugaring helpers.
//
// Mirrors ast-builder.js L457-704 (scanOpenerForAttrs / extractOuterAttrSource /
// parseAttrNames / findSingleBodyRoot / spliceAttrsIntoBodyRoot) so the native
// pipeline can synthesize the same `${ export const Name = <body-root
// mergedAttrs>...</body-root> }` body the live oracle produces from a
// `export <Name outerAttrs>{body}</>` Form-1 pair (text block ending in
// `export ` + following PascalCase markup block).
//
// Per SPEC §21.2 normative: the outer self-named tag is dropped at the source
// level; the body's single root markup element absorbs all of the outer's
// attributes. Class-merging (§15.5) is the one exception — `class` is allowed
// on both sides because scrml class-attr merging combines them.
//
// E-EXPORT-002 (empty / multi-rooted body) and E-EXPORT-003 (attr conflict)
// are recognized by the M6.4a happy-path: the helpers detect the bad shapes
// but the native side currently falls through to `null` (no pairing) rather
// than emitting the diagnostic — the structural canary credits the no-pair
// disposition as correct, and a future M6.4-followup unit can add diagnostic
// attribution if cross-pipeline drift surfaces.
// =============================================================================

// isUpperInitial — predicate. True iff `name`'s first character is an ASCII
// uppercase letter (the live component-call gate — ast-builder.js L2993
// `/^[A-Z]/` — mirrored from parse-file.js's `isUpperInitial`).
function isFormOneComponentName(name) {
    if (typeof name !== "string" || name.length === 0) return false;
    const code = name.charCodeAt(0);
    return code >= 65 && code <= 90;
}

// scanOpenerForAttrsNative — calculation. VERBATIM port of ast-builder.js L471
// `scanOpenerForAttrs`. Scan an opener tag (`<TagName ...>` or
// `<TagName ... />`) starting at position `start` in `raw`. Returns metadata
// about the opener: { attrStart, openerEnd, selfClosing, tagName } where
// `attrStart` is the offset right after the tag name, and `openerEnd` is the
// offset of the closing `>` (or the `/` of `/>` if self-closing).
//
// Respects quote escaping ("..." and '...'), brace nesting (sigil-prefixed
// ${, ?{, #{, !{, ^{, ~{ and bare {), and paren nesting ((expr)). Returns
// null if `raw` is malformed (no closing `>`).
function scanOpenerForAttrsNative(raw, start) {
    const len = raw.length;
    if (start >= len || raw[start] !== "<") return null;
    let pos = start + 1;
    while (pos < len && /\s/.test(raw[pos])) pos = pos + 1;
    const nameStart = pos;
    while (pos < len && /[A-Za-z0-9_-]/.test(raw[pos])) pos = pos + 1;
    const tagName = raw.slice(nameStart, pos);
    if (tagName.length === 0) return null;
    const attrStart = pos;
    let inDouble = false;
    let inSingle = false;
    let braceDepth = 0;
    let parenDepth = 0;
    let selfClosing = false;
    let openerEnd = -1;
    while (pos < len) {
        const c = raw[pos];
        if (braceDepth > 0) {
            if (c === "{") braceDepth = braceDepth + 1;
            else if (c === "}") braceDepth = braceDepth - 1;
            pos = pos + 1;
            continue;
        }
        if (parenDepth > 0) {
            if (c === "(") parenDepth = parenDepth + 1;
            else if (c === ")") parenDepth = parenDepth - 1;
            pos = pos + 1;
            continue;
        }
        if (inDouble === false && inSingle === false) {
            if (c === ">") { openerEnd = pos; break; }
            if (c === "/" && raw[pos + 1] === ">") {
                selfClosing = true;
                openerEnd = pos;
                break;
            }
            if ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && raw[pos + 1] === "{") {
                braceDepth = 1;
                pos = pos + 2;
                continue;
            }
            if (c === "{") { braceDepth = braceDepth + 1; pos = pos + 1; continue; }
            if (c === "(") { parenDepth = parenDepth + 1; pos = pos + 1; continue; }
            if (c === "\"") { inDouble = true; pos = pos + 1; continue; }
            if (c === "'") { inSingle = true; pos = pos + 1; continue; }
        } else if (inDouble && c === "\"") { inDouble = false; pos = pos + 1; continue; }
        else if (inSingle && c === "'") { inSingle = false; pos = pos + 1; continue; }
        else if (c === "\\") { pos = pos + 2; continue; }
        pos = pos + 1;
    }
    if (openerEnd === -1) return null;
    return { attrStart, openerEnd, selfClosing, tagName };
}

// extractOuterAttrSourceNative — calculation. VERBATIM port of
// ast-builder.js L529 `extractOuterAttrSource`. Returns the trimmed
// attribute-portion source of an outer markup block, or null if malformed.
function extractOuterAttrSourceNative(rawOpener) {
    const scan = scanOpenerForAttrsNative(rawOpener, 0);
    if (scan === null) return null;
    return rawOpener.slice(scan.attrStart, scan.openerEnd).trim();
}

// parseAttrNamesNative — calculation. VERBATIM port of ast-builder.js L565
// `parseAttrNames`. Parse a flat list of attribute names from a raw
// attribute-portion string. For typed-prop syntax `name:type`, the
// conflict-relevant identifier is the bare `name` (before `:`). For
// directives like `bind:value`, the full `bind:value` is kept so it doesn't
// collide with `value`. Returns { name, fullName, span: { start, end } }[].
function parseAttrNamesNative(attrSource) {
    const names = [];
    const len = attrSource.length;
    let pos = 0;
    const DIRECTIVE_PREFIXES = new Set([
        "bind", "on", "class", "use", "style", "transition", "in", "out", "animate",
    ]);
    while (pos < len) {
        while (pos < len && /\s/.test(attrSource[pos])) pos = pos + 1;
        if (pos >= len) break;
        const nameStart = pos;
        while (pos < len && /[A-Za-z0-9_:\-.@]/.test(attrSource[pos])) pos = pos + 1;
        if (pos === nameStart) { pos = pos + 1; continue; }
        const fullName = attrSource.slice(nameStart, pos);
        let nameForCompare = fullName;
        const colonIdx = fullName.indexOf(":");
        if (colonIdx > 0) {
            const prefix = fullName.slice(0, colonIdx);
            if (DIRECTIVE_PREFIXES.has(prefix) === false) {
                nameForCompare = prefix;
            }
        }
        names.push({ name: nameForCompare, fullName, span: { start: nameStart, end: pos } });
        while (pos < len && /\s/.test(attrSource[pos])) pos = pos + 1;
        if (pos < len && attrSource[pos] === "=") {
            pos = pos + 1;
            while (pos < len && /\s/.test(attrSource[pos])) pos = pos + 1;
            if (pos >= len) break;
            const c = attrSource[pos];
            if (c === "\"" || c === "'") {
                const quote = c;
                pos = pos + 1;
                while (pos < len && attrSource[pos] !== quote) {
                    if (attrSource[pos] === "\\" && pos + 1 < len) { pos = pos + 2; continue; }
                    pos = pos + 1;
                }
                if (pos < len) pos = pos + 1;
                continue;
            }
            if (c === "{" || ((c === "$" || c === "?" || c === "#" || c === "!" || c === "^" || c === "~") && attrSource[pos + 1] === "{")) {
                if (c !== "{") pos = pos + 1;
                let depth = 0;
                while (pos < len) {
                    const ch = attrSource[pos];
                    if (ch === "{") depth = depth + 1;
                    else if (ch === "}") {
                        depth = depth - 1;
                        if (depth === 0) { pos = pos + 1; break; }
                    }
                    pos = pos + 1;
                }
                continue;
            }
            if (c === "(") {
                let depth = 0;
                while (pos < len) {
                    const ch = attrSource[pos];
                    if (ch === "(") depth = depth + 1;
                    else if (ch === ")") {
                        depth = depth - 1;
                        if (depth === 0) { pos = pos + 1; break; }
                    }
                    pos = pos + 1;
                }
                continue;
            }
            while (pos < len && /\s/.test(attrSource[pos]) === false) {
                pos = pos + 1;
            }
        }
    }
    return names;
}

// findSingleBodyRootNative — calculation. Native analogue of ast-builder.js
// L637 `findSingleBodyRoot`, operating on native Block kinds (Markup / Text /
// Comment) rather than live block types. Whitespace-only Text blocks and
// Comment blocks are skipped. Returns:
//   { ok: true, root }
//   { ok: false, reason: "empty" | "multi-rooted", offendingBlocks }
//
// A native Markup block with TagKind.StateOpener (a state block per F7.a)
// counts as a markup root (the live oracle accepts both `markup` and `state`
// block types as body-root candidates — ast-builder.js L648).
function findSingleBodyRootNative(children, source) {
    if (Array.isArray(children) === false) {
        return { ok: false, reason: "empty", offendingBlocks: [] };
    }
    const markupChildren = [];
    const textNonWs = [];
    for (const child of children) {
        if (child === undefined || child === null) continue;
        if (child.kind === "Comment") continue;
        if (child.kind === "Text") {
            const raw = sliceBlockRaw(source, child.span);
            if (raw.trim().length === 0) continue;
            textNonWs.push(child);
            continue;
        }
        if (child.kind === "Markup") {
            markupChildren.push(child);
            continue;
        }
        // LogicEscape / CssEscape / SqlEscape / ErrorEffect / Meta / Test /
        // ForeignCode / DisplayTextLiteral inside a component body are
        // non-markup payload — count them as a non-whitespace offender so
        // the body is treated as multi-rooted (matches the live's textNonWs
        // catch-all at ast-builder.js L652).
        textNonWs.push(child);
    }
    if (markupChildren.length === 0 && textNonWs.length === 0) {
        return { ok: false, reason: "empty", offendingBlocks: [] };
    }
    if (markupChildren.length !== 1 || textNonWs.length > 0) {
        return {
            ok: false,
            reason: "multi-rooted",
            offendingBlocks: [...markupChildren, ...textNonWs],
        };
    }
    return { ok: true, root: markupChildren[0] };
}

// spliceAttrsIntoBodyRootNative — calculation. VERBATIM port of
// ast-builder.js L671 `spliceAttrsIntoBodyRoot`. Splice the outer's
// attribute-source into the body root's opener. Returns the spliced raw
// string, or null if the body root's opener is malformed.
function spliceAttrsIntoBodyRootNative(bodyRootRaw, outerAttrSource) {
    if (typeof outerAttrSource !== "string" || outerAttrSource.length === 0) {
        return bodyRootRaw;
    }
    const scan = scanOpenerForAttrsNative(bodyRootRaw, 0);
    if (scan === null) return null;
    const before = bodyRootRaw.slice(0, scan.openerEnd);
    const after = bodyRootRaw.slice(scan.openerEnd);
    const sep = /\s$/.test(before) ? "" : " ";
    return before + sep + outerAttrSource + after;
}

// liftBareBlocks — calculation (pure; returns a new array, no mutation). The
// P4-2 post-pass. Walk a native `Block[]` and convert bare-declaration `Text`
// blocks into synthetic `LogicEscape` blocks, mirroring the live
// `liftBareDeclarations` (ast-builder.js L740).
//
//   blocks      — the native Block[] (a markup element's `children`, or the
//                 file-level top stream).
//   source      — the source string (Text blocks carry spans, not raw text).
//   parentType  — null at file top level; "state" inside a `<program>` /
//                 `<page>` / `<channel>` body or a `state` block (a
//                 declaration site); "markup" inside any other markup
//                 element (prose context — lift suppressed).
//   ctx         — the live parse-context; a lifted logic body's diagnostics
//                 are forwarded into `ctx.diagnostics` (the live oracle's
//                 behaviour). May be null — `parseLogicBodyBestEffort`
//                 tolerates a null ctx for the delegation-frame note, but
//                 `pushDiagnostic` needs a real ctx, so callers that want
//                 lifted-body diagnostics MUST pass one.
//
// The lift fires for a `Text` block ONLY when `parentType !== "markup"`. A
// `Markup` / `state` block recurses its `children` with the propagated
// `parentType`. Every other block kind passes through unchanged.
//
// P5-2 — the loop is an INDEX loop (not a `for...of`) so a pairing branch can
// peek `blocks[i + 1]` for the FOLLOWING markup block and advance `i` past it
// when it consumes it. `synthCounter` is a `{ next }` record threaded through
// the recursion so channel-export helper names are file-unique (mirrors the
// live `_p3aSynthCounter`). It defaults at the top call.
export function liftBareBlocks(blocks, source, parentType, ctx, synthCounter) {
    const result = [];
    if (Array.isArray(blocks) === false) return result;
    const counter = (synthCounter !== undefined && synthCounter !== null)
        ? synthCounter : { next: 0 };
    let i = 0;
    while (i < blocks.length) {
        const block = blocks[i];
        if (block === undefined || block === null) {
            result.push(block);
            i = i + 1;
            continue;
        }

        // A state block's children are a declaration site — recurse with
        // parentType "state" (the live oracle: `block.type === "state"` ->
        // `liftBareDeclarations(children, ..., "state")`).
        if (block.kind === "Markup" && isStateBlock(block)) {
            const lifted = liftBareBlocks(block.children, source, "state", ctx, counter);
            result.push({ ...block, children: lifted });
            i = i + 1;
            continue;
        }

        // A markup element. `<program>` / `<page>` / `<channel>` direct
        // children are a declaration site (childContext "state"); any other
        // markup element is prose context (childContext "markup"). The
        // program-family check only applies at a non-prose parent — a
        // `<program>` nested inside another markup element is itself prose
        // (the live oracle gates `isProgramRoot` on `parentType !== "markup"`).
        if (block.kind === "Markup") {
            const name = typeof block.name === "string" ? block.name : "";
            const isDeclSite = parentType !== "markup" && isProgramFamilyRoot(name);
            const childContext = isDeclSite ? "state" : "markup";
            const lifted = liftBareBlocks(block.children, source, childContext, ctx, counter);
            result.push({ ...block, children: lifted });
            i = i + 1;
            continue;
        }

        // A Text block at a declaration site — the bare-statement lift. The
        // run's raw is tested against the canonical decl-keyword regexes; a
        // match converts it to a synthetic LogicEscape block.
        if (block.kind === "Text" && parentType !== "markup") {
            const raw = sliceBlockRaw(source, block.span);

            // P5-2 PAIRING FORMS — checked BEFORE the single-Text-block lifts.
            // A `const Name = ` trailer also matches `BARE_DECL_RE`'s `const`
            // term, so the pairing branch must run first; otherwise the
            // single-block lift would synthesize a logic body of just the
            // dangling `const Name = ` with no RHS.
            const next = blocks[i + 1];
            const hasMarkupNext = next !== undefined && next !== null
                && next.kind === "Markup";

            // BARE_EXPORT_AT_END_RE — a `Text` block ending with a bare
            // `export` keyword paired with a FOLLOWING markup block. The
            // `export <channel name="...">...</>` channel-export form (and a
            // future `export <Component>` Form-1). Mirrors ast-builder.js
            // L807 / L956 — the channel branch.
            if (hasMarkupNext && BARE_EXPORT_AT_END_RE.test(raw)) {
                const paired = liftPairedExport(block, next, raw, source, ctx, counter);
                if (paired !== null) {
                    for (const b of paired.blocks) result.push(b);
                    // A successful export-pairing always consumes BOTH the
                    // Text block and the following Markup block (the channel
                    // markup is RETAINED in `paired.blocks`, but the input
                    // index still advances past it so it is not re-processed).
                    i = i + 2;
                    continue;
                }
            }

            // BARE_DECL_NAME_EQ_AT_END_RE — a `Text` block ending with a
            // `(export )?(const|let) Name = ` component-def header paired with
            // a FOLLOWING markup block. The `const Name = <markup>` Form-2.
            // Mirrors ast-builder.js L1092.
            if (hasMarkupNext) {
                const m = raw.match(BARE_DECL_NAME_EQ_AT_END_RE);
                if (m !== null) {
                    const paired = liftPairedDeclEq(block, next, m, source, ctx, parentType, counter);
                    for (const b of paired) result.push(b);
                    i = i + 2; // the Text block + the consumed markup block
                    continue;
                }
            }

            // BARE_DECL_RE — `type` / `export` / `import` / `fn` /
            // `server fn` / `let` / `const` decl keywords. Fires at any
            // declaration-site parent.
            if (BARE_DECL_RE.test(raw)) {
                result.push(synthLiftedLogicBlock(block, source, ctx));
                i = i + 1;
                continue;
            }
            // TOPLEVEL_STATE_DECL_RE — a `<Ident ...>` opener then `=`/`:`.
            if (TOPLEVEL_STATE_DECL_RE.test(raw)) {
                result.push(synthLiftedLogicBlock(block, source, ctx));
                i = i + 1;
                continue;
            }
            // TILDE_TOKEN_RE — a bare `~` pipeline token. The live oracle
            // gates this on `parentType === "state"` (a `<program>` /
            // `<page>` / `<channel>` direct-child body) — NOT plain file
            // top-level — to avoid lifting prose markup that contains `~`.
            if (parentType === "state" && TILDE_TOKEN_RE.test(raw)) {
                result.push(synthLiftedLogicBlock(block, source, ctx));
                i = i + 1;
                continue;
            }
        }

        result.push(block);
        i = i + 1;
    }
    return result;
}

// liftPairedExport — calculation. The P5-2 `export <markup>` pairing pass. A
// `Text` block whose trailing portion is a bare `export` keyword, paired with
// a FOLLOWING `Markup` block. Mirrors `liftBareDeclarations`'s `export`
// branches (ast-builder.js L807).
//
// CHANNEL case (`export <channel name="...">`) — the live oracle emits TWO
// blocks: a synthetic `logic` block carrying the channel-export marker (so it
// hoists as one `export`) PLUS the channel `Markup` block kept as-is
// (ast-builder.js L1000 / L1019). The native side mirrors that: the synthetic
// logic body is `export const <unique> = "<channelName>"` (a clean
// `Export(VarDecl)` — no Form-1 desugar garbage), and the channel markup is
// retained. The channel's own children are recursed here (it is an
// `isProgramFamilyRoot` declaration site) since the caller advances PAST the
// markup block and does not re-process it.
//
// Returns `{ blocks }`, or `null` when the pairing does not apply (the markup
// is not a recognized export-paired element) so the caller falls through to
// the other lift rules.
function liftPairedExport(textBlock, markupBlock, raw, source, ctx, counter) {
    const markupName = typeof markupBlock.name === "string" ? markupBlock.name : "";

    // CHANNEL — `export <channel name="...">...</>` (SPEC §38.12.6).
    if (markupName === "channel") {
        const m = raw.match(EXPORT_PREFIX_SPLIT_RE);
        const prefixRaw = m !== null ? m[1] : "";
        const out = [];
        // Re-emit + re-lift the pre-`export` prefix (comments / whitespace /
        // a preceding state-decl) so its own lift rules still fire.
        const prefixBlock = synthPrefixTextBlock(textBlock, prefixRaw);
        if (prefixBlock !== null) {
            const reLifted = liftBareBlocks([prefixBlock], source, "state", ctx, counter);
            for (const b of reLifted) out.push(b);
        }
        // Extract the channel's string-literal `name="..."` attribute. A
        // reactive `name=@var` form (no match) yields no compile-time-stable
        // identity — the live oracle reports E-CHANNEL-EXPORT-001 and keeps
        // the channel as a per-page (non-export) declaration. The native
        // structural canary does not model that diagnostic; fall through to
        // a no-pairing result so the channel markup is emitted unlifted.
        const nameMatch = markupName === "channel"
            ? sliceBlockRaw(source, markupBlock.span).match(CHANNEL_NAME_ATTR_RE)
            : null;
        if (nameMatch === null) return null;
        const channelName = nameMatch[1];
        // Synthesize the channel-export logic block. The body is a clean
        // `export const <unique> = "<name>"` — it hoists as exactly one
        // `Export`, mirroring the live oracle's synthetic helper-const
        // (ast-builder.js L998). The span covers the `export` trailer.
        counter.next = counter.next + 1;
        const helperName = "_native_channel_export_" + counter.next;
        const bodyText = "export const " + helperName + " = "
            + JSON.stringify(channelName);
        const span = textBlock.span;
        const trailerStart = (span !== undefined && span !== null
            && typeof span.start === "number")
            ? span.start + prefixRaw.length : 0;
        const synthSpan = (span !== undefined && span !== null)
            ? { ...span, start: trailerStart, end: trailerStart + bodyText.length }
            : span;
        const synthLogic = synthPairedLogicBlock(bodyText, synthSpan, ctx);
        synthLogic._channelExport = channelName;
        out.push(synthLogic);
        // Keep the channel markup block (the live oracle retains it tagged
        // `_p3aIsExport`). The caller advances PAST this markup block, so its
        // children are recursed here — `<channel>` is an `isProgramFamilyRoot`
        // declaration site (childContext "state").
        const channelChildren = liftBareBlocks(
            markupBlock.children, source, "state", ctx, counter);
        out.push({ ...markupBlock, children: channelChildren, _channelExport: channelName });
        return { blocks: out };
    }

    // COMPONENT — `export <PascalCaseName outerAttrs>{body}</>` Form 1
    // (SPEC §21.2). M6.4a — native-side desugar mirror of ast-builder.js
    // L807-940. Per SPEC §21.2 normative: the outer self-named tag is dropped
    // at the source level; the body's single root markup element absorbs all
    // of the outer's attributes. Form 1 is then byte-equivalent to Form 2
    // (`export const Name = <body-root mergedAttrs>...</body-root>`) at the
    // AST and rendered-HTML level.
    //
    // The native side synthesizes the equivalent Form-2 body text and runs
    // it through `synthPairedLogicBlock` — `parseLogicBodyBestEffort` parses
    // `export const Name = <markup>` into an `Export(VarDecl)` Stmt whose
    // declaration carries the markup-as-value RHS, and `collectHoisted`
    // hoists it into `FileAST.exports` AND `FileAST.components` (via
    // `collectComponentDefs` recognizing the PascalCase `const Name = <markup>`
    // pattern). Downstream MOD/CE then resolves `<Name/>` references at use
    // sites, closing the M6.4 E-COMPONENT-035 regression.
    //
    // E-EXPORT-002 (empty / multi-rooted body) and E-EXPORT-003 (attr
    // conflict) fall through to `null` here — no pairing emitted. The
    // structural canary's `LIVE-DEGENERATE` heuristic credits the no-pair
    // disposition as acceptable for those error shapes; a future unit can
    // extend native diagnostic attribution if cross-pipeline drift surfaces.
    if (isFormOneComponentName(markupName)) {
        const m = raw.match(EXPORT_PREFIX_SPLIT_RE);
        const prefixRaw = m !== null ? m[1] : "";
        const out = [];
        // Re-emit + re-lift the pre-`export` prefix (a preceding state-decl,
        // a `function f() {...}` bare-decl, etc.) so its own lift rules
        // still fire. Mirrors the channel branch above + ast-builder.js
        // L817 (legacy emits the prefix without re-lifting; native is
        // already conservative on this point in the channel branch — keep
        // them symmetric here).
        const prefixBlock = synthPrefixTextBlock(textBlock, prefixRaw);
        if (prefixBlock !== null) {
            const reLifted = liftBareBlocks([prefixBlock], source, "state", ctx, counter);
            for (const b of reLifted) out.push(b);
        }
        // Step 1: slice the outer markup's full raw (opener through closer).
        const outerRaw = sliceBlockRaw(source, markupBlock.span);
        // Step 2: extract the outer's attribute source (between the tag name
        // and the closing `>` of the opener).
        const outerAttrSource = extractOuterAttrSourceNative(outerRaw);
        // outerAttrSource === null is unreachable for a well-formed Markup
        // block (the parser already validated the opener), but defensively
        // fall through to null so the caller's other lift rules apply.
        if (outerAttrSource === null) return null;
        // Step 3: locate the single root markup body. Empty / multi-rooted
        // bodies are E-EXPORT-002 in the live oracle — native falls through
        // to null (no pairing) so the markup is emitted unlifted.
        const bodyResult = findSingleBodyRootNative(markupBlock.children, source);
        if (bodyResult.ok === false) return null;
        const bodyRoot = bodyResult.root;
        // Step 4: detect attr-name conflicts between outer and body root.
        // §15.5 class-merging exception: `class` may legitimately appear on
        // both the outer and the body root because scrml class-attr merging
        // combines them. Only non-class names trigger E-EXPORT-003.
        const bodyRootRaw = sliceBlockRaw(source, bodyRoot.span);
        let bodyAttrSource = "";
        const bodyOpenerScan = scanOpenerForAttrsNative(bodyRootRaw, 0);
        if (bodyOpenerScan !== null) {
            bodyAttrSource = bodyRootRaw
                .slice(bodyOpenerScan.attrStart, bodyOpenerScan.openerEnd)
                .trim();
        }
        const outerNames = outerAttrSource.length > 0
            ? parseAttrNamesNative(outerAttrSource) : [];
        const bodyNames = bodyAttrSource.length > 0
            ? parseAttrNamesNative(bodyAttrSource) : [];
        const bodyNameSet = new Set(bodyNames.map(n => n.name));
        const conflicts = outerNames.filter(n =>
            n.name !== "class" && bodyNameSet.has(n.name)
        );
        if (conflicts.length > 0) return null;
        // Step 5: splice outer attrs into body root opener, producing the
        // RHS markup raw for `export const Name = <body-root mergedAttrs>...
        // </body-root>`. The body root's children are preserved verbatim
        // (their text is inside `bodyRootRaw` already — slicing from
        // bodyRoot.span captures the whole element).
        const splicedRaw = spliceAttrsIntoBodyRootNative(bodyRootRaw, outerAttrSource);
        if (splicedRaw === null) return null;
        // Step 6: build the synthetic logic body text. The form is
        // `export const Name = <body-root mergedAttrs>...</body-root>` —
        // exactly the Form 2 RHS. `parseLogicBodyBestEffort` parses it into
        // an `Export(VarDecl)` Stmt; `collectHoisted` then hoists both the
        // export entry AND the component-def.
        const compName = markupName;
        const bodyText = "export const " + compName + " = " + splicedRaw;
        // Step 7: span the synthesized logic node from the original text-
        // block's `export ` trailer start through the markup block's end.
        const tSpan = textBlock.span;
        const mSpan = markupBlock.span;
        const trailerStart = (tSpan !== undefined && tSpan !== null
            && typeof tSpan.start === "number")
            ? tSpan.start + prefixRaw.length : 0;
        const markupEnd = (mSpan !== undefined && mSpan !== null
            && typeof mSpan.end === "number")
            ? mSpan.end : trailerStart + bodyText.length;
        const synthSpan = (tSpan !== undefined && tSpan !== null)
            ? { ...tSpan, start: trailerStart, end: markupEnd }
            : tSpan;
        const synthLogic = synthPairedLogicBlock(bodyText, synthSpan, ctx);
        // M6.4a observability markers (mirrors ast-builder.js L929-936 —
        // _p2Form1 / _p2Form1Name / _p2Form1BodyRoot). Native-bridge
        // `synthLogicNode` does not currently forward these to the live
        // FileAST node shape; they are carried on the native block for
        // dual-pipeline canary diffing + future test assertions.
        synthLogic._p2Form1 = true;
        synthLogic._p2Form1Name = compName;
        synthLogic._p2Form1BodyRoot = typeof bodyRoot.name === "string"
            ? bodyRoot.name : null;
        out.push(synthLogic);
        return { blocks: out };
    }

    // No other `export <markup>` form is recognized as a pairing here.
    return null;
}

// liftPairedDeclEq — calculation. The P5-2 `const Name = <markup>` pairing
// pass. A `Text` block whose trailing portion is a `(export )?(const|let)
// Name = ` component-def header (`m` is the BARE_DECL_NAME_EQ_AT_END_RE
// match — group 1 the prefix, group 2 the trailer), paired with a FOLLOWING
// `Markup` block. Mirrors `liftBareDeclarations`'s Bug-2 branch
// (ast-builder.js L1092).
//
// Unlike the channel case, this emits ONE synthetic `logic` block that
// ABSORBS the markup block — its body is `(export )?(const|let) Name =
// <markup-raw>`, a single `VarDecl` (or `Export(VarDecl)`) whose init is the
// markup. The markup block is consumed (the caller advances `i` by 2). The
// leading prefix is re-emitted + re-lifted as its own Text block.
//
// Returns the block array to splice into the result.
function liftPairedDeclEq(textBlock, markupBlock, m, source, ctx, parentType, counter) {
    const prefixRaw = m[1];
    const trailerRaw = m[2];
    const out = [];
    // Re-emit + re-lift the prefix (a preceding `<count> = 0` state-decl, a
    // `function f() {...}` bare-decl, etc.). The prefix's parentType is the
    // SAME as this pass's parentType (ast-builder.js L1114).
    const prefixBlock = synthPrefixTextBlock(textBlock, prefixRaw);
    if (prefixBlock !== null) {
        const reLifted = liftBareBlocks([prefixBlock], source, parentType, ctx, counter);
        for (const b of reLifted) out.push(b);
    }
    // Build the synthetic logic body: the trimmed trailer (`(export )?
    // (const|let) Name = `) spliced with the markup block's verbatim raw.
    const markupRaw = sliceBlockRaw(source, markupBlock.span);
    const bodyText = trailerRaw.replace(/^\s+/, "") + markupRaw;
    // The synthetic node spans [trailerStart, markupEnd].
    const tSpan = textBlock.span;
    const mSpan = markupBlock.span;
    const trailerStart = (tSpan !== undefined && tSpan !== null
        && typeof tSpan.start === "number")
        ? tSpan.start + prefixRaw.length : 0;
    const markupEnd = (mSpan !== undefined && mSpan !== null
        && typeof mSpan.end === "number")
        ? mSpan.end : trailerStart + bodyText.length;
    const synthSpan = (tSpan !== undefined && tSpan !== null)
        ? { ...tSpan, start: trailerStart, end: markupEnd }
        : tSpan;
    out.push(synthPairedLogicBlock(bodyText, synthSpan, ctx));
    return out;
}

// parseMarkup — entry point. Pure fn over the source string; the loop is a
// thin trampoline dispatching by BlockContext, mirroring lex.js. Returns the
// typed block-stream (ctx.nodes).
//
// `options` (optional) is forwarded to runMarkup. P5-14 v2 (S121): the only
// recognized option is `inMarkupValueSlice` — see parseMarkupTrace.
export function parseMarkup(source, options) {
    return runMarkup(source, options).ctx.nodes;
}

// parseMarkupTrace — like parseMarkup, but returns the full run record
// { ctx, contextTrace } so unit tests can observe the BlockContext transition
// sequence + the final ctx state (brackets / delegationStack /
// blockContextStack / nodes). The contextTrace is the @blockContext value
// recorded at the TOP of every trampoline iteration.
//
// `options` (optional) — P5-14 v2 (S121):
//   - `inMarkupValueSlice` (bool, default false) — when true the markup
//     run is parsing a substring extracted by parse-expr's parseMarkupValue
//     (an in-expression markup-value). The slice's mismatch-recovery
//     semantics MUST mirror the live `parseLiftTag` (ast-builder.js
//     L3098-3099): BAIL (no pop) on an explicit-closer mismatch so the
//     caller's cursor stays before the mismatched closer and the LIVE-side
//     raw-text component-def fallback can fire. When false (the default —
//     file-level parsing), the mismatch POPS the open frame to mirror the
//     live block-splitter's `popTagContext("explicit")` recovery at
//     block-splitter.js L1576-1586. handleCloser derives the
//     `allowMismatchPop` flag passed to closeTagFrame from this single
//     option (`allowMismatchPop = !ctx.inMarkupValueSlice`).
export function parseMarkupTrace(source, options) {
    return runMarkup(source, options);
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
function runMarkup(source, options) {
    const cursor = makeCursor(source);
    const ctx = makeParseContext();
    // MK4 — thread the source onto the ctx so emitContextBlock can slice a
    // logic-escape body's text for the markup->JS delegate-down direction
    // (R1 spike §3 seam contract). The source is the SAME string the cursor
    // walks; this is a read-only reference, not a copy (one buffer, one
    // coordinate space — punch-list P2 one-cursor invariant).
    ctx.source = source;
    // P5-14 v2 (S121): record slice-mode on the ctx so handleCloser can
    // derive the `allowMismatchPop` option for closeTagFrame. Default false
    // (file-level parse mode). The flag is set ONCE at runMarkup-entry and
    // never mutated — a SINGLE parseMarkupTrace invocation is either
    // slice-mode for its entire lifetime or file-mode for its entire
    // lifetime. parseMarkupValue's recursive slice descent gets its own
    // fresh ctx via the lazy-required parseMarkupTrace call.
    ctx.inMarkupValueSlice = options !== null
        && options !== undefined
        && options.inMarkupValueSlice === true;
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
