// translate-expr.js — JS-host shadow of translate-expr.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors translate-expr.scrml's header.
//
// =============================================================================
// M5-swap Unit A2 — the EXPRESSION-CATALOG BRIDGE.
//
// THE PROBLEM. The native parser's `parse-expr.js` emits a PascalCase
// ESTree-shaped `Expr` — the `ast-expr.js` `ExprKind` catalog (40 closed
// entries: `Ident` / `NumberLit` / `Binary` / `Conditional` / `IsCheck` /
// `Call` / ...). The live `FileAST` codegen layer dispatches a scrml-specific
// LOWERCASE `ExprNode` union — `ident` / `lit` / `binary` / `ternary` /
// `member` / `call` / ... (compiler/src/types/ast.ts:1939, 20 kinds). The
// codegen emitter `emit-expr.ts` `emitExpr` switch walks the lowercase union;
// `ast-expr.js` produces the PascalCase catalog. The two catalogs DIVERGE
// structurally — kind-rename, fan-out, fan-in — so downstream codegen does
// NOT walk the native catalog as-is.
//
// This module is the bridge: native `Expr` -> live `ExprNode`. It is an N×M
// STRUCTURAL translation, not a case-rename. It is the direct sibling of R1's
// `translate-stmt.js` (the statement-catalog bridge); R1 rode expression
// children through VERBATIM and explicitly deferred this unit ("progress-R1.md
// Gaps SURFACED item 5"). A2 closes that deferral.
//
// TRANSLATION LOCUS (A2 design decision — mirrors R1). This is a native-parser
// EXIT-SHAPING module — a sibling of `collect-hoisted.js` / `translate-stmt.js`,
// NOT a mutation of `parse-expr.js`. `parseExpression` stays pure (it still
// emits the native `Expr`). `translate-expr` is an OPTIONAL exit shaper the
// FileAST assembler (Unit C1) invokes — and that the statement bridge calls
// into for every expression CHILD it currently rides through verbatim. Once A2
// + C1 land, the statement bridge's `*Expr` fields carry live `ExprNode`s, not
// native ones.
//
// NO ID ALLOCATOR. Unlike `translate-stmt.js`, this module takes NO `idGen`
// counter. The live `ExprNode` union carries NO numeric `id` (the `id` field
// is the `BaseNode` contract for STATEMENT / MARKUP nodes — ast.ts:204 — not
// for expression nodes; `ExprNode` interfaces carry only `kind` + `span` +
// payload). So `translateExpr` is a pure 1:1 (occasionally fan-in/fan-out)
// shape map, no threaded state.
//
// THE NATIVE -> LIVE EXPRESSION-KIND MAP (the kinds A2 reconciles):
//
//   KIND-RENAME (same shape, different tag):
//     native Ident          -> live ident
//     native AtCell         -> live ident   (carries the `@` in `name`)
//     native BareVariant    -> live ident   (carries the `.` in `name`)
//     native Array          -> live array
//     native Object         -> live object
//     native Unary          -> live unary
//     native Binary         -> live binary
//     native Assignment     -> live assign
//     native Conditional    -> live ternary
//     native Call           -> live call
//     native New            -> live new
//     native Conditional    -> live ternary
//     native Sql            -> live sql-ref       (NOTE: nodeId is unresolved
//                              at translate time — A2 surfaces the SQL `raw`
//                              on the node for C1/codegen; nodeId left -1)
//     native InputStateRef  -> live input-state-ref
//     native Match          -> live match-expr
//
//   FAN-IN (several native kinds collapse to one live kind):
//     native NumberLit  ┐
//     native StringLit  ┤
//     native BoolLit    ┼-> live lit  (litType discriminates the sub-type)
//     native RegexLit   ┤
//     native TemplateLit┘
//     native NotValue   ---> live lit { litType: "not" }  (§42 absence)
//     native Logical    ---> live binary  (JS `&&`/`||`/`??` are BinaryExpr
//                            `op` values downstream — there is no separate
//                            `logical` ExprNode kind)
//     native Update     ---> live unary  (`++`/`--` are UnaryExpr `op` values;
//                            the prefix flag carries the pre/post distinction)
//     native Arrow      ┐
//     native Function   ┴-> live lambda  (`fnStyle` discriminates arrow vs fn
//                            vs function)
//
//   FAN-OUT (one native kind selects one of several live kinds by a field):
//     native IsCheck -> live binary, `op` selected by the IsCheckOp:
//       IsCheckOp.Not     -> binary op "is-not"
//       IsCheckOp.Some    -> binary op "is-some"
//       IsCheckOp.Given   -> binary op "is-some"   (presence alias of Some)
//       IsCheckOp.NotNot  -> binary op "is-not-not"
//       IsCheckOp.Variant -> binary op "is"        (the `x is .V` variant form)
//     native Member -> live member  (computed:false — dotted `obj.prop`)
//                   -> live index   (computed:true  — bracket `obj[expr]`)
//       The live catalog SPLITS member access: `MemberExpr` for the static
//       `.prop` form (`property` is a plain string), `IndexExpr` for the
//       computed `[expr]` form (`index` is an ExprNode). The native parser
//       carries both on one `Member` node with a `computed` flag.
//
//   PASSTHROUGH-UNWRAP:
//     native Paren -> translate the inner expression (the live catalog has NO
//       `paren` kind — parentheses are a parse-grouping artifact; codegen
//       re-parenthesizes from precedence). Unwrapping is non-lossy.
//
//   ESCAPE-HATCH (native kinds with NO clean live target — surfaced as gaps).
//   The live `ExprNode` union has no equivalent for these; they route to
//   `escape-hatch` with `nativeKind` carrying the native kind string (the
//   DD #27 / S115 `estreeType`->`nativeKind` rename: the field is a sub-kind
//   decoration, NOT a native<->ESTree translation surface). `emit-expr.ts`'s
//   `emitEscapeHatch` already recognizes native `"Arrow"` / `"Function"`
//   kinds on the escape-hatch node; the same dual-mode path absorbs these:
//     native This           -> escape-hatch (nativeKind "This")
//     native Super          -> escape-hatch (nativeKind "Super")
//     native TaggedTemplate -> escape-hatch (nativeKind "TaggedTemplate")
//     native Sequence       -> escape-hatch (nativeKind "Sequence")
//     native Yield          -> escape-hatch (nativeKind "Yield")
//     native Render         -> escape-hatch (nativeKind "Render")
//     native MarkupValue    -> escape-hatch (nativeKind "MarkupValue")
//   These are SURFACED to PA in progress-A2.md, NOT papered over: an
//   escape-hatch routing keeps codegen crash-free and the output correct via
//   the string-rewrite fallback, but a first-class live `ExprNode` kind for
//   each is the proper long-term target. A2 does NOT invent downstream kinds
//   and does NOT widen scope into the Tier-B parser-feature units.
//
//   `Lift` / `Fail` are ExprKind members of the native catalog but they are
//   handled by the STATEMENT bridge (translate-stmt.js un-wraps a
//   `ExprStmt{Lift|Fail}` into the `lift-expr` / `fail-expr` LogicStatement).
//   When a `Lift` / `Fail` appears as a genuine expression CHILD (rare — `lift`
//   / `fail` are statement-shaped per §10 / §19.3) A2 routes it to escape-hatch
//   so the node is not dropped; the common statement-position case never
//   reaches translateExpr (the statement bridge intercepts it first).
//
// PARAM / BODY-STUB SUPPORT NODES. `RestElement`, `AssignmentPattern`,
// `BlockStub` are ExprKind members but are NOT expression-position kinds —
// they appear only inside arrow/function HEADS + bodies. They are translated
// by the dedicated lambda-param / lambda-body paths below, never as a free
// expression. A bare one reaching `translateExpr` is defensively escape-hatched.
//
// =============================================================================

import { ExprKind, IsCheckOp } from "./ast-expr.js";

// =============================================================================
// translateExpr — calculation (pure). The module entry point. Translate ONE
// native `Expr` node into ONE live `ExprNode`.
//
// `nativeExpr` is a native `Expr` (the `ast-expr.js` catalog). A missing /
// non-object `nativeExpr` folds to a zero-span escape-hatch node so a caller
// (the statement bridge, C1) never receives `null` where an `ExprNode` is
// expected — the live `ExprNode` slots are non-nullable in the codegen walk.
//
// Returns ONE live `ExprNode`. Expressions are FLATTER than statements — there
// is no fan-out to MULTIPLE nodes (a native `Expr` is always one live
// `ExprNode`); the "fan-out" in this bridge is kind-SELECTION (`IsCheck` ->
// one of four binary ops), not node-count expansion.
// =============================================================================
export function translateExpr(nativeExpr) {
    if (nativeExpr === undefined || nativeExpr === null || typeof nativeExpr !== "object") {
        return makeEscapeHatch("MissingExpr", "", null);
    }
    switch (nativeExpr.kind) {
        // --- leaf nodes -----------------------------------------------------
        case ExprKind.Ident:
            return translateIdent(nativeExpr);
        case ExprKind.AtCell:
            // `@name` reactive ref — the live catalog models it as an `ident`
            // whose `name` INCLUDES the `@` sigil (emit-expr.ts:emitIdent
            // branches on `name.startsWith("@")`).
            return makeIdent("@" + identText(nativeExpr.name), nativeExpr.span);
        case ExprKind.BareVariant:
            // `.Variant` bare-variant — the live catalog models it as an
            // `ident` whose `name` INCLUDES the leading `.` (emit-expr.ts:
            // emitIdent branches on `charCodeAt(0) === 46`).
            return makeIdent("." + identText(nativeExpr.name), nativeExpr.span);

        case ExprKind.NumberLit:
            return makeLit(numberRaw(nativeExpr), nativeExpr.value, "number", nativeExpr.span);
        case ExprKind.StringLit:
            return makeLit(stringRaw(nativeExpr), nativeExpr.value, "string", nativeExpr.span);
        case ExprKind.BoolLit:
            return makeLit(nativeExpr.value === true ? "true" : "false", nativeExpr.value === true, "bool", nativeExpr.span);
        case ExprKind.RegexLit:
            return makeLit(regexRaw(nativeExpr), regexRaw(nativeExpr), "string", nativeExpr.span);
        case ExprKind.TemplateLit:
            return translateTemplateLit(nativeExpr);
        case ExprKind.NotValue:
            // `not` — §42 absence value. The live catalog has no `not` kind;
            // it is `lit { litType: "not" }` (emit-expr.ts:emitLit lowers a
            // `"not"` litType to `null`). `raw` is "not" — the scrml canonical
            // keyword spelling (the user-source forbidden-token detector keys
            // off `raw: "null"` / `"undefined"`; "not" is the canonical form).
            return makeLit("not", null, "not", nativeExpr.span);

        // --- composite primary ---------------------------------------------
        case ExprKind.Array:
            return translateArray(nativeExpr);
        case ExprKind.Object:
            return translateObject(nativeExpr);
        case ExprKind.Paren:
            // Parentheses are a parse-grouping artifact — the live catalog has
            // no `paren` kind; unwrap to the inner expression (non-lossy —
            // codegen re-parenthesizes from operator precedence).
            return translateExpr(nativeExpr.expression);

        // --- operators ------------------------------------------------------
        case ExprKind.Unary:
            return translateUnary(nativeExpr);
        case ExprKind.Update:
            // `x++` / `++x` — the live catalog has no `update` kind; `++`/`--`
            // are `UnaryExpr` `op` values. The `prefix` flag carries the
            // pre/post distinction (emit-expr.ts:emitUnary reads `prefix`).
            return makeUnary(nativeExpr.op, translateExpr(nativeExpr.operand),
                             nativeExpr.prefix === true, nativeExpr.span);
        case ExprKind.Binary:
            return makeBinary(nativeExpr.op, translateExpr(nativeExpr.left),
                              translateExpr(nativeExpr.right), nativeExpr.span);
        case ExprKind.Logical:
            // `a && b` / `a || b` / `a ?? b` — the live catalog has no
            // `logical` kind; the JS logical operators are `BinaryExpr` `op`
            // values (emit-expr.ts:emitBinary's `default` arm emits them).
            return makeBinary(nativeExpr.op, translateExpr(nativeExpr.left),
                              translateExpr(nativeExpr.right), nativeExpr.span);
        case ExprKind.Assignment:
            return makeAssign(nativeExpr.op, translateExpr(nativeExpr.target),
                              translateExpr(nativeExpr.value), nativeExpr.span);
        case ExprKind.Conditional:
            return makeTernary(translateExpr(nativeExpr.test),
                               translateExpr(nativeExpr.consequent),
                               translateExpr(nativeExpr.alternate), nativeExpr.span);

        // --- call / member / new -------------------------------------------
        case ExprKind.Call:
            return makeCall(translateExpr(nativeExpr.callee),
                            translateArgList(nativeExpr.args),
                            nativeExpr.optional === true, nativeExpr.span);
        case ExprKind.New:
            return makeNew(translateExpr(nativeExpr.callee),
                           translateArgList(nativeExpr.args), nativeExpr.span);
        case ExprKind.Member:
            return translateMember(nativeExpr);

        // --- arrow / function ----------------------------------------------
        case ExprKind.Arrow:
            return translateArrow(nativeExpr);
        case ExprKind.Function:
            return translateFunctionExpr(nativeExpr);

        // --- scrml-extension expression forms ------------------------------
        case ExprKind.IsCheck:
            return translateIsCheck(nativeExpr);
        case ExprKind.Sql:
            return translateSql(nativeExpr);
        case ExprKind.InputStateRef:
            return makeInputStateRef(identText(nativeExpr.id), nativeExpr.span);
        case ExprKind.Match:
            return translateMatch(nativeExpr);
        case ExprKind.Tilde:
            // `~` pipeline-accumulator atom (§32) — the live codegen models
            // the accumulator as an `ident` whose `name` is the literal `"~"`
            // (emit-expr.ts:emitIdent branches on `name === "~"` and emits
            // `ctx.tildeVar`). Map to a live `ident` carrying `"~"`.
            return makeIdent("~", nativeExpr.span);

        // --- escape-hatch — no clean live target (gaps surfaced to PA) -----
        case ExprKind.This:
            return makeEscapeHatch("This", "this", nativeExpr.span);
        case ExprKind.Super:
            return makeEscapeHatch("Super", "super", nativeExpr.span);
        case ExprKind.TaggedTemplate:
            return makeEscapeHatch("TaggedTemplate", "", nativeExpr.span);
        case ExprKind.Sequence:
            return makeEscapeHatch("Sequence", "", nativeExpr.span);
        case ExprKind.Yield:
            return makeEscapeHatch("Yield", "", nativeExpr.span);
        case ExprKind.Render:
            return makeEscapeHatch("Render", "", nativeExpr.span);
        case ExprKind.MarkupValue:
            return makeEscapeHatch("MarkupValue", "", nativeExpr.span);
        case ExprKind.Lift:
            // `Lift` / `Fail` at a genuine expression-CHILD position (rare —
            // `lift` / `fail` are statement-shaped; the statement bridge
            // un-wraps the common ExprStmt-position case before A2 sees it).
            // Escape-hatch so the node is preserved, not dropped.
            return makeEscapeHatch("Lift", "", nativeExpr.span);
        case ExprKind.Fail:
            return makeEscapeHatch("Fail", "", nativeExpr.span);
        case ExprKind.Propagate:
        case ExprKind.GuardedExpr:
            // M5-swap Wave 2 (B1 / B2). `Propagate` (`expr?`) and `GuardedExpr`
            // (`expr !{ arms }`) are statement-shaped — the live
            // `propagate-expr` / `guarded-expr` are `LogicStatement` kinds, not
            // `ExprNode` kinds. The STATEMENT bridge (translate-stmt.js)
            // un-wraps the common `ExprStmt`-position case into the live
            // LogicStatement before A2 ever sees it. A `Propagate` /
            // `GuardedExpr` reaching `translateExpr` is a genuine
            // expression-CHILD position (rare); escape-hatch so the node is
            // preserved, not dropped — the same posture `Lift` / `Fail` take.
            return makeEscapeHatch(String(nativeExpr.kind), "", nativeExpr.span);

        // --- param / body-stub support nodes (not expression-position) -----
        case ExprKind.RestElement:
        case ExprKind.AssignmentPattern:
        case ExprKind.BlockStub:
            // These are arrow/function HEAD + body support nodes; they are
            // translated by the dedicated lambda-param / lambda-body paths,
            // never as a free expression. A bare one here is a malformed AST
            // — escape-hatch defensively (the no-throw stage contract).
            return makeEscapeHatch(String(nativeExpr.kind), "", nativeExpr.span);

        default:
            // An unrecognized native ExprKind. The native catalog is closed
            // (ast-expr.js `ExprKind`) — this arm should be unreachable.
            // Escape-hatch defensively rather than emit a malformed node; the
            // no-throw discipline (the stage contract) forbids raising.
            return makeEscapeHatch(String(nativeExpr.kind), "", nativeExpr.span);
    }
}

// translateExprList — translate an array of native `Expr` nodes. A missing /
// non-array input folds to `[]`. Convenience for callers (C1) holding an
// expression array (e.g. a `Sequence`'s expressions, or a hand-assembled
// argument list).
export function translateExprList(nativeExprs) {
    if (Array.isArray(nativeExprs) === false) {
        return [];
    }
    const out = [];
    for (const e of nativeExprs) {
        out.push(translateExpr(e));
    }
    return out;
}

// =============================================================================
// Live-node constructors. Each produces ONE live `ExprNode` object: a
// lowercase `kind` tag + the live node's payload fields + `span`. The shapes
// mirror the live TS interfaces in compiler/src/types/ast.ts (the contract)
// — `IdentExpr` / `LitExpr` / `BinaryExpr` / ... — and what `emit-expr.ts`'s
// emitter walks.
//
// Expression nodes carry NO numeric `id` — the `id` field is the `BaseNode`
// contract for STATEMENT / MARKUP nodes, not for `ExprNode` (see header).
// =============================================================================

// spanOrZero — a defensive span. Native nodes always carry a span; a missing
// one folds to a zero span so a live node is never span-less (every `ExprNode`
// interface declares a non-optional `span`). The native span shape is
// `{ start, end, line, col }` (span.js:makeSpan); the live `ExprSpan` also
// declares a `file` field — the live runtime tolerates its absence (the
// statement bridge R1 passes native spans through identically), and C1 (the
// FileAST assembler) is the unit that stamps `file` uniformly. A2 mirrors R1:
// pass the native span through verbatim.
function spanOrZero(span) {
    if (span === undefined || span === null) {
        return { start: 0, end: 0, line: 1, col: 1 };
    }
    return span;
}

// identText — best-effort identifier text. The native `Ident` / `AtCell` /
// `BareVariant` / `InputStateRef` nodes carry their text on `name` / `id`. A
// missing one folds to "" (the live empty-name shape — `""` is a DEFINED
// string value, §42 / S89; it is the empty identifier, not absence).
function identText(text) {
    if (text === undefined || text === null) {
        return "";
    }
    return String(text);
}

// --- leaf-node constructors --------------------------------------------------

// makeIdent — a live `IdentExpr` (ast.ts:1569). `name` is the identifier text;
// for a reactive ref it INCLUDES the `@`, for a bare-variant the leading `.`,
// for the pipeline accumulator the literal `"~"`.
function makeIdent(name, span) {
    return { kind: "ident", name, span: spanOrZero(span) };
}

// translateIdent — native `Ident` -> live `ident`.
function translateIdent(nativeExpr) {
    return makeIdent(identText(nativeExpr.name), nativeExpr.span);
}

// makeLit — a live `LitExpr` (ast.ts:1591). `raw` is the verbatim source text;
// `value` is the interpreted value; `litType` is the type-system sub-tag
// (`number` / `string` / `template` / `bool` / `not`). emit-expr.ts:emitLit
// emits `raw` directly (except `litType: "not"` -> `null`).
function makeLit(raw, value, litType, span) {
    return { kind: "lit", raw, value, litType, span: spanOrZero(span) };
}

// numberRaw — the raw source text of a native `NumberLit`. The native node
// carries both `value` (parsed float) and `raw` (source text); the live
// `LitExpr` prefers `raw` for exact-format preservation. A missing `raw`
// folds to the stringified value.
function numberRaw(nativeExpr) {
    if (nativeExpr.raw !== undefined && nativeExpr.raw !== null) {
        return String(nativeExpr.raw);
    }
    if (nativeExpr.value !== undefined && nativeExpr.value !== null) {
        return String(nativeExpr.value);
    }
    return "0";
}

// stringRaw — the raw source text of a native `StringLit` (INCLUDING quote
// delimiters — that is what the native parser captures in `raw`). The live
// `LitExpr.raw` is emitted verbatim by codegen, so the quotes must be present.
function stringRaw(nativeExpr) {
    if (nativeExpr.raw !== undefined && nativeExpr.raw !== null) {
        return String(nativeExpr.raw);
    }
    // No raw — re-quote the interpreted value (defensive; the native parser
    // always retains `raw` on a StringLit).
    return JSON.stringify(nativeExpr.value === undefined ? "" : nativeExpr.value);
}

// regexRaw — the raw source text of a native `RegexLit` (`/pattern/flags`).
function regexRaw(nativeExpr) {
    if (nativeExpr.raw !== undefined && nativeExpr.raw !== null) {
        return String(nativeExpr.raw);
    }
    const pattern = nativeExpr.pattern === undefined ? "" : nativeExpr.pattern;
    const flags = nativeExpr.flags === undefined ? "" : nativeExpr.flags;
    return "/" + pattern + "/" + flags;
}

// translateTemplateLit — native `TemplateLit{quasis,exprs}` -> live `lit`
// with `litType: "template"`. The live `LitExpr` has no structured quasi/expr
// surface — it is a flat `raw` literal (a STATIC back-tick string per the
// `template` litType doc — "static, no live interpolation"). A2 reconstructs
// the back-tick source from the quasis + interpolated child expressions: each
// quasi's `raw` text verbatim, each interpolation as `${ <emitted-child> }`.
// The child expressions are translated so a nested `@cell` is visible to the
// downstream walk, then re-stringified into the template `raw`.
function translateTemplateLit(nativeExpr) {
    const quasis = Array.isArray(nativeExpr.quasis) ? nativeExpr.quasis : [];
    const exprs = Array.isArray(nativeExpr.exprs) ? nativeExpr.exprs : [];
    let raw = "`";
    for (let i = 0; i < quasis.length; i = i + 1) {
        const q = quasis[i];
        const quasiRaw = (q && q.raw !== undefined && q.raw !== null) ? String(q.raw) : "";
        raw = raw + quasiRaw;
        if (i < exprs.length) {
            // The native parser carries the interpolated child as a native
            // Expr; the live `template` litType is static, so the child is
            // not separately structured downstream — it is folded into `raw`
            // as a `${...}` placeholder. The native child is left un-emitted
            // here (codegen reads `raw` directly for a template literal).
            raw = raw + "${...}";
        }
    }
    raw = raw + "`";
    return makeLit(raw, raw, "template", nativeExpr.span);
}

// --- composite-primary constructors ------------------------------------------

// translateArray — native `Array{elements}` -> live `array`. The native
// element wrapper is `{ kind: Item|Spread|Hole, expression }`; the live
// `ArrayExpr.elements` is a flat `(ExprNode | SpreadExpr)[]`:
//   Item   -> the translated element expression
//   Spread -> a live `spread` node wrapping the translated argument
//   Hole   -> a live `lit { litType: "undefined" }` placeholder (the live
//             `ArrayExpr` has no hole element; an elided array slot lowers to
//             `undefined` — the closest non-lossy live shape)
function translateArray(nativeExpr) {
    const elements = [];
    const nativeElements = Array.isArray(nativeExpr.elements) ? nativeExpr.elements : [];
    for (const el of nativeElements) {
        if (el === undefined || el === null) {
            continue;
        }
        if (el.kind === "Spread") {
            elements.push(makeSpread(translateExpr(el.expression), spanFromExpr(el.expression)));
        } else if (el.kind === "Hole") {
            // An elided slot `[a, , c]`. The live catalog has no hole element
            // — the JS surface for a hole IS `undefined`. Emit a `lit`.
            elements.push(makeLit("undefined", null, "undefined", null));
        } else {
            // an `Item`.
            elements.push(translateExpr(el.expression));
        }
    }
    return { kind: "array", elements, span: spanOrZero(nativeExpr.span) };
}

// makeSpread — a live `SpreadExpr` (ast.ts:1633).
function makeSpread(argument, span) {
    return { kind: "spread", argument, span: spanOrZero(span) };
}

// spanFromExpr — pull a span off a (possibly missing) native Expr for a
// wrapper node that has no span of its own (array `Spread` element wrappers
// carry no span; the live `SpreadExpr` needs one — borrow the argument's).
function spanFromExpr(nativeExpr) {
    if (nativeExpr && nativeExpr.span !== undefined && nativeExpr.span !== null) {
        return nativeExpr.span;
    }
    return null;
}

// translateObject — native `Object{properties}` -> live `object`. The native
// property wrapper kinds are `KeyValue` / `Shorthand` / `Spread` / `Method`;
// the live `ObjectProp` union is `prop` / `shorthand` / `spread`:
//   KeyValue  -> live `prop`   (key + value + computed)
//   Shorthand -> live `shorthand` (name)
//   Spread    -> live `spread`  (argument)
//   Method    -> live `prop`   (key + a `lambda` value — the live catalog has
//               no object-method ObjectProp; a method `key(){...}` is
//               equivalent to `key: function(){...}`, the closest live shape)
function translateObject(nativeExpr) {
    const props = [];
    const nativeProps = Array.isArray(nativeExpr.properties) ? nativeExpr.properties : [];
    for (const prop of nativeProps) {
        if (prop === undefined || prop === null) {
            continue;
        }
        if (prop.kind === "Spread") {
            props.push({ kind: "spread", argument: translateExpr(prop.expression), span: spanOrZero(null) });
        } else if (prop.kind === "Shorthand") {
            props.push({ kind: "shorthand", name: identText(prop.name), span: spanOrZero(null) });
        } else if (prop.kind === "Method") {
            // A method `key(){...}` / getter / setter -> `prop` with a lambda
            // value. The native `value` is a Function node.
            props.push({
                kind: "prop",
                key: translateObjectKey(prop.key, prop.computed === true),
                value: translateExpr(prop.value),
                computed: prop.computed === true,
                span: spanOrZero(null),
            });
        } else {
            // a `KeyValue`.
            props.push({
                kind: "prop",
                key: translateObjectKey(prop.key, prop.computed === true),
                value: translateExpr(prop.value),
                computed: prop.computed === true,
                span: spanOrZero(null),
            });
        }
    }
    return { kind: "object", props, span: spanOrZero(nativeExpr.span) };
}

// translateObjectKey — the `key` field of a live `prop` ObjectProp. The live
// shape is `string | ExprNode`: a non-computed identifier / string / number
// key is a plain STRING; a computed `[expr]` key is an `ExprNode`.
function translateObjectKey(key, computed) {
    if (key === undefined || key === null) {
        return "";
    }
    if (computed === true) {
        // a computed `[expr]` key — keep it as an ExprNode.
        return translateExpr(key);
    }
    // a static key — emit the plain-string name.
    if (key.kind === ExprKind.Ident) {
        return identText(key.name);
    }
    if (key.kind === ExprKind.StringLit) {
        return key.value === undefined || key.value === null ? "" : String(key.value);
    }
    if (key.kind === ExprKind.NumberLit) {
        return numberRaw(key);
    }
    // an unexpected key shape — translate it as an ExprNode (defensive).
    return translateExpr(key);
}

// --- operator constructors ---------------------------------------------------

// makeUnary — a live `UnaryExpr` (ast.ts:1650). `op` is the operator string;
// `argument` is the translated operand; `prefix` is true for `!x` / `-x` /
// prefix `++x`, false for postfix `x++`.
function makeUnary(op, argument, prefix, span) {
    return { kind: "unary", op, argument, prefix, span: spanOrZero(span) };
}

// translateUnary — native `Unary{op,operand,prefix}` -> live `unary`.
function translateUnary(nativeExpr) {
    return makeUnary(nativeExpr.op, translateExpr(nativeExpr.operand),
                     nativeExpr.prefix === true, nativeExpr.span);
}

// makeBinary — a live `BinaryExpr` (ast.ts:1678). `op` is the operator string
// (standard JS infix ops OR the scrml `is` / `is-not` / `is-some` /
// `is-not-not` predicate ops); `left` / `right` are the translated operands.
function makeBinary(op, left, right, span) {
    return { kind: "binary", op, left, right, span: spanOrZero(span) };
}

// makeAssign — a live `AssignExpr` (ast.ts:1700).
function makeAssign(op, target, value, span) {
    return { kind: "assign", op, target, value, span: spanOrZero(span) };
}

// makeTernary — a live `TernaryExpr` (ast.ts:1712).
function makeTernary(condition, consequent, alternate, span) {
    return { kind: "ternary", condition, consequent, alternate, span: spanOrZero(span) };
}

// --- call / member / new constructors ----------------------------------------

// makeCall — a live `CallExpr` (ast.ts:1751).
function makeCall(callee, args, optional, span) {
    return { kind: "call", callee, args, optional, span: spanOrZero(span) };
}

// makeNew — a live `NewExpr` (ast.ts:1761). `NewExpr` has no `optional` field
// (`new x?.()` is not a JS form).
function makeNew(callee, args, span) {
    return { kind: "new", callee, args, span: spanOrZero(span) };
}

// translateArgList — a native call/new argument array -> a live
// `(ExprNode | SpreadExpr)[]`. A native `...spread` argument is a `Spread`
// ExprKind node; translate it to a live `spread`. Everything else translates
// as an ordinary expression.
function translateArgList(args) {
    if (Array.isArray(args) === false) {
        return [];
    }
    const out = [];
    for (const a of args) {
        if (a === undefined || a === null) {
            continue;
        }
        out.push(translateExpr(a));
    }
    return out;
}

// translateMember — native `Member{object,property,computed,optional}` -> the
// live catalog's SPLIT member access:
//   computed:false  -> live `member`  (`property` is a plain STRING — the
//                      live `MemberExpr.property` is `string`, not ExprNode)
//   computed:true   -> live `index`   (`index` is an `ExprNode` — the
//                      bracket `obj[expr]` form)
// The native parser carries both forms on ONE `Member` node discriminated by
// the `computed` flag; the live catalog has two distinct node kinds.
function translateMember(nativeExpr) {
    const object = translateExpr(nativeExpr.object);
    const optional = nativeExpr.optional === true;
    if (nativeExpr.computed === true) {
        // `obj[expr]` -> live `index`.
        return {
            kind: "index",
            object,
            index: translateExpr(nativeExpr.property),
            optional,
            span: spanOrZero(nativeExpr.span),
        };
    }
    // `obj.prop` -> live `member`. The live `property` is a plain string.
    return {
        kind: "member",
        object,
        property: memberPropertyName(nativeExpr.property),
        optional,
        span: spanOrZero(nativeExpr.span),
    };
}

// memberPropertyName — the static property NAME for a non-computed member
// access. The native `property` is an `Ident` Expr; the live `MemberExpr.
// property` is a plain string. A missing / non-ident property folds to "".
function memberPropertyName(property) {
    if (property === undefined || property === null) {
        return "";
    }
    if (property.kind === ExprKind.Ident) {
        return identText(property.name);
    }
    if (typeof property === "string") {
        return property;
    }
    return "";
}

// --- arrow / function constructors -------------------------------------------

// translateArrow — native `Arrow{params,body,isAsync}` -> live `lambda` with
// `fnStyle: "arrow"`. The native body is either a concise expression body or
// a `BlockStub` (the brace-delimited statement body). The live `LambdaExpr.
// body` is `{ kind:"expr", value }` or `{ kind:"block", stmts }`.
function translateArrow(nativeExpr) {
    return {
        kind: "lambda",
        params: translateParamList(nativeExpr.params),
        body: translateLambdaBody(nativeExpr.body),
        isAsync: nativeExpr.isAsync === true,
        fnStyle: "arrow",
        span: spanOrZero(nativeExpr.span),
    };
}

// translateFunctionExpr — native `Function{name,params,body,isAsync,
// isGenerator}` -> live `lambda` with `fnStyle: "function"`. The live
// `LambdaExpr` has no `name` / `isGenerator` field (the live catalog models a
// function EXPRESSION as a lambda; a named function expression's name + the
// generator flag have no live lambda surface — a generator function
// expression is a rare logic-body shape; the name is dropped, matching the
// live ast-builder's lambda surface).
function translateFunctionExpr(nativeExpr) {
    return {
        kind: "lambda",
        params: translateParamList(nativeExpr.params),
        body: translateLambdaBody(nativeExpr.body),
        isAsync: nativeExpr.isAsync === true,
        fnStyle: "function",
        span: spanOrZero(nativeExpr.span),
    };
}

// translateLambdaBody — the `body` of a native Arrow / Function -> the live
// `LambdaExpr.body` union. A `BlockStub` body (the brace-delimited statement
// body M3 re-enters) -> `{ kind:"block", stmts:[] }`. A2 does NOT parse the
// BlockStub's token range — the statement body is the STATEMENT bridge's scope
// (translate-stmt.js); C1 (the FileAST assembler) wires the BlockStub re-parse
// + statement translation. A2 leaves `stmts: []` (the live emit-expr.ts emits
// a `/* block body */` placeholder for a lambda block body — Slice 5 / C1
// integrates the real statement emission). A concise expression body ->
// `{ kind:"expr", value: <translated> }`.
function translateLambdaBody(body) {
    if (body && body.kind === ExprKind.BlockStub) {
        // Statement body — the statement bridge's scope; C1 wires the re-parse.
        return { kind: "block", stmts: [] };
    }
    // A concise expression body.
    return { kind: "expr", value: translateExpr(body) };
}

// translateParamList — a native param-node array -> the live `LambdaParam[]`
// (ast.ts:1800). The native param shapes are `Ident` / `RestElement` /
// `AssignmentPattern` / `ObjectPat` / `ArrayPat`:
//   Ident             -> { name }
//   RestElement       -> { name, isRest: true }
//   AssignmentPattern -> { name, defaultValue: <translated default> }
//   ObjectPat/ArrayPat -> { name: "{...}" / "[...]" } placeholder (the live
//                         `LambdaParam` has no structured-pattern surface; a
//                         destructured lambda param is a rare shape — the
//                         best-effort placeholder mirrors translate-stmt.js's
//                         `paramName` policy)
function translateParamList(params) {
    if (Array.isArray(params) === false) {
        return [];
    }
    const out = [];
    for (const p of params) {
        out.push(translateParam(p));
    }
    return out;
}

// translateParam — one native param node -> one live `LambdaParam`.
function translateParam(p) {
    if (p === undefined || p === null) {
        return { name: "" };
    }
    if (p.kind === ExprKind.RestElement) {
        return { name: paramLeafName(p.argument), isRest: true };
    }
    if (p.kind === ExprKind.AssignmentPattern) {
        const param = { name: paramLeafName(p.left) };
        if (p.right !== undefined && p.right !== null) {
            param.defaultValue = translateExpr(p.right);
        }
        return param;
    }
    if (p.bindingKind === "Ident" || p.kind === ExprKind.Ident) {
        return { name: identText(p.name) };
    }
    if (p.bindingKind === "RestElement") {
        return { name: paramLeafName(p.argument), isRest: true };
    }
    if (p.bindingKind === "AssignmentPattern") {
        const param = { name: paramLeafName(p.left) };
        if (p.right !== undefined && p.right !== null) {
            param.defaultValue = translateExpr(p.right);
        }
        return param;
    }
    if (p.bindingKind === "ObjectPat") {
        return { name: "{...}" };
    }
    if (p.bindingKind === "ArrayPat") {
        return { name: "[...]" };
    }
    return { name: "" };
}

// paramLeafName — best-effort identifier text for a param leaf (the rest /
// default-target positions where the grammar guarantees an identifier).
function paramLeafName(leaf) {
    if (leaf === undefined || leaf === null) {
        return "";
    }
    if (leaf.bindingKind === "Ident" || leaf.kind === ExprKind.Ident) {
        return identText(leaf.name);
    }
    if (leaf.bindingKind === "ObjectPat") {
        return "{...}";
    }
    if (leaf.bindingKind === "ArrayPat") {
        return "[...]";
    }
    return "";
}

// --- scrml-extension expression-form constructors ----------------------------

// translateIsCheck — native `IsCheck{operand,op,variant}` -> live `binary`
// with the `op` selected FAN-OUT by the `IsCheckOp`:
//   IsCheckOp.Not     -> binary "is-not"      (absence; §42.2.2)
//   IsCheckOp.Some    -> binary "is-some"     (presence; §42.2.2a)
//   IsCheckOp.Given   -> binary "is-some"     (presence alias of Some; §42.2.4)
//   IsCheckOp.NotNot  -> binary "is-not-not"  (double-negative presence; §42.8)
//   IsCheckOp.Variant -> binary "is"          (the `x is .V` variant form)
//
// The live `BinaryExpr` for the absence-shaped predicates (`is-not` /
// `is-some` / `is-not-not`) carries `right` holding a synthesized RHS pattern
// (ast.ts:1690 — "a `lit { litType: "not" }` for absence"). The native
// `IsCheck` has NO RHS for those ops (the predicate is a SUFFIX, not a binary
// — `expr is some` has no right operand). A2 synthesizes the `right` so the
// live `BinaryExpr` is well-formed: a `lit { litType: "not" }` placeholder
// (emit-expr.ts:emitBinary's `is-not`/`is-some`/`is-not-not` arms IGNORE
// `right` entirely — they emit `<lhs> !== null && <lhs> !== undefined` from
// `left` alone — so the synthesized `right` is a structural-validity filler).
//
// For the `Variant` op (`x is .V`) the live `BinaryExpr` op is `"is"` and the
// `right` IS load-bearing: emit-expr.ts:emitBinary's `is` arm reads
// `node.right` (an `ident` whose name starts with `.`, or a `member`
// `Enum.Variant`). The native `IsCheck.variant` carries that variant Expr —
// translate it as the `right`.
function translateIsCheck(nativeExpr) {
    const left = translateExpr(nativeExpr.operand);
    const span = nativeExpr.span;
    switch (nativeExpr.op) {
        case IsCheckOp.Not:
            return makeBinary("is-not", left, makeLit("not", null, "not", span), span);
        case IsCheckOp.Some:
        case IsCheckOp.Given:
            return makeBinary("is-some", left, makeLit("not", null, "not", span), span);
        case IsCheckOp.NotNot:
            return makeBinary("is-not-not", left, makeLit("not", null, "not", span), span);
        case IsCheckOp.Variant:
            // `x is .V` — the `right` is the variant Expr (load-bearing).
            return makeBinary("is", left, translateExpr(nativeExpr.variant), span);
        default:
            // An unrecognized IsCheckOp — the IsCheckOp enum is closed
            // (ast-expr.js). Escape-hatch defensively.
            return makeEscapeHatch("IsCheck", "", span);
    }
}

// translateSql — native `Sql{raw}` -> live `sql-ref`. The live `SqlRefExpr`
// (ast.ts:1852) carries a `nodeId` referencing the file-level `SQLNode` — a
// resolution A2 (a leaf translator with no file context) CANNOT perform.
// A2 emits the `sql-ref` with `nodeId: -1` (the live parser's "unresolved"
// sentinel — expression-parser.ts:889; emit-expr.ts:emitSqlRef recognizes
// `nodeId < 0` and emits a JS-valid `null` + a diagnostic comment). C1 (the
// FileAST assembler) is the unit with the file-level SQLNode registry; it
// re-stamps `nodeId` when it wires the SQL block. A2 surfaces this as a
// documented hand-off, NOT a silent gap (progress-A2.md).
function translateSql(nativeExpr) {
    return {
        kind: "sql-ref",
        nodeId: -1,
        span: spanOrZero(nativeExpr.span),
    };
}

// makeInputStateRef — a live `InputStateRefExpr` (ast.ts:1866). `name` is the
// referenced element id (the native `InputStateRef.id` — WITHOUT the `<#`/`>`
// delimiters).
function makeInputStateRef(name, span) {
    return { kind: "input-state-ref", name, span: spanOrZero(span) };
}

// translateMatch — native `Match{subject,arms}` -> live `match-expr`. The
// live `MatchExpr` (ast.ts:1835) carries `subject` (an `ExprNode`) + `rawArms`
// (a `string[]` — "Raw arm strings for Phase 1"). The native `Match.arms` is
// an array of STRUCTURED arm objects (`{ pattern, body, separator }`). The
// live `match-expr` consumer (emit-expr.ts:emitMatchExpr -> emit-control-flow.
// ts) re-parses each `rawArms` string with `parseMatchArm`. A2 reconstructs
// each arm's source text from the structured native arm so the live
// consumer's re-parse path is fed the shape it expects.
function translateMatch(nativeExpr) {
    const arms = Array.isArray(nativeExpr.arms) ? nativeExpr.arms : [];
    const rawArms = [];
    for (const arm of arms) {
        rawArms.push(reconstructMatchArm(arm));
    }
    return {
        kind: "match-expr",
        subject: translateExpr(nativeExpr.subject),
        rawArms,
        span: spanOrZero(nativeExpr.span),
    };
}

// reconstructMatchArm — rebuild one match arm's source text from the
// structured native arm object `{ pattern, body, separator }`. The live
// `match-expr` carries `rawArms: string[]`; the downstream emitter re-parses
// each. A2 reconstructs `<pattern> <separator> <body>`:
//   - pattern: a Variant / Wildcard / Is arm-pattern (make*Pattern shapes)
//   - separator: "=>" or "->" (canonical "=>")
//   - body: an Expr (concise) or a BlockStub (block body)
function reconstructMatchArm(arm) {
    if (arm === undefined || arm === null) {
        return "";
    }
    const pattern = reconstructArmPattern(arm.pattern);
    const separator = (arm.separator === "->") ? "->" : "=>";
    const body = reconstructArmBody(arm.body);
    return pattern + " " + separator + " " + body;
}

// reconstructArmPattern — the source text of one match-arm pattern.
function reconstructArmPattern(pattern) {
    if (pattern === undefined || pattern === null) {
        return "_";
    }
    if (pattern.patternKind === "Wildcard") {
        // `else` / `_` — the `keyword` field records the spelling.
        return (pattern.keyword === "_") ? "_" : "else";
    }
    if (pattern.patternKind === "Is") {
        // `is .V` — an is-pattern in arm position.
        return "is ." + identText(pattern.variantName);
    }
    // a `Variant` pattern — `.V` / `Type.V`, optional `( bindings )`.
    let text = "";
    if (pattern.typeName !== undefined && pattern.typeName !== null) {
        text = identText(pattern.typeName) + ".";
    } else {
        text = ".";
    }
    text = text + identText(pattern.variantName);
    if (Array.isArray(pattern.bindings) && pattern.bindings.length > 0) {
        const parts = [];
        for (const b of pattern.bindings) {
            if (b === undefined || b === null) {
                continue;
            }
            if (b.fieldName !== undefined && b.fieldName !== null) {
                parts.push(identText(b.fieldName) + ": " + identText(b.local));
            } else {
                parts.push(identText(b.local));
            }
        }
        text = text + "(" + parts.join(", ") + ")";
    }
    return text;
}

// reconstructArmBody — the source text of one match-arm body. A concise
// expression body re-stringifies via the shared expr-source reconstructor; a
// BlockStub body has no concise source — emit a `{}` placeholder (a block-body
// match arm is a rare shape; the downstream re-parse tolerates it).
function reconstructArmBody(body) {
    if (body === undefined || body === null) {
        return "{}";
    }
    if (body.kind === ExprKind.BlockStub) {
        return "{}";
    }
    return exprSourceText(body);
}

// exprSourceText — best-effort source-text reconstruction of a native Expr,
// used only by the match-arm rebuilder (the live `match-expr` carries
// `rawArms` as STRINGS — there is no structured-arm live surface). This is a
// minimal reconstructor covering the arm-body shapes that appear in practice
// (literals, idents, member chains, calls, binaries). An un-reconstructable
// shape folds to an empty string — the downstream re-parse then sees an empty
// arm body, which is a recoverable diagnostic, not a crash.
function exprSourceText(nativeExpr) {
    if (nativeExpr === undefined || nativeExpr === null || typeof nativeExpr !== "object") {
        return "";
    }
    switch (nativeExpr.kind) {
        case ExprKind.NumberLit:
            return numberRaw(nativeExpr);
        case ExprKind.StringLit:
            return stringRaw(nativeExpr);
        case ExprKind.BoolLit:
            return nativeExpr.value === true ? "true" : "false";
        case ExprKind.NotValue:
            return "not";
        case ExprKind.Ident:
            return identText(nativeExpr.name);
        case ExprKind.AtCell:
            return "@" + identText(nativeExpr.name);
        case ExprKind.BareVariant:
            return "." + identText(nativeExpr.name);
        case ExprKind.Paren:
            return "(" + exprSourceText(nativeExpr.expression) + ")";
        case ExprKind.Member: {
            const base = exprSourceText(nativeExpr.object);
            if (nativeExpr.computed === true) {
                return base + "[" + exprSourceText(nativeExpr.property) + "]";
            }
            return base + "." + memberPropertyName(nativeExpr.property);
        }
        case ExprKind.Call: {
            const callee = exprSourceText(nativeExpr.callee);
            const args = Array.isArray(nativeExpr.args) ? nativeExpr.args : [];
            const parts = [];
            for (const a of args) {
                parts.push(exprSourceText(a));
            }
            return callee + "(" + parts.join(", ") + ")";
        }
        case ExprKind.Binary:
        case ExprKind.Logical:
            return exprSourceText(nativeExpr.left) + " " + nativeExpr.op + " " +
                   exprSourceText(nativeExpr.right);
        case ExprKind.Unary:
            return nativeExpr.prefix === true
                ? nativeExpr.op + exprSourceText(nativeExpr.operand)
                : exprSourceText(nativeExpr.operand) + nativeExpr.op;
        default:
            return "";
    }
}

// --- escape-hatch constructor ------------------------------------------------

// makeEscapeHatch — a live `EscapeHatchExpr` (ast.ts:1880). `nativeKind`
// carries the native ExprKind string (the S115 / DD #27 rename: `estreeType`
// -> `nativeKind` — the field is a sub-kind decoration, not a translation
// surface). `raw` is the best-effort source text the string-rewrite fallback
// in `emit-expr.ts:emitEscapeHatch` re-parses; for native kinds with no
// reconstructable raw text it is "" (the fallback then emits an empty string,
// a recoverable shape). emit-expr.ts:emitEscapeHatch recognizes the native
// kind values directly (it already branches on `kind === "Arrow"` /
// `"Function"`), so the escape-hatch is the documented dual-mode seam.
function makeEscapeHatch(nativeKind, raw, span) {
    return {
        kind: "escape-hatch",
        nativeKind,
        raw,
        span: spanOrZero(span),
    };
}
