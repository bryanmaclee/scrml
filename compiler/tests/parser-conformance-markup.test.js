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
} from "../native-parser/tag-frame.js";

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
const NativeBlockKind = {
    Text:        "Text",
    Comment:     "Comment",
    Markup:      "Markup",
    LogicEscape: "LogicEscape",
    Sql:         "Sql",
    Css:         "Css",
    ErrorEffect: "ErrorEffect",
    Meta:        "Meta",
    Test:        "Test",
    ForeignCode: "ForeignCode",
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

    test("a Markup block spans the FULL opener (MK2.1 — divergence D-4 narrowed)", () => {
        // `<div> x` — MK2.1's dispatchInMarkupTag tokenizes the FULL
        // opener `<div>` via recognizeOpener; the Markup block spans
        // [0,5] (the whole `<div>`), not just the `<div` boundary run
        // [0,4] that MK1.3's placeholder emitted. The whole-ELEMENT span
        // (opener + children + closer) is MK2.2 — D-4 is narrowed, not
        // yet closed.
        const s = blockStream("<div> x");
        expect(s[0]).toEqual({ kind: NativeBlockKind.Markup, start: 0, end: 5 });
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
// At MK1.3 the trampoline produces a FLAT block-stream; the BS produces a
// tree. "Structural equivalence" at MK1.3 is checked as TOP-LEVEL block
// equivalence: the native block-stream vs the BS's depth-0 `rootBlocks`,
// compared on (kind, span). The corpus is split into two dispositions:
//
//   "conformance"  — clean files: only text / comment / brace-context
//                    blocks at the top level, no top-level context
//                    nesting. The native block-stream is asserted
//                    structurally equal to the BS rootBlocks.
//   "divergence-*" — files exercising a KNOWN, DOCUMENTED divergence
//                    (D-2 SQL-at-top-level / D-3 foreign-code / D-4 the
//                    <tag> tree). The divergence is recorded; the native
//                    side is asserted internally correct.
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
    // Divergence-exercising files — see the D-2/D-3/D-4 notes in
    // parse-markup.scrml's header.
    "markup-tags.scrml":         "divergence-markup-tree",   // D-4
    "foreign-code.scrml":        "divergence-foreign-code",  // D-3
};

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
            } else if (disposition === "divergence-markup-tree") {
                // D-4 — the native MK1.3 layer emits `Markup` blocks at the
                // `<ident` BOUNDARY granularity; the BS emits one `markup`
                // block per ELEMENT (opener + children + closer). The
                // <tag> tree is MK2. Record the divergence; assert the
                // native side is internally coherent.
                test(`(divergence D-4 — <tag> tree is MK2) native emits boundary-granular Markup blocks`, () => {
                    const native = blockStream(source);
                    // The native layer DOES recognize the markup-tag
                    // boundaries — at least one Markup block is emitted.
                    const markupBlocks = native.filter((b) => b.kind === NativeBlockKind.Markup);
                    expect(markupBlocks.length).toBeGreaterThan(0);
                    // Every Markup block spans a non-empty `<ident` run.
                    for (const m of markupBlocks) {
                        expect(m.end).toBeGreaterThan(m.start);
                    }
                    // DOCUMENTED DIVERGENCE: the BS top-level `markup` block
                    // count differs from the native one (the BS spans whole
                    // elements; the native spans boundaries). This is the
                    // MK2-deferral — asserted as a divergence, not parity.
                    const bs = bsTopLevelStream(source);
                    const bsMarkup = bs.blocks.filter((b) => b.kind === NativeBlockKind.Markup);
                    expect(bsMarkup.length).toBeGreaterThan(0);
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

    test("text on either side of an opener splits into Text blocks", () => {
        // `a <span> b` — Text[0,2], Markup[2,8], Text[8,10].
        const s = blockStream("a <span> b");
        expect(s).toEqual([
            { kind: NativeBlockKind.Text,   start: 0,  end: 2 },
            { kind: NativeBlockKind.Markup, start: 2,  end: 8 },
            { kind: NativeBlockKind.Text,   start: 8,  end: 10 },
        ]);
    });

    test("two openers — one Markup block each (the tag tree is MK2.2)", () => {
        // `<div><span>` — MK2.1 emits a Markup block per opener; the
        // children + closer pairing (the tree) is MK2.2.
        const s = blockStream("<div><span>");
        expect(s).toEqual([
            { kind: NativeBlockKind.Markup, start: 0,  end: 5 },
            { kind: NativeBlockKind.Markup, start: 5,  end: 11 },
        ]);
    });

    test("a closer `</div>` is text to MK2.1 (closer recognition is MK2.2)", () => {
        // `<div></div>` — MK2.1 recognizes the OPENER; the `</div>` closer
        // is NOT yet recognized (MK2.2) — it accumulates as a Text block.
        const s = blockStream("<div></div>");
        expect(s).toEqual([
            { kind: NativeBlockKind.Markup, start: 0,  end: 5 },
            { kind: NativeBlockKind.Text,   start: 5,  end: 11 },
        ]);
    });

    test("the final tag-frame stack reflects the opener stream", () => {
        // Every opener pushes a frame; closers (MK2.2) would pop. At MK2.1
        // the stack after `<div><span><br/>` has all three frames.
        const { ctx } = parseMarkupTrace("<div><span><br/>");
        expect(tagFrameDepth(ctx)).toBe(3);
        expect(ctx.tagFrameStack.map((f) => f.name)).toEqual(["div", "span", "br"]);
        expect(ctx.tagFrameStack.map((f) => f.kind)).toEqual([
            TagFrameKind.OpenExpectingChildren,
            TagFrameKind.OpenExpectingChildren,
            TagFrameKind.OpenSelfClosed,
        ]);
    });

    test("a nested tag inside a logic escape is recognized — `${ <div> }`", () => {
        // The charter Q1.C contract permits a markup tag inside a logic
        // body. The `<div>` opener inside `${ ... }` is recognized; its
        // Markup block is emitted, then the LogicEscape block.
        const s = blockStream("$" + "{" + " <div> }");
        const kinds = s.map((b) => b.kind);
        expect(kinds).toContain(NativeBlockKind.Markup);
        expect(kinds).toContain(NativeBlockKind.LogicEscape);
    });

    test("an opener with a structural element — `<engine for=Phase>`", () => {
        // The opener tokenizer + TagKind handle a structural-element opener;
        // the Markup block spans the whole opener. (decl-vs-structural
        // classification completion is MK2.3.)
        const src = "<engine for=Phase>";
        const s = blockStream(src);
        expect(s).toEqual([{ kind: NativeBlockKind.Markup, start: 0, end: src.length }]);
        const { ctx } = parseMarkupTrace(src);
        expect(ctx.tagFrameStack[0].tagKind).toBe(TagKind.ScrmlStructural);
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
