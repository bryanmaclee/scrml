// g-multistatement-line-nonfirst-call-drop (#162, S284) — CONFORMANT-REJECT.
//
// BUG (HIGH, silent codegen data-loss): a call expression that was NOT the first
// statement on a SAME-LINE, space-separated multi-statement run was silently
// DROPPED from the emitted JS by the legacy pipeline (collectExpr in ast-builder.js).
// Clean build, 0 errors, no warning. Same-line assignments split fine (both emitted)
// but a bare LOCAL call (`log.push(x)`) whose peek(1) is `.` matched no boundary
// check, so the preceding statement's collectExpr-RHS greedily swallowed it; Acorn
// then parsed only the first expression and dropped the single-line trailing content
// (the expression-parser.ts:2949 stopgap only fires on NEWLINE-bearing trailers).
//   `probe()` returned "B,D,E1" instead of "A,B,C,D,E1,E2".
//
// FIX (bryan-ruled S284): CONFORMANT-REJECT — a same-line multi-statement run
// (two statements juxtaposed on one line, separated only by whitespace, no `;` or
// newline) is ill-formed by SPEC §4 (`E-STMT-MISSING-SEMICOLON`: "Expected `;` or a
// newline to end the statement"). The native parser (`--parser=scrml-native`) ALREADY
// rejects this; the legacy pipeline now fires the SAME §34 code, bringing the two
// parsers into conformance. NEWLINE-separated multi-statement stays clean (ASI) — the
// hard regression guard.
//
// This file asserts the legacy-parse diagnostic behaviour. The native side's identical
// rejection is exercised by the native-parser suites; here we pin the legacy fire +
// the newline guard + the swallow-then-error recovery.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(scrmlSource) {
  const tag = `msl-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_msl_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let clientJs = "";
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? "";
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codesOf = (r) => (r.errors || []).map((e) => e.code);
const countCode = (r, code) => codesOf(r).filter((c) => c === code).length;

// -----------------------------------------------------------------------------
// §1 — same-line multi-statement runs are REJECTED with E-STMT-MISSING-SEMICOLON
// -----------------------------------------------------------------------------
describe("§1 same-line multi-statement runs error (E-STMT-MISSING-SEMICOLON)", () => {
  test("same-line multi-assignment errors", () => {
    // `a = 1 b = 2` on one line — split fine before the fix (both emitted); now rejected.
    const r = compile(`\${
    function f() {
        let a = 0
        let b = 0
        if (a == 0) { a = 1 b = 2 }
        return a + b
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
    expect(countCode(r, "E-STMT-MISSING-SEMICOLON")).toBe(1);
  });

  test("same-line assignment-then-call errors (the previously-SWALLOWED shape)", () => {
    // `b = 2 log.push("A")` — the call was silently dropped pre-fix.
    const r = compile(`\${
    function f() {
        let log = []
        let b = 0
        if (b == 0) { b = 2 log.push("A") }
        return log.join(",")
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
    expect(countCode(r, "E-STMT-MISSING-SEMICOLON")).toBe(1);
  });

  test("same-line call-then-call errors", () => {
    // `log.push("E1") log.push("E2")` — the second call was silently dropped pre-fix.
    const r = compile(`\${
    function f() {
        let log = []
        let a = 0
        if (a == 0) { log.push("E1") log.push("E2") }
        return log.join(",")
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
    expect(countCode(r, "E-STMT-MISSING-SEMICOLON")).toBe(1);
  });

  test("same-line call-then-assignment errors", () => {
    // `log.push("B") a = 3` — split fine before the fix; now rejected.
    const r = compile(`\${
    function f() {
        let log = []
        let a = 0
        if (a == 0) { log.push("B") a = 3 }
        return log.join(",") + a
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
    expect(countCode(r, "E-STMT-MISSING-SEMICOLON")).toBe(1);
  });

  test("the full #162 repro fires exactly 6 (matches the native parser count)", () => {
    // 6 missing terminators across 5 same-line runs: 2 + 1 + 2 + 0 + 1.
    const r = compile(`\${
    function probe() {
        let log = []
        let a = 0
        let b = 0
        if (a == 0) { a = 1 b = 2 log.push("A") }
        if (a == 1) { log.push("B") a = 3 }
        if (a == 3) { a = 4 log.push("C") b = 5 }
        if (a == 4) { log.push("D") }
        if (a == 4) { log.push("E1") log.push("E2") }
        return log.join(",")
    }
}
<div id="out">\${probe()}</div>
`);
    expect(countCode(r, "E-STMT-MISSING-SEMICOLON")).toBe(6);
  });

  test("same-line @cell deep-set juxtaposition errors", () => {
    // `@a.ref = \"p\" @a.ref = \"q\"` — two deep-sets on one line.
    const r = compile(`<a> = { ref: "" }
\${
    function f() {
        if (true) { @a.ref = "p" @a.ref = "q" }
    }
}
<button onclick=f()>go</button>
<p>\${@a.ref}</p>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
  });
});

// -----------------------------------------------------------------------------
// §2 — REGRESSION GUARD: newline-separated multi-statement stays CLEAN
// -----------------------------------------------------------------------------
describe("§2 newline-separated multi-statement stays clean (hard regression guard)", () => {
  test("flat body: newline-separated assignment + calls compile clean, all calls preserved", () => {
    const r = compile(`\${
    function probeFlat() {
        let log = []
        let a = 0
        a = 1
        log.push("A")
        log.push("B")
        return log.join(",")
    }
}
<div id="flat">\${probeFlat()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toContain('log.push("A")');
    expect(r.clientJs).toContain('log.push("B")');
  });

  test("if-block body: newline-separated assignment + calls compile clean, all calls preserved", () => {
    const r = compile(`\${
    function probeBlock() {
        let log = []
        let a = 0
        if (a == 0) {
            a = 1
            log.push("C")
            log.push("D")
        }
        return log.join(",")
    }
}
<div id="block">\${probeBlock()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toContain('log.push("C")');
    expect(r.clientJs).toContain('log.push("D")');
  });

  test("explicit `;`-separated same-line statements stay clean", () => {
    // A `;` is the sanctioned terminator — `a = 1; b = 2;` on one line is legal.
    const r = compile(`\${
    function f() {
        let a = 0
        let b = 0
        if (a == 0) { a = 1; b = 2; }
        return a + b
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });

  test("single call statement per line is unaffected", () => {
    const r = compile(`\${
    function f() {
        let log = []
        if (true) { log.push("only") }
        return log.join(",")
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toContain('log.push("only")');
  });

  test("member/call chains and expressions on one line are NOT mis-flagged", () => {
    // A single expression statement with member access, calls, ternary, and a
    // multi-line continuation must not trip the same-line boundary detector.
    const r = compile(`\${
    function f() {
        let xs = [1, 2, 3]
        let n = xs.filter(x => x > 1).map(x => x * 2).length
        let m = n > 0 ? xs[0] : xs[1]
        return n + m
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// §3 — WORD-FORM INFIX OPERATORS after a grouping `)` are CONTINUATIONS, not
// boundaries (S284 fix-round regression: `(a) or (b)` false-fired).
// `or`/`and` (§45.9, S136) lex as IDENT and only lower to `||`/`&&` in the
// expression-parser; a grouping `)` is a hard value terminal, so the detector
// mis-read `or (` as a call-start. Excluded by operator CLASS.
// -----------------------------------------------------------------------------
describe("§3 word-form infix operators (or/and) after a grouping ) stay clean", () => {
  const wrap = (bodyLine) => `\${
    function f() {
        let x = ${bodyLine}
        return x
    }
    function getA() { return 1 }
    function getB() { return 2 }
}
<div>\${f()}</div>
`;

  test("`(getA()) or (getB())` compiles clean and lowers to ||", () => {
    const r = compile(wrap("(getA()) or (getB())"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toMatch(/\|\|/);
  });

  test("`(getA()) and (getB())` compiles clean and lowers to &&", () => {
    const r = compile(wrap("(getA()) and (getB())"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toMatch(/&&/);
  });

  test("chained `(getA()) or (getB()) or (getA())` compiles clean (no double-fire)", () => {
    const r = compile(wrap("(getA()) or (getB()) or (getA())"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });

  test("`(5) or (6)` (grouped literals) compiles clean", () => {
    const r = compile(wrap("(5) or (6)"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });

  test("`(@a == 1) or (@a == 2)` bread-and-butter idiom compiles clean", () => {
    const r = compile(`<a> = 0
\${
    function f() {
        let x = (@a == 1) or (@a == 2)
        return x
    }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });

  test("bare `getA() or getB()` (no grouping) stays clean (was already safe)", () => {
    const r = compile(wrap("getA() or getB()"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
  });

  // GUARD: the operator exclusion must NOT reopen a real same-line boundary.
  // A grouping `)` followed by a genuine CALL (not a word operator) is still a
  // same-line multi-statement run and MUST still error.
  test("GUARD: `(getA()) foo()` — grouping then a real call still ERRORS", () => {
    const r = compile(`\${
    function f() {
        let log = []
        if (true) { (getA()) foo() }
        return log.join(",")
    }
    function getA() { return 1 }
    function foo() { return 2 }
}
<div>\${f()}</div>
`);
    expect(codesOf(r)).toContain("E-STMT-MISSING-SEMICOLON");
  });

  test("GUARD: `or`/`and` do not swallow a following newline statement", () => {
    // A newline-separated statement after an or-expression must remain its own
    // statement, not be absorbed by the operator-continuation exclusion.
    const r = compile(wrap("(getA()) or (getB())\n        let y = getA()"));
    expect(codesOf(r)).not.toContain("E-STMT-MISSING-SEMICOLON");
    expect(r.errors.length).toBe(0);
    expect(r.clientJs).toMatch(/let y = /);
  });
});
