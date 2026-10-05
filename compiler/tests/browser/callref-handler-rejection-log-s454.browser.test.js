/**
 * callref-handler-rejection-log-s454.browser.test.js — MOUNTED (happy-dom)
 * acceptance for bryan's S454 ruling (`scrml-support/user-voice-scrml.md` §S454):
 *
 *   "a yes, b yes, root fix"
 *
 * Every event-handler rejection reaches the §19.6.8 logging surface, whatever the
 * handler's form. The emission proofs are in
 * `compiler/tests/unit/s454-callref-handler-rejection.test.js`; this file proves
 * the arm is on the path the browser takes:
 *
 *   1. a rejected server call inside a CALL-REF handler's callee reaches
 *      `_scrml_error_boundary_log` exactly once and does NOT surface as an
 *      unhandled rejection — on every call-ref registration path;
 *   2. TIMING — the listener is now `async`, and an async function runs
 *      synchronously up to its first `await`, so an `event.preventDefault()` in
 *      the callee's synchronous prefix (and the auto-injected submit one) has
 *      taken effect by the time `dispatchEvent` returns. Executed, including a
 *      control proving the probe can see a late preventDefault;
 *   3. B-2 — an async `<errorBoundary>` render with no `fallback=` logs its
 *      failure once and no longer leaks an unhandled rejection.
 *
 * Conventions copied from async-listener-rejection-log-s453.browser.test.js,
 * including its B-5 lesson: console.error stays captured until the awaited
 * rejection has SETTLED — a capture that closes at dispatch reads as a false
 * negative.
 */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// `netfail()` rejects on a LATER macrotask — a transport failure, not a `!`
// envelope — the shape an adopter's offline tab produces.
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

// DOM-global hygiene (#1219) — put Bun's natives back for later files.
const _origFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  if (_origFetch) Object.defineProperty(globalThis, "fetch", _origFetch);
  else delete globalThis.fetch;
});

async function settle() {
  for (let t = 0; t < 50; t++) {
    await new Promise((r) => setTimeout(r, 20));
    if (inflight === 0) break;
  }
  await new Promise((r) => setTimeout(r, 30));
}

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s454-rejlog-"));
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
    // A rejection that still escapes lands here, so an empty `escaped` is a
    // real assertion, not an absence of evidence.
    const onRej = (e) => { escaped.push(String((e && e.reason) || e)); };
    process.on("unhandledRejection", onRej);
    const capture = () => {
      const o = console.error;
      console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
      return () => { console.error = o; };
    };
    let initError = null;
    const clientJs = rd("app.client.js");
    const runtimeJs = rd(r.runtimeFilename ?? "scrml-runtime.js");
    return {
      errs,
      clientJs,
      runtimeJs,
      consoleErrors,
      escaped,
      get initError() { return initError; },
      /** Boot the page; console.error captured through `settle()` (render-time logs). */
      boot: async () => {
        const restore = capture();
        try {
          new Function("window", "document",
            `${runtimeJs}\n` + captureInsideChunkScope(clientJs, "globalThis.__get = _scrml_reactive_get;\n"),
          )(globalThis.window, globalThis.document);
          document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
          await settle();
        } catch (e) {
          initError = e;
        } finally { restore(); }
      },
      get: (n) => globalThis.__get(n),
      release: () => process.off("unhandledRejection", onRej),
      /**
       * Dispatch a CANCELABLE event and settle; returns `defaultPrevented` as
       * observed SYNCHRONOUSLY at the return of dispatchEvent — the moment the
       * browser decides whether to run the default action.
       */
      fire: async (id, type, Ctor = "Event") => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`no element #${id}`);
        const restore = capture();
        try {
          const ev = new window[Ctor](type, { bubbles: true, cancelable: true });
          el.dispatchEvent(ev);
          const preventedAtDispatch = ev.defaultPrevented;
          await settle();
          return { preventedAtDispatch };
        } finally { restore(); }
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const PRE = `  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <x> = 0
  <after> = "not-run"
  <rows> = [{ id: 1 }]
  server function netfail() { return 1 }
  function go() {
    const a = netfail()
    @x = a
    @after = "ran"
  }
  function goArg(n: number) {
    const a = netfail()
    @x = a + n
    @after = "ran"
  }
`;
const program = (markup, pre = PRE) => `<program>\n${pre}  ${markup}\n  <p id="o">\${@x} \${@after}</p>\n</program>\n`;

const CASES = [
  ["delegated (click)", `<button id="b" onclick=go()>b</button>`, "click", /^onclick _scrml_attr_onclick_\d+$/],
  ["delegated with a literal arg (onclick=fn(1))", `<button id="b" onclick=goArg(1)>b</button>`, "click", /^onclick /],
  ["non-delegable (input)", `<input id="b" oninput=go() />`, "input", /^oninput /],
  ["non-delegable (change)", `<select id="b" onchange=go()><option>a</option></select>`, "change", /^onchange /],
  ["submit", `<form id="b" onsubmit=go()><button>go</button></form>`, "submit", /^onsubmit /],
  ["match arm (page-level registry)", `<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><button id="b" onclick=go()>b</button></></match>`, "click", /^onclick /],
  ["arm-bound factory (reads a payload binding)", `<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><button id="b" onclick=goArg(note.length)>b</button></></match>`, "click", /^onclick /],
  ["in-arm non-delegable (emit-variant-guard)", `<match for=Doc on=@cur><Empty><p>n</p></><Note(note)><input id="b" oninput=go() /></></match>`, "input", /^oninput /],
  ["bare-ref (onclick=handler)", `<button id="b" onclick=go>b</button>`, "click", /^onclick /],
  ["<each> row", `<ul><each in=@rows key=@.id as r><li><button id="b" onclick=go()>b</button></li></each></ul>`, "click", /^onclick <each> row$/],
  ["for … lift row", `<ul>\${ for (r of @rows) { lift <li><button id="b" onclick=go()>b</button></li>; } }</ul>`, "click", /^onclick lift row$/],
];

for (const [name, markup, type, idPattern] of CASES) {
  test(`S454 — a call-ref handler's rejected server call reaches _scrml_error_boundary_log — ${name}`, async () => {
    const app = mount(program(markup));
    expect(app.errs).toEqual([]);
    await app.boot();
    expect(app.initError).toBeNull();
    expect(app.runtimeJs).toContain("function _scrml_error_boundary_log");

    await app.fire("b", type);

    const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
    // EXACTLY once — not zero (the gap) and not twice (a double-log)
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain("network down");
    expect(logged[0].match(/\[scrml errorBoundary ([^\]]*)\]/)[1]).toMatch(idPattern);
    // the page took no unhandled rejection
    expect(app.escaped).toEqual([]);
    // statements after the failing call did not run (§13.2, unchanged by S454)
    expect(app.get("after")).toBe("not-run");
    app.release();
  });
}

test("S454 — the PA's reproducer (s441 handler-rejection-bypasses-logging.scrml) now logs", async () => {
  const src = readFileSync(
    resolve(import.meta.dir, "../../../docs/changes/s441-audit-gap-filing/repro/handler-rejection-bypasses-logging.scrml"),
    "utf8",
  ).replace(/^\/\/.*\n/gm, "");
  const app = mount(src);
  expect(app.errs).toEqual([]);
  expect(app.clientJs).toMatch(/async function\(event\) \{ try \{ await _scrml_go2_\d+\(\); \}/);
  app.release();
});

test("S454 — a SUCCESSFUL call-ref handler behaves exactly as before", async () => {
  const pre = `  <x> = 0\n  <after> = "not-run"\n  server function save() { return 10 }\n` +
    `  function go() {\n    const a = save()\n    @x = a\n    @after = "ran"\n  }\n`;
  const app = mount(program(`<button id="b" onclick=go()>b</button>`, pre));
  expect(app.errs).toEqual([]);
  await app.boot();
  await app.fire("b", "click");
  expect({ x: app.get("x"), after: app.get("after") }).toEqual({ x: 10, after: "ran" });
  expect(app.consoleErrors).toEqual([]);
  expect(app.escaped).toEqual([]);
  app.release();
});

// ---------------------------------------------------------------------------
// TIMING — preventDefault in the synchronous prefix still prevents the default.
// ---------------------------------------------------------------------------

test("control — the probe CAN see a late preventDefault (after an await)", async () => {
  // Without this, a `true` below could be an artifact of the harness. A
  // listener that calls preventDefault after a microtask must read FALSE at
  // dispatch return.
  document.body.innerHTML = `<a id="c" href="#x">c</a>`;
  const el = document.getElementById("c");
  el.addEventListener("click", async (e) => { await 0; e.preventDefault(); });
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
  await new Promise((r) => setTimeout(r, 5));
  expect(ev.defaultPrevented).toBe(true); // it did run — just too late
});

const EV_PRE = `  <x> = 0
  <after> = "not-run"
  server function netfail() { return 1 }
  function goEv(e) {
    e.preventDefault()
    const a = netfail()
    @x = a
    @after = "ran"
  }
`;

for (const [name, markup, id, type, Ctor] of [
  ["call-ref callee calls event.preventDefault() before its server call", `<a id="l" href="#x" onclick=goEv(event)>l</a>`, "l", "click", "MouseEvent"],
  ["bare-ref handler calls event.preventDefault() before its server call", `<a id="l" href="#x" onclick=goEv>l</a>`, "l", "click", "MouseEvent"],
  ["submit — the auto-injected preventDefault()", `<form id="f" onsubmit=goEv(event)><button>go</button></form>`, "f", "submit", "Event"],
]) {
  test(`S454 timing — ${name}: default prevented at dispatch return`, async () => {
    const app = mount(program(markup, EV_PRE));
    expect(app.errs).toEqual([]);
    // the listener really is async — otherwise this proves nothing about S454
    expect(app.clientJs).toMatch(/async function\(event\) \{ try \{/);
    await app.boot();
    const { preventedAtDispatch } = await app.fire(id, type, Ctor);
    expect(preventedAtDispatch).toBe(true);
    // and the rejection that followed was logged, once, and did not escape
    const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
    expect(logged.length).toBe(1);
    expect(app.escaped).toEqual([]);
    app.release();
  });
}

// ---------------------------------------------------------------------------
// B-2 — async <errorBoundary> with no fallback=.
//
// ⚠ impl#1 ALSO emits a render-time server call as a stray, unobserved
// module-level statement (`_scrml_fetch_load_4();` right after the cell inits)
// — a symptom of the carried g-impl1-value-server-call-s451 (a render-time
// server call is E-VALUE-SERVER-CALL in the language, §13.7, and impl#1 accepts
// it). That stray call is neither a boundary nor a handler and is OUT of S454's
// scope; so the stub lets the FIRST call succeed (the stray one, at module
// evaluation) and fails only the boundary's own render call, made at boot.
// Without that, the stray rejection would be the only thing measured.
// ---------------------------------------------------------------------------

function failAfterFirst(errMsg) {
  let calls = 0;
  globalThis.fetch = async () => {
    inflight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      calls++;
      if (calls > 1) throw new TypeError(errMsg);
      return new Response(JSON.stringify(10), { status: 200, headers: { "content-type": "application/json" } });
    } finally { inflight--; }
  };
}

test("S454 B-2 — an async <errorBoundary> render failure with no fallback is logged once and does not escape", async () => {
  const pre = `  <x> = 0\n  server function load() { return 1 }\n`;
  const app = mount(`<program>\n${pre}  <errorBoundary><p id="q">\${load()}</p></errorBoundary>\n</program>\n`);
  expect(app.clientJs).toMatch(/async function _eb_render_/);
  failAfterFirst("render call failed");
  await app.boot();
  expect(app.initError).toBeNull();
  const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
  // logged by the body's own catch arm — and NOT a second time by the call-site arm
  expect(logged.length).toBe(1);
  expect(logged[0]).toContain("render call failed");
  expect(app.escaped).toEqual([]);
  app.release();
});

test("S454 B-2 — a rejection the render body did NOT log (a throwing DOM write) is logged by the call-site arm", async () => {
  // The body logs its own catch arm; anything thrown after it (here: the
  // success-path DOM write, made to throw) is the call-site `.catch`'s job.
  const pre = `  <x> = 0\n  server function save() { return 10 }\n`;
  const app = mount(`<program>\n${pre}  <errorBoundary><p id="q">\${save()}</p></errorBoundary>\n</program>\n`);
  // make the boundary slot's textContent write throw
  const slot = document.querySelector("[data-scrml-logic]");
  expect(slot).not.toBeNull();
  Object.defineProperty(slot, "textContent", {
    configurable: true,
    get() { return ""; },
    set() { throw new Error("dom write failed"); },
  });
  await app.boot();
  expect(app.initError).toBeNull();
  const logged = app.consoleErrors.filter((m) => m.includes("[scrml errorBoundary"));
  expect(logged.length).toBe(1);
  expect(logged[0]).toContain("dom write failed");
  expect(app.escaped).toEqual([]);
  app.release();
});
