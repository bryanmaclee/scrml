/**
 * S27 regression — unit-variant enum transitions at runtime.
 *
 * Unit-variant enums emit as bare strings (`S.A = "A"`); the transition
 * guard IIFE extracts variant identity from its input. Prior to S27 the
 * extraction used `(__prev.variant != null ? __prev.variant : "*")`,
 * which for bare-string values returned `"*"` (since strings have no
 * `.variant` property), causing every unit-variant transition to miss
 * the table and throw E-ENGINE-001-RT. This test would have caught the
 * regression — none of the pre-S27 tests exercised the emitted runtime.
 *
 * Fixed in emit-machines.ts alongside S27-G1 audit-shape work: fallback
 * now cascades `__prev.variant → __prev → "*"` so bare-string enum
 * values resolve correctly.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { unwrapChunkScope } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-unit-variant");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJs = existsSync(resolve(outDir, "app.client.js"))
      ? readFileSync(resolve(outDir, "app.client.js"), "utf8")
      : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runAndInvokeAll(clientJs) {
  const userFns = extractUserFns(clientJs);
  const calls = userFns.map(n => `${n}();`).join("\n");
  const fnBody = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
    ${SCRML_RUNTIME}
    ${unwrapChunkScope(clientJs)}
    ${calls}
    return _scrml_state;
  `;
  // eslint-disable-next-line no-new-func
  return new Function(fnBody)();
}

describe("S27 regression — unit-variant enum transition at runtime", () => {
  test("simple .A => .B transition actually succeeds (no E-ENGINE-001-RT)", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Executing with a unit-variant enum must NOT throw. Before the fix,
    // this would throw E-ENGINE-001-RT because __key resolved to "*:*".
    const state = runAndInvokeAll(clientJs);
    expect(state.order).toBe("B");
    expect(state.log).toHaveLength(1);
    expect(state.log[0].from).toBe("A");
    expect(state.log[0].to).toBe("B");
  });

  test("multi-step unit-variant chain: A → B → C", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function next() {
    @order = S.B
    @order = S.C
  }
}
< machine name=M for=S>
  .A => .B
  .B => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compile(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const state = runAndInvokeAll(clientJs);
    expect(state.order).toBe("C");
    expect(state.log).toHaveLength(2);
  });

  test("illegal unit-variant transition still rejects (guarantees the fix didn't bypass validation)", () => {
    // S28: trivially-illegal transitions are now rejected at compile time
    // per §51.5.1 (target .C has no rule in the machine — no .C in any `to`
    // and no wildcard catch-all). Pre-S28 this test ran the code and
    // expected E-ENGINE-001-RT at runtime. The guarantee is identical
    // (the assignment is refused) but the surface is now compile-time.
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function illegal() { @order = S.C }
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const machineErrors = errors.filter(e => e.severity !== "warning" && e.code === "E-ENGINE-001");
    expect(machineErrors).toHaveLength(1);
    expect(machineErrors[0].message).toContain("targets variant .C");
    expect(machineErrors[0].message).toContain("§51.5.1");
  });
});
