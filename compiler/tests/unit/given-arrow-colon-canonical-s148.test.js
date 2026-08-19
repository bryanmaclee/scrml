// given-arrow-colon-canonical-s148.test.js — S148 / change-id
// match-given-colon-2026-05-31.
//
// SPEC §42.2.3 / §34: the canonical STANDALONE `given` presence-guard separator
// is `:>`. `=>` is a DEPRECATED alias accepted during the deprecation window —
// it parses, builds, and emits identically to `:>`, and surfaces the info-level
// lint `W-GIVEN-ARROW-LEGACY`. The lint + the migrate rewrite are SCOPED to the
// `given`-guard separator only: a JS arrow-function `=>` is never touched, and
// an in-`match` `given`-arm fires `W-MATCH-ARROW-LEGACY` instead (no double-fire).
//
// This file verifies, end to end:
//   §A — the separator glyph is PRESERVED on the built given-guard node
//        (`separatorGlyph`) for `:>` and `=>`, single- and multi-variable.
//   §B — W-GIVEN-ARROW-LEGACY fires for `=>` standalone given guards (info),
//        does NOT fire for `:>`, and does NOT fire on a JS arrow-fn `=>` in the
//        same file. Confirms the info-level diagnostic-stream partition (S93).
//   §C — no cross-contamination: an in-`match` `given x => ...` arm fires
//        W-MATCH-ARROW-LEGACY (via its sibling arms) but NOT W-GIVEN-ARROW-LEGACY.
//   §D — `migrate --fix` (rewriteGivenGuardArrows) rewrites `given x => { ... }` →
//        `given x :> { ... }` byte-exactly; lambdas + fn-returns untouched;
//        idempotent.
//   §E — `given x :>` and `given x =>` emit IDENTICAL JS (separator is parse-only;
//        zero codegen cost).

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { rewriteGivenGuardArrows } from "../../src/commands/migrate.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "given-colon-s148-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function compile(filename, source) {
  const abs = fx(filename, source);
  return compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream diagnostic collector. W-/I- codes land in result.warnings via the
// S93 partition; never assert against result.errors alone for a W- code.
function allDiags(result) {
  return [...(result.errors || []), ...(result.warnings || []), ...(result.lintDiagnostics || [])];
}
function diagsOf(result, code) {
  return allDiags(result).filter((e) => e && e.code === code);
}

// Build the AST and collect every given-guard node carrying a separatorGlyph.
function givenGuardsFor(src) {
  const bs = splitBlocks("/test/app.scrml", src);
  const { ast } = buildAST(bs);
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kind === "given-guard") {
      out.push({ variables: n.variables, separatorGlyph: n.separatorGlyph });
    }
    for (const k of Object.keys(n)) { if (k === "span") continue; walk(n[k]); }
  })(ast);
  return out;
}

// Wrap a `${...}` logic body containing a presence guard in a minimal program.
//
// NOTE: no `name=` on this top-level `<program>`. SPEC §4.12.2 — "The top-level
// `<program>` MUST NOT have a `name=` attribute (it is the implicit root)". The
// fixture carried `name="P"` until the §4.12.4 worker-artifact fix, at which
// point `codegen/index.ts:extractWorkerPrograms` treated the WHOLE document as
// an inline worker: it spliced the entire body out, emitted a blank `<body>`,
// and made the §E byte-identity comparison a comparison of two empty bundles.
// The named form emits no diagnostic today (surfaced separately); dropping the
// attribute makes §E compare the real `given`-lowered client output it claims to.
const PROGRAM = (body) => `<program>
\${
  let x: string | not = "a"
  let y: string | not = "b"
${body}
}
<page><p>hi</p></page>
</program>
`;

// ---------------------------------------------------------------------------
// §A — separator glyph preservation on the given-guard node
// ---------------------------------------------------------------------------

describe("§A: given-guard separatorGlyph preserved on the AST node", () => {
  test("`given x :> { ... }` records separatorGlyph=\":>\"", () => {
    const gg = givenGuardsFor(PROGRAM("  given x :> { use(x) }"));
    expect(gg.length).toBe(1);
    expect(gg[0].separatorGlyph).toBe(":>");
    expect(gg[0].variables).toEqual(["x"]);
  });

  test("`given x => { ... }` records separatorGlyph=\"=>\" (deprecated alias)", () => {
    const gg = givenGuardsFor(PROGRAM("  given x => { use(x) }"));
    expect(gg.length).toBe(1);
    expect(gg[0].separatorGlyph).toBe("=>");
    expect(gg[0].variables).toEqual(["x"]);
  });

  test("multi-var `given x, y :> { ... }` parses -> one node, separatorGlyph=\":>\"", () => {
    const gg = givenGuardsFor(PROGRAM("  given x, y :> { use(x, y) }"));
    expect(gg.length).toBe(1);
    expect(gg[0].separatorGlyph).toBe(":>");
    expect(gg[0].variables).toEqual(["x", "y"]);
  });

  test("multi-var `given x, y => { ... }` parses -> one node, separatorGlyph=\"=>\"", () => {
    const gg = givenGuardsFor(PROGRAM("  given x, y => { use(x, y) }"));
    expect(gg.length).toBe(1);
    expect(gg[0].separatorGlyph).toBe("=>");
    expect(gg[0].variables).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// §B — W-GIVEN-ARROW-LEGACY firing scope (standalone given guards)
// ---------------------------------------------------------------------------

describe("§B: W-GIVEN-ARROW-LEGACY guard-context scope", () => {
  test("`given x => { ... }` fires the lint once (info severity)", () => {
    const result = compile("b/eq.scrml", PROGRAM("  given x => { use(x) }"));
    const lints = diagsOf(result, "W-GIVEN-ARROW-LEGACY");
    expect(lints.length).toBe(1);
    expect(lints[0].severity).toBe("info");
    expect(lints[0].message).toContain(":>");
  });

  test("multi-var `given x, y => { ... }` fires the lint once", () => {
    const result = compile("b/multi.scrml", PROGRAM("  given x, y => { use(x, y) }"));
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(1);
  });

  test("`given x :> { ... }` does NOT fire the lint", () => {
    const result = compile("b/colon.scrml", PROGRAM("  given x :> { use(x) }"));
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });

  test("a JS arrow-function `(n) => n * 2` does NOT fire the lint", () => {
    // The file has an arrow-fn `=>` but zero deprecated given-guard separators.
    const result = compile("b/lambda.scrml", PROGRAM("  let f = (n) => n * 2\n  given x :> { use(x, f) }"));
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });

  test("info-level partition: W-GIVEN-ARROW-LEGACY lands in result.warnings, never result.errors (S93)", () => {
    const result = compile("b/partition.scrml", PROGRAM("  given x => { use(x) }"));
    const inWarnings = (result.warnings || []).filter((e) => e.code === "W-GIVEN-ARROW-LEGACY");
    const inErrors = (result.errors || []).filter((e) => e.code === "W-GIVEN-ARROW-LEGACY");
    expect(inWarnings.length).toBe(1);
    expect(inErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §C — no cross-contamination with W-MATCH-ARROW-LEGACY (in-match given arm)
// ---------------------------------------------------------------------------

const MATCH_PROGRAM = (glyph) => `<program name="M">
\${
  let x: string | not = "a"
  match x {
    not ${glyph} handleAbsence()
    given x ${glyph} handlePresence(x)
  }
}
<page><p>hi</p></page>
</program>
`;

describe("§C: in-match `given` arm does NOT fire W-GIVEN-ARROW-LEGACY", () => {
  test("`=>` in-match given arm fires W-MATCH-ARROW-LEGACY, NOT W-GIVEN-ARROW-LEGACY", () => {
    const result = compile("c/eq.scrml", MATCH_PROGRAM("=>"));
    // The match's `not =>` / `given x =>` arms surface W-MATCH-ARROW-LEGACY.
    expect(diagsOf(result, "W-MATCH-ARROW-LEGACY").length).toBeGreaterThan(0);
    // The standalone-given lint must NOT fire on an in-match given arm.
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });

  test("`:>` in-match given arm fires NEITHER lint", () => {
    const result = compile("c/colon.scrml", MATCH_PROGRAM(":>"));
    expect(diagsOf(result, "W-MATCH-ARROW-LEGACY").length).toBe(0);
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §D — `migrate --fix` given-guard rewrite precision
// ---------------------------------------------------------------------------

describe("§D: rewriteGivenGuardArrows rewrites the given-guard separator to `:>` only", () => {
  const SRC = `<program name="X">
\${
  let x: string | not = "a"
  let f = (n) => n * 2
  given x => { use(x, f) }
}
<page><p>hi</p></page>
</program>
`;

  test("the standalone `given x =>` separator becomes `:>`", () => {
    const r = rewriteGivenGuardArrows(SRC, "/tmp/x.scrml");
    expect(r.changed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain("given x :> { use(x, f) }");
  });

  test("the arrow-function glyph `(n) => n * 2` is UNTOUCHED", () => {
    const r = rewriteGivenGuardArrows(SRC, "/tmp/x.scrml");
    expect(r.rewritten).toContain("let f = (n) => n * 2");
    expect(r.rewritten).not.toContain("let f = (n) :> n * 2");
  });

  test("multi-var `given x, y =>` becomes `given x, y :>`", () => {
    const multi = `<program name="X">
\${
  let x: string | not = "a"
  let y: string | not = "b"
  given x, y => { use(x, y) }
}
<page><p>hi</p></page>
</program>
`;
    const r = rewriteGivenGuardArrows(multi, "/tmp/x.scrml");
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain("given x, y :> { use(x, y) }");
  });

  test("a file with only `:>` guards (plus an arrow-fn) is a no-op", () => {
    const colonOnly = `<program name="X">
\${
  let x: string | not = "a"
  let f = (n) => n * 2
  given x :> { use(x, f) }
}
<page><p>hi</p></page>
</program>
`;
    const r = rewriteGivenGuardArrows(colonOnly, "/tmp/x.scrml");
    expect(r.count).toBe(0);
    expect(r.changed).toBe(false);
    expect(r.rewritten).toBe(colonOnly);
  });

  test("re-running the rewrite on its own output is idempotent (no-op)", () => {
    const r1 = rewriteGivenGuardArrows(SRC, "/tmp/x.scrml");
    const r2 = rewriteGivenGuardArrows(r1.rewritten, "/tmp/x.scrml");
    expect(r2.count).toBe(0);
    expect(r2.changed).toBe(false);
    expect(r2.rewritten).toBe(r1.rewritten);
  });

  test("post-rewrite source produces zero W-GIVEN-ARROW-LEGACY", () => {
    const r = rewriteGivenGuardArrows(SRC, "/tmp/x.scrml");
    const result = compile("d/after.scrml", r.rewritten);
    expect(diagsOf(result, "W-GIVEN-ARROW-LEGACY").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §E — codegen-identical (the separator is parse-only, zero codegen cost)
// ---------------------------------------------------------------------------

describe("§E: `given x :>` and `given x =>` emit byte-identical JS", () => {
  const arrowSrc = PROGRAM("  given x => { use(x) }");
  const colonSrc = PROGRAM("  given x :> { use(x) }");

  test("clientJs is byte-identical for `=>` and `:>`", () => {
    const a = compile("e/arrow-client.scrml", arrowSrc);
    const c = compile("e/colon-client.scrml", colonSrc);
    const ao = a.outputs.get(join(TMP, "e/arrow-client.scrml"));
    const co = c.outputs.get(join(TMP, "e/colon-client.scrml"));
    expect(ao).toBeTruthy();
    expect(co).toBeTruthy();
    expect(ao.clientJs).toBe(co.clientJs);
  });

  test("serverJs is byte-identical for `=>` and `:>`", () => {
    const a = compile("e/arrow-server.scrml", arrowSrc);
    const c = compile("e/colon-server.scrml", colonSrc);
    const ao = a.outputs.get(join(TMP, "e/arrow-server.scrml"));
    const co = c.outputs.get(join(TMP, "e/colon-server.scrml"));
    expect(ao.serverJs ?? "").toBe(co.serverJs ?? "");
  });
});
