/**
 * g-arm-directive-binding-reads-arm-name — MOUNTED (happy-dom, shipped runtime)
 * acceptance for every element binding kind inside a dispatched arm (a `<match>`
 * arm, an item-scoped `<match>` arm in an `<each>` row, an `<engine>` state
 * child) that reads a name only the arm binds: a PAYLOAD binding or the
 * enclosing ROW alias.
 *
 * Pre-fix (main d6d6e55a): `show=`, `disabled=`/`readonly=`/`required=`, a
 * value-form `${ if … }` and `<textarea>` content stayed in the module-scope boot
 * wiring, where the arm's names do not exist — `ReferenceError: note is not
 * defined` (or `g`) at boot, and the element kept its unbound state: a `show=`
 * that should hide SHOWED, a `disabled=` that should disable did not. The
 * unquoted forms (`show=g.hot`, `title=note`, `class:on=g.hot`,
 * `disabled=on`) were emitted as static attribute STRINGS or read a reactive
 * cell named `g` (a TypeError that killed the page) — all at exit 0.
 *
 * Every arm case is paired with its NO-MATCH twin: the identical markup reading
 * reactive cells outside any arm, which must produce the same values.
 *
 * Emit-shape pins: compiler/tests/unit/arm-directive-binding-reads-arm-name.test.js.
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
  const tmpDir = mkdtempSync(join(tmpdir(), "arm-directive-"));
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
        captureInsideChunkScope(rd("app.client.js"), "globalThis.__get = _scrml_reactive_get; globalThis.__set = _scrml_reactive_set;\n"),
      )(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } catch (e) {
      initError = e;
    }
    return {
      errs,
      initError,
      consoleErrors,
      restore: () => { console.error = origErr; },
      qa: (sel) => [...document.querySelectorAll(sel)],
      click: (id) => document.getElementById(id).dispatchEvent(new window.Event("click", { bubbles: true })),
      set: (n, v) => globalThis.__set(n, v),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The matrix. Each scope names, for its two instances (first / second):
//   X — a condition that is TRUE for the first and FALSE for the second;
//   Y — a string that is "hi" for the first and "zz" for the second;
//   B — a bare (unquoted) BOOLEAN name: true for the first, false for the second.
// ---------------------------------------------------------------------------
const PRE = `  <log> = ""
  function isHi(s) { return s == "hi" }
`;

const SCOPES = {
  // non-row arm, payload bindings
  pay: {
    X: 'note == "hi"', Y: "note", B: "flag",
    program: (body) => `<program>
  type Doc:enum = { Empty, Note(note: string, flag: bool) }
  <cur> = Doc.Note("hi", true)
  <cur2> = Doc.Note("zz", false)
${PRE}  <div id="m1"><match for=Doc on=@cur><Empty><p>none</p></><Note(note, flag)>${body}</></match></div>
  <div id="m2"><match for=Doc on=@cur2><Empty><p>none</p></><Note(note, flag)>${body}</></match></div>
</program>
`,
  },
  // row arm reading the ROW alias
  rowalias: {
    X: "g.hot", Y: "g.name", B: "g.hot",
    program: (body) => ROW_PROGRAM(body),
  },
  // row arm reading its own PAYLOAD
  rowpay: {
    X: 'tag == "hi"', Y: "tag", B: "flag",
    program: (body) => ROW_PROGRAM(body),
  },
};
const ROW_PROGRAM = (body) => `<program>
  type Kind:enum = { A, B(tag: string, flag: bool) }
  <groups> = [{ id: 1, kind: Kind.B("hi", true), hot: true, name: "hi" }, { id: 2, kind: Kind.B("zz", false), hot: false, name: "zz" }]
${PRE}  <ul>
    <each in=@groups key=@.id as g>
      <li class="row"><match for=Kind on=g.kind><A><p>a</p></><B(tag, flag)>${body}</></match></li>
    </each>
  </ul>
</program>
`;
// The no-match twin: the same markup, outside any arm, over reactive cells.
const TWIN = {
  X: ["@c1 == \"hi\"", "@c2 == \"hi\""], Y: ["@c1", "@c2"], B: ["@b1", "@b2"],
  program: (b1, b2) => `<program>
  <c1> = "hi"
  <c2> = "zz"
  <b1> = true
  <b2> = false
${PRE}  <div id="m1">${b1}</div>
  <div id="m2">${b2}</div>
</program>
`,
};

const vis = (e) => (e.style.display === "none" ? "hid" : "vis");
const has = (a) => (e) => (e.hasAttribute(a) ? "on" : "off");
// kind → markup (X / Y / B placeholders) + the DOM probe + the expected values.
const KINDS = {
  "show=(expr)": { body: '<p class="k" show=(X)>k</p>', probe: vis, want: ["vis", "hid"] },
  "show=fn(arm name)": { body: '<p class="k" show=isHi(Y)>k</p>', probe: vis, want: ["vis", "hid"] },
  "show= + transition:": { body: '<p class="k" show=(X) transition:fade>k</p>', probe: vis, want: ["vis", "hid"] },
  "show=bare": { body: '<p class="k" show=B>k</p>', probe: vis, want: ["vis", "hid"] },
  "disabled=(expr)": { body: '<button class="k" disabled=(X)>k</button>', probe: has("disabled"), want: ["on", "off"] },
  "readonly=(expr)": { body: '<input class="k" readonly=(X)/>', probe: has("readonly"), want: ["on", "off"] },
  "required=(expr)": { body: '<input class="k" required=(X)/>', probe: has("required"), want: ["on", "off"] },
  "disabled=bare": { body: '<button class="k" disabled=B>k</button>', probe: has("disabled"), want: ["on", "off"] },
  "textarea content": { body: '<textarea class="k">${Y}</textarea>', probe: (e) => e.value, want: ["hi", "zz"] },
  "value-form ${ if }": { body: '<p class="k">${ if (X) { "T" } else { "F" } }</p>', probe: (e) => e.textContent.trim(), want: ["T", "F"] },
  // twin: `title=@c1` (bare cell) is a static string outside arms on main (the
  // held #81 bare-`@var` value-attr boundary), so the twin is the paren form.
  "title=bare": { body: '<p class="k" title=Y>k</p>', twinBody: '<p class="k" title=(Y)>k</p>', probe: (e) => e.getAttribute("title"), want: ["hi", "zz"] },
  // already handled on main — pinned so the fix cannot regress them
  "class:x=(expr)": { body: '<p class="k" class:on=(X)>k</p>', probe: (e) => (e.classList.contains("on") ? "on" : "off"), want: ["on", "off"] },
  "title=(expr)": { body: '<p class="k" title=(X ? "T" : "F")>k</p>', probe: (e) => e.getAttribute("title"), want: ["T", "F"] },
  "title=\"t-${…}\"": { body: '<p class="k" title="t-${Y}">k</p>', probe: (e) => e.getAttribute("title"), want: ["t-hi", "t-zz"] },
  "${text}": { body: '<p class="k">${Y}</p>', probe: (e) => e.textContent.trim(), want: ["hi", "zz"] },
  "value=(expr) on input": { body: '<input class="k" value=(Y)/>', probe: (e) => e.value, want: ["hi", "zz"] },
};

const fill = (body, x, y, b) => body.replace(/X/g, x).replace(/\bY\b/g, y).replace(/=B\b/g, "=" + b);

function run(src) {
  const app = mount(src);
  try {
    return { errs: app.errs, init: app.initError && String(app.initError), cerr: app.consoleErrors, vals: app.qa(".k") };
  } finally {
    app.restore();
  }
}

describe("every binding kind in an arm reads the arm's names — boot values, paired with the no-match twin", () => {
  for (const [kind, k] of Object.entries(KINDS)) {
    test(`${kind} — no-match twin (cells, outside any arm)`, () => {
      const tb = k.twinBody ?? k.body;
      const r = run(TWIN.program(fill(tb, TWIN.X[0], TWIN.Y[0], TWIN.B[0]), fill(tb, TWIN.X[1], TWIN.Y[1], TWIN.B[1])));
      expect(r.errs).toEqual([]);
      expect(r.init).toBeNull();
      expect(r.cerr).toEqual([]);
      expect(r.vals.map(k.probe)).toEqual(k.want);
    });
    for (const [scope, s] of Object.entries(SCOPES)) {
      test(`${kind} — ${scope}`, () => {
        const r = run(s.program(fill(k.body, s.X, s.Y, s.B)));
        expect(r.errs).toEqual([]);
        expect(r.init).toBeNull();
        expect(r.cerr).toEqual([]);
        expect(r.vals.map(k.probe)).toEqual(k.want);
      });
    }
  }

  // `class:x=obj.prop` (§5.5.2's property-access form) over the row alias. It read a
  // reactive CELL named `g` — `_scrml_reactive_get("g").hot` — a TypeError at boot
  // that left the whole list unwired. The twin is the same markup in a plain row.
  test("class:x=g.prop in a row arm (was a TypeError at boot)", () => {
    const r = run(ROW_PROGRAM('<p class="k" class:on=g.hot>k</p>'));
    expect(r.errs).toEqual([]);
    expect(r.init).toBeNull();
    expect(r.cerr).toEqual([]);
    expect(r.vals.map((e) => (e.classList.contains("on") ? "on" : "off"))).toEqual(["on", "off"]);
  });
  test("class:x=g.prop — no-match twin (the same markup in a plain row)", () => {
    const r = run(`<program>
  <groups> = [{ id: 1, hot: true }, { id: 2, hot: false }]
  <ul><each in=@groups key=@.id as g><li class="row"><p class="k" class:on=g.hot>k</p></li></each></ul>
</program>
`);
    expect(r.errs).toEqual([]);
    expect(r.init).toBeNull();
    expect(r.vals.map((e) => (e.classList.contains("on") ? "on" : "off"))).toEqual(["on", "off"]);
  });
});

describe("loud stays loud", () => {
  test("if= inside an arm is still E-IF-IN-DISPATCHED-ARM (payload and row)", () => {
    for (const [, s] of Object.entries(SCOPES)) {
      const r = run(s.program(fill('<p class="k" if=(X)>k</p>', s.X, s.Y, s.B)));
      expect(r.errs).toContain("E-IF-IN-DISPATCHED-ARM");
    }
  });
});

// ---------------------------------------------------------------------------
// Reactivity. Changes are driven through compiled handlers (clicks), so writes
// go through the compiled `@cell = …` path (deep-reactive wrapping included).
// ---------------------------------------------------------------------------
const REACTIVE_BODY_PAY = `<p class="s" show=(probe(note, @pulse))>s</p><p class="sb" show=flag>b</p><button class="d" disabled=(note == "hi")>d</button><textarea class="t">\${note}</textarea><p class="v">\${ if (note == "hi") { "T" } else { "F" } }</p><span class="ti" title=note>t</span><p class="x">\${probe(note, @pulse)}</p>`;
const PAY_REACTIVE = `<program>
  type Doc:enum = { Empty, Note(note: string, flag: bool) }
  <cur> = Doc.Note("hi", true)
  <pulse> = 0
  function probe(s, p) { globalThis.__hits = (globalThis.__hits ?? 0) + 1; return s == "hi" }
  function toZz() { @cur = Doc.Note("zz", false) }
  function toHi() { @cur = Doc.Note("hi", true) }
  function toEmpty() { @cur = Doc.Empty }
  function bump() { @pulse = @pulse + 1 }
  <button id="zz" onclick=toZz()>z</button>
  <button id="hi" onclick=toHi()>h</button>
  <button id="em" onclick=toEmpty()>e</button>
  <button id="bp" onclick=bump()>b</button>
  <match for=Doc on=@cur>
    <Empty><p class="none">none</p></>
    <Note(note, flag)>${REACTIVE_BODY_PAY}</>
  </match>
</program>
`;

function stateOf(root) {
  const q = (s) => root.querySelector(s);
  const s = q(".s");
  if (!s) return (root.textContent || "").trim();
  return [
    `s=${vis(s)}`,
    `sb=${vis(q(".sb"))}`,
    ...(q(".c") ? [`c=${q(".c").classList.contains("on") ? "on" : "off"}`] : []),
    `d=${q(".d").hasAttribute("disabled") ? "dis" : "en"}`,
    `t=${q(".t").value}`,
    `v=${q(".v").textContent.trim()}`,
    `ti=${q(".ti").getAttribute("title")}`,
  ].join(" ");
}

describe("reactivity — non-row arm (payload bindings)", () => {
  test("payload change in the same variant, arm switch away and back", () => {
    const app = mount(PAY_REACTIVE);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      const st = () => stateOf(document.body);
      expect(st()).toBe("s=vis sb=vis d=dis t=hi v=T ti=hi");
      app.click("zz");
      expect(st()).toBe("s=hid sb=hid d=en t=zz v=F ti=zz");
      app.click("hi");
      expect(st()).toBe("s=vis sb=vis d=dis t=hi v=T ti=hi");
      app.click("em");
      expect(app.qa(".s").length).toBe(0);
      expect(app.qa(".none").length).toBe(1);
      app.click("zz");
      expect(st()).toBe("s=hid sb=hid d=en t=zz v=F ti=zz");
      app.click("em");
      app.click("hi");
      expect(st()).toBe("s=vis sb=vis d=dis t=hi v=T ti=hi");
      expect(app.consoleErrors).toEqual([]);
    } finally {
      app.restore();
    }
  });

  // The `${probe(…)}` text binding is main's own per-arm effect (wired by the arm
  // wire fn since Phase A10): it is the leak baseline. The show= binding must add
  // exactly one live effect per mounted element, however many flips happened.
  test("no leaked effects over many arm flips: one show= + one text effect per pulse", () => {
    const app = mount(PAY_REACTIVE);
    try {
      const hits = () => { globalThis.__hits = 0; app.click("bp"); return globalThis.__hits; };
      expect(hits()).toBe(2);
      for (let i = 0; i < 20; i++) { app.click("em"); app.click(i % 2 ? "hi" : "zz"); }
      app.click("hi");
      expect(hits()).toBe(2);
      app.click("em");
      expect(hits()).toBe(0);
      expect(app.consoleErrors).toEqual([]);
    } finally {
      app.restore();
    }
  });
});

const REACTIVE_BODY_ROW = `<span class="s" show=(probe(g.hot, @pulse))>HOT</span><span class="sb" show=g.hot>B</span><span class="c" class:on=g.hot>C</span><button class="d" disabled=(g.hot)>d</button><textarea class="t">\${g.name}</textarea><p class="v">\${ if (g.hot) { "T" } else { "F" } }</p><span class="ti" title=g.name>T</span><p class="x">\${probe(g.hot, @pulse)}</p>`;
const ROW_REACTIVE = `<program>
  type Kind:enum = { A, B(tag: string) }
  <groups> = [{ id: 1, kind: Kind.B("hi"), hot: true, name: "hi" }, { id: 2, kind: Kind.B("zz"), hot: false, name: "zz" }]
  <pulse> = 0
  function probe(h, p) { globalThis.__hits = (globalThis.__hits ?? 0) + 1; return h }
  function cool() { @groups[0].hot = false }
  function heat() { @groups[0].hot = true }
  function rename() { @groups[0].name = "HEY" }
  function replace0() { @groups = [{ id: 1, kind: Kind.B("hi"), hot: false, name: "NEW" }, @groups[1]] }
  function toA() { @groups[0].kind = Kind.A }
  function toB() { @groups[0].kind = Kind.B("hi") }
  function bump() { @pulse = @pulse + 1 }
  <button id="cool" onclick=cool()>c</button>
  <button id="heat" onclick=heat()>h</button>
  <button id="ren" onclick=rename()>n</button>
  <button id="rep" onclick=replace0()>r</button>
  <button id="toA" onclick=toA()>a</button>
  <button id="toB" onclick=toB()>b</button>
  <button id="bp" onclick=bump()>p</button>
  <ul>
    <each in=@groups key=@.id as g>
      <li class="row"><match for=Kind on=g.kind><A><p>a</p></><B(tag)>${REACTIVE_BODY_ROW}</></match></li>
    </each>
  </ul>
</program>
`;
// The no-match twin: the same row markup without the match.
const ROW_REACTIVE_TWIN = ROW_REACTIVE
  .replace(/<match for=Kind on=g\.kind><A><p>a<\/p><\/><B\(tag\)>/, "")
  .replace("</></match></li>", "</li>");

describe("reactivity — row arm (row alias), paired with the plain-row twin", () => {
  for (const [label, src, armed] of [["row arm", ROW_REACTIVE, true], ["plain-row twin", ROW_REACTIVE_TWIN, false]]) {
    test(`${label}: in-place edit, same-key replace${armed ? ", arm switch away and back" : ""}`, () => {
      const app = mount(src);
      try {
        expect(app.errs).toEqual([]);
        expect(app.initError).toBeNull();
        const rows = () => app.qa("li.row").map(stateOf);
        // disabled= in a PLAIN row is a separate pre-existing defect (always
        // disabled — emit-each, not the arm path); compare it on the arm only.
        const norm = (xs) => (armed ? xs : xs.map((x) => x.replace(/ d=(dis|en)/, "")));
        const want = (xs) => norm(xs);
        const cold = "s=hid sb=hid c=off d=en t=zz v=F ti=zz";
        expect(norm(rows())).toEqual(want(["s=vis sb=vis c=on d=dis t=hi v=T ti=hi", cold]));
        app.click("cool");
        expect(norm(rows())).toEqual(want(["s=hid sb=hid c=off d=en t=hi v=F ti=hi", cold]));
        app.click("heat");
        app.click("ren");
        expect(norm(rows())).toEqual(want(["s=vis sb=vis c=on d=dis t=HEY v=T ti=HEY", cold]));
        app.click("rep");
        expect(norm(rows())).toEqual(want(["s=hid sb=hid c=off d=en t=NEW v=F ti=NEW", cold]));
        app.click("heat");
        expect(norm(rows())).toEqual(want(["s=vis sb=vis c=on d=dis t=NEW v=T ti=NEW", cold]));
        if (armed) {
          app.click("toA");
          expect(rows()).toEqual(["a", cold]);
          app.click("toB");
          expect(rows()).toEqual(["s=vis sb=vis c=on d=dis t=NEW v=T ti=NEW", cold]);
        }
        expect(app.consoleErrors).toEqual([]);
      } finally {
        app.restore();
      }
    });
  }

  test("no leaked effects over many arm flips and row edits: two rows x (show= + text) per pulse", () => {
    const app = mount(ROW_REACTIVE);
    try {
      const hits = () => { globalThis.__hits = 0; app.click("bp"); return globalThis.__hits; };
      expect(hits()).toBe(4);
      for (let i = 0; i < 20; i++) { app.click("toA"); app.click("toB"); app.click(i % 2 ? "cool" : "heat"); }
      expect(hits()).toBe(4);
      app.click("toA");
      expect(hits()).toBe(2);
      expect(app.consoleErrors).toEqual([]);
    } finally {
      app.restore();
    }
  });
});

describe("engine state child — payload binding", () => {
  const ENGINE = `<program>
type Phase:enum = {
  Idle
  Loaded(label: string, flag: bool)
}
<engine for=Phase initial=.Idle>
  <Idle rule=.Loaded>
    <p class="idle">idle</p>
  </>
  <Loaded label flag rule=.Idle>
    <p class="s" show=(label == "hi")>S</p><p class="sb" show=flag>B</p><button class="d" disabled=(label == "hi")>d</button><span class="ti" title=label>t</span>
  </>
</>
</program>
`;
  test("show= / show=bare / disabled= / title=bare follow the payload across entries (the only reactive surface on the page)", () => {
    const app = mount(ENGINE);
    try {
      expect(app.errs).toEqual([]);
      expect(app.initError).toBeNull();
      const st = () => {
        const q = (s) => document.querySelector(s);
        return `s=${vis(q(".s"))} sb=${vis(q(".sb"))} d=${q(".d").hasAttribute("disabled") ? "dis" : "en"} ti=${q(".ti").getAttribute("title")}`;
      };
      app.set("phase", { variant: "Loaded", data: { label: "hi", flag: true } });
      expect(st()).toBe("s=vis sb=vis d=dis ti=hi");
      app.set("phase", "Idle");
      expect(app.qa(".idle").length).toBe(1);
      app.set("phase", { variant: "Loaded", data: { label: "zz", flag: false } });
      expect(st()).toBe("s=hid sb=hid d=en ti=zz");
      expect(app.consoleErrors).toEqual([]);
    } finally {
      app.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Round 2 — an arm name spelled like one of the compiler's own locals.
//
// The arm-bound factory (`_scrml_armb_`), the arm wire fn and the item-scoped
// dispatch fn all take the arm's names as PARAMETERS next to names of their
// own. On 56c606ca a payload / row alias called `el` (or `_root`, `_disposers`,
// `_h`, `_d`, …) was a duplicate declaration (E-CODEGEN-INVALID-LOGIC) or was
// silently SHADOWED by the internal (`${el}` rendered the element). Every kind
// in the matrix must compile and give the twin's values under each such name.
//
// Not listed, and why (both fail identically in the plain-row twin — the
// `<each>` path, out of this change's lane):
//   - a ROW ALIAS `_mount` (emit-each's per-row `let _mount`), and
//   - `event` in an event handler (every handler is `function(event) { … }`).
// ---------------------------------------------------------------------------
const INTERNAL_NAMES = [
  "el", "root", "_root", "e", "t", "node", "d", "i", "k", "v",
  "_d", "_e", "_h", "_v", "_hv", "_rt", "_disposers", "_tag", "_data", "_rs", "_ls", "_mount", "event",
];
const COLLISION_KINDS = [
  // [markup, probe, want]; X/Y as in the matrix, B = a bare boolean-ish read
  ['<p class="c0" show=(X)>k</p>', vis, ["vis", "hid"]],
  ['<p class="c1" show=isHi(Y)>k</p>', vis, ["vis", "hid"]],
  ['<p class="c2" show=(X) transition:fade>k</p>', vis, ["vis", "hid"]],
  ['<button class="c3" disabled=(X)>k</button>', has("disabled"), ["on", "off"]],
  ['<input class="c4" readonly=(X)/>', has("readonly"), ["on", "off"]],
  ['<input class="c5" required=(X)/>', has("required"), ["on", "off"]],
  ['<textarea class="c6">${Y}</textarea>', (e) => e.value, ["hi", "zz"]],
  ['<p class="c7">${ if (X) { "T" } else { "F" } }</p>', (e) => e.textContent.trim(), ["T", "F"]],
  ['<p class="c8" title=Y>k</p>', (e) => e.getAttribute("title"), ["hi", "zz"]],
  ['<p class="c9">${Y}</p>', (e) => e.textContent.trim(), ["hi", "zz"]],
  ['<p class="c10" class:on=(X)>k</p>', (e) => (e.classList.contains("on") ? "on" : "off"), ["on", "off"]],
  ['<p class="c11" title=(X ? "T" : "F")>k</p>', (e) => e.getAttribute("title"), ["T", "F"]],
  ['<p class="c12" title="t-${Y}">k</p>', (e) => e.getAttribute("title"), ["t-hi", "t-zz"]],
  ['<input class="c13" value=(Y)/>', (e) => e.value, ["hi", "zz"]],
  ['<ul class="c14">${ for (let q of [Y]) { lift <li>${q}</li> } }</ul>', (e) => e.textContent.trim(), ["hi", "zz"]],
  ['<input class="c15" value="v-${Y}"/>', (e) => e.value, ["v-hi", "v-zz"]],
];
const collisionBody = (x, y) =>
  COLLISION_KINDS.map(([m]) => fill(m, x, y, "")).join("") +
  `<input class="cf" onfocus=recF(${y})/><button class="cc" onclick=recC(${y})>c</button><input class="cb" bind:value=@txt/>`;
const COLLISION_PRE = `  <logF> = ""
  <logC> = ""
  <txt> = "t0"
  function recF(s) { @logF = @logF + s + ";" }
  function recC(s) { @logC = @logC + s + ";" }
  function isHi(s) { return s == "hi" }
`;
const collisionProgram = (scope, N) => {
  if (scope === "payload") {
    const body = collisionBody(`${N} == "hi"`, N);
    return `<program>
  type Doc:enum = { Empty, Note(${N}: string) }
  <cur> = Doc.Note("hi")
  <cur2> = Doc.Note("zz")
${COLLISION_PRE}  <div><match for=Doc on=@cur><Empty><p>none</p></><Note(${N})>${body}</></match></div>
  <div><match for=Doc on=@cur2><Empty><p>none</p></><Note(${N})>${body}</></match></div>
</program>
`;
  }
  if (scope === "row payload") {
    return `<program>
  type Kind:enum = { A, B(${N}: string) }
  <groups> = [{ id: 1, kind: Kind.B("hi") }, { id: 2, kind: Kind.B("zz") }]
${COLLISION_PRE}  <ul><each in=@groups key=@.id as g><li><match for=Kind on=g.kind><A><p>a</p></><B(${N})>${collisionBody(`${N} == "hi"`, N)}</></match></li></each></ul>
</program>
`;
  }
  return `<program>
  type Kind:enum = { A, B(tag: string) }
  <groups> = [{ id: 1, kind: Kind.B("x"), hot: true, name: "hi" }, { id: 2, kind: Kind.B("y"), hot: false, name: "zz" }]
${COLLISION_PRE}  <ul><each in=@groups key=@.id as ${N}><li><match for=Kind on=${N}.kind><A><p>a</p></><B(tag)>${collisionBody(`${N}.hot`, `${N}.name`)}<span class="cs" show=${N}.hot>s</span><span class="cd" class:on=${N}.hot>d</span></></match></li></each></ul>
</program>
`;
};

describe("round 2 — an arm name spelled like a compiler internal compiles and behaves like its twin", () => {
  for (const N of INTERNAL_NAMES) {
    for (const scope of ["payload", "row alias", "row payload"]) {
      if (scope === "row alias" && N === "_mount") continue; // emit-each `let _mount` — twin broken too (see above)
      test(`${scope} named \`${N}\` — every kind`, () => {
        const app = mount(collisionProgram(scope, N));
        try {
          expect(app.errs).toEqual([]);
          expect(app.initError).toBeNull();
          COLLISION_KINDS.forEach(([, probe, want], i) => {
            expect([i, app.qa(`.c${i}`).map(probe)]).toEqual([i, want]);
          });
          if (scope === "row alias") {
            expect(app.qa(".cs").map(vis)).toEqual(["vis", "hid"]);
            expect(app.qa(".cd").map((e) => (e.classList.contains("on") ? "on" : "off"))).toEqual(["on", "off"]);
          }
          if (N !== "event") { // every handler is `function(event) { … }` — the plain-row twin fails too
            for (const e of app.qa(".cf")) e.dispatchEvent(new window.Event("focus"));
            for (const e of app.qa(".cc")) e.dispatchEvent(new window.Event("click", { bubbles: true }));
            expect(globalThis.__get("logF")).toBe("hi;zz;");
            expect(globalThis.__get("logC")).toBe("hi;zz;");
          }
          const cb = app.qa(".cb")[0];
          cb.value = "typed";
          cb.dispatchEvent(new window.Event("input", { bubbles: true }));
          expect(globalThis.__get("txt")).toBe("typed");
          expect(app.consoleErrors).toEqual([]);
        } finally {
          app.restore();
        }
      });
    }
  }
});
