/**
 * Tests for scrml build --target deployment adapters.
 *
 * Tests:
 *  - parseArgs --target flag parsing
 *  - Each adapter function: fly, railway, render, docker
 *  - Static target warning behavior (W-DEPLOY-001)
 *  - generateDockerfile content
 *  - discoverServerRoutes WebSocket channel handling (§38 regressions)
 *  - generateServerEntry WebSocket channel wiring (§38 regressions)
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  parseArgs,
  generateDockerfile,
  applyFlyAdapter,
  applyRailwayAdapter,
  applyRenderAdapter,
  applyDockerAdapter,
  discoverServerRoutes,
  generateServerEntry,
} from "../../src/commands/build.js";

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir;

function setupTmp() {
  tmpDir = join(tmpdir(), `scrml-build-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
}

function teardownTmp() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// parseArgs — --target flag
// ---------------------------------------------------------------------------

describe("parseArgs --target", () => {
  test("returns null target when not specified", () => {
    const result = parseArgs([]);
    expect(result.target).toBeNull();
  });

  test("parses --target fly", () => {
    const result = parseArgs(["--target", "fly"]);
    expect(result.target).toBe("fly");
  });

  test("parses --target railway", () => {
    const result = parseArgs(["--target", "railway"]);
    expect(result.target).toBe("railway");
  });

  test("parses --target render", () => {
    const result = parseArgs(["--target", "render"]);
    expect(result.target).toBe("render");
  });

  test("parses --target static", () => {
    const result = parseArgs(["--target", "static"]);
    expect(result.target).toBe("static");
  });

  test("parses --target docker", () => {
    const result = parseArgs(["--target", "docker"]);
    expect(result.target).toBe("docker");
  });

  test("--target does not interfere with other flags", () => {
    const result = parseArgs(["--target", "fly", "--embed-runtime", "--verbose"]);
    expect(result.target).toBe("fly");
    expect(result.embedRuntime).toBe(true);
    expect(result.verbose).toBe(true);
  });

  test("parses --output alongside --target", () => {
    const result = parseArgs(["--output", "out/", "--target", "render"]);
    expect(result.outputDir).toBe("out/");
    expect(result.target).toBe("render");
  });
});

// ---------------------------------------------------------------------------
// generateDockerfile
// ---------------------------------------------------------------------------

describe("generateDockerfile", () => {
  test("contains FROM oven/bun:1.2", () => {
    const content = generateDockerfile();
    expect(content).toContain("FROM oven/bun:1.2");
  });

  test("contains WORKDIR /app", () => {
    const content = generateDockerfile();
    expect(content).toContain("WORKDIR /app");
  });

  test("contains COPY . .", () => {
    const content = generateDockerfile();
    expect(content).toContain("COPY . .");
  });

  test("contains EXPOSE line", () => {
    const content = generateDockerfile();
    expect(content).toContain("EXPOSE");
  });

  test("CMD runs bun _server.js", () => {
    const content = generateDockerfile();
    expect(content).toContain("_server.js");
    expect(content).toContain("bun");
  });
});

// ---------------------------------------------------------------------------
// applyFlyAdapter
// ---------------------------------------------------------------------------

describe("applyFlyAdapter", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("writes Dockerfile to output dir", () => {
    applyFlyAdapter(tmpDir, "my-app");
    expect(existsSync(join(tmpDir, "Dockerfile"))).toBe(true);
  });

  test("writes fly.toml to output dir", () => {
    applyFlyAdapter(tmpDir, "my-app");
    expect(existsSync(join(tmpDir, "fly.toml"))).toBe(true);
  });

  test("fly.toml contains app name", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain('app = "my-app"');
  });

  test("fly.toml has primary_region iad", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain('primary_region = "iad"');
  });

  test("fly.toml has internal_port 3000", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain("internal_port = 3000");
  });

  test("fly.toml has force_https = true", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain("force_https = true");
  });

  test("fly.toml health check path is /_scrml/health", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain('path = "/_scrml/health"');
  });

  test("Dockerfile has correct content", () => {
    applyFlyAdapter(tmpDir, "my-app");
    const content = readFileSync(join(tmpDir, "Dockerfile"), "utf8");
    expect(content).toContain("FROM oven/bun:1.2");
    expect(content).toContain("_server.js");
  });

  test("uses provided app name in fly.toml", () => {
    applyFlyAdapter(tmpDir, "cool-project-123");
    const content = readFileSync(join(tmpDir, "fly.toml"), "utf8");
    expect(content).toContain('app = "cool-project-123"');
  });
});

// ---------------------------------------------------------------------------
// applyDockerAdapter
// ---------------------------------------------------------------------------

describe("applyDockerAdapter", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("writes Dockerfile to output dir", () => {
    applyDockerAdapter(tmpDir);
    expect(existsSync(join(tmpDir, "Dockerfile"))).toBe(true);
  });

  test("does NOT write fly.toml", () => {
    applyDockerAdapter(tmpDir);
    expect(existsSync(join(tmpDir, "fly.toml"))).toBe(false);
  });

  test("Dockerfile matches generateDockerfile()", () => {
    applyDockerAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "Dockerfile"), "utf8");
    expect(content).toBe(generateDockerfile());
  });
});

// ---------------------------------------------------------------------------
// applyRailwayAdapter
// ---------------------------------------------------------------------------

describe("applyRailwayAdapter", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("creates package.json if it does not exist", () => {
    applyRailwayAdapter(tmpDir);
    expect(existsSync(join(tmpDir, "package.json"))).toBe(true);
  });

  test("new package.json has scripts.start = 'bun _server.js'", () => {
    applyRailwayAdapter(tmpDir);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("bun _server.js");
  });

  test("new package.json has name and version fields", () => {
    applyRailwayAdapter(tmpDir);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.name).toBeDefined();
    expect(pkg.version).toBeDefined();
  });

  test("merges scripts.start into existing package.json without scripts", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "existing-app", version: "2.0.0" }, null, 2)
    );
    applyRailwayAdapter(tmpDir);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("bun _server.js");
    expect(pkg.name).toBe("existing-app");
    expect(pkg.version).toBe("2.0.0");
  });

  test("merges scripts.start into existing package.json with other scripts", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", scripts: { test: "bun test" } }, null, 2)
    );
    applyRailwayAdapter(tmpDir);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("bun _server.js");
    expect(pkg.scripts.test).toBe("bun test");
  });

  test("does NOT overwrite existing scripts.start", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", scripts: { start: "node custom-server.js" } }, null, 2)
    );
    applyRailwayAdapter(tmpDir);
    const pkg = JSON.parse(readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(pkg.scripts.start).toBe("node custom-server.js");
  });

  test("output is valid JSON (pretty-printed)", () => {
    applyRailwayAdapter(tmpDir);
    const raw = readFileSync(join(tmpDir, "package.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    // Pretty-printed: should have newlines
    expect(raw).toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// applyRenderAdapter
// ---------------------------------------------------------------------------

describe("applyRenderAdapter", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("writes render.yaml to output dir", () => {
    applyRenderAdapter(tmpDir);
    expect(existsSync(join(tmpDir, "render.yaml"))).toBe(true);
  });

  test("render.yaml type is web", () => {
    applyRenderAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "render.yaml"), "utf8");
    expect(content).toContain("type: web");
  });

  test("render.yaml runtime is bun", () => {
    applyRenderAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "render.yaml"), "utf8");
    expect(content).toContain("runtime: bun");
  });

  test("render.yaml startCommand is bun _server.js", () => {
    applyRenderAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "render.yaml"), "utf8");
    expect(content).toContain("startCommand: bun _server.js");
  });

  test("render.yaml has healthCheckPath", () => {
    applyRenderAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "render.yaml"), "utf8");
    expect(content).toContain("healthCheckPath: /_scrml/health");
  });

  test("render.yaml has services list at top level", () => {
    applyRenderAdapter(tmpDir);
    const content = readFileSync(join(tmpDir, "render.yaml"), "utf8");
    expect(content.startsWith("services:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverServerRoutes and generateServerEntry (existing functionality)
// ---------------------------------------------------------------------------

describe("discoverServerRoutes", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("returns empty array when outputDir has no server files", () => {
    const result = discoverServerRoutes(tmpDir);
    expect(result).toEqual([]);
  });

  test("returns empty array for non-existent directory", () => {
    const result = discoverServerRoutes(join(tmpDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  test("discovers routes from a .server.js file", () => {
    writeFileSync(
      join(tmpDir, "index.server.js"),
      `export const _scrml_route_get_users = { path: "/users", method: "GET", handler: () => {} };`
    );
    const result = discoverServerRoutes(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("index.server.js");
    expect(result[0].routeNames).toContain("_scrml_route_get_users");
  });

  test("discovers __ri_route_* inferred server-function routes (regression: these lack the _scrml_ prefix and were silently dropped → server functions 404 in a production build)", () => {
    writeFileSync(
      join(tmpDir, "index.server.js"),
      `export const __ri_route_authenticate_1 = { path: "/_scrml/__ri_route_authenticate_1", method: "POST", handler: () => {} };`
    );
    const result = discoverServerRoutes(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].routeNames).toContain("__ri_route_authenticate_1");
  });

  test("ignores non-server.js files", () => {
    writeFileSync(join(tmpDir, "index.client.js"), "export const x = 1;");
    writeFileSync(join(tmpDir, "index.html"), "<html></html>");
    const result = discoverServerRoutes(tmpDir);
    expect(result).toEqual([]);
  });
});

describe("generateServerEntry", () => {
  test("generates valid server entry with no modules", () => {
    const content = generateServerEntry([]);
    expect(content).toContain("scrml production server");
    expect(content).toContain("Bun.serve");
    expect(content).toContain("/_scrml/health");
    expect(content).toContain("const routes = []");
  });

  test("generates imports for server modules", () => {
    const content = generateServerEntry([
      { filename: "app.server.js", routeNames: ["_scrml_route_home"] },
    ]);
    expect(content).toContain('import { _scrml_route_home } from "./app.server.js"');
  });

  test("wires __ri_route_* server-function routes into the server entry (regression)", () => {
    const content = generateServerEntry([
      { filename: "index.server.js", routeNames: ["__ri_route_authenticate_1"] },
    ]);
    expect(content).toContain('import { __ri_route_authenticate_1 } from "./index.server.js"');
    expect(content).toContain("__ri_route_authenticate_1");
  });
});

// ---------------------------------------------------------------------------
// §40.3 — the handle() onion wraps TOP-LEVEL dispatch in the production server
// (change-id `handle-onion-top-level-dispatch-2026-08-22`).
//
// SPEC §40.3.4: handle() "applies to all HTTP requests handled by the compiled
// server — including statically-served assets". The pre-fix production fetch
// only ever reached a handler on a REGISTERED-ROUTE match, so a custom path with
// no author `route=` 404'd before handle() PRE could short-circuit it.
// ---------------------------------------------------------------------------

describe("§40.3 handle() onion in the production server entry", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("discoverServerRoutes separates _scrml_mw_pipeline from routes", () => {
    writeFileSync(
      join(tmpDir, "index.server.js"),
      [
        "export const _scrml_route_home = { path: '/', method: 'GET', handler: h };",
        "export const _scrml_mw_pipeline = _scrml_mw_wrap;",
      ].join("\n"),
    );
    const [mod] = discoverServerRoutes(tmpDir);
    expect(mod.routeNames).toEqual(["_scrml_route_home"]);
    expect(mod.middlewareNames).toEqual(["_scrml_mw_pipeline"]);
    // The onion is a wrapper FUNCTION — putting it in `routes` would break the
    // `{ path, method, handler }` match loop and lose the onion entirely.
    expect(mod.routeNames).not.toContain("_scrml_mw_pipeline");
  });

  test("a module with ONLY the onion (zero routes) is still discovered", () => {
    writeFileSync(
      join(tmpDir, "index.server.js"),
      "export const _scrml_mw_pipeline = _scrml_mw_wrap;\n",
    );
    const [mod] = discoverServerRoutes(tmpDir);
    expect(mod).toBeDefined();
    expect(mod.routeNames).toEqual([]);
    expect(mod.middlewareNames).toEqual(["_scrml_mw_pipeline"]);
  });

  test("the emitted fetch delegates to the onion, and dispatch becomes a named fn", () => {
    const content = generateServerEntry([
      {
        filename: "index.server.js",
        routeNames: ["_scrml_route_home"],
        wsHandlerNames: [],
        middlewareNames: ["_scrml_mw_pipeline"],
      },
    ]);
    expect(content).toContain(
      'import { _scrml_route_home, _scrml_mw_pipeline as _scrml_mw_pipeline_0 } from "./index.server.js";',
    );
    expect(content).toContain("async function _scrml_dispatch(req, server) {");
    // §40.8 — ONE application onion, wrapped once. Not a fold over a list.
    expect(content).toContain("return _scrml_mw_pipeline_0(downstream)(req);");
    expect(content).not.toContain("_scrml_onions");
    expect(content).toContain("return _scrml_onion_dispatch(req, server);");
    // The FULL remainder — route match, static file, AND the 404 — is downstream
    // of the onion, so resolve() returns a Response on every path.
    const dispatch = content.slice(content.indexOf("async function _scrml_dispatch"));
    expect(dispatch).toContain("for (const route of routes) {");
    expect(dispatch).toContain("// Static file serving");
    expect(dispatch).toContain('return new Response("Not found", { status: 404 });');
    // …and `fetch` no longer inlines the loop.
    const fetchBody = content.slice(content.indexOf("async fetch(req, server) {"));
    expect(fetchBody).not.toContain("for (const route of routes) {");
  });

  test("TWO applications in one build is E-MW-007 — never a filename-ordered composition", () => {
    // §40.3.4 makes the onion apply to EVERY request the compiled server
    // handles, and §40.8 declares the top-level <program> exactly once per
    // application. Two onion-hosting modules is two applications in one server:
    // the server cannot know which one governs a request that belongs to
    // neither. Composing them ran every module's handle() PRE on every other
    // module's page, and the composition order was the module list — which is
    // FILENAME-sorted, so a rename silently changed which handle() won.
    const twoApps = [
      { filename: "a.server.js", routeNames: ["_scrml_route_a"], wsHandlerNames: [], middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "a.scrml" },
      { filename: "b.server.js", routeNames: ["_scrml_route_b"], wsHandlerNames: [], middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "b.scrml" },
    ];
    let err = null;
    try { generateServerEntry(twoApps); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.scrmlCode).toBe("E-MW-007");
    // The diagnostic NAMES both competing sources — the author does not have to
    // guess which file the compiler was looking at.
    expect(err.scrmlSources).toEqual(["a.scrml", "b.scrml"]);
    expect(err.message).toContain("a.scrml");
    expect(err.message).toContain("b.scrml");

    // RENAME INVARIANCE: swapping the order (as a rename would) changes the
    // NAMES reported and nothing else. Pre-fix this flipped which handle() was
    // outermost, silently.
    const renamed = [
      { filename: "aaa.server.js", routeNames: [], wsHandlerNames: [], middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "aaa.scrml" },
      { filename: "a.server.js", routeNames: ["_scrml_route_a"], wsHandlerNames: [], middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "a.scrml" },
    ];
    let err2 = null;
    try { generateServerEntry(renamed); } catch (e) { err2 = e; }
    expect(err2).not.toBeNull();
    expect(err2.scrmlCode).toBe("E-MW-007");
  });

  test("the ONE application onion is imported under an alias and mounted once", () => {
    const content = generateServerEntry([
      { filename: "a.server.js", routeNames: ["_scrml_route_a"], wsHandlerNames: [] },
      { filename: "b.server.js", routeNames: ["_scrml_route_b"], wsHandlerNames: [], middlewareNames: ["_scrml_mw_pipeline"], middlewareDeclaredIn: "b.scrml" },
    ]);
    // The alias is stable regardless of which module hosts the onion.
    expect(content).toContain('_scrml_mw_pipeline as _scrml_mw_pipeline_0 } from "./b.server.js";');
    expect(content).not.toContain('from "./a.server.js";\nimport { _scrml_mw_pipeline');
    // The declaring SOURCE is named in the emitted server, so a reader of the
    // artifact can see which .scrml owns the pipeline.
    expect(content).toContain("// Declared in b.scrml.");
    expect(content).toContain("return _scrml_mw_pipeline_0(downstream)(req);");
  });

  test("a WebSocket upgrade BYPASSES the onion (§40.3.4)", () => {
    const content = generateServerEntry([
      {
        filename: "chat.server.js",
        routeNames: ["_scrml_route_ws_chat"],
        wsHandlerNames: ["_scrml_ws_handlers"],
        middlewareNames: ["_scrml_mw_pipeline"],
      },
    ]);
    // SPEC §40.3.4: "handle() does NOT apply to WebSocket upgrade requests."
    // A successful server.upgrade() returns undefined; §40.3.2 types resolve()
    // as returning a Response, so an upgrade routed through the onion would get
    // a manufactured Response AFTER the protocol switch.
    const fetchBody = content.slice(content.indexOf("async fetch(req, server) {"));
    const wsCheck = fetchBody.indexOf("if (route.isWebSocket &&");
    const onionCall = fetchBody.indexOf("_scrml_onion_dispatch(req, server)");
    expect(wsCheck).toBeGreaterThan(-1);
    expect(onionCall).toBeGreaterThan(-1);
    expect(wsCheck).toBeLessThan(onionCall);
    expect(fetchBody).toContain("return route.handler(req, server);");
  });

  test("no WS channels ⇒ no upgrade pre-check emitted", () => {
    const content = generateServerEntry([
      {
        filename: "index.server.js",
        routeNames: ["_scrml_route_home"],
        wsHandlerNames: [],
        middlewareNames: ["_scrml_mw_pipeline"],
      },
    ]);
    const fetchBody = content.slice(content.indexOf("async fetch(req, server) {"));
    expect(fetchBody).not.toContain("route.isWebSocket");
    expect(fetchBody).toContain("return _scrml_onion_dispatch(req, server);");
  });

  test("NON-VACUOUS: a build with NO onion keeps the inlined pre-§40.3 fetch", () => {
    const content = generateServerEntry([
      { filename: "index.server.js", routeNames: ["_scrml_route_home"], wsHandlerNames: [] },
    ]);
    expect(content).not.toContain("_scrml_mw_pipeline");
    expect(content).not.toContain("_scrml_onion_dispatch");
    expect(content).not.toContain("async function _scrml_dispatch");
    const fetchBody = content.slice(content.indexOf("async fetch(req, server) {"));
    expect(fetchBody).toContain("for (const route of routes) {");
    expect(fetchBody).toContain('return new Response("Not found", { status: 404 });');
  });
});

// ---------------------------------------------------------------------------
// §38 WebSocket channel — discoverServerRoutes regression tests
//
// Bug 2 fix: emitChannelServerJs now emits export const _scrml_route_ws_<name>
// instead of routes.push({...}). Verify discoverServerRoutes correctly separates
// the WS upgrade route from the _scrml_ws_handlers export.
// ---------------------------------------------------------------------------

describe("§38 discoverServerRoutes: WebSocket channel separation", () => {
  beforeEach(setupTmp);
  afterEach(teardownTmp);

  test("_scrml_ws_handlers export goes to wsHandlerNames, not routeNames", () => {
    writeFileSync(
      join(tmpDir, "chat.server.js"),
      [
        `export const _scrml_ws_handlers = { open(ws) {}, message(ws, raw) {}, close(ws, code, reason) {} };`,
        `export const _scrml_route_ws_chat = { path: "/_scrml_ws/chat", method: "GET", isWebSocket: true, handler: (req, server) => {} };`,
      ].join("\n")
    );
    const result = discoverServerRoutes(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].wsHandlerNames).toContain("_scrml_ws_handlers");
    // WS upgrade route goes to routeNames (not wsHandlerNames)
    expect(result[0].routeNames).toContain("_scrml_route_ws_chat");
  });

  test("_scrml_ws_handlers does NOT appear in routeNames", () => {
    writeFileSync(
      join(tmpDir, "chat.server.js"),
      `export const _scrml_ws_handlers = { open(ws) {}, message(ws, raw) {}, close(ws, code, reason) {} };`
    );
    const result = discoverServerRoutes(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].routeNames).not.toContain("_scrml_ws_handlers");
    expect(result[0].wsHandlerNames).toContain("_scrml_ws_handlers");
  });
});

// ---------------------------------------------------------------------------
// §38 WebSocket channel — generateServerEntry regression tests
// ---------------------------------------------------------------------------

describe("§38 generateServerEntry: WebSocket channel wiring", () => {
  test("includes websocket: option when _scrml_ws_handlers is present", () => {
    const content = generateServerEntry([
      {
        filename: "chat.server.js",
        routeNames: ["_scrml_route_ws_chat"],
        wsHandlerNames: ["_scrml_ws_handlers"],
      },
    ]);
    expect(content).toContain("websocket:");
    expect(content).toContain("_scrml_ws_merged");
  });

  test("imports both route and ws handler from same server file", () => {
    const content = generateServerEntry([
      {
        filename: "chat.server.js",
        routeNames: ["_scrml_route_ws_chat"],
        wsHandlerNames: ["_scrml_ws_handlers"],
      },
    ]);
    expect(content).toContain("_scrml_route_ws_chat");
    expect(content).toContain("_scrml_ws_handlers");
    expect(content).toContain('from "./chat.server.js"');
  });

  test("WS upgrade route dispatch includes isWebSocket check", () => {
    const content = generateServerEntry([
      {
        filename: "chat.server.js",
        routeNames: ["_scrml_route_ws_chat"],
        wsHandlerNames: ["_scrml_ws_handlers"],
      },
    ]);
    expect(content).toContain("isWebSocket");
    expect(content).toContain("route.handler(req, server)");
  });

  test("no websocket: option when no channels", () => {
    const content = generateServerEntry([
      { filename: "app.server.js", routeNames: ["_scrml_route_home"], wsHandlerNames: [] },
    ]);
    expect(content).not.toContain("websocket:");
    expect(content).not.toContain("_scrml_ws_merged");
  });
});
