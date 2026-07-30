/**
 * flagship-hos-engine-under-if.browser.test.js
 *
 * THE acceptance test for [[g-dispatched-mount-inside-if-never-renders]] (S301):
 * the real page the defect was found in, executed — not a synthetic fixture.
 *
 * `examples/23-trucking-dispatch/pages/driver/hos.scrml` has
 *
 *     <div if=(@loaded && @currentDriver) …>
 *         …
 *         <engine for=DriverStatus server=@currentDriver.current_status initial=.OffDuty>
 *             <OffDuty …><span …>Off duty</span></>
 *             <OnDuty  …><span …>On duty</span></>
 *             …
 *
 * i.e. an `<engine>` whose dispatched mount sits inside an `if=` subtree. Once
 * §17.1 `if=` began mounting through a `<template>`, the engine's module-level
 * `document.querySelector('[data-scrml-engine-mount="…"]')` found nothing and
 * nothing re-dispatched when the subtree mounted — the badge never rendered, with
 * no diagnostic. It is a REGRESSION: pre-Phase-2 that `if=` display-toggled, so
 * the mount stayed in the live DOM.
 *
 * Why the page and not a fixture: the defect was found by scanning EMITTED
 * ARTIFACTS of this app, and a synthetic reproduction would not prove the thing
 * actually found. This boots the shipped `hos.client.js` as-is.
 *
 * NOTE ON THE ARTIFACT SCAN. The scan that found this ("a dispatched mount anchor
 * inside an `if=` `<template>`") still reports 1 after the fix, and that is
 * CORRECT — it detects the SHAPE, which is legitimate and unchanged; the fix makes
 * the shape work rather than eliminating it. Execution, below, is the evidence
 * that the defect is gone.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const REPO = resolve(import.meta.dir, "../../..");
const APP = resolve(REPO, "examples/23-trucking-dispatch");
const OUT = resolve("/tmp", "scrml-flagship-hos");

let art = null;
function artifacts() {
  if (art) return art;
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // Compile the WHOLE app, as `scrml compile examples/23-trucking-dispatch/` does.
  // hos.scrml imports across several files (`DriverStatus` from schema.scrml,
  // `driverStatusClasses` from models/, …) and its bundle opens with
  // `const { X } = _scrml_modules["<file>.client.js"]`, so the harness has to load
  // those modules first — the same thing the browser does via <script> order.
  const inputs = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const q = resolve(dir, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith(".scrml")) inputs.push(q);
    }
  };
  walk(APP);
  const r = compileScrml({ inputFiles: inputs, write: true, outputDir: OUT, log: () => {} });
  const read = (q) => (existsSync(q) ? readFileSync(q, "utf8") : "");
  const clientJs = read(resolve(OUT, "driver/hos.client.js"));
  // Resolve the module graph the page actually references, transitively.
  const deps = [];
  const seen = new Set();
  const collect = (js) => {
    for (const m of js.matchAll(/_scrml_modules\[(?:"|')([^"']+)(?:"|')\]/g)) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const src = read(resolve(OUT, key));
      if (src) { collect(src); deps.push(src); }
    }
  };
  collect(clientJs);
  art = {
    errors: (r.errors ?? []).map((e) => e.code ?? String(e)),
    html: read(resolve(OUT, "driver/hos.html")),
    clientJs,
    depsJs: deps.join("\n"),
    runtimeJs: read(resolve(OUT, r.runtimeFilename ?? "scrml-runtime.js")),
  };
  return art;
}

// The four HOS badges, one per engine state child.
const BADGES = ["Off duty", "On duty", "Driving", "Sleeper berth"];
const badgeCount = () =>
  [...document.querySelectorAll("span")].filter((s) => BADGES.includes((s.textContent || "").trim())).length;
const badgeText = () => {
  const s = [...document.querySelectorAll("span")].find((n) => BADGES.includes((n.textContent || "").trim()));
  return s ? s.textContent.trim() : null;
};

describe("flagship driver/hos — <engine> under an if=", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    // A real origin: the page fetches its driver on mount, and happy-dom refuses a
    // relative URL from about:blank. The fetch itself is stubbed — this test is
    // about the engine badge, and the driver data is injected directly below.
    GlobalRegistrator.register({ url: "http://localhost/driver/hos" });
    globalThis.fetch = () => new Promise(() => {});
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function boot() {
    const { html, clientJs, depsJs, runtimeJs, errors } = artifacts();
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n${depsJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__set__ = _scrml_reactive_set;\nglobalThis.__get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__set__(n, v),
      // Drive the page's own guard: `if=(@loaded && @currentDriver)`.
      open: (status) => {
        if (status || !globalThis.__get__("currentDriver")) {
          globalThis.__set__("currentDriver", { id: 1, current_status: status || "OnDuty", full_name: "A" });
        }
        globalThis.__set__("loaded", true);
      },
      close: () => globalThis.__set__("loaded", false),
    };
  }

  test("the page compiles and its engine mount really does sit inside an if= template", () => {
    const { html } = artifacts();
    // Pins the PREMISE of this test — if the emitter ever hoists the anchor out of
    // the template, this test stops covering the defect and should be re-aimed.
    const tpls = [...html.matchAll(/<template id="_scrml_scrml_tpl_[^"]*">(.*?)<\/template>/gs)].map((m) => m[1]);
    expect(tpls.some((t) => t.includes("data-scrml-engine-mount"))).toBe(true);
  });

  test("guard FALSE at boot: the gated subtree and the engine badge are both absent", () => {
    boot();
    expect(badgeCount()).toBe(0);
  });

  test("THE DEFECT — guard false->true: the engine badge renders", () => {
    const app = boot();
    expect(badgeCount()).toBe(0);
    app.open();
    // Pre-fix: 0, permanently. The dispatcher had resolved its mount once, at
    // module level, while the mount was still inert <template> content.
    expect(badgeCount()).toBe(1);
    expect(BADGES).toContain(badgeText());
  });

  test("the badge reflects the SERVER-authoritative status, not just the initial= arm", () => {
    const app = boot();
    app.open();
    // `server=@currentDriver.current_status` is "OnDuty"; `initial=` is .OffDuty.
    // A remount that re-dispatched on a stale/initial variant would show "Off duty".
    expect(badgeText()).toBe("On duty");
  });

  test("the mounted engine stays LIVE — a status change swaps the badge", () => {
    const app = boot();
    app.open();
    expect(badgeText()).toBe("On duty");
    app.set("currentDriver", { id: 1, current_status: "Driving", full_name: "A" });
    expect(badgeText()).toBe("Driving");
  });

  test("close/reopen re-renders from the CURRENT status, and never duplicates the badge", () => {
    const app = boot();
    app.open();
    app.close();
    expect(badgeCount()).toBe(0);
    app.open("SleeperBerth");
    expect(badgeCount()).toBe(1);
    expect(badgeText()).toBe("Sleeper berth");
  });

  test("repeated open/close cycles leave exactly one badge (no accumulation)", () => {
    const app = boot();
    for (let i = 0; i < 4; i++) { app.open(); app.close(); }
    app.open();
    expect(badgeCount()).toBe(1);
  });
});
