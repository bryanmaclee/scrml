/**
 * nested-each-if-guard-s469 — EXECUTES the emitted client JS for an `<each if=…>`
 * that sits inside another `<each>`'s row.
 *
 * Gap: `g-nested-each-if-guard-dropped-s469` (HIGH, security). The nested-each
 * branch of emit-each never read the inner each's `ifCond`, so
 *
 *   <each in=@xs as y><each in=@xs as x if=(@pw == "secret")>LOGGED IN</each></each>
 *
 * rendered "LOGGED IN" whatever `@pw` held — an authorization guard on a nested
 * list was silently dropped. The same held for an `<each if=…>` inside lifted
 * markup (`g-lifted-each-if-attribute-silently-ignored`).
 *
 * SPEC §17.1.2: `if=` on `<each>` gates "the whole iterated list, including
 * `<empty>`"; §17.1.2.1: "the iterated collection is not read and no rows are
 * reconciled while `expr` is false".
 *
 * Each case drives compile → mount → write the guard's cells in happy-dom with the
 * PRUNED runtime the build ships, and asserts the rows in BOTH directions, so the
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

const tmpRoot = resolve(tmpdir(), "scrml-nested-each-if-s469");

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
      `globalThis.__s469_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = async (name, v) => { globalThis.__s469_set(name, v); await flush(); };
const count = (sel) => document.querySelectorAll(sel).length;
const outText = () => (document.querySelector("#out")?.textContent ?? "").replace(/\s+/g, " ").trim();

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
}

const CHECK = `type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function allowed(p) { return p == "secret" }
}
`;

describe("nested <each if=…> — the guard is honoured and reactive (§17.1.2)", () => {
  test("THE DEFECT — plain predicate: no rows while false, rows while true, both ways", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as y><each in=@xs as x if=(@pw == "secret")><b class="row">LOGGED IN</b></each></each></div>
`);
    expect(outText()).toBe("");
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 4 });
  });

  test("handled-failable predicate `${ @pw != \"\" && (check(@pw) !{ _ :> false }) }`", async () => {
    const app = compileAndMount(`${CHECK}<pw> = "wrong"
<xs> = [1]
<div id="out"><each in=@xs as y><each in=@xs as x if=\${ @pw != "" && (check(@pw) !{ _ :> false }) }><b class="row">LOGGED IN</b></each></each></div>
`);
    expect(outText()).toBe("");
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 1 });
  });

  test("call-ref predicate `if=allowed(@pw)`", async () => {
    const app = compileAndMount(`${CHECK}<pw> = "wrong"
<xs> = [1]
<div id="out"><each in=@xs as y><each in=@xs as x if=allowed(@pw)><b class="row">LOGGED IN</b></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 1 });
  });

  test("cell predicate `if=@ok`", async () => {
    const app = compileAndMount(`<ok> = false
<xs> = [1, 2]
<div id="out"><each in=@xs as y><each in=@xs as x if=@ok><b class="row">r</b></each></each></div>
`);
    await expectReactiveGate(app, { cell: "ok", off: false, on: true, sel: "#out b.row", openCount: 4 });
  });

  test("`<empty>` is gated too: false shows neither rows nor the fallback", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1, 2]
<ys> = []
<div id="out"><each in=@xs as y><each in=@ys as x if=(@pw == "secret")><b class="row">r</b><empty><i class="none">none</i></empty></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out i.none", openCount: 2 });
    expect(count("#out b.row")).toBe(0);
  });

  test("the inner collection is not read while the guard is false (§17.1.2.1)", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<reads> = 0
\${
    function items() { @reads = @reads + 1
        return [1, 2] }
}
<div id="out"><each in=@xs as y><each in=items() as x if=(@pw == "secret")><b class="row">r</b></each></each></div>
<p id="reads">\${@reads}</p>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(count("#out b.row")).toBe(0);
    expect(document.querySelector("#reads").textContent.trim()).toBe("0");
    await set("pw", "secret");
    expect(count("#out b.row")).toBe(2);
  });

  test("a toggle cycle leaves exactly the open rows (no accumulation)", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1, 2, 3]
<div id="out"><each in=@xs as y><each in=@xs as x if=(@pw == "secret")><b class="row">r</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    for (let i = 0; i < 4; i++) {
      await set("pw", "secret");
      expect(count("#out b.row")).toBe(9);
      await set("pw", "wrong");
      expect(count("#out b.row")).toBe(0);
    }
  });

  test("a source write while the guard is false does not render rows", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<ys> = [1]
<div id="out"><each in=@xs as y><each in=@ys as x if=(@pw == "secret")><b class="row">r</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await set("ys", [1, 2, 3]);
    expect(count("#out b.row")).toBe(0);
    await set("pw", "secret");
    expect(count("#out b.row")).toBe(3);
  });
});

describe("nested <each if=…> — row scope", () => {
  test("`if=@.ok` reads the ENCLOSING row's item, live across a same-key reconcile", async () => {
    const app = compileAndMount(`<xs> = [{ id: 1, ok: false }, { id: 2, ok: true }]
<cs> = [1]
<div id="out"><each in=@xs as y><each in=@cs as x if=@.ok><b class="row">\${y.id}</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(outText()).toBe("2");
    await set("xs", [{ id: 1, ok: true }, { id: 2, ok: false }]);
    expect(outText()).toBe("1");
    await set("xs", [{ id: 1, ok: true }, { id: 2, ok: true }]);
    expect(outText()).toBe("12");
  });

  test("`if=y.ok` (the row alias) is the row's item, not a cell named y", async () => {
    const app = compileAndMount(`<xs> = [{ id: 1, ok: false }, { id: 2, ok: true }]
<cs> = [1]
<div id="out"><each in=@xs as y><each in=@cs as x if=y.ok><b class="row">\${y.id}</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(outText()).toBe("2");
    await set("xs", [{ id: 1, ok: true }, { id: 2, ok: false }]);
    expect(outText()).toBe("1");
  });

  test("3-deep: an innermost guard reading the OUTERMOST row stays live", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<zs> = [{ id: 1, ok: true }]
<xs> = [1]
<div id="out"><each in=@zs as z><each in=@xs as y><each in=@xs as x if=(z.ok && @pw == "secret")><b class="row">r</b></each></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 1 });
    // Same key, the outermost item's field flips: the innermost gate must follow it.
    await set("zs", [{ id: 1, ok: false }]);
    expect(count("#out b.row")).toBe(0);
    await set("zs", [{ id: 1, ok: true }]);
    expect(count("#out b.row")).toBe(1);
  });

  test("3-deep: a guard on the MIDDLE list gates everything below it", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1, 2]
<div id="out"><each in=@xs as z><each in=@xs as y if=(@pw == "secret")><each in=@xs as x><b class="row">r</b></each></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 8 });
  });
});

describe("nested <each if=…> — containers", () => {
  test("inside a component body", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
\${ const Box = <div><each in=@xs as y><each in=@xs as x if=(@pw == "secret")><b class="row">LOGGED IN</b></each></each></div> }
<div id="out"><Box/></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 1 });
  });

  test("inside an engine state child", async () => {
    const app = compileAndMount(`<program>
type Phase:enum = { Idle, Active }
<pw> = "wrong"
<xs> = [1, 2]
<div id="out">
<engine for=Phase initial=.Idle>
  <Idle rule=.Active>
    <each in=@xs as y><each in=@xs as x if=(@pw == "secret")><b class="row">LOGGED IN</b></each></each>
  </>
  <Active rule=.Idle>"active"</>
</>
</div>
</program>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 4 });
  });

  test("inside lifted markup (`${ for … lift }`)", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<rows> = [{ id: 1, cells: [1, 2] }]
<div id="out">\${ for (r of @rows) { lift <div><each in=r.cells as c if=(@pw == "secret")><b class="row">LOGGED IN</b></each></div> } }</div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 2 });
  });
});

describe("nested <each> — the other opener attributes still apply under a guard", () => {
  test("key= : a same-key write keeps the row node", async () => {
    const app = compileAndMount(`<pw> = "secret"
<xs> = [1]
<ys> = [{ id: "a", n: 1 }]
<div id="out"><each in=@xs as y><each in=@ys as x key=x.id if=(@pw == "secret")><b class="row">\${x.n}</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    const before = document.querySelector("#out b.row");
    expect(before.textContent).toBe("1");
    await set("ys", [{ id: "a", n: 2 }]);
    const after = document.querySelector("#out b.row");
    expect(after).toBe(before);
    expect(after.textContent).toBe("2");
  });

  test("of= : a count list", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<div id="out"><each in=@xs as y><each of=3 as i if=(@pw == "secret")><b class="row">\${i}</b></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 3 });
    expect(outText()).toBe("012");
  });

  test("as (k, v) : the destructured names bind", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<ps> = [{ key: "a", value: 1 }]
<div id="out"><each in=@xs as y><each in=@ps as (k, v) if=(@pw == "secret")><b class="row">\${k}=\${v}</b></each></each></div>
`);
    await expectReactiveGate(app, { cell: "pw", off: "wrong", on: "secret", sel: "#out b.row", openCount: 1 });
    expect(outText()).toBe("a=1");
  });
});

describe("nested <each> — a value-native map / set iterable lowers as at top level (§59.8 / §59.12)", () => {
  const rowTexts = () => [...document.querySelectorAll("#out b.row")].map((b) => b.textContent).sort();

  test("in=@m.entries() iterates the map's entries", async () => {
    const app = compileAndMount(`<m>: [string: int] = ["a": 1, "b": 2]
<xs> = [1]
<div id="out"><each in=@xs as y><each in=@m.entries() as (k, v)><b class="row">\${k}=\${v}</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rowTexts()).toEqual(["a=1", "b=2"]);
  });

  test("lifted markup: in=@m.entries() and a call source `in=items()` are CALLED", async () => {
    const app = compileAndMount(`<m>: [string: int] = ["a": 1, "b": 2]
<rows> = [{ id: 1 }]
\${ function items() { return ["p", "q"] } }
<div id="out">\${ for (r of @rows) { lift <div><each in=@m.entries() as (k, v)><b class="row">\${k}=\${v}</b></each><each in=items() as t><b class="row">\${t}</b></each></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rowTexts()).toEqual(["a=1", "b=2", "p", "q"]);
  });

  test("in=@s iterates the set's elements, and follows a write", async () => {
    const app = compileAndMount(`<s>: set[string] = [:]
<xs> = [1]
<button id="add" onclick=\${ @s = @s.add("x") }>add</button>
<div id="out"><each in=@xs as y><each in=@s as e><b class="row">\${e}</b></each></each></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(rowTexts()).toEqual([]);
    document.querySelector("#add").click();
    await flush();
    expect(rowTexts()).toEqual(["x"]);
  });
});

describe("lifted <each if=…> reads the LIVE loop item (S469 review F1)", () => {
  // rows(ok1, ok2) → the tape value; lit(…) → the same value as a scrml literal.
  const mk = (withIds) => (ok1, ok2) => [
    { ...(withIds ? { id: 1 } : {}), ok: ok1, cells: [1] },
    { ...(withIds ? { id: 2 } : {}), ok: ok2, cells: [1, 2] },
  ];
  const lit = (v) => `[${v.map((o) => `{ ${Object.entries(o).map(([k, x]) => `${k}: ${JSON.stringify(x)}`).join(", ")} }`).join(", ")}]`;
  for (const [keying, rows] of [["id keys", mk(true)], ["index keys", mk(false)]]) {
    for (const guard of ["r.ok", "(r.ok)"]) {
      test(`${keying}, if=${guard}: a same-key write flips the gate both ways`, async () => {
        const app = compileAndMount(`<rows> = ${lit(rows(true, false))}
<div id="out">\${ for (r of @rows) { lift <div><each in=r.cells as c if=${guard}><b class="row">SECRET</b></each></div> } }</div>
`);
        expect(app.errors).toEqual([]);
        await flush();
        expect(count("#out b.row")).toBe(1);
        await set("rows", rows(false, true));
        expect(count("#out b.row")).toBe(2);
        await set("rows", rows(false, false));
        expect(count("#out b.row")).toBe(0);
        await set("rows", rows(true, true));
        expect(count("#out b.row")).toBe(3);
      });
    }
  }

  test("the inner source follows the live item too (`in=r.cells`, stale on main)", async () => {
    const app = compileAndMount(`<rows> = [{ id: 1, cells: [1] }]
<div id="out">\${ for (r of @rows) { lift <div><each in=r.cells as c><b class="row">\${c}</b></each></div> } }</div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(outText()).toBe("1");
    await set("rows", [{ id: 1, cells: [7, 8] }]);
    expect(outText()).toBe("78");
  });
});

describe("an `else` sibling where no if= chain is built is refused (S469 review F4)", () => {
  for (const [where, src] of [
    ["after a nested <each if=>", `<div id="out"><each in=@xs as y><each in=@xs as x if=(@pw == "secret")>A</each><p else>X</p></each></div>`],
    ["after a markup if= in a row", `<div id="out"><each in=@xs as y><p if=(@pw == "secret")>A</p><p else>X</p></each></div>`],
    ["after a lifted <each if=>", `<div id="out">\${ for (r of @rows) { lift <div><each in=r.cells as c if=r.ok>A</each><p else>X</p></div> } }</div>`],
    ["after a markup if= in lifted markup", `<div id="out">\${ for (r of @rows) { lift <div><p if=r.ok>A</p><p else>X</p></div> } }</div>`],
  ]) {
    test(`${where}: E-CTRL-001, not an unconditional render`, () => {
      const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<rows> = [{ id: 1, ok: true, cells: [1] }]
${src}
`);
      expect(app.errors).toContain("E-CTRL-001");
    });
  }

  test("else-if= in a row: E-CTRL-002", () => {
    const app = compileAndMount(`<pw> = "wrong"
<xs> = [1]
<div id="out"><each in=@xs as y><p if=(@pw == "a")>A</p><p else-if=(@pw == "b")>B</p></each></div>
`);
    expect(app.errors).toContain("E-CTRL-002");
  });

  test("a top-level if/else chain is unaffected", async () => {
    const app = compileAndMount(`<pw> = "wrong"
<div id="out"><p if=(@pw == "secret")>A</p><p else>X</p></div>
`);
    expect(app.errors).toEqual([]);
    await flush();
    expect(outText()).toBe("X");
  });
});
