// bootstrap-conformance-counter.test.js — the probe's own tests (change-id s449-bootstrap-conformance-counter).
//
// scripts/bootstrap-conformance.ts runs every conformance case through the PURE bootstrap and
// buckets it. These tests pin the bucketing on a tiny fixture corpus with KNOWN outcomes (one per
// bucket, a runtime-executed PASS and a runtime-half FAIL among them), and BITE: a passing fixture
// with one expected code changed must turn FAIL.

import { describe, test, expect, beforeAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyCase,
  codeLiterals,
  isVacuousPass,
  legacyMarkers,
  loadBootstrapModules,
  renderReport,
  runBootstrapConformance,
} from "../../../../scripts/bootstrap-conformance.ts";
import { loadCases } from "../../../../conformance/run.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const FIXTURES = join(import.meta.dir, "fixtures");
const SCRIPT = join(REPO, "scripts", "bootstrap-conformance.ts");

let boot;
beforeAll(async () => {
  boot = await loadBootstrapModules();
}, { timeout: 180000 });

const KNOWN = {
  "codes/pass-codes": ["PASS", false],
  "codes/vacuous": ["PASS", true],
  "runtime/pass-runtime": ["PASS", false],
  "runtime/fail-runtime": ["FAIL", false],
  "runtime/codes-only": ["CODES-ONLY", true],
  "refused/unsupported": ["UNSUPPORTED", false],
  "refused/legacy": ["LEGACY", false],
  "refused/invalid": ["INVALID", false],
};

describe("fixture corpus — each case lands in its known bucket", () => {
  test("the fixture set is exactly the known set", () => {
    expect(loadCases(FIXTURES).map((c) => c.relDir).sort()).toEqual(Object.keys(KNOWN).sort());
  });
  for (const [rel, [bucket, vacuous]] of Object.entries(KNOWN)) {
    test(`${rel} → ${bucket}${vacuous ? " (vacuous)" : ""}`, async () => {
      const c = loadCases(FIXTURES).find((x) => x.relDir === rel);
      const v = await classifyCase(boot, c);
      expect(v.bucket).toBe(bucket);
      expect(v.vacuous).toBe(vacuous);
    }, { timeout: 60000 });
  }

  test("the runtime half really EXECUTES on the bootstrap (PASS observes 2 clicks; FAIL names the state diff)", async () => {
    const cs = loadCases(FIXTURES);
    const pass = await classifyCase(boot, cs.find((x) => x.relDir === "runtime/pass-runtime"));
    expect(pass.runtimeExecuted).toBe(true);
    const fail = await classifyCase(boot, cs.find((x) => x.relDir === "runtime/fail-runtime"));
    expect(fail.runtimeExecuted).toBe(true);
    expect(fail.failures).toEqual(["state: cell 'count' expected 2, got 1"]);
  }, { timeout: 60000 });

  test("UNSUPPORTED names the refusal; LEGACY names the marker", async () => {
    const cs = loadCases(FIXTURES);
    const u = await classifyCase(boot, cs.find((x) => x.relDir === "refused/unsupported"));
    expect(u.reason).toBe("bootstrap-unsupported");
    expect(u.failures.join(" ")).toContain("#{");
    const l = await classifyCase(boot, cs.find((x) => x.relDir === "refused/legacy"));
    expect(l.legacyMarkers).toEqual(["rhs-decl", "no-program-root"]);
  }, { timeout: 60000 });
});

describe("BITE — a wrong expected code turns a PASS into a FAIL", () => {
  test("pass-codes with its expected code misspelled → FAIL (missing), and the check is reported unimplemented", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bootconf-bite-"));
    try {
      cpSync(join(FIXTURES, "codes", "pass-codes"), join(dir, "bite", "pass-codes"), { recursive: true });
      const p = join(dir, "bite", "pass-codes", "expected.json");
      const j = JSON.parse(readFileSync(p, "utf8"));
      j.expect.codes = ["E-VALUE-WRITES-STATEX"];
      writeFileSync(p, JSON.stringify(j));
      const [c] = loadCases(dir);
      const v = await classifyCase(boot, c);
      expect(v.bucket).toBe("FAIL");
      expect(v.failures).toEqual(["missing E-VALUE-WRITES-STATEX"]);
      expect(v.unimplementedCodes).toEqual(["E-VALUE-WRITES-STATEX"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, { timeout: 60000 });

  test("a forbidden code that DOES fire → FAIL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bootconf-bite-"));
    try {
      cpSync(join(FIXTURES, "codes", "pass-codes"), join(dir, "bite", "pass-codes"), { recursive: true });
      const p = join(dir, "bite", "pass-codes", "expected.json");
      const j = JSON.parse(readFileSync(p, "utf8"));
      j.expect = { codes: [], notCodes: ["E-VALUE-WRITES-STATE"] };
      writeFileSync(p, JSON.stringify(j));
      const [c] = loadCases(dir);
      const v = await classifyCase(boot, c);
      expect(v.bucket).toBe("FAIL");
      expect(v.failures).toEqual(["forbidden E-VALUE-WRITES-STATE fired"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, { timeout: 60000 });
});

describe("the report states its own scope", () => {
  test("N of M attempted, every bucket row, the FAIL list", async () => {
    const all = loadCases(FIXTURES);
    const some = all.filter((c) => c.relDir.startsWith("runtime/"));
    const r = await runBootstrapConformance(boot, some, all.length, "runtime/");
    const md = renderReport(r);
    expect(md).toContain(`**3 of ${all.length} cases attempted** (filter: \`runtime/\`)`);
    for (const b of ["PASS", "CODES-ONLY", "FAIL", "LEGACY", "UNSUPPORTED", "CRASH", "INVALID"]) expect(md).toContain(`| ${b} |`);
    expect(md).toContain("- `runtime/fail-runtime` (runtime)");
  }, { timeout: 60000 });
});

describe("helpers", () => {
  test("legacyMarkers: the §66.21 retired forms + a missing <program>; comments do not count", () => {
    expect(legacyMarkers("<program>\n<let n:int=0/>\n</program>")).toEqual([]);
    expect(legacyMarkers("<program>\n${ <n> = 0 }\n</program>")).toEqual(["rhs-decl"]);
    expect(legacyMarkers("<program>\n<count server> = 0\n</program>")).toEqual(["rhs-decl"]);
    expect(legacyMarkers("<program>\n${ <n>: int = 0 }\n</program>")).toEqual(["rhs-decl"]);
    expect(legacyMarkers("<program>\n${ const <d> = @n * 2 }\n</program>")).toEqual(["rhs-decl", "const-cell"]); // `<d> =` is the RHS shape too
    expect(legacyMarkers("<program>\n${ const Card = <div/> }\n</program>")).toEqual(["component-const"]);
    expect(legacyMarkers("<program>\n<engine for=P initial=.A></>\n</program>")).toEqual(["engine-element"]);
    expect(legacyMarkers("<p>x</p>")).toEqual(["no-program-root"]);
    expect(legacyMarkers("<program>\n// old form: <n> = 0\n<!-- <engine for=X> -->\n</program>")).toEqual([]);
    expect(legacyMarkers("<program>\n<p>${@a == 1}</p>\n</program>")).toEqual([]);
  });
  test("codeLiterals reads quoted code literals only", () => {
    expect([...codeLiterals(['diag("E-FOO-1", x) // E-NOT-THIS', "'W-BAR'", '"I-BAZ-QUX"'])].sort()).toEqual(["E-FOO-1", "I-BAZ-QUX"]);
  });
  test("isVacuousPass: absence of an unknown code is vacuous; of a known code, or any requirement, is not", () => {
    const known = new Set(["E-KNOWN"]);
    expect(isVacuousPass({ codes: [], notCodes: ["E-UNKNOWN"] }, known, false)).toBe(true);
    expect(isVacuousPass({ codes: [], notCodes: ["E-KNOWN"] }, known, false)).toBe(false);
    expect(isVacuousPass({ codes: [], notCodePrefixes: ["E-KN"] }, known, false)).toBe(false);
    expect(isVacuousPass({ codes: ["E-UNKNOWN"] }, known, false)).toBe(false);
    expect(isVacuousPass({ codes: [] }, known, true)).toBe(false);
  });
});

describe("CLI — exit status is separate from the output (pa-base §8)", () => {
  test("a valid run exits 0 even with a FAIL; --fail-on-fail exits 1; zero attempted exits 2", () => {
    const run = (...a) => Bun.spawnSync(["bun", SCRIPT, "--cases", FIXTURES, ...a], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    const plain = run();
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout.toString()).toContain("8 of 8 cases attempted");
    expect(run("--fail-on-fail").exitCode).toBe(1);
    const none = run("--filter", "no-such-case-anywhere");
    expect(none.exitCode).toBe(2);
    expect(none.stderr.toString()).toContain("zero cases attempted");
  }, { timeout: 180000 });
});
