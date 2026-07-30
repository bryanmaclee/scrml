/**
 * if-mount-dirty-subtree.browser.test.js
 *
 * Regression gate for change-id `if-mount-unmount-phase2`, unit 1 (S301).
 *
 * WHAT WAS WRONG. `if=` compiled to two lowerings picked silently by
 * `isCleanIfNode` (emit-html.ts): `<template>` + `<!--scrml-if-marker-->`
 * mount/unmount when the subtree contained NOTHING dynamic, and
 * `data-scrml-bind-if` -> `el.style.display` for everything else. SPEC §17.1
 * (SPEC.md:10914) says "When `expr` evaluates to false, the element is NOT
 * rendered. **It does not exist in the DOM**", and §17.2 (:11195) draws the
 * contrast outright: "`show=` hides, `if=` removes". A single `${…}`
 * interpolation was enough to flip `if=` from removes to hides — 101 of 149
 * `if=` sites in the flagship app took the non-conformant path.
 *
 * WHY IT SURVIVED SO LONG. §17.1's "does not exist in the DOM" had NO assertion
 * anywhere in the corpus: every existing test asserted the PRESENT half
 * (`count: 1` / text after a false->true flip) or, worse, asserted
 * `style="display: none;"` on an element §17.1 says must be absent. This file
 * asserts the ABSENT half, and does it by driving the real emitted client.js in
 * happy-dom rather than grepping emit strings.
 *
 * WHAT IT COVERS — one reproducer per category the fix had to carry, because the
 * hard part is not the toggle, it is that a mounted subtree's OWN wiring has to
 * be re-bound (it was emitted at file scope against a document that could not see
 * inside the <template>):
 *   §1 absence      — every gated element is count 0 while the predicate is false
 *   §2 interpolation — `${@cell}` inside a mounted subtree renders and stays live
 *   §3 events        — delegable AND non-delegable handlers fire after mount
 *   §4 bind:value    — two-way binding works after mount (emit-bindings' wiring is
 *                      boot-only + document-scoped; it needed _scrml_bind_rewire)
 *   §5 nested if=    — an inner if= inside a mounted subtree mounts (its <template>
 *                      is only reachable via the OUTER clone)
 *   §6 <each>        — a list inside a mounted subtree renders (needs the fence
 *                      walk, _scrml_remount_each, not just the rehydrator)
 *   §7 teardown      — repeated toggles do not accumulate effects or nodes
 *   §8 show= intact  — §17.2 still hides rather than removes (the fix must not
 *                      collapse the two)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// One page carrying every category. `<shown>` gates them all so a single write
// drives the whole surface, which is also how the leak check in §7 works.
const SRC = `<page>
<shown> = false
<label> = "alpha"
<typed> = ""
<clicks> = 0
<inputs> = 0
<items>: string[] = ["one", "two"]

function bump() {
    @clicks = @clicks + 1
}

function bumpInput() {
    @inputs = @inputs + 1
}

<div id="static" if=@shown>plain static text</div>
<div id="interp" if=@shown>\${@label}</div>
<div id="selfclick" if=@shown onclick=bump()>click me</div>
<div id="selfinput" if=@shown oninput=bumpInput()>self input</div>
<div id="outer" if=@shown>
    <span id="inner" if=@shown>\${@label}</span>
</div>
<div id="haseach" if=@shown>
    <ul id="list">
        <each in=@items as it key=__index__>
            <li>\${it}</li>
        </each>
    </ul>
</div>
<div id="hasbind" if=@shown>
    <input id="field" type="text" bind:value=@typed/>
</div>
<div id="hidden" show=@shown>shown-gated</div>
</page>
`;

const tmpRoot = resolve("/tmp", "scrml-if-mount-dirty");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
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
// §0 — emit shape: the display lowering is GONE from the `if=` path
// ---------------------------------------------------------------------------

describe("if= dirty-subtree §0 — one lowering, and it is the §17.1 one", () => {
  test("the page compiles clean", () => {
    expect(compileToOutputs(SRC, "app").errors).toEqual([]);
  });

  test("no `if=` site emits data-scrml-bind-if; every one emits template+marker", () => {
    const { html } = compileToOutputs(SRC, "app");
    expect(html).not.toContain("data-scrml-bind-if");
    // 8 `if=` sites (7 top-level + 1 nested inside #outer). Match the if=
    // template id prefix specifically — the `<each>` row template is also a
    // `<template>` and would inflate a bare `<template id="` count.
    // Templates and markers must come in PAIRS: a template with no marker is a
    // subtree that can never mount.
    expect((html.match(/scrml-if-marker:/g) ?? []).length).toBe(8);
    expect((html.match(/<template id="_scrml_scrml_tpl_/g) ?? []).length).toBe(8);
  });

  test("`show=` KEEPS its display lowering — §17.2 hides, it does not remove", () => {
    const { html } = compileToOutputs(SRC, "app");
    expect(html).toContain("data-scrml-bind-show");
  });

  test("the runtime ships the ifmount chunk for a page that uses if=", () => {
    const { runtimeJs } = compileToOutputs(SRC, "app");
    expect(runtimeJs).toContain("function _scrml_mount_template");
    expect(runtimeJs).toContain("function _scrml_mount_wire");
    expect(runtimeJs).toContain("function _scrml_self_scope");
  });

  test("a page with NO if= does not ship the ifmount chunk (runtime minimality)", () => {
    const { runtimeJs } = compileToOutputs(`<page>
<n> = 0
<button onclick=\${@n = @n + 1}>count is \${@n}</button>
</page>
`, "noif");
    expect(runtimeJs).not.toContain("function _scrml_mount_template");
    expect(runtimeJs).not.toContain("function _scrml_mount_wire");
    // …but the mount-scope FLAG stays, because _scrml_region_track reads it.
    expect(runtimeJs).toContain("_scrml_active_mount_scope");
  });
});

// ---------------------------------------------------------------------------
// §1-§8 — drive the emitted client.js in happy-dom
// ---------------------------------------------------------------------------

describe("if= dirty-subtree — live DOM behaviour", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs } = compileToOutputs(SRC, "app");
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      count: (sel) => document.querySelectorAll(sel).length,
      one: (sel) => document.querySelector(sel),
    };
  }

  // §1 ---------------------------------------------------------------------
  test("§1 predicate false: EVERY gated element is absent from the DOM, not hidden", () => {
    const app = mount();
    for (const sel of ["#static", "#interp", "#selfclick", "#selfinput", "#outer", "#inner", "#haseach", "#hasbind", "#list", "#field"]) {
      expect(app.count(sel)).toBe(0);
    }
    // The contrast: `show=` leaves its element in the DOM and hides it.
    expect(app.count("#hidden")).toBe(1);
    expect(app.one("#hidden").style.display).toBe("none");
  });

  test("§1 predicate true then false again: the elements LEAVE the DOM", () => {
    const app = mount();
    app.set("shown", true);
    expect(app.count("#static")).toBe(1);
    expect(app.count("#interp")).toBe(1);
    app.set("shown", false);
    expect(app.count("#static")).toBe(0);
    expect(app.count("#interp")).toBe(0);
  });

  // §2 ---------------------------------------------------------------------
  test("§2 interpolation inside a mounted subtree renders, and stays live", () => {
    const app = mount();
    app.set("shown", true);
    expect(app.one("#interp").textContent.trim()).toBe("alpha");
    // The effect was created during the mount pass, so it is live.
    app.set("label", "beta");
    expect(app.one("#interp").textContent.trim()).toBe("beta");
  });

  test("§2 a remount re-reads the CURRENT cell value", () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    app.set("label", "gamma");
    app.set("shown", true);
    expect(app.one("#interp").textContent.trim()).toBe("gamma");
  });

  // §3 ---------------------------------------------------------------------
  test("§3 a DELEGABLE handler on the mounted root fires (document delegation)", () => {
    const app = mount();
    app.set("shown", true);
    app.one("#selfclick").dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.get("clicks")).toBe(1);
  });

  test("§3 a NON-delegable handler on the mounted ROOT fires (needs the self-inclusive scope)", () => {
    const app = mount();
    app.set("shown", true);
    // `input` is element-scoped, not delegated, and the handler is on the if=
    // element ITSELF — `mountedRoot.querySelectorAll(...)` would never match it,
    // which is exactly what _scrml_self_scope exists to fix.
    app.one("#selfinput").dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.get("inputs")).toBe(1);
  });

  test("§3 handlers still fire after an unmount/remount cycle, and only once per event", () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    app.set("shown", true);
    app.one("#selfclick").dispatchEvent(new Event("click", { bubbles: true }));
    expect(app.get("clicks")).toBe(1);
    app.one("#selfinput").dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.get("inputs")).toBe(1);
  });

  // §4 ---------------------------------------------------------------------
  test("§4 bind:value inside a mounted subtree is two-way", () => {
    const app = mount();
    app.set("shown", true);
    const field = app.one("#field");
    expect(field).not.toBeNull();
    // DOM -> cell
    field.value = "hello";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.get("typed")).toBe("hello");
    // cell -> DOM
    app.set("typed", "world");
    expect(field.value).toBe("world");
  });

  test("§4 bind:value re-binds on remount (a fresh clone, a fresh listener)", () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    app.set("shown", true);
    const field = app.one("#field");
    // The remounted input is seeded from the cell…
    expect(field.value).toBe("");
    field.value = "again";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(app.get("typed")).toBe("again");
  });

  // §5 ---------------------------------------------------------------------
  test("§5 a NESTED if= inside a mounted subtree mounts too", () => {
    const app = mount();
    app.set("shown", true);
    expect(app.count("#outer")).toBe(1);
    expect(app.count("#inner")).toBe(1);
    expect(app.one("#inner").textContent.trim()).toBe("alpha");
  });

  test("§5 the nested if= is independently reactive after the outer mounts", () => {
    const app = mount();
    app.set("shown", true);
    expect(app.count("#inner")).toBe(1);
    app.set("shown", false);
    expect(app.count("#inner")).toBe(0);
    expect(app.count("#outer")).toBe(0);
  });

  // §6 ---------------------------------------------------------------------
  test("§6 an <each> inside a mounted subtree renders its rows", () => {
    const app = mount();
    app.set("shown", true);
    const rows = document.querySelectorAll("#list li");
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["one", "two"]);
  });

  test("§6 the mounted <each> stays reactive to its source cell", () => {
    const app = mount();
    app.set("shown", true);
    app.set("items", ["x", "y", "z"]);
    expect(document.querySelectorAll("#list li").length).toBe(3);
  });

  test("§6 remount re-renders the list from the CURRENT items", () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    app.set("items", ["solo"]);
    app.set("shown", true);
    const rows = document.querySelectorAll("#list li");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent.trim()).toBe("solo");
  });

  // §7 ---------------------------------------------------------------------
  test("§7 repeated toggles leave exactly ONE copy of each element (no accumulation)", () => {
    const app = mount();
    for (let i = 0; i < 5; i++) {
      app.set("shown", true);
      app.set("shown", false);
    }
    app.set("shown", true);
    for (const sel of ["#static", "#interp", "#selfclick", "#outer", "#inner", "#haseach", "#field"]) {
      expect(app.count(sel)).toBe(1);
    }
    expect(document.querySelectorAll("#list li").length).toBe(2);
    // Marker comments are never duplicated either — one per if= site, always.
    const comments = [];
    const walker = document.createTreeWalker(document.body, 128 /* SHOW_COMMENT */);
    let n;
    while ((n = walker.nextNode())) {
      const d = String(n.data || "").trim();
      if (d.startsWith("scrml-if-marker:")) comments.push(d);
    }
    expect(comments.length).toBe(new Set(comments).size);
  });

  test("§7 an unmounted subtree's interpolation effect is disposed (no writes into detached nodes)", () => {
    const app = mount();
    app.set("shown", true);
    const detached = app.one("#interp");
    app.set("shown", false);
    // The node is out of the tree; its effect was registered against the mount
    // scope and drained by _scrml_unmount_scope, so a later cell write must NOT
    // reach it. If the effect leaked, textContent would follow @label.
    app.set("label", "leaked");
    expect(detached.textContent.trim()).toBe("alpha");
    // …and the FRESH mount does show the new value.
    app.set("shown", true);
    expect(app.one("#interp").textContent.trim()).toBe("leaked");
  });
});
