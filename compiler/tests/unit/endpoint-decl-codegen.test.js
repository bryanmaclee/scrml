// ---------------------------------------------------------------------------
// <endpoint> codegen — emitted server JS shape (§61 W4,
// endpoint-primitive-2026-06-25)
// ---------------------------------------------------------------------------
//
// SPEC §61 (Typed Inbound Endpoint). W4 wires the codegen: the SERVER
// route-handler ONLY (§61.6 — no paired client fetch-stub; the foreign client
// has its own SDK). The asserted shapes:
//
//   • The request body is decoded via parseVariant (§61.3 / §41.13) against the
//     `accepts=` enum — the SAME total/failable tagged-variant decoder the §60
//     `<api>` response half uses (REUSE, no new decoder): a per-variant
//     `switch (_v.tag)` IIFE applied to `await _scrml_req.json()`.
//   • The decoded variant drives an exhaustive dispatch (§61.4): one `case` per
//     `accepts=` variant, payload locals bound positionally from `.data`.
//   • The arm's typed value-return is enveloped DIRECTLY as the JSON success
//     body (§61.5): `JSON.stringify(_scrml_result)`, status 200,
//     `application/json`. A self-closing `<Variant/>` arm → 204 No Content.
//   • A decode failure (§61.3) → the compiler-owned structured error envelope
//     `{ error: { kind, message } }`, status 400 (kind ∈ the §41.13 ParseError
//     family: MissingDiscriminator / UnknownVariant / InvalidPayload / Malformed).
//   • The handler is registered at the author-stable `path=`/`method=` via
//     `export const __ri_route_endpoint_<id> = { path, method, handler }`
//     (§61.7), auto-collected into the WinterCG `routes` / `fetch` aggregate.
//   • NO CSRF block (§61.7 — JSON+bearer is CSRF-exempt by construction).
//   • Client-codegen SKIP (§61.6): NO paired client fetch-stub, NO endpoint
//     handler, and the client pipeline does not choke on the `endpoint-decl`.
//   • `node --check` clean on the emitted .server.js AND .client.js (a codegen
//     miscompile is silent; the string asserts are necessary but not sufficient).
//
// THE CANONICAL APP SHAPE. Every fixture wraps the `<endpoint>` in a `<program>`
// (the kickstarter-required root, §40.8). Under `<program>` the `<endpoint>`
// nests inside the markup subtree, so the codegen MUST deep-walk to find it (a
// shallow top-level scan silently drops the entire handler).

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "endpoint-codegen-"));
// scrml emits ES modules. `node --check` picks the module kind from the nearest package.json, and
// there is none above os.tmpdir(), so it would parse an ESM artifact under CommonJS rules and
// report `export` as a SyntaxError — a red gate for a reason no change caused. Declare the module
// type the artifacts are actually emitted in.
writeFileSync(join(TMP, "package.json"), '{"type":"module"}\n');

// ---- helpers --------------------------------------------------------------
let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function serverJs(r) {
  let out = "";
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry === "object" && typeof entry.serverJs === "string") out += entry.serverJs + "\n";
  }
  return out;
}
function clientJs(r) {
  let out = "";
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry === "object" && typeof entry.clientJs === "string") out += entry.clientJs + "\n";
  }
  return out;
}
function hasServerBundle(r) {
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry.serverJs === "string" && entry.serverJs.length > 0) return true;
  }
  return false;
}
// `node --check` every emitted artifact of a kind (a codegen miscompile is silent).
function nodeChecks(r, kind) {
  let checked = 0;
  for (const [, entry] of (r.outputs ?? new Map())) {
    const js = entry && typeof entry === "object" ? entry[kind] : null;
    if (typeof js === "string" && js.length > 0) {
      const f = join(TMP, `nc-${_seq++}.js`);
      writeFileSync(f, js);
      execFileSync("node", ["--check", f]); // throws → test fails with the node diagnostic
      checked++;
    }
  }
  return checked;
}
function endpointErrs(r) {
  return (r.errors ?? []).filter(e =>
    (e.code ?? "").startsWith("E-ENDPOINT-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
}

// A canonical `<program>`-wrapped `<endpoint>` with the 3-variant FSP-method
// enum — the §61.2 worked example (unit + 2 payload variants).
const FSP_ENDPOINT =
  `<program>\n` +
  `\${\n` +
  `  type FspMethod:enum = { FleetStatus, Dispatch(prompt: string, project: string), DeltaSince(seq: int) }\n` +
  `}\n` +
  `<endpoint path="/fsp" method="POST" accepts=FspMethod>\n` +
  `  <FleetStatus : fleetStatus()>\n` +
  `  <Dispatch(prompt, proj) : dispatch(prompt, proj)>\n` +
  `  <DeltaSince(seq) : deltasSince(seq)>\n` +
  `</endpoint>\n` +
  `</program>\n`;

// ===========================================================================
describe("<endpoint> codegen — server route-handler (§61.6), parseVariant decode (§61.3), dispatch (§61.4)", () => {
  test("a valid 3-variant endpoint compiles clean (no E-ENDPOINT-* / E-TYPE-UNKNOWN-NAME)", () => {
    const r = compile(FSP_ENDPOINT);
    expect(endpointErrs(r)).toEqual([]);
    expect(hasServerBundle(r)).toBe(true);
  });

  test("the handler decodes the body via parseVariant (§61.3) against the accepts= enum", () => {
    const js = serverJs(compile(FSP_ENDPOINT));
    // The async server handler reads the request body, then decodes it.
    expect(js).toContain(`async function _scrml_endpoint_`);
    expect(js).toContain(`const _scrml_body = await _scrml_req.json();`);
    // The §61.3 boundary-parse — a parseVariant decode IIFE against FspMethod
    // (REUSE emit-parse-variant — the same `switch (_v.tag)` shape <api> uses).
    expect(js).toContain(`switch (_v.tag)`);
    expect(js).toContain(`case "FleetStatus":`);
    expect(js).toContain(`case "Dispatch":`);
    expect(js).toContain(`case "DeltaSince":`);
    // A typed payload guard (string + integer), per the §41.13 decoder.
    expect(js).toContain(`typeof _v["prompt"] === "string"`);
    expect(js).toContain(`Number.isInteger(_v["seq"])`);
  });

  test("the decoded variant drives an exhaustive 3-arm dispatch (§61.4) with positional payload binding", () => {
    const js = serverJs(compile(FSP_ENDPOINT));
    // tag extraction (bare-string unit variant OR { variant, data } payload variant).
    expect(js).toContain(`const _scrml_tag = typeof _scrml_decoded === "string" ? _scrml_decoded : _scrml_decoded.variant;`);
    // One dispatch case per variant.
    expect(js).toContain(`case "FleetStatus": {`);
    expect(js).toContain(`case "Dispatch": {`);
    expect(js).toContain(`case "DeltaSince": {`);
    // Positional payload binding — `proj` (arm local) binds the 2nd declared
    // field `project`; `prompt` binds the 1st; `seq` the only DeltaSince field.
    expect(js).toContain(`const prompt = _scrml_decoded.data["prompt"];`);
    expect(js).toContain(`const proj = _scrml_decoded.data["project"];`);
    expect(js).toContain(`const seq = _scrml_decoded.data["seq"];`);
    // Each arm awaits its lowered `:`-shorthand body expr.
    expect(js).toContain(`const _scrml_result = await (fleetStatus());`);
    expect(js).toContain(`const _scrml_result = await (dispatch(prompt, proj));`);
    expect(js).toContain(`const _scrml_result = await (deltasSince(seq));`);
  });

  test("the arm's typed value-return is enveloped DIRECTLY as the JSON success body (§61.5, status 200)", () => {
    const js = serverJs(compile(FSP_ENDPOINT));
    expect(js).toContain(`return new Response(JSON.stringify(_scrml_result), {`);
    expect(js).toContain(`status: 200,`);
    expect(js).toContain(`headers: { "Content-Type": "application/json" },`);
  });

  test("a decode failure → the compiler-owned structured error envelope (§61.3, status 400)", () => {
    const js = serverJs(compile(FSP_ENDPOINT));
    // The shared decode-failure helper + its dispatch from the handler.
    expect(js).toContain(`function _scrml_endpoint_decode_error(_scrml_decoded) {`);
    expect(js).toContain(`if (_scrml_decoded && _scrml_decoded.__scrml_error) {`);
    expect(js).toContain(`return _scrml_endpoint_decode_error(_scrml_decoded);`);
    // The §61.5 envelope schema: { error: { kind, message } }, 400.
    expect(js).toContain(`error: { kind: _scrml_decoded.variant, message: _scrml_message }`);
    expect(js).toContain(`status: 400,`);
    // The ParseError family the kind ranges over.
    expect(js).toContain(`case "MissingDiscriminator":`);
    expect(js).toContain(`case "UnknownVariant":`);
    expect(js).toContain(`case "InvalidPayload":`);
  });

  test("the handler registers at the verbatim path=/method= and joins routes/fetch (§61.7)", () => {
    const js = serverJs(compile(FSP_ENDPOINT));
    // The route record SHAPE the route-collection regex auto-collects.
    expect(js).toMatch(/export const __ri_route_endpoint_\d+ = \{\s*\n\s*path: "\/fsp",/);
    expect(js).toContain(`method: "POST",`);
    expect(js).toMatch(/handler: _scrml_endpoint_\d+,/);
    // Auto-collected into the WinterCG aggregate (routes + fetch dispatch).
    expect(js).toMatch(/export const routes = \[__ri_route_endpoint_\d+\];/);
    expect(js).toContain(`if (r.path === url.pathname && r.method === request.method) {`);
    expect(js).toContain(`return r.handler(request);`);
  });

  test("the endpoint handler carries NO CSRF block (§61.7 — CSRF-exempt by construction)", () => {
    const r = compile(FSP_ENDPOINT);
    const js = serverJs(r);
    expect(js).not.toContain(`_scrml_validate_csrf`);
    expect(js).not.toContain(`_scrml_ensure_csrf_cookie`);
    expect(js).not.toContain(`CSRF validation`);
  });

  test("the emitted .server.js AND .client.js are node --check clean", () => {
    const r = compile(FSP_ENDPOINT);
    expect(nodeChecks(r, "serverJs")).toBeGreaterThanOrEqual(1);
    expect(nodeChecks(r, "clientJs")).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe("<endpoint> codegen — client-codegen SKIP (§61.6): server handler only", () => {
  test("the client bundle emits NO paired fetch-stub / handler and does not choke on endpoint-decl", () => {
    const r = compile(FSP_ENDPOINT);
    const cjs = clientJs(r);
    // No endpoint handler, no endpoint route record, no endpoint decode surface
    // leak into the client (the foreign client has its own SDK).
    expect(cjs).not.toContain(`_scrml_endpoint_`);
    expect(cjs).not.toContain(`__ri_route_endpoint`);
    expect(cjs).not.toContain(`switch (_v.tag)`);
    // The client still compiled clean (the endpoint-decl kind is skipped, not a choke).
    expect(nodeChecks(r, "clientJs")).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe("<endpoint> codegen — malformed body decodes to a 400 structured error at runtime", () => {
  test("a missing-discriminator body returns 400 + { error: { kind, message } }; a known variant dispatches", async () => {
    const r = compile(FSP_ENDPOINT);
    const sjs = serverJs(r);
    // Make the handler runnable in isolation: stub the (undefined) arm targets
    // and capture the route's `fetch`. The endpoint codegen is what we exercise.
    const harness =
      `globalThis.fleetStatus = () => ({ ok: true });\n` +
      `globalThis.dispatch = (p, j) => ({ accepted: true, prompt: p, project: j });\n` +
      `globalThis.deltasSince = (s) => ({ seq: s });\n` +
      sjs.replace(/\bfunction fleetStatus\b/g, "function __unused_fleetStatus")
         .replace(/\bfunction dispatch\b/g, "function __unused_dispatch")
         .replace(/\bfunction deltasSince\b/g, "function __unused_deltasSince") +
      `\nexport { fetch as _epFetch };\n`;
    const f = join(TMP, `runtime-${_seq++}.mjs`);
    writeFileSync(f, harness);
    const mod = await import(f);

    // (a) malformed (no `tag` discriminator) → 400 + the structured error envelope.
    const bad = await mod._epFetch(new Request("http://x/fsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not_a_tag: 1 }),
    }));
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error.kind).toBe("MissingDiscriminator");
    expect(typeof badBody.error.message).toBe("string");

    // (b) a well-formed payload variant → 200 + the arm result serialized directly.
    const ok = await mod._epFetch(new Request("http://x/fsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "Dispatch", prompt: "hello", project: "p1" }),
    }));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody).toEqual({ accepted: true, prompt: "hello", project: "p1" });

    // (c) a payload type-mismatch → 400 InvalidPayload (the §41.13 decoder guard).
    const invalid = await mod._epFetch(new Request("http://x/fsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "DeltaSince", seq: "not-an-int" }),
    }));
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error.kind).toBe("InvalidPayload");
  });
});
