// char-classify.js — JS-host shadow of char-classify.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors char-classify.scrml's header — see
// that file.
//
// Why this file exists (K2 — M1 circular-import break): these predicates
// were originally exported from lex-in-code.js. lex-in-regex.js needs
// isNewlineCode + isIdentCont, and lex-in-code.js needs dispatchInRegexBody
// from lex-in-regex.js — a circular import. The predicates are the shared
// surface, so they move here into a leaf module with zero native-parser
// imports; both files now import from this leaf and the cycle is broken.

// --- Character-classification predicates (pure fns over a code point) ---

export function isWhitespaceCode(c) {
    return c === 32 || c === 9 || c === 11 || c === 12 || c === 160;
}

export function isNewlineCode(c) {
    return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}

export function isDigit(c) {
    return c >= 48 && c <= 57;
}

export function isHexDigit(c) {
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

export function isIdentStart(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}

export function isIdentCont(c) {
    return isIdentStart(c) || isDigit(c);
}
