/**
 * ss4 item 2 — engine state-child scanner: `<!-- -->` HTML comments must be
 * opaque to the state-child walker.
 *
 * Authored S209 2026-06-20 (sPA ss4 block-splitter-native-parser).
 *
 * Bug (g-blocksplitter-comment-span-not-opaque, engine locus): the walker
 * helper `skipCommentOrString` recognized `//`, `/* *​/`, `"..."`, `'...'`, and
 * backtick literals but NOT `<!-- ... -->`. So a comment containing an odd
 * quote / apostrophe / backtick opened a phantom string that swallowed every
 * subsequent state-child → a spurious E-ENGINE-STATE-CHILD-MISSING for each
 * variant. Mentions of `</Variant>` / `<tag>` inside a comment were likewise
 * not opaque. Fixed by adding an HTML-comment branch to `skipCommentOrString`;
 * `computeCommentRegions` (built on it) inherits the fix.
 *
 * ⚑ CURRENCY NOTE (S405) — THE PARAGRAPH ABOVE IS HISTORY, NOT THE CURRENT
 * CONTRACT. It is left in the past tense on purpose because it records why this
 * file exists, but `skipCommentOrString` no longer recognizes `"..."`, `'...'`
 * or backtick literals at all: those branches were DELETED at S405 (SPEC
 * §4.18.3 — `"` is the only string delimiter in scrml and `'` / backtick are
 * ordinary interior characters). The helper's live region set is exactly
 * `//`, `/* *​/`, `<!-- -->`. The tests below are unaffected — they assert that
 * an HTML comment is opaque, which is still true and is now the ONLY reason the
 * quote characters inside these fixtures are harmless. Current behaviour is
 * specified in
 * `compiler/tests/integration/engine-statechild-prose-punctuation.test.js`.
 *
 * Empirically confirmed at the e2e layer too: the block-splitter already
 * captures the engine body + children intact (its `skipHtmlComment` is correct)
 * — the defect was solely in the engine-statechild-parser walker.
 *
 * CORRECTION (ss39 item 1, g-markup-comment-angle-bracket-parsed-as-tag): the
 * original header claimed the sibling `<match>` arm scanner was "NOT affected".
 * That was wrong — the match scanner had NO comment handling at all, so an
 * angle-bracket fragment inside an arm-body comment was consumed as a tag,
 * mis-firing E-MATCH-PARSE-001. Fixed by adding `skipMatchComment` to
 * match-statechild-parser.ts; covered by
 * match-arm-comment-angle-bracket-opacity.test.js.
 */

import { describe, expect, test } from "bun:test";
import { parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";

// The body raw is the content BETWEEN `<engine ...>` and its `</>`.
const tagsOf = (body) => parseEngineStateChildren(body).map((e) => e.tag);

describe("engine state-child scanner — comment opacity (ss4 item 2)", () => {
  test("odd double-quote inside a comment BEFORE children does not swallow them", () => {
    const body = `
      <!-- odd quote " here -->
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("odd apostrophe inside a comment is opaque", () => {
    const body = `
      <!-- can't stop -->
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("odd backtick inside a comment is opaque", () => {
    const body = `
      <!-- a backtick \` here -->
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("`</Variant>` and `<tag>` mentions inside a comment are not read as structure", () => {
    const body = `
      <!-- mentions </Small> and a <stray> tag -->
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("comment with an odd quote BETWEEN children does not swallow the trailing one", () => {
    const body = `
      <Small rule=.Big></>
      <!-- odd quote " between -->
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("balanced quotes in a comment still parse (regression guard)", () => {
    const body = `
      <!-- balanced "two" quotes -->
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });

  test("baseline: no comment, children detected", () => {
    const body = `
      <Small rule=.Big></>
      <Big rule=.Small></>
    `;
    expect(tagsOf(body)).toEqual(["Small", "Big"]);
  });
});
