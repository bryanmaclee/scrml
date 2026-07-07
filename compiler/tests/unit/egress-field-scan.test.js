/**
 * egress-field-scan — Unit Tests
 *
 * The §14.8.9 E-CG-001 protected-field egress scan (acorn-exact, fail-closed).
 * Closes `g-ecg001-protected-field-regex-division-evasion` (HIGH, S244): the
 * earlier scan built its code-position view from `rewriteCodeSegments`, whose
 * `regexAllowedAfter` mask-bias mis-scanned `const of = 2; of / row.ssn / 2` as
 * a regex literal — swallowing `.ssn` out of the view so E-CG-001 did NOT fire
 * and the protected field shipped to the client silently.
 *
 * The scan now tokenizes via acorn, which resolves regex-vs-division exactly
 * (the emitted client JS is valid JS by construction), and fails CLOSED when the
 * bundle does not parse.
 */

import { describe, test, expect } from "bun:test";
import { scanClientEgress } from "../../src/codegen/egress-field-scan.ts";

const PROT = new Set(["ssn"]);
function found(src, prot = PROT) {
  const r = scanClientEgress(src, prot);
  return { fires: !r.parseError && r.fieldsInCodePosition.has("ssn"), r };
}

describe("egress-field-scan — the filed regex-division evasion now fires", () => {
  test("`of` as a variable: `const of = 2; const r = of / row.ssn / 2;` FIRES", () => {
    expect(found("const of = 2; const r = of / row.ssn / 2;").fires).toBe(true);
  });

  test("`in` as a variable name before division FIRES", () => {
    expect(found("function q(){ let inn = 4; return inn / row.ssn / 2; }").fires).toBe(true);
  });

  test("`await`-shaped identifier division FIRES", () => {
    // `awaitX` is a plain identifier; `/` after it is division, not a regex.
    expect(found("let awaitX = 8; let r = awaitX / row.ssn / 2;").fires).toBe(true);
  });

  test("`yield`-shaped identifier division FIRES", () => {
    expect(found("let yieldy = 8; let r = yieldy / row.ssn / 2;").fires).toBe(true);
  });
});

describe("egress-field-scan — genuine member-access forms fire", () => {
  test("plain member access `row.ssn / 2` FIRES", () => {
    expect(found("const r = row.ssn / 2;").fires).toBe(true);
  });

  test("optional-chained member `row?.ssn` FIRES", () => {
    expect(found("let v = row?.ssn;").fires).toBe(true);
  });

  test("template-interpolation `${row.ssn}` (code position) FIRES", () => {
    expect(found("el.textContent = `SSN: ${row.ssn}`;").fires).toBe(true);
  });
});

describe("egress-field-scan — string/comment/regex exclusion preserved", () => {
  test("field name inside a STRING LITERAL does NOT fire", () => {
    expect(found('let label = "Please enter your row.ssn below";').fires).toBe(false);
  });

  test("field name inside a LINE COMMENT does NOT fire", () => {
    expect(found("// row.ssn note here\nlet x = 1;").fires).toBe(false);
  });

  test("field name inside a BLOCK COMMENT does NOT fire", () => {
    expect(found("/* label: row.ssn */ let x = 1;").fires).toBe(false);
  });

  test("field name inside a REGEX LITERAL does NOT fire", () => {
    expect(found("let re = /row.ssn/g;").fires).toBe(false);
  });

  test("field name as an OBJECT LITERAL key (a name written, not a column read) does NOT fire", () => {
    expect(found('let o = { ssn: "just a key name" };').fires).toBe(false);
  });

  test("clean code with no protected access does NOT fire", () => {
    expect(found("const total = a + b; function foo(){ return bar.baz; }").fires).toBe(false);
  });
});

describe("egress-field-scan — sibling access forms (computed + destructuring) closed for free", () => {
  test("computed member with string-literal key `row[\"ssn\"]` FIRES", () => {
    expect(found('let v = row["ssn"];').fires).toBe(true);
  });

  test("computed member with template key `row[`ssn`]` FIRES", () => {
    expect(found("let v = row[`ssn`];").fires).toBe(true);
  });

  test("object-destructuring `const {ssn} = row` FIRES", () => {
    expect(found("const {ssn} = row;").fires).toBe(true);
  });

  test("renamed destructuring `const {ssn: masked} = row` FIRES", () => {
    expect(found("const {ssn: masked} = row;").fires).toBe(true);
  });

  test("import specifier binding of the same name does NOT fire (not a column read)", () => {
    expect(found('import { ssn } from "./mod.js";').fires).toBe(false);
  });
});

describe("egress-field-scan — fail-closed on unparseable emitted JS", () => {
  test("unparseable client JS reports parseError (caller fails closed)", () => {
    const r = scanClientEgress("const x = = = ;", PROT);
    expect(r.parseError).toBe(true);
    expect(typeof r.parseErrorMessage).toBe("string");
  });

  test("a leaked bundle that ALSO has a parse error still reports parseError (never a silent pass)", () => {
    const r = scanClientEgress("let v = row.ssn; const y = = ;", PROT);
    expect(r.parseError).toBe(true);
  });
});

describe("egress-field-scan — edge cases", () => {
  test("empty protectedFields set never fires or parses", () => {
    const r = scanClientEgress("row.ssn / 2", new Set());
    expect(r.parseError).toBe(false);
    expect(r.fieldsInCodePosition.size).toBe(0);
  });

  test("empty client code does not fire", () => {
    const r = scanClientEgress("", PROT);
    expect(r.parseError).toBe(false);
    expect(r.fieldsInCodePosition.size).toBe(0);
  });

  test("multiple protected fields — only the accessed one is reported", () => {
    const r = scanClientEgress("let a = row.ssn; let b = 1;", new Set(["ssn", "salary"]));
    expect(r.parseError).toBe(false);
    expect([...r.fieldsInCodePosition].sort()).toEqual(["ssn"]);
  });
});
