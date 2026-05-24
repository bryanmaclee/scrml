// translate-stmt.js — JS-host shadow of translate-stmt.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors translate-stmt.scrml's header.
//
// =============================================================================
// M5-swap Unit R1 — the STATEMENT-CATALOG BRIDGE.
//
// THE PROBLEM. The native parser's `parseProgram` (parse-stmt.js) emits a
// PascalCase ESTree-shaped `Stmt[]` — the 20-kind `ast-stmt.js` catalog
// (`VarDecl` / `If` / `For` / `ExprStmt` / `FunctionDecl` / ...). The live
// `FileAST` `logic` node carries a scrml-specific LOWERCASE `LogicStatement[]`
// union — `let-decl` / `if-stmt` / `for-stmt` / `bare-expr` / `lift-expr` /
// `function-decl` / ... (compiler/src/types/ast.ts:1358). 37 downstream files
// walk the live union by lowercase kind; codegen `emit-logic.ts` is the
// deepest (it dispatches ~40 lowercase kinds).
//
// This module is the bridge: native `Stmt[]` -> live `LogicStatement[]`. It
// is an N×M STRUCTURAL translation, not a case-rename.
//
// TRANSLATION LOCUS (R1 design decision). This is a native-parser
// EXIT-SHAPING module — a sibling of `collect-hoisted.js`, NOT a mutation of
// `parse-stmt.js`. `parseProgram` stays pure (it still emits the native
// `Stmt[]`). `translate-stmt` is an OPTIONAL exit shaper the FileAST
// assembler (Unit R3) invokes. Rationale: (1) M6-aligned — "the native parser
// IS the front-end", so the front-end's file-assembly exit should hand the
// back-end the live `LogicStatement` catalog, not a foreign one R3 must learn;
// (2) mirrors the established `collectHoisted` pure-fold pattern; (3) keeps R3
// genuinely thin — R3 calls `translateStmtList(nativeBody)` and is done.
//
// THE EXPRESSION LAYER. Per DD #27 F2 ("ESTree decorations: RETIRE"),
// expression children originally rode through verbatim — a native `Expr` node
// was left AS-IS in the live node's `*Expr` field (`initExpr`, `condExpr`,
// `iterExpr`, `exprNode`, `headerExpr`). R1's scope is the STATEMENT catalog;
// the expression bridge is `translate-expr.js` (A2). The R4 unit series
// progressively wires `translateExpr` into each R1 ride-through site so the
// native PascalCase `Ident`/`Binary`/`Call` is reconciled to the live
// lowercase `ident`/`binary`/`call` before reaching the downstream emit-expr
// lowercase-only switch (which previously silently emitted `""` for any
// PascalCase Expr that reached it). R4-U1 (S122) wired bare-expr +
// return-stmt + throw-stmt. R4-U2 wires for-stmt iterExpr + cStyleParts.
// Remaining ride-throughs close under R4-U3..U5.
//
// THE FORBIDDEN-VOCABULARY KINDS — `Throw` / `Try`. scrml has no `throw` /
// `try` (SPEC §19 — `fail`, not `throw`; `!{}`, not try/catch). The native
// parser DOES produce `Throw` / `Try` Stmt nodes (ast-stmt.js M3.3 header:
// "parsed for legacy + JS-import inputs; a later stage rejects them in scrml
// source"). The LIVE pipeline ALSO produces `throw-stmt` / `try-stmt` AST
// nodes — for diagnostic recovery — alongside a HARD `E-ERROR-006` /
// `E-ERROR-007`. So the FAITHFUL translation maps `Throw` -> `throw-stmt` and
// `Try` -> `try-stmt`: the AST shape matches the live pipeline exactly.
// (NOTE surfaced to PA: the native parser fires NO forbidden-vocabulary
// diagnostic at the `throw` / `try` keyword lead — only structural
// `E-STMT-THROW-NO-ARGUMENT` / `E-STMT-TRY-NO-HANDLER`. The live pipeline's
// `E-ERROR-006` / `E-ERROR-007` rejection has no native counterpart. That
// diagnostic gap is a native-parser feature gap — it belongs to Unit R4
// (SPEC §34 reconciliation) or a sibling unit, NOT R1's translation scope.)
//
// THE SCRML-ONLY STATEMENT KINDS. The live `LogicStatement` union has kinds
// the native parser models as EXPRESSIONS, not statements:
//   - `lift-expr` / `fail-expr` — native `Lift` / `Fail` are ExprKind members
//     (ast-expr.js). A native `lift foo` at statement position is
//     `ExprStmt{ expression: Lift{...} }`. This module UN-WRAPS such an
//     ExprStmt into the `lift-expr` / `fail-expr` LogicStatement node.
//   - `tilde-decl` — a bare `name = expr` declaring a ~-typed variable; the
//     native parser produces an `ExprStmt{ expression: Assignment }`. This
//     module does NOT promote bare assignments to `tilde-decl` (the native
//     parser has no `~` declaration-kind signal — the live ast-builder
//     promotes via a tokenizer/keyword path the native parser does not
//     replicate). Bare assignments translate to `bare-expr`. Promotion is a
//     parser-feature gap (Unit B3) — NOT R1's translation scope.
//   - `propagate-expr` (`?` propagation operator) and `guarded-expr` (`!{}`
//     statement-level error handler) — the native parser has NO production
//     for either at statement level (`?` is ternary-only; `!{}` is a
//     block-stream `ErrorEffect` BlockKind, not a statement postfix). These
//     are SCRML-ONLY LogicStatement kinds — native-parser FEATURE gaps
//     (Units B1 / B2).
//   - `state-decl` (reactive `<name>` / `@name`), `component-def`,
//     `engine-decl` — these are markup / state-shape / hoist constructs;
//     their production + hoisting is Tier A's scope (A3), not R1's.
//
// M5-SWAP WAVE 1 (B4 / B5) CLOSED two of the gaps the R1 header flagged:
//   - `lin-decl` — `lin name = expr` (SPEC §35.2). B4 added a `lin` keyword
//     + a `KwLin` TokenKind + a `parseLinDecl` production + a `LinDecl` Stmt
//     kind. `appendTranslatedStmt`'s `LinDecl` arm maps it to `lin-decl`.
//   - `type-decl` — `type Name : kind = {...}` / `: kind` alias (SPEC §14).
//     B5 added a `type` keyword + `KwType` + `parseTypeDecl` + a `TypeDecl`
//     Stmt kind. The `TypeDecl` arm maps it to `type-decl`. (The hoisting of
//     `type-decl` into `FileAST.typeDecls` is still A3's scope; B5 makes the
//     native `type` decl translatable so A3 has a node to hoist.)
//
// =============================================================================

import { StmtKind } from "./ast-stmt.js";
import { translateExpr } from "./translate-expr.js";

// =============================================================================
// translateStmtList — calculation (pure). The module entry point. Translates a
// native `Stmt[]` (e.g. a `LogicEscape.body` or a `FunctionDecl.body`) into a
// live `LogicStatement[]`.
//
// `nativeBody` is the native `Stmt` array. `idGen` is an id allocator — a
// `{ next: number }` counter object, mirroring the live ast-builder's
// `++counter.next` id stamping. Every live LogicStatement needs a numeric
// `id` (the `BaseNode` contract, ast.ts:204). The caller (R3) supplies ONE
// shared counter for the whole file so ids are unique within the compilation
// unit. When `idGen` is omitted a fresh local counter is used (test
// convenience — ids are then file-local-from-zero).
//
// Defensive: a missing / non-array `nativeBody` folds to `[]`.
//
// Some native kinds translate to ZERO live nodes (`Empty`) or MORE THAN ONE
// (`VarDecl` with multiple declarators; `Block` flattened) — so the result is
// built by a flat-map, not a 1:1 map.
// =============================================================================
export function translateStmtList(nativeBody, idGen) {
    const counter = idGen || { next: 0 };
    if (nativeBody === undefined || nativeBody === null || Array.isArray(nativeBody) === false) {
        return [];
    }
    const out = [];
    for (const stmt of nativeBody) {
        appendTranslatedStmt(out, stmt, counter);
    }
    return out;
}

// appendTranslatedStmt — translate ONE native Stmt and append its live
// node(s) to `out`. Most kinds append exactly one node; `VarDecl` appends one
// per declarator; `Block` flattens its body in; `Empty` appends nothing.
function appendTranslatedStmt(out, stmt, counter) {
    if (stmt === undefined || stmt === null) {
        return;
    }
    switch (stmt.kind) {
        // --- statement substrate -------------------------------------------
        case StmtKind.Empty:
            // A lone `;`. The live pipeline has no empty-statement
            // LogicStatement kind — `emit-logic.ts` would `default: return ""`
            // it anyway. Drop it (a no-op carries no semantics).
            return;

        case StmtKind.Block: {
            // A bare `{ stmt* }` block. The live `LogicStatement` union has NO
            // block-statement kind — the live ast-builder never produces one
            // (braces appear only as control-flow bodies). The non-lossy
            // translation FLATTENS the block's body into the surrounding
            // statement stream. (A bare block in JS only introduces a lexical
            // scope; with no `let`/`const` shadowing across the boundary the
            // flatten is semantics-preserving for the corpus shapes. A bare
            // block that DOES shadow is vanishingly rare in scrml logic
            // bodies; flatten is the faithful best-effort given no live kind.)
            if (Array.isArray(stmt.body)) {
                for (const inner of stmt.body) {
                    appendTranslatedStmt(out, inner, counter);
                }
            }
            return;
        }

        case StmtKind.ExprStmt: {
            // `expr ;`. The native expression decides the live kind:
            //   - a `Lift` expression        -> `lift-expr` LogicStatement
            //   - a `Fail` expression        -> `fail-expr` LogicStatement
            //   - a `Propagate` expression   -> `propagate-expr` (Wave 2 B1)
            //   - a `GuardedExpr` expression -> `guarded-expr` (Wave 2 B2)
            //   - anything else              -> `bare-expr` LogicStatement
            // The un-wrap is THE structural translation `lift`/`fail`/`?`/`!{}`
            // need: the native parser models them as expressions, the live
            // union as statements (`propagate-expr` / `guarded-expr` are
            // BaseNode-extending LogicStatement kinds — ast.ts:1140/1152).
            const e = stmt.expression;
            if (e && e.kind === "Lift") {
                out.push(makeLiftExpr(e, stmt.span, counter));
                return;
            }
            if (e && e.kind === "Fail") {
                out.push(makeFailExpr(e, stmt.span, counter));
                return;
            }
            if (e && e.kind === "Propagate") {
                out.push(makePropagateExpr(e, stmt.span, counter));
                return;
            }
            if (e && e.kind === "GuardedExpr") {
                out.push(makeGuardedExprNode(e, stmt.span, counter));
                return;
            }
            // M6.5.b.4 (FIX-NATIVE, SECURITY) — a BARE `?{ ... }` SQL block at
            // statement position (`e.kind === "Sql"`, no chained `.get()`/
            // `.all()`) is promoted to a first-class `kind:"sql"` LogicStatement
            // matching the LIVE shape (ast-builder.js:11672 — `{ kind:"sql",
            // query, chainedCalls, span }`). The default `makeBareExpr` path
            // produced `{ kind:"bare-expr", exprNode:{ kind:"sql-ref",
            // nodeId:-1 } }`, which the W-CG-001 server-only detector
            // (collect.ts:isServerOnlyNode) FAILED to classify as server-only
            // (its SQL_SIGIL_PATTERN runs against `emitStringFromTree(sql-ref)`,
            // a comment placeholder that never matches `/\?\{`/`) — letting
            // server-only SQL escape the server-only path. Emitting `kind:"sql"`
            // routes through `isServerOnlyNode` collect.ts:420 (`kind==="sql"
            // => true`) and the live emit-logic.ts SQL path, closing the
            // M6.7-STOP leak class. CHAINED `?{...}.get()` arrives as a
            // `Call`-headed expression (Sql atom + postfix Member/Call chain),
            // NOT `e.kind === "Sql"` — its faithful `chainedCalls`
            // reconstruction is DEFERRED to a follow-on (SCOPING §3); the
            // isServerOnlyNode bare-expr+sql-ref hardening (collect.ts) covers
            // the chained-form leak class meanwhile.
            if (e && e.kind === "Sql") {
                out.push(makeSqlStmt(e, stmt.span, counter));
                return;
            }
            out.push(makeBareExpr(e, stmt.span, counter));
            return;
        }

        case StmtKind.VarDecl: {
            // `let`/`const`/`var` decl0, decl1, ... — ONE live decl node per
            // declarator. The live pipeline produces one `let-decl` /
            // `const-decl` per declared name; a multi-declarator native
            // `VarDecl` fans out here.
            //   declKind "let"   -> `let-decl`
            //   declKind "const" -> `const-decl`
            //   declKind "var"   -> `let-decl` (scrml has no `var`; the
            //                       closest live kind is the mutable
            //                       `let-decl`. A `var` lead is a non-scrml
            //                       shape — the native parser still parses it;
            //                       a later stage owns the rejection.)
            const declarations = Array.isArray(stmt.declarations) ? stmt.declarations : [];
            for (const declarator of declarations) {
                out.push(makeVarDeclNode(stmt.declKind, declarator, counter));
            }
            return;
        }

        // --- control flow ---------------------------------------------------
        case StmtKind.If:
            out.push(makeIfStmt(stmt, counter));
            return;

        case StmtKind.While:
            out.push(makeWhileStmt(stmt, counter, null));
            return;

        case StmtKind.DoWhile:
            out.push(makeDoWhileStmt(stmt, counter, null));
            return;

        case StmtKind.For:
            out.push(makeForStmtCStyle(stmt, counter, null));
            return;

        case StmtKind.ForIn:
        case StmtKind.ForOf:
            out.push(makeForStmtInOf(stmt, counter, null));
            return;

        case StmtKind.Return:
            out.push(makeReturnStmt(stmt, counter));
            return;

        case StmtKind.Break:
            out.push(makeBreakStmt(stmt, counter));
            return;

        case StmtKind.Continue:
            out.push(makeContinueStmt(stmt, counter));
            return;

        case StmtKind.Labeled: {
            // `label: body`. The live pipeline has NO labeled-statement kind —
            // it attaches a `label` field DIRECTLY onto the labelled LOOP node
            // (ast-builder.js L8563/8571/8574). Mirror that: translate the
            // labelled body; if it is a loop, stamp `label` onto it. A label
            // on a non-loop has no live representation — emit the inner
            // statement(s) un-labelled (`break label` only targets loops in
            // practice; a non-loop label is a vanishingly rare shape).
            appendLabeledStmt(out, stmt, counter);
            return;
        }

        // --- declarations ---------------------------------------------------
        case StmtKind.FunctionDecl:
            out.push(makeFunctionDecl(stmt, counter));
            return;

        case StmtKind.ClassDecl:
            // scrml has no `class` (SPEC — components + engines, not classes).
            // The native parser parses `class` for JS-import inputs; the live
            // `LogicStatement` union has no `class-decl` kind. Emit a
            // `bare-expr` carrying the class as its expression so the node is
            // not silently dropped (a later stage owns the rejection — the
            // native parser already records no class-specific diagnostic, the
            // same posture as `Throw`/`Try`). NOTE surfaced to PA: no live
            // class kind — a class in a scrml logic body is a non-scrml shape.
            out.push(makeBareExpr(stmt, stmt.span, counter));
            return;

        case StmtKind.Import:
            out.push(makeImportDecl(stmt, counter));
            return;

        case StmtKind.Export:
            out.push(makeExportDecl(stmt, counter));
            return;

        // --- legacy / forbidden-vocabulary error flow ----------------------
        case StmtKind.Throw:
            // scrml has no `throw` (SPEC §19). The live pipeline still
            // produces a `throw-stmt` AST node for diagnostic recovery (it
            // pairs it with a hard E-ERROR-006). Map faithfully.
            out.push(makeThrowStmt(stmt, counter));
            return;

        case StmtKind.Try:
            // scrml has no `try`/`catch`/`finally` (SPEC §19). The live
            // pipeline still produces a `try-stmt` AST node for diagnostic
            // recovery (paired with a hard E-ERROR-007). Map faithfully.
            out.push(makeTryStmt(stmt, counter));
            return;

        // --- M5-swap Wave 1 — core scrml declarations (B4 / B5) ------------
        case StmtKind.LinDecl:
            // `lin name = expr` -> live `lin-decl` (SPEC §35.2). The native
            // parser DOES recognize `lin` as of B4 — translation is faithful,
            // not the bare-expr fallback the R1 header documented.
            out.push(makeLinDeclNode(stmt, counter));
            return;

        case StmtKind.TypeDecl:
            // `type Name : kind = {...}` / `: kind` alias -> live `type-decl`
            // (SPEC §14). The native parser DOES recognize `type` as of B5.
            // The live `type-decl` is a HOISTED collection member
            // (`FileAST.typeDecls`); A3's hoist slice consumes it. When a
            // `type` decl appears inside a logic body it also flows here as a
            // `LogicStatement` — the live union carries `type-decl`.
            out.push(makeTypeDeclNode(stmt, counter));
            return;

        // --- M5-swap Wave 2 — `~` tilde declaration (B3) -------------------
        case StmtKind.TildeDecl:
            // `~name = pipeline` -> live `tilde-decl` (SPEC §32). The native
            // parser DOES recognize the `~name =` declaration shape as of B3.
            // The R1 header documented bare `name = expr` NOT being promoted
            // to `tilde-decl` — that remains true; B3 promotes only the
            // explicit `~`-sigil form.
            out.push(makeTildeDeclNode(stmt, counter));
            return;

        // --- M6.5.b.2 — V5-strict structural reactive (state) declaration --
        case StmtKind.StateDecl:
            // `<name> = expr` / `const <name> = expr` / typed / pinned /
            // default= / debounced= / throttled= / server / validators (raw)
            // -> live `state-decl` (SPEC §6.2 Shape 1/3 + §6.6 + §6.10 + §6.13).
            // The native parser DOES recognize the LHS-binding form as of
            // M6.5.b.2 — translation is faithful, not the legacy const-decl
            // {name:""} fallback the R1 header documented as the disposition
            // before the structural-decl LHS was wired.
            out.push(makeStateDeclNode(stmt, counter));
            return;

        // --- M6.7-D7 — `given` presence-guard statement (SPEC §42.2.3) ------
        case StmtKind.GivenGuard:
            // `given x [, y]* => { body }` -> live `given-guard`
            // (ast-builder.js:5523 — `{kind:"given-guard", variables, body, span}`).
            // The native parser DOES recognize the statement-position `given`
            // lead as of D7. The guarded `body` is translated recursively so the
            // nested logic statements (`let`/`function`/control flow) bridge to
            // their live LogicStatement kinds — mirroring the live ast-builder's
            // parseRecursiveBody body. The same node is produced standalone AND
            // inside a `match { ... }` arm (the match body shares the
            // statement-list parser), so one bridge arm covers both positions.
            out.push(makeGivenGuardNode(stmt, counter));
            return;

        default:
            // An unrecognized native StmtKind. The native catalog is closed at
            // 20 kinds (ast-stmt.js StmtKind) — this arm should be
            // unreachable. Drop defensively rather than emit a malformed node;
            // the no-throw discipline (the stage contract) forbids raising.
            return;
    }
}

// =============================================================================
// Live-node constructors. Each produces ONE live `LogicStatement` object: a
// lowercase `kind` tag + the live node's payload fields + `id` + `span`. The
// shapes mirror what the live ast-builder.js produces at runtime (the live TS
// interfaces in compiler/src/types/ast.ts are the contract; the runtime
// objects also carry the legacy `init` / `expr` raw-string fields some
// codegen arms still duck-type — those are reproduced for parity).
//
// Expression children (`initExpr`, `condExpr`, ...) historically rode through
// verbatim (the R1 deferral). R4 progressively wires `translateExpr` at each
// ride-through site: R4-U1 closed bare-expr / return-stmt / throw-stmt; R4-U2
// closes for-stmt iterExpr + cStyleParts triple. Remaining slots (if-stmt /
// while-stmt / do-while-stmt condExpr; let/const/lin/tilde-decl initExpr;
// lift-expr / propagate-expr / guarded-expr / fail-expr fields) ride through
// until R4-U3..U5 land.
// =============================================================================

// stampId — allocate the next id from the shared counter (the live
// ast-builder's `++counter.next` discipline). Always called exactly once per
// live node, in node-construction order.
function stampId(counter) {
    counter.next = counter.next + 1;
    return counter.next;
}

// spanOrZero — a defensive span. Native nodes always carry a span; a missing
// one folds to a zero span so a live node is never span-less (the `BaseNode`
// contract requires `span`).
function spanOrZero(span) {
    if (span === undefined || span === null) {
        return { start: 0, end: 0, line: 1, col: 1 };
    }
    return span;
}

// --- ExprStmt translations ---------------------------------------------------

// makeBareExpr — a `bare-expr` node. `exprNode` carries the LIVE lowercase
// `ExprNode` produced by the A2 expression bridge (translate-expr.js). The
// legacy runtime `.expr` string is left empty — the native parser does not
// retain raw source text on Expr nodes, and codegen prefers `exprNode`
// (BareExprNode contract, ast.ts:1086). R4-U1 wired translateExpr into the
// three text-interpolation ride-through sites (bare-expr / return-stmt /
// throw-stmt); native PascalCase Exprs were leaking through to emit-expr.ts
// where the lowercase-only switch hit `default` and silently returned `""`.
function makeBareExpr(nativeExpr, span, counter) {
    return {
        id: stampId(counter),
        kind: "bare-expr",
        expr: "",
        exprNode: nativeExpr === undefined ? null : translateExpr(nativeExpr),
        span: spanOrZero(span),
    };
}

// extractSqlQuery — pull the query string OUT of a native `Sql.raw`. `raw` is
// the VERBATIM block text INCLUDING the `?{` / `}` delimiters and the inner
// backtick fence, e.g. "?{`SELECT 1`}". This mirrors the LIVE extraction
// (ast-builder.js:11654 `block.raw.slice(2, len-1)` then tokenizeSQL, whose
// SQL_RAW token is the content BETWEEN the backticks — no backticks, no
// delimiters). Reproduced LOCALLY rather than cross-importing the live
// tokenizer (translate-stmt.js imports only native-parser siblings — a src/
// cross-import would invert the M6 "native parser IS the front-end" layering
// and risk a cycle). Defensive: a malformed / non-string `raw` yields "".
function extractSqlQuery(raw) {
    if (typeof raw !== "string") return "";
    let inner = raw;
    // Strip the leading `?{` and the trailing `}` (the SQL-context delimiters).
    if (inner.startsWith("?{")) inner = inner.slice(2);
    if (inner.endsWith("}")) inner = inner.slice(0, inner.length - 1);
    inner = inner.trim();
    // Strip the backtick fence (the scrml SQL template delimiters, §8.1).
    if (inner.startsWith("`") && inner.endsWith("`") && inner.length >= 2) {
        inner = inner.slice(1, inner.length - 1);
    }
    return inner;
}

// makeSqlStmt — promote a BARE native `Sql{raw}` at statement position to a
// live `kind:"sql"` LogicStatement (SQLNode, ast.ts:311). Matches the LIVE
// field set exactly: `{ id, kind:"sql", query, chainedCalls, span }`.
// `chainedCalls` is `[]` — `e.kind === "Sql"` is the UN-chained form by
// construction (a chained `?{...}.get()` is a `Call`-headed expression, not a
// bare `Sql` atom; see the ExprStmt arm note). M6.5.b.4 (FIX-NATIVE, security).
function makeSqlStmt(nativeSql, span, counter) {
    return {
        id: stampId(counter),
        kind: "sql",
        query: extractSqlQuery(nativeSql === undefined || nativeSql === null ? "" : nativeSql.raw),
        chainedCalls: [],
        span: spanOrZero(span),
    };
}

// isUpperInitial — predicate. True iff `name`'s first character is an ASCII
// uppercase letter (the live component-call gate — ast-builder.js L2993 / the
// parse-file.js `isUpperInitial` discipline).
function isUpperInitial(name) {
    if (typeof name !== "string" || name.length === 0) return false;
    const code = name.charCodeAt(0);
    return code >= 65 && code <= 90;
}

// Exported for unit-test access; also indirectly drives the bridge through
// `makeLiftExpr` which is reached via `translateStmtList`.
export { translateMarkupValueToLiveNode };

// translateMarkupValueToLiveNode — calculation. Convert a native MarkupValue
// (the `<tag>...</tag>` markup-as-value form from parse-expr.js:2054) into a
// live MarkupNode-shaped object (ast.ts:214). This is the M6.2a bridge that
// closes the gap surfaced by M6.2's component-expander migration: consumers
// downstream of `lift-expr.expr.node` (component-expander, name-resolver,
// dependency-graph, codegen) read `.tag` / `.attrs` / `.children` / `.isComponent`
// — all undefined on a raw native MarkupValue.
//
// SHAPE NOTES:
//   - A source-available MarkupValue carries `markup` as an ARRAY of native
//     blocks (parse-expr.js:2104 -- `trace.ctx.nodes.slice(0, 1)`), each being
//     a native parse-markup Markup block with `kind:"Markup"`, `name`, `attrs`,
//     `children` (Block[]), `closerForm`, `span`.
//   - A source-unavailable MarkupValue carries `markup` as a single object
//     `{ kind: "MarkupTokenRange", tokens, tokenStart, tokenEnd, span }`
//     (parse-expr.js:2184). No structured tag/attrs/children — defensive stub.
//
// MIRRORS `synthMarkupNode` (parse-file.js:326) — kept LOCAL here (rather than
// importing parse-file.js) to avoid a circular import (parse-file imports this
// module). The recursion handles nested Markup blocks; non-Markup children
// (Text / Comment / Logic / Sql / Css / etc.) are preserved verbatim — the
// non-Markup ASTNode shapes already match live shapes closely enough for the
// known lift-expr consumers (component-expander walks Markup children only).
//
// A1/A2 bridge note: this is the MarkupValue counterpart of the parse-file.js
// `synthMarkupNode` synthesizer. Any future consumer that needs deeper non-
// Markup-child conversion (e.g. a Logic child synthesized through translate-
// stmt's `synthLogicNode` equivalent) should be added here AND in parse-file.js
// in lockstep.
function translateMarkupValueToLiveNode(markupValue, counter) {
    if (markupValue === undefined || markupValue === null) return null;
    if (markupValue.kind !== "MarkupValue") return null;
    const markup = markupValue.markup;
    // Pick the FIRST native Markup block from the array (parse-expr.js:2104
    // already slices to the first when source is available). The single
    // top-level block IS the markup-as-value's outer element.
    let block = null;
    if (Array.isArray(markup) && markup.length > 0) {
        block = markup[0];
    } else if (markup && typeof markup === "object" && markup.kind === "Markup") {
        block = markup;
    }
    // Token-range fallback (source-unavailable): no structured tag/attrs/
    // children. Emit a defensive empty markup node — consumers reading
    // `.tag` / `.children` / `.isComponent` see safe defaults and the lift's
    // span is preserved.
    if (block === null || block.kind !== "Markup") {
        return {
            id: stampId(counter),
            kind: "markup",
            tag: "",
            attrs: [],
            children: [],
            selfClosing: true,
            closerForm: "",
            isComponent: false,
            span: spanOrZero(markupValue.span),
        };
    }
    return synthLiveMarkupNodeFromBlock(block, counter);
}

// synthLiveMarkupNodeFromBlock — calculation (mutually-recursive helper for
// translateMarkupValueToLiveNode). Build a live MarkupNode from one native
// Markup block; recurse on children.
function synthLiveMarkupNodeFromBlock(block, counter) {
    const tag = typeof block.name === "string" ? block.name : "";
    const children = synthLiveChildren(block.children, counter);
    const closerForm = (block.closerForm !== undefined && block.closerForm !== null)
        ? block.closerForm
        : "";
    return {
        id: stampId(counter),
        kind: "markup",
        tag,
        attrs: Array.isArray(block.attrs) ? block.attrs : [],
        children,
        selfClosing: block.closerForm === undefined || block.closerForm === null,
        closerForm,
        isComponent: isUpperInitial(tag),
        span: spanOrZero(block.span),
    };
}

// synthLiveChildren — calculation. Map a native Block[] (the children of a
// Markup block) into the live ASTNode[] shape. Nested Markup blocks recurse
// into `synthLiveMarkupNodeFromBlock`; non-Markup blocks (Text / Comment /
// LogicEscape / Sql / Css / Meta / ErrorEffect / etc.) are routed through
// parse-file.js's mapBlocksToNodes via a LAZY require so the bridge does not
// create a circular module-load dep (parse-file.js imports this module).
//
// Why we delegate: a child `LogicEscape` block inside a component body's
// markup (e.g. `<li>${task.title}</li>`) MUST be converted into a live
// `logic` node with a translated body — otherwise downstream consumers
// (codegen's emit-logic, name-resolver, dependency-graph) see a raw native
// LogicEscape block and fail to thread the expression. Same for nested
// state-blocks, engine-blocks, meta, comments, text — each has its own
// synth* function in parse-file.js that this bridge must invoke to produce
// the correct live shape.
//
// LAZY-REQUIRE rationale: parse-file.js -> translate-stmt.js (this module)
// is the existing import direction. A direct top-of-module
// `import { mapBlocksToNodes } from "./parse-file.js"` would create a
// cycle. Lazy-require (the pattern parse-expr.js uses for parseMarkupTrace
// at L2275) loads the helper at FIRST CALL, by which time both modules
// have finished their top-level eval.
let _mapBlocksToNodesCached = null;
function mapBlocksToNodesViaLazyRequire(blocks, counter, errors) {
    if (_mapBlocksToNodesCached === null) {
        try {
            // eslint-disable-next-line global-require
            const mod = require("./parse-file.js");
            _mapBlocksToNodesCached = mod.mapBlocksToNodesForBridge;
        } catch (e) {
            _mapBlocksToNodesCached = undefined;
        }
    }
    if (typeof _mapBlocksToNodesCached !== "function") return null;
    // mapBlocksToNodesForBridge(blocks, idGen, source, errors): source is
    // unavailable here (the bridge runs on the catalog, not on raw source),
    // so source = "". The `synth*` paths that need source (Text/Comment
    // sliceSpan) fall back to an empty string verbatim — acceptable for
    // a markup-as-value subtree where Text/Comment children are rare and
    // the live consumers walk Markup children only.
    return _mapBlocksToNodesCached(blocks, counter, "", errors);
}

function synthLiveChildren(blocks, counter) {
    if (Array.isArray(blocks) === false) return [];
    const errors = [];
    const live = mapBlocksToNodesViaLazyRequire(blocks, counter, errors);
    if (live !== null) return live;
    // Defensive fallback when the lazy-require fails (should never happen
    // outside genuine module-resolution breakage): recurse Markup children
    // ourselves, pass non-Markup children through verbatim. This keeps the
    // bridge crash-free even when parse-file.js is unreachable.
    const out = [];
    for (const child of blocks) {
        if (child === undefined || child === null) continue;
        if (child.kind === "Markup") {
            out.push(synthLiveMarkupNodeFromBlock(child, counter));
        } else {
            out.push(child);
        }
    }
    return out;
}

// makeLiftExpr — a `lift-expr` node. The live `LiftExprNode.expr` is a
// `LiftTarget` — `{ kind: "expr"; expr: string; exprNode?: ExprNode }` or
// `{ kind: "markup"; node: ASTNode }` (ast.ts:196). The native `Lift` carries
// `argument` (an Expr). A native `MarkupValue` argument is the markup-as-value
// form -> `{ kind: "markup", node }` where `node` is the LIVE MarkupNode
// produced by `translateMarkupValueToLiveNode` (M6.2a bridge); anything else
// -> `{ kind: "expr" }` with the native Expr in `exprNode`.
function makeLiftExpr(nativeLift, span, counter) {
    const arg = nativeLift ? nativeLift.argument : null;
    let target;
    if (arg && arg.kind === "MarkupValue") {
        // M6.2a bridge: convert the native MarkupValue payload to a live-
        // MarkupNode-shaped object so downstream consumers (component-
        // expander L2498 `expr.node as MarkupNode`, name-resolver L375,
        // dependency-graph L2729, codegen) can read `.tag` / `.attrs` /
        // `.children` / `.isComponent`. Pre-M6.2a this stored the raw
        // native MarkupValue here and every downstream `expr.node.tag`
        // read produced undefined.
        const liveNode = translateMarkupValueToLiveNode(arg, counter);
        target = { kind: "markup", node: liveNode };
    } else {
        // R4-U5: wrap non-MV exprNode with translateExpr (MV branch handled by
        // translateMarkupValueToLiveNode via M6.2a; do NOT touch it).
        target = { kind: "expr", expr: "", exprNode: arg === undefined || arg === null ? null : translateExpr(arg) };
    }
    return {
        id: stampId(counter),
        kind: "lift-expr",
        expr: target,
        span: spanOrZero(span),
    };
}

// makeFailExpr — a `fail-expr` node. The live `FailExprNode` carries
// `enumType` / `variant` / `args` (raw string) — ast.ts:1126. The native
// `Fail` carries `variant` — an Expr (a `Member` `Type::Variant`, optionally a
// `Call` when the variant has a payload). R1 does not deconstruct the native
// Expr into the `enumType` / `variant` / `args` string triple — that requires
// expression-layer walking the expression catalog reconciliation owns. The
// faithful R1 surface keeps the native variant Expr on `variantExpr` and
// leaves the legacy string triple empty; the eventual fail-expr consumer
// reads `variantExpr` once the expression catalog is reconciled.
function makeFailExpr(nativeFail, span, counter) {
    return {
        id: stampId(counter),
        kind: "fail-expr",
        enumType: "",
        variant: "",
        args: "",
        // R4-U5: wrap variantExpr with translateExpr. The legacy enumType/variant/
        // args string-triple stays empty (R1 deferral) — downstream consumers read
        // variantExpr once the expression catalog is reconciled (C1).
        variantExpr: nativeFail && nativeFail.variant !== undefined && nativeFail.variant !== null ? translateExpr(nativeFail.variant) : null,
        span: spanOrZero(span),
    };
}

// makePropagateExpr — a `propagate-expr` node (M5-swap Wave 2 — B1). The live
// `PropagateExprNode` (ast.ts:1140) carries `binding` (a `string | null` —
// the bound name for `let name = expr?`, `null` for a bare `expr?`) and
// `exprNode` (the structured expression). The native `Propagate{argument}`
// surfaces as a bare `expr?` statement (the un-wrap sees the `ExprStmt`
// wrapper); `binding` is `null` — a bound `let name = ...?` form is a
// `let-decl` whose initializer is the `Propagate` expression and is reached
// through the VarDecl arm, not here. `exprNode` carries the native guarded
// Expr verbatim (the R1 ride-through posture — C1 invokes translate-expr).
function makePropagateExpr(nativePropagate, span, counter) {
    const arg = nativePropagate ? nativePropagate.argument : null;
    return {
        id: stampId(counter),
        kind: "propagate-expr",
        binding: null,
        // R4-U5: wrap exprNode with translateExpr (parity with makeLiftExpr non-MV
        // branch above).
        exprNode: arg === undefined || arg === null ? null : translateExpr(arg),
        span: spanOrZero(span),
    };
}

// makeGuardedExprNode — a `guarded-expr` node (M5-swap Wave 2 — B2). The live
// `GuardedExprNode` (ast.ts:1152) carries `guardedNode` (the wrapped
// `LogicStatement`) and `arms` (an `ErrorArm[]`). The native `GuardedExpr`
// carries `expression` (an Expr) + `arms` (already parsed by `parseErrorArms`
// — the same `{ pattern, binding, handler, span }` arm shape the live
// `ErrorArm` uses). The guarded Expr is wrapped as a `bare-expr`
// LogicStatement (the live emit-logic.ts `guarded-expr` arm walks
// `guardedNode` as a LogicStatement). The wrapped `bare-expr` consumes one id
// from the SAME shared `counter` — ids stay unique within the file. The
// `bare-expr` is stamped FIRST (a lower id than the wrapping `guarded-expr`),
// matching the live ast-builder's child-before-parent id order.
function makeGuardedExprNode(nativeGuarded, span, counter) {
    const inner = nativeGuarded ? nativeGuarded.expression : null;
    const guardedNode = makeBareExpr(inner, nativeGuarded ? nativeGuarded.span : span, counter);
    return {
        id: stampId(counter),
        kind: "guarded-expr",
        guardedNode,
        arms: Array.isArray(nativeGuarded && nativeGuarded.arms) ? nativeGuarded.arms : [],
        span: spanOrZero(span),
    };
}

// --- VarDecl translation -----------------------------------------------------

// makeVarDeclNode — one declarator -> one `let-decl` / `const-decl` node.
// The live decl carries `name` (a string OR a `DestructurePattern`) + `init`
// (legacy raw string, empty here) + `initExpr` (the native init Expr).
function makeVarDeclNode(declKind, declarator, counter) {
    const liveKind = (declKind === "const") ? "const-decl" : "let-decl";
    const name = translateBindingTarget(declarator ? declarator.target : null);
    const init = declarator ? declarator.init : null;
    const node = {
        id: stampId(counter),
        kind: liveKind,
        name,
        init: "",
        span: spanOrZero(declarator ? declarator.span : null),
    };
    // `initExpr` is present only when the declarator HAS an initializer — the
    // live ast-builder omits it for an init-free `let x;`.
    // R4-U4: wrap with translateExpr so emit-expr / type-system / dependency-
    // graph / component-expander all receive a live lowercase ExprNode (the
    // PascalCase native shape leaks otherwise — bug-5 5b: M6.2b prop
    // substitution failure surface). The outer `if` already gates undefined/
    // null, so the wrap is called unconditionally inside the guard (no
    // defensive double-guard needed — contrast R4-U3's condExpr sites where
    // the slot shape itself is nullable).
    if (init !== undefined && init !== null) {
        node.initExpr = translateExpr(init);
    }
    return node;
}

// --- LinDecl / TypeDecl translation — M5-swap Wave 1 (B4 / B5) ---------------

// makeLinDeclNode — native `LinDecl{name,init}` -> live `lin-decl`
// (LinDeclNode, ast.ts:492 — `{kind:"lin-decl", name, initExpr?}`). The live
// ast-builder also stamps a legacy raw `init` string (ast-builder.js:5792);
// the native parser retains no raw text, so `init` is left empty and codegen
// reads `initExpr`. `initExpr` is present only when the declaration has an
// initializer (a `lin` declaration always should — a missing one is a
// parse-diagnostic the production already recorded).
function makeLinDeclNode(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "lin-decl",
        name: stmt.name === undefined ? "" : stmt.name,
        init: "",
        span: spanOrZero(stmt.span),
    };
    // R4-U4: wrap with translateExpr (parity with makeVarDeclNode above).
    if (stmt.init !== undefined && stmt.init !== null) {
        node.initExpr = translateExpr(stmt.init);
    }
    return node;
}

// makeTypeDeclNode — native `TypeDecl{name,typeKind,raw}` -> live `type-decl`
// (TypeDeclNode, ast.ts:1235 — `{kind:"type-decl", name, typeKind, raw}`). A
// flat 1:1 field copy — the native production already shapes `typeKind` /
// `raw` to the live contract (the `typeBodyText` helper produces the same
// `"{ ... }"` space-joined raw form the live ast-builder's type-decl path
// produces).
function makeTypeDeclNode(stmt, counter) {
    return {
        id: stampId(counter),
        kind: "type-decl",
        name: stmt.name === undefined ? "" : stmt.name,
        typeKind: stmt.typeKind === undefined ? "" : stmt.typeKind,
        raw: stmt.raw === undefined ? "" : stmt.raw,
        span: spanOrZero(stmt.span),
    };
}

// makeTildeDeclNode — native `TildeDecl{name,init}` -> live `tilde-decl`
// (TildeDeclNode, ast.ts:480 — `{kind:"tilde-decl", name, initExpr?}`). The
// structural twin of `makeLinDeclNode` (B4): the live `TildeDeclNode` and
// `LinDeclNode` share the `{name, initExpr?}` shape. The native expression
// child is ridden through verbatim on `initExpr` (the R1 deferral C1
// resolves by invoking translate-expr); `initExpr` is present only when the
// declaration has an initializer. M5-swap Wave 2 (B3).
function makeTildeDeclNode(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "tilde-decl",
        name: stmt.name === undefined ? "" : stmt.name,
        init: "",
        span: spanOrZero(stmt.span),
    };
    // R4-U4: wrap with translateExpr (parity with makeVarDeclNode / makeLinDeclNode).
    if (stmt.init !== undefined && stmt.init !== null) {
        node.initExpr = translateExpr(stmt.init);
    }
    return node;
}

// makeStateDeclNode — native `StateDecl{...}` -> live `state-decl`
// (ReactiveDeclNode, ast.ts:502). The V5-strict structural reactive
// declaration; SPEC §6.2 Shape 1/3 + §6.6 derived + §6.8 default + §6.10
// pinned + §6.13 reactivity. M6.5.b.2 Class E disposition: FIX-NATIVE,
// faithful translation, not the legacy const-decl{name:""} fallback.
//
// Live invariants per types/ast.ts:502:
//   - `name` always set (the cell name without `@`).
//   - `init` legacy raw string — left empty (native does not retain raw).
//   - `initExpr` populated when the decl has an RHS expression.
//   - `structuralForm: true` (the `<name>` form, as opposed to legacy `@name`).
//   - `isConst` true iff `const <name>` derived (SPEC §6.6).
//   - `shape` 'derived' iff isConst, else 'plain'. ('decl-with-spec' is
//     Shape 2 markup-RHS — OUT OF M6.5.b.2 scope; the native parser does
//     not currently emit Shape 2 from parseStructuralStateDecl.)
//   - `defaultExpr` ExprNode parsed from `default=expr` raw text, or null.
//   - `pinned` true iff `pinned` bareword appeared (SPEC §6.10).
//   - `isServer` (live name) true iff `server` bareword appeared (SPEC §52).
//   - `validators` ValidatorEntry[] — bareword + call-form entries captured
//     raw; `args` is null for bareword, [rawText] for call-form (live B9
//     parses raw into ExprNode/RelationalPredicateNode — not mirrored here).
//   - `reactivity.debounced` / `.throttled` AfterDurationResult; full
//     duration-grammar parse defers to live `parseAfterDuration` — native
//     stores the raw token text and translate-stmt mirrors it as the raw
//     `value` field on a minimal AfterDurationResult-shaped object.
//   - `typeAnnotation` raw type-expression text from `:T` annotation, or
//     omitted when absent.
function makeStateDeclNode(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "state-decl",
        name: stmt.name === undefined || stmt.name === null ? "" : stmt.name,
        init: "",
        // M6.7-C2 — honor the native node's `structuralForm` flag. The V5-strict
        // `<name>` path (parseStructuralStateDecl) sets it `true`; the legacy
        // `server @name` path (parseServerAtStateDecl) sets it `false`, matching
        // the live ast-builder (the legacy `@`-form is `structuralForm:false`,
        // ast-builder.js:4891). Default `true` preserves the structural path for
        // any native StateDecl that omits the flag.
        structuralForm: stmt.structuralForm !== false,
        isConst: stmt.isConst === true,
        shape: stmt.shape === "derived" ? "derived" : "plain",
        defaultExpr: null,
        pinned: stmt.pinned === true,
        span: spanOrZero(stmt.span),
    };
    // initExpr — the RHS expression. Translate through translate-expr so the
    // PascalCase native ExprNode becomes the live lowercase ExprNode.
    if (stmt.init !== undefined && stmt.init !== null) {
        node.initExpr = translateExpr(stmt.init);
    } else {
        node.initExpr = null;
    }
    // defaultExpr — SPEC §6.8 reset-target. The live `defaultExpr` is the
    // parsed ExprNode synthesised by `safeParseExprToNode` (Acorn-backed). The
    // native parser captured the raw text but the within-node-canary measures
    // FileAST-shape parity — emitting a divergent `defaultExprRaw` companion
    // field would CREATE within-node-canary divergences (EXTRA-FIELD class).
    // M6.5.b.2 intentionally OMITS the raw companion; downstream codegen
    // (`usage-analyzer.ts`, `emit-bindings.ts`) reads `defaultExpr != null`
    // and so a missing parsed ExprNode under native = a downstream feature
    // gap to surface as a sibling FIX-NATIVE unit (reactivity-grammar parse).
    // For now `defaultExpr: null` (set above) — partial parity, faithful
    // representation: a `default=` attribute IS captured by the parser; it's
    // just not yet surfaced as a parsed ExprNode on the AST. NOTE for PA:
    // this is a documented partial fix per the SCOPING §STOP conditions —
    // structural-decl LHS parses BUT default-expr parsing is a sibling unit.

    // isServer — live field name (the bareword `server` attr per SPEC §52).
    if (stmt.server === true) {
        node.isServer = true;
    }
    // typeAnnotation — SPEC §6.2 typed Shape 1/3 (`<x>: T = expr`).
    if (stmt.typeAnnotation !== undefined && stmt.typeAnnotation !== null && stmt.typeAnnotation !== "") {
        node.typeAnnotation = stmt.typeAnnotation;
    }
    // validators — Shape 2 + structural-decl validator attrs (SPEC §55).
    // The live AST sets `validators` only when Shape 2 (decl-with-spec).
    // For Shape 1/3 plain/derived the live ast-builder omits the field — but
    // when a bareword validator like `req` appears on a plain decl (`<x req>
    // = 0`), the live ast-builder declines to recognize that pattern via the
    // structural-decl path (it'd require markup-RHS). The native parser is
    // more permissive here and captures the validators regardless; the field
    // is emitted only when non-empty to keep parity with the live ast-builder
    // (which omits `validators` for Shape 1/3 — undefined-is-falsy contract).
    // M6.5.b.2 OMITS validators on Shape 1/3 to keep within-node parity tight;
    // Shape 2 markup-RHS is a separate sub-class outside this unit's scope.
    // (The captured validators are retained on the native StateDecl node so a
    // future Shape 2 sub-unit can promote them; the translate-stmt arm drops
    // them here for parity.)

    // reactivity — SPEC §6.13 debounced= / throttled= attributes. The live
    // representation is `reactivity: {debounced?: AfterDurationResult,
    // throttled?: AfterDurationResult}`. Full duration-grammar parse via
    // `parseAfterDuration` is the live ast-builder's concern; M6.5.b.2
    // OMITS the field on native (a NATIVE PARSER FEATURE GAP — surfaced to
    // PA as a sibling unit). The captured raw text is retained on the native
    // StateDecl node for the future sibling unit to consume.
    return node;
}

// --- GivenGuard translation — M6.7-D7 (SPEC §42.2.3) -------------------------

// makeGivenGuardNode — native `GivenGuard{variables, body}` -> live
// `given-guard` (ast-builder.js:5523 — `{kind:"given-guard", variables, body,
// span}`). A flat 1:1 field copy of `variables` (the bound identifier-name
// strings); the guarded `body` is translated recursively (the native body is a
// FLAT native-Stmt array — the live given-guard body is likewise a flat
// LogicStatement array), so the nested `let`/`function`/control-flow statements
// inside the guard bridge to their live kinds. The live ast-builder stamps NO
// `init`/`raw` companion on a given-guard — the native bridge matches that
// exactly (only `id, kind, variables, body, span`), so the within-node canary
// sees no EXTRA-FIELD divergence.
function makeGivenGuardNode(stmt, counter) {
    const body = [];
    if (Array.isArray(stmt.body)) {
        for (const inner of stmt.body) {
            appendTranslatedStmt(body, inner, counter);
        }
    }
    return {
        id: stampId(counter),
        kind: "given-guard",
        variables: Array.isArray(stmt.variables) ? stmt.variables.slice() : [],
        body,
        span: spanOrZero(stmt.span),
    };
}

// translateBindingTarget — a native binding node -> the live `name` field.
// A plain `Ident` binding -> the identifier string. A destructuring pattern
// (`ObjectPat` / `ArrayPat`) -> a live `DestructurePattern` (ast.ts:442).
// A missing target -> "" (the live empty-name shape).
function translateBindingTarget(target) {
    if (target === undefined || target === null) {
        return "";
    }
    if (target.bindingKind === "Ident") {
        return target.name;
    }
    if (target.bindingKind === "ObjectPat") {
        return translateObjectPattern(target);
    }
    if (target.bindingKind === "ArrayPat") {
        return translateArrayPattern(target);
    }
    // An AssignmentPattern / RestElement at the declarator target position is
    // not a valid declaration target on its own (those nest INSIDE patterns).
    // Defensive: fold to "".
    return "";
}

// translateArrayPattern — native `ArrayPat` -> live `destructure-array`
// (ast.ts:426). Elements are `Item` / `Hole` / `Rest`.
function translateArrayPattern(pat) {
    const elements = [];
    let rest;
    const nativeElements = Array.isArray(pat.elements) ? pat.elements : [];
    for (const el of nativeElements) {
        if (el === undefined || el === null) {
            continue;
        }
        if (el.elementKind === "Hole") {
            elements.push({ kind: "hole" });
        } else if (el.elementKind === "Rest") {
            rest = bindingTargetName(el.argument);
        } else {
            // an `Item` — `el.value` is the binding target.
            elements.push(translateArrayElementItem(el.value));
        }
    }
    const out = { kind: "destructure-array", elements };
    if (rest !== undefined) {
        out.rest = rest;
    }
    if (pat.span !== undefined && pat.span !== null) {
        out.span = pat.span;
    }
    return out;
}

// translateArrayElementItem — one array-pattern `Item` value -> a live
// `DestructureArrayElement`. A plain ident -> `{ kind:"name" }`; a nested
// pattern -> `{ kind:"nested" }`; an AssignmentPattern -> the defaulted form.
function translateArrayElementItem(value) {
    if (value === undefined || value === null) {
        return { kind: "name", name: "" };
    }
    if (value.bindingKind === "AssignmentPattern") {
        const inner = translateArrayElementItem(value.left);
        inner.defaultExpr = value.right === undefined ? null : value.right;
        return inner;
    }
    if (value.bindingKind === "ObjectPat") {
        return { kind: "nested", pattern: translateObjectPattern(value) };
    }
    if (value.bindingKind === "ArrayPat") {
        return { kind: "nested", pattern: translateArrayPattern(value) };
    }
    // a plain `Ident`.
    return { kind: "name", name: bindingTargetName(value) };
}

// translateObjectPattern — native `ObjectPat` -> live `destructure-object`
// (ast.ts:434). Properties are `KeyValue` / `Shorthand` / `Rest`.
function translateObjectPattern(pat) {
    const properties = [];
    let rest;
    const nativeProps = Array.isArray(pat.properties) ? pat.properties : [];
    for (const prop of nativeProps) {
        if (prop === undefined || prop === null) {
            continue;
        }
        if (prop.propertyKind === "Rest") {
            rest = bindingTargetName(prop.argument);
        } else if (prop.propertyKind === "Shorthand") {
            properties.push(translateObjectShorthandProp(prop));
        } else {
            // `KeyValue` — `{ key: target }`.
            properties.push(translateObjectKeyValueProp(prop));
        }
    }
    const out = { kind: "destructure-object", properties };
    if (rest !== undefined) {
        out.rest = rest;
    }
    if (pat.span !== undefined && pat.span !== null) {
        out.span = pat.span;
    }
    return out;
}

// translateObjectShorthandProp — `{ name }` / `{ name = default }`.
// `prop.name` is the binding identifier; `prop.value` is the binding target
// (a plain `Ident` for `{ name }`, an `AssignmentPattern` for `{ name = d }`).
function translateObjectShorthandProp(prop) {
    const out = { kind: "name", fieldName: prop.name, bindName: prop.name };
    if (prop.value && prop.value.bindingKind === "AssignmentPattern") {
        out.defaultExpr = prop.value.right === undefined ? null : prop.value.right;
    }
    return out;
}

// translateObjectKeyValueProp — `{ key: target }`. `prop.key` is the key Expr;
// `prop.value` is the binding target. A nested pattern target -> the live
// `nested` form; an `AssignmentPattern` -> the defaulted form.
function translateObjectKeyValueProp(prop) {
    const fieldName = exprKeyName(prop.key);
    const value = prop.value;
    if (value && value.bindingKind === "AssignmentPattern") {
        const left = value.left;
        if (left && (left.bindingKind === "ObjectPat" || left.bindingKind === "ArrayPat")) {
            return {
                kind: "nested",
                fieldName,
                pattern: (left.bindingKind === "ObjectPat")
                    ? translateObjectPattern(left)
                    : translateArrayPattern(left),
                defaultExpr: value.right === undefined ? null : value.right,
            };
        }
        return {
            kind: "name",
            fieldName,
            bindName: bindingTargetName(left),
            defaultExpr: value.right === undefined ? null : value.right,
        };
    }
    if (value && value.bindingKind === "ObjectPat") {
        return { kind: "nested", fieldName, pattern: translateObjectPattern(value) };
    }
    if (value && value.bindingKind === "ArrayPat") {
        return { kind: "nested", fieldName, pattern: translateArrayPattern(value) };
    }
    return { kind: "name", fieldName, bindName: bindingTargetName(value) };
}

// bindingTargetName — best-effort identifier text for a binding leaf. A plain
// `Ident` binding -> its `name`. Anything else -> "" (a deeper pattern at a
// leaf position is handled by the dedicated nested-pattern paths above; this
// is only the fallback for the rest-binding / shorthand-leaf positions where
// the grammar guarantees an identifier).
function bindingTargetName(target) {
    if (target === undefined || target === null) {
        return "";
    }
    if (target.bindingKind === "Ident") {
        return target.name;
    }
    return "";
}

// exprKeyName — the property-key NAME for an object-pattern key Expr. An
// `Ident` key -> its `name`; a `StringLit` key -> its string value; a
// `NumberLit` key -> its numeric text. A computed `[expr]` key has no static
// name -> "" (rare in destructuring; the live pattern shape is name-keyed).
function exprKeyName(key) {
    if (key === undefined || key === null) {
        return "";
    }
    if (key.kind === "Ident") {
        return key.name;
    }
    if (key.kind === "StringLit") {
        return key.value === undefined ? "" : key.value;
    }
    if (key.kind === "NumberLit") {
        return key.raw === undefined ? "" : key.raw;
    }
    return "";
}

// --- control-flow translations -----------------------------------------------

// branchToBody — a native statement-position child (`consequent` / `body` /
// `alternate`) -> a live `LogicStatement[]`. The live control-flow nodes carry
// ARRAY-shaped branches; the native ones carry a SINGLE Stmt node. When the
// native child is a `Block`, its body translates element-wise; a single
// un-braced statement translates to a one-element array; a `null` child
// (`if` with no `else`) -> `null`, NOT `[]` (the live `alternate` is
// `LogicStatement[] | null`).
function branchToBody(nativeChild, counter) {
    if (nativeChild === undefined || nativeChild === null) {
        return null;
    }
    const out = [];
    if (nativeChild.kind === StmtKind.Block) {
        if (Array.isArray(nativeChild.body)) {
            for (const inner of nativeChild.body) {
                appendTranslatedStmt(out, inner, counter);
            }
        }
        return out;
    }
    appendTranslatedStmt(out, nativeChild, counter);
    return out;
}

// makeIfStmt — native `If{test,consequent,alternate}` -> live
// `if-stmt{consequent[],alternate[]|null,condExpr}`. `else if` chains: the
// native `alternate` is itself a (single) `If` Stmt — `branchToBody` wraps it
// as a one-element `[if-stmt]` array, exactly the live nested-chain shape.
function makeIfStmt(stmt, counter) {
    return {
        id: stampId(counter),
        kind: "if-stmt",
        consequent: branchToBody(stmt.consequent, counter) || [],
        alternate: branchToBody(stmt.alternate, counter),
        // R4-U3: wrap with translateExpr so emit-expr.ts switches receive a live
        // lowercase ExprNode. The null-guard mirrors R4-U2's idiom; if syntax
        // is always required, the undefined/null branch is defensive-only.
        condExpr: stmt.test === undefined || stmt.test === null ? null : translateExpr(stmt.test),
        span: spanOrZero(stmt.span),
    };
}

// makeWhileStmt — native `While{test,body}` -> live `while-stmt{body[],
// condExpr}`. `label` is set when this loop is the body of a `Labeled` Stmt
// (the live pipeline stamps `label` onto the loop node, not a wrapper).
function makeWhileStmt(stmt, counter, label) {
    const node = {
        id: stampId(counter),
        kind: "while-stmt",
        condition: "",
        body: branchToBody(stmt.body, counter) || [],
        // R4-U3: wrap with translateExpr (parity with makeIfStmt above).
        condExpr: stmt.test === undefined || stmt.test === null ? null : translateExpr(stmt.test),
        span: spanOrZero(stmt.span),
    };
    if (label !== null && label !== undefined) {
        node.label = label;
    }
    return node;
}

// makeDoWhileStmt — native `DoWhile{body,test}` -> live `do-while-stmt`.
// `do-while-stmt` is a runtime kind `emit-logic.ts` dispatches (case
// "do-while-stmt") though it is absent from the `LogicStatement` TS union —
// the live ast-builder.js produces it at L5153 / L8731. Mirrors that shape:
// `condition` raw string (empty), `body[]`, `condExpr`, optional `label`.
function makeDoWhileStmt(stmt, counter, label) {
    const node = {
        id: stampId(counter),
        kind: "do-while-stmt",
        condition: "",
        body: branchToBody(stmt.body, counter) || [],
        // R4-U3: wrap with translateExpr (parity with makeIfStmt above).
        condExpr: stmt.test === undefined || stmt.test === null ? null : translateExpr(stmt.test),
        span: spanOrZero(stmt.span),
    };
    if (label !== null && label !== undefined) {
        node.label = label;
    }
    return node;
}

// makeForStmtCStyle — native `For{init,test,update,body}` (the C-style
// three-clause form) -> live `for-stmt` with `variable: null` and the
// `cStyleParts` triple (ast.ts:994). The native `init` is a `VarDecl` Stmt OR
// an Expr OR null; `test` / `update` are Exprs or null. The live `cStyleParts`
// is `{ initExpr, condExpr, updateExpr }` — all ExprNode-typed. The native
// `init`-as-VarDecl declaration form (`for(let i=0; ...)`) has no direct
// ExprNode — `translateExpr` folds the VarDecl Stmt to an `escape-hatch`
// ExprNode (the default arm of translate-expr.js). This is a no-worse
// outcome than PRE-R4-U2: the PascalCase VarDecl Stmt previously hit
// `emit-expr.ts:emitExpr` default arm and emitted "" — the escape-hatch
// path emits "" too. Declaration-form C-style is a SEPARATE downstream gap.
// R4-U2 wires translateExpr at all 3 cStyleParts slots so the Expr-form
// init (`for(i=0; ...)`) and the always-Expr test/update parts produce
// live ExprNode-shaped values for the downstream consumer.
function makeForStmtCStyle(stmt, counter, label) {
    const node = {
        id: stampId(counter),
        kind: "for-stmt",
        variable: null,
        body: branchToBody(stmt.body, counter) || [],
        cStyleParts: {
            initExpr: stmt.init === undefined || stmt.init === null ? null : translateExpr(stmt.init),
            condExpr: stmt.test === undefined || stmt.test === null ? null : translateExpr(stmt.test),
            updateExpr: stmt.update === undefined || stmt.update === null ? null : translateExpr(stmt.update),
        },
        span: spanOrZero(stmt.span),
    };
    if (label !== null && label !== undefined) {
        node.label = label;
    }
    return node;
}

// makeForStmtInOf — native `ForIn` / `ForOf{left,right,body,isAwait}` -> live
// `for-stmt{variable,iterExpr,body[]}`. The native `left` is a `VarDecl` Stmt
// (declaration form `for (const x of xs)`) or an assignment-target Expr. The
// live `variable` is a `string` / `DestructurePattern` / null:
//   - VarDecl left with a single declarator  -> translate that declarator's
//     binding target (string or DestructurePattern)
//   - non-declaration left (an Expr / pattern) -> best-effort identifier text
// `iterExpr` carries the native `right` Expr bridged via translateExpr to a
// live lowercase `ExprNode` (R4-U2). `forKind` records "in" vs "of" (the
// native distinction; the live `for-stmt` is the unified for kind — codegen
// reads `forKind` when it needs the JS surface form). The iterExpr bridge
// is the load-bearing fix for `for (let task of @tasks.filter(...))` under
// M6.2b: before R4-U2 a PascalCase Call/Member/Ident leaked through to
// emit-control-flow.ts:358 emitExprField → emitExpr default arm → "".
function makeForStmtInOf(stmt, counter, label) {
    let variable = null;
    const left = stmt.left;
    if (left && left.kind === StmtKind.VarDecl) {
        const decls = Array.isArray(left.declarations) ? left.declarations : [];
        if (decls.length > 0) {
            variable = translateBindingTarget(decls[0].target);
        }
    } else if (left && left.bindingKind !== undefined) {
        variable = translateBindingTarget(left);
    } else if (left && left.kind === "Ident") {
        variable = left.name;
    }
    const node = {
        id: stampId(counter),
        kind: "for-stmt",
        variable,
        body: branchToBody(stmt.body, counter) || [],
        iterExpr: stmt.right === undefined || stmt.right === null ? null : translateExpr(stmt.right),
        forKind: (stmt.kind === StmtKind.ForIn) ? "in" : "of",
        span: spanOrZero(stmt.span),
    };
    if (label !== null && label !== undefined) {
        node.label = label;
    }
    return node;
}

// makeReturnStmt — native `Return{argument}` -> live `return-stmt`. A bare
// `return` has `argument: null` -> live `exprNode` omitted + `expr: ""` (the
// live bare-return shape, ast-builder.js L8786). When `argument` is set, the
// native Expr is bridged to a LIVE lowercase `ExprNode` via the A2 expression
// bridge — R4-U1 closes the return-stmt ride-through site so downstream
// emit-logic.ts emitReturn can dispatch on the lowercase kind.
function makeReturnStmt(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "return-stmt",
        expr: "",
        span: spanOrZero(stmt.span),
    };
    if (stmt.argument !== undefined && stmt.argument !== null) {
        node.exprNode = translateExpr(stmt.argument);
    }
    return node;
}

// makeBreakStmt — native `Break{label}` -> live `break-stmt`. `break-stmt` is
// a runtime kind `emit-logic.ts` dispatches (case "break-stmt") though it is
// absent from the `LogicStatement` TS union (live ast-builder.js L5174 /
// L8751). `label` is the optional label identifier text, or `null`.
function makeBreakStmt(stmt, counter) {
    return {
        id: stampId(counter),
        kind: "break-stmt",
        label: (stmt.label === undefined) ? null : stmt.label,
        span: spanOrZero(stmt.span),
    };
}

// makeContinueStmt — native `Continue{label}` -> live `continue-stmt`. Same
// runtime-kind status as `break-stmt` (live ast-builder.js L5193 / L8769).
function makeContinueStmt(stmt, counter) {
    return {
        id: stampId(counter),
        kind: "continue-stmt",
        label: (stmt.label === undefined) ? null : stmt.label,
        span: spanOrZero(stmt.span),
    };
}

// appendLabeledStmt — native `Labeled{label,body}`. The live pipeline has no
// labeled-statement node; it stamps `label` onto the labelled LOOP node. When
// the labelled body is a loop, build the loop WITH the label. Otherwise emit
// the inner body un-labelled (a non-loop label has no live representation).
function appendLabeledStmt(out, stmt, counter) {
    const body = stmt.body;
    const label = stmt.label;
    if (body === undefined || body === null) {
        return;
    }
    if (body.kind === StmtKind.While) {
        out.push(makeWhileStmt(body, counter, label));
        return;
    }
    if (body.kind === StmtKind.DoWhile) {
        out.push(makeDoWhileStmt(body, counter, label));
        return;
    }
    if (body.kind === StmtKind.For) {
        out.push(makeForStmtCStyle(body, counter, label));
        return;
    }
    if (body.kind === StmtKind.ForIn || body.kind === StmtKind.ForOf) {
        out.push(makeForStmtInOf(body, counter, label));
        return;
    }
    // A label on a non-loop statement — translate the inner statement(s)
    // un-labelled (no live representation for the label itself).
    appendTranslatedStmt(out, body, counter);
}

// --- declaration translations ------------------------------------------------

// makeFunctionDecl — native `FunctionDecl{name,params,body,isAsync,
// isGenerator, fnKind,isServer,isPure,isPinned,canFail,errorType}` -> live
// `function-decl` (FunctionDeclNode, ast.ts:791).
//
// M5-swap Wave 1 (B6) — the native parser now RECOGNIZES the scrml `fn` /
// `server` / `pure` modifiers + the trailing `!` failable marker. The native
// `FunctionDecl` node carries `fnKind` / `isServer` / `isPure` / `isPinned`
// / `canFail` / `errorType` (ast-stmt.js makeFunctionDecl). This arm READS
// those fields instead of defaulting them — closing the silent semantic
// flattening R1 documented (R1 defaulted every function to
// `fnKind:"function"`, `isServer:false`, `canFail:false`).
//
// `makeFunctionDecl` defaults the modifier fields when its optional
// `modifiers` arg is omitted, so a plain JS `function` (the 6-arg legacy
// call shape) still arrives here with `fnKind:"function"`, `isServer:false`,
// `canFail:false` — the same values R1 produced. The `isPure` / `isPinned`
// / `errorType` fields are emitted only when set (the live ast-builder omits
// the falsy/empty forms — `...(isPure ? {isPure:true} : {})`).
function makeFunctionDecl(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "function-decl",
        name: stmt.name === undefined ? "" : stmt.name,
        params: translateParams(stmt.params),
        body: translateStmtList(stmt.body, counter),
        fnKind: stmt.fnKind === "fn" ? "fn" : "function",
        isServer: stmt.isServer === true,
        isGenerator: stmt.isGenerator === true,
        isAsync: stmt.isAsync === true,
        canFail: stmt.canFail === true,
        span: spanOrZero(stmt.span),
    };
    // `isPure` / `isPinned` / `errorType` ride the node only when set —
    // mirroring the live ast-builder's conditional-spread emission.
    if (stmt.isPure === true) {
        node.isPure = true;
    }
    if (stmt.isPinned === true) {
        node.isPinned = true;
    }
    if (stmt.errorType !== undefined && stmt.errorType !== null && stmt.errorType !== "") {
        node.errorType = stmt.errorType;
    }
    return node;
}

// translateParams — native param-node array -> live `params: string[]`. The
// native params are binding-shaped (`Ident` / `RestElement` /
// `AssignmentPattern` / `ObjectPat` / `ArrayPat`). The live surface is a flat
// string array; each param renders to its source-shape text:
//   Ident              -> "name"
//   RestElement        -> "...name"
//   AssignmentPattern  -> "name" (the default is dropped — the live
//                         `params: string[]` carries no default text; the
//                         live ast-builder param parser has a structured
//                         default path the string surface does not expose)
//   ObjectPat/ArrayPat -> "{...}" / "[...]" placeholder (the live
//                         `params: string[]` cannot carry a structured
//                         pattern; a destructured param is a rare logic-body
//                         shape — best-effort placeholder, not lossless)
function translateParams(params) {
    if (Array.isArray(params) === false) {
        return [];
    }
    const out = [];
    for (const p of params) {
        out.push(paramName(p));
    }
    return out;
}

// paramName — one native param node -> its live string surface.
function paramName(p) {
    if (p === undefined || p === null) {
        return "";
    }
    if (p.bindingKind === "Ident") {
        return p.name;
    }
    if (p.bindingKind === "RestElement") {
        return "..." + paramName(p.argument);
    }
    if (p.bindingKind === "AssignmentPattern") {
        return paramName(p.left);
    }
    if (p.bindingKind === "ObjectPat") {
        return "{...}";
    }
    if (p.bindingKind === "ArrayPat") {
        return "[...]";
    }
    // A native param can also be a plain `Ident` Expr (the M2.3 stand-in
    // surface for arrow heads). Read its `name` if present.
    if (p.kind === "Ident") {
        return p.name;
    }
    return "";
}

// makeImportDecl — native `Import{specifiers,source}` -> live `import-decl`.
// The live `ImportDeclNode` (ast.ts:1184) carries `names[]` + `specifiers[]`
// (`{imported, local, pinned}`) + `source` + `isDefault`. The native
// specifier kinds are `Named` / `Default` / `Namespace`.
//   - `isDefault` is true when ANY specifier is a `Default` import.
//   - `names[]` is the parallel imported-name list.
//   - `specifiers[]` carries the `{imported, local, pinned}` triple (the
//     native parser has no `pinned` modifier — it defaults false).
// The legacy raw `raw` string is left empty (the native parser does not
// retain raw import source text; downstream import consumers read the
// structured `names` / `specifiers` / `source`).
function makeImportDecl(stmt, counter) {
    const nativeSpecs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
    const names = [];
    const specifiers = [];
    let isDefault = false;
    for (const s of nativeSpecs) {
        if (s === undefined || s === null) {
            continue;
        }
        if (s.specifierKind === "Default") {
            isDefault = true;
            names.push(s.local);
            specifiers.push({ imported: s.local, local: s.local, pinned: false });
        } else if (s.specifierKind === "Namespace") {
            names.push(s.local);
            specifiers.push({ imported: "*", local: s.local, pinned: false });
        } else {
            // a `Named` specifier — `imported as local`.
            names.push(s.imported);
            specifiers.push({ imported: s.imported, local: s.local, pinned: false });
        }
    }
    return {
        id: stampId(counter),
        kind: "import-decl",
        raw: "",
        names,
        specifiers,
        source: (stmt.source === undefined) ? null : stmt.source,
        isDefault,
        span: spanOrZero(stmt.span),
    };
}

// makeExportDecl — native `Export{declaration,specifiers,source,isDefault}` ->
// live `export-decl` (ast.ts:1216). The live node carries `exportedName` +
// `exportKind` + `reExportSource`. Three native shapes:
//   - `export <declaration>`   — `declaration` is set; `exportedName` /
//                                `exportKind` derive from the declaration.
//   - `export { a, b as c }`   — `specifiers` is set; a re-export when
//                                `source` is non-null.
//   - `export default ...`     — `isDefault` true.
// The live `exportedName` is a single name; for a multi-name `export { ... }`
// clause the live shape carries the first specifier's exported name (the live
// ast-builder's single-name surface). The raw `raw` string is left empty.
function makeExportDecl(stmt, counter) {
    let exportedName = null;
    let exportKind = null;
    const reExportSource = (stmt.source === undefined) ? null : stmt.source;

    if (stmt.declaration !== undefined && stmt.declaration !== null) {
        const d = stmt.declaration;
        if (d.kind === StmtKind.FunctionDecl) {
            // M5-swap Wave 1 (B6) — an exported `fn` carries `exportKind:"fn"`;
            // a `function` carries `exportKind:"function"`. The live
            // exported-decl regex distinguishes the two (ast-builder.js:7282).
            exportKind = (d.fnKind === "fn") ? "fn" : "function";
            exportedName = d.name === undefined ? null : d.name;
        } else if (d.kind === StmtKind.ClassDecl) {
            exportKind = "const";
            exportedName = d.name === undefined ? null : d.name;
        } else if (d.kind === StmtKind.VarDecl) {
            exportKind = (d.declKind === "const") ? "const" : "let";
            const decls = Array.isArray(d.declarations) ? d.declarations : [];
            if (decls.length > 0) {
                exportedName = translateBindingTarget(decls[0].target);
            }
        } else if (d.kind === StmtKind.TypeDecl) {
            // M5-swap Wave 1 (B5) — `export type Name : kind = {...}`. The
            // live `exportKind` for an exported type is "type" (the live
            // ast-builder's exported-decl regex — ast-builder.js:7282).
            exportKind = "type";
            exportedName = d.name === undefined ? null : d.name;
        } else if (d.kind === StmtKind.LinDecl) {
            // M5-swap Wave 1 (B4) — `export lin name = expr`. `lin` is a
            // binding; the live exported-decl surface has no dedicated `lin`
            // kind (the live regex covers type/function/fn/const/let) — the
            // closest live kind for an exported linear binding is "let".
            exportKind = "let";
            exportedName = d.name === undefined ? null : d.name;
        }
    } else if (reExportSource !== null) {
        exportKind = "re-export";
        const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
        if (specs.length > 0) {
            exportedName = exportSpecifierName(specs[0]);
        }
    } else {
        // a bare `export { a, b }` clause (no re-export source).
        const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
        if (specs.length > 0) {
            exportedName = exportSpecifierName(specs[0]);
        }
    }

    return {
        id: stampId(counter),
        kind: "export-decl",
        raw: "",
        exportedName,
        exportKind,
        reExportSource,
        span: spanOrZero(stmt.span),
    };
}

// exportSpecifierName — the exported name of one export-clause specifier.
// `export { local as exported }` -> `exported`; a `*`-re-export namespace
// alias rides as an ImportNamespace specifier -> its `local`.
function exportSpecifierName(spec) {
    if (spec === undefined || spec === null) {
        return null;
    }
    if (spec.exported !== undefined && spec.exported !== null) {
        return spec.exported;
    }
    if (spec.local !== undefined && spec.local !== null) {
        return spec.local;
    }
    return null;
}

// --- forbidden-vocabulary translations ---------------------------------------

// makeThrowStmt — native `Throw{argument}` -> live `throw-stmt` (ast.ts:1015).
// scrml has no `throw`; the live pipeline produces a `throw-stmt` node ONLY
// for diagnostic recovery (paired with a hard E-ERROR-006). The `exprNode`
// carries the LIVE lowercase `ExprNode` produced by the A2 expression bridge —
// R4-U1 wires the throw-stmt ride-through site so downstream emit-logic.ts
// emitThrow can dispatch on the lowercase kind even on the diagnostic-recovery
// path.
function makeThrowStmt(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "throw-stmt",
        expr: "",
        span: spanOrZero(stmt.span),
    };
    if (stmt.argument !== undefined && stmt.argument !== null) {
        node.exprNode = translateExpr(stmt.argument);
    }
    return node;
}

// makeTryStmt — native `Try{block,handler,finalizer}` -> live `try-stmt`
// (ast.ts:1031). scrml has no `try`/`catch`/`finally`; the live pipeline
// produces a `try-stmt` node ONLY for diagnostic recovery (paired with a hard
// E-ERROR-007). The live shape: `body[]` + optional `catchNode{header,body[]}`
// + optional `finallyNode{header,body[]}`. The native `block` is a `Block`
// Stmt; its body translates element-wise.
function makeTryStmt(stmt, counter) {
    const node = {
        id: stampId(counter),
        kind: "try-stmt",
        header: "",
        body: blockBody(stmt.block, counter),
        span: spanOrZero(stmt.span),
    };
    if (stmt.handler !== undefined && stmt.handler !== null) {
        node.catchNode = {
            header: catchHeader(stmt.handler.param),
            body: blockBody(stmt.handler.body, counter),
        };
    }
    if (stmt.finalizer !== undefined && stmt.finalizer !== null) {
        node.finallyNode = {
            header: "",
            body: blockBody(stmt.finalizer, counter),
        };
    }
    return node;
}

// blockBody — translate a native `Block` Stmt's body to a live
// `LogicStatement[]`. A missing / non-Block child folds to `[]`.
function blockBody(block, counter) {
    if (block === undefined || block === null || Array.isArray(block.body) === false) {
        return [];
    }
    return translateStmtList(block.body, counter);
}

// catchHeader — the `catch (param)` header text. The native catch `param` is
// a binding node (an `Ident` or a destructuring pattern) or null (the
// optional-catch-binding form `catch { }`). The live `catchNode.header` is a
// raw string — render the binding name.
function catchHeader(param) {
    if (param === undefined || param === null) {
        return "";
    }
    if (param.bindingKind === "Ident") {
        return param.name;
    }
    // a destructuring catch binding — rare; best-effort empty header.
    return "";
}
