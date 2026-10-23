/**
 * lift-if-render-gate-s469 — EXECUTES the emitted client JS for a markup `if=` inside LIFTED
 * markup: a `for … lift` row (sole root, nested element, multi-root root, value-indexed
 * predicate, lift in lift), a non-loop `if … lift` / bare `lift`, a markup value (a function
 * returning markup, a ternary), an `<each>` that IS the lifted root, and a lift inside an
 * `<each>` inside a `<match>` arm.
 *
 * Gap: `g-lift-row-if-is-display-toggle-not-a-render-gate-s462` (+ its cluster). Every position
 * but one lowered to `el.style.display = cond ? "" : "none"`: the element — its text, its
 * subtree, its listeners — stayed in the DOM while the condition was false. SPEC §17.1: "When
 * `expr` evaluates to false … the element is NOT rendered. It does not exist in the DOM", and it
 * is re-evaluated whenever anything it reads changes, in both directions.
 *
 * Every case drives compile → mount → write cells in happy-dom with the PRUNED runtime the
 * build ships, and asserts ABSENCE (not `display`), both directions, more than once.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-lift-if-render-gate-s469");

function compileAndMount(source, baseName = "app", runtimePatch = "") {
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
    `${runtimeJs}\n${runtimePatch}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__s469l_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n` +
      `globalThis.__s469l_get = typeof _scrml_cs_reactive_get === "function" ? _scrml_cs_reactive_get : _scrml_reactive_get;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__s469l_set(name, v); await flush(); };
const get = (name) => globalThis.__s469l_get(name);
const count = (sel) => document.querySelectorAll(sel).length;
const text = (sel) => document.querySelector(sel)?.textContent ?? null;

/** Mount, then assert the guard closes, opens, closes and opens again — by PRESENCE. */
async function expectReactiveGate(app, { cell, off, on, sel, openCount, startsOpen = false }) {
  expect(app.errors).toEqual([]);
  // The defect's lowering is gone from the artifact.
  expect(app.clientJs).not.toMatch(/style\.display\s*=/);
  await flush();
  expect(count(sel)).toBe(startsOpen ? openCount : 0);
  await set(cell, startsOpen ? off : on);
  expect(count(sel)).toBe(startsOpen ? 0 : openCount);
  await set(cell, startsOpen ? on : off);
  expect(count(sel)).toBe(startsOpen ? openCount : 0);
  await set(cell, startsOpen ? off : on);
  expect(count(sel)).toBe(startsOpen ? 0 : openCount);
}

describe("a markup if= in a `for … lift` row is a render gate at every position (§17.1)", () => {
  test("THE DEFECT — a nested element: revoked, it leaves the DOM (was display:none, text still there)", async () => {
    const app = compileAndMount(`<pw> = "secret"
<xs> = [1, 2]
<div id="out">\${ for (x of @xs) { lift <span><b class="g" if=(@pw != "wrong")>LOGGED IN</b></span> } }</div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 2, startsOpen: true });
    await set("pw", "wrong");
    expect(text("#out")).toBe("");
  });

  test("false REMOVES the element and a placeholder holds its place (same position on return)", async () => {
    const app = compileAndMount(`<shown> = true
<xs> = [1]
<div id="out">\${ for (x of @xs) { lift <span class="host"><i>a</i><b class="g" if=@shown>b</b><i>c</i></span> } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(text(".host")).toBe("abc");
    await set("shown", false);
    expect(count("#out b.g")).toBe(0);
    expect(text(".host")).toBe("ac");
    expect([...document.querySelector(".host").childNodes].some((n) => n.nodeType === 8)).toBe(true);
    await set("shown", true);
    expect(text(".host")).toBe("abc");
  });

  test("its handler is unreachable while false: no element to click, and a held reference's .click() runs nothing", async () => {
    const app = compileAndMount(`<ok> = true
<hits> = 0
<xs> = [1]
<div id="out">\${ for (x of @xs) { lift <span><button class="g" if=@ok onclick=\${ @hits = @hits + 1 }>go</button></span> } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const btn = document.querySelector("#out button.g");
    btn.click();
    await flush();
    expect(get("hits")).toBe(1);
    await set("ok", false);
    expect(document.querySelector("#out button.g")).toBeNull();
    expect(btn.isConnected).toBe(false);
    btn.click();                         // the held, detached element
    await flush();
    expect(get("hits")).toBe(1);
    await set("ok", true);
    expect(document.querySelector("#out button.g")).toBe(btn); // built once, re-mounted
    btn.click();
    await flush();
    expect(get("hits")).toBe(2);
  });

  test("the sole row root and nested 3 deep; a call-ref guard; lift in lift", async () => {
    await expectReactiveGate(compileAndMount(`<ok> = false
<xs> = [1, 2, 3]
<div id="out">\${ for (x of @xs) { lift <b class="g" if=@ok>x</b> } }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 3 });
    await expectReactiveGate(compileAndMount(`<ok> = false
<xs> = [1]
<div id="out">\${ for (x of @xs) { lift <span><em><u><b class="g" if=@ok>x</b></u></em></span> } }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
    await expectReactiveGate(compileAndMount(`\${ function allowed(p) { return p == "secret" } }
<pw> = ""
<xs> = [1]
<div id="out">\${ for (x of @xs) { lift <span><b class="g" if=allowed(@pw)>x</b></span> } }</div>
`), { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 1 });
    await expectReactiveGate(compileAndMount(`<ok> = false
<xs> = [1, 2]
<div id="out">\${ for (y of @xs) { lift <div>\${ for (x of @xs) { lift <span><b class="g" if=@ok>x</b></span> } }</div> } }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 4 });
    // A QUOTED condition is the expression (was written as an `if` attribute: ungated).
    await expectReactiveGate(compileAndMount(`<n> = 0
<xs> = [1]
<div id="out">\${ for (x of @xs) { lift <span><b class="g" if="@n >= 3">x</b></span> } }</div>
`), { cell: "n", off: 1, on: 5, sel: "#out b.g", openCount: 1 });
  });

  test("a row-reading guard follows the live item — in-place write, same-key replace, keyed reorder", async () => {
    const app = compileAndMount(`<items> = [{ id: 1, name: "a", ok: true }, { id: 2, name: "b", ok: false }]
<button id="flip" onclick=\${ @items[1].ok = true }>flip</button>
<div id="out">\${ for (r of @items) { lift <div class="row"><span class="lbl">\${r.name}</span><b class="g" if=r.ok>G</b></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    const rows = () => [...document.querySelectorAll("#out .row")].map((r) => [r.querySelector(".lbl").textContent, r.querySelector("b.g") ? "G" : "-"]);
    await flush();
    expect(rows()).toEqual([["a", "G"], ["b", "-"]]);
    document.querySelector("#flip").click();
    await flush();
    expect(rows()).toEqual([["a", "G"], ["b", "G"]]);
    await set("items", [{ id: 2, name: "b", ok: false }, { id: 1, name: "a", ok: true }]);
    expect(rows()).toEqual([["b", "-"], ["a", "G"]]);
    await set("items", [{ id: 2, name: "b", ok: true }, { id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["b", "G"], ["a", "-"]]);
  });

  test("one root of a MULTI-root row: removed while false; reorder / delete keep the group in order", async () => {
    const app = compileAndMount(`<items> = [{ id: 1, n: "a", on: true }, { id: 2, n: "b", on: false }, { id: 3, n: "c", on: true }]
<div id="out">\${ for (r of @items) { lift <b class="g" if=r.on>\${r.n}</b>
 lift <i>\${r.n}</i> } }</div>
`);
    expect(app.errors).toEqual([]);
    const seq = () => [...document.querySelector("#out").querySelectorAll("b, i")].map((e) => `${e.tagName}${e.textContent}`).join(" ");
    await flush();
    expect(seq()).toBe("Ba Ia Ib Bc Ic");
    await set("items", [{ id: 3, n: "c", on: false }, { id: 2, n: "b", on: true }, { id: 1, n: "a", on: true }]);
    expect(seq()).toBe("Ic Bb Ib Ba Ia");
    await set("items", [{ id: 3, n: "c", on: true }, { id: 1, n: "a", on: false }]);
    expect(seq()).toBe("Bc Ic Ia");
    expect(count("#out b")).toBe(1);
  });

  test("value-indexed: a write runs the swap for the OLD and NEW rows only (O(2)), not every row", async () => {
    // Count every swap call the runtime makes.
    const patch = `globalThis.__s469l_swaps = 0; { const _orig = _scrml_ifrow_apply; _scrml_ifrow_apply = function (c, e, p, on) { globalThis.__s469l_swaps++; return _orig(c, e, p, on); }; }`;
    const ids = Array.from({ length: 40 }, (_, i) => `{ id: ${i + 1} }`).join(", ");
    const app = compileAndMount(`<sel> = 0
<items> = [${ids}]
<div id="out">\${ for (r of @items) { lift <div class="row"><b class="g" if=(@sel == r.id)>E</b></div> } }</div>
`, "app", patch);
    expect(app.errors).toEqual([]);
    await flush();
    globalThis.__s469l_swaps = 0;
    await set("sel", 7);
    expect(count("#out b.g")).toBe(1);
    expect(globalThis.__s469l_swaps).toBe(1);   // bucket 0 is empty; bucket 7 holds one row
    globalThis.__s469l_swaps = 0;
    await set("sel", 9);
    expect(count("#out b.g")).toBe(1);
    expect(globalThis.__s469l_swaps).toBe(2);   // row 7 closes, row 9 opens
  });

  test("value-indexed, the ROW side: a same-key replace that changes the row's field moves the gate", async () => {
    const app = compileAndMount(`<sel> = "a"
<items> = [{ id: 1, k: "a" }, { id: 2, k: "b" }]
<button id="edit" onclick=\${ @items[1].k = "a" }>edit</button>
<div id="out">\${ for (r of @items) { lift <div class="row" data-k=\${r.id}><b class="g" if=(@sel == r.k)>E</b></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    const on = () => [...document.querySelectorAll("#out .row")].filter((r) => r.querySelector("b.g")).map((r) => r.getAttribute("data-k"));
    await flush();
    expect(on()).toEqual(["1"]);
    await set("items", [{ id: 1, k: "z" }, { id: 2, k: "b" }]);   // row 1 revoked by its own data
    expect(on()).toEqual([]);
    await set("sel", "b");
    expect(on()).toEqual(["2"]);
    await set("sel", "z");                                         // the bucket moved with the row
    expect(on()).toEqual(["1"]);
    document.querySelector("#edit").click();                       // an in-place field write
    await flush();
    expect(on()).toEqual(["1"]);
    await set("sel", "a");
    expect(on()).toEqual(["2"]);
  });

  test("the value-indexed `@sel == r.id` predicate is structural and keeps its O(2) dispatch", async () => {
    const app = compileAndMount(`<sel> = 0
<items> = [{ id: 1 }, { id: 2 }, { id: 3 }]
<div id="out">\${ for (r of @items) { lift <div class="row" data-k=\${r.id}><b class="g" if=(@sel == r.id)>E</b></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    expect(app.clientJs).toMatch(/_scrml_cs_reactive_subscribe_when\("sel"/);
    expect(app.clientJs).not.toMatch(/style\.display\s*=/);
    const on = () => [...document.querySelectorAll("#out .row")].filter((r) => r.querySelector("b.g")).map((r) => r.getAttribute("data-k"));
    await flush();
    expect(on()).toEqual([]);
    await set("sel", 2);
    expect(on()).toEqual(["2"]);
    await set("sel", 3);
    expect(on()).toEqual(["3"]);
    await set("sel", 3);
    expect(on()).toEqual(["3"]);
    await set("sel", 0);
    expect(on()).toEqual([]);
  });
});

describe("a markup if= in non-loop lifted markup and markup values is a render gate (§17.1)", () => {
  test("an `if … lift` arm: the root and a nested element", async () => {
    await expectReactiveGate(compileAndMount(`<ok> = false
<div id="out">\${ if (true) { lift <b class="g" if=@ok>x</b> } }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
    await expectReactiveGate(compileAndMount(`<ok> = true
<div id="out">\${ if (true) { lift <span><b class="g" if=@ok>x</b></span> } }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1, startsOpen: true });
  });

  test("an `if … lift` arm keeps a sibling input's state across flips (the arm does not re-render)", async () => {
    const app = compileAndMount(`<ok> = true
<show> = true
<div id="out">\${ if (@show) { lift <div><input id="field"><b class="g" if=@ok>x</b></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const field = document.querySelector("#field");
    field.value = "typed";
    await set("ok", false);
    expect(count("#out b.g")).toBe(0);
    await set("ok", true);
    expect(count("#out b.g")).toBe(1);
    expect(document.querySelector("#field")).toBe(field);
    expect(field.value).toBe("typed");
  });

  test("a bare `lift`: the root and a nested element", async () => {
    await expectReactiveGate(compileAndMount(`<ok> = false
<div id="out">\${ lift <b class="g" if=@ok>x</b> }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
    await expectReactiveGate(compileAndMount(`<ok> = false
<div id="out">\${ lift <span><b class="g" if=@ok>x</b></span> }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
  });

  test("a deep field write (`@u.ok = …`) re-evaluates the gate — bare lift, if-lift arm, for-lift row", async () => {
    for (const wrap of [
      (b) => `\${ lift <span>${b}</span> }`,
      (b) => `\${ if (true) { lift <span>${b}</span> } }`,
      (b) => `\${ for (x of @xs) { lift <span>${b}</span> } }`,
    ]) {
      const app = compileAndMount(`<u> = { ok: true }
<xs> = [1]
<button id="off" onclick=\${ @u.ok = false }>off</button>
<button id="on" onclick=\${ @u.ok = true }>on</button>
<div id="out">${wrap(`<b class="g" if=@u.ok>x</b>`)}</div>
`);
      expect(app.errors).toEqual([]);
      await flush();
      expect(count("#out b.g")).toBe(1);
      document.querySelector("#off").click();
      await flush();
      expect(count("#out b.g")).toBe(0);
      document.querySelector("#on").click();
      await flush();
      expect(count("#out b.g")).toBe(1);
      document.querySelector("#off").click();
      await flush();
      expect(count("#out b.g")).toBe(0);
    }
  });

  test("a function returning markup, and a ternary markup value", async () => {
    await expectReactiveGate(compileAndMount(`<ok> = false
\${ function pill() { return <span><b class="g" if=@ok>x</b></span> } }
<div id="out">\${ pill() }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
    await expectReactiveGate(compileAndMount(`<ok> = false
<div id="out">\${ true ? <span><b class="g" if=@ok>x</b></span> : "" }</div>
`), { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1 });
  });
});

describe("an <each> that IS the lifted root is a list, and its if= gates it", () => {
  test("it iterates (alias bound) and its guard is honoured both ways", async () => {
    const app = compileAndMount(`<ok> = false
<xs> = ["p", "q"]
<div id="out">\${ if (true) { lift <each in=@xs as y if=@ok><span class="g">\${y}</span></each> } }</div>
`);
    await expectReactiveGate(app, { cell: "ok", off: false, on: true, sel: "#out span.g", openCount: 2 });
    await set("ok", true);
    expect([...document.querySelectorAll("#out span.g")].map((e) => e.textContent)).toEqual(["p", "q"]);
    await set("xs", ["p", "q", "r"]);
    expect(count("#out span.g")).toBe(3);
  });
});

describe("a lift inside an <each> inside a <match> arm", () => {
  test("the gate is reactive both ways, and survives leaving and re-entering the arm", async () => {
    const app = compileAndMount(`type Phase:enum = { Idle, Active }
<ph>: Phase = .Idle
<ok> = false
<xs> = [1, 2]
<div id="out"><match for=Phase on=@ph><Idle><each in=@xs as y><div>\${ for (x of @xs) { lift <span><b class="g" if=@ok>G</b></span> } }</div></each></Idle><Active><p class="act">A</p></Active></match></div>
`);
    await expectReactiveGate(app, { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 4 });
    await set("ph", "Active");
    expect(count("#out b.g")).toBe(0);
    expect(count("#out .act")).toBe(1);
    await set("ph", "Idle");
    expect(count("#out b.g")).toBe(4);
    await set("ok", false);
    expect(count("#out b.g")).toBe(0);
  });
});

describe("S469 round 2 — F1: a cell read through a function call is a dependency of the gate", () => {
  for (const [name, wrap] of [
    ["a bare lift", (b) => `\${ lift <span>${b}</span> }`],
    ["an `if … lift` arm", (b) => `\${ if (true) { lift <span>${b}</span> } }`],
    ["a `for` over a non-reactive iterable", (b) => `\${ for (x of [1, 2]) { lift <span>${b}</span> } }`],
    ["a reactive `for … lift` row", (b) => `\${ for (x of @xs) { lift <span>${b}</span> } }`],
  ]) {
    for (const guard of ["isAdmin()", "(isAdmin() && true)"]) {
      test(`${name}, if=${guard}: revoked through the function, the element leaves (and returns)`, async () => {
        const app = compileAndMount(`<role> = "admin"
<xs> = [1, 2]
\${ function isAdmin() { return @role == "admin" } }
<div id="out">${wrap(`<b class="g" if=${guard}>x</b>`)}</div>
`);
        const open = name.startsWith("a bare") || name.startsWith("an `if") ? 1 : 2;
        await expectReactiveGate(app, { cell: "role", off: "user", on: "admin", sel: "#out b.g", openCount: open, startsOpen: true });
        // No text reader decides the dependencies any more.
        expect(app.clientJs).not.toMatch(/_scrml_cs_reactive_subscribe\(/);
      });
    }
  }
});

describe("S469 round 2 — F2: a removed row releases its gate (value bucket + effect)", () => {
  test("100 rows, `@items = []` then the same ids again × 10: the swaps per two `@sel` writes stay constant", async () => {
    const patch = `globalThis.__s469l_swaps = 0; { const _orig = _scrml_ifrow_apply; _scrml_ifrow_apply = function (c, e, p, on) { globalThis.__s469l_swaps++; return _orig(c, e, p, on); }; }`;
    const rowsOf = () => Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const app = compileAndMount(`<sel> = 0
<items> = [${Array.from({ length: 100 }, (_, i) => `{ id: ${i + 1} }`).join(", ")}]
<div id="out">\${ for (r of @items) { lift <div class="row"><b class="g" if=(@sel == r.id)>E</b></div> } }</div>
`, "app", patch);
    expect(app.errors).toEqual([]);
    await flush();
    const perCycle = [];
    let oldRow5 = null;
    for (let cycle = 0; cycle < 10; cycle++) {
      oldRow5 = document.querySelectorAll("#out .row")[4];
      await set("sel", 0);
      await set("items", []);
      await set("items", rowsOf());
      globalThis.__s469l_swaps = 0;
      await set("sel", 5);
      await set("sel", 6);
      perCycle.push(globalThis.__s469l_swaps);
      expect(count("#out b.g")).toBe(1);
      // The removed row's updater no longer runs: its gated content stays closed.
      await set("sel", 5);
      expect(oldRow5.isConnected).toBe(false);
      expect(oldRow5.querySelector("b.g")).toBeNull();
    }
    expect(perCycle).toEqual(Array(10).fill(3)); // 5 opens (1), then 5 closes + 6 opens (2)
  });

  test("a non-value-indexed row gate stops running once its row is removed", async () => {
    const patch = `globalThis.__s469l_swaps = 0; { const _orig = _scrml_ifrow_apply; _scrml_ifrow_apply = function (c, e, p, on) { globalThis.__s469l_swaps++; return _orig(c, e, p, on); }; }`;
    const app = compileAndMount(`<ok> = true
<items> = [{ id: 1 }, { id: 2 }]
<div id="out">\${ for (r of @items) { lift <div class="row"><b class="g" if=@ok>E</b></div> } }</div>
`, "app", patch);
    expect(app.errors).toEqual([]);
    await flush();
    const counts = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      await set("items", []);
      await set("items", [{ id: 1 }, { id: 2 }]);
      globalThis.__s469l_swaps = 0;
      await set("ok", false);
      await set("ok", true);
      counts.push(globalThis.__s469l_swaps);
      expect(count("#out b.g")).toBe(2);
    }
    expect(counts).toEqual(Array(5).fill(4)); // 2 live rows × 2 flips — none from removed rows
  });
});

describe("S469 round 2 — F4: a gated-off bind:value input writes nothing", () => {
  test("a held, detached input dispatching `input` does not write the cell", async () => {
    const app = compileAndMount(`<ok> = true
<t> = ""
<div id="out">\${ lift <span><input id="field" if=@ok bind:value=@t></span> }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const field = document.querySelector("#field");
    field.value = "live";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(get("t")).toBe("live");
    await set("ok", false);
    expect(field.isConnected).toBe(false);
    field.value = "detached";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(get("t")).toBe("live");
  });
});

describe("S469 round 2 — a component whose body reads `@ok` works inside lifted markup", () => {
  for (const [name, wrap] of [
    ["a `for … lift` row", (c) => `\${ for (x of @xs) { lift <div>${c}</div> } }`],
    ["a bare lift", (c) => `\${ lift <div>${c}</div> }`],
  ]) {
    test(`${name}: if=@ok / class:on=@ok / title=@ok in the component body read the cell`, async () => {
      const errors = [];
      const oe = console.error;
      console.error = (...a) => errors.push(a.map(String).join(" "));
      let app;
      try {
        app = compileAndMount(`<ok> = true
<xs> = [1]
\${ const Pill = <span class="pill" class:on=@ok title=@ok><b class="g" if=@ok>x</b></span> }
<div id="out">${wrap(`<Pill/>`)}</div>
`);
        await flush();
      } finally {
        console.error = oe;
      }
      expect(app.errors).toEqual([]);
      expect(app.clientJs).not.toMatch(/\(ok\)|, ok\)/);
      expect(errors.filter((e) => /ReferenceError/.test(e))).toEqual([]);
      const pill = document.querySelector("#out .pill");
      expect(pill.classList.contains("on")).toBe(true);
      expect(pill.getAttribute("title")).toBe("true");
      await expectReactiveGate(app, { cell: "ok", off: false, on: true, sel: "#out b.g", openCount: 1, startsOpen: true });
    });
  }
});

describe("S469 round 2 — `show=` in lifted markup is a display toggle (it was written as a plain attribute)", () => {
  for (const [name, wrap] of [
    ["a `for … lift` row", (b) => `\${ for (x of @xs) { lift <span>${b}</span> } }`],
    ["a bare lift", (b) => `\${ lift <span>${b}</span> }`],
    ["an `if … lift` arm", (b) => `\${ if (true) { lift <span>${b}</span> } }`],
  ]) {
    test(`${name}: hidden while false, shown while true, the element stays mounted`, async () => {
      const app = compileAndMount(`<on> = false
<xs> = [1]
\${ function visible() { return @on } }
<div id="out">${wrap(`<b class="s" show=visible()>x</b>`)}</div>
`);
      expect(app.errors).toEqual([]);
      expect(app.clientJs).not.toMatch(/setAttribute\("show"/);
      await flush();
      const el = document.querySelector("#out b.s");
      expect(el.style.display).toBe("none");
      for (const v of [true, false, true]) {
        await set("on", v);
        expect(document.querySelector("#out b.s")).toBe(el);
        expect(el.style.display).toBe(v ? "" : "none");
      }
    });
  }
});

describe("S469 round 2 — a gate flip does not re-render a plain lift group", () => {
  test("a bare `${ lift … }`: a sibling input keeps its node and value across flips", async () => {
    const app = compileAndMount(`<ok> = true
<div id="out">\${ lift <div><input id="field"><b class="g" if=@ok>x</b></div> }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const field = document.querySelector("#field");
    field.value = "typed";
    for (const v of [false, true, false, true]) {
      await set("ok", v);
      expect(count("#out b.g")).toBe(v ? 1 : 0);
      expect(document.querySelector("#field")).toBe(field);
      expect(field.value).toBe("typed");
    }
  });
});

describe("S469 round 3 — a gate reading a LOCAL of the lift body uses its value at render time, not its final value", () => {
  // Each shape: [name, body (inside the context), [@n, expected count of open gates]...]. `sel` is
  // `b.g` for if=, `b.s:visible` handled by `visible()` for show=.
  const SHAPES = [
    ["while counter, if=(i == @n)", `let i = 0
 while (i < 3) { lift <span><b class="g" if=(i == @n)>\${i}</b></span>
 i = i + 1 }`, [[3, 0], [1, 1], [0, 1], [3, 0]]],
    ["while counter, if=(i != @n)", `let i = 0
 while (i < 3) { lift <span><b class="g" if=(i != @n)>\${i}</b></span>
 i = i + 1 }`, [[3, 3], [1, 2], [7, 3]]],
    ["non-keyed counter over @items", `let c = 0
 for (r of @items) { c = c + 1
 lift <b class="g" if=(c == @n)>\${c}</b> }`, [[3, 1], [4, 0], [1, 1]]],
    ["accumulator over a literal", `let acc = 0
 for (x of [1, 2, 3]) { acc = acc + x
 lift <b class="g" if=(acc == @n)>\${acc}</b> }`, [[6, 1], [3, 1], [2, 0], [1, 1]]],
    ["a flag set after the lift", `let ok = false
 lift <b class="g" if=(ok || @n > 5)>x</b>
 ok = true`, [[1, 0], [9, 1], [2, 0]]],
  ];
  const CONTEXTS = [
    ["a plain group", (body) => `\${ ${body} }`],
    ["an \`if … lift\` arm", (body) => `\${ if (@on) { ${body} } }`],
    ["a reconciled row", (body) => `\${ for (row of @rows) { ${body} } }`],
  ];
  for (const [cname, ctx] of CONTEXTS) {
    for (const [sname, body, steps] of SHAPES) {
      // A `while` loop inside a reconciled `for … lift` row lifts to the ambient target, not the
      // row (pre-existing on main — g-while-lift-in-reconciled-row-escapes-the-row-s469), so the
      // row context runs the `for`-based shapes; the `while` ones run in the group and the arm.
      if (cname === "a reconciled row" && body.startsWith("let i = 0\n while")) continue;
      test(`${cname}: ${sname}`, async () => {
        const app = compileAndMount(`<n> = 1
<on> = true
<rows> = [{ id: 1 }]
<items> = [{ id: 1 }, { id: 2 }, { id: 3 }]
<div id="out">${ctx(body)}</div>
`);
        expect(app.errors).toEqual([]);
        await flush();
        for (const [n, want] of steps) {
          await set("n", n);
          expect([n, count("#out b.g")]).toEqual([n, want]);
        }
      });
    }
    test(`${cname}: show=(i == @n) over a counter`, async () => {
      const app = compileAndMount(`<n> = 1
<on> = true
<rows> = [{ id: 1 }]
<div id="out">${ctx(`let i = 0
 for (x of [0, 1, 2]) { lift <span><b class="s" show=(i == @n)>\${x}</b></span>
 i = i + 1 }`)}</div>
`);
      expect(app.errors).toEqual([]);
      const shown = () => [...document.querySelectorAll("#out b.s")].filter((e) => e.style.display !== "none").map((e) => e.textContent);
      await flush();
      expect(shown()).toEqual(["1"]);
      await set("n", 3);
      expect(shown()).toEqual([]);
      await set("n", 2);
      expect(shown()).toEqual(["2"]);
    });
  }

  test("a reconciled row's own local written after the lift: the snapshot holds the render-time value", async () => {
    const app = compileAndMount(`<n> = 1
<rows> = [{ id: 1 }, { id: 2 }]
<div id="out">\${ for (row of @rows) { let t = 1
 lift <b class="g" if=(t == @n)>\${row.id}</b>
 t = 99 } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out b.g")).toBe(2);
    await set("n", 99);
    expect(count("#out b.g")).toBe(0);
    await set("n", 1);
    expect(count("#out b.g")).toBe(2);
  });
});
