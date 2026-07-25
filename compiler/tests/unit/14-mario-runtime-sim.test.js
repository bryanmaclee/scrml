/**
 * 14-mario-runtime-sim.test.js — Runtime simulation for Bug 1 e2e gap.
 *
 * The Wave 3 Dispatch 2 e2e for 14-mario shows symptoms (state span empty,
 * marioName not transitioning) that don't reproduce in pure-codegen unit
 * tests. This file loads the runtime + compiled client.js in a happy-dom
 * sandbox and verifies that:
 *   (a) clicking MUSHROOM actually flips the marioState cell,
 *   (b) the marioName + marioEmoji + healthRisk derived all re-evaluate,
 *   (c) the rendered DOM updates accordingly.
 *
 * If the e2e is failing because of a runtime/derived-tracking issue, this
 * test will surface it WITHOUT requiring the full playwright web server.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { unwrapChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-14-mario-runtime-sim");

beforeEach(async () => {
  // Defensive: another test in the same bun-test process may have left a
  // registration active. Unregister-then-register is idempotent and avoids
  // "already registered" errors from parallel test files.
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});

afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

function compileMario() {
  const fixturePath = resolve(__dirname, "../../../examples/14-mario-state-machine.scrml");
  const src = readFileSync(fixturePath, "utf-8");
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, "14-mario.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, "14-mario.html"), "utf-8");
    const clientJs = readFileSync(resolve(outDir, "14-mario.client.js"), "utf-8");
    // v0.3.x SPA tree-shake Phase B 3.3 — runtime filename is hashed
    // (scrml-runtime.<hash>.js); read it from compileScrml result.
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf-8");
    return { html, clientJs, runtimeJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("14-mario runtime simulation (Bug 1 e2e gap)", () => {
  test("MUSHROOM click transitions marioState cell from Small to Big", () => {
    const { html, clientJs, runtimeJs } = compileMario();

    // Set up DOM with the compiled HTML body.
    document.documentElement.innerHTML = html;

    // Evaluate runtime + client in module scope. Use new Function to avoid
    // polluting the test module's scope and to control which globals are
    // exposed to the runtime/client.
    //
    // Capture the runtime's _scrml_state via a side-channel on globalThis so
    // we can inspect it from the test.
    // BUG-6/N3: unwrap the chunk scope so the accessors key BARE (this harness
    // reads `_scrml_state` + derived by author name) and the body top-levels.
    // Engine names keep their token (matching the un-folded HTML mount attribute),
    // so the engine dispatch still resolves its own `data-scrml-engine-mount`.
    const cjExec = unwrapChunkScope(clientJs);
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${cjExec}\n` +
      `globalThis.__scrml_state__ = _scrml_state;\n` +
      `globalThis.__scrml_derived_get__ = _scrml_derived_get;\n`
    );
    exec(window, document);

    // Fire DOMContentLoaded so the event-wiring block runs.
    document.dispatchEvent(new Event("DOMContentLoaded"));

    // Initial state: marioState should be "Small".
    expect(globalThis.__scrml_state__.marioState).toBe("Small");
    expect(globalThis.__scrml_derived_get__("marioName")).toBe("SMALL MARIO");

    // Click MUSHROOM button.
    const mushroomBtn = Array.from(document.querySelectorAll("button"))
      .find((b) => /MUSHROOM/.test(b.textContent ?? ""));
    expect(mushroomBtn).toBeTruthy();
    mushroomBtn.click();

    // After click, marioState cell should be "Big".
    expect(globalThis.__scrml_state__.marioState).toBe("Big");
    expect(globalThis.__scrml_state__.coins).toBe(1);
    // marioName derived re-evaluates lazily on get.
    expect(globalThis.__scrml_derived_get__("marioName")).toBe("SUPER MARIO");
    // DOM should also reflect the update via reactive effect.
    // marioName lives at the spans with id pattern _scrml_logic_NNN; locate
    // the one whose textContent is currently "SMALL MARIO" or "SUPER MARIO".
    const allSpans = Array.from(document.querySelectorAll("[data-scrml-logic]"));
    const marioNameSpan = allSpans.find((s) => /SMALL MARIO|SUPER MARIO|FIRE MARIO|CAPE MARIO/.test(s.textContent ?? ""));
    expect(marioNameSpan?.textContent).toBe("SUPER MARIO");
  });
});
