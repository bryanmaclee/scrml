// m67-d3-match-arm-parse.test.js — M6.7-D3 FIX-NATIVE.
//
// ROOT CAUSE (Phase-0 verified — see
// docs/changes/m67-phase-a-flag-flip/d3-match-arm.md):
//   The native-flip match cluster (E-EXPR-MATCH-ARROW 13 + E-EXPR-MATCH-PATTERN
//   11 = 24 first-error files) decomposed empirically into SEVEN distinct
//   match-arm sub-forms. The DOMINANT (12 of 24 files) is the `:>` colon-arrow
//   match-arm separator (§18.2). The native lexer lexes `:>` as an adjacent
//   Colon + GreaterThan pair (the colon lexer maximal-munches only `::`);
//   parseMatchArm recognised only `=>` (Arrow) and `->` (Minus + GreaterThan),
//   so every `:>` arm fired E-EXPR-MATCH-ARROW and stranded the cursor —
//   cascading to `no statement begins here`.
//
//   The LIVE front-end ACCEPTS `:>` — the live tokenizer lexes `:>` as a
//   first-class operator (tokenizer.ts) and ast-builder's isArmArrow treats
//   `=>` / `:>` / `->` identically, normalising the arrow flavour away so that
//   `.A :> x` and `.A => x` produce a BYTE-IDENTICAL match-expr AST. Native
//   matching `:>` is therefore parity-COMPLETENESS for a form live already
//   accepts, not a JS-subset expansion.
//
// THE FIX (parse-expr.js):
//   - parseMatchArm: new `:>` branch via isColonArrowAliasAhead, normalising
//     the separator field to ":>" (the bridge re-serialises to canonical "=>").
//   - isColonArrowAliasAhead: adjacency check (Colon + GreaterThan), exported.
//   - isArmArrowAt: `:>` branch so the newline-as-separator boundary detector
//     recognises `:>` arms too (multi-line `:>` match bodies).
//
// LOAD-BEARING: every `:>` assertion below FAILS against the pre-fix parser
// (parseMatchArm recorded E-EXPR-MATCH-ARROW on the Colon token). The `=>` /
// `->` baseline cases guard against an over-broad change.
//
// These tests drive (a) the native EXPRESSION parser, (b) the native STATEMENT
// parser (the NSBH surface), (c) the native->live bridge for shape parity, and
// (d) the LIVE pipeline (splitBlocks + buildAST) as the acceptance oracle.

import { describe, test, expect } from "bun:test";

import { lex } from "../../native-parser/lex.js";
import { parseExpr } from "../../native-parser/parse-expr.js";
import { parseProgram } from "../../native-parser/parse-stmt.js";
import { translateExpr } from "../../native-parser/translate-expr.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

// Drive the native EXPRESSION parser for one source string.
function nativeExpr(src) {
    return parseExpr(lex(src));
}

// Drive the native STATEMENT parser (parseProgram) — the NSBH surface.
function nativeProgram(src) {
    return parseProgram(lex(src), src);
}

// Strip volatile fields (span/id/raw-source) so only structural shape compares.
function shape(node) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(shape);
    const out = {};
    for (const k of Object.keys(node)) {
        if (k === "span" || k === "spans" || k === "id" || k === "_sourceText") continue;
        out[k] = shape(node[k]);
    }
    return out;
}

// Find the first match-expr node anywhere in a live FileAST.
function findMatchExpr(node, out) {
    if (node === null || typeof node !== "object") return;
    const k = node.kind || node.type;
    if (k === "match-expr") out.push(node);
    for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v)) v.forEach((x) => findMatchExpr(x, out));
        else if (v && typeof v === "object") findMatchExpr(v, out);
    }
}

// Drive the LIVE pipeline on a logic-body fragment; return {ok, errors, ast}.
function liveBody(body) {
    const src = `<program>\n  \${\n    function probe() {\n${body}\n    }\n  }\n</program>\n`;
    const bs = splitBlocks("probe.scrml", src);
    const tab = buildAST(bs, null);
    const ast = tab.ast ?? tab;
    const errors = (tab.errors ?? ast.errors ?? []).filter(
        (e) => (e.severity ?? "error") === "error");
    return { ok: errors.length === 0, errors, ast };
}

describe("M6.7-D3 — `:>` colon-arrow match-arm separator (dominant cluster sub-form)", () => {
    // ----- (a) the `:>` arm forms now parse with ZERO native errors -----
    const colonArrowForms = {
        "single :> variant arm":   `let s = match d {\n  .North :> "up"\n}`,
        "multi :> variant arms":   `let s = match d {\n  .North :> "up"\n  .South :> "down"\n}`,
        ":> with else arm":        `let s = match d {\n  .Active :> "a"\n  else :> "u"\n}`,
        ":> with block body":      `match (x) {\n  .A :> { doA() }\n  .B :> { doB() }\n}`,
        ":> with payload binding": `match (s) {\n  .Circle(r) :> r\n  else :> 0\n}`,
        "mixed => and :> arms":    `let m = match s {\n  .Active => "via ="\n  .Inactive :> "via :"\n  else :> "fallback"\n}`,
    };
    for (const [label, body] of Object.entries(colonArrowForms)) {
        test(`native parses with no error: ${label}`, () => {
            const r = nativeProgram(body);
            expect(r.errors.length).toBe(0);
        });
        test(`no 'no statement begins here' cascade: ${label}`, () => {
            const r = nativeProgram(body);
            const nsbh = r.errors.filter(
                (e) => /no statement begins here/i.test(JSON.stringify(e)));
            expect(nsbh.length).toBe(0);
        });
    }

    // ----- (b) the LIVE oracle accepts every `:>` form -----
    for (const [label, body] of Object.entries(colonArrowForms)) {
        test(`live pipeline accepts (oracle): ${label}`, () => {
            const indented = body.split("\n").map((l) => "      " + l).join("\n");
            const l = liveBody(indented);
            expect(l.ok).toBe(true);
        });
    }

    // ----- (c) bridge/AST parity: `:>` and `=>` produce identical match-expr -----
    const arrowEquivPairs = {
        "variant arms":     [`.North :> "up"\n        .South :> "down"`, `.North => "up"\n        .South => "down"`],
        "with else":        [`.Active :> "a"\n        else :> "u"`, `.Active => "a"\n        else => "u"`],
        "with binding":     [`.Circle(r) :> r\n        else :> 0`, `.Circle(r) => r\n        else => 0`],
    };
    for (const [label, [colon, fat]] of Object.entries(arrowEquivPairs)) {
        test(`live match-expr identical for :> and => (modulo span/id): ${label}`, () => {
            const lc = liveBody(`      let s = match d {\n        ${colon}\n      }`);
            const lf = liveBody(`      let s = match d {\n        ${fat}\n      }`);
            expect(lc.ok).toBe(true);
            expect(lf.ok).toBe(true);
            const mc = []; findMatchExpr(lc.ast, mc);
            const mf = []; findMatchExpr(lf.ast, mf);
            expect(mc.length).toBe(1);
            expect(mf.length).toBe(1);
            expect(shape(mc[0])).toEqual(shape(mf[0]));
        });
    }

    // ----- (d) native bridge emits a well-formed match-expr for a `:>` form ---
    test("native->live bridge yields kind:'match-expr' with rawArms for a :> match", () => {
        const r = nativeExpr(`match d {\n  .North :> "up"\n  .South :> "down"\n}`);
        expect(r.errors.length).toBe(0);
        const bridged = translateExpr(r.ast);
        expect(bridged.kind).toBe("match-expr");
        expect(Array.isArray(bridged.rawArms)).toBe(true);
        expect(bridged.rawArms.length).toBe(2);
        // The bridge normalises `:>` to the canonical `=>` in the rawArm text.
        for (const arm of bridged.rawArms) {
            expect(arm.includes("=>")).toBe(true);
            expect(arm.includes(":>")).toBe(false);
        }
    });

    // ----- guard: the `=>` / `->` baselines are UNCHANGED by the fix -----
    test("baseline => arm still parses (no over-broad regression)", () => {
        const r = nativeProgram(`let s = match d {\n  .North => "up"\n  .South => "down"\n}`);
        expect(r.errors.length).toBe(0);
    });
    test("baseline -> arm still parses (no over-broad regression)", () => {
        const r = nativeProgram(`let s = match d {\n  .North -> "up"\n  .South -> "down"\n}`);
        expect(r.errors.length).toBe(0);
    });
    test("a bare ':' (type annotation) is NOT consumed as a match arrow", () => {
        // `:>` recognition is scoped to match-arm parsing; a `:` outside that
        // context (a type annotation here) must be untouched. This parses fine.
        const r = nativeProgram(`let x: number = 1`);
        const nsbh = r.errors.filter((e) => /no statement begins here/i.test(JSON.stringify(e)));
        expect(nsbh.length).toBe(0);
    });
});
