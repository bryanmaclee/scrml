/**
 * §51.0.J derived-engine EXPRESSION form — end-to-end (S190).
 *
 * The MODERN `derived=expr` form computes an engine's variant from an
 * arbitrary reactive expression of the engine's own type, instead of the
 * §51.9 legacy `derived=@machineVar` 1:1 name-identity projection.
 *
 *   <engine for=Health derived=match @marioState {
 *     .Small | .Big => .Healthy
 *     .Fire | .Cape => .AtRisk
 *     _             => .Critical
 *   }> ... </>
 *
 * Pre-S190 this mis-routed through the §51.9 `validateDerivedMachines` path
 * and fired E-ENGINE-004 (source not machine-bound) / E-ENGINE-018 (legacy
 * projection exhaustiveness). The fix disentangles the modern form in
 * type-system `buildMachineRegistry` (an engine carrying `inlineMatchBody`
 * or a parsed `derivedExprNode` is the §51.0.J modern form, NOT §51.9) while
 * the legacy `derived=@machineVar` projection (machine-bound source, arrow
 * rules, E-ENGINE-018 exhaustiveness) stays untouched.
 *
 * This is the FULL-PIPELINE regression surface — compileScrml(), not the
 * SYM-only/codegen-only unit harness (which silently skips the
 * validateDerivedMachines TS pass where the mis-fire lived).
 *
 * Loci:
 *   - ast-builder.js — opener-end finder + `derived=` expr-form capture
 *     (`derivedExprText` / `derivedExprNode` for the ternary/call/conditional
 *     forms; `inlineMatchBody` for the match form).
 *   - type-system.ts buildMachineRegistry — modern-form discrimination.
 *   - symbol-table.ts — derivedExpr.kind tag + B16 rejections (NO-RULES now
 *     also catches a state-child `rule=` attribute).
 *   - dependency-graph.ts — reactive dep edges + E-DERIVED-ENGINE-CIRCULAR.
 *   - codegen/emit-engine.ts — C14 `_scrml_derived_*` reactive recompute.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWhole(source, name = `dee-${++tmpCounter}`) {
  const safe = String(name).replace(/[^A-Za-z0-9_-]+/g, "_") || `dee-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${safe}`);
  const tmpInput = resolve(tmpDir, `${safe}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    const out = result.outputs.get(tmpInput) ?? {};
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      warnings: result.warnings ?? [],
      clientJs: out.clientJs ?? "",
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codesOf = (errs) => errs.map((e) => e.code);

// ---------------------------------------------------------------------------
// §1 — modern `derived=match @x {...}` arbitrary mapping compiles + recomputes
// ---------------------------------------------------------------------------

describe("§51.0.J modern derived=match — arbitrary variant mapping", () => {
  const MATCH_SRC = `type MarioState:enum = { Small, Big, Fire, Cape, Dead }
type Health:enum = { Healthy, AtRisk, Critical }
<marioState>: MarioState = MarioState.Small
<engine for=Health derived=match @marioState {
  .Small | .Big :> .Healthy
  .Fire | .Cape :> .AtRisk
  _             :> .Critical
}>
  <Healthy : "OK">
  <AtRisk : "Careful">
  <Critical : "Danger">
</>
<div>\${@health}</div>`;

  test("compiles CLEAN — no E-ENGINE-004 / E-ENGINE-018 mis-fire", () => {
    const { errors } = compileWhole(MATCH_SRC, "match-arbitrary");
    expect(codesOf(errors)).not.toContain("E-ENGINE-004");
    expect(codesOf(errors)).not.toContain("E-ENGINE-018");
    expect(errors).toEqual([]);
  });

  test("emits the C14 derived substrate — subscribes to @marioState + recomputes via the match", () => {
    const { clientJs } = compileWhole(MATCH_SRC, "match-arbitrary-js");
    expect(clientJs).toContain('_scrml_derived_declare("health"');
    expect(clientJs).toContain('_scrml_derived_subscribe("health", "marioState");');
    expect(clientJs).toContain('_scrml_derived_get("health");');
    // The match lowers to a reactive read of the upstream + branch returns.
    expect(clientJs).toContain('_scrml_reactive_get("marioState")');
    expect(clientJs).toMatch(/"Healthy"/);
    expect(clientJs).toMatch(/"AtRisk"/);
    expect(clientJs).toMatch(/"Critical"/);
  });
});

// ---------------------------------------------------------------------------
// §2 — legacy `derived=@machineVar` 1:1 projection STILL works (no regression)
// ---------------------------------------------------------------------------

describe("§51.9 legacy derived=@machineVar projection — unchanged", () => {
  // @marioState is itself an ENGINE variable (machine-bound), so the legacy
  // projection path resolves it in reactiveBindings (the Bug-2 loop).
  const LEGACY_SRC = `type MarioState:enum = { Small, Big, Fire, Cape }
type HealthRisk:enum = { Safe, AtRisk }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>
<engine for=HealthRisk derived=@marioState>
  .Small               => .AtRisk
  .Big | .Fire | .Cape => .Safe
</>
<div>\${@healthRisk}</div>`;

  test("compiles CLEAN — legacy projection arrow rules over a machine-bound source", () => {
    const { errors } = compileWhole(LEGACY_SRC, "legacy-projection");
    expect(errors).toEqual([]);
  });

  test("E-ENGINE-018 still fires on a NON-exhaustive legacy projection", () => {
    const NONEXHAUSTIVE = `type MarioState:enum = { Small, Big, Fire, Cape }
type HealthRisk:enum = { Safe, AtRisk }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>
<engine for=HealthRisk derived=@marioState>
  .Small => .AtRisk
</>`;
    const { errors } = compileWhole(NONEXHAUSTIVE, "legacy-nonexhaustive");
    expect(codesOf(errors)).toContain("E-ENGINE-018");
  });
});

// ---------------------------------------------------------------------------
// §3 — B16 rejections fire on the MODERN match form (not E-ENGINE-018)
// ---------------------------------------------------------------------------

describe("§51.0.J B16 rejections on the modern derived=match form", () => {
  const HEADER = `type MarioState:enum = { Small, Big, Fire }
type Health:enum = { Healthy, AtRisk }
<marioState>: MarioState = MarioState.Small`;

  test("E-DERIVED-ENGINE-NO-RULES on a state-child rule= attribute", () => {
    const src = `${HEADER}
<engine for=Health derived=match @marioState { .Small :> .Healthy  _ :> .AtRisk }>
  <Healthy rule=.AtRisk : "OK">
  <AtRisk : "Careful">
</>`;
    const { errors } = compileWhole(src, "modern-no-rules");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-NO-RULES");
    expect(codesOf(errors)).not.toContain("E-ENGINE-018");
  });

  test("E-DERIVED-ENGINE-NO-INITIAL on initial= attribute", () => {
    const src = `${HEADER}
<engine for=Health initial=.Healthy derived=match @marioState { .Small :> .Healthy  _ :> .AtRisk }>
  <Healthy : "OK">
  <AtRisk : "Careful">
</>`;
    const { errors } = compileWhole(src, "modern-no-initial");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-NO-INITIAL");
  });

  test("E-DERIVED-ENGINE-NO-WRITE on a direct write to the derived var", () => {
    const src = `${HEADER}
<engine for=Health derived=match @marioState { .Small :> .Healthy  _ :> .AtRisk }>
  <Healthy : "OK">
  <AtRisk : "Careful">
</>
\${ function go() { @health = .Healthy } }`;
    const { errors } = compileWhole(src, "modern-no-write");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-NO-WRITE");
  });

  test("E-ENGINE-EFFECT-ON-DERIVED on an opener effect=", () => {
    const src = `${HEADER}
<engine for=Health effect=\${ log("boot") } derived=match @marioState { .Small :> .Healthy  _ :> .AtRisk }>
  <Healthy : "OK">
  <AtRisk : "Careful">
</>`;
    const { errors } = compileWhole(src, "modern-opener-effect");
    expect(codesOf(errors)).toContain("E-ENGINE-EFFECT-ON-DERIVED");
  });

  test("state-child effect= is LEGAL on a derived engine (compiles clean)", () => {
    const src = `${HEADER}
<engine for=Health derived=match @marioState { .Small :> .Healthy  _ :> .AtRisk }>
  <Healthy : "OK">
  <AtRisk effect=\${ log("at risk") } : "Careful">
</>`;
    const { errors } = compileWhole(src, "modern-statechild-effect");
    expect(errors).toEqual([]);
  });

  test("E-DERIVED-ENGINE-CIRCULAR on a 2-engine derivation cycle", () => {
    const src = `type A:enum = { X, Y }
type B:enum = { P, Q }
<engine for=A derived=match @b { .P :> .X  _ :> .Y }>
  <X : "X">
  <Y : "Y">
</>
<engine for=B derived=match @a { .X :> .P  _ :> .Q }>
  <P : "P">
  <Q : "Q">
</>`;
    const { errors } = compileWhole(src, "modern-circular");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-CIRCULAR");
  });
});

// ---------------------------------------------------------------------------
// §4 — modern `derived=<expr>` ternary / call / conditional (S190 Phase B)
// ---------------------------------------------------------------------------

describe("§51.0.J modern derived=<expr> — ternary / call / multi-cell", () => {
  test("ternary `derived=@n > 500 ? .High : .Low` compiles CLEAN + recomputes", () => {
    const src = `type Level:enum = { High, Low }
<miles>: int = 600
<engine for=Level derived=@miles > 500 ? .High : .Low>
  <High : "High">
  <Low : "Low">
</>
<div>\${@level}</div>`;
    const { errors, clientJs } = compileWhole(src, "expr-ternary");
    expect(codesOf(errors)).not.toContain("E-ENGINE-004");
    expect(codesOf(errors)).not.toContain("E-ENGINE-018");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('_scrml_derived_declare("level"');
    expect(clientJs).toContain('_scrml_derived_subscribe("level", "miles");');
    // The ternary lowers: @miles -> reactive_get, .High/.Low -> enum strings.
    expect(clientJs).toContain('_scrml_reactive_get("miles") > 500');
    expect(clientJs).toMatch(/"High"/);
    expect(clientJs).toMatch(/"Low"/);
  });

  test("function-call `derived=classify(@n)` compiles CLEAN", () => {
    const src = `type Level:enum = { High, Low }
\${
  fn classify(m: int): Level {
    given m > 500 :> { return .High }
    return .Low
  }
}
<miles>: int = 600
<engine for=Level derived=classify(@miles)>
  <High : "High">
  <Low : "Low">
</>
<div>\${@level}</div>`;
    const { errors, clientJs } = compileWhole(src, "expr-call");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('_scrml_derived_declare("level"');
    expect(clientJs).toContain('_scrml_derived_subscribe("level", "miles");');
  });

  test("multi-cell ternary subscribes to EVERY referenced cell", () => {
    const src = `type Level:enum = { High, Low }
<miles>: int = 600
<bonus>: int = 100
<engine for=Level derived=@miles + @bonus > 500 ? .High : .Low>
  <High : "High">
  <Low : "Low">
</>
<div>\${@level}</div>`;
    const { errors, clientJs } = compileWhole(src, "expr-multicell");
    expect(errors).toEqual([]);
    expect(clientJs).toContain('_scrml_derived_subscribe("level", "miles");');
    expect(clientJs).toContain('_scrml_derived_subscribe("level", "bonus");');
  });

  test("E-DERIVED-ENGINE-NO-INITIAL on initial= over a ternary form", () => {
    const src = `type Level:enum = { High, Low }
<miles>: int = 600
<engine for=Level initial=.Low derived=@miles > 500 ? .High : .Low>
  <High : "High">
  <Low : "Low">
</>`;
    const { errors } = compileWhole(src, "expr-no-initial");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-NO-INITIAL");
  });

  test("E-DERIVED-ENGINE-NO-WRITE on a direct write over a ternary form", () => {
    const src = `type Level:enum = { High, Low }
<miles>: int = 600
<engine for=Level derived=@miles > 500 ? .High : .Low>
  <High : "High">
  <Low : "Low">
</>
\${ function go() { @level = .High } }`;
    const { errors } = compileWhole(src, "expr-no-write");
    expect(codesOf(errors)).toContain("E-DERIVED-ENGINE-NO-WRITE");
  });

  test("legacy `derived=@x` with a trailing opener attr (`var=`) stays LEGACY", () => {
    // The Bug-2 loop makes the engine var @phase machine-bound; the name-
    // identity bodied form is the legacy path (E-ENGINE-018 territory if not
    // exhaustive) — NOT the modern expr form. This asserts it is NOT routed as
    // an expr (no derivedExprText capture corrupting the value).
    const src = `type Phase:enum = { Idle, Loading }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>
<engine for=Phase var=mirror derived=@phase>
  .Idle    => .Idle
  .Loading => .Loading
</>`;
    const { errors } = compileWhole(src, "legacy-trailing-attr");
    // Legacy projection over a machine-bound source with exhaustive rules: clean.
    expect(errors).toEqual([]);
  });
});

