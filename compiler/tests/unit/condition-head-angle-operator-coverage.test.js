/* SPDX-License-Identifier: MIT
 *
 * Unit — THE ANGLE-OPERATOR COVERAGE PIN for `E-CONDITION-HEAD-UNPARENTHESIZED` (S417).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT MORE CASES IN THE SIBLING SUITE
 * ======================================================================
 * `condition-head-merged-shift-runs.test.js` (S416) pins that FIVE named spellings fire. This
 * file pins something different and strictly stronger: that the fired set and the ESCAPED set
 * TOGETHER account for EVERY angle-bearing operator the language has. The sibling proves the
 * members it lists work. This proves nothing is MISSING from that list.
 *
 * That distinction is the whole point, because a missing member is exactly how this class has
 * been rediscovered FOUR separate times:
 *
 *   1. S310 — a parse fix over merged angle runs.
 *   2. a latent return-type consumer.
 *   3. S415 — `CONDITION_HEAD_CONTINUATION_PUNCT` missed every merged shift run, and the
 *      result was a SILENT INFINITE LOOP: `while (n + 1) >> 2 { ... }` compiled at exit 0
 *      with the body dropped.
 *   4. S417 — #956 fixed (3) by adding five spellings, declared the class closed in its own
 *      banner, and left `>>>=` behind. Same silent infinite loop, same diagnostic, one
 *      spelling later.
 *
 * ⚑ THE ROOT CAUSE OF THE RECURRENCE IS THE DERIVATION, NOT ANY ONE OMISSION.
 * `CONDITION_HEAD_CONTINUATION_PUNCT` (`ast-builder.js`) is HAND-ENUMERATED FROM REPORTED
 * SYMPTOMS. The tokenizer already holds the truth — `MULTI_OPS` (`tokenizer.ts`) is the list
 * of every spelling it merges into ONE token, and it lists `">>>=", "<<=", ">>="` ADJACENT ON
 * ONE LINE. #956 took two of those three and left the first. Nothing compared the two lists,
 * so nothing could have noticed.
 *
 * This file is that comparison, expressed BEHAVIOURALLY.
 *
 * ⚑ WHY BEHAVIOURAL AND NOT AN IMPORT. Neither list is importable — `MULTI_OPS` and
 * `CONDITION_HEAD_CONTINUATION_PUNCT` are both function-local `const`s, exactly the wall the
 * S416 marker-parser harness hit with `scripts/boot.ts`. Re-declaring either here would test a
 * REIMPLEMENTATION and pass with the real fix reverted, which is the specific defect that
 * blocked `g-marker-parsers-are-untested` for sessions. So every assertion below runs the real
 * compiler over real source and reads the real diagnostic stream.
 *
 * ⛔ THIS FILE PROPOSES NO WIDENING, AND MUST NOT BE READ AS ARGUING FOR ONE.
 * `compiler/SPEC.md` §34 states, normatively, "THE CONTINUATION SET IS DELIBERATELY
 * CONSERVATIVE — DO NOT WIDEN IT", and enumerates fourteen members; the live set already has
 * nineteen. Reconciling that contradiction is a LANGUAGE RULING (it rides #945, still
 * outstanding), not a test's call. Until it lands, `>>>=` stays OUT and is pinned here as a
 * KNOWN ESCAPE — recorded, machine-visible, and impossible to lose again.
 *
 * WHAT MAKES THIS A DRIFT DETECTOR RATHER THAN A SNAPSHOT
 * The final assertion compares the measured escape set against `KNOWN_ESCAPES` by EQUALITY,
 * not containment. So it goes red in BOTH directions:
 *   - a NEW angle operator that escapes  -> a fifth instance of the class, caught immediately;
 *   - `>>>=` starting to fire            -> the ruling landed and this pin must be updated.
 * A one-directional assertion would have stayed green through #956's omission.
 */
import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CODE = "E-CONDITION-HEAD-UNPARENTHESIZED";

let TMP;
let seq = 0;

/**
 * Compile one library-mode fragment and return its diagnostic CODES.
 *
 * The probe fn is deliberately NOT exported: the `export` re-parse swallows ast-builder
 * parse-path diagnostics (`g-export-reparse-swallows-ast-builder-parse-path-diagnostics`,
 * HIGH, open), which would mask the subject AND its control and make an escape look like a
 * pass. The sibling suite carries the same note for the same reason.
 */
function codesFor(body) {
  TMP = TMP || mkdtempSync(join(tmpdir(), "cond-head-angle-"));
  const slug = `p-${seq++}`;
  const file = join(TMP, `${slug}.scrml`);
  writeFileSync(file, "${\n  " + body + "\n}\n");
  const r = compileScrml({
    inputFiles: [file],
    outputDir: join(TMP, `${slug}.dist`),
    mode: "library",
    write: false,
    verbose: false,
    log: () => {},
  });
  return (r.errors || []).map((e) => e.code);
}

/** UNPARENTHESIZED head — the condition continues past the closing `)`. MUST be refused. */
const subject = (op) =>
  `fn probe(n: int) -> int { let t = 0; while (n + 1) ${op} 2 { t = t + 1 } return t }\n` +
  `export fn go(n: int) -> int { return probe(n) }`;

/** PARENTHESIZED head — the same operator, legally inside the condition. Must NOT be refused. */
const control = (op) =>
  `fn probe(n: int) -> int { let t = 0; while ((n + 1) ${op} 2) { t = t + 1 } return t }\n` +
  `export fn go(n: int) -> int { return probe(n) }`;

/**
 * EVERY angle-bearing operator spelling in the language. This set is CLOSED, which is what
 * makes the coverage assertion meaningful: scrml's expression grammar is JS-shaped, and JS has
 * no angle-bearing operator outside these ten. Relational: `<` `<=` `>` `>=`. Shift:
 * `<<` `>>` `>>>`. Shift-assign: `<<=` `>>=` `>>>=`. (`=>` and `->` are not operators in a
 * condition-continuation sense — they are structural separators — and `:>` is a match-arm
 * separator, so none can follow a condition head as a binary continuation.)
 */
const ANGLE_OPERATORS = ["<", "<=", ">", ">=", "<<", ">>", ">>>", "<<=", ">>=", ">>>="];

/**
 * Angle operators that are MEASURED to escape the diagnostic on current main.
 *
 * `>>>=` is in `tokenizer.ts` MULTI_OPS (merged into one token) but absent from
 * `CONDITION_HEAD_CONTINUATION_PUNCT`, so `while (n + 1) >>>= 2 { t = t + 1 }` compiles at
 * exit 0 with ZERO diagnostics and emits `while (n + 1) { }` — the body dropped, the loop
 * non-terminating. Measured corpus population: 0 of 2,553 tracked `.scrml` files, so closing
 * it migrates nothing. It is NOT closed here because doing so is the exact act SPEC §34
 * forbids; see the ⛔ block at the top.
 */
const KNOWN_ESCAPES = [">>>="];

describe("§50.2.3 — angle-operator COVERAGE of E-CONDITION-HEAD-UNPARENTHESIZED (S417)", () => {
  // ---- the bidirectional fence, per operator ------------------------------------------------
  // Each operator gets BOTH directions. A one-sided pin cannot tell "the diagnostic fires
  // correctly" from "the diagnostic fires on everything" — the false-rejection failure mode the
  // set's own banner is built to avoid.
  for (const op of ANGLE_OPERATORS) {
    const expected = KNOWN_ESCAPES.includes(op);

    test(`UNPARENTHESIZED  while (n + 1) ${op} 2  ${expected ? "ESCAPES (known, pinned)" : "is REFUSED"}`, () => {
      const codes = codesFor(subject(op));
      if (expected) expect(codes).not.toContain(CODE);
      else expect(codes).toContain(CODE);
    });

    test(`PARENTHESIZED    while ((n + 1) ${op} 2)  is ACCEPTED by this diagnostic`, () => {
      // Asserts the ABSENCE of this specific code, not a clean build: `>>>` legitimately fails
      // to lower (`E-CODEGEN-INVALID-LOGIC`, filed LOW as g-unsigned-right-shift-does-not-lower)
      // and that is a different axis. Keying on the one code isolates the condition-head
      // question from the lowering question.
      expect(codesFor(control(op))).not.toContain(CODE);
    });
  }

  // ---- the coverage assertion — this is the part that detects the NEXT instance -------------
  test("the measured escape set EQUALS the pinned one — no angle operator is unaccounted for", () => {
    const measured = ANGLE_OPERATORS.filter((op) => !codesFor(subject(op)).includes(CODE));

    // Equality, deliberately, and in BOTH directions:
    //   measured \ KNOWN  -> a NEW escape. That is a fifth instance of the lexer-merge class,
    //                        and it means a merged angle run is dropping a loop body silently.
    //   KNOWN \ measured  -> `>>>=` now fires, i.e. the §34 ruling landed and the set was
    //                        widened. Correct outcome; update KNOWN_ESCAPES to [] and delete
    //                        the ⛔ block above.
    expect([...measured].sort()).toEqual([...KNOWN_ESCAPES].sort());
  });

  // ---- the tokenizer-vs-consumer derivation gap, stated as a test ---------------------------
  test("every KNOWN escape is a REAL merged operator, not a typo in this file", () => {
    // Guards the pin against its own worst failure: a misspelled entry in KNOWN_ESCAPES would
    // silently "escape" (because it is not a real operator, so it produces some other error
    // entirely) and the coverage assertion above would still pass. The control proves each
    // escaped spelling is genuinely an operator the language parses in a legal position.
    for (const op of KNOWN_ESCAPES) {
      expect(ANGLE_OPERATORS).toContain(op);
      expect(codesFor(control(op))).not.toContain(CODE);
    }
  });
});
