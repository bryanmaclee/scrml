/**
 * each-as-alias-attr-allowlist.test.js
 *
 * VP-1 must not report the `<each … as NAME>` iteration binding as an
 * unrecognized ATTRIBUTE.
 *
 * BUG: `as name` is a BAREWORD PAIR in the §17.7.2 grammar — all four
 * canonical shapes spell it `as conflict` / `as day` / `as row`, never
 * `as=conflict`. `parseLiftTag` tokenises an opener into `name[=value]`
 * attributes, so the pair arrives at VP-1 as TWO ADJACENT VALUE-LESS
 * attributes and the alias half is indistinguishable from an unknown boolean
 * attribute. VP-1 fired
 *
 *     W-ATTR-001: Attribute `it=` is not recognized on `<each>`.
 *                 It is currently forwarded to the rendered HTML as-is …
 *
 * on CORRECT, canonical scrml — and the "forwarded to the rendered HTML"
 * claim is false; `it` is the iteration binding.
 *
 * ⚠ The worse half was INCONSISTENCY: it fired only for carriers the
 * `walkFileAst` walk actually reaches, so the same `<each … as it>` warned
 * inside `${ if @show { lift … } }` and stayed silent inside a
 * markup-returning `fn` body. The warning was a property of WHERE the each
 * sat, not of what the author wrote — so "no warning" could never be read as
 * "this shape is fine".
 *
 * Scope note: only the LIFT-parsed `<each>` reaches VP-1 as `kind:"markup"`.
 * The BS-structural path promotes its each to a structural `each-block`, which
 * `validateMarkup` never inspects — hence the top-level control below asserts
 * silence for a different reason, and is kept as a fail-safe.
 *
 * ═══ ⚑ WHAT VP-1 ACTUALLY REACHES — READ THIS BEFORE ADDING A TEST HERE ═══
 *
 * `walkFileAst` reaches ONE of the five positions an `<each>` can occupy.
 * MEASURED through THIS FILE'S OWN `warningsFor` harness, by planting a
 * genuinely bogus bareword (`bogusattr`) and counting W-ATTR-001:
 *
 *     carrier                alias `as it`   bogus `bogusattr`
 *     lift-expr.expr.node    0 warnings      1 warning     <- REACHED
 *     return-stmt (fn body)  0 warnings      0 warnings    <- NOT reached
 *     markup-value (ternary) 0 warnings      0 warnings    <- NOT reached
 *     render-spec (derived)  0 warnings      0 warnings    <- NOT reached
 *     top-level structural   0 warnings      0 warnings    <- not `kind:"markup"`
 *
 * The consequence is blunt: **in four of the five carriers, "VP-1 emits no
 * warning" is not evidence of anything.** Two tests in the first cut of this
 * file asserted alias-silence in the fn-body and ternary carriers and therefore
 * PASSED WHETHER OR NOT THE EXEMPTION EXISTED — reverting `eachAliasAttrIndices`
 * left both of them green. A test that cannot fail is worse than no test,
 * because it reads as coverage. They are replaced below by REACHABILITY tests
 * that assert the blindness itself, so the day `walkFileAst` is widened those
 * tests go RED and force someone to re-verify the exemption in the newly-reached
 * carriers — which is the moment the assertion becomes meaningful.
 * Tracked as [[g-vp1-walkfileast-reaches-one-of-five-markup-carriers]].
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runAttributeAllowlistFile } from "../../src/validators/attribute-allowlist.ts";

const DOLLAR = "$";

function warningsFor(source, filePath = "/test/each-as-alias-attr-allowlist.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  return runAttributeAllowlistFile({ filePath, ast: tab.ast });
}

/** W-ATTR-001 warnings naming a specific bareword, e.g. `it=`. */
function attr001For(warnings, name) {
  return warnings.filter(
    (w) => w.code === "W-ATTR-001" && w.message.includes(`\`${name}=\``),
  );
}

// The carrier that DID warn pre-fix: lift-expr.expr.node.
const SRC_LIFT_ALIAS = `<program>
<rows> = ["a", "b"]
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each in=@rows as it key=it><li>${DOLLAR}{it}</li></each></ul> } }</div>
</program>
`;

// The carrier that did NOT warn pre-fix — same source shape, different field.
const SRC_FN_ALIAS = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul>
        <each in=@rows as it key=it>
            <li>${DOLLAR}{it}</li>
        </each>
    </ul>
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

// Ternary-markup consequent (the conformance/cases/each/ternary-markup-giti033 shape).
const SRC_TERNARY_ALIAS = `<program>
<rows> = ["a", "b"]
<show> = true
<main>
    ${DOLLAR}{ @show ? <ul><each in=@rows as row key=row><li>${DOLLAR}{row}</li></each></ul> : "" }
</main>
</program>
`;

// §17.7.2 Shape 4 — `of=` count iteration with an alias.
const SRC_OF_ALIAS = `<program>
<slots> = 3
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each of=@slots as day key=day><li>${DOLLAR}{day}</li></each></ul> } }</div>
</program>
`;

// The SAME bogus bareword, per carrier — the reachability probe. `bogusattr` is
// not an `<each>` attribute in any position, so a carrier VP-1 actually visits
// MUST warn on it. Silence here means the walk never arrived.
const SRC_BOGUS_LIFT = `<program>
<rows> = ["a", "b"]
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each in=@rows bogusattr key=1><li>x</li></each></ul> } }</div>
</program>
`;

const SRC_BOGUS_FN = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul><each in=@rows bogusattr key=1><li>x</li></each></ul>
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

const SRC_BOGUS_TERNARY = `<program>
<rows> = ["a", "b"]
<show> = true
<main>${DOLLAR}{ @show ? <ul><each in=@rows bogusattr key=1><li>x</li></each></ul> : "" }</main>
</program>
`;

// §17.1.2 — `if=` on `<each>`, in the ONE carrier VP-1 reaches.
const SRC_EACH_IF = `<program>
<rows> = ["a", "b"]
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each in=@rows as it key=it if=@show><li>x</li></each></ul> } }</div>
</program>
`;

// `show=` on `<each>` — §17.1.2.2 records this as NOMINAL, silently dropped.
const SRC_EACH_SHOW = `<program>
<rows> = ["a", "b"]
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each in=@rows as it key=it show=@show><li>x</li></each></ul> } }</div>
</program>
`;

// A GENUINELY unknown bareword on <each> — not preceded by `as`.
const SRC_UNKNOWN_BAREWORD = `<program>
<rows> = ["a", "b"]
<show> = true
<div>${DOLLAR}{ if @show { lift <ul><each in=@rows bogus><li>x</li></each></ul> } }</div>
</program>
`;

describe("VP-1 — `<each … as NAME>` alias is a binding, not an unrecognized attribute", () => {
  test("lift-expr carrier: `as it` does NOT fire W-ATTR-001 on `it`", () => {
    const warnings = warningsFor(SRC_LIFT_ALIAS);
    expect(attr001For(warnings, "it")).toEqual([]);
  });

  // ⚠ REPLACES two tests that could not fail. They asserted alias-silence in the
  // fn-body and ternary carriers — carriers `walkFileAst` never visits — so they
  // stayed green with the exemption reverted. What follows asserts the REACH
  // instead, which is the property those carriers actually have.

  test("REACHABILITY: VP-1 never visits the fn-body carrier — its silence proves nothing", () => {
    // Both halves are the point. The alias is silent AND a genuinely bogus
    // bareword is silent, so silence here is blindness, not exemption.
    expect(attr001For(warningsFor(SRC_FN_ALIAS), "it")).toEqual([]);
    expect(attr001For(warningsFor(SRC_BOGUS_FN), "bogusattr")).toEqual([]);
    // ⚑ TRIPWIRE. When `walkFileAst` is widened to reach this carrier, the line
    // above goes RED. That is CORRECT and it is the whole point: at that moment
    // the exemption must be re-verified here, and a passing test would have
    // hidden the need.
  });

  test("REACHABILITY: VP-1 never visits the ternary markup-value carrier either", () => {
    expect(attr001For(warningsFor(SRC_TERNARY_ALIAS), "row")).toEqual([]);
    expect(attr001For(warningsFor(SRC_BOGUS_TERNARY), "bogusattr")).toEqual([]);
  });

  test("`of=` count form: `as day` does NOT fire W-ATTR-001 on `day`", () => {
    const warnings = warningsFor(SRC_OF_ALIAS);
    expect(attr001For(warnings, "day")).toEqual([]);
  });

  test("CONSISTENCY: the alias is silent in the ONE carrier where silence is a result", () => {
    // ⚠ REWRITTEN. The first cut compared alias-silence across the lift and
    // fn-body carriers and called agreement a result — but the fn-body half is
    // silent unconditionally, so the comparison was half-blind and the whole
    // assertion reduced to the lift-carrier one.
    //
    // The honest pair is: in the carrier VP-1 REACHES, a bogus bareword warns
    // and the alias does not. That is the exemption doing work, and reverting
    // `eachAliasAttrIndices` turns it red.
    const aliasInReachedCarrier = attr001For(warningsFor(SRC_LIFT_ALIAS), "it").length;
    const bogusInReachedCarrier = attr001For(warningsFor(SRC_BOGUS_LIFT), "bogusattr").length;
    expect({ alias: aliasInReachedCarrier, bogus: bogusInReachedCarrier })
      .toEqual({ alias: 0, bogus: 1 });
  });

  test("CROSS-CARRIER: the two carriers DISAGREE on a bogus attribute — asserted, not fixed", () => {
    // ⚑ THIS ASSERTS A DEFECT, deliberately. The pre-fix complaint about
    // W-ATTR-001 was that it was "a property of WHERE the each sat" — and for a
    // genuinely bad attribute that is STILL true: the lift carrier warns, the
    // fn-body carrier does not. The alias exemption removed the false positive;
    // it did not make VP-1's reach uniform, and nothing in this dispatch did.
    // Asserting the disagreement means the day someone closes
    // [[g-vp1-walkfileast-reaches-one-of-five-markup-carriers]] this test goes
    // red and points straight at the change, instead of the fix landing silently
    // and this file continuing to imply a uniformity that was never verified.
    const lift = attr001For(warningsFor(SRC_BOGUS_LIFT), "bogusattr").length;
    const fnBody = attr001For(warningsFor(SRC_BOGUS_FN), "bogusattr").length;
    expect({ lift, fnBody }).toEqual({ lift: 1, fnBody: 0 });
  });

  // -----------------------------------------------------------------------
  // §17.1.2 — `if=` is ADMITTED on `<each>`, so VP-1 must not call it unknown
  // -----------------------------------------------------------------------

  test("`if=` on `<each>` does NOT fire W-ATTR-001 — §17.1.2 admits it", () => {
    // ⚑ THIS ASSERTION ONLY BECAME CORRECT WHEN THE GATE WAS WIRED. Before the
    // §17.1.2 `if=` lowering landed for lift-parsed eaches, W-ATTR-001 here was
    // ACCURATE — the attribute really was dropped and really had no compile-time
    // effect. Wiring the gate turned the same warning into a FALSE one telling
    // the author their working predicate was inert. The registry entry and the
    // emit have to move together; this test is what keeps them together.
    expect(attr001For(warningsFor(SRC_EACH_IF), "if")).toEqual([]);
  });

  test("`show=` on `<each>` STILL fires W-ATTR-001 — §17.1.2.2 says it is inert", () => {
    // The registry gained EXACTLY ONE attribute. `show=` / `else-if=`
    // composition with the structural trio is NOMINAL and silently dropped
    // ([[g-structural-element-if-chain-and-show-composition-nominal]]), so the
    // warning is TRUE for them. Silencing it would be a widening in the wrong
    // direction, and this test is what stops the next author doing it by
    // symmetry with `if=`.
    expect(attr001For(warningsFor(SRC_EACH_SHOW), "show").length).toBe(1);
  });

  test("FAIL-SAFE: a bareword NOT preceded by `as` still fires W-ATTR-001", () => {
    // The exemption must be keyed to the `as` pairing, not to "any bareword on
    // <each>". A blanket exemption would silence real typos.
    const warnings = warningsFor(SRC_UNKNOWN_BAREWORD);
    expect(attr001For(warnings, "bogus").length).toBe(1);
  });

  test("FAIL-SAFE: `in=` / `key=` keep their normal recognition path", () => {
    // Guard against the alias sweep consuming a following REAL attribute:
    // `as it key=it` must leave `key=` intact and unwarned, and an each with
    // no alias at all must be unaffected.
    const warnings = warningsFor(SRC_LIFT_ALIAS);
    expect(attr001For(warnings, "key")).toEqual([]);
    expect(attr001For(warnings, "in")).toEqual([]);
  });
});
