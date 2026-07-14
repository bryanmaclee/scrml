/**
 * S26 gauntlet — §51.13 phase 3: payload-bound rules.
 *
 * Phase 3 lifts the phase-1 skip on machines whose rules use §51.3.2
 * payload bindings. The auto-property-tests harness is
 * binding-transparent — it doesn't invoke the real machine IIFE, so the
 * declared destructuring never executes in the generated tests. That
 * means exclusivity (property a) and guard coverage (property c) work
 * the same whether the rule binds payload fields or not: the harness
 * keys on the variant identity alone.
 *
 * These tests lock in:
 *   - a payload-bound rule lands an exclusivity test rather than a skip
 *   - a payload-bound AND labeled-guarded rule lands both exclusivity
 *     and guard-coverage tests
 *   - the generator contract for payload bindings
 *   - the full generated suite executes cleanly under bun test
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
  const name = `s26-p3-${uniq}`;
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

describe("S26 §51.13 phase 3 — payload-bound rules end-to-end", () => {
  test("payload-bound unguarded rule emits exclusivity, not a skip", () => {
    const src = `<program>
\${
  type CannonState:enum = {
    Idle
    Charging(level: number)
    Firing(shot: string)
  }
  @cs: CannonMachine = CannonState.Idle
  function start() { @cs = CannonState.Charging(0) }
}
< machine name=CannonMachine for=CannonState>
  .Idle               => .Charging(level: l)
  .Charging(n)        => .Firing(shot: s)
  .Firing             => .Idle
</>
<button on:click={start()}>start</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).not.toContain("Skipped CannonMachine");
    // Declared rules all show up in the exclusivity set
    expect(machineTestJs).toContain("declared .Idle => .Charging succeeds");
    expect(machineTestJs).toContain("declared .Charging => .Firing succeeds");
    expect(machineTestJs).toContain("declared .Firing => .Idle succeeds");
    // And at least one undeclared pair
    expect(machineTestJs).toContain("undeclared .Idle => .Firing rejected");
  });

  test("payload-bound AND labeled-guarded rule emits exclusivity + guard coverage", () => {
    const src = `<program>
\${
  type CannonState:enum = {
    Idle
    Charging(level: number)
    Ready
  }
  @cs: CannonMachine = CannonState.Idle
  function charge() { @cs = CannonState.Charging(0) }
}
< machine name=CannonMachine for=CannonState>
  .Idle               => .Charging(level: l)
  .Charging(n)        => .Ready given (n >= 50) [fullyCharged]
</>
<button on:click={charge()}>charge</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).not.toContain("Skipped CannonMachine");
    // The guarded payload-bound rule gets the phase-2-style titles
    expect(machineTestJs).toContain("declared .Charging => .Ready (guarded) succeeds when guard truthy");
    expect(machineTestJs).toContain("guard [fullyCharged] on .Charging => .Ready: rejected when guard falsy");
  });

  test("payload-bound machine: emitted suite runs cleanly under bun test", () => {
    const src = `<program>
\${
  type S:enum = {
    A(id: number)
    B(name: string)
    C
  }
  @s: M = S.A(1)
  function go() { @s = S.B("x") }
}
< machine name=M for=S>
  .A(k)  => .B(name: n)  given (k > 0) [positive]
  .B     => .C
</>
<button on:click={go()}>go</>
</program>
`;
    const { machineTestJs } = compileWithFlag(src, true);
    expect(machineTestJs).not.toBeNull();
    const execDir = resolve(testDir, "_tmp_p3-exec");
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
      // 3 reachable variants × 3 variants = 9 exclusivity tests + 1
      // labeled-guard failing test = 10 total.
      expect(combined).toContain("10 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit contract — bypasses the scrml pipeline to pin the generator's output
// shape for payload-bound registries built by hand.
// ---------------------------------------------------------------------------

describe("S26 §51.13 phase 3 — generateMachineTestJs contract", () => {
  test("payload-bound rule lands exclusivity test, not a skip", () => {
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

  test("payload-bound + labeled guard: exclusivity (guarded) + failing-guard test", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: "n > 0", label: "gtZero", effectBody: null,
          fromBindings: [{ localName: "n", fieldName: "value" }] },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B (guarded) succeeds when guard truthy"');
    expect(out).toContain('"guard [gtZero] on .A => .B: rejected when guard falsy"');
    // Table marker matches production shape — guard rule gets { guard: true }
    expect(out).toContain('"A:B": { guard: true }');
  });

  test("payload bindings on TO side are transparent to the harness", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null,
          toBindings: [{ localName: "n", fieldName: "value" }] },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).not.toContain("Skipped");
    expect(out).toContain('"declared .A => .B succeeds"');
  });

  test("bindings on both sides: still just exclusivity rows per variant pair", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null,
          fromBindings: [{ localName: "x", fieldName: "x" }],
          toBindings: [{ localName: "y", fieldName: "y" }] },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B succeeds"');
  });
});
