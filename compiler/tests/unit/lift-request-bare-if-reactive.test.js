/**
 * lift-request-bare-if-reactive.test.js — ss21 item 1
 * (g-request-lift-bare-if-condition), 2026-06-25.
 *
 * THE BUG: a `${ if (<#id>.loading) { lift <markup> } }` bare-if whose CONDITION
 * reads a `<request>` `<#id>` ref lowers (Seam 2) to a deep-reactive
 * `_scrml_request_<id>.loading` read — but emit-reactive-wiring's reactive-dep
 * detector only recognised `_scrml_reactive_get(...)`, NOT a `_scrml_request_<id>`
 * member read. So `groupHasReactiveDeps` was false, the lift group fell into the
 * NON-reactive emission branch (a bare file-scope `if (...) { _scrml_lift(...) }`),
 * the `if` ran ONCE at module-init, and the gated content never appeared /
 * disappeared when the fetch resolved (loading -> data). Frozen.
 *
 * THE FIX (emit-reactive-wiring.ts, the per-group loop): treat a whole-token
 * `_scrml_request_<id>` read (id in the file's request-id set) as a reactive dep
 * so the group is `_scrml_effect`-wrapped. The wrap re-runs the if on resolve
 * (the deep-reactive member read auto-subscribes the effect) and the branch-
 * identity guard toggles the gated content.
 *
 * VALUE-ASSERTING happy-dom runtime sim (mirrors 14-mario-runtime-sim): compile
 * -> mount HTML -> eval runtime+client -> assert the gated DOM toggles on a
 * loading->data mutation. `fetch` is stubbed to a never-resolving promise so the
 * request stays loading until the test drives `_scrml_request_foo` directly (the
 * brief's mutate-loading approach), keeping the assertions deterministic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-lift-request-bare-if-reactive");

beforeEach(async () => {
  // Idempotent: a sibling test file in the same bun process may have left a
  // registration active. Unregister-then-register gives this test a fresh DOM.
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});

afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

// Compile `src`, mount the HTML, then evaluate runtime+client in an isolated
// function scope (each call re-evals a fresh runtime instance, so there is no
// cross-test runtime-singleton bleed). Returns the live `_scrml_request_foo`
// deep-reactive object so the test can drive loading->data.
function compileAndMount(src, baseName) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
    const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    document.documentElement.innerHTML = html;
    // Never-resolving fetch: the request stays `loading: true` until the test
    // mutates `_scrml_request_foo` directly. Deterministic, no network.
    const fetchStub = () => new Promise(() => {});
    const exec = new Function(
      "window", "document", "fetch",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_req__ = _scrml_request_foo;\n`),
    );
    exec(window, document, fetchStub);
    return { errors: result.errors ?? [], req: globalThis.__scrml_req__ };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const tick = () => new Promise((res) => setTimeout(res, 0));

// ---------------------------------------------------------------------------
// §1: bare-if loading-gate is reactive (the core regression)
// ---------------------------------------------------------------------------

describe("ss21 item 1 §1: bare-if loading-gate toggles on fetch resolve", () => {
  const src = [
    "<program>",
    '    ${ if (<#foo>.loading) { lift <span id="m-loading">Loading...</span> } }',
    '    <request id="foo" url="/api/foo">',
    "    </>",
    "</>",
  ].join("\n");

  test("compiles clean", () => {
    const { errors } = compileAndMount(src, "bareif-loading-clean");
    expect(errors).toEqual([]);
  });

  test("gated span present while loading, GONE after loading->false (was frozen pre-fix)", async () => {
    const { req } = compileAndMount(src, "bareif-loading-toggle");
    expect(req).toBeTruthy();
    // while loading: the gated lift is mounted
    expect(document.getElementById("m-loading")).toBeTruthy();
    // resolve the fetch (loading -> data)
    req.loading = false;
    await tick();
    // RED pre-fix: the bare file-scope `if` never re-ran, so the span stayed.
    expect(document.getElementById("m-loading")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2: bare-if/else toggles loading->data AND renders the resolved data VALUE
// ---------------------------------------------------------------------------

describe("ss21 item 1 §2: bare-if/else swaps loading->data branch + renders the value", () => {
  const src = [
    "<program>",
    "    ${ if (<#foo>.loading) {",
    '        lift <span id="m-loading">Loading...</span>',
    "      } else {",
    '        lift <span id="m-data">${<#foo>.data}</span>',
    "      } }",
    '    <request id="foo" url="/api/foo">',
    "    </>",
    "</>",
  ].join("\n");

  test("loading branch initially; data branch + value appear after resolve", async () => {
    const { errors, req } = compileAndMount(src, "bareifelse");
    expect(errors).toEqual([]);
    // initial: loading branch shown, data branch absent
    expect(document.getElementById("m-loading")).toBeTruthy();
    expect(document.getElementById("m-data")).toBeNull();
    // resolve
    req.data = "payload-42";
    req.loading = false;
    await tick();
    // loading branch gone; data branch present and showing the real value
    expect(document.getElementById("m-loading")).toBeNull();
    const dataEl = document.getElementById("m-data");
    expect(dataEl).toBeTruthy();
    expect(dataEl.textContent).toBe("payload-42");
  });
});

// ---------------------------------------------------------------------------
// §3: D1 (g-request-lift-nested-interp-mangle) regression — nested for-lift
//     interpolation of a request `<#id>.data` still renders reactively.
// ---------------------------------------------------------------------------

describe("ss21 item 1 §3: D1 nested-interp for-lift still renders reactively", () => {
  const src = [
    "<program>",
    '    ${ for (x of [1]) { lift <h1 id="d1-h">${<#foo>.data}</h1> } }',
    '    <request id="foo" url="/api/foo">',
    "    </>",
    "</>",
  ].join("\n");

  test("h1 empty while loading, shows data value after resolve", async () => {
    const { errors, req } = compileAndMount(src, "d1-nested");
    expect(errors).toEqual([]);
    const h0 = document.getElementById("d1-h");
    expect(h0).toBeTruthy();
    expect(h0.textContent).toBe("");
    req.data = "FRESH-DATA";
    await tick();
    expect(document.getElementById("d1-h").textContent).toBe("FRESH-DATA");
  });
});
