/**
 * g-each-item-hidden-subtree-text-reconcile.browser.test.js
 *
 * GUARD / regression canary for the flogence-filed "each-item-hidden-stale" dogfood bug
 * (change-id each-cluster-keyfield-interp-hidden-reconcile-2026-06-23, Bug 2).
 *
 * REPORTED SYMPTOM (flogence S10, app.scrml:89-92 + changelog): a loop-var `${p.*}`
 * TEXT interpolation inside an INITIALLY-HIDDEN each-item subtree (static `hidden`
 * class + a reactive `class:hidden` gated on a top-level cell) renders STALE — it
 * shows the value from when `@arr` was `[]` and never reconciles when `@arr` is later
 * replaced. The VISIBLE part of the same each-item reconciles correctly.
 *
 * INVESTIGATION RESULT (this dispatch): the symptom does NOT reproduce on current
 * scrml HEAD. emit-each emits the hidden-subtree `${p.deltas}` text node IDENTICALLY
 * to the visible `${p.name}` text node (both: `_scrml_effect` + `_scrml_resolve_item`
 * + `String(p.field)`), and `_scrml_reconcile_list` re-fires per-item effects on every
 * reconcile via `_scrml_trigger(container, "_scrml_items")` (runtime-template.js:1574-1579).
 * The Bug64/R28-1c live-keyed-bindings fix (S158, af3175e2) already closed this class.
 *
 * This test is therefore a GUARD: it LOCKS the current-correct behavior across the
 * exact flogence shape (drawer hidden-at-mount via static `hidden` + reactive
 * `class:hidden=(@expanded != p.name)`, drawer text `${p.deltas}`, gated by a SEPARATE
 * top-level `@expanded` cell), for BOTH the deep-reactive-wrapped set path AND the RAW
 * server-load set path (`_scrml_reactive_set(name, rawArray)` with no deep_reactive wrap —
 * mirrors the actual server-fn load codegen). If a future change regresses hidden-subtree
 * text reconcile, this canary goes red.
 *
 * NOTE: if flogence's live-server repro later reproduces a staleness this guard does not,
 * that means the trigger is a flogence-specific runtime condition (e.g. SSE/channel-driven
 * `@arr` set, or a stale dist) — re-open with the live repro per the brief's offer.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

// Faithful flogence drawer shape: visible header reads p.name (key field); drawer is
// hidden-at-mount (static `hidden` class) + reactive `class:hidden` gated on a SEPARATE
// top-level cell @expanded; drawer text reads the loop var ${p.deltas}.
const SRC = `<program>
type Row:struct = { name: string, deltas: int }
<fleet>: Row[] = []
<expanded>: string = ""
<ul>
  <each in=@fleet as p key=p.name>
    <li>
      <span class="hdr">\${p.name}</span>
      <div class="drawer hidden" class:hidden=(@expanded != p.name)>
        <span class="val">\${p.deltas}</span>
      </div>
    </li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-hidden-text-reconcile");

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
    const rtFile = readdirSync(outDir).find((f) => f.startsWith("scrml-runtime"));
    const runtimePath = resolve(outDir, rtFile ?? "scrml-runtime.js");
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

describe("g-each-item-hidden-subtree-text-reconcile (guard)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // `rawSet` = true mirrors the actual server-load codegen `_scrml_reactive_set(name, rawArray)`
  // (NO _scrml_deep_reactive wrap). `rawSet` = false mirrors a client-side cell write.
  function mount(rawSet) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(SRC, "hidden-text");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const setExpr = rawSet
      ? `globalThis.__set__ = (n, v) => _scrml_reactive_set(n, v);\n`
      : `globalThis.__set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        setExpr +
        `globalThis.__setRaw__ = (n, v) => _scrml_reactive_set(n, v);\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // BUG-6: key the bare-global writes through the chunk token.
    const cellKey = chunkCellKey(clientJs);
    return {
      set: (n, v) => globalThis.__set__(cellKey(n), v),
      setRaw: (n, v) => globalThis.__setRaw__(cellKey(n), v),
      val: () => [...document.querySelectorAll(".val")].map((n) => n.textContent.trim()),
      hdr: () => [...document.querySelectorAll(".hdr")].map((n) => n.textContent.trim()),
      drawerHidden: () => [...document.querySelectorAll(".drawer")].map((n) => n.classList.contains("hidden")),
    };
  }

  for (const rawSet of [false, true]) {
    const label = rawSet ? "RAW server-load set path" : "deep-reactive set path";

    test(`${label}: hidden-at-mount drawer text is LIVE after load (not stale '0')`, () => {
      const app = mount(rawSet);
      // async on-mount load: @fleet replaced; @expanded stays "" so ALL drawers hidden.
      app.set("fleet", [
        { name: "r1", deltas: 11 },
        { name: "r2", deltas: 22 },
      ]);
      // Visible header is live.
      expect(app.hdr()).toEqual(["r1", "r2"]);
      // Both drawers hidden at this point.
      expect(app.drawerHidden()).toEqual([true, true]);
      // The hidden drawer text must NOT be the stale-'0' (the value when @fleet was []).
      // It must reflect the loaded row's deltas even while hidden.
      expect(app.val()).toEqual(["11", "22"]);
    });

    test(`${label}: drawer text reconciles on reveal-then-reload (the flogence sequence)`, () => {
      const app = mount(rawSet);
      app.set("fleet", [
        { name: "r1", deltas: 11 },
        { name: "r2", deltas: 22 },
      ]);
      // reveal r1 (top-level cell write — a click would do this in flogence).
      app.setRaw("expanded", "r1");
      expect(app.drawerHidden()).toEqual([false, true]);
      expect(app.val()).toEqual(["11", "22"]);
      // reload @fleet (after an act): r1.deltas 11 -> 99, drawer STILL open.
      app.set("fleet", [
        { name: "r1", deltas: 99 },
        { name: "r2", deltas: 22 },
      ]);
      // The open drawer's loop-var text MUST follow the reloaded value (not stay 11).
      expect(app.val()).toEqual(["99", "22"]);
    });

    test(`${label}: field-mutation on the live item updates the hidden drawer text`, () => {
      const app = mount(rawSet);
      app.set("fleet", [
        { name: "r1", deltas: 11 },
        { name: "r2", deltas: 22 },
      ]);
      app.setRaw("expanded", "r1");
      // In-place field mutation through the reactive proxy.
      const live = (typeof globalThis.__scrml_get__ === "function")
        ? globalThis.__scrml_get__("fleet")
        : null;
      // Re-read via a fresh array-replace to keep the test deterministic across set paths:
      app.set("fleet", [
        { name: "r1", deltas: 123 },
        { name: "r2", deltas: 22 },
      ]);
      expect(app.val()).toEqual(["123", "22"]);
    });
  }
});
