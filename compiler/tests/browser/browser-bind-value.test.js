/**
 * Browser tests for bind:value — reactive-016-bind-value sample.
 *
 * Covers SPEC §5.4 two-way binding end-to-end:
 *   §1  Initial reactive variable values
 *   §2  bind:value on <input type="text"> — typing updates reactive state
 *   §3  bind:value on <input type="text"> — programmatic reactive set updates DOM
 *   §4  bind:value on <input type="text"> (second input) — independent binding
 *   §5  bind:value on <select> — change event updates reactive state
 *   §6  bind:value on <select> — programmatic reactive set updates DOM
 *   §7  bind:checked on <input type="checkbox"> — change event updates reactive state
 *   §8  bind:checked — programmatic reactive set updates DOM .checked
 *   §9  bind:group on <input type="radio"> — selecting a radio updates reactive state
 *   §10 bind:group — programmatic reactive set checks the matching radio
 *   §11 bind:value=@obj.field — path binding: typing updates nested object field
 *   §12 bind:value=@obj.field — path binding: programmatic set updates DOM
 *   §13 bind:value=@obj.field — path binding preserves sibling fields on write
 *
 * Uses happy-dom GlobalRegistrator to simulate a browser environment.
 * Loads pre-compiled output from samples/compilation-tests/dist/.
 *
 * Note: textarea bind:value is excluded because happy-dom 20.8.9 has a bug
 * where setting textarea.value = "" crashes with a PropertySymbol undefined
 * error. The sample file (reactive-016-bind-value.scrml) uses text inputs
 * instead to avoid this happy-dom limitation.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const DIST = resolve(import.meta.dir, "../../../samples/compilation-tests/dist");
const SAMPLE = "reactive-016-bind-value";

function loadSample() {
  const htmlFile = resolve(DIST, `${SAMPLE}.html`);
  const jsFile = resolve(DIST, `${SAMPLE}.client.js`);

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
// §1: Initial reactive variable values
// ---------------------------------------------------------------------------

describe("bind:value §1: initial reactive variable values", () => {
  test("@username starts as empty string", () => {
    const api = loadSample();
    expect(api.get("username")).toBe("");
  });

  test("@age starts as 0", () => {
    const api = loadSample();
    expect(api.get("age")).toBe(0);
  });

  test("@country starts as 'us'", () => {
    const api = loadSample();
    expect(api.get("country")).toBe("us");
  });

  test("@agreed starts as false", () => {
    const api = loadSample();
    expect(api.get("agreed")).toBe(false);
  });

  test("@size starts as 'medium'", () => {
    const api = loadSample();
    expect(api.get("size")).toBe("medium");
  });

  test("@profile starts with empty city field", () => {
    const api = loadSample();
    expect(api.get("profile")).toEqual({ city: "" });
  });
});

// ---------------------------------------------------------------------------
// §2: bind:value on <input type="text"> — typing updates reactive state
// ---------------------------------------------------------------------------

describe("bind:value §2: input event updates @username reactive state", () => {
  test("firing input event on username input updates @username", () => {
    const api = loadSample();

    const input = document.querySelector("#username-input");
    expect(input).not.toBeNull();

    input.value = "alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(api.get("username")).toBe("alice");
  });

  test("firing input event with different value replaces @username", () => {
    const api = loadSample();

    const input = document.querySelector("#username-input");
    input.value = "bob";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(api.get("username")).toBe("bob");
  });

  test("input event does NOT fire on unrelated element", () => {
    const api = loadSample();

    // Firing a change event (not input) should not update @username
    const input = document.querySelector("#username-input");
    input.value = "ghost";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("username")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §3: bind:value on <input type="text"> — programmatic reactive set updates DOM
// ---------------------------------------------------------------------------

describe("bind:value §3: reactive set updates DOM input value", () => {
  test("setting @username programmatically updates the DOM input value", () => {
    const api = loadSample();

    api.set("username", "charlie");

    const input = document.querySelector("#username-input");
    expect(input.value).toBe("charlie");
  });

  test("setting @username to empty string clears the DOM input", () => {
    const api = loadSample();

    api.set("username", "dave");
    api.set("username", "");

    const input = document.querySelector("#username-input");
    expect(input.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §4: bind:value on second input — independent binding, no cross-contamination
// ---------------------------------------------------------------------------

describe("bind:value §4: second input has independent binding", () => {
  test("age input and username input bind to separate reactive variables", () => {
    const api = loadSample();

    const usernameInput = document.querySelector("#username-input");
    const ageInput = document.querySelector("#age-input");

    usernameInput.value = "eve";
    usernameInput.dispatchEvent(new Event("input", { bubbles: true }));

    ageInput.value = "25";
    ageInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(api.get("username")).toBe("eve");
    expect(api.get("age")).toBe("25");
  });

  test("updating @age does not affect @username", () => {
    const api = loadSample();

    api.set("username", "frank");
    api.set("age", "30");

    expect(api.get("username")).toBe("frank");
    expect(api.get("age")).toBe("30");
  });
});

// ---------------------------------------------------------------------------
// §5: bind:value on <select> — change event updates reactive state
// ---------------------------------------------------------------------------

describe("bind:value §5: select change event updates @country reactive state", () => {
  test("firing change event on country select updates @country", () => {
    const api = loadSample();

    const select = document.querySelector("#country-select");
    expect(select).not.toBeNull();

    select.value = "ca";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("country")).toBe("ca");
  });

  test("select fires change event, not input event", () => {
    const api = loadSample();

    const select = document.querySelector("#country-select");
    select.value = "uk";

    // Input event should not trigger for select
    select.dispatchEvent(new Event("input", { bubbles: true }));
    expect(api.get("country")).toBe("us");

    // Change event should trigger
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(api.get("country")).toBe("uk");
  });
});

// ---------------------------------------------------------------------------
// §6: bind:value on <select> — programmatic reactive set updates DOM
// ---------------------------------------------------------------------------

describe("bind:value §6: reactive set updates DOM select value", () => {
  test("setting @country programmatically updates the select value", () => {
    const api = loadSample();

    api.set("country", "uk");

    const select = document.querySelector("#country-select");
    expect(select.value).toBe("uk");
  });

  test("setting @country to 'ca' selects the Canada option", () => {
    const api = loadSample();

    api.set("country", "ca");

    const select = document.querySelector("#country-select");
    expect(select.value).toBe("ca");
  });
});

// ---------------------------------------------------------------------------
// §7: bind:checked on <input type="checkbox"> — change event updates reactive state
// ---------------------------------------------------------------------------

describe("bind:checked §7: checkbox change event updates @agreed reactive state", () => {
  test("checking the checkbox updates @agreed to true", () => {
    const api = loadSample();

    const checkbox = document.querySelector("#agree-checkbox");
    expect(checkbox).not.toBeNull();

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("agreed")).toBe(true);
  });

  test("unchecking the checkbox updates @agreed to false", () => {
    const api = loadSample();

    const checkbox = document.querySelector("#agree-checkbox");

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("agreed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8: bind:checked — programmatic reactive set updates DOM .checked
// ---------------------------------------------------------------------------

describe("bind:checked §8: reactive set updates DOM checkbox .checked", () => {
  test("setting @agreed to true checks the checkbox", () => {
    const api = loadSample();

    api.set("agreed", true);

    const checkbox = document.querySelector("#agree-checkbox");
    expect(checkbox.checked).toBe(true);
  });

  test("setting @agreed to false unchecks the checkbox", () => {
    const api = loadSample();

    api.set("agreed", true);
    api.set("agreed", false);

    const checkbox = document.querySelector("#agree-checkbox");
    expect(checkbox.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9: bind:group on <input type="radio"> — selecting a radio updates reactive state
// ---------------------------------------------------------------------------

describe("bind:group §9: radio change event updates @size reactive state", () => {
  test("selecting the 'small' radio updates @size to 'small'", () => {
    const api = loadSample();

    const radios = document.querySelectorAll('[data-scrml-bind-group]');
    expect(radios.length).toBe(3);

    const smallRadio = Array.from(radios).find(r => r.value === "small");
    expect(smallRadio).not.toBeNull();

    smallRadio.checked = true;
    smallRadio.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("size")).toBe("small");
  });

  test("selecting the 'large' radio updates @size to 'large'", () => {
    const api = loadSample();

    const radios = document.querySelectorAll('[data-scrml-bind-group]');
    const largeRadio = Array.from(radios).find(r => r.value === "large");
    expect(largeRadio).not.toBeNull();

    largeRadio.checked = true;
    largeRadio.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.get("size")).toBe("large");
  });
});

// ---------------------------------------------------------------------------
// §10: bind:group — programmatic reactive set checks the matching radio
// ---------------------------------------------------------------------------

describe("bind:group §10: reactive set checks the matching radio button", () => {
  test("setting @size to 'small' marks the small radio as checked", () => {
    const api = loadSample();

    api.set("size", "small");

    const radios = document.querySelectorAll('[data-scrml-bind-group]');
    const smallRadio = Array.from(radios).find(r => r.value === "small");
    const mediumRadio = Array.from(radios).find(r => r.value === "medium");

    expect(smallRadio.checked).toBe(true);
    expect(mediumRadio.checked).toBe(false);
  });

  test("setting @size to 'large' marks the large radio as checked", () => {
    const api = loadSample();

    api.set("size", "large");

    const radios = document.querySelectorAll('[data-scrml-bind-group]');
    const largeRadio = Array.from(radios).find(r => r.value === "large");
    expect(largeRadio.checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §11: bind:value=@obj.field — path binding: typing updates nested object field
// ---------------------------------------------------------------------------

describe("bind:value §11: path binding @profile.city — input event", () => {
  test("firing input event on city input updates @profile.city", () => {
    const api = loadSample();

    const cityInput = document.querySelector("#city-input");
    expect(cityInput).not.toBeNull();

    cityInput.value = "Toronto";
    cityInput.dispatchEvent(new Event("input", { bubbles: true }));

    const profile = api.get("profile");
    expect(profile.city).toBe("Toronto");
  });

  test("multiple input events update @profile.city to the latest value", () => {
    const api = loadSample();

    const cityInput = document.querySelector("#city-input");

    cityInput.value = "Paris";
    cityInput.dispatchEvent(new Event("input", { bubbles: true }));

    cityInput.value = "Lyon";
    cityInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(api.get("profile").city).toBe("Lyon");
  });
});

// ---------------------------------------------------------------------------
// §12: bind:value=@obj.field — path binding: programmatic set updates DOM
// ---------------------------------------------------------------------------

describe("bind:value §12: path binding @profile.city — reactive set updates DOM", () => {
  test("setting @profile programmatically updates the city input value", () => {
    const api = loadSample();

    api.set("profile", { city: "London" });

    const cityInput = document.querySelector("#city-input");
    expect(cityInput.value).toBe("London");
  });
});

// ---------------------------------------------------------------------------
// §13: bind:value=@obj.field — path binding preserves other fields on write
// ---------------------------------------------------------------------------

describe("bind:value §13: path binding preserves sibling object fields", () => {
  test("typing in city input preserves other fields on @profile", () => {
    const api = loadSample();

    api.set("profile", { city: "Paris", country: "France" });

    const cityInput = document.querySelector("#city-input");
    cityInput.value = "Lyon";
    cityInput.dispatchEvent(new Event("input", { bubbles: true }));

    const profile = api.get("profile");
    expect(profile.city).toBe("Lyon");
    expect(profile.country).toBe("France");
  });
});
