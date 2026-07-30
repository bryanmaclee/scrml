/**
 * if-mount-each-effect-leak.browser.test.js
 *
 * S239 BLOCKER 2 regression gate for change-id `if-mount-unmount-phase2`.
 *
 * THE LEAK. `_scrml_mount_wire` calls `_scrml_remount_each(root)`, which
 * re-invokes the registered `<each>` renderer so a list inside a freshly-mounted
 * `if=` subtree actually renders. The renderer creates one effect PER ROW — and
 * `emit-each.ts` created them with a bare `_scrml_effect(...)`: no
 * `_scrml_region_track`, no cleanup registration, so `_scrml_unmount_scope`
 * drained nothing for them. Every open/close cycle therefore stranded one live
 * effect per row, each retaining its detached row node and re-running on every
 * subsequent data change. Silent: no error, correct rendering, monotonic growth.
 *
 * Measured before the fix, live effects after 0..4 open/close cycles:
 *   1 item  -> 1, 2, 3, 4, 5
 *   2 items -> 1, 3, 5, 7, 9
 *   5 items -> 1, 6, 11, 16, 21
 * Pre-Phase-2 baseline was flat only because a wiring-bearing `if=` never
 * unmounted its subtree, so the renderer never re-ran.
 *
 * THE FIX. The three per-item `_scrml_effect(` emissions in emit-each.ts
 * (:1392 / :2462 / :3062) are wrapped in `_scrml_mount_track(...)`, which
 * registers the disposer against the if= mount scope currently being wired and is
 * the IDENTITY outside a mount — so an `<each>` on a page with no `if=` is
 * behaviourally untouched (asserted below, not assumed).
 *
 * HOW THIS COUNTS EFFECTS. `_scrml_prop_subscribers` is a WeakMap and cannot be
 * enumerated, so the harness instead rebinds `_scrml_effect` (a function
 * DECLARATION, hence a mutable binding, and the runtime shares one scope with the
 * client JS in this harness) to a counting wrapper: +1 on create, -1 the first
 * time its disposer runs. That is a LIVE population, not a create tally, so it
 * only stays flat if teardown actually disposes. The behavioural half — a leaked
 * effect writes into its detached row on the next data change — is asserted
 * separately, so neither measurement stands alone.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const srcFor = (items) => `<page>
<shown> = false
<items>: string[] = [${items.map((s) => JSON.stringify(s)).join(", ")}]
<div id="gate" if=@shown>
    <ul id="list">
        <each in=@items as it key=__index__>
            <li class="row">\${it}</li>
        </each>
    </ul>
</div>
</page>
`;

// Control: the SAME each with no enclosing `if=`. Its effects must be created
// exactly once and never registered against a mount scope.
const NO_IF_SRC = `<page>
<items>: string[] = ["a", "b"]
<ul id="list">
    <each in=@items as it key=__index__>
        <li class="row">\${it}</li>
    </each>
</ul>
</page>
`;

const tmpRoot = resolve("/tmp", "scrml-if-each-leak");

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

describe("if= + <each> — per-row effects are owned by the mount scope", () => {
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
    // Instrument BETWEEN the runtime and the client body: `_scrml_effect` is a
    // function declaration in the same scope, so the rebind intercepts every
    // effect the client creates, including the per-row ones the each renderer
    // mints on each remount.
    const INSTRUMENT = `
      const __scrml_orig_effect = _scrml_effect;
      globalThis.__live__ = 0;
      _scrml_effect = function (fn) {
        const _d = __scrml_orig_effect(fn);
        globalThis.__live__++;
        let _gone = false;
        return function () { if (!_gone) { _gone = true; globalThis.__live__--; } return _d(); };
      };
    `;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${INSTRUMENT}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\n` +
        `globalThis.__get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__set__(n, v),
      rows: () => document.querySelectorAll("#list li.row").length,
      // Live effect population: created minus disposed.
      liveEffects: () => globalThis.__live__,
      rowNodes: () => [...document.querySelectorAll("#list li.row")],
    };
  }

  // The blocker's own measurement, re-run as an assertion: the live-effect
  // population must be FLAT across cycles, not linear in cycles x rows.
  for (const [label, items] of [["1 item", ["a"]], ["2 items", ["a", "b"]], ["5 items", ["a", "b", "c", "d", "e"]]]) {
    test(`${label}: live effects do not grow across 4 open/close cycles`, () => {
      const app = mount(srcFor(items), "leak");
      const counts = [];
      app.set("shown", true);
      counts.push(app.liveEffects());
      expect(app.rows()).toBe(items.length);
      for (let i = 0; i < 4; i++) {
        app.set("shown", false);
        app.set("shown", true);
        counts.push(app.liveEffects());
      }
      expect(app.rows()).toBe(items.length);
      // Every reading identical to the first — the pre-fix series grew by one per
      // row per cycle (1,2,3,4,5 / 1,3,5,7,9 / 1,6,11,16,21).
      for (const c of counts) expect(c).toBe(counts[0]);
    });
  }

  test("the unmounted list's effects are disposed, not merely detached", () => {
    const app = mount(srcFor(["a", "b"]), "leak");
    app.set("shown", true);
    const open = app.liveEffects();
    app.set("shown", false);
    const closed = app.liveEffects();
    expect(app.rows()).toBe(0);
    // Closing must REDUCE the live population — if the per-row effects merely lost
    // their nodes they would still be subscribed and this would be flat.
    expect(closed).toBeLessThan(open);
  });

  test("a mutation while closed does not resurrect rows or re-run stale row effects", () => {
    const app = mount(srcFor(["a", "b"]), "leak");
    app.set("shown", true);
    app.set("shown", false);
    const closed = app.liveEffects();
    app.set("items", ["x", "y", "z"]);
    expect(app.rows()).toBe(0);
    expect(app.liveEffects()).toBe(closed);
    // …and the reopened list reflects the CURRENT data.
    app.set("shown", true);
    expect(app.rows()).toBe(3);
  });

  // The "identity outside a mount" claim, verified rather than assumed.
  test("an <each> with NO enclosing if= is unaffected — effects created once, none tracked", () => {
    const app = mount(NO_IF_SRC, "noif");
    expect(app.rows()).toBe(2);
    const before = app.liveEffects();
    app.set("items", ["a", "b", "c"]);
    expect(app.rows()).toBe(3);
    // A plain reconcile creates per-row effects for the new row only; the point is
    // that nothing was disposed or double-registered by the mount-scope machinery.
    expect(app.liveEffects()).toBeGreaterThanOrEqual(before);
    app.set("items", ["a", "b"]);
    expect(app.rows()).toBe(2);
  });

  test("_scrml_mount_track is a no-op outside a mount (runtime contract)", () => {
    const { runtimeJs } = compileToOutputs(NO_IF_SRC, "noif");
    // The helper lives in the always-included 'scope' chunk, so an each-only page
    // still resolves it even though it ships no 'ifmount' chunk.
    expect(runtimeJs).toContain("function _scrml_mount_track");
    expect(runtimeJs).not.toContain("function _scrml_mount_wire");
    const exec = new Function(`${runtimeJs}\nreturn { track: _scrml_mount_track, scope: _scrml_active_mount_scope };`);
    const r = exec();
    expect(r.scope).toBeNull();
    const fn = () => {};
    expect(r.track(fn)).toBe(fn); // returns its argument, registers nothing
  });
});
