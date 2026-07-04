/**
 * g-nested-each-no-own-subscription.browser.test.js
 *
 * Regression gate for change-id `g-nested-each-no-own-subscription-2026-06-21`
 * (filed docs/known-gaps.md §S212, HIGH).
 *
 * BUG: a NESTED `<each in=@cell>` created inside an OUTER `<each>`'s per-item body
 * was emitted as a ONE-SHOT inline IIFE — it read `_scrml_reactive_get("cell")`
 * ONCE at outer-render time and ran the inner reconcile ONCE, but was NEVER
 * wrapped in any reactive effect and NEVER registered in `_scrml_each_renderers`.
 * So the inner each had NO subscription to its own cell. A post-mount update to
 * the inner cell (the LOAD-ON-DEMAND case: `@shared` empty at outer-render,
 * populated by a later event) re-rendered NOTHING — the inner list froze EMPTY.
 * Compiles clean; runtime-dead. (Only the OUTER, top-level each got a render-fn
 * registration + `_scrml_effect_static` subscription.)
 *
 * FIX (emit-each.ts, Approach C): the nested-each inline branch
 * (renderTemplateChildToJs) — and its Tier-0 `${for…lift}` sibling
 * (emitNestedEachFromMarkup) — now wrap the inner source-read + reconcile in a
 * PER-ITEM `_scrml_effect(() => {...})`. The effect closure binds both the outer
 * iter var AND the closure-captured inner mount, so each outer item's inner each
 * subscribes to its source and re-reconciles ITS OWN mount on every change.
 * `_scrml_effect` un-pauses dependency tracking, so the `_scrml_reactive_get(...)`
 * inside the effect subscribes correctly even though it is created during the
 * outer `_scrml_reconcile_list` pass (which pauses tracking).
 *
 * This test loads the emitted client.js AS-IS in real module-init order, fires a
 * post-mount cell update, and asserts the inner each(es) ACTUALLY render the new
 * items in the DOM (compile-clean is NOT enough — the S140/S152 runtime lesson).
 * Pre-fix the post-mount assertions FAIL (inner lists stay empty); post-fix pass.
 *
 * Models: nested-each-in-enclosing-scope.browser.test.js + engine-gated-each-populate.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro: TWO outer projects, each with a nested `<each in=@shared>`. `@shared` is
// EMPTY at outer-render time and populated post-mount by `load()` (the
// load-on-demand case — THE bug). All N inner mounts share the `each_<id>`
// data-attr, so each outer item must own its own per-item subscription.
const NESTED_CELL_SRC = `<div>
  \${ <projects>: string[] = ["p1","p2"]
     <shared>: string[] = []
     function load() { @shared = ["a","b","c"] }
  }
  <button onclick=load()>load</button>
  <each in=@projects as p key=p>
    <div>
      <h3>\${p}</h3>
      <each in=@shared as s key=s><p>\${s}</p></each>
    </div>
  </each>
</div>
`;

// no-regression: inner cell already populated BEFORE outer-render. The inner each
// must STILL render the initial items (the per-item effect's first run).
const PREPOPULATED_SRC = `<div>
  \${ <projects>: string[] = ["p1","p2"]
     <shared>: string[] = ["x","y","z"]
     function clear() { @shared = [] }
  }
  <button onclick=clear()>clear</button>
  <each in=@projects as p key=p>
    <div>
      <h3>\${p}</h3>
      <each in=@shared as s key=s><p>\${s}</p></each>
    </div>
  </each>
</div>
`;

const tmpRoot = resolve("/tmp", "scrml-nested-each-no-sub");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — emit shape: the inner each is wrapped in a reactive effect that reads
//      its source INSIDE the effect (so a post-mount cell update re-fires it).
// ---------------------------------------------------------------------------

describe("g-nested-each-no-own-subscription §1 — emit shape (inner each owns a subscription)", () => {
  test("compiles with no errors", () => {
    expect(compileToOutputs(NESTED_CELL_SRC, "nested").errors).toEqual([]);
  });

  test("the inner each's source-read happens INSIDE a _scrml_effect (subscribed, not one-shot)", () => {
    const { clientJs } = compileToOutputs(NESTED_CELL_SRC, "nested");
    // PRE-FIX the inner each emitted:
    //   const _scrml_each_items_N = _scrml_reactive_get("shared");
    //   (() => { ... reconcile ... })();
    // i.e. a bare read + bare IIFE — NO effect. POST-FIX the read is INSIDE a
    // `_scrml_effect(() => { const _scrml_each_items_N = _scrml_reactive_get("shared"); ... });`
    // so the read is a tracked dep. Assert the read sits inside an effect body by
    // confirming the read is NOT the bare one-shot form and an effect precedes the
    // inner reconcile against the item-local mount.
    expect(clientJs).toContain('_scrml_reactive_get("shared")');
    // The bare one-shot read at the start of a statement (the defective shape) is gone.
    expect(clientJs).not.toMatch(/^\s*const _scrml_each_items_\d+ = _scrml_reactive_get\("shared"\);\s*$\n\s*\(\(\) => \{/m);
    // The inner read is preceded by a `_scrml_effect(() => {` opener (the per-item
    // subscription), and is followed by an inner `_scrml_reconcile_list(` against
    // the item-local `_scrml_each_mount_` var.
    const innerReadIdx = clientJs.indexOf('const _scrml_each_items');
    expect(innerReadIdx).toBeGreaterThan(-1);
    const effectBeforeRead = clientJs.lastIndexOf('_scrml_effect(() => {', innerReadIdx);
    expect(effectBeforeRead).toBeGreaterThan(-1);
    expect(effectBeforeRead).toBeLessThan(innerReadIdx);
  });

  test("emitted client.js parses (no E-CODEGEN-INVALID-LOGIC / E-SCOPE-001)", () => {
    const { errors } = compileToOutputs(NESTED_CELL_SRC, "nested");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    expect(errors.filter((e) => String(e.code || "").includes("SCOPE-001"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: post-mount inner-cell update re-renders the inner each
//      (THE bug) + multiple outer items each update their own inner each.
// ---------------------------------------------------------------------------

describe("g-nested-each-no-own-subscription §2 — post-mount inner update re-renders (real module-init order)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      // Every <p> inside an inner-each mount (the inner each emits <p> items).
      // The outer card's <h3> is NOT inside an each-mount, so it is excluded.
      innerItems: () =>
        [...document.querySelectorAll('[data-scrml-each-mount] p')].map((n) => n.textContent.trim()),
      // How many distinct inner-each mounts exist (one per outer item).
      innerMountCount: () => {
        const ids = new Set();
        document.querySelectorAll('[data-scrml-each-mount]').forEach((el) => {
          // Only count the INNER mounts (those nested inside an outer each item).
          if (el.closest('[data-scrml-each-mount] [data-scrml-each-mount]') === el || el.parentElement?.closest('[data-scrml-each-mount]')) {
            ids.add(el);
          }
        });
        return ids.size;
      },
    };
  }

  test("THE bug: inner cell empty at outer-render → load() populates it → inner each renders 3 items per outer card (2 cards → 6)", () => {
    const app = mount(NESTED_CELL_SRC, "nested");
    // Pre-update: @shared is [] → inner eaches render nothing.
    expect(app.innerItems()).toEqual([]);
    // Fire the post-mount update (the load-on-demand case).
    app.set("shared", ["a", "b", "c"]);
    // BOTH outer cards' inner eaches now render a/b/c. Pre-fix this STAYS [].
    expect(app.innerItems()).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  test("post-mount update is reflected in EACH outer item's own inner each (per-item subscription)", () => {
    const app = mount(NESTED_CELL_SRC, "nested");
    app.set("shared", ["x"]);
    // 2 outer projects → 2 inner mounts → each renders the single item "x".
    expect(app.innerItems()).toEqual(["x", "x"]);
    // A second update re-renders both again (subscription is durable, not one-shot).
    app.set("shared", ["m", "n"]);
    expect(app.innerItems()).toEqual(["m", "n", "m", "n"]);
  });

  test("no regression: inner cell PRE-populated before outer-render still renders, and a later clear() empties it", () => {
    const app = mount(PREPOPULATED_SRC, "prepop");
    // @shared = [x,y,z] at outer-render → both cards render x,y,z immediately.
    expect(app.innerItems()).toEqual(["x", "y", "z", "x", "y", "z"]);
    // Post-mount clear → both inner eaches empty (the effect re-runs, empties mounts).
    app.set("shared", []);
    expect(app.innerItems()).toEqual([]);
  });
});
