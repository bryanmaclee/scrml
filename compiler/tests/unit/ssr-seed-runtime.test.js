/**
 * §52.8 SSR pre-render — B-substrate runtime seed helpers (executed, not just
 * emit-string asserted). Closes the S140/S152 "behaviour fix without a runtime
 * test" blind-spot for the `ssr` runtime chunk.
 *
 * _scrml_ssr_seed_apply() reads window.__scrml_ssr_state (injected server-side by
 * the SSR HTML-composition route, before the client bundle runs) and seeds each
 * cell via the ordinary reactive set BEFORE mount, so a seeded cell is
 * construction-resolved. _scrml_ssr_seeded(name) is the per-cell guard the mount
 * fetch IIFEs check to skip the /__serverLoad RTT. Absent SSR (static host), both
 * are no-ops — the fetch path runs unchanged (graceful degradation).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

// Build the runtime in an isolated scope, exposing the seed helpers + the
// reactive seam they drive. happy-dom supplies `window`.
function createRuntime() {
  const wrapper = new Function(`
    const requestAnimationFrame = (fn) => 0;
    const cancelAnimationFrame = () => {};
    const navigator = { getGamepads: () => [] };
    const setInterval = globalThis.setInterval;
    const clearInterval = globalThis.clearInterval;
    const setTimeout = globalThis.setTimeout;
    const clearTimeout = globalThis.clearTimeout;

    ${SCRML_RUNTIME}

    return {
      _scrml_ssr_seed_apply,
      _scrml_ssr_seeded,
      _scrml_reactive_get,
      _scrml_reactive_set,
      _scrml_ssr_seed_from_document,
      _scrml_nav_extract_seed,
    };
  `);
  return wrapper();
}

beforeEach(() => {
  if (!globalThis.document) GlobalRegistrator.register();
  // each test owns its own window.__scrml_ssr_state
  delete globalThis.window.__scrml_ssr_state;
});

afterEach(() => {
  delete globalThis.window.__scrml_ssr_state;
});

describe("§52.8 ssr-b-substrate runtime: _scrml_ssr_seed_apply", () => {
  test("seeds each cell from window.__scrml_ssr_state via the reactive set", () => {
    const rt = createRuntime();
    globalThis.window.__scrml_ssr_state = {
      accounts: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      count: 42,
    };
    rt._scrml_ssr_seed_apply();
    expect(rt._scrml_reactive_get("count")).toBe(42);
    expect(rt._scrml_reactive_get("accounts")).toEqual([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
  });

  test("the seed OVERRIDES a prior placeholder (cell-init ran first, then seed-apply)", () => {
    const rt = createRuntime();
    // placeholder set at cell-init (Step 4b) before the seed is applied (Step 4c)
    rt._scrml_reactive_set("driver", null);
    globalThis.window.__scrml_ssr_state = { driver: { id: 7, current_status: "Driving" } };
    rt._scrml_ssr_seed_apply();
    expect(rt._scrml_reactive_get("driver")).toEqual({ id: 7, current_status: "Driving" });
  });

  test("is a no-op when no SSR state is present (graceful degrade — static host)", () => {
    const rt = createRuntime();
    rt._scrml_reactive_set("count", 5);
    // no window.__scrml_ssr_state
    rt._scrml_ssr_seed_apply();
    expect(rt._scrml_reactive_get("count")).toBe(5);
  });
});

describe("§52.8 ssr-b-substrate runtime: _scrml_ssr_seeded (fetch-skip guard)", () => {
  test("true for a seeded cell, false for an unseeded cell", () => {
    const rt = createRuntime();
    globalThis.window.__scrml_ssr_state = { accounts: [] };
    expect(rt._scrml_ssr_seeded("accounts")).toBe(true);
    expect(rt._scrml_ssr_seeded("driver")).toBe(false);
  });

  test("false for every cell when no SSR state is present (the fetch then runs)", () => {
    const rt = createRuntime();
    expect(rt._scrml_ssr_seeded("accounts")).toBe(false);
  });

  test("an own-property check — does not treat a falsy seeded value as absent", () => {
    const rt = createRuntime();
    // "" is a DEFINED scrml value (empty string ≠ absence); 0 / false likewise.
    globalThis.window.__scrml_ssr_state = { empty: "", zero: 0, flag: false };
    expect(rt._scrml_ssr_seeded("empty")).toBe(true);
    expect(rt._scrml_ssr_seeded("zero")).toBe(true);
    expect(rt._scrml_ssr_seeded("flag")).toBe(true);
    rt._scrml_ssr_seed_apply();
    expect(rt._scrml_reactive_get("empty")).toBe("");
    expect(rt._scrml_reactive_get("zero")).toBe(0);
    expect(rt._scrml_reactive_get("flag")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The seed is identified by its emitted WIRE FORM, not by its id.
//
// `id` is a document-wide namespace an author shares. Reading the seed with a
// bare `getElementById("__scrml_ssr_state")` meant a page that happens to carry
// its own `<div id="__scrml_ssr_state">` had that element's text content parsed
// as the server-authoritative seed and applied over the cell store. The soft-nav
// extractor read the same way — on a FETCHED document.
// ---------------------------------------------------------------------------

describe("§52.8 the seed reader matches the emitted wire form, not the id", () => {
  /** Put `html` in the live document's <head> and return the document. */
  function seedDoc(html) {
    document.head.innerHTML = html;
    return document;
  }

  const REAL = '<script type="application/json" id="__scrml_ssr_state">{"count":7}</script>';

  test("the real data block IS read", () => {
    const rt = createRuntime();
    expect(rt._scrml_ssr_seed_from_document(seedDoc(REAL))).toEqual({ count: 7 });
  });

  const impostors = [
    ['a <div> wearing the id', '<div id="__scrml_ssr_state">{"count":999}</div>'],
    ['a <template> wearing the id', '<template id="__scrml_ssr_state">{"count":999}</template>'],
    ['a <script> with no type=', '<script id="__scrml_ssr_state">{"count":999}</script>'],
    ['a <script type="module">', '<script type="module" id="__scrml_ssr_state">{"count":999}</script>'],
  ];

  for (const [label, html] of impostors) {
    test(`${label} is NOT read as the seed`, () => {
      const rt = createRuntime();
      expect(rt._scrml_ssr_seed_from_document(seedDoc(html))).toBeUndefined();
    });

    test(`${label} does not seed a SOFT NAV either`, () => {
      const rt = createRuntime();
      globalThis.window.__scrml_ssr_state = { count: 1 };
      const fetched = new DOMParser().parseFromString(
        `<!doctype html><html><head>${html}</head><body></body></html>`,
        "text/html",
      );
      rt._scrml_nav_extract_seed(fetched);
      // No seed in the target document → the live seed is CLEARED, never replaced
      // with the impostor's payload.
      expect(globalThis.window.__scrml_ssr_state).toBeNull();
    });
  }

  test("a soft nav to a document with the REAL block still replaces the seed", () => {
    const rt = createRuntime();
    globalThis.window.__scrml_ssr_state = { count: 1 };
    const fetched = new DOMParser().parseFromString(
      `<!doctype html><html><head>${REAL}</head><body></body></html>`,
      "text/html",
    );
    rt._scrml_nav_extract_seed(fetched);
    expect(globalThis.window.__scrml_ssr_state).toEqual({ count: 7 });
  });

  afterEach(() => { document.head.innerHTML = ""; });
});
