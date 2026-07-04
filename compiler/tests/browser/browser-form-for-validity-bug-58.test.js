/**
 * Bug 58 (S140) — formFor §55 validity-surface RUNTIME drive (happy-dom).
 *
 * The emit-regression half lives in
 * compiler/tests/conformance/conf-form-for-validity-surface-bug-58.test.js.
 * THIS file mounts the compiled flagship `<formFor>` form in happy-dom and
 * drives the reactive validity surface end-to-end — the acceptance-gate tier
 * the audit (§4) flagged as missing for EVERY runtime-bearing surface and the
 * exact blind spot that let Bug 58 ship (emit-string tests cannot detect a
 * wiring-dropped-into-the-wrong-pipeline miscompile).
 *
 * Asserts (per SPEC §41.14.2 / §41.14.3 + §55.5-§55.7):
 *   - the synth compound cell + per-field cells are DECLARED + seeded;
 *   - signup.isValid is false until all validators pass;
 *   - typing a too-short name → per-field LengthFailed error appears;
 *   - filling valid values → all errors clear + signup.isValid true;
 *   - submit sets @signup.submitted = true AND invokes the handler with the
 *     collected `values` (the compound cell value).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

// Fresh document per test. The form's submit handler is wired via a delegated
// `document.addEventListener("submit", ...)`; without a fresh document, every
// prior test's listener (each closing over its own reactive state) stays
// attached and the OLDEST one fires first + `return`s — reading a stale/empty
// `signup`. Re-registering happy-dom gives each test a clean document.
beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

// Canonical §41.14 flagship example (the `import { formFor }` is load-bearing).
const CANONICAL_SRC = `\${
  import { formFor } from 'scrml:data'

  type Signup:struct = {
    name:  string req length(>=2)
    email: string req pattern(/^[^@]+@[^@]+$/)
    agree: boolean req
  }

  server function persistSignup(values: Signup) ! string {
    return "ok"
  }
}
<program>
  <formFor for=Signup onsubmit=persistSignup/>
</program>
`;

/**
 * Compile the source, mount the emitted HTML body + runtime + client.js in
 * happy-dom, dispatch DOMContentLoaded, and return reactive accessors.
 *
 * `fetchStub` captures the global fetch body so we can assert the submit
 * handler forwarded the collected `values` to the server-fn wrapper (the PE
 * fetch path is `_scrml_fetch_persistSignup_N(values)` → `fetch(...)`).
 */
function mount() {
  const TMP = mkdtempSync(join(tmpdir(), "browser-form-for-bug58-"));
  const abs = join(TMP, "formfor.scrml");
  writeFileSync(abs, CANONICAL_SRC);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const realErrors = (result.errors || []).filter(e => e && e.severity !== "warning");
  expect(realErrors).toEqual([]);

  const out = [...(result.outputs || new Map()).entries()][0]?.[1];
  const html = out?.html ?? "";
  const clientJs = out?.clientJs ?? "";
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });

  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  // Capture the fetch body so we can assert the handler received `values`.
  const fetchCalls = [];
  globalThis.fetch = async (path, opts) => {
    fetchCalls.push({ path, opts });
    // A faithful Response mock: `.ok` is REQUIRED — the per-route stub now applies
    // the §6.7.7/§19.9.2 non-2xx ok-check (Peter #20), so a 2xx mock must set
    // `ok: true` (a real `fetch` Response always does). Without it the stub sees a
    // falsy `.ok` on a 200 and rejects with "HTTP 200".
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  };

  const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `window.__sg = _scrml_reactive_get;\n` +
    `window.__ss = _scrml_reactive_set;\n` +
    `window.__dg = _scrml_derived_get;\n` +
    `})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (n) => window.__sg(n),
    set: (n, v) => window.__ss(n, v),
    dget: (n) => window.__dg(n),
    fetchCalls,
  };
}

describe("Bug 58 — formFor validity surface drives at runtime (happy-dom)", () => {
  test("the synth compound cell + per-field cells are DECLARED + seeded (not undefined)", () => {
    const api = mount();
    // Pre-fix _scrml_reactive_get("signup") was undefined (nothing declared it).
    expect(api.get("signup")).toBeDefined();
    // Per-field cells seeded to `not` (null wire-rep) per §41.14.2.
    const compound = api.get("signup");
    expect(compound).toHaveProperty("name");
    expect(compound).toHaveProperty("email");
    expect(compound).toHaveProperty("agree");
  });

  test("signup.isValid is FALSE initially (required validators unmet)", () => {
    const api = mount();
    expect(api.dget("signup.isValid")).toBe(false);
  });

  test("each required field reports a .Required error initially", () => {
    const api = mount();
    expect(api.dget("signup.name.errors")).toEqual([{ tag: "Required" }]);
    expect(api.dget("signup.email.errors")).toEqual([{ tag: "Required" }]);
    expect(api.dget("signup.agree.errors")).toEqual([{ tag: "Required" }]);
  });

  test("TYPING a too-short name (< 2) in the actual input produces a LengthFailed error", () => {
    // Drive via the real DOM input (not a direct dotted set) so the test
    // exercises the FULL chain: bind:value → flat dotted write → validator
    // runner → per-field errors. Pre-fix, typing did NOTHING (the bind deep-set
    // a derived parent that ignored the write), so the surface stayed at
    // .Required forever.
    const api = mount();
    const nameInput = document.querySelector('[data-scrml-formfor-input="name"]');
    expect(nameInput).not.toBeNull();
    nameInput.value = "x";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const errs = api.dget("signup.name.errors");
    expect(errs.length).toBe(1);
    expect(errs[0].tag).toBe("LengthFailed");
    // The structured predicate arg must have been wired (Bug 58 validator-arg
    // decoration): {op:">=", value:2}.
    expect(errs[0].predicate).toEqual({ op: ">=", value: 2 });
    expect(api.dget("signup.name.isValid")).toBe(false);
    expect(api.dget("signup.isValid")).toBe(false);
  });

  test("TYPING an invalid email (no @) in the actual input produces a PatternMismatch error", () => {
    const api = mount();
    const emailInput = document.querySelector('[data-scrml-formfor-input="email"]');
    emailInput.value = "not-an-email";
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    const errs = api.dget("signup.email.errors");
    expect(errs.length).toBe(1);
    expect(errs[0].tag).toBe("PatternMismatch");
    expect(api.dget("signup.email.isValid")).toBe(false);
  });

  test("filling ALL valid values via inputs clears errors + flips signup.isValid TRUE", () => {
    const api = mount();
    const nameInput = document.querySelector('[data-scrml-formfor-input="name"]');
    const emailInput = document.querySelector('[data-scrml-formfor-input="email"]');
    const agreeInput = document.querySelector('[data-scrml-formfor-input="agree"]');
    nameInput.value = "Alice"; nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.value = "alice@example.com"; emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    agreeInput.checked = true; agreeInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(api.dget("signup.name.errors")).toEqual([]);
    expect(api.dget("signup.email.errors")).toEqual([]);
    expect(api.dget("signup.agree.errors")).toEqual([]);
    expect(api.dget("signup.name.isValid")).toBe(true);
    expect(api.dget("signup.email.isValid")).toBe(true);
    expect(api.dget("signup.isValid")).toBe(true);
    // The compound proxy reflects the typed values (bind → dotted cell → proxy).
    expect(api.get("signup")).toEqual({ name: "Alice", email: "alice@example.com", agree: true });
  });

  test("submit button carries the disabled bool-attr gate (initially disabled)", () => {
    // §41.14.3: default submit button is `disabled=!@signup.isValid`. The gate
    // attribute IS wired (data-scrml-bind-bool-disabled) and the button starts
    // disabled (isValid false). Bug 61 (RESOLVED) fixed the gate's READ path so
    // `@signup.isValid` collapses to `_scrml_reactive_get("signup.isValid")`
    // (the dotted synthesized cell) instead of member access on the compound
    // proxy value (`_scrml_reactive_get("signup").isValid` → undefined). The
    // enable-on-valid flip is asserted in the next test.
    const api = mount();
    const submit = document.querySelector("[data-scrml-formfor-submit]");
    expect(submit).not.toBeNull();
    expect(submit.hasAttribute("data-scrml-bind-bool-disabled")).toBe(true);
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(api.dget("signup.isValid")).toBe(false);
  });

  test("Bug 61 — filling ALL valid values ENABLES the submit button (disabled gate flips)", () => {
    // The §41.14.3 acceptance gate: `disabled=!@signup.isValid` must ENABLE the
    // submit button when the form becomes valid. Pre-Bug-61, the gate read
    // `_scrml_reactive_get("signup").isValid` (member access on the compound
    // VALUE object {name,email,agree}, which has NO `isValid` key → undefined →
    // `!undefined` → true → button STUCK disabled forever). Post-fix the gate
    // reads the dotted synth cell `_scrml_reactive_get("signup.isValid")`, so
    // when validity flips true the `_scrml_effect` re-runs and removes the
    // `disabled` attribute.
    const api = mount();
    const submit = document.querySelector("[data-scrml-formfor-submit]");
    expect(submit.hasAttribute("disabled")).toBe(true); // initially disabled

    const nameInput = document.querySelector('[data-scrml-formfor-input="name"]');
    const emailInput = document.querySelector('[data-scrml-formfor-input="email"]');
    const agreeInput = document.querySelector('[data-scrml-formfor-input="agree"]');
    nameInput.value = "Alice"; nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.value = "alice@example.com"; emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    agreeInput.checked = true; agreeInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Validity surface is now true...
    expect(api.dget("signup.isValid")).toBe(true);
    // ...and the disabled gate's reactive effect removed the attribute → the
    // submit button is ENABLED. This is the end-to-end Bug 61 fix payoff.
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  test("submitted is false before any submit attempt", () => {
    const api = mount();
    expect(api.get("signup.submitted")).toBe(false);
  });

  test("submit sets @signup.submitted = true (§41.14.3) and forwards values to the handler", async () => {
    const api = mount();
    const nameInput = document.querySelector('[data-scrml-formfor-input="name"]');
    const emailInput = document.querySelector('[data-scrml-formfor-input="email"]');
    const agreeInput = document.querySelector('[data-scrml-formfor-input="agree"]');
    nameInput.value = "Alice"; nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.value = "alice@example.com"; emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    agreeInput.checked = true; agreeInput.dispatchEvent(new Event("change", { bubbles: true }));

    const form = document.querySelector("[data-scrml-bind-onsubmit]");
    expect(form).not.toBeNull();
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    // §41.14.3 5th bullet: submitted SHALL be set true BEFORE invoking the handler.
    expect(api.get("signup.submitted")).toBe(true);

    // §41.14.3: the handler receives the collected `values` (the compound cell
    // value). The PE server-fn path serializes values into the fetch body.
    // Let the async fetch wrapper settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(api.fetchCalls[0].opts.body);
    expect(body).toHaveProperty("values");
    expect(body.values).toEqual({ name: "Alice", email: "alice@example.com", agree: true });
  });
});
