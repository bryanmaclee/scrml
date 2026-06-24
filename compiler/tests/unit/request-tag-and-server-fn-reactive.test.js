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
 *    runtime noise. The tag was being used as a wrapper around a body
 *    that already did its own fetch (`\${ @data = loadValue() }`); the
 *    tag's own machinery was redundant.
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
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/request-tag");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

let gitiFx, urlFx, plainFx, exprCtxFx;

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

  test("reactive-set of a server-fn call is wrapped in async IIFE with await", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // The new wrapped form
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\)\s*\)\)\(\s*\);/);
    // Must NOT be the unawaited form
    expect(js).not.toMatch(/_scrml_reactive_set\("data",\s*_scrml_fetch_loadValue_\d+\(\s*\)\s*\);/);
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

describe("§3: `<request id=\"req1\">` without url= emits no fetch", () => {
  test("no empty-URL fetch call is emitted", () => {
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // The buggy pattern was `fetch("", { method: "GET" })`. Must not appear.
    expect(js).not.toMatch(/fetch\(""\s*,\s*\{\s*method:\s*"GET"\s*\}/);
    // The full request-state vars must also be absent
    expect(js).not.toContain("_scrml_request_req1_fetch");
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
    // wrap at module init (well-formed, ends with `();`).
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\s*\)\s*\)\)\(\s*\);/);
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

  test("statement-context wrap (top-level or in fn body) still ends with `();`", () => {
    // The original §1 fixture has `@data = loadValue()` inside a `<request>`
    // body, which compiles to a statement-context wrap. Verify that path
    // still emits the trailing `;` — must not regress.
    const result = compile(gitiFx);
    const js = result.outputs.get(gitiFx).clientJs;
    // Match the statement-form: `(async () => _scrml_reactive_set("data", await _scrml_fetch_loadValue_N()))();`
    expect(js).toMatch(/\(async\s*\(\s*\)\s*=>\s*_scrml_reactive_set\("data",\s*await\s+_scrml_fetch_loadValue_\d+\(\s*\)\s*\)\)\(\s*\);/);
  });
});
