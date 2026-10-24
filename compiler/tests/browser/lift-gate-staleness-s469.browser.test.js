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
