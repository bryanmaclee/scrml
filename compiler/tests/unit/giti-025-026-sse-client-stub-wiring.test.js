// GITI-025 + GITI-026 (giti inbound 2026-05-30) — coupled §37 SSE codegen bugs.
//
// GITI-025 — parameterized `server function*` parameters unwired:
//   SERVER: the SSE handler built `route.query` from the URL searchParams but
//     never bound the generator's declared params from it, so the gen body
//     referenced them as FREE identifiers (ReferenceError, swallowed by the
//     stream catch -> empty stream).
//   CLIENT: the EventSource stub hard-wired its signature to
//     `(_scrml_onMessage, _scrml_onEvent)` and opened a query-less EventSource,
//     so a call like `countdown(5)` dropped its arg into the callback slot and
//     the server never received `from`.
//
// GITI-026 — client reactive binding `@cell = gen()` dead:
//   The client emitted `_scrml_reactive_set("cell", _scrml_sse_X())`, storing
//   the returned EventSource OBJECT in the cell and passing no message callback,
//   so stream events never updated the cell. Named-event yields ({event,data})
//   were additionally unreachable (stub set onmessage only, never
//   addEventListener).
//
// Fix locations:
//   - emit-server.ts SSE branch: emit `const <p> = route.query["<p>"]` (coercion)
//   - emit-functions.ts SSE branch: params lead the stub signature + URL query
//     encoding; addEventListener for statically-known named events
//   - emit-client.ts post-sse-reactive-bind stage: rewrite reactive_set/init_set
//     to subscribe via the trailing message callback (not store the EventSource)
//
// Cross-refs SPEC §37 (SSE `server function*`); §37.4 event shape; §37.5
// client-side binding; §37.11 worked examples. docs/changes/
// giti-025-026-sse-client-stub-wiring-2026-05-30/.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { compileScrml } from "../../src/api.js";

const _testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmpCounter = 0;

// Compile a single .scrml source string -> {server, client, errors, warnings}.
function compile(source, tag) {
  const _tag = tag ?? `giti25-26-${++_tmpCounter}`;
  const _tmpDir = resolve(_testDir, `_tmp_giti25_26_${_tag}`);
  const _tmpInput = resolve(_tmpDir, `${_tag}.scrml`);
  mkdirSync(_tmpDir, { recursive: true });
  writeFileSync(_tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [_tmpInput],
      write: false,
      outputDir: resolve(_tmpDir, "out"),
    });
    let server = "";
    let client = "";
    for (const [fp, output] of (result.outputs ?? new Map())) {
      if (fp.includes(_tag)) {
        if (output && typeof output.serverJs === "string") server = output.serverJs;
        if (output && typeof output.clientJs === "string") client = output.clientJs;
      }
    }
    return { server, client, errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(_tmpInput)) rmSync(_tmpInput);
    if (existsSync(_tmpDir)) rmSync(_tmpDir, { recursive: true });
  }
}

// Parameterized + no-arg generators, both bound to reactive cells (§37.11 form).
const PARAM_SRC = `<program>
\${
  server function* countdown(from) {
    for (let i = from; i >= 0; i--) {
      yield i
    }
  }
  server function* ticks() {
    let i = 0
    while (i < 3) {
      yield i
      i = i + 1
    }
  }
  @latest = countdown(5)
  @tick   = ticks()
}
<div>
  <p>\${@latest}</>
  <p>\${@tick}</>
</div>
</program>
`;

// No-arg, default-event generator — the canonical §37.5.1 reactive SSE.
const NOARG_SRC = `<program>
\${
  server function* ticks() {
    let i = 0
    while (i < 5) {
      yield i
      i = i + 1
    }
  }
  @latest = ticks()
}
<div><p>\${@latest}</></div>
</program>
`;

// Named-event generator (§37.4.2 {event,data} form).
const NAMED_SRC = `<program>
\${
  server function* activityFeed(userId) {
    yield { event: "activity", data: userId }
    yield { event: "ping", data: 0 }
  }
  @feed = activityFeed(7)
}
<div><p>\${@feed}</></div>
</program>
`;

// ---------------------------------------------------------------------------
// GITI-025 SERVER — generator params bound from route.query
// ---------------------------------------------------------------------------

describe("GITI-025 server: SSE generator params bound from route.query", () => {
  test("parameterized generator binds `from` from route.query (no free identifier)", () => {
    const { server, errors } = compile(PARAM_SRC, "g25-srv-param");
    expect(errors).toHaveLength(0);
    // The handler must declare `from` sourced from route.query — before the fix
    // `from` was a free variable inside the generator body.
    expect(server).toContain('route.query["from"]');
    expect(server).toMatch(/const from = /);
  });

  test("no-arg generator emits no spurious param binding", () => {
    const { server } = compile(NOARG_SRC, "g25-srv-noarg");
    expect(server).not.toContain('route.query["from"]');
  });

  test("query-bound param is coercion-aware (recovers Number from string query)", () => {
    const { server } = compile(PARAM_SRC, "g25-srv-coerce");
    // The binding must coerce: `?from=5` arrives as the string "5"; the gen
    // counts numerically. Assert the Number() recovery is present.
    expect(server).toMatch(/Number\(_v\)/);
  });
});

// ---------------------------------------------------------------------------
// GITI-025 CLIENT — params lead the stub + URL query encoding
// ---------------------------------------------------------------------------

describe("GITI-025 client: SSE stub encodes call args into EventSource URL", () => {
  test("stub signature puts the declared param FIRST, callback trailing", () => {
    const { client } = compile(PARAM_SRC, "g25-cli-sig");
    // Before the fix: `function _scrml_sse_countdown_N(_scrml_onMessage, _scrml_onEvent)`.
    expect(client).toMatch(/function _scrml_sse_countdown_\d+\(from, _scrml_onMessage\)/);
  });

  test("EventSource URL carries the param query string with the verbatim key name", () => {
    const { client } = compile(PARAM_SRC, "g25-cli-url");
    expect(client).toContain("new URLSearchParams()");
    expect(client).toContain('if (from !== null && from !== undefined) _scrml_qs.set("from", String(from))');
    // The base path is concatenated with the query string.
    expect(client).toMatch(/new EventSource\("\/_scrml\/__ri_route_countdown_\d+" \+ \(_scrml_q \?/);
  });

  test("no-arg generator stub keeps the plain query-less EventSource", () => {
    const { client } = compile(NOARG_SRC, "g25-cli-noarg");
    expect(client).toMatch(/function _scrml_sse_ticks_\d+\(_scrml_onMessage\)/);
    expect(client).toMatch(/new EventSource\("\/_scrml\/__ri_route_ticks_\d+"\)/);
  });
});

// ---------------------------------------------------------------------------
// GITI-026 CLIENT — reactive binding subscribes via callback (not store ES)
// ---------------------------------------------------------------------------

describe("GITI-026 client: SSE reactive binding subscribes via per-event callback", () => {
  test("no-arg binding routes each event into the cell via callback", () => {
    const { client } = compile(NOARG_SRC, "g26-bind-noarg");
    // The fixed shape: subscribe with a trailing callback.
    expect(client).toMatch(
      /_scrml_sse_ticks_\d+\(\(_scrml_d\) => _scrml_reactive_set\("latest", _scrml_d\)\)/,
    );
    // Cell is seeded to absence (undefined), NOT the EventSource object.
    expect(client).toContain('_scrml_reactive_set("latest", null)');
  });

  test("no bare `_scrml_reactive_set(cell, _scrml_sse_X())` storing the EventSource remains", () => {
    const { client } = compile(NOARG_SRC, "g26-no-bare");
    // The dead shape must be gone: reactive_set whose value is a *bare* sse call
    // with no trailing callback arg.
    expect(client).not.toMatch(/_scrml_reactive_set\("latest", _scrml_sse_ticks_\d+\(\)\)/);
  });

  test("parameterized binding passes BOTH the arg and the callback", () => {
    const { client } = compile(PARAM_SRC, "g26-bind-param");
    expect(client).toMatch(
      /_scrml_sse_countdown_\d+\(5, \(_scrml_d\) => _scrml_reactive_set\("latest", _scrml_d\)\)/,
    );
  });

  test("init_set reset thunk re-subscribes and seeds absence", () => {
    const { client } = compile(NOARG_SRC, "g26-init-thunk");
    // The reset thunk subscribes (side-effect) and returns absence so reset
    // re-seeds the cell rather than storing the EventSource.
    expect(client).toMatch(
      /_scrml_init_set\("latest", \(\) => \{ _scrml_sse_ticks_\d+\(\(_scrml_d\) => _scrml_reactive_set\("latest", _scrml_d\)\); return null; \}\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// GITI-026 named-event facet — addEventListener for {event,data} yields
// ---------------------------------------------------------------------------

describe("GITI-026 named-event facet: addEventListener for §37.4.2 named yields", () => {
  test("statically-known event names get addEventListener listeners", () => {
    const { client } = compile(NAMED_SRC, "g26-named");
    expect(client).toContain('_scrml_es.addEventListener("activity"');
    expect(client).toContain('_scrml_es.addEventListener("ping"');
  });

  test("named-event listeners route parsed data to the same message callback", () => {
    const { client } = compile(NAMED_SRC, "g26-named-cb");
    // Each addEventListener body parses JSON and forwards to _scrml_onMessage.
    const addBlocks = client.split('_scrml_es.addEventListener(').slice(1);
    expect(addBlocks.length).toBeGreaterThanOrEqual(2);
    for (const b of addBlocks) {
      const head = b.slice(0, 200);
      expect(head).toContain("JSON.parse");
      expect(head).toContain("_scrml_onMessage");
    }
  });

  test("onmessage path is preserved for bare yields (no regression)", () => {
    const { client } = compile(NOARG_SRC, "g26-onmessage");
    expect(client).toContain("_scrml_es.onmessage");
    // Bare-yield generator has no named events -> no EventSource addEventListener.
    // (document.addEventListener('DOMContentLoaded') is unrelated DOM wiring.)
    expect(client).not.toContain("_scrml_es.addEventListener");
  });
});

// ---------------------------------------------------------------------------
// Absence convention — emitted SSE wiring uses canonical `null`, not the
// bare `undefined` keyword (SPEC §42.5/§42.8; W-CG-UNDEFINED-INTERPOLATION).
// ---------------------------------------------------------------------------

describe("SSE wiring uses canonical null absence (no W-CG-UNDEFINED-INTERPOLATION)", () => {
  test("no W-CG-UNDEFINED-INTERPOLATION warning is emitted for parameterized SSE", () => {
    const { warnings } = compile(PARAM_SRC, "abs-param");
    const offenders = warnings.filter(w => w && w.code === "W-CG-UNDEFINED-INTERPOLATION");
    expect(offenders).toHaveLength(0);
  });

  test("no W-CG-UNDEFINED-INTERPOLATION warning is emitted for no-arg SSE binding", () => {
    const { warnings } = compile(NOARG_SRC, "abs-noarg");
    const offenders = warnings.filter(w => w && w.code === "W-CG-UNDEFINED-INTERPOLATION");
    expect(offenders).toHaveLength(0);
  });
});
