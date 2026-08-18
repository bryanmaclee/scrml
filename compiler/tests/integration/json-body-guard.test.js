/**
 * §61.3 / dpa-030 D4 — the bounded, fail-closed inbound JSON body read.
 *
 * THREE emitted server prologues decoded a foreign request body with one
 * unguarded line — `const _scrml_body = await _scrml_req.json();` — carrying two
 * defects:
 *
 *   1. NO CEILING at any size. A 10 MiB body was read in full and processed.
 *      A live DoS that predates uploads, reachable by an UNAUTHENTICATED foreign
 *      client on an `<endpoint>` (§61.7 makes JSON+bearer routes CSRF-exempt by
 *      construction).
 *
 *   2. MALFORMED JSON THREW. `{not json` produced an uncaught SyntaxError one
 *      line ABOVE `parseVariant`, so §61.3's promised compiler-owned
 *      `{ error: { kind, message } }` 400 envelope was STRUCTURALLY UNREACHABLE
 *      for the input class a foreign client is most likely to send.
 *
 * These tests EXECUTE the emitted handler. The over-HTTP case additionally
 * proves the ceiling is ENFORCEABLE rather than advisory: the oversized body is
 * aborted mid-stream and never fully pulled from the client.
 */
import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SERVER_JSON_BODY_LIMIT_BYTES } from "../../src/codegen/server-body-guard.ts";

// Shape borrowed from the landed `<endpoint>` codegen fixture (§61.2 arm form).
const ENDPOINT_APP = `<program>
\${
  type Msg:enum = { Ping, Echo(text: string) }
  function pong() { return "pong" }
  function echo(t: string) { return t }
}
<endpoint path="/api" method="POST" accepts=Msg>
  <Ping : pong()>
  <Echo(t) : echo(t)>
</endpoint>
</program>
`;

function compileApp(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-body-guard-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dir, validateEmit: true, log: () => {} });
  return { result, dir, serverJsPath: join(dir, "app.server.js"), serverJs: readFileSync(join(dir, "app.server.js"), "utf8") };
}

async function loadEndpoint(serverJsPath) {
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  const route = (mod.routes ?? []).find((r) => r.path === "/api");
  expect(route).toBeTruthy();
  return { mod, route };
}

const post = (body) =>
  new Request("http://localhost/api", {
    method: "POST", body, headers: { "Content-Type": "application/json" },
  });

// happy-dom (registered globally by sibling browser tests in a full-suite run)
// replaces `fetch` with an implementation that cannot send a streaming request
// body. Same guard the authed-server-fn HTTP suite uses, and for the same reason.
const domPolluted = () => typeof globalThis.document !== "undefined";

describe("§61.3 — a malformed body reaches the compiler-owned 400, not a SyntaxError", () => {
  test("EXECUTED: `{not json at all` -> 400 { error: { kind, message } }", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    const res = await route.handler(post("{not json at all"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.kind).toBe("MalformedBody");
    expect(body.error.message).toContain("not valid JSON");
  });

  test("EXECUTED: an EMPTY body -> 400, not `Unexpected end of JSON input`", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    const res = await route.handler(post(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error.kind).toBe("MalformedBody");
  });

  test("EXECUTED: a well-formed body with an UNKNOWN variant still gets §61.3's own 400", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    const res = await route.handler(post(JSON.stringify({ tag: "Nope" })));
    expect(res.status).toBe(400);
    // The parseVariant envelope, NOT the body-guard one — the guard must not
    // swallow the decode path it exists to make reachable.
    expect((await res.json()).error.kind).toBe("UnknownVariant");
  });

  test("EXECUTED: a VALID body still dispatches (the guard is transparent on the happy path)", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    const res = await route.handler(post(JSON.stringify({ tag: "Ping" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toBe("pong");
  });
});

describe("the body-size ceiling", () => {
  test("EXECUTED: a body over the ceiling -> 413, not a 200", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    const oversized = JSON.stringify({ tag: "Echo", text: "a".repeat(SERVER_JSON_BODY_LIMIT_BYTES + 1024) });
    const res = await route.handler(post(oversized));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.kind).toBe("PayloadTooLarge");
  });

  test("EXECUTED: a body just UNDER the ceiling is accepted (the boundary is not off-by-one)", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    // Leave room for the JSON envelope around the payload.
    const text = "a".repeat(SERVER_JSON_BODY_LIMIT_BYTES - 1024);
    const res = await route.handler(post(JSON.stringify({ tag: "Echo", text })));
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(text.length);
  });

  test("a declared Content-Length over the ceiling is rejected WITHOUT reading the body", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);
    // A lying/oversized Content-Length on a body that is never supplied: the
    // fast-reject arm must fire before anything touches the stream.
    let pulled = false;
    const req = {
      url: "http://localhost/api",
      method: "POST",
      headers: {
        get: (k) => (String(k).toLowerCase() === "content-length"
          ? String(SERVER_JSON_BODY_LIMIT_BYTES + 1) : null),
      },
      get body() { pulled = true; return null; },
    };
    const res = await route.handler(req);
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
  });

  // THE ENFORCEABILITY PROOF, and it runs unconditionally.
  //
  // This is the property that separates an ENFORCED ceiling from an advisory
  // one: the handler must stop pulling from the source. It is measured directly
  // — a ReadableStream that COUNTS its own `pull` calls — with no HTTP stack in
  // the way, so no global-`fetch` substitution can make it vacuous.
  test("STREAM: the source stops being pulled once the ceiling is crossed", async () => {
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { route } = await loadEndpoint(serverJsPath);

    const CHUNK = new Uint8Array(64 * 1024).fill(65);
    const TOTAL = 160;                       // 10 MiB offered vs a 1 MiB ceiling
    let pulls = 0;
    const body = new ReadableStream({
      pull(c) {
        if (pulls >= TOTAL) { c.close(); return; }
        c.enqueue(CHUNK); pulls++;
      },
    });
    const req = {
      url: "http://localhost/api",
      method: "POST",
      headers: { get: () => null },          // no Content-Length: the STREAM path
      body,
    };
    const res = await route.handler(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.kind).toBe("PayloadTooLarge");
    // Bounded by the ceiling plus in-flight buffering — NOT by the offered size.
    // If this ever equals TOTAL, the body was fully materialized and the ceiling
    // bought nothing.
    expect(pulls).toBeLessThan(TOTAL);
    expect(pulls * CHUNK.byteLength).toBeLessThanOrEqual(SERVER_JSON_BODY_LIMIT_BYTES + 4 * CHUNK.byteLength);
  });

  // The same property end to end over a real socket. SKIPPED under happy-dom:
  // a sibling browser test registers happy-dom globally and its `fetch` cannot
  // send a streaming request body at all (`HPE_UNEXPECTED_CONTENT_LENGTH`), so
  // this measures the shim, not the server. The STREAM test above is the
  // unconditional proof; this one is the end-to-end confirmation.
  test("OVER HTTP: the oversized body is ABORTED mid-stream, not fully pulled", async () => {
    if (domPolluted()) return;
    const { serverJsPath } = compileApp(ENDPOINT_APP);
    const { mod } = await loadEndpoint(serverJsPath);
    const server = Bun.serve({ port: 0, fetch: (req) => mod.fetch(req) });
    try {
      const CHUNK = new Uint8Array(64 * 1024).fill(65);
      const TOTAL = 160;                     // 10 MiB offered against a 1 MiB ceiling
      let sent = 0;
      const body = new ReadableStream({
        pull(c) {
          if (sent >= TOTAL) { c.close(); return; }
          c.enqueue(CHUNK); sent++;
        },
      });
      const res = await fetch(`http://localhost:${server.port}/api`, {
        method: "POST", body, duplex: "half",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(413);
      expect((await res.json()).error.kind).toBe("PayloadTooLarge");
      // Backpressure held: the client was never asked for the whole 10 MiB. The
      // bound is generous (the ceiling plus in-flight buffering) — the assertion
      // is "materially fewer than all of them", which is what distinguishes an
      // enforced ceiling from an advisory one.
      expect(sent).toBeLessThan(TOTAL);
    } finally { server.stop(true); }
  }, 20000);
});

// ---------------------------------------------------------------------------
// S350 fix round 1, R4 — `getReader()` must be INSIDE the try.
//
// `_scrml_read_json_body` took the reader on the line BEFORE its `try`. When the
// body stream is already locked or disturbed — a `handle()` middleware that
// called `request.json()` and then passed the same request down to the route —
// `getReader()` throws `TypeError: ReadableStream is locked` and that TypeError
// ESCAPED UNCAUGHT, bypassing the compiler-owned envelope §61.3 exists to
// guarantee. MEASURED by executing the emitted helper, not by reading it.
// ---------------------------------------------------------------------------
describe("§61.3 R4 — a locked/disturbed body still gets the compiler-owned envelope", () => {
  // Pull the SHIPPED helper out of a real emitted artifact and run it, so this
  // exercises the bytes the server actually loads.
  async function loadBodyReader(serverJs) {
    const sliceFn = (name) => {
      const asyncAt = serverJs.indexOf(`async function ${name}(`);
      const start = asyncAt >= 0 ? asyncAt : serverJs.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      let depth = 0, i = serverJs.indexOf("{", start), end = -1;
      for (; i < serverJs.length; i++) {
        if (serverJs[i] === "{") depth++;
        else if (serverJs[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      return serverJs.slice(start, end);
    };
    const limit = serverJs.match(/const _SCRML_JSON_BODY_LIMIT = [^;]+;/)[0];
    const src = [limit, sliceFn("_scrml_body_error"), sliceFn("_scrml_read_json_body")].join("\n");
    const factory = new Function(`${src}\nreturn _scrml_read_json_body;`);
    return factory();
  }

  test("EXECUTED: a LOCKED body returns the 400 envelope instead of throwing", async () => {
    const { serverJs } = compileApp(ENDPOINT_APP);
    const read = await loadBodyReader(serverJs);
    const req = post(JSON.stringify({ type: "Ping" }));
    req.body.getReader();                       // a prior consumer holds the reader
    const r = await read(req);                  // must NOT throw
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(400);
    expect((await r.response.json()).error.kind).toBe("MalformedBody");
  });

  test("EXECUTED: a DISTURBED body (already read) returns the 400 envelope", async () => {
    const { serverJs } = compileApp(ENDPOINT_APP);
    const read = await loadBodyReader(serverJs);
    const req = post(JSON.stringify({ type: "Ping" }));
    await req.json();                           // handle() consumed it first
    const r = await read(req);
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(400);
  });

  test("EXECUTED negative control: the happy path and the malformed path are unchanged", async () => {
    const { serverJs } = compileApp(ENDPOINT_APP);
    const read = await loadBodyReader(serverJs);
    const ok = await read(post(JSON.stringify({ type: "Ping" })));
    expect(ok.ok).toBe(true);
    expect(ok.value.type).toBe("Ping");
    const bad = await read(post("{not json"));
    expect(bad.ok).toBe(false);
    expect(bad.response.status).toBe(400);
  });
});

describe("NEGATIVE CONTROLS", () => {
  // Inline-on-use: an `auth="required"` program emits a real server bundle (the
  // `/_scrml/session` projection + destroy routes + the SSR compose handler) and
  // NONE of those handlers reads a JSON body — so the helper must be absent.
  test("a server bundle with NO JSON prologue does not carry the helper (inline-on-use)", () => {
    const { serverJs } = compileApp(`<program auth="required">
<div><p>hi</p></div>
</program>
`);
    expect(serverJs).toContain("export const routes");  // there IS a real bundle
    expect(serverJs).not.toContain("_scrml_read_json_body");
    expect(serverJs).not.toContain("_SCRML_JSON_BODY_LIMIT");
  });

  test("the helper is emitted ONCE even with several JSON prologues", () => {
    const { serverJs } = compileApp(`<program db="app.db">
  \${
    export server function a(x: string) { return x }
    export server function b(y: string) { return y }
  }
  <div><p>hi</p></div>
</program>`);
    const defs = serverJs.split("async function _scrml_read_json_body(").length - 1;
    expect(defs).toBe(1);
    // …and both prologues use it.
    expect(serverJs.split("await _scrml_read_json_body(_scrml_req)").length - 1).toBe(2);
  });

  test("the ceiling is a NAMED const in the adopter's own bundle (greppable, one site)", () => {
    const { serverJs } = compileApp(ENDPOINT_APP);
    expect(serverJs).toContain(`const _SCRML_JSON_BODY_LIMIT = ${SERVER_JSON_BODY_LIMIT_BYTES};`);
  });
});
