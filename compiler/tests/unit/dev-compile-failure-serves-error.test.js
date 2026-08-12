/**
 * dev compile-failure serving — Unit Tests (adopter-#517)
 *
 * Regression gate for issue #517: on a compile failure `scrml dev` used to keep
 * serving a partial (helper-dropped) or silently-stale bundle, so a route call
 * threw a MISLEADING `X is not defined` runtime error that masked the real
 * compile error and cost the adopter a multi-hour hunt.
 *
 * The fix records the last compile's diagnostics (noteCompileResult) and, while
 * it is failing, the fetch handler short-circuits EVERY non-infra request to
 * serve the REAL compile error at the request. These tests drive the exported
 * pure surface — no Bun.serve() is started and no compile runs.
 *
 * Coverage:
 *   §1  noteCompileResult sets failure state on errors, clears it on success
 *   §2  buildCompileErrorResponse — HTML overlay for navigations
 *   §3  buildCompileErrorResponse — JSON for fetch / route calls
 *   §4  fetch short-circuits to the compile error while failing (before dispatch/static)
 *   §5  fetch exempts the two dev-infra endpoints (live-reload, log)
 *   §6  fetch resumes normal serving once the failure is cleared (gated on state)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  noteCompileResult,
  getCompileFailure,
  buildCompileErrorResponse,
  buildServeConfig,
  sseClients,
} from "../../src/commands/dev.js";

// A representative fatal-error set: the exact shape api.js emits (flat
// filePath/line/column) plus a BS-stage span shape, mirroring the #517 report
// (an invalid `!==` → E-EQ-004, and the emit-gate E-CODEGEN-INVALID-LOGIC).
const FAILURE = {
  errors: [
    { stage: "TAB", code: "E-EQ-004", message: "`!==` is not a scrml operator; use `is not`", filePath: "/proj/portal.scrml", line: 42, column: 8 },
    { stage: "CG", code: "E-CODEGEN-INVALID-LOGIC", message: "the compiler could not lower this construct", span: { file: "/proj/portal.scrml", line: 51, col: 3 } },
  ],
  warnings: [],
};

function htmlReq(path = "/") {
  return new Request(`http://localhost${path}`, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } });
}
function jsonReq(path = "/_scrml/route/saveMaintQueueRow", method = "POST") {
  return new Request(`http://localhost${path}`, { method, headers: { accept: "application/json" } });
}

beforeEach(() => {
  // Reset to the succeeded (normal-serving) state before each test.
  noteCompileResult({ errors: [] });
  sseClients.clear();
});

// ---------------------------------------------------------------------------
// §1 — noteCompileResult toggles the failure state
// ---------------------------------------------------------------------------

describe("§1 noteCompileResult()", () => {
  test("errors present ⇒ failure state carries the diagnostics", () => {
    noteCompileResult(FAILURE);
    const f = getCompileFailure();
    expect(f).not.toBeNull();
    expect(f.errors.length).toBe(2);
    expect(f.errors[0].code).toBe("E-EQ-004");
  });

  test("no errors ⇒ failure state is cleared (normal serving)", () => {
    noteCompileResult(FAILURE);
    expect(getCompileFailure()).not.toBeNull();
    noteCompileResult({ errors: [], warnings: [] });
    expect(getCompileFailure()).toBeNull();
  });

  test("missing/empty result is treated as success, never throws", () => {
    expect(() => noteCompileResult(undefined)).not.toThrow();
    expect(getCompileFailure()).toBeNull();
    expect(() => noteCompileResult({})).not.toThrow();
    expect(getCompileFailure()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2 — HTML overlay for page navigations
// ---------------------------------------------------------------------------

describe("§2 buildCompileErrorResponse() HTML overlay", () => {
  test("navigation (Accept: text/html) → 500 text/html carrying every diagnostic", async () => {
    const res = buildCompileErrorResponse(htmlReq("/"), FAILURE);
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("E-EQ-004");
    expect(body).toContain("E-CODEGEN-INVALID-LOGIC");
    expect(body).toContain("portal.scrml");
  });

  test("overlay carries the hot-reload script so it auto-refreshes on fix", async () => {
    const body = await buildCompileErrorResponse(htmlReq("/"), FAILURE).text();
    expect(body).toContain("/_scrml/live-reload");
    expect(body).toContain("location.reload()");
  });

  test("diagnostic messages are HTML-escaped (no raw injection)", async () => {
    const failure = { errors: [{ stage: "CG", code: "E-X", message: "bad <tag> & \"q\"", filePath: "f.scrml", line: 1, column: 1 }], warnings: [] };
    const body = await buildCompileErrorResponse(htmlReq("/"), failure).text();
    expect(body).toContain("&lt;tag&gt;");
    expect(body).not.toContain("bad <tag>");
  });
});

// ---------------------------------------------------------------------------
// §3 — JSON for fetch / server-fn route calls
// ---------------------------------------------------------------------------

describe("§3 buildCompileErrorResponse() JSON for route calls", () => {
  test("route call (Accept: application/json) → 500 JSON with structured errors", async () => {
    const res = buildCompileErrorResponse(jsonReq(), FAILURE);
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const payload = await res.json();
    expect(payload.error).toBe("scrml compile failed");
    expect(payload.errors.map((e) => e.code)).toEqual(["E-EQ-004", "E-CODEGEN-INVALID-LOGIC"]);
    // The BS-span shape is normalized to flat file/line/column.
    expect(payload.errors[1].file).toBe("/proj/portal.scrml");
    expect(payload.errors[1].line).toBe(51);
  });

  test("the misleading `X is not defined` symptom is NOT what the adopter receives", async () => {
    const payload = await buildCompileErrorResponse(jsonReq(), FAILURE).json();
    const text = JSON.stringify(payload);
    expect(text).toContain("E-EQ-004");
    expect(text).not.toContain("is not defined");
  });
});

// ---------------------------------------------------------------------------
// §4 — fetch short-circuits while failing, BEFORE route dispatch / static
// ---------------------------------------------------------------------------

describe("§4 fetch() short-circuit while compile is failing", () => {
  // A bogus serveDir: if the handler ever fell through to static resolution it
  // would statSync a non-existent path and 404. A 500 compile-error response
  // therefore PROVES the short-circuit fired before route dispatch and static.
  const opts = { port: 0, inputFiles: ["/proj/portal.scrml"] };
  const BOGUS = "/no/such/serve/dir";

  test("a route-shaped POST returns the compile error, not a dispatched/404 result", async () => {
    noteCompileResult(FAILURE);
    const { fetch } = buildServeConfig(opts, BOGUS);
    const res = await fetch(jsonReq("/_scrml/route/saveMaintQueueRow"), undefined);
    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.error).toBe("scrml compile failed");
    expect(payload.errors[0].code).toBe("E-EQ-004");
  });

  test("a page navigation returns the compile-error overlay, not a partial/stale bundle", async () => {
    noteCompileResult(FAILURE);
    const { fetch } = buildServeConfig(opts, BOGUS);
    const res = await fetch(htmlReq("/"), undefined);
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("E-CODEGEN-INVALID-LOGIC");
  });
});

// ---------------------------------------------------------------------------
// §5 — dev-infra endpoints stay live during a failure (reconnect + reload)
// ---------------------------------------------------------------------------

describe("§5 fetch() exempts dev-infra endpoints while failing", () => {
  const opts = { port: 0, inputFiles: ["/proj/portal.scrml"] };
  const BOGUS = "/no/such/serve/dir";

  test("/_scrml/live-reload still returns the SSE stream (so the browser reloads on fix)", async () => {
    noteCompileResult(FAILURE);
    const { fetch } = buildServeConfig(opts, BOGUS);
    const res = await fetch(new Request("http://localhost/_scrml/live-reload"), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  test("/_scrml/log still accepts client log beacons (204), not a 500", async () => {
    noteCompileResult(FAILURE);
    const { fetch } = buildServeConfig(opts, BOGUS);
    const req = new Request("http://localhost/_scrml/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: "client", msg: "hi", loc: "x" }),
    });
    const res = await fetch(req, undefined);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// §6 — behavior is GATED on the failure state (no false positives)
// ---------------------------------------------------------------------------

describe("§6 fetch() resumes normal serving once cleared", () => {
  const opts = { port: 0, inputFiles: ["/proj/portal.scrml"] };
  const BOGUS = "/no/such/serve/dir";

  test("cleared state ⇒ a miss falls through to normal 404 (not a compile-error 500)", async () => {
    noteCompileResult({ errors: [] }); // success
    const { fetch } = buildServeConfig(opts, BOGUS);
    const res = await fetch(htmlReq("/definitely-missing"), undefined);
    expect(res.status).toBe(404);
  });
});
