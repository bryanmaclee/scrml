// lex-in-code.js — JS-host shadow of lex-in-code.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors lex-in-code.scrml's header — see that file.

import { peekChar, peekCharCode, peekStr, advance, isEof } from "./cursor.js";
import { makeToken, makeIdentOrKeyword, makeEof, TokenKind, QuoteKind } from "./token.js";
import { makeSpan } from "./span.js";
import { LexMode, setMode } from "./lex-mode.js";
import { push as pushBracket, pop as popBracket, BracketKind } from "./bracket-stack.js";
import { dispatchInSingleString } from "./lex-in-single-string.js";
import { dispatchInDoubleString } from "./lex-in-double-string.js";
import { dispatchInTemplateBody } from "./lex-in-template.js";
import { isTemplateInterpClose, emitTemplateInterpClose } from "./lex-in-template.js";
import { dispatchInLineComment } from "./lex-in-line-comment.js";
import { dispatchInBlockComment } from "./lex-in-block-comment.js";
import { dispatchInRegexBody } from "./lex-in-regex.js";

// --- Character-classification predicates ---
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

// --- parseNumericLiteralValue — DD §D1 canonical calculation example ---
export function parseNumericLiteralValue(raw) {
    let body = raw;
    if (body.length > 0 && body.charAt(body.length - 1) === "n") {
        body = body.substring(0, body.length - 1);
    }
    body = body.split("_").join("");
    if (body.length >= 2 && body.charAt(0) === "0") {
        const p = body.charAt(1);
        if (p === "x" || p === "X") return parseInt(body.substring(2), 16);
        if (p === "o" || p === "O") return parseInt(body.substring(2), 8);
        if (p === "b" || p === "B") return parseInt(body.substring(2), 2);
    }
    return Number(body);
}

// --- Reusable scan helpers ---

export function skipWhitespaceAndNewlines(cursor) {
    while (!isEof(cursor)) {
        const c = peekCharCode(cursor, 0);
        if (isWhitespaceCode(c) || isNewlineCode(c)) {
            advance(cursor, 1);
        } else {
            break;
        }
    }
}

export function scanIdentifier(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1);
    while (!isEof(cursor) && isIdentCont(peekCharCode(cursor, 0))) {
        advance(cursor, 1);
    }
    const text = cursor.source.substring(start, cursor.pos);
    return { text, span: makeSpan(start, cursor.pos, line, col) };
}

export function scanNumericLiteral(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;

    if (peekCharCode(cursor, 0) === 48 && !isEof(cursor)) {
        const next = peekChar(cursor, 1);
        if (next === "x" || next === "X" || next === "o" || next === "O" || next === "b" || next === "B") {
            advance(cursor, 2);
            while (!isEof(cursor)) {
                const c = peekCharCode(cursor, 0);
                if (isHexDigit(c) || c === 95) {
                    advance(cursor, 1);
                } else {
                    break;
                }
            }
            if (peekChar(cursor, 0) === "n") advance(cursor, 1);
            const raw = cursor.source.substring(start, cursor.pos);
            return { raw, span: makeSpan(start, cursor.pos, line, col) };
        }
    }

    while (!isEof(cursor)) {
        const c = peekCharCode(cursor, 0);
        if (isDigit(c) || c === 95) {
            advance(cursor, 1);
        } else {
            break;
        }
    }
    if (peekChar(cursor, 0) === ".") {
        const afterDot = peekCharCode(cursor, 1);
        if (isDigit(afterDot)) {
            advance(cursor, 1);
            while (!isEof(cursor)) {
                const c = peekCharCode(cursor, 0);
                if (isDigit(c) || c === 95) {
                    advance(cursor, 1);
                } else {
                    break;
                }
            }
        }
    }
    const ec = peekChar(cursor, 0);
    if (ec === "e" || ec === "E") {
        advance(cursor, 1);
        const sign = peekChar(cursor, 0);
        if (sign === "+" || sign === "-") advance(cursor, 1);
        while (!isEof(cursor)) {
            const c = peekCharCode(cursor, 0);
            if (isDigit(c)) {
                advance(cursor, 1);
            } else {
                break;
            }
        }
    }
    if (peekChar(cursor, 0) === "n") advance(cursor, 1);

    const raw = cursor.source.substring(start, cursor.pos);
    return { raw, span: makeSpan(start, cursor.pos, line, col) };
}

// --- M1.1 stub scanners ---

export function stubScanSingleString(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1);
    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);
        if (c === "\\") { advance(cursor, 2); continue; }
        if (c === "'") { advance(cursor, 1); break; }
        advance(cursor, 1);
    }
    return { raw: cursor.source.substring(start, cursor.pos), span: makeSpan(start, cursor.pos, line, col) };
}

export function stubScanDoubleString(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1);
    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);
        if (c === "\\") { advance(cursor, 2); continue; }
        if (c === "\"") { advance(cursor, 1); break; }
        advance(cursor, 1);
    }
    return { raw: cursor.source.substring(start, cursor.pos), span: makeSpan(start, cursor.pos, line, col) };
}

export function stubScanTemplate(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1);
    let braceDepth = 0;
    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);
        if (c === "\\") { advance(cursor, 2); continue; }
        if (c === "$" && peekChar(cursor, 1) === "{") {
            braceDepth = braceDepth + 1;
            advance(cursor, 2);
            continue;
        }
        if (c === "}" && braceDepth > 0) {
            braceDepth = braceDepth - 1;
            advance(cursor, 1);
            continue;
        }
        if (c === "`" && braceDepth === 0) {
            advance(cursor, 1);
            break;
        }
        advance(cursor, 1);
    }
    return { raw: cursor.source.substring(start, cursor.pos), span: makeSpan(start, cursor.pos, line, col) };
}

// RETIRED in M1.4 — see lex-in-code.scrml for the rationale. Kept as
// an exported helper for parity with the other stubScan* fns.
export function stubScanRegex(cursor) {
    const start = cursor.pos;
    const line = cursor.line;
    const col = cursor.col;
    advance(cursor, 1);
    let inClass = false;
    while (!isEof(cursor)) {
        const c = peekChar(cursor, 0);
        if (c === "\\") { advance(cursor, 2); continue; }
        if (c === "[") { inClass = true; advance(cursor, 1); continue; }
        if (c === "]") { inClass = false; advance(cursor, 1); continue; }
        if (c === "/" && !inClass) {
            advance(cursor, 1);
            break;
        }
        if (isNewlineCode(peekCharCode(cursor, 0))) {
            break;
        }
        advance(cursor, 1);
    }
    const flagsStart = cursor.pos;
    while (!isEof(cursor) && isIdentCont(peekCharCode(cursor, 0))) {
        advance(cursor, 1);
    }
    const pattern = cursor.source.substring(start + 1, flagsStart - 1);
    const flags = cursor.source.substring(flagsStart, cursor.pos);
    return { pattern, flags, raw: cursor.source.substring(start, cursor.pos), span: makeSpan(start, cursor.pos, line, col) };
}

// --- regexAllowedAfter — DD §D4 P3 bounded-prev-token heuristic ---
export function regexAllowedAfter(lastKind) {
    if (lastKind === null || lastKind === undefined) return true;
    if (lastKind === TokenKind.Ident) return false;
    if (lastKind === TokenKind.NumberLit) return false;
    if (lastKind === TokenKind.StringLit) return false;
    if (lastKind === TokenKind.RegexLit) return false;
    if (lastKind === TokenKind.RParen) return false;
    if (lastKind === TokenKind.RBracket) return false;
    if (lastKind === TokenKind.RBrace) return false;
    if (lastKind === TokenKind.Increment) return false;
    if (lastKind === TokenKind.Decrement) return false;
    if (lastKind === TokenKind.KwThis) return false;
    if (lastKind === TokenKind.KwSuper) return false;
    if (lastKind === TokenKind.KwTrue) return false;
    if (lastKind === TokenKind.KwFalse) return false;
    if (lastKind === TokenKind.KwNull) return false;
    if (lastKind === TokenKind.KwUndefined) return false;
    if (lastKind === TokenKind.BareVariant) return false;
    if (lastKind === TokenKind.ScrmlAt) return false;
    return true;
}

// --- dispatchInCode — per-character dispatch for InCode state ---
export function dispatchInCode(cursor, ctx) {
    skipWhitespaceAndNewlines(cursor);
    if (isEof(cursor)) {
        ctx.tokens.push(makeEof(cursor.pos, cursor.line, cursor.col));
        return true;
    }

    const c0 = peekChar(cursor, 0);
    const code0 = peekCharCode(cursor, 0);
    const startPos = cursor.pos;
    const startLine = cursor.line;
    const startCol = cursor.col;

    // Template-interp close (§51.0.Q.1) — if we're inside a template-interp
    // body and the current `}` matches the depth at which the interp opened,
    // emit TemplateInterpEnd + transition outer LexMode back to InTemplateBody.
    // This MUST run before the normal `}` punctuation handling below
    // (otherwise the `}` would be emitted as a plain RBrace and the template
    // chunk scanner would never resume).
    if (c0 === "}" && isTemplateInterpClose(cursor, ctx)) {
        emitTemplateInterpClose(cursor, ctx);
        return true;
    }

    // Identifiers + keywords
    if (isIdentStart(code0)) {
        const { text, span } = scanIdentifier(cursor);
        ctx.tokens.push(makeIdentOrKeyword(text, span));
        return true;
    }

    // Numeric literals
    if (isDigit(code0)) {
        const { raw, span } = scanNumericLiteral(cursor);
        const value = parseNumericLiteralValue(raw);
        ctx.tokens.push(makeToken(TokenKind.NumberLit, raw, span, { value }));
        return true;
    }

    // @ident -> ScrmlAt
    if (c0 === "@" && isIdentStart(peekCharCode(cursor, 1))) {
        advance(cursor, 1);
        const { text } = scanIdentifier(cursor);
        const fullSpan = makeSpan(startPos, cursor.pos, startLine, startCol);
        ctx.tokens.push(makeToken(TokenKind.ScrmlAt, "@" + text, fullSpan, { name: text }));
        return true;
    }

    // ~ -> BitNot (Tilde recognition is M2+)
    if (c0 === "~") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitNot, "~", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // ?{ -> SqlBlock opener (naive paired-brace scan)
    if (c0 === "?" && peekChar(cursor, 1) === "{") {
        const sqlStart = cursor.pos;
        const sqlLine = cursor.line;
        const sqlCol = cursor.col;
        advance(cursor, 2);
        let depth = 1;
        while (!isEof(cursor) && depth > 0) {
            const cc = peekChar(cursor, 0);
            if (cc === "\\") { advance(cursor, 2); continue; }
            if (cc === "{") { depth = depth + 1; advance(cursor, 1); continue; }
            if (cc === "}") { depth = depth - 1; advance(cursor, 1); continue; }
            advance(cursor, 1);
        }
        const raw = cursor.source.substring(sqlStart, cursor.pos);
        ctx.tokens.push(makeToken(TokenKind.SqlBlock, raw, makeSpan(sqlStart, cursor.pos, sqlLine, sqlCol), { raw }));
        return true;
    }

    // ${ -> LogicEscapeOpen
    if (c0 === "$" && peekChar(cursor, 1) === "{") {
        advance(cursor, 2);
        const openerText = "$" + "{";
        ctx.tokens.push(makeToken(TokenKind.LogicEscapeOpen, openerText, makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // String literals (M1.2 — escape-aware bodies in lex-in-single-string.js
    // and lex-in-double-string.js; the LexMode engine governs the
    // InCode → InSingleString → InCode transitions via setMode).
    if (c0 === "'") {
        dispatchInSingleString(cursor, ctx);
        return true;
    }
    if (c0 === "\"") {
        dispatchInDoubleString(cursor, ctx);
        return true;
    }

    // Template literal (M1.2 — §51.0.Q.1 nested-engine pattern).
    // The opening backtick transitions outer LexMode to InTemplateBody;
    // the lex loop then routes through dispatchInTemplateBody until the
    // closing backtick returns us to InCode. ${...} interpolation is
    // handled by switching mode back to InCode while inside the interp,
    // with isTemplateInterpClose / emitTemplateInterpClose driving the
    // resume-to-InTemplateBody when the matching } closes the interp.
    if (c0 === "`") {
        // Consume the opening backtick + emit no opener token (Acorn's
        // template surface emits chunks; the opening/closing backticks
        // are bookend punctuation absorbed by the first/last TemplateChunk's
        // `raw` boundaries — see lex-in-template.js).
        advance(cursor, 1);
        setMode(ctx, LexMode.InTemplateBody);
        // Drive the first chunk synchronously so the outer loop sees the
        // mode change correctly on its next iteration. (We could also
        // simply return and let the loop handle it, but doing it inline
        // here keeps the per-call token-emit invariant consistent.)
        dispatchInTemplateBody(cursor, ctx);
        return true;
    }

    // Comments (M1.3 — proper body dispatchers in lex-in-line-comment.js
    // and lex-in-block-comment.js; the LexMode engine governs the
    // InCode → InLineComment / InBlockComment → InCode transitions via
    // setMode within each dispatcher. Mirrors the M1.2 string-dispatch
    // pattern: the dispatcher synchronously sets mode, scans the body,
    // sets mode back, and emits no token (comments non-emitted).)
    if (c0 === "/" && peekChar(cursor, 1) === "/") {
        setMode(ctx, LexMode.InLineComment);
        dispatchInLineComment(cursor, ctx);
        return true;
    }
    if (c0 === "/" && peekChar(cursor, 1) === "*") {
        setMode(ctx, LexMode.InBlockComment);
        dispatchInBlockComment(cursor, ctx);
        return true;
    }

    // Regex vs Division (DD §D4 P3) — the predicate decides whether `/`
    // opens a regex literal or is a division operator. On regex, set
    // LexMode.InRegexBody and call the M1.4 dispatcher inline (matches
    // the M1.3 comment-dispatch shape: transition in + body + transition
    // out happen synchronously, the dispatcher emits the RegexLit token
    // and flips LexMode back to InCode). On division, fall through to
    // the punctuation block below.
    if (c0 === "/") {
        const lastKind = ctx.tokens.length > 0 ? ctx.tokens[ctx.tokens.length - 1].kind : null;
        if (regexAllowedAfter(lastKind)) {
            setMode(ctx, LexMode.InRegexBody);
            dispatchInRegexBody(cursor, ctx);
            return true;
        }
    }

    // Punctuation + operators
    if (c0 === "=") {
        if (peekStr(cursor, 3) === "===") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.StrictEqual, "===", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "==") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.Equal, "==", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "=>") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.Arrow, "=>", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Assign, "=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "!") {
        if (peekStr(cursor, 3) === "!==") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.StrictNotEqual, "!==", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "!=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.NotEqual, "!=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Bang, "!", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "<") {
        if (peekStr(cursor, 2) === "<=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.LessEqual, "<=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "<<") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.BitShiftLeft, "<<", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LessThan, "<", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ">") {
        if (peekStr(cursor, 3) === ">>>") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.BitShiftRightUnsigned, ">>>", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === ">=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.GreaterEqual, ">=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === ">>") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.BitShiftRight, ">>", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.GreaterThan, ">", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "+") {
        if (peekStr(cursor, 2) === "++") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.Increment, "++", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "+=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.PlusAssign, "+=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Plus, "+", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "-") {
        if (peekStr(cursor, 2) === "--") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.Decrement, "--", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "-=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.MinusAssign, "-=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Minus, "-", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "*") {
        if (peekStr(cursor, 2) === "**") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.StarStar, "**", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "*=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.StarAssign, "*=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Star, "*", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "/") {
        if (peekStr(cursor, 2) === "/=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.SlashAssign, "/=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Slash, "/", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "%") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Percent, "%", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "&") {
        if (peekStr(cursor, 2) === "&&") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.LogicalAnd, "&&", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitAnd, "&", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "|") {
        if (peekStr(cursor, 2) === "||") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.LogicalOr, "||", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitOr, "|", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "^") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitXor, "^", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "?") {
        if (peekStr(cursor, 2) === "??") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.NullishCoalesce, "??", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Question, "?", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ".") {
        if (isIdentStart(peekCharCode(cursor, 1))) {
            const lastKind = ctx.tokens.length > 0 ? ctx.tokens[ctx.tokens.length - 1].kind : null;
            if (regexAllowedAfter(lastKind)) {
                advance(cursor, 1);
                const { text } = scanIdentifier(cursor);
                const fullSpan = makeSpan(startPos, cursor.pos, startLine, startCol);
                ctx.tokens.push(makeToken(TokenKind.BareVariant, "." + text, fullSpan, { name: text }));
                return true;
            }
        }
        if (isDigit(peekCharCode(cursor, 1))) {
            const { raw, span } = scanNumericLiteral(cursor);
            const value = parseNumericLiteralValue(raw);
            ctx.tokens.push(makeToken(TokenKind.NumberLit, raw, span, { value }));
            return true;
        }
        if (peekStr(cursor, 3) === "...") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.Ellipsis, "...", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Dot, ".", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // Brackets
    if (c0 === "(") {
        pushBracket(ctx.brackets, BracketKind.Paren, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LParen, "(", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ")") {
        popBracket(ctx.brackets);
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.RParen, ")", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "{") {
        pushBracket(ctx.brackets, BracketKind.Brace, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LBrace, "{", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "}") {
        popBracket(ctx.brackets);
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.RBrace, "}", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "[") {
        pushBracket(ctx.brackets, BracketKind.Bracket, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LBracket, "[", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "]") {
        popBracket(ctx.brackets);
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.RBracket, "]", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ";") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Semicolon, ";", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ",") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Comma, ",", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ":") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Colon, ":", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // Unknown — skip
    advance(cursor, 1);
    return true;
}
