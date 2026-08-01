/**
 * engine-arrow-body-legacy-reject-b2.test.js — 6nz B2 (2026-06-24).
 *
 * The §51.0.C STATE-engine form (`<engine for=T initial=...>`, NO `name=`)
 * MUST NOT carry a whole-body machine-style arrow-rule grammar (`.From => .To`).
 * Such a body has no PascalCase state-child opener, so the type-system used to
 * register it as a legacy MachineType and route to emit-machines.ts — emitting
 * the `__scrml_transitions_<var>` table but NEVER the §51.0.C cell init. The
 * governed cell stayed `undefined` at mount and any driven `<match on=@var>`
 * rendered empty, with ZERO diagnostic (a silent broken page).
 *
 * The fix fires E-ENGINE-RULE-LEGACY-SYNTAX (Error) at SYM PASS 11 (B15) for the
 * whole-body arrow form, steering the adopter to the canonical state-child
 * `rule=` shape. The fire is PRECISELY scoped to the `<engine>`-keyword
 * state-engine form:
 *   - `<engine>` keyword (legacy machine surface) is EXEMPT (W-DEPRECATED-001).
 *   - `<engine name=X for=T>` (§51.3.2 named-machine) is EXEMPT.
 *   - derived engines (§51.0.J / §51.9 projection bodies) are EXEMPT.
 *
 * Per SPEC §51.0.F + §51.3 + §34 row E-ENGINE-RULE-LEGACY-SYNTAX (two fire-sites).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

function runUpToSYM(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  const sym = runSYM({ filePath, ast });
  return { ast, sym };
}

function errorsByCode(errs, code) {
  return (errs || []).filter((e) => e.code === code);
}

const LEGACY = "E-ENGINE-RULE-LEGACY-SYNTAX";

describe("6nz B2 — whole-body arrow form on the <engine> state-engine keyword", () => {
  test("FIRES E-ENGINE-RULE-LEGACY-SYNTAX on `<engine for=T initial=.A>` with an arrow body", () => {
    const src = [
      "${ type Phase:enum = { A, B } }",
      "<engine for=Phase initial=.A>",
      "    .A => .B",
      "    .B => .A",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    const fired = errorsByCode(sym.errors, LEGACY);
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("error");
    // Message steers to the canonical state-child rule= form.
    expect(fired[0].message).toMatch(/whole-body/);
    expect(fired[0].message).toMatch(/state-child `rule=`|state-child.*rule=/);
    expect(fired[0].message).toMatch(/§51\.0\.F/);
  });

  test("does NOT fire when initial= is absent but the arrow body is present (still a state-engine, still rejected)", () => {
    // No `initial=` — still the `<engine>`-keyword state-engine form (no name=,
    // not derived). The whole-body arrow is still invalid here.
    const src = [
      "${ type Phase:enum = { A, B } }",
      "<engine for=Phase>",
      "    .A => .B",
      "    .B => .A",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym.errors, LEGACY).length).toBe(1);
  });

  test("does NOT fire on the canonical state-child `rule=` form", () => {
    const src = [
      "${ type Phase:enum = { A, B } }",
      "<engine for=Phase initial=.A>",
      "    <A rule=.B/>",
      "    <B rule=.A/>",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym.errors, LEGACY)).toEqual([]);
  });

  test("EXEMPT — `<engine name=X for=T>` named-machine arrow body (§51.3.2)", () => {
    const src = [
      "${ type Phase:enum = { A, B } }",
      "<engine name=PhaseMachine for=Phase>",
      "    .A => .B",
      "    .B => .A",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym.errors, LEGACY)).toEqual([]);
  });

  test("EXEMPT — legacy `<engine name=X for=T>` keyword arrow body", () => {
    const src = [
      "${ type Phase:enum = { A, B } }",
      "<engine name=PhaseMachine for=Phase>",
      "    .A => .B",
      "    .B => .A",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym.errors, LEGACY)).toEqual([]);
  });

  test("EXEMPT — derived engine (no name=, derived=@source) arrow projection body (§51.9)", () => {
    const src = [
      "${ type Phase:enum = { A, B } }",
      "${ type View:enum = { Showing, Hidden } }",
      "<engine for=Phase initial=.A>",
      "    <A rule=.B/>",
      "    <B rule=.A/>",
      "</>",
      "<engine for=View derived=@phase>",
      "    .A => .Showing",
      "    .B => .Hidden",
      "</>",
    ].join("\n");
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym.errors, LEGACY)).toEqual([]);
  });

  test("hadNameAttr discriminant — state-engine sets hadNameAttr false, named form true", () => {
    const stateEngine = runUpToSYM(
      "${ type Phase:enum = { A, B } }\n<engine for=Phase initial=.A>\n<A rule=.B/>\n<B rule=.A/>\n</>",
    );
    const named = runUpToSYM(
      "${ type Phase:enum = { A, B } }\n<engine name=PhaseMachine for=Phase>\n.A => .B\n.B => .A\n</>",
    );
    function firstEngine(ast) {
      let hit = null;
      function walk(n) {
        if (!n || hit) return;
        if (Array.isArray(n)) { for (const x of n) walk(x); return; }
        if (typeof n !== "object") return;
        if (n.kind === "engine-decl") { hit = n; return; }
        if (n.children) walk(n.children);
        if (n.body) walk(n.body);
      }
      walk(ast.nodes || []);
      return hit;
    }
    expect(firstEngine(stateEngine.ast).hadNameAttr).toBe(false);
    expect(firstEngine(named.ast).hadNameAttr).toBe(true);
  });
});
