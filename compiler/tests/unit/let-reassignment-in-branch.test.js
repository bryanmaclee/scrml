/**
 * let-reassignment-in-branch.test.js — let + conditional reassignment codegen
 *
 * Regression: 6nz inbound 2026-04-20 Bug B + Bug F.
 *
 * scrml's bare `name = expr` syntax (no keyword) parses as a tilde-decl
 * (must-use derived variable) at the AST level. The codegen path in
 * emit-logic.ts's case "tilde-decl" distinguishes first declaration from
 * reassignment by consulting `opts.declaredNames`. A let-decl `let x = ...`
 * adds `x` to declaredNames; a following bare `x = ...` sees the name in
 * the set and emits `x = expr;` (reassignment) instead of `const x = expr;`
 * (first binding) or `_scrml_derived_declare("x", ...)` (derived reactive).
 *
 * The bug: IfOpts / forStmt / whileStmt did not accept or thread
 * `declaredNames`. Nested bodies always received an empty `declaredNames`,
 * so every reassignment inside an `if`/`else`/`for`/`while` was treated
 * as a first-binding — producing invisible shadows (Bug B) or spurious
 * derived-reactive registrations (Bug F).
 *
 * Coverage:
 *   §1  Bug B repro: `let x = A; if (c) x = B` — inner branch emits `x = B;` (not `const x = B`)
 *   §2  Bug B else branch: `else if` also emits reassignment
 *   §3  Bug F repro: `let next = []; for ... if ... else next = [...next, @var]` — plain reassignment
 *   §4  Bug F (with reactive RHS): does NOT emit _scrml_derived_declare for outer-declared let
 *   §5  Negative: bare `name = expr` with NO outer let still emits a new binding (tilde-decl path)
 *   §6  Nested — reassignment inside if-inside-for-inside-function
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll } from "bun:test";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/let-reassign");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let bugB, bugF, bugFReactive, negative, nested;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  bugB = fix("bug-b.scrml", `<program>
\${
  @result = "?"
  function classify(n: number) {
    let label = "TAP"
    if (n > 5) {
      label = "HOLD"
    } else if (n > 0) {
      label = "ROLL"
    }
    @result = label
  }
}
<button onclick=classify(10)>10</button>
</program>
`);

  bugF = fix("bug-f.scrml", `<program>
\${
  @items = []
  function runF() {
    let next = []
    for (let i = 0; i < 3; i = i + 1) {
      if (i == 0) {
      } else if (i < 2) {
        next = [...next, "a"]
      } else {
        next = [...next, "b"]
      }
    }
    @items = next
  }
}
<button onclick=runF()>run</button>
</program>
`);

  bugFReactive = fix("bug-f-reactive.scrml", `<program>
\${
  @pressed = []
  function runR() {
    let next = []
    for (let i = 0; i < @pressed.length; i = i + 1) {
      if (i == 0) {
      } else {
        next = [...next, @pressed[i]]
      }
    }
    @pressed = next
  }
}
<button onclick=runR()>run</button>
</program>
`);

  negative = fix("negative.scrml", `<program>
\${
  @out = 0
  function runN() {
    firstUse = 5
    @out = firstUse
  }
}
<button onclick=runN()>run</button>
</program>
`);

  nested = fix("nested.scrml", `<program>
\${
  @log = ""
  function runNest() {
    let s = ""
    for (let i = 0; i < 2; i = i + 1) {
      if (i == 0) {
        s = "first"
      } else {
        s = "second"
      }
    }
    @log = s
  }
}
<button onclick=runNest()>run</button>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  const result = compileScrml({
    inputFiles: [path],
    outputDir: FIXTURE_OUTPUT,
    write: false,
  });
  return result;
}

// ---------------------------------------------------------------------------
// §1: Bug B repro — inner branch emits reassignment, not const shadow
// ---------------------------------------------------------------------------

describe("§1: Bug B — `let x = A; if (c) x = B` emits reassignment", () => {
  test("compile succeeds", () => {
    const result = compile(bugB);
    expect(result.errors).toEqual([]);
  });

  test("if-branch body is `label = \"HOLD\"` (no `const label`)", () => {
    const result = compile(bugB);
    const js = foldChunkNamespacing(result.outputs.get(bugB).clientJs);
    // Reassignment, not a new const binding
    expect(js).toMatch(/\blabel\s*=\s*"HOLD"/);
    expect(js).not.toMatch(/const\s+label\s*=\s*"HOLD"/);
  });

  test("else-if branch body is `label = \"ROLL\"` (no `const label`)", () => {
    const result = compile(bugB);
    const js = foldChunkNamespacing(result.outputs.get(bugB).clientJs);
    expect(js).toMatch(/\blabel\s*=\s*"ROLL"/);
    expect(js).not.toMatch(/const\s+label\s*=\s*"ROLL"/);
  });

  test("the outer let declaration is still there", () => {
    const result = compile(bugB);
    const js = foldChunkNamespacing(result.outputs.get(bugB).clientJs);
    expect(js).toMatch(/let\s+label\s*=\s*"TAP"/);
  });
});

// ---------------------------------------------------------------------------
// §2: Bug F repro (non-reactive RHS) — for + if + else reassignment
// ---------------------------------------------------------------------------

describe("§2: Bug F — `let next = []` with conditional reassignment emits plain reassignment", () => {
  test("compile succeeds", () => {
    const result = compile(bugF);
    expect(result.errors).toEqual([]);
  });

  test("reassignment inside for-if-else branches is plain assignment", () => {
    const result = compile(bugF);
    const js = foldChunkNamespacing(result.outputs.get(bugF).clientJs);
    expect(js).toMatch(/\bnext\s*=\s*\[\.\.\.next,\s*"a"\]/);
    expect(js).toMatch(/\bnext\s*=\s*\[\.\.\.next,\s*"b"\]/);
  });

  test("does NOT emit _scrml_derived_declare for the local `next`", () => {
    const result = compile(bugF);
    const js = foldChunkNamespacing(result.outputs.get(bugF).clientJs);
    expect(js).not.toContain('_scrml_derived_declare("next"');
    expect(js).not.toContain('_scrml_derived_subscribe("next"');
  });
});

// ---------------------------------------------------------------------------
// §3: Bug F with reactive RHS — should still be plain reassignment
// ---------------------------------------------------------------------------

describe("§3: Bug F — reassignment with @reactive in RHS stays plain", () => {
  test("reassignment of outer `let next` referencing @pressed is still reassignment", () => {
    const result = compile(bugFReactive);
    expect(result.errors).toEqual([]);
    const js = foldChunkNamespacing(result.outputs.get(bugFReactive).clientJs);
    // The critical regression: local `let next` must NOT be converted to
    // derived-reactive registration just because RHS references @pressed.
    expect(js).not.toContain('_scrml_derived_declare("next"');
    expect(js).not.toContain('_scrml_derived_subscribe("next"');
    // And reassignment form is present
    expect(js).toMatch(/\bnext\s*=\s*\[\.\.\.next,\s*_scrml_reactive_get\("pressed"\)\[i\]\]/);
  });
});

// ---------------------------------------------------------------------------
// §4: Negative — bare `name = expr` with NO outer let acts as first binding
// ---------------------------------------------------------------------------

describe("§4: negative — bare `name = expr` with no outer let", () => {
  test("bare assignment with no outer let still registers as a binding", () => {
    const result = compile(negative);
    // Either a const emission or a derived-declare — just NOT simply `firstUse = 5` without binding.
    const js = result.outputs.get(negative)?.clientJs ?? "";
    // Confirm compile worked enough to produce clientJs
    expect(js.length).toBeGreaterThan(0);
    // The bare `firstUse = 5` must have produced SOME binding construct;
    // specifically, not a reassignment to an undeclared name.
    expect(
      /\bconst\s+firstUse\b/.test(js) || /_scrml_derived_declare\(/.test(js)
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5: Nested — reassignment inside if-inside-for still sees outer let
// ---------------------------------------------------------------------------

describe("§5: nested — let at fn scope, reassignment inside for → if", () => {
  test("reassignment reaches through for+if into outer let", () => {
    const result = compile(nested);
    expect(result.errors).toEqual([]);
    const js = foldChunkNamespacing(result.outputs.get(nested).clientJs);
    expect(js).toMatch(/let\s+s\s*=\s*""/);
    expect(js).toMatch(/\bs\s*=\s*"first"/);
    expect(js).toMatch(/\bs\s*=\s*"second"/);
    expect(js).not.toMatch(/const\s+s\s*=\s*"first"/);
    expect(js).not.toMatch(/const\s+s\s*=\s*"second"/);
  });
});
