/**
 * if-mount-dispatched-mount.browser.test.js
 *
 * Regression gate for [[g-dispatched-mount-inside-if-never-renders]] (S301).
 *
 * THE DEFECT. A `<match>` block-form / `<engine>` dispatcher resolves its mount
 * ONCE, at module level, with `document.querySelector('[data-scrml-*-mount="id"]')`
 * and returns early when it is absent. Inside a §17.1 `if=` subtree the mount
 * begins life in a `<template>`, so that lookup finds nothing — and nothing
 * re-dispatched when the subtree later mounted. The dispatched block stayed empty
 * forever, with no diagnostic.
 *
 * It was a REGRESSION, not a pre-existing gap: before Phase 2 a wiring-bearing
 * `if=` display-toggled, so its mount stayed in the live DOM and the initial
 * `querySelector` found it. Found in our OWN flagship app —
 * `examples/23-trucking-dispatch/pages/driver/hos.scrml`, an `<engine>` under
 * `<div if=(@loaded && @currentDriver)>`.
 *
 * THE FIX mirrors S153's `<each>` remount exactly: each dispatcher registers a
 * remount thunk keyed by its mount id (`_scrml_register_dispatch_remount`), and
 * `_scrml_mount_wire` walks a freshly mounted subtree calling them
 * (`_scrml_remount_dispatch`). The walk is SELF-INCLUSIVE because the anchor may
 * BE the mounted root, which `querySelectorAll` never matches — the same blind
 * spot that made `_scrml_self_scope` necessary for the mount-time re-bind.
 *
 * WHY REPEATED DISPATCH IS SAFE — and why this file asserts it rather than
 * assuming it. The documented trap for the sibling gap is that re-running wiring
 * can double-attach non-delegable handlers (different function objects, so
 * `addEventListener` does not dedupe) and leak a controller per dispatch, and
 * that NEITHER shows up in a test that only checks the content renders. The
 * dispatcher escapes that only because it disposes the previous arm's wiring
 * before re-rendering. §4 pins that: a handler fires exactly once, and the live
 * effect population is flat across repeated toggles.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// A dispatched <match> under an if=, with a non-delegable handler and an
// interpolation inside the arm so §4 can measure both hazards.
const MATCH_UNDER_IF = `<page>
    \${
        type Phase:enum = { Idle, Ready }
        <phase>: Phase = .Ready
        <label> = "L"
        <gateOn> = false
        <inputs> = 0
        function bumpInput() {
            @inputs = @inputs + 1
        }
    }
    <div id="gate" if=@gateOn>
        <match for=Phase on=@phase>
            <Idle><p id="body">idle</p></>
            <Ready><p id="body" oninput=bumpInput()>R:\${@label}</p></>
        </match>
    </div>
</page>
`;

// Seed-true variant — the mount happens inside _scrml_boot's own nav_rewire pass.
const MATCH_UNDER_IF_OPEN = MATCH_UNDER_IF.replace("<gateOn> = false", "<gateOn> = true");

const tmpRoot = resolve("/tmp", "scrml-dispatched-mount");

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
      errors: (result.errors ?? []).map((e) => e.code ?? String(e)),
      html: read(resolve(outDir, `${baseName}.html`)),
      clientJs: read(resolve(outDir, `${baseName}.client.js`)),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("a dispatched mount inside an if= subtree", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName, instrument = false) {
    const { html, clientJs, runtimeJs, errors } = compileToOutputs(source, baseName);
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const INSTRUMENT = instrument ? `
      const __o = _scrml_effect;
      globalThis.__live__ = 0;
      _scrml_effect = function (fn) {
        const _d = __o(fn); globalThis.__live__++; let _g = false;
        return function () { if (!_g) { _g = true; globalThis.__live__--; } return _d(); };
      };` : "";
    const exec = new Function("window", "document",
      `${runtimeJs}\n${INSTRUMENT}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\nglobalThis.__get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__set__(n, v),
      get: (n) => globalThis.__get__(n),
      c: (sel) => document.querySelectorAll(sel).length,
      t: (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; },
      live: () => globalThis.__live__,
      fire: (sel, type) => document.querySelector(sel).dispatchEvent(new Event(type, { bubbles: true })),
    };
  }

  // §1 — the defect itself, both orders.
  test("§1 false->true: the dispatched arm renders after the if= mounts", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    expect(app.c("#gate")).toBe(0);
    expect(app.c("#body")).toBe(0);
    app.set("gateOn", true);
    expect(app.c("#gate")).toBe(1);
    expect(app.c("#body")).toBe(1);   // pre-fix: 0, forever
    expect(app.t("#body")).toBe("R:L");
  });

  test("§1 seed-true: the dispatched arm renders on first paint", () => {
    const app = mount(MATCH_UNDER_IF_OPEN, "mo");
    expect(app.c("#body")).toBe(1);
    expect(app.t("#body")).toBe("R:L");
  });

  // §2 — the mounted arm must be LIVE, not just present.
  test("§2 the arm's interpolation is live after the remount-dispatch", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    app.set("gateOn", true);
    expect(app.t("#body")).toBe("R:L");
    app.set("label", "CHANGED");
    expect(app.t("#body")).toBe("R:CHANGED");
  });

  test("§2 switching arms after the if= mounted still works", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    app.set("gateOn", true);
    app.set("phase", "Idle");
    expect(app.t("#body")).toBe("idle");
    app.set("phase", "Ready");
    expect(app.t("#body")).toBe("R:L");
  });

  test("§2 a remount re-reads the CURRENT variant and cell", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    app.set("gateOn", true);
    app.set("gateOn", false);
    app.set("phase", "Idle");
    app.set("label", "L2");
    app.set("gateOn", true);
    expect(app.t("#body")).toBe("idle");
    app.set("phase", "Ready");
    expect(app.t("#body")).toBe("R:L2");
  });

  // §3 — the self-inclusive walk, asserted as a RUNTIME CONTRACT.
  //
  // HONEST SCOPE NOTE. I could not construct a scrml source shape where the mount
  // anchor IS the mounted root: `emit-variant-guard` always emits the anchor as a
  // generated `<div data-scrml-*-mount="…"></div>` nested inside whatever the
  // author wrote, so today it is always a DESCENDANT and a plain
  // `querySelectorAll` would suffice. The self-inclusive branch is therefore
  // DEFENSIVE, not load-bearing at this commit — it exists because
  // `querySelectorAll` silently never matches its own root, which is exactly the
  // blind spot that made `_scrml_self_scope` necessary for the mount-time re-bind,
  // and because "the anchor is always nested" is an emitter detail that could
  // change without anyone thinking about this walk. Pinned at the helper's own
  // contract so it cannot regress unnoticed and so the claim is not overstated.
  test("§3 _scrml_remount_dispatch fires for an anchor ON the root, not just under it", () => {
    const { runtimeJs } = compileToOutputs(MATCH_UNDER_IF, "m");
    const exec = new Function("document", `${runtimeJs}
      let onRoot = 0, underRoot = 0;
      _scrml_register_dispatch_remount("on-root", function () { onRoot++; });
      _scrml_register_dispatch_remount("under-root", function () { underRoot++; });
      const host = document.createElement("div");
      host.setAttribute("data-scrml-match-mount", "on-root");
      const kid = document.createElement("div");
      kid.setAttribute("data-scrml-engine-mount", "under-root");
      host.appendChild(kid);
      _scrml_remount_dispatch(host);
      return { onRoot, underRoot };`);
    const r = exec(document);
    expect(r.underRoot).toBe(1);
    expect(r.onRoot).toBe(1); // a bare querySelectorAll would leave this 0
  });

  test("§3 an unregistered anchor is ignored, and each id fires at most once", () => {
    const { runtimeJs } = compileToOutputs(MATCH_UNDER_IF, "m");
    const exec = new Function("document", `${runtimeJs}
      let hits = 0;
      _scrml_register_dispatch_remount("known", function () { hits++; });
      const host = document.createElement("div");
      const a = document.createElement("div");
      a.setAttribute("data-scrml-match-mount", "known");
      const b = document.createElement("div");
      b.setAttribute("data-scrml-match-mount", "known");
      const c = document.createElement("div");
      c.setAttribute("data-scrml-match-mount", "never-registered");
      host.appendChild(a); host.appendChild(b); host.appendChild(c);
      _scrml_remount_dispatch(host);
      return hits;`);
    // Deduped by id, and an unknown id is a silent no-op rather than a throw.
    expect(exec(document)).toBe(1);
  });

  // §4 — the documented trap, asserted rather than assumed.
  test("§4 a non-delegable handler in the arm fires exactly ONCE per event", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    app.set("gateOn", true);
    app.fire("#body", "input");
    expect(app.get("inputs")).toBe(1);
  });

  test("§4 …and still exactly once after repeated toggle cycles (no double-attach)", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    for (let i = 0; i < 5; i++) {
      app.set("gateOn", true);
      app.set("gateOn", false);
    }
    app.set("gateOn", true);
    app.fire("#body", "input");
    // Pre-dispose-per-dispatch this would have been 6.
    expect(app.get("inputs")).toBe(1);
  });

  test("§4 the live effect population is FLAT across repeated toggles (no leak)", () => {
    const app = mount(MATCH_UNDER_IF, "m", true);
    const counts = [];
    app.set("gateOn", true);
    counts.push(app.live());
    for (let i = 0; i < 4; i++) {
      app.set("gateOn", false);
      app.set("gateOn", true);
      counts.push(app.live());
    }
    expect(app.c("#body")).toBe(1);
    for (const c of counts) expect(c).toBe(counts[0]);
  });

  test("§4 exactly one #body exists after many cycles (no accumulation)", () => {
    const app = mount(MATCH_UNDER_IF, "m");
    for (let i = 0; i < 5; i++) {
      app.set("gateOn", true);
      app.set("gateOn", false);
    }
    app.set("gateOn", true);
    expect(app.c("#body")).toBe(1);
    expect(app.c("#gate")).toBe(1);
  });

  // §5 — runtime minimality: a page with a dispatcher but no if= pays nothing.
  test("§5 a page with a <match> and NO if= ships no remount registry", () => {
    const { clientJs, runtimeJs } = compileToOutputs(`<page>
    \${
        type Phase:enum = { Idle, Ready }
        <phase>: Phase = .Ready
    }
    <match for=Phase on=@phase>
        <Idle><p id="body">idle</p></>
        <Ready><p id="body">ready</p></>
    </match>
</page>
`, "noif");
    expect(runtimeJs).not.toContain("function _scrml_remount_dispatch");
    // The emitted registration is typeof-guarded, so it is inert without the chunk.
    expect(clientJs).toContain('typeof _scrml_register_dispatch_remount === "function"');
  });
});
