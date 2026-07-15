/**
 * §64 (server-program-shape Fork 1A, Unit 2) — the LISTENER-OWNING
 * `kind="tool" serve=` serve-harness.
 *
 * A `<program kind="tool" serve=PORT [cors=]>` containing `<endpoint>` (§61) /
 * `server function* route=` SSE (§37) children emits a compiler-owned
 * `Bun.serve({ port, fetch, websocket? })` mounting those routes — replacing the
 * §64.7 hand-rolled `_{}` `Bun.serve`. The route/fetch surface is the Unit-1
 * headless emit (`generateHeadlessServerJs`); Unit 2 adds the listener + the
 * `serve=`/`cors=` attribute surface + the main-optional / auth / port / placement
 * guardrails.
 *
 * Design authority: scrml-support/docs/deep-dives/server-program-shape-2026-07-12.md
 * (Fork 1A ruled) + SPEC §64.1/§64.2/§64.9 + §34 E-TOOL-SERVE-* rows.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as acorn from "acorn";

const TMP = mkdtempSync(join(tmpdir(), "serve-tool-emit-"));
let _seq = 0;

function compileTool(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
  let toolJs = "";
  for (const [, e] of (r.outputs ?? new Map())) {
    if (e && typeof e.toolJs === "string") toolJs += e.toolJs;
  }
  return { codes: (r.errors ?? []).map((e) => e.code), toolJs };
}
function parsesAsModule(src) {
  acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
}

const ENUM = "type FspMethod:enum = { FleetStatus, Dispatch(prompt: string, project: string) }";
const EP =
  '<endpoint path="/fsp" method="POST" accepts=FspMethod>\n' +
  '  <FleetStatus            : { jsonrpc: "2.0", result: { active: 3 } }>\n' +
  '  <Dispatch(prompt, proj) : { jsonrpc: "2.0", result: { prompt: prompt, project: proj } }>\n' +
  "</endpoint>";
const SSE =
  'server function* fspDeltas() route="/fsp/deltas" {\n' +
  '  yield { event: "delta", id: 1, data: { seq: 1 } }\n' +
  "}";

/** A serve= tool with an <endpoint> POST + an SSE route, NO main. */
function fspWire(extraProgAttrs = "", extraLogic = "", extraChildren = "") {
  return (
    `<program kind="tool" serve=7878 ${extraProgAttrs}>\n` +
    `\${\n  ${ENUM}\n  ${SSE}\n  ${extraLogic}\n}\n` +
    `${EP}\n${extraChildren}</program>\n`
  );
}

// ---------------------------------------------------------------------------
describe("§A serve-harness: Bun.serve mounting <endpoint> + SSE routes (no html/client/CSRF)", () => {
  test("emits a compiler-owned Bun.serve({ port, fetch }) mounting the endpoint + SSE routes", () => {
    const { codes, toolJs } = compileTool(fspWire());
    expect(codes).toEqual([]);

    // The serve-harness — a compiler-owned Bun.serve on the declared port.
    expect(toolJs).toContain("const _scrml_serve_port = 7878;");
    expect(toolJs).toContain("const _scrml_server = Bun.serve({");
    expect(toolJs).toContain("port: _scrml_serve_port,");
    // It iterates the mounted routes with (request, server) — WS routes get server.
    expect(toolJs).toContain("for (const _scrml_route of routes) {");
    expect(toolJs).toContain("_scrml_route.isWebSocket ? _scrml_route.handler(request, server) : _scrml_route.handler(request)");
    expect(toolJs).toContain('return new Response("Not Found", { status: 404 });');

    // The mounted routes: the §61 endpoint POST /fsp + the §37 SSE GET /fsp/deltas.
    expect(toolJs).toContain('path: "/fsp"');
    expect(toolJs).toContain('path: "/fsp/deltas"');
    expect(toolJs).toMatch(/export const routes = \[[^\]]*__ri_route_endpoint/);
    expect(toolJs).toMatch(/export const routes = \[[^\]]*fspDeltas/);

    // No channels → no websocket handler in the harness.
    expect(toolJs).not.toContain("websocket: _scrml_ws_handlers");

    // A runnable headless server — valid ES module.
    expect(() => parsesAsModule(toolJs)).not.toThrow();
  });

  test("headless shape: NO html / client bundle / CSRF / session scaffold leaks into the serve module", () => {
    const { toolJs } = compileTool(fspWire('auth="none"'));
    // No web-app scaffold — the whole cookie-session machinery is absent.
    for (const marker of [
      "<!DOCTYPE", "text/html", "_scrml_session_middleware", "_scrml_session_store",
      "_scrml_validate_csrf", "_scrml_ensure_csrf_cookie", "/__serverLoad", "/__mountHydrate",
      "_scrml_modules",
    ]) {
      expect(toolJs).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
describe("§B main-optional (§64.2 relaxed for serve=)", () => {
  test("a serve= tool with NO function main compiles — E-TOOL-001 does NOT fire", () => {
    const { codes, toolJs } = compileTool(fspWire());
    expect(codes).not.toContain("E-TOOL-001");
    // The serve-harness IS the entry — no `await main` for a no-main tool.
    expect(toolJs).not.toContain("await main(");
    expect(toolJs).toContain("Bun.serve({");
  });

  test("a NON-serve tool with no main STILL fires E-TOOL-001 (regression-guard both directions)", () => {
    const { codes } = compileTool('<program kind="tool">\n${ fn helper() -> int { 1 } }\n</program>\n');
    expect(codes).toContain("E-TOOL-001");
  });

  test("compose: a no-return main runs as setup, awaited BEFORE the serve-harness holds the process", () => {
    const src = fspWire("", 'function main(args: string[]) { log("boot") }');
    const { codes, toolJs } = compileTool(src);
    expect(codes).toEqual([]);
    expect(toolJs).toContain("function main(args) {");
    expect(toolJs).toContain("await main(process.argv.slice(2));");
    // The await precedes the Bun.serve harness.
    expect(toolJs.indexOf("await main(")).toBeLessThan(toolJs.indexOf("Bun.serve({"));
    expect(() => parsesAsModule(toolJs)).not.toThrow();
  });

  test("a numeric-return main + serve= is the incoherent combo → E-TOOL-SERVE-MAIN-EXITS", () => {
    const src = fspWire("", "function main(args: string[]): number { return 0 }");
    const { codes } = compileTool(src);
    expect(codes).toContain("E-TOOL-SERVE-MAIN-EXITS");
  });
});

// ---------------------------------------------------------------------------
describe("§C auth guardrail (E-TOOL-SERVE-AUTH-UNSUPPORTED)", () => {
  test("a serve= tool with cookie-session auth=\"required\" fires the guardrail", () => {
    const { codes } = compileTool(fspWire('auth="required"'));
    expect(codes).toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });

  test("a serve= tool with auth=\"optional\" fires the guardrail", () => {
    const { codes } = compileTool(fspWire('auth="optional"'));
    expect(codes).toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });

  test("a serve= tool with NO auth does NOT over-fire the guardrail", () => {
    const { codes } = compileTool(fspWire());
    expect(codes).not.toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });

  test("auth=\"none\" on a serve= tool does NOT fire (explicit no-auth is fine)", () => {
    const { codes } = compileTool(fspWire('auth="none"'));
    expect(codes).not.toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });
});

// ---------------------------------------------------------------------------
describe("§D placement + port shape", () => {
  test("serve= on a non-tool top-level <program> → E-TOOL-SERVE-MISPLACED", () => {
    const { codes } = compileTool('<program serve=7878>\n${ fn h() -> int { 1 } }\n</program>\n');
    expect(codes).toContain("E-TOOL-SERVE-MISPLACED");
  });

  test("serve=abc (bare non-numeric) → E-TOOL-SERVE-PORT-INVALID", () => {
    const { codes } = compileTool(`<program kind="tool" serve=abc>\n\${\n  ${ENUM}\n}\n${EP}\n</program>\n`);
    expect(codes).toContain("E-TOOL-SERVE-PORT-INVALID");
  });

  test("serve=7878 (bare integer literal) does NOT fire E-SCOPE-001 or PORT-INVALID", () => {
    const { codes } = compileTool(fspWire());
    expect(codes).not.toContain("E-SCOPE-001");
    expect(codes).not.toContain("E-TOOL-SERVE-PORT-INVALID");
  });
});

// ---------------------------------------------------------------------------
describe("§E channel WS route → websocket: handler in the harness", () => {
  test("a serve= tool with a §38 <channel> mounts websocket: _scrml_ws_handlers", () => {
    const src = fspWire("", "", '<channel name="live" topic="events"></channel>\n');
    const { codes, toolJs } = compileTool(src);
    expect(codes).toEqual([]);
    expect(toolJs).toContain("export const _scrml_ws_handlers = {");
    expect(toolJs).toContain("websocket: _scrml_ws_handlers,");
    // The channel is NOT E-TOOL-003 in a serve= tool (it is a hosted transport).
    expect(codes).not.toContain("E-TOOL-003");
    expect(() => parsesAsModule(toolJs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("§F cors= surface", () => {
  test("serve= cors=\"*\" emits the CORS preflight route + headers the harness mounts", () => {
    const { toolJs } = compileTool(fspWire('cors="*"'));
    expect(toolJs).toContain("_scrml_cors_options_route");
    expect(toolJs).toContain("function _scrml_cors_headers()");
    // The harness wildcard-matches the `/*` OPTIONS preflight route.
    expect(toolJs).toContain('_scrml_route.path === "/*"');
  });
});

// ---------------------------------------------------------------------------
describe("§G NON-serve tool is UNCHANGED (no serve-harness path)", () => {
  test("a plain CLI tool emits the §64.3 main harness and NO Bun.serve", () => {
    const src =
      '<program kind="tool" lang="ts">\n' +
      "${ function main(args: string[]): number { return 0 } }\n" +
      "</program>\n";
    const { codes, toolJs } = compileTool(src);
    expect(codes).toEqual([]);
    expect(toolJs).not.toContain("Bun.serve({");
    expect(toolJs).toContain("main() harness");
    expect(toolJs).toContain("process.exit(");
  });
});

// ---------------------------------------------------------------------------
// FIX-ROUND (adversarial /code-review) — 6 defects, one regression test each.
// ---------------------------------------------------------------------------
describe("FIX 1 — auth guardrail enumerates PER-CHANNEL auth= (security fail-open)", () => {
  test("serve= tool + <channel auth=\"required\"> fires E-TOOL-SERVE-AUTH-UNSUPPORTED (not silently unguarded)", () => {
    const src = fspWire("", "", '<channel name="live" topic="t" auth="required"></channel>\n');
    const { codes } = compileTool(src);
    expect(codes).toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });
  test("serve= tool + <channel auth=\"none\"> does NOT fire (explicit no-auth channel is fine)", () => {
    const src = fspWire("", "", '<channel name="live" topic="t" auth="none"></channel>\n');
    const { codes } = compileTool(src);
    expect(codes).not.toContain("E-TOOL-SERVE-AUTH-UNSUPPORTED");
  });
});

describe("FIX 2 — top-level const/let is EMITTED in the serve path (not dropped)", () => {
  test("a top-level const referenced in main AND an endpoint arm is DEFINED (no ReferenceError)", () => {
    const src =
      '<program kind="tool" serve=7878>\n' +
      "${\n" +
      '  const GREETING = "hi"\n' +
      "  " + ENUM + "\n" +
      "  function main(args: string[]) { log(GREETING) }\n" +
      "}\n" +
      '<endpoint path="/fsp" method="POST" accepts=FspMethod>\n' +
      "  <FleetStatus : { g: GREETING }>\n" +
      "  <Dispatch(prompt, proj) : { g: GREETING }>\n" +
      "</endpoint>\n" +
      "</program>\n";
    const { codes, toolJs } = compileTool(src);
    expect(codes).toEqual([]);
    // The const is DEFINED (a bare `const GREETING = ...`), referenced by both.
    expect(toolJs).toMatch(/\bconst GREETING = "hi";/);
    expect(() => parsesAsModule(toolJs)).not.toThrow();
  });
});

describe("FIX 3 — an <endpoint>/SSE route in a NON-serve tool is an ERROR (not a silent drop)", () => {
  test("<endpoint> in a non-serve kind=\"tool\" program → E-TOOL-ROUTE-NEEDS-SERVE", () => {
    const src =
      '<program kind="tool">\n' +
      "${ " + ENUM + "\nfunction main(a: string[]) { } }\n" +
      '<endpoint path="/fsp" method="POST" accepts=FspMethod>\n  <FleetStatus : { ok: true }>\n  <Dispatch(p, q) : { ok: true }>\n</endpoint>\n' +
      "</program>\n";
    const { codes } = compileTool(src);
    expect(codes).toContain("E-TOOL-ROUTE-NEEDS-SERVE");
  });
  test("an SSE server function* route= in a non-serve tool → E-TOOL-ROUTE-NEEDS-SERVE", () => {
    const src =
      '<program kind="tool">\n' +
      "${\n  " + SSE + "\n  function main(a: string[]) { }\n}\n" +
      "</program>\n";
    const { codes } = compileTool(src);
    expect(codes).toContain("E-TOOL-ROUTE-NEEDS-SERVE");
  });
  test("the SAME routes in a serve= tool do NOT fire E-TOOL-ROUTE-NEEDS-SERVE", () => {
    const { codes } = compileTool(fspWire());
    expect(codes).not.toContain("E-TOOL-ROUTE-NEEDS-SERVE");
  });
});

describe("FIX 4 — serve=${expr} resolves the program's own top-level consts", () => {
  test("serve=${PORT} with a top-level const PORT compiles clean + emits port: PORT (PORT defined)", () => {
    const src =
      "<program kind=\"tool\" serve=${PORT}>\n" +
      "${\n  const PORT = 8181\n  " + ENUM + "\n}\n" +
      '<endpoint path="/fsp" method="POST" accepts=FspMethod>\n  <FleetStatus : { ok: true }>\n  <Dispatch(p, q) : { ok: true }>\n</endpoint>\n' +
      "</program>\n";
    const { codes, toolJs } = compileTool(src);
    expect(codes).not.toContain("E-SCOPE-001");
    expect(codes).toEqual([]);
    expect(toolJs).toContain("const _scrml_serve_port = PORT;");
    expect(toolJs).toMatch(/\bconst PORT = 8181;/);
    expect(() => parsesAsModule(toolJs)).not.toThrow();
  });
});

describe("FIX 5 — port 0 (ephemeral) is consistent across literal + ${0}", () => {
  test("serve=0 and serve=${0} BOTH compile clean (0 = OS-assigned ephemeral)", () => {
    const lit = compileTool(`<program kind="tool" serve=0>\n\${ ${ENUM} }\n${EP}\n</program>\n`);
    const expr = compileTool(`<program kind="tool" serve=\${0}>\n\${ ${ENUM} }\n${EP}\n</program>\n`);
    expect(lit.codes).not.toContain("E-TOOL-SERVE-PORT-INVALID");
    expect(expr.codes).not.toContain("E-TOOL-SERVE-PORT-INVALID");
    // Both emit a concrete port-0 harness.
    expect(lit.toolJs).toContain("const _scrml_serve_port = 0;");
    expect(expr.toolJs).toContain("const _scrml_serve_port = 0;");
  });
});

describe("FIX 6 — serve-tool cors= emits from the REAL middleware config (no synth fallback)", () => {
  test("serve= cors=\"*\" emits the CORS route + headers via the threaded config", () => {
    const { codes, toolJs } = compileTool(fspWire('cors="*"'));
    expect(codes).toEqual([]);
    expect(toolJs).toContain("_scrml_cors_options_route");
    expect(toolJs).toContain("function _scrml_cors_headers()");
    expect(toolJs).toContain("'Access-Control-Allow-Origin': \"*\"");
  });
});
