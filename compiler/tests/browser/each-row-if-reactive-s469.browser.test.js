/**
 * each-row-if-reactive-s469 — EXECUTES the emitted client JS for a markup `if=` inside an
 * `<each>` row that is NOT the row's sole root: a nested element, and a root of a
 * multi-root item.
 *
 * Gaps: `g-each-nested-peritem-if-not-reactive` (HIGH, security) and
 * `g-each-peritem-if-multiroot-deferred`. Both were a CREATE-TIME append gate: the
 * condition was evaluated once when the row was built, so
 *
 *   <each in=@xs as y><span><b if=(@pw == "secret")>LOGGED IN</b></span></each>
 *
 * kept LOGGED IN after `@pw` was revoked (and never showed it when `@pw` was granted
 * after the row was built). For a condition on outer state `W-IF-IN-EACH` did not fire
 * either. SPEC §17.1: `if=` removes the element while false and is reactive.
 *
 * Every case drives compile → mount → write cells in happy-dom with the PRUNED runtime
 * the build ships and asserts BOTH directions, more than once, plus keyed / index
 * reorders where the row is reused.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-each-row-if-s469");

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
  const warnings = [...(result.warnings ?? []), ...(result.errors ?? [])].map((e) => e.code);
  if (errors.length > 0) return { errors, warnings, clientJs: "" };
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
      `globalThis.__s469r_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, warnings, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__s469r_set(name, v); await flush(); };
const count = (sel) => document.querySelectorAll(sel).length;
/** The element children of #out (comments excluded), as `class:text`. */
const order = (sel = "#out") => [...document.querySelector(sel).children].map((e) => `${e.className}:${e.textContent}`);
/** For every `.row`, its label and whether the gated `b.g` is in it. */
const rows = () => [...document.querySelectorAll("#out .row")].map((r) => [
  r.querySelector(".lbl")?.textContent ?? r.getAttribute("data-k") ?? "",
  r.querySelector("b.g") ? "G" : "-",
]);

/** Mount, then assert the guard closes, opens, closes and opens again. */
async function expectReactiveGate(app, { cell, off, on, sel, openCount, startsOpen = false }) {
  expect(app.errors).toEqual([]);
  expect(app.warnings).not.toContain("W-IF-IN-EACH");
  await flush();
  expect(count(sel)).toBe(startsOpen ? openCount : 0);
  await set(cell, startsOpen ? off : on);
  expect(count(sel)).toBe(startsOpen ? 0 : openCount);
  await set(cell, startsOpen ? on : off);
  expect(count(sel)).toBe(startsOpen ? openCount : 0);
  await set(cell, startsOpen ? off : on);
  expect(count(sel)).toBe(startsOpen ? 0 : openCount);
}

describe("a nested (non-root) if= in an <each> row is reactive both ways (§17.1)", () => {
  test("THE DEFECT — an outer-state guard: revoked after the row is built, the element goes", async () => {
    const app = compileAndMount(`<pw> = "secret"
<xs> = [1, 2]
<div id="out"><each in=@xs as y><span><b class="g" if=(@pw == "secret")>LOGGED IN</b></span></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 2, startsOpen: true });
  });

  test("granted after the row is built, the element appears; cell and call-ref forms", async () => {
    const a = compileAndMount(`<shown> = false
<xs> = [1, 2, 3]
<div id="out"><each in=@xs as y><span><b class="g" if=@shown>x</b></span></each></div>
`);
    await expectReactiveGate(a, { cell: "shown", off: false, on: true, sel: "#out b.g", openCount: 3 });
    const b = compileAndMount(`\${ function allowed(p) { return p == "secret" } }
<pw> = ""
<xs> = [1]
<div id="out"><each in=@xs as y><span><b class="g" if=allowed(@pw)>x</b></span></each></div>
`);
    await expectReactiveGate(b, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 1 });
  });

  test("false REMOVES the element (a placeholder comment holds its place)", async () => {
    const app = compileAndMount(`<shown> = true
<xs> = [1]
<div id="out"><each in=@xs as y><span class="host"><i>a</i><b class="g" if=@shown>b</b><i>c</i></span></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(document.querySelector(".host").textContent).toBe("abc");
    await set("shown", false);
    expect(count("#out b.g")).toBe(0);
    expect(document.querySelector(".host").textContent).toBe("ac");
    await set("shown", true);
    // Back in the SAME position.
    expect(document.querySelector(".host").textContent).toBe("abc");
  });

  test("a row-reading guard follows the live item — keyed reorder + same-key replace, and `@.`", async () => {
    const app = compileAndMount(`<items> = [{ id: 1, name: "a", ok: true }, { id: 2, name: "b", ok: false }]
<div id="out"><each in=@items key=@.id as r><div class="row"><span class="lbl">\${r.name}</span><b class="g" if=r.ok>G</b></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", "G"], ["b", "-"]]);
    await set("items", [{ id: 2, name: "b", ok: true }, { id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["b", "G"], ["a", "-"]]);
    await set("items", [{ id: 2, name: "b", ok: false }, { id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["b", "-"], ["a", "-"]]);
    await set("items", [{ id: 1, name: "a", ok: true }, { id: 2, name: "b", ok: true }]);
    expect(rows()).toEqual([["a", "G"], ["b", "G"]]);

    const sig = compileAndMount(`<items> = [{ id: 1, name: "a", ok: false }]
<div id="out"><each in=@items key=@.id><div class="row"><span class="lbl">\${@.name}</span><b class="g" if=@.ok>G</b></div></each></div>
`);
    expect(sig.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", "-"]]);
    await set("items", [{ id: 1, name: "a", ok: true }]);
    expect(rows()).toEqual([["a", "G"]]);
    await set("items", [{ id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["a", "-"]]);
  });

  test("index keys: a row-reading guard follows the live item", async () => {
    const app = compileAndMount(`<items> = [{ name: "a", ok: false }, { name: "b", ok: true }]
<div id="out"><each in=@items as r><div class="row"><span class="lbl">\${r.name}</span><b class="g" if=(r.ok)>G</b></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", "-"], ["b", "G"]]);
    await set("items", [{ name: "a", ok: true }, { name: "b", ok: false }]);
    expect(rows()).toEqual([["a", "G"], ["b", "-"]]);
    await set("items", [{ name: "b", ok: true }, { name: "a", ok: true }]);
    expect(rows()).toEqual([["b", "G"], ["a", "G"]]);
  });

  test("nested rows: an outer-row guard 2 deep, an outer-state guard 3 deep", async () => {
    const two = compileAndMount(`<groups> = [{ id: 1, ok: true, cells: [1] }, { id: 2, ok: false, cells: [1] }]
<div id="out"><each in=@groups key=@.id as g><div class="row" data-k=\${g.id}><each in=g.cells as c><span><b class="g" if=(g.ok)>G</b></span></each></div></each></div>
`);
    expect(two.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["1", "G"], ["2", "-"]]);
    await set("groups", [{ id: 2, ok: true, cells: [1] }, { id: 1, ok: false, cells: [1] }]);
    expect(rows()).toEqual([["2", "G"], ["1", "-"]]);
    await set("groups", [{ id: 2, ok: false, cells: [1] }, { id: 1, ok: false, cells: [1] }]);
    expect(rows()).toEqual([["2", "-"], ["1", "-"]]);

    const three = compileAndMount(`<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as a><each in=@xs as b><each in=@xs as c><span><b class="g" if=(@pw == "secret")>G</b></span></each></each></each></div>
`);
    await expectReactiveGate(three, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 8 });
  });

  test("inside a component used in a row, and on an <errorBoundary> in a row", async () => {
    const comp = compileAndMount(`\${ const Pill = <span><b class="g" if=(@pw == "secret")>G</b></span> }
<pw> = "secret"
<xs> = [1, 2]
<div id="out"><each in=@xs as y><Pill/></each></div>
`);
    await expectReactiveGate(comp, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 2, startsOpen: true });
    const eb = compileAndMount(`<pw> = "secret"
<xs> = [1]
<div id="out"><each in=@xs as y><span><errorBoundary if=(@pw == "secret")><b class="g">G</b></errorBoundary></span></each></div>
`);
    await expectReactiveGate(eb, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 1, startsOpen: true });
  });

  test("in an <each>'s <empty> body", async () => {
    const app = compileAndMount(`<pw> = "secret"
<none> = []
<div id="out"><each in=@none as y><p>row</p><empty><span><b class="g" if=(@pw == "secret")>G</b></span></empty></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 1, startsOpen: true });
  });
});

describe("an if= on a root of a MULTI-root item is reactive and moves with its group", () => {
  test("an outer-state guard on one root: both ways", async () => {
    const app = compileAndMount(`<pw> = "secret"
<xs> = [1, 2]
<div id="out"><each in=@xs as y><b class="g" if=(@pw == "secret")>G</b><i class="t">\${y}</i></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", openCount: 2, startsOpen: true });
    expect(order()).toEqual(["t:1", "t:2"]);
    await set("pw", "secret");
    expect(order()).toEqual(["g:G", "t:1", "g:G", "t:2"]);
  });

  test("a gated HEAD root: keyed reorder, revoke, grant, delete keep the group together", async () => {
    const app = compileAndMount(`<items> = [{ id: 1, ok: true }, { id: 2, ok: false }, { id: 3, ok: true }]
<div id="out"><each in=@items key=@.id as r><b class="g" if=r.ok>G\${r.id}</b><i class="t">\${r.id}</i></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(order()).toEqual(["g:G1", "t:1", "t:2", "g:G3", "t:3"]);
    // Reverse + flip every grant — every group is reused by key.
    await set("items", [{ id: 3, ok: false }, { id: 2, ok: true }, { id: 1, ok: false }]);
    expect(order()).toEqual(["t:3", "g:G2", "t:2", "t:1"]);
    // Reorder again with all granted: the swapped-in nodes move with their groups.
    await set("items", [{ id: 1, ok: true }, { id: 3, ok: true }, { id: 2, ok: true }]);
    expect(order()).toEqual(["g:G1", "t:1", "g:G3", "t:3", "g:G2", "t:2"]);
    // Delete the middle group while its gated head is mounted.
    await set("items", [{ id: 1, ok: true }, { id: 2, ok: true }]);
    expect(order()).toEqual(["g:G1", "t:1", "g:G2", "t:2"]);
    // Delete a group while its gated head is the placeholder.
    await set("items", [{ id: 1, ok: false }, { id: 2, ok: true }]);
    await set("items", [{ id: 2, ok: true }]);
    expect(order()).toEqual(["g:G2", "t:2"]);
  });

  test("a gated TAIL root: keyed reorder and revoke", async () => {
    const app = compileAndMount(`<items> = [{ id: 1, ok: true }, { id: 2, ok: false }]
<div id="out"><each in=@items key=@.id as r><i class="t">\${r.id}</i><b class="g" if=r.ok>G\${r.id}</b></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(order()).toEqual(["t:1", "g:G1", "t:2"]);
    await set("items", [{ id: 2, ok: true }, { id: 1, ok: false }]);
    expect(order()).toEqual(["t:2", "g:G2", "t:1"]);
    await set("items", [{ id: 1, ok: true }, { id: 2, ok: true }]);
    expect(order()).toEqual(["t:1", "g:G1", "t:2", "g:G2"]);
  });
});
