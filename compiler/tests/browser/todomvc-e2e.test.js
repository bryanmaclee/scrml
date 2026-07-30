/**
 * TodoMVC end-to-end browser test — verifies the compiled TodoMVC app works.
 *
 * Uses happy-dom to simulate a browser. Loads the compiled HTML, CSS, and JS
 * from benchmarks/todomvc/dist/ and verifies core TodoMVC operations:
 *   1. Page renders with correct structure
 *   2. CSS loads and styles are applied
 *   3. Runtime initializes without errors
 *   4. JS is syntactically valid
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

const TODOMVC_DIR = resolve(import.meta.dir, "../../../benchmarks/todomvc");
const DIST_DIR = resolve(TODOMVC_DIR, "dist");
const SCRML_FILE = resolve(TODOMVC_DIR, "app.scrml");

describe("TodoMVC E2E Browser Test", () => {
  let html, css, clientJs, runtimeJs, runtimeFilename;

  beforeAll(() => {
    // Compile fresh
    const result = compileScrml({
      inputFiles: [SCRML_FILE],
      outputDir: DIST_DIR,
      write: true,
    });
    expect(result.errors.length).toBe(0);

    // v0.3.x SPA tree-shake Phase B 3.3 — shared runtime is now hashed
    // (e.g. scrml-runtime.<hash>.js); read the filename from the
    // compileScrml result rather than hard-coding the legacy literal.
    runtimeFilename = result.runtimeFilename ?? "scrml-runtime.js";

    html = readFileSync(resolve(DIST_DIR, "app.html"), "utf8");
    css = readFileSync(resolve(DIST_DIR, "app.css"), "utf8");
    clientJs = readFileSync(resolve(DIST_DIR, "app.client.js"), "utf8");
    runtimeJs = readFileSync(resolve(DIST_DIR, runtimeFilename), "utf8");
  });

  // §1 Compilation produces all expected files
  test("compilation produces HTML, CSS, client JS, and runtime JS", () => {
    expect(existsSync(resolve(DIST_DIR, "app.html"))).toBe(true);
    expect(existsSync(resolve(DIST_DIR, "app.css"))).toBe(true);
    expect(existsSync(resolve(DIST_DIR, "app.client.js"))).toBe(true);
    expect(existsSync(resolve(DIST_DIR, runtimeFilename))).toBe(true);
  });

  // §2 HTML has correct TodoMVC structure
  test("HTML contains todoapp structure", () => {
    expect(html).toContain('class="todoapp"');
    expect(html).toContain('class="header"');
    expect(html).toContain("<h1>todos</h1>");
    expect(html).toContain('class="new-todo"');
    expect(html).toContain('class="todo-list"');
    expect(html).toContain('class="footer"');
    expect(html).toContain('class="filters"');
  });

  // §3 HTML links CSS and JS correctly
  test("HTML links stylesheet and scripts", () => {
    expect(html).toContain('href="app.css"');
    expect(html).toContain(`src="${runtimeFilename}"`);
    expect(html).toContain('src="app.client.js"');
  });

  // §4 CSS is valid and contains expected rules
  test("CSS contains TodoMVC styles", () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain(".todoapp");
    expect(css).toContain(".new-todo");
    expect(css).toContain(".todo-list");
    expect(css).toContain(".todo-item");
    expect(css).toContain(".filters");
    expect(css).toContain("body {");
  });

  // §5 CSS has no brace-stripping artifacts
  test("CSS has no brace-stripping artifacts", () => {
    // The old bug produced "body: ;" instead of "body { ... }"
    expect(css).not.toContain("body: ;");
    expect(css).not.toContain("body:;");
    expect(css).toMatch(/body\s*\{/);
  });

  // §6 Runtime JS is syntactically valid
  test("runtime JS parses without syntax errors", () => {
    expect(() => new Function(runtimeJs)).not.toThrow();
  });

  // §7 Client JS is syntactically valid
  test("client JS parses without syntax errors", () => {
    // Client JS references runtime globals — wrap in a function to avoid ReferenceError
    expect(() => new Function(clientJs)).not.toThrow();
  });

  // §8 Runtime initializes reactive state
  test("runtime creates reactive state infrastructure", () => {
    const fn = new Function(runtimeJs + "\nreturn { _scrml_state, _scrml_subscribers };");
    const { _scrml_state, _scrml_subscribers } = fn();
    expect(_scrml_state).toBeDefined();
    expect(typeof _scrml_state).toBe("object");
    expect(_scrml_subscribers).toBeDefined();
  });

  // §9 DOM loads and renders
  test("HTML renders in happy-dom with correct elements", () => {
    document.body.innerHTML = "";
    // Extract just the body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    // Remove script tags but keep all HTML structure
    document.body.innerHTML = bodyContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

    const app = document.querySelector(".todoapp");
    expect(app).not.toBeNull();

    const header = document.querySelector(".header");
    expect(header).not.toBeNull();

    const h1 = document.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1.textContent).toBe("todos");

    const input = document.querySelector(".new-todo");
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("What needs to be done?");
  });

  // §10 Filters section — §17.1 Phase 2 (S301). The filters live inside
  // `<footer class="footer" if=@todos.length>`, and this suite loads the page with
  // zero todos, so per §17.1 the footer (and everything in it) is NOT in the DOM.
  // The markup is still SHIPPED — as `<template>` content, asserted in §2 against
  // the HTML text — so the structural claim is unchanged; only its DOM presence
  // is now conditional, which is what `if=` means.
  test("filters section is absent from the DOM while the list is empty (§17.1)", () => {
    expect(document.querySelectorAll(".filters").length).toBe(0);
    // …and its markup is present in the shipped HTML, inside the if= template.
    expect(html).toContain('class="filters"');
    expect(html).toContain('href="#/active"');
    expect(html).toContain('href="#/completed"');
    expect(html).not.toContain("data-scrml-bind-if");
  });
});
