/**
 * Browser tests for combined-002-todo — Todo list with reactive array state.
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 * Tests load pre-compiled output from samples/compilation-tests/dist/ and
 * verify reactive behavior works end-to-end.
 *
 * §1  Todo: initial state is empty
 * §2  Todo: adding items via reactive state
 * §3  Todo: form submit event fires addTodo handler
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { chunkCellKey } from "../helpers/chunk-scope.js";

// Register happy-dom as global DOM
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

  // BUG-6: the chunk's cells live under ITS namespace (`<token>$name`), so a
  // harness holding the GLOBAL accessor must key through the same token.
  // `chunkCellKey` reads the token from the emitted prologue banner (degrading to
  // the bare name for an unnamespaced chunk).
  const key = chunkCellKey(clientJs);

  return {
    get: (name) => window._scrml_reactive_get(key(name)),
    set: (name, val) => window._scrml_reactive_set(key(name), val),
  };
}

// ---------------------------------------------------------------------------
// §1: Todo — initial state
// ---------------------------------------------------------------------------

describe("Todo: initial reactive state", () => {
  test("@todos starts as an empty array", () => {
    const api = loadSample("combined-002-todo");
    expect(api.get("todos")).toEqual([]);
  });

  test("@inputText starts as empty string", () => {
    const api = loadSample("combined-002-todo");
    expect(api.get("inputText")).toBe("");
  });

  test("DOM contains form with text input and submit button", () => {
    loadSample("combined-002-todo");
    const form = document.querySelector("form[data-scrml-bind-onsubmit]");
    expect(form).not.toBeNull();
    const input = form.querySelector('input[type="text"]');
    expect(input).not.toBeNull();
    const button = form.querySelector('button[type="submit"]');
    expect(button).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2: Todo — reactive array updates
// ---------------------------------------------------------------------------

describe("Todo: reactive array state", () => {
  test("setting @todos updates the reactive store", () => {
    const api = loadSample("combined-002-todo");
    api.set("todos", [{ text: "Buy milk", done: false }]);
    expect(api.get("todos")).toEqual([{ text: "Buy milk", done: false }]);
  });

  test("appending to @todos preserves existing items", () => {
    const api = loadSample("combined-002-todo");
    api.set("todos", [{ text: "First", done: false }]);
    api.set("todos", [...api.get("todos"), { text: "Second", done: false }]);
    expect(api.get("todos")).toHaveLength(2);
    expect(api.get("todos")[0].text).toBe("First");
    expect(api.get("todos")[1].text).toBe("Second");
  });

  test("setting @inputText updates the reactive store", () => {
    const api = loadSample("combined-002-todo");
    api.set("inputText", "New task");
    expect(api.get("inputText")).toBe("New task");
  });
});

// ---------------------------------------------------------------------------
// §3: Todo — form submit event delegation
// ---------------------------------------------------------------------------

describe("Todo: form submit fires addTodo", () => {
  test("form submit with non-empty inputText adds a todo", () => {
    const api = loadSample("combined-002-todo");

    // Set inputText to simulate user typing
    api.set("inputText", "Write tests");

    // Submit the form via event delegation
    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    // The addTodo handler should have appended the item
    const todos = api.get("todos");
    expect(todos).toHaveLength(1);
    expect(todos[0].text).toBe("Write tests");
    expect(todos[0].done).toBe(false);
  });

  test("form submit clears @inputText after adding", () => {
    const api = loadSample("combined-002-todo");
    api.set("inputText", "Another task");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("inputText")).toBe("");
  });

  test("form submit with empty inputText does NOT add a todo", () => {
    const api = loadSample("combined-002-todo");
    // inputText is already "" by default

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("todos")).toEqual([]);
  });

  test("multiple form submits accumulate todos", () => {
    const api = loadSample("combined-002-todo");
    const form = document.querySelector("[data-scrml-bind-onsubmit]");

    api.set("inputText", "Task 1");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    api.set("inputText", "Task 2");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    api.set("inputText", "Task 3");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("todos")).toHaveLength(3);
    expect(api.get("todos")[2].text).toBe("Task 3");
  });
});
