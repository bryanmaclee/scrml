/* SPDX-License-Identifier: MIT
 *
 * Unit — g-while-braceless-body-hoisted-out-of-the-loop (S412).
 *
 * ⚑ A BRACELESS `while` BODY WAS EMITTED OUTSIDE THE LOOP, LEAVING THE LOOP EMPTY.
 * At exit 0, with zero diagnostics:
 *
 *     while (n < 3) n = n + 1        emitted     while (n < 3) {
 *                                                }
 *                                                n = n + 1;
 *
 * Whenever the condition depends on the body — which is the ordinary case — that is an
 * INFINITE LOOP. `if` and `for` were never affected: `parseOneIfStmt` has always had a
 * braceless limb (`parseOneStatement()`), and all three `while` sites had only
 * `if (peek().text === "{")` and collected their head with `collectExpr("{")`, which,
 * finding no `{`, vacuumed the body into the CONDITION.
 *
 * ⚑ LIVE IN THE SHIPPED STANDARD LIBRARY. `stdlib/auth/jwt.scrml`'s `base64urlDecode`
 * pads with `while (s.length % 4) s += "="`, which emitted as an empty loop with the
 * `s += "="` dropped — so JWT base64url decoding hangs for any input whose length is
 * not a multiple of 4. Twelve more sites across `compiler/self-host/`
 * (bs.scrml ×9, pa.scrml ×2, bpp.scrml ×1).
 *
 * ⚑ THIS DEFECT WAS MISSED ONCE BY A BAD PROBE, AND THAT IS WHY THE RUNTIME CASES
 * BELOW EXIST. An earlier S412 check "verified" braceless == braced by grepping the
 * emitted JS for lines matching /while|count/ and comparing the matches. That filter
 * DROPPED THE `}` LINES, so a hoisted-out body printed identically to a nested one and
 * the reading was withdrawn as a false alarm. A line filter cannot see nesting. These
 * tests assert the RETURNED VALUE of an executed loop instead.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

let TMP;
function build(source, name) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "while-braceless-"));
  const file = join(TMP, `${name}.scrml`);
  writeFileSync(file, source.endsWith("\n") ? source : source + "\n");
  const outDir = join(TMP, `${name}.dist`);
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

/**
 * The loop body must be INSIDE the braces. Asserted structurally on the emitted
 * source rather than by filtering lines — `while (...) {\n}` with the body after it is
 * the exact shape the old probe could not distinguish.
 */
function bodyIsInsideLoop(js) {
  return !/while\s*\([^)]*\)\s*\{\s*\}/.test(js);
}

describe("a braceless `while` body stays inside the loop (S412)", () => {
  test("⚑ RUNTIME — a braceless counting loop terminates with the right value", async () => {
    // Before the fix this emitted an empty loop and HUNG. The test is written to fail
    // by timeout rather than by assertion if the defect ever returns.
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    while (n < 3) n = n + 1\n    return n\n  }\n}`,
      "runtime-count",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.f()).toBe(3);
  });

  test("the emitted loop body is not empty", () => {
    const { js } = build(
      `\${\n  export function f() {\n    let n = 0\n    while (n < 3) n = n + 1\n    return n\n  }\n}`,
      "structural",
    );
    expect(bodyIsInsideLoop(js)).toBe(true);
    expect(js).toMatch(/while \(n < 3\) \{\s*\n\s*n = n \+ 1;/);
  });

  test("the shipped `stdlib/auth/jwt` padding shape keeps its body", () => {
    // `while (s.length % 4) s += "="` — base64url padding. An empty loop here hangs
    // for any input whose length is not a multiple of 4.
    const { js } = build(
      `\${\n  export function f(str) {\n    let s = str\n    while (s.length % 4) s += "="\n    return s\n  }\n}`,
      "jwt-padding",
    );
    expect(bodyIsInsideLoop(js)).toBe(true);
    expect(js).toMatch(/while \(s\.length % 4\) \{\s*\n\s*s \+= "=";/);
  });

  test("⚑ RUNTIME — the jwt padding shape actually pads", async () => {
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let s = "abc"\n    while (s.length % 4) s += "="\n    return s\n  }\n}`,
      "jwt-runtime",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    const mod = await import(pathToFileURL(artifact).href);
    expect(mod.f()).toBe("abc=");
  });

  test("a braceless `while` whose body is a regex statement compiles and keeps the regex", () => {
    // The narrower symptom this was originally filed as: the head collector over-ran a
    // `/…/` because there was no `{` to stop at.
    const { js, errors } = build(
      `\${\n  export function f(c) {\n    let h = false\n    while (h) /a\\sb/.test(c)\n    return h\n  }\n}`,
      "regex-body",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(js).toContain("/a\\sb/");
  });

  // --- CONTROLS: every form that already worked must keep working ----------------
  test("CONTROL — a BRACED while body is unchanged", async () => {
    const { js, artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    while (n < 3) { n = n + 1 }\n    return n\n  }\n}`,
      "braced-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect(bodyIsInsideLoop(js)).toBe(true);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — a braced MULTI-statement body keeps every statement", async () => {
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    let m = 0\n    while (n < 3) { n = n + 1\n      m = m + 2 }\n    return n * 10 + m\n  }\n}`,
      "multi-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(36);
  });

  test("CONTROL — the UNPARENTHESIZED `while cond { … }` form still compiles", async () => {
    // `collectIfCondition` falls back to `collectExpr("{")` when the head is not
    // parenthesised, so this spelling must be untouched by the head-collector change.
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    while n < 3 { n = n + 1 }\n    return n\n  }\n}`,
      "unparen-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — a LABELLED braceless while (the third parse site)", async () => {
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    outer: while (n < 3) n = n + 1\n    return n\n  }\n}`,
      "labelled-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(3);
  });

  test("CONTROL — `if` and `for` braceless bodies were never affected", async () => {
    const { artifact, errors } = build(
      `\${\n  export function f() {\n    let n = 0\n    if (n < 3) n = n + 1\n    for (let i = 0; i < 2; i = i + 1) n = n + 10\n    return n\n  }\n}`,
      "if-for-control",
    );
    expect(errors.map((e) => e.code)).toEqual([]);
    expect((await import(pathToFileURL(artifact).href)).f()).toBe(21);
  });
});
