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
// bracket depth 0 at or after `from` (a function's parameter list and return
// annotation come first and are skipped as balanced groups), or -1.
function braceBodyEnd(texts, from) {
    let i = from;
    while (i < texts.length) {
        const t = texts[i];
        if (t === "{") return skipBalanced(texts, i);
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
        if (texts[i] === "{") {
            const e = skipBalanced(texts, i);
            return e < 0 ? texts.length : e;
        }
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
        count = braceBodyEnd(texts, 1);
        if (count < 0) return { nothing: true };
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

// nativeExprIsInert — for a native-parser Expr (native-parser/ast-expr.js).
export function nativeExprIsInert(expr) {
    if (!expr || typeof expr !== "object") return false;
    switch (expr.kind) {
        case "NumberLit":
        case "StringLit":
        case "BoolLit":
        case "NotValue":
            return true;
        case "TemplateLit":
            return Array.isArray(expr.exprs) && expr.exprs.length === 0;
        case "Paren":
            return nativeExprIsInert(expr.expression);
        case "Unary":
            return expr.prefix !== false && INERT_UNARY_OPS.has(expr.op) && nativeExprIsInert(expr.operand);
        case "Binary":
        case "Logical":
            return nativeExprIsInert(expr.left) && nativeExprIsInert(expr.right);
        case "Conditional":
            return nativeExprIsInert(expr.test) && nativeExprIsInert(expr.consequent) && nativeExprIsInert(expr.alternate);
        case "Array":
            return Array.isArray(expr.elements) && expr.elements.every((e) =>
                e && e.kind === "Item" && nativeExprIsInert(e.expression));
        case "Object":
            return Array.isArray(expr.properties) && expr.properties.every((p) =>
                p && p.kind === "KeyValue" && p.computed !== true && nativeExprIsInert(p.value));
        default:
            return false;
    }
}
