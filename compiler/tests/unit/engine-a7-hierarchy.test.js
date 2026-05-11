/* SPDX-License-Identifier: MIT
 *
 * engine-a7-hierarchy.test.js — A5-7 Bucket 1 (S83, 2026-05-11)
 *
 * Behavioral test coverage for nested-engine declarations + parent-rule
 * cascade dispatch (SPEC §51.0.Q, S67 amendment). Complements:
 *   - compiler/tests/unit/a5-2-parser-support.test.js §A5-2.5 (parser shape)
 *   - compiler/tests/unit/a5-3-typer-walker.test.js §A5-3.9/§A5-3.11 (cohesion + aggregation)
 *
 * This file focuses on the OBSERVABLE BEHAVIOR end-to-end:
 *   §1. usage-analyzer.engineNested flag fires when state-child contains <engine>
 *   §2. tree-shake intent — engineNested=false on flat engines
 *   §3. EngineStateChildEntry.innerEngines populated for composite state-children
 *   §4. Outer engine compiles + emits its own transition table even when nested
 *   §5. Machine Cohesion §51.0.K — engines inside function bodies are absorbed (parser cohesion)
 *   §6. Singleton invariant — multiple sibling top-level engines stay distinct
 *
 * KNOWN DEFERRALS (Wave 4 — A7 codegen surface still pending):
 *   - Inner engine's own dispatcher emission inside composite arm body
 *     (Bug #2 — Wave 4 codegen follow-on, per emit-engine.ts:76).
 *   - Inner-engine variant restore on outer re-entry (history synth-cell —
 *     Bug #3 — codegen follow-on per emit-engine.ts:532).
 *   - internal:rule= distinct write path (Bug #4 — codegen follow-on).
 *
 * CLOSED DEFERRALS (S83, 2026-05-11):
 *   - Bug #1 — Inner-engine state-child non-empty body parsing (FIXED via
 *     separate lowercase-depth counter across all three closer-finders in
 *     engine-statechild-parser.ts). §7.1+§7.2 below exercise canonical
 *     SPEC §51.0.Q.1 fixtures with lowercase HTML inside composite bodies.
 *   - Bug #5 — Parent-rule cascade compile-time validation (cascade-miss
 *     diagnostic per §51.0.Q.3 — closed via SYM PASS 16 fire-site #9 in
 *     symbol-table.ts). See §7.3 below for the regression tests.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { analyzeUsage } from "../../src/codegen/usage-analyzer.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return { ast, sym: runSYM({ filePath, ast }) };
}

function findEngineDecls(ast) {
  const found = [];
  function walk(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.kind === "engine-decl") found.push(n);
      if (n.children) walk(n.children);
      if (n.body) walk(n.body);
    }
  }
  walk(ast.nodes || []);
  if (ast.machineDecls) {
    for (const m of ast.machineDecls) {
      if (m && m.kind === "engine-decl" && !found.includes(m)) found.push(m);
    }
  }
  return found;
}

function compileToClientJs(source, suffix = "hier") {
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

// ===========================================================================
// §1. usage-analyzer.engineNested fires when state-child contains nested <engine>
// ===========================================================================

describe("engine-a7-hierarchy §1 — usage-analyzer engineNested (fires)", () => {
  test("composite state-child with nested <engine> → engineNested=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineNested).toBe(true);
    // Outer engine still counted via `engines` flag.
    expect(usage.engines).toBe(true);
  });

  test("nested-engine flag fires even when other A7 features absent", () => {
    // Just the hierarchy surface, no history/internal/onTimeout.
    const src = `\${
      type AppMode:enum  = { A, B }
      type Sub:enum      = { X, Y }
    }
<engine for=AppMode initial=.A>
  <A rule=.B>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
  <B rule=.A></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineNested).toBe(true);
    expect(usage.engineHistory).toBe(false);
    expect(usage.engineInternalRules).toBe(false);
    expect(usage.engineOnTimeout).toBe(false);
  });
});

describe("engine-a7-hierarchy §2 — usage-analyzer engineNested (tree-shake)", () => {
  test("flat engine (no nested) → engineNested=false", () => {
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineNested).toBe(false);
  });

  test("two SIBLING file-scope engines (multi-engine §51.4 pattern) → engineNested=false", () => {
    // Two file-scope engines side-by-side are NOT nested per §51.0.Q.4 row 1
    // (multi-engine pattern). Nested means inside a state-child body.
    const src = `\${
      type Phase:enum   = { Idle, Active }
      type Toggle:enum  = { Off, On }
    }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>
<engine for=Toggle initial=.Off>
  <Off rule=.On></>
  <On rule=.Off></>
</>`;
    const { ast } = runUpToSYM(src);
    const engines = findEngineDecls(ast);
    expect(engines.length).toBe(2);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineNested).toBe(false);
  });
});

// ===========================================================================
// §3. innerEngines field populated on composite state-children
// ===========================================================================

describe("engine-a7-hierarchy §3 — innerEngines field on state-child entries", () => {
  test("only the composite state-child has non-empty innerEngines", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { ast } = runUpToSYM(src);
    const engines = findEngineDecls(ast);
    // Both outer and inner may register as engine-decls — the outer carries
    // stateChildren in its engineMeta; the inner registers separately if
    // PASS 10.A walks into the inner scope. We focus on the outer's children.
    const outer = engines.find((e) => e._record?.engineMeta?.forType === "AppMode");
    expect(outer).toBeDefined();
    const sc = outer._record.engineMeta.stateChildren;
    const byTag = Object.fromEntries(sc.map((s) => [s.tag, s]));
    expect(Array.isArray(byTag.Playing?.innerEngines)).toBe(true);
    expect(byTag.Playing.innerEngines.length).toBeGreaterThanOrEqual(1);
    expect((byTag.Title?.innerEngines || []).length).toBe(0);
    expect((byTag.Paused?.innerEngines || []).length).toBe(0);
  });

  test("self-closing <engine .../> is NOT recognized as a valid nested-engine form", () => {
    // Per a5-2 §A5-2.5 + engine-statechild-parser.ts:410 — engines must
    // contain state-children, so self-closing inner forms are not recognized.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <engine for=PlayMode initial=.A/>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const engines = findEngineDecls(ast);
    const outer = engines.find((e) => e._record?.engineMeta?.forType === "AppMode");
    const playing = outer._record.engineMeta.stateChildren.find((s) => s.tag === "Playing");
    // innerEngines should be empty — the self-closing form is not a recognized nested form.
    expect((playing?.innerEngines || []).length).toBe(0);
  });
});

// ===========================================================================
// §4. Outer engine emits its own transition table even when nested present
// ===========================================================================

describe("engine-a7-hierarchy §4 — outer engine end-to-end compilation", () => {
  test("composite + nested engine — outer engine compiles + emits transitions table", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "outer-emit");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    // Outer dispatcher wires to appMode.
    expect(clientJs).toContain('_scrml_reactive_subscribe("appMode"');
    // Initial variant set.
    expect(clientJs).toMatch(/_scrml_reactive_set\("appMode",\s*"Title"\)/);
  });

  test("compilation succeeds with EMPTY inner state-child bodies (canonical form)", () => {
    // The canonical SPEC §51.0.Q.1 example has empty inner state-child bodies.
    // This passes today. Inner state-children with non-empty bodies surface a
    // body-parser limitation — see §7 .skip block below.
    const src = `\${
      type AppMode:enum  = { A, B }
      type Sub:enum      = { X, Y, Z }
    }
<engine for=AppMode initial=.A>
  <A rule=.B>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.Z></>
      <Z rule=.X></>
    </>
  </>
  <B rule=.A></>
</>`;
    const { errors } = compileToClientJs(src, "empty-inner");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
  });
});

// ===========================================================================
// §5. Machine Cohesion §51.0.K — engine in function body is absorbed
// ===========================================================================

describe("engine-a7-hierarchy §5 — engine cohesion (per §51.0.K footnote)", () => {
  test("engine inside function body does NOT register as engine-decl (per parser cohesion)", () => {
    // Mirrors a5-3 §A5-3.9: the parser cohesion intercepts engines in function
    // bodies before they become engine-decl nodes. Per §51.0.K footnote, this
    // is the Machine Cohesion / singleton invariant enforcement.
    const src = `\${
      type Phase:enum = { Idle, Active }
      function setup() {
        <engine for=Phase initial=.Idle>
          <Idle rule=.Active></>
          <Active rule=.Idle></>
        </>
      }
    }`;
    const { ast } = runUpToSYM(src);
    const engines = findEngineDecls(ast);
    // The engine should not register at file scope — it was absorbed by the
    // function-body parser (no separate engine-decl emitted).
    expect(engines.length).toBe(0);
  });
});

// ===========================================================================
// §6. Singleton invariant — sibling file-scope engines coexist independently
// ===========================================================================

describe("engine-a7-hierarchy §6 — multi-engine pattern (§51.4)", () => {
  test("two sibling file-scope engines compile + emit two independent transition tables", () => {
    const src = `\${
      type Phase:enum   = { Idle, Active }
      type Toggle:enum  = { Off, On }
    }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>
<engine for=Toggle initial=.Off>
  <Off rule=.On></>
  <On rule=.Off></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "multi");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_phase_transitions");
    expect(clientJs).toContain("__scrml_engine_toggle_transitions");
  });
});

// ===========================================================================
// §7. Inner state-child non-empty body parsing (Wave 4 — body-parser fix)
//
// Bug #1 fix-cite (changes/fix-nested-engine-body-parser-lowercase-html,
// 2026-05-11): `findStateChildCloser` / `findEngineCloser` /
// `findOnTransitionCloser` in engine-statechild-parser.ts now track
// lowercase HTML opener depth separately, preventing premature state-child
// closure when a composite's body contains lowercase markup BEFORE a nested
// <engine>. Pre-fix this fixture fired
// E-ENGINE-STATE-CHILD-INVALID-VARIANT + E-ENGINE-RULE-INVALID-VARIANT.
// ===========================================================================

describe("engine-a7-hierarchy §7 — non-empty inner state-child bodies (Bug #1 fix)", () => {
  test("inner state-child with markup body compiles cleanly — no outer-engine mis-attribution", () => {
    // Canonical SPEC §51.0.Q.2 worked example: composite state-child with a
    // nested engine whose inner state-children carry non-empty markup
    // (`<button>Fight</button>` inside `<Exploring>`).
    //
    // Pre-fix: E-ENGINE-STATE-CHILD-INVALID-VARIANT fired for `<Exploring>`
    // / `<Battle>` against AppMode + E-ENGINE-RULE-INVALID-VARIANT for the
    // inner `rule=` targets. Post-fix: clean compilation.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle>
        <button>Fight</button>
      </>
      <Battle rule=.Exploring></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "inner-body");
    const fatal = errors.filter((e) => e.severity === "error");
    expect(fatal).toEqual([]);
    // The mis-attribution codes specifically must be absent.
    const misAttributionCodes = errors.filter(
      (e) =>
        e.code === "E-ENGINE-STATE-CHILD-INVALID-VARIANT" ||
        e.code === "E-ENGINE-RULE-INVALID-VARIANT",
    );
    expect(misAttributionCodes).toEqual([]);
  });

  test("lowercase markup BEFORE nested <engine> in composite body compiles cleanly", () => {
    // Adopter pattern: outer-scoped controls (a `<button>` for instance)
    // sit alongside the nested engine in the composite body. Pre-fix, any
    // lowercase HTML element BEFORE the nested <engine> opener corrupted
    // the depth counter inside findStateChildCloser, prematurely closing
    // <Playing> at `</button>` and leaking the inner engine's state-children
    // into the outer engine's registry.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <button>Pause game</button>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "outer-controls");
    const fatal = errors.filter((e) => e.severity === "error");
    expect(fatal).toEqual([]);
  });

  test("CLOSED (Bug #2): nested engine dispatcher emission inside composite arm body", () => {
    // Per SPEC §51.0.Q.1: nested engine has FULL engine semantics — including
    // its own dispatcher subscribing to the inner variable. A5-7 Wave 2.4
    // (Bug #2, 2026-05-11) widens engine discovery into engine-decl
    // bodyChildren, so nested engines now get substrate (transitions table,
    // variant cell init, dispatcher, render functions, history map if
    // applicable, internal table if applicable) — same as file-scope engines.
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle>
        <button onclick=fight()>Fight</>
      </>
      <Battle rule=.Exploring>
        <button onclick=flee()>Flee</>
      </>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "bug2-inner-dispatcher");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Inner engine substrate emits — transitions table, variant cell init.
    expect(clientJs).toContain("__scrml_engine_playMode_transitions");
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*"Exploring"\)/);
    // Inner engine render functions + dispatcher emit.
    expect(clientJs).toContain("_scrml_engine_playMode_render_Exploring");
    expect(clientJs).toContain("_scrml_engine_playMode_render_Battle");
    expect(clientJs).toContain("__scrml_engine_playMode_dispatch");
    // Inner dispatcher subscribes to the inner cell.
    expect(clientJs).toMatch(/_scrml_reactive_subscribe\("playMode",/);
    // Outer engine ALSO emits unchanged.
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(clientJs).toContain("__scrml_engine_appMode_dispatch");
  });

  test("Bug #2: tree-shake — flat engine (no nested) emits zero inner-engine code", () => {
    // Sanity: an engine WITHOUT nested engines must NOT trigger any
    // inner-dispatcher / inner-substrate emission. Tree-shake invariant.
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=go()>Go</>
  </>
  <Active rule=.Idle></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "bug2-treeshake-flat");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_phase_transitions");
    // No mention of any other engine.
    expect(clientJs).not.toMatch(/__scrml_engine_(?!phase)[a-zA-Z]+_transitions/);
    // No composite-arm postMountJs (no inner engine to init).
    expect(clientJs).not.toContain("§51.0.Q.1 composite-arm post-mount");
  });

  test("Bug #2: composite-arm postMountJs resets inner cell to initial on entry (no history)", () => {
    // Per SPEC §51.0.Q.1: "On outer entry … the inner engine is initialized
    // (per its `initial=`)". Without history, every entry to the composite
    // arm resets the inner cell. The codegen emits a `_scrml_reactive_set`
    // call inside the dispatcher branch for the composite arm.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <engine for=PlayMode initial=.A>
      <A rule=.B>
        <button onclick=ab()>A→B</>
      </>
      <B rule=.A>
        <button onclick=ba()>B→A</>
      </>
    </>
  </>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "bug2-init-on-entry");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Composite-arm post-mount block emits.
    expect(clientJs).toContain("§51.0.Q.1 composite-arm post-mount");
    // Inner cell reset to its initial=.
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*"A"\)/);
    // Tree-shake: WITHOUT history on this state-child, no synth-cell
    // reference and no pending-restore branch.
    expect(clientJs).not.toContain("_appMode_Playing_history");
    expect(clientJs).not.toContain("_scrml_engine_pending_history_restore[\"appMode\"]");
  });

  test("Bug #2: composite-arm with history emits restore-or-init branches", () => {
    // When the composite carries `history`, postMountJs emits BOTH branches:
    // restore from synth cell when pending-restore flag matches, fall through
    // to inner.initial= otherwise (empty-history fallback per §51.0.N).
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.A>
      <A rule=.B>
        <button onclick=ab()>A→B</>
      </>
      <B rule=.A>
        <button onclick=ba()>B→A</>
      </>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "bug2-history-restore-branch");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Restore branch references the synth-cell key.
    expect(clientJs).toContain("_appMode_Playing_history");
    expect(clientJs).toContain("_scrml_engine_pending_history_restore[\"appMode\"]");
    // Both restore (synth cell value) and fallback (inner initial) emit.
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*_saved\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*"A"\)/);
  });
});

// ===========================================================================
// §7.3 (S83 LANDED, 2026-05-11) — cascade-miss diagnostic per §51.0.Q.3
// ===========================================================================
//
// Closes the deferred §7.3 test from this file's prior version AND the
// A5-3 §A5-3.8 deferral noted in `a5-3-typer-walker.test.js`.
//
// SECOND compile-time E-ENGINE-INVALID-TRANSITION fire-site (fire-site #9
// in SYM PASS 16 — `validateEngineA5Extensions`). Direct-write enforcement
// inside engine state-child bodies via regex over `bodyRaw` (engine bodies
// are RAW TEXT per parser limitation primer §13.7 B14 specifics).
//
// Two canonical forms:
//   - `@varName = .Variant`         (assign per §51.0.F line 20847)
//   - `@varName.advance(.Variant)`  (advance per §51.0.G)
//
// Composite-aware message framing per §51.0.Q.3 OQ-Harel-6 verdict: when
// the surrounding state-child is composite (`innerEngines.length > 0`),
// the diagnostic message names both the composite AND the engine variable
// + type. No new error code — extends E-ENGINE-INVALID-TRANSITION message
// form per spec §51.0.Q.3 line 21617-21619.

describe("engine-a7-hierarchy §7.3 — cascade-miss diagnostic (§51.0.Q.3)", () => {
  test("composite cascade-miss — inner <engine> BEFORE write produces composite framing", () => {
    // Canonical §51.0.Q.3 worked example shape: write inside <Playing> body
    // targeting .Inventory is rejected by the composite's rule=(.Title|.Paused).
    // The inner <engine> must appear BEFORE the offending write in source
    // order so the body-parser surfaces innerEngines.length > 0 for <Playing>
    // (current parser limitation — see §7 deferred bug surface above).
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused, Inventory }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
    <button onclick=\${ @appMode = .Inventory }>Wrong</button>
  </>
  <Paused rule=.Playing></>
  <Inventory rule=.Playing></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    const msg = errs[0].message;
    // Composite framing per spec §51.0.Q.3 line 21610-21613:
    expect(msg).toContain("composite");
    expect(msg).toContain("<Playing>");
    expect(msg).toContain("appMode");
    expect(msg).toContain("AppMode");
    expect(msg).toContain("@appMode = .Inventory");
    expect(msg).toContain(".Title");
    expect(msg).toContain(".Paused");
  });

  test("flat (non-composite) state-child fires E-ENGINE-INVALID-TRANSITION with canonical framing", () => {
    // Same diagnostic code (no new error per spec §51.0.Q.3 line 21617-21619),
    // but message uses the canonical "<tag>'s rule=" framing — composite
    // framing is reserved for state-children with inner <engine>.
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ @phase = .Done }>Wrong</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    const msg = errs[0].message;
    expect(msg).toContain("@phase = .Done");
    expect(msg).toContain("<Idle>");
    expect(msg).toContain(".Active");
    // Flat case does NOT use composite framing:
    expect(msg).not.toContain("composite");
  });

  test("legal direct write inside state-child body — NO error", () => {
    // .Active is the single legal target per rule=.Active.
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ @phase = .Active }>OK</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(0);
  });

  test(".advance(.Variant) form: illegal advance fires E-ENGINE-INVALID-TRANSITION", () => {
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ @phase.advance(.Done) }>Wrong</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("@phase.advance(.Done)");
    expect(errs[0].message).toContain(".Active");
  });

  test("multi-target rule= with illegal target: fires with multi-target framing", () => {
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Active>
  <Idle rule=.Active></>
  <Active rule=(.Idle | .Done)>
    <button onclick=\${ @phase = .Active }>Wrong</button>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    const msg = errs[0].message;
    expect(msg).toContain("@phase = .Active");
    expect(msg).toMatch(/multi-target|\.Idle.*\.Done|\.Done.*\.Idle/);
  });

  test("wildcard rule=* — no error on any direct-write target", () => {
    // §51.0.F documented escape hatch: rule=* accepts any variant.
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=*>
    <button onclick=\${ @phase = .Done }>OK</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(0);
  });

  test("terminal state (rule= absent): ANY direct write fires", () => {
    const src = `\${ type Phase:enum = { Idle, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Done></>
  <Done>
    <button onclick=\${ @phase = .Idle }>Wrong</button>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    const msg = errs[0].message;
    expect(msg).toContain("<Done>");
    expect(msg).toMatch(/terminal|no.*rule=/i);
  });

  test("qualified-name form (Type.Variant) — silently NOT scanned (out of scope)", () => {
    // Only bare-dot .Variant form is scanned by the raw-text walker.
    // Qualified Type.Variant writes need identifier resolution beyond raw
    // text; adopters needing precision can use rule=* escape hatch.
    const src = `\${ type Phase:enum = { Idle, Active, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ @phase = Phase.Done }>Skipped</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(0);
  });

  test("unrelated cell with shared prefix — identifier-bounded match (no false-positive)", () => {
    // The walker's regex uses (?!\\w) after varName so `phaseX` does NOT
    // match when scanning for `@phase`.
    const src = `\${
      type Phase:enum = { Idle, Active, Done }
      let phaseX = 0
    }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ phaseX = 1 }>OK</button>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(0);
  });

  test("target not in engine for=Type variants: silent (other diagnostic owns the case)", () => {
    // When the write targets `.Banana` which is not a variant of `Phase`,
    // the cascade-miss walker skips silently — a different error fires
    // elsewhere (type-system / B20). Mirrors fire-site #3's gating pattern.
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <button onclick=\${ @phase = .Banana }>Type error elsewhere</button>
  </>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    // The cascade-miss walker does NOT fire E-ENGINE-INVALID-TRANSITION for
    // a non-variant target — different diagnostic owns it.
    const errs = sym.errors.filter((e) => e.code === "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(0);
  });
});
