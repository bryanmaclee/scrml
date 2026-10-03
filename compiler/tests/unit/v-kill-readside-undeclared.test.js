/**
 * bug-12-vkill READ-side E-STATE-UNDECLARED — POST-CE relocation (S192).
 *
 * The write-side V-kill fire (S123, v-kill-state-undeclared.test.js) caught
 * bare `@x = expr` writes with no structural decl. The READ-side was DEFERRED
 * (V-kill §8) because a per-file SYM walk could not see POST-CE surfaces: the
 * `<each>`/`<tableFor>` loop locals, engine boot cells (the §51.0.C `UI`/`ui`
 * mismatch), `<state>`-block sibling reads, markup-derived cells, and the
 * cross-FILE channel cell inlined by component-expansion (CE) post-SYM.
 *
 * S192 relocation: the fire moved to the TYPE-SYSTEM stage (type-system.ts:6240,
 * the logic-expr ident walker), which runs POST-CE and rebuilds a complete
 * `@name` resolution table over the expanded AST. All idiomatic read surfaces
 * resolve there (Phase-0 verified, agent a6ddcb97); a `@name` read resolving to
 * NEITHER a reactive cell, NOR a loop local, NOR an import binding is a genuine
 * undeclared-cell typo — the exact silent-bug class that produced the 7 flagship
 * `@currentCustomerEvents`/`@currentDriverEvents` typos at S192.
 *
 * Coverage:
 *   1. `${@typo}` read of an undeclared cell → E-STATE-UNDECLARED
 *   2. read of a `<state>`-block cell from a sibling fn → CLEAN
 *   3. `<each in=@items as item>` body reading an outer `@header` → CLEAN
 *   4. markup-DERIVED cell `const <badge> = <markup>` read via `${@badge}` → CLEAN
 *   5. component-def `const Name = <markup>` read via `${@Name}` → FIRES
 *      (S192 ruling: symmetric with the existing bare-path E-SCOPE-001;
 *       components instantiate via `<Name/>`, never read via `@Name`).
 *   6. `@.` contextual iteration sigil inside an `<each>` body → CLEAN (not undeclared)
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURE_DIR = join(tmpdir(), "v-kill-readside-undeclared-fixtures");
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

describe("bug-12-vkill (S192) — read-side E-STATE-UNDECLARED at TS (post-CE)", () => {
  test("Case 1 — `${@typo}` read of an undeclared cell fires E-STATE-UNDECLARED", () => {
    const source = `<program>
\${
  <count> = 0
  function show() {
    return @counnt + 1
  }
}
</>
`;
    const { errors } = compileSource(source, "case-1-typo-read.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBeGreaterThanOrEqual(1);
    expect(undeclared[0].message).toContain("@counnt");
  });

  test("Case 2 — read of a state-block cell from a sibling fn is CLEAN", () => {
    const source = `<program>
\${
  <count> = 0
  function double() {
    return @count + @count
  }
}
</>
`;
    const { errors } = compileSource(source, "case-2-sibling-fn-read.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 3 — `<each>` body reading an outer `@cell` is CLEAN", () => {
    const source = `<program>
\${
  <items> = ["a", "b"]
  <header> = "List"
}
<each in=@items as item>
  <li>\${item} in \${@header}</li>
</each>
</>
`;
    const { errors } = compileSource(source, "case-3-each-outer-cell.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 4 — markup-DERIVED cell read via `${@badge}` is CLEAN (idiomatic markup-value read)", () => {
    const source = `<program>
\${
  <user> = "Ada"
  const <badge> = <span>\${@user}</span>
}
<div>\${@badge}</div>
</>
`;
    const { errors } = compileSource(source, "case-4-markup-derived.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });

  test("Case 5 — component-def read via `${@Name}` FIRES (S192 ruling, symmetric with bare E-SCOPE-001)", () => {
    const source = `<program>
\${
  const Greeting = <span>hello</span>
}
<div>\${@Greeting}</div>
</>
`;
    const { errors } = compileSource(source, "case-5-component-def-read.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBeGreaterThanOrEqual(1);
    expect(undeclared[0].message).toContain("@Greeting");
  });

  test("Case 6 — `@.` contextual iteration sigil inside an `<each>` body is CLEAN", () => {
    const source = `<program>
\${
  <rows> = ["x", "y"]
}
<each in=@rows>
  <li>\${@.}</li>
</each>
</>
`;
    const { errors } = compileSource(source, "case-6-at-dot-each.scrml");
    const undeclared = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(undeclared.length).toBe(0);
  });
});
