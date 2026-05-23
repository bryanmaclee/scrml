// parse-expr.js — JS-host shadow of parse-expr.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-expr.scrml's header — see that file.
//
// SCOPE — M2.1 + M2.2 + M2.3 + M2.4 (M2 COMPLETE) + M4.1 (async/generator).
//   M2.1: PRIMARY EXPRESSIONS. M2.2: OPERATOR EXPRESSIONS — binary
//   (precedence-climbing core), logical, unary prefix, update (++/--),
//   assignment, conditional ?:, sequence ,.
//   M2.3: CALL / MEMBER / POSTFIX / ARROW-HEAD / FUNCTION-EXPRESSION —
//   call exprs (incl. arg spread), member access (dot + computed),
//   optional chaining `?.`, `new`, tagged templates, arrow functions +
//   function expressions (the HEAD is parsed; the block body of a
//   block-body arrow / function expression is captured as a BlockStub
//   that forward-references M3's statement parser — see parseBlockStub).
//   M2.4: scrml-EXTENSION EXPRESSION FORMS (D5 MUST ADD) — the `not`
//   absence value, the `~` accumulator atom, `?{sql}` blocks, `<#id>`
//   input-state refs, `::Variant` / `Type::Variant` alias, the `is`
//   predicate family (`is not`/`is some`/`is given`/`is not not`/`is
//   .Variant`), `match expr {}`, `render name()`, `lift expr`, `fail
//   Type::Variant(args)`. These eliminate the 9 preprocessForAcorn
//   Acorn-workaround classes (M2 gating criterion).
//   M4.1: ASYNC / GENERATOR OPERATOR EXPRESSIONS (D5 MUST PARSE) — `await`
//   as a unary-precedence operator (M4.3 RETRACTED — see parseUnary); `yield` /
//   `yield*` as an assignment-precedence operator (gated on
//   `ctx.inGenerator`); the `function*` generator-flag full wiring onto
//   function expressions + object methods (the M2.3 deferral). The
//   async/generator scope is two ctx slots saved+set+restored at every
//   function / arrow entry (makeParseExprContext + enterFunctionScope).
//
//   parseExpression is the single recursion seam (full sequence-level).
//   parseAssignmentExpr is the no-comma entry used by element positions
//   (array elements, object values, spread args). parsePostfix is the
//   M2.3/M2.4 seam — it dispatches arrow / function-expression / `new` /
//   `match` / `render` / `lift` / `fail` heads, then parses an atom and a
//   postfix chain (calls / members / optional chain / tagged template).
//
// M4.2 — DESTRUCTURING UNIFICATION (K6) + `noIn` flag. M2.3 left function-
// parameter `{...}` / `[...]` destructuring as Object/Array LITERAL stand-ins
// (the documented K6-class ESTree divergence). M4.2 routes parseParamTarget
// through M3.1's parseBinding (now hosted here) and emits REAL binding nodes
// — function-param destructuring + for-in/of non-decl LHS now share ONE
// binding-pattern surface with vardecl destructuring. M4.2 also threads the
// `noIn` flag through parseBinary: in a for-head no-In context, KwIn is not
// recognized as a binary operator, so the init clause parses to the for-in
// disambiguator without consuming it (replacing M3.2's depth-scan workaround).

import { makeTokenCursor, current, currentKind, peek, peekKind, previousKind, advance, atEnd, snapshot, restore } from "./token-cursor.js";
import { TokenKind } from "./token.js";
import { makeSpan } from "./span.js";
import { ParseMode, initialParseMode, getParseMode, setParseMode, enterMode, exitMode } from "./parse-mode.js";
import {
    makeIdent, makeNumberLit, makeStringLit, makeBoolLit, makeRegexLit,
    makeTemplateLit, makeTemplateQuasi, makeAtCell, makeBareVariant,
    makeThis, makeSuper,
    makeArray, makeArrayItem, makeArraySpread, makeArrayHole,
    makeObject, makeObjectKeyValue, makeObjectShorthand, makeObjectSpread,
    makeObjectMethod, makeParen,
    makeUnary, makeUpdate, makeBinary, makeLogical, makeAssignment,
    makeConditional, makeSequence,
    makeCall, makeNew, makeMember, makeTaggedTemplate, makeArrow, makeFunction,
    makeRestElement, makeAssignmentPattern, makeBlockStub,
    IsCheckOp,
    makeNotValue, makeTilde, makeSql, makeInputStateRef, makeIsCheck,
    makeMatch, makeMatchArm, makeVariantPattern, makeWildcardPattern,
    makeIsPattern, makeMatchBinding, makeRender, makeLift, makeFail,
    makeYield, makeMarkupValue,
    // M5-swap Wave 2 — postfix-`?` / `!{}` scrml-extension constructors.
    makePropagate, makeGuardedExpr,
} from "./ast-expr.js";
// M4.2 — binding-pattern constructors (ast-stmt's BindingKind catalog —
// the declaration-target shapes M3.1 produces for vardecl destructuring).
// parseParamTarget calls parseBinding (now hosted in THIS file — moved from
// parse-stmt at M4.2 so a function-parameter destructuring target is a real
// binding node, not an Object/Array literal stand-in). The names
// `makeRestElement` / `makeAssignmentPattern` also exist on ast-expr (the
// Expr-shape twins); the binding-shape constructors are imported under
// aliases so both surfaces coexist (the bindingKind discriminator
// distinguishes them).
import {
    makeBindingIdent,
    makeObjectPattern, makeArrayPattern,
    makeRestElement      as makeBindingRestElement,
    makeAssignmentPattern as makeBindingAssignmentPattern,
    makeBindingPropertyKeyValue, makeBindingPropertyShorthand,
    makeBindingPropertyRest,
    makeBindingElementItem, makeBindingElementHole, makeBindingElementRest,
} from "./ast-stmt.js";

// MK4 — the JS->markup seam (R1 spike §1.2). markupValueAllowedAfter is the
// prev-token discriminator for parsePrimary's LessThan branch (the twin of
// M1's regexAllowedAfter). Lives in parse-seam.js (which also hosts the
// markup->JS direction's body delegator); imported here for the discriminator
// only — the actual markup delegation calls parseMarkup lazily (via dynamic
// import to avoid the parse-markup -> parse-expr -> parse-markup cycle at
// module-init time).
import { markupValueAllowedAfter } from "./parse-seam.js";

// M5-swap Wave 2 (B2) — the `!{ arms }` guarded-expression postfix reuses the
// shared error-arm grammar `parseErrorArms` produces (the same arm shape the
// `<errors>` block / the markup-layer `ErrorEffect` block use). parse-error-
// body.js has no imports — no module cycle is introduced.
import { parseErrorArms } from "./parse-error-body.js";

// --- makeParseExprContext — parser state constructor ---
// M4.1 added an ASYNC/GENERATOR SCOPE pair (`inAsync` / `inGenerator`). M4.3
// REMOVED `inAsync` — scrml has no `async`/`await` at the language level
// (parallel-by-default, no colored functions; the canonical async surface is
// the compiler body-split). The remaining slot:
//   - `inGenerator` — true iff the cursor is inside a `function*` body.
//     `yield` / `yield*` are operators (parseAssignmentExpr) only when true.
// This is NOT a ParseMode engine variant: ParseMode discriminates WHICH
// grammar production runs (the object-vs-block `{` ambiguity, etc.);
// generator scope is the orthogonal question "is `yield` a legal operator
// here". Folding it into ParseMode forces a combinatorial cross-product
// (InFunctionBody × {sync, gen}) — the variant explosion DD §D3 explicitly
// rejects. The slot mirrors M3.4's `functionDepth` pattern (a function-
// scoped slot saved+set+restored at function entry/exit). A standalone
// parseExpr call starts OUTSIDE any function: default false.
//
// M4.2 — adds `noIn` (the JS "no-In context" of ECMA-262). True iff the
// cursor is parsing a `for` head's init / LHS clause and the `in` keyword is
// the for-in disambiguator, NOT a relational binary operator. parseBinary
// consults this to skip KwIn (otherwise `in` binds as a relational operator
// at precedence 8 and swallows the for-in disambiguator). Same orthogonal-
// to-ParseMode pattern as inGenerator: it is a question ABOUT the climb,
// not a rule-dispatch variant. Default false. The for-head parser
// (parse-stmt) wraps init-clause parsing in enterNoInScope/exitNoInScope;
// sub-expressions that REOPEN the `in` operator (a paren / array element /
// object value / call argument / template `${...}`) use
// withInAllowedSubExpr / restoreNoIn to save+clear+restore the slot.
// MK4 — `source` is an OPTIONAL slot threaded into the context to support
// the JS->markup delegate-up direction (R1 spike §1.2). When parsePrimary's
// LessThan branch detects a markup-value, it needs the source string to
// slice the markup region and call parseMarkup. Existing callers (parseExpr
// (tokens) one-arg, makeParseExprContext(tokens) one-arg) pass undefined
// and the LessThan branch falls back to a token-range capture (the same
// shape M2.3's BlockStub uses for function bodies). M5+ will route through
// the shared ParseContext (parse-ctx.js) which carries source canonically.
export function makeParseExprContext(tokens, source) {
    return {
        cursor:           makeTokenCursor(tokens),
        currentParseMode: initialParseMode(),
        errors:           [],
        inGenerator:      false,
        noIn:             false,
        source:           source ?? null,
    };
}

export function recordError(ctx, code, message, span) {
    ctx.errors.push({ code, message, span });
}

// --- spanHere — the span of the token at the cursor (or a zero span at EOF) ---
// Used by binding-pattern diagnostic-recording sites where no node span is
// available. Mirrors parse-stmt's spanHere (same shape, same EOF fallback).
function spanHere(ctx) {
    const here = current(ctx.cursor);
    if (here === undefined || here === null) {
        return makeSpan(0, 0, 1, 1);
    }
    return here.span;
}

// --- enterNoInScope / exitNoInScope — `noIn` save + set + restore (M4.2) ---
// A `for` head's init / LHS clause is a no-In context: inside it the `in`
// keyword is the for-in disambiguator, not a binary operator. The caller
// (parse-stmt's for-head parser) wraps init-clause parsing in this scope:
//     const prior = enterNoInScope(ctx);
//     ... parse the head ...
//     exitNoInScope(ctx, prior);
// Nested sub-expressions (inside a paren / array element / object value /
// call argument / template `${...}`) REOPEN the `in` operator — see
// withInAllowedSubExpr / restoreNoIn below.
export function enterNoInScope(ctx) {
    const prior = ctx.noIn;
    ctx.noIn = true;
    return prior;
}

export function exitNoInScope(ctx, prior) {
    ctx.noIn = prior;
}

// --- withInAllowedSubExpr / restoreNoIn — save+clear+restore noIn around an
// inner expression (M4.2). The classic ECMA-262 no-In carve-out: inside a
// `for` head the `in` keyword IS legal once the cursor descends into a
// sub-expression with its own grouping (`for (let x = (a in b); ...)`,
// `for (let x = [a in b]; ...)`, `for (let x = f(a in b); ...)`). The outer
// no-In scope governs the HEAD's top-level climb only; a grouped sub-expr
// has its own scope. Used by parseParenExpression, parseArrayLiteral,
// parseObjectLiteral, parseCallArguments, parseTemplateLiteral.
export function withInAllowedSubExpr(ctx) {
    const prior = ctx.noIn;
    ctx.noIn = false;
    return prior;
}

export function restoreNoIn(ctx, prior) {
    ctx.noIn = prior;
}

// --- enterFunctionScope / exitFunctionScope — generator scope save +
// set + restore (M4.1; M4.3 simplified). Every JS function / arrow
// ESTABLISHES its OWN generator scope — it does NOT inherit the enclosing
// function's (a non-generator nested inside a generator cannot `yield`).
// enterFunctionScope captures the prior {inGenerator}, sets the new value,
// and returns the saved pair; the caller passes it to exitFunctionScope on
// the function's exit. This mirrors enterMode/exitMode (and M3.4's
// functionDepth save-restore). Arrows are never generators — pass
// isGenerator false for an arrow. The `isAsync` parameter is retained for
// call-site stability (every Function/Arrow constructor still ferries it
// onto the AST) but is IGNORED here — M4.3 retracted source-level `async`.
export function enterFunctionScope(ctx, isAsync, isGenerator) {
    const prior = { inGenerator: ctx.inGenerator };
    ctx.inGenerator = isGenerator === true;
    return prior;
}

export function exitFunctionScope(ctx, prior) {
    ctx.inGenerator = prior.inGenerator;
}

// =============================================================================
// M2.2 operator tables — classification data for the precedence-climbing core.
// These are calculation-shape lookup tables: a token kind maps to its operator
// role + (for binary operators) its binding precedence. JS precedence + assoc
// are reproduced here EXACTLY (the conformance check vs Acorn is the proof).
// =============================================================================

// BINARY_PRECEDENCE — non-logical binary operators, keyed by TokenKind, valued
// by binding precedence. HIGHER binds tighter. Logical operators (&& || ??)
// are NOT here — ESTree models them as a separate LogicalExpression node, so
// they live in LOGICAL_PRECEDENCE below.
//
// The ECMA-262 binding order, tight -> loose:
//   ** > {* / %} > {+ -} > {<< >> >>>} > {< <= > >= instanceof in}
//      > {== != === !==} > & > ^ > | > && > || > ??
// BINARY_PRECEDENCE covers ** down through |; LOGICAL_PRECEDENCE covers && || ??.
const BINARY_PRECEDENCE = Object.freeze({
    [TokenKind.BitOr]:                 4,
    [TokenKind.BitXor]:                5,
    [TokenKind.BitAnd]:                6,
    [TokenKind.Equal]:                 7,
    [TokenKind.NotEqual]:              7,
    [TokenKind.StrictEqual]:           7,
    [TokenKind.StrictNotEqual]:        7,
    [TokenKind.LessThan]:              8,
    [TokenKind.LessEqual]:             8,
    [TokenKind.GreaterThan]:           8,
    [TokenKind.GreaterEqual]:          8,
    [TokenKind.KwInstanceof]:          8,
    [TokenKind.KwIn]:                  8,
    [TokenKind.BitShiftLeft]:          9,
    [TokenKind.BitShiftRight]:         9,
    [TokenKind.BitShiftRightUnsigned]: 9,
    [TokenKind.Plus]:                  10,
    [TokenKind.Minus]:                 10,
    [TokenKind.Star]:                  11,
    [TokenKind.Slash]:                 11,
    [TokenKind.Percent]:               11,
    [TokenKind.StarStar]:              12,
});

// LOGICAL_PRECEDENCE — the three short-circuit operators. ESTree node-kind:
// LogicalExpression (NOT BinaryExpression). ?? binds loosest; then ||; then &&.
// JS forbids mixing ?? with && / || without parentheses — enforced in
// parseBinary's climb loop.
const LOGICAL_PRECEDENCE = Object.freeze({
    [TokenKind.NullishCoalesce]: 1,
    [TokenKind.LogicalOr]:       2,
    [TokenKind.LogicalAnd]:      3,
});

// BINARY_OP_TEXT — the operator string ESTree puts on a BinaryExpression /
// LogicalExpression node. M1's tokens carry `.text`, but keyword operators
// (instanceof / in) carry the keyword text already, and re-composed compound
// tokens need a synthesized string — so this table is the single source.
const BINARY_OP_TEXT = Object.freeze({
    [TokenKind.BitOr]:                 "|",
    [TokenKind.BitXor]:                "^",
    [TokenKind.BitAnd]:                "&",
    [TokenKind.Equal]:                 "==",
    [TokenKind.NotEqual]:              "!=",
    [TokenKind.StrictEqual]:           "===",
    [TokenKind.StrictNotEqual]:        "!==",
    [TokenKind.LessThan]:              "<",
    [TokenKind.LessEqual]:             "<=",
    [TokenKind.GreaterThan]:           ">",
    [TokenKind.GreaterEqual]:          ">=",
    [TokenKind.KwInstanceof]:          "instanceof",
    [TokenKind.KwIn]:                  "in",
    [TokenKind.BitShiftLeft]:          "<<",
    [TokenKind.BitShiftRight]:         ">>",
    [TokenKind.BitShiftRightUnsigned]: ">>>",
    [TokenKind.Plus]:                  "+",
    [TokenKind.Minus]:                 "-",
    [TokenKind.Star]:                  "*",
    [TokenKind.Slash]:                 "/",
    [TokenKind.Percent]:               "%",
    [TokenKind.StarStar]:              "**",
    [TokenKind.NullishCoalesce]:       "??",
    [TokenKind.LogicalOr]:             "||",
    [TokenKind.LogicalAnd]:            "&&",
});

// ASSIGN_OPS — every assignment operator M1 lexes as a SINGLE token (S114
// K3 maximal-munch closure). Keyed by TokenKind, valued by the ESTree
// operator string. The 11 compound-assigns previously re-composed at the
// parse layer (TWO_TOKEN_ASSIGN_OPS — retired S114) are now first-class
// TokenKinds; matchAssignmentOperator is a simple table lookup.
const ASSIGN_OPS = Object.freeze({
    [TokenKind.Assign]:                       "=",
    [TokenKind.PlusAssign]:                   "+=",
    [TokenKind.MinusAssign]:                  "-=",
    [TokenKind.StarAssign]:                   "*=",
    [TokenKind.SlashAssign]:                  "/=",
    // S114 K3 — 11 compound-assigns now single tokens.
    [TokenKind.PercentAssign]:                "%=",
    [TokenKind.StarStarAssign]:               "**=",
    [TokenKind.BitShiftLeftAssign]:           "<<=",
    [TokenKind.BitShiftRightAssign]:          ">>=",
    [TokenKind.BitShiftRightUnsignedAssign]:  ">>>=",
    [TokenKind.BitAndAssign]:                 "&=",
    [TokenKind.BitOrAssign]:                  "|=",
    [TokenKind.BitXorAssign]:                 "^=",
    [TokenKind.LogicalAndAssign]:             "&&=",
    [TokenKind.LogicalOrAssign]:              "||=",
    [TokenKind.NullishCoalesceAssign]:        "??=",
});

// =============================================================================
// The expression-parser ladder. Each level handles one precedence band and
// recurses DOWN to the next. parseExpression is the single recursion seam the
// inner positions (array / object / template / paren) re-enter.
//
//   parseExpression     level 1   sequence ,
//   parseAssignmentExpr level 2   assignment = += ... (right-assoc); `yield`
//                                 / `yield*` (M4.1 — yield is at THIS level,
//                                 the lowest expression precedence)
//   parseConditional    level 3   ?: ternary (right-assoc)
//   parseBinary         levels 4-12 + logical — precedence-climbing core
//   parseUnary          prefix ! - + ~ typeof void delete, prefix ++/--,
//                                 `await` (M4.1 — await is at unary level)
//   parseUpdate         postfix ++/--
//   parsePostfix        M2.3 — arrow/function/new heads, atom + postfix chain
//   parsePostfixChain   M2.3 — call / member / optional-chain / tagged-template
//   parsePrimary        primary expressions (M2.1) + this/super atoms (M2.3)
// =============================================================================

// --- parseExpression — the single recursion seam (M2.2: sequence-level) ---
export function parseExpression(ctx) {
    return parseSequence(ctx);
}

// --- parseSequence — comma operator: a, b, c -> SequenceExpression ---
// A bare comma is the loosest-binding operator. The element positions
// (array / object / arguments) do NOT call this — they call
// parseAssignmentExpr — so a comma there separates rather than sequences.
export function parseSequence(ctx) {
    const cursor = ctx.cursor;
    const first = parseAssignmentExpr(ctx);

    if (currentKind(cursor) !== TokenKind.Comma) {
        return first;
    }

    const expressions = [first];
    while (currentKind(cursor) === TokenKind.Comma) {
        advance(cursor);   // consume the ,
        const next = parseAssignmentExpr(ctx);
        expressions.push(next);
    }

    const span = spanOf(first, expressions[expressions.length - 1]);
    return makeSequence(expressions, span);
}

// --- parseAssignmentExpr — = and every compound-assignment form ---
// Assignment is RIGHT-associative: a = b = c parses as a = (b = c). The
// left side is parsed at conditional level; if an assignment operator
// follows, the right side recurses back into parseAssignmentExpr.
//
// This is the no-comma entry point — element positions call it directly so
// a separating comma is not swallowed as a sequence.
//
// M4.1 — `yield` / `yield*` is a YieldExpression, an AssignmentExpression at
// the ECMA-262 grammar level (the LOWEST expression precedence — below
// conditional `?:`, so `yield a ? b : c` yields the whole conditional). It
// is parsed HERE — at the head of this level — when the cursor is inside a
// generator (`ctx.inGenerator`). Outside a generator a `yield` token would
// reach parsePrimary and surface as an unhandled keyword.
export function parseAssignmentExpr(ctx) {
    const cursor = ctx.cursor;

    if (currentKind(cursor) === TokenKind.KwYield && ctx.inGenerator === true) {
        return parseYieldExpr(ctx);
    }

    const left = parseConditional(ctx);

    const assignInfo = matchAssignmentOperator(ctx);
    if (assignInfo === null) {
        return left;
    }

    // Consume the operator token (S114 K3 — every assignment operator is a
    // single token; the M2.2 two-token re-composition has been retired).
    advance(cursor);

    const value = parseAssignmentExpr(ctx);   // right-assoc recursion
    const span = spanOf(left, value);
    return makeAssignment(assignInfo.op, left, value, span);
}

// --- matchAssignmentOperator — recognize an assignment operator at cursor ---
// Returns the ESTree operator string, or null. S114 K3 — every assignment
// operator is a single TokenKind (the M2.2 two-token re-composition has
// been retired); this is a simple ASSIGN_OPS lookup.
export function matchAssignmentOperator(ctx) {
    const kind = currentKind(ctx.cursor);
    const op = ASSIGN_OPS[kind];
    if (op !== undefined) {
        return { op };
    }
    return null;
}

// --- parseConditional — ternary test ? consequent : alternate ---
// Right-associative. The test is parsed at binary level; the branches at
// assignment level (so `a ? b : c = d` puts the assignment in the alternate,
// matching JS). A ternary is its own level between assignment and binary.
export function parseConditional(ctx) {
    const cursor = ctx.cursor;
    const test = parseBinary(ctx, 0);

    if (currentKind(cursor) !== TokenKind.Question) {
        return test;
    }

    advance(cursor);   // consume ?
    const consequent = parseAssignmentExpr(ctx);

    if (currentKind(cursor) !== TokenKind.Colon) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? test.span : here.span;
        recordError(ctx, "E-EXPR-TERNARY-COLON", "expected ':' in conditional expression", span);
        // Return the test so the caller can re-sync; the malformed ternary is
        // not built.
        return test;
    }
    advance(cursor);   // consume :
    const alternate = parseAssignmentExpr(ctx);

    const span = spanOf(test, alternate);
    return makeConditional(test, consequent, alternate, span);
}

// --- parseYieldExpr — `yield` / `yield* argument` / bare `yield` (M4.1) ---
// The caller (parseAssignmentExpr) has confirmed `KwYield` AND `ctx.inGenerator`.
// `yield*` (the delegating form) ALWAYS takes an argument. A plain `yield`
// takes an argument iff one follows on the SAME source line (the ECMA-262
// no-LineTerminator restricted production — `yield⏎x` is a bare `yield` then
// a separate `x`); a `yield` followed on the same line by a closer / a
// separator (`)` `]` `}` `,` `;` `:`) is also bare (those cannot start an
// expression). The argument is an assignment-level expression — so `yield a +
// b` yields the sum, `yield a ? b : c` yields the conditional, `yield yield x`
// nests. A bare `yield` (argument `null`) is a legal operand: `a + yield`.
export function parseYieldExpr(ctx) {
    const cursor = ctx.cursor;
    const kw = advance(cursor);   // consume `yield`

    // `yield*` — the delegating form. The `*` must be source-adjacent-ish; M1
    // lexes it as a Star token. `yield *` (with whitespace) is still the
    // delegating form per ECMA-262 (no no-LineTerminator restriction on the
    // `*` itself — only the same-line check below, applied to `yield*` too).
    let delegate = false;
    if (currentKind(cursor) === TokenKind.Star) {
        advance(cursor);   // consume *
        delegate = true;
    }

    // `yield*` ALWAYS takes an operand; a plain `yield` takes one only when an
    // argument follows on the same line. When `yield*` has nothing to
    // delegate to, ECMA-262 still requires an operand — record the diagnostic
    // but keep the parse well-formed (the no-throw discipline).
    const argPresent = yieldArgFollows(ctx, kw);
    if (delegate === true && argPresent === false) {
        recordError(ctx, "E-EXPR-YIELD-STAR-NO-ARG",
            "'yield*' requires an operand", kw.span);
    }

    let argument = null;
    let endE = kw.span.end;
    if (argPresent === true) {
        argument = parseAssignmentExpr(ctx);
        endE = endOf(argument);
    }

    const span = makeSpan(kw.span.start, endE, kw.span.line, kw.span.col);
    return makeYield(argument, delegate, span);
}

// --- yieldArgFollows — does an argument follow a bare `yield`? (M4.1) ---
// True iff the token after `yield` is on the SAME source line as the `yield`
// keyword AND is not a closer / separator. Used by parseYieldExpr to apply
// the ECMA-262 no-LineTerminator restricted production for the optional
// `yield` argument.
function yieldArgFollows(ctx, kwTok) {
    const cursor = ctx.cursor;
    const here = current(cursor);
    if (here === undefined || here === null || here.span === undefined) {
        return false;
    }
    // A different source line — the restricted production: bare `yield`.
    if (here.span.line !== kwTok.span.line) {
        return false;
    }
    const k = here.kind;
    // Closers + separators cannot start an expression — bare `yield`.
    if (k === TokenKind.RParen || k === TokenKind.RBracket || k === TokenKind.RBrace
        || k === TokenKind.Comma || k === TokenKind.Semicolon || k === TokenKind.Colon
        || k === TokenKind.Eof) {
        return false;
    }
    return true;
}

// --- isUnparenthesizedLogical — is `node` a Logical node with op in `ops`? ---
// A Paren node is NOT a Logical, so a parenthesized `(a ?? b)` returns false —
// which is exactly the ECMA-262 carve-out: parentheses make the mix legal.
function isUnparenthesizedLogical(node, ops) {
    if (node === undefined || node === null) {
        return false;
    }
    if (node.kind !== "Logical") {
        return false;
    }
    return ops.indexOf(node.op) !== -1;
}

// --- maybeWrapIsCheck — wrap `operand` in an `is` predicate if `is` follows ---
// The scrml `is` operator (§42 / §18.17 — M2.4) is a postfix predicate: when
// the cursor sits at the `is` keyword, `operand` is consumed as the left-hand
// side and parseIsCheckSuffix parses the suffix (`not` / `not not` / `some` /
// `given` / `.Variant` / `Type.Variant`). When no `is` follows, `operand` is
// returned unchanged. A SINGLE wrap is applied — an `is` result is a boolean,
// so a chained `x is some is .Y` is a type error (E-TYPE-062, a later-stage
// concern); the parser does not chain `is`.
export function maybeWrapIsCheck(ctx, operand) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) !== TokenKind.KwIs) {
        return operand;
    }
    const isTok = advance(cursor);   // consume `is`
    return parseIsCheckSuffix(ctx, operand, isTok);
}

// --- parseBinary — the precedence-climbing core (binary + logical) ---
// minPrec is the minimum binding precedence this call will consume. The loop
// reads an operator, and if it binds at >= minPrec, recurses for the right
// operand at a precedence that enforces left-associativity (for **, right-
// associativity). Logical operators produce a LogicalExpression node; the
// arithmetic/comparison/bitwise operators produce a BinaryExpression node.
//
// JS forbids mixing ?? with && / || without parentheses (ECMA-262: ?? and
// && / || are separate grammar productions). After building a Logical node,
// if a ?? has an un-parenthesized && / || operand — or a && / || has an
// un-parenthesized ?? operand — that is the illegal mix.
export function parseBinary(ctx, minPrec) {
    const cursor = ctx.cursor;
    // The left operand. An `is` predicate (§42 / §18.17 — M2.4) is a postfix
    // wrap on a unary-level operand: `is` binds tighter than every binary
    // operator (the legacy `rewriteIsPredicates` LHS scan stops at `+`/`||`/
    // comparisons), so `a + b is some` is `a + (b is some)` and `a is .X &&
    // b is .Y` is `(a is .X) && (b is .Y)`. maybeWrapIsCheck applies the wrap
    // here AND in the right-operand recursion below (which re-enters
    // parseBinary, hence re-enters this wrap).
    let left = maybeWrapIsCheck(ctx, parseUnary(ctx));

    while (true) {
        const kind = currentKind(cursor);
        const binPrec = BINARY_PRECEDENCE[kind];
        const logPrec = LOGICAL_PRECEDENCE[kind];

        // Not an operator we climb, or it binds looser than the caller wants.
        if (binPrec === undefined && logPrec === undefined) {
            break;
        }

        // M4.2 — no-In context. Inside a `for` head's init / LHS clause the
        // `in` keyword is the for-in disambiguator, not a relational binary
        // operator. Stop the climb so the caller sees the unconsumed `in`.
        // (KwIn is the ONLY binary operator the no-In context suppresses;
        // KwOf is not a binary operator at all — for-of is a STATEMENT-level
        // construct dispatched by the for-head parser.)
        if (kind === TokenKind.KwIn && ctx.noIn === true) {
            break;
        }
        const prec = binPrec !== undefined ? binPrec : logPrec;
        if (prec < minPrec) {
            break;
        }

        // S114 K3 — the lexer now emits every compound-assign as a single
        // TokenKind (e.g. PercentAssign for `%=`); the parseBinary climb is
        // therefore never standing at the leading half of an assignment-only
        // operator. The M2.2 isTwoTokenAssignLead check is retired.

        const opTok = advance(cursor);   // consume the operator
        const opText = BINARY_OP_TEXT[kind];

        // ** is RIGHT-associative — recurse at the SAME precedence so the
        // right operand can itself be a ** chain. All other binary operators
        // are left-associative — recurse at prec+1 so an equal-precedence
        // operator on the right is left for THIS loop's next iteration.
        const rightMinPrec = (kind === TokenKind.StarStar) ? prec : prec + 1;
        const right = parseBinary(ctx, rightMinPrec);

        const span = spanOf(left, right);
        if (logPrec !== undefined) {
            // ?? cannot be combined with && / || without parentheses.
            if (kind === TokenKind.NullishCoalesce) {
                if (isUnparenthesizedLogical(left, ["&&", "||"])
                    || isUnparenthesizedLogical(right, ["&&", "||"])) {
                    recordError(ctx, "E-EXPR-NULLISH-MIX",
                        "'??' cannot be combined with '&&' or '||' without parentheses",
                        opTok.span);
                }
            } else {
                // && / ||
                if (isUnparenthesizedLogical(left, ["??"])
                    || isUnparenthesizedLogical(right, ["??"])) {
                    recordError(ctx, "E-EXPR-NULLISH-MIX",
                        "'&&' / '||' cannot be combined with '??' without parentheses",
                        opTok.span);
                }
            }
            left = makeLogical(opText, left, right, span);
        } else {
            left = makeBinary(opText, left, right, span);
        }
    }

    return left;
}

// --- parseUnary — prefix unary operators + prefix update operators ---
// Prefix operators: ! - + ~ typeof void delete (UnaryExpression) and prefix
// ++ / -- (UpdateExpression). All recurse into parseUnary so chains like
// `!-x` or `typeof !x` parse. When no prefix operator is present, falls
// through to parseUpdate (which handles postfix ++/--).
//
// JS rule: `**` may not have an un-parenthesized unary operator on its left
// (`-2 ** 2` is a SyntaxError). The check happens AFTER building the unary —
// if a `**` immediately follows, the unary's reach over `**` is illegal.
export function parseUnary(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // M4.3 — `await` is RETRACTED at the language level (scrml has no
    // async/await; the canonical async surface is the compiler body-split /
    // CPS mechanism — A9 / Insight 26 / S72). At this site we emit
    // E-AWAIT-NOT-IN-SCRML and RECOVER by parsing the operand as a unary
    // tail, returning the operand directly (no Await node — `Await` ExprKind
    // is retired in ast-expr). The parse continues; downstream stages see a
    // unary chain and the recorded diagnostic surfaces the user-facing error.
    if (kind === TokenKind.KwAwait) {
        const opTok = advance(cursor);   // consume `await`
        recordError(ctx, "E-AWAIT-NOT-IN-SCRML",
            "scrml has no `await` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            opTok.span);
        return parseUnary(ctx);
    }

    // Prefix update operators ++ / --
    if (kind === TokenKind.Increment || kind === TokenKind.Decrement) {
        const opTok = advance(cursor);
        const operand = parseUnary(ctx);
        const opText = (kind === TokenKind.Increment) ? "++" : "--";
        const span = makeSpan(opTok.span.start, endOf(operand), opTok.span.line, opTok.span.col);
        return makeUpdate(opText, operand, true, span);
    }

    // `~` disambiguation (§32 — M2.4): M1 lexes a `~` as a BitNot token.
    // A `~` is bitwise-NOT only when it is SOURCE-ADJACENT to an operand
    // (`~x`, `~5`); a `~` followed by whitespace, a non-operand token, or
    // EOF is the standalone pipeline-accumulator atom (§32). This mirrors
    // the legacy regex `~(?![A-Za-z0-9_$])` — a standalone `~` cannot be a
    // well-formed bitwise-NOT. When `~` is the accumulator, fall through so
    // parsePrimary builds the Tilde atom.
    if (kind === TokenKind.BitNot && tildeIsStandalone(cursor)) {
        return parseUpdate(ctx);
    }

    // Prefix unary operators
    const unaryOpText = prefixUnaryOpText(kind);
    if (unaryOpText !== null) {
        const opTok = advance(cursor);
        const operand = parseUnary(ctx);
        const span = makeSpan(opTok.span.start, endOf(operand), opTok.span.line, opTok.span.col);

        // `-2 ** 2` etc. — an un-parenthesized unary cannot be the left
        // operand of **. ECMA-262 makes this a SyntaxError; Acorn rejects it.
        if (currentKind(cursor) === TokenKind.StarStar) {
            recordError(ctx, "E-EXPR-UNARY-EXPONENT",
                "unary operator '" + unaryOpText + "' cannot directly precede '**'; wrap the operand in parentheses",
                current(cursor).span);
        }
        return makeUnary(unaryOpText, operand, true, span);
    }

    return parseUpdate(ctx);
}

// --- tildeIsStandalone — is the cursor's `~` the standalone accumulator? ---
// True iff the current token is BitNot AND it is NOT source-adjacent to an
// operand-starting token. `~x` / `~5` (adjacent operand) -> bitwise-NOT (false);
// `~`, `~ x`, `~)`, `~.ok` (no adjacent operand) -> standalone `~` (true).
// (`~.ok` reads `~` then `.ok` — member access on the accumulator; M1 lexes
// `.ok` after `~` as a BareVariant, which is NOT operand-adjacent in the
// bitwise sense — the `~` is the accumulator, the `.ok` chains off it.)
export function tildeIsStandalone(cursor) {
    if (currentKind(cursor) !== TokenKind.BitNot) {
        return false;
    }
    const here = current(cursor);
    const next = peek(cursor, 1);
    if (here === undefined || here === null || next === undefined || next === null) {
        return true;
    }
    if (here.span === undefined || next.span === undefined) {
        return true;
    }
    // Not source-adjacent — whitespace (or EOF) between `~` and the next
    // token: the `~` is the standalone accumulator.
    if (next.span.start !== here.span.end) {
        return true;
    }
    // Source-adjacent: bitwise-NOT only if the next token starts a unary
    // operand. A BareVariant `.ok` adjacent to `~` is member access on the
    // accumulator (`~.ok`), NOT a bitwise operand — so it is still standalone.
    if (next.kind === TokenKind.BareVariant) {
        return true;
    }
    return canStartUnaryOperand(next.kind) === false;
}

// --- canStartUnaryOperand — can a token of `kind` begin a unary operand? ---
// The operand-starting token kinds: literals, identifiers, `@`-cells, `(`,
// `[`, `{`, template chunks, and the nested-unary / keyword-atom starts.
export function canStartUnaryOperand(kind) {
    return kind === TokenKind.NumberLit
        || kind === TokenKind.StringLit
        || kind === TokenKind.TemplateChunk
        || kind === TokenKind.RegexLit
        || kind === TokenKind.Ident
        || kind === TokenKind.ScrmlAt
        || kind === TokenKind.KwTrue
        || kind === TokenKind.KwFalse
        || kind === TokenKind.KwThis
        || kind === TokenKind.KwSuper
        || kind === TokenKind.KwNew
        || kind === TokenKind.KwTypeof
        || kind === TokenKind.KwVoid
        || kind === TokenKind.KwDelete
        || kind === TokenKind.LParen
        || kind === TokenKind.LBracket
        || kind === TokenKind.LBrace
        || kind === TokenKind.Bang
        || kind === TokenKind.Minus
        || kind === TokenKind.Plus
        || kind === TokenKind.BitNot
        || kind === TokenKind.Increment
        || kind === TokenKind.Decrement;
}

// --- prefixUnaryOpText — the ESTree operator string for a prefix unary op ---
// Returns the operator string, or null when the token is not a prefix unary.
export function prefixUnaryOpText(kind) {
    if (kind === TokenKind.Bang)     { return "!"; }
    if (kind === TokenKind.Minus)    { return "-"; }
    if (kind === TokenKind.Plus)     { return "+"; }
    if (kind === TokenKind.BitNot)   { return "~"; }
    if (kind === TokenKind.KwTypeof) { return "typeof"; }
    if (kind === TokenKind.KwVoid)   { return "void"; }
    if (kind === TokenKind.KwDelete) { return "delete"; }
    return null;
}

// --- parseUpdate — postfix update operators ++ / -- ---
// Parses one postfix-core expression (parsePostfix — the M2.3 call/member/
// arrow layer), then consumes a trailing ++ / -- if present. Postfix update
// binds tighter than every prefix operator.
export function parseUpdate(ctx) {
    const cursor = ctx.cursor;
    const operand = parsePostfix(ctx);

    const kind = currentKind(cursor);
    if (kind === TokenKind.Increment || kind === TokenKind.Decrement) {
        const opTok = advance(cursor);
        const opText = (kind === TokenKind.Increment) ? "++" : "--";
        const span = makeSpan(startOf(operand), opTok.span.end, lineOf(operand), colOf(operand));
        return makeUpdate(opText, operand, false, span);
    }

    return operand;
}

// =============================================================================
// M2.3 — call / member / postfix / arrow-head / function-expression.
//
// parsePostfix is the M2.3 SEAM (the M2.2 stub was `== parsePrimary`). It
// dispatches the heads that begin BEFORE a primary atom (arrow functions,
// function expressions, `new`), then for everything else parses one primary
// atom and runs the postfix chain (calls / member access / optional chaining /
// tagged templates) on top of it.
//
// Arrow-vs-paren disambiguation uses BOUNDED LOOKAHEAD-WITH-COMMIT (DD §D4 P3 /
// OQ3): scanArrowParens walks the token run counting bracket depth to find the
// matching `)` and peeks whether `=>` follows. No speculative full-parse, no
// backtracking-with-rollback — a finite cursor scan followed by a single
// commit. (A parenthesized expression is never legally followed by `=>`, so
// "matching `)` then `=>`" is an unambiguous arrow signal.)
//
// The BLOCK body of a block-body arrow / function expression forward-
// references M3's statement parser: parseBlockStub captures the brace-
// delimited body's token range as a BlockStub node. M2.3 does NOT parse
// statements. parseBlockStub is the documented M3 extension point.
// =============================================================================

// --- parsePostfix — the M2.3 seam ---
export function parsePostfix(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // --- Function expression — `function name?(params) { ... }` ---
    if (kind === TokenKind.KwFunction) {
        return parseFunctionExpr(ctx, false);
    }

    // --- `async` head (M4.3 — RETRACTION).
    // scrml has no `async` modifier at the language level. When `async` heads
    // a function expression / arrow we emit E-ASYNC-NOT-IN-SCRML at the
    // `async` keyword site and RECOVER by parsing the form as if the `async`
    // were absent (the underlying function/arrow stays parseable so error
    // recovery surfaces useful diagnostics on the rest of the program). When
    // `async` is followed by no function-head shape, it is a plain identifier
    // (`{ async: 1 }`, `async.then`) — unchanged. ---
    if (kind === TokenKind.KwAsync) {
        if (peekKind(cursor, 1) === TokenKind.KwFunction) {
            const asyncTok = advance(cursor);   // consume `async`
            recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
                "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
                asyncTok.span);
            return parseFunctionExpr(ctx, false);
        }
        // `async ident =>` — async single-identifier-param arrow.
        if (peekKind(cursor, 1) === TokenKind.Ident
            && peekKind(cursor, 2) === TokenKind.Arrow) {
            const asyncTok = advance(cursor);   // consume `async`
            recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
                "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
                asyncTok.span);
            return parseSingleIdentArrow(ctx, false, asyncTok);
        }
        // `async ( params ) =>` — async parenthesized-param arrow.
        if (peekKind(cursor, 1) === TokenKind.LParen && scanArrowParens(cursor, 1)) {
            const asyncTok = advance(cursor);   // consume `async`
            recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
                "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
                asyncTok.span);
            return parseParenArrow(ctx, false, asyncTok);
        }
        // Otherwise `async` is a plain identifier — emit it and run the
        // postfix chain (so `async.then`, `async(x)` parse as a member /
        // call on an identifier named `async`).
        const asyncTok = advance(cursor);
        return parsePostfixChain(ctx, makeIdent("async", asyncTok.span));
    }

    // --- `new` expression — handled at its own (member-level) precedence. ---
    if (kind === TokenKind.KwNew) {
        const newExpr = parseNewExpr(ctx);
        // A `new` result can still take trailing `.x` / `[x]` / `(...)` —
        // `new Foo().bar`, `new Foo()()`.
        return parsePostfixChain(ctx, newExpr);
    }

    // --- M2.4 keyword-headed expression forms. `match` / `render` produce
    // values that may take a trailing postfix chain (a `match` expression is
    // valid in any expression position per §18.3); `lift` / `fail` are
    // statement-shaped terminal forms — no chain ON the Lift / Fail node. ---
    if (kind === TokenKind.KwMatch) {
        return parsePostfixChain(ctx, parseMatchExpr(ctx));
    }
    if (kind === TokenKind.KwRender) {
        return parsePostfixChain(ctx, parseRenderExpr(ctx));
    }
    if (kind === TokenKind.KwLift) {
        return parseLiftExpr(ctx);
    }
    if (kind === TokenKind.KwFail) {
        return parseFailExpr(ctx);
    }

    // --- `ident =>` — single-identifier-param arrow (no parens). ---
    if (kind === TokenKind.Ident && peekKind(cursor, 1) === TokenKind.Arrow) {
        return parseSingleIdentArrow(ctx, false, null);
    }

    // --- `( params ) =>` — parenthesized-param arrow. The bounded lookahead
    // distinguishes this from a plain parenthesized expression. ---
    if (kind === TokenKind.LParen && scanArrowParens(cursor, 0)) {
        return parseParenArrow(ctx, false, null);
    }

    // --- Everything else: a primary atom + the postfix chain. ---
    const atom = parsePrimary(ctx);
    return parsePostfixChain(ctx, atom);
}

// --- parsePostfixChain — apply member / call / optional-chain / tagged-
// template forms to an already-parsed `base` expression, left-associatively,
// until no postfix form follows. `base` may be a primary atom, a `new`
// result, or another chain result. ---
export function parsePostfixChain(ctx, base) {
    const cursor = ctx.cursor;
    let node = base;

    while (true) {
        const kind = currentKind(cursor);

        // `.property` — non-computed member access.
        if (kind === TokenKind.Dot) {
            advance(cursor);   // consume .
            const prop = parseMemberProperty(ctx);
            const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
            node = makeMember(node, prop, false, false, span);
            continue;
        }

        // `::property` — the `::` member-access alias (§14.4 — M2.4).
        // `Type::Variant` is a pure alias for `Type.Variant`; it produces
        // the same Member node. S114 K5c — `::` is now a single DoubleColon
        // token; the M2.4 two-Colon re-composition has been retired.
        if (kind === TokenKind.DoubleColon) {
            advance(cursor);   // consume `::`
            const prop = parseMemberProperty(ctx);
            const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
            node = makeMember(node, prop, false, false, span);
            continue;
        }

        // `.member` lexed as a BareVariant — M2.4 re-composition. M1 lexes
        // `.ident` as a BareVariant token when the preceding token allows a
        // regex context (`regexAllowedAfter` — true after `~`, `(`, an
        // operator, etc.). When such a BareVariant is SOURCE-ADJACENT to the
        // end of `node`, it is member access on `node` — the prime case is
        // `~.ok` (member access on the `~` accumulator, §32). A gap (`~ .ok`)
        // means a standalone `~` then a separate bare variant. Same parse-
        // layer re-composition shape as the M2.3 `?.ident` handling (K4).
        if (kind === TokenKind.BareVariant && isBareVariantMemberAfter(cursor, node)) {
            const tok = advance(cursor);
            const prop = makeIdent(tok.name, tok.span);
            const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
            node = makeMember(node, prop, false, false, span);
            continue;
        }

        // `[expr]` — computed member access.
        if (kind === TokenKind.LBracket) {
            const open = advance(cursor);   // consume [
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const prop = parseExpression(ctx);
            exitMode(ctx, innerPrior);
            const close = expectRBracket(ctx, open);
            const span = makeSpan(startOf(node), close.end, lineOf(node), colOf(node));
            node = makeMember(node, prop, true, false, span);
            continue;
        }

        // `(args)` — call expression.
        if (kind === TokenKind.LParen) {
            const callInfo = parseCallArguments(ctx);
            const span = makeSpan(startOf(node), callInfo.endPos, lineOf(node), colOf(node));
            node = makeCall(node, callInfo.args, false, span);
            continue;
        }

        // `?.` optional chain — `?.prop`, `?.[expr]`, `?.(args)`. S114 K4
        // — the lexer now emits `?.` as a single OptionalChain token; the
        // post-`?.` token is the property name (Ident or keyword), `[`, or
        // `(`. The M2.3 Question + adjacent Dot/BareVariant re-composition
        // has been retired.
        if (kind === TokenKind.OptionalChain) {
            advance(cursor);   // consume `?.`
            const afterKind = currentKind(cursor);

            if (afterKind === TokenKind.LBracket) {
                // `?.[expr]` — optional computed member.
                const open = advance(cursor);   // consume [
                const innerPrior = enterMode(ctx, ParseMode.InExpression);
                const prop = parseExpression(ctx);
                exitMode(ctx, innerPrior);
                const close = expectRBracket(ctx, open);
                const span = makeSpan(startOf(node), close.end, lineOf(node), colOf(node));
                node = makeMember(node, prop, true, true, span);
                continue;
            }
            if (afterKind === TokenKind.LParen) {
                // `?.(args)` — optional call.
                const callInfo = parseCallArguments(ctx);
                const span = makeSpan(startOf(node), callInfo.endPos, lineOf(node), colOf(node));
                node = makeCall(node, callInfo.args, true, span);
                continue;
            }
            // `?.prop` — Ident or keyword property name. parseMemberProperty
            // accepts either.
            const prop = parseMemberProperty(ctx);
            const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
            node = makeMember(node, prop, false, true, span);
            continue;
        }

        // Tagged template — `` tag`...` ``. A TemplateChunk immediately after
        // an expression is the quasi of a tagged template (per ECMA-262 the
        // MemberExpression / CallExpression is the tag).
        if (kind === TokenKind.TemplateChunk) {
            const quasi = parseTemplateLiteral(ctx);
            const span = makeSpan(startOf(node), endOf(quasi), lineOf(node), colOf(node));
            node = makeTaggedTemplate(node, quasi, span);
            continue;
        }

        // `expr?` — the postfix propagate operator (§19 — M5-swap Wave 2 B1).
        // A `?` in postfix position is the propagate operator ONLY when it is
        // NOT a ternary `?`. `propagateFollows` makes that call: a ternary
        // `?` is always followed (on the same source line) by a consequent
        // expression; a propagate `?` is followed by a statement terminator /
        // a closer / `:` / a `!{` guard / a later-line token. When the `?` is
        // ambiguous (followed by something that COULD start a consequent), it
        // is LEFT for `parseConditional` to consume as a ternary — the
        // conservative choice (a ternary is never mis-built as a propagate).
        if (kind === TokenKind.Question && propagateFollows(cursor)) {
            const q = advance(cursor);   // consume `?`
            const span = makeSpan(startOf(node), q.span.end, lineOf(node), colOf(node));
            node = makePropagate(node, span);
            continue;
        }

        // `expr !{ arms }` — the inline guarded-expression handler (§19 —
        // M5-swap Wave 2 B2). A `!` immediately followed by `{` in POSTFIX
        // position (after a parsed `node`) is the guarded-expr sigil. This is
        // unambiguous: a prefix logical-`!` is parsed by `parseUnary` at the
        // START of a unary, never reaching the postfix chain; a `!` after a
        // complete expression is not valid JS, so `! {` here is the scrml
        // guard. (B6's signature `!` is consumed inside
        // `parseScrmlFunctionDecl` before the body — it never reaches a
        // postfix chain.) The arm-list `{ ... }` body is captured as raw text
        // and parsed with `parseErrorArms` — the same arm grammar the
        // `<errors>` block / the `ErrorEffect` block use.
        if (kind === TokenKind.Bang && peekKind(cursor, 1) === TokenKind.LBrace) {
            node = parseGuardedExprTail(ctx, node);
            continue;
        }

        break;
    }

    return node;
}

// --- propagateFollows — is the cursor's `?` the postfix propagate operator? ---
// The cursor sits on a `Question` token. True iff the `?` is the §19 propagate
// operator (NOT a ternary `?`). The decision is by what follows the `?`:
//   - a statement terminator / closer / separator (`;` `}` `)` `]` `,` EOF
//     `:` / a logic-escape close) — cannot begin a ternary consequent
//   - a `!{` guard lead (the `expr? !{ ... }` propagate-then-guard combo)
//   - a token on a LATER source line (ASI — a ternary consequent is on the
//     same line as its `?`)
// A `?` followed by anything that COULD begin an expression on the same line
// is treated as a ternary `?` and LEFT for `parseConditional`. This is the
// conservative rule from the M5-swap re-decomposition (§B1): "a `?` NOT
// followed by an expression-then-`:` is propagate" — a ternary is never
// mis-built as a propagate.
export function propagateFollows(cursor) {
    if (currentKind(cursor) !== TokenKind.Question) {
        return false;
    }
    const q = current(cursor);
    const next = peek(cursor, 1);
    // No token after `?` — end of input: a bare trailing `?` is a propagate.
    if (next === undefined || next === null) {
        return true;
    }
    // A later source line — the restricted-production posture: a ternary
    // consequent sits on the `?`'s line; a later-line token means propagate.
    if (q !== undefined && q !== null && q.span !== undefined && next.span !== undefined
        && next.span.line > q.span.line) {
        return true;
    }
    const k = next.kind;
    // Statement terminators / closers / separators — none can begin a ternary
    // consequent, so a `?` before one is unambiguously a propagate.
    if (k === TokenKind.Semicolon || k === TokenKind.RBrace
        || k === TokenKind.RParen || k === TokenKind.RBracket
        || k === TokenKind.Comma || k === TokenKind.Colon
        || k === TokenKind.EOF || k === TokenKind.LogicEscapeClose) {
        return true;
    }
    // `expr? !{ ... }` — a propagate immediately followed by a guarded-expr
    // handler. The `!{` lead is the guard sigil; the `?` before it propagates.
    if (k === TokenKind.Bang && peekKind(cursor, 2) === TokenKind.LBrace) {
        return true;
    }
    // Anything else (an identifier / literal / `(` / `-` / a `match` lead /
    // ...) COULD begin a ternary consequent — leave the `?` for the ternary.
    return false;
}

// --- parseGuardedExprTail — the `!{ arms }` guarded-expr postfix (B2) ---
// The cursor sits on the `Bang` of a `!{` postfix guard; `guarded` is the
// already-parsed expression the guard wraps. Captures the brace-delimited
// arm-list body as raw text (a balanced `{ ... }` scan — the same posture
// `typeBodyText` in parse-stmt takes) and parses it with `parseErrorArms`
// (the shared `<errors>` / `ErrorEffect` arm grammar). A missing closing `}`
// records `E-EXPR-GUARDED-UNCLOSED` and the partial arm-list is still used.
function parseGuardedExprTail(ctx, guarded) {
    const cursor = ctx.cursor;
    advance(cursor);                 // consume `!`
    const open = advance(cursor);    // consume `{`

    const parts = [];
    let depth = 1;
    let closeEnd = open.span.end;
    while (atEnd(cursor) === false && depth > 0) {
        const k = currentKind(cursor);
        if (k === TokenKind.LBrace) {
            depth = depth + 1;
        } else if (k === TokenKind.RBrace) {
            depth = depth - 1;
            if (depth === 0) {
                const close = advance(cursor);   // consume the matching `}`
                closeEnd = close.span.end;
                break;
            }
        }
        const tok = advance(cursor);
        parts.push(tok.text);
    }
    if (depth > 0) {
        recordError(ctx, "E-EXPR-GUARDED-UNCLOSED",
            "expected '}' to close a '!{ }' guarded-expression handler", open.span);
    }
    const bodyText = parts.join(" ").trim();
    const arms = parseErrorArms(bodyText);

    const span = makeSpan(startOf(guarded), closeEnd, lineOf(guarded), colOf(guarded));
    return makeGuardedExpr(guarded, arms, span);
}

// --- parseMemberProperty — the property name after `.` / `?.` ---
// Accepts an identifier OR any keyword token: `obj.class`, `obj.if`,
// `obj.new` etc. are legal — a keyword is a valid property name. The
// property is modelled as an Ident node (its text is the property name).
export function parseMemberProperty(ctx) {
    const cursor = ctx.cursor;
    const tok = current(cursor);

    if (tok === undefined || tok === null) {
        recordError(ctx, "E-EXPR-MEMBER-NAME", "expected a property name after '.'", makeSpan(0, 0, 1, 1));
        return makeIdent("", makeSpan(0, 0, 1, 1));
    }

    // An identifier, OR any keyword (keywords are valid property names).
    if (tok.kind === TokenKind.Ident || isKeywordKind(tok.kind)) {
        advance(cursor);
        const name = identTextOf(tok);
        return makeIdent(name, tok.span);
    }

    recordError(ctx, "E-EXPR-MEMBER-NAME", "expected a property name after '.'", tok.span);
    return makeIdent("", tok.span);
}

// --- parseCallArguments — `( arg, arg, ... )`; returns { args, endPos } ---
// Each argument parses at ASSIGNMENT level (a comma separates arguments). A
// `...expr` argument is a spread (modelled with the array-element Spread
// shape, which maps to ESTree's SpreadElement — the same node ESTree uses
// for a call-argument spread).
export function parseCallArguments(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume (
    const prior = enterMode(ctx, ParseMode.InArguments);
    // M4.2 — call args are a no-In carve-out: `f(a in b)` is legal even
    // when the outer context is no-In. Save+clear+restore noIn for the args.
    const inPrior = withInAllowedSubExpr(ctx);
    const args = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RParen) {
        if (currentKind(cursor) === TokenKind.Ellipsis) {
            advance(cursor);   // consume ...
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const spreadExpr = parseAssignmentExpr(ctx);
            exitMode(ctx, innerPrior);
            args.push(makeArraySpread(spreadExpr));
        } else {
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const argExpr = parseAssignmentExpr(ctx);
            exitMode(ctx, innerPrior);
            args.push(argExpr);
        }

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
        } else {
            break;
        }
    }

    restoreNoIn(ctx, inPrior);
    exitMode(ctx, prior);
    const close = expectRParen(ctx, open);
    return { args, endPos: close.end };
}

// --- parseNewExpr — `new Callee(args)` / `new Callee` ---
// Per ECMA-262 the `new` callee is a MemberExpression (member access is part
// of the callee — `new a.b()` calls `a.b`), but a CallExpression is NOT
// (the first `(` after the callee is `new`'s argument list). A nested `new`
// (`new new X()`) recurses. Optional chaining is not legal inside a `new`
// callee — parseMemberOnlyChain stops at `?.`.
export function parseNewExpr(ctx) {
    const cursor = ctx.cursor;
    const newTok = advance(cursor);   // consume `new`

    // The callee: a nested `new`, or a primary atom + a MEMBER-ONLY chain.
    let callee;
    if (currentKind(cursor) === TokenKind.KwNew) {
        callee = parseNewExpr(ctx);
    } else {
        const atom = parsePrimary(ctx);
        callee = parseMemberOnlyChain(ctx, atom);
    }

    // Optional argument list. `new Foo()` -> args; `new Foo` -> [].
    let args = [];
    let endPos = endOf(callee);
    if (currentKind(cursor) === TokenKind.LParen) {
        const callInfo = parseCallArguments(ctx);
        args = callInfo.args;
        endPos = callInfo.endPos;
    }

    const span = makeSpan(newTok.span.start, endPos, newTok.span.line, newTok.span.col);
    return makeNew(callee, args, span);
}

// --- parseMemberOnlyChain — member access without calls / optional chain ---
// Used for a `new` callee: `.x` and `[x]` extend the callee, but `(` and `?.`
// do NOT (the `(` is `new`'s arguments; `?.` is illegal in a `new` callee).
export function parseMemberOnlyChain(ctx, base) {
    const cursor = ctx.cursor;
    let node = base;

    while (true) {
        const kind = currentKind(cursor);

        if (kind === TokenKind.Dot) {
            advance(cursor);   // consume .
            const prop = parseMemberProperty(ctx);
            const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
            node = makeMember(node, prop, false, false, span);
            continue;
        }

        if (kind === TokenKind.LBracket) {
            const open = advance(cursor);   // consume [
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const prop = parseExpression(ctx);
            exitMode(ctx, innerPrior);
            const close = expectRBracket(ctx, open);
            const span = makeSpan(startOf(node), close.end, lineOf(node), colOf(node));
            node = makeMember(node, prop, true, false, span);
            continue;
        }

        break;
    }

    return node;
}

// S114 K4 — isOptionalChainAhead retired. The lexer now emits `?.` as a
// single OptionalChain TokenKind; the postfix-chain dispatch tests
// `currentKind === TokenKind.OptionalChain` directly. See
// IMPLEMENTATION-ROADMAP §4.4 K4 RESOLVED.

// --- isBareVariantMemberAfter — is the cursor's BareVariant a `.member`
// access on `node`? (M2.4 — see parsePostfixChain.) ---
// True iff the current token is a BareVariant whose `span.start` is exactly
// the end of `node`'s span — i.e. the `.ident` is source-adjacent to the
// base, making it member access (`~.ok`) rather than a separate bare variant
// (`~ .ok`).
export function isBareVariantMemberAfter(cursor, node) {
    if (currentKind(cursor) !== TokenKind.BareVariant) {
        return false;
    }
    const tok = current(cursor);
    if (tok === undefined || tok === null || tok.span === undefined) {
        return false;
    }
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return false;
    }
    return tok.span.start === node.span.end;
}

// --- scanArrowParens — bounded lookahead: do the parens at offset `from`
// belong to an arrow function's parameter list? ---
// Walks forward from the `(` token at `cursor.idx + from`, counting bracket
// depth across all three bracket families (parens / brackets / braces — the
// param list can contain default-value expressions with any of them). When
// the matching `)` of the opening `(` is found, the token immediately after
// it is examined: an `=>` there is the unambiguous arrow signal (a plain
// parenthesized expression is never legally followed by `=>`). Pure cursor
// reads — no mutation, no token consumed.
export function scanArrowParens(cursor, from) {
    let i = from;
    if (peekKind(cursor, i) !== TokenKind.LParen) {
        return false;
    }
    let depth = 0;
    // Bound the scan to the remaining token count so a malformed unbalanced
    // input cannot loop forever.
    const limit = cursor.tokens.length + 1;
    let steps = 0;
    while (steps < limit) {
        const k = peekKind(cursor, i);
        if (k === TokenKind.EOF) {
            return false;
        }
        if (k === TokenKind.LParen || k === TokenKind.LBracket || k === TokenKind.LBrace) {
            depth = depth + 1;
        } else if (k === TokenKind.RParen || k === TokenKind.RBracket || k === TokenKind.RBrace) {
            depth = depth - 1;
            if (depth === 0) {
                // The matching `)` of the opening `(` — peek what follows.
                return peekKind(cursor, i + 1) === TokenKind.Arrow;
            }
        }
        i = i + 1;
        steps = steps + 1;
    }
    return false;
}

// --- parseSingleIdentArrow — `ident => body` / `async ident => body` ---
// `headStartTok` is the `async` token when async (for the head span start),
// or null. The single identifier is the sole parameter.
export function parseSingleIdentArrow(ctx, isAsync, headStartTok) {
    const cursor = ctx.cursor;
    const paramTok = advance(cursor);   // consume the identifier
    const param = makeIdent(paramTok.name, paramTok.span);
    return finishArrow(ctx, [param], isAsync, headStartTok ?? paramTok);
}

// --- parseParenArrow — `( params ) => body` / `async ( params ) => body` ---
export function parseParenArrow(ctx, isAsync, headStartTok) {
    const cursor = ctx.cursor;
    const open = current(cursor);
    const params = parseParamList(ctx);
    return finishArrow(ctx, params, isAsync, headStartTok ?? open);
}

// --- finishArrow — consume `=>` and the body; build the Arrow node ---
// The body is concise (an expression) UNLESS it opens with `{`, in which case
// it is a block body captured as a BlockStub (M3 parses the statements).
//
// M4.1 — an arrow ESTABLISHES its own async scope. `inAsync` is the arrow's
// own `async` flag; `inGenerator` is ALWAYS false (an arrow is never a
// generator — there is no `async function*`-shaped arrow). The scope is set
// for the duration of the body parse: a CONCISE body is parsed in-line here
// (`async () => await x` needs `inAsync` for that parse); a BLOCK body is a
// BlockStub whose statements M3's reenterBlockStubs re-parses later — the
// Arrow node carries `isAsync` so that re-entry re-derives the scope.
export function finishArrow(ctx, params, isAsync, headStartTok) {
    const cursor = ctx.cursor;

    if (currentKind(cursor) === TokenKind.Arrow) {
        advance(cursor);   // consume =>
    } else {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
        recordError(ctx, "E-EXPR-ARROW-EXPECTED", "expected '=>' in arrow function", span);
    }

    const scopePrior = enterFunctionScope(ctx, isAsync, false);
    const body = parseArrowOrFunctionBody(ctx, true);
    exitFunctionScope(ctx, scopePrior);

    const startPos = (headStartTok === undefined || headStartTok === null || headStartTok.span === undefined)
        ? startOf(body) : headStartTok.span.start;
    const startLine = (headStartTok === undefined || headStartTok === null || headStartTok.span === undefined)
        ? lineOf(body) : headStartTok.span.line;
    const startCol = (headStartTok === undefined || headStartTok === null || headStartTok.span === undefined)
        ? colOf(body) : headStartTok.span.col;
    const span = makeSpan(startPos, endOf(body), startLine, startCol);
    return makeArrow(params, body, isAsync, span);
}

// --- parseFunctionExpr — `function name?(params) { ... }` ---
// `async` is consumed by the caller (parsePostfix). The block body is a
// BlockStub (M3 parses the statements).
//
// M4.1 — the `function*` generator `*` is now WIRED: `isGenerator` is
// recorded onto the Function node (M2.3 consumed the `*` to keep the head
// parse in sync but discarded the flag — a documented M2.3 deferral). A
// function expression establishes its OWN async/generator scope: `inAsync`
// from its `async` keyword, `inGenerator` from its `*`. The scope is set for
// the BODY parse only (not the param list — `await`/`yield` in a param
// default is a SyntaxError, Acorn-verified, so param defaults stay
// out-of-scope). The body is a BlockStub; the Function node carries
// `isAsync`/`isGenerator` so M3's reenterBlockStubs re-derives the scope.
export function parseFunctionExpr(ctx, isAsync) {
    const cursor = ctx.cursor;
    const fnTok = advance(cursor);   // consume `function`

    // A `function*` generator — consume the `*` and RECORD the flag (M4.1).
    let isGenerator = false;
    if (currentKind(cursor) === TokenKind.Star) {
        advance(cursor);
        isGenerator = true;
    }

    // Optional name — a function expression may be named or anonymous.
    let name = null;
    if (currentKind(cursor) === TokenKind.Ident) {
        const nameTok = advance(cursor);
        name = nameTok.name;
    }

    const params = parseParamList(ctx);
    const scopePrior = enterFunctionScope(ctx, isAsync, isGenerator);
    const body = parseArrowOrFunctionBody(ctx, false);
    exitFunctionScope(ctx, scopePrior);
    const span = makeSpan(fnTok.span.start, endOf(body), fnTok.span.line, fnTok.span.col);
    return makeFunction(name, params, body, isAsync, isGenerator, span);
}

// --- parseArrowOrFunctionBody — concise expression body OR a BlockStub ---
// `allowConcise` is true for arrows (a concise body is legal), false for
// function expressions (whose body is always a block). When the body opens
// with `{`, it is a block — captured as a BlockStub (M3's seam). Otherwise
// (arrows only) it is a concise expression body parsed at assignment level.
export function parseArrowOrFunctionBody(ctx, allowConcise) {
    const cursor = ctx.cursor;

    if (currentKind(cursor) === TokenKind.LBrace) {
        return parseBlockStub(ctx);
    }

    if (allowConcise === false) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
        recordError(ctx, "E-EXPR-FUNCTION-BODY", "expected '{' to open a function body", span);
        // Build an empty block stub so the caller still gets a node.
        return makeBlockStub([], cursor.idx, cursor.idx, span);
    }

    // Concise arrow body — an assignment-level expression. (A concise body
    // is NOT a sequence — `x => a, b` is `(x => a), b`.)
    const innerPrior = enterMode(ctx, ParseMode.InExpression);
    const expr = parseAssignmentExpr(ctx);
    exitMode(ctx, innerPrior);
    return expr;
}

// --- parseBlockStub — capture a brace-delimited block body as a BlockStub ---
// THE DOCUMENTED M3 EXTENSION POINT. M2.3 parses the HEAD of arrows + function
// expressions but does NOT parse statements. This walks the token run from the
// opening `{` to the matching `}`, counting LBrace/RBrace depth, and records
// the body's half-open token range [tokenStart, tokenEnd) + source span. M3's
// statement parser re-enters this range to parse the body in place.
//
// Brace counting is token-kind exact: a `}` that closes a template
// interpolation is a TemplateInterpEnd token (a distinct kind M1 emits), NOT
// an RBrace — so an interpolation `${...}` inside the block does not perturb
// the count. Likewise object literals inside the block contribute matched
// LBrace/RBrace pairs and net to zero.
export function parseBlockStub(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume the opening {
    const tokenStart = cursor.idx;  // first token INSIDE the block
    let depth = 1;
    let closeTok = open;

    while (atEnd(cursor) === false && depth > 0) {
        const kind = currentKind(cursor);
        if (kind === TokenKind.LBrace) {
            depth = depth + 1;
        } else if (kind === TokenKind.RBrace) {
            depth = depth - 1;
            if (depth === 0) {
                closeTok = advance(cursor);   // consume the matching }
                break;
            }
        }
        advance(cursor);
    }

    if (depth > 0) {
        recordError(ctx, "E-EXPR-UNCLOSED-BLOCK", "expected '}' to close a function body", open.span);
    }

    // The body token range is half-open: [tokenStart, tokenEnd). tokenEnd is
    // the index of the closing `}` (the first token NOT part of the body).
    const tokenEnd = (depth === 0) ? (cursor.idx - 1) : cursor.idx;
    const bodyTokens = cursor.tokens.slice(tokenStart, tokenEnd);
    const span = makeSpan(open.span.start, closeTok.span.end, open.span.line, open.span.col);
    return makeBlockStub(bodyTokens, tokenStart, tokenEnd, span);
}

// --- parseParamList — `( param, param, ... )` for an arrow / function head ---
// Consumes the parens. Each parameter is parsed by parseParam (identifier,
// `...rest`, defaulted `name = expr`, or a destructuring-pattern stand-in).
export function parseParamList(ctx) {
    const cursor = ctx.cursor;

    if (currentKind(cursor) !== TokenKind.LParen) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
        recordError(ctx, "E-EXPR-PARAM-LIST", "expected '(' to open a parameter list", span);
        return [];
    }
    const open = advance(cursor);   // consume (
    const params = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RParen) {
        const param = parseParam(ctx);
        if (param === undefined || param === null) {
            break;
        }
        params.push(param);

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
        } else {
            break;
        }
    }

    expectRParen(ctx, open);
    return params;
}

// --- skipParamTypeAnnotation — consume a `: TypeExpr` parameter type ---
// scrml allows a typed function parameter — `fn f(name: string)` — the same
// `:` annotation `let x: T` carries. The native parser does not retain the
// type (it is a downstream-typer concern, exactly like skipReturnTypeAnnotation
// in parse-stmt.js); this skips the annotation tokens up to the parameter
// boundary. The boundary is a `,` (next parameter), a `)` (param-list close),
// or an `=` (a defaulted typed parameter — `name: T = expr`) at nesting
// depth 0. `<>` generics, `()` refinement predicates (`number(>0)`), `{}`
// struct-type literals and `[]` tuple types are tracked so a delimiter inside
// a nested type does not end the scan early. The cursor must sit ON the `:`.
function skipParamTypeAnnotation(ctx) {
    const cursor = ctx.cursor;
    advance(cursor);   // consume the `:`
    let angleDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    while (atEnd(cursor) === false) {
        const k = currentKind(cursor);
        const atDepthZero = angleDepth === 0 && parenDepth === 0
            && braceDepth === 0 && bracketDepth === 0;
        if (atDepthZero && (k === TokenKind.Comma || k === TokenKind.RParen
            || k === TokenKind.Assign)) {
            return;   // the parameter boundary — stop before it
        }
        if (k === TokenKind.LParen) {
            parenDepth = parenDepth + 1;
        } else if (k === TokenKind.RParen) {
            parenDepth = parenDepth - 1;
        } else if (k === TokenKind.LBrace) {
            braceDepth = braceDepth + 1;
        } else if (k === TokenKind.RBrace) {
            braceDepth = braceDepth - 1;
        } else if (k === TokenKind.LBracket) {
            bracketDepth = bracketDepth + 1;
        } else if (k === TokenKind.RBracket) {
            bracketDepth = bracketDepth - 1;
        } else if (k === TokenKind.LessThan && parenDepth === 0) {
            angleDepth = angleDepth + 1;
        } else if (k === TokenKind.GreaterThan && parenDepth === 0
            && angleDepth > 0) {
            angleDepth = angleDepth - 1;
        }
        advance(cursor);
    }
}

// --- parseParam — one arrow / function parameter ---
// Forms handled:
//   ident                — a plain identifier parameter (BindingIdent)
//   ident : Type         — a typed parameter (the type is skipped — a
//                          downstream-typer concern)
//   ...target            — a rest parameter (binding-shape RestElement)
//   target = expr        — a defaulted parameter (binding-shape
//                          AssignmentPattern)
//   { ... } / [ ... ]    — a destructuring pattern (ObjectPattern /
//                          ArrayPattern — REAL binding nodes via
//                          parseBinding; M4.2 closed the K6 stand-in).
export function parseParam(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // Rest parameter — `...target`. M4.2 — emits a BINDING-shape RestElement
    // (bindingKind: "RestElement") so the param surface is now consistent
    // with vardecl rest bindings.
    if (kind === TokenKind.Ellipsis) {
        const restTok = advance(cursor);   // consume ...
        const target = parseParamTarget(ctx);
        // A rest parameter may carry a type annotation — `...rest: T[]`.
        if (currentKind(cursor) === TokenKind.Colon) {
            skipParamTypeAnnotation(ctx);
        }
        const span = makeSpan(restTok.span.start, endOf(target), restTok.span.line, restTok.span.col);
        return makeBindingRestElement(target, span);
    }

    const target = parseParamTarget(ctx);

    // Typed parameter — `name: Type`. The `:` annotation is consumed and
    // discarded (the native parser does not retain parameter types — a
    // downstream-typer concern). A defaulted typed parameter `name: T = expr`
    // is handled by the `Assign` branch below — the annotation scan stops in
    // front of the `=`.
    if (currentKind(cursor) === TokenKind.Colon) {
        skipParamTypeAnnotation(ctx);
    }

    // Defaulted parameter — `target = expr`. M4.2 — emits a BINDING-shape
    // AssignmentPattern (bindingKind: "AssignmentPattern"). The default-value
    // expression parses in a normal in-allowed scope: a function param head is
    // never in a no-In context (the for-head no-In scope is the only no-In
    // context in the parser, and a function declaration cannot appear there).
    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume =
        const innerPrior = enterMode(ctx, ParseMode.InExpression);
        const defaultExpr = parseAssignmentExpr(ctx);
        exitMode(ctx, innerPrior);
        const span = makeSpan(startOf(target), endOf(defaultExpr), lineOf(target), colOf(target));
        return makeBindingAssignmentPattern(target, defaultExpr, span);
    }

    return target;
}

// --- parseParamTarget — the binding target of one parameter ---
// An identifier, or a destructuring pattern (object / array). M4.2 — K6
// closed: the pattern is parsed with parseBinding (yielding a REAL binding
// node — BindingIdent / ObjectPattern / ArrayPattern), no longer a literal
// stand-in. Function-param + for-in/of non-decl LHS + vardecl destructuring
// now all share ONE binding-pattern surface (parseBinding below).
export function parseParamTarget(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    if (kind === TokenKind.Ident) {
        return parseBindingIdent(ctx);
    }

    if (kind === TokenKind.LBrace || kind === TokenKind.LBracket) {
        // Destructuring pattern — a REAL binding node (M4.2 — K6 closed).
        return parseBinding(ctx);
    }

    const here = current(cursor);
    const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
    recordError(ctx, "E-EXPR-PARAM", "expected a parameter name", span);
    return makeBindingIdent("", span);
}

// --- isKeywordKind — does a TokenKind name a JS keyword token? ---
// M1 lexes every keyword to its own `Kw*` TokenKind. A keyword is a valid
// property name after `.` (`obj.class`, `obj.if`), so parseMemberProperty
// accepts these. By convention every keyword TokenKind name begins with `Kw`.
export function isKeywordKind(kind) {
    if (typeof kind !== "string") {
        return false;
    }
    return kind.indexOf("Kw") === 0;
}

// --- identTextOf — the identifier / keyword text of a token ---
// An Ident token carries `.name`; a keyword token carries the keyword text in
// `.text`. Returns the property-name string for parseMemberProperty.
export function identTextOf(tok) {
    if (tok === undefined || tok === null) {
        return "";
    }
    if (tok.name !== undefined && tok.name !== null) {
        return tok.name;
    }
    if (tok.text !== undefined && tok.text !== null) {
        return tok.text;
    }
    return "";
}

// --- spanOf / start / end / line / col helpers — node-span arithmetic ---
// A binary / logical / sequence / conditional node's span covers from the
// start of its first child to the end of its last child. These helpers read
// a node's span defensively (a malformed parse can yield a null child).
export function startOf(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 0;
    }
    return node.span.start;
}
export function endOf(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 0;
    }
    return node.span.end;
}
export function lineOf(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 1;
    }
    return node.span.line;
}
export function colOf(node) {
    if (node === undefined || node === null || node.span === undefined || node.span === null) {
        return 1;
    }
    return node.span.col;
}
export function spanOf(leftNode, rightNode) {
    return makeSpan(startOf(leftNode), endOf(rightNode), lineOf(leftNode), colOf(leftNode));
}

// --- parsePrimary — parse one primary expression; dispatch on token kind ---
export function parsePrimary(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // Numeric literal
    if (kind === TokenKind.NumberLit) {
        const tok = advance(cursor);
        return makeNumberLit(tok.value, tok.text, tok.span);
    }

    // String literal
    if (kind === TokenKind.StringLit) {
        const tok = advance(cursor);
        return makeStringLit(tok.cooked, tok.text, tok.span);
    }

    // Boolean literal — true / false
    if (kind === TokenKind.KwTrue) {
        const tok = advance(cursor);
        return makeBoolLit(true, tok.span);
    }
    if (kind === TokenKind.KwFalse) {
        const tok = advance(cursor);
        return makeBoolLit(false, tok.span);
    }

    // Regex literal
    if (kind === TokenKind.RegexLit) {
        const tok = advance(cursor);
        return makeRegexLit(tok.pattern, tok.flags, tok.text, tok.span);
    }

    // Template literal
    if (kind === TokenKind.TemplateChunk) {
        return parseTemplateLiteral(ctx);
    }

    // Identifier
    if (kind === TokenKind.Ident) {
        const tok = advance(cursor);
        return makeIdent(tok.name, tok.span);
    }

    // `this` — keyword atom (M2.3).
    if (kind === TokenKind.KwThis) {
        const tok = advance(cursor);
        return makeThis(tok.span);
    }

    // `super` — keyword atom (M2.3). Bare `super` is not a valid expression
    // on its own, but parsePrimary returns the atom and the postfix chain
    // shapes the legal `super.x` / `super[x]` / `super(...)` forms.
    if (kind === TokenKind.KwSuper) {
        const tok = advance(cursor);
        return makeSuper(tok.span);
    }

    // @-cell
    if (kind === TokenKind.ScrmlAt) {
        const tok = advance(cursor);
        return makeAtCell(tok.name, tok.span);
    }

    // Bare variant .X
    if (kind === TokenKind.BareVariant) {
        const tok = advance(cursor);
        return makeBareVariant(tok.name, tok.span);
    }

    // --- M2.4 scrml-extension primary atoms ---

    // `not` — the absence-value atom (§42). `not` is a VALUE, not a prefix
    // operator: `not` at expression-head position is the absence sentinel.
    // (Prefix `not (expr)` is E-TYPE-045 per §42.10 — a typer concern; the
    // parser parses the `not` atom and the parenthesized expression is then
    // a separate primary that would not be consumed, surfacing the misuse
    // to a later stage rather than silently rewriting it to `!`.)
    if (kind === TokenKind.KwNot) {
        const tok = advance(cursor);
        return makeNotValue(tok.span);
    }

    // `~` — the pipeline-accumulator atom (§32). M1 lexes a bare `~` as a
    // BitNot token; `~x` (bitwise-not) is consumed by parseUnary BEFORE the
    // cursor reaches parsePrimary — so a BitNot arriving HERE is the
    // standalone `~` accumulator (it has no operand). (Parse-layer
    // disambiguation, the same shape as K3/K4 — see IMPLEMENTATION-ROADMAP
    // §4.4. The canonical fix is M1 lexing a standalone `~` as a Tilde
    // token; reported for a K-class roadmap entry.)
    if (kind === TokenKind.BitNot) {
        const tok = advance(cursor);
        return makeTilde(tok.span);
    }

    // `?{ sql }` — a SQL block (§8). M1 lexes the whole `?{...}` as one
    // SqlBlock token carrying `.raw` (the verbatim source incl. delimiters).
    // The block is captured as an atom; chained `.all()` / `.get()` calls
    // are the ordinary postfix chain (M2.3).
    if (kind === TokenKind.SqlBlock) {
        const tok = advance(cursor);
        return makeSql(tok.raw, tok.span);
    }

    // `<#id>` — an input-state reference (§36). See parseInputStateRef for
    // the parse-layer re-composition (M1 does not lex `<#` / `#`).
    if (kind === TokenKind.LessThan && isInputStateRefAhead(cursor)) {
        return parseInputStateRef(ctx);
    }

    // MK4 — JS->markup delegate-up direction (R1 spike §1.2 / Pillar 1
    // markup-as-value). A `<` in expression-head position that is preceded
    // by a value-following token AND followed source-adjacent by an Ident
    // is a markup-value opener — delegate to the markup layer.
    //
    // The discriminator (markupValueAllowedAfter — parse-seam.js) is the
    // twin of M1's regexAllowedAfter: a bounded prev-token calculation, NOT
    // backtracking (R1 spike §3.4). The next-char shape check is the
    // source-adjacency rule: a `<` followed by a SPACE-then-Ident is not a
    // markup opener (the markup grammar requires the name to begin
    // immediately after the `<` — block-splitter.js line 1618 form, lifted
    // verbatim into the native parser). The MarkupValue node carries the
    // delegated markup block-stream.
    if (kind === TokenKind.LessThan && isMarkupValueAhead(ctx)) {
        return parseMarkupValue(ctx);
    }

    // `::Variant` — a bare variant via the `::` alias (§14.4). S114 K5c —
    // `::` is now a single DoubleColon token; `::Variant` produces the same
    // BareVariant node `.Variant` produces (the `::` form is a pure alias).
    if (kind === TokenKind.DoubleColon && isQualifiedVariantColonAhead(cursor)) {
        return parseLeadingDoubleColonVariant(ctx);
    }

    // Parenthesized expression ( expr )
    if (kind === TokenKind.LParen) {
        return parseParenExpression(ctx);
    }

    // Array literal [ ... ]
    if (kind === TokenKind.LBracket) {
        return parseArrayLiteral(ctx);
    }

    // Object literal { ... }
    if (kind === TokenKind.LBrace) {
        return parseObjectLiteral(ctx);
    }

    // Unrecognized
    const here = current(cursor);
    const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
    recordError(ctx, "E-EXPR-UNEXPECTED", "unexpected token in expression position: " + String(kind), span);
    return null;
}

// =============================================================================
// M2.4 — scrml-extension expression forms (D5 MUST ADD).
//
// These are the scrml-language extensions stock Acorn cannot parse — exactly
// the forms the legacy `preprocessForAcorn` regex cascade rewrites into JS
// placeholders. The native parser parses them DIRECTLY, with no preprocessing
// pass and no placeholder round-trip:
//
//   `not` value · `~` accumulator · `?{sql}` · `<#id>` · `::Variant`  — primary
//                                                                       atoms
//   `is` / `is not` / `is some` / `is given` / `is not not` / `is .Variant`
//                                                                — postfix
//                                                                  predicate
//   `match expr { arms }` · `render name(args)` · `lift expr` ·
//   `fail Type::Variant(args)`                              — keyword heads
//
// Three forms re-compose at the parse layer because M1's lexer does not munch
// them into single tokens (the same shape as roadmap §4.4 K3/K4):
//   - `<#id>`     — M1 does not lex `#`; `<#id>` arrives as LessThan, Ident,
//                   GreaterThan with a one-char span gap where the `#` was.
//   - `::Variant` — M1 lexes `::` as two adjacent Colon tokens.
//   - `~`         — M1 lexes a standalone `~` as a BitNot token.
// Each re-composition is span-adjacency-checked and AST-equivalent to the
// canonical form. The canonical fix (M1 lexing `<#` / `::` / standalone `~`)
// is a NEW K-class roadmap item reported alongside this dispatch.
// =============================================================================

// --- isInputStateRefAhead — bounded lookahead: is the cursor at `<#id>`? ---
// S114 K5a — the lexer now emits `#` as a single Hash TokenKind, so `<#id>`
// lexes as `LessThan Hash Ident GreaterThan` (all source-adjacent — no gap).
// A plain `<` (less-than operator) never reaches parsePrimary as a head, and
// `< # ident >` is not a JS expression — within the JS-expression layer this
// shape is unambiguously the §36 input-state reference.
export function isInputStateRefAhead(cursor) {
    if (currentKind(cursor) !== TokenKind.LessThan) {
        return false;
    }
    if (peekKind(cursor, 1) !== TokenKind.Hash) {
        return false;
    }
    if (peekKind(cursor, 2) !== TokenKind.Ident) {
        return false;
    }
    if (peekKind(cursor, 3) !== TokenKind.GreaterThan) {
        return false;
    }
    const lt = current(cursor);
    const hash = peek(cursor, 1);
    const id = peek(cursor, 2);
    const gt = peek(cursor, 3);
    if (lt === undefined || lt === null || hash === undefined || hash === null
        || id === undefined || id === null || gt === undefined || gt === null) {
        return false;
    }
    if (lt.span === undefined || hash.span === undefined
        || id.span === undefined || gt.span === undefined) {
        return false;
    }
    // All four tokens source-adjacent — `<#id>`, not `< # id >`.
    if (hash.span.start !== lt.span.end) {
        return false;
    }
    if (id.span.start !== hash.span.end) {
        return false;
    }
    return gt.span.start === id.span.end;
}

// --- parseInputStateRef — `<#id>` input-state reference (§36) ---
// Consumes the LessThan, Hash, Ident, GreaterThan four-token sequence
// isInputStateRefAhead confirmed. The resulting InputStateRef is an atom; a
// trailing `.pressed(...)` / `.value` member-or-call chain is the ordinary
// postfix chain (M2.3).
export function parseInputStateRef(ctx) {
    const cursor = ctx.cursor;
    const lt = advance(cursor);          // consume `<`
    advance(cursor);                     // consume `#` (S114 K5a Hash token)
    const idTok = advance(cursor);       // consume the id Ident
    const gt = advance(cursor);          // consume `>`
    const span = makeSpan(lt.span.start, gt.span.end, lt.span.line, lt.span.col);
    return makeInputStateRef(idTok.name, span);
}

// =============================================================================
// MK4 — JS->markup delegate-up direction (R1 spike §1.2 / Pillar 1).
//
// A `<` at expression-head position opens a markup-value when ALL of:
//   1. the prev-token is in the value-following set (markupValueAllowedAfter
//      — parse-seam.js; the twin of M1's regexAllowedAfter);
//   2. the NEXT token is an Ident and SOURCE-ADJACENT to the `<` (no
//      whitespace between `<` and the name — the markup-opener shape that
//      block-splitter.js line 1618 enforces verbatim into the native parser).
//
// `isMarkupValueAhead` answers both questions with bounded lookahead (1
// token back + 1 token forward + a span-adjacency check). NOT backtracking
// (R1 spike §3.4).
//
// `parseMarkupValue` performs the delegation. When `ctx.source` is set
// (MK4: the optional 2nd arg to makeParseExprContext), the helper slices
// the source between the `<` and the markup-element's close + calls
// parseMarkup on the slice; the resulting block-stream is wrapped in a
// MarkupValue node. When `ctx.source` is null (the existing parseExpr
// (tokens)-only entry the conformance harness uses), the helper falls
// back to a TOKEN-RANGE capture (the same shape M2.3's BlockStub uses
// for function bodies) — a MarkupValue carrying the captured token range
// + the JS-coordinate-space span; a later milestone re-parses the range
// when the source is available. Either way the MarkupValue node carries
// `node.span` in the JS coordinate space.
// =============================================================================

// isMarkupValueAhead — calculation (pure predicate). Bounded — 1 token back +
// 1 token forward + 1 span-adjacency check.
export function isMarkupValueAhead(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) !== TokenKind.LessThan) return false;

    // (1) The prev-token discriminator. markupValueAllowedAfter handles
    // start-of-stream (`undefined`/`null`) as a value-following position.
    if (!markupValueAllowedAfter(previousKind(cursor))) return false;

    // (2) The NEXT token must be an Ident source-adjacent to the `<`. The
    // markup grammar requires the tag name to begin IMMEDIATELY after the
    // `<` (no whitespace) — `< div` is NOT a markup opener (it is a
    // less-than followed by an ident, ungrammatical but not markup). A
    // post-`<` UpperOrLower-letter check would equivalently work, but the
    // token spans M1 records already give us source-adjacency for free.
    const lt = current(cursor);
    const next = peek(cursor, 1);
    if (next === undefined || next === null) return false;
    if (next.kind !== TokenKind.Ident) return false;
    if (next.span === undefined || lt.span === undefined) return false;
    if (next.span.start !== lt.span.end) return false;

    return true;
}

// parseMarkupValue — STATE write (cursor advance) + calculation (the
// MarkupValue node). Delegate the `<tag>...</tag>` element parse to the
// markup layer; wrap the produced block-stream in a MarkupValue node.
//
// With ctx.source available: slice the source from the `<` to the
// matching close (found by walking forward over the token stream + the
// source — a TagFrame-depth balance, R1 spike §3.2 CloseCondition
// .TagFrameBalanced). Run parseMarkup on the slice. The first Markup
// block in the resulting stream is THIS element; subsequent blocks (if
// any) are the same source's remainder — for a well-formed
// markup-as-value the slice is the element alone and the stream has one
// Markup block.
//
// Without ctx.source: fall back to a token-range MarkupValue carrying
// the captured token range; the actual markup parse is deferred (the
// same shape M2.3 uses for BlockStub function bodies).
export function parseMarkupValue(ctx) {
    const cursor = ctx.cursor;
    const lt = current(cursor);                  // the `<` token (not yet consumed)
    const ltSpan = lt.span;

    if (ctx.source !== null && ctx.source !== undefined) {
        // Source-available path — delegate to the markup layer via a slice.
        const sliceStart = ltSpan.start;
        const sliceTail = ctx.source.substring(sliceStart);
        const trace = parseMarkupViaLazyRequire(sliceTail);
        if (trace !== null && trace.ctx !== undefined && trace.ctx.nodes.length > 0) {
            const firstBlock = trace.ctx.nodes[0];
            if (firstBlock.span !== undefined && firstBlock.span !== null) {
                const sliceCloseEnd = firstBlock.span.end;
                const closeEnd = sliceStart + sliceCloseEnd;

                // Shift the markup blocks' spans from slice-local to host-
                // absolute (the slice's local-(0,1,1) maps to ltSpan.start).
                // Only shift this element's block (trace.ctx.nodes[0]);
                // deeper-block shifts are best-effort (the children's spans
                // are slice-local — M5+ codegen re-derives them).
                shiftMarkupBlockSpan(firstBlock, sliceStart, ltSpan.line, ltSpan.col);

                // MK4 C6 — cross-seam error attribution (R1 spike §1.4).
                // Forward the markup-layer diagnostics into the expression
                // ctx's errors with the JS->markup delegation marker. The
                // markup-side diagnostics have slice-local spans; shift them.
                if (trace.ctx.diagnostics !== undefined && trace.ctx.diagnostics !== null) {
                    let i = 0;
                    while (i < trace.ctx.diagnostics.length) {
                        const d = trace.ctx.diagnostics[i];
                        const absSpan = shiftBodyLocalSpan(d.span, sliceStart, ltSpan.line, ltSpan.col);
                        const err = { code: d.code, message: d.message, span: absSpan };
                        // Mark the delegation provenance: a JSToMarkup
                        // frame at this `<` boundary. Downstream M5+ reads
                        // this so the diagnostic's blame chain is visible.
                        err.delegationFrame = {
                            kind: "ElementValue",
                            openSpan: ltSpan,
                            via: "JSToMarkup",
                        };
                        ctx.errors.push(err);
                        i = i + 1;
                    }
                }

                // Advance the JS-layer token cursor past every token whose
                // start lies BEFORE closeEnd in the source.
                advancePastSourcePos(cursor, closeEnd);
                const span = makeSpan(ltSpan.start, closeEnd, ltSpan.line, ltSpan.col);
                return makeMarkupValue(trace.ctx.nodes.slice(0, 1), span);
            }
        }
        // No close found — fall through to the token-range capture path
        // for recovery (the markup-as-value never closed; record a
        // diagnostic and capture what we can).
        recordError(ctx, "E-MARKUP-VALUE-UNCLOSED",
            "markup-as-value never closes: no matching '/>' or '</...>' found",
            ltSpan);
    }


    // Source-unavailable / unclosed path — token-range capture (the
    // BlockStub-shape fallback). Walk forward, tracking `<...>` depth via
    // token kinds; the close is the GreaterThan that follows a self-closing
    // `/` OR a `</` `Ident` `>` triple OR a `</` `>` triple.
    const tokenStart = cursor.idx;
    const startSpan = ltSpan;
    advance(cursor);                              // consume the leading `<`
    let tagDepth = 1;
    let endSpan = startSpan;
    while (atEnd(cursor) === false && tagDepth > 0) {
        const k = currentKind(cursor);
        if (k === TokenKind.LessThan) {
            // Nested `<...>` — increment depth iff the next token is an
            // Ident source-adjacent to this `<` (a nested markup opener
            // — same shape isMarkupValueAhead checks). If next is `/`,
            // this is a closer.
            const here = current(cursor);
            const after = peek(cursor, 1);
            if (after !== undefined && after !== null && after.kind === TokenKind.Slash) {
                // `</...>` — a closer.
                tagDepth = tagDepth - 1;
                advance(cursor);                  // consume `<`
                advance(cursor);                  // consume `/`
                // Optional Ident before `>`.
                if (currentKind(cursor) === TokenKind.Ident) advance(cursor);
                if (currentKind(cursor) === TokenKind.GreaterThan) {
                    endSpan = advance(cursor).span; // consume `>`
                }
                continue;
            }
            if (after !== undefined && after !== null && after.kind === TokenKind.Ident
                && here.span !== undefined && after.span !== undefined
                && after.span.start === here.span.end) {
                tagDepth = tagDepth + 1;
                advance(cursor);                  // consume `<`
                continue;
            }
            // Bare `<` inside the markup-value — count as nothing (e.g. a
            // less-than appearing inside a `${...}` body inside the markup).
            advance(cursor);
            continue;
        }
        if (k === TokenKind.Slash) {
            const after = peek(cursor, 1);
            if (after !== undefined && after !== null && after.kind === TokenKind.GreaterThan) {
                // Self-closing `/>` — element ends here.
                advance(cursor);                  // consume `/`
                endSpan = advance(cursor).span;   // consume `>`
                tagDepth = tagDepth - 1;
                continue;
            }
        }
        if (k === TokenKind.GreaterThan && tagDepth === 1) {
            // End of opener `>` is NOT the close of the element if the
            // element is not self-closing — the children + closer follow.
            // Without source we cannot reliably distinguish; conservatively
            // consume and continue (the closer's `</...>` form will hit
            // the LessThan-then-Slash branch above).
            advance(cursor);
            continue;
        }
        advance(cursor);
    }
    const tokenEnd = cursor.idx;
    const span = makeSpan(startSpan.start, endSpan.end, startSpan.line, startSpan.col);
    // Token-range capture — the markup is the unparsed token range
    // (the BlockStub shape). A downstream consumer can re-parse it when
    // the source is available; downstream M5+ is the normal path.
    const markup = { kind: "MarkupTokenRange", tokens: cursor.tokens.slice(tokenStart, tokenEnd), tokenStart, tokenEnd, span };
    return makeMarkupValue(markup, span);
}

// shiftMarkupBlockSpan — STATE write. Shift this markup-block's span from
// slice-local to host-absolute (MK4 C6). Only the top-level block's span is
// adjusted (the deeper children carry slice-local spans which downstream M5+
// codegen re-derives).
function shiftMarkupBlockSpan(block, hostStart, hostLine, hostCol) {
    if (block === null || block === undefined) return;
    if (block.span === undefined || block.span === null) return;
    const local = block.span;
    block.span = {
        start: hostStart + (local.start ?? 0),
        end:   hostStart + (local.end ?? 0),
        line:  hostLine,
        col:   hostCol,
    };
}

// shiftBodyLocalSpan — calculation (pure). Translate a body-local span into
// the host coordinate space (MK4 C6 — same shape as the markup-layer's
// shiftSpan in parse-markup.js). Used by parseMarkupValue to shift the
// markup-layer's slice-local diagnostic spans into the JS-layer's host
// coordinate space before pushing them into ctx.errors.
function shiftBodyLocalSpan(localSpan, hostStart, hostLine, hostCol) {
    if (localSpan === undefined || localSpan === null) {
        return { start: hostStart, end: hostStart, line: hostLine, col: hostCol };
    }
    return {
        start: hostStart + (localSpan.start ?? 0),
        end:   hostStart + (localSpan.end ?? 0),
        line:  hostLine + ((localSpan.line ?? 1) - 1),
        col:   ((localSpan.line ?? 1) === 1) ? hostCol + ((localSpan.col ?? 1) - 1) : (localSpan.col ?? 1),
    };
}

// findMarkupValueCloseEndFromSource — calculation (pure). Source-string
// walk: starting at the `<` of a markup-value opener, scan forward to find
// the element's close (a `/>` self-close OR the matching `</tag>` /
// `</>`). Returns the file-absolute offset ONE PAST the close, or -1 if
// no close is found.
//
// Mechanism: an outer TagFrame-depth count over the source. The walk does
// NOT need full markup-grammar knowledge — only the structural recognizers
// (the same closed-set recognition tag-frame.js uses): a `<ident` /
// `<UPPER` opens a nested tag (depth + 1); a `/>` closes a self-closer
// (depth - 1); a `</...>` closes a paired tag (depth - 1). String literals
// inside the markup ARE counted as opaque — a `<` inside `"..."` is text,
// not a tag opener (SPEC §4.18.3). This walk uses parseMarkup directly to
// leverage the markup engine's structural recognition + then reads the
// resulting first-block's span.
function findMarkupValueCloseEndFromSource(source, startPos) {
    const tail = source.substring(startPos);
    const trace = parseMarkupViaLazyRequire(tail);
    if (trace === null || trace.ctx === undefined) return -1;
    const blocks = trace.ctx.nodes;
    if (blocks === null || blocks.length === 0) return -1;
    // The first block is THIS element — its span.end is the element's
    // close-end, RELATIVE to the `tail` slice. Add startPos to get the
    // absolute offset.
    const first = blocks[0];
    if (first === undefined || first === null || first.span === undefined) return -1;
    return startPos + first.span.end;
}

// parseMarkupViaLazyRequire — calculation (the markup block-stream + the
// markup-layer diagnostics). A lazy import of parse-markup.js to avoid the
// parse-expr -> parse-markup import cycle at module-init (parse-markup
// imports parseExpr; parse-expr importing parseMarkup at top-level would
// deadlock the ESM module-init). The lazy require runs at first-call time,
// after both modules are loaded.
//
// MK4 C6 — uses parseMarkupTrace (not parseMarkup) so the markup-layer's
// ctx is accessible. The caller (parseMarkupValue) FORWARDS the markup-
// layer diagnostics into the expression ctx's errors with the JS->markup
// delegation marker attached (R1 spike §1.4 — cross-seam error attribution).
//
// P5-14 v2 (S121): every parseMarkupViaLazyRequire call IS a slice-mode
// parse — parse-expr.js invokes the markup engine on a SUBSTRING of the
// host source extracted at the `<` opener (parseMarkupValue's source-
// available path) or for a depth-walk lookahead (findMarkupValueCloseEnd
// FromSource). Both are conceptually "parse this markup-as-value
// substring", so the lazy-requirer unconditionally passes
// `{ inMarkupValueSlice: true }`. The markup-layer's handleCloser then
// derives `allowMismatchPop: false`, mirroring the live `parseLiftTag`
// BAIL recovery (ast-builder.js L3098-3099) — a mismatched explicit
// closer inside the slice does NOT pop the slice's root, so the slice
// returns a truncated-but-not-prematurely-collapsed block stream and
// the LIVE-side raw-text component-def fallback can fire downstream.
let _parseMarkupTraceCached = null;
function parseMarkupViaLazyRequire(source) {
    if (_parseMarkupTraceCached === null) {
        try {
            // eslint-disable-next-line global-require
            const mod = require("./parse-markup.js");
            _parseMarkupTraceCached = mod.parseMarkupTrace;
        } catch (e) {
            return null;
        }
    }
    if (typeof _parseMarkupTraceCached !== "function") return null;
    const trace = _parseMarkupTraceCached(source, { inMarkupValueSlice: true });
    if (trace === null || trace === undefined) return null;
    return trace;  // { ctx, contextTrace } where ctx.nodes is the block stream
}

// advancePastSourcePos — STATE write (cursor.idx advance). Move the JS-
// layer token cursor forward until every consumed token's span.end lies
// AT OR BEFORE `targetSourcePos`. Used by parseMarkupValue's source-
// available path: after the markup-layer consumed the element from the
// source, the JS-layer's token cursor must be advanced past every token
// whose source range was inside the markup-value's extent.
function advancePastSourcePos(cursor, targetSourcePos) {
    while (atEnd(cursor) === false) {
        const tok = current(cursor);
        if (tok === undefined || tok === null) break;
        if (tok.span === undefined || tok.span === null) {
            advance(cursor);
            continue;
        }
        if (tok.span.end > targetSourcePos) break;
        advance(cursor);
    }
}

// --- isQualifiedVariantColonAhead — is the cursor at a leading `::Variant`? ---
// S114 K5c — the lexer emits `::` as a single DoubleColon TokenKind. A leading
// `::Variant` is therefore DoubleColon then Ident. (A bare DoubleColon at
// expression head can be nothing else — the `::` is unambiguously the
// bare-variant alias once it appears in primary position.)
export function isQualifiedVariantColonAhead(cursor) {
    if (currentKind(cursor) !== TokenKind.DoubleColon) {
        return false;
    }
    return peekKind(cursor, 1) === TokenKind.Ident;
}

// --- parseLeadingDoubleColonVariant — `::Variant` bare variant (§14.4) ---
// `::Variant` is a pure alias for `.Variant` — it re-composes to the SAME
// BareVariant node `.Variant` produces. S114 K5c — the lexer emits `::` as a
// single DoubleColon token; consume DoubleColon + the variant Ident.
export function parseLeadingDoubleColonVariant(ctx) {
    const cursor = ctx.cursor;
    const dc = advance(cursor);          // consume `::`
    const nameTok = advance(cursor);     // consume the variant Ident
    const span = makeSpan(dc.span.start, nameTok.span.end, dc.span.line, dc.span.col);
    return makeBareVariant(nameTok.name, span);
}

// --- isDoubleColonAhead — is the cursor at a `::` member-access alias? ---
// S114 K5c — the lexer now emits `::` as a single DoubleColon TokenKind; the
// predicate is a direct kind check. (Kept as a named predicate for parity
// with isOptionalChainAhead's call-site shape, even though it has reduced to
// a one-line lookup — the call sites read clearly with the named predicate.)
export function isDoubleColonAhead(cursor) {
    return currentKind(cursor) === TokenKind.DoubleColon;
}

// --- parseIsCheckSuffix — the right-hand side of an `is` predicate ---
// The cursor is positioned just AFTER the `is` keyword has been consumed.
// `left` is the already-parsed left-hand operand. Recognizes the five `is`
// suffixes (§42 + §18.17):
//   `is not`        — absence check        -> IsCheck(op = Not)
//   `is not not`    — double-negative      -> IsCheck(op = NotNot)
//   `is some`       — presence check       -> IsCheck(op = Some)
//   `is given`      — presence (alias)     -> IsCheck(op = Given)
//   `is .Variant`   — single-variant check -> IsCheck(op = Variant, variant)
// Returns the IsCheck node. `isTok` is the consumed `is` token (for the span
// when the suffix is malformed).
export function parseIsCheckSuffix(ctx, left, isTok) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // `is not` / `is not not`
    if (kind === TokenKind.KwNot) {
        const firstNot = advance(cursor);   // consume `not`
        if (currentKind(cursor) === TokenKind.KwNot) {
            const secondNot = advance(cursor);   // consume the second `not`
            const span = makeSpan(startOf(left), secondNot.span.end, lineOf(left), colOf(left));
            return makeIsCheck(left, IsCheckOp.NotNot, null, span);
        }
        const span = makeSpan(startOf(left), firstNot.span.end, lineOf(left), colOf(left));
        return makeIsCheck(left, IsCheckOp.Not, null, span);
    }

    // `is some`
    if (kind === TokenKind.KwSome) {
        const someTok = advance(cursor);
        const span = makeSpan(startOf(left), someTok.span.end, lineOf(left), colOf(left));
        return makeIsCheck(left, IsCheckOp.Some, null, span);
    }

    // `is given`
    if (kind === TokenKind.KwGiven) {
        const givenTok = advance(cursor);
        const span = makeSpan(startOf(left), givenTok.span.end, lineOf(left), colOf(left));
        return makeIsCheck(left, IsCheckOp.Given, null, span);
    }

    // `is .Variant` — M1 lexes `.Variant` as one BareVariant token.
    if (kind === TokenKind.BareVariant) {
        const varTok = advance(cursor);
        const variant = makeBareVariant(varTok.name, varTok.span);
        const span = makeSpan(startOf(left), varTok.span.end, lineOf(left), colOf(left));
        return makeIsCheck(left, IsCheckOp.Variant, variant, span);
    }

    // `is Type.Variant` / `is Type::Variant` — qualified variant. The
    // qualified form parses the variant as a member access on the type name.
    if (kind === TokenKind.Ident) {
        const variant = parseQualifiedVariant(ctx);
        const span = makeSpan(startOf(left), endOf(variant), lineOf(left), colOf(left));
        return makeIsCheck(left, IsCheckOp.Variant, variant, span);
    }

    // Malformed `is` — no recognized suffix.
    recordError(ctx, "E-EXPR-IS-SUFFIX",
        "expected 'not', 'some', 'given', or a '.Variant' after 'is'", isTok.span);
    const span = makeSpan(startOf(left), isTok.span.end, lineOf(left), colOf(left));
    return makeIsCheck(left, IsCheckOp.Some, null, span);
}

// --- parseQualifiedVariant — `Type.Variant` / `Type::Variant` ---
// Parses a type-qualified variant reference: a type-name Ident, then `.` or
// `::`, then the variant-name Ident. Produced as a Member node (the same
// shape `Type.Variant` member access produces). Used by `is` / `fail`.
export function parseQualifiedVariant(ctx) {
    const cursor = ctx.cursor;
    const typeTok = advance(cursor);   // consume the type-name Ident
    let node = makeIdent(typeTok.name, typeTok.span);

    if (isDoubleColonAhead(cursor)) {
        advance(cursor);   // consume `::` (S114 K5c — single DoubleColon token)
    } else if (currentKind(cursor) === TokenKind.Dot) {
        advance(cursor);   // consume `.`
    } else {
        // No separator — the type name alone is the result (a degenerate
        // qualified variant; a later stage surfaces the missing variant).
        recordError(ctx, "E-EXPR-QUALIFIED-VARIANT",
            "expected '.' or '::' after the enum-type name", typeTok.span);
        return node;
    }

    const variantTok = current(cursor);
    if (variantTok !== undefined && variantTok !== null
        && (variantTok.kind === TokenKind.Ident || isKeywordKind(variantTok.kind))) {
        advance(cursor);
        const prop = makeIdent(identTextOf(variantTok), variantTok.span);
        const span = makeSpan(startOf(node), endOf(prop), lineOf(node), colOf(node));
        return makeMember(node, prop, false, false, span);
    }

    recordError(ctx, "E-EXPR-QUALIFIED-VARIANT",
        "expected a variant name after the enum-type separator", typeTok.span);
    return node;
}

// --- parseRenderExpr — `render name(args)` snippet invocation (§14.9) ---
// The cursor is at the `render` keyword. `render` is followed by the snippet
// prop name (an identifier) and a `(args)` call. `render name` with no `(`
// records a diagnostic (the snippet-invocation form always has the call).
export function parseRenderExpr(ctx) {
    const cursor = ctx.cursor;
    const renderTok = advance(cursor);   // consume `render`

    if (currentKind(cursor) !== TokenKind.Ident) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? renderTok.span : here.span;
        recordError(ctx, "E-EXPR-RENDER-NAME", "expected a snippet name after 'render'", span);
        return makeRender("", [], renderTok.span);
    }
    const nameTok = advance(cursor);     // consume the snippet name

    let args = [];
    let endPos = nameTok.span.end;
    if (currentKind(cursor) === TokenKind.LParen) {
        const callInfo = parseCallArguments(ctx);
        args = callInfo.args;
        endPos = callInfo.endPos;
    } else {
        recordError(ctx, "E-EXPR-RENDER-CALL",
            "expected '(' to open the 'render' argument list", nameTok.span);
    }

    const span = makeSpan(renderTok.span.start, endPos, renderTok.span.line, renderTok.span.col);
    return makeRender(nameTok.name, args, span);
}

// --- parseLiftExpr — `lift expr` (§10) ---
// The cursor is at the `lift` keyword. `lift` lifts a following expression.
// The argument parses at ASSIGNMENT level (a `lift` argument is a single
// expression, not a comma sequence). `lift` is statement-shaped — it does NOT
// take a postfix chain ON the Lift node.
export function parseLiftExpr(ctx) {
    const cursor = ctx.cursor;
    const liftTok = advance(cursor);   // consume `lift`
    const prior = enterMode(ctx, ParseMode.InExpression);
    const argument = parseAssignmentExpr(ctx);
    exitMode(ctx, prior);
    const span = makeSpan(liftTok.span.start, endOf(argument), liftTok.span.line, liftTok.span.col);
    return makeLift(argument, span);
}

// --- parseFailExpr — `fail Type::Variant(args)` (§19.3) ---
// The cursor is at the `fail` keyword. Per §19.3:
//   fail-stmt ::= 'fail' enum-type ('.' | '::') variant-name ('(' arg-list ')')?
// The variant reference (`Type.Variant` / `Type::Variant`) parses via
// parseQualifiedVariant; an optional `(args)` payload becomes a Call wrapping
// it. `fail` is statement-shaped — no postfix chain ON the Fail node.
export function parseFailExpr(ctx) {
    const cursor = ctx.cursor;
    const failTok = advance(cursor);   // consume `fail`

    if (currentKind(cursor) !== TokenKind.Ident) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? failTok.span : here.span;
        recordError(ctx, "E-EXPR-FAIL-VARIANT",
            "expected an error-enum variant after 'fail'", span);
        return makeFail(null, failTok.span);
    }

    let variant = parseQualifiedVariant(ctx);
    let endPos = endOf(variant);

    // Optional payload — `fail Type::Variant(args)`.
    if (currentKind(cursor) === TokenKind.LParen) {
        const callInfo = parseCallArguments(ctx);
        const callSpan = makeSpan(startOf(variant), callInfo.endPos, lineOf(variant), colOf(variant));
        variant = makeCall(variant, callInfo.args, false, callSpan);
        endPos = callInfo.endPos;
    }

    const span = makeSpan(failTok.span.start, endPos, failTok.span.line, failTok.span.col);
    return makeFail(variant, span);
}

// --- parseMatchExpr — `match expr { arms }` JS-style value form (§18) ---
// Per SPEC §18.2:
//   match-expr ::= 'match' expression '{' match-arm+ '}'
// The cursor is at the `match` keyword. The subject parses at ASSIGNMENT level
// (a match subject is one expression, not a sequence). Each arm is parsed by
// parseMatchArm. The match is an expression — it produces a value (§18.3).
export function parseMatchExpr(ctx) {
    const cursor = ctx.cursor;
    const matchTok = advance(cursor);   // consume `match`

    // The subject expression.
    const subjectPrior = enterMode(ctx, ParseMode.InExpression);
    const subject = parseAssignmentExpr(ctx);
    exitMode(ctx, subjectPrior);

    // The `{` arm block.
    if (currentKind(cursor) !== TokenKind.LBrace) {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? matchTok.span : here.span;
        recordError(ctx, "E-EXPR-MATCH-BRACE", "expected '{' to open the match arms", span);
        return makeMatch(subject, [], makeSpan(matchTok.span.start, endOf(subject), matchTok.span.line, matchTok.span.col));
    }
    const open = advance(cursor);   // consume `{`

    const arms = [];
    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        const arm = parseMatchArm(ctx);
        if (arm === undefined || arm === null) {
            break;
        }
        arms.push(arm);
        // A `,` between arms is optional (arms are newline- or comma-
        // separated in practice); consume it if present.
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);
        }
    }

    const close = expectRBrace(ctx, open);
    const span = makeSpan(matchTok.span.start, close.end, matchTok.span.line, matchTok.span.col);
    return makeMatch(subject, arms, span);
}

// --- parseMatchArm — one arm of a match expression (§18.2) ---
//   match-arm ::= arm-pattern ('=>' | '->') arm-body
// Parses the arm pattern, the `=>` / `->` separator, and the arm body. A
// block arm body (`{ ... }`) is captured as a BlockStub (M3 parses the
// statements); a concise arm body is an assignment-level expression.
export function parseMatchArm(ctx) {
    const cursor = ctx.cursor;

    const pattern = parseMatchArmPattern(ctx);
    if (pattern === undefined || pattern === null) {
        return null;
    }

    // The separator — `=>` (canonical) or `->` (alias). M1 lexes `->` as a
    // Minus token followed by a GreaterThan token (no single `->` token);
    // re-compose it here when the two are source-adjacent.
    let separator = "=>";
    if (currentKind(cursor) === TokenKind.Arrow) {
        advance(cursor);   // consume `=>`
    } else if (isArrowAliasAhead(cursor)) {
        advance(cursor);   // consume `-`
        advance(cursor);   // consume `>`
        separator = "->";
    } else {
        const here = current(cursor);
        const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
        recordError(ctx, "E-EXPR-MATCH-ARROW", "expected '=>' or '->' in a match arm", span);
    }

    // The arm body — a `{ ... }` block (BlockStub, M3 seam) or a concise
    // assignment-level expression.
    let body;
    if (currentKind(cursor) === TokenKind.LBrace) {
        body = parseBlockStub(ctx);
    } else {
        const bodyPrior = enterMode(ctx, ParseMode.InExpression);
        body = parseAssignmentExpr(ctx);
        exitMode(ctx, bodyPrior);
    }

    return makeMatchArm(pattern, body, separator);
}

// --- isArrowAliasAhead — is the cursor at a `->` match-arm separator? ---
// M1 lexes `->` as a Minus then a GreaterThan token. The `->` alias is the
// two source-adjacent.
export function isArrowAliasAhead(cursor) {
    if (currentKind(cursor) !== TokenKind.Minus) {
        return false;
    }
    if (peekKind(cursor, 1) !== TokenKind.GreaterThan) {
        return false;
    }
    const m = current(cursor);
    const g = peek(cursor, 1);
    if (m === undefined || m === null || g === undefined || g === null) {
        return false;
    }
    if (m.span === undefined || g.span === undefined) {
        return false;
    }
    return m.span.end === g.span.start;
}

// --- parseMatchArmPattern — the pattern of one match arm (§18.2) ---
//   arm-pattern ::= variant-pattern | wildcard-arm | is-pattern
//   variant-pattern ::= ('.' | '::') VariantName ('(' binding-list ')')?
//                     | TypeName ('.' | '::') VariantName ('(' binding-list ')')?
//   wildcard-arm    ::= 'else' | '_'
//   is-pattern      ::= 'is' '.' VariantName
export function parseMatchArmPattern(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // Wildcard — `else` / `_`. `_` lexes as an Ident named "_".
    if (kind === TokenKind.KwElse) {
        const tok = advance(cursor);
        return makeWildcardPattern("else", tok.span);
    }
    if (kind === TokenKind.Ident) {
        const here = current(cursor);
        if (here !== undefined && here !== null && here.name === "_") {
            advance(cursor);
            return makeWildcardPattern("_", here.span);
        }
    }

    // is-pattern — `is .Variant` (§18.17 is-pattern in arm position).
    if (kind === TokenKind.KwIs) {
        const isTok = advance(cursor);   // consume `is`
        if (currentKind(cursor) === TokenKind.BareVariant) {
            const varTok = advance(cursor);
            const span = makeSpan(isTok.span.start, varTok.span.end, isTok.span.line, isTok.span.col);
            return makeIsPattern(varTok.name, span);
        }
        recordError(ctx, "E-EXPR-MATCH-IS-PATTERN",
            "expected a '.Variant' after 'is' in a match arm pattern", isTok.span);
        return makeIsPattern("", isTok.span);
    }

    // Bare variant-pattern — `.Variant ( bindings )?`.
    if (kind === TokenKind.BareVariant) {
        const varTok = advance(cursor);
        const bindings = parseMatchBindingsOpt(ctx);
        const endPos = (bindings === null) ? varTok.span.end : cursor.tokens[cursor.idx - 1].span.end;
        const span = makeSpan(varTok.span.start, endPos, varTok.span.line, varTok.span.col);
        return makeVariantPattern(null, varTok.name, bindings, span);
    }

    // Leading `::Variant` — the bare-variant `::` alias in arm position.
    if (kind === TokenKind.DoubleColon && isQualifiedVariantColonAhead(cursor)) {
        const dc = advance(cursor);   // consume `::` (S114 K5c — single DoubleColon token)
        const nameTok = advance(cursor);   // consume the variant Ident
        const bindings = parseMatchBindingsOpt(ctx);
        const endPos = (bindings === null) ? nameTok.span.end : cursor.tokens[cursor.idx - 1].span.end;
        const span = makeSpan(dc.span.start, endPos, dc.span.line, dc.span.col);
        return makeVariantPattern(null, nameTok.name, bindings, span);
    }

    // Qualified variant-pattern — `TypeName.Variant ( bindings )?` /
    // `TypeName::Variant ( bindings )?`.
    if (kind === TokenKind.Ident) {
        const typeTok = advance(cursor);   // consume the type-name Ident
        if (isDoubleColonAhead(cursor)) {
            advance(cursor);   // consume `::` (S114 K5c — single DoubleColon token)
        } else if (currentKind(cursor) === TokenKind.Dot) {
            advance(cursor);   // consume `.`
        } else {
            recordError(ctx, "E-EXPR-MATCH-PATTERN",
                "expected '.' or '::' after the enum-type name in a match arm", typeTok.span);
            return makeVariantPattern(typeTok.name, "", null, typeTok.span);
        }
        if (currentKind(cursor) !== TokenKind.Ident) {
            recordError(ctx, "E-EXPR-MATCH-PATTERN",
                "expected a variant name in a match arm pattern", typeTok.span);
            return makeVariantPattern(typeTok.name, "", null, typeTok.span);
        }
        const nameTok = advance(cursor);   // consume the variant Ident
        const bindings = parseMatchBindingsOpt(ctx);
        const endPos = (bindings === null) ? nameTok.span.end : cursor.tokens[cursor.idx - 1].span.end;
        const span = makeSpan(typeTok.span.start, endPos, typeTok.span.line, typeTok.span.col);
        return makeVariantPattern(typeTok.name, nameTok.name, bindings, span);
    }

    const here = current(cursor);
    const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
    recordError(ctx, "E-EXPR-MATCH-PATTERN", "expected a match arm pattern", span);
    return null;
}

// --- parseMatchBindingsOpt — the optional `( binding-list )` of a
// variant-pattern (§18.7) ---
// Returns the binding array, or `null` when the variant carries no `(...)`.
// Each binding is positional (`w`) or named (`width: w`). Mixed forms are a
// later-stage error (E-TYPE-021); the parser records both shapes faithfully.
export function parseMatchBindingsOpt(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) !== TokenKind.LParen) {
        return null;
    }
    advance(cursor);   // consume `(`
    const bindings = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RParen) {
        if (currentKind(cursor) !== TokenKind.Ident) {
            const here = current(cursor);
            const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
            recordError(ctx, "E-EXPR-MATCH-BINDING", "expected a binding name", span);
            break;
        }
        const firstTok = advance(cursor);   // consume the first Ident

        // Named form — `fieldName : local`.
        if (currentKind(cursor) === TokenKind.Colon) {
            advance(cursor);   // consume `:`
            if (currentKind(cursor) !== TokenKind.Ident) {
                recordError(ctx, "E-EXPR-MATCH-BINDING",
                    "expected a local name after the field name", firstTok.span);
                break;
            }
            const localTok = advance(cursor);
            bindings.push(makeMatchBinding(firstTok.name, localTok.name));
        } else {
            // Positional form — the Ident is the bound local.
            bindings.push(makeMatchBinding(null, firstTok.name));
        }

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator `,`
        } else {
            break;
        }
    }

    // Consume the closing `)`.
    if (currentKind(cursor) === TokenKind.RParen) {
        advance(cursor);
    } else {
        recordError(ctx, "E-EXPR-MATCH-BINDING",
            "expected ')' to close a match arm payload binding list", makeSpan(0, 0, 1, 1));
    }
    return bindings;
}

// --- parseParenExpression — ( expr ) ---
// The paren body parses at the FULL expression level (parseExpression — a
// sequence is legal inside parens: `(a, b)`). M4.2 — the `in` operator is
// LEGAL inside the parens even when the outer context is no-In (the classic
// ECMA-262 carve-out: `for (let x = (a in b); ...)`); the noIn slot is
// saved+cleared+restored around the inner parse.
export function parseParenExpression(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume (
    const prior = enterMode(ctx, ParseMode.InExpression);
    const inPrior = withInAllowedSubExpr(ctx);
    const inner = parseExpression(ctx);
    restoreNoIn(ctx, inPrior);
    exitMode(ctx, prior);
    const endSpan = expectRParen(ctx, open);
    const span = makeSpan(open.span.start, endSpan.end, open.span.line, open.span.col);
    return makeParen(inner, span);
}

// --- parseArrayLiteral — [ elem, elem, ... ] ---
// Each element parses at ASSIGNMENT level (parseAssignmentExpr) — a comma
// SEPARATES elements; it must not be swallowed as a sequence.
export function parseArrayLiteral(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume [
    const prior = enterMode(ctx, ParseMode.InArrayLiteral);
    // M4.2 — the array body is a no-In carve-out: `[a in b]` is legal even
    // when the outer context is no-In. Save+clear+restore noIn for the body.
    const inPrior = withInAllowedSubExpr(ctx);
    const elements = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBracket) {
        // Hole — comma in element position
        if (currentKind(cursor) === TokenKind.Comma) {
            elements.push(makeArrayHole());
            advance(cursor);   // consume the ,
            continue;
        }

        // Spread element ...expr
        if (currentKind(cursor) === TokenKind.Ellipsis) {
            advance(cursor);   // consume ...
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const spreadExpr = parseAssignmentExpr(ctx);
            exitMode(ctx, innerPrior);
            elements.push(makeArraySpread(spreadExpr));
        } else {
            // Plain element expression
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const itemExpr = parseAssignmentExpr(ctx);
            exitMode(ctx, innerPrior);
            elements.push(makeArrayItem(itemExpr));
        }

        // After an element: either a , separator or the closing ]
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
        } else {
            break;
        }
    }

    restoreNoIn(ctx, inPrior);
    exitMode(ctx, prior);
    const close = expectRBracket(ctx, open);
    const span = makeSpan(open.span.start, close.end, open.span.line, open.span.col);
    return makeArray(elements, span);
}

// --- parseObjectLiteral — { prop, prop, ... } ---
export function parseObjectLiteral(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume {
    const prior = enterMode(ctx, ParseMode.InObjectLiteral);
    // M4.2 — the object body is a no-In carve-out: `{k: a in b}` is legal
    // even when the outer context is no-In. Save+clear+restore noIn.
    const inPrior = withInAllowedSubExpr(ctx);
    const properties = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        // Spread property { ...rest }
        if (currentKind(cursor) === TokenKind.Ellipsis) {
            advance(cursor);   // consume ...
            const innerPrior = enterMode(ctx, ParseMode.InExpression);
            const spreadExpr = parseAssignmentExpr(ctx);
            exitMode(ctx, innerPrior);
            properties.push(makeObjectSpread(spreadExpr));
        } else {
            const prop = parseObjectProperty(ctx);
            if (prop === undefined || prop === null) {
                break;
            }
            properties.push(prop);
        }

        // After a property: either a , separator or the closing }
        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
        } else {
            break;
        }
    }

    restoreNoIn(ctx, inPrior);
    exitMode(ctx, prior);
    const close = expectRBrace(ctx, open);
    const span = makeSpan(open.span.start, close.end, open.span.line, open.span.col);
    return makeObject(properties, span);
}

// --- parseObjectProperty — one non-spread object-literal property ---
// Handles every non-spread property form: `key: value`, shorthand `{ x }`,
// methods `key() { ... }`, async methods `async key() { ... }`, and
// getters / setters `get key() { ... }` / `set key(v) { ... }`. A property
// VALUE parses at ASSIGNMENT level — a comma separates properties. M2.3
// brings the method / getter / setter forms (the M2.2 stub recorded
// E-EXPR-OBJECT-METHOD-UNSUPPORTED here).
export function parseObjectProperty(ctx) {
    const cursor = ctx.cursor;

    // --- `async` method prefix — `{ async foo() { ... } }` / `{ async
    // *gen() {} }`. M4.3 — RETRACTED. scrml has no `async` at the language
    // level. When the `async` method prefix is seen we fire
    // E-ASYNC-NOT-IN-SCRML at the `async` token and recover by parsing the
    // method as a plain (or generator) method — keeping the rest of the
    // object literal parseable. Otherwise `async` is itself a property key
    // (`{ async: 1 }`, falls through to the key parse). ---
    if (currentKind(cursor) === TokenKind.KwAsync
        && (isMethodPrefixAhead(cursor) || isGeneratorMethodPrefixAhead(cursor))) {
        const asyncTok = advance(cursor);   // consume `async`
        recordError(ctx, "E-ASYNC-NOT-IN-SCRML",
            "scrml has no `async` keyword. The canonical async surface is the compiler body-split (server functions, reactive state) — no source-level async/await is needed.",
            asyncTok.span);
        let isGen = false;
        if (currentKind(cursor) === TokenKind.Star) {
            advance(cursor);   // consume `*` — was an async-generator method
            isGen = true;
        }
        const keyInfo = parseObjectPropertyKey(ctx);
        const fn = parseMethodTail(ctx, false, isGen);
        return makeObjectMethod(keyInfo.key, fn, keyInfo.computed, "init");
    }

    // --- `*` generator method prefix — `{ *gen() {} }` (M4.1). `*` lexes as
    // a Star token; it is a generator-method prefix when a method-shaped key
    // follows. (A bare `*` cannot otherwise begin an object-literal property,
    // so no disambiguation against a `*`-named property is needed.) ---
    if (currentKind(cursor) === TokenKind.Star && isMethodPrefixAhead(cursor)) {
        advance(cursor);   // consume `*`
        const keyInfo = parseObjectPropertyKey(ctx);
        const fn = parseMethodTail(ctx, false, true);
        return makeObjectMethod(keyInfo.key, fn, keyInfo.computed, "init");
    }

    // --- getter / setter — `{ get x() {} }` / `{ set x(v) {} }`. `get` /
    // `set` lex as Ident; they are accessor prefixes only when a method-
    // shaped key follows. `{ get: 1 }` is a plain property named `get`. ---
    if (currentKind(cursor) === TokenKind.Ident) {
        const here = current(cursor);
        const word = (here !== undefined && here !== null) ? here.name : "";
        if ((word === "get" || word === "set") && isMethodPrefixAhead(cursor)) {
            advance(cursor);   // consume `get` / `set`
            const keyInfo = parseObjectPropertyKey(ctx);
            const fn = parseMethodTail(ctx, false, false);
            return makeObjectMethod(keyInfo.key, fn, keyInfo.computed, word);
        }
    }

    // --- Parse the property key (computed `[expr]` or simple). ---
    const keyInfo = parseObjectPropertyKey(ctx);
    if (keyInfo === null) {
        return null;
    }
    const keyNode = keyInfo.key;
    const computed = keyInfo.computed;
    const afterKind = currentKind(cursor);

    // `key( ... ) { ... }` — a method.
    if (afterKind === TokenKind.LParen) {
        const fn = parseMethodTail(ctx, false, false);
        return makeObjectMethod(keyNode, fn, computed, "init");
    }

    // `key: value` — a key-value property.
    if (afterKind === TokenKind.Colon) {
        advance(cursor);   // consume :
        const valuePrior = enterMode(ctx, ParseMode.InExpression);
        const valueExpr = parseAssignmentExpr(ctx);
        exitMode(ctx, valuePrior);
        return makeObjectKeyValue(keyNode, valueExpr, computed);
    }

    // `{ x }` / `{ x, ... }` — shorthand, legal only for an identifier key.
    if (afterKind === TokenKind.Comma || afterKind === TokenKind.RBrace) {
        if (computed || keyNode.kind !== "Ident") {
            recordError(ctx, "E-EXPR-OBJECT-SHORTHAND", "shorthand object property requires an identifier key", keyNode.span);
            return null;
        }
        return makeObjectShorthand(keyNode.name);
    }

    recordError(ctx, "E-EXPR-OBJECT-PROP", "malformed object-literal property", keyNode.span);
    return null;
}

// --- parseObjectPropertyKey — a `[expr]` computed key or a simple key ---
// Returns { key, computed } or null. A simple key is an identifier, string,
// or number literal; a computed key is `[ expr ]`.
export function parseObjectPropertyKey(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    if (kind === TokenKind.LBracket) {
        const open = advance(cursor);   // consume [
        const keyPrior = enterMode(ctx, ParseMode.InExpression);
        const keyExpr = parseAssignmentExpr(ctx);
        exitMode(ctx, keyPrior);
        expectRBracket(ctx, open);
        return { key: keyExpr, computed: true };
    }

    if (kind === TokenKind.Ident) {
        const tok = advance(cursor);
        return { key: makeIdent(tok.name, tok.span), computed: false };
    }
    if (kind === TokenKind.StringLit) {
        const tok = advance(cursor);
        return { key: makeStringLit(tok.cooked, tok.text, tok.span), computed: false };
    }
    if (kind === TokenKind.NumberLit) {
        const tok = advance(cursor);
        return { key: makeNumberLit(tok.value, tok.text, tok.span), computed: false };
    }
    // A keyword used as a property key — `{ default: 1 }`, `{ if() {} }`.
    if (isKeywordKind(kind)) {
        const tok = advance(cursor);
        return { key: makeIdent(identTextOf(tok), tok.span), computed: false };
    }

    const here = current(cursor);
    const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
    recordError(ctx, "E-EXPR-OBJECT-KEY", "expected an object-literal property key", span);
    return null;
}

// --- isMethodPrefixAhead — does a method (`key(...)`) follow the cursor? ---
// The cursor is at a candidate prefix word (`async` / `get` / `set`). A
// method follows iff the next token starts a property key (Ident / string /
// number / keyword / `[`) AND the token AFTER that key opens a parameter
// list `(` or is a computed-key `[`. This distinguishes `{ get x() {} }`
// (accessor) from `{ get: 1 }` (a property literally named `get`).
export function isMethodPrefixAhead(cursor) {
    const k1 = peekKind(cursor, 1);
    // `prefix [computed]() {}` — the key is computed.
    if (k1 === TokenKind.LBracket) {
        return true;
    }
    // `prefix name() {}` — the key is a simple name; `(` must follow it.
    const keyIsSimple = (k1 === TokenKind.Ident || k1 === TokenKind.StringLit
        || k1 === TokenKind.NumberLit || isKeywordKind(k1));
    if (keyIsSimple === false) {
        return false;
    }
    return peekKind(cursor, 2) === TokenKind.LParen;
}

// --- isGeneratorMethodPrefixAhead — does an `async * key(...)` async-
// generator method follow the cursor? (M4.1) The cursor is at the `async`
// keyword. The shape is `async`, `*`, a key-start, then `(` / `[`. Used by
// parseObjectProperty to recognize the `async *` async-generator object
// method (the `*` alone is handled by the dedicated `*`-prefix branch). ---
export function isGeneratorMethodPrefixAhead(cursor) {
    if (peekKind(cursor, 1) !== TokenKind.Star) {
        return false;
    }
    const k2 = peekKind(cursor, 2);
    if (k2 === TokenKind.LBracket) {
        return true;
    }
    const keyIsSimple = (k2 === TokenKind.Ident || k2 === TokenKind.StringLit
        || k2 === TokenKind.NumberLit || isKeywordKind(k2));
    if (keyIsSimple === false) {
        return false;
    }
    return peekKind(cursor, 3) === TokenKind.LParen;
}

// --- parseMethodTail — `( params ) { ... }` for an object method / accessor ---
// Returns a Function node (no `function` keyword in the source, but the same
// node shape: params + block-stub body). The block body is a BlockStub (M3
// parses the statements). `name` is `not` — an object method's name is its
// property key, carried by the enclosing ObjectProperty.
//
// M4.1 — a method establishes its own async/generator scope (`isAsync` from
// an `async` method prefix, `isGenerator` from a `*` method prefix). The
// scope is set for the body parse; the Function node carries the flags so
// M3's reenterBlockStubs re-derives the scope for the BlockStub body. A
// getter / setter is never async / generator (the caller passes false/false).
export function parseMethodTail(ctx, isAsync, isGenerator) {
    const cursor = ctx.cursor;
    const params = parseParamList(ctx);
    const scopePrior = enterFunctionScope(ctx, isAsync, isGenerator);
    const body = parseArrowOrFunctionBody(ctx, false);
    exitFunctionScope(ctx, scopePrior);
    const startPos = (params.length > 0) ? startOf(params[0]) : startOf(body);
    const startLine = (params.length > 0) ? lineOf(params[0]) : lineOf(body);
    const startCol = (params.length > 0) ? colOf(params[0]) : colOf(body);
    const span = makeSpan(startPos, endOf(body), startLine, startCol);
    return makeFunction(null, params, body, isAsync, isGenerator === true, span);
}

// --- parseTemplateLiteral — reassemble M1's template token run ---
// Each interpolation body parses at the FULL expression level (parseExpression
// — `` `${a, b}` `` interpolates a sequence, per ECMA-262).
export function parseTemplateLiteral(ctx) {
    const cursor = ctx.cursor;
    const quasis = [];
    const exprs = [];

    const firstChunk = advance(cursor);   // the leading TemplateChunk
    // M1 (lex-in-template.js) absorbs the OPENING backtick before it emits
    // the first TemplateChunk — so the chunk's span starts one char AFTER
    // the backtick. The TemplateLit node's span should cover the whole
    // `...` including both backticks (source-faithful, Acorn-equivalent),
    // so the start backs up one char to the opener. The final chunk's
    // `raw` already includes the closing backtick, so `endPos` covers it.
    const startSpan = firstChunk.span;
    const templateStart = startSpan.start > 0 ? startSpan.start - 1 : 0;
    // The opening backtick sits on the same line as the first chunk, one
    // column earlier.
    const templateCol = startSpan.col > 1 ? startSpan.col - 1 : startSpan.col;
    quasis.push(makeTemplateQuasi(stripTrailingBacktick(firstChunk.raw), firstChunk.cooked));
    let endPos = firstChunk.span.end;

    while (currentKind(cursor) === TokenKind.TemplateInterpStart) {
        advance(cursor);   // consume ${  (TemplateInterpStart)

        const interpPrior = enterMode(ctx, ParseMode.InExpression);
        // M4.2 — the `${ ... }` body is a no-In carve-out: `` `${a in b}` ``
        // is legal even when the outer context is no-In.
        const inPrior = withInAllowedSubExpr(ctx);
        const interpExpr = parseExpression(ctx);
        restoreNoIn(ctx, inPrior);
        exitMode(ctx, interpPrior);
        exprs.push(interpExpr);

        // Consume the closing } (TemplateInterpEnd)
        if (currentKind(cursor) === TokenKind.TemplateInterpEnd) {
            advance(cursor);
        } else {
            const here = current(cursor);
            const span = (here === undefined || here === null) ? startSpan : here.span;
            recordError(ctx, "E-EXPR-TEMPLATE-INTERP", "unterminated template interpolation", span);
            break;
        }

        // The chunk after the interpolation
        if (currentKind(cursor) === TokenKind.TemplateChunk) {
            const chunk = advance(cursor);
            quasis.push(makeTemplateQuasi(stripTrailingBacktick(chunk.raw), chunk.cooked));
            endPos = chunk.span.end;
        } else {
            const here = current(cursor);
            const span = (here === undefined || here === null) ? startSpan : here.span;
            recordError(ctx, "E-EXPR-TEMPLATE-CHUNK", "expected a template chunk after interpolation", span);
            break;
        }
    }

    const span = makeSpan(templateStart, endPos, startSpan.line, templateCol);
    return makeTemplateLit(quasis, exprs, span);
}

// --- stripTrailingBacktick — quasi raw should not include the closing ` ---
export function stripTrailingBacktick(raw) {
    if (raw === undefined || raw === null) {
        return "";
    }
    if (raw.length > 0 && raw.charAt(raw.length - 1) === "`") {
        return raw.substring(0, raw.length - 1);
    }
    return raw;
}

// --- expect* helpers — consume a required closing token ---
export function expectRParen(ctx, opener) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.RParen) {
        const tok = advance(cursor);
        return tok.span;
    }
    recordError(ctx, "E-EXPR-UNCLOSED-PAREN", "expected ')' to close a parenthesized expression", opener.span);
    return makeSpan(opener.span.end, opener.span.end, opener.span.line, opener.span.col);
}

export function expectRBracket(ctx, opener) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.RBracket) {
        const tok = advance(cursor);
        return tok.span;
    }
    const oSpan = (opener === undefined || opener === null) ? makeSpan(0, 0, 1, 1) : opener.span;
    recordError(ctx, "E-EXPR-UNCLOSED-BRACKET", "expected ']' to close an array literal", oSpan);
    return makeSpan(oSpan.end, oSpan.end, oSpan.line, oSpan.col);
}

export function expectRBrace(ctx, opener) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.RBrace) {
        const tok = advance(cursor);
        return tok.span;
    }
    recordError(ctx, "E-EXPR-UNCLOSED-BRACE", "expected '}' to close an object literal", opener.span);
    return makeSpan(opener.span.end, opener.span.end, opener.span.line, opener.span.col);
}

export function expectColon(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) === TokenKind.Colon) {
        advance(cursor);
        return true;
    }
    const here = current(cursor);
    const span = (here === undefined || here === null) ? makeSpan(0, 0, 1, 1) : here.span;
    recordError(ctx, "E-EXPR-EXPECTED-COLON", "expected ':' in object-literal property", span);
    return false;
}

// =============================================================================
// Binding patterns — declaration-target destructuring (S98 DD §D5; M3.1).
//
// A declaration TARGET is an identifier or a destructuring pattern; patterns
// nest. These produce ast-stmt's binding nodes (BindingIdent / ObjectPattern
// / ArrayPattern / AssignmentPattern / RestElement) — NOT ast-expr's
// Object/Array literal nodes (a binding pattern is the left-of-`=` shape).
//
// HOSTED HERE (NOT in parse-stmt) AS OF M4.2 — the K6 unification: M2.3's
// parseParamTarget needs parseBinding to emit a real binding node for a
// `{...}` / `[...]` parameter pattern; parse-stmt already imports from
// parse-expr, so the binding parser lives HERE and parse-stmt re-imports.
// The functions are otherwise unchanged from their M3.1 origin in parse-stmt.
// =============================================================================

// --- parseBinding — a binding TARGET (identifier or destructuring pattern) ---
export function parseBinding(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    if (kind === TokenKind.LBrace) {
        return parseObjectPattern(ctx);
    }
    if (kind === TokenKind.LBracket) {
        return parseArrayPattern(ctx);
    }
    return parseBindingIdent(ctx);
}

// --- parseBindingIdent — a plain identifier binding ---
// The leaf of every binding pattern. A non-identifier here is a malformed
// target; a diagnostic is recorded and an empty-name BindingIdent returned so
// the caller still gets a node (the parser's no-throw discipline).
export function parseBindingIdent(ctx) {
    const cursor = ctx.cursor;
    if (currentKind(cursor) !== TokenKind.Ident) {
        recordError(ctx, "E-STMT-BINDING-NAME",
            "expected an identifier in a binding position", spanHere(ctx));
        return makeBindingIdent("", spanHere(ctx));
    }
    const tok = advance(cursor);
    return makeBindingIdent(tok.name, tok.span);
}

// --- parseBindingTargetWithDefault — a binding target, optionally defaulted ---
// `target = default` -> an AssignmentPattern; a bare target -> the target.
// Used inside object/array patterns where each element may carry a default.
function parseBindingTargetWithDefault(ctx) {
    const cursor = ctx.cursor;
    const target = parseBinding(ctx);

    if (currentKind(cursor) === TokenKind.Assign) {
        advance(cursor);   // consume =
        const prior = enterMode(ctx, ParseMode.InExpression);
        const dflt = parseAssignmentExpr(ctx);
        exitMode(ctx, prior);
        const span = makeSpan(startOf(target), endOf(dflt), lineOf(target), colOf(target));
        return makeBindingAssignmentPattern(target, dflt, span);
    }
    return target;
}

// --- parseObjectPattern — `{ a, b: c, d = 1, ...rest }` ---
export function parseObjectPattern(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume {
    const properties = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBrace) {
        // `...rest` — an object-pattern rest property (must be last; M3.1
        // parses it wherever it appears and lets a later stage flag a
        // non-final rest).
        if (currentKind(cursor) === TokenKind.Ellipsis) {
            advance(cursor);   // consume ...
            const restTarget = parseBinding(ctx);
            properties.push(makeBindingPropertyRest(restTarget));
        } else {
            properties.push(parseObjectPatternProperty(ctx));
        }

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    let endSpan = open.span;
    if (currentKind(cursor) === TokenKind.RBrace) {
        endSpan = advance(cursor).span;   // consume }
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-PATTERN",
            "expected '}' to close an object-destructuring pattern", open.span);
    }

    const span = makeSpan(open.span.start, endSpan.end, open.span.line, open.span.col);
    return makeObjectPattern(properties, span);
}

// --- parseObjectPatternProperty — one `{ ... }` pattern property ---
// Forms: `{ name }` / `{ name = default }` shorthand;
//        `{ key: target }` / `{ "k": target }` / `{ [expr]: target }` keyed.
export function parseObjectPatternProperty(ctx) {
    const cursor = ctx.cursor;
    const kind = currentKind(cursor);

    // Computed key — `[ expr ]: target`. A computed key is always keyed
    // (never shorthand).
    if (kind === TokenKind.LBracket) {
        advance(cursor);   // consume [
        const prior = enterMode(ctx, ParseMode.InExpression);
        const keyExpr = parseAssignmentExpr(ctx);
        exitMode(ctx, prior);
        if (currentKind(cursor) === TokenKind.RBracket) {
            advance(cursor);   // consume ]
        } else {
            recordError(ctx, "E-STMT-UNCLOSED-COMPUTED-KEY",
                "expected ']' to close a computed pattern key", spanHere(ctx));
        }
        expectBindingColon(ctx);
        const valueTarget = parseBindingTargetWithDefault(ctx);
        return makeBindingPropertyKeyValue(keyExpr, valueTarget, true);
    }

    // String / number literal key — always keyed.
    if (kind === TokenKind.StringLit || kind === TokenKind.NumberLit) {
        const keyTok = advance(cursor);
        const keyExpr = bindingLiteralKeyExpr(keyTok);
        expectBindingColon(ctx);
        const valueTarget = parseBindingTargetWithDefault(ctx);
        return makeBindingPropertyKeyValue(keyExpr, valueTarget, false);
    }

    // Identifier key. `name :` -> keyed; otherwise shorthand (`name` /
    // `name = default`).
    if (kind === TokenKind.Ident) {
        const nameTok = advance(cursor);
        if (currentKind(cursor) === TokenKind.Colon) {
            advance(cursor);   // consume :
            const valueTarget = parseBindingTargetWithDefault(ctx);
            const keyExpr = bindingIdentKeyExpr(nameTok);
            return makeBindingPropertyKeyValue(keyExpr, valueTarget, false);
        }
        // Shorthand — `{ name }` or `{ name = default }`.
        let valueTarget = makeBindingIdent(nameTok.name, nameTok.span);
        if (currentKind(cursor) === TokenKind.Assign) {
            advance(cursor);   // consume =
            const prior = enterMode(ctx, ParseMode.InExpression);
            const dflt = parseAssignmentExpr(ctx);
            exitMode(ctx, prior);
            const apSpan = makeSpan(nameTok.span.start, endOf(dflt), nameTok.span.line, nameTok.span.col);
            valueTarget = makeBindingAssignmentPattern(valueTarget, dflt, apSpan);
        }
        return makeBindingPropertyShorthand(nameTok.name, valueTarget);
    }

    // Malformed — record a diagnostic and emit a placeholder shorthand so the
    // caller's property list still gets an entry.
    recordError(ctx, "E-STMT-PATTERN-PROPERTY",
        "expected a property name in an object-destructuring pattern", spanHere(ctx));
    const placeholder = makeBindingIdent("", spanHere(ctx));
    return makeBindingPropertyShorthand("", placeholder);
}

// expectBindingColon — consume a `:` separator inside a binding pattern;
// record a diagnostic if absent. (Renamed from parse-stmt's local
// `expectColon` to avoid a name collision with parse-expr's `expectColon`,
// which serves the object-LITERAL parser and fires E-EXPR-EXPECTED-COLON.
// Binding-pattern colon misses are a distinct diagnostic: E-STMT-PATTERN-COLON.)
function expectBindingColon(ctx) {
    if (currentKind(ctx.cursor) === TokenKind.Colon) {
        advance(ctx.cursor);
        return;
    }
    recordError(ctx, "E-STMT-PATTERN-COLON",
        "expected ':' after a pattern property key", spanHere(ctx));
}

// bindingIdentKeyExpr — a property-key node for an identifier-key token. A
// pattern key is modelled as a minimal ast-expr-shaped Ident node (the
// binding catalog reuses the key Expr surface).
function bindingIdentKeyExpr(tok) {
    return { kind: "Ident", name: tok.name, span: tok.span };
}

// bindingLiteralKeyExpr — a property-key node for a string / number key.
function bindingLiteralKeyExpr(tok) {
    if (tok.kind === TokenKind.StringLit) {
        return { kind: "StringLit", value: tok.cooked, raw: tok.text, span: tok.span };
    }
    return { kind: "NumberLit", value: tok.value, raw: tok.text, span: tok.span };
}

// --- parseArrayPattern — `[ a, , b, c = 1, ...rest ]` ---
export function parseArrayPattern(ctx) {
    const cursor = ctx.cursor;
    const open = advance(cursor);   // consume [
    const elements = [];

    while (atEnd(cursor) === false && currentKind(cursor) !== TokenKind.RBracket) {
        // Elision — a `,` with no element before it is a hole.
        if (currentKind(cursor) === TokenKind.Comma) {
            elements.push(makeBindingElementHole());
            advance(cursor);   // consume the separator ,
            continue;
        }

        // `...rest` — an array-pattern rest element (must be last; M3.1
        // parses it wherever it appears).
        if (currentKind(cursor) === TokenKind.Ellipsis) {
            advance(cursor);   // consume ...
            const restTarget = parseBinding(ctx);
            elements.push(makeBindingElementRest(restTarget));
            // A rest element is the last element; a trailing `,` after a
            // rest is a syntax error in JS — stop here regardless.
            break;
        }

        // A positional binding element (identifier / nested pattern /
        // defaulted).
        elements.push(makeBindingElementItem(parseBindingTargetWithDefault(ctx)));

        if (currentKind(cursor) === TokenKind.Comma) {
            advance(cursor);   // consume the separator ,
            continue;
        }
        break;
    }

    let endSpan = open.span;
    if (currentKind(cursor) === TokenKind.RBracket) {
        endSpan = advance(cursor).span;   // consume ]
    } else {
        recordError(ctx, "E-STMT-UNCLOSED-PATTERN",
            "expected ']' to close an array-destructuring pattern", open.span);
    }

    const span = makeSpan(open.span.start, endSpan.end, open.span.line, open.span.col);
    return makeArrayPattern(elements, span);
}

// --- parseExpr — the M2.1-M2.3 entry point ---
// Takes M1's Token[] and returns { ast, errors }. M2.3 parses one expression
// at the head of the stream — now including call / member / optional-chain /
// `new` / tagged-template forms and arrow / function-expression HEADS. The
// conformance harness (parser-conformance-expr.test.js) calls this.
export function parseExpr(tokens) {
    const ctx = makeParseExprContext(tokens);
    const ast = parseExpression(ctx);
    return { ast, errors: ctx.errors };
}
