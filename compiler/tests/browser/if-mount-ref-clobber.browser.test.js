/**
 * if-mount-ref-clobber.browser.test.js
 *
 * S239 BLOCKER 1 regression gate for change-id `if-mount-unmount-phase2`.
 *
 * THE CLOBBER. `emitBindings`' output became a root-scoped
 * `_scrml_bind_rewire(root)` so a freshly-mounted `if=` subtree can have its
 * `bind:` / `class:` / `ref=` wiring bound. Every block in that body guards with
 * `if (elem) { … }` — except `ref=`, which wrote unconditionally:
 *
 *     _scrml_reactive_set("chartEl", (root || document).querySelector('[data-scrml-ref="chartEl"]'));
 *
 * Re-invoked with a mounted subtree as its scope, EVERY ref= that lives outside
 * that subtree resolves `null`, and the unguarded write stores it. So mounting any
 * `if=` anywhere in the file blanked every unrelated ref= on the page. Worse with
 * the predicate true at boot: the mount runs inside `_scrml_nav_rewire(document)`
 * during `_scrml_boot`, so the ref was absent BEFORE FIRST PAINT.
 *
 * Two assertions here, because the guard alone is only half the lifecycle:
 *   §1 an OUTSIDE ref= survives any number of mounts (the blocker);
 *   §2 an INSIDE ref= is reset to absence when its subtree unmounts, instead of
 *      retaining a detached node an adopter would write through (follow-up 2).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// `outsideEl` is declared OUTSIDE the gated subtree; `insideEl` INSIDE it.
// `@shown` seeds false so §1 can also cover the boot-time-true variant below.
const SRC = `<page>
<shown> = false
<label> = "alpha"
<outsideEl> = not
<insideEl> = not
<canvas id="chart" ref=@outsideEl></canvas>
<div id="gate" if=@shown>
    <span id="inner" ref=@insideEl>\${@label}</span>
</div>
</page>
`;

// Same shape, predicate TRUE at seed — the pre-first-paint variant.
const SRC_OPEN = SRC.replace("<shown> = false", "<shown> = true");

const tmpRoot = resolve("/tmp", "scrml-if-ref-clobber");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, `${baseName}.html`)),
      clientJs: read(resolve(outDir, `${baseName}.client.js`)),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("if= mount does not clobber ref= cells", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs, errors } = compileToOutputs(source, baseName);
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\n` +
        `globalThis.__get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__set__(n, v),
      get: (n) => globalThis.__get__(n),
    };
  }

  // §1 -----------------------------------------------------------------------
  test("§1 a ref= OUTSIDE the gated subtree survives boot", () => {
    const app = mount(SRC, "ref");
    const el = app.get("outsideEl");
    expect(el).not.toBeNull();
    expect(el.tagName).toBe("CANVAS");
    expect(el.id).toBe("chart");
  });

  test("§1 THE BLOCKER — the outside ref= survives an if= mount", () => {
    const app = mount(SRC, "ref");
    const before = app.get("outsideEl");
    expect(before).not.toBeNull();
    app.set("shown", true);
    // Pre-fix this read NULL: the mount re-ran _scrml_bind_rewire scoped to the
    // mounted subtree, where `[data-scrml-ref="outsideEl"]` does not resolve.
    expect(app.get("outsideEl")).toBe(before);
  });

  test("§1 the outside ref= survives repeated mount/unmount cycles", () => {
    const app = mount(SRC, "ref");
    const before = app.get("outsideEl");
    for (let i = 0; i < 4; i++) {
      app.set("shown", true);
      app.set("shown", false);
    }
    expect(app.get("outsideEl")).toBe(before);
  });

  test("§1 predicate TRUE at seed — the ref is live before first paint", () => {
    // The mount runs inside _scrml_nav_rewire(document) during _scrml_boot, so a
    // clobber here would land before anything is painted.
    const app = mount(SRC_OPEN, "refopen");
    const el = app.get("outsideEl");
    expect(el).not.toBeNull();
    expect(el.tagName).toBe("CANVAS");
  });

  // §2 -----------------------------------------------------------------------
  test("§2 a ref= INSIDE the subtree is absent before mount, live after", () => {
    const app = mount(SRC, "ref");
    expect(app.get("insideEl")).toBeNull();
    app.set("shown", true);
    const el = app.get("insideEl");
    expect(el).not.toBeNull();
    expect(el.id).toBe("inner");
    expect(el.isConnected).toBe(true);
  });

  test("§2 the inside ref= is reset to absence on unmount, not left detached", () => {
    const app = mount(SRC, "ref");
    app.set("shown", true);
    expect(app.get("insideEl")).not.toBeNull();
    app.set("shown", false);
    // Pre-fix this retained a node with isConnected === false — an adopter writing
    // through the ref would mutate a node that is not in the document.
    expect(app.get("insideEl")).toBeNull();
  });

  test("§2 a remount re-points the inside ref= at the NEW node", () => {
    const app = mount(SRC, "ref");
    app.set("shown", true);
    const first = app.get("insideEl");
    app.set("shown", false);
    app.set("shown", true);
    const second = app.get("insideEl");
    expect(second).not.toBeNull();
    expect(second.isConnected).toBe(true);
    // A fresh clone each mount — the ref must not still point at the old node.
    expect(second).not.toBe(first);
  });
});
