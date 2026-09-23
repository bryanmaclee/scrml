/**
 * g-match-inside-each-row-cannot-see-the-row-variable — MOUNTED (happy-dom)
 * acceptance for a block-form `<match>` inside an `<each>` row whose arm bodies
 * read the ROW (the `as` alias, `@.`, an enclosing row's alias, an `as (k, v)`
 * pair).
 *
 * Pre-fix: compiled at exit 0 and died at boot — the arm wire functions live at
 * file scope and received only payload bindings, so `${g.name}` in an arm threw
 * `ReferenceError: g is not defined` inside the row factory and the WHOLE list
 * rendered empty. The `@.name` form compiled to `_scrml_reactive_get(".name")`
 * and rendered an empty span silently; a delegable `onclick=pick(g.name)` threw
 * on every click; an `<each>` inside such an arm got no render fn at all (empty
 * list, silently).
 *
 * Fix (the #1022 mechanism — instance scope passed as PARAMETERS to the
 * file-scope fns): the per-row dispatch passes the row-scope names, the arm
 * wire fns take them after the payload bindings, the dispatcher re-renders when
 * a row item changes identity, row-reading bindings run under an effect, and an
 * arm `<each>` renders through a file-scope fn taking the arm scope.
 *
 * Mounts the SHIPPED pruned runtime + client chunk; execution is the gate (R26).
 * Emit-shape pins: compiler/tests/unit/match-in-each-row-scope.test.js.
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

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "match-row-scope-"));
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
    let initError = null;
    try {
      new Function("window", "document",
        `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` +
        captureInsideChunkScope(rd("app.client.js"), "globalThis.__get = _scrml_reactive_get; globalThis.__set = _scrml_reactive_set; globalThis.__dr = _scrml_deep_reactive;\n"),
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
      get: (n) => globalThis.__get(n),
      // mirror a compiled `@cell = value` (it wraps the value in _scrml_deep_reactive)
      set: (n, v) => globalThis.__set(n, globalThis.__dr(v)),
      rows: (sel = "li.row") => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
      q: (sel) => document.querySelector(sel),
      qa: (sel) => [...document.querySelectorAll(sel)],
      click: (el) => el.dispatchEvent(new window.Event("click", { bubbles: true })),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const BASE = `<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one" }, { id: 2, kind: Kind.B, name: "two" }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=Kind on=g.kind>
          <A><p>A:\${g.name}</p></>
          <B><p>B:\${g.name}</p></>
        </match>
      </li>
    </each>
  </ul>
</program>
`;

describe("g-match-inside-each-row-cannot-see-the-row-variable — mounted", () => {
  test("the gap's own repro: text interpolation of the row alias renders every row (was ReferenceError at init, empty list)", () => {
    const app = mount(BASE);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    expect(app.rows()).toEqual(["A:one", "B:two"]);
  });

  test("reactivity: in-place field edit, same-key replace (kind change AND same kind), push, remove, reverse, in-place kind", () => {
    const app = mount(BASE);
    expect(app.initError).toBeNull();
    app.get("groups")[0].name = "ONE";
    expect(app.rows()).toEqual(["A:ONE", "B:two"]);
    // same key, different kind -> the arm re-dispatches against the NEW item
    app.set("groups", [{ id: 1, kind: "B", name: "uno" }, app.get("groups")[1]]);
    expect(app.rows()).toEqual(["B:uno", "B:two"]);
    // same key, SAME kind, new object -> the arm must read the new item, not the old one
    app.set("groups", [app.get("groups")[0], { id: 2, kind: "B", name: "dos" }]);
    expect(app.rows()).toEqual(["B:uno", "B:dos"]);
    // and an in-place edit on the REPLACED item still updates (the arm is wired to it)
    app.get("groups")[1].name = "DOS";
    expect(app.rows()).toEqual(["B:uno", "B:DOS"]);
    app.set("groups", [...app.get("groups"), { id: 3, kind: "A", name: "three" }]);
    expect(app.rows()).toEqual(["B:uno", "B:DOS", "A:three"]);
    app.set("groups", app.get("groups").filter((x) => x.id !== 2));
    expect(app.rows()).toEqual(["B:uno", "A:three"]);
    app.set("groups", [...app.get("groups")].reverse());
    expect(app.rows()).toEqual(["A:three", "B:uno"]);
    app.get("groups")[0].kind = "B";
    expect(app.rows()).toEqual(["B:three", "B:uno"]);
    expect(app.consoleErrors).toEqual([]);
  });

  test("attributes: quoted template, class: directive and a (expr) value attr read the row and follow in-place edits", () => {
    const app = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one", hot: true }, { id: 2, kind: Kind.A, name: "two", hot: false }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=Kind on=g.kind>
          <A><p class="a" title="t-\${g.name}" data-n=(g.name) class:hot=(g.hot)>A</p></>
          <B><p>B</p></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    const ps = () => app.qa("p.a").map((p) => [p.getAttribute("title"), p.getAttribute("data-n"), p.classList.contains("hot")]);
    expect(ps()).toEqual([["t-one", "one", true], ["t-two", "two", false]]);
    app.get("groups")[1].name = "TWO";
    app.get("groups")[1].hot = true;
    expect(ps()).toEqual([["t-one", "one", true], ["t-TWO", "TWO", true]]);
  });

  test("event handlers: a delegable click and a non-delegable listener read the row (click threw ReferenceError pre-fix)", () => {
    const app = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one" }, { id: 2, kind: Kind.B, name: "two" }]
  <picked> = ""
  function pick(n) { @picked = n }
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=Kind on=g.kind>
          <A><button class="c" onclick=pick(g.name)>c</button><input class="m" onmouseenter=pick("m" + g.name)/></>
          <B><button class="c" onclick=\${() => pick("arrow-" + g.name)}>c</button></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    const [b1, b2] = app.qa("button.c");
    app.click(b1);
    expect(app.get("picked")).toBe("one");
    app.click(b2);
    expect(app.get("picked")).toBe("arrow-two");
    app.q("input.m").dispatchEvent(new window.Event("mouseenter"));
    expect(app.get("picked")).toBe("mone");
    // after a same-key replace the handler sees the NEW item
    app.set("groups", [{ id: 1, kind: "A", name: "uno" }, app.get("groups")[1]]);
    app.click(app.qa("button.c")[0]);
    expect(app.get("picked")).toBe("uno");
    expect(app.consoleErrors).toEqual([]);
  });

  test("sibling (no <each>): a delegable click reading an arm PAYLOAD binding works (same class — threw ReferenceError pre-fix)", () => {
    const app = mount(`<program>
  type St:enum = { Idle, Busy(note: string) }
  <st> = St.Busy("hi")
  <picked> = ""
  function pick(n) { @picked = n }
  <match for=St on=@st>
    <Idle><p>idle</p></>
    <Busy note><button id="b" onclick=pick(note)>c</button></>
  </match>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    const origErr = console.error;
    const errs = [];
    console.error = (...a) => { errs.push(a.map(String).join(" ")); };
    try { app.click(app.q("#b")); } finally { console.error = origErr; }
    expect(errs).toEqual([]);
    expect(app.get("picked")).toBe("hi");
  });

  test("`@.` form (no `as`): arm body `${@.name}` and `on=@.kind` (was an empty span at exit 0)", () => {
    const app = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one" }, { id: 2, kind: Kind.B, name: "two" }]
  <ul>
    <each in=@groups key=@.id>
      <li class="row">
        <match for=Kind on=@.kind>
          <A><p title="t-\${@.name}">A:\${@.name}</p></>
          <B><p>B:\${@.name}</p></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    expect(app.rows()).toEqual(["A:one", "B:two"]);
    expect(app.q("li.row p").getAttribute("title")).toBe("t-one");
    app.get("groups")[0].name = "ONE";
    expect(app.rows()).toEqual(["A:ONE", "B:two"]);
  });

  test("payload bindings AND the row alias in the same arm; a payload binding shadows a same-named row alias", () => {
    const app = mount(`<program>
  type St:enum = { Idle, Busy(note: string), Held(g: string) }
  <groups> = [{ id: 1, st: St.Idle, name: "one" }, { id: 2, st: St.Busy("hi"), name: "two" }, { id: 3, st: St.Held("payload"), name: "three" }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=St on=g.st>
          <Idle><p>I:\${g.name}</p></>
          <Busy note><p>B:\${note}/\${g.name}</p></>
          <Held g><p>H:\${g}</p></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    expect(app.rows()).toEqual(["I:one", "B:hi/two", "H:payload"]);
  });

  test("an <each> inside the arm renders — over the row alias, over @., over a cell, over a payload binding — and follows mutations", () => {
    const app = mount(`<program>
  type St:enum = { Idle, Busy(items: string[]) }
  <tags> = ["t1", "t2"]
  <groups> = [{ id: 1, st: St.Idle, name: "one", sub: ["a", "b"] }, { id: 2, st: St.Busy(["p", "q"]), name: "two", sub: ["c"] }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=St on=g.st>
          <Idle><ol class="alias"><each in=g.sub as s><li>\${s}/\${g.name}</li></each></ol><ol class="sigil"><each in=@.sub as s><li>\${s}</li></each></ol><ol class="cell"><each in=@tags as t><li>\${t}</li></each></ol></>
          <Busy items><ol class="pay"><each in=items as it><li>\${it}/\${g.name}</li></each></ol></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    const list = (cls) => app.qa(`ol.${cls} li`).map((e) => e.textContent);
    expect(list("alias")).toEqual(["a/one", "b/one"]);
    expect(list("sigil")).toEqual(["a", "b"]);
    expect(list("cell")).toEqual(["t1", "t2"]);
    expect(list("pay")).toEqual(["p/two", "q/two"]);
    app.get("groups")[0].name = "ONE";
    expect(list("alias")).toEqual(["a/ONE", "b/ONE"]);
    app.get("groups")[0].sub.push("z");
    expect(list("alias")).toEqual(["a/ONE", "b/ONE", "z/ONE"]);
    expect(list("sigil")).toEqual(["a", "b", "z"]);
    app.set("tags", ["t9"]);
    expect(list("cell")).toEqual(["t9"]);
    // switching the row's arm away and back re-renders the arm list against the item
    app.get("groups")[0].st = St_Busy(["x"]);
    expect(list("alias")).toEqual([]);
    expect(app.qa("ol.pay").length).toBe(2);
    expect(app.consoleErrors).toEqual([]);

    function St_Busy(items) { return { variant: "Busy", data: { items } }; }
  });

  test("siblings: an inner <each>'s match reading the OUTER row alias; `as (k, v)`; unkeyed each + wildcard arm; a lift in the arm", () => {
    const nested = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, name: "one", subs: [{ id: 10, kind: Kind.A, t: "x" }, { id: 11, kind: Kind.B, t: "y" }] }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <each in=g.subs key=@.id as s>
          <span class="sub"><match for=Kind on=s.kind><A><b>A:\${s.t}/\${g.name}</b></><B><b>B:\${s.t}/\${g.name}</b></></match></span>
        </each>
      </li>
    </each>
  </ul>
</program>
`);
    expect(nested.errs).toEqual([]);
    expect(nested.initError).toBeNull();
    expect(nested.rows("span.sub")).toEqual(["A:x/one", "B:y/one"]);
    nested.get("groups")[0].name = "ONE";
    expect(nested.rows("span.sub")).toEqual(["A:x/ONE", "B:y/ONE"]);

    const tuple = mount(`<program>
  type Kind:enum = { A, B }
  type Entry:struct = { key: string, value: Kind }
  <pairs>: Entry[] = [{ key: "DAL", value: Kind.A }, { key: "HOU", value: Kind.B }]
  <ul>
    <each in=@pairs as (k, v)>
      <li class="row"><match for=Kind on=v><A><b>A:\${k}</b></><B><b>B:\${k}</b></></match></li>
    </each>
  </ul>
</program>
`);
    expect(tuple.errs).toEqual([]);
    expect(tuple.initError).toBeNull();
    expect(tuple.rows()).toEqual(["A:DAL", "B:HOU"]);

    const wild = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one" }, { id: 2, kind: Kind.B, name: "two" }]
  <ul>
    <each in=@groups as g>
      <li class="row"><match for=Kind on=g.kind><A><p>A:\${g.name}</p></><_><p>W:\${g.name}</p></></match></li>
    </each>
  </ul>
</program>
`);
    expect(wild.errs).toEqual([]);
    expect(wild.initError).toBeNull();
    expect(wild.rows()).toEqual(["A:one", "W:two"]);

    const lift = mount(`<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A, name: "one", items: ["x", "y"] }, { id: 2, kind: Kind.B, name: "two", items: [] }]
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row">
        <match for=Kind on=g.kind>
          <A><ol>\${ for (let it of g.items) { lift <li>\${it}-\${g.name}</li> } }</ol></>
          <B><p>B:\${g.name}</p></>
        </match>
      </li>
    </each>
  </ul>
</program>
`);
    expect(lift.errs).toEqual([]);
    expect(lift.initError).toBeNull();
    expect(lift.rows()).toEqual(["x-oney-one", "B:two"]);
  });
});

// ---------------------------------------------------------------------------
// Round 2 (review of 92c6198b, HIGH): a click inside an arm must follow EXACTLY
// the order and propagation of the same markup outside the match. Round 1
// attached arm-name-reading clicks as element listeners while the rest of the
// arm stayed delegated to `document`, so an OUTER arm handler fired BEFORE an
// INNER delegated one and `stopPropagation()` in the inner could not stop it.
//
// Each case runs twice — the arm version and its non-match TWIN (the identical
// markup directly in the `<each>` row, or directly on the page) — and both must
// produce the same log. Separate tests: a mounted program leaves its document-
// level delegation listener behind, so two mounts in one test would interfere.
// ---------------------------------------------------------------------------

const LOG_DECLS = `<log> = ""
  function lg(s) { @log = @log + s + ";" }
  function stp(s, e) { e.stopPropagation(); @log = @log + s + ";" }
  <p id="log">\${@log}</p>`;

/** Builders take the arm name to read (`g.id` / `note`), or its twin's stand-in. */
const ROW_CASES = [
  ["both arm-bound", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=lg("inner" + ${n})>x</button></div>`, "inner1;outer1;"],
  ["inner delegated + outer arm-bound", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=lg("inner")>x</button></div>`, "inner;outer1;"],
  ["inner arm-bound + outer delegated", (n) => `<div class="o" onclick=lg("outer")><button class="i" onclick=lg("inner" + ${n})>x</button></div>`, "inner1;outer;"],
  ["stopPropagation in the inner", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=stp("inner", event)>x</button></div>`, "inner;"],
  ["stopPropagation in the outer", (n) => `<div class="o" onclick=stp("outer", event)><button class="i" onclick=lg("inner" + ${n})>x</button></div>`, "inner1;outer;"],
];

function rowProgram(inner, asArm, rowAttr = "") {
  const body = asArm
    ? `<match for=Kind on=g.kind><A>${inner}</><B><b>B</b></></match>`
    : inner;
  return `<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A }]
  ${LOG_DECLS}
  <ul><each in=@groups key=@.id as g><li class="row"${rowAttr}>${body}</li></each></ul>
</program>
`;
}

const PAGE_CASES = [
  ["both arm-bound", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=lg("inner" + ${n})>x</button></div>`, "innerhi;"],
  ["inner delegated + outer arm-bound (the review's t2)", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=lg("inner")>x</button></div>`, "inner;"],
  ["inner arm-bound + outer delegated", (n) => `<div class="o" onclick=lg("outer")><button class="i" onclick=lg("inner" + ${n})>x</button></div>`, "innerhi;"],
  ["stopPropagation in the inner", (n) => `<div class="o" onclick=lg("outer" + ${n})><button class="i" onclick=stp("inner", event)>x</button></div>`, "inner;"],
];

function pageProgram(inner, asArm) {
  const body = asArm
    ? `<match for=St on=@st><Idle><p>idle</p></><Busy note>${inner}</></match>`
    : inner;
  return `<program>
  type St:enum = { Idle, Busy(note: string) }
  <st> = St.Busy("hi")
  ${LOG_DECLS}
  ${body}
</program>
`;
}

function clickLog(src, sel) {
  const app = mount(src);
  expect(app.errs).toEqual([]);
  expect(app.initError).toBeNull();
  const origErr = console.error;
  const errs = [];
  console.error = (...a) => { errs.push(a.map(String).join(" ")); };
  try { app.click(app.q(sel)); } finally { console.error = origErr; }
  expect(errs).toEqual([]);
  return app.get("log");
}

describe("round 2 — click order inside an arm in an <each> row matches the same markup directly in the row", () => {
  for (const [name, build, expected] of ROW_CASES) {
    test(`${name} — in a <match> arm`, () => {
      expect(clickLog(rowProgram(build("g.id"), true), "button.i")).toBe(expected);
    });
    test(`${name} — twin (no match)`, () => {
      expect(clickLog(rowProgram(build("g.id"), false), "button.i")).toBe(expected);
    });
  }
  test("row-level onclick on the <li> around an arm button — in a <match> arm", () => {
    expect(clickLog(rowProgram(`<button class="i" onclick=lg("btn" + g.id)>x</button>`, true, ` onclick=lg("row" + g.id)`), "button.i")).toBe("btn1;row1;");
  });
  test("row-level onclick on the <li> around a button — twin (no match)", () => {
    expect(clickLog(rowProgram(`<button class="i" onclick=lg("btn" + g.id)>x</button>`, false, ` onclick=lg("row" + g.id)`), "button.i")).toBe("btn1;row1;");
  });
  test("row-level onclick + stopPropagation in the arm button — in a <match> arm", () => {
    expect(clickLog(rowProgram(`<button class="i" onclick=stp("btn", event)>x</button>`, true, ` onclick=lg("row" + g.id)`), "button.i")).toBe("btn;");
  });
  test("row-level onclick + stopPropagation in the button — twin (no match)", () => {
    expect(clickLog(rowProgram(`<button class="i" onclick=stp("btn", event)>x</button>`, false, ` onclick=lg("row" + g.id)`), "button.i")).toBe("btn;");
  });
  // INTENTIONAL behaviour change (review of e0c02544, PA-accepted): a row-arm
  // handler that reads no arm name is now an element listener like the row's
  // own handlers, so its click also reaches a page-level delegated ancestor —
  // exactly as the plain-row twin's does. (main: the arm button was delegated
  // and the walker stopped at it: `del;`.)
  const PAGE_WRAPPED = (inner, asArm) => `<program>
  type Kind:enum = { A, B }
  <groups> = [{ id: 1, kind: Kind.A }]
  ${LOG_DECLS}
  <div class="page" onclick=lg("outer")>
  <ul><each in=@groups key=@.id as g><li>${asArm ? `<match for=Kind on=g.kind><A>${inner}</><B><b>B</b></></match>` : inner}</li></each></ul>
  </div>
</program>
`;
  test("row-arm handler reading no arm name + a page-level delegated ancestor — in a <match> arm", () => {
    expect(clickLog(PAGE_WRAPPED(`<button class="i" onclick=lg("del")>x</button>`, true), "button.i")).toBe("del;outer;");
  });
  test("row handler + a page-level delegated ancestor — twin (no match)", () => {
    expect(clickLog(PAGE_WRAPPED(`<button class="i" onclick=lg("del")>x</button>`, false), "button.i")).toBe("del;outer;");
  });

  test("a submit handler reading the row runs, with preventDefault (compiled clean and threw at submit before)", () => {
    const app = mount(rowProgram(`<form class="f" onsubmit=lg("save" + g.id)><button type="submit">s</button></form>`, true));
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    const ev = new window.Event("submit", { bubbles: true, cancelable: true });
    app.q("form.f").dispatchEvent(ev);
    expect(app.get("log")).toBe("save1;");
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("round 2 — click order inside an arm outside any <each> matches the same markup on the page (delegation)", () => {
  for (const [name, build, expected] of PAGE_CASES) {
    test(`${name} — in a <match> arm`, () => {
      expect(clickLog(pageProgram(build("note"), true), "button.i")).toBe(expected);
    });
    test(`${name} — twin (no match)`, () => {
      expect(clickLog(pageProgram(build(`"hi"`), false), "button.i")).toBe(expected);
    });
  }
  test("an <each> inside an arm whose ROW handler reads the arm payload (was ReferenceError on click; round 3)", () => {
    const app = mount(`<program>
  type Doc:enum = { Empty, Note(note: string) }
  <cur> = Doc.Note("P")
  <list> = ["m", "n"]
  ${LOG_DECLS}
  <match for=Doc on=@cur>
    <Empty><p>none</p></>
    <Note(note)><each in=@list as it><button class="p1" onclick=lg(note + it)>\${it}</button></each></>
  </match>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.initError).toBeNull();
    for (const b of app.qa("button.p1")) app.click(b);
    expect(app.get("log")).toBe("Pm;Pn;");
    app.set("list", ["m", "n", "o"]);
    app.set("log", "");
    for (const b of app.qa("button.p1")) app.click(b);
    expect(app.get("log")).toBe("Pm;Pn;Po;");
  });

  test("the outer arm-bound handler runs when its own element is clicked", () => {
    expect(clickLog(pageProgram(PAGE_CASES[1][1]("note"), true), "div.o")).toBe("outerhi;");
  });
});
