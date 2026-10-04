/**
 * s453-async-listener-rejection-log.test.js — EMISSION bite-proofs for bryan's
 * S449 ruling A3 (`scrml-support/user-voice-scrml.md` §S449):
 *
 *   "A3 = yes: every async event listener routes its rejection to
 *    `_scrml_error_boundary_log` (extends B5 to handlers; closes
 *    g-handler-level-rejection-bypasses-scrml-logging)"
 *
 * WHY. `addEventListener` discards a listener's return value, so an `async`
 * listener returns a Promise NOBODY observes: a rejection surfaces only as a
 * browser `unhandledrejection`, outside scrml's logging surface. S450's #1242
 * made that reachable from ordinary source — a nested server-call cell write is
 * now awaited IN PLACE, which colours the handler `async` — so a failed call that
 * used to reach `_scrml_error_boundary_log` through emit-client's detached
 * `(async () => …)().catch(…)` IIFE stopped reaching it.
 *
 * WHERE. The wrap is in `js-async-analysis.ts:colorAsyncFunctionExpr` — the ONE
 * seam every listener emitter shares. `emit-event-wiring.ts:colorHandlerAsync`
 * reaches it for the delegated registry, the non-delegable per-element
 * `addEventListener`, and the arm/row-bound factory (`armFactoryLines`);
 * `colorActiveHandler` reaches it for `<each>` rows and `emit-lift.js`'s
 * per-element listeners. Patching one of those branches would have left the
 * others silently unlogged (primary.map.md invariant 69).
 *
 * BITE. Every `expect` below FAILS on the pre-S453 tree: the pre-fix emission has
 * no `catch` arm in any async-coloured listener. The byte-identity case is the
 * other direction — a handler that is NOT coloured async must be untouched.
 *
 * The MOUNTED acceptance (dispatch the event, watch the log arrive, and watch the
 * page NOT take an unhandled rejection) is
 * `compiler/tests/browser/async-listener-rejection-log-s453.browser.test.js`.
 */

import { describe, test, expect } from "bun:test";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { colorAsyncFunctionExpr } from "../../src/codegen/js-async-analysis.ts";

const PRE = `  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <x> = 0
  <y> = 0
  <c> = true
  <rows> = [{ id: 1 }]
  server function save() { return 10 }
`;

function emit(markup, pre = PRE) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s453-emit-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, `<program>\n${pre}  ${markup}\n  <p id="o">\${@x}</p>\n</program>\n`);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const p = resolve(outDir, "app.client.js");
    return {
      errs: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code),
      js: existsSync(p) ? readFileSync(p, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Every `_scrml_error_boundary_log("<id>", …)` arm that a `catch` binds. */
function catchArms(js) {
  return (js.match(/catch \(_scrml_async_err[^)]*\) \{ _scrml_error_boundary_log\("([^"]*)"/g) || [])
    .map((m) => m.match(/_scrml_error_boundary_log\("([^"]*)"/)[1]);
}

// A nested server-call cell write — #1242 awaits it IN PLACE, which is what
// colours the listener `async`. This is the exact shape that widened the gap.
const ASYNC_H = `if (@c) { @x = save(); @y = @x + 1 }`;
// A sole-root write keeps the §13.2 fire-and-forget skip, so the listener stays
// SYNC: the byte-identity control.
const SYNC_H = `@x = 1`;

describe("S453 — an async-coloured event listener logs its rejection", () => {
  test("delegated (click) — the registry entry carries the catch arm", () => {
    const r = emit(`<button id="b" onclick=\${${ASYNC_H}}>b</button>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toContain("async function(event)");
    const arms = catchArms(r.js);
    expect(arms.length).toBe(1);
    expect(arms[0]).toMatch(/^onclick /);
  });

  test("non-delegable (input) — the element-scoped dispatch map carries it", () => {
    const r = emit(`<input id="b" oninput=\${${ASYNC_H}} />`);
    expect(r.errs).toEqual([]);
    expect(r.js).toContain("async function(event)");
    const arms = catchArms(r.js);
    expect(arms.length).toBe(1);
    expect(arms[0]).toMatch(/^oninput /);
  });

  test("arm-bound factory — the factory RETURNS the wrapped async listener", () => {
    // A `match` inside an `<each>` row whose handler reads the row variable:
    // emit-event-wiring hoists it into `armFactoryLines` (armParams set), out of
    // the module-scope registry. A fix that only covered the registry would miss
    // this listener entirely.
    const r = emit(
      `<ul><each in=@rows key=@.id as r><li><match for=Doc on=@cur><Empty><p>n</p></>` +
      `<Note(note)><button id="b" onclick=\${if (@c) { @x = save(); @y = r.id }}>b</button></>` +
      `</match></li></each></ul>`,
    );
    expect(r.errs).toEqual([]);
    // The factory exists AND what it returns is the async listener.
    expect(r.js).toMatch(/function _scrml_armh_\w+\([^)]*\) \{ return async function\(event\)/);
    const arms = catchArms(r.js);
    expect(arms.length).toBe(1);
    expect(arms[0]).toMatch(/^onclick /);
  });

  test("<each> row listener (emit-each colorActiveHandler) carries it", () => {
    const r = emit(`<ul><each in=@rows key=@.id as r><li><button id="b" onclick=\${${ASYNC_H}}>b</button></li></each></ul>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toContain("async function(event)");
    expect(catchArms(r.js)).toEqual([expect.stringMatching(/^onclick <each> row$/)]);
  });

  test("for … lift row listener (emit-lift colorActiveHandler) carries it", () => {
    const r = emit(`<ul>\${ for (r of @rows) { lift <li><button id="b" onclick=\${${ASYNC_H}}>b</button></li>; } }</ul>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toContain("async function(event)");
    expect(catchArms(r.js)).toEqual([expect.stringMatching(/^onclick lift row$/)]);
  });

  // ⚑ KNOWN LIMITATION, PINNED SO IT IS NOT MISTAKEN FOR AN INVARIANT:
  // two `<each>` blocks on one page emit the SAME row boundary id, so a logged
  // row rejection is routed-but-not-located. Filed as
  // `g-s453-row-boundary-id-not-per-site` (nit).
  //
  // Measured while attempting the fix, and this is WHY it was not made here: the
  // only id the row emitters already have in hand, `elVar`, is a
  // PER-FACTORY-LOCAL counter, not a per-page one — two separate `<each>` blocks
  // each emit `_scrml_el_4`. It discriminates two handlers *within* one row and
  // nothing across blocks, so adding it would have looked like a fix for this
  // case without being one. A real discriminator needs a placeholder / block id
  // plumbed into emit-each and emit-lift.
  //
  // The DELEGATED and NON-DELEGABLE ids carry the unique `placeholderId` and are
  // unaffected — asserted here too, so the two cases are never conflated.
  test("two <each> blocks on one page share a row id (known nit); delegated ids stay unique", () => {
    const rows = emit(
      `<ul><each in=@rows key=@.id as r><li><button id="b1" onclick=\${${ASYNC_H}}>b</button></li></each></ul>` +
      `<ul><each in=@rows key=@.id as q><li><button id="b2" onclick=\${${ASYNC_H}}>b</button></li></each></ul>`,
    );
    expect(rows.errs).toEqual([]);
    const rowArms = catchArms(rows.js);
    expect(rowArms.length).toBe(2);        // both rows DO get an arm — the ruling holds
    expect(new Set(rowArms).size).toBe(1); // the nit: both read "onclick <each> row"

    const top = emit(
      `<button id="b1" onclick=\${${ASYNC_H}}>b</button><button id="b2" onclick=\${${ASYNC_H}}>c</button>`,
    );
    expect(top.errs).toEqual([]);
    const topArms = catchArms(top.js);
    expect(topArms.length).toBe(2);
    expect(new Set(topArms).size).toBe(2); // delegated: distinct placeholderIds
  });

  test("the catch arm is INSIDE the async function, not an IIFE around it", () => {
    // The shape matters: `event.preventDefault()` / `stopPropagation()` live in
    // the handler's SYNCHRONOUS prefix. A sync listener firing an async IIFE
    // would move them past a microtask boundary, by which time the browser has
    // committed the default action. So the listener itself stays `async` and the
    // try opens inside its body.
    // `preventDefault()` runs in the listener's SYNCHRONOUS prefix, before the
    // first `await`. The try must open AROUND it (not after it), and the
    // listener itself must stay the `async` function — a sync listener firing an
    // async IIFE would push preventDefault past a microtask boundary, by which
    // time the browser has already committed the submit.
    const r = emit(`<form id="f" onsubmit=\${event.preventDefault(); if (@c) { @x = save(); @y = @x + 1 }}><button>go</button></form>`);
    expect(r.errs).toEqual([]);
    expect(r.js).toMatch(/async function\(event\) \{ try \{\s*event\.preventDefault\(\);/);
    expect(r.js).toMatch(/await _scrml_fetch_save_/);
    // and NOT the IIFE shape, which would push preventDefault past a microtask
    expect(r.js).not.toMatch(/function\(event\) \{ \(async \(\) =>/);
    expect(catchArms(r.js)).toEqual(["onsubmit _scrml_attr_onsubmit_2"]);
  });

  test("the try opens immediately inside the async listener body", () => {
    const r = emit(`<button id="b" onclick=\${${ASYNC_H}}>b</button>`);
    expect(r.js).toMatch(/async function\(event\) \{ try \{/);
  });

  test("the log is reached through exactly ONE arm per listener (no double-log)", () => {
    const r = emit(`<button id="b" onclick=\${${ASYNC_H}}>b</button>`);
    expect(catchArms(r.js).length).toBe(1);
    // The handler's own detached fire-and-forget writes keep their own
    // `.catch(… → _scrml_error_boundary_log)`; a listener must not gain a second
    // arm logging the same throw.
    const all = (r.js.match(/_scrml_error_boundary_log\(/g) || []).length;
    expect(all).toBe(1);
  });

  test("a handler inside an <errorBoundary> does not double-log", () => {
    // The boundary's own `_scrml_error_boundary_log` is on the RENDER path (a
    // logic binding, `data-scrml-logic`), a disjoint code path from an event
    // binding. A handler in the subtree gets exactly its own one arm.
    const r = emit(`<errorBoundary fallback="oops"><button id="b" onclick=\${${ASYNC_H}}>b</button></errorBoundary>`);
    const arms = catchArms(r.js);
    expect(arms.length).toBe(1);
    expect(arms[0]).toMatch(/^onclick /);
  });
});

describe("S453 — a listener that is NOT coloured async is untouched", () => {
  test("a sync handler emits no catch arm and no async keyword", () => {
    const r = emit(`<button id="b" onclick=\${${SYNC_H}}>b</button>`);
    expect(r.errs).toEqual([]);
    expect(r.js).not.toContain("_scrml_error_boundary_log");
    expect(r.js).not.toContain("async function(event)");
  });

  test("a sole-root server-call write keeps the §13.2 fire-and-forget skip", () => {
    // S450 (S447 ruling iii): the SOLE root write stays detached, so the
    // listener stays SYNC — and its rejection is already logged by the IIFE's
    // own `.catch` arm. S453 must not add a second one, nor colour it async.
    const r = emit(`<button id="b" onclick=\${@x = save()}>b</button>`);
    expect(r.errs).toEqual([]);
    expect(r.js).not.toContain("async function(event)");
    expect(catchArms(r.js)).toEqual([]);
    // the pre-existing detached arm is still there, unchanged
    expect(r.js).toMatch(/\)\(\)\.catch\(_scrml_async_err => _scrml_error_boundary_log\(/);
  });

  test("a page with no event handler at all emits no log call", () => {
    const r = emit(`<p>hello</p>`);
    expect(r.errs).toEqual([]);
    expect(r.js).not.toContain("_scrml_error_boundary_log");
  });
});

// ---------------------------------------------------------------------------
// BODY SHAPES — exercised directly against the seam, because THE CORPUS CANNOT
// PRODUCE THEM. The wide emit differential covers 57 async-coloured listener
// sites and every one of them is a block-bodied `function(event) { … }`: a
// parenthesized concise arrow body appears nowhere in it. One of those shapes
// DID break during this arc — `(e) => ({ a: save() })` emitted
// `=> ({ try { … } })`, an object literal with a property named `try`, i.e. a
// SyntaxError — because parentheses are not AST nodes, so acorn puts
// `body.start` on the object's `{`, INSIDE the wrapping parens. A differential
// over a corpus with zero exposure to a shape reads green on a defect in it.
// This table is the gate that actually covers the shape space.
// ---------------------------------------------------------------------------
describe("S453 — the wrap is correct for every function-body shape", () => {
  // Mirrors the facts emitFunctions stashes: `save` is an async (server) call.
  const facts = (n) => (n === "save" ? { root: { kind: "server", via: "save" }, local: false } : null);

  const SHAPES = [
    ["block body, function expression", `function(event) { save(); }`],
    ["block body, arrow", `(event) => { save(); }`],
    ["concise arrow body", `(event) => save()`],
    ["concise arrow body, parenthesized call", `(event) => (save())`],
    ["concise arrow body, parenthesized OBJECT literal", `(event) => ({ a: save() })`],
    ["concise arrow body, doubly parenthesized", `(event) => (( save() ))`],
    ["concise arrow body, parenthesized sequence", `(event) => (save(), 1)`],
    ["concise arrow, unparenthesized param", `event => save()`],
  ];

  for (const [name, src] of SHAPES) {
    test(name, () => {
      const r = colorAsyncFunctionExpr(src, facts, { boundaryId: "onclick X" });
      expect(r).not.toBeNull();
      // it really was coloured async — otherwise the case proves nothing
      expect(r.rootAsync).toBe(true);
      expect(r.code).toContain('_scrml_error_boundary_log("onclick X"');
      // and the emitted text is a VALID function expression
      expect(() => new Function(`return (${r.code});`)).not.toThrow();
    });
  }

  // ⛑ S453 fix round — A DIRECTIVE PROLOGUE MUST NOT COST THE ARM.
  //
  // The first cut bailed to `null` on a body whose first statement is a string
  // literal, to avoid demoting `"use strict"` to an ordinary expression by
  // moving it inside the `try`. The reasoning was right and the CONSEQUENCE was
  // not measured: the listener is still emitted `async`, so the rejection still
  // escaped — 0 arms, no diagnostic, exit 0. Reproduced before fixing with
  // `onclick=${"use strict"; if (@c) { @x = netfail(); @y = 1 }}`. Any
  // string-literal first statement did it, not just `"use strict"`.
  const PROLOGUES = [
    [`"use strict"`, "use strict"],
    [`"anything at all"`, "an arbitrary string literal"],
    [`"use strict"; "second one"`, "two leading directives"],
  ];
  for (const [prologue, label] of PROLOGUES) {
    test(`a directive prologue (${label}) keeps the arm AND stays a directive`, () => {
      const r = colorAsyncFunctionExpr(`function(event) { ${prologue}; save(); }`, facts, { boundaryId: "onclick X" });
      expect(r).not.toBeNull();
      expect(r.rootAsync).toBe(true);
      // THE BITE: the arm exists at all (0 before the fix round).
      expect(r.code).toContain('_scrml_error_boundary_log("onclick X"');
      // and the prologue is still in DIRECTIVE POSITION — before the `try`, not inside it
      expect(r.code).toMatch(new RegExp(`^async function\\(event\\) \\{\\s*${prologue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};\\s*try \\{`));
      expect(r.code).not.toMatch(/try \{\s*"use strict"/);
      expect(() => new Function(`return (${r.code});`)).not.toThrow();
    });
  }

  test("a directive prologue is still EFFECTIVE after the wrap (strictness preserved)", async () => {
    // Positional is necessary but not sufficient — prove the emitted function is
    // actually in strict mode. Probe: a plain call's `this` is `undefined` under
    // `"use strict"` and the global object in sloppy mode. Chosen because it
    // does NOT throw: an error-based probe would be circular here, since the
    // rejection arm is exactly what catches it.
    const r = colorAsyncFunctionExpr(
      `function(event) { "use strict"; save(); probe(); }`, facts, { boundaryId: "onclick X" },
    );
    expect(r.code).toContain('_scrml_error_boundary_log("onclick X"');
    let seenThis = "not-run";
    const fn = new Function("save", "probe", `return (${r.code});`)(
      async () => 1,
      function () { seenThis = this === undefined ? "undefined" : "global"; },
    );
    await fn({});
    expect(seenThis).toBe("undefined"); // "global" => the directive was demoted
  });

  test("the catch binding is renamed when the body already uses it", () => {
    // emit-client's detached fire-and-forget write emits
    // `.catch(_scrml_async_err => _scrml_error_boundary_log(…))` INSIDE a handler
    // body, so the default name can genuinely collide. Shadowing would still
    // compile, but would read as if the outer arm bound the inner error.
    const r = colorAsyncFunctionExpr(
      `function(event) { p.catch(_scrml_async_err => 0); save(); }`, facts, { boundaryId: "onclick X" },
    );
    expect(r.code).toContain("catch (_scrml_async_err_2)");
    expect(r.code).toContain('_scrml_error_boundary_log("onclick X", _scrml_async_err_2)');
    expect(() => new Function(`return (${r.code});`)).not.toThrow();
  });

  test("a body the analysis does not colour async is returned verbatim", () => {
    const src = `function(event) { notAsync(); }`;
    const r = colorAsyncFunctionExpr(src, facts);
    expect(r.rootAsync).toBe(false);
    expect(r.code).toBe(src);
  });

  test("the default boundary id is used when a site passes none", () => {
    const r = colorAsyncFunctionExpr(`function(event) { save(); }`, facts);
    expect(r.code).toContain('_scrml_error_boundary_log("event handler"');
  });
});
