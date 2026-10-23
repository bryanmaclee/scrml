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

import { describe, test, expect, afterAll } from "bun:test";
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
// Helpers: the four transition-bearing if= elements, by their (unique) text.
//
// S469 PORT. This file was written against the DISPLAY-TOGGLE lowering of `if=` (`data-scrml-bind-if`
// + `style.display = "none"`). `if-mount-unmount-phase2` (S239) moved a transition-bearing `if=` onto
// the MOUNT path — §17.1 "It does not exist in the DOM": false REMOVES the element (deferred until
// `animationend` when an exit transition is declared), true mounts a FRESH clone from its
// `<template>`. Against that emit `[data-scrml-bind-if]` matched nothing, so every case below failed
// (and the two "initially" cases passed VACUOUSLY over an empty list). Each case is ported 1:1:
//   display:none          → the element is not connected (removed)
//   display not none      → the element is still connected
//   re-shown element      → the FRESH mounted node (re-queried; the old one stays detached)
// The enter/exit class assertions are unchanged. Mount-path-specific failure modes (strand, backstop
// timer) are covered by if-mount-exit-transition.browser.test.js.
// ---------------------------------------------------------------------------
const TEXTS = ["Fading content", "Slide-in only", "Fly-out only", "Mixed transitions"];

/** Every connected <p> carrying TEXTS[i] (a list, so a duplicate mount is visible). */
function mounted(i) {
  return [...document.querySelectorAll("p")].filter((p) => p.textContent === TEXTS[i]);
}

/** The single mounted element i, or undefined. */
function ifEl(i) {
  const els = mounted(i);
  expect(els.length).toBeLessThanOrEqual(1);
  return els[0];
}

// ---------------------------------------------------------------------------
// transition-001-basic
// ---------------------------------------------------------------------------

describe("Transition directives (transition-001-basic)", () => {
  test("sample loads without errors", () => {
    const api = loadSample("transition-001-basic");
    expect(api.get("visible")).toBe(true);
  });

  test("all four if= elements are mounted in the DOM", () => {
    loadSample("transition-001-basic");
    for (let i = 0; i < TEXTS.length; i++) expect(mounted(i).length).toBe(1);
  });

  test("all elements are initially visible (mounted, display not none)", () => {
    loadSample("transition-001-basic");
    for (let i = 0; i < TEXTS.length; i++) {
      const el = ifEl(i);
      expect(el).toBeDefined();
      expect(el.isConnected).toBe(true);
      expect(el.style.display).not.toBe("none");
    }
  });

  // --- transition:fade (element 0) ---

  describe("transition:fade (element 0)", () => {
    test("gets scrml-exit-fade class when if= becomes false", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(0);
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fade")).toBe(true);
    });

    test("is NOT removed immediately during the exit animation", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(0);
      api.set("visible", false);
      // Before animationend fires, the outgoing element is still in the DOM.
      expect(el.isConnected).toBe(true);
    });

    test("is removed after animationend fires on exit", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(0);
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.isConnected).toBe(false);
      expect(mounted(0).length).toBe(0);
    });

    test("the re-mounted element gets scrml-enter-fade when if= becomes true again", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(0);
      // First hide
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.isConnected).toBe(false);
      // Then show
      api.set("visible", true);
      const fresh = ifEl(0);
      expect(fresh).toBeDefined();
      expect(fresh.isConnected).toBe(true);
      expect(fresh.classList.contains("scrml-enter-fade")).toBe(true);
      expect(fresh.style.display).toBe("");
    });

    test("enter class is removed after animationend", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(0);
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      const fresh = ifEl(0);
      // Precondition — the class must be ON before animationend, or "removed" is vacuous.
      expect(fresh).toBeDefined();
      expect(fresh.classList.contains("scrml-enter-fade")).toBe(true);
      fresh.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(fresh.classList.contains("scrml-enter-fade")).toBe(false);
      expect(fresh.isConnected).toBe(true);
    });
  });

  // --- in:slide (element 1) ---

  describe("in:slide (element 1)", () => {
    test("the re-mounted element gets scrml-enter-slide class when if= becomes true", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(1);
      api.set("visible", false);
      // No exit animation for in-only
      expect(el.isConnected).toBe(false);
      api.set("visible", true);
      const fresh = ifEl(1);
      expect(fresh).toBeDefined();
      expect(fresh.classList.contains("scrml-enter-slide")).toBe(true);
    });

    test("is removed immediately on exit (no exit transition)", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(1);
      api.set("visible", false);
      expect(el.isConnected).toBe(false);
      expect(mounted(1).length).toBe(0);
      // No exit class
      expect(el.classList.contains("scrml-exit-slide")).toBe(false);
    });
  });

  // --- out:fly (element 2) ---

  describe("out:fly (element 2)", () => {
    test("gets scrml-exit-fly class when if= becomes false", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(2);
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fly")).toBe(true);
    });

    test("shows immediately on enter (no enter transition)", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(2);
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      const fresh = ifEl(2);
      expect(fresh).toBeDefined();
      expect(fresh.isConnected).toBe(true);
      expect(fresh.style.display).toBe("");
      // No enter class
      expect(fresh.classList.contains("scrml-enter-fly")).toBe(false);
    });

    test("exit delays removal until animationend", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(2);
      api.set("visible", false);
      expect(el.isConnected).toBe(true);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(el.isConnected).toBe(false);
    });
  });

  // --- in:fade out:slide (element 3) ---

  describe("mixed in:fade out:slide (element 3)", () => {
    test("gets scrml-exit-slide class on exit", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(3);
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-slide")).toBe(true);
    });

    test("the re-mounted element gets scrml-enter-fade class on enter", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(3);
      api.set("visible", false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      api.set("visible", true);
      const fresh = ifEl(3);
      expect(fresh).toBeDefined();
      expect(fresh.classList.contains("scrml-enter-fade")).toBe(true);
    });

    test("does NOT get scrml-enter-slide or scrml-exit-fade", () => {
      const api = loadSample("transition-001-basic");
      const el = ifEl(3);
      // On exit, should only get slide, not fade
      api.set("visible", false);
      expect(el.classList.contains("scrml-exit-fade")).toBe(false);
      el.dispatchEvent(new Event("animationend", { bubbles: true }));
      // On enter, should only get fade, not slide
      api.set("visible", true);
      const fresh = ifEl(3);
      expect(fresh).toBeDefined();
      expect(fresh.classList.contains("scrml-enter-slide")).toBe(false);
    });
  });
});

// DOM-global hygiene: happy-dom's GlobalRegistrator (registered above, or by the conformance adapter's
// run()) replaces Bun's native Response/Request/Headers/fetch/URL/setTimeout/... on globalThis.
// Unregister at file end so every later file in the same `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
