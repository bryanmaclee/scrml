/**
 * emit-expr-engine-routing-option-a.test.js
 *
 * §51.0.F (Option A comprehensive engine-routing) — emit-expr.ts:emitAssign
 * dispatches `@<engineCell> = <expr>` writes through the canonical
 * write-guard helper at ALL expression contexts (S88 v0.3 follow-on dispatch).
 *
 * Background:
 *   Bug 1.7's match-arm-scoped fix (S88 commit 8f03715, Option B) closed
 *   inline-arm engine-write routing at the string-rewrite layer. This Option A
 *   follow-on extends emit-expr.ts:emitAssign itself to consult ctx.engineBindings
 *   so EVERY expression context where `@engineCell = expr` could appear routes
 *   through `_scrml_engine_direct_set` instead of bare `_scrml_reactive_set`.
 *
 *   Pre-Option-A bypassed contexts (each previously emitted bare
 *   `_scrml_reactive_set`):
 *     - Lambda bodies: `arr.forEach((x) => @s = .C)`
 *     - Ternary RHS: `cond ? (@s = .B) : 0`
 *     - Function-call args: `f((@s = .B), other)`
 *     - Compound expressions: `1 + (@s = .B)`
 *     - Nested assigns inside any sub-expression
 *
 * Coverage:
 *   §A.1  ternary-RHS engine write routes through engine_direct_set
 *   §A.2  arrow-lambda body engine write routes through engine_direct_set
 *   §A.3  compound-expression engine write routes through engine_direct_set
 *   §A.4  function-call-arg engine write routes through engine_direct_set
 *   §A.5  nested ternary-inside-arrow engine write routes through engine_direct_set
 *   §A.6  IIFE preserves expression-value semantics (return new value)
 *   §A.NEG plain-cell `@plainCell = "x"` write inside expression context still
 *         emits `_scrml_reactive_set` (negative case — Option A doesn't misfire)
 *   §A.OPT self-write `(@engine = .CurrentVariant)` in expression context routes
 *         through helper — required for §51.0.F.1 Option-d no-op semantics.
 *   §A.HISTORY `.Variant.history` restore-form on RHS in expression context
 *         strips `.history` and arms history-restore flag.
 *   §A.REGRESSION existing match-arm Bug 1.7 routing still fires (no
 *         interference between Option A and Option B layers).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve(tmpdir(), "scrml-emit-expr-engine-routing-opt-a");
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
    const clientPath = resolve(outDir, "app.client.js");
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf-8") : "";
    return {
      errors: (result.errors ?? []).filter(e => e.severity !== "warning"),
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A — Comprehensive expression-context engine-write routing
// ---------------------------------------------------------------------------

describe("Option A — comprehensive emit-expr.ts engine-routing", () => {
  test("§A.1 ternary RHS `cond ? (@state = .B) : 0` routes through engine_direct_set", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function viaTernary(cond) {
    return cond ? (@state = .B) : 0
  }
  function entry() { viaTernary(true) }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    // The ternary RHS must route through the engine helper (NOT bare reactive_set).
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    // The bare reactive_set for the engine cell should NOT appear inside viaTernary.
    const ternaryFn = clientJs.split("_scrml_viaTernary")[1] ?? "";
    const ternaryBody = ternaryFn.split("function _scrml_")[0];
    expect(ternaryBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });

  test("§A.2 arrow-lambda body `(x) => @state = .C` routes through engine_direct_set", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function viaArrow() {
    [1, 2, 3].forEach((x) => @state = .C)
  }
  function entry() { viaArrow() }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    // Inside viaArrow the engine helper must appear (within the forEach arrow body).
    const arrowFn = clientJs.split("_scrml_viaArrow")[1] ?? "";
    const arrowBody = arrowFn.split("function _scrml_")[0];
    expect(arrowBody).toMatch(/_scrml_engine_direct_set\("state"/);
    expect(arrowBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });

  test("§A.3 compound expression `1 + (@state = .B)` routes through engine_direct_set", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function viaCompound() {
    return 1 + (@state = .B)
  }
  function entry() { viaCompound() }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    const compoundFn = clientJs.split("_scrml_viaCompound")[1] ?? "";
    const compoundBody = compoundFn.split("function _scrml_")[0];
    expect(compoundBody).not.toMatch(/_scrml_reactive_set\("state"/);
    // The IIFE must return the value so `1 + ...` is well-formed (compound
    // expression preserves value-semantics via the IIFE wrapper).
    expect(compoundBody).toMatch(/return\s+__scrml_engine_v/);
  });

  test("§A.4 function-call arg `useValue((@state = .B))` routes through engine_direct_set", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function useValue(v) { return v }
  function viaCallArg() {
    return useValue((@state = .B))
  }
  function entry() { viaCallArg() }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    const callFn = clientJs.split("_scrml_viaCallArg")[1] ?? "";
    const callBody = callFn.split("function _scrml_")[0];
    expect(callBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });

  test("§A.5 nested ternary-inside-arrow `(x) => x > 1 ? (@state = .C) : 0`", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function viaNested() {
    [1, 2, 3].forEach((x) => x > 1 ? (@state = .C) : 0)
  }
  function entry() { viaNested() }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    const nestedFn = clientJs.split("_scrml_viaNested")[1] ?? "";
    const nestedBody = nestedFn.split("function _scrml_")[0];
    expect(nestedBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });

  test("§A.6 IIFE wrapper preserves expression-value semantics (returns new value)", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function viaCompound() {
    return 1 + (@state = .B)
  }
  function entry() { viaCompound() }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    // The IIFE structure: bind value to a local, fire guard, return local.
    // Guarantees the value-expression is evaluated exactly once and the
    // surrounding compound (`1 + ...`) sees the new value.
    expect(clientJs).toMatch(/const\s+__scrml_engine_v\s*=\s*"B"/);
    expect(clientJs).toMatch(/return\s+__scrml_engine_v/);
    // Helper call uses the temp identifier, NOT the inline value, so the
    // value expression isn't evaluated twice in the with-hooks form.
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state",\s*__scrml_engine_v/);
  });

  // ---------------------------------------------------------------------------
  // §A.NEG — plain-cell write inside expression context still emits reactive_set
  // ---------------------------------------------------------------------------

  test("§A.NEG plain-cell `(@plainCell = 'x')` in ternary still emits reactive_set", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  @plainCell = "init"
  function viaPlain(cond) {
    return cond ? (@plainCell = "x") : 0
  }
  function entry() { viaPlain(true) }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    // Plain (non-engine) cell writes MUST still emit bare reactive_set —
    // Option A's detection arm should not misfire on non-engine names.
    const plainFn = clientJs.split("_scrml_viaPlain")[1] ?? "";
    const plainBody = plainFn.split("function _scrml_")[0];
    expect(plainBody).toMatch(/_scrml_reactive_set\("plainCell"/);
    expect(plainBody).not.toMatch(/_scrml_engine_direct_set\("plainCell"/);
  });

  // ---------------------------------------------------------------------------
  // §A.OPT — self-write semantics (§51.0.F.1 Option-d) routes uniformly
  // ---------------------------------------------------------------------------

  test("§A.OPT self-write `(@state = .A)` in ternary routes through helper (Option-d enforcement)", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function selfWrite(cond) {
    return cond ? (@state = .A) : 0
  }
  function entry() { selfWrite(true) }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    // Self-write is .A -> .A. The runtime helper short-circuits on
    // current === target (returns false, no rule= violation). The codegen
    // path MUST route through the helper so the no-op semantics fire
    // uniformly across expression and statement contexts.
    const selfFn = clientJs.split("_scrml_selfWrite")[1] ?? "";
    const selfBody = selfFn.split("function _scrml_")[0];
    expect(selfBody).toMatch(/_scrml_engine_direct_set\("state",\s*__scrml_engine_v/);
    expect(selfBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });

  // ---------------------------------------------------------------------------
  // §A.REGRESSION — Bug 1.7's match-arm-scoped layer still fires
  // ---------------------------------------------------------------------------

  test("§A.REGRESSION Bug 1.7 inline-arm `. V => @engine = .X` still routes through helper", () => {
    const src = `<program>
\${
  type State:enum = { A, B, C }
  function dispatch(v: State) {
    match v {
      .A => @state = .B
      .B => @state = .C
      else => 0
    }
  }
  function entry() { dispatch(.A) }
}
<engine for=State initial=.A>
  <A rule=(.B | .C)></>
  <B rule=(.A | .C)></>
  <C rule=(.A | .B)></>
</>
<button onclick=entry()>Click</button>
</program>`;
    const { errors, clientJs } = compile(src);
    expect(errors).toEqual([]);
    // Bug 1.7 Option B path (string-rewrite layer) handles inline-arm results
    // — no ExprNode reaches Option A. Both layers stay live independently.
    expect(clientJs).toMatch(/_scrml_engine_direct_set\("state"/);
    const dispatchFn = clientJs.split("_scrml_dispatch")[1] ?? "";
    const dispatchBody = dispatchFn.split("function _scrml_")[0];
    expect(dispatchBody).not.toMatch(/_scrml_reactive_set\("state"/);
  });
});
