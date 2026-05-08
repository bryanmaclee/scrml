/**
 * derived-engine-rejections.test.js — A1b Phase B16 tests.
 *
 * Per SPEC §51.0.J (Lock L20), §51.0.G (.advance), §31.5 (derived dep
 * tracking), §34 catalog. Tests the four B16 error codes:
 *
 *   - E-DERIVED-ENGINE-NO-INITIAL — `initial=` on a derived engine.
 *   - E-DERIVED-ENGINE-NO-RULES — authored transition rules in the body of
 *     a Move-14-shape derived engine.
 *   - E-DERIVED-ENGINE-NO-WRITE — direct write or `.advance(.X)` on a
 *     derived engine's auto-declared variable.
 *   - E-DERIVED-ENGINE-CIRCULAR — chained derivation forms a cycle
 *     (DG-side, second consumer of B7's `detectCycle`).
 *
 * Audit reference:
 *   - docs/audits/a1b-b16-rule4-audit-2026-05-07.md
 *
 * **Important: §51.9 LEGACY form vs §51.0.J Move-14 form.** Today's parser
 * (ast-builder.js) only emits the legacy `derived=@varname` shape — B14
 * wraps it as `{ kind: "legacy-source-var", varName }`. The Move-14 rich-
 * expression form (`derived=match @x { ... }`) is NOT yet structurally
 * parsed.
 *
 * - **DG-side cycle detection** (`E-DERIVED-ENGINE-CIRCULAR`) handles the
 *   legacy form correctly via `_record.engineMeta.derivedExpr.varName`. We
 *   test it end-to-end through `runSYM + runDG`.
 * - **SYM-side rejections** (`E-DERIVED-ENGINE-NO-INITIAL/-NO-RULES/
 *   -NO-WRITE`) are GATED on `derivedExpr.kind !== "legacy-source-var"`
 *   to avoid double-firing with E-ENGINE-017 + §51.9 projection-rule
 *   semantics. We exercise these by mutating `engineMeta.derivedExpr`
 *   to a non-legacy shape AFTER PASS 10.A registers the engine, then
 *   invoking the exported B16 walkers directly. (Re-running runSYM
 *   would overwrite our mutation via `makeEngineRecord`.)
 *
 * Coverage areas:
 *   1. Legacy projection chain — DG cycle detection trips correctly when
 *      A → B → A or self-reference forms.
 *   2. Move-14-shape simulated derivation:
 *      - NO-INITIAL fires when `initial=` is present on a derived engine.
 *      - NO-RULES fires when `rulesRaw` contains `=>` lines.
 *      - NO-WRITE fires on `@phase = .X` direct assignment.
 *      - NO-WRITE fires on `@phase.advance(.X)` method call.
 *      - NO-WRITE does NOT fire on a non-derived engine.
 *      - NO-WRITE does NOT fire on a non-engine reactive cell.
 *      - LEGAL: derived engine with no rules + no initial + no writes
 *        passes silently.
 *   3. Cross-class isolation:
 *      - Legacy form is silent on B16's NO-INITIAL/NO-RULES (E-ENGINE-017
 *        and §51.9 own those domains).
 *      - Non-derived engines pass through B16 silently (B15 owns).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runSYM,
  walkDerivedEngineDeclRejections,
  walkDerivedEngineWriteRejections,
} from "../../src/symbol-table.ts";
import { runDG } from "../../src/dependency-graph.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runUpToSYM(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

function runFullDG(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  const dg = runDG({ files: [{ filePath, ast }], routeMap: { functions: new Map() } });
  return { ast, sym, dg };
}

function findEngineDecls(ast) {
  const found = [];
  function walk(nodes) {
    if (!nodes) return;
    if (Array.isArray(nodes)) {
      for (const n of nodes) walk(n);
      return;
    }
    if (typeof nodes !== "object") return;
    if (nodes.kind === "engine-decl") {
      found.push(nodes);
      return;
    }
    if (nodes.children) walk(nodes.children);
    if (nodes.body) walk(nodes.body);
  }
  walk(ast.nodes || []);
  return found;
}

function findEngineDeclByVarName(ast, varName) {
  const decls = findEngineDecls(ast);
  for (const d of decls) {
    if (d._record && d._record.engineMeta && d._record.engineMeta.varName === varName) {
      return d;
    }
  }
  return null;
}

function getErrorsByCode(errs, code) {
  return (errs || []).filter((e) => e.code === code);
}

/**
 * Mutate an engine record's derivedExpr to a non-legacy shape, simulating
 * what the future Move-14 ast-builder will produce. The exact shape is a
 * placeholder ExprNode-like object — what matters is that
 * `derivedExpr.kind !== "legacy-source-var"`, which trips the SYM rejection
 * walker.
 */
function makeMove14DerivedExpr(upstreamVarName) {
  return {
    kind: "match-block",
    discriminant: { kind: "ident", name: `@${upstreamVarName}` },
    arms: [],
  };
}

/**
 * Run B16 PASS 11 walkers directly on an AST that's already been processed
 * by `runSYM`. Allows tests to mutate `engineMeta.derivedExpr` without
 * re-running runSYM (which would overwrite the mutation via PASS 10.A's
 * `makeEngineRecord` re-derive from `engineDecl.sourceVar`).
 *
 * Returns the freshly-collected errors from the two B16 walkers (NOT the
 * accumulated `sym.errors` from the prior runSYM call).
 */
function runB16Pass(ast, sym, filePath = "/test/app.scrml") {
  const errors = [];
  walkDerivedEngineDeclRejections(ast.nodes, errors, filePath, new WeakSet());
  walkDerivedEngineWriteRejections(
    ast.nodes, sym.fileScope, errors, filePath, new WeakSet(),
  );
  return errors;
}

// ---------------------------------------------------------------------------
// E-DERIVED-ENGINE-CIRCULAR — DG-side cycle detection (legacy form OK)
// ---------------------------------------------------------------------------

describe("E-DERIVED-ENGINE-CIRCULAR — DG cycle detection", () => {
  test("legacy form: control case (chain without cycle) — no error", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { Happy, Sad }",
      "  @phase: Phase = Phase.A",
      "}",
      "",
      "<engine name=Mood for=Mood derived=@phase>",
      "  .A => .Happy",
      "  .B => .Sad",
      "</>",
      "",
    ].join("\n");
    const { dg } = runFullDG(source);
    const errs = getErrorsByCode(dg.errors, "E-DERIVED-ENGINE-CIRCULAR");
    expect(errs).toEqual([]);
  });

  test("legacy form: cross-engine cycle (A → B → A) fires E-DERIVED-ENGINE-CIRCULAR", () => {
    // Two derived engines whose source-vars chain into each other. Today's
    // type-system rejects transitive projection (§51.9.7), but the DG
    // cycle pass is the defensive guard at a different stage. We assert
    // the DG-side error fires regardless of other errors.
    //
    // Use auto-derived var names (no `name=` override) so var casing
    // matches the source-var case: `for=T` → var `t`, `for=U` → var `u`.
    const source = [
      "${",
      "  type T:enum = { X, Y }",
      "  type U:enum = { A, B }",
      "}",
      "",
      "<engine for=T derived=@u>",
      "  .A => .X",
      "  .B => .Y",
      "</>",
      "",
      "<engine for=U derived=@t>",
      "  .X => .A",
      "  .Y => .B",
      "</>",
      "",
    ].join("\n");
    const { dg } = runFullDG(source, "/test/cycle.scrml");
    const errs = getErrorsByCode(dg.errors, "E-DERIVED-ENGINE-CIRCULAR");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/Circular dependency/);
  });

  test("legacy form: self-reference fires E-DERIVED-ENGINE-CIRCULAR (1-cycle)", () => {
    // The engine's auto-derived var equals its source var, which is the
    // degenerate 1-cycle case for derived engines.
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  @phase: Phase = Phase.A",
      "}",
      "",
      "<engine name=Phase for=Phase derived=@phase>",
      "  .A => .A",
      "  .B => .B",
      "</>",
      "",
    ].join("\n");
    // The engine var is `Phase` (since `name=Phase`), source `phase` —
    // these differ by case. Try with `name=phase` to align case... actually
    // var names ARE case-sensitive. Let me use `name=Phase` ⇒ var `Phase`
    // and have a separate `@phase` cell.
    //
    // Actually the cleaner self-cycle setup: engine `name=phase for=Phase
    // derived=@phase` — source IS the engine's own var. But `name=phase`
    // collides with `@phase: Phase = Phase.A` declared in the logic block.
    // Drop the @phase decl to avoid name-collision; the parser treats
    // sourceVar as a string ident regardless of declaration.
    const source2 = [
      "${",
      "  type Phase:enum = { A, B }",
      "}",
      "",
      "<engine name=phase for=Phase derived=@phase>",
      "  .A => .A",
      "  .B => .B",
      "</>",
      "",
    ].join("\n");
    const { dg } = runFullDG(source2, "/test/self.scrml");
    const errs = getErrorsByCode(dg.errors, "E-DERIVED-ENGINE-CIRCULAR");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/references its own variant|Circular dependency/);
  });
});

// ---------------------------------------------------------------------------
// E-DERIVED-ENGINE-NO-* — SYM-side rejections (Move-14-shape simulation)
// ---------------------------------------------------------------------------

describe("E-DERIVED-ENGINE-NO-INITIAL — `initial=` on derived engine", () => {
  test("Move-14 shape (simulated): fires NO-INITIAL when `initial=` is present", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream initial=.A/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    expect(eng._record.engineMeta.initialVariant).toBe("A");
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-INITIAL");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/initial=\.A/);
  });

  test("Legacy form: NO-INITIAL is NOT fired", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream initial=.A/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-INITIAL");
    expect(errs).toEqual([]);
  });
});

describe("E-DERIVED-ENGINE-NO-RULES — authored transitions on derived engine", () => {
  test("Move-14 shape (simulated): fires NO-RULES when body has `.From => .To` lines", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream>",
      "  .A => .A",
      "  .B => .B",
      "</>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-RULES");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/declares transition rules/);
  });

  test("Move-14 shape (simulated): does NOT fire NO-RULES when body is empty", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-RULES");
    expect(errs).toEqual([]);
  });

  test("Legacy form: NO-RULES is NOT fired (projection rules are LEGAL there)", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream>",
      "  .A => .A",
      "  .B => .B",
      "</>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-RULES");
    expect(errs).toEqual([]);
  });
});

describe("E-DERIVED-ENGINE-NO-WRITE — direct writes to derived engine", () => {
  test("Move-14 shape (simulated): fires NO-WRITE on `@mood = .X` inside function body", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "  function badWrite() { @mood = Mood.A }",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/`@mood = \.\.\.`/);
  });

  test("Move-14 shape (simulated): fires NO-WRITE on `.advance(.X)` method call", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "  function badAdvance() { @mood.advance(Mood.A) }",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/`@mood\.advance\(\.\.\.\)`/);
  });

  test("Move-14 shape (simulated): fires NO-WRITE on compound-assign `@mood += .X`", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "  function badAdd() { @mood += Mood.A }",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  test("Non-derived engine: NO-WRITE is NOT fired (B15 owns)", () => {
    const source = [
      "${",
      "  type Mood:enum = { A, B }",
      "  function legalWrite() { @mood = Mood.A }",
      "}",
      "",
      "<engine for=Mood initial=.A>",
      "  .A => .B",
      "  .B => .A",
      "</>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs).toEqual([]);
  });

  test("Legacy form: NO-WRITE is NOT fired (E-ENGINE-017 owns)", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "  function attemptWrite() { @mood = Mood.A }",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs).toEqual([]);
  });

  test("Non-engine reactive cell: NO-WRITE is NOT fired", () => {
    const source = [
      "${",
      "  @x: number = 0",
      "  function inc() { @x = 5 }",
      "}",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    const errs = getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE");
    expect(errs).toEqual([]);
  });
});

describe("B16 — derived engine LEGAL forms (no false positives)", () => {
  test("Move-14 shape (simulated): empty body + no initial + no writes — clean", () => {
    const source = [
      "${",
      "  type Phase:enum = { A, B }",
      "  type Mood:enum = { A, B }",
      "  @upstream: Phase = Phase.A",
      "}",
      "",
      "<engine for=Mood derived=@upstream/>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const eng = findEngineDeclByVarName(ast, "mood");
    expect(eng).not.toBeNull();
    eng._record.engineMeta.derivedExpr = makeMove14DerivedExpr("upstream");
    const b16Errors = runB16Pass(ast, sym);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-INITIAL")).toEqual([]);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-RULES")).toEqual([]);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE")).toEqual([]);
  });

  test("Non-derived engine: B16 silent (B15 territory)", () => {
    const source = [
      "${",
      "  type Mood:enum = { A, B }",
      "}",
      "",
      "<engine for=Mood initial=.A>",
      "  .A => .B",
      "  .B => .A",
      "</>",
      "",
    ].join("\n");
    const { ast, sym } = runUpToSYM(source);
    const b16Errors = runB16Pass(ast, sym);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-INITIAL")).toEqual([]);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-RULES")).toEqual([]);
    expect(getErrorsByCode(b16Errors, "E-DERIVED-ENGINE-NO-WRITE")).toEqual([]);
  });
});
