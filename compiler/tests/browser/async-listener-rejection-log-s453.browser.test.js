/**
 * async-listener-rejection-log-s453.browser.test.js — MOUNTED (happy-dom)
 * acceptance for bryan's S449 ruling A3 (`scrml-support/user-voice-scrml.md`
 * §S449):
 *
 *   "A3 = yes: every async event listener routes its rejection to
 *    `_scrml_error_boundary_log` (extends B5 to handlers; closes
 *    g-handler-level-rejection-bypasses-scrml-logging)"
 *
 * `addEventListener` discards a listener's return value, so an `async` listener's
 * rejection is observed by NOBODY — it leaves the page as a browser
 * `unhandledrejection`, outside scrml's logging surface. S450's #1242 made that
 * reachable from ordinary source: a nested server-call cell write is awaited IN
 * PLACE, colouring the handler `async`, so a failed call that used to reach
 * `_scrml_error_boundary_log` through emit-client's detached `(async () =>
 * …)().catch(…)` IIFE stopped reaching it.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE UNIT TEST. Grepping the emission proves a
 * `catch` arm was written; it does NOT prove the arm is on the path the browser
 * actually takes, nor that the rejection stops escaping. Here the page is
 * compiled, the SHIPPED PRUNED per-app runtime (`result.runtimeFilename`, not the
 * `SCRML_RUNTIME` monolith — primary.map.md invariant 67) is mounted with the
 * client chunk, the event is dispatched, and the log is read off `console.error`.
 * Every registration path is covered, because they are separate emitters and a
 * fix that reached only one would read green here on the others:
 *
 *   - delegated          — `document.addEventListener` + handler registry
 *   - non-delegable      — per-element `addEventListener` (Approach A)
 *   - arm-bound factory  — `armFactoryLines`, a handler reading arm/row names
 *   - `<each>` row       — emit-each `colorActiveHandler`
 *   - `for … lift` row   — emit-lift `colorActiveHandler`
 */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// `netfail()` rejects on a LATER macrotask — a transport failure, not a `!`
// envelope, so the handler's awaited call rejects rather than returning a typed
// error. That is the exact shape an adopter's offline tab produces.
let inflight = 0;
function stubFetch() {
  globalThis.fetch = async (path) => {
    inflight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      if (/netfail/.test(String(path))) throw new TypeError("network down");
      return new Response(JSON.stringify(10), { status: 200, headers: { "content-type": "application/json" } });
    } finally { inflight--; }
  };
}

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
  inflight = 0;
  stubFetch();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

// DOM-global hygiene (#1219) — put Bun's natives back for later files in the
// same `bun test` process.
const _origFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  if (_origFetch) Object.defineProperty(globalThis, "fetch", _origFetch);
  else delete globalThis.fetch;
});

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s453-rejlog-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    const consoleErrors = [];
    const escaped = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
    // A rejection that still escapes the listener lands here (and, unhandled,
    // would fail the test run outright) — so an empty `escaped` is a real
    // assertion, not an absence of evidence.
    const onRej = (e) => { escaped.push(String((e && e.reason) || e)); };
    process.on("unhandledRejection", onRej);
    let initError = null;
    try {
      new Function("window", "document",
        `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` +
        captureInsideChunkScope(rd("app.client.js"), "globalThis.__get = _scrml_reactive_get;\n"),
      )(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    } finally {
      console.error = origErr;
    }
    return {
      errs,
      initError,
      consoleErrors,
      escaped,
      runtimeJs: rd(r.runtimeFilename ?? "scrml-runtime.js"),
      clientJs: rd("app.client.js"),
      get: (n) => globalThis.__get(n),
      release: () => process.off("unhandledRejection", onRej),
      /**
       * Dispatch and settle. console.error stays captured for the WHOLE settle
       * window: the catch arm runs AFTER the awaited fetch rejects, so a capture
       * that closes at dispatch sees nothing and reads as a false negative.
       */
      fire: async (id, type) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`no element #${id}`);
        const o = console.error;
        console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
        try {
          el.dispatchEvent(new window.Event(type, { bubbles: true }));
          for (let t = 0; t < 50; t++) {
            await new Promise((r) => setTimeout(r, 20));
            if (inflight === 0) break;
          }
          await new Promise((r) => setTimeout(r, 30));
        } finally { console.error = o; }
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const PRE = `  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <x> = 0
  <y> = 0
  <c> = true
  <rows> = [{ id: 1 }]
  server function netfail() { return 1 }
`;
const program = (markup) => `<program>\n${PRE}  ${markup}\n  <p id="o">\${@x}</p>\n</program>\n`;

// A NESTED server-call write — awaited in place since #1242, which is what
// colours the listener async. The call rejects.
const H = `if (@c) { @x = netfail(); @y = 1 }`;

const CASES = [
  ["delegated (click)", `<button id="b" onclick=\${${H}}>b</button>`, "b", "click", /^onclick /],
  ["non-delegable (input)", `<input id="b" oninput=\${${H}} />`, "b", "input", /^oninput /],
  [
    "arm-bound factory (match in an <each> row, handler reads the row var)",
    `<ul><each in=@rows key=@.id as r><li><match for=Doc on=@cur><Empty><p>n</p></>` +
    `<Note(note)><button id="b" onclick=\${if (@c) { @x = netfail(); @y = r.id }}>b</button></>` +
    `</match></li></each></ul>`,
    "b", "click", /^onclick /,
  ],
  ["<each> row", `<ul><each in=@rows key=@.id as r><li><button id="b" onclick=\${${H}}>b</button></li></each></ul>`, "b", "click", /^onclick <each> row$/],
  ["for … lift row", `<ul>\${ for (r of @rows) { lift <li><button id="b" onclick=\${${H}}>b</button></li>; } }</ul>`, "b", "click", /^onclick lift row$/],
];

for (const [name, markup, id, type, idPattern] of CASES) {
  test(`S453 — an async listener's rejection reaches _scrml_error_boundary_log — ${name}`, async () => {
    const app = mount(program(markup));
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    // The listener really is async-coloured — otherwise this case proves nothing
    // about the ruling (the truncated-probe rule: a probe that resolves to a
    // different artifact than the obligation measures nothing).
    expect(app.clientJs).toContain("async function(_scrml_event)");
    // The SHIPPED pruned runtime carries the sink (the always-included `errors`
    // chunk) — checked here rather than taken from a source comment.
    expect(app.runtimeJs).toContain("function _scrml_error_boundary_log");

    await app.fire(id, type);

    const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
    // Reached EXACTLY ONCE — not zero (the gap) and not twice (a double-log).
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain("network down");
    const boundaryId = logged[0].match(/\[scrml errorBoundary ([^\]]*)\]/)[1];
    expect(boundaryId).toMatch(idPattern);
    // And the page did NOT take an unhandled rejection.
    expect(app.escaped).toEqual([]);
    app.release();
  });
}

test("S453 (fix round) — a handler with a DIRECTIVE PROLOGUE still routes its rejection", async () => {
  // The first cut of the wrap bailed on a directive prologue, which left the
  // listener `async` with no arm, no diagnostic and exit 0 — a silent hole in
  // the fix itself. The prologue now sits OUTSIDE the try. Mounted, because
  // emission-grep proves the arm was written, not that it is on the path taken.
  const app = mount(program(`<button id="b" onclick=\${"use strict"; ${H}}>b</button>`));
  expect(app.errs).toEqual([]);
  expect(app.initError).toBeNull();
  expect(app.clientJs).toMatch(/async function\(_scrml_event\) \{ "use strict"; try \{/);
  await app.fire("b", "click");
  const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
  expect(logged.length).toBe(1);
  expect(logged[0]).toContain("network down");
  expect(app.escaped).toEqual([]);
  app.release();
});

test("S453 — a handler inside an <errorBoundary> logs ONCE, and the boundary's own fallback is unchanged", async () => {
  // The boundary's `_scrml_error_boundary_log` is on the RENDER path (a logic
  // binding over `data-scrml-logic`), a disjoint emitter from an event binding.
  // A handler in the subtree must gain its own arm and not a second one, and the
  // boundary must still render its fallback on a render-path throw.
  const app = mount(program(
    `<errorBoundary fallback="oops"><button id="b" onclick=\${${H}}>b</button></errorBoundary>`,
  ));
  expect(app.errs).toEqual([]);
  expect(app.initError).toBeNull();
  await app.fire("b", "click");
  const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
  expect(logged.length).toBe(1);
  expect(logged[0]).toMatch(/\[scrml errorBoundary onclick /);
  expect(app.escaped).toEqual([]);
  app.release();
});

test("S453 — a SYNC listener is untouched: no log, and the awaited write still lands", async () => {
  // The SOLE root server-call write keeps its §13.2 fire-and-forget skip (S450,
  // S447 ruling iii), so the listener stays sync and its detached promise keeps
  // its OWN `.catch(… → _scrml_error_boundary_log)` arm. S453 must not have
  // coloured it async, and must not have added a second arm.
  const app = mount(program(`<button id="b" onclick=\${@x = netfail()}>b</button>`));
  expect(app.errs).toEqual([]);
  expect(app.clientJs).not.toContain("async function(_scrml_event)");
  await app.fire("b", "click");
  // the pre-existing detached arm logs it — once
  const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
  expect(logged.length).toBe(1);
  expect(app.escaped).toEqual([]);
  app.release();
});

test("S453 — an async listener that does NOT reject behaves exactly as before", async () => {
  // Newly-accepting check in the other direction: the try/catch must not swallow
  // or reorder the success path.
  const app = mount(
    `<program>\n  <x> = 0\n  <y> = 0\n  <c> = true\n  server function save() { return 10 }\n` +
    `  <button id="b" onclick=\${if (@c) { @x = save(); @y = @x + 1 }}>b</button>\n  <p id="o">\${@x}</p>\n</program>\n`,
  );
  expect(app.errs).toEqual([]);
  expect(app.clientJs).toContain("async function(_scrml_event)");
  await app.fire("b", "click");
  expect({ x: app.get("x"), y: app.get("y") }).toEqual({ x: 10, y: 11 });
  expect(app.consoleErrors).toEqual([]);
  expect(app.escaped).toEqual([]);
  app.release();
});
