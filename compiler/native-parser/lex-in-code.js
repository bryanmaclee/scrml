// lex-in-code.js — JS-host shadow of lex-in-code.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors lex-in-code.scrml's header — see that file.

import { peekChar, peekCharCode, peekStr, advance, isEof } from "./cursor.js";
import { makeToken, makeIdentOrKeyword, makeEof, TokenKind, QuoteKind } from "./token.js";
import { makeSpan } from "./span.js";
import { LexMode, setMode } from "./lex-mode.js";
import { push, pop, BracketKind } from "./bracket-stack.js";
import { isWhitespaceCode, isNewlineCode, isDigit, isHexDigit, isIdentStart, isIdentCont } from "./char-classify.js";
import { dispatchInSingleString } from "./lex-in-single-string.js";
import { dispatchInDoubleString } from "./lex-in-double-string.js";
import { dispatchInTemplateBody } from "./lex-in-template.js";
import { isTemplateInterpClose, emitTemplateInterpClose } from "./lex-in-template.js";
import { dispatchInLineComment } from "./lex-in-line-comment.js";
import { dispatchInBlockComment } from "./lex-in-block-comment.js";
import { dispatchInRegexBody } from "./lex-in-regex.js";

// --- Character-classification predicates ---
// K2 cleanup (M1.x): the six predicates isWhitespaceCode / isNewlineCode /
// isDigit / isHexDigit / isIdentStart / isIdentCont moved to the leaf
// module char-classify.js — they are the shared surface lex-in-regex.js
// needs, so extracting them into a leaf both files import breaks the
// lex-in-code <-> lex-in-regex import cycle. Imported above; used unchanged
// below. The bracket-stack import above also drops its `as pushBracket` /
// `as popBracket` aliases (K2 — the canonical .scrml form imports `push` /
// `pop` plain; the v0.3 compiler does not bind an unquoted aliased import).

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

// --- markupValueAllowedAfter — PUNCH-LIST P4 (R1 seam spike §1.2 / §6 P4) ---
//
// Given the most-recently-emitted token kind, may a `<` at the current
// cursor position OPEN A MARKUP ELEMENT (a `<tag>...</>` as a value —
// §4.18.2 markup-as-value / Pillar 1) rather than mean less-than?
//
// This is the JS layer's `<`-vs-LessThan discriminator. The R1 seam spike
// §1.2 names it the EXACT TWIN of regexAllowedAfter (above): a `<` opens a
// markup element exactly when the previous token is one after which a
// VALUE is expected — `=`, `(`, `,`, `return`, `lift`, `render`, `=>`,
// `[`, a binary operator, start-of-body — AND the character after the `<`
// is a letter/`_` (the markup-opener shape) or whitespace-then-letter (the
// state-opener shape; the second test is the JS-layer caller's, not this
// predicate's). It is BOUNDED prev-token lookahead, NOT backtracking and
// NOT a heuristic (S98 OQ3 — the verdict the regex twin already
// established holds).
//
// Mechanism (the same partition regexAllowedAfter uses): a `<` is LessThan
// after a value or a closing bracket (a value-producing token); a `<` MAY
// open a markup element after everything else (an operator, an open
// bracket, a value-expecting keyword, or start-of-input). The predicate
// returns true in the markup-allowed positions. The full
// `<`-disambiguation also requires the next-char letter/whitespace test —
// that belongs to the JS-layer caller (§1.2), mirroring how the regex
// caller pairs regexAllowedAfter with its own `/`-content scan.
//
// FORWARD SEAM — the CONSUMER of this predicate is the MK4 markup<->JS
// seam: the JS layer's InCode dispatch consults it (parallel to the
// shipping regexAllowedAfter consult at ~line 404 / ~580 below) to decide
// whether a `<` begins a JS->markup `ElementValue` delegation. MK2.3 lands
// the predicate; MK4 wires the InCode-dispatch consult. dispatchInCode is
// therefore UNCHANGED at MK2.3 — this is an exported calculation with no
// caller yet inside this file.
export function markupValueAllowedAfter(lastKind) {
    // Start-of-input — a `<` here may open a top-level markup element.
    if (lastKind === null || lastKind === undefined) return true;
    // After a value or a closing bracket the `<` is less-than — a markup
    // element is NOT a legal continuation of a completed value.
    if (lastKind === TokenKind.Ident) return false;
    if (lastKind === TokenKind.NumberLit) return false;
    if (lastKind === TokenKind.StringLit) return false;
    if (lastKind === TokenKind.RegexLit) return false;
    if (lastKind === TokenKind.BoolLit) return false;
    if (lastKind === TokenKind.TemplateChunk) return false;
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
    // Everything else — an operator, an open bracket, a comma, a
    // value-expecting keyword (return / lift / render / yield / await /
    // ...), or `=>` — is a value position: a `<` here MAY open a markup
    // element.
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

    // @. contextual sigil -> ScrmlAt carrying the `.`-prefixed chain (#2f).
    // `@.` is the §each contextual iteration-value sigil: bare `@.` is the
    // current item/index; `@.field` / `@.a.b` is a dotted member path on it.
    // We consume `@.` PLUS the optional dotted-ident chain as ONE token so the
    // trailing `.field` does NOT fall to the BareVariant production below; the
    // ScrmlAt `name` carries everything AFTER the `@` (`.field` / `.` / `.a.b`),
    // and the translate-expr AtCell arm prepends `@` to yield ident{name:"@.field"}.
    // The leading `.` distinguishes this from the `@ident` reactive-ref form.
    if (c0 === "@" && peekChar(cursor, 1) === ".") {
        advance(cursor, 1); // skip @
        advance(cursor, 1); // skip .
        // Optional dotted-ident chain: ident ("." ident)*. Bare `@.` (no
        // ident-start after the `.`) is the count-form — name is just ".".
        if (isIdentStart(peekCharCode(cursor, 0))) {
            scanIdentifier(cursor);
            while (peekChar(cursor, 0) === "." && isIdentStart(peekCharCode(cursor, 1))) {
                advance(cursor, 1); // skip the chaining "."
                scanIdentifier(cursor);
            }
        }
        const fullSpan = makeSpan(startPos, cursor.pos, startLine, startCol);
        const raw = cursor.source.substring(startPos, cursor.pos);
        // raw === "@.<chain>"; name === everything after the "@" (the ".<chain>").
        ctx.tokens.push(makeToken(TokenKind.ScrmlAt, raw, fullSpan, { name: raw.substring(1) }));
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

    // ~ -> BitNot (Tilde recognition is M2+; see SPEC §32 and the
    // tildeIsStandalone disambiguation in parse-expr.{scrml,js}. K5b verified:
    // the single-char `~` is the canonical form — no maximal-munch is in play.)
    if (c0 === "~") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitNot, "~", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // ?{ -> SqlBlock opener (naive paired-brace scan).
    // MUST come before the `?` operator branch below; `?{` is NOT a `?` then
    // `{` — the `?{...}` is a single SQL embedding per §8.
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
    // S114 K3+K4+K5 maximal-munch: each multi-char operator emits as a
    // SINGLE TokenKind. Longest-match-first ordering within each operator
    // branch; the eleven compound-assigns from K3 are interspersed with the
    // existing operator tests (the JS-host shadow mirrors token.js's
    // single-kind catalog).
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
        // K3 — `<<=` is the longest match; emit before `<<` / `<=`.
        if (peekStr(cursor, 3) === "<<=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.BitShiftLeftAssign, "<<=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
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
        // K3 — `>>>=` (4 chars) is the longest match; emit before `>>>` / `>>=` / `>>` / `>=`.
        if (peekStr(cursor, 4) === ">>>=") {
            advance(cursor, 4);
            ctx.tokens.push(makeToken(TokenKind.BitShiftRightUnsignedAssign, ">>>=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 3) === ">>>") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.BitShiftRightUnsigned, ">>>", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        // K3 — `>>=` (3 chars) before `>>` / `>=`.
        if (peekStr(cursor, 3) === ">>=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.BitShiftRightAssign, ">>=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
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
        // K3 — `**=` (3 chars) is the longest match; emit before `**` / `*=`.
        if (peekStr(cursor, 3) === "**=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.StarStarAssign, "**=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
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
        // K3 — `%=` maximal-munch.
        if (peekStr(cursor, 2) === "%=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.PercentAssign, "%=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Percent, "%", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "&") {
        // K3 — `&&=` (3 chars) is the longest match; emit before `&&` / `&=`.
        if (peekStr(cursor, 3) === "&&=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.LogicalAndAssign, "&&=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "&&") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.LogicalAnd, "&&", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        // K3 — `&=`.
        if (peekStr(cursor, 2) === "&=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.BitAndAssign, "&=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitAnd, "&", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "|") {
        // K3 — `||=` (3 chars) is the longest match; emit before `||` / `|=`.
        if (peekStr(cursor, 3) === "||=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.LogicalOrAssign, "||=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "||") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.LogicalOr, "||", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        // K3 — `|=`.
        if (peekStr(cursor, 2) === "|=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.BitOrAssign, "|=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitOr, "|", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "^") {
        // K3 — `^=`.
        if (peekStr(cursor, 2) === "^=") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.BitXorAssign, "^=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.BitXor, "^", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "?") {
        // K3 — `??=` (3 chars) is the longest match; emit before `??`.
        if (peekStr(cursor, 3) === "??=") {
            advance(cursor, 3);
            ctx.tokens.push(makeToken(TokenKind.NullishCoalesceAssign, "??=", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        if (peekStr(cursor, 2) === "??") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.NullishCoalesce, "??", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        // K4 — `?.` optional-chain maximal-munch. The brief carve-out: NOT
        // when the `.` is followed by a digit — `0?.5` is the conditional-
        // then-decimal case (`0 ? .5 : ...`), where `.5` is a numeric
        // literal. Per ECMA-262 the optional-chain operator is forbidden
        // when the post-`.` char is a decimal digit precisely so this
        // grammar wedge is unambiguous; we match that carve-out here.
        if (peekStr(cursor, 2) === "?." && !isDigit(peekCharCode(cursor, 2))) {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.OptionalChain, "?.", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
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

    // K5a — `#` Hash token. scrml uses `#` only as part of the `<#id>` input-
    // state reference (§36); the SPEC does NOT include JS private-class-field
    // syntax (no `#x` in §48/§54), so a bare `#` outside the `<#id>` shape is
    // a syntax error caught at the parse layer. The lexer emits the token
    // unconditionally; isInputStateRefAhead in parse-expr checks the surrounding
    // `<` Hash Ident `>` adjacency before consuming the four tokens as one
    // InputStateRef atom.
    if (c0 === "#") {
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Hash, "#", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // Brackets
    if (c0 === "(") {
        push(ctx.brackets, BracketKind.Paren, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LParen, "(", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === ")") {
        pop(ctx.brackets);
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.RParen, ")", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "{") {
        push(ctx.brackets, BracketKind.Brace, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LBrace, "{", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "}") {
        pop(ctx.brackets);
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.RBrace, "}", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "[") {
        push(ctx.brackets, BracketKind.Bracket, makeSpan(startPos, startPos + 1, startLine, startCol));
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.LBracket, "[", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }
    if (c0 === "]") {
        pop(ctx.brackets);
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
        // K5c — `::` DoubleColon maximal-munch (§14.4 member-access alias).
        if (peekStr(cursor, 2) === "::") {
            advance(cursor, 2);
            ctx.tokens.push(makeToken(TokenKind.DoubleColon, "::", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
            return true;
        }
        advance(cursor, 1);
        ctx.tokens.push(makeToken(TokenKind.Colon, ":", makeSpan(startPos, cursor.pos, startLine, startCol), {}));
        return true;
    }

    // Unknown — skip
    advance(cursor, 1);
    return true;
}
