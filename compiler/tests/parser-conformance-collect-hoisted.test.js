// parser-conformance-collect-hoisted.test.js — F3 / Cluster B conformance.
//
// The native-parser `collectHoisted` analogue (compiler/native-parser/
// collect-hoisted.js) is the file-level surface bridge: a pure fold over the
// native parser's block-stream producing the six hoisted top-level
// collections + the `hasProgramRoot` boolean the downstream compiler stages
// consume (name-resolver / symbol-table / component-expander /
// route-inference / dependency-graph / auth-graph / codegen).
//
// THE CONTRACT — parity with the live pipeline's `collectHoisted`
// (compiler/src/ast-builder.js ~L12132 + the `hasProgramRoot` computation
// ~L12296). This file's behavioral spec is "the native walker collects the
// same file-level surface the live `buildAST` exposes on its FileAST" for
// the surfaces the native parser PRODUCES at v0.5:
//   - imports / exports — scanned from LogicEscape Stmt[] bodies;
//   - channelDecls — Markup blocks named "channel";
//   - hasProgramRoot — a top-level Markup block named "program".
// typeDecls / components / machineDecls resolve EMPTY at v0.5 (no native
// engine/type/component BlockKind — those land at v0.6 F7); the walker keeps
// the slots so the v0.6 swap lights them up without a structural rewrite.
//
// SCOPE NOTE — the native parser is JS-only-plus-markup-seam at v0.5 (MK4).
// A FULL .scrml file (markup + style + interleaved JS blocks) parses through
// `parseMarkup` crash-free (the no-throw discipline) but the per-block
// payloads are sketch-depth for Sql/Css/Meta/etc. The CROSS-CHECK against
// the live `collectHoisted` is therefore run on a CURATED micro-corpus whose
// shapes the native parser models fully today (pure-markup `<program>` /
// `<channel>` trees + pure logic-escape `${...}` blocks); the corpus
// exemplars (~20 real .scrml files) are run as a no-throw + shape audit.
//
// GROWTH NOTE — this file is the F3 conformance section. The v0.6 F7
// dispatch (state/sql/css native sub-parsers) appends the
// typeDecls/components/machineDecls parity sections when those native kinds
// land.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

import { parseMarkup } from "../native-parser/parse-markup.js";
import {
  collectHoisted,
  hasProgramRoot,
} from "../native-parser/collect-hoisted.js";
import { enumerateScrmlCorpus } from "./parser-conformance/corpus-enumerator.js";

import { splitBlocks } from "../src/block-splitter.js";
import { buildAST } from "../src/ast-builder.js";

// liveSurface — drive the live pipeline's `collectHoisted` for `source`.
// `buildAST(splitBlocks(...))` returns `{ ast }`; the FileAST carries the
// hoisted collections + `hasProgramRoot` as top-level fields (the same
// surface `collectHoisted` produced, lifted onto the FileAST by buildAST).
function liveSurface(source, filePath = "conf.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return {
    imports: ast.imports ?? [],
    exports: ast.exports ?? [],
    typeDecls: ast.typeDecls ?? [],
    components: ast.components ?? [],
    machineDecls: ast.machineDecls ?? [],
    channelDecls: ast.channelDecls ?? [],
    hasProgramRoot: ast.hasProgramRoot ?? false,
  };
}

// nativeSurface — drive the native parser + collectHoisted for `source`.
function nativeSurface(source) {
  return collectHoisted(parseMarkup(source));
}

// =============================================================================
// F3 §1 — the walker's output shape. Seven keys, every collection an array,
// hasProgramRoot a boolean.
// =============================================================================
describe("F3 §1 — collectHoisted output shape", () => {
  test("returns the seven-key surface with array collections", () => {
    const r = collectHoisted([]);
    expect(Object.keys(r).sort()).toEqual(
      [
        "channelDecls",
        "components",
        "exports",
        "hasProgramRoot",
        "imports",
        "machineDecls",
        "typeDecls",
      ],
    );
    expect(Array.isArray(r.imports)).toBe(true);
    expect(Array.isArray(r.exports)).toBe(true);
    expect(Array.isArray(r.typeDecls)).toBe(true);
    expect(Array.isArray(r.components)).toBe(true);
    expect(Array.isArray(r.machineDecls)).toBe(true);
    expect(Array.isArray(r.channelDecls)).toBe(true);
    expect(typeof r.hasProgramRoot).toBe("boolean");
  });

  test("defensive — a non-array / missing block-stream folds to the empty surface", () => {
    for (const bad of [null, undefined, 42, "not-blocks", {}]) {
      const r = collectHoisted(bad);
      expect(r.imports).toEqual([]);
      expect(r.channelDecls).toEqual([]);
      expect(r.hasProgramRoot).toBe(false);
    }
  });
});

// =============================================================================
// F3 §2 — imports / exports scanned from LogicEscape Stmt[] bodies. The
// native LogicEscape carries the RAW parsed Stmt[] (not pre-filtered like the
// live `logic` node); the walker filters Import/Export out of it.
// =============================================================================
describe("F3 §2 — imports / exports from LogicEscape bodies", () => {
  test("a single import in a `${...}` block is collected", () => {
    const r = nativeSurface('${\nimport { foo } from "./m.js"\n}');
    expect(r.imports.length).toBe(1);
    expect(r.imports[0].kind).toBe("Import");
    expect(r.exports.length).toBe(0);
  });

  test("imports + exports from one block", () => {
    const r = nativeSurface(
      '${\nimport { a } from "./a.js"\nimport b from "./b.js"\nexport const x = 1\nexport { a }\n}',
    );
    expect(r.imports.length).toBe(2);
    expect(r.exports.length).toBe(2);
  });

  test("import nested inside a function body is recursed (live walkBodyNodes parity)", () => {
    const r = nativeSurface(
      '${\nfunction wrap() {\nimport { deep } from "./deep.js"\n}\n}',
    );
    // The native StmtKind.FunctionDecl body is recursed — a nested import is
    // still hoisted, matching the live walkBodyNodes recursion.
    expect(r.imports.length).toBe(1);
  });

  test("a block with no module declarations collects nothing", () => {
    const r = nativeSurface("${\nconst x = 1\nconst y = 2\n}");
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });
});

// =============================================================================
// F3 §3 — channelDecls + hasProgramRoot from Markup blocks.
// =============================================================================
describe("F3 §3 — channelDecls + hasProgramRoot from the markup tree", () => {
  test("a top-level `<program>` sets hasProgramRoot", () => {
    expect(nativeSurface("<program></program>").hasProgramRoot).toBe(true);
    expect(hasProgramRoot(parseMarkup("<program></program>"))).toBe(true);
  });

  test("no `<program>` — hasProgramRoot is false", () => {
    expect(nativeSurface("<div></div>").hasProgramRoot).toBe(false);
    expect(hasProgramRoot(parseMarkup("<div></div>"))).toBe(false);
  });

  test("a NESTED `<program>` does NOT set hasProgramRoot (top-level only)", () => {
    // The live check is `nodes.some(...)` over the TOP-LEVEL node list.
    const r = nativeSurface("<div><program></program></div>");
    expect(r.hasProgramRoot).toBe(false);
  });

  test("a top-level `<channel>` is collected", () => {
    const r = nativeSurface('<channel name="msg" />');
    expect(r.channelDecls.length).toBe(1);
    expect(r.channelDecls[0].name).toBe("channel");
  });

  test("a `<channel>` nested in `<program>` children is collected (recursion)", () => {
    const r = nativeSurface(
      '<program>\n<channel name="a" />\n<channel name="b" />\n</program>',
    );
    expect(r.channelDecls.length).toBe(2);
    expect(r.hasProgramRoot).toBe(true);
  });
});

// =============================================================================
// F3 §4 — v0.5 divergence: typeDecls / components / machineDecls always empty.
// The native parser has no engine/type/component BlockKind at this milestone
// (M5-divergence-ledger.md). The walker keeps the slots; v0.6 F7 lights them.
// =============================================================================
describe("F3 §4 — typeDecls / components / machineDecls are empty at v0.5", () => {
  test("the three v0.6-deferred collections resolve empty regardless of input", () => {
    const inputs = [
      "<program><channel /></program>",
      '${\nimport { x } from "./m.js"\n}',
      "<div><span></span></div>",
    ];
    for (const src of inputs) {
      const r = nativeSurface(src);
      expect(r.typeDecls).toEqual([]);
      expect(r.components).toEqual([]);
      expect(r.machineDecls).toEqual([]);
    }
  });
});

// =============================================================================
// F3 §5 — CROSS-CHECK against the live pipeline's `collectHoisted`. Curated
// micro-corpus whose shapes the native parser models fully at v0.5. The
// native walker's surface MUST agree with the live `buildAST` FileAST for
// the parity-able fields (counts — the node objects are differently shaped
// between the two ASTs; the COUNT + the boolean are the surface contract).
// =============================================================================
describe("F3 §5 — native collectHoisted ↔ live collectHoisted parity (curated)", () => {
  const PARITY_CORPUS = [
    { name: "empty file", src: "" },
    { name: "pure program root", src: "<program></program>" },
    {
      name: "program with one channel",
      src: '<program>\n<channel name="msg" />\n</program>',
    },
    {
      name: "program with two channels",
      src: '<program>\n<channel name="a" />\n<channel name="b" />\n</program>',
    },
    { name: "no program root", src: "<div><span></span></div>" },
    {
      name: "single import block",
      src: '${\nimport { foo } from "./m.js"\n}',
    },
    {
      name: "import + export block",
      src: '${\nimport a from "./a.js"\nexport const x = 1\n}',
    },
  ];

  for (const row of PARITY_CORPUS) {
    test(`[parity] ${row.name} — hasProgramRoot agrees`, () => {
      const native = nativeSurface(row.src);
      const live = liveSurface(row.src);
      expect(native.hasProgramRoot).toBe(live.hasProgramRoot);
    });

    test(`[parity] ${row.name} — channelDecls count agrees`, () => {
      const native = nativeSurface(row.src);
      const live = liveSurface(row.src);
      expect(native.channelDecls.length).toBe(live.channelDecls.length);
    });

    test(`[parity] ${row.name} — imports / exports count agrees`, () => {
      const native = nativeSurface(row.src);
      const live = liveSurface(row.src);
      expect(native.imports.length).toBe(live.imports.length);
      expect(native.exports.length).toBe(live.exports.length);
    });
  }
});

// =============================================================================
// F3 §6 — corpus exemplar audit. ~20 real .scrml files fed through the native
// parser + collectHoisted. The gate is the no-throw discipline + a
// well-formed seven-key surface; the per-file counts are recorded
// informationally (a full .scrml file's markup/style/JS interleaving is
// beyond the v0.5 native-parser bound — see the SCOPE NOTE in the header).
// =============================================================================
describe("F3 §6 — corpus exemplar audit (~20 .scrml files, no-throw + shape)", () => {
  // Take a deterministic spread across the corpus — every Nth file so the
  // sample covers samples/, examples/, stdlib/, self-host/.
  const ALL = enumerateScrmlCorpus();
  const STEP = Math.max(1, Math.floor(ALL.length / 20));
  const SAMPLE = ALL.filter((_, i) => i % STEP === 0).slice(0, 20);

  test("the exemplar sample is ~20 files", () => {
    expect(SAMPLE.length).toBeGreaterThanOrEqual(15);
    expect(SAMPLE.length).toBeLessThanOrEqual(20);
  });

  for (const row of SAMPLE) {
    test(`[corpus] ${row.relpath} — collectHoisted no-throw + well-formed surface`, () => {
      const src = readFileSync(row.path, "utf8");
      let surface;
      expect(() => {
        surface = collectHoisted(parseMarkup(src));
      }).not.toThrow();
      // Well-formed seven-key surface on every file.
      expect(Array.isArray(surface.imports)).toBe(true);
      expect(Array.isArray(surface.exports)).toBe(true);
      expect(Array.isArray(surface.typeDecls)).toBe(true);
      expect(Array.isArray(surface.components)).toBe(true);
      expect(Array.isArray(surface.machineDecls)).toBe(true);
      expect(Array.isArray(surface.channelDecls)).toBe(true);
      expect(typeof surface.hasProgramRoot).toBe("boolean");
      // v0.5 divergence — the three deferred collections are empty.
      expect(surface.typeDecls).toEqual([]);
      expect(surface.components).toEqual([]);
      expect(surface.machineDecls).toEqual([]);
    });
  }
});
