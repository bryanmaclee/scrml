// m65-b3-hoist-gap.test.js — M6.5.b.3 regression-lock for the Class C hoist gap.
//
// CLASS C (SCOPING §1 Class C): the native `collectHoisted`
// (compiler/native-parser/collect-hoisted.js) must reach declarations that
// live INSIDE a `<program>` / `<page>` body — imports / exports / typeDecls /
// component-const-decls / machineDecls / channelDecls — exactly as the live
// pipeline's `collectHoisted` (compiler/src/ast-builder.js ~L11903) does. When
// the recursion misses them, all 13 downstream consumers (name-resolver,
// type-system, component-expander, auth-graph, ...) silently see ZERO decls —
// a "silent functional shutdown of half the pipeline" for any
// `<program>`-wrapped file.
//
// PHASE-0 FINDING (M6.5.b.3, HEAD 0e0b4498): the STRUCTURAL recursion gap the
// SCOPING agent hypothesized (S125, base 404fc619) is ALREADY CLOSED — the
// `liftBareBlocks` + A3 collect-hoisted synthesis landed before this unit.
// `walkBlocks` (collect-hoisted.js:138-140) recurses `Markup.children`, so a
// `<program>`-body `LogicEscape` / `Meta` is reached and `walkStmts` collects
// its decls. This file therefore REGRESSION-LOCKS the now-correct behavior:
// the only canary that would catch a regression here (within-node
// COUNT-LENGTH) is permissive/allowlisted, so without these assertions a
// re-introduced gap would land silently.
//
// DRIVER: this mirrors the PRODUCTION path in parse-file.js exactly —
//   parseMarkupTrace(src) -> ctx.nodes (rawBlocks)
//   liftBareBlocks(rawBlocks, src, null, ctx)   (the bare-decl auto-lift)
//   collectHoisted(blocks, idGen, src)
// so the `<program>`/`<page>`-body decls are walked the way production walks
// them (NOT the `parseMarkup`-only driver the F3 conformance file uses, which
// skips the lift and so cannot exercise the bare-auto-lift case).

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMarkupTrace, liftBareBlocks } from "../../native-parser/parse-markup.js";
import { collectHoisted, hasProgramRoot } from "../../native-parser/collect-hoisted.js";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// nativeSurface — drive the native parser + collectHoisted via the PRODUCTION
// path (parse-file.js steps 1/1b/3). `liftBareBlocks` is the load-bearing
// step for the bare-auto-lift case; without it a bare top-level `type Foo`
// would stay a `Text` block and never be hoisted.
function nativeSurface(source) {
  const run = parseMarkupTrace(source);
  const ctx = run && run.ctx ? run.ctx : null;
  const rawBlocks = ctx && Array.isArray(ctx.nodes) ? ctx.nodes : [];
  const blocks = liftBareBlocks(rawBlocks, source, null, ctx);
  return collectHoisted(blocks, { next: 0 }, source);
}

// liveSurface — the live oracle. buildAST lifts the hoisted collections onto
// the FileAST as top-level fields.
function liveSurface(source, filePath = "conf.scrml") {
  const { ast } = buildAST(splitBlocks(filePath, source));
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

// =============================================================================
// §1 — <program>-body decls inside an explicit ${...} logic block. This is the
// 22-multifile shape: the recursion must descend Markup<program>.children into
// the LogicEscape and collect the imports + the const-component.
// =============================================================================
describe("M6.5.b.3 §1 — <program>-body ${...} decls are hoisted", () => {
  const PROGRAM_LOGIC = [
    "<program>",
    "  ${",
    '    import { UserRole } from "./types.scrml"',
    '    import { UserBadge } from "./components.scrml"',
    "    type Status:enum = { On, Off }",
    "    const Badge = <span>hi</span>",
    "  }",
    "</program>",
  ].join("\n");

  test("imports inside a <program>-body ${...} are collected (not 0)", () => {
    const r = nativeSurface(PROGRAM_LOGIC);
    expect(r.imports.length).toBe(2);
    expect(r.imports.map((i) => i.source).sort()).toEqual(
      ["./components.scrml", "./types.scrml"],
    );
    // import-decl synthesized shape — names readable by NR/MOD/api.js.
    expect(r.imports.every((i) => i.kind === "import-decl")).toBe(true);
  });

  test("a type-decl inside a <program>-body ${...} is collected", () => {
    const r = nativeSurface(PROGRAM_LOGIC);
    expect(r.typeDecls.length).toBe(1);
  });

  test("a const-component inside a <program>-body ${...} is collected", () => {
    const r = nativeSurface(PROGRAM_LOGIC);
    expect(r.components.length).toBe(1);
    expect(r.components[0].name).toBe("Badge");
  });

  test("hasProgramRoot is true for a top-level <program>", () => {
    const r = nativeSurface(PROGRAM_LOGIC);
    expect(r.hasProgramRoot).toBe(true);
  });

  test("native surface matches the live oracle for the <program>-logic shape", () => {
    const n = nativeSurface(PROGRAM_LOGIC);
    const l = liveSurface(PROGRAM_LOGIC);
    expect(n.imports.length).toBe(l.imports.length);
    expect(n.typeDecls.length).toBe(l.typeDecls.length);
    expect(n.components.length).toBe(l.components.length);
    expect(n.hasProgramRoot).toBe(l.hasProgramRoot);
  });
});

// =============================================================================
// §2 — bare auto-lifted decls at <program> direct-child position (§40.8
// default-logic mode: a bare `type` / `import` auto-lifts). This exercises the
// liftBareBlocks path (a bare `Text` decl line -> synthetic LogicEscape ->
// walked).
// =============================================================================
describe("M6.5.b.3 §2 — bare auto-lifted <program>-body decls are hoisted", () => {
  const PROGRAM_BARE = [
    "<program>",
    "  type Color:enum = { Red, Green, Blue }",
    "</program>",
  ].join("\n");

  test("a bare type-decl at <program> direct-child position is collected", () => {
    const n = nativeSurface(PROGRAM_BARE);
    const l = liveSurface(PROGRAM_BARE);
    // Lock parity with the live oracle (whatever the live auto-lift produces,
    // native must match — defends against a regression in liftBareBlocks).
    expect(n.typeDecls.length).toBe(l.typeDecls.length);
    expect(n.hasProgramRoot).toBe(true);
  });
});

// =============================================================================
// §3 — <page>-body decls. Same recursion path; <page> is the per-route
// container (§40.8 multi-page). A type-decl inside a <page>-body ${...} must be
// collected.
// =============================================================================
describe("M6.5.b.3 §3 — <page>-body ${...} decls are hoisted", () => {
  const PAGE_LOGIC = [
    "<page>",
    "  ${",
    '    import { Helper } from "./helper.scrml"',
    "    type Tab:enum = { A, B }",
    "  }",
    "</page>",
  ].join("\n");

  test("an import + type-decl inside a <page>-body ${...} are collected", () => {
    const r = nativeSurface(PAGE_LOGIC);
    expect(r.imports.length).toBe(1);
    expect(r.imports[0].source).toBe("./helper.scrml");
    expect(r.typeDecls.length).toBe(1);
  });

  test("hasProgramRoot is FALSE for a <page>-only file (no <program>)", () => {
    const r = nativeSurface(PAGE_LOGIC);
    expect(r.hasProgramRoot).toBe(false);
  });
});

// =============================================================================
// §4 — channel decls inside <program>. The native walker pushes a Markup block
// named "channel" to channelDecls; it must be discovered via the
// <program>.children recursion (not only at top level).
// =============================================================================
describe("M6.5.b.3 §4 — <channel> inside <program> reaches channelDecls", () => {
  const PROGRAM_CHANNEL = [
    "<program>",
    '  <channel name="presence">',
    "    <online> = []",
    "  </channel>",
    "</program>",
  ].join("\n");

  test("a <channel> nested in <program> is collected via recursion", () => {
    const r = nativeSurface(PROGRAM_CHANNEL);
    expect(r.channelDecls.length).toBe(1);
    expect(r.hasProgramRoot).toBe(true);
  });
});

// =============================================================================
// §5 — MUST-NOT: no double-count + hasProgramRoot stays TOP-LEVEL-only. The
// brief's invariant (collect-hoisted.js:110-113): a NESTED <program> must NOT
// flip hasProgramRoot, and a decl reachable via one path must not be counted
// twice. §43 admits a nested <program> (worker/sidecar boundary).
// =============================================================================
describe("M6.5.b.3 §5 — nested <program> no-double-count + top-level-only flag", () => {
  // A top-level <page> with a NESTED <program> inside its body. The nested
  // program is NOT the top-level root.
  const NESTED_PROGRAM = [
    "<page>",
    "  <program>",
    "    ${",
    '      import { Inner } from "./inner.scrml"',
    "    }",
    "  </program>",
    "</page>",
  ].join("\n");

  test("a NESTED <program> does NOT flip hasProgramRoot (top-level is <page>)", () => {
    const r = nativeSurface(NESTED_PROGRAM);
    // Top-level block is <page>, not <program> -> hasProgramRoot must be false.
    expect(r.hasProgramRoot).toBe(false);
    // The standalone predicate must agree (both are top-level-only).
    const run = parseMarkupTrace(NESTED_PROGRAM);
    const blocks = liftBareBlocks(run.ctx.nodes, NESTED_PROGRAM, null, run.ctx);
    expect(hasProgramRoot(blocks)).toBe(false);
  });

  test("the inner import is collected exactly ONCE (no double-count)", () => {
    const r = nativeSurface(NESTED_PROGRAM);
    expect(r.imports.length).toBe(1);
    expect(r.imports[0].source).toBe("./inner.scrml");
  });

  // A file whose ONLY <program> is nested must still report hasProgramRoot
  // per the top-level rule (false), even though a <program> exists in the tree.
  test("a file with ONLY a nested <program> reports hasProgramRoot=false", () => {
    const ONLY_NESTED = [
      "<div>",
      "  <program>",
      "    ${ type X:enum = { A } }",
      "  </program>",
      "</div>",
    ].join("\n");
    const r = nativeSurface(ONLY_NESTED);
    expect(r.hasProgramRoot).toBe(false);
    // ...but the nested type-decl is still discovered by the recursion.
    expect(r.typeDecls.length).toBe(1);
  });
});

// =============================================================================
// §6 — regression sentinels on the two brief-cited example files. These are
// the exact divergences the SCOPING agent measured at base 404fc619 (native
// 0 vs live N). They are CLOSED at HEAD; this locks them closed.
// =============================================================================
describe("M6.5.b.3 §6 — brief-cited example fixtures match the live oracle", () => {
  function exampleSurfaces(relpath) {
    const fp = join(REPO_ROOT, relpath);
    const src = readFileSync(fp, "utf8");
    return { n: nativeSurfaceFromFile(fp, src), l: liveSurface(src, fp) };
  }
  function nativeSurfaceFromFile(fp, src) {
    const run = parseMarkupTrace(src);
    const ctx = run && run.ctx ? run.ctx : null;
    const rawBlocks = ctx && Array.isArray(ctx.nodes) ? ctx.nodes : [];
    const blocks = liftBareBlocks(rawBlocks, src, null, ctx);
    return collectHoisted(blocks, { next: 0 }, src);
  }

  test("examples/22-multifile/app.scrml — imports match live (was native 0)", () => {
    const { n, l } = exampleSurfaces("examples/22-multifile/app.scrml");
    expect(l.imports.length).toBe(2); // live oracle
    expect(n.imports.length).toBe(l.imports.length); // native parity
  });

  test("examples/14-mario-state-machine.scrml — typeDecls + machineDecls match live (was native 0)", () => {
    const { n, l } = exampleSurfaces("examples/14-mario-state-machine.scrml");
    expect(l.typeDecls.length).toBe(3); // live oracle
    expect(n.typeDecls.length).toBe(l.typeDecls.length);
    expect(l.machineDecls.length).toBe(2);
    expect(n.machineDecls.length).toBe(l.machineDecls.length);
  });
});
