// parser-conformance-lexer.test.js — lexer conformance suite (M1.1-M1.3).
//
// Per scrml-native-parser-design-2026-05-17.md §D7 M1 gating criterion (a):
//   "Lexer-output Token[] for every file in the conformance corpus is
//    byte-identical (modulo intentional scrml-extension divergence) to
//    what a reference Acorn-style tokenizer would emit on the JS subset."
//
// Scope: this test runs the bench corpus through both Acorn's tokenizer
// and the new compiler/native-parser/lex.js, normalizes outputs to a
// comparable shape, and asserts kind+text+span match per token. Files
// with stub-state surface (M1.4 regex bodies) record a SKIP with a
// reason; activation lands at the milestone named.

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as acorn from "acorn";

import { lex as scrmlNativeLex } from "../native-parser/lex.js";
import { TokenKind } from "../native-parser/token.js";

const BENCH_DIR = join(import.meta.dir, "parser-conformance", "bench");

const ACORN_OPTS = {
    ecmaVersion: 2025,
    sourceType:  "module",
    locations:   true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
};

// -----------------------------------------------------------------------------
// Token normalization — both Acorn and the native lexer emit different shapes;
// normalize each into the same { kind, text, start, end } 4-tuple so a diff
// reads cleanly.
// -----------------------------------------------------------------------------

// Acorn emits token-type objects with a `label` property. Map labels to our
// TokenKind tags so the diff is on the same axis.
const ACORN_LABEL_TO_KIND = {
    // Punctuation
    "(": TokenKind.LParen,
    ")": TokenKind.RParen,
    "{": TokenKind.LBrace,
    "}": TokenKind.RBrace,
    "[": TokenKind.LBracket,
    "]": TokenKind.RBracket,
    ";": TokenKind.Semicolon,
    ",": TokenKind.Comma,
    ".": TokenKind.Dot,
    "...": TokenKind.Ellipsis,
    "=>": TokenKind.Arrow,
    ":": TokenKind.Colon,
    "?": TokenKind.Question,

    // Operators — Acorn collapses several into shared TokenType labels;
    // text-driven disambiguation lives below in normalizeAcornToken.
    "=":   TokenKind.Assign,
    "_=":  TokenKind.Assign,  // Acorn's assign-with-op tag — text differentiates
    "+":   TokenKind.Plus,
    "-":   TokenKind.Minus,
    "+/-": TokenKind.Plus,    // Acorn binary-op shared label — text differentiates
    "*":   TokenKind.Star,
    "/":   TokenKind.Slash,
    "%":   TokenKind.Percent,
    "**":  TokenKind.StarStar,
    "==/!=":   TokenKind.Equal, // (legacy entry, kept for back-compat with prior corpus)
    "==/!=/===/!==": TokenKind.Equal, // Acorn's actual 4-form merged label — text differentiates
    "</>/<=/>=": TokenKind.LessThan,
    "||": TokenKind.LogicalOr,
    "&&": TokenKind.LogicalAnd,
    "??": TokenKind.NullishCoalesce,
    "|":  TokenKind.BitOr,
    "&":  TokenKind.BitAnd,
    "^":  TokenKind.BitXor,
    "<<": TokenKind.BitShiftLeft,
    ">>": TokenKind.BitShiftRight,
    ">>>":TokenKind.BitShiftRightUnsigned,
    "++/--": TokenKind.Increment, // Acorn collapses ++/--; text differentiates
    "prefix": TokenKind.Bang, // Acorn tag for prefix operators (text discriminates)
    "!/~": TokenKind.Bang,

    // Literals
    "num":     TokenKind.NumberLit,
    "string":  TokenKind.StringLit,
    "regexp":  TokenKind.RegexLit,
    "template":TokenKind.TemplateChunk,
    "`":       TokenKind.TemplateChunk, // template-backtick boundary
    "${":      TokenKind.LogicEscapeOpen,

    // Identifier / keyword (handled per-token via tt.keyword)
    "name":    TokenKind.Ident,
    "eof":     TokenKind.EOF,
};

const ACORN_KEYWORD_TO_KIND = {
    "if":       TokenKind.KwIf,
    "else":     TokenKind.KwElse,
    "for":      TokenKind.KwFor,
    "while":    TokenKind.KwWhile,
    "do":       TokenKind.KwDoWhile,
    "return":   TokenKind.KwReturn,
    "break":    TokenKind.KwBreak,
    "continue": TokenKind.KwContinue,
    "function": TokenKind.KwFunction,
    "let":      TokenKind.KwLet,
    "const":    TokenKind.KwConst,
    "var":      TokenKind.KwVar,
    "class":    TokenKind.KwClass,
    "extends":  TokenKind.KwExtends,
    "new":      TokenKind.KwNew,
    "import":   TokenKind.KwImport,
    "export":   TokenKind.KwExport,
    "from":     TokenKind.KwFrom,
    "as":       TokenKind.KwAs,
    "default":  TokenKind.KwDefault,
    "async":    TokenKind.KwAsync,
    "await":    TokenKind.KwAwait,
    "yield":    TokenKind.KwYield,
    "try":      TokenKind.KwTry,
    "catch":    TokenKind.KwCatch,
    "finally":  TokenKind.KwFinally,
    "throw":    TokenKind.KwThrow,
    "true":     TokenKind.KwTrue,
    "false":    TokenKind.KwFalse,
    "null":     TokenKind.KwNull,
    "undefined":TokenKind.KwUndefined,
    "typeof":   TokenKind.KwTypeof,
    "instanceof":TokenKind.KwInstanceof,
    "in":       TokenKind.KwIn,
    "of":       TokenKind.KwOf,
    "void":     TokenKind.KwVoid,
    "delete":   TokenKind.KwDelete,
    "this":     TokenKind.KwThis,
    "super":    TokenKind.KwSuper,
};

// Map an Acorn token to our normalized shape. Returns null if the token
// is a kind the native lexer deliberately doesn't emit (e.g. Acorn template
// boundaries we coalesce into a single TemplateChunk in M1.1).
// Native-lexer keyword set, mirror of token.js JS_KEYWORDS — used to
// re-classify Acorn's contextual-keyword `name` tokens (let / async /
// await / of / yield / from / as / static) that Acorn surfaces as
// label="name" but the native lexer recognizes as Kw* via JS_KEYWORDS.
// Source of truth: compiler/native-parser/token.js JS_KEYWORDS map.
const NATIVE_CONTEXTUAL_KEYWORDS = {
    "let":   TokenKind.KwLet,
    "async": TokenKind.KwAsync,
    "await": TokenKind.KwAwait,
    "yield": TokenKind.KwYield,
    "of":    TokenKind.KwOf,
    "from":  TokenKind.KwFrom,
    "as":    TokenKind.KwAs,
};

function normalizeAcornToken(tok, source) {
    const tt = tok.type;
    const text = source.substring(tok.start, tok.end);
    const label = tt.label;

    // Keyword lookup wins over label (for reserved words Acorn flags via
    // tt.keyword, e.g. `if`, `for`, `function`, `return`, `const`, `var`).
    if (tt.keyword && ACORN_KEYWORD_TO_KIND[tt.keyword]) {
        return { kind: ACORN_KEYWORD_TO_KIND[tt.keyword], text, start: tok.start, end: tok.end };
    }

    // Acorn-as-name contextual keywords — re-classify against the native
    // lexer's JS_KEYWORDS table (`let`, `async`, `await`, `of`, etc.
    // are non-reserved at top-level per ECMA-262; Acorn surfaces them as
    // label="name", but the native lexer treats them as Kw* unconditionally.
    // Re-classifying here keeps the byte-identical comparator aligned with
    // the native lexer's keyword-set policy.
    if (label === "name" && NATIVE_CONTEXTUAL_KEYWORDS[text]) {
        return { kind: NATIVE_CONTEXTUAL_KEYWORDS[text], text, start: tok.start, end: tok.end };
    }

    // text-driven disambiguation for operator-family collapsed labels
    if (label === "==/!=" || label === "==/!=/===/!==") {
        if (text === "===") return { kind: TokenKind.StrictEqual, text, start: tok.start, end: tok.end };
        if (text === "!==") return { kind: TokenKind.StrictNotEqual, text, start: tok.start, end: tok.end };
        if (text === "==")  return { kind: TokenKind.Equal, text, start: tok.start, end: tok.end };
        if (text === "!=")  return { kind: TokenKind.NotEqual, text, start: tok.start, end: tok.end };
    }
    if (label === "</>/<=/>=") {
        if (text === "<=") return { kind: TokenKind.LessEqual, text, start: tok.start, end: tok.end };
        if (text === ">=") return { kind: TokenKind.GreaterEqual, text, start: tok.start, end: tok.end };
        if (text === "<")  return { kind: TokenKind.LessThan, text, start: tok.start, end: tok.end };
        if (text === ">")  return { kind: TokenKind.GreaterThan, text, start: tok.start, end: tok.end };
    }
    if (label === "++/--") {
        if (text === "++") return { kind: TokenKind.Increment, text, start: tok.start, end: tok.end };
        if (text === "--") return { kind: TokenKind.Decrement, text, start: tok.start, end: tok.end };
    }
    if (label === "_=") {
        if (text === "+=") return { kind: TokenKind.PlusAssign, text, start: tok.start, end: tok.end };
        if (text === "-=") return { kind: TokenKind.MinusAssign, text, start: tok.start, end: tok.end };
        if (text === "*=") return { kind: TokenKind.StarAssign, text, start: tok.start, end: tok.end };
        if (text === "/=") return { kind: TokenKind.SlashAssign, text, start: tok.start, end: tok.end };
        // Other _= forms — accept as Assign-family but tag the text
        return { kind: TokenKind.Assign, text, start: tok.start, end: tok.end };
    }
    // Acorn's binary +/- shared label (label="+/-"): discriminate on text.
    if (label === "+/-") {
        if (text === "+") return { kind: TokenKind.Plus, text, start: tok.start, end: tok.end };
        if (text === "-") return { kind: TokenKind.Minus, text, start: tok.start, end: tok.end };
    }
    if (label === "prefix" || label === "!/~") {
        if (text === "!") return { kind: TokenKind.Bang, text, start: tok.start, end: tok.end };
        if (text === "~") return { kind: TokenKind.BitNot, text, start: tok.start, end: tok.end };
        if (text === "+") return { kind: TokenKind.Plus, text, start: tok.start, end: tok.end };
        if (text === "-") return { kind: TokenKind.Minus, text, start: tok.start, end: tok.end };
    }

    const mapped = ACORN_LABEL_TO_KIND[label];
    if (mapped) {
        return { kind: mapped, text, start: tok.start, end: tok.end };
    }

    // Unknown — return label-tagged for visibility (test will fail this row)
    return { kind: `Acorn:${label}`, text, start: tok.start, end: tok.end };
}

function normalizeNativeToken(tok) {
    return {
        kind:  tok.kind,
        text:  tok.text,
        start: tok.span.start,
        end:   tok.span.end,
    };
}

function tokenizeWithAcorn(source) {
    const out = [];
    try {
        const tokenizer = acorn.Parser.tokenizer(source, ACORN_OPTS);
        let tok = tokenizer.getToken();
        while (tok.type.label !== "eof") {
            const n = normalizeAcornToken(tok, source);
            if (n) out.push(n);
            tok = tokenizer.getToken();
        }
        out.push({ kind: TokenKind.EOF, text: "", start: source.length, end: source.length });
        return { ok: true, tokens: out };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function tokenizeWithNative(source) {
    try {
        const toks = scrmlNativeLex(source);
        return { ok: true, tokens: toks.map(normalizeNativeToken) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// -----------------------------------------------------------------------------
// Bench disposition policy (per milestone):
//
//   "full"                — byte-identical Acorn-vs-native token stream.
//   "M1.2-string"         — exercises string literals; string-count gate.
//   "M1.2-template"       — exercises template literals; chunk/interp gate.
//   "M1.2-string-template-regex" — exercises all three; intersection gate.
//   "smoke"               — defaults gate (non-empty + EOF + kind diversity).
//
// M1.1 stubs strings/comments/regex/templates with coarse single-token scans.
// M1.2 activates real escape-aware string + template-literal scanners.
// M1.3 activates real comment dispatchers + extends the normalizer to close
// the remaining byte-identical gap for files that only fail on
// Acorn-collapsed operator labels (binary `+/-`, 4-form `==/!=/===/!==`)
// or Acorn's contextual-keyword `name` surface for `let/async/await/of`.
// Three prior "smoke" files flip to "full" at M1.3.
// M1.4 will activate the prev-token-aware regex/division split.
//
// The conformance test exercises each file end-to-end and records each
// bench file's disposition. The "full" gate is byte-identical Acorn-vs-
// native after normalization; the per-disposition string/template gates
// count visible literals + assert interp-token balance.
// -----------------------------------------------------------------------------
const BENCH_DISPOSITION = {
    "decl-class.js":          "M1.2-string", // class body has "computed_" + "method"
    "decl-destructure.js":    "M1.2-string",
    // M1.3 flips the 3 prior-smoke files to "full": comment-aware lexing
    // now matches Acorn's drop-comments tokenizer surface; the M1.3
    // normalizer extension below (binary +/- label, 4-form ==/!=/===/!==
    // label, contextual-keyword `let/async/await/of` re-classification)
    // closes the residual byte-identical gap for these three files.
    "expr-arrow.js":          "full",        // arrow functions; mostly InCode + line-comments
    "expr-async-await.js":    "M1.2-string",
    "expr-literals.js":       "M1.2-string-template-regex",
    "expr-optional-chain.js": "M1.2-string",
    "expr-spread-rest.js":    "full",        // spread/rest + line-comments
    "expr-template-literal.js":"M1.2-template",
    "expr-yield-generator.js":"M1.2-string",
    "stmt-control-flow.js":   "full",        // control flow + line-comments
    "stmt-import-export.js":  "M1.2-string",
    "stmt-try-catch.js":      "M1.2-string",
};

// -----------------------------------------------------------------------------
// Smoke-level expectations: the native lexer MUST produce a non-empty token
// stream ending in EOF, MUST not throw, MUST emit at least one token of each
// kind that the file's source visibly contains (digits -> NumberLit;
// identifiers -> Ident/Kw*; punctuation; etc.). These are the gating criteria
// for an M1.1 PASS-with-stub-state files until M1.2+ activates full
// conformance.
// -----------------------------------------------------------------------------
function smokeAssertNonEmpty(native) {
    expect(native.ok).toBe(true);
    expect(native.tokens.length).toBeGreaterThan(0);
    const last = native.tokens[native.tokens.length - 1];
    expect(last.kind).toBe(TokenKind.EOF);
}

function smokeAssertKindDiversity(native, minKinds) {
    const kinds = new Set(native.tokens.map(t => t.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(minKinds);
}

// -----------------------------------------------------------------------------
// Full-conformance comparator (for true InCode-only files; M1.1 currently has
// none in the bench — but the infra is here for M1.2+ to enable per-file).
// -----------------------------------------------------------------------------
function compareFull(acorn, native) {
    expect(acorn.ok).toBe(true);
    expect(native.ok).toBe(true);
    expect(native.tokens.length).toBe(acorn.tokens.length);
    for (let i = 0; i < acorn.tokens.length; i++) {
        const a = acorn.tokens[i];
        const n = native.tokens[i];
        expect({ kind: n.kind, text: n.text, start: n.start, end: n.end })
            .toEqual({ kind: a.kind, text: a.text, start: a.start, end: a.end });
    }
}

// -----------------------------------------------------------------------------
// Test entry — one describe per bench file, disposition-driven.
// -----------------------------------------------------------------------------
describe("M1.1 lexer conformance — bench corpus", () => {
    const benchFiles = readdirSync(BENCH_DIR).filter(f => f.endsWith(".js"));

    for (const file of benchFiles) {
        const disposition = BENCH_DISPOSITION[file] ?? "smoke";
        const fullPath = join(BENCH_DIR, file);
        const source = readFileSync(fullPath, "utf8");

        describe(file, () => {
            test(`(${disposition}) acorn tokenizes without error`, () => {
                const a = tokenizeWithAcorn(source);
                expect(a.ok).toBe(true);
            });

            test(`(${disposition}) native lexer tokenizes without error`, () => {
                const n = tokenizeWithNative(source);
                expect(n.ok).toBe(true);
            });

            test(`(${disposition}) native lexer emits non-empty stream ending in EOF`, () => {
                const n = tokenizeWithNative(source);
                smokeAssertNonEmpty(n);
            });

            test(`(${disposition}) native lexer emits diverse token kinds (>=5)`, () => {
                const n = tokenizeWithNative(source);
                smokeAssertKindDiversity(n, 5);
            });

            // M1.2 STRENGTHENED ASSERTIONS — for files whose disposition
            // includes string and/or template surface, verify that the
            // M1.2 escape-aware scanners produce StringLit / TemplateChunk
            // tokens at every expected site. Full byte-identical conformance
            // against Acorn is deferred to a later M1.x — Acorn's
            // per-substructure template-token model differs from our
            // §51.0.Q.1 nested-engine surface in opinionated ways
            // (Acorn emits template-boundary `\`` / `${` / `}` as separate
            // token kinds; we emit TemplateChunk + TemplateInterpStart +
            // TemplateInterpEnd). A normalizing comparator is M1.3+ work.
            if (disposition === "full") {
                test(`(${disposition}) byte-identical token stream vs Acorn`, () => {
                    const a = tokenizeWithAcorn(source);
                    const n = tokenizeWithNative(source);
                    compareFull(a, n);
                });
            } else if (disposition.includes("string") || disposition.includes("template")) {
                // Count the visible string + template literals in the source
                // and assert the native lexer produced the right number.
                test(`(${disposition}) emits StringLit / TemplateChunk per visible literal`, () => {
                    const n = tokenizeWithNative(source);
                    expect(n.ok).toBe(true);

                    // Count visible string literals by counting opening
                    // quotes that are NOT inside a comment OR another
                    // string. Cheap heuristic: strip line + block comments
                    // first, then count un-escaped opening quotes.
                    const stripped = source
                        .replace(/\/\/.*$/gm, "")
                        .replace(/\/\*[\s\S]*?\*\//g, "");

                    // Naive count — sufficient for the conformance corpus.
                    let singleOpens = 0;
                    let doubleOpens = 0;
                    let backtickOpens = 0;
                    let i = 0;
                    let inSingle = false;
                    let inDouble = false;
                    let inBacktick = false;
                    while (i < stripped.length) {
                        const c = stripped[i];
                        if (c === "\\") { i += 2; continue; }
                        if (inSingle) {
                            if (c === "'") { inSingle = false; }
                        } else if (inDouble) {
                            if (c === '"') { inDouble = false; }
                        } else if (inBacktick) {
                            if (c === "`") { inBacktick = false; }
                        } else {
                            if (c === "'") { inSingle = true; singleOpens++; }
                            else if (c === '"') { inDouble = true; doubleOpens++; }
                            else if (c === "`") { inBacktick = true; backtickOpens++; }
                        }
                        i++;
                    }

                    const stringLits = n.tokens.filter(t => t.kind === TokenKind.StringLit);
                    expect(stringLits.length).toBe(singleOpens + doubleOpens);

                    if (backtickOpens > 0) {
                        const chunks = n.tokens.filter(t => t.kind === TokenKind.TemplateChunk);
                        // Each template literal emits at least one
                        // TemplateChunk (the final chunk before closing
                        // backtick); literals with interp emit chunk +
                        // (chunk × interp-count). Assert at least one
                        // TemplateChunk per backtick-opened literal.
                        expect(chunks.length).toBeGreaterThanOrEqual(backtickOpens);
                    }
                });

                // Symmetric assertion: every TemplateInterpStart has a
                // matching TemplateInterpEnd (i.e., the nested-engine
                // bracket balance is preserved end-to-end).
                test(`(${disposition}) TemplateInterpStart / TemplateInterpEnd balance`, () => {
                    const n = tokenizeWithNative(source);
                    expect(n.ok).toBe(true);
                    const starts = n.tokens.filter(t => t.kind === TokenKind.TemplateInterpStart).length;
                    const ends   = n.tokens.filter(t => t.kind === TokenKind.TemplateInterpEnd).length;
                    expect(starts).toBe(ends);
                });
            } else {
                test.skip(`(M1.3+) byte-identical token stream vs Acorn`, () => {
                    // Pending: M1.3 (comments — already dropped like Acorn so close),
                    // M1.4 (regex). Plus the Acorn-template-token-shape normalizer.
                });
            }
        });
    }
});

// -----------------------------------------------------------------------------
// Inline micro-corpus — small InCode-only programs that DO satisfy the full
// Tier-1+2 byte-identical gate today. These prove the conformance infra +
// the M1.1 InCode body work end-to-end.
// -----------------------------------------------------------------------------
describe("M1.1 lexer conformance — inline micro-corpus", () => {
    const cases = [
        {
            name: "simple var decl with number",
            src:  "const a = 42;",
            expect: [
                "KwConst", "Ident", "Assign", "NumberLit", "Semicolon", "EOF",
            ],
        },
        {
            name: "binary arith + assignment",
            src:  "let x = 1 + 2 * 3;",
            expect: [
                "KwLet", "Ident", "Assign", "NumberLit", "Plus", "NumberLit", "Star", "NumberLit", "Semicolon", "EOF",
            ],
        },
        {
            name: "comparison + logical",
            src:  "a == b && c !== d",
            expect: [
                "Ident", "Equal", "Ident", "LogicalAnd", "Ident", "StrictNotEqual", "Ident", "EOF",
            ],
        },
        {
            name: "function decl",
            src:  "function add(x, y) { return x + y; }",
            expect: [
                "KwFunction", "Ident", "LParen", "Ident", "Comma", "Ident", "RParen",
                "LBrace", "KwReturn", "Ident", "Plus", "Ident", "Semicolon", "RBrace", "EOF",
            ],
        },
        {
            name: "arrow function",
            src:  "const f = (x) => x + 1;",
            expect: [
                "KwConst", "Ident", "Assign", "LParen", "Ident", "RParen", "Arrow",
                "Ident", "Plus", "NumberLit", "Semicolon", "EOF",
            ],
        },
        {
            name: "scrml extension @cell + bare variant",
            src:  "@cell = .Variant",
            expect: [
                "ScrmlAt", "Assign", "BareVariant", "EOF",
            ],
        },
        {
            name: "hex numeric literal",
            src:  "const c = 0xff;",
            expect: [
                "KwConst", "Ident", "Assign", "NumberLit", "Semicolon", "EOF",
            ],
        },
        {
            name: "control flow",
            src:  "if (x > 0) { return; }",
            expect: [
                "KwIf", "LParen", "Ident", "GreaterThan", "NumberLit", "RParen",
                "LBrace", "KwReturn", "Semicolon", "RBrace", "EOF",
            ],
        },
    ];

    for (const c of cases) {
        test(`(InCode-full) ${c.name}`, () => {
            const n = tokenizeWithNative(c.src);
            expect(n.ok).toBe(true);
            const kinds = n.tokens.map(t => t.kind);
            expect(kinds).toEqual(c.expect);
        });
    }

    // -------------------------------------------------------------------
    // M1.2 — string + template cases. These exercise the new escape-aware
    // single/double string scanners + the §51.0.Q.1 nested-engine template
    // scanner via lex-in-template.js.
    // -------------------------------------------------------------------

    test(`(M1.2-string) single-quoted plain`, () => {
        const n = tokenizeWithNative("const x = 'hello'");
        expect(n.ok).toBe(true);
        const s = n.tokens.find(t => t.kind === TokenKind.StringLit);
        expect(s).toBeDefined();
        // cooked is on the original native token; we drop payloads in
        // normalizeNativeToken, so re-run via direct API for payload access.
        const raw = scrmlNativeLex("const x = 'hello'");
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit.cooked).toBe("hello");
        expect(lit.text).toBe("'hello'");
        expect(lit.quote).toBe("Single");
    });

    test(`(M1.2-string) double-quoted with newline + tab escapes`, () => {
        const src = 'const x = "a\\nb\\tc"';
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("a\nb\tc");
        expect(lit.quote).toBe("Double");
    });

    test(`(M1.2-string) \\u{...} brace-form unicode escape`, () => {
        const src = "const x = '\\u{1F600}'"; // 😀
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("\u{1F600}");
    });

    test(`(M1.2-string) \\x hex escape`, () => {
        const src = "const x = '\\x41\\x42'"; // AB
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("AB");
    });

    test(`(M1.2-string) \\u four-digit unicode escape`, () => {
        const src = "const x = '\\u00E9'"; // é
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("é");
    });

    test(`(M1.2-string) IdentityEscape passthrough`, () => {
        const src = "const x = '\\q'"; // \q decodes to literal q per IdentityEscape
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("q");
    });

    test(`(M1.2-string) line continuation (backslash + newline)`, () => {
        const src = 'const x = "a\\\nb"'; // \\<LF> → empty
        const raw = scrmlNativeLex(src);
        const lit = raw.find(t => t.kind === TokenKind.StringLit);
        expect(lit).toBeDefined();
        expect(lit.cooked).toBe("ab");
    });

    test(`(M1.2-template) plain template — no interp`, () => {
        const n = tokenizeWithNative("const x = `hello`");
        expect(n.ok).toBe(true);
        const kinds = n.tokens.map(t => t.kind);
        expect(kinds).toContain(TokenKind.TemplateChunk);
        // No interp tokens
        expect(kinds.indexOf(TokenKind.TemplateInterpStart)).toBe(-1);
        expect(kinds.indexOf(TokenKind.TemplateInterpEnd)).toBe(-1);
    });

    test(`(M1.2-template) single interp`, () => {
        const n = tokenizeWithNative("`a ${x} b`");
        expect(n.ok).toBe(true);
        const kinds = n.tokens.map(t => t.kind);
        expect(kinds).toEqual([
            "TemplateChunk",
            "TemplateInterpStart",
            "Ident",
            "TemplateInterpEnd",
            "TemplateChunk",
            "EOF",
        ]);
    });

    test(`(M1.2-template) nested templates — §51.0.Q.1 stress`, () => {
        const n = tokenizeWithNative("`outer ${`inner ${x}`} done`");
        expect(n.ok).toBe(true);
        const kinds = n.tokens.map(t => t.kind);
        // outer chunk, ${, inner chunk, ${, x, }, inner chunk closing, },
        // outer chunk closing
        expect(kinds).toEqual([
            "TemplateChunk",       // "outer "
            "TemplateInterpStart", // ${
            "TemplateChunk",       // "inner "
            "TemplateInterpStart", // ${
            "Ident",               // x
            "TemplateInterpEnd",   // } (inner)
            "TemplateChunk",       // closing-backtick chunk for inner
            "TemplateInterpEnd",   // } (outer)
            "TemplateChunk",       // " done" + closing-backtick chunk
            "EOF",
        ]);
    });

    test(`(M1.2-template) interp with balanced inner braces`, () => {
        // The classic test — function body inside interp produces balanced
        // {...} that MUST NOT trigger TemplateInterpEnd until depth-matched.
        const n = tokenizeWithNative("`val ${(() => { return 1 })()} done`");
        expect(n.ok).toBe(true);
        const kinds = n.tokens.map(t => t.kind);
        // Exactly one TemplateInterpStart + one TemplateInterpEnd
        const startCount = kinds.filter(k => k === "TemplateInterpStart").length;
        const endCount   = kinds.filter(k => k === "TemplateInterpEnd").length;
        expect(startCount).toBe(1);
        expect(endCount).toBe(1);
        // Inner braces are still emitted as LBrace + RBrace tokens
        expect(kinds).toContain("LBrace");
        expect(kinds).toContain("RBrace");
    });

    test(`(M1.2-template) interp with member access — \`val \${obj.x} done\``, () => {
        const n = tokenizeWithNative("`val ${obj.x} done`");
        expect(n.ok).toBe(true);
        const kinds = n.tokens.map(t => t.kind);
        expect(kinds).toEqual([
            "TemplateChunk",       // "val "
            "TemplateInterpStart", // ${
            "Ident",               // obj
            "Dot",                 // .
            "Ident",               // x
            "TemplateInterpEnd",   // }
            "TemplateChunk",       // " done`"
            "EOF",
        ]);
    });

    // -------------------------------------------------------------------
    // M1.4 — regex-literal cases. These exercise the new InRegexBody body
    // dispatcher in lex-in-regex.js. The DD §D4 P3 regex-vs-division
    // disambiguation lives at the InCode transition site
    // (regexAllowedAfter(lastKind)); the cases below cover both the
    // regex-permissive and division-context branches.
    // -------------------------------------------------------------------

    test(`(M1.4-regex) plain regex — /foo/`, () => {
        const raw = scrmlNativeLex("const g = /foo/");
        const r = raw.find(t => t.kind === TokenKind.RegexLit);
        expect(r).toBeDefined();
        expect(r.text).toBe("/foo/");
        expect(r.pattern).toBe("foo");
        expect(r.flags).toBe("");
    });

    test(`(M1.4-regex) regex with flags — /foo.bar/gi`, () => {
        const raw = scrmlNativeLex("const g = /foo.bar/gi");
        const r = raw.find(t => t.kind === TokenKind.RegexLit);
        expect(r).toBeDefined();
        expect(r.text).toBe("/foo.bar/gi");
        expect(r.pattern).toBe("foo.bar");
        expect(r.flags).toBe("gi");
    });

    test(`(M1.4-regex) escaped slash — /\\//`, () => {
        const raw = scrmlNativeLex("const g = /\\//");
        const r = raw.find(t => t.kind === TokenKind.RegexLit);
        expect(r).toBeDefined();
        expect(r.text).toBe("/\\//");
        expect(r.pattern).toBe("\\/");
    });

    test(`(M1.4-regex) char-class with literal slash — /[a/b]/`, () => {
        const raw = scrmlNativeLex("const g = /[a/b]/");
        const r = raw.find(t => t.kind === TokenKind.RegexLit);
        expect(r).toBeDefined();
        expect(r.text).toBe("/[a/b]/");
        expect(r.pattern).toBe("[a/b]");
    });

    test(`(M1.4-regex) division after Ident — a / b — NO regex emitted`, () => {
        const raw = scrmlNativeLex("const x = a / b");
        const regexes = raw.filter(t => t.kind === TokenKind.RegexLit);
        const slashes = raw.filter(t => t.kind === TokenKind.Slash);
        expect(regexes.length).toBe(0);
        expect(slashes.length).toBe(1);
    });

    test(`(M1.4-regex) division after RParen — (a) / b — NO regex emitted`, () => {
        const raw = scrmlNativeLex("const x = (a) / b");
        const regexes = raw.filter(t => t.kind === TokenKind.RegexLit);
        const slashes = raw.filter(t => t.kind === TokenKind.Slash);
        expect(regexes.length).toBe(0);
        expect(slashes.length).toBe(1);
    });

    test(`(M1.4-regex) regex after return keyword — return /x/`, () => {
        // `return` is regex-permissive per DD §D4 P3 (a value follows in
        // expression-primary position).
        const raw = scrmlNativeLex("function f() { return /x/g }");
        const r = raw.find(t => t.kind === TokenKind.RegexLit);
        expect(r).toBeDefined();
        expect(r.text).toBe("/x/g");
        expect(r.pattern).toBe("x");
        expect(r.flags).toBe("g");
    });

    // Numeric values: ensure the literal-value parse (DD §D1 canonical
    // calculation example) returns correct results.
    test("(calculation) numeric literal values", () => {
        const cases = [
            { src: "42",        value: 42 },
            { src: "3.14",      value: 3.14 },
            { src: "0xff",      value: 255 },
            { src: "0b1010",    value: 10 },
            { src: "0o17",      value: 15 },
            { src: "1_000_000", value: 1000000 },
            { src: "1e3",       value: 1000 },
        ];
        for (const { src, value } of cases) {
            const n = tokenizeWithNative(src);
            expect(n.ok).toBe(true);
            const numTok = n.tokens.find(t => t.kind === TokenKind.NumberLit);
            expect(numTok).toBeDefined();
            // Value lives on the payload — assert via the original native shape
            const nativeRaw = scrmlNativeLex(src);
            const raw = nativeRaw.find(t => t.kind === TokenKind.NumberLit);
            expect(raw.value).toBe(value);
        }
    });
});
