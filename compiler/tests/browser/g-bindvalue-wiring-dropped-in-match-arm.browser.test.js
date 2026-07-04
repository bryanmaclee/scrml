/**
 * g-bindvalue-wiring-dropped-in-match-arm.browser.test.js
 *
 * Regression gate for change-id `family-a-converge-half1-2026-06-23`
 * (Family-A convergence HALF 1, HIGH).
 *
 * BUG: a `bind:value=@cell` (or bind:checked / bind:group / enum-<select>) on an
 * input INSIDE a `<match>` arm body OR an `<engine>` state-child body compiled
 * green and emitted the `data-scrml-bind-value` placeholder, but emitted NO
 * `querySelector + addEventListener("input") + _scrml_effect` wiring — typed
 * input never reached the cell (silent data loss). The identical construct
 * OUTSIDE the arm wires correctly. Root: the only bind:* wiring pass
 * (emit-bindings.ts) walks `collectMarkupNodes`, which never descends into
 * arm bodies (they live in armsRaw/bodyChildren, not node.children). The same
 * drop-class as the S212 class:/attr-tpl arm-body gap.
 *
 * FIX (Family-A HALF 1): the per-flavour bind:* lowering was extracted into the
 * root-agnostic `emitBindDirectiveBody` (emit-bindings.ts), parameterized on
 * element-acquire + effect-disposal. Arm-body bind: directives are registered as
 * arm-tagged registry logic-bindings (kind "bind-directive") carrying the raw
 * attr + markup node; emit-variant-guard.ts:emitArmWireFunction re-emits the bind
 * wiring PER-MOUNT against the arm `_root` (with `_disposers` teardown) via the
 * shared helper. Because <match> arms AND <engine> state-child bodies both route
 * through the variant-source-agnostic emitArmWireFunction (via
 * emitVariantGuardedRender), ONE fix covers BOTH.
 *
 * This test loads the emitted client.js AS-IS in real module-init order, types
 * into the inside-arm input, and asserts the bound cell follows AND the cell
 * write reflects back into the input value (round-trip). Compile-clean is NOT
 * enough (S140/S152 lesson). Pre-fix the inside assertions FAIL (binding dead).
 *
 * Models: g-match-arm-reactive-attr-effects.browser.test.js (the S212 sibling).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// --- repro A: bind:value=@name on an input INSIDE a <match for=Phase> arm. ---
// @phase starts .Editing so the Editing arm mounts at load; @name is the bound
// cell. An OUTSIDE bind:value=@title is asserted too (no-regression control).
const MATCH_SRC = `<program>
\${
    type Phase:enum = { Editing, Done }
    <phase>: Phase = .Editing
    <name> = ""
    <title> = ""
    function finish() { @phase = .Done }
}
<input id="outside-title" type="text" bind:value=@title>
<match for=Phase on=@phase>
    <Editing>
        <input id="name-input" type="text" bind:value=@name>
        <button onclick=finish()>finish</button>
    </>
    <Done><p>Saved \${@name}</p></>
</match>
</program>
`;

// --- repro B: bind:value=@draft on an input INSIDE an <engine> state-child. ---
// The Editing state-child mounts at boot (initial=.Editing); @draft is bound.
const ENGINE_SRC = `<program>
\${
    type Mode:enum = { Editing, Done }
    <draft> = ""
}
<engine for=Mode initial=.Editing>
    <Editing rule=.Done>
        <input id="draft-input" type="text" bind:value=@draft>
    </>
    <Done>
        <p>Saved \${@draft}</p>
    </>
</>
<div class="ctl">
    <button onclick=\${@mode = .Done}>save</button>
</div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-bindvalue-arm-wiring");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — emit shape: the inside-arm bind:value IS wired in the arm wire function
//      (per-mount _root.querySelector + addEventListener + _scrml_effect), for
//      BOTH the <match> arm and the <engine> state-child body.
// ---------------------------------------------------------------------------

describe("g-bindvalue-wiring-dropped-in-match-arm §1 — emit shape (arm body wires its bind:value)", () => {
  test("MATCH arm: compiles with no errors", () => {
    expect(compileToOutputs(MATCH_SRC, "match").errors).toEqual([]);
  });

  test("MATCH arm: the arm wire fn queries _root for the inside bind:value placeholder + wires a listener + effect", () => {
    const { clientJs } = compileToOutputs(MATCH_SRC, "match");
    // The Editing arm's wire fn must run _root.querySelector against the inside
    // bind:value placeholder, attach an input listener, and push a disposable effect.
    expect(clientJs).toMatch(/_root\.querySelector\([^)]*data-scrml-bind-value/);
    expect(clientJs).toMatch(/addEventListener\("input"/);
    expect(clientJs).toMatch(/_disposers\.push\(_scrml_effect\(/);
    expect(clientJs).toContain('_scrml_reactive_set("name", event.target.value)');
  });

  test("ENGINE state-child: the engine wire fn wires the inside bind:value identically", () => {
    const { clientJs, errors } = compileToOutputs(ENGINE_SRC, "engine");
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/_root\.querySelector\([^)]*data-scrml-bind-value/);
    expect(clientJs).toMatch(/addEventListener\("input"/);
    expect(clientJs).toMatch(/_disposers\.push\(_scrml_effect\(/);
    expect(clientJs).toContain('_scrml_reactive_set("draft", event.target.value)');
  });

  test("MATCH arm: emitted client.js parses (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(MATCH_SRC, "match");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: typing into the inside-arm input updates the bound cell
//      AND a cell write reflects back into the input (round-trip), for both the
//      <match> arm and the <engine> state-child body. The OUTSIDE bind still works.
// ---------------------------------------------------------------------------

describe("g-bindvalue-wiring-dropped-in-match-arm §2 — post-mount drive (real module-init order)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      typeInto: (id, val) => {
        const el = document.getElementById(id);
        el.value = val;
        el.dispatchEvent(new Event("input"));
      },
      valueOf: (id) => (document.getElementById(id)?.value ?? ""),
    };
  }

  test("THE bug (MATCH arm): typing into the inside input writes the bound cell", () => {
    const app = mount(MATCH_SRC, "match");
    // Pre-fix: no listener was wired inside the arm, so the cell never changes.
    expect(app.get("name")).toBe("");
    app.typeInto("name-input", "Ada");
    expect(app.get("name")).toBe("Ada");
  });

  test("THE bug (MATCH arm): a cell write reflects back into the inside input value (round-trip)", () => {
    const app = mount(MATCH_SRC, "match");
    app.set("name", "Lovelace");
    expect(app.valueOf("name-input")).toBe("Lovelace");
  });

  test("THE bug (ENGINE state-child): typing into the inside input writes the bound cell", () => {
    const app = mount(ENGINE_SRC, "engine");
    expect(app.get("draft")).toBe("");
    app.typeInto("draft-input", "hello");
    expect(app.get("draft")).toBe("hello");
  });

  test("THE bug (ENGINE state-child): a cell write reflects back into the inside input value", () => {
    const app = mount(ENGINE_SRC, "engine");
    app.set("draft", "world");
    expect(app.valueOf("draft-input")).toBe("world");
  });

  test("no regression: the OUTSIDE (top-level) bind:value still round-trips", () => {
    const app = mount(MATCH_SRC, "match");
    app.typeInto("outside-title", "Outer");
    expect(app.get("title")).toBe("Outer");
    app.set("title", "Reflected");
    expect(app.valueOf("outside-title")).toBe("Reflected");
  });
});
