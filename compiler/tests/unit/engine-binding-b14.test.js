/**
 * Phase A1b Step B14 — engine binding + auto-declared variable + cross-file
 * mount validation (PASS 10.A + PASS 10.B) tests.
 *
 * Per SPEC §51.0.A-K, §21.8, §34.
 *
 * Coverage areas:
 *   1. AST-builder §51.0 syntax acceptance:
 *      - `<engine for=Type>` (no `name=`) auto-derives var name per §51.0.C
 *      - `var=NAME` override
 *      - `initial=.Variant` recorded on engine-decl
 *      - `pinned` bareword modifier
 *      - Legacy `<engine name=N for=T>` form preserved
 *   2. SYM PASS 10.A — engine cell registration:
 *      - StateCellRecord with `_cellKind: "engine"` + `engineMeta`
 *      - Auto-derived var name registered in file scope
 *      - `var=` override registered
 *      - E-ENGINE-VAR-DUPLICATE on collision with state-decl
 *      - E-ENGINE-VAR-DUPLICATE on collision with another engine
 *   3. autoDeriveEngineVarName helper (§51.0.C edge cases)
 *   4. SYM PASS 10.B — cross-file mount validation:
 *      - Engine-category exports → no diagnostic
 *      - Non-engine import (function, type, channel) used as `<X/>` mount →
 *        E-ENGINE-MOUNT-NOT-ENGINE
 *      - User-component imports → suppressed (CE/NR territory)
 *      - No exportRegistry → check skipped silently
 */

import { describe, expect, test } from "bun:test";
import { resolve, dirname } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runSYM,
  autoDeriveEngineVarName,
} from "../../src/symbol-table.ts";

function runUpToSYM(source, filePath = "test.scrml", exportRegistry = undefined) {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return runSYM({ filePath, ast, exportRegistry });
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

function getEngineVarDuplicateErrors(sym) {
  return sym.errors.filter((e) => e.code === "E-ENGINE-VAR-DUPLICATE");
}

function getEngineMountNotEngineErrors(sym) {
  return sym.errors.filter((e) => e.code === "E-ENGINE-MOUNT-NOT-ENGINE");
}

function buildAstFromSource(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs).ast;
}

// ---------------------------------------------------------------------------
// AST-builder: §51.0 syntax acceptance
// ---------------------------------------------------------------------------

describe("B14 AST-builder — §51.0 engine syntax", () => {
  test("`<engine for=Type>` (no name=) auto-derives var name", () => {
    const src = `<program>
<engine for=MarioState>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng).not.toBeNull();
    expect(eng.governedType).toBe("MarioState");
    expect(eng.varName).toBe("marioState");
    expect(eng.varNameOverride).toBeNull();
    expect(eng.engineName).toBe("marioState"); // backfilled for legacy consumers
  });

  test("`var=NAME` override produces the override as varName", () => {
    const src = `<program>
<engine for=Health var=playerHealth>
  .Healthy => .AtRisk
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng).not.toBeNull();
    expect(eng.governedType).toBe("Health");
    expect(eng.varName).toBe("playerHealth");
    expect(eng.varNameOverride).toBe("playerHealth");
  });

  test("`initial=.Variant` recorded on engine-decl", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng.initialVariant).toBe("Small");
  });

  test("absent `initial=` produces null", () => {
    const src = `<program>
<engine for=MarioState>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng.initialVariant).toBeNull();
  });

  test("`pinned` bareword modifier sets pinned:true", () => {
    const src = `<program>
<engine for=MarioState initial=.Small pinned>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng.pinned).toBe(true);
  });

  test("absent `pinned` modifier sets pinned:false", () => {
    const src = `<program>
<engine for=MarioState>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng.pinned).toBe(false);
  });

  test("legacy `<engine name=N for=T>` form — name canonicalised to varName (S192)", () => {
    const src = `<program>
<engine name=OrderEngine for=Order>
  .Pending => .Confirmed
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    // S192 §51.0.C canonicalisation: `engineName` is the MACHINE NAME (the
    // §51.9 machine-registry key + `_scrml_project_<Name>` codegen identifier)
    // and stays VERBATIM; the auto-declared VARIABLE name (`varName`) now runs
    // through the ONE canonical acronym-run rule (was verbatim `OrderEngine`),
    // so the registered cell matches the canonical `@orderEngine` read.
    expect(eng.engineName).toBe("OrderEngine");
    expect(eng.governedType).toBe("Order");
    expect(eng.varName).toBe("orderEngine");
  });

  test("export <engine ...> Form 1 sets isExported:true", () => {
    const src = `\${ /* docstring */ }
export
<engine for=MarioState initial=.Small>
  .Small => .Big
</>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng).not.toBeNull();
    expect(eng.isExported).toBe(true);
    expect(eng.varName).toBe("marioState");
  });

  test("non-exported engine has isExported:false", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const ast = buildAstFromSource(src);
    const eng = findEngineDecl(ast);
    expect(eng.isExported).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// autoDeriveEngineVarName helper (§51.0.C edge cases)
// ---------------------------------------------------------------------------

describe("autoDeriveEngineVarName (§51.0.C canonical acronym-run rule)", () => {
  // Single leading capital → lowercase it.
  test("MarioState → marioState", () => {
    expect(autoDeriveEngineVarName("MarioState")).toBe("marioState");
  });

  test("LoadPhase → loadPhase", () => {
    expect(autoDeriveEngineVarName("LoadPhase")).toBe("loadPhase");
  });

  test("Health → health", () => {
    expect(autoDeriveEngineVarName("Health")).toBe("health");
  });

  test("MarioMachine → marioMachine (legacy `Machine` suffix kept)", () => {
    expect(autoDeriveEngineVarName("MarioMachine")).toBe("marioMachine");
  });

  // All-uppercase name → lowercase entirely (acronym-run rule, was `uRL`).
  test("URL → url (all-caps lowercases entirely; §51.0.C amended)", () => {
    expect(autoDeriveEngineVarName("URL")).toBe("url");
  });

  test("ID → id (all-caps lowercases entirely)", () => {
    expect(autoDeriveEngineVarName("ID")).toBe("id");
  });

  // Acronym RUN before a CamelCase word → lowercase the run except the letter
  // that begins the next word.
  test("UIState → uiState (acronym run before CamelCase word)", () => {
    expect(autoDeriveEngineVarName("UIState")).toBe("uiState");
  });

  test("HTTPClient → httpClient (acronym run before CamelCase word)", () => {
    expect(autoDeriveEngineVarName("HTTPClient")).toBe("httpClient");
  });

  test("URLState → urlState (acronym run before CamelCase word)", () => {
    expect(autoDeriveEngineVarName("URLState")).toBe("urlState");
  });

  test("T → t (single-letter type; all-caps lowercases)", () => {
    expect(autoDeriveEngineVarName("T")).toBe("t");
  });

  test("myType → myType (lowercase-leading; identity)", () => {
    expect(autoDeriveEngineVarName("myType")).toBe("myType");
  });

  test("empty string → empty string", () => {
    expect(autoDeriveEngineVarName("")).toBe("");
  });

  test("underscore-leading → identity (no transformation)", () => {
    expect(autoDeriveEngineVarName("_Internal")).toBe("_Internal");
  });
});

// ---------------------------------------------------------------------------
// SYM PASS 10.A — engine cell registration
// ---------------------------------------------------------------------------

describe("B14 SYM PASS 10.A — engine cell registration", () => {
  test("auto-derived var name is registered in file scope", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec).toBeDefined();
    expect(rec.engineMeta).toBeDefined();
    expect(rec.engineMeta.forType).toBe("MarioState");
    expect(rec.engineMeta.varName).toBe("marioState");
    expect(rec.engineMeta.initialVariant).toBe("Small");
  });

  test("`_cellKind` annotation is `engine` on the engine-decl", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const bs = splitBlocks("test.scrml", src);
    const { ast } = buildAST(bs);
    runSYM({ filePath: "test.scrml", ast });
    const eng = findEngineDecl(ast);
    expect(eng._cellKind).toBe("engine");
    expect(eng._record).toBeDefined();
    expect(eng._record.engineMeta).toBeDefined();
  });

  test("`var=` override registers under the override name, not auto-derived", () => {
    const src = `<program>
<engine for=Health var=playerHealth initial=.Healthy>
  .Healthy => .AtRisk
</>
</program>`;
    const sym = runUpToSYM(src);
    expect(sym.fileScope.stateCells.has("playerHealth")).toBe(true);
    expect(sym.fileScope.stateCells.has("health")).toBe(false);
    const rec = sym.fileScope.stateCells.get("playerHealth");
    expect(rec.engineMeta.forType).toBe("Health");
    expect(rec.engineMeta.varName).toBe("playerHealth");
  });

  test("`pinned` modifier surfaces on engineMeta.isPinned", () => {
    const src = `<program>
<engine for=MarioState initial=.Small pinned>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec.engineMeta.isPinned).toBe(true);
    expect(rec.isPinned).toBe(true);
  });

  test("legacy `name=` form registers the CANONICAL cell name (S192)", () => {
    const src = `<program>
<engine name=OrderEngine for=Order>
  .Pending => .Confirmed
</>
</program>`;
    const sym = runUpToSYM(src);
    // S192: `name=OrderEngine` registers `@orderEngine` (canonical acronym-run
    // rule), NOT `OrderEngine` verbatim — so a canonical `@orderEngine` read
    // resolves (the register/read mismatch that blocked the read-side V-kill).
    expect(sym.fileScope.stateCells.has("orderEngine")).toBe(true);
    expect(sym.fileScope.stateCells.has("OrderEngine")).toBe(false);
    const rec = sym.fileScope.stateCells.get("orderEngine");
    expect(rec.engineMeta.varName).toBe("orderEngine");
    expect(rec.engineMeta.forType).toBe("Order");
  });

  test("forward-compat A7 fields are declared but null/undefined at B14 (post-A5-3: aggregation populated)", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    // A7 fields per §51.0.M-Q hierarchy.
    expect(rec.engineMeta.parentEngine).toBeNull();
    expect(Array.isArray(rec.engineMeta.innerEngines)).toBe(true);
    expect(rec.engineMeta.innerEngines.length).toBe(0);
    // §51.0.P (S67-ratified, STRUCK 2026-05-08): the `parallelAttr` field
    // was removed alongside the spec strike. EngineMetadata no longer
    // exposes it. The `parallel` keyword in attribute position falls
    // through silently as an unknown attribute; orthogonality is documented
    // structurally via §51.4 multi-engine pattern.
    expect(rec.engineMeta.parallelAttr).toBeUndefined();
    // A5-3 (PASS 16): aggregation fields populated. For a legacy
    // arrow-rules body (no state-children parsed), defaults are:
    //   historyAttr: false (OR-reduce over empty stateChildren),
    //   internalRules: [] (concat over empty),
    //   onTimeoutElements: [] (concat over empty).
    expect(rec.engineMeta.historyAttr).toBe(false);
    expect(rec.engineMeta.internalRules).toEqual([]);
    expect(rec.engineMeta.onTimeoutElements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E-ENGINE-VAR-DUPLICATE
// ---------------------------------------------------------------------------

describe("B14 E-ENGINE-VAR-DUPLICATE (§51.0.C)", () => {
  test("engine collides with separately-declared state cell — fires", () => {
    const src = `<program>
\${
  <marioState> = "small"
}
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const errs = getEngineVarDuplicateErrors(sym);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/marioState/);
    expect(errs[0].message).toMatch(/separately-declared|state cell/);
  });

  test("two engines auto-declaring the same variable — fires", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const errs = getEngineVarDuplicateErrors(sym);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/engine/);
  });

  test("`var=` override avoids the collision", () => {
    const src = `<program>
\${
  <marioState> = "small"
}
<engine for=MarioState var=marioMachine initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const errs = getEngineVarDuplicateErrors(sym);
    expect(errs.length).toBe(0);
    // Both records should coexist:
    expect(sym.fileScope.stateCells.has("marioState")).toBe(true);
    expect(sym.fileScope.stateCells.has("marioMachine")).toBe(true);
  });

  test("no duplicate when names differ (sanity)", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
<engine for=Health initial=.Healthy>
  .Healthy => .AtRisk
</>
</program>`;
    const sym = runUpToSYM(src);
    const errs = getEngineVarDuplicateErrors(sym);
    expect(errs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SYM PASS 10.B — cross-file engine mount validation
// ---------------------------------------------------------------------------

describe("B14 SYM PASS 10.B — cross-file engine mount validation", () => {
  test("imported engine mount with engine-category export → no diagnostic", () => {
    const src = `\${
  import { marioState } from './engines.scrml'
}
<program>
  <marioState/>
</program>`;
    const exportRegistry = new Map();
    const engineSourceMap = new Map();
    engineSourceMap.set("marioState", {
      kind: "engine",
      category: "engine",
      isComponent: false,
    });
    exportRegistry.set("./engines.scrml", engineSourceMap);
    const sym = runUpToSYM(src, "test.scrml", exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("imported function mounted via <X/> tag → fires E-ENGINE-MOUNT-NOT-ENGINE", () => {
    const src = `\${
  import { helper } from './utils.scrml'
}
<program>
  <helper/>
</program>`;
    const exportRegistry = new Map();
    const fnSourceMap = new Map();
    fnSourceMap.set("helper", {
      kind: "function",
      category: "function",
      isComponent: false,
    });
    exportRegistry.set("./utils.scrml", fnSourceMap);
    const sym = runUpToSYM(src, "test.scrml", exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/helper/);
    expect(errs[0].message).toMatch(/function/);
  });

  test("imported component mounted as <X/> → suppressed (CE/NR territory)", () => {
    const src = `\${
  import { Card } from './components.scrml'
}
<program>
  <Card/>
</program>`;
    const exportRegistry = new Map();
    const componentSourceMap = new Map();
    componentSourceMap.set("Card", {
      kind: "const",
      category: "user-component",
      isComponent: true,
    });
    exportRegistry.set("./components.scrml", componentSourceMap);
    const sym = runUpToSYM(src, "test.scrml", exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("imported channel mounted as <X/> → suppressed (CHX cross-file mount)", () => {
    // Channels have their own cross-file mount semantics: P3.A's CHX (CE
    // phase 2) inlines the source `<channel>` decl into the consumer at
    // the `<topic/>` use-site. SYM PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE
    // would be a false positive for every cross-file channel consumer, so
    // `channel` is on the suppression list alongside `user-component`.
    //
    // Pre-S75-fix history: this test asserted `length === 1` because the
    // walker DID fire on relative-keyed registries (test-harness path
    // matched). Production runs with absolute-keyed registries silently
    // no-op'd via the path-shape mismatch bug, so legit channel mounts
    // didn't surface the false-positive. The S75 fix makes the lookup
    // robust AND extends the suppression list — both behaviors converge
    // on "channel mount is legit; do not fire".
    const src = `\${
  import { topic } from './channels.scrml'
}
<program>
  <topic/>
</program>`;
    const exportRegistry = new Map();
    const channelSourceMap = new Map();
    channelSourceMap.set("topic", {
      kind: "channel",
      category: "channel",
      isComponent: false,
    });
    exportRegistry.set("./channels.scrml", channelSourceMap);
    const sym = runUpToSYM(src, "test.scrml", exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("no exportRegistry passed → check skipped silently", () => {
    const src = `\${
  import { someName } from './unknown.scrml'
}
<program>
  <someName/>
</program>`;
    const sym = runUpToSYM(src); // no exportRegistry
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("non-imported tag (HTML built-in) → no diagnostic", () => {
    const src = `<program>
  <hr/>
</program>`;
    const exportRegistry = new Map();
    const sym = runUpToSYM(src, "test.scrml", exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SYM PASS 10.B — PATH-SHAPE RESILIENCE (S75 fix)
// ---------------------------------------------------------------------------
//
// Pre-S75: the lookup at symbol-table.ts:4088 used `binding.sourcePath`
// (LITERAL `imp.source`, e.g. `./engines.scrml`) directly, but MOD's
// production exportRegistry is keyed by ABSOLUTE paths (post-
// `resolveModulePath`). Result: production runs silently no-op'd cross-file
// engine mount validation. The unit-test harness path stayed green only
// because tests built relative-keyed registries that matched the literal.
//
// Post-S75: the helper tries literal first (test-harness compat) then
// absolute-resolved fallback (production compat). These tests cover the
// production-shape path that was broken; the existing tests above cover
// the literal-shape path the bug-site already worked with.

describe("B14 SYM PASS 10.B — path-shape resilience (S75 fix)", () => {
  test("absolute-keyed exportRegistry — engine mount validates (no diagnostic)", () => {
    // Production-shape exportRegistry: outer key is the absolute path of the
    // exporter, post-`resolveModulePath` resolution. The walker must resolve
    // the consumer's literal `./engines.scrml` to the same absolute path.
    const consumerPath = resolve("/tmp/sample-project/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "./engines.scrml");
    const src = `\${
  import { marioState } from './engines.scrml'
}
<program>
  <marioState/>
</program>`;
    const exportRegistry = new Map();
    const engineSourceMap = new Map();
    engineSourceMap.set("marioState", {
      kind: "engine",
      category: "engine",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, engineSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("absolute-keyed registry + non-engine import → fires E-ENGINE-MOUNT-NOT-ENGINE", () => {
    // Same production shape, but the source export is a function. Pre-S75
    // this case silently no-op'd in production (false negative); post-S75
    // the absolute-resolved lookup hits and the diagnostic fires correctly.
    const consumerPath = resolve("/tmp/sample-project/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "./utils.scrml");
    const src = `\${
  import { helper } from './utils.scrml'
}
<program>
  <helper/>
</program>`;
    const exportRegistry = new Map();
    const fnSourceMap = new Map();
    fnSourceMap.set("helper", {
      kind: "function",
      category: "function",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, fnSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/helper/);
    expect(errs[0].message).toMatch(/function/);
  });

  test("absolute-keyed registry + user-component → suppressed", () => {
    // Regression: production-shape lookup should still respect the
    // user-component suppression (CE/NR routing territory).
    const consumerPath = resolve("/tmp/sample-project/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "./components.scrml");
    const src = `\${
  import { Card } from './components.scrml'
}
<program>
  <Card/>
</program>`;
    const exportRegistry = new Map();
    const componentSourceMap = new Map();
    componentSourceMap.set("Card", {
      kind: "const",
      category: "user-component",
      isComponent: true,
    });
    exportRegistry.set(exporterAbs, componentSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("absolute-keyed registry + channel → suppressed (CHX cross-file mount)", () => {
    // Regression: production-shape lookup should respect the channel
    // suppression too (P3.A CHX inlines source `<channel>` into consumer
    // at the use-site, so `<channelName/>` is legitimate cross-file mount).
    // This is the path that drove the 11 P3.A test failures during the
    // S75 implementation; post-fix it must stay green.
    const consumerPath = resolve("/tmp/sample-project/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "./channels.scrml");
    const src = `\${
  import { ticker } from './channels.scrml'
}
<program>
  <ticker/>
</program>`;
    const exportRegistry = new Map();
    const channelSourceMap = new Map();
    channelSourceMap.set("ticker", {
      kind: "channel",
      category: "channel",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, channelSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("deep-nested relative import path (`./subdir/engines.scrml`) — absolute-keyed registry resolves", () => {
    // Stresses `resolveModulePath`'s `resolve(dirname(importerPath), source)`
    // logic for paths that traverse a subdirectory boundary. Same
    // production-shape (absolute key in registry) but non-trivial relative
    // specifier on the import.
    const consumerPath = resolve("/tmp/sample-project/pages/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "./subdir/engines.scrml");
    const src = `\${
  import { marioState } from './subdir/engines.scrml'
}
<program>
  <marioState/>
</program>`;
    const exportRegistry = new Map();
    const engineSourceMap = new Map();
    engineSourceMap.set("marioState", {
      kind: "engine",
      category: "engine",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, engineSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("parent-relative import (`../shared/engines.scrml`) — absolute-keyed registry resolves", () => {
    // Stresses the `..` traversal case — `resolveModulePath` must walk up
    // the dirname chain when joining. Production shape; absolute key.
    const consumerPath = resolve("/tmp/sample-project/pages/consumer.scrml");
    const exporterAbs = resolve(dirname(consumerPath), "../shared/engines.scrml");
    const src = `\${
  import { appPhase } from '../shared/engines.scrml'
}
<program>
  <appPhase/>
</program>`;
    const exportRegistry = new Map();
    const engineSourceMap = new Map();
    engineSourceMap.set("appPhase", {
      kind: "engine",
      category: "engine",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, engineSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("absolute-keyed registry + synthetic importer path (no on-disk file) — absolute fallback still works", () => {
    // The `resolveModulePath` helper does `resolve(dirname(importerPath), …)`
    // which is a pure-string operation — no fs check is required for the
    // join itself (only for the existence-fallback inside the helper, which
    // we don't depend on). Synthetic absolute paths must therefore resolve
    // correctly even when no file exists on disk.
    const consumerPath = "/synthetic/test/area/file.scrml";
    const exporterAbs = "/synthetic/test/area/eng.scrml";
    const src = `\${
  import { sysState } from './eng.scrml'
}
<program>
  <sysState/>
</program>`;
    const exportRegistry = new Map();
    const engineSourceMap = new Map();
    engineSourceMap.set("sysState", {
      kind: "engine",
      category: "engine",
      isComponent: false,
    });
    exportRegistry.set(exporterAbs, engineSourceMap);
    const sym = runUpToSYM(src, consumerPath, exportRegistry);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });

  test("test-harness path (no exportRegistry) — still skips silently", () => {
    // Regression: path-shape resilience must not change the no-registry
    // skip semantics. When there is no MOD registry to consult, the walker
    // must continue to no-op silently (the SYM stage is permitted to run
    // without MOD in unit-test isolation).
    const src = `\${
  import { someName } from './unknown.scrml'
}
<program>
  <someName/>
</program>`;
    const sym = runUpToSYM(src, "/synthetic/abs/test.scrml" /* no exportRegistry */);
    const errs = getEngineMountNotEngineErrors(sym);
    expect(errs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// engineMeta surface
// ---------------------------------------------------------------------------

describe("B14 engineMeta surface (forward-compat shape)", () => {
  test("derivedExpr is null for non-derived engines", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec.engineMeta.derivedExpr).toBeNull();
  });

  test("variants is initially empty (B15 populates from type system)", () => {
    const src = `<program>
<engine for=MarioState initial=.Small>
  .Small => .Big
</>
</program>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(Array.isArray(rec.engineMeta.variants)).toBe(true);
    expect(rec.engineMeta.variants.length).toBe(0);
  });

  test("isExported flag flows from AST to engineMeta", () => {
    const src = `\${ /* doc */ }
export
<engine for=MarioState initial=.Small>
  .Small => .Big
</>`;
    const sym = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("marioState");
    expect(rec).toBeDefined();
    expect(rec.engineMeta.isExported).toBe(true);
  });
});
