/**
 * c12-engine-state-machine-runtime.test.js — A1c Step C12 unit tests
 *
 * Tests engine state-machine runtime substrate emission per SPEC §51.0.A-G.
 *
 *   §C12.0  isC12EngineDecl gating — predicate correctly discriminates
 *   §C12.1  engineTransitionTableName — naming convention
 *   §C12.2  resolveEngineInitialVariant — explicit + W-ENGINE-INITIAL-MISSING fallback
 *   §C12.3  emitEngineTransitionTable — single-target rules
 *   §C12.4  emitEngineTransitionTable — multi-target rules
 *   §C12.5  emitEngineTransitionTable — wildcard rules
 *   §C12.6  emitEngineTransitionTable — absent (terminal) rule
 *   §C12.7  emitEngineTransitionTable — mixed rule shapes
 *   §C12.8  emitEngineVariantCellInit — uses _scrml_reactive_set + bare-string
 *   §C12.9  emitEngineSubstrate — orchestrates table + cell init in order
 *   §C12.10 End-to-end: SYM-populated AST emits expected client JS shape
 *   §C12.11 End-to-end: `var=` override produces overridden cell + table name
 *   §C12.12 End-to-end: Mario engine — multi-target + single-target mix
 *   §C12.13 End-to-end: W-ENGINE-INITIAL-MISSING fallback to first state-child
 *   §C12.14 End-to-end: multiple engines in one file — independent tables/cells
 *   §C12.15 Discrimination: derived engines SKIPPED (C14 territory)
 *   §C12.16 Discrimination: legacy <engine> arrow-rule body SKIPPED
 *   §C12.17 No engines → emitEngineSubstrate returns []
 *
 * SCOPE: per BRIEF — variant cell + transition table + initial-state wiring
 * + AST kind discrimination + same-file mount position emission.
 * OUT OF SCOPE per BRIEF: direct-write rule= validation hook (deferred to
 * C13), `.advance()` (C13), `<onTransition>` firing (C13), derived engines
 * (C14), cross-file mount (C15), body-rendering (C13/follow-on).
 */

import { describe, test, expect } from "bun:test";
import {
  isC12EngineDecl,
  collectC12EngineDecls,
  engineTransitionTableName,
  resolveEngineInitialVariant,
  emitEngineTransitionTable,
  emitEngineVariantCellInit,
  emitEngineSubstrate,
} from "../../src/codegen/emit-engine.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";

// ---------------------------------------------------------------------------
// Helpers — minimal fixture constructors mirroring the B14/B15 substrate
// ---------------------------------------------------------------------------

/** Build a minimal engineMeta carrying the fields C12 reads. */
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

/** Build an engine-decl AST node with `_record.engineMeta` already populated. */
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

/** Run BS + TAB + SYM for a source string; return `{ast, sym}`. */
function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

/**
 * Build a minimal CompileContext for end-to-end client-JS emission.
 * Mirrors `cross-file-import-export.test.js makeTestCtx` shape.
 */
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
// §C12.0 — isC12EngineDecl gating predicate
// ---------------------------------------------------------------------------

describe("C12 §C12.0 — isC12EngineDecl gating", () => {
  test("engine-decl with non-empty stateChildren and no derivedExpr → in scope", () => {
    const node = engineDeclNode();
    expect(isC12EngineDecl(node)).toBe(true);
  });

  test("engine-decl WITHOUT _record → out of scope (parse-failure case)", () => {
    expect(isC12EngineDecl({ kind: "engine-decl" })).toBe(false);
  });

  test("engine-decl WITHOUT engineMeta → out of scope", () => {
    expect(isC12EngineDecl({ kind: "engine-decl", _record: {} })).toBe(false);
  });

  test("engine-decl with empty stateChildren → out of scope (legacy <engine>)", () => {
    const node = engineDeclNode({ stateChildren: [] });
    expect(isC12EngineDecl(node)).toBe(false);
  });

  test("engine-decl with derivedExpr → out of scope (C14 territory)", () => {
    const node = engineDeclNode({ derivedExpr: { kind: "legacy-source-var", varName: "src" } });
    expect(isC12EngineDecl(node)).toBe(false);
  });

  test("non-engine-decl AST node → out of scope", () => {
    expect(isC12EngineDecl({ kind: "state-decl", _record: { engineMeta: meta() } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §C12.1 — engineTransitionTableName naming convention
// ---------------------------------------------------------------------------

describe("C12 §C12.1 — engineTransitionTableName", () => {
  test("uses canonical __scrml_engine_<varName>_transitions format", () => {
    expect(engineTransitionTableName("marioState")).toBe("__scrml_engine_marioState_transitions");
    expect(engineTransitionTableName("loadPhase")).toBe("__scrml_engine_loadPhase_transitions");
  });

  test("`var=` override flows through naming function", () => {
    expect(engineTransitionTableName("playerHealth")).toBe("__scrml_engine_playerHealth_transitions");
  });
});

// ---------------------------------------------------------------------------
// §C12.2 — resolveEngineInitialVariant
// ---------------------------------------------------------------------------

describe("C12 §C12.2 — resolveEngineInitialVariant", () => {
  test("explicit initial=.X is honored", () => {
    expect(resolveEngineInitialVariant(meta({ initialVariant: "Big" }))).toBe("Big");
  });

  test("absent initial= falls back to first state-child variant", () => {
    expect(resolveEngineInitialVariant(meta({ initialVariant: null }))).toBe("Small");
  });

  test("both absent → returns null (defensive case)", () => {
    expect(resolveEngineInitialVariant(meta({ initialVariant: null, stateChildren: [] }))).toBeNull();
  });

  test("first state-child with empty tag → returns null", () => {
    expect(resolveEngineInitialVariant(meta({ initialVariant: null, stateChildren: [{ tag: "", rule: { kind: "absent" } }] }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §C12.3 / §C12.4 / §C12.5 / §C12.6 — emitEngineTransitionTable shapes
// ---------------------------------------------------------------------------

describe("C12 §C12.3 — single-target rule encoding", () => {
  test("rule=.X encodes as [\"X\"]", () => {
    const m = meta({
      stateChildren: [{ tag: "Small", rule: { kind: "single", target: "Big" } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"Small": ["Big"]');
  });
});

describe("C12 §C12.4 — multi-target rule encoding", () => {
  test("rule=(.A | .B | .C) encodes as [\"A\",\"B\",\"C\"]", () => {
    const m = meta({
      stateChildren: [{ tag: "Big", rule: { kind: "multi", targets: ["Fire", "Cape", "Small"] } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"Big": ["Fire","Cape","Small"]');
  });
});

describe("C12 §C12.5 — wildcard rule encoding", () => {
  test("rule=* encodes as the JSON string \"*\" sentinel", () => {
    const m = meta({
      stateChildren: [{ tag: "Free", rule: { kind: "wildcard" } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"Free": "*"');
  });
});

describe("C12 §C12.6 — absent (terminal) rule encoding", () => {
  test("absent rule encodes as []", () => {
    const m = meta({
      stateChildren: [{ tag: "Done", rule: { kind: "absent" } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"Done": []');
  });

  test("legacy-arrow rule encodes as [] (defensive — B15 already errored)", () => {
    const m = meta({
      stateChildren: [{ tag: "X", rule: { kind: "legacy-arrow", raw: "evt -> Y" } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"X": []');
  });

  test("parse-error rule encodes as [] (defensive)", () => {
    const m = meta({
      stateChildren: [{ tag: "X", rule: { kind: "parse-error", raw: "@@@", reason: "garbage" } }],
    });
    const out = emitEngineTransitionTable(m).join("\n");
    expect(out).toContain('"X": []');
  });
});

describe("C12 §C12.7 — mixed rule shapes (canonical Mario)", () => {
  test("Mario engine table emits all four state-children correctly", () => {
    const out = emitEngineTransitionTable(meta()).join("\n");
    // Frozen const naming
    expect(out).toContain("const __scrml_engine_marioState_transitions = Object.freeze({");
    // Each state-child entry
    expect(out).toContain('"Small": ["Big"]');
    expect(out).toContain('"Big": ["Fire","Cape","Small"]');
    expect(out).toContain('"Fire": ["Small"]');
    expect(out).toContain('"Cape": ["Small"]');
    // Closer
    expect(out).toMatch(/}\);$/m);
  });

  test("emits a §51.0.F locator comment", () => {
    const out = emitEngineTransitionTable(meta()).join("\n");
    expect(out).toContain("§51.0.F transition table for engine marioState: MarioState");
  });
});

// ---------------------------------------------------------------------------
// §C12.8 — emitEngineVariantCellInit
// ---------------------------------------------------------------------------

describe("C12 §C12.8 — variant cell init emission", () => {
  test("uses _scrml_reactive_set with bare-string variant value", () => {
    const out = emitEngineVariantCellInit(meta()).join("\n");
    expect(out).toContain('_scrml_reactive_set("marioState", "Small");');
  });

  test("emits a §51.0.C locator comment", () => {
    const out = emitEngineVariantCellInit(meta()).join("\n");
    expect(out).toContain("§51.0.C auto-declared engine variable: marioState (MarioState)");
  });

  test("`var=` override flows through cell init", () => {
    const out = emitEngineVariantCellInit(meta({ varName: "playerHealth", forType: "Health", initialVariant: "Healthy", stateChildren: [{ tag: "Healthy", rule: { kind: "absent" } }] })).join("\n");
    expect(out).toContain('_scrml_reactive_set("playerHealth", "Healthy");');
  });

  test("absent initialVariant + non-empty stateChildren → fallback to first variant", () => {
    const out = emitEngineVariantCellInit(meta({ initialVariant: null })).join("\n");
    expect(out).toContain('_scrml_reactive_set("marioState", "Small");');
  });

  test("no initialVariant resolvable → empty emission (defensive)", () => {
    const out = emitEngineVariantCellInit(meta({ initialVariant: null, stateChildren: [] }));
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C12.9 — emitEngineSubstrate orchestration
// ---------------------------------------------------------------------------

describe("C12 §C12.9 — emitEngineSubstrate orchestrates table + cell + mount marker", () => {
  test("emits transition table BEFORE variant cell init", () => {
    const fileAST = { machineDecls: [engineDeclNode()] };
    const out = emitEngineSubstrate(fileAST).join("\n");
    const tableIdx = out.indexOf("__scrml_engine_marioState_transitions");
    const cellIdx = out.indexOf('_scrml_reactive_set("marioState"');
    expect(tableIdx).toBeGreaterThan(-1);
    expect(cellIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeLessThan(cellIdx);
  });

  test("emits §51.0.D mount-position marker after cell init", () => {
    const fileAST = { machineDecls: [engineDeclNode()] };
    const out = emitEngineSubstrate(fileAST).join("\n");
    expect(out).toContain("§51.0.D engine mount position: marioState (MarioState)");
  });

  test("multiple engines emit independent table + cell + marker triplets", () => {
    const e1 = engineDeclNode();
    const e2 = engineDeclNode({
      forType: "LoadPhase",
      varName: "loadPhase",
      initialVariant: "Idle",
      variants: ["Idle", "Loading", "Done"],
      stateChildren: [
        { tag: "Idle", rule: { kind: "single", target: "Loading" } },
        { tag: "Loading", rule: { kind: "single", target: "Done" } },
        { tag: "Done", rule: { kind: "absent" } },
      ],
    });
    const fileAST = { machineDecls: [e1, e2] };
    const out = emitEngineSubstrate(fileAST).join("\n");
    expect(out).toContain("__scrml_engine_marioState_transitions");
    expect(out).toContain("__scrml_engine_loadPhase_transitions");
    expect(out).toContain('_scrml_reactive_set("marioState"');
    expect(out).toContain('_scrml_reactive_set("loadPhase"');
  });
});

// ---------------------------------------------------------------------------
// §C12.10 / §C12.11 / §C12.12 — End-to-end through SYM + emit-client
// ---------------------------------------------------------------------------

describe("C12 §C12.10 — end-to-end: SYM-populated AST emits expected client JS", () => {
  test("simple two-state engine emits transition table + cell init in client JS", () => {
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
    const ctx = makeTestCtx(fileAST);
    const js = generateClientJs(ctx);

    expect(js).toContain("// --- engine substrate (compiler-generated, §51.0) ---");
    expect(js).toContain("const __scrml_engine_phase_transitions = Object.freeze({");
    expect(js).toContain('"Idle": ["Done"]');
    expect(js).toContain('"Done": []');
    expect(js).toContain('_scrml_reactive_set("phase", "Idle");');
  });
});

describe("C12 §C12.11 — `var=` override produces overridden cell + table name", () => {
  test("var=playerHealth overrides default `health` for cell + table names", () => {
    const src = `<program>
\${
  type Health:enum = { Healthy, AtRisk, Critical }
}
<engine for=Health var=playerHealth initial=.Healthy>
  <Healthy rule=.AtRisk></>
  <AtRisk rule=(.Healthy | .Critical)></>
  <Critical></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).toContain("__scrml_engine_playerHealth_transitions");
    expect(js).toContain('_scrml_reactive_set("playerHealth", "Healthy");');
    // The auto-derived `health` name should NOT appear in engine substrate
    expect(js).not.toContain("__scrml_engine_health_transitions");
  });
});

describe("C12 §C12.12 — Mario engine with multi-target rules", () => {
  test("canonical Mario state machine emits all rules correctly", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big, Fire, Cape }
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

    expect(js).toContain('"Small": ["Big"]');
    expect(js).toContain('"Big": ["Fire","Cape","Small"]');
    expect(js).toContain('"Fire": ["Small"]');
    expect(js).toContain('"Cape": ["Small"]');
    expect(js).toContain('_scrml_reactive_set("marioState", "Small");');
  });
});

// ---------------------------------------------------------------------------
// §C12.13 — W-ENGINE-INITIAL-MISSING fallback path
// ---------------------------------------------------------------------------

describe("C12 §C12.13 — W-ENGINE-INITIAL-MISSING fallback to first state-child", () => {
  test("engine without initial= compiles + cell init uses first state-child variant", () => {
    const src = `<program>
\${
  type Phase:enum = { Loading, Ready }
}
<engine for=Phase>
  <Loading rule=.Ready></>
  <Ready></>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);
    // W-ENGINE-INITIAL-MISSING is a warning, not an error — should fire
    const warns = sym.errors.filter((e) => e.code === "W-ENGINE-INITIAL-MISSING");
    expect(warns.length).toBe(1);

    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls, nodes: ast.nodes, typeDecls: ast.typeDecls };
    const js = generateClientJs(makeTestCtx(fileAST));

    // Cell init falls back to first state-child variant (Loading)
    expect(js).toContain('_scrml_reactive_set("phase", "Loading");');
  });
});

// ---------------------------------------------------------------------------
// §C12.14 — Multiple engines per file (independence)
// ---------------------------------------------------------------------------

describe("C12 §C12.14 — multiple engines in one file emit independent tables/cells", () => {
  test("two engines produce two table consts and two cell inits", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big }
  type LoadPhase:enum = { Idle, Loading }
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

    expect(js).toContain("__scrml_engine_marioState_transitions");
    expect(js).toContain("__scrml_engine_loadPhase_transitions");
    expect(js).toContain('_scrml_reactive_set("marioState", "Small");');
    expect(js).toContain('_scrml_reactive_set("loadPhase", "Idle");');
  });
});

// ---------------------------------------------------------------------------
// §C12.15 / §C12.16 / §C12.17 — Discrimination + empty-case
// ---------------------------------------------------------------------------

describe("C12 §C12.15 — derived engines SKIPPED (C14 owns derived emission)", () => {
  test("derived=expr engine produces NO C12 substrate", () => {
    const src = `<program>
\${
  type MarioState:enum = { Small, Big }
  type Health:enum = { Healthy, Critical }
  @marioState: MarioState = MarioState.Small
}
<engine for=Health derived=@marioState>
  <Healthy/>
  <Critical/>
</>
</program>`;
    const { ast, sym } = runUpToSYM(src);

    // Walk to the derived engine-decl
    const eng = (ast.machineDecls || []).find((m) => m && m.kind === "engine-decl" && m.sourceVar);
    expect(eng).toBeDefined();
    expect(isC12EngineDecl(eng)).toBe(false);
    // Even if it were in the file, no C12 emit
    const out = emitEngineSubstrate({ machineDecls: [eng] });
    expect(out).toEqual([]);
  });
});

describe("C12 §C12.16 — legacy <engine> arrow-rule body SKIPPED", () => {
  test("legacy arrow-rule engine body produces NO C12 substrate (B15 leaves stateChildren empty)", () => {
    const src = `<program>
\${
  type Phase:enum = { Idle, Done }
}
<engine for=Phase initial=.Idle>
  .Idle => .Done
  .Done => .Idle
</>
</program>`;
    const { ast } = runUpToSYM(src);

    const eng = (ast.machineDecls || [])[0];
    // The legacy body is parsed as raw text and B15 leaves stateChildren
    // empty when isLegacyArrowRulesBody returns true.
    expect(eng?._record?.engineMeta?.stateChildren ?? []).toEqual([]);
    expect(isC12EngineDecl(eng)).toBe(false);

    // Confirm emit-engine emits nothing for legacy bodies.
    const out = emitEngineSubstrate({ machineDecls: [eng] });
    expect(out).toEqual([]);
  });
});

describe("C12 §C12.17 — no engines → empty emission", () => {
  test("file with no <engine> declarations emits no engine substrate section", () => {
    const src = `<program>
\${
  @count = 0
  function inc() { @count = @count + 1 }
}
<button onclick=inc()>+</button>
</program>`;
    const { ast } = runUpToSYM(src);
    const fileAST = { filePath: "test.scrml", ast, machineDecls: ast.machineDecls ?? [], nodes: ast.nodes, typeDecls: ast.typeDecls ?? [] };
    const js = generateClientJs(makeTestCtx(fileAST));

    expect(js).not.toContain("// --- engine substrate (compiler-generated, §51.0) ---");
    expect(js).not.toContain("__scrml_engine_");
  });

  test("emitEngineSubstrate returns empty array when no in-scope engines", () => {
    expect(emitEngineSubstrate({ machineDecls: [] })).toEqual([]);
    expect(emitEngineSubstrate({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C12.18 — Discovery walker (collectC12EngineDecls fallbacks)
// ---------------------------------------------------------------------------

describe("C12 §C12.18 — collectC12EngineDecls discovery", () => {
  test("prefers fileAST.machineDecls when present", () => {
    const e1 = engineDeclNode();
    const decls = collectC12EngineDecls({ machineDecls: [e1] });
    expect(decls.length).toBe(1);
    expect(decls[0]).toBe(e1);
  });

  test("falls back to fileAST.nodes walk when machineDecls absent", () => {
    const e1 = engineDeclNode();
    const programNode = { kind: "markup", tag: "program", children: [e1] };
    const decls = collectC12EngineDecls({ nodes: [programNode] });
    expect(decls.length).toBe(1);
    expect(decls[0]).toBe(e1);
  });

  test("filters out derived engines + empty-stateChildren engines", () => {
    const inScope = engineDeclNode();
    const derived = engineDeclNode({ derivedExpr: { kind: "x" } });
    const legacy = engineDeclNode({ stateChildren: [] });
    const decls = collectC12EngineDecls({ machineDecls: [inScope, derived, legacy] });
    expect(decls.length).toBe(1);
    expect(decls[0]).toBe(inScope);
  });

  test("dual-shape: reads from fileAST.ast.machineDecls when wrapped", () => {
    const e1 = engineDeclNode();
    const decls = collectC12EngineDecls({ ast: { machineDecls: [e1] } });
    expect(decls.length).toBe(1);
    expect(decls[0]).toBe(e1);
  });
});
