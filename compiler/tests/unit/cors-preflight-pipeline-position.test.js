/**
 * §40.3.3 — `[CORS preflight]` is the FIRST pipeline stage.
 *
 * SPEC §40.3.3 pins the order:
 *
 *   [CORS preflight] -> [rate limit] -> handle() PRE -> [CSRF check]
 *     -> [route dispatch] -> handle() POST -> [security headers] -> [logging]
 *
 * THE DEFECT. The preflight was implemented ONLY as the `_scrml_cors_options_route`
 * registry entry. Once the `handle()` onion was hoisted to wrap top-level dispatch,
 * that registry became `resolve()`'s DOWNSTREAM — so the preflight moved from stage
 * 1 to a position after handle() PRE and after the rate limiter. Measured on the
 * pre-fix branch with `<program cors="*">` + a `handle()` that stamps `X-H`:
 *
 *   OPTIONS /api/thing  ->  404, X-H: 1     (handle() ran on the preflight)
 *
 * That is not cosmetic. A browser preflight is credential-less by construction, so
 * an author `handle()` that early-returns 403 for unauthenticated requests — the
 * canonical §40.3.5 shape — refuses every preflight the browser sends, and the
 * cross-origin app cannot make a single request.
 *
 * The `_scrml_cors_options_route` export is NOT removed: the §64 serve-target tool
 * host matches `path: "/*"` (emit-tool.ts) so it is live there. The `_server.js`
 * and `scrml dev` hosts match a path literally, so the onion stage is the one that
 * answers for them — at the position §40.3.3 names.
 *
 * These tests EXECUTE. They compile a real fixture, compose the real production
 * `_server.js` through `build.js`, import it with `Bun.serve` captured, and drive
 * `cfg.fetch(...)` with real `Request` objects. The defect was an ORDERING one: the
 * emitted text was well-formed either way, so a grep could not see it.
 *
 * Coverage:
 *   §1  a preflight is answered 204 + CORS headers and never reaches handle()
 *   §2  a `handle()` that early-returns 403 does NOT block a preflight
 *   §3  the preflight precedes the RATE LIMITER (never 429, never counted)
 *   §4  every non-OPTIONS request still enters handle() PRE
 *   §5  `scrml dev` agrees with `scrml build`
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";
import { discoverServerRoutes, generateServerEntry } from "../../src/commands/build.js";
import { loadServerRoutes, buildServeConfig, noteCompileResult } from "../../src/commands/dev.js";

const TMP_ROOT = join(tmpdir(), `scrml-cors-order-${Date.now()}-${Math.random().toString(36).slice(2)}`);

afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** Compile a fixture and write the production `_server.js` `scrml build` emits. */
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
  expect((result.errors ?? []).filter((e) => (e.severity ?? "error") === "error")).toEqual([]);

  writeFileSync(join(dist, "_server.js"), generateServerEntry(discoverServerRoutes(dist)));
  return { dir: dist, entryFiles };
}

/** Import an emitted `_server.js` and return a driver over its captured `fetch`. */
async function mountServer(dist) {
  const realServe = Bun.serve;
  const realRequestIP = Bun.requestIP;
  const realLog = console.log;
  let captured = null;

  Bun.serve = (cfg) => { captured = cfg; return { port: 0, stop() {}, publish() {}, upgrade: () => false }; };
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

/** The headers a browser actually sends on a CORS preflight. */
const PREFLIGHT = {
  origin: "https://other.test",
  "access-control-request-method": "POST",
  "access-control-request-headers": "content-type",
};

/** `<program cors="*">` plus a `handle()` that stamps every response it touches. */
const CORS_AND_HANDLE = `<program cors="*">

\${
  function handle(request, resolve) {
    const response = resolve(request)
    response.headers.set("X-H", "1")
    return response
  }
}

  <h1>App</h1>
</program>
`;

/** The §40.3.5 early-return shape: refuse anything without an Authorization header. */
const CORS_AND_AUTH_GATE = `<program cors="*">

\${
  function handle(request, resolve) {
    if (request.headers.get("Authorization") is not) {
      return new Response("Forbidden", { status: 403 })
    }
    return resolve(request)
  }
}

  <h1>App</h1>
</program>
`;

/** CORS plus a rate limit small enough that a handful of preflights would trip it. */
const CORS_AND_RATELIMIT = `<program cors="*" ratelimit="2/min">
  <h1>App</h1>
</program>
`;

// ---------------------------------------------------------------------------
// §1 — the preflight is answered at stage 1
// ---------------------------------------------------------------------------

describe("§1 a CORS preflight is answered before handle()", () => {
  test("OPTIONS is 204 with CORS headers and is NOT stamped by handle()", async () => {
    const { dir } = buildFixture("preflight-basic", { "app.scrml": CORS_AND_HANDLE });
    const fetch = await mountServer(dir);

    const res = await fetch("/api/thing", { method: "OPTIONS", headers: PREFLIGHT });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    // THE ASSERTION: handle() did not see it. Pre-fix this was "1".
    expect(res.headers.get("x-h")).toBeNull();
  });

  test("the preflight is answered on ANY path, not only a registered route", async () => {
    const { dir } = buildFixture("preflight-anypath", { "app.scrml": CORS_AND_HANDLE });
    const fetch = await mountServer(dir);

    for (const path of ["/", "/api/thing", "/deeply/nested/thing", "/app.html"]) {
      const res = await fetch(path, { method: "OPTIONS", headers: PREFLIGHT });
      expect(res.status, `OPTIONS ${path}`).toBe(204);
      expect(res.headers.get("x-h"), `OPTIONS ${path}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the adopter consequence: an auth gate in handle() must not refuse a
//      preflight. A browser preflight carries no credentials, by design.
// ---------------------------------------------------------------------------

describe("§2 a handle() auth gate does not block the browser's preflight", () => {
  test("the credential-less preflight is 204, while a real request is still 403", async () => {
    const { dir } = buildFixture("preflight-authgate", { "app.scrml": CORS_AND_AUTH_GATE });
    const fetch = await mountServer(dir);

    const preflight = await fetch("/api/thing", { method: "OPTIONS", headers: PREFLIGHT });
    expect(preflight.status).toBe(204);

    // The gate is still doing its job on the request that follows the preflight.
    const unauthorized = await fetch("/api/thing", { method: "POST", headers: { origin: "https://other.test" } });
    expect(unauthorized.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// §3 — [CORS preflight] precedes [rate limit]
// ---------------------------------------------------------------------------

describe("§3 the preflight precedes the rate limiter", () => {
  test("preflights well past a 2/min budget are all 204, never 429", async () => {
    const { dir } = buildFixture("preflight-ratelimit", { "app.scrml": CORS_AND_RATELIMIT });
    const fetch = await mountServer(dir);

    const seen = [];
    for (let i = 0; i < 8; i++) {
      seen.push((await fetch("/api/thing", { method: "OPTIONS", headers: PREFLIGHT })).status);
    }
    expect(seen).toEqual(new Array(8).fill(204));
  });
});

// ---------------------------------------------------------------------------
// §4 — everything that is NOT a preflight still enters handle() PRE
// ---------------------------------------------------------------------------

describe("§4 non-OPTIONS traffic still enters the onion", () => {
  test("a GET for a static asset is still stamped by handle()", async () => {
    const { dir } = buildFixture("nonoptions", { "app.scrml": CORS_AND_HANDLE });
    const fetch = await mountServer(dir);

    const res = await fetch("/app.html");
    expect(res.status).toBe(200);
    // §40.3.4 — handle() applies to statically-served assets too.
    expect(res.headers.get("x-h")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a POST to an unmatched path is still stamped by handle()", async () => {
    const { dir } = buildFixture("nonoptions-post", { "app.scrml": CORS_AND_HANDLE });
    const fetch = await mountServer(dir);

    const res = await fetch("/api/thing", { method: "POST" });
    expect(res.headers.get("x-h")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// §5 — `scrml dev` mounts the same `_scrml_mw_pipeline`, so it must agree
// ---------------------------------------------------------------------------

describe("§5 scrml dev agrees with scrml build", () => {
  test("dev answers the preflight 204 without entering handle()", async () => {
    const { dir, entryFiles } = buildFixture("dev-preflight", { "app.scrml": CORS_AND_HANDLE });
    await loadServerRoutes(dir);
    noteCompileResult({ errors: [], warnings: [] });

    const { fetch } = buildServeConfig({ port: 0, inputFiles: entryFiles }, dir);
    const drive = (path, init = {}) =>
      fetch(new Request(`http://localhost${path}`, init), { upgrade: () => false });

    const preflight = await drive("/api/thing", { method: "OPTIONS", headers: PREFLIGHT });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("x-h")).toBeNull();

    // ...and dev still runs handle() on ordinary traffic.
    const page = await drive("/app.html");
    expect(page.headers.get("x-h")).toBe("1");

    // Leave the module-private dev registries clean for sibling test files.
    const empty = join(TMP_ROOT, "dev-preflight-empty");
    mkdirSync(empty, { recursive: true });
    await loadServerRoutes(empty);
    noteCompileResult({ errors: [], warnings: [] });
  });
});
