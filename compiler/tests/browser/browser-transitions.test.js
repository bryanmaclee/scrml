/**
 * Browser tests for transition directives on if= elements.
 *
 * Covers:
 *   transition:fade — enter and exit animation classes
 *   in:slide — enter-only animation class
 *   out:fly — exit-only animation class
 *   in:fade out:slide — mixed enter/exit transitions
 *   Exit delays display:none until animationend fires
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const DIST = resolve(import.meta.dir, "../../../samples/compilation-tests/dist");

function loadSample(baseName) {
  const htmlFile = resolve(DIST, `${baseName}.html`);
  const jsFile = resolve(DIST, `${baseName}.client.js`);

  const htmlContent = readFileSync(htmlFile, "utf-8");
  const clientJs = readFileSync(jsFile, "utf-8");

  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  document.body.innerHTML = cleanHtml;

  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `window._scrml_reactive_subscribe = _scrml_reactive_subscribe;\n`) + `\n})();`;
  eval(code);

  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (name) => window._scrml_reactive_get(name),
    set: (name, val) => window._scrml_reactive_set(name, val),
  };
}

// ---------------------------------------------------------------------------
// Helper: find the nth element with data-scrml-bind-if
// ---------------------------------------------------------------------------
function getIfElements() {
  return [...document.querySelectorAll("[data-scrml-bind-if]")];
}

// ---------------------------------------------------------------------------
// transition-001-basic
// ---------------------------------------------------------------------------

describe("Transition directives (transition-001-basic)", () => {
  test("sample loads without errors", () => {
    const api = loadSample("transition-001-basic");
    expect(api.get("visible")).toBe(true);
  });

  test("all four if= elements are present in DOM", () => {
    loadSample("transition-001-basic");
    const els = getIfElements();
    expect(els.length).toBe(4);
  });

  test("all elements are initially visible (display not none)", () => {
    loadSample("transition-001-basic");
    const els = getIfElements();
    for (const el of els) {
      expect(el.style.display).not.toBe("none");
    }
  });

  // --- transition:fade (element 0) ---

  describe("transition:fade (element 0)", () => {
    test("gets scrml-exit-fade class when if= becomes false", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[0];
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fade")).toBe(true);
    });

    test("display is NOT immediately none during exit animation", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[0];
      api.set("visible", false);
      // Before animationend fires, display should not be none yet
      expect(el.style.display).not.toBe("none");
    });

    test("display becomes none after animationend fires on exit", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[0];
      api.set("visible", false);
      // Simulate animationend
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.style.display).toBe("none");
      expect(el.classList.contains("scrml-exit-fade")).toBe(false);
    });

    test("gets scrml-enter-fade class when if= becomes true again", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[0];
      // First hide
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.style.display).toBe("none");
      // Then show
      api.set("visible", true);
      expect(el.classList.contains("scrml-enter-fade")).toBe(true);
      expect(el.style.display).toBe("");
    });

    test("enter class is removed after animationend", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[0];
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.classList.contains("scrml-enter-fade")).toBe(false);
    });
  });

  // --- in:slide (element 1) ---

  describe("in:slide (element 1)", () => {
    test("gets scrml-enter-slide class when if= becomes true", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[1];
      api.set("visible", false);
      // No exit animation for in-only
      expect(el.style.display).toBe("none");
      api.set("visible", true);
      expect(el.classList.contains("scrml-enter-slide")).toBe(true);
    });

    test("hides immediately on exit (no exit transition)", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[1];
      api.set("visible", false);
      expect(el.style.display).toBe("none");
      // No exit class
      expect(el.classList.contains("scrml-exit-slide")).toBe(false);
    });
  });

  // --- out:fly (element 2) ---

  describe("out:fly (element 2)", () => {
    test("gets scrml-exit-fly class when if= becomes false", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[2];
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fly")).toBe(true);
    });

    test("shows immediately on enter (no enter transition)", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[2];
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      expect(el.style.display).toBe("");
      // No enter class
      expect(el.classList.contains("scrml-enter-fly")).toBe(false);
    });

    test("exit delays display:none until animationend", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[2];
      api.set("visible", false);
      expect(el.style.display).not.toBe("none");
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.style.display).toBe("none");
    });
  });

  // --- in:fade out:slide (element 3) ---

  describe("mixed in:fade out:slide (element 3)", () => {
    test("gets scrml-exit-slide class on exit", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[3];
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-slide")).toBe(true);
    });

    test("gets scrml-enter-fade class on enter", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[3];
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      expect(el.classList.contains("scrml-enter-fade")).toBe(true);
    });

    test("does NOT get scrml-enter-slide or scrml-exit-fade", () => {
      const api = loadSample("transition-001-basic");
      const el = getIfElements()[3];
      // On exit, should only get slide, not fade
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fade")).toBe(false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      // On enter, should only get fade, not slide
      api.set("visible", true);
      expect(el.classList.contains("scrml-enter-slide")).toBe(false);
    });
  });
});
