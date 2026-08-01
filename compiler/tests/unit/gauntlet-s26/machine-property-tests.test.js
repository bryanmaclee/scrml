/**
 * S26 gauntlet — §51.13 auto-generated machine property tests (phase 1).
 *
 * `--emit-machine-tests` emits `<base>.machine.test.js` alongside the normal
 * client/server/html output. The generated bun:test file verifies that the
 * compiled transition guard enforces exactly what the machine's transition
 * table declares. Phase 1 covers property (a) Exclusivity for machines
 * whose rules are all unguarded, payload-free, non-wildcard, and
 * non-temporal.
 *
 * Runtime rule being verified: the generated test inlines the same
 * `__scrml_transitions_<Name>` lookup shape emit-machines.ts produces and
 * runs each (from, to) pair through a small `tryTransition` harness.
 * Declared pairs must return null, undeclared pairs must return an
 * E-ENGINE-001-RT Error.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";
import { generateMachineTestJs } from "../../../src/codegen/emit-machine-property-tests.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrcWithFlag(source, flag, testName = `s26-${flag ? "auto" : "plain"}-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
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
    const machineTestPath = resolve(outDir, `${testName}.machine.test.js`);
    const machineTestJs = existsSync(machineTestPath) ? readFileSync(machineTestPath, "utf8") : null;
    return {
      errors: result.errors ?? [],
      machineTestPath,
      machineTestJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S26 §51.13 — auto-generated machine property tests", () => {
  test("flag off: no .machine.test.js written", () => {
    const src = `<program>
\${
  type OrderStatus:enum = { Pending, Processing, Shipped }
  @status: OrderFlow = OrderStatus.Pending
}
< engine name=OrderFlow for=OrderStatus>
  .Pending => .Processing
  .Processing => .Shipped
</>
<p>x</>
</program>
`;
    const { errors, machineTestJs } = compileSrcWithFlag(src, false);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).toBeNull();
  });

  test("flag on, simple machine: .machine.test.js emitted", () => {
    const src = `<program>
\${
  type OrderStatus:enum = { Pending, Processing, Shipped }
  @status: OrderFlow = OrderStatus.Pending
}
< engine name=OrderFlow for=OrderStatus>
  .Pending => .Processing
  .Processing => .Shipped
</>
<p>x</>
</program>
`;
    const { errors, machineTestJs } = compileSrcWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Header comments
    expect(machineTestJs).toContain("§51.13 auto-generated machine property tests");
    // bun:test import
    expect(machineTestJs).toContain(`from "bun:test"`);
    // Generated describe label
    expect(machineTestJs).toContain("[generated] machine OrderFlow");
    // Declared pair → success assertion
    expect(machineTestJs).toContain("declared .Pending => .Processing succeeds");
    expect(machineTestJs).toContain("toBeNull()");
    // Undeclared pair → rejection assertion
    expect(machineTestJs).toContain("undeclared .Pending => .Shipped rejected");
    expect(machineTestJs).toContain("E-ENGINE-001-RT");
  });

  test("generated test file actually passes when run against the compiled guard table", () => {
    // Emit the test, then execute it in a subprocess via bun:test.
    const src = `<program>
\${
  type OrderStatus:enum = { Pending, Processing, Shipped }
  @status: OrderFlow = OrderStatus.Pending
}
< engine name=OrderFlow for=OrderStatus>
  .Pending => .Processing
  .Processing => .Shipped
</>
<p>x</>
</program>
`;
    const { machineTestJs, machineTestPath } = compileSrcWithFlag(src, true, "s26-exec");
    expect(machineTestJs).not.toBeNull();
    // Re-create the temp output so we can exec it directly.
    const execDir = resolve(testDir, "_tmp_s26-exec-run");
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
      // bun test exit code 0 → all passed
      expect(proc.exitCode).toBe(0);
      // Should have run the two declared + seven undeclared pairs (3x3 = 9 total).
      expect(combined).toContain("9 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });

  test("unlabeled `given` guard: skipped (phase 2 requires a label)", () => {
    // An unlabeled guard can't be named stably in a test title, so phase 2
    // requires every guard rule to carry `[label]`. Unlabeled guards are
    // skipped with a pointer to §51.13.
    const src = `<program>
\${
  type Flow:enum = { Open, Closed }
  @f: FlowMachine = Flow.Open
  const @allow: boolean = true
}
< engine name=FlowMachine for=Flow>
  .Open => .Closed given (@allow)
</>
<p>x</>
</program>
`;
    const { errors, machineTestJs } = compileSrcWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).toContain("Skipped FlowMachine");
    expect(machineTestJs).toContain("contains unlabeled `given` guards");
    // No describe block for this machine
    expect(machineTestJs).not.toContain("[generated] machine FlowMachine");
  });

  test("temporal machine in-scope (phase 5) — exclusivity + timer-scope note", () => {
    // Phase 5 lifts the temporal filter. The (From, To) pair is still
    // declared regardless of how the transition fires; exclusivity
    // applies. Timer lifecycle is explicitly out of scope for
    // auto-property-tests and the emitted file calls that out.
    const src = `<program>
\${
  type Fetch:enum = { Idle, Loading, Done }
  @fetch: FetchMachine = Fetch.Idle
}
< engine name=FetchMachine for=Fetch>
  .Idle => .Loading
  .Loading after 30s => .Done
</>
<p>x</>
</program>
`;
    const { errors, machineTestJs } = compileSrcWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).not.toContain("Skipped FetchMachine");
    // The temporal rule emits an exclusivity test with (after Nms) annotation.
    expect(machineTestJs).toContain("declared .Loading => .Done (after 30000ms) succeeds");
    // Suite-level scope note calls out timer lifecycle as out-of-scope.
    expect(machineTestJs).toContain("Timer lifecycle");
    expect(machineTestJs).toContain("outside this suite's scope");
  });

  test("no machines in file: no .machine.test.js written", () => {
    const src = `<program>
<p>x</>
</program>
`;
    const { errors, machineTestJs } = compileSrcWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — generator contract (independent of the full compile pipeline).
// ---------------------------------------------------------------------------

describe("S26 §51.13 — generateMachineTestJs unit contract", () => {
  test("emits one test per (variant, variant) pair — declared pair succeeds", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B succeeds"');
    expect(out).toContain('"undeclared .A => .A rejected"');
    expect(out).toContain('"undeclared .B => .B rejected"');
    expect(out).toContain('"undeclared .B => .A rejected"');
  });

  test("returns null when registry is empty", () => {
    expect(generateMachineTestJs("/x/y.scrml", null, new Map())).toBeNull();
    expect(generateMachineTestJs("/x/y.scrml", new Map(), new Map())).toBeNull();
  });

  test("derived machine in-scope (phase 6) — emits a projection block", () => {
    // Phase 6 routes derived machines to a distinct emit path that tests
    // projection correctness rather than exclusivity. The unguarded
    // derived machine below gets one test per source variant.
    const registry = new Map();
    registry.set("Proj", {
      name: "Proj",
      isDerived: true,
      rules: [{ from: "Src", to: "Dest", guard: null, label: null, effectBody: null }],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).not.toContain("Skipped Proj");
    expect(out).toContain("[generated] projection machine Proj");
    expect(out).toContain('"projects .Src => .Dest"');
  });

  test("payload-bound rule in-scope (phase 3) — emits exclusivity tests", () => {
    // Phase 3 relaxes the payload-binding filter. The harness is
    // binding-transparent (it never executes the real destructuring), so
    // bindings don't change the emitted test shape — they're covered by
    // their variant's exclusivity row just like any other declared pair.
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null,
          fromBindings: [{ localName: "x", fieldName: "x" }] },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).not.toContain("Skipped M");
    expect(out).toContain('"declared .A => .B succeeds"');
  });
});

// ---------------------------------------------------------------------------
// S307 — the no-qualifying-engines artifact must SKIP, never falsely PASS.
// ---------------------------------------------------------------------------

describe("S307 — generated artifact never reports a hollow PASS", () => {
  // A registry whose machine has NO readable rule set is the modern `<engine>`
  // state-child shape as the generator currently sees it
  // (g-machine-tests-modern-engine-vacuous). It used to emit
  // `test("no qualifying machines", () => expect(true).toBe(true))` — a PASSING
  // assertion that verifies nothing, auto-generated into an adopter's suite.
  const emptyRuleRegistry = new Map([["M", { name: "M", governedTypeName: "T", rules: [] }]]);

  test("emits test.skip, NOT a passing assertion", () => {
    const out = generateMachineTestJs("/x/y.scrml", emptyRuleRegistry, new Map());
    expect(out).not.toBeNull();
    expect(out).toContain("test.skip(");
    // The specific hollow-gate shape must be gone.
    expect(out).not.toContain("expect(true).toBe(true)");
  });

  test("the skip names WHY it skipped (not a bare marker)", () => {
    const out = generateMachineTestJs("/x/y.scrml", emptyRuleRegistry, new Map());
    expect(out).toContain("no qualifying engines");
    // The per-machine skip note is carried into the test name so the reason
    // survives into the test runner's output, not just a file comment.
    expect(out).toMatch(/test\.skip\("no qualifying engines — .+"/);
  });

  test("a machine WITH rules still emits real assertions (no regression)", () => {
    const registry = new Map([["M", {
      name: "M", governedTypeName: "T",
      rules: [{ from: "A", to: "B" }],
    }]]);
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).toContain('"declared .A => .B succeeds"');
    expect(out).not.toContain("test.skip(");
  });
});
