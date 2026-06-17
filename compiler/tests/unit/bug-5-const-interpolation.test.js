/**
 * bug-5-const-interpolation.test.js — `${const-or-literal}` in markup wires to DOM
 *
 * Regression: dogfood Bug 5 surfaced S106 side session, SCOPING + ratification S107.
 * Authoring: scrmlTS-PA S107 (2026-05-19).
 *
 * Pre-S107: `${VERSION}` / `${"literal"}` interpolations in markup body where the
 * expression has no reactive (@-prefixed) refs and no server-fn calls fell through
 * the emit-event-wiring.ts:928 conditional — neither the "no-reactive + server-fn"
 * branch nor the "has-reactive" branch fired, leaving the data-scrml-logic
 * placeholder empty and the markup-as-value pillar L1 silently misfiring on its
 * simplest shape. A naked `IDENT;` JS no-op was the only side-effect; no DOM
 * update.
 *
 * Fix (emit-event-wiring.ts Phase 1):
 *   - Added the missing else-branch: `varRefs.length === 0 && !exprUsesServerFn(...)`
 *   - Emits a one-shot `el.textContent = ${rewrittenExpr};` at DOMContentLoaded.
 *   - No `_scrml_effect` subscription (nothing reactive to track).
 *   - Tilde-guard: skip the wiring when expression has `~` as a standalone token.
 *     Pre-existing tilde-rewriter (`emit-reactive-wiring.ts:372`) hoists tilde
 *     vars to file-scope but its context isn't threaded into the binding's
 *     stored expr — emitting `el.textContent = ~;` would produce invalid JS
 *     (bitwise-NOT with no operand). Phase 2 will properly thread tilde context.
 *
 * Coverage:
 *   §1  Headline Bug 5 — `${const-string}` in markup-body produces textContent write
 *   §2  `${const-number}` — same shape, numeric value
 *   §3  `${"string-literal"}` — literal interpolation
 *   §4  Emitted JS parses as ES module (no SyntaxError)
 *   §5  Regression — `${@var}` still uses synchronous _scrml_effect subscription
 *   §6  Regression — `${serverFn()}` still uses async IIFE wrapper
 *   §7  Tilde guard — `${ initializer; ~ }` does NOT emit invalid JS (bitwise-NOT)
 *   §8  Reactive-display-wiring block is NOT empty for const interpolations
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/bug-5-const-interpolation");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let constStringFx, constNumberFx, literalStringFx, atVarFx, serverFnFx, tildeFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  constStringFx = fix("const-string.scrml", `<program>

    const VERSION = "v0.3.0"

    <span class="version-pill">\${VERSION}</span>

</>
`);

  constNumberFx = fix("const-number.scrml", `<program>

    const YEAR = 2026

    <footer>© \${YEAR}</footer>

</>
`);

  literalStringFx = fix("literal-string.scrml", `<program>

    <span>\${"hello"}</span>

</>
`);

  atVarFx = fix("at-var.scrml", `<program>
\${
  @count = 0
  function bump() { @count = @count + 1 }
}
<button onclick=bump()>inc</button>
<p>\${@count}</p>
</program>
`);

  serverFnFx = fix("server-fn.scrml", `<program>
\${
  server function loadGreeting() {
    lift "hello"
  }
}
<p>\${loadGreeting()}</p>
</program>
`);

  tildeFx = fix("tilde.scrml", `<program>

    <span>\${ "from-tilde"; ~ }</span>

</>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

// ---------------------------------------------------------------------------
// §1: Headline Bug 5 — `${const-string}` produces textContent write
// ---------------------------------------------------------------------------

describe("§1: Bug 5 — `${const-string}` in markup body folded to inline literal (S108 Phase 3)", () => {
  test("compile succeeds", () => {
    const result = compile(constStringFx);
    expect(result.errors).toEqual([]);
  });

  // S108 Phase 3 amendment: const-string interpolation is constant-folded
  // inline per SPEC §7.4.2 (the compiler MAY inline compile-time-known constants).
  // The Phase 1/2 β-path tests (placeholder + textContent wiring) are SUPERSEDED
  // by the fold optimization; observational outcome is the same (value renders
  // at the interpolation site) but the implementation is cleaner.
  test("html contains the folded literal value v0.3.0 directly inside the version pill", () => {
    const result = compile(constStringFx);
    const html = result.outputs.get(constStringFx).html;
    expect(html).toMatch(/<span class="version-pill">v0\.3\.0<\/span>/);
  });

  test("html has NO data-scrml-logic placeholder inside the version pill (folded inline)", () => {
    const result = compile(constStringFx);
    const html = result.outputs.get(constStringFx).html;
    const pillMatch = html.match(/<span class="version-pill">[^<]*<\/span>/);
    expect(pillMatch).not.toBeNull();
    expect(pillMatch[0]).not.toContain("data-scrml-logic");
  });

  test("no `_scrml_effect` subscription emitted (folded — no wiring needed)", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    // The fold path emits NO wiring at all for this interpolation. The whole
    // "Reactive display wiring" section may not even exist for this file.
    expect(js).not.toMatch(/_scrml_effect\(function\(\)\s*\{\s*el\.textContent\s*=\s*VERSION/);
  });
});

// ---------------------------------------------------------------------------
// §2: `${const-number}` — same shape, numeric value
// ---------------------------------------------------------------------------

describe("§2: `${const-number}` folded to inline string (S108 Phase 3)", () => {
  test("compile succeeds", () => {
    const result = compile(constNumberFx);
    expect(result.errors).toEqual([]);
  });

  test("html contains the folded value 2026 directly in the footer", () => {
    // S108 Phase 3 — const number folds via partiallyEvaluateExpr; the value
    // is inlined as its string coercion ("2026") per SPEC §7.4.2 normative
    // statement on String() coercion.
    const result = compile(constNumberFx);
    const html = result.outputs.get(constNumberFx).html;
    expect(html).toMatch(/<footer>© 2026<\/footer>/);
  });
});

// ---------------------------------------------------------------------------
// §3: `${"string-literal"}` — literal interpolation
// ---------------------------------------------------------------------------

describe("§3: `${\"string-literal\"}` folded to inline literal (S108 Phase 3)", () => {
  test("compile succeeds", () => {
    const result = compile(literalStringFx);
    expect(result.errors).toEqual([]);
  });

  test("html contains the literal 'hello' inline in the span", () => {
    // S108 Phase 3 — string literal in `${...}` position folds to inline
    // text per SPEC §7.4.2. Phase 1/2 β-path (placeholder + textContent
    // wiring) is SUPERSEDED for the literal case.
    const result = compile(literalStringFx);
    const html = result.outputs.get(literalStringFx).html;
    expect(html).toMatch(/<span>hello<\/span>/);
  });
});

// ---------------------------------------------------------------------------
// §4: Emitted JS parses as ES module (no SyntaxError)
// ---------------------------------------------------------------------------

describe("§4: emitted JS is parseable", () => {
  test("const-string fixture's client.js parses via new Function", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });

  test("tilde fixture's client.js parses via new Function (regression — no invalid bitwise-NOT)", () => {
    // Pre-fix-Phase-1, my naive else-branch emitted `el.textContent = ~;` which
    // is invalid JS (bitwise-NOT prefix operator with no operand → parse error).
    // The tilde-guard skips the wiring when expr has standalone `~`. Verify
    // emitted JS still parses cleanly.
    const result = compile(tildeFx);
    const js = result.outputs.get(tildeFx).clientJs;
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5: Regression — `${@var}` still uses synchronous _scrml_effect
// ---------------------------------------------------------------------------

describe("§5: regression — `${@var}` interpolation still uses synchronous reactive effect", () => {
  test("compile succeeds", () => {
    const result = compile(atVarFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js still wires `_scrml_effect(function() { _scrml_render_value(el, _scrml_reactive_get(\"count\")) })`", () => {
    const result = compile(atVarFx);
    const js = result.outputs.get(atVarFx).clientJs;
    // markup-value-in-expression-2026-06-17: the interpolation display now
    // routes through the node-aware `_scrml_render_value(el, expr)` helper
    // (a markup-typed value renders as a node; a primitive keeps textContent)
    // instead of the bare `el.textContent = expr`. Same reactive `_scrml_effect`
    // subscription; the display call is the only shape change.
    expect(js).toMatch(/_scrml_effect\(function\(\)\s*\{\s*_scrml_render_value\(el,\s*_scrml_reactive_get\("count"\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §6: Regression — `${serverFn()}` still uses async IIFE wrapper
// ---------------------------------------------------------------------------

describe("§6: regression — `${serverFn()}` still uses async IIFE wrapper", () => {
  test("compile succeeds", () => {
    const result = compile(serverFnFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js still wraps the server-fn call in async/await form", () => {
    const result = compile(serverFnFx);
    const js = result.outputs.get(serverFnFx).clientJs;
    // GITI-005 shape preserved
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*\{[^}]*await\s*\(_scrml_fetch_loadGreeting_\d+\(\)\)/);
    expect(js).toContain("el.textContent = await");
  });
});

// ---------------------------------------------------------------------------
// §7: Tilde guard — `${ initializer; ~ }` doesn't emit invalid JS
// ---------------------------------------------------------------------------

describe("§7: tilde guard — `${ initializer; ~ }` does NOT emit invalid bitwise-NOT JS", () => {
  test("compile succeeds", () => {
    const result = compile(tildeFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js contains NO `el.textContent = ~;` (invalid JS)", () => {
    const result = compile(tildeFx);
    const js = result.outputs.get(tildeFx).clientJs;
    expect(js).not.toMatch(/el\.textContent\s*=\s*~\s*;/);
  });

  test("file-scope tilde-rewriter hoist still produces `_scrml_tilde_N` vars (pre-existing behavior unchanged)", () => {
    const result = compile(tildeFx);
    const js = result.outputs.get(tildeFx).clientJs;
    expect(js).toMatch(/let\s+_scrml_tilde_\d+\s*=/);
  });
});

// ---------------------------------------------------------------------------
// §8: Reactive-display-wiring block is NOT empty for const interpolations
// ---------------------------------------------------------------------------

describe("§8: reactive-display-wiring block is NOT empty for const interpolations", () => {
  test("const-string fixture: wiring block has content (matches GITI-005 negative-assertion shape)", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    // Pre-fix: `// --- Reactive display wiring ---\n});` — empty block.
    // Post-fix: wiring block contains the textContent write.
    expect(js).not.toMatch(/Reactive display wiring ---\s*\n\s*\}\);/);
  });

  test("literal-string fixture: wiring block has content", () => {
    const result = compile(literalStringFx);
    const js = result.outputs.get(literalStringFx).clientJs;
    expect(js).not.toMatch(/Reactive display wiring ---\s*\n\s*\}\);/);
  });
});

// ---------------------------------------------------------------------------
// §9: Phase 2 — Anomaly C (phantom placeholder from decl-only logic body) closed
// ---------------------------------------------------------------------------

describe("§9 (Phase 2 + Phase 3): Anomaly C — bare `const` decl does NOT emit phantom placeholder; Phase 3 fold also obviates the intended placeholder", () => {
  test("const-string fixture: HTML has ZERO data-scrml-logic placeholders (folded inline; no placeholder needed)", () => {
    const result = compile(constStringFx);
    const html = result.outputs.get(constStringFx).html;
    // Pre-Phase-2: HTML had two `data-scrml-logic` placeholders — one phantom
    // from the implicit-logic-wrap of `const VERSION = ...` (Anomaly C) and
    // one intended for the `${VERSION}` interpolation.
    // Phase 2 closed Anomaly C → 1 placeholder.
    // Phase 3 (S108) folds `${VERSION}` to inline literal "v0.3.0" → 0 placeholders.
    const placeholderCount = (html.match(/data-scrml-logic="_scrml_logic_\d+"/g) ?? []).length;
    expect(placeholderCount).toBe(0);
  });

  test("const-string fixture: no phantom placeholder sibling before <span class=\"version-pill\">", () => {
    const result = compile(constStringFx);
    const html = result.outputs.get(constStringFx).html;
    // Anomaly C symptom (pre-Phase 2): a `<span data-scrml-logic="..."></span>`
    // sibling BEFORE the version-pill. Both Phase 2 (closed Anomaly C) and
    // Phase 3 (folded the interpolation) ensure this shape never appears.
    expect(html).not.toMatch(/<span data-scrml-logic="[^"]+"><\/span><span class="version-pill">/);
    // Version pill contains the folded literal directly
    expect(html).toMatch(/<span class="version-pill">v0\.3\.0<\/span>/);
  });
});

// ---------------------------------------------------------------------------
// §10: Phase 2 — Anomaly B (orphan IDENT; no-op JS statement at file-scope) closed
// ---------------------------------------------------------------------------

describe("§10 (Phase 2): Anomaly B — interpolation body does NOT emit orphan pure-read JS at file-scope", () => {
  test("const-string fixture: client.js does NOT have an orphan `VERSION;` no-op statement", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    // Pre-Phase-2: client.js had a line `VERSION;` at file scope from emit-reactive-wiring.ts
    // dumping the ${VERSION} body. Post-Phase-2: skipped per the pure-read orphan filter.
    // Match the file-scope region only (BEFORE the `// --- Event handler wiring` marker).
    const fileScope = js.split("// --- Event handler wiring")[0] ?? "";
    expect(fileScope).not.toMatch(/^VERSION\s*;\s*$/m);
  });

  test("at-var fixture: client.js does NOT have an orphan `_scrml_reactive_get(\"count\");` no-op", () => {
    const result = compile(atVarFx);
    const js = result.outputs.get(atVarFx).clientJs;
    // Same pattern for reactive case: the `${@count}` body emitted
    // `_scrml_reactive_get("count");` at file-scope as a pure-read orphan.
    // Phase 2's orphan filter matches `_scrml_reactive_get(...);` shape.
    const fileScope = js.split("// --- Event handler wiring")[0] ?? "";
    expect(fileScope).not.toMatch(/^_scrml_reactive_get\("count"\)\s*;\s*$/m);
  });

  test("const-string fixture: the file-scope `const VERSION = \"v0.3.0\";` declaration IS still emitted", () => {
    // Regression guard: Phase 2 filter must NOT skip legitimate declarations.
    // Only pure-read bare-exprs in pid groups are skipped.
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    expect(js).toMatch(/const\s+VERSION\s*=\s*"v0\.3\.0"\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §11: Phase 2 — side-effecting bare-exprs in interpolations are NOT skipped
// ---------------------------------------------------------------------------

describe("§11 (Phase 2): Anomaly B filter preserves side-effecting bare-exprs in interpolations", () => {
  let assignFx;
  beforeAll(() => {
    // `${@count = @count + 1}` inside markup — a bare-expr that has side
    // effects (assignment). The Phase 2 orphan filter MUST NOT skip this.
    assignFx = fix("assign-in-interp.scrml", `<program>
\${ @count = 0 }
<p>\${ @count = @count + 1 }</p>
</program>
`);
  });

  test("compile succeeds", () => {
    const result = compile(assignFx);
    expect(result.errors).toEqual([]);
  });

  test("the assignment IS emitted at file-scope (not skipped as orphan)", () => {
    const result = compile(assignFx);
    const js = result.outputs.get(assignFx).clientJs;
    // The assignment expression in `${@count = @count + 1}` should produce
    // `_scrml_reactive_set("count", _scrml_reactive_get("count") + 1);` at
    // file scope. Phase 2's filter matches only pure-read shapes; assignment
    // shapes (with `=` operator) are preserved.
    expect(js).toMatch(/_scrml_reactive_set\("count",/);
  });
});
