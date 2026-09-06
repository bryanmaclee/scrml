/**
 * g-engine-state-child-apostrophe-breaks-parse (routed by peter S398, fixed S402)
 *
 * Generalization of `g-match-arm-apostrophe-bs` (RESOLVED S196) to the
 * `<engine>` state-child locus.
 *
 * THE DEFECT. `parseEngineStateChildren`'s body scanners (engine-statechild-
 * parser.ts) shared one `skipCommentOrString` helper that treated `'` / `"` /
 * `` ` `` as string-span openers at MARKUP-BODY level. A single contraction in
 * state-child prose —
 *
 *     <B><p>it's ready</p></>
 *
 * — opened a phantom string that consumed the `</p>` and `</>` closers through
 * to EOF, so `findStateChildCloser` returned -1, `<B>` was dropped from the
 * parse, and SYM reported `E-ENGINE-STATE-CHILD-MISSING` naming a variant that
 * is plainly present in source. An EVEN number of apostrophes "closed" the
 * phantom span and the same program compiled clean — that asymmetry is the
 * proof the scan was string-lexing prose rather than reading structure.
 *
 * THE GOVERNING TEXT (this is a conformance restoration, not a widening):
 *   - SPEC §4.18.3 — "The double-quote is the **only** display-text-literal
 *     delimiter … The apostrophe `'` is an **ordinary interior character** …
 *     The backtick is likewise an ordinary interior character and is NOT a
 *     display-text delimiter."
 *   - SPEC §4.18.1 / §4.18.2 — a plain-markup element opened INSIDE a
 *     code-default body opens its OWN **free-text** body; "a bare run of prose
 *     in a `<p>` body is display text, unchanged".
 *   - SPEC §4.17 orthogonality note (S111) — a plain-markup child opened inside
 *     a code-default body "opens a free-text body".
 *
 * THE SCOPE BOUNDARY. The state-child body ITSELF is code-default (§4.18.1).
 * The fix is confined to the CLOSER-FINDING SCAN; it must not change how a body
 * is CLASSIFIED once found. The `boundary` describe block below pins that: an
 * apostrophised bare run directly in a state-child body must parse with exactly
 * the same acceptance as its apostrophe-free twin — the apostrophe must be
 * structurally inert, neither newly-rejecting nor newly-accepting on its own.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import {
  parseEngineStateChildren,
  scanForNestedEngineEntries,
  scanForOnTransitionEntries,
  scanForOnTimeoutEntries,
} from "../../src/engine-statechild-parser.ts";
import fs from "fs";
import path from "path";
import os from "os";

/** Compile a source string; return error codes + the emitted client JS. */
function compileSrc(src, basename = "eng-apos") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eng-apos-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    const r = compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
      log: () => {},
    });
    const clientPath = path.join(tmpDir, `${basename}.client.js`);
    return {
      codes: (r.errors ?? []).map((e) => e.code),
      client: fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf-8") : null,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The brief's canonical two-variant engine, with `<B>`'s body substituted. */
function engineWithBBody(bBody) {
  return (
    `type S:enum = { A, B }\n` +
    `<engine for=S initial=.A>\n` +
    `    <A rule=.B><p>go</p></>\n` +
    `    <B>${bBody}</>\n` +
    `</>\n`
  );
}

describe("g-engine-state-child-apostrophe — the three-way table", () => {
  // The three fixtures peter filed. Pre-fix: odd FAILED, even + control passed.
  // The even-count control is the whole diagnosis — an even number of
  // apostrophes "closes" the phantom string so the body scan recovers.

  test("ODD (1 apostrophe) — `it's ready` in a nested <p> compiles", () => {
    const { codes } = compileSrc(engineWithBBody(`<p>it's ready</p>`));
    expect(codes).toEqual([]);
  });

  test("EVEN (2 apostrophes) — `it's here, don't leave` compiles", () => {
    const { codes } = compileSrc(engineWithBBody(`<p>it's here, don't leave</p>`));
    expect(codes).toEqual([]);
  });

  test("CONTROL (0 apostrophes) — `it is ready` compiles", () => {
    const { codes } = compileSrc(engineWithBBody(`<p>it is ready</p>`));
    expect(codes).toEqual([]);
  });

  test("all three emit the author's prose verbatim (the fix is a SCAN fix, not a rewrite)", () => {
    expect(compileSrc(engineWithBBody(`<p>it's ready</p>`)).client)
      .toContain("<p>it's ready</p>");
    expect(compileSrc(engineWithBBody(`<p>it's here, don't leave</p>`)).client)
      .toContain("<p>it's here, don't leave</p>");
    expect(compileSrc(engineWithBBody(`<p>it is ready</p>`)).client)
      .toContain("<p>it is ready</p>");
  });

  test("the ODD case no longer reaches E-ENGINE-STATE-CHILD-MISSING", () => {
    // The second defect in peter's report: the diagnostic told the author to
    // "Add the missing state-child (`<B>...</>`)" when `<B>` was right there —
    // an un-followable remedy that never named the apostrophe. The parse fix
    // makes it unreachable FOR THIS INPUT; its fire condition is untouched and
    // it still fires on a genuinely-missing child (asserted below).
    const { codes } = compileSrc(engineWithBBody(`<p>it's ready</p>`));
    expect(codes).not.toContain("E-ENGINE-STATE-CHILD-MISSING");
  });
});

describe("g-engine-state-child-apostrophe — real UI contractions", () => {
  // Real adopter copy, not synthetic apostrophes. Odd counts throughout.
  const copy = [
    ["don't", `<p>don't</p>`],
    ["we'll", `<p>we'll try again</p>`],
    ["can't", `<p>can't reach the server</p>`],
    ["three contractions (odd count)", `<p>don't, we'll, can't</p>`],
    ["possessive", `<p>the user's session expired</p>`],
    ["contraction + interpolation", `<p>we'll retry \${1} times</p>`],
    ["contraction across two nested elements", `<div><span>it's</span><em>don't</em></div>`],
    ["contraction inside a <button> label", `<button>Don't cancel</button>`],
  ];

  for (const [label, body] of copy) {
    test(`${label} — compiles`, () => {
      expect(compileSrc(engineWithBBody(body)).codes).toEqual([]);
    });
  }
});

describe("g-engine-state-child-apostrophe — the sibling delimiter that IS fixed", () => {
  // SPEC §4.18.3 names TWO characters as ordinary interior characters with no
  // delimiter role: the apostrophe AND the backtick. Both are fixed here.
  // The double-quote is deliberately NOT in that list — see the next block.

  test("unpaired backtick in nested free-text prose", () => {
    expect(compileSrc(engineWithBBody("<p>use ` here</p>")).codes).toEqual([]);
  });

  test("backtick and apostrophe together", () => {
    expect(compileSrc(engineWithBBody("<p>don't use ` here</p>")).codes).toEqual([]);
  });
});

describe('g-engine-state-child-apostrophe — `"` KEEPS its span role (review finding 3)', () => {
  // ⚑ SCOPE FENCE. The first cut of this fix dropped `"` as a span delimiter
  // alongside `'` and backtick. That was wrong on the governing text and it
  // regressed two separate surfaces. SPEC §4.18.3 gives `"` a delimiter role
  // that `'` and backtick do not have:
  //
  //   "The double-quote is the **only** display-text-literal delimiter … The
  //    apostrophe `'` is an **ordinary interior character** … The backtick is
  //    likewise an ordinary interior character and is NOT a display-text
  //    delimiter."
  //
  // A state-child body is CODE-DEFAULT (§4.18.1), so `"…"` there IS a delimited
  // display-text literal, not prose; §5.1 gives `"` the same role in attribute
  // values. These tests pin that `"` handling is what it was before this fix.

  test("a display-text literal containing a markup token keeps its state-child", () => {
    // Reviewer's repro. First cut: `[]` — the state-child was LOST.
    // Base and the shipped fix: `["A"]`.
    const entries = parseEngineStateChildren('<A rule=.B>"Wrap it in a <p> tag"</>');
    expect(entries.map((e) => e.tag)).toEqual(["A"]);
  });

  test("...and does not eat a FOLLOWING sibling state-child", () => {
    // First cut: `["B"]` — `<A>` was lost. Base and the shipped fix: both.
    const entries = parseEngineStateChildren(
      '\n    <A rule=.B>"Wrap it in a <p> tag"</>\n    <B><p>ok</p></>\n',
    );
    expect(entries.map((e) => e.tag)).toEqual(["A", "B"]);
  });

  test("a display-text literal with apostrophes / escapes / interpolation compiles", () => {
    expect(compileSrc(engineWithBBody(`"Don't panic - it's fine"`)).codes).toEqual([]);
    expect(compileSrc(engineWithBBody(`"say \\"hi\\" now"`)).codes).toEqual([]);
    expect(compileSrc(engineWithBBody('"Loaded ${1} rows"')).codes).toEqual([]);
  });

  test('PRE-EXISTING, NOT FIXED HERE — an unpaired `"` in NESTED free-text prose', () => {
    // `<p>The 6" pipe</p>` inside a state-child body still fails, IDENTICALLY
    // to base. §4.18.1/§4.18.2 say that nested `<p>` body is free-text, so the
    // inch mark IS display text and this SHOULD compile — but closing it needs
    // body-mode NESTING awareness these flat scanners do not have, and the
    // first cut's attempt to get it by dropping the span wholesale is precisely
    // what broke the two surfaces above. Filed as its own gap.
    //
    // This pins the CURRENT boundary, not a desired one. If a later change
    // makes these compile, that is progress — update the test, and keep the
    // reasoning above.
    expect(compileSrc(engineWithBBody(`<p>The 6" pipe</p>`)).codes)
      .toContain("E-ENGINE-STATE-CHILD-MISSING");
    expect(compileSrc(engineWithBBody(`<p>She said "hi</p>`)).codes)
      .toContain("E-ENGINE-STATE-CHILD-MISSING");
  });
});

describe("g-engine-state-child-apostrophe — a comment token in an attribute value is DATA (review findings 1+2)", () => {
  // ⚑ The two findings are ONE bug: finding 2 is the mechanism, finding 1 the
  // observable consequence.
  //
  // `computeCommentRegions` (the mask behind the <onTimeout>/<onIdle> regex
  // scans) and the `while (scanned < lt)` re-scan loops walk byte-by-byte with
  // no opener-awareness and no `${…}` skip. Before `skipOpaqueSpan`, the only
  // thing keeping them out of an attribute value was the string-span skip — an
  // ACCIDENTAL shield. The first cut narrowed the span rules and un-shielded
  // them: a `//`, `/*` or `<!--` inside an attribute value became a live
  // comment opener that ran to end-of-line (or to EOF) and swallowed the
  // following structural element **at exit 0, with no diagnostic**.
  //
  // The shield is now structural — those regions are opaque because of what
  // they ARE, not because of which quote happens to delimit them. Every case
  // below LOST its element in the first cut and emits it on base and on ship.

  const withTimer = (aBody) =>
    "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
    "    <A rule=.B>" + aBody + "\n      <onTimeout after=5s to=.B/></>\n" +
    "    <B><p>ok</p></>\n</>\n";

  const timerCases = [
    ["a URL in href, timer on the SAME line", '<a href="//cdn.example.com/x">go</a>'],
    ["a `/*` in a double-quoted attribute", '<a title="a /* b">go</a>'],
    ["a `<!--` in a double-quoted attribute", '<a title="a <!-- b">go</a>'],
    ["a `//` in a double-quoted attribute", '<a title="a // b">go</a>'],
    ["a `/*` in a SINGLE-quoted attribute (non-canonical, still data)", "<a title='a /* b'>go</a>"],
    ["a `<!--` in a SINGLE-quoted attribute", "<a title='a <!-- b'>go</a>"],
    ["a `/*` in a single-quoted string inside ${}", "<p>${ ['/* x'].join(\"\") }</p>"],
    ["a `<!--` in a single-quoted string inside ${}", "<p>${ ['<!-- x'].join(\"\") }</p>"],
    ["a `/*` in a backtick template inside ${}", "<p>${ [`/* x`].join(\"\") }</p>"],
  ];

  for (const [label, aBody] of timerCases) {
    test(`${label} — the following <onTimeout> still fires`, () => {
      const { codes, client } = compileSrc(withTimer(aBody));
      expect(codes).toEqual([]);
      expect(client).toContain("5000");
    });
  }

  test("an engine-root <onIdle> after an attribute comment token still fires", () => {
    const src =
      "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
      '    <A rule=.B><a title="a /* b">go</a></>\n' +
      "    <B><p>ok</p></>\n" +
      "    <onIdle after=9s to=.A/>\n</>\n";
    const { codes, client } = compileSrc(src);
    expect(codes).toEqual([]);
    expect(client).toContain("9000");
  });

  test("an engine-direct <onTransition> after an attribute comment token still fires", () => {
    const src =
      "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
      '    <A rule=.B><a title="a /* b">go</a></>\n' +
      "    <B><p>ok</p></>\n" +
      '    <onTransition from=.A to=.B>${ console.log("MOVED") }</onTransition>\n</>\n';
    const { codes, client } = compileSrc(src);
    expect(codes).toEqual([]);
    expect(client).toContain("MOVED");
  });

  test("an <onTimeout> mention INSIDE another element's attribute value does NOT fire", () => {
    // The mask must still suppress a nested mention. `skipOpaqueSpan` records
    // the attribute region from one past the TAG NAME precisely so a real
    // `<onTimeout` opener stays unmasked while this one does not.
    const src =
      "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
      '    <A rule=.B><a title="<onTimeout after=5s to=.B/>">go</a></>\n' +
      "    <B><p>ok</p></>\n</>\n";
    expect(compileSrc(src).client).not.toContain("5000");
  });
});

describe("g-engine-state-child-apostrophe — every affected body scanner", () => {
  // The parse-time scanners in engine-statechild-parser.ts all shared the one
  // `skipCommentOrString` helper, so the defect reached each of them. One
  // fixture per scanner, each exercising the apostrophe through that path.

  test("findStateChildCloser — apostrophe in the FIRST (non-last) state-child", () => {
    // Pre-fix this swallowed EVERY following state-child, so a two-variant
    // engine reported BOTH variants missing.
    const src =
      `type S:enum = { A, B }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>it's go</p></>\n` +
      `    <B><p>fine</p></>\n` +
      `</>\n`;
    expect(compileSrc(src).codes).toEqual([]);
  });

  test("findEngineCloser + scanForNestedEngineEntries — nested engine, apostrophe inside", () => {
    const src =
      `type S:enum = { A, B }\n` +
      `type T:enum = { X, Y }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>go</p></>\n` +
      `    <B><engine for=T initial=.X>\n` +
      `        <X rule=.Y><p>it's x</p></>\n` +
      `        <Y><p>y</p></>\n` +
      `    </></>\n` +
      `</>\n`;
    expect(compileSrc(src).codes).toEqual([]);
  });

  test("computeCommentRegions — an <onTimeout> AFTER a contraction is still seen", () => {
    // The regex scanners mask out comment regions. Pre-fix the contraction
    // opened a phantom string region that swallowed the `<onTimeout/>` opener,
    // so the timeout was silently DROPPED (a false negative, not an error) —
    // the quiet half of this defect.
    const src =
      `type S:enum = { A, B }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>don't wait</p><onTimeout after=5s to=.B/></>\n` +
      `    <B><p>done</p></>\n` +
      `</>\n`;
    const { codes, client } = compileSrc(src);
    expect(codes).toEqual([]);
    expect(client).toContain("5000");
  });

  test("scanForOnTransitionEntries — an <onTransition> AFTER a contraction is still seen", () => {
    const src =
      `type S:enum = { A, B }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>don't wait</p></>\n` +
      `    <B><p>done</p></>\n` +
      `    <onTransition from=.A to=.B>\${ console.log("moved") }</onTransition>\n` +
      `</>\n`;
    const { codes, client } = compileSrc(src);
    expect(codes).toEqual([]);
    expect(client).toContain("moved");
  });
});

describe("g-engine-state-child-apostrophe — the code-default boundary is UNMOVED", () => {
  // SCOPE BOUNDARY. The state-child body itself is code-default (§4.18.1) — a
  // bare run there is CODE and display text needs `"..."`. This fix touches the
  // CLOSER-FINDING SCAN only; it must not reclassify the body it finds.
  //
  // The test therefore pins EQUIVALENCE, not rejection: an apostrophised bare
  // run and its apostrophe-free twin must be treated IDENTICALLY. Whatever the
  // code-default rule decides for `it is ready`, it must decide the same for
  // `it's ready`. The apostrophe is structurally inert.
  //
  // ⚑ Measured at this watermark: `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) is NOT
  // wired into the live pipeline (it exists only in the opt-in native parser,
  // compiler/native-parser/parse-markup.js), so BOTH sides currently compile.
  // The equivalence assertion is written to hold either way — if/when §4.18.7
  // is wired into the live path, both halves start erroring together and this
  // test still passes. What it forbids is the two halves DIVERGING, which is
  // exactly the failure mode a closer-scan fix could smuggle in.

  test("bare apostrophised run == bare apostrophe-free run (same acceptance)", () => {
    const withApos = compileSrc(engineWithBBody(`it's ready`)).codes;
    const without = compileSrc(engineWithBBody(`it is ready`)).codes;
    expect(withApos).toEqual(without);
  });

  test("bare apostrophised run is NOT rejected for a STRUCTURAL reason", () => {
    // Whatever fires (or does not fire) on a bare run, it must not be the
    // closer-scan's "I could not find your state-child" error — the body was
    // found; the only open question is how it is classified.
    const { codes } = compileSrc(engineWithBBody(`it's ready`));
    expect(codes).not.toContain("E-ENGINE-STATE-CHILD-MISSING");
  });

  test("the canonical display-text literal (§4.18.3) is unaffected", () => {
    // The SPEC §4.18.3 worked example, verbatim in shape: apostrophes are
    // ordinary interior characters of a `"..."` display-text literal and need
    // no escape.
    const { codes } = compileSrc(engineWithBBody(`"Don't panic - it's recoverable."`));
    expect(codes).toEqual([]);
  });

  test("E-ENGINE-STATE-CHILD-MISSING still fires on a genuinely-missing child", () => {
    // The diagnostic's fire condition is NOT widened or narrowed by this fix.
    // With `<B>` actually absent it must still fire — and it is the right
    // message for that input.
    const src =
      `type S:enum = { A, B }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>go</p></>\n` +
      `</>\n`;
    expect(compileSrc(src).codes).toContain("E-ENGINE-STATE-CHILD-MISSING");
  });

  test("...including when the present children carry apostrophes", () => {
    // The apostrophe must not SUPPRESS the diagnostic either. `<B>` is absent
    // here and `<A>`'s prose is apostrophised; the error is still correct.
    const src =
      `type S:enum = { A, B }\n` +
      `<engine for=S initial=.A>\n` +
      `    <A rule=.B><p>don't go</p></>\n` +
      `</>\n`;
    expect(compileSrc(src).codes).toContain("E-ENGINE-STATE-CHILD-MISSING");
  });
});

describe("g-engine-state-child-apostrophe — parser unit level", () => {
  // Direct assertions on the parser, below the full-compile path — these fail
  // loudly and locally if the scanner regresses, without a pipeline round-trip.

  const bodyOf = (prose) =>
    `\n    <A rule=.B><p>go</p></>\n    <B><p>${prose}</p></>\n`;

  test("both state-children survive the parse for odd / even / zero apostrophes", () => {
    for (const prose of ["it's ready", "it's here, don't leave", "it is ready"]) {
      const entries = parseEngineStateChildren(bodyOf(prose));
      expect(entries.map((e) => e.tag)).toEqual(["A", "B"]);
    }
  });

  test("the captured bodyRaw is the whole <p>, not a truncation at the apostrophe", () => {
    const entries = parseEngineStateChildren(bodyOf("it's ready"));
    expect(entries[1].bodyRaw).toBe("<p>it's ready</p>");
  });

  test("a comment in a state-child body is still inert (S98 behaviour retained)", () => {
    // The fix removed STRING spans from the markup-body locus; COMMENT spans
    // must still be opaque, or a `</>` mentioned inside a comment would be read
    // as a closer.
    const entries = parseEngineStateChildren(
      `\n    <A rule=.B><p>go</p></>\n    <B><!-- don't read </> here --><p>ok</p></>\n`,
    );
    expect(entries.map((e) => e.tag)).toEqual(["A", "B"]);
  });

  test("a `//` line comment in a state-child body is still inert", () => {
    const entries = parseEngineStateChildren(
      `\n    <A rule=.B><p>go</p></>\n    <B>\n      // don't read </> here\n      <p>ok</p>\n    </>\n`,
    );
    expect(entries.map((e) => e.tag)).toEqual(["A", "B"]);
  });
});

describe("g-engine-state-child-apostrophe — the SHIELD must not become the hole (S402 round 4)", () => {
  // ⚑ The `skipOpaqueSpan` shield added in round 3 introduced five regressions
  // of its own, including a fresh instance of the very silent-drop-at-exit-0
  // class it was written to close. Every case below was measured base-vs-branch
  // by file-copy swap in one checkout. These tests are the standing guard on
  // the shield itself, which is now the highest-risk surface in this file.

  const SQ = String.fromCharCode(39);

  // ---- findings 1 + 2: the guard discarded the span when it ENGULFED the
  // ---- candidate, which is the only case that matters.
  test("a `<engine>` living in a single-quoted attribute is NOT a nested engine", () => {
    const hits = scanForNestedEngineEntries(
      `<p title=${SQ}<engine><A rule=.B>x</></>${SQ}>y</p>`,
    );
    expect(hits.length).toBe(0);
  });

  test("a `<engine>` living in a ${...} logic block is NOT a nested engine", () => {
    const hits = scanForNestedEngineEntries(`\${ f(${SQ}<engine>x</>${SQ}) }`);
    expect(hits.length).toBe(0);
  });

  test("an `<onTransition>` living in a single-quoted attribute is NOT a transition", () => {
    const hits = scanForOnTransitionEntries(
      `<p title=${SQ}ask <onTransition on=.A to=.B>x</> here${SQ}>y</p>`,
    );
    expect(hits.length).toBe(0);
  });

  test("...and does not surface a diagnostic naming a variant that is only attribute text", () => {
    // End-to-end limb. Branch-before-round-4 emitted a spurious
    // E-ENGINE-RULE-INVALID-VARIANT for `.NOPE`, which exists nowhere but
    // inside a quoted string. Base: clean.
    const src =
      "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
      `    <A rule=.B><p title=${SQ}<onTransition from=.A to=.NOPE>x</>${SQ}>y</p></>\n` +
      "    <B><p>ok</p></>\n</>\n";
    expect(compileSrc(src).codes).toEqual([]);
  });

  // ---- finding 3: the third re-scan loop had no shield, and the top-level
  // ---- splitter stepped INTO a lowercase opener instead of over it.
  test("a state-child living in a single-quoted attribute is NOT a state-child", () => {
    const entries = parseEngineStateChildren(
      `<a title=${SQ}<Fake rule=.Z>x</>${SQ}>y</a>\n<Real rule=.Z>ok</>`,
    );
    expect(entries.map((e) => e.tag)).toEqual(["Real"]);
  });

  test("a phantom state-child cannot MASK a genuine E-ENGINE-STATE-CHILD-MISSING", () => {
    // `<B>` is genuinely absent; the `<B>` inside attribute text must not
    // satisfy the variant-coverage check.
    const src =
      "type S:enum = { A, B }\n<engine for=S initial=.A>\n" +
      `    <A rule=.B><a title=${SQ}<B>fake</>${SQ}>y</a></>\n</>\n`;
    expect(compileSrc(src).codes).toContain("E-ENGINE-STATE-CHILD-MISSING");
  });

  // ---- finding 4: the shield's own `${…}` walk was not quote-aware, so it
  // ---- re-created the silent-swallow class THROUGH the shield.
  test("a `}` inside a string does not end the ${...} span early and eat the next element", () => {
    const hits = scanForOnTimeoutEntries('${ f("}") } <onTimeout after=5s to=.B/>');
    expect(hits.length).toBe(1);
  });

  test("...same for a `}` inside a single-quoted string", () => {
    const hits = scanForOnTimeoutEntries(`\${ f(${SQ}}${SQ}) } <onTimeout after=5s to=.B/>`);
    expect(hits.length).toBe(1);
  });

  // ---- CONTROLS. A shield that suppresses everything is not a shield.
  test("a REAL nested engine is still found", () => {
    const hits = scanForNestedEngineEntries(
      "\n  <engine for=T initial=.X>\n    <X rule=.Y><p>x</p></>\n  </>\n",
    );
    expect(hits.length).toBe(1);
  });

  test("a REAL <onTimeout> is still found", () => {
    expect(scanForOnTimeoutEntries("<p>ok</p> <onTimeout after=5s to=.B/>").length).toBe(1);
  });

  test("a REAL <onTransition> is still found", () => {
    expect(
      scanForOnTransitionEntries("<onTransition from=.A to=.B>${ x() }</onTransition>").length,
    ).toBe(1);
  });

  test("a lowercase opener is stepped OVER, and real state-children after it survive", () => {
    const entries = parseEngineStateChildren(
      '\n    <a title="note">link</a>\n    <A rule=.B><p>go</p></>\n    <B><p>ok</p></>\n',
    );
    expect(entries.map((e) => e.tag)).toEqual(["A", "B"]);
  });
});
