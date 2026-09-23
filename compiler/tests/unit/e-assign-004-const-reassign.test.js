/**
 * §50.8.5 E-ASSIGN-004 — Assignment to a `const` Variable, STATEMENT form.
 *
 * S422 ruling (bryan, verbatim):
 *   "narrow ruling 1 and build E-ASSIGN-004"
 *   "confirmed. bare naming is const, mutation needs let. widen it."
 *
 * The rule: a binding created WITHOUT `let` is a `const` binding — whether the
 * `const` keyword is written or not. Reassigning it is E-ASSIGN-004. `let` is
 * the only escape.
 *
 * SPEC §50.8.5, closing sentence (SPEC.md:28032):
 *   "This error applies equally to statement-form (`x = newValue` where `x` is
 *    `const`) and expression-form assignment."
 *
 * SPEC §50.3.5 (SPEC.md:27869):
 *   "`const` variables are immutable; assigning to a `const` as an expression is
 *    E-ASSIGN-004 (same error as a statement-level `const` reassignment)."
 *
 * SPEC §50.12 (SPEC.md:28201) — why compound assignment is in scope:
 *   "`+=`, `-=`, `*=`, `/=`, `%=` are currently statement-only in scrml."
 *
 * ⚑ BEFORE this landed, `grep -rn 'E-ASSIGN' compiler/src/` returned ZERO
 * (control: 123 for `E-SCOPE-001`). The whole family was unimplemented, so every
 * row of the matrix below was wrong — three silently, three under a diagnostic
 * that was about something else:
 *
 *   const x = 1 ; x = 2       → clean; shipped a runtime `TypeError`
 *   const x = 1 ; x += 1      → clean; shipped a runtime `TypeError`
 *   const x = 1 ; x = x + 1   → clean / E-CODEGEN-INVALID-LOGIC
 *   x = 1 ; x = 2             → E-MU-001 (reports the binding unused)
 *   x = 1 ; x += 1            → clean
 *   x = 1 ; x = x + 1         → E-CODEGEN-INVALID-LOGIC ("this is a compiler
 *                               defect. Please report it." — for THEIR source)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWholeScrml(source, testName = `e-assign-004-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    const fatalErrors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    return { errors: [...fatalErrors, ...warnings], fatalErrors, warnings };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (errors) => errors.map(e => e.code);

const SHELL = `<program>
    <p>hello</>
</>`;

/** Wrap two statements in a top-level `${ }` logic block. */
const topLevel = (decl, mutation) => `\${
    ${decl}
    ${mutation}
}
${SHELL}`;

/**
 * Wrap two statements in a `function` body. The two positions lower through
 * DIFFERENT codegen paths, so every row is pinned at both.
 */
const inFunction = (decl, mutation) => `\${
    function f() {
        ${decl}
        ${mutation}
        return x
    }
}
${SHELL}`;

// ---------------------------------------------------------------------------
// REJECT — all six shapes are E-ASSIGN-004, at both statement positions.
// ---------------------------------------------------------------------------

describe("§50.8.5 E-ASSIGN-004 — reassignment of an immutable binding REFUSES", () => {

  const rejectRows = [
    ["explicit const, plain assignment",    "const x = 1", "x = 2"],
    ["explicit const, compound assignment", "const x = 1", "x += 1"],
    ["explicit const, self-referencing",    "const x = 1", "x = x + 1"],
    ["bare naming, plain assignment",       "x = 1",       "x = 2"],
    ["bare naming, compound assignment",    "x = 1",       "x += 1"],
    ["bare naming, self-referencing",       "x = 1",       "x = x + 1"],
  ];

  for (const [label, decl, mutation] of rejectRows) {
    test(`top-level \${}: ${label} — ${decl}; ${mutation}`, () => {
      const { errors } = compileWholeScrml(topLevel(decl, mutation));
      expect(codes(errors)).toContain("E-ASSIGN-004");
    });

    test(`function body: ${label} — ${decl}; ${mutation}`, () => {
      const { errors } = compileWholeScrml(inFunction(decl, mutation));
      expect(codes(errors)).toContain("E-ASSIGN-004");
    });
  }

  test("the message names the binding and prescribes `let` (SPEC §50.8.5 message block)", () => {
    const { errors } = compileWholeScrml(inFunction("const x = 1", "x = 2"));
    const diag = errors.find(e => e.code === "E-ASSIGN-004");
    expect(diag).toBeDefined();
    expect(diag.message).toContain("`x`");
    expect(diag.message).toContain("is declared `const` and cannot be reassigned");
    expect(diag.message).toContain("Use `let` if the variable needs to be updated after initialization");
  });

  test("E-ASSIGN-004 is fatal-grade, not a warning", () => {
    const { fatalErrors } = compileWholeScrml(inFunction("const x = 1", "x = 2"));
    expect(codes(fatalErrors)).toContain("E-ASSIGN-004");
  });

  test("every reassignment is reported, not just the first", () => {
    const src = `\${
    function f() {
        const x = 1
        x = 2
        x = 3
        return x
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors).filter(c => c === "E-ASSIGN-004")).toHaveLength(2);
  });

  test("reassignment inside a nested block still fires", () => {
    const src = `\${
    function f(flag) {
        const x = 1
        if (flag) {
            x = 2
        }
        return x
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });

  test("a destructured `const` binding is immutable too", () => {
    const src = `\${
    function f(input) {
        const { a, b } = input
        a = 9
        return a + b
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).toContain("E-ASSIGN-004");
  });
});

// ---------------------------------------------------------------------------
// ACCEPT — `let` is the escape, and it is the ONLY escape.
// ---------------------------------------------------------------------------

describe("§50.8.5 E-ASSIGN-004 — `let` is the escape and stays clean", () => {

  const acceptRows = [
    ["plain assignment",    "let x = 1", "x = 2"],
    ["compound assignment", "let x = 1", "x += 1"],
    ["self-referencing",    "let x = 1", "x = x + 1"],
  ];

  for (const [label, decl, mutation] of acceptRows) {
    test(`function body: ${label} — ${decl}; ${mutation}`, () => {
      const { errors } = compileWholeScrml(inFunction(decl, mutation));
      expect(codes(errors)).not.toContain("E-ASSIGN-004");
    });

    // ⚑ REGRESSION PIN — the escape must not expire after ONE use.
    //
    // The first build of this check rebound the name with `isConst: true` on
    // every keywordless assignment, including one that merely REASSIGNED an
    // existing `let`. That silently converted the `let` into a `const`, so the
    // FIRST reassignment compiled and the SECOND was rejected. The whole
    // one-row matrix above passed while that was live, because every row
    // assigned exactly once.
    //
    // Caught by the pre-commit hook on `stdlib/compiler/meta-checker.scrml`,
    // which assigns a single `let ids` three times. `let` is the ONLY escape
    // the S422 ruling grants; an escape that works once is not an escape.
    test(`function body: ${label} REPEATED — ${decl}; ${mutation}; ${mutation}`, () => {
      const { errors } = compileWholeScrml(inFunction(decl, `${mutation}\n        ${mutation}`));
      expect(codes(errors)).not.toContain("E-ASSIGN-004");
    });

    // ⚑ The top-level position is pinned for E-ASSIGN-004 ONLY, not for a clean
    // compile. A PRE-EXISTING codegen defect (verified on the unmodified tree at
    // 5c021b0e, so it predates E-ASSIGN-004) makes `let x = 1; x = 2` at top-level
    // `${}` emit a DUPLICATE declaration — `let x = 1; const x = 2;` — which the
    // default `--validate-emit` gate reports as E-CODEGEN-INVALID-LOGIC. Root
    // cause: the top-level logic `emitOpts` at emit-reactive-wiring.ts:358 carries
    // NO `declaredNames` set, so emit-logic.ts's tilde-decl reassignment guard
    // (`opts.declaredNames?.has(node.name)`) can never fire there. Same class as
    // the S415 fix for match-arm bodies (emit-logic.ts ~5399).
    //
    // This assertion pins ONLY the part E-ASSIGN-004 owns. When the codegen defect
    // is fixed, this test keeps passing and the `let` escape becomes genuinely
    // clean at top level too.
    test(`top-level \${}: ${label} — ${decl}; ${mutation} — no E-ASSIGN-004`, () => {
      const { errors } = compileWholeScrml(topLevel(decl, mutation));
      expect(codes(errors)).not.toContain("E-ASSIGN-004");
    });

    test(`top-level \${}: ${label} REPEATED — ${decl}; ${mutation}; ${mutation} — no E-ASSIGN-004`, () => {
      const { errors } = compileWholeScrml(topLevel(decl, `${mutation}\n    ${mutation}`));
      expect(codes(errors)).not.toContain("E-ASSIGN-004");
    });
  }

  test("a single `let` assigned three times stays clean (the meta-checker.scrml shape)", () => {
    // stdlib/compiler/meta-checker.scrml declares one `let ids` and assigns it
    // three times. This is the exact shape the pre-commit hook rejected when the
    // rebind guard was missing.
    const src = `\${
    function collect(a, b, c) {
        let ids = []
        ids = a
        ids = b
        ids = c
        return ids
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("an uninitialised `let` assigned twice stays clean", () => {
    const src = `\${
    function f(a, b) {
        let ids
        ids = a
        ids = b
        return ids
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("a `let` mutated inside a loop stays clean across iterations", () => {
    const src = `\${
    function f(items) {
        let total = 0
        for (item of items) {
            total = total + item
            total = total * 2
        }
        return total
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });
});

// ---------------------------------------------------------------------------
// NON-FIRE BOUNDARIES — shapes that look adjacent but are NOT reassignment of
// an immutable binding. Each is pinned so a later widening is visible as a
// deliberate change to this file rather than a silent behaviour drift.
// ---------------------------------------------------------------------------

describe("§50.8.5 E-ASSIGN-004 — non-fire boundaries", () => {

  test("property mutation through a `const` binding is legal (const freezes the BINDING, not the value)", () => {
    const src = `\${
    function f() {
        const obj = { a: 1 }
        obj.a = 2
        return obj
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("a function PARAMETER is a valid assignment target (§50.3.5 names it alongside `let`)", () => {
    const src = `\${
    function f(p) {
        p = 3
        return p
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("a reactive cell write is not a `const` reassignment", () => {
    const src = `<count> = 0
\${
    function bump() {
        @count = @count + 1
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("an inner `let` shadowing an outer `const` is a fresh mutable binding", () => {
    const src = `\${
    const x = 1
    function f() {
        let x = 5
        x = 6
        return x
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("same name declared `const` in two SIBLING function scopes is two bindings, not a reassignment", () => {
    const src = `\${
    function f() {
        const x = 1
        return x
    }
    function g() {
        const x = 2
        return x
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("a `let`-bound loop accumulator is mutable", () => {
    const src = `\${
    function f(items) {
        let total = 0
        for (item of items) {
            total = total + item
        }
        return total
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });

  test("EXPRESSION-position assignment does not fire — that is the other half of §50.8.5, still unbuilt", () => {
    const src = `\${
    function g(v) { return v }
    function f() {
        const x = 1
        return g((x = 2))
    }
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
  });
});

// ---------------------------------------------------------------------------
// E-MU-001 CO-FIRING — this dispatch changes NOTHING about E-MU-001.
// ---------------------------------------------------------------------------

describe("§50.8.5 E-ASSIGN-004 — co-fires with E-MU-001, and does not alter it", () => {

  test("`x = 1; x = 2` reports the const violation; E-MU-001 is left exactly as it was", () => {
    // Both conditions genuinely hold at once: the second statement reassigns a
    // `const` binding, AND the must-use tracker separately sees the first write
    // was never read.
    //
    // An earlier revision of this dispatch SUPPRESSED E-MU-001 here, on the
    // reasoning that the const violation is the cause and the unusedness the
    // consequence. That suppression is removed. bryan ruled dpa-047 call 3 at
    // S422 — "lint first, hard error later if its the right move." — which puts
    // unused-binding on its own lint arc. A lint alongside a hard error is
    // coherent, so there is nothing to arbitrate and E-MU-001's severity,
    // population and `_`-prefix hatch are untouched by this dispatch.
    const { errors } = compileWholeScrml(topLevel("x = 1", "x = 2"));
    expect(codes(errors)).toContain("E-ASSIGN-004");
    expect(codes(errors)).toContain("E-MU-001");
  });

  test("E-MU-001 still fires independently on a binding E-ASSIGN-004 never touched", () => {
    const src = `\${
    unrelated = 99
}
${SHELL}`;
    const { errors } = compileWholeScrml(src);
    expect(codes(errors)).not.toContain("E-ASSIGN-004");
    expect(codes(errors)).toContain("E-MU-001");
  });
});
