/**
 * §36 Phase 4.C (S89) — DESIGN-AND-SHIP gate canvas integration test.
 *
 * Per OQ-C ratified Option γ (compile + JSDOM integration, no Playwright):
 *
 *   1. Compile the canonical canvas sample (`samples/compilation-tests/
 *      input-canvas-demo.scrml`) and assert zero compile errors.
 *   2. Verify the compiled client.js wires up <keyboard> + <mouse> via the
 *      runtime helpers (_scrml_input_keyboard_create / _scrml_input_mouse_create).
 *   3. Drive the SCRML_RUNTIME keyboard scope through a series of WASD +
 *      Space-fire dispatches in a happy-dom environment; assert the input
 *      state surface returns the expected booleans.
 *   4. Verify cleanup-no-leak: destroy the scope and confirm document has no
 *      lingering keydown/keyup listeners (the bug class the §36.5 normative
 *      protects against).
 *
 * Per debate-04 conclusion 4 + SCOPING.md §3 Phase 4 (lines 254-260).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const REPO_ROOT = resolve(testDir, "../../..");
const SAMPLE_PATH = resolve(REPO_ROOT, "samples/compilation-tests/input-canvas-demo.scrml");
const TMP_ROOT = resolve(testDir, "_tmp_input_canvas");

function compileSampleToTmp(tag) {
  const dir = resolve(TMP_ROOT, tag);
  const outDir = resolve(dir, "dist");
  mkdirSync(dir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const result = compileScrml({ inputFiles: [SAMPLE_PATH], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    outDir,
  };
}

function readClientFor(outDir, basename) {
  const path = resolve(outDir, `${basename}.client.js`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

describe("§36 Phase 4.C — input-canvas-demo DESIGN-AND-SHIP gate (integration)", () => {
  beforeEach(async () => {
    if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // §1 Sample compiles cleanly.
  // ---------------------------------------------------------------------------

  test("§1 input-canvas-demo.scrml compiles with zero errors", () => {
    expect(existsSync(SAMPLE_PATH)).toBe(true);
    const { errors } = compileSampleToTmp("compile-clean");
    if (errors.length) {
      // surface error messages on failure for fast debugging
      console.error("Compile errors:", errors.map(e => `${e.code}: ${e.message}`));
    }
    expect(errors.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // §2 Compiled client wires up keyboard + mouse runtime.
  // ---------------------------------------------------------------------------

  test("§2 client.js contains _scrml_input_keyboard_create + _scrml_input_mouse_create", () => {
    const { errors, outDir } = compileSampleToTmp("wiring-check");
    expect(errors.length).toBe(0);
    const clientJs = readClientFor(outDir, "input-canvas-demo");
    expect(clientJs).not.toBeNull();
    expect(clientJs).toContain("_scrml_input_keyboard_create");
    expect(clientJs).toContain("_scrml_input_mouse_create");
    expect(clientJs).toContain('"keys"');
    expect(clientJs).toContain('"cursor"');
    // cleanup registered for both
    expect(clientJs).toContain("_scrml_input_keyboard_destroy");
    expect(clientJs).toContain("_scrml_input_mouse_destroy");
  });

  // ---------------------------------------------------------------------------
  // §3 Server output contains NO input runtime references (SSR no-emit guard).
  // ---------------------------------------------------------------------------

  test("§3 server.js contains no _scrml_input_* references", () => {
    const { outDir } = compileSampleToTmp("ssr-no-emit");
    const serverPath = resolve(outDir, "input-canvas-demo.server.js");
    if (!existsSync(serverPath)) {
      // Some compiles emit no server file when no server functions exist;
      // that itself satisfies the no-emit guarantee.
      expect(true).toBe(true);
      return;
    }
    const serverJs = readFileSync(serverPath, "utf8");
    expect(serverJs).not.toContain("_scrml_input_keyboard_create");
    expect(serverJs).not.toContain("_scrml_input_mouse_create");
    expect(serverJs).not.toContain("_scrml_input_gamepad_create");
  });

  // ---------------------------------------------------------------------------
  // §4 Runtime drive — WASD + Space exercised in JSDOM-like environment.
  // ---------------------------------------------------------------------------

  function loadRuntime() {
    const exec = new Function(
      "window",
      "document",
      `${SCRML_RUNTIME}\n` +
      `globalThis.__test_kb_create = _scrml_input_keyboard_create;\n` +
      `globalThis.__test_kb_destroy = _scrml_input_keyboard_destroy;\n` +
      `globalThis.__test_mouse_create = _scrml_input_mouse_create;\n` +
      `globalThis.__test_mouse_destroy = _scrml_input_mouse_destroy;\n`
    );
    exec(window, document);
    return {
      kbCreate: globalThis.__test_kb_create,
      kbDestroy: globalThis.__test_kb_destroy,
      mouseCreate: globalThis.__test_mouse_create,
      mouseDestroy: globalThis.__test_mouse_destroy,
      dispatchKey(type, key) {
        document.dispatchEvent(new KeyboardEvent(type, { key }));
      },
      dispatchMouseMove(x, y) {
        const ev = new MouseEvent("mousemove", { clientX: x, clientY: y });
        document.dispatchEvent(ev);
      },
    };
  }

  test("§4 WASD movement sequence flips pressed() booleans correctly", () => {
    const r = loadRuntime();
    const keys = r.kbCreate("keys", "_scrml_scope_canvas_4");

    // initial: nothing pressed
    expect(keys.pressed("KeyA")).toBe(false);
    expect(keys.pressed("KeyD")).toBe(false);

    // press A → pressed true
    r.dispatchKey("keydown", "KeyA");
    expect(keys.pressed("KeyA")).toBe(true);
    expect(keys.pressed("KeyD")).toBe(false);

    // also press D → both true (concurrent)
    r.dispatchKey("keydown", "KeyD");
    expect(keys.pressed("KeyA")).toBe(true);
    expect(keys.pressed("KeyD")).toBe(true);

    // release A → only D pressed
    r.dispatchKey("keyup", "KeyA");
    expect(keys.pressed("KeyA")).toBe(false);
    expect(keys.pressed("KeyD")).toBe(true);

    r.kbDestroy("keys", "_scrml_scope_canvas_4");
  });

  test("§5 Space-fire edge — justPressed exactly once per frame", () => {
    const r = loadRuntime();
    const keys = r.kbCreate("keys", "_scrml_scope_canvas_5");

    // single frame: dispatch + observe + clear
    r.dispatchKey("keydown", " ");
    expect(keys.justPressed(" ")).toBe(true);
    keys._clearFrameState();
    expect(keys.justPressed(" ")).toBe(false);

    // still held: no re-fire
    r.dispatchKey("keydown", " "); // OS auto-repeat
    expect(keys.justPressed(" ")).toBe(false);
    expect(keys.pressed(" ")).toBe(true);

    r.kbDestroy("keys", "_scrml_scope_canvas_5");
  });

  test("§6 Mouse coordinate tracking via document mousemove", () => {
    const r = loadRuntime();
    const cursor = r.mouseCreate("cursor", "_scrml_scope_canvas_6");

    expect(cursor.x).toBe(0);
    expect(cursor.y).toBe(0);

    r.dispatchMouseMove(150, 220);
    expect(cursor.x).toBe(150);
    expect(cursor.y).toBe(220);

    r.dispatchMouseMove(400, 380);
    expect(cursor.x).toBe(400);
    expect(cursor.y).toBe(380);

    r.mouseDestroy("cursor", "_scrml_scope_canvas_6");
  });

  test("§7 Cleanup-no-leak — after destroy, dispatches do not affect state", () => {
    const r = loadRuntime();
    const keys = r.kbCreate("keys", "_scrml_scope_canvas_7");

    r.dispatchKey("keydown", "KeyW");
    expect(keys.pressed("KeyW")).toBe(true);

    // destroy → listeners removed
    r.kbDestroy("keys", "_scrml_scope_canvas_7");

    // After destroy, the state object still exists in our local reference
    // but no event listeners are connected. A fresh dispatch should NOT
    // mutate the state set (the listener is gone).
    const before = keys.pressed("KeyA");
    r.dispatchKey("keydown", "KeyA");
    const after = keys.pressed("KeyA");
    expect(after).toBe(before);
    expect(after).toBe(false);
  });
});
