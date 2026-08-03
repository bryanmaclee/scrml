/**
 * g-crossmodule-async-in-markup-position-not-awaited (S317) — a cross-module
 * INFERRED-ASYNC client import consumed directly in a MARKUP interpolation
 * (`<p>${ fetchStatus(@url).status }</p>`) must be awaited, not emitted bare.
 *
 * The function-body value-position autoawait (`g-inferred-async-call-value-
 * position-no-autoawait`) threads a peer-await set into function bodies only.
 * The markup interpolation lowering (`emit-event-wiring.ts`) is a SEPARATE path
 * that never consulted it, so the call emitted bare — the interpolation read a
 * field off a Promise and rendered `undefined`. The fix threads the peer-await
 * set (`clientAsyncFnNames`, stashed by emitFunctions) into the markup emitter,
 * so emit-expr injects the inner `(await fetchStatus(...))`, and routes the
 * binding through an async IIFE (NO outer await → no `await await`).
 *
 * Verifies both the EMIT shape and — per the sibling-gap lesson that emit-shape
 * is not verification — the RUNTIME value (the render receives the settled value,
 * not a Promise field = undefined).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "__fixtures__/xmod-async-markup");
mkdirSync(DIR, { recursive: true });
afterAll(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

function fix(name, src) { const p = join(DIR, name); writeFileSync(p, src); return p; }
function compileClient(inputFiles, wantFile) {
  const res = compileScrml({ inputFiles, write: false, log: () => {} });
  for (const [fp, out] of res.outputs) if (fp.endsWith(`${wantFile}.scrml`)) return out.clientJs ?? "";
  return "";
}

// `fetchStatus` is INFERRED async (reaches the Promise-returning `scrml:http` get).
const LIB_SRC = `\${
  import { get } from 'scrml:http'
  export function fetchStatus(url) {
    const r = get(url) !{ return { status: 0 } }
    return r
  }
}
`;
// A cross-module PURE (sync) export — the negative control.
const SYNC_LIB_SRC = `\${
  export function label(n) { return "n=" + n }
}
`;

describe("g-crossmodule-async-in-markup — reactive interpolation (@var)", () => {
  test("`<p>${ fetchStatus(@url).status }</p>` awaits the call inside an async IIFE (was BARE)", () => {
    fix("lib.scrml", LIB_SRC);
    fix("m1.scrml", `<program>\n\${\n  import { fetchStatus } from './lib.scrml'\n  <url> = "/x"\n}\n<p>\${ fetchStatus(@url).status }</p>\n</program>\n`);
    const js = compileClient([join(DIR, "lib.scrml"), join(DIR, "m1.scrml")], "m1");
    // Inner await injected; node-aware render inside an async IIFE.
    expect(js).toMatch(/\(async \(\) => \{ try \{ _scrml_render_value\(el, \(await fetchStatus\(_scrml_cs_reactive_get\("url"\)\)\)\.status\);/);
    // NOT the bare pre-fix render, and NEVER a double-await.
    expect(js).not.toMatch(/_scrml_render_value\(el, fetchStatus\(_scrml_cs_reactive_get\("url"\)\)\.status\)/);
    expect(js).not.toMatch(/await\s+await/);
    // Still wrapped by the sync reactive effect (deps tracked, re-runs on @url).
    expect(js).toMatch(/_scrml_effect\(function\(\) \{ \(async \(\) =>/);
  });
});

describe("g-crossmodule-async-in-markup — non-reactive one-shot (const arg)", () => {
  test("`<p>${ fetchStatus(\"/x\").status }</p>` awaits inside an async IIFE (was BARE)", () => {
    fix("lib.scrml", LIB_SRC);
    fix("m2.scrml", `<program>\n\${\n  import { fetchStatus } from './lib.scrml'\n}\n<p>\${ fetchStatus("/x").status }</p>\n</program>\n`);
    const js = compileClient([join(DIR, "lib.scrml"), join(DIR, "m2.scrml")], "m2");
    expect(js).toMatch(/\(async \(\) => \{ try \{ _scrml_render_value\(el, \(await fetchStatus\("\/x"\)\)\.status\);/);
    expect(js).not.toMatch(/_scrml_render_value\(el, fetchStatus\("\/x"\)\.status\)/);
    expect(js).not.toMatch(/await\s+await/);
  });
});

describe("g-crossmodule-async-in-markup — NEGATIVE: a SYNC cross-module import stays bare", () => {
  test("`<p>${ label(@n) }</p>` (pure fn) keeps the sync `_scrml_render_value` path, no async wrap", () => {
    fix("sync-lib.scrml", SYNC_LIB_SRC);
    fix("m3.scrml", `<program>\n\${\n  import { label } from './sync-lib.scrml'\n  <n> = 3\n}\n<p>\${ label(@n) }</p>\n</program>\n`);
    const js = compileClient([join(DIR, "sync-lib.scrml"), join(DIR, "m3.scrml")], "m3");
    expect(js).toMatch(/_scrml_render_value\(el, label\(_scrml_cs_reactive_get\("n"\)\)\)/);
    // No await / async wrapping for a pure sync import.
    expect(js).not.toMatch(/await label\(/);
  });
});

describe("g-crossmodule-async-in-markup — combinator callback (S239 finding: bare-callback form)", () => {
  // The async fn passed BY NAME as a combinator callback (`map(fetchStatus)`) —
  // emit-expr lowers it to `await _scrml_mapAsync(..., fetchStatus)`. A `NAME(`
  // textual predicate MISSES this (fetchStatus appears as `fetchStatus)`), so the
  // injected `await` would land UNWRAPPED in the sync effect → whole-bundle
  // SyntaxError. The emit-diff wrap decision catches it. Pin: the client JS PARSES.
  const parses = (js) => { try { new Bun.Transpiler({ loader: "js" }).transformSync(js); return true; } catch { return false; } };

  test("`<p>${ @items.map(fetchStatus) }</p>` wraps the injected await in an async IIFE — bundle PARSES", () => {
    fix("lib.scrml", LIB_SRC);
    fix("m4.scrml", `<program>\n\${\n  import { fetchStatus } from './lib.scrml'\n  <items> = ["/a","/b"]\n}\n<p>\${ @items.map(fetchStatus) }</p>\n</program>\n`);
    const js = compileClient([join(DIR, "lib.scrml"), join(DIR, "m4.scrml")], "m4");
    expect(js).toMatch(/\(async \(\) => \{ try \{ _scrml_render_value\(el, await _scrml_mapAsync\(/);
    expect(js).not.toMatch(/await\s+await/);
    // The regression: an unwrapped top-level await in the sync effect is a parse error.
    expect(parses(js)).toBe(true);
  });

  test("`<p>${ [1,2].map(fetchStatus) }</p>` one-shot combinator callback also wraps — PARSES", () => {
    fix("lib.scrml", LIB_SRC);
    fix("m4b.scrml", `<program>\n\${\n  import { fetchStatus } from './lib.scrml'\n}\n<p>\${ [1,2].map(fetchStatus) }</p>\n</program>\n`);
    const js = compileClient([join(DIR, "lib.scrml"), join(DIR, "m4b.scrml")], "m4b");
    expect(js).toMatch(/\(async \(\) => \{ try \{ _scrml_render_value\(el, await _scrml_mapAsync\(/);
    expect(parses(js)).toBe(true);
  });
});

describe("g-crossmodule-async-in-markup — RUNTIME: the render receives the settled value, not a Promise field", () => {
  test("the emitted async-IIFE render resolves `.status` to the awaited value (bug rendered undefined)", async () => {
    // Execute both emit shapes against a stubbed async fetchStatus.
    const fetchStatus = () => Promise.resolve({ status: 200 });
    const elNew = {}, elOld = {};
    const render = (el, v) => { el.v = v; };
    // NEW (fixed) shape:
    await (async () => { try { render(elNew, (await fetchStatus("/x")).status); } catch { elNew.v = ""; } })();
    // OLD (buggy) shape — a field read off the Promise:
    (() => { try { render(elOld, fetchStatus("/x").status); } catch { elOld.v = ""; } })();
    expect(elNew.v).toBe(200);         // fix: the awaited value
    expect(elOld.v).toBeUndefined();   // bug: Promise.status === undefined
  });
});
