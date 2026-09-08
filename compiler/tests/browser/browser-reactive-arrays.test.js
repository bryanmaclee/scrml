/**
 * Browser tests for §6.5 reactive arrays — reactive-017-arrays sample.
 *
 * Covers SPEC §6.5 reactive array operations end-to-end:
 *   §1  Initial reactive variable values — @items=[], @nextId=1, @filter=""
 *   §2  Initial DOM state — #add-btn, #remove-btn, #filter-input, #list, #count exist
 *   §3  Append via spread-replace — clicking #add-btn updates @items state
 *   §4  Remove via filter — clicking #remove-btn updates @items state
 *   §5  Count display — @items.length reactive span updates when @items changes
 *   §6  For/lift DOM updates — clicking #add-btn adds DOM items, #remove-btn removes them
 *
 * Note on initial "0" count: happy-dom does not render textContent=0 (falsy number)
 * in all versions. The initial-zero test uses a relaxed assertion (starts with "Count:").
 * Post-click count tests (§5 §2-4) assert "1", "2", "1" which are truthy and do render.
 *
 * Note on list DOM placement: the _scrml_lift mechanism appends to the first
 * [data-scrml-lift-target] in the document, or document.body as fallback. The
 * reactive-017-arrays sample does not set data-scrml-lift-target, so list items
 * are appended to document.body via the wrapper div. §6 tests query document.body
 * for .item elements, not #list specifically.
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 * Loads pre-compiled output from samples/compilation-tests/dist/.
 * Requires: bun compiler/src/index.js samples/compilation-tests/reactive-017-arrays.scrml --output samples/compilation-tests/dist/
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// SKIP: This test file hangs due to _scrml_effect reactive loops in happy-dom.
// The reactive array reconciliation triggers infinite re-renders in the simulated
// DOM. Real browser (Puppeteer) passes. Tracked in master-list.md known issues.
const _SKIP_REACTIVE_ARRAYS = true;

// ⚑ S410 — REPORT THE SKIP AS A SKIP. The flag above is a legitimate decision (the
// file hangs happy-dom), but the MECHANISM was wrong: `distExists` was forced false
// and every test then hit an `if (!distExists) return;` guard, so this file reported
// **35 PASS / 0 fail with zero assertions executed** — 35 green ticks for coverage
// that does not exist. `master-list.md:253` already records this file as "Skipped",
// so the document and the runner disagreed, and the runner is the one CI prints.
//
// ⚑ The sibling `browser-todomvc.test.js` shows the correct shape for the same
// guard: it asserts `expect(distExists).toBe(true)` in a dedicated block, so a
// missing fixture FAILS LOUDLY there. This file had NO such assertion — grep for
// `expect(distExists)` returns 0 hits — which is why nothing ever surfaced.
//
// Using `describe.skip` makes the 35 report as SKIPPED, which is what they are.
// The per-test `if (!distExists) return;` guards below are left in place: they are
// unreachable while this flag is set, and they remain correct if it is ever cleared.
const describeMaybe = _SKIP_REACTIVE_ARRAYS ? describe.skip : describe;

if (!_SKIP_REACTIVE_ARRAYS && !globalThis.document) GlobalRegistrator.register();

const DIST = resolve(import.meta.dir, "../../../samples/compilation-tests/dist");
const SAMPLE = "reactive-017-arrays";

function loadSample() {
  const htmlFile = resolve(DIST, `${SAMPLE}.html`);
  const jsFile = resolve(DIST, `${SAMPLE}.client.js`);

  const htmlContent = readFileSync(htmlFile, "utf-8");
  const clientJs = readFileSync(jsFile, "utf-8");

  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  document.body.innerHTML = cleanHtml;

  const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `window._scrml_reactive_subscribe = _scrml_reactive_subscribe;\n` +
    `})();`;
  eval(code);

  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (name) => window._scrml_reactive_get(name),
    set: (name, val) => window._scrml_reactive_set(name, val),
    clickBtn: (selector) => {
      const btn = document.querySelector(selector);
      if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
  };
}

// Guard: skip all tests if dist file does not exist yet or if skipped
const distExists = !_SKIP_REACTIVE_ARRAYS && existsSync(resolve(DIST, `${SAMPLE}.html`));

// ---------------------------------------------------------------------------
// §1: Initial reactive variable values
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §1: initial reactive variable values", () => {
  test("@items starts as empty array", () => {
    if (!distExists) return;
    const api = loadSample();
    const items = api.get("items");
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(0);
  });

  test("@nextId starts as 1", () => {
    if (!distExists) return;
    const api = loadSample();
    expect(api.get("nextId")).toBe(1);
  });

  test("@filter starts as empty string", () => {
    if (!distExists) return;
    const api = loadSample();
    expect(api.get("filter")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §2: Initial DOM state
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §2: initial DOM state", () => {
  test("#add-btn element exists", () => {
    if (!distExists) return;
    loadSample();
    const btn = document.querySelector("#add-btn");
    expect(btn).not.toBeNull();
  });

  test("#remove-btn element exists", () => {
    if (!distExists) return;
    loadSample();
    const btn = document.querySelector("#remove-btn");
    expect(btn).not.toBeNull();
  });

  test("#filter-input element exists", () => {
    if (!distExists) return;
    loadSample();
    const input = document.querySelector("#filter-input");
    expect(input).not.toBeNull();
  });

  test("#list element exists", () => {
    if (!distExists) return;
    loadSample();
    const list = document.querySelector("#list");
    expect(list).not.toBeNull();
  });

  test("#count element exists", () => {
    if (!distExists) return;
    loadSample();
    const count = document.querySelector("#count");
    expect(count).not.toBeNull();
  });

  test("#count text starts with 'Count:'", () => {
    if (!distExists) return;
    // Note: initial textContent may be "Count: " or "Count: 0" depending on
    // happy-dom behavior with textContent=0 (falsy). We assert the prefix only.
    // Post-click tests in §5 verify the numeric update with truthy values (1, 2).
    loadSample();
    const count = document.querySelector("#count");
    expect(count.textContent).toMatch(/^Count:/);
  });
});

// ---------------------------------------------------------------------------
// §3: Append via spread-replace updates reactive state
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §3: append via spread-replace updates @items state", () => {
  test("clicking #add-btn once makes @items length 1", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    const items = api.get("items");
    expect(items.length).toBe(1);
  });

  test("first item has id=1 and name='Item 1'", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    const items = api.get("items");
    expect(items[0]).toEqual({ id: 1, name: "Item 1" });
  });

  test("clicking #add-btn twice makes @items length 2", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    const items = api.get("items");
    expect(items.length).toBe(2);
  });

  test("@nextId increments to 2 after first add", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    expect(api.get("nextId")).toBe(2);
  });

  test("@nextId increments to 3 after second add", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    expect(api.get("nextId")).toBe(3);
  });

  test("second item has id=2 and name='Item 2'", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    const items = api.get("items");
    expect(items[1]).toEqual({ id: 2, name: "Item 2" });
  });
});

// ---------------------------------------------------------------------------
// §4: Remove via filter updates reactive state
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §4: remove via filter updates @items state", () => {
  test("clicking #remove-btn on empty array leaves @items as empty array", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#remove-btn");

    const items = api.get("items");
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(0);
  });

  test("add one item then remove: @items becomes []", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const items = api.get("items");
    expect(items.length).toBe(0);
  });

  test("add two items then remove: @items has 1 element (id=1 removed)", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const items = api.get("items");
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(2);
  });

  test("remove does not affect @nextId", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    expect(api.get("nextId")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §5: Count display — reactive @items.length span
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §5: count display updates reactively", () => {
  test("#count text starts with 'Count:' initially", () => {
    if (!distExists) return;
    // Note: happy-dom may not render textContent=0 (the falsy number zero)
    // so we only assert the prefix here. Truthy-value tests follow.
    loadSample();
    const count = document.querySelector("#count");
    expect(count.textContent).toMatch(/^Count:/);
  });

  test("#count span shows 1 after one add", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    const count = document.querySelector("#count");
    // @items.length is wired reactively in the CG output — should update
    expect(count.textContent).toContain("1");
  });

  test("#count span shows 2 after two adds", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    const count = document.querySelector("#count");
    expect(count.textContent).toContain("2");
  });

  test("#count span shows 1 after two adds and one remove", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const count = document.querySelector("#count");
    expect(count.textContent).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// §6: For/lift DOM updates — reactive re-render on @items change
//
// Note on DOM placement: _scrml_lift appends to the first [data-scrml-lift-target]
// in the document, or document.body as fallback. The reactive-017-arrays sample
// does not set data-scrml-lift-target, so the list wrapper div lands in document.body.
// Items are rendered as div.item elements inside that wrapper.
// Tests query document.body for .item elements.
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §6: for/lift DOM updates — reactive re-render", () => {
  test("no .item elements exist before any add", () => {
    if (!distExists) return;
    loadSample();
    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(0);
  });

  test("one .item element exists after one add", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(1);
  });

  test(".item text content is 'Item 1' after first add", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");

    const item = document.querySelector(".item");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Item 1");
  });

  test("two .item elements exist after two adds", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(2);
  });

  test("second .item text content is 'Item 2' after two adds", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    const allItems = document.querySelectorAll(".item");
    expect(allItems.length).toBe(2);
    expect(allItems[1].textContent).toContain("Item 2");
  });

  test("add then remove: no .item elements remain", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(0);
  });

  test("add two then remove one: one .item element remains", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(1);
  });

  test("remaining .item after remove shows 'Item 2' (id=1 was removed)", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#remove-btn");

    const item = document.querySelector(".item");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Item 2");
  });
});

// ---------------------------------------------------------------------------
// §7: Keyed reconciliation — DOM node identity preservation
//
// These tests verify that _scrml_reconcile_list reuses DOM nodes for items
// whose keys haven't changed, rather than recreating them from scratch.
// This is the core behavioral guarantee of keyed reconciliation.
// ---------------------------------------------------------------------------

describeMaybe("reactive-arrays §7: keyed reconciliation — DOM node identity preservation", () => {
  test("adding an item preserves existing DOM nodes", () => {
    if (!distExists) return;
    const api = loadSample();

    // Add first item (id=1)
    api.clickBtn("#add-btn");
    const firstItemNode = document.querySelector(".item");
    expect(firstItemNode).not.toBeNull();

    // Add second item (id=2) — first item's node should be the SAME object
    api.clickBtn("#add-btn");
    const allItems = document.querySelectorAll(".item");
    expect(allItems.length).toBe(2);
    // The first .item node should be the same reference (not recreated)
    expect(allItems[0]).toBe(firstItemNode);
  });

  test("removing an item preserves remaining DOM nodes", () => {
    if (!distExists) return;
    const api = loadSample();

    // Add two items (id=1, id=2)
    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    const allItems = document.querySelectorAll(".item");
    expect(allItems.length).toBe(2);
    const secondItemNode = allItems[1]; // id=2

    // Remove first item (id=1) — second item's node should be preserved
    api.clickBtn("#remove-btn");
    const remaining = document.querySelectorAll(".item");
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toBe(secondItemNode);
  });

  test("adding items in bulk preserves all existing nodes", () => {
    if (!distExists) return;
    const api = loadSample();

    // Add three items
    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");
    const nodes = document.querySelectorAll(".item");
    expect(nodes.length).toBe(3);
    const node1 = nodes[0];
    const node2 = nodes[1];
    const node3 = nodes[2];

    // Add a fourth item — all three existing nodes should be preserved
    api.clickBtn("#add-btn");
    const updatedNodes = document.querySelectorAll(".item");
    expect(updatedNodes.length).toBe(4);
    expect(updatedNodes[0]).toBe(node1);
    expect(updatedNodes[1]).toBe(node2);
    expect(updatedNodes[2]).toBe(node3);
  });

  test("nodes have _scrml_key property set", () => {
    if (!distExists) return;
    const api = loadSample();

    api.clickBtn("#add-btn");
    api.clickBtn("#add-btn");

    // The wrapper div's children should have _scrml_key set
    // Items have .id property, so keys should be the item ids (1, 2)
    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(2);
    expect(items[0]._scrml_key).toBe(1);
    expect(items[1]._scrml_key).toBe(2);
  });
});
