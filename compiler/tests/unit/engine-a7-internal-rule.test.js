/* SPDX-License-Identifier: MIT
 *
 * engine-a7-internal-rule.test.js — A5-7 Bucket 1 (S83, 2026-05-11)
 *
 * Behavioral test coverage for the `internal:rule=` prefix on composite
 * engine state-children (SPEC §51.0.O, S67 amendment). Complements:
 *   - compiler/tests/unit/a5-2-parser-support.test.js §A5-2.3 (parser)
 *   - compiler/tests/unit/a5-3-typer-walker.test.js §A5-3.2/§A5-3.6 (typer)
 *
 * This file focuses on the OBSERVABLE BEHAVIOR end-to-end:
 *   §1. usage-analyzer.engineInternalRules flag fires when any state-child
 *       carries internal:rule=
 *   §2. usage-analyzer.engineInternalRules does NOT fire when no internal:rule=
 *       present (tree-shake intent)
 *   §3. EngineStateChildEntry.internalRule populated correctly per state-child
 *   §4. Canonical §51.0.O composite with mixed rule= + internal:rule= compiles
 *   §5. E-INTERNAL-RULE-NOT-COMPOSITE flow-through from typer to compileScrml
 *   §6. Anonymous absence shape on state-children without internal:rule=
 *
 * KNOWN DEFERRALS (Wave 4 — out of A5-7 source-no-change scope):
 *   - Distinct internal-vs-external write path codegen (currently both
 *     prefixes lower to the same external transition).
 *   - Inner-engine lifecycle preservation on internal transitions.
 *   - Outer <onTransition> handler exclusion on internal transitions.
 *   All marked .skip with cite below per A5-7 brief.
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

function findEngineDecl(ast) {
  let found = null;
  function walk(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.kind === "engine-decl") { if (!found) found = n; return; }
      if (n.children) walk(n.children);
      if (n.body) walk(n.body);
    }
  }
  walk(ast.nodes || []);
  if (!found && ast.machineDecls) {
    for (const m of ast.machineDecls) {
      if (m && m.kind === "engine-decl") { found = m; break; }
    }
  }
  return found;
}

function compileToClientJs(source, suffix = "internal-rule") {
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
// §1. usage-analyzer.engineInternalRules fires when internal:rule= present
// ===========================================================================

describe("engine-a7-internal-rule §1 — usage-analyzer engineInternalRules (fires)", () => {
  test("composite with internal:rule= → engineInternalRules=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>`;
    const { ast, sym } = runUpToSYM(src);
    // Composite — should not fire E-INTERNAL-RULE-NOT-COMPOSITE.
    expect(sym.errors.filter((e) => e.code === "E-INTERNAL-RULE-NOT-COMPOSITE")).toEqual([]);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineInternalRules).toBe(true);
  });

  test("multi-target internal:rule=(.A | .B) → engineInternalRules=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused) internal:rule=(.Playing | .Title)>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineInternalRules).toBe(true);
  });

  test("wildcard internal:rule=* → engineInternalRules=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=*>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineInternalRules).toBe(true);
  });
});

describe("engine-a7-internal-rule §2 — usage-analyzer engineInternalRules (tree-shake)", () => {
  test("no internal:rule= anywhere → engineInternalRules=false", () => {
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineInternalRules).toBe(false);
  });

  test("composite without internal:rule= → engineInternalRules=false", () => {
    // Composite state-child exists (has nested <engine>) but NO internal:rule=.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineInternalRules).toBe(false);
  });
});

// ===========================================================================
// §3. EngineStateChildEntry.internalRule per state-child
// ===========================================================================

describe("engine-a7-internal-rule §3 — internalRule field on state-child entries", () => {
  test("only the composite carries non-absent internalRule", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { ast } = runUpToSYM(src);
    const engine = findEngineDecl(ast);
    expect(engine).not.toBeNull();
    const meta = engine?._record?.engineMeta;
    expect(meta).toBeDefined();
    const byTag = Object.fromEntries(meta.stateChildren.map((sc) => [sc.tag, sc]));

    expect(byTag.Title?.internalRule?.kind).toBe("absent");
    expect(byTag.Playing?.internalRule?.kind).toBe("single");
    expect(byTag.Playing?.internalRule?.target).toBe("Playing");
    expect(byTag.Paused?.internalRule?.kind).toBe("absent");
  });

  test("internal:rule=(.A | .B) populates kind=multi with both targets", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Paused) internal:rule=(.Playing | .Title)>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { ast } = runUpToSYM(src);
    const engine = findEngineDecl(ast);
    const playing = engine._record.engineMeta.stateChildren.find((sc) => sc.tag === "Playing");
    expect(playing?.internalRule?.kind).toBe("multi");
    expect(playing?.internalRule?.targets).toEqual(["Playing", "Title"]);
  });

  test("internal:rule=* populates kind=wildcard", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=*>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const engine = findEngineDecl(ast);
    const playing = engine._record.engineMeta.stateChildren.find((sc) => sc.tag === "Playing");
    expect(playing?.internalRule?.kind).toBe("wildcard");
  });
});

// ===========================================================================
// §4. Canonical §51.0.O example compiles clean end-to-end
// ===========================================================================

describe("engine-a7-internal-rule §4 — canonical §51.0.O example compiles end-to-end", () => {
  test("composite with both rule= and internal:rule= — no errors", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "ir-canon");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    // External rule= target lands in the transition table.
    expect(clientJs).toMatch(/"Playing":\s*\[\s*"Title"\s*\]/);
  });

  test("internal:rule= alone (no canonical rule=) — composite-only is still legal per spec", () => {
    // §51.0.O: both prefixes may coexist; or just internal:rule= alone. (Note:
    // a composite with no canonical rule= and only internal:rule= effectively
    // has no external exit — the composite is "trapped" but well-formed.)
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing internal:rule=.Playing>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "ir-alone");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
  });
});

// ===========================================================================
// §5. E-INTERNAL-RULE-NOT-COMPOSITE surfaces through compileScrml() result
// ===========================================================================

describe("engine-a7-internal-rule §5 — E-INTERNAL-RULE-NOT-COMPOSITE conformance", () => {
  test("internal:rule= on non-composite state-child fires E-INTERNAL-RULE-NOT-COMPOSITE", () => {
    // <Active> has no nested <engine> — it's a non-composite state-child.
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=.Active></>
</>`;
    const { errors } = compileToClientJs(src, "ir-noncomp");
    const fired = errors.filter((e) => e.code === "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  test("internal:rule= on composite state-child does NOT fire", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "ir-comp-ok");
    const fired = errors.filter((e) => e.code === "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(fired).toEqual([]);
  });

  test("internal:rule=* wildcard on non-composite still fires E-INTERNAL-RULE-NOT-COMPOSITE", () => {
    // Wildcard internal:rule= is also forbidden on non-composite (a5-3 §A5-3.2).
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=*></>
</>`;
    const { errors } = compileToClientJs(src, "ir-wild-noncomp");
    const fired = errors.filter((e) => e.code === "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// §6. Absent-shape default on state-children without internal:rule=
// ===========================================================================

describe("engine-a7-internal-rule §6 — internalRule absence shape", () => {
  test("every state-child without internal:rule= has internalRule.kind='absent'", () => {
    const src = `\${ type Phase:enum = { A, B, C } }
<engine for=Phase initial=.A>
  <A rule=.B></>
  <B rule=.C></>
  <C rule=.A></>
</>`;
    const { ast } = runUpToSYM(src);
    const engine = findEngineDecl(ast);
    const meta = engine._record.engineMeta;
    for (const sc of meta.stateChildren) {
      expect(sc.internalRule?.kind).toBe("absent");
    }
  });
});

// ===========================================================================
// Wave-4 deferred behavior
// ===========================================================================

// ===========================================================================
// §7. Distinct internal-vs-external write path codegen (Wave 2.2 — landed)
//
// Per SPEC §51.0.O. The three behavioral concerns:
//   (a) inner-engine lifecycle preservation across internal: transition
//   (b) outer <onTransition> exclusion on internal transition
//   (c) history-cell write skip on internal transition (blocked on Bug #3)
//
// These tests assert the CODEGEN SHAPE — the deterministic compile-time
// surface that runtime behavior rides on. Browser/JSDOM runtime verification
// is a v2 follow-up via the same test path once the per-arm DOM scaffolding
// is mountable from a unit-test harness; today the codegen contract IS the
// regression anchor (the runtime helpers in runtime-template.js carry plain
// JS semantics that match the contract — see §51.0.O comments inline).
// ===========================================================================

describe("engine-a7-internal-rule §7 — distinct write path codegen", () => {
  test("internal:rule= emits per-engine internal transition table + threads to direct_set", () => {
    // Per SPEC §51.0.O: an internal transition does NOT exit the composite.
    // Inner engine's lifecycle is preserved — no re-init, no history write/read.
    //
    // Codegen contract (Wave 2.2):
    //   1. Engine with any internal:rule= emits a sibling const named
    //      __scrml_engine_<varName>_internal_transitions with the same shape
    //      as the canonical __scrml_engine_<varName>_transitions table —
    //      keyed by from-variant tag, values are encoded internal-rule entries.
    //   2. Direct-write call sites pass the internal-table identifier as the
    //      trailing positional arg to _scrml_engine_direct_set so the runtime
    //      can branch on internal vs external at write time.
    //   3. The internal-table entry for a state-child WITHOUT internal:rule=
    //      is the terminal `[]` (no internal targets from this state).
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>

<button onclick=\${@appMode = AppMode.Playing}>Start</>
<button onclick=\${@appMode = AppMode.Title}>Quit</>`;
    const { errors, clientJs } = compileToClientJs(src, "ir-w22-tables");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // (1) Internal transition table emitted as a sibling const.
    expect(clientJs).toContain("__scrml_engine_appMode_internal_transitions");

    // (2) Internal table entry for .Playing carries the internal target.
    //     Shape: "Playing": ["Playing"] — self-loop preserving inner engine.
    expect(clientJs).toMatch(/__scrml_engine_appMode_internal_transitions[\s\S]*?"Playing":\s*\[\s*"Playing"\s*\]/);

    // (3) State-children WITHOUT internal:rule= encode as terminal `[]`.
    expect(clientJs).toMatch(/__scrml_engine_appMode_internal_transitions[\s\S]*?"Title":\s*\[\s*\]/);

    // (4) Canonical external transitions table is preserved (sanity — both
    //     surfaces co-exist; the internal addition does not displace the
    //     external one).
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(clientJs).toMatch(/__scrml_engine_appMode_transitions[\s\S]*?"Playing":\s*\[\s*"Title"\s*\]/);
  });

  test("<onTransition> on composite does NOT fire on internal transition (codegen gate)", () => {
    // Per §51.0.O cross-ref to §51.0.H: <onTransition> handlers attached to a
    // composite state-child do NOT fire on internal transitions. The runtime
    // implements this by having _scrml_engine_direct_set / _scrml_engine_advance
    // return a boolean (true=external, false=internal). Codegen wraps the
    // engine-write site with a capture-pre + conditional hook-fire-post; the
    // post-commit fire is gated on the boolean.
    //
    // Codegen contract:
    //   - Direct-write hook-firing wrap: `const __scrml_engine_external =
    //     _scrml_engine_direct_set(...); if (__scrml_engine_external)
    //     __scrml_engine_<varName>_fire_hooks(...)`.
    //   - The internal-transitions table identifier is threaded as the
    //     trailing arg to direct_set, so the runtime branch is reachable.
    //
    // Test shape: place <onTransition to=.Title> in <Playing> — the hook fires
    // on the EXTERNAL Playing → .Title transition (legal via canonical
    // rule=.Title). Internal Playing → Playing (via internal:rule=.Playing)
    // takes the INTERNAL branch and skips the hook fire.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title internal:rule=.Playing>
    <onTransition to=.Title>\${ console.log("external transition fired") }</>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>

\${ function trigger() { @appMode = AppMode.Title } }`;
    const { errors, clientJs } = compileToClientJs(src, "ir-w22-hooks");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // Engine has a hook (effect= / <onTransition>); the wrap should be present.
    expect(clientJs).toContain("__scrml_engine_appMode_fire_hooks");

    // The wrap captures the boolean return and gates the hook-fire on it.
    // The exact identifier name is __scrml_engine_external (set by codegen).
    expect(clientJs).toMatch(/const __scrml_engine_external = _scrml_engine_direct_set\(/);
    expect(clientJs).toMatch(/if \(__scrml_engine_external\) __scrml_engine_appMode_fire_hooks\(/);

    // The internal-transitions table identifier must be threaded to the
    // direct_set call site — otherwise the runtime can't reach the internal
    // branch. The expected positional shape (with no timers / no idle but with
    // internal-rules in scope): direct_set(name, value, externalTable, null,
    // null, internalTable). Position-padding emits two `null` args before the
    // internal-table identifier so positional alignment holds.
    expect(clientJs).toMatch(/_scrml_engine_direct_set\([\s\S]*?__scrml_engine_appMode_internal_transitions\)/);
  });

  test.skip("history cell is NOT written on internal transition (blocked on Bug #3)", () => {
    // Per §51.0.O cross-ref to §51.0.N: internal transitions don't write to
    // the history cell (because the composite doesn't exit). Verifying this
    // codegen contract requires the history synth-cell emission to be in
    // place — that's Bug #3 (history synth-cell), a separate Wave 2.3
    // dispatch. The runtime path already honors the spec (the internal
    // branch in _scrml_engine_direct_set does NOT call any history-write
    // hook; when Bug #3 lands and adds the history-write hook to the
    // EXTERNAL branch only, the internal branch's skip is by construction).
    //
    // This test stays .skip until Bug #3 ships. Once the history synth-cell
    // is emitted, the assertion shape becomes (sketch):
    //   const src = `... <Playing history rule=.Title internal:rule=.Playing> ...`;
    //   const { clientJs } = compileToClientJs(src, "ir-w22-hist");
    //   // Verify the history-write hook is gated on the EXTERNAL boolean
    //   // (or equivalently: lives in the external branch of _scrml_engine_*_set).
    //   expect(clientJs).toMatch(/if \(__scrml_engine_external\)[\s\S]*?_appMode_Playing_history/);
  });

  test("tree-shake — composite without internal:rule= emits NO internal-path metadata", () => {
    // Per the codegen tree-shake contract: engines whose state-children have
    // ZERO internal:rule= declarations emit NO __scrml_engine_<varName>_internal_transitions
    // const, and call sites omit the trailing internal-table arg. This is the
    // dual of the §51.0.O surface — adopters who don't use internal:rule= pay
    // zero bytes for it.
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
</>

<button onclick=\${@appMode = AppMode.Playing}>Start</>`;
    const { errors, clientJs } = compileToClientJs(src, "ir-w22-treeshake");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // (1) The external transition table emits as usual.
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");

    // (2) The internal transition table does NOT emit — zero internal:rule=
    //     means zero internal-path metadata.
    expect(clientJs).not.toContain("__scrml_engine_appMode_internal_transitions");

    // (3) Defensive: no direct_set call site threads the internal-table
    //     identifier (the const doesn't exist, so threading it would be a
    //     ReferenceError at module-init).
    expect(clientJs).not.toContain("_internal_transitions");
  });
});
