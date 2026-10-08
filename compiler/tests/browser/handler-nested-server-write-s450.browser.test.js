/**
 * S450 (S447 ruling iii, bryan "stamp all": "keep the fire-and-forget skip only
 * when the cell write is the handler's SOLE root statement, await in place
 * everywhere else"; §13.2 auto-await, normative) — MOUNTED (happy-dom)
 * acceptance for g-handler-nested-sequence-server-write-stale-read.
 *
 * PR #1217 (S446) awaited a server-call cell write only when the HANDLER was a
 * statement list of two or more statements. A 1-statement handler whose single
 * statement holds a sequence — `${ if (@c) { @x = save(); @y = @x + 1 } }`, a
 * loop body, a block, a `match` arm, a `${() => { … }}` closure body — kept the
 * detached `(async () => …)()` write, and `@y` read the pre-fetch `@x`
 * (y = 1, expected 11). Now the skip holds only for the write that is the
 * handler's SOLE root statement (js-async-analysis `soleRootWriteCall`), for
 * every listener emitter (top-level registry, `<each>` rows, `for … lift` rows,
 * delegated match-arm handlers).
 *
 * Every case is executed: compile, mount the shipped runtime + client chunk,
 * click, let the (delayed, stubbed) fetches settle, read the cells.
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// The server call resolves on a LATER macrotask, so a statement that runs before
// the write lands observes the pre-fetch value (the defect this file pins).
let inflight = 0;
// §36 SSE: every EventSource the client opens (the test fires its onmessage).
const eventSources = [];
class StubEventSource {
  constructor(url) { this.url = url; eventSources.push(this); }
  close() {}
}
function stubFetch() {
  globalThis.EventSource = StubEventSource;
  if (globalThis.window) globalThis.window.EventSource = StubEventSource;
  globalThis.fetch = async (path) => {
    inflight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      const p = String(path);
      // A transport failure (not a `!` envelope): the call rejects.
      if (/netfail/.test(p)) throw new TypeError("network down");
      let v = 0;
      if (/save2/.test(p)) v = 20;
      else if (/save/.test(p)) v = 10;
      return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    } finally {
      inflight--;
    }
  };
}

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
  inflight = 0;
  eventSources.length = 0;
  stubFetch();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

// DOM-global hygiene (#1219): unregister happy-dom and put back the fetch /
// EventSource this file stubs, so later files in the same `bun test` process
// see Bun's natives.
const _origFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const _origEventSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  if (_origFetch) Object.defineProperty(globalThis, "fetch", _origFetch);
  else delete globalThis.fetch;
  if (_origEventSource) Object.defineProperty(globalThis, "EventSource", _origEventSource);
  else delete globalThis.EventSource;
});

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s450-hns-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    const consoleErrors = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
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
      clientJs: rd("app.client.js"),
      get: (n) => globalThis.__get(n),
      click: async (id) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`no element #${id}`);
        const origE = console.error;
        console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
        // S453 — the capture stays open across the SETTLE, not just the
        // dispatch. An async listener's rejection log (bryan's S449 ruling A3,
        // `_scrml_error_boundary_log`) fires AFTER the awaited call rejects, so
        // a capture that closed at dispatch saw nothing and read as a false
        // negative — which is how the pinned block below was once able to assert
        // "unlogged" either way.
        try {
          el.dispatchEvent(new window.Event("click", { bubbles: true }));
          // Settle: every in-flight server call has resolved (bounded).
          for (let t = 0; t < 50; t++) {
            await new Promise((r) => setTimeout(r, 20));
            if (inflight === 0) break;
          }
          await new Promise((r) => setTimeout(r, 20));
        } finally { console.error = origE; }
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const PRE = `  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("hi")
  <x> = 0
  <x2> = 0
  <y> = 0
  <c> = true
  <n> = 2
  <feed> = 0
  <rows> = [{ id: 1 }]
  server function save() { return 10 }
  server function save2() { return 20 }
  server function netfail() { return 1 }
  server function* ticks() {
    let i = 0
    while (i < 3) {
      yield i
      i = i + 1
    }
  }
`;
const each = (btn) => `<ul><each in=@rows key=@.id as r><li>${btn}</li></each></ul>`;
const lift = (btn) => `<ul>\${ for (r of @rows) { lift <li>${btn}</li>; } }</ul>`;
const arm = (inner) => `<div><match for=Doc on=@cur><Empty><p>none</p></><Note(note)>${inner}</></match></div>`;
const POSITIONS = {
  "top level": (b) => b,
  "<each>": each,
  "for … lift": lift,
  "match arm": (b) => arm(b),
  "<each> in a match arm": (b) => arm(each(b)),
  "for … lift in a match arm": (b) => arm(lift(b)),
};
// `<each>` / `for … lift` rows emit a `${() => {…}}` closure as a never-invoked
// expression statement (g-each-block-arrow-handler-never-runs, separate gap) —
// the closure case runs only where the closure IS the listener.
const CLOSURE_POSITIONS = new Set(["top level", "match arm"]);

const program = (pos, handler) => {
  const btn = `<button id="b" onclick=\${${handler}}>b</button>`;
  return `<program>\n${PRE}  ${POSITIONS[pos](btn)}\n  <p id="o">\${@x}</p>\n</program>\n`;
};

// [name, handler, expected cells, closure-only?]
const NESTED = [
  ["inside an `if` body", "if (@c) { @x = save(); @y = @x + 1 }", { x: 10, y: 11 }],
  ["inside the `else if` limb of an if / else-if / else chain",
    "if (!@c) { @y = 0 } else if (@c) { @x = save(); @y = @x + 1 } else { @y = 5 }", { x: 10, y: 11 }],
  ["inside the `else` limb of an if / else chain",
    "if (!@c) { @y = 0 } else { @x = save(); @y = @x + 1 }", { x: 10, y: 11 }],
  ["inside a `for` body", "for (let i = 0; i < 1; i++) { @x = save(); @y = @x + 1 }", { x: 10, y: 11 }],
  ["inside a `for … of` body", "for (const k of [1]) { @x = save(); @y = @x + k }", { x: 10, y: 11 }],
  ["inside a `while` body", "while (@n > 1) { @x = save(); @y = @x + 1; @n = 1 }", { x: 10, y: 11, n: 1 }],
  ["inside a nested block", "{ @x = save(); @y = @x + 1 }", { x: 10, y: 11 }],
  ["inside a `match` arm", "match (@cur) { .Note(t) => { @x = save(); @y = @x + 1 } .Empty => { @y = 0 } }", { x: 10, y: 11 }],
  ["three levels deep (if › for › if)",
    "if (@c) { for (let i = 0; i < 1; i++) { if (@c) { @x = save(); @y = @x + 1 } } }", { x: 10, y: 11 }],
  ["two nested server writes in sequence", "if (@c) { @x = save(); @x2 = save2(); @y = @x + @x2 }", { x: 10, x2: 20, y: 30 }],
  ["a nested sole write, then the handler ends", "if (@c) { @x = save() }", { x: 10 }],
  ["inside a `${() => { … }}` closure handler body", "() => { @x = save(); @y = @x + 1 }", { x: 10, y: 11 }, true],
];

for (const pos of Object.keys(POSITIONS)) {
  describe(`S450 — a nested server-call write in a handler is awaited before the next statement — ${pos}`, () => {
    for (const [name, handler, want, closureOnly] of NESTED) {
      if (closureOnly && !CLOSURE_POSITIONS.has(pos)) continue;
      test(name, async () => {
        const app = mount(program(pos, handler));
        expect(app.errs).toEqual([]);
        expect(app.initError).toBeNull();
        await app.click("b");
        const got = {};
        for (const k of Object.keys(want)) got[k] = app.get(k);
        expect(got).toEqual(want);
        expect(app.consoleErrors).toEqual([]);
      });
    }
    test("a two-root-statement list stays ordered (PR #1217)", async () => {
      const app = mount(program(pos, "@x = save(); @y = @x + 1"));
      expect(app.errs).toEqual([]);
      await app.click("b");
      expect({ x: app.get("x"), y: app.get("y") }).toEqual({ x: 10, y: 11 });
    });
    test("the SOLE root statement write still lands (fire-and-forget)", async () => {
      const app = mount(program(pos, "@x = save()"));
      expect(app.errs).toEqual([]);
      await app.click("b");
      expect(app.get("x")).toBe(10);
    });
    test("a nested §36 SSE write keeps its subscription (never awaited)", async () => {
      const app = mount(program(pos, "if (@c) { @feed = ticks() }"));
      expect(app.errs).toEqual([]);
      await app.click("b");
      expect(eventSources.length).toBe(1);
      expect(typeof eventSources[0].onmessage).toBe("function");
      eventSources[0].onmessage({ data: "42" });
      expect(app.get("feed")).toBe(42);
    });
  });
}

// The sole-root-statement write keeps its emit byte-for-byte: no `async`
// listener, the detached IIFE write and its error-boundary `.catch`.
const lineOf = (js) => js.split("\n").find((l) => /addEventListener\("click"|_scrml_attr_onclick/.test(l) && /save/.test(l));
describe("S450 — emit pins", () => {
  for (const pos of Object.keys(POSITIONS)) {
    test(`${pos}: \`\${@x = save()}\` keeps the fire-and-forget emit`, () => {
      const app = mount(program(pos, "@x = save()"));
      expect(app.errs).toEqual([]);
      expect(app.clientJs).not.toMatch(/async function\(_scrml_event\)/);
      expect(app.clientJs).toMatch(/function\(_scrml_event\) \{ (?:[^\n]*; )?\(async \(\) => _scrml_cs_reactive_set\("x", await _scrml_fetch_save_/);
      expect(app.clientJs).toContain('.catch(_scrml_async_err => _scrml_error_boundary_log("x", _scrml_async_err))');
    });
  }
  test("top level: the braced single-statement inline block `{@x = save()}` keeps the fire-and-forget emit", () => {
    const src = `<program>\n${PRE}  <button id="b" onclick={@x = save()}>b</button>\n</program>\n`;
    const app = mount(src);
    expect(app.errs).toEqual([]);
    const line = lineOf(app.clientJs);
    expect(line).toBeDefined();
    expect(line).toContain(': function(_scrml_event) { (async () => _scrml_cs_reactive_set("x", await _scrml_fetch_save_');
  });
  test("top level: a write nested in an `if` is awaited in place in an `async` listener", () => {
    const app = mount(program("top level", "if (@c) { @x = save(); @y = @x + 1 }"));
    expect(app.errs).toEqual([]);
    // S453 — `try {` now opens the async listener's body (bryan S449 ruling A3,
    // the rejection log). What this pin is FOR is the await-in-place, which is
    // unchanged; the `try {` is threaded through so the pin still bites on the
    // thing it pins.
    expect(app.clientJs).toMatch(/: async function\(_scrml_event\) \{ try \{ if \(/);
    expect(app.clientJs).toContain('_scrml_cs_reactive_set("x", await _scrml_fetch_save_');
    expect(app.clientJs).not.toContain('(async () => _scrml_cs_reactive_set("x"');
  });
  test("top level: a `match` arm write — the arm IIFE is made async and awaited in place", () => {
    const app = mount(program("top level", "match (@cur) { .Note(t) => { @x = save(); @y = @x + 1 } .Empty => { @y = 0 } }"));
    expect(app.errs).toEqual([]);
    // S453 — `try {` as above; the arm IIFE being async + awaited is the pin.
    expect(app.clientJs).toMatch(/: async function\(_scrml_event\) \{ try \{ await \(async function\(\) \{/);
  });
  test("a write inside a callback handed to a scheduler is not in the handler's sequence — unchanged", () => {
    const app = mount(program("top level", "setTimeout(() => { @x = save() }, 0)"));
    expect(app.errs).toEqual([]);
    expect(app.clientJs).toContain('(async () => _scrml_cs_reactive_set("x", await _scrml_fetch_save_');
  });
});

// S450 review F1 — WAS DISCLOSED-NOT-FIXED, now CLOSED by S453.
//
// ⛑ THE PIN IS FLIPPED, WHICH IS WHAT IT WAS FOR. S450 left this block asserting the
// then-current behaviour — a newly-awaited write whose server call REJECTS escaped the
// `async` listener unobserved and never reached `_scrml_error_boundary_log` — with the
// stated purpose that "a future fix (a handler-level backstop) shows up here as a
// deliberate change". bryan RULED that fix in S449 (ruling A3, `user-voice-scrml.md`:
// *"every async event listener routes its rejection to `_scrml_error_boundary_log`"*,
// closing `g-handler-level-rejection-bypasses-scrml-logging`), and S453 built it in
// `js-async-analysis.ts:colorAsyncFunctionExpr`. So the three assertions invert:
//   * the promise the listener returns now RESOLVES (the body's try/catch absorbed it)
//     instead of rejecting with "network down";
//   * `_scrml_error_boundary_log` IS reached, exactly once;
// and one is UNCHANGED, deliberately:
//   * `@y` is still 0 — the statements after the failed write still do not run, which is
//     function-body semantics (§13.2) and NOT what A3 changed. S453 logs the rejection;
//     it does not resume the handler.
// The acceptance for the ruling across every registration path lives in
// `async-listener-rejection-log-s453.browser.test.js`; this block stays because it is
// the S450 shape that widened the gap, measured in the file that widened it.
//
// Observed on an `<each>` row, whose listener is attached directly with
// addEventListener: the test wraps addEventListener to hold the promise the listener
// returns (the browser discards it) so the settled state of that promise is readable.
describe("S453 — a rejecting nested write is logged, not escaped (bryan S449 ruling A3)", () => {
  const SHAPES = [
    ["nested in an `if`", "if (@c) { @x = netfail(); @y = 5 }"],
    ["nested in a `match` arm", "match (@cur) { .Note(t) => { @x = netfail(); @y = 5 } .Empty => { @y = 0 } }"],
  ];
  for (const [name, handler] of SHAPES) {
    test(name, async () => {
      const returned = [];
      const proto = window.HTMLElement.prototype;
      const hadOwn = Object.prototype.hasOwnProperty.call(proto, "addEventListener");
      const orig = proto.addEventListener;
      proto.addEventListener = function (type, fn, opts) {
        if (type !== "click" || typeof fn !== "function") return orig.call(this, type, fn, opts);
        return orig.call(this, type, function (ev) {
          const r = fn.call(this, ev);
          if (r && typeof r.then === "function") returned.push(r.then(() => "resolved", (e) => e));
          return r;
        }, opts);
      };
      try {
        const app = mount(program("<each>", handler));
        expect(app.errs).toEqual([]);
        await app.click("b");
        // The listener is still async and still returns a promise — but it no
        // longer rejects: nothing escapes to the host.
        expect(returned.length).toBe(1);
        expect(String(await returned[0])).toBe("resolved");
        const logged = app.consoleErrors.filter((l) => l.includes("scrml errorBoundary"));
        expect(logged.length).toBe(1);
        expect(logged[0]).toContain("network down");
        expect(logged[0]).toContain("onclick <each> row");
        expect(app.get("y")).toBe(0); // UNCHANGED: the statement after the failed write still does not run
      } finally {
        if (hadOwn) proto.addEventListener = orig;
        else delete proto.addEventListener;
      }
    });
  }
});

// S450 review F2 — newly REJECTED (correct under s441's E-EVENT-CONTROL-AFTER-AWAIT):
// the nested write is now awaited, so an event-control call after it in the handler
// runs after the first await. Corpus exposure: 0.
describe("S450 — event control after a nested awaited write is E-EVENT-CONTROL-AFTER-AWAIT", () => {
  // s457 3a — a handler that uses the event takes it as a parameter (E-EVENT-UNBOUND otherwise).
  test("`${(event) => { if (@c) { @x = save(); event.preventDefault() } }}`", () => {
    const app = mount(program("top level", "(event) => { if (@c) { @x = save(); event.preventDefault() } }"));
    expect(app.errs).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("closure form `${(e) => { if (@c) { @x = save(); e.preventDefault() } }}`", () => {
    const app = mount(program("top level", "(e) => { if (@c) { @x = save(); e.preventDefault() } }"));
    expect(app.errs).toContain("E-EVENT-CONTROL-AFTER-AWAIT");
  });
  test("control BEFORE the write stays legal", () => {
    const app = mount(program("top level", "(event) => { if (@c) { event.preventDefault(); @x = save(); @y = @x + 1 } }"));
    expect(app.errs).toEqual([]);
  });
});
