/**
 * Unit tests for the block-analysis sidecar BUILDER + serializer
 * (block-analysis.ts).
 *
 * The builder projects every named block in a `.scrml` file (function /
 * component / engine / type / channel) into a deterministic, pretty-printed
 * artifact written by D3's `--emit-block-analysis` flag. flogence's block-lease
 * / dock tooling consumes the artifact INSTEAD of re-parsing the source with a
 * regex (the drift-avoidance architecture).
 *
 * R26 / S138 discipline: these drive from REAL COMPILED ASTs (`splitBlocks` →
 * `buildAST`) so the spans, the channel-name attr, and — crucially — the FN
 * footprint are computed end-to-end through the REAL D1 `footprintForBlock`
 * (NO synthetic footprints). The ONE synthetic node is the engine-decl: engine
 * `_record.engineMeta` is populated by the SYM pass (PASS 10.A/11/B15), not by
 * `buildAST` alone, so we attach an engineMeta-bearing node to `machineDecls`
 * exactly as `engine-graph.test.js` does (the real engine path is exercised by
 * D3's integration test over a compiled engine file).
 *
 * The integration test (compiler/tests/integration/emit-block-analysis-integration.test.js,
 * landed by D3) exercises the same builder over a real compiled .scrml file
 * INCLUDING a real engine.
 */
import { test, expect, describe } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  buildBlockAnalysisForFile,
  buildBlockAnalysis,
  serializeBlockAnalysis,
  buildBlockAnalysisJson,
} from "../../src/block-analysis.ts";

/** Compile scrml source to a real FileAST via the production BS+TAB path. */
function compileAST(src, path = "/abs/examples/demo/page.scrml") {
  return buildAST(splitBlocks(path, src)).ast;
}

/**
 * Attach a synthetic engineMeta-bearing engine-decl to a compiled FileAST's
 * `machineDecls` so `collectC12EngineDecls` discovers it. Mirrors the helper in
 * engine-graph.test.js — `_record.engineMeta` is a SYM-pass product the raw
 * `buildAST` AST lacks, so the unit test supplies it directly. The synthetic
 * span is placed AFTER every real block so source-order is unambiguous.
 */
function attachEngine(ast, varName, opts = {}) {
  const span = { file: ast.filePath, start: opts.start ?? 90000, end: opts.end ?? 90060, line: opts.line ?? 900, col: 1 };
  const decl = {
    kind: "engine-decl",
    engineName: varName,
    span,
    _record: {
      engineMeta: {
        varName,
        forType: opts.forType ?? "TrafficLight",
        variants: opts.variants ?? ["Red", "Green", "Yellow"],
        initialVariant: opts.initialVariant ?? "Red",
        derivedExpr: opts.derivedExpr ?? null,
        openerEffect: null,
        stateChildren: opts.stateChildren ?? [{ tag: "Red", rule: { kind: "single", target: "Green" } }],
      },
    },
  };
  ast.machineDecls = [...(ast.machineDecls ?? []), decl];
  return ast;
}

// ---------------------------------------------------------------------------
// A multi-def fixture exercising all five lease kinds. The `${…}` logic block
// holds a type-decl + a function (with reactive writes so the footprint is
// NON-empty), the `<page>` holds a channel + a component. The engine is
// attached synthetically (engineMeta requires SYM).
// ---------------------------------------------------------------------------

const MULTI_DEF_SRC = `\${
  type TrafficLight:enum = {
    Red
    Green
    Yellow
  }

  function bump(amount) {
    @counter = @counter + amount
    @quoteForm.weightLbs = amount
  }
}

<page>
  <channel name="chat"/>
  const Badge = <span class="badge">hi</span>
  <h1>Demo</h1>
</page>`;

function multiDefAnalysis() {
  const ast = attachEngine(compileAST(MULTI_DEF_SRC), "light");
  return buildBlockAnalysisForFile(ast, MULTI_DEF_SRC);
}

describe("buildBlockAnalysisForFile — all five lease kinds", () => {
  test("discovers a function, component, engine, type, and channel", () => {
    const ba = multiDefAnalysis();
    const byKind = new Map(ba.blocks.map((b) => [b.kind, b]));
    expect(new Set(ba.blocks.map((b) => b.kind))).toEqual(
      new Set(["function", "component", "engine", "type", "channel"]),
    );
    expect(byKind.get("function").name).toBe("bump");
    expect(byKind.get("component").name).toBe("Badge");
    expect(byKind.get("engine").name).toBe("light");
    expect(byKind.get("type").name).toBe("TrafficLight");
    expect(byKind.get("channel").name).toBe("chat");
  });

  test("each block's id is <relpath>::<name> with a stable relative path", () => {
    const ba = multiDefAnalysis();
    expect(ba.file).toBe("examples/demo/page.scrml");
    const ids = new Set(ba.blocks.map((b) => b.id));
    expect(ids).toEqual(
      new Set([
        "examples/demo/page.scrml::bump",
        "examples/demo/page.scrml::Badge",
        "examples/demo/page.scrml::light",
        "examples/demo/page.scrml::TrafficLight",
        "examples/demo/page.scrml::chat",
      ]),
    );
  });

  test("each block carries a kind-correct span with start < end and a 1-based line", () => {
    const ba = multiDefAnalysis();
    for (const b of ba.blocks) {
      expect(b.span.start).toBeGreaterThanOrEqual(0);
      expect(b.span.end).toBeGreaterThan(b.span.start);
      expect(b.span.line).toBeGreaterThanOrEqual(1);
      expect(b.span.endLine).toBeGreaterThanOrEqual(b.span.line);
      expect(b.footprintDepth).toBe("shallow");
    }
  });
});

describe("buildBlockAnalysisForFile — source order", () => {
  test("blocks are emitted in source order (span.start ascending)", () => {
    const ba = multiDefAnalysis();
    const starts = ba.blocks.map((b) => b.span.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
    // The real-compiled blocks precede the synthetic engine (placed at 90000).
    // Concrete order: type (in-logic, earliest) → function → channel →
    // component → engine.
    expect(ba.blocks.map((b) => b.kind)).toEqual([
      "type",
      "function",
      "channel",
      "component",
      "engine",
    ]);
  });
});

// ---------------------------------------------------------------------------
// ss4-item3 (2026-06-21) — function-decl span MUST NOT overshoot.
//
// REGRESSION: parseLogicBody's function-decl handlers built their span as
// `spanOf(startTok, peek())`, but `parseRecursiveBody()` had already CONSUMED
// the closing `}`, so `peek()` was the NEXT decl's opener token. Each fn's
// `span.end` therefore landed on the FOLLOWING function's opening line, so
// `block-analysis.projectSpan` derived an `endLine` equal to the next fn's
// `line` — adjacent functions shared a boundary line, breaking flogence's
// block-lease / dock per-block spans.
//
// Drives the REAL `splitBlocks → buildAST → buildBlockAnalysisForFile` path
// (R26/S138 — a synthetic AST would MISS this upstream parser bug). The fixture
// holds ≥3 ADJACENT local functions in a `${…}` logic body (both `function`
// and `fn` forms, since the bug had distinct creation sites per fnKind).
// ---------------------------------------------------------------------------

// Each fn's body is laid out so its OWN closing `}` is on a known line. Line
// numbers are 1-based; line 1 is `${`. Adjacent fns are separated by ONE blank
// line so a boundary-overshoot would be unambiguous (endLine == next fn line).
const ADJACENT_FNS_SRC = `\${
  function alpha(a) {
    return a + 1
  }

  function beta(b) {
    @counter = b
    return @counter
  }

  fn gamma(c) {
    return c * 2
  }

  fn delta(d) {
    return d
  }
}

<page>
  <h1>spans</h1>
</page>`;

describe("buildBlockAnalysisForFile — function-decl span does not overshoot (ss4-item3)", () => {
  // Compute, from the fixture source, the 1-based line of each fn's OWN closing
  // `}` (the dedented `  }` that follows its opener). Drives the assertion off
  // the literal source so it stays correct if the fixture is edited.
  function expectedCloseLine(src, fnName) {
    const lines = src.split("\n");
    const openIdx = lines.findIndex((l) => l.includes(`function ${fnName}(`) || l.includes(`fn ${fnName}(`));
    expect(openIdx).toBeGreaterThanOrEqual(0);
    for (let i = openIdx + 1; i < lines.length; i++) {
      if (lines[i] === "  }") return i + 1; // 1-based; the dedented closing brace
    }
    throw new Error(`no closing brace found for ${fnName}`);
  }

  function fnBlocks() {
    const ba = buildBlockAnalysisForFile(
      compileAST(ADJACENT_FNS_SRC, "/abs/examples/spans/page.scrml"),
      ADJACENT_FNS_SRC,
    );
    return ba.blocks.filter((b) => b.kind === "function");
  }

  test("all four adjacent local functions are discovered (function + fn forms)", () => {
    const names = fnBlocks().map((b) => b.name);
    expect(names).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  test("no two adjacent function blocks share a boundary line (endLine < next fn's line)", () => {
    const fns = fnBlocks();
    for (let i = 0; i < fns.length - 1; i++) {
      // Strictly LESS THAN: the closing `}` of fn[i] is on an earlier line than
      // the opener of fn[i+1]. Equality is the overshoot symptom.
      expect(fns[i].span.endLine).toBeLessThan(fns[i + 1].span.line);
    }
  });

  test("each function's endLine is the source line of its OWN closing brace", () => {
    for (const b of fnBlocks()) {
      expect(b.span.endLine).toBe(expectedCloseLine(ADJACENT_FNS_SRC, b.name));
    }
  });
});

describe("buildBlockAnalysisForFile — footprint populated end-to-end (real D1)", () => {
  test("the function block's footprint is the REAL footprintForBlock output", () => {
    const ba = multiDefAnalysis();
    const fn = ba.blocks.find((b) => b.kind === "function");
    // `bump` reads @counter and writes @counter + the dotted @quoteForm.weightLbs.
    expect(fn.reads).toEqual(["counter"]);
    expect(fn.writes).toEqual(["counter", "quoteForm.weightLbs"]);
    // Dotted grain survived end-to-end: the write is NOT collapsed to the root
    // cell `quoteForm` (the BREAK-1 distinction D1 supplies).
    expect(fn.writes).toContain("quoteForm.weightLbs");
    expect(fn.writes).not.toContain("quoteForm");
  });

  test("a fn writing a distinct compound field gets a DISTINCT dotted footprint", () => {
    const src = `\${
  function setOrigin(city) {
    @quoteForm.originCity = city
  }
}`;
    const ba = buildBlockAnalysisForFile(compileAST(src, "/abs/examples/q/quote.scrml"), src);
    const fn = ba.blocks.find((b) => b.kind === "function");
    expect(fn.writes).toEqual(["quoteForm.originCity"]);
    // `city` is a local param (not an `@`-reactive read), so reads is empty.
    expect(fn.reads).toEqual([]);
  });

  test("type and channel blocks have honest-empty footprints", () => {
    const ba = multiDefAnalysis();
    const type = ba.blocks.find((b) => b.kind === "type");
    const channel = ba.blocks.find((b) => b.kind === "channel");
    expect(type.reads).toEqual([]);
    expect(type.writes).toEqual([]);
    expect(channel.reads).toEqual([]);
    expect(channel.writes).toEqual([]);
  });
});

describe("buildBlockAnalysisForFile — honest-empty + edge cases", () => {
  test("a file with no named blocks yields an honest-empty blocks array", () => {
    const src = `<page><h1>Just markup</h1></page>`;
    const ba = buildBlockAnalysisForFile(compileAST(src, "/abs/examples/x/empty.scrml"), src);
    expect(ba.version).toBe(1);
    expect(ba.file).toBe("examples/x/empty.scrml");
    expect(ba.blocks).toEqual([]);
  });

  test("null / non-object input yields an honest-empty analysis (never throws)", () => {
    expect(buildBlockAnalysisForFile(null)).toEqual({ version: 1, file: "", blocks: [] });
    expect(buildBlockAnalysisForFile(undefined)).toEqual({ version: 1, file: "", blocks: [] });
  });

  test("endLine falls back to the opener line when no source is threaded", () => {
    // Without the source text we cannot count newlines in the span slice, so
    // endLine honestly equals line (never an unsubstantiated multi-line claim).
    const ast = compileAST(MULTI_DEF_SRC);
    const ba = buildBlockAnalysisForFile(ast); // no source arg, none on the AST
    for (const b of ba.blocks) {
      expect(b.span.endLine).toBe(b.span.line);
    }
  });
});

describe("buildBlockAnalysis — multi-file", () => {
  test("returns one analysis per file in file order", () => {
    const a = compileAST(`\${ function f1() { @x = 1 } }`, "/abs/examples/a/one.scrml");
    const b = compileAST(`\${ function f2() { @y = 2 } }`, "/abs/examples/b/two.scrml");
    const results = buildBlockAnalysis([a, b]);
    expect(results).toHaveLength(2);
    expect(results[0].file).toBe("examples/a/one.scrml");
    expect(results[1].file).toBe("examples/b/two.scrml");
    expect(results[0].blocks.map((x) => x.name)).toEqual(["f1"]);
    expect(results[1].blocks.map((x) => x.name)).toEqual(["f2"]);
  });

  test("a single (non-array) file is accepted", () => {
    const ast = compileAST(`\${ function only() { @z = 3 } }`, "/abs/examples/s/solo.scrml");
    const results = buildBlockAnalysis(ast);
    expect(results).toHaveLength(1);
    expect(results[0].blocks.map((x) => x.name)).toEqual(["only"]);
  });
});

describe("serializeBlockAnalysis / buildBlockAnalysisJson — serialization", () => {
  test("serializes pretty-printed (2-space) with a trailing newline", () => {
    const json = serializeBlockAnalysis({ version: 1, file: "examples/x/e.scrml", blocks: [] });
    expect(json).toBe('{\n  "version": 1,\n  "file": "examples/x/e.scrml",\n  "blocks": []\n}\n');
  });

  test("buildBlockAnalysisJson round-trips to a valid, well-shaped object", () => {
    const ast = attachEngine(compileAST(MULTI_DEF_SRC), "light");
    const json = buildBlockAnalysisJson(ast, MULTI_DEF_SRC);
    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.file).toBe("examples/demo/page.scrml");
    expect(parsed.blocks).toHaveLength(5);
    // blocks[0] is the TrafficLight enum (type block, earliest span). Type
    // blocks carry the additive typeShape + bodySpan + members alongside the
    // existing fields, in fixed key order (the determinism contract).
    expect(Object.keys(parsed.blocks[0])).toEqual([
      "id",
      "kind",
      "name",
      "typeShape",
      "span",
      "bodySpan",
      "members",
      "reads",
      "writes",
      "footprintDepth",
    ]);
  });
});

describe("buildBlockAnalysisJson — byte-determinism", () => {
  test("two builds of the same input produce byte-identical output", () => {
    const make = () => attachEngine(compileAST(MULTI_DEF_SRC), "light");
    const j1 = buildBlockAnalysisJson(make(), MULTI_DEF_SRC);
    const j2 = buildBlockAnalysisJson(make(), MULTI_DEF_SRC);
    expect(j1).toBe(j2);
  });

  test("determinism holds across the multi-file builder + serialize", () => {
    const make = () => [
      compileAST(`\${ function f1() { @x = 1 } }`, "/abs/examples/a/one.scrml"),
      compileAST(`\${ function f2() { @y = 2 } }`, "/abs/examples/b/two.scrml"),
    ];
    const ser = (files) => buildBlockAnalysis(files).map(serializeBlockAnalysis).join("");
    expect(ser(make())).toBe(ser(make()));
  });
});
