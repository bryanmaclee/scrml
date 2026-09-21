/**
 * browser-lift-target-mount-template.test.js —
 * g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template (HIGH).
 *
 * `benchmarks/todomvc/app.scrml` compiled at exit 0 and rendered ZERO rows: its
 * `${ for … lift <li> }` sits inside `<section class="main" if=@todos.length>`,
 * and since `if=` REMOVES from the DOM (§17.1, lowered to a mount `<template>`
 * cloned in on each false→true transition) the lift target — bound once at
 * module init with `document.querySelector`, which never descends into template
 * content — was `null`. Depending on the group's shape the client then threw
 * (`null.innerHTML`) or `_scrml_lift` fell back to `document.body`, lifting the
 * rows OUTSIDE their host where they survived the host's own unmount.
 *
 * The same class held at five anchor display sites (`<textarea>` RCDATA
 * content, `<errors of>`, `<render of=@cell>`, an `<errorBoundary>` `${…}`, a
 * `${serverFn()}` one-shot): each was a boot-time document-scoped lookup that
 * no-ops for a template-interior anchor and never re-runs.
 *
 * These tests MOUNT the compiled output in happy-dom (runtime + client in one
 * scope, as two classic <script>s run) and assert on the rendered DOM. Every
 * case below fails on the pre-fix compiler.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-lift-target-mount-template");
const TODOMVC_SRC = resolve(import.meta.dir, "../../../benchmarks/todomvc/app.scrml");

function mountCompiled(inputPath, baseName, outDir) {
  const result = compileScrml({ inputFiles: [inputPath], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeName = /scrml-runtime\.[A-Za-z0-9]+\.js/.exec(html)?.[0] ?? result.runtimeFilename ?? "scrml-runtime.js";
  const runtimeJs = readFileSync(resolve(outDir, runtimeName), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  try { globalThis.localStorage && globalThis.localStorage.clear(); } catch { /* storage unavailable */ }
  const fetches = [];
  // The stub stays installed after mount (a later re-mount fetches again); each
  // mount installs its own, so a later test never records into an earlier array.
  globalThis.fetch = window.fetch = (u) => { fetches.push(String(u)); return new Promise(() => {}); };
  const consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
  let initError = null;
  try {
    new Function(
      "window",
      "document",
      `${runtimeJs}\n` +
        captureInsideChunkScope(clientJs, "globalThis.__lm_get = _scrml_reactive_get; globalThis.__lm_set = _scrml_reactive_set;\n"),
    )(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    initError = e;
  } finally {
    console.error = origError;
  }
  return {
    errors,
    initError,
    consoleErrors,
    fetches,
    get: (n) => globalThis.__lm_get(n),
    set: (n, v) => globalThis.__lm_set(n, v),
  };
}

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const app = mountCompiled(input, baseName, resolve(dir, "out"));
  expect(app.errors).toEqual([]);
  expect(app.initError).toBeNull();
  expect(app.consoleErrors).toEqual([]);
  return app;
}

const texts = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());

// ---------------------------------------------------------------------------
// lift targets
// ---------------------------------------------------------------------------

describe("a lift host inside an if= mount <template> renders into the MOUNTED host", () => {
  test("the min repro: `<ul if=@items.length> ${ for … lift <li> } </ul>`", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<ul if=@items.length>
    \${ for (let it of @items) { lift <li>\${it}</li> } }
</ul>
</program>
`, "min");
    expect(texts("ul li")).toEqual(["a", "b"]);
    // Pre-fix the rows went to document.body: every <li> must be inside the <ul>.
    expect(document.querySelectorAll("li").length).toBe(2);
    app.set("items", []);
    expect(document.querySelector("ul")).toBeNull();
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("items", ["x", "y", "z"]);
    expect(texts("ul li")).toEqual(["x", "y", "z"]);
    expect(document.querySelectorAll("li").length).toBe(3);
  });

  test("the TodoMVC benchmark app renders its rows inside ul.todo-list", () => {
    const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const app = mountCompiled(TODOMVC_SRC, "app", resolve(tmpRoot, `todomvc-${uniq}`));
    expect(app.errors).toEqual([]);
    expect(app.initError).toBeNull();
    expect(app.consoleErrors).toEqual([]);
    app.set("todos", [
      { id: 1, title: "one", completed: false },
      { id: 2, title: "two", completed: true },
    ]);
    expect(texts("section.main ul.todo-list li.todo-item label")).toEqual(["one", "two"]);
    expect(document.querySelectorAll("li.todo-item").length).toBe(2);
    // The footer's own lift (`if (completedCount() > 0) { lift <button> }`) is
    // the SECOND mount-template lift in the app — also bound on mount.
    expect(document.querySelectorAll("footer .clear-completed").length).toBe(1);
  });

  test("an if= false→true→false→true cycle re-renders each mount exactly once, and the old mount's effects are gone", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<show> = true
<label> = "L"
<section if=@show>
    <ul>
        \${
            for (let it of @items) { lift <li>\${it}</li> }
            if (@label == "L") { lift <li class="extra">extra</li> }
        }
    </ul>
</section>
</program>
`, "cycle");
    expect(texts("ul li")).toEqual(["a", "b", "extra"]);
    const firstUl = document.querySelector("ul");
    app.set("show", false);
    expect(document.querySelector("section")).toBeNull();
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("show", true);
    expect(texts("ul li")).toEqual(["a", "b", "extra"]);
    app.set("show", false);
    app.set("show", true);
    expect(texts("ul li")).toEqual(["a", "b", "extra"]);
    // Reactivity lives on the CURRENT mount…
    app.set("items", ["z"]);
    app.set("label", "M");
    expect(texts("ul li")).toEqual(["z"]);
    // …and the first mount's effects were disposed with it: its detached <ul>
    // no longer follows the cells.
    expect(firstUl.isConnected).toBe(false);
    expect([...firstUl.querySelectorAll("li")].map((l) => l.textContent.trim())).toEqual(["a", "b", "extra"]);
  });

  test("a non-reactive lift group inside an if= body", () => {
    const app = compileAndMount(`<program>
<show> = true
function yes() { return true }
<section if=@show>
    <div class="host">
        \${ if (yes()) { lift <b>static-lift</b> } }
    </div>
</section>
</program>
`, "plain");
    expect(texts(".host b")).toEqual(["static-lift"]);
    expect(document.querySelectorAll("b").length).toBe(1);
    app.set("show", false);
    expect(document.querySelectorAll("b").length).toBe(0);
    app.set("show", true);
    expect(texts(".host b")).toEqual(["static-lift"]);
    expect(document.querySelectorAll("b").length).toBe(1);
  });

  test("a lift host inside an if-chain branch", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<mode> = 1
<div>
    <ul if=(@mode == 1)>
        \${ for (let it of @items) { lift <li>\${it}</li> } }
    </ul>
    <p else>none</p>
</div>
</program>
`, "chain");
    expect(texts("ul li")).toEqual(["a", "b"]);
    app.set("mode", 2);
    expect(document.querySelectorAll("li").length).toBe(0);
    expect(texts("p")).toEqual(["none"]);
    app.set("mode", 1);
    expect(texts("ul li")).toEqual(["a", "b"]);
    expect(document.querySelectorAll("li").length).toBe(2);
  });

  test("a lift host in an if= nested inside another if= renders once, through outer and inner cycles", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<outer> = true
<div>
    <section if=@outer>
        <ul if=@items.length>
            \${ for (let it of @items) { lift <li>\${it}</li> } }
        </ul>
    </section>
</div>
</program>
`, "nested");
    // The inner if= mounts DURING the outer mount's rewire pass; the host must
    // be bound once, not by both passes (that would duplicate every row).
    expect(texts("ul li")).toEqual(["a", "b"]);
    expect(document.querySelectorAll("li").length).toBe(2);
    app.set("outer", false);
    expect(document.querySelectorAll("li").length).toBe(0);
    app.set("outer", true);
    expect(texts("ul li")).toEqual(["a", "b"]);
    expect(document.querySelectorAll("li").length).toBe(2);
    app.set("items", []);
    expect(document.querySelector("ul")).toBeNull();
    app.set("items", ["q"]);
    expect(texts("ul li")).toEqual(["q"]);
    expect(document.querySelectorAll("li").length).toBe(1);
  });

  test("a lift host beside an <each> inside the same if= body: both render, both re-render per mount", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<rows> = [{ id: 1, name: "r1" }, { id: 2, name: "r2" }]
<show> = true
<section if=@show>
    <ul class="lift">\${ for (let it of @items) { lift <li>\${it}</li> } }</ul>
    <ol class="each"><each in=@rows key=@.id><li>\${@.name}</li></each></ol>
</section>
</program>
`, "each-beside");
    expect(texts("ul.lift li")).toEqual(["a", "b"]);
    expect(texts("ol.each li")).toEqual(["r1", "r2"]);
    app.set("show", false);
    app.set("show", true);
    expect(texts("ul.lift li")).toEqual(["a", "b"]);
    expect(texts("ol.each li")).toEqual(["r1", "r2"]);
    expect(document.querySelectorAll("li").length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// the five anchor display sites — same class
// ---------------------------------------------------------------------------

describe("anchor display sites inside an if= mount <template> render on mount", () => {
  test("<textarea> RCDATA content takes its value, and keeps it across a re-mount", () => {
    const app = compileAndMount(`<program>
<show> = true
<txt> = "RC_OK"
<div if=@show>
    <textarea id="ta">\${@txt}</textarea>
</div>
</program>
`, "rcdata");
    expect(document.querySelector("#ta").value).toBe("RC_OK");
    app.set("show", false);
    app.set("show", true);
    app.set("txt", "RC2");
    expect(document.querySelector("#ta").value).toBe("RC2");
  });

  test("<render of=@cell/> renders the held variant", () => {
    compileAndMount(`<program>
type LE:enum = { NotFound(id: string) renders <p class="rend">No #\${id}</p>, Network(msg: string) renders <p class="rend">Net \${msg}</p> }
<err>: LE = .NotFound("42")
<show> = true
<div if=@show><render of=@err/></div>
</program>
`, "render");
    expect(texts("p.rend")).toEqual(["No 42"]);
  });

  test("<errors of=…/> renders the field's error", () => {
    compileAndMount(`<program>
<page>
  <show> = true
  <signupForm>
    <email req pattern(/^[^@]+@[^@]+$/)> = <input type="email"/>
  </>
  <div if=@show>
    <form>
      <input id="email-input" type="email" bind:value=@signupForm.email/>
      <errors of=@signupForm.email/>
    </form>
  </div>
</page>
</program>
`, "errors");
    expect(document.querySelectorAll("[data-scrml-errors-anchor] p.scrml-error").length).toBe(1);
  });

  test("an <errorBoundary> ${…} renders its value", () => {
    compileAndMount(`type LoadError:enum = {
    NotFound(id: string)
        renders <div class="eb-nf">Item \${id} not found</>
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "") fail LoadError::NotFound(id)
    return "EB_OK_" + id
}

<page>
    <show> = true
    <div if=@show>
        <errorBoundary fallback={<div class="eb-fb">went wrong</>}>
            <span id="ebv">\${loadItem("42")}</span>
        </>
    </div>
</page>
`, "eb");
    expect(document.querySelector("#ebv").textContent.trim()).toBe("EB_OK_42");
  });

  test("a ${serverFn()} one-shot fires its call on EVERY mount, and not while unmounted", () => {
    const app = compileAndMount(`<program>
<show> = false
server function greeting() { return "SRV_OK" }
<div if=@show>
    <span id="sv">\${greeting()}</span>
</div>
</program>
`, "srv");
    // Counted as DELTAS around each transition, so the count does not pin the
    // separate, pre-existing file-scope `_scrml_fetch_greeting_N();` statement
    // the interpolation also emits at init (it fires even while the branch is
    // unmounted — a stray call, noted in the change report, not asserted here).
    const n = () => app.fetches.filter((u) => u.includes("greeting")).length;
    const atInit = n();
    app.set("show", true);
    expect(n()).toBe(atInit + 1); // pre-fix: +0 — the display never fired
    app.set("show", false);
    expect(n()).toBe(atInit + 1);
    app.set("show", true);
    expect(n()).toBe(atInit + 2);
  });
});

// ---------------------------------------------------------------------------
// Round 2 — the block's DECLARATIONS keep file scope (SPEC §7.6), only render
// work runs per mount; the outer lift target survives a nested mount; effects
// a mount creates at ANY time die with it.
// ---------------------------------------------------------------------------

describe("round 2: file scope, nested mounts, effect lifetime", () => {
  test("F1 — a const + a function declared in the if= block are file-scope: the list AND a read outside the block work", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<show> = true
<div if=@show>
    \${
        const prefix = "P-"
        function fmt(s) { return prefix + s }
        for (let it of @items) {
            lift <li>\${fmt(it)}</li>
        }
    }
</div>
<p id="out">\${fmt("z")}</p>
</program>
`, "f1-scope");
    // Round 1 wrapped the whole block in the mount function: `prefix` became
    // function-local while `fmt` stayed at chunk scope → ReferenceError at boot.
    expect(texts("div li")).toEqual(["P-a", "P-b"]);
    expect(document.querySelector("#out").textContent.trim()).toBe("P-z");
    app.set("show", false);
    app.set("show", true);
    expect(texts("div li")).toEqual(["P-a", "P-b"]);
  });

  test("F1 — a lift-free statement in a run-once block still runs once, at init, like the SSR-body twin", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<show> = false
<picked> = ""
<div if=@show>
    \${
        @picked = "init"
        for (let it of @items) { lift <li>\${it}</li> }
    }
</div>
<p id="pk">\${@picked}</p>
</program>
`, "f1-once");
    // Evaluated at module init even though the branch starts unmounted.
    expect(app.get("picked")).toBe("init");
    app.set("picked", "changed");
    app.set("show", true);
    expect(texts("div li")).toEqual(["a", "b"]);
    // …and NOT re-run by the mount.
    expect(app.get("picked")).toBe("changed");
  });

  // ⚑ RULING PENDING — see the S427 inbox question to bryan (§7.6 file scope vs
  // §6.7.2.1 memoryless remount). The two tests below pin the CURRENT, KNOWN
  // order semantics of a run-once block split (lift-free statements at module
  // init, lift statements per mount). They are NOT assertions that this order is
  // correct; update them when the ruling lands.
  test("RULING PENDING (S427 inbox → bryan): a lift-free statement reading what a lift statement wrote sees the PRE-MOUNT value", () => {
    compileAndMount(`<program>
<show> = true
<seen> = -1
<div if=@show>
    \${
        let hits = []
        for (let it of ["x", "y"]) {
            hits.push(it)
            lift <li>\${it}</li>
        }
        @seen = hits.length
    }
</div>
<p id="s">\${@seen}</p>
</program>
`, "pending-a");
    expect(texts("div li")).toEqual(["x", "y"]);
    // SSR-body twin: 2 (the loop runs first). Current mount-deferred split: 0.
    expect(document.querySelector("#s").textContent.trim()).toBe("0");
  });

  test("RULING PENDING (S427 inbox → bryan): a lift-free statement placed AFTER a lift statement runs BEFORE it on first render", () => {
    compileAndMount(`<program>
<items> = ["a", "b"]
<show> = true
<div id="g" if=@show>
    \${
        const cfg = { label: "first", n: 0 }
        for (let it of @items) { lift <li>\${cfg.label}:\${it}</li> }
        if (cfg.n == 0) { cfg.label = "second" }
    }
</div>
</program>
`, "pending-b");
    // SSR-body twin: first:a, first:b. Current mount-deferred split: second:*.
    expect(texts("#g li")).toEqual(["second:a", "second:b"]);
  });

  test("F2 — a mount triggered in the middle of another lift group does not steal that group's target (p12)", () => {
    const app = compileAndMount(`<program>
<items> = ["a", "b"]
<count> = 0
<div id="outer">
\${
    for (let it of @items) { lift <li>\${it}</li> }
    @count = @items.length
    lift <p class="after">after</p>
}
</div>
<div id="gate" if=(@count > 2)>
    \${ for (let x of @items) { lift <b>\${x}</b> } }
</div>
</program>
`, "f2-target");
    for (const next of [["a", "b", "c"], ["a"], ["a", "b", "c", "d"]]) {
      app.set("items", next);
      // Exactly one <p class="after">, and it is inside #outer.
      expect(document.querySelectorAll("p.after").length).toBe(1);
      expect(document.querySelectorAll("#outer p.after").length).toBe(1);
    }
    expect(texts("#gate b")).toEqual(["a", "b", "c", "d"]);
  });

  test("F3 — per-row effects created while mounted die with the mount; remounts do not multiply them (p4)", () => {
    const app = compileAndMount(`<program>
<items> = [{id: 1, name: "a"}, {id: 2, name: "b"}]
<show> = true
\${
    function tick(x) { window.__lm_ticks = (window.__lm_ticks || 0) + 1; return x }
}
<ul if=@show>
    \${
        for (let it of @items) {
            lift <li>\${tick(it.name)}</li>
        }
    }
</ul>
</program>
`, "f3-lifetime");
    const ticks = () => window.__lm_ticks || 0;
    app.get("items").push({ id: 3, name: "c" }); // row 3's effect is created AFTER the mount pass
    expect(texts("ul li")).toEqual(["a", "b", "c"]);
    app.set("show", false);
    const hidden0 = ticks();
    app.get("items")[0].name = "AA";
    app.get("items")[2].name = "CC";
    expect(ticks() - hidden0).toBe(0); // nothing of the dead mount renders
    app.set("show", true);
    for (let k = 0; k < 3; k++) { app.set("show", false); app.set("show", true); }
    const t0 = ticks();
    app.get("items")[2].name = "C4";
    expect(ticks() - t0).toBe(1); // exactly the live mount's one row effect
    expect(texts("ul li")).toEqual(["AA", "b", "C4"]);
  });
});
