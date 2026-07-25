/**
 * Debounce / Throttle Attribute (S79) — Unit Tests
 *
 * Tests for SPEC §6.13 — the canonical state-decl reactivity attribute form
 * `<name debounced=Nms> = expr` / `<name throttled=Nms> = expr`. The pre-v0.next
 * `@debounced(N) name = expr` keyword-form was retired at S79 (clean-cut
 * Approach B per `scrml-support/docs/deep-dives/debounce-and-timing-2026-05-10.md`).
 *
 * Coverage:
 *   §1 Parser: debounced=Nms / throttled=Nms captured for Shape 1, Shape 2,
 *      and computed-form ${expr}ms.
 *   §2 Typer: E-DEBOUNCED-WITH-DERIVED, E-REACTIVITY-ATTR-CONFLICT (live).
 *      E-DEBOUNCED-WITH-SERVER tested when applicable; deferred otherwise.
 *   §3 Codegen: state-decl with reactivity emits the
 *      _scrml_reactivity_register("name", kind, ms) sidecar.
 *   §4 Codegen: computed-form lowers to an arrow-fn msExpr (mirror A5-5 pattern).
 *   §5 Runtime helper shape verification (functions exist + take expected args).
 *   §6 Migrated probe samples compile cleanly.
 *   §7 Regression: no `reactive-debounced-decl` AST kind appears anywhere.
 */

import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAST(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut).ast;
}

// Walk all nodes recursively, collecting state-decl entries.
function collectStateDecls(ast) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === "state-decl") out.push(node);
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "_scope" || k === "_record") continue;
      walk(node[k]);
    }
  };
  walk(ast);
  return out;
}

// Walk all nodes, return any node whose `kind` matches `target`.
function findKind(ast, target) {
  let hit = null;
  const walk = (node) => {
    if (hit || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.kind === target) { hit = node; return; }
    for (const k of Object.keys(node)) {
      if (k === "span" || k === "_scope" || k === "_record") continue;
      walk(node[k]);
    }
  };
  walk(ast);
  return hit;
}

// Compile inline source through the full pipeline; return errors + clientJs.
const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/s79-debounce-throttle");
function compileInline(source, filename = "test.scrml") {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const inputFile = join(FIXTURE_DIR, filename);
  writeFileSync(inputFile, source);
  const result = compileScrml({
    inputFiles: [inputFile],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
    log: () => {},
  });
  let clientJs = "";
  for (const [, v] of result.outputs) {
    if (foldChunkNamespacing(v.clientJs)) clientJs +=foldChunkNamespacing( foldChunkNamespacing(v.clientJs));
  }
  return { errors: result.errors || [], clientJs };
}

// ---------------------------------------------------------------------------
// §1 — Parser: attribute capture
// ---------------------------------------------------------------------------

describe("§1 parser: debounced= / throttled= attribute capture", () => {
  test("Shape 1 — `<query debounced=300ms> = ''` captures literal duration", () => {
    const ast = parseAST(`<query debounced=300ms> = ""`);
    const decls = collectStateDecls(ast);
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("query");
    expect(d.reactivity).toBeDefined();
    expect(d.reactivity.debounced).toBeDefined();
    expect(d.reactivity.debounced.kind).toBe("literal");
    expect(d.reactivity.debounced.ms).toBe(300);
    expect(d.reactivity.throttled).toBeUndefined();
  });

  test("Shape 1 — `<scrollY throttled=100ms> = 0` captures literal duration", () => {
    const ast = parseAST(`<scrollY throttled=100ms> = 0`);
    const decls = collectStateDecls(ast);
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("scrollY");
    expect(d.reactivity).toBeDefined();
    expect(d.reactivity.throttled).toBeDefined();
    expect(d.reactivity.throttled.kind).toBe("literal");
    expect(d.reactivity.throttled.ms).toBe(100);
    expect(d.reactivity.debounced).toBeUndefined();
  });

  test("Shape 1 — `<x debounced=2s> = ''` lowers seconds to ms", () => {
    const ast = parseAST(`<x debounced=2s> = ""`);
    const d = collectStateDecls(ast)[0];
    expect(d.reactivity.debounced.kind).toBe("literal");
    expect(d.reactivity.debounced.ms).toBe(2000);
  });

  test("Shape 1 — debounced= rides alongside default=", () => {
    const ast = parseAST(`<query debounced=300ms default=""> = ""`);
    const d = collectStateDecls(ast)[0];
    expect(d.reactivity.debounced.ms).toBe(300);
    expect(d.defaultExpr).toBeDefined();
  });

  test("Shape 1 — debounced= rides alongside pinned", () => {
    const ast = parseAST(`<query pinned debounced=300ms> = ""`);
    const d = collectStateDecls(ast)[0];
    expect(d.pinned).toBe(true);
    expect(d.reactivity.debounced.ms).toBe(300);
  });

  test("Shape 2 — `<typingDraft debounced=300ms req length(<=280)> = <textarea/>` captures alongside validators", () => {
    // Shape 2 RHS-as-markup parses cleanly only inside a logic context
    // (the top-level block-splitter splits `<textarea/>` as a sibling block).
    const ast = parseAST(
      `<program>\${<typingDraft debounced=300ms req length(<=280)> = <textarea/>}</program>`,
    );
    const d = collectStateDecls(ast)[0];
    expect(d.shape).toBe("decl-with-spec");
    expect(d.reactivity.debounced.ms).toBe(300);
    expect(d.validators).toBeDefined();
    expect(d.validators.length).toBeGreaterThanOrEqual(2);
  });

  test("computed-form `<x debounced=${@delay}ms> = ''` captures computed shape", () => {
    const ast = parseAST(
      `<program>\${<delay> = 500\n<x debounced=\${@delay}ms> = ""}</program>`,
    );
    const decls = collectStateDecls(ast);
    const xDecl = decls.find(d => d.name === "x");
    expect(xDecl).toBeDefined();
    expect(xDecl.reactivity.debounced.kind).toBe("computed");
    expect(xDecl.reactivity.debounced.exprText).toContain("@delay");
    expect(xDecl.reactivity.debounced.unitMultiplier).toBe(1);
  });

  test("dual-attr — both debounced= AND throttled= captured (typer rejects)", () => {
    const ast = parseAST(`<x debounced=300ms throttled=100ms> = ""`);
    const d = collectStateDecls(ast)[0];
    expect(d.reactivity.debounced).toBeDefined();
    expect(d.reactivity.throttled).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §2 — Typer: error codes
// ---------------------------------------------------------------------------

describe("§2 typer: reactivity-attribute error codes", () => {
  test("E-DEBOUNCED-WITH-DERIVED fires on `const <x debounced=300ms> = expr`", () => {
    const { errors } = compileInline(
      `<source> = ""\nconst <x debounced=300ms> = @source.toUpperCase()`,
      "derived-debounced.scrml",
    );
    const hits = errors.filter(e => /E-DEBOUNCED-WITH-DERIVED/.test(e.code || e.message));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("E-REACTIVITY-ATTR-CONFLICT fires on dual-attr cell", () => {
    const { errors } = compileInline(
      `<x debounced=300ms throttled=100ms> = ""`,
      "dual-attr.scrml",
    );
    const hits = errors.filter(e => /E-REACTIVITY-ATTR-CONFLICT/.test(e.code || e.message));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("Plain debounced= cell compiles cleanly (no false positives)", () => {
    const { errors } = compileInline(
      `<query debounced=300ms> = ""`,
      "clean-debounced.scrml",
    );
    const hardErrors = errors.filter(
      e => e.severity !== "warning" && e.severity !== "info",
    );
    // Should have NO E-DEBOUNCED-* / E-REACTIVITY-* errors on a clean cell.
    const reactivityErrors = hardErrors.filter(
      e => /E-DEBOUNCED-|E-REACTIVITY-/.test(e.code || e.message),
    );
    expect(reactivityErrors.length).toBe(0);
  });

  test("E-SYNTAX-DURATION fires on malformed duration value", () => {
    const { errors } = compileInline(
      `<x debounced=abc> = ""`,
      "malformed-duration.scrml",
    );
    const hits = errors.filter(e => /E-SYNTAX-DURATION|invalid|malformed/i.test(e.code || e.message));
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §3 — Codegen: register sidecar
// ---------------------------------------------------------------------------

describe("§3 codegen: state-decl emits _scrml_reactivity_register sidecar", () => {
  test("debounced= emits register('name', 'debounced', 300) sidecar", () => {
    const { errors, clientJs: __cjRaw } = compileInline(
      `<query debounced=300ms> = ""`,
      "register-debounced.scrml",
    ); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    expect(clientJs).toContain("_scrml_reactivity_register");
    expect(clientJs).toContain('"debounced"');
    expect(clientJs).toContain("300");
  });

  test("throttled= emits register('name', 'throttled', 100) sidecar", () => {
    const { errors, clientJs: __cjRaw } = compileInline(
      `<scrollY throttled=100ms> = 0`,
      "register-throttled.scrml",
    ); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    expect(clientJs).toContain("_scrml_reactivity_register");
    expect(clientJs).toContain('"throttled"');
    expect(clientJs).toContain("100");
  });

  test("plain state-decl WITHOUT reactivity does NOT emit register sidecar", () => {
    const { clientJs: __cjRaw } = compileInline(
      `<count> = 0`,
      "no-register.scrml",
    ); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs).not.toContain("_scrml_reactivity_register");
  });
});

// ---------------------------------------------------------------------------
// §4 — Codegen: computed-form msExpr arrow-fn
// ---------------------------------------------------------------------------

describe("§4 codegen: computed-form msExpr arrow-fn (A5-5 mirror)", () => {
  test("computed `${expr}ms` lowers to () => (exprText) * unitMultiplier", () => {
    const { errors, clientJs: __cjRaw } = compileInline(
      `<program>\${<delay> = 500\n<x debounced=\${@delay}ms> = ""}</program>`,
      "computed-form.scrml",
    ); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    // The msExpr arrow-fn shape: `() => (...) * 1`.
    expect(clientJs).toMatch(/\(\)\s*=>\s*\(.*\)\s*\*\s*1/);
  });

  test("computed `${expr}s` uses unit multiplier 1000", () => {
    const { errors, clientJs: __cjRaw } = compileInline(
      `<program>\${<delay> = 5\n<x debounced=\${@delay}s> = ""}</program>`,
      "computed-seconds.scrml",
    ); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    expect(clientJs).toMatch(/\(\)\s*=>\s*\(.*\)\s*\*\s*1000/);
  });
});

// ---------------------------------------------------------------------------
// §5 — Runtime helper shape verification
// ---------------------------------------------------------------------------

describe("§5 runtime: helper shape verification", () => {
  test("SCRML_RUNTIME contains _scrml_reactive_debounced", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_reactive_debounced");
  });

  test("SCRML_RUNTIME contains _scrml_reactive_throttled (NEW S79)", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_reactive_throttled");
  });

  test("SCRML_RUNTIME contains _scrml_reactivity_register", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_reactivity_register");
  });

  test("SCRML_RUNTIME contains _scrml_reactivity_cancel", () => {
    expect(SCRML_RUNTIME).toContain("function _scrml_reactivity_cancel");
  });

  test("SCRML_RUNTIME hoists _scrml_reactivity_rules to top (TDZ safety)", () => {
    // Match the registry declaration before the first §X.X marker comment.
    const rulesIdx = SCRML_RUNTIME.indexOf("_scrml_reactivity_rules");
    const firstMarkerIdx = SCRML_RUNTIME.indexOf("§6.8 reset+default runtime");
    expect(rulesIdx).toBeGreaterThan(0);
    expect(firstMarkerIdx).toBeGreaterThan(0);
    expect(rulesIdx).toBeLessThan(firstMarkerIdx);
  });

  test("_scrml_reset cancels pending timers via _scrml_reactivity_cancel", () => {
    expect(SCRML_RUNTIME).toContain("_scrml_reactivity_cancel(name)");
  });
});

// ---------------------------------------------------------------------------
// §6 — Migrated probe samples compile cleanly
// ---------------------------------------------------------------------------

describe("§6 migrated probe samples", () => {
  test("phase1-reactive-debounced-004.scrml compiles cleanly + emits register", () => {
    const samplePath = join(
      import.meta.dir,
      "../../../samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-debounced-004.scrml",
    );
    const source = readFileSync(samplePath, "utf8");
    const { errors, clientJs: __cjRaw } = compileInline(source, "probe-debounced.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    expect(clientJs).toContain("_scrml_reactivity_register");
    expect(clientJs).toContain('"debounced"');
  });

  test("phase1-reactive-throttled-005.scrml compiles cleanly + emits register", () => {
    const samplePath = join(
      import.meta.dir,
      "../../../samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-throttled-005.scrml",
    );
    const source = readFileSync(samplePath, "utf8");
    const { errors, clientJs: __cjRaw } = compileInline(source, "probe-throttled.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);
    const hard = errors.filter(e => e.severity !== "warning" && e.severity !== "info");
    expect(hard.length).toBe(0);
    expect(clientJs).toContain("_scrml_reactivity_register");
    expect(clientJs).toContain('"throttled"');
  });
});

// ---------------------------------------------------------------------------
// §7 — Regression: reactive-debounced-decl AST kind RETIRED
// ---------------------------------------------------------------------------

describe("§7 regression: reactive-debounced-decl AST kind retired", () => {
  test("migrated debounced sample produces NO reactive-debounced-decl AST", () => {
    const samplePath = join(
      import.meta.dir,
      "../../../samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-debounced-004.scrml",
    );
    const source = readFileSync(samplePath, "utf8");
    const ast = parseAST(source);
    const hit = findKind(ast, "reactive-debounced-decl");
    expect(hit).toBeNull();
  });

  test("migrated throttled sample produces NO reactive-debounced-decl AST", () => {
    const samplePath = join(
      import.meta.dir,
      "../../../samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-throttled-005.scrml",
    );
    const source = readFileSync(samplePath, "utf8");
    const ast = parseAST(source);
    const hit = findKind(ast, "reactive-debounced-decl");
    expect(hit).toBeNull();
  });

  test("simple inline debounced source produces NO reactive-debounced-decl AST", () => {
    const ast = parseAST(`<query debounced=300ms> = ""`);
    const hit = findKind(ast, "reactive-debounced-decl");
    expect(hit).toBeNull();
  });
});
