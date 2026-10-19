// acceptance.test.js — s469: the bootstrap's human-written ACCEPTANCE cases
// (compiler/self-host-v2/acceptance/**), graded by the bootstrap conformance
// probe itself (`scripts/bootstrap-conformance.ts --cases <dir>`), in the
// conformance-case layout (case.scrml + expected.json). Each expected.json is the
// TARGET behaviour; STATUS below pins today's verdict, so a lane that moves one
// (a blocker landing, or a regression) shows up here as a diff to update.
//
// These are not language-corpus cases (conformance/cases/**): dpa-073 F2 is not
// in the SPEC yet (§18.2 still forbids arm commas) and impl#1 does not read arm
// commas (dpa-073 F5 step 1 is owed), so a corpus case would have no carried gap
// to xfail impl#1 against. They move into the corpus when the SPEC lands F2.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const CASES = join(REPO, "compiler", "self-host-v2", "acceptance");

// relDir → [bucket, the exact distinct codes emitted]
const STATUS = {
  "arms/comma-guard": ["PASS", []],
  "arms/comma-match": ["PASS", []],
  "arms/mixed-neg": ["PASS", ["E-MATCH-ARM-SEPARATOR"]],
  "arms/newline-still-read": ["PASS", []],
  "opener/union-maybe": ["PASS", []],
  // a general union needs a union type in the bootstrap's type system
  "opener/union-multi-unsupported": ["UNSUPPORTED", ["E-BOOTSTRAP-UNSUPPORTED"]],
  // program (a) (s469: blockers 4 and 5 landed — `toEnum` and the plain-value `match`):
  // compiles and runs. Its `not` arm shows a constant (see guess/a-guess-verbatim).
  "guess/a-guess": ["PASS", []],
  "guess/a-guess-no": ["PASS", []],
  "guess/a-guess-other": ["PASS", []],
  // the report's text verbatim: `"length " + @inputVal.length` is string + int, which the
  // S440 operator rule refuses — correctly; the explicit conversion it needs is the next wall
  "guess/a-guess-verbatim": ["PASS", ["E-OPERATOR-OPERAND-TYPE"]],
  // s469 — the §18 plain-value match unit, toEnum, §45 `==`, and the security lens
  "match/enum-value": ["PASS", []],
  "match/eq-maybe-struct": ["PASS", []],
  "match/literal": ["PASS", []],
  "match/literal-no-else": ["PASS", ["W-MATCH-002"]],
  "match/neg-duplicate-arm": ["PASS", ["E-TYPE-023"]],
  "match/neg-literal-over-enum": ["PASS", ["E-TYPE-028"]],
  "match/neg-maybe-no-not": ["PASS", ["E-MATCH-012"]],
  "match/neg-missing-variant": ["PASS", ["E-TYPE-020"]],
  "match/neg-shorthand-arm": ["PASS", ["E-MATCH-ARM-SHORTHAND-AMBIGUOUS"]],
  "match/neg-struct-subject": ["PASS", ["E-TYPE-024"]],
  "match/neg-tape-subject": ["PASS", ["E-BOOTSTRAP-UNSUPPORTED"]],
  "match/not-arm": ["PASS", []],
  "match/payload-bind": ["PASS", []],
  "security/login-enum": ["PASS", []],
  "security/login-literal": ["PASS", []],
  "security/login-literal-no-else": ["PASS", ["W-MATCH-002"]],
  "security/login-maybe": ["PASS", []],
  // #1471 review HIGH-1: a `-> T | not` finder that falls off the end is refused; with `return not` the deny arm runs
  "security/falloff-value": ["PASS", ["E-TYPE-043"]],
  "security/falloff-stmt": ["PASS", ["E-TYPE-043"]],
  "security/falloff-string": ["PASS", ["E-TYPE-043"]],
  "security/falloff-enum": ["PASS", ["E-TYPE-043"]],
  "security/return-not-value": ["PASS", []],
  "security/return-not-stmt": ["PASS", []],
  "security/return-not-string": ["PASS", []],
  "security/return-not-enum": ["PASS", []],
  // #1471 delta review: the rest of the fall-off class, and `== not`
  "security/falloff-failable": ["PASS", ["E-RETURN-INCOMPLETE"]],
  "security/falloff-unannotated": ["PASS", ["E-RETURN-INCOMPLETE"]],
  // #1471 round 2 (bryan: "Always explicit"): bare returns, and no-value results read as values
  "security/bare-return-failable": ["PASS", ["E-RETURN-INCOMPLETE"]],
  "security/bare-return-maybe": ["PASS", ["E-TYPE-043"]],
  "security/novalue-guard": ["PASS", ["E-TYPE-001"]],
  "security/novalue-ok": ["PASS", ["E-TYPE-001"]],
  "security/novalue-plain": ["PASS", ["E-TYPE-001"]],
  // #1471 round 3: `void` is a type — a wrapper's `return <void call>`
  "security/wrap-failable": ["PASS", ["E-TYPE-001"]],
  "security/wrap-typed": ["PASS", ["E-TYPE-001"]],
  "security/wrap-unannotated": ["PASS", ["E-TYPE-001"]],
  "security/wrap-void": ["PASS", ["E-TYPE-001"]],
  "security/eq-not": ["PASS", ["E-EQ-002"]],
  "security/bare-return": ["PASS", ["E-TYPE-043"]],
  "security/failable-fails": ["PASS", []],
  "toenum/neg-arg-type": ["PASS", ["E-TYPE-031"]],
  "toenum/prototype-keys": ["PASS", []],
};

let verdicts;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "s469-acceptance-"));
  try {
    const out = join(dir, "acceptance.json");
    const p = Bun.spawnSync(["bun", join(REPO, "scripts", "bootstrap-conformance.ts"), "--cases", CASES, "--json", out], { cwd: REPO });
    if (p.exitCode !== 0) throw new Error("bootstrap-conformance exited " + p.exitCode + "\n" + p.stderr.toString());
    const j = JSON.parse(readFileSync(out, "utf8"));
    verdicts = Object.fromEntries(j.verdicts.map((v) => [v.relDir, v]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 180000 });

describe("bootstrap acceptance cases — today's verdicts", () => {
  test("the case set is exactly the STATUS set", () => {
    expect(Object.keys(verdicts).sort()).toEqual(Object.keys(STATUS).sort());
  });
  for (const [rel, [bucket, emitted]] of Object.entries(STATUS)) {
    test(`${rel} — ${bucket}`, () => {
      const v = verdicts[rel];
      expect({ bucket: v.bucket, emitted: v.emitted }).toEqual({ bucket, emitted });
      if (bucket === "PASS" && v.reason.includes("runtime")) expect(v.runtimeExecuted).toBe(true);
    });
  }
  test("the runtime halves executed where the case has one", () => {
    for (const rel of ["arms/comma-guard", "arms/comma-match", "arms/newline-still-read", "opener/union-maybe"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
  test("program (a) compiles and RUNS on the bootstrap — the first human-written program to (s469)", () => {
    for (const rel of ["guess/a-guess", "guess/a-guess-no", "guess/a-guess-other"]) {
      expect([rel, verdicts[rel].bucket, verdicts[rel].emitted, verdicts[rel].runtimeExecuted]).toEqual([rel, "PASS", [], true]);
    }
  });
  test("the security cases ran their runtime half (the deny arm was taken, not merely compiled)", () => {
    for (const rel of ["security/login-enum", "security/login-literal", "security/login-literal-no-else", "security/login-maybe", "toenum/prototype-keys",
                       "security/return-not-value", "security/return-not-stmt", "security/return-not-string", "security/return-not-enum",
                       "security/failable-fails"]) {
      expect([rel, verdicts[rel].runtimeExecuted]).toEqual([rel, true]);
    }
  });
});
