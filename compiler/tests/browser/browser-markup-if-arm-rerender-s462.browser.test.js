/**
 * browser-markup-if-arm-rerender-s462 — EXECUTES the emitted client JS for a
 * markup `${ if … }` lift group whose arm does not change.
 *
 * Gap: `g-impl1-markup-if-branch-memo-stale-render-s462` (HIGH). The group was
 * one effect behind a guard — `const _branch = (<first cond>) ? 1 : 0; if
 * (_branch === <memo>) return;` — kept to preserve listeners and input state.
 * The early return also skipped every read in the arm, so
 * `${ if (@on) { lift <p>${@n}</p> } }` kept showing the first `@n`, and an
 * `else if` arm never replaced the `else` arm (the memo saw only the first
 * condition).
 *
 * SPEC §7.4.2: "When `expr` references one or more reactive cells (`@x` access),
 * the interpolation site SHALL re-render whenever any referenced cell changes".
 * §17.1: "`if=` is sugar over `${ if(expr) { lift <element>...</element> } }`."
 *
 * Each case drives compile → mount → mutate in happy-dom with the PRUNED
 * runtime the build ships (`result.runtimeFilename`).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-markup-if-arm-s462");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__s462_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = (name, v) => globalThis.__s462_set(name, v);
const text = (sel) => document.querySelector(sel)?.textContent ?? null;

/** Collect `console.error` calls made while `fn` runs (the runtime logs a throwing effect there). */
async function captureConsoleErrors(fn) {
  const seen = [];
  const orig = console.error;
  console.error = (...args) => { seen.push(args.map(String).join(" ")); };
  try { await fn(); } finally { console.error = orig; }
  return seen;
}

describe("markup ${ if } lift — reads in an unchanged arm re-render (g-impl1-markup-if-branch-memo-stale-render-s462)", () => {
  test("repro A — presence condition: the arm shows the new value of the tested cell", async () => {
    const { errors, clientJs } = compileAndMount(`<program>
<x> = "a"
<button id="set" onclick=@x = "b">set</button>
<div id="host">\${ if (@x is given) { lift <p id="p">\${@x}</p> } }</div>
</program>
`, "repro-a");
    expect(errors).toEqual([]);
    // The stale-render guard is gone.
    expect(clientJs).not.toMatch(/\? 1 : 0;\s*\n\s*if \(_branch ===/);
    expect(text("#p")).toBe("a");
    const before = document.querySelector("#p");
    document.querySelector("#set").click();
    await flush();
    expect(text("#p")).toBe("b");
    // Updated in place: the arm was not re-rendered.
    expect(document.querySelector("#p")).toBe(before);
  });

  test("repro A — the compound-cell shape from the gap entry", async () => {
    compileAndMount(`<program>
<user>: { name: string } | not = { name: "a" }
<button id="set" onclick=@user = { name: "b" }>set</button>
<div id="host">\${ if (@user is given) { lift <p id="name">\${@user.name}</p> } }</div>
</program>
`, "repro-a-user");
    expect(text("#name")).toBe("a");
    document.querySelector("#set").click();
    await flush();
    expect(text("#name")).toBe("b");
  });

  test("repro B — a read of a cell the condition does not mention", async () => {
    const { errors } = compileAndMount(`<program>
<on> = true
<n> = 0
<button id="inc" onclick=@n = @n + 1>inc</button>
<div id="host">\${ if (@on) { lift <p id="p">\${@n}</p> } }</div>
</program>
`, "repro-b");
    expect(errors).toEqual([]);
    expect(text("#p")).toBe("0");
    document.querySelector("#inc").click();
    await flush();
    expect(text("#p")).toBe("1");
    document.querySelector("#inc").click();
    await flush();
    expect(text("#p")).toBe("2");
    expect(document.querySelectorAll("#host p").length).toBe(1);
  });

  test("an attribute binding in the arm updates", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 0
<button id="inc" onclick=@n = @n + 1>inc</button>
<div id="host">\${ if (@on) { lift <p id="p" class="c-\${@n}" title=@n>x</p> } }</div>
</program>
`, "attr");
    expect(document.querySelector("#p").getAttribute("class")).toBe("c-0");
    expect(document.querySelector("#p").getAttribute("title")).toBe("0");
    document.querySelector("#inc").click();
    await flush();
    expect(document.querySelector("#p").getAttribute("class")).toBe("c-1");
    expect(document.querySelector("#p").getAttribute("title")).toBe("1");
  });

  test("toggling the condition off and on renders the arm afresh with current values", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 0
<div id="host">\${ if (@on) { lift <p id="p">\${@n}</p> } }</div>
</program>
`, "toggle");
    set("on", false);
    await flush();
    expect(document.querySelector("#p")).toBeNull();
    set("n", 7);
    await flush();
    expect(document.querySelector("#p")).toBeNull();
    set("on", true);
    await flush();
    expect(text("#p")).toBe("7");
    set("n", 8);
    await flush();
    expect(text("#p")).toBe("8");
    expect(document.querySelectorAll("#host p").length).toBe(1);
  });

  test("else-if / else chain: every arm is selected, and each arm's reads update", async () => {
    compileAndMount(`<program>
<mode> = "a"
<n> = 0
<div id="host">\${
  if (@mode == "a") {
    lift <p id="pa">a-\${@n}</p>
  } else if (@mode == "b") {
    lift <p id="pb">b-\${@n}</p>
  } else {
    lift <p id="pc">c-\${@n}</p>
  }
}</div>
</program>
`, "chain");
    expect(text("#pa")).toBe("a-0");
    set("n", 1);
    await flush();
    expect(text("#pa")).toBe("a-1");
    set("mode", "b");
    await flush();
    expect(document.querySelector("#pa")).toBeNull();
    expect(text("#pb")).toBe("b-1");
    set("n", 2);
    await flush();
    expect(text("#pb")).toBe("b-2");
    // Pre-fix: the memo saw only `@mode == "a"` (false → false), so the `else`
    // arm never replaced the `else if` arm.
    set("mode", "c");
    await flush();
    expect(document.querySelector("#pb")).toBeNull();
    expect(text("#pc")).toBe("c-2");
    set("n", 3);
    await flush();
    expect(text("#pc")).toBe("c-3");
    set("mode", "a");
    await flush();
    expect(text("#pa")).toBe("a-3");
    expect(document.querySelectorAll("#host p").length).toBe(1);
  });

  test("else-if chain without a final else: no arm taken leaves the host empty", async () => {
    compileAndMount(`<program>
<mode> = "a"
<n> = 0
<div id="host">\${
  if (@mode == "a") {
    lift <p id="pa">\${@n}</p>
  } else if (@mode == "b") {
    lift <p id="pb">\${@n}</p>
  }
}</div>
</program>
`, "chain-no-else");
    set("mode", "z");
    await flush();
    expect(document.querySelector("#host [data-scrml-logic]").children.length).toBe(0);
    set("mode", "b");
    await flush();
    expect(text("#pb")).toBe("0");
  });

  test("nested if in an arm body: the inner condition and the inner reads both update", async () => {
    compileAndMount(`<program>
<on> = true
<inner> = true
<n> = 0
<div id="host">\${
  if (@on) {
    if (@inner) {
      lift <p id="in">in-\${@n}</p>
    } else {
      lift <p id="out">out-\${@n}</p>
    }
  }
}</div>
</program>
`, "nested-stmt");
    expect(text("#in")).toBe("in-0");
    set("n", 1);
    await flush();
    expect(text("#in")).toBe("in-1");
    set("inner", false);
    await flush();
    expect(document.querySelector("#in")).toBeNull();
    expect(text("#out")).toBe("out-1");
    set("n", 2);
    await flush();
    expect(text("#out")).toBe("out-2");
    expect(document.querySelectorAll("#host p").length).toBe(1);
  });

  test("nested ${ if } inside the arm's lifted markup", async () => {
    compileAndMount(`<program>
<on> = true
<inner> = false
<n> = 0
<div id="host">\${
  if (@on) {
    lift <div id="box"><span id="s">\${@n}</span>\${ if (@inner) { lift <b id="b">\${@n}</b> } }</div>
  }
}</div>
</program>
`, "nested-markup");
    expect(text("#s")).toBe("0");
    expect(document.querySelector("#b")).toBeNull();
    set("inner", true);
    await flush();
    expect(text("#b")).toBe("0");
    set("n", 4);
    await flush();
    expect(text("#s")).toBe("4");
    expect(text("#b")).toBe("4");
    set("inner", false);
    await flush();
    expect(document.querySelector("#b")).toBeNull();
    expect(text("#s")).toBe("4");
  });

  test("a keyed for inside an if: the list reconciles, a sibling read updates", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 0
<items> = [{ id: 1, t: "x" }, { id: 2, t: "y" }]
<button id="add" onclick=@items = [...@items, { id: 3, t: "z" }]>add</button>
<div id="host">\${
  if (@on) {
    lift <p id="n">\${@n}</p>
    for (let it of @items) {
      lift <li class="row">\${it.t}</li>
    }
  }
}</div>
</program>
`, "for-in-if");
    expect([...document.querySelectorAll("#host .row")].map((e) => e.textContent)).toEqual(["x", "y"]);
    const firstRow = document.querySelector("#host .row");
    document.querySelector("#add").click();
    await flush();
    expect([...document.querySelectorAll("#host .row")].map((e) => e.textContent)).toEqual(["x", "y", "z"]);
    set("n", 5);
    await flush();
    expect(text("#n")).toBe("5");
    expect([...document.querySelectorAll("#host .row")].map((e) => e.textContent)).toEqual(["x", "y", "z"]);
    // Neither change re-rendered the arm: the first row is the same node.
    expect(document.querySelector("#host .row")).toBe(firstRow);
    set("on", false);
    await flush();
    expect(document.querySelectorAll("#host .row").length).toBe(0);
    set("on", true);
    await flush();
    expect([...document.querySelectorAll("#host .row")].map((e) => e.textContent)).toEqual(["x", "y", "z"]);
  });

  test("a for inside the arm's lifted markup reads an outer cell per row", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 0
<items> = ["x", "y"]
<div id="host">\${
  if (@on) {
    lift <ul id="ul">\${ for (let it of @items) { lift <li>\${it}-\${@n}</li> } }</ul>
  }
}</div>
</program>
`, "for-in-markup");
    expect([...document.querySelectorAll("#ul li")].map((e) => e.textContent)).toEqual(["x-0", "y-0"]);
    set("n", 1);
    await flush();
    expect([...document.querySelectorAll("#ul li")].map((e) => e.textContent)).toEqual(["x-1", "y-1"]);
    set("items", ["x", "y", "w"]);
    await flush();
    expect([...document.querySelectorAll("#ul li")].map((e) => e.textContent)).toEqual(["x-1", "y-1", "w-1"]);
  });

  test("an input in the arm keeps its typed value and focus while a sibling read updates; listeners survive", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 0
<draft> = ""
<div id="host">\${
  if (@on) {
    lift <div id="box">
      <input id="bound" bind:value=@draft/>
      <input id="free"/>
      <p id="n">\${@n}</p>
      <p id="echo">\${@draft}</p>
      <button id="inc" onclick=@n = @n + 1>inc</button>
    </div>
  }
}</div>
</program>
`, "input-state");
    const bound = document.querySelector("#bound");
    const free = document.querySelector("#free");
    // Type into the bound input: the cell takes the text, the arm is not re-rendered.
    bound.focus();
    bound.value = "hello";
    bound.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(text("#echo")).toBe("hello");
    expect(document.querySelector("#bound")).toBe(bound);
    expect(document.activeElement).toBe(bound);
    // Type into the unbound input, then change a sibling read through the arm's own button.
    free.focus();
    free.value = "typed";
    free.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#inc").click();
    await flush();
    expect(text("#n")).toBe("1");
    expect(document.querySelector("#free")).toBe(free);
    expect(free.value).toBe("typed");
    expect(document.activeElement).toBe(free);
    expect(document.querySelector("#bound").value).toBe("hello");
    // The listener survived the update and fires exactly once per click.
    document.querySelector("#inc").click();
    await flush();
    expect(text("#n")).toBe("2");
    // A write to the bound cell from outside reaches the input.
    set("draft", "reset");
    await flush();
    expect(document.querySelector("#bound").value).toBe("reset");
  });

  test("leaving the arm as its condition's cell turns `not` does not run the outgoing arm's reads", async () => {
    compileAndMount(`<program>
<user>: { name: string } | not = { name: "a" }
<div id="host">\${ if (@user is given) { lift <p id="name">\${@user.name}</p> } }</div>
</program>
`, "no-glitch");
    expect(text("#name")).toBe("a");
    const errs = await captureConsoleErrors(async () => {
      set("user", null);
      await flush();
    });
    expect(errs).toEqual([]);
    expect(document.querySelector("#name")).toBeNull();
    set("user", { name: "c" });
    await flush();
    expect(text("#name")).toBe("c");
  });

  test("a read the arm makes outside its markup re-renders the arm", async () => {
    compileAndMount(`<program>
<on> = true
<n> = 1
<div id="host">\${
  if (@on) {
    const doubled = @n * 2
    lift <p id="p">\${doubled}</p>
  }
}</div>
</program>
`, "logic-read");
    expect(text("#p")).toBe("2");
    set("n", 5);
    await flush();
    expect(text("#p")).toBe("10");
    expect(document.querySelectorAll("#host p").length).toBe(1);
  });

  test("a group whose host is inside an if= template (mount-deferred): reads update, a remount starts clean", async () => {
    compileAndMount(`<program>
<show> = true
<on> = true
<n> = 0
<section id="sec" if=@show>
  <div id="host">\${ if (@on) { lift <p id="p">\${@n}</p> } }</div>
</section>
</program>
`, "mount-deferred");
    expect(text("#p")).toBe("0");
    set("n", 1);
    await flush();
    expect(text("#p")).toBe("1");
    set("show", false);
    await flush();
    expect(document.querySelector("#p")).toBeNull();
    set("n", 2);
    await flush();
    set("show", true);
    await flush();
    expect(text("#p")).toBe("2");
    set("n", 3);
    await flush();
    expect(text("#p")).toBe("3");
    expect(document.querySelectorAll("#p").length).toBe(1);
  });

  test("if / else whose else arm is a keyed list, under an if= template (gauntlet-r10-odin-filebrowser shape)", async () => {
    compileAndMount(`<program>
<isSearching> = false
<searchResults> = []
<picked> = 0
\${
  function pick(id) { @picked = id }
}
<div class="results" if=@isSearching>
  <ul>\${
    if (@searchResults.length == 0) {
      lift <li class="none">No files found</li>
    } else {
      for (let result of @searchResults) {
        lift <li class="item"><button onclick=pick(result.id)><span class="name">\${result.name}</span></button></li>
      }
    }
  }</ul>
</div>
<p id="picked">\${@picked}</p>
</program>
`, "odin-shape");
    set("isSearching", true);
    await flush();
    const box = () => document.querySelector(".results");
    expect(box().querySelectorAll(".none").length).toBe(1);
    set("searchResults", [{ id: 1, name: "a" }]);
    await flush();
    expect(box().querySelectorAll(".none").length).toBe(0);
    expect([...box().querySelectorAll(".item .name")].map((e) => e.textContent)).toEqual(["a"]);
    const first = box().querySelector(".item");
    set("searchResults", [{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    await flush();
    expect([...box().querySelectorAll(".item .name")].map((e) => e.textContent)).toEqual(["a", "b"]);
    // Same arm: the list reconciled in place, its first row kept.
    expect(box().querySelector(".item")).toBe(first);
    box().querySelectorAll(".item button")[1].click();
    await flush();
    expect(text("#picked")).toBe("2");
    set("searchResults", []);
    await flush();
    expect(box().querySelectorAll(".item").length).toBe(0);
    expect(box().querySelectorAll(".none").length).toBe(1);
  });

  test("a group inside an <each> row (nested group): the row's arm reads update", async () => {
    compileAndMount(`<program>
<rows> = [{ id: 1, t: "x" }, { id: 2, t: "y" }]
<on> = true
<n> = 0
<ul id="ul">
  <each in=@rows><li class="row">\${ if (@on) { lift <span class="v">\${@.t}-\${@n}</span> } }</li></each>
</ul>
</program>
`, "each-row");
    expect([...document.querySelectorAll("#ul .v")].map((e) => e.textContent)).toEqual(["x-0", "y-0"]);
    set("n", 1);
    await flush();
    expect([...document.querySelectorAll("#ul .v")].map((e) => e.textContent)).toEqual(["x-1", "y-1"]);
    set("on", false);
    await flush();
    expect(document.querySelectorAll("#ul .v").length).toBe(0);
    set("on", true);
    await flush();
    expect([...document.querySelectorAll("#ul .v")].map((e) => e.textContent)).toEqual(["x-1", "y-1"]);
  });
});
