// lex-in-regex.js — JS-host shadow of lex-in-regex.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors lex-in-regex.scrml's header.

import { peekChar, peekCharCode, advance, isEof } from "./cursor.js";
import { makeToken, TokenKind } from "./token.js";
import { makeSpan } from "./span.js";
import { LexMode, setMode } from "./lex-mode.js";
// K2 cleanup (M1.x): isNewlineCode + isIdentCont now come from the leaf
// module char-classify.js, NOT from lex-in-code.js — importing them back
// from lex-in-code (which imports dispatchInRegexBody from this file)
// formed a circular import. char-classify is a leaf both files import.
import { isNewlineCode, isIdentCont } from "./char-classify.js";

// --- scanRegexBody — consume `/pattern/flags` from the opening `/`.
// Cursor lands one past the trailing flag run (or at EOF / newline on
// unterminated regex). Returns { pattern, flags, raw, span }. ---
export function scanRegexBody(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1); // skip opening /
    let inClass = false;
    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);
        if (c === "\\") {
            // Escape — consume backslash + next char as a unit.
            advance(cursor, 2);
            continue;
        }
        if (c === "[") {
            inClass = true;
            advance(cursor, 1);
            continue;
        }
        if (c === "]") {
            inClass = false;
            advance(cursor, 1);
            continue;
        }
        if (c === "/" && !inClass) {
            advance(cursor, 1); // consume closing /
            break;
        }
        if (isNewlineCode(peekCharCode(cursor, 0))) {
            // Unterminated regex — LineTerminator inside body. Stop at
            // the LineTerminator (NOT consumed); parse-time diagnostic
            // is a later milestone.
            break;
        }
        advance(cursor, 1);
    }
    // Flag run — IdentifierPart-shaped tail.
    const flagsStart = cursor.pos;
    while (!isEof(cursor) && isIdentCont(peekCharCode(cursor, 0))) {
        advance(cursor, 1);
    }
    const pattern = cursor.source.substring(start + 1, flagsStart - 1);
    const flags = cursor.source.substring(flagsStart, cursor.pos);
    return {
        pattern,
        flags,
        raw: cursor.source.substring(start, cursor.pos),
        span: makeSpan(start, cursor.pos, line, col),
    };
}

// --- dispatchInRegexBody — state-aware wrapper. Scans the body,
// emits a RegexLit token, transitions LexMode back to InCode. ---
export function dispatchInRegexBody(cursor, ctx) {
    const { pattern, flags, raw, span } = scanRegexBody(cursor);
    ctx.tokens.push(makeToken(TokenKind.RegexLit, raw, span, { pattern, flags }));
    setMode(ctx, LexMode.InCode);
}
