/**
 * Bug 60 (S157) — nested compound-field render-by-tag RUNTIME drive (happy-dom).
 *
 * Emit-regression half lives in
 * compiler/tests/unit/render-by-tag-nested-compound-bug60.test.js.
 *
 * THIS file mounts the compiled reproducer in happy-dom and drives the bound
 * inputs end-to-end — the acceptance tier an emit-string test cannot reach: it
 * asserts the <input> elements actually appear in the DOM with the correct
 * type AND that bind:value round-trips (typing into the input writes the
 * qualified reactive cell `signupForm.userName` / `signupForm.email`, and a
 * programmatic write to the cell reflects back into the input).
 *
 * Pre-fix: the nested <userName/> / <email/> emitted as browser-ignored literal
 * tags, ZERO <input> appeared, and nothing bound to the runtime cells.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

// The Bug 60 reproducer — top-level compound decl + nested render-by-tag wrapper.
const SRC =
  `<signupForm>\n` +
  `    <userName req length(>=2)> = <input type="text"/>\n` +
  `    <email req email>          = <input type="email"/>\n` +
  `</>\n\n` +
  `<div>\n` +
  `  <signupForm>\n` +
  `    <userName/>\n` +
  `    <email/>\n` +
  `  </signupForm>\n` +
  `</div>\n`;

function mount() {
  const TMP = mkdtempSync(join(tmpdir(), "browser-bug60-"));
  const abs = join(TMP, "repro.scrml");
  writeFileSync(abs, SRC);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  // Only genuine errors are fatal; E-DG-002 (severity warning) lands in warnings.
  const realErrors = (result.errors || []).filter((e) => e && e.severity !== "warning");
  expect(realErrors).toEqual([]);

  const out = [...(result.outputs || new Map()).entries()][0]?.[1];
  const html = out?.html ?? "";
  const clientJs = out?.clientJs ?? "";
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });

  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window.__sg = _scrml_reactive_get;\n` +
    `window.__ss = _scrml_reactive_set;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (n) => window.__sg(n),
    set: (n, v) => window.__ss(n, v),
  };
}

describe("Bug 60 — nested compound render-by-tag drives at runtime (happy-dom)", () => {
  test("both nested inputs render in the DOM with the correct type", () => {
    mount();
    const inputs = document.querySelectorAll("input");
    expect(inputs.length).toBe(2);
    const types = [...inputs].map((i) => i.getAttribute("type")).sort();
    expect(types).toEqual(["email", "text"]);
    // No browser-ignored literal compound/field tags survive.
    expect(document.querySelector("signupForm")).toBeNull();
    expect(document.querySelector("userName")).toBeNull();
    expect(document.querySelector("email")).toBeNull();
    // Both inputs carry the render-by-tag hookpoint.
    expect(document.querySelectorAll("[data-scrml-render-by-tag]").length).toBe(2);
  });

  test("validators lowered to native HTML attributes on the rendered inputs", () => {
    mount();
    const textInput = document.querySelector('input[type="text"]');
    expect(textInput.hasAttribute("required")).toBe(true);
    expect(textInput.getAttribute("minlength")).toBe("2");
    const emailInput = document.querySelector('input[type="email"]');
    expect(emailInput.hasAttribute("required")).toBe(true);
  });

  test("bind:value round-trips — typing the text input writes signupForm.userName", () => {
    const api = mount();
    const textInput = document.querySelector('input[type="text"]');
    expect(textInput).not.toBeNull();
    textInput.value = "Alice";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(api.get("signupForm.userName")).toBe("Alice");
  });

  test("bind:value round-trips — typing the email input writes signupForm.email", () => {
    const api = mount();
    const emailInput = document.querySelector('input[type="email"]');
    emailInput.value = "alice@example.com";
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(api.get("signupForm.email")).toBe("alice@example.com");
  });

  test("reactive write reflects back into the bound input (effect loop)", () => {
    const api = mount();
    const textInput = document.querySelector('input[type="text"]');
    api.set("signupForm.userName", "Bob");
    // The render-by-tag _scrml_effect keeps the DOM element synced to the cell.
    expect(textInput.value).toBe("Bob");
  });
});
