/**
 * Browser tests — navigate() soft-navigation (Client Router Wave-1b, #27).
 *
 * SPEC §20.8.2 pipeline + §20.8.5 correctness set. Drives the real emitted
 * runtime engine in happy-dom: a client `navigate()` → `_scrml_navigate_soft`
 * → fetch the target route's SSR HTML → DOMParser-extract the target
 * `[data-scrml-outlet]` subtree + `__scrml_ssr_state` seed → swap the live
 * outlet + rehydrate + focus.
 *
 * happy-dom provides DOMParser + fetch + AbortController + history.pushState +
 * scrollRestoration; it does NOT implement `document.startViewTransition`, so
 * the runtime exercises the §20.8.5(7) instant-swap fallback here (the
 * View-Transitions-present branch is a real-browser assertion — noted, not
 * driven under happy-dom). `fetch` is mocked over the target page routes (there
 * is no server in this harness).
 *
 * NOTE: the browser suite is NOT in the pre-commit gate (unit/integration/
 * conformance); it runs pre-push / CI. It compiles the app INLINE (not from the
 * dist/ samples) so it is self-contained.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

if (!globalThis.document) GlobalRegistrator.register();

// --- compile a source string in-memory ------------------------------------
function compileInline(src) {
  const dir = mkdtempSync(join(tmpdir(), "nav-browser-"));
  const f = join(dir, "app.scrml");
  writeFileSync(f, src);
  const r = compileScrml({ inputFiles: [f], write: false, outputDir: join(dir, "out"), log: () => {} });
  const out = r.outputs.get(f);
  return { html: out.html, clientJs: (out && out.clientJs) || "" };
}

// --- mount runtime + client + boot, exposing the soft-nav surface ----------
function mount(html, clientJs) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = cleanHtml;
  const code =
    "(function(){\n" + SCRML_RUNTIME + "\n" + clientJs + "\n" +
    "window._scrml_navigate_soft = typeof _scrml_navigate_soft === 'function' ? _scrml_navigate_soft : undefined;\n" +
    "window._scrml_rehydrate_region = typeof _scrml_rehydrate_region === 'function' ? _scrml_rehydrate_region : undefined;\n" +
    "window._scrml_register_rehydrator = typeof _scrml_register_rehydrator === 'function' ? _scrml_register_rehydrator : undefined;\n" +
    "window._scrml_reactive_get = _scrml_reactive_get;\n" +
    "window._scrml_reactive_set = _scrml_reactive_set;\n" +
    "window._scrml_timer_registry = typeof _scrml_timer_registry !== 'undefined' ? _scrml_timer_registry : undefined;\n" +
    "window._scrml_ssr_seed_apply = typeof _scrml_ssr_seed_apply === 'function' ? _scrml_ssr_seed_apply : undefined;\n" +
    "window._scrml_shell_cells = typeof _scrml_shell_cells !== 'undefined' ? _scrml_shell_cells : undefined;\n" +
    "window._scrml_input_keyboard_registry = typeof _scrml_input_keyboard_registry !== 'undefined' ? _scrml_input_keyboard_registry : undefined;\n" +
    "})();";
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
}

// Count live (non-paused) interval timers across all scopes — proves an
// outlet-region timer is torn down (its handle cleared) while a shell timer runs.
function countLiveTimers() {
  const reg = window._scrml_timer_registry;
  if (!reg || typeof reg.forEach !== "function") return -1;
  let n = 0;
  reg.forEach((scopeTimers) => {
    scopeTimers.forEach((t) => { if (t && t.handle != null) n++; });
  });
  return n;
}

// Drain the fetch().then().then() chain (mock setTimeout + 2 microtask hops).
// Several macrotask+microtask cycles guarantee the swap has run.
async function flush(cycles = 6) {
  for (let i = 0; i < cycles; i++) {
    await new Promise((r) => setTimeout(r, 1));
    await Promise.resolve();
  }
}

// Build a minimal SSR document for a target route: an outlet subtree + an
// optional __scrml_ssr_state seed script (mirrors emit-server's injection).
// `clientScript` (optional) adds a `<script src>` so the same-chunk check can be
// exercised (a DIFFERENT client chunk = cross-route → hard-nav, finding #4).
function ssrDoc(outletInner, seed, clientScript) {
  const seedTag = seed
    ? "<script>window.__scrml_ssr_state=" + JSON.stringify(seed).replace(/</g, "\\u003c") + ";</script>"
    : "";
  const scriptTag = clientScript ? '<script src="' + clientScript + '"></script>' : "";
  return (
    "<!DOCTYPE html><html><head><title>Route</title>" + seedTag + "</head>" +
    "<body><div data-scrml-outlet tabindex=\"-1\">" + outletInner + "</div>" + scriptTag + "</body></html>"
  );
}

// A shell whose OUTLET holds a reactive `${@count}` interpolation — the flagship
// re-bind case (finding #1). The initial outlet content + a soft-nav target that
// reuses the SAME placeholder id (same chunk) exercise the rebind + teardown.
const REACTIVE_SHELL = [
  "<program>",
  "  <count> = 0",
  "  <outlet>Count ${@count}</outlet>",
  "  ${ function go() { navigate(\"/page2\") } }",
  "  <button onclick=go()>Go</button>",
  "</program>",
].join("\n");

// The placeholder id of the outlet's reactive logic span (for crafting a
// same-chunk target that re-uses it).
function outletLogicId() {
  const el = document.querySelector("[data-scrml-outlet] [data-scrml-logic]");
  return el ? el.getAttribute("data-scrml-logic") : null;
}

// Reconstruct the if= scaffold (its `<template>` + `scrml-if-marker` comment)
// from the live outlet, so a same-chunk soft-nav target reuses the exact ids —
// modelling the target route's SSR (server renders template + marker; the client
// controller mounts). Returns the outlet-inner HTML for the target.
function outletIfScaffold() {
  const outlet = document.querySelector("[data-scrml-outlet]");
  const tpl = outlet.querySelector("template");
  let markerHtml = "";
  const walker = document.createTreeWalker(outlet, 128 /* SHOW_COMMENT */);
  let n;
  while ((n = walker.nextNode())) {
    const m = /scrml-if-marker:(.+)/.exec((n.nodeValue || "").trim());
    if (m) { markerHtml = "<!--scrml-if-marker:" + m[1] + "-->"; break; }
  }
  return (tpl ? tpl.outerHTML : "") + markerHtml;
}

let restoreFetch = null;
beforeEach(() => { restoreFetch = null; });
afterEach(() => {
  if (restoreFetch) { globalThis.fetch = restoreFetch; restoreFetch = null; }
});

// Install a fetch mock keyed by path → SSR HTML. Honors AbortController: an
// aborted request rejects with an AbortError (last-nav-wins).
function mockFetch(routes, { delayMs = 0 } = {}) {
  restoreFetch = globalThis.fetch;
  globalThis.fetch = (input, opts) =>
    new Promise((resolve, reject) => {
      const path = typeof input === "string" ? input : (input && input.url) || "";
      const signal = opts && opts.signal;
      if (signal && signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; return reject(e); }
      const timer = setTimeout(() => {
        const html = routes[path];
        if (html === undefined) { const e = new Error("network"); e.name = "TypeError"; return reject(e); }
        resolve({ ok: true, status: 200, text: async () => html });
      }, delayMs);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
}

const SHELL = [
  "<program>",
  "  <h1>Shell</h1>",
  "  <outlet/>",
  "  ${ function go() { navigate(\"/page2\") } }",
  "  <button onclick=go()>Go</button>",
  "</program>",
].join("\n");

describe("§20.8.2 — soft navigation swaps the <outlet> in place", () => {
  test("navigate() fetches the target SSR HTML and swaps the outlet subtree", async () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);

    const outlet = document.querySelector("[data-scrml-outlet]");
    expect(outlet).not.toBeNull();
    // The shell persists (H1 outside the outlet).
    expect(document.querySelector("h1").textContent).toBe("Shell");

    mockFetch({ "/page2": ssrDoc("<h2>Page Two</h2><p id=\"p2\">reports</p>") });
    window._scrml_navigate_soft("/page2");
    await flush();

    // The outlet's subtree was replaced with the fetched route content.
    const live = document.querySelector("[data-scrml-outlet]");
    expect(live.querySelector("#p2")).not.toBeNull();
    expect(live.querySelector("#p2").textContent).toBe("reports");
    expect(live.querySelector("h2").textContent).toBe("Page Two");
    // The shell H1 still persists (the shell was NOT re-booted).
    expect(document.querySelector("h1").textContent).toBe("Shell");
    // §20.8.5(1) — a soft-nav history entry was pushed. (happy-dom records
    // history.state but does NOT reflect pushState into location.pathname when
    // the base is about:blank — so assert the state marker, not the pathname;
    // the URL update is a real-browser assertion.)
    expect(history.state && history.state.__scrml_soft).toBe(true);
  });

  test("§20.8.5(3) — focus moves to the swapped region", async () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    mockFetch({ "/page2": ssrDoc("<h2>Heading</h2><p>body</p>") });
    window._scrml_navigate_soft("/page2");
    await flush();
    const live = document.querySelector("[data-scrml-outlet]");
    // focus lands on the region's first heading (or the outlet itself).
    const active = document.activeElement;
    expect(active === live || (live.contains && live.contains(active))).toBe(true);
  });

  test("§52.8 — the target route's SSR seed is applied before hydration", async () => {
    // A server-authority cell so the shell carries a seed-apply path.
    const shell = [
      "<program>",
      "  <serverCount>: int = 0",
      "  <outlet/>",
      "  ${ function go() { navigate(\"/page2\") } }",
      "  <button onclick=go()>Go</button>",
      "</program>",
    ].join("\n");
    const { html, clientJs } = compileInline(shell);
    mount(html, clientJs);
    mockFetch({ "/page2": ssrDoc("<p>two</p>", { serverCount: 42 }) });
    window._scrml_navigate_soft("/page2");
    await flush();
    // The seed script's value was extracted + applied to the reactive cell.
    expect(window.__scrml_ssr_state).toEqual({ serverCount: 42 });
  });

  test("§20.8.5(7) — no startViewTransition → instant swap, no throw", async () => {
    // happy-dom lacks document.startViewTransition; the swap still completes.
    expect(typeof document.startViewTransition).toBe("undefined");
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    mockFetch({ "/page2": ssrDoc("<p id=\"ok\">instant</p>") });
    window._scrml_navigate_soft("/page2");
    await flush();
    expect(document.querySelector("#ok").textContent).toBe("instant");
  });

  test("§20.8.5(5) — a transport failure falls back without corrupting the outlet", async () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    // No route registered → the mock rejects (network) → runtime hard-fallback.
    mockFetch({});
    // Should not throw synchronously.
    expect(() => window._scrml_navigate_soft("/missing")).not.toThrow();
    await flush();
    // The live outlet still exists (not left in a broken half-swapped state).
    expect(document.querySelector("[data-scrml-outlet]")).not.toBeNull();
  });
});

describe("§20.8.2 step 3 — rehydration re-wires the swapped region", () => {
  test("a non-delegable handler in the swapped-in region fires after rehydration", async () => {
    // The shell chunk registers an onchange handler that flips a cell; the
    // fetched route reuses the SAME data-scrml-bind-onchange placeholder id, so
    // after the swap + rehydrate the re-attached listener fires.
    const shell = [
      "<program>",
      "  <picked> = \"\"",
      "  <outlet/>",
      "  ${ function go() { navigate(\"/page2\") } }",
      "  ${ function pick(e) { @picked = \"changed\" } }",
      "  <button onclick=go()>Go</button>",
      "  <select onchange=pick(event)><option>a</option><option>b</option></select>",
      "</program>",
    ].join("\n");
    const { html, clientJs } = compileInline(shell);
    mount(html, clientJs);

    // Discover the onchange placeholder id the shell chunk registered.
    const shellSelect = document.querySelector("[data-scrml-bind-onchange]");
    expect(shellSelect).not.toBeNull();
    const pid = shellSelect.getAttribute("data-scrml-bind-onchange");

    // The fetched route content carries a NEW select reusing that id.
    const routeInner = '<select id="s2" data-scrml-bind-onchange="' + pid + '"><option>x</option><option>y</option></select>';
    mockFetch({ "/page2": ssrDoc(routeInner) });
    window._scrml_navigate_soft("/page2");
    await flush();

    const swapped = document.querySelector("#s2");
    expect(swapped).not.toBeNull();
    // Fire change on the swapped-in element → the rehydrated listener runs.
    swapped.dispatchEvent(new Event("change", { bubbles: true }));
    expect(window._scrml_reactive_get("picked")).toBe("changed");
  });

  test("_scrml_rehydrate_region is a no-op-safe direct call", () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    const outlet = document.querySelector("[data-scrml-outlet]");
    expect(() => window._scrml_rehydrate_region(outlet)).not.toThrow();
  });
});

describe("finding #1 — the swapped region stays REACTIVE (not frozen)", () => {
  test("a `${@cell}` in a swapped region UPDATES after a cell mutation", async () => {
    const { html, clientJs } = compileInline(REACTIVE_SHELL);
    mount(html, clientJs);
    const pid = outletLogicId();
    expect(pid).not.toBeNull();

    // Same-chunk target: reuse the SAME placeholder id (no client script → same chunk).
    mockFetch({ "/page2": ssrDoc('<span data-scrml-logic="' + pid + '">Count 0</span>') });
    window._scrml_navigate_soft("/page2");
    await flush();

    const swapped = document.querySelector("[data-scrml-outlet] [data-scrml-logic]");
    expect(swapped).not.toBeNull();
    // Mutate the cell — the REBOUND effect must update the swapped-in node.
    window._scrml_reactive_set("count", 5);
    expect(swapped.textContent).toBe("5");
  });
});

describe("finding #2 — the OLD region's reactivity is torn down (no leak)", () => {
  test("the swapped-out region's effect STOPS updating after nav", async () => {
    const { html, clientJs } = compileInline(REACTIVE_SHELL);
    mount(html, clientJs);
    const pid = outletLogicId();
    // The boot-rendered region-A node (its display effect is region-tracked).
    const oldNode = document.querySelector("[data-scrml-outlet] [data-scrml-logic]");
    window._scrml_reactive_set("count", 1);
    expect(oldNode.textContent).toBe("1"); // A is live before nav

    mockFetch({ "/page2": ssrDoc('<span data-scrml-logic="' + pid + '">Count 1</span>') });
    window._scrml_navigate_soft("/page2");
    await flush();

    // Mutate AFTER the swap: the NEW node updates (B live), the OLD detached node
    // does NOT (A was disposed by teardown — proves it is not a leaking no-op).
    window._scrml_reactive_set("count", 9);
    const newNode = document.querySelector("[data-scrml-outlet] [data-scrml-logic]");
    expect(newNode.textContent).toBe("9");   // rebound effect B fires
    expect(oldNode.textContent).toBe("1");   // disposed effect A does NOT fire
  });
});

describe("extended #1 — a show= display-toggle in a swapped region RE-EVALUATES", () => {
  test("a swapped-in show= toggle updates on a cell change (not frozen)", async () => {
    // NOTE: `show=` is the display-toggle path (data-scrml-bind-show + style.display),
    // now wired in `_scrml_nav_rewire` (region-tracked). `if=` uses the
    // mount/unmount template state-machine (`_scrml_mount_template`) — NOT yet
    // rehydrated (surfaced remaining surface).
    const shell = [
      "<program>",
      "  <shown> = true",
      "  <outlet><p show=@shown id=\"tgt\">visible</p></outlet>",
      "  ${ function go() { navigate(\"/page2\") } }",
      "  <button onclick=go()>Go</button>",
      "</program>",
    ].join("\n");
    const { html, clientJs } = compileInline(shell);
    mount(html, clientJs);
    const tEl = document.querySelector("[data-scrml-outlet] [data-scrml-bind-show]");
    expect(tEl).not.toBeNull();
    const pid = tEl.getAttribute("data-scrml-bind-show");

    // Same-chunk target reuses the SAME show= placeholder id.
    mockFetch({ "/page2": ssrDoc('<p data-scrml-bind-show="' + pid + '" id="tgt2">two</p>') });
    window._scrml_navigate_soft("/page2");
    await flush();

    const swapped = document.querySelector("#tgt2");
    expect(swapped).not.toBeNull();
    // The rebound display-toggle effect re-evaluates against the new node.
    window._scrml_reactive_set("shown", false);
    expect(swapped.style.display).toBe("none");
    window._scrml_reactive_set("shown", true);
    expect(swapped.style.display).toBe("");
  });
});

describe("M1 — an if= mount/unmount controller in a swapped region RE-EVALUATES", () => {
  const IF_SHELL = [
    "<program>",
    "  <shown> = true",
    "  <outlet><p if=@shown id=\"tgt\">visible</p></outlet>",
    "  ${ function go() { navigate(\"/page2\") } }",
    "  <button onclick=go()>Go</button>",
    "</program>",
  ].join("\n");

  test("a swapped-in if= mounts on true and unmounts on false (not frozen)", async () => {
    const { html, clientJs } = compileInline(IF_SHELL);
    mount(html, clientJs);
    // Boot-mounted: the if= content is present (shown === true).
    expect(document.querySelector("[data-scrml-outlet] #tgt")).not.toBeNull();
    const scaffold = outletIfScaffold(); // template + marker, same ids (same chunk)

    mockFetch({ "/page2": ssrDoc(scaffold) });
    window._scrml_navigate_soft("/page2");
    await flush();

    // Re-invoked controller mounts the if= content into the swapped region.
    expect(document.querySelector("[data-scrml-outlet] #tgt")).not.toBeNull();
    // It RE-EVALUATES: flip the cell → the swapped-in if= unmounts / remounts.
    window._scrml_reactive_set("shown", false);
    expect(document.querySelector("[data-scrml-outlet] #tgt")).toBeNull();
    window._scrml_reactive_set("shown", true);
    expect(document.querySelector("[data-scrml-outlet] #tgt")).not.toBeNull();
  });

  test("if= re-entry idempotency — nav away+back mounts EXACTLY ONE copy (no double-mount, no leaked scope)", async () => {
    const { html, clientJs } = compileInline(IF_SHELL);
    mount(html, clientJs);
    const scaffold = outletIfScaffold();

    // Nav away (teardown disposes the boot controller + unmounts) then back.
    mockFetch({ "/page2": ssrDoc(scaffold), "/back": ssrDoc(scaffold) });
    window._scrml_navigate_soft("/page2");
    await flush();
    window._scrml_navigate_soft("/back");
    await flush();

    // Exactly one mounted copy — the prior controller's effect was disposed
    // (region-tracked teardown), so no second controller double-mounts.
    expect(document.querySelectorAll("[data-scrml-outlet] #tgt").length).toBe(1);
    // Still reactive after the round-trip.
    window._scrml_reactive_set("shown", false);
    expect(document.querySelectorAll("[data-scrml-outlet] #tgt").length).toBe(0);
    window._scrml_reactive_set("shown", true);
    expect(document.querySelectorAll("[data-scrml-outlet] #tgt").length).toBe(1);
  });
});

describe("M1 — an <each> list in a swapped region RE-RENDERS", () => {
  test("a swapped-in each re-renders after a list change", async () => {
    const shell = [
      "<program>",
      "  <items> = [\"a\", \"b\"]",
      "  <outlet><ul><each in=@items as item><li>${item}</li></each></ul></outlet>",
      "  ${ function go() { navigate(\"/page2\") } }",
      "  <button onclick=go()>Go</button>",
      "</program>",
    ].join("\n");
    const { html, clientJs } = compileInline(shell);
    mount(html, clientJs);
    // Reconstruct the each mount scaffold from the live outlet (same chunk ids).
    const outlet = document.querySelector("[data-scrml-outlet]");
    const eachInner = outlet.innerHTML;

    mockFetch({ "/page2": ssrDoc(eachInner) });
    window._scrml_navigate_soft("/page2");
    await flush();

    // After the swap + _scrml_remount_each, the list is re-rendered + reactive.
    window._scrml_reactive_set("items", ["x", "y", "z"]);
    await flush();
    const lis = document.querySelectorAll("[data-scrml-outlet] li");
    expect(lis.length).toBe(3);
  });
});

describe("S239 #2 — an in-page #hash navigate does NOT swap the outlet", () => {
  test("navigate(\"#anchor\") pushes + scrolls but leaves the outlet subtree intact", async () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    const outlet = document.querySelector("[data-scrml-outlet]");
    const before = outlet.innerHTML;
    let fetched = false;
    restoreFetch = globalThis.fetch;
    globalThis.fetch = () => { fetched = true; return Promise.resolve({ ok: true, status: 200, text: async () => ssrDoc("<p id=\"swapped\">x</p>") }); };

    window._scrml_navigate_soft("#section");
    await flush();

    // No fetch, no swap — the outlet is untouched (its state survives).
    expect(fetched).toBe(false);
    expect(document.querySelector("[data-scrml-outlet]").innerHTML).toBe(before);
    expect(document.querySelector("#swapped")).toBeNull();
  });
});

describe("M1 Phase 4 — an outlet-resident <timer> STOPS on nav; a shell timer survives", () => {
  test("the swapped-OUT region's timer is torn down; the shell timer keeps running", async () => {
    const shell = [
      "<program>",
      "  <tick> = 0",
      "  <shellTick> = 0",
      "  <timer interval=1000>${ @shellTick = @shellTick + 1 }</timer>",
      "  <outlet><p>region</p><timer interval=500>${ @tick = @tick + 1 }</timer></outlet>",
      "  ${ function go() { navigate(\"/page2\") } }",
      "  <button onclick=go()>Go</button>",
      "</program>",
    ].join("\n");
    const { html, clientJs } = compileInline(shell);
    mount(html, clientJs);

    // Boot: two live timers (shell + region).
    expect(countLiveTimers()).toBe(2);

    // Nav away — the target region carries no timer.
    mockFetch({ "/page2": ssrDoc("<p>two</p>") });
    window._scrml_navigate_soft("/page2");
    await flush();

    // The region timer was region-tracked → drained by _scrml_teardown_region.
    // The shell timer (module-init path) keeps running. Exactly one live timer.
    expect(countLiveTimers()).toBe(1);
  });
});

describe("finding #4 — a cross-route target hard-navigates (no frozen swap)", () => {
  test("a target that needs a client chunk we don't have is NOT soft-swapped", async () => {
    const { html, clientJs } = compileInline(SHELL);
    mount(html, clientJs);
    const before = document.querySelector("[data-scrml-outlet]").innerHTML;
    // The target references a DIFFERENT client chunk (a separate pages/ file).
    mockFetch({ "/other": ssrDoc('<p id="cross">cross-route</p>', null, "other-route.client.js") });
    window._scrml_navigate_soft("/other");
    await flush();
    // Hard-nav fallback: happy-dom's window.location assignment is inert, so the
    // outlet is LEFT AS-IS (never frozen-swapped with the cross-route content).
    expect(document.querySelector("#cross")).toBeNull();
    expect(document.querySelector("[data-scrml-outlet]").innerHTML).toBe(before);
  });
});

// A persistent-shell app: a SERVER-AUTHORITY shell cell (`@accounts`, declared at
// program-top-level, OUTSIDE the outlet → in the SSR seed) + an outlet with route
// content. The shell cell is the "nav counter / sidebar toggle" of the finding.
const SHELL5 = [
  '<program db="sqlite:./app.db">',
  '${',
  '  < Account authority="server" table="users">',
  '    id: number',
  '    name: string',
  '  </>',
  '  <Account> @accounts',
  '}',
  '  <outlet><p>region</p></outlet>',
  '  ${ function go() { navigate("/page2") } }',
  '  <button onclick=go()>Go</button>',
  '</program>',
].join("\n");

describe("finding #5 — a persistent SHELL cell is NOT reset by a soft-nav rehydrate", () => {
  test("the compiler emits _scrml_shell_cells listing the program-top-level cell", () => {
    const { clientJs } = compileInline(SHELL5);
    // @accounts is declared OUTSIDE the outlet → a shell cell → skipped on rehydrate.
    expect(clientJs).toContain("_scrml_shell_cells");
    expect(clientJs).toContain('"accounts": true');
  });

  test("a mutated shell cell SURVIVES the nav; the seed-apply would otherwise reset it", async () => {
    const { html, clientJs } = compileInline(SHELL5);
    // The Tier-1 server-authority cell fires a boot-time /__serverLoad fetch; mock
    // it (benign empty rows) BEFORE mount so happy-dom's real fetch never runs, and
    // register the nav target.
    restoreFetch = globalThis.fetch;
    globalThis.fetch = (input) => {
      const path = typeof input === "string" ? input : (input && input.url) || "";
      if (path.indexOf("/page2") !== -1) return Promise.resolve({ ok: true, status: 200, redirected: false, url: path, text: async () => ssrDoc("<p>two</p>", { accounts: [{ id: 1, name: "ssr-initial" }] }) });
      return Promise.resolve({ ok: true, status: 200, redirected: false, url: path, json: async () => [], text: async () => "[]" });
    };
    mount(html, clientJs);
    await flush(); // let the boot server-load settle before we mutate.
    // The compile-time shell set is present at runtime.
    expect(window._scrml_shell_cells && window._scrml_shell_cells.accounts).toBe(true);

    // The user mutated the shell cell (a nav counter bumped, a sidebar opened).
    window._scrml_reactive_set("accounts", [{ id: 9, name: "MUTATED" }]);
    expect(window._scrml_reactive_get("accounts")).toEqual([{ id: 9, name: "MUTATED" }]);

    // Soft-nav: the fetched route's SSR seed carries `accounts` at its SSR-INITIAL
    // value (an UNSCOPED seed-apply would clobber the user's mutation). The fetch
    // mock installed above serves /page2 with that seed.
    window._scrml_navigate_soft("/page2");
    await flush();

    // #5 — the shell cell KEPT its mutated value; the rehydrate skipped it. This is
    // the persistent shell the router exists to preserve (§20.8.2).
    expect(window._scrml_reactive_get("accounts")).toEqual([{ id: 9, name: "MUTATED" }]);

    // Load-bearing proof: the seed DID contain `accounts`, and the INITIAL-load
    // seed-apply (no skipShell) DOES set it — so the skip above is what protected
    // the mutation, not an inert no-op.
    window._scrml_ssr_seed_apply(false);
    expect(window._scrml_reactive_get("accounts")).toEqual([{ id: 1, name: "ssr-initial" }]);
  });
});
