/**
 * F1 (S355) — `ratelimit=` is scoped to ROUTE traffic, not every request.
 * change-id `handle-onion-f1-ratelimit-scope`.
 *
 * The `handle()` onion was hoisted to wrap TOP-LEVEL dispatch (ratified — SPEC
 * §40.3.4: handle() "applies to all HTTP requests handled by the compiled server
 * — including statically-served assets"). The compiler-auto rate limiter lived
 * inside that same wrapper and was hoisted with it, so it started counting EVERY
 * request instead of every route request.
 *
 * SPEC gives handle() that "including statically-served assets" carve-in
 * explicitly and gives `ratelimit=` no such sentence. It classifies `ratelimit=`
 * as one of the PER-ROUTE concerns (§4.15: the `<page>` attribute set is
 * "db=, auth=, csrf=, ratelimit=, keep-alive" — per-route — versus the app-wide
 * attributes that live only on `<program>`), and §40.2 fixes the pipeline order
 * as "CORS -> rate limit -> CSRF -> route handler".
 *
 * Observable consequence of the regression: ONE ordinary browser page load is
 * four requests (HTML + CSS + runtime + client bundle), so `ratelimit="3/min"`
 * 429'd the app's own client bundle on the FIRST visit — the app could not boot
 * for its first visitor.
 *
 * These tests EXECUTE the emitted server. They compile a real fixture, compose
 * the real production `_server.js` through `build.js`, import it, capture the
 * `Bun.serve` config, and drive `cfg.fetch(...)`. A source grep on the emitted
 * text would not have caught the defect (the emitted text was well-formed — it
 * was the SET of counted requests that was wrong), and would not catch a
 * regression that silently disables the limiter either, which §3 guards.
 *
 * Coverage:
 *   §1  one ordinary page load is never rate-limited (the PA reproducer)
 *   §2  a sibling module's page is not counted against another module's budget
 *   §3  the limiter STILL FIRES on real route traffic (429 + Retry-After)
 *   §4  a WebSocket upgrade route is not counted (§40.3.4)
 *   §5  `scrml dev` agrees with `scrml build`
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { discoverServerRoutes, generateServerEntry } from "../../src/commands/build.js";
import { loadServerRoutes, buildServeConfig, noteCompileResult } from "../../src/commands/dev.js";

// ---------------------------------------------------------------------------
// Harness — compile a fixture, compose the REAL production `_server.js`, and
// drive it in-process by capturing the `Bun.serve` config. No socket.
// ---------------------------------------------------------------------------

const TMP_ROOT = join(tmpdir(), `scrml-ratelimit-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);

afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

/**
 * Compile `sources` (name -> scrml text) into a fresh dist and write the
 * production `_server.js` that `scrml build` would emit for it.
 * @returns {{ dir: string, assets: string[], entryFiles: string[] }}
 */
function buildFixture(label, sources) {
  const dir = join(TMP_ROOT, label);
  const src = join(dir, "src");
  const dist = join(dir, "dist");
  mkdirSync(src, { recursive: true });

  const entryFiles = [];
  for (const [name, text] of Object.entries(sources)) {
    const abs = join(src, name);
    writeFileSync(abs, text);
    entryFiles.push(abs);
  }

  const result = compileScrml({ inputFiles: entryFiles, outputDir: dist, write: true });
  expect(result.errors ?? []).toEqual([]);

  const modules = discoverServerRoutes(dist);
  writeFileSync(join(dist, "_server.js"), generateServerEntry(modules));

  return { dir: dist, assets: readdirSync(dist), entryFiles };
}

/**
 * Import an emitted `_server.js` and return its `Bun.serve` config. Each call
 * re-imports under a fresh cache-buster, so the limiter's in-memory hit map
 * starts empty — one fixture, independent budgets per test.
 */
async function mountServer(dist) {
  const realServe = Bun.serve;
  const realRequestIP = Bun.requestIP;
  const realLog = console.log;
  let captured = null;

  Bun.serve = (cfg) => {
    captured = cfg;
    return { port: 0, stop() {}, publish() {}, upgrade: () => false };
  };
  // A synthetic Request has no peer; the emitted limiter reads
  // `Bun.requestIP(req)?.address`. Pin it so every request keys the same bucket.
  Bun.requestIP = () => ({ address: "203.0.113.7", port: 4242, family: "IPv4" });
  console.log = () => {};

  try {
    await import(`file://${join(dist, "_server.js")}?t=${Date.now()}-${Math.random()}`);
  } finally {
    Bun.serve = realServe;
    Bun.requestIP = realRequestIP;
    console.log = realLog;
  }

  expect(captured, "the emitted _server.js should call Bun.serve").not.toBeNull();
  const serverStub = { upgrade: () => false, publish: () => {}, requestIP: () => ({ address: "203.0.113.7" }) };
  return (path, init = {}) => captured.fetch(new Request(`http://localhost${path}`, init), serverStub);
}

/** Fire `specs` in order and return the status of each. */
async function statuses(fetch, specs) {
  const out = [];
  for (const s of specs) {
    const res = await fetch(s.path, { method: s.method ?? "GET", headers: s.headers ?? {} });
    out.push(res instanceof Response ? res.status : `non-Response:${typeof res}`);
  }
  return out;
}

/**
 * Assert that `seen` shows the limiter counting route traffic with `budget`
 * requests allowed through.
 *
 * The route's OWN answer is incidental here and is ambient-dependent: a
 * full-suite run has happy-dom's `Headers` globally registered by an earlier
 * browser test, and happy-dom drops the forbidden `Cookie` header — so the
 * double-submit CSRF check sees no cookie and answers 403 where a standalone run
 * answers 200. What this pins is the LIMITER: the first `budget` requests REACH
 * the route (consistently, and without erroring), and every one after that is
 * refused with 429 before the route runs.
 */
function expectLimitedAfter(seen, budget) {
  const reached = seen.slice(0, budget);
  const refused = seen.slice(budget);
  for (const status of reached) {
    expect(status).not.toBe(429);
    expect(status).toBeLessThan(500);
  }
  // Every request that got through answered the same way — a route that started
  // failing halfway would not be a rate-limiting result.
  expect(new Set(reached).size).toBe(1);
  expect(refused).toEqual(new Array(refused.length).fill(429));
}

/** The four requests one ordinary browser page load makes, in browser order. */
function pageLoadRequests(assets, htmlName) {
  const css = assets.find((f) => f.endsWith(".css"));
  const runtime = assets.find((f) => f.startsWith("scrml-runtime.") && f.endsWith(".js"));
  const client = assets.find((f) => f.includes(".client.") && f.endsWith(".js"));
  expect(css, "fixture should emit a CSS bundle").toBeDefined();
  expect(runtime, "fixture should emit the runtime bundle").toBeDefined();
  expect(client, "fixture should emit a client bundle").toBeDefined();
  return [`/${htmlName}`, `/${css}`, `/${runtime}`, `/${client}`].map((path) => ({ path }));
}

// ---------------------------------------------------------------------------
// §1 — the PA reproducer: one ordinary page load must never be rate-limited
// ---------------------------------------------------------------------------

const PAGE_ONLY = `<program ratelimit="3/min">
  <page>
    <h1>hi</h1>
  </page>
</program>
`;

describe("§1 one ordinary page load is not rate-limited", () => {
  test("HTML + CSS + runtime + client bundle all 200 under ratelimit=3/min", async () => {
    const { dir, assets } = buildFixture("page-only", { "app.scrml": PAGE_ONLY });
    const fetch = await mountServer(dir);
    const load = pageLoadRequests(assets, "app.html");

    // Pre-fix this read [200, 200, 200, 429] — the app's own client bundle was
    // throttled on the first visit, so the app could not boot for its first
    // visitor. Four requests against a budget of three.
    expect(await statuses(fetch, load)).toEqual([200, 200, 200, 200]);
  });

  test("three consecutive page loads (12 requests, budget 3) all 200", async () => {
    const { dir, assets } = buildFixture("page-only-repeat", { "app.scrml": PAGE_ONLY });
    const fetch = await mountServer(dir);
    const load = pageLoadRequests(assets, "app.html");

    const all = await statuses(fetch, [...load, ...load, ...load]);
    expect(all).toEqual(new Array(12).fill(200));
  });

  test("a 404 is not counted either", async () => {
    const { dir } = buildFixture("page-only-404", { "app.scrml": PAGE_ONLY });
    const fetch = await mountServer(dir);

    const miss = { path: "/definitely-not-a-thing" };
    expect(await statuses(fetch, [miss, miss, miss, miss, miss])).toEqual([404, 404, 404, 404, 404]);
  });
});

// ---------------------------------------------------------------------------
// §2 — cross-module bleed: one module's budget must not throttle another's page
// ---------------------------------------------------------------------------

describe("§2 a sibling module's page is not counted against another module's budget", () => {
  test("beta.html is unthrottled when only alpha declares ratelimit=", async () => {
    const { dir } = buildFixture("two-modules", {
      "alpha.scrml": `<program ratelimit="2/min">\n  <page>\n    <h1>alpha</h1>\n  </page>\n</program>\n`,
      "beta.scrml": `<program>\n  <page>\n    <h1>beta</h1>\n  </page>\n</program>\n`,
    });
    const fetch = await mountServer(dir);

    // Pre-fix this read [200, 200, 429, 429, 429]: alpha's onion wrapped ALL
    // top-level dispatch, so beta's page was throttled by a limiter beta never
    // opted into. Each module's limiter now consults that module's own routes.
    const beta = { path: "/beta.html" };
    expect(await statuses(fetch, [beta, beta, beta, beta, beta])).toEqual([200, 200, 200, 200, 200]);
  });
});

// ---------------------------------------------------------------------------
// §3 — the limiter STILL FIRES. A fix that merely disabled it would be worse
//      than the defect it replaced, so this is the load-bearing counter-test.
// ---------------------------------------------------------------------------

const CSRF = { Cookie: "scrml_csrf=tok123", "X-CSRF-Token": "tok123" };

const WITH_ROUTE = `<program ratelimit="2/min">
  <page>
    <h1>hi</h1>
    <button onclick={ping()}>ping</button>
  </page>

  \${
    function ping() {
      return process.env.SCRML_TEST_TOKEN
    }
  }
</program>
`;

describe("§3 the limiter still fires on real route traffic", () => {
  test("a server-fn route over its budget 429s", async () => {
    const { dir } = buildFixture("with-route", { "app.scrml": WITH_ROUTE });
    const fetch = await mountServer(dir);

    const route = { path: "/_scrml/__ri_route_ping_1", method: "POST", headers: CSRF };
    expectLimitedAfter(await statuses(fetch, [route, route, route, route]), 2);
  });

  test("the 429 carries Retry-After, per §39.2.4", async () => {
    const { dir } = buildFixture("with-route-retry-after", { "app.scrml": WITH_ROUTE });
    const fetch = await mountServer(dir);

    const path = "/_scrml/__ri_route_ping_1";
    for (let i = 0; i < 2; i++) await fetch(path, { method: "POST", headers: CSRF });
    const limited = await fetch(path, { method: "POST", headers: CSRF });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toEqual({ error: "Too Many Requests" });
  });

  test("static assets do not eat the route's budget", async () => {
    const { dir, assets } = buildFixture("route-plus-assets", { "app.scrml": WITH_ROUTE });
    const fetch = await mountServer(dir);

    // Spend far more than the budget on the page's own assets first...
    await statuses(fetch, [...pageLoadRequests(assets, "app.html"), ...pageLoadRequests(assets, "app.html")]);

    // ...the route budget is still intact, and still enforced.
    const route = { path: "/_scrml/__ri_route_ping_1", method: "POST", headers: CSRF };
    expectLimitedAfter(await statuses(fetch, [route, route, route]), 2);
  });
});

// ---------------------------------------------------------------------------
// §4 — a WebSocket upgrade route is not counted (SPEC §40.3.4: "handle() does
//      NOT apply to WebSocket upgrade requests"). Both hosts dispatch upgrades
//      before the onion, so this guards the module's own WinterCG `fetch`
//      export, where the WS route IS a member of `routes`.
// ---------------------------------------------------------------------------

const WITH_CHANNEL = `<program ratelimit="2/min">
  <page>
    <h1>chat</h1>
  </page>

  <channel name="chat" topic="general">
    \${
      <messages> = []
    }
  </>
</program>
`;

describe("§4 a WebSocket upgrade route is not counted", () => {
  test("repeated upgrades past the budget never reach the limiter", async () => {
    const { dir } = buildFixture("with-channel", { "app.scrml": WITH_CHANNEL });

    // Mount the module's onion directly with a probe downstream: the unit under
    // test is the limiter GATE, which runs before dispatch, and driving a real
    // upgrade through Bun.serve would need a live socket.
    const mod = await import(`file://${join(dir, "app.server.js")}?t=${Date.now()}`);
    expect(typeof mod._scrml_mw_pipeline).toBe("function");
    expect(mod.routes.some((r) => r.isWebSocket)).toBe(true);

    const wsPath = mod.routes.find((r) => r.isWebSocket).path;
    const gated = mod._scrml_mw_pipeline(async () => new Response(null, { status: 101 }));

    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push((await gated(new Request(`http://localhost${wsPath}`))).status);
    }
    expect(seen).toEqual([101, 101, 101, 101, 101]);
  });
});

// ---------------------------------------------------------------------------
// §5 — `scrml dev` agrees with `scrml build`. Both mount the same
//      `_scrml_mw_pipeline` export, so a divergence here would mean the fix
//      landed in only one dispatcher.
// ---------------------------------------------------------------------------

describe("§5 scrml dev agrees with scrml build", () => {
  test("dev serves a whole page load unthrottled but still limits the route", async () => {
    const { dir, assets, entryFiles } = buildFixture("dev-parity", { "app.scrml": WITH_ROUTE });
    await loadServerRoutes(dir);
    noteCompileResult({ errors: [] });

    const { fetch } = buildServeConfig({ port: 0, inputFiles: entryFiles }, dir);
    const drive = (path, init = {}) =>
      fetch(new Request(`http://localhost${path}`, init), { upgrade: () => false });

    for (const { path } of pageLoadRequests(assets, "app.html")) {
      expect((await drive(path)).status).toBe(200);
    }

    // Budget untouched by the page load, and still enforced on the route.
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push((await drive("/_scrml/__ri_route_ping_1", { method: "POST", headers: CSRF })).status);
    }
    expectLimitedAfter(seen, 2);
  });
});
