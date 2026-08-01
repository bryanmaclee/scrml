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
// (compiler/src/ast-builder.js ~L11903 + the `hasProgramRoot` computation
// ~L11963). This file's behavioral spec is "the native walker collects the
// same file-level surface the live `buildAST` exposes on its FileAST":
//   - imports / exports — scanned from LogicEscape + Meta Stmt[] bodies;
//   - channelDecls — Markup blocks named "channel";
//   - hasProgramRoot — a top-level Markup block named "program";
//   - machineDecls — A3 synthesizes a 14-field EngineDeclNode from a native
//     Markup block named "engine" / "machine" (incl. nested-engine recursion);
//   - typeDecls — A3 synthesizes a TypeDeclNode from a native TypeDecl Stmt
//     (`export type` lands in both typeDecls and exports);
//   - components — A3 synthesizes a ComponentDefNode from a `const Upper =
//     <markup>` VarDecl.
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
import { nativeParseFile } from "../native-parser/parse-file.js";
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
// S163 — `machineDecls` is no longer a `collectHoisted` output; engine
// synthesis moved to `parse-file.js` (`collectMachineDeclsFromNodes`, derived
// from the mapped `nodes` so the engine-decl instance is SHARED with
// `FileAST.nodes`). Read the engine surface from `nativeParseFile` (the
// production FileAST) and merge it over the `collectHoisted` surface so every
// other F3 section (imports/exports/typeDecls/components/channelDecls/
// hasProgramRoot) keeps probing `collectHoisted` directly, unchanged.
function nativeSurface(source) {
  const hoisted = collectHoisted(parseMarkup(source));
  const { ast } = nativeParseFile("conf.scrml", source);
  return { ...hoisted, machineDecls: ast.machineDecls ?? [] };
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
    // M6.4a — collectHoisted now synthesizes the LIVE `import-decl` shape
    // (ast.ts:1184) via synthImportDecl so cross-file MOD / NR / api.js
    // consumers can read `imp.names` directly. Pre-M6.4a the raw native
    // `Import` Stmt was pushed; the consumer-shape mismatch silently
    // dropped every native-pipeline cross-file binding.
    expect(r.imports[0].kind).toBe("import-decl");
    expect(r.imports[0].names).toEqual(["foo"]);
    expect(r.imports[0].source).toBe("./m.js");
    expect(r.exports.length).toBe(0);
  });

  test("imports + exports from one block", () => {
    const r = nativeSurface(
      '${\nimport { a } from "./a.js"\nimport b from "./b.js"\nexport const x = 1\nexport { a }\n}',
    );
    expect(r.imports.length).toBe(2);
    expect(r.exports.length).toBe(2);
  });

  // P4-6 (DIFF-hoist-count H1) — import-hoisting is TOP-LEVEL ONLY. The live
  // `logic` node filters imports with a flat top-level scan
  // (ast-builder.js:11344); it does NOT recurse FunctionDecl bodies. An
  // `import` inside a function body is illegal placement (E-IMPORT-003) — the
  // live parser never emits an `import-decl` there, so the live walker never
  // hoists one. The native parser DOES emit a `StmtKind.Import` inside the
  // FunctionDecl body, so `walkStmts` must NOT hoist it.
  test("P4-6 — import nested inside a function body is NOT hoisted (E-IMPORT-003)", () => {
    const r = nativeSurface(
      '${\nfunction wrap() {\nimport { deep } from "./deep.js"\n}\n}',
    );
    expect(r.imports.length).toBe(0);
  });

  // P4-6 — a dynamic `import(...)` EXPRESSION is not a static module import.
  // scrml has no source-level `await` (E-AWAIT-NOT-IN-SCRML); the native
  // parser models `const { x } = await import("path")` as a parse-error
  // recovery `StmtKind.Import` with empty specifiers AND an empty `source`.
  // The live pipeline (Acorn) parses it as an `ImportExpression` and never
  // hoists it. `walkStmts` skips a degenerate Import with no module `source`.
  test("P4-6 — a dynamic `await import(...)` expression is NOT hoisted", () => {
    const r = nativeSurface(
      '^{\nconst { resolve } = await import("path")\n}',
    );
    expect(r.imports.length).toBe(0);
  });

  // P4-6 GUARD — a legitimate top-level static import IS still hoisted; the
  // top-level-only + non-degenerate gates must not regress the valid case.
  test("P4-6 GUARD — a legitimate top-level import IS hoisted", () => {
    const r = nativeSurface('${\nimport { Status } from "./helper.scrml"\n}');
    expect(r.imports.length).toBe(1);
    // M6.4a — synthImportDecl produces the live `import-decl` shape.
    expect(r.imports[0].kind).toBe("import-decl");
    expect(r.imports[0].source).toBe("./helper.scrml");
    expect(r.imports[0].names).toEqual(["Status"]);
  });

  // P4-6 GUARD — a bare side-effect import (`import "m"`, empty specifiers but
  // a non-empty `source`) is a real import and IS hoisted — the degenerate
  // gate keys on the missing `source`, not on empty specifiers.
  test("P4-6 GUARD — a bare side-effect import IS hoisted", () => {
    const r = nativeSurface('${\nimport "./side-effect.js"\n}');
    expect(r.imports.length).toBe(1);
    expect(r.imports[0].source).toBe("./side-effect.js");
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
// F3 §4 — A3 (v0.7) declaration synthesis. The three formerly-empty
// collections — typeDecls / components / machineDecls — are now SYNTHESIZED
// from the native block-stream. A non-declaration input still resolves them
// empty (the walker only collects what is genuinely a declaration).
// =============================================================================
describe("F3 §4 — typeDecls / components / machineDecls empty for non-decl input", () => {
  test("non-declaration inputs resolve the three collections empty", () => {
    const inputs = [
      "<program><channel /></program>",
      '${\nimport { x } from "./m.js"\n}',
      "<div><span></span></div>",
      "${\nconst x = 1\nconst y = 2\n}",
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
// F3 §7 — machineDecls engine SYNTHESIS. A native `Markup` block named "engine"
// is synthesized into an `engine-decl` and placed on `FileAST.machineDecls`.
// S163 — synthesis now happens in `parse-file.js` (`synthEngineNode` ->
// `synthEngineDecl`, instance-shared with `nodes`); `nativeSurface` reads the
// FileAST machineDecls so these assertions probe the production surface. The
// `synthEngineDecl` field-derivation is unchanged, so every field assertion
// below holds identically.
// (legacy header preserved:) A native `Markup` block named "engine"
// (or the legacy "machine") is synthesized into a 14-field EngineDeclNode.
// =============================================================================
describe("F3 §7 — machineDecls engine synthesis", () => {
  test("a top-level `<engine for=Type>` synthesizes one engine-decl", () => {
    const r = nativeSurface("<engine for=DutyStatus></engine>");
    expect(r.machineDecls.length).toBe(1);
    const e = r.machineDecls[0];
    expect(e.kind).toBe("engine-decl");
    expect(e.governedType).toBe("DutyStatus");
    // §51.0.C — varName auto-derives lowercase-first-char from the type.
    expect(e.varName).toBe("dutyStatus");
    expect(e.engineName).toBe("dutyStatus");
    expect(e.varNameOverride).toBe(null);
    expect(typeof e.id).toBe("number");
  });

  test("`var=NAME` override supersedes the §51.0.C auto-derived varName", () => {
    const e = nativeSurface("<engine for=Foo var=myFoo></engine>").machineDecls[0];
    expect(e.varName).toBe("myFoo");
    expect(e.varNameOverride).toBe("myFoo");
    expect(e.governedType).toBe("Foo");
  });

  test("legacy `name=NAME` is the variable name (back-compat)", () => {
    const e = nativeSurface("<machine for=Foo name=duty></engine>").machineDecls[0];
    expect(e.varName).toBe("duty");
    expect(e.varNameOverride).toBe(null);
  });

  test("`initial=.X` (unquoted dotted) records the variant (dot-stripped)", () => {
    const e = nativeSurface("<engine for=Foo initial=.OffDuty></engine>").machineDecls[0];
    expect(e.initialVariant).toBe("OffDuty");
  });

  test("`initial=\".X\"` (quoted) records the variant (dot-stripped)", () => {
    const e = nativeSurface('<engine for=Foo initial=".Start"></engine>').machineDecls[0];
    expect(e.initialVariant).toBe("Start");
  });

  test("no `initial=` — initialVariant is null", () => {
    const e = nativeSurface("<engine for=Foo></engine>").machineDecls[0];
    expect(e.initialVariant).toBe(null);
  });

  test("the `pinned` bareword sets pinned true", () => {
    const e = nativeSurface("<engine for=Foo pinned></engine>").machineDecls[0];
    expect(e.pinned).toBe(true);
  });

  test("no `pinned` bareword — pinned is false", () => {
    const e = nativeSurface("<engine for=Foo></engine>").machineDecls[0];
    expect(e.pinned).toBe(false);
  });

  test("`derived=@x` records sourceVar with the `@` stripped (§51.9)", () => {
    const e = nativeSurface("<engine for=Foo derived=@upstream></engine>").machineDecls[0];
    expect(e.sourceVar).toBe("upstream");
  });

  test("no `derived=` — sourceVar is null", () => {
    const e = nativeSurface("<engine for=Foo></engine>").machineDecls[0];
    expect(e.sourceVar).toBe(null);
  });

  test("`<machine>` sets legacyMachineKeyword; `<engine>` does not", () => {
    expect(
      nativeSurface("<machine for=Foo></engine>").machineDecls[0].legacyMachineKeyword,
    ).toBe(true);
    expect(
      nativeSurface("<engine for=Foo></engine>").machineDecls[0].legacyMachineKeyword,
    ).toBe(false);
  });

  test("`< engine` (space after `<`) sets openerHadSpaceAfterLt", () => {
    expect(
      nativeSurface("< engine for=Foo></engine>").machineDecls[0].openerHadSpaceAfterLt,
    ).toBe(true);
    expect(
      nativeSurface("<engine for=Foo></engine>").machineDecls[0].openerHadSpaceAfterLt,
    ).toBe(false);
  });

  test("bodyChildren is the walkable body (mapped ASTNodes — S163)", () => {
    // S163 — bodyChildren are now mapped ASTNodes (synthEngineNode maps them via
    // mapBlocksToNodes, so a nested <engine> is a structural engine-decl), not
    // raw native blocks. Still a non-empty walkable array.
    const e = nativeSurface("<engine for=Foo>\n.A => .B\n</engine>").machineDecls[0];
    expect(Array.isArray(e.bodyChildren)).toBe(true);
    expect(e.bodyChildren.length).toBeGreaterThan(0);
  });

  test("rulesRaw is the engine body text when source is threaded through", () => {
    // S163 — machineDecls now lives on the FileAST (nativeParseFile threads
    // `source` so rulesRaw is sliced). collectHoisted no longer synthesizes it.
    const src = "<engine for=Foo>\n.A => .B\n</engine>";
    const e = nativeSurface(src).machineDecls[0];
    expect(e.rulesRaw).toBe(".A => .B");
  });

  test("a NESTED engine in a composite state-child is discovered", () => {
    // The walker recurses `children`; a nested `<engine>` inside a composite
    // state-child is found and synthesized as a separate engine-decl.
    const r = nativeSurface(
      "<engine for=Outer>\n<Stopped>\n<engine for=Inner></engine>\n</Stopped>\n</engine>",
    );
    expect(r.machineDecls.length).toBe(2);
    const types = r.machineDecls.map((m) => m.governedType).sort();
    expect(types).toEqual(["Inner", "Outer"]);
    // The two synthesized engines carry distinct ids.
    expect(r.machineDecls[0].id).not.toBe(r.machineDecls[1].id);
  });

  test("an engine nested in `<program>` children is discovered (recursion)", () => {
    const r = nativeSurface(
      "<program>\n<engine for=Foo></engine>\n</program>",
    );
    expect(r.machineDecls.length).toBe(1);
    expect(r.hasProgramRoot).toBe(true);
  });

  test("isExported is false on synthesis (set later by export Form 1 detection)", () => {
    const e = nativeSurface("<engine for=Foo></engine>").machineDecls[0];
    expect(e.isExported).toBe(false);
  });
});

// =============================================================================
// F3 §8 — A3 components SYNTHESIS. A `const Upper = <markup>` declaration is
// synthesized into a ComponentDefNode; a lowercase-initial const is not.
// =============================================================================
describe("F3 §8 — components synthesis", () => {
  test("`const Card = <markup>` synthesizes one component-def", () => {
    const r = nativeSurface('${\nconst Card = <div class="x">hi</div>\n}');
    expect(r.components.length).toBe(1);
    const c = r.components[0];
    expect(c.kind).toBe("component-def");
    expect(c.name).toBe("Card");
    expect(typeof c.id).toBe("number");
  });

  test("component-def.raw is the markup template source slice", () => {
    const r = nativeSurface('${\nconst Card = <div class="x">hi</div>\n}');
    expect(r.components[0].raw).toBe('<div class="x">hi</div>');
  });

  test("a lowercase-initial const is NOT a component", () => {
    const r = nativeSurface('${\nconst card = <div>hi</div>\n}');
    expect(r.components).toEqual([]);
  });

  test("a non-markup const (numeric init) is NOT a component", () => {
    const r = nativeSurface("${\nconst Total = 42\n}");
    expect(r.components).toEqual([]);
  });

  test("a `let`/`var` markup decl is NOT a component (only `const`)", () => {
    const r = nativeSurface("${\nlet Card = <div>hi</div>\n}");
    expect(r.components).toEqual([]);
  });

  test("multiple component defs across one block are all collected", () => {
    const r = nativeSurface(
      "${\nconst Card = <div>a</div>\nconst Panel = <span>b</span>\n}",
    );
    expect(r.components.length).toBe(2);
    expect(r.components.map((c) => c.name).sort()).toEqual(["Card", "Panel"]);
  });
});

// =============================================================================
// F3 §9 — A3 typeDecls SYNTHESIS. A native `TypeDecl` Stmt (B5) is
// synthesized into a TypeDeclNode. An `export type` lands in BOTH typeDecls
// (fromExport) and exports — mirroring the live ast-builder dual-push.
// =============================================================================
describe("F3 §9 — typeDecls synthesis", () => {
  test("`type Name : kind = {...}` synthesizes one type-decl", () => {
    const r = nativeSurface("${\ntype DutyStatus : enum = { OnDuty, OffDuty }\n}");
    expect(r.typeDecls.length).toBe(1);
    const t = r.typeDecls[0];
    expect(t.kind).toBe("type-decl");
    expect(t.name).toBe("DutyStatus");
    expect(t.typeKind).toBe("enum");
    expect(t.raw).toContain("OnDuty");
    expect(typeof t.id).toBe("number");
    expect(t.fromExport).toBe(false);
  });

  test("the `: kind` alias form (no body) synthesizes a type-decl", () => {
    const r = nativeSurface("${\ntype Alias : number\n}");
    expect(r.typeDecls.length).toBe(1);
    expect(r.typeDecls[0].name).toBe("Alias");
    expect(r.typeDecls[0].typeKind).toBe("number");
  });

  test("`export type` lands in BOTH typeDecls (fromExport) and exports", () => {
    const r = nativeSurface('${\nexport type Status : enum = { A, B }\n}');
    expect(r.typeDecls.length).toBe(1);
    expect(r.typeDecls[0].name).toBe("Status");
    expect(r.typeDecls[0].fromExport).toBe(true);
    // The live ast-builder pushes a type-decl AND an export-decl.
    expect(r.exports.length).toBe(1);
    // M6.4a — collectHoisted now synthesizes the LIVE `export-decl` shape
    // (ast.ts:1216) via synthExportDecl so cross-file MOD / api.js
    // consumers can read `exportedName` + `exportKind` directly. Pre-M6.4a
    // the raw native `Export` Stmt was pushed; module-resolver.js L207
    // `if (exp.exportedName)` silently dropped every native-pipeline
    // cross-file export.
    expect(r.exports[0].kind).toBe("export-decl");
    expect(r.exports[0].exportedName).toBe("Status");
    expect(r.exports[0].exportKind).toBe("type");
  });

  test("a plain `export const` does NOT add a type-decl", () => {
    const r = nativeSurface("${\nexport const x = 1\n}");
    expect(r.typeDecls).toEqual([]);
    expect(r.exports.length).toBe(1);
  });

  test("a type decl inside a `^{...}` Meta block is collected (F8 parsed body)", () => {
    const r = nativeSurface("^{\ntype MStatus : struct = { x }\n}");
    expect(r.typeDecls.length).toBe(1);
    expect(r.typeDecls[0].name).toBe("MStatus");
    expect(r.typeDecls[0].typeKind).toBe("struct");
  });

  test("an import inside a Meta block is collected (F8 parsed body)", () => {
    const r = nativeSurface('^{\nimport { x } from "./m.js"\n}');
    expect(r.imports.length).toBe(1);
  });

  test("multiple type decls across one block are all collected", () => {
    const r = nativeSurface(
      "${\ntype A : enum = { X }\ntype B : struct = { y }\n}",
    );
    expect(r.typeDecls.length).toBe(2);
    expect(r.typeDecls.map((t) => t.name).sort()).toEqual(["A", "B"]);
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
    // A3 — engine / type / component parity rows.
    {
      name: "program with one engine",
      src: "<program>\n<engine for=DutyStatus></engine>\n</program>",
    },
    {
      name: "type decl in a logic block",
      src: "${\ntype Status : enum = { A, B }\n}",
    },
    {
      name: "component def in a logic block",
      src: '${\nconst Card = <div>hi</div>\n}',
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

    test(`[parity] ${row.name} — machineDecls / typeDecls / components count agrees`, () => {
      const native = nativeSurface(row.src);
      const live = liveSurface(row.src);
      expect(native.machineDecls.length).toBe(live.machineDecls.length);
      expect(native.typeDecls.length).toBe(live.typeDecls.length);
      expect(native.components.length).toBe(live.components.length);
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
      // A3 — the three collections are now SYNTHESIZED; every entry is a
      // well-formed declaration node (the kind tag + a numeric BaseNode id).
      for (const e of surface.machineDecls) {
        expect(e.kind).toBe("engine-decl");
        expect(typeof e.id).toBe("number");
      }
      for (const t of surface.typeDecls) {
        expect(t.kind).toBe("type-decl");
        expect(typeof t.id).toBe("number");
      }
      for (const c of surface.components) {
        expect(c.kind).toBe("component-def");
        expect(typeof c.id).toBe("number");
      }
    });
  }
});
