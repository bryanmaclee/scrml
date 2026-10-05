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
  codesHalfFailures,
  isVacuousPass,
  legacyMarkers,
  loadBootstrapModules,
  mapSupersededCodes,
  readDialectOverride,
  renderReport,
  runBootstrapConformance,
  SUPERSEDED_CODE_MAP,
  twinOf,
} from "../../../../scripts/bootstrap-conformance.ts";
import { loadCases } from "../../../../conformance/run.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const FIXTURES = join(import.meta.dir, "fixtures");
const SCRIPT = join(REPO, "scripts", "bootstrap-conformance.ts");

let boot;
beforeAll(async () => {
  boot = await loadBootstrapModules();
}, { timeout: 180000 });

// Default (twin) mode. `refused/legacy` is a legacy-dialect case: it is graded on its generated §66
// twin (and PASSes); with --no-twins it is LEGACY (see the "--no-twins" test).
const KNOWN = {
  "codes/pass-codes": ["PASS", false],
  "codes/vacuous": ["PASS", true],
  "codes/parse-info": ["PASS", false],
  "runtime/pass-runtime": ["PASS", false],
  "runtime/fail-runtime": ["FAIL", false],
  "runtime/codes-only": ["CODES-ONLY", true],
  "runtime/server-stub": ["PASS", false],
  "refused/unsupported": ["UNSUPPORTED", false],
  "refused/legacy": ["PASS", false],
  "refused/invalid": ["INVALID", false],
  "twins/not-twinned": ["NOT-TWINNED", false],
  "twins/excluded": ["NOT-TWINNED", false],
  "twins/override-expect": ["PASS", false],
  "twins/mapped": ["PASS", false],
  "twins/extra-error": ["FAIL", false],
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

  // s454 (U1b, design Item 3.4): a `serverStub` case's runtime half EXECUTES — the stub answers the
  // bootstrap's own client call over its route manifest (stubFetch). Bite: the same case with the
  // stub answering an impl#1-shaped error (`type: "CpsError"`) — strict decoding makes it
  // Transport(Malformed), so the case's `.Transport(t)` arm runs and the expected state no longer holds.
  test("a serverStub case runs: the stub answers the client call (and an impl#1-shaped error stub is Transport(Malformed))", async () => {
    const cs = loadCases(FIXTURES);
    const c = cs.find((x) => x.relDir === "runtime/server-stub");
    const pass = await classifyCase(boot, c);
    expect(pass.runtimeExecuted).toBe(true);
    expect(pass.bucket).toBe("PASS");
    const bad = structuredClone(c);
    bad.expected.expect.serverStub = { count: { __serverError: { type: "CpsError", variant: "ServerError" } } };
    const fail = await classifyCase(boot, bad);
    expect(fail.bucket).toBe("FAIL");
    expect(fail.failures.join("\n")).toContain("seen");
  }, { timeout: 60000 });

  // s452-boot-arm-pipe: a parse-phase Info lint (W-ARM-PIPE-LEGACY) is an ACCEPTED form — graded,
  // never `parse-reject`. Bite: the same source with a parse ERROR added is UNSUPPORTED/parse-reject.
  test("a parse-phase Info lint is graded (unasserted, allowed), not a parse rejection", async () => {
    const cs = loadCases(FIXTURES);
    const c = cs.find((x) => x.relDir === "codes/parse-info");
    const v = await classifyCase(boot, c);
    expect([v.bucket, v.reason]).toEqual(["PASS", "codes"]);
    expect(v.unexpected).toEqual(["W-ARM-PIPE-LEGACY"]);
    expect(v.unexpectedErrors).toEqual([]);
    const bad = { ...c, source: c.source.replace("| _ :> @n = 2", "| _ :> @n = 2\n            ]") };
    const b = await classifyCase(boot, bad);
    expect([b.bucket, b.reason]).toEqual(["UNSUPPORTED", "parse-reject"]);
    expect(b.failures.every((f) => !f.startsWith("W-"))).toBe(true);
  }, { timeout: 60000 });

  test("UNSUPPORTED names the refusal; --no-twins grades a legacy case as written → LEGACY, naming the marker", async () => {
    const cs = loadCases(FIXTURES);
    const u = await classifyCase(boot, cs.find((x) => x.relDir === "refused/unsupported"));
    expect(u.reason).toBe("bootstrap-unsupported");
    expect(u.failures.join(" ")).toContain("#{");
    const l = await classifyCase(boot, cs.find((x) => x.relDir === "refused/legacy"), { twins: false });
    expect(l.bucket).toBe("LEGACY");
    expect(l.twin).toBe(false);
    expect(l.legacyMarkers).toEqual(["rhs-decl", "no-program-root"]);
  }, { timeout: 60000 });
});

describe("§66 twins (S449 dialect rulings 1 + 5)", () => {
  const get = (rel) => loadCases(FIXTURES).find((x) => x.relDir === rel);

  test("a legacy case is graded on its generated twin — the runtime half executes on the twin", async () => {
    const v = await classifyCase(boot, get("refused/legacy"));
    expect(v.bucket).toBe("PASS");
    expect(v.twin).toBe(true);
    expect(v.runtimeExecuted).toBe(true);
    expect(v.twinRules).toEqual(["program-wrap", "rhs-decl", "unwrap-logic"]);
    expect(v.legacyMarkers).toEqual(["rhs-decl", "no-program-root"]);
    // the twin is generated, not committed: it is the scrml fix output
    const tw = twinOf(get("refused/legacy"));
    expect(tw.source).toContain("let <count:number=0/>");
  }, { timeout: 60000 });

  test("a §66-dialect case is NOT twinned (graded as written)", async () => {
    const v = await classifyCase(boot, get("codes/pass-codes"));
    expect(v.twin).toBe(false);
    expect(twinOf(get("codes/pass-codes")).candidate).toBe(false);
  }, { timeout: 60000 });

  test("NOT-TWINNED is all-or-nothing and names the construct", async () => {
    const v = await classifyCase(boot, get("twins/not-twinned"));
    expect(v.bucket).toBe("NOT-TWINNED");
    expect(v.reason).toContain("Shape 2");
    expect(v.failures[0]).toMatch(/^case\.scrml:2 rhs-decl: Shape 2/);
  }, { timeout: 60000 });

  test("dialect.s66 `exclude` → NOT-TWINNED with the reason", async () => {
    const v = await classifyCase(boot, get("twins/excluded"));
    expect(v.bucket).toBe("NOT-TWINNED");
    expect(v.override).toBe("exclude");
    expect(v.reason).toContain("the case's subject is the legacy form itself");
  }, { timeout: 60000 });

  test("dialect.s66 `expect` replaces the twin's expectations — BITE: without it the twin FAILs", async () => {
    const v = await classifyCase(boot, get("twins/override-expect"));
    expect(v.bucket).toBe("PASS");
    expect(v.override).toBe("expect");
    const dir = mkdtempSync(join(tmpdir(), "bootconf-bite-"));
    try {
      cpSync(join(FIXTURES, "twins", "override-expect"), join(dir, "bite", "ov"), { recursive: true });
      rmSync(join(dir, "bite", "ov", "dialect.s66"));
      const [c] = loadCases(dir);
      const b = await classifyCase(boot, c);
      expect(b.bucket).toBe("FAIL");
      expect(b.failures).toEqual(["missing E-FIXTURE-LEGACY-ONLY"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, { timeout: 60000 });

  test("the superseded-code map rewrites a twin's expectation — BITE: unmapped, the twin FAILs", async () => {
    const v = await classifyCase(boot, get("twins/mapped"));
    expect(v.bucket).toBe("PASS");
    expect(v.mapped).toEqual(["E-ENGINE-VAR-DUPLICATE→E-SCOPE-010"]);
    expect(v.emitted).toContain("E-SCOPE-010");
    const dir = mkdtempSync(join(tmpdir(), "bootconf-bite-"));
    try {
      cpSync(join(FIXTURES, "twins", "mapped"), join(dir, "bite", "m"), { recursive: true });
      // An `expect` override with the UNMAPPED legacy code turns the map off for this case.
      writeFileSync(join(dir, "bite", "m", "dialect.s66"), JSON.stringify({ expect: { codes: ["E-ENGINE-VAR-DUPLICATE"] }, reason: "bite" }));
      const [c] = loadCases(dir);
      const b = await classifyCase(boot, c);
      expect(b.bucket).toBe("FAIL");
      expect(b.failures).toEqual(["missing E-ENGINE-VAR-DUPLICATE"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, { timeout: 60000 });

  test("a twin that PASSes its assertions but emits an unasserted E- code is a FAIL (twin-extra-error)", async () => {
    const v = await classifyCase(boot, get("twins/extra-error"));
    expect(v.bucket).toBe("FAIL");
    expect(v.reason).toBe("twin-extra-error");
    expect(v.failures).toEqual(["twin emitted unasserted error(s): E-TYPE-UNKNOWN"]);
    // the same source graded as written (not a twin) keeps the old rule: unasserted codes are reported, not failed
    const native = await classifyCase(boot, { ...get("twins/extra-error"), source: "<program>\n<n:integer=5/>\n<p id=\"n\">${@n}</p>\n</program>\n" });
    expect(native.twin).toBe(false);
    expect(native.bucket).toBe("PASS");
  }, { timeout: 60000 });

  test("map rows: every APPLIED row names a target and a SPEC citation; an owed row maps nothing", () => {
    for (const r of SUPERSEDED_CODE_MAP) {
      expect(r.spec).toMatch(/§\d/);
      if (r.status === "applied") expect(typeof r.to).toBe("string");
      else expect(r.to).toBeNull();
    }
    const owed = SUPERSEDED_CODE_MAP.find((r) => r.status === "owed");
    const m = mapSupersededCodes({ codes: [owed.from], notCodes: [], severity: { [owed.from]: "error" } });
    expect(m.expect.codes).toEqual([owed.from]);
    expect(m.mapped).toEqual([]);
    const a = mapSupersededCodes({ codes: ["E-ENGINE-VAR-DUPLICATE"], notCodes: ["E-ENGINE-VAR-DUPLICATE"], severity: { "E-ENGINE-VAR-DUPLICATE": "error" }, codeCounts: { "E-ENGINE-VAR-DUPLICATE": 1 } });
    expect(a.expect).toEqual({ codes: ["E-SCOPE-010"], notCodes: ["E-SCOPE-010"], severity: { "E-SCOPE-010": "error" }, codeCounts: { "E-SCOPE-010": 1 } });
  });

  test("a malformed dialect.s66 is an error, never ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootconf-ov-"));
    try {
      writeFileSync(join(dir, "dialect.s66"), JSON.stringify({ expect: { codes: [] } }));
      expect(() => readDialectOverride(dir)).toThrow(/needs a "reason"/);
      writeFileSync(join(dir, "dialect.s66"), JSON.stringify({ exclude: "x", expect: {} }));
      expect(() => readDialectOverride(dir)).toThrow(/exactly one/);
      writeFileSync(join(dir, "dialect.s66"), JSON.stringify({ exclude: "a reason" }));
      expect(readDialectOverride(dir)).toEqual({ exclude: "a reason" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
    expect(md).toContain(`**4 of ${all.length} cases attempted** (filter: \`runtime/\`)`);   // s454: + runtime/server-stub
    for (const b of ["PASS", "CODES-ONLY", "FAIL", "LEGACY", "NOT-TWINNED", "UNSUPPORTED", "CRASH", "INVALID"]) expect(md).toContain(`| ${b} |`);
    expect(md).toContain("- `runtime/fail-runtime` (runtime)");
  }, { timeout: 60000 });
});

describe("helpers", () => {
  test("legacyMarkers: the §66.21 retired forms + a missing <program>; comments do not count", () => {
    expect(legacyMarkers("<program>\nlet <n:int=0/>\n</program>")).toEqual([]);
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

// s449-bootstrap-form-validity: the bootstrap reports I- notes (I-FORM-SUBMIT-GATED, §55.17.6 "reports
// in the warnings stream") in a separate non-fatal `infos` list. The codes half unions both streams, as
// conformance/run.ts does for impl#1.
// s451-boot-diag-severity: severity is no longer inferred from the stream — every Diag carries its §34
// severity (compiler/self-host-v2/severity.scrml), and the codes half grades THAT. §34 (S451): "A code
// whose Severity column reads **Error** fails the compile … **Warning** and **Info** codes do not fail
// the compile."
describe("codes half — the bootstrap's non-fatal infos stream", () => {
  const d = (code, severity = "Info") => ({ code, severity, message: "", file: "f", span: { start: 0, end: 0 } });
  test("a required code found only in `infos` holds; severity info holds; any other severity fails", () => {
    expect(codesHalfFailures({ codes: ["I-FORM-SUBMIT-GATED"] }, [], [d("I-FORM-SUBMIT-GATED")])).toEqual([]);
    expect(codesHalfFailures({ severity: { "I-FORM-SUBMIT-GATED": "info" } }, [], [d("I-FORM-SUBMIT-GATED")])).toEqual([]);
    expect(codesHalfFailures({ severity: { "I-FORM-SUBMIT-GATED": "warning" } }, [], [d("I-FORM-SUBMIT-GATED")]))
      .toEqual(["severity: I-FORM-SUBMIT-GATED fired as info (expected warning)"]);
  });
  test("bite: without the infos stream the same required code is missing", () => {
    expect(codesHalfFailures({ codes: ["I-FORM-SUBMIT-GATED"] }, [])).toEqual(["missing I-FORM-SUBMIT-GATED"]);
  });
  test("forbidden codes are judged over both streams", () => {
    expect(codesHalfFailures({ notCodes: ["I-X"] }, [], [d("I-X")])).toEqual(["forbidden I-X fired"]);
  });
});

describe("codes half — the Diag's own §34 severity is graded (s451-boot-diag-severity)", () => {
  const d = (code, severity) => ({ code, severity, message: "", file: "f", span: { start: 0, end: 0 } });
  test("an Error / Warning in `diags` is graded by its severity field, not its stream or prefix", () => {
    expect(codesHalfFailures({ severity: { "E-SCOPE-001": "error" } }, [d("E-SCOPE-001", "Error")])).toEqual([]);
    expect(codesHalfFailures({ severity: { "W-LIFECYCLE-010": "warning" } }, [d("W-LIFECYCLE-010", "Warning")])).toEqual([]);
    expect(codesHalfFailures({ severity: { "E-DG-002": "warning" } }, [d("E-DG-002", "Warning")])).toEqual([]);
    expect(codesHalfFailures({ severity: { "W-LIFECYCLE-010": "error" } }, [d("W-LIFECYCLE-010", "Warning")]))
      .toEqual(["severity: W-LIFECYCLE-010 fired as warning (expected error)"]);
  });
  test("every occurrence must carry the asserted severity", () => {
    expect(codesHalfFailures({ severity: { "E-X": "error" } }, [d("E-X", "Error"), d("E-X", "Warning")]))
      .toEqual(["severity: E-X fired as error+warning (expected error)"]);
  });
  test("a Diag with no severity field is unobservable (a bootstrap defect, reported)", () => {
    expect(codesHalfFailures({ severity: { "E-X": "error" } }, [{ code: "E-X", message: "", file: "f" }]))
      .toEqual(["severity unobservable: E-X fired with no severity on its Diag (expected error)"]);
  });
});

describe("CLI — exit status is separate from the output (pa-base §8)", () => {
  test("a valid run exits 0 even with a FAIL; --fail-on-fail exits 1; zero attempted exits 2", () => {
    const run = (...a) => Bun.spawnSync(["bun", SCRIPT, "--cases", FIXTURES, ...a], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    const plain = run();
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout.toString()).toContain("15 of 15 cases attempted");   // s454: + runtime/server-stub
    expect(plain.stdout.toString()).toContain("### §66 twins");
    expect(run("--fail-on-fail").exitCode).toBe(1);
    const none = run("--filter", "no-such-case-anywhere");
    expect(none.exitCode).toBe(2);
    expect(none.stderr.toString()).toContain("zero cases attempted");
  }, { timeout: 180000 });
});
