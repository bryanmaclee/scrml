/**
 * g-engine-state-child-apostrophe-breaks-parse — prose punctuation in an
 * `<engine>` state-child body must NOT be lexed as a string delimiter.
 *
 * Authored S405 2026-09-07 ("the free move", dpa-045 round 1 Call 4).
 *
 * ## The bug
 *
 * `engine-statechild-parser.ts:skipCommentOrString` — the deciding site shared
 * by TWELVE call sites across eight enclosing functions (`findStateChildCloser`,
 * `findEngineCloser`, `findOnTransitionCloser`, `scanForNestedEngineEntries`,
 * `scanForOnTransitionEntries`, `computeCommentRegions`, `parseMessageArms`'s
 * `skipTrivia`, `parseEngineStateChildren`) — carried `"` / `'` / backtick
 * string-literal branches. An ODD occurrence of any of those three inside one
 * scan window opened a phantom "string" that ran to EOF and swallowed every
 * subsequent state-child, firing a FALSE `E-ENGINE-STATE-CHILD-MISSING` naming
 * a variant that IS present in source. An EVEN count compiled clean — that
 * parity asymmetry is what proved the scan was string-lexing.
 *
 * ## Why deleting the branches is conformance restoration, not a widening
 *
 * - `SPEC.md:1219` (§4.18.3): *"A display-text literal is delimited by the
 *   double-quote character `"` on both ends. The double-quote is the **only**
 *   display-text-literal delimiter."*
 * - `SPEC.md:1220` (§4.18.3): *"The apostrophe `'` is an **ordinary interior
 *   character** … it carries no delimiter role and requires no escape …
 *   The backtick is likewise an ordinary interior character and is NOT a
 *   display-text delimiter."*
 * - `SPEC.md:1090` (S111 / S109): *"any plain-markup element body [is a]
 *   free-text body"* — a `<p>` nested inside a code-default state-child body
 *   opens its OWN free-text body; body mode is per-body, not inherited.
 * - Sibling precedent: `match-statechild-parser.ts:skipMatchComment` and
 *   `block-splitter.js:findStructuralBodyEnd` dropped their string branches at
 *   S196 (`g-match-arm-apostrophe-bs`). The engine scanner was the last holdout.
 *
 * ## The `"` branch specifically protected nothing reachable
 *
 * `"` IS a real delimiter in a code-default body and in attribute values — but
 * neither span reaches this helper. Opener-internal quotes are consumed by
 * `findOpenerEnd`'s own `inQuote` tracker first. And a display-text literal
 * CONTAINING a structural token is already torn apart upstream by the block
 * splitter / context checker, whose body-end scan has had no string branches
 * since S196. The `"…already-broken upstream…"` tests below PIN that: they
 * assert the pre-existing upstream failure is UNCHANGED by this delta, so a
 * future reader does not mistake it for a regression introduced here.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import {
  parseEngineStateChildren,
  parseMessageArms,
  scanForNestedEngineEntries,
  scanForOnTransitionEntries,
  scanForOnTimeoutEntries,
  scanForOnIdleEntries,
} from "../../src/engine-statechild-parser.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "engine-prose-punct-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function compileSource(name, source) {
  const unique = `${name}-${seq++}`;
  const filePath = join(TMP, `${unique}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${unique}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const read = (ext) => {
    try { return readFileSync(join(outDir, `${unique}.${ext}`), "utf8"); }
    catch { return ""; }
  };
  return { errors, html: read("html"), clientJs: read("client.js") };
}

const codes = (errors) => errors.map((e) => e.code);

/** Build a two-variant engine program with the given state-child body texts. */
function engineProgram(bodyA, bodyB) {
  return [
    "<program>",
    "${ type S:enum = { A, B } }",
    "<engine for=S initial=.A>",
    `  <A rule=.B>${bodyA}</>`,
    `  <B>${bodyB}</>`,
    "</>",
    "</program>",
    "",
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// 1. THE DONE-PROBE — the odd/even apostrophe asymmetry is gone.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — apostrophes (the DONE-PROBE)", () => {
  test("ODD apostrophe count in a nested <p> compiles clean (was a FALSE E-ENGINE-STATE-CHILD-MISSING)", () => {
    const { errors, clientJs } = compileSource(
      "odd-apostrophe",
      engineProgram("<p>go</p>", "<p>it's ready</p>"),
    );
    expect(codes(errors)).toEqual([]);
    // The apostrophe survives to output as ordinary content, not as a delimiter.
    expect(clientJs).toContain("it's ready");
  });

  test("EVEN apostrophe count still compiles clean (it always did — the parity was the tell)", () => {
    const { errors, clientJs } = compileSource(
      "even-apostrophe",
      engineProgram("<p>go</p>", "<p>it's ready, don't wait</p>"),
    );
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("it's ready, don't wait");
  });

  test("a lone apostrophe in the FIRST state-child does not swallow the SECOND", () => {
    const { errors } = compileSource(
      "odd-apostrophe-first",
      engineProgram("<p>it's go time</p>", "<p>ready</p>"),
    );
    expect(codes(errors)).toEqual([]);
  });

  test("deciding site directly: parseEngineStateChildren sees BOTH children across an odd apostrophe", () => {
    const body = "\n  <A rule=.B><p>it's ready</p></>\n  <B><p>done</p></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. ADVERSARIAL CASE 1 — the §4.18.3 display-text literal MUST still work.
//    This is the canonical code-default state-child form and the highest-risk
//    case for a change that deletes string tracking.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — the §4.18.3 display-text literal survives", () => {
  test("a display-text literal state-child body compiles clean and reaches output", () => {
    const src = [
      "<program>",
      "${ type S:enum = { Idle, Busy } }",
      "<engine for=S initial=.Idle>",
      '  <Idle rule=.Busy>"Ready to fetch."</>',
      '  <Busy>"Working."</>',
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, html } = compileSource("display-text-literal", src);
    expect(codes(errors)).toEqual([]);
    expect(html).toContain("Ready to fetch.");
  });

  test("the §4.18.3 worked example (apostrophes INSIDE a display-text literal) compiles clean", () => {
    // SPEC.md §4.18.3 worked example, verbatim shape: "Don't panic — it's
    // recoverable." is ONE well-formed literal; the two apostrophes are
    // ordinary interior characters requiring no escape.
    const src = [
      "<program>",
      "${ type FetchPhase:enum = { Idle, Loading, Error } }",
      "<engine for=FetchPhase initial=.Idle>",
      '  <Idle rule=.Loading>"Ready to fetch."</>',
      '  <Loading rule=.Error>"Loading…"</>',
      '  <Error>"Don\'t panic — it\'s recoverable."</>',
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, html, clientJs } = compileSource("spec-4183-worked-example", src);
    expect(codes(errors)).toEqual([]);
    // The HTML carries only the INITIAL state (`.Idle`); the non-initial
    // variants live in the client-side render switch.
    expect(html).toContain("Ready to fetch.");
    expect(clientJs).toContain("recoverable.");
    expect(clientJs).toContain("Don't panic");
  });

  test("an ESCAPED interior double-quote in a display-text literal compiles clean", () => {
    const { errors } = compileSource(
      "escaped-quote-literal",
      engineProgram('"a 6\\" pipe"', '"done"'),
    );
    expect(codes(errors)).toEqual([]);
  });

  test("a `:`-shorthand body carrying a display-text literal compiles clean (adversarial case 2)", () => {
    const src = [
      "<program>",
      "${ type S:enum = { Idle, Busy } }",
      "<engine for=S initial=.Idle>",
      '  <Idle rule=.Busy : "Waiting...">',
      '  <Busy : "Working...">',
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, html } = compileSource("colon-shorthand-literal", src);
    expect(codes(errors)).toEqual([]);
    expect(html).toContain("Waiting...");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. THE OTHER TWO DELETED DELIMITERS — `"` and backtick in free-text prose
//    carried the IDENTICAL defect. Both are fixed by the same delta.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — double-quote and backtick in free-text prose", () => {
  test("ODD double-quote in a nested <p> free-text body compiles clean", () => {
    // `<p>` opens its own FREE-TEXT body (SPEC.md:1090) — the `"` is prose, not
    // a delimiter. SPEC §4.18.7's inverse-footgun note explicitly blesses
    // literal quote marks as content in a nested plain-markup body.
    const { errors, clientJs } = compileSource(
      "odd-double-quote",
      engineProgram("<p>go</p>", '<p>a 6" pipe</p>'),
    );
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("pipe");
  });

  test("ODD backtick in a nested <p> free-text body compiles clean", () => {
    const { errors, clientJs } = compileSource(
      "odd-backtick",
      engineProgram("<p>go</p>", "<p>press the ` key</p>"),
    );
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("key");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. REMAINING ADVERSARIAL SCOPE — shapes that MUST be unaffected.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — adversarial scope holds", () => {
  test("case 4: an attribute value carrying `>` AND an apostrophe (findOpenerEnd owns opener quotes)", () => {
    // Opener-internal quotes never reach `skipCommentOrString` — `findOpenerEnd`
    // has its own `inQuote` tracker and the walkers jump straight past the
    // opener. This is the engine analogue of `findArmCloser`'s `q`-loop.
    const { errors } = compileSource(
      "attr-gt-and-apostrophe",
      engineProgram('<p title="a > b and it\'s fine">go</p>', "<p>done</p>"),
    );
    expect(codes(errors)).toEqual([]);
  });

  test("case 5: a backtick template with an interpolation inside a `${...}` block", () => {
    const src = [
      "<program>",
      "${ type S:enum = { A, B } }",
      "${ <n>:int = 3 }",
      "<engine for=S initial=.A>",
      "  <A rule=.B><p>${ `count is ${@n}` }</p></>",
      "  <B><p>done</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("backtick-template", src);
    expect(codes(errors)).toEqual([]);
  });

  test("case 6: a NESTED engine inside a state-child, with apostrophes in BOTH bodies", () => {
    // Regression note: this shape failed BEFORE the delta despite an EVEN
    // GLOBAL apostrophe count (2) — the phantom string opened at `outer's` and
    // closed at `inner's`, swallowing the nested `<engine ...>` opener between
    // them. The even-count mask is per SCAN WINDOW, not per file.
    const src = [
      "<program>",
      "${ type Outer:enum = { On, Off } }",
      "${ type Inner:enum = { Lo, Hi } }",
      "<engine for=Outer initial=.On>",
      "  <On rule=.Off>",
      "    <p>outer's body</p>",
      "    <engine for=Inner initial=.Lo>",
      "      <Lo rule=.Hi><p>inner's low</p></>",
      "      <Hi><p>inner high</p></>",
      "    </>",
      "  </>",
      "  <Off><p>off</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("nested-engine-apostrophes", src);
    expect(codes(errors)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4b. THE OTHER CALL SITES. `skipCommentOrString` is the deciding site for
//     TWELVE call sites, so this delta changes behaviour at every one. The
//     tests above reach `findStateChildCloser`, `parseEngineStateChildren`,
//     `findEngineCloser` and `scanForNestedEngineEntries`. These four reach the
//     remaining reachable ones — `scanForOnTransitionEntries` +
//     `findOnTransitionCloser`, `computeCommentRegions` (via
//     `scanForOnTimeoutEntries` / `scanForOnIdleEntries`), and
//     `parseMessageArms`' `skipTrivia`. All four fail on the base parser with a
//     FALSE E-ENGINE-STATE-CHILD-MISSING.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — the remaining call sites", () => {
  test("scanForOnTransitionEntries / findOnTransitionCloser: apostrophe prose beside an <onTransition>", () => {
    const src = [
      "<program>",
      "${ type Mode:enum = { Off, On } }",
      "${ <ticks>:int = 0 }",
      "<engine for=Mode initial=.Off>",
      "  <Off rule=.On>",
      "    <onTransition to=.On>${ @ticks = @ticks + 1 }</>",
      "    <p>it's off</p>",
      "  </>",
      "  <On rule=.Off><p>on</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("ontransition-apostrophe", src);
    expect(codes(errors)).toEqual([]);
  });

  test("computeCommentRegions via scanForOnTimeoutEntries: apostrophe prose beside an <onTimeout>", () => {
    const src = [
      "<program>",
      "${ type Light:enum = { Green, Yellow, Red } }",
      "<engine for=Light initial=.Green>",
      "  <Green rule=.Yellow>",
      "    <onTimeout after=1000ms to=.Yellow/>",
      "    <p>it's green</p>",
      "  </>",
      "  <Yellow rule=.Red><p>slow</p></>",
      "  <Red><p>stop</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("ontimeout-apostrophe", src);
    expect(codes(errors)).toEqual([]);
  });

  test("computeCommentRegions via scanForOnIdleEntries: apostrophe prose beside an <onIdle>", () => {
    const src = [
      "<program>",
      "${ type Sess:enum = { Active, Sleeping } }",
      "<engine for=Sess initial=.Active>",
      "  <Active rule=.Sleeping><p>you're active</p></>",
      "  <Sleeping><p>asleep</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("onidle-apostrophe", src);
    expect(codes(errors)).toEqual([]);
  });

  test("parseMessageArms / skipTrivia: apostrophe prose in a render body beneath `|` message arms", () => {
    const src = [
      "<program>",
      "${ type DragMsg:enum = { Start, End } }",
      "${ type DragPhase:enum = { Idle, Dragging } }",
      "<engine for=DragPhase initial=.Idle accepts=DragMsg>",
      "    <Idle rule=.Dragging>",
      "        | .Start :> .Dragging",
      "        | _      :> @dragPhase",
      "        <p>it's idle</p>",
      "    </>",
      "    <Dragging rule=.Idle>",
      "        | .End :> .Idle",
      "        | _    :> @dragPhase",
      "        <p>you're dragging</p>",
      "    </>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("message-arms-apostrophe", src);
    expect(codes(errors)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. THE RETAINED BRANCHES — comments stay opaque. These guard against an
//    over-broad future deletion that takes the comment branches with it.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — the comment branches are RETAINED", () => {
  test("an odd apostrophe inside an HTML comment is still opaque (ss4 item 2 stays fixed)", () => {
    const body = "\n  <!-- it's a note -->\n  <A rule=.B></>\n  <B></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });

  test("a `</Variant>` mention inside an HTML comment is still opaque", () => {
    const body = "\n  <A rule=.B><!-- close with </> here --><p>go</p></>\n  <B></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });

  test("a genuine `// comment` in a state-child body still strips (SPEC §27.1)", () => {
    const src = [
      "<program>",
      "${ type S:enum = { A, B } }",
      "<engine for=S initial=.A>",
      "  <A rule=.B>",
      "    // a real comment mentioning </> and a quote \"",
      "    <p>go</p>",
      "  </>",
      "  <B><p>done</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("line-comment-strips", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).not.toContain("a real comment mentioning");
  });

  test("a URL in state-child prose is still DATA, not a comment (urlSlashesAt carve-out retained)", () => {
    const { errors, clientJs } = compileSource(
      "url-in-prose",
      engineProgram("<p>Docs at https://example.com/x</p>", "<p>done</p>"),
    );
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("https://example.com/x");
  });

  test("a `/* block comment */` in a state-child body is still opaque", () => {
    const body = "\n  <A rule=.B>/* it's opaque </> */<p>go</p></>\n  <B></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5b. THE S405 FIX ROUND — unterminated-to-EOF recovery turned a stray glyph
//     into TOTAL SCAN LOSS once the string branches were gone.
//
//     ⚠ EVERY TEST IN THIS BLOCK ASSERTS ON EMITTED OUTPUT, NOT ON EXIT CODE.
//     The HIGH finding compiled at exit 0 with zero diagnostics and simply
//     deleted the engine's timer from the bundle. An exit-code assertion would
//     have passed against the broken build — which is exactly how the first
//     round's PIN suite missed it.
//
//     Two roots, and BOTH were required — neither limb alone closes all four
//     reproduced cells:
//       (1) `computeCommentRegions` was the ONE caller `findOpenerEnd` does not
//           protect, so it read attribute-value bytes as body bytes.
//       (2) an UNTERMINATED `/*` or `<!--` consumed to EOF instead of being
//           treated as prose.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — S405 fix round (silent scan loss)", () => {
  const IDLE_WIRING = "_scrml_engine_arm_idle_watchdog";
  const TIMEOUT_WIRING = "onTimeout timer-config table";

  test("HIGH: an unpaired `/*` in an ATTRIBUTE VALUE must not delete the <onIdle> timer", () => {
    const src = [
      "<program>",
      "${ type S:enum = { Awake, Sleeping } }",
      "<engine for=S initial=.Awake>",
      '  <Awake rule=.Sleeping><p title="glob /*.ts">go</p></>',
      "  <Sleeping><p>zzz</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("high-glob-attr-onidle", src);
    expect(codes(errors)).toEqual([]);
    // THE ASSERTION THAT MATTERS: the timer is still wired. Before the fix this
    // was absent while the compile still reported success.
    expect(clientJs).toContain(IDLE_WIRING);
  });

  test("HIGH (second token, found by enumerating the population): an unpaired `<!--` in an attribute value must not delete the timer", () => {
    // The review named `/*`; enumerating the helper's full region-opener set
    // surfaced `<!--` as a second instance of the identical class. `//` is NOT
    // affected because it is bounded by the newline and cannot reach a later line.
    const src = [
      "<program>",
      "${ type S:enum = { Awake, Sleeping } }",
      "<engine for=S initial=.Awake>",
      '  <Awake rule=.Sleeping><p title="a <!-- b">go</p></>',
      "  <Sleeping><p>zzz</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("high-htmlcomment-attr-onidle", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain(IDLE_WIRING);
  });

  test("HIGH (terminated span): a `/*` in an attribute value PAIRED with a genuine later `*/` must not mask the timers", () => {
    // This is the cell that proves limb 2 alone is insufficient. The `/*` inside
    // the attribute finds a real `*/` further down, so it is TERMINATED — the
    // unterminated-is-not-a-comment rule never fires. Only opener awareness in
    // `computeCommentRegions` keeps the region from spanning the <onTimeout> and
    // <onIdle> that sit between them.
    const src = [
      "<program>",
      "${ type S:enum = { Awake, Sleeping } }",
      "<engine for=S initial=.Awake>",
      "  <Awake rule=.Sleeping>",
      '    <p title="glob /*.ts">go</p>',
      "    <onTimeout after=30s to=.Sleeping/>",
      "  </>",
      "  <Sleeping><p>zzz</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "  /* a genuine trailing block comment */",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("high-terminated-span-attr", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain(IDLE_WIRING);
    expect(clientJs).toContain(TIMEOUT_WIRING);
  });

  test("MED: an unpaired `/*` inside a display-text literal must not fire a false E-ENGINE-STATE-CHILD-MISSING", () => {
    const { errors } = compileSource(
      "med-blockcomment-in-literal",
      engineProgram('"a /* b"', '"done"'),
    );
    expect(codes(errors)).toEqual([]);
  });

  test("an unpaired `/*` in BARE state-child prose compiles clean (pre-existing bug, also closed here)", () => {
    // This one was red on the S405 BASE too — it is not a regression from the
    // string-branch deletion, it is the same unterminated-to-EOF root reached
    // without any quote involved. Fixed by the same limb.
    const { errors } = compileSource(
      "bare-prose-unterminated-blockcomment",
      engineProgram("<p>glob /*.ts here</p>", "<p>done</p>"),
    );
    expect(codes(errors)).toEqual([]);
  });

  test("a PAIRED `/* ... */` is STILL an opaque comment region (guards against over-correcting limb 2)", () => {
    // Asserted at the HELPER level, deliberately, not through a full compile.
    // A `/* */` block comment inside an engine state-child body does not survive
    // the pipeline AT ALL — it fires an upstream E-SYNTAX-050 ("Bare '/' is no
    // longer a valid closer", from the `/` of the `*/`) and it does so
    // IDENTICALLY on the S405 base. That is a real pre-existing gap, pinned
    // below, but it makes a compile-level assertion here impossible. The
    // contract that actually matters for limb 2 is this one: a TERMINATED `/*`
    // must still be opaque, so a `<X` mention inside it is not read as a
    // state-child opener. Only the UNTERMINATED form became prose.
    const body = "\n  <A rule=.B>/* mentions <Ghost> inside */<p>go</p></>\n  <B></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });

  test("an UNTERMINATED `/*` is NOT a comment region — the state-children after it survive", () => {
    // The limb-2 contract stated positively, at the deciding site.
    const body = "\n  <A rule=.B><p>glob /*.ts here</p></>\n  <B><p>done</p></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });

  // ⚑ A test asserting "an UNTERMINATED `<!--` is NOT a comment region either"
  // stood here after fix round 1 and was DELETED in fix round 2. It encoded the
  // reasoning-by-analogy error described on the `<!--` branch in the source: BS
  // declines an unterminated `/*` (containment pre-scan) but consumes an
  // unterminated `<!--` to EOF, so matching BS means the two branches must
  // DIFFER. The replacement lives in the fix-round-2 block below
  // ("finding 2 REVERTED"), and asserts the opposite. Left as a note because a
  // deleted test is invisible, and the next person to notice the asymmetry
  // should find out it is deliberate here rather than "tidy" it again.

  test("a `//` in an attribute value is still opaque (the opener jump covers it too)", () => {
    const src = [
      "<program>",
      "${ type S:enum = { Awake, Sleeping } }",
      "<engine for=S initial=.Awake>",
      '  <Awake rule=.Sleeping><p title="see //cdn.example.com/x">go</p></>',
      "  <Sleeping><p>zzz</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("slashes-in-attr", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain(IDLE_WIRING);
  });

  test("finding 5: a display-text render body beneath `|` message arms now RENDERS (was silently discarded)", () => {
    // `parseMessageArms`' `skipTrivia` no longer steps over a `"..."` literal, so
    // the render body after the arm table is no longer swallowed. This is a FIX
    // for silent render-content loss, but it CHANGES OUTPUT for programs that
    // already compiled clean at exit 0 — measured on the S405 base, the literal
    // was absent from the bundle entirely. Pinned so the behaviour is deliberate.
    const src = [
      "<program>",
      "${ type DragMsg:enum = { Start, End } }",
      "${ type DragPhase:enum = { Idle, Dragging } }",
      "<engine for=DragPhase initial=.Idle accepts=DragMsg>",
      "    <Idle rule=.Dragging>",
      "        | .Start :> .Dragging",
      "        | _      :> @dragPhase",
      '        "Drag me to begin."',
      "    </>",
      "    <Dragging rule=.Idle>",
      "        | .End :> .Idle",
      "        | _    :> @dragPhase",
      '        "Release to drop."',
      "    </>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("message-arm-literal-render-body", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("Drag me to begin.");
    expect(clientJs).toContain("Release to drop.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5c. THE S405 FIX ROUND 2 — the SAME class at the THREE OTHER scan sites.
//
//     THE ARCHITECTURAL FINDING OF THE ARC: `skipCommentOrString`'s string
//     branches were doing DOUBLE DUTY. They wrongly lexed strings in prose (the
//     bug S405 deleted, correctly) AND they accidentally SHIELDED every flat
//     scan in the file from reading an opener's ATTRIBUTE INTERIOR, because an
//     attribute value is quoted. Deleting them did not create the
//     opener-blindness — it UNMASKED a pre-existing architectural gap.
//
//     POPULATION, DERIVED OVER SCAN SITES (the dimension round 1's grid held
//     fixed). Unit is the LOOP, not the function — three of these live in the
//     SAME functions as an already-safe walker loop. A loop is IN CLASS iff it
//     (a) calls the comment skip, (b) TRAVERSES across body text toward a
//     structural target elsewhere — so it can walk into an opener — and (c) has
//     no opener jump. Eleven loops call the skip; FOUR were in class:
//       1. computeCommentRegions        (fixed in round 1)
//       2. scanForOnTransitionEntries   inner re-scan   <-- here
//       3. scanForNestedEngineEntries   inner re-scan   <-- here
//       4. parseEngineStateChildren     inner re-scan   <-- here (LIVE symbol-
//                                                       table path)
//     The six WALKER loops are safe: they jump whole openers via findOpenerEnd.
//     `parseMessageArms`' `skipTrivia` has no opener jump either but fails (b) —
//     it HALTS at the first non-trivia byte, so it can never be positioned
//     inside an opener. Verified empirically, not asserted; its test is below.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — S405 fix round 2 (opener-blind scan sites)", () => {
  test("SITE 2 scanForOnTransitionEntries: an attribute-borne `//` must not delete the transition hooks", () => {
    const src = [
      "<program>",
      "${ type Mode:enum = { Off, On } }",
      "${ <ticks>:int = 0 }",
      "<engine for=Mode initial=.Off>",
      '  <Off rule=.On><a href="//cdn.x">d</a> <onTransition to=.On>${ @ticks = @ticks + 1 }</></>',
      "  <On rule=.Off><p>on</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("site2-ontransition-cdn", src);
    expect(codes(errors)).toEqual([]);
    // EMITTED OUTPUT. Before the fix the entire fire-hooks function was absent
    // from the bundle at exit 0 with zero diagnostics.
    expect(clientJs).toContain("fire_hooks");
  });

  test("SITE 2 (unit): scanForOnTransitionEntries finds the entry across an attribute-borne `//`", () => {
    const ctrl = '<a href="x">d</a> <onTransition to=.On>${ @t = @t + 1 }</>';
    const bad = '<a href="//cdn.x">d</a> <onTransition to=.On>${ @t = @t + 1 }</>';
    expect(scanForOnTransitionEntries(bad).length)
      .toBe(scanForOnTransitionEntries(ctrl).length);
    expect(scanForOnTransitionEntries(bad).length).toBe(1);
  });

  test("SITE 3 (unit): scanForNestedEngineEntries finds the nested engine across an attribute-borne `//`", () => {
    const ctrl = '<a href="x">d</a> <engine for=Inner initial=.Lo><Lo></><Hi></></>';
    const bad = '<a href="//cdn.x">d</a> <engine for=Inner initial=.Lo><Lo></><Hi></></>';
    expect(scanForNestedEngineEntries(bad).length)
      .toBe(scanForNestedEngineEntries(ctrl).length);
    expect(scanForNestedEngineEntries(bad).length).toBe(1);
  });

  test("SITE 4 parseEngineStateChildren: an attribute-borne `//` on the SAME LINE must not swallow a state-child", () => {
    const src = [
      "<program>",
      "${ type S:enum = { A, B } }",
      "<engine for=S initial=.A>",
      '  <a href="//cdn.x">d</a> <A rule=.B><p>go</p></>',
      "  <B><p>done</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("site4-sameline-slashes", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("go");
    expect(clientJs).toContain("done");
  });

  test("SITE 4 (unit): every attribute-borne comment opener leaves BOTH state-children intact", () => {
    // This is the LIVE symbol-table path. Each of these took the children to
    // ["B"] or [] before the fix. The `<!--` row was ALSO red on the S405 base,
    // i.e. pre-existing, and is closed by the same change.
    const expected = ["A", "B"];
    const bodies = {
      control: '\n<a href="x">d</a> <A rule=.B><p>go</p></>\n<B><p>d</p></>\n',
      slashesSameLine: '\n<a href="//cdn.x">d</a> <A rule=.B><p>go</p></>\n<B><p>d</p></>\n',
      blockPaired: '\n<a title="glob /*.ts">d</a>\n<A rule=.B><p>go</p></>\n<B><p>d</p></>\n/* t */\n',
      htmlPaired: '\n<a title="a <!-- b">d</a>\n<A rule=.B><p>go</p></>\n<B><p>d</p></>\n<!-- t -->\n',
    };
    for (const [name, body] of Object.entries(bodies)) {
      expect(`${name}:${JSON.stringify(parseEngineStateChildren(body).map((e) => e.tag))}`)
        .toBe(`${name}:${JSON.stringify(expected)}`);
    }
  });

  test("skipTrivia is OUT of the class — it halts at the first non-trivia byte, so it cannot enter an opener", () => {
    // The population boundary, asserted rather than argued. `skipTrivia` is the
    // one loop with no opener jump that is nevertheless safe. If a future change
    // makes it TRAVERSE instead of halt, this test is where that shows up.
    const arms = (body) => parseMessageArms(body).arms.length;
    const start = (body) => parseMessageArms(body).renderBodyStart;
    const ctrl = '\n| .Start :> .Dragging\n| _ :> @p\n<a href="x">d</a>\n';
    for (const attr of ['href="//cdn.x"', 'title="glob /*.ts"', 'title="a <!-- b"']) {
      const body = `\n| .Start :> .Dragging\n| _ :> @p\n<a ${attr}>d</a>\n`;
      expect(arms(body)).toBe(arms(ctrl));
      expect(start(body)).toBe(start(ctrl));
    }
  });

  test("finding 2 REVERTED: an UNTERMINATED `<!--` consumes to EOF, matching the block splitter", () => {
    // Round 1 made this "not a comment" by analogy with `/*`. The analogy does
    // not hold: BS's `/*` path has a containment pre-scan (block-splitter.js
    // :2581-2596) so `/*` genuinely converges, but `skipHtmlComment` (:358-368)
    // unconditionally consumes to EOF and `findStructuralBodyEnd` calls it that
    // way (:793). Disagreeing would wire up a state-child the developer had
    // commented out and forgotten to close.
    const body = "\n<A rule=.B><p>go</p></>\n<!-- temporarily disabled\n<B><p>d</p></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A"]);
  });

  test("and the `/*` half of that rule is RETAINED — unterminated `/*` is still prose", () => {
    const body = "\n<A rule=.B><p>glob /*.ts here</p></>\n<B><p>d</p></>\n";
    expect(parseEngineStateChildren(body).map((e) => e.tag)).toEqual(["A", "B"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5d. THE S405 FIX ROUND 3 — JUMPING an opener is not the same as RECORDING it.
//
//     ⚠ THESE ASSERT AT THE SCANNER LEVEL, NOT THROUGH A COMPILE, AND THAT IS
//     DELIBERATE: this defect has NO e2e path today. Driving
//     `<p title="use <onTimeout after=1s to=.A/> here">` through `compileScrml`
//     is clean on BOTH trees, because nothing downstream currently consumes the
//     phantom registration. It is pinned here anyway — a phantom that happens
//     not to reach emission today is precisely the coverage hole that an
//     unrelated change uncovers later, and a scanner-level test is the only
//     honest place to state the contract.
//
//     `computeMaskedRegions` gained the opener JUMP in round 1, which stops a
//     comment opener inside an attribute from starting a region. It did not
//     RECORD the jumped span, so the two REGEX-based scanners — which filter
//     only against that array — still matched `<onTimeout …/>` / `<onIdle …/>`
//     TEXT inside an attribute value. On `main` the deleted `"` branch recorded
//     that text as a string region and masked it by accident.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — S405 fix round 3 (opener interiors must be MASKED, not just jumped)", () => {
  test("all four scanners agree: an attribute-borne structural token registers NOTHING", () => {
    // The asymmetry is the tell. `scanForOnTransitionEntries` and
    // `scanForNestedEngineEntries` get this structurally via `skipOpenerAware`
    // and were already correct; the two regex scanners were the odd ones out.
    expect(scanForOnTimeoutEntries('<p title="use <onTimeout after=1s to=.A/> here">x</p>'))
      .toEqual([]);
    expect(scanForOnIdleEntries('<p title="use <onIdle after=5m to=.A/> here">x</p>'))
      .toEqual([]);
    expect(scanForOnTransitionEntries('<p title="use <onTransition to=.A/> here">x</p>'))
      .toEqual([]);
    expect(scanForNestedEngineEntries('<p title="use <engine for=X initial=.A> here">x</p>'))
      .toEqual([]);
  });

  test("a REAL top-level <onTimeout> / <onIdle> is still found — the mask is the opener INTERIOR, not its own span", () => {
    // ⛔ THE GUARD THAT MATTERS MOST IN THIS FILE. A real `<onTimeout …/>` IS
    // itself a tag-shaped opener. Recording its own span as masked would mask
    // its own regex match (anchored at the `<`) and silently delete EVERY REAL
    // TIMER — far worse than the phantom the fix removes. The region therefore
    // starts at `i + 1`. If someone "simplifies" that to `i`, this test fails.
    expect(scanForOnTimeoutEntries("<onTimeout after=1s to=.A/>").length).toBe(1);
    expect(scanForOnIdleEntries("<onIdle after=5m to=.A/>").length).toBe(1);
  });

  test("a real timer sitting AFTER an attribute-bearing opener is still found", () => {
    // Guards the other over-reach direction: the mask must END at the opener's
    // `>`, not run on into the body.
    const body = '<p title="just a title">x</p> <onTimeout after=1s to=.A/>';
    expect(scanForOnTimeoutEntries(body).length).toBe(1);
  });

  test("engine-level: a real <onIdle> survives alongside an attribute containing timer-shaped text", () => {
    const src = [
      "<program>",
      "${ type S:enum = { Awake, Sleeping } }",
      "<engine for=S initial=.Awake>",
      '  <Awake rule=.Sleeping><p title="use <onIdle after=9m to=.Awake/> here">go</p></>',
      "  <Sleeping><p>zzz</p></>",
      "  <onIdle after=5m to=.Sleeping/>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors, clientJs } = compileSource("round3-real-idle-survives", src);
    expect(codes(errors)).toEqual([]);
    expect(clientJs).toContain("_scrml_engine_arm_idle_watchdog");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. PINS — pre-existing UPSTREAM failures this delta does NOT change.
//
//    These are RED-BY-DESIGN pins, not aspirations. A display-text literal
//    containing a structural token is torn apart by the block splitter /
//    context checker BEFORE the engine scanner runs, because BS's own
//    `findStructuralBodyEnd` has had no string branches since S196. Verified
//    failing identically before AND after the S405 delta. If one of these ever
//    starts passing, the fix belongs upstream in BS's body-end scan — and this
//    pin should then be promoted to a positive assertion, not deleted.
// ───────────────────────────────────────────────────────────────────────────
describe("engine state-child prose punctuation — PINS for the pre-existing upstream gap", () => {
  test("a `</>` inside a display-text literal still fails UPSTREAM (adversarial case 3, unchanged)", () => {
    const { errors } = compileSource(
      "pin-closer-in-literal",
      engineProgram('"go </> now"', '"done"'),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(codes(errors)).toContain("E-CTX-001");
  });

  test("a bare `<` inside a display-text literal still fails UPSTREAM (unchanged)", () => {
    const { errors } = compileSource(
      "pin-lt-in-literal",
      engineProgram('"a < b"', '"done"'),
    );
    expect(codes(errors)).toContain("E-CTX-003");
  });

  test("a `//` inside a display-text literal still fails UPSTREAM (unchanged)", () => {
    const { errors } = compileSource(
      "pin-slashes-in-literal",
      engineProgram('"rate 50 // 100"', '"done"'),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  test("ANY paired `/* ... */` in an engine state-child body still fails UPSTREAM at E-SYNTAX-050 (found S405 fix round, unchanged)", () => {
    // Surfaced while building the paired-comment guard above, and it is broader
    // than it first looked: it is not about the comment's CONTENTS. A plain,
    // well-formed, content-free block comment in a state-child body fires
    // E-SYNTAX-050 — an upstream check reads the `/` of the closing `*/` as a
    // bare closer ("Bare '/' is no longer a valid closer. Use '</>' to close
    // '<A>'"). So `/* */` comments do not work in this locus AT ALL. Verified
    // IDENTICAL on the S405 base: pre-existing, orthogonal to this arc, and not
    // filed anywhere I could find. Pinned so the next reader does not attribute
    // it to the string-branch deletion, and so it is not silently "fixed" by a
    // future change to the engine helper — the root is upstream, not here.
    const src = [
      "<program>",
      "${ type S:enum = { A, B } }",
      "<engine for=S initial=.A>",
      "  <A rule=.B>",
      "    /* a plain block comment with no structural token in it */",
      "    <p>go</p>",
      "  </>",
      "  <B><p>done</p></>",
      "</>",
      "</program>",
      "",
    ].join("\n");
    const { errors } = compileSource("pin-paired-block-comment-upstream", src);
    expect(codes(errors)).toContain("E-SYNTAX-050");
  });
});
