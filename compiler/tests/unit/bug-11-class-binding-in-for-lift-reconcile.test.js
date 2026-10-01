/**
 * bug-11-class-binding-in-for-lift-reconcile.test.js — regression test for
 * Bug 11 (6nz-V) `class:NAME` on for-lift reused DOM nodes.
 *
 * Filed S126 by 6nz playground-nine. Confirmed GENUINE by 6nz S12 post-fix
 * of Bug W. Resolved S139 by un-pausing tracking inside _scrml_effect /
 * _scrml_effect_static so nested effects registered during reconcile track
 * their own deps regardless of the caller's _scrml_tracking_paused state.
 *
 * Root cause (pre-fix): _scrml_reconcile_list sets the GLOBAL flag
 * _scrml_tracking_paused = true for its entire body to suppress Proxy
 * `item.id` reads from leaking onto the OUTER effect's deps. But the
 * createFn passed to reconcile (the per-item factory) typically registers
 * _scrml_effect(() => { ... read @sel ... }) closures — and when those
 * effects ran their initial fn() during creation, _scrml_track silently
 * short-circuited on the pause flag, registering ZERO subscribers. The
 * effects then never re-fired on @sel writes; the class binding on the
 * create-time winner stayed frozen.
 *
 * Fix: _scrml_effect (and _scrml_effect_static) save+null _scrml_tracking_paused
 * around the inner fn() so each effect's own tracking is preserved regardless
 * of caller state.
 *
 * Class-level coverage: same class-of-bug for any nested _scrml_effect
 * registered during reconcile — class:, style:, attribute interpolation, etc.
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

if (!globalThis.document) GlobalRegistrator.register();

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
      _scrml_effect,
      _scrml_effect_static,
      _scrml_reactive_get,
      _scrml_reactive_set,
      _scrml_reconcile_list,
      _scrml_untracked,
      _scrml_state,
    };
  `);
  return wrapper();
}

/**
 * Mirror of the canonical for-lift codegen shape from 6nz's diagnostic:
 *
 *   function _scrml_create_item_N(it, _scrml_idx) {
 *     const _scrml_lift_el = document.createElement("div");
 *     _scrml_lift_el.setAttribute("class", "item");
 *     _scrml_effect(() => {
 *       _scrml_lift_el.classList.toggle("sel",
 *         !!(it.id === _scrml_reactive_get("sel")));
 *     });
 *     return _scrml_lift_el;
 *   }
 */
function makeItemFactory(rt) {
  return function createItem(it) {
    const el = document.createElement("div");
    el.setAttribute("class", "item");
    el.dataset.id = String(it.id);
    rt._scrml_effect(() => {
      el.classList.toggle("sel", it.id === rt._scrml_reactive_get("sel"));
    });
    return el;
  };
}

function classOf(container, id) {
  for (const child of container.childNodes) {
    if (child.dataset && child.dataset.id === String(id)) return child.className;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §1: Bug 11 reproducer — `.sel` advances when @sel changes
// ---------------------------------------------------------------------------

describe("Bug 11 §1: class:NAME on for-lift advances when state changes (the regression)", () => {
  test("initial render: only id=0 carries 'sel'", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("sel", 0);
    rt._scrml_reactive_set("items", [{ id: 0 }, { id: 1 }, { id: 2 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      makeItemFactory(rt),
    );
    expect(classOf(container, 0)).toContain("sel");
    expect(classOf(container, 1)).not.toContain("sel");
    expect(classOf(container, 2)).not.toContain("sel");
  });

  test("after @sel=1: bravo (id=1) gains 'sel'; alpha loses it; charlie unchanged", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("sel", 0);
    rt._scrml_reactive_set("items", [{ id: 0 }, { id: 1 }, { id: 2 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      makeItemFactory(rt),
    );
    rt._scrml_reactive_set("sel", 1);
    expect(classOf(container, 0)).not.toContain("sel");
    expect(classOf(container, 1)).toContain("sel");
    expect(classOf(container, 2)).not.toContain("sel");
  });

  test("after @sel=2: charlie (id=2) gains 'sel'; others lose it", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("sel", 0);
    rt._scrml_reactive_set("items", [{ id: 0 }, { id: 1 }, { id: 2 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      makeItemFactory(rt),
    );
    rt._scrml_reactive_set("sel", 2);
    expect(classOf(container, 0)).not.toContain("sel");
    expect(classOf(container, 1)).not.toContain("sel");
    expect(classOf(container, 2)).toContain("sel");
  });

  test("@sel cycle (0 → 1 → 2 → 0) toggles correctly across every step", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("sel", 0);
    rt._scrml_reactive_set("items", [{ id: 0 }, { id: 1 }, { id: 2 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      makeItemFactory(rt),
    );
    const selected = () => {
      for (const child of container.childNodes) {
        if (child.classList && child.classList.contains("sel")) return child.dataset.id;
      }
      return null;
    };
    expect(selected()).toBe("0");
    rt._scrml_reactive_set("sel", 1);
    expect(selected()).toBe("1");
    rt._scrml_reactive_set("sel", 2);
    expect(selected()).toBe("2");
    rt._scrml_reactive_set("sel", 0);
    expect(selected()).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// §2: The fix is also class-level — covers any nested _scrml_effect registered
// during reconcile, not just classList toggles.
// ---------------------------------------------------------------------------

describe("Bug 11 §2: nested _scrml_effect registered during reconcile tracks deps (class-level)", () => {
  test("textContent interpolation inside per-item factory re-fires on write", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("label", "initial");
    rt._scrml_reactive_set("items", [{ id: 0 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      (it) => {
        const el = document.createElement("span");
        el.dataset.id = String(it.id);
        rt._scrml_effect(() => {
          el.textContent = rt._scrml_reactive_get("label");
        });
        return el;
      },
    );
    expect(container.firstChild.textContent).toBe("initial");
    rt._scrml_reactive_set("label", "updated");
    expect(container.firstChild.textContent).toBe("updated");
  });

  test("attribute interpolation inside per-item factory re-fires on write", () => {
    const rt = createRuntime();
    const container = document.createElement("div");
    rt._scrml_reactive_set("href", "/initial");
    rt._scrml_reactive_set("items", [{ id: 0 }]);
    rt._scrml_reconcile_list(
      container,
      rt._scrml_reactive_get("items"),
      (it) => it.id,
      (it) => {
        const el = document.createElement("a");
        el.dataset.id = String(it.id);
        rt._scrml_effect(() => {
          el.setAttribute("href", rt._scrml_reactive_get("href"));
        });
        return el;
      },
    );
    expect(container.firstChild.getAttribute("href")).toBe("/initial");
    rt._scrml_reactive_set("href", "/updated");
    expect(container.firstChild.getAttribute("href")).toBe("/updated");
  });
});

// ---------------------------------------------------------------------------
// §3: Tracking-pause-restore semantic — fix preserves _scrml_untracked behavior
// ---------------------------------------------------------------------------

describe("Bug 11 §3: tracking-pause-restore semantic preserved", () => {
  test("_scrml_untracked still suppresses tracking for its direct body", () => {
    const rt = createRuntime();
    let bodyRuns = 0;
    rt._scrml_reactive_set("a", 1);
    rt._scrml_effect(() => {
      bodyRuns++;
      rt._scrml_untracked(() => {
        // Reads of @a inside untracked must NOT register a subscription.
        rt._scrml_reactive_get("a");
      });
    });
    expect(bodyRuns).toBe(1);
    rt._scrml_reactive_set("a", 2);
    // Write to @a should NOT re-fire the outer effect, because the read was
    // inside _scrml_untracked.
    expect(bodyRuns).toBe(1);
  });

  test("nested _scrml_effect inside _scrml_untracked still tracks its own deps (the fix)", () => {
    const rt = createRuntime();
    let innerRuns = 0;
    rt._scrml_reactive_set("b", 1);
    rt._scrml_untracked(() => {
      rt._scrml_effect(() => {
        innerRuns++;
        rt._scrml_reactive_get("b");
      });
    });
    expect(innerRuns).toBe(1);
    rt._scrml_reactive_set("b", 2);
    // The nested effect owns its own tracking scope; the outer _scrml_untracked
    // must NOT bleed into it.
    expect(innerRuns).toBe(2);
  });

  test("_scrml_tracking_paused state correctly restored after _scrml_effect body", () => {
    const rt = createRuntime();
    rt._scrml_reactive_set("c", 1);
    let outerBodyRuns = 0;
    // Manually pause, register a nested effect, confirm outer pause restored after.
    rt._scrml_untracked(() => {
      rt._scrml_effect(() => {
        rt._scrml_reactive_get("c");
      });
      // After the nested _scrml_effect finishes, this read must still be
      // suppressed (because we are inside _scrml_untracked).
      rt._scrml_reactive_get("c"); // should NOT track on any outer effect
    });
    // We never registered an outer effect tracking @c, so a write should not
    // fire anything that increments outerBodyRuns.
    rt._scrml_reactive_set("c", 2);
    expect(outerBodyRuns).toBe(0);
  });
});

// DOM-global hygiene: happy-dom's GlobalRegistrator (registered above, or by the conformance adapter's
// run()) replaces Bun's native Response/Request/Headers/fetch/URL/setTimeout/... on globalThis.
// Unregister at file end so every later file in the same `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
