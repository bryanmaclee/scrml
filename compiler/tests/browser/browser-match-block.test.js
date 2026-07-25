/**
 * Browser tests for match block-form (Tier 1, SPEC §18.0.1) — runtime
 * arm-swap on reactive change.
 *
 * Covers:
 *   match-002-block-form-arm-swap — `<match for=Phase on=@phase>` with
 *     Idle / Loading / Ready named arms + a `<_>` wildcard. The dispatcher
 *     subscribes to @phase; each variant write swaps the matching arm body
 *     into the `<div data-scrml-match-mount>` slot.
 *
 * This is the END-TO-END runtime verification for match block-form. S109
 * `2691b20` fixed the integration gap that meant the dispatcher was never
 * emitted in a real compile — these tests exercise the emitted dispatcher
 * in a happy-dom browser environment.
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
// match-002-block-form-arm-swap
// ---------------------------------------------------------------------------

describe("Match block-form (match-002): runtime arm-swap", () => {
  test("sample loads without errors", () => {
    expect(() => loadSample("match-002-block-form-arm-swap")).not.toThrow();
  });

  test("initial render — @phase = .Idle shows the Idle arm body", () => {
    loadSample("match-002-block-form-arm-swap");
    // The match-block mount is empty in static HTML; the dispatcher fires at
    // DOMContentLoaded with the current cell value (.Idle) and fills it.
    const idle = document.querySelector('[data-arm="idle"]');
    expect(idle).not.toBeNull();
    expect(idle.textContent).toContain("Press to load");
    // No other arm body is present.
    expect(document.querySelector('[data-arm="loading"]')).toBeNull();
    expect(document.querySelector('[data-arm="ready"]')).toBeNull();
  });

  test("arm-swap — setting @phase = .Loading swaps to the Loading arm", () => {
    const app = loadSample("match-002-block-form-arm-swap");
    app.set("phase", "Loading");
    expect(document.querySelector('[data-arm="loading"]')).not.toBeNull();
    expect(document.querySelector('[data-arm="loading"]').textContent)
      .toContain("Loading now");
    // The previous (Idle) arm is gone — only one arm in the DOM at a time.
    expect(document.querySelector('[data-arm="idle"]')).toBeNull();
  });

  test("arm-swap — setting @phase = .Ready swaps to the Ready arm", () => {
    const app = loadSample("match-002-block-form-arm-swap");
    app.set("phase", "Ready");
    expect(document.querySelector('[data-arm="ready"]')).not.toBeNull();
    expect(document.querySelector('[data-arm="ready"]').textContent)
      .toContain("All set");
    expect(document.querySelector('[data-arm="idle"]')).toBeNull();
  });

  test("wildcard catch-all — @phase = .Failed (no named arm) renders the `<_>` body", () => {
    const app = loadSample("match-002-block-form-arm-swap");
    // `Failed` has no named arm — the dispatcher's `else` catch-all (the
    // wildcard `<_>` arm) renders. S109 Phase 5 wildcard explicit render.
    app.set("phase", "Failed");
    const fallback = document.querySelector('[data-arm="fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback.textContent).toContain("Something else");
    expect(document.querySelector('[data-arm="ready"]')).toBeNull();
  });

  test("round-trip — Idle → Loading → Ready → Failed → Idle each render their arm", () => {
    const app = loadSample("match-002-block-form-arm-swap");
    // Idle (initial)
    expect(document.querySelector('[data-arm="idle"]')).not.toBeNull();
    // → Loading
    app.set("phase", "Loading");
    expect(document.querySelector('[data-arm="loading"]')).not.toBeNull();
    // → Ready
    app.set("phase", "Ready");
    expect(document.querySelector('[data-arm="ready"]')).not.toBeNull();
    // → Failed (wildcard)
    app.set("phase", "Failed");
    expect(document.querySelector('[data-arm="fallback"]')).not.toBeNull();
    // → back to Idle
    app.set("phase", "Idle");
    expect(document.querySelector('[data-arm="idle"]')).not.toBeNull();
    expect(document.querySelector('[data-arm="fallback"]')).toBeNull();
  });
});
