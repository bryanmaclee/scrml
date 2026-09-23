/**
 * each-replaced-row-in-place-edits.browser.test.js
 * g-each-replaced-row-stops-receiving-in-place-edits (S429, HIGH, silent).
 *
 * After a same-key replace gave a row a NEW object, in-place edits to that row
 * changed state but never reached the DOM; unchanged rows kept updating; no
 * error. Repro: .map replace of row 1, then `for (const g of @groups) g.name += "!"`
 * twice -> DOM "Rone! two!!!", state "Rone!!! two!!!".
 *
 * Root cause (traced, NOT the per-item effect): _scrml_reactive_set stored the
 * value it was handed. Codegen wraps a cell write in _scrml_deep_reactive only
 * when the right-hand side is syntactically a literal, so every COMPUTED write
 * (.map / .filter / spread / the _scrml_deep_set clone behind @xs[i] = v and
 * @xs[i].f = v, and the array a push / splice then mutates) stored a RAW array
 * whose fresh row objects were raw. The per-item effect DID re-resolve by key
 * and subscribe to the new object; the edit went through the raw object, missed
 * the Proxy set trap, and fired nothing. Fix: the runtime wraps plain
 * arrays / objects at the cell write (_scrml_cell_value).
 *
 * Every mutation here goes through a COMPILED handler (a button click) — never
 * a test-side set — because a test-side _scrml_deep_reactive wrap is exactly
 * what masked this class in the existing suites.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

// Instrument the shipped runtime to count LIVE (target, prop) -> effect
// subscriptions, so a replace cycle that leaks shows up as a growing number.
function instrument(runtimeJs) {
  const swap = (s, from, to) => {
    if (!s.includes(from)) throw new Error("instrument target missing: " + from);
    return s.split(from).join(to);
  };
  let out = swap(runtimeJs, "propMap.get(prop).add(effectFn);",
    "{ const __s = propMap.get(prop); if (!__s.has(effectFn)) globalThis.__liveSubs++; __s.add(effectFn); }");
  out = swap(out, "if (effects) effects.delete(effectFn);",
    "if (effects && effects.delete(effectFn)) globalThis.__liveSubs--;");
  return out;
}

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "each-replaced-row-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    const consoleErrors = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
    globalThis.__liveSubs = 0;
    globalThis.__sinked = [];
    window.__sink = (v) => globalThis.__sinked.push(v);
    let initError = null;
    try {
      new Function("window", "document",
        `${instrument(rd(r.runtimeFilename ?? "scrml-runtime.js"))}\n` +
        captureInsideChunkScope(rd("app.client.js"), "globalThis.__get = _scrml_reactive_get;\n"),
      )(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    }
    const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return {
      errs,
      get initError() { return initError; },
      consoleErrors,
      restoreConsole: () => { console.error = origErr; },
      get: (n) => globalThis.__get(n),
      q: (sel) => document.querySelector(sel),
      qa: (sel) => [...document.querySelectorAll(sel)],
      press: (id) => click(document.getElementById(id)),
      click,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. The gap's own repro, verbatim.
// ---------------------------------------------------------------------------

const GAP = `<program>
  <groups> = [{ id: 1, name: "one" }, { id: 2, name: "two" }]
  function rs() { @groups = @groups.map(g => g.id == 1 ? { id: 1, name: "R" + g.name } : g) }
  function ra() { for (const g of @groups) { g.name = g.name + "!" } }
  <ul>
    <each in=@groups key=@.id as g>
      <li>\${g.name}</li>
    </each>
  </ul>
  <button id="rs" onclick=rs()>.</button>
  <button id="ra" onclick=ra()>.</button>
</program>
`;

describe("g-each-replaced-row-stops-receiving-in-place-edits — the gap repro", () => {
  test("ra, rs, ra, ra: the replaced row keeps receiving in-place edits (was DOM 'Rone! two!!!' vs state 'Rone!!! two!!!')", () => {
    const app = mount(GAP);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      const lis = () => app.qa("li").map((l) => l.textContent.trim());
      app.press("ra");
      expect(lis()).toEqual(["one!", "two!"]);
      app.press("rs");
      expect(lis()).toEqual(["Rone!", "two!"]);
      app.press("ra");
      app.press("ra");
      expect(app.get("groups").map((g) => g.name)).toEqual(["Rone!!!", "two!!!"]);
      expect(lis()).toEqual(["Rone!!!", "two!!!"]);
      expect(app.consoleErrors).toEqual([]);
    } finally { app.restoreConsole(); }
  });
});

// ---------------------------------------------------------------------------
// 2. Every path that gives a key-stable row a new object, × every per-item
//    binding kind: text, a nested field (g.meta.x), a value attribute, class:,
//    and a delegated event-handler closure.
// ---------------------------------------------------------------------------

const PATHS = `<program>
  <groups> = [{ id: 1, name: "one", meta: { x: 1 } }, { id: 2, name: "two", meta: { x: 2 } }]
  function rs() { @groups = @groups.map(g => g.id == 1 ? { id: 1, name: "M", meta: { x: 10 } } : g) }
  function sp() { const o = { id: 1, name: "S", meta: { x: 20 } }
    @groups.splice(0, 1, o) }
  function ix() { @groups[0] = { id: 1, name: "I", meta: { x: 30 } } }
  function fr() { @groups = @groups.map(g => ({ id: g.id, name: "F" + g.id, meta: { x: 40 } })) }
  function ro() { @groups = @groups.map(g => g.id == 1 ? { id: 1, name: "O", meta: { x: 50 } } : g).reverse() }
  function pu() { const o = { id: 3, name: "three", meta: { x: 3 } }
    @groups.push(o) }
  function fw() { @groups[0].name = "W" }
  function ra() { for (const g of @groups) { g.name = g.name + "!"; g.meta.x = g.meta.x + 1 } }
  <ul>
    <each in=@groups key=@.id as g>
      <li data-x=\${g.meta.x} class:hot=\${g.name.length > 3} onclick=\${ window.__sink(g.name) }>\${g.name}|\${g.meta.x}</li>
    </each>
  </ul>
  <button id="rs" onclick=rs()>.</button>
  <button id="sp" onclick=sp()>.</button>
  <button id="ix" onclick=ix()>.</button>
  <button id="fr" onclick=fr()>.</button>
  <button id="ro" onclick=ro()>.</button>
  <button id="pu" onclick=pu()>.</button>
  <button id="fw" onclick=fw()>.</button>
  <button id="ra" onclick=ra()>.</button>
</program>
`;

// What the DOM of every row SHOULD show, computed from state.
const expectedRows = (app) => app.get("groups").map((g) => ({
  text: `${g.name}|${g.meta.x}`, x: String(g.meta.x), hot: g.name.length > 3,
}));
const domRows = (app) => app.qa("li").map((l) => ({
  text: l.textContent.trim(), x: l.getAttribute("data-x"), hot: l.classList.contains("hot"),
}));

describe("every replace path × every per-item binding kind", () => {
  const cases = [
    ["rs", ".map replace of one row", ["M!!", "two!!"]],
    ["sp", "splice(i, 1, newObj)", ["S!!", "two!!"]],
    ["ix", "index assignment @groups[0] = {…}", ["I!!", "two!!"]],
    ["fr", "full reassign that keeps every key (all new objects)", ["F1!!", "F2!!"]],
    ["ro", "replace then reorder", ["two!!", "O!!"]],
    ["pu", "push of a new row", ["one!!", "two!!", "three!!"]],
    ["fw", "nested field write @groups[0].name = x (a _scrml_deep_set clone)", ["W!!", "two!!"]],
  ];
  for (const [id, label, names] of cases) {
    test(`${label}: text, nested field, attribute, class: and handler closure all follow the NEW object`, () => {
      const app = mount(PATHS);
      try {
        expect(app.errs).toEqual([]);
        expect(app.initError).toBeNull();
        app.press(id);
        app.press("ra");
        app.press("ra");
        expect(app.get("groups").map((g) => g.name)).toEqual(names);
        // text + nested field + data-x attribute + class:hot, for every row
        expect(domRows(app)).toEqual(expectedRows(app));
        // the delegated handler closure reads the NEW object
        globalThis.__sinked = [];
        for (const li of app.qa("li")) app.click(li);
        expect(globalThis.__sinked).toEqual(names);
        expect(app.consoleErrors).toEqual([]);
      } finally { app.restoreConsole(); }
    });
  }

  test("all paths chained on one list, with in-place edits between each", () => {
    const app = mount(PATHS);
    try {
      for (const id of ["rs", "sp", "ix", "fr", "ro", "pu", "fw"]) {
        app.press(id);
        app.press("ra");
        expect({ id, rows: domRows(app) }).toEqual({ id, rows: expectedRows(app) });
      }
      expect(app.consoleErrors).toEqual([]);
    } finally { app.restoreConsole(); }
  });
});

// ---------------------------------------------------------------------------
// 3. A row hosting a <match> arm that reads the row (#1033's
//    prepareRowScopedArms path), a nested <each> over a row field, and a
//    handler that WRITES through the row.
// ---------------------------------------------------------------------------

const RICH = `<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one", tags: [{ t: "x" }] }, { id: 2, kind: Kind.B, name: "two", tags: [{ t: "y" }] }]
  function rs() { @groups = @groups.map(g => g.id == 1 ? { id: 1, kind: Kind.A, name: "M", tags: [{ t: "m" }] } : g) }
  function ra() { for (const g of @groups) { g.name = g.name + "!"; g.tags[0].t = g.tags[0].t + "+" } }
  function bump(r) { r.name = r.name + "*" }
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=Kind on=g.kind>
          <A><p class="a">A:\${g.name}</p></>
          <B><p class="b">B:\${g.name}</p></>
        </match>
        <each in=g.tags key=@.t as tg><span class="tag">\${tg.t}</span></each>
        <button class="bump" onclick=bump(g)>b</button>
      </li>
    </each>
  </ul>
  <button id="rs" onclick=rs()>.</button>
  <button id="ra" onclick=ra()>.</button>
</program>
`;

describe("replaced row hosting a <match> arm, a nested <each>, and a writing handler", () => {
  test("after a same-key replace, arm text, nested-each rows and a handler write all track the NEW object", () => {
    const app = mount(RICH);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      const rows = () => app.qa("li.row").map((l) => [...l.querySelectorAll("p,span.tag")].map((e) => e.textContent.trim()).join("/"));
      expect(rows()).toEqual(["A:one/x", "B:two/y"]);
      app.press("rs");
      expect(rows()).toEqual(["A:M/m", "B:two/y"]);
      app.press("ra");
      expect(rows()).toEqual(["A:M!/m+", "B:two!/y+"]);
      app.click(app.qa("button.bump")[0]);
      expect(rows()).toEqual(["A:M!*/m+", "B:two!/y+"]);
      app.press("ra");
      expect(rows()).toEqual(["A:M!*!/m++", "B:two!!/y++"]);
      expect(app.get("groups")[0].name).toBe("M!*!");
      expect(app.consoleErrors).toEqual([]);
    } finally { app.restoreConsole(); }
  });
});

// ---------------------------------------------------------------------------
// 4. The OLD object is released: a write to it after the replace neither
//    updates the DOM nor throws, and replace cycles do not grow the live
//    subscription count.
// ---------------------------------------------------------------------------

describe("the replaced (detached) object is released", () => {
  test("a write to the OLD row object after a replace does not reach the DOM and does not throw", () => {
    const app = mount(GAP);
    try {
      const old = app.get("groups")[0];
      app.press("rs");
      const before = app.qa("li").map((l) => l.textContent.trim());
      expect(before).toEqual(["Rone", "two"]);
      expect(() => { old.name = "STALE"; }).not.toThrow();
      expect(app.qa("li").map((l) => l.textContent.trim())).toEqual(before);
      expect(app.consoleErrors).toEqual([]);
    } finally { app.restoreConsole(); }
  });

  test("50 replace+edit cycles leave the live subscription count unchanged", () => {
    const app = mount(GAP);
    try {
      app.press("rs");
      app.press("ra");
      const base = globalThis.__liveSubs;
      expect(base).toBeGreaterThan(0);
      for (let i = 0; i < 50; i++) { app.press("rs"); app.press("ra"); }
      expect(globalThis.__liveSubs).toBe(base);
      expect(app.qa("li").map((l) => l.textContent.trim())).toEqual(app.get("groups").map((g) => g.name));
    } finally { app.restoreConsole(); }
  });
});

// ---------------------------------------------------------------------------
// 5. Values the cell write must NOT wrap keep working when they arrive through
//    a computed write (a Proxy would break a Date's methods, and a frozen
//    entry's nested read would violate the get-trap invariant).
// ---------------------------------------------------------------------------

describe("computed writes of non-plain / frozen values still render", () => {
  test("a Date and an array of frozen entries with nested objects, both written through function results", () => {
    const app = mount(`<program>
  function mkDate() { return new Date(0) }
  function mkLog() { return [Object.freeze({ id: 1, to: { v: "B" } })] }
  <stamp> = mkDate()
  <log> = mkLog()
  <p id="d">\${@stamp.getTime()}</p>
  <ul>
    <each in=@log key=@.id as e>
      <li>\${e.to.v}</li>
    </each>
  </ul>
</program>
`);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      expect(app.q("#d").textContent.trim()).toBe("0");
      expect(app.qa("li").map((l) => l.textContent.trim())).toEqual(["B"]);
      expect(app.consoleErrors).toEqual([]);
    } finally { app.restoreConsole(); }
  });
});

// ---------------------------------------------------------------------------
// 6. A cell value handed to an inline worker. The cell stores a Proxy, and
//    structured clone (postMessage) throws DataCloneError on one. The emitted
//    send hands the worker a plain copy. A fake Worker runs the real
//    structuredClone.
// ---------------------------------------------------------------------------

describe("a cell value sent to an inline worker survives structured clone", () => {
  test("a literal cell and a computed cell both post without DataCloneError", () => {
    globalThis.__posted = [];
    const FakeWorker = class {
      constructor(url) { this.url = url; }
      postMessage(d) { globalThis.__posted.push(structuredClone(d)); }
    };
    globalThis.Worker = FakeWorker;
    window.Worker = FakeWorker;
    const app = mount(`<program>
  <nums> = [1, 2, 3]
  <rows> = [{ id: 1, name: "one" }]
  <program name="echo">
    \${ when message(d) { send(d) } }
  </>
  \${ function a() { <#echo>.send(@nums) } }
  \${ function b() {
    @rows = @rows.map(r => ({ id: r.id, name: r.name + "!" }))
    <#echo>.send(@rows)
  } }
  <button id="a" onclick=a()>.</button>
  <button id="b" onclick=b()>.</button>
</program>
`);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      app.press("a");
      app.press("b");
      expect(app.consoleErrors).toEqual([]);
      expect(globalThis.__posted).toEqual([[1, 2, 3], [{ id: 1, name: "one!" }]]);
    } finally { app.restoreConsole(); delete globalThis.Worker; }
  });
});
