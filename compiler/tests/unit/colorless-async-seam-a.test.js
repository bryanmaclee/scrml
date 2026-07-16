/**
 * colorless-async-seam-a.test.js — Seam-A colorless-async unification (GITI-037).
 *
 * The S258-ratified Phase-1 build: async-ness is COMPILER-INFERRED across function
 * boundaries, uncolored in source. A plain `export function` calling a
 * Promise-returning stdlib/host primitive (`safeCallAsync`) — directly, through a
 * local peer, or across a module boundary — is emitted `async` and its call
 * `await`ed. Before this, such a fn compiled clean but silently leaked the Promise
 * (`r.ok === undefined`).
 *
 * The unification closes 3 seed holes on the `computeAsyncFnNames` nucleus:
 *   Gap 1 — the per-fn seed recognizes a stdlib-Promise call (isPromiseReturningStdlibFn).
 *   Gap 2 — the plain/client-fn classification is TRANSITIVE (a fn reaching an async
 *           call only through a local client peer is colored + awaits the peer).
 *   Gap 3 — the cross-module seed includes `scrml:` vendor async primitives + a
 *           cross-lib fn whose async-ness derives from a stdlib-Promise call.
 * And routes async LIBRARY fns through the structured `emitLibraryFnMember` (rather
 * than the whole-block text-splice, which cannot color/await them).
 *
 * SPEC / authority:
 *   docs/deep-dives/interprocedural-cps-colorless-async-2026-07-15.md (S258 ruling)
 *   §13.1 stdlib carve-out · §13.2.1 auto-await classifier · §19.9.8 no async/await
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/colorless-async-seam-a");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => {
  try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {}
});

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

/** Compile one or more fixtures; return { js, errors } where `js` is the emit for
 *  `wantFile` (basename, no ext) in the requested `field` (libraryJs/clientJs/serverJs). */
function compile(inputFiles, { mode, wantFile, field }) {
  const result = compileScrml({ inputFiles, ...(mode ? { mode } : {}), write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${wantFile}.scrml`)) { js = out[field] ?? ""; break; }
  }
  return { js, errors: result.errors || [] };
}

// ---------------------------------------------------------------------------
// §1 — the GITI-037 repro: a direct-`safeCallAsync` library fn (both modes)
// ---------------------------------------------------------------------------

const GITI037_SRC = `\${
  import { safeCallAsync } from "scrml:host"
  export function callHost(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false, error: msg }) }
    return r.ok
  }
}
`;

describe("§1: direct safeCallAsync library fn (GITI-037)", () => {
  test("--mode library emits `export async function callHost` + `await safeCallAsync`", () => {
    const p = fix("giti037-lib.scrml", GITI037_SRC);
    const { js, errors } = compile([p], { mode: "library", wantFile: "giti037-lib", field: "libraryJs" });
    expect(errors.filter(e => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
    expect(js).toMatch(/export async function callHost\s*\(/);
    expect(js).toMatch(/await\s+safeCallAsync\s*\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });

  test("default (auto-detected library) mode emits the same async+await shape", () => {
    const p = fix("giti037-def.scrml", GITI037_SRC);
    const { js } = compile([p], { wantFile: "giti037-def", field: "libraryJs" });
    expect(js).toMatch(/export async function callHost\s*\(/);
    expect(js).toMatch(/await\s+safeCallAsync\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Gap 2: transitive coloring in a LIBRARY (top → middle → leaf → safeCallAsync)
// ---------------------------------------------------------------------------

describe("§2: transitive async coloring in a library (Gap 2)", () => {
  test("leaf/middle/top all `async`; middle awaits leaf, top awaits middle", () => {
    const p = fix("transitive-lib.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function leaf(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false }) }
    return r.ok
  }
  export function middle(obj) { const ok = leaf(obj); return ok }
  export function top(obj) { const ok = middle(obj); return ok }
}
`);
    const { js } = compile([p], { mode: "library", wantFile: "transitive-lib", field: "libraryJs" });
    expect(js).toMatch(/export async function leaf\s*\(/);
    expect(js).toMatch(/export async function middle\s*\(/);
    expect(js).toMatch(/export async function top\s*\(/);
    expect(js).toMatch(/await\s+leaf\s*\(/);
    expect(js).toMatch(/await\s+middle\s*\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §3 — Gap 3: cross-module async propagation (main imports an async .scrml export)
// ---------------------------------------------------------------------------

describe("§3: cross-module async propagation (Gap 3)", () => {
  test("main.orchestrate is colored async + awaits the imported helper.wrapAsync", () => {
    const helper = fix("helper.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function wrapAsync(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false }) }
    return r.ok
  }
}
`);
    const main = fix("cm-main.scrml", `\${
  import { wrapAsync } from "./helper.scrml"
  export function orchestrate(obj) { const ok = wrapAsync(obj); return ok }
}
`);
    const helperOut = compile([helper, main], { mode: "library", wantFile: "helper", field: "libraryJs" });
    const mainOut = compile([helper, main], { mode: "library", wantFile: "cm-main", field: "libraryJs" });
    // helper's own fn is async (Gap 1 in the cross-module fixpoint).
    expect(helperOut.js).toMatch(/export async function wrapAsync\s*\(/);
    // main's fn is colored async + awaits the imported async peer (Gap 3).
    expect(mainOut.js).toMatch(/export async function orchestrate\s*\(/);
    expect(mainOut.js).toMatch(/await\s+wrapAsync\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §4 — Gap 2 on the BROWSER/client path (a <program> client fn graph)
// ---------------------------------------------------------------------------

describe("§4: transitive coloring on the client/browser path (Gap 2)", () => {
  test("client leaf/middle/top all async; middle awaits leaf, top awaits middle", () => {
    const p = fix("browser-transitive.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function leaf(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg, name) -> ({ ok: false }) }
    return r.ok
  }
  function middle(obj) { const ok = leaf(obj); return ok }
  function top(obj) { const ok = middle(obj); return ok }
}
<button onclick=top(window)>Go</button>
</program>
`);
    const { js } = compile([p], { wantFile: "browser-transitive", field: "clientJs" });
    expect(js).toMatch(/async function _scrml_leaf_\d+\s*\(/);
    expect(js).toMatch(/async function _scrml_middle_\d+\s*\(/);
    expect(js).toMatch(/async function _scrml_top_\d+\s*\(/);
    expect(js).toMatch(/await\s+_scrml_leaf_\d+\s*\(/);
    expect(js).toMatch(/await\s+_scrml_middle_\d+\s*\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §5 — ss1 mixed module: a `?{}` fn AND a safeCallAsync fn in one library
// ---------------------------------------------------------------------------

describe("§5: mixed ?{}+safeCallAsync module — ss1 value-export path (Gap 1)", () => {
  test("the safeCallAsync fn emits `async` + `await` in the .server.js value export", () => {
    const p = fix("ss1-mixed.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  <db src="./d.db" tables="items">
  export function loadRows() {
    const rows = ?{\`SELECT id FROM items\`}.all()
    return rows
  }
  export function callHost(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false }) }
    return r.ok
  }
}
`);
    const { js } = compile([p], { mode: "library", wantFile: "ss1-mixed", field: "serverJs" });
    // The `?{}` fn is async (existing behavior); the safeCallAsync fn is now async
    // + awaited via the Gap-1 seed reaching the ss1 emitLibraryFnMember path.
    expect(js).toMatch(/export async function callHost\s*\(/);
    expect(js).toMatch(/await\s+safeCallAsync\s*\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §6 — negative: a PURE library fn (no async boundary) stays plain `function`
// ---------------------------------------------------------------------------

describe("§6: pure library fn stays plain `function` (no over-coloring)", () => {
  test("a fn with no stdlib-async / server / peer-async call is NOT colored async", () => {
    const p = fix("pure-lib.scrml", `\${
  export function add(a, b) { return a + b }
  export function twice(a) { const r = add(a, a); return r }
}
`);
    const { js } = compile([p], { mode: "library", wantFile: "pure-lib", field: "libraryJs" });
    expect(js).toMatch(/function add\s*\(/);
    expect(js).not.toMatch(/async function add\s*\(/);
    expect(js).not.toMatch(/async function twice\s*\(/);
    expect(js).not.toMatch(/\bawait\b/);
  });
});
