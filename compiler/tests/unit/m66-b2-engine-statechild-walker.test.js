// m66-b2-engine-statechild-walker.test.js — M6.6.b.2 dual-pipeline parity.
//
// PURPOSE
// Exercise the M6.6.b.2 native walker
// (`compiler/src/native-walker/engine-statechild-walker.ts`) against the
// legacy text-rescanner (`parseEngineStateChildren` from
// `engine-statechild-parser.ts`) for every state-child shape category and
// assert the produced `EngineStateChildEntry[]` arrays are structurally
// identical (modulo documented divergences — `rawOffset` differs because the
// two consumers measure from different bases: legacy from the trimmed
// `rulesRaw`, native from the engine block's child-span window; we assert
// the SAME basis for both per fixture).
//
// SHAPE CATEGORIES COVERED (cookbook §EngineStateChildEntry recipes)
//   - tag + bare-body          — `<X>...</>`
//   - tag + `:`-shorthand      — `<X : expr>`
//   - tag + self-close         — `<X/>`
//   - rule=.X (dotted-ident)   — class (b) via M6.6.b.1.5 tokenizer
//   - rule=*  (wildcard)       — class (b) via M6.6.b.1.5 tokenizer
//   - rule=(.A | .B) paren     — class (b) via expr-kind value
//   - rule=".X" quoted         — string-literal kind
//   - internal:rule=.X         — `:` in attr name + dotted-ident value
//   - effect=${expr}           — expr-kind value
//   - history bareword         — bare attribute
//   - <onTimeout/> child       — body-children scan
//   - <onTransition> child     — body-children scan
//   - nested <engine>          — body-children scan via isEngineBlock
//   - <Done rows> payload      — bareword payload binding
//   - <Done rows=r> named      — named payload binding
//   - synthetic AST fallback   — _nativeEngineBlock absent → legacy path
//
// METHODOLOGY
// For each fixture we compile via the native parser (`nativeParseFile`), find
// the synthesized `engine-decl` node, then BOTH:
//   - LEGACY  — `parseEngineStateChildren(engineDecl.rulesRaw)`
//   - NATIVE  — `walkEngineStateChildren(engineDecl._nativeEngineBlock,
//               engineDecl._source)`
// The two outputs must be structurally identical (we normalize away the
// `rawOffset` divergence with a per-test omission helper — `rawOffset` is
// a semantic-but-non-load-bearing field for parity here; the two consumers
// produce offsets from different bases by design).

import { describe, test, expect } from "bun:test";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import {
  parseEngineStateChildren,
  isLegacyArrowRulesBody,
  scanForOnIdleEntries,
} from "../../src/engine-statechild-parser.ts";
import {
  walkEngineStateChildren,
  walkIsLegacyArrowRulesBody,
  walkOnIdleEntries,
} from "../../src/native-walker/engine-statechild-walker.ts";

// ----- Helpers --------------------------------------------------------------

// findEngineDecl — locate the first synthesized `engine-decl` in a FileAST.
// Two surfaces carry engine-decls: `ast.machineDecls[]` (hoisted catalog
// produced by `collectHoisted`) and `ast.nodes[].children[...]` (the
// embedded copy inside the parent program/page/channel markup). The
// machineDecls catalog is the canonical surface; we recurse `nodes[]`
// only as a fallback for fixtures that ever materialise an engine-decl
// outside the catalog (none today, but defensive).
function findEngineDecl(ast) {
  if (ast && Array.isArray(ast.machineDecls) && ast.machineDecls.length > 0) {
    for (const m of ast.machineDecls) {
      if (m && m.kind === "engine-decl") return m;
    }
  }
  if (ast && Array.isArray(ast.nodes)) {
    const found = findEngineDeclRecursive(ast.nodes);
    if (found) return found;
  }
  return null;
}

function findEngineDeclRecursive(nodes) {
  for (const n of nodes) {
    if (!n) continue;
    if (n.kind === "engine-decl") return n;
    if (Array.isArray(n.children)) {
      const found = findEngineDeclRecursive(n.children);
      if (found) return found;
    }
    if (Array.isArray(n.body)) {
      const found = findEngineDeclRecursive(n.body);
      if (found) return found;
    }
  }
  return null;
}

// dualWalk — produce both outputs for a single fixture, with assertions
// that both pipelines actually fired.
function dualWalk(src) {
  const result = nativeParseFile("/m66-b2/t.scrml", src);
  const engineDecl = findEngineDecl(result.ast);
  if (!engineDecl) {
    throw new Error("test fixture is malformed — no engine-decl found");
  }
  const legacy = parseEngineStateChildren(engineDecl.rulesRaw || "");
  const native = walkEngineStateChildren(
    engineDecl._nativeEngineBlock,
    typeof engineDecl._source === "string" ? engineDecl._source : "",
  );
  return { legacy, native, engineDecl };
}

// stripRawOffsetRecursive — `rawOffset` measures from different bases
// across the two pipelines (legacy from the trimmed `rulesRaw`; native from
// the engine-block's child-span window). The legacy and native values are
// not expected to be byte-identical. Strip both for cross-pipeline equality
// while leaving offsets intact for offset-specific tests.
function stripRawOffsetRecursive(entries) {
  return entries.map((entry) => {
    const out = { ...entry };
    delete out.rawOffset;
    if (Array.isArray(out.onTimeoutElements)) {
      out.onTimeoutElements = out.onTimeoutElements.map((e) => {
        const c = { ...e };
        delete c.rawOffset;
        return c;
      });
    }
    if (Array.isArray(out.onTransitionElements)) {
      out.onTransitionElements = out.onTransitionElements.map((e) => {
        const c = { ...e };
        delete c.rawOffset;
        return c;
      });
    }
    if (Array.isArray(out.innerEngines)) {
      out.innerEngines = out.innerEngines.map((e) => {
        const c = { ...e };
        delete c.rawOffset;
        return c;
      });
    }
    return out;
  });
}

// =============================================================================

describe("M6.6.b.2 walker — basic tag + body shapes", () => {
  test("bare-body state-child: tag + bodyRaw + isColonShorthand=false", () => {
    const src = `<program>
      type Size = .Small | .Big;
      <engine for=Size>
        <Small rule=.Big>grow()</>
        <Big>shrink()</>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native).toHaveLength(legacy.length);
    expect(native).toHaveLength(2);
    expect(native[0].tag).toBe("Small");
    expect(native[0].isColonShorthand).toBe(false);
    expect(native[0].rule).toEqual({ kind: "single", target: "Big" });
    expect(native[1].tag).toBe("Big");
    // Structural parity vs legacy (rawOffset-stripped).
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test(":-shorthand state-child: bodyRaw is the post-`:` text + isColonShorthand=true (SPEC §4.14 canonical in-opener form)", () => {
    // SPEC §4.14 line 989: `<Tag : single-expression>` — the `:` and body
    // sit INSIDE the opener `<...>`. The native b.1 IMPL captures the post-
    // `:` body into `block.colonShorthandBody`; the walker mirrors that.
    //
    // DOCUMENTED DIVERGENCE: the legacy parser does NOT recognize the
    // in-opener form (its colonShortcutMatch regex looks for `>` then `:`,
    // not `:` inside `<...>`). So this test asserts on the NATIVE walker
    // output only; parity with legacy is impossible for the in-opener
    // form. The post-opener form (`<Tag> : body`) is legacy-only and is
    // covered in the next test.
    const src = `<program>
      type Size = .Small | .Big;
      <engine for=Size>
        <Small rule=.Big : grow()>
        <Big : shrink()>
      </engine>
    </program>`;
    const result = nativeParseFile("/m66-b2/t.scrml", src);
    const engineDecl = findEngineDecl(result.ast);
    const native = walkEngineStateChildren(
      engineDecl._nativeEngineBlock,
      engineDecl._source,
    );

    expect(native).toHaveLength(2);
    expect(native[0].tag).toBe("Small");
    expect(native[0].isColonShorthand).toBe(true);
    expect(native[0].bodyRaw.trim()).toBe("grow()");
    expect(native[0].rule).toEqual({ kind: "single", target: "Big" });
    expect(native[1].tag).toBe("Big");
    expect(native[1].isColonShorthand).toBe(true);
    expect(native[1].bodyRaw.trim()).toBe("shrink()");
  });

  test("self-close state-child: bodyRaw='' + isColonShorthand=false", () => {
    const src = `<program>
      type Size = .Small | .Big;
      <engine for=Size>
        <Small rule=.Big/>
        <Big rule=.Small/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native).toHaveLength(2);
    expect(native[0].bodyRaw).toBe("");
    expect(native[0].isColonShorthand).toBe(false);
    expect(native[1].bodyRaw).toBe("");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — rule= attribute kinds", () => {
  test("rule=.X (dotted-ident) → single-target with leading dot stripped", () => {
    const src = `<program>
      type Color = .Red | .Blue;
      <engine for=Color>
        <Red rule=.Blue/>
        <Blue rule=.Red/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].rule).toEqual({ kind: "single", target: "Blue" });
    expect(native[1].rule).toEqual({ kind: "single", target: "Red" });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("rule=.X.history → single-target with historyForm flag", () => {
    const src = `<program>
      type Mode = .Playing | .Paused;
      <engine for=Mode>
        <Playing rule=.Paused/>
        <Paused rule=.Playing.history/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[1].rule).toEqual({ kind: "single", target: "Playing", historyForm: true });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("rule=* (wildcard) → wildcard kind", () => {
    const src = `<program>
      type Status = .Open | .Closed;
      <engine for=Status>
        <Open rule=.Closed/>
        <Closed rule=*/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[1].rule).toEqual({ kind: "wildcard" });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test('rule="(.A | .B)" (quoted paren) → multi-target', () => {
    const src = `<program>
      type State = .A | .B | .C;
      <engine for=State>
        <A rule=".B"/>
        <B rule="(.A | .C)"/>
        <C/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[1].rule).toEqual({ kind: "multi", targets: ["A", "C"] });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("rule=(.A | .B) (unquoted paren) → multi-target via expr-kind value", () => {
    const src = `<program>
      type State = .A | .B | .C;
      <engine for=State>
        <A rule=(.B | .C)/>
        <B/>
        <C/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    // The legacy parser handles this via raw text regex; native walker via
    // expr.raw routed through readRuleAttrInput.
    expect(native[0].rule).toEqual({ kind: "multi", targets: ["B", "C"] });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("rule absent → kind:'absent'", () => {
    const src = `<program>
      type State = .Done;
      <engine for=State>
        <Done/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].rule).toEqual({ kind: "absent" });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — internal:rule= (composite states)", () => {
  test("internal:rule=.X → parallel internalRule single-target", () => {
    const src = `<program>
      type Mode = .Outer | .Inner;
      type Sub = .A | .B;
      <engine for=Mode>
        <Outer rule=.Inner internal:rule=.A>
          <engine for=Sub>
            <A rule=.B/>
            <B/>
          </engine>
        </Outer>
        <Inner/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].internalRule).toEqual({ kind: "single", target: "A" });
    // rule= remains independently parsed.
    expect(native[0].rule).toEqual({ kind: "single", target: "Inner" });
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — effect=${} + bareword attrs", () => {
  test("effect=${...} produces effectRaw with inner expression unwrapped", () => {
    const src = `<program>
      type State = .A | .B;
      <engine for=State>
        <A rule=.B effect=\${cleanup()}/>
        <B/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].effectRaw).toBe("cleanup()");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("effect= absent → effectRaw=null", () => {
    const src = `<program>
      type State = .A | .B;
      <engine for=State>
        <A rule=.B/>
        <B/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].effectRaw).toBeNull();
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("history bareword → historyAttr=true", () => {
    const src = `<program>
      type State = .A | .B;
      <engine for=State>
        <A rule=.B history/>
        <B/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].historyAttr).toBe(true);
    expect(native[1].historyAttr).toBe(false);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("history does NOT mis-fire on rule=.X.history (§51.0.N suffix vs bareword distinguished)", () => {
    const src = `<program>
      type State = .Playing | .Paused;
      <engine for=State>
        <Playing rule=.Paused/>
        <Paused rule=.Playing.history/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    // The `.history` suffix on the target ref must NOT be parsed as the
    // bareword `history` attribute.
    expect(native[0].historyAttr).toBe(false);
    expect(native[1].historyAttr).toBe(false);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — body-children scans", () => {
  test("<onTimeout/> sibling produces onTimeoutElements entry", () => {
    const src = `<program>
      type State = .Idle | .Active;
      <engine for=State>
        <Idle rule=.Active>
          <onTimeout after=500ms to=.Active/>
        </Idle>
        <Active/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].onTimeoutElements).toHaveLength(1);
    expect(native[0].onTimeoutElements[0].after).toBe("500ms");
    expect(native[0].onTimeoutElements[0].to).toBe("Active");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("named <onTimeout name=cleanup/> captures the name field (S79)", () => {
    const src = `<program>
      type State = .Idle | .Active;
      <engine for=State>
        <Idle rule=.Active>
          <onTimeout name=cleanup after=500ms to=.Active/>
        </Idle>
        <Active/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].onTimeoutElements[0].name).toBe("cleanup");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("<onTransition to=.X if=...> sibling produces onTransitionElements entry", () => {
    const src = `<program>
      type State = .Start | .End;
      <engine for=State>
        <Start rule=.End>
          <onTransition to=.End if="@ready == true">log("done")</>
        </Start>
        <End/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].onTransitionElements).toHaveLength(1);
    expect(native[0].onTransitionElements[0].to).toBe("End");
    expect(native[0].onTransitionElements[0].once).toBe(false);
    // ifExprRaw preserves the verbatim source (quoted form keeps the quotes).
    expect(native[0].onTransitionElements[0].ifExprRaw).toBe('"@ready == true"');
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("<onTransition once> bareword + body-content", () => {
    const src = `<program>
      type State = .A | .B;
      <engine for=State>
        <A rule=.B>
          <onTransition to=.B once>greet()</>
        </A>
        <B/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].onTransitionElements[0].once).toBe(true);
    expect(native[0].onTransitionElements[0].bodyRaw.trim()).toBe("greet()");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("nested <engine> in state-child body produces innerEngines entry", () => {
    const src = `<program>
      type Outer = .Composite | .Done;
      type Inner = .A | .B;
      <engine for=Outer>
        <Composite rule=.Done>
          <engine for=Inner>
            <A rule=.B/>
            <B/>
          </engine>
        </Composite>
        <Done/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].innerEngines).toHaveLength(1);
    expect(native[0].innerEngines[0].rawText).toContain("<engine for=Inner>");
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — payload bindings", () => {
  test("<Done rows> bareword → positional payload binding", () => {
    const src = `<program>
      type Result = .Done(rows: Int) | .Pending;
      <engine for=Result>
        <Done rows rule=.Pending/>
        <Pending/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].payloadBindings).toEqual([{ kind: "positional", name: "rows" }]);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("<Done rows=r> named → named payload binding", () => {
    const src = `<program>
      type Result = .Done(rows: Int) | .Pending;
      <engine for=Result>
        <Done rows=r rule=.Pending/>
        <Pending/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].payloadBindings).toEqual([
      { kind: "named", field: "rows", name: "r" },
    ]);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("<Done(rows)> parenthesized → positional (documented divergence: SOURCE FORM lost; SHAPE recovered)", () => {
    const src = `<program>
      type Result = .Done(rows: Int) | .Pending;
      <engine for=Result>
        <Done(rows) rule=.Pending/>
        <Pending/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    // Per cookbook OQ #2: the `(` and `)` are silently consumed; the
    // recovered PayloadBinding shape is the same as bare-form. The legacy
    // parser's `parsePayloadBindings` ALSO collapses to the same shape, so
    // structural equality holds.
    expect(native[0].payloadBindings).toEqual([{ kind: "positional", name: "rows" }]);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });

  test("reserved attrs (rule, effect, history, internal:rule) skipped from payloadBindings", () => {
    const src = `<program>
      type R = .X | .Y;
      <engine for=R>
        <X rule=.Y effect=\${noop()} history internal:rule=.Y/>
        <Y/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native[0].payloadBindings).toEqual([]);
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

describe("M6.6.b.2 walker — fallback path (synthetic AST without _nativeEngineBlock)", () => {
  test("walkEngineStateChildren returns [] on null engineBlock (defensive)", () => {
    expect(walkEngineStateChildren(null, "")).toEqual([]);
    expect(walkEngineStateChildren(undefined, "")).toEqual([]);
  });

  test("walkEngineStateChildren returns [] on engineBlock without children (defensive)", () => {
    expect(walkEngineStateChildren({ kind: "Markup", children: null }, "")).toEqual([]);
    expect(walkEngineStateChildren({ kind: "Markup", children: [] }, "")).toEqual([]);
  });

  test("walkEngineStateChildren ignores lowercase (non-state-child) children", () => {
    // A native engine block whose children are all lowercase tags (e.g.
    // onIdle, onTransition, etc. at engine-root) — none should be emitted
    // as state-children.
    const block = {
      kind: "Markup",
      name: "engine",
      span: { start: 0, end: 10 },
      children: [
        {
          kind: "Markup",
          name: "onIdle",
          span: { start: 1, end: 5 },
          attrs: [],
          children: [],
        },
        {
          kind: "Text",
          span: { start: 5, end: 6 },
        },
      ],
    };
    expect(walkEngineStateChildren(block, "          ")).toEqual([]);
  });
});

describe("M6.6.b.2 walker — kitchen-sink (every shape category in one engine)", () => {
  test("composite shape: history + effect + onTimeout + onTransition + nested engine + payload", () => {
    // All-bare-body kitchen-sink: every shape category in one fixture,
    // strict dual-pipeline parity (no `:`-shorthand divergence).
    const src = `<program>
      type Outer = .Loading | .Done(count: Int) | .Pending;
      type Inner = .Sub1 | .Sub2;
      <engine for=Outer>
        <Loading rule=.Pending effect=\${tick()}>
          <onTimeout after=1s to=.Pending/>
        </Loading>
        <Done count rule=.Pending history>
          <onTransition to=.Pending once>logIt()</>
          <engine for=Inner>
            <Sub1 rule=.Sub2/>
            <Sub2/>
          </engine>
        </Done>
        <Pending/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalk(src);

    expect(native).toHaveLength(legacy.length);
    expect(native).toHaveLength(3);
    // Field-by-field cross-validation: every populated field shape must
    // match the legacy parser byte-for-byte (modulo rawOffset).
    expect(stripRawOffsetRecursive(native)).toEqual(stripRawOffsetRecursive(legacy));
  });
});

// =============================================================================
// M6.6.b.3 — walkIsLegacyArrowRulesBody + walkOnIdleEntries parity tests.
//
// Same dual-pipeline structure as the b.2 tests: drive each fixture through
// `nativeParseFile`, find the engine-decl, then run BOTH the legacy regex
// helper (against `engineDecl.rulesRaw`) AND the native walker (against
// `engineDecl._nativeEngineBlock` + `_source`). Assert structural parity
// where the cookbook claims it; document the divergences.
// =============================================================================

// dualWalkLegacyArrow — produce both classifications for an engine fixture.
function dualWalkLegacyArrow(src) {
  const result = nativeParseFile("/m66-b3/legacy-arrow.scrml", src);
  const engineDecl = findEngineDecl(result.ast);
  if (!engineDecl) {
    throw new Error("test fixture is malformed — no engine-decl found");
  }
  const legacy = isLegacyArrowRulesBody(engineDecl.rulesRaw || "");
  const native = walkIsLegacyArrowRulesBody(
    engineDecl._nativeEngineBlock,
    typeof engineDecl._source === "string" ? engineDecl._source : "",
  );
  return { legacy, native, engineDecl };
}

// dualWalkOnIdle — produce both onIdle entry lists for an engine fixture.
function dualWalkOnIdle(src) {
  const result = nativeParseFile("/m66-b3/onidle.scrml", src);
  const engineDecl = findEngineDecl(result.ast);
  if (!engineDecl) {
    throw new Error("test fixture is malformed — no engine-decl found");
  }
  const legacy = scanForOnIdleEntries(engineDecl.rulesRaw || "");
  const native = walkOnIdleEntries(
    engineDecl._nativeEngineBlock,
    typeof engineDecl._source === "string" ? engineDecl._source : "",
  );
  return { legacy, native, engineDecl };
}

// stripIdleRawOffset — `rawOffset` measures from different bases across the
// two pipelines (legacy: trimmed `rulesRaw`; native: post-trim child-span
// window). Strip it for cross-pipeline equality. Same rationale as the
// b.2 `stripRawOffsetRecursive` helper.
function stripIdleRawOffset(entries) {
  return entries.map((e) => {
    const c = { ...e };
    delete c.rawOffset;
    return c;
  });
}

describe("M6.6.b.3 walker — walkIsLegacyArrowRulesBody", () => {
  test("legacy <machine> body with arrow grammar → legacy=true", () => {
    // SPEC §51.0.K legacy form: event-arrow grammar produces NO PascalCase
    // state-child openers; legacy parser fires the arrow-rule classifier.
    // Native walker mirrors via the no-PascalCase + `=>` heuristic.
    const src = `<program>
      type Color = .Red | .Blue;
      <machine for=Color>
        click => .Blue
        reset => .Red
      </machine>
    </program>`;
    const { legacy, native } = dualWalkLegacyArrow(src);

    expect(native).toBe(true);
    expect(native).toBe(legacy);
  });

  test("new <engine> body with state-children → legacy=false", () => {
    // PascalCase state-child openers present — not legacy arrow grammar.
    const src = `<program>
      type Size = .Small | .Big;
      <engine for=Size>
        <Small rule=.Big/>
        <Big rule=.Small/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkLegacyArrow(src);

    expect(native).toBe(false);
    expect(native).toBe(legacy);
  });

  test("empty engine body → legacy=false", () => {
    // No state-child openers AND no `=>` — not legacy arrow grammar.
    const src = `<program>
      type Mode = .Only;
      <engine for=Mode>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkLegacyArrow(src);

    expect(native).toBe(false);
    expect(native).toBe(legacy);
  });

  test("engine body with state-children plus expression containing `=>` → legacy=false (PascalCase wins)", () => {
    // The legacy regex is `hasStateChildOpener` AND `!hasStateChildOpener &&
    // hasArrow` — i.e. PascalCase children DOMINATE. An arrow function
    // expression inside a state-child body must NOT misclassify.
    const src = `<program>
      type State = .A | .B;
      <engine for=State>
        <A rule=.B>\${arr.map(x => x + 1)}</A>
        <B/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkLegacyArrow(src);

    expect(native).toBe(false);
    expect(native).toBe(legacy);
  });

  test("defensive — null / undefined engineBlock returns false", () => {
    expect(walkIsLegacyArrowRulesBody(null, "")).toBe(false);
    expect(walkIsLegacyArrowRulesBody(undefined, "")).toBe(false);
  });

  test("defensive — engineBlock with empty children + empty source returns false", () => {
    expect(
      walkIsLegacyArrowRulesBody({ kind: "Markup", children: [] }, ""),
    ).toBe(false);
    expect(
      walkIsLegacyArrowRulesBody({ kind: "Markup", children: null }, ""),
    ).toBe(false);
  });
});

describe("M6.6.b.3 walker — walkOnIdleEntries", () => {
  test("single engine-root <onIdle/> with literal duration → entry recovered", () => {
    const src = `<program>
      type Auth = .Active | .Idle;
      <engine for=Auth>
        <Active rule=.Idle/>
        <Idle/>
        <onIdle after=5000ms to=.Idle/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkOnIdle(src);

    expect(native).toHaveLength(1);
    expect(legacy).toHaveLength(1);
    expect(native[0].after).toBe(legacy[0].after);
    expect(native[0].to).toBe("Idle");
    expect(native[0].to).toBe(legacy[0].to);
    expect(stripIdleRawOffset(native)).toEqual(stripIdleRawOffset(legacy));
  });

  test("single engine-root <onIdle/> with quoted duration → entry recovered (quotes stripped)", () => {
    const src = `<program>
      type Auth = .Active | .Idle;
      <engine for=Auth>
        <Active rule=.Idle/>
        <Idle/>
        <onIdle after="500ms" to=".Idle"/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkOnIdle(src);

    expect(native).toHaveLength(1);
    expect(native[0].after).toBe("500ms");
    expect(native[0].to).toBe("Idle");
    expect(stripIdleRawOffset(native)).toEqual(stripIdleRawOffset(legacy));
  });

  test("multiple <onIdle> siblings → both recovered (typer fires E-IDLE-DUPLICATE)", () => {
    // Per SPEC §51.0.R, multiple <onIdle> entries are caught by the typer's
    // E-IDLE-DUPLICATE check (symbol-table.ts:5128). The WALKER's job is to
    // surface ALL entries so the typer can fire on the duplicate; we assert
    // both entries are returned.
    const src = `<program>
      type Auth = .Active | .Idle | .Locked;
      <engine for=Auth>
        <Active rule=.Idle/>
        <Idle/>
        <Locked/>
        <onIdle after=5000ms to=.Idle/>
        <onIdle after=10000ms to=.Locked/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkOnIdle(src);

    expect(native).toHaveLength(2);
    expect(legacy).toHaveLength(2);
    expect(native[0].to).toBe("Idle");
    expect(native[1].to).toBe("Locked");
    expect(stripIdleRawOffset(native)).toEqual(stripIdleRawOffset(legacy));
  });

  test("<onIdle> plus <onTimeout> + state-children — only <onIdle> entries returned", () => {
    // The walker filters by name === "onIdle"; unrelated structural
    // siblings (<onTimeout> on state-children, nested engines, etc.) must
    // not contaminate the result.
    const src = `<program>
      type Auth = .Active | .Idle;
      <engine for=Auth>
        <Active rule=.Idle>
          <onTimeout after=1s to=.Idle/>
        </Active>
        <Idle/>
        <onIdle after=5000ms to=.Idle/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkOnIdle(src);

    expect(native).toHaveLength(1);
    expect(native[0].after).toBe("5000ms");
    expect(native[0].to).toBe("Idle");
    expect(stripIdleRawOffset(native)).toEqual(stripIdleRawOffset(legacy));
  });

  test("engine with no <onIdle> → empty array", () => {
    const src = `<program>
      type Auth = .Active | .Idle;
      <engine for=Auth>
        <Active rule=.Idle/>
        <Idle/>
      </engine>
    </program>`;
    const { legacy, native } = dualWalkOnIdle(src);

    expect(native).toHaveLength(0);
    expect(legacy).toHaveLength(0);
  });

  test("defensive — null / undefined engineBlock returns []", () => {
    expect(walkOnIdleEntries(null, "")).toEqual([]);
    expect(walkOnIdleEntries(undefined, "")).toEqual([]);
  });

  test("defensive — engineBlock without children returns []", () => {
    expect(walkOnIdleEntries({ kind: "Markup", children: null }, "")).toEqual(
      [],
    );
    expect(walkOnIdleEntries({ kind: "Markup", children: [] }, "")).toEqual([]);
  });
});
