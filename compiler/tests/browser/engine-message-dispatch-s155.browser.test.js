/* SPDX-License-Identifier: MIT
 *
 * engine-message-dispatch-s155.browser.test.js — §51.0.S (S155 batch 3,
 * #14 event-payload-transition, Approach E) happy-dom RUNTIME acceptance.
 *
 * `node --check`-clean ≠ correct (S139/S140/S152): emit-string-only tests mask
 * runtime miscompiles. This drives the COMPILED message-dispatch in happy-dom
 * and asserts the OBSERVABLE §51.0.S.3 machinery:
 *
 *   1. The §51.0.S.6 worked example (DragPhase × DragMsg): dispatch
 *      `.advance(.Start(id))` from .Idle → transitions to .Dragging carrying id;
 *      dispatch `.advance(.Drop(col))` from .Dragging → the arm BODY EFFECT runs
 *      (`@tasks` mutated, both id (state) + col (msg) in scope) AND transitions
 *      to .Idle.
 *   2. Same-state arm divergence (§51.0.S.3 + §51.0.R): a `.Tick` arm in
 *      .Playing resolving `.Playing` still RUNS its effect (@score++), resets
 *      the `<onIdle>` watchdog (handled-message reset, §51.0.R), and does NOT
 *      fire `<onTransition>` (self-target — §51.0.F.1).
 *   3. No-arm-for-message: a message dispatched in a state with no matching arm
 *      is a runtime no-op (§51.0.S.2.6) — no effect, no transition, no throw.
 *   4. Arm-target `rule=` violation → E-ENGINE-INVALID-TRANSITION (§51.0.S.2.7).
 *
 * Drive strategy: the per-engine message-arm table + transition table are
 * module-scoped consts. The exec wrapper re-exports `_scrml_engine_dispatch_message`
 * plus the module-scoped tables (by name) so the test can invoke the dispatch
 * helper directly with the SAME args the compiled `.advance(.Msg)` call site
 * passes. This exercises the real runtime helper + the real compiled arm-body
 * fns (not a re-implementation).
 *
 * Harness mirrors engine-opener-effect-c1.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-msg-dispatch-browser");

function compileOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Mount a compiled module in happy-dom; expose cell accessors + the dispatch
 * helper + the named module-scoped arm/transition tables for `varName`.
 */
function mountModule(source, baseName, varName) {
  const { html, clientJs, runtimeJs, errors } = compileOutputs(source, baseName);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const armTableName = `__scrml_engine_${varName}_msg_arms`;
  const txTableName = `__scrml_engine_${varName}_transitions`;
  const idleName = `__scrml_engine_${varName}_idle`;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
      `globalThis.__scrml_dispatch_fn__ = _scrml_engine_dispatch_message;\n` +
      `globalThis.__scrml_arm_table__ = (typeof ${armTableName} !== "undefined") ? ${armTableName} : null;\n` +
      `globalThis.__scrml_tx_table__ = (typeof ${txTableName} !== "undefined") ? ${txTableName} : null;\n` +
      `globalThis.__scrml_idle__ = (typeof ${idleName} !== "undefined") ? ${idleName} : null;\n` +
      `globalThis.__scrml_machine_timers_ref__ = _scrml_machine_timers;\n`),
  );
  let threw = null;
  try {
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  return {
    threw,
    get: (name) => globalThis.__scrml_get__(name),
    set: (name, v) => globalThis.__scrml_set__(name, v),
    armTable: () => globalThis.__scrml_arm_table__,
    txTable: () => globalThis.__scrml_tx_table__,
    idleEntry: () => globalThis.__scrml_idle__,
    timers: () => globalThis.__scrml_machine_timers_ref__,
    /** Drive a message dispatch with the SAME args the compiled .advance(.Msg)
     *  call site passes (varName, msg, armTable, txTable[, ...idle]). */
    dispatch(varName2, msg, withIdle) {
      const idleArg = withIdle ? globalThis.__scrml_idle__ : undefined;
      return globalThis.__scrml_dispatch_fn__(
        varName2, msg, globalThis.__scrml_arm_table__, globalThis.__scrml_tx_table__,
        undefined, idleArg,
      );
    },
  };
}

// ===========================================================================
// 1. The §51.0.S.6 worked example — drag flow.
// ===========================================================================
const DRAG = `<program title="drag s6">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}
<tasks> = ["a", "b"]
<lastMove> = ""
const taskMovedTo = (tasks, id, col) => { @lastMove = String(id) + "->" + col; return tasks.concat([col]) }
<engine for=DragPhase initial=.Idle accepts=DragMsg>
  <Idle rule=.Dragging>
    | .Start(id) :> .Dragging(id)
    | _          :> @dragPhase
  </>
  <Dragging(id) rule=.Idle>
    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
    | .End       :> .Idle
    | _          :> @dragPhase
  </>
</>
</program>`;

describe("§51.0.S.6 worked example — drag flow (happy-dom runtime)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("boots into .Idle without a thrown error", () => {
    const m = mountModule(DRAG, "drag", "dragPhase");
    expect(m.threw).toBeNull();
    expect(m.get("dragPhase")).toBe("Idle");
  });

  test(".advance(.Start(id)) transitions Idle → Dragging carrying the id payload", () => {
    const m = mountModule(DRAG, "drag", "dragPhase");
    m.dispatch("dragPhase", { variant: "Start", data: { id: 42 } });
    const phase = m.get("dragPhase");
    // Now in .Dragging, payload-bearing — { variant: "Dragging", data: { id: 42 } }.
    expect(typeof phase === "object" ? phase.variant : phase).toBe("Dragging");
    expect(typeof phase === "object" ? phase.data.id : undefined).toBe(42);
  });

  test(".advance(.Drop(col)) from .Dragging runs the arm body effect (both payload planes) AND transitions to .Idle", () => {
    const m = mountModule(DRAG, "drag", "dragPhase");
    m.dispatch("dragPhase", { variant: "Start", data: { id: 7 } }); // → Dragging(7)
    const beforeTasks = m.get("tasks");
    expect(beforeTasks).toEqual(["a", "b"]);
    m.dispatch("dragPhase", { variant: "Drop", data: { col: "col-9" } }); // arm body
    // The arm body effect ran: @tasks mutated via taskMovedTo(@tasks, id, col).
    expect(m.get("tasks")).toEqual(["a", "b", "col-9"]);
    // BOTH payload planes were in scope: id (state, 7) + col (msg, "col-9").
    expect(m.get("lastMove")).toBe("7->col-9");
    // The arm resolved .Idle → transitioned.
    expect(m.get("dragPhase")).toBe("Idle");
  });

  test("a no-arm dispatch from .Idle (only .Start handled before wildcard) hits the wildcard → stays .Idle, no throw", () => {
    const m = mountModule(DRAG, "drag", "dragPhase");
    // .Drop has no explicit arm in .Idle; the `| _ :>` wildcard returns the
    // current state → self-target no-op.
    const r = m.dispatch("dragPhase", { variant: "Drop", data: { col: "x" } });
    expect(m.get("dragPhase")).toBe("Idle");
    expect(r).toBe(false); // self-target → no external transition
  });
});

// ===========================================================================
// 2. Same-state arm divergence — §51.0.S.3 + §51.0.R handled-message reset.
// ===========================================================================
const TICK = `<program title="tick">
\${
  type Game:enum = { Title, Playing }
  type GameMsg:enum = { Tick, Quit }
}
<score> = 0
<onTransitionFires> = 0
<engine for=Game initial=.Playing accepts=GameMsg>
  <onIdle after=10000ms to=.Title/>
  <Title rule=.Playing></>
  <Playing rule=(.Title | .Playing)>
    | .Tick :> { @score = @score + 1; .Playing }
    | .Quit :> .Title
    <onTransition to=.Title>\${ @onTransitionFires = @onTransitionFires + 1 }</>
  </>
</>
</program>`;

describe("§51.0.S.3 same-state arm — effect runs, onIdle resets, onTransition does NOT fire", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test(".Tick in .Playing resolving .Playing RUNS the effect (@score increments)", () => {
    const m = mountModule(TICK, "tick", "game");
    expect(m.get("score")).toBe(0);
    m.dispatch("game", "Tick", true);
    expect(m.get("score")).toBe(1);
    m.dispatch("game", "Tick", true);
    expect(m.get("score")).toBe(2);
    // Same-state: still .Playing.
    expect(m.get("game")).toBe("Playing");
  });

  test(".Tick (same-state arm) RESETS the <onIdle> watchdog — §51.0.R handled-message reset", () => {
    const m = mountModule(TICK, "tick", "game");
    const timerKey = "game::__idle";
    const before = m.timers()[timerKey];
    expect(before).toBeDefined(); // watchdog armed at boot
    m.dispatch("game", "Tick", true);
    const after = m.timers()[timerKey];
    // The watchdog was reset (cleared + re-armed) → a NEW timer id, even though
    // the arm resolved the SAME state. This is THE §51.0.S.3 divergence: a
    // handled message resets onIdle even on a same-state arm.
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  test("the same-state arm returns false (no external transition → onTransition gate stays closed)", () => {
    const m = mountModule(TICK, "tick", "game");
    const r = m.dispatch("game", "Tick", true);
    // Same-state resolved target → _scrml_engine_advance returns false (no real
    // transition). The codegen hook-fire wrap gates on this boolean, so
    // <onTransition> does NOT fire for a same-state Tick.
    expect(r).toBe(false);
    expect(m.get("game")).toBe("Playing");
    // <onTransition to=.Title> never fired for the same-state .Tick.
    expect(m.get("onTransitionFires")).toBe(0);
  });
});

// ===========================================================================
// 3. No-arm-for-message no-op — §51.0.S.2.6.
// ===========================================================================
const NOARM = `<program title="noarm">
\${
  type Mode:enum = { On, Off }
  type Sig:enum = { Toggle, Ping }
}
<engine for=Mode initial=.On accepts=Sig>
  <On rule=.Off>
    | .Toggle :> .Off
    | _       :> @mode
  </>
  <Off rule=.On></>
</>
</program>`;

describe("§51.0.S.2.6 no-arm-for-message — runtime no-op", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("a message dispatched in a state with NO arms for it is a no-op (.Off declares none)", () => {
    const m = mountModule(NOARM, "noarm", "mode");
    m.dispatch("mode", "Toggle"); // On → Off (explicit arm)
    expect(m.get("mode")).toBe("Off");
    // .Off declares NO message arms → any dispatch is a no-op (§51.0.S.2.6).
    let threw = null;
    let r;
    try { r = m.dispatch("mode", "Toggle"); } catch (e) { threw = e; }
    expect(threw).toBeNull();
    expect(r).toBe(false);
    expect(m.get("mode")).toBe("Off"); // unchanged
  });
});

// ===========================================================================
// 4. Arm-target rule= violation — §51.0.S.2.7 → E-ENGINE-INVALID-TRANSITION.
// ===========================================================================
// A block-body arm whose RESOLVED target is COMPUTED (a fn call returning a
// runtime value), so the §51.0.S.2.7 rule= check is RUNTIME (the static
// compile-time leg only fires on a literal `.Variant` final). pickBad() returns
// "C" at runtime; .C is NOT in .A.rule=(.B) → runtime E-ENGINE-INVALID-TRANSITION
// (identical to a direct write). The STATIC-target illegal case (`:> { ...; .C }`)
// is a COMPILE error — covered by the unit/conformance suites, not here.
const ILLEGAL = `<program title="illegal-rt">
\${
  type S:enum = { A, B, C }
  type M:enum = { Jump }
}
<bad> = "C"
const pickBad = () => @bad
<engine for=S initial=.A accepts=M>
  <A rule=.B>
    | .Jump :> { @x = 1; pickBad() }
  </>
  <B rule=.A></>
  <C rule=.A></>
</>
</program>`;

describe("§51.0.S.2.7 arm-target rule= violation — runtime E-ENGINE-INVALID-TRANSITION", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("an arm resolving a target not in the from-state rule= throws E-ENGINE-INVALID-TRANSITION", () => {
    const m = mountModule(ILLEGAL, "illegal", "s");
    // The (.A × .Jump) arm body runs (@x = 1) then resolves pickBad()=="C";
    // .C is not in .A.rule=(.B), so the delegated _scrml_engine_advance throws.
    let threw = null;
    try { m.dispatch("s", "Jump"); } catch (e) { threw = e; }
    expect(threw).not.toBeNull();
    expect(String(threw && threw.message)).toContain("E-ENGINE-INVALID-TRANSITION");
    // The arm body effect DID run before the target was rejected (§51.0.S.3 —
    // the body always runs; the rule= check is at the transition step).
    expect(m.get("x")).toBe(1);
  });
});
