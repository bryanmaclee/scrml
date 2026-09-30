// body-top-coverage.js — what a body-top statement COMPILES (S441 round 5).
//
// SPEC §40.8 S441 bullet, "Coverage invariant": every non-whitespace,
// non-comment byte of a `<program>` / `<page>` / `<channel>` body-top run ends
// up in exactly one of (a) a statement the compiler compiles, or (b) an error
// diagnostic. Round 4 measured (a) as "the tokens a statement's parse
// consumed". That credited a statement for tokens it never compiled — an
// `import` whose regex read `{ a } from "./a.js"` and ignored the `-` and the
// swallowed next line after it; a `type` alias whose resolver silently reads
// `number zqxone` as an unknown type; a bare `404` that compiles to a
// statement with no effect (ruling S443 item 4: "a node covers only tokens it
// compiles").
//
// This module is the ONE definition both front ends use for (a). It answers,
// for one statement, which prefix of the tokens it consumed it compiles:
//
//   - ALL of them (the ordinary case — a structurally parsed statement), or
//   - a PREFIX: the statement's own grammar ends before the tokens it consumed
//     do (the rest is not part of it: reported, or re-parsed as the next
//     statement), or
//   - NOTHING: the statement's grammar is not satisfied (`import stuff`,
//     `type here`, `fn heading`), or it computes nothing observable (a bare
//     literal statement, `404`; a label on a statement that is not a loop).
//
// It is not a prose recognizer: it never looks at what the text "looks like";
// it asks each statement's grammar where the statement ends and whether it
// does anything. The front ends turn "prefix" and "nothing" into the ordinary
// body-top diagnostics (E-UNQUOTED-DISPLAY-TEXT for the uncompiled run), and
// their coverage checks credit only the compiled part — so a statement kind
// this module has not been taught about fails CLOSED (E-INTERNAL-BODY-TOP-
// DROPPED), never open.
//
// Pure: no imports, no mutation. Tokens are passed as their source TEXTS (both
// front ends' tokens carry `.text`); the classification below reads only the
// first character, so the two tokenizers' kind catalogs never matter.

const isNameText = (t) => typeof t === "string" && /^[A-Za-z_$@]/.test(t);
const isStringText = (t) => typeof t === "string" && /^["'`]/.test(t);
const isNumberText = (t) => typeof t === "string" && /^(?:[0-9]|\.[0-9])/.test(t);
// A Map, not an object literal: a token text such as `toString` or `constructor`
// must not read an inherited Object.prototype member as an opener.
const OPENERS = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);

// skipBalanced — index just past the group that opens at `i` (texts[i] is an
// opener), or -1 when it never closes inside `texts`.
function skipBalanced(texts, i) {
    const stack = [];
    for (let k = i; k < texts.length; k++) {
        const t = texts[k];
        if (OPENERS.has(t)) stack.push(OPENERS.get(t));
        else if (t === ")" || t === "]" || t === "}") {
            if (stack.length === 0 || stack[stack.length - 1] !== t) return -1;
            stack.pop();
            if (stack.length === 0) return k + 1;
        }
    }
    return -1;
}

// typeExprExtent — how many of `texts` form ONE type expression (SPEC §7.5
// `type-expr` and the forms §14 / §53 / §59 / §14.12 add to it: a name or
// dotted name, a `.Variant` member, a string / number literal member, a bracketed / braced /
// parenthesised group, a postfix `[]` / `[label]` / `(predicate)` / `?` /
// `@ordered`, joined by `|` / `&` / `&&` / `to` / `->` / `=>`, the `oneOf` /
// `notIn` refinements (§53.15), and the `lin` / `!` / `-` prefixes). The type
// grammar has no juxtaposition: after a complete operand, anything that is not
// one of those continuations ends the type. 0 = no type expression at all.
export function typeExprExtent(texts) {
    const n = Array.isArray(texts) ? texts.length : 0;
    let i = 0;
    let accepted = 0;
    let expectOperand = true;
    while (i < n) {
        const t = texts[i];
        if (expectOperand) {
            if (t === "lin" || t === "!" || t === "-") { i++; continue; }
            if (OPENERS.has(t)) {
                const e = skipBalanced(texts, i);
                if (e < 0) break;
                i = e;
            } else if (isNameText(t) || isStringText(t) || isNumberText(t)) {
                i++;
            } else if (t === "." && isNameText(texts[i + 1])) {
                i += 2;   // a variant member, `.Todo | .Done` (§14.4)
            } else {
                break;
            }
            expectOperand = false;
            accepted = i;
            continue;
        }
        // After a complete operand.
        if (t === "(" || t === "[") {
            const e = skipBalanced(texts, i);
            if (e < 0) break;
            i = e;
            accepted = i;
            continue;
        }
        if (t === "?" || t === "@ordered") { i++; accepted = i; continue; }
        if (t === "@" && texts[i + 1] === "ordered") { i += 2; accepted = i; continue; }
        if (t === "." && isNameText(texts[i + 1])) { i += 2; accepted = i; continue; }
        if (t === "|" || t === "&" || t === "&&" || t === "||" || t === "to" || t === "->" || t === "=>"
                || t === "oneOf" || t === "notIn") {
            i++;
            expectOperand = true;
            continue;
        }
        if (t === "-" && texts[i + 1] === ">") { i += 2; expectOperand = true; continue; }
        if (t === "=" && texts[i + 1] === ">") { i += 2; expectOperand = true; continue; }
        break;
    }
    return accepted;
}

// braceBodyEnd — index just past the `{ … }` body that is the first `{` at
// bracket depth 0 at or after `from`, or -1. (The fallback for a function head
// functionDeclExtent could not read.)
function braceBodyEnd(texts, from) {
    let i = from;
    while (i < texts.length) {
        const t = texts[i];
        if (t === "{") {
            const e = skipBalanced(texts, i);
            return e < 0 ? texts.length : e;
        }
        if (t === "(" || t === "[") {
            const e = skipBalanced(texts, i);
            if (e < 0) return -1;
            i = e;
            continue;
        }
        i++;
    }
    return -1;
}

// functionHeadEnd — index just past a function HEAD: `modifier* (function|fn)
// '*'? name '(' params ')' return-part? modifier-call*` (§48). The return
// part — `-> T`, `: T`, `!`, `! -> E` — is a TYPE, read with the type grammar
// (typeExprExtent), so a braced return type (`-> { a: number }`) is not taken
// for the body (S441 round 5b). -1 when there is no parameter list.
function functionHeadEnd(texts) {
    let i = texts.indexOf("(");
    if (i < 0) return -1;
    i = skipBalanced(texts, i);
    if (i < 0) return -1;
    for (let guard = 0; guard < 8 && i < texts.length; guard++) {
        const t = texts[i];
        if (t === "!") {
            i++;
            // The failable marker's error type: `! -> E` (arrow, below) or the
            // arrow-less `! E` (§19.3).
            if (isNameText(texts[i])) i += typeExprExtent(texts.slice(i));
            continue;
        }
        let arrow = 0;
        if (t === "->" || t === ":" || t === "=>") arrow = 1;
        else if ((t === "-" || t === "=") && texts[i + 1] === ">") arrow = 2;
        if (arrow > 0) {
            const ext = typeExprExtent(texts.slice(i + arrow));
            if (ext === 0) break;
            i = i + arrow + ext;
            continue;
        }
        // `.idempotent()`-style modifier calls between the head and the body.
        if (t === "." && isNameText(texts[i + 1]) && texts[i + 2] === "(") {
            const e = skipBalanced(texts, i + 2);
            if (e < 0) break;
            i = e;
            continue;
        }
        break;
    }
    return i;
}

// functionDeclExtent — a function head then its `{ … }` body. Returns the
// accepted token count, or -1 when there is no `{ … }` body at all
// (`fn heading`). (A body that opens but does not close inside `texts` — the
// caller passed only the head's line — still IS a body.) Tokens between the
// head's end and the body are NOT part of the function; functionHeadGap
// reports them (round 5c).
function functionDeclExtent(texts) {
    const h = functionHeadEnd(texts);
    if (h < 0) return -1;
    if (texts[h] === "{") {
        const e = skipBalanced(texts, h);
        return e < 0 ? texts.length : e;
    }
    return braceBodyEnd(texts, h);
}

// functionHeadGap — [from, to) token indices between the end of a function
// head and its body's `{` — tokens that belong to no production of the
// function (`-> number oops junk {`) — or null when the body follows the head
// directly, or there is no body.
export function functionHeadGap(texts) {
    const h = functionHeadEnd(texts);
    if (h < 0 || h >= texts.length || texts[h] === "{") return null;
    let j = h;
    while (j < texts.length && texts[j] !== "{") j++;
    if (j >= texts.length) return null;
    return [h, j];
}

// sourceStringEnd — index just past the module-specifier string that follows
// the first `from` at or after `from`, or -1.
function sourceStringEnd(texts, from) {
    for (let i = from; i < texts.length; i++) {
        if (texts[i] === "from" && isStringText(texts[i + 1])) return i + 2;
    }
    return -1;
}

// typeDeclExtent — `type Name (':' kind)? ('=')? ( '{' … '}' | type-expr )?`
// (and the §14.3.1 kind-first order). `texts[0]` is `type`. Returns the
// accepted token count, or 0 when the declaration is not a declaration: no
// name, or neither a kind nor a body (`type here`).
export function typeDeclExtent(texts) {
    let i = 1;
    let kind = false;
    if (texts[i] === ":") {
        i++;
        if (!isNameText(texts[i])) return 0;
        i++;
        kind = true;
    }
    if (!isNameText(texts[i])) return 0;
    i++;
    if (!kind && texts[i] === ":") {
        i++;
        if (!isNameText(texts[i])) return 0;
        i++;
        kind = true;
    }
    if (texts[i] === "=") {
        i++;
        // One type grammar for every right-hand side: a braced struct / enum
        // body is an operand like any other, so `{ a: number }[]` and
        // `{ … } | { … }` read whole (S441 round 5b).
        const ext = typeExprExtent(texts.slice(i));
        return ext === 0 ? 0 : i + ext;
    }
    if (texts[i] === "{") {
        const e = skipBalanced(texts, i);
        return e < 0 ? texts.length : e;
    }
    // `type Name : kind` with no body is the forward-declared form (§14);
    // `type Name` with neither is not a declaration.
    return kind ? i : 0;
}

// declExtent — the accepted token count of an import / export / type /
// function declaration whose consumed tokens are `texts` (texts[0] is the
// declaration keyword, after any `export` has been stripped by the caller).
//   kind: "import" | "type" | "function" | "re-export" | "whole"
// Returns { count } (count === texts.length means "all") or { nothing: true }.
export function declExtent(kind, texts) {
    const n = texts.length;
    let count;
    if (kind === "import" || kind === "re-export") {
        count = sourceStringEnd(texts, 1);
        if (count < 0) return { nothing: true };
    } else if (kind === "type") {
        count = typeDeclExtent(texts);
        if (count === 0) return { nothing: true };
    } else if (kind === "function") {
        count = functionDeclExtent(texts);
        if (count < 0) return { nothing: true };
        const gap = functionHeadGap(texts);
        if (gap) return { count: Math.min(count, n), gap };
    } else {
        count = n;
    }
    return { count: Math.min(count, n) };
}

// ---------------------------------------------------------------------------
// "Computes nothing observable" — a body-top expression statement built only
// from literals and pure operators (ruling S443 item 4: bare `404`). Anything
// that names something (an identifier, a cell, a call, a member access, an
// assignment) is left alone: §40.8 evaluates a bare expression statement, and
// a read may be the author's intent. A `"..."` standing as its own statement
// never reaches here — it is a declared display-text literal.
// ---------------------------------------------------------------------------

const INERT_UNARY_OPS = new Set(["!", "-", "+", "~", "typeof", "void"]);

// liveExprIsInert — for a live-pipeline ExprNode (compiler/src/types/ast.ts).
export function liveExprIsInert(node) {
    if (!node || typeof node !== "object") return false;
    switch (node.kind) {
        case "lit":
            return !(node.litType === "template" && node.hasInterpolation !== false);
        case "unary":
            return node.prefix !== false && INERT_UNARY_OPS.has(node.op) && liveExprIsInert(node.argument);
        case "binary":
            return liveExprIsInert(node.left) && liveExprIsInert(node.right);
        case "ternary":
            return liveExprIsInert(node.condition) && liveExprIsInert(node.consequent) && liveExprIsInert(node.alternate);
        case "array":
            return Array.isArray(node.elements) && node.elements.every((e) => e && e.kind !== "spread" && liveExprIsInert(e));
        case "object":
            return Array.isArray(node.props) && node.props.every((p) =>
                p && p.kind === "prop" && p.computed !== true && liveExprIsInert(p.value));
        default:
            return false;
    }
}

// liveStmtCompilesNothing — a LIVE-shape statement (the ast-builder's output,
// or the native bridge's translation of a native statement) that compiles
// nothing: a bare expression that computes nothing observable; an import with
// no module source; an export of nothing the export grammar recognises (no
// kind, no name — `export data`, `export default …`); a `type` with neither a
// kind nor a body. Both front ends judge the statement they will actually hand
// to codegen with this one function.
// ---------------------------------------------------------------------------
// Ruling S445 item 2 — "Any expression statement with no effect is an error.
// An effect means a call, an assignment, `++`/`--`, or a `send`. … Calls always
// count as effects, even calls to pure functions." `liveExprHasEffect` walks an
// expression for one: a call (a `send(…)` and a tagged template are calls; so
// is `new`), an assignment (compound too, anywhere inside the expression),
// `++` / `--`, `delete` (it mutates), a `?{ … }` SQL block (it executes), a
// `reset(…)`. The body of a lambda is not run by evaluating the lambda, so it
// is not searched. An expression this function cannot see into (an escape-
// hatch carrying source text the structured parser did not model, markup-as-
// value, a match) is counted as an effect — fail open is the wrong way here
// only in that it keeps today's behaviour; the known shapes are all modelled.
// ---------------------------------------------------------------------------
const EFFECT_EXPR_KINDS = new Set(["call", "new", "assign", "sql-ref", "reset", "markup-value", "match-expr"]);
const EFFECT_UNARY_OPS = new Set(["++", "--", "delete", "await"]);
export function liveExprHasEffect(node, depth = 0) {
    if (node === null || typeof node !== "object" || depth > 300) return false;
    if (Array.isArray(node)) return node.some((x) => liveExprHasEffect(x, depth + 1));
    if (typeof node.kind === "string") {
        if (EFFECT_EXPR_KINDS.has(node.kind)) return true;
        if (node.kind === "unary" && EFFECT_UNARY_OPS.has(node.op)) return true;
        if (node.kind === "lambda") return false;
        // An expression the structured parser did not model is an escape-hatch
        // whose content this walk cannot see: it counts as an effect (the
        // conservative answer — a `class`, a sequence, a parse failure each
        // have their own diagnostic), EXCEPT `this`, the one pure atom both
        // front ends leave unmodeled. An EMPTY escape-hatch is a translation
        // drop, reported by the coverage check — never "no effect".
        if (node.kind === "escape-hatch") {
            return !(node.nativeKind === "ThisExpression" || node.nativeKind === "This");
        }
    }
    for (const k of Object.keys(node)) {
        if (k === "span") continue;
        const v = node[k];
        if (v !== null && typeof v === "object" && liveExprHasEffect(v, depth + 1)) return true;
    }
    return false;
}

// liveStmtNoEffectReason — why a live-shape statement compiles nothing, or null:
//   "literal"   — an expression statement built only from literals (`404`):
//                 indistinguishable from undeclared display text, reported as
//                 E-UNQUOTED-DISPLAY-TEXT (ruling S443 item 4);
//   "no-effect" — an expression statement that names something but does
//                 nothing (`@count`, `@a == 1`, `x => y`), E-STMT-NO-EFFECT
//                 (ruling S445 item 2);
//   "nothing"   — a declaration whose grammar is not satisfied.
export function liveStmtNothingReason(st) {
    if (!st || typeof st !== "object") return null;
    if (st.kind === "bare-expr") {
        if (st._onMountEffect === true || !st.exprNode || typeof st.exprNode !== "object") return null;
        if (liveExprIsInert(st.exprNode)) return "literal";
        return liveExprHasEffect(st.exprNode) ? null : "no-effect";
    }
    return liveStmtCompilesNothing(st) ? "nothing" : null;
}

// liveLabelIsTargeted — ruling S445 item 2: "a label nothing targets is also
// an error". True when a live-shape labelled statement (a loop carrying
// `label`) contains a `break` / `continue` naming that label.
export function liveLabelIsTargeted(st) {
    if (!st || typeof st !== "object" || typeof st.label !== "string" || st.label === "") return true;
    const name = st.label;
    const walk = (n, d) => {
        if (n === null || typeof n !== "object" || d > 400) return false;
        if (Array.isArray(n)) return n.some((x) => walk(x, d + 1));
        if ((n.kind === "break-stmt" || n.kind === "continue-stmt") && n.label === name) return true;
        for (const k of Object.keys(n)) {
            if (k === "span") continue;
            const v = n[k];
            if (v !== null && typeof v === "object" && walk(v, d + 1)) return true;
        }
        return false;
    };
    return walk(st.body, 0);
}

export function liveStmtCompilesNothing(st) {
    if (!st || typeof st !== "object") return false;
    switch (st.kind) {
        case "bare-expr":
            return liveStmtNothingReason(st) !== null;
        case "import-decl":
            // No source, or no binding (`import "./x.js"` — §21.3 admits named
            // and default imports only; codegen emits nothing for it).
            return typeof st.hostTag !== "string" && (!st.source
                || ((!Array.isArray(st.names) || st.names.length === 0)
                    && (!Array.isArray(st.specifiers) || st.specifiers.length === 0)));
        case "export-decl":
            return !st.exportKind && !st.exportedName;
        case "type-decl":
            return st.fromExport !== true && !st.raw && !st.typeKind;
        default:
            return false;
    }
}

// liveTreeDropsText — true when a live-shape tree holds an EMPTY escape-hatch
// anywhere: an expression the native bridge could not translate, whose source
// text therefore never reaches the emitted code (a tagged template, a comma
// sequence nested in a call argument, …). Measured on the translated output
// itself — no list of kinds.
export function liveTreeDropsText(node, depth = 0) {
    if (node === null || typeof node !== "object" || depth > 400) return false;
    if (Array.isArray(node)) return node.some((x) => liveTreeDropsText(x, depth + 1));
    if (node.kind === "escape-hatch" && (node.raw === "" || node.raw === undefined || node.raw === null)) return true;
    for (const k of Object.keys(node)) {
        if (k === "span") continue;
        const v = node[k];
        if (v !== null && typeof v === "object" && liveTreeDropsText(v, depth + 1)) return true;
    }
    return false;
}
