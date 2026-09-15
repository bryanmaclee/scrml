/* SPDX-License-Identifier: MIT
 *
 * marker-parser-pins — the IMPORT-AND-PIN harness for the five `<!-- @marker … -->`
 * attribute-bag parsers.
 *
 * WHY THIS FILE IS THE DELIVERABLE AND A REGEX WIDENING IS NOT
 * ===========================================================
 * `g-marker-parsers-share-an-untested-regex-class` names the blocker precisely, and it is
 * structural rather than effort: *"these scripts have no import-and-pin harness, so a test
 * written for them tests a reimplementation and passes with the fix reverted."* A test that
 * re-declares one of these regexes is worthless — the mutant survives. So every assertion
 * below imports the REAL exported symbol. Revert any of the fixes and the matching case
 * goes red; that is the whole point.
 *
 * The class has produced defects in five sessions (S299, S307, S334, S358, S378), and S378's
 * attempt to CONVERGE the five produced a new defect in every one of five adversarial rounds
 * (a greedy form taking the LAST `status=`, a lazy form taking the FIRST, an over-broad
 * placeholder guard that ERASED a self-reported violation, a prefix-only guard, a `\bstatus=`
 * scan reading a hyphen-adjacent narrative value). Those changes were REVERTED out of #721
 * rather than landed unverified. This file is the net that attempt did not have.
 *
 * ⚑ S416 MEASUREMENT — THE SURVIVING SIBLINGS ARE LATENT, NOT LIVE, AND THAT IS WHY NOTHING
 * IS WIDENED HERE. Two of the five were fixed (`review-debt` S378, `state.parseGapMarkers`
 * S334). Four `[^>]` sites survive: `state.ts:248`, `boot.ts:173`, `corpus-zero-debt.ts:145`,
 * `flograph.ts` NODE_RE. Scanned against the files each parser actually reads:
 *
 *     docs/known-gaps.md        1000 @gap markers,  24 bodies contain `>`
 *       …of which INVISIBLE to the state.ts:248 status scan:  2
 *       …and both of those two are PROSE lines documenting the marker format, not markers:
 *         L3845  "…derived from the `<!-- @gap … -->` tokens…"
 *         L3848  "`<!-- @gap id=<stable-id> sev=<HIGH|MED|LOW|NOMINAL> status=<open|…> -->`"
 *     pa-profile-{bryan,pjoliver11,ryan}.md   3 @ledger markers,  0 contain `>`
 *     docs/deep-dives + docs/debates          0 @corpus-zero markers with `>`
 *
 * So the LIVE miss count is ZERO. The class is real and the sixth instance will not be, but
 * there is no live defect to chase today.
 *
 * ⛔ AND WIDENING WOULD REGRESS `flograph`, WHICH IS THE CONCRETE REASON NOT TO DO IT BLIND.
 * `flograph --with-support` reads `scrml-support/docs/deep-dives/*.md`, which contain marker
 * TEMPLATES — `<!-- @node id=<kebab-id> kind=<kind> status=<status> -->`. Today `[^>]` excludes
 * them by accident. Widen to `[^\n]` and those documentation templates are admitted as real
 * graph nodes. The accidental exclusion is load-bearing, and a widening has to answer for it
 * deliberately rather than inherit it.
 */
import { describe, test, expect } from "bun:test";
import { parseLedger } from "../../../scripts/review-debt.ts";
import { parseGapMarkers, headingMarkerDrift } from "../../../scripts/state.ts";
import { parseMarkers } from "../../../scripts/corpus-zero-debt.ts";
import { NODE_RE } from "../../../scripts/flograph.ts";

// A probe value of the shape this repo actually writes: it quotes scrml tags and position
// arrows, which is exactly what made the miss rate rise WITH the thoroughness of a review.
const GT_PROBE = "CODE-BEARING-walks-a-<db>-and-an-<each>-and-pins-5:1-->-5:42";

describe("@review (review-debt.parseLedger) — FIXED S378, and this is its regression sentinel", () => {
  test("a marker whose probe= contains `>` IS parsed", () => {
    const line = `<!-- @review pr=718 verdict=clean by=S378-bryan date=2026-09-01 probe=${GT_PROBE} -->`;
    const got = parseLedger(line);
    expect(got.has(718)).toBe(true);
    expect(got.get(718).verdict).toBe("clean");
  });

  test("the plain case still parses (the control — proves the assertion above is not vacuous)", () => {
    const line = `<!-- @review pr=719 verdict=carve-out by=S378-bryan date=2026-09-01 probe=docs-only -->`;
    const got = parseLedger(line);
    expect(got.has(719)).toBe(true);
    expect(got.get(719).verdict).toBe("carve-out");
  });

  test("ONE MARKER PER LINE — an unclosed marker matches nothing and does not swallow its successor", () => {
    // The S378 fix chose `[^\n]*?` over `[\s\S]*?` precisely to keep this contract: the
    // failure direction stays toward DEBT (a missed record reads as OWED) rather than toward
    // a marker eating the records after it, which would read as falsely RECORDED.
    const text =
      `<!-- @review pr=900 verdict=clean by=S1 date=2026-01-01 probe=unclosed\n` +
      `<!-- @review pr=901 verdict=clean by=S1 date=2026-01-01 probe=ok -->\n`;
    const got = parseLedger(text);
    expect(got.has(901)).toBe(true);
    expect(got.has(900)).toBe(false);
  });
});

describe("@gap (state.parseGapMarkers) — FIXED S334", () => {
  test("a marker whose locus= contains `>` IS parsed", () => {
    const line = `<!-- @gap id=g-x sev=MED status=open locus=compiler/src/a.ts(walks-<db>-then-emits-5:1-->-5:9) -->`;
    const got = parseGapMarkers(line);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: "g-x", sev: "MED", status: "open" });
  });

  test("the plain case still parses (control)", () => {
    const line = `<!-- @gap id=g-y sev=HIGH status=resolved locus=compiler/src/b.ts -->`;
    const got = parseGapMarkers(line);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: "g-y", sev: "HIGH", status: "resolved" });
  });
});

describe("@gap status scan (state.headingMarkerDrift) — UNWIDENED sibling, pinned as characterization", () => {
  test("drift is detected when the marker body has no `>` before status= (the reaching control)", () => {
    const src =
      "### g-z — a heading that says open — `NEW S1; MED; open`\n" +
      "<!-- @gap id=g-z sev=MED status=resolved locus=compiler/src/c.ts -->\n";
    expect(headingMarkerDrift(src)).toHaveLength(1);
  });

  test("a `>` BEFORE status= makes the marker invisible to the scan — CURRENT behaviour, not endorsed", () => {
    // `[^>]*status=` cannot cross a `>`. Measured live impact: 2 of 1000 lines in
    // docs/known-gaps.md, BOTH of them prose documenting the marker format. Pinned so a
    // future widening shows up here as a deliberate change rather than a silent one.
    const src =
      "### g-z — a heading that says open — `NEW S1; MED; open`\n" +
      "<!-- @gap id=g-z sev=<MED> status=resolved locus=compiler/src/c.ts -->\n";
    expect(headingMarkerDrift(src)).toHaveLength(0);
  });
});

describe("@corpus-zero (corpus-zero-debt.parseMarkers) — UNWIDENED sibling, pinned as characterization", () => {
  test("the plain case parses (the reaching control)", () => {
    const line = `<!-- @corpus-zero role=blast-radius disposition=overruled by=S1 date=2026-01-01 note=ok -->`;
    const got = parseMarkers(line);
    expect(got).toHaveLength(1);
    expect(got[0].role).toBe("blast-radius");
  });

  test("a body containing `>` does NOT match — CURRENT behaviour, not endorsed", () => {
    const line = `<!-- @corpus-zero role=blast-radius disposition=overruled by=S1 note=quotes-a-<db>-tag -->`;
    expect(parseMarkers(line)).toHaveLength(0);
  });
});

describe("@node (flograph.NODE_RE) — UNWIDENED, and the exclusion is LOAD-BEARING here", () => {
  test("the plain case matches (the reaching control)", () => {
    const line = `<!-- @node id=some-doc kind=deep-dive status=current -->`;
    expect(NODE_RE.test(line)).toBe(true);
  });

  test("a documentation TEMPLATE does not match, and that is why this one must not be widened blind", () => {
    // Real text from scrml-support/docs/deep-dives/*.md, which `flograph --with-support`
    // reads. Widening to `[^\n]` would admit these as real graph nodes.
    const tmpl = `<!-- @node id=<kebab-id> kind=<kind> status=<status> [sev=<sev>] -->`;
    expect(NODE_RE.test(tmpl)).toBe(false);
  });
});
