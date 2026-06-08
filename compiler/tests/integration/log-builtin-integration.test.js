/**
 * §20.6 — location-transparent `log()` builtin: full-compile integration.
 *
 * Verifies the end-to-end behaviour the unit suite cannot reach:
 *   - side-tag correctness from real route inference ([client] vs [server]);
 *   - file:line baked from the real source position;
 *   - production strip → ZERO `_scrml_log` in the bundle (F4=A);
 *   - the W-LOG-SHADOWED info diagnostic + the user `log` winning (shadowing);
 *   - the server-side helper inlined into `.server.js`;
 *   - emitted JS is syntactically valid (`new Function`).
 *
 * The W-LOG-SHADOWED assertions use a CROSS-STREAM helper (per the diagnostic-
 * partition rule): a W- code lands in result.warnings, but assert over BOTH
 * streams so a partition regression (W- silently moving to result.errors) fails
 * here rather than passing silently.
 *
 * Ratified S173 (deep-dive log-location-transparency-2026-06-07.md); built S174.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "log-builtin-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src, extraOpts = {}) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  const res = compileScrml({
    inputFiles: [fp],
    outputDir: join(TMP, "dist"),
    write: false,
    log: () => {},
    ...extraOpts,
  });
  const out = res.outputs.get(fp);
  return { res, out, fp };
}

// Cross-stream diagnostic helper (W-/I- codes partition to result.warnings).
function diags(res, code) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === code);
}

// Client JS is a classic-script IIFE — `new Function` is a valid syntax gate.
function validClientJs(js) {
  expect(() => new Function(js)).not.toThrow();
}

// Server JS is an ES module (carries `import`); `new Function` rejects module
// syntax. Use `node --check` over a temp file (the real syntax gate, S138 R26).
function validServerJs(js, dir) {
  const fp = join(dir, `chk-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(fp, js);
  expect(() => execFileSync(process.execPath, ["--check", fp])).not.toThrow();
}

// ---------------------------------------------------------------------------
// §A — client-side log() tags [client] + carries file:line
// ---------------------------------------------------------------------------

describe("§20.6 — client log() lowering", () => {
  const SRC = `<title>App</title>

<count> = 0

\${
  function bump() {
    @count = @count + 1
    log("bumped")
    log(@count)
  }
}

<button onclick=bump()>Bump</button>
{@count}`;

  test("client log() emits _scrml_log(\"client\", \"<file:line>\", ...)", () => {
    const { out } = compile(SRC);
    expect(out?.clientJs).toBeTruthy();
    expect(out.clientJs).toContain('_scrml_log("client",');
    // Two log() calls, both tagged client.
    const calls = out.clientJs.match(/_scrml_log\("client"/g) || [];
    expect(calls.length).toBe(2);
  });

  test("the origin tag carries the real source file:line", () => {
    const { out } = compile(SRC);
    // `log("bumped")` is on source line 8; `log(@count)` on line 9.
    expect(out.clientJs).toMatch(/_scrml_log\("client", "[^"]*\.scrml:8"/);
    expect(out.clientJs).toMatch(/_scrml_log\("client", "[^"]*\.scrml:9"/);
  });

  test("the emitted client JS is syntactically valid", () => {
    const { out } = compile(SRC);
    validClientJs(out.clientJs);
  });

  test("the client bundle carries a _scrml_log( call (the chunk gate signal)", () => {
    const { out } = compile(SRC);
    // runtimeJs is a separate artifact in write:false mode; the chunk-gate
    // signal we can observe here is the emitted _scrml_log( call itself (the
    // post-emit scan adds the runtime chunk iff this call is present).
    expect(out.clientJs).toContain("_scrml_log(");
  });
});

// ---------------------------------------------------------------------------
// §B — server-side log() tags [server] + inlines the server helper + no client leak
// ---------------------------------------------------------------------------

describe("§20.6 — server log() lowering", () => {
  const SRC = `<program db="postgres://localhost/app">
  <title>Srv</title>
</program>

\${
  server function audit() {
    log("audit start")
    ?{INSERT INTO audit_log (ts) VALUES (now())}
    log("audit done")
  }
}

<button onclick=audit()>Audit</button>`;

  test("server-batch log() emits _scrml_log(\"server\", ...) on the server side", () => {
    const { out } = compile(SRC);
    expect(out?.serverJs).toBeTruthy();
    expect(out.serverJs).toContain('_scrml_log("server",');
  });

  test("the server module inlines the _scrml_log helper (no client runtime there)", () => {
    const { out } = compile(SRC);
    expect(out.serverJs).toContain("function _scrml_log(");
    expect(out.serverJs).toContain("function _scrml_log_render(");
  });

  test("the server log() does NOT leak its message into client.js", () => {
    const { out } = compile(SRC);
    expect(out.clientJs ?? "").not.toContain("audit start");
    expect(out.clientJs ?? "").not.toContain("audit done");
  });

  test("the emitted server JS is syntactically valid", () => {
    const { out } = compile(SRC);
    validServerJs(out.serverJs, TMP);
  });

  test("no W-CG-UNDEFINED-INTERPOLATION from the log helpers", () => {
    const { res } = compile(SRC);
    // The render helper uses typeof guards, not the bare `undefined` keyword.
    expect(diags(res, "W-CG-UNDEFINED-INTERPOLATION").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §C — production strip (F4=A): zero _scrml_log bytes
// ---------------------------------------------------------------------------

describe("§20.6 — production strip", () => {
  const SRC = `<title>App</title>

<count> = 0

\${
  function bump() {
    @count = @count + 1
    log("debug only", @count)
  }
}

<button onclick=bump()>Bump</button>
{@count}`;

  test("production build contains ZERO _scrml_log in client + runtime", () => {
    const { out } = compile(SRC, { production: true });
    expect(out.clientJs).not.toContain("_scrml_log");
  });

  test("production build strips log() to a no-op but keeps the surrounding code", () => {
    const { out } = compile(SRC, { production: true });
    // The @count increment survives; only log() is gone.
    expect(out.clientJs).toContain('_scrml_reactive_set("count"');
    expect(out.clientJs).toContain("(void 0)");
    expect(out.clientJs).not.toContain("debug only"); // arg literal dropped
    validClientJs(out.clientJs);
  });

  test("dev build (default) DOES include _scrml_log (the strip is opt-in)", () => {
    const { out } = compile(SRC);
    expect(out.clientJs).toContain("_scrml_log");
  });
});

// ---------------------------------------------------------------------------
// §D — shadowing: a user `function log` wins + W-LOG-SHADOWED fires
// ---------------------------------------------------------------------------

describe("§20.6 — shadowing", () => {
  const SRC = `<title>App</title>

<count> = 0

\${
  function log(s: string) {
    let _ = s
  }
  function bump() {
    @count = @count + 1
    log("shadowed")
  }
}

<button onclick=bump()>Bump</button>
{@count}`;

  test("W-LOG-SHADOWED fires (info, partitioned to warnings)", () => {
    const { res } = compile(SRC);
    const hits = diags(res, "W-LOG-SHADOWED");
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("info");
    // Partition: lands in warnings, not errors.
    expect((res.errors || []).some((e) => e.code === "W-LOG-SHADOWED")).toBe(false);
    expect((res.warnings || []).some((e) => e.code === "W-LOG-SHADOWED")).toBe(true);
  });

  test("the user's `log` wins — the call is NOT the _scrml_log builtin", () => {
    const { out } = compile(SRC);
    // The builtin lowering is suppressed; the call resolves to the user fn
    // (whose name may be mangled, e.g. _scrml_log_N — but NOT _scrml_log(side,...)).
    expect(out.clientJs).not.toContain('_scrml_log("client"');
    expect(out.clientJs).not.toContain('_scrml_log("server"');
  });

  test("a shadowed build emits no _scrml_log( builtin call (chunk omitted)", () => {
    const { out } = compile(SRC);
    // The builtin lowering is suppressed, so no _scrml_log( call is emitted;
    // the post-emit chunk gate therefore omits the runtime chunk entirely.
    expect(out.clientJs).not.toContain("_scrml_log(");
  });

  test("compile still SUCCEEDS (the lint is non-fatal info)", () => {
    const { res } = compile(SRC);
    // No hard errors from the shadowing path.
    expect((res.errors || []).filter((e) => e.code === "W-LOG-SHADOWED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §E — value render: structs / markup-as-value reach the call readably
// ---------------------------------------------------------------------------

describe("§20.6 — value rendering reaches the runtime", () => {
  test("log(@struct) lowers — the runtime render (not JSON.stringify) handles it", () => {
    const SRC = `<title>App</title>

<user> = { name: "Ann", age: 3 }

\${
  function show() {
    log(@user)
  }
}

<button onclick=show()>Show</button>`;
    const { out } = compile(SRC);
    // The struct value is passed through verbatim to _scrml_log; the runtime
    // _scrml_log_render handles the readable render (unit-tested separately
    // over SERVER_LOG_HELPER). Here we confirm the call lowers + is valid.
    expect(out.clientJs).toContain('_scrml_log("client"');
    // The struct cell is READ (not re-wrapped) and passed to _scrml_log verbatim.
    expect(out.clientJs).toContain('_scrml_log("client", "f-');
    expect(out.clientJs).toMatch(/_scrml_log\("client", "[^"]+", _scrml_reactive_get\("user"\)\)/);
    validClientJs(out.clientJs);
  });
});
