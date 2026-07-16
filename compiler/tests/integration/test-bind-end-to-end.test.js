/**
 * `test-bind` End-to-End Integration — Phase A8 / A6-5 (S76).
 *
 * Closes the test-bind family: SPEC §19.12.6/.7 + parser (A6-2) + typer
 * (A6-3) + codegen (A6-4) + compileScrml-level wiring (A6-5 api.js
 * `testMode` opt + `.test.js` writeOutput, S76).
 *
 * Each test in this file:
 *   1. Writes a real `.scrml` fixture to /tmp.
 *   2. Compiles it via `compileScrml({ ..., testMode: true })`.
 *   3. Confirms `<base>.test.js` was written to disk.
 *   4. Spawns `bun test <generated-file>` as a CHILD PROCESS so the
 *      generated test JS runs under bun:test for real (not just
 *      pattern-matched as text).
 *   5. Asserts on the child process's exit code + stdout/stderr to
 *      verify the runtime behavior of the dispatch hook.
 *
 * This is the missing layer the unit-tests (A6-2/A6-3/A6-4) don't
 * exercise: actual EXECUTION of the emitted test JS under a real
 * bun:test runner. If any of the encoding-name plumbing, dispatch-hook
 * scoping, or thrower-stub emission is silently wrong at the unit
 * level, this layer catches it.
 *
 * Coverage:
 *   §1  Happy path — bound server-fn → test passes
 *   §2  E-TEST-006 path — unbound same-file server-fn called from
 *       ~{} → test FAILS (non-zero exit + E-TEST-006 in output)
 *   §3  0-byte production cost — testMode=false vs testMode=true:
 *       clientJs + serverJs bit-identical; only testJs differs
 *   §4  testMode=false → no .test.js file written (structural)
 *   §5  Multiple test-binds in one ~{} block → all dispatched
 *       correctly when called from test bodies
 *
 * Source-of-truth: SPEC §19.12.6 / §19.12.7 / §47.5; §34 row E-TEST-006.
 *
 * **Follow-up surfaced by A6-5 integration testing (S76, hand-off note):**
 * The `~{}` test-block body codegen joins tokens with single spaces but
 * does NOT insert statement separators between consecutive `let` decls.
 * Source `let a = f(); let b = g();` (two lets, sibling statements)
 * emits as `let a = f ( ) let b = g ( )` (one line, no `;`/newline),
 * which fails to parse as JavaScript at bun:test load time. Workaround:
 * use single-statement test bodies, OR replace `let` chain with direct
 * `assert <expr>` form (no intermediate binding). §5 of this file uses
 * the latter shape. Same root cause as the test-bind RHS string-quote-
 * strip artifact (raw token-join in test-block body codegen). Filed as
 * a separate codegen tightening dispatch.
 */

import { describe, expect, test } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an isolated /tmp scratch dir per test invocation. Caller writes
 * fixtures into it; the dist/ subdir is the compileScrml output.
 */
function scratch(slug) {
  // os.tmpdir() + mkdtempSync gives a real native temp dir on every platform.
  // The prior hardcoded `/tmp/...` literal is not a drive-qualified absolute
  // path on Windows, so it landed under the cwd drive root and the §3 outputs
  // lookup (a resolve()d absolute-path Map key) never matched. No behavior
  // change on POSIX (still a unique temp dir).
  return mkdtempSync(join(tmpdir(), `scrml-a6-5-e2e-${slug}-`));
}

/**
 * Write a fixture to `<dir>/app.scrml`, compile via compileScrml with
 * the given testMode, return { result, distDir, testJsPath, exists }.
 */
function compileFixture(dir, source, testMode) {
  const appPath = join(dir, "app.scrml");
  writeFileSync(appPath, source);
  const distDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [appPath],
    outputDir: distDir,
    write: true,
    testMode,
    log: () => {},
  });
  const testJsPath = join(distDir, "app.test.js");
  return { result, distDir, testJsPath, exists: existsSync(testJsPath) };
}

/**
 * Spawn `bun test <path>` synchronously. Returns { status, stdout, stderr }.
 * Captures both streams as strings.
 */
function runBunTest(path) {
  const result = spawnSync("bun", ["test", path], {
    // Cross-machine: use process.cwd() so this works on any machine where
    // `bun run test` is invoked from the repo root. (S78 audit fix; was
    // hard-coded to /home/bryan-maclee/... which broke A6-5 §1/§2/§5 on
    // any machine with a different username.)
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

// ---------------------------------------------------------------------------
// §1 — Happy path: bound server-fn → test passes
// ---------------------------------------------------------------------------

describe("test-bind A6-5 §1: happy path — bound server-fn → test passes", () => {
  test("compileScrml + bun test on generated .test.js exits 0", () => {
    const dir = scratch("happy");
    const src = `\${
  server fn loadCount(seed) { seed }
}
~{
  test-bind loadCount = (seed) => 42
  test "loadCount returns the bound value" {
    let got = loadCount(7)
    assert got == 42
  }
}
`;
    const { result, testJsPath, exists } = compileFixture(dir, src, true);

    // Compilation succeeded (warnings allowed; only hard errors fail)
    const hardErrors = (result.errors || []).filter(
      e => e.severity !== "warning" && e.severity !== "info"
    );
    expect(hardErrors).toEqual([]);
    expect(exists).toBe(true);

    // Generated test JS contains the binding
    const testJs = readFileSync(testJsPath, "utf8");
    expect(testJs).toContain("const loadCount =");
    expect(testJs).toContain('describe("app.scrml"');

    // Run it under bun:test — must pass (exit 0)
    const child = runBunTest(testJsPath);
    expect(child.status).toBe(0);
    // bun:test reports pass count to stderr (its standard output stream)
    expect(child.stderr + child.stdout).toMatch(/1 pass/);
    expect(child.stderr + child.stdout).toMatch(/0 fail/);
  });
});

// ---------------------------------------------------------------------------
// §2 — E-TEST-006 path: unbound same-file server-fn called from ~{}
// ---------------------------------------------------------------------------

describe("test-bind A6-5 §2: E-TEST-006 — unbound server-fn call fails the test", () => {
  test("compileScrml + bun test fails when a same-file server-fn is unbound", () => {
    const dir = scratch("etest006");
    // server-fn declared, no test-bind, but called from inside the test
    // body. Per SPEC §19.12.7: dispatch hook emits a thrower stub for
    // each unbound same-file server-fn; calling it throws E-TEST-006
    // and fails the bun:test case.
    const src = `\${
  server fn sendEmail(to) { to }
}
~{
  test "side-effect call without binding fails" {
    let v = sendEmail(99)
    assert v == 99
  }
}
`;
    const { result, testJsPath, exists } = compileFixture(dir, src, true);
    const hardErrors = (result.errors || []).filter(
      e => e.severity !== "warning" && e.severity !== "info"
    );
    expect(hardErrors).toEqual([]);
    expect(exists).toBe(true);

    // Generated test JS should contain the thrower stub
    const testJs = readFileSync(testJsPath, "utf8");
    expect(testJs).toContain("const sendEmail = (...args) => { throw new Error(");
    expect(testJs).toContain("E-TEST-006");

    // Run under bun:test — MUST fail (non-zero exit; throw is caught
    // as a test failure by bun:test). Either status !== 0 OR stderr
    // contains "1 fail" — both are valid failure surfaces depending
    // on bun's reporting shape.
    const child = runBunTest(testJsPath);
    const combined = child.stderr + child.stdout;
    const reportedFail = /1 fail/.test(combined) || /fail/i.test(combined);
    const nonZero = child.status !== 0;
    expect(reportedFail || nonZero).toBe(true);
    // E-TEST-006 should surface in the failure output (the thrown
    // Error message is the dispatch-hook diagnostic text).
    expect(combined).toContain("E-TEST-006");
  });
});

// ---------------------------------------------------------------------------
// §3 — 0-byte production cost (SPEC §19.12.7) at compileScrml level
// ---------------------------------------------------------------------------

describe("test-bind A6-5 §3: 0-byte production cost via compileScrml", () => {
  test("clientJs + serverJs bit-identical with vs without testMode", () => {
    const src = `\${
  server fn fetchOne(id) { id }
}
<program>
  <h1>Test</h1>
  \${ const seven = 7 }
</program>
~{
  test-bind fetchOne = (id) => 99
  test "fetch" { assert true }
}
`;

    // Compile twice, once each way.
    const dirA = scratch("0byte-on");
    const { result: rA } = compileFixture(dirA, src, true);
    // outputs is keyed by the resolve()d absolute input path, so resolve() the
    // lookup key to match (a no-op on POSIX where join already yields the key).
    const outA = rA.outputs.get(resolve(join(dirA, "app.scrml")));

    const dirB = scratch("0byte-off");
    const { result: rB } = compileFixture(dirB, src, false);
    const outB = rB.outputs.get(resolve(join(dirB, "app.scrml")));

    // Filenames in test/non-test mode differ in dir paths but JS bodies
    // should be IDENTICAL in clientJs and serverJs (the spec guarantee).
    // Test-mode adds a testJs; production doesn't.
    expect(outA?.clientJs).toBe(outB?.clientJs);
    expect(outA?.serverJs).toBe(outB?.serverJs);
    expect(outA?.testJs).toBeTruthy();
    expect(outB?.testJs).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// §4 — testMode=false → no .test.js file written
// ---------------------------------------------------------------------------

describe("test-bind A6-5 §4: testMode=false produces no .test.js file", () => {
  test("compileScrml without testMode never writes app.test.js", () => {
    const dir = scratch("nofile");
    const src = `\${
  server fn x() { 1 }
}
~{
  test-bind x = () => 7
  test "case" { assert true }
}
`;
    const { testJsPath, exists } = compileFixture(dir, src, false);
    expect(exists).toBe(false);
    // Sanity: client/server still emitted
    expect(existsSync(join(dir, "dist", "app.client.js"))).toBe(true);
    expect(existsSync(join(dir, "dist", "app.server.js"))).toBe(true);
    // testJsPath was the predicted location; just confirm non-existence
    expect(existsSync(testJsPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — Multiple test-binds in one ~{} block all dispatch correctly
// ---------------------------------------------------------------------------

describe("test-bind A6-5 §5: multiple bindings in one ~{} block", () => {
  test("two bindings both dispatched; test calls each and assertions pass", () => {
    const dir = scratch("multi");
    const src = `\${
  server fn loadA(seed) { seed }
  server fn loadB(seed) { seed }
}
~{
  test-bind loadA = (seed) => 100
  test-bind loadB = (seed) => 200
  test "both bindings dispatch" {
    assert loadA(1) == 100
    assert loadB(2) == 200
  }
}
`;
    const { result, testJsPath, exists } = compileFixture(dir, src, true);
    const hardErrors = (result.errors || []).filter(
      e => e.severity !== "warning" && e.severity !== "info"
    );
    expect(hardErrors).toEqual([]);
    expect(exists).toBe(true);

    const testJs = readFileSync(testJsPath, "utf8");
    expect(testJs).toContain("const loadA =");
    expect(testJs).toContain("const loadB =");

    const child = runBunTest(testJsPath);
    expect(child.status).toBe(0);
    expect(child.stderr + child.stdout).toMatch(/1 pass/);
  });
});
