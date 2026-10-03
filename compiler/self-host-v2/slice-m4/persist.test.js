// persist.test.js — s451 (U5, dpa-061): `persist="local" | "session"` + `key=` (SPEC §6.14) end
// to end in the bootstrap — §66 source → parse → analyze → lower → Core (Field.persist,
// Stmt.Unpersist) → check → print → the slice runtime in happy-dom (Web Storage + `storage` events)
// — plus every §6.14 code the bootstrap can express, and the refusals (E-BOOTSTRAP-UNSUPPORTED)
// for every combination the SPEC leaves OPEN. Governing sentences:
// docs/changes/s451-boot-u5-persist/progress.md.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, click, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const diagsOf = (src) => run(src).diags;
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r;
};
const coreOf = (src) => clean(src).core;
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const $ = (sel) => document.querySelector(sel);
const btn = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);
const walkCore = (core, pred) => {
  const out = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== "object") return;
    if (pred(n)) out.push(n);
    Object.values(n).forEach(walk);
  })(core);
  return out;
};
const fieldsOf = (core) => core.decls.find((d) => d.kind === "Program" || d.kind?.variant === "Program").fields;

/** Another document's write to `area` (the `storage` event a browser fires in every OTHER tab). */
function otherTab(area, key, newValue) {
  const oldValue = key === null ? null : area.getItem(key);
  if (key === null) area.clear();
  else if (newValue === null) area.removeItem(key);
  else area.setItem(key, newValue);
  window.dispatchEvent(new window.StorageEvent("storage", { key, oldValue, newValue, storageArea: area }));
}

/** Count `Date.now()` calls — the outside-world action an `<effect>` body performs. */
function clockCalls(fn) {
  const real = Date.now;
  let calls = 0;
  Date.now = () => { calls++; return real.call(Date); };
  try { fn(); } finally { Date.now = real; }
  return calls;
}

// One program per key prefix: every program a test loads stays alive (its `storage` listener too),
// so each test uses its OWN keys — an event for one key is ignored by every other program's cells.
const COUNTER = (k) => P(
  `    let <count:int=0 persist="local" key="${k}.count"/>\n    <dbl:int=(@count * 2)/>\n    let <copy:int=(@count)/>\n    function ping() {\n        const t = Date.now()\n    }\n    <effect deps=[@count]>\${ ping() }</>`,
  `        <p class="out">\${@count}|\${@dbl}|\${@copy}</p>\n        <button onclick=(@count = @count + 1)>inc</button>\n        <button onclick=(reset(@count))>reset</button>`);

describe("§6.14.2 — restore, codec, write on change, reset, cross-tab sync", () => {
  test("Core: Field.persist on the program cell; the reset's Write is followed by ONE Unpersist (rule 9); C16 holds", () => {
    const core = coreOf(COUNTER("c0"));
    const f = fieldsOf(core);
    expect(f[0].persist).toEqual({ store: "Local", key: "c0.count" });
    expect(f[1].persist).toBe(null);
    expect(f[2].persist).toBe(null);
    const un = walkCore(core, (n) => n.variant === "Unpersist");
    expect(un.length).toBe(1);
    expect(un[0].data.idx).toBe(0);
  });

  test("printed: `rt.persisted(inst$.scope, () => 0, \"local\", \"c1.count\", <wire descriptor>)`, and `rt.unpersist(<cell>)` after the reset write", async () => {
    const { out } = await loadProgram(coreOf(COUNTER("c1")), "persist-print");
    expect(out.js).toContain(`rt.persisted(inst$.scope, () => 0, "local", "c1.count", { defs: [], root: { k: "int" } })`);
    expect(out.js).toContain("inst$.fields[0 /* count */].set(0);\n    rt.unpersist(inst$.fields[0 /* count */]);");
  });

  test("rule 1/3: no stored value → the default; a stored value is restored at construction — a derived cell and a `let` seed see it", async () => {
    await loadProgram(coreOf(COUNTER("c2")), "persist-absent");
    expect($("p.out").textContent).toBe("0|0|0");
    localStorage.setItem("c3.count", "5");
    await loadProgram(coreOf(COUNTER("c3")), "persist-restore");
    expect($("p.out").textContent).toBe("5|10|5");
  });

  test("O-061-6 (closed S449): the restore is construction — it fires no `<effect>`; the first user change does", async () => {
    localStorage.setItem("c4.count", "5");
    const core = coreOf(COUNTER("c4"));
    const real = Date.now;
    let atLoad = 0;
    Date.now = () => { atLoad++; return real.call(Date); };
    try { await loadProgram(core, "persist-noeffect"); } finally { Date.now = real; }
    expect(atLoad).toBe(0);
    expect($("p.out").textContent).toBe("5|10|5");
    expect(clockCalls(() => click(btn("inc")))).toBe(1);
  });

  test("rule 3: a stored value that does not decode against the CURRENT type → the default, never coerced", async () => {
    const bad = ["\"5\"", "5.5", "not json", "{\"__scrml_absent\":true}", "null", "[5]", "true", ""];
    let i = 0;
    for (const text of bad) {
      const k = `c5_${i++}`;
      localStorage.setItem(`${k}.count`, text);
      await loadProgram(coreOf(COUNTER(k)), `persist-bad-${i}`);
      expect([text, $("p.out").textContent]).toEqual([text, "0|0|0"]);
      // the bad value is not overwritten by the restore (a restore is not a write)
      expect(localStorage.getItem(`${k}.count`)).toBe(text);
    }
  });

  test("rule 4: a change is encoded and stored under the key, inside the writing batch", async () => {
    await loadProgram(coreOf(COUNTER("c6")), "persist-write");
    expect(localStorage.getItem("c6.count")).toBe(null);           // the default is not stored at load
    click(btn("inc"));
    expect(localStorage.getItem("c6.count")).toBe("1");
    click(btn("inc"));
    expect(localStorage.getItem("c6.count")).toBe("2");
    expect(sessionStorage.getItem("c6.count")).toBe(null);          // "local" writes localStorage only
  });

  test("rule 9: `reset(@x)` writes the default AND removes the key instead of storing it; the next load takes the default", async () => {
    localStorage.setItem("c7.count", "4");
    await loadProgram(coreOf(COUNTER("c7")), "persist-reset");
    expect($("p.out").textContent).toBe("4|8|4");
    click(btn("inc"));
    expect(localStorage.getItem("c7.count")).toBe("5");
    click(btn("reset"));
    expect($("p.out").textContent).toBe("0|0|4");
    expect(localStorage.getItem("c7.count")).toBe(null);
    await loadProgram(coreOf(COUNTER("c7")), "persist-reset-reload");
    expect($("p.out").textContent).toBe("0|0|0");
  });

  test("rule 9 via `reset-on=`: the reset of a persisted cell removes its key too", async () => {
    const src = P(`    let <query:string=""/>\n    let <page:int=1 persist="local" key="c8.page" reset-on=[@query]/>`,
      `        <p class="out">\${@page}</p>\n        <button onclick=(@page = @page + 1)>next</button>\n        <button onclick=(@query = @query + "x")>type</button>`);
    const core = coreOf(src);
    const resetOn = walkCore(core, (n) => n.variant === "ResetOn")[0];
    expect(resetOn.data.reset.stmts.map((s) => s.variant)).toEqual(["Write", "Unpersist"]);
    await loadProgram(core, "persist-reset-on");
    click(btn("next"));
    expect(localStorage.getItem("c8.page")).toBe("2");
    click(btn("type"));
    expect($("p.out").textContent).toBe("1");
    expect(localStorage.getItem("c8.page")).toBe(null);
  });

  test("rule 5: another tab's write is decoded and applied — a change like any other (`<effect>` runs, §6.7.4) — and is NOT written back", async () => {
    await loadProgram(coreOf(COUNTER("c9")), "persist-sync");
    click(btn("inc"));
    expect(localStorage.getItem("c9.count")).toBe("1");
    const calls = clockCalls(() => otherTab(localStorage, "c9.count", "7"));
    expect($("p.out").textContent).toBe("7|14|0");
    expect(calls).toBe(1);
    // not written back: an event whose value is NOT what storage holds leaves storage untouched
    // (a write-back would store "8" over the sentinel)
    localStorage.setItem("c9.count", "sentinel");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "c9.count", oldValue: "7", newValue: "8", storageArea: localStorage }));
    expect($("p.out").textContent).toBe("8|16|0");
    expect(localStorage.getItem("c9.count")).toBe("sentinel");
    click(btn("inc"));                                              // a local write after a sync stores normally
    expect(localStorage.getItem("c9.count")).toBe("9");
    // an event for ANOTHER key, or from sessionStorage, is ignored
    otherTab(localStorage, "c9.other", "3");
    otherTab(sessionStorage, "c9.count", "3");
    expect($("p.out").textContent).toBe("9|18|0");
  });

  test("rule 5 + rule 3: a cross-tab value that fails to decode, a removed key and a clear() → the default", async () => {
    await loadProgram(coreOf(COUNTER("c10")), "persist-sync-bad");
    otherTab(localStorage, "c10.count", "6");
    expect($("p.out").textContent).toBe("6|12|0");
    otherTab(localStorage, "c10.count", "\"six\"");
    expect($("p.out").textContent).toBe("0|0|0");
    otherTab(localStorage, "c10.count", "6");
    otherTab(localStorage, "c10.count", null);                     // the other tab reset it (rule 9)
    expect($("p.out").textContent).toBe("0|0|0");
    otherTab(localStorage, "c10.count", "6");
    otherTab(localStorage, null, null);                             // localStorage.clear() in the other tab
    expect($("p.out").textContent).toBe("0|0|0");
  });

  test("session: restored from and written to sessionStorage; no cross-tab sync (rule 5)", async () => {
    const src = P(`    let <filter:string="all" persist="session" key="c11.filter"/>`,
      `        <p class="out">\${@filter}</p>\n        <button onclick=(@filter = "done")>done</button>`);
    sessionStorage.setItem("c11.filter", "\"open\"");
    localStorage.setItem("c11.filter", "\"WRONG\"");
    await loadProgram(coreOf(src), "persist-session");
    expect($("p.out").textContent).toBe("open");
    click(btn("done"));
    expect(sessionStorage.getItem("c11.filter")).toBe("\"done\"");
    expect(localStorage.getItem("c11.filter")).toBe("\"WRONG\"");
    otherTab(sessionStorage, "c11.filter", "\"x\"");
    otherTab(localStorage, "c11.filter", "\"y\"");
    expect($("p.out").textContent).toBe("done");
  });

  test("rule 2: an enum, a struct and a sequence round-trip through the §57 codec; a shape the type lacks → the default", async () => {
    const src = P(`    type Mode:enum = { Light, Dark }\n    type Pt:struct = { x: int, y: int }\n    let <mode:Mode=.Light persist="local" key="c12.mode"/>\n    let <pt:Pt=({ x: 0, y: 0 }) persist="local" key="c12.pt"/>\n    <tags:string[free, replace]=([]) persist="local" key="c12.tags"/>\n    function dark() {\n        @mode = .Dark\n    }\n    function move() {\n        @pt = { x: 3, y: 4 }\n    }\n    function tag() {\n        @tags = ["a", "b"]\n    }`,
      `        <p class="out">\${@pt.x},\${@pt.y}</p>\n        <button onclick=dark()>dark</button>\n        <button onclick=move()>move</button>\n        <button onclick=tag()>tag</button>`);
    const core = coreOf(src);
    await loadProgram(core, "persist-types");
    click(btn("dark"));
    click(btn("move"));
    click(btn("tag"));
    expect(localStorage.getItem("c12.mode")).toBe("\"Dark\"");
    expect(JSON.parse(localStorage.getItem("c12.pt"))).toEqual({ x: 3, y: 4 });
    expect(JSON.parse(localStorage.getItem("c12.tags"))).toEqual(["a", "b"]);
    const { rt } = await loadProgram(core, "persist-types-reload");
    expect($("p.out").textContent).toBe("3,4");
    const inst = [...rt.devtools.instances.values()].find((i) => i.decl.name === "program");
    expect(inst.fields[0].peek()).toBe("Dark");
    expect(inst.fields[2].peek()).toEqual(["a", "b"]);
    // not coerced: an undeclared variant, a struct with an extra key, a sequence with a non-string
    localStorage.setItem("c12.mode", "\"Sepia\"");
    localStorage.setItem("c12.pt", "{\"x\":1,\"y\":2,\"z\":3}");
    localStorage.setItem("c12.tags", "[\"a\",1]");
    const r2 = await loadProgram(core, "persist-types-bad");
    expect($("p.out").textContent).toBe("0,0");
    const inst2 = [...r2.rt.devtools.instances.values()].find((i) => i.decl.name === "program");
    expect(inst2.fields[0].peek()).toBe("Light");
    expect(inst2.fields[2].peek()).toEqual([]);
  });

  test("rule 3 (S447 call 6 (i)): validators are NOT part of the restore contract — an invalid stored value is restored, not touched", async () => {
    const src = P(`    let <email:string="" persist="local" key="c13.email" req length(>=5)/>`,
      `        <form><input id="e" bind:value=@email/></form>\n        <p class="v">\${@email.isValid}|\${@email.touched}</p>`);
    localStorage.setItem("c13.email", "\"ab\"");
    await loadProgram(coreOf(src), "persist-validators");
    expect($("#e").value).toBe("ab");
    expect($("p.v").textContent).toBe("false|false");
  });

  test("rule 1/6: storage that throws on access → the default, and no exception reaches user code", async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError: storage blocked"); } });
    try {
      await loadProgram(coreOf(COUNTER("c14")), "persist-blocked");
      expect($("p.out").textContent).toBe("0|0|0");
      click(btn("inc"));                                            // the store fails silently
      expect($("p.out").textContent).toBe("1|2|0");
      click(btn("reset"));
      expect($("p.out").textContent).toBe("0|0|0");
    } finally {
      Object.defineProperty(globalThis, "localStorage", desc);
    }
  });

  test("rule 6: a failing store (quota) does not throw into user code; the record notes it (no synthesized property yet — O-061-1)", async () => {
    const { rt } = await loadProgram(coreOf(COUNTER("c15")), "persist-quota");
    // a storage whose every write fails with the quota error a full origin throws
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const full = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error("QuotaExceededError"); } };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => full });
    try {
      click(btn("inc"));
    } finally {
      Object.defineProperty(globalThis, "localStorage", desc);
    }
    expect($("p.out").textContent).toBe("1|2|0");
    const inst = [...rt.devtools.instances.values()].find((i) => i.decl.name === "program");
    expect(rt.persistOf(inst.fields[0])).toEqual({ store: "local", key: "c15.count", failed: true });
    click(btn("inc"));
    expect(rt.persistOf(inst.fields[0]).failed).toBe(false);
    expect(localStorage.getItem("c15.count")).toBe("2");
  });

  test("rule 4 + rule 9 in ONE batch: a write then a reset leaves no key; a reset then a write stores the write", async () => {
    const src = P(`    let <n:int=0 persist="local" key="c16.n"/>\n    function writeThenReset() {\n        @n = 9\n        reset(@n)\n    }\n    function resetThenWrite() {\n        reset(@n)\n        @n = 3\n    }`,
      `        <p class="out">\${@n}</p>\n        <button onclick=writeThenReset()>wr</button>\n        <button onclick=resetThenWrite()>rw</button>`);
    await loadProgram(coreOf(src), "persist-batch");
    click(btn("wr"));
    expect($("p.out").textContent).toBe("0");
    expect(localStorage.getItem("c16.n")).toBe(null);
    click(btn("rw"));
    expect($("p.out").textContent).toBe("3");
    expect(localStorage.getItem("c16.n")).toBe("3");
  });

  test("BITE: the same Core with Field.persist stripped neither restores nor stores", async () => {
    localStorage.setItem("c17.count", "5");
    const core = coreOf(COUNTER("c17"));
    fieldsOf(core)[0].persist = null;
    const strip = (n) => {
      if (Array.isArray(n)) return n.forEach(strip);
      if (n === null || typeof n !== "object") return;
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (v && typeof v === "object" && Array.isArray(v.stmts)) v.stmts = v.stmts.filter((s) => s.variant !== "Unpersist");
        strip(v);
      }
    };
    strip(core);
    await loadProgram(core, "persist-bite");
    expect($("p.out").textContent).toBe("0|0|0");
    click(btn("inc"));
    expect(localStorage.getItem("c17.count")).toBe("5");
  });
});

describe("§6.14 — codes", () => {
  const cell = (attrs) => P(`    let <x:int=0 ${attrs}/>`, `        <p>\${@x}</p>`);

  test("E-PERSIST-STORAGE-UNKNOWN — any value but \"local\" / \"session\" (incl. the deferred \"cookie\" and IndexedDB) (§6.14.1 r1)", () => {
    for (const v of [`persist="cookie"`, `persist="indexeddb"`, `persist="Local"`, `persist=local`, `persist`, `persist=(@x)`]) {
      expect([v, codes(cell(`${v} key="k1"`))]).toEqual([v, ["E-PERSIST-STORAGE-UNKNOWN"]]);
    }
    expect(codes(cell(`persist="local" key="k1"`))).toEqual([]);
    expect(codes(cell(`persist="session" key="k1"`))).toEqual([]);
  });

  test("E-PERSIST-KEY-REQUIRED — `persist=` without `key=`; the compiler never derives one (§6.14.1 r2)", () => {
    expect(codes(cell(`persist="local"`))).toEqual(["E-PERSIST-KEY-REQUIRED"]);
    expect(codes(cell(`persist="cookie"`))).toEqual(["E-PERSIST-STORAGE-UNKNOWN", "E-PERSIST-KEY-REQUIRED"]);
    expect(diagsOf(cell(`persist="local"`))[0].message).toContain(`key="app.x"`);
  });

  test("E-PERSIST-WITH-SERVER — `persist=` beside `server` (§6.14.3 r3); `server` itself stays refused", () => {
    const cs = codes(cell(`server persist="local" key="k2"`));
    expect(cs).toContain("E-PERSIST-WITH-SERVER");
    expect(cs).toContain("E-BOOTSTRAP-UNSUPPORTED");
  });

  test("E-PREPAINT-WITHOUT-PERSIST (§6.14.4.2 r2) — on a program cell and on a declaration's field; `prepaint` WITH `persist=` is refused (no pre-paint script)", () => {
    expect(codes(cell(`prepaint`))).toEqual(["E-PREPAINT-WITHOUT-PERSIST"]);
    const field = `<program>\n <box a:int=1>\n  let <c:int=0 prepaint/>\n </>\n renders <p>\${a}</p>\n <main><box/></main>\n</program>\n`;
    expect(codes(field)).toEqual(["E-PREPAINT-WITHOUT-PERSIST"]);
    const d = diagsOf(cell(`persist="local" key="k3" prepaint`));
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("§6.14.4.2");
  });

  test("E-HOLD-WITHOUT-PERSIST (§6.14.4.3 r2) — `hold=@x` naming a non-persisted cell; `hold=` on a persisted cell and any other operand form are refused", () => {
    const decls = `    let <x:int=0/>\n    let <p:int=0 persist="local" key="k4"/>`;
    expect(codes(P(decls, `        <section hold=@x><p>\${@x}</p></section>`))).toEqual(["E-HOLD-WITHOUT-PERSIST"]);
    expect(codes(P(decls, `        <section hold=@nope><p>a</p></section>`))).toEqual(["E-SCOPE-001", "E-HOLD-WITHOUT-PERSIST"]);
    const held = diagsOf(P(decls, `        <section hold=@p><p>\${@p}</p></section>`));
    expect(held.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(held[0].message).toContain("HOLD");
    expect(codes(P(decls, `        <section hold=(@p + 1)><p>a</p></section>`))).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    // inside a declaration's renders, the declaration's own field `p` shadows the persisted program cell
    const shadow = `<program>\n let <p:int=0 persist="local" key="k5"/>\n <box p:int=1/>\n renders <div hold=@p>\${p}</div>\n <main><box/></main>\n</program>\n`;
    expect(codes(shadow)).toEqual(["E-HOLD-WITHOUT-PERSIST"]);
  });

  test("E-PERSIST-LIN / -REVEALED / -DRAFT-OVERWRITTEN cannot be written in the bootstrap (no `lin` cell, no `reveal`, no `<request>`) — no source reaches them", () => {
    // the analyzer carries no code literal for them (the counter's "vacuous" rule would otherwise misread a pass)
    const { readFileSync } = require("node:fs");
    const src = readFileSync(require("node:path").join(import.meta.dir, "..", "analyze.scrml"), "utf8");
    for (const c of ["E-PERSIST-LIN", "E-PERSIST-REVEALED", "E-PERSIST-DRAFT-OVERWRITTEN"]) expect(src.includes(`"${c}"`)).toBe(false);
  });
});

describe("§6.14 — refused, never accepted-and-ignored (E-BOOTSTRAP-UNSUPPORTED)", () => {
  const one = (decls, needle) => {
    const d = diagsOf(P(decls, `        <p>x</p>`));
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain(needle);
  };

  test("a LOCKED cell and a DERIVED cell (O-061-10)", () => {
    one(`    <frozen:int=1 persist="local" key="r1"/>`, "LOCKED");
    one(`    let <n:int=0/>\n    <dbl:int=(@n * 2) persist="local" key="r2"/>`, "O-061-10");
  });

  test("\"local\" on a contract that refuses a whole-value write — no `replace`, or a `rule=` graph (O-061-5); \"session\" is accepted on both", () => {
    one(`    <log:string[free, append]=([]) persist="local" key="r3"/>`, "O-061-5");
    expect(codes(P(`    <log:string[free, append]=([]) persist="session" key="r3"/>`, `        <p>x</p>`))).toEqual([]);
    const engine = (store) => `<program>\n    type Phase:enum = { Idle, Busy }\n    <phase:Phase=.Idle single persist="${store}" key="r4">\n        <Idle rule=.Busy : "idle">\n        <Busy rule=.Idle : "busy">\n    </>\n    <main><p><*phase/></p></main>\n</program>\n`;
    const d = diagsOf(engine("local"));
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(d[0].message).toContain("`rule=` graph");
    expect(codes(engine("session"))).toEqual([]);
  });

  test("a type with no §57 wire form (a payload enum) and a FIXED-length sequence", () => {
    one(`    type Shape:enum = { Dot, Box(w: int) }\n    let <s:Shape=.Dot persist="local" key="r5"/>`, "payload");
    one(`    <xs:int[replace]=([1, 2]) persist="local" key="r6"/>`, "FIXED-length");
  });

  test("two cells under one storage + key; the same key in the OTHER storage is fine", () => {
    one(`    let <a:int=0 persist="local" key="dup"/>\n    let <b:int=0 persist="local" key="dup"/>`, "same key");
    expect(codes(P(`    let <a:int=0 persist="local" key="dup"/>\n    let <b:int=0 persist="session" key="dup"/>`, `        <p>x</p>`))).toEqual([]);
  });

  test("fix round (S239 MED-1): a word written twice in one opener is refused, never first-wins — any name", () => {
    const shapes = [
      [`    let <x:int=0 persist="local" persist="cookie" key="d1"/>`, "persist"],
      [`    let <x:int=0 persist="local" key="d2" key="d3"/>`, "key"],
      [`    let <x:int=0 persist="local" key="d4" prepaint prepaint/>`, "prepaint"],
      [`    let <q:int=0/>\n    let <x:int=0 reset-on=[@q] reset-on=[@q]/>`, "reset-on"],
      [`    let <x:string="" req req/>`, "req"],
    ];
    for (const [decls, w] of shapes) {
      const d = diagsOf(P(decls, `        <p>x</p>`));
      expect([w, d.some((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("`" + w + "` is written twice"))]).toEqual([w, true]);
    }
    // negative: validator CALLS with different arguments are a conjunction, each read — not a repeat
    expect(codes(P(`    let <x:string="" length(>2) length(<9)/>`, `        <p>x</p>`))).toEqual([]);
    // `single single` on an engine cell
    const eng = `<program>\n    type P:enum = { A, B }\n    <p:P=.A single single>\n        <A rule=.B : "a">\n        <B rule=.A : "b">\n    </>\n    <main><*p/></main>\n</program>\n`;
    expect(diagsOf(eng).some((x) => x.code === "E-BOOTSTRAP-UNSUPPORTED" && x.message.includes("`single` is written twice"))).toBe(true);
    // on a declaration's field too
    const field = `<program>\n <box a:int=1>\n  let <c:int=0 req req/>\n </>\n renders <p>\${a}</p>\n <main><box/></main>\n</program>\n`;
    expect(diagsOf(field).some((x) => x.message.includes("`req` is written twice"))).toBe(true);
    // the program never compiles to a persisted cell from the first `persist=`
    expect(run(P(`    let <x:int=0 persist="local" persist="cookie" key="d5"/>`, `        <p>x</p>`)).diags.length).toBeGreaterThan(0);
  });

  test("fix round: `key=\"\"` is refused (SPEC silent on an empty key)", () => {
    one(`    let <a:int=0 persist="local" key=""/>`, "empty key");
  });

  test("a computed `key=` (O-061-9) and `key=` without `persist=`", () => {
    one(`    let <a:int=0 persist="local" key=(@a)/>`, "O-061-9");
    one(`    let <a:int=0 key="k"/>`, "no `persist=`");
  });

  test("a `persist=\"local\"` cell as a `reset-on=` trigger (§6.8.4 rule 7 → O-061-5); a \"session\" trigger is accepted", () => {
    one(`    let <q:string="" persist="local" key="r7"/>\n    let <page:int=1 reset-on=[@q]/>`, "O-061-5");
    expect(codes(P(`    let <q:string="" persist="session" key="r7"/>\n    let <page:int=1 reset-on=[@q]/>`, `        <p>x</p>`))).toEqual([]);
  });

  test("`persist=` on a user declaration's own opener and on its field (§6.14.1 r3, O-061-9)", () => {
    const d = diagsOf(`<program>\n <box a:int=1 persist="local" key="r8">\n  let <c:int=0 persist="session" key="r9"/>\n </>\n renders <p>\${a}</p>\n <main><box/></main>\n</program>\n`);
    expect(d.map((x) => x.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED", "E-BOOTSTRAP-UNSUPPORTED"]);
    for (const x of d) expect(x.message).toContain("O-061-9");
  });
});

describe("Core check C16 (s451)", () => {
  test("a persisted field must be a writable program field with a wire descriptor; an Unpersist follows its own reset Write", () => {
    const core = coreOf(COUNTER("k16"));
    // a persisted DERIVED field: no write capability
    const c1 = structuredClone(core);
    fieldsOf(c1)[1].persist = { store: "Local", key: "x" };
    expect(mods.check.checkCore(c1).some((m) => m.startsWith("C16:") && m.includes("no write capability"))).toBe(true);
    // an Unpersist of a field that is not persisted
    const c2 = structuredClone(core);
    fieldsOf(c2)[0].persist = null;
    expect(mods.check.checkCore(c2).some((m) => m.startsWith("C16:") && m.includes("not persisted"))).toBe(true);
    // an Unpersist that does not follow its field's Write
    const c3 = structuredClone(core);
    const blocks = walkCore(c3, (n) => Array.isArray(n.stmts) && n.stmts.some((s) => s.variant === "Unpersist"));
    blocks[0].stmts.reverse();
    expect(mods.check.checkCore(c3).some((m) => m.startsWith("C16:") && m.includes("does not follow"))).toBe(true);
  });
});
