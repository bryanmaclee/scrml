/**
 * S75 — TS state-child `rule=` recognition (modern engine form).
 *
 * Regression coverage for the §51.0 modern `<engine for=Type initial=.X>`
 * body: state-children carry `rule=` attributes (§51.0.B + §51.0.F) and B15
 * (SYM PASS 11) owns parsing/diagnostics. Before S75, the TS-stage
 * `parseMachineRules` (which only knows the legacy §51.3 / §51.9 arrow-rule
 * grammar) silently matched zero rules on a modern body and fired a
 * false-positive `E-ENGINE-005: Machine 'X' has no transition rules.`
 *
 * The fix (Option A, body-shape dispatch in `buildMachineRegistry`): when
 * the engine body contains a PascalCase state-child opener (`<Variant ...>`),
 * skip `parseMachineRules` and register a `MachineType` entry with empty
 * `rules` (modern engines emit codegen via `emit-engine.ts` from
 * `engineMeta.stateChildren`, so the empty registry entry is harmless).
 *
 * Coverage:
 *   1. Modern form — basic single-target `rule=.X` — no E-ENGINE-005.
 *   2. Modern form — multi-target `rule=(.A | .B)` — no E-ENGINE-005.
 *   3. Modern form with `<onTransition>` body (B17 family) — no E-ENGINE-005.
 *   4. Legacy `<machine name= for=>` over arrow body — still parses; E-ENGINE-005
 *      regression-guard for empty legacy bodies still fires.
 *   5. `<engine>` keyword over LEGACY arrow body — still parses (§51.3.2 P1
 *      amendment; body-shape, not keyword, dispatches).
 *   6. unit-level: buildMachineRegistry directly — modern bodies do NOT
 *      fire E-ENGINE-005 even with empty registry entry; legacy empty bodies
 *      DO fire E-ENGINE-005.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScrml } from "../../src/api.js";
import { buildMachineRegistry, buildTypeRegistry } from "../../src/type-system.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span() {
  return { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };
}

function makeTypeDecl(name, kind, raw) {
  return { kind: "type-decl", name, typeKind: kind, raw, span: span() };
}

function makeEngineDecl(engineName, governedType, rulesRaw) {
  return { kind: "engine-decl", engineName, governedType, rulesRaw, span: span() };
}

function runCompile(source, basename = "test") {
  const dir = mkdtempSync(join(tmpdir(), "scrml-modern-engine-"));
  const file = join(dir, `${basename}.scrml`);
  writeFileSync(file, source, "utf8");
  try {
    const result = compileScrml({
      inputFiles: [file],
      outputDir: join(dir, "dist"),
      write: false,
      mode: "library",
    });
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function errorsByCode(errors, code) {
  return errors.filter((e) => e.code === code);
}

// ---------------------------------------------------------------------------
// End-to-end: modern engine form compiles cleanly through TS
// ---------------------------------------------------------------------------

describe("S75 §51.0 modern <engine> form — no false-positive E-ENGINE-005", () => {
  test("basic single-target rule= — compiles without E-ENGINE-005", () => {
    const source = `
\${ type Phase:enum = { Idle, Loading, Done } }

<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done rule=.Idle></>
</>
`;
    const { errors } = runCompile(source, "modern-basic");
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
  });

  test("multi-target rule=(.A | .B) — compiles without E-ENGINE-005", () => {
    const source = `
\${ type FetchPhase:enum = { Idle, Loading, Success, Error } }

<engine for=FetchPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Success | .Error)></>
  <Success rule=.Idle></>
  <Error rule=.Idle></>
</>
`;
    const { errors } = runCompile(source, "modern-multi-target");
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
  });

  test("modern form with <onTransition> hooks (§51.0.H, B17.x family) — no E-ENGINE-005", () => {
    const source = `
\${
  type FetchPhase:enum = { Idle, Loading, Success, Error }
  function logSuccess() {}
  function logError() {}
}

<engine for=FetchPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Success | .Error)>
    <onTransition to=.Success>\${ logSuccess() }</>
    <onTransition to=.Error>\${ logError() }</>
  </>
  <Success rule=.Idle></>
  <Error rule=.Idle></>
</>
`;
    const { errors } = runCompile(source, "modern-effects");
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression-guard: legacy form still parses; E-ENGINE-005 still fires for
// genuinely-empty legacy bodies
// ---------------------------------------------------------------------------

describe("S75 regression-guard: legacy <machine> + <engine>-keyword-over-legacy-body", () => {
  test("legacy <machine name= for=> with arrow rules still parses cleanly", () => {
    const source = `
\${ type Phase:enum = { Idle, Loading, Done } }

< machine name=PhaseM for=Phase >
.Idle => .Loading
.Loading => .Done
.Done => .Idle
</>
`;
    const { errors } = runCompile(source, "legacy-machine");
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
  });

  test("<engine> keyword over LEGACY arrow body still parses (§51.3.2 P1; body-shape dispatches)", () => {
    const source = `
\${ type Phase:enum = { Idle, Loading, Done } }

< engine name=PhaseE for=Phase>
.Idle => .Loading
.Loading => .Done
.Done => .Idle
</>
`;
    const { errors } = runCompile(source, "engine-over-legacy");
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit-level: buildMachineRegistry behavior on modern vs legacy bodies
// ---------------------------------------------------------------------------

describe("S75 buildMachineRegistry — body-shape dispatch", () => {
  test("modern body (state-child openers) — registers with empty rules, no E-ENGINE-005", () => {
    const typeDecls = [makeTypeDecl("Phase", "enum", "{ Idle\nLoading\nDone }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const rulesRaw = [
      "<Idle rule=.Loading></>",
      "<Loading rule=.Done></>",
      "<Done rule=.Idle></>",
    ].join("\n");
    const machines = [makeEngineDecl("PhaseEngine", "Phase", rulesRaw)];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    // No E-ENGINE-005 for modern body.
    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
    // Registry entry exists (so downstream consumers — e.g. machineBinding
    // resolution on `@var: PhaseEngine` annotations — still find the machine).
    const machine = registry.get("PhaseEngine");
    expect(machine).toBeDefined();
    expect(machine.kind).toBe("machine");
    expect(machine.governedTypeName).toBe("Phase");
    // Rules array is empty for modern bodies — emit-engine.ts owns the codegen
    // path keyed on engineMeta.stateChildren (populated by SYM B15).
    expect(machine.rules).toEqual([]);
  });

  test("legacy body — empty rulesRaw still fires E-ENGINE-005 (regression-guard)", () => {
    const typeDecls = [makeTypeDecl("Phase", "enum", "{ Idle\nLoading }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeEngineDecl("Empty", "Phase", "")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());

    // Empty body has no state-child openers → legacy dispatch → E-ENGINE-005.
    const e005 = errorsByCode(errors, "E-ENGINE-005");
    expect(e005.length).toBeGreaterThanOrEqual(1);
    expect(e005[0].message).toContain("Empty");
  });

  test("legacy body — comment-only body still fires E-ENGINE-005 (regression-guard)", () => {
    const typeDecls = [makeTypeDecl("Phase", "enum", "{ Idle\nLoading }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeEngineDecl("CommentOnly", "Phase", "// just a comment\n// another")];
    const errors = [];
    buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errorsByCode(errors, "E-ENGINE-005").length).toBeGreaterThanOrEqual(1);
  });

  test("legacy body — arrow rules still parse correctly into MachineType.rules", () => {
    const typeDecls = [makeTypeDecl("Phase", "enum", "{ Idle\nLoading\nDone }")];
    const typeRegistry = buildTypeRegistry(typeDecls, [], span());
    const machines = [makeEngineDecl("ArrowM", "Phase", ".Idle => .Loading\n.Loading => .Done")];
    const errors = [];
    const registry = buildMachineRegistry(machines, typeRegistry, errors, span());

    expect(errorsByCode(errors, "E-ENGINE-005")).toEqual([]);
    expect(registry.get("ArrowM").rules).toHaveLength(2);
    expect(registry.get("ArrowM").rules[0].from).toBe("Idle");
    expect(registry.get("ArrowM").rules[0].to).toBe("Loading");
  });
});
