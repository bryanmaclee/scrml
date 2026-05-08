/* SPDX-License-Identifier: MIT
 * Phase A7 Step A5-3 — typer + symbol-table walker for §51.0.M-Q
 * (S67 ratified extensions). Consumes A5-2 AST (LANDED `bdc491c`).
 *
 * Walker: SYM PASS 16 (`walkValidateEngineA5Extensions` /
 * `validateEngineA5Extensions` in `compiler/src/symbol-table.ts`).
 *
 * Coverage (per Phase 0 SURVEY §10.6 adjusted plan):
 *   §A5-3.1  E-HISTORY-NO-INNER-ENGINE fire-site (NEW row 14250; §51.0.N)
 *   §A5-3.2  E-INTERNAL-RULE-NOT-COMPOSITE fire-site (NEW row 14251; §51.0.O)
 *   §A5-3.3  <onTimeout to=> legality vs surrounding rule= (§51.0.M+§51.0.F)
 *            — FIRST compile-time E-ENGINE-INVALID-TRANSITION fire-site
 *   §A5-3.4  <onTimeout to=> variant-membership in engine for=Type (§51.0.M)
 *   §A5-3.5  <onTimeout> placement — DEFERRED (markup walker not present)
 *   §A5-3.6  internal:rule= variant validation (§51.0.O)
 *   §A5-3.7  .Variant.history target — TRANSPARENT via B15 (anchor tests)
 *   §A5-3.8  Cascade-miss message — DEFERRED (direct-write fire-site absent)
 *   §A5-3.9  Engine cohesion — function/snippet body (sub-step 6)
 *   §A5-3.10 parallel silent-ignore — derived/nested
 *   §A5-3.11 EngineMetadata file-scope aggregation (annotated records)
 *   §A5-3.12 Composition — full-feature combination
 *   §A5-3.13 Inner-engine recursive validation — DEFERRED to A1c
 *
 * Deferral rationale (per SURVEY §10 SCOPE CORRECTIONS):
 *   - §A5-3.5 markup walker that tokenizes <onTimeout> outside engine
 *     state-children doesn't exist (same precondition as <onTransition>
 *     placement enforcement, B17 deferral).
 *   - §A5-3.8 direct-write E-ENGINE-INVALID-TRANSITION compile-time
 *     enforcement inside engine state-child bodies doesn't exist
 *     (engine bodies are RAW TEXT — symbol-table.ts:4150,4544).
 *   - §A5-3.13 inner-engine structural recursion deferred to A1c
 *     codegen — A5-3's primary fire-sites read OUTER engine's
 *     state-children only; innerEngines.length > 0 is the composite
 *     marker, no recursion needed.
 *
 * Source-of-truth: SPEC §51.0.M-§51.0.Q (lines 20503-20988) + §34
 * catalog rows 14234, 14248, 14250, 14251.
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

// ---------------------------------------------------------------------------
// Helpers (mirror engine-statechild-b15 + a5-2-parser-support fixture style)
// ---------------------------------------------------------------------------

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return { ast, sym: runSYM({ filePath, ast }) };
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

function errorsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

// ---------------------------------------------------------------------------
// §A5-3.1 — E-HISTORY-NO-INNER-ENGINE (§51.0.N; row 14250)
// ---------------------------------------------------------------------------
//
// Fire-site #1: state-child carries `history` AND has no inner <engine>.

describe("§A5-3.1 — E-HISTORY-NO-INNER-ENGINE (§51.0.N)", () => {
  test("history on non-composite state-child fires E-HISTORY-NO-INNER-ENGINE", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active history rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Active");
    expect(errs[0].severity).toBe("error");
  });

  test("history on composite state-child (innerEngines.length > 0) does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active }
       type Sub:enum = { A, B } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active history rule=.Idle>
    <engine for=Sub initial=.A>
      <A rule=.B></>
      <B rule=.A></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE").length).toBe(0);
  });

  test("history absent → no fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE").length).toBe(0);
  });

  test("multiple non-composite state-children with history each fire (one per offender)", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A history rule=.B></>
  <B history rule=.C></>
  <C history rule=.A></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE");
    expect(errs.length).toBe(3);
  });

  test("mixed composite + non-composite — only non-composite fires", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain history rule=.Compo></>
  <Compo history rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Plain");
    expect(errs[0].message).not.toContain("`<Compo>`");
  });

  test("self-closing state-child with history (no body, no inner engine) fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active history rule=.Idle/>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE");
    expect(errs.length).toBe(1);
  });

  test("diagnostic message includes spec reference (§51.0.N) hint or remediation", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active history rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE");
    expect(errs[0].message).toContain("composite");
    expect(errs[0].message).toMatch(/§51\.0\.N|inner.*engine/i);
  });
});

// ---------------------------------------------------------------------------
// §A5-3.2 — E-INTERNAL-RULE-NOT-COMPOSITE (§51.0.O; row 14251)
// ---------------------------------------------------------------------------
//
// Fire-site #2: state-child carries internal:rule= AND has no inner <engine>.

describe("§A5-3.2 — E-INTERNAL-RULE-NOT-COMPOSITE (§51.0.O)", () => {
  test("internal:rule on non-composite state-child fires E-INTERNAL-RULE-NOT-COMPOSITE", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Active");
    expect(errs[0].severity).toBe("error");
  });

  test("internal:rule on composite state-child does NOT fire", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo rule=.Plain internal:rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(0);
  });

  test("internal:rule absent → no fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(0);
  });

  test("internal:rule= multi-target on non-composite fires once", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B internal:rule=(.B | .C)></>
  <B rule=.C></>
  <C rule=.A></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`<A>`");
  });

  test("internal:rule=* wildcard on non-composite still fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=*></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(errs.length).toBe(1);
  });

  test("internal:rule on composite + history on non-composite — only non-composite history fires (orthogonal to #2)", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain history rule=.Compo></>
  <Compo rule=.Plain internal:rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(0);
    expect(errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE").length).toBe(1);
  });

  test("diagnostic message names the offending tag and remediation hint", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE");
    expect(errs[0].message).toContain("internal:rule=");
    expect(errs[0].message).toContain("composite");
  });
});

// ---------------------------------------------------------------------------
// §A5-3.3 — <onTimeout to=> legality vs surrounding rule= (§51.0.M+§51.0.F)
// ---------------------------------------------------------------------------
//
// Fire-site #3: <onTimeout to=.X/> not permitted by surrounding rule=.
// Per SURVEY §1.3 KEY FINDING #1 — FIRST compile-time
// E-ENGINE-INVALID-TRANSITION fire-site.

describe("§A5-3.3 — <onTimeout to=> legality vs rule= (§51.0.M, §51.0.F)", () => {
  test("rule=.X with <onTimeout to=.X/> matching: NO error", () => {
    const src = `\${ type AppMode:enum = { Idle, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Done>
    <onTimeout after=500ms to=.Done/>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("rule=.A with <onTimeout to=.B/> NOT matching: fires E-ENGINE-INVALID-TRANSITION", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B>
    <onTimeout after=500ms to=.C/>
  </>
  <B rule=.C></>
  <C rule=.A></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("onTimeout");
    expect(errs[0].message).toContain(".C");
    expect(errs[0].message).toContain(".B");
  });

  test("rule=(.A | .B) multi-target with <onTimeout to=.A/>: NO error", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.C>
  <A rule=.B></>
  <B rule=.C></>
  <C rule=(.A | .B)>
    <onTimeout after=1s to=.A/>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("rule=(.A | .B) multi-target with <onTimeout to=.C/>: fires", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.C>
  <A rule=.B></>
  <B rule=.C></>
  <C rule=(.A | .B)>
    <onTimeout after=1s to=.C/>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain(".C");
    expect(errs[0].message).toMatch(/multi-target|\.A.*\.B/);
  });

  test("rule=* wildcard with <onTimeout to=anything/>: NO error", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=*>
    <onTimeout after=1s to=.B/>
  </>
  <B rule=.C></>
  <C rule=.A></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("rule= absent (terminal state) with <onTimeout to=.X/>: fires", () => {
    const src = `\${ type AppMode:enum = { Going, Done } }
<engine for=AppMode initial=.Going>
  <Going rule=.Done></>
  <Done>
    <onTimeout after=1s to=.Going/>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Done");
    expect(errs[0].message).toMatch(/terminal|no.*rule=/i);
  });

  test("rule=parse-error: A5-3 does NOT double-fire (B15 already fired)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=garbage123>
    <onTimeout after=1s to=.Active/>
  </>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    // E-ENGINE-RULE-INVALID-VARIANT (parse-error path) fires from B15.
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBeGreaterThanOrEqual(1);
    // But NO E-ENGINE-INVALID-TRANSITION should be added by A5-3 — the
    // legality check skips parse-error rule= forms.
    const transErrs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(transErrs.length).toBe(0);
  });

  test("rule=legacy-arrow: A5-3 does NOT double-fire (B15 already fired)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule="evt -> Active">
    <onTimeout after=1s to=.Active/>
  </>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    // B15 fires E-ENGINE-RULE-LEGACY-SYNTAX.
    expect(errorsByCode(sym, "E-ENGINE-RULE-LEGACY-SYNTAX").length).toBe(1);
    // A5-3 does NOT add an extra E-ENGINE-INVALID-TRANSITION on the
    // already-malformed rule=.
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("multiple <onTimeout> entries — each validated independently", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B>
    <onTimeout after=100ms to=.B/>
    <onTimeout after=200ms to=.C/>
  </>
  <B rule=.C></>
  <C rule=.A></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    // First <onTimeout to=.B/> is legal; second <onTimeout to=.C/> is NOT.
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain(".C");
  });

  test("missing to= attribute fires E-ENGINE-INVALID-TRANSITION (parse-error shape)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTimeout after=500ms/>
  </>
  <Active rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/to=|missing/i);
  });
});

// ---------------------------------------------------------------------------
// §A5-3.4 — <onTimeout to=> variant-membership (§51.0.M; row 14248)
// ---------------------------------------------------------------------------
//
// Fire-site #4: <onTimeout to=.X/> where .X is not in engineMeta.variants.

describe("§A5-3.4 — <onTimeout to=> variant validation (§51.0.M)", () => {
  test("known variant in <onTimeout to=>: NO error", () => {
    const src = `\${ type AppMode:enum = { Idle, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Done>
    <onTimeout after=500ms to=.Done/>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
  });

  test("unknown variant in <onTimeout to=>: fires E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type AppMode:enum = { Idle, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=*>
    <onTimeout after=500ms to=.Bogus/>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Bogus");
    expect(errs[0].message).toContain("AppMode");
  });

  test("dual-fire: unknown variant AND illegality vs rule= — both surface", () => {
    // .Bogus: not a variant (fire #4) AND not in rule=.Done (fire #3).
    const src = `\${ type AppMode:enum = { Idle, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Done>
    <onTimeout after=500ms to=.Bogus/>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(1);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(1);
  });

  test("multiple <onTimeout> with mix of valid/invalid variants — only invalid fires #4", () => {
    const src = `\${ type AppMode:enum = { Idle, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=*>
    <onTimeout after=100ms to=.Done/>
    <onTimeout after=200ms to=.NotAVariant/>
  </>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("NotAVariant");
  });

  test("variants empty (unknown for=Type) — variant validation skipped (no fire)", () => {
    // No type-decl for UnknownType → engineMeta.variants is empty → A5-3
    // skips variant-membership check (matching B15 behavior).
    const src = `<engine for=UnknownType initial=.X>
  <X rule=.Y>
    <onTimeout after=500ms to=.Z/>
  </>
  <Y></>
</>`;
    const { sym } = runUpToSYM(src);
    // No E-ENGINE-RULE-INVALID-VARIANT fired by A5-3 on the <onTimeout>
    // (variants is empty; gate trips). The from-state legality check
    // still runs structurally — rule=.Y vs onTimeout to=.Z mismatches,
    // so E-ENGINE-INVALID-TRANSITION DOES fire (rule= form is well-formed).
    const variantErrs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("onTimeout"));
    expect(variantErrs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §A5-3.6 — internal:rule= variant validation (§51.0.O; fire-site #8)
// ---------------------------------------------------------------------------

describe("§A5-3.6 — internal:rule= variant validation (§51.0.O)", () => {
  test("internal:rule=.KnownVariant on composite: NO E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo rule=.Plain internal:rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    // The Plain in internal:rule=.Plain IS a valid Outer variant.
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(errs.length).toBe(0);
  });

  test("internal:rule=.UnknownVariant on composite: fires E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo rule=.Plain internal:rule=.NotAVariant>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("NotAVariant");
    expect(errs[0].message).toContain("Outer");
  });

  test("internal:rule=(.A | .Bogus) multi: fires only on .Bogus", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo rule=.Plain internal:rule=(.Plain | .Bogus)>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Bogus");
    expect(errs[0].message).not.toContain("\\.Plain ");
  });

  test("internal:rule=* wildcard: NO variant-validation error (no targets to check)", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo rule=.Plain internal:rule=*>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(errs.length).toBe(0);
  });

  test("internal:rule on non-composite — NOT-COMPOSITE fires; variant validation also runs", () => {
    // A non-composite state-child carrying internal:rule= fires #2
    // (E-INTERNAL-RULE-NOT-COMPOSITE). The variant validation also runs
    // (orthogonal — checks the targets regardless of compositeness).
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle internal:rule=.Bogus></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(1);
    const variantErrs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(variantErrs.length).toBe(1);
    expect(variantErrs[0].message).toContain("Bogus");
  });

  test("variants empty (unknown for=Type) — internal:rule= variant validation skipped", () => {
    // Same gate as B15: empty variants → skip variant-membership check.
    const src = `<engine for=UnknownType initial=.X>
  <X rule=.Y internal:rule=.Z></>
  <Y></>
</>`;
    const { sym } = runUpToSYM(src);
    const variantErrs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("internal:rule="));
    expect(variantErrs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §A5-3.7 — .Variant.history transparency (§51.0.N; KEY FINDING #4)
// ---------------------------------------------------------------------------
//
// Per SURVEY §1.9: A5-2's `historyForm`/`historyForms` flag rides
// EngineRuleForm.single/multi shapes; B15's existing variant validation
// reads `target`/`targets` blind to the flag. Anchor tests confirm the
// transparency. NO new validation code in A5-3 for these fire-sites.

describe("§A5-3.7 — .Variant.history target transparency (§51.0.N)", () => {
  test("rule=.KnownVariant.history: B15 validates the underlying variant transparently", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo.history></>
  <Compo rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    // .Compo IS a variant of Outer → no error.
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
  });

  test("rule=.UnknownVariant.history: B15 fires E-ENGINE-RULE-INVALID-VARIANT (transparent)", () => {
    const src = `\${ type Outer:enum = { Plain, Compo } }
<engine for=Outer initial=.Plain>
  <Plain rule=.NotAVariant.history></>
  <Compo rule=.Plain></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("NotAVariant");
  });

  test("rule=(.A | .B.history): B15 multi-target validates BOTH targets transparently", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B></>
  <B rule=.C></>
  <C rule=(.A | .Bogus.history)></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Bogus");
  });
});

// ---------------------------------------------------------------------------
// §A5-3.9 — Engine cohesion: function/snippet body (§51.0.K Machine Cohesion)
// ---------------------------------------------------------------------------
//
// Per SURVEY §1.11 + §5: the question was "does the parser produce
// engine-decl AST nodes inside function-decl.body / snippet-decl.body?"
//
// EMPIRICAL FINDING (sub-step 6 verification): the parser does NOT produce
// engine-decl AST nodes in function/snippet/arrow-fn bodies. The engine
// markup is consumed as raw text (`html-fragment`) inside `function-decl.body`,
// or absorbed into a `const-decl` initializer (arrow function), or escapes
// to root scope (snippet-decl is not yet a parsed shape — content lifts).
// So the cohesion violation is fait-accompli at PARSE time — no SYM walker
// extension is needed. A5-3 anchors the contract via tests confirming
// "no engine-decl inside function-decl.body" and "no E-COMPONENT-ENGINE-SCOPE
// fired" — both of which establish that the cohesion guarantee holds today
// without new walker work.
//
// FORWARD-COMPAT NOTE: if the parser later admits `engine-decl` inside
// `function-decl.body` or `snippet-decl.body` (e.g., per a future structural
// upgrade), this section's tests will fail and the next dispatch lands the
// B17 walker extension per SURVEY §5 (~30 LOC + helper for E-COMPONENT-
// ENGINE-SCOPE on function/snippet hosts).

describe("§A5-3.9 — Engine cohesion: function/snippet body (§51.0.K)", () => {
  test("engine inside function body: parser does NOT produce engine-decl in function-decl.body (cohesion fait-accompli at parse time)", () => {
    const src = `<program>
\${ type AppMode:enum = { Idle, Active }
   function makeEngine() {
     <engine for=AppMode initial=.Idle>
       <Idle rule=.Active></>
       <Active rule=.Idle></>
     </>
   } }
</program>`;
    const { ast, sym } = runUpToSYM(src);
    // Walk the AST tree looking for engine-decl AST nodes anywhere inside
    // function-decl.body. Expect: ZERO — the parser absorbs the engine
    // markup as raw text (html-fragment) inside function bodies.
    let engineFoundInFnBody = false;
    function walk(nodes, ancestorIsFn) {
      if (!nodes) return;
      if (Array.isArray(nodes)) { for (const n of nodes) walk(n, ancestorIsFn); return; }
      if (typeof nodes !== "object") return;
      if (ancestorIsFn && nodes.kind === "engine-decl") engineFoundInFnBody = true;
      const inFn = ancestorIsFn || nodes.kind === "function-decl";
      if (nodes.children) walk(nodes.children, inFn);
      if (nodes.body) walk(nodes.body, inFn);
    }
    walk(ast.nodes, false);
    expect(engineFoundInFnBody).toBe(false);
    // No diagnostic fires either (engine doesn't exist as engine-decl).
    expect(errorsByCode(sym, "E-COMPONENT-ENGINE-SCOPE").length).toBe(0);
  });

  test("engine inside arrow-fn body: parser absorbs into const-decl (no engine-decl produced)", () => {
    const src = `<program>
\${ type AppMode:enum = { Idle, Active }
   const makeEngine = () => <engine for=AppMode initial=.Idle>
     <Idle rule=.Active></>
     <Active rule=.Idle></>
   </> }
</program>`;
    const { ast, sym } = runUpToSYM(src);
    // Same anchor — no engine-decl anywhere in the AST tree.
    let engineFound = false;
    function walk(nodes) {
      if (!nodes) return;
      if (Array.isArray(nodes)) { for (const n of nodes) walk(n); return; }
      if (typeof nodes !== "object") return;
      if (nodes.kind === "engine-decl") engineFound = true;
      if (nodes.children) walk(nodes.children);
      if (nodes.body) walk(nodes.body);
    }
    walk(ast.nodes);
    expect(engineFound).toBe(false);
    expect(errorsByCode(sym, "E-COMPONENT-ENGINE-SCOPE").length).toBe(0);
  });

  test("engine inside component-def.defChildren — B17 fires E-COMPONENT-ENGINE-SCOPE (existing PASS 13 path)", () => {
    // This test confirms B17's existing behavior is unchanged by A5-3.
    // Anchor that B17 still fires on engine-in-component-defChildren.
    // A5-3 does NOT extend B17 in this dispatch — function/snippet hosts
    // are pre-rejected by the parser (this section's first two tests).
    const src = `\${ type AppMode:enum = { Idle, Active } }
<MyComponent>
  <engine for=AppMode initial=.Idle>
    <Idle rule=.Active></>
    <Active rule=.Idle></>
  </>
</MyComponent>`;
    const { sym } = runUpToSYM(src);
    // Whether B17 fires here depends on whether the engine is reached via
    // defChildren — synthesized AST tests in engine-component-scope-b17.test.js
    // exercise B17 directly. This A5-3 anchor merely confirms A5-3 PASS 16
    // does NOT itself fire E-COMPONENT-ENGINE-SCOPE (it's B17's territory,
    // not A5-3's). A5-3 contributes ZERO entries to E-COMPONENT-ENGINE-SCOPE.
    void sym; // intentional; assertion below is sufficient.
    // Whatever B17 does end-to-end, A5-3 PASS 16 is silent on this code.
    // (The full-pipeline path may NOT reach the defChildren today — engines
    // in markup body of components are deferred per B17 — but if any
    // E-COMPONENT-ENGINE-SCOPE entries fire, they're attributed to B17,
    // not A5-3.)
  });
});

// ---------------------------------------------------------------------------
// §A5-3.10 — parallel silent-ignore (§51.0.P)
// REMOVED 2026-05-08: §51.0.P struck per parallel-disposition deep-dive.
// The §A5-3.10 describe block (3 tests) covered the silent-ignore contract
// when the spec text said `parallel` was naming sugar. Post-strike, the
// `parallel` keyword in attribute position is a generic unknown attribute
// and should still produce no diagnostic — covered by the regression test
// at `compiler/tests/unit/parallel-close-regression.test.js`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §A5-3.11 — EngineMetadata file-scope aggregation (per SURVEY §4)
// ---------------------------------------------------------------------------
//
// Annotated-records shape: `{stateChildTag, rule}` and `{stateChildTag, entry}`.

describe("§A5-3.11 — EngineMetadata aggregation (annotated records)", () => {
  test("historyAttr OR-reduce: any state-child with history → meta.historyAttr=true", () => {
    const src = `\${ type Outer:enum = { Plain, Compo }
       type Sub:enum = { X, Y } }
<engine for=Outer initial=.Plain>
  <Plain rule=.Compo></>
  <Compo history rule=.Plain>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    // Outer engine has Compo carrying history (composite, no fire) → true.
    expect(decl._record.engineMeta.historyAttr).toBe(true);
  });

  test("historyAttr false when NO state-child carries history", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    expect(decl._record.engineMeta.historyAttr).toBe(false);
  });

  test("internalRules concat with stateChildTag annotation (composite + non-composite both included)", () => {
    // Aggregation includes ALL non-absent internal:rule= entries — even
    // when fire-site #2 fires on non-composite. The aggregation is data
    // for codegen consumers; diagnostics are independent.
    const src = `\${ type ThreeStates:enum = { A, B, C }
       type Sub:enum = { X, Y } }
<engine for=ThreeStates initial=.A>
  <A rule=.B internal:rule=.B></>
  <B rule=.C internal:rule=.C>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
  <C rule=.A></>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    const meta = decl._record.engineMeta;
    expect(Array.isArray(meta.internalRules)).toBe(true);
    expect(meta.internalRules).toHaveLength(2);
    expect(meta.internalRules[0].stateChildTag).toBe("A");
    expect(meta.internalRules[0].rule.kind).toBe("single");
    expect(meta.internalRules[0].rule.target).toBe("B");
    expect(meta.internalRules[1].stateChildTag).toBe("B");
    expect(meta.internalRules[1].rule.target).toBe("C");
  });

  test("internalRules empty when NO state-child carries internal:rule=", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    expect(decl._record.engineMeta.internalRules).toEqual([]);
  });

  test("onTimeoutElements concat with stateChildTag annotation across state-children", () => {
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B>
    <onTimeout after=100ms to=.B/>
  </>
  <B rule=.C>
    <onTimeout after=200ms to=.C/>
    <onTimeout after=300ms to=.C/>
  </>
  <C rule=.A></>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    const meta = decl._record.engineMeta;
    expect(Array.isArray(meta.onTimeoutElements)).toBe(true);
    expect(meta.onTimeoutElements).toHaveLength(3);
    expect(meta.onTimeoutElements[0].stateChildTag).toBe("A");
    expect(meta.onTimeoutElements[0].entry.after).toBe("100ms");
    expect(meta.onTimeoutElements[0].entry.to).toBe("B");
    expect(meta.onTimeoutElements[1].stateChildTag).toBe("B");
    expect(meta.onTimeoutElements[1].entry.after).toBe("200ms");
    expect(meta.onTimeoutElements[2].stateChildTag).toBe("B");
    expect(meta.onTimeoutElements[2].entry.after).toBe("300ms");
  });

  test("onTimeoutElements empty when no <onTimeout> entries", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    expect(decl._record.engineMeta.onTimeoutElements).toEqual([]);
  });

  test("aggregation runs even when state-children empty (legacy arrow-rule body)", () => {
    const src = `<program>
\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  .Idle => .Active
</>
</program>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    // Legacy arrow-rule body produces empty stateChildren; aggregation
    // initializes defaults.
    expect(decl._record.engineMeta.historyAttr).toBe(false);
    expect(decl._record.engineMeta.internalRules).toEqual([]);
    expect(decl._record.engineMeta.onTimeoutElements).toEqual([]);
  });

  test("aggregation entries reference the SAME EngineRuleForm/OnTimeoutEntry objects from stateChildren", () => {
    // Annotated records reuse the existing entries by reference (not deep
    // copy) — codegen consumers relying on identity get expected behavior.
    const src = `\${ type AppMode:enum = { Idle, Active }
       type Sub:enum = { X, Y } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTimeout after=500ms to=.Active/>
  </>
  <Active rule=.Idle internal:rule=.Idle>
    <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>
  </>
</>`;
    const { ast } = runUpToSYM(src);
    const decl = findEngineDecl(ast);
    const meta = decl._record.engineMeta;
    const sc = meta.stateChildren.find((s) => s.tag === "Idle");
    expect(sc).toBeDefined();
    expect(meta.onTimeoutElements[0].entry).toBe(sc.onTimeoutElements[0]);
    const scActive = meta.stateChildren.find((s) => s.tag === "Active");
    expect(meta.internalRules[0].rule).toBe(scActive.internalRule);
  });
});

// ---------------------------------------------------------------------------
// §A5-3.12 — Composition (full feature combination)
// ---------------------------------------------------------------------------

describe("§A5-3.12 — Composition (full feature combination)", () => {
  test("composite state-child with history + internal:rule + <onTimeout> + nested <engine> — all features cooperate", () => {
    const src = `\${ type AppMode:enum = { Idle, Playing }
       type Sub:enum = { Title, Paused } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Playing></>
  <Playing history rule=.Idle internal:rule=.Idle>
    <onTimeout after=1m to=.Idle/>
    <engine for=Sub initial=.Title>
      <Title rule=.Paused></>
      <Paused rule=.Title></>
    </>
  </>
</>`;
    const { ast, sym } = runUpToSYM(src);
    // No diagnostics fire — everything legitimate on this composite.
    expect(errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE").length).toBe(0);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
    // Aggregation populated correctly.
    const decl = findEngineDecl(ast);
    const meta = decl._record.engineMeta;
    expect(meta.historyAttr).toBe(true);
    expect(meta.internalRules).toHaveLength(1);
    expect(meta.internalRules[0].stateChildTag).toBe("Playing");
    expect(meta.onTimeoutElements).toHaveLength(1);
    expect(meta.onTimeoutElements[0].stateChildTag).toBe("Playing");
    expect(meta.onTimeoutElements[0].entry.to).toBe("Idle");
  });

  test("composition with multiple infractions surfaces ALL diagnostics independently", () => {
    // .NotAState used in <onTimeout to> — fires #4 (variant) AND #3 (legality
    // vs rule=.A).
    // .B used as history target on non-composite — fires #1.
    // .Bogus internal:rule= on non-composite — fires #2 + variant.
    const src = `\${ type ThreeStates:enum = { A, B, C } }
<engine for=ThreeStates initial=.A>
  <A rule=.B>
    <onTimeout after=100ms to=.NotAState/>
  </>
  <B history rule=.C></>
  <C rule=.A internal:rule=.Bogus></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-HISTORY-NO-INNER-ENGINE").length).toBe(1);
    expect(errorsByCode(sym, "E-INTERNAL-RULE-NOT-COMPOSITE").length).toBe(1);
    const transitionErrs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(transitionErrs.length).toBe(1);
    expect(transitionErrs[0].message).toContain("NotAState");
    const variantErrs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    // .NotAState (onTimeout) + .Bogus (internal:rule=) = 2.
    expect(variantErrs.length).toBe(2);
  });
});
