/**
 * S25 gauntlet — effect block emission for non-guarded rules.
 *
 * Pre-S25, `emitTransitionGuard` in emit-machines.ts filtered effect rules
 * through a `guardRules` subset (rules with `given` guards only). This
 * silently dropped the effect body of any rule that had an effect block but
 * no `given` guard. Documented in S24 hand-off as a known pre-existing bug;
 * surfaced when writing audit-clause tests (hand-off §1 "Incidental
 * discoveries").
 *
 * Fix: `emitTransitionGuard` now receives the full rule list; the internal
 * filter for effect emission uses `r.effectBody` directly. Guard evaluation
 * is unchanged — unguarded rules are skipped there, as before.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-effect-${++tmpCounter}`) {
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
    });
    const clientJsPath = resolve(outDir, `${testName}.client.js`);
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §51 — effect block emission for non-guarded rules", () => {
  test("rule with effect block but no `given` → effect body emitted", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @trace = []
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B { @trace = @trace.concat(["A-to-B"]) }
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Effect body should be present in the generated JS guarded by the key.
    // S27: match-key is now __matchedKey (fallback-resolved) so wildcard
    // effect rules also fire correctly.
    expect(clientJs).toContain("Effect blocks");
    expect(clientJs).toContain('__matchedKey === "A:B"');
    expect(clientJs).toContain("A-to-B");
  });

  test("rule with effect block AND `given` guard → effect still emitted", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @trace = []
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B given (true) { @trace = @trace.concat(["guarded-effect"]) }
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("guarded-effect");
  });

  test("two rules, one effect-only and one guard-only → both emit correctly", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @trace = []
  function toB() { @order = S.B }
  function toC() { @order = S.C }
}
< machine name=M for=S>
  .A => .B { @trace = @trace.concat(["on-B"]) }
  .A => .C given (true)
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Effect-only rule's body present
    expect(clientJs).toContain("on-B");
    // Guard-only rule's guard check present (S27: __matchedKey).
    expect(clientJs).toContain('__matchedKey === "A:C"');
  });

  test("rule with no guard and no effect → neither section emits for this rule", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // No effect-blocks comment since no rule has an effect body.
    expect(clientJs).not.toContain("// Effect blocks");
    // No guard-evaluation since no rule has a `given`.
    expect(clientJs).not.toContain("// Guard evaluation");
    // But the base transition table lookup is still present.
    expect(clientJs).toContain("_scrml_reactive_set");
  });
});
