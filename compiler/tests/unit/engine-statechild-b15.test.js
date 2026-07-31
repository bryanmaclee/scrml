/* SPDX-License-Identifier: MIT
 * Phase A1b Step B15 — Engine state-child exhaustiveness + rule= typer +
 * initial= validation tests.
 *
 * Walker: SYM PASS 11 (`walkValidateEngineStateChildrenAndRules` in
 * `compiler/src/symbol-table.ts`).
 *
 * Coverage (per BRIEF.md §"TEST EXPECTATIONS"):
 *   - State-child exhaustiveness (every variant has matching PascalCase tag).
 *   - Missing state-child fires E-ENGINE-STATE-CHILD-MISSING.
 *   - Unknown state-child tag fires E-ENGINE-STATE-CHILD-INVALID-VARIANT.
 *   - `initial=` absent fires W-ENGINE-INITIAL-MISSING (non-derived).
 *   - `initial=` invalid variant fires E-ENGINE-INITIAL-INVALID-VARIANT.
 *   - `rule=.X` valid: pass; `.UnknownVariant` fires E-ENGINE-RULE-INVALID-VARIANT.
 *   - `rule=(.A | .B)` multi-target: each member validated.
 *   - `rule=*` wildcard: pass.
 *   - `rule="event -> Variant"` legacy form fires E-ENGINE-RULE-LEGACY-SYNTAX.
 *   - Derived engine: B15 skips initial= validation.
 *   - engineMeta.variants populated from typeDecls.
 *   - engineMeta.stateChildren populated by parser.
 *   - Legacy `<engine>` arrow-rule body skipped (no diagnostics).
 *
 * Source-of-truth: SPEC §51.0.B / §51.0.E / §51.0.F + §34 catalog rows
 * added by this dispatch.
 *
 * **Surface-form note:** The block-splitter does NOT today create an
 * engine block when state-child bodies use `:`-shorthand (`<X rule=.Y> : "body"`).
 * Per §51.0.I (Move 15) `:`-shorthand IS canonical for state-children, but
 * parser support is pending. These tests use the explicit-closer form
 * (`<X rule=.Y></>`) which the parser does support today. When `:`-shorthand
 * parsing lands, additional tests can be added without changing PASS 11.
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import {
  parseEngineStateChildren,
  parseRuleAttrValue,
  isLegacyArrowRulesBody,
} from "../../src/engine-statechild-parser.ts";

// ---------------------------------------------------------------------------
// Helpers
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
// engine-statechild-parser unit tests
// ---------------------------------------------------------------------------

describe("B15 engine-statechild-parser — parseRuleAttrValue", () => {
  test("single-target `.NextVariant`", () => {
    expect(parseRuleAttrValue(".Big")).toEqual({ kind: "single", target: "Big" });
  });

  test("multi-target `(.A | .B | .C)`", () => {
    expect(parseRuleAttrValue("(.Fire | .Cape | .Small)")).toEqual({
      kind: "multi",
      targets: ["Fire", "Cape", "Small"],
    });
  });

  test("wildcard `*`", () => {
    expect(parseRuleAttrValue("*")).toEqual({ kind: "wildcard" });
  });

  test("legacy event-arrow `event -> Variant` recognized", () => {
    const r = parseRuleAttrValue("load -> Loading");
    expect(r.kind).toBe("legacy-arrow");
  });

  test("legacy event-arrow with `=>` form recognized", () => {
    const r = parseRuleAttrValue("event => Target");
    expect(r.kind).toBe("legacy-arrow");
  });

  test("bare PascalCase (no dot) accepted as single-target", () => {
    expect(parseRuleAttrValue("Big")).toEqual({ kind: "single", target: "Big" });
  });

  test("malformed garbage produces parse-error", () => {
    const r = parseRuleAttrValue("@@@");
    expect(r.kind).toBe("parse-error");
  });

  test("empty value produces parse-error", () => {
    const r = parseRuleAttrValue("");
    expect(r.kind).toBe("parse-error");
  });

  test("multi-target with one bad member produces parse-error", () => {
    const r = parseRuleAttrValue("(.A | not-a-variant)");
    expect(r.kind).toBe("parse-error");
  });
});

describe("B15 engine-statechild-parser — isLegacyArrowRulesBody", () => {
  test("legacy machine arrow-rule body detected", () => {
    expect(isLegacyArrowRulesBody(".Small => .Big\n.Big => .Small")).toBe(true);
  });

  test("new state-child body NOT detected as legacy", () => {
    const body = `<Small rule=.Big></>\n<Big rule=.Small></>`;
    expect(isLegacyArrowRulesBody(body)).toBe(false);
  });

  test("empty body returns false", () => {
    expect(isLegacyArrowRulesBody("")).toBe(false);
    expect(isLegacyArrowRulesBody("   ")).toBe(false);
  });
});

describe("B15 engine-statechild-parser — parseEngineStateChildren", () => {
  test("empty body returns empty array", () => {
    expect(parseEngineStateChildren("")).toEqual([]);
  });

  test("legacy arrow body returns empty array (skipped)", () => {
    expect(parseEngineStateChildren(".Small => .Big")).toEqual([]);
  });

  test("single state-child with single-target rule", () => {
    const body = `<Small rule=.Big></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe("Small");
    expect(out[0].rule).toEqual({ kind: "single", target: "Big" });
  });

  test("single state-child with `:`-shorthand rule (parser-only)", () => {
    // engine-statechild-parser handles `:`-shorthand even though BS
    // currently doesn't. This codifies the parser contract so when BS
    // gains support, tests against the parser already cover the shape.
    const body = `<Small rule=.Big> : "🧍"`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe("Small");
    expect(out[0].rule).toEqual({ kind: "single", target: "Big" });
  });

  test("multi-target rule extracted", () => {
    const body = `<Big rule=(.Fire | .Cape | .Small)></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe("Big");
    expect(out[0].rule).toEqual({ kind: "multi", targets: ["Fire", "Cape", "Small"] });
  });

  test("wildcard rule extracted", () => {
    const body = `<Free rule=*></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].rule).toEqual({ kind: "wildcard" });
  });

  test("absent rule = terminal state", () => {
    const body = `<Done></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].rule).toEqual({ kind: "absent" });
  });

  test("multiple state-children", () => {
    const body = `<Small rule=.Big></>
<Big rule=(.Fire | .Cape | .Small)></>
<Fire rule=.Small></>
<Cape rule=.Small></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(4);
    expect(out.map((sc) => sc.tag)).toEqual(["Small", "Big", "Fire", "Cape"]);
  });

  test("self-closing state-child", () => {
    const body = `<Idle rule=.Loading/>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe("Idle");
  });

  test("legacy event-arrow rule= flagged on parse", () => {
    const body = `<Loading rule="load -> Done"></>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(1);
    expect(out[0].rule.kind).toBe("legacy-arrow");
  });

  test("explicit closer `</Variant>` paired with opener", () => {
    const body = `<Idle rule=.Loading></Idle>
<Loading rule=.Done></Loading>`;
    const out = parseEngineStateChildren(body);
    expect(out.length).toBe(2);
    expect(out.map((sc) => sc.tag)).toEqual(["Idle", "Loading"]);
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — initial= validation
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — initial= validation per §51.0.E", () => {
  test("absent initial= on non-derived engine fires W-ENGINE-INITIAL-MISSING", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState>
  <Small rule=.Big></>
  <Big rule=.Small></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    const warns = errorsByCode(sym, "W-ENGINE-INITIAL-MISSING");
    expect(warns.length).toBe(1);
    expect(warns[0].severity).toBe("warning");
  });

  test("present-and-valid initial= produces NO diagnostic", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "W-ENGINE-INITIAL-MISSING").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-INITIAL-INVALID-VARIANT").length).toBe(0);
  });

  test("present-and-INVALID initial= fires E-ENGINE-INITIAL-INVALID-VARIANT", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Bogus>
  <Small rule=.Big></>
  <Big rule=.Small></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INITIAL-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain(".Bogus");
    expect(errs[0].message).toContain("MarioState");
  });

  test("legacy arrow-rule body with absent initial= still fires W-ENGINE-INITIAL-MISSING", () => {
    // Legacy bodies skip state-child validation but B15's initial= rule
    // applies regardless — it's defined by §51.0.E independent of body form.
    const src = `\${ type MarioState:enum = { Small, Big } }
<engine for=MarioState>
  .Small => .Big
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "W-ENGINE-INITIAL-MISSING").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — state-child exhaustiveness
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — state-child exhaustiveness", () => {
  test("all-variants-covered engine produces NO E-ENGINE-STATE-CHILD-MISSING", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-INVALID-VARIANT").length).toBe(0);
  });

  test("missing variant fires E-ENGINE-STATE-CHILD-MISSING", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING");
    // Two missing: Fire, Cape.
    expect(errs.length).toBe(2);
    const messages = errs.map((e) => e.message).join(" ");
    expect(messages).toContain(".Fire");
    expect(messages).toContain(".Cape");
  });

  test("unknown state-child tag fires E-ENGINE-STATE-CHILD-INVALID-VARIANT", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
  <UnknownTag rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-STATE-CHILD-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("UnknownTag");
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — rule= form + variant validation
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — rule= validation per §51.0.F", () => {
  test("single-target with valid variant: NO error", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-RULE-LEGACY-SYNTAX").length).toBe(0);
  });

  test("single-target with INVALID variant fires E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule=.NotAVariant></>
  <Loading rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain(".NotAVariant");
    expect(errs[0].message).toContain("Phase");
  });

  test("multi-target with all valid variants: NO error", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
  });

  test("multi-target with one INVALID member fires E-ENGINE-RULE-INVALID-VARIANT", () => {
    const src = `\${ type Phase:enum = { Idle, Loading, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Done | .Bogus)></>
  <Done rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain(".Bogus");
  });

  test("wildcard `rule=*` accepts: NO error", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule=*></>
  <Loading rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
  });

  test("absent rule= (terminal state): NO error", () => {
    const src = `\${ type Phase:enum = { Idle, Loading, Done } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
  });

  test("legacy event-arrow form fires E-ENGINE-RULE-LEGACY-SYNTAX", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule="load -> Loading"></>
  <Loading rule=.Idle></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-LEGACY-SYNTAX");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("load -> Loading");
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — engineMeta population (B15 contract)
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — engineMeta annotations", () => {
  test("engineMeta.variants populated from typeDecls", () => {
    const src = `\${ type MarioState:enum = { Small, Big, Fire, Cape } }
<engine for=MarioState initial=.Small>
  <Small rule=.Big></>
  <Big rule=(.Fire | .Cape | .Small)></>
  <Fire rule=.Small></>
  <Cape rule=.Small></>
</>`;
    const { ast } = runUpToSYM(src);
    const eng = findEngineDecl(ast);
    expect(eng).not.toBeNull();
    const meta = eng._record.engineMeta;
    expect(meta.variants).toEqual(["Small", "Big", "Fire", "Cape"]);
  });

  test("engineMeta.stateChildren populated by parser", () => {
    const src = `\${ type Phase:enum = { Idle, Loading } }
<engine for=Phase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Idle></>
</>`;
    const { ast } = runUpToSYM(src);
    const eng = findEngineDecl(ast);
    const meta = eng._record.engineMeta;
    expect(meta.stateChildren.length).toBe(2);
    expect(meta.stateChildren[0].tag).toBe("Idle");
    expect(meta.stateChildren[0].rule).toEqual({ kind: "single", target: "Loading" });
    expect(meta.stateChildren[1].tag).toBe("Loading");
    expect(meta.stateChildren[1].rule).toEqual({ kind: "single", target: "Idle" });
  });

  test("engineMeta.variants empty when type not in typeDecls", () => {
    const src = `<engine for=UnknownType initial=.Foo>
  <Foo rule=.Bar></>
  <Bar rule=.Foo></>
</>`;
    const { ast } = runUpToSYM(src);
    const eng = findEngineDecl(ast);
    const meta = eng._record.engineMeta;
    expect(meta.variants).toEqual([]);
    // Validation skipped because variants are unknown — neither
    // exhaustiveness nor invalid-variant fire.
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — derived-engine boundary with B16
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — derived-engine boundary", () => {
  test("derived engine SKIPS initial= validation", () => {
    // Legacy `derived=@source` form sets engineMeta.derivedExpr → non-null.
    // B15 must skip W-ENGINE-INITIAL-MISSING + E-ENGINE-INITIAL-INVALID-VARIANT
    // on derived engines (B16 owns derived-specific rejections).
    const src = `\${ type Phase:enum = { Idle, Loading } }
\${ type Source:enum = { A, B } }
\${ @sourceCell: Source = Source.A }
<engine for=Phase derived=@sourceCell>
  .A => .Idle
  .B => .Loading
</>`;
    const { sym } = runUpToSYM(src);
    // No W-ENGINE-INITIAL-MISSING for a derived engine.
    expect(errorsByCode(sym, "W-ENGINE-INITIAL-MISSING").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-INITIAL-INVALID-VARIANT").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PASS 11 — legacy machine arrow body on the <engine> keyword (6nz B2 reject)
// ---------------------------------------------------------------------------

describe("B15 PASS 11 — legacy arrow-rule bodies on the <engine> keyword", () => {
  test("legacy `.Small => .Big` whole-body on the <engine> keyword REJECTS via E-ENGINE-RULE-LEGACY-SYNTAX", () => {
    // 6nz B2 (2026-06-24) — the §51.0.C state-engine form (`<engine for=T
    // initial=...>`, no `name=`) does NOT admit a whole-body arrow grammar.
    // Pre-fix this silently half-compiled (transitions table, no §51.0.C cell
    // init) with ZERO diagnostic; now it fires E-ENGINE-RULE-LEGACY-SYNTAX. The
    // state-child exhaustiveness codes still do NOT fire (we early-return before
    // those checks — no state-children were parsed from the arrow body).
    const src = `\${ type MarioState:enum = { Small, Big } }
<engine for=MarioState initial=.Small>
  .Small => .Big
  .Big => .Small
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-INVALID-VARIANT").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
    // The whole-body arrow form is now an Error on the <engine> keyword.
    const legacy = errorsByCode(sym, "E-ENGINE-RULE-LEGACY-SYNTAX");
    expect(legacy.length).toBe(1);
    expect(legacy[0].severity).toBe("error");
  });

  test("legacy body still validates initial= (independent of body form)", () => {
    const src = `\${ type MarioState:enum = { Small, Big } }
<engine for=MarioState initial=.Bogus>
  .Small => .Big
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INITIAL-INVALID-VARIANT").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// S98 (anomaly-1) — comment + string skip regression.
//
// The bug: a `//` line comment containing a literal `${` inside an engine
// state-child body caused `findStateChildCloser` to enter a logic-context-
// skip routine that walked past the real `</>` closer in search of a matching
// `}` (which lived only in comment prose). The malformed depth tracking
// surfaced as `E-ENGINE-STATE-CHILD-MISSING` for the variants whose closers
// had been swallowed.
//
// Root-cause fix: `skipCommentOrString` + `computeCommentRegions` helpers in
// engine-statechild-parser.ts, called from every scanner that walks
// rulesRaw / bodyRaw looking for live syntax. Recognized regions:
//   - `//` line comments (skip through `\n`)
//   - `/_*_ ... _*_/` block comments (skip through closer)
//   - `"..."` / `'...'` strings (honors backslash escape)
//   - backtick template literals (interior `${...}` treated as opaque)
// ---------------------------------------------------------------------------

describe("S98 anomaly-1 — engine state-child comment + string skip", () => {
  // --- parser-level coverage --------------------------------------------

  test("`//` line comment with literal `${` is not a logic-context opener", () => {
    const rulesRaw = `
      <InCode rule=.InString>
        // body: handle \${ opening interpolation
      </>
      <InString rule=.InCode>
        // body: until closing quote
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  test("`//` comment with balanced `${expr}` — both closers still match", () => {
    const rulesRaw = `
      <InCode rule=.InString>
        // body: token-emitting rules; e.g., \${expr} in template literals
      </>
      <InString rule=.InCode>
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  test("block comment containing `${` does not derail parsing", () => {
    const rulesRaw = `
      <InCode rule=.InString>
        /* block comment with \${ inside */
      </>
      <InString rule=.InCode>
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  test("double-quoted string containing `${` literal", () => {
    const rulesRaw = `
      <InCode rule=.InString>
        // intro: "text with \${ literal"
      </>
      <InString rule=.InCode>
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  test("backtick template literal with `${interp}` is one opaque region", () => {
    const rulesRaw = `
      <InCode rule=.InString>
        // template \`with \${interp}\` text
      </>
      <InString rule=.InCode>
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  test("stray `<X>` inside a `//` line comment is not parsed as a state-child opener", () => {
    // Without the top-of-loop comment skip in parseEngineStateChildren, the
    // `<Fake>` inside the comment would be picked up as a third state-child
    // opener, requiring a closer that does not exist.
    const rulesRaw = `
      <InCode rule=.InString>
        // see also <Fake> tag in docs
      </>
      <InString rule=.InCode>
      </>
    `;
    const children = parseEngineStateChildren(rulesRaw);
    expect(children.map((c) => c.tag)).toEqual(["InCode", "InString"]);
  });

  // --- end-to-end SYM coverage ------------------------------------------

  test("M1.1 repro (line comment with literal `${`) compiles without engine diagnostics", () => {
    const source = `\${
  type LexMode:enum = { InCode, InString }
}

<engine for=LexMode initial=.InCode>
  <InCode rule=.InString>
    // body: handle \${ opening interpolation
  </>
  <InString rule=.InCode>
    // body: until closing quote
  </>
</>
`;
    const { sym } = runUpToSYM(source, "lex-mode.scrml");
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING")).toEqual([]);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-INVALID-VARIANT")).toEqual([]);
  });

  test("balanced-brace `${expr}` form in line comment also compiles cleanly", () => {
    const source = `\${
  type LexMode:enum = { InCode, InString }
}

<engine for=LexMode initial=.InCode>
  <InCode rule=.InString>
    // body: token-emitting rules; e.g., \${expr} in template literals
  </>
  <InString rule=.InCode>
    // body: until closing quote
  </>
</>
`;
    const { sym } = runUpToSYM(source, "lex-mode.scrml");
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING")).toEqual([]);
  });

  test("multi-variant engine with mixed comment shapes resolves to all variants", () => {
    const source = `\${
  type LexMode:enum = {
    InCode,
    InTemplateBody,
    InSingleString,
    InDoubleString,
  }
}

<engine for=LexMode initial=.InCode>
  <InCode rule=(.InTemplateBody | .InSingleString | .InDoubleString)>
    // line comment with \${ literal and <Fake> tag
  </>
  <InTemplateBody rule=.InCode>
    // handle \${...} interpolation
  </>
  <InSingleString rule=.InCode>
    // until closing 'quote
  </>
  <InDoubleString rule=.InCode>
    // until closing "quote
  </>
</>
`;
    const { sym } = runUpToSYM(source, "lex-mode.scrml");
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-MISSING")).toEqual([]);
    expect(errorsByCode(sym, "E-ENGINE-STATE-CHILD-INVALID-VARIANT")).toEqual([]);
  });
});
