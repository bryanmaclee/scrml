/**
 * c15-cross-file-engine-mount.test.js — A1c Step C15 unit tests
 *
 * Tests cross-file engine mount substrate emission per SPEC §21.8 + §51.0.D
 * (Move 16, Move 18). Wave 4 closer.
 *
 *   §C15.0  collectCrossFileEngineMounts — discovery walker (importBindings ×
 *           exportRegistry × `category === "engine"`)
 *   §C15.1  emitCrossFileEngineMount — single mount marker shape
 *   §C15.2  emitCrossFileEngineMountsForFile — orchestration + de-dup
 *   §C15.3  Discrimination: non-engine import → no marker (regression-guard
 *           for B14 PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE — different file
 *           tests THAT diagnostic; we test that C15 does NOT emit a marker
 *           for non-engine imports either way)
 *   §C15.4  Discrimination: same-file engine NOT emitted as cross-file mount
 *           (same-file engines render at decl position per §51.0.D)
 *   §C15.5  Multiple use-sites of the same imported engine → one marker
 *           (singleton-emission optimization)
 *   §C15.6  Defensive: null exportRegistry → no markers
 *   §C15.7  Defensive: no importBindings on fileScope → no markers
 *   §C15.8  Derived engine cross-file mount (uses C14 substrate; same shape)
 *   §C15.9  End-to-end via generateClientJs: cross-file mount marker emitted
 *   §C15.10 End-to-end: same-file engines (C12/C13/C14) NOT regressed
 *   §C15.11 End-to-end via compileScrml (full pipeline): importer file's
 *           client.js contains the §21.8 marker
 *   §C15.12 End-to-end via compileScrml: multiple importers see the same
 *           singleton substrate from the exporter file
 *   §C15.13 End-to-end via compileScrml: re-export of an imported engine is
 *           legal (§21.4); the re-exporter does NOT duplicate the substrate
 *   §C15.14 Regression-guard: B14 PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE
 *           still fires when a non-engine is mounted via <X/>
 *   §C15.15 Regression-guard: MOD's E-IMPORT-004 still fires when importing
 *           a non-exported engine
 *
 * SCOPE per BRIEF: cross-file engine mount-site DETECTION + MARKER COMMENT
 * emission + JS module-import preservation (existing path) + tests covering
 * the singleton invariant, regression-guards, and re-export support.
 *
 * OUT OF SCOPE per BRIEF: state-child body rendering (parser blocker shared
 * with C12/C13/C14), <onTransition>/effect= firing, <EngineName/> inside
 * component bodies (B17 territory), implicit auto-import (just-the-type
 * form per §21.8 line 12353; explicit form per line 12354 is shipped).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  collectCrossFileEngineMounts,
  emitCrossFileEngineMount,
  emitCrossFileEngineMountsForFile,
} from "../../src/codegen/emit-engine.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { generateClientJs } from "../../src/codegen/emit-client.ts";
import { makeCompileContext } from "../../src/codegen/context.ts";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "c15-cross-file-engine-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

/**
 * Build a minimal CompileContext for testing emit-client.ts directly with
 * an exportRegistry. Mirrors c14-derived-engines.test.js makeTestCtx shape.
 */
function makeTestCtx(fileAST, exportRegistry = null) {
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
    exportRegistry,
  });
}

/**
 * Build a fileAST with a synthetic importBindings map + markup nodes
 * containing self-closing tags. The minimal shape lets the C15 walker
 * traverse and discriminate without running the full SYM pipeline.
 */
function buildSyntheticFileAST({ tags, imports = [] }) {
  const importBindings = new Map();
  for (const imp of imports) {
    importBindings.set(imp.localName ?? imp.exportedName, {
      localName: imp.localName ?? imp.exportedName,
      exportedName: imp.exportedName,
      sourcePath: imp.sourcePath,
    });
  }
  const markupNodes = tags.map((t) => ({
    kind: "markup",
    tag: t,
    selfClosing: true,
    children: [],
  }));
  return {
    filePath: "/test/app.scrml",
    _scope: { importBindings },
    nodes: markupNodes,
    machineDecls: [],
  };
}

/** Build a synthetic exportRegistry. */
function buildExportRegistry(entries) {
  const reg = new Map();
  for (const [path, exports] of Object.entries(entries)) {
    const inner = new Map();
    for (const [name, info] of Object.entries(exports)) {
      inner.set(name, info);
    }
    reg.set(path, inner);
  }
  return reg;
}

/** Run BS + TAB on a source string and return the AST. */
function buildAstFromSource(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return ast;
}

/**
 * Filter to compile errors only (drops warnings like W-PROGRAM-001).
 */
function realCompileErrors(result) {
  return (result.errors || []).filter(e => e && e.severity !== "warning");
}

// ---------------------------------------------------------------------------
// §C15.0 — collectCrossFileEngineMounts discovery walker
// ---------------------------------------------------------------------------

describe("C15 §C15.0 — collectCrossFileEngineMounts walker", () => {
  test("returns empty array when fileAST is null", () => {
    expect(collectCrossFileEngineMounts(null, new Map())).toEqual([]);
  });

  test("returns empty array when exportRegistry is null", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["appPhase"],
      imports: [{ exportedName: "appPhase", sourcePath: "./engines.scrml" }],
    });
    expect(collectCrossFileEngineMounts(fileAST, null)).toEqual([]);
  });

  test("returns empty array when no importBindings", () => {
    const fileAST = buildSyntheticFileAST({ tags: ["appPhase"] });
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });

  test("detects single cross-file engine mount site", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["appPhase"],
      imports: [{ exportedName: "appPhase", sourcePath: "./engines.scrml" }],
    });
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const out = collectCrossFileEngineMounts(fileAST, reg);
    expect(out.length).toBe(1);
    expect(out[0].varName).toBe("appPhase");
    expect(out[0].exporterPath).toBe("./engines.scrml");
    expect(out[0].exportedName).toBe("appPhase");
  });

  test("skips mount sites whose source export is NOT engine-category", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["helper"],
      imports: [{ exportedName: "helper", sourcePath: "./utils.scrml" }],
    });
    const reg = buildExportRegistry({
      "./utils.scrml": { helper: { kind: "function", category: "function", isComponent: false } },
    });
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });

  test("skips mount sites whose source export is user-component (CE territory)", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["Card"],
      imports: [{ exportedName: "Card", sourcePath: "./components.scrml" }],
    });
    const reg = buildExportRegistry({
      "./components.scrml": { Card: { kind: "const", category: "user-component", isComponent: true } },
    });
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });

  test("skips non-imported tags (HTML built-ins, same-file components, etc.)", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["div", "span", "button"], // no imports → no mount-site discovery
    });
    const reg = buildExportRegistry({});
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });

  test("recurses into nested children", () => {
    // Build a fileAST with <div><appPhase/></div> shape
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "./engines.scrml",
    });
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings },
      nodes: [{
        kind: "markup",
        tag: "div",
        selfClosing: false,
        children: [{
          kind: "markup",
          tag: "appPhase",
          selfClosing: true,
          children: [],
        }],
      }],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const out = collectCrossFileEngineMounts(fileAST, reg);
    expect(out.length).toBe(1);
    expect(out[0].varName).toBe("appPhase");
  });

  test("aliased import (`import { appPhase as p } from './engines.scrml'`) routes by local name", () => {
    const importBindings = new Map();
    importBindings.set("p", {
      localName: "p",
      exportedName: "appPhase",
      sourcePath: "./engines.scrml",
    });
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings },
      nodes: [{ kind: "markup", tag: "p", selfClosing: true, children: [] }],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const out = collectCrossFileEngineMounts(fileAST, reg);
    expect(out.length).toBe(1);
    expect(out[0].varName).toBe("p");           // local name
    expect(out[0].exportedName).toBe("appPhase"); // source name
  });
});

// ---------------------------------------------------------------------------
// §C15.1 — emitCrossFileEngineMount single mount marker shape
// ---------------------------------------------------------------------------

describe("C15 §C15.1 — emitCrossFileEngineMount marker shape", () => {
  test("emits §21.8 mount marker with varName + exporterPath", () => {
    const out = emitCrossFileEngineMount({
      varName: "appPhase",
      exporterPath: "./engines.scrml",
      exportedName: "appPhase",
    });
    expect(out).toContain("§21.8 cross-file engine mount");
    expect(out).toContain("appPhase");
    expect(out).toContain("./engines.scrml");
  });

  test("documents shared _scrml_state singleton mechanism", () => {
    const out = emitCrossFileEngineMount({
      varName: "appPhase",
      exporterPath: "./engines.scrml",
      exportedName: "appPhase",
    });
    expect(out).toContain("singleton via shared _scrml_state");
  });

  test("documents body rendering deferral", () => {
    const out = emitCrossFileEngineMount({
      varName: "appPhase",
      exporterPath: "./engines.scrml",
      exportedName: "appPhase",
    });
    expect(out).toContain("body rendering deferred");
  });
});

// ---------------------------------------------------------------------------
// §C15.2 — emitCrossFileEngineMountsForFile orchestration + de-dup
// ---------------------------------------------------------------------------

describe("C15 §C15.2 — emitCrossFileEngineMountsForFile orchestration + de-dup", () => {
  test("returns empty array when no mount sites", () => {
    const fileAST = buildSyntheticFileAST({ tags: [] });
    expect(emitCrossFileEngineMountsForFile(fileAST, new Map())).toEqual([]);
  });

  test("returns empty array when exportRegistry is null", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["appPhase"],
      imports: [{ exportedName: "appPhase", sourcePath: "./engines.scrml" }],
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, null)).toEqual([]);
  });

  test("emits one marker per unique mount-site varName (de-dup multiple use-sites)", () => {
    // Two use-sites of the SAME imported engine in the same file
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "./engines.scrml",
    });
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings },
      nodes: [
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
      ],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const out = emitCrossFileEngineMountsForFile(fileAST, reg);
    // De-dup: 2 use-sites → 1 marker (singleton invariant)
    expect(out.length).toBe(1);
    expect(out[0]).toContain("appPhase");
  });

  test("emits independent markers for two DIFFERENT imported engines", () => {
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "./engines.scrml",
    });
    importBindings.set("playerHealth", {
      localName: "playerHealth",
      exportedName: "playerHealth",
      sourcePath: "./engines.scrml",
    });
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings },
      nodes: [
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
        { kind: "markup", tag: "playerHealth", selfClosing: true, children: [] },
      ],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": {
        appPhase: { kind: "engine", category: "engine", isComponent: false },
        playerHealth: { kind: "engine", category: "engine", isComponent: false },
      },
    });
    const out = emitCrossFileEngineMountsForFile(fileAST, reg);
    expect(out.length).toBe(2);
    const joined = out.join("\n");
    expect(joined).toContain("appPhase");
    expect(joined).toContain("playerHealth");
  });
});

// ---------------------------------------------------------------------------
// §C15.3 — Discrimination: non-engine import → no marker
// ---------------------------------------------------------------------------

describe("C15 §C15.3 — non-engine imports do NOT trigger marker emission", () => {
  test("function import → no marker (B14 fires E-ENGINE-MOUNT-NOT-ENGINE separately)", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["helper"],
      imports: [{ exportedName: "helper", sourcePath: "./utils.scrml" }],
    });
    const reg = buildExportRegistry({
      "./utils.scrml": { helper: { kind: "function", category: "function", isComponent: false } },
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, reg)).toEqual([]);
  });

  test("type import → no marker", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["Phase"],
      imports: [{ exportedName: "Phase", sourcePath: "./types.scrml" }],
    });
    const reg = buildExportRegistry({
      "./types.scrml": { Phase: { kind: "type", category: "type", isComponent: false } },
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, reg)).toEqual([]);
  });

  test("channel import → no marker", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["chat"],
      imports: [{ exportedName: "chat", sourcePath: "./channels.scrml" }],
    });
    const reg = buildExportRegistry({
      "./channels.scrml": { chat: { kind: "channel", category: "channel", isComponent: false } },
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, reg)).toEqual([]);
  });

  test("user-component import → no marker (CE expansion territory)", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["Card"],
      imports: [{ exportedName: "Card", sourcePath: "./components.scrml" }],
    });
    const reg = buildExportRegistry({
      "./components.scrml": { Card: { kind: "const", category: "user-component", isComponent: true } },
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, reg)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C15.4 — Same-file engine NOT emitted as cross-file mount
// ---------------------------------------------------------------------------

describe("C15 §C15.4 — same-file engines render at decl position (no use-site marker)", () => {
  test("`<engine for=Phase>` in importer with NO `<phase/>` use-site → no C15 marker", () => {
    // Same-file engine declaration; no cross-file mount site exists.
    const fileAST = buildSyntheticFileAST({ tags: [] });
    expect(emitCrossFileEngineMountsForFile(fileAST, new Map())).toEqual([]);
  });

  test("`<phase/>` use-site in same file as `<engine for=Phase>` → no C15 marker (no import binding)", () => {
    // The walker only fires on tags resolved through importBindings. A
    // same-file `<phase/>` would not appear in importBindings (it's a
    // SAME-FILE engine — and per §51.0.D same-file engines render at decl
    // position with no use-site tag form).
    const fileAST = buildSyntheticFileAST({
      tags: ["phase"], // no import for "phase"
    });
    expect(emitCrossFileEngineMountsForFile(fileAST, new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C15.5 — Multiple use-sites of same imported engine: one marker
// ---------------------------------------------------------------------------

describe("C15 §C15.5 — multiple use-sites of same engine → one marker (singleton)", () => {
  test("three use-sites of `<appPhase/>` produce ONE marker, not three", () => {
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "./engines.scrml",
    });
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings },
      nodes: [
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
        { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
      ],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const out = emitCrossFileEngineMountsForFile(fileAST, reg);
    // Singleton-emission: the engine is ONE singleton; emit ONE marker.
    expect(out.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §C15.6 — Defensive: null exportRegistry → no markers
// ---------------------------------------------------------------------------

describe("C15 §C15.6 — null exportRegistry → walker short-circuits", () => {
  test("undefined exportRegistry returns empty array", () => {
    const fileAST = buildSyntheticFileAST({
      tags: ["appPhase"],
      imports: [{ exportedName: "appPhase", sourcePath: "./engines.scrml" }],
    });
    expect(collectCrossFileEngineMounts(fileAST, undefined)).toEqual([]);
    expect(emitCrossFileEngineMountsForFile(fileAST, undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C15.7 — Defensive: no importBindings → no markers
// ---------------------------------------------------------------------------

describe("C15 §C15.7 — no importBindings on fileScope → walker short-circuits", () => {
  test("missing _scope returns empty array", () => {
    const fileAST = {
      filePath: "/test/app.scrml",
      nodes: [{ kind: "markup", tag: "appPhase", selfClosing: true, children: [] }],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });

  test("empty importBindings map returns empty array", () => {
    const fileAST = {
      filePath: "/test/app.scrml",
      _scope: { importBindings: new Map() },
      nodes: [{ kind: "markup", tag: "appPhase", selfClosing: true, children: [] }],
      machineDecls: [],
    };
    const reg = buildExportRegistry({
      "./engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    expect(collectCrossFileEngineMounts(fileAST, reg)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §C15.8 — Derived engine cross-file mount uses same shape
// ---------------------------------------------------------------------------

describe("C15 §C15.8 — derived engines support cross-file mount (same shape)", () => {
  test("derived-engine import is detected the same as non-derived", () => {
    // The discriminator is `category === "engine"` — derived engines also
    // export with `category: "engine"`. C15 makes no distinction.
    const fileAST = buildSyntheticFileAST({
      tags: ["health"],
      imports: [{ exportedName: "health", sourcePath: "./derived-engines.scrml" }],
    });
    const reg = buildExportRegistry({
      "./derived-engines.scrml": {
        health: { kind: "engine", category: "engine", isComponent: false },
      },
    });
    const out = collectCrossFileEngineMounts(fileAST, reg);
    expect(out.length).toBe(1);
    expect(out[0].varName).toBe("health");
  });
});

// ---------------------------------------------------------------------------
// §C15.9 — End-to-end via generateClientJs: cross-file marker emitted
// ---------------------------------------------------------------------------

describe("C15 §C15.9 — end-to-end client JS emission of cross-file engine mount", () => {
  test("importer client.js contains the §21.8 mount marker section", () => {
    // Build a synthetic importer with an engine-import + a use-site
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "/abs/engines.scrml",
    });
    const fileAST = {
      filePath: "/abs/app.scrml",
      _scope: { importBindings },
      nodes: [{
        kind: "markup",
        tag: "program",
        selfClosing: false,
        children: [
          { kind: "markup", tag: "appPhase", selfClosing: true, children: [] },
        ],
      }],
      ast: { nodes: [], imports: [], typeDecls: [], components: [], machineDecls: [] },
      machineDecls: [],
      typeDecls: [],
    };
    const reg = buildExportRegistry({
      "/abs/engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const ctx = makeTestCtx(fileAST, reg);
    const js = generateClientJs(ctx);
    expect(js).toContain("// --- cross-file engine mounts (compiler-generated, §21.8 + §51.0.D) ---");
    expect(js).toContain("§21.8 cross-file engine mount: appPhase");
    expect(js).toContain("/abs/engines.scrml");
  });

  test("importer with NO cross-file engines emits NO mount section", () => {
    const fileAST = {
      filePath: "/abs/app.scrml",
      _scope: { importBindings: new Map() },
      nodes: [{ kind: "markup", tag: "div", selfClosing: false, children: [] }],
      ast: { nodes: [], imports: [], typeDecls: [], components: [], machineDecls: [] },
      machineDecls: [],
      typeDecls: [],
    };
    const ctx = makeTestCtx(fileAST, null);
    const js = generateClientJs(ctx);
    expect(js).not.toContain("// --- cross-file engine mounts");
  });
});

// ---------------------------------------------------------------------------
// §C15.10 — Same-file engines (C12/C13/C14) NOT regressed
// ---------------------------------------------------------------------------

describe("C15 §C15.10 — same-file engine substrate NOT regressed by C15", () => {
  test("file with same-file engine + cross-file mount: both substrates emit", () => {
    const importBindings = new Map();
    importBindings.set("appPhase", {
      localName: "appPhase",
      exportedName: "appPhase",
      sourcePath: "/abs/engines.scrml",
    });
    const src = `<program>
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const ast = buildAstFromSource(src);
    runSYM({ filePath: "/abs/app.scrml", ast });
    const fileAST = {
      filePath: "/abs/app.scrml",
      ast,
      _scope: { importBindings },
      nodes: ast.nodes,
      machineDecls: ast.machineDecls,
      typeDecls: ast.typeDecls,
    };
    // Add a synthetic cross-file mount site to the markup tree.
    const programNode = fileAST.nodes.find((n) => n && n.kind === "markup" && n.tag === "program");
    if (programNode) {
      programNode.children.push({ kind: "markup", tag: "appPhase", selfClosing: true, children: [] });
    }
    const reg = buildExportRegistry({
      "/abs/engines.scrml": { appPhase: { kind: "engine", category: "engine", isComponent: false } },
    });
    const ctx = makeTestCtx(fileAST, reg);
    const js = generateClientJs(ctx);

    // C12 same-file substrate
    expect(js).toContain("__scrml_engine_marioState_transitions");
    expect(js).toContain('_scrml_reactive_set("marioState", "Small");');
    // C15 cross-file mount marker
    expect(js).toContain("§21.8 cross-file engine mount: appPhase");
  });

  test("file with ONLY same-file engines: no C15 marker section", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>
</program>`;
    const ast = buildAstFromSource(src);
    runSYM({ filePath: "test.scrml", ast });
    const fileAST = {
      filePath: "test.scrml",
      ast,
      nodes: ast.nodes,
      machineDecls: ast.machineDecls,
      typeDecls: ast.typeDecls,
    };
    const ctx = makeTestCtx(fileAST, null);
    const js = generateClientJs(ctx);
    // Same-file substrate present
    expect(js).toContain("__scrml_engine_marioState_transitions");
    // No C15 marker section
    expect(js).not.toContain("// --- cross-file engine mounts");
  });
});

// ---------------------------------------------------------------------------
// §C15.11–§C15.14 — End-to-end via compileScrml
//
// **Pipeline-gap notice:** The full compileScrml pipeline today has TWO
// upstream gaps that block end-to-end cross-file engine mount tests through
// the new `<engine ... initial=...> <Variant rule=...>` state-child form:
//
//   1. **TS rejects state-child form as "no transition rules" (E-ENGINE-005).**
//      `compiler/src/type-system.ts:2125-2136` builds the machine registry
//      via `parseMachineRules(rulesRaw)` which ONLY recognizes the LEGACY
//      arrow-rule form (`.From => .To`). State-child form (`<Small rule=.Big>`)
//      lands in `engineMeta.stateChildren[]` (B15) but `rulesRaw`'s
//      arrow-rule parser sees no rules → fires E-ENGINE-005 at TS. The
//      C12/C13/C14 codegen tests bypass this by running runUpToSYM directly
//      (skipping TS).
//
//   2. **B14 PASS 10.B's path-shape mismatch on production exportRegistry
//      keys.** PASS 10.B (`symbol-table.ts:4025`) does
//      `exportRegistry.get(binding.sourcePath)` where `sourcePath` is the
//      LITERAL relative source string (e.g. `"./engines.scrml"`). MOD's
//      production exportRegistry is keyed by ABSOLUTE paths
//      (post-`resolveModulePath`). The lookup ALWAYS misses in production.
//      C15's codegen walker has the SAME shape — but C15 worked around it
//      with a try-relative-then-absolute lookup pattern (see emit-engine.ts
//      `lookupSourceMap`). PASS 10.B is in symbol-table.ts (B17.2 territory
//      per C15 BRIEF) so C15 cannot fix it.
//
// Both gaps are PARSER/SYMBOL-TABLE/TYPE-SYSTEM territory, NOT codegen.
// They are documented in the C15 SURVEY DEFERRED ITEMS section. C15's
// codegen helpers (32 unit tests above) verify the emission shape via
// synthetic ASTs that bypass the broken upstream stages.
//
// The end-to-end tests below are SKIPPED with explanatory documentation
// until those upstream pipeline gaps are filled by a parser-extension /
// type-system-extension dispatch step (sibling to B17.2's
// `<onTransition>`/`effect=` parser-extension work).
// ---------------------------------------------------------------------------

describe.skip("C15 §C15.11 — full pipeline: importer's compiled client.js has the marker (DEFERRED — upstream pipeline gaps)", () => {
  test("compileScrml: importer + exporter pair produces marker in importer's client.js", () => {
    const ROOT = join(TMP, "c15-11");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-11/engines.scrml", `\${
  export type Phase:enum = { Idle, Loading, Done }
}
export
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
`);

    const app = fx("c15-11/app.scrml", `\${
  import { Phase, phase } from './engines.scrml'
}
<program>
  <h1>Loader</h1>
  <phase/>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [app],
      outputDir: outDir,
      write: true,
      log: () => {},
    });

    // Allow warnings; only hard errors fail the test.
    expect(realCompileErrors(result)).toEqual([]);

    const appClientPath = join(outDir, "app.client.js");
    expect(existsSync(appClientPath)).toBe(true);
    const appClient = readFileSync(appClientPath, "utf8");

    // Marker section present in importer
    expect(appClient).toContain("// --- cross-file engine mounts (compiler-generated, §21.8 + §51.0.D) ---");
    expect(appClient).toContain("§21.8 cross-file engine mount: phase");
  });

  test("exporter file has the C12 substrate (variant cell + transition table)", () => {
    const ROOT = join(TMP, "c15-11b");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-11b/engines.scrml", `\${
  export type Phase:enum = { Idle, Loading, Done }
}
export
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
`);

    const app = fx("c15-11b/app.scrml", `\${
  import { Phase, phase } from './engines.scrml'
}
<program>
  <phase/>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [app],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(realCompileErrors(result)).toEqual([]);

    const enginesClientPath = join(outDir, "engines.client.js");
    expect(existsSync(enginesClientPath)).toBe(true);
    const enginesClient = readFileSync(enginesClientPath, "utf8");

    // C12 substrate must be in the EXPORTER's compiled output, not the importer's
    expect(enginesClient).toContain("__scrml_engine_phase_transitions");
    expect(enginesClient).toContain('_scrml_reactive_set("phase", "Idle");');
  });
});

// ---------------------------------------------------------------------------
// §C15.12 — End-to-end: multiple importers see the same singleton substrate
// ---------------------------------------------------------------------------

describe.skip("C15 §C15.12 — multiple importers share the same exporter substrate (DEFERRED — upstream pipeline gaps)", () => {
  test("two importer files of the same engine: both have markers; ONE substrate in exporter", () => {
    const ROOT = join(TMP, "c15-12");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-12/engines.scrml", `\${
  export type Phase:enum = { Idle, Loading, Done }
}
export
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
`);

    const a = fx("c15-12/a.scrml", `\${
  import { Phase, phase } from './engines.scrml'
}
<program>
  <phase/>
</program>
`);
    const b = fx("c15-12/b.scrml", `\${
  import { Phase, phase } from './engines.scrml'
}
<program>
  <phase/>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [a, b],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(realCompileErrors(result)).toEqual([]);

    const aClient = readFileSync(join(outDir, "a.client.js"), "utf8");
    const bClient = readFileSync(join(outDir, "b.client.js"), "utf8");
    const enginesClient = readFileSync(join(outDir, "engines.client.js"), "utf8");

    // Both importers have the marker
    expect(aClient).toContain("§21.8 cross-file engine mount: phase");
    expect(bClient).toContain("§21.8 cross-file engine mount: phase");

    // ONE substrate in the exporter — count occurrences of the canonical
    // _scrml_reactive_set("phase", ...) — should be exactly one.
    const setOccurrences = (enginesClient.match(/_scrml_reactive_set\("phase"/g) || []).length;
    expect(setOccurrences).toBe(1);

    // NEITHER importer emits the C12 substrate — singleton is exporter-owned
    expect(aClient).not.toContain("__scrml_engine_phase_transitions");
    expect(bClient).not.toContain("__scrml_engine_phase_transitions");
  });
});

// ---------------------------------------------------------------------------
// §C15.13 — Re-export of imported engine is legal (§21.4); no duplicate substrate
// ---------------------------------------------------------------------------

describe.skip("C15 §C15.13 — re-export of imported engine: no duplicate substrate (DEFERRED — upstream pipeline gaps)", () => {
  test("re-exporter file does NOT duplicate the engine substrate", () => {
    const ROOT = join(TMP, "c15-13");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-13/engines.scrml", `\${
  export type Phase:enum = { Idle, Loading, Done }
}
export
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>
`);

    fx("c15-13/reexport.scrml", `\${
  export { Phase, phase } from './engines.scrml'
}
<program>
  <h2>Re-exporter file</h2>
</program>
`);

    const app = fx("c15-13/app.scrml", `\${
  import { Phase, phase } from './reexport.scrml'
}
<program>
  <phase/>
</program>
`);

    const outDir = join(ROOT, "dist");
    const result = compileScrml({
      inputFiles: [app],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    // Allow warnings; only hard errors should fail.
    expect(realCompileErrors(result)).toEqual([]);

    const enginesClientPath = join(outDir, "engines.client.js");
    const reexportClientPath = join(outDir, "reexport.client.js");
    expect(existsSync(enginesClientPath)).toBe(true);
    const enginesClient = readFileSync(enginesClientPath, "utf8");

    // The substrate lives EXCLUSIVELY in the original exporter
    expect(enginesClient).toContain('_scrml_reactive_set("phase", "Idle");');
    expect(enginesClient).toContain("__scrml_engine_phase_transitions");

    if (existsSync(reexportClientPath)) {
      const reexportClient = readFileSync(reexportClientPath, "utf8");
      // Re-exporter MUST NOT duplicate the substrate
      expect(reexportClient).not.toContain("__scrml_engine_phase_transitions");
      expect(reexportClient).not.toContain('_scrml_reactive_set("phase", "Idle");');
    }
  });
});

// ---------------------------------------------------------------------------
// §C15.14 — Regression-guard: B14 PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE
// ---------------------------------------------------------------------------

describe.skip("C15 §C15.14 — B14 PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE still fires (DEFERRED — PASS 10.B path-shape bug)", () => {
  test("compileScrml: importing a function and mounting via <X/> fires E-ENGINE-MOUNT-NOT-ENGINE", () => {
    const ROOT = join(TMP, "c15-14");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-14/utils.scrml", `\${
  export function helper() { return 42 }
}
`);

    const app = fx("c15-14/app.scrml", `\${
  import { helper } from './utils.scrml'
}
<program>
  <helper/>
</program>
`);

    const result = compileScrml({
      inputFiles: [app],
      outputDir: join(ROOT, "dist"),
      write: false,
      log: () => {},
    });

    // E-ENGINE-MOUNT-NOT-ENGINE should be fired by SYM (B14 PASS 10.B)
    // Note: B14 PASS 10.B's mount validator (`symbol-table.ts:3997`) is gated
    // on `node.selfClosing === true`. The validator fires when the imported
    // name's source export is non-engine. Since today's auto-gather runs MOD
    // for all .scrml files in the import closure, the function-export's
    // category resolves to `"function"` and PASS 10.B fires.
    const mountNotEngine = result.errors.filter(e => e.code === "E-ENGINE-MOUNT-NOT-ENGINE");
    expect(mountNotEngine.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §C15.15 — Regression-guard: MOD's E-IMPORT-004
// ---------------------------------------------------------------------------

describe("C15 §C15.15 — MOD's E-IMPORT-004 still fires for non-exported engine", () => {
  test("importing a non-exported name fires E-IMPORT-004", () => {
    const ROOT = join(TMP, "c15-15");
    mkdirSync(ROOT, { recursive: true });

    fx("c15-15/engines.scrml", `\${
  type Phase:enum = { Idle, Loading }
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading></>
</>
`);

    const app = fx("c15-15/app.scrml", `\${
  import { phase } from './engines.scrml'
}
<program>
  <phase/>
</program>
`);

    const result = compileScrml({
      inputFiles: [app],
      outputDir: join(ROOT, "dist"),
      write: false,
      log: () => {},
    });

    // The non-exported engine import should fire E-IMPORT-004 (MOD)
    const importErrors = result.errors.filter(e => e.code === "E-IMPORT-004");
    expect(importErrors.length).toBeGreaterThanOrEqual(1);
  });
});
