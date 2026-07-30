// ---------------------------------------------------------------------------
// <endpoint> request/response conformance — end-to-end PROOF (§61 W5,
// endpoint-primitive-2026-06-25)
// ---------------------------------------------------------------------------
//
// SPEC §61 (Typed Inbound Endpoint). The scrml-side analog of flogence's
// `scripts/fsp-wire-smoke.ts` NON-SSE assertions (the conformance bar §61.10):
// compile a multi-method `<endpoint>`, IMPORT the emitted `.server.js`
// `fetch`/handler, and drive it end-to-end over real `Request`/`Response`:
//
//   (A) DISPATCH + DIRECT-SERIALIZE (§61.4 / §61.5). Each `accepts=` variant
//       dispatches to its arm; the arm's typed value-return is direct-serialized
//       as the JSON response body (200). Unit + positional-payload + typed-int
//       variants all land their decoded payload into the arm and back onto the
//       wire. JSON-RPC is a CONVENTION expressed by what the arm returns, not a
//       baked-in mode — the arms return `{ jsonrpc, result }` and the client
//       sees exactly that.
//
//   (B) COMPILER-OWNED DECODE FAILURE → 400 (§61.3). A malformed body / unknown
//       variant / bad payload is a `parseVariant` (§41.13) failure the COMPILER
//       owns: a structured `{ error: { kind, message } }` envelope at status 400,
//       NEVER routed to an author arm (the arms are exhaustive over the KNOWN
//       variants only). `kind` ranges over the §41.13 ParseError family
//       (MissingDiscriminator / UnknownVariant / InvalidPayload).
//
//   (C) AUTHOR-OWNED JSON-RPC ERROR RESULT → 200 (§61.5). The "terminal-reject
//       over the wire" analog: an arm that MODELS a JSON-RPC error result
//       (returns an `{ jsonrpc, error: { code, message } }`-shaped value) is
//       serialized VERBATIM at status 200 — the author owns the wire. This is
//       DISTINCT from (B): the compiler-owned 400 is for a DECODE failure; an
//       author-returned error-shaped value is just a typed return value the
//       compiler serializes, status 200. (A foreign JSON-RPC client reads the
//       `error` member; HTTP stays 200, exactly as JSON-RPC-over-HTTP prescribes.)
//
//   (D) ROUTE REGISTRATION (§61.7). The handler registers at the VERBATIM
//       `path=` / `method=` (never a compiler hash) and joins the WinterCG
//       `routes` / `fetch` aggregate. `node --check` the emitted `.server.js`
//       (a codegen miscompile is otherwise silent).
//
//   (E) CLIENT-CODEGEN SKIP (§61.6). NO endpoint surface leaks into the client
//       bundle — no `_scrml_endpoint_` handler, no `__ri_route_endpoint` record,
//       no `parseVariant` decode IIFE. The foreign client has its own SDK; there
//       is no compiler-generated scrml caller to pair with. `node --check` the
//       emitted `.client.js`.
//
// NOT TESTED HERE: the SSE replay-from-0 / resume-from-cursor leg (the other 2
// of flogence's 11 fsp-wire-smoke assertions) is the §37 `server function*
// route=` streaming surface (ALREADY LANDED, escalation-2 `f5f15009`), NOT
// `<endpoint>`'s request/response territory (§61.8). `<endpoint>` is the
// non-streaming, typed-dispatch counterpart; SSE conformance lives with §37.

import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "endpoint-conformance-"));
// scrml emits ES modules (`export const __ri_route_endpoint_N = …`). `node --check` picks the
// module kind from the nearest package.json, and there is none above os.tmpdir(), so it would
// parse an ESM artifact under CommonJS rules and report `export` as a SyntaxError — a red gate
// for a reason no change caused. Declare the module type the artifacts are actually emitted in.
writeFileSync(join(TMP, "package.json"), '{"type":"module"}\n');
let _seq = 0;

// A multi-method FSP `<endpoint>` — four variants exercising every arm shape:
//   FleetStatus            unit variant (no payload)        → result envelope
//   Dispatch(prompt,proj)  positional string payload        → result envelope
//   DeltaSince(seq)        typed-int payload (refinement)   → result envelope
//   Halt                   unit variant modelling a         → JSON-RPC ERROR
//                          JSON-RPC error RESULT               result (200)
//
// Inline `:`-shorthand arms return the JSON-RPC wire shape directly (§61.5),
// so the emitted `.server.js` is fully self-contained — no external fns to stub.
const FSP_ENDPOINT =
  `<program>\n` +
  `type FspMethod:enum = {\n` +
  `  FleetStatus\n` +
  `  Dispatch(prompt: string, project: string)\n` +
  `  DeltaSince(seq: int)\n` +
  `  Halt\n` +
  `}\n` +
  `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
  `  <FleetStatus : { jsonrpc: "2.0", result: { active: 3, idle: 1 } }>\n` +
  `  <Dispatch(prompt, project) : { jsonrpc: "2.0", result: { accepted: true, project: project, prompt: prompt } }>\n` +
  `  <DeltaSince(seq) : { jsonrpc: "2.0", result: { since: seq, count: 0 } }>\n` +
  `  <Halt : { jsonrpc: "2.0", error: { code: -32000, message: "service halted by operator" } }>\n` +
  `</endpoint>\n` +
  `</program>\n`;

// ---- compile helpers ------------------------------------------------------
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function serverJs(r) {
  let out = "";
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry.serverJs === "string") out += entry.serverJs + "\n";
  }
  return out;
}
function clientJs(r) {
  let out = "";
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry.clientJs === "string") out += entry.clientJs + "\n";
  }
  return out;
}
function nodeCheck(js) {
  const f = join(TMP, `nc-${_seq++}.js`);
  writeFileSync(f, js);
  execFileSync("node", ["--check", f]); // throws → fails with the node diagnostic
}
// Materialize the emitted .server.js as an importable ESM module and return its
// `fetch` (the WinterCG aggregate) + `routes`. The endpoint is self-contained
// (inline arms), so no symbol stubbing is needed.
async function loadServer(src) {
  const r = compile(src);
  const sjs = serverJs(r);
  const f = join(TMP, `server-${_seq++}.mjs`);
  writeFileSync(f, sjs);
  const mod = await import(f);
  return { r, sjs, fetch: mod.fetch, routes: mod.routes };
}
function post(body) {
  return new Request("http://fleet.local/fsp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// One compile shared across the runtime assertions.
let SRV;
beforeAll(async () => { SRV = await loadServer(FSP_ENDPOINT); });

// ===========================================================================
describe("(A) dispatch + direct-serialize — each variant → typed value as JSON 200 (§61.4/§61.5)", () => {
  test("FleetStatus (unit variant) → 200 + the result envelope, serialized verbatim", async () => {
    const res = await SRV.fetch(post({ tag: "FleetStatus" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ jsonrpc: "2.0", result: { active: 3, idle: 1 } });
  });

  test("Dispatch(prompt, project) → 200 + positional payload bound into the arm and back on the wire", async () => {
    const res = await SRV.fetch(post({ tag: "Dispatch", prompt: "scale fleet", project: "atlas" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      result: { accepted: true, project: "atlas", prompt: "scale fleet" },
    });
  });

  test("DeltaSince(seq) → 200 + the typed int cursor flows through the decode into the result", async () => {
    const res = await SRV.fetch(post({ tag: "DeltaSince", seq: 42 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", result: { since: 42, count: 0 } });
  });
});

// ===========================================================================
describe("(B) compiler-owned decode failure → 400 { error: { kind, message } } (§61.3)", () => {
  test("a missing discriminator → 400 MissingDiscriminator (NOT routed to an arm)", async () => {
    const res = await SRV.fetch(post({ not_a_tag: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.kind).toBe("MissingDiscriminator");
    expect(typeof body.error.message).toBe("string");
  });

  test("an unknown variant tag → 400 UnknownVariant", async () => {
    const res = await SRV.fetch(post({ tag: "Teleport" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.kind).toBe("UnknownVariant");
    expect(body.error.message).toContain("Teleport");
  });

  test("a payload type-mismatch (seq is not an int) → 400 InvalidPayload (the §53 refinement guard)", async () => {
    const res = await SRV.fetch(post({ tag: "DeltaSince", seq: "soon" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.kind).toBe("InvalidPayload");
    expect(body.error.message).toContain("seq");
  });
});

// ===========================================================================
describe("(C) author-owned JSON-RPC error RESULT → 200 verbatim — the terminal-reject-over-the-wire analog (§61.5)", () => {
  test("Halt (arm returns an { jsonrpc, error } value) → 200, serialized VERBATIM (NOT the compiler 400)", async () => {
    const res = await SRV.fetch(post({ tag: "Halt" }));
    // CRITICAL: an author-returned error-shaped value is a typed RETURN value,
    // not a decode failure — so it is the §61.5 success path (status 200), the
    // author's exact wire. The compiler-owned 400 (group B) is ONLY for decode
    // failures. This is the distinction the conformance bar pins down.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "service halted by operator" },
    });
  });
});

// ===========================================================================
describe("(D) route registration at the verbatim path=/method= + node --check (§61.7)", () => {
  test("routes carries exactly one record at the author-stable /fsp POST (never a compiler hash)", () => {
    const r = compile(FSP_ENDPOINT);
    const sjs = serverJs(r);
    // The route record SHAPE the WinterCG aggregate auto-collects.
    expect(sjs).toMatch(/export const __ri_route_endpoint_\d+ = \{\s*\n\s*path: "\/fsp",\s*\n\s*method: "POST",/);
    expect(sjs).toMatch(/export const routes = \[__ri_route_endpoint_\d+\];/);
    // The imported aggregate confirms the live record (not just the text).
    expect(Array.isArray(SRV.routes)).toBe(true);
    expect(SRV.routes.length).toBe(1);
    expect(SRV.routes[0].path).toBe("/fsp");
    expect(SRV.routes[0].method).toBe("POST");
    expect(typeof SRV.routes[0].handler).toBe("function");
  });

  test("the fetch aggregate only matches the verbatim path+method (a wrong path returns no record)", async () => {
    const miss = await SRV.fetch(new Request("http://fleet.local/not-fsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "FleetStatus" }),
    }));
    expect(miss).toBeNull(); // the aggregate returns null when no route matches
  });

  test("the emitted .server.js is node --check clean (a codegen miscompile is silent)", () => {
    nodeCheck(SRV.sjs);
  });
});

// ===========================================================================
describe("(E) client-codegen SKIP — NO endpoint surface in the client bundle (§61.6)", () => {
  test("the client bundle carries no endpoint handler / route / decode surface", () => {
    const r = compile(FSP_ENDPOINT);
    const cjs = clientJs(r);
    expect(cjs).not.toContain("_scrml_endpoint_");
    expect(cjs).not.toContain("__ri_route_endpoint");
    expect(cjs).not.toContain("switch (_v.tag)");
  });

  test("the emitted .client.js is node --check clean (the endpoint-decl is skipped, not a choke)", () => {
    const r = compile(FSP_ENDPOINT);
    const cjs = clientJs(r);
    expect(cjs.length).toBeGreaterThan(0);
    nodeCheck(cjs);
  });
});
