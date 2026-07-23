/**
 * Browser tests for form validation and form state samples.
 *
 * Covers:
 *   combined-003-form-validation — registration form with validation + conditional success
 *   reactive-014-form-state — form with reactive state variables
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
// combined-003-form-validation
// ---------------------------------------------------------------------------

describe("Form Validation: initial state", () => {
  test("@name starts as empty string", () => {
    const api = loadSample("combined-003-form-validation");
    expect(api.get("name")).toBe("");
  });

  test("@email starts as empty string", () => {
    const api = loadSample("combined-003-form-validation");
    expect(api.get("email")).toBe("");
  });

  test("@submitted starts as false", () => {
    const api = loadSample("combined-003-form-validation");
    expect(api.get("submitted")).toBe(false);
  });

  test("@errors starts as empty array", () => {
    const api = loadSample("combined-003-form-validation");
    expect(api.get("errors")).toEqual([]);
  });

  test("success div is unmounted initially (Phase 2c B1)", () => {
    // Phase 2c: clean-subtree if=@submitted compiles to <template>+marker. The
    // div is NOT in the DOM until @submitted flips truthy — querySelector(.success)
    // returns null on initial render. Pre-Phase-2c this asserted display:none on
    // a still-rendered div. Marker comment is present for the controller's anchor.
    loadSample("combined-003-form-validation");
    const successDiv = document.querySelector(".success");
    expect(successDiv).toBeNull();
    // The if-marker comment must be present (anchor for _scrml_mount_template).
    const html = document.body.innerHTML;
    expect(html).toContain("scrml-if-marker:");
  });
});

describe("Form Validation: submit with empty fields", () => {
  test("submit with empty name and email produces errors", () => {
    const api = loadSample("combined-003-form-validation");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    const errors = api.get("errors");
    expect(errors.length).toBe(2);
    expect(errors).toContain("Name is required");
    expect(errors).toContain("Email is required");
  });

  test("submit with empty fields does NOT set @submitted to true", () => {
    const api = loadSample("combined-003-form-validation");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("submitted")).toBe(false);
  });

  test("success div stays unmounted when validation fails (Phase 2c B1)", () => {
    // Phase 2c: failed validation leaves @submitted=false, so the success div
    // is never mounted — querySelector(.success) returns null. The chain
    // wrapper / display:none assertion no longer applies.
    loadSample("combined-003-form-validation");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    const successDiv = document.querySelector(".success");
    expect(successDiv).toBeNull();
  });
});

describe("Form Validation: submit with only name filled", () => {
  test("submit with name but no email produces email error only", () => {
    const api = loadSample("combined-003-form-validation");
    api.set("name", "Alice");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    const errors = api.get("errors");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe("Email is required");
    expect(api.get("submitted")).toBe(false);
  });
});

describe("Form Validation: successful submit", () => {
  test("submit with both name and email sets @submitted to true", () => {
    const api = loadSample("combined-003-form-validation");
    api.set("name", "Alice");
    api.set("email", "alice@example.com");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("submitted")).toBe(true);
    expect(api.get("errors")).toEqual([]);
  });

  test("success div mounts after valid submit (Phase 2c B1)", () => {
    // Phase 2c: a successful submit flips @submitted=true. The reactive
    // controller calls _scrml_mount_template, cloning the <template> content
    // and inserting it before the marker comment. querySelector(.success)
    // now returns the mounted div.
    const api = loadSample("combined-003-form-validation");
    api.set("name", "Bob");
    api.set("email", "bob@example.com");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    const successDiv = document.querySelector(".success");
    expect(successDiv).not.toBeNull();
    // The mounted div should contain the inner <p> from the template.
    const inner = successDiv.querySelector("p");
    expect(inner).not.toBeNull();
    expect(inner.textContent).toBe("Registration successful!");
  });

  test("errors are cleared on each submit attempt", () => {
    const api = loadSample("combined-003-form-validation");

    const form = document.querySelector("[data-scrml-bind-onsubmit]");

    // First submit: fails (empty fields)
    form.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(api.get("errors")).toHaveLength(2);

    // Fill in fields and resubmit
    api.set("name", "Carol");
    api.set("email", "carol@example.com");
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(api.get("errors")).toEqual([]);
    expect(api.get("submitted")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reactive-014-form-state
// ---------------------------------------------------------------------------

describe("Form State (reactive-014): initial reactive variables", () => {
  test("@formName starts as empty string", () => {
    const api = loadSample("reactive-014-form-state");
    expect(api.get("formName")).toBe("");
  });

  test("@formEmail starts as empty string", () => {
    const api = loadSample("reactive-014-form-state");
    expect(api.get("formEmail")).toBe("");
  });

  test("@isSubmitting starts as false", () => {
    const api = loadSample("reactive-014-form-state");
    expect(api.get("isSubmitting")).toBe(false);
  });

  test("@hasError starts as false", () => {
    const api = loadSample("reactive-014-form-state");
    expect(api.get("hasError")).toBe(false);
  });
});

describe("Form State (reactive-014): reactive updates", () => {
  test("setting @formName updates reactive state", () => {
    const api = loadSample("reactive-014-form-state");
    api.set("formName", "Alice");
    expect(api.get("formName")).toBe("Alice");
  });

  test("setting @formEmail updates reactive state", () => {
    const api = loadSample("reactive-014-form-state");
    api.set("formEmail", "alice@example.com");
    expect(api.get("formEmail")).toBe("alice@example.com");
  });

  test("setting @isSubmitting toggles state", () => {
    const api = loadSample("reactive-014-form-state");
    api.set("isSubmitting", true);
    expect(api.get("isSubmitting")).toBe(true);
    api.set("isSubmitting", false);
    expect(api.get("isSubmitting")).toBe(false);
  });

  test("setting @hasError toggles state", () => {
    const api = loadSample("reactive-014-form-state");
    api.set("hasError", true);
    expect(api.get("hasError")).toBe(true);
  });

  test("DOM contains form with name and email inputs", () => {
    loadSample("reactive-014-form-state");
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    const nameInput = form.querySelector('input[name="name"]');
    expect(nameInput).not.toBeNull();
    const emailInput = form.querySelector('input[name="email"]');
    expect(emailInput).not.toBeNull();
  });
});
