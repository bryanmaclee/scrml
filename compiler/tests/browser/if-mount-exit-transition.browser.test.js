/**
 * if-mount-exit-transition.browser.test.js
 *
 * S239 FOLLOW-UP 1 regression gate for change-id `if-mount-unmount-phase2`.
 *
 * `transition:` / `out:` on an `if=` element is NEWLY REACHABLE. Before Phase 2,
 * `attrIsWiringFree` rejected those directives, so a transition-bearing `if=`
 * could never take the mount path at all — it display-toggled. Now it mounts, and
 * the exit animation has to defer the REMOVAL rather than the hiding, which
 * introduces two failure modes the display lowering did not have:
 *
 *   STRANDING. The controller detaches `_mr_`/`_ms_` before waiting on
 *   `animationend` so a re-true transition mounts a fresh node instead of
 *   adopting the outgoing one. Without a single-pending-exit slot,
 *   false->true->false at speed leaves N copies on screen at once. The display
 *   lowering could strand at most one, because it reused the same element.
 *
 *   NEVER REMOVED. If `animationend` never fires — an adopter overrode the
 *   transition CSS, the transitions chunk is absent, the tab was backgrounded —
 *   the node stays in the DOM and VISIBLE forever, violating §17.1 outright
 *   ("It does not exist in the DOM"). The display lowering had the same reliance
 *   but had already applied display:none, so its failure was invisible. A
 *   backstop timer at 2x the longest injected transition (300ms) guarantees
 *   removal; `animationend` wins the race normally and clears it.
 *
 * happy-dom fires no CSS animations, so `animationend` never arrives here — which
 * makes this harness the pessimal case, and exactly the one that must still
 * terminate.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const SRC = `<page>
<shown> = false
<p id="fading" if=@shown out:fade>Fading content</p>
</page>
`;

const tmpRoot = resolve("/tmp", "scrml-if-exit-transition");

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

describe("if= with an exit transition", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs, errors } = compileToOutputs(SRC, "tr");
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__set__(n, v),
      count: () => document.querySelectorAll("#fading").length,
      exiting: () => document.querySelectorAll("#fading.scrml-exit-fade").length,
    };
  }

  test("it takes the mount path and still carries the exit class", () => {
    const app = mount();
    expect(app.count()).toBe(0);
    app.set("shown", true);
    expect(app.count()).toBe(1);
    app.set("shown", false);
    // Still present — the removal is deferred so the animation can run — and it
    // is marked as exiting. §17.4 is preserved: `if=` animates on the way out.
    expect(app.count()).toBe(1);
    expect(app.exiting()).toBe(1);
  });

  test("THE STRAND — rapid false->true->false never leaves more than one copy", () => {
    const app = mount();
    for (let i = 0; i < 6; i++) {
      app.set("shown", true);
      app.set("shown", false);
    }
    // Pre-fix this was 6: every unmount stranded its node awaiting an
    // `animationend` that never came, and every mount added a fresh one.
    expect(app.count()).toBe(1);
    app.set("shown", true);
    // Mounting finalises the in-flight exit first, so the live node is the only one.
    expect(app.count()).toBe(1);
    expect(app.exiting()).toBe(0);
  });

  test("a mount during the exit adopts NOTHING stale — the visible node is the fresh one", () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    expect(app.exiting()).toBe(1);
    app.set("shown", true);
    expect(app.count()).toBe(1);
    // The surviving node must not be the one that was on its way out.
    expect(app.exiting()).toBe(0);
  });

  test("NEVER REMOVED — the backstop timer removes the node when animationend never fires", async () => {
    const app = mount();
    app.set("shown", true);
    app.set("shown", false);
    expect(app.count()).toBe(1); // deferred, awaiting the animation
    // happy-dom fires no animations, so only the backstop can finish this.
    await new Promise((r) => setTimeout(r, 700));
    expect(app.count()).toBe(0); // §17.1 — it does not exist in the DOM
  });

  test("no exit transition = synchronous removal (the common path is unchanged)", () => {
    const { clientJs } = compileToOutputs(`<page>
<shown> = false
<p id="plain" if=@shown>plain</p>
</page>
`, "plain");
    // The pending-exit machinery is emitted ONLY for a transition-bearing if=.
    expect(clientJs).not.toContain("_scrml_pend_");
    expect(clientJs).not.toContain("_scrml_if_endexit_");
    expect(clientJs).toContain("_scrml_unmount_scope(_scrml_mr_");
  });
});
