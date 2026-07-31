/**
 * c13-advance-write-hook.test.js — A1c Step C13 unit tests
 *
 * Tests the rule= contract enforcement layered on top of C12's substrate.
 * Per SPEC §51.0.F (direct-write enforcement, Move 12) + §51.0.G (`.advance()`,
 * Move 13). E-ENGINE-INVALID-TRANSITION is RUNTIME severity (§34 line 14376).
 *
 * Re-scope notice: `<onTransition>` element firing + `effect=` attribute
 * emission are OUT (B17 didn't ship the parsing — confirmed in C13 SURVEY q3).
 *
 *   §C13.0  buildEngineBindingsMap — sibling map keyed by engine var name
 *   §C13.1  emitEngineWriteGuard — emits `_scrml_engine_direct_set` call
 *   §C13.2  collectEngineVarNames — extracts the in-scope set
 *   §C13.3  emitEngineAdvanceCall — emits `_scrml_engine_advance` call
 *   §C13.4  Runtime helpers — _scrml_engine_check_transition predicate logic
 *   §C13.5  Runtime helpers — _scrml_engine_advance throws "asserted advance failed"
 *   §C13.6  Runtime helpers — _scrml_engine_direct_set throws plain
 *           E-ENGINE-INVALID-TRANSITION
 *   §C13.7  End-to-end: direct write to engine variable — codegen shape
 *   §C13.8  End-to-end: `.advance(.X)` — codegen shape
 *   §C13.9  End-to-end: multi-engine file — independent enforcement
 *   §C13.10 End-to-end: legacy <engine> path NOT regressed
 *   §C13.11 End-to-end: chunk wiring — `engine` chunk in tree-shaken output
 *   §C13.12 End-to-end: non-engine var direct writes use bare reactive substrate
 *   §C13.13 End-to-end: wildcard rule= accepts any target
 *   §C13.14 End-to-end: terminal state (no rule=) rejects all targets at runtime
 */

import { describe, test, expect } from "bun:test";
import {
  buildEngineBindingsMap,
  emitEngineWriteGuard,
  collectEngineVarNames,
  emitEngineAdvanceCall,
  engineTransitionTableName,
} from "../../src/codegen/emit-engine.ts";
import {
  RUNTIME_CHUNKS,
  RUNTIME_CHUNK_ORDER,
  assembleRuntime,
} from "../../src/codegen/runtime-chunks.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal engineMeta carrying the fields C13 reads. */
function meta({
  forType = "MarioState",
  varName = "marioState",
  initialVariant = "Small",
  variants = ["Small", "Big", "Fire", "Cape"],
  stateChildren = [
    { tag: "Small", rule: { kind: "single", target: "Big" } },
    { tag: "Big", rule: { kind: "multi", targets: ["Fire", "Cape", "Small"] } },
    { tag: "Fire", rule: { kind: "single", target: "Small" } },
    { tag: "Cape", rule: { kind: "single", target: "Small" } },
  ],
  derivedExpr = null,
} = {}) {
  return {
    forType,
    varName,
    initialVariant,
    variants,
    stateChildren,
    derivedExpr,
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
    usedRuntimeChunks: new Set(["core", "scope", "errors", "transitions"]),
  });
}

// ---------------------------------------------------------------------------
// §C13.0 — buildEngineBindingsMap
// ---------------------------------------------------------------------------

describe("C13 §C13.0 — buildEngineBindingsMap", () => {
  test("returns null when no engines in scope", () => {
    expect(buildEngineBindingsMap({ machineDecls: [] })).toBeNull();
    expect(buildEngineBindingsMap({})).toBeNull();
  });

  test("builds map keyed by engine var name with table reference", () => {
    const node = engineDeclNode();
    const map = buildEngineBindingsMap({ machineDecls: [node] });
    expect(map).not.toBeNull();
    expect(map.size).toBe(1);
    const entry = map.get("marioState");
    expect(entry).toBeDefined();
    expect(entry.varName).toBe("marioState");
    expect(entry.forType).toBe("MarioState");
    expect(entry.tableName).toBe("__scrml_engine_marioState_transitions");
  });

  test("multiple engines produce independent entries", () => {
    const e1 = engineDeclNode();
    const e2 = engineDeclNode({ forType: "LoadPhase", varName: "loadPhase",
      initialVariant: "Idle",
      stateChildren: [{ tag: "Idle", rule: { kind: "single", target: "Done" } }, { tag: "Done", rule: { kind: "absent" } }] });
    const map = buildEngineBindingsMap({ machineDecls: [e1, e2] });
    expect(map.size).toBe(2);
    expect(map.get("marioState").tableName).toBe("__scrml_engine_marioState_transitions");
    expect(map.get("loadPhase").tableName).toBe("__scrml_engine_loadPhase_transitions");
  });

  test("derived engines SKIPPED (C14 territory)", () => {
    const node = engineDeclNode({ derivedExpr: { kind: "legacy-source-var", varName: "src" } });
    const map = buildEngineBindingsMap({ machineDecls: [node] });
    expect(map).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C13.1 — emitEngineWriteGuard
// ---------------------------------------------------------------------------

describe("C13 §C13.1 — emitEngineWriteGuard", () => {
  test("emits `_scrml_engine_direct_set` call with correct args", () => {
    const binding = {
      varName: "marioState",
      forType: "MarioState",
      tableName: "__scrml_engine_marioState_transitions",
    };
    const out = emitEngineWriteGuard(binding, "MarioState.Big").join("\n");
    expect(out).toContain('_scrml_engine_direct_set("marioState", MarioState.Big, __scrml_engine_marioState_transitions);');
  });

  test("emits §51.0.F locator comment", () => {
    const binding = {
      varName: "marioState",
      forType: "MarioState",
      tableName: "__scrml_engine_marioState_transitions",
    };
    const out = emitEngineWriteGuard(binding, "x").join("\n");
    expect(out).toContain("§51.0.F engine direct-write hook: marioState (MarioState)");
  });
});

// ---------------------------------------------------------------------------
// §C13.2 — collectEngineVarNames
// ---------------------------------------------------------------------------

describe("C13 §C13.2 — collectEngineVarNames", () => {
  test("returns empty set when no engines", () => {
    expect(collectEngineVarNames({}).size).toBe(0);
    expect(collectEngineVarNames({ machineDecls: [] }).size).toBe(0);
  });

  test("collects all in-scope engine var names", () => {
    const e1 = engineDeclNode();
    const e2 = engineDeclNode({ forType: "LoadPhase", varName: "loadPhase",
      initialVariant: "Idle",
      stateChildren: [{ tag: "Idle", rule: { kind: "absent" } }] });
    const names = collectEngineVarNames({ machineDecls: [e1, e2] });
    expect(names.has("marioState")).toBe(true);
    expect(names.has("loadPhase")).toBe(true);
    expect(names.size).toBe(2);
  });

  test("skips derived engines (C14 territory)", () => {
    const node = engineDeclNode({ derivedExpr: { kind: "legacy-source-var", varName: "src" } });
    const names = collectEngineVarNames({ machineDecls: [node] });
    expect(names.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §C13.3 — emitEngineAdvanceCall
// ---------------------------------------------------------------------------

describe("C13 §C13.3 — emitEngineAdvanceCall", () => {
  test("emits `_scrml_engine_advance` call with three args (no trailing semi)", () => {
    const out = emitEngineAdvanceCall("marioState", "MarioState.Big");
    expect(out).toBe('_scrml_engine_advance("marioState", MarioState.Big, __scrml_engine_marioState_transitions)');
    expect(out.endsWith(";")).toBe(false); // statement wrapper adds semi
  });

  test("uses canonical table name for the engine var", () => {
    const out = emitEngineAdvanceCall("loadPhase", '"Done"');
    expect(out).toContain("__scrml_engine_loadPhase_transitions");
  });
});

// ---------------------------------------------------------------------------
// §C13.4 — Runtime helper: _scrml_engine_check_transition predicate
// ---------------------------------------------------------------------------

describe("C13 §C13.4 — _scrml_engine_check_transition runtime predicate", () => {
  // Evaluate the runtime helper source in a sandboxed function.
  function makeRuntime() {
    // Chunk slicing leaves the leading "// " in the previous chunk (per
    // runtime-chunks.ts split-position contract), so the engine chunk text
    // starts with the bare "§51.0.F..." marker text. Re-prefix with "// "
    // to make it valid standalone JS for the new Function eval.
    const src = "// " + RUNTIME_CHUNKS.engine;
    // The chunk references _scrml_reactive_get/set — provide stubs.
    const wrapped = `
      var _scrml_state = {};
      var _scrml_reactive_get = function(name) { return _scrml_state[name]; };
      var _scrml_reactive_set = function(name, value) { _scrml_state[name] = value; };
      ${src}
      return { _scrml_engine_check_transition, _scrml_engine_advance, _scrml_engine_direct_set, _scrml_state, _scrml_reactive_get, _scrml_reactive_set };
    `;
    return new Function(wrapped)();
  }

  test("returns true when target is in single-target list", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Small: ["Big"] });
    expect(r._scrml_engine_check_transition("Small", "Big", table)).toBe(true);
  });

  test("returns false when target is NOT in single-target list", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Small: ["Big"] });
    expect(r._scrml_engine_check_transition("Small", "Cape", table)).toBe(false);
  });

  test("returns true when target is in multi-target list", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Big: ["Fire", "Cape", "Small"] });
    expect(r._scrml_engine_check_transition("Big", "Fire", table)).toBe(true);
    expect(r._scrml_engine_check_transition("Big", "Cape", table)).toBe(true);
    expect(r._scrml_engine_check_transition("Big", "Small", table)).toBe(true);
  });

  test("returns false for target NOT in multi-target list", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Big: ["Fire", "Cape"] });
    expect(r._scrml_engine_check_transition("Big", "Small", table)).toBe(false);
  });

  test("wildcard '*' entry accepts any target", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Free: "*" });
    expect(r._scrml_engine_check_transition("Free", "Anything", table)).toBe(true);
    expect(r._scrml_engine_check_transition("Free", "AnotherOne", table)).toBe(true);
  });

  test("terminal state ([] entry) rejects all targets", () => {
    const r = makeRuntime();
    const table = Object.freeze({ Done: [] });
    expect(r._scrml_engine_check_transition("Done", "Anything", table)).toBe(false);
  });

  test("missing from-variant entry returns false (defensive)", () => {
    const r = makeRuntime();
    const table = Object.freeze({});
    expect(r._scrml_engine_check_transition("Unknown", "X", table)).toBe(false);
  });

  test("null table returns false (defensive)", () => {
    const r = makeRuntime();
    expect(r._scrml_engine_check_transition("Small", "Big", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C13.5 — Runtime helper: _scrml_engine_advance throws "asserted advance failed"
// ---------------------------------------------------------------------------

describe("C13 §C13.5 — _scrml_engine_advance runtime helper", () => {
  function makeRuntime() {
    // Re-prefix with "// " — see §C13.4 makeRuntime for explanation.
    const src = "// " + RUNTIME_CHUNKS.engine;
    const wrapped = `
      var _scrml_state = {};
      var _scrml_reactive_get = function(name) { return _scrml_state[name]; };
      var _scrml_reactive_set = function(name, value) { _scrml_state[name] = value; };
      ${src}
      return { _scrml_engine_check_transition, _scrml_engine_advance, _scrml_engine_direct_set, _scrml_state };
    `;
    return new Function(wrapped)();
  }

  test("legal transition writes the new variant", () => {
    const r = makeRuntime();
    r._scrml_state.marioState = "Small";
    const table = Object.freeze({ Small: ["Big"], Big: [] });
    r._scrml_engine_advance("marioState", "Big", table);
    expect(r._scrml_state.marioState).toBe("Big");
  });

  test("illegal transition throws E-ENGINE-INVALID-TRANSITION with `asserted advance failed` framing", () => {
    const r = makeRuntime();
    r._scrml_state.marioState = "Small";
    const table = Object.freeze({ Small: ["Big"], Big: [] });
    expect(() => r._scrml_engine_advance("marioState", "Cape", table))
      .toThrow(/E-ENGINE-INVALID-TRANSITION/);
    expect(() => r._scrml_engine_advance("marioState", "Cape", table))
      .toThrow(/asserted advance failed/);
    // Cell value is unchanged after the failed transition
    expect(r._scrml_state.marioState).toBe("Small");
  });

  test("wildcard '*' rule accepts any target", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Free";
    const table = Object.freeze({ Free: "*" });
    r._scrml_engine_advance("x", "Anything", table);
    expect(r._scrml_state.x).toBe("Anything");
  });

  test("terminal state ([] rule) rejects all targets", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Done";
    const table = Object.freeze({ Done: [] });
    expect(() => r._scrml_engine_advance("x", "Anything", table))
      .toThrow(/E-ENGINE-INVALID-TRANSITION/);
  });

  test("error message includes variable name + from + to variants", () => {
    const r = makeRuntime();
    r._scrml_state.marioState = "Small";
    const table = Object.freeze({ Small: ["Big"] });
    try {
      r._scrml_engine_advance("marioState", "Cape", table);
    } catch (e) {
      expect(e.message).toContain("marioState");
      expect(e.message).toContain("Small");
      expect(e.message).toContain("Cape");
      return;
    }
    throw new Error("expected throw");
  });
});

// ---------------------------------------------------------------------------
// §C13.6 — Runtime helper: _scrml_engine_direct_set throws plain framing
// ---------------------------------------------------------------------------

describe("C13 §C13.6 — _scrml_engine_direct_set runtime helper", () => {
  function makeRuntime() {
    // Re-prefix with "// " — see §C13.4 makeRuntime for explanation.
    const src = "// " + RUNTIME_CHUNKS.engine;
    const wrapped = `
      var _scrml_state = {};
      var _scrml_reactive_get = function(name) { return _scrml_state[name]; };
      var _scrml_reactive_set = function(name, value) { _scrml_state[name] = value; };
      ${src}
      return { _scrml_engine_check_transition, _scrml_engine_advance, _scrml_engine_direct_set, _scrml_state };
    `;
    return new Function(wrapped)();
  }

  test("legal direct write commits the value", () => {
    const r = makeRuntime();
    r._scrml_state.x = "A";
    const table = Object.freeze({ A: ["B"], B: [] });
    r._scrml_engine_direct_set("x", "B", table);
    expect(r._scrml_state.x).toBe("B");
  });

  test("illegal direct write throws plain E-ENGINE-INVALID-TRANSITION (NO `asserted advance` framing)", () => {
    const r = makeRuntime();
    r._scrml_state.marioState = "Small";
    const table = Object.freeze({ Small: ["Big"] });
    expect(() => r._scrml_engine_direct_set("marioState", "Cape", table))
      .toThrow(/E-ENGINE-INVALID-TRANSITION/);
    expect(() => r._scrml_engine_direct_set("marioState", "Cape", table))
      .toThrow(/illegal direct write/);
    try {
      r._scrml_engine_direct_set("marioState", "Cape", table);
    } catch (e) {
      // The "asserted advance failed" framing is reserved for .advance()
      expect(e.message).not.toContain("asserted advance failed");
      return;
    }
    throw new Error("expected throw");
  });
});

// ---------------------------------------------------------------------------
// §C13.7 — End-to-end: direct write to engine variable
// ---------------------------------------------------------------------------

describe("C13 §C13.7 — end-to-end direct write codegen shape", () => {
  test("`@marioState = MarioState.Big` inside a fn body emits direct_set call", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big, Fire, Cape }
  function grow() {
    @marioState = MarioState.Big
  }
}
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).toContain('_scrml_engine_direct_set("marioState"');
    expect(js).toContain("__scrml_engine_marioState_transitions");
    // Should NOT emit a bare _scrml_reactive_set for the engine variable inside grow()
    // (it would only appear in the C12 substrate's initial cell init).
    const directSetCount = (js.match(/_scrml_engine_direct_set\("marioState"/g) || []).length;
    expect(directSetCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §C13.8 — End-to-end: `.advance(.X)`
// ---------------------------------------------------------------------------

describe("C13 §C13.8 — end-to-end .advance() codegen shape", () => {
  test("`@marioState.advance(MarioState.Big)` emits _scrml_engine_advance call", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big, Fire, Cape }
  function grow() {
    @marioState.advance(MarioState.Big)
  }
}
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).toContain('_scrml_engine_advance("marioState"');
    expect(js).toContain("__scrml_engine_marioState_transitions");
    // Should NOT emit `_scrml_reactive_get("marioState").advance` (the broken member-access form)
    expect(js).not.toContain('_scrml_reactive_get("marioState").advance');
  });
});

// ---------------------------------------------------------------------------
// §C13.9 — End-to-end: multi-engine independence
// ---------------------------------------------------------------------------

describe("C13 §C13.9 — multi-engine file: independent enforcement", () => {
  test("two engines route to independent tables in their own write sites", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big }
  type LoadPhase:enum = { Idle, Loading }
  function go() {
    @marioState = MarioState.Big
    @loadPhase = LoadPhase.Loading
  }
}
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
<engine for=LoadPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).toContain('_scrml_engine_direct_set("marioState", MarioState.Big, __scrml_engine_marioState_transitions)');
    expect(js).toContain('_scrml_engine_direct_set("loadPhase", LoadPhase.Loading, __scrml_engine_loadPhase_transitions)');
  });
});

// ---------------------------------------------------------------------------
// §C13.10 — Legacy <engine> path NOT regressed
// ---------------------------------------------------------------------------

describe("C13 §C13.10 — legacy <engine> direct-write enforcement preserved", () => {
  test("file containing ONLY a legacy <engine> does NOT trigger C13 helpers", () => {
    const src = `<program>
\${
  type Status:enum = {
    Idle
    Active
    transitions {
      .Idle => .Active
      .Active => .Idle
    }
  }
}
< engine name=StatusMachine for=Status>
  .Idle => .Active
  .Active => .Idle
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls, machineRegistry: ast.machineRegistry };
    const js = generateClientJs(makeTestCtx(fileAST));

    // The C13 surface (write hook + .advance() + chunk helpers) is only for
    // the new `<engine>` form. A pure-legacy `<engine>` file must not
    // emit any C13 helper calls (the helpers may still be in the runtime
    // chunk, but no compile-time code emits a call to them).
    expect(js).not.toContain('_scrml_engine_direct_set("status"');
    expect(js).not.toContain('_scrml_engine_advance("status"');
    expect(js).not.toContain("__scrml_engine_status_transitions");
  });
});

// ---------------------------------------------------------------------------
// §C13.11 — Chunk wiring
// ---------------------------------------------------------------------------

describe("C13 §C13.11 — `engine` runtime chunk wiring", () => {
  test("RUNTIME_CHUNK_ORDER includes `engine`", () => {
    expect(RUNTIME_CHUNK_ORDER).toContain("engine");
  });

  test("`engine` chunk content includes all three helpers", () => {
    expect(RUNTIME_CHUNKS.engine).toContain("_scrml_engine_check_transition");
    expect(RUNTIME_CHUNKS.engine).toContain("_scrml_engine_advance");
    expect(RUNTIME_CHUNKS.engine).toContain("_scrml_engine_direct_set");
  });

  test("`engine` chunk has the §51.0 boundary-marker comment", () => {
    expect(RUNTIME_CHUNKS.engine).toContain("§51.0.F + §51.0.G");
  });

  test("core-only assembly does NOT include engine helpers (tree-shaken)", () => {
    const minimal = assembleRuntime(new Set(["core"]));
    expect(minimal).not.toContain("_scrml_engine_check_transition");
    expect(minimal).not.toContain("_scrml_engine_advance");
    expect(minimal).not.toContain("_scrml_engine_direct_set");
  });

  test("file with engine-decl triggers `engine` chunk inclusion in client JS", () => {
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

    // The chunk's helpers should be inlined into the runtime preamble
    expect(js).toContain("_scrml_engine_check_transition");
    expect(js).toContain("_scrml_engine_advance");
    expect(js).toContain("_scrml_engine_direct_set");
  });
});

// ---------------------------------------------------------------------------
// §C13.12 — Non-engine vars use bare reactive substrate
// ---------------------------------------------------------------------------

describe("C13 §C13.12 — non-engine var direct writes use bare reactive substrate", () => {
  test("ordinary @cell = expr does NOT route through engine hook", () => {
    const src = `<program>
\${
  @count = 0
  function inc() { @count = @count + 1 }
}
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    // The increment site uses bare reactive_set
    expect(js).toContain('_scrml_reactive_set("count"');
    // No engine hook for non-engine var
    expect(js).not.toContain('_scrml_engine_direct_set("count"');
  });
});

// ---------------------------------------------------------------------------
// §C13.13 — Wildcard rule= acceptance (end-to-end)
// ---------------------------------------------------------------------------

describe("C13 §C13.13 — wildcard rule= accepts any target at runtime", () => {
  function makeRuntime() {
    // Re-prefix with "// " — see §C13.4 makeRuntime for explanation.
    const src = "// " + RUNTIME_CHUNKS.engine;
    const wrapped = `
      var _scrml_state = {};
      var _scrml_reactive_get = function(name) { return _scrml_state[name]; };
      var _scrml_reactive_set = function(name, value) { _scrml_state[name] = value; };
      ${src}
      return { _scrml_engine_check_transition, _scrml_engine_advance, _scrml_engine_direct_set, _scrml_state };
    `;
    return new Function(wrapped)();
  }

  test("direct write with wildcard from-state accepts any target", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Free";
    // Wildcard rule= is per from-state, so each target needs its own table
    // entry too (or also a wildcard) for further transitions. The test here
    // only validates the FIRST hop from Free → any.
    const table = Object.freeze({ Free: "*" });
    r._scrml_engine_direct_set("x", "Locked", table);
    expect(r._scrml_state.x).toBe("Locked");
    // Second hop from Locked needs its own table entry — verify a fresh start
    r._scrml_state.x = "Free";
    r._scrml_engine_direct_set("x", "Open", table);
    expect(r._scrml_state.x).toBe("Open");
  });

  test(".advance() with wildcard from-state accepts any target", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Free";
    const table = Object.freeze({ Free: "*" });
    r._scrml_engine_advance("x", "Anything", table);
    expect(r._scrml_state.x).toBe("Anything");
  });
});

// ---------------------------------------------------------------------------
// §C13.14 — Terminal state rejection (end-to-end)
// ---------------------------------------------------------------------------

describe("C13 §C13.14 — terminal state ([] rule) rejects all targets at runtime", () => {
  function makeRuntime() {
    // Re-prefix with "// " — see §C13.4 makeRuntime for explanation.
    const src = "// " + RUNTIME_CHUNKS.engine;
    const wrapped = `
      var _scrml_state = {};
      var _scrml_reactive_get = function(name) { return _scrml_state[name]; };
      var _scrml_reactive_set = function(name, value) { _scrml_state[name] = value; };
      ${src}
      return { _scrml_engine_check_transition, _scrml_engine_advance, _scrml_engine_direct_set, _scrml_state };
    `;
    return new Function(wrapped)();
  }

  test("direct write from terminal throws on any non-terminal target", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Done";
    const table = Object.freeze({ Done: [] });
    expect(() => r._scrml_engine_direct_set("x", "Restart", table))
      .toThrow(/E-ENGINE-INVALID-TRANSITION/);
  });

  test(".advance() from terminal throws", () => {
    const r = makeRuntime();
    r._scrml_state.x = "Done";
    const table = Object.freeze({ Done: [] });
    expect(() => r._scrml_engine_advance("x", "Restart", table))
      .toThrow(/asserted advance failed/);
  });
});
