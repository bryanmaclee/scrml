/**
 * cross-module-client-value-position-autoawait.test.js
 *
 * g-inferred-async-call-value-position-no-autoawait — the CROSS-MODULE half.
 *
 * A cross-module call to an INFERRED-ASYNC export of a user `.scrml` module was
 * not `await`ed in CLIENT value position. HIGH and SILENT: it compiled green,
 * SSR'd correctly, and handed back `undefined` at runtime.
 *
 * `emit-functions.ts` computed the async COLORING set over
 * `_asyncImportedLocals ∪ {local async fns}` — so the CALLER was correctly
 * emitted `async` — then filtered the PEER-AWAIT set down to LOCAL fn names
 * only, dropping every imported name. The justifying comment claimed imported
 * names are covered by "the stdlib auto-await classifier (or the guarded-expr
 * `!{}` auto-await)". True for `scrml:` VENDOR imports; FALSE for user `.scrml`
 * exports — `isPromiseReturningCallExpr` classifies server fns + stdlib
 * `isAsync` exports ONLY (the Q5 `<repo>/stdlib/` carve-out), and the
 * guarded-expr `_autoAwait` DELEGATES to that same predicate rather than being
 * an independent surface. Nothing covered the user-module case.
 *
 * NOTE ON COVERAGE BOUNDARIES — a stdlib-only assertion proves NOTHING here:
 * the `scrml:` vendor path already worked before the fix. Every SUBJECT test
 * below crosses a user `./lib.scrml` boundary. The vendor cases appear only as
 * CONTROLS (§3) pinning that they did not change.
 *
 * The existing `colorless-async-seam-a.test.js` covers cross-module on the
 * LIBRARY path (§3) and same-module on the CLIENT path (§4). This file covers
 * the missing diagonal: CROSS-MODULE on the CLIENT path.
 *
 *   §1  SUBJECT — plain value position: `const r = fetchStatus(u)` is awaited
 *   §2  SUBJECT — `!{}` guarded position: the `__scrml_error` arm is live
 *   §3  CONTROL — `scrml:` vendor async imports are unchanged, single-`await`
 *   §4  await IDEMPOTENCY — a source `await` never stacks on an injected one
 *   §5  NEGATIVE — a SYNC cross-module import is not over-awaited
 *   §6  COMBINATOR COMPOSITION — the widening's largest emit-shape change
 *
 * SPEC / authority:
 *   §13.1 stdlib carve-out · §13.2.1 auto-await classifier · §19.9.8 no async/await
 *   docs/deep-dives/interprocedural-cps-colorless-async-2026-07-15.md (S258)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { emitExpr } from "../../src/codegen/emit-expr.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/xmod-client-autoawait");

beforeAll(() => mkdirSync(FIXTURE_DIR, { recursive: true }));
afterAll(() => {
  try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch {}
});

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

/** Compile `inputFiles` together; return the `clientJs` emitted for `wantFile`. */
function compileClient(inputFiles, wantFile) {
  const result = compileScrml({ inputFiles, write: false, log: () => {} });
  let js = "";
  for (const [fp, out] of result.outputs) {
    if (fp.endsWith(`${wantFile}.scrml`)) { js = out.clientJs ?? ""; break; }
  }
  return { js, errors: result.errors || [] };
}

// The imported module: `fetchStatus` is INFERRED async (it reaches the
// Promise-returning `scrml:http` `get`). Nothing in the source says `async`.
const LIB_SRC = `\${
  import { get } from 'scrml:http'
  export function fetchStatus(url) {
    const r = get(url) !{ return { status: 0 } }
    return r
  }
}
`;

// ---------------------------------------------------------------------------
// §1 — SUBJECT: plain value position across a user `.scrml` module boundary
// ---------------------------------------------------------------------------

describe("§1: cross-module inferred-async in CLIENT value position", () => {
  test("`const r = fetchStatus(u)` emits `await` (was BARE → r was a Promise)", () => {
    const lib = fix("s1-lib.scrml", LIB_SRC);
    const main = fix("s1-main.scrml", `<program>
\${
  import { fetchStatus } from './s1-lib.scrml'
  <out>: number = 0
  function goUser(u) {
    const r = fetchStatus(u)
    @out = r.status
  }
}
<button on click=\${goUser("/y")}>user</button>
<p>\${@out}</p>
</>
`);
    const { js } = compileClient([lib, main], "s1-main");

    // The callee really is async in the imported module's own emit — otherwise
    // this test would pass vacuously against a sync callee.
    const libOut = compileClient([lib, main], "s1-lib");
    expect(libOut.js).toMatch(/async function _scrml_fetchStatus_\d+\s*\(/);

    // The caller is colored async (this already worked — the coloring set
    // carried the imported name)...
    expect(js).toMatch(/async function _scrml_goUser_\d+\s*\(/);
    // ...and NOW the call is awaited (this is the fix).
    expect(js).toMatch(/const r = await fetchStatus\(u\);/);
    // The regression shape: a BARE call whose result is read as a plain object.
    expect(js).not.toMatch(/const r = fetchStatus\(u\);/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §2 — SUBJECT: the `!{}` guarded form. The `!{}` did NOT rescue it, and the
//      un-awaited Promise made the `__scrml_error` guard permanently falsy —
//      so the recovery arm was DEAD CODE.
// ---------------------------------------------------------------------------

describe("§2: cross-module inferred-async under a `!{}` guard", () => {
  test("the `__scrml_error` check runs on the SETTLED value, not a Promise", () => {
    const lib = fix("s2-lib.scrml", LIB_SRC);
    const main = fix("s2-main.scrml", `<program>
\${
  import { fetchStatus } from './s2-lib.scrml'
  <out>: number = 0
  function goGuard(u) {
    const r = fetchStatus(u) !{ return { status: 0 } }
    @out = r.status
  }
}
<button on click=\${goGuard("/y")}>g</button>
<p>\${@out}</p>
</>
`);
    const { js } = compileClient([lib, main], "s2-main");

    // The guarded init is awaited BEFORE the envelope test.
    const m = js.match(/let (_scrml__scrml_result_\d+) = await fetchStatus\(u\);/);
    expect(m).not.toBeNull();
    const resultVar = m[1];
    // ...and the very next guard tests that same (now settled) binding.
    expect(js).toMatch(
      new RegExp(`if \\(${resultVar} && ${resultVar}\\.__scrml_error\\) \\{`),
    );
    // Exactly one `await` — the guarded-expr `_autoAwait` must not stack on
    // the peer-await branch's.
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §3 — CONTROL: `scrml:` VENDOR async imports. These were ALREADY awaited (by
//      the stdlib classifier), and the fix must leave them exactly as they
//      were — in particular it must NOT double-await a `safeCallAsync(...) !{}`,
//      which is the hazard the old comment named.
// ---------------------------------------------------------------------------

describe("§3: `scrml:` vendor async imports stay single-`await`", () => {
  test("safeCallAsync in guarded / bare-statement / plain-decl position: one await each", () => {
    const p = fix("s3-vendor.scrml", `<program>
\${
  import { safeCallAsync } from 'scrml:host'
  <out>: number = 0
  function goHazard() {
    const v = safeCallAsync(() => 1) !{ return 0 }
    @out = v
  }
  function goBare() { safeCallAsync(() => 2) }
  function goDecl() {
    const w = safeCallAsync(() => 3)
    @out = w
  }
}
<button on click=\${goHazard()}>h</button>
<button on click=\${goBare()}>b</button>
<button on click=\${goDecl()}>d</button>
</>
`);
    const { js } = compileClient([p], "s3-vendor");
    expect(js).toMatch(/= await safeCallAsync\(\(\) => 1\);/);
    expect(js).toMatch(/^\s*await safeCallAsync\(\(\) => 2\);/m);
    expect(js).toMatch(/const w = await safeCallAsync\(\(\) => 3\);/);
    // The whole point of the (b) exclusion: never `await await`.
    expect(js).not.toMatch(/\bawait\s+await\b/);
    // Exactly three awaited call sites, no more.
    expect(js.match(/await safeCallAsync\(/g)).toHaveLength(3);
  });

  test("a vendor stdlib call and a user-module call in the SAME file both await once", () => {
    const lib = fix("s3b-lib.scrml", LIB_SRC);
    const main = fix("s3b-main.scrml", `<program>
\${
  import { fetchStatus } from './s3b-lib.scrml'
  import { get } from 'scrml:http'
  <out>: number = 0
  function goStd(u) {
    const r = get(u) !{ return { status: 0 } }
    @out = r.status
  }
  function goUser(u) {
    const r = fetchStatus(u)
    @out = r.status
  }
}
<button on click=\${goStd("/x")}>std</button>
<button on click=\${goUser("/y")}>user</button>
</>
`);
    const { js } = compileClient([lib, main], "s3b-main");
    expect(js).toMatch(/= await get\(u\);/);
    expect(js).toMatch(/const r = await fetchStatus\(u\);/);
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });
});

// ---------------------------------------------------------------------------
// §4 — await IDEMPOTENCY at the `emitUnary` seam. A SOURCE `await` (a
//      user-written `async function` body — §19.9.8 forbids it, but the stdlib
//      modules still carry the shape) must not stack on an `await` injected by
//      a compiler auto-await surface. Neither owner can see the other: the
//      `unary` node cannot inspect its operand's serialization, and the
//      peer-await branch in `emitCall` has no parent pointer.
//
//      This is the regression an R26 artifact diff of `stdlib/oauth` caught and
//      the 21597-test suite did not: `const res = await await httpGet(...)`.
//      `await await p` yields the same VALUE (one extra microtask tick), so it
//      ships green through the parse gate — it is a readability failure, which
//      is a hard output requirement, so it is pinned structurally here.
// ---------------------------------------------------------------------------

describe("§4: an emitted `await` is idempotent", () => {
  const awaitOfCall = (calleeName) => ({
    kind: "unary",
    op: "await",
    prefix: true,
    argument: {
      kind: "call",
      callee: { kind: "ident", name: calleeName },
      args: [{ kind: "ident", name: "u" }],
    },
  });

  test("a source `await` over an auto-awaited peer call emits ONE `await`", () => {
    // ctx puts `httpGet` in the client peer-await set, so `emitCall` injects
    // its own `await` — exactly the stdlib/oauth `get as httpGet` situation.
    const ctx = { mode: "client", clientAsyncFnNames: new Set(["httpGet"]) };
    const out = emitExpr(awaitOfCall("httpGet"), ctx);
    expect(out).toBe("await httpGet(u)");
    expect(out).not.toMatch(/\bawait\s+await\b/);
  });

  test("a source `await` over a NON-auto-awaited call still emits its `await`", () => {
    // Negative control: the guard must not swallow a legitimate lone `await`.
    const ctx = { mode: "client", clientAsyncFnNames: new Set() };
    expect(emitExpr(awaitOfCall("plainFn"), ctx)).toBe("await plainFn(u)");
  });

  test("the guard is anchored — it does not match an identifier merely starting `await`", () => {
    // `awaiting(u)` must still receive its own `await` prefix; a naive
    // `startsWith(\"await\")` check would have swallowed it.
    const ctx = { mode: "client", clientAsyncFnNames: new Set() };
    expect(emitExpr(awaitOfCall("awaiting"), ctx)).toBe("await awaiting(u)");
  });
});

// ---------------------------------------------------------------------------
// §5 — NEGATIVE: a SYNC cross-module import must NOT be awaited. The fix
//      widens the peer set to imported names, so over-application is the
//      opposite-direction risk and needs its own pin.
// ---------------------------------------------------------------------------

describe("§5: a SYNC cross-module import is not awaited", () => {
  test("a pure imported fn stays a bare call and its caller stays sync", () => {
    const lib = fix("s5-lib.scrml", `\${
  export function addOne(n) { return n + 1 }
}
`);
    const main = fix("s5-main.scrml", `<program>
\${
  import { addOne } from './s5-lib.scrml'
  <out>: number = 0
  function bump(n) {
    const r = addOne(n)
    @out = r
  }
}
<button on click=\${bump(1)}>b</button>
</>
`);
    const { js } = compileClient([lib, main], "s5-main");
    expect(js).toMatch(/const r = addOne\(n\);/);
    expect(js).not.toMatch(/await addOne\(/);
    // The caller must stay a plain `function` — no spurious async coloring.
    expect(js).toMatch(/\bfunction _scrml_bump_\d+\s*\(/);
    expect(js).not.toMatch(/async function _scrml_bump_\d+\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// §6 — COMBINATOR COMPOSITION. The diff's largest emit-shape change, and the
//      S239 reviewer's pick for "most likely way this breaks an adopter".
//
// `combinatorIsAsyncName` (emit-expr.ts) reads `ctx.clientAsyncFnNames` — the
// SAME set FIX 1 widened — so widening it silently extends the Phase-2
// async-combinator lowering to cross-module imported names. An ordinary source
// shape that previously never reached that machinery now does:
//
//   -  const xs = urls.map((u) => fetchStatus(u).status);
//   +  const xs = await _scrml_mapAsync(urls, async (u) => (await fetchStatus(u)).status);
//
// plus the on-use combinator helpers injected into the bundle.
//
// The BASELINE shape is not merely un-awaited, it is silently WRONG: the bare
// `.map` builds an array of PROMISES, so `.status` on each is `undefined`
// (arithmetic → NaN) and every `_scrml_structural_eq(<promise>.status, 200)`
// predicate is false — `.filter` yields [] and `.some` yields false. An
// accept-nothing bug with no diagnostic.
//
// Asserts BOTH halves:
//   (a) the REWRITE happens (text), and
//   (b) the RUNTIME RESULT is correct (execution) — every executed line is
//       taken VERBATIM from the compiled artifact (the emitted handler bodies
//       AND the injected combinator helpers); only the environment
//       (`fetchStatus`, the cell accessors, `_scrml_structural_eq`) is stubbed.
//
// SCOPE: `.sort` is deliberately fail-closed (DD FORK 2) and is NOT touched.
// `.forEach` is not exercised either — note that it IS a member of
// `ASYNC_COMBINATOR_METHOD_ORDER` (async-combinators.ts:46), so a review note
// describing it as outside the combinator set would be inaccurate; either way
// this test neither widens nor narrows the method set.
// ---------------------------------------------------------------------------

/**
 * Slice a named async function declaration out of emitted JS by brace-matching
 * from its `{`. Used to lift BOTH the emitted handlers and the injected
 * combinator helpers verbatim, so the executed code is the artifact's own text
 * rather than a re-derivation of it.
 */
function sliceFnDecl(js, namePattern) {
  const m = js.match(new RegExp(`async function (${namePattern})\\s*\\([^)]*\\)\\s*\\{`));
  if (!m) return null;
  const open = js.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") {
      depth--;
      if (depth === 0) return { name: m[1], src: js.slice(m.index, i + 1) };
    }
  }
  return null;
}

describe("§6: cross-module async inside a collection combinator", () => {
  // `.map` writes xs[0] (BASE `undefined` — a Promise has no `.status`),
  // `.filter` writes the surviving count (BASE 0), `.some` writes 1/0 (BASE 0).
  // Each written value is discriminating: the baseline cannot produce it.
  const COMB_MAIN = `<program>
\${
  import { fetchStatus } from './s6-lib.scrml'
  <urls>: string[] = []
  <out>: number = 0
  function goMap() {
    const xs = @urls.map((u) => fetchStatus(u).status)
    @out = xs[0]
  }
  function goFilter() {
    const xs = @urls.filter((u) => fetchStatus(u).status == 200)
    @out = xs.length
  }
  function goSome() {
    const ok = @urls.some((u) => fetchStatus(u).status == 200)
    @out = ok ? 1 : 0
  }
}
<button on click=\${goMap()}>m</button>
<button on click=\${goFilter()}>f</button>
<button on click=\${goSome()}>s</button>
<p>\${@out}</p>
</>
`;

  function compileComb() {
    const lib = fix("s6-lib.scrml", LIB_SRC);
    const main = fix("s6-main.scrml", COMB_MAIN);
    return compileClient([lib, main], "s6-main");
  }

  test("(a) REWRITE — .map/.filter/.some lower to the awaited combinator form", () => {
    const { js } = compileComb();
    // The cross-module callee drives the lowering; the callback is re-emitted
    // `async` and its inner call awaited + paren-wrapped for the `.status` read
    // (`await f(u).status` would mis-parse as `await (promise.status)`).
    expect(js).toMatch(/const xs = await _scrml_mapAsync\(.*, async \(u\) => \(await fetchStatus\(u\)\)\.status\);/);
    expect(js).toMatch(/const xs = await _scrml_filterAsync\(.*, async \(u\) => .*\(await fetchStatus\(u\)\)\.status/);
    expect(js).toMatch(/const ok = await _scrml_someAsync\(.*, async \(u\) => .*\(await fetchStatus\(u\)\)\.status/);
    // The BASELINE shape — a bare native `.map` over a Promise-returning callee.
    expect(js).not.toMatch(/\.map\(\(u\) => fetchStatus\(u\)\.status\)/);
    // On-use injection: the helpers ship because (and only because) they are used.
    expect(js).toContain("async function _scrml_mapAsync(");
    expect(js).toContain("async function _scrml_filterAsync(");
    expect(js).toContain("async function _scrml_someAsync(");
    expect(js).not.toMatch(/\bawait\s+await\b/);
  });

  test("(b) EXECUTED — the emitted handlers + injected helpers produce correct values", async () => {
    const { js } = compileComb();

    // Lift the three emitted handlers AND the three injected combinator helpers
    // VERBATIM out of the artifact.
    const handlers = ["_scrml_goMap_\\d+", "_scrml_goFilter_\\d+", "_scrml_goSome_\\d+"]
      .map((p) => sliceFnDecl(js, p));
    const helpers = ["_scrml_mapAsync", "_scrml_filterAsync", "_scrml_someAsync"]
      .map((p) => sliceFnDecl(js, p));
    for (const f of [...handlers, ...helpers]) expect(f).not.toBeNull();

    // The only stubs: the cross-module async callee, the cell accessors, and the
    // structural-eq helper. `/b` is a 404 so `.filter`/`.some` are non-trivial.
    const harness = `
      const _urls = ["/a", "/b", "/c"];
      let _out;
      const fetchStatus = async (u) => ({ status: u === "/b" ? 404 : 200 });
      const _scrml_cs_reactive_get = (k) => (k === "urls" ? _urls : _out);
      const _scrml_cs_reactive_set = (k, v) => { if (k === "out") _out = v; };
      const _scrml_structural_eq = (a, b) => a === b;
      ${[...helpers, ...handlers].map((f) => f.src).join("\n")}
      return async () => {
        const seen = {};
        await ${handlers[0].name}(); seen.map = _out;
        await ${handlers[1].name}(); seen.filter = _out;
        await ${handlers[2].name}(); seen.some = _out;
        return seen;
      };
    `;
    const run = new Function(harness)();
    const seen = await run();

    // NEW (correct): the callback's Promise is awaited, so `.status` is a number.
    expect(seen.map).toBe(200);     // BASE: undefined (`.status` of a Promise)
    expect(seen.filter).toBe(2);    // BASE: 0 (every eq against undefined is false)
    expect(seen.some).toBe(1);      // BASE: 0 (same)
  });

  test("a SYNC cross-module callback is NOT routed through a combinator", () => {
    // Negative control for the widening: only an ASYNC imported callee may pull
    // an ordinary `.map` into the combinator machinery.
    const lib = fix("s6-sync-lib.scrml", `\${
  export function addOne(n) { return n + 1 }
}
`);
    const main = fix("s6-sync-main.scrml", `<program>
\${
  import { addOne } from './s6-sync-lib.scrml'
  <nums>: number[] = []
  <out>: number = 0
  function goPlain() {
    const xs = @nums.map((n) => addOne(n))
    @out = xs.length
  }
}
<button on click=\${goPlain()}>p</button>
</>
`);
    const { js } = compileClient([lib, main], "s6-sync-main");
    expect(js).toMatch(/\.map\(\(n\) => addOne\(n\)\)/);
    expect(js).not.toContain("_scrml_mapAsync");
    // No combinator helpers injected when nothing uses them.
    expect(js).not.toContain("collection combinators");
  });
});
