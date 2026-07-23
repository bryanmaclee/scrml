/**
 * S28 gauntlet — §51.5.2 validation elision, slice 1 (Cat 2.a / 2.b).
 *
 * The S28 static-elision deep-dive
 * (`scrml-support/docs/deep-dives/machine-guard-static-elision-2026-04-19.md`)
 * ratified partial validation elision: the compiler emits only the side-
 * effect surface (commit + §51.11 audit + §51.12 timers + §51.3.2 effect)
 * for transitions it can prove legal, eliding variant extraction, matched-
 * key resolution, and the rejection throw.
 *
 * Slice 1 covers Cat 2.a + 2.b — literal unit-variant RHS against a machine
 * with an unguarded wildcard-target rule (`* => .X` or `*:*`), no specific
 * shadowing rule, no guards anywhere, no payload bindings.
 *
 * Tests exercise:
 *   - classifier returns `legal` with correct matched key
 *   - classifier returns `unknown` when any safety condition fails
 *   - emitted JS has the §51.5 elision marker and the minimal shape
 *   - full guard shape (__matchedKey, throw) is absent on elided sites
 *   - audit log `rule` field under elision matches runtime resolution
 *     (compile + execute parity test)
 *   - temporal timer still arms on elided sites (§51.12.7 normative)
 *   - effect block fires unconditionally on elided sites (matched rule
 *     is compile-time known)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { classifyTransition, emitTransitionGuard, setNoElide } from "../../../src/codegen/emit-machines.ts";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { unwrapChunkScope } from "../../helpers/chunk-scope.js";

// All tests here exercise elision semantics directly — reset the no-elide
// flag so behavior doesn't depend on SCRML_NO_ELIDE env state (CI runs the
// full suite with the env var set for parity checking).
beforeEach(() => setNoElide(false));

const tmpRoot = resolve(tmpdir(), "scrml-s28-elision-slice1");
let tmpCounter = 0;

function compileSrc(source) {
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
    const clientJsPath = resolve(outDir, "app.client.js");
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runClientAndInvoke(clientJs, userFnCount) {
  const userFns = extractUserFns(clientJs);
  const toInvoke = userFns.slice(0, userFnCount);
  const callList = toInvoke.map(n => `${n}();`).join("\n");
  const shims = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
  `;
  const fnBody =
    shims + "\n" +
    SCRML_RUNTIME + "\n" +
    unwrapChunkScope(clientJs) + \"\n\" +
    callList + "\n" +
    "return { state: _scrml_state, userFns: " + JSON.stringify(toInvoke) + " };";
  const runner = new Function(fnBody);
  return runner();
}

// ---------------------------------------------------------------------------
// classifyTransition — direct unit tests
// ---------------------------------------------------------------------------

describe("S28 classifyTransition — direct unit tests", () => {
  test("unguarded `* => target` with no specific shadow → legal with *:target", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("legal");
    expect(t.matchedKey).toBe("*:Done");
  });

  test("underscore form `S_Done` also legal (test-fixture RHS shape)", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S_Done", rules);
    expect(t.kind).toBe("legal");
    expect(t.matchedKey).toBe("*:Done");
  });

  test("unguarded `*:*` with no higher-precedence rule → legal with *:*", () => {
    const rules = [
      { from: "*", to: "*", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("legal");
    expect(t.matchedKey).toBe("*:*");
  });

  test("specific `X:target` alongside `*:target` → unknown (ambiguous matched key)", () => {
    const rules = [
      { from: "A", to: "Done", guard: null, label: null, effectBody: null },
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("unknown");
  });

  test("`*:target` alongside `*:*` → legal via *:target (higher precedence, no shadow)", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
      { from: "*", to: "*", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("legal");
    expect(t.matchedKey).toBe("*:Done");
  });

  test("any rule with a guard → unknown (slice-1 sledgehammer)", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
      { from: "A", to: "B", guard: "@gate", label: null, effectBody: null },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("unknown");
  });

  test("any rule with payload bindings → unknown (slice-1 sledgehammer)", () => {
    const rules = [
      {
        from: "*", to: "Done", guard: null, label: null, effectBody: null,
        fromBindings: null, toBindings: [{ localName: "x", fieldName: "data" }],
      },
    ];
    const t = classifyTransition("S.Done", rules);
    expect(t.kind).toBe("unknown");
  });

  test("non-literal RHS (expression, dynamic call) → unknown", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    // A bare call to an identifier (no Enum.Variant prefix) is non-literal.
    expect(classifyTransition("computeNext()", rules).kind).toBe("unknown");
    expect(classifyTransition("x + 1", rules).kind).toBe("unknown");
    // Lowercase variant name rejected by the regex.
    expect(classifyTransition("S.unknown", rules).kind).toBe("unknown");
    // Expression after enum access rejected (not a clean tail).
    expect(classifyTransition("S.Done + x", rules).kind).toBe("unknown");
  });

  test("payload-variant literal `S.Variant(...)` classifies per target (slice 2)", () => {
    const rules = [
      { from: "*", to: "Success", guard: null, label: null, effectBody: null },
    ];
    // S28 slice 2 — payload constructor calls are literal for classification.
    const t = classifyTransition("Result.Success(42)", rules);
    expect(t.kind).toBe("legal");
    expect(t.matchedKey).toBe("*:Success");
  });

  test("no wildcard rules at all → unknown (all specific; flow-sensitive deferred)", () => {
    const rules = [
      { from: "A", to: "B", guard: null, label: null, effectBody: null },
      { from: "B", to: "C", guard: null, label: null, effectBody: null },
    ];
    const t = classifyTransition("S.B", rules);
    expect(t.kind).toBe("unknown");
  });

  test("`*:*` with `X:*` higher-precedence present → unknown", () => {
    const rules = [
      { from: "A", to: "*", guard: null, label: null, effectBody: null },
      { from: "*", to: "*", guard: null, label: null, effectBody: null },
    ];
    expect(classifyTransition("S.Anything", rules).kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// emitTransitionGuard — elided shape (via classifyTransition integration)
// ---------------------------------------------------------------------------

describe("S28 emitTransitionGuard — elided shape", () => {
  test("minimal case (no audit, no effect, no temporal) collapses to bare reactive_set", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).toContain("§51.5 elided transition");
    expect(code).toContain('_scrml_reactive_set("r_s", S.Done)');
    // Full-guard surface gone
    expect(code).not.toContain("__prevVariant");
    expect(code).not.toContain("__matchedKey");
    expect(code).not.toContain("__rule");
    expect(code).not.toContain("E-ENGINE-001-RT");
    // No IIFE wrapper for the minimal collapse
    expect(code).not.toContain("(function()");
  });

  test("audit-target present → elided IIFE with baked-in matched key", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, "r_log");
    const code = lines.join("\n");

    expect(code).toContain("§51.5 elided transition");
    expect(code).toContain("(function()");
    expect(code).toContain('var __prev = _scrml_reactive_get("r_s")');
    expect(code).toContain("var __next = S.Done");
    expect(code).toContain('_scrml_reactive_set("r_s", __next)');
    // Audit push with literal matched key
    expect(code).toContain('rule: "*:Done"');
    expect(code).toContain('label: null');
    expect(code).toContain("Object.freeze");
    // Validation surface absent
    expect(code).not.toContain("__matchedKey");
    expect(code).not.toContain("E-ENGINE-001-RT");
  });

  test("effect body baked in unconditionally (matched rule is compile-time known)", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: 'console.log("done")' },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).toContain("§51.5 elided transition");
    expect(code).toContain("var event = { from: __prev, to: __next }");
    expect(code).toContain('console.log("done")');
    // Matched-key runtime gate absent
    expect(code).not.toContain('__matchedKey === "*:Done"');
  });

  test("labeled rule → label baked in as literal in audit push", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: "reachedDone", effectBody: null },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, "r_log");
    const code = lines.join("\n");

    expect(code).toContain('label: "reachedDone"');
  });

  test("temporal rule whose from matches target → timer armed in elided form", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
      { from: "Done", to: "Closed", guard: null, label: null, effectBody: null, afterMs: 5000 },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).toContain("§51.5 elided transition");
    expect(code).toContain('_scrml_machine_clear_timer("r_s")');
    expect(code).toContain('_scrml_machine_arm_timer("r_s", 5000, "Closed"');
    expect(code).toContain('fromVariant: "Done"');
  });

  test("temporal rule whose from does NOT match target → timer cleared only, no arm", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
      { from: "Other", to: "Closed", guard: null, label: null, effectBody: null, afterMs: 5000 },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).toContain('_scrml_machine_clear_timer("r_s")');
    expect(code).not.toContain('_scrml_machine_arm_timer("r_s", 5000');
  });

  test("ambiguous matched key (`X:target` + `*:target`) → full guard fallthrough", () => {
    const rules = [
      { from: "A", to: "Done", guard: null, label: null, effectBody: null },
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).not.toContain("§51.5 elided transition");
    // Full guard emits
    expect(code).toContain("__matchedKey");
    expect(code).toContain("E-ENGINE-001-RT");
  });

  test("guarded rule present anywhere → full guard fallthrough", () => {
    const rules = [
      { from: "*", to: "Done", guard: null, label: null, effectBody: null },
      { from: "A", to: "B", guard: "@gate", label: null, effectBody: null },
    ];
    const lines = emitTransitionGuard("r_s", "S.Done", "__t", "M", rules, null);
    const code = lines.join("\n");

    expect(code).not.toContain("§51.5 elided transition");
    expect(code).toContain("__matchedKey");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: compile + execute to verify audit-log `rule` parity
// ---------------------------------------------------------------------------

describe("S28 elision — runtime parity with audit log", () => {
  test("elided wildcard-target transition writes `*:Done` into audit log", () => {
    const src = `<program>
\${
  type S:enum = { A, B, Done }
  @order: M = S.A
  @log = []
  function finish() { @order = S.Done }
}
< machine name=M for=S>
  .A => .B
  * => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Elision kicked in (marker present)
    expect(clientJs).toContain("§51.5 elided transition");

    // Execute the elided transition.
    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].rule).toBe("*:Done");
    expect(state.log[0].label).toBeNull();
    expect(state.log[0].to).toBe("Done");
    expect(typeof state.log[0].at).toBe("number");
  });

  test("elided wildcard with label → audit log carries the label", () => {
    const src = `<program>
\${
  type S:enum = { A, B, Done }
  @order: M = S.A
  @log = []
  function finish() { @order = S.Done }
}
< machine name=M for=S>
  .A => .B
  * => .Done [reachedDone]
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("§51.5 elided transition");

    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log[0].rule).toBe("*:Done");
    expect(state.log[0].label).toBe("reachedDone");
  });

  test("elided transition fires effect body at runtime", () => {
    const src = `<program>
\${
  type S:enum = { A, B, Done }
  @order: M = S.A
  @trace = []
  function finish() { @order = S.Done }
}
< machine name=M for=S>
  .A => .B
  * => .Done { @trace = @trace.concat(["done"]) }
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("§51.5 elided transition");

    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.trace).toEqual(["done"]);
  });

  test("non-elidable case (guarded rule present) still emits and executes the full guard", () => {
    // A guarded rule anywhere in the machine disables slice-1 elision. The
    // `finish()` call assigns `.Done` via the wildcard rule at runtime; with
    // the full guard active, the matched key still resolves correctly.
    const src = `<program>
\${
  type S:enum = { A, B, Done }
  @order: M = S.A
  @log = []
  function finish() { @order = S.Done }
}
< machine name=M for=S>
  .A => .B given (true)
  * => .Done
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // No elision — a guard exists on another rule.
    expect(clientJs).not.toContain("§51.5 elided transition");
    expect(clientJs).toContain("__matchedKey");

    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log[0].rule).toBe("*:Done");
    expect(state.log[0].label).toBeNull();
  });
});
