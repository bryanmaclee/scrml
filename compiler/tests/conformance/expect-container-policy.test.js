/**
 * expect-container-policy.test.js — the `expect`-vocabulary container policy (S365).
 *
 * WHY THIS EXISTS. A malformed CONTAINER in a case's `expect` block silently disabled the assertion
 * it held. Measured across 883-case runs before the fix:
 *
 *   severity: {} / null / []        -> all PASS   (falsy, or zero keys and the loop never runs)
 *   notCodePrefixes: [] / null / "" -> all PASS   (`?? []` swallowed null; "" iterated to nothing)
 *   codes: null                     -> PASS       (`ex.codes ?? []` laundered it into a no-op)
 *   notCodePrefixes: {}             -> the WHOLE 883-case run died, `TypeError: {} is not iterable`
 *
 * Both directions of the same defect: a bad container could turn one case green, or take down every
 * other case in the corpus from inside one file.
 *
 * THE POLICY, decided once for the whole vocabulary rather than per key:
 *   - an ABSENT key is free (every key is optional-and-additive);
 *   - an empty ARRAY is a legal NO-OP, identical to omitting the key — 466 `codes: []`,
 *     404 `notCodes: []` and 31 `input: []` cases in the live corpus depend on it;
 *   - a non-conforming container ({}, null, "", a number, a boolean) is a HARD ERROR;
 *   - an empty RECORD is a hard error wherever the record IS the assertion (severity, codeCounts,
 *     state, firstPaint) — `serverStub`/`serverDb` are the single stated exception, being a mock and
 *     a seed rather than assertions;
 *   - a violation fails ONE CASE with a diagnostic and NEVER throws.
 *
 * Two levels are exercised: `validateExpectContainers` directly (the policy), and real `runCase`
 * calls over synthetic LoadedCases (the wiring — a policy that the runner never consults is not a
 * policy). The corpus-wide "883/883 still pass" half lives in corpus-bridge.test.js.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCases, runCase, validateExpectContainers } from "../../../conformance/run.ts";

/** A minimal LoadedCase carrying the given expect block. Source compiles cleanly and emits nothing. */
function caseWith(expectBlock, source = '<title>="t"\n') {
  return {
    dir: "/synthetic",
    relDir: "synthetic/container-policy",
    source,
    expected: {
      id: "synthetic-container-policy",
      description: "S365 container policy fixture",
      "language-version": "0.2.0",
      expect: expectBlock,
    },
    auxFiles: {},
  };
}

/** Every key in the vocabulary, with a container that is malformed under any reading. */
const ARRAY_KEYS = ["codes", "notCodes", "notCodePrefixes", "input", "domAnchored"];
const RECORD_ASSERTION_KEYS = ["severity", "codeCounts", "state", "firstPaint"];
const RECORD_MOCK_KEYS = ["serverStub", "serverDb"];
const STRING_KEYS = ["dom", "stdout"];

const MALFORMED_CONTAINERS = [
  ["an empty object", {}],
  ["null", null],
  ["an empty string", ""],
  ["a number", 3],
  ["a boolean", true],
];

describe("expect container policy §1 — the omitted-key control stays free", () => {
  test("no keys at all → no shape errors", () => {
    expect(validateExpectContainers({})).toEqual([]);
  });

  test("every key omitted individually is indistinguishable from the empty contract", () => {
    // The control that makes the rest meaningful: the policy must only ever fire on a key that is
    // PRESENT. If absence tripped it, the whole corpus would be red and the measurement worthless.
    expect(validateExpectContainers({ codes: [], notCodes: [] })).toEqual([]);
  });
});

describe("expect container policy §2 — an empty ARRAY is a legal no-op", () => {
  for (const key of ARRAY_KEYS) {
    test(`${key}: [] is accepted`, () => {
      expect(validateExpectContainers({ [key]: [] })).toEqual([]);
    });
  }

  test("notCodePrefixes: [] reads as 'no families forbidden' and passes a real runCase", () => {
    const r = runCase(caseWith({ codes: [], notCodes: [], notCodePrefixes: [] }));
    expect(r.shapeErrors).toEqual([]);
    expect(r.pass).toBe(true);
  });
});

describe("expect container policy §3 — a malformed container on an ARRAY key is a hard error", () => {
  for (const key of ARRAY_KEYS) {
    for (const [label, container] of MALFORMED_CONTAINERS) {
      test(`${key}: ${label} → hard error naming the key`, () => {
        const errs = validateExpectContainers({ [key]: container });
        expect(errs.length).toBeGreaterThan(0);
        expect(errs[0]).toContain(`expect.${key}`);
        expect(errs[0]).toContain("not an array");
      });
    }
  }
});

describe("expect container policy §4 — a malformed container on a RECORD key is a hard error", () => {
  for (const key of [...RECORD_ASSERTION_KEYS, ...RECORD_MOCK_KEYS]) {
    for (const [label, container] of MALFORMED_CONTAINERS.filter(([l]) => l !== "an empty object")) {
      test(`${key}: ${label} → hard error naming the key`, () => {
        const errs = validateExpectContainers({ [key]: container });
        expect(errs.length).toBeGreaterThan(0);
        expect(errs[0]).toContain(`expect.${key}`);
      });
    }
    test(`${key}: [] → hard error (an array is not a record)`, () => {
      const errs = validateExpectContainers({ [key]: [] });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0]).toContain("not an object");
    });
  }
});

describe("expect container policy §5 — an empty RECORD asserts nothing", () => {
  for (const key of RECORD_ASSERTION_KEYS) {
    test(`${key}: {} → hard error ("present but EMPTY")`, () => {
      const errs = validateExpectContainers({ [key]: {} });
      expect(errs.length).toBe(1);
      expect(errs[0]).toContain(`expect.${key} is present but EMPTY`);
    });
  }

  for (const key of RECORD_MOCK_KEYS) {
    test(`${key}: {} is ALLOWED — a mock/seed, not an assertion (the single stated exception)`, () => {
      expect(validateExpectContainers({ [key]: {} })).toEqual([]);
    });
  }

  test("severity: {} gets no special reading — there is no empty severity assertion", () => {
    const r = runCase(caseWith({ codes: [], notCodes: [], severity: {} }));
    expect(r.pass).toBe(false);
    expect(r.shapeErrors.join(" ")).toContain("expect.severity is present but EMPTY");
  });
});

describe("expect container policy §6 — the run SURVIVES the case that used to kill it", () => {
  test("notCodePrefixes: {} fails ONE case with a diagnostic and does not throw", () => {
    // The pre-fix behaviour was `TypeError: {} is not iterable` escaping runCase and aborting all
    // 883 cases. The contract now is: this call RETURNS.
    let r;
    expect(() => {
      r = runCase(caseWith({ codes: [], notCodes: [], notCodePrefixes: {} }));
    }).not.toThrow();
    expect(r.pass).toBe(false);
    expect(r.shapeErrors.length).toBe(1);
    expect(r.shapeErrors[0]).toContain("expect.notCodePrefixes");
    expect(r.shapeErrors[0]).toContain("not an array");
  });

  test("a malformed case does not poison the NEXT case", () => {
    runCase(caseWith({ codes: [], notCodes: [], notCodePrefixes: {} }));
    const good = runCase(caseWith({ codes: [], notCodes: [] }));
    expect(good.pass).toBe(true);
    expect(good.shapeErrors).toEqual([]);
  });

  test("codes: null is no longer laundered into a passing no-op", () => {
    // `ex.codes ?? []` used to coerce this to [] in loadCases; runCase now sees the null.
    const r = runCase(caseWith({ codes: null, notCodes: [] }));
    expect(r.pass).toBe(false);
    expect(r.shapeErrors[0]).toContain("expect.codes");
  });
});

describe("expect container policy §7 — element and value contracts inside a well-formed container", () => {
  test("a non-string element in a string array is named by index", () => {
    const errs = validateExpectContainers({ codes: ["E-OK", 7] });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("expect.codes[1]");
  });

  test("a non-object element in an object array is named by index", () => {
    const errs = validateExpectContainers({ input: [{ type: "click" }, "nope"] });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("expect.input[1]");
  });

  test("a severity value outside the §34 partition is named", () => {
    const errs = validateExpectContainers({ severity: { "E-X-001": "fatal" } });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain(`expect.severity['E-X-001']`);
  });

  test("the three legal severity values are accepted", () => {
    expect(
      validateExpectContainers({ severity: { a: "error", b: "warning", c: "info" } }),
    ).toEqual([]);
  });

  test("sqlEngine outside its enum is named; both legal values pass", () => {
    expect(validateExpectContainers({ sqlEngine: "postgres" }).length).toBe(1);
    expect(validateExpectContainers({ sqlEngine: "stub" })).toEqual([]);
    expect(validateExpectContainers({ sqlEngine: "real" })).toEqual([]);
  });

  test("ssr must be a boolean; dom/stdout must be strings ('' is a legal assertion)", () => {
    expect(validateExpectContainers({ ssr: "true" }).length).toBe(1);
    expect(validateExpectContainers({ ssr: false })).toEqual([]);
    expect(validateExpectContainers({ dom: 5 }).length).toBe(1);
    expect(validateExpectContainers({ dom: "" })).toEqual([]);
    expect(validateExpectContainers({ stdout: "" })).toEqual([]);
  });
});

describe("expect container policy §8 — an unrecognised key asserts nothing, so it is refused", () => {
  test("a singular typo of a real key is caught, not silently ignored", () => {
    const errs = validateExpectContainers({ notCodePrefix: ["E-FORMFOR-"] });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("expect.notCodePrefix is not a recognised assertion key");
    expect(errs[0]).toContain("notCodePrefixes"); // the diagnostic lists the real vocabulary
  });

  test("expect itself must be an object", () => {
    expect(validateExpectContainers([]).length).toBe(1);
    expect(validateExpectContainers(null).length).toBe(1);
    expect(validateExpectContainers("codes").length).toBe(1);
  });
});

describe("expect container policy §10 — the loadCases path, where `codes: null` was laundered", () => {
  const dirs = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** Materialise a real case dir on disk and load it exactly as the corpus runner would. */
  function loadFromDisk(expectBlock) {
    const root = mkdtempSync(join(tmpdir(), "expect-policy-s365-"));
    dirs.push(root);
    const caseDir = join(root, "synthetic-case");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(join(caseDir, "case.scrml"), '<title>="t"\n');
    writeFileSync(
      join(caseDir, "expected.json"),
      JSON.stringify({
        id: "synthetic-loadcases",
        description: "S365 loadCases fixture",
        "language-version": "0.2.0",
        expect: expectBlock,
      }),
    );
    const cases = loadCases(root);
    expect(cases.length).toBe(1); // fixture guard: the dir really was discovered
    return cases[0];
  }

  test("an ABSENT codes key still defaults to [] (the documented optional case)", () => {
    const c = loadFromDisk({ notCodes: [] });
    expect(c.expected.expect.codes).toEqual([]);
    const r = runCase(c);
    expect(r.shapeErrors).toEqual([]);
    expect(r.pass).toBe(true);
  });

  test("a PRESENT `codes: null` survives loading and fails the case", () => {
    const c = loadFromDisk({ codes: null, notCodes: [] });
    expect(c.expected.expect.codes).toBeNull(); // NOT coerced to [] any more
    const r = runCase(c);
    expect(r.pass).toBe(false);
    expect(r.shapeErrors[0]).toContain("expect.codes");
  });

  test("a PRESENT `notCodes: {}` survives loading and fails the case", () => {
    const c = loadFromDisk({ codes: [], notCodes: {} });
    const r = runCase(c);
    expect(r.pass).toBe(false);
    expect(r.shapeErrors[0]).toContain("expect.notCodes");
  });
});

describe("expect container policy §9 — a legitimate assertion still FAILS on a wrong value", () => {
  // The policy must not have made the harness permissive: a well-formed contract asserting the
  // wrong thing has to stay red, or the whole exercise traded one hollowness for another.
  const BAD_SOURCE = '<title>="t"\n<x>=\n';

  test("a required code that does not fire is still missing", () => {
    const r = runCase(caseWith({ codes: ["E-DEFINITELY-NOT-EMITTED-001"], notCodes: [] }));
    expect(r.shapeErrors).toEqual([]);
    expect(r.missing).toEqual(["E-DEFINITELY-NOT-EMITTED-001"]);
    expect(r.pass).toBe(false);
  });

  test("a non-empty notCodePrefixes still catches a real family violation", () => {
    // Compile something that DOES emit, then forbid its whole family by prefix.
    const emitting = runCase(caseWith({ codes: [], notCodes: [] }, BAD_SOURCE));
    const family = emitting.emitted[0]?.slice(0, 4);
    expect(typeof family).toBe("string"); // fixture guard: the bad source must emit something
    const r = runCase(caseWith({ codes: [], notCodes: [], notCodePrefixes: [family] }, BAD_SOURCE));
    expect(r.shapeErrors).toEqual([]);
    expect(r.prefixViolations.length).toBeGreaterThan(0);
    expect(r.pass).toBe(false);
  });

  test("a well-formed codeCounts with a wrong cardinality still fails", () => {
    const emitting = runCase(caseWith({ codes: [], notCodes: [] }, BAD_SOURCE));
    const code = emitting.emitted[0];
    expect(typeof code).toBe("string"); // fixture guard
    const r = runCase(caseWith({ codes: [], notCodes: [], codeCounts: { [code]: 99 } }, BAD_SOURCE));
    expect(r.shapeErrors).toEqual([]);
    expect(r.countMismatches.length).toBe(1);
    expect(r.pass).toBe(false);
  });

  test("a well-formed codeCounts with a non-integer VALUE is still a value error, not a shape error", () => {
    const r = runCase(caseWith({ codes: [], notCodes: [], codeCounts: { "E-X-001": "two" } }));
    expect(r.shapeErrors).toEqual([]); // the CONTAINER is fine
    expect(r.countMismatches.length).toBe(1);
    expect(r.countMismatches[0]).toContain("not a non-negative integer");
  });
});
