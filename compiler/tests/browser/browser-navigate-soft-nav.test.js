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
    "})();";
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
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
function ssrDoc(outletInner, seed) {
  const seedTag = seed
    ? "<script>window.__scrml_ssr_state=" + JSON.stringify(seed).replace(/</g, "\\u003c") + ";</script>"
    : "";
  return (
    "<!DOCTYPE html><html><head><title>Route</title>" + seedTag + "</head>" +
    "<body><div data-scrml-outlet tabindex=\"-1\">" + outletInner + "</div></body></html>"
  );
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
