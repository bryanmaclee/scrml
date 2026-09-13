/* SPDX-License-Identifier: MIT
 *
 * Unit — g-loop-branch-head-truncated-at-first-close-paren (S414).
 * E-CONDITION-HEAD-UNPARENTHESIZED (§34, §49.2.3, §50.2.3).
 *
 * ⚑ AN `if`/`while` HEAD THAT CONTINUED PAST ITS CLOSING `)` SILENTLY LOST THE REST OF
 * THE CONDITION — AND, BECAUSE THE REST INCLUDED THE `{`, THE WHOLE BODY. At exit 0,
 * with zero diagnostics:
 *
 *     while (n + 1) < 4 { n = n + 1 }     emitted     while (n + 1) {
 *                                                     }        ← infinite loop
 *     if (n + 1) < 4 { n = 0 }            emitted     if (n + 1) {
 *                                                     }        ← body dropped
 *     while (a) && (b) { n = n + 1 }      emitted     (no artifact; E-CODEGEN-INVALID-LOGIC)
 *
 * ONE DEFECT, TWO ARRIVAL DATES. `parseOneIfStmt` has used `collectIfCondition()` all
 * along and shows the identical truncation on both sides of #933; the three `while`
 * sites inherited it when #933 switched them there from `collectExpr("{")`. Fixing the
 * one collector closes `if` AND all three `while` sites — which is why the `if` case
 * below is not optional: it is the proof the fix is at the root, not at a position.
 *
 * ⚑ THE DIRECTION IS REJECT, NOT ACCEPT. SPEC §50.2.1 makes the condition's parens part
 * of the grammar and §50.2.3 says verbatim of `while ((x = expr))` that "the outer
 * parens are the while condition's required parens". `while (n + 1) < 4` is therefore
 * not a legal head; the legal spellings are `while (n + 1 < 4)` and `while ((n + 1) < 4)`.
 * Making it work would be a newly-accepting one-way door against a normative sentence
 * that already excludes it. So this mirrors E-FOR-UNPARENTHESIZED-HEAD (S308): fire an
 * Error AND RECOVER, so no broken loop is emitted and downstream analysis does not cascade.
 *
 * ⚑ THE DIAGNOSTIC IS ASSERTED ON REAL PARSED PROGRAMS, never on a hand-built AST. A
 * code with no producer is this project's recurring failure — E-TILDE-001/002 sat dead
 * for the project's whole life behind passing unit tests.
 *
 * ⚑ SURFACING (pre-existing, NOT introduced here): a bare `${ ... }` file with no
 * `<program>` shell drops ast-builder logic-body errors from `result.errors` — the
 * shipped E-FOR-UNPARENTHESIZED-HEAD behaves identically there. The diagnostic cases
 * below therefore use the `<program>` shell, exactly as the S308 test does; the
 * RECOVERY and artifact cases use the library harness so the emitted JS can be read
 * back and executed.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

const CODE = "E-CONDITION-HEAD-UNPARENTHESIZED";

let TMP;
function tmp() {
  TMP = TMP || mkdtempSync(join(tmpdir(), "cond-head-"));
  return TMP;
}

/** Library harness — emits to disk so the FULL artifact can be read back and imported. */
function build(source, name) {
  const file = join(tmp(), `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(tmp(), `${name}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode: "library",
    write: true, verbose: false, log: () => {},
  });
  let js = "", artifact = null;
  try {
    for (const f of readdirSync(outDir)) {
      if (f.endsWith(".js")) { js += readFileSync(join(outDir, f), "utf8"); artifact = join(outDir, f); }
    }
  } catch { /* no artifact */ }
  return { js, artifact, errors: r.errors || [] };
}

/** `<program>`-shell harness — the shape in which ast-builder errors reach result.errors. */
const W = (body) => `<program>\n\${\n  <items> = [1, 2, 3]\n}\n${body}\n</program>\n`;
function compileProgram(body, name) {
  const file = join(tmp(), `prog-${name}.scrml`);
  writeFileSync(file, W(body));
  const r = compileScrml({
    inputFiles: [file], outputDir: join(tmp(), `prog-${name}.out`),
    write: false, verbose: false, log: () => {},
  });
  return r;
}
const codes = (r) => (r.errors ?? []).map((e) => e.code ?? "");
const condErrors = (r) => (r.errors ?? []).filter((e) => (e.code ?? "") === CODE);
function programJs(r) {
  let js = "";
  if (r.outputs && typeof r.outputs.forEach === "function") {
    r.outputs.forEach((v) => { js += (v?.clientJs ?? "") + "\n" + (v?.serverJs ?? "") + "\n" + (v?.libraryJs ?? ""); });
  }
  return js;
}

/**
 * The body must be INSIDE the braces. Asserted structurally on the emitted source
 * rather than by filtering lines — `while (...) {\n}` with the body after it is the
 * exact shape a line filter cannot distinguish from a nested body (S412's bad probe).
 */
const loopBodyIsEmpty = (js) => /while\s*\([^)]*\)\s*\{\s*\}/.test(js);

describe("E-CONDITION-HEAD-UNPARENTHESIZED — fires on a head that continues past `)`", () => {
  test("⚑ BITE — `while (n + 1) < 4 { … }` fires it on a real parsed program", () => {
    const r = compileProgram("${\n  let n = 0\n  while (n + 1) < 4 { n = n + 1 }\n}\n<p>ok</>", "while-lt");
    expect(condErrors(r).length).toBe(1);
    // Partition: a §34 Error lands in result.errors, never result.warnings.
    expect((r.warnings ?? []).filter((w) => (w.code ?? "") === CODE).length).toBe(0);
  });

  test("⚑ THE `if` HALF — `if (n + 1) < 4 { … }` fires it too (proof the fix is at the root)", () => {
    // `if` has used `collectIfCondition` all along; if only the `while` sites were
    // patched this would still silently drop its body.
    const r = compileProgram("${\n  let n = 9\n  if (n + 1) < 4 { n = 0 }\n}\n<p>ok</>", "if-lt");
    expect(condErrors(r).length).toBe(1);
  });

  test("`while (a) && (b) { … }` fires it — and NO LONGER E-CODEGEN-INVALID-LOGIC", () => {
    const r = compileProgram(
      "${\n  let a = 1\n  let b = 2\n  let n = 0\n  while (a) && (b) { n = n + 1 }\n}\n<p>ok</>",
      "while-andand",
    );
    expect(condErrors(r).length).toBe(1);
    expect(codes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("fires ONCE per offending head, not once per continuation token", () => {
    const r = compileProgram(
      "${\n  let a = 1\n  let b = 2\n  let n = 0\n  while (a) && (b) || (a) { n = n + 1 }\n}\n<p>ok</>",
      "once-per-head",
    );
    expect(condErrors(r).length).toBe(1);
  });
});

describe("RECOVERY — the artifact is CORRECT even though the build errors", () => {
  test("⚑ the recovered `while` keeps its body and its full condition (program shell)", () => {
    const r = compileProgram("${\n  let n = 0\n  while (n + 1) < 4 { n = n + 1 }\n}\n<p>ok</>", "recover-prog");
    expect(condErrors(r).length).toBe(1);
    const js = programJs(r);
    // The whole condition survived — not truncated to `while (n + 1)`.
    expect(js).toMatch(/while \(n \+ 1 < 4\)/);
    expect(loopBodyIsEmpty(js)).toBe(false);
  });

  test("⚑ RUNTIME — the recovered loop actually terminates with the right value", async () => {
    // Before the fix this emitted `while (n + 1) {}` — an infinite loop. Written so the
    // defect returning fails by TIMEOUT rather than by assertion.
    const { js, artifact } = build(
      "${\n  export function f() {\n    let n = 0\n    while (n + 1) < 4 { n = n + 1 }\n    return n\n  }\n}",
      "recover-runtime",
    );
    expect(loopBodyIsEmpty(js)).toBe(false);
    expect(js).toMatch(/while \(n \+ 1 < 4\) \{\s*\n\s*n = n \+ 1;/);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("the recovered `if` keeps its body and its full condition", async () => {
    const { js, artifact } = build(
      "${\n  export function f() {\n    let n = 9\n    if (n + 1) < 4 { n = 0 }\n    return n\n  }\n}",
      "recover-if",
    );
    expect(js).toMatch(/if \(n \+ 1 < 4\) \{\s*\n\s*n = 0;/);
    // 9 + 1 is not < 4, so the (now non-empty) branch must NOT be taken.
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(9);
  });

  test("the recovered `&&` head emits a real loop instead of no artifact at all", async () => {
    const { js, artifact } = build(
      "${\n  export function f(b) {\n    let a = 3\n    let n = 0\n    while (a) && (b) { a = a - 1\n      n = n + 1 }\n    return n\n  }\n}",
      "recover-andand",
    );
    expect(js).toMatch(/while \(a && b\)/);
    expect(loopBodyIsEmpty(js)).toBe(false);
    expect((await import(pathToFileURL(artifact).href)).f(true)).toBe(3);
  });
});

describe("CONTROLS — every legal spelling stays clean and byte-unchanged", () => {
  // Each control is checked TWICE: no new code in the `<program>` shell (where the code
  // would surface), and the library artifact still compiles and RUNS correctly.
  const CONTROLS = [
    ["inner-parens", "${\n  let n = 0\n  while (n + 1 < 4) { n = n + 1 }\n}\n<p>ok</>"],
    ["double-parens", "${\n  let n = 0\n  while ((n + 1) < 4) { n = n + 1 }\n}\n<p>ok</>"],
    ["unparenthesized-head", "${\n  let n = 0\n  while n + 1 < 4 { n = n + 1 }\n}\n<p>ok</>"],
    ["if-inner-parens", "${\n  let n = 9\n  if (n + 1 < 4) { n = 0 }\n}\n<p>ok</>"],
    ["braceless-body", "${\n  let n = 0\n  while (n < 3) n = n + 1\n}\n<p>ok</>"],
    ["regex-braceless-body", "${\n  let h = false\n  let c = \"ab\"\n  while (h) /a\\sb/.test(c)\n}\n<p>ok</>"],
    ["else-if-chain", "${\n  let n = 1\n  if (n < 0) { n = 0 } else if (n > 5) { n = 5 }\n}\n<p>ok</>"],
  ];
  for (const [name, body] of CONTROLS) {
    test(`CONTROL — \`${name}\` does not fire ${CODE}`, () => {
      expect(condErrors(compileProgram(body, `ctl-${name}`)).length).toBe(0);
    });
  }

  test("CONTROL — `while (n + 1 < 4)` compiles clean and runs", async () => {
    const { artifact, errors } = build(
      "${\n  export function f() {\n    let n = 0\n    while (n + 1 < 4) { n = n + 1 }\n    return n\n  }\n}",
      "ctl-inner",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — `while ((n + 1) < 4)` compiles clean and runs", async () => {
    const { artifact, errors } = build(
      "${\n  export function f() {\n    let n = 0\n    while ((n + 1) < 4) { n = n + 1 }\n    return n\n  }\n}",
      "ctl-double",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — the UNPARENTHESIZED `while cond { … }` form is untouched", async () => {
    // Falls back to `collectExpr("{")` before the new check is ever reached.
    const { artifact, errors } = build(
      "${\n  export function f() {\n    let n = 0\n    while n + 1 < 4 { n = n + 1 }\n    return n\n  }\n}",
      "ctl-unparen",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — `if (n + 1 < 4)` compiles clean and runs", async () => {
    const { artifact, errors } = build(
      "${\n  export function f() {\n    let n = 9\n    if (n + 1 < 4) { n = 0 }\n    return n\n  }\n}",
      "ctl-if",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(9);
  });

  test("⚑ CONTROL — the §50.2.3 DOUBLE-PARENS assignment form must NOT fire", async () => {
    // `while ((x = expr))` — the inner parens are the assignment expression, the outer
    // parens are the condition's required parens. SPEC §50.2.3 blesses this spelling
    // explicitly, so a head collector that got clever here would reject valid scrml.
    const r = compileProgram("${\n  let x = 3\n  let c = 0\n  while ((x = x - 1)) { c = c + 1 }\n}\n<p>ok</>", "ctl-assign");
    expect(condErrors(r).length).toBe(0);
    const { artifact, errors } = build(
      "${\n  export function f() {\n    let x = 3\n    let c = 0\n    while ((x = x - 1)) { c = c + 1 }\n    return c\n  }\n}",
      "ctl-assign-lib",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    // x: 3 → 2 (truthy, c=1) → 1 (truthy, c=2) → 0 (falsy, stop).
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(2);
  });

  test("CONTROL — a braceless `while` body (#933) still lands inside the loop", async () => {
    const { js, artifact, errors } = build(
      "${\n  export function f() {\n    let n = 0\n    while (n < 3) n = n + 1\n    return n\n  }\n}",
      "ctl-braceless",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(loopBodyIsEmpty(js)).toBe(false);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("⚑ CONTROL — a braceless body that STARTS WITH A REGEX LITERAL", () => {
    // THE control that catches a widened operator set. `/` is deliberately NOT in the
    // continuation set: here the `/` after `(h)` opens a REGEX, not a division. If `/`
    // were treated as a binary operator the regex would be swallowed into the condition
    // and `\s` would reach acorn as `Expecting Unicode escape sequence \uXXXX`.
    const { js, errors } = build(
      "${\n  export function f(c) {\n    let h = false\n    while (h) /a\\sb/.test(c)\n    return h\n  }\n}",
      "ctl-regex",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toContain("/a\\sb/");
    expect(loopBodyIsEmpty(js)).toBe(false);
  });

  test("⚑ CONTROL — `+` / `-` / `.` after `)` keep TODAY'S behaviour (excluded on purpose)", () => {
    // Each is also a legal statement start (unary prefix / member access), so treating
    // it as a condition continuation could steal a braceless body. Excluded by design —
    // these compile exactly as they did before this change.
    for (const [name, src] of [
      ["minus", "${\n  export function f() {\n    let n = 0\n    while (n < 3) n = n + 1\n    return -n\n  }\n}"],
      ["plus", "${\n  export function f() {\n    let n = 0\n    if (n < 3) n = n + 1\n    return +n\n  }\n}"],
    ]) {
      const { errors } = build(src, `ctl-excluded-${name}`);
      expect(errors.map((e) => e.code)).toEqual([]);
    }
  });
});
