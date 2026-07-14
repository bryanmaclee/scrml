/**
 * S144 (6nz Bug AC) — §36 input-state `<#id>` reads must resolve to the runtime
 * registry, NOT a bare unbound `_scrml_input_<id>_` identifier.
 *
 * THE BUG (HIGH, Bug-51-class — emit-string + happy-dom, no Playwright):
 *
 *   The entire §36 input-state read surface compiled to a bare local
 *   `_scrml_input_<id>_` that was never bound anywhere, so the FIRST `<#id>`
 *   member read threw `ReferenceError: _scrml_input_<id>_ is not defined`. The
 *   element REGISTERED fine (`_scrml_input_mouse_create("cursor", ...)` →
 *   `_scrml_input_state_registry.set("cursor", state)`), but the READ used a
 *   different, never-bound naming scheme. The shipped canonical gate sample
 *   (`input-canvas-demo.scrml`) was itself broken across its whole surface.
 *
 *   Root cause: ast-builder `preprocessWorkerAndStateRefs()` (TAB) lowers a
 *   standalone `<#id>` in a markup-interp / logic body to the bare
 *   `_scrml_input_<id>_` form BEFORE codegen, so CG's `rewriteInputStateRefs`
 *   (which expects the literal `<#id>`) never sees it.
 *
 *   Fix (CG, S144): emit-expr.ts `emitIdent` + rewrite.ts `rewriteInputStateRefs`
 *   recover the bare `_scrml_input_<id>_` form to
 *   `_scrml_input_state_registry.get("<id>")`; emit-reactive-wiring.ts extends
 *   the file-scope orphan-read suppression to that shape so the recovered read
 *   does not leak a file-scope statement (which would run before registration
 *   and throw a fresh TypeError).
 *
 * Reactivity note (SPEC §36.6, line 17495-17498): input-state reads set up NO
 * reactive subscription — intentionally. The canonical pattern reads inside an
 * `animationFrame` callback. This suite therefore asserts the ONE-SHOT read at
 * DOMContentLoaded resolves the live coordinate (the ReferenceError gate), not
 * live reactivity on subsequent mousemove.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_input_read_path_bug_ac");

const REPRO = `<mouse id="cursor"/>
<keyboard id="k"/>
<program>
<div class="pad">
  <span class="mx">\${<#cursor>.x}</span>
  <span class="my">\${<#cursor>.y}</span>
</div>
</program>
`;

function compileReproToTmp(tag) {
  const dir = resolve(TMP_ROOT, tag);
  const outDir = resolve(dir, "dist");
  mkdirSync(dir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const src = resolve(dir, "repro.scrml");
  writeFileSync(src, REPRO, "utf8");
  const result = compileScrml({ inputFiles: [src], write: true, outputDir: outDir });
  return {
    errors: result.errors ?? [],
    outDir,
    clientJs: existsSync(resolve(outDir, "repro.client.js"))
      ? readFileSync(resolve(outDir, "repro.client.js"), "utf8")
      : null,
    html: existsSync(resolve(outDir, "repro.html"))
      ? readFileSync(resolve(outDir, "repro.html"), "utf8")
      : null,
    runtimeFile: null,
    outDirResolved: outDir,
  };
}

describe("S144 Bug AC — input-state read path resolves through registry", () => {
  // -------------------------------------------------------------------------
  // Emit tier — the read MUST resolve to a registry lookup, never the bare
  // unbound `_scrml_input_<id>_` form.
  // -------------------------------------------------------------------------

  test("emit: ${<#cursor>.x} compiles to registry.get(\"cursor\").x, not a bare ident", () => {
    if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
    const { errors, clientJs } = compileReproToTmp("emit-check");
    expect(errors.length).toBe(0);
    expect(clientJs).not.toBeNull();

    // The actual read resolves through the runtime registry (read name agrees
    // with the registration name).
    expect(clientJs).toContain('_scrml_input_state_registry.get("cursor").x');
    expect(clientJs).toContain('_scrml_input_state_registry.get("cursor").y');

    // The dead, never-bound bare form MUST be gone everywhere (the ReferenceError).
    expect(clientJs).not.toContain("_scrml_input_cursor_");

    // And it must NOT leak a file-scope orphan statement that would run before
    // _scrml_input_mouse_create registers the state (fresh TypeError class).
    const beforeDCL = clientJs.split("DOMContentLoaded")[0];
    expect(beforeDCL).not.toContain('_scrml_input_state_registry.get("cursor")');

    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("emit: compiled client.js is syntactically valid (node --check parity)", () => {
    if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
    const { clientJs } = compileReproToTmp("syntax-check");
    expect(clientJs).not.toBeNull();
    // new Function throws SyntaxError on invalid JS — the node --check parity.
    expect(() => new Function(clientJs)).not.toThrow();
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("emit: canonical sample input-canvas-demo reads resolve through registry", () => {
    const REPO_ROOT = resolve(testDir, "../../..");
    const SAMPLE = resolve(REPO_ROOT, "samples/compilation-tests/input-canvas-demo.scrml");
    expect(existsSync(SAMPLE)).toBe(true);

    if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
    const outDir = resolve(TMP_ROOT, "sample-check", "dist");
    mkdirSync(outDir, { recursive: true });
    const result = compileScrml({ inputFiles: [SAMPLE], write: true, outputDir: outDir });
    expect((result.errors ?? []).length).toBe(0);

    const client = readFileSync(resolve(outDir, "input-canvas-demo.client.js"), "utf8");
    // The whole §36 surface the bug touched:
    expect(client).toContain('_scrml_input_state_registry.get("keys")._clearFrameState()');
    expect(client).toContain('_scrml_input_state_registry.get("keys").pressed("KeyA")');
    expect(client).toContain('_scrml_input_state_registry.get("keys").justPressed("Space")');
    expect(client).toContain('_scrml_input_state_registry.get("cursor").x');
    expect(client).toContain('_scrml_input_state_registry.get("cursor").y');
    // No bare unbound idents survive.
    expect(client).not.toContain("_scrml_input_keys_");
    expect(client).not.toContain("_scrml_input_cursor_");
    expect(() => new Function(client)).not.toThrow();

    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // happy-dom tier — execute the COMPILED client.js end-to-end. This is the
  // tier the bug slipped through: prior tests exercised the runtime helpers in
  // isolation but never ran the compiled read wiring, so the ReferenceError
  // never surfaced under test.
  // -------------------------------------------------------------------------

  describe("happy-dom: compiled read wiring executes without ReferenceError", () => {
    beforeEach(async () => {
      if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
      try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
      GlobalRegistrator.register();
    });

    afterEach(async () => {
      try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
      if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
    });

    test("${<#cursor>.x}/.y render the live mouse coordinate into the DOM", () => {
      const { errors, outDir, clientJs, html } = compileReproToTmp("happy-dom-run");
      expect(errors.length).toBe(0);
      expect(clientJs).not.toBeNull();
      expect(html).not.toBeNull();

      // Load the runtime chunk (its filename is hashed; read whatever runtime
      // file the compile emitted alongside the client).
      const runtimeName = (clientJs.match(/Requires:\s*(scrml-runtime\.[^\s]+\.js)/) || [])[1];
      expect(runtimeName).toBeTruthy();
      const runtimeJs = readFileSync(resolve(outDir, runtimeName), "utf8");

      // Mount the compiled placeholders into the happy-dom document body.
      const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
      expect(bodyMatch).toBeTruthy();
      // Strip the <script> tags from the HTML body — we wire the JS ourselves.
      document.body.innerHTML = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "");

      // Execute runtime + compiled client in a single scope (the client refs
      // runtime globals like _scrml_input_state_registry / _scrml_input_mouse_create).
      const exec = new Function("window", "document", `${runtimeJs}\n${clientJs}\n`);

      // 1) ReferenceError gate — executing the compiled output must NOT throw.
      //    (Pre-fix this threw `_scrml_input_cursor_ is not defined` as soon as
      //    the DOMContentLoaded read ran.) Run before dispatching DOMContentLoaded
      //    so file-scope statements (registration) execute.
      expect(() => exec(window, document)).not.toThrow();

      // 2) Drive a mousemove (the file-scope _scrml_input_mouse_create registered
      //    the document mousemove listener), THEN fire DOMContentLoaded so the
      //    one-shot read (§36.6 — non-reactive) picks up the current coordinate.
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 137, clientY: 242 }));
      document.dispatchEvent(new Event("DOMContentLoaded"));

      const mx = document.querySelector('[data-scrml-logic="_scrml_logic_1"]');
      const my = document.querySelector('[data-scrml-logic="_scrml_logic_2"]');
      expect(mx).not.toBeNull();
      expect(my).not.toBeNull();
      // The read resolved the live coordinate through the registry — no
      // ReferenceError, real value in the DOM.
      expect(mx.textContent).toBe("137");
      expect(my.textContent).toBe("242");
    });

    test("registry.get(<id>).pressed(...) reflects keyboard state after keydown", () => {
      // Direct runtime exercise of the registry surface the keyboard read path
      // now targets — proves get("k").pressed("KeyA") is the live state object
      // (the same value the recovered read resolves to).
      const { outDir, clientJs } = compileReproToTmp("happy-dom-kb");
      const runtimeName = (clientJs.match(/Requires:\s*(scrml-runtime\.[^\s]+\.js)/) || [])[1];
      const runtimeJs = readFileSync(resolve(outDir, runtimeName), "utf8");

      const exec = new Function(
        "window",
        "document",
        `${runtimeJs}\n` +
        `globalThis.__t_kb_create = _scrml_input_keyboard_create;\n` +
        `globalThis.__t_registry = _scrml_input_state_registry;\n`
      );
      exec(window, document);

      globalThis.__t_kb_create("k", "_scrml_scope_bugac_kb");
      // The recovered read shape is `_scrml_input_state_registry.get("k").pressed("KeyA")`.
      const readVal = () => globalThis.__t_registry.get("k").pressed("KeyA");

      expect(readVal()).toBe(false);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "KeyA" }));
      expect(readVal()).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "KeyA" }));
      expect(readVal()).toBe(false);
    });
  });
});
