/**
 * g-match-arm-reactive-attr-effects.browser.test.js
 *
 * Regression gate for change-id `g-match-arm-reactive-attr-effects-2026-06-21`
 * (filed docs/known-gaps.md §S212, HIGH).
 *
 * BUG: a reactive `style="...${@cell}..."` attribute template OR a
 * `class:foo=(cond)` directive INSIDE a `<match>` arm body compiled green but
 * never wired its `_scrml_effect`. The arm-render emitted the placeholder markers
 * (`data-scrml-attr-tpl-style`, `data-scrml-class-...`) into the arm-render HTML
 * string but emitted NO effect to resolve them — a DEAD binding. The identical
 * construct OUTSIDE the arm wires correctly. Root: the only class:/attr-tpl
 * effect-wiring pass (emit-bindings.ts) walks `collectMarkupNodes`, which never
 * descends into `<match>` arm bodies (they live in armsRaw/bodyChildren, not
 * node.children). So the INSIDE-arm placeholders were never visited.
 *
 * FIX: arm-body class:/attr-tpl directives are registered as arm-tagged registry
 * logic-bindings (kinds "class-directive" / "attr-template") carrying the lowered
 * JS expr + reactive refs (computed via the SAME helpers the top-level path uses).
 * emit-variant-guard.ts:emitArmWireFunction re-emits classList.toggle / setAttribute
 * + `_scrml_effect` PER-MOUNT against the arm `_root`, disposed on variant change.
 * emit-event-wiring.ts skips them from global emission (a module-init
 * document.querySelector would cache a stale/absent node).
 *
 * This test loads the emitted client.js AS-IS in real module-init order, fires a
 * post-mount cell write, and asserts the INSIDE div's style transform updates AND
 * the INSIDE class:hidden toggles (compile-clean is NOT enough — S140/S152 lesson).
 * Pre-fix the INSIDE assertions FAIL (bindings dead); post-fix pass. The OUTSIDE
 * binding is asserted too (no-regression).
 *
 * Models: g-nested-each-no-own-subscription.browser.test.js + browser-match-block.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro: an OUTSIDE reactive style template + INSIDE-arm reactive style template
// + INSIDE-arm class:hidden directive. @phase starts .Ready so the Ready arm
// mounts at load; @x drives all three bindings. bump() raises @x past 10 so
// class:hidden flips on AND both style transforms update.
const REPRO_SRC = `<program>
\${
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Ready
    <x> = 5
    function bump() { @x = @x + 5 }
}
<div id="outside" style="transform: translateX(\${@x}px)">OUTSIDE</div>
<match for=Phase on=@phase>
    <Loading><p>loading</p></>
    <Ready>
        <div id="inside-style" style="transform: translateX(\${@x}px)">INSIDE-style</div>
        <div id="inside-class" class:hidden=(@x > 10)>INSIDE-class</div>
    </>
</match>
<button onclick=bump()>bump</button>
</program>
`;

// no-reactivity control: a non-reactive arm body still renders its static markup
// (the directive-wiring change must not perturb a plain arm).
const STATIC_ARM_SRC = `<program>
\${
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Ready
}
<match for=Phase on=@phase>
    <Loading><p>loading</p></>
    <Ready><div id="static-inside" class="badge">READY</div></>
</match>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-match-arm-attr-effects");

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
// §1 — emit shape: the INSIDE-arm class:/attr-tpl effects ARE wired in the arm
//      wire function (per-mount _root.querySelector + _scrml_effect), and the
//      effect count rises (the OUTSIDE effect is no longer the only one).
// ---------------------------------------------------------------------------

describe("g-match-arm-reactive-attr-effects §1 — emit shape (arm body wires its directive effects)", () => {
  test("compiles with no errors", () => {
    expect(compileToOutputs(REPRO_SRC, "repro").errors).toEqual([]);
  });

  test("the arm wire fn is NOT a no-op shell — it queries _root for the inside style + class placeholders", () => {
    const { clientJs } = compileToOutputs(REPRO_SRC, "repro");
    // The Ready arm's wire fn must run _root.querySelector against BOTH the
    // inside style attr-tpl placeholder and the inside class:hidden placeholder.
    expect(clientJs).toContain("_root.querySelector");
    expect(clientJs).toMatch(/_root\.querySelector\([^)]*data-scrml-attr-tpl-style/);
    expect(clientJs).toMatch(/_root\.querySelector\([^)]*data-scrml-class-hidden/);
    // The wire fn sets the inside attribute + toggles the inside class.
    expect(clientJs).toMatch(/el\.setAttribute\("style"/);
    expect(clientJs).toMatch(/el\.classList\.toggle\("hidden"/);
  });

  test("the inside bindings get their own _scrml_effect (effect count > 1)", () => {
    const { clientJs } = compileToOutputs(REPRO_SRC, "repro");
    // Pre-fix: exactly 1 _scrml_effect (the OUTSIDE style). Post-fix: the inside
    // style attr-tpl + inside class:hidden each add one → >= 3.
    const effectCount = (clientJs.match(/_scrml_effect\b/g) || []).length;
    expect(effectCount).toBeGreaterThanOrEqual(3);
  });

  test("emitted client.js parses (no E-CODEGEN-INVALID-LOGIC)", () => {
    const { errors } = compileToOutputs(REPRO_SRC, "repro");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: a post-mount @x write updates the INSIDE style transform
//      AND toggles the INSIDE class:hidden (THE bug) + the OUTSIDE binding still
//      works (no regression) + a non-reactive arm body still renders.
// ---------------------------------------------------------------------------

describe("g-match-arm-reactive-attr-effects §2 — post-mount drive (real module-init order)", () => {
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
      styleOf: (id) => (document.getElementById(id)?.getAttribute("style") || ""),
      hasClass: (id, cls) => !!document.getElementById(id)?.classList.contains(cls),
    };
  }

  test("THE bug: a post-mount @x write updates the INSIDE arm's style transform", () => {
    const app = mount(REPRO_SRC, "repro");
    // At mount @x=5 → the inside div has translateX(5px). Pre-fix this is dead
    // (no setAttribute ever ran inside the arm) — the attribute is empty.
    expect(app.styleOf("inside-style")).toContain("translateX(5px)");
    // Write @x — the inside style must follow. Pre-fix it stays at the mount value
    // (actually empty pre-fix; post-fix it tracks).
    app.set("x", 42);
    expect(app.styleOf("inside-style")).toContain("translateX(42px)");
  });

  test("THE bug: a post-mount @x write toggles the INSIDE arm's class:hidden", () => {
    const app = mount(REPRO_SRC, "repro");
    // @x=5 → (@x > 10) is false → 'hidden' absent.
    expect(app.hasClass("inside-class", "hidden")).toBe(false);
    // Raise @x past 10 → 'hidden' must be added. Pre-fix the class never toggles.
    app.set("x", 20);
    expect(app.hasClass("inside-class", "hidden")).toBe(true);
    // Drop @x back → 'hidden' must be removed (durable subscription, not one-shot).
    app.set("x", 3);
    expect(app.hasClass("inside-class", "hidden")).toBe(false);
  });

  test("no regression: the OUTSIDE reactive style template still tracks @x", () => {
    const app = mount(REPRO_SRC, "repro");
    expect(app.styleOf("outside")).toContain("translateX(5px)");
    app.set("x", 99);
    expect(app.styleOf("outside")).toContain("translateX(99px)");
  });

  test("no regression: a non-reactive arm body still renders its static markup", () => {
    const app = mount(STATIC_ARM_SRC, "static");
    const el = document.getElementById("static-inside");
    expect(el).not.toBeNull();
    expect(el.classList.contains("badge")).toBe(true);
    expect(el.textContent.trim()).toBe("READY");
  });
});
