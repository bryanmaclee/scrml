/**
 * §33.6 — Transition-body purity (S32 Phase 4g)
 *
 * Per §33.6: `fn` and `pure function` enforce the identical purity contract
 * (`fn` is the canonical pure form; `pure function` is its deprecated synonym).
 * Transition bodies are pure-function-
 * equivalent: `from` + params → returned next-state literal, no I/O, no
 * non-determinism, no outer-scope mutation.
 *
 * Phase 4g applies the existing `checkFnBodyProhibitions` walker to every
 * transition-decl body. The same E-FN-001..E-FN-005 error codes surface.
 *
 * Covered cases:
 *   - E-FN-004: non-deterministic call (Date.now, Math.random, new Date, ...)
 *   - E-FN-001: fn body performs outer-scope mutation — can't easily test
 *               without shared refs; skipped here.
 *   - Pure body (only local let + return) is silent.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runTS } from "../../src/type-system.js";

function compile(src) {
  const bs = splitBlocks("/test/app.scrml", src);
  const { ast } = buildAST(bs);
  const res = runTS({ files: [ast] });
  return res;
}

function hasCode(errors, code, substring) {
  return errors.some(e => e.code === code && (!substring || String(e.message).includes(substring)));
}

describe("§33.6: transition body purity — checkFnBodyProhibitions applied", () => {
  test("Date.now() in transition body fires E-FN-004", () => {
    const { errors } = compile(
      `< Submission id(string)>\n` +
      `    < Draft body(string)>\n` +
      `        validate() => < Validated> { let t = Date.now() }\n` +
      `    </>\n` +
      `    < Validated body(string)></>\n` +
      `</>`
    );
    expect(hasCode(errors, "E-FN-004", "Date.now")).toBe(true);
  });

  test("Math.random() in transition body fires E-FN-004", () => {
    const { errors } = compile(
      `< Submission id(string)>\n` +
      `    < Draft body(string)>\n` +
      `        validate() => < Validated> { let r = Math.random() }\n` +
      `    </>\n` +
      `    < Validated body(string)></>\n` +
      `</>`
    );
    expect(hasCode(errors, "E-FN-004", "Math.random")).toBe(true);
  });

  test("new Date() in transition body fires E-FN-004", () => {
    const { errors } = compile(
      `< Submission id(string)>\n` +
      `    < Draft body(string)>\n` +
      `        validate() => < Validated> { let d = new Date() }\n` +
      `    </>\n` +
      `    < Validated body(string)></>\n` +
      `</>`
    );
    expect(hasCode(errors, "E-FN-004", "new Date")).toBe(true);
  });

  test("pure body — only local bindings — is silent", () => {
    const { errors } = compile(
      `< Submission id(string)>\n` +
      `    < Draft body(string)>\n` +
      `        validate(now: Date) => < Validated> { let t = now }\n` +
      `    </>\n` +
      `    < Validated body(string)></>\n` +
      `</>`
    );
    // No E-FN-* errors from the transition body (might have E-MU-001 for
    // unused `t` — that's a different concern).
    const fnErrs = errors.filter(e => /^E-FN-\d/.test(e.code));
    expect(fnErrs).toHaveLength(0);
  });

  test("transition body using `from` reference is silent", () => {
    const { errors } = compile(
      `< Submission id(string)>\n` +
      `    < Draft body(string)>\n` +
      `        validate() => < Validated> { let b = from.body }\n` +
      `    </>\n` +
      `    < Validated body(string)></>\n` +
      `</>`
    );
    const fnErrs = errors.filter(e => /^E-FN-\d/.test(e.code));
    expect(fnErrs).toHaveLength(0);
  });

  test("purity check does NOT fire on non-transition code", () => {
    // Regression guard: the 4g hook MUST be scoped to transition bodies.
    // A regular `function` using Date.now() should not suddenly error
    // E-FN-004 (pre-existing behavior — E-FN-* is fn-only).
    const { errors } = compile(
      `<program>\n` +
      `\${\n` +
      `  function normal() { let t = Date.now() }\n` +
      `}\n` +
      `</program>`
    );
    expect(hasCode(errors, "E-FN-004")).toBe(false);
  });
});
