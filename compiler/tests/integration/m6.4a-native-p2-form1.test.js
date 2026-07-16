/**
 * M6.4a — Native-parser P2-Form1 synthesis fix — Regression Tests
 *
 * SPEC §21.2 Form 1 (`export <ComponentName ...>...</>`) under
 * `--parser=scrml-native`. Pre-M6.4a the native parser's `liftPairedExport`
 * (compiler/native-parser/parse-markup.js) did NOT recognize the Component
 * pairing branch — it only handled `export <channel>`. The cross-file
 * Form-1 exemplar produced 2× E-COMPONENT-035 (one per use site) and the
 * single-file exemplar produced 1× E-COMPONENT-035 (the outer self-named
 * tag stayed in the markup tree).
 *
 * M6.4a closes the gap with two coordinated fixes:
 *   1. parse-markup.js liftPairedExport — adds the Component branch that
 *      mirrors ast-builder.js L807-940 (desugar to `${ export const Name =
 *      <body-root mergedAttrs>...</body-root> }`).
 *   2. collect-hoisted.js synthExportDecl + synthImportDecl — translates
 *      the native StmtKind shapes to the LIVE ast-builder
 *      ExportDeclNode/ImportDeclNode shapes so cross-file consumers
 *      (module-resolver / name-resolver / api.js / component-expander)
 *      can read `exportedName` / `exportKind` / `names` directly. Pre-fix
 *      these silently dropped every native-pipeline cross-file binding.
 *
 * Coverage:
 *   §A1  single-file P2-Form1 (use site = the outer-self-named wrapper)
 *   §A2  cross-file P2-Form1 (consumer imports + renders)
 *   §A3  non-Form-1 export still works (regression guard for the
 *        synthExportDecl/synthImportDecl shape translation)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "m6.4a-native-p2-form1-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(relPath, source) {
  const abs = join(TMP, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

function compileNative(inputFiles) {
  return compileScrml({
    inputFiles,
    parser: "scrml-native",
    write: false,
  });
}

// ---------------------------------------------------------------------------
// §A1 — single-file P2-Form1 inside <program>
// ---------------------------------------------------------------------------

describe("M6.4a §A1 — single-file P2-Form1 under --parser=scrml-native", () => {
  test("export <Greeting>...</> inside <program> compiles with 0 errors", () => {
    const appPath = fx("a1/app.scrml",
      "<program>\n" +
      "  export <Greeting props={ name: string }>\n" +
      "    <p class=\"hello\">Hello, ${name}!</>\n" +
      "  </>\n" +
      "</program>\n",
    );
    const result = compileNative([appPath]);
    const errors = (result.errors || []).filter(e => !e.severity || e.severity !== "warning");
    expect(errors).toEqual([]);
    // Pre-M6.4a the outer <Greeting> stayed in the markup tree and VP-2
    // raised E-COMPONENT-035 against it. Confirm no such error fires.
    const componentErrors = (result.errors || []).filter(e => e.code === "E-COMPONENT-035");
    expect(componentErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §A2 — cross-file P2-Form1 import-and-render
// ---------------------------------------------------------------------------

describe("M6.4a §A2 — cross-file P2-Form1 under --parser=scrml-native", () => {
  test("exporter Form 1 + consumer use site compiles with 0 errors", () => {
    const compPath = fx("a2/components.scrml",
      "export <X1Badge>\n" +
      "  <span class=\"x1-badge\">badge</>\n" +
      "</>\n",
    );
    const appPath = fx("a2/app.scrml",
      "<program>\n" +
      "${ import { X1Badge } from './components.scrml' }\n" +
      "<div>\n" +
      "  <X1Badge/>\n" +
      "</div>\n" +
      "</program>\n",
    );
    const result = compileNative([appPath, compPath]);
    const errors = (result.errors || []).filter(e => !e.severity || e.severity !== "warning");
    expect(errors).toEqual([]);
    const componentErrors = (result.errors || []).filter(e => e.code === "E-COMPONENT-035");
    expect(componentErrors).toEqual([]);
    // Cross-file resolution confirmed by absence of E-COMPONENT-035 (the
    // pre-M6.4a failure surface). The post-CE markup tree replaces
    // <X1Badge/> with the expanded <span class="x1-badge">badge</span>
    // form — covered by the use-site integration test
    // (p2-export-component-form1-use-site.test.js §X2) which has full
    // emitted-HTML assertions in the LIVE pipeline.
  });
});

// ---------------------------------------------------------------------------
// §A3 — non-Form-1 export regression guard (synthImportDecl /
// synthExportDecl shape translation under cross-file use)
// ---------------------------------------------------------------------------

describe("M6.4a §A3 — non-Form-1 cross-file export still works", () => {
  test("export const Foo = 42 + cross-file import resolves cleanly", () => {
    const expPath = fx("a3/exporter.scrml", "${ export const Foo = 42 }\n");
    const conPath = fx("a3/consumer.scrml",
      "<program>\n" +
      "${ import { Foo } from './exporter.scrml' }\n" +
      "<div>Value: ${Foo}</div>\n" +
      "</program>\n",
    );
    const result = compileNative([conPath, expPath]);
    const errors = (result.errors || []).filter(e => !e.severity || e.severity !== "warning");
    expect(errors).toEqual([]);
    // The synthExportDecl + synthImportDecl translations must NOT regress
    // the non-component path. A const export with cross-file expression-
    // use was the pre-M6.4a baseline "works because no component
    // resolution is required"; post-M6.4a it must keep working with the
    // new live-shape entries.
  });

  test("export function helper() {} + cross-file import resolves cleanly", () => {
    const expPath = fx("a3b/lib.scrml",
      "${\n" +
      "  export function add(a, b) { return a + b }\n" +
      "}\n",
    );
    const conPath = fx("a3b/app.scrml",
      "<program>\n" +
      "${ import { add } from './lib.scrml' }\n" +
      "<div>Sum: ${add(2, 3)}</div>\n" +
      "</program>\n",
    );
    const result = compileNative([conPath, expPath]);
    const errors = (result.errors || []).filter(e => !e.severity || e.severity !== "warning");
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §B — EMITTED-OUTPUT regression for the native cross-file `export const Name =
//      <markup>` raw-slice fix (change-id native-cross-file-export-2026-06-05,
//      ROOT-2).
//
//   ROOT-2 (collect-hoisted.js synthExportDecl) — the `export const Name =
//     <markup>` raw slice anchored `block.span.start` (the `$` opener char)
//     instead of the bodyText host-start, so for a `${...}` LogicEscape the
//     `hi <= blockText.length` guard failed and `raw` fell back to "". The
//     cross-file CE registry then had no markup to expand, firing
//     E-COMPONENT-020/035 and emitting an EMPTY component at the use site.
//
// This asserts the EMITTED bytes, not just the error count — the §A blocks
// guard against E-COMPONENT-035; §B guards that the markup actually reaches the
// output (the S140/S152 emit-vs-error blind-spot).
//
// NOTE: the sibling ROOT-1 (exported FUNCTION body reaching codegen) was
// deferred to PA — its emitted-output fix is correct but it surfaces a large
// within-node parity divergence (the native-parser deferred-deep-shift design
// + a FunctionDecl-parity gap). See docs/changes/native-cross-file-export-
// 2026-06-05/progress.md.
// ---------------------------------------------------------------------------

describe("§B — native cross-file export EMITTED-OUTPUT regression", () => {
  function outFor(result, suffix) {
    if (!result.outputs) return undefined;
    for (const [filePath, out] of result.outputs) {
      // outputs keys are NATIVE-separator absolute paths; normalize to POSIX
      // separators so the forward-slash suffix ("b1/app.scrml") matches on
      // Windows as well. No-op on POSIX.
      if (filePath.replace(/\\/g, "/").endsWith(suffix)) return out;
    }
    return undefined;
  }

  test("ROOT-2: `export const Badge = <markup>` in ${...} expands at the cross-file use site", () => {
    const compPath = fx("b1/comp.scrml",
      "${\n" +
      "  export const Badge = <span class=\"x-badge\">badge-text</>\n" +
      "}\n",
    );
    const appPath = fx("b1/app.scrml",
      "<program>\n" +
      "${ import { Badge } from './comp.scrml' }\n" +
      "<div><Badge/></div>\n" +
      "</program>\n",
    );
    const result = compileNative([appPath, compPath]);
    // No cross-file component-resolution failure (the pre-fix surface).
    const componentErrors = (result.errors || []).filter(
      e => e.code === "E-COMPONENT-020" || e.code === "E-COMPONENT-035");
    expect(componentErrors).toEqual([]);
    // The Badge markup must actually expand into the consumer HTML — pre-fix
    // the registry held an EMPTY component (raw="") so the use site rendered
    // nothing.
    const appOut = outFor(result, "b1/app.scrml");
    expect(appOut).toBeDefined();
    expect(appOut.html).toContain("x-badge");
    expect(appOut.html).toContain("badge-text");
  });
});
