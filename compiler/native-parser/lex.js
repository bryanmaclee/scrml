// lex.js — JS-host shadow of lex.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors lex.scrml's header — see that file.

import { makeCursor, isEof } from "./cursor.js";
import { makeEof, TokenKind } from "./token.js";
import { LexMode, initialMode, setMode, getMode } from "./lex-mode.js";
import { makeBracketStack } from "./bracket-stack.js";
import { makeRecovery } from "./error-recovery.js";
import { dispatchInCode } from "./lex-in-code.js";
import { dispatchInSingleString } from "./lex-in-single-string.js";
import { dispatchInDoubleString } from "./lex-in-double-string.js";
import { dispatchInTemplateBody } from "./lex-in-template.js";
import { dispatchInLineComment } from "./lex-in-line-comment.js";
import { dispatchInBlockComment } from "./lex-in-block-comment.js";
import { dispatchInRegexBody } from "./lex-in-regex.js";

export function makeLexContext() {
    return {
        tokens:        [],
        currentMode:   initialMode(),
        brackets:      makeBracketStack(),
        recovery:      makeRecovery(),
        // Per-lex-call stack of template-interpolation frames. Each frame
        // tracks the bracket-stack depth at the moment a `${` opened so
        // that the matching `}` can be recognized as TemplateInterpEnd
        // (per §51.0.Q.1 nested-engine pattern; see lex-in-template.js).
        templateStack: [],
    };
}

export function lex(source) {
    const cursor = makeCursor(source);
    const ctx = makeLexContext();

    const maxIters = (source.length + 1) * 4;
    let iters = 0;

    while (!isEof(cursor) && iters < maxIters) {
        const mode = getMode(ctx);
        const beforePos = cursor.pos;

        // Dispatch by LexMode — each non-InCode mode owns its own dispatcher
        // per the §51.0.F rule= contract on its state-child. The
        // dispatcher is responsible for transitioning back to InCode (or
        // staying-in-template for the InTemplateBody → interp → back loop).
        if (mode === LexMode.InCode) {
            dispatchInCode(cursor, ctx);
        } else if (mode === LexMode.InSingleString) {
            dispatchInSingleString(cursor, ctx);
        } else if (mode === LexMode.InDoubleString) {
            dispatchInDoubleString(cursor, ctx);
        } else if (mode === LexMode.InTemplateBody) {
            dispatchInTemplateBody(cursor, ctx);
        } else if (mode === LexMode.InLineComment) {
            dispatchInLineComment(cursor, ctx);
        } else if (mode === LexMode.InBlockComment) {
            dispatchInBlockComment(cursor, ctx);
        } else if (mode === LexMode.InRegexBody) {
            dispatchInRegexBody(cursor, ctx);
        } else {
            // M1 ladder complete — all 7 LexMode state-children have
            // substantive body dispatchers wired above. This branch is
            // a defensive safety net for an unreachable future mode.
            setMode(ctx, LexMode.InCode);
        }

        if (cursor.pos === beforePos && !isEof(cursor)) {
            cursor.pos = cursor.pos + 1;
        }
        iters = iters + 1;
    }

    const last = ctx.tokens.length > 0 ? ctx.tokens[ctx.tokens.length - 1] : null;
    if (last === null || last.kind !== TokenKind.EOF) {
        ctx.tokens.push(makeEof(cursor.pos, cursor.line, cursor.col));
    }

    return ctx.tokens;
}
