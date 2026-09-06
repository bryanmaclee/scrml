/**
 * file-shape classification — Unit Tests
 *
 * change-id: entry-ness-unification-2026-09-05
 *
 * `library-shape.js:classifyFileShape` is the ONE place the compiler decides
 * "what kind of document is this `.scrml` file?". Before it existed, that
 * decision was made in five places: two local `const`s in `ast-builder.js` that
 * were computed, used by a single `if`, and DISCARDED when `buildAST` returned,
 * plus four hand copies downstream (api.js W5a, tool-program.ts
 * `isLibraryShapedFile`, and codegen/index.ts's non-entry-page detection whose
 * comment cited an `ast-builder.js` line number ~7,700 lines stale). Only
 * `hasProgramRoot` — the weakest signal — survived onto the FileAST.
 *
 * Coverage:
 *   §1  the variant set is CLOSED and exhaustive (every file gets exactly one)
 *   §2  each variant classifies from a real compiled fixture
 *   §3  PURE-CHANNEL-FILE (SPEC §38.12.6) — the shape neither legacy predicate
 *       had, and the four canonical flagship channel files that fired for it
 *   §4  W-PROGRAM-001 fires on exactly `"bare-markup"` — two-sided
 *   §5  precedence: the channel+page overlap resolves as `"non-entry-page"`,
 *       preserving the pre-existing `isNonEntryPageFile` behaviour
 *   §6  the recorded fact reaches the FileAST through the PRECG seam
 *   §7  ⚑ the classification is NOT an entry-ness claim (SPEC §40.8)
 *   §8  CE RE-STAMPS rather than spread-inheriting the pre-CE answer
 *   §9  the classifier is self-consistent (never blindly trusts hasProgramRoot)
 *  §10  isLibraryShapedFile reads nodes and flags from the SAME nesting level
 *  §11  nullish-node POLARITY matches the legacy predicates exactly
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

import { FILE_SHAPES as FILE_SHAPES_CANONICAL } from "../../src/types/ast.ts";
import {
  isForeignLangLibDecl,
  classifyFileShape,
  isRecognizedNonEntryShape,
  isLibraryShape,
  FILE_SHAPES,
} from "../../src/library-shape.js";
import { computeFileShape } from "../../src/compute-pgo-flags.ts";
import { runCEFile } from "../../src/component-expander.js";
import { isLibraryShapedFile } from "../../src/tool-program.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

/** Build a real FileAST from source text, exactly as the TAB does. */
function tab(source, filePath = "/virtual/probe.scrml") {
  const out = buildAST(splitBlocks(filePath, source), null);
  return { ast: out?.ast ?? out, errors: out?.errors ?? [] };
}

/** How many W-PROGRAM-001 diagnostics did this source raise? */
function wProgram001(source, filePath) {
  return tab(source, filePath).errors.filter((e) => e && e.code === "W-PROGRAM-001").length;
}

/** Classify a source string the way the compiler does. */
function shapeOf(source, filePath) {
  const { ast } = tab(source, filePath);
  return classifyFileShape(ast.nodes ?? [], ast.hasProgramRoot === true);
}

// The four canonical PURE-CHANNEL-FILEs in the flagship app. Each one
// self-documents as such in its own header comment, and each fired a spurious
// W-PROGRAM-001 before this change.
const FLAGSHIP_CHANNELS = [
  "customer-events",
  "dispatch-board",
  "driver-events",
  "load-events",
].map((n) => join(REPO, "examples/23-trucking-dispatch/channels", `${n}.scrml`));

// ---------------------------------------------------------------------------
// §1 — the variant set is CLOSED
// ---------------------------------------------------------------------------

describe("§1 file-shape variant set is closed and exhaustive", () => {
  test("the runtime array and the compile-time union have ONE definition, not two", () => {
    // `FILE_SHAPES` is defined once in `types/ast.ts`; `FileShape` is derived
    // from it as `(typeof FILE_SHAPES)[number]`; `library-shape.js` RE-EXPORTS
    // the same frozen object. Identity is the whole point — if someone pastes a
    // second literal list into either module, these stop being the same object
    // and this fails. (A `toEqual` would NOT catch that; it has to be identity.)
    expect(FILE_SHAPES).toBe(FILE_SHAPES_CANONICAL);
  });

  test("FILE_SHAPES is the frozen, exhaustive variant list", () => {
    expect(FILE_SHAPES).toEqual([
      "program",
      "pure-module",
      "pure-channel",
      "non-entry-page",
      "bare-markup",
    ]);
    expect(Object.isFrozen(FILE_SHAPES)).toBe(true);
  });

  test("every classification result is a member of the closed set", () => {
    const sources = [
      "<program>\n  <h1>hi</h1>\n</program>",
      "${ export function f() { return 1 } }",
      'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>',
      '<page auth="required">\n  <h1>route</h1>\n</page>',
      "<h1>loose</h1>",
      "",
    ];
    for (const src of sources) {
      expect(FILE_SHAPES).toContain(shapeOf(src));
    }
  });

  test("an EMPTY node list is `bare-markup`, not a module — an empty file exports nothing", () => {
    expect(classifyFileShape([], false)).toBe("bare-markup");
    // …and it therefore still warns, rather than being silently blessed.
    expect(isRecognizedNonEntryShape(classifyFileShape([], false))).toBe(false);
  });

  test("hasProgramRoot short-circuits every other branch", () => {
    // Even a node list that would otherwise read as a page.
    const pageish = [{ kind: "markup", tag: "page" }];
    expect(classifyFileShape(pageish, true)).toBe("program");
    expect(classifyFileShape(pageish, false)).toBe("non-entry-page");
  });
});

// ---------------------------------------------------------------------------
// §2 — each variant classifies from real compiled source
// ---------------------------------------------------------------------------

describe("§2 each variant classifies from real source", () => {
  test('a top-level <program> is "program"', () => {
    expect(shapeOf("<program>\n  <h1>hi</h1>\n</program>")).toBe("program");
  });

  test('a §21.5 declarations-only file is "pure-module"', () => {
    expect(shapeOf("${ export function double(n) { return n * 2 } }")).toBe("pure-module");
  });

  test('a §40.8 route file is "non-entry-page"', () => {
    expect(shapeOf('<page auth="required">\n  <h1>route</h1>\n</page>')).toBe("non-entry-page");
  });

  test('loose markup with no wrapper is "bare-markup"', () => {
    expect(shapeOf("<h1>Hello</h1>\n<p>no wrapper anywhere</p>")).toBe("bare-markup");
  });
});

// ---------------------------------------------------------------------------
// §3 — PURE-CHANNEL-FILE, SPEC §38.12.6
// ---------------------------------------------------------------------------

describe("§3 PURE-CHANNEL-FILE (SPEC §38.12.6)", () => {
  test('a file-top `export <channel>` with no <program> is "pure-channel"', () => {
    const src = 'export <channel name="presence">\n    ${\n        <online> = []\n    }\n</>';
    expect(shapeOf(src)).toBe("pure-channel");
  });

  test("the `export` keyword does NOT change the shape — a bare file-top <channel> is also pure-channel", () => {
    // SPEC §38.1's Insight-30 dispensation keys on "a file that contains no
    // <program> element anywhere", NOT on the `export` prefix. Classifying the
    // two differently would let a keyword decide a file's kind.
    const bare = '<channel name="presence">\n    ${\n        <online> = []\n    }\n</>';
    expect(shapeOf(bare)).toBe("pure-channel");
  });

  test("all four canonical flagship channel files classify as pure-channel", () => {
    for (const f of FLAGSHIP_CHANNELS) {
      const src = readFileSync(f, "utf8");
      expect({ file: f, shape: shapeOf(src, f) }).toEqual({ file: f, shape: "pure-channel" });
    }
  });

  test("a channel file alongside LOOSE page markup is NOT pure-channel", () => {
    // The suppression must not become "any file with a channel in it".
    const src =
      'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>\n\n<h1>loose page markup</h1>';
    expect(shapeOf(src)).toBe("bare-markup");
  });
});

// ---------------------------------------------------------------------------
// §4 — W-PROGRAM-001 fires on exactly one shape. TWO-SIDED.
// ---------------------------------------------------------------------------

describe("§4 W-PROGRAM-001 fires iff the shape is bare-markup", () => {
  test("SUPPRESSED: the four flagship PURE-CHANNEL-FILEs fire zero (was 1 each)", () => {
    for (const f of FLAGSHIP_CHANNELS) {
      const src = readFileSync(f, "utf8");
      expect({ file: f, fires: wProgram001(src, f) }).toEqual({ file: f, fires: 0 });
    }
  });

  test("SUPPRESSED: pure-module and non-entry-page, as before this change", () => {
    expect(wProgram001("${ export function f() { return 1 } }")).toBe(0);
    expect(wProgram001('<page auth="required">\n  <h1>r</h1>\n</page>')).toBe(0);
  });

  test("SUPPRESSED: a file that declares its own <program>", () => {
    expect(wProgram001("<program>\n  <h1>hi</h1>\n</program>")).toBe(0);
  });

  test("STILL FIRES: a genuinely wrapper-less non-canonical document", () => {
    expect(wProgram001("<h1>Hello</h1>\n<p>A wrapper-less document.</p>")).toBe(1);
  });

  test("STILL FIRES: a channel PLUS loose page markup — the suppression is not a blanket", () => {
    const src =
      'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>\n\n<h1>loose</h1>';
    expect(wProgram001(src)).toBe(1);
  });

  test("the fire condition and the suppression set are complements, by construction", () => {
    for (const shape of FILE_SHAPES) {
      const suppressed = isRecognizedNonEntryShape(shape) || shape === "program";
      expect({ shape, suppressed }).toEqual({
        shape,
        suppressed: shape !== "bare-markup",
      });
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — precedence on the one real overlap
// ---------------------------------------------------------------------------

describe("§5 channel+page precedence is behaviour-preserving", () => {
  test('a file with BOTH a top-level <page> and a top-level <channel> is "non-entry-page"', () => {
    // This is the flagship's "channel+page" shape. The legacy `isNonEntryPageFile`
    // won this overlap (it only asked "is there a top-level <page>?"), and the
    // classification preserves that precedence rather than quietly re-deciding it.
    const nodes = [
      { kind: "markup", tag: "channel" },
      { kind: "markup", tag: "page" },
    ];
    expect(classifyFileShape(nodes, false)).toBe("non-entry-page");
    // Order-independent — it is a precedence rule, not a first-node rule.
    expect(classifyFileShape([...nodes].reverse(), false)).toBe("non-entry-page");
  });
});

// ---------------------------------------------------------------------------
// §6 — the fact is RECORDED, which is the point of the change
// ---------------------------------------------------------------------------

describe("§6 fileShape is recorded on the FileAST at the PRECG seam", () => {
  test("computeFileShape stamps the classification onto the FileAST", () => {
    const { ast } = tab('export <channel name="c">\n    ${\n        <x> = []\n    }\n</>');
    computeFileShape(ast);
    expect(ast.fileShape).toBe("pure-channel");
  });

  test("the stamped value equals what the TAB used for its own W-PROGRAM-001 decision", () => {
    // One classifier, two call sites, same `nodes` — they cannot disagree.
    const src = "<h1>loose</h1>";
    const { ast, errors } = tab(src);
    computeFileShape(ast);
    const fires = errors.filter((e) => e && e.code === "W-PROGRAM-001").length;
    expect({ shape: ast.fileShape, fires }).toEqual({ shape: "bare-markup", fires: 1 });
  });

  test("computeFileShape is defensive about a non-object input", () => {
    expect(() => computeFileShape(null)).not.toThrow();
    expect(() => computeFileShape(undefined)).not.toThrow();
  });

  test("isLibraryShape needs BOTH pure-module shape and an export", () => {
    // The export requirement is what separates an importable library from a
    // bare declaration fragment that has nothing to import.
    expect(isLibraryShape("pure-module", [{}])).toBe(true);
    expect(isLibraryShape("pure-module", [])).toBe(false);
    expect(isLibraryShape("pure-channel", [{}])).toBe(false);
    expect(isLibraryShape("program", [{}])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7 — the boundary of the claim
// ---------------------------------------------------------------------------

describe("§7 fileShape is a FILE fact, not an ENTRY claim", () => {
  test('⚑ no variant is named "entry", and that is deliberate (SPEC §40.8)', () => {
    // SPEC §40.8: "The entry file is the file resolved by the build root."
    // Entry identity is a BUILD fact; no single FileAST can carry it. A variant
    // called "entry" would re-encode the exact conflation this change removed.
    expect(FILE_SHAPES).not.toContain("entry");
  });

  test('"program" is not unique within a compile unit — the compiler does not enforce it', () => {
    // SPEC §40.8 reserves E-PROGRAM-002 for a second top-level <program> in a
    // non-entry file but calls it "TBD — not part of Wave 1", and it is
    // unimplemented. So two files in one build can BOTH classify "program", and
    // any consumer picking "the entry" by first-match is making a build-level
    // decision this classification does not make for it.
    const a = shapeOf("<program>\n  <h1>a</h1>\n</program>", "/virtual/a.scrml");
    const b = shapeOf("<program>\n  <h1>b</h1>\n</program>", "/virtual/b.scrml");
    expect([a, b]).toEqual(["program", "program"]);
  });
});

// ---------------------------------------------------------------------------
// §8 — CE re-stamps. Regression pin for the fix-round finding.
// ---------------------------------------------------------------------------

describe("§8 component-expansion re-stamps fileShape instead of inheriting it", () => {
  test("a STALE fileShape planted before CE is re-derived, not carried forward", () => {
    // `component-expander.ts` rebuilds the FileAST as `{ ...ast, nodes: phase2Nodes }`.
    // The spread would carry the PRE-CE `fileShape` forward while `nodes` is
    // replaced on the next line, handing every post-CE consumer a fact about an
    // AST nobody holds any more. This plants a deliberately wrong value and
    // asserts CE overwrites it — which bites exactly on the re-stamp line and
    // needs no cross-file channel plumbing to do it.
    //
    // The fixture MUST carry a component so CE actually enters the expansion
    // path. `runCEFile` has a no-op early return for a file with no component
    // defs / refs / imported components / imported channels, and that path
    // returns the ORIGINAL `ast` with `nodes` untouched -- where the pre-CE
    // shape is still correct and there is nothing to re-stamp. A fixture that
    // takes the early return would pass this test with the fix REMOVED.
    const DOLLAR = String.fromCharCode(36);
    const source =
      DOLLAR + '{ const Badge = <span class="badge">hi</span> }\n' +
      "<program>\n  <Badge/>\n</program>";
    const tabOut = buildAST(splitBlocks("/virtual/restamp.scrml", source));
    const inner = tabOut.ast ?? tabOut;
    expect(inner.components.length).toBeGreaterThan(0); // proves we enter expansion
    inner.fileShape = "pure-module"; // a lie; this file is `program`
    const { ast } = runCEFile(tabOut);
    expect(ast.fileShape).toBe("program");
  });

  test("post-CE, the recorded shape agrees with the nodes the AST actually holds", () => {
    // The general invariant the re-stamp exists to maintain, stated over the
    // whole variant set rather than one example.
    const sources = [
      "<program>\n  <h1>hi</h1>\n</program>",
      "${ export function f() { return 1 } }",
      '<page auth="required">\n  <h1>route</h1>\n</page>',
      "<h1>loose</h1>",
      'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>',
    ];
    for (const src of sources) {
      const tabOut = buildAST(splitBlocks("/virtual/inv.scrml", src));
      computeFileShape(tabOut.ast ?? tabOut);
      const { ast } = runCEFile(tabOut);
      expect({
        src: src.slice(0, 24),
        recorded: ast.fileShape,
      }).toEqual({
        src: src.slice(0, 24),
        recorded: classifyFileShape(ast.nodes ?? [], ast.hasProgramRoot === true),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// §9 — the fallback path's inputs. Fix-round regression pin.
// ---------------------------------------------------------------------------

describe("§9 the classifier is SELF-CONSISTENT — it does not blindly trust hasProgramRoot", () => {
  test("a <program>-bearing node list classifies `program` even when told hasProgramRoot=false", () => {
    // ⛑ THIS TEST PREVIOUSLY PINNED THE OPPOSITE, AS EXPECTED BEHAVIOUR.
    // It asserted `classifyFileShape([program, page], false) === "non-entry-page"`
    // and called that "the wrong answer" in a comment — documenting a hazard
    // instead of removing it. `hasProgramRoot` is a PARAMETER, and the function
    // never looked at `nodes` to cross-check it, so any caller pairing a node
    // list with a `hasProgramRoot` read from a different object got a wrong
    // answer. That is one hardened caller and N unhardened ones.
    //
    // The guard makes the disagreement unrepresentable at the source, so every
    // fallback call site is immunized at once.
    const nodes = [{ kind: "markup", tag: "program" }, { kind: "markup", tag: "page" }];
    expect(classifyFileShape(nodes, false)).toBe("program");
    expect(classifyFileShape(nodes, true)).toBe("program");
  });

  test("the guard is DEAD on every correctly-paired call — it changes no real classification", () => {
    // The TAB derives hasProgramRoot as exactly
    // `nodes.some(n => n.kind === "markup" && n.tag === "program")`. So on a
    // consistent pair the guard can never be what decides the answer: either
    // the early return already fired, or there is no program node to find.
    // This is what makes the guard behaviour-preserving rather than a widening.
    const sources = [
      "<program>\n  <h1>hi</h1>\n</program>",
      "${ export function f() { return 1 } }",
      '<page auth="required">\n  <h1>r</h1>\n</page>',
      "<h1>loose</h1>",
      'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>',
    ];
    for (const src of sources) {
      const { ast } = tab(src);
      const nodes = ast.nodes ?? [];
      const derived = nodes.some((n) => n && n.kind === "markup" && n.tag === "program");
      expect({ src: src.slice(0, 20), hpr: ast.hasProgramRoot === true }).toEqual({
        src: src.slice(0, 20),
        hpr: derived,
      });
    }
  });

  test("an unstamped pure-channel file still classifies correctly via the fallback", () => {
    const src = 'export <channel name="c">\n    ${\n        <x> = []\n    }\n</>';
    const { ast } = tab(src);
    expect(ast.fileShape).toBeUndefined(); // the TAB deliberately does not stamp
    expect(classifyFileShape(ast.nodes ?? [], ast.hasProgramRoot === true)).toBe("pure-channel");
  });
});

// ---------------------------------------------------------------------------
// §10 — one object, all fields. Fix-round regression pin.
// ---------------------------------------------------------------------------

describe("§10 isLibraryShapedFile does not mix nesting levels", () => {
  test("on the mixed wrapper shape, nodes and flags come from the SAME object", () => {
    // `getToolNodes` prefers the OUTER `nodes`; the old code read `fileShape` /
    // `hasProgramRoot` / `exports` from `f.ast`. On `{ ast: {...}, nodes: [...] }`
    // it therefore classified the OUTER node list against the INNER flags.
    //
    // Here the OUTER object is a genuine library (declarations only, exports
    // present) while the INNER one is a page with no exports. Reading the outer
    // nodes against the inner flags is what produced a wrong answer; reading
    // everything from the object that owns the winning node list is correct.
    const mixed = {
      filePath: "/virtual/mixed.scrml",
      nodes: [{ kind: "logic-decl" }],
      exports: [{ name: "f" }],
      hasProgramRoot: false,
      ast: {
        nodes: [{ kind: "markup", tag: "page" }],
        exports: [],
        hasProgramRoot: false,
      },
    };
    // Outer wins the node list, so outer's exports + flags must decide.
    expect(isLibraryShapedFile(mixed)).toBe(true);
  });

  test("the plain wrapped shape still resolves to the inner FileAST", () => {
    const wrapped = {
      filePath: "/virtual/wrapped.scrml",
      ast: {
        nodes: [{ kind: "logic-decl" }],
        exports: [{ name: "f" }],
        hasProgramRoot: false,
      },
    };
    expect(isLibraryShapedFile(wrapped)).toBe(true);
  });

  test("the flat shape still works, and a <program> file is never library-shaped", () => {
    expect(
      isLibraryShapedFile({
        filePath: "/virtual/flat.scrml",
        nodes: [{ kind: "logic-decl" }],
        exports: [{ name: "f" }],
        hasProgramRoot: false,
      }),
    ).toBe(true);
    // The §9 guard: a program-bearing node list is `program`, so never a
    // library — and that now holds even if `hasProgramRoot` is understated.
    expect(
      isLibraryShapedFile({
        filePath: "/virtual/prog.scrml",
        nodes: [{ kind: "markup", tag: "program" }],
        exports: [{ name: "f" }],
        hasProgramRoot: false,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §11 — polarity fidelity against the legacy predicates. Fix-round pin.
// ---------------------------------------------------------------------------

// The two predicates this classifier replaced, transcribed from
// `git show origin/main:compiler/src/ast-builder.js`. Note the SHAPES:
// `isPureModuleFile` is `every`-based (so `n &&` makes a nullish node
// DISQUALIFYING), `isNonEntryPageFile` is `some`-based (so a nullish node is
// simply skipped). That asymmetry is real and the classifier must reproduce it.
const legacyIsPureModuleFile = (nodes, hasProgramRoot) =>
  !hasProgramRoot &&
  nodes.length > 0 &&
  nodes.every((n) => n && (n.kind !== "markup" || isForeignLangLibDecl(n)));

const legacyIsNonEntryPageFile = (nodes, hasProgramRoot) =>
  !hasProgramRoot &&
  nodes.some((n) => n && n.kind === "markup" && n.tag === "page");

describe("§11 nullish top-level nodes keep their legacy polarity", () => {
  test("a nullish node DISQUALIFIES pure-module, exactly as the legacy `every` did", () => {
    const nodes = [null, { kind: "logic-decl" }];
    expect(legacyIsPureModuleFile(nodes, false)).toBe(false); // legacy: warns
    expect(classifyFileShape(nodes, false)).toBe("bare-markup"); // so: still warns
    expect(isRecognizedNonEntryShape(classifyFileShape(nodes, false))).toBe(false);
  });

  test("a nullish node does NOT disqualify non-entry-page, exactly as the legacy `some` did", () => {
    const nodes = [null, { kind: "markup", tag: "page" }];
    expect(legacyIsNonEntryPageFile(nodes, false)).toBe(true); // legacy: suppressed
    expect(classifyFileShape(nodes, false)).toBe("non-entry-page"); // so: still suppressed
  });

  test("the same polarity governs pure-channel, the other `every`-shaped branch", () => {
    expect(classifyFileShape([{ kind: "markup", tag: "channel" }], false)).toBe("pure-channel");
    expect(classifyFileShape([null, { kind: "markup", tag: "channel" }], false)).toBe("bare-markup");
  });

  test("polarity agrees with the legacy predicates across a nullish-free matrix", () => {
    const cases = [
      [{ kind: "logic-decl" }],
      [{ kind: "markup", tag: "page" }],
      [{ kind: "markup", tag: "channel" }],
      [{ kind: "markup", tag: "div" }],
      [{ kind: "logic-decl" }, { kind: "markup", tag: "page" }],
    ];
    for (const nodes of cases) {
      const shape = classifyFileShape(nodes, false);
      expect({ nodes, pure: shape === "pure-module" }).toEqual({
        nodes,
        pure: legacyIsPureModuleFile(nodes, false),
      });
      // `non-entry-page` wins the page/channel overlap, same as legacy.
      if (legacyIsNonEntryPageFile(nodes, false)) expect(shape).toBe("non-entry-page");
    }
  });
});
