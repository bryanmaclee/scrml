/**
 * E-TYPE-045 — prefix-`not`-as-negation enforcement (SPEC §42.10).
 *
 * S188 (g-not-negation-enforce): `not` is the unified absence VALUE, not a
 * boolean-negation operator. Prefix-`not`-as-negation SHALL fire E-TYPE-045 in
 * EVERY expression position and BOTH forms (bare `not @x` + paren `not (expr)`).
 * The negation operator is `!`.
 *
 * Enforcement locus: the expression-parser lowering choke-point
 * (`preprocessForAcorn`) stamps `_notPrefixNegation` on the returned ExprNode;
 * `harvestNotPrefixNegation` (type-system) emits E-TYPE-045 once per stamped
 * node. This file is the all-positions / both-forms / valid-form-preservation
 * regression surface for that path.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `etype045-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map((e) => e.code);
}
function fires045(src, name) {
  return codes(compileWholeScrml(src, name).errors).includes("E-TYPE-045");
}
function firesCode(src, code, name) {
  return codes(compileWholeScrml(src, name).errors).includes(code);
}

// =============================================================================
// FORBIDDEN positions — E-TYPE-045 MUST fire (bare + paren, all positions).
// =============================================================================

describe("E-TYPE-045 fires — bare `not @x` in every expression position", () => {
  test("if-condition (bare)", () => {
    const src = `\${
    let ready = true
    if (not @ready) { let _b = 1 }
}
<program><p>x</></>`;
    expect(fires045(src, "bare-if")).toBe(true);
  });

  test("while-condition (bare)", () => {
    const src = `\${
    let go = true
    while (not @go) { @go = false }
}
<program><p>x</></>`;
    expect(fires045(src, "bare-while")).toBe(true);
  });

  test("attribute `if=` (genuinely bare — `if=not @y`, S188 follow-up hole)", () => {
    // The bare (non-parenthesized) prefix-`not` in an UNQUOTED attribute value
    // was the SOLE uncovered position after the choke-point landing: the
    // tokenizer shredded `not @y` into ATTR_IDENT "not" + a stray `@y`, so the
    // negation never reached the lowering choke-point. Now captured as a single
    // ATTR_EXPR -> stamped -> harvest fires E-TYPE-045 exactly once.
    const src = `<program>
\${
    <y> = true
}
    <p if=not @y>z</>
</>`;
    expect(fires045(src, "attr-bare-if")).toBe(true);
  });

  test("attribute `show=` (genuinely bare — `show=not @y`)", () => {
    const src = `<program>
\${
    <y> = true
}
    <p show=not @y>z</>
</>`;
    expect(fires045(src, "attr-bare-show")).toBe(true);
  });

  test("attribute `if=` member operand (bare — `if=not obj.ok`)", () => {
    const src = `<program>
\${
    <o> = { ok: true }
}
    <p if=not @o.ok>z</>
</>`;
    expect(fires045(src, "attr-bare-member")).toBe(true);
  });

  test("attribute compound condition (`if=@x && not @y`) — cluster-A precedence: binary-operator reject wins over inner `not`", () => {
    // cluster-A (S188 "reject + parens"): an unquoted attribute CONDITION cannot
    // contain a binary operator. The tokenizer captures the whole `@x && not @y`
    // run on hitting `&&` and fires E-ATTR-UNQUOTED-OPERATOR (the more-structural
    // violation — the unquoted compound itself) BEFORE the inner `not` is ever
    // isolated as a stray attribute. PRECEDENCE: the binary-operator reject wins;
    // E-TYPE-045 does NOT also fire (never both, never silent). Once the author
    // parenthesizes per the steer, the paren form then fires E-TYPE-045 on the
    // inner `not` (the second test below) — a coherent two-step correction.
    const src = `<program>
\${
    <x> = true
    <y> = true
}
    <p if=@x && not @y>z</>
</>`;
    expect(firesCode(src, "E-ATTR-UNQUOTED-OPERATOR", "attr-bare-compound")).toBe(true);
    // Precedence: the operator-reject is the ONLY diagnostic for the bare form.
    expect(fires045(src, "attr-bare-compound-no045")).toBe(false);
  });

  test("parenthesized attribute compound with inner `not` (`if=(@x && not @y)`) — E-TYPE-045 fires on the `not`", () => {
    // The paren form is the canonical operator-condition vehicle: it tokenizes
    // as ATTR_EXPR and routes through the parseExprToNode lowering choke-point,
    // so the inner prefix-`not`-as-negation surfaces E-TYPE-045 (the §42.10
    // violation) — the second step of the two-step correction.
    const src = `<program>
\${
    <x> = true
    <y> = true
}
    <p if=(@x && not @y)>z</>
</>`;
    expect(fires045(src, "attr-paren-compound")).toBe(true);
  });

  test("`${...}` interpolation (bare)", () => {
    const src = `\${
    let on = true
}
<program>
    <p>\${ not @on ? "off" : "on" }</>
</>`;
    expect(fires045(src, "bare-interp")).toBe(true);
  });

  test("ternary operand (bare)", () => {
    const src = `\${
    let on = true
    let label = not @on ? "off" : "on"
}
<program><p>\${@label}</></>`;
    expect(fires045(src, "bare-ternary")).toBe(true);
  });

  test("`&&` operand (bare)", () => {
    const src = `\${
    let a = true
    let b = true
    let r = (not @a) && @b
}
<program><p>\${@r}</></>`;
    expect(fires045(src, "bare-and")).toBe(true);
  });

  test("return position (bare)", () => {
    const src = `\${
    let x = true
    fn check() {
        return not @x
    }
}
<program><p>x</></>`;
    expect(fires045(src, "bare-return")).toBe(true);
  });

  test("call-argument position (bare)", () => {
    const src = `\${
    let x = true
    fn use(v) { return v }
    let r = use(not @x)
}
<program><p>\${@r}</></>`;
    expect(fires045(src, "bare-callarg")).toBe(true);
  });

  test("member-access operand (bare `not obj.prop`)", () => {
    const src = `\${
    let o = { ok: true }
    if (not o.ok) { let _b = 1 }
}
<program><p>x</></>`;
    expect(fires045(src, "bare-member")).toBe(true);
  });
});

describe("E-TYPE-045 fires — parenthesized `not (expr)` in every position", () => {
  test("if-condition (paren) — the legacy-supported path", () => {
    const src = `\${
    let flag = true
    if (not (flag)) { let _b = 1 }
}
<program><p>x</></>`;
    expect(fires045(src, "paren-if")).toBe(true);
  });

  test("attribute `if=` (paren)", () => {
    const src = `\${
    let x = 1
}
<program>
    <p if=(not (@x == 1))>y</>
</>`;
    expect(fires045(src, "paren-attr")).toBe(true);
  });

  test("`${...}` interpolation (paren)", () => {
    const src = `\${
    let x = 1
}
<program>
    <p>\${ not (@x == 1) ? "a" : "b" }</>
</>`;
    expect(fires045(src, "paren-interp")).toBe(true);
  });

  test("ternary operand (paren)", () => {
    const src = `\${
    let x = 1
    let r = not (@x == 1) ? "a" : "b"
}
<program><p>\${@r}</></>`;
    expect(fires045(src, "paren-ternary")).toBe(true);
  });

  test("derived-RHS / let-init (paren)", () => {
    const src = `\${
    let x = 1
    let inverted = not (@x == 1)
}
<program><p>\${@inverted}</></>`;
    expect(fires045(src, "paren-derived")).toBe(true);
  });
});

describe("E-TYPE-045 fires once — no double-fire", () => {
  test("single fire on if-condition paren", () => {
    const src = `\${
    let flag = true
    if (not (flag)) { let _b = 1 }
}
<program><p>x</></>`;
    const all = codes(compileWholeScrml(src, "single-fire").errors);
    const n = all.filter((c) => c === "E-TYPE-045").length;
    expect(n).toBe(1);
  });

  test("single fire on parenthesized-attr `if=(not @y)` (no double with the bare-attr path)", () => {
    // The paren-attr form already routed through the choke-point and fired.
    // The S188 follow-up adds a bare-attr capture path; ensure the paren-attr
    // form still fires EXACTLY once (the harvest dedups by span).
    const src = `<program>
\${
    <y> = true
}
    <p if=(not @y)>z</>
</>`;
    const all = codes(compileWholeScrml(src, "single-fire-paren-attr").errors);
    const n = all.filter((c) => c === "E-TYPE-045").length;
    expect(n).toBe(1);
  });

  test("single fire on bare-attr `if=not @y` (no double)", () => {
    const src = `<program>
\${
    <y> = true
}
    <p if=not @y>z</>
</>`;
    const all = codes(compileWholeScrml(src, "single-fire-bare-attr").errors);
    const n = all.filter((c) => c === "E-TYPE-045").length;
    expect(n).toBe(1);
  });
});

// =============================================================================
// VALID forms — E-TYPE-045 MUST NOT fire (absence value, not negation).
// =============================================================================

describe("E-TYPE-045 does NOT fire — valid `not` (absence) forms", () => {
  test("`x is not` absence predicate", () => {
    const src = `\${
    let x = "" | not
    let absent = @x is not
}
<program><p>\${@absent}</></>`;
    expect(fires045(src, "valid-is-not")).toBe(false);
  });

  test("`x is not not` presence predicate", () => {
    const src = `\${
    let x = "" | not
    let present = @x is not not
}
<program><p>\${@present}</></>`;
    expect(fires045(src, "valid-is-not-not")).toBe(false);
  });

  test("`let x = not` assignment-position absence value", () => {
    const src = `\${
    let x: string | not = not
}
<program><p>x</></>`;
    expect(fires045(src, "valid-assign-not")).toBe(false);
  });

  test("`return not` value-completion absence", () => {
    const src = `\${
    fn maybe() {
        return not
    }
}
<program><p>x</></>`;
    expect(fires045(src, "valid-return-not")).toBe(false);
  });

  test("canonical `!@x` boolean negation compiles clean", () => {
    const src = `\${
    let ready = true
    if (!@ready) { let _b = 1 }
}
<program><p>x</></>`;
    expect(fires045(src, "valid-bang")).toBe(false);
  });

  test("regex-literal `not` interior is not negation (GITI-017 guard)", () => {
    const src = `\${
    fn classify(input) {
        if (/not a repo/i.test(input)) return "nope"
        return "ok"
    }
}
<program><p>x</></>`;
    expect(fires045(src, "valid-regex-not")).toBe(false);
  });

  test("string-literal `not` interior is not negation", () => {
    const src = `\${
    let msg = "this is not negation"
}
<program><p>\${@msg}</></>`;
    expect(fires045(src, "valid-string-not")).toBe(false);
  });

  test("markup text `not` prose is not negation", () => {
    const src = `\${
    let x = 1
}
<program>
    <p>Item not found.</>
</>`;
    expect(fires045(src, "valid-prose-not")).toBe(false);
  });

  test("`if=not` (no operand) is the absence VALUE, not negation (attr-bare guard)", () => {
    // A bare `if=not` with NO operand following is the unified absence value as
    // a boolean attr value — NOT a prefix-negation. It must stay ATTR_IDENT and
    // never fire E-TYPE-045.
    const src = `<program>
\${
    <y> = true
}
    <p if=not>z</>
</>`;
    expect(fires045(src, "valid-attr-if-not-absence")).toBe(false);
  });

  test("an attribute literally NAMED `not` (`not=@y`) is not prefix-negation", () => {
    // `<p not=@y>` is a (non-standard) attribute whose NAME is `not` with value
    // `@y` — it carries an `=`, so it is not the stray-bareword prefix-`not`
    // shred. E-TYPE-045 MUST NOT fire here.
    const src = `<program>
\${
    <y> = true
}
    <p not=@y>z</>
</>`;
    expect(fires045(src, "valid-attr-named-not")).toBe(false);
  });

  test("outer `not (x is not)` STILL fires (the inner is-not is valid; the outer prefix-not is negation)", () => {
    // `not (e is not)` = NOT(e is absent) = "e is present". The OUTER prefix-`not`
    // is the forbidden boolean-negation form (use `!(e is not)`); the inner
    // `is not` is the valid absence predicate. E-TYPE-045 MUST fire on the outer.
    const src = `\${
    let e = "" | not
    let present = not (@e is not)
}
<program><p>\${@present}</></>`;
    expect(fires045(src, "outer-not-inner-isnot")).toBe(true);
  });
});
