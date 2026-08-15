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

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const REPO = resolve(import.meta.dir, "../../..");
const APP = resolve(REPO, "examples/23-trucking-dispatch");
// S345: a UNIQUE output dir per run. The fixed `/tmp/scrml-flagship-hos` was
// rmSync'd and recreated on every call, so any concurrent reader of the same
// path (a parallel worker, a retry, a second checkout on the same box) could
// observe the tree mid-delete and compile into a half-empty directory —
// which surfaces here as an empty `html` and a bare assertion failure that
// names nothing. mkdtemp removes the shared name entirely.
const OUT = mkdtempSync(resolve(tmpdir(), "scrml-flagship-hos-"));

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
  // SORTED walk (S345): `readdirSync` returns filesystem order, which is a property
  // of the IMAGE the runner was built from, not of this repo. Handing an unsorted
  // list to `compileScrml` made the whole-app compile order environment-dependent,
  // and with it the emitted `driver/hos.html` this file asserts on — the same
  // readdir-order class that made `each-multi-root` fail only in cloud. Sorting at
  // every level makes the input list identical everywhere.
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const q = resolve(dir, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith(".scrml")) inputs.push(q);
    }
  };
  walk(APP);
  const r = compileScrml({ inputFiles: inputs, write: true, outputDir: OUT, log: () => {} });
  // S345: fail LOUD and specific. Previously a failed/partial compile surfaced only
  // as a downstream `expect(tpls.some(...)).toBe(true)` reading false — an assertion
  // that names neither the compile error nor the missing file, which is why this
  // test's intermittent cloud reds took three sessions to attribute.
  const _errs = (r.errors ?? []).map((e) => e.code ?? String(e));
  if (_errs.length) {
    throw new Error(`[flagship-hos] compile FAILED with ${_errs.length} error(s): ${_errs.join(", ")} (outputDir=${OUT})`);
  }
  const read = (q) => (existsSync(q) ? readFileSync(q, "utf8") : "");
  // S345: LOCATE the emitted artifacts; do not assume `driver/hos.*`.
  // `computeOutputBaseDir` (api.js:203) derives the output layout from the COMMON
  // ANCESTOR of the input list, so the relative path of every emitted file shifts if
  // the walked set changes — one stray `.scrml` anywhere under the app dir is enough.
  // The old code read a hardcoded `driver/hos.html`, and `read()` returns "" for a
  // missing path, so a shifted layout surfaced as EMPTY html and a bare
  // `expect(tpls.some(...)).toBe(true)` reading false — naming nothing. That is the
  // signature of this test's long-running intermittent cloud failure.
  const findEmitted = (suffix) => {
    const hits = [];
    const walkOut = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const q = resolve(dir, e.name);
        if (e.isDirectory()) walkOut(q);
        else if (e.name.endsWith(suffix)) hits.push(q);
      }
    };
    if (existsSync(OUT)) walkOut(OUT);
    return hits;
  };
  const htmlHits = findEmitted("hos.html");
  const clientHits = findEmitted("hos.client.js");
  if (htmlHits.length !== 1 || clientHits.length !== 1) {
    const all = findEmitted("");
    throw new Error(
      `[flagship-hos] expected exactly one emitted hos.html and one hos.client.js under ${OUT}; ` +
      `found ${htmlHits.length} html and ${clientHits.length} client. Emitted tree (${all.length} files): ` +
      all.map((q) => q.slice(OUT.length + 1)).join(", "));
  }
  const clientJs = read(clientHits[0]);
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
    html: read(htmlHits[0]),
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
  // S346 — the whole-app compile gets an EXPLICIT budget, and it runs here, once,
  // BEFORE any test body and before happy-dom is registered.
  //
  // WHY. `artifacts()` compiles the 36-file trucking-dispatch app synchronously
  // (~3 s on a fast box, cold). It used to run lazily inside whichever test called
  // it first, under bun's DEFAULT per-test timeout of 5000 ms — `bunfig.toml`'s
  // `[test] timeout` key is not one bun reads, so the 10 s the repo believed it
  // had was never in force. A synchronous test that overruns still runs to
  // completion (its assertion PASSED every time), but bun then reports it as
  // `(fail) <name>` + `^ this test timed out after 5000ms.` — the SAME marker an
  // assertion failure produces, which is how this test's name joined the browser
  // gate's failure set intermittently in cloud for three sessions and was read as
  // "the emitted html lacks the template". It never did.
  //
  // What made the compile slow enough to cross 5 s only SOMETIMES: the tier runs
  // 79 in-process compiles in one bun process in filesystem order, and a
  // `lint-ghost-patterns.js` hot path (`skipPastRanges`, per-character linear
  // rescan) ran ~17× slower for the rest of the process once its first hot
  // compile had carried an empty range list — i.e. after ANY fixture with no
  // string literal and no comment compiled first (measured: 343 ms → 5.9 s of
  // this compile). That path is fixed in the compiler (forward-only cursor,
  // `lint-ghost-patterns-skip-cursor.test.js`); this budget is the harness half —
  // a whole-app compile is a legitimate multi-second operation and its test must
  // say so, exactly as `integration/w3-splitter-trucking-characterization.test.js`
  // does for the same app. The assertions below are unchanged.
  beforeAll(() => {
    artifacts();
  }, { timeout: 60_000 });

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
