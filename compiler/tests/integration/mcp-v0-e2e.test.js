/**
 * mcp-v0-e2e.test.js — MCP V0 Sub-unit E end-to-end integration.
 *
 * Boots the MCP server (`scrml:mcp`) against the multi-file fixture at
 * `compiler/samples/mcp-v0-fixture/routes/` and exercises ALL 11 LOCKED
 * tools through the SDK's in-process `Client` companion over
 * `InMemoryTransport`. Each tool gets one round-trip assertion against
 * the REAL emitted sidecars (no hand-fabricated descriptors).
 *
 * Strategy mirrors `mcp-server-tools.test.js` (Sub-unit C's integration test)
 * but binds against the on-disk multi-page fixture, not an inline single-file
 * source string. This is the highest-fidelity integration shape: the same
 * production code path an adopter exercises when they:
 *   1. compile their app with `<program mcp>` (auto-flips emitPerRoute), then
 *   2. point a real LLM-agent MCP client at the boot-injected
 *      `startMcpServer({reactiveGet, derivedGet, outputDir})` over stdio.
 *
 * V0 known limitation acknowledgement (see mcp-v0-d-2026-05-25/progress.md
 * "Risks / open questions surfaced" #1): the generated `_server.js` boot
 * passes `globalThis._scrml_reactive_get` / `globalThis._scrml_derived_get`
 * to startMcpServer, but per-module .server.js files do NOT yet stash their
 * helpers on globalThis. Without those stashes the runtime read tools
 * (getCurrentVariant / getFormStatus / getChannelState) gracefully degrade
 * to undefined. This E2E test exercises the SHAPE end-to-end with a MOCK
 * runtime that injects keys deterministically — the same shape an adopter
 * will see once the globalThis-stash wave lands. Topology tools (1, 2a, 3a,
 * 4a, 4b, 5, 6a, 7) are NOT affected by the limitation — they read sidecars
 * directly.
 *
 * STDIO discipline note (SCOPING §5 Risk 4): InMemoryTransport is used so
 * the test does not bind real process stdio. Stdout-cleanliness when a real
 * StdioServerTransport binds the process is a separate concern; mcp.js
 * routes its readiness line to stderr (see mcp.js:829).
 *
 * Authority: docs/changes/mcp-v0-devtools-scoping/SCOPING.md §3 Sub-unit E.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import { compileScrml } from "../../src/api.js";
import {
  install,
  loadSidecars,
  registerMcpTools,
  TOOL_NAMES,
  _resetForTests,
} from "../../runtime/stdlib/mcp.js";

// ---------------------------------------------------------------------------
// Fixture wiring — the canonical 3-file routes/ multi-page app under
// compiler/samples/mcp-v0-fixture/routes/. Compiled once per test file via
// the REAL emit path (compileScrml({write:true, emitPerRoute:true})), then
// each test reuses the on-disk sidecars.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  import.meta.dir, "..", "..", "samples", "mcp-v0-fixture"
);
const FIXTURE_INPUTS = [
  join(FIXTURE_DIR, "routes", "index.scrml"),
  join(FIXTURE_DIR, "routes", "loads.scrml"),
  join(FIXTURE_DIR, "routes", "admin.scrml"),
];

let TMP_ROOT;
let OUT_DIR;
let COMPILE_RESULT;

beforeAll(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "mcp-v0-e2e-"));
  OUT_DIR = join(TMP_ROOT, "dist");
  mkdirSync(OUT_DIR, { recursive: true });

  // Real compile path — write:true + emitPerRoute:true is what
  // `<program mcp>` auto-flips to per V0 Sub-unit D. We pre-flip explicitly
  // here so the fixture stays plain (no `<program mcp>` attribute needed in
  // the source — auto-activation is tested by mcp-program-attr.test.js).
  COMPILE_RESULT = compileScrml({
    inputFiles: FIXTURE_INPUTS,
    outputDir: OUT_DIR,
    write: true,
    emitPerRoute: true,
    log: () => {},
  });
});

afterAll(() => {
  _resetForTests();
  if (TMP_ROOT && existsSync(TMP_ROOT)) {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mock runtime — the descriptor-resolved keys mapped to deterministic values.
// In dev mode (no §47 encoding) the resolved key equals the authored name, so
// the keys below match the descriptor extractor's output:
//   - engine current-variant cells keyed by engine name
//   - form per-field/compound keys are dotted (signup.name.isValid etc.)
//   - channel auto-synced cells keyed by cell name (key === name in dev)
// ---------------------------------------------------------------------------

function makeMockRuntime(initial) {
  const state = Object.assign({}, initial || {});
  return {
    state,
    reactive_get(k) { return state[k]; },
    derived_get(k) { return state[k]; },
  };
}

const MOCK_STATE = {
  // engines — live current-variant values
  loadPhase: { variant: "Loaded", data: { rows: 7 } },
  health: "Healthy",
  // signup form — compound + per-field validity surface
  "signup.isValid": false,
  "signup.errors": { name: [], email: [{ variant: "Required" }] },
  "signup.touched": true,
  "signup.submitted": false,
  "signup.name.isValid": true,
  "signup.name.errors": [],
  "signup.name.touched": true,
  "signup.email.isValid": false,
  "signup.email.errors": [{ variant: "Required" }],
  "signup.email.touched": true,
  // dispatch channel — auto-synced cells keyed by name in dev mode
  pending: [{ id: 101, status: "queued" }],
  count: 4,
};

// ---------------------------------------------------------------------------
// MCP server + in-process client harness. Each test reinstalls the mock
// runtime + reloads the on-disk sidecars so module state is deterministic
// per test (mcp.js holds module-scoped descriptor caches per loadSidecars).
// ---------------------------------------------------------------------------

async function bootClient() {
  _resetForTests();
  const rt = makeMockRuntime(MOCK_STATE);
  install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
  loadSidecars(OUT_DIR);

  const server = new McpServer({ name: "scrml-mcp-e2e", version: "0" });
  registerMcpTools(server, z);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scrml-mcp-e2e-client", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server, rt };
}

async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args || {} });
  expect(res.isError).toBeFalsy();
  expect(Array.isArray(res.content)).toBe(true);
  expect(res.content[0].type).toBe("text");
  return JSON.parse(res.content[0].text);
}

// ---------------------------------------------------------------------------
// §1 — Fixture compile + sidecar emission
// ---------------------------------------------------------------------------

describe("MCP V0.E — fixture compiles cleanly + emits all 5 sidecars", () => {
  test("the 3-file multi-page fixture compiles with zero fatal errors", () => {
    const fatal = (COMPILE_RESULT.errors ?? []).filter(
      (e) =>
        e.severity !== "warning" &&
        !String(e.code ?? "").startsWith("W-") &&
        !String(e.code ?? "").startsWith("I-")
    );
    expect(fatal).toEqual([]);
  });

  test("all 4 descriptor sidecars + chunks.json present on disk", () => {
    expect(existsSync(join(OUT_DIR, "engines.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "forms.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "channels.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "serverfns.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "chunks.json"))).toBe(true);
  });

  test("sidecar counts match fixture surface (2 engines / 1 form / 1 channel / 2 server fns)", () => {
    const engines = JSON.parse(readFileSync(join(OUT_DIR, "engines.json"), "utf-8"));
    const forms = JSON.parse(readFileSync(join(OUT_DIR, "forms.json"), "utf-8"));
    const channels = JSON.parse(readFileSync(join(OUT_DIR, "channels.json"), "utf-8"));
    const serverFns = JSON.parse(readFileSync(join(OUT_DIR, "serverfns.json"), "utf-8"));
    expect(engines).toHaveLength(2);
    expect(forms).toHaveLength(1);
    expect(channels).toHaveLength(1);
    expect(serverFns).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// §2 — Server registers all 11 tools over JSON-RPC
// ---------------------------------------------------------------------------

describe("MCP V0.E — MCP server registers the 11 LOCKED tools", () => {
  test("listTools returns exactly the 11 LOCKED tool names", async () => {
    const { client, server } = await bootClient();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
      expect(names).toHaveLength(11);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — Per-tool round-trip (one assertion per tool per the brief). Each
// asserts SHAPE — not exhaustive content — to keep the test resilient to
// non-load-bearing route-splitter / chunk-naming changes upstream.
// ---------------------------------------------------------------------------

describe("MCP V0.E — round-trip every tool against the multi-page fixture", () => {
  let client;
  let server;
  beforeAll(async () => {
    const booted = await bootClient();
    client = booted.client;
    server = booted.server;
  });
  afterAll(async () => {
    if (client) await client.close();
    if (server) await server.close();
  });

  // Tool 1 — topology
  test("Tool 1 — get_app_topology returns the chunks manifest (version + entryPoints map)", async () => {
    const topo = await callTool(client, "get_app_topology");
    expect(topo).toBeTruthy();
    expect(topo.version).toBe(1);
    expect(typeof topo.entryPoints).toBe("object");
    // Multi-page fixture → at least one entry point per page.
    expect(Object.keys(topo.entryPoints).length).toBeGreaterThanOrEqual(1);
  });

  // Tool 2a — list_engines (compile-time facts only; no live state mix-in)
  test("Tool 2a — list_engines returns both fixture engine descriptors", async () => {
    const engines = await callTool(client, "list_engines");
    expect(Array.isArray(engines)).toBe(true);
    expect(engines.map((e) => e.name).sort()).toEqual(["health", "loadPhase"]);
    const lp = engines.find((e) => e.name === "loadPhase");
    expect(lp.type).toBe("LoadPhase");
    expect(lp.variants.map((v) => v.tag).sort()).toEqual(
      ["Failed", "Idle", "Loaded", "Loading"]
    );
    expect(lp.kind).toBe("primary");
    // The Loaded variant carries an int-typed payload field.
    const loaded = lp.variants.find((v) => v.tag === "Loaded");
    expect(loaded.fields).toEqual([{ name: "rows", type: "int" }]);
    // rule= per §51.0.F.
    expect(lp.rules.Idle).toEqual(["Loading"]);
    expect(lp.rules.Loading.sort()).toEqual(["Failed", "Loaded"]);
  });

  // Tool 2b — get_engine (includes live currentVariant from mock runtime)
  test("Tool 2b — get_engine composes the live currentVariant", async () => {
    const eng = await callTool(client, "get_engine", { name: "loadPhase" });
    expect(eng.name).toBe("loadPhase");
    expect(eng.type).toBe("LoadPhase");
    // Mock state has loadPhase = { variant: "Loaded", data: { rows: 7 } } →
    // normalized to tag string per mcp.js:getCurrentVariant.
    expect(eng.currentVariant).toBe("Loaded");
  });

  test("Tool 2b — get_engine returns null for an unknown engine name", async () => {
    const eng = await callTool(client, "get_engine", { name: "noSuchEngine" });
    expect(eng).toBeNull();
  });

  // Tool 3a — list_forms (descriptor only; no live status)
  test("Tool 3a — list_forms returns the signup form with its two fields", async () => {
    const forms = await callTool(client, "list_forms");
    expect(forms).toHaveLength(1);
    expect(forms[0].formName).toBe("signup");
    expect(forms[0].fields.map((f) => f.name).sort()).toEqual(["email", "name"]);
    // Pre-resolved compound keys (per §55.5-§55.7).
    expect(forms[0].compoundKeys.isValidKey).toBe("signup.isValid");
    expect(forms[0].compoundKeys.submittedKey).toBe("signup.submitted");
  });

  // Tool 3b — get_form_status (compound rollup + per-field via mock runtime)
  test("Tool 3b — get_form_status composes the live validity surface", async () => {
    const status = await callTool(client, "get_form_status", { formName: "signup" });
    expect(status.isValid).toBe(false);
    expect(status.submitted).toBe(false);
    expect(status.touched).toBe(true);
    // Per-field surface from mock state.
    expect(status.perField.name.isValid).toBe(true);
    expect(status.perField.email.isValid).toBe(false);
    expect(status.perField.email.errors).toEqual([{ variant: "Required" }]);
  });

  test("Tool 3b — get_form_status returns null for an unknown form name", async () => {
    const status = await callTool(client, "get_form_status", { formName: "ghost" });
    expect(status).toBeNull();
  });

  // Tool 4a — list_routes (projection over chunks.json)
  test("Tool 4a — list_routes returns at least one (entryPoint, roles[]) pair", async () => {
    const routes = await callTool(client, "list_routes");
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    for (const r of routes) {
      expect(typeof r.entryPoint).toBe("string");
      expect(Array.isArray(r.roles)).toBe(true);
      expect(r.roles.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Tool 4b — get_route_chunks (per-(EP,role) tier projection)
  test("Tool 4b — get_route_chunks returns the tier entry for a known (EP, role)", async () => {
    const routes = await callTool(client, "list_routes");
    const { entryPoint, roles } = routes[0];
    const entry = await callTool(client, "get_route_chunks", {
      entryPoint,
      role: roles[0],
    });
    expect(entry).toBeTruthy();
    // At minimum every route has an initial chunk filename.
    expect(typeof entry.initial).toBe("string");
  });

  test("Tool 4b — get_route_chunks returns null for an unknown pair", async () => {
    const entry = await callTool(client, "get_route_chunks", {
      entryPoint: "no-such-ep",
      role: "no-such-role",
    });
    expect(entry).toBeNull();
  });

  // Tool 5 — list_server_functions (enumeration only; dispatchable:false)
  test("Tool 5 — list_server_functions returns both fns with dispatchable:false", async () => {
    const fns = await callTool(client, "list_server_functions");
    expect(fns.map((f) => f.name).sort()).toEqual(["loadRows", "pingAdmin"]);
    for (const f of fns) expect(f.dispatchable).toBe(false);
    // loadRows has one int-typed param; pingAdmin has none.
    const loadRows = fns.find((f) => f.name === "loadRows");
    expect(loadRows.params).toEqual([{ name: "limit", type: "int" }]);
    const ping = fns.find((f) => f.name === "pingAdmin");
    expect(ping.params).toEqual([]);
  });

  // Tool 6a — list_channels (compile-time topology, no live cell values)
  test("Tool 6a — list_channels returns the dispatch channel + 2 auto-synced cells", async () => {
    const channels = await callTool(client, "list_channels");
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("dispatch");
    expect(channels[0].topic).toBe("lobby");
    expect(channels[0].autoSyncedCells.map((c) => c.name).sort())
      .toEqual(["count", "pending"]);
  });

  // Tool 6b — get_channel_state (live cell values via mock runtime)
  test("Tool 6b — get_channel_state composes live cell values for the channel", async () => {
    const state = await callTool(client, "get_channel_state", { name: "dispatch" });
    expect(state.name).toBe("dispatch");
    expect(state.topic).toBe("lobby");
    expect(state.cellState.count).toBe(4);
    expect(state.cellState.pending).toEqual([{ id: 101, status: "queued" }]);
  });

  test("Tool 6b — get_channel_state returns null for an unknown channel name", async () => {
    const state = await callTool(client, "get_channel_state", { name: "ghost" });
    expect(state).toBeNull();
  });

  // Tool 7 — get_reachable_server_fns (DEGRADED-HONEST V0 — see SHAPE GAP
  // note in mcp.js:574-588 and docs/changes/mcp-v0-c-stdlib/progress.md)
  test("Tool 7 — get_reachable_server_fns reports found:true + reachabilityFiltered:false for a valid pair", async () => {
    const routes = await callTool(client, "list_routes");
    const { entryPoint, roles } = routes[0];
    const res = await callTool(client, "get_reachable_server_fns", {
      entryPoint,
      role: roles[0],
      depth: 1,
    });
    expect(res.found).toBe(true);
    expect(res.reachabilityFiltered).toBe(false);
    // V0 limitation: returns the FULL app-wide server-fn list.
    expect(res.serverFns.map((f) => f.name).sort()).toEqual(["loadRows", "pingAdmin"]);
    expect(typeof res.note).toBe("string");
  });

  test("Tool 7 — get_reachable_server_fns reports found:false for an unknown pair", async () => {
    const res = await callTool(client, "get_reachable_server_fns", {
      entryPoint: "no-ep",
      role: "no-role",
    });
    expect(res.found).toBe(false);
    expect(res.serverFns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — Multi-page-specific assertion. The 3-file routes/ fixture should
// produce multiple route entries (one per .scrml file via filesystem path).
// ---------------------------------------------------------------------------

describe("MCP V0.E — multi-page route topology surfaces correctly", () => {
  test("topology contains more than one entry point (multi-page fixture)", async () => {
    const { client, server } = await bootClient();
    try {
      const routes = await callTool(client, "list_routes");
      // Three pages → at least 3 entry points (the route-splitter may emit
      // additional synthetic EPs; we assert >=3 not ==3 to stay resilient).
      expect(routes.length).toBeGreaterThanOrEqual(3);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("the per-role admin chunk variance is observable via different role chunk sets", async () => {
    // The <auth role="Admin"> gate in admin.scrml should cause role-specific
    // chunk variance: the Admin role's chunk set differs from Anonymous's
    // for the admin route. We assert that AT LEAST one entry-point lists
    // multiple roles (per-role variance is non-zero somewhere).
    const { client, server } = await bootClient();
    try {
      const routes = await callTool(client, "list_routes");
      const someEpHasMultipleRoles = routes.some((r) => r.roles.length >= 2);
      expect(someEpHasMultipleRoles).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
