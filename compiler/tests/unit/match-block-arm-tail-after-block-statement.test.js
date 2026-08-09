/**
 * §18.5 block-arm lowering — the TAIL-SHAPE and NESTED-STATEMENT-FIDELITY axes
 * (S331). Both were unenumerated before this file.
 *
 * #469 lifted a block arm's tail across the value-position IIFE paths and #470
 * unified the tail CLASSIFIER (`_blockTailIsValueExpr`) to one predicate. Neither
 * touched SEGMENTATION, and the conformance cases both PRs added used
 * straight-line arm bodies (`{ const c = "green"; c }`), so two defects shipped:
 *
 *   A. `_splitBlockStatements` — the segmenter behind `planBlockArmLift`, and so
 *      behind both RAW-STRING routes — split only on `;` and newline at depth 0.
 *      A block-bodied statement's closing `}` is ALSO a statement boundary, and
 *      neither scrml nor JS requires a separator after it. So
 *      `{ let a = 0; for (…) { a = 1 } a }` split into TWO segments, the second
 *      being `for (…) { a = 1 } a` — headed by `for`, therefore (correctly)
 *      classified a statement, therefore never lifted. The value-returning IIFE
 *      fell off its end and the arm evaluated to `undefined`, which is not a
 *      scrml value (§42.1.1). The tail lifted fine the moment a `;` or newline
 *      preceded it, which is why this reads as position-dependent when it is
 *      really SEPARATOR-dependent.
 *
 *   B. `_emitForStmtWithTilde`'s two fallbacks (C-style header, reactive `@cell`
 *      iterable) called `emitForStmt(node)` with the OPTIONS ARGUMENT DROPPED.
 *      `declaredNames` died at that hop, so the `tilde-decl` reassignment guard —
 *      which keys exactly on `opts.declaredNames?.has(name)` — could never fire,
 *      and a nested bare `a = 1` emitted as a SHADOWING `const a = 1`. The loop
 *      then no longer wrote the outer `a`. The self-referencing spelling emitted
 *      `const a = a + 1`: a TDZ ReferenceError at RUNTIME that `node --check`
 *      accepts as valid syntax, which is why the value half of this coverage
 *      lives in executed conformance cases and not in a text assertion.
 *
 * SPEC §18.5 (governing): "A block arm is `{ statement* expression? }`. The
 * block's result is its **last expression**."
 *
 * The segmentation half is tested against `planBlockArmLift` directly because it
 * is the exported seam both raw-string routes share. The emission half is tested
 * through a real compile.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { planBlockArmLift } from "../../src/codegen/emit-logic.ts";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `mbtabs-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_mbtabs_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), validateEmit: true });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

const hardErrors = (r) => (r.errors ?? []).filter((e) => e && e.code !== undefined);

// ---------------------------------------------------------------------------
// Axis A — segmentation: a block statement's `}` ends a statement
// ---------------------------------------------------------------------------

describe("§18.5 segmentation — a block-bodied statement's `}` is a statement boundary", () => {
  // The defect shape, one spelling per block-statement head. Each has a leading
  // statement, a block-bodied statement, and a tail with NO separator before it.
  const LIFTS = [
    ["for", `let a = 0; for (const i of @items) { a = 1 } a`],
    ["if", `let a = 0; if (@n > 1) { a = 1 } a`],
    ["while", `let a = 0; while (a < 1) { a = 1 } a`],
    ["nested for", `let a = 0; for (const i of @items) { for (const j of @items) { a = 1 } } a`],
    ["match", `let a = 0; match @phase { .Idle :> { a = 1 } } a`],
    ["block stmt with an object literal inside", `let a = 0; for (const i of @items) { a = { v: 1 } } a`],
  ];

  for (const [label, inner] of LIFTS) {
    test(`lifts the tail after a \`${label}\` block statement with no separator`, () => {
      expect(planBlockArmLift(inner).tail).toBe("a");
    });
  }

  test("the same shapes already lifted when a `;` or newline preceded the tail — that is why the corpus never tripped it", () => {
    expect(planBlockArmLift(`let a = 0; for (const i of @items) { a = 1 }; a`).tail).toBe("a");
    expect(planBlockArmLift(`let a = 0; for (const i of @items) { a = 1 }\na`).tail).toBe("a");
  });

  test("a straight-line body still lifts (the control that #469/#470 covered)", () => {
    expect(planBlockArmLift(`const t = 1; t`).tail).toBe("t");
    expect(planBlockArmLift(`let a = 0; a = a + 1; a`).tail).toBe("a");
  });

  // The void direction is equally normative and must NOT be widened by the fix.
  test("a block statement with NO trailing expression stays §18.5 void", () => {
    expect(planBlockArmLift(`let a = 0; for (const i of @items) { a = 1 }`).tail).toBeNull();
  });

  test("a trailing ASSIGNMENT stays §18.5 void", () => {
    expect(planBlockArmLift(`let a = 0; a = 1`).tail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Axis A, counter-gates — the boundary must never TEAR a single statement
// ---------------------------------------------------------------------------

describe("§18.5 segmentation — a depth-0 `}` that does NOT end a statement", () => {
  // Splitting at the first `}` of any of these would cut one statement into two
  // invalid halves. This is the whole reason the boundary is gated three ways
  // rather than firing on every depth-0 `}`.
  const NO_TEAR = [
    ["if/else", `let a = 0; if (@n > 1) { a = 1 } else { a = 2 } a`],
    ["if/else-if/else", `let a = 0; if (@n > 1) { a = 1 } else if (@n > 0) { a = 2 } else { a = 3 } a`],
  ];

  for (const [label, inner] of NO_TEAR) {
    test(`does not tear \`${label}\` — the whole statement stays one segment`, () => {
      const plan = planBlockArmLift(inner);
      expect(plan.tail).toBe("a");
      // Exactly two leading segments: the decl and the ONE (unsplit) statement.
      expect(plan.leading.length).toBe(2);
      expect(plan.leading[1]).toContain("else");
    });
  }

  test("try/catch stays one segment", () => {
    const plan = planBlockArmLift(`let a = 0; try { a = 1 } catch (e) { a = 2 } a`);
    expect(plan.leading.length).toBe(2);
    expect(plan.leading[1]).toContain("catch");
  });

  // A `}` that an EXPRESSION continues off is never a boundary. These are gated
  // by the next-char whitelist, not by a blacklist, so an operator that nobody
  // enumerated still cannot split.
  test("an object-literal initializer is not split", () => {
    expect(planBlockArmLift(`const o = { a: 1 }; o.a`).leading).toEqual([`const o = { a: 1 }`]);
  });

  test("a member read off an object literal is not split", () => {
    expect(planBlockArmLift(`const v = { a: 1 }.a; v`).leading).toEqual([`const v = { a: 1 }.a`]);
  });

  test("an arrow-function initializer is not split", () => {
    expect(planBlockArmLift(`const f = () => { return 1 }; f()`).leading).toEqual([`const f = () => { return 1 }`]);
  });

  test("a brace inside a string literal is inert", () => {
    expect(planBlockArmLift(`let s = "} a = 9 {"; s`).tail).toBe("s");
  });

  // Invariant 46 / #463: the keyword fence is `(?![A-Za-z0-9_$])` and sits
  // OUTSIDE the alternation. A `\b` fence would also admit `$`-bearing
  // identifiers, which scrml allows.
  test("an identifier merely PREFIXED by a block keyword is not a block-statement head", () => {
    expect(planBlockArmLift(`let formatted = 0; formatted`).tail).toBe("formatted");
    expect(planBlockArmLift(`let iface = 0; iface`).tail).toBe("iface");
    expect(planBlockArmLift(`let matcher = 0; matcher`).tail).toBe("matcher");
  });

  /**
   * KNOWN RESIDUAL, pinned deliberately so it cannot drift silently.
   *
   * `do { … } while (c)` terminates on the `while` clause's `)`, not on a `}`,
   * so there is no depth-0 closing brace to hang the boundary on, and a `while`
   * following a `}` is genuinely ambiguous from text alone (do-while
   * continuation vs. a fresh sibling loop). This shape therefore still yields
   * §18.5 void where it should lift. It is UNCHANGED by this fix, not caused by
   * it, and the author-side workaround is a `;` or newline before the tail.
   *
   * If this is ever fixed, this expectation flips to `"a"` — that is the point
   * of pinning it.
   */
  test("RESIDUAL: a tail after a do-while is still not lifted (documented, not desired)", () => {
    expect(planBlockArmLift(`let a = 0; do { a = a + 1 } while (a < 3) a`).tail).toBeNull();
    // The separator spelling works, and is the workaround.
    expect(planBlockArmLift(`let a = 0; do { a = a + 1 } while (a < 3); a`).tail).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Axis B — nested-statement fidelity, asserted on real emitted output
// ---------------------------------------------------------------------------

describe("§18.5 nested-statement fidelity — a nested bare assignment stays an assignment", () => {
  const NESTED_ASSIGN_SRC = `\${
    function step(k: int) -> int {
        const r = match k {
            1 :> { let a = 0; for (const i of [1, 2]) { a = 1 } a }
            _ :> 9
        }
        return r
    }
}
<page><main><p id="v">\${ step(1) }</p></main></page>
`;

  test("emits an assignment, not a shadowing `const`, inside the nested block", () => {
    const r = compileSource(NESTED_ASSIGN_SRC, "nested-assign");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toBeTruthy();
    // The defect: a fresh binding that shadows the outer `a`.
    expect(r.clientJs).not.toMatch(/const\s+a\s*=\s*1\b/);
    // The correct lowering. (No `;` anchor — the raw-string routes emit the
    // statement inside the loop brace without one: `{ a = 1 }`.)
    expect(r.clientJs).toMatch(/(?<!const\s)(?<!let\s)\ba\s*=\s*1\b/);
  });

  const SELF_REF_SRC = `\${
    function step(k: int) -> int {
        const r = match k {
            1 :> { let a = 10; for (const i of [1, 2]) { a = a + 1 } a }
            _ :> 9
        }
        return r
    }
}
<page><main><p id="v">\${ step(1) }</p></main></page>
`;

  test("the self-referencing form does not emit a TDZ `const a = a + 1`", () => {
    const r = compileSource(SELF_REF_SRC, "self-ref");
    expect(hardErrors(r)).toEqual([]);
    // `node --check` ACCEPTS this shape, so the emitted-text assertion is the
    // only cheap gate; the runtime half is the executed conformance case.
    expect(r.clientJs).not.toMatch(/const\s+a\s*=\s*a\s*\+\s*1/);
    expect(r.clientJs).toMatch(/(?<!const\s)(?<!let\s)\ba\s*=\s*a\s*\+\s*1\b/);
  });
});

// ---------------------------------------------------------------------------
// Axis C — per-arm scope. Not observable by VALUE, so it is pinned on emission.
// ---------------------------------------------------------------------------

describe("§18.5 arm bodies are sibling SCOPES, not one shared scope", () => {
  /**
   * The local-decl route emitted every arm against ONE `declaredNames` set, so a
   * name declared in arm 1 was still "declared" when arm 2 was emitted, and arm
   * 2's own fresh `a = 5` lowered to a BARE assignment with no binding in scope.
   * In the emitted classic (non-strict) script that silently creates a GLOBAL
   * rather than throwing — so the rendered VALUE is still 5 and no conformance
   * `domAnchored` assertion can see it. Hence an emission assertion.
   */
  // VARIANT arms parse to `arm.structuredBody` (the AST-node route). This is the
  // route the per-arm set fixes.
  const SIBLING_VARIANT_SRC = `\${
    type Phase:enum = { Idle, Busy }
    <phase>: Phase = .Idle
    <out> = ""

    function pick() {
        const r = match @phase {
            .Idle :> { let a = 1; a }
            .Busy :> { a = 5; a }
        }
        @out = "" + r
    }
}
<page><main><p id="v">\${@out}</p><button onclick=pick()>go</button></main></page>
`;

  test("a name declared in one arm does not leak into a sibling arm (structured-body route)", () => {
    const r = compileSource(SIBLING_VARIANT_SRC, "sibling-scope");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toBeTruthy();
    // Arm 2 must open its OWN binding.
    expect(r.clientJs).toMatch(/const\s+a\s*=\s*5\s*;/);
    // The leak: a bare assignment to a name with no binding in that scope.
    expect(r.clientJs).not.toMatch(/(?<!const\s)(?<!let\s)\ba\s*=\s*5\s*;/);
  });

  /**
   * KNOWN RESIDUAL, pinned deliberately — the ROUTE-DEPENDENT half of this axis.
   *
   * LITERAL/wildcard arms do not produce `arm.structuredBody`; they stay a raw
   * SOURCE STRING and lower through `rewriteBlockBody`, which is text-preserving
   * and never makes a decl-vs-assignment decision at all. So a fresh `a = 5` in
   * an arm emits verbatim as a bare assignment with no binding in scope, exactly
   * as it did before this fix — the per-arm declared-name set cannot reach a
   * route that does not consult declared names.
   *
   * This is NOT a divergence introduced here: the raw-string routes never made
   * this decision. It is the pre-existing (a)/(b) input-axis split, and closing
   * it means giving the raw-string routes a decl-vs-assignment decision they do
   * not currently have — a separate change on routes that are correct on both
   * axes this dispatch was scoped to. Surfaced to PA rather than folded in.
   *
   * When it IS closed, the two expectations below flip.
   */
  const SIBLING_LITERAL_SRC = `\${
    function pick(k: int) -> int {
        const r = match k {
            1 :> { let a = 1; a }
            _ :> { a = 5; a }
        }
        return r
    }
}
<page><main><p id="v">\${ pick(2) }</p></main></page>
`;

  test("RESIDUAL: the raw-string arm route still emits an unbound bare assignment (documented, not desired)", () => {
    const r = compileSource(SIBLING_LITERAL_SRC, "sibling-scope-raw");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toBeTruthy();
    expect(r.clientJs).toMatch(/(?<!const\s)(?<!let\s)\ba\s*=\s*5\s*;/);
    expect(r.clientJs).not.toMatch(/const\s+a\s*=\s*5\s*;/);
  });
});
