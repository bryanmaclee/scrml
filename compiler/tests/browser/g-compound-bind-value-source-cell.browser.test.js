/**
 * ss20 g-compound-bind-value-not-two-way (HIGH) — a hand-authored
 * `bind:value=@form.field` on a Variant-C structural compound (form-group)
 * must read/write the field's BACKING LEAF SOURCE cell (`form.field`), NOT
 * `_scrml_deep_set` the DERIVED parent aggregate.
 *
 * The compound parent `loginForm` is emitted as a `_scrml_derived_declare`
 * proxy that RECOMPUTES `{ email, password }` from the per-field source cells
 * on every read. Pre-fix the bind wrote `_scrml_reactive_set("loginForm",
 * _scrml_deep_set(..., ["email"], v))` — a no-op on a derived cell, clobbered
 * by the next recompute. Symptom: typing into the input never sticks, the
 * `<errors of=@loginForm.email>` surface stays at .Required, and
 * `@loginForm.isValid` is wedged false forever (submit button never enables).
 *
 * This is the DOM-bind analog of Bug B's statement-write retarget
 * (stampCompoundDeepSetTargets, reactive-deps.ts) and the hand-authored analog
 * of the formFor `_flatBindKey` synth-bind path (Bug 58, S140). The fix in
 * emit-bindings.ts retargets the read/write to the flat source cell when the
 * bind's root is a compound parent.
 *
 * The emit-regression half lives in
 * compiler/tests/conformance/conf-form-for-validity-surface-bug-58.test.js's
 * sibling — here we drive the full chain end-to-end in happy-dom (the only
 * tier that detects a wiring-to-the-wrong-cell miscompile).
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

// Fresh document per test — the form's submit handler is a delegated
// `document.addEventListener("submit", ...)`; a stale listener from a prior
// test (closing over its own reactive state) would fire first and `return`.
beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

// Hand-authored Variant-C structural compound (the §6.2 Shape 2 form-group
// equivalent of `<formFor>`), with MANUAL `bind:value=@loginForm.field` inputs
// in the surrounding form (NOT formFor-synthesized binds → no `_flatBindKey`).
const COMPOUND_SRC = `<program>
<page>
  <loginForm>
    <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
    <password req> = <input type="password"/>
  </>
  <form>
    <input id="login-email" type="email" bind:value=@loginForm.email/>
    <input id="login-password" type="password" bind:value=@loginForm.password/>
    <errors of=@loginForm.email/>
    <button type="submit" disabled=!@loginForm.isValid>Sign in</button>
  </form>
</page>
</program>
`;

// Regression guard: a PLAIN nested-object cell (`<settings> = { theme }`) is a
// REAL reactive cell (not a derived parent), so `bind:value=@settings.theme`
// MUST keep round-tripping via `_scrml_deep_set` on the cell value.
const PLAIN_SRC = `<program>
<page>
  <settings> = { theme: "dark" }
  <input id="theme-input" bind:value=@settings.theme/>
</page>
</program>
`;

function mount(src) {
  const TMP = mkdtempSync(join(tmpdir(), "g-compound-bind-"));
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

describe("ss20 g-compound-bind — compound bind:value targets the source field cell (happy-dom)", () => {
  test("typing into the input PERSISTS — value sticks + @loginForm.email reflects it", () => {
    const api = mount(COMPOUND_SRC);
    const el = typeInto("#login-email", "alice@example.com");
    // (1) the input value persists (effect did not wipe it back to empty).
    expect(el.value).toBe("alice@example.com");
    // (2) reading @loginForm.email reflects the typed value (source cell written).
    expect(api.get("loginForm.email")).toBe("alice@example.com");
    // The derived parent re-derives from the source cell.
    expect(api.get("loginForm")).toMatchObject({ email: "alice@example.com" });
  });

  test("typing a valid email clears the per-field <errors of=@loginForm.email> validity surface", () => {
    const api = mount(COMPOUND_SRC);
    // The <errors> anchor IS wired (initial render shows the required error) —
    // proves the bind + validity surface are connected end-to-end.
    const anchor = document.querySelector('[data-scrml-errors-anchor]');
    expect(anchor).not.toBeNull();
    expect(anchor.innerHTML).not.toBe("");
    // Pre-type: required + empty → .Required error present.
    expect(api.dget("loginForm.email.errors")).toEqual([{ tag: "Required" }]);
    typeInto("#login-email", "alice@example.com");
    // The validity surface (derived per-field errors + isValid) clears once the
    // field is valid — the two-way-bind payoff: the typed value reached the
    // SOURCE cell, so `loginForm.email.errors` re-derived to empty.
    expect(api.dget("loginForm.email.errors")).toEqual([]);
    expect(api.dget("loginForm.email.isValid")).toBe(true);
    // NOTE (DEFERRED, out of scope): the rendered <errors> anchor DOM does NOT
    // reactively clear here. That is a SEPARATE pre-existing gap in the <errors>
    // emitter — it subscribes its render to the DERIVED `loginForm.email.errors`
    // cell via `_scrml_reactive_subscribe`, but `_scrml_reactive_set` only fires
    // `_scrml_trigger` (effects) for dirtied derived cells, never the legacy
    // `_scrml_subscribers` list (those fire only on a DIRECT set of that key,
    // which never happens for a derived). Verified independent of this bind fix
    // via a direct source-cell set (the derived cleared, the DOM stayed stale).
    // Fixing it touches the <errors> emitter / runtime, explicitly excluded by
    // this dispatch's scope boundary.
  });

  test("@loginForm.isValid flips TRUE once BOTH req/pattern fields are valid (button enables)", () => {
    const api = mount(COMPOUND_SRC);
    const submit = document.querySelector("[data-scrml-bind-bool-disabled]");
    expect(submit.hasAttribute("disabled")).toBe(true); // initially invalid
    expect(api.dget("loginForm.isValid")).toBe(false);

    typeInto("#login-email", "alice@example.com");
    // Still invalid: password req unmet.
    expect(api.dget("loginForm.isValid")).toBe(false);

    typeInto("#login-password", "hunter2");
    // Both fields valid → isValid true → disabled gate effect removes the attr.
    expect(api.dget("loginForm.isValid")).toBe(true);
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  test("adversarial — pattern-invalid then valid email round-trips the error surface", () => {
    const api = mount(COMPOUND_SRC);
    // Invalid (no @) → PatternMismatch, value still stored (so the user sees it).
    const el = typeInto("#login-email", "not-an-email");
    expect(el.value).toBe("not-an-email");
    expect(api.get("loginForm.email")).toBe("not-an-email");
    const errs = api.dget("loginForm.email.errors");
    expect(errs.length).toBe(1);
    expect(errs[0].tag).toBe("PatternMismatch");
    expect(api.dget("loginForm.email.isValid")).toBe(false);

    // Fix it → errors clear.
    typeInto("#login-email", "bob@example.com");
    expect(api.dget("loginForm.email.errors")).toEqual([]);
    expect(api.dget("loginForm.email.isValid")).toBe(true);
  });

  test("adversarial — programmatic reset of the source cell re-derives the input + validity", () => {
    const api = mount(COMPOUND_SRC);
    typeInto("#login-email", "alice@example.com");
    typeInto("#login-password", "hunter2");
    expect(api.dget("loginForm.isValid")).toBe(true);

    // Programmatic reset: clear the source cells directly.
    api.set("loginForm.email", "");
    api.set("loginForm.password", "");
    // The reactive effect pushes the cleared value back into the input.
    expect(document.querySelector("#login-email").value).toBe("");
    // Validity re-derives to false (req unmet on empty).
    expect(api.dget("loginForm.isValid")).toBe(false);
    expect(api.dget("loginForm.email.errors")).toEqual([{ tag: "Required" }]);
  });

  test("regression — plain nested-object bind:value=@settings.theme still round-trips via deep_set", () => {
    const api = mount(PLAIN_SRC);
    // settings is a REAL cell; the input seeds from settings.theme.
    expect(document.querySelector("#theme-input").value).toBe("dark");
    const el = typeInto("#theme-input", "light");
    expect(el.value).toBe("light");
    // The nested object property updated in place (deep_set on the cell value).
    expect(api.get("settings")).toMatchObject({ theme: "light" });
    expect(api.get("settings").theme).toBe("light");
  });
});
