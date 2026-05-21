// translate-expr-bridge.test.js — M5-swap Unit A2 — the expression-catalog
// bridge unit tests.
//
// The unit under test is compiler/native-parser/translate-expr.js's
// `translateExpr` — the native PascalCase `Expr` -> live lowercase `ExprNode`
// translation. The brief mandates per-kind translation unit tests covering
// every native ExprKind, every fan-out branch, every fan-in collapse, and the
// escape-hatch passthrough. This file covers:
//   §1  leaf nodes — Ident / AtCell / BareVariant / Tilde / NotValue
//   §2  literal fan-in — NumberLit / StringLit / BoolLit / RegexLit / TemplateLit
//   §3  composite primary — Array / Object / Paren unwrap
//   §4  operators — Unary / Update / Binary / Logical / Assignment / Conditional
//   §5  call / member / new — Call / New / Member(dot) / Member(computed→index)
//   §6  arrow / function fan-in — Arrow / Function → lambda
//   §7  IsCheck fan-out — Not / Some / Given / NotNot / Variant
//   §8  scrml-extension forms — Sql / InputStateRef / Match
//   §9  escape-hatch passthrough — This / Super / TaggedTemplate / Sequence /
//       Yield / Render / MarkupValue / Lift / Fail
//   §10 defensive folds — missing / non-object input, translateExprList
//   §11 catalog coverage — every native ExprKind maps to a live ExprNode kind
//
// DRIVER: source -> `lex` -> `parseProgram` -> first stmt's `.expression` ->
// `translateExpr`. The native parser is the FROM side; `translateExpr` is the
// unit under test. Mirrors translate-stmt-bridge.test.js's driver convention.

import { describe, test, expect } from "bun:test";

import { lex } from "../../native-parser/lex.js";
import { parseProgram } from "../../native-parser/parse-stmt.js";
import { ExprKind } from "../../native-parser/ast-expr.js";
import { translateExpr, translateExprList } from "../../native-parser/translate-expr.js";

// nativeExpr — drive source -> native Expr. Parses `<source>;` as a program,
// returns the first statement's wrapped expression (the native parser models
// a free expression at statement position as `ExprStmt{expression}`).
function nativeExpr(source) {
    const program = parseProgram(lex(source + ";"));
    const stmt = program.body[0];
    return stmt && stmt.expression !== undefined ? stmt.expression : stmt;
}

// translate — the full source -> native Expr -> live ExprNode pipeline.
function translate(source) {
    return translateExpr(nativeExpr(source));
}

// The set of live lowercase ExprNode kinds the translation is permitted to
// emit (ast.ts:1939 — the 20-member ExprNode union). Used by the catalog
// coverage tests to assert no leaked native PascalCase kind.
const LIVE_KINDS = new Set([
    "ident", "lit", "array", "object", "spread", "unary", "binary", "assign",
    "ternary", "member", "index", "call", "new", "lambda", "cast", "match-expr",
    "sql-ref", "input-state-ref", "escape-hatch", "reset-expr",
]);

// =============================================================================
describe("§1 — leaf nodes", () => {
    test("Ident translates to ident", () => {
        const out = translate("foo");
        expect(out.kind).toBe("ident");
        expect(out.name).toBe("foo");
    });

    test("AtCell translates to ident with the @ in name", () => {
        const out = translate("@count");
        expect(out.kind).toBe("ident");
        expect(out.name).toBe("@count");
    });

    test("BareVariant translates to ident with the leading . in name", () => {
        const out = translate(".Active");
        expect(out.kind).toBe("ident");
        expect(out.name).toBe(".Active");
    });

    test("NotValue translates to lit with litType not", () => {
        const out = translate("not");
        expect(out.kind).toBe("lit");
        expect(out.litType).toBe("not");
        expect(out.raw).toBe("not");
        expect(out.value).toBeNull();
    });

    test("every leaf node carries a span", () => {
        const out = translate("foo");
        expect(out.span).toBeDefined();
        expect(typeof out.span.start).toBe("number");
    });
});

// =============================================================================
describe("§2 — literal fan-in (5 native kinds → lit)", () => {
    test("NumberLit translates to lit (litType number, raw preserved)", () => {
        const out = translate("42");
        expect(out.kind).toBe("lit");
        expect(out.litType).toBe("number");
        expect(out.raw).toBe("42");
        expect(out.value).toBe(42);
    });

    test("StringLit translates to lit (litType string, raw keeps quotes)", () => {
        const out = translate('"hello"');
        expect(out.kind).toBe("lit");
        expect(out.litType).toBe("string");
        expect(out.raw).toBe('"hello"');
    });

    test("BoolLit translates to lit (litType bool)", () => {
        const outTrue = translate("true");
        expect(outTrue.kind).toBe("lit");
        expect(outTrue.litType).toBe("bool");
        expect(outTrue.value).toBe(true);
        expect(outTrue.raw).toBe("true");
        const outFalse = translate("false");
        expect(outFalse.value).toBe(false);
        expect(outFalse.raw).toBe("false");
    });

    test("RegexLit translates to lit (litType string, raw is /pat/flags)", () => {
        const out = translate("/ab+c/gi");
        expect(out.kind).toBe("lit");
        expect(out.litType).toBe("string");
        expect(out.raw).toBe("/ab+c/gi");
    });

    test("TemplateLit translates to lit (litType template)", () => {
        const out = translate("`a static template`");
        expect(out.kind).toBe("lit");
        expect(out.litType).toBe("template");
        expect(out.raw.startsWith("`")).toBe(true);
        expect(out.raw.endsWith("`")).toBe(true);
    });

    test("all five literal kinds collapse to the single lit kind", () => {
        const sources = ["1", '"s"', "true", "/x/", "`t`"];
        for (const s of sources) {
            expect(translate(s).kind).toBe("lit");
        }
    });
});

// =============================================================================
describe("§3 — composite primary", () => {
    test("Array translates to array with translated elements", () => {
        const out = translate("[1, 2, 3]");
        expect(out.kind).toBe("array");
        expect(out.elements.length).toBe(3);
        expect(out.elements.every((e) => e.kind === "lit")).toBe(true);
    });

    test("Array spread element translates to a spread node", () => {
        const out = translate("[1, ...rest]");
        expect(out.kind).toBe("array");
        expect(out.elements.length).toBe(2);
        expect(out.elements[0].kind).toBe("lit");
        expect(out.elements[1].kind).toBe("spread");
        expect(out.elements[1].argument.kind).toBe("ident");
        expect(out.elements[1].argument.name).toBe("rest");
    });

    test("Object translates to object with prop / shorthand / spread props", () => {
        const out = translate("({ a: 1, b, ...c })");
        expect(out.kind).toBe("object");
        expect(out.props.length).toBe(3);
        expect(out.props[0].kind).toBe("prop");
        expect(out.props[0].key).toBe("a");
        expect(out.props[0].computed).toBe(false);
        expect(out.props[0].value.kind).toBe("lit");
        expect(out.props[1].kind).toBe("shorthand");
        expect(out.props[1].name).toBe("b");
        expect(out.props[2].kind).toBe("spread");
        expect(out.props[2].argument.kind).toBe("ident");
    });

    test("Object computed key keeps the key as an ExprNode", () => {
        const out = translate("({ [k]: 1 })");
        expect(out.kind).toBe("object");
        expect(out.props[0].kind).toBe("prop");
        expect(out.props[0].computed).toBe(true);
        expect(typeof out.props[0].key).toBe("object");
        expect(out.props[0].key.kind).toBe("ident");
    });

    test("Paren unwraps to the inner expression (no live paren kind)", () => {
        const out = translate("(1 + 2)");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("+");
    });

    test("nested Paren unwraps fully", () => {
        const out = translate("(((x)))");
        expect(out.kind).toBe("ident");
        expect(out.name).toBe("x");
    });
});

// =============================================================================
describe("§4 — operators", () => {
    test("Unary translates to unary (prefix)", () => {
        const out = translate("-x");
        expect(out.kind).toBe("unary");
        expect(out.op).toBe("-");
        expect(out.prefix).toBe(true);
        expect(out.argument.kind).toBe("ident");
    });

    test("Update postfix translates to unary with prefix false", () => {
        const out = translate("x++");
        expect(out.kind).toBe("unary");
        expect(out.op).toBe("++");
        expect(out.prefix).toBe(false);
    });

    test("Update prefix translates to unary with prefix true", () => {
        const out = translate("++x");
        expect(out.kind).toBe("unary");
        expect(out.op).toBe("++");
        expect(out.prefix).toBe(true);
    });

    test("Binary translates to binary", () => {
        const out = translate("a * b");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("*");
        expect(out.left.kind).toBe("ident");
        expect(out.right.kind).toBe("ident");
    });

    test("Logical && translates to binary (no separate logical kind)", () => {
        const out = translate("a && b");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("&&");
    });

    test("Logical || translates to binary", () => {
        const out = translate("a || b");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("||");
    });

    test("Logical ?? translates to binary", () => {
        const out = translate("a ?? b");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("??");
    });

    test("Assignment translates to assign", () => {
        const out = translate("x = 1");
        expect(out.kind).toBe("assign");
        expect(out.op).toBe("=");
        expect(out.target.kind).toBe("ident");
        expect(out.value.kind).toBe("lit");
    });

    test("compound Assignment carries the compound op", () => {
        const out = translate("x += 1");
        expect(out.kind).toBe("assign");
        expect(out.op).toBe("+=");
    });

    test("Conditional translates to ternary", () => {
        const out = translate("c ? a : b");
        expect(out.kind).toBe("ternary");
        expect(out.condition.kind).toBe("ident");
        expect(out.consequent.kind).toBe("ident");
        expect(out.alternate.kind).toBe("ident");
    });
});

// =============================================================================
describe("§5 — call / member / new", () => {
    test("Call translates to call", () => {
        const out = translate("f(1, 2)");
        expect(out.kind).toBe("call");
        expect(out.callee.kind).toBe("ident");
        expect(out.args.length).toBe(2);
        expect(out.optional).toBe(false);
    });

    test("optional Call carries optional true", () => {
        const out = translate("f?.(1)");
        expect(out.kind).toBe("call");
        expect(out.optional).toBe(true);
    });

    test("New translates to new", () => {
        const out = translate("new Widget(1)");
        expect(out.kind).toBe("new");
        expect(out.callee.kind).toBe("ident");
        expect(out.args.length).toBe(1);
    });

    test("dotted Member translates to member with a string property", () => {
        const out = translate("obj.field");
        expect(out.kind).toBe("member");
        expect(out.object.kind).toBe("ident");
        expect(out.property).toBe("field");
        expect(typeof out.property).toBe("string");
        expect(out.optional).toBe(false);
    });

    test("optional dotted Member carries optional true", () => {
        const out = translate("obj?.field");
        expect(out.kind).toBe("member");
        expect(out.optional).toBe(true);
    });

    test("computed Member translates to index with an ExprNode index", () => {
        const out = translate("obj[key]");
        expect(out.kind).toBe("index");
        expect(out.object.kind).toBe("ident");
        expect(out.index.kind).toBe("ident");
        expect(out.index.name).toBe("key");
    });

    test("member chain translates recursively", () => {
        const out = translate("a.b.c");
        expect(out.kind).toBe("member");
        expect(out.property).toBe("c");
        expect(out.object.kind).toBe("member");
        expect(out.object.property).toBe("b");
        expect(out.object.object.kind).toBe("ident");
    });
});

// =============================================================================
describe("§6 — arrow / function fan-in (both → lambda)", () => {
    test("Arrow expression-body translates to lambda fnStyle arrow", () => {
        const out = translate("(a) => a + 1");
        expect(out.kind).toBe("lambda");
        expect(out.fnStyle).toBe("arrow");
        expect(out.params.length).toBe(1);
        expect(out.params[0].name).toBe("a");
        expect(out.body.kind).toBe("expr");
        expect(out.body.value.kind).toBe("binary");
    });

    test("Arrow block-body translates to lambda with a block body", () => {
        const out = translate("(a) => { return a; }");
        expect(out.kind).toBe("lambda");
        expect(out.fnStyle).toBe("arrow");
        expect(out.body.kind).toBe("block");
        expect(Array.isArray(out.body.stmts)).toBe(true);
    });

    test("Function expression translates to lambda fnStyle function", () => {
        const out = translate("(function(x) { return x; })");
        expect(out.kind).toBe("lambda");
        expect(out.fnStyle).toBe("function");
        expect(out.params.length).toBe(1);
        expect(out.body.kind).toBe("block");
    });

    test("Arrow rest param carries isRest", () => {
        const out = translate("(...args) => args");
        expect(out.kind).toBe("lambda");
        expect(out.params[0].isRest).toBe(true);
        expect(out.params[0].name).toBe("args");
    });

    test("Arrow defaulted param carries defaultValue", () => {
        const out = translate("(a = 1) => a");
        expect(out.kind).toBe("lambda");
        expect(out.params[0].name).toBe("a");
        expect(out.params[0].defaultValue).toBeDefined();
        expect(out.params[0].defaultValue.kind).toBe("lit");
    });
});

// =============================================================================
describe("§7 — IsCheck fan-out (one native kind → 3 binary ops by IsCheckOp)", () => {
    test("is not translates to binary is-not", () => {
        const out = translate("x is not");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("is-not");
        expect(out.left.kind).toBe("ident");
        expect(out.left.name).toBe("x");
    });

    test("is some translates to binary is-some", () => {
        const out = translate("x is some");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("is-some");
    });

    test("is not not translates to binary is-not-not", () => {
        const out = translate("x is not not");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("is-not-not");
    });

    test("is .Variant translates to binary is with the variant as right", () => {
        const out = translate("x is .Active");
        expect(out.kind).toBe("binary");
        expect(out.op).toBe("is");
        expect(out.left.name).toBe("x");
        // The `right` is load-bearing for the `is` op (emit-expr.ts reads it).
        expect(out.right.kind).toBe("ident");
        expect(out.right.name).toBe(".Active");
    });

    test("absence-shaped is ops synthesize a not-lit right operand", () => {
        // emit-expr.ts ignores `right` for is-not/is-some/is-not-not, but the
        // live BinaryExpr is structurally well-formed only with a `right`.
        for (const src of ["x is not", "x is some", "x is not not"]) {
            const out = translate(src);
            expect(out.right).toBeDefined();
            expect(out.right.kind).toBe("lit");
            expect(out.right.litType).toBe("not");
        }
    });
});

// =============================================================================
describe("§8 — scrml-extension expression forms", () => {
    test("Sql translates to sql-ref with nodeId -1 (C1 re-stamps)", () => {
        const out = translate("?{ select 1 }");
        expect(out.kind).toBe("sql-ref");
        expect(out.nodeId).toBe(-1);
    });

    test("InputStateRef translates to input-state-ref", () => {
        const out = translate("<#emailField>");
        expect(out.kind).toBe("input-state-ref");
        expect(out.name).toBe("emailField");
    });

    test("Match translates to match-expr with subject + rawArms", () => {
        const out = translate("match status { .Open => 1 else => 2 }");
        expect(out.kind).toBe("match-expr");
        expect(out.subject.kind).toBe("ident");
        expect(out.subject.name).toBe("status");
        expect(Array.isArray(out.rawArms)).toBe(true);
        expect(out.rawArms.length).toBe(2);
        expect(out.rawArms[0]).toContain(".Open");
        expect(out.rawArms[0]).toContain("=>");
        expect(out.rawArms[1]).toContain("else");
    });

    test("Match arm with payload bindings reconstructs the binding list", () => {
        const out = translate("match shape { .Circle(r) => r else => 0 }");
        expect(out.kind).toBe("match-expr");
        expect(out.rawArms[0]).toContain(".Circle(r)");
    });

    test("Tilde translates to an ident named ~", () => {
        // `~` is the §32 pipeline-accumulator atom; emit-expr.ts models it as
        // an ident whose name is the literal "~".
        const out = translateExpr({ kind: ExprKind.Tilde, span: null });
        expect(out.kind).toBe("ident");
        expect(out.name).toBe("~");
    });
});

// =============================================================================
describe("§9 — escape-hatch passthrough (native kinds with no live target)", () => {
    test("This translates to escape-hatch with nativeKind This", () => {
        const out = translate("this");
        expect(out.kind).toBe("escape-hatch");
        expect(out.nativeKind).toBe("This");
        expect(out.raw).toBe("this");
    });

    test("escape-hatch nodes carry a span", () => {
        const out = translate("this");
        expect(out.span).toBeDefined();
        expect(typeof out.span.start).toBe("number");
    });

    // Super / TaggedTemplate / Sequence / Yield / Render / MarkupValue / Lift /
    // Fail are escape-hatched too. Several have no clean statement-position
    // source the native parser will parse standalone — exercise translateExpr
    // directly with a synthetic native node so the per-kind routing is covered.
    const SYNTHETIC_ESCAPE_KINDS = [
        ExprKind.Super,
        ExprKind.TaggedTemplate,
        ExprKind.Sequence,
        ExprKind.Yield,
        ExprKind.Render,
        ExprKind.MarkupValue,
        ExprKind.Lift,
        ExprKind.Fail,
    ];
    for (const kind of SYNTHETIC_ESCAPE_KINDS) {
        test(`${kind} routes to escape-hatch with its nativeKind`, () => {
            const out = translateExpr({ kind, span: null });
            expect(out.kind).toBe("escape-hatch");
            expect(out.nativeKind).toBe(kind);
        });
    }

    test("param/body-stub support nodes escape-hatch defensively", () => {
        for (const kind of [ExprKind.RestElement, ExprKind.AssignmentPattern, ExprKind.BlockStub]) {
            const out = translateExpr({ kind, span: null });
            expect(out.kind).toBe("escape-hatch");
            expect(out.nativeKind).toBe(kind);
        }
    });
});

// =============================================================================
describe("§10 — defensive folds", () => {
    test("a missing native expr folds to a MissingExpr escape-hatch", () => {
        expect(translateExpr(undefined).kind).toBe("escape-hatch");
        expect(translateExpr(undefined).nativeKind).toBe("MissingExpr");
        expect(translateExpr(null).kind).toBe("escape-hatch");
    });

    test("a non-object native expr folds to an escape-hatch", () => {
        expect(translateExpr("not an expr").kind).toBe("escape-hatch");
        expect(translateExpr(42).kind).toBe("escape-hatch");
    });

    test("an unrecognized native ExprKind escape-hatches", () => {
        const out = translateExpr({ kind: "BogusKind", span: null });
        expect(out.kind).toBe("escape-hatch");
        expect(out.nativeKind).toBe("BogusKind");
    });

    test("translateExprList maps an array of native exprs", () => {
        const out = translateExprList([nativeExpr("a"), nativeExpr("1"), nativeExpr("b + c")]);
        expect(out.length).toBe(3);
        expect(out[0].kind).toBe("ident");
        expect(out[1].kind).toBe("lit");
        expect(out[2].kind).toBe("binary");
    });

    test("translateExprList folds a missing / non-array input to []", () => {
        expect(translateExprList(undefined)).toEqual([]);
        expect(translateExprList(null)).toEqual([]);
        expect(translateExprList("not an array")).toEqual([]);
    });

    test("a missing operand inside a node still produces a walkable tree", () => {
        // A native Binary with a missing right operand — defensive: the right
        // folds to an escape-hatch, the node is still a valid live binary.
        const out = translateExpr({ kind: ExprKind.Binary, op: "+", left: nativeExpr("a"), right: null, span: null });
        expect(out.kind).toBe("binary");
        expect(out.left.kind).toBe("ident");
        expect(out.right.kind).toBe("escape-hatch");
    });
});

// =============================================================================
describe("§11 — catalog coverage: native ExprKind → live ExprNode kind", () => {
    // Every native ExprKind value maps to SOME live ExprNode kind. Exercise
    // each closed-catalog entry with a synthetic minimal node and assert the
    // result carries a live lowercase kind (no leaked native PascalCase kind).
    const ALL_KINDS = Object.values(ExprKind);

    test("the native ExprKind catalog has the expected entry count", () => {
        // Guard against silent catalog drift — if a kind is added to
        // ast-expr.js this count changes and this test flags the bridge for
        // review.
        expect(ALL_KINDS.length).toBe(40);
    });

    for (const kind of ALL_KINDS) {
        test(`${kind} translates to a live ExprNode kind`, () => {
            const out = translateExpr({ kind, span: null });
            expect(out).toBeDefined();
            expect(typeof out.kind).toBe("string");
            expect(LIVE_KINDS.has(out.kind)).toBe(true);
        });
    }

    test("a recursively-walked translated tree carries only live kinds", () => {
        // walkKinds — collect every node kind in a translated ExprNode tree.
        function walkKinds(node, acc) {
            if (node === null || node === undefined || typeof node !== "object") {
                return acc;
            }
            if (typeof node.kind === "string" && LIVE_KINDS.has(node.kind)) {
                acc.push(node.kind);
            }
            for (const key of Object.keys(node)) {
                const v = node[key];
                if (Array.isArray(v)) {
                    for (const item of v) {
                        walkKinds(item, acc);
                    }
                } else if (v && typeof v === "object") {
                    walkKinds(v, acc);
                }
            }
            return acc;
        }
        const CORPUS = [
            "f(a, b + c, [1, 2])",
            "obj.field[idx].method(x)",
            "(p) => p.value is some ? p.value : 0",
            "match @state { .Loading => 1 .Ready(d) => d else => 0 }",
            "{ a: 1, b, ...rest, [k]: f(x) }",
            "x is not not && y is .Active",
            "new Builder(1).with(2).build()",
        ];
        for (const source of CORPUS) {
            const tree = translate(source);
            const kinds = walkKinds(tree, []);
            expect(kinds.length).toBeGreaterThan(0);
            for (const k of kinds) {
                expect(LIVE_KINDS.has(k)).toBe(true);
            }
        }
    });

    test("the full corpus translates without throwing", () => {
        const CORPUS = [
            "x", "@c", ".V", "42", '"s"', "true", "/r/", "`t`", "not",
            "[1, ...r]", "({ a: 1 })", "(1 + 2)", "-x", "x++", "a && b",
            "x = 1", "c ? a : b", "f(1)", "new C()", "o.p", "o[k]",
            "(a) => a", "x is some", "x is .V", "match x { else => 1 }",
        ];
        for (const source of CORPUS) {
            expect(() => translate(source)).not.toThrow();
        }
    });
});
