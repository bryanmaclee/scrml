/**
 * BS-layer HTML-comment skip — §27.2 markup-context native comment.
 *
 * Surfaced by S87 Wave-3 fixture-sweep dispatch. The block-splitter previously
 * did NOT skip `<!-- ... -->` HTML comments, so a literal `<program>` /
 * `</program>` (or any structural opener) inside an HTML comment was parsed
 * as a real opener/closer — corrupting the block stream.
 *
 * `//` line-comment suppression (SPEC §4.7) was already in place at all
 * context levels; HTML comments now mirror it at markup/state/root level.
 *
 * SPEC §4.7 amendment proposed: drop the "BS SHALL NOT handle <!-- -->"
 * exclusion line; replace with "BS SHALL skip <!-- ... --> at markup/state/
 * root context, mirroring //". Inside brace-delimited contexts (`${...}`,
 * `?{...}`, `#{...}`, `!{...}`, `^{...}`, `~{...}`) the sequence `<!--` is
 * NOT a comment and falls through as raw text.
 */
import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";

function split(source) {
  return splitBlocks("test.scrml", source).blocks;
}

function splitWithErrors(source) {
  return splitBlocks("test.scrml", source);
}

describe("BS HTML-comment skip — §27.2 + §4.7-amend", () => {
  test("<!-- ... --> at top level produces a comment block (no tag recognition)", () => {
    const blocks = split("<!-- a simple html comment -->\n");
    expect(blocks).toHaveLength(2); // comment + trailing text/newline-text
    expect(blocks[0].type).toBe("comment");
    expect(blocks[0].raw).toBe("<!-- a simple html comment -->");
  });

  test("<!-- <program> --> does NOT open a real <program> context", () => {
    // The fake <program> inside the comment must NOT be parsed as a structural
    // opener. The result is one comment block + one real <program> block.
    const blocks = split("<!-- <program> -->\n<program></program>");
    // [comment, text(newline), program] OR [comment, program] depending on
    // text-flush behavior — assert by filtering out trailing whitespace text.
    const meaningful = blocks.filter(
      (b) => !(b.type === "text" && b.raw.trim() === "")
    );
    expect(meaningful).toHaveLength(2);
    expect(meaningful[0].type).toBe("comment");
    expect(meaningful[1].type).toBe("markup");
    expect(meaningful[1].name).toBe("program");
  });

  test("<!-- </program> --> does NOT close an open <program> context", () => {
    // Inside <program> body, the fake </program> in the HTML comment must NOT
    // pop the program frame. The trailing real </program> is what closes it.
    const blocks = split("<program><!-- </program> -->real</program>");
    expect(blocks).toHaveLength(1);
    const prog = blocks[0];
    expect(prog.type).toBe("markup");
    expect(prog.name).toBe("program");
    expect(prog.closerForm).toBe("explicit");
    // The body has [comment, text("real")] as children
    const comment = prog.children.find((c) => c.type === "comment");
    expect(comment).toBeDefined();
    expect(comment.raw).toBe("<!-- </program> -->");
  });

  test("<!-- <channel name='foo'> --> does NOT open a real <channel>", () => {
    // S87 dispatch repro shape: BS used to misparse the <channel> inside
    // an HTML comment as a real channel opener and then fail with E-CTX-001
    // when </program> tried to close the still-open <channel>.
    const result = splitWithErrors(
      "<program>\n  <!-- The user can write <channel name=\"foo\"> in their docs -->\n  <div>real</div>\n</program>"
    );
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].name).toBe("program");
    expect(result.blocks[0].closerForm).toBe("explicit");
  });

  test("mixed: real opener AFTER a commented-out opener", () => {
    // Validates that the comment skip does not corrupt the scanner's
    // position tracking — the real <p> after the comment must parse cleanly.
    const blocks = split("<!-- <p>fake</p> --><p>real</>");
    const meaningful = blocks.filter(
      (b) => !(b.type === "text" && b.raw.trim() === "")
    );
    expect(meaningful).toHaveLength(2);
    expect(meaningful[0].type).toBe("comment");
    expect(meaningful[1].type).toBe("markup");
    expect(meaningful[1].name).toBe("p");
    expect(meaningful[1].children[0].raw).toBe("real");
  });

  test("<!-- inside ${ ... } is NOT a comment (raw text)", () => {
    // Per scope rule: HTML-comment skip applies only at markup/state/root
    // context. Inside a logic block, `<!--` is just characters in JS source.
    // The whole `${...}` is a single logic block; no comment block appears.
    const blocks = split("${ const s = '<!-- not a comment -->'; }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
    // No nested comment block was emitted inside the logic body.
    expect(blocks[0].children.find((c) => c.type === "comment")).toBeUndefined();
  });

  test("<!-- inside double-quoted string is NOT a comment", () => {
    // Quote-state guard: the global double-quote tracker must suppress
    // comment recognition when we're inside `"..."`.
    const blocks = split('<p title="<!-- literal -->">hi</>');
    // Should be one markup block — no spurious comment block.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("markup");
    expect(blocks[0].name).toBe("p");
  });

  test("multi-line <!-- ... --> spans lines correctly", () => {
    // The comment scan must consume newlines until the first '-->'.
    const src = "<!-- line1\nline2\n<program>\nline3 -->\n<p>real</>";
    const result = splitWithErrors(src);
    expect(result.errors).toHaveLength(0);
    const meaningful = result.blocks.filter(
      (b) => !(b.type === "text" && b.raw.trim() === "")
    );
    expect(meaningful).toHaveLength(2);
    expect(meaningful[0].type).toBe("comment");
    expect(meaningful[0].raw).toContain("<program>");
    expect(meaningful[1].type).toBe("markup");
    expect(meaningful[1].name).toBe("p");
  });

  test("regression guard: existing // line-comment behavior unchanged", () => {
    // §4.7 `//` skip must continue to work exactly as before — the new
    // <!-- skip is additive, not a replacement.
    const blocks = split("// <program>\n<program></program>");
    const meaningful = blocks.filter(
      (b) => !(b.type === "text" && b.raw.trim() === "")
    );
    expect(meaningful).toHaveLength(2);
    expect(meaningful[0].type).toBe("comment");
    expect(meaningful[0].raw).toBe("// <program>\n");
    expect(meaningful[1].type).toBe("markup");
    expect(meaningful[1].name).toBe("program");
  });

  test("unclosed <!-- runs to EOF without throwing (best-effort recovery)", () => {
    // Mirrors `//`-at-EOF behavior: best-effort, no synthetic error.
    // Downstream stages will surface real problems if structure is broken.
    const result = splitWithErrors("<!-- unclosed comment runs to end");
    // No throw; one comment block produced.
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("comment");
  });
});

// ---------------------------------------------------------------------------
// R28-BUG-3 (S143) — a leading `//` comment between a compound-state-decl
// parent opener and its first structural child broke compound-vs-markup
// classification, surfacing W-PROGRAM-001 + E-CTX-001/E-CTX-003 on the
// `:`-shorthand-engine kickstarter shape. The compound-auto-lift recognizers
// (classifyOpenerForCompoundScan + scanCompoundBlockEnd) skipped only
// whitespace when locating the first/next structural child; per SPEC §27.1
// `//` is universal trivia and must be skipped too.
//
// Working repro (kickstarter §4.1 Mario flagship shape) — the SAME source
// WITHOUT the comment, OR with bodied `</>` state-children, already compiled
// clean; the `//` comment is the standalone co-trigger.
// ---------------------------------------------------------------------------
describe("BS R28-BUG-3 — // comment before :-shorthand engine in a compound body", () => {
  test("div compound body: // comment + :-shorthand engine → no errors", () => {
    const src = [
      "<div>",
      "  // comment before colon-shorthand engine",
      "  <engine for=S initial=.A>",
      "    <A rule=.B> : \"a\"",
      "    <B rule=.A> : \"b\"",
      "  </>",
      "  <p>x</p>",
      "</div>",
    ].join("\n");
    const result = splitWithErrors(src);
    // The compound-auto-lift path gobbles the whole `<div>...</div>` span as a
    // single text block (re-parsed downstream). Crucially: zero BS errors —
    // pre-fix this fired E-CTX-001 (</div> tries to close <engine>) +
    // E-CTX-003 (unclosed div) because <div> was pushed as a never-closing
    // markup context.
    expect(result.errors).toHaveLength(0);
    const meaningful = result.blocks.filter(
      (b) => !(b.type === "text" && b.raw.trim() === "")
    );
    expect(meaningful).toHaveLength(1);
    expect(meaningful[0].type).toBe("text");
    expect(meaningful[0].raw).toContain("<div>");
    expect(meaningful[0].raw).toContain("</div>");
  });

  test("program compound body: // comment + :-shorthand engine → no errors", () => {
    const src = [
      "<program title=\"T\">",
      "<div>",
      "  // comment before colon-shorthand engine",
      "  <engine for=S initial=.A>",
      "    <A rule=.B> : \"a\"",
      "    <B rule=.A> : \"b\"",
      "  </>",
      "  <p>x</p>",
      "</div>",
      "</program>",
    ].join("\n");
    const result = splitWithErrors(src);
    expect(result.errors).toHaveLength(0);
    // The single <program> root survives (pre-fix the root was lost →
    // W-PROGRAM-001 downstream).
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("markup");
    expect(result.blocks[0].name).toBe("program");
    expect(result.blocks[0].closerForm).toBe("explicit");
  });

  test("parity: SAME source WITHOUT the comment also has no errors", () => {
    // Confirms the fix preserves the pre-existing clean path (the comment was
    // the standalone co-trigger; the non-comment shape must stay green).
    const src = [
      "<div>",
      "  <engine for=S initial=.A>",
      "    <A rule=.B> : \"a\"",
      "    <B rule=.A> : \"b\"",
      "  </>",
      "  <p>x</p>",
      "</div>",
    ].join("\n");
    const result = splitWithErrors(src);
    expect(result.errors).toHaveLength(0);
  });

  test("/* block */ comment before :-shorthand engine in a compound body → no errors", () => {
    // `/* */` is also universal trivia (SPEC §27.2 logic/CSS native form,
    // accepted everywhere via the same skip). Guards the block-comment arm of
    // skipTriviaForCompoundScan.
    const src = [
      "<div>",
      "  /* block comment before engine */",
      "  <engine for=S initial=.A>",
      "    <A rule=.B> : \"a\"",
      "  </>",
      "</div>",
    ].join("\n");
    const result = splitWithErrors(src);
    expect(result.errors).toHaveLength(0);
  });

  test("comment body containing `<` and quotes does not derail the span scan", () => {
    // scanCompoundBlockEnd must skip the comment body so an embedded `<foo>`
    // or quote char cannot corrupt the depth/string tracking of the span.
    const src = [
      "<div>",
      "  // see <foo> and \"bar\" before the engine",
      "  <engine for=S initial=.A>",
      "    <A rule=.B> : \"a\"",
      "  </>",
      "</div>",
    ].join("\n");
    const result = splitWithErrors(src);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// jwt-auth-bypass (2026-07-11, HIGH) — `/* ... */` block-comment skip INSIDE a
// brace context.
//
// The main scan loop skipped `//` line comments but NOT `/* */` block comments
// inside brace-delimited contexts. A JSDoc `/** ... */` in a `${...}` logic
// block had its interior scanned char-by-char:
//   - a `Promise<string>` / `<string>` inside it was mis-read as a markup
//     tag-opener → `frame.tagNesting++` that never decrements → the leaked
//     tagNesting propagated onto every subsequent `!{...}` error-effect child
//     BLOCK_REF → collectExpr's `tok.block?.tagNesting === 0` statement-boundary
//     break was BYPASSED → the failable handler was ABSORBED into the preceding
//     expression → "statement boundary not detected" drop that discarded the
//     rest of the module's export set (an unawaited-Promise auth bypass, issue
//     #26 class, on the JWT path).
//   - a literal `!{}` in the comment prose spawned a SPURIOUS error-effect child.
//
// The fix skips `/* … */` as a `comment` block inside brace contexts (mirroring
// the `//` handler), making the comment interior inert.
// ---------------------------------------------------------------------------
describe("BS /* */ block-comment skip inside brace contexts — jwt-auth-bypass", () => {
  function firstLogic(source) {
    const blocks = split(source);
    const logic = blocks.find((b) => b.type === "logic");
    expect(logic).toBeDefined();
    return logic;
  }

  test("/* Promise<string> */ in a ${} does NOT leak tagNesting onto a later !{}", () => {
    // The `<string>` inside the block comment must NOT be read as a tag-opener.
    // Pre-fix the later `!{...}` error-effect carried tagNesting = 1.
    const src = [
      "${",
      "  /** @returns Promise<string> — a doc comment */",
      "  const x = risky() !{",
      "    | ::Thrown(m, n) -> { return 0 }",
      "  }",
      "}",
    ].join("\n");
    const logic = firstLogic(src);
    const ee = logic.children.filter((c) => c.type === "error-effect");
    // Exactly ONE error-effect (the real handler) — no spurious one.
    expect(ee).toHaveLength(1);
    // The real handler carries NO leaked tag-nesting (undefined or 0).
    expect(ee[0].tagNesting ?? 0).toBe(0);
    // The block comment was extracted as a comment child (inert interior).
    const comments = logic.children.filter((c) => c.type === "comment");
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some((c) => c.raw.includes("Promise<string>"))).toBe(true);
  });

  test("a literal !{} inside a block comment does NOT spawn a spurious error-effect", () => {
    const src = [
      "${",
      "  /* normalized to {valid:false} by the !{} handler */",
      "  const x = risky() !{",
      "    | ::Thrown(m, n) -> { return 0 }",
      "  }",
      "}",
    ].join("\n");
    const logic = firstLogic(src);
    const ee = logic.children.filter((c) => c.type === "error-effect");
    // Only the REAL handler — the `!{}` in the comment prose is inert.
    expect(ee).toHaveLength(1);
    expect(ee[0].raw).toContain("::Thrown");
  });

  test("multi-line block comment with sigils/tags spans correctly and stays inert", () => {
    const src = [
      "${",
      "  /**",
      "   * Uses ${x} interpolation and <Foo> markup and a !{} handler",
      "   * across multiple lines.",
      "   */",
      "  const y = call() !{ | ::Thrown(m, n) -> { return 1 } }",
      "}",
    ].join("\n");
    const logic = firstLogic(src);
    const ee = logic.children.filter((c) => c.type === "error-effect");
    expect(ee).toHaveLength(1);
    expect(ee[0].tagNesting ?? 0).toBe(0);
    // No spurious logic child from the `${x}` inside the comment.
    const nestedLogic = logic.children.filter((c) => c.type === "logic");
    expect(nestedLogic).toHaveLength(0);
  });

  test("/* */ INSIDE a string literal is NOT treated as a comment", () => {
    // openStringQuoteAt guard: a `/*` inside `"..."` on the current line is
    // string content, mirroring the `//` handler's string guard.
    const src = '${ const s = "a /* not a comment */ b" }';
    const logic = firstLogic(src);
    const comments = logic.children.filter((c) => c.type === "comment");
    expect(comments).toHaveLength(0);
  });

  test("regression: // line-comment skip inside ${} still works (additive)", () => {
    // The new /* */ arm must not disturb the pre-existing `//` handling.
    const src = [
      "${",
      "  // returns Promise<string>",
      "  const z = risky() !{ | ::Thrown(m, n) -> { return 2 } }",
      "}",
    ].join("\n");
    const logic = firstLogic(src);
    const ee = logic.children.filter((c) => c.type === "error-effect");
    expect(ee).toHaveLength(1);
    expect(ee[0].tagNesting ?? 0).toBe(0);
  });
});
