/**
 * Bug 1.5 — engine-var markup-binding emission
 *
 * Tests for the codegen gap surfaced by Bug 1 dispatch (S87 d8ea41c, finding
 * #2): markup interpolations referencing `<engine for=Type>`'s auto-declared
 * variable (`${@marioState}` for `<engine for=MarioState>`) lost their
 * reactive display wiring because `collectReactiveVarNames` only walked
 * `state-decl` nodes — engine-decl auto-declared cells were never added to
 * the known-reactive-var set.
 *
 * Coverage:
 *   §1  collectReactiveVarNames — engine-decl coverage (unit tests against
 *       the function directly using hand-built fileAST fixtures)
 *       §1.1  modern <engine for=Type> via fileAST.machineDecls (post ast-builder)
 *       §1.2  modern <engine for=Type> via markup-children visit (test fixture path)
 *       §1.3  legacy-name engine via engineName fallback (third-tier)
 *       §1.4  <engine var=Override for=Type> override coverage
 *       §1.5  derived engine: both source AND projected var land in the set
 *       §1.6  nested engine (§51.0.Q.1) inside bodyChildren
 *       §1.7  _record.engineMeta.varName preferred over node.varName
 *       §1.8  parse-failure shape — silent skip
 *
 *   §2  end-to-end codegen — `${@marioState}` reactive wiring lands
 *       §2.1  modern <engine for=Type> wires placeholder via _scrml_reactive_get + _scrml_effect
 *       §2.2  derived engine projection still wires (regression guard)
 *
 * Maps consulted: primary, structure, error.
 * Spec: §51.0.C (auto-declared engine variable rule); primer §13.7 B14.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { collectReactiveVarNames } from "../../src/codegen/reactive-deps.ts";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// helpers — file-based pipeline compile (mirrors computed-delay.test.js)
// ---------------------------------------------------------------------------

function compileToClientJs(source, suffix = "engine-var-markup") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1  collectReactiveVarNames — engine-decl coverage
// ---------------------------------------------------------------------------

describe("Bug 1.5 §1 — collectReactiveVarNames discovers engine-decl auto-declared variables", () => {
  test("§1.1 picks up modern <engine for=Type> from fileAST.machineDecls (ast-builder pre-collected)", () => {
    // Mirrors what ast-builder.js stamps on the engine-decl AST node:
    //   - kind: "engine-decl"
    //   - varName: auto-derived per §51.0.C (lowercase first character of governedType)
    //   - governedType: "MarioState"
    const engineDecl = {
      kind: "engine-decl",
      varName: "marioState",
      engineName: "marioState",
      governedType: "MarioState",
    };
    const fileAST = {
      nodes: [],
      machineDecls: [engineDecl],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("marioState")).toBe(true);
  });

  test("§1.2 picks up <engine for=Type> from markup-children visit when machineDecls is absent", () => {
    // Test-fixture path — bypasses ast-builder's collectHoisted pass so
    // there is no fileAST.machineDecls. The visit() walker should still
    // discover engine-decls reachable via children.
    const fileAST = {
      nodes: [
        {
          kind: "markup",
          children: [
            {
              kind: "engine-decl",
              varName: "phase",
              engineName: "phase",
              governedType: "Phase",
            },
          ],
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("phase")).toBe(true);
  });

  test("§1.3 falls back to engineName when varName is missing (legacy-form fixture)", () => {
    // Fixtures with only engineName populated should still resolve via
    // _resolveEngineVarName's third-tier fallback.
    const fileAST = {
      nodes: [],
      machineDecls: [
        {
          kind: "engine-decl",
          engineName: "ui",
          governedType: "UI",
          legacyMachineKeyword: true,
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("ui")).toBe(true);
  });

  test("§1.4 picks up <engine var=Override for=Type> override name", () => {
    // Per §51.0.B `var=NAME` override; ast-builder writes `varName=NAME`.
    const fileAST = {
      nodes: [],
      machineDecls: [
        {
          kind: "engine-decl",
          varName: "myCustomState",
          varNameOverride: "myCustomState",
          engineName: "myCustomState",
          governedType: "GameState",
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("myCustomState")).toBe(true);
  });

  test("§1.5 derived engine — both source @var AND projected var land in the set", () => {
    // 14-mario shape: a primary `<engine for=MarioState>` declares @marioState
    // and a derived `<engine for=HealthRisk derived=@marioState>` declares
    // @healthRisk. Both must end up in the known-reactive-var set so that
    // both `${@marioState}` and `${@healthRisk}` markup interpolations get
    // wired display effects.
    const fileAST = {
      nodes: [],
      machineDecls: [
        {
          kind: "engine-decl",
          varName: "marioState",
          engineName: "marioState",
          governedType: "MarioState",
        },
        {
          kind: "engine-decl",
          varName: "healthRisk",
          engineName: "healthRisk",
          governedType: "HealthRisk",
          sourceVar: "marioState",
        },
      ],
      // Mirror the type-system's machineRegistry shape — derived projection
      // uses `projectedVarName`. Both the pre-fix path (machineRegistry) and
      // the new engine-decl walk should converge on the same Set.
      machineRegistry: new Map([
        ["HealthRisk", { isDerived: true, projectedVarName: "healthRisk" }],
      ]),
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("marioState")).toBe(true);
    expect(result.has("healthRisk")).toBe(true);
  });

  test("§1.6 nested engine (§51.0.Q.1) inside bodyChildren is also discovered", () => {
    // §51.0.Q.1 — nested engines live as engine-decl nodes inside parent
    // engine-decl.bodyChildren. The visit() loop now descends into
    // bodyChildren when it encounters an engine-decl.
    const fileAST = {
      nodes: [
        {
          kind: "markup",
          children: [
            {
              kind: "engine-decl",
              varName: "outer",
              engineName: "outer",
              governedType: "Outer",
              bodyChildren: [
                {
                  kind: "engine-decl",
                  varName: "inner",
                  engineName: "inner",
                  governedType: "Inner",
                },
              ],
            },
          ],
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("outer")).toBe(true);
    expect(result.has("inner")).toBe(true);
  });

  test("§1.7 _record.engineMeta.varName preferred when present (post-SYM annotation)", () => {
    // SYM PASS 10.A stamps _record.engineMeta on the engine-decl. The
    // resolver should prefer this canonical accessor over the raw AST
    // field — important because var=NAME override resolution + cross-file
    // consistency goes through engineMeta.
    const fileAST = {
      nodes: [],
      machineDecls: [
        {
          kind: "engine-decl",
          varName: "stale",          // ast-builder stamp (could be intermediate)
          engineName: "stale",
          governedType: "Phase",
          _record: {
            engineMeta: { varName: "phase" }, // SYM canonical
          },
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.has("phase")).toBe(true);
    expect(result.has("stale")).toBe(false);
  });

  test("§1.8 silently skips engine-decl with no resolvable name (parse failure)", () => {
    // Parse-failure shape — TAB/SYM diagnostics handle the error fire;
    // collectReactiveVarNames should not throw or pollute the set.
    const fileAST = {
      nodes: [],
      machineDecls: [
        {
          kind: "engine-decl",
          // No varName, no engineName, no _record — parse failed.
        },
      ],
    };
    const result = collectReactiveVarNames(fileAST);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2  End-to-end codegen — `${@engineVar}` reactive wiring lands
// ---------------------------------------------------------------------------

describe("Bug 1.5 §2 — end-to-end ${@engineVar} markup interpolation gets reactive display wiring", () => {
  test("§2.1 modern <engine for=Type> wires `${@marioState}` placeholder via _scrml_reactive_get + _scrml_effect", () => {
    const source = `\${
    type MarioState:enum = { Small, Big, Fire, Cape }
}

<engine for=MarioState initial=.Small>
    <Small rule=(.Big | .Fire)></>
    <Big   rule=.Small></>
    <Fire  rule=.Small></>
    <Cape  rule=.Small></>
</>

<program>
<div>
    <span>STATE: \${@marioState}</span>
</div>
</program>`;
    const { errors, clientJs } = compileToClientJs(source, "bug15-modern");
    // Sanity: compile clean (warnings allowed; errors not).
    const hardErrors = errors.filter(e => e.severity !== "warning");
    expect(hardErrors).toEqual([]);
    expect(clientJs.length).toBeGreaterThan(0);

    // Pre-fix: the placeholder span had NO wiring. Post-fix: the lift-site
    // emits `_scrml_render_value(el, _scrml_reactive_get("marioState"))` PLUS an
    // `_scrml_effect(...)` subscription so writes to @marioState propagate.
    // markup-value-in-expression-2026-06-17: the display routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    expect(clientJs).toContain('_scrml_reactive_get("marioState")');
    expect(clientJs).toMatch(
      /_scrml_effect\s*\(\s*function\s*\(\s*\)\s*\{\s*_scrml_render_value\(el,\s*_scrml_reactive_get\("marioState"\)\)/,
    );
  });

  test("§2.2 derived projection (`${@healthRisk}` from `<engine for=HealthRisk derived=@marioState>`) ALSO wires (regression guard)", () => {
    // Pre-fix the derived projection ALREADY worked via the
    // machineRegistry path (projectedVarName Set walk). This test guards
    // against the new engine-decl walk causing duplicate registration or
    // collision that would break the derived path.
    const source = `\${
    type MarioState:enum = { Small, Big, Fire }
    type HealthRisk:enum = { AtRisk, Safe }
}

<engine for=MarioState initial=.Small>
    <Small rule=(.Big | .Fire)></>
    <Big   rule=.Small></>
    <Fire  rule=.Small></>
</>

<engine for=HealthRisk derived=@marioState>
    .Small         => .AtRisk
    .Big | .Fire   => .Safe
</>

<program>
<div>
    <span>STATE: \${@marioState}</span>
    <span>RISK:  \${@healthRisk}</span>
</div>
</program>`;
    const { errors, clientJs } = compileToClientJs(source, "bug15-derived");
    const hardErrors = errors.filter(e => e.severity !== "warning");
    expect(hardErrors).toEqual([]);
    expect(clientJs.length).toBeGreaterThan(0);

    // Both placeholders must be wired. The primary engine var routes
    // through _scrml_reactive_get. The derived-engine projected var ALSO
    // routes through _scrml_reactive_get for display — `_scrml_derived_get`
    // is only used for `const @derived = expr` shapes (collectDerivedVarNames
    // tracks those separately). For derived-engine projections, the runtime
    // populates the reactive map via `_scrml_derived_declare(name, fn)`
    // followed by `_scrml_derived_subscribe(name, sourceVar)`, so reads at
    // the display site go through the standard reactive accessor.
    expect(clientJs).toContain('_scrml_reactive_get("marioState")');
    expect(clientJs).toContain('_scrml_reactive_get("healthRisk")');
    // markup-value-in-expression-2026-06-17: the display routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    expect(clientJs).toMatch(
      /_scrml_effect\s*\(\s*function\s*\(\s*\)\s*\{\s*_scrml_render_value\(el,\s*_scrml_reactive_get\("marioState"\)\)/,
    );
    expect(clientJs).toMatch(
      /_scrml_effect\s*\(\s*function\s*\(\s*\)\s*\{\s*_scrml_render_value\(el,\s*_scrml_reactive_get\("healthRisk"\)\)/,
    );
  });
});
