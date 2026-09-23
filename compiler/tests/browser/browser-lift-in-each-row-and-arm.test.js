/**
 * browser-lift-in-each-row-and-arm.test.js —
 * g-lift-inside-each-row-or-match-arm-silently-dropped (HIGH).
 *
 * A Tier-0 `${ for (…) { lift <li/> } }` accumulation block (SPEC §10.1: "When
 * `lift` appears in an anonymous `${}` block whose parent is a markup or style
 * context, `lift` appends the value to the block's accumulator array") inside
 * an `<each>` row template or a match/engine arm body compiled at exit 0 and
 * rendered NOTHING — the emitted client carried zero `_scrml_lift` calls for it.
 * §18.0.1's own worked example is exactly such an arm:
 * `<Ready(rows)><ul>${ for (let r of rows) { lift <li>${r.name}</li> } }</ul></>`.
 *
 * These tests MOUNT the compiled output in happy-dom (runtime + client in one
 * scope, as the two classic <script>s run) and assert on the rendered DOM, then
 * mutate: inner-list mutation re-renders only its row, outer add / remove /
 * reorder / same-key replace keep every row's lifted content on its own row,
 * arm switches render and tear down, `if=` toggles do not accumulate. Every
 * "renders" assertion below fails on the pre-fix compiler (the hosts are empty).
 *
 * Emit-shape pins: compiler/tests/unit/lift-in-each-row-and-arm.test.js.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-lift-in-each-row-and-arm");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const outDir = resolve(dir, "out");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  expect(errors).toEqual([]);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeName = /scrml-runtime\.[A-Za-z0-9]+\.js/.exec(html)?.[0] ?? result.runtimeFilename ?? "scrml-runtime.js";
  const runtimeJs = readFileSync(resolve(outDir, runtimeName), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
  let initError = null;
  try {
    new Function(
      "window",
      "document",
      `${runtimeJs}\n` +
        captureInsideChunkScope(clientJs, "globalThis.__le_get = _scrml_reactive_get; globalThis.__le_set = _scrml_reactive_set;\n"),
    )(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    initError = e;
  } finally {
    console.error = origError;
  }
  expect(initError).toBeNull();
  expect(consoleErrors).toEqual([]);
  // Surface any later effect error (the runtime logs effect throws via console.error).
  const later = [];
  console.error = (...a) => { later.push(a.map(String).join(" ")); };
  return {
    get: (n) => globalThis.__le_get(n),
    set: (n, v) => globalThis.__le_set(n, v),
    done: () => { console.error = origError; expect(later).toEqual([]); },
  };
}

const texts = (sel, root = document) => [...root.querySelectorAll(sel)].map((e) => e.textContent.trim());
/** Lifted row text grouped by host `<ul>` — the per-row ownership check. */
const perUl = (ulSel = "ul.g") => [...document.querySelectorAll(ulSel)].map((ul) => texts("li", ul));

// ---------------------------------------------------------------------------
// <each> rows
// ---------------------------------------------------------------------------

const EACH_ROW = `<program>
<groups> = [{ id: 1, items: ["a", "b"] }, { id: 2, items: ["c"] }]
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">
            \${ for (let it of g.items) { lift <li class="row">\${it}</li> } }
        </ul>
    </each>
</div>
</program>
`;

describe("<each> row — a `${ for … lift }` block renders into ITS row", () => {
  test("the brief repro: every row's items land inside that row's <ul>", () => {
    const app = compileAndMount(EACH_ROW, "row");
    expect(perUl()).toEqual([["a", "b"], ["c"]]);
    // Nothing escaped its host (the pre-fix/pre-#1021 failure mode was document.body).
    expect(document.querySelectorAll("li").length).toBe(3);
    app.done();
  });

  test("mutating one row's inner list re-renders ONLY that row", () => {
    const app = compileAndMount(EACH_ROW, "row-inner");
    const otherRowLi = document.querySelectorAll("ul.g")[1].querySelector("li");
    app.get("groups")[0].items.push("z");
    expect(perUl()).toEqual([["a", "b", "z"], ["c"]]);
    // Row 2's lifted node is the SAME node — it was not rebuilt.
    expect(document.querySelectorAll("ul.g")[1].querySelector("li")).toBe(otherRowLi);
    app.get("groups")[1].items = ["c2", "c3"];
    expect(perUl()).toEqual([["a", "b", "z"], ["c2", "c3"]]);
    app.done();
  });

  test("outer add / remove / reorder / same-key replace keep each row's content on its row", () => {
    const app = compileAndMount(EACH_ROW, "row-outer");
    const row1Li = document.querySelector("ul.g li");
    app.set("groups", [...app.get("groups"), { id: 3, items: ["q", "r"] }]);
    expect(perUl()).toEqual([["a", "b"], ["c"], ["q", "r"]]);
    // An unrelated outer reconcile does not rebuild an unchanged row.
    expect(document.querySelector("ul.g li")).toBe(row1Li);
    app.set("groups", app.get("groups").filter((g) => g.id !== 2));
    expect(perUl()).toEqual([["a", "b"], ["q", "r"]]);
    app.set("groups", [...app.get("groups")].reverse());
    expect(perUl()).toEqual([["q", "r"], ["a", "b"]]);
    // Same key, NEW object: the row re-resolves its item and re-renders.
    app.set("groups", [{ id: 3, items: ["q"] }, { id: 1, items: ["replaced"] }]);
    expect(perUl()).toEqual([["q"], ["replaced"]]);
    app.set("groups", []);
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("groups", [{ id: 9, items: ["n"] }]);
    expect(perUl()).toEqual([["n"]]);
    app.done();
  });

  test("a removed row's group is stopped: mutating its old item renders nothing anywhere", () => {
    const app = compileAndMount(EACH_ROW, "row-removed");
    const removed = app.get("groups")[0];
    const detachedUl = document.querySelector("ul.g");
    app.set("groups", app.get("groups").filter((g) => g.id !== 1));
    expect(perUl()).toEqual([["c"]]);
    removed.items.push("ghost");
    expect(texts("li")).toEqual(["c"]);
    // The removed row's group no longer runs at all — not even into its
    // detached host (a live group would keep re-rendering there, leaking).
    expect(texts("li", detachedUl)).toEqual(["a", "b"]);
    app.done();
  });

  test("`@.` (no `as`) resolves to the row item", () => {
    const app = compileAndMount(EACH_ROW.replace("key=@.id as g>", "key=@.id>").replace("g.items", "@.items"), "row-sigil");
    expect(perUl()).toEqual([["a", "b"], ["c"]]);
    app.done();
  });

  test("the block as the row's ROOT (no wrapper element) renders each row's items in order", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, items: ["a", "b"] }, { id: 2, items: ["c"] }]
<ul>
    <each in=@groups key=@.id as g>
        \${ for (let it of g.items) { lift <li class="row">\${it}</li> } }
    </each>
</ul>
</program>
`, "row-root");
    expect(texts("ul li")).toEqual(["a", "b", "c"]);
    app.set("groups", [...app.get("groups")].reverse());
    expect(texts("ul li")).toEqual(["c", "a", "b"]);
    app.done();
  });

  test("a block reading an outer @cell re-renders on that cell", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, items: ["a", "b"] }, { id: 2, items: ["c"] }]
<suffix> = "!"
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">\${ for (let it of g.items) { lift <li class="row">\${it + @suffix}</li> } }</ul>
    </each>
</div>
</program>
`, "row-cell");
    expect(perUl()).toEqual([["a!", "b!"], ["c!"]]);
    app.set("suffix", "?");
    expect(perUl()).toEqual([["a?", "b?"], ["c?"]]);
    app.get("groups")[1].items.push("d");
    expect(perUl()).toEqual([["a?", "b?"], ["c?", "d?"]]);
    // The re-run above disposed the row's previous run: a later cell change is
    // rendered ONCE per row, not once per historical run.
    app.set("suffix", ".");
    expect(perUl()).toEqual([["a.", "b."], ["c.", "d."]]);
    app.done();
  });

  test("a row re-run disposes its previous run (no leaked effect keeps re-rendering)", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, items: ["a"] }, { id: 2, items: ["b"] }]
<suffix> = "!"
function tick(x) {
    globalThis.__liftHits = (globalThis.__liftHits ?? 0) + 1
    return x
}
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">\${ for (let it of g.items) { lift <li class="row">\${tick(it) + @suffix}</li> } }</ul>
    </each>
</div>
</program>
`, "row-dispose");
    expect(perUl()).toEqual([["a!"], ["b!"]]);
    // Re-run row 2 three times (each push re-runs its group).
    app.get("groups")[1].items.push("c");
    app.get("groups")[1].items.push("d");
    app.get("groups")[1].items.push("e");
    expect(perUl()).toEqual([["a!"], ["b!", "c!", "d!", "e!"]]);
    globalThis.__liftHits = 0;
    app.set("suffix", "?");
    expect(perUl()).toEqual([["a?"], ["b?", "c?", "d?", "e?"]]);
    // One live run per row: 1 + 4 lifted items evaluated, not 1 + 4 × (runs so far).
    expect(globalThis.__liftHits).toBe(5);
    app.done();
  });

  test("a keyed inner loop re-run disposes the previous run's list effects (work stays flat)", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, tag: "x" }, { id: 2, tag: "y" }]
<items> = ["a", "b"]
function tick(x) {
    globalThis.__liftHits = (globalThis.__liftHits ?? 0) + 1
    return x
}
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">\${ for (let it of @items) { lift <li class="row">\${g.tag}:\${tick(it)}</li> } }</ul>
    </each>
</div>
</program>
`, "row-keyed-dispose");
    const hitsFor = (next) => { globalThis.__liftHits = 0; app.set("items", next); return globalThis.__liftHits; };
    const first = hitsFor(["c", "d"]);
    expect(perUl()).toEqual([["x:c", "x:d"], ["y:c", "y:d"]]);
    hitsFor(["e", "f"]);
    hitsFor(["g", "h"]);
    // Each set re-runs every row once; a leaked previous run would add its own
    // work on every later set, so the count would climb set after set.
    expect(hitsFor(["i", "j"])).toBe(first);
    expect(perUl()).toEqual([["x:i", "x:j"], ["y:i", "y:j"]]);
    app.done();
  });

  test("a keyed inner loop over an @cell: every row reconciles, no accumulation", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, tag: "x" }, { id: 2, tag: "y" }]
<items> = ["a", "b"]
<div>
    <each in=@groups key=@.id as g>
        <ul class="g">\${ for (let it of @items) { lift <li class="row">\${g.tag}:\${it}</li> } }</ul>
    </each>
</div>
</program>
`, "row-keyed");
    expect(perUl()).toEqual([["x:a", "x:b"], ["y:a", "y:b"]]);
    app.set("items", ["a", "b", "c"]);
    expect(perUl()).toEqual([["x:a", "x:b", "x:c"], ["y:a", "y:b", "y:c"]]);
    app.set("groups", [...app.get("groups"), { id: 3, tag: "z" }]);
    app.set("items", ["q"]);
    expect(perUl()).toEqual([["x:q"], ["y:q"], ["z:q"]]);
    app.done();
  });

  test("nested <each>: the inner row renders its own items and reads the outer item", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, tag: "A", subs: [{ id: 11, items: ["a", "b"] }] }, { id: 2, tag: "B", subs: [{ id: 21, items: ["c"] }] }]
<div>
    <each in=@groups key=@.id as g>
        <section>
            <each in=g.subs key=@.id as s>
                <ul class="g">\${ for (let it of s.items) { lift <li class="row">\${g.tag}\${it}</li> } }</ul>
            </each>
        </section>
    </each>
</div>
</program>
`, "row-nested");
    expect(perUl()).toEqual([["Aa", "Ab"], ["Bc"]]);
    app.get("groups")[1].subs[0].items.push("d");
    expect(perUl()).toEqual([["Aa", "Ab"], ["Bc", "Bd"]]);
    app.done();
  });

  test("<each of=N>: the index is the row's scope", () => {
    const app = compileAndMount(`<program>
<n> = 2
<div>
    <each of=@n as i>
        <ul class="g">\${ for (let k of [i, i + 10]) { lift <li class="row">\${k}</li> } }</ul>
    </each>
</div>
</program>
`, "row-of");
    expect(perUl()).toEqual([["0", "10"], ["1", "11"]]);
    app.set("n", 3);
    expect(perUl()).toEqual([["0", "10"], ["1", "11"], ["2", "12"]]);
    app.done();
  });

  test("the <empty> body renders its lift block", () => {
    const app = compileAndMount(`<program>
<groups> = []
<words> = ["p", "q"]
<div>
    <each in=@groups as g>
        <p>\${g}</p>
        <empty><ul class="g">\${ for (let w of @words) { lift <li class="row">\${w}</li> } }</ul></empty>
    </each>
</div>
</program>
`, "row-empty");
    expect(perUl()).toEqual([["p", "q"]]);
    app.set("words", ["r"]);
    expect(perUl()).toEqual([["r"]]);
    app.done();
  });
});

describe("<each> rows under if= — toggles do not accumulate", () => {
  test("each inside an if=: every open/close cycle renders each row's items exactly once", () => {
    const app = compileAndMount(`<program>
<show> = true
<groups> = [{ id: 1, items: ["a", "b"] }, { id: 2, items: ["c"] }]
<div if=@show>
    <each in=@groups key=@.id as g>
        <ul class="g">\${ for (let it of g.items) { lift <li class="row">\${it}</li> } }</ul>
    </each>
</div>
</program>
`, "row-in-if");
    expect(perUl()).toEqual([["a", "b"], ["c"]]);
    for (let cycle = 0; cycle < 3; cycle++) {
      app.set("show", false);
      expect(document.querySelectorAll("li").length).toBe(0);
      app.set("show", true);
      expect(perUl()).toEqual([["a", "b"], ["c"]]);
    }
    app.get("groups")[0].items.push("z");
    expect(perUl()).toEqual([["a", "b", "z"], ["c"]]);
    app.done();
  });

  test("if= on the row's sole root: the row appears / disappears with its items", () => {
    const app = compileAndMount(`<program>
<groups> = [{ id: 1, open: true, items: ["a", "b"] }, { id: 2, open: false, items: ["c"] }]
<div>
    <each in=@groups key=@.id as g>
        <ul class="g" if=g.open>
            \${ for (let it of g.items) { lift <li class="row">\${it}</li> } }
        </ul>
    </each>
</div>
</program>
`, "row-if-root");
    expect(perUl()).toEqual([["a", "b"]]);
    app.get("groups")[0].open = false;
    expect(document.querySelectorAll("li").length).toBe(0);
    app.get("groups")[1].open = true;
    expect(perUl()).toEqual([["c"]]);
    app.get("groups")[1].items.push("d");
    expect(perUl()).toEqual([["c", "d"]]);
    app.done();
  });
});

// ---------------------------------------------------------------------------
// match / engine arms
// ---------------------------------------------------------------------------

describe("match / engine arm — the arm's lift block renders per arm entry", () => {
  test("§18.0.1's own shape: `<Ready(rows)><ul>${ for (let r of rows) { lift <li> } }</ul></>`", () => {
    const app = compileAndMount(`<program>
\${
    type LoadPhase:enum = { NotAsked, Ready(rows: string[]) }
}
<phase>: LoadPhase = .NotAsked
<match for=LoadPhase on=@phase>
    <NotAsked><p class="none">none</p></>
    <Ready(rows)><ul class="m">\${ for (let r of rows) { lift <li class="row">\${r}</li> } }</ul></>
</>
</program>
`, "match-arm");
    expect(texts("p.none")).toEqual(["none"]);
    app.set("phase", { variant: "Ready", data: { rows: ["a", "b"] } });
    expect(perUl("ul.m")).toEqual([["a", "b"]]);
    app.set("phase", "NotAsked");
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("phase", { variant: "Ready", data: { rows: ["c"] } });
    expect(perUl("ul.m")).toEqual([["c"]]);
    app.done();
  });

  test("a match arm whose body IS the lift block", () => {
    const app = compileAndMount(`<program>
\${
    type LoadPhase:enum = { NotAsked, Ready(rows: string[]) }
}
<phase>: LoadPhase = .Ready(["a", "b"])
<ul class="m">
<match for=LoadPhase on=@phase>
    <NotAsked><li>none</li></>
    <Ready(rows)>\${ for (let r of rows) { lift <li class="row">\${r}</li> } }</>
</>
</ul>
</program>
`, "match-arm-direct");
    expect(texts("li.row")).toEqual(["a", "b"]);
    app.done();
  });

  test("engine arm over an @cell: renders, stops on switch-away, re-renders fresh on re-entry", () => {
    const app = compileAndMount(`<program>
\${
    type Phase:enum = { Idle, Active }
}
<items> = ["a", "b"]
<engine for=Phase initial=.Active>
    <Idle rule=.Active><p class="idle">idle</p></>
    <Active rule=.Idle><ul class="e">\${ for (let it of @items) { lift <li class="row">\${it}</li> } }</ul></>
</>
</program>
`, "engine-arm");
    expect(perUl("ul.e")).toEqual([["a", "b"]]);
    app.set("phase", "Idle");
    app.set("items", ["x"]);
    // The torn-down arm's group rendered nothing anywhere.
    expect(document.querySelectorAll("li").length).toBe(0);
    expect(texts("p.idle")).toEqual(["idle"]);
    app.set("phase", "Active");
    expect(perUl("ul.e")).toEqual([["x"]]);
    app.set("items", ["y", "z"]);
    expect(perUl("ul.e")).toEqual([["y", "z"]]);
    app.done();
  });

  test("engine arm with a payload binding", () => {
    const app = compileAndMount(`<program>
\${
    type Phase:enum = { Idle, Ready(rows: string[]) }
}
<engine for=Phase initial=.Idle>
    <Idle rule=.Ready><p class="idle">idle</p></>
    <Ready(rows) rule=.Idle><ul class="e">\${ for (let r of rows) { lift <li class="row">\${r}</li> } }</ul></>
</>
</program>
`, "engine-payload");
    expect(texts("p.idle")).toEqual(["idle"]);
    app.set("phase", { variant: "Ready", data: { rows: ["a", "b"] } });
    expect(perUl("ul.e")).toEqual([["a", "b"]]);
    app.set("phase", "Idle");
    expect(document.querySelectorAll("li").length).toBe(0);
    app.done();
  });

  test("a match arm nested in an engine arm: renders, switches, reconciles", () => {
    const app = compileAndMount(`<program>
\${
    type Phase:enum = { Idle, Active }
    type Kind:enum = { A, B }
}
<kind>: Kind = .A
<items> = ["a", "b"]
<engine for=Phase initial=.Active>
    <Idle rule=.Active><p class="idle">idle</p></>
    <Active rule=.Idle><match for=Kind on=@kind><A><ul class="m">\${ for (let it of @items) { lift <li class="row">\${it}</li> } }</ul></><B><p class="b">b</p></></></>
</>
</program>
`, "match-in-engine");
    expect(perUl("ul.m")).toEqual([["a", "b"]]);
    app.set("kind", "B");
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("kind", "A");
    app.set("items", ["q"]);
    expect(perUl("ul.m")).toEqual([["q"]]);
    app.done();
  });

  test("an <each> inside a match arm: each row renders its own lift block", () => {
    const app = compileAndMount(`<program>
\${
    type LoadPhase:enum = { NotAsked, Ready(n: number) }
}
<phase>: LoadPhase = .Ready(1)
<items> = ["a", "b"]
<match for=LoadPhase on=@phase>
    <NotAsked><p>none</p></>
    <Ready(n)>
        <each in=@items as g>
            <ul class="g">\${ for (let it of [g, g]) { lift <li class="row">\${it}</li> } }</ul>
        </each>
    </>
</>
</program>
`, "each-in-arm");
    expect(perUl()).toEqual([["a", "a"], ["b", "b"]]);
    app.done();
  });
});
