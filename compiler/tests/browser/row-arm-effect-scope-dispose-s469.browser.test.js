/**
 * row-arm-effect-scope-dispose-s469 — EXECUTES the emitted client JS and proves that
 * every effect created for an `<each>` row, or inside a dispatched `<match>` / engine
 * arm, is disposed when that row is removed or that arm is torn down.
 *
 * Gap: `g-row-and-arm-effect-scopes-never-disposed-s469` (MED; also the stale-effect
 * security class: an effect of removed content must not act again). Two faces of one
 * missing piece — an effect created for a row (or inside an arm) was registered with
 * nothing torn down with that row (or arm):
 *
 *   1. `_removeGroup` / `_clearAll` removed a row's nodes and disposed nothing; the dead
 *      row's effects stayed subscribed and RAN AGAIN, against detached nodes, whenever
 *      the key came back (measured 1,2,3,4 gate runs per write after 0..3 cycles).
 *   2. An arm teardown (arm switch, or the row-scoped `<match if=…>` false edge) called
 *      the arm's wire dispose, but the per-row effects of an `<each>` the arm mounted
 *      were never registered with it (measured +3 runs per write per flip).
 *
 * The fix (runtime-template.js): an OWNER SCOPE per row (opened by the reconciler
 * around `createFn`) and per dispatched arm (`_scrml_arm_scope`, around the wire fn
 * and the each remount). Scopes form a tree — a row's parent is the scope that owns
 * its list, an arm's parent the scope that owns its mount — and `_scrml_destroy_scope`
 * destroys children first. An effect remembers the scope it was created in, runs
 * every re-run inside it (so a row a list effect creates on a later pass is still
 * owned), and never runs again once that scope is destroyed.
 *
 * How this measures: the harness rebinds `_scrml_effect` / `_scrml_effect_static`
 * (function DECLARATIONS sharing one scope with the client JS) to wrappers that count
 * LIVE effects (+1 on create, -1 on the first dispose) and RUNS (every invocation of an
 * effect body). `subs(name)` reads the real subscriber set of a cell off
 * `_scrml_prop_subscribers`. A leak shows as growth in all three; the behavioural
 * half (a removed row's node is never written again) is asserted directly.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-row-arm-scope-s469");

// Between the runtime and the client body: count live effects and effect-body runs.
const INSTRUMENT = `
  globalThis.__fx = { live: 0, runs: 0 };
  const __orig_effect = _scrml_effect;
  const __orig_effect_static = _scrml_effect_static;
  const __wrap = (orig) => function (fn, gate) {
    const d = orig(function () { globalThis.__fx.runs++; return fn(); }, gate);
    globalThis.__fx.live++;
    let gone = false;
    return function () { if (!gone) { gone = true; globalThis.__fx.live--; } return d(); };
  };
  _scrml_effect = __wrap(__orig_effect);
  _scrml_effect_static = __wrap(__orig_effect_static);
`;

function compileAndMount(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? [])
    .filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""))
    .map((e) => e.code);
  if (errors.length > 0) return { errors, clientJs: "" };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n${INSTRUMENT}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__sd_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;
globalThis.__sd_subs = (n) => {
  const k = typeof _scrml_cs_key === "function" ? _scrml_cs_key(n) : n;
  const m = _scrml_prop_subscribers.get(_scrml_state);
  const s = m && m.get(k);
  return s ? s.size : 0;
};\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__sd_set(name, v); await flush(); };
const subs = (name) => globalThis.__sd_subs(name);
const live = () => globalThis.__fx.live;
const count = (sel) => document.querySelectorAll(sel).length;
/** Effect-body runs caused by one write of `name`. */
async function runsFor(name, v) {
  const before = globalThis.__fx.runs;
  await set(name, v);
  return globalThis.__fx.runs - before;
}

describe("row removal disposes the row's effects (face 1)", () => {
  test("THE REPRO — a row if= gate effect does not survive remove / re-add of its key", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1, t: "a" }]
<n> = 0
\${ function tick(v) { return v } }
<div id="out"><each in=@rows key=@.id as r><p><b if=tick(r.id > @n)>\${r.t}</b></p></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const baseSubs = subs("n");
    const baseLive = live();
    const perWrite = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      perWrite.push(await runsFor("n", cycle % 2));
      await set("rows", []);
      await set("rows", [{ id: 1, t: "a" }]);
    }
    // One live row: the gate runs once per write, every cycle (was 1,2,3,4).
    expect(perWrite).toEqual([1, 1, 1, 1]);
    expect(subs("n")).toBe(baseSubs);
    expect(live()).toBe(baseLive);
    expect(count("#out p")).toBe(1);
  });

  test("a removed row's node is never written again; its effects are gone at once (not on the next write)", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1, t: "a" }, { id: 2, t: "b" }]
<n> = 0
<div id="out"><each in=@rows key=@.id as r><p class="row">\${r.t}:\${@n}</p></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(subs("n")).toBe(2);
    const dead = [...document.querySelectorAll("#out p.row")].find((p) => p.textContent.startsWith("b"));
    await set("rows", [{ id: 1, t: "a" }]);
    // Disposed EAGERLY at removal — the subscriber is gone before any further write.
    expect(subs("n")).toBe(1);
    await set("n", 7);
    expect(dead.textContent).toBe("b:0");
    expect(document.querySelector("#out p.row").textContent).toBe("a:7");
    // Same key comes back: a FRESH row, the dead generation stays dead.
    await set("rows", [{ id: 1, t: "a" }, { id: 2, t: "b" }]);
    await set("n", 8);
    expect(dead.textContent).toBe("b:0");
    expect([...document.querySelectorAll("#out p.row")].map((p) => p.textContent)).toEqual(["a:8", "b:8"]);
    expect(subs("n")).toBe(2);
  });

  test("clear-all (empty list), null collection, and the <empty> fallback dispose every row", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }, { id: 3 }]
<n> = 0
<div id="out"><each in=@rows key=@.id as r><p class="row">\${r.id}:\${@n}</p><empty><i class="none">none \${@n}</i></empty></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    for (let i = 0; i < 5; i++) {
      await set("rows", []);
      expect(count("#out i.none")).toBe(1);
      await set("rows", [{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(count("#out p.row")).toBe(3);
    }
    expect(subs("n")).toBe(base);
    await set("n", 4);
    expect([...document.querySelectorAll("#out p.row")].map((p) => p.textContent)).toEqual(["1:4", "2:4", "3:4"]);
  });

  test("a gated row whose head is the PLACEHOLDER when removed is still disposed", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
<on> = false
<div id="out"><each in=@rows key=@.id as r><b class="g" if=@on>\${r.id}:\${@n}</b></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    const baseOn = subs("on");
    for (let i = 0; i < 4; i++) {
      await set("on", i % 2 === 0);
      await set("rows", [{ id: 1 }]);
      await set("rows", [{ id: 1 }, { id: 2 }]);
    }
    expect(subs("n")).toBe(base);
    expect(subs("on")).toBe(baseOn);
  });

  test("multi-root item: every root's effects die with the group", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
<div id="out"><each in=@rows key=@.id as r><b class="x">\${r.id}:\${@n}</b><i class="y">\${@n}</i></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    expect(base).toBe(4);
    for (let i = 0; i < 4; i++) {
      await set("rows", [{ id: 2 }]);
      expect(subs("n")).toBe(2);
      await set("rows", [{ id: 2 }, { id: 1 }]);
    }
    expect(subs("n")).toBe(base);
    expect(await runsFor("n", 9)).toBe(4);
  });

  test("nested each: removing the outer row disposes the inner rows and the inner list effect", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1, kids: [1, 2] }, { id: 2, kids: [3] }]
<n> = 0
<div id="out"><each in=@rows key=@.id as r><div class="row"><each in=r.kids as k><i class="kid">\${k}:\${@n}</i></each></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    const baseLive = live();
    expect(base).toBe(3);
    for (let i = 0; i < 4; i++) {
      await set("rows", [{ id: 2, kids: [3] }]);
      expect(subs("n")).toBe(1);
      await set("rows", [{ id: 1, kids: [1, 2] }, { id: 2, kids: [3] }]);
    }
    expect(subs("n")).toBe(base);
    expect(live()).toBe(baseLive);
    expect(await runsFor("n", 5)).toBe(3);
  });

  test("an inner list that first reconciles on a LATER pass is still owned by its row", async () => {
    // The inner each is gated off at create time, so its first reconcile happens on a
    // re-run of its list effect (outside createFn). Its rows must still die with the row.
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<kids> = [1, 2, 3]
<show> = false
<n> = 0
<div id="out"><each in=@rows key=@.id as r><div class="row"><each in=@kids as k if=@show><i class="kid">\${k}:\${@n}</i></each></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    await set("show", true);
    expect(count("#out i.kid")).toBe(6);
    expect(subs("n")).toBe(base + 6);
    await set("rows", [{ id: 1 }]);
    expect(subs("n")).toBe(base + 3);
    await set("rows", []);
    expect(subs("n")).toBe(base);
  });
});

const PHASE = `type Phase:enum = { Idle, Active }
<ph>: Phase = .Idle
`;

describe("arm teardown disposes the effects of everything the arm mounted (face 2)", () => {
  test("THE REPRO — row-scoped <match if=…> flips do not accumulate the inner each's effects", async () => {
    const app = compileAndMount(`${PHASE}<shown> = true
<n> = 0
<xs> = [1]
<cells> = [1, 2, 3]
\${ function tick(v) { return v } }
<div id="out"><each in=@xs as y><match for=Phase on=@ph if=@shown><Idle><each in=@cells as c><b>\${tick(@n)}</b></each></Idle><Active><i>a</i></Active></match></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const base = subs("n");
    const perWrite = [];
    for (let flip = 0; flip < 5; flip++) {
      perWrite.push(await runsFor("n", flip + 1));
      await set("shown", false);
      expect(subs("n")).toBe(0);
      await set("shown", true);
    }
    // 3 live inner rows: 3 runs per write, every flip (was 3,6,9,12,15).
    expect(perWrite).toEqual([3, 3, 3, 3, 3]);
    expect(subs("n")).toBe(base);
  });

  test("arm switch of a TOP-LEVEL <match>: the leaving arm's each rows are disposed", async () => {
    const app = compileAndMount(`${PHASE}<n> = 0
<cells> = [1, 2]
<div id="out"><match for=Phase on=@ph><Idle><each in=@cells as c><b class="c">\${c}:\${@n}</b></each></Idle><Active><i>\${@n}</i></Active></match></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out b.c")).toBe(2);
    const idleSubs = subs("n");
    let cells = 2;
    for (let i = 0; i < 5; i++) {
      await set("ph", "Active");
      expect(count("#out b.c")).toBe(0);
      expect(subs("n")).toBe(1);
      await set("ph", "Idle");
      expect(count("#out b.c")).toBe(cells);
      expect(subs("n")).toBe(cells);
      // A list change while the arm is up creates rows on a LATER reconcile pass.
      cells = i % 2 === 0 ? 3 : 2;
      await set("cells", cells === 3 ? [1, 2, 3] : [1, 2]);
      expect(subs("n")).toBe(cells);
    }
    await set("cells", [1, 2]);
    expect(subs("n")).toBe(idleSubs);
    await set("ph", "Active");
    expect(subs("n")).toBe(1);
  });

  test("removing a ROW disposes its mounted arm and the arm's each rows", async () => {
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
<cells> = [1, 2]
<div id="out"><each in=@rows key=@.id as r><div class="row"><match for=Phase on=@ph><Idle><span class="s">\${@n}</span><each in=@cells as c><b class="c">\${c}:\${@n}</b></each></Idle><Active><i>a</i></Active></match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out b.c")).toBe(4);
    const baseLive = live();
    // Warm-up cycle: a row built on a reconcile pass carries one more `@n` subscriber
    // than a row built at boot (its dispatcher effect also tracks the arm's `${@n}`
    // read — pre-existing, identical on main), so the steady state is measured after it.
    await set("rows", [{ id: 2 }]);
    const half = subs("n");
    await set("rows", [{ id: 1 }, { id: 2 }]);
    const base = subs("n");
    for (let i = 0; i < 4; i++) {
      await set("rows", [{ id: 2 }]);
      expect(subs("n")).toBe(half);
      await set("rows", [{ id: 1 }, { id: 2 }]);
      expect(subs("n")).toBe(base);
      expect(live()).toBe(baseLive);
    }
    expect(count("#out b.c")).toBe(4);
    await set("rows", []);
    expect(subs("n")).toBe(0);
  });

  test("an engine arm's each rows are disposed on arm exit", async () => {
    const app = compileAndMount(`${PHASE}<n> = 0
<cells> = [1, 2]
<engine for=Phase initial=.Idle>
  <Idle><each in=@cells as c><b class="c">\${c}:\${@n}</b></each></Idle>
  <Active><i class="a">active</i></Active>
</engine>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("b.c")).toBe(2);
    const base = subs("n");
    const baseLive = live();
    for (let i = 0; i < 3; i++) {
      // The engine's own cell is the lower-cased type name.
      await set("phase", "Active");
      expect(count("i.a")).toBe(1);
      expect(count("b.c")).toBe(0);
      // Including the rows rendered into the INITIAL arm's static HTML at boot, which
      // no arm scope owns (released by the dispatcher before its innerHTML replace).
      expect(subs("n")).toBe(0);
      await set("phase", "Idle");
      expect(count("b.c")).toBe(2);
      expect(subs("n")).toBe(base);
      expect(live()).toBe(baseLive);
    }
  });
});

describe("self-attack — a removed row's effect must not act, even within the write that removed it", () => {
  test("the SAME write removes the row and changes what its arm reads: the detached arm is never written", async () => {
    // One write of @rows (a) re-renders the list, removing row 1, and (b) is read by the
    // arm mounted in row 1. The write's effect snapshot still holds row 1's arm effect
    // when it runs after the list effect; it must find its owner dead and not run.
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1 }, { id: 2 }]
<div id="out"><each in=@rows key=@.id as r><div class="row"><match for=Phase on=@ph><Idle><span class="len">\${@rows.length}</span></Idle><Active><i>a</i></Active></match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const spans = [...document.querySelectorAll("#out span.len")];
    expect(spans.map((s) => s.textContent)).toEqual(["2", "2"]);
    const dead = spans[0];
    await set("rows", [{ id: 2 }]);
    expect(dead.isConnected).toBe(false);
    expect(dead.textContent).toBe("2");
    expect([...document.querySelectorAll("#out span.len")].map((s) => s.textContent)).toEqual(["1"]);
    // And never again, whatever is written later — including the key coming back.
    await set("rows", [{ id: 2 }, { id: 3 }, { id: 1 }]);
    expect(dead.textContent).toBe("2");
    expect([...document.querySelectorAll("#out span.len")].map((s) => s.textContent)).toEqual(["3", "3", "3"]);
  });

  test("a row removed while its arm is switching does not keep the new arm alive", async () => {
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
<div id="out"><each in=@rows key=@.id as r><div class="row"><match for=Phase on=@ph><Idle><b>\${@n}</b></Idle><Active><s>\${@n}</s></Active></match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const rebuilt = [];
    for (let i = 0; i < 4; i++) {
      await set("ph", i % 2 === 0 ? "Active" : "Idle");
      await set("rows", [{ id: 2 }]);
      await set("rows", [{ id: 1 }, { id: 2 }]);
      rebuilt.push(subs("n"));
    }
    // Flat across switch + remove/re-add cycles (no generation survives).
    expect(new Set(rebuilt).size).toBe(1);
    await set("rows", []);
    expect(subs("n")).toBe(0);
    await set("ph", "Active");
    await set("n", 5);
    expect(count("#out .row")).toBe(0);
    expect(subs("n")).toBe(0);
  });
});

describe("a mount's owner is where it lives, never whoever writes first (round 2, F1)", () => {
  // A row's template writes the scrutinee of a TOP-LEVEL <match> / <engine> during the
  // module-init row render, so the top-level mount's FIRST dispatch happens while that row's
  // scope is active. Round 1 filed the top-level arm under the row: removing the row then
  // killed every arm the mount ever dispatched (stale content, no reactivity).
  const POKE = `\${ function poke(x) { if (x == 1) { @ph = .Active } return x } }
<div id="out"><each in=@rows key=@.id as r><p class="row">\${poke(r.id)}</p></each></div>
`;
  async function expectLive(sel) {
    await set("n", 3);
    expect(document.querySelector(sel.a).textContent).toBe("3");
    await set("rows", [{ id: 2 }]);
    await set("n", 4);
    expect(document.querySelector(sel.a).textContent).toBe("4");
    await set("ph", "Idle");
    await set("n", 5);
    expect(document.querySelector(sel.i).textContent).toBe("5");
    await set("ph", "Active");
    await set("n", 6);
    expect(document.querySelector(sel.a).textContent).toBe("6");
  }

  test("THE REPRO — top-level <match> first dispatched from inside a row stays alive after the row goes", async () => {
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
${POKE}<div id="top"><match for=Phase on=@ph><Idle><b class="i">\${@n}</b></Idle><Active><s class="a">\${@n}</s></Active></match></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    await expectLive({ a: "#top s.a", i: "#top b.i" });
  });

  test("the same with a top-level <engine>", async () => {
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
\${ function poke(x) { if (x == 1) { @phase = .Active } return x } }
<div id="out"><each in=@rows key=@.id as r><p class="row">\${poke(r.id)}</p></each></div>
<div id="top"><engine for=Phase initial=.Idle><Idle rule=.Active><b class="i">\${@n}</b></Idle><Active rule=.Idle><s class="a">\${@n}</s></Active></engine></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const setPh = (v) => set("phase", v);
    await set("n", 3);
    expect(document.querySelector("#top s.a")?.textContent).toBe("3");
    await set("rows", [{ id: 2 }]);
    await set("n", 4);
    expect(document.querySelector("#top s.a").textContent).toBe("4");
    await setPh("Idle");
    await set("n", 5);
    expect(document.querySelector("#top b.i").textContent).toBe("5");
  });

  test("a top-level <each> whose render is triggered from inside a row keeps its rows after that row goes", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<xs> = []
<n> = 0
\${ function poke(x) { if (x == 1) { @xs = [7, 8] } return x } }
<div id="out"><each in=@rows key=@.id as r><p class="row">\${poke(r.id)}</p></each></div>
<div id="top"><each in=@xs as x><i class="x">\${x}:\${@n}</i></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    await set("rows", [{ id: 2 }]);
    await set("n", 4);
    expect([...document.querySelectorAll("#top i.x")].map((e) => e.textContent)).toEqual(["7:4", "8:4"]);
  });

  test("a top-level if= block first evaluated from a row write stays reactive after that row goes", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<on> = false
<n> = 0
\${ function poke(x) { if (x == 1) { @on = true } return x } }
<div id="out"><each in=@rows key=@.id as r><p class="row">\${poke(r.id)}</p></each></div>
<div id="top"><b class="g" if=@on>\${@n}</b></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    await set("rows", [{ id: 2 }]);
    await set("n", 4);
    expect(document.querySelector("#top b.g")?.textContent).toBe("4");
    await set("on", false);
    expect(document.querySelector("#top b.g")).toBeNull();
    await set("on", true);
    await set("n", 5);
    expect(document.querySelector("#top b.g")?.textContent).toBe("5");
  });

  test("a derived cell first read in a row stays live after that row goes", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1 }, { id: 2 }]
<n> = 0
const <twice> = @n * 2
<div id="out"><each in=@rows key=@.id as r><p class="row">\${r.id}:\${@twice}</p></each></div>
<div id="top"><b class="d">\${@twice}</b></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    await set("rows", [{ id: 2 }]);
    await set("n", 4);
    expect(document.querySelector("#top b.d").textContent).toBe("8");
    expect(document.querySelector("#out p.row").textContent).toBe("2:8");
  });
});

describe("randomized add / remove / switch stress — subscriber count returns to baseline", () => {
  // Deterministic PRNG so a failure reproduces.
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  test("rows × arms × nested each × row if=, 300 random steps", async () => {
    const app = compileAndMount(`${PHASE}<rows> = [{ id: 1, kids: [1] }]
<n> = 0
<shown> = true
<on> = true
<cells> = [1, 2]
<div id="out"><each in=@rows key=@.id as r><div class="row"><b if=@on>\${r.id}:\${@n}</b><each in=r.kids as k><i class="kid">\${k}:\${@n}</i></each><match for=Phase on=@ph if=@shown><Idle><each in=@cells as c><u>\${c}:\${@n}</u></each></Idle><Active><s>\${@n}</s></Active></match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    // Baseline = the same state reached fresh: empty list.
    await set("rows", []);
    const empty = subs("n");
    const emptyLive = live();
    const rand = rng(0x5469);
    let rows = [];
    for (let step = 0; step < 300; step++) {
      const op = rand();
      if (op < 0.35) {
        const id = 1 + Math.floor(rand() * 8);
        if (!rows.some((x) => x.id === id)) rows = [...rows, { id, kids: Array.from({ length: Math.floor(rand() * 3) }, (_, i) => i) }];
        await set("rows", rows);
      } else if (op < 0.6) {
        if (rows.length) rows = rows.filter((_, i) => i !== Math.floor(rand() * rows.length));
        await set("rows", rows);
      } else if (op < 0.7) {
        rows = [...rows].reverse();
        await set("rows", rows);
      } else if (op < 0.78) {
        await set("ph", rand() < 0.5 ? "Idle" : "Active");
      } else if (op < 0.86) {
        await set("shown", rand() < 0.6);
      } else if (op < 0.93) {
        await set("on", rand() < 0.5);
      } else {
        await set("cells", Array.from({ length: Math.floor(rand() * 4) }, (_, i) => i));
      }
      // Every write of @n reaches exactly the live effects that read it.
      if (step % 25 === 0) {
        const s = subs("n");
        expect(await runsFor("n", step)).toBe(s);
      }
    }
    await set("rows", []);
    expect(subs("n")).toBe(empty);
    expect(live()).toBe(emptyLive);
    expect(count("#out .row")).toBe(0);
  });
});
