/**
 * each-empty-fallback-teardown-6nz.browser.test.js — 6nz Bug AI (S218).
 *
 * Runtime gate for `<each>`/`<empty>` fallback teardown on the empty -> non-empty
 * edge. Compile-clean is NOT enough: the bug is a RUNTIME DOM artifact. This test
 * loads the emitted client.js AS-IS in real module-init order, drives the reactive
 * collection across the empty <-> non-empty boundary, and asserts the each MOUNT's
 * innerHTML at each transition.
 *
 * Root cause (pre-fix): the emitted each render fn's empty branch does
 * `mount.replaceChildren()` + append the <empty> fallback (a NON-keyed text node)
 * + return. The non-empty branch calls `_scrml_reconcile_list(mount, ...)` WITHOUT
 * first clearing. Inside reconcile, `oldNodes` only collects children carrying a
 * `_scrml_key`; the fallback text node has none, so `oldNodes.size === 0`, and the
 * bulk-create-from-empty fast path APPENDED the new <li>s beside the stale
 * fallback. Observed: `EMPTY-FALLBACK<li>item 1</li>`.
 *
 * Fix: `_scrml_reconcile_list` clears stray non-keyed content
 * (`container.replaceChildren()`) at the top of the `oldNodes.size === 0` branch
 * — safe because zero keyed children means nothing keyed is preserved.
 *
 * Models: each-per-item-reactivity-bug64.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The 6nz repro: <each in=@items key=__index__> with an <empty> fallback.
const REPRO_SRC = `<program>
<items>: string[] = []
<ol class="list">
  <each in=@items key=__index__>
    <li : @.>
    <empty : "EMPTY-FALLBACK">
  </each>
</ol>
</program>
`;

// <each> with NO <empty> sub-element — adversarial: the bulk-create branch must
// still work (first render + add/remove); nothing to clear, replaceChildren is a
// no-op on an empty container.
const NO_EMPTY_SRC = `<program>
<items>: string[] = []
<ol class="list">
  <each in=@items key=__index__>
    <li : @.>
  </each>
</ol>
</program>
`;

// Struct items keyed by @.id — adversarial: normal keyed reconcile
// (add / remove-from-middle / reorder) must not lose / duplicate items, and the
// <empty> fallback must round-trip across empty <-> non-empty.
const STRUCT_KEYED_SRC = `<program>
type Row:struct = { id: string, label: string }
<rows>: Row[] = []
<ol class="rows">
  <each in=@rows key=@.id>
    <li : @.label>
    <empty : "NO-ROWS">
  </each>
</ol>
</program>
`;

// Nested <each> — adversarial: the clear must be scoped to the inner mount, not
// blow away the outer list. Outer rows each carry a `tags` list.
const NESTED_SRC = `<program>
type Group:struct = { id: string, name: string, tags: string[] }
<groups>: Group[] = []
<ul class="groups">
  <each in=@groups key=@.id>
    <li>
      \${@.name}
      <ul class="tags">
        <each in=@.tags key=__index__>
          <li : @.>
          <empty : "NO-TAGS">
        </each>
      </ul>
    </li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-empty-fallback-6nz");

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

describe("6nz Bug AI browser — <each>/<empty> fallback teardown on empty -> non-empty", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        // Mirror real codegen cell writes: store a deep-reactive proxy so field
        // reads/writes go through the reactive Proxy (set trap -> trigger).
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      // Approach A-unified: the each mounts as a comment fence `<!--scrml-each:N-->`
      // and renders rows as SIBLINGS between the anchors in the each's real parent
      // (the list element). Return a view whose `innerHTML` is exactly the
      // between-fence content — the equivalent of the old mount div's innerHTML,
      // so the exact-match teardown assertions hold unchanged.
      mount: (listSel) => {
        const host = document.querySelector(listSel);
        if (!host) return null;
        const w = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
        let start = null, n;
        while ((n = w.nextNode())) {
          if (String(n.data || "").trim().indexOf("scrml-each:") === 0) { start = n; break; }
        }
        if (!start) return null;
        const endData = "/" + String(start.data || "").trim();
        return {
          get innerHTML() {
            let s = "", c = start.nextSibling;
            while (c && !(c.nodeType === 8 && String(c.data || "").trim() === endData)) {
              s += c.nodeType === 1 ? c.outerHTML : (c.nodeType === 3 ? c.textContent : "");
              c = c.nextSibling;
            }
            return s;
          },
        };
      },
      // Outer each's direct <li> rows only (now direct children of the list element)
      // — NOT the inner nested-each mounts' <li>s (those live under <ul.tags>).
      lisIn: (listSel) => [...document.querySelectorAll(`${listSel} > li`)],
    };
  }

  // -- THE BUG: the 5-step transition sequence ------------------------------

  test("empty -> add -> add -> clear -> add: fallback torn down on every non-empty edge", () => {
    const app = mount(REPRO_SRC, "repro");
    const m = app.mount("ol.list");
    expect(m).not.toBeNull();

    // Step 1 — initial (@items=[]) -> fallback present, no <li>.
    expect(m.innerHTML).toBe("EMPTY-FALLBACK");

    // Step 2 — after 1x add -> <li>item 1</li>, fallback GONE.
    app.set("items", ["item 1"]);
    expect(m.innerHTML).toBe("<li>item 1</li>");

    // Step 3 — after 2x add -> two <li>s, no fallback.
    app.set("items", ["item 1", "item 2"]);
    expect(m.innerHTML).toBe("<li>item 1</li><li>item 2</li>");

    // Step 4 — after clear -> fallback present again, no <li>.
    app.set("items", []);
    expect(m.innerHTML).toBe("EMPTY-FALLBACK");

    // Step 5 — add again (2nd empty->non-empty cycle) -> <li>, no fallback.
    app.set("items", ["item 1"]);
    expect(m.innerHTML).toBe("<li>item 1</li>");
  });

  test("repeated empty <-> non-empty cycles (>=3 round-trips) never leak the fallback", () => {
    const app = mount(REPRO_SRC, "cycles");
    const m = app.mount("ol.list");
    for (let cycle = 0; cycle < 4; cycle++) {
      // empty
      app.set("items", []);
      expect(m.innerHTML).toBe("EMPTY-FALLBACK");
      // non-empty
      app.set("items", ["a", "b"]);
      expect(m.innerHTML).toBe("<li>a</li><li>b</li>");
    }
  });

  // -- S215 adversarial: <each> WITHOUT <empty> -----------------------------

  describe("adversarial: <each> WITHOUT <empty>", () => {
    test("first render (empty) + add + remove: no fallback artifact, correct items", () => {
      const app = mount(NO_EMPTY_SRC, "noempty");
      const m = app.mount("ol.list");
      // first render with empty defined cell -> empty mount (no fallback exists).
      expect(m.innerHTML).toBe("");
      app.set("items", ["x", "y", "z"]);
      expect(m.innerHTML).toBe("<li>x</li><li>y</li><li>z</li>");
      app.set("items", ["x", "z"]);
      expect(m.innerHTML).toBe("<li>x</li><li>z</li>");
      app.set("items", []);
      expect(m.innerHTML).toBe("");
    });
  });

  // -- S215 adversarial: struct items keyed by @.id (normal reconcile) ------

  describe("adversarial: struct items keyed by @.id", () => {
    test("add / remove-from-middle / reorder: no loss / duplication / fallback artifact", () => {
      const app = mount(STRUCT_KEYED_SRC, "structkeyed");
      const m = app.mount("ol.rows");

      // empty -> fallback.
      expect(m.innerHTML).toBe("NO-ROWS");

      // empty -> non-empty: fallback gone, three rows.
      app.set("rows", [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ]);
      expect(m.innerHTML).toBe("<li>Alpha</li><li>Beta</li><li>Gamma</li>");

      // remove from the middle (drop b).
      app.set("rows", [
        { id: "a", label: "Alpha" },
        { id: "c", label: "Gamma" },
      ]);
      expect(m.innerHTML).toBe("<li>Alpha</li><li>Gamma</li>");

      // reorder (c before a) — content follows the KEY.
      app.set("rows", [
        { id: "c", label: "Gamma" },
        { id: "a", label: "Alpha" },
      ]);
      expect(m.innerHTML).toBe("<li>Gamma</li><li>Alpha</li>");

      // add back in the middle.
      app.set("rows", [
        { id: "c", label: "Gamma" },
        { id: "b", label: "Beta" },
        { id: "a", label: "Alpha" },
      ]);
      expect(m.innerHTML).toBe("<li>Gamma</li><li>Beta</li><li>Alpha</li>");

      // back to empty -> fallback returns.
      app.set("rows", []);
      expect(m.innerHTML).toBe("NO-ROWS");

      // 2nd empty->non-empty cycle: fallback torn down again.
      app.set("rows", [{ id: "z", label: "Zed" }]);
      expect(m.innerHTML).toBe("<li>Zed</li>");
    });
  });

  // -- S215 adversarial: nested <each> --------------------------------------

  describe("adversarial: nested <each> (clear scoped to inner mount)", () => {
    // The load-bearing property for THIS fix: each inner each's bulk-create
    // (fresh inner mount) clears only ITS OWN mount; the outer list stays intact
    // and a sibling inner each's <empty> fallback does NOT leak across mounts.
    //
    // OUT OF SCOPE (pre-existing, separate bug class): an inner nested-each does
    // NOT re-render when its OUTER item node is REUSED on an outer keyed
    // reconcile (same outer key). So mutating an outer row's `tags` after the
    // outer node already exists leaves the inner mount frozen at its create-time
    // value. That is the nested-each per-item subscription gap (Bug 72 / S212
    // Approach C territory), not the empty->non-empty fallback teardown. Verified
    // independent of this fix. This test therefore exercises FRESH inner mounts
    // (new outer keys), which is what the bulk-create clear governs.
    test("each fresh inner each scopes its clear; outer list intact; no fallback cross-leak", () => {
      const app = mount(NESTED_SRC, "nested");

      // g1 has no tags (inner each empty -> fallback); g2 has one tag.
      app.set("groups", [
        { id: "g1", name: "First", tags: [] },
        { id: "g2", name: "Second", tags: ["t1"] },
      ]);

      // Outer list intact: exactly two outer <li>s (direct children of the OUTER
      // mount) — the inner each's clear did NOT touch the outer mount.
      expect(app.lisIn("ul.groups").length).toBe(2);

      // Inner tag mounts: g1 empty -> "NO-TAGS" fallback; g2 -> "<li>t1</li>".
      // The fallback lives ONLY in g1's mount; it did not leak into g2's.
      const tagMounts = [...document.querySelectorAll("ul.tags [data-scrml-each-mount]")];
      expect(tagMounts.length).toBe(2);
      expect(tagMounts[0].innerHTML).toBe("NO-TAGS");
      expect(tagMounts[1].innerHTML).toBe("<li>t1</li>");

      // Replace with a DIFFERENT outer key set (g3 with tags, g4 empty) — the
      // outer reconcile creates FRESH inner mounts. Each inner bulk-create clears
      // only its own mount; the outer list is exactly two; the empty inner each
      // (g4) shows the fallback and the non-empty one (g3) shows its <li>s — no
      // cross-mount leakage from the previous render.
      app.set("groups", [
        { id: "g3", name: "Third", tags: ["a", "b"] },
        { id: "g4", name: "Fourth", tags: [] },
      ]);
      expect(app.lisIn("ul.groups").length).toBe(2);
      const tagMounts2 = [...document.querySelectorAll("ul.tags [data-scrml-each-mount]")];
      expect(tagMounts2.length).toBe(2);
      expect(tagMounts2[0].innerHTML).toBe("<li>a</li><li>b</li>");
      expect(tagMounts2[1].innerHTML).toBe("NO-TAGS");
    });
  });
});
