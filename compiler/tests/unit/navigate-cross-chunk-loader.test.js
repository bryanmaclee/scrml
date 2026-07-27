/**
 * navigate-wave1c — cross-chunk LOADER regression guards (S292)
 *
 * Pins the two HIGH defects found by the S276 adversarial pass and fixed at S292:
 *   [[g-nav-chunk-loading-flag-race]]        — a superseded nav's chunk cleared the
 *                                              shared boot flag, so a newer route's
 *                                              chunk never booted and swapped in DEAD
 *                                              markup (permanent, no diagnostic).
 *   [[g-nav-chunk-basename-collision-key]]   — "already loaded" keyed on bare basename,
 *                                              so same-named chunks in different
 *                                              directories collided and a needed chunk
 *                                              was silently skipped.
 *
 * WHY NOT THE BROWSER SUITE. Per [[g-nav-browser-harness-fidelity]],
 * browser-navigate-cross-chunk.test.js CANNOT observe either defect: it evals chunks in
 * a throwaway declarative environment, and its head.appendChild override returns the
 * node WITHOUT connecting it — so the already-loaded set never grows, every chunk is
 * re-injected and re-booted on every nav, and the flag is always freshly true at eval.
 * That harness passes on code that fails in a real browser.
 *
 * So this executes the SHIPPED runtime under node:vm in ONE shared context (real
 * classic-script top-level semantics) against a DOM shim whose appendChild genuinely
 * CONNECTS the node, and drains injected scripts under real `async=false` ordering:
 * a script EXECUTES, then its load fires, then the next executes. That ordering is the
 * whole mechanism of the flag race — a harness that fires load on append cannot see it.
 *
 * Each defect carries a CONTROL asserting the check still bites (pa-base §8 unproven-gate).
 */
import { describe, test, expect } from "bun:test";
import vm from "node:vm";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

/** A DOM whose script list actually grows on append, and which QUEUES rather than executes. */
function makeRuntimeContext(loadedSrcs, href) {
  const scripts = loadedSrcs.map((src) => ({ getAttribute: (a) => (a === "src" ? src : null) }));
  const queue = [];
  const head = {
    appendChild(node) { scripts.push(node); queue.push(node); return node; },
    querySelector: () => null,
  };
  const document = {
    head, documentElement: head, title: "", readyState: "complete",
    querySelectorAll: (sel) => (sel === "script[src]" ? scripts : []),
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => {
      const el = { _src: "", async: true, onload: null, onerror: null,
        getAttribute: (a) => (a === "src" ? el._src : null) };
      Object.defineProperty(el, "src", { get: () => el._src, set: (v) => { el._src = v; } });
      return el;
    },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, URL, Object, Array, JSON, Math, Date, String, Number,
    document, window: { location: { href } }, location: { href },
    history: { pushState() {}, replaceState() {} }, navigator: {},
  });
  ctx.globalThis = ctx;
  vm.runInContext(SCRML_RUNTIME, ctx, { filename: "scrml-runtime.js" });
  queue.length = 0;            // discard any boot-time appends
  // Read the real `var` binding, not a context property — they are not interchangeable here.
  const flag = () => vm.runInContext("_scrml_chunk_loading", ctx);
  return { ctx, queue, flag };
}

/** A fetched target document exposing the given <script src> list. */
function fetchedDoc(srcs) {
  const scripts = srcs.map((src) => ({ getAttribute: (a) => (a === "src" ? src : null) }));
  return { querySelectorAll: (sel) => (sel === "script[src]" ? scripts : []), querySelector: () => null };
}

/** Real classic `async=false`: execute in insertion order; each executes, THEN its load fires. */
function drainAsyncFalse(queue, flag) {
  const flagAtExec = {};
  while (queue.length) {
    const el = queue.shift();
    flagAtExec[el._src] = flag();     // the chunk's boot dispatch reads the flag HERE
    if (el.onload) el.onload();       // then load fires -> settle()
  }
  return flagAtExec;
}

describe("navigate-wave1c cross-chunk loader — g-nav-chunk-basename-collision-key", () => {
  test("a same-basename chunk in a DIFFERENT directory is treated as missing", () => {
    // Live on /admin/reports (chunk /admin/reports.client.js). Soft-nav to /reports,
    // which needs the DISTINCT file /reports.client.js. Both basename reports.client.js.
    const { ctx } = makeRuntimeContext(
      ["/index.client.js", "/admin/reports.client.js"], "http://x/admin/reports");
    const missing = ctx._scrml_nav_missing_chunks(
      fetchedDoc(["/index.client.js", "/reports.client.js"]), "/reports");
    expect(missing).toEqual(["http://x/reports.client.js"]);
  });

  test("CONTROL — a genuinely already-loaded chunk is still skipped (no re-injection)", () => {
    const { ctx } = makeRuntimeContext(
      ["/index.client.js", "/reports.client.js"], "http://x/reports");
    const missing = ctx._scrml_nav_missing_chunks(
      fetchedDoc(["/index.client.js", "/reports.client.js"]), "/reports");
    expect(missing).toEqual([]);
  });

  test("CONTROL — a nested route's relative src resolving to a LOADED chunk is skipped", () => {
    // ../index.client.js from /admin/reports resolves to /index.client.js, already loaded.
    const { ctx } = makeRuntimeContext(["/index.client.js"], "http://x/admin/reports");
    const missing = ctx._scrml_nav_missing_chunks(
      fetchedDoc(["../index.client.js"]), "/admin/reports");
    expect(missing).toEqual([]);
  });
});

describe("navigate-wave1c cross-chunk loader — g-nav-chunk-loading-flag-race", () => {
  test("two overlapping navs: the surviving nav's chunk still boots", () => {
    const { ctx, queue, flag } = makeRuntimeContext(["/index.client.js"], "http://x/");
    ctx.__done = [];
    vm.runInContext(
      '_scrml_nav_token=1;_scrml_nav_load_chunks(["http://x/a.client.js"],1,' +
      'function(){__done.push("nav1")},"/a");', ctx);
    vm.runInContext(
      '_scrml_nav_token=2;_scrml_nav_load_chunks(["http://x/b.client.js"],2,' +
      'function(){__done.push("nav2")},"/b");', ctx);

    const flagAtExec = drainAsyncFalse(queue, flag);

    // chunkA executes first and fires load; its settle() must NOT disarm chunkB.
    expect(flagAtExec["http://x/a.client.js"]).toBeTruthy();
    expect(flagAtExec["http://x/b.client.js"]).toBeTruthy();
    // Last-nav-wins still holds: the superseded nav must not run its onDone.
    expect(ctx.__done).toEqual(["nav2"]);
  });

  test("the depth counter returns to 0 — no leak that would make a later initial load eager", () => {
    const { ctx, queue, flag } = makeRuntimeContext(["/index.client.js"], "http://x/");
    ctx.__done = [];
    vm.runInContext(
      '_scrml_nav_token=1;_scrml_nav_load_chunks(["http://x/a.client.js"],1,' +
      'function(){__done.push("nav1")},"/a");', ctx);
    vm.runInContext(
      '_scrml_nav_token=2;_scrml_nav_load_chunks(["http://x/b.client.js"],2,' +
      'function(){__done.push("nav2")},"/b");', ctx);
    drainAsyncFalse(queue, flag);
    expect(flag()).toBe(0);
  });

  test("CONTROL — at rest the flag is falsy, so an INITIAL load still defers to DOMContentLoaded", () => {
    const { flag } = makeRuntimeContext([], "http://x/");
    expect(flag()).toBeFalsy();
  });

  test("CONTROL — a single in-flight injection is truthy while its chunk executes", () => {
    const { ctx, queue, flag } = makeRuntimeContext(["/index.client.js"], "http://x/");
    ctx.__done = [];
    vm.runInContext(
      '_scrml_nav_token=1;_scrml_nav_load_chunks(["http://x/a.client.js"],1,' +
      'function(){__done.push("nav1")},"/a");', ctx);
    const flagAtExec = drainAsyncFalse(queue, flag);
    expect(flagAtExec["http://x/a.client.js"]).toBeTruthy();
    expect(ctx.__done).toEqual(["nav1"]);
  });
});
