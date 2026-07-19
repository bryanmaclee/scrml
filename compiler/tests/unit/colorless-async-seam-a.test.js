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

// ===========================================================================
// S239 adversarial-review findings — the no-silent-leak invariant (a fn colored
// async ⟹ every async call in it is `await`ed OR fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK)
// ===========================================================================

const hasAsyncSyncCbErr = (errors) => errors.some((e) => e.code === "E-ASYNC-STDLIB-IN-SYNC-CALLBACK");

// §7 (finding 1/1b/3) — a stdlib-async call in a NON-awaitable position fails closed.
describe("§7 (finding 1/3): stdlib-async in a sync callback / raw body fails closed", () => {
  test("a `.some(h => verifyPassword(pw,h))` value-export fn fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const p = fix("f1-authbypass.scrml", `\${
  import { verifyPassword } from "scrml:auth"
  export function anyValid(pw, hs) { const ok = hs.some(h => verifyPassword(pw, h)); return ok }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f1-authbypass", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });

  test("a BLOCK-body callback `xs.some(x => { return safeCallAsync(...).ok })` (raw) fails closed", () => {
    const p = fix("f3-raw.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function anyBad(xs) { const any = xs.some(x => { return safeCallAsync(() => x.go()).ok }); return any }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f3-raw", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });
});

// §8 (finding 2) — an awaited CLIENT async-peer call used as a receiver is paren-wrapped.
describe("§8 (finding 2): client awaited-peer receiver is paren-wrapped", () => {
  test("`middle(cfg).count` lowers to `(await middle(cfg)).count`, not `await middle(cfg).count`", () => {
    const p = fix("f2-receiver.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function middle(cfg) { const r = safeCallAsync(() => cfg.load()) !{ | ::Thrown(m) -> ({ count: 0 }) }; return r }
  function outer(cfg) { const n = middle(cfg).count; @total = n }
  <total> = 0
}
<button onclick=outer(window)>Go</button>
<span>\${@total}</span>
</program>
`);
    const { js } = compile([p], { wantFile: "f2-receiver", field: "clientJs" });
    expect(js).toMatch(/\(await _scrml_middle_\d+\(cfg\)\)\.count/);
    expect(js).not.toMatch(/await _scrml_middle_\d+\(cfg\)\.count/);
  });
});

// §9 (finding 4) — a BARE client stdlib-async call (no `!{}`) in an async fn is awaited.
describe("§9 (finding 4): bare client stdlib-async call is awaited", () => {
  test("`const r = safeCallAsync(...)` (no handler) in a client fn emits `await safeCallAsync`", () => {
    const p = fix("f4-clientbare.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function doIt(obj) { const r = safeCallAsync(() => obj.doThing()); @done = r.ok }
  <done> = false
}
<button onclick=doIt(window)>Go</button>
<span>\${@done}</span>
</program>
`);
    const { js } = compile([p], { wantFile: "f4-clientbare", field: "clientJs" });
    expect(js).toMatch(/async function _scrml_doIt_\d+/);
    expect(js).toMatch(/const r = await safeCallAsync\(/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });

  test("a fail-closed-async SYNC stdlib helper (`sortBy`) in a markup for-loop is NOT awaited", () => {
    // sortBy is a re-export scrml:data seeds fail-closed-async; it is actually sync
    // and runs in a `${ for … }` render loop (NOT an async fn) — awaiting it would
    // inject `await` in a non-async context. The clientAsyncBody gate keeps it bare.
    const p = fix("f4-markup-noawait.scrml", `<program>
\${ import { sortBy } from 'scrml:data' }
<items> = [{ n: "b", o: 2 }, { n: "a", o: 1 }]
<ul>\${ for (let it of sortBy(@items, "o")) { lift <li>\${it.n}</li> } }</ul>
</program>
`);
    const { js, errors } = compile([p], { wantFile: "f4-markup-noawait", field: "clientJs" });
    expect(errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
    expect(js).not.toMatch(/await\s+sortBy\b/);
  });
});

// §10 (finding 6) — an indirect async call via a local alias fails closed.
describe("§10 (finding 6): indirect async call via a local alias fails closed", () => {
  test("`const g = middle; g(obj)` (middle async) fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const p = fix("f6-alias.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function middle(obj) { const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(m) :> ({ ok: false }) }; return r.ok }
  export function outer(obj) { const g = middle; const ok = g(obj); return ok }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f6-alias", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });
});

// §11 (S259 bucket c) — `.sort` with an async comparator is fail-closed (EXCLUDED
// from the bucket-(a) combinator family; async merge-sort is out of scope).
describe("§11 (bucket c): `.sort` with an async comparator fails closed", () => {
  test("`rows.sort((a,b) => verifyPassword(pw,a) ? -1 : 1)` fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const p = fix("c-sort.scrml", `\${
  import { verifyPassword } from "scrml:auth"
  export function ranked(rows, pw) { const s = rows.sort((a, b) => verifyPassword(pw, a) ? -1 : 1); return s }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "c-sort", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });
});

// §12 (finding 1, S239 fix-round) — an async call in a fn SIGNATURE param default is
// eagerly evaluated OUTSIDE the async body (`await` is a JS SyntaxError in a default
// even in an async fn — DD colorless-async-boundaries position-2 fail-close anchor).
// `paramSignature` splices `p.defaultValue` as raw text, so the body walk never
// reaches it; pre-fix it compiled clean and leaked a bare Promise (`x.ok === undefined`).
describe("§12 (finding 1): async call in a PARAM DEFAULT fails closed", () => {
  test("client `function f(x = safeCallAsync(...))` fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const p = fix("f1-param-stdlib.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function f(x = safeCallAsync(() => window.g())) { @done = x.ok }
  <done> = false
}
<button onclick=f()>Go</button>
<span>\${@done}</span>
</program>
`);
    const { js, errors } = compile([p], { wantFile: "f1-param-stdlib", field: "clientJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
    // The client fn is NOT emitted as an awaited/async-resolved param default — the
    // leak shape (`= safeCallAsync(...)` with a bare `.ok`) is diagnosed, not silently
    // shipped. `x.ok` on a Promise would be `undefined` (the leak this closes).
    expect(js).not.toMatch(/=\s*await\s+safeCallAsync/);
  });

  test("client async-PEER default `function outer(x = middle(window))` fails closed", () => {
    const p = fix("f1-param-peer.scrml", `<program>
\${
  import { safeCallAsync } from "scrml:host"
  function middle(o) { const r = safeCallAsync(() => o.load()) !{ | ::Thrown(m) -> ({ ok: false }) }; return r.ok }
  function outer(x = middle(window)) { @done = x }
  <done> = false
}
<button onclick=outer()>Go</button>
<span>\${@done}</span>
</program>
`);
    const { errors } = compile([p], { wantFile: "f1-param-peer", field: "clientJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });

  test("library `export function h(x = callHost(obj))` (async peer) fails closed", () => {
    const p = fix("f1-param-lib.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function callHost(obj) { const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(m) :> ({ ok: false }) }; return r.ok }
  export function h(obj, x = callHost(obj)) { return x }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f1-param-lib", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });

  test("a PLAIN param default (no async) does NOT fire — no over-diagnosis", () => {
    const p = fix("f1-param-plain.scrml", `\${
  export function add(a, b) { return a + b }
  export function h(a, b = 0) { const s = add(a, b); return s }
}
`);
    const { js, errors } = compile([p], { mode: "library", wantFile: "f1-param-plain", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(false);
    expect(js).not.toMatch(/\bawait\b/);
  });
});

// §13 (finding 2, S239 fix-round) — a MULTI-HOP alias chain (`const g = middle;
// const h = g; h()`). The pre-fix single-level collector recorded `X = <rhs>` only
// when `rhs` was DIRECTLY async, so a re-alias was missed and the indirect call
// shipped bare-unawaited on a plain sync fn. The collector now chain-follows to the
// async terminal (cycle-safe).
describe("§13 (finding 2): multi-hop alias chain fails closed / no false-positive", () => {
  test("`const g = middle; const h = g; h(o)` (middle async) fires E-ASYNC-STDLIB-IN-SYNC-CALLBACK", () => {
    const p = fix("f2-multihop.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function middle(o) { const r = safeCallAsync(() => o.doThing()) !{ | ::Thrown(m) :> ({ ok: false }) }; return r.ok }
  export function outer(o) { const g = middle; const h = g; const ok = h(o); return ok }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f2-multihop", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
    // The resolved async terminal (`middle`) is named in the diagnostic, proving the
    // chain was followed transitively past the intermediate alias `g`.
    expect(errors.some((e) => e.code === "E-ASYNC-STDLIB-IN-SYNC-CALLBACK" && /alias of the async function `middle`/.test(e.message))).toBe(true);
  });

  test("a 3-hop chain `g -> h -> k; k(o)` also fails closed", () => {
    const p = fix("f2-threehop.scrml", `\${
  import { safeCallAsync } from "scrml:host"
  export function middle(o) { const r = safeCallAsync(() => o.doThing()) !{ | ::Thrown(m) :> ({ ok: false }) }; return r.ok }
  export function outer(o) { const g = middle; const h = g; const k = h; const ok = k(o); return ok }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f2-threehop", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(true);
  });

  test("a multi-hop chain to a SYNC terminal is NOT flagged (no over-coloring)", () => {
    const p = fix("f2-syncterminal.scrml", `\${
  export function add(a, b) { return a + b }
  export function outer(o) { const g = add; const h = g; const s = h(o, o); return s }
}
`);
    const { js, errors } = compile([p], { mode: "library", wantFile: "f2-syncterminal", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(false);
    expect(js).not.toMatch(/async function outer\s*\(/);
    expect(js).not.toMatch(/\bawait\b/);
  });

  test("a mutual-alias forward-ref cycle TERMINATES (no infinite loop) and does not false-fire", () => {
    // `const a = b; const b = a` is a decl cycle in the alias graph. The chain-follow
    // must terminate (the `visited` guard) rather than hang; no async in the file, so
    // no E-ASYNC-STDLIB-IN-SYNC-CALLBACK. (The forward-ref itself is an orthogonal
    // scope diagnostic — not asserted here; the point is: the compile RETURNS.)
    const p = fix("f2-cycle.scrml", `\${
  export function add(a, b) { return a + b }
  export function outer(o) { const a = b; const b = a; const s = add(o, o); return s }
}
`);
    const { errors } = compile([p], { mode: "library", wantFile: "f2-cycle", field: "libraryJs" });
    expect(hasAsyncSyncCbErr(errors)).toBe(false);
  });
});
