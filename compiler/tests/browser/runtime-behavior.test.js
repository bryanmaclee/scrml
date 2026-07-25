/**
 * Browser runtime behavior tests — verifies compiled scrml output works in a DOM.
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 * Tests load pre-compiled output from samples/compilation-tests/dist/ and
 * verify reactive behavior works end-to-end.
 *
 * §1  Counter: reactive state updates DOM text
 * §2  Counter: click events fire handlers via delegation
 * §3  Conditional display: if=@var toggles visibility
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// Register happy-dom as global DOM
if (!globalThis.document) GlobalRegistrator.register();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIST = resolve(import.meta.dir, "../../../samples/compilation-tests/dist");

/**
 * Load a compiled sample into the global DOM and execute it.
 * Returns cleanup function + access to reactive API.
 */
function loadSample(baseName) {
  const htmlFile = resolve(DIST, `${baseName}.html`);
  const jsFile = resolve(DIST, `${baseName}.client.js`);

  const htmlContent = readFileSync(htmlFile, "utf-8");
  const clientJs = readFileSync(jsFile, "utf-8");

  // Extract body content from HTML
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
  // Remove script tags
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  // Set body
  document.body.innerHTML = cleanHtml;

  // Execute runtime + client JS in global scope (IIFE for shared scope)
  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `window._scrml_reactive_subscribe = _scrml_reactive_subscribe;\n`) + `\n})();`;
  eval(code);

  // Fire DOMContentLoaded
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (name) => window._scrml_reactive_get(name),
    set: (name, val) => window._scrml_reactive_set(name, val),
  };
}

// ---------------------------------------------------------------------------
// §1: Counter — reactive state + DOM text
// ---------------------------------------------------------------------------

describe("§1: Counter — reactive state updates DOM", () => {
  test("initial @count = 0 is set in reactive state", () => {
    const api = loadSample("combined-001-counter");
    expect(api.get("count")).toBe(0);
  });

  test("setting @count updates the display span", () => {
    const api = loadSample("combined-001-counter");

    // Find the span that shows count — it's wired via data-scrml-logic
    const logicSpans = document.querySelectorAll("[data-scrml-logic]");
    expect(logicSpans.length).toBeGreaterThan(0);

    // Set count to 42
    api.set("count", 42);

    // At least one logic span should now show "42"
    let found = false;
    for (const span of logicSpans) {
      if (span.textContent === "42") found = true;
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2: Counter — click events fire handlers
// ---------------------------------------------------------------------------

describe("§2: Click events fire handlers", () => {
  test("clicking + button increments count", () => {
    const api = loadSample("combined-001-counter");
    expect(api.get("count")).toBe(0);

    // Find the + button (last onclick button in counter)
    const buttons = document.querySelectorAll("[data-scrml-bind-onclick]");
    expect(buttons.length).toBeGreaterThan(0);

    // The + button is the last one (based on combined-001-counter.html: -, Reset, +)
    const plusBtn = buttons[buttons.length - 1];

    // Click it
    plusBtn.dispatchEvent(new Event("click", { bubbles: true }));

    expect(api.get("count")).toBe(1);
  });

  test("clicking - button decrements count", () => {
    const api = loadSample("combined-001-counter");
    expect(api.get("count")).toBe(0);

    const buttons = document.querySelectorAll("[data-scrml-bind-onclick]");
    // First button is -
    const minusBtn = buttons[0];
    minusBtn.dispatchEvent(new Event("click", { bubbles: true }));

    expect(api.get("count")).toBe(-1);
  });

  test("clicking Reset sets count to 0", () => {
    const api = loadSample("combined-001-counter");
    api.set("count", 99);

    const buttons = document.querySelectorAll("[data-scrml-bind-onclick]");
    // Middle button is Reset
    const resetBtn = buttons[1];
    resetBtn.dispatchEvent(new Event("click", { bubbles: true }));

    expect(api.get("count")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3: Reactive subscriptions update DOM
// ---------------------------------------------------------------------------

describe("§3: Reactive subscriptions update DOM", () => {
  test("multiple set() calls update DOM each time", () => {
    const api = loadSample("combined-001-counter");

    const logicSpans = document.querySelectorAll("[data-scrml-logic]");

    api.set("count", 10);
    api.set("count", 20);
    api.set("count", 30);

    let found = false;
    for (const span of logicSpans) {
      if (span.textContent === "30") found = true;
    }
    expect(found).toBe(true);
  });
});
