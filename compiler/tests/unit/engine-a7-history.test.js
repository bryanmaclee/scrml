/* SPDX-License-Identifier: MIT
 *
 * engine-a7-history.test.js — A5-7 Bucket 1 (S83, 2026-05-11)
 *
 * Behavioral test coverage for the `history` attribute on composite engine
 * state-children (SPEC §51.0.N, S67 amendment) and the `.Variant.history`
 * structured-variant-target form. Complements:
 *   - compiler/tests/unit/a5-2-parser-support.test.js §A5-2.2/§A5-2.6 (parser)
 *   - compiler/tests/unit/a5-3-typer-walker.test.js §A5-3.1/§A5-3.7 (typer)
 *
 * This file focuses on the OBSERVABLE BEHAVIOR end-to-end:
 *   §1. usage-analyzer.engineHistory flag fires when any state-child carries `history`.
 *   §2. usage-analyzer.engineHistory does NOT fire when no `history` present (tree-shake intent).
 *   §3. EngineStateChildEntry.historyAttr is populated correctly on each state-child.
 *   §4. `.Variant.history` rule= target parses with historyForm=true (round-trip).
 *   §5. Compiler accepts canonical §51.0.N example end-to-end (no errors).
 *   §6. E-HISTORY-NO-INNER-ENGINE flow-through from typer to compileScrml result.
 *
 * KNOWN DEFERRALS (Wave 4 — out of A5-7 source-no-change scope):
 *   - Synth cell `@_<outerVar>_<variant>_history` emission (emit-engine.ts:532
 *     comment — variant name currently flattened, history modifier dropped).
 *   - Inner-engine variant restore on outer re-entry.
 *   - Outer-exit write hook + outer-entry restore hook.
 *   All marked .skip with cite below per A5-7 brief (do NOT fix source).
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { analyzeUsage } from "../../src/codegen/usage-analyzer.ts";
import { parseRuleAttrValue } from "../../src/engine-statechild-parser.ts";
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
      if (n.kind === "engine-decl") {
        if (!found) found = n;
        return;
      }
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

function compileToClientJs(source, suffix = "history") {
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
// §1. usage-analyzer.engineHistory fires when any state-child carries `history`
// ===========================================================================

describe("engine-a7-history §1 — usage-analyzer engineHistory flag (fires)", () => {
  test("single composite state-child with history → engineHistory=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing></>
</>`;
    const { ast, sym } = runUpToSYM(src);
    // Make sure typer didn't reject the canonical shape.
    expect(sym.errors.filter((e) => e.code === "E-HISTORY-NO-INNER-ENGINE")).toEqual([]);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineHistory).toBe(true);
  });

  test("history on multiple composite state-children — engineHistory still true", () => {
    const src = `\${
      type AppMode:enum  = { Active, Paused, Stopped }
      type Sub:enum      = { A, B }
    }
<engine for=AppMode initial=.Active>
  <Active history rule=(.Paused | .Stopped)>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Paused history rule=(.Active | .Stopped)>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
  <Stopped></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineHistory).toBe(true);
  });
});

describe("engine-a7-history §2 — usage-analyzer engineHistory flag (tree-shake)", () => {
  test("no history on any state-child → engineHistory=false (tree-shake intent)", () => {
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const usage = analyzeUsage({ nodes: ast.nodes });
    expect(usage.engineHistory).toBe(false);
  });

  test("composite state-child WITHOUT history → engineHistory=false", () => {
    // Composite (has nested <engine>) but no `history` bareword.
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
    expect(usage.engineHistory).toBe(false);
  });
});

// ===========================================================================
// §3. EngineStateChildEntry.historyAttr populated correctly per state-child
// ===========================================================================

describe("engine-a7-history §3 — historyAttr field on state-child entries", () => {
  test("only the state-child with `history` bareword carries historyAttr=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
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
    expect(Array.isArray(meta?.stateChildren)).toBe(true);
    const byTag = Object.fromEntries(meta.stateChildren.map((sc) => [sc.tag, sc]));
    expect(byTag.Title?.historyAttr).toBeFalsy();
    expect(byTag.Playing?.historyAttr).toBe(true);
    expect(byTag.Paused?.historyAttr).toBeFalsy();
  });

  test("empty state-child with history attr (no inner engine) — fires E-HISTORY-NO-INNER-ENGINE", () => {
    // Per SPEC §51.0.N + a5-3 §A5-3.1: history on a non-composite (no inner
    // <engine> in body) is a typer error.
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle history rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = sym.errors.filter((e) => e.code === "E-HISTORY-NO-INNER-ENGINE");
    expect(errs.length).toBe(1);
  });
});

// ===========================================================================
// §4. `.Variant.history` rule= target parses with historyForm flag
// ===========================================================================

describe("engine-a7-history §4 — .Variant.history target form parsing", () => {
  test("single-target rule=.X.history yields historyForm=true", () => {
    const r = parseRuleAttrValue(".Playing.history");
    expect(r.kind).toBe("single");
    expect(r.target).toBe("Playing");
    expect(r.historyForm).toBe(true);
  });

  test("single-target rule=.X (no .history suffix) → historyForm absent or false", () => {
    const r = parseRuleAttrValue(".Playing");
    expect(r.kind).toBe("single");
    expect(r.target).toBe("Playing");
    expect(r.historyForm).toBeFalsy();
  });

  test("multi-target rule=(.A.history | .B) — historyForms aligned per target", () => {
    const r = parseRuleAttrValue("(.A.history | .B)");
    expect(r.kind).toBe("multi");
    expect(r.targets).toEqual(["A", "B"]);
    expect(Array.isArray(r.historyForms)).toBe(true);
    expect(r.historyForms[0]).toBe(true);
    expect(r.historyForms[1]).toBeFalsy();
  });

  test("multi-target all-history rule=(.A.history | .B.history) → both true", () => {
    const r = parseRuleAttrValue("(.A.history | .B.history)");
    expect(r.kind).toBe("multi");
    expect(r.historyForms).toEqual([true, true]);
  });
});

// ===========================================================================
// §5. Canonical §51.0.N composite + .Variant.history compiles clean
// ===========================================================================

describe("engine-a7-history §5 — canonical §51.0.N example compiles end-to-end", () => {
  test("composite with history + .Variant.history rule= target — no errors", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "history-canon");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Outer engine transitions table is emitted normally.
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    // Outer dispatcher subscribes to appMode.
    expect(clientJs).toContain('_scrml_reactive_subscribe("appMode"');
  });

  test("rule=.Variant.history flattens to base variant in emitted transitions table (Wave 4 deferral)", () => {
    // OBSERVABLE TODAY (emit-engine.ts:532 comment): the .history suffix is
    // dropped from the encoded target. <Paused rule=.Playing.history> emits
    // "Paused":["Playing"], not a separate ".Playing.history" target.
    // This test documents the current behavior and will need updating when
    // synth-cell emission lands.
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "history-flatten");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Flattened target: rule=.Playing.history → "Paused": ["Playing"] (no ".history" suffix)
    expect(clientJs).toMatch(/"Paused":\s*\[\s*"Playing"\s*\]/);
  });
});

// ===========================================================================
// §6. E-HISTORY-NO-INNER-ENGINE surfaces through compileScrml() result
// ===========================================================================

describe("engine-a7-history §6 — E-HISTORY-NO-INNER-ENGINE conformance via compileScrml", () => {
  test("history on non-composite state-child surfaces E-HISTORY-NO-INNER-ENGINE", () => {
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle history rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { errors } = compileToClientJs(src, "history-noninner");
    const fired = errors.filter((e) => e.code === "E-HISTORY-NO-INNER-ENGINE");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  test("history on composite (has inner engine) — does NOT fire E-HISTORY-NO-INNER-ENGINE", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=.Title>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { errors } = compileToClientJs(src, "history-composite-ok");
    const fired = errors.filter((e) => e.code === "E-HISTORY-NO-INNER-ENGINE");
    expect(fired).toEqual([]);
  });
});

// ===========================================================================
// §7. Synth-cell + history-map emission (Wave 2.3, Bug #3 — A5-7 codegen)
// ===========================================================================

describe("engine-a7-history §7 — synth-cell emission + history-map (Bug #3, Wave 2.3)", () => {
  test("composite with history emits per-engine history-map const + synth-cell init", () => {
    // Per SPEC §51.0.N: a state-child carrying `history` causes the compiler
    // to synthesize a reactive cell `@_<outerVar>_<variantName>_history` and a
    // per-engine history-map const `__scrml_engine_<outerVar>_history_map`
    // recording {outerVariant → innerEngineVarName}. The synth cell starts at
    // `null` (empty-history fallback per §51.0.N).
    //
    // Wave 2.3 (Bug #3) ships:
    //   - history-map const emitted per engine with at least one composite
    //     history state-child + discoverable inner-engine var.
    //   - per-state-child synth-cell init line `_scrml_state[<key>] = null;`.
    //   - history-map threaded as the 7th positional arg to
    //     `_scrml_engine_direct_set` / `_scrml_engine_advance` at canonical
    //     write-guard call sites (function bodies, `.advance()` calls;
    //     event-handler shortcut path bypasses engine-write-guard pending
    //     Bug #6 — out of scope for Bug #3).
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "history-w23-emit");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // (1) Per-engine history-map const emitted alongside the transitions
    //     table. Keyed by outer variant tag; value is inner-engine var name.
    expect(clientJs).toContain("__scrml_engine_appMode_history_map");
    expect(clientJs).toMatch(/__scrml_engine_appMode_history_map\s*=\s*Object\.freeze\(\{[\s\S]*?"Playing":\s*"playMode"/);

    // (2) Per-state-child synth-cell init line. Key shape:
    //     "_<outerVar>_<stateTag>_history" — null at module-init (empty-
    //     history fallback per §51.0.N "Empty-history fallback" paragraph).
    expect(clientJs).toContain('_scrml_state["_appMode_Playing_history"] = null');

    // (3) Non-history state-children (Title, Paused) do NOT get synth cells.
    expect(clientJs).not.toContain('_scrml_state["_appMode_Title_history"]');
    expect(clientJs).not.toContain('_scrml_state["_appMode_Paused_history"]');

    // (4) Canonical transitions table is preserved (sanity — history surface
    //     is additive; flattens `.Variant.history` to base variant for
    //     legality (transitions-table semantics) — distinguishability moves
    //     to the WRITE form, not the rule= legality).
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
  });

  test("outer-exit through write-guard threads history-map to runtime helper", () => {
    // Per SPEC §51.0.N: on outer-exit from a composite carrying `history`,
    // the inner engine's current variant is written to the history cell. The
    // runtime path is: codegen passes `__scrml_engine_<varName>_history_map`
    // as the 7th positional arg to `_scrml_engine_direct_set` /
    // `_scrml_engine_advance`. The runtime EXTERNAL branch reads
    // `historyMap[currentVariant]` — when non-null AND current !== target
    // (real exit, not self-loop), captures `_scrml_state[innerVarName]` into
    // the synth cell `_scrml_state["_" + outerVar + "_" + current + "_history"]`.
    //
    // Test shape: use a function body to write `@appMode = AppMode.Title` —
    // function-body writes route through emit-logic.ts's engine-binding
    // dispatch, which calls emitEngineWriteGuard → emits the canonical
    // `_scrml_engine_direct_set` helper call with the historyMap arg.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=.Title>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>

\${ function leavePlaying() { @appMode = AppMode.Title } }`;
    const { errors, clientJs } = compileToClientJs(src, "history-w23-writeguard");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // (1) The function body's engine write dispatches through the canonical
    //     write-guard (NOT the event-handler shortcut path which is Bug #6
    //     territory — out of scope here).
    expect(clientJs).toContain("_scrml_engine_direct_set");

    // (2) The history-map identifier is threaded as the trailing positional
    //     arg. Engine has no timers / no idle / no internal:rule= in this
    //     test, so the position-padding emits three `null` args before
    //     the history-map identifier to maintain positional alignment.
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("appMode",[^,]+,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*__scrml_engine_appMode_history_map\)/,
    );
  });

  test("tree-shake: engine without `history` attr emits NO history-map + NO synth cells", () => {
    // Per §51.0.N tree-shake invariant: when zero engines in a project
    // declare `history`, the synth-cell infrastructure + outer-exit write
    // hook + outer-entry restore hook are all elided from emit. Verifies
    // the codegen tree-shake contract — adopters who don't use history
    // pay zero bytes for it.
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

\${ function go() { @appMode = AppMode.Playing } }`;
    const { errors, clientJs } = compileToClientJs(src, "history-w23-treeshake");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // (1) NO history-map const emits anywhere (per-engine tree-shake).
    expect(clientJs).not.toContain("__scrml_engine_appMode_history_map");
    expect(clientJs).not.toContain("history_map");

    // (2) NO synth-cell init lines for any state-child.
    expect(clientJs).not.toContain("_history");
    expect(clientJs).not.toContain("_scrml_state[\"_appMode");

    // (3) Canonical transitions table + write-guard still emit normally —
    //     non-history engines are not regressed.
    expect(clientJs).toContain("__scrml_engine_appMode_transitions");
    expect(clientJs).toContain("_scrml_engine_direct_set");

    // (4) The write-guard call has NO history-map arg appended. With no
    //     timers / idle / internal-rule / history, the call shape is the
    //     canonical 3-arg form (varName, value, table).
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("appMode",[^,]+,\s*__scrml_engine_appMode_transitions\)/,
    );
  });
});

// ===========================================================================
// §8. Restore-on-re-entry codegen — Bug #2 + restore-form lowering (Wave 2.4)
// ===========================================================================
//
// Per SPEC §51.0.N: writes via `.Variant.history` form lower distinctly from
// bare `.Variant`. The history-form write threads `isHistoryRestore=true`
// (8th positional arg) to `_scrml_engine_direct_set` / `_scrml_engine_advance`;
// the runtime helper sets the pending-restore flag on the outer var; the
// outer dispatcher's composite-arm postMountJs reads + clears the flag and
// restores inner from the synth cell when set.
//
// A5-7 Wave 2.4 (Bug #2, 2026-05-11) ships the codegen plumbing end-to-end:
//   - WRITE SITE: `@outerVar = .Variant.history` → strip `.history` from the
//     emitted value, pass `true` for `isHistoryRestore`. Bare `.Variant`
//     omits the flag (tree-shake).
//   - DISPATCHER POSTMOUNTJS: composite-arm with `history` reads pending flag,
//     restores from synth cell (or falls through to inner.initial= on null —
//     empty-history fallback per §51.0.N).
//   - RUNTIME: `_scrml_engine_direct_set` accepts the 8th arg, sets the
//     pending-restore flag in `_scrml_engine_pending_history_restore[outerVar]`
//     BEFORE the cell write so the subscriber fire sees the flag.
//
// Observable DOM-level verification (inner mount innerHTML matches saved
// variant on re-entry) would require a JSDOM/Puppeteer integration test;
// that's deferred to the v0.2.0-bar A5-7 integration suite. These tests
// verify the CODEGEN SHAPE is correct end-to-end.

describe("engine-a7-history §8 — restore-form write-site lowering (Wave 2.4)", () => {
  test("`.Variant.history` write strips `.history` and threads isHistoryRestore=true", () => {
    // Per SPEC §51.0.N: writes via `.Variant.history` lower distinctly. The
    // emitted value is the bare variant tag (no JS-level .history member
    // access — which would runtime-fail since variant strings have no
    // .history property); the isHistoryRestore flag is threaded as the
    // trailing positional arg.
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>

\${ function resume() { @appMode = AppMode.Playing.history } }`;
    const { errors, clientJs } = compileToClientJs(src, "w24-history-write");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The lowered call: bare `AppMode.Playing` (no `.history` chain), and
    // trailing `true` as the isHistoryRestore positional arg. Engine has
    // history + no timers/idle/internal, so the call shape is:
    //   _scrml_engine_direct_set("appMode", AppMode.Playing, table, null, null, null, history_map, true)
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*__scrml_engine_appMode_history_map,\s*true\)/,
    );
    // Sanity: no `.history` member access on the variant string.
    expect(clientJs).not.toContain("AppMode.Playing.history");
  });

  test("bare `.Variant` (no `.history`) does NOT thread isHistoryRestore", () => {
    // Negative case: bare-variant write must NOT emit the trailing `true`.
    // This is the tree-shake side of the restore-form lowering.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { A, B }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=.Title>
    <engine for=PlayMode initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>

\${ function leave() { @appMode = AppMode.Title } }`;
    const { errors, clientJs } = compileToClientJs(src, "w24-bare-write");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Call shape with history but WITHOUT isHistoryRestore — trailing `true`
    // must be absent.
    expect(clientJs).toMatch(
      /_scrml_engine_direct_set\("appMode",\s*AppMode\.Title,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*__scrml_engine_appMode_history_map\)/,
    );
    // Confirm: the close paren immediately after the history_map arg (no
    // ", true" trailing).
    expect(clientJs).not.toMatch(
      /_scrml_engine_direct_set\("appMode"[^)]*__scrml_engine_appMode_history_map,\s*true\)/,
    );
  });

  test("dispatcher composite-arm postMountJs has both restore-from-synth AND fallback branches", () => {
    // Verifies the codegen shape: when the state-child carries `history`,
    // the postMountJs emits the read+clear of the pending-restore flag AND
    // the empty-history fallback path (synth cell null → reset to
    // inner.initial=).
    const src = `\${
      type AppMode:enum  = { Title, Playing, Paused }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing history rule=(.Title | .Paused)>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
  <Paused rule=.Playing.history></>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "w24-dispatcher-shape");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // postMountJs marker + flag read.
    expect(clientJs).toContain("§51.0.Q.1 composite-arm post-mount: init/restore inner engine playMode");
    expect(clientJs).toContain('_scrml_engine_pending_history_restore["appMode"]');
    expect(clientJs).toContain('_pending === "Playing"');
    // Read+clear pattern.
    expect(clientJs).toContain('delete _scrml_engine_pending_history_restore["appMode"]');
    // Synth-cell read.
    expect(clientJs).toContain('_scrml_state["_appMode_Playing_history"]');
    // Restore-from-synth + fallback-to-initial branches both present.
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*_saved\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("playMode",\s*"Exploring"\)/);
  });

  test(".advance(.Variant.history) — write-site lowering also strips .history", () => {
    // The `.advance(.Variant.history)` form is also a valid history-restore
    // write per §51.0.G + §51.0.N. The lowering at emitEngineAdvanceCall is
    // a Wave 4 follow-on (the test brief lists this as substrate; the
    // strict-MVP path uses direct-write `@var = .V.history` form which IS
    // wired above). Per A5-7 brief: ".advance(.X)" history-form lowering is
    // an additional surface — when not yet wired, this test documents it as
    // a deferred follow-on. For Wave 2.4, this test asserts that the bare
    // .advance form still works (no regression).
    const src = `\${ type Phase:enum = { Idle, Active } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>

\${ function go() { @phase.advance(Phase.Active) } }`;
    const { errors, clientJs } = compileToClientJs(src, "w24-advance-bare");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    expect(clientJs).toContain("_scrml_engine_advance");
  });
});
