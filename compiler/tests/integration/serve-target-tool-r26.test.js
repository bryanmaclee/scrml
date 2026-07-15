// ---------------------------------------------------------------------------
// §64 (server-program-shape Fork 1A, Unit 2) — R26: a realistic fsp-wire-shaped
// `kind="tool" serve=` program compiles to a RUNNABLE Bun.serve headless server.
// ---------------------------------------------------------------------------
//
// The DoD's executable proof: compile an fsp-wire-shaped serve= tool (an
// <endpoint> POST + an SSE `server function* route=`), (a) `node --check` the
// emitted module (a codegen miscompile is otherwise silent), (b) inspect the
// Bun.serve serve-harness + the mounted routes, and (c) BOOT it in-process on an
// ephemeral port and DRIVE the endpoint + SSE end-to-end over real Request/
// Response — then STOP it (the DD H6 in-process boot/drive/stop conformance
// shape via `globalThis._scrml_active_server`).
//
// The serve-harness replaces the §64.7 hand-rolled `_{}` `Bun.serve`: the route
// handlers are the Unit-1 headless emit; Unit 2 mounts them on the listener.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "serve-r26-"));
let _seq = 0;

// A self-contained fsp-wire serve= tool (inline endpoint arms + a private helper;
// an SSE route yielding two literal delta frames). serve=${0} → an EPHEMERAL port
// so the in-process boot never collides. No external imports → importable as-is.
const FSP_WIRE =
  "<program kind=\"tool\" serve=${0} cors=\"*\">\n" +
  "${\n" +
  "  type FspMethod:enum = {\n" +
  "    FleetStatus\n" +
  "    Dispatch(prompt: string, project: string)\n" +
  "  }\n" +
  "  fn banner(n: int) -> string { \"fleet\" }\n" +
  "  server function* fspDeltas() route=\"/fsp/deltas\" {\n" +
  "    yield { event: \"delta\", id: 1, data: { seq: 1 } }\n" +
  "    yield { event: \"delta\", id: 2, data: { seq: 2 } }\n" +
  "  }\n" +
  "}\n" +
  "<endpoint path=\"/fsp\" method=\"POST\" accepts=FspMethod>\n" +
  "  <FleetStatus            : { jsonrpc: \"2.0\", result: { active: 3, note: banner(3) } }>\n" +
  "  <Dispatch(prompt, proj) : { jsonrpc: \"2.0\", result: { prompt: prompt, project: proj } }>\n" +
  "</endpoint>\n" +
  "</program>\n";

function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
  let toolJs = "";
  for (const [, e] of (r.outputs ?? new Map())) if (e && typeof e.toolJs === "string") toolJs += e.toolJs;
  return { r, toolJs };
}
function nodeCheck(js) {
  const f = join(TMP, `nc-${_seq++}.mjs`);
  writeFileSync(f, js);
  execFileSync("node", ["--check", f]); // throws on a SyntaxError → fails the test
}

let SRV = null;   // the booted Bun.serve handle
let TOOLJS = "";
let COMPILE_ERRORS = [];

beforeAll(async () => {
  const { r, toolJs } = compile(FSP_WIRE);
  TOOLJS = toolJs;
  COMPILE_ERRORS = (r.errors ?? []).map((e) => e.code);
  // Materialize + boot the serve module in-process (ephemeral port).
  const f = join(TMP, `serve-${_seq++}.mjs`);
  writeFileSync(f, toolJs);
  await import(f);              // top-level Bun.serve boots the listener
  SRV = globalThis._scrml_active_server;
});
afterAll(() => { if (SRV) SRV.stop(true); });

describe("R26 — fsp-wire serve= tool compiles + node --check + inspect", () => {
  test("compiles with zero errors", () => {
    expect(COMPILE_ERRORS).toEqual([]);
  });

  test("emits a valid ES module (node --check)", () => {
    expect(() => nodeCheck(TOOLJS)).not.toThrow();
  });

  test("the serve-harness is a compiler-owned Bun.serve mounting the endpoint + SSE routes", () => {
    expect(TOOLJS).toContain("const _scrml_server = Bun.serve({");
    expect(TOOLJS).toContain("port: _scrml_serve_port,");
    // Both route kinds mounted: the §61 endpoint POST + the §37 SSE GET.
    expect(TOOLJS).toContain('path: "/fsp"');
    expect(TOOLJS).toContain('path: "/fsp/deltas"');
    expect(TOOLJS).toContain("async function _scrml_endpoint");
    // cors= preflight route + headers.
    expect(TOOLJS).toContain("_scrml_cors_options_route");
    // Headless — no web-app scaffold.
    expect(TOOLJS).not.toContain("text/html");
    expect(TOOLJS).not.toContain("_scrml_session_store");
  });
});

describe("R26 — the booted server serves the endpoint + SSE over real HTTP", () => {
  test("POST /fsp {tag:FleetStatus} → 200 + the JSON-RPC result envelope", async () => {
    const res = await fetch(`http://localhost:${SRV.port}/fsp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "FleetStatus" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", result: { active: 3, note: "fleet" } });
  });

  test("POST /fsp {tag:Dispatch,...} → 200 + the positional payload back on the wire", async () => {
    const res = await fetch(`http://localhost:${SRV.port}/fsp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "Dispatch", prompt: "scale", project: "atlas" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", result: { prompt: "scale", project: "atlas" } });
  });

  test("GET /fsp/deltas → the SSE stream frames (event: delta / data:)", async () => {
    const res = await fetch(`http://localhost:${SRV.port}/fsp/deltas`);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: delta");
    expect(body).toContain('data: {"seq":1}');
    expect(body).toContain('data: {"seq":2}');
  });

  test("an unmatched path → 404 (the serve-harness fallback)", async () => {
    const res = await fetch(`http://localhost:${SRV.port}/nope`);
    expect(res.status).toBe(404);
  });

  test("OPTIONS preflight on any path → 204 + CORS headers (the /* route)", async () => {
    const res = await fetch(`http://localhost:${SRV.port}/fsp`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// FIX 2 (fix-round) — a top-level const referenced by an endpoint arm is EMITTED
// (defined), so the booted route returns the const value instead of a runtime
// ReferenceError (the pre-fix serve path dropped top-level const/let).
describe("R26 — FIX 2: a top-level const referenced by an endpoint arm flows live", () => {
  let srv2 = null;
  beforeAll(async () => {
    const src =
      "<program kind=\"tool\" serve=${0}>\n" +
      "${\n" +
      "  const GREETING = \"hello-from-const\"\n" +
      "  type M:enum = { Ping }\n" +
      "}\n" +
      "<endpoint path=\"/ping\" method=\"POST\" accepts=M>\n" +
      "  <Ping : { msg: GREETING }>\n" +
      "</endpoint>\n" +
      "</program>\n";
    const { toolJs } = compile(src);
    const f = join(TMP, `serve-const-${_seq++}.mjs`);
    writeFileSync(f, toolJs);
    const mod = await import(f);
    srv2 = globalThis._scrml_active_server;
    void mod;
  });
  afterAll(() => { if (srv2) srv2.stop(true); });

  test("POST /ping → 200 + the top-level const value (no ReferenceError)", async () => {
    const res = await fetch(`http://localhost:${srv2.port}/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "Ping" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ msg: "hello-from-const" });
  });
});
