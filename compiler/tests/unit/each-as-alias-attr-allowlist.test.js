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

  test("fn-body carrier: `as it` does NOT fire W-ATTR-001 on `it`", () => {
    const warnings = warningsFor(SRC_FN_ALIAS);
    expect(attr001For(warnings, "it")).toEqual([]);
  });

  test("ternary-markup carrier: `as row` does NOT fire W-ATTR-001 on `row`", () => {
    const warnings = warningsFor(SRC_TERNARY_ALIAS);
    expect(attr001For(warnings, "row")).toEqual([]);
  });

  test("`of=` count form: `as day` does NOT fire W-ATTR-001 on `day`", () => {
    const warnings = warningsFor(SRC_OF_ALIAS);
    expect(attr001For(warnings, "day")).toEqual([]);
  });

  test("CONSISTENCY: the two carriers agree — neither warns on the alias", () => {
    // The pre-fix defect was not just a false positive, it was a false
    // positive that depended on the enclosing AST field. Assert agreement
    // directly so a future regression that reintroduces it in ONE carrier
    // fails here even if the per-carrier tests are read as independent.
    const lift = attr001For(warningsFor(SRC_LIFT_ALIAS), "it").length;
    const fnBody = attr001For(warningsFor(SRC_FN_ALIAS), "it").length;
    expect({ lift, fnBody }).toEqual({ lift: 0, fnBody: 0 });
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
