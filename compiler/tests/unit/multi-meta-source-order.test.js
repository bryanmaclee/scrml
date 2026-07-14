/**
 * Multi-top-level `^{}` source-order — SPEC §22.3 normative test
 *
 * Ratified rule (2026-04-22 debate; appended to SPEC §22.3 as terminal
 * normative bullet): a scrml file MAY contain zero or more top-level `^{}`
 * meta blocks. Runtime blocks emit `_scrml_meta_effect` calls in source
 * order and execute in source order on DOMContentLoaded; each effect is
 * invoked and returns before the next is invoked.
 *
 * Motivation: 6nz (adopter) asked whether multiple top-level `^{}` blocks
 * could model "lifecycle stages." Compiler already accepts them; the debate
 * ratified SPEC permission without adding new syntax or keywords. This test
 * pins the observable emit behavior so a future refactor cannot accidentally
 * regress the ordering contract.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `multi-meta-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_multi_meta_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
  }
}

const THREE_RUNTIME_SRC = `<program>
\${
  @log = []
  function recordPhase(label: string) {
    @log = [...@log, label]
  }
}

^{ recordPhase("alpha") }
^{ recordPhase("beta") }
^{ recordPhase("gamma") }

<p>log: \${@log.join(",")}</p>
</program>`;

const ZERO_BLOCK_SRC = `<program>
\${
  @count = 0
}
<p>\${@count}</p>
</program>`;

describe("Multi-top-level `^{}` source-order (SPEC §22.3)", () => {
  test("three runtime blocks emit three _scrml_meta_effect calls", () => {
    const { clientJs } = compileSource(THREE_RUNTIME_SRC, "three-runtime");
    expect(clientJs).toBeTruthy();
    const matches = clientJs.match(/_scrml_meta_effect\("_scrml_meta_\d+"/g) || [];
    expect(matches.length).toBe(3);
  });

  test("meta_effect calls appear in source order (alpha, beta, gamma)", () => {
    const { clientJs } = compileSource(THREE_RUNTIME_SRC, "source-order");
    // Find the order of the three recordPhase argument strings in the emit.
    const alphaIdx = clientJs.indexOf(`recordPhase`);
    expect(alphaIdx).toBeGreaterThan(-1);
    const labels = ["alpha", "beta", "gamma"];
    const positions = labels.map(l => clientJs.indexOf(`"${l}"`));
    positions.forEach(p => expect(p).toBeGreaterThan(-1));
    // Positions strictly ascending — source-order preserved in emit.
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  test("each block gets a unique _scrml_meta_N scopeId", () => {
    const { clientJs } = compileSource(THREE_RUNTIME_SRC, "unique-ids");
    const idMatches = [...clientJs.matchAll(/_scrml_meta_effect\("(_scrml_meta_\d+)"/g)];
    const ids = idMatches.map(m => m[1]);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
  });

  test("zero-block file compiles without emitting _scrml_meta_effect", () => {
    const { clientJs, errors } = compileSource(ZERO_BLOCK_SRC, "zero-blocks");
    expect(errors.filter(e => e.severity === "error" || e.severity === undefined).length).toBe(0);
    expect(clientJs).toBeTruthy();
    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });

  test("single-block file emits exactly one meta_effect (baseline)", () => {
    const src = `<program>
\${
  @ready = false
  function markReady() { @ready = true }
}
^{ markReady() }
<p>ready: \${@ready}</p>
</program>`;
    const { clientJs } = compileSource(src, "single-block");
    const matches = clientJs.match(/_scrml_meta_effect\(/g) || [];
    expect(matches.length).toBe(1);
  });

  test("lifecycle-stage idiom compiles without new keywords (no `^init{}` / `^mount{}`)", () => {
    // Debate verdict: name the functions, don't invent keywords.
    const src = `<program>
\${
  @phase = "boot"
  function init()  { @phase = "init-done"  }
  function mount() { @phase = "mount-done" }
}
^{ init() }
^{ mount() }
<p>phase: \${@phase}</p>
</program>`;
    const { clientJs, errors } = compileSource(src, "lifecycle-idiom");
    expect(errors.filter(e => e.severity === "error" || e.severity === undefined).length).toBe(0);
    expect(clientJs).toBeTruthy();
    const matches = clientJs.match(/_scrml_meta_effect\(/g) || [];
    expect(matches.length).toBe(2);
    // Verify init call is emitted before mount call (names get mangled via
    // genVar; search for the mangled invocation inside the meta_effect bodies).
    const initInvokeIdx = clientJs.search(/_scrml_init_\d+\(\)/);
    const mountInvokeIdx = clientJs.search(/_scrml_mount_\d+\(\)/);
    expect(initInvokeIdx).toBeGreaterThan(-1);
    expect(mountInvokeIdx).toBeGreaterThan(initInvokeIdx);
  });
});
