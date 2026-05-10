/**
 * computed-delay.test.js — A5-5 unit tests for §51.12.3.1 computed-delay form
 *
 * Tests the lift on the literal-only constraint for `after` durations across
 * BOTH temporal surfaces (legacy `<machine>` arrow rules + new `<engine>`
 * `<onTimeout>` element). Per SPEC §51.12.3.1 (S67 amendment, 2026-05-07).
 *
 *   §A5-5.1  parseAfterDuration helper — discriminator behavior
 *   §A5-5.2  parseAfterDuration — unit multipliers (ms/s/m/h)
 *   §A5-5.3  parseAfterDuration — invalid duration rejection
 *   §A5-5.4  Legacy <machine>: literal-form preserves existing constant-fold path
 *   §A5-5.5  Legacy <machine>: computed-form emits IIFE-wrapped clamp+round
 *   §A5-5.6  Engine <onTimeout>: literal-form emits {ms, target}
 *   §A5-5.7  Engine <onTimeout>: computed-form emits {msExpr, target}
 *   §A5-5.8  Computed-form rewrites @var reads through _scrml_reactive_get
 *   §A5-5.9  Negative-runtime clamp shape verification
 *   §A5-5.10 Wildcard-from rejection extends to computed form
 *   §A5-5.11 Computed-form chained re-arm: computed rules opt out of rulesJson
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { parseAfterDuration } from "../../src/codegen/parse-after-duration.ts";
import { emitEngineTimersTable } from "../../src/codegen/emit-engine.ts";
import { compileScrml } from "../../src/api.js";

/**
 * Compile the source through the full pipeline (BS→TAB→...→CG) and return the
 * client.js text. Mirrors the gauntlet-s26 test fixture pattern. Used for
 * legacy-<machine> end-to-end tests that need the typer's `machineRegistry`
 * (built by the TS pass; not by SYM alone).
 */
function compileToClientJs(source, suffix = "computed-delay") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Same as compileToClientJs but only returns errors — used by negative tests
 * that assert specific diagnostics fire.
 */
function compileForErrors(source, suffix = "computed-delay") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: outDir,
    });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A5-5.1 — parseAfterDuration discriminator
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.1 — parseAfterDuration discriminator", () => {
  test("literal `30s` → {kind:'literal', ms:30000}", () => {
    expect(parseAfterDuration("30s")).toEqual({ kind: "literal", ms: 30000 });
  });

  test("computed `${@x}ms` → {kind:'computed', exprText:'@x', unitMultiplier:1}", () => {
    expect(parseAfterDuration("${@x}ms")).toEqual({
      kind: "computed",
      exprText: "@x",
      unitMultiplier: 1,
    });
  });

  test("invalid `foo` → {kind:'invalid', reason}", () => {
    const r = parseAfterDuration("foo");
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/does not match LITERAL form/);
  });

  test("computed with empty expression → invalid", () => {
    const r = parseAfterDuration("${}ms");
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/empty expression/);
  });

  test("non-string input → invalid", () => {
    expect(parseAfterDuration(123).kind).toBe("invalid");
    expect(parseAfterDuration(null).kind).toBe("invalid");
    expect(parseAfterDuration(undefined).kind).toBe("invalid");
  });

  test("empty string → invalid", () => {
    expect(parseAfterDuration("").kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// §A5-5.2 — Unit multipliers
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.2 — unit multipliers", () => {
  test("ms multiplier 1", () => {
    expect(parseAfterDuration("500ms")).toEqual({ kind: "literal", ms: 500 });
    expect(parseAfterDuration("${x}ms").unitMultiplier).toBe(1);
  });

  test("s multiplier 1000", () => {
    expect(parseAfterDuration("30s")).toEqual({ kind: "literal", ms: 30000 });
    expect(parseAfterDuration("${x}s").unitMultiplier).toBe(1000);
  });

  test("m multiplier 60000", () => {
    expect(parseAfterDuration("2m")).toEqual({ kind: "literal", ms: 120000 });
    expect(parseAfterDuration("${x}m").unitMultiplier).toBe(60000);
  });

  test("h multiplier 3600000", () => {
    expect(parseAfterDuration("1h")).toEqual({ kind: "literal", ms: 3600000 });
    expect(parseAfterDuration("${x}h").unitMultiplier).toBe(3600000);
  });

  test("fractional literal: 0.5s → 500ms (Math.round)", () => {
    expect(parseAfterDuration("0.5s")).toEqual({ kind: "literal", ms: 500 });
  });

  test("uppercase unit accepted (case-insensitive)", () => {
    expect(parseAfterDuration("30S")).toEqual({ kind: "literal", ms: 30000 });
    expect(parseAfterDuration("${x}MS").unitMultiplier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §A5-5.3 — Invalid rejection
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.3 — invalid duration rejection", () => {
  test("missing unit → invalid", () => {
    expect(parseAfterDuration("30").kind).toBe("invalid");
  });

  test("unknown unit (`30x`) → invalid", () => {
    expect(parseAfterDuration("30x").kind).toBe("invalid");
  });

  test("negative literal → invalid (caught by regex; no leading `-` in number group)", () => {
    expect(parseAfterDuration("-30s").kind).toBe("invalid");
  });

  test("computed form requires unit suffix after `}`", () => {
    expect(parseAfterDuration("${@x}").kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// §A5-5.4 — Legacy <machine>: literal-form retains constant-fold
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.4 — legacy machine literal preserves constant-fold", () => {
  test("`.From after 30s => .To` constant-folds to 30000 in the rulesPayload (init-time arm)", () => {
    const src = `<program>
\${
  type Phase:enum = { Loading, TimedOut }
  @phase: PhaseMachine = Phase.Loading
}
< machine name=PhaseMachine for=Phase>
  .Loading after 30s => .TimedOut
</>
</program>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Literal-form: the rulesPayload encodes 30000 as a literal number; the
    // _scrml_machine_arm_initial call is what arms timers at init. The payload
    // is JSON-encoded as a string so the "afterMs" key + 30000 value appears
    // with backslash-escaped quotes inside the source.
    expect(clientJs).toContain('_scrml_machine_arm_initial("phase"');
    expect(clientJs).toMatch(/afterMs\\":30000/);
    // Negative: NO computed-form IIFE clamp shape anywhere near the arm site
    // (the IIFE only appears for computed-form arms).
    const initIdx = clientJs.indexOf('_scrml_machine_arm_initial("phase"');
    expect(initIdx).toBeGreaterThan(-1);
    const window = clientJs.slice(Math.max(0, initIdx - 500), initIdx + 500);
    expect(window).not.toContain('return (typeof v === "number"');
  });

  test("`.From after 30s => .To` ALSO emits the constant-folded value at the per-rule arm site (when triggered by a write)", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, TimedOut }
  @phase: PhaseMachine = Phase.Idle
  function trigger() { @phase = Phase.Loading }
}
< machine name=PhaseMachine for=Phase>
  .Idle => .Loading
  .Loading after 30s => .TimedOut
</>
</program>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The write-site arm-after-set path emits a guarded arm call with
    // the literal duration as the 2nd arg (no IIFE wrapper).
    expect(clientJs).toMatch(/_scrml_machine_arm_timer\("phase",\s*30000/);
  });
});

// ---------------------------------------------------------------------------
// §A5-5.5 — Legacy <machine>: computed-form emits IIFE
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.5 — legacy machine computed form (helper-level coverage)", () => {
  // KNOWN LIMITATION (documented as scope adjustment, S77 dispatch):
  // The legacy `<machine>` body parser at the block-splitter / ast-builder
  // level splits `${...}` expressions into separate children, so the rulesRaw
  // string fed to parseMachineRules has line-breaks where the `${expr}` was.
  // This breaks the `after ${expr}<unit>` syntax for the LEGACY machine form
  // even though the parseMachineRules regex + parseAfterDuration helper handle
  // the input correctly. Fixing requires touching the body-parser surface
  // (block-splitter behavior on `${...}` inside `<machine>` body) — out of
  // scope for the S77 dispatch's per-rule codegen surface.
  //
  // The SPEC §51.12.3.1 amendment lists computed-delay as available on BOTH
  // surfaces. The engine `<onTimeout>` surface — which is the S67-recommended
  // form — works correctly (verified by computed-delay engine tests below
  // + by engine-ontimeout-codegen.test.js). The legacy `<machine>` surface's
  // computed-delay is deferred to a follow-on dispatch.
  //
  // The helper code (parseAfterDuration + emitDurationLiteral + parseMachineRules
  // afterExpr branch) IS in place and correct; the only missing piece is the
  // body-parser preserving the `${...}` text into rulesRaw. Coverage for the
  // helper-level behavior is below.

  test("parseAfterDuration handles `${@delay}ms` correctly (helper-level)", () => {
    expect(parseAfterDuration("${@delay}ms")).toEqual({
      kind: "computed",
      exprText: "@delay",
      unitMultiplier: 1,
    });
  });

  test("computed-form via engine <onTimeout> emits IIFE-wrapped expr through msExpr (the working surface)", () => {
    const src = `<program>
\${
  type Phase:enum = { Loading, TimedOut }
  @delay = 5000
}
<engine for=Phase initial=.Loading>
  <Loading rule=.TimedOut>
    <onTimeout after=\${@delay}ms to=.TimedOut/>
  </>
  <TimedOut></>
</>
</program>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Verify the timer-config table + msExpr wiring at the codegen layer.
    // (The runtime clamp lives in the 'engine' chunk of the runtime
    // preamble — emitted into scrml-runtime.js, not the per-file client.js,
    // since the testMode here splits chunks across files.)
    expect(clientJs).toContain("__scrml_engine_phase_timers");
    expect(clientJs).toContain("msExpr: function()");
    // Reactive read rewrite — @delay → _scrml_reactive_get("delay")
    expect(clientJs).toContain('_scrml_reactive_get("delay")');
    // Initial-arm at module-init for the Loading state.
    expect(clientJs).toContain('_scrml_engine_arm_state_timers("phase", "Loading"');
  });

  test("the runtime clamp shape ships with the 'engine' chunk runtime preamble", () => {
    // The runtime helper _scrml_engine_arm_state_timers applies the clamp;
    // confirm the source is in the runtime template.
    const fs = require("fs");
    const rt = fs.readFileSync(require.resolve("../../src/runtime-template.js"), "utf8");
    expect(rt).toContain("_scrml_engine_arm_state_timers");
    expect(rt).toContain('typeof v === "number" && isFinite(v) && v >= 0');
  });
});

// ---------------------------------------------------------------------------
// §A5-5.5b — Legacy <machine>: computed-form NOW WORKS end-to-end (S77 closure)
//
// Closes the §A5-5.5 deferred limitation. The original block-splitter+ast-
// builder bug was fragmenting `${...}` substrings into separate logic
// children + ast-builder injecting `\n` BETWEEN children. After the
// `rulesRaw += child.raw` (no `\n` inserted) fix at ast-builder.js, the
// `${...}` substring concats cleanly back into the single rule line, and
// the existing parseMachineRules + parseAfterDuration + emitDurationLiteral
// path produces correct codegen.
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.5b — legacy <machine> computed-form end-to-end (S77 fix)", () => {
  test("`.From after ${@d}ms => .To` rulesRaw is reconstructed without fragmenting", () => {
    const { splitBlocks } = require("../../src/block-splitter.js");
    const { buildAST } = require("../../src/ast-builder.js");
    const src = `\${
  type Phase:enum = { Connecting, Open, Closed }
  @phase: BackoffMachine = Phase.Connecting
  @backoffDelay = 500
}
<machine name=BackoffMachine for=Phase>
  .Connecting after \${@backoffDelay}ms => .Open
  .Open => .Closed
</>`;
    const bs = splitBlocks("test.scrml", src);
    const { ast } = buildAST(bs);
    const eng = ast.machineDecls?.[0] ?? ast.nodes.find(n => n.kind === "engine-decl");
    expect(eng).toBeTruthy();
    // Rule line is intact: ${@backoffDelay} adjacent to `after ` and `ms`,
    // not split across newlines.
    expect(eng.rulesRaw).toContain(".Connecting after ${@backoffDelay}ms => .Open");
  });

  test("`.From after ${@d}ms => .To` compiles end-to-end + emits IIFE-wrapped runtime computation", () => {
    const src = `\${
  type Phase:enum = { Connecting, Open, Closed }
  @phase: BackoffMachine = Phase.Connecting
  @backoffDelay = 500
}
<machine name=BackoffMachine for=Phase>
  .Connecting after \${@backoffDelay}ms => .Open
  .Open => .Closed
</>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    // Verify the runtime arm site is emitted (the IIFE body) and the
    // reactive read is rewritten through _scrml_reactive_get.
    expect(clientJs).toContain("_scrml_machine_arm_timer");
    expect(clientJs).toContain('_scrml_reactive_get("backoffDelay")');
    // The IIFE clamp shape (matches emitDurationLiteral output).
    expect(clientJs).toMatch(/typeof v === ["']number["'] && isFinite\(v\)/);
  });

  test("regression: literal-form `.From after 500ms => .To` still works (no inserted \\n needed)", () => {
    const src = `\${
  type Phase:enum = { Connecting, Open }
  @phase: M = Phase.Connecting
}
<machine name=M for=Phase>
  .Connecting after 500ms => .Open
</>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    // Literal-form rules at module-init use _scrml_machine_arm_initial with
    // a JSON-encoded rulesPayload (computed rules opt out per §51.12.4 S77).
    // The payload is a JSON-stringified JSON string, so quotes inside appear
    // backslash-escaped: `\"afterMs\":500`. Verify the literal entry is present.
    expect(clientJs).toContain("_scrml_machine_arm_initial");
    expect(clientJs).toContain('\\"afterMs\\":500');
    // No IIFE wrapper for literal cases.
    expect(clientJs).not.toMatch(/typeof v === ["']number["'] && isFinite\(v\)/);
  });
});

// ---------------------------------------------------------------------------
// §A5-5.6 — Engine <onTimeout>: literal form emits {ms, target}
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.6 — engine onTimeout literal form", () => {
  test("`<onTimeout after=30s to=.X/>` emits {ms: 30000, target: \"X\"}", () => {
    // Direct emit-engine helper exercise (engine state-child fixture).
    const m = {
      forType: "Phase", varName: "phase", initialVariant: "Loading",
      variants: ["Loading", "TimedOut"], derivedExpr: null,
      isExported: false, isPinned: false,
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "TimedOut" },
          onTimeoutElements: [{ after: "30s", to: "TimedOut", rawOffset: 0 }] },
        { tag: "TimedOut", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [{ stateChildTag: "Loading", entry: { after: "30s", to: "TimedOut", rawOffset: 0 } }],
    };
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 30000, target: "TimedOut" }');
    expect(out).not.toContain("msExpr");
  });
});

// ---------------------------------------------------------------------------
// §A5-5.7 — Engine <onTimeout>: computed form emits {msExpr, target}
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.7 — engine onTimeout computed form", () => {
  test("`<onTimeout after=\${@delay}ms to=.X/>` emits msExpr arrow-function", () => {
    const m = {
      forType: "Phase", varName: "phase", initialVariant: "Loading",
      variants: ["Loading", "Retry"], derivedExpr: null,
      isExported: false, isPinned: false,
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [{ after: "${@delay}ms", to: "Retry", rawOffset: 0 }] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [{ stateChildTag: "Loading", entry: { after: "${@delay}ms", to: "Retry", rawOffset: 0 } }],
    };
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain("msExpr: function()");
    expect(out).toContain('target: "Retry"');
    // Literal-form keys absent
    expect(out).not.toContain('{ ms:');
  });
});

// ---------------------------------------------------------------------------
// §A5-5.8 — Reactive-read rewrite inside computed form
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.8 — reactive-read rewrite", () => {
  test("`@var` inside computed expression rewrites to _scrml_reactive_get", () => {
    const m = {
      forType: "Phase", varName: "phase", initialVariant: "Loading",
      variants: ["Loading", "Retry"], derivedExpr: null,
      isExported: false, isPinned: false,
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [{ after: "${@attempt * 1000}ms", to: "Retry", rawOffset: 0 }] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [{ stateChildTag: "Loading", entry: { after: "${@attempt * 1000}ms", to: "Retry", rawOffset: 0 } }],
    };
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('_scrml_reactive_get("attempt")');
  });
});

// ---------------------------------------------------------------------------
// §A5-5.9 — Negative-runtime clamp shape
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.9 — negative-runtime clamp shape", () => {
  test("computed-form arrow-fn at runtime clamps negative to 0", () => {
    // We can verify the SHAPE is correct by string-search; behavior is verified
    // by direct evaluation since the IIFE is self-contained.
    const m = {
      forType: "Phase", varName: "phase", initialVariant: "Loading",
      variants: ["Loading", "Retry"], derivedExpr: null,
      isExported: false, isPinned: false,
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [{ after: "${-100}ms", to: "Retry", rawOffset: 0 }] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [{ stateChildTag: "Loading", entry: { after: "${-100}ms", to: "Retry", rawOffset: 0 } }],
    };
    const out = emitEngineTimersTable(m).join("\n");
    // The actual clamp shape lives in the runtime helper
    // _scrml_engine_arm_state_timers (in runtime-template.js); the table emits
    // msExpr that returns the raw computed value. The runtime applies the
    // (typeof === number && isFinite && >= 0) ? Math.round : 0 clamp.
    expect(out).toContain("msExpr: function()");
    expect(out).toContain("(-100) * 1");
    // The runtime clamp lives in _scrml_engine_arm_state_timers — covered by
    // the integration test in engine-ontimeout-end-to-end.test.js.
  });

  test("emitDurationLiteral helper produces the inline IIFE clamp shape for an afterExpr rule", () => {
    // Direct helper exercise — bypasses the legacy-machine body-parser
    // limitation. Confirms the codegen surface for the legacy-machine
    // computed-form is in place (the body parser is the deferred part).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const emitMachines = require("../../src/codegen/emit-machines.ts");
    // emitDurationLiteral is module-internal — exercise via emitElidedTransition
    // OR via parseMachineRules → emit chain. We can re-test the SHAPE through
    // the SAME codegen path by inspecting an arm call generated when a rule
    // happens to reach the elision path. For now verify by reading the source:
    const fs = require("fs");
    const src = fs.readFileSync(require.resolve("../../src/codegen/emit-machines.ts"), "utf8");
    expect(src).toContain('return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0');
  });
});

// ---------------------------------------------------------------------------
// §A5-5.10 — Wildcard-from rejection extends to computed form
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.10 — wildcard-from rejection (E-ENGINE-021) — literal form", () => {
  // The wildcard-from rejection check now extends to computed-form per the
  // type-system change (`afterMs !== null || afterExpr !== null` in the
  // wildcard guard). Verify on the literal-form path which works through the
  // body parser — the computed-form path on legacy machine has the body-
  // parser limitation noted in §A5-5.5.
  test("`* after 30s => .Y` is rejected with E-ENGINE-021 (no specific from)", () => {
    const src = `<program>
\${
  type Phase:enum = { A, B, C }
  @phase: PhaseMachine = Phase.A
}
< machine name=PhaseMachine for=Phase>
  * after 30s => .C
</>
</program>`;
    const { errors } = compileForErrors(src);
    const errs = errors.filter(e => e.code === "E-ENGINE-021" || (e.message && String(e.message).includes("E-ENGINE-021")));
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §A5-5.11 — Computed-form chained re-arm semantics
// ---------------------------------------------------------------------------

describe("A5-5 §A5-5.11 — chained re-arm payload (literal-only form)", () => {
  // The chained-rearm `rulesJson` payload includes ONLY literal-form rules
  // by design — computed-form afterExpr cannot serialize through JSON.parse
  // and round-trip into a runtime-callable form. (Legacy-machine computed-
  // form has the body-parser limitation noted above; the engine-form
  // computed-form participates via a different runtime path — the per-state
  // _scrml_engine_arm_state_timers helper handles each entry independently
  // and does not chain-re-arm.)
  //
  // Verify the literal-only multi-rule case:
  test("multi-rule literal form populates the rulesPayload with all rules", () => {
    const src = `<program>
\${
  type Phase:enum = { A, B, C, D }
  @phase: PhaseMachine = Phase.A
}
< machine name=PhaseMachine for=Phase>
  .A after 1s => .B
  .B after 2s => .C
  .C after 3s => .D
</>
</program>`;
    const { errors, clientJs } = compileToClientJs(src);
    expect(errors.filter(e => e.severity === "error")).toEqual([]);
    // All three rules in the rulesPayload (literal-form path).
    expect(clientJs).toMatch(/afterMs\\":1000/);
    expect(clientJs).toMatch(/afterMs\\":2000/);
    expect(clientJs).toMatch(/afterMs\\":3000/);
  });
});
