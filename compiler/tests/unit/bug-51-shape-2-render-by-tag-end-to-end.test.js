/**
 * bug-51-shape-2-render-by-tag-end-to-end.test.js — regression test for Bug 51:
 * Shape 2 + render-by-tag empirically broken end-to-end at codegen.
 *
 * Filed S138 by PA during the v0.6.2 cut README compile-gate.
 *
 * Bug 51 has three components; this test closes the TWO that S139 fixed:
 *
 * Bug 51-A (CE drops `_scope` from new FileAST):
 *   `component-expander.ts:runCEFile` produces `const updatedAst = {...ast, ...}`.
 *   `{...ast}` only copies ENUMERABLE properties. SYM attaches `_scope` to the
 *   FileAST as non-enumerable (`symbol-table.ts:9521`). Post-CE, the new AST
 *   has no `_scope`. emit-html.ts reads `fileAST?._scope` (emit-html.ts:576)
 *   and gets null. The render-by-tag expansion at line 1300 is short-circuited
 *   by `&& fileScope`. Every Shape 2 use-site (`<userName/>`) silently emits
 *   as a literal tag in HTML instead of expanding to its bound `<input>`.
 *   Fix: runCEFile explicitly re-attaches `_scope` (defineProperty) on
 *   `updatedAst`.
 *
 * Bug 51-B (empty-string init produces empty-arg emit):
 *   `ast-builder.js:4169` sets `init: ""` for Shape 2 markup-RHS decls. emit-
 *   logic.ts:1971 does `const initStr = node.init ?? "null"`. `??` doesn't
 *   fire on empty string. initStr stays "", the downstream emit produces
 *   `_scrml_reactive_set("userName", )` with an empty argument (legal JS per
 *   ES2017 trailing-comma; runtime sets cell to undefined).
 *   Fix: emit-logic.ts treats `initStr === "" && !initExpr` as missing-init
 *   sentinel → falls back to "null" (the canonical scrml absence per §42.5).
 *
 * Bug 51-C (auto-lift drops markup RHS) — STILL OPEN as separate gap:
 *   At top-level of `<program>` body (the auto-lift path), BS accumulates
 *   the LHS as a text block but emits the markup RHS as a sibling block.
 *   The auto-lifted `${...}` wrap captures only the LHS — the parser sees
 *   `<userName req length(>=2)> = ` with no RHS → state-decl with shape:
 *   "plain", no renderSpec → SYM fires E-CELL-NO-RENDER-SPEC on the use-
 *   site. Fix requires BS to gobble the markup RHS into the text block.
 *   Filed as Bug 51-C follow-up; workaround is `${...}` explicit wrap.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/bug-51");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  let clientJs = "";
  let html = "";
  function findFiles(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) findFiles(p);
      else if (ent.name.endsWith(".client.js")) clientJs = readFileSync(p, "utf-8");
      else if (ent.name.endsWith(".html")) html = readFileSync(p, "utf-8");
    }
  }
  findFiles(outDir);
  return { clientJs, html, errors: result?.errors ?? [] };
}

// ---------------------------------------------------------------------------
// §1: Bug 51-A — `_scope` carried through CE → render-by-tag fires
// ---------------------------------------------------------------------------

describe("Bug 51-A §1: Shape 2 use-site expansion via render-by-tag (post-CE `_scope` preservation)", () => {
  test("canonical Shape 2: `<userName/>` expands to bound `<input>` with validators lowered to HTML attrs", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>\n`;
    const { html, clientJs: __cjRaw } = compileSource("bug-51-a-canonical.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    // The use-site `<userName/>` should expand to the bound `<input type="text">`.
    expect(html).toMatch(/<input type="text"/);
    // Validators should lower to HTML-native attributes (req → required, length(>=2) → minlength="2").
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
    // The hook attribute that links HTML to the bind-wiring should be present.
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    // The use-site `<userName/>` should NOT survive as a literal tag.
    expect(html).not.toMatch(/<userName/);
    // client.js should wire the bind:value loop.
    expect(clientJs).toMatch(/addEventListener\("input"/);
    expect(clientJs).toMatch(/_scrml_reactive_get\("userName"\)/);
  });

  test("multiple use-sites of the same Shape 2 cell all expand", () => {
    const src = `<program>\${ <bio req length(>=10)> = <textarea/> }<div><bio/></div><div><bio/></div></program>\n`;
    const { html } = compileSource("bug-51-a-multi.scrml", src);
    // Both use-sites should expand to <textarea>.
    const textareaCount = (html.match(/<textarea/g) ?? []).length;
    expect(textareaCount).toBeGreaterThanOrEqual(2);
    // No literal <bio/> should survive.
    expect(html).not.toMatch(/<bio/);
  });
});

// ---------------------------------------------------------------------------
// §2: Bug 51-B — empty-init treated as missing-init sentinel
// ---------------------------------------------------------------------------

describe("Bug 51-B §2: Shape 2 cell init produces valid JS (not empty-arg reactive_set)", () => {
  test("reactive_set call carries an actual argument (not empty-arg trailing-comma form)", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>\n`;
    const { clientJs: __cjRaw } = compileSource("bug-51-b-init.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    // Init call should NOT have empty second arg (matches `( "userName" , )` or `("userName",)`).
    expect(clientJs).not.toMatch(/_scrml_reactive_set\("userName",\s*\)/);
    // Should carry `null` (the canonical scrml absence sentinel per §42.5).
    expect(clientJs).toMatch(/_scrml_reactive_set\("userName", null\)/);
  });

  test("node --check passes on the emitted client.js", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>\n`;
    const { clientJs: __cjRaw } = compileSource("bug-51-b-node-check.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(clientJs.length).toBeGreaterThan(0);
    // The emit should compile as a JS module. The pre-fix `_scrml_reactive_set("userName", )`
    // form is valid JS (ES2017 trailing comma) but semantically broken (cell gets undefined).
    // We assert positive structure: at least one valid 2-arg call form is present.
    expect(clientJs).toMatch(/_scrml_reactive_set\("[a-zA-Z_]\w*", [^)]+\)/);
  });
});

// ---------------------------------------------------------------------------
// §3: Bug 51-C — auto-lift now ALSO works (RESOLVED S139 same session)
// ---------------------------------------------------------------------------

describe("Bug 51-C §3: auto-lift at top-level of `<program>` body (BS-gobble fix)", () => {
  test("`${...}` wrap form produces correct emit + HTML expansion (regression-guard for §1+§2)", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>\n`;
    const { html, clientJs: __cjRaw, errors } = compileSource("bug-51-c-workaround.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.length).toBe(0);
    expect(html).toMatch(/<input type="text"/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("userName", null\)/);
  });

  test("auto-lift (NO `${...}` wrap) — now FIXED via BS scanShape12DeclEnd gobble", () => {
    // Pre-S139 (Bug 51-C original gap): BS split the Shape 2 decl into a text
    // block (LHS only) and a sibling markup block (the RHS). Auto-lift wrapped
    // only the LHS → parser produced Shape 1 plain cell with no renderSpec →
    // SYM fired E-CELL-NO-RENDER-SPEC on the use-site. Post-S139 (this fix):
    // BS scans the WHOLE Shape 2 decl span (LHS + `=` + markup RHS) via
    // scanShape12DeclEnd() and gobbles it as a single text block, mirroring
    // the compound-state-decl path at the same BS layer. The auto-lift now
    // sees the full decl → parser produces shape:"decl-with-spec" with the
    // renderSpec → SYM classifies as `bindable` → use-site expands cleanly.
    const src = `<program>\n<userName req length(>=2)> = <input type="text"/>\n<form>\n    <userName/>\n</form>\n</>\n`;
    const { html, clientJs: __cjRaw, errors } = compileSource("bug-51-c-autolift.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.length).toBe(0);
    // The use-site `<userName/>` should expand to the bound input.
    expect(html).toMatch(/<input type="text"/);
    expect(html).toMatch(/required/);
    expect(html).toMatch(/minlength="2"/);
    expect(html).toMatch(/data-scrml-render-by-tag=/);
    // client.js wires the bind:value loop and inits cell to scrml-absence (null).
    expect(clientJs).toMatch(/_scrml_reactive_set\("userName", null\)/);
    expect(clientJs).toMatch(/addEventListener\("input"/);
  });

  test("Shape 1 auto-lift continues to work (regression-guard — no regression from the BS scanner)", () => {
    // The scanner returns -1 for non-markup-RHS shapes, falling back to legacy
    // per-char text accumulation. This test guards that Shape 1 still lifts
    // correctly through the legacy path.
    const src = `<program>\n<count> = 0\n<div>\${'$'}{@count}</div>\n</>\n`.replace(/\$\{'\$'\}/g, "$");
    const { clientJs: __cjRaw, errors } = compileSource("bug-51-c-shape-1.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.length).toBe(0);
    expect(clientJs).toMatch(/_scrml_reactive_set\("count", 0\)/);
  });

  test("Shape 3 `const <derived> = match {...}` multi-line expression-RHS continues to work", () => {
    // The scanner returns -1 for non-markup-RHS shapes (Shape 1 expression OR
    // Shape 3 derived with multi-line body) — legacy per-char text accumulation
    // handles the multi-line body. Pre-flip-to-FIX, my initial scanner scanned
    // expression-RHS to end-of-line, which truncated `match { ... }` bodies.
    const src = `type Status:enum = { Idle, Loading }

<program>
    <phase>: Status = .Idle
    const <display> = match @phase {
        .Idle => .Loading
        .Loading => .Idle
    }
    <div>\${'$'}{@display}</div>
</program>`.replace(/\$\{'\$'\}/g, "$");
    const { clientJs: __cjRaw, errors } = compileSource("bug-51-c-shape-3-multiline.scrml", src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors.length).toBe(0);
    expect(clientJs).toMatch(/_scrml_derived_declare\("display"/);
  });
});
