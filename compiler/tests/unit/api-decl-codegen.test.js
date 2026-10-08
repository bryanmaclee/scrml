// ---------------------------------------------------------------------------
// <api> / <request api=> codegen — emitted client JS shape (A2 W5,
// api-primitive-a2-2026-06-20)
// ---------------------------------------------------------------------------
//
// SPEC §60 (Typed External API). W4 wired the codegen; W5 proves the emitted
// client JS empirically (a string-shape regression test alongside the W5 worked
// example's R26 end-to-end verification). The asserted shapes:
//
//   • Per-endpoint typed `fetch(base + path, { method, body? })` (§60.4):
//     base from `<api base=>`, path from the endpoint with `${param}`
//     substituted from the `args` cell, method from the endpoint decl. A
//     body-carrying method (POST/PUT/PATCH) carries the JSON-serialized args
//     body; GET/DELETE do not.
//   • Variant (`:enum`) ResponseT decode reuses `parseVariant` (§60.5 / §41.13):
//     the `<request>` `.data` lands the decoded variant; a `::ParseError` decode
//     failure routes to `.error` (the `__scrml_error` sentinel).
//   • Non-variant ResponseT raw-passes the wire body into `.data` (§60.5
//     variant-vs-non-variant amendment) — NO parseVariant decode emitted.
//   • Client-only (§60.6 / §12.2): an `<api>`-only app emits NO server bundle;
//     a raw external fetch is not a §12.2 server-placement trigger.
//   • `node --check` clean on the emitted client JS (a codegen miscompile is
//     silent; the string asserts are necessary but not sufficient).
//
// THE CANONICAL APP SHAPE. Every fixture wraps the `<api>` + `<request api=>`
// in a `<program>` (the kickstarter-required root, §40.8). W4's api-decl-typer
// fixtures were UN-wrapped (api-decl as a top-level node); under `<program>` the
// `<api>` nests inside the markup subtree, so the typer/codegen MUST deep-walk
// to find it. (A shallow top-level scan silently dropped the entire fetch +
// skipped every §60 check — the W5 deep-walk fix this file guards.)

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "api-codegen-"));

// ---- helpers --------------------------------------------------------------
let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
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
// `node --check` every emitted client artifact (a codegen miscompile is silent).
function nodeChecks(r) {
  let checked = 0;
  for (const [, entry] of (r.outputs ?? new Map())) {
    if (entry && typeof entry === "object" && typeof entry.clientJs === "string" && entry.clientJs.length > 0) {
      const f = join(TMP, `nc-${_seq++}.js`);
      writeFileSync(f, entry.clientJs);
      // throws on a parse error → the test fails with the node diagnostic.
      execFileSync("node", ["--check", f]);
      checked++;
    }
  }
  return checked;
}
function apiErrs(r) {
  return (r.errors ?? []).filter(e =>
    (e.code ?? "").startsWith("E-API-") || (e.code ?? "") === "E-TYPE-UNKNOWN-NAME");
}

// A canonical `<program>`-wrapped `<api>` + `<request api=>` app with a
// VARIANT response type (the §60.5 parseVariant happy path).
const VARIANT_APP =
  `<program>\n` +
  `\${\n` +
  `  type UserQuery:struct = { id: int }\n` +
  `  type UserResult:enum = { Found(name: string), NotFound }\n` +
  `  <query>: UserQuery = { id: 1 }\n` +
  `}\n` +
  `<api base="https://api.example.com">\n` +
  `  getUser(UserQuery) -> GET "/users/\${id}" : UserResult\n` +
  `</api>\n` +
  `<div>\n` +
  `  <request id="profile" api="getUser" args=@query></>\n` +
  `  <p>Fetching…</p>\n` +
  `</div>\n` +
  `</program>\n`;

// ===========================================================================
describe("<api> codegen — per-endpoint typed fetch (§60.4), variant decode (§60.5), client-only (§60.6)", () => {
  test("the GET endpoint emits a real fetch to base+path with the right method + path-param substitution", () => {
    const r = compile(VARIANT_APP);
    expect(apiErrs(r)).toEqual([]);
    const js = clientJs(r);
    // The endpoint-driven request emits a thin typed callable (§60.4).
    expect(js).toContain(`// <request id="profile" api="getUser">`);
    // fetch target = base URL + path template, the `${id}` path-param
    // substituted from the args cell (URL-encoded so a segment cannot break
    // the URL).
    expect(js).toContain(`"https://api.example.com"`);
    expect(js).toContain(`"/users/"`);
    expect(js).toContain(`_scrml_g.encodeURIComponent(_scrml_g.String(_args["id"]))`);
    // GET method on the request init; a GET carries NO JSON body.
    expect(js).toContain(`{ method: "GET" }`);
    expect(js).not.toContain(`body: _scrml_g.JSON.stringify(_args)`);
  });

  test("a VARIANT ResponseT decodes via parseVariant into .data; a ::ParseError routes to .error (§60.5)", () => {
    const js = clientJs(compile(VARIANT_APP));
    // The §60.5 boundary-parse — a parseVariant decode IIFE against UserResult.
    expect(js).toContain(`switch (_v.tag)`);
    expect(js).toContain(`case "Found":`);
    expect(js).toContain(`case "NotFound":`);
    // Decode success → .data; decode failure (__scrml_error sentinel) → .error.
    expect(js).toContain(`var _decoded =`);
    expect(js).toContain(`if (_decoded && _decoded.__scrml_error === true) {`);
    expect(js).toContain(`_scrml_request_profile.error = _decoded;`);
    expect(js).toContain(`_scrml_request_profile.data = _decoded;`);
  });

  test("the <request> exposes the §6.7.7 reactive surface (loading/data/error/stale + refetch + seq-guard)", () => {
    const js = clientJs(compile(VARIANT_APP));
    expect(js).toContain(`var _scrml_request_profile = _scrml_deep_reactive({ loading: true, data: null, error: null, stale: false });`);
    expect(js).toContain(`_scrml_request_profile.refetch = _scrml_request_profile_fetch;`);
    // EC-2 superseding-fetch sequence guard (§6.7.7).
    expect(js).toContain(`var _scrml_request_profile_seq = 0;`);
    expect(js).toContain(`_seq !== _scrml_request_profile_seq`);
    // Scope-destroy cleanup (EC-3 mounted guard).
    expect(js).toContain(`_scrml_register_cleanup(`);
  });

  test("an <api>-only app emits NO server bundle (§60.6 client-only) and node --check is clean", () => {
    const r = compile(VARIANT_APP);
    expect(hasServerBundle(r)).toBe(false);
    expect(nodeChecks(r)).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe("<api> codegen — POST endpoint carries a JSON body (§60.4)", () => {
  const POST_APP =
    `<program>\n` +
    `\${\n` +
    `  type OrderInput:struct = { sku: string, qty: int }\n` +
    `  type OrderResult:enum = { Placed(id: string), Rejected(reason: string) }\n` +
    `  <order>: OrderInput = { sku: "abc", qty: 1 }\n` +
    `}\n` +
    `<api base="https://api.example.com">\n` +
    `  createOrder(OrderInput) -> POST "/orders" : OrderResult\n` +
    `</api>\n` +
    `<div>\n` +
    `  <request id="placed" api="createOrder" args=@order></>\n` +
    `  <p>Placing…</p>\n` +
    `</div>\n` +
    `</program>\n`;

  test("a POST endpoint emits method + JSON content-type header + the args body", () => {
    const r = compile(POST_APP);
    expect(apiErrs(r)).toEqual([]);
    const js = clientJs(r);
    expect(js).toContain(`method: "POST",`);
    expect(js).toContain(`headers: { "Content-Type": "application/json" },`);
    expect(js).toContain(`body: _scrml_g.JSON.stringify(_args),`);
    // The variant decode still applies on the POST response.
    expect(js).toContain(`case "Placed":`);
    expect(js).toContain(`case "Rejected":`);
  });

  test("the POST app is client-only and node --check clean", () => {
    const r = compile(POST_APP);
    expect(hasServerBundle(r)).toBe(false);
    expect(nodeChecks(r)).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
describe("<api> codegen — non-variant ResponseT raw-passes the body, NO parseVariant (§60.5)", () => {
  const STRUCT_APP =
    `<program>\n` +
    `\${\n` +
    `  type Q:struct = { id: int }\n` +
    `  type User:struct = { id: int, name: string }\n` +
    `  <query>: Q = { id: 1 }\n` +
    `}\n` +
    `<api base="https://api.example.com">\n` +
    `  getUser(Q) -> GET "/users/\${id}" : User\n` +
    `</api>\n` +
    `<div>\n` +
    `  <request id="profile" api="getUser" args=@query></>\n` +
    `  <p>x</p>\n` +
    `</div>\n` +
    `</program>\n`;

  test("a STRUCT response raw-passes the wire body into .data with NO parseVariant decode", () => {
    const r = compile(STRUCT_APP);
    const js = clientJs(r);
    // The fetch still emits (§60.4) …
    expect(js).toContain(`// <request id="profile" api="getUser">`);
    expect(js).toContain(`{ method: "GET" }`);
    // … but the body is raw-passed (§60.5) — no parseVariant decode surface.
    expect(js).toContain(`_scrml_request_profile.data = _body;`);
    expect(js).not.toContain(`switch (_v.tag)`);
    expect(js).not.toContain(`var _decoded =`);
  });

  test("the typer fires W-API-RESPONSE-NOT-VARIANT (Info) on the struct response — cross-stream partition", () => {
    const r = compile(STRUCT_APP);
    // Info → result.warnings (cross-stream helper: NEVER result.errors.filter on a W- code).
    const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
    const w = all.filter(d => (d.code ?? "") === "W-API-RESPONSE-NOT-VARIANT");
    expect(w.length).toBe(1);
    expect((r.errors ?? []).some(e => (e.code ?? "") === "W-API-RESPONSE-NOT-VARIANT")).toBe(false);
  });
});

// ===========================================================================
describe("<api> codegen — deep-walk under <program> (W5 fix): wrapped <api> is found", () => {
  // The regression this file's deep-walk fix guards: with the canonical
  // `<program>` wrapper the `api-decl` is NOT a top-level node, so a shallow
  // top-level scan (getNodes / the W4 top-level-only assumption) found NO
  // endpoint — emitRequestNode silently dropped the fetch and the typer skipped
  // every §60 check. The fetch + decode MUST emit under `<program>`.
  test("the wrapped <api> emits the fetch (not silently dropped)", () => {
    const js = clientJs(compile(VARIANT_APP));
    expect(js).toContain(`await _scrml_g.fetch(`);
    expect(js).toContain(`async function _scrml_request_profile_fetch()`);
  });

  test("an <api> nested inside an extra markup wrapper is still found (deep walk, not depth-1)", () => {
    const NESTED =
      `<program>\n` +
      `\${\n` +
      `  type Q:struct = { id: int }\n` +
      `  type R:enum = { Found(name: string), NotFound }\n` +
      `  <query>: Q = { id: 1 }\n` +
      `}\n` +
      `<main>\n` +
      `  <section>\n` +
      `    <api base="https://deep.example.com">\n` +
      `      getThing(Q) -> GET "/things/\${id}" : R\n` +
      `    </api>\n` +
      `    <request id="thing" api="getThing" args=@query></>\n` +
      `  </section>\n` +
      `</main>\n` +
      `</program>\n`;
    const r = compile(NESTED);
    expect(apiErrs(r)).toEqual([]);
    const js = clientJs(r);
    expect(js).toContain(`"https://deep.example.com"`);
    expect(js).toContain(`"/things/"`);
    expect(js).toContain(`switch (_v.tag)`); // variant decode wired for the deep <api>
    expect(hasServerBundle(r)).toBe(false);
  });

  test("a wrapped <request api=X> naming a misspelled endpoint still fires E-API-ENDPOINT-UNKNOWN (typer deep-walk)", () => {
    const MISSPELLED =
      `<program>\n` +
      `\${\n` +
      `  type Q:struct = { id: int }\n` +
      `  type R:enum = { Found(name: string), NotFound }\n` +
      `  <query>: Q = { id: 1 }\n` +
      `}\n` +
      `<api base="https://api.example.com">\n` +
      `  getUser(Q) -> GET "/users/\${id}" : R\n` +
      `</api>\n` +
      `<div>\n` +
      `  <request id="r" api="getUserTYPO" args=@query></>\n` +
      `</div>\n` +
      `</program>\n`;
    const r = compile(MISSPELLED);
    expect((r.errors ?? []).filter(e => (e.code ?? "") === "E-API-ENDPOINT-UNKNOWN").length).toBe(1);
  });
});
