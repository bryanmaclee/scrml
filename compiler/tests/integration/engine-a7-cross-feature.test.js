/* SPDX-License-Identifier: MIT
 *
 * engine-a7-cross-feature.test.js — A5-7 Bucket 1 (S83, 2026-05-11)
 *
 * Integration tests for cross-feature combinations of the A7 engine surface
 * (§51.0.K-R). Verifies that multiple S67 amendments compose cleanly at the
 * compile + typer + usage-analyzer level.
 *
 * Scenarios:
 *   §1. composite + history + internal:rule= + nested <engine> all coexist
 *   §2. composite + <onTimeout> on the OUTER composite state-child
 *   §3. <onIdle> engine-root + composite state-child (engine-wide watchdog +
 *       per-state hierarchy)
 *   §4. named <onTimeout> + cancelTimer() inside composite state-child body
 *   §5. computed-delay <onTimeout> + composite state-child (both A5 surfaces)
 *   §6. usage-analyzer reports ALL applicable flags for a maximally-featured engine
 *   §7. multiple A7 features in TWO sibling engines — flags ride independently
 *
 * Per a5-3-typer-walker §A5-3.12 "Composition" tests already cover the SYM-
 * PASS-16 walker side. This integration file goes further — compileScrml()
 * end-to-end with assertions on the EMITTED client JS shape.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { analyzeUsage } from "../../src/codegen/usage-analyzer.ts";
import { compileScrml } from "../../src/api.js";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return { ast, sym: runSYM({ filePath, ast }) };
}

function compileToClientJs(source, suffix = "a7x") {
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
    return { errors: result.errors ?? [], clientJs: unNamespaceEngineNames(clientJs) };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ===========================================================================
// §1. composite + history + internal:rule= + nested <engine>
// ===========================================================================

describe("engine-a7-cross-feature §1 — all hierarchy features coexist", () => {
  test("composite with history + internal:rule= + nested engine compiles end-to-end", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused) internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "all-hier");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
  });

  test("usage-analyzer reports all four hierarchy flags simultaneously", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused) internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engines).toBe(true);
    expect(usage.engineHistory).toBe(true);
    expect(usage.engineInternalRules).toBe(true);
    expect(usage.engineNested).toBe(true);
  });
});

// ===========================================================================
// §2. composite + <onTimeout> on the OUTER composite state-child
// ===========================================================================

describe("engine-a7-cross-feature §2 — composite + <onTimeout> on outer composite", () => {
  test("composite with <onTimeout> in body — both nested engine and timer codegen present", () => {
    // <onTimeout> on the outer's composite state-child fires per §51.0.M
    // (per-state timer). Per OQ-Harel-7 timers do NOT cascade across the
    // inner/outer boundary — this timer is OUTER-scoped.
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused)>
    <onTimeout after=30s to=.Paused/>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "comp-ot");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Outer engine emits its timers table for the <Playing> arm.
    expect(clientJs).toContain("__scrml_engine_appMode_timers");
    // Timer ms = 30s = 30000.
    expect(clientJs).toMatch(/ms:\s*30000/);
    expect(clientJs).toMatch(/target:\s*"Paused"/);

    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineOnTimeout).toBe(true);
    expect(usage.engineNested).toBe(true);
  });
});

// ===========================================================================
// §3. <onIdle> engine-root + composite state-child
// ===========================================================================

describe("engine-a7-cross-feature §3 — <onIdle> watchdog + composite", () => {
  test("engine-root <onIdle> + composite state-child coexist", () => {
    // Per SPEC §51.0.R: <onIdle> is engine-ROOT only (sibling of state-children).
    // Composes orthogonally with a composite state-child.
    const src = `\${
      type AppMode:enum  = { Title, Playing, Locked }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <onIdle after=10m to=.Locked/>
  <Title rule=(.Playing | .Locked)></>
  <Playing rule=(.Title | .Locked)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Locked rule=.Title></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "idle-comp");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Idle watchdog config emitted.
    expect(clientJs).toContain("__scrml_engine_appMode_idle");
    expect(clientJs).toMatch(/ms:\s*600000/); // 10m = 600000ms
    expect(clientJs).toMatch(/target:\s*"Locked"/);

    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    // Note: <onIdle> flag is `engines` + per-feature tracking — verify via emitted code.
    expect(usage.engineNested).toBe(true);
  });

  test("E-IDLE-MISPLACED fires when <onIdle> is inside a state-child (orthogonal to nested engine)", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Locked }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=(.Playing | .Locked)></>
  <Playing rule=(.Title | .Locked)>
    <onIdle after=10m to=.Locked/>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Locked rule=.Title></>
</>`;
    const { errors } = compileToClientJs(src, "idle-mis");
    const fired = errors.filter((e) => e.code === "E-IDLE-MISPLACED");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// §4. named <onTimeout> + cancelTimer() inside composite state-child body
// ===========================================================================

describe("engine-a7-cross-feature §4 — named timer + cancelTimer inside composite", () => {
  test("composite state-child with named <onTimeout> emits name= in timer-config (no inner-body cancelTimer)", () => {
    // Named timer on the OUTER composite state-child. The named-timer name
    // composite key is emitted regardless of whether cancelTimer is called.
    // Verifying inner-body cancelTimer lowering hits the body-parser
    // mis-attribution bug (see §7 .skip below) — this test asserts only the
    // timer-config shape, which works today.
    const src = `\${
      type AppMode:enum  = { Idle, Confirming, Confirmed }
      type Sub:enum      = { A, B }
    }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Confirming></>
  <Confirming rule=(.Confirmed | .Idle)>
    <onTimeout name=autoConfirm after=5s to=.Confirmed/>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Confirmed rule=.Idle></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "named-canc");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Named timer composite key includes the name field per S79 §51.0.M.1.
    expect(clientJs).toContain('name: "autoConfirm"');
    // The runtime helper for named-timer clearance is always emitted (it's a
    // small unconditional helper; lowering call sites is what gates use).
    // Verify the timer-config entry includes the name field — that's the
    // observable A5-6 Feature 1 contract.
    expect(clientJs).toMatch(/ms:\s*5000/);
    expect(clientJs).toMatch(/target:\s*"Confirmed"/);
  });

  test("cancelTimer call inside composite arm body lowers correctly (Bug #1 fix)", () => {
    // SPEC §51.0.M.1: cancelTimer("name") is recognized as a builtin when
    // used as an event-handler call-ref attribute inside an engine state-child
    // body. The composite is an engine state-child, so the call must
    // lower to _scrml_engine_clear_named_timer("<varName>", "<armTag>", "<name>").
    //
    // Pre-fix this hit the body-parser mis-attribution bug: the lowercase
    // `<button>...</>` markup BEFORE the inner <engine> opener corrupted the
    // depth counter inside findStateChildCloser, prematurely closing the
    // composite and attributing the inner-engine state-children (`<A>`, `<B>`)
    // to the OUTER engine — firing E-ENGINE-STATE-CHILD-INVALID-VARIANT +
    // E-ENGINE-RULE-INVALID-VARIANT.
    //
    // Fix: changes/fix-nested-engine-body-parser-lowercase-html (2026-05-11)
    // tracks lowercase HTML opener depth separately. The fixture below now
    // compiles cleanly AND the cancelTimer call lowers per §51.0.M.1.
    const src = `\${
      type AppMode:enum  = { Idle, Confirming, Confirmed }
      type Sub:enum      = { A, B }
    }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Confirming></>
  <Confirming rule=(.Confirmed | .Idle)>
    <onTimeout name=autoConfirm after=5s to=.Confirmed/>
    <button onclick=cancelTimer("autoConfirm")>Pause</>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Confirmed rule=.Idle></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "canc-comp");
    const fatal = errors.filter((e) => e.severity === "error");
    expect(fatal).toEqual([]);
    // The named-timer composite-key cancelTimer lowering MUST land:
    //   _scrml_engine_clear_named_timer("appMode", "Confirming", "autoConfirm")
    expect(clientJs).toContain('_scrml_cs_engine_clear_named_timer("appMode", "Confirming", "autoConfirm")');
    // And the named-timer entry itself must still be emitted.
    expect(clientJs).toContain('name: "autoConfirm"');
  });

  test("E-TIMER-NAME-INVALID surfaces from inside a composite state-child body", () => {
    const src = `\${
      type AppMode:enum  = { Idle, Confirming }
      type Sub:enum      = { A, B }
    }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Confirming></>
  <Confirming rule=.Idle>
    <onTimeout name="bad name" after=5s to=.Idle/>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "tnv-comp");
    const fired = errors.filter((e) => e.code === "E-TIMER-NAME-INVALID");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// §5. computed-delay + composite — both A5 surfaces together
// ===========================================================================

describe("engine-a7-cross-feature §5 — computed-delay + composite", () => {
  test("composite state-child with computed-delay <onTimeout> compiles", () => {
    const src = `\${
      type AppMode:enum  = { Idle, Working, Done }
      type Sub:enum      = { A, B }
      <workDelayMs> = 4000
    }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Working></>
  <Working rule=.Done>
    <onTimeout after=\${@workDelayMs}ms to=.Done/>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Done rule=.Idle></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "comp-cd");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Computed form emits msExpr arrow.
    expect(clientJs).toContain("msExpr: function()");
    expect(clientJs).toContain('_scrml_cs_reactive_get("workDelayMs")');
  });
});

// ===========================================================================
// §6. maximally-featured engine — usage-analyzer all flags
// ===========================================================================

describe("engine-a7-cross-feature §6 — maximally-featured engine usage flags", () => {
  test("engine with composite + history + internal + onTimeout + onIdle + nested-with-named-cancel — all flags fire", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused, Locked }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <onIdle after=10m to=.Locked/>
  <Title rule=(.Playing | .Locked)></>
  <Playing history rule=(.Title | .Paused | .Locked) internal:rule=.Playing>
    <onTimeout name=warn after=30s to=.Paused/>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=(.Playing | .Locked)></>
  <Locked rule=.Title></>
</>`;
    const { errors } = compileToClientJs(src, "max");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engines).toBe(true);
    expect(usage.engineHistory).toBe(true);
    expect(usage.engineInternalRules).toBe(true);
    expect(usage.engineOnTimeout).toBe(true);
    expect(usage.engineNested).toBe(true);
  });
});

// ===========================================================================
// §7. two sibling engines — A7 flags ride independently
// ===========================================================================

describe("engine-a7-cross-feature §7 — sibling engines aggregate flags correctly", () => {
  test("one engine has hierarchy + onTimeout; sibling has onIdle only — both flags reported", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
      type Session:enum  = { Active, Idle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <onTimeout after=10s to=.Title/>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>
<engine for=Session initial=.Active>
  <onIdle after=5m to=.Idle/>
  <Active rule=.Idle></>
  <Idle rule=.Active></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "siblings");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Both engines emit their tables.
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(clientJs).toContain("__scrml_engine_session_transitions");
    // appMode has a timers table; session has an idle watchdog.
    expect(clientJs).toContain("__scrml_engine_appMode_timers");
    expect(clientJs).toContain("__scrml_engine_session_idle");

    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineOnTimeout).toBe(true);
    expect(usage.engineNested).toBe(true);
  });
});
