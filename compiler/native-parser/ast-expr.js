// ast-expr.js — JS-host shadow of ast-expr.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors ast-expr.scrml's header — see that file.

export const ExprKind = Object.freeze({
    // Primary — literals
    Ident:       "Ident",
    NumberLit:   "NumberLit",
    StringLit:   "StringLit",
    BoolLit:     "BoolLit",
    RegexLit:    "RegexLit",
    TemplateLit: "TemplateLit",

    // Primary — scrml extensions surfaced by M1
    AtCell:      "AtCell",
    BareVariant: "BareVariant",

    // Primary — keyword atoms (a member/call base; added at M2.3 because
    // call/member parsing structurally needs a parseable receiver)
    This:  "This",
    Super: "Super",

    // Primary — composite
    Array:  "Array",
    Object: "Object",
    Paren:  "Paren",

    // Operators (M2.2)
    Unary:       "Unary",
    Update:      "Update",
    Binary:      "Binary",
    Logical:     "Logical",
    Assignment:  "Assignment",
    Conditional: "Conditional",
    Sequence:    "Sequence",

    // Call / member / arrow / function (M2.3)
    Call:           "Call",
    New:            "New",
    Member:         "Member",
    TaggedTemplate: "TaggedTemplate",
    Arrow:          "Arrow",
    Function:       "Function",

    // Pattern / body-stub support for arrow + function HEADS (M2.3)
    RestElement:       "RestElement",
    AssignmentPattern: "AssignmentPattern",
    BlockStub:         "BlockStub",

    // scrml-extension expression forms (M2.4 — D5 MUST ADD)
    NotValue:      "NotValue",       // `not` — the absence value atom (§42)
    Tilde:         "Tilde",          // `~`  — pipeline accumulator atom (§32)
    Sql:           "Sql",            // `?{ ... }` — SQL block (§8)
    InputStateRef: "InputStateRef",  // `<#id>` — input-state ref (§36)
    IsCheck:       "IsCheck",        // `expr is …` predicate (§42 / §18.17)
    Match:         "Match",          // `match expr { arms }` (§18)
    Render:        "Render",         // `render name(args)` (§14.9)
    Lift:          "Lift",           // `lift expr` (§10)
    Fail:          "Fail",           // `fail Type::Variant(args)` (§19)

    // scrml-extension postfix-`?` / `!{}` forms — M5-swap Wave 2 (B1 / B2).
    // `Propagate` is the `expr?` postfix error-propagation operator (§19) —
    // the §32 pipeline accumulator `~` is NOT this; `?` postfix is the
    // fail-propagation operator. `GuardedExpr` is the `expr !{ arms }` inline
    // guarded-expression handler (§19). Both are statement-shaped at the
    // language level (`propagate-expr` / `guarded-expr` are live
    // `LogicStatement` kinds); they are modelled as Expr nodes here (the same
    // way `Lift` / `Fail` are) and the STATEMENT bridge (translate-stmt.js)
    // un-wraps an `ExprStmt{ Propagate | GuardedExpr }` into the live
    // LogicStatement.
    Propagate:     "Propagate",       // `expr?`            propagate-expr (§19)
    GuardedExpr:   "GuardedExpr",     // `expr !{ arms }`   guarded-expr (§19)

    // Generator operator expression (M4.1 — D5 MUST PARSE).
    // `Yield` is built by parseAssignmentExpr when the cursor is inside a
    // `function*` body (`ctx.inGenerator`). The M4.3 async retraction
    // REMOVED the sibling `Await` kind — scrml has no `async`/`await` at the
    // language level; see parseUnary's E-AWAIT-NOT-IN-SCRML site.
    Yield: "Yield",                  // `yield expr` / `yield* expr` (§37 / D5)

    // JS->markup seam: markup-as-value (MK4 — R1 spike §1.2 / Pillar 1).
    // A `<tag>...</tag>` element appearing in JS expression position is a
    // first-class value (`const c = <div/>`, `return <p>hi</p>`,
    // `lift <wrapper>...</wrapper>`). The JS layer delegates BACK UP to the
    // markup layer when parsePrimary's LessThan branch sees the value-following
    // prev-token + the markup-opener char shape (parse-seam.js's
    // markupValueAllowedAfter). The delegation produces a markup block-stream
    // (the same shape parseMarkup produces at top level); MarkupValue wraps
    // it as a single Expr-shaped operand.
    MarkupValue: "MarkupValue",
});

export const ArrayElementKind = Object.freeze({
    Item:   "Item",
    Spread: "Spread",
    Hole:   "Hole",
});

export const ObjectPropertyKind = Object.freeze({
    KeyValue:  "KeyValue",
    Shorthand: "Shorthand",
    Spread:    "Spread",
    Method:    "Method",
});

// IsCheckOp — the predicate suffix of an `is` check (M2.4).
//   Not     — `expr is not`        (absence; §42.2.2)
//   Some    — `expr is some`       (presence; §42.2.2a)
//   Given   — `expr is given`      (presence alias of Some; §42.2.4)
//   NotNot  — `expr is not not`    (double-negative presence; §42.2.4 / §42.8)
//   Variant — `expr is .Variant`   (single-variant check; §18.17)
export const IsCheckOp = Object.freeze({
    Not:     "Not",
    Some:    "Some",
    Given:   "Given",
    NotNot:  "NotNot",
    Variant: "Variant",
});

// MatchArmPatternKind — the arm-pattern form of one match arm (M2.4).
// Per SPEC §18.2: arm-pattern ::= variant-pattern | wildcard-arm | is-pattern.
//   Variant  — `.V` / `Type.V` / `Type::V`, optional `( binding-list )`
//   Wildcard — `else` / `_`
//   Is       — `is .V` (§18.17 is-pattern in arm position)
export const MatchArmPatternKind = Object.freeze({
    Variant:  "Variant",
    Wildcard: "Wildcard",
    Is:       "Is",
});

// --- Primary-expression node constructors ---

export function makeIdent(name, span) {
    return { kind: ExprKind.Ident, name, span };
}

export function makeNumberLit(value, raw, span) {
    return { kind: ExprKind.NumberLit, value, raw, span };
}

export function makeStringLit(value, raw, span) {
    return { kind: ExprKind.StringLit, value, raw, span };
}

export function makeBoolLit(value, span) {
    return { kind: ExprKind.BoolLit, value, span };
}

export function makeRegexLit(pattern, flags, raw, span) {
    return { kind: ExprKind.RegexLit, pattern, flags, raw, span };
}

export function makeTemplateLit(quasis, exprs, span) {
    return { kind: ExprKind.TemplateLit, quasis, exprs, span };
}

export function makeTemplateQuasi(raw, cooked) {
    return { raw, cooked };
}

export function makeAtCell(name, span) {
    return { kind: ExprKind.AtCell, name, span };
}

export function makeBareVariant(name, span) {
    return { kind: ExprKind.BareVariant, name, span };
}

// makeThis — the `this` keyword atom. Carries only a span. M2.3.
export function makeThis(span) {
    return { kind: ExprKind.This, span };
}

// makeSuper — the `super` keyword atom. Valid only as the base of a member
// access or a call (`super.x`, `super[x]`, `super(...)`). M2.3.
export function makeSuper(span) {
    return { kind: ExprKind.Super, span };
}

export function makeArray(elements, span) {
    return { kind: ExprKind.Array, elements, span };
}

export function makeObject(properties, span) {
    return { kind: ExprKind.Object, properties, span };
}

export function makeParen(expression, span) {
    return { kind: ExprKind.Paren, expression, span };
}

// --- Array-element constructors ---
export function makeArrayItem(expression) {
    return { kind: ArrayElementKind.Item, expression };
}
export function makeArraySpread(expression) {
    return { kind: ArrayElementKind.Spread, expression };
}
export function makeArrayHole() {
    return { kind: ArrayElementKind.Hole };
}

// --- Object-property constructors ---
export function makeObjectKeyValue(key, value, computed) {
    return { kind: ObjectPropertyKind.KeyValue, key, value, computed };
}
export function makeObjectShorthand(name) {
    return { kind: ObjectPropertyKind.Shorthand, name };
}
export function makeObjectSpread(expression) {
    return { kind: ObjectPropertyKind.Spread, expression };
}
// makeObjectMethod — an object-literal method `key() { ... }` (or a
// getter / setter when `methodKind` is "get" / "set"). `value` is a
// Function node carrying the method's params + block-stub body. `computed`
// is true for a `[expr]` method key. M2.3.
export function makeObjectMethod(key, value, computed, methodKind) {
    return { kind: ObjectPropertyKind.Method, key, value, computed, methodKind };
}

// --- Operator / call / member node constructors (M2.2-M2.4 — catalog) ---

export function makeUnary(op, operand, prefix, span) {
    return { kind: ExprKind.Unary, op, operand, prefix, span };
}
export function makeUpdate(op, operand, prefix, span) {
    return { kind: ExprKind.Update, op, operand, prefix, span };
}
export function makeBinary(op, left, right, span) {
    return { kind: ExprKind.Binary, op, left, right, span };
}
export function makeLogical(op, left, right, span) {
    return { kind: ExprKind.Logical, op, left, right, span };
}
export function makeAssignment(op, target, value, span) {
    return { kind: ExprKind.Assignment, op, target, value, span };
}
export function makeConditional(test, consequent, alternate, span) {
    return { kind: ExprKind.Conditional, test, consequent, alternate, span };
}
export function makeSequence(expressions, span) {
    return { kind: ExprKind.Sequence, expressions, span };
}
export function makeCall(callee, args, optional, span) {
    return { kind: ExprKind.Call, callee, args, optional, span };
}
export function makeNew(callee, args, span) {
    return { kind: ExprKind.New, callee, args, span };
}
export function makeMember(object, property, computed, optional, span) {
    return { kind: ExprKind.Member, object, property, computed, optional, span };
}
export function makeArrow(params, body, isAsync, span) {
    return { kind: ExprKind.Arrow, params, body, isAsync, span };
}
// makeFunction — function expression. `body` is a BlockStub (M3 parses the
// statement body). `name` is `not` for an anonymous function. `isGenerator`
// (M4.1) is true for a `function*` generator-function expression; the
// generator flag was a documented M2.3 deferral — M2.3 consumed the `*` to
// keep the head parse in sync but discarded the flag, which M4.1 now wires.
export function makeFunction(name, params, body, isAsync, isGenerator, span) {
    return { kind: ExprKind.Function, name, params, body, isAsync, isGenerator, span };
}

// makeTaggedTemplate — tagged template `tag`...``. `tag` is the callee Expr;
// `quasi` is the TemplateLit node. M2.3.
export function makeTaggedTemplate(tag, quasi, span) {
    return { kind: ExprKind.TaggedTemplate, tag, quasi, span };
}

// --- Parameter-pattern + body-stub constructors (M2.3) ---

// makeRestElement — `...rest` in a parameter list (or array-pattern tail).
export function makeRestElement(argument, span) {
    return { kind: ExprKind.RestElement, argument, span };
}
// makeAssignmentPattern — a defaulted parameter `name = default`.
export function makeAssignmentPattern(left, right, span) {
    return { kind: ExprKind.AssignmentPattern, left, right, span };
}
// makeBlockStub — the BLOCK body of a block-body arrow / function expression.
// M2.3 parses the HEAD of arrows + function expressions; the brace-delimited
// statement body forward-references M3's statement parser. The stub captures
// the body's token RANGE (tokenStart..tokenEnd, half-open indices into M1's
// Token[]) + source span so M3 can re-enter and parse it in place. `tokens`
// carries the raw skipped token slice so a smoke test / M3 hand-off has the
// material without re-lexing. This is the documented M3 extension point.
export function makeBlockStub(tokens, tokenStart, tokenEnd, span) {
    return { kind: ExprKind.BlockStub, tokens, tokenStart, tokenEnd, span };
}

// --- scrml-extension expression-form constructors (M2.4 — D5 MUST ADD) ---

// makeNotValue — the `not` absence-value atom (§42). `not` is the single
// absence sentinel; it is a VALUE, never a prefix operator (§42.10 —
// `not (expr)` is E-TYPE-045, a typer concern, not a parse form).
export function makeNotValue(span) {
    return { kind: ExprKind.NotValue, span };
}

// makeTilde — the `~` pipeline-accumulator atom (§32). `~` is consumed by
// being READ as an expression (§32.2); it is an atom, not an operator.
export function makeTilde(span) {
    return { kind: ExprKind.Tilde, span };
}

// makeSql — a `?{ ... }` SQL block (§8). `raw` is the verbatim source text
// of the block INCLUDING the `?{` / `}` delimiters, as M1 lexes it into the
// SqlBlock token. The native parser captures the block as one atom; the
// SQL grammar inside is not parsed here (a later milestone owns that).
export function makeSql(raw, span) {
    return { kind: ExprKind.Sql, raw, span };
}

// makeInputStateRef — an `<#id>` input-state reference (§36). `id` is the
// referenced element id WITHOUT the `<#` / `>` delimiters. The ref is an
// atom; trailing `.pressed(...)` / `.value` member+call forms are the
// ordinary postfix chain (M2.3).
export function makeInputStateRef(id, span) {
    return { kind: ExprKind.InputStateRef, id, span };
}

// makeIsCheck — an `is` predicate check (§42 / §18.17). `operand` is the
// left-hand Expr. `op` is an IsCheckOp value. `variant` is the variant Expr
// for the `.Variant` form (op === IsCheckOp.Variant) and `not` for every
// other op. The result is a boolean predicate.
export function makeIsCheck(operand, op, variant, span) {
    return { kind: ExprKind.IsCheck, operand, op, variant, span };
}

// makeMatch — a JS-style `match expr { arms }` value-return form (§18).
// `subject` is the matched Expr; `arms` is an array of match-arm objects
// (see makeMatchArm). The match is an expression — it produces a value.
export function makeMatch(subject, arms, span) {
    return { kind: ExprKind.Match, subject, arms, span };
}

// makeMatchArm — one arm of a `match` expression. `pattern` is a match-arm
// pattern object (see the make*Pattern constructors). `body` is the arm
// body — an Expr (concise body) or a BlockStub (a `{ ... }` block body,
// forward-referencing M3's statement parser). `separator` is "=>" or "->"
// (both accepted per §18.2; "=>" canonical).
export function makeMatchArm(pattern, body, separator) {
    return { pattern, body, separator };
}

// makeVariantPattern — a `variant-pattern` arm pattern (§18.2). `typeName`
// is the qualifying enum-type name, or `not` for the bare `.V` shorthand.
// `variantName` is the variant name. `bindings` is the payload binding
// list (an array of binding objects from makeMatchBinding) or `not` when
// the variant carries no `( ... )`.
export function makeVariantPattern(typeName, variantName, bindings, span) {
    return { patternKind: MatchArmPatternKind.Variant, typeName, variantName, bindings, span };
}

// makeWildcardPattern — an `else` / `_` wildcard arm pattern (§18.6).
// `keyword` records which spelling the source used ("else" or "_").
export function makeWildcardPattern(keyword, span) {
    return { patternKind: MatchArmPatternKind.Wildcard, keyword, span };
}

// makeIsPattern — an `is .V` is-pattern arm (§18.17 is-pattern in arm
// position). `variantName` is the variant name; the type is inferred from
// the match subject.
export function makeIsPattern(variantName, span) {
    return { patternKind: MatchArmPatternKind.Is, variantName, span };
}

// makeMatchBinding — one payload binding inside a variant-pattern's
// `( ... )`. `fieldName` is `not` for positional binding (`( w, h )`) or
// the named-field name for the named form (`( width: w )`). `local` is
// the bound local-variable name.
export function makeMatchBinding(fieldName, local) {
    return { fieldName, local };
}

// makeRender — a `render name(args)` snippet invocation (§14.9). `name` is
// the snippet prop name; `args` is the argument Expr array.
export function makeRender(name, args, span) {
    return { kind: ExprKind.Render, name, args, span };
}

// makeLift — a `lift expr` form (§10). `argument` is the lifted Expr.
// `lift` is statement-shaped (it does not terminate the block); it is
// modelled as an expression node here (matching legacy ast.ts LiftExprNode).
// Use-site validity (E-SYNTAX-001 / E-SYNTAX-002) is a later-stage concern.
export function makeLift(argument, span) {
    return { kind: ExprKind.Lift, argument, span };
}

// makeFail — a `fail Type::Variant(args)` form (§19.3). `variant` is the
// error-variant Expr (a Member node, optionally wrapped in a Call when the
// variant carries a payload). `fail` is statement-shaped (syntactic sugar
// for `return Type::Variant(args)`); it is modelled as an expression node
// (matching legacy ast.ts FailExprNode). Use-site validity (E-ERROR-001 —
// `fail` requires an `!` function) is a later-stage concern.
export function makeFail(variant, span) {
    return { kind: ExprKind.Fail, variant, span };
}

// --- scrml-extension postfix-`?` / `!{}` constructors — M5-swap Wave 2 -------

// makePropagate — an `expr?` propagate-expression (§19). `argument` is the
// guarded Expr; the postfix `?` propagates a `fail` from `argument` to the
// enclosing `!` failable function. `propagate` is statement-shaped at the
// language level (the live `propagate-expr` is a `LogicStatement`); it is
// modelled as an Expr node here (the same way `Lift` / `Fail` are), and the
// statement bridge un-wraps a `ExprStmt{ Propagate }` into `propagate-expr`.
// Use-site validity (`?` requires an `!` function) is a later-stage concern.
export function makePropagate(argument, span) {
    return { kind: ExprKind.Propagate, argument, span };
}

// makeGuardedExpr — an `expr !{ arms }` guarded-expression (§19). `expression`
// is the guarded Expr; `arms` is the parsed error-arm array (the same
// `ErrorArm[]` shape `parseErrorArms` produces for `<errors>` / the
// `ErrorEffect` block — `{ pattern, binding, handler, span }` per arm).
// `guarded-expr` is a live `LogicStatement` kind; like `Propagate` it is
// modelled as an Expr node here and the statement bridge un-wraps a
// `ExprStmt{ GuardedExpr }` into the live `guarded-expr`.
export function makeGuardedExpr(expression, arms, span) {
    return { kind: ExprKind.GuardedExpr, expression, arms, span };
}

// --- Generator operator-expression constructor (M4.1 — D5 MUST PARSE).
// Calculation (pure fns over already-confirmed parts; DD §D1).
//
// M4.3 — `makeAwait` is RETIRED. scrml has no `async`/`await` at the language
// level (parallel-by-default, no colored functions; the canonical async
// surface is the compiler body-split). parseUnary now fires
// E-AWAIT-NOT-IN-SCRML at the `await` keyword site and recovers by parsing
// the operand as a unary tail. Generators (`yield` / `yield*` / `function*`)
// are preserved — they are a separate conversation. ---

// makeYield — a `yield argument` / `yield* argument` / bare `yield`
// expression (§37). `yield` is an ASSIGNMENT-precedence operator — the
// LOWEST expression precedence, below conditional `?:` (`yield a ? b : c`
// yields the whole conditional). `delegate` is true for the `yield*`
// delegating form (yields each value of an iterable). `argument` is `not`
// for a bare `yield` (yield-undefined — valid as an operand, e.g. `a +
// yield`). `yield` is legal only inside a generator (`function*`) body;
// `yield` outside a generator is E-SSE-001, a SEMANTIC check (not a parse
// error — the form still parses). The conformance normalizer maps this to
// ESTree's YieldExpression.
export function makeYield(argument, delegate, span) {
    return { kind: ExprKind.Yield, argument, delegate, span };
}

// --- makeMarkupValue — markup-as-value (MK4; R1 spike §1.2 / Pillar 1) ---
// CALCULATION (pure data builder). One markup-as-value expression node — a
// markup element appearing in JS expression position. `markup` is the typed
// markup block-stream the markup layer produced (the same shape parseMarkup
// returns at top level: an array of block nodes — typically ONE Markup block
// when the markup-as-value is one element, but multiple if the markup-as-
// value contained interleaved blocks). `span` is the JS-coordinate-space
// span from the opening `<` to the closing `>` / `/>` / `</>`.
//
// The kind discriminates from any other Expr — downstream consumers (M5
// codegen, NR) read `node.markup` as the markup payload to wire.
export function makeMarkupValue(markup, span) {
    return { kind: ExprKind.MarkupValue, markup, span };
}

// --- isExpr — predicate ---
export function isExpr(node) {
    if (node === undefined || node === null) {
        return false;
    }
    return ExprKind[node.kind] !== undefined;
}
