/**
 * scrml:time debounce / throttle — S464 "(a) Struct + free fns".
 *
 * A Debouncer / Throttler is DATA ({ id, delay } / { id, limit }); no value holds a function
 * (§14.3 E-VALUE-FUNCTION-STORED), so the timed function is passed once and driven by the free
 * functions run / cancel / flush. Executed against the runtime shim
 * (compiler/runtime/stdlib/time.js), and the scrml surface is compiled.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { debounce, throttle, run, cancel, flush } from "../../runtime/stdlib/time.js";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("scrml:time debounce — a Debouncer struct driven by run / cancel / flush", () => {
  test("debounce returns plain data (no function anywhere in it)", () => {
    const d = debounce(() => 0, 10);
    expect(Object.keys(d).sort()).toEqual(["delay", "id"]);
    expect(Object.values(d).some((v) => typeof v === "function")).toBe(false);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  test("run coalesces: one call, with the LAST arguments, after the delay", async () => {
    const seen = [];
    const d = debounce((x) => seen.push(x), 15);
    run(d, 1); run(d, 2); run(d, 3);
    expect(seen).toEqual([]);
    await wait(40);
    expect(seen).toEqual([3]);
  });

  test("cancel drops the pending call; flush runs it now", async () => {
    const seen = [];
    const d = debounce((x) => seen.push(x), 15);
    run(d, "a"); cancel(d);
    await wait(40);
    expect(seen).toEqual([]);
    run(d, "b"); flush(d);
    expect(seen).toEqual(["b"]);
    await wait(40);
    expect(seen).toEqual(["b"]);
    flush(d); // nothing pending → nothing runs
    expect(seen).toEqual(["b"]);
  });

  test("two debouncers keep separate state", async () => {
    const seen = [];
    const a = debounce((x) => seen.push("a" + x), 10);
    const b = debounce((x) => seen.push("b" + x), 10);
    expect(a.id).not.toBe(b.id);
    run(a, 1); run(b, 2);
    await wait(30);
    expect(seen.sort()).toEqual(["a1", "b2"]);
  });
});

describe("scrml:time — state is keyed by the struct's identity (S464 round 3)", () => {
  test("a hand-built or copied struct drives nothing (unforgeable)", async () => {
    const seen = [];
    const a = debounce((x) => seen.push("a" + x), 10);
    run({ id: a.id, delay: 0 }, "forged");
    run({ ...a }, "copy");
    await wait(30);
    expect(seen).toEqual([]);
    run(a, "real");
    await wait(30);
    expect(seen).toEqual(["areal"]);
  });

  test("the struct's own delay is the wait run uses", async () => {
    const seen = [];
    const fast = debounce((x) => seen.push(x), 5);
    const slow = debounce((x) => seen.push(x), 60);
    run(slow, "slow"); run(fast, "fast");
    await wait(30);
    expect(seen).toEqual(["fast"]);
    await wait(60);
    expect(seen).toEqual(["fast", "slow"]);
  });

  test("a dropped debouncer is collectable (no table entry outlives its struct)", async () => {
    if (typeof Bun === "undefined" || typeof Bun.gc !== "function") return;
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 500; i++) { const big = new Array(10000).fill(i); debounce(() => big.length, 10); }
    Bun.gc(true);
    const grownMB = (process.memoryUsage().heapUsed - before) / 1e6;
    expect(grownMB).toBeLessThan(10); // 500 × ~80 KB = ~40 MB if the table kept them
  });
});

describe("scrml:time throttle — a Throttler struct", () => {
  test("leading call at once, the last call inside the window runs at its end", async () => {
    const seen = [];
    const t = throttle((x) => seen.push(x), 20);
    expect(Object.keys(t).sort()).toEqual(["id", "limit"]);
    run(t, 1); run(t, 2); run(t, 3);
    expect(seen).toEqual([1]);
    await wait(45);
    expect(seen).toEqual([1, 3]);
  });

  test("cancel drops the trailing call and reopens the window", async () => {
    const seen = [];
    const t = throttle((x) => seen.push(x), 20);
    run(t, 1); run(t, 2); cancel(t);
    await wait(45);
    expect(seen).toEqual([1]);
    run(t, 4);
    expect(seen).toEqual([1, 4]);
  });
});

describe("scrml:time debounce / throttle — the scrml surface compiles (no stored function)", () => {
  let TMP;
  beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "time-struct-")); });
  afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });
  test("a Debouncer kept in a cell or a field is data", () => {
    const fp = join(TMP, "app.scrml");
    writeFileSync(fp, `\${\n  import { debounce, throttle, run, cancel } from 'scrml:time'\n  function search(q) { return q }\n  const searchLater = debounce((q) => search(q), 300)\n  const handlers = { search: debounce(search, 300), scroll: throttle(search, 16) }\n}\n<q> = ""\n<program><input oninput=\${ run(searchLater, @q) }/><button onclick=\${ cancel(searchLater) }>c</button></>\n`);
    const res = compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
    const all = [...(res.errors || []), ...(res.warnings || [])];
    expect(all.filter((d) => d.code === "E-VALUE-FUNCTION-STORED")).toEqual([]);
  });
});

// S464 round 4 (R1): a Debouncer held inside a STATE CELL's object / array is read back through the
// client runtime's deep-reactive wrapper. The struct is built on its own prototype, which that
// wrapper leaves unwrapped, so the identity-keyed timer table still finds it. EXECUTED in happy-dom
// against the emitted runtime + client bundle.
describe("scrml:time — a Debouncer inside a state cell's field / element still drives (executed)", () => {
  let TMP;
  beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "time-cell-")); });
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    if (TMP) rmSync(TMP, { recursive: true, force: true });
  });

  test("field, array element, pushed element, nested field — and `==` holds", async () => {
    const fp = join(TMP, "c2.scrml");
    const out = join(TMP, "out");
    writeFileSync(fp, `\${
  import { debounce, run } from 'scrml:time'
  function search(q) { @hits = @hits + 1; @last = q }
}
<hits> = 0
<last> = ""
<s> = { search: debounce(search, 20), n: 0, deep: { d: debounce(search, 20) } }
<list> = [debounce(search, 20)]
<program><input id="i" oninput=\${ (e) => { @s.n = @s.n + 1; run(@s.search, e.target.value) } }/><button id="c" onclick=\${ run(@list[0], "arr") }>c</button><button id="f" onclick=\${ @list.push(debounce(search, 20)) }>f</button><button id="t" onclick=\${ run(@list[1], "pushed") }>t</button><button id="n" onclick=\${ run(@s.deep.d, "nested") }>n</button><p id="h">\${@hits}</p><p id="l">\${@last}</p><p id="eq">\${ @list[0] == @list[0] } \${ @list[0] == @s.search }</p></>
`);
    const res = compileScrml({ inputFiles: [fp], outputDir: out, write: true, log: () => {} });
    expect((res.errors || []).map((e) => e.code)).toEqual([]);
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    const html = readFileSync(join(out, "c2.html"), "utf8");
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const rt = readdirSync(out).find((f) => f.startsWith("scrml-runtime"));
    // eslint-disable-next-line no-eval
    (0, eval)(readFileSync(join(out, rt), "utf8") + "\n" + readFileSync(join(out, "c2.client.js"), "utf8"));
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    const $ = (s) => document.querySelector(s);
    const fire = (sel, type, val) => { const el = $(sel); if (val !== undefined) el.value = val; el.dispatchEvent(new Event(type, { bubbles: true })); };
    const state = () => `${$("#h").textContent}:${$("#l").textContent}`;

    fire("#i", "input", "a"); fire("#i", "input", "ab");
    await wait(60);
    expect(state()).toBe("1:ab");          // a field of a cell's object
    fire("#c", "click");
    await wait(60);
    expect(state()).toBe("2:arr");         // an element of a cell's array
    fire("#f", "click"); fire("#t", "click");
    await wait(60);
    expect(state()).toBe("3:pushed");      // an element pushed later
    fire("#n", "click");
    await wait(60);
    expect(state()).toBe("4:nested");      // a nested field
    expect($("#eq").textContent.trim()).toBe("true false"); // == : same struct equal, distinct debouncers not
  });
});

// S466 (gap g-timer-struct-field-write-from-function-body-throws-s464). §41.21: "The struct's
// `delay` / `limit` IS the wait `run` uses" and its fields read "as any struct". A field write
// (`@d.delay = 10`) from a FUNCTION BODY lowered to `_scrml_deep_set`, whose copy step refused every
// non-plain prototype — it threw, advising "Assign the whole cell", and a whole-cell copy is a DEAD
// timer (the state is keyed by identity). The same write in an attribute handler mutated in place.
// Now the timer struct (branded on its prototype by scrml:time) is written IN PLACE on both paths.
const RT = (() => {
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function("box", `${SCRML_RUNTIME}\nbox.deepSet = _scrml_deep_set;`)(box);
  return box;
})();

describe("scrml:time — _scrml_deep_set writes a timer struct IN PLACE (runtime)", () => {
  test("a top-level field write keeps the struct's identity, and run uses the new wait", async () => {
    const seen = [];
    const d = debounce((x) => seen.push(x), 60);
    const out = RT.deepSet(d, ["delay"], 5);
    expect(out).toBe(d);
    expect(d.delay).toBe(5);
    expect(Object.keys(d).sort()).toEqual(["delay", "id"]); // the brand is not a field
    run(out, "live");
    await wait(30);
    expect(seen).toEqual(["live"]);
  });

  test("a nested write copies the plain containers and reaches the same timer", async () => {
    const seen = [];
    const t = throttle((x) => seen.push(x), 60);
    const s = { a: { b: t }, n: 0 };
    const out = RT.deepSet(s, ["a", "b", "limit"], 5);
    expect(out).not.toBe(s);
    expect(out.a).not.toBe(s.a);
    expect(out.a.b).toBe(t);
    expect(t.limit).toBe(5);
    run(t, 1); run(t, 2);
    await wait(30);
    expect(seen).toEqual([1, 2]); // the trailing call ran after the NEW 5 ms window
  });

  test("a non-timer object of its own prototype is still refused (brand, not field names)", () => {
    const lookalike = Object.assign(Object.create(Object.create(Object.prototype)), { id: 1, delay: 5 });
    expect(() => RT.deepSet(lookalike, ["delay"], 9)).toThrow("cannot write .delay of a Object in place");
    const otherBrand = Object.create(Object.prototype);
    Object.defineProperty(otherBrand, Symbol.for("scrml:time.other"), { value: true });
    expect(() => RT.deepSet(Object.create(otherBrand), ["x"], 1)).toThrow("in place");
    expect(() => RT.deepSet({ when: new Date(0) }, ["when", "x"], 1)).toThrow("of a Date in place");
  });

  test("a plain struct still copies on write exactly as before", () => {
    const s = { a: { b: 1 } };
    const out = RT.deepSet(s, ["a", "b"], 2);
    expect(out).toEqual({ a: { b: 2 } });
    expect(s.a.b).toBe(1);
  });
});

describe("scrml:time — a timer field write from a function body and from a handler agree (executed)", () => {
  let TMP;
  beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "time-write-")); });
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    if (TMP) rmSync(TMP, { recursive: true, force: true });
  });

  test("@d.delay / @s.a.b.delay = 10 changes the live wait on both paths; plain struct unchanged", async () => {
    const fp = join(TMP, "w.scrml");
    const out = join(TMP, "out");
    writeFileSync(fp, `\${
  import { debounce, run, Debouncer } from 'scrml:time'
  function search(q) { @hits = @hits + 1; @last = q }
  function setD() { @d.delay = 10 }
  function setS() { @s.a.b.delay = 10 }
  function setP() { @p.x = 7 }
}
type Pt:struct = { x: number, y: number }
<hits> = 0
<last> = ""
<d>: Debouncer = debounce(search, 200)
<e> = debounce(search, 200)
<s> = { a: { b: debounce(search, 200) }, n: 0 }
<u> = { a: { b: debounce(search, 200) } }
<p>: Pt = { x: 1, y: 2 }
<program>
<button id="fd" onclick=\${ setD() }>a</button>
<button id="fs" onclick=\${ setS() }>a</button>
<button id="he" onclick=\${ @e.delay = 10 }>a</button>
<button id="hu" onclick=\${ @u.a.b.delay = 10 }>a</button>
<button id="fp" onclick=\${ setP() }>a</button>
<button id="rd" onclick=\${ run(@d, "d") }>a</button>
<button id="re" onclick=\${ run(@e, "e") }>a</button>
<button id="rs" onclick=\${ run(@s.a.b, "s") }>a</button>
<button id="ru" onclick=\${ run(@u.a.b, "u") }>a</button>
<p id="dd">\${@d.delay}</p><p id="ed">\${@e.delay}</p><p id="sd">\${@s.a.b.delay}</p><p id="ud">\${@u.a.b.delay}</p><p id="px">\${@p.x}:\${@p.y}</p>
<p id="h">\${@hits}</p><p id="l">\${@last}</p>
</>
`);
    const res = compileScrml({ inputFiles: [fp], outputDir: out, write: true, log: () => {} });
    expect((res.errors || []).map((e) => e.code)).toEqual([]);
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    const errs = [];
    window.addEventListener("error", (e) => errs.push(String(e.error || e.message)));
    const html = readFileSync(join(out, "w.html"), "utf8");
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const rt = readdirSync(out).find((f) => f.startsWith("scrml-runtime"));
    // eslint-disable-next-line no-eval
    (0, eval)(readFileSync(join(out, rt), "utf8") + "\n" + readFileSync(join(out, "w.client.js"), "utf8"));
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    const $ = (s) => document.querySelector(s);
    const fire = (sel) => {
      try { $(sel).dispatchEvent(new Event("click", { bubbles: true })); } catch (e) { errs.push(String(e)); }
    };
    const text = (s) => $(s).textContent;
    const state = () => `${text("#h")}:${text("#l")}`;

    // function body — top-level field of a typed cell, then nested field
    fire("#fd");
    expect(text("#dd")).toBe("10");
    fire("#rd");
    await wait(60);
    expect(state()).toBe("1:d");
    fire("#fs");
    expect(text("#sd")).toBe("10");
    fire("#rs");
    await wait(60);
    expect(state()).toBe("2:s");

    // attribute handler — the same writes, the same outcome
    fire("#he");
    expect(text("#ed")).toBe("10");
    fire("#re");
    await wait(60);
    expect(state()).toBe("3:e");
    fire("#hu");
    expect(text("#ud")).toBe("10");
    fire("#ru");
    await wait(60);
    expect(state()).toBe("4:u");

    // a plain struct field write from a function body still works as before
    fire("#fp");
    expect(text("#px")).toBe("7:2");
    expect(errs).toEqual([]);
  });
});
