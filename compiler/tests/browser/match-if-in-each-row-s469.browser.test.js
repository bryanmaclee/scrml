/**
 * match-if-in-each-row-s469 — EXECUTES the emitted client JS for a `<match if=…>`
 * that sits inside an `<each>` row (and in an `<each>`'s `<empty>` body).
 *
 * Gap: `g-structural-if-inside-each-row-template-fails-open` (HIGH, security). The
 * per-row match dispatch (emit-each `match-block` branch → the item-scoped dispatcher)
 * never read the match's `ifCond`, so
 *
 *   <each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>…arms…</match></each>
 *
 * rendered its arm whatever `@pw` held, while the same `<match if=>` at top level was
 * gated. The `<each if=…>` half of the gap was closed by #1491 (nested-each-if-guard-s469).
 *
 * SPEC §17.1.2: `if=` on `<match>` gates "the dispatched arm output"; §17.1.2.1: "For
 * `<match if=expr>`: no arm is dispatched." §17.1: `if=` REMOVES (it does not hide), so
 * while false the arm is torn down — its nodes are gone, not `display:none`.
 *
 * Every case drives compile → mount → write the guard's cells in happy-dom with the
 * PRUNED runtime the build ships, and asserts BOTH directions, more than once, so the
 * gate is proven reactive and not a create-time snapshot.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-match-if-row-s469");

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
      `globalThis.__s469m_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__s469m_set(name, v); await flush(); };
const count = (sel) => document.querySelectorAll(sel).length;
/** For every `.row`, its label and whether an arm is mounted in it. */
const rows = () => [...document.querySelectorAll("#out .row")].map((r) => [
  r.getAttribute("data-k") ?? (r.querySelector(".lbl")?.textContent ?? ""),
  r.querySelector(".arm")?.textContent ?? null,
]);

/** Mount, then assert the guard closes, opens, closes and opens again. */
async function expectReactiveGate(app, { cell, off, on, sel, openCount }) {
  expect(app.errors).toEqual([]);
  await flush();
  expect(count(sel)).toBe(0);
  await set(cell, on);
  expect(count(sel)).toBe(openCount);
  await set(cell, off);
  expect(count(sel)).toBe(0);
  await set(cell, on);
  expect(count(sel)).toBe(openCount);
  await set(cell, off);
  expect(count(sel)).toBe(0);
}

const PHASE = `type Phase:enum = { Idle, Active }
<ph>: Phase = .Idle
`;
const ARMS = `<Idle><b class="arm">idle</b></Idle><Active><b class="arm">active</b></Active>`;

describe("<match if=…> inside an <each> row — the guard is honoured and reactive (§17.1.2)", () => {
  test("THE DEFECT — plain predicate, 1 deep: no arm while false, arms while true, both ways", async () => {
    const app = compileAndMount(`${PHASE}<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 2 });
  });

  test("cell predicate `if=@shown` and call-ref predicate `if=allowed(@pw)`", async () => {
    const a = compileAndMount(`${PHASE}<shown> = false
<xs> = [1, 2, 3]
<div id="out"><each in=@xs as y><match for=Phase on=@ph if=@shown>${ARMS}</match></each></div>
`);
    await expectReactiveGate(a, { cell: "shown", off: false, on: true, sel: "#out b.arm", openCount: 3 });
    const b = compileAndMount(`${PHASE}\${ function allowed(p) { return p == "secret" } }
<pw> = "wrong"
<xs> = [1]
<div id="out"><each in=@xs as y><match for=Phase on=@ph if=allowed(@pw)>${ARMS}</match></each></div>
`);
    await expectReactiveGate(b, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 1 });
  });

  test("false REMOVES the arm (no node left, not display:none); true shows the CURRENT variant", async () => {
    const app = compileAndMount(`${PHASE}<shown> = true
<n> = 1
<xs> = [1]
<div id="out"><each in=@xs as y><match for=Phase on=@ph if=@shown><Idle><b class="arm">idle \${@n}</b></Idle><Active><b class="arm">active \${@n}</b></Active></match></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(document.querySelector("#out b.arm")?.textContent).toBe("idle 1");
    await set("shown", false);
    // Torn down: the mount is empty — the arm is not hidden, it is gone.
    expect(count("#out b.arm")).toBe(0);
    expect(count("#out [data-scrml-match-mount]")).toBe(1);
    expect(document.querySelector("#out [data-scrml-match-mount]").childNodes.length).toBe(0);
    // While false: the scrutinee and the arm's own cells change; nothing renders.
    await set("ph", "Active");
    await set("n", 2);
    expect(count("#out b.arm")).toBe(0);
    // True again: the arm for the CURRENT variant, with the current cell value.
    await set("shown", true);
    expect(document.querySelector("#out b.arm")?.textContent).toBe("active 2");
    await set("n", 3);
    expect(document.querySelector("#out b.arm")?.textContent).toBe("active 3");
    // A same-variant false → true cycle re-renders too (the last-value cache is forgotten).
    await set("shown", false);
    await set("shown", true);
    expect(document.querySelector("#out b.arm")?.textContent).toBe("active 3");
  });

  test("2 deep and 3 deep: the gate holds at every depth, both ways", async () => {
    const two = compileAndMount(`${PHASE}<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as z><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></each></div>
`);
    await expectReactiveGate(two, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 4 });
    const three = compileAndMount(`${PHASE}<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as w><each in=@xs as z><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></each></each></div>
`);
    await expectReactiveGate(three, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 8 });
  });

  test("a guard reading the ROW item re-reads the live item — keyed rows, reorder + same-key replace", async () => {
    const app = compileAndMount(`${PHASE}<items> = [{ id: 1, name: "a", ok: true }, { id: 2, name: "b", ok: false }]
<div id="out"><each in=@items key=@.id as y><div class="row"><span class="lbl">\${y.name}</span><match for=Phase on=@ph if=y.ok>${ARMS}</match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", "idle"], ["b", null]]);
    // Reorder AND flip the grants: row nodes are reused by key, so a create-time gate would stick.
    await set("items", [{ id: 2, name: "b", ok: true }, { id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["b", "idle"], ["a", null]]);
    // Same-key replace, both revoked.
    await set("items", [{ id: 2, name: "b", ok: false }, { id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["b", null], ["a", null]]);
    // Both granted again, original order.
    await set("items", [{ id: 1, name: "a", ok: true }, { id: 2, name: "b", ok: true }]);
    expect(rows()).toEqual([["a", "idle"], ["b", "idle"]]);
    // `@.ok` spells the same guard.
    const sig = compileAndMount(`${PHASE}<items> = [{ id: 1, name: "a", ok: false }]
<div id="out"><each in=@items key=@.id><div class="row"><span class="lbl">\${@.name}</span><match for=Phase on=@ph if=@.ok>${ARMS}</match></div></each></div>
`);
    expect(sig.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", null]]);
    await set("items", [{ id: 1, name: "a", ok: true }]);
    expect(rows()).toEqual([["a", "idle"]]);
    await set("items", [{ id: 1, name: "a", ok: false }]);
    expect(rows()).toEqual([["a", null]]);
  });

  test("index keys: a guard reading the row re-reads the live item", async () => {
    const app = compileAndMount(`${PHASE}<items> = [{ name: "a", ok: false }, { name: "b", ok: true }]
<div id="out"><each in=@items as y><div class="row"><span class="lbl">\${y.name}</span><match for=Phase on=@ph if=(y.ok)>${ARMS}</match></div></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["a", null], ["b", "idle"]]);
    await set("items", [{ name: "a", ok: true }, { name: "b", ok: false }]);
    expect(rows()).toEqual([["a", "idle"], ["b", null]]);
    await set("items", [{ name: "b", ok: true }, { name: "a", ok: true }]);
    expect(rows()).toEqual([["b", "idle"], ["a", "idle"]]);
  });

  test("a guard reading an OUTER row, 2 deep and 3 deep, keyed reorder of the outer list", async () => {
    const two = compileAndMount(`${PHASE}<groups> = [{ id: 1, ok: true, cells: [1] }, { id: 2, ok: false, cells: [1] }]
<div id="out"><each in=@groups key=@.id as g><div class="row" data-k=\${g.id}><each in=g.cells as c><match for=Phase on=@ph if=(g.ok)>${ARMS}</match></each></div></each></div>
`);
    expect(two.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["1", "idle"], ["2", null]]);
    await set("groups", [{ id: 2, ok: true, cells: [1] }, { id: 1, ok: false, cells: [1] }]);
    expect(rows()).toEqual([["2", "idle"], ["1", null]]);
    await set("groups", [{ id: 2, ok: false, cells: [1] }, { id: 1, ok: false, cells: [1] }]);
    expect(rows()).toEqual([["2", null], ["1", null]]);

    const three = compileAndMount(`${PHASE}<groups> = [{ id: 1, ok: true, subs: [{ id: 1, cells: [1] }] }, { id: 2, ok: false, subs: [{ id: 1, cells: [1] }] }]
<div id="out"><each in=@groups key=@.id as g><div class="row" data-k=\${g.id}><each in=g.subs key=@.id as s><each in=s.cells as c><match for=Phase on=@ph if=g.ok>${ARMS}</match></each></each></div></each></div>
`);
    expect(three.errors).toEqual([]);
    await flush();
    expect(rows()).toEqual([["1", "idle"], ["2", null]]);
    await set("groups", [{ id: 2, ok: true, subs: [{ id: 1, cells: [1] }] }, { id: 1, ok: false, subs: [{ id: 1, cells: [1] }] }]);
    expect(rows()).toEqual([["2", "idle"], ["1", null]]);
    await set("groups", [{ id: 2, ok: false, subs: [{ id: 1, cells: [1] }] }, { id: 1, ok: true, subs: [{ id: 1, cells: [1] }] }]);
    expect(rows()).toEqual([["2", null], ["1", "idle"]]);
  });

  test("inside a component body, and inside an <engine> arm", async () => {
    const comp = compileAndMount(`${PHASE}<pw> = "wrong"
<xs> = [1, 2]
\${ const Box = <div><p id="out"><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></p></div> }
<Box/>
`);
    await expectReactiveGate(comp, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 2 });
    const eng = compileAndMount(`type Mode:enum = { On, Off }
${PHASE}<pw> = "wrong"
<xs> = [1]
<div id="out"><engine for=Mode initial=.On><On rule=.Off><each in=@xs as y><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></each></><Off rule=.On>x</></></div>
`);
    await expectReactiveGate(eng, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 1 });
  });

  test("a <match> in an <each>'s <empty> body: rendered, and its if= honoured both ways", async () => {
    const plain = compileAndMount(`${PHASE}<xs> = []
<div id="out"><each in=@xs as y><p>row</p><empty><match for=Phase on=@ph>${ARMS}</match></empty></each></div>
`);
    expect(plain.errors).toEqual([]);
    await flush();
    expect(document.querySelector("#out b.arm")?.textContent).toBe("idle");
    await set("ph", "Active");
    expect(document.querySelector("#out b.arm")?.textContent).toBe("active");

    const gated = compileAndMount(`${PHASE}<pw> = "wrong"
<xs> = []
<div id="out"><each in=@xs as y><p>row</p><empty><match for=Phase on=@ph if=(@pw == "secret")>${ARMS}</match></empty></each></div>
`);
    await expectReactiveGate(gated, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.arm", openCount: 1 });
    // A scrutinee change while false renders nothing.
    await set("ph", "Active");
    expect(count("#out b.arm")).toBe(0);
    await set("pw", "secret");
    expect(document.querySelector("#out b.arm")?.textContent).toBe("active");
  });

  test("control: a row <match> WITHOUT if= still dispatches and re-dispatches", async () => {
    const app = compileAndMount(`${PHASE}<xs> = [1, 2]
<div id="out"><each in=@xs as y><match for=Phase on=@ph>${ARMS}</match></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect([...document.querySelectorAll("#out b.arm")].map((b) => b.textContent)).toEqual(["idle", "idle"]);
    await set("ph", "Active");
    expect([...document.querySelectorAll("#out b.arm")].map((b) => b.textContent)).toEqual(["active", "active"]);
  });
});
