/**
 * S26 gauntlet — §51.13 phase 4: wildcard rules.
 *
 * Phase 4 allows `*` as the from- or to-variant in a machine rule. The
 * emitter and the inlined harness both honor the four-step fallback
 * chain used by emitTransitionGuard:
 *
 *   exact From:To  →  *:To  →  From:*  →  *:*
 *
 * Reachability is extended: wildcard-from rules fire from any already-
 * reached variant; wildcard-to rules expand the reachable set to every
 * variant declared on the governed enum.
 *
 * These tests lock in:
 *   - *:To rule makes every reachable variant able to reach To
 *   - From:* rule makes From able to reach every variant in the enum
 *   - *:* rule makes every pair declared
 *   - wildcard test titles note the matched key so the wildcard path is
 *     visible in the generated suite output
 *   - a concrete-specific rule preempts a less-specific wildcard rule
 *   - labeled guard on a wildcard rule still yields a failing-guard test
 *   - full pipeline: a machine with a wildcard rule compiles, emits the
 *     property-test file, and the emitted suite runs cleanly under bun
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
  const name = `s26-p4-${uniq}`;
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

describe("S26 §51.13 phase 4 — wildcards end-to-end", () => {
  test("`* => .Failed` makes every reachable variant succeed reaching .Failed", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Running, Done, Failed }
  @s: M = S.Idle
  function start() { @s = S.Running }
}
< machine name=M for=S>
  .Idle => .Running
  .Running => .Done
  * => .Failed
</>
<button on:click={start()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // Every reachable → .Failed pair is declared via the *:Failed rule and
    // its title notes the wildcard.
    expect(machineTestJs).toContain("declared .Idle => .Failed (via wildcard *:Failed) succeeds");
    expect(machineTestJs).toContain("declared .Running => .Failed (via wildcard *:Failed) succeeds");
    expect(machineTestJs).toContain("declared .Done => .Failed (via wildcard *:Failed) succeeds");
    // Exact rules are NOT tagged as wildcard-declared.
    expect(machineTestJs).toContain("declared .Idle => .Running succeeds");
    expect(machineTestJs).not.toContain("declared .Idle => .Running (via wildcard");
  });

  test("`.Done => *` makes .Done reach every variant in the enum", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @s: M = S.A
  function start() { @s = S.C }
}
< machine name=M for=S>
  .A => .C
  .C => *
</>
<button on:click={start()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // .C → every variant is declared via C:*
    expect(machineTestJs).toContain("declared .C => .A (via wildcard C:*) succeeds");
    expect(machineTestJs).toContain("declared .C => .B (via wildcard C:*) succeeds");
    expect(machineTestJs).toContain("declared .C => .C (via wildcard C:*) succeeds");
    // Because C reaches *, B is reachable — and B has no outgoing rule,
    // so B→A and B→C are undeclared.
    expect(machineTestJs).toContain("undeclared .B => .A rejected");
    expect(machineTestJs).toContain("undeclared .B => .C rejected");
  });

  test("concrete rule preempts less-specific wildcard rule", () => {
    // `.A => .B` (exact) is matched before `* => .B` (wildcard) per the
    // harness fallback chain, so the exact title should appear — not the
    // wildcard-declared title.
    const src = `<program>
\${
  type S:enum = { A, B }
  @s: M = S.A
  function start() { @s = S.B }
}
< machine name=M for=S>
  .A => .B
  * => .B
</>
<button on:click={start()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // .A→.B uses the exact rule (no "(via wildcard" suffix).
    expect(machineTestJs).toContain("declared .A => .B succeeds");
    expect(machineTestJs).not.toContain("declared .A => .B (via wildcard");
    // .B→.B uses the wildcard rule.
    expect(machineTestJs).toContain("declared .B => .B (via wildcard *:B) succeeds");
  });

  test("labeled guard on a wildcard rule yields a failing-guard test at a resolvable pair", () => {
    const src = `<program>
\${
  type S:enum = { Normal, Special, Panic }
  @s: M = S.Normal
  const @ok: boolean = true
  function go() { @s = S.Panic }
}
< machine name=M for=S>
  .Normal => .Special
  * => .Panic given (@ok) [emergency]
</>
<button on:click={go()}>go</>
</program>
`;
    const { errors, machineTestJs } = compileWithFlag(src, true);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(machineTestJs).not.toBeNull();
    // The wildcard-guarded rule gets a failing-guard test. The title
    // mentions the wildcard so the user sees which rule is under test.
    expect(machineTestJs).toContain("guard [emergency] on .* => .Panic");
    expect(machineTestJs).toContain("rejected when guard falsy");
    // The failing test keys guardResults on the wildcard table entry, not
    // the concrete input pair.
    expect(machineTestJs).toContain('{ "*:Panic": false }');
  });

  test("full pipeline: wildcard machine emits a suite that runs cleanly under bun test", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Running, Failed }
  @s: M = S.Idle
  function boom() { @s = S.Failed }
}
< machine name=M for=S>
  .Idle => .Running
  * => .Failed
</>
<button on:click={boom()}>boom</>
</program>
`;
    const { machineTestJs } = compileWithFlag(src, true);
    expect(machineTestJs).not.toBeNull();
    const execDir = resolve(testDir, "_tmp_p4-exec");
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
      // 3 variants × 3 = 9 exclusivity tests, all pass.
      expect(combined).toContain("9 pass");
      expect(combined).toContain("0 fail");
    } finally {
      if (existsSync(execDir)) rmSync(execDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unit contract — bypass scrml pipeline to pin generator behavior for
// wildcard registries assembled by hand.
// ---------------------------------------------------------------------------

describe("S26 §51.13 phase 4 — generateMachineTestJs wildcard contract", () => {
  test("`*:X` rule: reachable variants declare .V → .X via wildcard", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }, { name: "X" }] },
      rules: [
        { from: "A", to: "B", guard: null, label: null, effectBody: null },
        { from: "*", to: "X", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    // .A → .X resolves via *:X (not an exact rule).
    expect(out).toContain('"declared .A => .X (via wildcard *:X) succeeds"');
    expect(out).toContain('"declared .B => .X (via wildcard *:X) succeeds"');
    expect(out).toContain('"declared .X => .X (via wildcard *:X) succeeds"');
    // Exact .A → .B — no wildcard suffix.
    expect(out).toContain('"declared .A => .B succeeds"');
  });

  test("`X:*` rule: reachability expands to every governed variant", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "Start" }, { name: "Mid" }, { name: "End" }] },
      rules: [
        { from: "Start", to: "*", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "Start"]]));
    expect(out).not.toBeNull();
    // Start→* means Mid and End are both reachable. From each of them, no
    // outgoing rule exists → every pair is undeclared.
    expect(out).toContain('"undeclared .Mid => .Start rejected"');
    expect(out).toContain('"undeclared .End => .Mid rejected"');
  });

  test("`*:*` rule: every pair is declared via wildcard", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "*", to: "*", guard: null, label: null, effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"declared .A => .A (via wildcard *:*) succeeds"');
    expect(out).toContain('"declared .A => .B (via wildcard *:*) succeeds"');
    expect(out).toContain('"declared .B => .A (via wildcard *:*) succeeds"');
    expect(out).toContain('"declared .B => .B (via wildcard *:*) succeeds"');
    // No undeclared pairs since *:* covers everything.
    expect(out).not.toContain('undeclared ');
  });

  test("wildcard-guarded rule: failing test uses wildcard key for guardResults", () => {
    const registry = new Map();
    registry.set("M", {
      name: "M",
      governedType: { variants: [{ name: "A" }, { name: "B" }] },
      rules: [
        { from: "*", to: "B", guard: "@ok", label: "always", effectBody: null },
      ],
    });
    const out = generateMachineTestJs("/x/y.scrml", registry, new Map([["M", "A"]]));
    expect(out).not.toBeNull();
    expect(out).toContain('"guard [always] on .* => .B');
    expect(out).toContain('{ "*:B": false }');
  });
});
