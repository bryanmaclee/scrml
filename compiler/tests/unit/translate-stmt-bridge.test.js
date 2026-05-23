// translate-stmt-bridge.test.js — M5-swap Unit R1 — the statement-catalog
// bridge unit tests.
//
// The unit under test is compiler/native-parser/translate-stmt.js's
// `translateStmtList` — the native PascalCase `Stmt[]` -> live lowercase
// `LogicStatement[]` translation. The brief mandates per-kind translation
// unit tests + a corpus diff. This file covers:
//   §1  statement substrate — Empty / Block / ExprStmt / VarDecl
//   §2  control flow — If / While / DoWhile / For / ForIn / ForOf / Return /
//       Break / Continue / Labeled
//   §3  declarations — FunctionDecl / Import / Export / ClassDecl
//   §4  forbidden-vocabulary kinds — Throw / Try
//   §5  scrml-only un-wrap — lift-expr / fail-expr from native Lift / Fail
//   §6  destructuring binding patterns
//   §7  id-stamping + span discipline
//   §8  defensive folds
//   §9  corpus diff — every translated node walks cleanly + carries a live
//       lowercase kind
//
// DRIVER: source -> `lex` -> `parseProgram` -> `translateStmtList`. The native
// parser is the FROM side; `translateStmtList` is the unit under test.

import { describe, test, expect } from "bun:test";

import { lex } from "../../native-parser/lex.js";
import { parseProgram } from "../../native-parser/parse-stmt.js";
import { translateStmtList } from "../../native-parser/translate-stmt.js";

// translate — drive the full source -> native Stmt[] -> live LogicStatement[]
// pipeline. Returns the live `LogicStatement[]`.
function translate(source, idGen) {
    const tokens = lex(source);
    const program = parseProgram(tokens);
    return translateStmtList(program.body, idGen);
}

// The set of live lowercase kinds the translation is permitted to emit. Used
// by the corpus diff to assert every translated node carries a live kind (NOT
// a leaked native PascalCase kind).
const LIVE_KINDS = new Set([
    "let-decl", "const-decl", "bare-expr", "lift-expr", "fail-expr",
    "if-stmt", "while-stmt", "do-while-stmt", "for-stmt", "return-stmt",
    "break-stmt", "continue-stmt", "function-decl", "import-decl",
    "export-decl", "throw-stmt", "try-stmt",
]);

// =============================================================================
describe("§1 — statement substrate", () => {
    test("Empty statement translates to nothing", () => {
        const out = translate(";");
        expect(out).toEqual([]);
    });

    test("ExprStmt translates to bare-expr (exprNode is LIVE lowercase per R4-U1)", () => {
        const out = translate("foo(1);");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("bare-expr");
        expect(out[0].exprNode).not.toBeNull();
        // R4-U1: makeBareExpr wires translateExpr; exprNode is live `call`, not native `Call`.
        expect(out[0].exprNode.kind).toBe("call");
    });

    test("Block flattens its body into the surrounding stream", () => {
        const out = translate("{ foo(); bar(); }");
        expect(out.length).toBe(2);
        expect(out[0].kind).toBe("bare-expr");
        expect(out[1].kind).toBe("bare-expr");
    });

    test("let VarDecl translates to let-decl", () => {
        const out = translate("let x = 1;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].name).toBe("x");
        expect(out[0].initExpr).not.toBeNull();
    });

    test("const VarDecl translates to const-decl", () => {
        const out = translate("const y = 2;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("const-decl");
        expect(out[0].name).toBe("y");
    });

    test("var VarDecl translates to let-decl (scrml has no var)", () => {
        const out = translate("var z = 3;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].name).toBe("z");
    });

    test("multi-declarator VarDecl fans out to one node per declarator", () => {
        const out = translate("let a = 1, b = 2, c = 3;");
        expect(out.length).toBe(3);
        expect(out.map((n) => n.kind)).toEqual(["let-decl", "let-decl", "let-decl"]);
        expect(out.map((n) => n.name)).toEqual(["a", "b", "c"]);
    });

    test("init-free declarator omits initExpr", () => {
        const out = translate("let u;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].name).toBe("u");
        expect(out[0].initExpr).toBeUndefined();
    });
});

// =============================================================================
describe("§2 — control flow", () => {
    test("If translates to if-stmt with array-shaped consequent", () => {
        const out = translate("if (cond) { foo(); }");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("if-stmt");
        expect(Array.isArray(out[0].consequent)).toBe(true);
        expect(out[0].consequent.length).toBe(1);
        expect(out[0].consequent[0].kind).toBe("bare-expr");
        expect(out[0].alternate).toBeNull();
        expect(out[0].condExpr).not.toBeNull();
    });

    test("If/else translates with array-shaped alternate", () => {
        const out = translate("if (cond) { foo(); } else { bar(); }");
        expect(out[0].kind).toBe("if-stmt");
        expect(Array.isArray(out[0].alternate)).toBe(true);
        expect(out[0].alternate.length).toBe(1);
        expect(out[0].alternate[0].kind).toBe("bare-expr");
    });

    test("else-if chain nests as a one-element if-stmt alternate", () => {
        const out = translate("if (a) { x(); } else if (b) { y(); } else { z(); }");
        expect(out[0].kind).toBe("if-stmt");
        expect(out[0].alternate.length).toBe(1);
        expect(out[0].alternate[0].kind).toBe("if-stmt");
        expect(out[0].alternate[0].alternate[0].kind).toBe("bare-expr");
    });

    test("un-braced if body translates to a one-element array", () => {
        const out = translate("if (cond) foo();");
        expect(out[0].kind).toBe("if-stmt");
        expect(out[0].consequent.length).toBe(1);
        expect(out[0].consequent[0].kind).toBe("bare-expr");
    });

    test("While translates to while-stmt", () => {
        const out = translate("while (cond) { tick(); }");
        expect(out[0].kind).toBe("while-stmt");
        expect(out[0].body.length).toBe(1);
        expect(out[0].condExpr).not.toBeNull();
    });

    test("DoWhile translates to do-while-stmt", () => {
        const out = translate("do { tick(); } while (cond);");
        expect(out[0].kind).toBe("do-while-stmt");
        expect(out[0].body.length).toBe(1);
        expect(out[0].condExpr).not.toBeNull();
    });

    test("C-style For translates to for-stmt with cStyleParts", () => {
        const out = translate("for (let i = 0; i < 10; i = i + 1) { step(); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].variable).toBeNull();
        expect(out[0].cStyleParts).toBeDefined();
        expect(out[0].cStyleParts.initExpr).not.toBeNull();
        expect(out[0].cStyleParts.condExpr).not.toBeNull();
        expect(out[0].cStyleParts.updateExpr).not.toBeNull();
    });

    test("ForOf translates to for-stmt with variable + iterExpr", () => {
        const out = translate("for (const item of items) { use(item); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].variable).toBe("item");
        expect(out[0].iterExpr).not.toBeNull();
        expect(out[0].forKind).toBe("of");
    });

    test("ForIn translates to for-stmt with forKind 'in'", () => {
        const out = translate("for (const key in obj) { read(key); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].variable).toBe("key");
        expect(out[0].forKind).toBe("in");
    });

    test("Return with argument translates to return-stmt with exprNode", () => {
        const out = translate("return value;");
        expect(out[0].kind).toBe("return-stmt");
        expect(out[0].exprNode).not.toBeNull();
    });

    test("bare Return omits exprNode", () => {
        const out = translate("return;");
        expect(out[0].kind).toBe("return-stmt");
        expect(out[0].exprNode).toBeUndefined();
    });

    test("Break translates to break-stmt", () => {
        const out = translate("while (a) { break; }");
        expect(out[0].body[0].kind).toBe("break-stmt");
        expect(out[0].body[0].label).toBeNull();
    });

    test("Continue translates to continue-stmt", () => {
        const out = translate("while (a) { continue; }");
        expect(out[0].body[0].kind).toBe("continue-stmt");
        expect(out[0].body[0].label).toBeNull();
    });

    test("labeled break carries its label", () => {
        const out = translate("while (a) { break outer; }");
        expect(out[0].body[0].kind).toBe("break-stmt");
        expect(out[0].body[0].label).toBe("outer");
    });

    test("Labeled loop stamps label onto the loop node", () => {
        const out = translate("outer: while (cond) { tick(); }");
        expect(out[0].kind).toBe("while-stmt");
        expect(out[0].label).toBe("outer");
    });

    test("Labeled for stamps label onto the for-stmt", () => {
        const out = translate("loop: for (const x of xs) { use(x); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].label).toBe("loop");
    });

    test("label on a non-loop emits the inner statement un-labelled", () => {
        const out = translate("tag: foo();");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("bare-expr");
        expect(out[0].label).toBeUndefined();
    });
});

// =============================================================================
describe("§3 — declarations", () => {
    test("FunctionDecl translates to function-decl with recursive body", () => {
        const out = translate("function greet(name) { return name; }");
        expect(out[0].kind).toBe("function-decl");
        expect(out[0].name).toBe("greet");
        expect(out[0].params).toEqual(["name"]);
        expect(out[0].body.length).toBe(1);
        expect(out[0].body[0].kind).toBe("return-stmt");
        expect(out[0].fnKind).toBe("function");
        expect(out[0].isServer).toBe(false);
        expect(out[0].canFail).toBe(false);
    });

    test("generator FunctionDecl carries isGenerator", () => {
        const out = translate("function* gen() { yield 1; }");
        expect(out[0].kind).toBe("function-decl");
        expect(out[0].isGenerator).toBe(true);
    });

    test("rest param renders as ...name", () => {
        const out = translate("function variadic(a, ...rest) { return a; }");
        expect(out[0].params).toEqual(["a", "...rest"]);
    });

    test("Import named specifiers translate to import-decl", () => {
        const out = translate('import { Button, Card } from "scrml:ui";');
        expect(out[0].kind).toBe("import-decl");
        expect(out[0].names).toEqual(["Button", "Card"]);
        expect(out[0].source).toBe("scrml:ui");
        expect(out[0].isDefault).toBe(false);
        expect(out[0].specifiers.length).toBe(2);
        expect(out[0].specifiers[0]).toEqual({ imported: "Button", local: "Button", pinned: false });
    });

    test("Import aliased specifier preserves imported vs local", () => {
        const out = translate('import { foo as bar } from "./mod";');
        expect(out[0].specifiers[0]).toEqual({ imported: "foo", local: "bar", pinned: false });
    });

    test("default Import sets isDefault", () => {
        const out = translate('import Thing from "./thing";');
        expect(out[0].kind).toBe("import-decl");
        expect(out[0].isDefault).toBe(true);
        expect(out[0].names).toEqual(["Thing"]);
    });

    test("Export of a function-declaration carries exportKind + name", () => {
        const out = translate("export function helper() { return 1; }");
        expect(out[0].kind).toBe("export-decl");
        expect(out[0].exportKind).toBe("function");
        expect(out[0].exportedName).toBe("helper");
    });

    test("Export of a const declaration", () => {
        const out = translate("export const VERSION = 1;");
        expect(out[0].kind).toBe("export-decl");
        expect(out[0].exportKind).toBe("const");
        expect(out[0].exportedName).toBe("VERSION");
    });

    test("re-export carries reExportSource + re-export kind", () => {
        const out = translate('export { thing } from "./other";');
        expect(out[0].kind).toBe("export-decl");
        expect(out[0].exportKind).toBe("re-export");
        expect(out[0].reExportSource).toBe("./other");
    });

    test("ClassDecl translates to bare-expr (no live class kind)", () => {
        const out = translate("class Widget { }");
        expect(out[0].kind).toBe("bare-expr");
    });
});

// =============================================================================
describe("§4 — forbidden-vocabulary kinds (diagnostic-recovery shapes)", () => {
    test("Throw translates to throw-stmt with exprNode", () => {
        const out = translate("throw err;");
        expect(out[0].kind).toBe("throw-stmt");
        expect(out[0].exprNode).not.toBeNull();
    });

    test("Try translates to try-stmt with body + catch", () => {
        const out = translate("try { risky(); } catch (e) { recover(e); }");
        expect(out[0].kind).toBe("try-stmt");
        expect(out[0].body.length).toBe(1);
        expect(out[0].body[0].kind).toBe("bare-expr");
        expect(out[0].catchNode).toBeDefined();
        expect(out[0].catchNode.header).toBe("e");
        expect(out[0].catchNode.body.length).toBe(1);
    });

    test("Try with finally carries finallyNode", () => {
        const out = translate("try { a(); } finally { b(); }");
        expect(out[0].kind).toBe("try-stmt");
        expect(out[0].finallyNode).toBeDefined();
        expect(out[0].finallyNode.body.length).toBe(1);
    });

    test("Try with optional catch binding has empty catch header", () => {
        const out = translate("try { a(); } catch { b(); }");
        expect(out[0].catchNode.header).toBe("");
    });
});

// =============================================================================
describe("§5 — scrml-only un-wrap from native expression kinds", () => {
    test("lift in statement position un-wraps to lift-expr", () => {
        const out = translate("lift value;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr).toBeDefined();
        expect(out[0].expr.kind).toBe("expr");
        expect(out[0].expr.exprNode).not.toBeNull();
    });

    test("fail in statement position un-wraps to fail-expr", () => {
        const out = translate("fail AppError::NotFound;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("fail-expr");
        expect(out[0].variantExpr).not.toBeNull();
    });

    test("a plain bare assignment stays bare-expr (no tilde-decl promotion)", () => {
        const out = translate("counter = counter + 1;");
        expect(out[0].kind).toBe("bare-expr");
    });
});

// =============================================================================
// §5b — M6.2a — translateMarkupValueToLiveNode bridge.
//
// The M6.2 STOP-doc (commit a30c2b17) identified a bridge-parity gap:
// `makeLiftExpr` wrapped a raw native `MarkupValue` inside
// `lift-expr.expr.node`, but downstream consumers (component-expander,
// name-resolver, dependency-graph, codegen) read `expr.node.tag` /
// `expr.node.children` / `expr.node.isComponent` — all undefined on a raw
// native MarkupValue. M6.2a's `translateMarkupValueToLiveNode` converts the
// native shape to the live MarkupNode shape so consumers walk cleanly.
// =============================================================================

import { translateMarkupValueToLiveNode } from "../../native-parser/translate-stmt.js";

describe("§5b — M6.2a translateMarkupValueToLiveNode bridge", () => {
    test("converter on a synthetic MarkupValue produces a live MarkupNode shape", () => {
        const markupValue = {
            kind: "MarkupValue",
            markup: [{
                kind: "Markup",
                name: "div",
                attrs: [{ name: "class", value: { kind: "string-literal", value: "card", span: { start: 5, end: 11, line: 1, col: 1 } }, span: { start: 5, end: 11, line: 1, col: 1 } }],
                children: [],
                closerForm: "</div>",
                span: { start: 0, end: 20, line: 1, col: 1 },
            }],
            span: { start: 0, end: 20, line: 1, col: 1 },
        };
        const counter = { next: 0 };
        const node = translateMarkupValueToLiveNode(markupValue, counter);
        expect(node).not.toBeNull();
        expect(node.kind).toBe("markup");
        expect(node.tag).toBe("div");
        expect(node.isComponent).toBe(false);
        expect(Array.isArray(node.attrs)).toBe(true);
        expect(Array.isArray(node.children)).toBe(true);
        expect(node.id).toBe(1);
    });

    test("converter sets isComponent=true for uppercase-initial tag names", () => {
        const markupValue = {
            kind: "MarkupValue",
            markup: [{
                kind: "Markup",
                name: "TaskCard",
                attrs: [],
                children: [],
                closerForm: null,
                span: { start: 0, end: 10, line: 1, col: 1 },
            }],
            span: { start: 0, end: 10, line: 1, col: 1 },
        };
        const node = translateMarkupValueToLiveNode(markupValue, { next: 0 });
        expect(node.tag).toBe("TaskCard");
        expect(node.isComponent).toBe(true);
        expect(node.selfClosing).toBe(true);
    });

    test("converter is defensive against null / undefined / wrong-kind", () => {
        expect(translateMarkupValueToLiveNode(null, { next: 0 })).toBeNull();
        expect(translateMarkupValueToLiveNode(undefined, { next: 0 })).toBeNull();
        expect(translateMarkupValueToLiveNode({ kind: "Ident", name: "x" }, { next: 0 })).toBeNull();
    });

    test("converter handles MarkupTokenRange fallback (source-unavailable) — defensive empty stub", () => {
        const markupValue = {
            kind: "MarkupValue",
            markup: { kind: "MarkupTokenRange", tokens: [], tokenStart: 0, tokenEnd: 0, span: { start: 0, end: 5, line: 1, col: 1 } },
            span: { start: 0, end: 5, line: 1, col: 1 },
        };
        const node = translateMarkupValueToLiveNode(markupValue, { next: 0 });
        expect(node).not.toBeNull();
        expect(node.kind).toBe("markup");
        expect(node.tag).toBe("");
        expect(node.attrs).toEqual([]);
        expect(node.children).toEqual([]);
        expect(node.isComponent).toBe(false);
        expect(node.span.start).toBe(0);
        expect(node.span.end).toBe(5);
    });

    test("`lift <Div/>` via parseProgram (no-source path) produces a defensive empty MarkupNode (token-range fallback)", () => {
        // parseProgram does NOT thread `ctx.source` through, so parseMarkupValue
        // takes the source-unavailable path and emits a MarkupTokenRange-shaped
        // MarkupValue. The bridge's fallback emits a defensive empty markup
        // node — kind:"markup" with empty tag/attrs/children — so consumers
        // are crash-free even though structural info is unrecoverable here.
        // The PRIMARY value of M6.2a — recovering structural info — only
        // applies in the source-available path (the lift body inside a real
        // FileAST parse). The source-aware path is verified end-to-end by the
        // integration test bug-5-nested-component-ce-phantom-dom.test.js.
        const out = translate("lift <Div/>;");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr.kind).toBe("markup");
        expect(out[0].expr.node).not.toBeNull();
        expect(out[0].expr.node.kind).toBe("markup");
        // Token-range fallback — tag is the defensive empty string.
        expect(out[0].expr.node.tag).toBe("");
        expect(out[0].expr.node.isComponent).toBe(false);
        expect(Array.isArray(out[0].expr.node.children)).toBe(true);
        expect(Array.isArray(out[0].expr.node.attrs)).toBe(true);
    });

    test("synthetic source-available MarkupValue: a `lift <Wrapper><Inner/></Wrapper>` shape converts recursively", () => {
        // Synthesize the source-available MarkupValue shape directly to
        // verify the recursive-Markup-child conversion. This mirrors what
        // the JS-host parseMarkupValue produces when `ctx.source` is set
        // (parse-expr.js:2104 — `trace.ctx.nodes.slice(0, 1)`).
        const markupValue = {
            kind: "MarkupValue",
            markup: [{
                kind: "Markup",
                name: "Wrapper",
                attrs: [],
                children: [{
                    kind: "Markup",
                    name: "Inner",
                    attrs: [],
                    children: [],
                    closerForm: null,
                    span: { start: 9, end: 17, line: 1, col: 10 },
                }],
                closerForm: "</Wrapper>",
                span: { start: 0, end: 25, line: 1, col: 1 },
            }],
            span: { start: 0, end: 25, line: 1, col: 1 },
        };
        const counter = { next: 0 };
        const node = translateMarkupValueToLiveNode(markupValue, counter);
        expect(node.kind).toBe("markup");
        expect(node.tag).toBe("Wrapper");
        expect(node.isComponent).toBe(true);
        expect(node.children.length).toBe(1);
        const inner = node.children[0];
        expect(inner.kind).toBe("markup");
        expect(inner.tag).toBe("Inner");
        expect(inner.isComponent).toBe(true);
    });

    test("lift target that is NOT a MarkupValue routes through the expr branch (unchanged behavior)", () => {
        const out = translate("lift value;");
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr.kind).toBe("expr");
        // No node field on the expr-target shape.
        expect(out[0].expr.node).toBeUndefined();
    });
});

// =============================================================================
// §5c — R4-U1: translateExpr wired at bare-expr / return-stmt / throw-stmt
// ride-throughs. The three text-interpolation sites surfaced in the R4 survey
// (docs/changes/r4-expression-catalog-continuation-survey/progress.md Phase 3a).
// Asserts that `exprNode` slots on the three wired sites carry LIVE lowercase
// `ExprNode` (per ast.ts:1939 ExprNode union), NOT native PascalCase Exprs.
// Locking tests for the still-unwired sites (R4-U2 / U3 / U4 / U5) confirm
// that scope is still required — they still emit PascalCase, which is the
// regression bug-5 / M6.2 wip-patch reproduced.
// =============================================================================
describe("§5c — R4-U1 wired ride-through sites (translateExpr bridged)", () => {
    test("bare-expr Call: exprNode is live `call`, not native `Call`", () => {
        const out = translate("foo(1);");
        expect(out[0].kind).toBe("bare-expr");
        expect(out[0].exprNode.kind).toBe("call");
    });

    test("bare-expr Binary: exprNode is live `binary`, not native `Binary`", () => {
        const out = translate("1 + 2;");
        expect(out[0].kind).toBe("bare-expr");
        expect(out[0].exprNode.kind).toBe("binary");
    });

    test("bare-expr Member: exprNode is live `member`, not native `Member`", () => {
        const out = translate("task.title;");
        expect(out[0].kind).toBe("bare-expr");
        // native Member -> live member (computed:false dotted form per translate-expr.js L85-90)
        expect(out[0].exprNode.kind).toBe("member");
    });

    test("return-stmt Ident: exprNode is live `ident`, not native `Ident`", () => {
        const out = translate("return value;");
        expect(out[0].kind).toBe("return-stmt");
        expect(out[0].exprNode.kind).toBe("ident");
    });

    test("return-stmt Binary: exprNode is live `binary`, not native `Binary`", () => {
        const out = translate("return 1 + 2;");
        expect(out[0].kind).toBe("return-stmt");
        expect(out[0].exprNode.kind).toBe("binary");
    });

    test("throw-stmt Ident: exprNode is live `ident`, not native `Ident`", () => {
        const out = translate("throw err;");
        expect(out[0].kind).toBe("throw-stmt");
        expect(out[0].exprNode.kind).toBe("ident");
    });

    // R4-U2 inverted this lock — for-of iterExpr is NOW bridged. The assertion
    // was flipped (PascalCase → lowercase) to capture the close of R4-U2's
    // "what still needs doing" surface. The new R4-U3-scope lock lives in §5d.
    test("for-of iterExpr is now live `ident` (R4-U2 closed)", () => {
        const out = translate("for (const x of items) { use(x); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].iterExpr).not.toBeNull();
        expect(out[0].iterExpr.kind).toBe("ident");
    });
});

// =============================================================================
// §5d — R4-U2: translateExpr wired at for-stmt iterExpr + cStyleParts.{init,
// cond,update}Expr ride-throughs. The four for-statement family expression
// sites surfaced in the R4 survey (Phase 3a). Asserts that the iterExpr /
// cStyleParts ExprNode slots carry LIVE lowercase `ExprNode`, NOT native
// PascalCase Exprs. The §5d block closes the for-iterable branch of bug-5
// 5a (`for (let task of @tasks.filter(...))`). The LOCK at the end of this
// block guards an as-yet-unwired site (if-stmt condExpr) so R4-U3 scope
// remains explicit.
// =============================================================================
describe("§5d — R4-U2 wired for-stmt-family ride-through sites", () => {
    test("for-of iterExpr Member-Call is live `call` (R4-U2)", () => {
        // Mirrors the bug-5 5a shape: `for (const task of items.filter(p))`
        const out = translate("for (const task of items.filter(p)) { use(task); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].iterExpr).not.toBeNull();
        // `items.filter(p)` parses as a Call (callee=Member); R4-U2 brings
        // the live lowercase `call` kind to the slot.
        expect(out[0].iterExpr.kind).toBe("call");
    });

    test("for-in iterExpr Ident is live `ident` (R4-U2)", () => {
        const out = translate("for (const k in obj) { use(k); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].forKind).toBe("in");
        expect(out[0].iterExpr).not.toBeNull();
        expect(out[0].iterExpr.kind).toBe("ident");
    });

    test("C-style for: cStyleParts.condExpr Binary is live `binary` (R4-U2)", () => {
        // The init clause uses the Expr-form (i = 0) to avoid the VarDecl
        // escape-hatch path; that path is documented as a separate downstream
        // gap (declaration-form C-style init).
        const out = translate("for (i = 0; i < 10; i = i + 1) { use(i); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].cStyleParts).toBeDefined();
        expect(out[0].cStyleParts.condExpr).not.toBeNull();
        // `i < 10` is a Binary; R4-U2 brings live lowercase `binary`.
        expect(out[0].cStyleParts.condExpr.kind).toBe("binary");
    });

    test("C-style for: cStyleParts.initExpr (Expr-form Assignment) and updateExpr (Assignment) are live (R4-U2)", () => {
        const out = translate("for (i = 0; i < 10; i = i + 1) { use(i); }");
        expect(out[0].cStyleParts.initExpr).not.toBeNull();
        // `i = 0` is an Assignment; R4-U2 brings live lowercase `assign`.
        expect(out[0].cStyleParts.initExpr.kind).toBe("assign");
        expect(out[0].cStyleParts.updateExpr).not.toBeNull();
        // `i = i + 1` is also an Assignment.
        expect(out[0].cStyleParts.updateExpr.kind).toBe("assign");
    });

    // R4-U3 closed this LOCK; new LOCK at R4-U4 (let-decl initExpr) lives in
    // the §5e block below. The §5d LOCK was flipped from PascalCase `Binary`
    // to lowercase `binary` when makeIfStmt started wrapping condExpr with
    // translateExpr (mirroring the R4-U1 → R4-U2 lock flip pattern).
    test("if-stmt condExpr is now live `binary` (R4-U3 closed)", () => {
        const out = translate("if (x < 1) { use(x); }");
        expect(out[0].kind).toBe("if-stmt");
        expect(out[0].condExpr).not.toBeNull();
        // R4-U3: makeIfStmt now wraps with translateExpr; live lowercase `binary`.
        expect(out[0].condExpr.kind).toBe("binary");
    });
});

// =============================================================================
// §5e — R4-U3: translateExpr wired at if-stmt / while-stmt / do-while-stmt
// condExpr sites. Closes the if/while/do-while branch of the R1 ride-through
// surface (bug-5 5a: control-flow condExpr leaked PascalCase Exprs). The §5d
// LOCK that asserted PascalCase Binary for if-stmt was flipped above. The
// LOCK at the end of this block guards an as-yet-unwired site (let-decl
// initExpr) so R4-U4 scope remains visible.
// =============================================================================
describe("§5e — R4-U3 wired if/while/do-while condExpr sites", () => {
    test("if-stmt condExpr bare-identifier is live `ident` (R4-U3)", () => {
        const out = translate("if (x) { use(x); }");
        expect(out[0].kind).toBe("if-stmt");
        expect(out[0].condExpr).not.toBeNull();
        // `x` is an Ident; R4-U3 brings live lowercase `ident`.
        expect(out[0].condExpr.kind).toBe("ident");
    });

    test("while-stmt condExpr Binary comparison is live `binary` (R4-U3)", () => {
        const out = translate("while (a < b) { use(a); }");
        expect(out[0].kind).toBe("while-stmt");
        expect(out[0].condExpr).not.toBeNull();
        // `a < b` is a Binary; R4-U3 brings live lowercase `binary`.
        expect(out[0].condExpr.kind).toBe("binary");
    });

    test("do-while-stmt condExpr Member expression is live `member` (R4-U3)", () => {
        const out = translate("do { tick(); } while (obj.flag);");
        expect(out[0].kind).toBe("do-while-stmt");
        expect(out[0].condExpr).not.toBeNull();
        // `obj.flag` is a Member; R4-U3 brings live lowercase `member`.
        expect(out[0].condExpr.kind).toBe("member");
    });

    // R4-U4 closed this LOCK; new LOCK at R4-U5 (lift-expr / propagate /
    // guarded / fail expression-CHILD sites) lives in the §5f block below.
    // The §5e LOCK was flipped from PascalCase `Binary` to lowercase `binary`
    // when makeVarDeclNode started wrapping initExpr with translateExpr
    // (mirroring the R4-U1 → R4-U2 → R4-U3 lock flip pattern).
    test("let-decl initExpr Binary is now live `binary` (R4-U4 closed)", () => {
        const out = translate("let x = a + b;");
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].initExpr).not.toBeNull();
        // R4-U4: makeVarDeclNode now wraps with translateExpr; live lowercase `binary`.
        expect(out[0].initExpr.kind).toBe("binary");
    });
});

// =============================================================================
// §5f — R4-U4: translateExpr wired at let-decl / const-decl / lin-decl /
// tilde-decl initExpr sites. Closes the variable-declaration branch of the
// R1 ride-through surface (bug-5 5b: M6.2b prop-substitution path leaked
// PascalCase initExprs through let-decl / const-decl). The §5e LOCK that
// asserted PascalCase Binary for let-decl was flipped above. The LOCK at the
// end of this block guards an as-yet-unwired site (lift-expr.expr.exprNode
// at a non-MarkupValue expression-CHILD position) so R4-U5 scope remains
// visible.
//
// Coverage:
//   - let-decl initExpr Binary  -> live `binary`
//   - const-decl initExpr Member -> live `member`
//   - lin-decl initExpr Call    -> live `call`
//   - tilde-decl initExpr Object -> live `object`
//   - LOCK: lift-expr.expr.exprNode at expression-CHILD (non-MV) position
//     STILL leaks PascalCase Binary — R4-U5 territory.
// =============================================================================
describe("§5f — R4-U4 wired let/const/lin/tilde-decl initExpr sites", () => {
    test("let-decl initExpr Binary is live `binary` (R4-U4)", () => {
        const out = translate("let x = a + b;");
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].initExpr).not.toBeNull();
        // `a + b` is a Binary; R4-U4 brings live lowercase `binary`.
        expect(out[0].initExpr.kind).toBe("binary");
    });

    test("const-decl initExpr Member is live `member` (R4-U4)", () => {
        const out = translate("const y = obj.flag;");
        expect(out[0].kind).toBe("const-decl");
        expect(out[0].initExpr).not.toBeNull();
        // `obj.flag` is a Member; R4-U4 brings live lowercase `member`.
        expect(out[0].initExpr.kind).toBe("member");
    });

    test("lin-decl initExpr Call is live `call` (R4-U4)", () => {
        const out = translate("lin q = compute();");
        expect(out[0].kind).toBe("lin-decl");
        expect(out[0].initExpr).not.toBeNull();
        // `compute()` is a Call; R4-U4 brings live lowercase `call`.
        expect(out[0].initExpr.kind).toBe("call");
    });

    test("tilde-decl initExpr Object is live `object` (R4-U4)", () => {
        const out = translate("~snap = { count: 0 };");
        expect(out[0].kind).toBe("tilde-decl");
        expect(out[0].initExpr).not.toBeNull();
        // `{ count: 0 }` is an Object; R4-U4 brings live lowercase `object`.
        expect(out[0].initExpr.kind).toBe("object");
    });

    // R4 wrap surface CLOSED at R4-U5; no further wraps. R4-U6 is M6.2 wip-patch
    // re-application + M6.2b closure (no LOCK needed — surface is complete).
    test("lift-expr (non-MV) expr.exprNode is now live `binary` (R4-U5 closed)", () => {
        const out = translate("lift x + y;");
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr).not.toBeNull();
        expect(out[0].expr.kind).toBe("expr");
        expect(out[0].expr.exprNode).not.toBeNull();
        // R4-U5 closed: makeLiftExpr's non-MV branch now wraps via translateExpr;
        // `x + y` is a Binary and surfaces as live lowercase `binary`.
        expect(out[0].expr.exprNode.kind).toBe("binary");
    });
});

// =============================================================================
// §5g — R4-U5: translateExpr wired at lift-expr (non-MV) / fail-expr (variantExpr) /
// propagate-expr (exprNode) sites. Closes the R4 wrap surface in
// translate-stmt.js — every expression-CHILD ride-through (bare-expr,
// return/throw, for-iter+cStyleParts, if/while/do-while cond, let/const/lin/
// tilde init, lift-non-MV, fail-variant, propagate) now wraps via translateExpr.
//
// makeGuardedExprNode is transitively covered: it calls makeBareExpr for its
// guardedNode (translate-stmt.js L635), and makeBareExpr was R4-U1's wrap site
// (L384). Test 5 below double-checks that transitive path.
//
// Closing convention (PA): R4 wrap surface CLOSED. Any future ride-through
// additions should be R4-wired at definition time (not deferred to a
// continuation unit). R4-U6 is M6.2 wip-patch re-application + M6.2b closure,
// NOT a new wrap unit — no new LOCK is added here.
// =============================================================================
describe("§5g — R4-U5 wired lift-non-MV / fail-variant / propagate-expr sites", () => {
    test("lift-expr non-MV bare-ident exprNode is live `ident` (R4-U5)", () => {
        const out = translate("lift x;");
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr).not.toBeNull();
        expect(out[0].expr.kind).toBe("expr");
        expect(out[0].expr.exprNode).not.toBeNull();
        // `x` is a bare Ident; R4-U5 brings live lowercase `ident`.
        expect(out[0].expr.exprNode.kind).toBe("ident");
    });

    test("lift-expr MV path STILL works (M6.2a not disturbed)", () => {
        // `parseProgram` does NOT thread `ctx.source`, so parseMarkupValue takes
        // the token-range fallback path; the M6.2a bridge produces a defensive
        // empty MarkupNode (kind:"markup", empty tag/attrs/children). The PRIMARY
        // structural-recovery path is exercised by §5b's source-available tests
        // and bug-5-nested-component-ce-phantom-dom.test.js end-to-end. The
        // critical assertion here is that the lift's expr is the `{ kind:"markup",
        // node }` MV-branch shape — NOT the `{ kind:"expr", exprNode }` shape
        // that R4-U5 newly touched. R4-U5 must NOT disturb this branch.
        const out = translate("lift <div>hello</div>;");
        expect(out[0].kind).toBe("lift-expr");
        expect(out[0].expr).not.toBeNull();
        expect(out[0].expr.kind).toBe("markup");
        expect(out[0].expr.node).not.toBeNull();
        expect(out[0].expr.node.kind).toBe("markup");
        // Token-range fallback — tag is the defensive empty string (cf. §5b L460).
        expect(out[0].expr.node.tag).toBe("");
        // The MV branch does NOT put an `exprNode` on `expr`.
        expect(out[0].expr.exprNode).toBeUndefined();
    });

    test("fail-expr Member variantExpr is live `member` (R4-U5)", () => {
        const out = translate("fail Error::NotFound;");
        expect(out[0].kind).toBe("fail-expr");
        expect(out[0].variantExpr).not.toBeNull();
        // `Error::NotFound` is a Member (qualified variant); R4-U5 brings live
        // lowercase `member`.
        expect(out[0].variantExpr.kind).toBe("member");
    });

    test("propagate-expr Call exprNode is live `call` (R4-U5)", () => {
        const out = translate("compute()?;");
        expect(out[0].kind).toBe("propagate-expr");
        expect(out[0].exprNode).not.toBeNull();
        // `compute()` is a Call; R4-U5 brings live lowercase `call`.
        expect(out[0].exprNode.kind).toBe("call");
    });

    test("guarded-expr.guardedNode inherits R4-U1 wrap via makeBareExpr (transitive)", () => {
        const out = translate("compute() !{ | ::E => return };");
        expect(out[0].kind).toBe("guarded-expr");
        expect(out[0].guardedNode).not.toBeNull();
        // makeGuardedExprNode wraps the inner Expr as a bare-expr via
        // makeBareExpr (translate-stmt.js L635); makeBareExpr was R4-U1's wrap
        // site (L384). So the guarded expression's exprNode is live lowercase.
        expect(out[0].guardedNode.kind).toBe("bare-expr");
        expect(out[0].guardedNode.exprNode).not.toBeNull();
        // `compute()` is a Call; live kind is lowercase `call`.
        expect(out[0].guardedNode.exprNode.kind).toBe("call");
    });
});

// =============================================================================
describe("§6 — destructuring binding patterns", () => {
    test("array destructuring let translates to destructure-array name", () => {
        const out = translate("let [a, b] = pair;");
        expect(out[0].kind).toBe("let-decl");
        expect(out[0].name.kind).toBe("destructure-array");
        expect(out[0].name.elements.length).toBe(2);
        expect(out[0].name.elements[0]).toEqual({ kind: "name", name: "a" });
    });

    test("array destructuring hole translates to a hole element", () => {
        const out = translate("let [x, , z] = triple;");
        expect(out[0].name.kind).toBe("destructure-array");
        expect(out[0].name.elements[1]).toEqual({ kind: "hole" });
    });

    test("array destructuring rest captures the rest name", () => {
        const out = translate("let [head, ...tail] = list;");
        expect(out[0].name.rest).toBe("tail");
    });

    test("object destructuring shorthand", () => {
        const out = translate("const { name, age } = person;");
        expect(out[0].name.kind).toBe("destructure-object");
        expect(out[0].name.properties[0]).toEqual({
            kind: "name", fieldName: "name", bindName: "name",
        });
    });

    test("object destructuring rename", () => {
        const out = translate("const { name: who } = person;");
        expect(out[0].name.properties[0]).toEqual({
            kind: "name", fieldName: "name", bindName: "who",
        });
    });

    test("object destructuring rest", () => {
        const out = translate("const { a, ...others } = obj;");
        expect(out[0].name.rest).toBe("others");
    });

    test("for-of with array destructuring carries a DestructurePattern variable", () => {
        const out = translate("for (const [k, v] of entries) { use(k, v); }");
        expect(out[0].kind).toBe("for-stmt");
        expect(out[0].variable.kind).toBe("destructure-array");
    });
});

// =============================================================================
describe("§7 — id-stamping + span discipline", () => {
    test("every translated node carries a numeric id", () => {
        const out = translate("let a = 1; foo(); if (b) { bar(); }");
        for (const node of out) {
            expect(typeof node.id).toBe("number");
        }
    });

    test("ids are unique within a translation using a shared counter", () => {
        const out = translate("let a = 1; let b = 2; function f() { return a; }");
        const ids = [];
        function collect(nodes) {
            for (const n of nodes) {
                ids.push(n.id);
                if (Array.isArray(n.body)) collect(n.body);
                if (Array.isArray(n.consequent)) collect(n.consequent);
            }
        }
        collect(out);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("a caller-supplied counter continues from its current value", () => {
        const counter = { next: 100 };
        const out = translate("let a = 1;", counter);
        expect(out[0].id).toBe(101);
        expect(counter.next).toBe(101);
    });

    test("every translated node carries a span", () => {
        const out = translate("let a = 1; foo();");
        for (const node of out) {
            expect(node.span).toBeDefined();
            expect(typeof node.span.start).toBe("number");
        }
    });
});

// =============================================================================
describe("§8 — defensive folds", () => {
    test("a missing native body folds to an empty array", () => {
        expect(translateStmtList(undefined)).toEqual([]);
        expect(translateStmtList(null)).toEqual([]);
    });

    test("a non-array native body folds to an empty array", () => {
        expect(translateStmtList({ kind: "VarDecl" })).toEqual([]);
        expect(translateStmtList("not an array")).toEqual([]);
    });

    test("null entries in the body are skipped", () => {
        const counter = { next: 0 };
        const out = translateStmtList([null, undefined], counter);
        expect(out).toEqual([]);
    });
});

// =============================================================================
describe("§9 — corpus diff: translated nodes walk cleanly", () => {
    // A micro-corpus of statement-shape sources. For each, the translated
    // output is asserted to (a) be a flat live LogicStatement[], (b) carry ONLY
    // live lowercase kinds (no leaked native PascalCase kind), recursively.
    const CORPUS = [
        "let total = 0;",
        "const items = [1, 2, 3];",
        "function sum(xs) { let acc = 0; for (const x of xs) { acc = acc + x; } return acc; }",
        "if (ready) { start(); } else { wait(); }",
        "while (running) { tick(); if (done) { break; } }",
        "do { poll(); } while (pending);",
        "for (let i = 0; i < n; i = i + 1) { visit(i); }",
        'import { helper } from "./util";',
        "export const NAME = 1;",
        "lift result;",
        "fail Err::Bad;",
        "outer: for (const a of as) { for (const b of bs) { if (a) { continue outer; } } }",
        "const { x, y: yy, ...rest } = point;",
        "let [first, , third] = row;",
    ];

    // walkKinds — recursively collect every node `kind` in a translated tree.
    function walkKinds(nodes, acc) {
        for (const n of nodes) {
            if (n === null || n === undefined) continue;
            acc.push(n.kind);
            if (Array.isArray(n.body)) walkKinds(n.body, acc);
            if (Array.isArray(n.consequent)) walkKinds(n.consequent, acc);
            if (Array.isArray(n.alternate)) walkKinds(n.alternate, acc);
            if (n.catchNode && Array.isArray(n.catchNode.body)) walkKinds(n.catchNode.body, acc);
            if (n.finallyNode && Array.isArray(n.finallyNode.body)) walkKinds(n.finallyNode.body, acc);
        }
        return acc;
    }

    for (const source of CORPUS) {
        test(`corpus walks to live kinds only: ${source}`, () => {
            const out = translate(source);
            expect(Array.isArray(out)).toBe(true);
            const kinds = walkKinds(out, []);
            expect(kinds.length).toBeGreaterThan(0);
            for (const k of kinds) {
                expect(LIVE_KINDS.has(k)).toBe(true);
            }
        });
    }

    test("the full corpus translates without throwing", () => {
        for (const source of CORPUS) {
            expect(() => translate(source)).not.toThrow();
        }
    });
});
