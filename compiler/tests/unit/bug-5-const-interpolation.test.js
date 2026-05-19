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

describe("§1: Bug 5 — `${const-string}` in markup body wires textContent at DOMContentLoaded", () => {
  test("compile succeeds", () => {
    const result = compile(constStringFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js contains an `el.textContent = VERSION` write inside reactive-display-wiring block", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    expect(js).toMatch(/Reactive display wiring ---[\s\S]*el\.textContent\s*=\s*VERSION\s*;/);
  });

  test("html still has the data-scrml-logic placeholder span (target for the textContent write)", () => {
    const result = compile(constStringFx);
    const html = result.outputs.get(constStringFx).html;
    expect(html).toMatch(/<span class="version-pill"><span data-scrml-logic="_scrml_logic_\d+"><\/span><\/span>/);
  });

  test("no `_scrml_effect` subscription (nothing reactive to track)", () => {
    const result = compile(constStringFx);
    const js = result.outputs.get(constStringFx).clientJs;
    // The wiring block for the const interpolation should NOT have a _scrml_effect call.
    // It's a one-shot write, not a subscription. Match only the relevant wiring block by
    // scoping to a small region after the "Reactive display wiring" marker.
    const wiringSection = js.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).not.toMatch(/_scrml_effect\(function\(\)\s*\{\s*el\.textContent\s*=\s*VERSION/);
  });
});

// ---------------------------------------------------------------------------
// §2: `${const-number}` — same shape, numeric value
// ---------------------------------------------------------------------------

describe("§2: `${const-number}` in markup body wires textContent", () => {
  test("compile succeeds", () => {
    const result = compile(constNumberFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js wires `el.textContent = YEAR` (number coerces to string at runtime)", () => {
    const result = compile(constNumberFx);
    const js = result.outputs.get(constNumberFx).clientJs;
    expect(js).toMatch(/Reactive display wiring ---[\s\S]*el\.textContent\s*=\s*YEAR\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §3: `${"string-literal"}` — literal interpolation
// ---------------------------------------------------------------------------

describe("§3: `${\"string-literal\"}` in markup body wires textContent", () => {
  test("compile succeeds", () => {
    const result = compile(literalStringFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js wires `el.textContent = \"hello\"`", () => {
    const result = compile(literalStringFx);
    const js = result.outputs.get(literalStringFx).clientJs;
    expect(js).toMatch(/Reactive display wiring ---[\s\S]*el\.textContent\s*=\s*"hello"\s*;/);
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

  test("client.js still wires `_scrml_effect(function() { el.textContent = _scrml_reactive_get(\"count\") })`", () => {
    const result = compile(atVarFx);
    const js = result.outputs.get(atVarFx).clientJs;
    expect(js).toMatch(/_scrml_effect\(function\(\)\s*\{\s*el\.textContent\s*=\s*_scrml_reactive_get\("count"\)/);
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
