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
    `${runtimeJs}\n` + captureInsideChunkScope(
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
