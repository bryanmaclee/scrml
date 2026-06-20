/**
 * E-ATTR-UNQUOTED-OPERATOR — bare-operator reject in unquoted attribute
 * conditions (cluster-A, S188 "reject + parens").
 *
 * SPEC §5.2 / §17.1: an unquoted CONDITION attribute (`if=` / `show=` /
 * `else-if=`) admits ONLY the atomic forms — identifier (`@var` / `obj.prop`),
 * call (`fn()`), or prefix `!`. A bare binary/ternary operator
 * (`>= > < <= == != && || + - * /` or ternary `?:`) SHALL fire
 * E-ATTR-UNQUOTED-OPERATOR exactly once, steering to parens (`if=(expr)`) or
 * quotes (`if="expr"`). The parenthesized and quoted forms handle ALL operators
 * correctly.
 *
 * Before this rule the unquoted-value reader silently shredded the operator +
 * RHS (the dangerous class — operand leaked / dropped) or let the `>` of `>=`
 * close the tag early (the misleading E-CTX-001 cascade). This file is the
 * full bare-operator-matrix regression surface for the reject + no-cascade
 * behavior, plus the preserve-atomic / paren / quote / E-TYPE-045 cases.
 *
 * Enforcement loci:
 *   - tokenizer.ts — attrConditionOperatorAhead detects the operator at the
 *     unquoted-value-reader exit; captures the run as an ATTR_OP_REJECT token.
 *   - ast-builder.js — ATTR_OP_REJECT fires E-ATTR-UNQUOTED-OPERATOR, recovers
 *     the value as absent (no cascade).
 *   - block-splitter.js — `>=` early guard (so the `>` of `>=` no longer closes
 *     the tag) + ternary `?`-depth tracking (so a stray unquoted ternary `:` is
 *     not mistaken for a `:`-shorthand body introducer).
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileWholeScrml(source, testName = `attropreject-${++tmpCounter}`) {
  // Sanitize: operator labels (`/`, `?:`, spaces) must not leak into the path.
  const safe = String(testName).replace(/[^A-Za-z0-9_-]+/g, "_") || `attropreject-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${safe}`);
  const tmpInput = resolve(tmpDir, `${safe}.scrml`);
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

function codesOf(errors) {
  return errors.map((e) => e.code);
}
function countCode(errors, code) {
  return codesOf(errors).filter((c) => c === code).length;
}

const REJECT = "E-ATTR-UNQUOTED-OPERATOR";

// A `<program>` wrapper declaring @n / @m / @obj + a boolean `check()` so the
// condition references resolve cleanly (isolating the operator-reject as the
// ONLY structural diagnostic).
function wrap(body) {
  return `<program>
\${
    <n> = 5
    <m> = 3
    <obj> = { flag: true }
    <isReady> = false
    function check() { return @n > 0 }
}
${body}
</>`;
}

// =============================================================================
// REJECT — every bare binary/ternary operator fires E-ATTR-UNQUOTED-OPERATOR
// exactly ONCE, with NO silent shred and NO E-CTX-001 cascade.
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — bare operator matrix (if=)", () => {
  const operatorCases = [
    [">=", "@n >= 3"],
    [">", "@n > 3"],
    ["<", "@n < 3"],
    ["<=", "@n <= 3"],
    ["==", "@n == 3"],
    ["!=", "@n != 3"],
    ["&&", "@n && @m"],
    ["||", "@n || @m"],
    ["+", "@n + 1"],
    ["-", "@n - 1"],
    ["*", "@n * 1"],
    ["/", "@n / 1"],
    ["?: (spaced)", "@n ? @m : @n"],
    ["?: (no-space)", "@n?@m:@n"],
  ];

  for (const [label, expr] of operatorCases) {
    test(`bare \`${label}\` (if=${expr}) — fires REJECT exactly once`, () => {
      const { errors } = compileWholeScrml(wrap(`    <p if=${expr}>x</>`), `if-${label}`);
      // Fires exactly once.
      expect(countCode(errors, REJECT)).toBe(1);
      // No misleading tag-close cascade.
      expect(codesOf(errors)).not.toContain("E-CTX-001");
      // No silent shred leaking a stranded operand as an unresolved bareword.
      expect(codesOf(errors)).not.toContain("E-SCOPE-001");
    });
  }

  test("jammed `>=` (if=@n>=3) — fires REJECT, no E-CTX-001 (g-attr-gte-tagclose)", () => {
    const { errors } = compileWholeScrml(wrap(`    <p if=@n>=3>x</>`), "if-jammed-gte");
    expect(countCode(errors, REJECT)).toBe(1);
    expect(codesOf(errors)).not.toContain("E-CTX-001");
  });

  test("compound `&&` (if=@n && @m) — no DOM-leak / no E-DG-002 stranded cell", () => {
    // Pre-fix `@m` leaked as a stray ATTR_NAME and surfaced E-DG-002
    // ("declared but never consumed"). The reject now captures the whole run.
    const { errors } = compileWholeScrml(wrap(`    <p if=@n && @m>x</>`), "if-and-noleak");
    expect(countCode(errors, REJECT)).toBe(1);
    expect(codesOf(errors)).not.toContain("E-DG-002");
  });
});

// =============================================================================
// KEYWORD is-OPERATORS (§42 absence/presence) — `is not` / `is some` /
// `is not not`. Postfix operators that were ABSENT from the cluster-A op-set:
// the bare form silently DROPPED the keyword run. For `is not` this was also an
// INVERSION — `if=fn() is not` emitted `if((fn()))` (plain truthiness) instead
// of the absence check (g-attr-bare-compound-is-op-silent-drop, S209 ratified
// REJECT-with-parens). Both the bare-ident AND the call path are covered — the
// call path (`if=fn() <op>`) previously committed to ATTR_CALL and never
// reached the operator-reject check at all (latent for binary ops too).
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — keyword is-operators (if=)", () => {
  const isOpCases = [
    ["is not (ident)", "@n is not"],
    ["is some (ident)", "@n is some"],
    ["is not not (ident)", "@n is not not"],
    ["is not (member)", "@obj.flag is not"],
    ["is not (call)", "check() is not"],
    ["is some (call)", "check() is some"],
    ["is not not (call)", "check() is not not"],
  ];

  for (const [label, expr] of isOpCases) {
    test(`bare \`${label}\` (if=${expr}) — fires REJECT exactly once`, () => {
      const { errors } = compileWholeScrml(wrap(`    <p if=${expr}>x</>`), `if-${label}`);
      expect(countCode(errors, REJECT)).toBe(1);
      // No silent-WRONG truthiness emission: the operator is rejected, not dropped.
      expect(codesOf(errors)).not.toContain("E-CTX-001");
      expect(codesOf(errors)).not.toContain("E-SCOPE-001");
    });
  }

  test("show=@n is not — fires REJECT", () => {
    const { errors } = compileWholeScrml(wrap(`    <p show=@n is not>x</>`), "show-isnot");
    expect(countCode(errors, REJECT)).toBe(1);
  });

  test("else-if=check() is some (chained) — fires REJECT", () => {
    const body = `    <p if=@n>a</>
    <p else-if=check() is some>b</>`;
    const { errors } = compileWholeScrml(wrap(body), "elseif-issome");
    expect(countCode(errors, REJECT)).toBe(1);
  });

  test("diagnostic names the keyword operator and steers to parens/quotes (call form)", () => {
    const { errors } = compileWholeScrml(wrap(`    <p if=check() is not>x</>`), "isnot-msg");
    const rej = errors.find((e) => e.code === REJECT);
    expect(rej).toBeTruthy();
    expect(rej.message).toContain("is not");
    expect(rej.message).toContain("if=(check() is not)");
    expect(rej.message).toContain('if="check() is not"');
  });
});

// =============================================================================
// CALL PATH — a CONDITION attribute CALL followed by a bare BINARY operator
// (`if=fn() && @m`) was the same silent-drop class as the keyword is-ops: the
// ATTR_CALL emit committed before the operator-reject check could run. Now
// shares pushConditionOpReject with the bare-ident path.
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — call followed by a binary operator (if=)", () => {
  const callOpCases = [
    ["&&", "check() && @m"],
    [">=", "check() >= @n"],
    ["==", "check() == @n"],
    ["?: (spaced)", "check() ? @n : @m"],
  ];
  for (const [label, expr] of callOpCases) {
    test(`bare \`${label}\` (if=${expr}) — fires REJECT exactly once`, () => {
      const { errors } = compileWholeScrml(wrap(`    <p if=${expr}>x</>`), `ifcall-${label}`);
      expect(countCode(errors, REJECT)).toBe(1);
      expect(codesOf(errors)).not.toContain("E-CTX-001");
      expect(codesOf(errors)).not.toContain("E-SCOPE-001");
    });
  }
});

describe("E-ATTR-UNQUOTED-OPERATOR — show= and else-if= conditions", () => {
  test("show=@n && @m — fires REJECT", () => {
    const { errors } = compileWholeScrml(wrap(`    <p show=@n && @m>x</>`), "show-and");
    expect(countCode(errors, REJECT)).toBe(1);
    expect(codesOf(errors)).not.toContain("E-CTX-001");
  });

  test("else-if=@m > 2 (chained) — fires REJECT", () => {
    const body = `    <p if=@n>a</>
    <p else-if=@m > 2>b</>`;
    const { errors } = compileWholeScrml(wrap(body), "elseif-gt");
    expect(countCode(errors, REJECT)).toBe(1);
    expect(codesOf(errors)).not.toContain("E-CTX-001");
  });
});

// =============================================================================
// PRESERVE — atomic forms, quoted, and parenthesized conditions stay CLEAN.
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — preserved atomic/quote/paren forms (clean)", () => {
  const cleanCases = [
    ["atomic @n", "    <p if=@n>x</>"],
    ["prefix !@n", "    <p if=!@n>x</>"],
    ["member @obj.flag", "    <p if=@obj.flag>x</>"],
    ["call fn()", "    <p if=check()>x</>"],
    ["show= atomic", "    <p show=@n>x</>"],
    // Quoted + parenthesized forms handle ALL operators correctly.
    ['quoted "@n && @m"', '    <p if="@n && @m">x</>'],
    ['quoted "@n >= 3"', '    <p if="@n >= 3">x</>'],
    ["paren (@n >= 3)", "    <p if=(@n >= 3)>x</>"],
    ["paren (@n && @m)", "    <p if=(@n && @m)>x</>"],
    ["paren (@n ? @m : @n)", "    <p if=(@n ? @m : @n)>x</>"],
    ["paren nested ((@n || @m) && @obj.flag)", "    <p if=((@n || @m) && @obj.flag)>x</>"],
    // Keyword is-op: paren/quoted forms stay clean (the reject only steers the BARE form).
    ["paren (check() is not)", "    <p if=(check() is not)>x</>"],
    ["paren (@n is some)", "    <p if=(@n is some)>x</>"],
    ['quoted "check() is not"', '    <p if="check() is not">x</>'],
    // Identifier that merely STARTS with `is` is not the operator (whole-word guard).
    ["atomic @isReady (starts with is)", "    <p if=@isReady>x</>"],
  ];

  for (const [label, body] of cleanCases) {
    test(`${label} — no REJECT, no errors`, () => {
      const { errors } = compileWholeScrml(wrap(body), `clean-${label}`);
      expect(codesOf(errors)).not.toContain(REJECT);
      // No structural / scope errors of any kind.
      const errCodes = codesOf(errors).filter((c) => /^E-/.test(c));
      expect(errCodes).toEqual([]);
    });
  }
});

// =============================================================================
// PRECEDENCE — bare `not` stays E-TYPE-045; binary operator wins over inner
// `not`; never both, never silent.
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — precedence vs. prefix-`not` (E-TYPE-045)", () => {
  test("bare `not @y` (if=not @y) — fires E-TYPE-045, NOT the operator reject", () => {
    // `not` is a PREFIX operator (§42.10 → E-TYPE-045), not a binary operator.
    const { errors } = compileWholeScrml(wrap(`    <p if=not @n>x</>`), "not-bare");
    expect(codesOf(errors)).toContain("E-TYPE-045");
    expect(codesOf(errors)).not.toContain(REJECT);
  });

  test("compound `@x && not @y` (bare) — binary-operator reject wins; E-TYPE-045 does NOT also fire", () => {
    const { errors } = compileWholeScrml(wrap(`    <p if=@n && not @m>x</>`), "and-not-bare");
    expect(countCode(errors, REJECT)).toBe(1);
    expect(codesOf(errors)).not.toContain("E-TYPE-045"); // never both
  });

  test("parenthesized `(@x && not @y)` — inner `not` then surfaces E-TYPE-045", () => {
    // The second step of the two-step correction: once parenthesized per the
    // reject steer, the inner prefix-`not` fires E-TYPE-045.
    const { errors } = compileWholeScrml(wrap(`    <p if=(@n && not @m)>x</>`), "and-not-paren");
    expect(codesOf(errors)).toContain("E-TYPE-045");
    expect(codesOf(errors)).not.toContain(REJECT);
  });
});

// =============================================================================
// DIAGNOSTIC SHAPE — message names the operator + steers to parens/quotes.
// =============================================================================

describe("E-ATTR-UNQUOTED-OPERATOR — diagnostic message", () => {
  test("names the operator and steers to both parens and quotes", () => {
    const { errors } = compileWholeScrml(wrap(`    <p if=@n >= 3>x</>`), "msg-shape");
    const rej = errors.find((e) => e.code === REJECT);
    expect(rej).toBeTruthy();
    expect(rej.message).toContain(">=");
    expect(rej.message).toContain("if=(@n >= 3)");
    expect(rej.message).toContain('if="@n >= 3"');
  });
});
