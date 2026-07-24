/**
 * server-fn-markup-interpolation.test.js — `${serverFn()}` in markup wires to DOM
 *
 * Regression: giti inbound 2026-04-20 GITI-005.
 *
 * `<p>${loadGreeting()}</p>` where `loadGreeting` is a `server function`
 * previously compiled to:
 *   - `_scrml_fetch_loadGreeting_N();` at module top (result dropped)
 *   - empty Reactive-display-wiring block (no @ refs → wiring skipped)
 * so the DOM never received the awaited value. Sender's ask: any
 * working idiom for "call server fn and render its result." This
 * fix gives them `${serverFn()}` directly.
 *
 * Fix (emit-event-wiring.ts):
 *   - Detect server-fn names via fnNameMap prefix `_scrml_fetch_` / `_scrml_cps_`.
 *   - When a logic binding's expression uses a server fn (with or without
 *     @-refs), emit an async IIFE wrapper that awaits the Promise and
 *     assigns the resolved value to el.textContent.
 *   - Non-server interpolations are unchanged.
 *
 * Coverage:
 *   §1  Bug GITI-005 repro — `${loadGreeting()}` produces awaited DOM wiring
 *   §2  Emitted JS parses as a module (no SyntaxError)
 *   §3  Regression guard — `${@var}` still uses synchronous reactive effect
 *   §4  Mixed expression `${@count + suffix()}` (reactive + server fn) is async
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/server-fn-markup");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let gitiFx, atVarFx, mixedFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  gitiFx = fix("giti-005.scrml", `<program>
\${
  server function loadGreeting() {
    lift "hello"
  }
}
<div>
  <p>\${loadGreeting()}</p>
</div>
</program>
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

  mixedFx = fix("mixed.scrml", `<program>
\${
  @count = 0
  server function loadSuffix() {
    lift "items"
  }
  function bump() { @count = @count + 1 }
}
<button onclick=bump()>inc</button>
<p>\${@count + " " + loadSuffix()}</p>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

// ---------------------------------------------------------------------------
// §1: Bug GITI-005 — `${serverFn()}` in markup produces awaited wiring
// ---------------------------------------------------------------------------

describe("§1: GITI-005 — `${serverFn()}` wires an awaited fetch to DOM", () => {
  test("compile succeeds", () => {
    const result = compile(gitiFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js contains an async IIFE that awaits the server-fn fetch", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // The async arrow IIFE assigning awaited value to textContent
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*\{[^}]*await\s*\(_scrml_fetch_loadGreeting_\d+\(\)\)/);
    // textContent is set (not left empty like before)
    expect(js).toContain("el.textContent = await");
  });

  test("the reactive-display-wiring block is NOT empty for server-fn interpolations", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // Before fix: `// --- Reactive display wiring ---\n});` — empty block.
    // After fix: the wiring block contains the async IIFE.
    expect(js).not.toMatch(/Reactive display wiring ---\s*\n\s*\}\);/);
  });
});

// ---------------------------------------------------------------------------
// §2: Emitted JS parses as an ES module (no SyntaxError)
// ---------------------------------------------------------------------------

describe("§2: emitted JS is parseable", () => {
  test("GITI-005 output parses as a module via new Function", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // Strip the top-level import (new Function can't handle import syntax)
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3: Regression — `${@var}` still uses synchronous _scrml_effect
// ---------------------------------------------------------------------------

describe("§3: `${@var}` interpolation uses synchronous effect (no async wrapping)", () => {
  test("pure reactive interpolation does NOT wrap in async IIFE", () => {
    const result = compile(atVarFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(atVarFx).clientJs;
    // Synchronous form: `_scrml_render_value(el, _scrml_reactive_get("count"));`
    // markup-value-in-expression-2026-06-17: the display now routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    // Still synchronous — no async IIFE for a reactive-only interpolation.
    expect(js).toMatch(/_scrml_render_value\(el,\s*_scrml_reactive_get\(/);
    // No async IIFE around the assignment in this reactive-only case
    expect(js).not.toMatch(/\(async\s*\(\s*\)\s*=>\s*\{[^}]*_scrml_reactive_get\("count"\)/);
  });
});

// ---------------------------------------------------------------------------
// §4: Mixed reactive + server-fn expression uses async form
// ---------------------------------------------------------------------------

describe("§4: mixed `${@var + serverFn()}` uses async wrapping", () => {
  test("compile succeeds", () => {
    const result = compile(mixedFx);
    expect(result.errors).toEqual([]);
  });

  test("the reactive effect re-runs with an async wrapper", () => {
    const result = compile(mixedFx);
    const js = result.outputs.get(mixedFx).clientJs;
    // Effect body contains an async IIFE awaiting an expression that
    // includes the server-fn call (the expression also has @count rewrite,
    // so match await + server-fn presence separately).
    expect(js).toMatch(/_scrml_effect\(function\(\)\s*\{\s*\(async/);
    expect(js).toContain("await (");
    expect(js).toMatch(/_scrml_fetch_loadSuffix_\d+\(\)/);
    // The reactive var also participates in the async-wrapped expression
    expect(js).toContain('_scrml_reactive_get("count")');
  });
});
