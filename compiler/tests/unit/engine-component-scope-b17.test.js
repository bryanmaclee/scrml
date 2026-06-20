/**
 * Phase A1b Step B17 — components-vs-engines residual fire-site tests
 * (PASS 11 — `walkRejectEnginesInComponentDefChildren`).
 *
 * Per SPEC §51.0.K (Move 20) + §34 catalog row E-COMPONENT-ENGINE-SCOPE.
 *
 * Phase 0 finding (see `docs/changes/phase-a1b-step-b17-ontransition-component-engine/SURVEY.md`):
 *   B17's audit §2 fire-set was:
 *     1. `<onTransition>` placement + form validation (engine state-children)
 *     2. `effect=` placement + single-target invariant
 *     3. `<onTransition>`/`effect=` forbidden inside `<match>` arms
 *     4. E-COMPONENT-ENGINE-SCOPE residual (engine inside component body)
 *     5. Engine mount tag inside component body
 *
 *   ALL items DEFERRED end-to-end — the underlying AST surfaces are not
 *   parsed today. Specifically: engine-decls live only as children of
 *   markup containers (`<program>`, top-level), and ast-builder.js
 *   line 9149-9151 enforces "engine-decl nodes are children of markup
 *   (program), not logic" — they never appear inside a logic-block
 *   body, and so never get vacuumed into a `component-def.defChildren`
 *   array (which collects logic-body siblings only — line 8647-8663).
 *
 * **What B17 SHIPS:** PASS 11 walker — defensive scaffolding that fires
 * `E-COMPONENT-ENGINE-SCOPE` if/when an `engine-decl` appears in a
 * `component-def.defChildren` array. The walker is exercised here via
 * SYNTHESIZED AST construction, since the parser pipeline cannot
 * produce that shape today. When a future precondition step (component-
 * body markup parser, or relaxation of the engine-only-in-markup
 * placement rule) makes the shape reachable end-to-end, the walker is
 * already correct and the deferred .skip tests can activate.
 *
 * Coverage areas:
 *   §B17.1 — synthesized AST: engine-decl in defChildren → fires diagnostic
 *   §B17.2 — synthesized AST: no engine in defChildren → no fire
 *   §B17.3 — synthesized AST: multiple engines → fire per engine
 *   §B17.4 — synthesized AST: engine `var=` name surfaced in message
 *   §B17.5 — synthesized AST: engine without var/governedType → falls back gracefully
 *   §B17.6 — synthesized AST: nested component-def inside another's defChildren
 *   §B17.7 — DEFERRED end-to-end test stubs (.skip with rationale)
 */

import { describe, expect, test } from "bun:test";
import { runSYM } from "../../src/symbol-table.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// End-to-end helpers (ss2 item 5 — activated deferred cases).
// `runUpToSYM` mirrors b17-3-typer-diagnostics fixture style (BS -> buildAST ->
// runSYM); `compileEndToEnd` mirrors match-block-phase2 (full compileScrml) for
// the block-form `<match>` cases that need the match-statechild parser path.
// ---------------------------------------------------------------------------
function runUpToSYM(source, filePath = "b17-deferred.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return runSYM({ filePath, ast });
}

function symErrorsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

const B17_FIXTURE_DIR = join(import.meta.dir, "__fixtures__/engine-component-scope-b17");

function compileEndToEnd(source, name = "deferred.scrml") {
  mkdirSync(B17_FIXTURE_DIR, { recursive: true });
  const p = join(B17_FIXTURE_DIR, name);
  writeFileSync(p, source);
  return compileScrml({
    inputFiles: [p],
    outputDir: join(B17_FIXTURE_DIR, "dist"),
    write: false,
  });
}

// Cross-stream code lookup (feedback_diagnostic_stream_partition): E- codes land
// in result.errors, but W-/I- partition into result.warnings. Activated cases
// here assert on E- codes, but the helper checks BOTH streams so it stays
// correct if a future severity reclassification moves a code.
function diagByCode(result, code) {
  for (const d of [...(result.errors || []), ...(result.warnings || [])]) {
    if (d.code === code) return d;
  }
  return null;
}

/**
 * Build a minimal FileAST shape carrying the synthesized component-def +
 * engine-decl arrangement. We bypass the parser pipeline because the
 * parser does not produce this shape today (Phase 0 finding).
 */
function makeFileAST({ components = [], extraNodes = [] } = {}) {
  return {
    filePath: "test.scrml",
    nodes: extraNodes.length > 0 ? [...components, ...extraNodes] : [...components],
    imports: [],
    exports: [],
    components,
    typeDecls: [],
    spans: {},
    hasProgramRoot: false,
    authConfig: null,
    middlewareConfig: null,
    machineDecls: [],
  };
}

function makeEngineDecl({
  governedType = "MarioState",
  varName = "marioState",
  initialVariant = "Small",
  span = { file: "test.scrml", start: 100, end: 150, line: 5, col: 1 },
} = {}) {
  return {
    id: 100,
    kind: "engine-decl",
    engineName: varName,
    governedType,
    rulesRaw: ".Small => .Big",
    sourceVar: null,
    varName,
    varNameOverride: null,
    initialVariant,
    pinned: false,
    isExported: false,
    legacyMachineKeyword: false,
    span,
  };
}

function makeComponentDef({ name = "Card", defChildren = [] } = {}) {
  return {
    id: 50,
    kind: "component-def",
    name,
    raw: `<div>${name}</div>`,
    defChildren,
    span: { file: "test.scrml", start: 0, end: 30, line: 1, col: 1 },
  };
}

function getComponentEngineScopeErrors(symResult) {
  return symResult.errors.filter((e) => e.code === "E-COMPONENT-ENGINE-SCOPE");
}

// ---------------------------------------------------------------------------
// §B17 — synthesized-AST coverage of PASS 11 walker
// ---------------------------------------------------------------------------

describe("B17 — PASS 11 fires E-COMPONENT-ENGINE-SCOPE on engine-decl in component-def.defChildren (synthesized AST)", () => {
  test("§B17.1 single engine in defChildren → one fire", () => {
    const engine = makeEngineDecl();
    const card = makeComponentDef({ name: "Card", defChildren: [engine] });
    const ast = makeFileAST({ components: [card] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].code).toBe("E-COMPONENT-ENGINE-SCOPE");
    expect(errs[0].severity).toBe("error");
    expect(errs[0].message).toContain("Card");
    expect(errs[0].message).toContain("MarioState");
    expect(errs[0].message).toContain("marioState");
    // Span is the engine's span, not the component's.
    expect(errs[0].span.start).toBe(engine.span.start);
  });

  test("§B17.2 component-def with NO engine in defChildren → no fire", () => {
    const card = makeComponentDef({
      name: "Card",
      defChildren: [
        // Bare-expr / non-engine sibling — should not trip the walker.
        { id: 200, kind: "css-inline", body: "color:red;", span: { file: "test.scrml", start: 0, end: 10, line: 1, col: 1 } },
      ],
    });
    const ast = makeFileAST({ components: [card] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    expect(getComponentEngineScopeErrors(sym).length).toBe(0);
  });

  test("§B17.3 multiple engines in one component's defChildren → one fire per engine", () => {
    const engineA = makeEngineDecl({ governedType: "MarioState", varName: "marioState",
      span: { file: "test.scrml", start: 100, end: 150, line: 5, col: 1 } });
    const engineB = makeEngineDecl({ governedType: "Health", varName: "health",
      span: { file: "test.scrml", start: 200, end: 250, line: 8, col: 1 } });
    const card = makeComponentDef({ name: "Card", defChildren: [engineA, engineB] });
    const ast = makeFileAST({ components: [card] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(2);
    const messages = errs.map((e) => e.message).join("\n");
    expect(messages).toContain("MarioState");
    expect(messages).toContain("Health");
    // Both spans recovered.
    const starts = errs.map((e) => e.span.start).sort((a, b) => a - b);
    expect(starts).toEqual([engineA.span.start, engineB.span.start]);
  });

  test("§B17.4 multiple component-defs each carrying their own engine → one fire per (component, engine) pair", () => {
    const engineA = makeEngineDecl({ governedType: "MarioState", varName: "marioState",
      span: { file: "test.scrml", start: 100, end: 150, line: 5, col: 1 } });
    const engineB = makeEngineDecl({ governedType: "Health", varName: "playerHealth",
      span: { file: "test.scrml", start: 300, end: 350, line: 12, col: 1 } });
    const card1 = makeComponentDef({ name: "Card1", defChildren: [engineA] });
    const card2 = makeComponentDef({ name: "Card2", defChildren: [engineB] });
    const ast = makeFileAST({ components: [card1, card2] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(2);
    const messages = errs.map((e) => e.message).join("\n");
    expect(messages).toContain("Card1");
    expect(messages).toContain("Card2");
    expect(messages).toContain("marioState");
    expect(messages).toContain("playerHealth");
  });

  test("§B17.5 engine `var=` override surfaces in the diagnostic message", () => {
    const engine = makeEngineDecl({ governedType: "Health", varName: "playerHealth" });
    const card = makeComponentDef({ name: "PlayerCard", defChildren: [engine] });
    const ast = makeFileAST({ components: [card] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("playerHealth");
    expect(errs[0].message).toContain("Health");
    expect(errs[0].message).toContain("PlayerCard");
  });

  test("§B17.6 engine-decl missing varName + governedType → graceful fallback", () => {
    // Defensive: malformed AST shouldn't crash the walker.
    const engine = makeEngineDecl();
    delete engine.varName;
    delete engine.governedType;
    const card = makeComponentDef({ name: "Card", defChildren: [engine] });
    const ast = makeFileAST({ components: [card] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    // Message uses the generic placeholder when neither var nor type is set.
    expect(errs[0].message).toContain("`<engine ...>`");
    expect(errs[0].message).toContain("Card");
  });

  test("§B17.7 nested component-def inside another's defChildren — engine in NESTED → one fire (not double)", () => {
    // A nested component-def inside the outer's defChildren is itself walked
    // — its defChildren are inspected too. An engine in the NESTED only
    // fires once (against the nested component's name).
    const innerEngine = makeEngineDecl({ governedType: "MarioState", varName: "marioState" });
    const innerCard = makeComponentDef({ name: "InnerCard", defChildren: [innerEngine] });
    const outerCard = makeComponentDef({ name: "OuterCard", defChildren: [innerCard] });
    const ast = makeFileAST({ components: [outerCard] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("InnerCard");
    // OuterCard should NOT also be named — the engine isn't directly in
    // OuterCard's defChildren.
    expect(errs[0].message).not.toContain("OuterCard");
  });

  test("§B17.8 component-def in ast.nodes but missing from ast.components → still walked via tree recursion", () => {
    // The walker recurses through node.body / node.children / arms, so a
    // component-def reachable via the tree (but not collected into
    // ast.components) is still inspected.
    const engine = makeEngineDecl();
    const orphanedCard = makeComponentDef({ name: "OrphanedCard", defChildren: [engine] });
    const ast = makeFileAST({
      components: [], // intentionally empty
      extraNodes: [orphanedCard],
    });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("OrphanedCard");
  });

  test("§B17.9 component-def reachable via a parent body[] array → still walked", () => {
    // Synthesize a "container" node whose .body holds the component-def.
    // walkRejectEnginesInComponentDefChildren descends into node.body, so
    // the component's defChildren are still inspected.
    const engine = makeEngineDecl();
    const card = makeComponentDef({ name: "ChildCard", defChildren: [engine] });
    const container = {
      id: 1000,
      kind: "logic",
      body: [card],
      span: { file: "test.scrml", start: 0, end: 200, line: 1, col: 1 },
    };
    const ast = makeFileAST({ components: [], extraNodes: [container] });
    const sym = runSYM({ filePath: ast.filePath, ast });
    const errs = getComponentEngineScopeErrors(sym);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("ChildCard");
  });
});

// ---------------------------------------------------------------------------
// §B17.deferred — DEFERRED end-to-end cases (preconditions not met)
// ---------------------------------------------------------------------------

describe("B17 — DEFERRED end-to-end cases (preconditions not met)", () => {
  // -------------------------------------------------------------------------
  // PARKED (still blocked) — engine inside a component BODY.
  //
  // CURRENT blocker (re-verified ss2 item 5, 2026-06-19): a `component-def`
  // stores its markup body as `component-def.raw: string` (ast-builder.js
  // ~line 10370 — `kind: "component-def", raw: expr`). There is no
  // component-body markup parser: the `raw` string is NEVER re-parsed into a
  // walkable AST. `defChildren` (ast-builder.js ~line 15007) collects only the
  // LOGIC-body siblings that FOLLOW a component-def, never markup nested inside
  // its body. An `<engine>` written inside a component's markup body therefore
  // lives only as substring text in `raw` — it never becomes an `engine-decl`
  // node, never lands in `machineDecls`, and is unreachable by any AST walker
  // (empirically: defChildren === [], machineDecls.length === 0, engine-decl
  // NOT reachable via body/children/defChildren/bodyChildren recursion).
  //
  // The §51.3 placement rule (ast-builder.js ~line 15607 — "engine-decl nodes
  // are children of markup (program), not logic") only collects engine-decls
  // that the block-splitter already emitted as top-level/program markup
  // children; it does not descend into a component's `raw` body.
  //
  // ACTIVATING cases (1)-(3) requires a FROM-SCRATCH subsystem: a component-body
  // markup parser pass that re-parses `component-def.raw` into walkable AST
  // children (so a nested `<engine>` becomes a walkable `engine-decl`, and a
  // self-closing `<EngineName/>` mount tag becomes a walkable mount node). That
  // pass is OUT of sPA scope — escalated to PA. The PASS 11 walker
  // (`walkRejectEnginesInComponentDefChildren`) is already correct and is
  // exercised today via SYNTHESIZED AST (§B17.1-§B17.9 above); these three
  // end-to-end cases activate once the parser produces the shape.
  test.skip("[deferred — needs component-body markup parser] end-to-end: engine-decl in component-def.defChildren via parser", () => {
    expect(true).toBe(true);
  });

  test.skip("[deferred — needs component-body markup parser] end-to-end: engine-decl inside the `raw` markup body of a component-def", () => {
    expect(true).toBe(true);
  });

  test.skip("[deferred — needs component-body markup parser] end-to-end: engine mount tag `<EngineName/>` inside a component body", () => {
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §B17.activated — formerly-DEFERRED cases now reachable end-to-end.
//
// ss2 item 5 survey (2026-06-19) found the blocker comments on these five cases
// STALE: the machinery they said was missing has since landed.
//   - cases (4)-(6): S74 Phase A1b B17.3 — `engine-statechild-parser.ts` parses
//     §51.0.F state-children (`sc.rule`, `sc.effectRaw`, `sc.onTransitionElements`),
//     and SYM PASS 17 (`validateEngineB17Diagnostics`, symbol-table.ts ~9902)
//     fires the §51.0.H typer diagnostics. Reachable BS -> buildAST -> runSYM.
//   - cases (7)-(8): S107 Phase 2 — `match-statechild-parser.ts` parses block-form
//     `<match for=Type on=expr>` arms; the §18.0.2 attribute-legality validator
//     (symbol-table.ts ~11594) fires E-MATCH-EFFECT-FORBIDDEN /
//     E-MATCH-ONTRANSITION-FORBIDDEN. Reachable via full compileScrml.
//
// All diagnostic codes pre-exist in the §34 catalog; no new codes invented and
// no source change was needed — pure test activation.
// ---------------------------------------------------------------------------
describe("B17 — ACTIVATED end-to-end cases (formerly deferred; machinery landed)", () => {
  // (4) §51.0.H fire-site #1 — `effect=` on a multi-target `rule=` is ambiguous.
  // §34 row E-ENGINE-EFFECT-AMBIGUOUS. Was stale-blocked on "state-children have
  // no implementation"; engine-statechild-parser.ts + PASS 17 now implement it.
  test("(4) effect= on multi-target rule= fires E-ENGINE-EFFECT-AMBIGUOUS", () => {
    const src = `\${ type AppMode:enum = { Idle, Active, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=(.Active | .Done) effect=\${ log("leaving idle") }></>
  <Active rule=.Done></>
  <Done></>
</>`;
    const sym = runUpToSYM(src);
    const errs = symErrorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS");
    expect(errs.length).toBe(1);
    expect(errs[0].severity).toBe("error");
    expect(errs[0].message).toContain("multi-target");
    expect(errs[0].message).toContain("Idle");
  });

  // (5) §51.0.H — `<onTransition to=.Variant>` placement validation. A valid
  // outgoing target produces NO error; an unknown variant fires
  // E-ENGINE-RULE-INVALID-VARIANT (§34). Was stale-blocked on "<onTransition>
  // not tokenized"; PASS 17 fire-sites #2-#5 now validate it.
  test("(5) <onTransition to=.Variant> — valid target produces no placement error", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Active>\${ log("ok") }</>
  </>
  <Active></>
</>`;
    const sym = runUpToSYM(src);
    expect(symErrorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
    expect(symErrorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(0);
  });

  test("(5) <onTransition to=.UnknownVariant> fires E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Nope>\${ log("bad") }</>
  </>
  <Active></>
</>`;
    const sym = runUpToSYM(src);
    const errs = symErrorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].severity).toBe("error");
    expect(errs[0].message).toContain("Nope");
  });

  // (6) §51.0.H — `<onTransition>` requires a direction. Neither `to=` nor
  // `from=` => the handler has no trigger => E-ONTRANSITION-NO-TARGET (§34 row
  // added S74). Was stale-blocked on the same "not tokenized" comment.
  test("(6) <onTransition> with neither to= nor from= fires E-ONTRANSITION-NO-TARGET", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition>\${ log("no trigger") }</>
  </>
  <Active></>
</>`;
    const sym = runUpToSYM(src);
    const errs = symErrorsByCode(sym, "E-ONTRANSITION-NO-TARGET");
    expect(errs.length).toBe(1);
    expect(errs[0].severity).toBe("error");
    expect(errs[0].message).toContain("neither");
  });

  // (7) §18.0.2 — `<onTransition>` is engine-only; inside a `<match>` arm body it
  // fires E-MATCH-ONTRANSITION-FORBIDDEN (§34). Was stale-blocked on "block-form
  // <match for=Type on=expr> not parsed"; match-statechild-parser.ts (S107 ph2)
  // parses it. Reproducer mirrors match-block-phase2 §7.
  test("(7) <onTransition> inside a <match> arm fires E-MATCH-ONTRANSITION-FORBIDDEN", () => {
    const result = compileEndToEnd(`\${ type Phase:enum = { Idle, Done } @phase = .Idle }
<match for=Phase on=@phase>
    <Idle>
        <onTransition to=.Done>\${ log("t") }</>
        <p>Idle</p>
    </>
    <Done> : <p>Done</p>
</match>
`, "match-onTransition-forbidden.scrml");
    const d = diagByCode(result, "E-MATCH-ONTRANSITION-FORBIDDEN");
    expect(d).not.toBeNull();
    expect(d.severity).toBe("error");
    expect(d.message).toContain("onTransition");
  });

  // (8) §18.0.2 — `effect=` is engine-only; on a `<match>` arm it fires
  // E-MATCH-EFFECT-FORBIDDEN (§34). Same stale block as (7). Reproducer mirrors
  // match-block-phase2 §6.
  test("(8) effect= inside a <match> arm fires E-MATCH-EFFECT-FORBIDDEN", () => {
    const result = compileEndToEnd(`\${ type Phase:enum = { Idle, Done } @phase = .Idle }
<match for=Phase on=@phase>
    <Idle effect=\${ doIt() }> : <p>Idle</p>
    <Done> : <p>Done</p>
</match>
`, "match-effect-forbidden.scrml");
    const d = diagByCode(result, "E-MATCH-EFFECT-FORBIDDEN");
    expect(d).not.toBeNull();
    expect(d.severity).toBe("error");
    expect(d.message).toContain("effect=");
  });
});
