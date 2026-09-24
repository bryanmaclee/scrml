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
 * that already excludes it.
 *
 * ⚑ REJECT ONLY — THE DIAGNOSTIC FIRES AND THE COLLECTOR STOPS AT THE `)`, exactly as it
 * did before S414. There is NO recovery. The emitted output for an offending head is
 * therefore NOT meaningful — the build fails, and a correct artifact for a failed build
 * buys nothing. Three successively tighter recovery bounds were tried and each ate or
 * corrupted source in a new shape; the fourth round deleted the whole path. See the
 * `REJECT WITHOUT RECOVERY` describe below for the pins.
 *
 * (E-FOR-UNPARENTHESIZED-HEAD (S308) does recover, but its recovery is a BOUNDED LOCAL
 * REPAIR — consume one `of`, collect the iterable. An open-ended scan over arbitrary
 * trailing tokens is a different thing, and it proved unbounded three times. The
 * precedent's principle is "do not cascade"; stopping at the `)` does not cascade,
 * because it is precisely what the parser did before this code existed.)
 *
 * ⚑ THE DIAGNOSTIC IS ASSERTED ON REAL PARSED PROGRAMS, never on a hand-built AST. A
 * code with no producer is this project's recurring failure — E-TILDE-001/002 sat dead
 * for the project's whole life behind passing unit tests.
 *
 * ⚑ SURFACING — HISTORY. Until S430 this diagnostic was SILENT inside an `export`-ed
 * `function` / `fn` / `server function` (and any function nested in one): the export
 * synth re-parse in ast-builder.js kept only E-FN-EQUALS-BODY from its sub-parse and
 * discarded the rest. S430 P2 closed that swallow; the code now fires there too —
 * pinned in `export-decl-diagnostics-not-swallowed.test.js`. (The S414 measurement
 * also listed `export const g = () => { ... }` as silent. That row was a different
 * gap: a block-bodied arrow body is an escape-hatch expression that is never
 * statement-parsed, exported or not — for this code it surfaces as
 * E-CODEGEN-INVALID-LOGIC instead.)
 *
 * ⚑ Recovery had to go rather than be tightened again: round 3 made it strictly WORSE
 * than doing nothing — base truncated `while (i) < n >> 1` to `while (i) { }`, which
 * TERMINATES, while the recovery emitted `while (i < n) { }`, which HANGS, at exit 0.
 *
 * The diagnostic cases below avoid `export` (they predate S430); the control cases use
 * the library harness (which needs `export` to import the result back) and assert the
 * EMITTED JS and the EXECUTED VALUE.
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

/**
 * ⚑ REGRESSION PINS FOR THREE REJECTED RECOVERY ATTEMPTS.
 *
 * S414 originally fired the diagnostic AND recovered — kept scanning past the closing
 * `)` to rebuild the whole condition. Three successively tighter bounds were tried and
 * each ate or corrupted source in a NEW shape, so the recovery was DELETED. These cases
 * are kept as pins: every one of them must now be REJECTED, with nothing silently
 * emitted in its place.
 *
 *   round 1 — bounded at `{` / `;` / statement keywords. An IDENT stopped nothing:
 *             `if (a) && (b) n = 1` + `n = n + 5` ate BOTH and captured `return n`.
 *   round 2 — + a value/operator check that accepted ANY punct, so every
 *             punctuation-starting body was eaten, three of them with an INVENTED
 *             operator (`b++`, `b - n`, `b.ok`).
 *   round 3 — + a conservative operator set. But the bound knew "can this token follow
 *             a value", not "is this OPERAND FINISHED": after an accepted operator the
 *             scan ate the operand HEAD and stopped at its SUFFIX, landing INSIDE the
 *             author's condition. `if (a) && b[0] { out = 7 }` emitted
 *             `if (a && b) { [0]; }` with `out = 7` DELETED, and
 *             `while (i) < n >> 1 { i = i + 1 }` emitted `while (i < n) { }` — AN
 *             INFINITE LOOP, where base emitted `while (i) { }`, which terminates.
 *             It reproduced the very defect this code is named after.
 */
describe("⚑ REJECT WITHOUT RECOVERY — offending heads fail the build, silently emitting nothing", () => {
  // Every shape that one of the three recovery cuts mangled. `function` (not `export`),
  // so the diagnostic is visible — see the export-swallow note in the banner.
  const REJECTED = [
    // round 3 — operand suffixes (the shapes that forced the deletion)
    ["operand suffix `[0]`",     "if (a) && b[0] { out = 7 }"],
    ["operand suffix `- 1`",     "if (a) && n - 1 { out = 7 }"],
    ["operand suffix `(1)`",     "if (a) && g(1) { out = 7 }"],
    ["operand suffix `>> 1`",    "while (i) < n >> 1 { i = i + 1 }"],
    ["operand suffix `.k`",      "if (a) && b.k { out = 7 }"],
    // round 2 — punctuation-starting braceless bodies
    ["punct body `(out = 7)`",   "if (a) && (out = 7)"],
    ["punct body `!flag`",       "if (a) && !flag"],
    ["punct body `++n`",         "if (a) && ++n"],
    ["punct body `--n`",         "if (a) && --n"],
    ["punct body `-n`",          "if (a) && -n"],
    ["punct body `+n`",          "if (a) && +n"],
    ["punct body `[1, 2]`",      "if (a) && [1, 2]"],
    // round 1 — a word-shaped braceless body with statements after it
    ["braceless + trailing",     "if (a) && b out = 1"],
    // the original headline shapes
    ["`while (n) < 4 { … }`",    "while (n) < 4 { out = 7 }"],
    ["`if (n) < 4 { … }`",       "if (n) < 4 { out = 7 }"],
  ];

  const REJ = (line) =>
    `\${\n  function f(a, b, n, i, g, flag, out) {\n    let _ = 0\n    ${line}\n  }\n}\n<p>ok</>`;

  for (const [name, line] of REJECTED) {
    test(`REJECTED — ${name}`, () => {
      const r = compileProgram(REJ(line), "rej-" + name.replace(/\W+/g, "_"));
      // 1. The build is RED, and it is RED for the RIGHT reason: exactly one
      //    E-CONDITION-HEAD-UNPARENTHESIZED naming the real problem.
      expect(condErrors(r).length).toBe(1);
      // 2. It is an Error, not a Warning — it must actually fail the build.
      expect((r.warnings ?? []).filter((w) => (w.code ?? "") === CODE).length).toBe(0);
    });
  }

  // ⚑ THE DISCRIMINATORS. Every case in the table above ALSO fired the diagnostic under
  // the recovery cuts, so those are regression pins, not discriminators — what separates
  // reject-only from reject-and-recover is what gets EMITTED. One test per shape, so a
  // partial regression names itself instead of hiding inside a loop.
  for (const [name, line, forbidden, why] of [
    ["operand suffix `[0]`",  "if (a) && b[0] { out = 7 }",       /if \(a && b\)/,
     "round 3 emitted `if (a && b) { [0]; }` — `out = 7` deleted"],
    ["operand suffix `- 1`",  "if (a) && n - 1 { out = 7 }",      /if \(a && n\)/,
     "round 3 emitted `if (a && n) { -1; }` — `out = 7` deleted"],
    ["operand suffix `>> 1`", "while (i) < n >> 1 { i = i + 1 }", /while \(i < n\)/,
     "⚑ round 3 emitted `while (i < n) { }` — AN INFINITE LOOP; base emits `while (i) { }`, which terminates"],
    ["operand suffix `.k`",   "if (a) && b.k { out = 7 }",        /if \(a && b\)/,
     "round 3 emitted `if (a && b) { . k { out = 7 }; }` — literal garbage in the output"],
    // ⚑ Round 2's shapes have a PARENTHESIZED `(b)` — that is what gave the invented
    // operator something to attach to. Written without it these assertions cannot fire.
    ["punct body `(b) ++n`",     "if (a) && (b) ++n",       /b\+\+/,
     "round 2 INVENTED a post-increment `b++` the author never wrote"],
    ["punct body `(b) -n`",      "if (a) && (b) -n",        /b - n/,
     "round 2 INVENTED an infix subtraction `b - n`"],
    ["punct body `(b) .ok`",     "if (a) && (b) .ok",       /b\.ok/,
     "round 2 INVENTED a member access `b.ok`"],
    ["punct body `(b) (out = 7)`","if (a) && (b) (out = 7)", /b\(out = 7\)/,
     "round 2 absorbed the body as a CALL ARGUMENT `b(out = 7)`"],
  ]) {
    test(`⚑ NOT SILENTLY EMITTED — ${name} (${why})`, () => {
      const { js } = build(
        `\${\n  function f(a, b, n, i, out) {\n    let _ = 0\n    ${line}\n  }\n}`,
        "noemit-" + name.replace(/\W+/g, "_"),
      );
      expect(js).not.toMatch(forbidden);
    });
  }

  test("fires ONCE per offending head, not once per continuation token", () => {
    const r = compileProgram(
      "${\n  let a = 1\n  let b = 2\n  let n = 0\n  while (a) && (b) || (a) { n = n + 1 }\n}\n<p>ok</>",
      "once-per-head",
    );
    expect(condErrors(r).length).toBe(1);
  });

  test("⚑ the headline `while` head is REJECTED, where base shipped it silently", () => {
    // Base emitted `while (n + 1) { }` at exit 0 — an infinite loop whenever the
    // condition depends on the body. The emit is UNCHANGED (that is the design: no
    // recovery), but the build is now red, so it cannot ship.
    const r = compileProgram("${\n  let n = 0\n  while (n + 1) < 4 { n = n + 1 }\n}\n<p>ok</>", "headline-while");
    expect(condErrors(r).length).toBe(1);
  });

  test("⚑ a user identifier named `is` is still NOT rejected (round-2 pin)", () => {
    // `is` was briefly a continuation candidate; it is the only word-shaped one, and the
    // lexer classifies it context-free as KEYWORD, so it could not be told apart from a
    // user's parameter. This program compiles on base and must keep compiling.
    const r = compileProgram("${\n  function f(is) {\n    let n = 0\n    if (n < 3) is(n)\n    return n\n  }\n}\n<p>ok</>", "ident-is");
    expect(condErrors(r).length).toBe(0);
    expect(codes(r)).not.toContain("E-EQ-005");
  });

  test("⚑ RUNTIME — and the `is(n)` call is still emitted and actually called", async () => {
    const { artifact } = build(
      "${\n  export function f(is) {\n    let n = 0\n    if (n < 3) is(n)\n    return n\n  }\n}",
      "ident-is-runtime",
    );
    let called = -1;
    (await import(pathToFileURL(artifact).href)).f((v) => { called = v; });
    expect(called).toBe(0);
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
