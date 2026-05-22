// tag-frame.js — JS-host shadow of tag-frame.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors tag-frame.scrml's header.
//
// TagFrame is the markup-layer <tag>-tree engine (charter Q1.F) — the
// open-tag stack of the markup-layer engine graph. Where BlockContext
// answers "which scrml context are we in?", TagFrame answers "which tag
// is open right now, and how deep is the tag tree?".
//
// MK2.1 SCOPE: the engine declaration (3 payload-bearing state-children,
// the bracket-stack `.OpenAt` pattern — see the .scrml); the TagKind
// calculation (a pure fn — NOT an engine, per D1 OQ1); the
// structural-element registry (SPEC §4.15 / §24.4 — the normative SEVEN;
// see the STRUCTURAL-ELEMENT REGISTRY section for the brief-vs-SPEC
// discrepancy note); opener recognition (tokenizeOpener — the one-pass
// `skipOpener` primitive, charter Q2.A #4 — + recognizeOpener which
// computes TagKind + pushes the TagFrame).
//
// MK2.2 SCOPE (this amendment — the closer side of the <tag> tree): the
// 3 closer forms — `</>` inferred / `</name>` explicit / `/>`
// self-closing — recognized STRUCTURALLY (a closed set; no
// `looksLikeCloser` bare-`/` guess); opener/closer PAIRING via the
// TagFrame stack (closeTagFrame pops the matching frame — the
// `.Open* -> .Closed` transition; this eliminates BS heuristic #5
// `scanCompoundBlockEnd`); mismatch recovery (a mismatched `</name>`
// dispatches the M1 ErrorRecovery engine + records the diagnostic). See
// the MK2.2 section after recognizeOpener. The TagKind-driven
// decl-vs-markup classification + punch-list P4/P5 are MK2.3; BodyMode
// (§4.18) is MK3's engine.

import { advance, peekChar, peekStr } from "./cursor.js";
import { makeSpan } from "./span.js";
import { isAsciiLetter } from "./block-context.js";
// MK2.2 — the M1 ErrorRecovery engine. A mismatched `</name>` (or a
// stray closer) dispatches the SAME panic-mode recovery the JS layer
// uses, scoped to block grammar (see dispatchTagMismatchRecovery).
import {
    SyncToken,
    beginRecovery,
    accumulateSkipped,
    markResync,
    resumeNormal,
} from "./error-recovery.js";
// MK3.1 — the §4.18 BodyMode engine + body-mode establishment.
// recognizeOpener computes the body mode of the body each tag opens
// (bodyModeForChildOf — SPEC §4.18.1's three code-bearing loci) and
// stamps it onto the .OpenExpectingChildren frame's `bodyMode` payload
// (MK2.1 created the field as null). body-mode.js imports nothing from
// the native parser, so tag-frame.js -> body-mode.js is acyclic.
import { bodyModeForChildOf } from "./body-mode.js";

// TagKind variant tags — all 4 per the .scrml's type declaration.
// PURE DATA (calculation classification, per D1 OQ1): the four-way
// classification of a markup-tag opener, computed once at
// opener-recognition time and carried by the TagFrame engine.
export const TagKind = Object.freeze({
    Html:            "Html",
    Component:       "Component",
    ScrmlStructural: "ScrmlStructural",
    StateOpener:     "StateOpener",
});

// TagClass variant tags — all 5 per the .scrml's type declaration. PURE
// DATA (calculation classification): MK2.3's TagKind-driven four-way
// (five with Structural) classification of a recognized opener — is it
// MARKUP, a state DECLARATION, a COMPOUND state-decl parent, a
// SELF-CLOSED element, or a scrml-defined STRUCTURAL element? The
// heuristic-elimination TYPE for charter Q2.A #4 (the BS's recursive
// `classifyOpenerForCompoundScan`). ADVISORY per SPEC §4.3 — the
// AUTHORITATIVE markup-vs-state resolution is NR's (Stage 3.05); the
// native parser carries TagClass as a TagFrame payload, the same way it
// carries TagKind. See the .scrml TagClass type for the full rationale.
export const TagClass = Object.freeze({
    Markup:      "Markup",
    Declaration: "Declaration",
    Compound:    "Compound",
    SelfClose:   "SelfClose",
    Structural:  "Structural",
});

// TagFrameKind — the 3 TagFrame variant tags (the engine's
// state-children) surfaced as values. Distinct from the open-tag
// DESCRIPTOR struct below — a closed open-tag frame carries its payload
// as struct fields, mirroring bracket-stack.js's .OpenAt(depth, opener,
// span) → { opener, span } live frame.
export const TagFrameKind = Object.freeze({
    Closed:               "Closed",
    OpenExpectingChildren: "OpenExpectingChildren",
    OpenSelfClosed:       "OpenSelfClosed",
});

// initialTagFrame — calculation. Matches `initial=.Closed` on the
// engine in the .scrml.
export function initialTagFrame() {
    return TagFrameKind.Closed;
}

// ===========================================================================
// STRUCTURAL-ELEMENT REGISTRY (SPEC §4.15 + §24.4).
//
// The closed name-set the TagKind calculation consults to decide
// ScrmlStructural. SPEC §4.15 + §24.4 are the NORMATIVE registry — both
// register exactly these SEVEN scrml-defined structural elements:
//   engine / match / errors / onTransition / onTimeout / onIdle / page.
//
// NOTE — discrepancy surfaced at MK2.1 (REPORTED to PA). The MK2.1 brief's
// registry list named NINE elements — the seven above PLUS `channel` and
// `auth`. SPEC §38 DOES call `<channel>` "a scrml-defined structural
// element" (a SPEC internal inconsistency — §38 vs the §4.15/§24.4
// tables); `<auth>` is a block-grammar gate element (`<auth role=>`) —
// not an HTML element — but is never named "structural element" and is
// absent from the registry tables. Per pa.md Rule 4 (SPEC is normative;
// the §4.15/§24.4 registry tables are THE registry) MK2.1 encodes the
// normative SEVEN. The registry is a closed lookup — if SPEC §4.15/§24.4
// are later amended to add `channel` / `auth`, this is a one-line table
// change + a TagKind regression test, no structural rework.
// ===========================================================================

// STRUCTURAL_ELEMENTS — the closed structural-element name set
// (SPEC §4.15 / §24.4). A frozen membership map: name -> true.
export const STRUCTURAL_ELEMENTS = Object.freeze({
    engine:       true,
    match:        true,
    errors:       true,
    onTransition: true,
    onTimeout:    true,
    onIdle:       true,
    page:         true,
});

// isStructuralElementName — calculation (predicate). Is `name` one of
// the SPEC §4.15 / §24.4 scrml-defined structural elements? A
// closed-name-set lookup — the heuristic-elimination shape (charter
// Q2.A #4 — the block-splitter's recursive classifier is replaced by
// this membership test + the rest of tagKindFor).
export function isStructuralElementName(name) {
    return STRUCTURAL_ELEMENTS[name] === true;
}

// ===========================================================================
// HTML VOID-ELEMENT REGISTRY.
//
// HTML void elements — `<input>`, `<br>`, `<img>`, ... — have NO closer
// and carry no `/>` in normal HTML authoring (`<input type="text">` is a
// complete element). The TagFrame engine must treat a void-element opener
// as a LEAF frame (no children, no closer expected) exactly as a
// `/>`-self-closing opener — otherwise it pushes a frame that never
// closes and the next `</...>` mismatches against the dangling void
// frame (E-MARKUP-002 cascade).
//
// This MIRRORS the live block-splitter's `VOID_ELEMENTS` set
// (block-splitter.js L72) + its self-closing rule (block-splitter.js
// L1747 — `selfClosing || VOID_ELEMENTS.has(lowerTagName)`). The
// block-splitter is the oracle; the membership set is copied 1:1. HTML
// void-element names are case-INSENSITIVE — the lookup lowercases the
// tag name first, matching the live BS's `lowerTagName` lookup.
// ===========================================================================

// VOID_ELEMENTS — the closed HTML void-element name set. A frozen
// membership map: lowercased-name -> true. Copied 1:1 from
// block-splitter.js L72.
export const VOID_ELEMENTS = Object.freeze({
    area:   true,
    base:   true,
    br:     true,
    col:    true,
    embed:  true,
    hr:     true,
    img:    true,
    input:  true,
    link:   true,
    meta:   true,
    source: true,
    track:  true,
    wbr:    true,
});

// isVoidElementName — calculation (predicate). Is `name` an HTML void
// element? Case-insensitive — the name is lowercased before the lookup
// (HTML void-element names are case-insensitive; `<INPUT>` == `<input>`),
// matching the live block-splitter's `VOID_ELEMENTS.has(lowerTagName)`.
export function isVoidElementName(name) {
    if (typeof name !== "string" || name === "") return false;
    return VOID_ELEMENTS[name.toLowerCase()] === true;
}

// ===========================================================================
// THE TagKind CALCULATION (charter Q1.F).
//
// A pure fn of the opener's bytes — per D1 OQ1 (a pure function of input
// bytes is calculation, NOT an engine). Inputs: the opener `name` + the
// `hadSpaceAfterLt` whitespace shape (`< ident` vs `<ident`). §4.3 makes
// the whitespace discriminator ADVISORY (informational only since Phase
// P1); StateOpener is the §4.3-convention state-type signal — the
// authoritative markup-vs-state/decl decision is MK2.3.
//
// The classification (priority order — see the .scrml header for the
// rationale; the registry names are lowercase, so the membership test
// MUST precede the first-char-case test):
//   1. hadSpaceAfterLt  -> StateOpener
//   2. name in registry -> ScrmlStructural
//   3. first char upper -> Component
//   4. otherwise         -> Html
// ===========================================================================

// firstCharIsUpper — calculation (predicate). Is the first character of
// `name` an ASCII uppercase letter (A-Z)? The PascalCase
// component-vs-HTML signal (§4.3 casing convention).
export function firstCharIsUpper(name) {
    if (name === "") return false;
    const c = name.charCodeAt(0);
    return c >= 65 && c <= 90;
}

// tagKindFor — calculation. The TagKind of a markup-tag opener with
// tag-name `name`, given whether whitespace followed the `<`. THE
// heuristic-elimination calculation (charter Q1.F + Q2.A #4) — a closed
// four-way classification from the opener's bytes.
export function tagKindFor(name, hadSpaceAfterLt) {
    // 1. The §4.3 advisory state-type-instantiation shape — a
    //    `< ident`-with-space opener. ADVISORY per §4.3; MK2.3 completes
    //    the authoritative markup-vs-state decision.
    if (hadSpaceAfterLt) return TagKind.StateOpener;
    // 2. A scrml-defined structural element (SPEC §4.15 / §24.4) — these
    //    names are lowercase, so this test MUST precede the
    //    first-char-case test below.
    if (isStructuralElementName(name)) return TagKind.ScrmlStructural;
    // 3. A PascalCase user-component reference (§4.3 casing).
    if (firstCharIsUpper(name)) return TagKind.Component;
    // 4. Otherwise — a lowercase HTML element.
    return TagKind.Html;
}

// ===========================================================================
// OPENER RECOGNITION — the one-pass opener tokenizer (charter Q2.A #4:
// the SPIKE's shared `skipOpener` primitive, done once).
//
// tokenizeOpener scans a markup-tag opener — `<ident ...attrs... >` or
// `<ident ... />` — in a SINGLE forward pass. It does NOT build an
// attribute AST (attribute parsing is later-milestone work); it
// recognizes the opener's STRUCTURE: the tag name, whether whitespace
// followed the `<`, whether the opener is self-closing (a trailing `/`
// before the `>`), and the opener's full extent. The cursor is advanced
// PAST the opener's closing `>`.
//
// MK2.1 is the OPENER side of the <tag> tree. The CHILDREN + the matching
// closer are MK2.2. tokenizeOpener reports `selfClosing` (MK2.1 uses it
// to pick .OpenSelfClosed vs .OpenExpectingChildren) but the
// opener/closer PAIRING is MK2.2.
//
// One-cursor invariant (R1 spike §3.3): tokenizeOpener advances the ONE
// shared cursor; it copies no sub-range; every Span it produces is
// already file-absolute.
// ===========================================================================

// isTagNameStart — calculation (predicate). A character that may START a
// markup-tag name: an ASCII letter. (Reuses block-context's
// isAsciiLetter — MK1.3's isMarkupTagOpener uses the same test for the
// `<ident` boundary; MK2 owns the deeper tag-name grammar.)
export function isTagNameStart(ch) {
    return isAsciiLetter(ch);
}

// isTagNameChar — calculation (predicate). A character that may CONTINUE
// a markup-tag name: an ASCII letter, an ASCII digit, or `-`. (MK1.3's
// parse-markup.js carried a local isTagNameChar for boundary-only
// consumption; MK2.1 is the home of the full tag-name grammar — this is
// the canonical one. The values match 1:1 so the MK1.3 local can defer
// to it without behavior change.)
export function isTagNameChar(ch) {
    if (ch === "") return false;
    if (ch === "-") return true;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;   // 0-9
    if (c >= 65 && c <= 90) return true;   // A-Z
    if (c >= 97 && c <= 122) return true;  // a-z
    return false;
}

// isOpenerWhitespace — calculation (predicate). Inter-token whitespace
// inside an opener — space, tab, CR, LF.
export function isOpenerWhitespace(ch) {
    if (ch === " ") return true;
    if (ch === String.fromCharCode(9)) return true;   // tab
    if (ch === String.fromCharCode(10)) return true;  // LF
    if (ch === String.fromCharCode(13)) return true;  // CR
    return false;
}

// scanTagName — calculation. Returns the END offset one past the last
// tag-name character, scanning a maximal `isTagNameChar` run from
// `start`. The caller has verified the char at `start` is a tag-name
// start (an ASCII letter).
export function scanTagName(source, start) {
    const len = source.length;
    let p = start;
    while (p < len) {
        if (!isTagNameChar(source.charAt(p))) return p;
        p = p + 1;
    }
    return p;
}

// skipOpenerWhitespace — calculation. Returns the END offset one past a
// maximal whitespace run from `start`.
export function skipOpenerWhitespace(source, start) {
    const len = source.length;
    let p = start;
    while (p < len) {
        if (!isOpenerWhitespace(source.charAt(p))) return p;
        p = p + 1;
    }
    return p;
}

// closeAngle — calculation. The one-character opener terminator `>`.
export function closeAngle() {
    return ">";
}

// slash — calculation. The one-character `/` — the self-closing marker
// (a trailing `/` before the `>`).
export function slash() {
    return String.fromCharCode(47);
}

// tokenizeOpener — calculation at its own locus (a pure fn over the
// shared cursor: it walks the cursor forward past the opener BODY and
// returns a descriptor; it writes no engine state). Scans the BODY of a
// markup-tag opener — `<ident ...>` / `<ident ... />` MINUS the leading
// `<` — in ONE pass.
//
// PARAMETERS:
//   cursor   — positioned at the byte AFTER the `<` (the `<` was
//              consumed by block-context.js's enterMarkupTagContext —
//              its MK1.2 contract).
//   ltAnchor — the `<`'s span: a record carrying { start, line, col }
//              (the .InMarkupTag BlockContext frame's openSpan IS this
//              record). The returned opener span anchors here so it
//              covers the `<`.
//
// The pass:
//   1. Skip any whitespace after the `<` — record hadSpaceAfterLt (the
//      §4.3 advisory state-type signal).
//   2. Scan the tag-name run. An opener with no name start after the `<`
//      is malformed — recorded as `ok: false`.
//   3. Scan the attribute REGION as opaque bytes up to the opener
//      terminator (string-aware — a `>` / `/` inside an attribute-value
//      string is not the terminator). No attribute AST is built.
//   4. Recognize the terminator: `>` closes; a `/` immediately before it
//      marks the opener self-closing.
//   5. Advance the cursor past the `>`.
//
// Returns { ok, name, hadSpaceAfterLt, selfClosing, voidElement, span,
// malformed }.
export function tokenizeOpener(cursor, ltAnchor) {
    const source = cursor.source;
    const len = source.length;

    // 1. Whitespace after the `<` — the §4.3 advisory signal.
    const beforeWs = cursor.pos;
    const afterWs = skipOpenerWhitespace(source, beforeWs);
    const hadSpaceAfterLt = afterWs > beforeWs;
    advance(cursor, afterWs - beforeWs);

    // 2. The tag-name run.
    const nameStart = cursor.pos;
    let name = "";
    let malformed = false;
    if (nameStart < len && isTagNameStart(source.charAt(nameStart))) {
        const nameEnd = scanTagName(source, nameStart);
        name = source.substring(nameStart, nameEnd);
        advance(cursor, nameEnd - nameStart);
    } else {
        // No name start after the `<` — a malformed opener. Record the
        // flag; MK2.2's ErrorRecovery decides the recovery.
        malformed = true;
    }

    // 3 + 4. Scan the attribute region (opaque bytes, string-aware AND
    // bracket-depth-aware) up to the opener terminator `>`; recognize a
    // trailing `/`.
    //
    // F1 (v0.6) — `attrRegionStart` is the byte one past the tag name
    // (the opaque scan below finds the terminator; the structured
    // attribute tokenizer then re-walks [attrRegionStart, terminator)
    // ONCE — there is no double-tokenize of the whole opener: the opaque
    // scan finds where the opener ends, the structured pass tokenizes
    // the now-known attribute region).
    //
    // The scan is bracket-depth-aware because an attribute VALUE may be
    // an expression carrying `>` / `/` at depth > 0 — `if=(@n > 0)`,
    // `onclick=${() => fn()}`, `pick=[a/b]`. A `>` is the opener
    // terminator ONLY at bracket-depth 0 outside a string; likewise the
    // self-close `/` marker is only recognized at depth 0. (The live
    // `tokenizer.ts:tokenizeAttributes` never hits this because it reads
    // each value with its own depth tracking; the native opener's
    // up-front opaque scan must replicate that depth-awareness.)
    const attrRegionStart = cursor.pos;
    let selfClosing = false;
    let terminated = false;
    let p = cursor.pos;
    // inString — null when outside a string; the quote char when inside
    // an attribute-value string (so a `>` / `/` inside the string does
    // not terminate the opener). `bracketDepth` counts open `(` / `[` /
    // `{` minus their closers.
    let inString = null;
    let bracketDepth = 0;
    while (p < len) {
        const ch = source.charAt(p);
        if (inString === null) {
            if (ch === "\"" || ch === "'") {
                inString = ch;
                p = p + 1;
            } else if (ch === "(" || ch === "[" || ch === "{") {
                bracketDepth = bracketDepth + 1;
                p = p + 1;
            } else if (ch === ")" || ch === "]" || ch === "}") {
                if (bracketDepth > 0) bracketDepth = bracketDepth - 1;
                p = p + 1;
            } else if (ch === closeAngle() && bracketDepth === 0) {
                // The opener terminator. A `/` immediately before it
                // marks the opener self-closing.
                terminated = true;
                p = p + 1;
                break;
            } else {
                p = p + 1;
            }
        } else {
            // Inside an attribute-value string — only the matching quote
            // closes it. (MK2.1 does not interpret string escapes; an
            // attribute-value string is opaque here.)
            if (ch === inString) {
                inString = null;
            }
            p = p + 1;
        }
    }

    // A trailing `/` before the `>` marks the opener self-closing. p
    // points one PAST the `>`; the `/`, if any, is at p-2.
    if (terminated && p >= 2) {
        if (source.charAt(p - 2) === slash()) {
            selfClosing = true;
        }
    }

    // Advance the cursor past the opener terminator. If the opener was
    // never terminated (EOF before `>`) the cursor advances to EOF and
    // `malformed` is set — MK2.2 owns the recovery.
    advance(cursor, p - cursor.pos);
    if (!terminated) {
        malformed = true;
    }

    // The opener span — anchored at the `<` (ltAnchor), ending one past
    // the opener terminator. File-absolute; no offset arithmetic.
    const span = makeSpan(ltAnchor.start, p, ltAnchor.line, ltAnchor.col);

    // F1 (v0.6) — the structured attribute pass. The attribute region is
    // [attrRegionStart, attrRegionEnd): from one past the tag name up to
    // (but not including) the terminator. For a self-closing `<x .../>`
    // the trailing `/` at p-2 is the self-close marker, NOT an
    // attribute — the region ends before it. For a terminated opener
    // the `>` is at p-1; for an unterminated opener the region runs to
    // EOF (`len`).
    let attrRegionEnd = len;
    if (terminated) {
        attrRegionEnd = selfClosing ? (p - 2) : (p - 1);
    }
    if (attrRegionEnd < attrRegionStart) {
        attrRegionEnd = attrRegionStart;
    }
    // `hadSpaceAfterLt` is the §4.3 advisory state-opener signal — a
    // state block (`< Counter ...>`) admits `name(type)` typed-attribute
    // declarations (SPEC §35.2); a markup tag does not.
    const attrPass = tokenizeAttributeRegion(
        source, attrRegionStart, attrRegionEnd,
        ltAnchor.line, ltAnchor.col, hadSpaceAfterLt,
    );

    // An HTML void element written WITHOUT a literal `/>` (`<input>`,
    // `<br>`, ...) closes as a LEAF — it opens no body and expects no
    // closer, exactly as a `/>`-self-closing opener does. `voidElement`
    // is the tokenizer FACT (the name is an HTML void element);
    // `selfClosing` stays the literal-`/>` fact. recognizeOpener treats
    // `selfClosing || voidElement` as the leaf-frame condition — mirrors
    // block-splitter.js L1747 `selfClosing || VOID_ELEMENTS.has(...)`.
    const voidElement = isVoidElementName(name);

    return {
        ok: !malformed,
        name,
        hadSpaceAfterLt,
        selfClosing,
        voidElement,
        span,
        malformed,
        // F1 — the attribute payload. `attrs` is the AttrNode[] AST (the
        // live FileAST's `MarkupNode.attrs` shape); `tokenizedAttrs` is
        // the raw ATTR_* token stream (parity with the live
        // `tokenizeAttributes` output, minus the TAG_OPEN / TAG_CLOSE_GT
        // / TAG_SELF_CLOSE structural tokens — those are the opener's
        // own descriptor fields here).
        attrs: attrPass.attrs,
        tokenizedAttrs: attrPass.tokens,
    };
}

// ===========================================================================
// F1 (v0.6) — THE NATIVE ATTRIBUTE TOKENIZER (DD #27 / Cluster A).
//
// `tokenizeAttributeRegion` walks the attribute region of a tag opener —
// the bytes between the tag name and the terminating `>` / `/>` — and
// produces BOTH:
//
//   1. `tokens`  — the raw ATTR_* token stream (ATTR_NAME, ATTR_EQ,
//                  ATTR_STRING, ATTR_IDENT, ATTR_CALL, ATTR_BLOCK,
//                  ATTR_EXPR, ATTR_TYPED_DECL). This is the parity datum:
//                  it mirrors the live `tokenizer.ts:tokenizeAttributes`
//                  output 1:1 (minus the structural TAG_* tokens, which
//                  the native opener descriptor carries directly).
//   2. `attrs`   — the AttrNode[] AST: `{ name, value, span }` records
//                  where `value` is the live 6-variant `AttrValue` union
//                  (string-literal / variable-ref / call-ref / expr /
//                  props-block / absent — `compiler/src/types/ast.ts`).
//
// This is the DD #27 compression: the live pipeline runs `tokenizeAttributes`
// THEN `parseAttributes` (two passes — tokenizer.ts + ast-builder.js). The
// native parser folds both into ONE region walk — token emit + AttrNode
// build happen together. No native↔live translation layer; the produced
// `attrs[]` IS the language's shape.
//
// Span discipline — every token / value span is FILE-ABSOLUTE (the region
// is a slice of the one source buffer; positions are buffer offsets, not
// region-relative). `line` / `col` are coarse-grained at the opener
// granularity: the live tokenizer threads exact line/col per token; the
// native attribute tokenizer carries the opener's `line`/`col` on every
// token (an attribute region is overwhelmingly single-line, and the
// downstream consumers key on `start`/`end` offsets). A precise per-token
// line/col walk is a later refinement if a consumer needs it.
//
// PARAMETERS:
//   source        — the full source buffer.
//   start / end   — [start, end) the attribute region (file-absolute).
//   line / col    — the opener's line/col (carried onto every token).
//   isStateOpener — true for a `< Ident ...>` state opener (§4.3
//                   advisory) — admits `name(type)` typed-attr decls.
//
// Returns { tokens, attrs }.
// ===========================================================================

// isAttrWhitespace — calculation (predicate). Inter-attribute whitespace.
function isAttrWhitespace(ch) {
    return ch === " " || ch === "\t" || ch === "\r" || ch === "\n"
        || ch === "\f";
}

// isAttrUnquotedValueStart — calculation (predicate). A char that may
// begin an unquoted attribute VALUE — ASCII letter, ASCII digit, `_`, or
// `@`. Mirrors the live `tokenizer.ts` unquoted-value gate
// (`/[A-Za-z0-9_@]/`). NOTE — `.` and `-` are value CONTINUATION chars
// only (not value starts), and a single-quote is NOT recognized at all
// (live admits only double-quoted string values).
function isAttrUnquotedValueStart(ch) {
    if (ch === "_" || ch === "@") return true;
    if (ch === "") return false;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;
    return isAsciiLetter(ch);
}

// isAttrNameStart — calculation (predicate). A char that may begin an
// attribute name: ASCII letter, `_`, or `@` (a reactive-ref attribute
// name shape — mirrors the live `[A-Za-z_@]` name-start test).
function isAttrNameStart(ch) {
    if (ch === "_" || ch === "@") return true;
    return isAsciiLetter(ch);
}

// isAttrNameChar — calculation (predicate). A char that may continue an
// attribute name — mirrors the live `[A-Za-z0-9_\-:@]` run.
function isAttrNameChar(ch) {
    if (ch === "") return false;
    if (ch === "_" || ch === "-" || ch === ":" || ch === "@") return true;
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return true;
    return isAsciiLetter(ch);
}

// isEventHandlerAttrName — calculation (predicate). Mirrors the live
// `tokenizer.ts:isEventHandlerAttrName` — recognizes the event-handler
// attribute-name shapes (SPEC §5.2.x / §38.6.1): `on<word>`, `on:<word>`,
// `onserver:<word>`, `onclient:<word>`.
export function isEventHandlerAttrName(name) {
    if (typeof name !== "string" || name.length === 0) return false;
    const lower = name.toLowerCase();
    if (lower.startsWith("onserver:")) return true;
    if (lower.startsWith("onclient:")) return true;
    if (lower.startsWith("on:")) return true;
    // `on<word>` — `on` followed by one or more ASCII letters, nothing else.
    if (lower.length > 2 && lower.charAt(0) === "o"
        && lower.charAt(1) === "n") {
        let i = 2;
        while (i < lower.length) {
            const c = lower.charCodeAt(i);
            if (c < 97 || c > 122) return false;
            i = i + 1;
        }
        return true;
    }
    return false;
}

// makeAttrToken — calculation (pure data builder). The ATTR_* token shape
// matches the live `tokenizer.ts:makeToken` output: `{ kind, text, span }`
// where `span` is `{ start, end, line, col }`.
function makeAttrToken(kind, text, start, end, line, col) {
    return { kind, text, span: makeSpan(start, end, line, col) };
}

// collectRefs — calculation. Extracts the distinct `@ident` reactive
// references from an expression's raw text, in first-seen order. Mirrors
// the live `parseAttributes` ATTR_EXPR / ATTR_BLOCK ref-extraction loop
// (`/@([A-Za-z_$][A-Za-z0-9_$]*)/g`).
export function collectRefs(raw) {
    const refs = [];
    let i = 0;
    const len = raw.length;
    while (i < len) {
        if (raw.charAt(i) === "@") {
            const c = i + 1 < len ? raw.charAt(i + 1) : "";
            const isStart = c === "_" || c === "$" || isAsciiLetter(c);
            if (isStart) {
                let j = i + 1;
                while (j < len) {
                    const cc = raw.charAt(j);
                    const code = cc.charCodeAt(0);
                    const isPart = cc === "_" || cc === "$"
                        || isAsciiLetter(cc) || (code >= 48 && code <= 57);
                    if (!isPart) break;
                    j = j + 1;
                }
                const name = raw.substring(i + 1, j);
                let seen = false;
                let k = 0;
                while (k < refs.length) {
                    if (refs[k] === name) { seen = true; break; }
                    k = k + 1;
                }
                if (!seen) refs.push(name);
                i = j;
                continue;
            }
        }
        i = i + 1;
    }
    return refs;
}

// splitCallArgs — calculation. Split a call-argument string on top-level
// commas, depth-aware over `()` / `[]` / `{}`. Mirrors the live
// `ast-builder.js:splitArgs`. Each part is trimmed; an all-whitespace
// arg-string yields the empty list.
export function splitCallArgs(raw) {
    const parts = [];
    let depth = 0;
    let cur = "";
    let i = 0;
    while (i < raw.length) {
        const ch = raw.charAt(i);
        if (ch === "(" || ch === "[" || ch === "{") {
            depth = depth + 1;
            cur = cur + ch;
        } else if (ch === ")" || ch === "]" || ch === "}") {
            depth = depth - 1;
            cur = cur + ch;
        } else if (ch === "," && depth === 0) {
            parts.push(cur.trim());
            cur = "";
        } else {
            cur = cur + ch;
        }
        i = i + 1;
    }
    if (cur.trim().length > 0) parts.push(cur.trim());
    return parts;
}

// tokenizeAttributeRegion — the F1 attribute tokenizer. See the section
// header above for the full contract. The walk is a single forward pass
// over [start, end); it mirrors the live `tokenizeAttributes` value-form
// recognition order (quoted string / brace-block / `!`-negation / `(`-
// paren / `[`-array / `${...}`-inline / unquoted ident-or-call / bare
// event-handler expression-continuation), so the `tokens` output is
// 1:1 with the live token stream and `attrs` is 1:1 with `parseAttributes`.
export function tokenizeAttributeRegion(source, start, end, line, col, isStateOpener) {
    const tokens = [];
    const attrs = [];
    let p = start;

    // skipWs — advance `p` past inter-attribute whitespace.
    function skipWs() {
        while (p < end && isAttrWhitespace(source.charAt(p))) {
            p = p + 1;
        }
    }

    while (p < end) {
        skipWs();
        if (p >= end) break;

        const c = source.charAt(p);

        // An attribute name (or a state-block `name(type)` typed decl).
        if (isAttrNameStart(c)) {
            const nameStart = p;
            while (p < end && isAttrNameChar(source.charAt(p))) {
                p = p + 1;
            }
            const name = source.substring(nameStart, p);

            // §35.2 — in a state opener, `name(type)` (no `=`) is a typed
            // attribute declaration, not a call. Detect before emitting
            // ATTR_NAME.
            if (isStateOpener && p < end && source.charAt(p) === "(") {
                p = p + 1; // consume `(`
                let typeExpr = "";
                let depth = 1;
                while (p < end && depth > 0) {
                    const tc = source.charAt(p);
                    if (tc === "(") {
                        depth = depth + 1;
                    } else if (tc === ")") {
                        depth = depth - 1;
                        if (depth === 0) { p = p + 1; break; }
                    }
                    typeExpr = typeExpr + tc;
                    p = p + 1;
                }
                tokens.push(makeAttrToken(
                    "ATTR_TYPED_DECL",
                    JSON.stringify({ name, typeExpr }),
                    nameStart, p, line, col,
                ));
                continue;
            }

            const nameEnd = p;
            tokens.push(makeAttrToken("ATTR_NAME", name,
                nameStart, nameEnd, line, col));
            skipWs();

            // No `=` — a boolean attribute (value `absent`).
            if (p >= end || source.charAt(p) !== "=") {
                attrs.push({
                    name,
                    value: { kind: "absent" },
                    span: makeSpan(nameStart, nameEnd, line, col),
                });
                continue;
            }

            // The `=` assignment.
            const eqStart = p;
            p = p + 1;
            tokens.push(makeAttrToken("ATTR_EQ", "=",
                eqStart, p, line, col));
            skipWs();

            if (p >= end) {
                // `name=` with nothing after — an `absent` value.
                attrs.push({
                    name,
                    value: { kind: "absent" },
                    span: makeSpan(nameStart, p, line, col),
                });
                continue;
            }

            const vc = source.charAt(p);
            const valStart = p;
            let valTok = null;
            let value = null;

            if (vc === "\"") {
                // Quoted string value. For `if=` the quoted text is a
                // boolean expression (live parity — ATTR_EXPR), otherwise
                // a plain string literal (ATTR_STRING).
                p = p + 1; // opening `"`
                let str = "";
                while (p < end && source.charAt(p) !== "\"") {
                    if (source.charAt(p) === "\\" && p + 1 < end) {
                        str = str + source.charAt(p) + source.charAt(p + 1);
                        p = p + 2;
                    } else {
                        str = str + source.charAt(p);
                        p = p + 1;
                    }
                }
                if (p < end && source.charAt(p) === "\"") p = p + 1;
                if (name === "if") {
                    valTok = makeAttrToken("ATTR_EXPR", str,
                        valStart, p, line, col);
                    value = {
                        kind: "expr", raw: str, refs: collectRefs(str),
                        span: makeSpan(valStart, p, line, col),
                    };
                } else {
                    valTok = makeAttrToken("ATTR_STRING", str,
                        valStart, p, line, col);
                    value = {
                        kind: "string-literal", value: str,
                        span: makeSpan(valStart, p, line, col),
                    };
                }
            } else if (vc === "{") {
                // Brace-block value: `props={...}` is a typed props
                // declaration (§15.10 — props-block); any other name's
                // `{...}` is an expression (§14.9 — expr).
                p = p + 1; // opening `{`
                let block = "";
                let depth = 1;
                while (p < end && depth > 0) {
                    const bc = source.charAt(p);
                    if (bc === "{") {
                        depth = depth + 1;
                    } else if (bc === "}") {
                        depth = depth - 1;
                        if (depth === 0) { p = p + 1; break; }
                    }
                    block = block + bc;
                    p = p + 1;
                }
                valTok = makeAttrToken("ATTR_BLOCK", block,
                    valStart, p, line, col);
                if (name === "props") {
                    value = {
                        kind: "props-block", propsDecl: block,
                        span: makeSpan(valStart, p, line, col),
                    };
                } else {
                    value = {
                        kind: "expr", raw: block, refs: collectRefs(block),
                        span: makeSpan(valStart, p, line, col),
                    };
                }
            } else if (vc === "!") {
                // Unquoted negation expression: `!@var`, `!!@var`,
                // `!obj.prop`. Read to whitespace / tag-close boundary.
                let expr = "";
                while (p < end) {
                    const ec = source.charAt(p);
                    if (isAttrWhitespace(ec) || ec === ">" || ec === "/") {
                        break;
                    }
                    expr = expr + ec;
                    p = p + 1;
                }
                valTok = makeAttrToken("ATTR_EXPR", expr,
                    valStart, p, line, col);
                value = {
                    kind: "expr", raw: expr, refs: collectRefs(expr),
                    span: makeSpan(valStart, p, line, col),
                };
            } else if (vc === "(") {
                // Parenthesized expression: `if=(@a && @b)`. Read the
                // matched outer parens, preserving them.
                let expr = "(";
                p = p + 1;
                let depth = 1;
                while (p < end && depth > 0) {
                    const ec = source.charAt(p);
                    if (ec === "(") {
                        depth = depth + 1;
                    } else if (ec === ")") {
                        depth = depth - 1;
                        if (depth === 0) {
                            expr = expr + ec;
                            p = p + 1;
                            break;
                        }
                    }
                    expr = expr + ec;
                    p = p + 1;
                }
                valTok = makeAttrToken("ATTR_EXPR", expr,
                    valStart, p, line, col);
                value = {
                    kind: "expr", raw: expr, refs: collectRefs(expr),
                    span: makeSpan(valStart, p, line, col),
                };
            } else if (vc === "[") {
                // §41.14 — array-literal value: `pick=["a","b"]`. Read the
                // matched outer brackets, string-aware.
                let expr = "[";
                p = p + 1;
                let depth = 1;
                let inSQ = false;
                let inDQ = false;
                while (p < end && depth > 0) {
                    const ec = source.charAt(p);
                    if (inSQ) {
                        if (ec === "'" && source.charAt(p - 1) !== "\\") {
                            inSQ = false;
                        }
                    } else if (inDQ) {
                        if (ec === "\"" && source.charAt(p - 1) !== "\\") {
                            inDQ = false;
                        }
                    } else if (ec === "'") {
                        inSQ = true;
                    } else if (ec === "\"") {
                        inDQ = true;
                    } else if (ec === "[") {
                        depth = depth + 1;
                    } else if (ec === "]") {
                        depth = depth - 1;
                        if (depth === 0) {
                            expr = expr + ec;
                            p = p + 1;
                            break;
                        }
                    }
                    expr = expr + ec;
                    p = p + 1;
                }
                valTok = makeAttrToken("ATTR_EXPR", expr,
                    valStart, p, line, col);
                value = {
                    kind: "expr", raw: expr, refs: collectRefs(expr),
                    span: makeSpan(valStart, p, line, col),
                };
            } else if (vc === "$" && p + 1 < end
                       && source.charAt(p + 1) === "{") {
                // Inline expression: `${() => fn()}`, `${a ? b : c}`.
                p = p + 2; // consume `${`
                let expr = "";
                let depth = 1;
                while (p < end && depth > 0) {
                    const ec = source.charAt(p);
                    if (ec === "{") {
                        depth = depth + 1;
                    } else if (ec === "}") {
                        depth = depth - 1;
                        if (depth === 0) { p = p + 1; break; }
                    }
                    expr = expr + ec;
                    p = p + 1;
                }
                valTok = makeAttrToken("ATTR_EXPR", expr,
                    valStart, p, line, col);
                value = {
                    kind: "expr", raw: expr, refs: collectRefs(expr),
                    span: makeSpan(valStart, p, line, col),
                };
            } else if (isAttrUnquotedValueStart(vc)) {
                // Unquoted ident-or-call. The ident run excludes `-` for
                // event-handler attributes (so postfix `--` terminates the
                // ident — live parity); otherwise `-` is admitted (e.g.
                // `class=foo-bar`).
                const evHandler = isEventHandlerAttrName(name);
                let ident = "";
                while (p < end) {
                    const ec = source.charAt(p);
                    const code = ec.charCodeAt(0);
                    const digit = code >= 48 && code <= 57;
                    const word = ec === "_" || ec === "." || ec === "@"
                        || isAsciiLetter(ec) || digit;
                    const hyphen = ec === "-";
                    const ok = evHandler ? word : (word || hyphen);
                    if (!ok) break;
                    ident = ident + ec;
                    p = p + 1;
                }

                if (p < end && source.charAt(p) === "(") {
                    // Call form: collect to the matching `)`.
                    p = p + 1;
                    let args = "";
                    let depth = 1;
                    while (p < end && depth > 0) {
                        const ec = source.charAt(p);
                        if (ec === "(") {
                            depth = depth + 1;
                        } else if (ec === ")") {
                            depth = depth - 1;
                            if (depth === 0) { p = p + 1; break; }
                        }
                        args = args + ec;
                        p = p + 1;
                    }
                    valTok = makeAttrToken("ATTR_CALL",
                        JSON.stringify({ name: ident, args }),
                        valStart, p, line, col);
                    const argList = splitCallArgs(args);
                    value = {
                        kind: "call-ref", name: ident, args: argList,
                        span: makeSpan(valStart, p, line, col),
                    };
                } else if (evHandler
                           && attrBareExprContinuation(source, p, end)) {
                    // SPEC §5.2.3 bare-form event handler — `onclick=@x = .A`
                    // / `onclick=@count++`. Continue reading in
                    // expression mode to the next attribute / tag-close
                    // boundary. Live parity: tokenizer.ts ATTR_EXPR.
                    let expr = ident;
                    while (p < end && (source.charAt(p) === " "
                           || source.charAt(p) === "\t")) {
                        expr = expr + source.charAt(p);
                        p = p + 1;
                    }
                    const opC = p < end ? source.charAt(p) : "";
                    const opN = p + 1 < end ? source.charAt(p + 1) : "";
                    if ((opC === "+" || opC === "-") && opN === opC) {
                        // Postfix update — two chars, done.
                        expr = expr + opC + opN;
                        p = p + 2;
                    } else {
                        // Assignment / compound assignment — read the RHS
                        // to the attribute / tag-close boundary, depth +
                        // string aware.
                        let parenD = 0;
                        let braceD = 0;
                        let bracketD = 0;
                        let strCh = "";
                        let consumedEq = false;
                        let consumedRhs = false;
                        while (p < end) {
                            const ec = source.charAt(p);
                            if (strCh !== "") {
                                if (ec === "\\" && p + 1 < end) {
                                    expr = expr + ec + source.charAt(p + 1);
                                    p = p + 2;
                                    continue;
                                }
                                if (ec === strCh) strCh = "";
                                expr = expr + ec;
                                p = p + 1;
                                continue;
                            }
                            const atZero = parenD === 0 && braceD === 0
                                && bracketD === 0;
                            if (atZero) {
                                if (ec === ">" || ec === "/") break;
                                if (consumedEq && consumedRhs
                                    && isAttrWhitespace(ec)) {
                                    break;
                                }
                            }
                            if (ec === "\"" || ec === "'" || ec === "`") {
                                strCh = ec;
                                expr = expr + ec;
                                p = p + 1;
                                continue;
                            }
                            if (ec === "(") { parenD = parenD + 1; }
                            else if (ec === ")") { parenD = parenD - 1; }
                            else if (ec === "[") { bracketD = bracketD + 1; }
                            else if (ec === "]") { bracketD = bracketD - 1; }
                            else if (ec === "{") { braceD = braceD + 1; }
                            else if (ec === "}") { braceD = braceD - 1; }
                            if (atZero) {
                                if (!consumedEq && ec === "=") {
                                    consumedEq = true;
                                    expr = expr + ec;
                                    p = p + 1;
                                    continue;
                                }
                                if (consumedEq && !isAttrWhitespace(ec)) {
                                    consumedRhs = true;
                                }
                            }
                            expr = expr + ec;
                            p = p + 1;
                        }
                    }
                    const trimmed = expr.replace(/\s+$/, "");
                    valTok = makeAttrToken("ATTR_EXPR", trimmed,
                        valStart, p, line, col);
                    value = {
                        kind: "expr", raw: trimmed, refs: collectRefs(trimmed),
                        span: makeSpan(valStart, p, line, col),
                    };
                } else {
                    // A bare identifier value — a variable reference.
                    valTok = makeAttrToken("ATTR_IDENT", ident,
                        valStart, p, line, col);
                    value = {
                        kind: "variable-ref", name: ident,
                        span: makeSpan(valStart, p, line, col),
                    };
                }
            } else {
                // An unrecognized value-start char (e.g. a single-quote —
                // the live `tokenizeAttributes` recognizes ONLY
                // double-quoted string values). Live parity: emit NO
                // value token and do NOT advance `p` — the `=` was
                // consumed, the attribute's value is `absent`, and the
                // outer loop's unexpected-char skip handles the stray
                // char. The `value === null` fallback below stamps the
                // `absent` value.
                valTok = null;
            }

            if (valTok !== null) tokens.push(valTok);
            if (value === null) {
                value = { kind: "absent" };
            }
            attrs.push({
                name,
                value,
                span: makeSpan(nameStart, p, line, col),
            });
            continue;
        }

        // A sigil-prefixed standalone brace block — `${...}`, `^{...}`,
        // `?{...}`, `#{...}`, `!{...}`, `~{...}` — in attribute position.
        // Consumed as an opaque unit (live parity: tokenizer.ts skips it,
        // emitting no ATTR_* token — it leaks no server-context code).
        if ((c === "$" || c === "^" || c === "?" || c === "#"
             || c === "!" || c === "~")
            && p + 1 < end && source.charAt(p + 1) === "{") {
            p = p + 2;
            let depth = 1;
            while (p < end && depth > 0) {
                const bc = source.charAt(p);
                if (bc === "{") {
                    depth = depth + 1;
                } else if (bc === "}") {
                    depth = depth - 1;
                    if (depth === 0) { p = p + 1; break; }
                }
                p = p + 1;
            }
            continue;
        }

        // An unexpected char — skip it (live parity: the tokenizer
        // advances past it without emitting a token).
        p = p + 1;
    }

    return { tokens, attrs };
}

// attrBareExprContinuation — calculation (predicate). Mirrors the live
// `tokenizer.ts:isBareExprContinuation` — detects whether the chars at
// `p` (within [.., end)) look like a bare-form event-handler
// expression-continuation: assignment (`=`, not `==` / `=>`), compound
// assignment (`+=` / `??=` / `>>>=` / ...), or postfix update (`++` /
// `--`). Skips leading inline whitespace (` ` / `\t`).
export function attrBareExprContinuation(source, p, end) {
    let i = p;
    while (i < end && (source.charAt(i) === " "
           || source.charAt(i) === "\t")) {
        i = i + 1;
    }
    if (i >= end) return false;
    const c = source.charAt(i);
    const n = i + 1 < end ? source.charAt(i + 1) : "";

    // `=` assignment — reject `==` (comparison) and `=>` (arrow).
    if (c === "=" && n !== "=" && n !== ">") return true;
    // `++` / `--` postfix update.
    if ((c === "+" || c === "-") && n === c) return true;
    // Compound assignment `op=` — scan up to 4 chars for the longest match.
    let len = 2;
    while (len <= 4 && i + len <= end) {
        const slice = source.substring(i, i + len);
        const after = i + len < end ? source.charAt(i + len) : "";
        const endsEq = slice.charAt(slice.length - 1) === "=";
        if (endsEq && after !== "=" && after !== ">") {
            const op = slice.substring(0, slice.length - 1);
            if (op === "+" || op === "-" || op === "*" || op === "/"
                || op === "%" || op === "&" || op === "|" || op === "^"
                || op === "**" || op === "<<" || op === ">>" || op === ">>>"
                || op === "&&" || op === "||" || op === "??") {
                return true;
            }
        }
        len = len + 1;
    }
    return false;
}

// ===========================================================================
// THE TagFrame STACK — the live open-tag stack (the JS-host mirror of
// the @tagFrame engine).
//
// The CURRENT TagFrame variant is the top of ctx.tagFrameStack
// (`.Closed` when the stack is empty). Each push IS a `.Closed ->
// .Open*` (or nested `.OpenExpectingChildren -> .OpenExpectingChildren`)
// transition; each pop IS a `.Open* -> .Closed` transition. This is the
// bracket-stack.js pattern exactly — the canonical
// payload-bearing-state-child engine mirror.
//
// MK2.1 lands the PUSH side (recognizeOpener). The POP side (a closer
// popping its matching opener — MK2.2) consumes this same stack.
// ===========================================================================

// ensureTagFrameStack — STATE write (lazy init). Mirrors
// block-context.js's ensureBlockContextStack — a parse context built
// before MK2.1 (an MK1-vintage ctx) has no tagFrameStack slot; this
// keeps the helpers total.
export function ensureTagFrameStack(ctx) {
    if (ctx.tagFrameStack === undefined || ctx.tagFrameStack === null) {
        ctx.tagFrameStack = [];
    }
}

// tagFrameDepth — calculation (read). The tag-tree depth — how many tags
// are open. The raw stack-depth read; MK2.1 added it. Punch-list P5's
// queryable stack-depth datum (see tagFrameBalancedAt below for the
// CloseCondition-shaped accessor MK2.3 adds).
export function tagFrameDepth(ctx) {
    ensureTagFrameStack(ctx);
    return ctx.tagFrameStack.length;
}

// ===========================================================================
// PUNCH-LIST P5 (R1 seam spike §3.2 / §6 P5) — the TagFrame stack exposes
// its depth as a queryable value for the
// `CloseCondition.TagFrameBalanced(tagDepthAtOpen)` close datum.
//
// The JS->markup delegation direction (R1 spike §1.2 — a `<tag>...</>` as
// an expression operand) pushes a DelegationFrame whose `closeOn` is
// `CloseCondition.TagFrameBalanced(tagDepthAtOpen)`: the markup element +
// all its children are consumed exactly when the TagFrame stack RETURNS to
// the depth it had at the open. `tagFrameDepth` (above) is the raw depth
// read; `tagFrameBalancedAt` is the CloseCondition-shaped PREDICATE —
// "has the TagFrame stack returned to `tagDepthAtOpen`?". This mirrors how
// M1's BracketStack exposes `depth(ctx.brackets)` and how block-context.js's
// isBlockContextClose tests the brace-depth datum.
//
// FORWARD SEAM — the CONSUMER of this predicate is the MK4 markup<->JS seam
// (it drives the JS->markup delegation handback — R1 spike §1.2 HANDBACK
// step 2 + the `closeConditionKinds().TagFrameBalanced` close-condition in
// parse-ctx.js). MK2.3 lands the accessor; MK4 wires it into the delegation
// loop. It is a pure read — no engine write, no cursor advance.
// ===========================================================================

// tagFrameBalancedAt — calculation (predicate / read). Has the TagFrame
// stack returned to `tagDepthAtOpen`? True exactly when the current
// tag-tree depth EQUALS the depth recorded when a JS->markup `ElementValue`
// delegation opened — i.e. the markup element and all its children have
// been fully consumed and the delegation must hand back. The
// CloseCondition.TagFrameBalanced(tagDepthAtOpen) datum's predicate; the
// MK4 seam consumes it.
export function tagFrameBalancedAt(ctx, tagDepthAtOpen) {
    ensureTagFrameStack(ctx);
    return ctx.tagFrameStack.length === tagDepthAtOpen;
}

// currentTagFrame — calculation (peek). The CURRENT @tagFrame variant
// tag — the kind of the top frame, or `.Closed` when the stack is empty.
export function currentTagFrame(ctx) {
    ensureTagFrameStack(ctx);
    if (ctx.tagFrameStack.length === 0) return TagFrameKind.Closed;
    return ctx.tagFrameStack[ctx.tagFrameStack.length - 1].kind;
}

// topTagFrame — calculation (peek). The top open-tag frame (the
// descriptor — kind + payload), or null when no tag is open. The frame a
// matching closer (MK2.2) pops.
export function topTagFrame(ctx) {
    ensureTagFrameStack(ctx);
    if (ctx.tagFrameStack.length === 0) return null;
    return ctx.tagFrameStack[ctx.tagFrameStack.length - 1];
}

// makeOpenExpectingChildrenFrame — calculation (pure data builder). The
// live mirror of the canonical `.OpenExpectingChildren(name, kind,
// depth, span)` payload-bearing state-child — a frame struct carrying
// { kind: "OpenExpectingChildren", name, tagKind, depth, span, bodyMode }.
//
// `bodyMode` is the §4.18 body mode of the body this tag opens — the
// BodyMode engine instance's initial state for that body. MK2.1 created
// the field carrying null; MK3.1 sets it: recognizeOpener computes the
// mode (bodyModeForChildOf — SPEC §4.18.1) and passes it here. A caller
// that has not yet computed the mode (the MK2.1-era 4-arg call sites in
// tests) may omit the argument — it then defaults to null, the MK2.1
// behavior, so existing callers are unaffected.
export function makeOpenExpectingChildrenFrame(name, tagKind, depth, span, bodyMode) {
    return {
        kind:     TagFrameKind.OpenExpectingChildren,
        name,
        tagKind,
        depth,
        span,
        // bodyMode — the §4.18 body mode of the body this tag opens
        // (BodyMode.FreeText / BodyMode.CodeDefault, or
        // ProgramBodyMode.DefaultLogic for a `<program>` / `<page>`).
        // MK3.1's recognizeOpener supplies it; null when a caller omits
        // it (MK2.1-compatibility default).
        bodyMode: bodyMode ?? null,
    };
}

// makeOpenSelfClosedFrame — calculation (pure data builder). The live
// mirror of the canonical `.OpenSelfClosed(name, kind, span)`
// payload-bearing state-child. No `depth` payload — a self-closed tag
// opens no child subtree.
export function makeOpenSelfClosedFrame(name, tagKind, span) {
    return {
        kind:    TagFrameKind.OpenSelfClosed,
        name,
        tagKind,
        span,
    };
}

// pushTagFrame — STATE write: a tag opens. Appends an open-tag frame to
// ctx.tagFrameStack. The `.Closed -> .Open*` (or nested
// `.OpenExpectingChildren -> .OpenExpectingChildren`) @tagFrame
// transition.
export function pushTagFrame(ctx, frame) {
    ensureTagFrameStack(ctx);
    ctx.tagFrameStack.push(frame);
}

// popTagFrame — STATE write: a tag closes. Returns the popped frame, or
// null if the stack was empty (an unbalanced closer — MK2.2's
// ErrorRecovery dispatch). The `.Open* -> .Closed` @tagFrame transition.
// MK2.1 provides it as the substrate; MK2.2 drives it from the
// closer-form recognizers.
export function popTagFrame(ctx) {
    ensureTagFrameStack(ctx);
    if (ctx.tagFrameStack.length === 0) return null;
    return ctx.tagFrameStack.pop();
}

// ===========================================================================
// recognizeOpener — the MK2.1 opener-side entry point.
//
// STATE transition at its own locus (it walks the cursor past the opener
// BODY via tokenizeOpener, then PUSHES a TagFrame — a @tagFrame rule=
// transition).
//
// PARAMETERS:
//   ctx      — the parse context (carries ctx.tagFrameStack).
//   cursor   — positioned at the byte AFTER the `<` (the `<` was consumed
//              by enterMarkupTagContext).
//   ltAnchor — the `<`'s span (the .InMarkupTag BlockContext frame's
//              openSpan) — the opener-span anchor.
//
// The steps:
//   1. Tokenize the opener BODY in one pass (tokenizeOpener).
//   2. Compute the opener's TagKind (tagKindFor).
//   3. Build the open-tag frame (self-closing -> .OpenSelfClosed;
//      otherwise -> .OpenExpectingChildren carrying the tag-tree depth).
//   4. Push the frame onto ctx.tagFrameStack.
//
// Returns the pushed frame descriptor (also carrying the tokenizer
// descriptor as `.opener` so the caller — parse-markup's .InMarkupTag
// dispatcher — can emit the Markup block at the opener's full span and
// observe `malformed`).
//
// The closer side (MK2.2) and the decl-vs-markup classification
// completion (MK2.3) consume this same frame; MK2.1 lands the push.
//
// MK2.3 amendment: recognizeOpener also stamps the post-`>` inspection
// (`afterOpener` — inspectAfterOpener) onto the frame. The TagClass
// classification (classifyTagFrame) runs at frame-CLOSE time — when the
// element's first child's own TagClass is already known (recursive
// descent closes children before the parent's closer), so the BS's
// self-recursive classifier becomes a typed-payload READ.
//
// MK3.1 amendment: recognizeOpener establishes the §4.18 BODY MODE of the
// body the opener opens — for a non-self-closing opener — and stamps it
// onto the .OpenExpectingChildren frame's `bodyMode` payload. The body
// mode is bodyModeForChildOf(opener.name, parentName) — SPEC §4.18.1: a
// body is code-default IFF it is an engine state-child / match arm body
// (loci 1 + 2). The PARENT is topTagFrame(ctx) BEFORE the push (the
// frame immediately enclosing this one); a top-level tag has no parent
// (null). A self-closing `<ident ... />` opens NO body, so it carries no
// `bodyMode` payload (makeOpenSelfClosedFrame has no such field).
export function recognizeOpener(ctx, cursor, ltAnchor) {
    // 1. One-pass opener-body tokenization.
    const opener = tokenizeOpener(cursor, ltAnchor);

    // 2. The TagKind calculation.
    const tagKind = tagKindFor(opener.name, opener.hadSpaceAfterLt);

    // 3 + 4. Build + push the open-tag frame.
    //
    // The LEAF condition — a `/>`-self-closing opener OR an HTML void
    // element (`<input>`, `<br>`, ...) written without a `/>`. Both open
    // NO body and expect NO closer; both push an .OpenSelfClosed (leaf)
    // frame. Mirrors block-splitter.js L1747's
    // `selfClosing || VOID_ELEMENTS.has(lowerTagName)`.
    const leafFrame = opener.selfClosing || opener.voidElement;
    let frame = null;
    if (leafFrame) {
        // A self-closing `<ident ... />` — or an HTML void element —
        // opens no body (SPEC §4.18.1 — a body is the content between an
        // opener's `>` and its closer); it carries no `bodyMode` payload.
        frame = makeOpenSelfClosedFrame(opener.name, tagKind, opener.span);
    } else {
        // The tag-tree depth at which this frame opens — the stack
        // length BEFORE the push (a top-level tag opens at depth 0).
        const depthAtOpen = tagFrameDepth(ctx);
        // MK3.1 — establish the §4.18 body mode of the body this opener
        // opens. The PARENT element is the TagFrame immediately enclosing
        // this one (topTagFrame BEFORE the push); null at the top level.
        // bodyModeForChildOf is SPEC §4.18.1's establishment rule.
        const parent = topTagFrame(ctx);
        const parentName = (parent !== null && parent !== undefined)
            ? parent.name
            : null;
        const bodyMode = bodyModeForChildOf(opener.name, parentName);
        frame = makeOpenExpectingChildrenFrame(
            opener.name,
            tagKind,
            depthAtOpen,
            opener.span,
            bodyMode,
        );
    }
    pushTagFrame(ctx, frame);

    // Carry the tokenizer descriptor so the caller can emit the Markup
    // block at the opener's full span + observe `malformed`.
    frame.opener = opener;

    // MK2.3 — stamp the post-`>` inspection. opener.span.end is one past
    // the opener's terminating `>`; inspectAfterOpener reads the bytes
    // there (a decl signal `=`/`:` or a nested `<ident`). The closed-rule
    // TagClass (classifyTagFrame) consumes this at close.
    frame.afterOpener = inspectAfterOpener(cursor.source, opener.span.end);
    return frame;
}

// ===========================================================================
// MK2.3 — THE TagKind-DRIVEN CLASSIFICATION (charter Q1.F + Q2.A #4).
//
// The completion of the <tag>-tree work: the grammar decides
// decl-vs-markup-vs-structural from `TagKind` (computed at MK2.1) + what
// FOLLOWS the opener's terminating `>`. This is the elimination of BS
// classifier heuristics #1 + #4:
//
//   #1 `isAfterTransitionArrow` (block-splitter.js:276-303) — a BACKWARD
//      scan: from a `<`, scan backward past whitespace, expect `=>`, scan
//      back through balanced `()`, expect an identifier — to decide
//      whether `< Target>` after `name(...) =>` is a transition target.
//      The native parser does NO backward scan: in a code-default body
//      `name(...) => <Target>` is CODE, parsed by the JS-layer grammar;
//      the `=>` is a JS operator the lexer tokenizes; `<Target>` is
//      markup-as-value, recognized FORWARD by the JS layer's
//      `markupValueAllowedAfter(lastKind)` discriminator (punch-list P4,
//      lex-in-code.js — `Arrow` IS a value-position prev-token, so P4
//      returns true). The backward heuristic scan is GONE.
//
//   #4 `classifyOpenerForCompoundScan` (block-splitter.js:670-753,
//      SELF-RECURSIVE) — tokenize the opener (a balanced-attr scan), then
//      inspect post-`>`: a `=` not part of `==`/`=>`, or a `:`, =>
//      state-decl; post-`>` whitespace + a nested `<ident` whose OWN
//      recursive classification is state-decl/compound => compound; else
//      markup. classifyTag below replaces it: tokenizeOpener (MK2.1, the
//      one-pass `skipOpener` primitive) does the tokenize; classifyTag
//      does the closed-rule classification from `TagKind` +
//      `inspectAfterOpener`'s post-`>` facts + the first child's
//      ALREADY-COMPUTED `TagClass`. The SELF-RECURSION is gone — the BS
//      recurses because it has no grammar + must decide whether to defer
//      the body as raw text; the native parser parses the body in place
//      via recursive descent (the TagFrame stack), so the nested opener
//      is classified by the trampoline's natural descent and the parent
//      reads its child's typed payload.
//
// ADVISORY per SPEC §4.3 (load-bearing) — see the .scrml TagClass type.
// The native parser COMPUTES TagClass from a closed rule and carries it
// as a TagFrame payload; NR (Stage 3.05) is the downstream AUTHORITATIVE
// markup-vs-state resolver. The elimination is genuine: a closed
// calculation + a typed payload, not a guess.
// ===========================================================================

// isDeclSignalChar — calculation (predicate). A `:` immediately after an
// opener's `>` is a `:`-shorthand-body / state-decl signal (§4.14 / §6).
// (`=` needs a two-char look — see inspectAfterOpener — so it is NOT a
// single-char test.)
export function isDeclSignalChar(ch) {
    return ch === ":";
}

// inspectAfterOpener — calculation (pure fn over a source + the
// one-past-`>` offset). Inspects the bytes immediately FOLLOWING an
// opener's terminating `>` and returns the two facts the TagClass
// calculation needs:
//
//   { declSignal, nestedTagAt }
//
//   declSignal  — true when, after skipping inline spaces/tabs, the next
//                 char is a `=` that is NOT part of `==` or `=>` (a
//                 state-DECLARATION assignment — `<NAME> = expr`), or is
//                 a `:` (a `:`-shorthand body — `<NAME> : ...`). This is
//                 heuristic #4's post-`>` `=`/`:` test
//                 (block-splitter.js:723-730), done forward + closed.
//   nestedTagAt — the offset of a nested `<ident` opener if, after
//                 skipping ALL whitespace, the body opens with one; -1
//                 otherwise. The COMPOUND-state shape signal (heuristic
//                 #4's post-`>` whitespace + `<ident` test,
//                 block-splitter.js:736-751) — but the native parser
//                 does NOT recurse here: the nested tag is classified by
//                 the trampoline's descent and the parent reads the
//                 child's TagClass at close.
//
// A pure fn — no cursor, no engine write. Mirrors the no-offset-math
// discipline: the inputs are a source string + an absolute offset.
export function inspectAfterOpener(source, afterOpenerPos) {
    const len = source.length;

    // 1. The decl-signal test — skip inline spaces/tabs only (a
    //    declaration `=`/`:` follows the `>` on the SAME shape, the
    //    BS-#4 `source[r] === " " || "\t"` skip).
    let r = afterOpenerPos;
    while (r < len) {
        const c = source.charAt(r);
        if (c === " ") {
            r = r + 1;
        } else if (c === String.fromCharCode(9)) {
            r = r + 1;
        } else {
            break;
        }
    }
    let declSignal = false;
    if (r < len) {
        const c = source.charAt(r);
        if (c === "=") {
            // A `=` is a decl assignment UNLESS it is `==` or `=>`.
            let nxt = "";
            if (r + 1 < len) {
                nxt = source.charAt(r + 1);
            }
            if (nxt !== "=" && nxt !== ">") {
                declSignal = true;
            }
        } else if (isDeclSignalChar(c)) {
            declSignal = true;
        }
    }

    // 2. The nested-tag test — skip ALL whitespace (BS-#4 skips `\s`
    //    before the nested `<ident` look). nestedTagAt is the nested
    //    opener's `<` offset, or -1.
    let s = afterOpenerPos;
    while (s < len && isOpenerWhitespace(source.charAt(s))) {
        s = s + 1;
    }
    let nestedTagAt = -1;
    if (s + 1 < len && source.charAt(s) === "<") {
        if (isTagNameStart(source.charAt(s + 1))) {
            nestedTagAt = s;
        }
    }

    return { declSignal, nestedTagAt };
}

// classifyTag — calculation (pure fn). The closed-rule TagClass of a
// recognized opener. THE heuristic-elimination calculation for charter
// Q2.A #4 — a closed classification from typed inputs, no recursive scan.
//
// PARAMETERS:
//   tagKind         — the opener's TagKind (computed at MK2.1).
//   selfClosing     — whether the opener is a `<ident ... />`.
//   afterOpener     — the inspectAfterOpener descriptor (post-`>` facts:
//                     declSignal + nestedTagAt).
//   firstChildClass — the TagClass of the element's FIRST child element,
//                     or null when the element has no child element (a
//                     leaf, a text-only body, or a self-closing tag).
//                     The trampoline supplies it at close time — the
//                     child's TagClass is already computed (recursive
//                     descent closes children before the parent), so
//                     this is a typed-payload READ, NOT the BS's
//                     recursive classifier call.
//
// The classification (priority order):
//   1. selfClosing             → SelfClose   (§4.14 — a `/>` opener; no
//                                             body, no closer).
//   2. tagKind ScrmlStructural → Structural  (a scrml-defined structural
//                                             element — SPEC §4.15 /
//                                             §24.4; its kind IS its class).
//   3. afterOpener.declSignal   → Declaration (a `<NAME> = expr` /
//                                             `<NAME> : ...` shape —
//                                             heuristic #4's `=`/`:`
//                                             post-`>` test).
//   4. a nested first-child tag whose own class is Declaration or
//      Compound                 → Compound    (a compound state-decl
//                                             parent — heuristic #4's
//                                             recursive-compound test,
//                                             replaced by the child's
//                                             typed payload).
//   5. otherwise                → Markup       (an ordinary markup
//                                             element).
//
// Rationale for the priority order: SelfClose first — a `/>` opener has
// no body so neither the decl nor the compound test can apply. Structural
// before declSignal — `<engine ...> = ...` would be a misuse, but a
// structural element's CLASS is its kind regardless of a stray post-`>`
// `=`; NR validates structural-element placement. declSignal before the
// compound test — `<NAME> = <X>...` is a declaration whose RHS happens to
// open with a tag, not a compound.
export function classifyTag(tagKind, selfClosing, afterOpener, firstChildClass) {
    // 1. A self-closing `<ident ... />` — §4.14 self-closing form.
    if (selfClosing) return TagClass.SelfClose;
    // 2. A scrml-defined structural element — its TagKind IS its TagClass
    //    (SPEC §4.15 / §24.4).
    if (tagKind === TagKind.ScrmlStructural) return TagClass.Structural;
    // 3. A state declaration — a `=` (not `==`/`=>`) or a `:` immediately
    //    follows the opener's `>`.
    if (afterOpener !== null && afterOpener !== undefined && afterOpener.declSignal) {
        return TagClass.Declaration;
    }
    // 4. A compound state-decl parent — the body opens with a nested tag
    //    whose OWN class is Declaration or Compound. The native parser
    //    READS the child's already-computed TagClass; the BS RECURSED
    //    here (classifyOpenerForCompoundScan calling itself).
    if (firstChildClass === TagClass.Declaration) return TagClass.Compound;
    if (firstChildClass === TagClass.Compound) return TagClass.Compound;
    // 5. Otherwise — an ordinary markup element.
    return TagClass.Markup;
}

// firstChildElementClass — calculation (pure fn over a child-block
// array). The TagClass of the FIRST child block that is a markup element,
// or null if no child block is a markup element (the children are text /
// comments / context blocks, or there are none). The trampoline calls
// this at frame-close to get classifyTag's `firstChildClass` argument — a
// typed-payload read over the spliced child blocks (each Markup child
// carries its own `.tagClass`).
export function firstChildElementClass(children) {
    if (children === null || children === undefined) return null;
    let i = 0;
    while (i < children.length) {
        const child = children[i];
        if (child !== null && child !== undefined &&
            child.tagClass !== null && child.tagClass !== undefined) {
            return child.tagClass;
        }
        i = i + 1;
    }
    return null;
}

// classifyTagFrame — calculation at its own locus. The frame-close
// classification entry point: given a TagFrame (carrying tagKind +
// afterOpener + opener.selfClosing) and the element's spliced child
// blocks, compute + return the element's TagClass. The trampoline
// (parse-markup's closeMarkupElement / emitMarkupElement) calls this and
// stamps the result on the Markup block — the typed payload NR (Stage
// 3.05) consumes downstream.
export function classifyTagFrame(frame, children) {
    // A `/>`-self-closing opener OR an HTML void element (`<input>`,
    // `<br>`, ...) — both are §4.14 leaf elements: no body, no closer.
    // classifyTag's `selfClosing` argument is the "leaf element" datum
    // (the SelfClose TagClass), so a bare void element classifies
    // identically to a `/>` opener.
    const selfClosing = frame.opener !== null && frame.opener !== undefined &&
        (frame.opener.selfClosing || frame.opener.voidElement);
    const firstChildClass = firstChildElementClass(children);
    return classifyTag(frame.tagKind, selfClosing, frame.afterOpener, firstChildClass);
}

// ===========================================================================
// MK2.2 — THE 3 CLOSER FORMS + opener/closer PAIRING + mismatch recovery.
//
// MK2.1 landed the OPENER side (recognizeOpener pushes a TagFrame). MK2.2
// lands the CLOSER side — the `.Open* -> .Closed` @tagFrame transition —
// and the opener/closer PAIRING the stack discipline gives by construction
// (the elimination of BS heuristic #5 `scanCompoundBlockEnd`, which
// forward-scans for the matching `</>` by counting nested pairs; the
// recursive-descent stack finds the match WITHOUT a separate scan).
//
// THE THREE FORMS (charter Q1.F; SPEC §4.4 + §4.14):
//   - `</>`      inferred closer (SPEC §4.4.2) — closes the innermost open
//                tag REGARDLESS of name.
//   - `</name>`  explicit closer (SPEC §4.4.1) — closes the innermost open
//                tag whose name is `name`; a non-matching name is
//                E-MARKUP-002 (SPEC §4.4.1 normative).
//   - `/>`       self-closing (SPEC §4.14 body form) — recognized at the
//                OPENER by MK2.1's recognizeOpener (an .OpenSelfClosed
//                frame). MK2.2 completes its lifecycle: an .OpenSelfClosed
//                frame closes immediately (no separate closer token).
//
// Recognized STRUCTURALLY — a CLOSED SET. There is NO `looksLikeCloser`
// bare-`/` heuristic (BS heuristic #12); a `/` that is not part of `</>`
// / `</name>` / `/>` is not a closer.
//
// SPEC-CODE NOTE (load-bearing — corrects the MK2.2 brief): the brief
// said a mismatched `</name>` is "E-CTX-001 panic-mode recovery". SPEC
// §4.4.1 (line 397) + §34 (E-MARKUP-002, line 14928) are normative: an
// explicit closer whose name does NOT match the innermost open tag is
// E-MARKUP-002. E-CTX-001 (§34 line 14878) is "wrong closer for context
// type"; SPEC §4 line 1072 uses E-CTX-001 for an UNTERMINATED tag (EOF
// before the closer). So MK2.2 encodes: mismatched `</name>` ->
// E-MARKUP-002; an EOF-unterminated tag -> E-CTX-001; a stray closer
// with no open tag -> E-CTX-003. The brief's load-bearing instruction
// (dispatch the ErrorRecovery engine — the same panic-mode the JS layer
// uses, scoped to block grammar) is honored regardless of the code name.
// ===========================================================================

// CloserForm — PURE DATA tags. The closer forms whose lifecycle the
// TagFrame engine completes. `Inferred` / `Explicit` are the two SPEC
// §4.4 closer FORMS; `SelfClosing` is the §4.14 self-closing body form
// (recognized at the opener — surfaced here for a uniform close API).
export const CloserForm = Object.freeze({
    Inferred:    "Inferred",
    Explicit:    "Explicit",
    SelfClosing: "SelfClosing",
});

// lessThanSlash — calculation. The two-character `</` closer prelude.
export function lessThanSlash() {
    return "<" + slash();
}

// inferredCloser — calculation. The three-character `</>` inferred-closer
// token (SPEC §4.4.2). Assembled via slash() per the README ANOMALY-1
// string-literal discipline (the `.scrml` shadow needs it; the `.js`
// keeps the shape 1:1).
export function inferredCloser() {
    return "<" + slash() + closeAngle();
}

// recognizeCloserForm — calculation (pure fn over the cursor). Returns
// the CloserForm a closer STARTING at the cursor would be, or null if no
// closer opener is at the cursor. A CLOSED structural test — the
// heuristic-elimination shape (no bare-`/` `looksLikeCloser` guess).
//
//   `</>`            -> CloserForm.Inferred  (checked FIRST — `</>` is a
//                       prefix-superset start of `</`, so the 3-char
//                       inferred test must precede the explicit test).
//   `</` + name char -> CloserForm.Explicit  (an explicit `</name>`).
//   anything else     -> null.
//
// Does NOT advance the cursor; does NOT decide whether the closer is
// legal here (that is the trampoline's per-context dispatch — a closer
// inside a `${ }` logic context is E-CTX-002, the trampoline's concern).
export function recognizeCloserForm(cursor) {
    if (peekStr(cursor, 3) === inferredCloser()) return CloserForm.Inferred;
    if (peekStr(cursor, 2) === lessThanSlash()) {
        // `</` followed by a tag-name start is an explicit `</name>`.
        const afterSlash = peekChar(cursor, 2);
        if (isTagNameStart(afterSlash)) return CloserForm.Explicit;
    }
    return null;
}

// tokenizeCloser — calculation at its own locus (a pure fn over the
// shared cursor: it walks the cursor forward past the closer token and
// returns a descriptor; it writes no engine state). The closer-side
// analogue of tokenizeOpener.
//
// PARAMETERS:
//   cursor — positioned at the `<` of a `</>` or `</name>` closer (the
//            caller has verified recognizeCloserForm is non-null).
//
// The pass, by form:
//   - Inferred `</>` — consume the three characters; span covers `</>`.
//   - Explicit `</name>` — consume `</`, scan the tag-name run, skip
//     trailing whitespace, then a `>` terminates. A missing `>` (EOF
//     before it) is recorded `malformed`.
//
// Returns { ok, form, name, span, malformed } where `name` is "" for an
// inferred closer and the closed tag's name for an explicit one. The
// span is file-absolute (the one-cursor invariant — no offset math).
export function tokenizeCloser(cursor) {
    const source = cursor.source;
    const len = source.length;
    const startPos = cursor.pos;
    const startLine = cursor.line;
    const startCol = cursor.col;

    const form = recognizeCloserForm(cursor);

    if (form === CloserForm.Inferred) {
        // `</>` — three characters, no name, always well-formed.
        advance(cursor, 3);
        return {
            ok:        true,
            form:      CloserForm.Inferred,
            name:      "",
            span:      makeSpan(startPos, cursor.pos, startLine, startCol),
            malformed: false,
        };
    }

    // CloserForm.Explicit — `</name>`. Consume the `</` prelude.
    advance(cursor, 2);

    // The tag-name run. recognizeCloserForm verified a name start follows.
    const nameStart = cursor.pos;
    const nameEnd = scanTagName(source, nameStart);
    const name = source.substring(nameStart, nameEnd);
    advance(cursor, nameEnd - nameStart);

    // Optional whitespace before the `>` (e.g. `</div >`).
    const afterWs = skipOpenerWhitespace(source, cursor.pos);
    advance(cursor, afterWs - cursor.pos);

    // The terminator `>`.
    let malformed = false;
    if (cursor.pos < len && source.charAt(cursor.pos) === closeAngle()) {
        advance(cursor, 1);
    } else {
        // EOF (or a non-`>`) before the terminator — a malformed closer.
        malformed = true;
    }

    return {
        ok:        !malformed,
        form:      CloserForm.Explicit,
        name,
        span:      makeSpan(startPos, cursor.pos, startLine, startCol),
        malformed,
    };
}

// ===========================================================================
// THE DIAGNOSTIC SINK — the markup-layer error stream (MK2.2).
//
// MK2.2 is the first native-parser milestone that PRODUCES a structured
// markup diagnostic — the closer-grammar diagnostics: a mismatched
// explicit closer (E-MARKUP-002), a stray closer with nothing open
// (E-CTX-003), an EOF-unterminated tag (E-CTX-001). M1/MK1 deferred the
// markup diagnostic stream ("a later milestone" — parse-markup MK1.3
// header); the closer-pairing milestone is where it must exist, because
// a mismatch outcome MUST be observable (for conformance + downstream
// stages). The sink is a `ctx.diagnostics` array — the same shape as the
// `ctx.nodes` block sink (parse-ctx). It carries closer-grammar
// diagnostics only at MK2.2; later milestones extend it.
// ===========================================================================

// ensureDiagnostics — STATE write (lazy init). Mirrors
// ensureTagFrameStack — a parse context built before MK2.2 has no
// diagnostics slot; this keeps the helpers total.
export function ensureDiagnostics(ctx) {
    if (ctx.diagnostics === undefined || ctx.diagnostics === null) {
        ctx.diagnostics = [];
    }
}

// makeDiagnostic — calculation (pure data builder). One structured
// markup diagnostic: { code, message, span }.
export function makeDiagnostic(code, message, span) {
    return { code, message, span };
}

// pushDiagnostic — STATE write: append a diagnostic to ctx.diagnostics.
export function pushDiagnostic(ctx, diagnostic) {
    ensureDiagnostics(ctx);
    ctx.diagnostics.push(diagnostic);
}

// ===========================================================================
// THE ErrorRecovery DISPATCH — panic-mode recovery for a closer mismatch.
//
// On a mismatched `</name>` (or a stray closer), MK2.2 dispatches the M1
// `ErrorRecovery` engine — the SAME engine + the SAME panic-mode
// lifecycle (.ParsingNormally -> .AccumulatingSkipped -> .ReSynchronized)
// the JS layer uses, scoped to block grammar. The closer that triggered
// recovery is itself the re-sync token: a closer is a statement-boundary-
// equivalent block-grammar token, so recovery accumulates the offending
// closer as the skipped token and immediately re-synchronizes on it (the
// `ClosingBrace` SyncToken — the closest block-grammar sync class). This
// is the markup-layer analogue of the JS layer re-syncing on `;`.
// ===========================================================================

// dispatchTagMismatchRecovery — STATE write. Drive ctx.recovery through
// the panic-mode lifecycle for a closer mismatch, accumulating `closer`
// (the offending closer descriptor) as the skipped token and re-syncing
// on it. Returns ctx.recovery (re-synchronized) so the caller can
// observe the recovery outcome.
export function dispatchTagMismatchRecovery(ctx, closer) {
    beginRecovery(ctx.recovery);
    accumulateSkipped(ctx.recovery, closer);
    markResync(ctx.recovery, SyncToken.ClosingBrace);
    // The closer is a single re-sync point — recovery completes here; the
    // trampoline resumes normal parsing immediately after the closer.
    resumeNormal(ctx.recovery);
    return ctx.recovery;
}

// ===========================================================================
// closeTagFrame — the MK2.2 closer-side entry point: the opener/closer
// PAIRING. STATE transition at its own locus (it pops the matching
// TagFrame — a @tagFrame `.Open* -> .Closed` transition — and, on a
// mismatch, drives ErrorRecovery + the diagnostic sink).
//
// PARAMETERS:
//   ctx    — the parse context (carries ctx.tagFrameStack +
//            ctx.diagnostics + ctx.recovery).
//   closer — the closer descriptor from tokenizeCloser (form + name +
//            span). For a `/>` self-close the caller passes a synthetic
//            descriptor { form: .SelfClosing, name, span } — see
//            closeSelfClosedFrame.
//
// THE PAIRING LOGIC (charter Q1.F rule= contract):
//   - `</>` inferred — pops the innermost open tag REGARDLESS of name.
//     A non-empty stack pop always succeeds; an empty stack is a stray
//     closer (E-CTX-003).
//   - `</name>` explicit — the innermost open tag's name MUST be `name`.
//     A match pops it. A mismatch is E-MARKUP-002: dispatch ErrorRecovery,
//     record the diagnostic, and recover by NOT popping (the open tag
//     stays — the mismatched closer is treated as skipped, the trampoline
//     resumes; the open tag will be paired by a later correct closer or
//     surface as unterminated at EOF). An empty stack is a stray closer
//     (E-CTX-003).
//
// Returns { ok, popped, code } — `popped` is the closed TagFrame (null on
// a mismatch / stray closer) and `code` is the diagnostic code (null on a
// clean close). The `ok` flag is true only for a clean close.
export function closeTagFrame(ctx, closer) {
    ensureTagFrameStack(ctx);
    const top = topTagFrame(ctx);

    // A stray closer — the stack is empty, there is no open tag to close.
    if (top === null) {
        const code = "E-CTX-003";
        pushDiagnostic(ctx, makeDiagnostic(
            code,
            "Closer with no matching open tag.",
            closer.span,
        ));
        dispatchTagMismatchRecovery(ctx, closer);
        return { ok: false, popped: null, code };
    }

    // An explicit `</name>` whose name does NOT match the innermost open
    // tag — E-MARKUP-002. Dispatch ErrorRecovery; do NOT pop (recover by
    // skipping the mismatched closer).
    if (closer.form === CloserForm.Explicit && closer.name !== top.name) {
        const code = "E-MARKUP-002";
        pushDiagnostic(ctx, makeDiagnostic(
            code,
            "Explicit closer </" + closer.name + "> does not match the open tag <" + top.name + ">.",
            closer.span,
        ));
        dispatchTagMismatchRecovery(ctx, closer);
        return { ok: false, popped: null, code };
    }

    // A clean close — `</>` inferred (any name), `</name>` matching, or a
    // `/>` self-close. Pop the matching frame: the `.Open* -> .Closed`
    // @tagFrame transition.
    const popped = popTagFrame(ctx);
    return { ok: true, popped, code: null };
}

// closeSelfClosedFrame — STATE transition. The lifecycle completion for a
// `/>` self-closing opener (SPEC §4.14). MK2.1's recognizeOpener pushes
// an .OpenSelfClosed frame; a self-closed tag has no separate closer
// token, so the frame closes IMMEDIATELY — at the opener. This pops the
// just-pushed .OpenSelfClosed frame (the `.OpenSelfClosed -> .Closed`
// @tagFrame transition per the Q1.F rule= contract). Returns the popped
// frame, or null if the top frame was not an .OpenSelfClosed (defensive).
export function closeSelfClosedFrame(ctx) {
    ensureTagFrameStack(ctx);
    const top = topTagFrame(ctx);
    if (top === null) return null;
    if (top.kind !== TagFrameKind.OpenSelfClosed) return null;
    return popTagFrame(ctx);
}

// reportUnterminatedTags — STATE write. At EOF, every TagFrame still on
// the stack is an unterminated tag (the opener was never paired with a
// closer) — SPEC §4 (line 1072) E-CTX-001. One diagnostic per
// still-open frame, blamed at the opener's span. Returns the count of
// unterminated tags reported. The trampoline calls this once at EOF.
export function reportUnterminatedTags(ctx) {
    ensureTagFrameStack(ctx);
    let count = 0;
    let i = 0;
    while (i < ctx.tagFrameStack.length) {
        const frame = ctx.tagFrameStack[i];
        // An .OpenSelfClosed frame on the stack at EOF means a self-close
        // whose lifecycle was never completed by the trampoline — still
        // an unterminated tag; blame the opener span. .OpenExpectingChildren
        // is the ordinary unterminated case.
        pushDiagnostic(ctx, makeDiagnostic(
            "E-CTX-001",
            "Unterminated tag <" + frame.name + "> — no closer before end of input.",
            frame.span,
        ));
        count = count + 1;
        i = i + 1;
    }
    return count;
}
