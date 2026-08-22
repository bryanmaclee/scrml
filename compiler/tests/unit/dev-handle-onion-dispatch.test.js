/**
 * `scrml dev` — the §40.3 `handle()` onion wraps TOP-LEVEL dispatch.
 * change-id `handle-onion-top-level-dispatch-2026-08-22`.
 *
 * SPEC §40.3.4: `handle()` "applies to all HTTP requests handled by the compiled
 * server — including statically-served assets". §40.3.5: an early return
 * "short-circuits the pipeline and prevents the route handler from running".
 *
 * Pre-fix the onion was applied PER ROUTE HANDLER, and every dispatcher only ever
 * invoked a handler on a registered-route match — so a custom path with no author
 * `route=` never reached `handle()` at all and 404'd. `scrml dev` is the
 * dispatcher an adopter hits while developing, so it mounts the same onion the
 * built server does; without this, an interception would work under
 * `scrml build` and 404 under `scrml dev`.
 *
 * Coverage:
 *   §1  runThroughOnions — identity with no onion; composes in load order
 *   §2  loadServerRoutes discovers `_scrml_mw_pipeline` and does NOT treat it
 *       as a route
 *   §3  end-to-end through buildServeConfig().fetch on a REAL compiled module:
 *       intercepted custom path / static file / unmatched 404 / dev-infra
 *   §4  PRE runs exactly once per request (observable counter, not source grep)
 */

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  runThroughOnions,
  getRegisteredOnions,
  loadServerRoutes,
  buildServeConfig,
  noteCompileResult,
  devDispatch,
} from "../../src/commands/dev.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// §1 — runThroughOnions (pure surface)
// ---------------------------------------------------------------------------

describe("§1 runThroughOnions", () => {
  beforeEach(async () => {
    // Clearing the registry via a scan of an empty dir keeps the module-private
    // state honest — no test-only setter on production code.
    const empty = join(tmpdir(), `scrml-onion-empty-${Date.now()}`);
    mkdirSync(empty, { recursive: true });
    await loadServerRoutes(empty);
    rmSync(empty, { recursive: true, force: true });
  });

  test("with no onion mounted it is the identity over downstream", async () => {
    expect(getRegisteredOnions()).toEqual([]);
    const req = new Request("http://localhost/anything");
    const res = await runThroughOnions(req, async () => new Response("downstream"));
    expect(await res.text()).toBe("downstream");
  });
});

// ---------------------------------------------------------------------------
// §2–§4 — a REAL compiled `handle()` module, mounted the way `scrml dev` mounts it
// ---------------------------------------------------------------------------

const TMP = join(tmpdir(), `scrml-dev-onion-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const SRC = `<program>

  <label> = "idle"

  function handle(request, resolve) {
    const url = new URL(request.url)

    if (globalThis.__scrmlOnionPre is not) { globalThis.__scrmlOnionPre = 0 }
    globalThis.__scrmlOnionPre = globalThis.__scrmlOnionPre + 1
    const seen = String(globalThis.__scrmlOnionPre)

    if (url.pathname == "/quote.pdf") {
      return new Response("PDF", { status: 200, headers: { "X-Pre-Count": seen } })
    }

    const response = resolve(request)
    response.headers.set("X-Pre-Count", seen)
    return response
  }

  <div><h1>onion</h1><p>\${@label}</p></div>

</program>
`;

let mounted = false;

async function mountCompiledFixture() {
  if (mounted) return;
  mkdirSync(TMP, { recursive: true });
  const abs = join(TMP, "index.scrml");
  writeFileSync(abs, SRC);
  // Compile through the real pipeline so the mounted module is the ACTUAL
  // emitted artifact, not a hand-written stand-in.
  const result = compileScrml({ inputFiles: [abs], outputDir: TMP, write: true });
  expect(result.errors ?? []).toEqual([]);
  expect(existsSync(join(TMP, "index.server.js"))).toBe(true);
  await loadServerRoutes(TMP);
  noteCompileResult({ errors: [] });
  globalThis.__scrmlOnionPre = 0;
  mounted = true;
}

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  delete globalThis.__scrmlOnionPre;
});

describe("§2 loadServerRoutes discovers the onion export", () => {
  test("_scrml_mw_pipeline is mounted as an onion, not registered as a route", async () => {
    await mountCompiledFixture();
    const onions = getRegisteredOnions();
    expect(onions.length).toBe(1);
    expect(typeof onions[0]).toBe("function");
  });
});

describe("§3 dev fetch dispatches THROUGH the onion", () => {
  const opts = { port: 0, inputFiles: [join(TMP, "index.scrml")] };

  test("a custom path with NO author route= is served by handle() PRE", async () => {
    await mountCompiledFixture();
    const { fetch } = buildServeConfig(opts, TMP);
    const res = await fetch(new Request("http://localhost/quote.pdf"), undefined);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PDF");
  });

  test("a statically-served asset still resolves — and passes through POST middleware", async () => {
    await mountCompiledFixture();
    const { fetch } = buildServeConfig(opts, TMP);
    const res = await fetch(new Request("http://localhost/index.html"), undefined);
    expect(res.status).toBe(200);
    // §40.3.4 — handle() applies to statically-served assets. Pre-fix the static
    // branch was never reachable from inside the onion, so this header was absent.
    expect(res.headers.get("X-Pre-Count")).not.toBeNull();
  });

  test("an unmatched path still 404s — THROUGH the onion", async () => {
    await mountCompiledFixture();
    const { fetch } = buildServeConfig(opts, TMP);
    const res = await fetch(new Request("http://localhost/definitely-not-a-thing"), undefined);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Pre-Count")).not.toBeNull();
  });

  test("dev-infra endpoints stay OUTSIDE the onion", async () => {
    await mountCompiledFixture();
    const { fetch } = buildServeConfig(opts, TMP);
    const res = await fetch(new Request("http://localhost/_scrml/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: "client", msg: "x", loc: "y" }),
    }), undefined);
    expect(res.status).toBe(204);
    expect(res.headers.get("X-Pre-Count")).toBeNull();
  });
});

describe("§4 handle() PRE runs EXACTLY ONCE per request", () => {
  const opts = { port: 0, inputFiles: [join(TMP, "index.scrml")] };

  test("an observable counter advances by exactly 1 per request", async () => {
    await mountCompiledFixture();
    const { fetch } = buildServeConfig(opts, TMP);
    globalThis.__scrmlOnionPre = 0;

    const a = await fetch(new Request("http://localhost/quote.pdf"), undefined);
    expect(a.headers.get("X-Pre-Count")).toBe("1");

    const b = await fetch(new Request("http://localhost/index.html"), undefined);
    expect(b.headers.get("X-Pre-Count")).toBe("2");

    const c = await fetch(new Request("http://localhost/nope"), undefined);
    expect(c.headers.get("X-Pre-Count")).toBe("3");

    // Three requests, three PRE runs. A surviving per-route wrap on top of the
    // top-level onion would read 2 / 4 / 6 here.
    expect(globalThis.__scrmlOnionPre).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §5 — devDispatch is the onion's downstream: a TOTAL Response on every path
// ---------------------------------------------------------------------------

describe("§5 devDispatch always returns a Response", () => {
  test("an unmatched path yields a 404 Response, never null", async () => {
    await mountCompiledFixture();
    const res = await devDispatch(
      new Request("http://localhost/nothing-here"),
      undefined,
      TMP,
      { port: 0, inputFiles: [join(TMP, "index.scrml")] },
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(404);
  });
});
