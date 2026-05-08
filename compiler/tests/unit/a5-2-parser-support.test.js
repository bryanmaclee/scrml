/* SPDX-License-Identifier: MIT
 * Phase A7 Step A5-2 — parser support for §51.0.M-Q (S67 ratified extensions).
 *
 * Tests the AST-shape extensions produced by:
 *   - `compiler/src/engine-statechild-parser.ts` (state-child opener
 *     extensions: `historyAttr`, `internalRule`, `historyForm`/`historyForms`
 *     on EngineRuleForm; body-scan helpers `scanForOnTimeoutEntries` /
 *     `scanForNestedEngineEntries`)
 *
 * NOTE: §A5-2.4 (parallel bare attribute) and the §A5-2.8 PASS 10.A
 * flow-through test for parallelAttr were REMOVED 2026-05-08 alongside the
 * §51.0.P spec strike. See `docs/changes/parallel-close-2026-05-08/`.
 *
 * Coverage (per BRIEF §6.1):
 *   §A5-2.1  <onTimeout> element parsing
 *   §A5-2.2  history bare attribute
 *   §A5-2.3  internal:rule= prefix
 *   §A5-2.4  parallel bare attribute  [REMOVED 2026-05-08 — §51.0.P STRUCK]
 *   §A5-2.5  Nested <engine> recognition
 *   §A5-2.6  .Variant.history target form (rule=, internal:rule=, expression RHS)
 *   §A5-2.7  Composition (full state-child carrying all extensions)
 *   §A5-2.8  AST shape contract (entries populated correctly)
 *   §A5-2.9  Span integrity (rawOffset on body-scan entries)
 *   §A5-2.10 Negative cases — parse-error shapes (NOT hard-fail)
 *
 * Source-of-truth: SPEC §51.0.M-§51.0.Q + Phase 0 SURVEY decisions
 * (Option A on EngineRuleForm.historyForm; .Variant.history zero-source-
 * change in expression-parser; tokenizer/ast.ts/BS untouched).
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import {
  parseEngineStateChildren,
  parseRuleAttrValue,
  scanForOnTimeoutEntries,
  scanForNestedEngineEntries,
} from "../../src/engine-statechild-parser.ts";

// ---------------------------------------------------------------------------
// Helpers (mirror engine-statechild-b15 fixture style)
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

// ---------------------------------------------------------------------------
// §A5-2.1 — <onTimeout> element parsing (§51.0.M)
// ---------------------------------------------------------------------------

describe("§A5-2.1 — <onTimeout> element parsing (§51.0.M)", () => {
  test("self-closing <onTimeout/> with literal duration produces OnTimeoutEntry", () => {
    const body = `
      <onTimeout after=500ms to=.Done/>
    `;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("500ms");
    expect(entries[0].to).toBe("Done");
    expect(entries[0].rawOffset).toBeGreaterThanOrEqual(0);
  });

  test("computed ${expr}<unit> after= value captured raw", () => {
    const body = `<onTimeout after=\${@delay}s to=.Next/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("${@delay}s");
    expect(entries[0].to).toBe("Next");
  });

  test("multiple <onTimeout/> entries in one body", () => {
    const body = `
      <onTimeout after=100ms to=.A/>
      <onTimeout after=200ms to=.B/>
      <onTimeout after=300ms to=.C/>
    `;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.to)).toEqual(["A", "B", "C"]);
    expect(entries.map((e) => e.after)).toEqual(["100ms", "200ms", "300ms"]);
  });

  test("quoted attribute values are stripped", () => {
    const body = `<onTimeout after="500ms" to=".Done"/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("500ms");
    expect(entries[0].to).toBe("Done");
  });

  test("missing after= produces empty after string (parse-error shape — A5-3 surfaces)", () => {
    const body = `<onTimeout to=.Done/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("");
    expect(entries[0].to).toBe("Done");
  });

  test("missing to= produces empty to string", () => {
    const body = `<onTimeout after=500ms/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toBe("500ms");
    expect(entries[0].to).toBe("");
  });

  test("non-self-closing <onTimeout>...</onTimeout> NOT recognized (spec is self-closing only)", () => {
    const body = `<onTimeout>oops</onTimeout>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(0);
  });

  test("empty bodyRaw returns empty array", () => {
    expect(scanForOnTimeoutEntries("")).toEqual([]);
  });

  test("<onTimeout/> wired into EngineStateChildEntry.onTimeoutElements via parseEngineStateChildren", () => {
    const rulesRaw = `
      <Loading rule=.Done>
        <onTimeout after=500ms to=.Failed/>
      </Loading>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe("Loading");
    expect(entries[0].onTimeoutElements).toHaveLength(1);
    expect(entries[0].onTimeoutElements[0].to).toBe("Failed");
    expect(entries[0].onTimeoutElements[0].after).toBe("500ms");
  });

  test(":-shorthand state-child has no onTimeoutElements (single-expression body)", () => {
    const rulesRaw = `<Quick rule=.Done> : 42`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].isColonShorthand).toBe(true);
    expect(entries[0].onTimeoutElements).toEqual([]);
  });

  test("self-closing <Variant/> has no onTimeoutElements (empty body)", () => {
    const rulesRaw = `<Done rule=.Initial/>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].onTimeoutElements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.2 — history bare attribute (§51.0.N)
// ---------------------------------------------------------------------------

describe("§A5-2.2 — history bare attribute (§51.0.N)", () => {
  test("history bareword sets EngineStateChildEntry.historyAttr = true", () => {
    const rulesRaw = `<Composite history rule=.Other></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(true);
  });

  test("absent history bareword → historyAttr = false", () => {
    const rulesRaw = `<Variant rule=.Other></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(false);
  });

  test("history on multiple state-children, each independent", () => {
    const rulesRaw = `
      <A history rule=.B></>
      <B rule=.A></>
      <C history rule=.A></>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(3);
    expect(entries[0].historyAttr).toBe(true);
    expect(entries[1].historyAttr).toBe(false);
    expect(entries[2].historyAttr).toBe(true);
  });

  test("history composes with rule= and internal:rule=", () => {
    const rulesRaw = `<Composite history rule=.Other internal:rule=.Inner></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(true);
    expect(entries[0].rule.kind).toBe("single");
    expect(entries[0].rule.target).toBe("Other");
    expect(entries[0].internalRule.kind).toBe("single");
    expect(entries[0].internalRule.target).toBe("Inner");
  });

  test("hypothetical `history=...` attribute does NOT match the bareword", () => {
    // Negative-lookahead ensures we don't false-match `history=foo`.
    const rulesRaw = `<X history=foo rule=.A></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(false);
  });

  // S70 post-A5-3 regression: the naive `\bhistory\b(?!\s*=)` regex matched
  // `history` inside `rule=.Variant.history` (a SPEC §51.0.N target form),
  // mis-classifying the state-child as carrying the `history` bare attr.
  // Bug found via kitchen-sink probe — canonical SPEC §51.0.N example was
  // the trigger. Regex tightened to require standalone-token (preceded by
  // whitespace, followed by whitespace / `>` / `/` / end).
  test("REGRESSION (S70): rule=.Variant.history target form does NOT mis-set historyAttr", () => {
    const rulesRaw = `<Paused rule=.Playing.history></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe("Paused");
    expect(entries[0].historyAttr).toBe(false);
    // Verify the .history target form IS recognized on the rule itself.
    expect(entries[0].rule.kind).toBe("single");
    expect(entries[0].rule.target).toBe("Playing");
    expect(entries[0].rule.historyForm).toBe(true);
  });

  test("REGRESSION (S70): rule=(.A | .B.history) multi-target with .history mid-list does NOT mis-set historyAttr", () => {
    const rulesRaw = `<X rule=(.A | .B.history)></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(false);
  });

  test("REGRESSION (S70): canonical SPEC §51.0.N composite example parses correctly", () => {
    // The full shape from spec §51.0.N — composite Playing with inner engine,
    // Paused with .Playing.history target. The bug fix prevents Paused from
    // false-firing as historyAttr=true.
    const rulesRaw = `<Title rule=.Playing></>
<Playing history rule=(.Title | .Paused)>
  <engine for=PlayMode initial=.Exploring>
    <Exploring rule=.Battle></>
    <Battle rule=.Exploring></>
  </>
</>
<Paused rule=.Playing.history></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(3);
    const titleE = entries.find((e) => e.tag === "Title");
    const playingE = entries.find((e) => e.tag === "Playing");
    const pausedE = entries.find((e) => e.tag === "Paused");
    expect(titleE.historyAttr).toBe(false);
    expect(playingE.historyAttr).toBe(true);
    expect(playingE.innerEngines.length).toBe(1);
    expect(pausedE.historyAttr).toBe(false); // bug-fix anchor
    expect(pausedE.rule.historyForm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.3 — internal:rule= prefix (§51.0.O)
// ---------------------------------------------------------------------------

describe("§A5-2.3 — internal:rule= prefix (§51.0.O)", () => {
  test("internal:rule=.X parses to single-target form", () => {
    const rulesRaw = `<X internal:rule=.Y></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("single");
    expect(entries[0].internalRule.target).toBe("Y");
    expect(entries[0].rule.kind).toBe("absent");
  });

  test("internal:rule=(.A | .B) parses to multi-target form", () => {
    const rulesRaw = `<X internal:rule=(.A | .B | .C)></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("multi");
    expect(entries[0].internalRule.targets).toEqual(["A", "B", "C"]);
  });

  test("internal:rule=* parses to wildcard form", () => {
    const rulesRaw = `<X internal:rule=*></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("wildcard");
  });

  test("absent internal:rule= → kind: 'absent'", () => {
    const rulesRaw = `<X rule=.Y></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("absent");
  });

  test("internal:rule= and canonical rule= co-exist independently", () => {
    const rulesRaw = `<X rule=.Outer internal:rule=.Inner></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].rule.kind).toBe("single");
    expect(entries[0].rule.target).toBe("Outer");
    expect(entries[0].internalRule.kind).toBe("single");
    expect(entries[0].internalRule.target).toBe("Inner");
  });

  test("strip-and-rerun: canonical rule= regex does NOT swallow internal:rule= prefix", () => {
    // If the strip-and-rerun pattern fails, the canonical regex's lookahead
    // could match the `internal:` portion, leading to garbage in `rule.target`.
    const rulesRaw = `<X internal:rule=.A rule=.B></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.target).toBe("A");
    expect(entries[0].rule.target).toBe("B");
  });

  test("internal:rule= with .Variant.history target form", () => {
    const rulesRaw = `<X internal:rule=.Composite.history></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("single");
    expect(entries[0].internalRule.target).toBe("Composite");
    expect(entries[0].internalRule.historyForm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.4 — parallel bare attribute on file-scope <engine> (§51.0.P)
// REMOVED 2026-05-08: §51.0.P struck per parallel-disposition deep-dive.
// Recognition was retroactively closed; AST nodes no longer carry
// `parallelAttr`. The §51.4 multi-engine pattern (two file-scope `<engine>`
// declarations) IS the parallel pattern; orthogonality is documented with
// a comment when the author wants to flag intent.
// Regression coverage that catches accidental re-introduction lives in
// `compiler/tests/unit/parallel-close-regression.test.js`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §A5-2.5 — Nested <engine> recognition (§51.0.Q.1)
// ---------------------------------------------------------------------------

describe("§A5-2.5 — Nested <engine> recognition (§51.0.Q.1)", () => {
  test("nested <engine> in state-child body captured as NestedEngineEntry", () => {
    const body = `
      <engine for=Inner initial=.X>
        <X rule=.Y></>
        <Y rule=.X></>
      </>
    `;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].rawText).toContain("<engine for=Inner");
    expect(entries[0].rawText).toContain("</>");
    expect(entries[0].rawOffset).toBeGreaterThanOrEqual(0);
  });

  test("body with NO nested engine yields empty array", () => {
    const body = `<onTimeout after=500ms to=.X/>`;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toEqual([]);
  });

  test("self-closing <engine .../> is NOT a recognized nested-engine form", () => {
    const body = `<engine for=Inner/>`;
    const entries = scanForNestedEngineEntries(body);
    // Engines must contain state-children — self-close skipped.
    expect(entries).toHaveLength(0);
  });

  test("identifier-boundary check: <engineering> does NOT match <engine>", () => {
    const body = `<engineering for=foo></engineering>`;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toHaveLength(0);
  });

  test("multiple sibling nested engines captured independently", () => {
    const body = `
      <engine for=A initial=.X>
        <X rule=.Y></>
        <Y rule=.X></>
      </>
      <engine for=B initial=.X>
        <X rule=.Y></>
        <Y rule=.X></>
      </>
    `;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toHaveLength(2);
    expect(entries[0].rawText).toContain("for=A");
    expect(entries[1].rawText).toContain("for=B");
  });

  test("composite state-child marker: innerEngines.length > 0", () => {
    const rulesRaw = `
      <Composite rule=.Other>
        <engine for=Inner initial=.X>
          <X rule=.Y></>
          <Y rule=.X></>
        </>
      </Composite>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].innerEngines.length).toBe(1);
    expect(entries[0].innerEngines.length > 0).toBe(true);
  });

  test("non-composite state-child has empty innerEngines", () => {
    const rulesRaw = `<Simple rule=.Other></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].innerEngines).toEqual([]);
  });

  test("nested <engine> with </engine> explicit closer recognized", () => {
    const body = `<engine for=Inner initial=.X><X rule=.Y></></engine>`;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toHaveLength(1);
    expect(entries[0].rawText).toContain("</engine>");
  });

  test("<onTimeout> inside nested engine NOT mis-attributed to outer state-child", () => {
    // Phase 0 SURVEY §2 edge-case: skip-regions exclude nested-engine bodies
    // from the <onTimeout> scan.
    const rulesRaw = `
      <Outer rule=.Other>
        <onTimeout after=100ms to=.Other/>
        <engine for=Inner initial=.X>
          <X rule=.Y>
            <onTimeout after=999ms to=.Y/>
          </X>
          <Y rule=.X></>
        </>
      </Outer>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].onTimeoutElements).toHaveLength(1);
    expect(entries[0].onTimeoutElements[0].after).toBe("100ms");
    expect(entries[0].onTimeoutElements[0].to).toBe("Other");
    expect(entries[0].innerEngines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.6 — .Variant.history target form (§51.0.N)
// ---------------------------------------------------------------------------

describe("§A5-2.6 — .Variant.history target form (§51.0.N)", () => {
  test("parseRuleAttrValue('.X.history') → single with historyForm: true", () => {
    const form = parseRuleAttrValue(".Composite.history");
    expect(form.kind).toBe("single");
    expect(form.target).toBe("Composite");
    expect(form.historyForm).toBe(true);
  });

  test("parseRuleAttrValue('.X') → single without historyForm flag", () => {
    const form = parseRuleAttrValue(".Composite");
    expect(form.kind).toBe("single");
    expect(form.target).toBe("Composite");
    expect(form.historyForm).toBeUndefined();
  });

  test("parseRuleAttrValue('(.A.history | .B)') → multi with mixed historyForms", () => {
    const form = parseRuleAttrValue("(.A.history | .B)");
    expect(form.kind).toBe("multi");
    expect(form.targets).toEqual(["A", "B"]);
    expect(form.historyForms).toEqual([true, false]);
  });

  test("parseRuleAttrValue('(.A | .B)') → multi with NO historyForms (canonical shape)", () => {
    const form = parseRuleAttrValue("(.A | .B)");
    expect(form.kind).toBe("multi");
    expect(form.targets).toEqual(["A", "B"]);
    expect(form.historyForms).toBeUndefined();
  });

  test("parseRuleAttrValue('(.A.history | .B.history)') → multi with all-true historyForms", () => {
    const form = parseRuleAttrValue("(.A.history | .B.history)");
    expect(form.kind).toBe("multi");
    expect(form.targets).toEqual(["A", "B"]);
    expect(form.historyForms).toEqual([true, true]);
  });

  test("rule=.X.history flows through state-child parser", () => {
    const rulesRaw = `<X rule=.Composite.history></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].rule.kind).toBe("single");
    expect(entries[0].rule.target).toBe("Composite");
    expect(entries[0].rule.historyForm).toBe(true);
  });

  test("internal:rule=.X.history flows through state-child parser", () => {
    const rulesRaw = `<X internal:rule=.Composite.history></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("single");
    expect(entries[0].internalRule.target).toBe("Composite");
    expect(entries[0].internalRule.historyForm).toBe(true);
  });

  test("ANCHOR — .Variant.history in expression-RHS produces MemberExpr (zero-source-change BET)", () => {
    // Phase 0 SURVEY §3 zero-source-change verification anchor.
    // Verifies B20's bare-variant infrastructure naturally extends to
    // `.Playing.history` as MemberExpr(IdentExpr ".Playing", "history").
    const src = `<program>
\${
  <appMode> = .Idle
  effect ( ) => {
    appMode = .Playing.history
  }
}
type AppMode = Idle | Playing
</program>`;
    // Smoke test: this program's parse + SYM walk completes without
    // throwing AND produces a clean AST. Strict expression-shape inspection
    // belongs to A5-3 typer; A5-2 verifies the parse path is unbroken.
    const { ast, sym } = runUpToSYM(src);
    expect(ast).toBeDefined();
    expect(sym).toBeDefined();
    expect(sym.errors.filter((e) => e.severity === "error")).toEqual([]);
  });

  test("bare PascalCase form admits .history suffix for symmetry", () => {
    const form = parseRuleAttrValue("Composite.history");
    expect(form.kind).toBe("single");
    expect(form.target).toBe("Composite");
    expect(form.historyForm).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.7 — Composition (full state-child carrying all extensions)
// ---------------------------------------------------------------------------

describe("§A5-2.7 — Composition", () => {
  test("composite state-child: history + rule= + internal:rule= + nested <engine> + <onTimeout> siblings", () => {
    const rulesRaw = `
      <Composite history rule=.Other internal:rule=.Inner>
        <onTimeout after=500ms to=.Other/>
        <engine for=Inner initial=.A>
          <A rule=.B></>
          <B rule=.A></>
        </>
      </Composite>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    const sc = entries[0];
    expect(sc.tag).toBe("Composite");
    expect(sc.historyAttr).toBe(true);
    expect(sc.rule.kind).toBe("single");
    expect(sc.rule.target).toBe("Other");
    expect(sc.internalRule.kind).toBe("single");
    expect(sc.internalRule.target).toBe("Inner");
    expect(sc.onTimeoutElements).toHaveLength(1);
    expect(sc.onTimeoutElements[0].to).toBe("Other");
    expect(sc.innerEngines).toHaveLength(1);
    expect(sc.innerEngines[0].rawText).toContain("for=Inner");
  });

  test("composition does not mis-order — opener-attribute scan independent of body-scan", () => {
    // history bareword present → captured.
    // rule= present → captured.
    // internal:rule= present → captured.
    // body has BOTH <onTimeout> and nested <engine> → both captured.
    const rulesRaw = `
      <C history internal:rule=(.A | .B) rule=.D>
        <engine for=Sub initial=.X>
          <X rule=.Y></>
          <Y rule=.X></>
        </>
        <onTimeout after=1s to=.D/>
      </C>
    `;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    const sc = entries[0];
    expect(sc.historyAttr).toBe(true);
    expect(sc.rule.target).toBe("D");
    expect(sc.internalRule.kind).toBe("multi");
    expect(sc.internalRule.targets).toEqual(["A", "B"]);
    expect(sc.onTimeoutElements).toHaveLength(1);
    expect(sc.innerEngines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §A5-2.8 — AST shape contract (entries populated correctly)
// ---------------------------------------------------------------------------

describe("§A5-2.8 — AST shape contract", () => {
  test("EngineStateChildEntry has all 9 fields populated (5 pre-existing + 4 A5-2)", () => {
    const rulesRaw = `<X rule=.Y></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    const sc = entries[0];
    // Pre-existing fields.
    expect(typeof sc.tag).toBe("string");
    expect(typeof sc.rule).toBe("object");
    expect(typeof sc.bodyRaw).toBe("string");
    expect(typeof sc.isColonShorthand).toBe("boolean");
    expect(typeof sc.rawOffset).toBe("number");
    // A5-2 fields.
    expect(typeof sc.historyAttr).toBe("boolean");
    expect(typeof sc.internalRule).toBe("object");
    expect(Array.isArray(sc.onTimeoutElements)).toBe(true);
    expect(Array.isArray(sc.innerEngines)).toBe(true);
  });

  test("engineMeta.stateChildren flows through to PASS 11 — entries carry A5-2 fields", () => {
    const src = `<program>
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active history rule=.Idle internal:rule=.Sub>
    <onTimeout after=2s to=.Idle/>
  </Active>
</>
type AppMode = Idle | Active
</program>`;
    const { sym } = runUpToSYM(src);
    const rec = sym.fileScope.stateCells.get("appMode");
    expect(rec).toBeDefined();
    expect(rec.engineMeta.stateChildren).toBeDefined();
    expect(rec.engineMeta.stateChildren).toHaveLength(2);
    const active = rec.engineMeta.stateChildren.find((sc) => sc.tag === "Active");
    expect(active).toBeDefined();
    expect(active.historyAttr).toBe(true);
    expect(active.internalRule.kind).toBe("single");
    expect(active.internalRule.target).toBe("Sub");
    expect(active.onTimeoutElements).toHaveLength(1);
  });

  // The "engine-decl + engineMeta both carry parallelAttr" PASS 10.A
  // flow-through test was REMOVED 2026-05-08 alongside the §51.0.P spec
  // strike. See `compiler/tests/unit/parallel-close-regression.test.js` for
  // the asserts-the-recognition-is-gone counterpart.
});

// ---------------------------------------------------------------------------
// §A5-2.9 — Span integrity (rawOffset on body-scan entries)
// ---------------------------------------------------------------------------

describe("§A5-2.9 — Span integrity", () => {
  test("OnTimeoutEntry.rawOffset points to start of <onTimeout in bodyRaw", () => {
    const body = `   <onTimeout after=100ms to=.X/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(1);
    expect(body.slice(entries[0].rawOffset, entries[0].rawOffset + 10)).toBe("<onTimeout");
  });

  test("NestedEngineEntry.rawOffset points to start of <engine in bodyRaw", () => {
    const body = `   <engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    </>`;
    const entries = scanForNestedEngineEntries(body);
    expect(entries).toHaveLength(1);
    expect(body.slice(entries[0].rawOffset, entries[0].rawOffset + 7)).toBe("<engine");
  });

  test("multiple <onTimeout> entries have monotonically increasing rawOffsets", () => {
    const body = `<onTimeout after=1ms to=.A/> <onTimeout after=2ms to=.B/> <onTimeout after=3ms to=.C/>`;
    const entries = scanForOnTimeoutEntries(body);
    expect(entries).toHaveLength(3);
    expect(entries[0].rawOffset).toBeLessThan(entries[1].rawOffset);
    expect(entries[1].rawOffset).toBeLessThan(entries[2].rawOffset);
  });

  test("EngineStateChildEntry.rawOffset (pre-existing) preserved alongside A5-2 fields", () => {
    const rulesRaw = `   <X rule=.Y></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(rulesRaw.slice(entries[0].rawOffset, entries[0].rawOffset + 1)).toBe("<");
  });
});

// ---------------------------------------------------------------------------
// §A5-2.10 — Negative cases (parse-error shapes, NOT hard-fail)
// ---------------------------------------------------------------------------

describe("§A5-2.10 — Negative cases (parse-error shapes)", () => {
  test("malformed internal:rule= value produces parse-error shape (no throw)", () => {
    const rulesRaw = `<X internal:rule=garbage123></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    // `garbage123` doesn't match any §51.0.F form (lowercase first → parse-error).
    expect(entries[0].internalRule.kind).toBe("parse-error");
    expect(entries[0].internalRule.reason).toBeDefined();
  });

  test("empty internal:rule= value produces parse-error shape", () => {
    // Note: opener-attribute regex requires SOME value; truly-empty
    // internal:rule= is unlikely in practice but the value-parser handles it.
    const form = parseRuleAttrValue("");
    expect(form.kind).toBe("parse-error");
    expect(form.reason).toContain("empty");
  });

  test("malformed multi-target in internal:rule= produces parse-error", () => {
    const rulesRaw = `<X internal:rule=(.A | bogus)></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].internalRule.kind).toBe("parse-error");
  });

  test("missing closer on nested <engine> — body-scan skips, no throw", () => {
    const body = `<engine for=Sub initial=.X>
      <X rule=.Y></>
      <Y rule=.X></>
    `; // intentionally no closer
    const entries = scanForNestedEngineEntries(body);
    // Malformed → skipped (returns empty or partial list, never throws).
    expect(Array.isArray(entries)).toBe(true);
  });

  test("malformed <onTimeout (missing self-close) NOT recognized", () => {
    const body = `<onTimeout after=500ms to=.Done>`;
    const entries = scanForOnTimeoutEntries(body);
    // Spec is self-closing; non-self-close → not matched.
    expect(entries).toHaveLength(0);
  });

  test("rule= mixing invalid form yields parse-error (history-flag NOT spuriously set)", () => {
    const form = parseRuleAttrValue(".bogus.history");
    // Lowercase first char → not a valid variant identifier; parse-error.
    expect(form.kind).toBe("parse-error");
  });

  test("history bareword does NOT collide with `historyAttr=` hypothetical", () => {
    // Defensive — the bareword regex uses negative-lookahead `(?!\s*=)`.
    // (Already covered in §A5-2.2; reaffirmed here under negative cases.)
    const rulesRaw = `<X historyAttr=foo rule=.A></>`;
    const entries = parseEngineStateChildren(rulesRaw);
    expect(entries).toHaveLength(1);
    expect(entries[0].historyAttr).toBe(false);
  });
});
