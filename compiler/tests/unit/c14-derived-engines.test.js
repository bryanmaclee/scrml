/**
 * c14-derived-engines.test.js — A1c Step C14 unit tests
 *
 * Tests derived engine substrate emission per SPEC §51.0.J (Lock L20).
 *
 *   §C14.0  isC14DerivedEngineDecl gating predicate
 *   §C14.1  collectC14DerivedEngineDecls walker discovery
 *   §C14.2  emitDerivedEngineSubstrate — single-source-var shape
 *   §C14.3  emitDerivedEngineSubstrate — section structure (declare/subscribe/forced-get)
 *   §C14.4  emitDerivedEngineSubstrate — initial-undefined throw inside closure
 *   §C14.5  emitDerivedEngineSubstrateForFile — orchestration + mount marker
 *   §C14.6  Discrimination: legacy <machine derived=@x> SKIPPED
 *   §C14.7  Discrimination: non-derived engine SKIPPED (C12 territory)
 *   §C14.8  End-to-end: derived engine emits expected client JS shape
 *   §C14.9  End-to-end: derived + non-derived engines coexist (no name collisions)
 *   §C14.10 End-to-end: client JS includes `derived` chunk for derived engines
 *   §C14.11 Runtime: derived engine variant cell follows upstream changes
 *   §C14.12 Runtime: chained derivation (engine A from upstream → engine B from A)
 *   §C14.13 Runtime: initial-undefined throw fires at engine-init time
 *   §C14.15 Full-pipeline boundary: §51.9.3 legacy projection needs a machine source
 *
 * SCOPE: per BRIEF — derived variant cell emission via `_scrml_derived_declare`
 * + `_scrml_derived_subscribe` + inline E-DERIVED-ENGINE-INITIAL-UNDEFINED
 * throw in the closure. The §C14.8/§C14.9/§C14.10 end-to-end cases drive
 * codegen DIRECTLY (`runUpToSYM` + `generateClientJs`), DELIBERATELY bypassing
 * the type pass's `validateDerivedMachines` (§51.9.3) so they exercise the
 * `legacy-source-var` identity-projection codegen in isolation. Their source
 * substrate (`@order: Phase` — a PLAIN enum cell) does NOT satisfy the §51.9.3
 * machine-source requirement, so it is REJECTED full-pipeline with E-ENGINE-004;
 * §C14.15 pins that boundary as intended behavior (and confirms the modern
 * §51.0.J `derived=match @order {...}` form is the correct full-pipeline shape
 * over a plain enum cell). The rich `derived=match @x {...}` form IS parsed as
 * of S190 (the older `NOT YET PARSED` note is retired).
 *
 * OUT OF SCOPE per BRIEF: <onTransition>/effect= firing on derived state-children
 * (parser blocker), body rendering (C13/follow-on), cross-file mount (C15).
 *
 * NEGATIVE TESTS for compile-time errors (E-DERIVED-ENGINE-NO-WRITE,
 * -NO-RULES, -NO-INITIAL) live in `derived-engine-rejections.test.js` (B16).
 * C14's tests verify codegen does not regress those rejections.
 */

import { describe, test, expect } from "bun:test";
import {
  isC14DerivedEngineDecl,
  collectC14DerivedEngineDecls,
  emitDerivedEngineSubstrate,
  emitDerivedEngineSubstrateForFile,
} from "../../src/codegen/emit-engine.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal engineMeta carrying the fields C14 reads. */
function meta({
  forType = "Health",
  varName = "health",
  initialVariant = null,
  variants = ["Healthy", "AtRisk", "Critical"],
  derivedExpr = { kind: "legacy-source-var", varName: "marioState" },
  stateChildren = [],
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

/** Build an engine-decl AST node with `_record.engineMeta` populated. */
function engineDeclNode(metaOverrides = {}, otherFields = {}) {
  const m = meta(metaOverrides);
  return {
    kind: "engine-decl",
    governedType: m.forType,
    varName: m.varName,
    initialVariant: m.initialVariant,
    sourceVar: (m.derivedExpr && m.derivedExpr.varName) || null,
    _record: { engineMeta: m },
    _cellKind: "engine",
    ...otherFields,
  };
}

/** Run BS + TAB + SYM on a source string. */
function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

/** Build a minimal CompileContext for end-to-end client-JS emission. */
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
// §C14.0 — isC14DerivedEngineDecl gating predicate
// ---------------------------------------------------------------------------

describe("C14 §C14.0 — isC14DerivedEngineDecl gating", () => {
  test("engine-decl with derivedExpr.kind === 'legacy-source-var' → in scope", () => {
    expect(isC14DerivedEngineDecl(engineDeclNode())).toBe(true);
  });

  test("engine-decl WITHOUT _record → out of scope (parse-failure case)", () => {
    expect(isC14DerivedEngineDecl({ kind: "engine-decl" })).toBe(false);
  });

  test("engine-decl WITHOUT engineMeta → out of scope", () => {
    expect(isC14DerivedEngineDecl({ kind: "engine-decl", _record: {} })).toBe(false);
  });

  test("engine-decl with derivedExpr=null → out of scope (C12 territory)", () => {
    expect(isC14DerivedEngineDecl(engineDeclNode({ derivedExpr: null }))).toBe(false);
  });

  test("legacy <machine> keyword → out of scope (emit-machines.ts owns it)", () => {
    const node = engineDeclNode({}, { legacyMachineKeyword: true });
    expect(isC14DerivedEngineDecl(node)).toBe(false);
  });

  test("non-engine-decl AST node → out of scope", () => {
    expect(isC14DerivedEngineDecl({ kind: "state-decl", _record: { engineMeta: meta() } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C14.1 — collectC14DerivedEngineDecls walker discovery
// ---------------------------------------------------------------------------

describe("C14 §C14.1 — collectC14DerivedEngineDecls discovery walker", () => {
  test("returns empty array when no engines exist", () => {
    expect(collectC14DerivedEngineDecls({ machineDecls: [] })).toEqual([]);
    expect(collectC14DerivedEngineDecls({ nodes: [] })).toEqual([]);
    expect(collectC14DerivedEngineDecls(null)).toEqual([]);
  });

  test("prefers fileAST.machineDecls when present", () => {
    const fileAST = { machineDecls: [engineDeclNode()] };
    expect(collectC14DerivedEngineDecls(fileAST).length).toBe(1);
  });

  test("falls back to nodes walk when machineDecls absent", () => {
    const fileAST = { nodes: [engineDeclNode()] };
    expect(collectC14DerivedEngineDecls(fileAST).length).toBe(1);
  });

  test("filters out non-derived engines", () => {
    const derived = engineDeclNode();
    const nonDerived = engineDeclNode({ derivedExpr: null, varName: "phase" });
    const fileAST = { machineDecls: [derived, nonDerived] };
    const out = collectC14DerivedEngineDecls(fileAST);
    expect(out.length).toBe(1);
    expect(out[0]._record.engineMeta.varName).toBe("health");
  });

  test("filters out legacy <machine> derived decls", () => {
    const newDerived = engineDeclNode();
    const legacyDerived = engineDeclNode({ varName: "ui" }, { legacyMachineKeyword: true });
    const fileAST = { machineDecls: [newDerived, legacyDerived] };
    const out = collectC14DerivedEngineDecls(fileAST);
    expect(out.length).toBe(1);
    expect(out[0]._record.engineMeta.varName).toBe("health");
  });
});

// ---------------------------------------------------------------------------
// §C14.2 — emitDerivedEngineSubstrate single-source-var shape
// ---------------------------------------------------------------------------

describe("C14 §C14.2 — emitDerivedEngineSubstrate emits derived-cell substrate", () => {
  test("emits _scrml_derived_declare with the engine var name", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain('_scrml_derived_declare("health"');
  });

  test("emits one _scrml_derived_subscribe per upstream", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain('_scrml_derived_subscribe("health", "marioState");');
  });

  test("emits forced initial _scrml_derived_get to fire init-time throw", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain('_scrml_derived_get("health");');
  });

  test("emits §51.0.J locator comment with upstream name", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain("§51.0.J derived engine: health (Health) — derived from marioState");
  });

  test("returns empty array when meta has null derivedExpr", () => {
    expect(emitDerivedEngineSubstrate(meta({ derivedExpr: null }))).toEqual([]);
  });

  test("returns empty array when meta has no varName", () => {
    expect(emitDerivedEngineSubstrate(meta({ varName: "" }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C14.3 — Section structure: declare BEFORE subscribe BEFORE forced-get
// ---------------------------------------------------------------------------

describe("C14 §C14.3 — section ordering: declare → subscribe → forced-get", () => {
  test("declare appears BEFORE subscribe BEFORE forced-get", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    const declareIdx = out.indexOf("_scrml_derived_declare");
    const subIdx = out.indexOf("_scrml_derived_subscribe");
    const getIdx = out.indexOf("_scrml_derived_get");
    expect(declareIdx).toBeGreaterThan(-1);
    expect(subIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeGreaterThan(-1);
    expect(declareIdx).toBeLessThan(subIdx);
    expect(subIdx).toBeLessThan(getIdx);
  });
});

// ---------------------------------------------------------------------------
// §C14.4 — Initial-undefined throw INLINE inside the closure
// ---------------------------------------------------------------------------

describe("C14 §C14.4 — E-DERIVED-ENGINE-INITIAL-UNDEFINED throw is inline", () => {
  test("closure body checks for absence and throws E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    // S93 fix — `== null` (loose) replaces strict `=== undefined` so the
    // W-CG-UNDEFINED-INTERPOLATION lint doesn't fire on emitted output.
    // `== null` covers both JS null (canonical scrml absence per M-7C-D-12)
    // and JS undefined (returned by reactive store for unregistered cells).
    expect(out).toContain("if (__scrml_derived_v == null)");
    expect(out).toContain("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT");
  });

  test("error message includes the engine varName + upstream name", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain("derived engine 'health'");
    expect(out).toContain("upstream 'marioState'");
  });

  test("error message includes spec ref + diagnostic guidance", () => {
    const out = emitDerivedEngineSubstrate(meta()).join("\n");
    expect(out).toContain("§51.0.J");
    expect(out).toContain("default arm or a wildcard arm");
  });
});

// ---------------------------------------------------------------------------
// §C14.5 — emitDerivedEngineSubstrateForFile orchestration + mount marker
// ---------------------------------------------------------------------------

describe("C14 §C14.5 — emitDerivedEngineSubstrateForFile orchestration", () => {
  test("emits §51.0.D mount-position marker per derived engine", () => {
    const fileAST = { machineDecls: [engineDeclNode()] };
    const out = emitDerivedEngineSubstrateForFile(fileAST).join("\n");
    expect(out).toContain("§51.0.D engine mount position: health (Health) — DERIVED");
  });

  test("multiple derived engines emit independent triplets + markers", () => {
    const e1 = engineDeclNode();
    const e2 = engineDeclNode({
      forType: "Mood",
      varName: "mood",
      derivedExpr: { kind: "legacy-source-var", varName: "weather" },
    });
    const fileAST = { machineDecls: [e1, e2] };
    const out = emitDerivedEngineSubstrateForFile(fileAST).join("\n");
    expect(out).toContain('_scrml_derived_declare("health"');
    expect(out).toContain('_scrml_derived_declare("mood"');
    expect(out).toContain('_scrml_derived_subscribe("health", "marioState");');
    expect(out).toContain('_scrml_derived_subscribe("mood", "weather");');
  });

  test("returns empty array when no in-scope derived engines", () => {
    const fileAST = { machineDecls: [] };
    expect(emitDerivedEngineSubstrateForFile(fileAST)).toEqual([]);
  });

  test("returns empty array when only non-derived engines exist", () => {
    const fileAST = { machineDecls: [engineDeclNode({ derivedExpr: null })] };
    expect(emitDerivedEngineSubstrateForFile(fileAST)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C14.6 — Discrimination: legacy <machine derived=@x> SKIPPED
// ---------------------------------------------------------------------------

describe("C14 §C14.6 — legacy <machine derived=@x> NOT emitted by C14", () => {
  test("collectC14DerivedEngineDecls returns 0 for legacy machine forms", () => {
    const legacy = engineDeclNode({}, { legacyMachineKeyword: true });
    const fileAST = { machineDecls: [legacy] };
    expect(collectC14DerivedEngineDecls(fileAST).length).toBe(0);
  });

  test("emitDerivedEngineSubstrateForFile produces no output for legacy machines", () => {
    const legacy = engineDeclNode({}, { legacyMachineKeyword: true });
    const fileAST = { machineDecls: [legacy] };
    expect(emitDerivedEngineSubstrateForFile(fileAST)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C14.7 — Discrimination: non-derived engine SKIPPED (C12 territory)
// ---------------------------------------------------------------------------

describe("C14 §C14.7 — non-derived engines SKIPPED (C12 territory)", () => {
  test("isC14DerivedEngineDecl returns false for non-derived", () => {
    expect(isC14DerivedEngineDecl(engineDeclNode({ derivedExpr: null }))).toBe(false);
  });

  test("emitDerivedEngineSubstrateForFile output is empty for non-derived only", () => {
    const fileAST = {
      machineDecls: [engineDeclNode({ derivedExpr: null, varName: "phase" })],
    };
    expect(emitDerivedEngineSubstrateForFile(fileAST)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C14.8 — End-to-end: derived engine emits expected client JS shape
// ---------------------------------------------------------------------------

describe("C14 §C14.8 — end-to-end client JS emission for derived engine", () => {
  // NOTE: drives codegen DIRECTLY (skips validateDerivedMachines). The `@order: Phase`
  // plain-cell source is full-pipeline-REJECTED (E-ENGINE-004) — see §C14.15.
  test("`<engine for=Health derived=@order>...state-children...</>` emits derived substrate", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  type Health:enum = { Idle, Loading, Done }
  @order: Phase = Phase.Idle
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
<engine for=Health derived=@order>
  <Idle></>
  <Loading></>
  <Done></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = {
      filePath: "test.scrml",
      ast,
      machineDecls: ast.machineDecls,
      nodes: ast.nodes,
      typeDecls: ast.typeDecls,
    };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).toContain("// --- derived engine substrate (compiler-generated, §51.0.J) ---");
    expect(js).toContain('_scrml_derived_declare("health"');
    expect(js).toContain('_scrml_derived_subscribe("health", "order");');
    expect(js).toContain('_scrml_derived_get("health");');
    expect(js).toContain("§51.0.J derived engine: health (Health)");
  });
});

// ---------------------------------------------------------------------------
// §C14.9 — Derived + non-derived engines coexist (no name collisions)
// ---------------------------------------------------------------------------

describe("C14 §C14.9 — derived + non-derived engines coexist in one file", () => {
  // NOTE: codegen-direct (skips validateDerivedMachines); plain-cell source — see §C14.15.
  test("both engines emit independent substrates; no name collisions", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading }
  type Health:enum = { Idle, Loading }
  @order: Phase = Phase.Idle
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
<engine for=Health derived=@order>
  <Idle></>
  <Loading></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = {
      filePath: "test.scrml",
      ast,
      machineDecls: ast.machineDecls,
      nodes: ast.nodes,
      typeDecls: ast.typeDecls,
    };
    const js = generateClientJs(makeTestCtx(fileAST));

    // C12 substrate for Phase
    expect(js).toContain("__scrml_engine_phase_transitions");
    expect(js).toContain('_scrml_reactive_set("phase", "Idle");');
    // C14 substrate for Health
    expect(js).toContain('_scrml_derived_declare("health"');
    expect(js).toContain('_scrml_derived_subscribe("health", "order");');

    // Health is NOT also emitted as a non-derived engine (no transition table for it)
    expect(js).not.toContain("__scrml_engine_health_transitions");
    // Phase is NOT also emitted as a derived engine
    expect(js).not.toContain('_scrml_derived_declare("phase"');
  });
});

// ---------------------------------------------------------------------------
// §C14.10 — `derived` chunk pulled in for derived engines
// ---------------------------------------------------------------------------

describe("C14 §C14.10 — emit-client.ts pulls in `derived` chunk for derived engines", () => {
  // NOTE: codegen-direct (skips validateDerivedMachines); plain-cell source — see §C14.15.
  test("client JS includes _scrml_derived_declare runtime helper", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading }
  type Health:enum = { Idle, Loading }
  @order: Phase = Phase.Idle
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
<engine for=Health derived=@order>
  <Idle></>
  <Loading></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = {
      filePath: "test.scrml",
      ast,
      machineDecls: ast.machineDecls,
      nodes: ast.nodes,
      typeDecls: ast.typeDecls,
    };
    const js = generateClientJs(makeTestCtx(fileAST));

    // The runtime helper definitions from the `derived` chunk MUST be present
    expect(js).toContain("function _scrml_derived_declare");
    expect(js).toContain("function _scrml_derived_subscribe");
    expect(js).toContain("function _scrml_derived_get");
  });
});

// ---------------------------------------------------------------------------
// §C14.11 — Runtime: derived engine variant cell follows upstream changes
// ---------------------------------------------------------------------------

describe("C14 §C14.11 — runtime: derived variant cell follows upstream changes", () => {
  function makeRuntime() {
    // Build a minimal sandbox with the derived runtime helpers from the
    // runtime template + a minimal _scrml_state/_scrml_reactive_get/set.
    return new Function(`
      var _scrml_state = {};
      var _scrml_subscribers = {};
      var _scrml_derived_fns = {};
      var _scrml_derived_cache = {};
      var _scrml_derived_dirty = {};
      var _scrml_derived_downstreams = {};

      function _scrml_propagate_dirty(name) {
        var queue = [name]; var visited = new Set(); var dirtied = [];
        while (queue.length > 0) {
          var current = queue.shift();
          if (visited.has(current)) continue;
          visited.add(current);
          var downstreams = _scrml_derived_downstreams[current];
          if (downstreams) {
            for (var d of downstreams) {
              if (!_scrml_derived_dirty[d]) {
                _scrml_derived_dirty[d] = true;
                dirtied.push(d);
                queue.push(d);
              }
            }
          }
        }
        return dirtied;
      }

      function _scrml_reactive_get(name) {
        if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
        return _scrml_state[name];
      }
      function _scrml_reactive_set(name, value) {
        _scrml_state[name] = value;
        _scrml_propagate_dirty(name);
        return value;
      }
      function _scrml_derived_declare(name, fn) {
        _scrml_derived_fns[name] = fn;
        _scrml_derived_cache[name] = undefined;
        _scrml_derived_dirty[name] = true;
      }
      function _scrml_derived_subscribe(derived, upstream) {
        if (!_scrml_derived_downstreams[upstream]) _scrml_derived_downstreams[upstream] = new Set();
        _scrml_derived_downstreams[upstream].add(derived);
      }
      function _scrml_derived_get(name) {
        if (_scrml_derived_dirty[name]) {
          _scrml_derived_dirty[name] = false;
          var fn = _scrml_derived_fns[name];
          if (fn) _scrml_derived_cache[name] = fn();
        }
        return _scrml_derived_cache[name];
      }

      return { _scrml_reactive_get, _scrml_reactive_set, _scrml_derived_declare, _scrml_derived_subscribe, _scrml_derived_get, _scrml_state };
    `)();
  }

  test("variant cell value matches upstream cell value (identity projection)", () => {
    const r = makeRuntime();
    // Set upstream first so the init-time forced read sees a defined value.
    r._scrml_state.upstream = "A";
    r._scrml_derived_declare("derived", () => {
      const v = r._scrml_reactive_get("upstream");
      if (v === undefined) throw new Error("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT");
      return v;
    });
    r._scrml_derived_subscribe("derived", "upstream");
    r._scrml_derived_get("derived"); // forced initial read

    expect(r._scrml_reactive_get("derived")).toBe("A");
  });

  test("source cell change triggers re-projection on next read", () => {
    const r = makeRuntime();
    r._scrml_state.upstream = "A";
    r._scrml_derived_declare("derived", () => {
      const v = r._scrml_reactive_get("upstream");
      if (v === undefined) throw new Error("UNDEF");
      return v;
    });
    r._scrml_derived_subscribe("derived", "upstream");
    r._scrml_derived_get("derived");

    // Now change upstream
    r._scrml_reactive_set("upstream", "B");
    expect(r._scrml_reactive_get("derived")).toBe("B");

    r._scrml_reactive_set("upstream", "C");
    expect(r._scrml_reactive_get("derived")).toBe("C");
  });
});

// ---------------------------------------------------------------------------
// §C14.12 — Runtime: chained derivation (A → B → C)
// ---------------------------------------------------------------------------

describe("C14 §C14.12 — runtime: chained derivation cascading updates work", () => {
  test("derivedB tracks derivedA tracks raw upstream", () => {
    // Same sandbox setup as §C14.11.
    const r = new Function(`
      var _scrml_state = {};
      var _scrml_derived_fns = {};
      var _scrml_derived_cache = {};
      var _scrml_derived_dirty = {};
      var _scrml_derived_downstreams = {};
      function _scrml_propagate_dirty(name) {
        var queue = [name]; var visited = new Set(); var dirtied = [];
        while (queue.length > 0) {
          var c = queue.shift();
          if (visited.has(c)) continue;
          visited.add(c);
          var ds = _scrml_derived_downstreams[c];
          if (ds) {
            for (var d of ds) {
              if (!_scrml_derived_dirty[d]) { _scrml_derived_dirty[d] = true; dirtied.push(d); queue.push(d); }
            }
          }
        }
        return dirtied;
      }
      function _scrml_reactive_get(name) {
        if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
        return _scrml_state[name];
      }
      function _scrml_reactive_set(name, value) {
        _scrml_state[name] = value;
        _scrml_propagate_dirty(name);
        return value;
      }
      function _scrml_derived_declare(name, fn) {
        _scrml_derived_fns[name] = fn;
        _scrml_derived_cache[name] = undefined;
        _scrml_derived_dirty[name] = true;
      }
      function _scrml_derived_subscribe(derived, upstream) {
        if (!_scrml_derived_downstreams[upstream]) _scrml_derived_downstreams[upstream] = new Set();
        _scrml_derived_downstreams[upstream].add(derived);
      }
      function _scrml_derived_get(name) {
        if (_scrml_derived_dirty[name]) {
          _scrml_derived_dirty[name] = false;
          var fn = _scrml_derived_fns[name];
          if (fn) _scrml_derived_cache[name] = fn();
        }
        return _scrml_derived_cache[name];
      }
      return { _scrml_reactive_get, _scrml_reactive_set, _scrml_derived_declare, _scrml_derived_subscribe, _scrml_derived_get, _scrml_state };
    `)();

    r._scrml_state.upstream = "X";
    r._scrml_derived_declare("derivedA", () => {
      const v = r._scrml_reactive_get("upstream");
      if (v === undefined) throw new Error("UNDEF-A");
      return v;
    });
    r._scrml_derived_subscribe("derivedA", "upstream");
    r._scrml_derived_get("derivedA");

    r._scrml_derived_declare("derivedB", () => {
      const v = r._scrml_reactive_get("derivedA");
      if (v === undefined) throw new Error("UNDEF-B");
      return v;
    });
    r._scrml_derived_subscribe("derivedB", "derivedA");
    r._scrml_derived_get("derivedB");

    expect(r._scrml_reactive_get("derivedA")).toBe("X");
    expect(r._scrml_reactive_get("derivedB")).toBe("X");

    r._scrml_reactive_set("upstream", "Y");
    expect(r._scrml_reactive_get("derivedA")).toBe("Y");
    expect(r._scrml_reactive_get("derivedB")).toBe("Y");
  });
});

// ---------------------------------------------------------------------------
// §C14.13 — Initial-value undefined throws E-DERIVED-ENGINE-INITIAL-UNDEFINED
// ---------------------------------------------------------------------------

describe("C14 §C14.13 — initial-undefined throw fires at engine-init time", () => {
  test("forced initial _scrml_derived_get throws E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT when upstream is undefined", () => {
    const r = new Function(`
      var _scrml_state = {};
      var _scrml_derived_fns = {};
      var _scrml_derived_cache = {};
      var _scrml_derived_dirty = {};
      function _scrml_reactive_get(name) {
        if (_scrml_derived_fns[name]) return _scrml_derived_get(name);
        return _scrml_state[name];
      }
      function _scrml_derived_declare(name, fn) {
        _scrml_derived_fns[name] = fn;
        _scrml_derived_cache[name] = undefined;
        _scrml_derived_dirty[name] = true;
      }
      function _scrml_derived_get(name) {
        if (_scrml_derived_dirty[name]) {
          _scrml_derived_dirty[name] = false;
          var fn = _scrml_derived_fns[name];
          if (fn) _scrml_derived_cache[name] = fn();
        }
        return _scrml_derived_cache[name];
      }
      return { _scrml_reactive_get, _scrml_derived_declare, _scrml_derived_get, _scrml_state };
    `)();

    // upstream is NOT set in _scrml_state — `_scrml_reactive_get` returns undefined.
    r._scrml_derived_declare("derived", () => {
      const v = r._scrml_reactive_get("upstream");
      if (v === undefined) {
        throw new Error("E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT: derived engine 'derived' yielded no value (upstream 'upstream' is undefined). Per §51.0.J + §34: derived=expr must produce a defined variant for the source's initial state. Add a default arm or a wildcard arm in the derivation.");
      }
      return v;
    });
    expect(() => r._scrml_derived_get("derived")).toThrow(/E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT/);
  });
});

// ---------------------------------------------------------------------------
// §C14.14 — Negative test: B16 rejections NOT regressed by C14 emission
// ---------------------------------------------------------------------------

describe("C14 §C14.14 — A1b/B16 compile-time rejections still fire (no regression)", () => {
  test("legacy <machine derived=@x>: C14 produces no derived substrate", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading }
  type Health:enum = { Idle, Loading }
  @order: Phase = Phase.Idle
}
< machine name=OrderMachine for=Phase>
  .Idle => .Loading
  .Loading => .Idle
</>
< machine name=UI for=Health derived=@order>
  .Idle => .Idle
  .Loading => .Loading
</>
</program>`;
    const { ast } = runUpToSYM(src);
    const fileAST = {
      filePath: "test.scrml",
      ast,
      machineDecls: ast.machineDecls,
      nodes: ast.nodes,
      typeDecls: ast.typeDecls,
    };
    const js = generateClientJs(makeTestCtx(fileAST));

    // Legacy <machine> uses emit-machines.ts wiring; C14 substrate must NOT emit.
    expect(js).not.toContain("// --- derived engine substrate (compiler-generated, §51.0.J) ---");
    expect(js).not.toContain('_scrml_derived_declare("ui", () => {');
  });
});

// ---------------------------------------------------------------------------
// §C14.15 — Full-pipeline boundary: §51.9.3 legacy projection needs a machine
// source. The §C14.8/§C14.9/§C14.10 cases drive codegen directly and so never
// run validateDerivedMachines; these drive the REAL compile() to pin the
// §51.9.3 boundary and confirm the modern §51.0.J shape is the plain-cell path.
// ---------------------------------------------------------------------------

describe("C14 §C14.15 — full-pipeline §51.9.3 machine-source boundary", () => {
  let TMP;
  function compileSource(name, source) {
    if (!TMP) TMP = mkdtempSync(join(tmpdir(), "c14-fullpipe-"));
    const filePath = join(TMP, `${name}.scrml`);
    writeFileSync(filePath, source);
    const result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(TMP, `${name}.dist`),
      write: false,
      log: () => {},
    });
    return {
      errors: result.errors || [],
      warnings: result.warnings || [],
    };
  }

  test("legacy `derived=@order` over a PLAIN enum cell fires E-ENGINE-004 (machine-source required)", () => {
    // Same substrate the §C14.8 codegen-direct case uses: @order is a plain
    // `Phase` enum cell, NOT machine-bound (the sibling `<engine for=Phase>`
    // binds the auto-cell @phase). The legacy 1:1 projection (§51.9.3) has no
    // machine source → E-ENGINE-004.
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  type Health:enum = { Idle, Loading, Done }
  @order: Phase = Phase.Idle
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
<engine for=Health derived=@order>
  <Idle></>
  <Loading></>
  <Done></>
</>
</program>`;
    const result = compileSource("plain-cell-legacy", src);
    const fires = result.errors.filter((e) => e.code === "E-ENGINE-004");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    // The improved diagnostic steers to BOTH the machine-source form AND the
    // modern §51.0.J `derived=match` form that works over a plain enum cell.
    expect(fires[0].message).toMatch(/§51\.9\.3/);
    expect(fires[0].message).toMatch(/derived=match @order/);
    expect(fires[0].message).toMatch(/SomeMachine/);
  });

  test("modern `derived=match @order { ... }` over the SAME plain enum cell compiles clean", () => {
    // §51.0.J — the modern expression form projects a plain enum cell variant
    // by variant; no machine source required, so NO E-ENGINE-004.
    const src = `<program>
\${
  type Phase:enum = { Idle, Loading, Done }
  type Health:enum = { Idle, Loading, Done }
  @order: Phase = Phase.Idle
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
<engine for=Health derived=match @order { .Idle => .Idle, .Loading => .Loading, .Done => .Done }>
  <Idle></>
  <Loading></>
  <Done></>
</>
</program>`;
    const result = compileSource("plain-cell-modern", src);
    expect(result.errors.filter((e) => e.code === "E-ENGINE-004")).toEqual([]);
    expect(result.errors.filter((e) => e.severity === "error")).toEqual([]);
  });
});
