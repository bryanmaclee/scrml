/* SPDX-License-Identifier: MIT
 *
 * engine-event-handler-writes.test.js — A5-7 Bug #6 (S83, 2026-05-11)
 *
 * Behavioral test coverage for engine direct-write + .advance() emission
 * INSIDE event-handler bodies — the canonical user-facing surface
 * (`<button onclick=${...}>`, `<input onchange=${...}>`, etc.).
 *
 * Pre-fix (Wave 2.4 close): `rewriteBlockBody` in `emit-control-flow.ts:964`
 * accepted only `machineBindings` (legacy `<engine>` surface) and lowered
 * `@engineVar = .X` inside event-handler bodies to a bare
 * `_scrml_reactive_set("name", value)`. This silently bypassed:
 *   - rule= runtime enforcement (§51.0.F)
 *   - <onTransition> hook firing (§51.0.H)
 *   - internal:rule= distinct path (§51.0.O, Bug #4)
 *   - history-cell capture on outer-exit (§51.0.N, Bug #3)
 *   - .Variant.history restore-form flag (§51.0.Q.1, Bug #2)
 * — even though all five surfaces work correctly when the SAME assignment
 * appears inside a function body (canonical _emitReactiveSet path threads
 * engineBindings through `emit-logic.ts`).
 *
 * Bug #6 fix threads engineBindings + engineVarNames through `rewriteBlockBody`
 * and the EmitExprContext spread in `emit-event-wiring.ts` + `emit-variant-guard.ts`.
 * After the fix, event-handler emissions route through `_scrml_engine_direct_set`
 * (direct writes) and `_scrml_engine_advance` (.advance() calls) — the same
 * canonical write-guard path used by function-body writes.
 *
 * This file's tests:
 *   §1. Direct assignment in onclick routes through _scrml_engine_direct_set.
 *   §2. .advance() in onclick routes through _scrml_engine_advance.
 *   §3. Engine with <onTransition> threads the hook-fire wrap into onclick.
 *   §4. Engine with internal:rule= threads the internal-table arg into onclick.
 *   §5. Engine with history threads the history-map arg into onclick.
 *   §6. .Variant.history restore-form in onclick threads isHistoryRestore.
 *   §7. Plain-cell writes inside onclick stay on bare _scrml_reactive_set (regression).
 *   §8. Tree-shake — files with no engines don't change non-engine onclick behavior.
 *   §9. fn(){body} shorthand inside onclick also threads through the write-guard.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { unNamespaceEngineNames } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileToClientJs(source, suffix = "evt-handler") {
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
// §1. Direct assignment in onclick routes through _scrml_engine_direct_set
// ===========================================================================

describe("engine-event-handler-writes §1 — direct assignment routing", () => {
  test("`@engineVar = .X` inside onclick emits _scrml_engine_direct_set", () => {
    const src = `\${
      type AppMode:enum = { Title, Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title></>
</>

<button onclick=\${@appMode = AppMode.Playing}>Start</>
<button onclick=\${@appMode = AppMode.Title}>Quit</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-direct");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The onclick handlers must thread through _scrml_engine_direct_set —
    // not bare _scrml_reactive_set. The handler body should reference the
    // canonical transition table identifier.
    expect(clientJs).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions\)/,
    );
    expect(clientJs).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Title,\s*__scrml_engine_appMode_transitions\)/,
    );

    // Anti-regression: the engine variable's onclick handler should NOT
    // contain a bare `_scrml_reactive_set("appMode", ...)`. The module-init
    // line `_scrml_reactive_set("appMode", "Title")` (initial value seed)
    // is allowed; the onclick handler body is not. Inspect handler-registry
    // entries explicitly (they appear in `__scrml_handlers_onclick` /
    // `_scrml_attr_onclick_<N>` shape) and ensure no bare set inside them
    // for "appMode".
    const onclickHandlerRe = /"_scrml_attr_onclick_\d+":\s*function\(event\)\s*\{[\s\S]*?\}/g;
    const handlerBodies = clientJs.match(onclickHandlerRe) || [];
    for (const body of handlerBodies) {
      if (body.includes("appMode")) {
        // The handler that writes appMode must NOT use the bare reactive_set.
        expect(body).not.toMatch(/_scrml_reactive_set\(\s*"appMode"/);
      }
    }
  });

  test("function-body wrap: trigger() defined in ${ } is called from onclick", () => {
    // The most common adopter pattern is a wrapper function defined in
    // ${ } that the event handler invokes via call-ref:
    //   ${ function trigger() { @engineVar = .X } }
    //   <button onclick=trigger()>...
    // Verify that the function-body write goes through the engine guard
    // (this is the canonical _emitReactiveSet path; it must continue to
    // work alongside Bug #6's event-handler patches).
    const src = `\${
      type AppMode:enum = { Title, Playing }
      function trigger() { @appMode = AppMode.Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title></>
</>

<button onclick=trigger()>Start</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-fn-wrap");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // The function definition contains the engine direct-write helper call.
    expect(clientJs).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions\)/,
    );
  });
});

// ===========================================================================
// §2. .advance() in onclick routes through _scrml_engine_advance
// ===========================================================================

describe("engine-event-handler-writes §2 — .advance() routing", () => {
  test("`@engineVar.advance(.X)` inside onclick emits _scrml_engine_advance", () => {
    const src = `\${
      type AppMode:enum = { Title, Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title></>
</>

<button onclick=\${@appMode.advance(AppMode.Playing)}>Advance</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-advance");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The onclick handler must contain `_scrml_engine_advance(...)`, not the
    // pre-fix bypass `_scrml_reactive_get("appMode").advance(...)` which
    // would fail at runtime (bare-string variant has no .advance method).
    expect(clientJs).toMatch(
      /_scrml_cs_engine_advance\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions\)/,
    );
    // Anti-regression: the onclick handler must NOT have called .advance as
    // a property method on the reactive-get result.
    const onclickHandlerRe = /"_scrml_attr_onclick_\d+":\s*function\(event\)\s*\{[\s\S]*?\}/g;
    const handlerBodies = clientJs.match(onclickHandlerRe) || [];
    for (const body of handlerBodies) {
      if (body.includes("appMode")) {
        expect(body).not.toMatch(/_scrml_reactive_get\(\s*"appMode"\s*\)\.advance\(/);
      }
    }
  });
});

// ===========================================================================
// §3. Engine with <onTransition> threads hook-fire wrap into onclick
// ===========================================================================

describe("engine-event-handler-writes §3 — hooks wrap in event handlers", () => {
  test("hook-bearing engine: onclick handler wraps with capture-pre + fire-hooks-post", () => {
    const src = `\${
      type AppMode:enum = { Title, Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <onTransition to=.Title>\${ console.log("exit Playing") }</>
  </>
</>

<button onclick=\${@appMode = AppMode.Title}>Quit</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-hooks");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The hook-firing function is emitted at module scope.
    expect(clientJs).toContain("__scrml_engine_appMode_fire_hooks");

    // The onclick handler that writes the engine must wrap with the
    // capture-pre + conditional fire-hooks-post pattern. The exact emission
    // is multi-line — verify each landmark appears AFTER the handler-prop
    // header (so the lines are inside the handler scope).
    // Counter-resilient: match any _scrml_attr_onclick_N handler header.
    // (Bug 5 Phase 2 removed phantom placeholders for declaration-only logic
    // bodies, shifting the genVar counter — tests SHALL NOT depend on exact N.)
    const handlerHeaderIdx = clientJs.search(/_scrml_attr_onclick_\d+": function\(event\)/);
    expect(handlerHeaderIdx).toBeGreaterThan(-1);
    const slice = clientJs.slice(handlerHeaderIdx);
    // Inside the handler body, the wrap pattern must appear before the
    // event-listener closer. The wrap is:
    //   const __scrml_engine_from = _scrml_reactive_get("appMode");
    //   const __scrml_engine_external = _scrml_engine_direct_set("appMode", ...);
    //   if (__scrml_engine_external) __scrml_engine_appMode_fire_hooks(...);
    const idxFrom = slice.indexOf('__scrml_engine_from = _scrml_cs_reactive_get("appMode")');
    const idxExt = slice.indexOf('const __scrml_engine_external = _scrml_cs_engine_direct_set("appMode",');
    const idxHookFire = slice.indexOf('if (__scrml_engine_external) __scrml_engine_appMode_fire_hooks(');
    expect(idxFrom).toBeGreaterThan(-1);
    expect(idxExt).toBeGreaterThan(idxFrom);
    expect(idxHookFire).toBeGreaterThan(idxExt);
  });
});

// ===========================================================================
// §4. Engine with internal:rule= threads internal-table into onclick
// ===========================================================================

describe("engine-event-handler-writes §4 — internal:rule= threading", () => {
  test("composite with internal:rule=: onclick handler passes internal-table to direct_set", () => {
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

<button onclick=\${@appMode = AppMode.Playing}>Start</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-internal");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The internal-table identifier is emitted at module scope.
    expect(clientJs).toContain("__scrml_engine_appMode_internal_transitions");

    // The onclick handler that writes appMode must pass the internal-table
    // identifier as the trailing positional arg of _scrml_engine_direct_set.
    // Position-padding: timers=null, idle=null, then internal-table.
    const onclickHandlerRe = /"_scrml_attr_onclick_\d+":\s*function\(event\)\s*\{[\s\S]*?\}/g;
    const handlerBodies = clientJs.match(onclickHandlerRe) || [];
    const writingHandler = handlerBodies.find((b) => b.includes("appMode"));
    expect(writingHandler).toBeDefined();
    expect(writingHandler).toMatch(
      /_scrml_cs_engine_direct_set\([\s\S]*?__scrml_engine_appMode_internal_transitions\)/,
    );
  });
});

// ===========================================================================
// §5. Engine with history threads history-map arg into onclick
// ===========================================================================

describe("engine-event-handler-writes §5 — history-map threading", () => {
  test("composite with history attribute: onclick handler passes history-map to direct_set", () => {
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

<button onclick=\${@appMode = AppMode.Title}>Quit</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-history");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // History map identifier emitted at module scope.
    expect(clientJs).toContain("__scrml_engine_appMode_history_map");

    // The onclick handler must thread the history-map identifier through
    // _scrml_engine_direct_set. Without internal-rules + without timers/idle,
    // the positional shape is: direct_set(name, value, table, null, null,
    // null, historyMap). Verify the call site contains the history-map ident.
    // Counter-resilient: match any _scrml_attr_onclick_N handler header.
    // (Bug 5 Phase 2 removed phantom placeholders for declaration-only logic
    // bodies, shifting the genVar counter — tests SHALL NOT depend on exact N.)
    const handlerHeaderIdx = clientJs.search(/_scrml_attr_onclick_\d+": function\(event\)/);
    expect(handlerHeaderIdx).toBeGreaterThan(-1);
    const slice = clientJs.slice(handlerHeaderIdx);
    // Find _scrml_engine_direct_set call inside the handler slice and
    // verify it threads through __scrml_engine_appMode_history_map.
    const callStart = slice.indexOf('_scrml_cs_engine_direct_set("appMode",');
    expect(callStart).toBeGreaterThan(-1);
    const callSlice = slice.slice(callStart, callStart + 400);
    expect(callSlice).toContain("__scrml_engine_appMode_history_map");
  });
});

// ===========================================================================
// §6. .Variant.history restore-form in onclick threads isHistoryRestore
// ===========================================================================

describe("engine-event-handler-writes §6 — .Variant.history restore-form", () => {
  test("`.advance(.X.history)` in onclick threads isHistoryRestore=true (Bug #2 follow-up)", () => {
    // Parity: the `.advance` surface should accept the structured
    // `.X.history` target form alongside the direct-write surface.
    // emitEngineAdvanceCall now detects the suffix on node.args[0], strips
    // it, and threads isHistoryRestore=true as the trailing positional arg.
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=(.Playing | .Playing.history)></>
  <Playing history rule=.Title>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>

<button onclick=\${@appMode.advance(AppMode.Playing.history)}>Resume</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-advance-restore");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // Counter-resilient: match any _scrml_attr_onclick_N handler header.
    // (Bug 5 Phase 2 removed phantom placeholders for declaration-only logic
    // bodies, shifting the genVar counter — tests SHALL NOT depend on exact N.)
    const handlerHeaderIdx = clientJs.search(/_scrml_attr_onclick_\d+": function\(event\)/);
    expect(handlerHeaderIdx).toBeGreaterThan(-1);
    const slice = clientJs.slice(handlerHeaderIdx);
    const callStart = slice.indexOf('_scrml_cs_engine_advance("appMode",');
    expect(callStart).toBeGreaterThan(-1);
    const callSlice = slice.slice(callStart, callStart + 500);
    // `.history` suffix stripped — the runtime value is bare variant.
    expect(callSlice).toMatch(/_scrml_cs_engine_advance\("appMode",\s*AppMode\.Playing[\s,]/);
    expect(callSlice).not.toMatch(/AppMode\.Playing\.history/);
    // isHistoryRestore=true is threaded as the trailing positional arg.
    expect(callSlice).toMatch(/,\s*true\)/);
    // v0.2.4 Bug 6.5 — the 7th positional MUST be the history_map
    // identifier (mirrors the function-body assertion in §9 and the
    // direct-write assertion in engine-a7-history.test.js §8).
    // Engine has history + no timers/idle/internal, so the full call
    // shape is:
    //   _scrml_engine_advance("appMode", AppMode.Playing,
    //     __scrml_engine_appMode_transitions, null, null, null,
    //     __scrml_engine_appMode_history_map, true)
    expect(callSlice).toMatch(
      /_scrml_cs_engine_advance\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*__scrml_engine_appMode_history_map,\s*true\)/,
    );
    // Anti-regression: the pre-Bug-6.5-equivalent symmetric bug would
    // emit `null` in the 7th slot. Pin against that shape.
    expect(callSlice).not.toMatch(
      /_scrml_cs_engine_advance\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*null,\s*true\)/,
    );
  });

  test("`@engineVar = .X.history` in onclick threads isHistoryRestore=true", () => {
    const src = `\${
      type AppMode:enum  = { Title, Playing }
      type PlayMode:enum = { Exploring, Battle }
    }
<engine for=AppMode initial=.Title>
  <Title rule=(.Playing | .Playing.history)></>
  <Playing history rule=.Title>
    <engine for=PlayMode initial=.Exploring>
      <Exploring rule=.Battle></>
      <Battle rule=.Exploring></>
    </>
  </>
</>

<button onclick=\${@appMode = AppMode.Playing.history}>Resume</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-restore");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The .history suffix on the RHS must be STRIPPED at lowering — the
    // runtime value passed to _scrml_engine_direct_set is the bare variant
    // tag (`AppMode.Playing`), and isHistoryRestore=true is the trailing
    // (8th) positional arg.
    // Counter-resilient: match any _scrml_attr_onclick_N handler header.
    // (Bug 5 Phase 2 removed phantom placeholders for declaration-only logic
    // bodies, shifting the genVar counter — tests SHALL NOT depend on exact N.)
    const handlerHeaderIdx = clientJs.search(/_scrml_attr_onclick_\d+": function\(event\)/);
    expect(handlerHeaderIdx).toBeGreaterThan(-1);
    const slice = clientJs.slice(handlerHeaderIdx);
    const callStart = slice.indexOf('_scrml_cs_engine_direct_set("appMode",');
    expect(callStart).toBeGreaterThan(-1);
    const callSlice = slice.slice(callStart, callStart + 500);
    // Stripped value: `AppMode.Playing` (not `AppMode.Playing.history`).
    expect(callSlice).toMatch(/_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Playing[\s,]/);
    // Anti-regression: the .history suffix MUST be stripped.
    expect(callSlice).not.toMatch(/AppMode\.Playing\.history/);
    // isHistoryRestore=true threaded as the trailing positional arg.
    expect(callSlice).toMatch(/,\s*true\)/);
    // v0.2.4 Bug 6.5 parity — the 7th positional MUST be the history_map
    // identifier. Direct-write was NOT affected by Bug 6.5 (it sources
    // `binding.historyMapName` from the engine binding map, not from
    // ctx.enginesWithHistory), but pin the shape so a future refactor
    // that funnels direct-write through `_makeExprCtx` wouldn't silently
    // regress.
    expect(callSlice).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions,\s*null,\s*null,\s*null,\s*__scrml_engine_appMode_history_map,\s*true\)/,
    );
  });
});

// ===========================================================================
// §7. Plain-cell writes inside onclick stay on bare _scrml_reactive_set
// ===========================================================================

describe("engine-event-handler-writes §7 — non-engine writes regression", () => {
  test("plain reactive cell inside onclick uses bare _scrml_reactive_set", () => {
    const src = `\${
      <count> = 0
    }

<button onclick=\${@count = 99}>Set</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-plain");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The handler must use the plain reactive-set (no engine guard, no advance).
    const onclickHandlerRe = /"_scrml_attr_onclick_\d+":\s*function\(event\)\s*\{[\s\S]*?\}/g;
    const handlerBodies = clientJs.match(onclickHandlerRe) || [];
    const writingHandler = handlerBodies.find((b) => b.includes("count"));
    expect(writingHandler).toBeDefined();
    expect(writingHandler).toMatch(/_scrml_cs_reactive_set\("count",\s*99\)/);
    // Anti-regression: a non-engine cell must NOT route through the engine
    // direct-write hook.
    expect(writingHandler).not.toContain("_scrml_engine_direct_set");
  });

  test("mixed engine + plain cell writes via function-body wrap are correctly routed", () => {
    // The pre-existing limitation is that `fn() { ... }` shorthand inside
    // `${ }` interpolation is rejected by the TS pass (`fn` is an undeclared
    // identifier in expression position). The canonical workaround is to
    // define a wrapper function in `${ }`. This test verifies the canonical
    // multi-stmt wrap routes BOTH the engine write AND the plain cell write
    // through their respective canonical paths.
    const src = `\${
      type AppMode:enum = { Title, Playing }
      <score> = 0
      function go() {
        @score = 99
        @appMode = AppMode.Playing
      }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title></>
</>

<button onclick=go()>Go</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-mixed");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // Plain cell uses bare set.
    expect(clientJs).toMatch(/_scrml_cs_reactive_set\("score",\s*99\)/);
    // Engine cell uses direct_set (canonical guard).
    expect(clientJs).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Playing,\s*__scrml_engine_appMode_transitions\)/,
    );
  });
});

// ===========================================================================
// §8. Tree-shake — files with no engines are unaffected
// ===========================================================================

describe("engine-event-handler-writes §8 — tree-shake", () => {
  test("file with no engines does not pull engine identifiers into event handlers", () => {
    const src = `\${
      <count> = 0
    }

<button onclick=\${@count = 1}>Inc</>
<button onclick=\${@count = 2}>Two</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-treeshake");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);
    // No engine identifiers should leak into the output.
    expect(clientJs).not.toContain("_scrml_engine_direct_set");
    expect(clientJs).not.toContain("_scrml_engine_advance");
    expect(clientJs).not.toContain("__scrml_engine_");
  });
});

// ===========================================================================
// §9. Arm-body event handlers (re-wired via emit-variant-guard.ts)
// ===========================================================================

describe("engine-event-handler-writes §9 — arm-body event handlers", () => {
  test("non-delegable onchange in a non-initial arm body routes through write-guard", () => {
    // Non-delegable events (onchange, onfocus, onblur, etc.) inside non-
    // initial arm bodies are re-emitted PER-ARM by
    // emit-variant-guard.ts:emitArmWireFunction. Verify the engine threading
    // mirrors emit-event-wiring.ts so the rewired handler also lowers
    // `@appMode = .X` through _scrml_engine_direct_set.
    //
    // Note: <input type="text" oninput=...> is non-delegable per
    // DELEGABLE_EVENTS = ["click", "submit"]. We use oninput on a text input
    // inside a non-initial arm body to exercise the arm-wire fn path.
    const src = `\${
      type AppMode:enum = { Title, Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <input type="text" oninput=\${@appMode = AppMode.Title}/>
  </>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-arm-body");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The arm-wire function should be emitted for the .Playing arm. Inside
    // it, the oninput handler must route through _scrml_engine_direct_set.
    // The arm-wire function name follows the pattern
    // `_<prefix>_<varName>_wire_<tag>` — search for a function definition
    // containing the engine direct-write helper call.
    expect(clientJs).toMatch(
      /function\s+_\S*?wire_Playing\([\s\S]*?_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Title,\s*__scrml_engine_appMode_transitions\)/,
    );
  });

  test("delegable onclick in a non-initial arm body is in global registry with write-guard", () => {
    // Delegable events (click, submit) inside arm bodies STAY in the global
    // DOMContentLoaded handler registry — they survive innerHTML replace via
    // document-level delegation. They get the arm-tag metadata but the
    // emission site is still the global registry, which is fixed by the
    // emit-event-wiring.ts threading.
    const src = `\${
      type AppMode:enum = { Title, Playing }
    }
<engine for=AppMode initial=.Title>
  <Title rule=.Playing></>
  <Playing rule=.Title>
    <button onclick=\${@appMode = AppMode.Title}>Quit</>
  </>
</>`;
    const { errors, clientJs } = compileToClientJs(src, "evt-arm-delegated");
    expect(errors.filter((e) => e.severity === "error")).toEqual([]);

    // The onclick handler in the global registry must route through the guard.
    expect(clientJs).toMatch(
      /_scrml_cs_engine_direct_set\("appMode",\s*AppMode\.Title,\s*__scrml_engine_appMode_transitions\)/,
    );
  });
});
