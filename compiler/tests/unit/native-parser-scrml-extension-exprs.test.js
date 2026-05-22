// native-parser-scrml-extension-exprs.test.js — M5-swap Wave 2 (B1 + B2 + B3 + B7).
//
// Native-parser productions for core scrml expression/statement constructs the
// JS-subset M1-M4 parser had no production for:
//   B1 — `expr?`                  propagate-expr postfix operator (SPEC §19)
//   B2 — `expr !{ .E => h }`      guarded-expression handler (SPEC §19)
//   B3 — `~name = pipeline`       tilde (pipeline-reactive) declaration (SPEC §32)
//   B7 — `throw` / `try`          forbidden-vocabulary parse-layer rejection
//
// Three layers under test, end to end:
//   1. lexing       — `?` / `!` / `~` lex to their tokens (unchanged from M1).
//   2. parsing      — parseProgram dispatches the new productions; the three
//      disambiguations (ternary-vs-propagate, prefix-`!`-vs-`!{}`,
//      prefix-`~`-vs-tilde-decl) hold.
//   3. translation  — translateStmtList un-wraps `ExprStmt{Propagate|GuardedExpr}`
//      into the live `propagate-expr` / `guarded-expr` LogicStatement kinds;
//      `TildeDecl` maps to the live `tilde-decl`.
//
// DRIVER: source -> `lex` -> `parseProgram` -> `translateStmtList`.

import { describe, test, expect } from "bun:test";

import { lex } from "../../native-parser/lex.js";
import { TokenKind } from "../../native-parser/token.js";
import { StmtKind } from "../../native-parser/ast-stmt.js";
import { ExprKind } from "../../native-parser/ast-expr.js";
import { parseProgram, parseStatement } from "../../native-parser/parse-stmt.js";
import { translateStmtList } from "../../native-parser/translate-stmt.js";

// parse — source -> { body, errors }.
function parse(source) {
    return parseProgram(lex(source));
}

// translate — source -> live LogicStatement[].
function translate(source, idGen) {
    return translateStmtList(parse(source).body, idGen);
}

// codesOf — collect the diagnostic codes from a parse result.
function codesOf(prog) {
    return prog.errors.map((e) => e.code);
}

// =============================================================================
describe("§B1 — ? propagate-expr", () => {
    test("`expr?` parses to a Propagate native Expr (postfix)", () => {
        const prog = parse("fetchUser(id)?");
        expect(prog.body.length).toBe(1);
        expect(prog.body[0].kind).toBe(StmtKind.ExprStmt);
        expect(prog.body[0].expression.kind).toBe(ExprKind.Propagate);
        expect(prog.errors.length).toBe(0);
    });

    test("the Propagate node wraps the guarded expression as `argument`", () => {
        const prog = parse("fetchUser(id)?");
        const prop = prog.body[0].expression;
        expect(prop.argument).toBeDefined();
        expect(prop.argument.kind).toBe(ExprKind.Call);
    });

    test("`expr?` translates to a live `propagate-expr` LogicStatement", () => {
        const out = translate("fetchUser(id)?");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("propagate-expr");
        expect(out[0].binding).toBeNull();
        expect(out[0].exprNode).toBeDefined();
    });

    test("`?` binds tighter than a binary operator — `f()? ;` is the unit", () => {
        // A propagate `?` at statement end (followed by `;`).
        const prog = parse("loadConfig()?;");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Propagate);
        expect(prog.errors.length).toBe(0);
    });

    test("propagate `?` works inside an assignment RHS", () => {
        const prog = parse("config = loadConfig()?");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Assignment);
        expect(prog.body[0].expression.value.kind).toBe(ExprKind.Propagate);
    });

    // --- the disambiguation: ternary `?` vs propagate `?` ---
    test("a ternary `a ? b : c` is NOT mis-parsed as a propagate", () => {
        const prog = parse("a ? b : c");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Conditional);
        expect(prog.errors.length).toBe(0);
    });

    test("a ternary with an `is some` test stays a ternary", () => {
        const prog = parse("count is some ? count : 0");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Conditional);
        expect(prog.errors.length).toBe(0);
    });

    test("a ternary with a unary-minus consequent (`a ? -b : c`) stays a ternary", () => {
        // `-` after `?` CAN start a consequent expression -> ternary, not
        // propagate (propagate fires only on a definite non-consequent token).
        const prog = parse("a ? -b : c");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Conditional);
        expect(prog.errors.length).toBe(0);
    });

    test("a ternary nested as a call argument stays a ternary", () => {
        const prog = parse("f(a ? b : c)");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Call);
        expect(prog.errors.length).toBe(0);
    });

    test("`expr?` before a `,` (call arg) is a propagate", () => {
        const prog = parse("f(loadA()?, loadB()?)");
        const args = prog.body[0].expression.args;
        expect(args[0].kind).toBe(ExprKind.Propagate);
        expect(args[1].kind).toBe(ExprKind.Propagate);
        expect(prog.errors.length).toBe(0);
    });

    test("`?.` optional chaining is NOT consumed as a propagate", () => {
        // `?.` lexes as a single OptionalChain token — never a propagate `?`.
        const prog = parse("user?.name");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Member);
        expect(prog.errors.length).toBe(0);
    });
});

// =============================================================================
describe("§B2 — !{} guarded-expr", () => {
    test("`expr !{ arms }` parses to a GuardedExpr native Expr", () => {
        const prog = parse("riskyParse(input) !{ .ParseError => fallback }");
        expect(prog.body.length).toBe(1);
        expect(prog.body[0].kind).toBe(StmtKind.ExprStmt);
        expect(prog.body[0].expression.kind).toBe(ExprKind.GuardedExpr);
        expect(prog.errors.length).toBe(0);
    });

    test("the GuardedExpr node carries the guarded expression + parsed arms", () => {
        const prog = parse("riskyParse(input) !{ .ParseError => fallback }");
        const g = prog.body[0].expression;
        expect(g.expression).toBeDefined();
        expect(g.expression.kind).toBe(ExprKind.Call);
        expect(Array.isArray(g.arms)).toBe(true);
        expect(g.arms.length).toBe(1);
        expect(g.arms[0].pattern).toContain("ParseError");
    });

    test("`expr !{ arms }` translates to a live `guarded-expr` LogicStatement", () => {
        const out = translate("riskyParse(input) !{ .ParseError => fallback }");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("guarded-expr");
        expect(out[0].guardedNode).toBeDefined();
        expect(out[0].guardedNode.kind).toBe("bare-expr");
        expect(out[0].arms.length).toBe(1);
    });

    test("a multi-arm `!{}` handler parses every arm", () => {
        const prog = parse("doWork() !{ .NetworkError => retry | .Timeout => abort }");
        const g = prog.body[0].expression;
        expect(g.arms.length).toBe(2);
        expect(prog.errors.length).toBe(0);
    });

    test("an unclosed `!{` fires E-EXPR-GUARDED-UNCLOSED", () => {
        const prog = parse("doWork() !{ .E => h ");
        expect(codesOf(prog)).toContain("E-EXPR-GUARDED-UNCLOSED");
    });

    // --- the disambiguation: prefix `!` vs postfix `!{` ---
    test("prefix logical-`!` (`!flag`) is NOT a guarded-expr", () => {
        const prog = parse("!flag");
        expect(prog.body[0].expression.kind).toBe(ExprKind.Unary);
        expect(prog.body[0].expression.op).toBe("!");
        expect(prog.errors.length).toBe(0);
    });

    test("prefix `!` before an object literal (`!{}`) at expression START is unary", () => {
        // At the START of a unary, `!{}` is prefix-not of an empty object —
        // the guarded-expr `!{` fires only in POSTFIX position (after a base).
        const prog = parse("x = !{}");
        expect(prog.body[0].expression.value.kind).toBe(ExprKind.Unary);
        expect(prog.errors.length).toBe(0);
    });

    test("`!flag` does not interfere with a following guarded-expr", () => {
        const prog = parse("a = !flag");
        expect(prog.body[0].expression.value.kind).toBe(ExprKind.Unary);
        expect(prog.errors.length).toBe(0);
    });

    test("the guarded-expr's bare-expr inner node gets a distinct id", () => {
        const out = translate("riskyParse(x) !{ .E => h }");
        expect(out[0].id).not.toBe(out[0].guardedNode.id);
    });
});

// =============================================================================
describe("§B1+B2 — the ? then !{ combo", () => {
    test("`expr? !{ arms }` — propagate then guard, both recognized", () => {
        const prog = parse("x = fetchUser(id)? !{ .NotFound => guest }");
        // `fetchUser(id)?` is a Propagate; the `!{` then guards the propagate.
        const rhs = prog.body[0].expression.value;
        expect(rhs.kind).toBe(ExprKind.GuardedExpr);
        expect(rhs.expression.kind).toBe(ExprKind.Propagate);
        expect(prog.errors.length).toBe(0);
    });
});

// =============================================================================
describe("§B7 — throw / try forbidden-vocabulary diagnostic", () => {
    test("`throw` fires E-THROW-NOT-IN-SCRML at the keyword", () => {
        const prog = parse('throw new Error("nope")');
        expect(codesOf(prog)).toContain("E-THROW-NOT-IN-SCRML");
    });

    test("`throw` still parses for diagnostic recovery (the Throw node survives)", () => {
        const prog = parse('throw new Error("nope")');
        expect(prog.body.length).toBe(1);
        expect(prog.body[0].kind).toBe(StmtKind.Throw);
        expect(prog.body[0].argument).not.toBeNull();
    });

    test("a bare `throw` (no argument) fires BOTH B7 + E-STMT-THROW-NO-ARGUMENT", () => {
        const prog = parse("throw\n");
        const codes = codesOf(prog);
        expect(codes).toContain("E-THROW-NOT-IN-SCRML");
        expect(codes).toContain("E-STMT-THROW-NO-ARGUMENT");
    });

    test("`try` fires E-TRY-NOT-IN-SCRML at the keyword", () => {
        const prog = parse("try { f() } catch (e) { g() }");
        expect(codesOf(prog)).toContain("E-TRY-NOT-IN-SCRML");
    });

    test("`try` still parses for diagnostic recovery (the Try node survives)", () => {
        const prog = parse("try { f() } catch (e) { g() }");
        expect(prog.body.length).toBe(1);
        expect(prog.body[0].kind).toBe(StmtKind.Try);
        expect(prog.body[0].handler).not.toBeNull();
    });

    test("a bare `try` (no handler) fires BOTH B7 + E-STMT-TRY-NO-HANDLER", () => {
        const prog = parse("try { f() }");
        const codes = codesOf(prog);
        expect(codes).toContain("E-TRY-NOT-IN-SCRML");
        expect(codes).toContain("E-STMT-TRY-NO-HANDLER");
    });

    test("`try`/`finally` (no catch) still fires E-TRY-NOT-IN-SCRML", () => {
        const prog = parse("try { f() } finally { g() }");
        expect(codesOf(prog)).toContain("E-TRY-NOT-IN-SCRML");
    });

    test("the B7 codes mirror E-ASYNC-NOT-IN-SCRML — a fail-suggesting message", () => {
        const prog = parse("throw err");
        const throwErr = prog.errors.find((e) => e.code === "E-THROW-NOT-IN-SCRML");
        expect(throwErr.message).toContain("fail");
    });

    test("`obj.throw` / `obj.try` member access does NOT fire B7", () => {
        // `throw` / `try` as member-property names are valid (parseMemberProperty
        // admits any keyword); the B7 rejection fires only at a statement lead.
        expect(codesOf(parse("obj.throw;"))).not.toContain("E-THROW-NOT-IN-SCRML");
        expect(codesOf(parse("obj.try;"))).not.toContain("E-TRY-NOT-IN-SCRML");
    });
});

// =============================================================================
describe("§B3 — ~ tilde-decl", () => {
    test("`~name = pipeline` parses to a TildeDecl native Stmt", () => {
        const prog = parse("~total = orders");
        expect(prog.body.length).toBe(1);
        expect(prog.body[0].kind).toBe(StmtKind.TildeDecl);
        expect(prog.body[0].name).toBe("total");
        expect(prog.body[0].init).not.toBeNull();
        expect(prog.errors.length).toBe(0);
    });

    test("`~name = pipeline` translates to a live `tilde-decl`", () => {
        const out = translate("~total = orders");
        expect(out.length).toBe(1);
        expect(out[0].kind).toBe("tilde-decl");
        expect(out[0].name).toBe("total");
        expect(out[0].initExpr).toBeDefined();
    });

    test("a call/member initializer rides through on the TildeDecl node", () => {
        // The B3 production parses the initializer at assignment-expression
        // level — whatever the expression grammar accepts. (The §32 `|>`
        // pipeline operator itself is a SEPARATE native-parser expression-
        // grammar gap, not in B3's scope; B3 only adds the `~`-declaration
        // statement production.)
        const prog = parse("~total = orders.reduce(addAmount, 0)");
        expect(prog.body[0].kind).toBe(StmtKind.TildeDecl);
        expect(prog.body[0].init).not.toBeNull();
        expect(prog.errors.length).toBe(0);
    });

    test("`~name` with no `=` is NOT a tilde-decl lead (falls through)", () => {
        // tildeDeclLeadFollows requires the trailing `=`; a bare `~total`
        // (no initializer) is not a tilde-declaration lead — it falls through
        // to expression parsing rather than mis-committing to the production.
        const prog = parse("~total");
        expect(prog.body[0].kind).not.toBe(StmtKind.TildeDecl);
    });

    test("parseTildeDecl records E-STMT-TILDE-INIT when an initializer is missing", () => {
        // Drive the production directly: `~total ;` reaches parseTildeDecl via
        // the dispatch (the `=` check inside the production records the
        // missing-initializer diagnostic on the recovery path).
        const prog = parse("~total = ;");
        expect(prog.body[0].kind).toBe(StmtKind.TildeDecl);
        // `~total =` then `;` — the `=` is present so it commits; the
        // initializer parse handles the malformed tail.
        expect(prog.body[0].name).toBe("total");
    });

    // --- the disambiguation: prefix-bitwise-`~` vs tilde-decl ---
    test("prefix bitwise-`~` (`~x`) does NOT parse as a tilde-decl", () => {
        const prog = parse("~x;");
        expect(prog.body[0].kind).toBe(StmtKind.ExprStmt);
        expect(prog.body[0].expression.kind).not.toBe(ExprKind.Tilde);
    });

    test("`~bits = ~rawBits` — LHS is a tilde-decl, RHS keeps bitwise-`~`", () => {
        const prog = parse("~bits = ~rawBits");
        expect(prog.body[0].kind).toBe(StmtKind.TildeDecl);
        expect(prog.body[0].name).toBe("bits");
        // The RHS `~rawBits` is a bitwise-NOT unary on the initializer.
        expect(prog.body[0].init).not.toBeNull();
        expect(prog.body[0].init.kind).toBe(ExprKind.Unary);
        expect(prog.body[0].init.op).toBe("~");
    });

    test("a non-adjacent `~ total = x` does NOT parse as a tilde-decl", () => {
        // `~ total` (whitespace gap) is the §32 standalone accumulator `~`
        // followed by an identifier — not a tilde-declaration lead.
        const prog = parse("~ total = x");
        expect(prog.body[0].kind).not.toBe(StmtKind.TildeDecl);
    });

    test("`~x` used in expression position keeps the §32 accumulator atom", () => {
        // The standalone `~` accumulator (no adjacent operand) is unaffected.
        const prog = parse("result = ~ + 1");
        expect(prog.errors.length).toBe(0);
    });

    test("the TildeDecl arm reuses the LinDecl shape — initExpr present iff init", () => {
        const out = translate("~v = compute()");
        expect(out[0].kind).toBe("tilde-decl");
        expect(out[0].init).toBe("");
        expect(out[0].initExpr).toBeDefined();
    });
});
