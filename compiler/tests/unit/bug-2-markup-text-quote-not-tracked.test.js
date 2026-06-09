/**
 * bug-2-markup-text-quote-not-tracked.test.js — Bug 2 C-narrow implementation:
 * markup-text mode no longer tracks string state. Sibling locus argument to
 * Bug 4 C-narrow (S108) — strings live in Logic context + attribute-value
 * scope, not in markup-text body.
 *
 * S109 close per investigation in `handOffs/incoming/read/2026-05-19-0614-side-session-to-scrmlTS-PA-dogfood-bug-surface.md` §"Bug 2".
 *
 * Pre-S109 (the bug): an unpaired `'` or `"` in markup-text body toggled a
 * global string-mode flag in `block-splitter.js`; the rest of the file was
 * consumed as raw content until the matching quote appeared. Adopter case:
 * `<code>X</code>'s` (possessive apostrophe-s) silently broke compilation
 * with `E-CTX-003: Unclosed 'p'` cascades pointing at the wrong line.
 *
 * Post-S109: markup-text body is text. Apostrophes and quote marks are
 * literal characters. The bare-`/` closer heuristic at line ~1973 is
 * unaffected — it already required next-non-whitespace == `<` or EOF, so
 * plain `/` in text doesn't fire E-SYNTAX-050 anyway.
 *
 * Coverage:
 *   §1  reducer cases — the bisected minimal triggers
 *   §2  adopter pattern — possessive apostrophe-s after entity-encoded content
 *   §3  double-quote case — symmetric to single-quote
 *   §4  paired-quote still works — pre-fix legitimate use unaffected
 *   §5  contractions still fine — pre-fix word-letter-prefix mitigation preserved
 *   §6  bare-`/` heuristic unchanged — plain `/` in text still inert
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";

function split(src) {
  return splitBlocks("/tmp/test.scrml", src);
}

// ---------------------------------------------------------------------------
// §1: Reducer cases — minimum triggers from the bisecting investigation
// ---------------------------------------------------------------------------

describe("§1: minimal reducers — unpaired quote in markup-text no longer breaks compilation", () => {
  test("`<p>text 'a</p>` — single apostrophe with non-letter prefix compiles cleanly", () => {
    const { blocks, errors } = split("<p>text 'a</p>");
    expect(errors).toEqual([]);
    expect(blocks.length).toBeGreaterThan(0);
  });

  test("`<p>text 'with apostrophe</p>` (multi-line shape) compiles cleanly", () => {
    const src = "<p>\n    text 'with apostrophe\n</p>";
    const { errors } = split(src);
    expect(errors).toEqual([]);
  });

  test("`<p><code>X</code>'s</p>` — possessive apostrophe-s after close tag", () => {
    const { errors } = split("<p><code>X</code>'s</p>");
    expect(errors).toEqual([]);
  });

  test("`<p><code>X</code>'a</p>` — any letter after `'`, not just `s`", () => {
    const { errors } = split("<p><code>X</code>'a</p>");
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2: Adopter pattern — original Bug 2 dogfood report shape
// ---------------------------------------------------------------------------

describe("§2: adopter pattern — entity-encoded content + possessive apostrophe-s", () => {
  test("`<code>&lt;program&gt;</code>'s` pattern in `<p>` compiles cleanly", () => {
    const src =
      "<p>\n" +
      "    Promotes a child template into its parent\n" +
      "    <code class=\"font-mono\">&lt;program&gt;</code>'s\n" +
      "    shell slot.\n" +
      "</p>";
    const { errors } = split(src);
    expect(errors).toEqual([]);
  });

  test("nested header + p + code + apostrophe-s + adjacent prose compiles cleanly", () => {
    const src =
      "<header>\n" +
      "    <p class=\"text-lg\">\n" +
      "        Promotes into\n" +
      "        <code>&lt;program&gt;</code>'s\n" +
      "        shell.\n" +
      "    </p>\n" +
      "</header>";
    const { errors } = split(src);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3: Double-quote case — symmetric to single-quote
// ---------------------------------------------------------------------------

describe("§3: double-quote in markup-text body is also literal text", () => {
  test("`<p>text \"with double quote</p>` compiles cleanly", () => {
    const src = '<p>\n    text "with double quote\n</p>';
    const { errors } = split(src);
    expect(errors).toEqual([]);
  });

  test("`<p>He said \"hi</p>` (unpaired double quote, dialog fragment) compiles", () => {
    const { errors } = split('<p>He said "hi</p>');
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4: Paired-quote cases — legitimate use unaffected
// ---------------------------------------------------------------------------

describe("§4: paired quotes in markup-text compile cleanly (regression guard)", () => {
  test("`<p>text 'with paired' apostrophe</p>` compiles cleanly", () => {
    const { errors } = split("<p>text 'with paired' apostrophe</p>");
    expect(errors).toEqual([]);
  });

  test("`<p>He said \"hello\" to me.</p>` compiles cleanly", () => {
    const { errors } = split('<p>He said "hello" to me.</p>');
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5: Contractions — common English shape, regression guard
// ---------------------------------------------------------------------------

describe("§5: contractions in markup-text compile cleanly (carry-forward guard)", () => {
  test("`<p>it's a test</p>` (contraction)", () => {
    const { errors } = split("<p>it's a test</p>");
    expect(errors).toEqual([]);
  });

  test("`<p>we'll see; can't say; won't.</p>` (multiple contractions)", () => {
    const { errors } = split("<p>we'll see; can't say; won't.</p>");
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6: Bare-`/` heuristic — unchanged behavior in markup-text
// ---------------------------------------------------------------------------

describe("§6: bare-`/` heuristic still works without string-mode protection", () => {
  test("`<p>plain text with / slash here</p>` — `/` mid-text is literal (regression guard)", () => {
    const { errors } = split("<p>plain text with / slash here</p>");
    expect(errors).toEqual([]);
  });

  test("`<p>a/b path</p>` — `/` between alphanumerics still literal", () => {
    const { errors } = split("<p>a/b path</p>");
    expect(errors).toEqual([]);
  });

  // S177 bug-4 — the legacy bare-`/`-closer heuristic was REFINED: a `/`
  // immediately before a REAL CLOSE TAG (`</...`) is literal text, NOT a closer
  // attempt (a real closer is already present). Only `/` at EOF or `/` before a
  // NEW OPENER (`<name`) still fires. The CONF-015 canonical contract (EOF) is
  // preserved (see §6b below); the slash-before-close-tag over-fire is gone.
  test("`<p>hello/</p>` — bare `/` before a CLOSE tag is literal text (S177 bug-4, was over-firing)", () => {
    const { errors } = split("<p>hello/</p>");
    const e050 = errors.find((e) => e.code === "E-SYNTAX-050");
    expect(e050).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §6b: bare-`/` heuristic still fires for the GENUINE legacy-closer shapes
//       (EOF + before-new-opener) — S177 bug-4 regression guards
// ---------------------------------------------------------------------------

describe("§6b: bare-`/`-closer still flagged for genuine legacy shapes (S177 bug-4)", () => {
  test("`<p>hello/` — `/` at EOF still fires E-SYNTAX-050 (CONF-015 canonical)", () => {
    const { errors } = split("<p>hello" + "/");
    expect(errors.some((e) => e.code === "E-SYNTAX-050")).toBe(true);
  });

  test("`<div>content/<li>x</li></div>` — `/` before a NEW OPENER still fires E-SYNTAX-050", () => {
    const { errors } = split("<div>content/<li>x</li></div>");
    expect(errors.some((e) => e.code === "E-SYNTAX-050")).toBe(true);
  });

  test("`<li>… defined /</>` — `/` before a generic close `</>` is literal (bug-4 reproducer)", () => {
    const { errors } = split("<li>The values \"\" / 0 / [] are all defined /</>");
    expect(errors.some((e) => e.code === "E-SYNTAX-050")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7: Inside braces — string tracking still active for Logic context
// ---------------------------------------------------------------------------

describe("§7: inside braces / Logic context — string handling preserved", () => {
  test("`${ const x = 'hi' }` — apostrophe-paired string in Logic still parses", () => {
    const { blocks } = split("${ const x = 'hi' }");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("logic");
  });

  test("`${ const x = 'unclosed` — unclosed string in Logic stays inside the logic block", () => {
    // Whatever the error surface ends up being, it should NOT cascade out into
    // markup-text eating the rest of the file (that would be a regression of
    // a different sort — the markup-text-isn't-string-mode property).
    const src = "${ const x = 'unclosed }\n<p>after</p>";
    const { blocks } = split(src);
    // After the logic block, `<p>` should still be recognized as a markup
    // open / start of a new sibling node — i.e. not consumed as part of the
    // logic block.
    const hasMarkupAfter = blocks.some(
      (b) => b.type === "state" || b.type === "markup"
    );
    expect(hasMarkupAfter).toBe(true);
  });
});
