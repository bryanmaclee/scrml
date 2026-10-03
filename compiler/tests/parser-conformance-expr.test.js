// parser-conformance-expr.test.js — expression-parser conformance suite
// (M2.1 primary expressions + M2.2 operator expressions).
//
// Per scrml-native-parser-design-2026-05-17.md §D6 + §D7 M2 gating:
//   "Conformance Tier 1+2 PASS on the expression subset ... Tier 1 — node-kind
//    sequence ... Tier 2 — identifier / literal values."
//
// Scope:
//   M2.1 — PRIMARY EXPRESSIONS: number / string / template / regex / boolean
//          literals, identifiers, @-cells, bare variants, parenthesized
//          exprs, array literals, object literals.
//   M2.2 — OPERATOR EXPRESSIONS: binary operators with full JS precedence
//          (the precedence-climbing core), logical && / || / ??, unary
//          prefix ! - + ~ typeof void delete, update ++ / -- (prefix +
//          postfix), assignment = and every compound form, conditional ?:,
//          sequence , . The conformance check against Acorn is the
//          precedence + associativity proof.
//
// The native expression parser (compiler/native-parser/parse-expr.js) parses
// one expression at the head of M1's lex(source) token stream. This test runs
// a micro-corpus through both the native parser and Acorn (the conformance
// ORACLE per §D6 — never the design template) and asserts:
//
//   Tier 1 — the node-kind SEQUENCE produced by a tree walk matches.
//   Tier 2 — identifier names + literal values + operator strings at
//            corresponding positions match.
//
// call/member/arrow (M2.3) and scrml-extension expression forms (M2.4) are
// LATER sub-steps. The scrml-extension primaries the native parser DOES emit
// at M2.1 (@-cells, bare variants) have no Acorn equivalent (DD §D6
// documented divergence) — those are exercised natively-only in the dedicated
// describe-block, not diffed against Acorn.
//
// This file MIRRORS parser-conformance-lexer.test.js's structure. Acorn is the
// correctness oracle for the JS subset: `parseExpr` is the expression parser
// impl#1 runs in production (component / `^{}` / `<match>` re-parse through
// `nativeParseFile`), so these checks cover a live path. (S449: the acorn-vs-
// acorn-stub harness `parser-conformance.test.js` + `parsers.js` was deleted —
// it never exercised the native parser.)

import { describe, test, expect } from "bun:test";
import * as acorn from "acorn";

import { lex as scrmlNativeLex } from "../native-parser/lex.js";
import { parseExpr as scrmlNativeParseExpr } from "../native-parser/parse-expr.js";
import {
    ExprKind, ArrayElementKind, ObjectPropertyKind,
    IsCheckOp, MatchArmPatternKind,
} from "../native-parser/ast-expr.js";

// M4.2 — function-param destructuring + arrow rest/default params now emit
// REAL binding nodes (the K6 closure); the normalizer + a few native-shape
// tests below recognize the BindingKind catalog.
import { BindingKind } from "../native-parser/ast-stmt.js";
const ACORN_OPTS = {
    ecmaVersion: 2025,
    sourceType:  "module",
};

// -----------------------------------------------------------------------------
// nativeToEstree — normalize a native Expr node into an ESTree-shaped node so
// the Tier-1 node-kind walk + Tier-2 value extraction compare apples-to-apples
// against Acorn's ESTree output.
//
// Mapping (DD §D3 — the native Expr enum is intentionally more typed than
// ESTree's `type: string` discriminator; this normalizer projects native →
// ESTree for the conformance diff only):
//   Ident       -> Identifier
//   NumberLit   -> Literal
//   StringLit   -> Literal
//   BoolLit     -> Literal
//   RegexLit    -> Literal (with a `regex` sub-object, per Acorn)
//   TemplateLit -> TemplateLiteral (+ TemplateElement quasis)
//   Array       -> ArrayExpression  (Hole -> null slot; Spread -> SpreadElement)
//   Object      -> ObjectExpression (KeyValue/Shorthand -> Property;
//                                    Spread -> SpreadElement)
//   Paren       -> UNWRAPPED (Acorn produces no paren node)
//   AtCell      -> ScrmlAtCell      (no ESTree equivalent — native-only)
//   BareVariant -> ScrmlBareVariant (no ESTree equivalent — native-only)
//
// M2.3 additions (call / member / arrow / function):
//   Call           -> CallExpression   { callee, arguments, optional }
//   New            -> NewExpression    { callee, arguments }
//   Member         -> MemberExpression { object, property, computed, optional }
//   TaggedTemplate -> TaggedTemplateExpression { tag, quasi }
//   Arrow          -> ArrowFunctionExpression  { params, body, async, expression }
//   Function       -> FunctionExpression       { id, params, body, async }
//   This           -> ThisExpression
//   Super          -> Super
//   RestElement    -> RestElement      { argument }
//   AssignmentPattern -> AssignmentPattern { left, right }
//   BlockStub      -> BlockStatement (a LEAF in the walk — M3 parses the
//                     statement body; M2.3 only captures the token range)
//   Object Method  -> Property { method, kind, computed, key, value }
//
// Optional chaining: ESTree wraps a call/member chain that contains ANY
// optional `?.` link in exactly ONE outer ChainExpression. The native AST
// instead carries an `optional` flag on each Member/Call node. The
// normalizer re-creates the ESTree ChainExpression wrapper: when a
// Member/Call's left-spine contains an optional link AND the node is not
// itself the spine-child of another chain node, it is wrapped once.
// -----------------------------------------------------------------------------

// isCallOrMemberKind — a node kind that participates in a call/member chain.
function isCallOrMemberKind(kind) {
    return kind === ExprKind.Call || kind === ExprKind.Member;
}

// spineHasOptional — does the call/member left-spine of `node` contain an
// optional `?.` link? Walks object (Member) / callee (Call) down the spine.
function spineHasOptional(node) {
    let cur = node;
    while (cur !== undefined && cur !== null && isCallOrMemberKind(cur.kind)) {
        if (cur.optional === true) return true;
        cur = (cur.kind === ExprKind.Member) ? cur.object : cur.callee;
    }
    return false;
}

// nativeToEstree — normalize a native Expr to an ESTree-shaped node. The
// optional second argument `insideChain` is true when this node is being
// projected as the spine-child (object / callee) of an enclosing chain node;
// it suppresses a redundant inner ChainExpression wrapper.
function nativeToEstree(node, insideChain) {
    if (node === undefined || node === null) return null;

    if (node.kind === ExprKind.Ident) {
        return { type: "Identifier", name: node.name };
    }
    if (node.kind === ExprKind.NumberLit) {
        return { type: "Literal", value: node.value, raw: node.raw };
    }
    if (node.kind === ExprKind.StringLit) {
        return { type: "Literal", value: node.value, raw: node.raw };
    }
    if (node.kind === ExprKind.BoolLit) {
        return { type: "Literal", value: node.value, raw: node.value ? "true" : "false" };
    }
    if (node.kind === ExprKind.RegexLit) {
        return {
            type: "Literal",
            value: {},
            raw: node.raw,
            regex: { pattern: node.pattern, flags: node.flags },
        };
    }
    if (node.kind === ExprKind.TemplateLit) {
        const quasis = node.quasis.map((q, i) => ({
            type: "TemplateElement",
            value: { raw: q.raw, cooked: q.cooked },
            tail: i === node.quasis.length - 1,
        }));
        return {
            type: "TemplateLiteral",
            quasis,
            // Wrap the map callback so the array index is NOT forwarded as
            // nativeToEstree's `insideChain` argument.
            expressions: node.exprs.map((e) => nativeToEstree(e)),
        };
    }
    if (node.kind === ExprKind.Array) {
        return {
            type: "ArrayExpression",
            elements: node.elements.map((el) => {
                if (el.kind === ArrayElementKind.Hole) return null;
                if (el.kind === ArrayElementKind.Spread) {
                    return { type: "SpreadElement", argument: nativeToEstree(el.expression) };
                }
                return nativeToEstree(el.expression);
            }),
        };
    }
    if (node.kind === ExprKind.Object) {
        return {
            type: "ObjectExpression",
            properties: node.properties.map((p) => {
                if (p.kind === ObjectPropertyKind.Spread) {
                    return { type: "SpreadElement", argument: nativeToEstree(p.expression) };
                }
                if (p.kind === ObjectPropertyKind.Shorthand) {
                    const id = { type: "Identifier", name: p.name };
                    return {
                        type: "Property",
                        kind: "init",
                        method: false,
                        shorthand: true,
                        computed: false,
                        key: id,
                        value: id,
                    };
                }
                if (p.kind === ObjectPropertyKind.Method) {
                    // A method's `kind` is "init" (plain method) or "get" /
                    // "set" (accessor). Acorn marks a plain method
                    // `method: true`; an accessor `method: false`.
                    const isAccessor = p.methodKind === "get" || p.methodKind === "set";
                    return {
                        type: "Property",
                        kind: p.methodKind,
                        method: isAccessor === false,
                        shorthand: false,
                        computed: p.computed,
                        key: nativeToEstree(p.key),
                        value: nativeToEstree(p.value),
                    };
                }
                // KeyValue
                return {
                    type: "Property",
                    kind: "init",
                    method: false,
                    shorthand: false,
                    computed: p.computed,
                    key: nativeToEstree(p.key),
                    value: nativeToEstree(p.value),
                };
            }),
        };
    }
    if (node.kind === ExprKind.Paren) {
        // Acorn produces no paren node — unwrap.
        return nativeToEstree(node.expression);
    }
    if (node.kind === ExprKind.AtCell) {
        return { type: "ScrmlAtCell", name: node.name };
    }
    if (node.kind === ExprKind.BareVariant) {
        return { type: "ScrmlBareVariant", name: node.name };
    }

    // --- M2.2 operator nodes ---
    // Binary  -> BinaryExpression  { operator, left, right }
    if (node.kind === ExprKind.Binary) {
        return {
            type: "BinaryExpression",
            operator: node.op,
            left: nativeToEstree(node.left),
            right: nativeToEstree(node.right),
        };
    }
    // Logical -> LogicalExpression { operator, left, right }
    if (node.kind === ExprKind.Logical) {
        return {
            type: "LogicalExpression",
            operator: node.op,
            left: nativeToEstree(node.left),
            right: nativeToEstree(node.right),
        };
    }
    // Unary   -> UnaryExpression   { operator, prefix, argument }
    if (node.kind === ExprKind.Unary) {
        return {
            type: "UnaryExpression",
            operator: node.op,
            prefix: node.prefix,
            argument: nativeToEstree(node.operand),
        };
    }
    // Update  -> UpdateExpression  { operator, prefix, argument }
    if (node.kind === ExprKind.Update) {
        return {
            type: "UpdateExpression",
            operator: node.op,
            prefix: node.prefix,
            argument: nativeToEstree(node.operand),
        };
    }
    // Assignment -> AssignmentExpression { operator, left, right }. The
    // native node names the sides target/value; ESTree names them left/right.
    if (node.kind === ExprKind.Assignment) {
        return {
            type: "AssignmentExpression",
            operator: node.op,
            left: nativeToEstree(node.target),
            right: nativeToEstree(node.value),
        };
    }
    // Conditional -> ConditionalExpression { test, consequent, alternate }
    if (node.kind === ExprKind.Conditional) {
        return {
            type: "ConditionalExpression",
            test: nativeToEstree(node.test),
            consequent: nativeToEstree(node.consequent),
            alternate: nativeToEstree(node.alternate),
        };
    }
    // Sequence -> SequenceExpression { expressions }
    if (node.kind === ExprKind.Sequence) {
        return {
            type: "SequenceExpression",
            expressions: node.expressions.map((e) => nativeToEstree(e)),
        };
    }

    // --- M2.3 call / member / arrow / function nodes ---

    // This -> ThisExpression ; Super -> Super
    if (node.kind === ExprKind.This)  return { type: "ThisExpression" };
    if (node.kind === ExprKind.Super) return { type: "Super" };

    // Member -> MemberExpression. The left-spine (object) is projected with
    // insideChain propagated; a non-computed property is an Identifier; a
    // computed property is the full key expression (a fresh chain root).
    if (node.kind === ExprKind.Member) {
        const plain = {
            type: "MemberExpression",
            object: nativeToEstree(node.object, true),
            property: node.computed
                ? nativeToEstree(node.property)
                : { type: "Identifier", name: node.property.name },
            computed: node.computed,
            optional: node.optional === true,
        };
        if (insideChain !== true && spineHasOptional(node)) {
            return { type: "ChainExpression", expression: plain };
        }
        return plain;
    }

    // Call -> CallExpression. The callee is the spine-child; arguments are
    // fresh chain roots. A Spread-kinded argument becomes a SpreadElement.
    if (node.kind === ExprKind.Call) {
        const plain = {
            type: "CallExpression",
            callee: nativeToEstree(node.callee, true),
            arguments: node.args.map((a) => callArgToEstree(a)),
            optional: node.optional === true,
        };
        if (insideChain !== true && spineHasOptional(node)) {
            return { type: "ChainExpression", expression: plain };
        }
        return plain;
    }

    // New -> NewExpression. (`new` is never part of an optional chain.)
    if (node.kind === ExprKind.New) {
        return {
            type: "NewExpression",
            callee: nativeToEstree(node.callee),
            arguments: node.args.map((a) => callArgToEstree(a)),
        };
    }

    // TaggedTemplate -> TaggedTemplateExpression
    if (node.kind === ExprKind.TaggedTemplate) {
        return {
            type: "TaggedTemplateExpression",
            tag: nativeToEstree(node.tag),
            quasi: nativeToEstree(node.quasi),
        };
    }

    // Arrow -> ArrowFunctionExpression. `expression` is true for a concise
    // (expression) body, false for a block body.
    if (node.kind === ExprKind.Arrow) {
        const blockBody = node.body !== undefined && node.body !== null
            && node.body.kind === ExprKind.BlockStub;
        return {
            type: "ArrowFunctionExpression",
            params: node.params.map((p) => nativeToEstree(p)),
            body: nativeToEstree(node.body),
            async: node.isAsync === true,
            expression: blockBody === false,
        };
    }

    // Function -> FunctionExpression.
    if (node.kind === ExprKind.Function) {
        return {
            type: "FunctionExpression",
            id: (node.name === undefined || node.name === null)
                ? null
                : { type: "Identifier", name: node.name },
            params: node.params.map((p) => nativeToEstree(p)),
            body: nativeToEstree(node.body),
            async: node.isAsync === true,
        };
    }

    // RestElement / AssignmentPattern — parameter-pattern nodes. After M4.2
    // (K6 closure) these may be EITHER the Expr-shape twins (the legacy form,
    // retained for ast-expr nodes that still produce them) OR the binding-
    // shape form (`bindingKind: "RestElement"` / `"AssignmentPattern"`)
    // — function-parameter targets are now binding-shape. The normalizer
    // accepts both surfaces.
    if (node.kind === ExprKind.RestElement || node.bindingKind === "RestElement") {
        return { type: "RestElement", argument: nativeToEstree(node.argument) };
    }
    if (node.kind === ExprKind.AssignmentPattern || node.bindingKind === "AssignmentPattern") {
        return {
            type: "AssignmentPattern",
            left: nativeToEstree(node.left),
            right: nativeToEstree(node.right),
        };
    }

    // M4.2 — BindingIdent / ObjectPattern / ArrayPattern (the binding-shape
    // catalog from ast-stmt). A function parameter that's a plain identifier
    // is now a BindingIdent; a destructuring param is an ObjectPattern /
    // ArrayPattern. The shapes project to ESTree's Identifier / ObjectPattern
    // / ArrayPattern.
    if (node.bindingKind === BindingKind.Ident) {
        return { type: "Identifier", name: node.name };
    }
    if (node.bindingKind === BindingKind.ObjectPat) {
        return {
            type: "ObjectPattern",
            properties: node.properties.map((p) => {
                if (p.propertyKind === "Rest") {
                    return { type: "RestElement", argument: nativeToEstree(p.argument) };
                }
                if (p.propertyKind === "Shorthand") {
                    return {
                        type: "Property", shorthand: true, computed: false, kind: "init",
                        key: { type: "Identifier", name: p.name },
                        value: nativeToEstree(p.value),
                    };
                }
                return {
                    type: "Property", shorthand: false, computed: p.computed === true, kind: "init",
                    key: nativeToEstree(p.key),
                    value: nativeToEstree(p.value),
                };
            }),
        };
    }
    if (node.bindingKind === BindingKind.ArrayPat) {
        return {
            type: "ArrayPattern",
            elements: node.elements.map((el) => {
                if (el.elementKind === "Hole") return null;
                if (el.elementKind === "Rest") {
                    return { type: "RestElement", argument: nativeToEstree(el.argument) };
                }
                return nativeToEstree(el.value);
            }),
        };
    }

    // BlockStub -> BlockStatement. A LEAF in the conformance walk: M2.3 only
    // captures the body's token range; M3's statement parser fills `body`.
    // An empty block matches Acorn's empty BlockStatement; a non-empty block
    // is exercised native-only (the walk does not descend a BlockStatement).
    if (node.kind === ExprKind.BlockStub) {
        return { type: "BlockStatement", body: [] };
    }

    // Unknown / not-yet-mapped — surface so the test fails the row.
    return { type: `Native:${node.kind}` };
}

// callArgToEstree — project one call / new argument. A native Spread-kinded
// element (the array-element Spread shape, reused for call-argument spreads)
// maps to ESTree's SpreadElement; a plain argument projects normally.
function callArgToEstree(arg) {
    if (arg !== undefined && arg !== null && arg.kind === ArrayElementKind.Spread) {
        return { type: "SpreadElement", argument: nativeToEstree(arg.expression) };
    }
    return nativeToEstree(arg);
}

// -----------------------------------------------------------------------------
// nodeKindSequence — Tier 1. Walk an ESTree-shaped tree in a deterministic
// pre-order and produce the flat sequence of node `type` strings. Both the
// native (normalized) tree and the Acorn tree are walked by the same routine,
// so a mismatch is a true structural divergence (E-CONFORMANCE-1).
// -----------------------------------------------------------------------------
function nodeKindSequence(node, out) {
    const acc = out ?? [];
    if (node === undefined || node === null) {
        acc.push("Hole");
        return acc;
    }
    if (typeof node !== "object") return acc;
    if (typeof node.type !== "string") return acc;

    acc.push(node.type);

    // Recurse into the child shapes our corpus produces. Order is fixed so the
    // sequence is stable.
    if (node.type === "ArrayExpression") {
        for (const el of node.elements) nodeKindSequence(el, acc);
    } else if (node.type === "ObjectExpression") {
        for (const p of node.properties) nodeKindSequence(p, acc);
    } else if (node.type === "Property") {
        // Skip the key for a shorthand (Acorn's key === value object); else
        // walk key then value.
        if (!node.shorthand) nodeKindSequence(node.key, acc);
        nodeKindSequence(node.value, acc);
    } else if (node.type === "SpreadElement") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "TemplateLiteral") {
        // Interleave quasis + expressions in source order: q0 e0 q1 e1 ... qN.
        for (let i = 0; i < node.quasis.length; i++) {
            nodeKindSequence(node.quasis[i], acc);
            if (i < node.expressions.length) nodeKindSequence(node.expressions[i], acc);
        }
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression") {
        // Left then right — the source order Acorn walks too.
        nodeKindSequence(node.left, acc);
        nodeKindSequence(node.right, acc);
    } else if (node.type === "UnaryExpression" || node.type === "UpdateExpression") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "ConditionalExpression") {
        nodeKindSequence(node.test, acc);
        nodeKindSequence(node.consequent, acc);
        nodeKindSequence(node.alternate, acc);
    } else if (node.type === "SequenceExpression") {
        for (const e of node.expressions) nodeKindSequence(e, acc);
    } else if (node.type === "ChainExpression") {
        nodeKindSequence(node.expression, acc);
    } else if (node.type === "MemberExpression") {
        nodeKindSequence(node.object, acc);
        nodeKindSequence(node.property, acc);
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
        nodeKindSequence(node.callee, acc);
        for (const a of node.arguments) nodeKindSequence(a, acc);
    } else if (node.type === "TaggedTemplateExpression") {
        nodeKindSequence(node.tag, acc);
        nodeKindSequence(node.quasi, acc);
    } else if (node.type === "ArrowFunctionExpression") {
        for (const p of node.params) nodeKindSequence(p, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
        if (node.id) nodeKindSequence(node.id, acc);
        for (const p of node.params) nodeKindSequence(p, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "RestElement") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "AssignmentPattern") {
        nodeKindSequence(node.left, acc);
        nodeKindSequence(node.right, acc);
    }
    // BlockStatement is intentionally a LEAF: M2.3 stubs the statement body
    // (M3 parses it), so the walk does not descend into it. Conformance
    // corpus arrow / function cases with block bodies use EMPTY blocks so the
    // native BlockStatement matches Acorn's empty BlockStatement exactly.
    return acc;
}

// -----------------------------------------------------------------------------
// valueSequence — Tier 2. Walk the same tree and collect identifier names +
// literal values (+ template cooked strings + regex pattern/flags + operator
// strings) in the same pre-order. A mismatch is a value divergence
// (E-CONFORMANCE-2). The operator strings are collected pre-order BEFORE the
// operands, so a wrong-precedence parse (a different tree shape) shows up as
// an operator-position mismatch as well as a node-kind-sequence mismatch.
// -----------------------------------------------------------------------------
function valueSequence(node, out) {
    const acc = out ?? [];
    if (node === undefined || node === null) return acc;
    if (typeof node !== "object" || typeof node.type !== "string") return acc;

    if (node.type === "Identifier") {
        acc.push("id:" + node.name);
    } else if (node.type === "Literal") {
        if (node.regex) {
            acc.push("regex:" + node.regex.pattern + "/" + node.regex.flags);
        } else {
            acc.push("lit:" + JSON.stringify(node.value));
        }
    } else if (node.type === "TemplateElement") {
        acc.push("quasi:" + node.value.cooked);
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression" || node.type === "UnaryExpression"
               || node.type === "UpdateExpression") {
        // The operator string is part of Tier 2 — `+` vs `-`, `==` vs `===`,
        // and prefix-vs-postfix (prefix flag) are all value divergences.
        const fix = (node.type === "UpdateExpression" && node.prefix === false) ? "post" : "pre";
        acc.push("op:" + node.operator + ":" + fix);
    } else if (node.type === "MemberExpression") {
        // The computed + optional flags are value-sensitive: `a.b` vs `a[b]`
        // and `a.b` vs `a?.b` are divergences a bad parse would produce.
        acc.push("member:computed=" + (node.computed === true)
            + ":optional=" + (node.optional === true));
    } else if (node.type === "CallExpression") {
        acc.push("call:optional=" + (node.optional === true));
    } else if (node.type === "NewExpression") {
        acc.push("new");
    } else if (node.type === "ThisExpression") {
        acc.push("this");
    } else if (node.type === "Super") {
        acc.push("super");
    } else if (node.type === "ArrowFunctionExpression") {
        acc.push("arrow:async=" + (node.async === true)
            + ":concise=" + (node.expression === true));
    } else if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
        acc.push("function:async=" + (node.async === true));
    }

    if (node.type === "ArrayExpression") {
        for (const el of node.elements) valueSequence(el, acc);
    } else if (node.type === "ObjectExpression") {
        for (const p of node.properties) valueSequence(p, acc);
    } else if (node.type === "Property") {
        if (!node.shorthand) valueSequence(node.key, acc);
        valueSequence(node.value, acc);
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression") {
        valueSequence(node.left, acc);
        valueSequence(node.right, acc);
    } else if (node.type === "UnaryExpression" || node.type === "UpdateExpression") {
        valueSequence(node.argument, acc);
    } else if (node.type === "ConditionalExpression") {
        valueSequence(node.test, acc);
        valueSequence(node.consequent, acc);
        valueSequence(node.alternate, acc);
    } else if (node.type === "SequenceExpression") {
        for (const e of node.expressions) valueSequence(e, acc);
    } else if (node.type === "SpreadElement") {
        valueSequence(node.argument, acc);
    } else if (node.type === "TemplateLiteral") {
        for (let i = 0; i < node.quasis.length; i++) {
            valueSequence(node.quasis[i], acc);
            if (i < node.expressions.length) valueSequence(node.expressions[i], acc);
        }
    } else if (node.type === "ChainExpression") {
        valueSequence(node.expression, acc);
    } else if (node.type === "MemberExpression") {
        valueSequence(node.object, acc);
        valueSequence(node.property, acc);
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
        valueSequence(node.callee, acc);
        for (const a of node.arguments) valueSequence(a, acc);
    } else if (node.type === "TaggedTemplateExpression") {
        valueSequence(node.tag, acc);
        valueSequence(node.quasi, acc);
    } else if (node.type === "ArrowFunctionExpression") {
        for (const p of node.params) valueSequence(p, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration") {
        if (node.id) valueSequence(node.id, acc);
        for (const p of node.params) valueSequence(p, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "RestElement") {
        valueSequence(node.argument, acc);
    } else if (node.type === "AssignmentPattern") {
        valueSequence(node.left, acc);
        valueSequence(node.right, acc);
    }
    // BlockStatement is a LEAF here (M3 parses the statement body) — see
    // nodeKindSequence's matching note.
    return acc;
}

function parseWithAcorn(source) {
    try {
        const ast = acorn.Parser.parseExpressionAt(source, 0, ACORN_OPTS);
        return { ok: true, ast };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

function parseWithNative(source) {
    try {
        const result = scrmlNativeParseExpr(scrmlNativeLex(source));
        return { ok: true, ast: result.ast, errors: result.errors };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

// -----------------------------------------------------------------------------
// Acorn-comparable primary-expression micro-corpus. Every entry is a primary
// expression with NO scrml extensions, so raw Acorn parses it and the
// native-vs-Acorn Tier 1+2 diff is meaningful.
// -----------------------------------------------------------------------------
const ACORN_CORPUS = [
    // --- literals ---
    { name: "number literal — integer",        src: "42" },
    { name: "number literal — float",          src: "3.14" },
    { name: "number literal — hex",            src: "0xff" },
    { name: "number literal — exponent",       src: "1e3" },
    { name: "number literal — separators",     src: "1_000_000" },
    { name: "string literal — double-quoted",  src: '"hello"' },
    { name: "string literal — single-quoted",  src: "'world'" },
    { name: "string literal — with escapes",   src: '"a\\nb\\tc"' },
    { name: "boolean literal — true",          src: "true" },
    { name: "boolean literal — false",         src: "false" },
    { name: "regex literal — no flags",        src: "/foo/" },
    { name: "regex literal — with flags",      src: "/foo.bar/gi" },

    // --- identifiers ---
    { name: "identifier — plain",              src: "myVar" },
    { name: "identifier — underscore + digit", src: "_x9" },
    { name: "identifier — dollar",             src: "$ref" },

    // --- parenthesized ---
    { name: "paren — wrapping a number",       src: "(7)" },
    { name: "paren — wrapping an identifier",  src: "(foo)" },
    { name: "paren — nested parens",           src: "(((9)))" },

    // --- array literals ---
    { name: "array — empty",                   src: "[]" },
    { name: "array — number elements",         src: "[1, 2, 3]" },
    { name: "array — mixed literal elements",  src: '[1, "two", true]' },
    { name: "array — identifier elements",     src: "[a, b, c]" },
    { name: "array — single hole",             src: "[1, , 3]" },
    { name: "array — leading hole",            src: "[, 2]" },
    { name: "array — spread element",          src: "[...xs]" },
    { name: "array — spread + items",          src: "[1, ...rest, 9]" },
    { name: "array — nested array",            src: "[[1], [2, 3]]" },
    { name: "array — trailing comma",          src: "[1, 2,]" },

    // --- object literals ---
    { name: "object — empty",                  src: "{}" },
    { name: "object — key-value pairs",        src: "{a: 1, b: 2}" },
    { name: "object — string key",             src: '{"k": 1}' },
    { name: "object — number key",             src: "{0: 1}" },
    { name: "object — shorthand",              src: "{x, y}" },
    { name: "object — mixed shorthand + kv",   src: "{a: 1, b}" },
    { name: "object — computed key",           src: "{[k]: 1}" },
    { name: "object — spread",                 src: "{...rest}" },
    { name: "object — spread + props",         src: "{a: 1, ...rest}" },
    { name: "object — nested object value",    src: "{outer: {inner: 1}}" },
    { name: "object — trailing comma",         src: "{a: 1,}" },
    { name: "object — array value",            src: "{items: [1, 2]}" },

    // --- template literals ---
    { name: "template — no interpolation",     src: "`plain text`" },
    { name: "template — empty",                src: "``" },
    { name: "template — single interpolation", src: "`a${x}b`" },
    { name: "template — leading interp",       src: "`${x} tail`" },
    { name: "template — two interpolations",   src: "`${a} and ${b}`" },
    { name: "template — identifier interp",    src: "`val: ${value}`" },

    // --- composite nesting ---
    { name: "nesting — array of objects",      src: "[{x: 1}, {y: 2}]" },
    { name: "nesting — object with array+obj", src: "{list: [1], meta: {n: 0}}" },
    { name: "nesting — paren in array",        src: "[(1), (2)]" },
];

describe("M2.1 expression-parser conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of ACORN_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // The native parser must report NO diagnostics on a clean
            // primary-expression input.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeToEstree(n.ast));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M2.1 expression-parser conformance — Tier 2 (identifier / literal values)", () => {
    for (const c of ACORN_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeToEstree(n.ast));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M2.2 operator micro-corpus. Every entry is an OPERATOR expression with NO
// scrml extensions and NO call/member forms (M2.3), so raw Acorn parses it and
// the native-vs-Acorn Tier 1+2 diff is meaningful. The corpus is precedence-
// sensitive on purpose: a wrong precedence or associativity produces a
// different tree shape, which the node-kind-sequence (Tier 1) AND the
// operator-position value-sequence (Tier 2) both catch.
//
// Note: `delete` of a bare variable is a strict-mode SyntaxError (modules are
// always strict) — the delete cases use `delete 1` / `delete (1+2)`, which
// Acorn accepts. Member-access delete (`delete a.b`) is M2.3.
// -----------------------------------------------------------------------------
const OPERATOR_CORPUS = [
    // --- arithmetic — precedence + associativity ---
    { name: "add",                              src: "a + b" },
    { name: "subtract",                         src: "a - b" },
    { name: "multiply",                         src: "a * b" },
    { name: "divide",                           src: "a / b" },
    { name: "modulo",                           src: "a % b" },
    { name: "exponent",                         src: "a ** b" },
    { name: "precedence — mul before add",      src: "1 + 2 * 3" },
    { name: "precedence — add before mul (R)",  src: "1 * 2 + 3" },
    { name: "left-assoc — subtraction",         src: "a - b - c" },
    { name: "left-assoc — division",            src: "a / b / c" },
    { name: "right-assoc — exponent",           src: "2 ** 3 ** 2" },
    { name: "exponent binds over multiply",     src: "a * b ** c" },
    { name: "mixed arithmetic chain",           src: "a + b * c - d / e" },

    // --- comparison + equality ---
    { name: "less-than",                        src: "a < b" },
    { name: "less-equal",                       src: "a <= b" },
    { name: "greater-than",                     src: "a > b" },
    { name: "greater-equal",                    src: "a >= b" },
    { name: "loose-equal",                      src: "a == b" },
    { name: "loose-not-equal",                  src: "a != b" },
    { name: "strict-equal",                     src: "a === b" },
    { name: "strict-not-equal",                 src: "a !== b" },
    { name: "comparison binds over equality",   src: "a < b == c" },
    { name: "arithmetic binds over comparison", src: "a + b < c" },

    // --- bitwise + shifts ---
    { name: "bitwise-and",                      src: "a & b" },
    { name: "bitwise-or",                       src: "a | b" },
    { name: "bitwise-xor",                      src: "a ^ b" },
    { name: "shift-left",                       src: "a << b" },
    { name: "shift-right",                      src: "a >> b" },
    { name: "shift-right-unsigned",             src: "a >>> b" },
    { name: "and binds over xor binds over or", src: "a | b ^ c & d" },
    { name: "shift binds over bitwise-and",     src: "a & b << c" },
    { name: "equality binds over bitwise-and",  src: "a & b == c" },

    // --- instanceof / in ---
    { name: "instanceof",                       src: "a instanceof b" },
    { name: "in operator",                      src: "a in b" },
    { name: "instanceof at comparison band",    src: "a instanceof b == c" },

    // --- logical (LogicalExpression node) ---
    { name: "logical-and",                      src: "a && b" },
    { name: "logical-or",                       src: "a || b" },
    { name: "nullish-coalesce",                 src: "a ?? b" },
    { name: "and binds over or",                src: "a && b || c" },
    { name: "or after and (L)",                 src: "a || b && c" },
    { name: "logical binds looser than equal",  src: "a == b && c == d" },
    { name: "nullish chain",                    src: "a ?? b ?? c" },

    // --- unary prefix ---
    { name: "logical-not",                      src: "!a" },
    { name: "negate",                           src: "-a" },
    { name: "unary-plus",                       src: "+a" },
    { name: "bitwise-not",                      src: "~a" },
    { name: "typeof",                           src: "typeof a" },
    { name: "void",                             src: "void a" },
    { name: "delete (non-reference)",           src: "delete 1" },
    { name: "stacked unary",                    src: "!!a" },
    { name: "negate then negate",               src: "- -a" },
    { name: "typeof of a negation",             src: "typeof -a" },
    { name: "unary binds tighter than binary",  src: "-a + b" },
    { name: "not of a comparison",              src: "!a == b" },

    // --- update operators ---
    { name: "prefix increment",                 src: "++a" },
    { name: "prefix decrement",                 src: "--a" },
    { name: "postfix increment",                src: "a++" },
    { name: "postfix decrement",                src: "a--" },
    { name: "postfix update inside arithmetic", src: "a++ + b" },
    { name: "prefix update inside arithmetic",  src: "--a * b" },

    // --- assignment (right-assoc) + compound ---
    { name: "assign",                           src: "a = b" },
    { name: "assign chain (right-assoc)",       src: "a = b = c" },
    { name: "plus-assign",                      src: "a += b" },
    { name: "minus-assign",                     src: "a -= b" },
    { name: "star-assign",                      src: "a *= b" },
    { name: "slash-assign",                     src: "a /= b" },
    { name: "percent-assign",                   src: "a %= b" },
    { name: "exponent-assign",                  src: "a **= b" },
    { name: "shift-left-assign",                src: "a <<= b" },
    { name: "shift-right-assign",               src: "a >>= b" },
    { name: "shift-right-unsigned-assign",      src: "a >>>= b" },
    { name: "bit-and-assign",                   src: "a &= b" },
    { name: "bit-or-assign",                    src: "a |= b" },
    { name: "bit-xor-assign",                   src: "a ^= b" },
    { name: "logical-and-assign",               src: "a &&= b" },
    { name: "logical-or-assign",                src: "a ||= b" },
    { name: "nullish-assign",                   src: "a ??= b" },
    { name: "assign of an arithmetic expr",     src: "a = b + c * d" },
    { name: "compound-assign of an expr",       src: "a += b * c" },

    // --- conditional ternary (right-assoc) ---
    { name: "conditional",                      src: "a ? b : c" },
    { name: "nested ternary in alternate",      src: "a ? b : c ? d : e" },
    { name: "ternary with binary test",         src: "a > b ? c : d" },
    { name: "ternary with binary branches",     src: "a ? b + c : d - e" },
    { name: "ternary inside assignment",        src: "x = a ? b : c" },

    // --- sequence (comma) ---
    { name: "sequence — pair",                  src: "a, b" },
    { name: "sequence — triple",                src: "a, b, c" },
    { name: "sequence of assignments",          src: "a = 1, b = 2" },
    { name: "sequence inside parens",           src: "(a, b, c)" },

    // --- parenthesization overrides precedence ---
    { name: "paren — add before mul",           src: "(a + b) * c" },
    { name: "paren — exponent base",            src: "(a + b) ** c" },
    { name: "paren — nullish with logical",     src: "(a ?? b) || c" },
    { name: "paren — logical with nullish",     src: "(a || b) ?? c" },

    // --- operators interacting with primary composites ---
    { name: "binary inside array element",      src: "[a + b, c * d]" },
    { name: "binary as object value",           src: "{sum: a + b}" },
    { name: "ternary as object value",          src: "{v: a ? b : c}" },
    { name: "binary inside template interp",    src: "`x=${a + b}`" },
    { name: "logical inside template interp",   src: "`${a && b}`" },
];

describe("M2.2 expression-parser conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of OPERATOR_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // A clean operator expression must report NO diagnostics.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeToEstree(n.ast));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M2.2 expression-parser conformance — Tier 2 (values + operator strings)", () => {
    for (const c of OPERATOR_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeToEstree(n.ast));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M2.2 — operator-shape spot-checks against the native AST directly. These
// pin the native node SHAPE (kind, op string, prefix flag, child wiring) —
// the conformance corpus above proves Acorn-equivalence; these prove the
// native enum is built correctly.
// -----------------------------------------------------------------------------
describe("M2.2 expression-parser — operator-node shape (native AST)", () => {
    test("binary node — kind + op + children", () => {
        const n = parseWithNative("a + b");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Binary);
        expect(n.ast.op).toBe("+");
        expect(n.ast.left.kind).toBe(ExprKind.Ident);
        expect(n.ast.right.kind).toBe(ExprKind.Ident);
    });

    test("logical node — && is a Logical, not a Binary", () => {
        const n = parseWithNative("a && b");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Logical);
        expect(n.ast.op).toBe("&&");
    });

    test("nullish node — ?? is a Logical", () => {
        const n = parseWithNative("a ?? b");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Logical);
        expect(n.ast.op).toBe("??");
    });

    test("unary node — prefix flag is true", () => {
        const n = parseWithNative("-a");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Unary);
        expect(n.ast.op).toBe("-");
        expect(n.ast.prefix).toBe(true);
    });

    test("update node — prefix increment", () => {
        const n = parseWithNative("++a");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Update);
        expect(n.ast.op).toBe("++");
        expect(n.ast.prefix).toBe(true);
    });

    test("update node — postfix decrement", () => {
        const n = parseWithNative("a--");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Update);
        expect(n.ast.op).toBe("--");
        expect(n.ast.prefix).toBe(false);
    });

    test("assignment node — compound operator string preserved", () => {
        const n = parseWithNative("a >>>= b");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Assignment);
        expect(n.ast.op).toBe(">>>=");
    });

    test("assignment is right-associative", () => {
        const n = parseWithNative("a = b = c");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Assignment);
        // The right side is itself an assignment (a = (b = c)).
        expect(n.ast.value.kind).toBe(ExprKind.Assignment);
    });

    test("exponent is right-associative", () => {
        const n = parseWithNative("2 ** 3 ** 2");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Binary);
        expect(n.ast.op).toBe("**");
        // The right operand is itself a ** binary (2 ** (3 ** 2)).
        expect(n.ast.right.kind).toBe(ExprKind.Binary);
        expect(n.ast.right.op).toBe("**");
    });

    test("conditional node — test/consequent/alternate", () => {
        const n = parseWithNative("a ? b : c");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Conditional);
        expect(n.ast.test.kind).toBe(ExprKind.Ident);
        expect(n.ast.consequent.kind).toBe(ExprKind.Ident);
        expect(n.ast.alternate.kind).toBe(ExprKind.Ident);
    });

    test("sequence node — flat expressions list", () => {
        const n = parseWithNative("a, b, c");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Sequence);
        expect(n.ast.expressions.length).toBe(3);
    });

    test("array element parses at assignment level — comma separates", () => {
        // The element comma must NOT be swallowed into a Sequence node.
        const n = parseWithNative("[a + b, c]");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Array);
        expect(n.ast.elements.length).toBe(2);
        expect(n.ast.elements[0].expression.kind).toBe(ExprKind.Binary);
    });
});

// -----------------------------------------------------------------------------
// M2.2 — error paths. ECMA-262 forbids two operator combinations the native
// parser must reject (Acorn rejects them too); the parser records a structured
// diagnostic and does NOT throw.
// -----------------------------------------------------------------------------
describe("M2.2 expression-parser — operator error paths (diagnostics, no throw)", () => {
    test("unary directly before ** records E-EXPR-UNARY-EXPONENT", () => {
        // `-2 ** 2` is a SyntaxError in JS — the unary operand of ** must be
        // parenthesized. Acorn rejects it; the native parser records the fault.
        const n = parseWithNative("-2 ** 2");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNARY-EXPONENT");
    });

    test("typeof directly before ** records E-EXPR-UNARY-EXPONENT", () => {
        const n = parseWithNative("typeof a ** b");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNARY-EXPONENT");
    });

    test("parenthesized unary operand of ** is accepted (no diagnostic)", () => {
        // `(-2) ** 2` is valid — the parens remove the ambiguity.
        const n = parseWithNative("(-2) ** 2");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
    });

    test("mixing ?? with || records E-EXPR-NULLISH-MIX", () => {
        // `a ?? b || c` is a SyntaxError in JS — ?? cannot be combined with
        // && / || without parentheses. Acorn rejects it.
        const n = parseWithNative("a ?? b || c");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-NULLISH-MIX");
    });

    test("mixing && with ?? records E-EXPR-NULLISH-MIX", () => {
        const n = parseWithNative("a && b ?? c");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-NULLISH-MIX");
    });

    test("parenthesized ?? next to || is accepted (no diagnostic)", () => {
        const n = parseWithNative("(a ?? b) || c");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
    });
});

// -----------------------------------------------------------------------------
// M2.3 call / member / postfix / arrow-head corpus. Every entry is a call /
// member / computed-member / optional-chain / `new` / tagged-template /
// arrow-head form with NO scrml extensions, so raw Acorn parses it and the
// native-vs-Acorn Tier 1+2 diff is meaningful. Arrow / function block-body
// cases use EMPTY blocks so the BlockStub-projected BlockStatement matches
// Acorn's empty BlockStatement (M3 parses non-empty statement bodies — those
// are exercised native-only further below).
// -----------------------------------------------------------------------------
const CALL_MEMBER_CORPUS = [
    // --- call expressions ---
    { name: "call — no args",                   src: "f()" },
    { name: "call — one arg",                   src: "f(1)" },
    { name: "call — many args",                 src: "f(a, b, c)" },
    { name: "call — expression args",           src: "f(a + b, c * d)" },
    { name: "call — spread arg",                src: "f(...xs)" },
    { name: "call — spread among args",         src: "f(a, ...rest, z)" },
    { name: "call — nested call arg",           src: "f(g(x))" },
    { name: "call — chained calls",             src: "f()()" },
    { name: "call — trailing comma",            src: "f(a, b,)" },

    // --- member access — dot ---
    { name: "member — single dot",              src: "a.b" },
    { name: "member — dot chain",               src: "a.b.c.d" },
    { name: "member — keyword property",        src: "obj.default" },
    { name: "member — property named if",       src: "obj.if" },

    // --- member access — computed ---
    { name: "computed — numeric index",         src: "a[0]" },
    { name: "computed — identifier index",      src: "a[i]" },
    { name: "computed — expression index",      src: "a[i + 1]" },
    { name: "computed — string index",          src: 'a["key"]' },
    { name: "computed — nested computed",       src: "a[b[c]]" },
    { name: "computed — chained computed",      src: "a[0][1]" },

    // --- mixed member + call chains ---
    { name: "chain — method call",              src: "obj.method()" },
    { name: "chain — call then member",         src: "f().result" },
    { name: "chain — fluent",                   src: "obj.a().b().c()" },
    { name: "chain — computed then call",       src: "a[k]()" },
    { name: "chain — call then computed",       src: "f()[0]" },
    { name: "chain — member then computed",     src: "a.b[c].d" },

    // --- optional chaining ---
    { name: "optional — member",                src: "a?.b" },
    { name: "optional — computed",              src: "a?.[0]" },
    { name: "optional — call",                  src: "a?.()" },
    { name: "optional — member chain",          src: "a?.b?.c" },
    { name: "optional — then plain member",     src: "a?.b.c" },
    { name: "optional — plain then optional",   src: "a.b?.c" },
    { name: "optional — method call",           src: "obj?.method()" },
    { name: "optional — call then member",      src: "f?.().x" },

    // --- new expressions ---
    { name: "new — no args",                    src: "new Foo()" },
    { name: "new — with args",                  src: "new Foo(1, 2)" },
    { name: "new — no parens",                  src: "new Foo" },
    { name: "new — member callee",              src: "new a.b.C()" },
    { name: "new — nested new",                 src: "new new X()" },
    { name: "new — then member",                src: "new Foo().bar" },
    { name: "new — then call",                  src: "new Foo()()" },
    { name: "new — spread arg",                 src: "new Foo(...args)" },

    // --- tagged templates ---
    { name: "tagged — plain",                   src: "tag`hello`" },
    { name: "tagged — interpolation",           src: "tag`a${x}b`" },
    { name: "tagged — member tag",              src: "obj.tag`x`" },

    // --- this / super ---
    { name: "this — bare",                      src: "this" },
    { name: "this — member",                    src: "this.value" },
    { name: "this — method call",               src: "this.run()" },

    // --- arrow functions — concise body (fully parsed) ---
    { name: "arrow — single param",             src: "x => x" },
    { name: "arrow — concise expr body",        src: "x => x + 1" },
    { name: "arrow — no params",                src: "() => 1" },
    { name: "arrow — two params",               src: "(a, b) => a + b" },
    { name: "arrow — paren single param",       src: "(x) => x" },
    { name: "arrow — default param",            src: "(a = 1) => a" },
    { name: "arrow — rest param",               src: "(...rest) => rest" },
    { name: "arrow — concise call body",        src: "x => f(x)" },
    { name: "arrow — concise ternary body",     src: "x => x ? 1 : 2" },
    { name: "arrow — returns object (paren)",   src: "x => ({ v: x })" },

    // --- arrow functions — empty block body ---
    { name: "arrow — empty block body",         src: "() => {}" },
    { name: "arrow — param + empty block",      src: "(a) => {}" },

    // --- async arrows / async function expr (M4.3 RETRACTED — no longer in
    // the conformance corpus; their parse fires E-ASYNC-NOT-IN-SCRML, see
    // the dedicated describe block below) ---

    // --- function expressions — empty block body ---
    { name: "function expr — anonymous",        src: "function () {}" },
    { name: "function expr — named",            src: "function f() {}" },
    { name: "function expr — params",           src: "function f(a, b) {}" },

    // --- call / member interacting with operators + composites ---
    { name: "member in binary",                 src: "a.b + c.d" },
    { name: "call in binary",                   src: "f() * g()" },
    { name: "member in array",                  src: "[a.b, c.d]" },
    { name: "call as object value",             src: "{ result: f() }" },
    { name: "postfix update on member",         src: "a.b++" },
    { name: "prefix update on member",          src: "++a.b" },
    { name: "typeof of a call",                 src: "typeof f()" },
    { name: "delete of a member",               src: "delete a.b" },
    { name: "call in template interp",          src: "`v=${f(x)}`" },
    { name: "arrow as call argument",           src: "f(x => x)" },
];

describe("M2.3 expression-parser conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of CALL_MEMBER_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // A clean call / member / arrow input must report NO diagnostics.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeToEstree(n.ast));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M2.3 expression-parser conformance — Tier 2 (values + flags)", () => {
    for (const c of CALL_MEMBER_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeToEstree(n.ast));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M2.3 — call / member / arrow node-shape spot-checks against the native AST
// directly. The conformance corpus proves Acorn-equivalence; these pin the
// native enum SHAPE (kind, optional flag, child wiring, BlockStub seam).
// -----------------------------------------------------------------------------
describe("M2.3 expression-parser — call/member/arrow node shape (native AST)", () => {
    test("call node — kind + callee + args", () => {
        const n = parseWithNative("f(1, 2)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.optional).toBe(false);
        expect(n.ast.callee.kind).toBe(ExprKind.Ident);
        expect(n.ast.args.length).toBe(2);
    });

    test("member node — non-computed, property is an Ident", () => {
        const n = parseWithNative("a.b");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.computed).toBe(false);
        expect(n.ast.optional).toBe(false);
        expect(n.ast.property.kind).toBe(ExprKind.Ident);
        expect(n.ast.property.name).toBe("b");
    });

    test("computed member node — computed flag true", () => {
        const n = parseWithNative("a[i]");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.computed).toBe(true);
        expect(n.ast.property.kind).toBe(ExprKind.Ident);
    });

    test("optional member node — optional flag true", () => {
        const n = parseWithNative("a?.b");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.optional).toBe(true);
        expect(n.ast.property.name).toBe("b");
    });

    test("optional call node — optional flag true", () => {
        const n = parseWithNative("f?.()");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.optional).toBe(true);
    });

    test("new node — callee + args", () => {
        const n = parseWithNative("new Foo(1)");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.New);
        expect(n.ast.callee.kind).toBe(ExprKind.Ident);
        expect(n.ast.args.length).toBe(1);
    });

    test("new without parens — empty args", () => {
        const n = parseWithNative("new Foo");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.New);
        expect(n.ast.args.length).toBe(0);
    });

    test("tagged template node — tag + quasi", () => {
        const n = parseWithNative("tag`hi`");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.TaggedTemplate);
        expect(n.ast.tag.kind).toBe(ExprKind.Ident);
        expect(n.ast.quasi.kind).toBe(ExprKind.TemplateLit);
    });

    test("call chain is left-associative", () => {
        // a.b() -> Call( callee = Member(a.b) ).
        const n = parseWithNative("a.b()");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.kind).toBe(ExprKind.Member);
        expect(n.ast.callee.object.kind).toBe(ExprKind.Ident);
    });

    test("arrow node — concise body is an Expr", () => {
        const n = parseWithNative("x => x + 1");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Arrow);
        expect(n.ast.isAsync).toBe(false);
        expect(n.ast.params.length).toBe(1);
        expect(n.ast.params[0].kind).toBe(ExprKind.Ident);
        // The concise body is a normal expression node — NOT a BlockStub.
        expect(n.ast.body.kind).toBe(ExprKind.Binary);
    });

    test("arrow node — block body is a BlockStub (M3 seam)", () => {
        const n = parseWithNative("(a) => { return a + 1 }");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Arrow);
        // The block body is captured as a BlockStub — M2.3 does NOT parse
        // the statements; the stub carries the body's token range for M3.
        expect(n.ast.body.kind).toBe(ExprKind.BlockStub);
        expect(n.ast.body.tokenEnd).toBeGreaterThan(n.ast.body.tokenStart);
        expect(Array.isArray(n.ast.body.tokens)).toBe(true);
        expect(n.ast.body.tokens.length).toBeGreaterThan(0);
    });

    test("`async x => x` fires E-ASYNC-NOT-IN-SCRML; recovery keeps isAsync false (M4.3)", () => {
        const n = parseWithNative("async x => x");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        // RECOVERY — the arrow still parses (so the rest of the program is
        // diagnosable); the `async` flag is forced false (M4.3 retraction).
        expect(n.ast.kind).toBe(ExprKind.Arrow);
        expect(n.ast.isAsync).toBe(false);
    });

    test("function expression node — name + params + BlockStub body", () => {
        const n = parseWithNative("function f(a, b) {}");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Function);
        expect(n.ast.name).toBe("f");
        expect(n.ast.params.length).toBe(2);
        expect(n.ast.body.kind).toBe(ExprKind.BlockStub);
    });

    test("anonymous function expression — name is not (absent)", () => {
        const n = parseWithNative("function () {}");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.Function);
        // scrml has no null/undefined — an absent name is `not`, which the
        // JS-host shadow surfaces as the constructor's `null` argument.
        expect(n.ast.name == null).toBe(true);
    });

    test("rest parameter — RestElement binding node (M4.2 K6)", () => {
        const n = parseWithNative("(...rest) => rest");
        expect(n.ok).toBe(true);
        // M4.2 — function-param RestElement is now a BINDING-shape node
        // (`bindingKind: "RestElement"`), and its argument is a BindingIdent.
        expect(n.ast.params[0].bindingKind).toBe("RestElement");
        expect(n.ast.params[0].argument.bindingKind).toBe(BindingKind.Ident);
    });

    test("default parameter — AssignmentPattern binding node (M4.2 K6)", () => {
        const n = parseWithNative("(a = 1) => a");
        expect(n.ok).toBe(true);
        // M4.2 — function-param AssignmentPattern is now a BINDING-shape node
        // (`bindingKind: "AssignmentPattern"`); its `left` is a BindingIdent;
        // its `right` is still an Expr (the default-value expression).
        expect(n.ast.params[0].bindingKind).toBe("AssignmentPattern");
        expect(n.ast.params[0].left.bindingKind).toBe(BindingKind.Ident);
        expect(n.ast.params[0].right.kind).toBe(ExprKind.NumberLit);
    });

    test("object method — Method property with a Function value", () => {
        const n = parseWithNative("{ run() {} }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.properties[0].kind).toBe(ObjectPropertyKind.Method);
        expect(n.ast.properties[0].methodKind).toBe("init");
        expect(n.ast.properties[0].value.kind).toBe(ExprKind.Function);
    });

    test("object getter — methodKind is 'get'", () => {
        const n = parseWithNative("{ get x() {} }");
        expect(n.ok).toBe(true);
        expect(n.ast.properties[0].kind).toBe(ObjectPropertyKind.Method);
        expect(n.ast.properties[0].methodKind).toBe("get");
    });

    test("this atom — This node", () => {
        const n = parseWithNative("this");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.This);
    });
});

// -----------------------------------------------------------------------------
// M2.3 — the optional-chaining carve-out: a chain with ANY `?.` link projects
// to a SINGLE outer ESTree ChainExpression (Acorn equivalence). These pin that
// the conformance normalizer + the native `optional` flags reproduce it.
// -----------------------------------------------------------------------------
describe("M2.3 expression-parser — optional-chain ChainExpression wrapping", () => {
    const chainCases = [
        "a?.b", "a?.b.c", "a.b?.c", "a?.b?.c", "a?.()", "a?.[0]", "f?.().x",
    ];
    for (const src of chainCases) {
        test(`chain wraps once vs Acorn — ${src}`, () => {
            const a = parseWithAcorn(src);
            const n = parseWithNative(src);
            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeToEstree(n.ast));
            // Acorn emits exactly one ChainExpression for a chain with a `?.`.
            expect(acornSeq.filter((t) => t === "ChainExpression").length).toBe(1);
            expect(nativeSeq).toEqual(acornSeq);
        });
    }

    test("a non-optional chain produces NO ChainExpression", () => {
        const n = parseWithNative("a.b.c()");
        const seq = nodeKindSequence(nativeToEstree(n.ast));
        expect(seq).not.toContain("ChainExpression");
    });
});

// -----------------------------------------------------------------------------
// M2.3 — block-body arrow / function expressions with NON-EMPTY bodies. The
// body is a BlockStub (M3's statement parser fills it). These are native-only
// (Acorn parses the statements; M2.3 does not — the BlockStub is the seam) and
// verify the head parses cleanly and the stub captures the body token range.
// -----------------------------------------------------------------------------
describe("M2.3 expression-parser — block-body stub (M3 seam, native-only)", () => {
    const blockBodyCases = [
        { name: "arrow with return statement",      src: "x => { return x }" },
        { name: "arrow with multiple statements",   src: "(a) => { let b = a; return b }" },
        { name: "function expr with body",          src: "function f() { return 1 }" },
        { name: "arrow body with nested object",    src: "() => { return { a: 1 } }" },
        { name: "arrow body with nested block",     src: "() => { if (x) { return 1 } }" },
    ];
    for (const c of blockBodyCases) {
        test(`head parses, body stubbed — ${c.name}`, () => {
            const n = parseWithNative(c.src);
            expect(n.ok).toBe(true);
            expect(n.errors).toEqual([]);
            const fnNode = n.ast;
            expect(fnNode.kind === ExprKind.Arrow || fnNode.kind === ExprKind.Function).toBe(true);
            // The body is a BlockStub — M2.3 does NOT parse the statements.
            expect(fnNode.body.kind).toBe(ExprKind.BlockStub);
            // The stub captures the body's token range + raw token slice.
            expect(fnNode.body.tokenEnd).toBeGreaterThanOrEqual(fnNode.body.tokenStart);
            expect(Array.isArray(fnNode.body.tokens)).toBe(true);
            // The stub's token slice length matches its declared range.
            expect(fnNode.body.tokens.length).toBe(fnNode.body.tokenEnd - fnNode.body.tokenStart);
        });
    }

    test("nested-object braces inside a block body do not truncate the stub", () => {
        // The `{ a: 1 }` inside the body has its own LBrace/RBrace pair; the
        // stub's brace counter must net them to zero and capture the whole
        // body up to the function's own closing brace.
        const n = parseWithNative("() => { return { a: { b: 1 } } }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.body.kind).toBe(ExprKind.BlockStub);
        // The body's last token is the inner `}` of `{ b: 1 }` ... `}` `}` —
        // the stub must include every interior token.
        const lastTok = n.ast.body.tokens[n.ast.body.tokens.length - 1];
        expect(lastTok).toBeDefined();
    });
});

// -----------------------------------------------------------------------------
// M2.3 — error paths. Malformed call / member / arrow forms record a
// structured diagnostic and do NOT throw.
// -----------------------------------------------------------------------------
describe("M2.3 expression-parser — error paths (diagnostics, no throw)", () => {
    test("unclosed call argument list records E-EXPR-UNCLOSED-PAREN", () => {
        const n = parseWithNative("f(1, 2");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-PAREN");
    });

    test("unclosed computed member records E-EXPR-UNCLOSED-BRACKET", () => {
        const n = parseWithNative("a[0");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-BRACKET");
    });

    test("member access with no property name records E-EXPR-MEMBER-NAME", () => {
        const n = parseWithNative("a.");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-MEMBER-NAME");
    });

    test("unclosed block body records E-EXPR-UNCLOSED-BLOCK", () => {
        const n = parseWithNative("() => { return 1");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-BLOCK");
    });
});

// -----------------------------------------------------------------------------
// Native-only primary-expression cases — scrml extensions M1 LEXES and M2.1
// builds AST nodes for, but which Acorn has no equivalent for (DD §D6
// documented divergence). Exercised against the native parser directly.
// -----------------------------------------------------------------------------
describe("M2.1 expression-parser — scrml-extension primaries (native-only)", () => {
    test("@-cell — @count", () => {
        const n = parseWithNative("@count");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.AtCell);
        expect(n.ast.name).toBe("count");
    });

    test("@-cell — @userProfile", () => {
        const n = parseWithNative("@userProfile");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.AtCell);
        expect(n.ast.name).toBe("userProfile");
    });

    test("bare variant — .Big", () => {
        const n = parseWithNative(".Big");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.name).toBe("Big");
    });

    test("bare variant — .Loading", () => {
        const n = parseWithNative(".Loading");
        expect(n.ok).toBe(true);
        expect(n.ast.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.name).toBe("Loading");
    });

    test("@-cell inside an array literal", () => {
        const n = parseWithNative("[@a, @b]");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Array);
        expect(n.ast.elements.length).toBe(2);
        expect(n.ast.elements[0].expression.kind).toBe(ExprKind.AtCell);
        expect(n.ast.elements[1].expression.kind).toBe(ExprKind.AtCell);
    });

    test("bare variant as an object-property value", () => {
        const n = parseWithNative("{state: .Idle}");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Object);
        expect(n.ast.properties[0].value.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.properties[0].value.name).toBe("Idle");
    });
});

// -----------------------------------------------------------------------------
// Span-preservation spot-checks (DD §D6 Tier 3 — "SHOULD match"). The native
// parser carries a Span on every node; verify the outer-node span covers the
// whole source for a few representative shapes.
// -----------------------------------------------------------------------------
describe("M2.1 expression-parser — span preservation (Tier 3 spot-check)", () => {
    const spanCases = [
        { src: "42" },
        { src: "[1, 2, 3]" },
        { src: "{a: 1}" },
        { src: "(foo)" },
        { src: "`a${x}b`" },
    ];
    for (const c of spanCases) {
        test(`(tier3) outer span covers source — ${c.src}`, () => {
            const n = parseWithNative(c.src);
            expect(n.ok).toBe(true);
            expect(n.ast).toBeDefined();
            expect(n.ast.span).toBeDefined();
            // Every primary-expression node's span covers its full source
            // extent — start at offset 0, end at source.length. (The
            // template literal's start backs up to its opening backtick in
            // parseTemplateLiteral, since M1 absorbs that backtick into the
            // first chunk; see that function's comment.)
            expect(n.ast.span.start).toBe(0);
            expect(n.ast.span.end).toBe(c.src.length);
        });
    }
});

// -----------------------------------------------------------------------------
// Error-path checks — malformed primary expressions must record a structured
// diagnostic (and NOT throw). M2.1 records the fault + stops; M3's
// error-recovery engine adds skipped-token accumulation + re-sync.
// -----------------------------------------------------------------------------
describe("M2.1 expression-parser — error paths (diagnostics, no throw)", () => {
    test("unclosed paren records E-EXPR-UNCLOSED-PAREN", () => {
        const n = parseWithNative("(1");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-PAREN");
    });

    test("unclosed array records E-EXPR-UNCLOSED-BRACKET", () => {
        const n = parseWithNative("[1, 2");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-BRACKET");
    });

    test("unclosed object records E-EXPR-UNCLOSED-BRACE", () => {
        const n = parseWithNative("{a: 1");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNCLOSED-BRACE");
    });

    test("empty input records E-EXPR-UNEXPECTED (EOF in expr position)", () => {
        const n = parseWithNative("");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-UNEXPECTED");
    });

    test("object methods now parse (M2.3 lifts the M2.2 deferral)", () => {
        // M2.2 recorded E-EXPR-OBJECT-METHOD-UNSUPPORTED for the method
        // shape; M2.3 parses object methods (function head + block-stub
        // body). A complete method now parses with no diagnostic.
        const n = parseWithNative("{ foo() {} }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Object);
        expect(n.ast.properties[0].kind).toBe(ObjectPropertyKind.Method);
        // The deferral diagnostic is retired — no code path emits it.
        const codes = n.errors.map((e) => e.code);
        expect(codes).not.toContain("E-EXPR-OBJECT-METHOD-UNSUPPORTED");
    });
});

// =============================================================================
// M2.4 — scrml-extension expression forms (D5 MUST ADD).
//
// These forms are scrml-language extensions stock Acorn cannot parse — they are
// exactly the forms the legacy `preprocessForAcorn` regex cascade rewrites into
// JS placeholders before handing the string to Acorn. The native parser parses
// them DIRECTLY. Acorn cannot oracle these (per DD §D6 — scrml extensions are
// documented intentional divergences); the SPEC is the oracle. The tests below
// are therefore native-only structural assertions.
// =============================================================================

// -----------------------------------------------------------------------------
// M2 GATING CRITERION — one regression test per `preprocessForAcorn` Acorn-
// workaround class. Each test proves the native parser handles the form
// DIRECTLY, where the legacy Acorn preprocessor had to rewrite it into a
// placeholder (and, per the class's documented failure mode, sometimes mangled
// it). `compiler/src/expression-parser.ts` `preprocessForAcorn` +
// `replaceSqlBlockPlaceholder` + the `<#id>` rewrites enumerate the 9 classes.
// -----------------------------------------------------------------------------
describe("M2.4 — preprocessForAcorn workaround-class elimination (M2 gating)", () => {
    // Class 1 — `::` -> `.` rewrite. Failure mode: the scrmlEnumPlugin emits a
    // STRING token for `::Variant` AFTER the enum-type IDENT, and Acorn
    // silently drops the trailing STRING (no operator between them) — wrong
    // codegen for `MarioState::Small`. The native parser parses `::` directly.
    test("class 1 — `::` qualified variant: no STRING-token drop", () => {
        const n = parseWithNative("MarioState::Small");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        // A structured Member node — NOT a bare `MarioState` Ident with the
        // `Small` silently dropped (the documented Acorn failure).
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.object.kind).toBe(ExprKind.Ident);
        expect(n.ast.object.name).toBe("MarioState");
        expect(n.ast.property.kind).toBe(ExprKind.Ident);
        expect(n.ast.property.name).toBe("Small");
    });

    // Class 2 — `match expr { arms }` -> `__scrml_match__()` placeholder.
    // The native parser parses `match` into a structured Match node.
    test("class 2 — `match expr {}`: structured Match node, no placeholder", () => {
        const n = parseWithNative("match @state { .Loading => 1, .Ready => 2, else => 0 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(3);
        // Not a Call to a `__scrml_match__` placeholder identifier.
        expect(n.ast.kind).not.toBe(ExprKind.Call);
    });

    // Class 3 — `rewriteIsPredicates`. Failure mode (Phase A): the brittle
    // multi-pass regex produced INVALID JS on nested parens inside a tail
    // segment — `re.exec(str.trim()) is some` became
    // `re.exec(str.trim()).__scrml_is_some_suffix__`. The native parser parses
    // `is` directly with a structural left operand — no regex, no mangling.
    test("class 3 — `is` predicate on a nested-paren call LHS: no mangling", () => {
        const n = parseWithNative("re.exec(str.trim()) is some");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Some);
        // The LHS is the full Call node `re.exec(str.trim())` — intact.
        expect(n.ast.operand.kind).toBe(ExprKind.Call);
        expect(n.ast.operand.callee.kind).toBe(ExprKind.Member);
    });

    // Class 4 — bare-dot `.Variant` -> `__scrml_bare_variant_*__` placeholder.
    // Acorn cannot parse `.Idle` as a primary (it expects an object before
    // the dot). The native parser lexes + parses it as a BareVariant atom.
    test("class 4 — bare `.Variant` primary: BareVariant node, no placeholder", () => {
        const n = parseWithNative(".Idle");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.name).toBe("Idle");
    });

    // Class 5 — `not (expr)` / `not @x` -> `!`-rewrite. Failure mode: Acorn
    // parses `not @x` as Identifier `not` followed by a dropped operand. The
    // native parser parses `not` as the absence-VALUE atom (§42.10 — `not` is
    // NOT a prefix operator; `not (expr)` is E-TYPE-045, a typer concern).
    // The native parser does NOT silently rewrite `not` to `!`.
    test("class 5 — `not` value atom: NotValue node, not a `!`-rewrite", () => {
        const n = parseWithNative("not");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.NotValue);
        // `not` is NOT a UnaryExpression — the legacy `!`-rewrite is gone.
        expect(n.ast.kind).not.toBe(ExprKind.Unary);
    });

    // Class 6 — `render name()` -> `__scrml_render_*__()` placeholder.
    // The native parser parses `render` into a structured Render node.
    test("class 6 — `render name()`: Render node, no placeholder identifier", () => {
        const n = parseWithNative("render footer()");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Render);
        expect(n.ast.name).toBe("footer");
    });

    // Class 7 — `~` -> `__scrml_tilde__` placeholder. The native parser
    // parses a standalone `~` as the Tilde accumulator atom.
    test("class 7 — `~` accumulator: Tilde node, no placeholder identifier", () => {
        const n = parseWithNative("process(~)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.args.length).toBe(1);
        expect(n.ast.args[0].kind).toBe(ExprKind.Tilde);
    });

    // Class 8 — `?{sql}` -> `replaceSqlBlockPlaceholder` bracket-matched scan
    // (F-SQL-001). The native parser captures the `?{...}` block as a Sql atom
    // carrying its raw text; the chained `.all()` is the ordinary postfix
    // chain — no placeholder.
    test("class 8 — `?{sql}` block + chain: Sql node, no placeholder", () => {
        const n = parseWithNative("?{`SELECT id FROM users WHERE n = ${name}`}.all()");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        // The outer node is a Call (`.all()`) on a Member on the Sql block.
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.kind).toBe(ExprKind.Member);
        expect(n.ast.callee.object.kind).toBe(ExprKind.Sql);
        expect(n.ast.callee.object.raw).toContain("SELECT id FROM users");
    });

    // Class 9 — `<#id>` / `<#id>.send()` -> `__scrml_input_*__` /
    // `__scrml_worker_*__` rewrite. Acorn cannot parse `<#id>`. The native
    // parser re-composes the `< # ident >` token run into an InputStateRef
    // atom; the chained member/call is the ordinary postfix chain.
    test("class 9 — `<#id>` input-state ref + chain: InputStateRef, no placeholder", () => {
        const n = parseWithNative("<#keys>.pressed(\"Space\")");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.kind).toBe(ExprKind.Member);
        expect(n.ast.callee.object.kind).toBe(ExprKind.InputStateRef);
        expect(n.ast.callee.object.id).toBe("keys");
    });

    // `<#id>.send()` — the worker-ref shape (the legacy
    // `__scrml_worker_*__.send(` rewrite). Same InputStateRef recomposition.
    test("class 9b — `<#id>.send()` worker ref: InputStateRef base", () => {
        const n = parseWithNative("<#heavyCompute>.send([1, 2, 3])");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.object.kind).toBe(ExprKind.InputStateRef);
        expect(n.ast.callee.object.id).toBe("heavyCompute");
    });
});

// -----------------------------------------------------------------------------
// M2.4 — `is` predicate family node shape (§42 / §18.17, native-only).
// -----------------------------------------------------------------------------
describe("M2.4 expression-parser — `is` predicate node shape (native-only)", () => {
    test("`is not` — absence check (§42.2.2)", () => {
        const n = parseWithNative("@name is not");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Not);
        expect(n.ast.operand.kind).toBe(ExprKind.AtCell);
        expect(n.ast.variant).toBeNull();
    });

    test("`is some` — presence check (§42.2.2a)", () => {
        const n = parseWithNative("@name is some");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Some);
    });

    test("`is given` — presence alias of `is some` (§42.2.4)", () => {
        const n = parseWithNative("(getUser(id)) is given");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Given);
        // The LHS is the parenthesized call.
        expect(n.ast.operand.kind).toBe(ExprKind.Paren);
    });

    test("`is not not` — double-negative presence (§42.2.4 / §42.8)", () => {
        const n = parseWithNative("@x is not not");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.NotNot);
    });

    test("`is .Variant` — single-variant check (§18.17)", () => {
        const n = parseWithNative("@filter is .Active");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Variant);
        expect(n.ast.variant.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.variant.name).toBe("Active");
    });

    test("`is Type.Variant` — qualified single-variant check (§18.13)", () => {
        const n = parseWithNative("@filter is FilterMode.Active");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.op).toBe(IsCheckOp.Variant);
        // The qualified variant is a Member node.
        expect(n.ast.variant.kind).toBe(ExprKind.Member);
        expect(n.ast.variant.object.name).toBe("FilterMode");
        expect(n.ast.variant.property.name).toBe("Active");
    });

    test("`is Type::Variant` — qualified variant via the `::` alias (§14.4)", () => {
        const n = parseWithNative("@filter is FilterMode::Active");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.variant.kind).toBe(ExprKind.Member);
        expect(n.ast.variant.property.name).toBe("Active");
    });

    test("`is` binds tighter than `&&` — `a is .X && b is .Y` is `(..) && (..)`", () => {
        // The legacy `rewriteIsPredicates` LHS scan stops at `&&` — `is` binds
        // tighter. The result is a Logical && of two IsCheck nodes.
        const n = parseWithNative("@a is .Big && @b is .Small");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Logical);
        expect(n.ast.op).toBe("&&");
        expect(n.ast.left.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.right.kind).toBe(ExprKind.IsCheck);
    });

    test("`is` binds tighter than `||` — `a || b is some` is `a || (b is some)`", () => {
        const n = parseWithNative("@a || @b is some");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Logical);
        expect(n.ast.op).toBe("||");
        expect(n.ast.left.kind).toBe(ExprKind.AtCell);
        // The `is some` wraps only `@b`, not the whole `@a || @b`.
        expect(n.ast.right.kind).toBe(ExprKind.IsCheck);
        expect(n.ast.right.operand.kind).toBe(ExprKind.AtCell);
    });

    test("`is` is usable as a ternary test — `(@x is .A) ? 1 : 2`", () => {
        const n = parseWithNative("@x is .A ? 1 : 2");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Conditional);
        expect(n.ast.test.kind).toBe(ExprKind.IsCheck);
    });
});

// -----------------------------------------------------------------------------
// M2.4 — `match expr { arms }` JS-style value form node shape (§18, native).
// -----------------------------------------------------------------------------
describe("M2.4 expression-parser — `match` node shape (native-only)", () => {
    test("match — subject + arm count + unit-variant arms (§18.2)", () => {
        const n = parseWithNative("match direction { .North => 1, .South => 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.subject.kind).toBe(ExprKind.Ident);
        expect(n.ast.subject.name).toBe("direction");
        expect(n.ast.arms.length).toBe(2);
        expect(n.ast.arms[0].pattern.patternKind).toBe(MatchArmPatternKind.Variant);
        expect(n.ast.arms[0].pattern.variantName).toBe("North");
        expect(n.ast.arms[0].pattern.typeName).toBeNull();
    });

    test("match — payload positional binding `.Circle(r)` (§18.7)", () => {
        const n = parseWithNative("match shape { .Circle(r) => r, .Point => 0 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        const arm0 = n.ast.arms[0];
        expect(arm0.pattern.variantName).toBe("Circle");
        expect(arm0.pattern.bindings.length).toBe(1);
        expect(arm0.pattern.bindings[0].fieldName).toBeNull();   // positional
        expect(arm0.pattern.bindings[0].local).toBe("r");
        // The arm with no payload carries `null` bindings (no `( ... )`).
        expect(n.ast.arms[1].pattern.bindings).toBeNull();
    });

    test("match — payload named binding `.Rectangle(width: w)` (§18.7)", () => {
        const n = parseWithNative("match s { .Rectangle(width: w, height: h) => w }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        const b = n.ast.arms[0].pattern.bindings;
        expect(b.length).toBe(2);
        expect(b[0].fieldName).toBe("width");
        expect(b[0].local).toBe("w");
        expect(b[1].fieldName).toBe("height");
        expect(b[1].local).toBe("h");
    });

    test("match — `else` wildcard arm (§18.6)", () => {
        const n = parseWithNative("match s { .A => 1, else => 0 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        const last = n.ast.arms[n.ast.arms.length - 1];
        expect(last.pattern.patternKind).toBe(MatchArmPatternKind.Wildcard);
        expect(last.pattern.keyword).toBe("else");
    });

    test("match — `_` wildcard alias (§18.6)", () => {
        const n = parseWithNative("match s { .A => 1, _ => 0 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        const last = n.ast.arms[n.ast.arms.length - 1];
        expect(last.pattern.patternKind).toBe(MatchArmPatternKind.Wildcard);
        expect(last.pattern.keyword).toBe("_");
    });

    test("match — `->` arm separator alias (§18.2)", () => {
        const n = parseWithNative("match s { .A -> 1, .B -> 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms[0].separator).toBe("->");
        expect(n.ast.arms[1].separator).toBe("->");
    });

    test("match — qualified variant arm `Type.Variant` (§18.2)", () => {
        const n = parseWithNative("match s { Tab.Overview => 1, Tab::Activity => 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms[0].pattern.typeName).toBe("Tab");
        expect(n.ast.arms[0].pattern.variantName).toBe("Overview");
        expect(n.ast.arms[1].pattern.typeName).toBe("Tab");
        expect(n.ast.arms[1].pattern.variantName).toBe("Activity");
    });

    test("match — block arm body is a BlockStub (the M3 seam, §18.5)", () => {
        // A `{ ... }` arm body forward-references M3's statement parser; M2.4
        // captures it as a BlockStub. The concise arm body parses fully.
        const n = parseWithNative("match s { .A => { let x = 1 }, .B => 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms[0].body.kind).toBe(ExprKind.BlockStub);
        expect(n.ast.arms[1].body.kind).toBe(ExprKind.NumberLit);
    });

    test("match — `is .Variant` is-pattern arm (§18.17)", () => {
        const n = parseWithNative("match s { is .Ready => 1, else => 0 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms[0].pattern.patternKind).toBe(MatchArmPatternKind.Is);
        expect(n.ast.arms[0].pattern.variantName).toBe("Ready");
    });
});

// -----------------------------------------------------------------------------
// M2.4 — keyword-headed forms: `render` / `lift` / `fail` node shape (native).
// -----------------------------------------------------------------------------
describe("M2.4 expression-parser — render / lift / fail node shape (native-only)", () => {
    test("render — zero-parameter snippet invocation (§14.9)", () => {
        const n = parseWithNative("render header()");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Render);
        expect(n.ast.name).toBe("header");
        expect(n.ast.args.length).toBe(0);
    });

    test("render — parametric snippet invocation (§14.9)", () => {
        const n = parseWithNative("render row(item, index)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Render);
        expect(n.ast.name).toBe("row");
        expect(n.ast.args.length).toBe(2);
    });

    test("lift — value-lift of a scalar expression (§10)", () => {
        const n = parseWithNative("lift computeTotal(items)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Lift);
        expect(n.ast.argument.kind).toBe(ExprKind.Call);
    });

    test("lift — lifting the `~` accumulator (§10 / §32)", () => {
        const n = parseWithNative("lift ~");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Lift);
        expect(n.ast.argument.kind).toBe(ExprKind.Tilde);
    });

    test("fail — error variant with a payload (§19.3)", () => {
        const n = parseWithNative('fail PaymentError::InvalidAmount("must be positive")');
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Fail);
        // The variant carries a payload — a Call wrapping the variant Member.
        expect(n.ast.variant.kind).toBe(ExprKind.Call);
        expect(n.ast.variant.callee.kind).toBe(ExprKind.Member);
        expect(n.ast.variant.callee.object.name).toBe("PaymentError");
        expect(n.ast.variant.callee.property.name).toBe("InvalidAmount");
        expect(n.ast.variant.args.length).toBe(1);
    });

    test("fail — unit error variant, no payload (§19.3)", () => {
        const n = parseWithNative("fail PaymentError::ExpiredCard");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Fail);
        // No payload — the variant is the bare Member node.
        expect(n.ast.variant.kind).toBe(ExprKind.Member);
        expect(n.ast.variant.property.name).toBe("ExpiredCard");
    });

    test("fail — dot-notation variant `Type.Variant` (§19.3)", () => {
        const n = parseWithNative("fail Error.Generic(msg)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Fail);
        expect(n.ast.variant.kind).toBe(ExprKind.Call);
        expect(n.ast.variant.callee.object.name).toBe("Error");
    });
});

// -----------------------------------------------------------------------------
// M2.4 — primary-atom extensions: not / ~ / ?{sql} / <#id> / ::Variant (native).
// -----------------------------------------------------------------------------
describe("M2.4 expression-parser — scrml-extension primary atoms (native-only)", () => {
    test("`not` — the absence-value atom (§42)", () => {
        const n = parseWithNative("not");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.NotValue);
    });

    test("`not` as a call argument — `setUser(not)` (§42.2.1)", () => {
        const n = parseWithNative("setUser(not)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.args[0].kind).toBe(ExprKind.NotValue);
    });

    test("`~` — the standalone pipeline-accumulator atom (§32)", () => {
        const n = parseWithNative("~");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Tilde);
    });

    test("`~x` — bitwise-NOT, NOT the accumulator (operand source-adjacent)", () => {
        // M1 lexes `~` as BitNot; `~x` (operand adjacent) stays bitwise-NOT —
        // a Unary node, NOT a Tilde atom.
        const n = parseWithNative("~x");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Unary);
        expect(n.ast.op).toBe("~");
    });

    test("`~.ok` — member access on the accumulator (§32)", () => {
        const n = parseWithNative("~.ok");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.object.kind).toBe(ExprKind.Tilde);
        expect(n.ast.property.name).toBe("ok");
    });

    test("`?{sql}` — a SQL block atom carrying its raw text (§8)", () => {
        const n = parseWithNative("?{`SELECT * FROM items`}");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Sql);
        expect(n.ast.raw).toContain("SELECT * FROM items");
    });

    test("`?{sql}` with a bound `${param}` — interpolation stays in raw (§8.1)", () => {
        const n = parseWithNative("?{`SELECT * FROM u WHERE id = ${userId}`}.get()");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.object.kind).toBe(ExprKind.Sql);
        expect(n.ast.callee.object.raw).toContain("${userId}");
    });

    test("`<#id>` — an input-state reference atom (§36)", () => {
        const n = parseWithNative("<#price>");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.InputStateRef);
        expect(n.ast.id).toBe("price");
    });

    test("`<#id>.value` — member access on an input-state ref (§36)", () => {
        const n = parseWithNative("<#price>.value");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.object.kind).toBe(ExprKind.InputStateRef);
        expect(n.ast.property.name).toBe("value");
    });

    test("`::Variant` — a leading bare variant via the `::` alias (§14.4)", () => {
        const n = parseWithNative("::Loading");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        // `::Variant` re-composes to the SAME BareVariant node `.Variant`
        // produces — the `::` form is a pure alias.
        expect(n.ast.kind).toBe(ExprKind.BareVariant);
        expect(n.ast.name).toBe("Loading");
    });

    test("`::Variant` and `.Variant` produce the identical node kind (§14.4)", () => {
        const colon = parseWithNative("::Big");
        const dot = parseWithNative(".Big");
        expect(colon.ok).toBe(true);
        expect(dot.ok).toBe(true);
        expect(colon.ast.kind).toBe(dot.ast.kind);
        expect(colon.ast.name).toBe(dot.ast.name);
    });

    test("`Type::Variant` — the `::` member-access alias in a chain (§14.4)", () => {
        const n = parseWithNative("PowerUp::Mushroom");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Member);
        expect(n.ast.object.name).toBe("PowerUp");
        expect(n.ast.property.name).toBe("Mushroom");
    });

    test("`Type::Variant(args)` — constructor call via the `::` alias (§14.4)", () => {
        const n = parseWithNative("PowerUp::Mushroom(1)");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Call);
        expect(n.ast.callee.kind).toBe(ExprKind.Member);
        expect(n.ast.callee.property.name).toBe("Mushroom");
        expect(n.ast.args.length).toBe(1);
    });
});

// -----------------------------------------------------------------------------
// M2.4 — span preservation (DD §D6 Tier 3) + error paths (diagnostics, no
// throw). The scrml-extension forms carry a Span on every node; malformed
// forms record a structured diagnostic rather than throwing.
// -----------------------------------------------------------------------------
describe("M2.4 expression-parser — span preservation (Tier 3 spot-check)", () => {
    const spanCases = [
        { src: "not" },
        { src: "~" },
        { src: "<#price>" },
        { src: "::Idle" },
        { src: "@x is some" },
        { src: "match s { .A => 1 }" },
        { src: "render header()" },
    ];
    for (const c of spanCases) {
        test(`(tier3) outer span covers source — ${c.src}`, () => {
            const n = parseWithNative(c.src);
            expect(n.ok).toBe(true);
            expect(n.ast).toBeDefined();
            expect(n.ast.span).toBeDefined();
            expect(n.ast.span.start).toBe(0);
            expect(n.ast.span.end).toBe(c.src.length);
        });
    }
});

describe("M2.4 expression-parser — error paths (diagnostics, no throw)", () => {
    test("malformed `is` — bare `is` with no suffix records E-EXPR-IS-SUFFIX", () => {
        const n = parseWithNative("@x is");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-IS-SUFFIX");
    });

    test("malformed `match` — missing `{` records E-EXPR-MATCH-BRACE", () => {
        const n = parseWithNative("match s");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-MATCH-BRACE");
    });

    test("malformed `render` — missing `(` records E-EXPR-RENDER-CALL", () => {
        const n = parseWithNative("render footer");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-RENDER-CALL");
    });

    test("malformed `fail` — no variant after `fail` records E-EXPR-FAIL-VARIANT", () => {
        const n = parseWithNative("fail 42");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-FAIL-VARIANT");
    });

    test("malformed match arm — bad pattern records E-EXPR-MATCH-PATTERN", () => {
        const n = parseWithNative("match s { 42 => 1 }");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-MATCH-PATTERN");
    });
});

// =============================================================================
// M6.5.b.1 — match-arm separator forms.
//
// SPEC §18.2 grammar `match-expr ::= 'match' expression '{' match-arm+ '}'`
// uses bare `match-arm+` with NO inter-arm separator token in the production.
// The canonical corpus form is NEWLINE-as-separator (see worked examples in
// §18.2 and `examples/14-mario-state-machine.scrml`). `,` and `;` are also
// accepted (S125 scoping doc Class D). Mixing forms across one match is OK.
//
// Each test parses the match expression and asserts the structural arm count
// matches the source. Diagnostics: zero for all canonical forms. Helper
// `parseWithNative` already used by the M2.4 error-paths suite above.
// =============================================================================
describe("M6.5.b.1 — match-arm separator forms (comma / semi / newline / mixed)", () => {
    test("comma-only separator — `.A => 1, .B => 2` parses 2 arms cleanly", () => {
        const n = parseWithNative("match t { .A => 1, .B => 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(2);
    });

    test("semi-only separator — `.A => 1; .B => 2` parses 2 arms cleanly", () => {
        const n = parseWithNative("match t { .A => 1; .B => 2 }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(2);
    });

    test("newline-only separator (literal-body) — canonical scrml form parses 2 arms", () => {
        const src = "match t {\n    .A => 1\n    .B => 2\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(2);
    });

    test("newline-only separator (reassign-body) — `.A => @t = .B` mario form", () => {
        const src = "match @t {\n    .A => @t = .B\n    .B => @t = .A\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(2);
    });

    test("newline-only separator (block body) — `.A => { ... }` block-form arms", () => {
        const src = "match t {\n    .A => { x = 1 }\n    .B => { x = 2 }\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.kind).toBe(ExprKind.Match);
        expect(n.ast.arms.length).toBe(2);
    });

    test("mixed separators — comma then newline then comma — all 4 arms parse cleanly", () => {
        const src = "match t {\n    .A => 1,\n    .B => 2\n    .C => 3, .D => 4\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(4);
    });

    test("single-arm, no trailing separator, trailing newline only", () => {
        const src = "match t { .A => 1\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(1);
    });

    test("trailing comma on last arm — `.A => 1, .B => 2,` parses 2 arms cleanly", () => {
        const n = parseWithNative("match t { .A => 1, .B => 2, }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
    });

    test("trailing semi on last arm — `.A => 1; .B => 2;` parses 2 arms cleanly", () => {
        const n = parseWithNative("match t { .A => 1; .B => 2; }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
    });

    test("`else` wildcard with newline separator", () => {
        const src = "match t {\n    .A => 1\n    else => 2\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
    });

    test("payload binding with newline separator — `.Pt(x, y) => ...`", () => {
        const src = "match s {\n    .Pt(x, y) => x + y\n    .Origin => 0\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
    });

    test("qualified variant pattern with newline separator — `Type.V => ...`", () => {
        const src = "match s {\n    Tag.A => 1\n    Tag.B => 2\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
    });

    test("`->` arrow alias also accepts newline separator", () => {
        const src = "match t {\n    .A -> 1\n    .B -> 2\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
        // The arrow form is recorded on the arm.
        expect(n.ast.arms[0].separator).toBe("->");
    });

    test("empty arms (just `match t { }`) — zero arms, no error", () => {
        // A match with no arms at all is structurally legal at parse time
        // (later passes — exhaustiveness — will reject empty-arms). Parser
        // produces an empty arms[] without firing E-EXPR-MATCH-PATTERN.
        const n = parseWithNative("match t { }");
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(0);
    });

    test("preserves existing E-EXPR-MATCH-PATTERN on a NON-arm-shaped token between arms", () => {
        // `.A => 1, 42` — the `42` after a comma is NOT an arm pattern
        // (literal patterns are §18.16; the bare-number variant isn't
        // wired in native yet). Should record E-EXPR-MATCH-PATTERN, not
        // silently mis-parse. Confirms the separator extension didn't
        // regress the pre-existing error path.
        const n = parseWithNative("match t { .A => 1, 42 }");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        expect(codes).toContain("E-EXPR-MATCH-PATTERN");
    });

    test("Dot+UpperIdent variant pattern (lexer Dot form) — `.A` after RBrace prev", () => {
        // After a block body's `}`, the lexer chooses Dot+Ident for the
        // next `.X` (regexAllowedAfter(RBrace)===false). The arm-pattern
        // parser's Dot+UpperIdent branch handles this — without it the
        // newline-separated case would E-EXPR-MATCH-PATTERN.
        const src = "match t {\n    .A => { x = 1 }\n    .B => 2\n}";
        const n = parseWithNative(src);
        expect(n.ok).toBe(true);
        expect(n.errors).toEqual([]);
        expect(n.ast.arms.length).toBe(2);
        // Confirm both arm patterns parsed as variant patterns named A/B
        expect(n.ast.arms[1].pattern.variantName).toBe("B");
    });
});

// =============================================================================
// M4.3 — async / await RETRACTION (the language-level decision that scrml has
// no `async` / `await`). The parser ENCOUNTERS the keyword forms (M1 still
// lexes `async` / `await` as keywords for tooling-compatibility), but every
// production-position appearance fires a scrml-level error code:
//   - E-ASYNC-NOT-IN-SCRML — `async` on a function decl / expr, arrow, or
//     method (class/object); also `export async function` / `export default
//     async function`.
//   - E-AWAIT-NOT-IN-SCRML  — `await` used as a unary operator anywhere.
//   - E-FOR-AWAIT-NOT-IN-SCRML — `for await ( ... )` in any shape.
// The parse RECOVERS so the rest of the program stays diagnosable; the
// retracted AST flag (isAsync) is forced false. The `Await` ExprKind itself
// is RETIRED — parseUnary returns the operand directly. Generators
// (`yield`/`yield*`/`function*`) are PRESERVED.
// =============================================================================
describe("M4.3 — async/await retraction (expression layer)", () => {
    test("`async function () {}` — fires E-ASYNC-NOT-IN-SCRML; isAsync recovers to false", () => {
        const n = parseWithNative("async function () {}");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(n.ast.kind).toBe(ExprKind.Function);
        expect(n.ast.isAsync).toBe(false);
    });

    test("`async x => x` — fires E-ASYNC-NOT-IN-SCRML; arrow recovers with isAsync false", () => {
        const n = parseWithNative("async x => x");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(n.ast.kind).toBe(ExprKind.Arrow);
        expect(n.ast.isAsync).toBe(false);
    });

    test("`async () => 1` — fires E-ASYNC-NOT-IN-SCRML; arrow recovers", () => {
        const n = parseWithNative("async () => 1");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(n.ast.kind).toBe(ExprKind.Arrow);
        expect(n.ast.isAsync).toBe(false);
    });

    test("`{ async load() {} }` — fires E-ASYNC-NOT-IN-SCRML; object method recovers", () => {
        const n = parseWithNative("({ async load() {} })");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
    });

    test("`await x` — fires E-AWAIT-NOT-IN-SCRML; recovery returns the operand", () => {
        const n = parseWithNative("await x");
        expect(n.ok).toBe(true);
        expect(n.errors.map((e) => e.code)).toContain("E-AWAIT-NOT-IN-SCRML");
        // RECOVERY — no Await node; the operand (`x`) flows through as the
        // unary tail.
        expect(n.ast.kind).toBe(ExprKind.Ident);
        expect(n.ast.name).toBe("x");
    });

    test("`await await deep()` — recovery returns the innermost operand (no Await nodes)", () => {
        const n = parseWithNative("await await deep()");
        expect(n.ok).toBe(true);
        const codes = n.errors.map((e) => e.code);
        // Both `await` keywords fire the code (one for each occurrence).
        expect(codes.filter((c) => c === "E-AWAIT-NOT-IN-SCRML").length).toBe(2);
        // The recovery returns `deep()` (a Call node), unwrapped.
        expect(n.ast.kind).toBe(ExprKind.Call);
    });

    test("`async` as a plain identifier still parses (`async.then`, `async(1)`) — no error", () => {
        const n1 = parseWithNative("async.then");
        expect(n1.errors).toEqual([]);
        expect(n1.ast.kind).toBe(ExprKind.Member);
        const n2 = parseWithNative("async(1)");
        expect(n2.errors).toEqual([]);
        expect(n2.ast.kind).toBe(ExprKind.Call);
    });

    test("`{ async: 1 }` — `async` as a property key is NOT a retraction (no error)", () => {
        const n = parseWithNative("({ async: 1 })");
        expect(n.errors).toEqual([]);
    });
});


// =============================================================================
// MK4 — JS->markup delegate-up direction (R1 spike §1.2 / Pillar 1).
//
// parsePrimary's LessThan branch detects markup-as-value via
// markupValueAllowedAfter (the prev-token discriminator) + a next-token
// source-adjacent Ident shape check. The delegation produces a MarkupValue
// ExprKind carrying the markup block-stream.
//
// SCOPE: this section exercises ONLY the JS-layer detection + the
// MarkupValue construction. The markup-grammar conformance is the markup
// suite's responsibility (parser-conformance-markup.test.js); MK4 §64-§65
// in that file exercise the markup-value's interaction with the markup
// layer.
// =============================================================================
import { makeParseExprContext as scrmlMakeParseExprContext, parseExpression as scrmlParseExpression, isMarkupValueAhead, parseMarkupValue } from "../native-parser/parse-expr.js";
import { markupValueAllowedAfter } from "../native-parser/parse-seam.js";
import { TokenKind as MK4TokenKind } from "../native-parser/token.js";
import { previousKind } from "../native-parser/token-cursor.js";

describe("MK4 §1 — markupValueAllowedAfter (the prev-token discriminator)", () => {
    test("start-of-stream (undefined) is value-following", () => {
        expect(markupValueAllowedAfter(undefined)).toBe(true);
        expect(markupValueAllowedAfter(null)).toBe(true);
    });

    test("after `=` (Assign) is value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.Assign)).toBe(true);
    });

    test("after `return` is value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.KwReturn)).toBe(true);
    });

    test("after `lift` is value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.KwLift)).toBe(true);
    });

    test("after `render` (SINGULAR — KwRender) is value-following", () => {
        // R1 spike §1.2 sketched "renders" (plural); the real TokenKind
        // catalog has KwRender (singular — the L3-locked canonical form).
        // The plural is NOT in the discriminator set.
        expect(markupValueAllowedAfter(MK4TokenKind.KwRender)).toBe(true);
    });

    test("after `(` `[` `,` `{` `;` `:` are value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.LParen)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.LBracket)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.LBrace)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.Comma)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.Semicolon)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.Colon)).toBe(true);
    });

    test("after `=>` (Arrow) is value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.Arrow)).toBe(true);
    });

    test("after binary operators are value-following", () => {
        expect(markupValueAllowedAfter(MK4TokenKind.Plus)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.LogicalAnd)).toBe(true);
        expect(markupValueAllowedAfter(MK4TokenKind.Question)).toBe(true);
    });

    test("after Ident / NumberLit / StringLit are NOT value-following", () => {
        // A `<` after an Ident is less-than, not a markup opener.
        expect(markupValueAllowedAfter(MK4TokenKind.Ident)).toBe(false);
        expect(markupValueAllowedAfter(MK4TokenKind.NumberLit)).toBe(false);
        expect(markupValueAllowedAfter(MK4TokenKind.StringLit)).toBe(false);
        // Closing brackets are not value-following either.
        expect(markupValueAllowedAfter(MK4TokenKind.RParen)).toBe(false);
        expect(markupValueAllowedAfter(MK4TokenKind.RBracket)).toBe(false);
    });
});

describe("MK4 §2 — isMarkupValueAhead (cursor-position discriminator)", () => {
    test("`<div ...>` at stream head is markup-value-ahead", () => {
        const src = "<div/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        expect(isMarkupValueAhead(ctx)).toBe(true);
    });

    test("`x < y` (Ident, LessThan) is NOT markup-value-ahead", () => {
        const src = "x < y";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        // Walk past x to position the cursor at `<`.
        ctx.cursor.idx = 1;
        expect(isMarkupValueAhead(ctx)).toBe(false);
    });

    test("`< div` (space between < and ident) is NOT markup-value-ahead", () => {
        const src = "< div/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        // The next-token source-adjacency check fails: ` div` has a space.
        expect(isMarkupValueAhead(ctx)).toBe(false);
    });
});

describe("MK4 §3 — parseMarkupValue produces a MarkupValue node", () => {
    test("`<div/>` parses to MarkupValue carrying the markup block-stream", () => {
        const src = "<div/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        expect(ast.span.start).toBe(0);
        expect(ast.span.end).toBe(6);
        expect(ctx.errors.length).toBe(0);
        expect(Array.isArray(ast.markup)).toBe(true);
        expect(ast.markup[0].kind).toBe("Markup");
        expect(ast.markup[0].name).toBe("div");
        expect(ast.markup[0].tagClass).toBe("SelfClose");
    });

    test("`<div>hello</div>` (paired) parses to MarkupValue", () => {
        const src = "<div>hello</div>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        expect(ast.span.start).toBe(0);
        expect(ast.span.end).toBe(16);
        expect(ctx.errors.length).toBe(0);
        expect(ast.markup[0].name).toBe("div");
    });

    test("`<Card/>` (capitalized — component) parses to MarkupValue", () => {
        const src = "<Card/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        expect(ast.markup[0].name).toBe("Card");
    });

    test("ctx.source absent: parseMarkupValue falls back to token-range capture (BlockStub shape)", () => {
        const src = "<div/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens);  // no source
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        // Token-range capture path: ast.markup is an OBJECT with kind "MarkupTokenRange".
        expect(ast.markup.kind).toBe("MarkupTokenRange");
        expect(Array.isArray(ast.markup.tokens)).toBe(true);
    });
});

describe("MK4 §4 — markup-value in larger expression contexts", () => {
    test("markup-as-value RHS of an assignment: `card = <div/>`", () => {
        // The parser is a one-expression parser; here we parse the RHS alone.
        const src = "<div/>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
    });

    test("`<wrapper>...</wrapper>` (paired with children) parses", () => {
        const src = "<wrapper>x</wrapper>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        expect(ast.markup[0].name).toBe("wrapper");
    });

    test("`x < y` stays a binary expression (regression — discriminator works)", () => {
        const src = "x < y";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("Binary");
        expect(ast.op).toBe("<");
        expect(ctx.errors.length).toBe(0);
    });
});

// =============================================================================
// MK4 §5 — cross-seam error attribution (R1 spike §1.4 / punch-list P9).
//
// Diagnostics emitted from the markup layer while inside a JS->markup
// delegation carry a `delegationFrame` field on the err record. The frame
// records:
//   - kind: "ElementValue" (matches the DelegationKind catalog —
//     delegation-frame.js)
//   - openSpan: the `<` token's span (the JS->markup boundary)
//   - via: "JSToMarkup" (the delegation direction)
//
// A downstream consumer (M5+ codegen) reads `err.delegationFrame.openSpan`
// so the diagnostic's blame chain reaches the JS-layer call site, not just
// the markup-side parse failure.
// =============================================================================
describe("MK4 §5 — cross-seam error attribution (R1 spike §1.4)", () => {
    test("a markup-as-value with a malformed inner ${} body attaches the JSToMarkup delegation frame", () => {
        // The `${}` body inside the markup-value is parsed by the JS layer;
        // a parse error there flows back through the markup layer and is
        // forwarded into the JS-layer ctx.errors with the JS->markup
        // delegation marker.
        const src = "<div>${ broken syntax }</div>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        const ast = scrmlParseExpression(ctx);
        expect(ast.kind).toBe("MarkupValue");
        expect(ctx.errors.length).toBeGreaterThan(0);
        const e = ctx.errors[0];
        expect(e.delegationFrame).toBeDefined();
        expect(e.delegationFrame.kind).toBe("ElementValue");
        expect(e.delegationFrame.via).toBe("JSToMarkup");
        expect(e.delegationFrame.openSpan.start).toBe(0);
    });

    test("a well-formed markup-as-value emits no errors", () => {
        const src = "<div>hello</div>";
        const tokens = scrmlNativeLex(src);
        const ctx = scrmlMakeParseExprContext(tokens, src);
        scrmlParseExpression(ctx);
        expect(ctx.errors.length).toBe(0);
    });
});
