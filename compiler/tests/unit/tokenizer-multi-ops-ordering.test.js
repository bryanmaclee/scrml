/* SPDX-License-Identifier: MIT
 *
 * Unit — THE MULTI_OPS MAXIMAL-MUNCH INVARIANT (S417).
 *
 * WHAT THIS PINS
 * ==============
 * `tokenizer.ts` matches multi-character operators with a FIRST-MATCH-WINS loop:
 *
 *     // Multi-char operators (check longest first)
 *     for (const op of MULTI_OPS) {
 *       if (content.startsWith(op, pos)) { advance(op.length); ...; break; }
 *     }
 *
 * There is no length sort. The loop takes the FIRST member that matches, so maximal munch is
 * not a property of the ALGORITHM — it is a property of the ARRAY'S ORDER, maintained by hand.
 * The comment asserts that order ("check longest first"); nothing verified it.
 *
 * THE INVARIANT: for any two members A and B where B is longer and starts with A, A MUST NOT
 * appear before B. If it does, B is STRUCTURALLY UNREACHABLE — the lexer can never emit it.
 *
 * ⚑ THE INVARIANT IS CURRENTLY VIOLATED, EXACTLY ONCE, AND THAT VIOLATION IS A FILED BUG.
 * Measured on this file's own source: 35 members, 34 correctly ordered, and
 *
 *     ">>>" (index 32) is UNREACHABLE — ">>" (index 31) matches first
 *
 * so `n >>> 2` lexes as `>>` followed by a separate `>`, never as one `>>>` token. That is the
 * ROOT CAUSE of `g-unsigned-right-shift-does-not-lower` (LOW, open), which is filed against
 * `compiler/src/codegen` with its locus recorded as "the precise lowering site was NOT traced".
 * The codegen refusal (`E-CODEGEN-INVALID-LOGIC`) is the downstream SYMPTOM; the defect is here,
 * one line of array order away.
 *
 * ⛔ THIS FILE DOES NOT FIX IT, DELIBERATELY.
 * Reordering would make `n >>> 2` compile where it is refused today — **newly-accepting**, the
 * one-way door of `pa-base` §8. That is only a bug fix if a normative sentence already makes the
 * form legal. **Searched `compiler/SPEC.md` for `>>>` (ONE hit, §:3636, and it is a PROHIBITION
 * list of compound-assignment forms, not a grant), and for "shift operator" / "bitwise" /
 * "unsigned right" (ZERO hits) — no governing sentence found.** SPEC carries no shift-operator
 * grammar at all. By §8 that makes the fix *beyond the contract*: a RULING, not a patch. Recorded
 * here so the next session inherits the search instead of repeating it.
 *
 * WHY A PIN IS THE RIGHT ARTIFACT WHILE THE RULING IS OUTSTANDING
 * The bug is unfixable today, but the INVARIANT is still checkable, and the next ordering slip
 * would be silent in exactly the same way. This test makes the current violation machine-visible
 * and fails the moment the set drifts in either direction.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const TOKENIZER = join(dirname(fileURLToPath(import.meta.url)), "../../src/tokenizer.ts");

/**
 * Read MULTI_OPS out of the tokenizer source.
 *
 * ⚑ THIS IS A SOURCE READ, AND IT IS THE ONLY HONEST OPTION HERE, NOT A SHORTCUT.
 * `MULTI_OPS` is a function-local `const` — not exported, not reachable by import (the same wall
 * the S416 marker-parser harness hit with `scripts/boot.ts`). The alternative is to re-declare
 * the array in this file, which would test a REIMPLEMENTATION and stay green with the real array
 * mis-sorted — precisely the hollow-harness defect that blocked `g-marker-parsers-are-untested`.
 * Reading the real array is strictly stronger than copying it.
 *
 * The parse is anchored on the declaration and its terminator rather than on a loose match, and
 * `assertion 1` below fails loudly if it ever extracts nothing — so a broken read can never be
 * mistaken for a clean result (`pa-base` §8, the indistinguishable failure).
 */
function readMultiOps() {
  const lines = readFileSync(TOKENIZER, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => /const MULTI_OPS = \[/.test(l));
  if (start < 0) return [];
  let end = start;
  while (end < lines.length && !/\];/.test(lines[end])) end++;
  const body = lines.slice(start, end + 1).join("\n");
  return (body.match(/"(?:[^"\\]|\\.)*"/g) || []).map((s) => JSON.parse(s));
}

/** Members that can never be emitted, because a shorter prefix of them is matched first. */
function shadowedMembers(ops) {
  const out = [];
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      if (ops[j].length > ops[i].length && ops[j].startsWith(ops[i])) {
        out.push({ shorter: ops[i], longer: ops[j], shorterIndex: i, longerIndex: j });
      }
    }
  }
  return out;
}

/**
 * The ONE member currently shadowed, pinned by name.
 *
 * Equality (not containment) against the measured set is what makes this a drift detector:
 *   measured \ KNOWN -> a NEW operator went unreachable. Silent, and the lexer stops emitting it.
 *   KNOWN \ measured -> `>>>` became reachable, i.e. the ruling landed and the array was fixed.
 *                       Correct outcome; empty this list and delete the ⛔ block above.
 */
const KNOWN_SHADOWED = [">>>"];

describe("tokenizer MULTI_OPS — maximal munch is an ARRAY-ORDER invariant (S417)", () => {
  test("the MULTI_OPS array is readable and non-trivial (guards a silently-empty parse)", () => {
    const ops = readMultiOps();
    // Without this, a failed read yields [] -> zero shadowed members -> the invariant test below
    // passes vacuously and reports a clean tokenizer. An error must never render as the benign
    // answer.
    expect(ops.length).toBeGreaterThan(20);
    expect(ops).toContain(">>");
    expect(ops).toContain(">>>");
  });

  test("no member is unreachable EXCEPT the one known, filed violation", () => {
    const shadowed = shadowedMembers(readMultiOps()).map((s) => s.longer);
    expect([...shadowed].sort()).toEqual([...KNOWN_SHADOWED].sort());
  });

  test("the known violation is exactly `>>` shadowing `>>>`, adjacent in the array", () => {
    // Pins the SHAPE, not just the name — so a different operator pair producing the same
    // member name cannot slip through, and the entry above stays traceable to its cause.
    const shadowed = shadowedMembers(readMultiOps());
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].shorter).toBe(">>");
    expect(shadowed[0].longer).toBe(">>>");
    expect(shadowed[0].longerIndex).toBe(shadowed[0].shorterIndex + 1);
  });

  test("BEHAVIOURAL CONFIRMATION — every non-shadowed multi-char member is reachable by length", () => {
    // The structural check above is about array order. This is the property that order exists to
    // deliver: for each member, no EARLIER member is a strict prefix of it. Stated separately so
    // that if the matcher is ever changed to a real longest-match, this test keeps its meaning
    // while the order test becomes moot.
    const ops = readMultiOps();
    const unreachable = ops.filter((op, j) =>
      ops.slice(0, j).some((earlier) => earlier.length < op.length && op.startsWith(earlier)),
    );
    expect([...unreachable].sort()).toEqual([...KNOWN_SHADOWED].sort());
  });
});
