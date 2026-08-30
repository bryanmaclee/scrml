/**
 * engine-ontimeout-codegen.test.js — A5-4 unit tests for `<onTimeout>` codegen
 *
 * Tests the engine-side `<onTimeout after=DURATION to=.Variant/>` element
 * codegen per SPEC §51.0.M (S67 amendment, 2026-05-07).
 *
 *   §A5-4.1  engineTimersTableName / engineHasOnTimeoutElements helpers
 *   §A5-4.2  emitEngineTimersTable — literal-form entries
 *   §A5-4.3  emitEngineTimersTable — computed-form entries (A5-5 cross-cut)
 *   §A5-4.4  emitEngineTimersTable — multiple <onTimeout> per state-child
 *   §A5-4.5  emitEngineTimersTable — tree-shake when zero <onTimeout>
 *   §A5-4.6  emitEngineSubstrate — emits timers table sibling to transition table
 *   §A5-4.7  emitEngineVariantCellInit — initial-arm at module-init
 *   §A5-4.8  emitEngineWriteGuard — passes timers-table arg when has timers
 *   §A5-4.9  emitEngineAdvanceCall — passes timers-table arg when has timers
 *   §A5-4.10 collectEnginesWithOnTimeout — set membership matches has-timer engines
 *   §A5-4.11 End-to-end: SYM-populated AST emits expected client JS shape
 *   §A5-4.12 End-to-end: engine WITHOUT <onTimeout> emits NO timers table (tree-shake)
 *   §A5-4.13 Independent timer keys for multiple <onTimeout> per state-child
 *
 * SCOPE: per A5-4 BRIEF + SCOPE doc — engine-side timer-arm/clear codegen
 * + module-init initial-arm + write-guard wiring.
 * OUT OF SCOPE: history-aware timer state (§51.0.N), <onTimeout> inside
 * <match> block-form arms (markup-walker precondition), dev-mode warning
 * for negative-runtime delay (deferred to A1c codegen post-A5-1).
 */

import { describe, test, expect } from "bun:test";
import {
  engineTimersTableName,
  engineHasOnTimeoutElements,
  emitEngineTimersTable,
  emitEngineSubstrate,
  emitEngineVariantCellInit,
  buildEngineBindingsMap,
  emitEngineWriteGuard,
  emitEngineAdvanceCall,
  collectEnginesWithOnTimeout,
} from "../../src/codegen/emit-engine.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

// ---------------------------------------------------------------------------
// Helpers — minimal fixtures
// ---------------------------------------------------------------------------

/** Build a minimal engineMeta with optional onTimeoutElements per state-child. */
function meta({
  forType = "LoadPhase",
  varName = "loadPhase",
  initialVariant = "Idle",
  variants = ["Idle", "Loading", "Done", "TimedOut"],
  stateChildren,
  onTimeoutElements,
} = {}) {
  const sc = stateChildren ?? [
    { tag: "Idle", rule: { kind: "single", target: "Loading" }, onTimeoutElements: [] },
    { tag: "Loading", rule: { kind: "multi", targets: ["Done", "TimedOut"] },
      onTimeoutElements: [
        { after: "30s", to: "TimedOut", rawOffset: 0 },
      ] },
    { tag: "Done", rule: { kind: "single", target: "Idle" }, onTimeoutElements: [] },
    { tag: "TimedOut", rule: { kind: "single", target: "Idle" }, onTimeoutElements: [] },
  ];
  // Aggregate file-scope flat list (mirrors A5-3 typer behavior)
  const agg = [];
  for (const c of sc) {
    if (Array.isArray(c.onTimeoutElements)) {
      for (const ot of c.onTimeoutElements) {
        agg.push({ stateChildTag: c.tag, entry: ot });
      }
    }
  }
  return {
    forType,
    varName,
    initialVariant,
    variants,
    stateChildren: sc,
    onTimeoutElements: onTimeoutElements ?? agg,
    derivedExpr: null,
    isExported: false,
    isPinned: false,
  };
}

function engineDeclNode(metaOverrides = {}) {
  const m = meta(metaOverrides);
  return {
    kind: "engine-decl",
    governedType: m.forType,
    varName: m.varName,
    initialVariant: m.initialVariant,
    _record: { engineMeta: m },
    _cellKind: "engine",
  };
}

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

function makeTestCtx(fileAST) {
  return makeCompileContext({
    filePath: fileAST.filePath ?? "test.scrml",
    fileAST,
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectedFields: new Map(),
    authMiddleware: null,
    middlewareConfig: null,
    csrfEnabled: false,
    encodingCtx: null,
    mode: "browser",
    testMode: true,
    dbVar: "_scrml_db",
    workerNames: [],
    errors: [],
    registry: new BindingRegistry(),
    derivedNames: new Set(),
    analysis: null,
    usedRuntimeChunks: new Set(["core", "scope", "errors", "transitions", "engine"]),
  });
}

// ---------------------------------------------------------------------------
// §A5-4.1 — naming + has-timer helpers
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.1 — engineTimersTableName + engineHasOnTimeoutElements", () => {
  test("engineTimersTableName uses __scrml_engine_<varName>_timers convention", () => {
    expect(engineTimersTableName("loadPhase")).toBe("__scrml_engine_loadPhase_timers");
    expect(engineTimersTableName("marioState")).toBe("__scrml_engine_marioState_timers");
  });

  test("naming sibling to engineTransitionTableName (parallel const namespace)", () => {
    // Names differ ONLY in suffix — confirms compositional consistency.
    expect(engineTimersTableName("x")).toBe("__scrml_engine_x_timers");
  });

  test("engineHasOnTimeoutElements returns TRUE when aggregate is non-empty", () => {
    const m = meta(); // default fixture has one <onTimeout> on Loading
    expect(engineHasOnTimeoutElements(m)).toBe(true);
  });

  test("engineHasOnTimeoutElements returns FALSE when no state-child has <onTimeout>", () => {
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    });
    expect(engineHasOnTimeoutElements(m)).toBe(false);
  });

  test("engineHasOnTimeoutElements falls back to per-stateChild walk when aggregate absent", () => {
    // Some test paths might not populate the file-scope aggregate.
    const m = meta();
    delete m.onTimeoutElements; // force the per-state walk
    expect(engineHasOnTimeoutElements(m)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A5-4.2 — emitEngineTimersTable literal form
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.2 — emitEngineTimersTable literal form", () => {
  test("emits Object.freeze({ ... }) with per-state arrays for literal `30s`", () => {
    const out = emitEngineTimersTable(meta()).join("\n");
    expect(out).toContain("__scrml_engine_loadPhase_timers");
    expect(out).toContain("Object.freeze({");
    // 30s = 30000ms; literal-form entry shape
    expect(out).toContain('{ ms: 30000, target: "TimedOut" }');
    // Empty arrays for state-children without <onTimeout>
    expect(out).toContain('"Idle": []');
    expect(out).toContain('"Done": []');
  });

  test("emits 500ms as 500 (ms unit multiplier 1)", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "500ms", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 500, target: "Done" }');
  });

  test("emits 2m as 120000 (m unit multiplier 60000)", () => {
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "2m", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 120000, target: "Done" }');
  });

  test("emits 1h as 3600000 (h unit multiplier 3600000)", () => {
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "1h", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 3600000, target: "Done" }');
  });

  test("emits 0.5s as 500 (fractional → Math.round)", () => {
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "0.5s", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 500, target: "Done" }');
  });
});

// ---------------------------------------------------------------------------
// §A5-4.3 — emitEngineTimersTable computed form (A5-5 cross-cut)
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.3 — emitEngineTimersTable computed form", () => {
  test("emits msExpr arrow-function for `${@delay}ms`", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [{ after: "${@delay}ms", to: "Retry", rawOffset: 0 }] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain("msExpr: function()");
    expect(out).toContain('target: "Retry"');
    // The reactive read `@delay` should be rewritten to _scrml_reactive_get
    expect(out).toContain('_scrml_reactive_get("delay")');
    // Multiplier for ms is 1
    expect(out).toContain("* 1");
  });

  test("computed `${expr}s` emits multiplier 1000", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [{ after: "${@n}s", to: "Retry", rawOffset: 0 }] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain("* 1000");
  });

  test("computed with parens inside expression survives single-level brace match", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Retry" },
          onTimeoutElements: [
            { after: "${Math.min(1000 * 2, 30000)}ms", to: "Retry", rawOffset: 0 },
          ] },
        { tag: "Retry", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain("Math.min(1000 * 2, 30000)");
  });
});

// ---------------------------------------------------------------------------
// §A5-4.4 — multiple <onTimeout> per state-child
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.4 — multiple <onTimeout> per state-child", () => {
  test("two <onTimeout> on the same state emit two array entries", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "multi", targets: ["TimedOut", "Slow"] },
          onTimeoutElements: [
            { after: "5s", to: "Slow", rawOffset: 0 },
            { after: "30s", to: "TimedOut", rawOffset: 1 },
          ] },
        { tag: "Slow", rule: { kind: "absent" }, onTimeoutElements: [] },
        { tag: "TimedOut", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('{ ms: 5000, target: "Slow" }');
    expect(out).toContain('{ ms: 30000, target: "TimedOut" }');
  });
});

// ---------------------------------------------------------------------------
// §A5-4.5 — tree-shake when zero <onTimeout>
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.5 — tree-shake when zero <onTimeout>", () => {
  test("emitEngineTimersTable returns [] when no state-child has <onTimeout>", () => {
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" }, onTimeoutElements: [] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    });
    expect(emitEngineTimersTable(m)).toEqual([]);
  });

  test("malformed entries (missing target) are silently dropped", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "30s", to: "", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    // The Loading row should exist but have an empty array (entry was malformed).
    expect(out).toContain('"Loading": []');
  });

  test("invalid duration (parse error) drops the entry but preserves the row", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "garbage", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    expect(out).toContain('"Loading": []');
  });
});

// ---------------------------------------------------------------------------
// §A5-4.6 — emitEngineSubstrate emits timers table sibling to transition table
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.6 — emitEngineSubstrate orchestration", () => {
  test("transition table comes BEFORE timers table BEFORE cell init (substrate-only; initial-arm is emitted later)", () => {
    const fileAST = { machineDecls: [engineDeclNode()], nodes: [] };
    const out = emitEngineSubstrate(fileAST).join("\n");
    const transIdx = out.indexOf("__scrml_engine_loadPhase_transitions");
    const timersIdx = out.indexOf("__scrml_engine_loadPhase_timers");
    const initIdx = out.indexOf('_scrml_reactive_set("loadPhase"');
    expect(transIdx).toBeGreaterThanOrEqual(0);
    expect(timersIdx).toBeGreaterThanOrEqual(0);
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(transIdx).toBeLessThan(timersIdx);
    expect(timersIdx).toBeLessThan(initIdx);
    // Initial-arm is NOT in the substrate output — it's emitted by
    // emitEngineInitialArmsForFile at a later point in emit-client.ts.
    expect(out).not.toContain("_scrml_engine_arm_state_timers");
  });

  test("engine WITHOUT <onTimeout> emits NO timers table", () => {
    const fileAST = { machineDecls: [engineDeclNode({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" }, onTimeoutElements: [] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    })], nodes: [] };
    const out = emitEngineSubstrate(fileAST).join("\n");
    expect(out).not.toContain("__scrml_engine_loadPhase_timers");
    expect(out).toContain("__scrml_engine_loadPhase_transitions");
  });
});

// ---------------------------------------------------------------------------
// §A5-4.7 — emitEngineVariantCellInit initial-arm
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.7 — initial-arm via emitEngineInitialArm (sibling helper)", () => {
  // Initial-arm is emitted SEPARATELY from the cell-init (so it can run AFTER
  // user reactive cells are initialized — a computed-form
  // <onTimeout after=${@var}<unit>/> reads @var at arm time and the cell-init
  // for @var lives in user logic which executes AFTER the engine substrate).
  test("emitEngineVariantCellInit emits ONLY the cell init (no arm call)", () => {
    const m = meta({
      initialVariant: "Loading",
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Loading" }, onTimeoutElements: [] },
        { tag: "Loading", rule: { kind: "single", target: "Done" },
          onTimeoutElements: [{ after: "30s", to: "Done", rawOffset: 0 }] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineVariantCellInit(m).join("\n");
    expect(out).toContain('_scrml_reactive_set("loadPhase", "Loading")');
    // Initial-arm is NOT in cell-init output — it's emitted by a sibling helper
    // and called from emit-client.ts AFTER reactive wiring.
    expect(out).not.toContain('_scrml_engine_arm_state_timers');
  });

  test("emitEngineInitialArm emits the arm call when engine has <onTimeout>", () => {
    // Lazy import to avoid the sibling-helper coupling at top of file.
    const { emitEngineInitialArm } = require("../../src/codegen/emit-engine.ts");
    const m = meta({
      initialVariant: "Loading",
    });
    const out = emitEngineInitialArm(m).join("\n");
    // S386 §51.0.M — the initial-arm now seeds the idle/internal/history
    // surfaces (positional args 5/6/7) so a timer-fired transition threads them
    // through the whole chain. This engine has none, so all three are `null`.
    expect(out).toContain('_scrml_engine_arm_state_timers("loadPhase", "Loading", __scrml_engine_loadPhase_timers, __scrml_engine_loadPhase_transitions, null, null, null)');
  });

  test("emitEngineInitialArm emits arm call even when initial state has no <onTimeout> (runtime helper no-ops)", () => {
    const { emitEngineInitialArm } = require("../../src/codegen/emit-engine.ts");
    const m = meta({
      initialVariant: "Idle", // Idle has no <onTimeout>, but Loading does
    });
    const out = emitEngineInitialArm(m).join("\n");
    expect(out).toContain('_scrml_engine_arm_state_timers("loadPhase", "Idle"');
  });

  test("emitEngineInitialArm returns [] when engine has NO <onTimeout> (tree-shake)", () => {
    const { emitEngineInitialArm } = require("../../src/codegen/emit-engine.ts");
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" }, onTimeoutElements: [] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    });
    expect(emitEngineInitialArm(m)).toEqual([]);
  });

  test("emitEngineInitialArm THROWS (fails loud) for a history-bearing engine seeded without a decl", () => {
    // S386 hardening — a history-BEARING engine whose initial-arm is derived
    // without a `decl` would silently null the historyMap seed (dropping
    // timer/idle-fired history capture from the initial state). Guard fails loud.
    const { emitEngineInitialArm } = require("../../src/codegen/emit-engine.ts");
    const m = meta({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Loading" }, historyAttr: true, onTimeoutElements: [] },
        { tag: "Loading", rule: { kind: "single", target: "Idle" },
          onTimeoutElements: [{ after: "30s", to: "Idle", rawOffset: 0 }] },
      ],
      initialVariant: "Loading", // has <onTimeout> → the arm block runs
    });
    expect(() => emitEngineInitialArm(m)).toThrow(/declares history attrs but its .* was derived without a decl/);
    // The non-history decl-less path (existing tests above) still works — this
    // guard only trips when history attrs are actually present.
  });
});

// ---------------------------------------------------------------------------
// §A5-4.8 — emitEngineWriteGuard threads timers-table arg
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.8 — emitEngineWriteGuard threads timers-table arg", () => {
  test("engine WITH <onTimeout> emits 4-arg _scrml_engine_direct_set", () => {
    const fileAST = { machineDecls: [engineDeclNode()], nodes: [] };
    const bindings = buildEngineBindingsMap(fileAST);
    const binding = bindings.get("loadPhase");
    expect(binding.hasOnTimeoutElements).toBe(true);
    expect(binding.timersTableName).toBe("__scrml_engine_loadPhase_timers");
    const out = emitEngineWriteGuard(binding, '"Loading"').join("\n");
    expect(out).toContain("_scrml_engine_direct_set(\"loadPhase\", \"Loading\", __scrml_engine_loadPhase_transitions, __scrml_engine_loadPhase_timers)");
  });

  test("engine WITHOUT <onTimeout> emits 3-arg form (no timers arg)", () => {
    const fileAST = { machineDecls: [engineDeclNode({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" }, onTimeoutElements: [] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    })], nodes: [] };
    const bindings = buildEngineBindingsMap(fileAST);
    const binding = bindings.get("loadPhase");
    expect(binding.hasOnTimeoutElements).toBe(false);
    expect(binding.timersTableName).toBeUndefined();
    const out = emitEngineWriteGuard(binding, '"Done"').join("\n");
    expect(out).toContain("_scrml_engine_direct_set(\"loadPhase\", \"Done\", __scrml_engine_loadPhase_transitions)");
    expect(out).not.toContain("__scrml_engine_loadPhase_timers");
  });
});

// ---------------------------------------------------------------------------
// §A5-4.9 — emitEngineAdvanceCall threads timers-table arg
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.9 — emitEngineAdvanceCall threads timers-table arg", () => {
  test("hasOnTimeout=true emits 4-arg _scrml_engine_advance", () => {
    const out = emitEngineAdvanceCall("loadPhase", '"Loading"', false, true);
    expect(out).toContain("_scrml_engine_advance(\"loadPhase\", \"Loading\", __scrml_engine_loadPhase_transitions, __scrml_engine_loadPhase_timers)");
  });

  test("hasOnTimeout=false emits 3-arg form (no timers arg)", () => {
    const out = emitEngineAdvanceCall("loadPhase", '"Done"', false, false);
    expect(out).toContain("_scrml_engine_advance(\"loadPhase\", \"Done\", __scrml_engine_loadPhase_transitions)");
    expect(out).not.toContain("__scrml_engine_loadPhase_timers");
  });

  test("hasOnTimeout undefined defaults to 3-arg (no timer arg)", () => {
    const out = emitEngineAdvanceCall("loadPhase", '"Done"');
    expect(out).not.toContain("__scrml_engine_loadPhase_timers");
  });
});

// ---------------------------------------------------------------------------
// §A5-4.10 — collectEnginesWithOnTimeout
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.10 — collectEnginesWithOnTimeout", () => {
  test("includes engines with at least one <onTimeout>", () => {
    const fileAST = { machineDecls: [engineDeclNode()], nodes: [] };
    const set = collectEnginesWithOnTimeout(fileAST);
    expect(set.has("loadPhase")).toBe(true);
  });

  test("excludes engines without any <onTimeout>", () => {
    const fileAST = { machineDecls: [engineDeclNode({
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Done" }, onTimeoutElements: [] },
        { tag: "Done", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
      onTimeoutElements: [],
    })], nodes: [] };
    const set = collectEnginesWithOnTimeout(fileAST);
    expect(set.has("loadPhase")).toBe(false);
    expect(set.size).toBe(0);
  });

  test("includes both engines when one has <onTimeout> and the other does not", () => {
    const fileAST = {
      machineDecls: [
        engineDeclNode(),
        engineDeclNode({
          forType: "OtherType",
          varName: "otherVar",
          initialVariant: "X",
          stateChildren: [
            { tag: "X", rule: { kind: "single", target: "Y" }, onTimeoutElements: [] },
            { tag: "Y", rule: { kind: "absent" }, onTimeoutElements: [] },
          ],
          onTimeoutElements: [],
        }),
      ],
      nodes: [],
    };
    const set = collectEnginesWithOnTimeout(fileAST);
    expect(set.has("loadPhase")).toBe(true);
    expect(set.has("otherVar")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §A5-4.11 — End-to-end: SYM-populated AST emits expected client JS shape
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.11 — End-to-end client JS shape", () => {
  test("compiling an engine with <onTimeout> emits the timers table + arm/clear wiring", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done, TimedOut }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Done | .TimedOut)>
    <onTimeout after=30s to=.TimedOut/>
  </>
  <Done rule=.Idle></>
  <TimedOut rule=.Idle></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);
    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));
    // Timers table emitted
    expect(js).toContain("__scrml_engine_phase_timers");
    expect(js).toContain('{ ms: 30000, target: "TimedOut" }');
    // Initial-arm emitted at the END (after reactive wiring) per A5-4 ordering.
    // S386 §51.0.M — seeds idle/internal/history (args 5/6/7); this engine has
    // none, so all three are `null`.
    expect(js).toContain('_scrml_engine_arm_state_timers("phase", "Idle", __scrml_engine_phase_timers, __scrml_engine_phase_transitions, null, null, null)');
    // Confirm ordering: arm appears AFTER reactive wiring.
    const reactiveIdx = js.indexOf("_scrml_reactive_set(\"phase\"");
    const armIdx = js.indexOf("_scrml_engine_arm_state_timers(\"phase\"");
    expect(reactiveIdx).toBeLessThan(armIdx);
  });
});

// ---------------------------------------------------------------------------
// §A5-4.12 — Tree-shake confirmation
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.12 — Tree-shake when no engine has <onTimeout>", () => {
  test("file with engines but no <onTimeout> emits no _scrml_engine_arm_state_timers references", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Done }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Done></>
  <Done></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);
    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));
    expect(js).not.toContain("__scrml_engine_phase_timers");
    // The arm-state-timers helper might still be in the runtime preamble (if 'engine'
    // chunk is loaded), but the call-site invocation should not appear.
    expect(js).not.toContain('_scrml_engine_arm_state_timers("phase"');
  });
});

// ---------------------------------------------------------------------------
// §A5-4.13 — Independent timer keys for multiple <onTimeout>
// ---------------------------------------------------------------------------

describe("A5-4 §A5-4.13 — Independent timer keys (composite varName::stateName::idx)", () => {
  test("multiple <onTimeout> on same state get distinct array indices", () => {
    const m = meta({
      stateChildren: [
        { tag: "Loading", rule: { kind: "multi", targets: ["A", "B"] },
          onTimeoutElements: [
            { after: "5s", to: "A", rawOffset: 0 },
            { after: "10s", to: "B", rawOffset: 1 },
          ] },
        { tag: "A", rule: { kind: "absent" }, onTimeoutElements: [] },
        { tag: "B", rule: { kind: "absent" }, onTimeoutElements: [] },
      ],
    });
    const out = emitEngineTimersTable(m).join("\n");
    // Both entries appear in order — the runtime indexes by array position
    // and produces composite keys "loadPhase::Loading::0" and "loadPhase::Loading::1".
    const idxA = out.indexOf('target: "A"');
    const idxB = out.indexOf('target: "B"');
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });
});
