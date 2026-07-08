/**
 * Browser tests for §5.5 dynamic class binding — reactive-018-class-binding sample.
 *
 * Covers SPEC §5.5 class binding end-to-end:
 *   §1  Initial reactive variable values
 *   §2  class:active=@isActive — initially absent when @isActive=false
 *   §3  Programmatic set @isActive=true → "active" class appears
 *   §4  Programmatic set @isActive=false → "active" class disappears
 *   §5  Static class "btn" persists on #base-button when @isActive toggles (coexistence)
 *   §6  class: + static class= coexistence — @isActive=true: both "btn" and "active" present
 *   §7  Multiple class: directives — @loading=false: "loading" absent initially
 *   §8  Set @loading=true → #status-box gains "loading" class
 *   §9  Set @hasError=true → #status-box gains "error" class, "loading" independent
 *   §10 Static class "status" on #status-box always present through toggles
 *   §11 Template literal — @theme="dark": #themed-card class contains "card-dark"
 *   §12 Set @theme="light" → #themed-card class updates to "card card-light"
 *   §13 Static "card" prefix preserved in template literal output
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 * Loads pre-compiled output from samples/compilation-tests/dist/.
 * Requires: bun run compiler/src/index.js samples/compilation-tests/reactive-018-class-binding.scrml --output samples/compilation-tests/dist/
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";

if (!globalThis.document) GlobalRegistrator.register();

const DIST = resolve(import.meta.dir, "../../../samples/compilation-tests/dist");
const SAMPLE = "reactive-018-class-binding";

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
  };
}

// ---------------------------------------------------------------------------
// §1: Initial reactive variable values
// ---------------------------------------------------------------------------

describe("class-binding §1: initial reactive variable values", () => {
  test("@isActive starts as false", () => {
    const api = loadSample();
    expect(api.get("isActive")).toBe(false);
  });

  test("@loading starts as false", () => {
    const api = loadSample();
    expect(api.get("loading")).toBe(false);
  });

  test("@hasError starts as false", () => {
    const api = loadSample();
    expect(api.get("hasError")).toBe(false);
  });

  test("@theme starts as 'dark'", () => {
    const api = loadSample();
    expect(api.get("themeMode")).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// §2: class:active — initial state (absent when false)
// ---------------------------------------------------------------------------

describe("class-binding §2: class:active absent when @isActive=false", () => {
  test("#toggle-target does not have 'active' class initially", () => {
    loadSample();
    const el = document.querySelector("#toggle-target");
    expect(el).not.toBeNull();
    expect(el.classList.contains("active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3: class:active — programmatic set true
// ---------------------------------------------------------------------------

describe("class-binding §3: set @isActive=true → 'active' class appears", () => {
  test("#toggle-target gains 'active' class when @isActive set to true", () => {
    const api = loadSample();
    api.set("isActive", true);
    const el = document.querySelector("#toggle-target");
    expect(el.classList.contains("active")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4: class:active — programmatic set false after true
// ---------------------------------------------------------------------------

describe("class-binding §4: set @isActive=false → 'active' class disappears", () => {
  test("#toggle-target loses 'active' class when @isActive set back to false", () => {
    const api = loadSample();
    api.set("isActive", true);
    api.set("isActive", false);
    const el = document.querySelector("#toggle-target");
    expect(el.classList.contains("active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5: Static class coexistence — static class persists through toggles
// ---------------------------------------------------------------------------

describe("class-binding §5: static class 'btn' persists through @isActive toggles", () => {
  test("#base-button always has 'btn' class when @isActive=false", () => {
    loadSample();
    const el = document.querySelector("#base-button");
    expect(el.classList.contains("btn")).toBe(true);
  });

  test("#base-button still has 'btn' class when @isActive=true", () => {
    const api = loadSample();
    api.set("isActive", true);
    const el = document.querySelector("#base-button");
    expect(el.classList.contains("btn")).toBe(true);
  });

  test("#base-button still has 'btn' class after toggling @isActive back to false", () => {
    const api = loadSample();
    api.set("isActive", true);
    api.set("isActive", false);
    const el = document.querySelector("#base-button");
    expect(el.classList.contains("btn")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6: class: + static class= coexistence — both classes present when active
// ---------------------------------------------------------------------------

describe("class-binding §6: class: + static class= coexistence", () => {
  test("#base-button has both 'btn' and 'active' when @isActive=true", () => {
    const api = loadSample();
    api.set("isActive", true);
    const el = document.querySelector("#base-button");
    expect(el.classList.contains("btn")).toBe(true);
    expect(el.classList.contains("active")).toBe(true);
  });

  test("#base-button has 'btn' but not 'active' when @isActive=false", () => {
    loadSample();
    const el = document.querySelector("#base-button");
    expect(el.classList.contains("btn")).toBe(true);
    expect(el.classList.contains("active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7: Multiple class: directives — initial absent state
// ---------------------------------------------------------------------------

describe("class-binding §7: multiple class: directives — initially absent", () => {
  test("#status-box does not have 'loading' class initially", () => {
    loadSample();
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("loading")).toBe(false);
  });

  test("#status-box does not have 'error' class initially", () => {
    loadSample();
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("error")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8: Multiple class: directives — @loading toggles independently
// ---------------------------------------------------------------------------

describe("class-binding §8: @loading=true → #status-box gains 'loading'", () => {
  test("#status-box gains 'loading' class when @loading set to true", () => {
    const api = loadSample();
    api.set("loading", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("loading")).toBe(true);
  });

  test("#status-box loses 'loading' class when @loading set back to false", () => {
    const api = loadSample();
    api.set("loading", true);
    api.set("loading", false);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("loading")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9: Multiple class: directives — @hasError toggles independently
// ---------------------------------------------------------------------------

describe("class-binding §9: @hasError=true → #status-box gains 'error', loading independent", () => {
  test("#status-box gains 'error' class when @hasError set to true", () => {
    const api = loadSample();
    api.set("hasError", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("error")).toBe(true);
  });

  test("'loading' class absent when only @hasError is true", () => {
    const api = loadSample();
    api.set("hasError", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("loading")).toBe(false);
  });

  test("both 'loading' and 'error' present when both set true", () => {
    const api = loadSample();
    api.set("loading", true);
    api.set("hasError", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("loading")).toBe(true);
    expect(el.classList.contains("error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10: Static class on multi-directive element persists
// ---------------------------------------------------------------------------

describe("class-binding §10: static class 'status' persists through directive toggles", () => {
  test("#status-box always has 'status' class initially", () => {
    loadSample();
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("status")).toBe(true);
  });

  test("#status-box still has 'status' when @loading=true", () => {
    const api = loadSample();
    api.set("loading", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("status")).toBe(true);
  });

  test("#status-box still has 'status' when both @loading and @hasError are true", () => {
    const api = loadSample();
    api.set("loading", true);
    api.set("hasError", true);
    const el = document.querySelector("#status-box");
    expect(el.classList.contains("status")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11: Template literal class — initial value
// ---------------------------------------------------------------------------

describe("class-binding §11: template literal class — @theme='dark' → card-dark", () => {
  test("#themed-card has class containing 'card-dark' when @theme='dark'", () => {
    loadSample();
    const el = document.querySelector("#themed-card");
    expect(el.className).toContain("card-dark");
  });
});

// ---------------------------------------------------------------------------
// §12: Template literal class — reactive update
// ---------------------------------------------------------------------------

describe("class-binding §12: set @theme='light' → class updates to card-light", () => {
  test("#themed-card class updates to 'card card-light' when @theme set to 'light'", () => {
    const api = loadSample();
    api.set("themeMode", "light");
    const el = document.querySelector("#themed-card");
    expect(el.className).toContain("card-light");
  });

  test("#themed-card class no longer contains 'card-dark' after @theme set to 'light'", () => {
    const api = loadSample();
    api.set("themeMode", "light");
    const el = document.querySelector("#themed-card");
    expect(el.className).not.toContain("card-dark");
  });
});

// ---------------------------------------------------------------------------
// §13: Template literal — static prefix always present
// ---------------------------------------------------------------------------

describe("class-binding §13: template literal static 'card' prefix always present", () => {
  test("#themed-card always has 'card' in class when @theme='dark'", () => {
    loadSample();
    const el = document.querySelector("#themed-card");
    expect(el.className).toContain("card");
  });

  test("#themed-card still has 'card' in class after @theme changes to 'light'", () => {
    const api = loadSample();
    api.set("themeMode", "light");
    const el = document.querySelector("#themed-card");
    expect(el.className).toContain("card");
  });

  test("#themed-card class is 'card card-dark' initially", () => {
    loadSample();
    const el = document.querySelector("#themed-card");
    expect(el.className).toBe("card card-dark");
  });

  test("#themed-card class is 'card card-light' after @theme set to 'light'", () => {
    const api = loadSample();
    api.set("themeMode", "light");
    const el = document.querySelector("#themed-card");
    expect(el.className).toBe("card card-light");
  });
});
