/**
 * §40.3/§40.8 — EXACTLY ONE `handle()` onion runs per request, and which one is
 * read off the SOURCE, never off filename order.
 *
 * THE DEFECT (measured on this branch before the fix, two modules each with
 * `handle()` + `log="structured"`, two requests, a real built server):
 *
 *     ALPHA-PRE x 3   BETA-PRE x 3      (3 requests -> 6 onion runs)
 *     GET /alpha.html -> X-Alpha: 1, X-Beta: 1
 *     GET /beta.html  -> X-Alpha: 1, X-Beta: 1
 *
 * alpha's `handle()` ran on beta's page and beta's on alpha's. Worse, the
 * composition order was the module-discovery order, which is FILENAME-sorted —
 * measured against the pre-fix `generateServerEntry`:
 *
 *     alpha.scrml + beta.scrml               -> outermost = alpha.server.js
 *     alpha.scrml + aaa.scrml (beta RENAMED) -> outermost = aaa.server.js
 *
 * A rename silently changed which `handle()` won a contested path.
 *
 * THE RULE. The onion is APPLICATION-scope: §40.3.4 applies it to every HTTP
 * request the compiled server handles, and §40.8 makes the `<program>` middleware
 * attributes app-scope and declares the top-level `<program>` exactly ONCE per
 * application, in the entry file. So a compiled server mounts exactly one onion.
 * More than one candidate is more than one application in one server — reported
 * as `E-MW-007` naming every competing source, never resolved by filename.
 *
 * ⚠ ORACLE DISCIPLINE. A reviewer flagged the sibling `build-adapters.test.js`
 * for asserting `_scrml_onions = [_0, _1]` as TEXT while never executing what it
 * means. Every load-bearing assertion below EXECUTES the emitted dispatcher: the
 * generated `_server.js` is evaluated with `Bun.serve` stubbed to capture its
 * `fetch`, and that real `fetch` is driven with real `Request` objects.
 */

import { describe, test, expect } from "bun:test";
import { generateServerEntry } from "../../src/commands/build.js";

// ---------------------------------------------------------------------------
// Execute the emitted _server.js
// ---------------------------------------------------------------------------

/**
 * Evaluate a generated `_server.js` and hand back its real `fetch` handler.
 *
 * The emitted module is unmodified except for its ESM framing: the static
 * imports are replaced by injected bindings (the same technique the SSR
 * first-paint harnesses use), and `Bun.serve` is stubbed so the module body runs
 * without opening a socket. Everything under test — `_scrml_onion_dispatch`, the
 * route loop, the static-file fall-through, the 404 — is the emitted code.
 */
function bootEmittedServer(serverEntry, { onions, routes: extraRoutes = [] }) {
  const importNames = [];
  const body = serverEntry
    // Drop the node imports; the stubs below supply them.
    .replace(/^import \{ statSync \} from "fs";$/m, "")
    .replace(/^import \{ join, relative \} from "path";$/m, "")
    // Capture + drop each route-module import, recording the local names so the
    // harness can bind them.
    .replace(/^import \{ ([^}]*) \} from "\.\/[^"]+";$/gm, (_all, specs) => {
      for (const spec of specs.split(",")) {
        const local = spec.trim().split(/\s+as\s+/).pop().trim();
        if (local) importNames.push(local);
      }
      return "";
    })
    .replace(/import\.meta\.dir/g, JSON.stringify("/dist"));

  let captured = null;
  const BunStub = {
    serve: (config) => { captured = config; return { reload() {}, stop() {} }; },
    file: () => ({ text: async () => "" }),
  };

  const args = ["Bun", "statSync", "join", "relative", ...importNames];
  const vals = [
    BunStub,
    () => { throw new Error("ENOENT"); },   // no static files in this harness
    (...p) => p.join("/"),
    (a, b) => b,
    ...importNames.map((n) => onions[n]),
  ];

  const run = new Function(...args, `${body}\nreturn { routes };`);
  const mod = run(...vals);
  for (const r of extraRoutes) mod.routes.push(r);
  if (!captured) throw new Error("emitted server never called Bun.serve");
  return { fetch: (req) => captured.fetch(req, { upgrade: () => false }), routes: mod.routes };
}

/**
 * A `handle()` onion in the shape emit-server.ts produces: `wrap(downstream)`
 * returns the per-request handler. Records every PRE it runs and stamps its POST
 * header, so a test can count runs and see whose onion touched a response.
 */
function makeOnion(tag, log) {
  return (downstream) => async (request) => {
    log.push(`${tag}-PRE`);
    const response = await downstream(request);
    response.headers.set(`X-${tag}`, "1");
    return response;
  };
}

const ROUTE_HOME = {
  path: "/home",
  method: "GET",
  handler: () => new Response("home", { status: 200 }),
};

// ---------------------------------------------------------------------------
// 1. one onion, one run per request — including the paths no route matches
// ---------------------------------------------------------------------------

describe("§40.3 — the application onion runs exactly once per request", () => {
  test("EXECUTING: one PRE per request across a route match, a 404, and a custom path", async () => {
    const entry = generateServerEntry([
      {
        filename: "index.server.js",
        routeNames: ["_scrml_route_home"],
        wsHandlerNames: [],
        middlewareNames: ["_scrml_mw_pipeline"],
        middlewareDeclaredIn: "index.scrml",
      },
    ]);
    const log = [];
    const server = bootEmittedServer(entry, {
      onions: {
        _scrml_mw_pipeline_0: makeOnion("Entry", log),
        _scrml_route_home: ROUTE_HOME,
      },
      routes: [ROUTE_HOME],
    });

    const paths = ["/home", "/definitely-not-a-route", "/quote.pdf"];
    const responses = [];
    for (const p of paths) responses.push(await server.fetch(new Request("http://x" + p)));

    // ONE onion run per request — not zero (the pre-§40.3 defect) and not N.
    expect(log).toEqual(["Entry-PRE", "Entry-PRE", "Entry-PRE"]);
    // §40.3.4: the onion sees EVERY request, including the ones no route matches.
    expect(responses.map((r) => r.headers.get("X-Entry"))).toEqual(["1", "1", "1"]);
    expect(responses.map((r) => r.status)).toEqual([200, 404, 404]);
  });

  test("EXECUTING: handle() may short-circuit — resolve() is never called and the route never runs", async () => {
    const entry = generateServerEntry([
      {
        filename: "index.server.js",
        routeNames: ["_scrml_route_home"],
        wsHandlerNames: [],
        middlewareNames: ["_scrml_mw_pipeline"],
        middlewareDeclaredIn: "index.scrml",
      },
    ]);
    let routeRuns = 0;
    const countingRoute = {
      path: "/home", method: "GET",
      handler: () => { routeRuns++; return new Response("home"); },
    };
    // §40.3.5 — an early return short-circuits the pipeline.
    const intercepting = () => async (request) =>
      new URL(request.url).pathname === "/quote.pdf"
        ? new Response("PDF", { status: 200 })
        : new Response("fell through", { status: 500 });

    const server = bootEmittedServer(entry, {
      onions: { _scrml_mw_pipeline_0: intercepting, _scrml_route_home: countingRoute },
      routes: [countingRoute],
    });

    const res = await server.fetch(new Request("http://x/quote.pdf"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PDF");
    expect(routeRuns).toBe(0);
  });

  test("EXECUTING: a build with NO onion dispatches exactly as it did pre-§40.3", async () => {
    const entry = generateServerEntry([
      { filename: "index.server.js", routeNames: ["_scrml_route_home"], wsHandlerNames: [] },
    ]);
    const server = bootEmittedServer(entry, {
      onions: { _scrml_route_home: ROUTE_HOME },
      routes: [ROUTE_HOME],
    });
    const hit = await server.fetch(new Request("http://x/home"));
    const miss = await server.fetch(new Request("http://x/nope"));
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe("home");
    expect(miss.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 2. two applications is E-MW-007, and it is rename-invariant
// ---------------------------------------------------------------------------

describe("§40.8 — a second application's onion is E-MW-007, never a filename race", () => {
  const appA = {
    filename: "alpha.server.js", routeNames: [], wsHandlerNames: [],
    middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "alpha.scrml",
  };
  const appB = {
    filename: "beta.server.js", routeNames: [], wsHandlerNames: [],
    middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "beta.scrml",
  };
  // What `beta.scrml -> aaa.scrml` does to the module list: it sorts FIRST.
  const appBRenamed = {
    filename: "aaa.server.js", routeNames: [], wsHandlerNames: [],
    middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "aaa.scrml",
  };

  function generate(mods) {
    try { return { entry: generateServerEntry(mods), err: null }; }
    catch (e) { return { entry: null, err: e }; }
  }

  test("two onion-hosting modules -> E-MW-007 naming both sources", () => {
    const { entry, err } = generate([appA, appB]);
    expect(entry).toBeNull();
    expect(err.scrmlCode).toBe("E-MW-007");
    expect(err.scrmlSources).toEqual(["alpha.scrml", "beta.scrml"]);
    expect(err.message).toContain("§40.8");
  });

  test("RENAME INVARIANCE: reordering the modules changes nothing but the names reported", () => {
    const before = generate([appA, appB]);
    const after = generate([appBRenamed, appA]);   // as the rename would sort them
    expect(before.err.scrmlCode).toBe("E-MW-007");
    expect(after.err.scrmlCode).toBe("E-MW-007");
    // Pre-fix, THIS is where the outermost handle() silently flipped.
    expect(after.entry).toBeNull();
  });

  test("EXECUTING: the surviving single-application build is unaffected by a sibling rename", async () => {
    for (const declaredIn of ["alpha.scrml", "aaa.scrml", "zzz.scrml"]) {
      const entry = generateServerEntry([
        { filename: declaredIn.replace(".scrml", ".server.js"), routeNames: [], wsHandlerNames: [],
          middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: declaredIn },
      ]);
      const log = [];
      const server = bootEmittedServer(entry, {
        onions: { _scrml_mw_pipeline_0: makeOnion("Only", log) },
      });
      const res = await server.fetch(new Request("http://x/anything"));
      expect(log).toEqual(["Only-PRE"]);
      expect(res.headers.get("X-Only")).toBe("1");
      expect(entry).toContain(`// Declared in ${declaredIn}.`);
    }
  });
});
