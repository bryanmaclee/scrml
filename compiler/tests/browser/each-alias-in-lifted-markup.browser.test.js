/**
 * each-alias-in-lifted-markup.browser.test.js —
 * g-each-alias-dropped-inside-tier0-lifted-markup (item 1 of the S427 each findings).
 *
 * `<ul>${ lift <li><each in=@items as c><b>${c}</b></each></li> }</ul>` died at
 * init with `ReferenceError: c is not defined` and took the WHOLE page script
 * with it. The lift-markup parser (`parseLiftTag`) read `as c` as two boolean
 * attributes (`as`, `c`), so the lifted each lost its alias; `as (k, v)` bailed
 * the tag parse to the string fallback (a literal `<each>` element); a nested
 * `<each>` inside the lifted body stayed generic markup (a literal `<each>`
 * whose body read an unbound alias). Where the alias name also existed in an
 * outer scope the body SILENTLY read the outer value instead.
 *
 * Every case below mounts the compiled output in happy-dom (runtime + client in
 * one scope, as the two classic <script>s run) and compares the LIFTED region to
 * its NON-LIFTED twin — the same `<each>` written as plain markup — across
 * push / splice / reverse / replace driven through COMPILED handlers (button
 * clicks), so the reactive path is the one an adopter's app takes.
 *
 * Emit-shape pins: compiler/tests/unit/each-alias-in-lifted-markup.test.js.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-each-alias-in-lifted-markup");

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
    new Function("window", "document", `${runtimeJs}\n` + captureInsideChunkScope(clientJs, ""))(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  } catch (e) {
    initError = e;
  } finally {
    console.error = origError;
  }
  expect(initError).toBeNull();
  expect(consoleErrors).toEqual([]);
  const later = [];
  console.error = (...a) => { later.push(a.map(String).join(" ")); };
  return {
    click: (id) => document.getElementById(id).click(),
    done: () => { console.error = origError; expect(later).toEqual([]); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Row text per `<li>` under a region: `["b1,b2", "b3"]`. */
function rows(id, sel = "b") {
  const r = document.getElementById(id);
  if (!r) return null;
  return [...r.querySelectorAll("li")].map((li) => [...li.querySelectorAll(sel)].map((e) => e.textContent).join(","));
}

// ---------------------------------------------------------------------------
// The brief repro
// ---------------------------------------------------------------------------

describe("the reported shape — an `as` alias in a lifted <each>", () => {
  test("renders, and the page script survives init", async () => {
    compileAndMount(`<program>
<items> = ["x", "y"]
<ul id="L">\${ lift <li><each in=@items as c><b>\${c}</b></each></li> }</ul>
<ul id="T"><li><each in=@items as c><b>\${c}</b></each></li></ul>
</program>
`, "brief");
    expect(rows("L")).toEqual(["x,y"]);
    expect(rows("L")).toEqual(rows("T"));
  });
});

// ---------------------------------------------------------------------------
// text / attribute / class: / event handler / nested <each> / keyed
// ---------------------------------------------------------------------------

const ROW = `<b class="t" title=c.n class:on=c.on onclick=pick(c)>\${c.n}<each in=c.kids as k><i>\${c.n}/\${k}</i></each></b>`;
const FULL = `<program>
<items> = [{id: 1, n: "a", on: true, kids: ["a1", "a2"]}, {id: 2, n: "b", on: false, kids: ["b1"]}]
<picked> = ""
function pick(x) { @picked = x.n }
function mkc() { return {id: 3, n: "c", on: true, kids: ["c1"]} }
function mkz() { return {id: 9, n: "z", on: false, kids: ["z1"]} }
function add() { @items.push(mkc()) }
function cut() { @items.splice(0, 1) }
function rev() { @items.reverse() }
function rep() { @items = [mkz()] }
function kid() { @items[0].kids.push("k9") }
<div id="L"><ul>\${ lift <li><each in=@items key=c.id as c>${ROW}</each></li> }</ul></div>
<div id="T"><ul><li><each in=@items key=c.id as c>${ROW}</each></li></ul></div>
<p id="picked">\${@picked}</p>
<button id="add" onclick=add()>add</button>
<button id="cut" onclick=cut()>cut</button>
<button id="rev" onclick=rev()>rev</button>
<button id="rep" onclick=rep()>rep</button>
<button id="kid" onclick=kid()>kid</button>
</program>
`;

function snapshot(id) {
  return [...document.getElementById(id).querySelectorAll("b.t")].map((b) =>
    `${b.getAttribute("title")}|${b.classList.contains("on") ? "on" : "off"}|${[...b.querySelectorAll("i")].map((i) => i.textContent).join(",")}`,
  );
}

describe("keyed lifted each — text, attribute, class:, handler and a nested each all see the alias", () => {
  test("init matches the non-lifted twin", () => {
    const app = compileAndMount(FULL, "full-init");
    expect(snapshot("L")).toEqual(["a|on|a/a1,a/a2", "b|off|b/b1"]);
    expect(snapshot("L")).toEqual(snapshot("T"));
    app.done();
  });

  test("the per-row handler receives the row's aliased item", async () => {
    const app = compileAndMount(FULL, "full-click");
    document.querySelectorAll("#L b.t")[1].click();
    await flush();
    expect(document.getElementById("picked").textContent).toBe("b");
    app.done();
  });

  test("push / splice / reverse / replace through compiled handlers track the twin", async () => {
    const app = compileAndMount(FULL, "full-mutate");
    const expected = {
      add: ["a|on|a/a1,a/a2", "b|off|b/b1", "c|on|c/c1"],
      cut: ["b|off|b/b1", "c|on|c/c1"],
      rev: ["c|on|c/c1", "b|off|b/b1"],
      kid: ["c|on|c/c1,c/k9", "b|off|b/b1"],
      rep: ["z|off|z/z1"],
    };
    for (const [btn, want] of Object.entries(expected)) {
      app.click(btn);
      await flush();
      expect(snapshot("L")).toEqual(want);
      expect(snapshot("L")).toEqual(snapshot("T"));
    }
    // The handler still binds the live row after a replace.
    document.querySelector("#L b.t").click();
    await flush();
    expect(document.getElementById("picked").textContent).toBe("z");
    app.done();
  });
});

describe("a nested <each> under an element in a lifted each row (the `@.` form too)", () => {
  test("renders the inner list — not a literal <each> element reading the outer row", async () => {
    const app = compileAndMount(`<program>
<items> = [{id: 1, kids: ["a1", "a2"]}, {id: 2, kids: ["b1"]}]
function kid() { @items[1].kids.push("b2") }
<ul id="L">\${ lift <li><each in=@items><b><each in=@.kids><i>\${@.}</i></each></b></each></li> }</ul>
<ul id="T"><li><each in=@items><b><each in=@.kids><i>\${@.}</i></each></b></each></li></ul>
<button id="kid" onclick=kid()>k</button>
</program>
`, "nested-sigil");
    expect(document.querySelectorAll("#L each").length).toBe(0);
    expect(rows("L", "i")).toEqual(["a1,a2,b1"]);
    expect(rows("L", "i")).toEqual(rows("T", "i"));
    app.click("kid");
    await flush();
    expect(rows("L", "i")).toEqual(["a1,a2,b1,b2"]);
    expect(rows("L", "i")).toEqual(rows("T", "i"));
    app.done();
  });
});

// ---------------------------------------------------------------------------
// `as (k, v)` — §59.8 positional destructure
// ---------------------------------------------------------------------------

describe("`as (k, v)` in a lifted each", () => {
  test("binds both names, and stays live on push / reverse", async () => {
    const app = compileAndMount(`<program>
type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 1 }, { key: "HOU", value: 2 }]
function mkp() { return { key: "AUS", value: 3 } }
function addp() { @pairs.push(mkp()) }
function revp() { @pairs.reverse() }
<div id="L"><ul>\${ lift <li><each in=@pairs as (k, v)><b>\${k}=\${v}</b></each></li> }</ul></div>
<div id="T"><ul><li><each in=@pairs as (k, v)><b>\${k}=\${v}</b></each></li></ul></div>
<button id="addp" onclick=addp()>a</button>
<button id="revp" onclick=revp()>r</button>
</program>
`, "tuple");
    expect(rows("L")).toEqual(["DAL=1,HOU=2"]);
    expect(rows("L")).toEqual(rows("T"));
    app.click("addp");
    await flush();
    expect(rows("L")).toEqual(["DAL=1,HOU=2,AUS=3"]);
    expect(rows("L")).toEqual(rows("T"));
    app.click("revp");
    await flush();
    expect(rows("L")).toEqual(["AUS=3,HOU=2,DAL=1"]);
    expect(rows("L")).toEqual(rows("T"));
    app.done();
  });
});

// ---------------------------------------------------------------------------
// hosts: a `for` body, an `if=` host, a match arm; shadowing
// ---------------------------------------------------------------------------

const HOSTS = `<program>
<rows> = [{id: 1, cells: ["r1a", "r1b"]}, {id: 2, cells: ["r2a"]}]
<show> = true
function mkr() { return {id: 3, cells: ["r3a"]} }
function addr() { @rows.push(mkr()) }
function cutr() { @rows.splice(0, 1) }
function revr() { @rows.reverse() }
function tog() { @show = !@show }
<div id="L1"><ul>\${ for (let row of @rows) { lift <li><each in=row.cells as c><b>\${row.id}:\${c}</b></each></li> } }</ul></div>
<div id="T1"><ul><each in=@rows as row><li><each in=row.cells as c><b>\${row.id}:\${c}</b></each></li></each></ul></div>
<div id="L2" if=@show><ul>\${ lift <li><each in=@rows key=c.id as c><b>\${c.id}</b></each></li> }</ul></div>
<div id="T2" if=@show><ul><li><each in=@rows key=c.id as c><b>\${c.id}</b></each></li></ul></div>
<div id="L3"><ul>\${ for (let c of @rows) { lift <li><each in=c.cells as c><b>\${c}</b></each></li> } }</ul></div>
<div id="T3"><ul><each in=@rows as c><li><each in=c.cells as c><b>\${c}</b></each></li></each></ul></div>
<button id="addr" onclick=addr()>a</button>
<button id="cutr" onclick=cutr()>c</button>
<button id="revr" onclick=revr()>r</button>
<button id="tog" onclick=tog()>t</button>
</program>
`;

describe("lifted each in a `for` body, an `if=` host, and with an alias shadowing the loop var", () => {
  test("every region tracks its non-lifted twin across push / splice / reverse and an if= toggle", async () => {
    const app = compileAndMount(HOSTS, "hosts");
    const same = () => { for (const n of ["1", "2", "3"]) expect(rows("L" + n)).toEqual(rows("T" + n)); };
    expect(rows("L1")).toEqual(["1:r1a,1:r1b", "2:r2a"]);
    expect(rows("L2")).toEqual(["1,2"]);
    // The inner alias `c` shadows the loop's own `c` (innermost scope wins).
    expect(rows("L3")).toEqual(["r1a,r1b", "r2a"]);
    same();
    app.click("addr"); await flush();
    expect(rows("L1")).toEqual(["1:r1a,1:r1b", "2:r2a", "3:r3a"]);
    same();
    app.click("cutr"); await flush();
    expect(rows("L2")).toEqual(["2,3"]);
    same();
    app.click("revr"); await flush();
    expect(rows("L3")).toEqual(["r3a", "r2a"]);
    same();
    app.click("tog"); await flush();
    expect(rows("L2")).toBeNull();
    same();
    app.click("tog"); await flush();
    expect(rows("L2")).toEqual(["3,2"]);
    same();
    app.done();
  });
});

describe("lifted each in a match arm, with an alias shadowing a file-level const", () => {
  test("the alias wins over the outer name — the row never reads the outer value", async () => {
    const app = compileAndMount(`<program>
\${
    type LoadPhase:enum = { NotAsked, Ready(rows: string[]) }
    const c = "OUTER"
}
<phase>: LoadPhase = .Ready(["a", "b"])
<items> = ["x", "y"]
function go() { @phase = .NotAsked }
function back() { @phase = .Ready(["p"]) }
function addi() { @items.push(@items.length) }
<div id="L"><match for=LoadPhase on=@phase>
    <NotAsked><p>none</p></>
    <Ready(rows)><ul>\${ lift <li><each in=rows as c><b>\${c}</b></each><each in=@items as c><i>\${c}</i></each></li> }</ul></>
</></div>
<div id="T"><match for=LoadPhase on=@phase>
    <NotAsked><p>none</p></>
    <Ready(rows)><ul><li><each in=rows as c><b>\${c}</b></each><each in=@items as c><i>\${c}</i></each></li></ul></>
</></div>
<p id="o">\${c}</p>
<button id="go" onclick=go()>g</button>
<button id="back" onclick=back()>b</button>
<button id="addi" onclick=addi()>i</button>
</program>
`, "arm");
    const view = (id) => [...document.getElementById(id).querySelectorAll("b, i, p")].map((e) => `${e.tagName}:${e.textContent}`);
    expect(view("L")).toEqual(["B:a", "B:b", "I:x", "I:y"]);
    expect(view("L")).toEqual(view("T"));
    app.click("addi"); await flush();
    expect(view("L")).toEqual(["B:a", "B:b", "I:x", "I:y", "I:2"]);
    expect(view("L")).toEqual(view("T"));
    app.click("go"); await flush();
    expect(view("L")).toEqual(["P:none"]);
    expect(view("L")).toEqual(view("T"));
    app.click("back"); await flush();
    expect(view("L")).toEqual(["B:p", "I:x", "I:y", "I:2"]);
    expect(view("L")).toEqual(view("T"));
    // The outer const is untouched by the alias.
    expect(document.getElementById("o").textContent).toBe("OUTER");
    app.done();
  });
});
