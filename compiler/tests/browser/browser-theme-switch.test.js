/**
 * browser-theme-switch.test.js — §65.6 runtime theme-switch happy-dom EXECUTION
 * acceptance (S265 FIX3).
 *
 * The headline of the CSS Wave-1 arc: `<theme for=@cell>` must ACTUALLY switch
 * the theme at runtime. This test EXECUTES the emitted client bundle (not a grep)
 * and asserts:
 *   (a) the bundle loads with NO ReferenceError (FIX3: a `<theme>` token was
 *       wrongly collected as a §25 reactive-CSS-var bridge → a spurious
 *       `_scrml_el.style.setProperty("--scrml-bg", …)` at module scope threw
 *       `ReferenceError: _scrml_el is not defined` on load → the whole bundle,
 *       including the theme-switch reflection, never ran → the theme was DOA);
 *   (b) at MOUNT, `<html>` carries `data-scrml-theme-<cell>` = the cell's initial
 *       variant (the first-paint variant);
 *   (c) after switching the cell (`@mode = .Dark`, direct set AND via the toggle
 *       button), `<html>`'s `data-scrml-theme-<cell>` updates — the whole page
 *       flips via the one `:root` attribute write (§65.6).
 *
 * The attribute name (`data-scrml-theme-mode`) is the SAME one the emitted CSS
 * variant selector (`:root[data-scrml-theme-mode="Dark"]`) keys off.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve("/tmp", "scrml-theme-switch");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

function mount(compiled) {
  const { clientJs, runtimeJs } = compiled;
  // Reset <html> to a clean state (the reflection writes onto document.documentElement).
  document.documentElement.removeAttribute("data-scrml-theme-mode");
  document.body.innerHTML = "";
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n${clientJs}\n`
      + `globalThis.__scrml_get__ = _scrml_reactive_get;\n`
      + `globalThis.__scrml_set__ = _scrml_reactive_set;\n`,
  );
  let threw = null;
  try {
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  return {
    threw,
    set: (name, val) => globalThis.__scrml_set__(name, val),
    themeAttr: () => document.documentElement.getAttribute("data-scrml-theme-mode"),
  };
}

const THEME_SRC = `<program>
  <mode> = .Light
  <theme for=@mode>
      ink   = #0f172a;
      paper = #ffffff;
      .Dark {
          ink   = #e2e8f0;
          paper = #0f172a;
      }
  </theme>
  const Card = <div props={}>
      #{ .card { color: @ink; background: @paper; } }
      <div class="card">hi</div>
  </>
  <Card/>
  <button onclick=(@mode = .Dark)>dark</button>
</program>`;

describe("§65.6 runtime theme-switch — EXECUTED bundle", () => {
  test("the client bundle loads with NO ReferenceError (FIX3: no spurious §25 bridge for theme tokens)", () => {
    const compiled = compileToOutputs(THEME_SRC, "theme-switch");
    expect(compiled.errors).toEqual([]);
    const app = mount(compiled);
    expect(app.threw).toBeNull();
  });

  test("at MOUNT, <html> carries data-scrml-theme-mode = the initial variant (Light)", () => {
    const app = mount(compileToOutputs(THEME_SRC, "theme-switch"));
    expect(app.threw).toBeNull();
    expect(app.themeAttr()).toBe("Light");
  });

  test("switching @mode to .Dark flips <html> data-scrml-theme-mode to Dark (the theme SWITCHES)", () => {
    const app = mount(compileToOutputs(THEME_SRC, "theme-switch"));
    expect(app.threw).toBeNull();
    expect(app.themeAttr()).toBe("Light");
    app.set("mode", "Dark");
    expect(app.themeAttr()).toBe("Dark");
    // and back to Light — the reflection is a live subscription, not a one-shot.
    app.set("mode", "Light");
    expect(app.themeAttr()).toBe("Light");
  });
});
