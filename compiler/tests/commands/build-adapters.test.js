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
