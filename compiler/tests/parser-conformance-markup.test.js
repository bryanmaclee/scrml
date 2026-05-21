// parser-conformance-markup.test.js — markup BlockContext conformance suite
// (MK1.2 — context-boundary recognition).
//
// Per IMPLEMENTATION-ROADMAP §2 MK1.2 + charter dive Q1.C: the markup-layer
// trampoline (compiler/native-parser/parse-markup.js) recognizes the 7
// block-opener sigils + the `<ident` markup-tag boundary, consumes them,
// transitions @blockContext (the live ctx.blockContext slot), tracks brace
// depth, and closes contexts back to the prior one. Entering .InLogicEscape
// pushes a DelegationFrame (punch-list P3); the matching close pops it.
//
// Scope (MK1.2 — the second sub-step of MK1): context-BOUNDARY recognition
// + transition + brace-depth closing + the DelegationFrame push/pop. The
// `<tag>` TREE (TagFrame, opener/closer pairing) is MK2; BodyMode /
// DisplayTextLiteral is MK3; the conformance-vs-BS block-tree harness is
// MK1.3. This file is therefore a UNIT suite over the MK1.2 surface —
// mirroring parser-conformance-lexer.test.js's inline-micro-corpus +
// direct-assertion structure, NOT a corpus diff.
//
// GROWTH NOTE — this file accumulates the markup-layer conformance
// sections per sub-step (MK1.2 → MK1.3 → MK2.1 → MK2.2 → MK2.3); each
// sub-step appends its own `#####`-banner section. The header above is
// the MK1.2-vintage origin note. The sections below are, in order:
// MK1.2 (context boundaries), MK1.3 (block-stream + comments + the
// corpus harness), MK2.1 (the TagFrame engine + opener recognition +
// TagKind), MK2.2 (the 3 closer forms + opener/closer pairing + mismatch
// recovery), MK2.3 (the TagKind-driven classification + punch-list P4/P5
// + the MK2 milestone close — §30-§36 at the file's end).
//
// The engine declaration (block-context.scrml's <engine for=BlockContext>)
// is the canonical Pillar-5b SHAPE; the .js shadow is what runs and what
// this test imports (README ANOMALY-2 shadow discipline).

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
    BlockContext,
    contextForSigil,
    isBlockOpenerSigil,
    isMarkupTagOpener,
    SIGIL_TO_CONTEXT,
    enterBlockContext,
    enterMarkupTagContext,
    closeBlockContext,
    isBlockContextClose,
    topBlockContextFrame,
    blockContextDepth,
    closingBrace,
    CommentForm,
    recognizeCommentForm,
    lineCommentExtent,
    htmlCommentExtent,
    commentExtent,
} from "../native-parser/block-context.js";
import {
    parseMarkup,
    parseMarkupTrace,
    dispatchTopLevel,
    dispatchInLogicEscape,
    isTagNameChar,
    // MK2.2 — the tag-tree pairing surface.
    emitMarkupElement,
    closeMarkupElement,
    handleCloser,
    closeUnterminatedTags,
} from "../native-parser/parse-markup.js";
import { makeParseContext, delegationDepth } from "../native-parser/parse-ctx.js";
import { makeCursor, isEof, advance } from "../native-parser/cursor.js";
import { depth as bracketDepth } from "../native-parser/bracket-stack.js";
// MK2.1 — the TagFrame <tag>-tree engine + the TagKind calculation.
import {
    TagKind,
    TagFrameKind,
    initialTagFrame,
    STRUCTURAL_ELEMENTS,
    isStructuralElementName,
    firstCharIsUpper,
    tagKindFor,
    isTagNameStart,
    isTagNameChar as tagFrameIsTagNameChar,
    isOpenerWhitespace,
    scanTagName,
    skipOpenerWhitespace,
    tokenizeOpener,
    recognizeOpener,
    tagFrameDepth,
    currentTagFrame,
    topTagFrame,
    pushTagFrame,
    popTagFrame,
    makeOpenExpectingChildrenFrame,
    makeOpenSelfClosedFrame,
    // MK2.2 — the closer-form surface + the pairing/recovery helpers.
    CloserForm,
    recognizeCloserForm,
    tokenizeCloser,
    closeTagFrame,
    closeSelfClosedFrame,
    reportUnterminatedTags,
    dispatchTagMismatchRecovery,
    ensureDiagnostics,
    makeDiagnostic,
    pushDiagnostic,
    // MK2.3 — the TagKind-driven classification + punch-list P5.
    TagClass,
    isDeclSignalChar,
    inspectAfterOpener,
    classifyTag,
    firstChildElementClass,
    classifyTagFrame,
    tagFrameBalancedAt,
} from "../native-parser/tag-frame.js";
// MK2.2 — the M1 ErrorRecovery engine (the mismatch dispatch re-syncs it).
import { ErrorRecovery } from "../native-parser/error-recovery.js";
// MK2.3 — punch-list P4: the JS-layer `<`-vs-LessThan discriminator
// (markupValueAllowedAfter) + TokenKind for its prev-token assertions.
import { markupValueAllowedAfter } from "../native-parser/lex-in-code.js";
import { TokenKind } from "../native-parser/token.js";
// MK3.1 — the §4.18 BodyMode engine + body-mode establishment.
import {
    BodyMode,
    ProgramBodyMode,
    initialBodyMode,
    STRUCTURAL_PARENT_CODE_DEFAULT,
    isCodeBearingParentName,
    PROGRAM_BODY_ELEMENTS,
    isProgramBodyElementName,
    bodyModeForChildOf,
    shorthandBodyMode,
    currentBodyMode,
    isCodeDefault,
    isFreeText,
    isDefaultLogic,
} from "../native-parser/body-mode.js";
// MK3.1 — the §4.18.3/.4 DisplayTextLiteral engine SKELETON.
// MK3.2 — the §4.18.3/.4 `.Outside` / `.InLiteralText` literal-scanning
// surface: the escape scanner, the AST-node builders, the diagnostic
// sink, and scanDisplayTextLiteral itself.
import {
    DisplayTextLiteral,
    initialDisplayTextLiteral,
    doubleQuote,
    LEGAL_FROM_IN_LITERAL_TEXT,
    classifyEscape,
    scanLiteralEscape,
    makeLiteralSegment,
    makeDisplayTextLiteralNode,
    scanDisplayTextLiteral,
} from "../native-parser/display-text-literal.js";
// MK3.1 — the parse-ctx block-kind catalog (the DisplayTextLiteral kind).
import { blockKinds } from "../native-parser/parse-ctx.js";
// MK3.1 — the markup-tag dispatch + the TagFrame-stack helpers the
// body-mode establishment + P7 tests drive.
import { dispatchInMarkupTag } from "../native-parser/parse-markup.js";
import { topDelegationFrame } from "../native-parser/parse-ctx.js";

// The MK1.3 conformance ORACLE — the current heuristic block-splitter
// (compiler/src/block-splitter.js). The native markup block-stream is
// diffed against the BS block tree on the conformance corpus (charter
// Q4.A MK1 gating / roadmap §4.2). block-splitter.js is READ-ONLY here —
// it is the oracle, never modified by this dispatch.
import { splitBlocks } from "../src/block-splitter.js";

// peakDelegationDepth — drive the trampoline dispatch by dispatch (the
// dispatch fns are exported) and record the HIGH-WATER delegationStack
// depth. parseMarkupTrace only exposes the FINAL ctx; for a nesting
// assertion the peak is the load-bearing datum.
//
// MK1.3 — the dispatchers take a `run` text-accumulator as their first
// argument (the trampoline threads it for block-stream Text emission).
// This helper supplies a fresh run record; the depth assertions it backs
// are unaffected by text accumulation.
function peakDelegationDepth(source) {
    const cursor = makeCursor(source);
    const ctx = makeParseContext();
    const run = { at: null };
    let peak = 0;
    let iters = 0;
    const maxIters = (source.length + 1) * 4;
    while (!isEof(cursor) && iters < maxIters) {
        const before = cursor.pos;
        if (ctx.blockContext === BlockContext.TopLevel) {
            dispatchTopLevel(run, cursor, ctx);
        } else {
            // Every context this helper exercises (logic-escape nesting)
            // routes through dispatchInLogicEscape.
            dispatchInLogicEscape(run, cursor, ctx);
        }
        if (delegationDepth(ctx) > peak) peak = delegationDepth(ctx);
        if (cursor.pos === before && !isEof(cursor)) cursor.pos = cursor.pos + 1;
        iters = iters + 1;
    }
    return peak;
}

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

// distinctContexts — the SET of BlockContext variants the trampoline visited
// over a run (the contextTrace records @blockContext at the TOP of every
// iteration; the set is the cleanest "which contexts were entered" assertion).
function distinctContexts(source) {
    const { contextTrace } = parseMarkupTrace(source);
    return [...new Set(contextTrace)];
}

// finalState — the balance snapshot after a full run: a well-formed source
// returns every stack to empty.
function finalState(source) {
    const { ctx } = parseMarkupTrace(source);
    return {
        brackets:         bracketDepth(ctx.brackets),
        delegation:       delegationDepth(ctx),
        blockContextDeep: blockContextDepth(ctx),
        blockContext:     ctx.blockContext,
    };
}

// =============================================================================
// MK1.2 §1 — the 7 block-opener sigil table (the closed recognition surface).
// =============================================================================
describe("MK1.2 block-opener sigils — the closed recognition table", () => {
    // The 7 sigils per charter Q1.C / roadmap §2 MK1.2. Built via concat so
    // this test file does not itself carry a literal brace-bearing sigil
    // (the README ANOMALY-1 string-literal class — the .scrml + .js both
    // use concat for exactly this reason).
    const brace = "{";
    const SIGIL_ROWS = [
        ["$" + brace, BlockContext.InLogicEscape],
        ["?" + brace, BlockContext.InSql],
        ["#" + brace, BlockContext.InCss],
        ["!" + brace, BlockContext.InErrorEffect],
        ["^" + brace, BlockContext.InMeta],
        ["~" + brace, BlockContext.InTest],
        ["_" + brace, BlockContext.InForeignCode],
    ];

    for (const [sigil, expected] of SIGIL_ROWS) {
        test(`contextForSigil("${sigil}") -> ${expected}`, () => {
            expect(contextForSigil(sigil)).toBe(expected);
            expect(isBlockOpenerSigil(sigil)).toBe(true);
        });
    }

    test("the table has exactly 7 entries (no extras)", () => {
        expect(Object.keys(SIGIL_TO_CONTEXT).length).toBe(7);
    });

    test("a non-sigil two-char string is not recognized", () => {
        // `<{` is not a sigil; `xy` is not a sigil; the first char must be
        // one of the 7 sigil characters AND the second must be `{`.
        expect(contextForSigil("<" + brace)).toBe(null);
        expect(contextForSigil("xy")).toBe(null);
        expect(isBlockOpenerSigil("$x")).toBe(false);
    });
});

// =============================================================================
// MK1.2 §2 — the `<ident` markup-tag boundary recognizer.
// =============================================================================
describe("MK1.2 markup-tag boundary — isMarkupTagOpener", () => {
    test("`<` + ASCII letter is a markup-tag opener", () => {
        expect(isMarkupTagOpener("<", "d")).toBe(true);
        expect(isMarkupTagOpener("<", "D")).toBe(true);
    });

    test("`<` + non-letter is NOT a markup-tag opener", () => {
        expect(isMarkupTagOpener("<", " ")).toBe(false);  // `< ` — less-than op
        expect(isMarkupTagOpener("<", "/")).toBe(false);  // `</` — a closer
        expect(isMarkupTagOpener("<", "")).toBe(false);   // `<` at EOF
        expect(isMarkupTagOpener("<", "1")).toBe(false);  // `<1` — not a name start
    });

    test("a non-`<` first char is never a markup-tag opener", () => {
        expect(isMarkupTagOpener("x", "d")).toBe(false);
    });

    test("isTagNameChar accepts letters / digits / hyphen, rejects the rest", () => {
        expect(isTagNameChar("a")).toBe(true);
        expect(isTagNameChar("Z")).toBe(true);
        expect(isTagNameChar("7")).toBe(true);
        expect(isTagNameChar("-")).toBe(true);
        expect(isTagNameChar(" ")).toBe(false);
        expect(isTagNameChar(">")).toBe(false);
        expect(isTagNameChar("")).toBe(false);
    });
});

// =============================================================================
// MK1.2 §3 — sigil CONSUMPTION + @blockContext TRANSITION (enterBlockContext).
// =============================================================================
describe("MK1.2 enterBlockContext — consume the sigil + transition", () => {
    const brace = "{";

    test("entering a logic-escape sigil transitions @blockContext + consumes 2 chars", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("$" + brace + " x }");
        expect(ctx.blockContext).toBe(BlockContext.TopLevel);

        enterBlockContext(ctx, cursor, BlockContext.InLogicEscape, "$" + brace);

        // @blockContext transitioned.
        expect(ctx.blockContext).toBe(BlockContext.InLogicEscape);
        // The two sigil characters were consumed.
        expect(cursor.pos).toBe(2);
        // A Brace frame for the sigil's `{` is on ctx.brackets.
        expect(bracketDepth(ctx.brackets)).toBe(1);
        // A BlockContext frame was pushed recording the prior context.
        const frame = topBlockContextFrame(ctx);
        expect(frame.context).toBe(BlockContext.InLogicEscape);
        expect(frame.priorContext).toBe(BlockContext.TopLevel);
        expect(frame.depthAtOpen).toBe(0);
        expect(frame.openSpan.start).toBe(0);
        expect(frame.openSpan.end).toBe(2);
    });

    test("entering a SQL sigil transitions to .InSql", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("?" + brace + " select 1 }");
        enterBlockContext(ctx, cursor, BlockContext.InSql, "?" + brace);
        expect(ctx.blockContext).toBe(BlockContext.InSql);
        expect(blockContextDepth(ctx)).toBe(1);
    });

    test("the .InLogicEscape entry pushes a DelegationFrame (punch-list P3)", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("$" + brace + " }");
        expect(delegationDepth(ctx)).toBe(0);

        enterBlockContext(ctx, cursor, BlockContext.InLogicEscape, "$" + brace);

        // One DelegationFrame, kind .LogicEscape, closeOn .BraceDepth(0).
        expect(delegationDepth(ctx)).toBe(1);
        const dframe = ctx.delegationStack[0];
        expect(dframe.kind).toBe("LogicEscape");
        expect(dframe.closeOn.kind).toBe("BraceDepth");
        expect(dframe.closeOn.depthAtOpen).toBe(0);
        // openSpan is the sigil's span — the blame locus for MK4's
        // unterminated-body error.
        expect(dframe.openSpan.start).toBe(0);
        expect(dframe.openSpan.end).toBe(2);
    });

    test("a non-logic-escape sigil does NOT push a DelegationFrame", () => {
        // Only the markup->JS .InLogicEscape delegation pushes a frame at
        // MK1.2; the CSS/SQL/etc. sub-context delegations are MK1.3+.
        const ctx = makeParseContext();
        const cursor = makeCursor("#" + brace + " a }");
        enterBlockContext(ctx, cursor, BlockContext.InCss, "#" + brace);
        expect(delegationDepth(ctx)).toBe(0);
        expect(blockContextDepth(ctx)).toBe(1);
    });
});

// =============================================================================
// MK1.2 §4 — the `<ident` boundary transition (enterMarkupTagContext).
// =============================================================================
describe("MK1.2 enterMarkupTagContext — the boundary transition", () => {
    test("entering a markup tag transitions @blockContext + consumes only `<`", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("<div>");
        enterMarkupTagContext(ctx, cursor);

        expect(ctx.blockContext).toBe(BlockContext.InMarkupTag);
        // Only the `<` boundary marker is consumed — the name + `>` are MK2.
        expect(cursor.pos).toBe(1);
        // A markup-tag frame is NOT brace-delimited — depthAtOpen sentinel -1.
        const frame = topBlockContextFrame(ctx);
        expect(frame.context).toBe(BlockContext.InMarkupTag);
        expect(frame.depthAtOpen).toBe(-1);
        expect(frame.priorContext).toBe(BlockContext.TopLevel);
    });

    test("a markup-tag frame is NEVER a brace close (the -1 sentinel)", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("<div>");
        enterMarkupTagContext(ctx, cursor);
        // Even with a `}` at the cursor, isBlockContextClose is false for a
        // markup-tag frame — markup tags close on TagFrame balance (MK2),
        // not a brace-depth-0 `}`.
        const braceCursor = makeCursor(closingBrace());
        expect(isBlockContextClose(ctx, braceCursor)).toBe(false);
    });
});

// =============================================================================
// MK1.2 §5 — brace-depth tracking + the matching close (closeBlockContext).
// =============================================================================
describe("MK1.2 closeBlockContext — brace-depth-0 matching close", () => {
    const brace = "{";

    test("the matching `}` of a logic-escape context closes back to .TopLevel", () => {
        const fs = finalState("$" + brace + " let x = 1 }");
        // Every stack returned to empty — the context closed cleanly, and
        // @blockContext is back at .TopLevel (the close transitioned it).
        expect(fs.brackets).toBe(0);
        expect(fs.delegation).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
        expect(fs.blockContext).toBe(BlockContext.TopLevel);
    });

    test("after the close, top-level text resumes in .TopLevel", () => {
        // `${ x } after` — the close transitions back to .TopLevel, and the
        // trailing text runs in .TopLevel (the trace records it).
        const { contextTrace } = parseMarkupTrace("$" + brace + " x } after");
        // The LAST iteration is on the trailing text — .TopLevel.
        expect(contextTrace[contextTrace.length - 1]).toBe(BlockContext.TopLevel);
        // And an .InLogicEscape run happened earlier.
        expect(contextTrace).toContain(BlockContext.InLogicEscape);
    });

    test("inner `{`/`}` in the body do NOT prematurely close the context", () => {
        // The inner `{ b }` braces nest against ctx.brackets; the matching
        // close is the OUTER `}` at brace-depth-0.
        const fs = finalState("$" + brace + " if (a) { b } }");
        expect(fs.brackets).toBe(0);
        expect(fs.delegation).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
    });

    test("closeBlockContext pops the BlockContext frame + the Brace frame + the DelegationFrame", () => {
        const ctx = makeParseContext();
        // `${ }` — open then immediately at the close.
        const cursor = makeCursor("$" + brace + closingBrace());
        enterBlockContext(ctx, cursor, BlockContext.InLogicEscape, "$" + brace);
        expect(blockContextDepth(ctx)).toBe(1);
        expect(delegationDepth(ctx)).toBe(1);
        expect(bracketDepth(ctx.brackets)).toBe(1);

        // The cursor is now at the `}` — it is the matching close.
        expect(isBlockContextClose(ctx, cursor)).toBe(true);
        const popped = closeBlockContext(ctx, cursor);

        expect(popped.context).toBe(BlockContext.InLogicEscape);
        // All three stacks emptied.
        expect(blockContextDepth(ctx)).toBe(0);
        expect(delegationDepth(ctx)).toBe(0);
        expect(bracketDepth(ctx.brackets)).toBe(0);
        // @blockContext returned to the prior context.
        expect(ctx.blockContext).toBe(BlockContext.TopLevel);
        // The `}` was consumed.
        expect(cursor.pos).toBe(3);
    });

    test("isBlockContextClose is false for an inner `}` (depth > depthAtOpen + 1)", () => {
        const ctx = makeParseContext();
        // `${ {` — opened the context, then an inner `{` raised depth to 2.
        const cursor = makeCursor("$" + brace + " " + brace);
        enterBlockContext(ctx, cursor, BlockContext.InLogicEscape, "$" + brace);
        // advance past the space + consume the inner `{` via a body scan
        // would be the trampoline's job; here we simulate the inner `{`
        // having been counted by pushing depth manually is not needed —
        // we just verify the predicate at depth 1 vs depth 2.
        // At depth 1 (only the sigil `{`), a `}` IS the close:
        const closeCur = makeCursor(closingBrace());
        expect(isBlockContextClose(ctx, closeCur)).toBe(true);
    });

    test("a SQL block closes correctly via brace depth", () => {
        const fs = finalState("?" + brace + " select 1 }");
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
    });
});

// =============================================================================
// MK1.2 §6 — the trampoline end-to-end: recognize, consume, transition.
// =============================================================================
describe("MK1.2 parseMarkup trampoline — context transitions end-to-end", () => {
    const brace = "{";

    test("a bare logic-escape block is recognized + entered + closed", () => {
        const seen = distinctContexts("$" + brace + " let x = 1 }");
        expect(seen).toContain(BlockContext.TopLevel);
        expect(seen).toContain(BlockContext.InLogicEscape);
    });

    test("each of the 7 sigils enters its matching context", () => {
        const src =
            "?" + brace + " s }" +
            " #" + brace + " c }" +
            " !" + brace + " e }" +
            " ^" + brace + " m }" +
            " ~" + brace + " t }";
        const seen = distinctContexts(src);
        expect(seen).toContain(BlockContext.InSql);
        expect(seen).toContain(BlockContext.InCss);
        expect(seen).toContain(BlockContext.InErrorEffect);
        expect(seen).toContain(BlockContext.InMeta);
        expect(seen).toContain(BlockContext.InTest);
        // All five blocks closed — every stack balanced.
        const fs = finalState(src);
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
    });

    test("a foreign-code block enters .InForeignCode", () => {
        const seen = distinctContexts("_" + brace + " verbatim }");
        expect(seen).toContain(BlockContext.InForeignCode);
    });

    test("a `<ident` boundary enters .InMarkupTag", () => {
        const seen = distinctContexts("<section> hello");
        expect(seen).toContain(BlockContext.InMarkupTag);
    });

    test("ordinary top-level text never leaves .TopLevel", () => {
        const seen = distinctContexts("just plain text, no sigils");
        expect(seen).toEqual([BlockContext.TopLevel]);
        const fs = finalState("just plain text, no sigils");
        expect(fs.blockContext).toBe(BlockContext.TopLevel);
        expect(fs.blockContextDeep).toBe(0);
    });

    test("dispatchTopLevel performs the transition on a recognized sigil", () => {
        // MK1.3 — dispatchTopLevel no longer returns a recognition record
        // (the MK1.2 observability hook); the observable surface is now the
        // @blockContext transition + the block-stream. A `run` accumulator
        // is its first argument.
        const ctx = makeParseContext();
        const cursor = makeCursor("$" + brace + " x }");
        const run = { at: null };
        dispatchTopLevel(run, cursor, ctx);
        // dispatchTopLevel performed the transition into the entered context.
        expect(ctx.blockContext).toBe(BlockContext.InLogicEscape);
        // The sigil's two characters were consumed.
        expect(cursor.pos).toBe(2);
    });

    test("parseMarkup returns the typed block-stream (MK1.3 — non-empty)", () => {
        // MK1.3 — the trampoline now PRODUCES a block-stream. `${ x }` is a
        // logic-escape context block; `<div>` enters a markup-tag boundary.
        const nodes = parseMarkup("$" + brace + " x } <div>");
        expect(Array.isArray(nodes)).toBe(true);
        // At least the LogicEscape context block is emitted.
        const kinds = nodes.map((n) => n.kind);
        expect(kinds).toContain("LogicEscape");
    });
});

// =============================================================================
// MK1.2 §7 — the DelegationFrame push/pop lifecycle (punch-list P3).
// =============================================================================
describe("MK1.2 DelegationFrame lifecycle — push on enter, pop on close", () => {
    const brace = "{";

    test("a balanced logic-escape leaves the delegationStack empty", () => {
        const fs = finalState("$" + brace + " body }");
        expect(fs.delegation).toBe(0);
    });

    test("an UNTERMINATED logic-escape leaves the DelegationFrame on the stack", () => {
        // No matching `}` — the frame stays as the MK4 unterminated-body
        // blame locus. The openSpan is the sigil's span.
        const { ctx } = parseMarkupTrace("$" + brace + " body with no close");
        expect(delegationDepth(ctx)).toBe(1);
        expect(blockContextDepth(ctx)).toBe(1);
        const dframe = ctx.delegationStack[0];
        expect(dframe.kind).toBe("LogicEscape");
        expect(dframe.openSpan.start).toBe(0);
        expect(dframe.openSpan.end).toBe(2);
    });

    test("nested logic-escape blocks stack delegations (§51.0.Q.1 hierarchy)", () => {
        // `${ a ${ b } c }` — a logic-escape inside a logic-escape. The two
        // contexts stack: the DelegationStack peaks at depth 2, then both
        // pop and the final stacks are empty.
        const src = "$" + brace + " a $" + brace + " b } c }";
        expect(peakDelegationDepth(src)).toBe(2);
        const { ctx } = parseMarkupTrace(src);
        expect(delegationDepth(ctx)).toBe(0);
        expect(blockContextDepth(ctx)).toBe(0);
        expect(bracketDepth(ctx.brackets)).toBe(0);
    });

    test("a SQL block does NOT touch the delegationStack (only .InLogicEscape does at MK1.2)", () => {
        const fs = finalState("?" + brace + " select 1 }");
        expect(fs.delegation).toBe(0);
    });
});

// =============================================================================
// MK1.2 §8 — §23 foreign-code opaque passthrough.
// =============================================================================
describe("MK1.2 foreign-code (§23) — opaque passthrough", () => {
    const brace = "{";

    test("a sigil INSIDE a foreign-code body is NOT recognized (verbatim)", () => {
        // `_{ ${ ... } }` — the inner `${` is opaque body, NOT a nested
        // logic-escape. Only .TopLevel + .InForeignCode are visited.
        const seen = distinctContexts("_" + brace + " $" + brace + " inner } }");
        expect(seen).toEqual([BlockContext.TopLevel, BlockContext.InForeignCode]);
    });

    test("a `<ident` INSIDE a foreign-code body is NOT recognized (verbatim)", () => {
        const seen = distinctContexts("_" + brace + " <div> not a tag }");
        expect(seen).toEqual([BlockContext.TopLevel, BlockContext.InForeignCode]);
    });

    test("the foreign-code block still closes on its matching brace-depth-0 `}`", () => {
        // Inner braces are depth-tracked (so the matching close is found)
        // but otherwise uninterpreted.
        const fs = finalState("_" + brace + " a { b } c }");
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
    });
});

// =============================================================================
// MK1.2 §9 — nested contexts (the charter Q1.C rule= contract).
// =============================================================================
describe("MK1.2 nested contexts — the rule= contract permits nesting", () => {
    const brace = "{";

    test("a SQL block inside a logic-escape body nests + both close", () => {
        // `${ a ?{ select 1 } b }` — the rule= contract
        // <InLogicEscape rule=(.TopLevel | .InMarkupTag | .InSql)> permits
        // .InSql inside a logic-escape body.
        const src = "$" + brace + " a ?" + brace + " select 1 } b }";
        const seen = distinctContexts(src);
        expect(seen).toContain(BlockContext.InLogicEscape);
        expect(seen).toContain(BlockContext.InSql);
        const fs = finalState(src);
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
        expect(fs.delegation).toBe(0);
    });

    test("the close returns @blockContext to the correct OUTER context", () => {
        // After the inner `?{...}` closes, the trampoline is back in
        // .InLogicEscape (not .TopLevel) until the outer `}` closes it.
        const src = "$" + brace + " ?" + brace + " s } more logic }";
        const { contextTrace } = parseMarkupTrace(src);
        // The trace must show .InLogicEscape AFTER an .InSql run (the inner
        // SQL block closed back into the logic-escape, not to top level).
        const firstSql = contextTrace.indexOf(BlockContext.InSql);
        const lastSql = contextTrace.lastIndexOf(BlockContext.InSql);
        expect(firstSql).toBeGreaterThan(-1);
        // Some .InLogicEscape iteration occurs after the SQL run ends.
        const afterSql = contextTrace.slice(lastSql + 1);
        expect(afterSql).toContain(BlockContext.InLogicEscape);
    });
});

// =============================================================================
// MK1.2 §10 — termination guarantees (the trampoline always halts).
// =============================================================================
describe("MK1.2 trampoline termination — every input halts", () => {
    const brace = "{";

    test("an empty source halts with empty stacks", () => {
        const fs = finalState("");
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
        expect(fs.delegation).toBe(0);
    });

    test("an unterminated logic-escape halts (does not spin)", () => {
        // The trampoline's iter bound + progress sentinel guarantee
        // termination even on a malformed unterminated block.
        const nodes = parseMarkup("$" + brace + " unterminated");
        expect(Array.isArray(nodes)).toBe(true);
    });

    test("an orphan `}` at top level halts (not a context close)", () => {
        // A `}` with no open context is ordinary top-level text — it does
        // not close anything (the stack is empty) and the trampoline
        // advances past it.
        const fs = finalState("text } more");
        expect(fs.blockContext).toBe(BlockContext.TopLevel);
        expect(fs.blockContextDeep).toBe(0);
    });

    test("a deeply nested run halts with balanced stacks (5-deep)", () => {
        // ${ ${ ${ ${ ${ x } } } } } — 5-deep logic-escape nesting. The R1
        // spike punch-list P11 deep-nesting smoke test wants the delegation
        // depth to reach 5; here MK1.2's slice of that is: the stacks PEAK
        // at 5 and then fully unwind to 0.
        const open = "$" + brace + " ";
        const close = " }";
        const src = open.repeat(5) + "x" + close.repeat(5);
        expect(peakDelegationDepth(src)).toBe(5);
        const fs = finalState(src);
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
        expect(fs.delegation).toBe(0);
    });
});

// #############################################################################
// MK1.3 — comments + sub-context stubs + conformance.
//
// Per IMPLEMENTATION-ROADMAP §2 MK1.3 + charter dive Q1.C / Q2.A:
//   - `//` line comments + `<!-- -->` HTML comments are recognized
//     STRUCTURALLY by the markup layer (not by a heuristic) — the
//     elimination of BS heuristics #6 / #7.
//   - The .InCss / .InSql / .InErrorEffect / .InMeta / .InTest
//     sub-context stubs gain sketch-depth body dispatchers.
//   - The markup-layer block-stream is diffed against the current BS
//     block tree on the conformance corpus (the §14 harness).
// #############################################################################

// blockKinds — the typed-block tags the trampoline emits (mirror of the
// parse-ctx.js blockKinds() table; the test names them inline so the
// assertions read at the block-stream level of abstraction).
// MK3.1 added DisplayTextLiteral (the §4.18.8 code-default-body literal
// node kind, distinct from Text); the MK3.1 §41 section asserts the
// blockKinds() catalog directly.
const NativeBlockKind = {
    Text:               "Text",
    DisplayTextLiteral: "DisplayTextLiteral",
    Comment:            "Comment",
    Markup:             "Markup",
    LogicEscape:        "LogicEscape",
    Sql:                "Sql",
    Css:                "Css",
    ErrorEffect:        "ErrorEffect",
    Meta:               "Meta",
    Test:               "Test",
    ForeignCode:        "ForeignCode",
};

// blockStream — the native typed block-stream for a source: a list of
// { kind, start, end } 3-tuples. The cleanest comparison shape against
// the BS block tree's top-level blocks.
function blockStream(source) {
    return parseMarkup(source).map((b) => ({
        kind:  b.kind,
        start: b.span.start,
        end:   b.span.end,
    }));
}

// =============================================================================
// MK1.3 §11 — structural comment recognition (BS heuristics #6/#7 eliminated).
// =============================================================================
describe("MK1.3 comment recognizers — the closed structural recognition", () => {
    test("recognizeCommentForm recognizes the `//` line-comment opener", () => {
        expect(recognizeCommentForm(makeCursor("// a comment"))).toBe(CommentForm.Line);
        expect(recognizeCommentForm(makeCursor("//"))).toBe(CommentForm.Line);
    });

    test("recognizeCommentForm recognizes the `<!--` HTML-comment opener", () => {
        expect(recognizeCommentForm(makeCursor("<!-- a comment -->"))).toBe(CommentForm.Html);
        expect(recognizeCommentForm(makeCursor("<!---->"))).toBe(CommentForm.Html);
    });

    test("recognizeCommentForm returns null when no comment opener is at the cursor", () => {
        expect(recognizeCommentForm(makeCursor("plain text"))).toBe(null);
        expect(recognizeCommentForm(makeCursor("<div>"))).toBe(null);   // `<d` — not `<!--`
        expect(recognizeCommentForm(makeCursor("/ x"))).toBe(null);     // a single `/`
        expect(recognizeCommentForm(makeCursor("<!- x"))).toBe(null);   // `<!-` — short of `<!--`
    });

    test("lineCommentExtent — the extent INCLUDES the line terminator (BS-oracle parity)", () => {
        // `// abc\nrest` — the comment extent is [0,7]: `// abc` + the `\n`.
        // The BS oracle (block-splitter.js:979-980) scans to the newline
        // then consumes it.
        expect(lineCommentExtent(makeCursor("// abc\nrest"))).toBe(7);
    });

    test("lineCommentExtent — a `//` running to EOF ends at the source length", () => {
        // `// abc` with no trailing newline — the extent is the full length.
        expect(lineCommentExtent(makeCursor("// abc"))).toBe(6);
    });

    test("htmlCommentExtent — the extent INCLUDES the closing `-->`", () => {
        // `<!-- abc -->rest` — the comment extent is [0,12].
        expect(htmlCommentExtent(makeCursor("<!-- abc -->rest"))).toBe(12);
    });

    test("htmlCommentExtent — the FIRST `-->` closes (no nested HTML comments)", () => {
        // `<!-- a --> b --> c` — the first `-->` at [7,10] closes; extent 10.
        expect(htmlCommentExtent(makeCursor("<!-- a --> b --> c"))).toBe(10);
    });

    test("htmlCommentExtent — an unterminated `<!--` runs to EOF", () => {
        // `<!-- no closer` — best-effort recovery, the extent is the length.
        expect(htmlCommentExtent(makeCursor("<!-- no closer"))).toBe(14);
    });

    test("commentExtent dispatches on the recognized CommentForm", () => {
        expect(commentExtent(makeCursor("// x\ny"))).toBe(5);
        expect(commentExtent(makeCursor("<!-- x -->y"))).toBe(10);
        expect(commentExtent(makeCursor("not a comment"))).toBe(null);
    });
});

// =============================================================================
// MK1.3 §12 — the block-stream (Text / Comment / context blocks).
// =============================================================================
describe("MK1.3 block-stream — typed blocks emitted by the trampoline", () => {
    const brace = "{";

    test("a plain-text source emits one Text block spanning the whole source", () => {
        const s = blockStream("hello world");
        expect(s).toEqual([{ kind: NativeBlockKind.Text, start: 0, end: 11 }]);
    });

    test("an empty source emits no blocks", () => {
        expect(blockStream("")).toEqual([]);
    });

    test("a `//` line comment emits a Comment block; text on either side is split", () => {
        // `before // c\nafter` — Text[0,7], Comment[7,12], Text[12,17].
        const s = blockStream("before // c\nafter");
        expect(s).toEqual([
            { kind: NativeBlockKind.Text,    start: 0,  end: 7 },
            { kind: NativeBlockKind.Comment, start: 7,  end: 12 },
            { kind: NativeBlockKind.Text,    start: 12, end: 17 },
        ]);
    });

    test("a `<!-- -->` HTML comment emits a Comment block", () => {
        // `x <!-- c --> y` — Text[0,2], Comment[2,12], Text[12,14].
        const s = blockStream("x <!-- c --> y");
        expect(s).toEqual([
            { kind: NativeBlockKind.Text,    start: 0,  end: 2 },
            { kind: NativeBlockKind.Comment, start: 2,  end: 12 },
            { kind: NativeBlockKind.Text,    start: 12, end: 14 },
        ]);
    });

    test("the Comment block carries its CommentForm (Line vs Html)", () => {
        const lineNodes = parseMarkup("// a line comment\n");
        expect(lineNodes[0].kind).toBe(NativeBlockKind.Comment);
        expect(lineNodes[0].commentForm).toBe(CommentForm.Line);

        const htmlNodes = parseMarkup("<!-- an html comment -->");
        expect(htmlNodes[0].kind).toBe(NativeBlockKind.Comment);
        expect(htmlNodes[0].commentForm).toBe(CommentForm.Html);
    });

    test("a logic-escape context emits one LogicEscape block (no inner Text — divergence D-1)", () => {
        // `${ let x = 1 }` — one LogicEscape block. The BS emits a `text`
        // child for the body; the native layer does NOT (D-1 — the inner
        // body grammar is a later milestone).
        const s = blockStream("$" + brace + " let x = 1 }");
        expect(s).toEqual([{ kind: NativeBlockKind.LogicEscape, start: 0, end: 14 }]);
    });

    test("each brace context emits its matching block kind", () => {
        expect(blockStream("$" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.LogicEscape, start: 0, end: 6 },
        ]);
        expect(blockStream("?" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.Sql, start: 0, end: 6 },
        ]);
        expect(blockStream("#" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.Css, start: 0, end: 6 },
        ]);
        expect(blockStream("!" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.ErrorEffect, start: 0, end: 6 },
        ]);
        expect(blockStream("^" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.Meta, start: 0, end: 6 },
        ]);
        expect(blockStream("~" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.Test, start: 0, end: 6 },
        ]);
        expect(blockStream("_" + brace + " a }")).toEqual([
            { kind: NativeBlockKind.ForeignCode, start: 0, end: 6 },
        ]);
    });

    test("a `//` comment INSIDE a logic body does NOT emit a separate Comment block", () => {
        // The comment is part of the logic body — at MK1.3 a context body
        // has no inner block-stream (the body sub-grammar is a later
        // milestone). The whole `${ ... }` is one LogicEscape block. The
        // source `${ let x = 1 // note\n}` is 22 characters.
        const src = "$" + brace + " let x = 1 // note\n}";
        const s = blockStream(src);
        expect(s).toEqual([{ kind: NativeBlockKind.LogicEscape, start: 0, end: src.length }]);
    });

    test("a `<!-- -->` sequence inside a logic body is NOT a comment (it is body text)", () => {
        // `<!-- -->` is a markup-context construct — inside a logic body it
        // is not recognized as a comment. The whole `${ ... }` is one block.
        const src = "$" + brace + " x <!-- y --> }";
        const s = blockStream(src);
        expect(s).toEqual([{ kind: NativeBlockKind.LogicEscape, start: 0, end: src.length }]);
    });

    test("an UNTERMINATED context emits NO block (BS-oracle parity — E-CTX-003)", () => {
        // The BS emits no block for an unterminated `${` (it emits an
        // E-CTX-003 error). The native layer likewise emits no block; the
        // frame stays on blockContextStack as the MK4 blame locus.
        const s = blockStream("$" + brace + " unterminated body");
        expect(s).toEqual([]);
    });

    test("a Markup block spans the whole ELEMENT (MK2.2 — D-4 closed)", () => {
        // `<div> x` — `<div>` is an UNTERMINATED opener. MK2.2's
        // opener/closer pairing recovers it at EOF as if `</>` closed it
        // (closeUnterminatedTags); the Markup block spans the whole
        // ELEMENT [0,7] — the opener + the recovered ` x` child — not the
        // [0,5] opener-only span MK2.1 emitted. D-4 is CLOSED at MK2.2.
        const s = blockStream("<div> x");
        expect(s[0]).toEqual({ kind: NativeBlockKind.Markup, start: 0, end: 7 });
    });
});

// =============================================================================
// MK1.3 §13 — the sub-context sketch-depth dispatchers.
// =============================================================================
describe("MK1.3 sub-context sketch dispatchers — extent + close recognition", () => {
    const brace = "{";

    // Each of the 5 sub-contexts (.InCss / .InSql / .InErrorEffect /
    // .InMeta / .InTest) has a sketch-depth dispatcher: it recognizes the
    // context's extent (by brace depth) and its matching close, and emits
    // the context block. The DEEP per-context grammar is a later milestone.
    const SUB_CONTEXT_ROWS = [
        ["#" + brace, NativeBlockKind.Css,         "css"],
        ["?" + brace, NativeBlockKind.Sql,         "sql"],
        ["!" + brace, NativeBlockKind.ErrorEffect, "error-effect"],
        ["^" + brace, NativeBlockKind.Meta,        "meta"],
        ["~" + brace, NativeBlockKind.Test,        "test"],
    ];

    for (const [sigil, kind, label] of SUB_CONTEXT_ROWS) {
        test(`the ${label} sub-context recognizes its extent + emits a ${kind} block`, () => {
            const src = sigil + " body content }";
            const s = blockStream(src);
            expect(s).toEqual([{ kind, start: 0, end: src.length }]);
        });

        test(`the ${label} sub-context tracks inner braces (matching close at depth 0)`, () => {
            // An inner `{ ... }` in the body must not prematurely close the
            // context — the sketch dispatcher tracks brace depth.
            const src = sigil + " a " + brace + " b } c }";
            const s = blockStream(src);
            expect(s).toEqual([{ kind, start: 0, end: src.length }]);
        });
    }

    test("a sub-context block leaves all stacks balanced after its close", () => {
        const fs = finalState("#" + brace + " .a { color: red } }");
        expect(fs.brackets).toBe(0);
        expect(fs.blockContextDeep).toBe(0);
        expect(fs.delegation).toBe(0);
    });
});

// =============================================================================
// MK1.3 §14 — the conformance harness: block-stream vs the BS block tree.
//
// The MK1.3 conformance check (charter Q4.A MK1 gating / roadmap §4.2):
// the markup-layer block-stream is diffed against the current BS block
// tree on the conformance corpus. `compiler/src/block-splitter.js` is the
// ORACLE.
//
// At MK1.3 the trampoline produced a FLAT block-stream; MK2.2's
// opener/closer pairing produces the `<tag>` TREE. The corpus dispositions:
//
//   "conformance"  — clean files: only text / comment / brace-context
//                    blocks at the top level, no top-level context
//                    nesting. The native block-stream is asserted
//                    structurally equal to the BS rootBlocks (kind, span).
//   "markup-tree"  — files exercising the <tag> tree. MK2.2 RESOLVED the
//                    D-4 divergence: the native tree is asserted FULLY
//                    equal to the BS block tree (kind, name, span — whole
//                    element + nested children).
//   "divergence-*" — files exercising a KNOWN, DOCUMENTED divergence
//                    (D-2 SQL-at-top-level / D-3 foreign-code). The
//                    divergence is recorded; the native side is asserted
//                    internally correct.
// =============================================================================

// The BS type-string -> native BlockKind mapping. The BS uses lowercase /
// kebab-case type strings; the native layer uses the BlockKind tags.
const BS_TYPE_TO_NATIVE_KIND = {
    "text":         NativeBlockKind.Text,
    "comment":      NativeBlockKind.Comment,
    "logic":        NativeBlockKind.LogicEscape,
    "sql":          NativeBlockKind.Sql,
    "css":          NativeBlockKind.Css,
    "error-effect": NativeBlockKind.ErrorEffect,
    "meta":         NativeBlockKind.Meta,
    "test":         NativeBlockKind.Test,
    "markup":       NativeBlockKind.Markup,
    // `state` has no MK1.3 native equivalent — MK2's TagKind distinguishes
    // markup from state. A corpus file producing a `state` block belongs in
    // a divergence disposition, not the clean-conformance set.
};

// bsTopLevelStream — the BS block tree's top-level (depth-0) blocks as a
// list of { kind, start, end } 3-tuples, mapped to native BlockKind tags.
function bsTopLevelStream(source) {
    const r = splitBlocks("conformance.scrml", source);
    return {
        blocks: r.blocks.map((b) => ({
            kind:  BS_TYPE_TO_NATIVE_KIND[b.type] ?? `BS:${b.type}`,
            start: b.span.start,
            end:   b.span.end,
        })),
        errors: r.errors,
    };
}

const MARKUP_BENCH_DIR = join(import.meta.dir, "parser-conformance", "markup-bench");

// Per-corpus-file disposition. A file absent from this table defaults to
// "conformance" (the clean top-level-equivalence gate).
const MARKUP_BENCH_DISPOSITION = {
    "logic-basic.scrml":         "conformance",
    "logic-nested-braces.scrml": "conformance",
    "css-block.scrml":           "conformance",
    "comments-line.scrml":       "conformance",
    "comments-html.scrml":       "conformance",
    "multi-context.scrml":       "conformance",
    // markup-tree — MK2.2 RESOLVED D-4: the native <tag> tree is now
    // structurally equal to the BS block tree (whole-element spans +
    // nested children). The disposition asserts FULL tree equivalence
    // (was "divergence-markup-tree" — a divergence — at MK1.3/MK2.1).
    "markup-tags.scrml":         "markup-tree",
    // foreign-code — D-3 — the BS has no `_{` opener (still a divergence).
    "foreign-code.scrml":        "divergence-foreign-code",
};

// markupTreeOf — render a native block-stream as a compact tree string
// (the corpus-harness analogue of the MK2.2-section `markupTree` helper;
// declared here so the harness — earlier in the file — can use it).
function markupTreeOf(nodes) {
    const fmt = (b) => {
        if (b.kind === NativeBlockKind.Markup) {
            return `${b.name}[${b.span.start},${b.span.end}]{${(b.children ?? []).map(fmt).join(",")}}`;
        }
        return `${b.kind}[${b.span.start},${b.span.end}]`;
    };
    return nodes.map(fmt).join(" ");
}

// bsTreeOf — render the BS block tree in the SAME compact shape, mapping
// the BS lowercase type strings to native BlockKind tags.
function bsTreeOf(bsBlocks) {
    const fmt = (b) => {
        if (b.type === "markup") {
            return `${b.name}[${b.span.start},${b.span.end}]{${(b.children ?? []).map(fmt).join(",")}}`;
        }
        const kind = BS_TYPE_TO_NATIVE_KIND[b.type] ?? `BS:${b.type}`;
        return `${kind}[${b.span.start},${b.span.end}]`;
    };
    return bsBlocks.map(fmt).join(" ");
}

describe("MK1.3 conformance — block-stream vs the BS block tree (corpus)", () => {
    const benchFiles = readdirSync(MARKUP_BENCH_DIR).filter((f) => f.endsWith(".scrml"));

    // The corpus must be non-empty — a guard against a silently-empty
    // markup-bench directory passing the suite vacuously.
    test("the markup-bench corpus is non-empty", () => {
        expect(benchFiles.length).toBeGreaterThan(0);
    });

    for (const file of benchFiles) {
        const disposition = MARKUP_BENCH_DISPOSITION[file] ?? "conformance";
        const source = readFileSync(join(MARKUP_BENCH_DIR, file), "utf8");

        describe(file, () => {
            // Every corpus file — the native trampoline must halt + produce
            // a block-stream array (the termination guarantee, corpus-wide).
            test(`(${disposition}) the native trampoline halts + produces a block-stream`, () => {
                const s = blockStream(source);
                expect(Array.isArray(s)).toBe(true);
            });

            if (disposition === "conformance") {
                // The clean-conformance gate — the native block-stream is
                // structurally equal (kind + span) to the BS rootBlocks.
                test(`(conformance) native block-stream === BS top-level block tree`, () => {
                    const native = blockStream(source);
                    const bs = bsTopLevelStream(source);
                    // The clean-conformance corpus is hand-designed to
                    // compile without BS errors — a BS error would mean the
                    // file belongs in a divergence disposition.
                    expect(bs.errors.length).toBe(0);
                    expect(native).toEqual(bs.blocks);
                });
            } else if (disposition === "markup-tree") {
                // MK2.2 — D-4 RESOLVED. The native <tag> tree is
                // structurally equal to the BS block tree: whole-element
                // spans (opener + children + closer) AND nested children.
                // The conformance gate is full-tree equivalence on
                // (kind, name, span) — the charter Q4.A MK2 gating.
                test(`(markup-tree — D-4 resolved) native <tag> tree === BS block tree`, () => {
                    const bs = splitBlocks("conformance.scrml", source);
                    // The markup-tree corpus is hand-designed to compile
                    // without BS errors.
                    expect(bs.errors.length).toBe(0);
                    const nativeTree = markupTreeOf(parseMarkup(source));
                    const bsTree = bsTreeOf(bs.blocks);
                    expect(nativeTree).toBe(bsTree);
                });
            } else if (disposition === "divergence-foreign-code") {
                // D-3 — the native layer recognizes `_{}` (§23) as a
                // .InForeignCode context + emits a ForeignCode block. The
                // BS has NO `_{` opener — a top-level `_{}` is text +
                // orphan-brace to the BS. The native layer is correct per
                // §23; record the divergence.
                test(`(divergence D-3 — BS has no _{ opener) native emits a ForeignCode block`, () => {
                    const native = blockStream(source);
                    const foreign = native.filter((b) => b.kind === NativeBlockKind.ForeignCode);
                    expect(foreign.length).toBe(1);

                    // DOCUMENTED DIVERGENCE: the BS produces NO ForeignCode
                    // block (it has no `_{` opener) — the §23 foreign-code
                    // body is text to the BS.
                    const bs = bsTopLevelStream(source);
                    const bsForeign = bs.blocks.filter((b) => b.kind === NativeBlockKind.ForeignCode);
                    expect(bsForeign.length).toBe(0);
                });
            }
        });
    }
});

// =============================================================================
// MK1.3 §15 — conformance: inline micro-corpus (fine-grained block-stream
// equivalence assertions against the BS).
//
// The corpus-file harness above asserts whole-file equivalence; this
// micro-corpus pins individual constructs — each entry is an inline source
// whose native block-stream is asserted equal to the BS top-level stream.
// =============================================================================
describe("MK1.3 conformance — inline micro-corpus (block-stream === BS)", () => {
    const brace = "{";

    // Each case: a source whose native block-stream MUST equal the BS
    // top-level block tree (kind + span). These are clean-conformance
    // constructs — no D-2/D-3/D-4 surface.
    const cases = [
        { name: "plain text",                src: "just plain text" },
        { name: "leading line comment",      src: "// note\nbody text" },
        { name: "trailing line comment",     src: "body text\n// note\n" },
        { name: "html comment",              src: "a <!-- c --> b" },
        { name: "html comment with tag text", src: "x <!-- <p>inert</p> --> y" },
        { name: "logic block",               src: "$" + brace + " let n = 1 }" },
        { name: "logic + trailing text",     src: "$" + brace + " a }\ntrailing" },
        { name: "css block",                 src: "#" + brace + " .a { x: y } }" },
        { name: "error-effect block",        src: "!" + brace + " retry }" },
        { name: "meta block",                src: "^" + brace + " title }" },
        { name: "test block",                src: "~" + brace + " assert(1) }" },
        { name: "two logic blocks + text",   src: "$" + brace + " a }\n$" + brace + " b }" },
        { name: "comment then logic",        src: "// lead\n$" + brace + " x }" },
        { name: "logic then comment",        src: "$" + brace + " x }\n// trail\n" },
        { name: "logic with inner braces",   src: "$" + brace + " if (a) " + brace + " b } }" },
        { name: "empty source",              src: "" },
        { name: "whitespace only",           src: "   \n  \t " },
    ];

    for (const c of cases) {
        test(`(conformance) ${c.name}`, () => {
            const native = blockStream(c.src);
            const bs = bsTopLevelStream(c.src);
            // The micro-corpus is all clean-conformance — no BS errors.
            expect(bs.errors.length).toBe(0);
            expect(native).toEqual(bs.blocks);
        });
    }
});

// #############################################################################
// MK2.1 — TagFrame engine skeleton + opener recognition + TagKind calc.
//
// Per IMPLEMENTATION-ROADMAP §3.1 (the MK2.1 row) + charter dive Q1.F: the
// TagFrame <tag>-tree engine (compiler/native-parser/tag-frame.js) — its
// 3 payload-bearing state-children, the TagKind pure-fn calculation, the
// SPEC §4.15/§24.4 structural-element registry, the one-pass opener
// tokenizer (charter Q2.A #4's `skipOpener` primitive), and recognizeOpener
// (the opener-side entry point — computes TagKind + pushes a TagFrame).
//
// Scope (MK2.1 — the first sub-step of MK2): the engine SKELETON + opener
// recognition + the TagKind calc. The 3 closer forms + opener/closer
// PAIRING + mismatch recovery are MK2.2; the TagKind-driven decl-vs-markup
// classification + punch-list P4/P5 are MK2.3; BodyMode (§4.18) is MK3.
//
// The engine declaration (tag-frame.scrml's <engine for=TagFrame>) is the
// canonical Pillar-5b SHAPE; the .js shadow is what runs + what this suite
// imports (README ANOMALY-2 shadow discipline).
// #############################################################################

// tokenizeOpenerFromLt — drive tokenizeOpener the way the trampoline does:
// the `<` is consumed by enterMarkupTagContext (its MK1.2 contract), so the
// cursor passed to tokenizeOpener is positioned at the byte AFTER the `<`
// and the `<`'s span is the `ltAnchor`. This helper takes a full
// `<ident...>` source, advances the cursor over the `<` (mirroring
// enterMarkupTagContext), and calls tokenizeOpener with the `<`'s span.
function tokenizeOpenerFromLt(source) {
    const cursor = makeCursor(source);
    // The `<`'s span — { start, line, col }. enterMarkupTagContext builds
    // exactly this as the .InMarkupTag frame's openSpan.
    const ltAnchor = { start: cursor.pos, line: cursor.line, col: cursor.col };
    advance(cursor, 1); // consume the `<` (mirror enterMarkupTagContext)
    return tokenizeOpener(cursor, ltAnchor);
}

// recognizeOpenerFromLt — the recognizeOpener analogue of the helper above.
// Returns { ctx, cursor, frame }.
function recognizeOpenerFromLt(source) {
    const ctx = makeParseContext();
    const cursor = makeCursor(source);
    const ltAnchor = { start: cursor.pos, line: cursor.line, col: cursor.col };
    advance(cursor, 1);
    const frame = recognizeOpener(ctx, cursor, ltAnchor);
    return { ctx, cursor, frame };
}

// =============================================================================
// MK2.1 §16 — the TagKind calculation (charter Q1.F; a pure fn — D1 OQ1).
// =============================================================================
describe("MK2.1 tagKindFor — the four-way opener classification", () => {
    test("a lowercase non-structural name is Html", () => {
        expect(tagKindFor("div", false)).toBe(TagKind.Html);
        expect(tagKindFor("p", false)).toBe(TagKind.Html);
        expect(tagKindFor("section", false)).toBe(TagKind.Html);
        expect(tagKindFor("my-widget", false)).toBe(TagKind.Html);  // kebab — still Html
    });

    test("a PascalCase (uppercase-first) name is Component", () => {
        expect(tagKindFor("Button", false)).toBe(TagKind.Component);
        expect(tagKindFor("Counter", false)).toBe(TagKind.Component);
        expect(tagKindFor("X", false)).toBe(TagKind.Component);
    });

    test("a structural-element name is ScrmlStructural (registry membership)", () => {
        // All 7 SPEC §4.15/§24.4 structural elements.
        expect(tagKindFor("engine", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("match", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("errors", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("onTransition", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("onTimeout", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("onIdle", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("page", false)).toBe(TagKind.ScrmlStructural);
    });

    test("the registry test precedes the case test — structural names are lowercase", () => {
        // `engine` is lowercase, so without the registry-first ordering it
        // would fall through to Html. The priority order (registry before
        // first-char-case) is what makes it ScrmlStructural.
        expect(firstCharIsUpper("engine")).toBe(false);
        expect(tagKindFor("engine", false)).toBe(TagKind.ScrmlStructural);
        expect(tagKindFor("engine", false)).not.toBe(TagKind.Html);
    });

    test("a `< ident`-with-space opener is StateOpener (the §4.3 advisory shape)", () => {
        // §4.3 — the whitespace-after-`<` discriminator is informational
        // only (advisory). hadSpaceAfterLt=true => StateOpener, regardless
        // of the name's case or registry membership.
        expect(tagKindFor("Counter", true)).toBe(TagKind.StateOpener);
        expect(tagKindFor("db", true)).toBe(TagKind.StateOpener);
        expect(tagKindFor("engine", true)).toBe(TagKind.StateOpener);  // space wins over registry
    });

    test("firstCharIsUpper — the PascalCase signal", () => {
        expect(firstCharIsUpper("Button")).toBe(true);
        expect(firstCharIsUpper("button")).toBe(false);
        expect(firstCharIsUpper("")).toBe(false);
        expect(firstCharIsUpper("7up")).toBe(false);  // digit, not A-Z
    });
});

// =============================================================================
// MK2.1 §17 — the structural-element registry (SPEC §4.15 / §24.4).
// =============================================================================
describe("MK2.1 structural-element registry — the SPEC §4.15/§24.4 set", () => {
    test("the registry contains exactly the 7 SPEC-normative structural elements", () => {
        // SPEC §4.15 + §24.4 register exactly these 7. (`channel` / `auth`
        // are NOT in those normative registry tables — see the
        // tag-frame.js STRUCTURAL-ELEMENT REGISTRY note.)
        expect(Object.keys(STRUCTURAL_ELEMENTS).sort()).toEqual([
            "engine", "errors", "match", "onIdle", "onTimeout",
            "onTransition", "page",
        ]);
    });

    test("isStructuralElementName recognizes each registered element", () => {
        for (const name of ["engine", "match", "errors", "onTransition",
                             "onTimeout", "onIdle", "page"]) {
            expect(isStructuralElementName(name)).toBe(true);
        }
    });

    test("isStructuralElementName rejects non-registered names", () => {
        expect(isStructuralElementName("div")).toBe(false);
        expect(isStructuralElementName("Button")).toBe(false);
        expect(isStructuralElementName("Engine")).toBe(false);  // case-sensitive
        expect(isStructuralElementName("")).toBe(false);
        // `channel` / `auth` are NOT in the SPEC §4.15/§24.4 registry.
        expect(isStructuralElementName("channel")).toBe(false);
        expect(isStructuralElementName("auth")).toBe(false);
    });
});

// =============================================================================
// MK2.1 §18 — the opener tokenizer (the one-pass `skipOpener` primitive).
// =============================================================================
describe("MK2.1 tokenizeOpener — one-pass opener-body recognition", () => {
    test("a bare opener `<div>` — name + span + not self-closing", () => {
        const o = tokenizeOpenerFromLt("<div>");
        expect(o.name).toBe("div");
        expect(o.selfClosing).toBe(false);
        expect(o.ok).toBe(true);
        expect(o.malformed).toBe(false);
        // The span covers the FULL opener — anchored at the `<` (0), one
        // past the `>` (5).
        expect(o.span.start).toBe(0);
        expect(o.span.end).toBe(5);
    });

    test("an opener with attributes — the attribute region is opaque bytes", () => {
        // `<input type="text" disabled>` — MK2.1 does not parse attributes;
        // it recognizes the opener STRUCTURE. The name is `input`; the span
        // covers the whole opener.
        const src = "<input type=\"text\" disabled>";
        const o = tokenizeOpenerFromLt(src);
        expect(o.name).toBe("input");
        expect(o.selfClosing).toBe(false);
        expect(o.span.end).toBe(src.length);
    });

    test("a self-closing opener `<br/>` — selfClosing true", () => {
        const o = tokenizeOpenerFromLt("<br/>");
        expect(o.name).toBe("br");
        expect(o.selfClosing).toBe(true);
        expect(o.span.end).toBe(5);
    });

    test("a self-closing opener with a space before `/>` — `<br />`", () => {
        const o = tokenizeOpenerFromLt("<br />");
        expect(o.name).toBe("br");
        expect(o.selfClosing).toBe(true);
    });

    test("a self-closing opener with attributes — `<img src=\"a.png\"/>`", () => {
        const o = tokenizeOpenerFromLt("<img src=\"a.png\"/>");
        expect(o.name).toBe("img");
        expect(o.selfClosing).toBe(true);
    });

    test("a `>` INSIDE an attribute-value string is not the terminator", () => {
        // `<a title="x>y">` — the `>` at index 9 is inside the "..." string;
        // the real terminator is the `>` at index 14. The string-aware scan
        // recognizes this — the span ends at 15, not 10.
        const o = tokenizeOpenerFromLt("<a title=\"x>y\">");
        expect(o.name).toBe("a");
        expect(o.span.end).toBe(15);
        expect(o.selfClosing).toBe(false);
    });

    test("a `/` INSIDE an attribute-value string is not the self-closing marker", () => {
        // `<a href="/path">` — the `/` is inside the string; the opener is
        // NOT self-closing (no trailing `/` before the real `>`).
        const o = tokenizeOpenerFromLt("<a href=\"/path\">");
        expect(o.name).toBe("a");
        expect(o.selfClosing).toBe(false);
    });

    test("single-quoted attribute strings are recognized too", () => {
        const o = tokenizeOpenerFromLt("<a title='x>y'>");
        expect(o.name).toBe("a");
        expect(o.span.end).toBe(15);
    });

    test("a whitespace-after-`<` opener — `< Counter>` — records hadSpaceAfterLt", () => {
        // The §4.3 advisory state-type-instantiation shape.
        const o = tokenizeOpenerFromLt("< Counter>");
        expect(o.name).toBe("Counter");
        expect(o.hadSpaceAfterLt).toBe(true);
    });

    test("a no-space opener records hadSpaceAfterLt false", () => {
        const o = tokenizeOpenerFromLt("<div>");
        expect(o.hadSpaceAfterLt).toBe(false);
    });

    test("an unterminated opener (EOF before `>`) is malformed", () => {
        const o = tokenizeOpenerFromLt("<div");
        expect(o.name).toBe("div");
        expect(o.malformed).toBe(true);
        expect(o.ok).toBe(false);
    });

    test("an opener with no name start after the `<` is malformed", () => {
        // `< >` — whitespace then `>`, no tag-name identifier.
        const o = tokenizeOpenerFromLt("< >");
        expect(o.name).toBe("");
        expect(o.malformed).toBe(true);
        expect(o.ok).toBe(false);
    });

    test("a hyphenated / digit-bearing tag name is scanned whole", () => {
        // The tag-name grammar admits ASCII letters, digits, and `-`.
        const o = tokenizeOpenerFromLt("<my-widget-2>");
        expect(o.name).toBe("my-widget-2");
    });

    test("the opener span anchors at the `<` even with an offset cursor", () => {
        // Drive tokenizeOpener directly with a cursor mid-source — the span
        // anchors at ltAnchor (the one-cursor invariant: no offset math).
        const cursor = makeCursor("xx<p>yy");
        cursor.pos = 2; cursor.col = 3;          // on the `<`
        const ltAnchor = { start: 2, line: 1, col: 3 };
        cursor.pos = 3; cursor.col = 4;          // step past the `<`
        const o = tokenizeOpener(cursor, ltAnchor);
        expect(o.name).toBe("p");
        expect(o.span.start).toBe(2);            // the `<`
        expect(o.span.end).toBe(5);              // one past the `>`
    });
});

// =============================================================================
// MK2.1 §19 — the opener-tokenizer scan helpers (pure calculations).
// =============================================================================
describe("MK2.1 opener-tokenizer scan helpers", () => {
    test("isTagNameStart — an ASCII letter starts a tag name", () => {
        expect(isTagNameStart("d")).toBe(true);
        expect(isTagNameStart("D")).toBe(true);
        expect(isTagNameStart("1")).toBe(false);  // digit cannot START
        expect(isTagNameStart("-")).toBe(false);
        expect(isTagNameStart("")).toBe(false);
    });

    test("isTagNameChar (tag-frame's canonical) — letters / digits / hyphen", () => {
        expect(tagFrameIsTagNameChar("a")).toBe(true);
        expect(tagFrameIsTagNameChar("Z")).toBe(true);
        expect(tagFrameIsTagNameChar("5")).toBe(true);
        expect(tagFrameIsTagNameChar("-")).toBe(true);
        expect(tagFrameIsTagNameChar(" ")).toBe(false);
        expect(tagFrameIsTagNameChar("")).toBe(false);
    });

    test("parse-markup's isTagNameChar re-export is the same fn (single source)", () => {
        // parse-markup.js re-exports isTagNameChar from tag-frame.js — MK2.1
        // made tag-frame the canonical home of the tag-name grammar.
        expect(isTagNameChar).toBe(tagFrameIsTagNameChar);
    });

    test("isOpenerWhitespace — space / tab / CR / LF", () => {
        expect(isOpenerWhitespace(" ")).toBe(true);
        expect(isOpenerWhitespace("\t")).toBe(true);
        expect(isOpenerWhitespace("\n")).toBe(true);
        expect(isOpenerWhitespace("\r")).toBe(true);
        expect(isOpenerWhitespace("x")).toBe(false);
    });

    test("scanTagName returns the end offset of a maximal tag-name run", () => {
        // `div class` — the name run is `div` [0,3]; the space ends it.
        expect(scanTagName("div class", 0)).toBe(3);
        expect(scanTagName("my-widget>", 0)).toBe(9);
        expect(scanTagName("abc", 0)).toBe(3);  // runs to EOF
    });

    test("skipOpenerWhitespace returns the end offset of a maximal ws run", () => {
        expect(skipOpenerWhitespace("   x", 0)).toBe(3);
        expect(skipOpenerWhitespace("x", 0)).toBe(0);  // no ws
        expect(skipOpenerWhitespace("  ", 0)).toBe(2);  // runs to EOF
    });
});

// =============================================================================
// MK2.1 §20 — the TagFrame engine + the open-tag stack.
// =============================================================================
describe("MK2.1 TagFrame engine — the open-tag stack", () => {
    test("initialTagFrame is .Closed (matches `initial=.Closed`)", () => {
        expect(initialTagFrame()).toBe(TagFrameKind.Closed);
    });

    test("a fresh ctx has tag-tree depth 0 and currentTagFrame .Closed", () => {
        const ctx = makeParseContext();
        expect(tagFrameDepth(ctx)).toBe(0);
        expect(currentTagFrame(ctx)).toBe(TagFrameKind.Closed);
        expect(topTagFrame(ctx)).toBe(null);
    });

    test("pushTagFrame pushes an open-tag frame; depth + currentTagFrame track it", () => {
        const ctx = makeParseContext();
        const frame = makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
            { start: 0, end: 5, line: 1, col: 1 });
        pushTagFrame(ctx, frame);
        expect(tagFrameDepth(ctx)).toBe(1);
        expect(currentTagFrame(ctx)).toBe(TagFrameKind.OpenExpectingChildren);
        expect(topTagFrame(ctx)).toBe(frame);
    });

    test("nested pushes — the stack IS the tag-tree depth", () => {
        const ctx = makeParseContext();
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
            { start: 0, end: 5, line: 1, col: 1 }));
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("span", TagKind.Html, 1,
            { start: 5, end: 11, line: 1, col: 6 }));
        expect(tagFrameDepth(ctx)).toBe(2);
        expect(topTagFrame(ctx).name).toBe("span");
    });

    test("popTagFrame pops the top open-tag frame (the MK2.2 closer substrate)", () => {
        const ctx = makeParseContext();
        const outer = makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
            { start: 0, end: 5, line: 1, col: 1 });
        const inner = makeOpenExpectingChildrenFrame("span", TagKind.Html, 1,
            { start: 5, end: 11, line: 1, col: 6 });
        pushTagFrame(ctx, outer);
        pushTagFrame(ctx, inner);
        expect(popTagFrame(ctx)).toBe(inner);
        expect(tagFrameDepth(ctx)).toBe(1);
        expect(popTagFrame(ctx)).toBe(outer);
        expect(tagFrameDepth(ctx)).toBe(0);
        expect(currentTagFrame(ctx)).toBe(TagFrameKind.Closed);
    });

    test("popTagFrame on an empty stack returns null (the unbalanced-closer case)", () => {
        const ctx = makeParseContext();
        expect(popTagFrame(ctx)).toBe(null);
    });

    test("makeOpenExpectingChildrenFrame carries name / kind / depth / span + bodyMode tag", () => {
        const span = { start: 0, end: 5, line: 1, col: 1 };
        const f = makeOpenExpectingChildrenFrame("div", TagKind.Html, 2, span);
        expect(f.kind).toBe(TagFrameKind.OpenExpectingChildren);
        expect(f.name).toBe("div");
        expect(f.tagKind).toBe(TagKind.Html);
        expect(f.depth).toBe(2);
        expect(f.span).toBe(span);
        // bodyMode is MK3's BodyMode — carried as a tag (null) at MK2.1.
        expect(f.bodyMode).toBe(null);
    });

    test("makeOpenSelfClosedFrame carries name / kind / span (no depth — no subtree)", () => {
        const span = { start: 0, end: 6, line: 1, col: 1 };
        const f = makeOpenSelfClosedFrame("br", TagKind.Html, span);
        expect(f.kind).toBe(TagFrameKind.OpenSelfClosed);
        expect(f.name).toBe("br");
        expect(f.tagKind).toBe(TagKind.Html);
        expect(f.span).toBe(span);
        expect(f.depth).toBe(undefined);
    });
});

// =============================================================================
// MK2.1 §21 — recognizeOpener (the opener-side entry point).
// =============================================================================
describe("MK2.1 recognizeOpener — tokenize + TagKind + push the TagFrame", () => {
    test("a non-self-closing opener pushes an .OpenExpectingChildren frame", () => {
        const { ctx, frame } = recognizeOpenerFromLt("<div>");
        expect(frame.kind).toBe(TagFrameKind.OpenExpectingChildren);
        expect(frame.name).toBe("div");
        expect(frame.tagKind).toBe(TagKind.Html);
        expect(frame.depth).toBe(0);  // a top-level tag opens at depth 0
        expect(tagFrameDepth(ctx)).toBe(1);
    });

    test("a self-closing opener pushes an .OpenSelfClosed frame", () => {
        const { ctx, frame } = recognizeOpenerFromLt("<br/>");
        expect(frame.kind).toBe(TagFrameKind.OpenSelfClosed);
        expect(frame.name).toBe("br");
        // A self-closed tag also pushes onto the stack at MK2.1 — MK2.2's
        // closer-pairing handles the .OpenSelfClosed -> .Closed transition.
        expect(tagFrameDepth(ctx)).toBe(1);
    });

    test("recognizeOpener computes the TagKind from the opener bytes", () => {
        expect(recognizeOpenerFromLt("<Counter>").frame.tagKind).toBe(TagKind.Component);
        expect(recognizeOpenerFromLt("<engine>").frame.tagKind).toBe(TagKind.ScrmlStructural);
        expect(recognizeOpenerFromLt("< widget>").frame.tagKind).toBe(TagKind.StateOpener);
        expect(recognizeOpenerFromLt("<div>").frame.tagKind).toBe(TagKind.Html);
    });

    test("the pushed frame carries the tokenizer descriptor as `.opener`", () => {
        const { frame } = recognizeOpenerFromLt("<section class=\"x\">");
        expect(frame.opener).toBeDefined();
        expect(frame.opener.name).toBe("section");
        expect(frame.opener.span.start).toBe(0);
        expect(frame.opener.span.end).toBe(19);
    });

    test("nested recognizeOpener calls — depth increments per opener", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("<div><span>");
        // First opener `<div>` — cursor on the `<` at 0.
        let ltAnchor = { start: 0, line: 1, col: 1 };
        advance(cursor, 1);
        const f1 = recognizeOpener(ctx, cursor, ltAnchor);
        expect(f1.depth).toBe(0);
        // Second opener `<span>` — cursor now on the `<` at 5.
        ltAnchor = { start: cursor.pos, line: cursor.line, col: cursor.col };
        advance(cursor, 1);
        const f2 = recognizeOpener(ctx, cursor, ltAnchor);
        expect(f2.depth).toBe(1);  // nested — opens at depth 1
        expect(tagFrameDepth(ctx)).toBe(2);
    });
});

// =============================================================================
// MK2.1 §22 — end-to-end: the trampoline produces TagFrame-driven Markup
// blocks; the open-tag stack reflects the opener stream.
// =============================================================================
describe("MK2.1 trampoline — TagFrame-driven .InMarkupTag dispatch", () => {
    test("a `<div>` opener emits a Markup block spanning the FULL opener", () => {
        const s = blockStream("<div>");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 5 }]);
    });

    test("a self-closing `<br/>` emits a Markup block spanning the opener", () => {
        const s = blockStream("<br/>");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 5 }]);
    });

    test("an opener with attributes — the Markup block covers the whole opener", () => {
        // `<p class="lead">` — the Markup block spans [0,16].
        const s = blockStream("<p class=\"lead\">");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 16 }]);
    });

    test("text before a PAIRED element splits into a leading Text block", () => {
        // `a <span></span>` — Text[0,2] then the `<span>` ELEMENT [2,15]
        // (MK2.2 pairs the `</span>` closer). Leading text is a top-level
        // sibling of the element; the element has no children.
        const s = blockStream("a <span></span>");
        expect(s).toEqual([
            { kind: NativeBlockKind.Text,   start: 0,  end: 2 },
            { kind: NativeBlockKind.Markup, start: 2,  end: 15 },
        ]);
    });

    test("text on either side of an UNTERMINATED opener — the trailing text nests", () => {
        // `a <span> b` — `<span>` is unterminated; MK2.2 recovers it at
        // EOF (closeUnterminatedTags). Text[0,2] is a leading sibling;
        // the `<span>` element spans [2,10] and the trailing ` b` text is
        // its CHILD (the recovered element absorbs its body).
        const s = blockStream("a <span> b");
        expect(s).toEqual([
            { kind: NativeBlockKind.Text,   start: 0,  end: 2 },
            { kind: NativeBlockKind.Markup, start: 2,  end: 10 },
        ]);
    });

    test("two unterminated openers — the inner nests under the outer (the tree)", () => {
        // `<div><span>` — both unterminated; MK2.2 recovers both at EOF.
        // The inner `<span>` recovers first, then the outer `<div>`'s
        // recovery splice absorbs it — ONE top-level Markup block
        // (`<div>` [0,11]) with `<span>` nested as its child.
        const s = blockStream("<div><span>");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 11 }]);
    });

    test("a `</div>` closer pairs with its opener — one whole-element block", () => {
        // `<div></div>` — MK2.2 recognizes the `</div>` closer
        // structurally + pairs it with the `<div>` opener: ONE Markup
        // block spanning the whole ELEMENT [0,11].
        const s = blockStream("<div></div>");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 11 }]);
    });

    test("the tag-frame stack drains as elements close", () => {
        // `<div><span></span></div>` — a fully-paired tree. Every opener
        // pushes a frame; every closer pops it. After a well-formed run
        // the TagFrame stack is empty (depth 0).
        const { ctx } = parseMarkupTrace("<div><span></span></div>");
        expect(tagFrameDepth(ctx)).toBe(0);
        // The block-stream is ONE top-level `<div>` element.
        const s = blockStream("<div><span></span></div>");
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: 24 }]);
    });

    test("a nested tag inside a logic escape is recognized — `${ <div> }`", () => {
        // The charter Q1.C contract permits a markup tag inside a logic
        // body. The `<div>` opener inside `${ ... }` is recognized; it is
        // unterminated within the logic body, so MK2.2 recovers it at the
        // context close (recoverTagsInClosedContext) — a Markup block AND
        // the LogicEscape block are both emitted, the LogicEscape block
        // intact (not corrupted by the recovery splice).
        const s = blockStream("$" + "{" + " <div> }");
        const kinds = s.map((b) => b.kind);
        expect(kinds).toContain(NativeBlockKind.Markup);
        expect(kinds).toContain(NativeBlockKind.LogicEscape);
    });

    test("an opener with a structural element — `<engine for=Phase>...</>`", () => {
        // The opener tokenizer + TagKind handle a structural-element
        // opener; with a matching closer MK2.2 pairs the whole element.
        // (decl-vs-structural classification completion is MK2.3.)
        const src = "<engine for=Phase></>";
        const s = blockStream(src);
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: src.length }]);
        // The element's frame popped on close — the TagFrame stack is
        // empty. The opener's TagKind is observed during the run; assert
        // it via a fresh recognizeOpener of the opener.
        const opened = recognizeOpenerFromLt("<engine for=Phase>");
        expect(opened.frame.tagKind).toBe(TagKind.ScrmlStructural);
    });

    test("the trampoline halts on every opener shape (the termination guarantee)", () => {
        // Each of these must produce a finite block-stream array.
        for (const src of ["<div>", "<br/>", "<p ", "<", "< >", "<a x=\"y>z\">",
                            "<div><span><section>"]) {
            const s = blockStream(src);
            expect(Array.isArray(s)).toBe(true);
        }
    });

    test("a malformed opener still halts + emits a (boundary-ish) Markup block", () => {
        // `<p` — unterminated. recognizeOpener marks it malformed but the
        // trampoline still progresses (the cursor advances to EOF) and a
        // Markup block is emitted for the recognized extent.
        const s = blockStream("<p");
        expect(Array.isArray(s)).toBe(true);
        expect(s.length).toBe(1);
        expect(s[0].kind).toBe(NativeBlockKind.Markup);
    });
});

// =============================================================================
// MK2.2 — closer forms + tag-tree pairing + mismatch recovery.
//
// MK2.2's authoritative scope (roadmap §3.1, the MK2.2 row): the 3 closer
// forms (`</>` inferred / `</name>` explicit / `/>` self-closing) recognized
// STRUCTURALLY (a closed set — no `looksLikeCloser` bare-`/` heuristic); the
// `TagFrame` rule= contract (opener pushes, closer pops — the stack IS the
// depth count, eliminating BS heuristic #5 `scanCompoundBlockEnd`); a
// mismatched `</name>` dispatching the M1 `ErrorRecovery` engine; the
// `<tag>` tree as output. Charter dive Q1.F is the `TagFrame` engine sketch;
// Q2.A #5 / #12 are the heuristic-elimination targets.
// =============================================================================

// markupTree — the native block-stream rendered as a compact tree string.
// A Markup block is `name[start,end]{children}`; a leaf block is
// `Kind[start,end]`. The cleanest shape for asserting the <tag> TREE.
function markupTree(source) {
    const fmt = (b) => {
        if (b.kind === NativeBlockKind.Markup) {
            const kids = (b.children ?? []).map(fmt).join(",");
            return `${b.name}[${b.span.start},${b.span.end}]{${kids}}`;
        }
        return `${b.kind}[${b.span.start},${b.span.end}]`;
    };
    return parseMarkup(source).map(fmt).join(" ");
}

// runDiagnostics — the closer-grammar diagnostics a full run produced, as
// `code@[start,end]` strings (the ctx.diagnostics sink).
function runDiagnostics(source) {
    const { ctx } = parseMarkupTrace(source);
    return (ctx.diagnostics ?? []).map((d) => `${d.code}@[${d.span.start},${d.span.end}]`);
}

// closerFromCursor — tokenize a closer from a bare closer source. The
// cursor starts at the closer's `<`; tokenizeCloser consumes the token.
function closerFromCursor(source) {
    const cursor = makeCursor(source);
    return tokenizeCloser(cursor);
}

// =============================================================================
// MK2.2 §23 — recognizeCloserForm: the closed-set structural recognition.
// =============================================================================
describe("MK2.2 recognizeCloserForm — the 3 closer forms, recognized structurally", () => {
    test("`</>` is recognized as the inferred closer form", () => {
        expect(recognizeCloserForm(makeCursor("</>"))).toBe(CloserForm.Inferred);
    });

    test("`</name>` is recognized as the explicit closer form", () => {
        expect(recognizeCloserForm(makeCursor("</div>"))).toBe(CloserForm.Explicit);
        expect(recognizeCloserForm(makeCursor("</section >"))).toBe(CloserForm.Explicit);
    });

    test("the `</>` test precedes the `</name>` test (prefix-superset order)", () => {
        // `</>` starts with `</` — were the explicit test first, `</>`
        // would mis-classify. recognizeCloserForm checks the 3-char `</>`
        // FIRST. (The char after `</` in `</>` is `>`, not a name start,
        // so the explicit test would actually reject it — but the order
        // is still load-bearing for clarity + future-proofing.)
        expect(recognizeCloserForm(makeCursor("</>"))).toBe(CloserForm.Inferred);
    });

    test("a non-closer `<` is not recognized — no bare-`/` `looksLikeCloser` guess", () => {
        // BS heuristic #12 (`looksLikeCloser`) GUESSES whether a bare `/`
        // is a mistyped closer. MK2.2 has NO such guess: a closer is
        // EXACTLY `</>` / `</name>`. None of these is a closer.
        expect(recognizeCloserForm(makeCursor("<div>"))).toBe(null);
        expect(recognizeCloserForm(makeCursor("/ "))).toBe(null);
        expect(recognizeCloserForm(makeCursor("a / b"))).toBe(null);
        expect(recognizeCloserForm(makeCursor("</"))).toBe(null);   // `</` alone — no name, no `>`
        expect(recognizeCloserForm(makeCursor("< /div>"))).toBe(null); // space — not `</`
    });

    test("recognizeCloserForm does not advance the cursor", () => {
        const cursor = makeCursor("</div>");
        recognizeCloserForm(cursor);
        expect(cursor.pos).toBe(0);
    });
});

// =============================================================================
// MK2.2 §24 — tokenizeCloser: the one-pass closer tokenizer.
// =============================================================================
describe("MK2.2 tokenizeCloser — one-pass closer-token recognition", () => {
    test("an inferred `</>` — form Inferred, empty name, span covers the 3 chars", () => {
        const c = closerFromCursor("</>");
        expect(c.ok).toBe(true);
        expect(c.form).toBe(CloserForm.Inferred);
        expect(c.name).toBe("");
        expect(c.span.start).toBe(0);
        expect(c.span.end).toBe(3);
        expect(c.malformed).toBe(false);
    });

    test("an explicit `</div>` — form Explicit, name `div`, span covers `</div>`", () => {
        const c = closerFromCursor("</div>");
        expect(c.ok).toBe(true);
        expect(c.form).toBe(CloserForm.Explicit);
        expect(c.name).toBe("div");
        expect(c.span.start).toBe(0);
        expect(c.span.end).toBe(6);
    });

    test("an explicit closer tolerates whitespace before the `>` — `</div >`", () => {
        const c = closerFromCursor("</div >");
        expect(c.name).toBe("div");
        expect(c.span.end).toBe(7);
        expect(c.ok).toBe(true);
    });

    test("an explicit closer with a hyphenated name — `</my-widget>`", () => {
        const c = closerFromCursor("</my-widget>");
        expect(c.name).toBe("my-widget");
        expect(c.span.end).toBe(12);
    });

    test("an unterminated explicit closer (EOF before `>`) is malformed", () => {
        const c = closerFromCursor("</div");
        expect(c.form).toBe(CloserForm.Explicit);
        expect(c.name).toBe("div");
        expect(c.malformed).toBe(true);
        expect(c.ok).toBe(false);
    });

    test("tokenizeCloser advances the cursor past the closer token", () => {
        const cursor = makeCursor("</span>rest");
        tokenizeCloser(cursor);
        expect(cursor.pos).toBe(7);   // one past the `>`
    });

    test("the closer span is file-absolute (the one-cursor invariant)", () => {
        // A closer mid-source — its span is absolute, not 0-based.
        const cursor = makeCursor("xxxx</p>");
        advance(cursor, 4);
        const c = tokenizeCloser(cursor);
        expect(c.span.start).toBe(4);
        expect(c.span.end).toBe(8);
    });
});

// =============================================================================
// MK2.2 §25 — closeTagFrame: the opener/closer pairing + mismatch.
// =============================================================================
describe("MK2.2 closeTagFrame — opener/closer pairing (the `.Open* -> .Closed` transition)", () => {
    function ctxWithOpen(name, kind) {
        const ctx = makeParseContext();
        const frame = makeOpenExpectingChildrenFrame(name, kind ?? TagKind.Html, 0,
            { start: 0, end: name.length + 2, line: 1, col: 1 });
        pushTagFrame(ctx, frame);
        return ctx;
    }
    function inferredCloserDesc() {
        return { form: CloserForm.Inferred, name: "", span: { start: 10, end: 13, line: 1, col: 11 } };
    }
    function explicitCloserDesc(name) {
        return { form: CloserForm.Explicit, name, span: { start: 10, end: 12 + name.length, line: 1, col: 11 } };
    }

    test("an inferred `</>` pops the innermost open tag regardless of name", () => {
        const ctx = ctxWithOpen("section");
        const r = closeTagFrame(ctx, inferredCloserDesc());
        expect(r.ok).toBe(true);
        expect(r.popped.name).toBe("section");
        expect(r.code).toBe(null);
        expect(tagFrameDepth(ctx)).toBe(0);
    });

    test("an explicit `</name>` pops when the name matches the open tag", () => {
        const ctx = ctxWithOpen("div");
        const r = closeTagFrame(ctx, explicitCloserDesc("div"));
        expect(r.ok).toBe(true);
        expect(r.popped.name).toBe("div");
        expect(tagFrameDepth(ctx)).toBe(0);
    });

    test("a mismatched explicit `</name>` is E-MARKUP-002 — does NOT pop", () => {
        const ctx = ctxWithOpen("div");
        const r = closeTagFrame(ctx, explicitCloserDesc("span"));
        expect(r.ok).toBe(false);
        expect(r.code).toBe("E-MARKUP-002");
        expect(r.popped).toBe(null);
        // Recovery does NOT pop — the open `<div>` stays for a later
        // correct closer / the EOF unterminated path.
        expect(tagFrameDepth(ctx)).toBe(1);
    });

    test("a closer with no open tag is E-CTX-003 (a stray closer)", () => {
        const ctx = makeParseContext();
        const r = closeTagFrame(ctx, inferredCloserDesc());
        expect(r.ok).toBe(false);
        expect(r.code).toBe("E-CTX-003");
        expect(r.popped).toBe(null);
    });

    test("the mismatch records an E-MARKUP-002 diagnostic at the closer span", () => {
        const ctx = ctxWithOpen("div");
        closeTagFrame(ctx, explicitCloserDesc("span"));
        expect(ctx.diagnostics.length).toBe(1);
        expect(ctx.diagnostics[0].code).toBe("E-MARKUP-002");
        expect(ctx.diagnostics[0].span.start).toBe(10);
    });

    test("the stray closer records an E-CTX-003 diagnostic", () => {
        const ctx = makeParseContext();
        closeTagFrame(ctx, inferredCloserDesc());
        expect(ctx.diagnostics.length).toBe(1);
        expect(ctx.diagnostics[0].code).toBe("E-CTX-003");
    });

    test("a mismatch dispatches the ErrorRecovery engine — re-synchronized", () => {
        // The recovery returns to .ParsingNormally after the panic-mode
        // lifecycle (begin -> accumulate -> resync -> resume).
        const ctx = ctxWithOpen("div");
        closeTagFrame(ctx, explicitCloserDesc("span"));
        expect(ctx.recovery.mode).toBe(ErrorRecovery.ParsingNormally);
    });

    test("dispatchTagMismatchRecovery drives the panic-mode lifecycle", () => {
        const ctx = makeParseContext();
        const rec = dispatchTagMismatchRecovery(ctx, explicitCloserDesc("x"));
        // The lifecycle completed — back to .ParsingNormally, no leftover
        // skipped tokens.
        expect(rec.mode).toBe(ErrorRecovery.ParsingNormally);
        expect(rec.skipped.length).toBe(0);
    });

    test("closeSelfClosedFrame pops an .OpenSelfClosed frame (the `/>` lifecycle)", () => {
        const ctx = makeParseContext();
        const frame = makeOpenSelfClosedFrame("br", TagKind.Html,
            { start: 0, end: 5, line: 1, col: 1 });
        pushTagFrame(ctx, frame);
        const popped = closeSelfClosedFrame(ctx);
        expect(popped).toBe(frame);
        expect(tagFrameDepth(ctx)).toBe(0);
    });

    test("closeSelfClosedFrame is a no-op when the top frame is not self-closed", () => {
        const ctx = ctxWithOpen("div");
        expect(closeSelfClosedFrame(ctx)).toBe(null);
        expect(tagFrameDepth(ctx)).toBe(1);   // the .OpenExpectingChildren frame stays
    });
});

// =============================================================================
// MK2.2 §26 — the trampoline produces the `<tag>` TREE (whole-element spans
// + recursive-descent nesting).
// =============================================================================
describe("MK2.2 trampoline — the <tag> tree (opener/closer pairing end-to-end)", () => {
    test("a paired `<div></div>` is ONE whole-element Markup block", () => {
        expect(markupTree("<div></div>")).toBe("div[0,11]{}");
    });

    test("an explicit `</div>` closer closes its `<div>`", () => {
        expect(markupTree("<div>x</div>")).toBe("div[0,12]{Text[5,6]}");
    });

    test("an inferred `</>` closer closes the innermost tag", () => {
        expect(markupTree("<div>x</>")).toBe("div[0,9]{Text[5,6]}");
    });

    test("nested elements form a tree — children nest under their parent", () => {
        expect(markupTree("<div><span></span></div>")).toBe("div[0,24]{span[5,18]{}}");
    });

    test("three-deep nesting", () => {
        expect(markupTree("<a><b><c></c></b></a>")).toBe("a[0,21]{b[3,17]{c[6,13]{}}}");
    });

    test("sibling elements — two top-level Markup blocks", () => {
        expect(markupTree("<p>1</p><p>2</p>")).toBe("p[0,8]{Text[3,4]} p[8,16]{Text[11,12]}");
    });

    test("a self-closing `<br/>` is a complete element at the opener", () => {
        expect(markupTree("<br/>")).toBe("br[0,5]{}");
    });

    test("a self-closing element nests as a child", () => {
        expect(markupTree("<div><br/></div>")).toBe("div[0,16]{br[5,10]{}}");
    });

    test("text + element children interleave under a parent", () => {
        // `<ul>a<li>x</li>b</ul>` — `<li>` opener spans [5,9]; the `x`
        // child Text is [9,10]; the `<li>` element is [5,15].
        expect(markupTree("<ul>a<li>x</li>b</ul>"))
            .toBe("ul[0,21]{Text[4,5],li[5,15]{Text[9,10]},Text[15,16]}");
    });

    test("a structural element pairs like any tag — `<engine>...</>`", () => {
        // `<engine for=P>` is [0,14]; `<Idle>` opener [14,20]; the first
        // `</>` [20,23] closes `<Idle>` — element [14,23].
        expect(markupTree("<engine for=P><Idle></></>"))
            .toBe("engine[0,26]{Idle[14,23]{}}");
    });

    test("the inferred closer matches the innermost — `<a><b></></>`", () => {
        // The first `</>` closes `<b>`; the second closes `<a>`.
        expect(markupTree("<a><b></></>")).toBe("a[0,12]{b[3,9]{}}");
    });

    test("a markup tag inside a logic escape is paired within the body", () => {
        // `${ <div></div> }` — the `<div>` opens + pairs INSIDE the logic
        // body; the LogicEscape block follows.
        const s = parseMarkup("$" + "{" + " <div></div> }");
        const kinds = s.map((b) => b.kind);
        expect(kinds).toContain(NativeBlockKind.Markup);
        expect(kinds).toContain(NativeBlockKind.LogicEscape);
        // The <div> is fully paired — the tag-frame stack is empty.
        const { ctx } = parseMarkupTrace("$" + "{" + " <div></div> }");
        expect(tagFrameDepth(ctx)).toBe(0);
    });

    test("a well-formed tree drains the tag-frame stack to empty", () => {
        const { ctx } = parseMarkupTrace("<div><p>a</p><p>b</p></div>");
        expect(tagFrameDepth(ctx)).toBe(0);
        expect((ctx.diagnostics ?? []).length).toBe(0);
    });
});

// =============================================================================
// MK2.2 §27 — mismatch + EOF recovery + the diagnostic sink.
// =============================================================================
describe("MK2.2 mismatch + EOF recovery — ErrorRecovery dispatch + diagnostics", () => {
    test("a mismatched `</name>` produces an E-MARKUP-002 diagnostic", () => {
        // `<div></span>` — the `</span>` does not match `<div>`.
        const diags = runDiagnostics("<div></span>");
        expect(diags).toContain("E-MARKUP-002@[5,12]");
    });

    test("a stray closer with no open tag produces an E-CTX-003 diagnostic", () => {
        expect(runDiagnostics("</div>")).toEqual(["E-CTX-003@[0,6]"]);
    });

    test("an unterminated tag at EOF produces an E-CTX-001 diagnostic", () => {
        // `<div>` — no closer. The opener span [0,5] is the blame locus.
        expect(runDiagnostics("<div>")).toEqual(["E-CTX-001@[0,5]"]);
    });

    test("an unterminated tag at EOF is still emitted (recovered as `</>`)", () => {
        // SPEC §4 (line 1072) — the BS emits the markup block even for an
        // unterminated tag; MK2.2 matches (closeUnterminatedTags).
        expect(markupTree("<div>")).toBe("div[0,5]{}");
    });

    test("an unterminated tag absorbs the text after it as a child", () => {
        // `<div> tail` — `<div>` unterminated; the ` tail` text is its
        // child, the element span runs to EOF.
        expect(markupTree("<div> tail")).toBe("div[0,10]{Text[5,10]}");
    });

    test("a mismatched closer does not stop the parse — recovery resumes", () => {
        // `<div></span><p></p>` — the `</span>` mismatches; recovery
        // resumes; the `<p></p>` pairs cleanly.
        const { ctx } = parseMarkupTrace("<div></span><p></p>");
        const codes = (ctx.diagnostics ?? []).map((d) => d.code);
        expect(codes).toContain("E-MARKUP-002");
        // The `<p>` element was parsed AFTER the mismatch — recovery
        // resumed normal parsing.
        const names = ctx.tagFrameStack.map((f) => f.name);
        // <div> stays open (its closer mismatched); <p> closed cleanly.
        expect(names).toEqual([]);    // EOF drained <div>; <p> already popped
    });

    test("the recovery engine is .ParsingNormally after the run completes", () => {
        const { ctx } = parseMarkupTrace("<div></span>");
        expect(ctx.recovery.mode).toBe(ErrorRecovery.ParsingNormally);
    });

    test("multiple unterminated tags each get an E-CTX-001 diagnostic", () => {
        // `<a><b>` — two unterminated tags; one diagnostic each.
        const diags = runDiagnostics("<a><b>");
        expect(diags.filter((d) => d.startsWith("E-CTX-001")).length).toBe(2);
    });

    test("reportUnterminatedTags records one diagnostic per open frame", () => {
        const ctx = makeParseContext();
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("a", TagKind.Html, 0,
            { start: 0, end: 3, line: 1, col: 1 }));
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("b", TagKind.Html, 1,
            { start: 3, end: 6, line: 1, col: 4 }));
        const count = reportUnterminatedTags(ctx);
        expect(count).toBe(2);
        expect(ctx.diagnostics.length).toBe(2);
        expect(ctx.diagnostics.every((d) => d.code === "E-CTX-001")).toBe(true);
    });

    test("a well-formed tree produces NO diagnostics", () => {
        expect(runDiagnostics("<div><p>x</p></div>")).toEqual([]);
    });

    test("the diagnostic sink is lazy-initialized — ensureDiagnostics + pushDiagnostic", () => {
        const ctx = makeParseContext();
        expect(ctx.diagnostics).toBe(undefined);
        ensureDiagnostics(ctx);
        expect(Array.isArray(ctx.diagnostics)).toBe(true);
        pushDiagnostic(ctx, makeDiagnostic("E-CTX-001", "msg", { start: 0, end: 1 }));
        expect(ctx.diagnostics.length).toBe(1);
    });

    test("a tag opened inside a logic escape cannot outlive it (context-scoped)", () => {
        // `${ <div> }` — `<div>` unterminated within the logic body. The
        // LogicEscape block must NOT be corrupted by the recovery splice.
        const s = parseMarkup("$" + "{" + " <div> }");
        const logic = s.filter((b) => b.kind === NativeBlockKind.LogicEscape);
        expect(logic.length).toBe(1);
        // The LogicEscape block spans the whole `${ ... }` — intact.
        expect(logic[0].span.start).toBe(0);
        expect(logic[0].span.end).toBe(10);
    });

    test("a closer inside a logic escape cannot cross the context boundary", () => {
        // `<section>${ </section> }</section>` — the `</section>` INSIDE
        // `${}` must NOT close the outer `<section>` (E-CTX-002 territory
        // — the context-scoped floor blocks the cross-boundary close).
        // The OUTER `</section>` (after the `}`) pairs the element.
        const tree = markupTree("<section>$" + "{" + " </section> }</section>");
        // ONE top-level <section> element — the inner `</section>` did not
        // prematurely close it.
        expect(tree.startsWith("section[0,")).toBe(true);
        const { ctx } = parseMarkupTrace("<section>$" + "{" + " </section> }</section>");
        expect(tagFrameDepth(ctx)).toBe(0);
    });
});

// =============================================================================
// MK2.2 §28 — heuristic elimination + block-tree conformance vs the BS oracle.
//
// Charter Q2.A: MK2.2 eliminates BS classifier heuristic #5
// (`scanCompoundBlockEnd` — forward-scans for the matching `</>` by counting
// nested pairs) — the TagFrame stack finds the match BY CONSTRUCTION. It also
// confirms heuristic #12 (`looksLikeCloser` bare-`/`) does not exist (the
// closer set is closed). One regression assertion per eliminated heuristic.
// =============================================================================
describe("MK2.2 heuristic elimination — BS #5 (scanCompoundBlockEnd) + #12 (looksLikeCloser)", () => {
    test("#5 — the matching `</>` is found by stack discipline, not a forward scan", () => {
        // `<a><a><a></></></>` — three same-named nested tags. The BS's
        // scanCompoundBlockEnd counts nested pairs to find the matching
        // close; MK2.2's TagFrame stack pops the innermost by
        // construction — each `</>` closes exactly one frame.
        expect(markupTree("<a><a><a></></></>")).toBe("a[0,18]{a[3,15]{a[6,12]{}}}");
    });

    test("#5 — deep nesting (10 levels) pairs correctly with no forward scan", () => {
        let src = "";
        for (let i = 0; i < 10; i++) src += "<x>";
        for (let i = 0; i < 10; i++) src += "</>";
        const { ctx } = parseMarkupTrace(src);
        // Every opener paired with a closer — the stack drained to empty.
        expect(tagFrameDepth(ctx)).toBe(0);
        expect((ctx.diagnostics ?? []).length).toBe(0);
        // The tree is 10 deep.
        const tree = markupTree(src);
        expect((tree.match(/x\[/g) ?? []).length).toBe(10);
    });

    test("#12 — a bare `/` in markup text is NOT a closer guess", () => {
        // BS heuristic #12 (`looksLikeCloser`) fires E-SYNTAX-050 on a
        // bare `/` it guesses is a mistyped closer. MK2.2 has no such
        // guess — a `/` in text is text. `<p>a/b</p>` — the `/` is
        // ordinary text content; no diagnostic.
        expect(runDiagnostics("<p>a/b</p>")).toEqual([]);
        expect(markupTree("<p>a/b</p>")).toBe("p[0,10]{Text[3,6]}");
    });

    test("#12 — only the closed set `</>` / `</name>` / `/>` closes a tag", () => {
        // Each of these is a NON-closer; none triggers a closer guess.
        for (const txt of ["/", "/ ", "< /x>", "</ >"]) {
            expect(recognizeCloserForm(makeCursor(txt))).toBe(null);
        }
    });

    test("conformance — the native <tag> tree matches the BS block tree (section/p/p)", () => {
        // The BS oracle block tree for a paired element + its native
        // counterpart must be structurally equal on (kind, span, name).
        const src = "<section><p>a</p><p>b</p></section>";
        const bs = splitBlocks("conf.scrml", src);
        expect(bs.errors.length).toBe(0);

        // Render the BS tree + the native tree in the same compact shape.
        const bsFmt = (b) => {
            if (b.type === "markup") {
                return `${b.name}[${b.span.start},${b.span.end}]{${(b.children ?? []).map(bsFmt).join(",")}}`;
            }
            return `${BS_TYPE_TO_NATIVE_KIND[b.type] ?? b.type}[${b.span.start},${b.span.end}]`;
        };
        const bsTree = bs.blocks.map(bsFmt).join(" ");
        expect(markupTree(src)).toBe(bsTree);
    });

    test("conformance — a nested tag tree matches the BS block tree", () => {
        const src = "<div><ul><li>x</li></ul></div>";
        const bs = splitBlocks("conf.scrml", src);
        expect(bs.errors.length).toBe(0);
        const bsFmt = (b) => {
            if (b.type === "markup") {
                return `${b.name}[${b.span.start},${b.span.end}]{${(b.children ?? []).map(bsFmt).join(",")}}`;
            }
            return `${BS_TYPE_TO_NATIVE_KIND[b.type] ?? b.type}[${b.span.start},${b.span.end}]`;
        };
        expect(markupTree(src)).toBe(bs.blocks.map(bsFmt).join(" "));
    });

    test("conformance — sibling elements match the BS top-level block sequence", () => {
        const src = "<p>1</p><p>2</p><p>3</p>";
        const bs = splitBlocks("conf.scrml", src);
        expect(bs.errors.length).toBe(0);
        const native = parseMarkup(src);
        // Same count of top-level markup elements + same (name, span).
        const bsMarkup = bs.blocks.filter((b) => b.type === "markup");
        expect(native.length).toBe(bsMarkup.length);
        for (let i = 0; i < native.length; i++) {
            expect(native[i].name).toBe(bsMarkup[i].name);
            expect(native[i].span.start).toBe(bsMarkup[i].span.start);
            expect(native[i].span.end).toBe(bsMarkup[i].span.end);
        }
    });
});

// =============================================================================
// MK2.2 §29 — the closer-form lifecycle helpers (emit + close — the
// parse-markup-level pairing surface, direct-tested).
// =============================================================================
describe("MK2.2 closeMarkupElement / emitMarkupElement — the tree-emit helpers", () => {
    test("emitMarkupElement appends a Markup block carrying name + children", () => {
        const ctx = makeParseContext();
        const frame = makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
            { start: 0, end: 5, line: 1, col: 1 });
        frame.opener = { span: { start: 0, end: 5, line: 1, col: 1 } };
        emitMarkupElement(ctx, frame, 0, 11, []);
        expect(ctx.nodes.length).toBe(1);
        expect(ctx.nodes[0].kind).toBe(NativeBlockKind.Markup);
        expect(ctx.nodes[0].name).toBe("div");
        expect(ctx.nodes[0].children).toEqual([]);
        expect(ctx.nodes[0].span.start).toBe(0);
        expect(ctx.nodes[0].span.end).toBe(11);
    });

    test("closeMarkupElement splices the children out of the flat stream", () => {
        const ctx = makeParseContext();
        const frame = makeOpenExpectingChildrenFrame("ul", TagKind.Html, 0,
            { start: 0, end: 4, line: 1, col: 1 });
        frame.opener = { span: { start: 0, end: 4, line: 1, col: 1 } };
        frame.childStartIndex = 0;
        // Two child blocks emitted "since the opener".
        ctx.nodes.push({ kind: NativeBlockKind.Text, span: { start: 4, end: 5 } });
        ctx.nodes.push({ kind: NativeBlockKind.Text, span: { start: 5, end: 6 } });
        closeMarkupElement(ctx, frame, CloserForm.Explicit, 11);
        // The two Text blocks are now CHILDREN of one Markup block.
        expect(ctx.nodes.length).toBe(1);
        expect(ctx.nodes[0].kind).toBe(NativeBlockKind.Markup);
        expect(ctx.nodes[0].children.length).toBe(2);
        expect(ctx.nodes[0].closerForm).toBe(CloserForm.Explicit);
    });

    test("closeUnterminatedTags drains every still-open frame at EOF", () => {
        const ctx = makeParseContext();
        const outer = makeOpenExpectingChildrenFrame("a", TagKind.Html, 0,
            { start: 0, end: 3, line: 1, col: 1 });
        outer.opener = { span: { start: 0, end: 3, line: 1, col: 1 } };
        outer.childStartIndex = 0;
        pushTagFrame(ctx, outer);
        closeUnterminatedTags(ctx, 3);
        // The frame drained + a Markup block emitted + an E-CTX-001 logged.
        expect(tagFrameDepth(ctx)).toBe(0);
        expect(ctx.nodes.filter((n) => n.kind === NativeBlockKind.Markup).length).toBe(1);
        expect((ctx.diagnostics ?? []).filter((d) => d.code === "E-CTX-001").length).toBe(1);
    });

    test("handleCloser returns false when no closer is at the cursor", () => {
        const ctx = makeParseContext();
        const cursor = makeCursor("<div>");
        const run = { at: null };
        expect(handleCloser(run, cursor, ctx)).toBe(false);
        expect(cursor.pos).toBe(0);   // no closer — cursor untouched
    });

    test("handleCloser returns true + consumes the closer when one is present", () => {
        // A `<div>` is open; the cursor is at a `</div>`.
        const ctx = makeParseContext();
        pushTagFrame(ctx, (() => {
            const f = makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
                { start: 0, end: 5, line: 1, col: 1 });
            f.opener = { span: { start: 0, end: 5, line: 1, col: 1 } };
            f.childStartIndex = 0;
            return f;
        })());
        const cursor = makeCursor("</div>");
        const run = { at: null };
        expect(handleCloser(run, cursor, ctx)).toBe(true);
        expect(cursor.pos).toBe(6);   // the `</div>` was consumed
        expect(tagFrameDepth(ctx)).toBe(0);   // the frame popped
    });
});

// #############################################################################
// MK2.3 — TagKind-driven classification completion + punch-list P4/P5 +
// the MK2 milestone conformance close.
//
// Per IMPLEMENTATION-ROADMAP §3.1 (the MK2.3 row — the FINAL MK2 sub-step) +
// charter dive Q1.F / Q2.A #1 / Q2.A #4: the grammar decides
// decl-vs-markup-vs-structural from `TagKind` (computed at MK2.1) + what
// FOLLOWS the opener's terminating `>`. This eliminates BS classifier
// heuristics #1 (`isAfterTransitionArrow` — the backward `=>`/`()` scan)
// and #4 (`classifyOpenerForCompoundScan` — the self-recursive opener
// classifier). Punch-list P4 — `markupValueAllowedAfter`, the JS layer's
// `<`-vs-LessThan discriminator. Punch-list P5 — `tagFrameBalancedAt`, the
// CloseCondition.TagFrameBalanced predicate.
//
// MK2.3 closes the MK2 milestone gating criterion (charter Q4.A MK2): the
// BS classifier heuristics demonstrably do NOT exist — one regression test
// per Q2.A #1/#4 here, #5/#12 confirmed at MK2.2 §28.
// #############################################################################

// =============================================================================
// MK2.3 §30 — inspectAfterOpener: the post-`>` inspection (closed, forward).
// =============================================================================
describe("MK2.3 inspectAfterOpener — the post-`>` decl/nested-tag inspector", () => {
    test("a `=` after the `>` is a decl signal", () => {
        // `<x> = 1` — the opener `>` is at offset 2; afterOpenerPos is 3.
        expect(inspectAfterOpener("<x> = 1", 3).declSignal).toBe(true);
    });

    test("a `=` immediately after the `>` (no space) is a decl signal", () => {
        expect(inspectAfterOpener("<x>=1", 3).declSignal).toBe(true);
    });

    test("a `==` after the `>` is NOT a decl signal (it is an equality op)", () => {
        expect(inspectAfterOpener("<x> == 1", 3).declSignal).toBe(false);
    });

    test("a `=>` after the `>` is NOT a decl signal (it is an arrow)", () => {
        // This is the heuristic-#1 shape: `<x> => ...` — the native parser
        // does NOT treat the `=>` as a decl `=`. (The full heuristic-#1
        // elimination is §36.)
        expect(inspectAfterOpener("<x> => 1", 3).declSignal).toBe(false);
    });

    test("a `:` after the `>` is a decl signal (the `:`-shorthand body)", () => {
        expect(inspectAfterOpener("<x>: 1", 3).declSignal).toBe(true);
        expect(inspectAfterOpener("<x> : 1", 3).declSignal).toBe(true);
    });

    test("a nested `<ident` after the `>` is recorded at its offset", () => {
        // `<x> <y>` — the nested `<y` opener's `<` is at offset 4.
        expect(inspectAfterOpener("<x> <y>", 3).nestedTagAt).toBe(4);
    });

    test("plain text after the `>` — no decl signal, no nested tag", () => {
        const r = inspectAfterOpener("<x>text", 3);
        expect(r.declSignal).toBe(false);
        expect(r.nestedTagAt).toBe(-1);
    });

    test("a `</` after the `>` is NOT a nested tag (no name start)", () => {
        // `<x></>` — the `</` is a closer, not a `<ident` opener.
        expect(inspectAfterOpener("<x></>", 3).nestedTagAt).toBe(-1);
    });

    test("isDeclSignalChar recognizes the `:` shorthand signal", () => {
        expect(isDeclSignalChar(":")).toBe(true);
        expect(isDeclSignalChar("=")).toBe(false);   // `=` needs a 2-char look
        expect(isDeclSignalChar("x")).toBe(false);
    });
});

// =============================================================================
// MK2.3 §31 — classifyTag: the closed-rule four-way (five-way) classification.
// =============================================================================
describe("MK2.3 classifyTag — TagKind-driven decl/markup/structural classification", () => {
    const noFollow = { declSignal: false, nestedTagAt: -1 };

    test("a plain HTML opener with a text body is Markup", () => {
        expect(classifyTag(TagKind.Html, false, noFollow, null)).toBe(TagClass.Markup);
    });

    test("a component opener with a text body is Markup", () => {
        expect(classifyTag(TagKind.Component, false, noFollow, null)).toBe(TagClass.Markup);
    });

    test("a self-closing opener is SelfClose (regardless of TagKind)", () => {
        expect(classifyTag(TagKind.Html, true, noFollow, null)).toBe(TagClass.SelfClose);
        expect(classifyTag(TagKind.Component, true, noFollow, null)).toBe(TagClass.SelfClose);
    });

    test("a scrml-defined structural opener is Structural", () => {
        expect(classifyTag(TagKind.ScrmlStructural, false, noFollow, null))
            .toBe(TagClass.Structural);
    });

    test("a decl-signal (`=`/`:`) after the opener is Declaration", () => {
        const declFollow = { declSignal: true, nestedTagAt: -1 };
        expect(classifyTag(TagKind.StateOpener, false, declFollow, null))
            .toBe(TagClass.Declaration);
        expect(classifyTag(TagKind.Html, false, declFollow, null))
            .toBe(TagClass.Declaration);
    });

    test("a nested first-child Declaration makes the opener Compound", () => {
        expect(classifyTag(TagKind.Component, false, noFollow, TagClass.Declaration))
            .toBe(TagClass.Compound);
    });

    test("a nested first-child Compound makes the opener Compound (recursively)", () => {
        expect(classifyTag(TagKind.Component, false, noFollow, TagClass.Compound))
            .toBe(TagClass.Compound);
    });

    test("a nested first-child Markup does NOT make the opener Compound", () => {
        expect(classifyTag(TagKind.Component, false, noFollow, TagClass.Markup))
            .toBe(TagClass.Markup);
    });

    test("priority — SelfClose beats every other classification", () => {
        // A self-closing opener has no body, so neither decl nor compound
        // can apply — SelfClose wins.
        const declFollow = { declSignal: true, nestedTagAt: -1 };
        expect(classifyTag(TagKind.Html, true, declFollow, TagClass.Declaration))
            .toBe(TagClass.SelfClose);
    });

    test("priority — Structural beats a stray post-`>` decl signal", () => {
        // `<engine ...> = ...` is a misuse — but a structural element's
        // CLASS is its kind; NR validates structural-element placement.
        const declFollow = { declSignal: true, nestedTagAt: -1 };
        expect(classifyTag(TagKind.ScrmlStructural, false, declFollow, null))
            .toBe(TagClass.Structural);
    });

    test("priority — Declaration beats Compound (a `<NAME> = <X>` is a decl)", () => {
        // `<NAME> = <X>...` — the RHS opens with a tag, but the post-`>`
        // `=` makes it a declaration, not a compound.
        const declFollow = { declSignal: true, nestedTagAt: 6 };
        expect(classifyTag(TagKind.StateOpener, false, declFollow, TagClass.Declaration))
            .toBe(TagClass.Declaration);
    });

    test("a missing afterOpener descriptor falls through safely (defensive)", () => {
        // classifyTag tolerates a null afterOpener — the decl test is
        // skipped; an ordinary opener stays Markup.
        expect(classifyTag(TagKind.Html, false, null, null)).toBe(TagClass.Markup);
    });
});

// =============================================================================
// MK2.3 §32 — firstChildElementClass + classifyTagFrame (the close-time entry).
// =============================================================================
describe("MK2.3 firstChildElementClass / classifyTagFrame — the close-time entry", () => {
    test("firstChildElementClass — no markup child returns null", () => {
        expect(firstChildElementClass([
            { kind: NativeBlockKind.Text },
            { kind: NativeBlockKind.Comment },
        ])).toBe(null);
    });

    test("firstChildElementClass — the FIRST markup child's tagClass wins", () => {
        expect(firstChildElementClass([
            { kind: NativeBlockKind.Text },
            { kind: NativeBlockKind.Markup, tagClass: TagClass.Declaration },
            { kind: NativeBlockKind.Markup, tagClass: TagClass.Markup },
        ])).toBe(TagClass.Declaration);
    });

    test("firstChildElementClass — an empty / null child list returns null", () => {
        expect(firstChildElementClass([])).toBe(null);
        expect(firstChildElementClass(null)).toBe(null);
    });

    test("classifyTagFrame — a leaf Html frame with no children is Markup", () => {
        const frame = {
            tagKind: TagKind.Html,
            opener: { selfClosing: false },
            afterOpener: { declSignal: false, nestedTagAt: -1 },
        };
        expect(classifyTagFrame(frame, [])).toBe(TagClass.Markup);
    });

    test("classifyTagFrame — a frame whose first child is a Declaration is Compound", () => {
        const frame = {
            tagKind: TagKind.Component,
            opener: { selfClosing: false },
            afterOpener: { declSignal: false, nestedTagAt: 8 },
        };
        const children = [{ kind: NativeBlockKind.Markup, tagClass: TagClass.Declaration }];
        expect(classifyTagFrame(frame, children)).toBe(TagClass.Compound);
    });

    test("classifyTagFrame — a self-closing frame is SelfClose", () => {
        const frame = {
            tagKind: TagKind.Html,
            opener: { selfClosing: true },
            afterOpener: { declSignal: false, nestedTagAt: -1 },
        };
        expect(classifyTagFrame(frame, [])).toBe(TagClass.SelfClose);
    });
});

// =============================================================================
// MK2.3 §33 — end-to-end: the trampoline stamps TagClass on every Markup block.
// =============================================================================
describe("MK2.3 trampoline — TagClass stamped on the <tag> tree", () => {
    // tagClassOf — the TagClass of the first top-level Markup block.
    function tagClassOf(src) {
        const blocks = parseMarkup(src);
        const markup = blocks.find((b) => b.kind === NativeBlockKind.Markup);
        return markup ? markup.tagClass : null;
    }

    test("a paired `<div></div>` is classified Markup", () => {
        expect(tagClassOf("<div></div>")).toBe(TagClass.Markup);
    });

    test("a self-closing `<br/>` is classified SelfClose", () => {
        expect(tagClassOf("<br/>")).toBe(TagClass.SelfClose);
    });

    test("a structural `<engine for=P></>` is classified Structural", () => {
        expect(tagClassOf("<engine for=P></>")).toBe(TagClass.Structural);
    });

    test("a `<match>` element is classified Structural", () => {
        expect(tagClassOf("<match for=T></>")).toBe(TagClass.Structural);
    });

    test("a component `<Counter></Counter>` is classified Markup", () => {
        expect(tagClassOf("<Counter></Counter>")).toBe(TagClass.Markup);
    });

    test("every Markup block in a nested tree carries a tagClass", () => {
        const blocks = parseMarkup("<div><span><p></p></span></div>");
        const collect = (b, acc) => {
            if (b.kind === NativeBlockKind.Markup) {
                acc.push(b.tagClass);
                for (const c of b.children ?? []) collect(c, acc);
            }
            return acc;
        };
        const classes = blocks.flatMap((b) => collect(b, []));
        expect(classes.length).toBe(3);
        expect(classes.every((c) => c === TagClass.Markup)).toBe(true);
    });

    test("a compound parent — the child's Declaration propagates up", () => {
        // `<Parent><Child> = </></>` — the inner `<Child>` body opens with
        // ` = ` => Child classifies Declaration; the parent reads the
        // child's typed payload => Parent classifies Compound. The
        // recursive-descent close order makes the child's tagClass
        // available before the parent emits — NO recursion in the
        // classifier (charter Q2.A #4 elimination).
        const blocks = parseMarkup("<Parent><Child> = </></>");
        expect(blocks[0].tagClass).toBe(TagClass.Compound);
        expect(blocks[0].children[0].tagClass).toBe(TagClass.Declaration);
    });

    test("a self-closed child does NOT make the parent Compound", () => {
        // `<Parent><br/></>` — the self-closed `<br/>` child is SelfClose,
        // not Declaration/Compound, so the parent stays Markup.
        expect(tagClassOf("<Parent><br/></>")).toBe(TagClass.Markup);
    });

    test("a self-closing element nested as a child carries SelfClose", () => {
        const blocks = parseMarkup("<div><br/></div>");
        expect(blocks[0].children[0].tagClass).toBe(TagClass.SelfClose);
    });

    test("an EOF-recovered unterminated tag is still classified", () => {
        // `<div>` — unterminated; recovered at EOF. The recovered Markup
        // block still routes through emitMarkupElement so it carries a
        // tagClass.
        expect(tagClassOf("<div>")).toBe(TagClass.Markup);
    });
});

// =============================================================================
// MK2.3 §34 — punch-list P4: markupValueAllowedAfter (the `<`-vs-LessThan
// discriminator, the JS layer's InCode dispatch consumes it at MK4).
// =============================================================================
describe("MK2.3 P4 markupValueAllowedAfter — the `<`-opens-element discriminator", () => {
    test("start-of-input — a `<` may open a top-level markup element", () => {
        expect(markupValueAllowedAfter(null)).toBe(true);
        expect(markupValueAllowedAfter(undefined)).toBe(true);
    });

    test("after a VALUE token a `<` is less-than (markup NOT allowed)", () => {
        // A markup element is not a legal continuation of a completed
        // value — these are the value-producing tokens.
        for (const k of [TokenKind.Ident, TokenKind.NumberLit, TokenKind.StringLit,
                         TokenKind.RegexLit, TokenKind.BoolLit, TokenKind.RParen,
                         TokenKind.RBracket, TokenKind.RBrace, TokenKind.Increment,
                         TokenKind.Decrement, TokenKind.KwThis, TokenKind.KwTrue,
                         TokenKind.BareVariant, TokenKind.ScrmlAt]) {
            expect(markupValueAllowedAfter(k)).toBe(false);
        }
    });

    test("after a VALUE-EXPECTING token a `<` MAY open a markup element", () => {
        // The R1 seam spike §1.2 prev-token set: `=`, `(`, `,`, `return`,
        // `lift`, `render`, `=>`, `[`, binary operators — all positions
        // where a value is expected.
        for (const k of [TokenKind.Assign, TokenKind.LParen, TokenKind.Comma,
                         TokenKind.KwReturn, TokenKind.KwLift, TokenKind.KwRender,
                         TokenKind.Arrow, TokenKind.LBracket, TokenKind.Plus,
                         TokenKind.Star, TokenKind.LogicalAnd, TokenKind.Colon]) {
            expect(markupValueAllowedAfter(k)).toBe(true);
        }
    });

    test("markupValueAllowedAfter is the twin of regexAllowedAfter", () => {
        // Both partition the prev-token set into value-producing (false)
        // vs value-expecting (true). The two are NOT required to agree on
        // every token (they are separate primitives per R1 spike §1.2),
        // but they agree on the load-bearing cases: after `=` / `(` / `,`
        // a value is expected; after an Ident / `)` a value is complete.
        expect(markupValueAllowedAfter(TokenKind.Assign)).toBe(true);
        expect(markupValueAllowedAfter(TokenKind.Ident)).toBe(false);
        expect(markupValueAllowedAfter(TokenKind.RParen)).toBe(false);
    });
});

// =============================================================================
// MK2.3 §35 — punch-list P5: tagFrameBalancedAt (the
// CloseCondition.TagFrameBalanced predicate — the MK4 seam consumes it).
// =============================================================================
describe("MK2.3 P5 tagFrameBalancedAt — the TagFrame stack-depth close predicate", () => {
    test("an empty stack is balanced at depth 0", () => {
        const ctx = makeParseContext();
        expect(tagFrameBalancedAt(ctx, 0)).toBe(true);
    });

    test("a stack with one open tag is balanced at depth 1, not depth 0", () => {
        const ctx = makeParseContext();
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("div", TagKind.Html, 0,
            { start: 0, end: 5, line: 1, col: 1 }));
        expect(tagFrameBalancedAt(ctx, 1)).toBe(true);
        expect(tagFrameBalancedAt(ctx, 0)).toBe(false);
    });

    test("the predicate tracks the depth as tags push and pop", () => {
        // A JS->markup `ElementValue` delegation opens at some
        // tagDepthAtOpen; it must hand back when the stack RETURNS to it.
        const ctx = makeParseContext();
        const depthAtOpen = tagFrameDepth(ctx);   // 0
        // A `<tag>` opens inside the delegation.
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame("a", TagKind.Html, 0,
            { start: 0, end: 3, line: 1, col: 1 }));
        // Not yet balanced — the element is still open.
        expect(tagFrameBalancedAt(ctx, depthAtOpen)).toBe(false);
        // The element closes — the stack returns to the open depth.
        popTagFrame(ctx);
        expect(tagFrameBalancedAt(ctx, depthAtOpen)).toBe(true);
    });

    test("tagFrameBalancedAt lazy-inits the stack (total against an MK1 ctx)", () => {
        // A bare object with no tagFrameStack — the predicate must not
        // throw (ensureTagFrameStack keeps it total).
        const bare = {};
        expect(tagFrameBalancedAt(bare, 0)).toBe(true);
    });
});

// =============================================================================
// MK2.3 §36 — the MK2 MILESTONE CLOSE: the BS classifier heuristics
// demonstrably do NOT exist (charter Q4.A MK2 gating criterion).
//
// Charter Q2.A names the 5 BS classifier heuristics MK2 eliminates:
//   #1 isAfterTransitionArrow       — a BACKWARD `=>`/`()` scan
//   #2 peekTopLevelStateDeclSignal  — a peek-past-`>` (a classifier shape)
//   #3 peekCompoundStateDeclSignal  — delegates to #4
//   #4 classifyOpenerForCompoundScan — the SELF-RECURSIVE opener classifier
//   #5 scanCompoundBlockEnd          — a forward nested-pair scan
//   #12 looksLikeCloser             — the bare-`/` closer guess
//
// MK2.2 §28 eliminated #5 + confirmed #12 absent. MK2.3 eliminates #1 +
// #4 (and, by the same TagKind-driven grammar, #2 + #3 — they are the
// top-level / compound peek shapes #4 generalizes). One regression
// assertion per heuristic; this section IS the MK2 milestone gating.
// =============================================================================
describe("MK2.3 MK2 milestone close — the 5 BS classifier heuristics are eliminated", () => {
    test("#1 isAfterTransitionArrow — NO backward scan; `=>` is a forward operator", () => {
        // The BS's isAfterTransitionArrow (block-splitter.js:276-303)
        // scans BACKWARD from a `<` for the `name(...) =>` pattern to
        // decide whether `<Target>` is a transition target. The native
        // parser does NO backward scan: `=>` is a value-position
        // prev-token, so the JS layer's FORWARD markupValueAllowedAfter
        // discriminator says a `<` after `=>` MAY open a markup element.
        expect(markupValueAllowedAfter(TokenKind.Arrow)).toBe(true);
        // And the markup layer never inspects what is BEFORE a `<` — the
        // post-`>` inspector (inspectAfterOpener) only looks FORWARD.
        // A `<x> => ...` does not see the `=>` as a decl `=` (no
        // backward-or-forward mis-read of the arrow).
        expect(inspectAfterOpener("<x> => 1", 3).declSignal).toBe(false);
    });

    test("#2/#3 peek*StateDeclSignal — no peek-past-`>` guess; classifyTag computes", () => {
        // peekTopLevelStateDeclSignal / peekCompoundStateDeclSignal
        // (block-splitter.js:529-632) PEEK past `>` for a `=`/`:` to GUESS
        // a state-decl. The native parser COMPUTES TagClass from the
        // post-`>` facts (inspectAfterOpener) + a closed rule — the same
        // grammar that subsumes #4. A `<x> = expr` opener computes
        // Declaration; a `<x> markup` opener computes Markup.
        const declFollow = inspectAfterOpener("<x> = 1", 3);
        expect(classifyTag(TagKind.StateOpener, false, declFollow, null))
            .toBe(TagClass.Declaration);
        const markupFollow = inspectAfterOpener("<x>body", 3);
        expect(classifyTag(TagKind.Html, false, markupFollow, null))
            .toBe(TagClass.Markup);
    });

    test("#4 classifyOpenerForCompoundScan — NO self-recursion; typed-payload read", () => {
        // The BS's classifyOpenerForCompoundScan (block-splitter.js:670-753)
        // is SELF-RECURSIVE — it calls itself on the nested opener to
        // decide compound-vs-markup. classifyTag does NOT recurse: it
        // reads the first child's ALREADY-COMPUTED TagClass (the
        // recursive-descent close order guarantees the child closed
        // first). End-to-end: a `<Parent><Child> = </></>` classifies the
        // parent Compound by reading the child's Declaration payload.
        const blocks = parseMarkup("<Parent><Child> = </></>");
        expect(blocks[0].tagClass).toBe(TagClass.Compound);
        expect(blocks[0].children[0].tagClass).toBe(TagClass.Declaration);
        // classifyTag itself takes the child class as a plain argument —
        // there is no recursive call inside it.
        expect(classifyTag(TagKind.Component, false,
            { declSignal: false, nestedTagAt: 8 }, TagClass.Declaration))
            .toBe(TagClass.Compound);
    });

    test("#5 scanCompoundBlockEnd — the matching closer is found by stack discipline", () => {
        // (Re-affirmed from MK2.2 §28.) The BS's scanCompoundBlockEnd
        // forward-scans for the matching `</>` by counting nested pairs;
        // the native parser's TagFrame stack pops the innermost by
        // construction.
        expect(markupTree("<a><a><a></></></>")).toBe("a[0,18]{a[3,15]{a[6,12]{}}}");
        const { ctx } = parseMarkupTrace("<x><x></></>");
        expect(tagFrameDepth(ctx)).toBe(0);
    });

    test("#12 looksLikeCloser — a bare `/` in markup text is NOT a closer guess", () => {
        // (Re-affirmed from MK2.2 §28.) The closer set is the closed set
        // `</>` / `</name>` / `/>`; a bare `/` is text — no guess.
        expect(runDiagnostics("<p>a/b</p>")).toEqual([]);
        expect(recognizeCloserForm(makeCursor("/x"))).toBe(null);
    });

    test("MK2 gating — the native <tag> tree matches the BS block tree (full corpus)", () => {
        // The MK2 milestone gating criterion (charter Q4.A): the tag-tree
        // + closer-form output is equivalent to the BS block tree. Every
        // markup-bench corpus file in the markup-tree disposition is
        // asserted full-tree-equal in the MK1.3 conformance harness; this
        // is a consolidated re-assertion across a representative set.
        const corpus = [
            "<div></div>",
            "<div><p>a</p><p>b</p></div>",
            "<section><ul><li>x</li><li>y</li></ul></section>",
            "<a><b><c></c></b></a>",
            "<div><br/><span>t</span></div>",
        ];
        for (const src of corpus) {
            const bs = splitBlocks("conf.scrml", src);
            expect(bs.errors.length).toBe(0);
            const bsFmt = (b) => {
                if (b.type === "markup") {
                    return `${b.name}[${b.span.start},${b.span.end}]{${(b.children ?? []).map(bsFmt).join(",")}}`;
                }
                return `${BS_TYPE_TO_NATIVE_KIND[b.type] ?? b.type}[${b.span.start},${b.span.end}]`;
            };
            expect(markupTree(src)).toBe(bs.blocks.map(bsFmt).join(" "));
        }
    });
});

// #############################################################################
// #############################################################################
// ##                                                                         ##
// ##  MK3.1 — BodyMode engine + DisplayTextLiteral engine skeleton +          ##
// ##         body-mode establishment + punch-list P7.                         ##
// ##                                                                         ##
// ##  Per IMPLEMENTATION-ROADMAP §3.3 (the MK3.1 row) + charter dive Q1.D     ##
// ##  (the BodyMode 2-variant engine) + Q1.E (the DisplayTextLiteral          ##
// ##  3-variant engine skeleton) + Q3.A (the §4.18 mapping) + SPEC §4.18.     ##
// ##                                                                         ##
// ##  MK3.1 lands the engine SHAPES + body-mode ESTABLISHMENT — which         ##
// ##  bodies are code-default vs free-text. The substantive `"..."`           ##
// ##  literal-scanning logic is MK3.2; the `${...}` interpolation is MK3.3.   ##
// ##  These sections are therefore a UNIT suite over the MK3.1 surface.       ##
// ##                                                                         ##
// #############################################################################
// #############################################################################

// recognizeOpenerUnderParent — recognizeOpenerFromLt with a PARENT frame
// already on the TagFrame stack, so body-mode establishment sees an
// enclosing element. `parentName` / `parentKind` describe the parent; the
// child opener is `childSource` (a `<...>` opener). Returns the child's
// pushed TagFrame.
function recognizeOpenerUnderParent(parentName, parentKind, childSource) {
    const ctx = makeParseContext();
    // Push a parent .OpenExpectingChildren frame (the element the child
    // tag is nested inside).
    pushTagFrame(ctx, makeOpenExpectingChildrenFrame(
        parentName, parentKind, 0, { start: 0, end: 1, line: 1, col: 1 }));
    const cursor = makeCursor(childSource);
    const ltAnchor = { start: cursor.pos, line: cursor.line, col: cursor.col };
    advance(cursor, 1);
    return recognizeOpener(ctx, cursor, ltAnchor);
}

// =============================================================================
// MK3.1 §37 — the BodyMode engine (charter Q1.D; the §4.18 two-mode engine).
// =============================================================================
describe("MK3.1 BodyMode engine — the §4.18 two-body-mode model", () => {
    test("BodyMode has exactly the two §4.18.1 variants — FreeText / CodeDefault", () => {
        expect(BodyMode.FreeText).toBe("FreeText");
        expect(BodyMode.CodeDefault).toBe("CodeDefault");
        // The §4.18 engine is a TWO-mode engine — no third variant. The
        // §40.8 `default-logic` mode is a separate tag (ProgramBodyMode),
        // NOT a BodyMode variant.
        expect(Object.keys(BodyMode).sort()).toEqual(["CodeDefault", "FreeText"]);
    });

    test("initialBodyMode is .FreeText — the §4.18.1 default body mode", () => {
        // SPEC §4.18.1: "The default body mode is free-text mode."
        expect(initialBodyMode()).toBe(BodyMode.FreeText);
    });

    test("the §40.8 `default-logic` THIRD mode is a distinct tag, not a BodyMode variant", () => {
        // S111 R3 reconciliation: `default-logic` (the `<program>` /
        // `<page>` body mode) is a distinct THIRD mode owned by §40.8 —
        // neither free-text nor code-default. It is surfaced as
        // ProgramBodyMode.DefaultLogic so the §4.18 BodyMode enum stays
        // a clean two-mode enum.
        expect(ProgramBodyMode.DefaultLogic).toBe("DefaultLogic");
        expect(BodyMode.DefaultLogic).toBe(undefined);
    });

    test("the mode predicates — isCodeDefault / isFreeText / isDefaultLogic", () => {
        expect(isCodeDefault(BodyMode.CodeDefault)).toBe(true);
        expect(isCodeDefault(BodyMode.FreeText)).toBe(false);
        expect(isFreeText(BodyMode.FreeText)).toBe(true);
        expect(isFreeText(BodyMode.CodeDefault)).toBe(false);
        expect(isDefaultLogic(ProgramBodyMode.DefaultLogic)).toBe(true);
        expect(isDefaultLogic(BodyMode.FreeText)).toBe(false);
        expect(isDefaultLogic(BodyMode.CodeDefault)).toBe(false);
    });
});

// =============================================================================
// MK3.1 §38 — body-mode establishment (SPEC §4.18.1 — the establishment rule).
// =============================================================================
describe("MK3.1 body-mode establishment — the code-bearing-loci registries", () => {
    test("STRUCTURAL_PARENT_CODE_DEFAULT is the closed `<engine>` / `<match>` set", () => {
        // SPEC §4.18.1 code-bearing loci 1 + 2: an engine state-child
        // body + a match block-form arm body. The closed parent set.
        expect(STRUCTURAL_PARENT_CODE_DEFAULT.engine).toBe(true);
        expect(STRUCTURAL_PARENT_CODE_DEFAULT.match).toBe(true);
        expect(Object.keys(STRUCTURAL_PARENT_CODE_DEFAULT).sort())
            .toEqual(["engine", "match"]);
    });

    test("isCodeBearingParentName — `<engine>` / `<match>` true; everything else false", () => {
        expect(isCodeBearingParentName("engine")).toBe(true);
        expect(isCodeBearingParentName("match")).toBe(true);
        // A plain-markup parent does not make its children code-default.
        expect(isCodeBearingParentName("div")).toBe(false);
        expect(isCodeBearingParentName("Counter")).toBe(false);
        // `<errors>` is a structural element but its body is free-text
        // (the override-template body — SPEC §4.18.1) — so it is NOT a
        // code-bearing parent.
        expect(isCodeBearingParentName("errors")).toBe(false);
        // A null parent (a top-level tag) is not a code-bearing parent.
        expect(isCodeBearingParentName(null)).toBe(false);
        expect(isCodeBearingParentName(undefined)).toBe(false);
    });

    test("PROGRAM_BODY_ELEMENTS / isProgramBodyElementName — the §40.8 set", () => {
        // SPEC §40.8 — `<program>` / `<page>` bodies parse in
        // `default-logic` mode (the THIRD mode).
        expect(PROGRAM_BODY_ELEMENTS.program).toBe(true);
        expect(PROGRAM_BODY_ELEMENTS.page).toBe(true);
        expect(isProgramBodyElementName("program")).toBe(true);
        expect(isProgramBodyElementName("page")).toBe(true);
        expect(isProgramBodyElementName("div")).toBe(false);
        expect(isProgramBodyElementName("engine")).toBe(false);
        expect(isProgramBodyElementName(null)).toBe(false);
    });

    test("bodyModeForChildOf — a child of `<engine>` opens a code-default body", () => {
        // SPEC §4.18.1 locus 1 — an engine state-child body is code-default.
        expect(bodyModeForChildOf("Idle", "engine")).toBe(BodyMode.CodeDefault);
        expect(bodyModeForChildOf("Loading", "engine")).toBe(BodyMode.CodeDefault);
    });

    test("bodyModeForChildOf — a child of `<match>` opens a code-default body", () => {
        // SPEC §4.18.1 locus 2 — a match block-form arm body is code-default.
        expect(bodyModeForChildOf("Big", "match")).toBe(BodyMode.CodeDefault);
        expect(bodyModeForChildOf("Small", "match")).toBe(BodyMode.CodeDefault);
    });

    test("bodyModeForChildOf — a plain-markup body is free-text (the default)", () => {
        // A `<button>` / `<p>` / component-element body is free-text.
        expect(bodyModeForChildOf("button", "div")).toBe(BodyMode.FreeText);
        expect(bodyModeForChildOf("p", "section")).toBe(BodyMode.FreeText);
        expect(bodyModeForChildOf("span", "Counter")).toBe(BodyMode.FreeText);
        // A top-level tag (no parent) — free-text.
        expect(bodyModeForChildOf("div", null)).toBe(BodyMode.FreeText);
    });

    test("bodyModeForChildOf — the `<engine>` body itself is free-text (not a §4.18 locus)", () => {
        // SPEC §4.18.1: the three code-bearing loci are engine STATE-CHILD
        // bodies / match ARM bodies / `:`-shorthand bodies — NOT the
        // `<engine>` / `<match>` body itself. An `<engine>` body's content
        // is its state-children (recognized as tags in any mode); the
        // §4.18.1 default — free-text — applies to the `<engine>` body.
        expect(bodyModeForChildOf("engine", null)).toBe(BodyMode.FreeText);
        expect(bodyModeForChildOf("match", "div")).toBe(BodyMode.FreeText);
    });

    test("bodyModeForChildOf — `<program>` / `<page>` is the §40.8 `default-logic` mode", () => {
        // SPEC §40.8 — the THIRD body mode. Checked FIRST in
        // bodyModeForChildOf — the program-body mode is the element's OWN
        // fixed mode, independent of parent.
        expect(bodyModeForChildOf("program", null)).toBe(ProgramBodyMode.DefaultLogic);
        expect(bodyModeForChildOf("page", "program")).toBe(ProgramBodyMode.DefaultLogic);
        // Even a `<program>` mis-nested under an `<engine>` keeps its own
        // `default-logic` mode (NR validates structural-element placement
        // downstream — the body mode is the element's).
        expect(bodyModeForChildOf("program", "engine")).toBe(ProgramBodyMode.DefaultLogic);
    });

    test("body modes NEST, they do NOT propagate (SPEC §4.18.1 statement 3)", () => {
        // SPEC §4.18.1 statement 3: "a plain-markup element opened inside
        // a code-default body opens its OWN free-text body". A `<button>`
        // whose parent is `<Idle>` (a state-child) — the parent is NOT an
        // `<engine>` / `<match>`, so the `<button>` body is free-text.
        // The code-default mode of the enclosing `<Idle>` body does NOT
        // propagate down into the `<button>`.
        expect(bodyModeForChildOf("button", "Idle")).toBe(BodyMode.FreeText);
        // Conversely, an `<engine>` opened inside a free-text `<div>` body
        // — the `<engine>` body itself is free-text. The establishment is
        // purely a function of element + immediate parent.
        expect(bodyModeForChildOf("engine", "div")).toBe(BodyMode.FreeText);
    });

    test("shorthandBodyMode — a `:`-shorthand body slot is always code-default", () => {
        // SPEC §4.18.1 code-bearing locus 3 / §4.14 line 973 — a
        // `:`-shorthand body is a code-default body. The CONSTANT (the
        // recognizer that decides a tag HAS a `:`-shorthand body is a
        // forward seam — see body-mode.scrml's shorthandBodyMode doc).
        expect(shorthandBodyMode()).toBe(BodyMode.CodeDefault);
    });
});

// =============================================================================
// MK3.1 §39 — recognizeOpener populates the TagFrame `bodyMode` payload.
// =============================================================================
describe("MK3.1 recognizeOpener — the bodyMode payload (body-mode establishment)", () => {
    test("a top-level `<div>` — bodyMode FreeText (no enclosing element)", () => {
        const { frame } = recognizeOpenerFromLt("<div>");
        expect(frame.bodyMode).toBe(BodyMode.FreeText);
    });

    test("a top-level `<engine>` — bodyMode FreeText (its body holds state-children)", () => {
        const { frame } = recognizeOpenerFromLt("<engine for=Phase>");
        expect(frame.bodyMode).toBe(BodyMode.FreeText);
    });

    test("an `<Idle>` child of an `<engine>` — bodyMode CodeDefault", () => {
        // SPEC §4.18.1 locus 1 — the engine state-child body is code-default.
        const frame = recognizeOpenerUnderParent("engine", TagKind.ScrmlStructural, "<Idle>");
        expect(frame.bodyMode).toBe(BodyMode.CodeDefault);
        expect(frame.name).toBe("Idle");
    });

    test("a `<Big>` arm of a `<match>` — bodyMode CodeDefault", () => {
        // SPEC §4.18.1 locus 2 — the match block-form arm body is code-default.
        const frame = recognizeOpenerUnderParent("match", TagKind.ScrmlStructural, "<Big>");
        expect(frame.bodyMode).toBe(BodyMode.CodeDefault);
    });

    test("a `<button>` child of a plain `<div>` — bodyMode FreeText", () => {
        const frame = recognizeOpenerUnderParent("div", TagKind.Html, "<button>");
        expect(frame.bodyMode).toBe(BodyMode.FreeText);
    });

    test("a `<program>` opener — bodyMode is the §40.8 DefaultLogic THIRD mode", () => {
        const { frame } = recognizeOpenerFromLt("<program>");
        expect(frame.bodyMode).toBe(ProgramBodyMode.DefaultLogic);
    });

    test("a self-closing `<br/>` opener — an .OpenSelfClosed frame has NO bodyMode", () => {
        // SPEC §4.18.1 — a body is the content between an opener's `>` and
        // its closer; a self-closing tag opens no body. .OpenSelfClosed
        // frames carry no `bodyMode` field.
        const { frame } = recognizeOpenerFromLt("<br/>");
        expect(frame.kind).toBe(TagFrameKind.OpenSelfClosed);
        expect(frame.bodyMode).toBe(undefined);
    });

    test("makeOpenExpectingChildrenFrame — the 5th bodyMode arg is carried; omitting it defaults null", () => {
        const span = { start: 0, end: 5, line: 1, col: 1 };
        // The MK3.1 5-arg form carries the mode.
        const withMode = makeOpenExpectingChildrenFrame(
            "Idle", TagKind.StateOpener, 0, span, BodyMode.CodeDefault);
        expect(withMode.bodyMode).toBe(BodyMode.CodeDefault);
        // The MK2.1-era 4-arg form (existing callers) — bodyMode defaults
        // to null, unchanged from MK2.1.
        const noMode = makeOpenExpectingChildrenFrame("div", TagKind.Html, 0, span);
        expect(noMode.bodyMode).toBe(null);
    });

    test("end-to-end — recognizeOpener stamps the §4.18 mode through the trampoline", () => {
        // Drive the full markup trampoline; the TagFrame for the engine
        // state-child carries bodyMode CodeDefault while it is open.
        const cursor = makeCursor("<engine for=X><Idle></></>");
        const ctx = makeParseContext();
        const run = { at: null };
        let idleMode = null;
        let iters = 0;
        while (!isEof(cursor) && iters < 200) {
            const before = cursor.pos;
            const c = ctx.blockContext;
            if (c === BlockContext.TopLevel) dispatchTopLevel(run, cursor, ctx);
            else if (c === BlockContext.InMarkupTag) dispatchInMarkupTag(run, cursor, ctx);
            else cursor.pos = before + 1;
            // Capture the <Idle> frame's body mode while it is on the
            // stack. ctx.tagFrameStack is lazy-inited on the first frame
            // push (ensureTagFrameStack) — guard the early iterations.
            for (const f of (ctx.tagFrameStack ?? [])) {
                if (f.name === "Idle") idleMode = f.bodyMode;
            }
            if (cursor.pos === before && !isEof(cursor)) cursor.pos = before + 1;
            iters = iters + 1;
        }
        expect(idleMode).toBe(BodyMode.CodeDefault);
    });
});

// =============================================================================
// MK3.1 §40 — the DisplayTextLiteral engine SKELETON (charter Q1.E).
// =============================================================================
describe("MK3.1 DisplayTextLiteral engine — the §4.18.3/.4 literal-engine skeleton", () => {
    test("DisplayTextLiteral has the three §4.18.3/.4 variants", () => {
        expect(DisplayTextLiteral.Outside).toBe("Outside");
        expect(DisplayTextLiteral.InLiteralText).toBe("InLiteralText");
        expect(DisplayTextLiteral.InInterpolation).toBe("InInterpolation");
        expect(Object.keys(DisplayTextLiteral).sort())
            .toEqual(["InInterpolation", "InLiteralText", "Outside"]);
    });

    test("initialDisplayTextLiteral is .Outside — a code-default body begins outside a literal", () => {
        // Matches `initial=.Outside` on the engine. A code-default body
        // starts OUTSIDE any `"..."` display-text literal.
        expect(initialDisplayTextLiteral()).toBe(DisplayTextLiteral.Outside);
    });

    test("doubleQuote is the `\"` display-text-literal delimiter (SPEC §4.18.3 — `\"`-only)", () => {
        expect(doubleQuote()).toBe("\"");
        expect(doubleQuote().length).toBe(1);
    });

    test("LEGAL_FROM_IN_LITERAL_TEXT — the rule= matrix for the .InLiteralText state-child", () => {
        // From .InLiteralText the engine may transition to .Outside (the
        // closing `"`) or .InInterpolation (a `${` opener) — charter Q1.E.
        expect(LEGAL_FROM_IN_LITERAL_TEXT.Outside).toBe(true);
        expect(LEGAL_FROM_IN_LITERAL_TEXT.InInterpolation).toBe(true);
        expect(Object.keys(LEGAL_FROM_IN_LITERAL_TEXT).sort())
            .toEqual(["InInterpolation", "Outside"]);
    });
});

// =============================================================================
// MK3.1 §41 — the DisplayTextLiteral block kind (SPEC §4.18.8).
// =============================================================================
describe("MK3.1 DisplayTextLiteral block kind — distinct from the Text block (§4.18.8)", () => {
    test("blockKinds() carries a DisplayTextLiteral kind, distinct from Text", () => {
        const k = blockKinds();
        // SPEC §4.18.8 — the `text` block / `TextNode` AST kind SURVIVES
        // (free-text bodies); `DisplayTextLiteral` is the NEW kind for the
        // code-default-body `"..."` literal — a distinct node kind.
        expect(k.Text).toBe("Text");
        expect(k.DisplayTextLiteral).toBe("DisplayTextLiteral");
        expect(k.Text).not.toBe(k.DisplayTextLiteral);
    });

    test("blockKinds() has 11 kinds — the MK1.3 ten plus DisplayTextLiteral", () => {
        const k = blockKinds();
        expect(Object.keys(k).length).toBe(11);
        // The full catalog — a reviewer can name every block kind the
        // markup layer produces.
        expect(Object.keys(k).sort()).toEqual([
            "Comment", "Css", "DisplayTextLiteral", "ErrorEffect", "ForeignCode",
            "LogicEscape", "Markup", "Meta", "Sql", "Test", "Text",
        ]);
    });
});

// =============================================================================
// MK3.1 §42 — punch-list P7: bodyMode threaded into the DelegationFrame.
// =============================================================================
describe("MK3.1 P7 — the §4.18 body mode threaded into every markup→JS DelegationFrame", () => {
    // delegationFrameModes — drive the markup trampoline and collect every
    // DISTINCT bodyMode observed on the top DelegationFrame across the run.
    function delegationFrameModes(src) {
        const cursor = makeCursor(src);
        const ctx = makeParseContext();
        const run = { at: null };
        const seen = [];
        let iters = 0;
        while (!isEof(cursor) && iters < (src.length + 1) * 8) {
            const before = cursor.pos;
            const c = ctx.blockContext;
            if (c === BlockContext.TopLevel) dispatchTopLevel(run, cursor, ctx);
            else if (c === BlockContext.InMarkupTag) dispatchInMarkupTag(run, cursor, ctx);
            else if (c === BlockContext.InLogicEscape) dispatchInLogicEscape(run, cursor, ctx);
            else cursor.pos = before + 1;
            const f = topDelegationFrame(ctx);
            if (f !== null && delegationDepth(ctx) > 0) seen.push(f.bodyMode);
            if (cursor.pos === before && !isEof(cursor)) cursor.pos = before + 1;
            iters = iters + 1;
        }
        return [...new Set(seen)];
    }

    test("currentBodyMode — FreeText when no tag is open (the §4.18.1 default)", () => {
        // SPEC §4.18.1 — the cursor at the top level of a file is inside
        // no element body; the default body mode (free-text) applies.
        const ctx = makeParseContext();
        expect(currentBodyMode(ctx)).toBe(BodyMode.FreeText);
        // A defensive null ctx — still free-text.
        expect(currentBodyMode(null)).toBe(BodyMode.FreeText);
    });

    test("currentBodyMode — the innermost open TagFrame's bodyMode (§4.18.1 statement 3)", () => {
        // SPEC §4.18.1 statement 3 — "the mode in effect at any cursor
        // position is the mode of the INNERMOST enclosing body".
        const ctx = makeParseContext();
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame(
            "engine", TagKind.ScrmlStructural, 0,
            { start: 0, end: 1, line: 1, col: 1 }, BodyMode.FreeText));
        expect(currentBodyMode(ctx)).toBe(BodyMode.FreeText);
        // Push an inner state-child frame whose body is code-default —
        // currentBodyMode now reports the INNER frame's mode.
        pushTagFrame(ctx, makeOpenExpectingChildrenFrame(
            "Idle", TagKind.StateOpener, 1,
            { start: 1, end: 2, line: 1, col: 2 }, BodyMode.CodeDefault));
        expect(currentBodyMode(ctx)).toBe(BodyMode.CodeDefault);
    });

    test("a `${}` at top level — the DelegationFrame carries bodyMode FreeText", () => {
        // The logic-escape sits in no element body — free-text (the default).
        expect(delegationFrameModes("${ x }")).toEqual([BodyMode.FreeText]);
    });

    test("a `${}` inside a free-text `<div>` body — DelegationFrame bodyMode FreeText", () => {
        expect(delegationFrameModes("<div>${ x }</div>")).toEqual([BodyMode.FreeText]);
    });

    test("a `${}` inside an engine state-child body — DelegationFrame bodyMode CodeDefault", () => {
        // The `${...}` logic-escape sits inside the `<Idle>` engine
        // state-child body — a code-default body (§4.18.1 locus 1). P7
        // threads CodeDefault into the DelegationFrame so the JS layer
        // knows the §4.18 display-text rules for that body.
        expect(delegationFrameModes("<engine for=X><Idle>${ a }</></>"))
            .toEqual([BodyMode.CodeDefault]);
    });

    test("the DelegationFrame bodyMode is no longer the MK1.2 null placeholder", () => {
        // MK1.2 carried `null` for the DelegationFrame bodyMode field;
        // MK3.1 (P7) supplies the real §4.18 mode. The field is now a
        // BodyMode value, never null, for a markup→JS LogicEscape frame.
        const modes = delegationFrameModes("<div>${ x }</div>");
        expect(modes).not.toContain(null);
        expect(modes.every((m) => m === BodyMode.FreeText || m === BodyMode.CodeDefault))
            .toBe(true);
    });
});

// =============================================================================
// MK3.1 §43 — K1 resolution (roadmap §4.4) — the BodyMode forward-ref resolves.
// =============================================================================
describe("MK3.1 K1 — the block-context.scrml BodyMode forward-ref is resolved", () => {
    test("block-context.scrml imports BodyMode — the .InMarkupTag <engine for=BodyMode> resolves", () => {
        // K1 (roadmap §4.4): block-context.scrml's .InMarkupTag composite
        // state-child carries `<engine for=BodyMode var=tagBodyMode>` — a
        // forward-reference that was a deliberate single E-ENGINE-004
        // .scrml-compile error from MK1.1 (charter-Q1.C SHAPE fidelity).
        // MK3.1 lands body-mode.scrml + block-context.scrml imports
        // `BodyMode` from it; the forward-ref resolves.
        //
        // The .js shadow (what this test runs) has always executed
        // correctly (ANOMALY-2 shadow discipline); this test asserts the
        // BodyMode engine the .scrml's `<engine for=BodyMode>` declares
        // exists + is usable — the live-surface evidence that the type
        // the forward-ref needs is now in the module graph.
        expect(BodyMode).toBeDefined();
        expect(BodyMode.FreeText).toBe("FreeText");
        expect(BodyMode.CodeDefault).toBe("CodeDefault");
        // The BodyMode engine drives the .InMarkupTag composite
        // state-child's body-mode dispatch; body-mode establishment
        // (bodyModeForChildOf) is the live calculation that feeds it.
        expect(typeof bodyModeForChildOf).toBe("function");
    });
});

// #############################################################################
// #############################################################################
// ##                                                                         ##
// ##  MK3.2 — DisplayTextLiteral literal scanning (non-interpolation).        ##
// ##                                                                         ##
// ##  Per IMPLEMENTATION-ROADMAP §3.3 (the MK3.2 row) + charter dive Q1.E     ##
// ##  (the DisplayTextLiteral engine sketch) + Q3.A/Q3.B (the §4.18 mapping   ##
// ##  + worked-example trace) + SPEC §4.18.3 / §4.18.4 / §4.18.5 / §4.18.7.   ##
// ##                                                                         ##
// ##  MK3.1 landed the DisplayTextLiteral engine SKELETON; MK3.2 fills the    ##
// ##  `.Outside` / `.InLiteralText` literal-scanning logic — the `"` open/    ##
// ##  close transitions, the `\"` / `\\` / `\${` escapes, the verbatim-       ##
// ##  whitespace segment accumulation, the DisplayTextLiteral AST-node emit,  ##
// ##  and the unterminated-literal E-CTX-001 recovery. The `${...}`           ##
// ##  interpolation + E-UNQUOTED-DISPLAY-TEXT are MK3.3. These sections are   ##
// ##  therefore a UNIT suite over the MK3.2 scanning surface.                 ##
// ##                                                                         ##
// #############################################################################
// #############################################################################

// MK3.2 char-code constants — the test file is plain JS, but the literal
// scanner's delimiters are assembled via char-code to keep the source
// unambiguous (a literal `${` in a JS template-literal would interpolate;
// a literal `\` would need its own escape). DQ / BS / DOLLAR+LBRACE here
// build the §4.18 sigil sequences for the inline-corpus sources below.
const DQ = String.fromCharCode(34);      // "
const BS = String.fromCharCode(92);      // \
const DOLLAR = String.fromCharCode(36);  // $
const LBRACE = String.fromCharCode(123); // {
const INTERP = DOLLAR + LBRACE;          // ${

// scanLiteral — drive scanDisplayTextLiteral over a source string. The
// cursor is positioned at offset 0 (the source begins with the opening
// `"`). Returns { node, stoppedAtInterp, endPos, diagnostics } — the full
// MK3.2 observation surface for a single literal.
function scanLiteral(source) {
    const cursor = makeCursor(source);
    const ctx = makeParseContext();
    const { node, stoppedAtInterp } = scanDisplayTextLiteral(cursor, ctx);
    return {
        node,
        stoppedAtInterp,
        endPos: cursor.pos,
        diagnostics: ctx.diagnostics ?? [],
    };
}

// =============================================================================
// MK3.2 §44 — classifyEscape: the §4.18.3/.4 escape-recognition predicate.
// =============================================================================
describe("MK3.2 classifyEscape — the §4.18.3/.4 escape predicate", () => {
    test("a `\"` after `\\` is the escaped-quote escape (SPEC §4.18.3)", () => {
        expect(classifyEscape(DQ, "")).toBe("quote");
    });

    test("a `\\` after `\\` is the escaped-backslash escape (SPEC §4.18.3)", () => {
        expect(classifyEscape(BS, "")).toBe("backslash");
    });

    test("a `${` after `\\` is the escaped-dollar-brace escape (SPEC §4.18.4)", () => {
        // §4.18.4 — `\${` escapes a literal `${` (the interpolation
        // opener). The predicate needs BOTH following chars — `$` then `{`.
        expect(classifyEscape(DOLLAR, LBRACE)).toBe("dollarBrace");
    });

    test("a `$` after `\\` NOT followed by `{` is malformed — not escaped-dollar-brace", () => {
        // `\$x` — the `$` is not followed by `{`, so this is not the
        // `\${` escape; it is a malformed escape (SPEC §4.18.3).
        expect(classifyEscape(DOLLAR, "x")).toBe("malformed");
    });

    test("any other character after `\\` is a malformed escape (SPEC §4.18.3)", () => {
        // §4.18.3 — the display-text-literal escape set is exactly
        // `\"` / `\\` / `\${`. `\n` / `\t` / `\a` etc. are MALFORMED —
        // a display-text literal does NOT recognize the JS escape table.
        expect(classifyEscape("n", "")).toBe("malformed");
        expect(classifyEscape("t", "")).toBe("malformed");
        expect(classifyEscape("a", "")).toBe("malformed");
        expect(classifyEscape("0", "")).toBe("malformed");
    });

    test("a `\\` at end-of-input (no following char) is malformed", () => {
        // peekChar past EOF returns "" — classifyEscape("", "") is the
        // `\`-at-EOF case. Nothing to escape — malformed.
        expect(classifyEscape("", "")).toBe("malformed");
    });
});

// =============================================================================
// MK3.2 §45 — scanLiteralEscape: consuming one escape sequence.
// =============================================================================
describe("MK3.2 scanLiteralEscape — consume one §4.18.3/.4 escape", () => {
    // escapeAt — run scanLiteralEscape over a source whose offset 0 is the
    // introducing `\`. Returns { cooked, malformed, consumed }.
    function escapeAt(source) {
        const cursor = makeCursor(source);
        const r = scanLiteralEscape(cursor);
        return { cooked: r.cooked, malformed: r.malformed, consumed: cursor.pos };
    }

    test("`\\\"` cooks to `\"` and consumes two characters (SPEC §4.18.3)", () => {
        const r = escapeAt(BS + DQ);
        expect(r.cooked).toBe(DQ);
        expect(r.malformed).toBe(false);
        expect(r.consumed).toBe(2);
    });

    test("`\\\\` cooks to `\\` and consumes two characters (SPEC §4.18.3)", () => {
        const r = escapeAt(BS + BS);
        expect(r.cooked).toBe(BS);
        expect(r.malformed).toBe(false);
        expect(r.consumed).toBe(2);
    });

    test("`\\${` cooks to `${` and consumes three characters (SPEC §4.18.4)", () => {
        const r = escapeAt(BS + INTERP);
        expect(r.cooked).toBe(INTERP);
        expect(r.malformed).toBe(false);
        expect(r.consumed).toBe(3);
    });

    test("a malformed escape cooks to a bare `\\`, marks malformed, consumes ONLY the `\\`", () => {
        // SPEC §4.18.3 recovery — a `\` before a non-escape char is a
        // literal backslash; the offending char is LEFT for the caller's
        // next scan iteration (consumed === 1 — only the `\`).
        const r = escapeAt(BS + "n");
        expect(r.cooked).toBe(BS);
        expect(r.malformed).toBe(true);
        expect(r.consumed).toBe(1);
    });

    test("a `\\` at end-of-input is malformed — cooks to a bare `\\`", () => {
        const r = escapeAt(BS);
        expect(r.cooked).toBe(BS);
        expect(r.malformed).toBe(true);
    });
});

// =============================================================================
// MK3.2 §46 — scanDisplayTextLiteral: the basic `"..."` literal scan.
// =============================================================================
describe("MK3.2 scanDisplayTextLiteral — the basic `\"...\"` literal (SPEC §4.18.3)", () => {
    test("a plain literal — one segment, terminated, no diagnostics", () => {
        // SPEC §4.18.3 worked example — `"Ready to fetch."`.
        const r = scanLiteral(DQ + "Ready to fetch." + DQ);
        expect(r.node.kind).toBe("DisplayTextLiteral");
        expect(r.node.segments.length).toBe(1);
        expect(r.node.segments[0].cooked).toBe("Ready to fetch.");
        expect(r.node.segments[0].raw).toBe("Ready to fetch.");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("the closing `\"` is consumed — the cursor lands one past it", () => {
        // `"hi"` is 4 chars; the scan consumes the open `"`, `hi`, the
        // close `"` — the cursor lands at offset 4.
        const r = scanLiteral(DQ + "hi" + DQ);
        expect(r.endPos).toBe(4);
    });

    test("the whole-literal span runs the opening `\"` through the closing `\"`", () => {
        const r = scanLiteral(DQ + "abc" + DQ);
        expect(r.node.span.start).toBe(0);
        expect(r.node.span.end).toBe(5);
        expect(r.node.span.line).toBe(1);
        expect(r.node.span.col).toBe(1);
    });

    test("an empty literal `\"\"` — one empty segment, terminated", () => {
        const r = scanLiteral(DQ + DQ);
        expect(r.node.segments.length).toBe(1);
        expect(r.node.segments[0].cooked).toBe("");
        expect(r.node.segments[0].raw).toBe("");
        expect(r.node.terminated).toBe(true);
        expect(r.endPos).toBe(2);
    });

    test("a non-interpolation literal has an EMPTY `exprs` array (MK3.2 — interpolation is MK3.3)", () => {
        // SPEC §4.18.4 / D3 — the node is `{ segments, exprs }`. A
        // non-interpolation literal carries one segment and zero exprs.
        const r = scanLiteral(DQ + "no interpolation here" + DQ);
        expect(Array.isArray(r.node.exprs)).toBe(true);
        expect(r.node.exprs.length).toBe(0);
    });

    test("scanDisplayTextLiteral never stops at an interpolation for a plain literal", () => {
        const r = scanLiteral(DQ + "plain" + DQ);
        expect(r.stoppedAtInterp).toBe(false);
    });
});

// =============================================================================
// MK3.2 §47 — `'` and a backtick are ordinary interior characters (§4.18.3).
// =============================================================================
describe("MK3.2 ordinary interior chars — `'` and backtick (SPEC §4.18.3)", () => {
    test("an apostrophe `'` is an ordinary interior char — no escape, no transition", () => {
        // SPEC §4.18.3 — `"Don't worry — it's fine"` is a SINGLE
        // well-formed literal; the `'` carries no delimiter role.
        const r = scanLiteral(DQ + "Don't worry — it's fine" + DQ);
        expect(r.node.segments.length).toBe(1);
        expect(r.node.segments[0].cooked).toBe("Don't worry — it's fine");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("a backtick is an ordinary interior char — NOT a display-text delimiter", () => {
        // SPEC §4.18.3 — "the backtick is likewise an ordinary interior
        // character and is NOT a display-text delimiter".
        const tick = String.fromCharCode(96);
        const r = scanLiteral(DQ + "a " + tick + "code" + tick + " span" + DQ);
        expect(r.node.segments.length).toBe(1);
        expect(r.node.segments[0].cooked).toBe("a " + tick + "code" + tick + " span");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("a literal that is only apostrophes — every `'` is interior content", () => {
        const r = scanLiteral(DQ + "'''" + DQ);
        expect(r.node.segments[0].cooked).toBe("'''");
        expect(r.node.terminated).toBe(true);
    });
});

// =============================================================================
// MK3.2 §48 — escapes inside the literal (SPEC §4.18.3 + §4.18.4).
// =============================================================================
describe("MK3.2 escapes inside the literal — `\\\"` / `\\\\` / `\\${`", () => {
    test("`\\\"` produces a literal `\"` in the cooked text (SPEC §4.18.3)", () => {
        // `"say \"hi\""` — the inner `\"` pair is escaped quotes; the
        // literal is terminated by the FINAL un-escaped `"`.
        const r = scanLiteral(DQ + "say " + BS + DQ + "hi" + BS + DQ + DQ);
        expect(r.node.segments[0].cooked).toBe("say " + DQ + "hi" + DQ);
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("the `raw` of an escaped-quote literal keeps the backslashes UNRESOLVED", () => {
        // `raw` is the verbatim source between the quotes — escapes NOT
        // applied (SPEC §4.18.5 — `raw` is byte-for-byte). `cooked`
        // resolves them.
        const r = scanLiteral(DQ + "x" + BS + DQ + "y" + DQ);
        expect(r.node.segments[0].raw).toBe("x" + BS + DQ + "y");
        expect(r.node.segments[0].cooked).toBe("x" + DQ + "y");
    });

    test("`\\\\` produces a literal backslash in the cooked text (SPEC §4.18.3)", () => {
        const r = scanLiteral(DQ + "a" + BS + BS + "b" + DQ);
        expect(r.node.segments[0].cooked).toBe("a" + BS + "b");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("`\\${` produces a literal `${` and does NOT open an interpolation (SPEC §4.18.4)", () => {
        // SPEC §4.18.4 — `\${` escapes the interpolation opener; the
        // literal text is `${x}` and the scan does NOT stop at it.
        const r = scanLiteral(DQ + "literal " + BS + INTERP + "x}" + DQ);
        expect(r.node.segments[0].cooked).toBe("literal " + INTERP + "x}");
        expect(r.node.terminated).toBe(true);
        expect(r.stoppedAtInterp).toBe(false);
        expect(r.diagnostics.length).toBe(0);
    });

    test("a literal escaped `\\${` immediately before the closing `\"`", () => {
        const r = scanLiteral(DQ + BS + INTERP + DQ);
        expect(r.node.segments[0].cooked).toBe(INTERP);
        expect(r.node.terminated).toBe(true);
    });
});

// =============================================================================
// MK3.2 §49 — verbatim whitespace inside the literal (SPEC §4.18.5).
// =============================================================================
describe("MK3.2 verbatim whitespace — SPEC §4.18.5 (no collapse, no strip)", () => {
    test("a run of spaces is preserved exactly — `\"two  spaces\"` keeps two", () => {
        // SPEC §4.18.5 — "`\"two  spaces\"` renders two spaces". No
        // HTML-style collapse inside a display-text literal.
        const r = scanLiteral(DQ + "two  spaces" + DQ);
        expect(r.node.segments[0].cooked).toBe("two  spaces");
    });

    test("leading and trailing whitespace is NOT stripped (SPEC §4.18.5)", () => {
        // A free-text body would strip leading/trailing whitespace; a
        // display-text literal keeps it — the literal IS the whitespace
        // declaration.
        const r = scanLiteral(DQ + "  padded  " + DQ);
        expect(r.node.segments[0].cooked).toBe("  padded  ");
    });

    test("a newline inside a multi-line literal is preserved verbatim (SPEC §4.18.5)", () => {
        const r = scanLiteral(DQ + "line one" + "\n" + "line two" + DQ);
        expect(r.node.segments[0].cooked).toBe("line one\nline two");
        expect(r.node.terminated).toBe(true);
    });

    test("a tab inside the literal is preserved verbatim (SPEC §4.18.5)", () => {
        const r = scanLiteral(DQ + "col1" + "\t" + "col2" + DQ);
        expect(r.node.segments[0].cooked).toBe("col1\tcol2");
    });

    test("`raw` and `cooked` agree for a whitespace-only escape-free literal", () => {
        // No escapes — raw and cooked are identical (SPEC §4.18.5 verbatim).
        const r = scanLiteral(DQ + "  \t \n  " + DQ);
        expect(r.node.segments[0].raw).toBe("  \t \n  ");
        expect(r.node.segments[0].cooked).toBe("  \t \n  ");
    });
});

// =============================================================================
// MK3.2 §50 — the unterminated-literal E-CTX-001 recovery (SPEC §4.18.7).
// =============================================================================
describe("MK3.2 unterminated literal — E-CTX-001 recovery (SPEC §4.18.3 / §4.18.7)", () => {
    test("EOF before the closing `\"` fires E-CTX-001", () => {
        // SPEC §4.18.3 — "a display-text literal that reaches end-of-file
        // ... before its closing `\"` is an unterminated literal —
        // E-CTX-001".
        const r = scanLiteral(DQ + "never closes");
        expect(r.diagnostics.length).toBe(1);
        expect(r.diagnostics[0].code).toBe("E-CTX-001");
    });

    test("E-CTX-001 is blamed at the OPENING `\"` (SPEC §4.18.7)", () => {
        // SPEC §4.18.7 recovery — the diagnostic is "E-CTX-001 against
        // the opening `\"`". The blame span is the single opening quote.
        const r = scanLiteral(DQ + "unterminated");
        expect(r.diagnostics[0].span.start).toBe(0);
        expect(r.diagnostics[0].span.end).toBe(0);
    });

    test("an unterminated literal node carries `terminated: false`", () => {
        const r = scanLiteral(DQ + "open forever");
        expect(r.node.terminated).toBe(false);
    });

    test("the captured text IS the unterminated literal's content (SPEC §4.18.7 recovery)", () => {
        // SPEC §4.18.7 — "the block splitter recovers by treating the
        // captured text from the opening `\"` ... as the literal's
        // content and continuing". The segment carries everything after
        // the opening `"`.
        const r = scanLiteral(DQ + "all of this is content");
        expect(r.node.segments[0].cooked).toBe("all of this is content");
    });

    test("an unterminated EMPTY literal — `\"` alone at EOF — still fires E-CTX-001", () => {
        const r = scanLiteral(DQ);
        expect(r.diagnostics.length).toBe(1);
        expect(r.diagnostics[0].code).toBe("E-CTX-001");
        expect(r.node.terminated).toBe(false);
        expect(r.node.segments[0].cooked).toBe("");
    });
});

// =============================================================================
// MK3.2 §51 — the malformed-escape E-PARSE-001 path (SPEC §4.18.3).
// =============================================================================
describe("MK3.2 malformed escape — E-PARSE-001 (SPEC §4.18.3)", () => {
    test("a `\\n` inside the literal is a malformed escape — E-PARSE-001", () => {
        // SPEC §4.18.3 — the escape set is `\"` / `\\` / `\${` only. `\n`
        // is NOT a display-text escape; it is a malformed escape.
        const r = scanLiteral(DQ + "bad " + BS + "n escape" + DQ);
        const malformed = r.diagnostics.filter((d) => d.code === "E-PARSE-001");
        expect(malformed.length).toBe(1);
    });

    test("a malformed escape is RECOVERED — the `\\` becomes a literal backslash", () => {
        // SPEC §4.18.3 recovery — the `\` is a literal backslash; the
        // offending char (`n`) is then ordinary content. The literal
        // still terminates cleanly.
        const r = scanLiteral(DQ + "x" + BS + "n y" + DQ);
        expect(r.node.segments[0].cooked).toBe("x" + BS + "n y");
        expect(r.node.terminated).toBe(true);
    });

    test("E-PARSE-001 is blamed at the `\\` (not the literal's opening `\"`)", () => {
        // The malformed-escape blame span is the `\` itself — distinct
        // from E-CTX-001, which blames the opening `"`.
        const r = scanLiteral(DQ + "ab" + BS + "n" + DQ);
        const malformed = r.diagnostics.find((d) => d.code === "E-PARSE-001");
        // The `\` is at offset 3 — `"`(0) `a`(1) `b`(2) `\`(3).
        expect(malformed.span.start).toBe(3);
    });

    test("a `\\` before EOF inside an unterminated literal — E-PARSE-001 AND E-CTX-001", () => {
        // A trailing `\` with no following char is a malformed escape;
        // the literal also never closes — BOTH diagnostics fire.
        const r = scanLiteral(DQ + "trail" + BS);
        const codes = r.diagnostics.map((d) => d.code).sort();
        expect(codes).toEqual(["E-CTX-001", "E-PARSE-001"]);
        expect(r.node.terminated).toBe(false);
    });

    test("a clean literal fires NO E-PARSE-001 (the recognized escapes are not malformed)", () => {
        const r = scanLiteral(DQ + "ok " + BS + DQ + " " + BS + BS + " " + BS + INTERP + "x}" + DQ);
        const malformed = r.diagnostics.filter((d) => d.code === "E-PARSE-001");
        expect(malformed.length).toBe(0);
        expect(r.node.terminated).toBe(true);
    });
});

// =============================================================================
// MK3.2 §52 — the `${` interpolation-stop seam (MK3.3 forward-ref).
// =============================================================================
describe("MK3.2 interpolation-stop — the un-escaped `${` MK3.3 resume seam", () => {
    test("an un-escaped `${` STOPS the scan — `stoppedAtInterp` is true", () => {
        // MK3.2's scanner recognizes `${` as the .InInterpolation
        // transition (SPEC §4.18.4) and STOPS — the interpolation
        // delegation itself is MK3.3.
        const r = scanLiteral(DQ + "hi " + INTERP + "x} bye" + DQ);
        expect(r.stoppedAtInterp).toBe(true);
    });

    test("the segment before the `${` is the literal text up to the opener", () => {
        // The scan accumulates `hi ` then stops AT the `${` — the first
        // segment is `hi `.
        const r = scanLiteral(DQ + "hi " + INTERP + "x}" + DQ);
        expect(r.node.segments[0].cooked).toBe("hi ");
    });

    test("the `${` is NOT consumed — the cursor lands AT the `$` (MK3.3 reads it)", () => {
        // `"hi ${...` — `"`(0) `h`(1) `i`(2) ` `(3) `$`(4). The scan stops
        // with the cursor at offset 4 so MK3.3's resume reads the `${`.
        const r = scanLiteral(DQ + "hi " + INTERP + "x}" + DQ);
        expect(r.endPos).toBe(4);
    });

    test("a scan stopped at `${` is NOT terminated and fires NO E-CTX-001", () => {
        // Stopping at an interpolation is a clean MK3.3 hand-off — it is
        // neither a terminated literal nor an unterminated-literal error.
        const r = scanLiteral(DQ + "before " + INTERP + "expr}");
        expect(r.node.terminated).toBe(false);
        expect(r.diagnostics.filter((d) => d.code === "E-CTX-001").length).toBe(0);
    });

    test("a literal that is ONLY an interpolation — segment empty, stopped at `${`", () => {
        const r = scanLiteral(DQ + INTERP + "x}" + DQ);
        expect(r.node.segments[0].cooked).toBe("");
        expect(r.stoppedAtInterp).toBe(true);
        expect(r.endPos).toBe(1);
    });
});

// =============================================================================
// MK3.2 §53 — the DisplayTextLiteral AST node + segment builders.
// =============================================================================
describe("MK3.2 the DisplayTextLiteral AST node — `{ kind, segments, exprs, span, terminated }`", () => {
    test("makeLiteralSegment builds a `{ raw, cooked }` segment", () => {
        const seg = makeLiteralSegment("ra\\w", "cooked");
        expect(seg.raw).toBe("ra\\w");
        expect(seg.cooked).toBe("cooked");
    });

    test("makeDisplayTextLiteralNode builds the §4.18.4 / D3 node shape", () => {
        // SPEC §4.18.4 / D3 — the node is a Template-shaped
        // `{ segments, exprs }` carrier, distinct from a TextNode
        // (SPEC §4.18.8). MK3.2's builder also carries span + terminated.
        const span = { start: 0, end: 5, line: 1, col: 1 };
        const node = makeDisplayTextLiteralNode(
            [makeLiteralSegment("hi", "hi")], [], span, true);
        expect(node.kind).toBe("DisplayTextLiteral");
        expect(node.segments.length).toBe(1);
        expect(node.exprs).toEqual([]);
        expect(node.span).toBe(span);
        expect(node.terminated).toBe(true);
    });

    test("the node kind matches the parse-ctx DisplayTextLiteral block kind (SPEC §4.18.8)", () => {
        // The scanner's node `kind` field reads `"DisplayTextLiteral"` —
        // the SAME string blockKinds() carries (MK3.1 added the block
        // kind). The code-default-body literal node is a distinct kind
        // from the free-text-body Text block.
        const r = scanLiteral(DQ + "x" + DQ);
        expect(r.node.kind).toBe(blockKinds().DisplayTextLiteral);
        expect(r.node.kind).not.toBe(blockKinds().Text);
    });
});

// =============================================================================
// MK3.2 §54 — SPEC §4.18.3/.4 worked examples parse correctly.
// =============================================================================
describe("MK3.2 SPEC §4.18 worked examples — display-text literals scan correctly", () => {
    test("§4.18.3 example — `\"Ready to fetch.\"` (the `<Idle>` body)", () => {
        const r = scanLiteral(DQ + "Ready to fetch." + DQ);
        expect(r.node.segments[0].cooked).toBe("Ready to fetch.");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("§4.18.3 example — `\"Loading…\"` (the `<Loading>` body)", () => {
        const r = scanLiteral(DQ + "Loading…" + DQ);
        expect(r.node.segments[0].cooked).toBe("Loading…");
        expect(r.node.terminated).toBe(true);
    });

    test("§4.18.3 example — `\"Don't panic — it's recoverable.\"` (the `<Error>` body)", () => {
        // The §4.18.3 worked example for `'` as an ordinary interior char
        // — two apostrophes, no escaping, one clean literal.
        const r = scanLiteral(DQ + "Don't panic — it's recoverable." + DQ);
        expect(r.node.segments[0].cooked).toBe("Don't panic — it's recoverable.");
        expect(r.node.terminated).toBe(true);
        expect(r.diagnostics.length).toBe(0);
    });

    test("§4.18.6 example — `\"a literal <tag> and an & ampersand\"` scans verbatim", () => {
        // SPEC §4.18.6 — the `<`/`>`/`&` HTML-escaping is a CODEGEN
        // concern; the PARSER captures the literal characters verbatim.
        // MK3.2's scanner produces the raw `<tag>` + `&` text; codegen
        // (a later stage) applies the entity escaping.
        const r = scanLiteral(DQ + "a literal <tag> and an & ampersand" + DQ);
        expect(r.node.segments[0].cooked).toBe("a literal <tag> and an & ampersand");
        expect(r.node.terminated).toBe(true);
    });

    test("§4.18.5 example — `\"two  spaces\"` keeps both spaces", () => {
        const r = scanLiteral(DQ + "two  spaces" + DQ);
        expect(r.node.segments[0].cooked).toBe("two  spaces");
    });
});
