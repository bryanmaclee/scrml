/**
 * Bug 4 — Named derived reactive references in markup get DOM wiring
 *
 * Root cause: `collectReactiveVarNames` in reactive-deps.ts collected
 * `state-decl` (`@x = ...`) and `tilde-decl` with reactive deps, but did
 * NOT collect `reactive-derived-decl` (`const @isInsert = ...`). That set is
 * used as a filter by `extractReactiveDeps`, so markup interpolations like
 * `${@isInsert}` had their `reactiveRefs` computed as empty. emit-event-wiring
 * then saw `varRefs.length === 0` at line 459 and skipped the entire wiring
 * block — the element rendered its initial text and never updated.
 *
 * A second issue surfaced once wiring emission was restored: the emit-expr
 * rewrite didn't route `@derived` to `_scrml_derived_get` because
 * `emitExprField` calls in emit-event-wiring didn't pass `ctx.derivedNames`.
 * Result: wiring emitted `_scrml_reactive_get("isInsert")` which reads from
 * the reactive state map (undefined) instead of the derived cache.
 *
 * Two-part fix:
 * 1. Add `reactive-derived-decl` to `collectReactiveVarNames` so derived
 *    names survive `extractReactiveDeps` filtering.
 * 2. Populate `ctx.derivedNames` via `collectDerivedVarNames(fileAST)` at
 *    both CompileContext construction sites (browser + library mode); thread
 *    `ctx.derivedNames` through the markup-interpolation `emitExprField`
 *    calls so the rewrite routes derived refs through `_scrml_derived_get`.
 *
 * Runtime semantics when wiring fires: the effect body calls
 * `_scrml_derived_get("isInsert")`. On first call, the derived is dirty so
 * `fn()` runs inside the effect stack, calling `_scrml_reactive_get("mode")`
 * which registers "mode" as a dep of the outer effect. Subsequent mutations
 * to @mode propagate dirty-flags and re-fire the outer effect, which re-reads
 * the derived and updates textContent.
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `bug4-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_bug4_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
  }
}

describe("Bug 4 — derived-reactive markup display wiring", () => {
  test("named derived reference `${@isInsert}` gets a wiring block", () => {
    const src = `<program>
\${
  @mode = "insert"
  const @isInsert = @mode == "insert"
}
<p>\${@isInsert}</p>
</program>`;
    const { clientJs } = compileSource(src, "named-derived-has-wiring");
    expect(clientJs).toBeTruthy();
    // Count wiring blocks under "--- Reactive display wiring ---"
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    // The <p>${@isInsert}</p> placeholder gets _scrml_logic_3 (after program=1, ${}=2)
    // navigate-wave1b: reactive display is wired inside `_scrml_nav_rewire(root)`
    // so it re-binds on a soft nav; the query is `(root || document)`-scoped.
    expect(wiringSection).toMatch(/const el = \(root \|\| document\)\.querySelector\('\[data-scrml-logic="_scrml_logic_\d+"\]'\)/);
  });

  test("named derived rewrite routes through _scrml_derived_get (not _scrml_reactive_get)", () => {
    const src = `<program>
\${
  @mode = "insert"
  const @isInsert = @mode == "insert"
}
<p>\${@isInsert}</p>
</program>`;
    const { clientJs } = compileSource(src, "routes-through-derived-get");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    // Every reference to `@isInsert` inside the wiring must use derived_get.
    expect(wiringSection).toContain('_scrml_derived_get("isInsert")');
    // Must NOT emit _scrml_reactive_get for a derived name.
    expect(wiringSection).not.toContain('_scrml_reactive_get("isInsert")');
  });

  test("wiring wraps in _scrml_effect for reactive re-render", () => {
    const src = `<program>
\${
  @mode = "insert"
  const @isInsert = @mode == "insert"
}
<p>\${@isInsert}</p>
</program>`;
    const { clientJs } = compileSource(src, "effect-wrap");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).toContain("_scrml_effect(function()");
    // markup-value-in-expression-2026-06-17: the display routes through the
    // node-aware `_scrml_render_value(el, expr)` helper (was `el.textContent =`).
    expect(wiringSection).toMatch(/_scrml_effect\(function\(\) \{ _scrml_render_value\(el, _scrml_derived_get\("isInsert"\)\); \}\)/);
  });

  test("string-returning derived also wired correctly", () => {
    const src = `<program>
\${
  @name = "world"
  const @greeting = "Hello, " + @name
}
<p>\${@greeting}</p>
</program>`;
    const { clientJs } = compileSource(src, "string-derived");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).toContain('_scrml_derived_get("greeting")');
  });

  test("plain @reactive refs still rewrite to _scrml_reactive_get (regression guard)", () => {
    const src = `<program>
\${
  @count = 0
}
<p>\${@count}</p>
</program>`;
    const { clientJs } = compileSource(src, "plain-reactive-unchanged");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).toContain('_scrml_reactive_get("count")');
    expect(wiringSection).not.toContain('_scrml_derived_get("count")');
  });

  test("mixed: direct expr + named derived both wired", () => {
    const src = `<program>
\${
  @mode = "insert"
  const @isInsert = @mode == "insert"
}
<p>direct: \${@mode == "insert"}</p>
<p>derived: \${@isInsert}</p>
</program>`;
    const { clientJs } = compileSource(src, "mixed-direct-derived");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    // Both placeholders should produce wiring blocks.
    // navigate-wave1b: reactive display wiring is `(root || document)`-scoped
    // (inside `_scrml_nav_rewire`) so it re-binds on a soft nav.
    const blockCount = (wiringSection.match(/const el = \(root \|\| document\)\.querySelector/g) || []).length;
    expect(blockCount).toBe(2);
    // Direct expression uses reactive_get on @mode.
    expect(wiringSection).toContain('_scrml_reactive_get("mode")');
    // Derived reference uses derived_get on @isInsert.
    expect(wiringSection).toContain('_scrml_derived_get("isInsert")');
  });

  test("derived used in computed expression: ${@isInsert ? 'yes' : 'no'}", () => {
    const src = `<program>
\${
  @mode = "insert"
  const @isInsert = @mode == "insert"
}
<p>\${@isInsert ? "yes" : "no"}</p>
</program>`;
    const { clientJs } = compileSource(src, "derived-in-ternary");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).toContain('_scrml_derived_get("isInsert")');
    expect(wiringSection).toContain("_scrml_effect(function()");
  });

  test("derived + reactive in same expression: both get correct runtime fn", () => {
    const src = `<program>
\${
  @a = 1
  @b = 2
  const @sum = @a + @b
}
<p>\${@sum + @a}</p>
</program>`;
    const { clientJs } = compileSource(src, "mixed-in-expr");
    const wiringSection = clientJs.split("--- Reactive display wiring ---")[1] ?? "";
    expect(wiringSection).toContain('_scrml_derived_get("sum")');
    expect(wiringSection).toContain('_scrml_reactive_get("a")');
  });
});
