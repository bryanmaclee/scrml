// parse-stmt.js — JS-host shadow of parse-stmt.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-stmt.scrml's header — see that file.
//
// SCOPE — M3.1 + M3.2 + M3.3 + M3.4 (the four sub-steps of M3, the JS
// statement parser — M3.4 completes the M3 milestone) + M4.1 (the
// async/generator scope-threading: see the M4.1 note below).
//   M3.1: STATEMENT SUBSTRATE + DECLARATIONS + BLOCK/EXPRESSION STATEMENTS
//   + BlockStub RE-ENTRY. Parses, per S98 DD §D5's MUST-PARSE list:
//     - variable declarations `let` / `const` / `var`, INCLUDING object +
//       array destructuring patterns (real binding patterns — see ast-stmt's
//       binding catalog; §D5: "`collectBindingIdentifiers` walks these");
//     - expression statements `expr ;` (with ASI);
//     - block statements `{ stmt* }`;
//     - the empty statement `;`.
//   M3.1 also builds the BlockStub re-entry mechanism (parseBlockStubBody) —
//   M2.3 left function/arrow block bodies, and M2.4 left match-arm block
//   bodies, as `BlockStub` Expr nodes capturing a token range. M3.1 re-parses
//   any BlockStub's captured tokens into a real Stmt list.
//
//   M3.2: CONTROL-FLOW STATEMENTS. Parses, per S98 DD §D5's MUST-PARSE
//   control-flow rows:
//     - `if` / `else` (incl. `else if` chains);
//     - `while`, `do`-`while`;
//     - `for` (C-style three-clause), `for`-`in`, `for`-`of` (incl.
//       `for await ... of`);
//     - `return`, `break`, `continue` (the no-LineTerminator restricted
//       production gates the optional argument / label);
//     - labels + labeled statements (`label: stmt`).
//   The classic `for`-head ambiguity (C-style vs for-in vs for-of) is
//   resolved by forHeadKind — a depth-0 scan of the head (bounded lookahead,
//   single-direction commit; DD §D4 P3 — no general backtracking).
//
//   M3.3: FUNCTIONS / CLASSES + IN-LINE BODIES (subsumes BPP) + IMPORT/EXPORT
//   + TRY/THROW. Parses, per S98 DD §D5's MUST-PARSE declaration + module +
//   try/throw rows:
//     - function declarations `function name(params) { body }`, INCLUDING
//       `async function` and `function*` generators — the body is parsed
//       IN-LINE via parseStatementList. This is THE body-pre-parser
//       subsumption: M3 parses function bodies in-line, so body-pre-parser.ts
//       deletes by construction (DD §D7 M3 gating).
//     - class declarations `class Name extends Base { ... }` — methods
//       (incl. constructor / static / get/set / async / generator /
//       computed-name) + class fields; method bodies parsed in-line.
//     - `import` / `export` — named / default / namespace / re-export.
//     - `try` / `catch` / `finally` + `throw` — PARSED for legacy +
//       JS-import inputs; per S98 D5 these are REJECTED from scrml SOURCE (a
//       later stage — the typer — does the source-rejection; scrml uses
//       `fail`/`!{}` per SPEC §19). The parser's job is to PARSE them.
//   M3.3 also TIES OFF the function-expression body seam — a function /
//   arrow EXPRESSION appearing at statement position (an expression
//   statement, a declarator initializer) has its BlockStub body re-entered
//   in-line via reenterBlockStubs (the M3.1 deep-walk).
//
//   M3.4: ERROR-RECOVERY ENGINE INTEGRATION + RETURN-LEGALITY + FULL STATEMENT
//   CONFORMANCE — the FINAL M3 sub-step. Per S98 DD §D7 M3 gating:
//     - PANIC-MODE RE-SYNCHRONIZATION. parseStatementList drives the M1
//       ErrorRecovery engine (error-recovery.js) when parseStatement makes no
//       forward progress: accumulate skipped tokens into the engine's
//       .AccumulatingSkipped payload, re-synchronize on `;` / a statement-start
//       keyword / a closing `}` (the canonical statement-grammar sync points),
//       then resume. This REPLACES M3.1's placeholder forced-advance guard.
//     - RETURN-LEGALITY. A `ctx.functionDepth` counter (a function-body
//       NESTING count — a single-slot ParseMode cannot tell function-scope
//       from program-scope across nested `{}` blocks) drives the
//       return-outside-function check: a top-level `return` fires
//       E-STMT-RETURN-OUTSIDE-FUNCTION (the seam M3.3 flagged, now closed).
//
//   M4.1: ASYNC / GENERATOR SCOPE THREADING (the M3.3 forward seam, now
//   closed). `await` / `yield` are now operators INSIDE a larger expression
//   (`let x = await f()`, `return await g()`, `const y = yield* gen()`) —
//   the M2 expression grammar handles them (parse-expr's parseUnary /
//   parseYieldExpr). parse-stmt's role at M4.1:
//     - the shared parser context carries `inAsync` / `inGenerator`
//       (makeParseStmtContext); parseFunctionBodyInline saves+sets+restores
//       them around an in-line body (the same shape as its functionDepth
//       inc/dec); a function ESTABLISHES its own scope;
//     - parseBlockStubBody seeds the scope from the enclosing function so a
//       re-entered function/arrow body sees `await`/`yield` as operators;
//       reenterBlockStubs threads each Function/Arrow node's flags into the
//       re-entry;
//     - the M3.3 dedicated statement-lead `await`/`yield` parsers are
//       DELETED — an `await x;` statement is now an expression statement,
//       parseExprStatement handles it via the unified expression grammar.
//   A statement form outside the D5 subset (`switch`, `with`, decorators)
//   records E-PARSER-OUT-OF-SUBSET (D5/OQ6 — the subset bound).
//
// The expression sub-grammar is M2's. parse-stmt shares ONE parser context
// object with parse-expr — `{ cursor, currentParseMode, errors, inAsync,
// inGenerator }` is the shared core makeParseExprContext produces (M3.4's
// `recovery` + `functionDepth` slots are statement-parser-only — parse-expr
// never reads them) — so parseExpression(ctx) runs directly on the statement
// parser's ctx with no token-range copy (R1 one-cursor discipline, applied
// within the JS layer).

import {
    makeTokenCursor, current, currentKind, advance, atEnd,
    peek, peekKind,
} from "./token-cursor.js";
import { TokenKind, makeEof } from "./token.js";
import { makeSpan } from "./span.js";
import {
    ParseMode, initialParseMode, setParseMode, enterMode, exitMode,
} from "./parse-mode.js";
import {
    parseExpression, parseAssignmentExpr, parsePostfix,
    parseParamList,
    // M4.2 — binding-pattern parsing is hosted by parse-expr (the K6
    // unification: parseParamTarget needs parseBinding too).
    parseBinding, parseBindingIdent, parseObjectPattern, parseArrayPattern,
    // M4.2 — `noIn` scope helpers (the for-head deferral closure).
    enterNoInScope, exitNoInScope,
} from "./parse-expr.js";
import {
    VarDeclKind, MethodKind,
    makeBlock, makeExprStmt, makeEmpty, makeVarDecl, makeVarDeclarator,
    makeBindingIdent, makeObjectPattern, makeArrayPattern,
    makeAssignmentPattern,
    makeBindingPropertyKeyValue, makeBindingPropertyShorthand,
    makeBindingPropertyRest,
    makeBindingElementItem, makeBindingElementHole, makeBindingElementRest,
    makeIf, makeWhile, makeDoWhile, makeFor, makeForIn, makeForOf,
    makeReturn, makeBreak, makeContinue, makeLabeled,
    makeFunctionDecl, makeClassDecl, makeImport, makeExport, makeTry, makeThrow,
    makeMethodDef, makePropertyDef,
    makeImportNamed, makeImportDefault, makeImportNamespace,
    makeExportSpecifier, makeCatchClause,
    // M5-swap Wave 1 — core scrml declaration node constructors (B4 / B5).
    makeLinDecl, makeTypeDecl,
    // M5-swap Wave 2 — `~` tilde-declaration node constructor (B3).
    makeTildeDecl,
    // M6.7-D7 — `given` presence-guard node constructor (SPEC §42.2.3).
    makeGivenGuard,
} from "./ast-stmt.js";
import {
    SyncToken,
    makeRecovery, beginRecovery, accumulateSkipped, markResync, resumeNormal,
} from "./error-recovery.js";

// --- makeParseStmtContext — statement-parser context constructor ---
// SHAPE compatible with makeParseExprContext (parse-expr.js) — `cursor` +
// `currentParseMode` + `errors` + `inAsync` + `inGenerator` are the shared
// core, so parseExpression(ctx) runs directly on this ctx; the cursor is the
// one cursor both layers walk. M3.4 added two STATEMENT-parser-only slots
// (parse-expr never reads them):
//   - `recovery` — the M1 ErrorRecovery engine's live-surface struct
//     (error-recovery.js). Panic-mode statement re-synchronization writes it.
//   - `functionDepth` — a function-body NESTING counter. `parseReturn`
//     consults it for the return-outside-function legality check; a single
//     `currentParseMode` slot cannot tell function-scope from program-scope
//     across nested `{}` blocks (a `return` in a nested block sees `.InBlock`,
//     not `.InFunctionBody`). 0 = program scope; >= 1 = inside N function
//     bodies. parseFunctionBodyInline increments / decrements it.
// M4.1 — `inGenerator` is part of the SHARED core (parse-expr's
// parseAssignmentExpr reads it to decide when `yield` is an operator).
// parseFunctionBodyInline saves+sets+restores it around a function body —
// the same shape as its functionDepth inc/dec. M4.3 retracted the sibling
// `inAsync` slot (no source-level `async`/`await`).
// MK4 — `source` is OPTIONAL. When the statement-parser is invoked through
// the markup->JS delegate-down direction (parse-markup.js's
// parseLogicBodyBestEffort) on a logic-escape body slice, the body source
// text is passed in so a nested markup-as-value (`<div/>` inside the body)
// can be parsed back through the markup layer (R1 spike §1.2 JS->markup
// delegate-up). When parseProgram is called without a source (the
// conformance harness's parseProgram(tokens) one-arg entry), the JS->markup
// path falls back to the token-range capture (a BlockStub-shape MarkupValue).
export function makeParseStmtContext(tokens, source) {
    return {
        cursor:           makeTokenCursor(tokens),
        currentParseMode: initialParseMode(),
        errors:           [],
        recovery:         makeRecovery(),
        functionDepth:    0,
        inGenerator:      false,
        // M6.5.b.2.1 — `atStateDeclStmtPos` is shared with the expr parser
        // (parse-expr's makeParseExprContext carries the same slot). This
        // statement-driven context (parseProgram / parseStatementList) is the
        // primary bug path: it threads the SAME ctx into parseBinary, which
        // reads the flag to stop the `<` climb at a newline-then-state-decl
        // boundary. Initialized false here (mirroring `inGenerator`); set true
        // only around a state-decl initializer / a bare expression statement.
        atStateDeclStmtPos: false,
        source:           source ?? null,
    };
}

// recordError — push a structured diagnostic. Mirrors parse-expr.js's
// recordError exactly (the diagnostic stream is { code, message, span }).
export function recordError(ctx, code, message, span) {
    ctx.errors.push({ code, message, span });
}

// spanHere — the span of the token at the cursor, or a safe zero span past
// EOF. Used for diagnostics where no node span is available.
function spanHere(ctx) {
    const here = current(ctx.cursor);
    if (here === undefined || here === null) {
        return makeSpan(0, 0, 1, 1);
    }
    return here.span;
}

// nodeStart / nodeEnd / nodeLine / nodeCol — defensive node-span reads (a
// malformed parse can yield a null child). Mirror parse-expr.js's
// startOf / endOf / lineOf / colOf.
function nodeStart(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 0;
    }
    return node.span.start;
}
function nodeEnd(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 0;
    }
    return node.span.end;
}
function nodeLine(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 1;
    }
    return node.span.line;
}
function nodeCol(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 1;
    }
    return node.span.col;
}

// =============================================================================
// ASI — automatic semicolon insertion.
//
// The M1 lexer does NOT emit Newline / Whitespace tokens (it filters them) —
// so a parser cannot see a newline as a token. ECMAScript ASI inserts a `;`
// at the end of a statement when the next token (a) is on a LATER source line
// than the just-consumed token, (b) is `}`, or (c) is EOF. The lexer keeps a
// `.span.line` on every token, which is the line signal ASI needs.
//
// consumeSemicolon consumes an explicit `;` if present; otherwise it accepts
// the statement boundary when an ASI condition holds, and records a
// diagnostic only when neither an explicit `;` nor an ASI condition is met.
// =============================================================================

// lineOfToken — the 1-based source line of a token (1 if absent).
function lineOfToken(tok) {
    if (tok === undefined || tok === null || tok.span === undefined || tok.span === null) {
        return 1;
    }
    return tok.span.line;
}

// canInsertSemicolon — is an ASI condition satisfied at the cursor, given the
// last token of the statement just parsed (`prevTok`)? True when the next
// token is `}`, is EOF, or sits on a later line than `prevTok`.
export function canInsertSemicolon(ctx, prevTok) {
    const cursor = ctx.cursor;
    if (atEnd(cursor)) {
        return true;
    }
    const kind = currentKind(cursor);
    if (kind === TokenKind.RBrace) {
        return true;
    }
    const here = current(cursor);
    if (here === undefined || here === null) {
        return true;
    }
    return lineOfToken(here) > lineOfToken(prevTok);
}

// consumeSemicolon — consume the statement terminator. An explicit `;` is
// consumed. Otherwise, if an ASI condition holds the boundary is accepted
// silently. If neither, a missing-terminator diagnostic is recorded (the
// parser does NOT throw — diagnostics are structured, per the stage contract)
// and the parser continues. `prevTok` is the last token of the statement.
export function consumeSemicolon(ctx, prevTok) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.Semicolon) {
        advance(cursor);   // consume the explicit ;
        return;
    }
    if (canInsertSemicolon(ctx, prevTok)) {
        return;            // ASI — boundary accepted
    }
    recordError(ctx, "E-STMT-MISSING-SEMICOLON",
        "expected ';' or a newline to end the statement", spanHere(ctx));
}

// lastTokenBefore — the token immediately before the cursor (the last token
// the parse consumed). Used as the `prevTok` argument to consumeSemicolon.
function lastTokenBefore(ctx) {
    const cursor = ctx.cursor;
    if (cursor.idx <= 0) {
        return current(cursor);
    }
    return cursor.tokens[cursor.idx - 1];
}

// =============================================================================
// Panic-mode re-synchronization — the M1 ErrorRecovery engine, statement-level.
//
// When parseStatement makes NO forward progress (returns null AND consumes no
// token), the cursor is parked on a token that begins no statement — a parse
// error. M3.4 drives the M1 ErrorRecovery engine through its three-state
// panic-mode cycle (error-recovery.js):
//
//   .ParsingNormally --beginRecovery--> .AccumulatingSkipped
//   .AccumulatingSkipped --accumulateSkipped--> .AccumulatingSkipped (self-loop)
//   .AccumulatingSkipped --markResync--> .ReSynchronized
//   .ReSynchronized --resumeNormal--> .ParsingNormally
//
// resyncStatement skips tokens — accumulating each into the .AccumulatingSkipped
// variant's `skipped` payload — until it reaches one of the canonical
// statement-grammar SYNC TOKENS (the panic-mode resync points named in the
// S98 D7 M3 gating criterion):
//
//   - `;`                — a statement terminator. CONSUMED; resync point is
//                          PAST it (the next statement starts fresh).
//   - a statement-start  — a keyword (or `{` block opener) that begins a new
//     keyword               statement. The resync point is BEFORE it, so the
//                          enclosing loop re-attempts parseStatement there.
//   - `}`                — a closing brace: the enclosing block's own
//                          terminator OR an outer block's. NOT consumed; the
//                          resync point is BEFORE it so the block can close.
//   - EOF                — the token stream's end.
//
// The accumulated `skipped` payload is the engine's record of what panic-mode
// discarded; a regression test asserts a malformed run accumulates skipped
// tokens, re-synchronizes, and the parser resumes (S98 D7 M3 gating).
// =============================================================================

// STATEMENT_START_KINDS — the token kinds that begin a fresh statement. A
// panic-mode skip re-synchronizes (BEFORE the token) when it reaches one of
// these — the enclosing parseStatementList loop then re-attempts a clean
// parse from that statement-start keyword. The set is the D5 statement-lead
// keywords plus `{` (a block opener at statement position).
const STATEMENT_START_KINDS = Object.freeze({
    [TokenKind.LBrace]:    true,
    [TokenKind.KwLet]:     true,
    [TokenKind.KwConst]:   true,
    [TokenKind.KwVar]:     true,
    [TokenKind.KwIf]:      true,
    [TokenKind.KwFor]:     true,
    [TokenKind.KwWhile]:   true,
    [TokenKind.KwDoWhile]: true,
    [TokenKind.KwReturn]:  true,
    [TokenKind.KwBreak]:   true,
    [TokenKind.KwContinue]:true,
    [TokenKind.KwFunction]:true,
    [TokenKind.KwClass]:   true,
    [TokenKind.KwImport]:  true,
    [TokenKind.KwExport]:  true,
    [TokenKind.KwTry]:     true,
    [TokenKind.KwThrow]:   true,
    // M5-swap Wave 1 — core scrml declaration statement leads (B4 / B5 / B6).
    // P5-9 — `type` is NOT here: it lexes as an `Ident` (a contextual keyword),
    // so a panic-mode resync that lands on a `type` decl re-syncs on the
    // `Ident` token-kind path; `isStatementStartKind` cannot key on a `KwType`
    // that the tokenizer no longer emits. A `type`-led declaration that begins
    // a fresh statement is still recovered — the resync stops before it on the
    // next `;` / `}` / hard statement-start keyword and the loop re-attempts.
    [TokenKind.KwLin]:     true,
    [TokenKind.KwFn]:      true,
    [TokenKind.KwServer]:  true,
    [TokenKind.KwPure]:    true,
});

// isStatementStartKind — calculation (predicate): does `kind` begin a fresh
// statement? A panic-mode skip resyncs in place when it reaches one.
function isStatementStartKind(kind) {
    return STATEMENT_START_KINDS[kind] === true;
}

// resyncStatement — drive the ErrorRecovery engine's panic-mode cycle. The
// caller has already recorded the parse-error diagnostic; this function does
// the token-skipping. Starting from a stuck cursor, accumulate skipped tokens
// into the engine's payload until a sync token is reached, then return the
// engine to .ParsingNormally. The cursor is left ON the resync point (before
// a `}` / a statement-start keyword / EOF) or PAST a consumed `;`.
function resyncStatement(ctx) {
    const cursor = ctx.cursor;
    const recovery = ctx.recovery;

    beginRecovery(recovery);   // .ParsingNormally -> .AccumulatingSkipped

    while (atEnd(cursor) === false) {
        const kind = currentKind(cursor);

        // `;` — a statement terminator. Accumulate it, consume it, and resync
        // PAST it: the next statement starts on the token after the `;`.
        if (kind === TokenKind.Semicolon) {
            accumulateSkipped(recovery, current(cursor));
            advance(cursor);
            markResync(recovery, SyncToken.Semicolon);   // -> .ReSynchronized
            resumeNormal(recovery);                       // -> .ParsingNormally
            return;
        }

        // `}` — a closing brace. The enclosing block (or an outer block) ends
        // here. Do NOT consume it (the block parser owns the `}`); resync
        // BEFORE it.
        if (kind === TokenKind.RBrace) {
            markResync(recovery, SyncToken.ClosingBrace);
            resumeNormal(recovery);
            return;
        }

        // A statement-start keyword / `{` block opener — a fresh statement
        // begins here. Resync BEFORE it so the loop re-attempts a clean parse.
        if (isStatementStartKind(kind)) {
            markResync(recovery, SyncToken.NewlineAtStmtBoundary);
            resumeNormal(recovery);
            return;
        }

        // Not a sync token — accumulate it into the engine's `skipped`
        // payload and advance (the .AccumulatingSkipped self-loop).
        accumulateSkipped(recovery, current(cursor));
        advance(cursor);
    }

    // The token stream ended before any other sync token was reached.
    markResync(recovery, SyncToken.EofToken);
    resumeNormal(recovery);
}

// =============================================================================
// Statement-list parsing — the trampoline.
// =============================================================================

// parseStatementList — parse a run of statements until the cursor reaches a
// terminator token kind (RBrace for a block body) or EOF. Returns a Stmt
// array. When parseStatement makes NO forward progress (returns null and
// consumes nothing), the cursor is parked on a token that begins no statement
// — a parse error: M3.4 records the diagnostic and drives the M1 ErrorRecovery
// engine's panic-mode re-synchronization (resyncStatement) to skip to the next
// statement boundary, so a malformed token cannot spin the loop AND the parser
// resumes cleanly at the next `;` / statement-start keyword / closing `}`.
export function parseStatementList(ctx, terminatorKind) {
    const cursor = ctx.cursor;
    const body = [];

    while (atEnd(cursor) === false) {
        if (terminatorKind !== undefined && terminatorKind !== null
            && currentKind(cursor) === terminatorKind) {
            break;
        }
        const before = cursor.idx;
        const stmt = parseStatement(ctx);
        if (stmt !== undefined && stmt !== null) {
            body.push(stmt);
        }
        // Forward-progress check — if parseStatement consumed nothing, the
        // cursor is stuck on a token that begins no statement. Record the
        // parse error and drive the ErrorRecovery engine's panic-mode resync.
        if (cursor.idx === before) {
            recordError(ctx, "E-STMT-UNEXPECTED-TOKEN",
                "unexpected token — no statement begins here", spanHere(ctx));
            resyncStatement(ctx);
            // resyncStatement leaves the cursor ON the resync point. If that
            // point is the enclosing block's own terminator, the next loop
            // iteration's terminator check breaks out cleanly. If it is a
            // statement-start keyword the loop re-attempts a clean parse. If
            // resync made no progress at all (the stuck token was itself a
            // `}` that is NOT this list's terminator — e.g. a stray `}`),
            // force one advance so the loop cannot spin.
            if (cursor.idx === before) {
                advance(cursor);
            }
        }
    }
    return body;
}

// parseStatement — parse ONE statement; dispatch on the token kind at the
// cursor. M3.1 dispatches the substrate forms (declarations, block, empty,
// expression statement). M3.2 dispatches the control-flow forms + labeled
// statements. M3.3 dispatches the declaration / module / legacy-error
// statement forms (`function`/`class`/`import`/`export`/`try`/`throw`,
// `async function`, and `await`/`yield` statement leads).
export function parseStatement(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(ctx.cursor);

    // The empty statement — a lone `;`.
    if (kind === TokenKind.Semicolon) {
        return parseEmptyStatement(ctx);
    }

    // P5-3 — a `^{ ... }` meta block at statement position. A `^{}` meta
    // block (SPEC §40) can open the body of a `${...}` logic escape — the
    // self-host files do exactly this. The `^` lexes as `BitXor`; without
    // this branch a `^` at statement head routes to parseExprStatement and
    // stalls (no left operand), bailing the whole statement loop. Checked
    // BEFORE the bare `LBrace` block branch — the `^` must be consumed so
    // the `{ ... }` body parses as the meta block's body, not a stray block.
    if (kind === TokenKind.BitXor && metaBlockLeadFollows(cursor)) {
        return parseMetaBlock(ctx);
    }

    // A block statement — `{`. At STATEMENT position a `{` always opens a
    // block (an object literal is an expression-position `{` — the ParseMode
    // engine carries this distinction). No expression statement may begin
    // with `{` (ECMAScript's lookahead restriction); so a `{` here is
    // unambiguously a block.
    if (kind === TokenKind.LBrace) {
        return parseBlock(ctx);
    }

    // M6.5.b.2 — `const <NAME ...> = expr` SPEC §6.6 derived state-decl form.
    // The `const` keyword is followed by a `<` IDENT structural-decl opener;
    // route into parseStructuralStateDecl with isConst=true BEFORE the generic
    // `let`/`const`/`var` path (which would consume `const` and then fail on
    // the `<` as a non-binding LHS, producing a const-decl{name:""}). Mirrors
    // the live ast-builder.js:4828 dispatch.
    if (kind === TokenKind.KwConst && peekKind(ctx.cursor, 1) === TokenKind.LessThan) {
        // peek the rest of the lookahead from the perspective of the `<` —
        // we need to advance past `const` first, OR use a separate predicate.
        // Simpler: peek 2 tokens to confirm `<` IDENT, then run the existing
        // structural lead predicate on a synthesised cursor view.
        if (constStructuralStateDeclLeadFollows(ctx.cursor)) {
            advance(ctx.cursor);   // consume `const`
            return parseStructuralStateDecl(ctx, true);
        }
    }

    // A variable declaration — `let` / `const` / `var`.
    if (kind === TokenKind.KwLet || kind === TokenKind.KwConst || kind === TokenKind.KwVar) {
        return parseVarDecl(ctx);
    }

    // M5-swap Wave 1 — a `lin` linear-binding declaration (B4, SPEC §35.2).
    // `lin` takes the same statement position as `let` / `const`.
    if (kind === TokenKind.KwLin) {
        return parseLinDecl(ctx);
    }

    // M5-swap Wave 1 — a `type` declaration (B5, SPEC §14).
    //
    // P5-9 — `type` is a CONTEXTUAL keyword (token.js CONTEXTUAL_KEYWORDS): it
    // lexes as an `Ident` carrying a `ctxKw:"type"` marker, not a hard
    // `KwType`. It is a type-declaration lead ONLY here, at statement position
    // — the live block-splitter's `STMT_KEYWORDS` set treats statement-lead
    // `type` as a declaration keyword unconditionally, and the native parser
    // mirrors that oracle. Anywhere else (a `const type =` binding name, a
    // `fn g(type)` parameter name, an object-literal key) the same token flows
    // as an ordinary identifier — those positions never reach this dispatch.
    // This check sits BEFORE the labeled-statement arm so a kind-first
    // `type:enum Name` lead is not mis-read as a `type:`-prefixed label.
    if (isContextualTypeLead(cursor)) {
        return parseTypeDecl(ctx);
    }

    // M5-swap Wave 2 — a `~name = pipeline` tilde declaration (B3, SPEC §32).
    // `~` lexes as a `BitNot` token. `tildeDeclLeadFollows` confirms the
    // `~ Ident =` declaration shape before committing — a `~` used as a
    // prefix bitwise-NOT (`~x`) or as the §32 standalone accumulator atom
    // falls through to the expression-statement arm (parseExprStatement /
    // parsePrimary build those). The disambiguation is source-adjacency +
    // the trailing `=`: a tilde-DECLARATION is `~` adjacent to an identifier
    // that is immediately assigned.
    if (kind === TokenKind.BitNot && tildeDeclLeadFollows(cursor)) {
        return parseTildeDecl(ctx);
    }

    // M6.7-D7 — a `given x [, y]* => { body }` presence guard (SPEC §42.2.3).
    // `given` is a hard keyword (token.js KwGiven). The live ast-builder
    // (ast-builder.js:5485 / 9477) recognizes a statement-position `given`
    // KEYWORD as the presence-guard lead unconditionally (it is in the live
    // STMT_KEYWORDS set); the native parser mirrors that. Without this arm a
    // statement-position `given` fell through to parseExprStatement, where
    // KwGiven is not a valid expression head (parsePrimary has no arm) — native
    // fired E-EXPR-UNEXPECTED:KwGiven + E-STMT-MISSING-SEMICOLON +
    // E-STMT-UNEXPECTED-TOKEN, bailing the whole `${...}` logic block. The same
    // production runs inside a `match { ... }` arm body (the match body uses the
    // shared statement-list parser), so this one arm closes BOTH the standalone
    // and the in-match given positions (subsumes the D3b follow-on). An
    // expression-position `given` is unaffected — no parsePrimary arm exists, so
    // a bare `given` identifier use (rare; §4.11.4 admits it) still falls
    // through to the expression path exactly as before this change.
    if (kind === TokenKind.KwGiven) {
        return parseGivenGuard(ctx);
    }

    // --- M3.2 control-flow keyword leads ---
    if (kind === TokenKind.KwIf) {
        return parseIf(ctx);
    }
    if (kind === TokenKind.KwWhile) {
        return parseWhile(ctx);
    }
    if (kind === TokenKind.KwDoWhile) {
        return parseDoWhile(ctx);
    }
    if (kind === TokenKind.KwFor) {
        return parseFor(ctx);
    }
    if (kind === TokenKind.KwReturn) {
        return parseReturn(ctx);
    }
    if (kind === TokenKind.KwBreak) {
        return parseBreak(ctx);
    }
    if (kind === TokenKind.KwContinue) {
        return parseContinue(ctx);
    }

    // A stray `else` with no matching `if` — a syntax error. M3.2 records a
    // diagnostic and consumes the keyword so the parser does not spin.
    if (kind === TokenKind.KwElse) {
        recordError(ctx, "E-STMT-STRAY-ELSE",
            "'else' with no matching 'if'", spanHere(ctx));
        advance(cursor);
        return null;
    }

    // A labeled statement — `label: stmt`. At statement position an
    // identifier followed by a `:` is a label (no statement begins with an
    // object literal). `Ident :: ...` is the `Type::Variant` form (two
    // adjacent `:` tokens) — that is an expression statement, NOT a label, so
    // the token after the `:` must NOT be another `:`.
    if (kind === TokenKind.Ident
        && peekKind(cursor, 1) === TokenKind.Colon
        && peekKind(cursor, 2) !== TokenKind.Colon) {
        return parseLabeledStatement(ctx);
    }

    // --- M3.3 declaration / module / legacy-error keyword leads ---

    // A function declaration — `function name(params) { body }`. A bare
    // `function` keyword at statement position is always a DECLARATION (a
    // function EXPRESSION at statement position must be parenthesized — a
    // `function` lead can never begin an expression statement, ECMAScript's
    // lookahead restriction). `function*` is a generator declaration.
    if (kind === TokenKind.KwFunction) {
        return parseFunctionDecl(ctx, false);
    }

    // M5-swap Wave 1 (B6, SPEC §48 / §48.6.4) — a modifier-led function
    // declaration with optional `server` / `pure` prefixes. M6.7-D2 extended
    // this to the `function` keyword (§7 / §12 / §52): `fnDeclLeadFollows`
    // confirms a `fn` / `server fn` / `pure fn` / `pure server fn` lead OR a
    // `server function` / `pure function` / `pure server function` lead before
    // committing. A bare `function` is handled by the KwFunction arm above; a
    // bare `server` / `pure` not leading to `fn`/`function` falls through to the
    // expression-statement arm (a rare bare identifier use). parseScrmlFunctionDecl
    // reads which keyword follows to set the `fnKind` discriminator.
    if ((kind === TokenKind.KwFn || kind === TokenKind.KwServer || kind === TokenKind.KwPure)
        && fnDeclLeadFollows(cursor)) {
        return parseScrmlFunctionDecl(ctx, false);
    }

    // M6.7-C2 — the `server @var = expr` cell-authority state declaration (SPEC
    // §52.4, the legacy `@`-form authority modifier). Live's ast-builder
    // (ast-builder.js:4879) recognizes a `server` KEYWORD immediately followed by
    // an `@`-ident as a server-authoritative reactive `state-decl`
    // (`isServer: true`). D2 already routes `server` leading to a `fn`/`function`
    // into parseScrmlFunctionDecl; a `server` leading to `@` is the DISTINCT cell
    // authority production. Without this arm `server @x = e` falls through to the
    // expression-statement arm, where `server` (KwServer) is not a valid
    // expression head — native fired E-EXPR-UNEXPECTED + E-STMT-MISSING-SEMICOLON
    // + E-STMT-UNEXPECTED-TOKEN, the whole `${...}` logic block failed, and the
    // §8.11 mount-hydrate coalescing collector (collect.ts:549, which gates on
    // `state-decl{isServer:true}`) never saw the decl. The guard is precise — a
    // bare `server` not leading to `@` (or to `fn`/`function`, handled above)
    // still falls through, so a rare bare `server` identifier use is unaffected.
    // §52.4 is NOT deprecated (W-DEPRECATED-SERVER-MODIFIER is function-only).
    if (kind === TokenKind.KwServer && peekKind(cursor, 1) === TokenKind.ScrmlAt) {
        return parseServerAtStateDecl(ctx);
    }

    // M4.3 — RETRACTED. An `async function` declaration is no longer valid in
    // scrml. We fire E-ASYNC-NOT-IN-SCRML at the `async` keyword and recover
    // by parsing the form as a plain function declaration (the underlying
    // function still parses cleanly so error recovery surfaces useful
    // diagnostics on the rest of the program). Any other `async` lead
    // (`async ident =>`, `async ( ) =>`, a bare `async` identifier) reaches
    // parseExprStatement; parse-expr's parsePostfix fires the same code at
    // its own `async`-head dispatch.
    if (kind === TokenKind.KwAsync && peekKind(cursor, 1) === TokenKind.KwFunction) {
        const asyncTok = advance(cursor);   // consume `async`
        recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
            "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            asyncTok.span);
        return parseFunctionDecl(ctx, false);
    }

    // A class declaration — `class Name extends Base { ... }`. A bare `class`
    // keyword at statement position is a declaration (a class EXPRESSION
    // must be parenthesized / in an expression position).
    if (kind === TokenKind.KwClass) {
        return parseClassDecl(ctx);
    }

    // An `import` statement.
    if (kind === TokenKind.KwImport) {
        return parseImport(ctx);
    }

    // An `export` statement.
    if (kind === TokenKind.KwExport) {
        return parseExport(ctx);
    }

    // A `try` / `catch` / `finally` statement.
    if (kind === TokenKind.KwTry) {
        return parseTry(ctx);
    }

    // A `throw argument` statement.
    if (kind === TokenKind.KwThrow) {
        return parseThrow(ctx);
    }

    // An `await` / `yield` statement lead — `await x;` / `yield x;` inside an
    // async / generator body — is handled by parseExprStatement: the M4.1
    // expression grammar parses `await` (at unary precedence, gated on
    // M4.3 RETRACTED `await`/`async`) and `yield` / `yield*` (at assignment precedence, gated
    // on `ctx.inGenerator`) AS operators, so an `await x;` statement is just
    // an expression statement wrapping an Await node. M3.3 had a dedicated
    // statement-lead path here; M4.1 unifies statement-position and
    // operator-position `await`/`yield` into the single expression-grammar
    // implementation (parse-expr's parseUnary / parseYieldExpr). NO `KwAwait`
    // / `KwYield` branch is needed — parseExprStatement covers them.

    // P5-11 — a V5-strict structural state-decl: `<NAME ...> = expr` (SPEC
    // §6.2 Shape 1 / §35.2 typed). A `<` lexes as `LessThan`; without this
    // arm a `<NAME> = expr` line falls through to parseExprStatement and
    // parse-expr's `parseMarkupValue` over-consumes the rest of the `${...}`
    // body as one markup blob. `structuralStateDeclLeadFollows` confirms the
    // `<` IDENT opener whose `>` (or fused `>=`) is followed by a `=` / `:`
    // decl signal — it declines for an ordinary markup-as-value `<div>...</>`
    // (a markup tag's `>` is followed by content, not a decl signal), which
    // then flows to parseExprStatement. This sits BEFORE the expression-
    // statement fallthrough — the live oracle's `parseLogicBody` likewise
    // dispatches `tryParseStructuralDecl` ahead of its bare-expr default.
    if (kind === TokenKind.LessThan && structuralStateDeclLeadFollows(cursor)) {
        return parseStructuralStateDecl(ctx, false);
    }

    // Everything else is an expression statement.
    return parseExprStatement(ctx);
}

// --- parseEmptyStatement — a lone `;` ---
export function parseEmptyStatement(ctx) {
    const semi = advance(ctx.cursor);   // consume ;
    return makeEmpty(semi.span);
}

// --- parseBlock — a block statement `{ stmt* }` ---
// Enters .InBlock for the body, parses the statement list to the matching
// `}`, restores the prior ParseMode. The `}` is consumed; a missing `}`
// records a diagnostic (the parser does not throw).
export function parseBlock(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume {

    const prior = enterMode(ctx, ParseMode.InBlock);
    const body = parseStatementList(ctx, TokenKind.RBrace);
    exitMode(ctx, prior);

    let endSpan = open.span;
    if (currentKind(cursor) === TokenKind.RBrace) {
        const close = advance(cursor);   // consume }
        endSpan = close.span;
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-BLOCK",
            "expected '}' to close a block statement", open.span);
    }

    const span = makeSpan(open.span.start, endSpan.end, open.span.line, open.span.col);
    return makeBlock(body, span);
}

// --- parseExprStatement — an expression statement `expr ;` ---
// Parses a full (sequence-level) expression in expression context, then the
// statement terminator (explicit `;` or ASI). M3.3 ties off the
// function-expression body seam here — a function / arrow expression in the
// statement's expression has its BlockStub body re-entered in-line via
// reenterBlockStubs (so an IIFE / a callback at statement position gets a
// fully-parsed body, not a token-range stub).
export function parseExprStatement(ctx) {
    const prior = enterMode(ctx, ParseMode.InExpression);
    // M6.5.b.2.1 — set `atStateDeclStmtPos` around the statement expression.
    // This is the second statement-collector position (besides a state-decl
    // initializer): a bare expression statement followed on the NEXT LINE by a
    // `<NAME ...> =` state-decl opener (`foo()` newline `<y> = 1`) must NOT
    // over-consume the `<` as a relational operator into the bare expression.
    // parseBinary's LessThan guard reads this flag and STOPS at the boundary.
    // Cleared inside any grouped sub-expression by withInAllowedSubExpr, so a
    // `<` at nesting depth > 0 stays a comparison. Mirrors the universal
    // statement-collector scope of the live ast-builder collectExpr Step
    // 11.0b. Saved + restored (a nested parseExprStatement, e.g. inside a
    // re-entered BlockStub, restores correctly).
    const sdPrior = ctx.atStateDeclStmtPos;
    ctx.atStateDeclStmtPos = true;
    const expr = parseExpression(ctx);
    ctx.atStateDeclStmtPos = sdPrior;
    exitMode(ctx, prior);

    reenterBlockStubs(expr);   // M3.3 — tie off the function-expr body seam

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const startS = nodeStart(expr);
    const endTok = prevTok;
    const endE = (endTok === undefined || endTok === null) ? nodeEnd(expr) : endTok.span.end;
    const span = makeSpan(startS, Math.max(endE, nodeEnd(expr)), nodeLine(expr), nodeCol(expr));
    return makeExprStmt(expr, span);
}

// =============================================================================
// Variable declarations — `let` / `const` / `var`.
// =============================================================================

// --- parseVarDecl — a variable declaration ---
//   var-decl ::= ('let' | 'const' | 'var') declarator (',' declarator)* ';'
// Parses the declaration keyword, a comma-separated declarator list, and the
// statement terminator (explicit `;` or ASI).
export function parseVarDecl(ctx) {
    const cursor = ctx.cursor;
    const kwTok = advance(cursor);   // consume let / const / var
    const declKind = varDeclKindOf(kwTok.kind);

    const declarations = [];
    while (atEnd(cursor) === false) {
        const declarator = parseVarDeclarator(ctx);
        if (declarator === undefined || declarator === null) {
            break;
        }
        declarations.push(declarator);

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    let endE = kwTok.span.end;
    if (declarations.length > 0) {
        endE = nodeEnd(declarations[declarations.length - 1]);
    }
    const span = makeSpan(kwTok.span.start, endE, kwTok.span.line, kwTok.span.col);
    return makeVarDecl(declKind, declarations, span);
}

// varDeclKindOf — the VarDeclKind for a declaration-keyword TokenKind.
function varDeclKindOf(tokenKind) {
    if (tokenKind === TokenKind.KwConst) {
        return VarDeclKind.Const;
    }
    if (tokenKind === TokenKind.KwVar) {
        return VarDeclKind.Var;
    }
    return VarDeclKind.Let;
}

// --- parseVarDeclarator — one declarator: a binding target + optional init ---
//   declarator ::= binding (':' type-annotation)? ('=' assignment-expr)?
// A `const` declarator without an initializer is a use-site error (a later
// stage owns E-CONST-NO-INIT); M3.1 parses the shape and records a parse-level
// note for the obviously-missing initializer only.
//
// W7-Unit-C — typed-decl `let x: T = expr` / `const x: T = expr` (SPEC §35.2.1,
// §18 worked examples L9965, §19 L19790-92). Live's `collectTypeAnnotation`
// (ast-builder.js:3366) consumes a `:` annotation between the binding and the
// `=` / `,` / end-of-decl. Without this consume the cursor parks on `:` after
// the binding name, parseVarDecl finishes the declarator (init=null), then
// consumeSemicolon fails at `:` and the panic-mode resync walks forward token-
// by-token. Because the resync skips through hard-keyword-less recovery (P5-9
// made `type` a contextual Ident, not in STATEMENT_START_KINDS — see L347-352),
// a following `type Name :kind = …` decl can be DEVOURED by the resync, so
// `parseTypeDecl` is never re-entered and the corpus' typeDecl count goes
// missing on the native side. The phase1-type-vs-const-annotation-012 file is
// exactly this pattern.
export function parseVarDeclarator(ctx) {
    const cursor = ctx.cursor;
    const target = parseBinding(ctx);

    // Optional `:` type annotation. Token text is gathered raw — a precise
    // type-expression decomposition is the type-system's concern (the live
    // declarator carries `typeAnnotation` as a string blob; mirror that). The
    // scan stops at the FIRST top-level `=` (the initializer signal), `,` (the
    // declarator-list separator), or `;` (statement end). `()` / `{}` / `[]`
    // depths gate the "top-level" test so an annotation like `Pair<(A,B)>` or
    // `Record<{k:V}>` does not end the scan at an interior `,` / `=`.
    let typeAnnotation = "";
    if (currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        const annParts = [];
        let parenDepth = 0;
        let braceDepth = 0;
        let bracketDepth = 0;
        while (atEnd(cursor) === false) {
            const k = currentKind(cursor);
            const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
            if (topLevel && (k === TokenKind.Assign
                || k === TokenKind.Comma
                || k === TokenKind.Semicolon)) {
                break;
            }
            if (k === TokenKind.LParen) parenDepth = parenDepth + 1;
            else if (k === TokenKind.RParen) {
                if (parenDepth === 0) break;
                parenDepth = parenDepth - 1;
            }
            else if (k === TokenKind.LBrace) braceDepth = braceDepth + 1;
            else if (k === TokenKind.RBrace) {
                if (braceDepth === 0) break;
                braceDepth = braceDepth - 1;
            }
            else if (k === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
            else if (k === TokenKind.RBracket) {
                if (bracketDepth === 0) break;
                bracketDepth = bracketDepth - 1;
            }
            const annTok = advance(cursor);
            annParts.push(annTok.text === undefined || annTok.text === null ? "" : annTok.text);
        }
        typeAnnotation = annParts.join(" ").trim();
    }

    let init = null;
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume =
        const prior = enterMode(ctx, ParseMode.InExpression);
        init = parseAssignmentLevelExpr(ctx);
        exitMode(ctx, prior);
        // M3.3 — tie off the function-expression body seam: a declarator
        // initialized with a function / arrow expression (`let g =
        // function(){...}`) gets its BlockStub body re-entered in-line.
        reenterBlockStubs(init);
    }

    const endE = (init === undefined || init === null) ? nodeEnd(target) : nodeEnd(init);
    const span = makeSpan(nodeStart(target), endE, nodeLine(target), nodeCol(target));
    const declarator = makeVarDeclarator(target, init, span);
    if (typeAnnotation.length > 0) {
        declarator.typeAnnotation = typeAnnotation;
    }
    return declarator;
}

// parseAssignmentLevelExpr — parse a NON-comma expression (a declarator
// initializer stops at a `,` because the comma is the declarator separator).
// parse-expr exports parseExpression (sequence-level, includes commas); a
// declarator initializer needs assignment-level. parse-expr's
// parseAssignmentExpr is the element-position entry (it stops at a `,`) —
// imported at the file head and reused here.
function parseAssignmentLevelExpr(ctx) {
    return parseAssignmentExpr(ctx);
}

// =============================================================================
// Binding patterns — declaration-target destructuring.
//
// HOSTED IN parse-expr.js AS OF M4.2 — the K6 unification. parseParamTarget
// (an expression-parser function) needs parseBinding to emit a real binding
// node for a `{...}` / `[...]` parameter pattern; since parse-stmt already
// imports from parse-expr, the binding parser lives there to avoid a
// circular import. parse-stmt re-exports them (back-compat with any external
// caller).
// =============================================================================

// Re-export from parse-expr (M4.2 hosting).
export { parseBinding, parseBindingIdent, parseObjectPattern, parseArrayPattern };

// =============================================================================
// Control-flow statements — M3.2 (DD §D5 control-flow rows).
//
// if / else, while, do-while, for (C-style + for-in + for-of), return /
// break / continue, and labeled statements. A control-flow body is a
// statement POSITION — parseStatement parses it (a `{` body becomes a Block;
// a single un-braced statement is the body directly). The parser records
// structured diagnostics and never throws (the stage contract).
// =============================================================================

// expectLParen — consume a `(` that opens a control-flow head; record a
// diagnostic if absent (the parser parses on — it does not throw).
function expectLParen(ctx, ctxLabel) {
    if (currentKind(ctx.cursor) === TokenKind.LParen) {
        return advance(ctx.cursor);
    }
    recordError(ctx, "E-STMT-EXPECT-LPAREN",
        "expected '(' after '" + ctxLabel + "'", spanHere(ctx));
    return current(ctx.cursor);
}

// expectRParen — consume the `)` that closes a control-flow head; record a
// diagnostic if absent.
function expectRParen(ctx, ctxLabel) {
    if (currentKind(ctx.cursor) === TokenKind.RParen) {
        return advance(ctx.cursor);
    }
    recordError(ctx, "E-STMT-EXPECT-RPAREN",
        "expected ')' to close the '" + ctxLabel + "' head", spanHere(ctx));
    return current(ctx.cursor);
}

// parseParenCondition — parse the `( expr )` condition of an if / while /
// do-while. The condition is a full (sequence-level) expression.
function parseParenCondition(ctx, ctxLabel) {
    expectLParen(ctx, ctxLabel);
    const prior = enterMode(ctx, ParseMode.InExpression);
    const test = parseExpression(ctx);
    exitMode(ctx, prior);
    expectRParen(ctx, ctxLabel);
    return test;
}

// --- parseIf — an `if (test) consequent (else alternate)?` statement ---
// `else if` is just an `else` whose alternate is itself an If — the recursion
// through parseStatement builds the chain (Acorn's IfStatement shape: a
// nested IfStatement as the alternate).
export function parseIf(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `if`

    const test = parseParenCondition(ctx, "if");
    const consequent = parseStatement(ctx);

    let alternate = null;
    if (currentKind(cursor) === TokenKind.KwElse) {
        advance(cursor);   // consume `else`
        alternate = parseStatement(ctx);
    }

    const endNode = (alternate === null || alternate === undefined) ? consequent : alternate;
    const span = makeSpan(kw.span.start, nodeEnd(endNode), kw.span.line, kw.span.col);
    return makeIf(test, consequent, alternate, span);
}

// --- parseWhile — a `while (test) body` loop ---
export function parseWhile(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `while`

    const test = parseParenCondition(ctx, "while");
    const body = parseStatement(ctx);

    const span = makeSpan(kw.span.start, nodeEnd(body), kw.span.line, kw.span.col);
    return makeWhile(test, body, span);
}

// --- parseDoWhile — a `do body while (test) ;` loop ---
// ECMAScript inserts the trailing `;` of a do-while unconditionally — so the
// `;` is consumed when present and never required when absent.
export function parseDoWhile(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `do`

    const body = parseStatement(ctx);

    let endE = nodeEnd(body);
    if (currentKind(cursor) === TokenKind.KwWhile) {
        advance(cursor);   // consume `while`
    } else {
        recordError(ctx, "E-STMT-EXPECT-WHILE",
            "expected 'while' after the body of a 'do' loop", spanHere(ctx));
    }
    const test = parseParenCondition(ctx, "do-while");
    endE = nodeEnd(test);

    // The do-while terminator `;` is optional (ECMAScript's special ASI rule).
    if (currentKind(cursor) === TokenKind.Semicolon) {
        endE = advance(cursor).span.end;
    }

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeDoWhile(body, test, span);
}

// =============================================================================
// `for` — C-style, for-in, for-of. M4.2 — refactored to use the `noIn` flag
// (see parse-expr's enterNoInScope / exitNoInScope). The classic JS for-head
// ambiguity (C-style vs for-in vs for-of) is resolved by:
//   1. parse the init / LHS clause with noIn set — the `in` keyword is NOT
//      consumed as a binary operator (the parseBinary climber stops at it
//      when ctx.noIn is true), so the head parses up to the disambiguator.
//   2. look at the token at the cursor:
//        `;` -> C-style;  `in` -> for-in;  `of` -> for-of.
// The M3.2 forHeadKind depth-scan is gone (K6 / brief: "for-in head must be
// unambiguous without the depth-scan workaround"). Bounded lookahead is
// retained ONLY for the destructuring-LHS dispatch (see toBindingPattern):
// an Object/Array literal init that is followed by `in`/`of` is REINTERPRETED
// as a binding pattern (the K6-class non-declaration destructuring LHS) — the
// ESTree-standard toAssignable conversion.
// =============================================================================

// toBindingPattern — convert an Object/Array LITERAL expression (the shape
// parsePrimary produces for a top-level `{...}` / `[...]`) into the
// corresponding ObjectPattern / ArrayPattern binding shape. Used by the for-
// in/of head when the LHS parsed as an expression but the disambiguator (`in`
// / `of`) tells us it was meant as a binding pattern. The conversion is the
// ESTree-standard toAssignable transform (Acorn's coverInitializedName +
// destructuring-target rewrite): a top-level Object/Array literal whose
// elements are themselves bindable maps to ObjectPattern / ArrayPattern; a
// non-bindable element (a method, a numeric-key spread, etc.) records an
// E-STMT-FOR-NONBINDABLE-LHS diagnostic and a placeholder binding is used.
function toBindingPattern(node, ctx) {
    if (node === undefined || node === null) {
        return makeBindingIdent("", makeSpan(0, 0, 1, 1));
    }
    // Already a binding (e.g. a member expr / ident at expression level — those
    // are NOT converted, they remain expressions: a for-in LHS may be a member
    // expression `obj.k`, not a binding).
    if (node.bindingKind !== undefined) {
        return node;
    }
    if (node.kind === "Ident") {
        return makeBindingIdent(node.name, node.span);
    }
    if (node.kind === "Array") {
        const elements = [];
        for (const el of node.elements) {
            if (el.kind === "Hole") {
                elements.push(makeBindingElementHole());
            } else if (el.kind === "Spread") {
                elements.push(makeBindingElementRest(toBindingPattern(el.expression, ctx)));
            } else {
                // Item — `el.expression` is the element Expr.
                const inner = el.expression;
                if (inner !== undefined && inner !== null && inner.kind === "Assignment" && inner.op === "=") {
                    // A defaulted element `[x = 0]` parses as AssignmentExpression
                    // (`x = 0`) at expression level. Re-wrap as an AssignmentPattern.
                    const left = toBindingPattern(inner.target, ctx);
                    const apSpan = inner.span;
                    elements.push(makeBindingElementItem(makeBindingAssignmentPatternForFor(left, inner.value, apSpan)));
                } else {
                    elements.push(makeBindingElementItem(toBindingPattern(inner, ctx)));
                }
            }
        }
        return makeArrayPattern(elements, node.span);
    }
    if (node.kind === "Object") {
        const properties = [];
        for (const p of node.properties) {
            if (p.kind === "Spread") {
                properties.push(makeBindingPropertyRest(toBindingPattern(p.expression, ctx)));
            } else if (p.kind === "Shorthand") {
                // `{name}` — name is both key and binding target.
                properties.push(makeBindingPropertyShorthand(p.name,
                    makeBindingIdent(p.name, p.span ?? makeSpan(0,0,1,1))));
            } else if (p.kind === "KeyValue") {
                properties.push(makeBindingPropertyKeyValue(p.key,
                    toBindingPattern(p.value, ctx), p.computed === true));
            } else {
                // Method etc. — not bindable.
                recordError(ctx, "E-STMT-FOR-NONBINDABLE-LHS",
                    "this property cannot appear in a for-in/of binding LHS",
                    spanHere(ctx));
                properties.push(makeBindingPropertyShorthand("", makeBindingIdent("", spanHere(ctx))));
            }
        }
        return makeObjectPattern(properties, node.span);
    }
    // A member expression (`obj.k`) / call / other expression — a non-decl
    // for-in/of LHS that is NOT a destructuring shape. The for-in/of node
    // accepts this as an assignment-target expression (ESTree convention).
    return node;
}

// makeBindingAssignmentPatternForFor — local wrapper used by toBindingPattern
// to avoid a name collision with ast-stmt's makeAssignmentPattern (imported
// here). Same shape as makeAssignmentPattern.
function makeBindingAssignmentPatternForFor(left, right, span) {
    return makeAssignmentPattern(left, right, span);
}

// parseForBindingHead — the LEFT side of a for-in / for-of when it is a
// declaration (`for (let x of xs)`). Parses the `let`/`const`/`var` keyword +
// exactly ONE binding target (no initializer — JS forbids an initializer on a
// for-in/of binding) and returns a one-declarator VarDecl Stmt.
function parseForBindingHead(ctx, kwTok, declKind) {
    const cursor = ctx.cursor;

    const target = parseBinding(ctx);
    // An initializer on a for-in/of binding is a syntax error in modern JS —
    // record a diagnostic and consume it so the parser proceeds.
    if (currentKind(cursor) === TokenKind.Assign) {
        recordError(ctx, "E-STMT-FOR-BINDING-INIT",
            "a 'for-in' / 'for-of' binding may not have an initializer", spanHere(ctx));
        advance(cursor);   // consume =
        const priorM = enterMode(ctx, ParseMode.InExpression);
        parseAssignmentExpr(ctx);
        exitMode(ctx, priorM);
    }

    const declarator = makeVarDeclarator(target, null,
        makeSpan(nodeStart(target), nodeEnd(target), nodeLine(target), nodeCol(target)));
    const span = makeSpan(kwTok.span.start, nodeEnd(target), kwTok.span.line, kwTok.span.col);
    return makeVarDecl(declKind, [declarator], span);
}

// parseForCStyleVarHead — the C-style `for` init when it is a declaration
// (`for (let i = 0, j = 1; ...)`). Parses the keyword + a comma-separated
// declarator list but NOT the terminating `;` (parseForCStyle owns the head's
// `;` separators). M4.2 — the declarator initializers parse in a NO-IN scope
// so `for (let i = a in b; ...)` is rejected the same way Acorn rejects it:
// the `=` consumes `a`, then the noIn scope stops the climb at `in`, so the
// classifier sees `in` next and tries for-in (which fails because there's an
// initializer).
function parseForCStyleVarHead(ctx, kwTok, declKind) {
    const cursor = ctx.cursor;

    const declarations = [];
    while (atEnd(cursor) === false) {
        if (currentKind(cursor) === TokenKind.Semicolon
            || currentKind(cursor) === TokenKind.KwIn
            || currentKind(cursor) === TokenKind.KwOf) {
            break;
        }
        const declarator = parseVarDeclarator(ctx);
        if (declarator === undefined || declarator === null) {
            break;
        }
        declarations.push(declarator);
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    let endE = kwTok.span.end;
    if (declarations.length > 0) {
        endE = nodeEnd(declarations[declarations.length - 1]);
    }
    const span = makeSpan(kwTok.span.start, endE, kwTok.span.line, kwTok.span.col);
    return makeVarDecl(declKind, declarations, span);
}

// --- parseFor — `for` C-style / for-in / for-of (incl. `for await`) ---
// M4.2 — uses the noIn flag (parse-expr's enterNoInScope) instead of the
// M3.2-era forHeadKind depth-scan. The head is parsed with noIn set; the
// disambiguator (`;` / `in` / `of`) is then the next token at the cursor.
export function parseFor(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `for`

    // M4.3 — `for await ... of` is RETRACTED. scrml has no async/await at the
    // language level (parallel-by-default, no colored functions). When `await`
    // appears in the for head we fire E-FOR-AWAIT-NOT-IN-SCRML at the keyword
    // and recover by parsing the form as a plain `for` (the `isAwait` flag is
    // forced false; the rest of the for parses normally).
    let isAwait = false;
    if (currentKind(cursor) === TokenKind.KwAwait) {
        const awaitTok = advance(cursor);   // consume `await`
        recordError(ctx, "E-FOR-AWAIT-NOT-IN-SCRML",
            "scrml has no `for await ... of`. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            awaitTok.span);
    }

    expectLParen(ctx, "for");

    // Empty init — C-style (`for (;;)`).
    if (currentKind(cursor) === TokenKind.Semicolon) {
        return finishForCStyle(ctx, kw, isAwait, null);
    }

    // M4.2 — open the no-In scope for the init / LHS clause. Restored before
    // the right-hand expression is parsed (which is a normal in-allowed scope).
    const noInPrior = enterNoInScope(ctx);

    // The init shape — declaration or expression.
    const initKind = currentKind(cursor);
    let initIsDecl = false;
    let initNode = null;

    if (initKind === TokenKind.KwLet || initKind === TokenKind.KwConst
        || initKind === TokenKind.KwVar) {
        const kwTok = advance(cursor);   // consume let / const / var
        const declKind = varDeclKindOf(kwTok.kind);
        initNode = parseForCStyleVarHead(ctx, kwTok, declKind);
        initIsDecl = true;
    } else {
        // An expression init (or LHS for non-decl for-in/of).
        const priorM = enterMode(ctx, ParseMode.InExpression);
        initNode = parseExpression(ctx);
        exitMode(ctx, priorM);
    }

    // Close the no-In scope BEFORE parsing the right-hand-side (for-in's right
    // is a normal expression where `in` is once again a binary operator).
    exitNoInScope(ctx, noInPrior);

    // The disambiguator — token at the cursor decides the for-head form.
    const sep = currentKind(cursor);

    if (sep === TokenKind.KwIn || sep === TokenKind.KwOf) {
        // for-in / for-of. The LHS must be a single binding (declaration form)
        // or an assignment-target expression / binding pattern (non-decl form).
        return finishForInOf(ctx, kw, isAwait, initNode, initIsDecl, sep);
    }

    // Otherwise the init is the C-style init clause; the head separator should
    // be `;` (a missing `;` records E-STMT-FOR-SEMICOLON inside finishForCStyle).
    return finishForCStyle(ctx, kw, isAwait, initNode);
}

// finishForInOf — the cursor sits AT the `in` / `of` keyword. `initNode` is
// the parsed head (a VarDecl when initIsDecl, else an expression / binding).
function finishForInOf(ctx, kw, isAwait, initNode, initIsDecl, sepKind) {
    const cursor = ctx.cursor;

    // for-in / for-of declaration form requires a single declarator with no
    // initializer.
    let left = initNode;
    if (initIsDecl === true) {
        const decl = initNode;
        if (decl.declarations.length !== 1) {
            recordError(ctx, "E-STMT-FOR-DECL-COUNT",
                "a 'for-in' / 'for-of' declaration must declare exactly one binding",
                decl.span);
        } else if (decl.declarations[0].init !== null && decl.declarations[0].init !== undefined) {
            // The init-on-binding diagnostic was already recorded by
            // parseVarDeclarator if it parsed an initializer; we don't double-
            // report. (M3.2's parseForBindingHead also recorded it; M4.2 keeps
            // the same diagnostic.)
            recordError(ctx, "E-STMT-FOR-BINDING-INIT",
                "a 'for-in' / 'for-of' binding may not have an initializer",
                decl.declarations[0].span);
        }
    } else {
        // Non-declaration LHS — convert an Object/Array literal expression to
        // a binding pattern (K6 / M4.2 — the ESTree toAssignable transform).
        // Member expressions / identifiers pass through unchanged.
        left = toBindingPattern(initNode, ctx);
    }

    // Consume the `in` / `of` operator keyword.
    advance(cursor);

    // The right side. for-in's right is a full expression; for-of's right is
    // an assignment-level expression (a `,` there is NOT a sequence —
    // ECMAScript's for-of grammar uses AssignmentExpression for the iterable).
    const priorM = enterMode(ctx, ParseMode.InExpression);
    const right = (sepKind === TokenKind.KwOf) ? parseAssignmentExpr(ctx) : parseExpression(ctx);
    exitMode(ctx, priorM);

    expectRParen(ctx, "for");
    const body = parseStatement(ctx);

    const span = makeSpan(kw.span.start, nodeEnd(body), kw.span.line, kw.span.col);
    if (sepKind === TokenKind.KwIn) {
        return makeForIn(left, right, body, span);
    }
    return makeForOf(left, right, body, isAwait, span);
}

// finishForCStyle — the cursor sits AT the `;` that ends the init clause (or
// at end-of-clause for an empty init). `initNode` is the parsed init or null
// (for an empty init).
function finishForCStyle(ctx, kw, isAwait, initNode) {
    const cursor = ctx.cursor;

    // M4.3 — the prior E-STMT-FOR-AWAIT-CSTYLE check is GONE; the
    // `for await ...` form is itself retracted (E-FOR-AWAIT-NOT-IN-SCRML
    // fires at the `await` keyword site in parseFor). `isAwait` is always
    // false post-retraction; no C-style/for-of-only check is needed here.

    if (currentKind(cursor) === TokenKind.Semicolon) {
        advance(cursor);   // consume the init/test separator ;
    } else {
        recordError(ctx, "E-STMT-FOR-SEMICOLON",
            "expected ';' after the 'for' init clause", spanHere(ctx));
    }

    // The test clause — empty or an expression.
    let test = null;
    if (currentKind(cursor) !== TokenKind.Semicolon) {
        const priorM = enterMode(ctx, ParseMode.InExpression);
        test = parseExpression(ctx);
        exitMode(ctx, priorM);
    }
    if (currentKind(cursor) === TokenKind.Semicolon) {
        advance(cursor);   // consume the test/update separator ;
    } else {
        recordError(ctx, "E-STMT-FOR-SEMICOLON",
            "expected ';' after the 'for' test clause", spanHere(ctx));
    }

    // The update clause — empty or an expression.
    let update = null;
    if (currentKind(cursor) !== TokenKind.RParen) {
        const priorM = enterMode(ctx, ParseMode.InExpression);
        update = parseExpression(ctx);
        exitMode(ctx, priorM);
    }

    expectRParen(ctx, "for");
    const body = parseStatement(ctx);

    const span = makeSpan(kw.span.start, nodeEnd(body), kw.span.line, kw.span.col);
    return makeFor(initNode, test, update, body, span);
}

// =============================================================================
// return / break / continue — the no-LineTerminator restricted production
// gates the optional argument / label: an argument (return) or a label
// (break / continue) is recognized only when it sits on the SAME source line
// as the keyword. The lexer drops Newline tokens, so this reuses the
// .span.line signal that ASI relies on.
// =============================================================================

// sameLineFollows — does the token at the cursor sit on the SAME source line
// as `kwTok`, and is it NOT a `;` / `}` / EOF (the always-terminate tokens)?
// The signal for "the optional argument / label is present".
function sameLineFollows(ctx, kwTok) {
    const cursor = ctx.cursor;
    if (atEnd(cursor)) {
        return false;
    }
    const k = currentKind(cursor);
    if (k === TokenKind.Semicolon || k === TokenKind.RBrace) {
        return false;
    }
    const here = current(cursor);
    if (here === undefined || here === null) {
        return false;
    }
    return lineOfToken(here) === lineOfToken(kwTok);
}

// --- parseReturn — a `return argument?` statement ---
// RETURN-LEGALITY (M3.4 — the seam M3.3 flagged, now CLOSED). A `return`
// outside any function body is a JS SyntaxError. `currentParseMode` is a
// single slot, not a depth stack — a `return` inside a nested `{}` block
// inside a function sees `.InBlock`, not `.InFunctionBody` — so the
// single-slot mode cannot tell function-scope from program-scope across
// nested blocks. M3.4 adds `ctx.functionDepth`, a function-body NESTING
// counter (parseFunctionBodyInline increments it; parseBlockStubBody seeds it
// to 1). `parseReturn` consults it: at depth 0 the `return` is in program
// scope — fire E-STMT-RETURN-OUTSIDE-FUNCTION. The parse is still well-formed
// (a Return node is produced); the diagnostic is the legality verdict, so a
// later stage / a caller can see both the node and the error. Acorn (the
// conformance oracle) rejects a top-level `return` outright.
export function parseReturn(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `return`

    // Return-legality — a `return` at functionDepth 0 is outside any function.
    if (ctx.functionDepth <= 0) {
        recordError(ctx, "E-STMT-RETURN-OUTSIDE-FUNCTION",
            "'return' outside of a function", kw.span);
    }

    let argument = null;
    let endE = kw.span.end;
    if (sameLineFollows(ctx, kw)) {
        const priorM = enterMode(ctx, ParseMode.InExpression);
        argument = parseExpression(ctx);
        exitMode(ctx, priorM);
        endE = nodeEnd(argument);
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeReturn(argument, span);
}

// optionalLabelName — the optional label of a `break` / `continue`: an
// identifier on the SAME line as the keyword. Returns the label text or
// `null`. Consumes the identifier token when present.
function optionalLabelName(ctx, kwTok) {
    const cursor = ctx.cursor;
    if (sameLineFollows(ctx, kwTok) === false) {
        return null;
    }
    if (currentKind(cursor) !== TokenKind.Ident) {
        return null;
    }
    return advance(cursor).name;
}

// --- parseBreak — a `break label?` statement ---
export function parseBreak(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `break`

    const label = optionalLabelName(ctx, kw);
    const prevTok = lastTokenBefore(ctx);
    const endE = prevTok.span.end;
    consumeSemicolon(ctx, prevTok);

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeBreak(label, span);
}

// --- parseContinue — a `continue label?` statement ---
export function parseContinue(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `continue`

    const label = optionalLabelName(ctx, kw);
    const prevTok = lastTokenBefore(ctx);
    const endE = prevTok.span.end;
    consumeSemicolon(ctx, prevTok);

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeContinue(label, span);
}

// --- parseLabeledStatement — a `label: statement` ---
// The caller (parseStatement) has confirmed `Ident :` (and that the token
// after the `:` is not another `:` — that would be the `Type::Variant` form).
// The labeled statement's body is the statement that follows the `:` —
// parseStatement parses it (a label may name a loop / block / any statement;
// `break label` / `continue label` target it).
export function parseLabeledStatement(ctx) {
    const cursor = ctx.cursor;
    const nameTok = advance(cursor);   // consume the label identifier
    advance(cursor);                   // consume the `:`

    const body = parseStatement(ctx);
    const span = makeSpan(nameTok.span.start, nodeEnd(body), nameTok.span.line, nameTok.span.col);
    return makeLabeled(nameTok.name, body, span);
}

// =============================================================================
// Functions / classes / import / export / try / throw — M3.3 (DD §D5
// declaration + module + try/throw rows).
//
// Function + class declaration bodies are parsed IN-LINE — via the
// statement-list parser, the same parseStatementList M3.1 built. This is THE
// body-pre-parser subsumption: M3 parses function bodies in-line, so
// body-pre-parser.ts deletes by construction (DD §D7 M3 gating). The legacy
// error-flow forms `try`/`catch`/`finally`+`throw` are PARSED (for legacy +
// JS-import inputs); a later stage (the typer) rejects them in scrml source.
// =============================================================================

// parseFunctionBodyInline — parse a `{ stmt* }` function / method body IN-LINE
// into a Stmt array (the BPP subsumption — no BlockStub). The cursor must sit
// on the opening `{`. Enters .InFunctionBody for the body. Returns
// { body, endPos } — `body` is the Stmt array, `endPos` the byte offset of
// the closing `}` (or the last consumed token's end on a missing `}`).
//
// M3.4 — increments `ctx.functionDepth` for the body's duration. This is the
// single in-line function/method body parser (parseFunctionDecl + class
// methods both route through it), so the increment here covers every nested
// function body. `parseReturn` reads functionDepth: a `return` inside the
// body — even in a deeply nested `{}` block — sees depth >= 1 and is legal;
// a top-level `return` sees depth 0 and fires E-STMT-RETURN-OUTSIDE-FUNCTION.
//
// M4.1 — `isAsync` / `isGenerator` are the body's OWN async/generator scope.
// The body parses with `ctx.inGenerator` set to this function's
// flags (so `await`/`yield` are operators inside it); the prior scope is
// saved and restored, mirroring the functionDepth inc/dec. A function
// ESTABLISHES its own scope — it does not inherit the enclosing function's.
function parseFunctionBodyInline(ctx, isAsync, isGenerator) {
    const cursor = ctx.cursor;

    if (currentKind(cursor) !== TokenKind.LBrace) {
        recordError(ctx, "E-STMT-FUNCTION-BODY",
            "expected '{' to open a function body", spanHere(ctx));
        return { body: [], endPos: spanHere(ctx).end };
    }
    const open = advance(cursor);   // consume {

    const prior = enterMode(ctx, ParseMode.InFunctionBody);
    ctx.functionDepth = ctx.functionDepth + 1;
    const priorGenerator = ctx.inGenerator;
    ctx.inGenerator = isGenerator === true;
    const body = parseStatementList(ctx, TokenKind.RBrace);
    ctx.inGenerator = priorGenerator;
    ctx.functionDepth = ctx.functionDepth - 1;
    exitMode(ctx, prior);

    let endPos = open.span.end;
    if (currentKind(cursor) === TokenKind.RBrace) {
        endPos = advance(cursor).span.end;   // consume }
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-FUNCTION-BODY",
            "expected '}' to close a function body", open.span);
        const prevTok = lastTokenBefore(ctx);
        if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined) {
            endPos = prevTok.span.end;
        }
    }
    return { body, endPos };
}

// makeInlineFunction — a `Function`-kind Expr node whose body is a parsed
// Stmt array (the in-line body shape — distinct from M2.3's BlockStub-bodied
// function expressions; M3.3-parsed function declarations / class methods
// carry the body parsed in-line per DD §D3 `Function(... body: Stmt[] ...)`).
// `name` is the function name or `null` (an anonymous method value).
function makeInlineFunction(name, params, body, isAsync, isGenerator, span) {
    return { kind: "Function", name, params, body, isAsync, isGenerator, span };
}

// --- parseFunctionDecl — `function name(params) { body }` ---
// `async` is consumed by the caller (parseStatement) when present. Handles
// the `function*` generator form. The body is parsed IN-LINE via
// parseStatementList — the body-pre-parser subsumption. `allowAnonymous` is
// true ONLY for `export default function () {}` (a default-exported function
// declaration may be anonymous); a plain declaration always names.
export function parseFunctionDecl(ctx, isAsync, allowAnonymous) {
    const cursor = ctx.cursor;
    const fnTok = advance(cursor);   // consume `function`

    // `function*` — a generator declaration.
    let isGenerator = false;
    if (currentKind(cursor) === TokenKind.Star) {
        advance(cursor);   // consume *
        isGenerator = true;
    }

    // The name. A plain declaration always names; `export default function`
    // may be anonymous (`name` is "" — ESTree's null id).
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else if (allowAnonymous !== true) {
        recordError(ctx, "E-STMT-FUNCTION-NAME",
            "expected a name after 'function'", spanHere(ctx));
    }

    const params = parseParamList(ctx);
    // M4.1 — the body parses in the function's own async/generator scope.
    const inline = parseFunctionBodyInline(ctx, isAsync, isGenerator);

    const span = makeSpan(fnTok.span.start, inline.endPos, fnTok.span.line, fnTok.span.col);
    return makeFunctionDecl(name, params, inline.body, isAsync, isGenerator, span);
}

// =============================================================================
// Scrml function-declaration modifiers — M5-swap Wave 1 (B6).
//
// The native parser (M1-M4) knew only the JS `function` keyword. scrml's
// canonical function form is `fn` — with optional `server` / `pure` prefix
// modifiers and an optional trailing `!` failable marker. These carry
// load-bearing semantics: `isServer` drives the codegen server/client split;
// `canFail` (`!`) drives error-effect wiring; `fnKind` / `isPure` drive the
// calculation classification (SPEC §48 / §48.6.4 / Pillar 5b).
//
// Grammar (the modifier prefix is recognized by `fnDeclLeadFollows`):
//   scrml-fn-decl ::= ('pure')? ('server')? 'fn' name (params)? failable?
//                     returnAnnotation? '{' body '}'
//   failable      ::= '!' ('->' errorTypeName)?
//
// THE SHARED `!` SIGIL (DD OQ3). The trailing `!` here is a SIGNATURE-position
// marker — it appears AFTER the parameter list and BEFORE the body `{` (or
// before a `-> ErrorType` clause). It is consumed as a single `Bang` token
// and does NOT consume any following `{` — the `{` stays available as the
// function body opener. A future B2 `!{}` statement-level guarded-expr
// production operates in EXPRESSION position (a `!` immediately after an
// expression, followed by a `{` arm-list); that is a distinct grammar
// position from this signature-position `!`. The two do not collide:
// `parseScrmlFunctionDecl`'s `!`-consumption is gated on being inside a
// function-declaration head, never in expression position. B2 remains free
// to add its own expression-position `!{}` production.
// =============================================================================

// isFnDeclKeyword — calculation (predicate): is `k` a function-declaration
// keyword — `fn` (the scrml shorthand) or `function` (the general form)?
// M6.7-D2 (§7 / §12 / §48 / §52) — the `server` / `pure` modifier prefix
// attaches to BOTH `fn` AND `function`. A bare `function` lead is dispatched
// earlier (parseStatement's KwFunction arm); this predicate is consulted only
// for the MODIFIER-led path, where `server function` / `pure function` /
// `pure server function` must be recognized as fn-decl leads, not fall through
// to the expression-statement arm (the pre-D2 gap — native rejected the
// PRIMER §6 `server function fetchItems()!` recipe live accepts).
function isFnDeclKeyword(k) {
    return k === TokenKind.KwFn || k === TokenKind.KwFunction;
}

// fnDeclLeadFollows — does a scrml function-declaration lead begin at the
// cursor? True for a `fn` keyword, or a `server` / `pure` modifier keyword that
// leads (directly or via the other modifier) to a `fn` OR `function` keyword.
// The valid prefix orders mirror the live ast-builder (the `fn` shorthand path
// ast-builder.js:5798-5817 + the general-`function` path ast-builder.js:8386-
// 8400): `fn`, `server fn`, `pure fn`, `pure server fn`, AND `server function`,
// `pure function`, `pure server function`. A BARE `function` is NOT a member —
// it is handled by parseStatement's dedicated KwFunction arm (parseFunctionDecl);
// this predicate gates only the modifier-led path. The `fnKind` discriminator
// (`"fn"` vs `"function"`, §33.6: `fn ≡ pure function` but they remain distinct
// fnKinds) is preserved by parseScrmlFunctionDecl reading which keyword follows.
function fnDeclLeadFollows(cursor) {
    const k0 = currentKind(cursor);
    if (k0 === TokenKind.KwFn) {
        return true;
    }
    if (k0 === TokenKind.KwServer) {
        // `server fn` / `server function`
        return isFnDeclKeyword(peekKind(cursor, 1));
    }
    if (k0 === TokenKind.KwPure) {
        // `pure fn` / `pure function` / `pure server fn` / `pure server function`
        const k1 = peekKind(cursor, 1);
        if (isFnDeclKeyword(k1)) {
            return true;
        }
        return k1 === TokenKind.KwServer && isFnDeclKeyword(peekKind(cursor, 2));
    }
    return false;
}

// arrowFollows — does a `->` arrow begin at the cursor? The native lexer
// lexes `->` as two adjacent tokens (`Minus` then `GreaterThan`) — it reserves
// the single `Arrow` token for the fat arrow `=>`. Used by the `! -> ErrorType`
// clause and the `fn () -> TypeName {` return-type annotation.
function arrowFollows(cursor) {
    return currentKind(cursor) === TokenKind.Minus
        && peekKind(cursor, 1) === TokenKind.GreaterThan;
}

// skipReturnTypeAnnotation — consume a `fn` return-type annotation between the
// parameter list `)` and the body `{`. scrml allows `fn name() : TypeName {`
// and `fn name() -> TypeName {`. The native parser does not retain the type
// (the live `function-decl` `returnTypeAnnotation` is a downstream-typer
// concern); this skips the annotation tokens up to the body `{`, tracking
// paren/angle nesting so a `>` inside a refinement predicate (`number(>0)`)
// does not end the scan early.
function skipReturnTypeAnnotation(ctx) {
    const cursor = ctx.cursor;
    let angleDepth = 0;
    let parenDepth = 0;
    while (atEnd(cursor) === false) {
        const k = currentKind(cursor);
        if (k === TokenKind.LParen) {
            parenDepth = parenDepth + 1;
        } else if (k === TokenKind.RParen) {
            parenDepth = parenDepth - 1;
        } else if (k === TokenKind.LessThan && parenDepth === 0) {
            angleDepth = angleDepth + 1;
        } else if (k === TokenKind.GreaterThan && parenDepth === 0) {
            angleDepth = angleDepth - 1;
        } else if (k === TokenKind.LBrace && angleDepth === 0 && parenDepth === 0) {
            return;   // the body `{` — stop before it
        }
        advance(cursor);
    }
}

// --- parseScrmlFunctionDecl — a `[pure] [server] (fn|function) name(...) [!] { body }` ---
// The B6 production, extended in M6.7-D2 to cover the `function` keyword form.
// `allowAnonymous` mirrors `parseFunctionDecl` (true only for `export default`).
// Consumes the modifier prefix, the `fn` OR `function` keyword (+ `function*`
// generator), the name, the optional param list, the trailing `!` failable
// marker (+ optional `-> ErrorType`), an optional return-type annotation, and
// the in-line body.
//
// THE `fnKind` DISCRIMINATOR (§33.6 — `fn ≡ pure function`, but the two remain
// DISTINCT fnKinds; do NOT collapse). The node carries `fnKind:"fn"` for the
// `fn` shorthand and `fnKind:"function"` for the general `function` keyword,
// matching the live ast-builder exactly: the `fn` shorthand path
// (ast-builder.js:5964-5970 → `fnKind:"fn"`) vs the general-function path
// (ast-builder.js:8548-8554 → `fnKind:"function"`). The modifier flags
// (`isServer`/`isPure`) and the `!`/`-> ErrorType` suffix attach identically to
// both forms. Pre-D2, native recognized the modifier prefix ONLY before `fn`,
// so `server function` / `pure function` / `pure server function` (incl. the
// PRIMER §6 recipe `server function fetchItems()! -> LoadError`) fell through to
// the expression-statement arm and produced a spurious E-EXPR-UNEXPECTED cascade.
export function parseScrmlFunctionDecl(ctx, allowAnonymous) {
    const cursor = ctx.cursor;

    // --- modifier prefix --- (orders: [pure] [server] before fn|function)
    let isPure = false;
    let isServer = false;
    let leadTok = current(cursor);
    if (currentKind(cursor) === TokenKind.KwPure) {
        isPure = true;
        advance(cursor);   // consume `pure`
    }
    if (currentKind(cursor) === TokenKind.KwServer) {
        isServer = true;
        advance(cursor);   // consume `server`
    }

    // --- the `fn` or `function` keyword --- `fnKind` discriminates the two
    // (§33.6). A modifier-led decl ALWAYS has one of these next (fnDeclLeadFollows
    // guaranteed it); the `else` is a defensive recovery arm.
    let fnTok = leadTok;
    let fnKind = "fn";
    if (currentKind(cursor) === TokenKind.KwFn) {
        fnTok = advance(cursor);   // consume `fn`
        fnKind = "fn";
    } else if (currentKind(cursor) === TokenKind.KwFunction) {
        fnTok = advance(cursor);   // consume `function`
        fnKind = "function";
    } else {
        recordError(ctx, "E-STMT-FN-KEYWORD",
            "expected 'fn' or 'function' after a function modifier", spanHere(ctx));
    }

    // --- the `function*` generator marker --- (only the `function` keyword form
    // accepts `*`; the `fn` shorthand has no generator form). Mirrors
    // parseFunctionDecl's generator handling.
    let isGenerator = false;
    if (fnKind === "function" && currentKind(cursor) === TokenKind.Star) {
        advance(cursor);   // consume `*`
        isGenerator = true;
    }

    // --- the name --- (a declaration always names; `export default` may be
    // anonymous).
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else if (allowAnonymous !== true) {
        recordError(ctx, "E-STMT-FN-NAME",
            "expected a name after '" + fnKind + "'", spanHere(ctx));
    }

    // --- the optional parameter list --- (the param list is present only when
    // a `(` follows the name; the `fn` shorthand may declare no params).
    let params = [];
    if (currentKind(cursor) === TokenKind.LParen) {
        params = parseParamList(ctx);
    }

    // --- the trailing `!` failable marker + optional `-> ErrorType` ---
    let canFail = false;
    let errorType = null;
    if (currentKind(cursor) === TokenKind.Bang) {
        advance(cursor);   // consume `!`
        canFail = true;
        // `! -> ErrorType` — a named error type. `->` lexes as two tokens
        // (`Minus` then `GreaterThan`) — the native lexer reserves the
        // `Arrow` token for `=>`.
        if (arrowFollows(cursor)) {
            advance(cursor);   // consume `-`
            advance(cursor);   // consume `>`
            if (currentKind(cursor) === TokenKind.Ident) {
                errorType = advance(cursor).name;
            } else {
                recordError(ctx, "E-STMT-FN-ERROR-TYPE",
                    "expected an error type name after '! ->'", spanHere(ctx));
            }
        }
    }

    // --- an optional return-type annotation between `)` and `{` ---
    // `fn name() : TypeName {` or `fn name() -> TypeName {`. The `->` arrow
    // is two tokens (`Minus` + `GreaterThan`).
    if (currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        skipReturnTypeAnnotation(ctx);
    } else if (arrowFollows(cursor)) {
        advance(cursor);   // consume `-`
        advance(cursor);   // consume `>`
        skipReturnTypeAnnotation(ctx);
    }

    // --- the in-line body --- (parsed in the function's own generator scope).
    const inline = parseFunctionBodyInline(ctx, false, isGenerator);

    const span = makeSpan(fnTok.span.start, inline.endPos, fnTok.span.line, fnTok.span.col);
    return makeFunctionDecl(name, params, inline.body, false, isGenerator, span, {
        fnKind,
        isServer,
        isPure,
        isPinned:  false,
        canFail,
        errorType,
    });
}

// =============================================================================
// Class declarations — `class Name extends Base { members }`.
//
// A class body is a brace-delimited member list. Each member is a method
// definition or a class field. Methods carry `static` / `get` / `set` /
// `async` / `*` (generator) / a computed `[expr]` name; the body is parsed
// in-line. A `;` between members is an empty member (consumed, no node).
// =============================================================================

// --- parseClassDecl — a `class Name extends Base { ... }` declaration ---
// `allowAnonymous` is true ONLY for `export default class {}` (a
// default-exported class may be anonymous); a plain declaration always names.
export function parseClassDecl(ctx, allowAnonymous) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `class`

    // The name. A plain declaration always names; `export default class` may
    // be anonymous (`name` is "" — ESTree's null id). A class name is never
    // `extends` / `{` — those open the heritage clause / the body.
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else if (allowAnonymous !== true) {
        recordError(ctx, "E-STMT-CLASS-NAME",
            "expected a name after 'class'", spanHere(ctx));
    }

    // The optional `extends` clause — `extends <expr>`. The superclass is a
    // left-hand-side expression (Acorn parses it at LHS / postfix level — a
    // `class C extends a.b {}` is legal); parsePostfix covers the corpus
    // forms (an identifier, a member access, a call).
    let superClass = null;
    if (currentKind(cursor) === TokenKind.KwExtends) {
        advance(cursor);   // consume `extends`
        const prior = enterMode(ctx, ParseMode.InExpression);
        superClass = parsePostfix(ctx);
        exitMode(ctx, prior);
        reenterBlockStubs(superClass);
    }

    const body = parseClassBody(ctx);

    let endPos = (body.length > 0) ? nodeEnd(body[body.length - 1]) : kw.span.end;
    const prevTok = lastTokenBefore(ctx);
    if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined
        && prevTok.span.end > endPos) {
        endPos = prevTok.span.end;
    }
    const span = makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col);
    return makeClassDecl(name, superClass, body, span);
}

// parseClassBody — the `{ member* }` body of a class. Returns a ClassMember
// array. A stray `;` between members is the empty class element (consumed,
// produces no node — ESTree drops it).
function parseClassBody(ctx) {
    const cursor = ctx.cursor;
    const members = [];

    if (currentKind(cursor) !== TokenKind.LBrace) {
        recordError(ctx, "E-STMT-CLASS-BODY",
            "expected '{' to open a class body", spanHere(ctx));
        return members;
    }
    advance(cursor);   // consume {

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        // An empty class element — a stray `;`. Consumed, no node.
        if (currentKind(cursor) === TokenKind.Semicolon) {
            advance(cursor);
            continue;
        }
        const before = cursor.idx;
        const member = parseClassMember(ctx);
        if (member !== undefined && member !== null) {
            members.push(member);
        }
        // Forward-progress guard — a malformed class member that consumed
        // nothing gets one forced advance so the body loop cannot spin. The
        // class-member loop already re-synchronizes structurally (a stray `;`
        // is consumed above; a `}` ends the body via the `while` condition);
        // M3.4's ErrorRecovery-engine panic-mode is the STATEMENT grammar's
        // (parseStatementList) — class-member recovery is a separate grammar.
        if (cursor.idx === before) {
            advance(cursor);
        }
    }

    if (currentKind(cursor) === TokenKind.RBrace) {
        advance(cursor);   // consume }
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-CLASS-BODY",
            "expected '}' to close a class body", spanHere(ctx));
    }
    return members;
}

// parseClassMember — one member of a class body: a method definition or a
// class field. Recognizes the `static` prefix, the `get` / `set` accessor
// prefixes, the `async` and `*` (generator) method prefixes, and computed
// `[expr]` member names.
//
// `static` / `get` / `set` / `async` are CONTEXTUAL — each is a valid plain
// member name on its own (`static() {}` is a method named `static`). The
// discriminator: a prefix keyword followed by another name / `[` / `*` IS the
// prefix; a prefix keyword followed by `(` / `=` / `;` / `}` is a member
// NAMED by that keyword.
function parseClassMember(ctx) {
    const cursor = ctx.cursor;
    const startTok = current(cursor);
    const startSpan = (startTok === undefined || startTok === null)
        ? spanHere(ctx) : startTok.span;

    // `static` prefix — present iff `static` is followed by another member
    // head (a name / `[` / `*` / `get` / `set` / `async`), not by `(` `=` `;`.
    let isStatic = false;
    if (classMemberNameKind(cursor) === "static-prefix") {
        advance(cursor);   // consume `static`
        isStatic = true;
    }

    // M4.3 — RETRACTED. The `async` class-method prefix is no longer valid in
    // scrml. We fire E-ASYNC-NOT-IN-SCRML at the `async` keyword and recover
    // by parsing the method as a plain (or generator) method — keeping the
    // rest of the class body parseable. `isAsync` is forced false.
    let isAsync = false;
    if (classMemberNameKind(cursor) === "async-prefix") {
        const asyncTok = advance(cursor);   // consume `async`
        recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
            "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            asyncTok.span);
    }

    // `*` generator method prefix.
    let isGenerator = false;
    if (currentKind(cursor) === TokenKind.Star) {
        advance(cursor);   // consume *
        isGenerator = true;
    }

    // `get` / `set` accessor prefix — present iff followed by another member
    // head. An accessor is never a generator / async.
    let methodKind = MethodKind.Method;
    const accessorKind = classMemberNameKind(cursor);
    if (accessorKind === "get-prefix") {
        advance(cursor);   // consume `get`
        methodKind = MethodKind.Get;
    } else if (accessorKind === "set-prefix") {
        advance(cursor);   // consume `set`
        methodKind = MethodKind.Set;
    }

    // The member name — a plain name, a string / number literal name, or a
    // computed `[expr]` name.
    const nameInfo = parseClassMemberName(ctx);
    const key = nameInfo.key;
    const computed = nameInfo.computed;

    // A `(` after the name -> a method. Anything else -> a class field.
    if (currentKind(cursor) === TokenKind.LParen) {
        const params = parseParamList(ctx);
        // M4.1 — the method body parses in the method's own async/generator
        // scope (`isAsync` from an `async` prefix, `isGenerator` from a `*`).
        const inline = parseFunctionBodyInline(ctx, isAsync, isGenerator);
        const valueSpan = makeSpan(startSpan.start, inline.endPos, startSpan.line, startSpan.col);
        const value = makeInlineFunction(null, params, inline.body, isAsync, isGenerator, valueSpan);

        // A method named `constructor` (un-computed, non-static, plain) is
        // the constructor — unless it is already a get/set accessor.
        let finalKind = methodKind;
        if (finalKind === MethodKind.Method && computed === false && isStatic === false
            && nameInfo.plainName === "constructor") {
            finalKind = MethodKind.Constructor;
        }
        return makeMethodDef(key, value, finalKind, isStatic, computed, valueSpan);
    }

    // A class field — `name = init` / `name`. (An accessor / generator prefix
    // with no `(` is malformed; M3.3 records a diagnostic and still emits the
    // field so the member list stays whole.)
    if (methodKind !== MethodKind.Method || isGenerator) {
        recordError(ctx, "E-STMT-CLASS-MEMBER",
            "expected '(' after a class method head", spanHere(ctx));
    }
    let value = null;
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume =
        const prior = enterMode(ctx, ParseMode.InExpression);
        value = parseAssignmentExpr(ctx);
        exitMode(ctx, prior);
        reenterBlockStubs(value);
    }
    // A class field is `;`-terminated (ASI applies).
    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    let fieldEnd = (value === undefined || value === null) ? nodeEnd(key) : nodeEnd(value);
    if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined
        && prevTok.span.end > fieldEnd) {
        fieldEnd = prevTok.span.end;
    }
    const fieldSpan = makeSpan(startSpan.start, fieldEnd, startSpan.line, startSpan.col);
    return makePropertyDef(key, value, isStatic, computed, fieldSpan);
}

// classMemberNameKind — classify the token at the cursor as a contextual
// class-member PREFIX vs a member NAME. Returns "static-prefix" /
// "async-prefix" / "get-prefix" / "set-prefix" when the token is that
// keyword AND the next token continues a member head (a name / `[` / `*` /
// string / number literal); otherwise "name" (the keyword is itself the
// member name, or the token is an ordinary name).
function classMemberNameKind(cursor) {
    const k = currentKind(cursor);
    let isContextualKw = "";
    if (k === TokenKind.Ident) {
        const tok = current(cursor);
        const text = (tok === undefined || tok === null) ? "" : tok.name;
        if (text === "static") { isContextualKw = "static-prefix"; }
        else if (text === "get") { isContextualKw = "get-prefix"; }
        else if (text === "set") { isContextualKw = "set-prefix"; }
    } else if (k === TokenKind.KwAsync) {
        isContextualKw = "async-prefix";
    }
    if (isContextualKw === "") {
        return "name";
    }
    // The keyword is a PREFIX only when another member head follows.
    if (memberHeadFollows(cursor, 1)) {
        return isContextualKw;
    }
    return "name";
}

// memberHeadFollows — does the token `k` positions ahead begin a class-member
// head? A member head starts with an identifier, a keyword usable as a member
// name, a string / number literal, a computed-name `[`, or a generator `*`.
function memberHeadFollows(cursor, k) {
    const kind = peekKind(cursor, k);
    if (kind === undefined || kind === null) {
        return false;
    }
    return kind === TokenKind.Ident
        || kind === TokenKind.StringLit
        || kind === TokenKind.NumberLit
        || kind === TokenKind.LBracket
        || kind === TokenKind.Star
        || isKeywordTokenKind(kind);
}

// isKeywordTokenKind — does a TokenKind name a JS keyword token? A keyword is
// a valid class-member NAME (`class C { if() {} }`). By convention every
// keyword TokenKind name begins with `Kw`.
function isKeywordTokenKind(kind) {
    return typeof kind === "string" && kind.indexOf("Kw") === 0;
}

// parseClassMemberName — the name of a class member. Returns
// { key, computed, plainName } — `key` is the name Expr node, `computed` is
// true for a `[expr]` name, `plainName` is the bare identifier / keyword text
// (used to recognize `constructor`) or "" for a computed / literal name.
function parseClassMemberName(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // Computed name — `[ expr ]`.
    if (kind === TokenKind.LBracket) {
        advance(cursor);   // consume [
        const prior = enterMode(ctx, ParseMode.InExpression);
        const keyExpr = parseAssignmentExpr(ctx);
        exitMode(ctx, prior);
        if (currentKind(cursor) === TokenKind.RBracket) {
            advance(cursor);   // consume ]
        } else {
            recordError(ctx, "E-STMT-UNCLOSED-COMPUTED-KEY",
                "expected ']' to close a computed member name", spanHere(ctx));
        }
        return { key: keyExpr, computed: true, plainName: "" };
    }

    // String / number literal name. (`literalKeyExpr` moved to parse-expr at
    // M4.2; inlined here — this is the only remaining call site.)
    if (kind === TokenKind.StringLit || kind === TokenKind.NumberLit) {
        const tok = advance(cursor);
        const keyExpr = (tok.kind === TokenKind.StringLit)
            ? { kind: "StringLit", value: tok.cooked, raw: tok.text, span: tok.span }
            : { kind: "NumberLit", value: tok.value, raw: tok.text, span: tok.span };
        return { key: keyExpr, computed: false, plainName: "" };
    }

    // Private class fields `#name` are OUT of the M3.3 subset — DD §D5 lists
    // them only under `_{}` foreign-code (opaque passthrough), not in the
    // MUST-PARSE set; M1 also has no `#` lex branch (roadmap K5 — `#` hits
    // the lexer's "Unknown — skip" path). A `#name` member therefore surfaces
    // as a stray token, not a silent acceptance.

    // A plain identifier name, or a keyword used as a member name.
    if (kind === TokenKind.Ident) {
        const tok = advance(cursor);
        return {
            key: { kind: "Ident", name: tok.name, span: tok.span },
            computed: false, plainName: tok.name,
        };
    }
    if (isKeywordTokenKind(kind)) {
        const tok = advance(cursor);
        const text = (tok.text !== undefined && tok.text !== null) ? tok.text : "";
        return {
            key: { kind: "Ident", name: text, span: tok.span },
            computed: false, plainName: text,
        };
    }

    // Malformed — record a diagnostic + an empty-name key so the member node
    // is still whole.
    recordError(ctx, "E-STMT-CLASS-MEMBER-NAME",
        "expected a class member name", spanHere(ctx));
    return {
        key: { kind: "Ident", name: "", span: spanHere(ctx) },
        computed: false, plainName: "",
    };
}

// =============================================================================
// import / export — ES module syntax (named / default / namespace /
// re-export). DD §D5: "Import / export (named, default, namespace,
// re-export) ... module-resolver, route-inference".
// =============================================================================

// expectModuleString — consume the `"..."` module-specifier string after
// `from`. Returns the string value (the cooked text), or "" + a diagnostic
// when the token is not a string literal.
function expectModuleString(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.StringLit) {
        const tok = advance(cursor);
        return (tok.cooked !== undefined && tok.cooked !== null) ? tok.cooked : "";
    }
    recordError(ctx, "E-STMT-MODULE-SOURCE",
        "expected a module-specifier string", spanHere(ctx));
    return "";
}

// expectFromKeyword — consume the `from` keyword of an import / re-export;
// record a diagnostic if absent.
function expectFromKeyword(ctx) {
    if (currentKind(ctx.cursor) === TokenKind.KwFrom) {
        advance(ctx.cursor);
        return;
    }
    recordError(ctx, "E-STMT-EXPECT-FROM",
        "expected 'from' in an import / re-export", spanHere(ctx));
}

// importLocalName — consume an identifier that BINDS a name in this module
// (an import local, a default-import local, a namespace local). A keyword
// here is malformed; a diagnostic is recorded and "" returned.
function importLocalName(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.Ident) {
        return advance(cursor).name;
    }
    recordError(ctx, "E-STMT-IMPORT-NAME",
        "expected an identifier in an import binding", spanHere(ctx));
    return "";
}

// --- parseImport — an `import ... from "source"` statement ---
//   import "m";                         — bare side-effect import
//   import d from "m";                  — default import
//   import * as ns from "m";            — namespace import
//   import { a, b as c } from "m";      — named imports
//   import d, { a } from "m";           — default + named
//   import d, * as ns from "m";         — default + namespace
export function parseImport(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `import`
    const specifiers = [];

    // Bare side-effect import — `import "m";`.
    if (currentKind(cursor) === TokenKind.StringLit) {
        const source = expectModuleString(ctx);
        const endPos = finishStatementTerminator(ctx, kw);
        return makeImport(specifiers, source,
            makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
    }

    // A leading default-import binding — `import d ...`.
    if (currentKind(cursor) === TokenKind.Ident) {
        const localTok = current(cursor);
        const local = importLocalName(ctx);
        specifiers.push(makeImportDefault(local, localTok.span));
        // A `,` continues to a named / namespace clause.
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume ,
        }
    }

    // A namespace import — `* as ns`.
    if (currentKind(cursor) === TokenKind.Star) {
        const starTok = advance(cursor);   // consume *
        if (currentKind(cursor) === TokenKind.KwAs) {
            advance(cursor);   // consume `as`
        } else {
            recordError(ctx, "E-STMT-EXPECT-AS",
                "expected 'as' in a namespace import", spanHere(ctx));
        }
        const local = importLocalName(ctx);
        specifiers.push(makeImportNamespace(local, starTok.span));
    } else if (currentKind(cursor) === TokenKind.LBrace) {
        // A named-imports clause — `{ a, b as c }`.
        parseNamedImportSpecifiers(ctx, specifiers);
    }

    expectFromKeyword(ctx);
    const source = expectModuleString(ctx);
    const endPos = finishStatementTerminator(ctx, kw);
    return makeImport(specifiers, source,
        makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
}

// parseNamedImportSpecifiers — the `{ a, b as c }` clause of an import. The
// cursor sits on the `{`. Appends ImportNamed specifiers to `out`.
function parseNamedImportSpecifiers(ctx, out) {
    const cursor = ctx.cursor;
    advance(cursor);   // consume {

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        // The imported name — an identifier OR a string-literal specifier.
        // The quoted form (`import { "dispatch-board" as alias }`, SPEC
        // §38.12.5 / §12821) names a module export that is NOT a valid JS
        // identifier — kebab-case channel `name=` values. The STORED imported
        // name is the UNQUOTED (cooked) form (SPEC §17561-§17562), matching the
        // live oracle (ast-builder import path: names[]/specifiers[].imported
        // carry the unquoted text). `local` defaults to the same cooked value
        // when no `as` alias is given (live parity); the corpus always aliases.
        const startKind = currentKind(cursor);
        if (startKind !== TokenKind.Ident && startKind !== TokenKind.StringLit) {
            recordError(ctx, "E-STMT-IMPORT-NAME",
                "expected an imported name", spanHere(ctx));
            break;
        }
        const importedTok = advance(cursor);
        const imported = (startKind === TokenKind.StringLit)
            ? ((importedTok.cooked !== undefined && importedTok.cooked !== null)
                ? importedTok.cooked
                : "")
            : importedTok.name;
        let local = imported;
        if (currentKind(cursor) === TokenKind.KwAs) {
            advance(cursor);   // consume `as`
            local = importLocalName(ctx);
        }
        out.push(makeImportNamed(imported, local, importedTok.span));

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    if (currentKind(cursor) === TokenKind.RBrace) {
        advance(cursor);   // consume }
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-IMPORT",
            "expected '}' to close an import clause", spanHere(ctx));
    }
}

// --- parseExport — an `export ...` statement ---
//   export <declaration>             — export a let/const/function/class decl
//   export { a, b as c };            — named exports
//   export { a } from "m";           — named re-export
//   export * from "m";               — all re-export
//   export * as ns from "m";         — namespace re-export
//   export default <expr|decl>       — the default export
export function parseExport(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `export`

    // `export default ...`.
    if (currentKind(cursor) === TokenKind.KwDefault) {
        advance(cursor);   // consume `default`
        return parseExportDefault(ctx, kw);
    }

    // `export * [as ns] from "m"`.
    if (currentKind(cursor) === TokenKind.Star) {
        advance(cursor);   // consume *
        let nsName = null;
        if (currentKind(cursor) === TokenKind.KwAs) {
            advance(cursor);   // consume `as`
            if (currentKind(cursor) === TokenKind.Ident) {
                nsName = advance(cursor).name;
            } else {
                recordError(ctx, "E-STMT-EXPORT-NAME",
                    "expected a namespace name after 'as'", spanHere(ctx));
            }
        }
        expectFromKeyword(ctx);
        const source = expectModuleString(ctx);
        const endPos = finishStatementTerminator(ctx, kw);
        // A `*` re-export carries no per-name specifiers; the namespace-alias
        // form records the alias as one namespace specifier.
        const specs = [];
        if (nsName !== null) {
            specs.push(makeImportNamespace(nsName, kw.span));
        }
        return makeExport(null, specs, source, false,
            makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
    }

    // `export { a, b as c } [from "m"]`.
    if (currentKind(cursor) === TokenKind.LBrace) {
        const specifiers = [];
        parseExportSpecifierClause(ctx, specifiers);
        let source = null;
        if (currentKind(cursor) === TokenKind.KwFrom) {
            advance(cursor);   // consume `from`
            source = expectModuleString(ctx);
        }
        const endPos = finishStatementTerminator(ctx, kw);
        return makeExport(null, specifiers, source, false,
            makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
    }

    // `export <declaration>` — a let/const/var, function, async function,
    // function*, or class declaration follows the `export` keyword.
    const declaration = parseExportedDeclaration(ctx);
    let endPos = nodeEnd(declaration);
    const prevTok = lastTokenBefore(ctx);
    if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined
        && prevTok.span.end > endPos) {
        endPos = prevTok.span.end;
    }
    return makeExport(declaration, [], null, false,
        makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
}

// parseExportDefault — the body of `export default ...`. The cursor sits past
// `default`. A `function` / `async function` / `function*` / `class` lead is
// a declaration; anything else is an assignment-level expression.
function parseExportDefault(ctx, kw) {
    const cursor = ctx.cursor;
    const k = currentKind(cursor);

    let declaration = null;
    if (k === TokenKind.KwFunction) {
        declaration = parseFunctionDecl(ctx, false, true);
    } else if ((k === TokenKind.KwFn || k === TokenKind.KwServer || k === TokenKind.KwPure)
        && fnDeclLeadFollows(cursor)) {
        // M5-swap Wave 1 — `export default fn` / `... server fn` / `... pure
        // fn` (B6). A default-exported `fn` may be anonymous.
        declaration = parseScrmlFunctionDecl(ctx, true);
    } else if (k === TokenKind.KwAsync && peekKind(cursor, 1) === TokenKind.KwFunction) {
        // M4.3 — `export default async function` is RETRACTED. Fire
        // E-ASYNC-NOT-IN-SCRML at the `async` keyword and recover as a
        // plain default-function export.
        const asyncTok = advance(cursor);   // consume `async`
        recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
            "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            asyncTok.span);
        declaration = parseFunctionDecl(ctx, false, true);
    } else if (k === TokenKind.KwClass) {
        declaration = parseClassDecl(ctx, true);
    } else {
        // `export default <expression>;` — the default value is an
        // assignment-level expression.
        const prior = enterMode(ctx, ParseMode.InExpression);
        declaration = parseAssignmentExpr(ctx);
        exitMode(ctx, prior);
        reenterBlockStubs(declaration);
        const prevTok = lastTokenBefore(ctx);
        consumeSemicolon(ctx, prevTok);
    }

    let endPos = nodeEnd(declaration);
    const prevTok = lastTokenBefore(ctx);
    if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined
        && prevTok.span.end > endPos) {
        endPos = prevTok.span.end;
    }
    return makeExport(declaration, [], null, true,
        makeSpan(kw.span.start, endPos, kw.span.line, kw.span.col));
}

// parseExportedDeclaration — the declaration after `export` (not `default`).
// One of: a let/const/var declaration, a `lin` / `type` declaration, a
// function / `fn` / `server fn` / `pure fn` declaration, a class declaration.
//
// M5-swap Wave 1 fix (B5): `export type ...` previously fell through to the
// E-STMT-EXPORT-DECL error arm — `type` lexed as an `Ident` and the type was
// DROPPED entirely (`Export{declaration:null}`). With `type` now a keyword
// the `export type` interaction routes the declaration correctly.
function parseExportedDeclaration(ctx) {
    const cursor = ctx.cursor;
    const k = currentKind(cursor);

    if (k === TokenKind.KwLet || k === TokenKind.KwConst || k === TokenKind.KwVar) {
        return parseVarDecl(ctx);
    }
    // M5-swap Wave 1 — `export lin` / `export type` (B4 / B5).
    if (k === TokenKind.KwLin) {
        return parseLinDecl(ctx);
    }
    // P5-9 — `export type ...`. `type` is the contextual-keyword `Ident`; an
    // `export type` lead is unambiguously a type declaration (the only
    // well-formed reading of `type` after `export`).
    if (isContextualTypeLead(cursor)) {
        return parseTypeDecl(ctx);
    }
    if (k === TokenKind.KwFunction) {
        return parseFunctionDecl(ctx, false);
    }
    // M5-swap Wave 1 — `export fn` / `export server fn` / `export pure fn` (B6).
    if ((k === TokenKind.KwFn || k === TokenKind.KwServer || k === TokenKind.KwPure)
        && fnDeclLeadFollows(cursor)) {
        return parseScrmlFunctionDecl(ctx, false);
    }
    if (k === TokenKind.KwAsync && peekKind(cursor, 1) === TokenKind.KwFunction) {
        // M4.3 — `export async function` is RETRACTED. Fire
        // E-ASYNC-NOT-IN-SCRML at the `async` keyword and recover as a plain
        // named-function export.
        const asyncTok = advance(cursor);   // consume `async`
        recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
            "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            asyncTok.span);
        return parseFunctionDecl(ctx, false);
    }
    if (k === TokenKind.KwClass) {
        return parseClassDecl(ctx);
    }

    recordError(ctx, "E-STMT-EXPORT-DECL",
        "expected a declaration after 'export'", spanHere(ctx));
    return null;
}

// parseExportSpecifierClause — the `{ a, b as c }` clause of an export. The
// cursor sits on the `{`. Appends ExportSpecifier objects to `out`.
function parseExportSpecifierClause(ctx, out) {
    const cursor = ctx.cursor;
    advance(cursor);   // consume {

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        if (currentKind(cursor) !== TokenKind.Ident) {
            recordError(ctx, "E-STMT-EXPORT-NAME",
                "expected an exported name", spanHere(ctx));
            break;
        }
        const localTok = advance(cursor);
        const local = localTok.name;
        let exported = local;
        if (currentKind(cursor) === TokenKind.KwAs) {
            advance(cursor);   // consume `as`
            if (currentKind(cursor) === TokenKind.Ident) {
                exported = advance(cursor).name;
            } else {
                recordError(ctx, "E-STMT-EXPORT-NAME",
                    "expected an exported name after 'as'", spanHere(ctx));
            }
        }
        out.push(makeExportSpecifier(local, exported, localTok.span));

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    if (currentKind(cursor) === TokenKind.RBrace) {
        advance(cursor);   // consume }
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-EXPORT",
            "expected '}' to close an export clause", spanHere(ctx));
    }
}

// finishStatementTerminator — consume the statement terminator (explicit `;`
// or ASI) and return the byte offset of the last consumed token. Shared by
// the import / export statement parsers.
function finishStatementTerminator(ctx, kwTok) {
    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);
    if (prevTok !== undefined && prevTok !== null && prevTok.span !== undefined) {
        return prevTok.span.end;
    }
    return kwTok.span.end;
}

// =============================================================================
// try / catch / finally + throw — the legacy JS error-flow forms. PARSED for
// legacy + JS-import inputs; per S98 D5 these are REJECTED from scrml SOURCE
// (a later stage — the typer — does the source-rejection; scrml uses
// `fail`/`!{}` per SPEC §19). The parser's job here is solely to PARSE them.
// =============================================================================

// --- parseTry — a `try { } catch (param) { } finally { }` statement ---
// At least one of `catch` / `finally` must be present (a bare `try {}` is a
// JS syntax error); M3.3 records a diagnostic for the bare form and still
// emits the Try node.
//
// M5-swap Wave 2 (B7) — `try` is FORBIDDEN scrml vocabulary. scrml has no
// `try`/`catch`/`finally`; the error model is `fail` / `?` / `!{}` /
// `<errorBoundary>` (SPEC §19). parseTry fires E-TRY-NOT-IN-SCRML at the
// `try` keyword and RECOVERS by parsing the construct anyway (the underlying
// statements still parse cleanly so error recovery surfaces diagnostics on
// the rest of the program). This mirrors the M4.3 `E-ASYNC-NOT-IN-SCRML`
// posture — a forbidden keyword gets a parse-layer rejection, not a silent
// pass. The earlier E-STMT-TRY-NO-HANDLER stays as a malformed-construct
// diagnostic (the two are complementary: B7 rejects `try` as vocabulary,
// E-STMT-TRY-NO-HANDLER guards the JS-level well-formedness of the recovery).
export function parseTry(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `try`

    recordError(ctx, "E-TRY-NOT-IN-SCRML",
        "scrml has no `try`/`catch`/`finally`. The error model is `fail` (§19.3), the `?` propagate operator, the `!{}` guarded-expression handler, and `<errorBoundary>` — no source-level try/catch is needed.",
        kw.span);

    const block = parseBlock(ctx);

    let handler = null;
    if (currentKind(cursor) === TokenKind.KwCatch) {
        handler = parseCatchClause(ctx);
    }

    let finalizer = null;
    if (currentKind(cursor) === TokenKind.KwFinally) {
        advance(cursor);   // consume `finally`
        finalizer = parseBlock(ctx);
    }

    if ((handler === null || handler === undefined)
        && (finalizer === null || finalizer === undefined)) {
        recordError(ctx, "E-STMT-TRY-NO-HANDLER",
            "a 'try' needs a 'catch' or a 'finally'", kw.span);
    }

    let endE = nodeEnd(block);
    if (finalizer !== null && finalizer !== undefined) {
        endE = nodeEnd(finalizer);
    } else if (handler !== null && handler !== undefined) {
        endE = nodeEnd(handler);
    }
    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeTry(block, handler, finalizer, span);
}

// parseCatchClause — a `catch (param) { body }` clause. The cursor sits on
// `catch`. The `(param)` is optional (ES2019 optional catch binding —
// `catch { }`). `param` is a binding target (an identifier or a
// destructuring pattern).
function parseCatchClause(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `catch`

    let param = null;
    if (currentKind(cursor) === TokenKind.LParen) {
        advance(cursor);   // consume (
        param = parseBinding(ctx);
        if (currentKind(cursor) === TokenKind.RParen) {
            advance(cursor);   // consume )
        } else {
            recordError(ctx, "E-STMT-EXPECT-RPAREN",
                "expected ')' to close the 'catch' binding", spanHere(ctx));
        }
    }

    const body = parseBlock(ctx);
    const span = makeSpan(kw.span.start, nodeEnd(body), kw.span.line, kw.span.col);
    return makeCatchClause(param, body, span);
}

// --- parseThrow — a `throw argument` statement ---
// The no-LineTerminator restricted production: a `throw` with nothing on its
// source line is a syntax error in JS (`throw` requires an argument and ASI
// must NOT insert a `;` right after `throw`). M3.3 records a diagnostic for
// the no-argument form and still emits the Throw node.
//
// M5-swap Wave 2 (B7) — `throw` is FORBIDDEN scrml vocabulary. scrml uses
// `fail Type::Variant(...)` (SPEC §19.3), not `throw`. parseThrow fires
// E-THROW-NOT-IN-SCRML at the `throw` keyword and RECOVERS by parsing the
// argument anyway (the M4.3 `E-ASYNC-NOT-IN-SCRML` posture). The earlier
// E-STMT-THROW-NO-ARGUMENT stays as a malformed-construct diagnostic.
export function parseThrow(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `throw`

    recordError(ctx, "E-THROW-NOT-IN-SCRML",
        "scrml has no `throw`. To signal a failure use `fail Type::Variant(...)` (§19.3) inside an `!` failable function — no source-level throw is needed.",
        kw.span);

    if (sameLineFollows(ctx, kw) === false) {
        recordError(ctx, "E-STMT-THROW-NO-ARGUMENT",
            "'throw' must be followed by an expression on the same line", kw.span);
        const span = makeSpan(kw.span.start, kw.span.end, kw.span.line, kw.span.col);
        return makeThrow(null, span);
    }

    const prior = enterMode(ctx, ParseMode.InExpression);
    const argument = parseExpression(ctx);
    exitMode(ctx, prior);
    reenterBlockStubs(argument);

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const span = makeSpan(kw.span.start, nodeEnd(argument), kw.span.line, kw.span.col);
    return makeThrow(argument, span);
}

// =============================================================================
// Core scrml declaration productions — M5-swap Wave 1 (B4 / B5).
//
// The native parser was a JS-subset parser (M1-M4) plus the M2.4 scrml
// EXPRESSION extensions; it had no production for these scrml DECLARATION
// constructs. `lin` / `type` lexed as bare `Ident`s and mis-parsed (a `lin`
// lead → two adjacent statements / a `Labeled`; a `type X : enum = {...}`
// lead → `ExprStmt{Ident:"type"}` + `Labeled` garbage). B4 / B5 close that.
// =============================================================================

// --- parseLinDecl — a `lin name = expr` linear-binding declaration (B4) ---
//   lin-declaration ::= 'lin' identifier '=' expression
// SPEC §35.2: `lin` takes the same syntactic position as `let` / `const`. A
// `lin` declaration always has an initializer; a missing name or a missing
// `= expr` records a diagnostic and the parser recovers (the node is still
// emitted so downstream error recovery surfaces useful diagnostics).
export function parseLinDecl(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `lin`

    // The bound name. A `lin` declaration always names a single identifier
    // (SPEC §35.2 — no destructuring `lin` binding).
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else {
        recordError(ctx, "E-STMT-LIN-NAME",
            "expected a name after 'lin'", spanHere(ctx));
    }

    // The initializer. `lin` is single-consumption — it must bind a value.
    let init = null;
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume `=`
        const prior = enterMode(ctx, ParseMode.InExpression);
        init = parseAssignmentLevelExpr(ctx);
        exitMode(ctx, prior);
        reenterBlockStubs(init);
    } else {
        recordError(ctx, "E-STMT-LIN-INIT",
            "a 'lin' declaration must have an initializer ('lin name = expr')",
            spanHere(ctx));
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const endE = (init === undefined || init === null) ? kw.span.end : nodeEnd(init);
    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeLinDecl(name, init, span);
}

// --- parseGivenGuard — a `given x [, y]* => { body }` presence guard (D7) ---
//   given-guard ::= 'given' identifier (',' identifier)* '=>' '{' statement* '}'
// SPEC §42.2.3 presence-narrowing guard: the body runs only when EVERY named
// `T | not` variable is present (single: `given x => {...}`; multi:
// `given x, y => {...}` is all-or-nothing). The native parser mirrors the live
// ast-builder given-guard production (ast-builder.js:5485 / 9477) field-for-
// field — `variables` is the array of bound identifier-name strings, `body` is
// the guarded statement list (the `{ ... }` block contents, parsed via the
// shared parseStatementList — NOT a Block-wrapped node; the live `given-guard`
// carries a FLAT statement array). §42.2.3 v1 takes BARE identifiers, not
// property paths — a `given u.name` is rejected with E-SYNTAX-044 (mirroring
// live ast-builder.js:5494) and the dotted tail is skipped so parsing recovers.
// A leading `@` on a name (`given @x`) is stripped (live ast-builder.js:5492).
export function parseGivenGuard(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `given`

    // Collect comma-separated plain identifiers (§42.2.3 v1 — no property paths).
    const variables = [];
    while (currentKind(cursor) === TokenKind.Ident
           || currentKind(cursor) === TokenKind.ScrmlAt) {
        let name;
        if (currentKind(cursor) === TokenKind.ScrmlAt) {
            // `given @x` — the `@`-prefixed cell name. The live ast-builder
            // strips the leading `@` (ast-builder.js:5492). The native lexer
            // emits a ScrmlAt token carrying the bare name on `.name`.
            const atTok = advance(cursor);
            name = (atTok.name === undefined || atTok.name === null) ? "" : atTok.name;
            if (name.startsWith("@")) name = name.slice(1);
        } else {
            name = advance(cursor).name;
        }

        // §42.2.3: `given` takes bare identifiers, not property paths. Reject a
        // `given u.name` form (E-SYNTAX-044, mirroring live) and skip the dotted
        // tail so the parser keeps going.
        if (currentKind(cursor) === TokenKind.Dot) {
            recordError(ctx, "E-SYNTAX-044",
                "`given` takes bare identifiers, not property paths (§42.2.3). " +
                "Bind the property to a local variable first: `let n = " + name +
                ".<field>`, then `given n { ... }`.",
                spanHere(ctx));
            while (currentKind(cursor) === TokenKind.Dot) {
                advance(cursor);   // consume `.`
                if (currentKind(cursor) === TokenKind.Ident) advance(cursor);
            }
        }

        variables.push(name);
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume `,`
        } else {
            break;
        }
    }

    // Consume the `=>` arrow (the native lexer lexes `=>` as a single Arrow
    // token). A missing arrow is tolerated (the live production guards on
    // isMatchArrow but does not error when absent); the body parse below still
    // runs so a malformed guard recovers usefully.
    if (currentKind(cursor) === TokenKind.Arrow) {
        advance(cursor);   // consume `=>`
    }

    // Parse the guarded body — the `{ ... }` block contents as a FLAT statement
    // list (matching the live given-guard.body shape; not a Block node). Uses
    // the same parseStatementList path parseBlock uses, so nested decls /
    // functions / control flow inside the guard parse recursively.
    let body = [];
    let endE = kw.span.end;
    if (currentKind(cursor) === TokenKind.LBrace) {
        const open = advance(cursor);   // consume `{`
        const prior = enterMode(ctx, ParseMode.InBlock);
        body = parseStatementList(ctx, TokenKind.RBrace);
        exitMode(ctx, prior);
        endE = open.span.end;
        if (currentKind(cursor) === TokenKind.RBrace) {
            const close = advance(cursor);   // consume `}`
            endE = close.span.end;
        } else {
            recordError(ctx, "E-STMT-UNCLOSED-BLOCK",
                "expected '}' to close the `given` guard body", open.span);
        }
    }

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeGivenGuard(variables, body, span);
}

// --- typeBodyText — reconstruct the brace-delimited `type` body raw text ---
// The native lexer retains no raw source slice — every token carries `.text`.
// The live ast-builder's `type-decl` path produces `raw` as `"{ " + body
// + " }"` (a space-joined token stream). typeBodyText mirrors that: it
// consumes the balanced `{ ... }` at the cursor and joins the inner tokens'
// `.text` with single spaces. `raw` is "{ ... }" for the body form. A missing
// closing `}` records a diagnostic and the partial body is still returned.
function typeBodyText(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume `{`
    const parts = [];
    let depth = 1;
    while (atEnd(cursor) === false && depth > 0) {
        const k = currentKind(cursor);
        if (k === TokenKind.LBrace) {
            depth = depth + 1;
        } else if (k === TokenKind.RBrace) {
            depth = depth - 1;
            if (depth === 0) {
                advance(cursor);   // consume the matching `}`
                break;
            }
        }
        parts.push(advance(cursor).text);
    }
    if (depth > 0) {
        recordError(ctx, "E-STMT-TYPE-UNCLOSED-BODY",
            "expected '}' to close a type-declaration body", open.span);
    }
    const inner = parts.join(" ").trim();
    return "{ " + inner + " }";
}

// --- typeAliasText — reconstruct an inline `type` alias-expression raw text ---
// The alias form `type Name : kind` / `type Name = expr` carries an inline
// type expression (a primitive name, a union `number | string`). typeAliasText
// joins the alias tokens' `.text` up to the statement boundary. Stops at a
// `;`, at a `}` (an enclosing block close), or at a later-line token (ASI).
function typeAliasText(ctx) {
    const cursor = ctx.cursor;
    const parts = [];
    const startLine = lineOfToken(current(cursor));
    while (atEnd(cursor) === false) {
        const tok = current(cursor);
        const k = currentKind(cursor);
        if (k === TokenKind.Semicolon || k === TokenKind.RBrace) {
            break;
        }
        if (parts.length > 0 && lineOfToken(tok) > startLine) {
            break;   // ASI — the alias expression ended at the line boundary
        }
        parts.push(advance(cursor).text);
    }
    return parts.join(" ").trim();
}

// --- isContextualTypeLead — does a `type` declaration lead begin here? ---
//
// P5-9 — `type` is a CONTEXTUAL keyword (token.js): it lexes as an `Ident`
// carrying a `ctxKw:"type"` marker. This predicate is the SOLE gate that
// decides — by position — whether that token reads as a type-declaration
// keyword. It returns true iff the cursor sits on the contextual-`type`
// `Ident`; the callers (`parseStatement`, `parseExportedDeclaration`) only
// invoke it at statement / `export`-declaration position, so a `type` used as
// a binding name / parameter name / object key — which never reaches those
// dispatch sites — flows as an ordinary identifier. This mirrors the live
// block-splitter, whose `STMT_KEYWORDS` set treats a statement-lead `type`
// as a declaration keyword unconditionally.
function isContextualTypeLead(cursor) {
    const tok = current(cursor);
    return tok !== undefined && tok !== null
        && tok.kind === TokenKind.Ident && tok.ctxKw === "type";
}

// --- parseTypeDecl — a `type` declaration (B5) ---
//   type-declaration ::= 'type' identifier (':' kind)? '=' '{' body '}'
//                      | 'type' identifier (':' kind)? '=' alias-expr
//                      | 'type' identifier ':' kind
//                      | 'type' ':' kind identifier '{' body '}'    (§14.3.1)
// SPEC §14. Two source forms ride one TypeDecl node: the `: kind = {...}`
// struct / enum body form, and the `: kind` / `= expr` alias form. SPEC §14.3.1
// also specifies the kind-FIRST ordering — `type:struct Token { ... }` /
// `type:enum TokenKind { ... }` — where the `:kind` discriminator precedes the
// name. The self-host files use this form. The `export type ...` interaction
// is handled by parseExportedDeclaration (parseExport routes a `type` lead
// here). A missing type name records a diagnostic and recovery proceeds.
export function parseTypeDecl(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `type`

    // SPEC §14.3.1 — the kind-FIRST ordering `type :kind Name { ... }`. A
    // `:` IMMEDIATELY after `type` (before any name) is the discriminator;
    // the name follows it. Parsed here so the post-name body / alias logic
    // below is shared by both orderings. `typeKind` stays "" for the
    // name-first form (`type Name :kind`), filled by the branch below it.
    let typeKind = "";
    let kindParsedFirst = false;
    if (currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        kindParsedFirst = true;
        if (currentKind(cursor) === TokenKind.Ident) {
            typeKind = advance(cursor).name;
        } else {
            recordError(ctx, "E-STMT-TYPE-KIND",
                "expected a type kind ('enum' / 'struct' / ...) after ':'",
                spanHere(ctx));
        }
    }

    // The type name.
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else {
        recordError(ctx, "E-STMT-TYPE-NAME",
            "expected a name after 'type'", spanHere(ctx));
    }

    // The name-FIRST `: kind` discriminator (`type Name : kind ...`). Skipped
    // when the kind was already parsed in the §14.3.1 kind-first branch above.
    // `kind` is a bare identifier — `parseMemberProperty`-style: any Ident.
    if (kindParsedFirst === false && currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        if (currentKind(cursor) === TokenKind.Ident) {
            typeKind = advance(cursor).name;
        } else {
            recordError(ctx, "E-STMT-TYPE-KIND",
                "expected a type kind ('enum' / 'struct' / ...) after ':'",
                spanHere(ctx));
        }
    }

    // The body. `= { ... }` is the struct / enum body form; `= expr` (or a
    // bare `: kind` alias with no body) is the alias form.
    let raw = "";
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume `=`
        if (currentKind(cursor) === TokenKind.LBrace) {
            raw = typeBodyText(ctx);
        } else {
            raw = typeAliasText(ctx);
        }
    } else if (currentKind(cursor) === TokenKind.LBrace) {
        // Body form with no `=` (the self-host alternate `type Name : kind
        // { ... }` shape — the live ast-builder accepts the `=`-free form).
        raw = typeBodyText(ctx);
    }
    // A bare `type Name : kind` with no `= ...` and no `{ ... }` is the
    // forward-declared alias form — `raw` stays "".

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const endE = (prevTok === undefined || prevTok === null) ? kw.span.end : prevTok.span.end;
    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeTypeDecl(name, typeKind, raw, span);
}

// =============================================================================
// `~` tilde-declaration production — M5-swap Wave 2 (B3).
//
// `~name = pipeline` declares a pipeline-reactive cell (SPEC §32). The native
// parser knew `~` only as the §32 standalone pipeline-accumulator ATOM (the
// `Tilde` ExprKind, built by parse-expr's parsePrimary) and as the prefix
// bitwise-NOT operator (`~x`). B3 adds the statement-position DECLARATION.
//
// THE DISAMBIGUATION (prefix-bitwise-`~` / accumulator-`~` vs tilde-decl):
// `tildeDeclLeadFollows` commits to a tilde-declaration only when the `~` is
// SOURCE-ADJACENT to an identifier AND that identifier is immediately followed
// by `=`. `~total = ...` matches; `~x` (bitwise-NOT, no `=`) and a standalone
// `~` accumulator (no adjacent identifier) do not. A `~x = ...` at statement
// position is unambiguous: `~x` is not a valid assignment target, so the only
// well-formed reading of `~ Ident =` at statement position is a declaration.
// =============================================================================

// --- tildeDeclLeadFollows — does a `~name =` tilde-declaration lead begin? ---
// The cursor sits on a `BitNot` token. True iff the next token is an `Ident`
// SOURCE-ADJACENT to the `~` (no whitespace between — `~total`, not `~ total`)
// and the token after the identifier is `=` (`Assign`). This is the same
// source-adjacency discriminator `tildeIsStandalone` (parse-expr.js) uses to
// tell a bitwise-`~` from the §32 accumulator atom.
export function tildeDeclLeadFollows(cursor) {
    if (currentKind(cursor) !== TokenKind.BitNot) {
        return false;
    }
    const tilde = current(cursor);
    const name = peek(cursor, 1);
    const after = peek(cursor, 2);
    if (tilde === undefined || tilde === null || name === undefined || name === null) {
        return false;
    }
    if (name.kind !== TokenKind.Ident) {
        return false;
    }
    // Source-adjacency — the `~` must abut the identifier (`~total`). A gap
    // (`~ total`) is a standalone accumulator `~` followed by an identifier,
    // NOT a tilde-declaration lead.
    if (tilde.span === undefined || name.span === undefined
        || name.span.start !== tilde.span.end) {
        return false;
    }
    // The trailing `=` — a tilde DECLARATION assigns its pipeline.
    if (after === undefined || after === null || after.kind !== TokenKind.Assign) {
        return false;
    }
    return true;
}

// --- parseTildeDecl — a `~name = pipeline` tilde declaration (B3) ---
//   tilde-declaration ::= '~' identifier '=' expression
// SPEC §32. A `~` declaration always has an initializer; a missing name or a
// missing `= expr` records a diagnostic and the parser recovers (the node is
// still emitted so downstream error recovery surfaces useful diagnostics).
// Structural twin of `parseLinDecl` (B4).
export function parseTildeDecl(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `~`

    // The bound name. `tildeDeclLeadFollows` already confirmed an Ident
    // follows, but parseTildeDecl is also exported for direct testing — guard
    // defensively.
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else {
        recordError(ctx, "E-STMT-TILDE-NAME",
            "expected a name after '~' in a tilde declaration", spanHere(ctx));
    }

    // The initializer — the pipeline expression. A `~` declaration must bind
    // a value.
    let init = null;
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume `=`
        const prior = enterMode(ctx, ParseMode.InExpression);
        init = parseAssignmentLevelExpr(ctx);
        exitMode(ctx, prior);
        reenterBlockStubs(init);
    } else {
        recordError(ctx, "E-STMT-TILDE-INIT",
            "a '~' declaration must have an initializer ('~name = pipeline')",
            spanHere(ctx));
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const endE = (init === undefined || init === null) ? kw.span.end : nodeEnd(init);
    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeTildeDecl(name, init, span);
}

// =============================================================================
// V5-strict structural state-decl at statement position — P5-11.
//
// SPEC §6.2 — inside a `${...}` logic body a `<NAME ...> = expr` line declares
// a reactive state cell (Shape 1), `<NAME>: T = expr` the typed form (§35.2),
// and `<NAME>=expr` the no-whitespace fused form. The live oracle recognizes
// this at statement position via `parseLogicBody`'s `tryParseStructuralDecl`
// (ast-builder.js:3696) — a `<` IDENT lead whose opener `>` (or fused `>=`) is
// followed by a `=` (not `==` / `=>`) or a `:` decl signal.
//
// Without statement-position recognition the `<` lexes as `LessThan`, the
// statement falls through to `parseExprStatement`, and `parseMarkupValue`
// (parse-expr.js) — entered for a `<` IDENT — over-consumes the whole rest of
// the body as one markup blob until the next `</>`. A following
// `const Card = <div>...</>` component-def line is then swallowed into that
// blob and never parses as its own `VarDecl` — so `collect-hoisted.js` never
// registers the component (the P5-11 `components live=1 native=0` gap on the
// `phase4-component-reactive-prop-056` / `-jsx-brace-ghost-057` corpus files).
//
// `structuralStateDeclLeadFollows` is the token-cursor analogue of the live
// `scanStructuralDeclLookahead` recognizer (ast-builder.js:4080) and the
// markup-layer's source-string `isStateDeclOpenerAt` (parse-markup.js:266):
// peek past the `<` IDENT opener body — balancing `()` / `{}` / `[]` so an
// attribute value containing `>` does not end the scan early — to the opener's
// top-level `>` (or fused `>=`), then confirm the `=` / `:` decl signal.

// constStructuralStateDeclLeadFollows — calculation (predicate, non-mutating
// cursor peek). True when the cursor is at `const <` IDENT structural state-decl
// opener — the SPEC §6.6 derived form `const <name> = expr`. Delegates to
// `structuralStateDeclLeadFollows`'s scan logic but shifted +1 to account for
// the leading `const` keyword. M6.5.b.2.
export function constStructuralStateDeclLeadFollows(cursor) {
    if (currentKind(cursor) !== TokenKind.KwConst) {
        return false;
    }
    if (peekKind(cursor, 1) !== TokenKind.LessThan) {
        return false;
    }
    if (peekKind(cursor, 2) !== TokenKind.Ident) {
        return false;
    }
    // Same lookahead body as structuralStateDeclLeadFollows but starting at
    // scanIdx = 3 (skip `const`, `<`, IDENT).
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let scanIdx = 3;
    while (true) {
        const t = peek(cursor, scanIdx);
        if (t === undefined || t === null || t.kind === TokenKind.EOF) {
            return false;
        }
        const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
        if (topLevel) {
            if (t.kind === TokenKind.GreaterEqual) {
                return scanIdx === 3;
            }
            if (t.kind === TokenKind.GreaterThan) {
                const signal = peek(cursor, scanIdx + 1);
                if (signal === undefined || signal === null) {
                    return false;
                }
                if (signal.kind === TokenKind.Assign) {
                    return true;
                }
                if (signal.kind === TokenKind.Colon) {
                    return true;
                }
                return false;
            }
        }
        if (t.kind === TokenKind.LParen) parenDepth = parenDepth + 1;
        else if (t.kind === TokenKind.RParen && parenDepth > 0) parenDepth = parenDepth - 1;
        else if (t.kind === TokenKind.LBrace) braceDepth = braceDepth + 1;
        else if (t.kind === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
        else if (t.kind === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
        else if (t.kind === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
        scanIdx = scanIdx + 1;
    }
}

// structuralStateDeclLeadFollows — calculation (predicate, non-mutating
// cursor peek). True when the cursor is at a `<` IDENT structural state-decl
// opener. Declines (false) for an ordinary markup-as-value `<div>...</>` — a
// markup tag's `>` is followed by tag content, not a `=` / `:` decl signal.
export function structuralStateDeclLeadFollows(cursor) {
    if (currentKind(cursor) !== TokenKind.LessThan) {
        return false;
    }
    // peek(1) must be the cell-name identifier. A bare `<` followed by
    // anything else (`</` closer, `<` NUMBER comparison) is not a decl opener.
    if (peekKind(cursor, 1) !== TokenKind.Ident) {
        return false;
    }
    // Scan the opener's attribute region from peek(2) to its top-level `>`.
    // `()` / `{}` / `[]` are depth-tracked so a `>` inside an attribute value
    // (`<x len(>=2)> = 0`, `<x props={a > b}> = 0`) is not mistaken for the
    // opener's close. A bounded scan — a stray unbalanced `<` IDENT with no
    // closing `>` declines rather than running away.
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let scanIdx = 2;
    while (true) {
        const t = peek(cursor, scanIdx);
        if (t === undefined || t === null || t.kind === TokenKind.EOF) {
            return false; // ran off the end with no `>` — not a decl opener
        }
        const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
        if (topLevel) {
            // Fused `>=` OPERATOR — the no-whitespace `<count>=0` form. Only
            // valid with NO attribute region (scanIdx === 2): a fused `>=`
            // after an attribute is a comparison, not a decl closer. The
            // fused token IS both the opener close and the decl signal.
            if (t.kind === TokenKind.GreaterEqual) {
                return scanIdx === 2;
            }
            // Top-level `>` — the opener close. The token AFTER it is the
            // decl signal: `=` (Shape 1 / typed RHS) or `:` (§35.2 typed).
            if (t.kind === TokenKind.GreaterThan) {
                const signal = peek(cursor, scanIdx + 1);
                if (signal === undefined || signal === null) {
                    return false;
                }
                // `=` — the Shape-1 / typed-RHS decl signal. `Assign` is
                // exactly `=`; `==` / `===` lex as distinct Equal-family
                // tokens and `=>` as `Arrow`, so a bare `Assign` here is
                // unambiguously a decl signal, never a comparison / arrow.
                if (signal.kind === TokenKind.Assign) {
                    return true;
                }
                // `:` — the §35.2 typed-state-decl signal (`<x>: T = e`).
                if (signal.kind === TokenKind.Colon) {
                    return true;
                }
                // `>` followed by anything else is a markup tag close — the
                // body / children follow. Not a state-decl.
                return false;
            }
        }
        // Depth tracking — `()` / `{}` / `[]` balance.
        if (t.kind === TokenKind.LParen) parenDepth = parenDepth + 1;
        else if (t.kind === TokenKind.RParen && parenDepth > 0) parenDepth = parenDepth - 1;
        else if (t.kind === TokenKind.LBrace) braceDepth = braceDepth + 1;
        else if (t.kind === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
        else if (t.kind === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
        else if (t.kind === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
        scanIdx = scanIdx + 1;
    }
}

// --- parseStructuralStateDecl — a `<NAME ...> = expr` structural state-decl ---
//   structural-state-decl ::= '<' IDENT attr-region? ('>' | '>=') typeAnn? '=' expr
//   typeAnn               ::= ':' <type-expression>     (§35.2)
// SPEC §6.2. The caller (`parseStatement`) has confirmed the opener shape via
// `structuralStateDeclLeadFollows`. The opener's attribute region carries
// structural-decl modifier attributes — `pinned` / `server` baretokens, the
// `default=expr` (SPEC §6.8) reset-target, and the reactivity attributes
// `debounced=DURATION` / `throttled=DURATION` (SPEC §6.13). They are captured
// here as raw text + flags so translate-stmt can hoist them into the live
// `state-decl` payload (initially the attr-region was consumed verbatim with
// no decomposition — sufficient for the older "parse cleanly" target only).
// Validators (SPEC §55) — bareword + call-form predicate attributes — are
// also captured here as raw entries; full validator-arg parsing (B9-style
// RelationalPredicateNode synthesis) is the live ast-builder's concern and
// is NOT mirrored at the native layer in M6.5.b.2 scope.
//
// The `isConst` arg distinguishes the SPEC §6.6 derived form (`const <x> = expr`)
// from the plain SPEC §6.2 Shape 1 form (`<x> = expr`). The live `shape` field
// is derived as `"derived"` when isConst, else `"plain"`.
//
// The produced node carries `kind: "StateDecl"` — a logic-body LogicStatement
// `translate-stmt.js` maps to the live `state-decl` LogicStatement (M6.5.b.2).
// Mirrors the live `state-decl` shape (compiler/src/types/ast.ts:502).
export function parseStructuralStateDecl(ctx, isConst) {
    const cursor = ctx.cursor;
    const isConstFlag = isConst === true;
    const open = advance(cursor);   // consume `<`

    // The cell name — `structuralStateDeclLeadFollows` confirmed an Ident.
    let name = "";
    if (currentKind(cursor) === TokenKind.Ident) {
        name = advance(cursor).name;
    } else {
        recordError(ctx, "E-STMT-STATE-DECL-NAME",
            "expected a name after '<' in a structural state declaration",
            spanHere(ctx));
    }

    // Consume the opener's attribute region up to its top-level `>` (or fused
    // `>=`). The lead predicate already proved a closer exists — the same
    // `()` / `{}` / `[]` balancing keeps an attribute-value `>` from ending
    // the consume early. A fused `>=` is BOTH the close and the `=` signal.
    //
    // While consuming, RECOGNIZE the structural-decl attribute vocabulary:
    //   - `pinned`     bareword (SPEC §6.10)
    //   - `server`     bareword (SPEC §52 / §6.13 — opt-into-server-authoritative)
    //   - `default=e`  reset-target expression (SPEC §6.8)
    //   - `debounced=` / `throttled=`  reactivity attributes (SPEC §6.13)
    //   - bareword IDENT (other) → validator entry (`req`, `email`, etc.)
    //   - IDENT `(` args `)` → call-form validator (`length(>=2)`, `pattern(/.../)`)
    // Unrecognized attribute shapes fall through into the consume loop as raw
    // tokens — the parse still succeeds; only the recognized attrs surface on
    // the AST node.
    let fusedGtEq = false;
    let pinnedFlag = false;
    let serverFlag = false;
    let defaultExprRaw = null;
    let debouncedRaw = null;
    let throttledRaw = null;
    const validators = [];
    {
        let parenDepth = 0;
        let braceDepth = 0;
        let bracketDepth = 0;
        while (atEnd(cursor) === false) {
            const k = currentKind(cursor);
            const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
            if (topLevel && k === TokenKind.GreaterEqual) {
                advance(cursor);   // consume the fused `>=` (close + `=` signal)
                fusedGtEq = true;
                break;
            }
            if (topLevel && k === TokenKind.GreaterThan) {
                advance(cursor);   // consume the opener close `>`
                break;
            }
            // ─── Attribute-region recognition (only at top level) ────────────
            // A bareword IDENT (or hard-keyword `server` / `default` — the
            // tokenizer lexes them as KwServer / KwDefault even at attribute
            // position — see lex output table) followed by `=` is a NAMED
            // attribute. A bareword IDENT followed by `(` is a CALL-FORM
            // attribute (validator with args). A bareword IDENT followed by
            // anything else is a BAREWORD attribute (pinned / server / a
            // bareword validator like `req`).
            //
            // The recognized attribute names live in two token-kind buckets:
            //   Ident-text:   pinned, debounced, throttled, req, length, ...
            //   Hard-Kw text: server (KwServer), default (KwDefault)
            // We collapse both via `isAttrNameToken` + a name-extractor.
            if (topLevel && isAttrNameToken(k)) {
                const idTok = current(cursor);
                const idName = attrNameOf(idTok);
                const nextK = peekKind(cursor, 1);
                if (nextK === TokenKind.Assign) {
                    // `name=expr` form. The recognized names are `default`,
                    // `debounced`, `throttled`. Others fall through to raw
                    // consume of the value, captured nowhere — preserves the
                    // P5-11 "consume exactly" guarantee without recording an
                    // unknown-attribute diagnostic (live ast-builder is also
                    // lenient at the parse level).
                    advance(cursor);   // consume the attr name token
                    advance(cursor);   // consume `=`
                    const raw = collectAttrValueRaw(ctx);
                    if (idName === "default") {
                        defaultExprRaw = raw;
                    } else if (idName === "debounced") {
                        debouncedRaw = raw;
                    } else if (idName === "throttled") {
                        throttledRaw = raw;
                    }
                    // unrecognized — silently dropped (raw text already consumed)
                    continue;
                }
                if (nextK === TokenKind.LParen) {
                    // Call-form attribute — `length(>=2)`, `pattern(/.../)`,
                    // `min(0)`, etc. Capture the predicate name + raw args
                    // text. Full B9-style sub-grammar parse (relational
                    // predicate node synthesis) is the live ast-builder's
                    // concern, NOT M6.5.b.2 scope.
                    advance(cursor);   // consume attr-name token
                    advance(cursor);   // consume `(`
                    const argsRaw = collectBalancedParenContents(ctx);
                    validators.push({ name: idName, args: argsRaw === null ? [] : [argsRaw] });
                    continue;
                }
                // Bareword attribute — `pinned`, `server`, or a bareword
                // validator (`req`, `email`, `numeric`, etc.).
                advance(cursor);
                if (idName === "pinned") {
                    pinnedFlag = true;
                } else if (idName === "server") {
                    serverFlag = true;
                } else {
                    // bareword validator — args:null per AST-CONTRACTS §1.1
                    validators.push({ name: idName, args: null });
                }
                continue;
            }
            // ─── Non-IDENT tokens inside attr region — depth-track + skip ────
            if (k === TokenKind.LParen) parenDepth = parenDepth + 1;
            else if (k === TokenKind.RParen && parenDepth > 0) parenDepth = parenDepth - 1;
            else if (k === TokenKind.LBrace) braceDepth = braceDepth + 1;
            else if (k === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
            else if (k === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
            else if (k === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
            advance(cursor);
        }
    }

    // §35.2 typed form — a `:` after the opener `>` introduces a type
    // annotation that runs to the `=`. Consume the annotation tokens raw
    // (`<type-expression>` decomposition is the type-system's concern).
    let typeAnnotation = "";
    if (fusedGtEq === false && currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        const annParts = [];
        let parenDepth = 0;
        let braceDepth = 0;
        let bracketDepth = 0;
        while (atEnd(cursor) === false) {
            const k = currentKind(cursor);
            const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
            if (topLevel && k === TokenKind.Assign) {
                break;   // the `=` ends the annotation; the RHS follows
            }
            if (k === TokenKind.LParen) parenDepth = parenDepth + 1;
            else if (k === TokenKind.RParen && parenDepth > 0) parenDepth = parenDepth - 1;
            else if (k === TokenKind.LBrace) braceDepth = braceDepth + 1;
            else if (k === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
            else if (k === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
            else if (k === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
            const annTok = advance(cursor);
            annParts.push(annTok.text === undefined || annTok.text === null ? "" : annTok.text);
        }
        typeAnnotation = annParts.join(" ");
    }

    // The initializer. The whitespace form has its `=` still at the cursor;
    // the fused `>=` form already consumed its `=` signal. A missing `=`
    // records a diagnostic and recovers (the node is still emitted).
    //
    // M6.5.b.2.1 — set `atStateDeclStmtPos` around the initializer parse. This
    // is one of the two statement-collector positions (the other is
    // parseExprStatement) where a newline-then-`<NAME ...> =` sequence is a
    // SIBLING state-decl boundary, NOT a relational `<` in the initializer.
    // parseBinary's LessThan guard (isAtStateDeclBoundary) reads this flag and
    // STOPS the climb at the boundary, leaving the sibling `<` for the
    // enclosing statement loop. Without it, `<x> = 0` newline `<y> = 1`
    // collapses to one StateDecl with a greedy garbage init. Saved + restored
    // (not just set) so a NESTED state-decl-init context restores correctly.
    let init = null;
    if (fusedGtEq === true) {
        const prior = enterMode(ctx, ParseMode.InExpression);
        const sdPrior = ctx.atStateDeclStmtPos;
        ctx.atStateDeclStmtPos = true;
        init = parseAssignmentLevelExpr(ctx);
        ctx.atStateDeclStmtPos = sdPrior;
        exitMode(ctx, prior);
        reenterBlockStubs(init);
    } else if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume `=`
        const prior = enterMode(ctx, ParseMode.InExpression);
        const sdPrior = ctx.atStateDeclStmtPos;
        ctx.atStateDeclStmtPos = true;
        init = parseAssignmentLevelExpr(ctx);
        ctx.atStateDeclStmtPos = sdPrior;
        exitMode(ctx, prior);
        reenterBlockStubs(init);
    } else {
        recordError(ctx, "E-STMT-STATE-DECL-INIT",
            "a structural state declaration must have an initializer ('<name> = expr')",
            spanHere(ctx));
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const endE = (init === undefined || init === null) ? open.span.end : nodeEnd(init);
    const span = makeSpan(open.span.start, endE, open.span.line, open.span.col);
    // Per AST-CONTRACTS §1.1 + types/ast.ts:502 ReactiveDeclNode:
    //   shape: "derived" iff isConst === true, else "plain". A `decl-with-spec`
    //   Shape 2 (markup-RHS) is OUT OF SCOPE for M6.5.b.2 (it's a separate
    //   class of divergence — markup-RHS detection requires native markup-tag
    //   recognition at the RHS position).
    // The native StateDecl carries the SAME field names + value types as the
    // live ReactiveDeclNode so translate-stmt.js can do a structural copy.
    return {
        kind: "StateDecl",
        name,
        typeAnnotation,
        structuralForm: true,
        isConst: isConstFlag,
        shape: isConstFlag ? "derived" : "plain",
        defaultExprRaw,
        pinned: pinnedFlag,
        server: serverFlag,
        debouncedRaw,
        throttledRaw,
        validators,
        init,
        span,
    };
}

// --- parseServerAtStateDecl — the `server @name [: Type] = expr` form ---
// M6.7-C2. SPEC §52.4 cell-authority modifier on the LEGACY `@`-form reactive
// declaration. The live oracle is ast-builder.js:4879 (`server` KEYWORD +
// AT_IDENT -> `state-decl{ isServer:true, structuralForm:false, shape:"plain",
// isConst:false }`). The dispatcher confirmed `KwServer` is immediately followed
// by a `ScrmlAt` token (the `@name` ident — the tokenizer fuses the `@` sigil
// into the ident text, so `@a` is ONE `ScrmlAt` token whose `.text` is `"@a"`).
//
// The produced node is a native `StateDecl` with `structuralForm:false` — the
// translate-stmt bridge's makeStateDeclNode reads that flag to emit the live
// legacy-`@`-form shape (vs the V5-strict `<name>` structural shape). `server`
// is set so the bridge maps it to live `isServer:true`. Type annotation (`:T`)
// is captured raw, mirroring parseStructuralStateDecl's §35.2 handling.
function parseServerAtStateDecl(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);          // consume `server`
    const atTok = advance(cursor);       // consume `@name` (ScrmlAt)
    // Strip the leading `@` sigil — live's `state-decl.name` is the bare cell
    // name (ast-builder.js:4885 `atTok.text.slice(1)`).
    const atText = atTok.text === undefined || atTok.text === null ? "" : atTok.text;
    const name = atText.charAt(0) === "@" ? atText.slice(1) : atText;

    // §35.2/§53 optional type annotation — `server @name: Type = expr`. Consume
    // the annotation tokens raw up to the `=`, depth-tracking delimiters (the
    // same shape parseStructuralStateDecl uses for its typed form).
    let typeAnnotation = "";
    if (currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);   // consume `:`
        const annParts = [];
        let parenDepth = 0;
        let braceDepth = 0;
        let bracketDepth = 0;
        while (atEnd(cursor) === false) {
            const k = currentKind(cursor);
            const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
            if (topLevel && k === TokenKind.Assign) {
                break;   // the `=` ends the annotation; the RHS follows
            }
            if (k === TokenKind.LParen) parenDepth = parenDepth + 1;
            else if (k === TokenKind.RParen && parenDepth > 0) parenDepth = parenDepth - 1;
            else if (k === TokenKind.LBrace) braceDepth = braceDepth + 1;
            else if (k === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
            else if (k === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
            else if (k === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
            const annTok = advance(cursor);
            annParts.push(annTok.text === undefined || annTok.text === null ? "" : annTok.text);
        }
        typeAnnotation = annParts.join(" ");
    }

    // The initializer. `server @x` REQUIRES an `=` RHS (a bare `server @x` with
    // no init is malformed — live ast-builder.js:4903 recovers it as a bare-expr;
    // here we record a diagnostic and emit the node with a null init so the rest
    // of the program still parses). Set `atStateDeclStmtPos` around the init parse
    // exactly as parseStructuralStateDecl does, so a sibling `<NAME> =` on the
    // next line is not greedily consumed into this initializer.
    let init = null;
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume `=`
        const prior = enterMode(ctx, ParseMode.InExpression);
        const sdPrior = ctx.atStateDeclStmtPos;
        ctx.atStateDeclStmtPos = true;
        init = parseAssignmentLevelExpr(ctx);
        ctx.atStateDeclStmtPos = sdPrior;
        exitMode(ctx, prior);
        reenterBlockStubs(init);
    } else {
        recordError(ctx, "E-STMT-STATE-DECL-INIT",
            "a `server @var` declaration must have an initializer ('server @name = expr')",
            spanHere(ctx));
    }

    const prevTok = lastTokenBefore(ctx);
    consumeSemicolon(ctx, prevTok);

    const endE = (init === undefined || init === null) ? atTok.span.end : nodeEnd(init);
    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);

    // Native StateDecl — legacy `@`-form. Field names + value types match the
    // live ReactiveDeclNode (ast.ts:502) so translate-stmt does a structural copy.
    return {
        kind: "StateDecl",
        name,
        typeAnnotation,
        structuralForm: false,
        isConst: false,
        shape: "plain",
        defaultExprRaw: null,
        pinned: false,
        server: true,
        debouncedRaw: null,
        throttledRaw: null,
        validators: [],
        init,
        span,
    };
}

// collectAttrValueRaw — consume an attribute value's raw text up to the next
// attribute boundary (top-level `>`, EOF, or a bareword IDENT/KEYWORD that
// signals the next attribute). Depth-tracks `()` / `{}` / `[]` so an attribute
// value containing balanced delimiters is consumed in full. Returns the joined
// raw text (may be empty). The cursor is left at the boundary token.
//
// Conservatively follows the live `default=` collector pattern at
// ast-builder.js:4338 — the heuristic "IDENT/KEYWORD at top-level when an
// expression token is not expected" boundaries the value. Used by `default=`,
// `debounced=`, `throttled=`, and any other future named structural-decl attr.
function collectAttrValueRaw(ctx) {
    const cursor = ctx.cursor;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    const parts = [];
    let expectingExpr = true;
    while (atEnd(cursor) === false) {
        const tok = current(cursor);
        const k = tok.kind;
        const topLevel = (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0);
        if (topLevel && k === TokenKind.GreaterThan) break;
        if (topLevel && k === TokenKind.GreaterEqual) break;
        if (topLevel && !expectingExpr && k === TokenKind.Ident) {
            // Unit suffix exception — `ms`/`s`/`m`/`h` immediately after a
            // NUMBER or `}` is part of a duration literal, not the next
            // attribute boundary. Mirrors the live `default=` collector
            // (ast-builder.js:4466).
            const nm = tok.name === undefined ? tok.text : tok.name;
            const isUnit = (nm === "ms" || nm === "s" || nm === "m" || nm === "h");
            const prev = parts.length > 0 ? parts[parts.length - 1] : null;
            const prevIsNumOrCloseBrace = (prev !== null && (/^[0-9]/.test(prev) || prev === "}"));
            if (!(isUnit && prevIsNumOrCloseBrace)) break;
        }
        if (k === TokenKind.LParen) { parenDepth = parenDepth + 1; expectingExpr = true; }
        else if (k === TokenKind.RParen && parenDepth > 0) { parenDepth = parenDepth - 1; expectingExpr = false; }
        else if (k === TokenKind.LBrace) { braceDepth = braceDepth + 1; expectingExpr = true; }
        else if (k === TokenKind.RBrace && braceDepth > 0) { braceDepth = braceDepth - 1; expectingExpr = false; }
        else if (k === TokenKind.LBracket) { bracketDepth = bracketDepth + 1; expectingExpr = true; }
        else if (k === TokenKind.RBracket && bracketDepth > 0) { bracketDepth = bracketDepth - 1; expectingExpr = false; }
        else if (k === TokenKind.Number || k === TokenKind.String || k === TokenKind.Ident) {
            expectingExpr = false;
        } else {
            // operators / punctuation other than the depth-trackers — keep
            // expectingExpr in the prior state. Setting it back to true is
            // safest (the next token is most likely an operand of whatever
            // operator we just consumed).
            expectingExpr = true;
        }
        const partText = tok.text === undefined || tok.text === null ? "" : tok.text;
        parts.push(partText);
        advance(cursor);
    }
    return parts.length === 0 ? "" : parts.join(" ").trim();
}

// isAttrNameToken — true iff the token kind can appear as an attribute name
// inside a structural-decl opener's attribute region. Most are Ident; the
// hard-keyword tokens `KwDefault` (`default`), `KwServer` (`server`), and
// (defensively) the contextual `KwPure` / `KwFn` / etc. appear here when used
// as bareword attributes. The tokenizer lexes them as Kw* regardless of
// position, so the attribute-region scanner must accept the full keyword
// surface where it makes sense.
function isAttrNameToken(kind) {
    return (
        kind === TokenKind.Ident ||
        kind === TokenKind.KwDefault ||
        kind === TokenKind.KwServer ||
        kind === TokenKind.KwPure
    );
}

// attrNameOf — extract the bareword name from an attribute-name token (Ident
// or any hard-keyword listed in `isAttrNameToken`). For Ident the canonical
// name field is `tok.name`; for Kw* tokens the bareword text lives on `tok.text`.
function attrNameOf(tok) {
    if (tok === undefined || tok === null) return "";
    if (tok.kind === TokenKind.Ident) {
        return tok.name === undefined || tok.name === null ? (tok.text === undefined ? "" : tok.text) : tok.name;
    }
    return tok.text === undefined || tok.text === null ? "" : tok.text;
}

// collectBalancedParenContents — consume tokens inside a `(` ... `)` pair
// already past the opening `(`. Returns the joined raw text (may be empty if
// the paren is closed immediately). Consumes the closing `)`. Depth-tracks
// nested `()` / `{}` / `[]`.
function collectBalancedParenContents(ctx) {
    const cursor = ctx.cursor;
    let parenDepth = 1;   // we're already INSIDE the outer `(`
    let braceDepth = 0;
    let bracketDepth = 0;
    const parts = [];
    while (atEnd(cursor) === false) {
        const tok = current(cursor);
        const k = tok.kind;
        if (k === TokenKind.RParen) {
            parenDepth = parenDepth - 1;
            if (parenDepth === 0) {
                advance(cursor);   // consume the closing `)`
                break;
            }
        } else if (k === TokenKind.LParen) parenDepth = parenDepth + 1;
        else if (k === TokenKind.LBrace) braceDepth = braceDepth + 1;
        else if (k === TokenKind.RBrace && braceDepth > 0) braceDepth = braceDepth - 1;
        else if (k === TokenKind.LBracket) bracketDepth = bracketDepth + 1;
        else if (k === TokenKind.RBracket && bracketDepth > 0) bracketDepth = bracketDepth - 1;
        const partText = tok.text === undefined || tok.text === null ? "" : tok.text;
        parts.push(partText);
        advance(cursor);
    }
    return parts.length === 0 ? "" : parts.join(" ").trim();
}

// =============================================================================
// `^{ ... }` meta-block at statement position — P5-3.
//
// A `^{}` meta block (SPEC §40 — file-/body-top dynamic-import + metadata
// escape) can open the body of a `${...}` logic escape. The self-host files
// (`compiler/self-host/{bpp,bs,tab}.scrml`) all do exactly this: the `${...}`
// body opens with a `^{ const {...} = await import(...) }` meta block, then a
// run of `export function` declarations follows.
//
// The native lexer has NO dedicated `^{` sigil token — a `^` lexes as the
// `BitXor` operator. Without statement-position recognition the `${...}` body
// statement loop (parseStatementList -> parseStatement) reaches `^` at
// statement head, routes it to parseExprStatement, and the expression grammar
// stalls on a `^` with no left operand. The forward-progress guard then bails
// the WHOLE statement loop — every sibling `export function` after the meta
// block is silently dropped (`bpp.scrml`: live exports 4 / native 0;
// `tab.scrml`: 105 live nodes vs 53 native — half the body lost).
//
// The fix: recognize a source-adjacent `^{` at statement position and consume
// the brace-delimited body as ONE statement so the loop continues to the
// sibling declarations. The body is a run of scrml-native statements — the
// same catalog any block body carries — so it is parsed by the existing
// parseStatementList machinery (parseBlock).
//
// PARTIAL-FIX NOTE (deferred follow-on): the live pipeline wraps the meta
// block's body in a dedicated `meta` ASTNode (a `logic > meta > const-decl,
// import-decl, ...` shape). This native fix recovers the body content + every
// sibling declaration, but emits the meta body as a `Block` statement, which
// the A1 bridge (translate-stmt.js) FLATTENS into the surrounding logic-body
// stream — so the `meta` wrapper node is absent. Restoring the `meta` wrapper
// needs a dedicated `StmtKind.Meta` (ast-stmt.js) + an A1-bridge arm
// (translate-stmt.js) — both OUT of this unit's `parse-stmt.js`-only scope.
// The catastrophic statement-loop truncation is closed here; the residual
// `meta`-wrapper fidelity is a clean follow-on.

// metaBlockLeadFollows — predicate. The cursor is at statement head; does a
// `^{` meta-block opener begin here? A `^` (`BitXor` token) must be IMMEDIATELY
// followed — source-adjacent — by a `{` (`LBrace`). A `^` used as a bitwise-XOR
// operator (`a ^ b`) never reaches statement head with a `{` abutting it; the
// adjacency test keeps a stray `^ {` (a XOR against an object literal — itself
// a non-scrml shape) out of this branch.
export function metaBlockLeadFollows(cursor) {
    if (currentKind(cursor) !== TokenKind.BitXor) {
        return false;
    }
    const caret = current(cursor);
    const brace = peek(cursor, 1);
    if (caret === undefined || caret === null || brace === undefined || brace === null) {
        return false;
    }
    if (brace.kind !== TokenKind.LBrace) {
        return false;
    }
    // Source-adjacency — the `{` must abut the `^` (`^{`). A gap (`^ {`) is a
    // XOR operator against a `{`-led operand, NOT a meta-block opener.
    if (caret.span === undefined || caret.span === null
        || brace.span === undefined || brace.span === null
        || brace.span.start !== caret.span.end) {
        return false;
    }
    return true;
}

// parseMetaBlock — parse a `^{ ... }` meta block at statement position. The
// `^` is consumed, then the brace-delimited body is parsed by parseBlock — the
// body is a run of scrml-native statements. The returned node is the `Block`
// parseBlock produces, span-extended to include the leading `^` so downstream
// span consumers see the whole `^{...}` extent. (A dedicated `StmtKind.Meta`
// would carry the `meta` wrapper through the A1 bridge — deferred; see the
// PARTIAL-FIX NOTE above.)
export function parseMetaBlock(ctx) {
    const cursor = ctx.cursor;
    const caret = advance(cursor);   // consume `^`
    const block = parseBlock(ctx);   // parse the `{ ... }` body
    if (block !== null && block !== undefined && block.span !== undefined && block.span !== null) {
        block.span = makeSpan(
            caret.span.start, block.span.end, caret.span.line, caret.span.col);
    }
    return block;
}

// =============================================================================
// await / yield — M4.1 unifies statement-position and operator-position.
//
// M3.3 had dedicated `parseAwaitStatement` / `parseYieldStatement` +
// `makeAwaitExpr` / `makeYieldExpr` here — `await x;` / `yield x;` at
// statement position only. M4.1 promotes `Await` / `Yield` to real ExprKind
// members (ast-expr.js) and integrates them into the M2 expression grammar
// (parse-expr's parseUnary / parseYieldExpr, gated on the ctx async/generator
// scope). An `await x;` statement is now just an expression statement —
// parseExprStatement → parseExpression handles it. The M3.3 statement-lead
// parsers + local makers are DELETED: one implementation, no divergence
// between statement-position and operator-position `await`/`yield`. This
// also corrects M3.3's `await` operand (it used parsePostfix — too narrow;
// `await -x` needs the parseUnary operand the M4.1 path gives it).
// =============================================================================

// =============================================================================
// BlockStub re-entry — THE load-bearing M3.1 mechanism.
//
// M2.3 left function/arrow block bodies, and M2.4 left match-arm block
// bodies, as `BlockStub` Expr nodes. A BlockStub carries:
//   { kind:"BlockStub", tokens, tokenStart, tokenEnd, span }
// where `tokens` is the body token slice (cursor.tokens.slice(tokenStart,
// tokenEnd)) — half-open, NOT including the closing `}` and NOT including a
// trailing EOF token. parseBlockStubBody re-parses that slice into a real
// Stmt list.
//
// The token-cursor's `advance` clamps at tokens.length-1 and `atEnd` fires
// only on an EOF-kinded token — so the slice MUST get a synthetic EOF
// appended before cursoring, the same shape parseExpr relies on for a full
// lex stream. parseBlockStubBody appends one (the EOF span is pinned to the
// slice's last real token's end, or the stub span when the slice is empty).
// =============================================================================

// parseBlockStubBody — re-parse a BlockStub's captured token range into a
// Stmt array. The single, uniform re-entry point: arrow bodies, function-expr
// bodies, and match-arm block bodies (M2.4) all produce BlockStubs via the
// same parse-expr `parseBlockStub` capture, so one re-entry function serves
// all three. Returns { body, errors } — `body` is the Stmt array, `errors`
// the diagnostics raised while re-parsing the body.
//
// M4.1 — `isGenerator` is the generator scope of the FUNCTION/ARROW whose
// body this BlockStub is. A block body parsed in parse-expr is captured as
// a token range, NOT parsed in-line — so the scope the enclosing function
// established (parse-expr's enterFunctionScope) does not reach the
// re-entered body. reenterBlockStubs threads the function's flag here so
// the re-parsed body sees `yield` as an operator (a match-arm block body
// is not inside a function — reenterBlockStubs passes the enclosing scope
// through; defaults false for a standalone re-entry). The `isAsync` param
// is retained for call-site stability (M4.3 retracted source-level `async`)
// but is IGNORED — Function/Arrow nodes carry isAsync:false after M4.3.
export function parseBlockStubBody(stub, isAsync, isGenerator) {
    const stubTokens = (stub === undefined || stub === null || stub.tokens === undefined
        || stub.tokens === null) ? [] : stub.tokens;

    // Append a synthetic EOF so the token-cursor terminates cleanly. The EOF
    // span is pinned past the last real token (or to the stub span for an
    // empty body) so node spans stay sane.
    let eofPos = 0;
    let eofLine = 1;
    let eofCol = 1;
    if (stubTokens.length > 0) {
        const last = stubTokens[stubTokens.length - 1];
        if (last !== undefined && last !== null && last.span !== undefined && last.span !== null) {
            eofPos = last.span.end;
            eofLine = last.span.line;
            eofCol = last.span.col;
        }
    } else if (stub !== undefined && stub !== null && stub.span !== undefined && stub.span !== null) {
        eofPos = stub.span.end;
        eofLine = stub.span.line;
        eofCol = stub.span.col;
    }

    const tokensForCursor = stubTokens.concat([makeEof(eofPos, eofLine, eofCol)]);
    const ctx = makeParseStmtContext(tokensForCursor);
    // A function/arrow/match-arm body is a statement list in function-body
    // context — the ParseMode the body re-enters.
    setParseMode(ctx, ParseMode.InFunctionBody);
    // M3.4 — a re-entered BlockStub is a function / arrow body, so it parses
    // INSIDE a function: seed functionDepth to 1 (the constructor's default 0
    // is program scope). A `return` anywhere in the re-entered body is then
    // legal — including in a nested `{}` block, where the depth counter (not
    // the single-slot ParseMode) is what proves function scope.
    ctx.functionDepth = 1;
    // M4.1 — seed the generator scope from the enclosing function so
    // `yield` parses as an operator inside the re-entered body.
    ctx.inGenerator = isGenerator === true;
    const body = parseStatementList(ctx, undefined);
    return { body, errors: ctx.errors };
}

// reenterBlockStubs — walk an Expr tree, re-parse every BlockStub in place,
// and attach the parsed statement list as `.parsedBody` on the BlockStub
// node. This is the deep variant — a parse-expr AST whose arrow / function /
// match bodies are all BlockStubs becomes a fully-parsed tree. The original
// BlockStub fields (tokens / tokenStart / tokenEnd / span) are preserved;
// `.parsedBody` + `.bodyErrors` are added. Returns the count of stubs
// re-entered. Idempotent — a BlockStub already carrying `.parsedBody` is
// skipped.
//
// M4.1 — `asyncScope` / `genScope` are the async/generator scope IN which
// the current `node` sits: a bare BlockStub reached here is re-parsed in
// that scope. When the walk descends INTO a Function / Arrow node, that
// node's `body` BlockStub is re-entered in the FUNCTION's OWN scope
// (`node.isAsync` / `node.isGenerator`; an arrow is never a generator) —
// every function ESTABLISHES its own scope. A Function/Arrow node's
// non-body children (its params — default-value expressions) are NOT in the
// body's await/yield scope (a param default with `await`/`yield` is a
// SyntaxError), so they walk with scope reset to (false, false).
export function reenterBlockStubs(node, asyncScope, genScope) {
    let count = 0;
    if (node === undefined || node === null || typeof node !== "object") {
        return count;
    }
    const aScope = asyncScope === true;
    const gScope = genScope === true;

    if (node.kind === "BlockStub") {
        if (node.parsedBody === undefined) {
            const result = parseBlockStubBody(node, aScope, gScope);
            node.parsedBody = result.body;
            node.bodyErrors = result.errors;
            count = count + 1;
            // A BlockStub body can itself contain nested BlockStubs (an
            // inner arrow inside a function body); re-enter those too — a
            // statement in the body is in the SAME scope as the body.
            for (const stmt of node.parsedBody) {
                count = count + reenterBlockStubs(stmt, aScope, gScope);
            }
        }
        return count;
    }

    // A Function / Arrow node ESTABLISHES its own async/generator scope: its
    // `body` BlockStub re-enters in (node.isAsync, node.isGenerator) — an
    // arrow is never a generator. Its other children (params — default-value
    // expressions) walk with the scope reset (param defaults are out-of-scope
    // for `await`/`yield`).
    if (node.kind === "Function" || node.kind === "Arrow") {
        const bodyAsync = node.isAsync === true;
        const bodyGenerator = (node.kind === "Function") && node.isGenerator === true;
        for (const key of Object.keys(node)) {
            const child = node[key];
            const childAsync = (key === "body") ? bodyAsync : false;
            const childGen = (key === "body") ? bodyGenerator : false;
            if (Array.isArray(child)) {
                for (const el of child) {
                    count = count + reenterBlockStubs(el, childAsync, childGen);
                }
            } else if (child !== null && typeof child === "object") {
                count = count + reenterBlockStubs(child, childAsync, childGen);
            }
        }
        return count;
    }

    // Generic structural walk — descend into every array / object child,
    // carrying the current scope through unchanged.
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) {
            for (const el of child) {
                count = count + reenterBlockStubs(el, aScope, gScope);
            }
        } else if (child !== null && typeof child === "object") {
            count = count + reenterBlockStubs(child, aScope, gScope);
        }
    }
    return count;
}

// =============================================================================
// Entry points.
// =============================================================================

// parseStmt — parse ONE statement at the head of a token stream. Mirrors
// parse-expr's parseExpr entry shape — returns { ast, errors }.
export function parseStmt(tokens, source) {
    const ctx = makeParseStmtContext(tokens, source);
    const ast = parseStatement(ctx);
    return { ast, errors: ctx.errors };
}

// parseProgram — parse a whole token stream as a statement list (a program
// body / a module body). Returns { body, errors } — `body` is the Stmt
// array. This is the M3.1 top-level entry the conformance harness drives.
export function parseProgram(tokens, source) {
    const ctx = makeParseStmtContext(tokens, source);
    const body = parseStatementList(ctx, undefined);
    return { body, errors: ctx.errors };
}
