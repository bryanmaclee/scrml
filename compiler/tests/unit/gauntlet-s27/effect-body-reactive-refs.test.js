/**
 * S27 regression — effect-body @-refs compile and run correctly.
 *
 * Pre-S27 emit-machines.ts inserted `rule.effectBody` raw into the
 * transition guard IIFE. An effect body like `{ @trace = @trace.concat(...) }`
 * emitted literal `@` characters — invalid JS. Every pre-existing
 * shape-only test asserted the effect body appeared in the output but
 * never executed it, so the bug was latent.
 *
 * S27 wraps the effect body through rewriteExpr so it runs the same
 * pipeline as any other logic-context expression (reactive-ref rewrite,
 * match lowering, fn-keyword, etc.).
 *
 * Tests exercise:
 *   - Simple reactive write in effect body runs at runtime
 *   - Reactive read + write (e.g. concat) produces correct result
 *   - Effect body interacts with guarded rules correctly
 *   - Effect body can reference `event.from` / `event.to` locals
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { foldChunkNamespacing, unwrapChunkScope } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-effect-refs");
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
    // RAW client JS — text-assert tests fold at their own read site; runtime
    // tests feed it to buildEnv() which unwraps the chunk scope for execution.
    const clientJs = existsSync(resolve(outDir, "app.client.js"))
      ? readFileSync(resolve(outDir, "app.client.js"), "utf8")
      : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildEnv(clientJsRaw) {
  // BUG-6/N3: strip the per-chunk IIFE + `_scrml_cs_` cell scope so the emitted
  // user functions are top-level (extractable + callable) and the accessors key
  // BARE — this env reads `_scrml_state` by author name. A no-op on an unscoped
  // chunk. Accepts already-folded input too (unwrap is idempotent over folds).
  const clientJs = unwrapChunkScope(clientJsRaw);
  const userFns = extractUserFns(clientJs);
  const userFnBindings = userFns.map(n => `${JSON.stringify(n)}: ${n}`).join(",\n    ");
  const fnBody = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
    ${SCRML_RUNTIME}
    ${clientJs}
    return {
      state: _scrml_state,
      userFns: { ${userFnBindings} },
      userFnNames: ${JSON.stringify(userFns)},
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(fnBody)();
}

describe("S27 — effect-body reactive refs compile + run correctly", () => {
  test("simple `@reactive = expr` write in effect body runs at runtime", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Running }
  @state: M = S.Idle
  @started = false
  function go() { @state = S.Running }
}
< engine name=M for=S>
  .Idle => .Running { @started = true }
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // No literal @-tokens leaked into the compiled output for the effect body.
    // (Scope the check to the effect block; the audit/guard sections use `@`
    // only inside string literals like "E-ENGINE-001-RT: ...", which is safe.)
    expect(clientJs).toContain('_scrml_reactive_set("started"');
    const env = buildEnv(clientJs);
    expect(env.state.started).toBe(false);
    env.userFns[env.userFnNames.find(n => n.includes("go"))]();
    expect(env.state.state).toBe("Running");
    expect(env.state.started).toBe(true);
  });

  test("effect body reading + writing same reactive (concat)", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  @trace = []
  function go() { @state = S.B }
}
< engine name=M for=S>
  .A => .B { @trace = @trace.concat(["hop"]) }
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_set("trace"');
    expect(clientJs).toContain('_scrml_reactive_get("trace")');
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("go"))]();
    expect(env.state.trace).toEqual(["hop"]);
  });

  test("effect body with guarded rule — effect fires only when guard passes", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  @fired = 0
  function go() { @state = S.B }
}
< engine name=M for=S>
  .A => .B given (true) { @fired = @fired + 1 }
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("go"))]();
    expect(env.state.state).toBe("B");
    expect(env.state.fired).toBe(1);
  });

  test("effect body references `event.from` / `event.to` locals", () => {
    // Single-statement effect body — multi-statement forms are blocked by a
    // separate pre-existing bug in parseMachineRules (it splits on `;`,
    // fragmenting effect bodies). Queued for a future fix; not in scope
    // here.
    const src = `<program>
\${
  type S:enum = { A, B }
  @state: M = S.A
  @lastTo = ""
  function go() { @state = S.B }
}
< engine name=M for=S>
  .A => .B { @lastTo = event.to }
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("go"))]();
    // event.to is the raw variant value (bare string for unit variants).
    expect(env.state.lastTo).toBe("B");
  });

  test("multiple effect bodies in same machine each see their own rule's bindings", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @state: M = S.A
  @count = 0
  function toB() { @state = S.B }
  function toC() { @state = S.C }
}
< engine name=M for=S>
  .A => .B { @count = @count + 10 }
  .B => .C { @count = @count + 100 }
</>
<p>x</>
</program>
`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const env = buildEnv(clientJs);
    env.userFns[env.userFnNames.find(n => n.includes("toB"))]();
    expect(env.state.count).toBe(10);
    env.userFns[env.userFnNames.find(n => n.includes("toC"))]();
    expect(env.state.count).toBe(110);
  });
});
