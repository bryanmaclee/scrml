/**
 * mcp-server-tools.test.js — MCP-V0.C integration test.
 *
 * Boots the `scrml:mcp` server (compiler/runtime/stdlib/mcp.js) against a
 * fixture's REAL emitted descriptor sidecars (engines/forms/channels/
 * serverfns.json + chunks.json), with a MOCK runtime (reactive_get/derived_get
 * closures over a plain state object), and drives each of the 11 LOCKED tools
 * through the MCP SDK's in-process `Client` companion over an
 * `InMemoryTransport` pair. Asserts each tool's returned shape.
 *
 * Strategy mirrors mcp-runtime-helpers.test.js for the mock runtime, and
 * mcp-sidecar-compile.js (the MCP-V0.A helper) for the REAL emit path — the
 * sidecars are NOT hand-fabricated; they are produced by
 * compileScrml({ write:true, emitPerRoute:true }).
 *
 * STDIO discipline note (SCOPING §5 Risk 4): this test drives the server via
 * InMemoryTransport, not StdioServerTransport, so it does not assert the
 * stdout-cleanliness property directly (that belongs to a stdio-subprocess
 * E2E in Sub-unit E). It DOES exercise registerMcpTools + the JSON-RPC
 * content-block round-trip the stdio transport would carry.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import {
  makeSidecarTmpRoot,
  cleanupSidecarTmpRoot,
  compileAndReadSidecars,
} from "../helpers/mcp-sidecar-compile.js";

import {
  install,
  loadSidecars,
  registerMcpTools,
  startMcpServer,
  shutdownMcpServer,
  TOOL_NAMES,
  _resetForTests,
} from "../../runtime/stdlib/mcp.js";

// ---------------------------------------------------------------------------
// Fixture — a multi-surface app: 2 engines (one payload variant), 1 form
// (2 fields), 1 channel (2 auto-synced cells), 2 server fns. Mirrors the
// canonical fixture shapes from the MCP-V0.A descriptor tests.
// ---------------------------------------------------------------------------

const FIXTURE = `<program title="MCP Demo" db="./app.db">

type LoadPhase:enum = { Idle, Loading, Loaded(rows: int), Failed(message: string) }
type Health:enum = { Healthy, Critical }

<engine for=LoadPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Loaded | .Failed)></>
  <Loaded(rows) rule=.Idle>\${rows}</>
  <Failed(msg) rule=.Idle>\${msg}</>
</>

<engine for=Health initial=.Healthy>
  <Healthy rule=.Critical></>
  <Critical rule=.Healthy></>
</>

\${
  <signup>
    <name req length(>=2)> = <input type="text"/>
    <email req> = <input type="email"/>
  </>

  server function loadRows(limit: int) {
    return ?{\`SELECT id FROM items LIMIT \${limit}\`}.all()
  }
  server function ping() {
    return 1
  }
}

<channel name="chat" topic="lobby">
  \${
    <messages> = []
    <count> = 0
  }
</>

<div>placeholder</div>

</program>
`;

// Mock runtime — reactive_get / derived_get read from a plain state object.
// Keys are the resolved descriptor keys (identity encoding in dev mode):
//   engine current-variant cells keyed by engine name (cellKey === name);
//   form per-field/compound keys are dotted (signup.name.isValid, etc.);
//   channel auto-synced cells keyed by cell name (key === name in dev mode).
function makeMockRuntime(initial) {
  const state = Object.assign({}, initial || {});
  return {
    state,
    reactive_get(k) { return state[k]; },
    derived_get(k) { return state[k]; },
    set(k, v) { state[k] = v; },
  };
}

const MOCK_STATE = {
  // engines
  loadPhase: { variant: "Loading", data: {} },
  health: "Healthy",
  // form signup — compound + per-field
  "signup.isValid": false,
  "signup.errors": [],
  "signup.touched": true,
  "signup.submitted": false,
  "signup.name.isValid": true,
  "signup.name.errors": [],
  "signup.name.touched": true,
  "signup.email.isValid": false,
  "signup.email.errors": [{ variant: "Required" }],
  "signup.email.touched": true,
  // channel chat — auto-synced cells keyed by name in dev mode
  messages: [{ author: "a", body: "hi" }],
  count: 1,
};

let TMP;
let emitted;
let outDir;

beforeAll(() => {
  TMP = makeSidecarTmpRoot("server-tools");
  emitted = compileAndReadSidecars(FIXTURE, TMP);
  outDir = emitted.outDir;
});

afterAll(() => {
  _resetForTests();
  cleanupSidecarTmpRoot(TMP);
});

// Build a fresh server + in-process client connected over InMemoryTransport.
// Each call reinstalls the mock runtime + reloads the emitted sidecars so the
// module state is deterministic per test.
async function bootClient() {
  _resetForTests();
  const rt = makeMockRuntime(MOCK_STATE);
  install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
  loadSidecars(outDir);

  const server = new McpServer({ name: "scrml-mcp-test", version: "0" });
  registerMcpTools(server, z);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scrml-mcp-test-client", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server, rt };
}

// Drive one tool and parse its JSON content payload back to an object.
async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args || {} });
  expect(res.isError).toBeFalsy();
  expect(Array.isArray(res.content)).toBe(true);
  expect(res.content[0].type).toBe("text");
  return JSON.parse(res.content[0].text);
}

describe("MCP-V0.C — fixture emits clean sidecars", () => {
  test("the integration fixture compiles with zero fatal errors", () => {
    expect(emitted.fatal).toEqual([]);
  });

  test("all four descriptor sidecars are populated as expected", () => {
    expect(emitted.engines).toHaveLength(2);
    expect(emitted.forms).toHaveLength(1);
    expect(emitted.channels).toHaveLength(1);
    expect(emitted.serverFns).toHaveLength(2);
  });
});

describe("MCP-V0.C — 11 tools registered + listed over JSON-RPC", () => {
  test("the server advertises exactly the 11 LOCKED tool names", async () => {
    const { client, server } = await bootClient();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(names).toHaveLength(11);
    await client.close();
    await server.close();
  });
});

describe("MCP-V0.C — per-tool round-trip", () => {
  let client;
  let server;
  beforeAll(async () => {
    const booted = await bootClient();
    client = booted.client;
    server = booted.server;
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });

  test("Tool 1 — get_app_topology returns the chunks manifest object", async () => {
    const topo = await callTool(client, "get_app_topology");
    expect(topo).toBeTruthy();
    expect(topo.version).toBe(1);
    expect(typeof topo.entryPoints).toBe("object");
  });

  test("Tool 2a — list_engines returns both engine descriptors", async () => {
    const engines = await callTool(client, "list_engines");
    expect(Array.isArray(engines)).toBe(true);
    expect(engines.map((e) => e.name).sort()).toEqual(["health", "loadPhase"]);
  });

  test("Tool 2b — get_engine includes live currentVariant (normalized tag)", async () => {
    const eng = await callTool(client, "get_engine", { name: "loadPhase" });
    expect(eng.name).toBe("loadPhase");
    expect(eng.type).toBe("LoadPhase");
    expect(eng.currentVariant).toBe("Loading"); // {variant,data} → tag string
    expect(Array.isArray(eng.variants)).toBe(true);
  });

  test("Tool 2b — get_engine returns null for unknown engine", async () => {
    const eng = await callTool(client, "get_engine", { name: "nope" });
    expect(eng).toBeNull();
  });

  test("Tool 3a — list_forms returns the signup form descriptor", async () => {
    const forms = await callTool(client, "list_forms");
    expect(forms).toHaveLength(1);
    expect(forms[0].formName).toBe("signup");
    expect(forms[0].fields.map((f) => f.name).sort()).toEqual(["email", "name"]);
  });

  test("Tool 3b — get_form_status composes live validity surface", async () => {
    const status = await callTool(client, "get_form_status", { formName: "signup" });
    expect(status.isValid).toBe(false);
    expect(status.submitted).toBe(false);
    expect(status.perField.name.isValid).toBe(true);
    expect(status.perField.email.isValid).toBe(false);
    expect(status.perField.email.errors).toEqual([{ variant: "Required" }]);
  });

  test("Tool 4a — list_routes returns (entryPoint, roles[]) pairs", async () => {
    const routes = await callTool(client, "list_routes");
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(typeof routes[0].entryPoint).toBe("string");
    expect(Array.isArray(routes[0].roles)).toBe(true);
    expect(routes[0].roles.length).toBeGreaterThanOrEqual(1);
  });

  test("Tool 4b — get_route_chunks returns a tier entry for a valid (EP, role)", async () => {
    const routes = await callTool(client, "list_routes");
    const { entryPoint, roles } = routes[0];
    const entry = await callTool(client, "get_route_chunks", {
      entryPoint,
      role: roles[0],
    });
    expect(entry).toBeTruthy();
    expect(typeof entry.initial).toBe("string");
  });

  test("Tool 4b — get_route_chunks returns null for an unknown pair", async () => {
    const entry = await callTool(client, "get_route_chunks", {
      entryPoint: "no-such-ep",
      role: "no-such-role",
    });
    expect(entry).toBeNull();
  });

  test("Tool 5 — list_server_functions enumerates both fns, dispatchable:false", async () => {
    const fns = await callTool(client, "list_server_functions");
    expect(fns.map((f) => f.name).sort()).toEqual(["loadRows", "ping"]);
    for (const f of fns) expect(f.dispatchable).toBe(false);
  });

  test("Tool 6a — list_channels returns the chat channel descriptor", async () => {
    const channels = await callTool(client, "list_channels");
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("chat");
    expect(channels[0].topic).toBe("lobby");
    expect(channels[0].autoSyncedCells.map((c) => c.name).sort()).toEqual(["count", "messages"]);
  });

  test("Tool 6b — get_channel_state reads live cell values", async () => {
    const state = await callTool(client, "get_channel_state", { name: "chat" });
    expect(state.name).toBe("chat");
    expect(state.topic).toBe("lobby");
    expect(state.cellState.count).toBe(1);
    expect(state.cellState.messages).toEqual([{ author: "a", body: "hi" }]);
  });

  test("Tool 6b — get_channel_state returns null for unknown channel", async () => {
    const state = await callTool(client, "get_channel_state", { name: "nope" });
    expect(state).toBeNull();
  });

  test("Tool 7 — get_reachable_server_fns is degraded-honest for a valid pair", async () => {
    const routes = await callTool(client, "list_routes");
    const { entryPoint, roles } = routes[0];
    const res = await callTool(client, "get_reachable_server_fns", {
      entryPoint,
      role: roles[0],
      depth: 1,
    });
    expect(res.found).toBe(true);
    expect(res.reachabilityFiltered).toBe(false); // V0 limitation — honest
    expect(res.serverFns.map((f) => f.name).sort()).toEqual(["loadRows", "ping"]);
    expect(typeof res.note).toBe("string");
  });

  test("Tool 7 — get_reachable_server_fns reports found:false for unknown pair", async () => {
    const res = await callTool(client, "get_reachable_server_fns", {
      entryPoint: "no-ep",
      role: "no-role",
    });
    expect(res.found).toBe(false);
    expect(res.serverFns).toEqual([]);
  });
});

describe("MCP-V0.C — error surface stays well-formed JSON-RPC", () => {
  test("a resolver throw becomes an isError content response (not a transport error)", async () => {
    // Boot a server WITHOUT install() so a runtime-dependent tool throws.
    _resetForTests();
    loadSidecars(outDir); // sidecars loaded, but runtime NOT installed
    const server = new McpServer({ name: "scrml-mcp-noinstall", version: "0" });
    registerMcpTools(server, z);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "noinstall-client", version: "0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const res = await client.callTool({ name: "get_engine", arguments: { name: "loadPhase" } });
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.error).toMatch(/runtime not connected/);

    await client.close();
    await server.close();
  });
});

describe("MCP-V0.C — startMcpServer boot + shutdown lifecycle (stdio transport)", () => {
  test("startMcpServer boots over real stdio and shutdown closes cleanly", async () => {
    // This exercises the real boot path (install → loadSidecars → McpServer →
    // registerMcpTools → StdioServerTransport → connect). It binds the process
    // stdio transport; we immediately shut it down. The assertion is that boot
    // returns a handle with the 3 lifecycle members and shutdown is clean.
    _resetForTests();
    const rt = makeMockRuntime(MOCK_STATE);
    const handle = await startMcpServer({
      reactiveGet: rt.reactive_get,
      derivedGet: rt.derived_get,
      outputDir: outDir,
    });
    expect(handle).toBeTruthy();
    expect(handle.server).toBeTruthy();
    expect(handle.transport).toBeTruthy();
    expect(typeof handle.shutdown).toBe("function");

    // Clean shutdown — must not throw, idempotent.
    await shutdownMcpServer(handle);
    await shutdownMcpServer(handle); // second call is a no-op, no throw
  });
});
