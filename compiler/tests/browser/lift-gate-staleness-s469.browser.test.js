/**
 * lift-gate-staleness-s469 — EXECUTES the emitted client JS for the lifted `if=` / `show=` positions
 * main's evaluation placement never re-read (g-lift-gate-placement-inherits-main-staleness-s469):
 *
 *   - a cell read only inside a called function — two calls deep, or through a file-level closure —
 *     at a bare lift, an `if … lift` arm, a reconciled row, a plain loop, a function returning markup;
 *   - a run-once group whose gate names no cell, beside a body local (the group must re-render);
 *   - the value-indexed row side: a same-key replace AND an in-place write of the row's field;
 *   - body locals / item-derived locals / local closures read in a reconciled row (the row is
 *     lowered as the plain loop the block re-runs);
 *   - gates nothing can re-run: refused E-IMPL1-LIFT-GATE-UNTRACKED (fail closed).
 *
 * Every gate is driven true → false → true → false and asserted by PRESENCE (an `if=` element is
 * absent while false) or by `display` (a `show=` element stays mounted), with the pruned runtime the
 * build ships.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-lift-gate-staleness-s469");

function compileAndMount(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, "app.scrml");
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? [])
    .filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""))
    .map((e) => e.code);
  if (errors.length > 0) return { errors, clientJs: "" };
  const html = readFileSync(resolve(outDir, "app.html"), "utf8");
  const clientJs = readFileSync(resolve(outDir, "app.client.js"), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__lgs_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n` +
      `globalThis.__lgs_get = typeof _scrml_cs_reactive_get === "function" ? _scrml_cs_reactive_get : _scrml_reactive_get;\n`,
    ),
  )(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__lgs_set(name, v); await flush(); };
const count = (sel) => document.querySelectorAll(sel).length;
const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.style.display !== "none").length;

/** Granted at mount; revoke, re-grant, revoke — asserting presence (if=) or visibility (show=) each time. */
async function revokeCycle(app, { cell, off, on, sel, open, attr = "if", write = null }) {
  expect(app.errors).toEqual([]);
  await flush();
  const seen = attr === "if" ? () => count(sel) : () => shown(sel);
  const total = count(sel);
  expect(seen()).toBe(open);
  for (const [v, want] of [[off, 0], [on, open], [off, 0]]) {
    if (write) await write(v); else await set(cell, v);
    expect(seen()).toBe(want);
    if (attr === "show") expect(count(sel)).toBe(total); // show= keeps the element mounted
  }
}

const PAGE = (body) => `<role> = "admin"
<xs> = [{ id: 1 }, { id: 2 }]
\${
    function isAdmin() { return @role == "admin" }
    function deeper() { return isAdmin() }
    const viaConst = () => @role == "admin"
}
<div id="out">${body}</div>
`;
const POSITIONS = [
  ["a bare lift", (g) => `\${ lift <span>${g}</span> }`, 1],
  ["an \`if … lift\` arm", (g) => `\${ if (true) { lift <span>${g}</span> } }`, 1],
  ["a reconciled row", (g) => `\${ for (x of @xs) { lift <span>${g}</span> } }`, 2],
  ["a reconciled row's sole root", (g) => `\${ for (x of @xs) { lift ${g} } }`, 2],
  ["a plain loop", (g) => `\${ for (x of [1, 2]) { lift <span>${g}</span> } }`, 2],
  ["a function returning markup", (g) => `\${ function pill() { return <span>${g}</span> } }\n\${ pill() }`, 1],
  ["a ternary markup value", (g) => `\${ true ? <span>${g}</span> : "" }`, 1],
];
const GUARDS = [["two calls deep", "deeper()"], ["a file-level const closure", "(viaConst())"], ["a call in &&", "(isAdmin() && true)"]];

describe("a cell read only inside a called function is a dependency of the lifted gate", () => {
  for (const [pname, wrap, open] of POSITIONS) {
    for (const [gname, guard] of GUARDS) {
      test(`${pname}, ${gname}: if= leaves and returns`, async () => {
        const app = compileAndMount(PAGE(wrap(`<b class="g" if=${guard}>x</b>`)));
        await revokeCycle(app, { cell: "role", off: "user", on: "admin", sel: "#out b.g", open });
      });
    }
    test(`${pname}, two calls deep: show= hides and shows (the element stays mounted)`, async () => {
      const app = compileAndMount(PAGE(wrap(`<b class="g" show=deeper()>x</b>`)));
      await revokeCycle(app, { cell: "role", off: "user", on: "admin", sel: "#out b.g", open, attr: "show" });
    });
  }
});

describe("a gate that reads a value of the render is re-read by re-running that render", () => {
  test("a run-once group: an indirect gate beside a body local (the group is made a re-render effect)", async () => {
    const app = compileAndMount(PAGE(`\${ let ok = false\n lift <span><b class="g" if=(ok || isAdmin())>x</b></span>\n ok = true }`));
    expect(app.clientJs).toMatch(/_scrml_effect\(function\(\) \{\n\s*_scrml_lift_tgt_\w+\.innerHTML = "";/);
    await revokeCycle(app, { cell: "role", off: "user", on: "admin", sel: "#out b.g", open: 1 });
  });

  for (const keyed of [true, false]) {
    const rows = (ok) => `[{ ${keyed ? "id: 1, " : ""}ok: ${ok} }, { ${keyed ? "id: 2, " : ""}ok: ${ok} }]`;
    for (const [name, body] of [
      ["an item-derived local", `let ok = r.ok\n lift <span><b class="g" if=(ok)>x</b></span>`],
      ["a local closure over the row item", `const allowed = () => r.ok\n lift <span><b class="g" if=(allowed())>x</b></span>`],
      ["a body local written after the lift", `let late = false\n lift <span><b class="g" if=(late || r.ok)>x</b></span>\n late = true`],
    ]) {
      test(`a reconciled row (${keyed ? "id" : "index"} keys), ${name}: the row is lowered plain and re-read`, async () => {
        const app = compileAndMount(`<rows> = ${rows("true")}\n<div id="out">\${ for (r of @rows) { ${body} } }</div>\n`);
        expect(app.clientJs).not.toMatch(/_scrml_reconcile_list\(/);
        await revokeCycle(app, {
          sel: "#out b.g", open: 2,
          write: async (v) => { globalThis.__lgs_set("rows", [1, 2].map((id) => ({ ...(keyed ? { id } : {}), ok: v }))); await flush(); },
          off: false, on: true,
        });
      });
    }
  }

  test("a group local read in a row (a flag set after the loop): plain, re-read with its render-time value", async () => {
    const app = compileAndMount(`<pw> = "secret"\n<rows> = [{ id: 1 }]\n<div id="out">\${ let ok = false\n for (row of @rows) { lift <span><b class="g" if=(ok || @pw == "secret")>x</b></span> }\n ok = true }</div>\n`);
    await revokeCycle(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.g", open: 1 });
  });
});

// Review of b57d697a9 (HIGH-1): a local or parameter can hold a value COMPUTED BY A CALL THAT READS A CELL.
// A gate reading it — even one whose own text names no cell and calls nothing — is open: only re-running
// the render re-reads the local. (43a6b7682 evaluated such a gate once: every case below stayed 1 1 1 1.)
describe("a gate over a local computed from a cell re-reads it (the render re-runs)", () => {
  const CASES = [
    ["let ok = isAdmin(), if=ok", `\${ let ok = isAdmin()\n lift <span><b class="g" if=ok>x</b></span> }`, 1, "if"],
    ["const ok = isAdmin(), show=(ok)", `\${ const ok = isAdmin()\n lift <span><b class="g" show=(ok)>x</b></span> }`, 1, "show"],
    ["const {a} = {a: isAdmin()}", `\${ const {a} = {a: isAdmin()}\n lift <span><b class="g" if=(a)>x</b></span> }`, 1, "if"],
    ["const [a] = [isAdmin()]", `\${ const [a] = [isAdmin()]\n lift <span><b class="g" if=(a)>x</b></span> }`, 1, "if"],
    ["const denied = !isAdmin()", `\${ const denied = !isAdmin()\n lift <span><b class="g" if=(!denied)>x</b></span> }`, 1, "if"],
    ["a ternary local", `\${ const ok = isAdmin() ? true : false\n lift <span><b class="g" if=(ok)>x</b></span> }`, 1, "if"],
    ["let ok = false; ok = isAdmin()", `\${ let ok = false\n ok = isAdmin()\n lift <span><b class="g" if=(ok)>x</b></span> }`, 1, "if"],
    ["an if (true) arm", `\${ if (true) { const ok = isAdmin()\n lift <span><b class="g" if=(ok)>x</b></span> } }`, 1, "if"],
    ["a plain for loop", `\${ for (i of [1, 2]) { const ok = isAdmin()\n lift <span><b class="g" if=(ok)>x</b></span> } }`, 2, "if"],
    ["a component body local from a call", `\${ const Pill = <span props={ q: string }>\${ const z = isAdmin()\n lift <b class="g" if=(z)>x</b> }</span> }\n<Pill q="y"/>`, 1, "if"],
    ["a component body local from a prop", `\${ const Pill = <span props={ q: string }>\${ const z = q == "y"\n lift <b class="g" if=(z && isAdmin())>x</b> }</span> }\n<Pill q="y"/>`, 1, "if"],
    ["a component prop read in lifted markup", `\${ const Pill = <span props={ q: string }>\${ lift <b class="g" if=(q == "y" && isAdmin())>x</b> }</span> }\n<Pill q="y"/>`, 1, "if"],
  ];
  for (const [name, body, open, attr] of CASES) {
    test(`${name}: ${attr}= follows the cell true → false → true → false`, async () => {
      const app = compileAndMount(PAGE(body));
      await revokeCycle(app, { cell: "role", off: "user", on: "admin", sel: "#out b.g", open, attr });
    });
  }
});

// Review of b57d697a9 (MED-1): an open gate in an INNER loop lowered the OUTER keyed list plain, so a sibling
// input in the outer row lost its typed value on every write the gate read. The inner loop is now a REGION of
// the outer row (its own tracked effect re-runs just that loop); the outer row stays keyed.
describe("an open gate in an inner loop re-runs only that loop (the outer row keeps its nodes)", () => {
  const SRC = `<n> = 1
<xs> = [{ id: 1, kids: [{ id: 11, ok: true }, { id: 12, ok: true }] }]
<div id="out">\${ for (r of @xs) { lift <div><input class="in"/>\${ for (c of r.kids) { let t = c.ok
 lift <b class="g" if=(t && @n == 1)>x</b> } }</div> } }</div>
`;
  test("a sibling input keeps its node and value while the gate cycles", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    expect(app.clientJs).toMatch(/_scrml_reconcile_list\(/); // the outer row is still keyed
    await flush();
    const input = document.querySelector("#out input.in");
    input.value = "typed";
    expect(count("#out b.g")).toBe(2);
    for (const [v, want] of [[2, 0], [1, 2], [2, 0], [1, 2]]) {
      await set("n", v);
      expect(count("#out b.g")).toBe(want);
      expect(document.querySelector("#out input.in")).toBe(input);
      expect(input.value).toBe("typed");
    }
  });
  test("the inner row's own field revokes and re-grants (same-key replace and in-place write)", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    await flush();
    // In place first (on the store's own deep-reactive value; a raw value handed to the setter below is
    // not wrapped, so writes into it after the replace would bypass the store — a harness detail).
    globalThis.__lgs_get("xs")[0].kids[0].ok = false;
    await flush();
    expect(count("#out b.g")).toBe(1);
    globalThis.__lgs_get("xs")[0].kids[0].ok = true;
    await flush();
    expect(count("#out b.g")).toBe(2);
    const rows = (a, b) => [{ id: 1, kids: [{ id: 11, ok: a }, { id: 12, ok: b }] }];
    for (const [a, b, want] of [[false, false, 0], [true, false, 1], [false, false, 0], [true, true, 2]]) {
      await set("xs", rows(a, b));
      expect(count("#out b.g")).toBe(want);
    }
  });
  test("a removed outer row takes its region down; a re-added one rebuilds it", async () => {
    const app = compileAndMount(SRC);
    expect(app.errors).toEqual([]);
    await flush();
    await set("xs", []);
    expect(count("#out b.g")).toBe(0);
    await set("n", 2);
    await set("n", 1);
    expect(count("#out b.g")).toBe(0);
    await set("xs", [{ id: 1, kids: [{ id: 11, ok: true }] }]);
    expect(count("#out b.g")).toBe(1);
    await set("n", 2);
    expect(count("#out b.g")).toBe(0);
  });
});

// Review of b192c63de (HIGH): a region whose nodes are ROOTS of a fragment row was frozen into the row's group
// arrays, so a reorder re-inserted revoked content (and a region at the group head dropped the row's key). A
// region is emitted only inside a row ELEMENT; every other shape lowers the row plain. Each shape below is
// revoked, reordered, re-granted, revoked again.
describe("an open gate in an inner loop among a row's ROOTS: the row is lowered plain (revoke survives a reorder)", () => {
  const REG = `for (k of r.kids) { const ok = @role == "admin"\n lift <span><b class="g" if=(ok)>x</b></span> }`;
  const ROWS = [
    ["the inner loop is the group head", REG],
    ["a sibling root before it", `lift <i>h</i>\n ${REG}`],
    ["a sibling root after it", `${REG}\n lift <i>t</i>`],
    ["a sibling gated root", `lift <em if=(@role == "admin")>e</em>\n ${REG}`],
    ["inside an if arm with a sibling", `if (r.ok) { lift <i>h</i>\n ${REG} }`],
    ["two such loops", `${REG}\n ${REG}`],
  ];
  const ORDER = (ids) => ids.map((id) => ({ id, ok: true, kids: [1] }));
  for (const [name, row] of ROWS) {
    test(`${name}`, async () => {
      const app = compileAndMount(`<role> = "admin"
<xs> = ${JSON.stringify(ORDER([1, 2])).replace(/"(\w+)":/g, "$1: ")}
<div id="out">\${ for (r of @xs) { ${row} } }</div>
`);
      expect(app.errors).toEqual([]);
      await flush();
      const per = count("#out b.g") / 2;
      expect(per).toBeGreaterThan(0);
      await set("role", "user");
      expect(count("#out b.g")).toBe(0);
      await set("xs", ORDER([2, 1]));
      expect(count("#out b.g")).toBe(0);
      await set("xs", ORDER([1]));
      expect(count("#out b.g")).toBe(0);
      await set("role", "admin");
      expect(count("#out b.g")).toBe(per);
      await set("xs", ORDER([3, 1, 2]));
      expect(count("#out b.g")).toBe(3 * per);
      await set("role", "user");
      expect(count("#out b.g")).toBe(0);
      await set("xs", ORDER([2, 3, 1]));
      expect(count("#out b.g")).toBe(0);
    });
  }
  test("inside a row ELEMENT it stays a region (keyed row; reorder after revoke shows nothing)", async () => {
    const app = compileAndMount(`<role> = "admin"
<xs> = ${JSON.stringify(ORDER([1, 2])).replace(/"(\w+)":/g, "$1: ")}
<div id="out">\${ for (r of @xs) { lift <i>h</i>\n lift <p>\${ ${REG} }</p> } }</div>
`);
    expect(app.errors).toEqual([]);
    expect(app.clientJs).toMatch(/_scrml_reconcile_list\(/);
    expect(app.clientJs).toMatch(/scrml-region/);
    await flush();
    await set("role", "user");
    await set("xs", ORDER([2, 1]));
    expect(count("#out b.g")).toBe(0);
    await set("role", "admin");
    expect(count("#out b.g")).toBe(2);
  });
});

describe("the value-indexed row side follows the LIVE row's field", () => {
  for (const keyed of [true, false]) {
    for (const [nname, nest] of [["sole root", (b) => b], ["nested", (b) => `<span>${b}</span>`]]) {
      const src = `<sel> = "a"\n<rows> = [{ ${keyed ? "id: 1, " : ""}k: "a" }, { ${keyed ? "id: 2, " : ""}k: "b" }]\n<div id="out">\${ for (r of @rows) { lift ${nest(`<b class="g" if=(@sel == r.k)>\${r.k}</b>`)} } }</div>\n`;
      test(`${nname}, ${keyed ? "id" : "index"} keys: a same-key replace re-keys the bucket`, async () => {
        const app = compileAndMount(src);
        expect(app.clientJs).toMatch(/_scrml_cs_reactive_subscribe_when\("sel", r\.k,/);
        await revokeCycle(app, {
          sel: "#out b.g", open: 1, off: "z", on: "a",
          write: async (v) => { globalThis.__lgs_set("rows", [{ ...(keyed ? { id: 1 } : {}), k: v }, { ...(keyed ? { id: 2 } : {}), k: "b" }]); await flush(); },
        });
        // The cell side still dispatches through the re-keyed bucket.
        await set("rows", [{ ...(keyed ? { id: 1 } : {}), k: "q" }, { ...(keyed ? { id: 2 } : {}), k: "b" }]);
        await set("sel", "q");
        expect(count("#out b.g")).toBe(1);
        await set("sel", "b");
        expect([...document.querySelectorAll("#out b.g")].map((e) => e.textContent)).toEqual(["b"]);
      });
      test(`${nname}, ${keyed ? "id" : "index"} keys: an in-place write of the row's field re-keys the bucket`, async () => {
        const app = compileAndMount(src);
        await revokeCycle(app, {
          sel: "#out b.g", open: 1, off: "z", on: "a",
          write: async (v) => { globalThis.__lgs_get("rows")[0].k = v; await flush(); },
        });
      });
    }
  }
});

describe("a gate no render can re-run is refused (fail closed)", () => {
  test("an open gate in a function body: E-IMPL1-LIFT-GATE-UNTRACKED", () => {
    const app = compileAndMount(PAGE(`\${ function pill(q: bool) { return <span><b class="g" if=(q && isAdmin())>x</b></span> } }\n\${ pill(true) }`));
    expect(app.errors).toContain("E-IMPL1-LIFT-GATE-UNTRACKED");
  });

  test("…and one reading only a parameter: the caller may have computed it from a cell (refused)", () => {
    // `pill(q)` with `const q = isAdmin()` in the caller — the parameter holds a cell's value.
    const app = compileAndMount(PAGE(`\${ function pill(q: bool) { return <span><b class="g" if=(q)>x</b></span> } }\n\${ const q = isAdmin()\n pill(q) }`));
    expect(app.errors).toContain("E-IMPL1-LIFT-GATE-UNTRACKED");
  });

  test("a run-once block whose function reads its bindings cannot be made to re-render: refused", () => {
    // Making the block a re-render effect would move `mode` inside the effect, where the hoisted
    // `matches` no longer sees it (a ReferenceError at run time) — refused at compile time instead.
    const app = compileAndMount(`<n> = 1\n<div id="out">\${ let mode = 1\n function matches() { return mode == @n }\n let ok = false\n lift <b class="g" if=(ok || matches())>x</b>\n ok = true }</div>\n`);
    expect(app.errors).toContain("E-IMPL1-LIFT-GATE-UNTRACKED");
  });

  test("a lift escaping its row (a `while` in a row) whose condition calls a function: refused", () => {
    const app = compileAndMount(PAGE(`\${ for (x of @xs) { lift <i></i>\n let i = 0\n while (i < 1) { lift <b class="g" if=isAdmin()>x</b>\n i = i + 1 } } }`));
    expect(app.errors).toContain("E-IMPL1-LIFT-GATE-UNTRACKED");
  });

  test("…and one whose condition names its cell keeps main's subscriptions (it is re-read)", async () => {
    const app = compileAndMount(PAGE(`\${ for (x of @xs) { lift <i></i>\n let i = 0\n while (i < 1) { lift <b class="g" if=(@role == "admin")>x</b>\n i = i + 1 } } }`));
    expect(app.errors).toEqual([]);
    await flush();
    const open = count("b.g");
    expect(open).toBeGreaterThan(0);
    await set("role", "user");
    expect(count("b.g")).toBe(0);
    await set("role", "admin");
    expect(count("b.g")).toBe(open);
  });
});
