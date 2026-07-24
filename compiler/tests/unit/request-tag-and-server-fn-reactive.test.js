/**
 * request-tag-and-server-fn-reactive.test.js — `<request>` + `@var = serverFn()`
 *
 * Regression: giti inbound 2026-04-20 GITI-001.
 *
 * Two coupled issues in giti's repro:
 *
 * 1. `@data = loadValue()` (loadValue is a `server function`) emitted
 *    `_scrml_reactive_set("data", _scrml_fetch_loadValue_N())` — storing
 *    the UNAWAITED Promise. Readers of `@data` saw `[object Promise]` or
 *    undefined on the `.value` access.
 *
 * 2. `<request id="req1">` without a `url=` attribute emitted a full
 *    fetch machinery whose `fetch(urlExpr, ...)` call had urlExpr=`""`.
 *    The empty-URL fetch ran on mount, silently failed, and added
 *    runtime noise. GITI-001 fixed the empty-URL fetch by emitting NO
 *    request machinery at all for the body form — but that ALSO dropped
 *    the §6.7.7 loading/data/error/stale SETTLE machine, so
 *    `_scrml_request_<id>` was declared and never mutated (Peter #20).
 *
 * Peter #20 (§6.7.7) CORRECTION: the body form's fetch IS the body's
 * server-fn stub, and the settle machine drives `_scrml_request_<id>`
 * around it (loading→false on settle; .data + cell on 2xx; .error on a
 * thrown/non-2xx, leaving the success cell untouched). The GENERAL
 * (non-`<request>`) reactive-server assignment keeps the plain auto-await
 * IIFE (§1/§6/§7/§8, now via the `plainTopFx` non-request fixture). The
 * §6.7.7 machine is asserted in §3.
 *
 * Fixes (emit-client.ts + emit-reactive-wiring.ts):
 *   - Post-emit rewrite: `_scrml_reactive_set("X", _scrml_fetch_Y_N(...))`
 *     is wrapped in `(async () => _scrml_reactive_set("X", await
 *     _scrml_fetch_Y_N(...)))();` when Y is a server fn (fetch stub or
 *     CPS wrapper per fnNameMap).
 *   - emitRequestNode skips the whole fetch machinery emission when no
 *     `url=` attribute is present.
 *
 * Coverage:
 *   §1  `@data = serverFn()` wrapped in async IIFE with await
 *   §2  emitted JS parses (no SyntaxError)
 *   §3  `<request>` without url= emits no fetch machinery
 *   §4  `<request url="...">` still emits the machinery (regression guard)
 *   §5  Non-server-fn assignment stays synchronous (regression guard)
 *   §6  GITI-001 in EXPRESSION CONTEXT (S84 fix-lift-async-iife-paren) —
 *       the same wrap, when nested inside `el.textContent = await (...)`,
 *       must NOT append a trailing `;` (would produce malformed `await ((...)();)`)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { RUNTIME_CHUNKS, assembleRuntime } from "../../src/codegen/runtime-chunks.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/request-tag");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let gitiFx, urlFx, plainFx, exprCtxFx, errArmHandlerFx, plainTopFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  gitiFx = fix("giti-001.scrml", `<program>

\${
  server function loadValue() {
    lift { value: 42 }
  }
}

<div>
  <request id="req1">
    \${ @data = loadValue() }
  </>
  <p>\${@data}</p>
</div>

</program>
`);

  urlFx = fix("request-with-url.scrml", `<program>

\${
  @items = []
}

<request id="list" url="/api/items">
  \${ @items = [] }
</>
<p>\${@items.length}</p>

</program>
`);

  plainFx = fix("plain-set.scrml", `<program>

\${
  @count = 0
  function bump() { @count = @count + 1 }
}

<button onclick=bump()>inc</button>
<p>\${@count}</p>

</program>
`);

  // §6 fixture: `server <var>` + `on mount { @var = serverFn() }` + `${@var}` render.
  //
  // This is the 18-state-authority emit path: an `on mount { @data = loadValue() }`
  // inside the `<program db=>` body (which parses to a `<db>` state-block whose
  // enclosing markup tag is "state").
  //
  // HISTORY: pre-S217 the `on mount` block was MIS-CLASSIFIED as a reactive
  // DISPLAY wiring whose expression was `@var = serverFn()` — it allocated a
  // render slot and emitted `el.textContent = await ((async () => ...)())`. That
  // was the g-onmount-async bug (a desugared `on mount {}` is a fire-and-forget
  // mount effect per SPEC §6.7.1a, it NEVER renders its return). The S84 GITI-001
  // `;`-context fix that this describe-block originally guarded was a downstream
  // well-formedness patch ON TOP of that bug shape.
  //
  // AFTER S217 (g-onmount-async): the on-mount is correctly a file-scope mount
  // effect — `(async () => _scrml_reactive_set("data", await _scrml_fetch_loadValue_N()))();`
  // at module init (the GITI-001 statement-context wrap), with NO render slot and
  // NO `el.textContent`/`_scrml_render_value` of the on-mount call. The `${@data}`
  // inside `<div><p>` is the ONLY genuine display binding (it reads the cell the
  // mount effect populated). This describe-block now asserts that CORRECT shape;
  // the GITI-001 well-formedness invariant (no `;)`) is preserved by the
  // statement-context wrap.
  exprCtxFx = fix("expr-ctx.scrml", `<program db="./fixture.db">

\${
  server function loadValue() {
    lift 42
  }
  <data server> = 0
  on mount {
    @data = loadValue()
  }
}

<div>
  <p>\${@data}</p>
</div>

</program>
`);

  // ss32-item-1 fixture: a `!{}`-carrying reactive server assignment.
  // `@data = serverFn() !{ ... }` emits the auto-await IIFE PLUS a sibling
  // `let _scrml__scrml_result_N = ...; if (_scrml__scrml_result_N.__scrml_error) {...}`
  // dispatch. The IIFE must still carry the ss32-item-1 `.catch` error arm
  // (the safety net) regardless of the (separately-broken) `!{}` dispatch.
  errArmHandlerFx = fix("err-arm-handler.scrml", `<program>

\${
  server function loadData() {
    lift { value: 42 }
  }
}

\${
  @data = loadData() !{
    | ::NetworkError e -> { @data = { value: 0 } }
  }
}

<div>
  <p>\${@data}</p>
</div>

</program>
`);

  // Peter #20 (§6.7.7): the GENERAL auto-await IIFE for a reactive-server
  // assignment that is NOT a `<request>` body. A top-level `\${ @data =
  // loadValue() }` outside any `<request>` keeps the plain single-line IIFE +
  // ss32 `.catch` uncaught-surface arm — the mechanism the §1/§6/§7/§8 blocks
  // guard. (The `<request>` body form, gitiFx, now emits the §6.7.7 SETTLE
  // MACHINE instead — see §3 + the dedicated §9 block below.)
  plainTopFx = fix("plain-top-assign.scrml", `<program>

\${
  server function loadValue() {
    lift { value: 42 }
  }
}

\${ @data = loadValue() }

<div>
  <p>\${@data}</p>
</div>

</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

// ---------------------------------------------------------------------------
// §1: `@data = serverFn()` is awaited
// ---------------------------------------------------------------------------

describe("§1: GITI-001 — `@data = serverFn()` awaited before reactive set", () => {
  test("compile succeeds", () => {
    const result = compile(gitiFx);
    expect(result.errors).toEqual([]);
  });

  test("reactive-set of a server-fn call is wrapped in async IIFE with await + error arm", () => {
    // The GENERAL (non-`<request>`) reactive-server assignment keeps the plain
    // auto-await IIFE. (The `<request>` body form now routes to the §6.7.7 settle
    // machine — asserted in §3 + §9.)
    const result = compile(plainTopFx);
    const js = result.outputs.get(plainTopFx).clientJs;
    // The wrapped form — now carries the ss32-item-1 `.catch` error arm so a
    // rejected fetch/CPS stub surfaces via the scrml uncaught surface instead of
    // a browser-level unhandledrejection (catch-less silent drop).
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\)\s*\)\)\(\s*\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)\s*;/);
    // Must NOT be the unawaited form
    expect(js).not.toMatch(/_scrml_reactive_set\("data",\s*_scrml_fetch_loadValue_\d+\(\s*\)\s*\);/);
    // Must NOT be the catch-less floating IIFE (the pre-ss32 bug shape).
    expect(js).not.toMatch(/\)\)\(\s*\);/);
  });
});

// ---------------------------------------------------------------------------
// §2: emitted JS parses
// ---------------------------------------------------------------------------

describe("§2: emitted JS parses as a module", () => {
  test("GITI-001 output parses (new Function)", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §3: `<request>` without url= emits no fetch machinery
// ---------------------------------------------------------------------------

describe("§3: `<request id=\"req1\">` without url= drives the §6.7.7 settle machine", () => {
  test("no empty-URL raw fetch is emitted (the fetch IS the body's server-fn stub)", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // The old GITI-001 bug pattern was a raw `fetch("", { method: "GET" })`. The
    // body form never emits its own raw fetch — its fetch is the body's server-fn
    // stub (`_scrml_fetch_loadValue_N`), driven by the settle machine.
    expect(js).not.toMatch(/fetch\(""\s*,\s*\{\s*method:\s*"GET"\s*\}/);
  });

  test("Peter #20 — the settle machine IS emitted (state object is now mutated)", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // GITI-001 wrongly deemed the request machinery "redundant" and emitted NONE —
    // so `_scrml_request_req1` was declared but never mutated (Peter #20). The
    // settle machine now wires the WRITES.
    expect(js).toContain("async function _scrml_request_req1_fetch()");
    expect(js).toContain("_scrml_request_req1.loading = true;");
    expect(js).toContain("_scrml_request_req1.loading = false;");
    expect(js).toContain("_scrml_request_req1.error = null;");
    expect(js).toContain("_scrml_request_req1.data = _scrml_data;");
    expect(js).toContain("_scrml_request_req1.error = _scrml_e;");
    expect(js).toContain("_scrml_request_req1.refetch = _scrml_request_req1_fetch;");
    // The success cell is populated ONLY on the happy path, BEFORE `.data` (so a
    // `<#R>.data`-gated render reading the cell sees it populated — no window).
    expect(js).toMatch(/_scrml_reactive_set\("data", _scrml_data\);\s*\n\s*_scrml_request_req1\.data = _scrml_data;/);
  });
});

// ---------------------------------------------------------------------------
// §4: `<request url="...">` still emits fetch machinery
// ---------------------------------------------------------------------------

describe("§4: `<request url=\"/api/items\">` still emits the machinery", () => {
  test("regression: tag with url= produces fetch function referencing the URL", () => {
    const result = compile(urlFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(urlFx).clientJs;
    expect(js).toContain("_scrml_request_list_fetch");
    expect(js).toContain('"/api/items"');
  });
});

// ---------------------------------------------------------------------------
// §5: Non-server-fn reactive-set stays synchronous
// ---------------------------------------------------------------------------

describe("§5: `@count = @count + 1` stays synchronous (regression guard)", () => {
  test("plain reactive mutation does NOT get the async IIFE wrapper", () => {
    const result = compile(plainFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(plainFx).clientJs;
    // The count mutation must appear as a plain reactive-set
    expect(js).toContain('_scrml_reactive_set("count"');
    // And NOT inside an async IIFE
    expect(js).not.toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("count"/);
  });
});

// ---------------------------------------------------------------------------
// §6: GITI-001 in EXPRESSION CONTEXT — S84 fix-lift-async-iife-paren
// ---------------------------------------------------------------------------
//
// When `@var = serverFn()` appears as a MARKUP EXPRESSION (e.g. `<p>${@x = load()}</p>`),
// the rewrite-reactive-display-wiring path emits `el.textContent = await (${rewrittenExpr})`.
// The rewrittenExpr is the expression form `_scrml_reactive_set("x", _scrml_fetch_load_N())`
// (NO trailing `;`). GITI-001 then wraps it in `(async () => _scrml_reactive_set(..., await ...))()`.
//
// BEFORE FIX: GITI-001 always appended a trailing `;` regardless of context,
// producing malformed `await ((async () => ...)();)` (`;)` is invalid JS).
//
// AFTER FIX: GITI-001 detects whether the source had a trailing `;` (statement
// context) and only appends `;` if so. Expression context → no semicolon →
// well-formed `await ((async () => ...)())`.

describe("§6: GITI-001 wrap is context-aware (S84 fix-lift-async-iife-paren)", () => {
  test("compile succeeds", () => {
    const result = compile(exprCtxFx);
    expect(result.errors).toEqual([]);
  });

  test("client.js parses as valid JS (no `;)` from extra semicolon)", () => {
    const result = compile(exprCtxFx);
    const js = result.outputs.get(exprCtxFx).clientJs;
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });

  test("no malformed `(async () => ...)();)` token sequence in output", () => {
    const result = compile(exprCtxFx);
    const js = result.outputs.get(exprCtxFx).clientJs;
    // The bug signature: `;)` immediately after an IIFE invocation.
    expect(js).not.toMatch(/\)\(\);\s*\)/);
  });

  test("the on-mount runs as a file-scope mount effect, NOT a display slot (g-onmount-async S217)", () => {
    const result = compile(exprCtxFx);
    const js = result.outputs.get(exprCtxFx).clientJs;
    // CORRECT: the on-mount `@data = loadValue()` is the GITI-001 STATEMENT-context
    // wrap at module init (well-formed, ends with `().catch(...);` — ss32-item-1
    // error arm).
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\s*\)\s*\)\)\(\s*\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)\s*;/);
    // The on-mount's call must NOT be rendered into the DOM (the former bug shape).
    expect(js).not.toMatch(/el\.textContent\s*=\s*await\s*\(\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data"/);
    expect(js).not.toMatch(/_scrml_render_value\(el, _scrml_fetch_loadValue_\d+\(\)\)/);
  });

  test("the `${@data}` display binding (the cell read, not the on-mount) still renders", () => {
    const result = compile(exprCtxFx);
    const js = result.outputs.get(exprCtxFx).clientJs;
    // The genuine markup interpolation inside <div><p> reads the cell the mount
    // effect populated — this is the ONLY display binding in the fixture.
    expect(js).toMatch(/_scrml_render_value\(el, _scrml_reactive_get\("data"\)\)/);
  });

  test("statement-context wrap (top-level or in fn body) still ends with `().catch(...);`", () => {
    // A top-level `@data = loadValue()` (NON-`<request>`) compiles to a
    // statement-context wrap. Verify that path still emits the trailing `;`
    // (now after the ss32-item-1 `.catch` error arm) — must not regress. (The
    // `<request>` body form now routes to the §6.7.7 settle machine, §3/§9.)
    const result = compile(plainTopFx);
    const js = result.outputs.get(plainTopFx).clientJs;
    // Match the statement-form: `(async () => _scrml_reactive_set("data", await _scrml_fetch_loadValue_N()))().catch(_scrml_async_err => _scrml_error_boundary_log("data", _scrml_async_err));`
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\s*\)\s*\)\)\(\s*\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)\s*;/);
  });
});

// ---------------------------------------------------------------------------
// §7: ss32-item-1 — the auto-await IIFE carries a `.catch` error arm
//
// The per-statement auto-await IIFE that wraps a reactive-server assignment
// (`@cell = serverFn()`) used to be CATCH-LESS — a rejected fetch/CPS stub (the
// plain `_scrml_fetch_*` stub has no try/catch; a network failure or a
// malformed-JSON `.json()` rejects its promise) escaped to a browser-level
// `unhandledrejection` (a silent drop with NO scrml error surface). The fix
// attaches a `.catch` that routes the rejection through the scrml-level uncaught
// surface (`_scrml_error_boundary_log`, the always-included 'errors' chunk
// reporter that the errorBoundary catch also uses). The `.catch` sits on the
// IIFE CALL so it is valid in BOTH statement and expression position (preserving
// the S84 `;)`-hazard fix).
// ---------------------------------------------------------------------------

describe("§7: ss32-item-1 — auto-await IIFE error arm", () => {
  test("no-`!{}` reactive server assignment: IIFE carries `.catch` -> uncaught surface", () => {
    // General (non-`<request>`) reactive-server assignment — the plain IIFE path.
    const result = compile(plainTopFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(plainTopFx).clientJs;
    // The error arm routes through the typed uncaught surface, not a silent drop.
    expect(js).toContain(".catch(_scrml_async_err => _scrml_error_boundary_log(");
    // The reference target must be present in the (always-included) runtime.
    // (the function NAME appears in the catch arm; it is provided by the 'errors'
    // chunk which is always assembled.)
    // The catch-less floating IIFE bug shape must be gone.
    expect(js).not.toMatch(/\)\)\(\s*\);/);
  });

  test("`!{}`-carrying reactive server assignment: IIFE STILL carries the `.catch` safety net", () => {
    const result = compile(errArmHandlerFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    // ss41 (g-auto-await-error-arm-dead-promise-check): the `!{}` dispatch is now
    // relocated INSIDE the IIFE (reading the RESOLVED envelope), and the IIFE call
    // STILL carries ss32's `.catch` safety net for a genuine non-envelope rejection.
    expect(js).toMatch(/\}\)\(\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)/);
    // No catch-less floating IIFE.
    expect(js).not.toMatch(/\)\)\(\s*\);/);
  });

  test("output still parses as valid JS (no `;)` from the appended `.catch`)", () => {
    for (const fxp of [gitiFx, errArmHandlerFx, exprCtxFx]) {
      const result = compile(fxp);
      const js = result.outputs.get(fxp).clientJs;
      const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
      expect(() => new Function(stripped)).not.toThrow();
      // The malformed `;)` / `();)` token sequence must never appear.
      expect(js).not.toMatch(/\)\(\);\s*\)/);
    }
  });

  test("`_scrml_error_boundary_log` (the catch target) lives in the always-included 'errors' chunk", () => {
    // The catch arm references _scrml_error_boundary_log. It must be in a chunk
    // that is ALWAYS assembled, else the client reference dangles in a build that
    // has no errorBoundary. 'errors' is pre-populated in usedRuntimeChunks
    // (context.ts / index.ts: new Set(['core','scope','errors','transitions'])).
    expect(RUNTIME_CHUNKS.errors).toContain("function _scrml_error_boundary_log");
    // And the minimal always-on set assembles a runtime that defines it.
    const minimalRuntime = assembleRuntime(new Set(["core", "scope", "errors", "transitions"]));
    expect(minimalRuntime).toContain("function _scrml_error_boundary_log");
  });
});

// ---------------------------------------------------------------------------
// §8: ss41 — g-auto-await-error-arm-dead-promise-check
//
// A reactive-server assignment with an inline `!{}` error arm
// (`@cell = serverFn() !{ ::NetworkError e :> ... }`) USED to emit a DEAD
// dispatch: emit-logic.ts §19.4.3 produced
//     let <resultVar> = _scrml_reactive_set("cell", stub(args)); <init_set>;
//     if (<resultVar> && <resultVar>.__scrml_error) { <arm> }
// and the post-server-fn-iife-wrap stage lifted the `await` into an async IIFE —
// so `<resultVar>` captured the IIFE PROMISE, `.__scrml_error` was always falsy,
// and the user's `!{}` handler NEVER FIRED. The fix relocates the guard + arm
// INSIDE the IIFE (after the await), reading the RESOLVED envelope, with a
// happy-path `else` that performs the reactive set. ss32's `.catch` safety net
// is retained for a genuine non-envelope rejection.
// ---------------------------------------------------------------------------

describe("§8: ss41 — `!{}` error arm reads the resolved envelope (not the IIFE promise)", () => {
  test("the dead top-level `if (result && result.__scrml_error)` guard is GONE", () => {
    const result = compile(errArmHandlerFx);
    expect(result.errors).toEqual([]);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    // The OLD dead shape — `let <resultVar> = (async () => ...)().catch(...)`
    // followed by a top-level `if (<resultVar> && <resultVar>.__scrml_error)` —
    // must NOT appear: the result var no longer captures the IIFE promise.
    expect(js).not.toMatch(/let\s+_scrml__scrml_result_\d+\s*=\s*\(async/);
  });

  test("the await binds a `const <resultVar>` INSIDE the IIFE", () => {
    const result = compile(errArmHandlerFx);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    // `(async () => { const <resultVar> = await _scrml_fetch_loadData_N(); ... `
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*\{\s*const\s+_scrml__scrml_result_\d+\s*=\s*await\s+_scrml_fetch_loadData_\d+\([^)]*\);/);
  });

  test("the `__scrml_error` guard + arm dispatch now reads the resolved const", () => {
    const result = compile(errArmHandlerFx);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    // Capture the in-IIFE const name, then assert the guard reads IT (resolved
    // envelope), not a promise.
    const m = js.match(/const\s+(_scrml__scrml_result_\d+)\s*=\s*await\s+_scrml_fetch_loadData_\d+/);
    expect(m).not.toBeNull();
    const rv = m[1];
    expect(js).toContain(`if (${rv} && ${rv}.__scrml_error) {`);
    expect(js).toContain(`if (${rv}.variant === "NetworkError") {`);
    // The arm body's payload binding reads the resolved envelope.
    expect(js).toContain(`const e = ${rv}.data;`);
  });

  test("a happy-path `else` sets the cell to the resolved value", () => {
    const result = compile(errArmHandlerFx);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    const m = js.match(/const\s+(_scrml__scrml_result_\d+)\s*=\s*await\s+_scrml_fetch_loadData_\d+/);
    const rv = m[1];
    expect(js).toMatch(new RegExp(`\\}\\s*else\\s*\\{\\s*_scrml_reactive_set\\("data",\\s*${rv}\\);`));
  });

  test("the `.catch` safety net + the lazy `_scrml_init_set` both survive", () => {
    const result = compile(errArmHandlerFx);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    expect(js).toMatch(/\}\)\(\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)/);
    // The lazy initializer stays OUTSIDE the IIFE.
    expect(js).toMatch(/_scrml_init_set\("data",\s*\(\)\s*=>\s*_scrml_fetch_loadData_\d+\(\)\)/);
  });

  test("output parses; no `;)` token sequence; no dead-promise guard", () => {
    const result = compile(errArmHandlerFx);
    const js = result.outputs.get(errArmHandlerFx).clientJs;
    const stripped = js.replace(/^\s*import\s[^;]*;/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
    expect(js).not.toMatch(/\)\(\);\s*\)/);
  });

  test("INVARIANCE: the no-`!{}` reactive-server form is byte-unchanged (no `let`/IIFE-block relocation)", () => {
    // General (non-`<request>`) plain form — must not acquire the error-arm block.
    const result = compile(plainTopFx);
    const js = result.outputs.get(plainTopFx).clientJs;
    // The plain `@data = loadValue()` (no `!{}`) keeps the ss32 single-line form:
    // `(async () => _scrml_reactive_set("data", await stub()))().catch(...)`.
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\)\s*\)\)\(\s*\)\.catch\(_scrml_async_err\s*=>\s*_scrml_error_boundary_log\("data",\s*_scrml_async_err\)\)\s*;/);
    // And it must NOT acquire the block-form IIFE (that is error-arm-only).
    expect(js).not.toMatch(/\(async\s*\(\s*\)\s*=>\s*\{\s*const\s+_scrml__scrml_result_\d+/);
  });
});
