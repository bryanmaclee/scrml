/**
 * Browser tests for component composition.
 *
 * Covers:
 *   combined-021-component-basic — basic component with reactive props
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";

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
  };
}

// ---------------------------------------------------------------------------
// combined-021-component-basic
// ---------------------------------------------------------------------------

describe("Component Basic (combined-021): DOM structure", () => {
  test("sample loads without errors", () => {
    const api = loadSample("combined-021-component-basic");
    // Should execute without throwing
    expect(api).toBeDefined();
  });

  test("DOM contains a .card.featured div", () => {
    loadSample("combined-021-component-basic");
    const card = document.querySelector("div.card.featured");
    expect(card).not.toBeNull();
  });

  test("card contains an h2 element", () => {
    loadSample("combined-021-component-basic");
    const card = document.querySelector("div.card.featured");
    const h2 = card.querySelector("h2");
    expect(h2).not.toBeNull();
  });

  test("card contains a .badge.small span", () => {
    loadSample("combined-021-component-basic");
    const card = document.querySelector("div.card.featured");
    const badge = card.querySelector("span.badge.small");
    expect(badge).not.toBeNull();
  });

  test("logic spans are present for reactive bindings", () => {
    loadSample("combined-021-component-basic");
    const logicSpans = document.querySelectorAll("[data-scrml-logic]");
    // The compiled HTML has 4 logic spans: 136, 137, 138, 139
    expect(logicSpans.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Component Basic (combined-021): reactive props", () => {
  test("reactive state can be read via get()", () => {
    const api = loadSample("combined-021-component-basic");
    // The client.js calls _scrml_reactive_get("title") and _scrml_reactive_get("status")
    // These read from state — the values may be undefined since they are only read, not set
    // The point is the code runs without error
    expect(api.get).toBeDefined();
  });

  test("setting @title updates reactive state", () => {
    const api = loadSample("combined-021-component-basic");
    api.set("title", "Updated Title");
    expect(api.get("title")).toBe("Updated Title");
  });

  test("setting @status updates reactive state", () => {
    const api = loadSample("combined-021-component-basic");
    api.set("status", "inactive");
    expect(api.get("status")).toBe("inactive");
  });

  test("multiple reactive updates work in sequence", () => {
    const api = loadSample("combined-021-component-basic");
    api.set("title", "First");
    api.set("title", "Second");
    api.set("title", "Third");
    expect(api.get("title")).toBe("Third");
  });

  test("independent reactive variables do not interfere", () => {
    const api = loadSample("combined-021-component-basic");
    api.set("title", "My Title");
    api.set("status", "pending");
    expect(api.get("title")).toBe("My Title");
    expect(api.get("status")).toBe("pending");
  });
});

// DOM-global hygiene: happy-dom's GlobalRegistrator (registered above, or by the conformance adapter's
// run()) replaces Bun's native Response/Request/Headers/fetch/URL/setTimeout/... on globalThis.
// Unregister at file end so every later file in the same `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
