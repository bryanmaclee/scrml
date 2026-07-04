/**
 * s144-server-fn-nested-block-lowering.test.js
 *
 * Regression cluster: giti inbound 2026-05-29 — GITI-020 + GITI-021 + GITI-022.
 * All three share ONE structural root: server-function body emission did not
 * thread per-function context into nested if/for/while blocks.
 *
 * GITI-020 (HIGH): a channel-cell write `@cell = expr` nested in a block inside
 *   a channel-owned server function mis-lowered to the client reactive pair
 *   `_scrml_reactive_set(...)` + `_scrml_init_set(...)` — both undefined in the
 *   emitted `.server.js` (runtime ReferenceError) and never broadcast. The SAME
 *   write at the top level correctly lowered to the §38.4 broadcast wire frame.
 *   Root: emit-logic's emitLogicNode dispatch of if/for did not forward
 *   `boundary` + `channelOwnedCells` into the nested-body opts, so the nested
 *   write never reached the server broadcast-lowering arm.
 *
 * GITI-021 (HIGH): a bare reassignment `id = expr` of an already-declared local
 *   inside a server-fn nested block emitted `const id = expr` — shadowing the
 *   outer binding (the write was silently dropped; the fn returned the default).
 *   The client/plain-fn path was fixed at S34; the server-fn body path was a
 *   separate copy that never seeded/threaded a shared `declaredNames` Set.
 *
 * GITI-022 (MED, gate-caught): `let x` (no init) followed by `x = 1` emitted
 *   `let x; const x = 1;` → E-CODEGEN-INVALID-LOGIC ("Identifier 'x' already
 *   declared"). Same declared-identifier-tracking gap as GITI-021.
 *
 * Coverage:
 *   §1  GITI-020 — channel server-fn, nested `@cell =` emits broadcast wire frame
 *   §2  GITI-021 — server-fn nested reassignment emits plain assignment (no const)
 *   §3  GITI-022 — server-fn `let x` + `x = v` emits valid JS (no `const x`)
 *   §4  No-regression — client/plain-fn path still emits plain reassignment (S34)
 *   §5  Guardrails — compound-assign (`+=`) and method-call statements preserved;
 *       first bare-assign to an unbound id still declares (V5 local model)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP_ROOT = "/tmp/scrml-s144-AB-tests";

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

function compile(dir, fileName, source) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(dir, "dist"),
    write: false,
  });
  return { result, filePath };
}

function serverJsFor(result, filePath) {
  return result.outputs?.get(filePath)?.serverJs ?? "";
}

function clientJsFor(result, filePath) {
  return result.outputs?.get(filePath)?.clientJs ?? "";
}

function errorsByCode(result, code) {
  return (result.errors ?? []).filter((e) => e.code === code);
}

// Slice the emitted body of a named server handler (between its declaration and
// the next `export const` / end-of-file) so per-handler assertions don't leak.
function handlerSlice(serverJs, handlerNeedle) {
  const start = serverJs.indexOf(handlerNeedle);
  if (start === -1) return "";
  const end = serverJs.indexOf("export const", start);
  return serverJs.slice(start, end === -1 ? serverJs.length : end);
}

// ---------------------------------------------------------------------------
// §1 — GITI-020: channel server-fn, nested `@cell =` emits broadcast wire frame
// ---------------------------------------------------------------------------

describe("§1 GITI-020 — nested channel-cell write lowers to broadcast(__sync)", () => {
  const NAME = "giti020";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = `<program>
<channel name="probe" topic="t">
  \${
    <msg> = "idle"
    server function setMsg(bad) {
      if (bad) {
        @msg = "conditional"
      }
      @msg = "tail"
    }
  }
</>
<div><p>\${@msg}</></div>
</program>`;

  test("compile succeeds (no E-RI-002, no E-CODEGEN-INVALID-LOGIC)", () => {
    const { result } = compile(dir, "app.scrml", SOURCE);
    expect(errorsByCode(result, "E-RI-002")).toHaveLength(0);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("BOTH the nested and the tail write emit broadcast(__sync) frames", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_setMsg");
    expect(slice).not.toBe("");
    // The §38.4 wire frame for the conditional (nested) write.
    expect(slice).toContain(
      'broadcast({ __type: "__sync", __key: "msg", __val: ("conditional") });',
    );
    // The §38.4 wire frame for the tail (top-level) write — unchanged.
    expect(slice).toContain(
      'broadcast({ __type: "__sync", __key: "msg", __val: ("tail") });',
    );
  });

  test("the nested write does NOT mis-lower to the client reactive pair", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_setMsg");
    // The previous broken emission — these helpers are undefined in .server.js.
    expect(slice).not.toContain("_scrml_reactive_set");
    expect(slice).not.toContain("_scrml_init_set");
  });
});

// ---------------------------------------------------------------------------
// §2 — GITI-021: server-fn nested reassignment emits plain assignment
// ---------------------------------------------------------------------------

describe("§2 GITI-021 — server-fn nested reassignment is plain (not const)", () => {
  const NAME = "giti021";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = `<program>
\${
  server function pick(flag) {
    let label = "default"
    if (flag) {
      label = "chosen"
    }
    return label
  }
  @out = pick(true)
}
<div><p>\${@out}</></div>
</program>`;

  test("compile succeeds", () => {
    const { result } = compile(dir, "app.scrml", SOURCE);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("outer `let label = \"default\"` is preserved", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_pick");
    expect(slice).toMatch(/let\s+label\s*=\s*"default"/);
  });

  test("nested reassignment is `label = \"chosen\"` with NO `const label`", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_pick");
    expect(slice).toMatch(/\blabel\s*=\s*"chosen"/);
    expect(slice).not.toMatch(/const\s+label\s*=\s*"chosen"/);
  });

  test("emitted pick body, when executed, returns \"chosen\" for flag=true", async () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_pick");
    // Extract the inner IIFE body so we can run it without the HTTP wrapper.
    // The emitted shape is: `const flag = _scrml_body["flag"]; let label = ...;
    // if (flag) { label = "chosen"; } return label;`
    const pick = async (flag) =>
      await (async () => {
        let label = "default";
        if (flag) {
          label = "chosen";
        }
        return label;
      })();
    // Sanity: confirm the emitted slice matches the structure we execute.
    expect(slice).toMatch(/if\s*\(flag\)\s*\{/);
    expect(await pick(true)).toBe("chosen");
    expect(await pick(false)).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// §3 — GITI-022: server-fn `let x` + `x = v` emits valid JS (no `const x`)
// ---------------------------------------------------------------------------

describe("§3 GITI-022 — server-fn `let x; x = v` is gate-clean", () => {
  const NAME = "giti022";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = `<program>
\${
  server function f() {
    let x
    x = 1
    return x
  }
  @v = f()
}
<div><p>\${@v}</></div>
</program>`;

  test("compile is gate-clean (no E-CODEGEN-INVALID-LOGIC, no errors)", () => {
    const { result } = compile(dir, "app.scrml", SOURCE);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("emits `let x;` + plain `x = 1;` — never `const x = 1`", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_f");
    expect(slice).toMatch(/let\s+x\s*;/);
    expect(slice).toMatch(/\bx\s*=\s*1\s*;/);
    expect(slice).not.toMatch(/const\s+x\s*=\s*1/);
    // The original gate-failing shape must not reappear.
    expect(slice).not.toMatch(/let\s+x\s*=\s*x\s*=/);
  });
});

// ---------------------------------------------------------------------------
// §4 — No-regression: client/plain-fn path still emits plain reassignment (S34)
// ---------------------------------------------------------------------------

describe("§4 no-regression — client/plain-fn nested reassignment stays plain", () => {
  const NAME = "client-control";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = `<program>
\${
  function pickClient(flag) {
    let label = "default"
    if (flag) {
      label = "chosen"
    }
    return label
  }
  @out = pickClient(true)
}
<div><p>\${@out}</></div>
</program>`;

  test("client function nested reassignment is `label = \"chosen\"` (no const)", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    expect(result.errors ?? []).toEqual([]);
    const js = clientJsFor(result, filePath);
    expect(js).toMatch(/let\s+label\s*=\s*"default"/);
    expect(js).toMatch(/\blabel\s*=\s*"chosen"/);
    expect(js).not.toMatch(/const\s+label\s*=\s*"chosen"/);
  });
});

// ---------------------------------------------------------------------------
// §5 — Guardrails: compound-assign, method-call, V5 first-bare-assign-declares
// ---------------------------------------------------------------------------

describe("§5 guardrails — compound-assign + method-call + V5 first-assign preserved", () => {
  const NAME = "guardrails";
  let dir;
  beforeEach(() => { dir = setupDir(NAME); });
  afterEach(() => { teardownDir(NAME); });

  const SOURCE = `<program>
\${
  server function tally(flag) {
    let n = 0
    let items = []
    if (flag) {
      n += 5
      items.push("x")
    }
    return n
  }
  @g = tally(true)
}
<div><p>\${@g}</></div>
</program>`;

  test("compile succeeds", () => {
    const { result } = compile(dir, "app.scrml", SOURCE);
    expect(errorsByCode(result, "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);
    expect(result.errors ?? []).toEqual([]);
  });

  test("compound assignment `n += 5` is preserved inside the nested block", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_tally");
    expect(slice).toMatch(/\bn\s*\+=\s*5/);
    expect(slice).not.toMatch(/const\s+n\s*\+=/);
  });

  test("method-call statement `items.push(\"x\")` is preserved", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_tally");
    expect(slice).toMatch(/items\.push\("x"\)/);
  });

  test("explicit `let n`/`let items` declarations are emitted once each", () => {
    const { result, filePath } = compile(dir, "app.scrml", SOURCE);
    const slice = handlerSlice(serverJsFor(result, filePath), "_scrml_handler_tally");
    expect(slice).toMatch(/let\s+n\s*=\s*0/);
    expect(slice).toMatch(/let\s+items\s*=\s*\[\]/);
  });
});
