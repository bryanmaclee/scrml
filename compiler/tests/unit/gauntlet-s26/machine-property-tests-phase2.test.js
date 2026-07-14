/**
 * S26 gauntlet — §51.13 phase 2: guard coverage (property c).
 *
 * Phase 2 extends the auto-property-tests emitter to cover every labeled
 * `given` guard rule. Each labeled guard gets a passing + failing test
 * pair per §51.13.1(c):
 *
 *   - passing: guard evaluates truthy → transition succeeds (result = null)
 *   - failing: guard evaluates falsy → throws E-ENGINE-001-RT: Transition
 *     guard failed.
 *
 * The phase-2 harness parametrizes the guard result rather than evaluating
 * the real guard expression. This faithfully tests the property §51.13.1(c)
 * describes (the enforcement WIRING) without coupling the test to the
 * guard expression's inputs. Real-expression evaluation with automatic
 * input synthesis is a future phase.
 *
 * Unlabeled guards are skipped because we cannot name them stably in test
 * titles; the existing phase-1 test covers the skip-with-comment behavior.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";
import { generateMachineTestJs } from "../../../src/codegen/emit-machine-property-tests.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));

function compileWithFlag(source, flag) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `s26-p2-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
      emitMachineTests: flag,
    });
    const machineTestPath = resolve(outDir, `${name}.machine.test.js`);
    const machineTestJs = existsSync(machineTestPath) ? readFileSync(machineTestPath, "utf8") : null;
    return { errors: result.errors ?? [], machineTestJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S26 §51.13 phase 2 — guard coverage end-to-end", () => {
  test("labeled-guard machine: emits passing + failing tests per labeled rule", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  const @allow: boolean = true
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@allow) [canClose]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Guarded machine no longer skipped in phase 2
    expect(machineTestJs).not.toContain("Skipped FlowMachine");
    // Exclusivity passing-path explicitly names the guard-truthy condition
    expect(machineTestJs).toContain("declared .Open => .Closed (guarded) succeeds when guard truthy");
    // Dedicated failing test for the labeled guard
    expect(machineTestJs).toContain("guard [canClose] on .Open => .Closed: rejected when guard falsy");
    // Failing test asserts the "Transition guard failed" message
    expect(machineTestJs).toContain("Transition guard failed");
  });

  test("mixed labeled-guard + unguarded rules emit both properties", () => {
    const src = `<program>
\${
  type Order:enum = { Draft, Review, Approved, Rejected }
  @order: OrderFlow = Order.Draft
  const @canApprove: boolean = true
  function submit() { @order = Order.Review }
}
< machine name=OrderFlow for=Order>
  .Draft => .Review
  .Review => .Approved given (@canApprove) [approverOk]
  .Review => .Rejected
</>
<button on:click={submit()}>submit</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Unguarded rule — normal phase-1 title
    expect(machineTestJs).toContain("declared .Draft => .Review succeeds");
    // Unguarded rule — normal phase-1 title
    expect(machineTestJs).toContain("declared .Review => .Rejected succeeds");
    // Guarded rule — phase-2 exclusivity title (guard truthy)
    expect(machineTestJs).toContain("declared .Review => .Approved (guarded) succeeds when guard truthy");
    // Guarded rule — phase-2 failing test
    expect(machineTestJs).toContain("guard [approverOk] on .Review => .Approved: rejected when guard falsy");
  });

  test("generated file executes cleanly under bun test", () => {
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  const @allow: boolean = true
  function doClose() { @f = Flow.Closed }
}
< machine name=FlowMachine for=Flow>
  .Open => .Closed given (@allow) [canClose]
</>
<button on:click={doClose()}>close</>
</program>
`;
    const { machineTestJs } = compileWithFlag(src, true);
    expect(machineTestJs).not.toBeNull();
    const execDir = resolve(testDir, "_tmp_p2-exec");
    mkdirSync(execDir, { recursive: true });
    const runPath = resolve(execDir, "run.test.js");
    writeFileSync(runPath, machineTestJs);
    try {
      const proc = Bun.spawnSync(["bun", "test", runPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new TextDecoder().decode(proc.stdout ?? new Uint8Array());
      const stderr = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
      const combined = stdout + "\n" + stderr;
      expect(proc.exitCode).toBe(0);
      // Expect: 4 exclusivity tests (2x2 grid) + 1 guard-failing test = 5 total
      expect(combined).toContain("5 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit-contract tests — generator shape, independent of the full pipeline.
// ---------------------------------------------------------------------------

describe("S26 §51.13 phase 2 — generateMachineTestJs contract", () => {
  test("labeled guard: emits passing + failing test titles", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: "@ok", label: "letMeIn", effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    // Exclusivity passing (guarded-succeeds-when-truthy)
    expect(out).toContain('"declared .A => .B (guarded) succeeds when guard truthy"');
    // Phase-2 failing
    expect(out).toContain('"guard [letMeIn] on .A => .B: rejected when guard falsy"');
    // Harness passes guardResults on the exclusivity-declared case
    expect(out).toContain('{ "A:B": true }');
    // Harness passes guardResults on the failing case
    expect(out).toContain('{ "A:B": false }');
    // Table marker matches production shape for guarded rules
    expect(out).toContain('"A:B": { guard: true }');
  });

  test("unlabeled guard: whole machine skipped", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: "@ok", label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).toContain("Skipped M");
    expect(out).toContain("contains unlabeled `given` guards");
    expect(out).not.toContain("[generated] machine M");
  });

  test("mixed labeled guards and unguarded rules: both emit normally", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null },
        { from: "B", to: "C", guard: "@yes", label: "okay", effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B succeeds"');
    expect(out).toContain('"declared .B => .C (guarded) succeeds when guard truthy"');
    expect(out).toContain('"guard [okay] on .B => .C: rejected when guard falsy"');
    // Exactly one failing-guard test, since we have one labeled guard
    const failingMatches = out.match(/rejected when guard falsy/g) ?? [];
    expect(failingMatches.length).toBe(1);
  });

  test("harness inlines guardResults handling", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [{ from: "A", to: "B", guard: "@x", label: "g", effectBody: null }],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).toContain("function tryTransition(from, to, guardResults)");
    // Phase 4 renamed the lookup variable to __matchKey so guardResults can
    // key on the matched (possibly-wildcard) rule rather than the concrete
    // input pair. Either name satisfies the harness-shape check.
    expect(out).toMatch(/guardResults\.hasOwnProperty\(__(match)?[kK]ey\)/);
    expect(out).toContain("Transition guard failed");
  });
});
