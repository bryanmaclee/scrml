/**
 * ss21 item-5 g-errors-anchor-not-reactively-clearing (MED) —
 * a `<errors of=@cell.field/>` anchor (SPEC §41.14 / §55.5 form-validity
 * surface) must REACTIVELY CLEAR its rendered DOM when the underlying field
 * becomes valid (so the derived `.errors` cell recomputes to []).
 *
 * THE BUG (deferred from ss20 item-2, documented in the NOTE block of
 * g-compound-bind-value-source-cell.browser.test.js): the errors emitter wired
 * its render via `_scrml_reactive_subscribe(<derivedErrorsKey>, render)`. But
 * the errors key (`loginForm.email.errors`) is a DERIVED cell — it is never the
 * target of a DIRECT `_scrml_reactive_set`. `_scrml_reactive_set` fans dirtied
 * DERIVED cells out only via `_scrml_trigger` (effects), NEVER the legacy
 * `_scrml_subscribers` list. So the subscribe callback never fired and the DOM
 * kept showing the stale error after the field went valid.
 *
 * THE FIX (Option B — errors emitter, emit-event-wiring.ts errors-element
 * region): drive the errors-anchor render from `_scrml_effect`, which
 * auto-tracks the `_scrml_derived_get` read (the derived name is tracked even
 * when the cell is clean, per the runtime's Bug 1 fix-D), so the render re-runs
 * when `_scrml_propagate_dirty` + `_scrml_trigger` wake it on recompute. This
 * matches how every other reactive-DOM update (render-element, the disabled
 * gate, reactive textContent) already works.
 *
 * This is a happy-dom (browser-tier) test because only the full
 * runtime + DOM chain detects a reactive-DOM update that never fires.
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

// Variant-C structural compound (§6.2 Shape 2 form-group): per-field source
// cells (`signupForm.email`, `signupForm.password`) feed a DERIVED parent that
// recomputes per-field `.errors`. Two independent fields each get their own
// `<errors of=...>` anchor so the adversarial "two fields independent" case is
// covered.
const SRC = `<program>
<page>
  <signupForm>
    <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
    <password req> = <input type="password"/>
  </>
  <form>
    <input id="email-input" type="email" bind:value=@signupForm.email/>
    <input id="password-input" type="password" bind:value=@signupForm.password/>
    <errors of=@signupForm.email/>
    <errors of=@signupForm.password/>
  </form>
</page>
</program>
`;

function mount(src) {
  const TMP = mkdtempSync(join(tmpdir(), "g-errors-anchor-"));
  const abs = join(TMP, "form.scrml");
  writeFileSync(abs, src);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const realErrors = (result.errors || []).filter((e) => e && e.severity !== "warning");
  expect(realErrors).toEqual([]);

  const out = [...(result.outputs || new Map()).entries()][0]?.[1];
  const html = out?.html ?? "";
  const clientJs = out?.clientJs ?? "";
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });

  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, `window.__sg = _scrml_reactive_get;\n` +
    `window.__ss = _scrml_reactive_set;\n` +
    `window.__dg = _scrml_derived_get;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (n) => window.__sg(n),
    set: (n, v) => window.__ss(n, v),
    dget: (n) => window.__dg(n),
  };
}

function typeInto(selector, value) {
  const el = document.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return el;
}

// The email anchor is the FIRST [data-scrml-errors-anchor], password the second.
function anchors() {
  return [...document.querySelectorAll("[data-scrml-errors-anchor]")];
}

describe("ss21 g-errors-anchor — <errors of=@cell.field> DOM reactively clears on derived recompute (happy-dom)", () => {
  test("typing a valid email CLEARS the rendered <errors> anchor DOM (was stale pre-fix)", () => {
    const api = mount(SRC);
    const [emailAnchor] = anchors();
    // Pre-type: required + empty → the anchor renders the Required error.
    expect(emailAnchor).not.toBeNull();
    expect(emailAnchor.innerHTML).not.toBe("");
    expect(api.dget("signupForm.email.errors")).toEqual([{ tag: "Required" }]);

    typeInto("#email-input", "alice@example.com");

    // Derived recomputed to empty AND the DOM reactively cleared (the fix).
    expect(api.dget("signupForm.email.errors")).toEqual([]);
    expect(emailAnchor.innerHTML).toBe("");
  });

  test("clearing also fires on a DIRECT source-cell set (not just via bind)", () => {
    const api = mount(SRC);
    const [emailAnchor] = anchors();
    expect(emailAnchor.innerHTML).not.toBe("");

    // Drive the derived recompute via a direct source-cell set — isolates the
    // reactive-clear from the bind machinery (the ss20 NOTE's repro path).
    api.set("signupForm.email", "bob@example.com");
    expect(api.dget("signupForm.email.errors")).toEqual([]);
    expect(emailAnchor.innerHTML).toBe("");
  });

  test("adversarial — re-invalidating RE-RENDERS the error after a clear", () => {
    const api = mount(SRC);
    const [emailAnchor] = anchors();

    typeInto("#email-input", "alice@example.com");
    expect(emailAnchor.innerHTML).toBe("");

    // Re-invalidate (empty again → Required) — the anchor must re-render.
    typeInto("#email-input", "");
    expect(api.dget("signupForm.email.errors")).toEqual([{ tag: "Required" }]);
    expect(emailAnchor.innerHTML).not.toBe("");

    // Pattern-invalid (no @) → PatternMismatch re-renders (different tag).
    typeInto("#email-input", "not-an-email");
    const errs = api.dget("signupForm.email.errors");
    expect(errs.length).toBe(1);
    expect(errs[0].tag).toBe("PatternMismatch");
    expect(emailAnchor.innerHTML).not.toBe("");
  });

  test("adversarial — two fields clear INDEPENDENTLY", () => {
    const api = mount(SRC);
    const [emailAnchor, passwordAnchor] = anchors();
    expect(emailAnchor.innerHTML).not.toBe("");
    expect(passwordAnchor.innerHTML).not.toBe("");

    // Make ONLY email valid — the password anchor must stay rendered.
    typeInto("#email-input", "alice@example.com");
    expect(emailAnchor.innerHTML).toBe("");
    expect(passwordAnchor.innerHTML).not.toBe("");

    // Now make password valid too — its anchor clears independently.
    typeInto("#password-input", "hunter2");
    expect(passwordAnchor.innerHTML).toBe("");
    expect(emailAnchor.innerHTML).toBe("");
  });
});
