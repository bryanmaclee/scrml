// display-text-literal.js — JS-host shadow of display-text-literal.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors display-text-literal.scrml's header.
//
// DisplayTextLiteral is the SPEC §4.18.3/.4 `"..."` display-text-literal
// engine (charter Q1.E) — the markup-layer engine that scans a
// display-text literal (a sequence of literal-text segments and `${...}`
// interpolations — the vehicle for plain display text inside a
// code-default body). It is the direct analogue of the M1 JS-layer
// template-literal engine (lex-mode.js's `.InTemplateBody` nested-engine);
// per charter Q1.E + R1 seam punch-list P6 the native parser REUSES that
// engine's shape rather than building a second template-string engine.
//
// MK3.1 SCOPE (landed): the engine SKELETON — the `type DisplayTextLiteral
// :enum` declaration + the `<engine>` declaration with its rule= contract
// (see the .scrml). MK3.2 — THIS dispatch — fills in the substantive
// literal-scanning logic for `.Outside` / `.InLiteralText`:
//   - the `"` open transition (.Outside -> .InLiteralText) and the `"`
//     close transition (.InLiteralText -> .Outside);
//   - the `\"` / `\\` / `\${` escape recognition consumed within
//     `.InLiteralText` (SPEC §4.18.3 — `\"` / `\\`; §4.18.4 — `\${`);
//   - whitespace accumulated VERBATIM into the literal-text segment
//     (SPEC §4.18.5 — no collapse, no strip);
//   - `'` and a backtick are ORDINARY interior characters — no transition
//     (SPEC §4.18.3);
//   - emit the DisplayTextLiteral AST node carrying the literal's text
//     segment(s);
//   - an unterminated literal -> E-CTX-001 against the opening `"`
//     (SPEC §4.18.3 / §4.18.7 recovery).
// MK3.3 fills `.InInterpolation` — the `${...}` interpolation delegation to
// the M2 JS expression parser + the one-node `{segments, exprs}` shape +
// E-UNQUOTED-DISPLAY-TEXT.
//
// THE ESCAPE SET IS DELIBERATELY MINIMAL. SPEC §4.18.3 — a display-text
// literal recognizes exactly `\"` and `\\`; §4.18.4 adds `\${`. It does
// NOT recognize the full JS string-escape table (`\n` / `\xHH` / `\uHHHH`
// / line-continuation / …). MK3.2 therefore does NOT reuse
// lex-in-single-string's `scanStringEscape` (which decodes that whole
// table); the literal-text escape scanner here is §4.18-specific. A
// backslash followed by any other character is a malformed escape —
// `E-PARSE-001` (SPEC §4.18.3) — recovered by emitting the backslash
// literally and continuing.

import { peekChar, peekStr, advance, isEof } from "./cursor.js";
import { makeSpan } from "./span.js";

// DisplayTextLiteral variant tags — all 3 per charter Q1.E.
//   Outside        — the cursor is NOT inside a display-text literal (the
//                    code-grammar regime in a code-default body).
//   InLiteralText  — the cursor is inside the `"..."` literal,
//                    accumulating a literal-text segment.
//   InInterpolation — the cursor is inside a `${expr}` interpolation
//                    within the literal.
export const DisplayTextLiteral = Object.freeze({
    Outside:         "Outside",
    InLiteralText:   "InLiteralText",
    InInterpolation: "InInterpolation",
});

// initialDisplayTextLiteral — calculation. Matches `initial=.Outside` —
// a code-default body begins OUTSIDE any display-text literal.
export function initialDisplayTextLiteral() {
    return DisplayTextLiteral.Outside;
}

// doubleQuote — calculation. The one-character `"` display-text-literal
// delimiter (SPEC §4.18.3 — `"`-only). Mirrors the .scrml's
// String.fromCharCode form 1:1 (the .scrml assembles it for ANOMALY-1
// string-literal-discipline consistency with the markup-layer files; the
// .js keeps the same shape).
export function doubleQuote() {
    return String.fromCharCode(34);
}

// backslash — calculation. The one-character `\` escape-introducer. SPEC
// §4.18.3 — inside a display-text literal a `\` introduces an escape
// sequence (`\"` / `\\` / `\${`). Assembled via char-code to keep this
// file consistent with the markup-layer ANOMALY-1 discipline (a literal
// backslash in scrml source needs escaping; the assembled form sidesteps
// it).
export function backslash() {
    return String.fromCharCode(92);
}

// interpolationOpen — calculation. The two-character `${` interpolation
// opener (SPEC §4.18.4 — `${` opens an interpolation inside the literal).
// Assembled via char-code per the markup-layer ANOMALY-1 discipline (a
// brace-bearing literal in scrml source opens a spurious context). MK3.2's
// scanner recognizes this sequence as a segment boundary; MK3.3 wires the
// JS-expression-parser delegation that consumes the interpolation body.
export function interpolationOpen() {
    return String.fromCharCode(36) + String.fromCharCode(123);
}

// LEGAL_FROM_IN_LITERAL_TEXT — the rule= matrix on the <InLiteralText>
// state-child, as a lookup table. From .InLiteralText the engine may
// transition to .Outside (the closing `"`) or .InInterpolation (a `${`
// opener). Validates transitions against this matrix — the live-surface
// rule= mirror, the same shape lex-mode.js's LEGAL_FROM_IN_CODE provides.
export const LEGAL_FROM_IN_LITERAL_TEXT = Object.freeze({
    Outside:         true,
    InInterpolation: true,
});

// ===========================================================================
// MK3.2 — THE LITERAL-TEXT ESCAPE SCANNER (SPEC §4.18.3 + §4.18.4).
//
// Inside a display-text literal exactly THREE escape sequences are
// recognized:
//   \"   -> a literal double-quote   (SPEC §4.18.3)
//   \\   -> a literal backslash      (SPEC §4.18.3)
//   \${  -> a literal `${` sequence  (SPEC §4.18.4 — escapes the
//           interpolation opener so a literal `${` can appear as text)
// Any other character after a `\` is a MALFORMED escape — SPEC §4.18.3
// (E-PARSE-001). The native parser recovers from a malformed escape by
// treating the `\` as a literal backslash character and continuing the
// scan from the character after it (the offending char is then scanned
// normally as the next literal character).
// ===========================================================================

// classifyEscape — calculation (pure predicate). Given the character
// immediately after a `\` (and, for the `${` case, the one after that),
// which escape sequence — if any — does the `\` introduce? Returns one of
// "quote" / "backslash" / "dollarBrace" / "malformed". A `\` at end-of-
// input (no following char) is "malformed" — there is nothing to escape.
export function classifyEscape(afterBackslash, afterAfter) {
    if (afterBackslash === doubleQuote()) return "quote";
    if (afterBackslash === backslash())   return "backslash";
    if (afterBackslash === String.fromCharCode(36) &&
        afterAfter === String.fromCharCode(123)) {
        return "dollarBrace";
    }
    return "malformed";
}

// scanLiteralEscape — STATE write (cursor advance) + calculation (the
// produced cooked text). The cursor is positioned AT the introducing `\`.
// Consume the full escape sequence and return its cooked (resolved) text.
//
// Returns { cooked, malformed }:
//   - `\"`  -> { cooked: '"',  malformed: false }  (2 chars consumed)
//   - `\\`  -> { cooked: '\\', malformed: false }  (2 chars consumed)
//   - `\${` -> { cooked: '${', malformed: false }  (3 chars consumed)
//   - malformed (a `\` before any other char, or a `\` at EOF) ->
//     { cooked: '\\', malformed: true } — the `\` is consumed (1 char);
//     the offending character is left for the caller's next scan iteration
//     (it is an ordinary literal character). The caller records the
//     E-PARSE-001 diagnostic; this fn only does the consumption + cook.
export function scanLiteralEscape(cursor) {
    // Consume the introducing `\`.
    advance(cursor, 1);
    if (isEof(cursor)) {
        // A `\` at end-of-input — nothing to escape. Malformed; the cooked
        // text is the bare backslash.
        return { cooked: backslash(), malformed: true };
    }

    const after = peekChar(cursor, 0);
    const afterAfter = peekChar(cursor, 1);
    const kind = classifyEscape(after, afterAfter);

    if (kind === "quote") {
        advance(cursor, 1);
        return { cooked: doubleQuote(), malformed: false };
    }
    if (kind === "backslash") {
        advance(cursor, 1);
        return { cooked: backslash(), malformed: false };
    }
    if (kind === "dollarBrace") {
        advance(cursor, 2);
        return { cooked: interpolationOpen(), malformed: false };
    }

    // Malformed — a `\` before any other character. The `\` is already
    // consumed; the offending character stays for the next scan iteration
    // (it is an ordinary literal character — SPEC §4.18.3 recovery).
    return { cooked: backslash(), malformed: true };
}

// ===========================================================================
// MK3.2 — THE DisplayTextLiteral AST NODE (SPEC §4.18.8 — distinct kind).
//
// SPEC §4.18.4: a display-text literal is "a sequence of literal-text
// segments and `${expr}` interpolations" — the template-string shape. A
// literal carrying interpolations is ONE body child interleaving literal
// segments and interpolated expressions (NOT decomposed into siblings).
// The node carries `{ segments, exprs }` — the §4.18.4 / D3 Template-node
// shape (parallels the JS-layer `Template(quasis, exprs)`).
//
// MK3.2 (non-interpolation): `exprs` is the empty array; `segments` carries
// the literal's text. A non-interpolation literal therefore has exactly
// ONE segment. MK3.3 fills `exprs` with the interpolation expressions and
// splits `segments` at each interpolation.
//
// A segment is `{ raw, cooked }`: `raw` is the verbatim source between the
// quotes (escapes UNRESOLVED — SPEC §4.18.5 whitespace is in `raw` exactly
// as written); `cooked` is the resolved text (escapes applied — `\"` ->
// `"`, `\\` -> `\`, `\${` -> `${`). Codegen's §4.18.6 auto-HTML-escape
// reads `cooked`; the two-stage cook/escape split mirrors the JS-layer
// template-chunk `{ raw, cooked }`.
// ===========================================================================

// makeLiteralSegment — calculation (pure data builder). One literal-text
// segment of a display-text literal: { raw, cooked }.
export function makeLiteralSegment(raw, cooked) {
    return { raw, cooked };
}

// makeDisplayTextLiteralNode — calculation (pure data builder). The
// DisplayTextLiteral AST node. `segments` is the literal-text-segment
// array; `exprs` is the interpolation-expression array (empty at MK3.2 —
// non-interpolation); `span` is the whole-literal span (the opening `"`
// through the closing `"`, or through EOF / the body closer for an
// unterminated literal); `terminated` records whether a closing `"` was
// found (false for an unterminated literal recovered per §4.18.7).
export function makeDisplayTextLiteralNode(segments, exprs, span, terminated) {
    return {
        kind: "DisplayTextLiteral",
        segments,
        exprs,
        span,
        terminated,
    };
}

// ===========================================================================
// THE DIAGNOSTIC SINK — shared with the markup layer (tag-frame.js).
//
// MK3.2 produces two display-text-literal diagnostics:
//   - E-CTX-001 — an unterminated literal (EOF / the body closer reached
//     before the closing `"`); blamed at the OPENING `"` (SPEC §4.18.3 /
//     §4.18.7). Recovered: the captured text is the literal's content.
//   - E-PARSE-001 — a malformed escape (a `\` before a char other than
//     `"` / `\` / `${`); blamed at the `\`. Recovered: the `\` is a
//     literal backslash (SPEC §4.18.3).
// The sink is `ctx.diagnostics` — the SAME array tag-frame.js's
// pushDiagnostic appends to (MK2.2 introduced it). display-text-literal.js
// re-implements the lazy-init + push here rather than importing tag-frame
// .js, so the module does not take a dependency on the whole TagFrame
// engine for one array push (and there is no display-text-literal <->
// tag-frame import cycle). The shape — { code, message, span } — is
// identical, so the conformance harness reads one uniform diagnostic
// stream.
// ===========================================================================

// ensureDiagnostics — STATE write (lazy init). A parse context built
// before MK2.2 has no `diagnostics` slot; this keeps the helper total.
export function ensureDiagnostics(ctx) {
    if (ctx.diagnostics === undefined || ctx.diagnostics === null) {
        ctx.diagnostics = [];
    }
}

// makeDiagnostic — calculation (pure data builder). One structured
// diagnostic: { code, message, span }. Identical shape to tag-frame.js's
// makeDiagnostic so the streams unify.
export function makeDiagnostic(code, message, span) {
    return { code, message, span };
}

// pushDiagnostic — STATE write: append a diagnostic to ctx.diagnostics.
export function pushDiagnostic(ctx, diagnostic) {
    ensureDiagnostics(ctx);
    ctx.diagnostics.push(diagnostic);
}

// ===========================================================================
// MK3.2 — scanDisplayTextLiteral: THE `.Outside` -> `.InLiteralText` ->
// `.Outside` LITERAL SCAN (SPEC §4.18.3 / §4.18.5).
//
// This is the live-surface realization of the DisplayTextLiteral engine's
// `.Outside` / `.InLiteralText` state-child bodies. The cursor MUST be
// positioned AT the opening `"` (`.Outside` — a `"` is the open trigger).
// The scan:
//
//   1. `.Outside` -> `.InLiteralText`: consume the opening `"`. Anchor the
//      whole-literal span at the `"`.
//   2. `.InLiteralText`: accumulate the literal-text segment character by
//      character —
//        - `\` introduces an escape (`\"` / `\\` / `\${`) — scanLiteralEscape
//          consumes it; the cooked result joins the segment; a malformed
//          escape records E-PARSE-001;
//        - whitespace (space / tab / newline) is accumulated VERBATIM into
//          the segment (SPEC §4.18.5 — no collapse, no strip);
//        - `'` and a backtick are ORDINARY characters — accumulated, no
//          transition (SPEC §4.18.3);
//        - a `${` opener is the `.InInterpolation` transition — MK3.2
//          recognizes it as a segment boundary + STOPS the scan there
//          (interpolation is MK3.3 — see the forward-seam note below);
//        - a `"` closes the literal — `.InLiteralText` -> `.Outside`.
//   3. `.InLiteralText` -> `.Outside`: consume the closing `"`. The
//      whole-literal span extends through it.
//
//   Unterminated: EOF reached before the closing `"`. SPEC §4.18.3 /
//   §4.18.7 — E-CTX-001 against the OPENING `"`; recover by treating the
//   captured text (opening `"` through EOF) as the literal's content.
//
// MK3.3 FORWARD SEAM — `${...}` interpolation. MK3.2's scan STOPS at an
// un-escaped `${`: the literal up to that point is one segment, and the
// scan returns with `stoppedAtInterp: true` so MK3.3 can resume — open the
// `.InInterpolation` composite state-child, delegate the `${expr}` body to
// the M2 JS expression parser, and continue accumulating segments after
// the matching `}`. At MK3.2 a literal containing `${` therefore yields a
// PARTIAL node (its first segment, `exprs` empty, `terminated` false) — a
// non-interpolation literal (the MK3.2 primary case, every §4.18.3 worked
// example) yields a COMPLETE one-segment node. The `${` recognition lives
// here (not MK3.3) so MK3.2's scanner already knows where a literal ends;
// MK3.3 only adds the delegation.
//
// Returns { node, stoppedAtInterp }:
//   - `node` — the DisplayTextLiteralNode (one segment at MK3.2);
//   - `stoppedAtInterp` — true iff the scan stopped at an un-escaped `${`
//     (the MK3.3 resume point); false for a clean close or an unterminated
//     literal.
// ===========================================================================
export function scanDisplayTextLiteral(cursor, ctx) {
    // The opening `"` MUST be at the cursor — the `.Outside` open trigger.
    // A defensive guard: if it is not, produce an empty unterminated node
    // at the cursor and do not advance (the caller's loop sentinel handles
    // progress). The trampoline only calls this when a `"` is recognized,
    // so this branch is unreachable in normal operation.
    const openPos = cursor.pos;
    const openLine = cursor.line;
    const openCol = cursor.col;
    if (peekChar(cursor, 0) !== doubleQuote()) {
        const span = makeSpan(openPos, openPos, openLine, openCol);
        return {
            node: makeDisplayTextLiteralNode(
                [makeLiteralSegment("", "")], [], span, false),
            stoppedAtInterp: false,
        };
    }

    // 1. `.Outside` -> `.InLiteralText`: consume the opening `"`.
    advance(cursor, 1);
    const segmentStart = cursor.pos;

    // 2. `.InLiteralText`: accumulate the literal-text segment.
    let cooked = "";
    let terminated = false;
    let stoppedAtInterp = false;

    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);

        // A `\` introduces an escape (`\"` / `\\` / `\${`).
        if (c === backslash()) {
            const escapePos = cursor.pos;
            const escapeLine = cursor.line;
            const escapeCol = cursor.col;
            const esc = scanLiteralEscape(cursor);
            cooked = cooked + esc.cooked;
            if (esc.malformed) {
                // SPEC §4.18.3 — a `\` before a char other than `"` / `\`
                // / `${` is a malformed escape. E-PARSE-001, blamed at the
                // `\`; the `\` is recovered as a literal backslash.
                pushDiagnostic(ctx, makeDiagnostic(
                    "E-PARSE-001",
                    "Malformed escape in display-text literal — a backslash " +
                    "may only introduce escaped-quote , escaped-backslash , " +
                    "or escaped-dollar-brace .",
                    makeSpan(escapePos, cursor.pos, escapeLine, escapeCol),
                ));
            }
            continue;
        }

        // A `"` closes the literal — `.InLiteralText` -> `.Outside`.
        if (c === doubleQuote()) {
            terminated = true;
            break;
        }

        // A `${` opener is the `.InInterpolation` transition. MK3.2 stops
        // the scan here — the segment ends at the `${`; MK3.3 resumes (see
        // the forward-seam note in the fn header). The `${` is NOT
        // consumed — MK3.3's resume reads it.
        if (peekStr(cursor, 2) === interpolationOpen()) {
            stoppedAtInterp = true;
            break;
        }

        // Ordinary literal character — accumulated VERBATIM. This branch
        // covers whitespace (space / tab / newline — SPEC §4.18.5 verbatim,
        // no collapse / strip) AND `'` / a backtick (SPEC §4.18.3 —
        // ordinary interior characters, no delimiter role, no transition).
        cooked = cooked + c;
        advance(cursor, 1);
    }

    // The verbatim source between the quotes — escapes UNRESOLVED, every
    // whitespace byte exactly as written (SPEC §4.18.5).
    const raw = cursor.source.substring(segmentStart, cursor.pos);

    // 3. `.InLiteralText` -> `.Outside`: consume the closing `"` (only when
    //    the literal was terminated — an unterminated literal / one that
    //    stopped at an interpolation has no `"` here to consume).
    if (terminated) {
        advance(cursor, 1);
    }

    // The whole-literal span: the opening `"` through the closing `"` (or
    // through EOF / the `${` for an unterminated / interpolation-stopped
    // literal).
    const span = makeSpan(openPos, cursor.pos, openLine, openCol);

    // Unterminated — EOF reached before the closing `"` and the scan did
    // not stop at an interpolation. SPEC §4.18.3 / §4.18.7 — E-CTX-001
    // against the OPENING `"`; the captured text is the literal's content
    // (recovery — the scan already captured it).
    if (!terminated && !stoppedAtInterp) {
        pushDiagnostic(ctx, makeDiagnostic(
            "E-CTX-001",
            "Unterminated display-text literal — no closing quote before " +
            "end of input.",
            makeSpan(openPos, openPos, openLine, openCol),
        ));
    }

    const node = makeDisplayTextLiteralNode(
        [makeLiteralSegment(raw, cooked)], [], span, terminated);
    return { node, stoppedAtInterp };
}

// ---------------------------------------------------------------------------
// FORWARD SEAM — MK3.3 (documented, not implemented here).
//
// MK3.2 lands the `.Outside` / `.InLiteralText` literal scan. MK3.3 fills
// `.InInterpolation`:
//
//   - scanDisplayTextLiteral returns `stoppedAtInterp: true` at an
//     un-escaped `${`. MK3.3 resumes there: open the `.InInterpolation`
//     composite state-child, push a DelegationFrame of kind `.Interpolation`
//     (parse-ctx's delegationKinds), delegate the `${expr}` body to the M2
//     JS expression parser (reusing the M1 template-literal engine shape —
//     punch-list P6), and on the matching `}` return to `.InLiteralText`
//     and continue accumulating segments.
//   - A literal with interpolations produces ONE node — `segments` carries
//     each literal-text run, `exprs` carries each interpolation expression
//     (the §4.18.4 / D3 `{ segments, exprs }` Template-node shape). MK3.2
//     already builds the node with an `exprs` array (empty); MK3.3 fills it.
//   - E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.7) — fires as a parse OUTCOME in
//     a code-default body when a bare run is neither valid code nor a
//     `"..."` literal. This is the code-default body grammar's
//     responsibility (the body-mode-aware dispatch), wired at MK3.3.
// ---------------------------------------------------------------------------
