// parser-conformance-stmt.test.js — statement-parser conformance suite
// (M3.1 + M3.2 + M3.3).
//
// Per scrml-native-parser-design-2026-05-17.md §D6 + §D7 M3 gating:
//   "Conformance Tier 1+2 PASS on the full statement subset ... Tier 1 —
//    node-kind sequence ... Tier 2 — identifier / literal values."
//
// Scope (M3 — the JS statement parser):
//   M3.1 — STATEMENT SUBSTRATE — variable declarations let/const/var (incl.
//     object + array destructuring binding patterns), expression statements
//     (with automatic semicolon insertion), block statements { }, the empty
//     statement ;. PLUS the BlockStub re-entry mechanism — M2.3/M2.4 left
//     function/arrow/match-arm block bodies as BlockStub Expr nodes; M3.1
//     re-parses them into a real Stmt list.
//   M3.2 — CONTROL FLOW — if/else, while, do-while, for (C-style/in/of),
//     return/break/continue, labels.
//   M3.3 — FUNCTIONS / CLASSES + IN-LINE BODIES + IMPORT/EXPORT + TRY/THROW —
//     function declarations (incl. async / generator), class declarations
//     (methods / fields / static / get/set / computed names), import/export,
//     try/catch/finally + throw. Function/method bodies parse IN-LINE — the
//     body-pre-parser subsumption. `await`/`yield` statement leads.
//
// The native statement parser (compiler/native-parser/parse-stmt.js) parses
// a token stream as a program body. This test runs a micro-corpus through
// both the native parser and Acorn (the conformance ORACLE per §D6 — never
// the design template) and asserts:
//   Tier 1 — the node-kind SEQUENCE produced by a tree walk matches.
//   Tier 2 — identifier names + literal values at corresponding positions
//            match.
//
// This file MIRRORS parser-conformance-expr.test.js's structure. The
// statement-tree expression sub-grammar is M2's; the expression normalizer
// below covers the expression shapes the M3.1-M3.3 corpus uses.

import { describe, test, expect } from "bun:test";
import * as acorn from "acorn";

import { lex as scrmlNativeLex } from "../native-parser/lex.js";
import { parseProgram as scrmlNativeParseProgram } from "../native-parser/parse-stmt.js";
import { parseBlockStubBody, reenterBlockStubs } from "../native-parser/parse-stmt.js";
import { parseExpr as scrmlNativeParseExpr } from "../native-parser/parse-expr.js";
import { StmtKind, BindingKind, ClassMemberKind } from "../native-parser/ast-stmt.js";
import { ExprKind } from "../native-parser/ast-expr.js";
// M3.4 — the M1 ErrorRecovery engine. The panic-mode re-synchronization
// describe block exercises the engine's three-state cycle directly, alongside
// the end-to-end "parser resumes after a parse error" integration tests.
import {
    ErrorRecovery, SyncToken,
    makeRecovery, isParsingNormally, beginRecovery, accumulateSkipped,
    markResync, resumeNormal,
} from "../native-parser/error-recovery.js";

const ACORN_OPTS = {
    ecmaVersion: 2025,
    sourceType:  "module",
};

// -----------------------------------------------------------------------------
// nativeExprToEstree — normalize a native Expr node into an ESTree-shaped
// node. The M3.1 statement corpus uses only simple expression shapes; this
// normalizer covers exactly those (identifiers, literals, call/member, the
// small operator set). The exhaustive expression normalizer lives in
// parser-conformance-expr.test.js — this is the M3.1-corpus subset.
// -----------------------------------------------------------------------------
function nativeExprToEstree(node) {
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
    if (node.kind === ExprKind.Paren) {
        // Acorn produces no paren node — unwrap.
        return nativeExprToEstree(node.expression);
    }
    if (node.kind === ExprKind.Array) {
        return {
            type: "ArrayExpression",
            elements: node.elements.map((el) => {
                if (el.kind === "Hole") return null;
                if (el.kind === "Spread") {
                    return { type: "SpreadElement", argument: nativeExprToEstree(el.expression) };
                }
                return nativeExprToEstree(el.expression);
            }),
        };
    }
    if (node.kind === ExprKind.Object) {
        return {
            type: "ObjectExpression",
            properties: node.properties.map((p) => {
                if (p.kind === "Spread") {
                    return { type: "SpreadElement", argument: nativeExprToEstree(p.expression) };
                }
                if (p.kind === "Shorthand") {
                    return {
                        type: "Property", shorthand: true, computed: false,
                        key: { type: "Identifier", name: p.name },
                        value: { type: "Identifier", name: p.name },
                    };
                }
                return {
                    type: "Property", shorthand: false, computed: p.computed === true,
                    key: nativeExprToEstree(p.key),
                    value: nativeExprToEstree(p.value),
                };
            }),
        };
    }
    if (node.kind === ExprKind.Binary) {
        return {
            type: "BinaryExpression", operator: node.op,
            left: nativeExprToEstree(node.left),
            right: nativeExprToEstree(node.right),
        };
    }
    if (node.kind === ExprKind.Logical) {
        return {
            type: "LogicalExpression", operator: node.op,
            left: nativeExprToEstree(node.left),
            right: nativeExprToEstree(node.right),
        };
    }
    if (node.kind === ExprKind.Assignment) {
        return {
            type: "AssignmentExpression", operator: node.op,
            left: nativeExprToEstree(node.target),
            right: nativeExprToEstree(node.value),
        };
    }
    if (node.kind === ExprKind.Unary) {
        return {
            type: "UnaryExpression", operator: node.op, prefix: node.prefix === true,
            argument: nativeExprToEstree(node.operand),
        };
    }
    if (node.kind === ExprKind.Update) {
        return {
            type: "UpdateExpression", operator: node.op, prefix: node.prefix === true,
            argument: nativeExprToEstree(node.operand),
        };
    }
    if (node.kind === ExprKind.Member) {
        return {
            type: "MemberExpression",
            object: nativeExprToEstree(node.object),
            property: nativeExprToEstree(node.property),
            computed: node.computed === true,
            optional: node.optional === true,
        };
    }
    if (node.kind === ExprKind.Call) {
        return {
            type: "CallExpression",
            callee: nativeExprToEstree(node.callee),
            arguments: node.args.map(nativeExprToEstree),
            optional: node.optional === true,
        };
    }
    if (node.kind === ExprKind.New) {
        return {
            type: "NewExpression",
            callee: nativeExprToEstree(node.callee),
            arguments: (node.args ?? []).map(nativeExprToEstree),
        };
    }
    if (node.kind === ExprKind.This) {
        return { type: "ThisExpression" };
    }
    if (node.kind === ExprKind.Super) {
        // Acorn emits a bare `Super` node (the base of a `super.x` member /
        // a `super(...)` call). The M3.4 full-subset corpus exercises a
        // `super.greet()` method body — without this case the native `Super`
        // node would drop out of the Tier-1 node-kind sequence.
        return { type: "Super" };
    }
    if (node.kind === ExprKind.Conditional) {
        return {
            type: "ConditionalExpression",
            test: nativeExprToEstree(node.test),
            consequent: nativeExprToEstree(node.consequent),
            alternate: nativeExprToEstree(node.alternate),
        };
    }
    // Function expressions (M2.3 head) — the body is a BlockStub. After M3.3
    // tie-off the BlockStub carries `.parsedBody` (a Stmt array re-entered
    // in-line); a function DECLARATION / class method value carries the body
    // directly as a Stmt array. nativeFunctionBody normalizes both.
    if (node.kind === ExprKind.Function) {
        return {
            type: "FunctionExpression",
            id: (node.name === undefined || node.name === null || node.name === "")
                ? null : { type: "Identifier", name: node.name },
            async: node.isAsync === true,
            generator: node.isGenerator === true,
            params: (node.params ?? []).map(nativeParamToEstree),
            body: nativeFunctionBody(node.body),
        };
    }
    if (node.kind === ExprKind.Arrow) {
        return {
            type: "ArrowFunctionExpression",
            async: node.isAsync === true,
            params: (node.params ?? []).map(nativeParamToEstree),
            body: nativeArrowBody(node.body),
        };
    }
    // `yield` Expr nodes — M4.1 promoted them to real ExprKind members
    // integrated as operators inside the expression grammar. The sibling
    // `Await` was RETRACTED in M4.3 (scrml has no async/await; parseUnary
    // fires E-AWAIT-NOT-IN-SCRML and returns the operand directly).
    if (node.kind === ExprKind.Yield) {
        return {
            type: "YieldExpression",
            delegate: node.delegate === true,
            argument: (node.argument === undefined || node.argument === null)
                ? null : nativeExprToEstree(node.argument),
        };
    }
    // Any expression shape the corpus does not exercise — projected as a
    // generic node so the walk still terminates. The corpus is curated so
    // this branch is not reached on a clean parse.
    return { type: "UnknownExpr", kind: node.kind };
}

// nativeParamToEstree — normalize one function / arrow / method parameter.
// M2.3 parses params as a mix of Ident / RestElement / AssignmentPattern /
// (destructuring stand-in — an Object/Array literal node, the K6 divergence).
function nativeParamToEstree(node) {
    if (node === undefined || node === null) return null;
    if (node.kind === ExprKind.RestElement || node.bindingKind === "RestElement") {
        return {
            type: "RestElement",
            argument: nativeParamToEstree(node.argument),
        };
    }
    if (node.kind === ExprKind.AssignmentPattern || node.bindingKind === "AssignmentPattern") {
        return {
            type: "AssignmentPattern",
            left: nativeParamToEstree(node.left),
            right: nativeExprToEstree(node.right),
        };
    }
    if (node.bindingKind !== undefined) return nativeBindingToEstree(node);
    return nativeExprToEstree(node);
}

// nativeFunctionBody — the body of a function / method. M3.3-parsed function
// declarations + class methods carry the body as a Stmt array (parsed
// in-line); a M2.3 function-EXPRESSION carries a BlockStub whose `.parsedBody`
// is set after M3.3's reenterBlockStubs tie-off. Either way -> a
// BlockStatement.
function nativeFunctionBody(body) {
    if (Array.isArray(body)) {
        return { type: "BlockStatement", body: body.map(nativeStmtToEstree) };
    }
    if (body !== undefined && body !== null && Array.isArray(body.parsedBody)) {
        return { type: "BlockStatement", body: body.parsedBody.map(nativeStmtToEstree) };
    }
    // An un-re-entered BlockStub — empty (the corpus re-enters every body).
    return { type: "BlockStatement", body: [] };
}

// nativeArrowBody — the body of an arrow. A concise body is an Expr; a block
// body is a BlockStub (re-entered to `.parsedBody` by the M3.3 tie-off).
function nativeArrowBody(body) {
    if (body === undefined || body === null) return null;
    if (body.kind === ExprKind.BlockStub || Array.isArray(body.parsedBody)) {
        return nativeFunctionBody(body);
    }
    if (Array.isArray(body)) {
        return nativeFunctionBody(body);
    }
    return nativeExprToEstree(body);   // concise expression body
}

// nativeBindingToEstree — normalize a native binding node (ast-stmt's binding
// catalog) into an ESTree binding/pattern node. ESTree's pattern shapes:
//   Ident             -> Identifier
//   ObjectPat         -> ObjectPattern  (Property / RestElement)
//   ArrayPat          -> ArrayPattern   (element / null hole / RestElement)
//   AssignmentPattern -> AssignmentPattern { left, right }
//   RestElement       -> RestElement    { argument }
function nativeBindingToEstree(node) {
    if (node === undefined || node === null) return null;

    if (node.bindingKind === BindingKind.Ident) {
        return { type: "Identifier", name: node.name };
    }
    if (node.bindingKind === "AssignmentPattern") {
        return {
            type: "AssignmentPattern",
            left: nativeBindingToEstree(node.left),
            right: nativeExprToEstree(node.right),
        };
    }
    if (node.bindingKind === "RestElement") {
        return { type: "RestElement", argument: nativeBindingToEstree(node.argument) };
    }
    if (node.bindingKind === BindingKind.ObjectPat) {
        return {
            type: "ObjectPattern",
            properties: node.properties.map((p) => {
                if (p.propertyKind === "Rest") {
                    return { type: "RestElement", argument: nativeBindingToEstree(p.argument) };
                }
                if (p.propertyKind === "Shorthand") {
                    return {
                        type: "Property", shorthand: true, computed: false, kind: "init",
                        key: { type: "Identifier", name: p.name },
                        value: nativeBindingToEstree(p.value),
                    };
                }
                return {
                    type: "Property", shorthand: false, computed: p.computed === true, kind: "init",
                    key: nativeExprToEstree(p.key),
                    value: nativeBindingToEstree(p.value),
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
                    return { type: "RestElement", argument: nativeBindingToEstree(el.argument) };
                }
                return nativeBindingToEstree(el.value);
            }),
        };
    }
    return { type: "UnknownBinding", bindingKind: node.bindingKind };
}

// nativeForLeftToEstree — the LEFT side of a for-in / for-of. A declaration
// form is a VarDecl Stmt (-> VariableDeclaration); a non-declaration form is
// EITHER an assignment-target Expr (member expr / call / identifier) OR a
// binding pattern (M4.2 K6 closure — `for ({a} of xs)` LHS is an
// ObjectPattern, not an Object literal). The normalizer dispatches by the
// node's discriminator: `bindingKind` -> binding pattern; else expression.
function nativeForLeftToEstree(node) {
    if (node === undefined || node === null) return null;
    if (node.kind === StmtKind.VarDecl) return nativeStmtToEstree(node);
    if (node.bindingKind !== undefined) return nativeBindingToEstree(node);
    return nativeExprToEstree(node);
}

// -----------------------------------------------------------------------------
// nativeStmtToEstree — normalize a native Stmt node into an ESTree-shaped node.
//   Block    -> BlockStatement       { body }
//   ExprStmt -> ExpressionStatement  { expression }
//   Empty    -> EmptyStatement
//   VarDecl  -> VariableDeclaration  { kind, declarations:[VariableDeclarator] }
//   If       -> IfStatement          { test, consequent, alternate }
//   While    -> WhileStatement       { test, body }
//   DoWhile  -> DoWhileStatement     { body, test }
//   For      -> ForStatement         { init, test, update, body }
//   ForIn    -> ForInStatement       { left, right, body }
//   ForOf    -> ForOfStatement       { left, right, body, await }
//   Return   -> ReturnStatement      { argument }
//   Break    -> BreakStatement       { label }
//   Continue -> ContinueStatement    { label }
//   Labeled  -> LabeledStatement     { label, body }
// -----------------------------------------------------------------------------
function nativeStmtToEstree(node) {
    if (node === undefined || node === null) return null;

    if (node.kind === StmtKind.Block) {
        return { type: "BlockStatement", body: node.body.map(nativeStmtToEstree) };
    }
    if (node.kind === StmtKind.ExprStmt) {
        return { type: "ExpressionStatement", expression: nativeExprToEstree(node.expression) };
    }
    if (node.kind === StmtKind.Empty) {
        return { type: "EmptyStatement" };
    }
    if (node.kind === StmtKind.VarDecl) {
        return {
            type: "VariableDeclaration",
            kind: node.declKind,
            declarations: node.declarations.map((d) => ({
                type: "VariableDeclarator",
                id: nativeBindingToEstree(d.target),
                init: (d.init === undefined || d.init === null)
                    ? null : nativeExprToEstree(d.init),
            })),
        };
    }
    if (node.kind === StmtKind.If) {
        return {
            type: "IfStatement",
            test: nativeExprToEstree(node.test),
            consequent: nativeStmtToEstree(node.consequent),
            alternate: (node.alternate === undefined || node.alternate === null)
                ? null : nativeStmtToEstree(node.alternate),
        };
    }
    if (node.kind === StmtKind.While) {
        return {
            type: "WhileStatement",
            test: nativeExprToEstree(node.test),
            body: nativeStmtToEstree(node.body),
        };
    }
    if (node.kind === StmtKind.DoWhile) {
        return {
            type: "DoWhileStatement",
            body: nativeStmtToEstree(node.body),
            test: nativeExprToEstree(node.test),
        };
    }
    if (node.kind === StmtKind.For) {
        const initIsDecl = node.init !== undefined && node.init !== null
            && node.init.kind === StmtKind.VarDecl;
        return {
            type: "ForStatement",
            init: (node.init === undefined || node.init === null)
                ? null : (initIsDecl ? nativeStmtToEstree(node.init)
                                     : nativeExprToEstree(node.init)),
            test: (node.test === undefined || node.test === null)
                ? null : nativeExprToEstree(node.test),
            update: (node.update === undefined || node.update === null)
                ? null : nativeExprToEstree(node.update),
            body: nativeStmtToEstree(node.body),
        };
    }
    if (node.kind === StmtKind.ForIn) {
        return {
            type: "ForInStatement",
            left: nativeForLeftToEstree(node.left),
            right: nativeExprToEstree(node.right),
            body: nativeStmtToEstree(node.body),
        };
    }
    if (node.kind === StmtKind.ForOf) {
        return {
            type: "ForOfStatement",
            await: node.isAwait === true,
            left: nativeForLeftToEstree(node.left),
            right: nativeExprToEstree(node.right),
            body: nativeStmtToEstree(node.body),
        };
    }
    if (node.kind === StmtKind.Return) {
        return {
            type: "ReturnStatement",
            argument: (node.argument === undefined || node.argument === null)
                ? null : nativeExprToEstree(node.argument),
        };
    }
    if (node.kind === StmtKind.Break) {
        return {
            type: "BreakStatement",
            label: (node.label === undefined || node.label === null)
                ? null : { type: "Identifier", name: node.label },
        };
    }
    if (node.kind === StmtKind.Continue) {
        return {
            type: "ContinueStatement",
            label: (node.label === undefined || node.label === null)
                ? null : { type: "Identifier", name: node.label },
        };
    }
    if (node.kind === StmtKind.Labeled) {
        return {
            type: "LabeledStatement",
            label: { type: "Identifier", name: node.label },
            body: nativeStmtToEstree(node.body),
        };
    }
    // --- M3.3 declaration / module / legacy-error statements ---
    if (node.kind === StmtKind.FunctionDecl) {
        return {
            type: "FunctionDeclaration",
            id: (node.name === undefined || node.name === null || node.name === "")
                ? null : { type: "Identifier", name: node.name },
            async: node.isAsync === true,
            generator: node.isGenerator === true,
            params: (node.params ?? []).map(nativeParamToEstree),
            body: nativeFunctionBody(node.body),
        };
    }
    if (node.kind === StmtKind.ClassDecl) {
        return {
            type: "ClassDeclaration",
            id: (node.name === undefined || node.name === null || node.name === "")
                ? null : { type: "Identifier", name: node.name },
            superClass: (node.superClass === undefined || node.superClass === null)
                ? null : nativeExprToEstree(node.superClass),
            body: {
                type: "ClassBody",
                body: (node.body ?? []).map(nativeClassMemberToEstree),
            },
        };
    }
    if (node.kind === StmtKind.Import) {
        return {
            type: "ImportDeclaration",
            specifiers: (node.specifiers ?? []).map(nativeImportSpecifierToEstree),
            source: { type: "Literal", value: node.source },
        };
    }
    if (node.kind === StmtKind.Export) {
        return nativeExportToEstree(node);
    }
    if (node.kind === StmtKind.Try) {
        return {
            type: "TryStatement",
            block: nativeStmtToEstree(node.block),
            handler: (node.handler === undefined || node.handler === null)
                ? null : {
                    type: "CatchClause",
                    param: (node.handler.param === undefined || node.handler.param === null)
                        ? null : nativeBindingToEstree(node.handler.param),
                    body: nativeStmtToEstree(node.handler.body),
                },
            finalizer: (node.finalizer === undefined || node.finalizer === null)
                ? null : nativeStmtToEstree(node.finalizer),
        };
    }
    if (node.kind === StmtKind.Throw) {
        return {
            type: "ThrowStatement",
            argument: (node.argument === undefined || node.argument === null)
                ? null : nativeExprToEstree(node.argument),
        };
    }
    return { type: "UnknownStmt", kind: node.kind };
}

// nativeClassMemberToEstree — one class-body member. M3.3's Method ->
// ESTree MethodDefinition; Property -> ESTree PropertyDefinition.
function nativeClassMemberToEstree(m) {
    if (m === undefined || m === null) return null;
    if (m.memberKind === ClassMemberKind.Method) {
        return {
            type: "MethodDefinition",
            kind: m.methodKind,
            static: m.isStatic === true,
            computed: m.computed === true,
            key: nativeExprToEstree(m.key),
            value: nativeExprToEstree(m.value),
        };
    }
    return {
        type: "PropertyDefinition",
        static: m.isStatic === true,
        computed: m.computed === true,
        key: nativeExprToEstree(m.key),
        value: (m.value === undefined || m.value === null)
            ? null : nativeExprToEstree(m.value),
    };
}

// nativeImportSpecifierToEstree — one import specifier. Named -> ESTree
// ImportSpecifier; Default -> ImportDefaultSpecifier; Namespace ->
// ImportNamespaceSpecifier.
function nativeImportSpecifierToEstree(s) {
    if (s === undefined || s === null) return null;
    if (s.specifierKind === "Default") {
        return {
            type: "ImportDefaultSpecifier",
            local: { type: "Identifier", name: s.local },
        };
    }
    if (s.specifierKind === "Namespace") {
        return {
            type: "ImportNamespaceSpecifier",
            local: { type: "Identifier", name: s.local },
        };
    }
    return {
        type: "ImportSpecifier",
        imported: { type: "Identifier", name: s.imported },
        local: { type: "Identifier", name: s.local },
    };
}

// nativeExportToEstree — an `export` statement. M3.3's Export node rides
// three ESTree shapes: ExportDefaultDeclaration (isDefault), ExportNamed-
// Declaration (a declaration OR a specifier clause), ExportAllDeclaration
// (a `*` re-export). The conformance corpus exercises the comparable
// subset; the `export *` form keys off no specifiers + a source.
function nativeExportToEstree(node) {
    if (node.isDefault === true) {
        return {
            type: "ExportDefaultDeclaration",
            declaration: exportedDeclToEstree(node.declaration),
        };
    }
    // `export * [as ns] from "m"` — a source, no declaration; the namespace-
    // alias form carries one Namespace specifier.
    const hasSource = node.source !== undefined && node.source !== null;
    const noDecl = node.declaration === undefined || node.declaration === null;
    const specs = node.specifiers ?? [];
    const isStarReexport = hasSource && noDecl
        && (specs.length === 0
            || (specs.length === 1 && specs[0].specifierKind === "Namespace"));
    if (isStarReexport) {
        const out = {
            type: "ExportAllDeclaration",
            source: { type: "Literal", value: node.source },
            exported: null,
        };
        if (specs.length === 1) {
            out.exported = { type: "Identifier", name: specs[0].local };
        }
        return out;
    }
    return {
        type: "ExportNamedDeclaration",
        declaration: noDecl ? null : exportedDeclToEstree(node.declaration),
        specifiers: specs.map((s) => ({
            type: "ExportSpecifier",
            local: { type: "Identifier", name: s.local },
            exported: { type: "Identifier", name: s.exported },
        })),
        source: hasSource ? { type: "Literal", value: node.source } : null,
    };
}

// exportedDeclToEstree — the declaration carried by an `export <decl>` /
// `export default <decl|expr>`. A Stmt -> nativeStmtToEstree; an Expr (the
// `export default <expression>` form) -> nativeExprToEstree.
function exportedDeclToEstree(decl) {
    if (decl === undefined || decl === null) return null;
    if (typeof decl.kind === "string" && StmtKind[decl.kind] !== undefined) {
        return nativeStmtToEstree(decl);
    }
    return nativeExprToEstree(decl);
}

// nativeProgramToEstree — wrap a native program body (a Stmt array) as an
// ESTree Program node so the corpus walk compares apples-to-apples.
function nativeProgramToEstree(body) {
    return { type: "Program", body: body.map(nativeStmtToEstree) };
}

// -----------------------------------------------------------------------------
// nodeKindSequence — Tier 1. Pre-order tree walk collecting node `type`
// strings. A mismatch is a structural divergence (E-CONFORMANCE-1).
// -----------------------------------------------------------------------------
function nodeKindSequence(node, out) {
    const acc = out ?? [];
    if (node === undefined || node === null) return acc;
    if (typeof node !== "object" || typeof node.type !== "string") return acc;

    acc.push(node.type);

    if (node.type === "Program" || node.type === "BlockStatement") {
        for (const s of node.body) nodeKindSequence(s, acc);
    } else if (node.type === "ExpressionStatement") {
        nodeKindSequence(node.expression, acc);
    } else if (node.type === "VariableDeclaration") {
        for (const d of node.declarations) nodeKindSequence(d, acc);
    } else if (node.type === "VariableDeclarator") {
        nodeKindSequence(node.id, acc);
        if (node.init) nodeKindSequence(node.init, acc);
    } else if (node.type === "IfStatement") {
        nodeKindSequence(node.test, acc);
        nodeKindSequence(node.consequent, acc);
        if (node.alternate) nodeKindSequence(node.alternate, acc);
    } else if (node.type === "WhileStatement") {
        nodeKindSequence(node.test, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "DoWhileStatement") {
        nodeKindSequence(node.body, acc);
        nodeKindSequence(node.test, acc);
    } else if (node.type === "ForStatement") {
        if (node.init) nodeKindSequence(node.init, acc);
        if (node.test) nodeKindSequence(node.test, acc);
        if (node.update) nodeKindSequence(node.update, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
        nodeKindSequence(node.left, acc);
        nodeKindSequence(node.right, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ReturnStatement") {
        if (node.argument) nodeKindSequence(node.argument, acc);
    } else if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
        if (node.label) nodeKindSequence(node.label, acc);
    } else if (node.type === "LabeledStatement") {
        nodeKindSequence(node.label, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ObjectPattern" || node.type === "ObjectExpression") {
        for (const p of node.properties) nodeKindSequence(p, acc);
    } else if (node.type === "ArrayPattern" || node.type === "ArrayExpression") {
        for (const el of node.elements) {
            if (el !== null) nodeKindSequence(el, acc);
        }
    } else if (node.type === "Property") {
        if (!node.shorthand) nodeKindSequence(node.key, acc);
        nodeKindSequence(node.value, acc);
    } else if (node.type === "AssignmentPattern") {
        nodeKindSequence(node.left, acc);
        nodeKindSequence(node.right, acc);
    } else if (node.type === "RestElement") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "SpreadElement") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression") {
        nodeKindSequence(node.left, acc);
        nodeKindSequence(node.right, acc);
    } else if (node.type === "UnaryExpression" || node.type === "UpdateExpression") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "MemberExpression") {
        nodeKindSequence(node.object, acc);
        nodeKindSequence(node.property, acc);
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
        nodeKindSequence(node.callee, acc);
        for (const a of node.arguments) nodeKindSequence(a, acc);
    } else if (node.type === "ConditionalExpression") {
        nodeKindSequence(node.test, acc);
        nodeKindSequence(node.consequent, acc);
        nodeKindSequence(node.alternate, acc);
    } else if (node.type === "AwaitExpression") {
        nodeKindSequence(node.argument, acc);
    } else if (node.type === "YieldExpression") {
        if (node.argument) nodeKindSequence(node.argument, acc);
    } else if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
               || node.type === "ArrowFunctionExpression") {
        if (node.id) nodeKindSequence(node.id, acc);
        for (const p of node.params) nodeKindSequence(p, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
        if (node.id) nodeKindSequence(node.id, acc);
        if (node.superClass) nodeKindSequence(node.superClass, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ClassBody") {
        for (const m of node.body) nodeKindSequence(m, acc);
    } else if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
        if (!node.computed) {
            // A non-computed key is an Identifier / Literal — emit it so the
            // member-name nodes are part of the sequence (Acorn does the same).
            nodeKindSequence(node.key, acc);
        } else {
            nodeKindSequence(node.key, acc);
        }
        if (node.value) nodeKindSequence(node.value, acc);
    } else if (node.type === "ImportDeclaration") {
        for (const s of node.specifiers) nodeKindSequence(s, acc);
        nodeKindSequence(node.source, acc);
    } else if (node.type === "ImportSpecifier") {
        nodeKindSequence(node.imported, acc);
        nodeKindSequence(node.local, acc);
    } else if (node.type === "ImportDefaultSpecifier"
               || node.type === "ImportNamespaceSpecifier") {
        nodeKindSequence(node.local, acc);
    } else if (node.type === "ExportNamedDeclaration") {
        if (node.declaration) nodeKindSequence(node.declaration, acc);
        for (const s of node.specifiers) nodeKindSequence(s, acc);
        if (node.source) nodeKindSequence(node.source, acc);
    } else if (node.type === "ExportSpecifier") {
        nodeKindSequence(node.local, acc);
        nodeKindSequence(node.exported, acc);
    } else if (node.type === "ExportDefaultDeclaration") {
        nodeKindSequence(node.declaration, acc);
    } else if (node.type === "ExportAllDeclaration") {
        if (node.exported) nodeKindSequence(node.exported, acc);
        nodeKindSequence(node.source, acc);
    } else if (node.type === "TryStatement") {
        nodeKindSequence(node.block, acc);
        if (node.handler) nodeKindSequence(node.handler, acc);
        if (node.finalizer) nodeKindSequence(node.finalizer, acc);
    } else if (node.type === "CatchClause") {
        if (node.param) nodeKindSequence(node.param, acc);
        nodeKindSequence(node.body, acc);
    } else if (node.type === "ThrowStatement") {
        nodeKindSequence(node.argument, acc);
    }
    return acc;
}

// -----------------------------------------------------------------------------
// valueSequence — Tier 2. Walk the same tree, collect identifier names +
// literal values + the var-declaration keyword + the operator strings, in the
// same pre-order. A mismatch is a value divergence (E-CONFORMANCE-2).
// -----------------------------------------------------------------------------
function valueSequence(node, out) {
    const acc = out ?? [];
    if (node === undefined || node === null) return acc;
    if (typeof node !== "object" || typeof node.type !== "string") return acc;

    if (node.type === "Identifier") {
        acc.push("id:" + node.name);
    } else if (node.type === "Literal") {
        acc.push("lit:" + JSON.stringify(node.value));
    } else if (node.type === "VariableDeclaration") {
        acc.push("varkind:" + node.kind);
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression" || node.type === "UnaryExpression"
               || node.type === "UpdateExpression") {
        acc.push("op:" + node.operator);
    } else if (node.type === "MemberExpression") {
        acc.push("member:computed=" + (node.computed === true));
    } else if (node.type === "CallExpression") {
        acc.push("call");
    } else if (node.type === "NewExpression") {
        acc.push("new");
    } else if (node.type === "ForOfStatement") {
        acc.push("forof:await=" + (node.await === true));
    } else if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
        acc.push("fn:async=" + (node.async === true) + ":gen=" + (node.generator === true));
    } else if (node.type === "ArrowFunctionExpression") {
        acc.push("arrow:async=" + (node.async === true));
    } else if (node.type === "MethodDefinition") {
        acc.push("method:" + node.kind + ":static=" + (node.static === true)
            + ":computed=" + (node.computed === true));
    } else if (node.type === "PropertyDefinition") {
        acc.push("field:static=" + (node.static === true)
            + ":computed=" + (node.computed === true));
    } else if (node.type === "YieldExpression") {
        acc.push("yield:delegate=" + (node.delegate === true));
    } else if (node.type === "AwaitExpression") {
        acc.push("await");
    } else if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
        acc.push("source:" + JSON.stringify(node.source.value));
    } else if (node.type === "ExportNamedDeclaration" && node.source) {
        acc.push("source:" + JSON.stringify(node.source.value));
    }

    if (node.type === "Program" || node.type === "BlockStatement") {
        for (const s of node.body) valueSequence(s, acc);
    } else if (node.type === "ExpressionStatement") {
        valueSequence(node.expression, acc);
    } else if (node.type === "VariableDeclaration") {
        for (const d of node.declarations) valueSequence(d, acc);
    } else if (node.type === "VariableDeclarator") {
        valueSequence(node.id, acc);
        if (node.init) valueSequence(node.init, acc);
    } else if (node.type === "IfStatement") {
        valueSequence(node.test, acc);
        valueSequence(node.consequent, acc);
        if (node.alternate) valueSequence(node.alternate, acc);
    } else if (node.type === "WhileStatement") {
        valueSequence(node.test, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "DoWhileStatement") {
        valueSequence(node.body, acc);
        valueSequence(node.test, acc);
    } else if (node.type === "ForStatement") {
        if (node.init) valueSequence(node.init, acc);
        if (node.test) valueSequence(node.test, acc);
        if (node.update) valueSequence(node.update, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
        valueSequence(node.left, acc);
        valueSequence(node.right, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ReturnStatement") {
        if (node.argument) valueSequence(node.argument, acc);
    } else if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
        if (node.label) valueSequence(node.label, acc);
    } else if (node.type === "LabeledStatement") {
        valueSequence(node.label, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ObjectPattern" || node.type === "ObjectExpression") {
        for (const p of node.properties) valueSequence(p, acc);
    } else if (node.type === "ArrayPattern" || node.type === "ArrayExpression") {
        for (const el of node.elements) {
            if (el !== null) valueSequence(el, acc);
        }
    } else if (node.type === "Property") {
        if (!node.shorthand) valueSequence(node.key, acc);
        valueSequence(node.value, acc);
    } else if (node.type === "AssignmentPattern") {
        valueSequence(node.left, acc);
        valueSequence(node.right, acc);
    } else if (node.type === "RestElement" || node.type === "SpreadElement") {
        valueSequence(node.argument, acc);
    } else if (node.type === "BinaryExpression" || node.type === "LogicalExpression"
               || node.type === "AssignmentExpression") {
        valueSequence(node.left, acc);
        valueSequence(node.right, acc);
    } else if (node.type === "UnaryExpression" || node.type === "UpdateExpression") {
        valueSequence(node.argument, acc);
    } else if (node.type === "MemberExpression") {
        valueSequence(node.object, acc);
        valueSequence(node.property, acc);
    } else if (node.type === "CallExpression" || node.type === "NewExpression") {
        valueSequence(node.callee, acc);
        for (const a of node.arguments) valueSequence(a, acc);
    } else if (node.type === "ConditionalExpression") {
        valueSequence(node.test, acc);
        valueSequence(node.consequent, acc);
        valueSequence(node.alternate, acc);
    } else if (node.type === "AwaitExpression") {
        valueSequence(node.argument, acc);
    } else if (node.type === "YieldExpression") {
        if (node.argument) valueSequence(node.argument, acc);
    } else if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
               || node.type === "ArrowFunctionExpression") {
        if (node.id) valueSequence(node.id, acc);
        for (const p of node.params) valueSequence(p, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
        if (node.id) valueSequence(node.id, acc);
        if (node.superClass) valueSequence(node.superClass, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ClassBody") {
        for (const m of node.body) valueSequence(m, acc);
    } else if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
        valueSequence(node.key, acc);
        if (node.value) valueSequence(node.value, acc);
    } else if (node.type === "ImportDeclaration") {
        for (const s of node.specifiers) valueSequence(s, acc);
    } else if (node.type === "ImportSpecifier") {
        valueSequence(node.imported, acc);
        valueSequence(node.local, acc);
    } else if (node.type === "ImportDefaultSpecifier"
               || node.type === "ImportNamespaceSpecifier") {
        valueSequence(node.local, acc);
    } else if (node.type === "ExportNamedDeclaration") {
        if (node.declaration) valueSequence(node.declaration, acc);
        for (const s of node.specifiers) valueSequence(s, acc);
    } else if (node.type === "ExportSpecifier") {
        valueSequence(node.local, acc);
        valueSequence(node.exported, acc);
    } else if (node.type === "ExportDefaultDeclaration") {
        valueSequence(node.declaration, acc);
    } else if (node.type === "ExportAllDeclaration") {
        if (node.exported) valueSequence(node.exported, acc);
    } else if (node.type === "TryStatement") {
        valueSequence(node.block, acc);
        if (node.handler) valueSequence(node.handler, acc);
        if (node.finalizer) valueSequence(node.finalizer, acc);
    } else if (node.type === "CatchClause") {
        if (node.param) valueSequence(node.param, acc);
        valueSequence(node.body, acc);
    } else if (node.type === "ThrowStatement") {
        valueSequence(node.argument, acc);
    }
    return acc;
}

function parseWithAcorn(source) {
    try {
        const ast = acorn.parse(source, ACORN_OPTS);
        return { ok: true, ast };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

function parseWithNative(source) {
    try {
        const result = scrmlNativeParseProgram(scrmlNativeLex(source));
        return { ok: true, body: result.body, errors: result.errors };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

// -----------------------------------------------------------------------------
// Acorn-comparable statement micro-corpus. Every entry is a program built
// only from M3.1 substrate statements (declarations, blocks, expression
// statements, the empty statement) — so raw Acorn parses it and the
// native-vs-Acorn Tier 1+2 diff is meaningful.
// -----------------------------------------------------------------------------
const ACORN_CORPUS = [
    // --- the empty statement ---
    { name: "empty statement",                 src: ";" },
    { name: "two empty statements",            src: ";;" },

    // --- expression statements ---
    { name: "expr stmt — identifier",          src: "foo;" },
    { name: "expr stmt — call",                src: "doThing();" },
    { name: "expr stmt — call with args",      src: "add(1, 2);" },
    { name: "expr stmt — binary",              src: "a + b;" },
    { name: "expr stmt — assignment",          src: "x = 1;" },
    { name: "expr stmt — member call",         src: "obj.method();" },
    { name: "expr stmt — number literal",      src: "42;" },
    { name: "expr stmt — string literal",      src: '"hello";' },
    { name: "expr stmt — update",              src: "i++;" },

    // --- ASI — no explicit semicolon ---
    { name: "ASI — bare identifier",           src: "foo" },
    { name: "ASI — two stmts on two lines",    src: "a\nb" },
    { name: "ASI — call then call",            src: "first()\nsecond()" },
    { name: "ASI — decl then decl",            src: "let x = 1\nlet y = 2" },

    // --- let / const / var declarations ---
    { name: "let — single declarator",         src: "let x = 1;" },
    { name: "let — no initializer",            src: "let x;" },
    { name: "const — single declarator",       src: "const k = 9;" },
    { name: "var — single declarator",         src: "var v = 0;" },
    { name: "let — two declarators",           src: "let a = 1, b = 2;" },
    { name: "let — three declarators",         src: "let p = 1, q, r = 3;" },
    { name: "const — string init",            src: 'const name = "scrml";' },
    { name: "let — expression init",           src: "let sum = a + b;" },
    { name: "let — call init",                 src: "let r = compute();" },
    { name: "let — array init",                src: "let xs = [1, 2, 3];" },
    { name: "let — object init",               src: "let o = {a: 1};" },

    // --- block statements ---
    { name: "block — empty",                   src: "{}" },
    { name: "block — single stmt",             src: "{ foo(); }" },
    { name: "block — two stmts",               src: "{ a; b; }" },
    { name: "block — declaration inside",      src: "{ let x = 1; }" },
    { name: "block — nested block",            src: "{ { } }" },
    { name: "block — deeply nested",           src: "{ { { x; } } }" },

    // --- object-destructuring declarations ---
    { name: "obj pattern — single",            src: "let {a} = o;" },
    { name: "obj pattern — two",               src: "let {a, b} = o;" },
    { name: "obj pattern — keyed",             src: "let {a: x} = o;" },
    { name: "obj pattern — keyed + shorthand", src: "let {a: x, b} = o;" },
    { name: "obj pattern — default",           src: "let {a = 1} = o;" },
    { name: "obj pattern — keyed default",     src: "let {a: x = 1} = o;" },
    { name: "obj pattern — rest",              src: "let {a, ...rest} = o;" },
    { name: "obj pattern — string key",        src: 'let {"k": v} = o;' },
    { name: "obj pattern — nested object",     src: "let {a: {b}} = o;" },
    { name: "obj pattern — nested array",      src: "let {a: [b]} = o;" },

    // --- array-destructuring declarations ---
    { name: "arr pattern — single",            src: "let [a] = xs;" },
    { name: "arr pattern — two",               src: "let [a, b] = xs;" },
    { name: "arr pattern — hole",              src: "let [a, , c] = xs;" },
    { name: "arr pattern — leading hole",      src: "let [, b] = xs;" },
    { name: "arr pattern — default",           src: "let [a = 0] = xs;" },
    { name: "arr pattern — rest",              src: "let [a, ...tail] = xs;" },
    { name: "arr pattern — nested array",      src: "let [[a], [b]] = xs;" },
    { name: "arr pattern — nested object",     src: "let [{a}, {b}] = xs;" },

    // --- mixed multi-statement programs ---
    { name: "program — decl + expr + block",   src: "let x = 1; foo(); { bar(); }" },
    { name: "program — two decls + block",     src: "const a = 1; let b = 2; { a; }" },
    { name: "program — empties between",       src: "foo(); ; bar();" },
];

// -----------------------------------------------------------------------------
// M3.2 control-flow micro-corpus. Every entry is a program built from M3.1
// substrate statements PLUS M3.2 control-flow statements — so raw Acorn
// (module mode) parses it and the native-vs-Acorn Tier 1+2 diff is meaningful.
//
// Excluded by design (NOT Acorn-comparable in this corpus):
//   - a top-level `return` — Acorn rejects `return` outside a function; the
//     M3.2 native parser parses it (a Return node), and `return` is exercised
//     instead through BlockStub re-entry (a function body — where it is
//     legal). See the "control-flow inside a re-entered body" describe block.
//   - (M4.2 — K6 closed) a for-in / for-of with a NON-declaration
//     destructuring LHS is now in-corpus; see the entries below for
//     `for ({a} of items)` and `for ([a, b] of pairs)`.
// -----------------------------------------------------------------------------
const CONTROL_FLOW_CORPUS = [
    // --- if / else ---
    { name: "if — no else, expr body",         src: "if (a) b;" },
    { name: "if — no else, block body",        src: "if (a) { b(); }" },
    { name: "if — with else",                  src: "if (a) b; else c;" },
    { name: "if — block consequent + else",    src: "if (a) { x(); } else { y(); }" },
    { name: "if — else if chain",              src: "if (a) p(); else if (b) q(); else r();" },
    { name: "if — nested if in consequent",    src: "if (a) if (b) c();" },
    { name: "if — empty-statement body",       src: "if (a) ;" },
    { name: "if — comparison test",            src: "if (x < 10) tick();" },

    // --- while ---
    { name: "while — expr body",               src: "while (a) b;" },
    { name: "while — block body",              src: "while (a) { step(); }" },
    { name: "while — empty body",              src: "while (a) ;" },
    { name: "while — comparison test",         src: "while (i < n) i++;" },
    { name: "while — nested while",            src: "while (a) while (b) c();" },

    // --- do-while ---
    { name: "do-while — block body",           src: "do { foo(); } while (a);" },
    { name: "do-while — expr body",            src: "do step(); while (more);" },
    { name: "do-while — no trailing semi",     src: "do { foo(); } while (a)" },

    // --- for — C-style ---
    { name: "for — empty clauses",             src: "for (;;) {}" },
    { name: "for — full three-clause",         src: "for (let i = 0; i < 10; i++) { use(i); }" },
    { name: "for — var init",                  src: "for (var i = 0; i < n; i++) tick();" },
    { name: "for — expr init",                 src: "for (i = 0; i < n; i++) {}" },
    { name: "for — empty init",                src: "for (; i < n; i++) {}" },
    { name: "for — empty test",                src: "for (let i = 0;; i++) {}" },
    { name: "for — empty update",              src: "for (let i = 0; i < n;) {}" },
    { name: "for — two declarators init",      src: "for (let i = 0, j = n; i < j; i++) {}" },
    { name: "for — expr-stmt body",            src: "for (;;) doThing();" },
    { name: "for — empty-statement body",      src: "for (;;) ;" },

    // --- for-in ---
    { name: "for-in — let binding",            src: "for (let k in obj) { use(k); }" },
    { name: "for-in — const binding",          src: "for (const k in obj) log(k);" },
    { name: "for-in — var binding",            src: "for (var k in obj) {}" },
    { name: "for-in — non-decl ident LHS",     src: "for (k in obj) {}" },
    { name: "for-in — member-access LHS",      src: "for (o.k in src) {}" },

    // --- for-of ---
    { name: "for-of — const binding",          src: "for (const x of xs) { take(x); }" },
    { name: "for-of — let binding",            src: "for (let x of xs) use(x);" },
    { name: "for-of — non-decl ident LHS",     src: "for (x of xs) {}" },
    { name: "for-of — decl array pattern",     src: "for (const [a, b] of pairs) {}" },
    { name: "for-of — decl object pattern",    src: "for (const {a} of items) {}" },
    { name: "for-of — call as iterable",       src: "for (const x of items()) {}" },

    // --- M4.2 K6 — non-declaration destructuring LHS (parses as a real
    // binding pattern; the K6-class M3.2 divergence is closed) ---
    { name: "for-of — non-decl array pattern", src: "for ([a, b] of pairs) {}" },
    { name: "for-of — non-decl object pattern", src: "for ({a} of items) {}" },
    { name: "for-in — non-decl array pattern", src: "for ([a] in src) {}" },
    { name: "for-in — non-decl object pattern", src: "for ({k} in src) {}" },

    // --- break / continue (unlabeled) ---
    { name: "break — inside a loop",           src: "while (a) { break; }" },
    { name: "continue — inside a loop",        src: "while (a) { continue; }" },
    { name: "break — inside a for",            src: "for (;;) { if (done) break; }" },

    // --- labels + labeled break / continue ---
    { name: "labeled — for loop",              src: "outer: for (;;) {}" },
    { name: "labeled — while loop",            src: "loop: while (a) {}" },
    { name: "labeled — block statement",       src: "blk: { foo(); }" },
    { name: "labeled break",                   src: "outer: for (;;) { break outer; }" },
    { name: "labeled continue",                src: "loop: while (a) { continue loop; }" },
    { name: "nested labels",                   src: "a: b: for (;;) { break a; }" },

    // --- mixed control-flow programs ---
    { name: "program — if then while",         src: "if (a) b(); while (c) d();" },
    { name: "program — for then if",           src: "for (;;) {} if (a) b();" },
    { name: "program — loop with decl + if",   src: "for (let i = 0; i < n; i++) { let v = at(i); if (v) use(v); }" },
];

// -----------------------------------------------------------------------------
// M3.3 declaration / module / try-throw micro-corpus. Every entry is a program
// built from M3.1 substrate + M3.3 declaration / module / legacy-error
// statements — raw Acorn (module mode) parses it and the native-vs-Acorn
// Tier 1+2 diff is meaningful.
//
// Curation notes (NOT Acorn-comparable, excluded by design):
//   - `export { x }` with `x` undeclared — Acorn module-mode raises a
//     SEMANTIC "Export 'x' is not defined" error (a binding check, not a
//     syntax error). The native parser is a pure parser — no such check. So
//     every `export {}` corpus entry DECLARES its names first.
//   - private class fields `#name` — OUT of the D5 subset (roadmap K5 — M1
//     has no `#` lex branch). Covered nowhere.
//   - `await` / `yield` integrated INSIDE a larger expression — M4 (not M3.3).
//     M3.3's `await`/`yield` are exercised as statement leads inside
//     re-entered function bodies (the BlockStub re-entry describe block).
// -----------------------------------------------------------------------------
const DECL_MODULE_CORPUS = [
    // --- function declarations ---
    { name: "fn decl — no params",             src: "function f() {}" },
    { name: "fn decl — one param",             src: "function id(x) { return x; }" },
    { name: "fn decl — two params",            src: "function add(a, b) { return a + b; }" },
    { name: "fn decl — default param",         src: "function g(x = 1) { return x; }" },
    { name: "fn decl — rest param",            src: "function h(...xs) { return xs; }" },
    { name: "fn decl — body with decl + stmt", src: "function f() { let x = 1; use(x); }" },
    { name: "fn decl — nested fn decl",        src: "function outer() { function inner() {} return inner; }" },
    { name: "fn decl — control flow in body",  src: "function f(n) { if (n) return 1; return 0; }" },
    { name: "generator fn decl",               src: "function* gen() { return 1; }" },

    // --- class declarations ---
    { name: "class — empty",                   src: "class C {}" },
    { name: "class — extends",                 src: "class C extends Base {}" },
    { name: "class — extends member-access",   src: "class C extends ns.Base {}" },
    { name: "class — one method",              src: "class C { m() {} }" },
    { name: "class — constructor",             src: "class C { constructor(x) { this.x = x; } }" },
    { name: "class — two methods",             src: "class C { a() {} b() {} }" },
    { name: "class — static method",           src: "class C { static make() {} }" },
    { name: "class — getter",                  src: "class C { get v() { return 1; } }" },
    { name: "class — setter",                  src: "class C { set v(n) {} }" },
    { name: "class — get + set pair",          src: "class C { get v() { return 1; } set v(n) {} }" },
    { name: "class — generator method",        src: "class C { *gen() {} }" },
    { name: "class — class field",             src: "class C { x = 1; }" },
    { name: "class — uninitialized field",     src: "class C { x; }" },
    { name: "class — static field",            src: "class C { static s = 2; }" },
    { name: "class — computed method name",    src: "class C { ['m']() {} }" },
    { name: "class — method named static",     src: "class C { static() {} }" },
    { name: "class — method named get",        src: "class C { get() {} }" },
    { name: "class — keyword method name",     src: "class C { if() {} }" },
    { name: "class — full member mix",         src: "class P extends Q { constructor() {} static make() {} get v() { return 1; } m() {} f = 1; }" },

    // --- import statements ---
    { name: "import — default",                src: 'import d from "m";' },
    { name: "import — namespace",              src: 'import * as ns from "m";' },
    { name: "import — one named",              src: 'import { a } from "m";' },
    { name: "import — two named",              src: 'import { a, b } from "m";' },
    { name: "import — named alias",            src: 'import { a as x } from "m";' },
    { name: "import — default + named",        src: 'import d, { a, b } from "m";' },
    { name: "import — default + namespace",    src: 'import d, * as ns from "m";' },
    { name: "import — side-effect",            src: 'import "side-effect";' },

    // --- export statements ---
    { name: "export — let decl",               src: "export let x = 1;" },
    { name: "export — const decl",             src: "export const k = 9;" },
    { name: "export — function decl",          src: "export function f() {}" },
    { name: "export — class decl",             src: "export class C {}" },
    { name: "export — named clause",           src: "let a, b; export { a, b };" },
    { name: "export — named alias",            src: "let a; export { a as x };" },
    { name: "export — re-export named",        src: 'export { a, b } from "m";' },
    { name: "export — re-export all",          src: 'export * from "m";' },
    { name: "export — re-export namespace",    src: 'export * as ns from "m";' },
    { name: "export default — expression",     src: "export default 42;" },
    { name: "export default — function",       src: "export default function () {}" },
    { name: "export default — named function", src: "export default function named() {}" },
    { name: "export default — class",          src: "export default class {}" },

    // --- try / catch / finally + throw ---
    // M5-swap Wave 2 (B7): `try` / `throw` are FORBIDDEN scrml vocabulary —
    // the native parser parses them (for diagnostic recovery; the node-kind
    // sequence matches Acorn) but fires `E-TRY-NOT-IN-SCRML` /
    // `E-THROW-NOT-IN-SCRML`. The `forbidsVocab` tag marks entries whose
    // native parse carries those B7 diagnostics; the Tier-1 conformance
    // tolerates exactly those codes (the node-kind shape is still asserted).
    { name: "try-catch",                       src: "try { f(); } catch (e) { log(e); }", forbidsVocab: true },
    { name: "try-catch-finally",               src: "try { f(); } catch (e) {} finally { done(); }", forbidsVocab: true },
    { name: "try-finally (no catch)",          src: "try { f(); } finally { cleanup(); }", forbidsVocab: true },
    { name: "try — optional catch binding",    src: "try { f(); } catch { recover(); }", forbidsVocab: true },
    { name: "try — destructuring catch param", src: "try { f(); } catch ({ message }) { log(message); }", forbidsVocab: true },
    { name: "try — nested try in block",       src: "try { try { f(); } catch (e) {} } catch (e2) {}", forbidsVocab: true },
    { name: "throw — identifier",              src: "throw err;", forbidsVocab: true },
    { name: "throw — new expression",          src: "throw new Error('bad');", forbidsVocab: true },
    { name: "throw — inside a catch",          src: "try { f(); } catch (e) { throw e; }", forbidsVocab: true },

    // --- mixed declaration / module programs ---
    { name: "program — import then function",  src: 'import d from "m"; function use() { return d; }' },
    { name: "program — class then export",     src: "class C {} export const made = new C();" },
    { name: "program — fn decl + try",         src: "function f() {} try { f(); } catch (e) {}", forbidsVocab: true },
];

// FORBIDDEN_VOCAB_CODES — the B7 parse-layer rejection codes a `forbidsVocab`
// corpus entry is allowed to carry. The construct still parses (node-kind
// conformance holds); only these diagnostics are tolerated.
const FORBIDDEN_VOCAB_CODES = ["E-TRY-NOT-IN-SCRML", "E-THROW-NOT-IN-SCRML"];

// nonVocabErrors — the diagnostics of a native parse with the tolerated B7
// forbidden-vocabulary codes filtered out. For a non-`forbidsVocab` corpus
// entry this is the full error list.
function nonVocabErrors(errors) {
    return (errors || []).filter((e) => FORBIDDEN_VOCAB_CODES.includes(e.code) === false);
}

describe("M3.1 statement-parser conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of ACORN_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // The native parser must report NO diagnostics on a clean
            // M3.1-substrate program.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeProgramToEstree(n.body));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M3.1 statement-parser conformance — Tier 2 (identifier / literal values)", () => {
    for (const c of ACORN_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeProgramToEstree(n.body));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

describe("M3.2 control-flow conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of CONTROL_FLOW_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // The native parser must report NO diagnostics on a clean
            // M3.2-control-flow program.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeProgramToEstree(n.body));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M3.2 control-flow conformance — Tier 2 (identifier / literal / await values)", () => {
    for (const c of CONTROL_FLOW_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeProgramToEstree(n.body));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

describe("M3.3 decl/module/try conformance — Tier 1 (node-kind sequence)", () => {
    for (const c of DECL_MODULE_CORPUS) {
        test(`(tier1) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // The native parser must report NO diagnostics on a clean
            // M3.3-declaration/module/try-throw program — EXCEPT the B7
            // forbidden-vocabulary rejections (`E-TRY-NOT-IN-SCRML` /
            // `E-THROW-NOT-IN-SCRML`) a `forbidsVocab` entry carries by
            // design (M5-swap Wave 2 — `try`/`throw` are not scrml vocab).
            expect(nonVocabErrors(n.errors)).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeProgramToEstree(n.body));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M3.3 decl/module/try conformance — Tier 2 (identifier / literal / flag values)", () => {
    for (const c of DECL_MODULE_CORPUS) {
        test(`(tier2) ${c.name} — ${c.src}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeProgramToEstree(n.body));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M3.1 statement-parser — native AST shape. Asserts the native Stmt node
// shapes directly (not via the Acorn diff) — kind tags, declaration kind,
// binding-pattern structure.
// -----------------------------------------------------------------------------
describe("M3.1 statement-parser — native Stmt node shape", () => {
    test("empty statement — Empty node", () => {
        const r = parseWithNative(";");
        expect(r.ok).toBe(true);
        expect(r.body.length).toBe(1);
        expect(r.body[0].kind).toBe(StmtKind.Empty);
    });

    test("expression statement — ExprStmt wrapping an Expr", () => {
        const r = parseWithNative("foo();");
        expect(r.body[0].kind).toBe(StmtKind.ExprStmt);
        expect(r.body[0].expression.kind).toBe(ExprKind.Call);
    });

    test("block statement — Block with a Stmt body array", () => {
        const r = parseWithNative("{ a; b; }");
        expect(r.body[0].kind).toBe(StmtKind.Block);
        expect(r.body[0].body.length).toBe(2);
        expect(r.body[0].body[0].kind).toBe(StmtKind.ExprStmt);
    });

    test("var declaration — VarDecl carries declKind + declarators", () => {
        const r = parseWithNative("let x = 1, y = 2;");
        const decl = r.body[0];
        expect(decl.kind).toBe(StmtKind.VarDecl);
        expect(decl.declKind).toBe("let");
        expect(decl.declarations.length).toBe(2);
    });

    test("const / var declKind round-trips", () => {
        expect(parseWithNative("const k = 1;").body[0].declKind).toBe("const");
        expect(parseWithNative("var v = 1;").body[0].declKind).toBe("var");
    });

    test("declarator without initializer — init is absent", () => {
        const r = parseWithNative("let x;");
        const declarator = r.body[0].declarations[0];
        expect(declarator.target.bindingKind).toBe(BindingKind.Ident);
        expect(declarator.target.name).toBe("x");
        expect(declarator.init === null || declarator.init === undefined).toBe(true);
    });

    test("plain identifier binding — BindingIdent target", () => {
        const r = parseWithNative("let count = 0;");
        const declarator = r.body[0].declarations[0];
        expect(declarator.target.bindingKind).toBe(BindingKind.Ident);
        expect(declarator.target.name).toBe("count");
        expect(declarator.init.kind).toBe(ExprKind.NumberLit);
    });

    test("object pattern — ObjectPat with shorthand + keyed + rest", () => {
        const r = parseWithNative("let {a, b: c, ...rest} = o;");
        const target = r.body[0].declarations[0].target;
        expect(target.bindingKind).toBe(BindingKind.ObjectPat);
        expect(target.properties.length).toBe(3);
        expect(target.properties[0].propertyKind).toBe("Shorthand");
        expect(target.properties[1].propertyKind).toBe("KeyValue");
        expect(target.properties[2].propertyKind).toBe("Rest");
    });

    test("object pattern — shorthand with default is an AssignmentPattern", () => {
        const r = parseWithNative("let {a = 1} = o;");
        const prop = r.body[0].declarations[0].target.properties[0];
        expect(prop.propertyKind).toBe("Shorthand");
        expect(prop.value.bindingKind).toBe("AssignmentPattern");
    });

    test("array pattern — ArrayPat with item + hole + rest", () => {
        const r = parseWithNative("let [a, , ...tail] = xs;");
        const target = r.body[0].declarations[0].target;
        expect(target.bindingKind).toBe(BindingKind.ArrayPat);
        expect(target.elements.length).toBe(3);
        expect(target.elements[0].elementKind).toBe("Item");
        expect(target.elements[1].elementKind).toBe("Hole");
        expect(target.elements[2].elementKind).toBe("Rest");
    });

    test("array pattern — element default is an AssignmentPattern", () => {
        const r = parseWithNative("let [x = 0] = xs;");
        const el = r.body[0].declarations[0].target.elements[0];
        expect(el.elementKind).toBe("Item");
        expect(el.value.bindingKind).toBe("AssignmentPattern");
    });

    test("nested pattern — object pattern inside an array pattern", () => {
        const r = parseWithNative("let [{a}] = xs;");
        const el = r.body[0].declarations[0].target.elements[0];
        expect(el.elementKind).toBe("Item");
        expect(el.value.bindingKind).toBe(BindingKind.ObjectPat);
    });
});

// -----------------------------------------------------------------------------
// M3.1 statement-parser — ASI. Asserts automatic semicolon insertion: a
// statement boundary is accepted at a newline / `}` / EOF without an explicit
// `;`, and that the program splits into the same statement count Acorn produces.
// -----------------------------------------------------------------------------
describe("M3.1 statement-parser — automatic semicolon insertion", () => {
    test("bare identifier with no semicolon — one ExprStmt, no error", () => {
        const r = parseWithNative("foo");
        expect(r.body.length).toBe(1);
        expect(r.body[0].kind).toBe(StmtKind.ExprStmt);
        expect(r.errors).toEqual([]);
    });

    test("two statements separated only by a newline", () => {
        const r = parseWithNative("a\nb");
        expect(r.body.length).toBe(2);
        expect(r.errors).toEqual([]);
    });

    test("declaration ASI at a newline", () => {
        const r = parseWithNative("let x = 1\nlet y = 2");
        expect(r.body.length).toBe(2);
        expect(r.body.every((s) => s.kind === StmtKind.VarDecl)).toBe(true);
        expect(r.errors).toEqual([]);
    });

    test("ASI before a closing brace", () => {
        const r = parseWithNative("{ foo() }");
        expect(r.body[0].kind).toBe(StmtKind.Block);
        expect(r.body[0].body.length).toBe(1);
        expect(r.errors).toEqual([]);
    });

    test("missing semicolon on the same line records E-STMT-MISSING-SEMICOLON", () => {
        // Two expression statements on ONE line with no `;` — no ASI condition
        // holds (same line, next token is not `}` / EOF).
        const r = parseWithNative("foo bar");
        const codes = r.errors.map((e) => e.code);
        expect(codes).toContain("E-STMT-MISSING-SEMICOLON");
    });
});

// -----------------------------------------------------------------------------
// M3.1 statement-parser — BlockStub re-entry (THE load-bearing M3.1
// mechanism). M2.3 left function/arrow block bodies, and M2.4 left match-arm
// block bodies, as BlockStub Expr nodes capturing a token range.
// parseBlockStubBody re-parses any BlockStub into a real Stmt list.
// -----------------------------------------------------------------------------
describe("M3.1 statement-parser — BlockStub re-entry", () => {
    test("arrow block body — re-enters into a Stmt list", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("(a, b) => { let s = a + b; foo(s); }"));
        expect(e.ast.kind).toBe(ExprKind.Arrow);
        expect(e.ast.body.kind).toBe("BlockStub");

        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body.length).toBe(2);
        expect(re.body[0].kind).toBe(StmtKind.VarDecl);
        expect(re.body[1].kind).toBe(StmtKind.ExprStmt);
    });

    test("function-expression block body — re-enters into a Stmt list", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("function f(x) { let y = x; { y; } }"));
        expect(e.ast.kind).toBe(ExprKind.Function);
        expect(e.ast.body.kind).toBe("BlockStub");

        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body.length).toBe(2);
        expect(re.body[0].kind).toBe(StmtKind.VarDecl);
        expect(re.body[1].kind).toBe(StmtKind.Block);
    });

    test("empty block body — re-enters into an empty Stmt list", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("() => {}"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.body.length).toBe(0);
        expect(re.errors).toEqual([]);
    });

    test("match-arm block body — re-enters into a Stmt list", () => {
        // M2.4 captures `match` block-form arm bodies as BlockStubs.
        const e = scrmlNativeParseExpr(scrmlNativeLex("match x { .A => { foo(); }, else => bar }"));
        expect(e.ast.kind).toBe(ExprKind.Match);
        const blockArm = e.ast.arms[0];
        expect(blockArm.body.kind).toBe("BlockStub");

        const re = parseBlockStubBody(blockArm.body);
        expect(re.errors).toEqual([]);
        expect(re.body.length).toBe(1);
        expect(re.body[0].kind).toBe(StmtKind.ExprStmt);
    });

    test("nested block inside a block-stub body re-enters correctly", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("() => { { let a = 1; } foo(); }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body.length).toBe(2);
        expect(re.body[0].kind).toBe(StmtKind.Block);
        expect(re.body[0].body[0].kind).toBe(StmtKind.VarDecl);
        expect(re.body[1].kind).toBe(StmtKind.ExprStmt);
    });

    test("reenterBlockStubs deep-walk — attaches .parsedBody to every stub", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("(a) => { let g = (b) => { foo(b); }; }"));
        const count = reenterBlockStubs(e.ast);
        // Two stubs: the outer arrow body + the inner arrow body. M3.3 ties
        // off the function-expression body seam — parseVarDeclarator eagerly
        // re-enters a function/arrow initializer's BlockStub IN-LINE while
        // re-parsing the outer body. So by the time the deep-walk descends to
        // the inner arrow it already carries `.parsedBody` (idempotent skip)
        // — the deep-walk counts only the 1 stub it actually re-entered.
        // Both stubs end up re-entered (the assertions below) — the COUNT
        // reflects M3.3's eager in-line tie-off, not lost work.
        expect(count).toBe(1);
        expect(Array.isArray(e.ast.body.parsedBody)).toBe(true);
        expect(e.ast.body.parsedBody[0].kind).toBe(StmtKind.VarDecl);

        const innerArrow = e.ast.body.parsedBody[0].declarations[0].init;
        expect(innerArrow.kind).toBe(ExprKind.Arrow);
        expect(Array.isArray(innerArrow.body.parsedBody)).toBe(true);
        expect(innerArrow.body.parsedBody[0].kind).toBe(StmtKind.ExprStmt);
    });

    test("reenterBlockStubs is idempotent — a re-walk re-enters zero stubs", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("() => { foo(); }"));
        const first = reenterBlockStubs(e.ast);
        const second = reenterBlockStubs(e.ast);
        expect(first).toBe(1);
        expect(second).toBe(0);
    });

    test("re-entered block-stub body matches Acorn on the body statements", () => {
        // The body of `function f() { let x = 1; g(); }` re-parsed by M3.1
        // must produce the same Stmt sequence as the corresponding standalone
        // program `let x = 1; g();` parsed via parseProgram + Acorn.
        const e = scrmlNativeParseExpr(scrmlNativeLex("function f() { let x = 1; g(); }"));
        const re = parseBlockStubBody(e.ast.body);
        const reEstree = { type: "Program", body: re.body.map(nativeStmtToEstree) };

        const a = parseWithAcorn("let x = 1; g();");
        expect(a.ok).toBe(true);
        expect(nodeKindSequence(reEstree)).toEqual(nodeKindSequence(a.ast));
        expect(valueSequence(reEstree)).toEqual(valueSequence(a.ast));
    });
});

// -----------------------------------------------------------------------------
// Statement-parser — all D5 MUST-PARSE statement leads are now PARSED. M3.1
// forwarded the control-flow leads to M3.2; M3.2 forwarded the
// function/class/import/export/try/throw leads to M3.3 (the documented
// E-STMT-FORWARD-M3-3 seam). M3.3 lands those — so the forward seam is now
// CLOSED: no D5 statement lead records E-STMT-FORWARD-M3-3 any longer. This
// describe block CONVERTS the M3.1/M3.2 forward-seam tests into
// now-parsed assertions, pinning that the seam is closed.
// -----------------------------------------------------------------------------
describe("statement-parser — M3.3 closes the forward seam (all leads parsed)", () => {
    test("an `if` lead is parsed (no forward seam)", () => {
        const r = parseWithNative("if (a) b;");
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.If);
    });

    test("a `for` lead is parsed (no forward seam)", () => {
        const r = parseWithNative("for (;;) {}");
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.For);
    });

    test("a `while` lead is parsed (no forward seam)", () => {
        const r = parseWithNative("while (a) b;");
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.While);
    });

    test("a `function` declaration lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative("function f() {}");
        expect(r.errors).toEqual([]);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.FunctionDecl);
    });

    test("a `class` declaration lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative("class C {}");
        expect(r.errors).toEqual([]);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.ClassDecl);
    });

    test("an `import` lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative('import x from "m";');
        expect(r.errors).toEqual([]);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.Import);
    });

    test("an `export` lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative('export { a };');
        expect(r.errors).toEqual([]);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.Export);
    });

    test("a `try` lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative("try {} catch (e) {}");
        // The seam is closed iff `try` reaches M3.3 (no forward-seam code) and
        // builds a Try node. M5-swap Wave 2 (B7) adds `E-TRY-NOT-IN-SCRML` —
        // a forbidden-vocabulary rejection, NOT a seam failure — so the
        // assertion is seam-specific, not a blanket empty-error-list.
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.Try);
    });

    test("a `throw` lead is parsed by M3.3 (seam closed)", () => {
        const r = parseWithNative("throw e;");
        // As above — B7 adds `E-THROW-NOT-IN-SCRML`; the seam-closed assertion
        // checks the forward-seam code is absent and the Throw node is built.
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        expect(r.body[0].kind).toBe(StmtKind.Throw);
    });

    test("no D5 statement lead emits E-STMT-FORWARD-M3-3 any longer", () => {
        // The forward-seam diagnostic code is fully retired by M3.3 — exercise
        // every D5 declaration / module / legacy-error lead and confirm none
        // records it.
        const leads = [
            // M4.3 — `async function g() {}` removed: it now fires
            // E-ASYNC-NOT-IN-SCRML (a CLEAN diagnostic, but the test asserts
            // a clean error list, so we drop the async entry).
            "function f() {}", "function* h() {}",
            "class C {}", 'import x from "m";', 'export { a };',
            "export default 1;", "try {} finally {}", "throw e;",
        ];
        for (const src of leads) {
            const r = parseWithNative(src);
            expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-FORWARD-M3-3");
        }
    });
});

// -----------------------------------------------------------------------------
// M3.1 statement-parser — error paths. The parser records structured
// diagnostics and does NOT throw (the stage contract — diagnostics are
// objects, not exceptions).
// -----------------------------------------------------------------------------
describe("M3.1 statement-parser — error paths (diagnostics, no throw)", () => {
    test("an unclosed block records E-STMT-UNCLOSED-BLOCK", () => {
        const r = parseWithNative("{ foo();");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-BLOCK");
    });

    test("an unclosed object pattern records E-STMT-UNCLOSED-PATTERN", () => {
        const r = parseWithNative("let {a, b = o;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-PATTERN");
    });

    test("an unclosed array pattern records E-STMT-UNCLOSED-PATTERN", () => {
        const r = parseWithNative("let [a, b = xs;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-PATTERN");
    });

    test("a non-identifier binding target records E-STMT-BINDING-NAME", () => {
        const r = parseWithNative("let 5 = 1;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-BINDING-NAME");
    });
});

// -----------------------------------------------------------------------------
// M3.2 control-flow — native Stmt node shape. Asserts the native control-flow
// Stmt node shapes directly (not via the Acorn diff) — kind tags, the
// optional-child shape (no-else If, bare Return/Break), the for-head form
// classification, the labeled-statement label, the for-await flag.
// -----------------------------------------------------------------------------
describe("M3.2 control-flow — native Stmt node shape", () => {
    test("if — no else has a `not` alternate", () => {
        const r = parseWithNative("if (a) b();");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.If);
        expect(s.test.kind).toBe(ExprKind.Ident);
        expect(s.consequent.kind).toBe(StmtKind.ExprStmt);
        expect(s.alternate === null || s.alternate === undefined).toBe(true);
    });

    test("if — else if chain nests an If as the alternate", () => {
        const r = parseWithNative("if (a) p(); else if (b) q(); else r();");
        const outer = r.body[0];
        expect(outer.kind).toBe(StmtKind.If);
        expect(outer.alternate.kind).toBe(StmtKind.If);
        expect(outer.alternate.alternate.kind).toBe(StmtKind.ExprStmt);
    });

    test("while — While node carries test + body", () => {
        const r = parseWithNative("while (a) { step(); }");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.While);
        expect(s.body.kind).toBe(StmtKind.Block);
    });

    test("do-while — DoWhile node carries body + test", () => {
        const r = parseWithNative("do { foo(); } while (a);");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.DoWhile);
        expect(s.body.kind).toBe(StmtKind.Block);
        expect(s.test.kind).toBe(ExprKind.Ident);
    });

    test("for — C-style For node carries init/test/update/body", () => {
        const r = parseWithNative("for (let i = 0; i < 10; i++) { use(i); }");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.For);
        expect(s.init.kind).toBe(StmtKind.VarDecl);
        expect(s.test.kind).toBe(ExprKind.Binary);
        expect(s.update.kind).toBe(ExprKind.Update);
        expect(s.body.kind).toBe(StmtKind.Block);
    });

    test("for — empty clauses are `not`", () => {
        const r = parseWithNative("for (;;) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.For);
        expect(s.init === null || s.init === undefined).toBe(true);
        expect(s.test === null || s.test === undefined).toBe(true);
        expect(s.update === null || s.update === undefined).toBe(true);
    });

    test("for-in — ForIn node, declaration LHS is a VarDecl", () => {
        const r = parseWithNative("for (let k in obj) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForIn);
        expect(s.left.kind).toBe(StmtKind.VarDecl);
        expect(s.left.declarations.length).toBe(1);
        expect(s.right.kind).toBe(ExprKind.Ident);
    });

    test("for-in — non-declaration ident LHS is a BindingIdent (M4.2 K6)", () => {
        const r = parseWithNative("for (k in obj) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForIn);
        // M4.2 — non-declaration for-in/of LHS is converted to a binding
        // shape (the K6 unification). A plain identifier LHS becomes a
        // BindingIdent (`bindingKind: "Ident"`).
        expect(s.left.bindingKind).toBe(BindingKind.Ident);
        expect(s.left.name).toBe("k");
    });

    test("for-in — member-expression LHS stays an Expr (M4.2 K6)", () => {
        const r = parseWithNative("for (o.k in src) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForIn);
        // A member expression is a legal assignment-target expression for a
        // for-in LHS; toBindingPattern leaves it as the expression node
        // (ESTree treats it the same way).
        expect(s.left.kind).toBe(ExprKind.Member);
    });

    test("for-of — non-declaration object-pattern LHS (M4.2 K6)", () => {
        const r = parseWithNative("for ({a} of items) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForOf);
        // M4.2 — non-declaration destructuring LHS is a REAL binding
        // pattern (the K6 closure).
        expect(s.left.bindingKind).toBe(BindingKind.ObjectPat);
    });

    test("for-of — non-declaration array-pattern LHS (M4.2 K6)", () => {
        const r = parseWithNative("for ([a, b] of pairs) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForOf);
        expect(s.left.bindingKind).toBe(BindingKind.ArrayPat);
    });

    test("for-of — ForOf node, isAwait false for a plain for-of", () => {
        const r = parseWithNative("for (const x of xs) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForOf);
        expect(s.left.kind).toBe(StmtKind.VarDecl);
        expect(s.isAwait).toBe(false);
    });

    test("`for await ...` fires E-FOR-AWAIT-NOT-IN-SCRML; ForOf recovers with isAwait false (M4.3)", () => {
        const r = parseWithNative("for await (const c of stream) {}");
        expect(r.errors.map((e) => e.code)).toContain("E-FOR-AWAIT-NOT-IN-SCRML");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForOf);
        // RECOVERY — the for-of parses; `isAwait` is forced false.
        expect(s.isAwait).toBe(false);
    });

    test("for-of — declaration array pattern LHS", () => {
        const r = parseWithNative("for (const [a, b] of pairs) {}");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.ForOf);
        expect(s.left.kind).toBe(StmtKind.VarDecl);
        expect(s.left.declarations[0].target.bindingKind).toBe(BindingKind.ArrayPat);
    });

    test("break — unlabeled break has a `not` label", () => {
        const r = parseWithNative("while (a) { break; }");
        const brk = r.body[0].body.body[0];
        expect(brk.kind).toBe(StmtKind.Break);
        expect(brk.label === null || brk.label === undefined).toBe(true);
    });

    test("continue — unlabeled continue has a `not` label", () => {
        const r = parseWithNative("while (a) { continue; }");
        const cont = r.body[0].body.body[0];
        expect(cont.kind).toBe(StmtKind.Continue);
        expect(cont.label === null || cont.label === undefined).toBe(true);
    });

    test("labeled break — Break node carries the label text", () => {
        const r = parseWithNative("outer: for (;;) { break outer; }");
        const labeled = r.body[0];
        expect(labeled.kind).toBe(StmtKind.Labeled);
        expect(labeled.label).toBe("outer");
        const brk = labeled.body.body.body[0];
        expect(brk.kind).toBe(StmtKind.Break);
        expect(brk.label).toBe("outer");
    });

    test("labeled continue — Continue node carries the label text", () => {
        const r = parseWithNative("loop: while (a) { continue loop; }");
        const cont = r.body[0].body.body.body[0];
        expect(cont.kind).toBe(StmtKind.Continue);
        expect(cont.label).toBe("loop");
    });

    test("labeled statement — Labeled wraps the named statement", () => {
        const r = parseWithNative("blk: { foo(); }");
        const s = r.body[0];
        expect(s.kind).toBe(StmtKind.Labeled);
        expect(s.label).toBe("blk");
        expect(s.body.kind).toBe(StmtKind.Block);
    });

    test("a `Type::Variant` lead is an ExprStmt, NOT a labeled statement", () => {
        // `Color::Red` — two adjacent `:` tokens after the identifier. M3.2's
        // label check requires the token after the `:` to NOT be a `:`.
        const r = parseWithNative("Color::Red;");
        expect(r.body[0].kind).toBe(StmtKind.ExprStmt);
    });
});

// -----------------------------------------------------------------------------
// M3.2 control-flow — `return` via BlockStub re-entry. A top-level `return` is
// a SyntaxError (Acorn rejects it) — so `return` is exercised inside a
// function body, where it is legal. The body is captured as a BlockStub by
// M2.3 and re-parsed by M3.1's parseBlockStubBody (now M3.2-aware).
// -----------------------------------------------------------------------------
describe("M3.2 control-flow — `return` + control flow inside a re-entered body", () => {
    test("bare return — Return node with a `not` argument", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("function f() { return; }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body[0].kind).toBe(StmtKind.Return);
        expect(re.body[0].argument === null || re.body[0].argument === undefined).toBe(true);
    });

    test("return with an argument — Return node carries the Expr", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("function f() { return a + b; }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body[0].kind).toBe(StmtKind.Return);
        expect(re.body[0].argument.kind).toBe(ExprKind.Binary);
    });

    test("a function body with a for loop + if re-enters cleanly", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex(
            "function f() { for (let i = 0; i < n; i++) { if (at(i)) return i; } }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body[0].kind).toBe(StmtKind.For);
        const innerIf = re.body[0].body.body[0];
        expect(innerIf.kind).toBe(StmtKind.If);
        expect(innerIf.consequent.kind).toBe(StmtKind.Return);
    });

    test("a re-entered body with a while loop matches Acorn", () => {
        // `function f() { let i = 0; while (i < n) { i++; } }` re-parsed by
        // M3.2 must match Acorn on the body of the equivalent program.
        const e = scrmlNativeParseExpr(scrmlNativeLex(
            "function f() { let i = 0; while (i < n) { i++; } }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        const reEstree = { type: "Program", body: re.body.map(nativeStmtToEstree) };

        const a = parseWithAcorn("let i = 0; while (i < n) { i++; }");
        expect(a.ok).toBe(true);
        expect(nodeKindSequence(reEstree)).toEqual(nodeKindSequence(a.ast));
        expect(valueSequence(reEstree)).toEqual(valueSequence(a.ast));
    });
});

// -----------------------------------------------------------------------------
// M4.2 — `noIn` flag + destructuring unification. The for-head ambiguity is
// resolved by parsing the init / LHS clause with ctx.noIn set; the `in`
// keyword is suppressed by parseBinary while noIn is true (M3.2's forHeadKind
// depth-scan is gone). Sub-expression groupings (paren / array / object /
// call args / template `${}`) re-open the `in` operator via the no-In
// carve-out helpers.
// -----------------------------------------------------------------------------
describe("M4.2 — noIn flag in `for` head", () => {
    test("for-head `in` inside a paren is legal (`for (let i = (a in b); ...)`)", () => {
        const r = parseWithNative("for (let i = (a in b); i < n; i++) {}");
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.For);
        // The init's declarator's init is a paren-wrapped BinaryExpression with
        // operator "in" — confirming noIn was REOPENED inside the paren.
        const initExpr = r.body[0].init.declarations[0].init;
        expect(initExpr.kind).toBe(ExprKind.Paren);
        expect(initExpr.expression.kind).toBe(ExprKind.Binary);
        expect(initExpr.expression.op).toBe("in");
    });

    test("for-head `in` inside a call argument is legal (`for (let i = f(a in b); ...)`)", () => {
        const r = parseWithNative("for (let i = f(a in b); i < n; i++) {}");
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
        const callArg = r.body[0].init.declarations[0].init.args[0];
        expect(callArg.kind).toBe(ExprKind.Binary);
        expect(callArg.op).toBe("in");
    });

    test("for-head `in` inside an array element is legal", () => {
        const r = parseWithNative("for (let i = [a in b][0]; i < n; i++) {}");
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.For);
    });

    test("for-in head dispatches on the trailing `in` (no depth-scan)", () => {
        // The depth-scan-free dispatch: parseBinary stops the climb at `in`
        // when noIn is set, and parseFor sees `in` next.
        const r = parseWithNative("for (k in obj) {}");
        expect(r.ok).toBe(true);
        expect(r.body[0].kind).toBe(StmtKind.ForIn);
    });

    test("for-of head dispatches on the trailing `of`", () => {
        const r = parseWithNative("for (x of xs) {}");
        expect(r.ok).toBe(true);
        expect(r.body[0].kind).toBe(StmtKind.ForOf);
    });

    test("non-decl destructuring LHS — for-of with object pattern", () => {
        const r = parseWithNative("for ({a, b} of pairs) {}");
        expect(r.ok).toBe(true);
        expect(r.body[0].kind).toBe(StmtKind.ForOf);
        // toBindingPattern converts the Object literal to an ObjectPattern.
        expect(r.body[0].left.bindingKind).toBe(BindingKind.ObjectPat);
    });

    test("non-decl destructuring LHS — for-in with array pattern", () => {
        const r = parseWithNative("for ([a, b] in src) {}");
        expect(r.ok).toBe(true);
        expect(r.body[0].kind).toBe(StmtKind.ForIn);
        expect(r.body[0].left.bindingKind).toBe(BindingKind.ArrayPat);
    });

    test("non-decl member-expression LHS passes through (no toBindingPattern)", () => {
        const r = parseWithNative("for (o.k in src) {}");
        expect(r.ok).toBe(true);
        expect(r.body[0].kind).toBe(StmtKind.ForIn);
        // toBindingPattern leaves a member expression as the expression node.
        expect(r.body[0].left.kind).toBe(ExprKind.Member);
    });
});

describe("M4.2 — K6 destructuring unification (function params)", () => {
    test("ident param is a BindingIdent (M4.2)", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("(x) => x"));
        expect(e.errors).toEqual([]);
        expect(e.ast.params[0].bindingKind).toBe(BindingKind.Ident);
        expect(e.ast.params[0].name).toBe("x");
    });

    test("object-destructuring param is an ObjectPattern (M4.2 K6)", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("({a, b}) => a + b"));
        expect(e.errors).toEqual([]);
        // M4.2 — was an Object LITERAL stand-in pre-M4.2; now a real binding.
        expect(e.ast.params[0].bindingKind).toBe(BindingKind.ObjectPat);
    });

    test("array-destructuring param is an ArrayPattern (M4.2 K6)", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("([a, b]) => a + b"));
        expect(e.errors).toEqual([]);
        expect(e.ast.params[0].bindingKind).toBe(BindingKind.ArrayPat);
    });

    test("destructuring param with a default — AssignmentPattern wrapping ObjectPattern", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("({a} = {}) => a"));
        expect(e.errors).toEqual([]);
        expect(e.ast.params[0].bindingKind).toBe("AssignmentPattern");
        expect(e.ast.params[0].left.bindingKind).toBe(BindingKind.ObjectPat);
    });
});

// -----------------------------------------------------------------------------
// M3.2 control-flow — error paths + subset bound. The parser records
// structured diagnostics and does NOT throw. `switch` is outside the S98 D5
// subset (and E-SWITCH-FORBIDDEN in scrml source per §17) — M3.2 does NOT add
// it; it surfaces as an unparsed lead, not a silent scope widening.
// -----------------------------------------------------------------------------
describe("M3.2 control-flow — error paths (diagnostics, no throw)", () => {
    test("a stray `else` records E-STMT-STRAY-ELSE", () => {
        const r = parseWithNative("else b();");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-STRAY-ELSE");
    });

    test("an `if` head with no `(` records E-STMT-EXPECT-LPAREN", () => {
        const r = parseWithNative("if a) b;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-EXPECT-LPAREN");
    });

    test("a `for` head missing a `;` separator records E-STMT-FOR-SEMICOLON", () => {
        const r = parseWithNative("for (let i = 0 i < n; i++) {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-FOR-SEMICOLON");
    });

    test("a for-in/of binding with an initializer records E-STMT-FOR-BINDING-INIT", () => {
        const r = parseWithNative("for (let k = 1 in obj) {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-FOR-BINDING-INIT");
    });

    test("`for await (;;) {}` fires E-FOR-AWAIT-NOT-IN-SCRML (M4.3 — the prior E-STMT-FOR-AWAIT-CSTYLE check is gone)", () => {
        const r = parseWithNative("for await (;;) {}");
        expect(r.ok).toBe(true);
        const codes = r.errors.map((e) => e.code);
        expect(codes).toContain("E-FOR-AWAIT-NOT-IN-SCRML");
        // M4.3 retracts `for await ...` itself, so the per-shape
        // (C-style only) check is dropped.
        expect(codes).not.toContain("E-STMT-FOR-AWAIT-CSTYLE");
    });

    test("`switch` is NOT in the M3.2 subset — it is not parsed as a switch", () => {
        // `switch` is out of the S98 D5 subset; M3.2 does NOT widen scope to
        // add it. The native parser produces NO `Switch` Stmt kind — the lead
        // surfaces as an ordinary unparsed token, not a silent acceptance.
        const r = parseWithNative("switch (x) {}");
        expect(r.ok).toBe(true);
        const kinds = r.body.map((s) => s.kind);
        expect(kinds).not.toContain("Switch");
    });
});

// -----------------------------------------------------------------------------
// M3.3 statement-parser — native AST shape (functions / classes / module /
// try-throw). Asserts the native Stmt node shapes directly — kind tags,
// async/generator flags, the in-line function body, class-member structure,
// import/export specifier shapes, try/catch/finally structure.
// -----------------------------------------------------------------------------
describe("M3.3 statement-parser — function declarations (native shape)", () => {
    test("function declaration — FunctionDecl node, in-line Stmt body", () => {
        const r = parseWithNative("function f(x) { let y = x; return y; }");
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
        const fn = r.body[0];
        expect(fn.kind).toBe(StmtKind.FunctionDecl);
        expect(fn.name).toBe("f");
        expect(fn.isAsync).toBe(false);
        expect(fn.isGenerator).toBe(false);
        // The body is a parsed Stmt ARRAY — NOT a BlockStub. This is the
        // body-pre-parser subsumption (the body is parsed in-line).
        expect(Array.isArray(fn.body)).toBe(true);
        expect(fn.body.length).toBe(2);
        expect(fn.body[0].kind).toBe(StmtKind.VarDecl);
        expect(fn.body[1].kind).toBe(StmtKind.Return);
    });

    test("`async function load() {}` — M4.3: fires E-ASYNC-NOT-IN-SCRML, isAsync recovers to false", () => {
        const r = parseWithNative("async function load() {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(r.body[0].kind).toBe(StmtKind.FunctionDecl);
        // RECOVERY — the FunctionDecl still parses; `isAsync` is forced
        // false (M4.3 retraction).
        expect(r.body[0].isAsync).toBe(false);
        expect(r.body[0].isGenerator).toBe(false);
    });

    test("generator function declaration — isGenerator true", () => {
        const r = parseWithNative("function* gen() {}");
        expect(r.errors).toEqual([]);
        expect(r.body[0].isGenerator).toBe(true);
        expect(r.body[0].isAsync).toBe(false);
    });

    test("`async function* ag() {}` — M4.3: fires E-ASYNC-NOT-IN-SCRML, recovers as a plain generator", () => {
        const r = parseWithNative("async function* ag() {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        // RECOVERY — the `async` is dropped; the `function*` survives so
        // generators (which are PRESERVED in M4.3) keep working.
        expect(r.body[0].isAsync).toBe(false);
        expect(r.body[0].isGenerator).toBe(true);
    });

    test("nested function declaration re-parses in-line", () => {
        const r = parseWithNative("function outer() { function inner() { return 1; } }");
        expect(r.errors).toEqual([]);
        const outer = r.body[0];
        expect(outer.body[0].kind).toBe(StmtKind.FunctionDecl);
        expect(outer.body[0].name).toBe("inner");
        expect(outer.body[0].body[0].kind).toBe(StmtKind.Return);
    });
});

describe("M3.3 statement-parser — class declarations (native shape)", () => {
    test("class declaration — ClassDecl node", () => {
        const r = parseWithNative("class C {}");
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.ClassDecl);
        expect(r.body[0].name).toBe("C");
        expect(r.body[0].superClass).toBe(null);
        expect(r.body[0].body).toEqual([]);
    });

    test("class with extends — superClass populated", () => {
        const r = parseWithNative("class C extends Base {}");
        expect(r.errors).toEqual([]);
        expect(r.body[0].superClass).not.toBe(null);
        expect(r.body[0].superClass.kind).toBe(ExprKind.Ident);
        expect(r.body[0].superClass.name).toBe("Base");
    });

    test("class method — Method member, in-line body", () => {
        const r = parseWithNative("class C { m() { return 1; } }");
        expect(r.errors).toEqual([]);
        const m = r.body[0].body[0];
        expect(m.memberKind).toBe(ClassMemberKind.Method);
        expect(m.methodKind).toBe("method");
        expect(m.isStatic).toBe(false);
        expect(m.key.name).toBe("m");
        // The method value is a Function whose body is a parsed Stmt array.
        expect(m.value.kind).toBe("Function");
        expect(Array.isArray(m.value.body)).toBe(true);
        expect(m.value.body[0].kind).toBe(StmtKind.Return);
    });

    test("class constructor — methodKind constructor", () => {
        const r = parseWithNative("class C { constructor(x) { this.x = x; } }");
        expect(r.errors).toEqual([]);
        const m = r.body[0].body[0];
        expect(m.methodKind).toBe("constructor");
    });

    test("class static method — isStatic true", () => {
        const r = parseWithNative("class C { static make() {} }");
        expect(r.errors).toEqual([]);
        expect(r.body[0].body[0].isStatic).toBe(true);
        expect(r.body[0].body[0].key.name).toBe("make");
    });

    test("class getter / setter — methodKind get / set", () => {
        const r = parseWithNative("class C { get v() { return 1; } set v(n) {} }");
        expect(r.errors).toEqual([]);
        expect(r.body[0].body[0].methodKind).toBe("get");
        expect(r.body[0].body[1].methodKind).toBe("set");
    });

    test("class generator method preserved; async-method fires E-ASYNC-NOT-IN-SCRML (M4.3)", () => {
        const r = parseWithNative("class C { async load() {} *gen() {} }");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        // RECOVERY — `async load()` becomes a plain method; `*gen()`
        // (generator method) is PRESERVED unchanged.
        expect(r.body[0].body[0].value.isAsync).toBe(false);
        expect(r.body[0].body[1].value.isGenerator).toBe(true);
    });

    test("class field — Property member", () => {
        const r = parseWithNative("class C { x = 1; }");
        expect(r.errors).toEqual([]);
        const f = r.body[0].body[0];
        expect(f.memberKind).toBe(ClassMemberKind.Property);
        expect(f.key.name).toBe("x");
        expect(f.value.kind).toBe(ExprKind.NumberLit);
    });

    test("class uninitialized field — value is not", () => {
        const r = parseWithNative("class C { x; }");
        expect(r.errors).toEqual([]);
        const f = r.body[0].body[0];
        expect(f.memberKind).toBe(ClassMemberKind.Property);
        expect(f.value === undefined || f.value === null).toBe(true);
    });

    test("class computed method name — computed true", () => {
        const r = parseWithNative("class C { ['m']() {} }");
        expect(r.errors).toEqual([]);
        expect(r.body[0].body[0].computed).toBe(true);
    });

    test("a method named `static` is a method, not a static prefix", () => {
        const r = parseWithNative("class C { static() {} }");
        expect(r.errors).toEqual([]);
        const m = r.body[0].body[0];
        expect(m.isStatic).toBe(false);
        expect(m.key.name).toBe("static");
    });

    test("a method named `get` is a method, not an accessor prefix", () => {
        const r = parseWithNative("class C { get() { return 1; } }");
        expect(r.errors).toEqual([]);
        const m = r.body[0].body[0];
        expect(m.methodKind).toBe("method");
        expect(m.key.name).toBe("get");
    });

    test("an identifier named `constructor` lexes correctly (K7 — prototype pollution fixed)", () => {
        // `constructor` is an Object.prototype member name — the M1 lexer's
        // JS_KEYWORDS lookup must use an own-property guard or it mis-lexes.
        const r = parseWithNative("class C { constructor() {} }");
        expect(r.errors).toEqual([]);
        expect(r.body[0].body[0].methodKind).toBe("constructor");
        // The same name as a plain method-call identifier.
        const r2 = parseWithNative("let obj = {}; obj.constructor;");
        expect(r2.errors).toEqual([]);
    });
});

describe("M3.3 statement-parser — import / export (native shape)", () => {
    test("default import — ImportDefault specifier", () => {
        const r = parseWithNative('import d from "m";');
        expect(r.errors).toEqual([]);
        const imp = r.body[0];
        expect(imp.kind).toBe(StmtKind.Import);
        expect(imp.source).toBe("m");
        expect(imp.specifiers.length).toBe(1);
        expect(imp.specifiers[0].specifierKind).toBe("Default");
        expect(imp.specifiers[0].local).toBe("d");
    });

    test("namespace import — ImportNamespace specifier", () => {
        const r = parseWithNative('import * as ns from "m";');
        expect(r.errors).toEqual([]);
        expect(r.body[0].specifiers[0].specifierKind).toBe("Namespace");
        expect(r.body[0].specifiers[0].local).toBe("ns");
    });

    test("named imports with alias — ImportNamed specifiers", () => {
        const r = parseWithNative('import { a, b as c } from "m";');
        expect(r.errors).toEqual([]);
        const specs = r.body[0].specifiers;
        expect(specs.length).toBe(2);
        expect(specs[0].specifierKind).toBe("Named");
        expect(specs[0].imported).toBe("a");
        expect(specs[0].local).toBe("a");
        expect(specs[1].imported).toBe("b");
        expect(specs[1].local).toBe("c");
    });

    test("side-effect import — empty specifier list", () => {
        const r = parseWithNative('import "side-effect";');
        expect(r.errors).toEqual([]);
        expect(r.body[0].specifiers).toEqual([]);
        expect(r.body[0].source).toBe("side-effect");
    });

    test("export declaration — declaration populated, not default", () => {
        const r = parseWithNative("export const k = 1;");
        expect(r.errors).toEqual([]);
        const exp = r.body[0];
        expect(exp.kind).toBe(StmtKind.Export);
        expect(exp.isDefault).toBe(false);
        expect(exp.declaration.kind).toBe(StmtKind.VarDecl);
    });

    test("export named clause — ExportSpecifier list", () => {
        const r = parseWithNative("let a, b; export { a, b as c };");
        expect(r.errors).toEqual([]);
        const exp = r.body[1];
        expect(exp.specifiers.length).toBe(2);
        expect(exp.specifiers[0].local).toBe("a");
        expect(exp.specifiers[1].local).toBe("b");
        expect(exp.specifiers[1].exported).toBe("c");
    });

    test("re-export — source populated", () => {
        const r = parseWithNative('export { a } from "m";');
        expect(r.errors).toEqual([]);
        expect(r.body[0].source).toBe("m");
    });

    test("export default — isDefault true", () => {
        const r = parseWithNative("export default 42;");
        expect(r.errors).toEqual([]);
        expect(r.body[0].isDefault).toBe(true);
    });

    test("export default function — anonymous allowed", () => {
        const r = parseWithNative("export default function () {}");
        expect(r.errors).toEqual([]);
        expect(r.body[0].isDefault).toBe(true);
        expect(r.body[0].declaration.kind).toBe(StmtKind.FunctionDecl);
        expect(r.body[0].declaration.name).toBe("");
    });
});

// M5-swap Wave 2 (B7): `try` / `throw` are forbidden scrml vocabulary — the
// native parser parses them for diagnostic recovery (the node shape these
// tests assert is intact) but fires `E-TRY-NOT-IN-SCRML` / `E-THROW-NOT-IN-
// SCRML`. These tests assert the RECOVERY-PARSE SHAPE, so the error list is
// checked with the B7 forbidden-vocabulary codes filtered out.
describe("M3.3 statement-parser — try / catch / finally + throw (native shape)", () => {
    test("try-catch — Try node, handler populated", () => {
        const r = parseWithNative("try { f(); } catch (e) { log(e); }");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        const t = r.body[0];
        expect(t.kind).toBe(StmtKind.Try);
        expect(t.block.kind).toBe(StmtKind.Block);
        expect(t.handler).not.toBe(null);
        expect(t.handler.param.bindingKind).toBe(BindingKind.Ident);
        expect(t.handler.param.name).toBe("e");
        expect(t.finalizer === undefined || t.finalizer === null).toBe(true);
    });

    test("try-catch-finally — handler + finalizer populated", () => {
        const r = parseWithNative("try { f(); } catch (e) {} finally { done(); }");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        const t = r.body[0];
        expect(t.handler).not.toBe(null);
        expect(t.finalizer).not.toBe(null);
        expect(t.finalizer.kind).toBe(StmtKind.Block);
    });

    test("try-finally with no catch — handler is not", () => {
        const r = parseWithNative("try { f(); } finally { cleanup(); }");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        const t = r.body[0];
        expect(t.handler === undefined || t.handler === null).toBe(true);
        expect(t.finalizer).not.toBe(null);
    });

    test("optional catch binding — param is not", () => {
        const r = parseWithNative("try { f(); } catch { recover(); }");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        const t = r.body[0];
        expect(t.handler).not.toBe(null);
        expect(t.handler.param === undefined || t.handler.param === null).toBe(true);
    });

    test("destructuring catch param — ObjectPat binding", () => {
        const r = parseWithNative("try { f(); } catch ({ message }) {}");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        expect(r.body[0].handler.param.bindingKind).toBe(BindingKind.ObjectPat);
    });

    test("throw — Throw node, argument populated", () => {
        const r = parseWithNative("throw err;");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        const t = r.body[0];
        expect(t.kind).toBe(StmtKind.Throw);
        expect(t.argument.kind).toBe(ExprKind.Ident);
        expect(t.argument.name).toBe("err");
    });

    test("throw new Error — argument is a New expression", () => {
        const r = parseWithNative("throw new Error('bad');");
        expect(nonVocabErrors(r.errors)).toEqual([]);
        expect(r.body[0].argument.kind).toBe(ExprKind.New);
    });
});

// -----------------------------------------------------------------------------
// M3.3 statement-parser — the body-pre-parser subsumption. M3 parses function
// bodies IN-LINE: a function-declaration body is a parsed Stmt array, NOT a
// token-range stub. M3.3 also TIES OFF the function-expression body seam — a
// function / arrow EXPRESSION at statement position has its M2.3 BlockStub
// body re-entered in-line. This is what makes body-pre-parser.ts deletable.
// -----------------------------------------------------------------------------
describe("M3.3 statement-parser — BPP subsumption (function bodies in-line)", () => {
    test("a function declaration body is a parsed Stmt array (no BlockStub)", () => {
        const r = parseWithNative("function f() { let x = 1; g(x); }");
        expect(r.errors).toEqual([]);
        const body = r.body[0].body;
        expect(Array.isArray(body)).toBe(true);
        // No node in the body carries the BlockStub kind.
        for (const stmt of body) {
            expect(stmt.kind).not.toBe("BlockStub");
        }
        expect(body[0].kind).toBe(StmtKind.VarDecl);
        expect(body[1].kind).toBe(StmtKind.ExprStmt);
    });

    test("a function-expression IIFE at statement position has its body re-entered", () => {
        // M2.3 parses the function expression with a BlockStub body; M3.3's
        // parseExprStatement tie-off reenters it -> .parsedBody set.
        const r = parseWithNative("(function () { let a = 1; use(a); })();");
        expect(r.errors).toEqual([]);
        const exprStmt = r.body[0];
        expect(exprStmt.kind).toBe(StmtKind.ExprStmt);
        // The expression is a Call whose callee is a Paren-wrapped Function.
        // Find the Function node and confirm its body is re-entered.
        let found = null;
        const visit = (n) => {
            if (n === undefined || n === null || typeof n !== "object") return;
            if (n.kind === ExprKind.Function) found = n;
            for (const k of Object.keys(n)) {
                const c = n[k];
                if (Array.isArray(c)) c.forEach(visit);
                else if (c && typeof c === "object") visit(c);
            }
        };
        visit(exprStmt);
        expect(found).not.toBe(null);
        expect(Array.isArray(found.body.parsedBody)).toBe(true);
        expect(found.body.parsedBody[0].kind).toBe(StmtKind.VarDecl);
    });

    test("a declarator-initializer function expression has its body re-entered", () => {
        const r = parseWithNative("let g = function () { return 1; };");
        expect(r.errors).toEqual([]);
        const init = r.body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Function);
        expect(Array.isArray(init.body.parsedBody)).toBe(true);
        expect(init.body.parsedBody[0].kind).toBe(StmtKind.Return);
    });

    test("an arrow declarator-initializer has its block body re-entered", () => {
        const r = parseWithNative("let f = (x) => { return x; };");
        expect(r.errors).toEqual([]);
        const init = r.body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Arrow);
        expect(Array.isArray(init.body.parsedBody)).toBe(true);
    });

    test("`await` statement lead inside a function body fires E-AWAIT-NOT-IN-SCRML; recovery yields a plain ExprStmt (M4.3)", () => {
        const r = parseWithNative("async function g() { await fetch(); }");
        const codes = r.errors.map((e) => e.code);
        expect(codes).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(codes).toContain("E-AWAIT-NOT-IN-SCRML");
        const body = r.body[0].body;
        expect(body[0].kind).toBe(StmtKind.ExprStmt);
        // RECOVERY — no Await node; the operand is the bare Call.
        expect(body[0].expression.kind).toBe(ExprKind.Call);
    });

    test("yield + yield* statement leads inside a re-entered generator body", () => {
        const r = parseWithNative("function* gen() { yield 1; yield* xs; }");
        expect(r.errors).toEqual([]);
        const body = r.body[0].body;
        expect(body[0].expression.kind).toBe("Yield");
        expect(body[0].expression.delegate).toBe(false);
        expect(body[1].expression.kind).toBe("Yield");
        expect(body[1].expression.delegate).toBe(true);
    });

    test("a bare `yield;` is a yield with no argument", () => {
        const r = parseWithNative("function* gen() { yield; }");
        expect(r.errors).toEqual([]);
        const y = r.body[0].body[0].expression;
        expect(y.kind).toBe("Yield");
        expect(y.argument === undefined || y.argument === null).toBe(true);
    });

    test("the M3.3-parsed function body matches Acorn on the body statements", () => {
        // `function f() { let x = 1; if (x) g(); }` re-parsed in-line must
        // produce the same Stmt sequence as the standalone program.
        const r = parseWithNative("function f() { let x = 1; if (x) g(); }");
        expect(r.errors).toEqual([]);
        const bodyEstree = { type: "Program", body: r.body[0].body.map(nativeStmtToEstree) };
        const a = parseWithAcorn("let x = 1; if (x) g();");
        expect(a.ok).toBe(true);
        expect(nodeKindSequence(bodyEstree)).toEqual(nodeKindSequence(a.ast));
        expect(valueSequence(bodyEstree)).toEqual(valueSequence(a.ast));
    });
});

// -----------------------------------------------------------------------------
// M3.3 statement-parser — error paths. The parser records structured
// diagnostics and does NOT throw (the stage contract — diagnostics are
// objects, not exceptions).
// -----------------------------------------------------------------------------
describe("M3.3 statement-parser — error paths (diagnostics, no throw)", () => {
    test("a function declaration with no name records E-STMT-FUNCTION-NAME", () => {
        const r = parseWithNative("function () {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-FUNCTION-NAME");
    });

    test("a class declaration with no name records E-STMT-CLASS-NAME", () => {
        const r = parseWithNative("class {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-CLASS-NAME");
    });

    test("an unclosed function body records E-STMT-UNCLOSED-FUNCTION-BODY", () => {
        const r = parseWithNative("function f() { g();");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-FUNCTION-BODY");
    });

    test("an unclosed class body records E-STMT-UNCLOSED-CLASS-BODY", () => {
        const r = parseWithNative("class C { m() {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-CLASS-BODY");
    });

    test("a namespace import missing `as` records E-STMT-EXPECT-AS", () => {
        const r = parseWithNative('import * ns from "m";');
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-EXPECT-AS");
    });

    test("an import missing `from` records E-STMT-EXPECT-FROM", () => {
        const r = parseWithNative('import { a } "m";');
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-EXPECT-FROM");
    });

    test("an unclosed import clause records E-STMT-UNCLOSED-IMPORT", () => {
        const r = parseWithNative('import { a, b from "m";');
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNCLOSED-IMPORT");
    });

    test("a bare `try {}` with no catch / finally records E-STMT-TRY-NO-HANDLER", () => {
        const r = parseWithNative("try { f(); }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-TRY-NO-HANDLER");
    });

    test("a `throw` with nothing on its line records E-STMT-THROW-NO-ARGUMENT", () => {
        const r = parseWithNative("throw\nx;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-THROW-NO-ARGUMENT");
    });

    test("the parser does not throw on a malformed declaration program", () => {
        // A pile of malformed declaration / module fragments — the parser
        // must return structured diagnostics, never raise.
        const sources = [
            "function", "class extends", "import from", "export",
            "try", "throw", "function* () {", "class C { get",
        ];
        for (const src of sources) {
            const r = parseWithNative(src);
            expect(r.ok).toBe(true);   // ok:true means "did not throw"
        }
    });
});

// =============================================================================
// M3.4 — error-recovery engine integration + return-legality + full statement
// conformance. M3.4 is the FINAL M3 sub-step (it completes the M3 milestone).
//
// Per the S98 DD §D7 M3 gating criterion:
//   "Conformance Tier 1+2 PASS on [the] full [statement] conformance corpus.
//    ... Error-recovery engine demonstrably accumulates skipped tokens and
//    re-synchronizes on `;` / statement-start keywords / closing braces
//    (panic-mode pattern)."
// =============================================================================

// -----------------------------------------------------------------------------
// FULL_SUBSET_CORPUS — the full-statement-subset conformance corpus. The
// M3.1 / M3.2 / M3.3 corpora above each exercise ONE sub-step's statement
// forms in isolation; M3.4's "full statement subset" deliverable is realistic
// programs that MIX statement forms from every sub-step — declarations +
// control flow + functions + classes + modules + try/throw together. Every
// entry is module-mode-Acorn-parseable, so the native-vs-Acorn Tier 1+2 diff
// is meaningful on the combined subset.
// -----------------------------------------------------------------------------
const FULL_SUBSET_CORPUS = [
    {
        name: "decl + loop + fn + return",
        src: "let total = 0; function add(n) { total = total + n; return total; } for (let i = 0; i < 3; i++) { add(i); }",
    },
    {
        name: "fn with control flow + nested decl",
        src: "function classify(n) { if (n < 0) { return -1; } let sign = 0; while (n > 0) { sign = 1; n = n - 1; } return sign; }",
    },
    {
        name: "class with methods + a consumer program",
        src: "class Counter { constructor() { this.n = 0; } step() { this.n = this.n + 1; return this.n; } } const c = new Counter(); c.step();",
    },
    {
        name: "import + fn + try/catch program",
        // M4.3 — `async function` retracted; use a plain `function` to keep
        // the FULL_SUBSET_CORPUS clean (`async function` would fire
        // E-ASYNC-NOT-IN-SCRML and the corpus harness asserts a zero-error
        // parse). The shape exercised (import + fn + try/catch) is unchanged.
        // M5-swap Wave 2 (B7) — the `try`/`catch` carries `E-TRY-NOT-IN-SCRML`;
        // `forbidsVocab` lets the Tier-1 harness tolerate exactly that code
        // (the node-kind sequence is still asserted against Acorn).
        src: 'import { load } from "data"; function run() { try { const v = load(); return v; } catch (e) { return 0; } }',
        forbidsVocab: true,
    },
    {
        name: "for-of over a destructured iterable + labeled break",
        src: "function scan(pairs) { outer: for (const [k, v] of pairs) { if (k) { break outer; } } }",
    },
    {
        name: "export decl + class + fn mix",
        src: "export const VERSION = 1; class Box { get value() { return 42; } } export function make() { return new Box(); }",
    },
    {
        name: "do-while + if/else + throw",
        // M5-swap Wave 2 (B7) — the `throw` carries `E-THROW-NOT-IN-SCRML`.
        src: "function attempt(limit) { let tries = 0; do { tries = tries + 1; if (tries > limit) { throw new Error('too many'); } } while (tries < limit); return tries; }",
        forbidsVocab: true,
    },
    {
        name: "generator fn + for-in + continue",
        src: "function* keys(obj) { for (const k in obj) { if (k) { continue; } } }",
    },
    {
        name: "nested functions + block scoping",
        src: "function outer() { let base = 10; function inner(x) { return base + x; } { let local = inner(5); return local; } }",
    },
    {
        name: "try/finally + var hoisting shape + while",
        // M5-swap Wave 2 (B7) — the `try`/`finally` carries `E-TRY-NOT-IN-SCRML`.
        src: "function drain(queue) { var seen = 0; try { while (queue.length) { seen = seen + 1; } } finally { return seen; } }",
        forbidsVocab: true,
    },
    {
        name: "arrow callbacks at statement position + decl",
        src: "const handler = (event) => { return event; }; const wrapped = () => handler(1); wrapped();",
    },
    {
        name: "class extends + super-shaped method + module export",
        src: "class Base { greet() { return 'hi'; } } class Sub extends Base { greet() { return super.greet(); } } export { Sub };",
    },
];

describe("M3.4 full statement subset — conformance Tier 1 (node-kind sequence)", () => {
    for (const c of FULL_SUBSET_CORPUS) {
        test(`(tier1) ${c.name}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // A clean full-subset program reports NO diagnostics — except the
            // B7 forbidden-vocabulary rejections (`E-TRY-NOT-IN-SCRML` /
            // `E-THROW-NOT-IN-SCRML`) a `forbidsVocab`-tagged entry carries
            // by design (M5-swap Wave 2). The node-kind sequence is asserted
            // against Acorn regardless.
            expect(nonVocabErrors(n.errors)).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeProgramToEstree(n.body));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M3.4 full statement subset — conformance Tier 2 (identifier / literal values)", () => {
    for (const c of FULL_SUBSET_CORPUS) {
        test(`(tier2) ${c.name}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeProgramToEstree(n.body));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M3.4 — return-legality. A `return` outside any function body is a JS
// SyntaxError (Acorn, the conformance oracle, rejects a top-level `return`).
// M3.4 closes the seam M3.3 flagged in parseReturn: `ctx.functionDepth` — a
// function-body NESTING counter — drives the check. A top-level `return`
// fires E-STMT-RETURN-OUTSIDE-FUNCTION; a `return` inside any function body
// (incl. a deeply nested `{}` block, where the single-slot ParseMode would
// read `.InBlock`, not `.InFunctionBody`) does NOT. The parse is still
// well-formed — a Return node is produced; the diagnostic is the verdict.
// -----------------------------------------------------------------------------
describe("M3.4 statement-parser — return-legality", () => {
    test("a top-level `return` fires E-STMT-RETURN-OUTSIDE-FUNCTION", () => {
        const r = parseWithNative("return 1;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
    });

    test("a bare top-level `return` (no argument) also fires the diagnostic", () => {
        const r = parseWithNative("return;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
    });

    test("a top-level `return` inside a bare block still fires the diagnostic", () => {
        // A `{}` block does NOT establish function scope — a `return` inside
        // a program-level block is still outside any function.
        const r = parseWithNative("{ return 1; }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
    });

    test("the top-level `return` still parses to a well-formed Return node", () => {
        // The diagnostic is the legality verdict; the parse is well-formed —
        // a Return node IS produced (so a caller sees both node + error).
        const r = parseWithNative("return 1;");
        expect(r.ok).toBe(true);
        expect(r.body.length).toBe(1);
        expect(r.body[0].kind).toBe(StmtKind.Return);
    });

    test("a `return` inside a function declaration body fires NO diagnostic", () => {
        const r = parseWithNative("function f() { return 1; }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(r.errors).toEqual([]);
    });

    test("a `return` in a nested `{}` block inside a function fires NO diagnostic", () => {
        // THE seam M3.3 named — a `return` deep inside nested blocks. A
        // single-slot ParseMode reads `.InBlock` here; the functionDepth
        // counter correctly reports depth >= 1, so the `return` is legal.
        const r = parseWithNative("function f() { { { return 1; } } }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(r.errors).toEqual([]);
    });

    test("a `return` in a nested function fires NO diagnostic", () => {
        const r = parseWithNative("function outer() { function inner() { return 2; } return inner; }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(r.errors).toEqual([]);
    });

    test("a `return` in a class method body fires NO diagnostic", () => {
        const r = parseWithNative("class C { m() { return this; } }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(r.errors).toEqual([]);
    });

    test("a top-level `return` after a function decl still fires (depth restored)", () => {
        // functionDepth must decrement back to 0 when the function body
        // closes — a `return` after the declaration is again program-scope.
        const r = parseWithNative("function f() { return 1; } return 2;");
        expect(r.ok).toBe(true);
        const codes = r.errors.map((e) => e.code);
        expect(codes).toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        // Exactly one — the top-level `return 2;`, not the in-function one.
        expect(codes.filter((c) => c === "E-STMT-RETURN-OUTSIDE-FUNCTION").length).toBe(1);
    });

    test("a `return` inside a re-entered BlockStub body fires NO diagnostic", () => {
        // parseBlockStubBody seeds functionDepth to 1 — a re-entered arrow /
        // function body IS a function body, so `return` is legal there.
        const e = scrmlNativeParseExpr(scrmlNativeLex("(x) => { return x; }"));
        expect(e.ast.kind).toBe(ExprKind.Arrow);
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors.map((d) => d.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(re.errors).toEqual([]);
        expect(re.body[0].kind).toBe(StmtKind.Return);
    });

    test("a `return` in a nested block inside a re-entered body fires NO diagnostic", () => {
        const e = scrmlNativeParseExpr(scrmlNativeLex("() => { { return 9; } }"));
        const re = parseBlockStubBody(e.ast.body);
        expect(re.errors).toEqual([]);
        expect(re.body[0].kind).toBe(StmtKind.Block);
        expect(re.body[0].body[0].kind).toBe(StmtKind.Return);
    });
});

// -----------------------------------------------------------------------------
// M3.4 — panic-mode re-synchronization. parseStatementList drives the M1
// ErrorRecovery engine when parseStatement makes NO forward progress: the
// engine accumulates skipped tokens into its .AccumulatingSkipped payload,
// re-synchronizes on a `;` / a statement-start keyword / a closing `}`, and
// resumes. This block exercises BOTH the engine cycle directly (the M1
// ErrorRecovery API) AND the end-to-end outcome (the parser resumes cleanly
// after a parse error). The S98 D7 M3 gating regression test is the
// "accumulate -> resync -> resume" case.
//
// The malformed-run probe is a run of `)` (RParen) tokens — a `)` at
// statement position begins no statement, so parseStatement makes no forward
// progress and panic-mode engages. (A stray `parseExprStatement` still emits
// a null-expression ExprStmt placeholder for the stuck token — a pre-existing
// M3.1 design choice; the tests therefore probe for the RESUMED real
// statement, not an exact `body` length.)
// -----------------------------------------------------------------------------

// firstCall — the first ExprStmt in `body` whose expression is a Call to the
// named callee (skips the null-expression placeholders panic-mode leaves).
function firstCallNamed(body, name) {
    return body.find((s) =>
        s.kind === StmtKind.ExprStmt
        && s.expression !== null
        && s.expression.kind === ExprKind.Call
        && s.expression.callee
        && s.expression.callee.name === name);
}

describe("M3.4 statement-parser — panic-mode re-synchronization", () => {
    // --- the M1 ErrorRecovery engine cycle, exercised directly ---
    test("the ErrorRecovery engine cycles ParsingNormally -> Accumulating -> ReSynchronized -> ParsingNormally", () => {
        const rec = makeRecovery();
        expect(rec.mode).toBe(ErrorRecovery.ParsingNormally);
        expect(isParsingNormally(rec)).toBe(true);

        beginRecovery(rec);
        expect(rec.mode).toBe(ErrorRecovery.AccumulatingSkipped);
        expect(rec.skipped).toEqual([]);

        accumulateSkipped(rec, { kind: "Ident", name: "junk" });
        accumulateSkipped(rec, { kind: "Ident", name: "more" });
        expect(rec.mode).toBe(ErrorRecovery.AccumulatingSkipped);
        expect(rec.skipped.length).toBe(2);

        markResync(rec, SyncToken.Semicolon);
        expect(rec.mode).toBe(ErrorRecovery.ReSynchronized);
        expect(rec.syncAt).toBe(SyncToken.Semicolon);

        resumeNormal(rec);
        expect(rec.mode).toBe(ErrorRecovery.ParsingNormally);
        expect(isParsingNormally(rec)).toBe(true);
        expect(rec.skipped).toEqual([]);
    });

    // --- the S98 D7 M3 gating regression test: accumulate -> resync -> resume ---
    test("REGRESSION — a malformed run is skipped, the parser re-synchronizes, and resumes", () => {
        // `) ) )` is a run of tokens that begins no statement. The parser
        // must (a) record the parse error, (b) skip the malformed run
        // (accumulate into the ErrorRecovery engine's .AccumulatingSkipped
        // payload), (c) re-synchronize on the `;`, and (d) RESUME — `valid();`
        // after the `;` parses to a real statement. The resumed statement is
        // the observable proof the engine accumulated, resynced, and resumed.
        const r = parseWithNative(") ) ) ; valid();");
        expect(r.ok).toBe(true);   // the parser never throws

        // (a) the parse error was recorded.
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");

        // (d) the parser RESUMED — `valid();` after the `;` parsed to a real
        // Call statement (the engine accumulated `) ) )`, resynced on `;`,
        // and resumed).
        const resumed = firstCallNamed(r.body, "valid");
        expect(resumed).toBeDefined();
        expect(resumed.expression.kind).toBe(ExprKind.Call);
    });

    test("re-synchronizes on a `;` — the statement after the `;` is parsed", () => {
        const r = parseWithNative(") ; let x = 1;");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
        // The `let x = 1;` after the resync `;` parsed to a real VarDecl
        // (the native VarDeclarator binding is `.target`, the ESTree-`id`
        // slot).
        const decls = r.body.filter((s) => s.kind === StmtKind.VarDecl);
        expect(decls.length).toBe(1);
        expect(decls[0].declarations[0].target.name).toBe("x");
    });

    test("re-synchronizes on a statement-start keyword — the next statement is parsed", () => {
        // A malformed run with NO `;` — the parser must resync on the next
        // statement-start keyword (`function`) and parse the declaration.
        const r = parseWithNative(") ) function f() {}");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
        const fns = r.body.filter((s) => s.kind === StmtKind.FunctionDecl);
        expect(fns.length).toBe(1);
        expect(fns[0].name).toBe("f");
    });

    test("re-synchronizes on a closing `}` — the enclosing block still closes", () => {
        // A malformed run inside a block — the parser must resync on the
        // block's own `}` so the block closes cleanly and the statement
        // AFTER the block parses.
        const r = parseWithNative("{ ) ) } foo();");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
        // The block closed (a Block node at body[0]) and `foo();` after it
        // parsed to a real Call.
        expect(r.body[0].kind).toBe(StmtKind.Block);
        expect(firstCallNamed(r.body, "foo")).toBeDefined();
    });

    test("re-synchronizes at EOF — a trailing malformed run does not spin", () => {
        // A malformed run that ends the source — resync hits EOF; the loop
        // terminates (no infinite spin) and the earlier statements survive.
        const r = parseWithNative("let x = 1; ) ) )");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
        const decls = r.body.filter((s) => s.kind === StmtKind.VarDecl);
        expect(decls.length).toBe(1);
        expect(decls[0].declarations[0].target.name).toBe("x");
    });

    test("multiple malformed runs each re-synchronize independently", () => {
        // Two separate malformed runs, each terminated by `;` — both are
        // recovered; both surrounding good statements parse.
        const r = parseWithNative(") ; first(); ) ) ; second();");
        expect(r.ok).toBe(true);
        const codes = r.errors.map((e) => e.code);
        expect(codes.filter((c) => c === "E-STMT-UNEXPECTED-TOKEN").length).toBeGreaterThanOrEqual(2);
        expect(firstCallNamed(r.body, "first")).toBeDefined();
        expect(firstCallNamed(r.body, "second")).toBeDefined();
    });

    test("a malformed run inside a function body re-synchronizes (BPP subsumption holds)", () => {
        // Panic-mode resync works in an IN-LINE function body too (the body
        // is parsed via parseStatementList — the same trampoline).
        const r = parseWithNative("function f() { ) ) ; return 1; }");
        expect(r.ok).toBe(true);
        expect(r.errors.map((e) => e.code)).toContain("E-STMT-UNEXPECTED-TOKEN");
        // No spurious return-outside-function — the body IS a function body.
        expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-RETURN-OUTSIDE-FUNCTION");
        expect(r.body[0].kind).toBe(StmtKind.FunctionDecl);
    });

    test("the parser never spins on a stray `}` with nothing open", () => {
        // A stray `}` at statement position is not a statement and is not
        // this list's terminator — the forced-advance fallback after resync
        // guarantees forward progress; the parser terminates.
        const r = parseWithNative("} foo();");
        expect(r.ok).toBe(true);   // terminates — does not hang
        // `foo();` after the stray `}` still parses to a real Call.
        expect(firstCallNamed(r.body, "foo")).toBeDefined();
    });

    test("a clean program records no E-STMT-UNEXPECTED-TOKEN (panic-mode never fires)", () => {
        // Panic-mode is OFF the happy path — a well-formed program must not
        // record the parse-error diagnostic.
        for (const c of FULL_SUBSET_CORPUS) {
            const r = parseWithNative(c.src);
            expect(r.errors.map((e) => e.code)).not.toContain("E-STMT-UNEXPECTED-TOKEN");
        }
    });
});

// =============================================================================
// M4.1 — generator (yield as an OPERATOR, function* full wiring). M4.3 RETRACTED
// the sibling async/await surface (scrml has no source-level async/await; the
// canonical async surface is the compiler body-split). The M4_1_CORPUS below
// now exercises ONLY the generator-side cases. Every async-bearing entry the
// M4.1 corpus shipped is now exercised in the M4.3 retraction describe block
// further down (fires E-ASYNC-NOT-IN-SCRML / E-AWAIT-NOT-IN-SCRML).
//
// Conformance ACORN_OPTS is { ecmaVersion:2025, sourceType:"module" }. `yield`
// as an operator is Acorn-legal ONLY inside a generator function body — every
// M4_1_CORPUS entry wraps it in one.
// =============================================================================
const M4_1_CORPUS = [
    // --- `yield` / `yield*` as an operator inside a generator body ---
    { name: "yield — in a let initializer",      src: "function* g() { let v = yield x; }" },
    { name: "yield — in an assignment",          src: "function* g() { let v; v = yield next(); }" },
    { name: "yield — binds below +",             src: "function* g() { let v = yield a + b; }" },
    { name: "yield — binds below conditional",   src: "function* g() { let v = yield a ? b : c; }" },
    { name: "yield — bare, as a binary operand", src: "function* g() { let v = (yield) + 1; }" },
    { name: "yield — nested yield yield",        src: "function* g() { let v = yield yield x; }" },
    { name: "yield — statement-position lead",   src: "function* g() { yield 1; }" },
    { name: "yield — bare statement",            src: "function* g() { yield; }" },
    { name: "yield* — delegate in initializer",  src: "function* g() { let v = yield* inner(); }" },
    { name: "yield* — delegate statement",       src: "function* g() { yield* other(); }" },
    { name: "yield — two yields in a body",      src: "function* g() { yield 1; yield 2; }" },

    // --- `function*` generator-function expressions ---
    { name: "function* — expr in a let",         src: "let g = function* () { yield 1; };" },
    { name: "function* — named expr",            src: "let g = function* named() { yield 1; };" },
    { name: "function* — IIFE",                  src: "(function* () { yield 1; })();" },

    // --- object-literal generator methods ---
    { name: "object — generator method",         src: "let o = { *gen() { yield 1; } };" },
    { name: "object — computed generator method", src: "let o = { *['k']() { yield 1; } };" },

    // --- nesting: scope reset / re-establish across function boundaries ---
    { name: "nested — generator in generator",   src: "function* o() { function* i() { yield 1; } }" },
];

describe("M4.1 async/generator — conformance Tier 1 (node-kind sequence)", () => {
    for (const c of M4_1_CORPUS) {
        test(`(tier1) ${c.name}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);
            // A clean async/generator program reports NO diagnostics.
            expect(n.errors).toEqual([]);

            const acornSeq = nodeKindSequence(a.ast);
            const nativeSeq = nodeKindSequence(nativeProgramToEstree(n.body));
            expect(nativeSeq).toEqual(acornSeq);
        });
    }
});

describe("M4.1 async/generator — conformance Tier 2 (identifier / literal / flag values)", () => {
    for (const c of M4_1_CORPUS) {
        test(`(tier2) ${c.name}`, () => {
            const a = parseWithAcorn(c.src);
            const n = parseWithNative(c.src);

            expect(a.ok).toBe(true);
            expect(n.ok).toBe(true);

            const acornVals = valueSequence(a.ast);
            const nativeVals = valueSequence(nativeProgramToEstree(n.body));
            expect(nativeVals).toEqual(acornVals);
        });
    }
});

// -----------------------------------------------------------------------------
// M4.1 — native AST shape. Direct assertions on the native parser's nodes
// for the generator surface: the Yield ExprKind, the `delegate` flag, the
// `function*` isGenerator flag. The sibling `Await` ExprKind was retired in
// M4.3 (scrml has no async/await; see the M4.3 retraction describe block
// below for the `E-AWAIT-NOT-IN-SCRML` / `E-ASYNC-NOT-IN-SCRML` shape).
// -----------------------------------------------------------------------------
describe("M4.1 async/generator — native AST shape", () => {
    test("yield operator in a let-init is a Yield node, delegate false", () => {
        const r = parseWithNative("function* g() { let v = yield next(); }");
        expect(r.errors).toEqual([]);
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Yield);
        expect(init.delegate).toBe(false);
        expect(init.argument.kind).toBe(ExprKind.Call);
    });

    test("yield* operator in a let-init is a Yield node, delegate true", () => {
        const r = parseWithNative("function* g() { let v = yield* inner(); }");
        expect(r.errors).toEqual([]);
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Yield);
        expect(init.delegate).toBe(true);
    });

    test("yield binds below + — `yield a + b` yields the whole sum", () => {
        const r = parseWithNative("function* g() { let v = yield a + b; }");
        expect(r.errors).toEqual([]);
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Yield);
        expect(init.argument.kind).toBe(ExprKind.Binary);
    });

    test("yield binds below `?:` — `yield a ? b : c` yields the conditional", () => {
        const r = parseWithNative("function* g() { let v = yield a ? b : c; }");
        expect(r.errors).toEqual([]);
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Yield);
        expect(init.argument.kind).toBe(ExprKind.Conditional);
    });

    test("a bare `yield` is a Yield node with no argument", () => {
        const r = parseWithNative("function* g() { let v = (yield) + 1; }");
        expect(r.errors).toEqual([]);
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Binary);
        const y = init.left.expression;   // Paren wraps the bare yield
        expect(y.kind).toBe(ExprKind.Yield);
        expect(y.argument === undefined || y.argument === null).toBe(true);
    });

    test("a `function*` expression carries isGenerator true", () => {
        const r = parseWithNative("let g = function* () { yield 1; };");
        expect(r.errors).toEqual([]);
        const fn = r.body[0].declarations[0].init;
        expect(fn.kind).toBe(ExprKind.Function);
        expect(fn.isGenerator).toBe(true);
        expect(fn.isAsync).toBe(false);
    });

    test("a plain `function` expression carries isGenerator false", () => {
        const r = parseWithNative("let g = function () { return 1; };");
        expect(r.errors).toEqual([]);
        const fn = r.body[0].declarations[0].init;
        expect(fn.kind).toBe(ExprKind.Function);
        expect(fn.isGenerator).toBe(false);
    });

    test("an object-literal generator method carries isGenerator true", () => {
        const r = parseWithNative("let o = { *gen() { yield 1; } };");
        expect(r.errors).toEqual([]);
        const method = r.body[0].declarations[0].init.properties[0];
        expect(method.kind).toBe("Method");
        expect(method.value.isGenerator).toBe(true);
        expect(method.value.isAsync).toBe(false);
    });

    test("a generator function declaration carries isGenerator true", () => {
        const r = parseWithNative("function* gen() { yield 1; }");
        expect(r.errors).toEqual([]);
        expect(r.body[0].kind).toBe(StmtKind.FunctionDecl);
        expect(r.body[0].isGenerator).toBe(true);
    });
});

// -----------------------------------------------------------------------------
// M4.1 — generator scope boundary. `yield` is an operator ONLY inside a
// generator function. A function ESTABLISHES its own scope — it does NOT
// inherit the enclosing function's (Acorn-verified). Outside the scope the
// keyword reaches parsePrimary unhandled and the parse records a diagnostic
// (no throw — the no-throw discipline). Acorn rejects all of these too, so
// they are exercised native-only (not Acorn-diffable). The sibling async/
// await side of this boundary is gone — M4.3 fires E-AWAIT-NOT-IN-SCRML at
// EVERY `await` keyword regardless of scope (see the retraction describe
// block below).
// -----------------------------------------------------------------------------
describe("M4.1 generator — scope boundary (yield gated on generator scope)", () => {
    test("`yield` in a plain (non-generator) function is a parse error", () => {
        const r = parseWithNative("function f() { let v = yield x; }");
        expect(r.ok).toBe(true);
        expect(r.errors.length).toBeGreaterThan(0);
    });

    test("a non-generator function nested in a generator cannot use `yield`", () => {
        const r = parseWithNative("function* o() { function i() { let v = yield x; } }");
        expect(r.ok).toBe(true);
        expect(r.errors.length).toBeGreaterThan(0);
    });

    test("the generator scope is restored after a nested function returns", () => {
        // `yield` works in the outer body, the nested sync fn rejects it,
        // and `yield` works AGAIN in the outer body after the nested fn —
        // the scope save/restore round-trips.
        const r = parseWithNative(
            "function* o() { let a = yield one(); function i() {} let b = yield two(); }");
        expect(r.errors).toEqual([]);
        const body = r.body[0].body;
        expect(body[0].declarations[0].init.kind).toBe(ExprKind.Yield);
        expect(body[2].declarations[0].init.kind).toBe(ExprKind.Yield);
    });
});

// =============================================================================
// M4.3 — async / await RETRACTION at the statement layer (mirror of the
// expression-layer describe in parser-conformance-expr.test.js).
// scrml has no `async` / `await` keyword at the language level. The parser
// still LEXES `async` / `await` (M1 keyword catalog stable for tooling) but
// every production-position appearance fires a scrml-level error code and
// recovers (no throw):
//   - E-ASYNC-NOT-IN-SCRML — `async function` decl / expr; `async` arrow /
//     method (class/object); `export async function` / `export default
//     async function`.
//   - E-AWAIT-NOT-IN-SCRML — `await` used as a unary operator anywhere.
//   - E-FOR-AWAIT-NOT-IN-SCRML — `for await ( ... )` in any shape.
// Generators (`yield` / `yield*` / `function*`) are PRESERVED (separate
// conversation per S114). The retracted forms recover so the rest of the
// program stays diagnosable.
// =============================================================================
describe("M4.3 — async/await retraction (statement layer)", () => {
    test("`async function load() {}` fires E-ASYNC-NOT-IN-SCRML; isAsync recovers to false", () => {
        const r = parseWithNative("async function load() {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(r.body[0].kind).toBe(StmtKind.FunctionDecl);
        expect(r.body[0].isAsync).toBe(false);
    });

    test("`async function* ag() {}` retracts the `async`, keeps the generator", () => {
        const r = parseWithNative("async function* ag() {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(r.body[0].isAsync).toBe(false);
        expect(r.body[0].isGenerator).toBe(true);
    });

    test("`await` in a function body fires E-AWAIT-NOT-IN-SCRML; recovery returns the operand", () => {
        const r = parseWithNative("function f() { let x = await g(); }");
        expect(r.errors.map((e) => e.code)).toContain("E-AWAIT-NOT-IN-SCRML");
        // RECOVERY — no Await node; the operand (g()) is the initializer.
        const init = r.body[0].body[0].declarations[0].init;
        expect(init.kind).toBe(ExprKind.Call);
    });

    test("`await` at the program top level also fires E-AWAIT-NOT-IN-SCRML", () => {
        const r = parseWithNative("await fetch();");
        expect(r.errors.map((e) => e.code)).toContain("E-AWAIT-NOT-IN-SCRML");
    });

    test("`for await (... of ...)` fires E-FOR-AWAIT-NOT-IN-SCRML; for-of recovers", () => {
        const r = parseWithNative("for await (const c of stream()) { read(c); }");
        expect(r.errors.map((e) => e.code)).toContain("E-FOR-AWAIT-NOT-IN-SCRML");
        // RECOVERY — the for-of parses; `isAwait` is forced false.
        const f = r.body[0];
        expect(f.kind).toBe(StmtKind.ForOf);
        expect(f.isAwait).toBe(false);
    });

    test("class async method fires E-ASYNC-NOT-IN-SCRML; method recovers as plain", () => {
        const r = parseWithNative("class C { async load() {} }");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(r.body[0].body[0].value.isAsync).toBe(false);
    });

    test("object-literal async method fires E-ASYNC-NOT-IN-SCRML; method recovers as plain", () => {
        const r = parseWithNative("let o = { async load() {} };");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
    });

    test("`export async function af() {}` fires E-ASYNC-NOT-IN-SCRML; export recovers", () => {
        const r = parseWithNative("export async function af() {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
    });

    test("`export default async function () {}` fires E-ASYNC-NOT-IN-SCRML; export recovers", () => {
        const r = parseWithNative("export default async function () {}");
        expect(r.errors.map((e) => e.code)).toContain("E-ASYNC-NOT-IN-SCRML");
    });

    test("`async function* ag() { let v = yield await x(); }` — both retractions fire; yield preserved", () => {
        const r = parseWithNative("async function* ag() { let v = yield await x(); }");
        const codes = r.errors.map((e) => e.code);
        expect(codes).toContain("E-ASYNC-NOT-IN-SCRML");
        expect(codes).toContain("E-AWAIT-NOT-IN-SCRML");
        // RECOVERY — the `function*` survives (still a generator); the
        // `yield` still parses as a Yield node wrapping the operand (which
        // is now the unwrapped `x()` call after await recovery).
        const fn = r.body[0];
        expect(fn.isAsync).toBe(false);
        expect(fn.isGenerator).toBe(true);
    });

    test("`await` keyword as a plain identifier still parses (M1 keyword catalog is unchanged) — but fires the retraction code if reached at unary level", () => {
        // M1 always lexes `await` as KwAwait. parseUnary fires the retraction
        // error at every occurrence regardless of context. This test pins the
        // shape "every `await` token records E-AWAIT-NOT-IN-SCRML".
        const r = parseWithNative("await x;");
        expect(r.errors.map((e) => e.code)).toContain("E-AWAIT-NOT-IN-SCRML");
    });
});
