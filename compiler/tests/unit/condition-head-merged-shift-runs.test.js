/* SPDX-License-Identifier: MIT
 *
 * Unit — g-condition-head-continuation-set-misses-every-merged-shift-run-token (S416).
 *
 * ⚑ `E-CONDITION-HEAD-UNPARENTHESIZED` (#945, S415) REFUSES AN UNPARENTHESIZED CONDITION
 * HEAD BY MATCHING THE TOKEN AFTER THE CLOSING `)` AGAINST A 14-MEMBER SET. The match is
 * exact token-TEXT equality, and THE LEXER MERGES AN ANGLE RUN INTO ONE TOKEN, so the set's
 * four angle members (`<` `<=` `>` `>=`) never match `>>` `>>>` `<<` `>>=` `<<=`.
 *
 * Measured on `f98510f8`, library mode, NON-exported fn:
 *
 *     while (n + 1) <  2 { t = t + 1 }   E-CONDITION-HEAD-UNPARENTHESIZED   (build fails)
 *     while (n + 1) >> 2 { t = t + 1 }   exit 0, zero diagnostics, emitting
 *                                            while (n + 1) {
 *                                            }
 *                                        -> THE BODY IS DROPPED AND THE LOOP NEVER
 *                                           TERMINATES. The exact symptom #945 is named
 *                                           after, surviving its own fix.
 *
 * ⚑ THIRD INSTANCE OF THE LEXER-MERGE CLASS. Any check that compares a whole token's TEXT
 * to a single-character `>` or `<` misses every merged run. Prior two: the S310 parse fix
 * and the latent return-type consumer.
 *
 * ⛔ THIS FILE ALSO PINS THE NON-WIDENING. The set's banner says DELIBERATELY CONSERVATIVE
 * — DO NOT WIDEN — and every name it excludes is excluded for ONE reason: the token can
 * also BEGIN A BRACELESS BODY (`/` a regex literal, `+`/`-` a unary prefix, `.`/`(`/`[` a
 * statement start, `:` a label, `is` an identifier). The five spellings added here are
 * STRICTLY BINARY — none can begin a statement — so they do not touch that rationale. The
 * `must NOT fire` block below is the guard that this stays true: if a later cut widens the
 * set by category rather than by that test, these go red.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
let seq = 0;
function build(body) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "cond-head-shift-"));
  const slug = `p-${seq++}`;
  const file = join(TMP, `${slug}.scrml`);
  writeFileSync(file, "${\n  " + body + "\n}\n");
  const outDir = join(TMP, `${slug}.dist`);
  const r = compileScrml({
    inputFiles: [file], outputDir: outDir, mode: "library",
    write: true, verbose: false, log: () => {},
  });
  let js = "";
  try {
    for (const f of readdirSync(outDir)) if (f.endsWith(".js")) js += readFileSync(join(outDir, f), "utf8");
  } catch { /* no artifact */ }
  return { js, codes: (r.errors || []).map((e) => e.code) };
}

// The fn is NOT exported on purpose: the `export` re-parse swallows ast-builder parse-path
// diagnostics (`g-export-reparse-swallows-ast-builder-parse-path-diagnostics`, HIGH, open),
// which would mask BOTH the subject and its control. See the ⚑ note in the describe below.
const loop = (op) =>
  `fn probe(n: int) -> int { let t = 0; while (n + 1) ${op} 2 { t = t + 1 } return t }\n` +
  `export fn go(n: int) -> int { return probe(n) }`;
const branch = (op) =>
  `fn probe(n: int) -> int { if (n + 1) ${op} 2 { return 1 } return 0 }\n` +
  `export fn go(n: int) -> int { return probe(n) }`;

const MERGED_SHIFT_RUNS = [">>", ">>>", "<<", ">>=", "<<="];
const ALREADY_IN_SET = ["<", "<=", ">", ">=", "=="];

describe("§50.2.3 — a MERGED SHIFT RUN after the head's `)` is refused (S416)", () => {
  for (const op of MERGED_SHIFT_RUNS) {
    test(`while (n + 1) ${op} 2 — fires E-CONDITION-HEAD-UNPARENTHESIZED`, () => {
      expect(build(loop(op)).codes).toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
    });
    test(`if (n + 1) ${op} 2 — fires E-CONDITION-HEAD-UNPARENTHESIZED`, () => {
      expect(build(branch(op)).codes).toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
    });
  }
});

describe("§50.2.3 — the SINGLE-CHAR controls keep firing (no regression)", () => {
  for (const op of ALREADY_IN_SET) {
    test(`while (n + 1) ${op} 2 — still fires`, () => {
      expect(build(loop(op)).codes).toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
    });
  }
});

describe("§50.2.3 — a PARENTHESISED head compiles and keeps its body (no false rejection)", () => {
  // The INFIX spellings, in an ordinary binary position.
  for (const op of [">>", "<<", ...ALREADY_IN_SET]) {
    test(`while (n + 1 ${op} 2) — clean, body retained`, () => {
      const r = build(
        `fn probe(n: int) -> int { let t = 0; while (n + 1 ${op} 2) { t = t + 1 } return t }
` +
        `export fn go(n: int) -> int { return probe(n) }`,
      );
      expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
      expect(r.js).toContain("t = t + 1");
    });
  }
  // `>>=` / `<<=` are compound ASSIGNMENTS — `n + 1 >>= 2` is not an assignable target,
  // so the well-formed parenthesised probe has to assign to the bare name.
  for (const op of [">>=", "<<="]) {
    test(`while (n ${op} 2) — clean, body retained`, () => {
      const r = build(
        `fn probe(n: int) -> int { let t = 0; while (n ${op} 2) { t = t + 1 } return t }
` +
        `export fn go(n: int) -> int { return probe(n) }`,
      );
      expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
      expect(r.js).toContain("t = t + 1");
    });
  }
});

describe("⚠ CHARACTERIZATION — `>>>` does not lower AT ALL, and that is a separate defect", () => {
  /* Found while building this file. `>>>` fails in ORDINARY expression position, with no
   * condition head involved, while the sibling `>>` is fine:
   *
   *     let x = n >> 2     ->  exit 0, emits `let x = n >> 2;`
   *     let x = n >>> 2    ->  E-CODEGEN-INVALID-LOGIC ("Unexpected to…") on the artifact
   *
   * It fails LOUDLY — the emit gate refuses invalid JS — so nothing silent ships, and it
   * is PRE-EXISTING and independent of this change. Filed as
   * `g-unsigned-right-shift-does-not-lower`. Pinned here so a later fix to `>>>` turns
   * these red and whoever lands it updates them deliberately.
   */
  test("`let x = n >>> 2` — refused at the emit gate, NOT a condition-head diagnostic", () => {
    const r = build(
      `fn probe(n: int) -> int { let x = n >>> 2 return x }
` +
      `export fn go(n: int) -> int { return probe(n) }`,
    );
    expect(r.codes).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
  });
  test("`let x = n >> 2` — the sibling control lowers cleanly", () => {
    const r = build(
      `fn probe(n: int) -> int { let x = n >> 2 return x }
` +
      `export fn go(n: int) -> int { return probe(n) }`,
    );
    expect(r.codes).toEqual([]);
    expect(r.js).toContain("n >> 2");
  });
});

describe("⛔ the banner's deliberate EXCLUSIONS must NOT fire — these begin a braceless body", () => {
  // `/` is load-bearing: a braceless body starting with a REGEX LITERAL. Pinned separately
  // by while-braceless-body-stays-in-the-loop.test.js; re-asserted here because widening
  // the set by category rather than by "can this begin a statement" would break it.
  test("`/` — braceless body starting with a regex literal", () => {
    const r = build(
      `fn probe(h: string) -> bool { while (h) /a\sb/.test(h) { return true } return false }\n` +
      `export fn go(h: string) -> bool { return probe(h) }`,
    );
    expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
  });
  test("`-` — unary prefix can begin a braceless body", () => {
    const r = build(
      `fn probe(n: int) -> int { let t = 0; while (n) -t { t = t + 1 } return t }\n` +
      `export fn go(n: int) -> int { return probe(n) }`,
    );
    expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
  });
  test("`(` — a parenthesised statement can begin a braceless body", () => {
    const r = build(
      `fn probe(n: int) -> int { let t = 0; while (n) (t = 7) { t = t + 1 } return t }\n` +
      `export fn go(n: int) -> int { return probe(n) }`,
    );
    expect(r.codes).not.toContain("E-CONDITION-HEAD-UNPARENTHESIZED");
  });
});
