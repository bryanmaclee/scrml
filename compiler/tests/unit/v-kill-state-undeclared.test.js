/**
 * V-kill (S123) — kill auto-state-cell synthesis from bare `@x = expr` writes.
 *
 * Per the auto-state-cell-synthesis deep-dive (2026-05-23 §6 verdict B), the
 * compiler pre-S123 silently synthesised a phantom state cell from every bare
 * `@name = expr` write in a fn / function / `${...}` body. SPEC §6.1.1 +
 * §6.1.3 + §6.2 require declarations via the structural form `<name>`; the
 * canonical form `@name` is read/write-only over a pre-declared cell. The
 * auto-synth path corrupted SYM PASS 1's cell-table (silent clobber on
 * `<x> = init` + later `@x = ...`) and admitted undeclared writes as legal.
 *
 * V-kill carve-out (deep-dive §6 + Approach-B follow-up): default-logic
 * auto-lift at `<program>` / `<page>` / `<channel>` body-top (`_synthetic`
 * marker present) STAYS legacy state-decl without the marker (Unit CC's
 * Option-2 enforcement territory). Meta `^{...}` body (blockContext "meta")
 * also stays legacy state-decl (BUG-META-6 dependency in dependency-graph.ts
 * + meta-checker.ts treats synth state-decl-in-meta as runtime @-writes;
 * changing the shape would ripple through DG/meta-eval/meta-checker).
 *
 * Implementation:
 *   - ast-builder.js (Simple reactive @x=expr branch): tags fn/function/${}
 *     body emissions with `_isReactiveAssign: true`. NOT tagged inside meta
 *     bodies (blockContext === "meta") or BS-synthesised default-logic lifts
 *     (parentBlock._synthetic === true).
 *   - symbol-table.ts PASS 1: skips registration for tagged state-decls
 *     (no phantom cell synth, no silent clobber).
 *   - symbol-table.ts PASS 3 walkResolveAtNames: fires E-STATE-UNDECLARED
 *     on tagged state-decls whose `name` does not resolve to a structural
 *     decl (or import binding) in scope.
 *
 * READ-side diagnostic deferred (V-kill §8 follow-up): firing
 * E-STATE-UNDECLARED on bare `@name` reads with no structural decl in scope
 * would surface false-positives across the engine corpus (`@ui` markup ref
 * vs `< engine name=UI ...>` register-as-`UI` mismatch — pre-existing
 * SYM-side engine var-name normalization issue, out of V-kill scope). The
 * primary V-kill safety win is the write-side fire; read-side is a normative
 * extension landed in a follow-up unit after engine var-name canonicalisation.
 *
 * Coverage (per brief §3):
 *   1. bare-WRITE without structural decl in fn body → E-STATE-UNDECLARED
 *   2. write-of-existing-decl in fn body → CLEAN (legal reassignment)
 *   3. read-of-existing-decl in fn body → CLEAN
 *   4. write-of-existing-decl in `${...}` user-written body → CLEAN
 *   5. default-logic body-top `@x = expr` at <program> body → CLEAN (Unit CC's territory)
 *
 * NOTE on the originally-prescribed case "bare-READ in fn body → E-STATE-UNDECLARED":
 *   Defer to V-kill §8 follow-up. The write-side covers the primary auto-synth
 *   kill; the read-side requires SYM engine var-name canonicalisation first.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = "/tmp/v-kill-state-undeclared-fixtures";
mkdirSync(FIXTURE_DIR, { recursive: true });

function compileSource(source, filename = "test.scrml") {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  };
}

describe("V-kill (S123) — E-STATE-UNDECLARED on bare @x = expr without structural decl", () => {
  test("Case 1 — bare-WRITE in fn body without prior decl fires E-STATE-UNDECLARED", () => {
    const source = `<program>
\${
  function increment() {
    @undecl = 42
  }
}
</>
`;
    const { errors } = compileSource(source, "case-1-bare-write.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBeGreaterThanOrEqual(1);
    expect(undeclared[0].message).toContain("@undecl");
    expect(undeclared[0].severity).toBe("error");
  });

  test("Case 2 — write-of-existing-decl in fn body is CLEAN (legal reassignment)", () => {
    const source = `<program>
\${
  <count> = 0
  function increment() {
    @count = @count + 1
  }
}
</>
`;
    const { errors } = compileSource(source, "case-2-write-of-existing.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 3 — read-of-existing-decl in fn body is CLEAN", () => {
    const source = `<program>
\${
  <count> = 0
  function getValue() {
    return @count + 1
  }
}
</>
`;
    const { errors } = compileSource(source, "case-3-read-of-existing.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 4 — write-of-existing-decl in user-written ${} body is CLEAN", () => {
    const source = `<program>
\${
  <count> = 0
}
\${
  @count = 5
}
</>
`;
    const { errors } = compileSource(source, "case-4-write-in-userlogic.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 5 — default-logic body-top @x = expr at <program> body stays CLEAN (Unit CC territory)", () => {
    // V-kill carve-out: bare `@x = expr` at the default-logic body-top of
    // `<program>` (BS lifts to synthetic logic block with `_synthetic: true`)
    // is OUT OF V-kill scope. Currently still emits state-decl (legacy
    // auto-synth path), registers a cell named `x` in file scope. Option-2
    // enforcement (the §6.1.1 normative requirement that even default-logic
    // body-top writes need structural decls) is Unit CC's territory — a
    // separate sequential dispatch after V-kill lands.
    const source = `<program>
@first = 0
</>
`;
    const { errors } = compileSource(source, "case-5-default-logic-toplevel.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });
});
