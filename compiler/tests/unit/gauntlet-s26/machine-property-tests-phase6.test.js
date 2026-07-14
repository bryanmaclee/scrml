/**
 * S26 gauntlet — §51.13 phase 6: derived / projection machines.
 *
 * Phase 6 routes §51.9 derived machines to a distinct emit path. A
 * derived machine has no transition table — reading `@projected`
 * delegates through `_scrml_project_<Name>(source)`. The property
 * under test is:
 *
 *   (d) Projection correctness. For every variant V declared on the
 *       source enum, the projection function SHALL return the target
 *       variant declared by the first matching rule.
 *
 * The generated suite inlines a minimal copy of the projection
 * function (mirroring emit-machines.ts emitProjectionFunction) and
 * asserts one test per source variant.
 *
 * Phase 6 scope: unguarded projections only. Projections whose rules
 * carry `given` guards need first-match-wins semantics against
 * simulated reactive-store state — more involved than the
 * parametrization used for transition-machine guards. Guarded
 * projections are skipped with an explanatory comment and deferred to
 * a future phase.
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
  const name = `s26-p6-${uniq}`;
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

describe("S26 §51.13 phase 6 — derived/projection machines end-to-end", () => {
  test("simple projection emits one test per source variant", () => {
    const src = `<program>
\${
  type Order:enum = { Draft, Submitted, Done }
  type UIMode:enum = { Editable, ReadOnly }
  @order: OrderMachine = Order.Draft
}
< machine name=OrderMachine for=Order>
  .Draft => .Submitted
  .Submitted => .Done
</>
< machine name=UI for=UIMode derived=@order>
  .Draft                => .Editable
  .Submitted | .Done    => .ReadOnly
</>
<p>\${@ui}</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Projection block has a distinct describe label
    expect(machineTestJs).toContain("[generated] projection machine UI");
    // One test per source variant with the declared target
    expect(machineTestJs).toContain('"projects .Draft => .Editable"');
    expect(machineTestJs).toContain('"projects .Submitted => .ReadOnly"');
    expect(machineTestJs).toContain('"projects .Done => .ReadOnly"');
    // Projection function is inlined (no reliance on runtime)
    expect(machineTestJs).toContain("function __project_UI");
  });

  // End-to-end coverage of projection-guard skipping deferred — the
  // scrml pipeline's handling of `given` inside a projection rule is not
  // guaranteed to surface guards on `rule.guard` for the emitter. The
  // contract-level test below exercises the skip path with a
  // hand-crafted registry that does carry a guard.

  test("transition + projection machines coexist in the same file", () => {
    // One transition machine (OrderMachine) + one derived (UI) — phases
    // 1-5 and phase 6 in the same generated suite.
    const src = `<program>
\${
  type Order:enum = { Draft, Approved }
  type UIMode:enum = { Editable, ReadOnly }
  @order: OrderMachine = Order.Draft
  function submit() { @order = Order.Approved }
}
< machine name=OrderMachine for=Order>
  .Draft => .Approved
</>
< machine name=UI for=UIMode derived=@order>
  .Draft     => .Editable
  .Approved  => .ReadOnly
</>
<button on:click={submit()}>submit</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Transition-machine describe (phases 1-5)
    expect(machineTestJs).toContain("[generated] machine OrderMachine");
    expect(machineTestJs).toContain("declared .Draft => .Approved succeeds");
    // Projection-machine describe (phase 6)
    expect(machineTestJs).toContain("[generated] projection machine UI");
    expect(machineTestJs).toContain('"projects .Draft => .Editable"');
    expect(machineTestJs).toContain('"projects .Approved => .ReadOnly"');
  });

  test("projection-machine suite runs cleanly under bun test", () => {
    const src = `<program>
\${
  type OrderState:enum = { Draft, Submitted, Paid, Shipping, Delivered, Cancelled, Refunded }
  type UIMode:enum = { Editable, ReadOnly, Terminal }
  @order: OrderMachine = OrderState.Draft
}
< machine name=OrderMachine for=OrderState>
  .Draft => .Submitted
  .Submitted => .Paid
  .Paid => .Shipping
  .Shipping => .Delivered
  .Submitted => .Cancelled
  .Delivered => .Refunded
</>
< machine name=UI for=UIMode derived=@order>
  .Draft                                  => .Editable
  .Submitted | .Paid | .Shipping          => .ReadOnly
  .Delivered | .Cancelled | .Refunded     => .Terminal
</>
<p>\${@ui}</>
</program>
`;
    const { machineTestJs } = compileWithFlag(src, true);
    expect(machineTestJs).not.toBeNull();
    const execDir = resolve(testDir, "_tmp_p6-exec");
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
      // OrderMachine: 7 reachable × 7 = 49 exclusivity
      // UI projection: 7 projection tests
      // Total: 56
      expect(combined).toContain("56 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit contract — hand-built derived registries, independent of the scrml
// pipeline.
// ---------------------------------------------------------------------------

describe("S26 §51.13 phase 6 — generateMachineTestJs projection contract", () => {
  test("unguarded projection: one test per source variant, inlined function", () => {
    const registry = new Map();
    registry.set("Proj", {
      name: "Proj",
      isDerived: true,
      rules: [
        { from: "A", to: "X", guard: null, label: null, effectBody: null },
        { from: "B", to: "X", guard: null, label: null, effectBody: null },
        { from: "C", to: "Y", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).not.toBeNull();
    expect(out).toContain("[generated] projection machine Proj");
    expect(out).toContain("function __project_Proj");
    // One test per source variant, correct target
    expect(out).toContain('"projects .A => .X"');
    expect(out).toContain('"projects .B => .X"');
    expect(out).toContain('"projects .C => .Y"');
    // Inlined function has an if-chain for each rule
    expect(out).toContain('if (tag === "A") return "X";');
    expect(out).toContain('if (tag === "B") return "X";');
    expect(out).toContain('if (tag === "C") return "Y";');
  });

  test("first-match-wins: duplicate from-variant only tests the first target", () => {
    // Projection rules are evaluated top-to-bottom, first-match-wins.
    // If .A appears twice (unguarded duplicate), the first rule's target
    // wins. (In real scrml E-ENGINE-018/014 would flag this, but the
    // generator shouldn't crash on it.)
    const registry = new Map();
    registry.set("Proj", {
      name: "Proj",
      isDerived: true,
      rules: [
        { from: "A", to: "First", guard: null, label: null, effectBody: null },
        { from: "A", to: "Second", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).not.toBeNull();
    expect(out).toContain('"projects .A => .First"');
    expect(out).not.toContain('"projects .A => .Second"');
  });

  test("projection with UNLABELED guards skipped with explanatory comment", () => {
    // S28 phase 7 extends projection support to GUARDED projections —
    // provided every guarded rule carries a `[label]`. An UNLABELED guard
    // still skips the machine with an explanatory comment, parallel to
    // phase 2's unlabeled-guard rule for transition machines.
    const registry = new Map();
    registry.set("Proj", {
      name: "Proj",
      isDerived: true,
      rules: [
        { from: "A", to: "Editable", guard: "@isAdmin", label: null, effectBody: null },
        { from: "A", to: "ReadOnly", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).toContain("Skipped Proj");
    expect(out).toContain("unlabeled `given` guard");
    expect(out).toContain("phase 7");
    expect(out).not.toContain("[generated] projection machine Proj");
  });

  test("empty derived machine: skipped as empty rule set", () => {
    const registry = new Map();
    registry.set("Empty", {
      name: "Empty",
      isDerived: true,
      rules: [],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map());
    expect(out).toContain("Skipped Empty");
    expect(out).toContain("empty rule set");
  });
});
