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
  // program (a): the opener union and the comma arms parse (blockers 2, 3). It stops at
  // blocker 4 (`Guess.toEnum(…)`) and blocker 5 (the §18 plain-value `match`: its `not :>`
  // arm pattern — E-PARSE-ARM — and a `match` over a non-failable value in an interpolation).
  "guess/a-guess": ["UNSUPPORTED", ["E-BOOTSTRAP-UNSUPPORTED", "E-PARSE-ARM"]],
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
  test("program (a) no longer stops at the opener union (E-PARSE-TAG) or the arm commas; it stops at toEnum and the plain-value match", () => {
    const v = verdicts["guess/a-guess"];
    expect(v.emitted).not.toContain("E-PARSE-TAG");
    expect(v.emitted).not.toContain("E-MATCH-ARM-SEPARATOR");
    const f = v.failures.join("\n");
    expect(f).toContain("only calls of a named function"); // `Guess.toEnum(@inputVal)` — blocker 4
    expect(f).toContain("it arrives with the §18 `match` unit"); // the value `match` — blocker 5
  });
});
