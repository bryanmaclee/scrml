/**
 * Unit CC (S123) — RETIRED at S441.
 *
 * S123 made a bare `@x = expr` at a `<program>` / `<page>` / `<channel>` body-top
 * an error (E-WRITE-NOT-IN-LOGIC-CONTEXT: "writes are logic; logic goes in
 * `${...}`"). S441 made that whole body CODE (SPEC §40.8 S441 bullet — loose
 * prose is not allowed; displayed text is declared), so a bare write there is an
 * ordinary write in a logic context and the code is retired:
 *   ruling: user-voice-scrml.md S441 "declared-prose implementation: yes to all
 *   four", item 4 — "E-WRITE-NOT-IN-LOGIC-CONTEXT is RETIRED for
 *   <program>/<page>/<channel> bodies".
 * The per-file exemption list (`unit-cc-exemption-list.json`, empty) and its
 * loader (`default-logic-exemption.ts`) had no other consumer and were removed.
 *
 * This file now pins the retirement: the body-top write compiles exactly as the
 * same write inside an explicit `${ … }` at that position does, and it RUNS
 * (Case 1b). The V-kill regression cases (4, 6, 7) are unchanged.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURE_DIR = join(tmpdir(), "unit-cc-write-at-body-top-fixtures");
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

describe("Unit CC (S123) — E-WRITE-NOT-IN-LOGIC-CONTEXT is RETIRED (S441): a bare body-top write is ordinary logic", () => {
  test("Case 1 — bare `@x = 5` at <program> body-top no longer fires E-WRITE-NOT-IN-LOGIC-CONTEXT", () => {
    const source = `<program>
<count> = 0
@count = 5
<p>\${@count}</p>
</>
`;
    const { errors } = compileSource(source, "case-1-bare-at-body-top.scrml");
    expect(errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT").length).toBe(0);
    expect(errors.length).toBe(0);
  });

  test("Case 1b — the bare body-top write compiles to the SAME client JS as the explicit `${ }` form", () => {
    const build = (name, body) => {
      const f = join(FIXTURE_DIR, name);
      writeFileSync(f, `<program>\n<count> = 0\n${body}\n<p>\${@count}</p>\n</>\n`);
      const r = compileScrml({ inputFiles: [f], outputDir: join(FIXTURE_DIR, "dist-1b"), write: false });
      return { errors: r.errors ?? [], js: [...(r.outputs?.values?.() ?? [])].map((o) => o.clientJs ?? "").join("\n") };
    };
    const bare = build("case-1b.scrml", "@count = 5");
    const explicit = build("case-1b.scrml", "${ @count = 5 }");
    expect(bare.errors.length).toBe(0);
    expect(bare.js).toContain("5");
    expect(bare.js).toBe(explicit.js);
  });

  test("Case 2 — `${ @x = 5 }` at <program> body-top is CLEAN (write in logic ctx)", () => {
    // Inner ${} is NOT synthetic (user-written), so the write inside is V-kill
    // territory; with prior <x> = 0 decl, V-kill is silent.
    const source = `<program>
<count> = 0
\${ @count = 5 }
</>
`;
    const { errors } = compileSource(source, "case-2-explicit-logic-block.scrml");
    const unitCC = errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT");
    expect(unitCC.length).toBe(0);
    const vKill = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(vKill.length).toBe(0);
  });

  test("Case 3 — `<x> = 0` at <program> body-top is CLEAN (auto-lift declaration)", () => {
    const source = `<program>
<count> = 0
</>
`;
    const { errors } = compileSource(source, "case-3-structural-decl.scrml");
    const unitCC = errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT");
    expect(unitCC.length).toBe(0);
  });

  test("Case 4 — bare `@x = 5` inside fn body fires E-STATE-UNDECLARED (V-kill, NOT Unit CC)", () => {
    // The write is INSIDE an explicit ${...} wrapper (NOT synthetic). V-kill
    // fires; Unit CC does not.
    const source = `<program>
\${
  function increment() {
    @undecl = 42
  }
}
</>
`;
    const { errors } = compileSource(source, "case-4-fn-body-vkill.scrml");
    const unitCC = errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT");
    expect(unitCC.length).toBe(0);
    const vKill = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(vKill.length).toBeGreaterThanOrEqual(1);
    expect(vKill[0].message).toContain("@undecl");
  });

  test("Case 6 — V-kill carve-out preserved: `@x = 5` INSIDE a function body whose enclosing wrapper is synthetic does NOT fire Unit CC", () => {
    // `function increment()` auto-lifts to a synthetic `${}` wrapper at
    // body-top of <program>. The write `@count = ...` inside the function
    // body is nested (_nestedBlockDepth > 0) so it does NOT carry the Unit CC
    // tag. V-kill's pre-S123 default-logic-lift carve-out is INTENTIONALLY
    // PRESERVED at this site to keep blast radius narrow — legacy phantom-
    // synth still runs for nested writes under synthetic wrappers. Tightening
    // V-kill's discrimination is a separate follow-up.
    //
    // This case is the regression-guard: writes inside function bodies under
    // synthetic wrappers must NEITHER fire Unit CC NOR break the legacy
    // auto-synth path (which the 110-file unmigrated corpus depends on).
    const source = `<program>
function increment() {
  @undecl = 42
}
</>
`;
    const { errors } = compileSource(source, "case-6-vkill-nested-under-synthetic.scrml");
    const unitCC = errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT");
    expect(unitCC.length).toBe(0);
    // V-kill is also silent here (carve-out preserved at the parseOneStatement
    // site). The phantom cell IS synthesised (legacy behavior); the user
    // surface this closes is the body-top case, NOT the nested case.
    const vKill = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(vKill.length).toBe(0);
  });

  test("Case 7 — combined: structural decl + function-body legal reassignment is CLEAN", () => {
    // The same shape as Case 6, but with a structural `<count>` decl in scope
    // — no Unit CC fire (write nested under synthetic, depth > 0) and no
    // V-kill fire (the V-kill carve-out for synthetic wrappers preserves the
    // legacy state-decl path which silently registers/reuses the cell).
    const source = `<program>
<count> = 0
function increment() {
  @count = @count + 1
}
</>
`;
    const { errors } = compileSource(source, "case-7-legal-reassignment.scrml");
    const unitCC = errors.filter(e => e.code === "E-WRITE-NOT-IN-LOGIC-CONTEXT");
    expect(unitCC.length).toBe(0);
    const vKill = errors.filter(e => e.code === "E-STATE-UNDECLARED");
    expect(vKill.length).toBe(0);
  });

});
