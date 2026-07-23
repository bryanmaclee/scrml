/**
 * g-match-on-subfield-dispatch.browser.test.js — GITI-031 (silent, compile-clean,
 * browser-only) happy-dom acceptance regression.
 *
 * Bug: a block-form `<match for=P on=@cell.state>` (the `on=` operand is a
 * member-access, NOT a bare `@cell` ref) emitted a dispatch that read the WHOLE
 * `cell` object, dropping the `.state` sub-path. The dispatcher's
 * `_tag = _v.variant ?? _v` then received `{state, n}` (an object with no
 * `.variant`), matched NO arm, and the mount stayed blank — even for the initial
 * seed variant.
 *
 * Root cause: emit-match.ts `resolveOnExpr`'s member-access branch returns a
 * non-null `variantSubscribeName` (the root cell) -> routed Shape A
 * (subscribe-only). Shape A in emit-variant-guard.ts read the whole cell via
 * `_scrml_reactive_get(name)` and the subscribe callback received the whole cell
 * value; the `variantExprAccessor` (which DID carry `.state`) was used only by
 * Shape B (effect mode).
 *
 * Fix (GITI-031): thread a `subscribeSubPath` from resolveOnExpr into
 * emitVariantGuardedRender. When non-empty (member-access), the Shape-A subscribe
 * wraps `function(_cv){ dispatch((_cv)<path>); }` and the DOMContentLoaded
 * init-fire appends `<path>` to the cell read, so the dispatcher receives the
 * enum-variant discriminant, not the parent struct. Bare `@cell` + engine
 * auto-implied paths are unchanged.
 *
 * Per R26 (S138): node-check passes today and the compile exits 0 — the OUTPUT
 * was wrong. An emit-string assertion is necessary but NOT sufficient. §2 mounts
 * the compiled module in happy-dom and asserts the initial seed variant renders
 * AND a reactive sub-path write re-dispatches the correct arm. §3 covers a deeper
 * `on=@a.b.c` sub-path.
 *
 * Models: compiler/tests/browser/match-block-in-each-per-item-r28-1b.test.js
 * (real compile + read result.runtimeFilename + happy-dom mount via new Function).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// Single-level sub-path: `<cell> = { state: P.Idle, n: 0 }` + `on=@cell.state`.
const SRC = `<program>
type P:enum = { Idle, Ok }
<cell> = { state: P.Idle, n: 0 }
<match for=P on=@cell.state><Idle><p data-arm="idle">IDLE</p></Idle><Ok><p data-arm="ok">OK</p></Ok></match>
</program>
`;

// Deeper sub-path: `<cell> = { inner: { phase: P.Idle } }` + `on=@cell.inner.phase`.
const SRC_DEEP = `<program>
type P:enum = { Idle, Ok }
<cell> = { inner: { phase: P.Idle } }
<match for=P on=@cell.inner.phase><Idle><p data-arm="idle">IDLE</p></Idle><Ok><p data-arm="ok">OK</p></Ok></match>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-giti-031");

function compileToOutputs(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(
      outDir,
      result.runtimeFilename ?? "scrml-runtime.js",
    );
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath)
        ? readFileSync(runtimePath, "utf8")
        : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Targeted emit-regression (FAILS pre-fix, PASSES post-fix)
// ---------------------------------------------------------------------------

describe("GITI-031 §1 — match on=@cell.state emit reads the sub-path, not the whole cell", () => {
  test("compile succeeds with no errors", () => {
    const { errors } = compileToOutputs(SRC);
    expect(errors).toEqual([]);
  });

  test("the subscribe trigger applies the .state sub-path to the callback arg", () => {
    const { clientJs } = compileToOutputs(SRC);
    // Post-fix: `_scrml_reactive_subscribe("cell", function(_cv) { <dispatch>((_cv).state); })`
    expect(clientJs).toMatch(
      /_scrml_reactive_subscribe\("cell",\s*function\(_cv\)\s*\{\s*__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\(\(_cv\)\.state\);\s*\}\)/,
    );
  });

  test("the DOMContentLoaded init-fire reads the .state sub-path", () => {
    const { clientJs } = compileToOutputs(SRC);
    // Post-fix: `<dispatch>(_scrml_reactive_get("cell").state)`
    expect(clientJs).toMatch(
      /__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\(_scrml_reactive_get\("cell"\)\.state\)/,
    );
  });

  test("the dispatch does NOT pass the whole cell value (the bug shape is gone)", () => {
    const { clientJs } = compileToOutputs(SRC);
    // Pre-fix BOTH the subscribe trigger and the init-fire passed the whole
    // cell. The subscribe passed the dispatch fn directly (so the callback got
    // the whole cell), and the init-fire read `_scrml_reactive_get("cell")`
    // with no sub-path.
    expect(clientJs).not.toMatch(
      /_scrml_reactive_subscribe\("cell",\s*__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\)/,
    );
    expect(clientJs).not.toMatch(
      /__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\(_scrml_reactive_get\("cell"\)\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive: initial seed renders + reactive sub-path write
// ---------------------------------------------------------------------------

describe("GITI-031 §2 — match on=@cell.state renders the correct arm at runtime", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source = SRC) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      arm: (key) => document.querySelector(`[data-arm="${key}"]`),
    };
  }

  test("mounting does NOT throw", () => {
    expect(() => mount()).not.toThrow();
  });

  test("initial seed variant (.Idle) renders the Idle arm into the mount", () => {
    const app = mount();
    // The bug left the mount BLANK on the initial seed because the dispatcher
    // received the whole `{state, n}` struct (no `.variant`) -> matched no arm.
    expect(app.arm("idle")).not.toBeNull();
    expect(app.arm("idle").textContent).toBe("IDLE");
    expect(app.arm("ok")).toBeNull();
  });

  test("a reactive sub-path write (state -> .Ok) re-dispatches to the Ok arm", () => {
    const app = mount();
    // Write a new whole-cell value that flips the sub-path variant. The
    // subscriber fires with the new whole cell; the GITI-031 wrapper applies
    // `.state` so the dispatcher sees "Ok".
    app.set("cell", { state: "Ok", n: 1 });
    expect(app.arm("ok")).not.toBeNull();
    expect(app.arm("ok").textContent).toBe("OK");
    expect(app.arm("idle")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3 — deeper sub-path `on=@cell.inner.phase`
// ---------------------------------------------------------------------------

describe("GITI-031 §3 — match on=@cell.inner.phase (deep sub-path)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mountDeep() {
    const { html, clientJs, runtimeJs } = compileToOutputs(SRC_DEEP);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      arm: (key) => document.querySelector(`[data-arm="${key}"]`),
    };
  }

  test("emit reads the full .inner.phase sub-path in both trigger paths", () => {
    const { clientJs } = compileToOutputs(SRC_DEEP);
    expect(clientJs).toMatch(
      /_scrml_reactive_subscribe\("cell",\s*function\(_cv\)\s*\{\s*__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\(\(_cv\)\.inner\.phase\);\s*\}\)/,
    );
    expect(clientJs).toMatch(
      /__scrml_match_match_[0-9a-z]{8}_\d+_dispatch\(_scrml_reactive_get\("cell"\)\.inner\.phase\)/,
    );
  });

  test("initial seed variant renders + a deep reactive write re-dispatches", () => {
    const app = mountDeep();
    expect(app.arm("idle")).not.toBeNull();
    expect(app.arm("idle").textContent).toBe("IDLE");

    app.set("cell", { inner: { phase: "Ok" } });
    expect(app.arm("ok")).not.toBeNull();
    expect(app.arm("ok").textContent).toBe("OK");
    expect(app.arm("idle")).toBeNull();
  });
});
