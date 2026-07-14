/**
 * S26 gauntlet — §51.13 phase 5: temporal rules.
 *
 * Phase 5 allows `.From after Ns => .To` (§51.12) to flow through the
 * auto-property-tests emitter. The harness is timer-agnostic: it reads
 * the transition table's (From, To) presence without ever arming or
 * advancing timers, so exclusivity + guard coverage carry over
 * unchanged. Test titles receive an `(after Nms)` annotation so users
 * can see which pairs come from temporal rules.
 *
 * Scope boundary (intentional): timer lifecycle — arm on entry, clear
 * on exit, reset on reentry — is explicitly OUT OF SCOPE for this
 * suite. Verifying it requires a live scrml runtime with fake-timer
 * control, which the self-contained harness deliberately does not
 * provide. The generated file emits a header comment calling this out
 * so users aren't surprised when timer bugs slip past the auto-tests.
 *
 * Hand-written timer-lifecycle coverage lives in
 * `gauntlet-s25/machine-temporal-transitions.test.js`.
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
  const name = `s26-p5-${uniq}`;
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

describe("S26 §51.13 phase 5 — temporal rules end-to-end", () => {
  test("simple temporal rule: declared pair emits with (after Nms) annotation", () => {
    const src = `<program>
\${
  type Fetch:enum = { Idle, Loading, Done, TimedOut }
  @fetch: FetchMachine = Fetch.Idle
  function start() { @fetch = Fetch.Loading }
}
< machine name=FetchMachine for=Fetch>
  .Idle => .Loading
  .Loading after 30s => .TimedOut
  .Loading => .Done
</>
<button on:click={start()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).not.toContain("Skipped FetchMachine");
    // Temporal rule gets the (after Nms) suffix in its exclusivity title.
    expect(machineTestJs).toContain("declared .Loading => .TimedOut (after 30000ms) succeeds");
    // Non-temporal rule doesn't get the suffix.
    expect(machineTestJs).toContain("declared .Loading => .Done succeeds");
    expect(machineTestJs).not.toContain("declared .Loading => .Done (after");
  });

  test("multiple temporal durations annotated accurately", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C, D }
  @s: M = S.A
  function go() { @s = S.B }
}
< machine name=M for=S>
  .A => .B
  .B after 500ms => .C
  .C after 2s => .D
</>
<button on:click={go()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    expect(machineTestJs).toContain("declared .B => .C (after 500ms) succeeds");
    expect(machineTestJs).toContain("declared .C => .D (after 2000ms) succeeds");
  });

  test("temporal rule with labeled guard: guard coverage title carries (after Nms)", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Working, Timeout }
  @s: M = S.Idle
  const @allow: boolean = true
  function begin() { @s = S.Working }
}
< machine name=M for=S>
  .Idle => .Working
  .Working after 30s => .Timeout given (@allow) [timeoutAllowed]
</>
<button on:click={begin()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Exclusivity title for a guarded temporal rule
    expect(machineTestJs).toContain("declared .Working => .Timeout (guarded) (after 30000ms) succeeds when guard truthy");
    // Guard-coverage failing test title includes the temporal suffix
    expect(machineTestJs).toContain("guard [timeoutAllowed] on .Working => .Timeout (after 30000ms): rejected when guard falsy");
  });

  test("suite header emits the timer-lifecycle scope note when temporal rules exist", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @s: M = S.A
  function go() { @s = S.B }
}
< machine name=M for=S>
  .A after 10s => .B
</>
<button on:click={go()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Scope note present and correct
    expect(machineTestJs).toContain("Timer lifecycle");
    expect(machineTestJs).toContain("outside this suite's scope");
    expect(machineTestJs).toContain("hand-written integration tests");
  });

  test("non-temporal machine does NOT get the temporal-scope note", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @s: M = S.A
  function go() { @s = S.B }
}
< machine name=M for=S>
  .A => .B
</>
<button on:click={go()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // No temporal rule → no scope note
    expect(machineTestJs).not.toContain("Timer lifecycle");
  });

  test("temporal-rule suite runs cleanly under bun test", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Working, Done }
  @s: M = S.Idle
  function go() { @s = S.Working }
}
< machine name=M for=S>
  .Idle => .Working
  .Working after 1s => .Done
</>
<button on:click={go()}>go</>
</program>
`;
    const { machineTestJs } = compileWithFlag(src, true);
    expect(machineTestJs).not.toBeNull();
    const execDir = resolve(testDir, "_tmp_p5-exec");
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
      // 3 reachable variants × 3 variants = 9 exclusivity tests total.
      expect(combined).toContain("9 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit contract — hand-built registries, independent of the scrml pipeline.
// ---------------------------------------------------------------------------

describe("S26 §51.13 phase 5 — generateMachineTestJs temporal contract", () => {
  test("afterMs surfaces in exclusivity title", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null, afterMs: 1500 },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B (after 1500ms) succeeds"');
  });

  test("temporal + labeled guard: both annotations present", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "A", to: "B", guard: "@ok", label: "g", effectBody: null, afterMs: 2000 },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .B (guarded) (after 2000ms) succeeds when guard truthy"');
    expect(out).toContain('"guard [g] on .A => .B (after 2000ms): rejected when guard falsy"');
  });

  test("temporal-scope note appears only when a temporal rule is present", () => {
    const noTemporal = new Map();
    noTemporal.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null, afterMs: null },
      ],
    });
    const outA = generateMachineTestJs("/x/y.scrml", noTemporal, new Map());
    expect(outA).not.toContain("Timer lifecycle");

    const withTemporal = new Map();
    withTemporal.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null, afterMs: 1000 },
      ],
    });
    const outB = generateMachineTestJs("/x/y.scrml", withTemporal, new Map());
    expect(outB).toContain("Timer lifecycle");
  });

  test("mixed temporal + non-temporal rules: scope note appears, per-rule suffix correct", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null, afterMs: null },
        { from: "B", to: "C", guard: null, label: null, effectBody: null, afterMs: 500 },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain("Timer lifecycle");
    expect(out).toContain('"declared .A => .B succeeds"');
    expect(out).toContain('"declared .B => .C (after 500ms) succeeds"');
  });
});
