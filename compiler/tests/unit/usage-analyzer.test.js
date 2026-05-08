/* SPDX-License-Identifier: MIT
 * Phase A1c Step C0 — feature-usage analysis pass (`usage-analyzer.ts`).
 *
 * Source-of-truth: docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md
 *                  §11 (compile-time elision strategy, ratified Q3)
 *                  + SURVEY.md §2 (canonical bitmap shape).
 *
 * Coverage strategy (per SURVEY §6):
 *   - Per-flag positive test (feature present → flag set)
 *   - Per-flag negative test (feature absent → flag clear)
 *   - 14 validator predicates × {positive, negative}
 *   - 16 feature flags × {positive, negative}
 *   - Cross-file merge fixture (two files, OR-merge)
 *   - Empty-file fixture (all flags false)
 *   - Bitmap completeness probe (kitchen-sink fixture sets every relevant flag)
 *
 * Soundness contract (per SCOPE §11.2): every flag uses STRUCTURAL inclusion
 * — once a kind is recognized in the AST, the flag fires regardless of B-step
 * decoration completeness.
 *
 * **What this test file does NOT cover:**
 *   - C0 emits NO runtime; byte-output stability is verified by integration
 *     tests (sub-step 9). This file is per-flag unit coverage only.
 *   - Cross-file import-graph traversal (handled by analyzeAll.files[]
 *     post-CHX-inlined + MOD-resolved) is unit-tested via two-file fixture.
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { runTS } from "../../src/type-system.ts";
import {
  analyzeUsage,
  emptyUsage,
  fullUsage,
  mergeUsage,
} from "../../src/codegen/usage-analyzer.ts";
import { analyzeAll } from "../../src/codegen/analyze.ts";
import { UNIVERSAL_CORE_PREDICATES } from "../../src/validator-catalog.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile up to AST + SYM + TS and return the analysed FileAST + diagnostics. */
function compileToFileAST(source, filePath = "/test/u.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const fileAST = {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
  // Run SYM so engine-decls get _record + engineMeta annotations.
  runSYM({ filePath, ast: fileAST });
  // Run TS so predicateCheck / refinement annotations land.
  runTS({ files: [fileAST] });
  return fileAST;
}

/** Compile with only AST (no SYM/TS) — for tests where we want to verify
 *  that structural triggers fire even WITHOUT B-step decorations. */
function compileToAstOnly(source, filePath = "/test/u.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return {
    filePath,
    source,
    nodes: ast.nodes ?? [],
    machineDecls: ast.machineDecls ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
  };
}

/** Convenience — full pipeline + analyzer. */
function analyze(source) {
  return analyzeUsage(compileToFileAST(source));
}

// ---------------------------------------------------------------------------
// Skeleton constructors
// ---------------------------------------------------------------------------

describe("usage-analyzer — skeleton constructors", () => {
  test("emptyUsage returns all flags false", () => {
    const u = emptyUsage();
    expect(u.engines).toBe(false);
    expect(u.derivedEngines).toBe(false);
    expect(u.engineHistory).toBe(false);
    expect(u.engineInternalRules).toBe(false);
    expect(u.engineOnTimeout).toBe(false);
    expect(u.engineNested).toBe(false);
    expect(u.onTransitionHooks).toBe(false);
    expect(u.channels).toBe(false);
    expect(u.refinementTypes).toBe(false);
    expect(u.refinementTypesAny).toBe(false);
    expect(u.validitySurface).toBe(false);
    expect(u.renderSpec).toBe(false);
    expect(u.markupTypedDerived).toBe(false);
    expect(u.reset).toBe(false);
    expect(u.defaultExpr).toBe(false);
    expect(u.variantCCompound).toBe(false);
    expect(u.bareVariantInference).toBe(false);
    expect(u.typeAsArgument).toBe(false);
    expect(u.programDocAttrs).toBe(false);
    for (const p of UNIVERSAL_CORE_PREDICATES) {
      expect(u.validators[p.name]).toBe(false);
    }
  });

  test("fullUsage returns all flags true", () => {
    const u = fullUsage();
    expect(u.engines).toBe(true);
    expect(u.channels).toBe(true);
    expect(u.refinementTypes).toBe(true);
    expect(u.validitySurface).toBe(true);
    expect(u.bareVariantInference).toBe(true);
    expect(u.programDocAttrs).toBe(true);
    for (const p of UNIVERSAL_CORE_PREDICATES) {
      expect(u.validators[p.name]).toBe(true);
    }
  });

  test("mergeUsage OR-merges two bitmaps", () => {
    const a = emptyUsage();
    a.engines = true;
    a.validators.req = true;
    const b = emptyUsage();
    b.channels = true;
    b.validators.length = true;

    const merged = mergeUsage(a, b);
    expect(merged.engines).toBe(true);
    expect(merged.channels).toBe(true);
    expect(merged.validators.req).toBe(true);
    expect(merged.validators.length).toBe(true);
    // Inputs are not mutated
    expect(a.channels).toBe(false);
    expect(b.engines).toBe(false);
  });

  test("mergeUsage(empty, empty) is empty", () => {
    const e1 = emptyUsage();
    const e2 = emptyUsage();
    const merged = mergeUsage(e1, e2);
    expect(merged).toEqual(emptyUsage());
  });

  test("mergeUsage(full, empty) === full", () => {
    const merged = mergeUsage(fullUsage(), emptyUsage());
    expect(merged).toEqual(fullUsage());
  });
});

// ---------------------------------------------------------------------------
// Per-predicate validator flags (14 × positive + 1 broad negative)
// ---------------------------------------------------------------------------

describe("usage-analyzer — validators (per-predicate flags)", () => {
  test("req (bareword) fires validators.req", () => {
    const u = analyze(`<program>\${ <name req> = <input type="text"/> }</program>`);
    expect(u.validators.req).toBe(true);
  });

  test('"is some" (multi-word bareword) fires validators["is some"] when validator-entry name matches', () => {
    // `is some` as a state-decl bareword is currently DEFERRED in the parser
    // (per ast-builder.js note: "is some two-word predicate — rejected by
    // bareword scan; deferred"). We test the walker contract directly: when
    // a validator-entry with name="is some" lands on the AST (future B-step
    // landing), the flag fires. We synthesize the AST shape here to verify
    // the walker's validator-name dispatch.
    const fileAST = {
      filePath: "/synth.scrml",
      nodes: [{
        kind: "state-decl",
        name: "opt",
        validators: [{ name: "is some", args: null }],
      }],
    };
    const u = analyzeUsage(fileAST);
    expect(u.validators["is some"]).toBe(true);
  });

  test("length (call-form) fires validators.length", () => {
    const u = analyze(`<program>\${ <name length(>=2)> = <input type="text"/> }</program>`);
    expect(u.validators.length).toBe(true);
  });

  test("pattern fires validators.pattern", () => {
    const u = analyze(`<program>\${ <name pattern(/^a$/)> = <input type="text"/> }</program>`);
    expect(u.validators.pattern).toBe(true);
  });

  test("min fires validators.min", () => {
    const u = analyze(`<program>\${ <n min(0)> = <input type="number"/> }</program>`);
    expect(u.validators.min).toBe(true);
  });

  test("max fires validators.max", () => {
    const u = analyze(`<program>\${ <n max(100)> = <input type="number"/> }</program>`);
    expect(u.validators.max).toBe(true);
  });

  test("gt fires validators.gt", () => {
    const u = analyze(`<program>\${ <n gt(0)> = <input type="number"/> }</program>`);
    expect(u.validators.gt).toBe(true);
  });

  test("lt fires validators.lt", () => {
    const u = analyze(`<program>\${ <n lt(100)> = <input type="number"/> }</program>`);
    expect(u.validators.lt).toBe(true);
  });

  test("gte fires validators.gte", () => {
    const u = analyze(`<program>\${ <n gte(0)> = <input type="number"/> }</program>`);
    expect(u.validators.gte).toBe(true);
  });

  test("lte fires validators.lte", () => {
    const u = analyze(`<program>\${ <n lte(100)> = <input type="number"/> }</program>`);
    expect(u.validators.lte).toBe(true);
  });

  test("eq fires validators.eq", () => {
    const u = analyze(`<program>\${ <n eq(42)> = <input type="number"/> }</program>`);
    expect(u.validators.eq).toBe(true);
  });

  test("neq fires validators.neq", () => {
    const u = analyze(`<program>\${ <n neq(0)> = <input type="number"/> }</program>`);
    expect(u.validators.neq).toBe(true);
  });

  test("oneOf fires validators.oneOf", () => {
    const u = analyze(`<program>\${ <n oneOf([1, 2, 3])> = <input type="number"/> }</program>`);
    expect(u.validators.oneOf).toBe(true);
  });

  test("notIn fires validators.notIn", () => {
    const u = analyze(`<program>\${ <n notIn([0])> = <input type="number"/> }</program>`);
    expect(u.validators.notIn).toBe(true);
  });

  test("no validators → all per-predicate flags clear", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    for (const p of UNIVERSAL_CORE_PREDICATES) {
      expect(u.validators[p.name]).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Engine + temporal flags (B14 + A5-2 + A5-3)
// ---------------------------------------------------------------------------

describe("usage-analyzer — engines + temporal", () => {
  test("file-scope engine → engines: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle/></program>`;
    const u = analyze(src);
    expect(u.engines).toBe(true);
  });

  test("no engine → engines: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.engines).toBe(false);
  });

  test("derived engine (sourceVar) → derivedEngines: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
  <phase>: Phase = .Idle
}<engine for=Phase derived=@phase/></program>`;
    const u = analyze(src);
    expect(u.engines).toBe(true);
    expect(u.derivedEngines).toBe(true);
  });

  test("non-derived engine → derivedEngines: false", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle/></program>`;
    const u = analyze(src);
    expect(u.derivedEngines).toBe(false);
  });

  // The "engine with parallel attr → engineParallel: true" + companion
  // "engine without parallel → engineParallel: false" tests were REMOVED
  // 2026-05-08 alongside the §51.0.P spec strike. The `engineParallel`
  // FeatureUsage flag no longer exists. See
  // `compiler/tests/unit/parallel-close-regression.test.js` for the
  // counterpart that asserts the flag is gone and `parallel` in attribute
  // position is silent-fallthrough.

  test("engine state-child with history attr → engineHistory: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle history rule=.Active/>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineHistory).toBe(true);
  });

  test("engine without history → engineHistory: false", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle rule=.Active/>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineHistory).toBe(false);
  });

  test("engine state-child with internal:rule= → engineInternalRules: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle rule=.Active internal:rule=.Idle/>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineInternalRules).toBe(true);
  });

  test("engine without internal:rule= → engineInternalRules: false", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle rule=.Active/>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineInternalRules).toBe(false);
  });

  test("engine state-child with <onTimeout> → engineOnTimeout: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <onTimeout after="500ms" to=.Active/>
  </>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineOnTimeout).toBe(true);
  });

  test("engine without <onTimeout> → engineOnTimeout: false", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle>
  <Idle rule=.Active/>
  <Active rule=.Idle/>
</engine></program>`;
    const u = analyze(src);
    expect(u.engineOnTimeout).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Channels (§38, B19)
// ---------------------------------------------------------------------------

describe("usage-analyzer — channels", () => {
  test("<channel> inside program → channels: true", () => {
    const src = `<program><channel name="chat" topic="room1"/></program>`;
    const u = analyze(src);
    expect(u.channels).toBe(true);
  });

  test("no channel → channels: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.channels).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Refinement types (§53, B21 three-zone)
// ---------------------------------------------------------------------------

describe("usage-analyzer — refinement types", () => {
  test("predicated state-decl with literal init → refinementTypesAny: true", () => {
    // §B21.1 fixture: literal init, static zone (refinementTypes flag stays
    // false — static-zone elides; refinementTypesAny captures any §53 use).
    const src = `<program>\${ <x>: number(min(0) && max(10)) = 5 }</program>`;
    const u = analyze(src);
    expect(u.refinementTypesAny).toBe(true);
  });

  test("predicated let with arithmetic init → refinementTypes (boundary): true", () => {
    // Arithmetic source → boundary zone (per B21 doc §B21.4)
    const src = `<program>\${ let x: number(min(0)) = 5 + 5 }</program>`;
    const u = analyze(src);
    expect(u.refinementTypesAny).toBe(true);
    // Boundary zone fires when source is arithmetic / unconstrained.
    expect(u.refinementTypes).toBe(true);
  });

  test("non-predicated state-decl → refinementTypes both flags clear", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.refinementTypes).toBe(false);
    expect(u.refinementTypesAny).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validity surface (B11/B12 — compound-parent triggers synthesis)
// ---------------------------------------------------------------------------

describe("usage-analyzer — validity surface + variantCCompound", () => {
  test("compound parent → validitySurface + variantCCompound: true", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" </> }</program>`;
    const u = analyze(src);
    expect(u.validitySurface).toBe(true);
    expect(u.variantCCompound).toBe(true);
  });

  test("no compound parent → validitySurface + variantCCompound: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.validitySurface).toBe(false);
    expect(u.variantCCompound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Render-spec / markup-typed
// ---------------------------------------------------------------------------

describe("usage-analyzer — render-spec + markup-typed", () => {
  test("Shape 2 cell → renderSpec: true", () => {
    const src = `<program>\${ <email> = <input type="email"/> }</program>`;
    const u = analyze(src);
    expect(u.renderSpec).toBe(true);
  });

  test("Shape 1 plain cell → renderSpec: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.renderSpec).toBe(false);
  });

  test("Shape 3 markup-typed derived → markupTypedDerived: true", () => {
    // _cellKind === "markup-typed" is set by SYM B5 PASS 4. Need full pipeline.
    const src = `<program>\${ <userName> = <input type="text"/>; const <badge> = <span class="b">\${@userName}</span> }</program>`;
    const u = analyze(src);
    expect(u.markupTypedDerived).toBe(true);
  });

  test("Shape 3 plain derived (non-markup) → markupTypedDerived: false", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }</program>`;
    const u = analyze(src);
    expect(u.markupTypedDerived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reset + default
// ---------------------------------------------------------------------------

describe("usage-analyzer — reset + default", () => {
  test("reset(@cell) call site → reset: true", () => {
    const src = `<program>\${ <count> = 0; function clear() { reset(@count) } }</program>`;
    const u = analyze(src);
    expect(u.reset).toBe(true);
  });

  test("no reset call site → reset: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.reset).toBe(false);
  });

  test("default= attr → defaultExpr: true", () => {
    const src = `<program>\${ <count default=42> = 0 }</program>`;
    const u = analyze(src);
    expect(u.defaultExpr).toBe(true);
  });

  test("no default= → defaultExpr: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.defaultExpr).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bare-variant inference (§14.10 / M9 / B20)
// ---------------------------------------------------------------------------

describe("usage-analyzer — bare-variant inference", () => {
  test("bare-variant ident in state-decl init → bareVariantInference: true", () => {
    const src = `<program>\${
  enum Phase { Idle, Active }
  <phase>: Phase = .Idle
}</program>`;
    const u = analyze(src);
    expect(u.bareVariantInference).toBe(true);
  });

  test("no bare-variant ident → bareVariantInference: false", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.bareVariantInference).toBe(false);
  });

  test("plain member access (.field) does NOT trigger bareVariantInference", () => {
    // MemberExpr `obj.field` is a distinct AST kind from IdentExpr; even though
    // ".field" sounds similar, the parser produces MemberExpr not IdentExpr.
    const src = `<program>\${
  let obj = { foo: 1 }
  let x = obj.foo
}</program>`;
    const u = analyze(src);
    expect(u.bareVariantInference).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// typeAsArgument (parseVariant — STUB)
// ---------------------------------------------------------------------------

describe("usage-analyzer — typeAsArgument (parseVariant stub)", () => {
  test("typeAsArgument is always false at C0 (parseVariant Phase 2 not landed)", () => {
    const u = analyze(`<program>\${ <count> = 0 }</program>`);
    expect(u.typeAsArgument).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// <program> documentary attrs (§40.7 / C19)
// ---------------------------------------------------------------------------

describe("usage-analyzer — <program> documentary attrs", () => {
  test("<program title=...> → programDocAttrs: true", () => {
    const src = `<program title="My App">\${ <count> = 0 }</program>`;
    const u = analyze(src);
    expect(u.programDocAttrs).toBe(true);
  });

  test("<program description=...> → programDocAttrs: true", () => {
    const src = `<program description="Cool thing">\${ <count> = 0 }</program>`;
    const u = analyze(src);
    expect(u.programDocAttrs).toBe(true);
  });

  test("<program> with no doc attrs → programDocAttrs: false", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const u = analyze(src);
    expect(u.programDocAttrs).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural soundness — flags fire on AST-only (no SYM, no TS)
// ---------------------------------------------------------------------------

describe("usage-analyzer — soundness > completeness (AST-only triggers)", () => {
  test("validators fire from AST alone (no SYM/TS run)", () => {
    const fileAST = compileToAstOnly(`<program>\${ <name req> = <input type="text"/> }</program>`);
    const u = analyzeUsage(fileAST);
    expect(u.validators.req).toBe(true);
  });

  test("engines fire from AST alone", () => {
    const fileAST = compileToAstOnly(`<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle/></program>`);
    const u = analyzeUsage(fileAST);
    expect(u.engines).toBe(true);
  });

  test("channels fire from AST alone", () => {
    const fileAST = compileToAstOnly(`<program><channel name="x" topic="t"/></program>`);
    const u = analyzeUsage(fileAST);
    expect(u.channels).toBe(true);
  });

  test("compound parent fires from AST alone (no SYM) — children-array trigger", () => {
    // _cellKind === "compound-parent" requires SYM PASS 4. The AST-only
    // structural trigger is `state-decl.children` array presence.
    const fileAST = compileToAstOnly(`<program>\${ <formRes><name>="" <email>="" </> }</program>`);
    const u = analyzeUsage(fileAST);
    expect(u.variantCCompound).toBe(true);
    // validitySurface fires off `Array.isArray(children)` as well — same
    // trigger; primer §13.7 B11 unconditional synthesis rule.
    expect(u.validitySurface).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty-input edge cases
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-file merge — analyzeAll() integration
// ---------------------------------------------------------------------------

describe("usage-analyzer — cross-file OR-merge via analyzeAll", () => {
  /** Build a fake fileAST with the given source. Mirrors `analyzeFile`'s
   *  expectations (kind / nodes / ast.nodes shape). */
  function fakeFile(filePath, source) {
    const bs = splitBlocks(filePath, source);
    const { ast } = buildAST(bs);
    return {
      filePath,
      source,
      nodes: ast.nodes ?? [],
      machineDecls: ast.machineDecls ?? [],
      typeDecls: ast.typeDecls ?? [],
      components: ast.components ?? [],
    };
  }

  test("two files: file A engines + file B channels → merged has both", () => {
    const a = fakeFile("/a.scrml", `<program>\${
  enum Phase { Idle, Active }
}<engine for=Phase initial=.Idle/></program>`);
    const b = fakeFile("/b.scrml", `<program><channel name="x" topic="t"/></program>`);

    const result = analyzeAll({
      files: [a, b],
      routeMap: {},
      depGraph: {},
      protectAnalysis: undefined,
    });

    // Per-file bitmaps are file-local
    const aUsage = result.fileAnalyses.get("/a.scrml").usage;
    const bUsage = result.fileAnalyses.get("/b.scrml").usage;
    expect(aUsage.engines).toBe(true);
    expect(aUsage.channels).toBe(false);
    expect(bUsage.engines).toBe(false);
    expect(bUsage.channels).toBe(true);

    // Per-app aggregate has BOTH
    expect(result.featureUsage.engines).toBe(true);
    expect(result.featureUsage.channels).toBe(true);
  });

  test("empty files array → featureUsage all false", () => {
    const result = analyzeAll({
      files: [],
      routeMap: {},
      depGraph: {},
      protectAnalysis: undefined,
    });
    expect(result.featureUsage).toEqual(emptyUsage());
  });

  test("missing files → featureUsage all false", () => {
    const result = analyzeAll({
      files: undefined,
      routeMap: {},
      depGraph: {},
      protectAnalysis: undefined,
    });
    expect(result.featureUsage).toEqual(emptyUsage());
  });

  test("three-file OR-merge — validators across files", () => {
    const a = fakeFile("/v1.scrml", `<program>\${ <a req> = <input type="text"/> }</program>`);
    const b = fakeFile("/v2.scrml", `<program>\${ <b length(>=1)> = <input type="text"/> }</program>`);
    const c = fakeFile("/v3.scrml", `<program>\${ <c min(0)> = <input type="number"/> }</program>`);

    const result = analyzeAll({
      files: [a, b, c],
      routeMap: {},
      depGraph: {},
      protectAnalysis: undefined,
    });

    expect(result.featureUsage.validators.req).toBe(true);
    expect(result.featureUsage.validators.length).toBe(true);
    expect(result.featureUsage.validators.min).toBe(true);
    // Unused predicates remain false
    expect(result.featureUsage.validators.pattern).toBe(false);
    expect(result.featureUsage.validators.eq).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bitmap-completeness probe — kitchen-sink fixture
// ---------------------------------------------------------------------------

describe("usage-analyzer — bitmap completeness probe", () => {
  test("kitchen-sink fixture sets every relevant flag", () => {
    // A fixture using as many v0.next features as the parser will permit
    // in one program. Engines + state-decls + validators + channel +
    // compound-parent + Shape 2 + reset + default + bare-variant + program-
    // doc-attr.
    const src = `<program title="Kitchen Sink" description="Every v0.next surface">
\${
  enum Phase { Idle, Active }
  <phase>: Phase = .Idle
  <count default=10> = 0
  <name req length(>=2) pattern(/^[a-z]+$/)> = <input type="text"/>
  <bounded min(0) max(100) gte(1) lte(99) gt(0) lt(100) eq(50) neq(0) oneOf([1, 2]) notIn([0])> = <input type="number"/>
  <formRes><email>="" <pwd>="" </>
  function clear() { reset(@count) }
}
<engine for=Phase initial=.Idle>
  <Idle history rule=.Active internal:rule=.Idle>
    <onTimeout after="500ms" to=.Active/>
  </>
  <Active rule=.Idle/>
</engine>
<channel name="chat" topic="room"/>
</program>`;
    const u = analyze(src);

    // Validators — at least 12 of 14 (parser-deferred: "is some")
    expect(u.validators.req).toBe(true);
    expect(u.validators.length).toBe(true);
    expect(u.validators.pattern).toBe(true);
    expect(u.validators.min).toBe(true);
    expect(u.validators.max).toBe(true);
    expect(u.validators.gt).toBe(true);
    expect(u.validators.lt).toBe(true);
    expect(u.validators.gte).toBe(true);
    expect(u.validators.lte).toBe(true);
    expect(u.validators.eq).toBe(true);
    expect(u.validators.neq).toBe(true);
    expect(u.validators.oneOf).toBe(true);
    expect(u.validators.notIn).toBe(true);

    // Engine surface
    expect(u.engines).toBe(true);
    expect(u.engineHistory).toBe(true);
    expect(u.engineInternalRules).toBe(true);
    expect(u.engineOnTimeout).toBe(true);

    // Channels + compound + render-spec + reset + default + bare-variant +
    // program-doc-attrs all fire.
    expect(u.channels).toBe(true);
    expect(u.validitySurface).toBe(true);
    expect(u.variantCCompound).toBe(true);
    expect(u.renderSpec).toBe(true);
    expect(u.reset).toBe(true);
    expect(u.defaultExpr).toBe(true);
    expect(u.bareVariantInference).toBe(true);
    expect(u.programDocAttrs).toBe(true);

    // typeAsArgument is the parseVariant STUB — stays false
    expect(u.typeAsArgument).toBe(false);
  });
});

describe("usage-analyzer — empty / edge-case inputs", () => {
  test("empty file → all flags false", () => {
    const u = analyzeUsage({ filePath: "/empty.scrml", nodes: [] });
    expect(u).toEqual(emptyUsage());
  });

  test("missing nodes field → all flags false", () => {
    const u = analyzeUsage({ filePath: "/missing.scrml" });
    expect(u).toEqual(emptyUsage());
  });

  test("legacy ast.nodes shape → reads nodes from ast.nodes", () => {
    const u = analyzeUsage({
      filePath: "/legacy.scrml",
      ast: {
        nodes: [
          { kind: "markup", tag: "channel", attrs: [], children: [] },
        ],
      },
    });
    expect(u.channels).toBe(true);
  });

  test("null/undefined input safe", () => {
    expect(() => analyzeUsage({})).not.toThrow();
  });
});
