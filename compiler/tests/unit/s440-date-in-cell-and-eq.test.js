/**
 * s440-date-in-cell-and-eq — two impl#1 runtime bugs from the S440 JS-WAT
 * gauntlet, fixed under bryan's S440 ruling #8:
 *   "fix both impl#1 bugs now … and `date`/`timestamp` are VALUE types
 *    (immutable, structural `==` by instant), consistent with §66.10."
 *
 * BUG 1 — a Date in a reactive cell broke the page. `_scrml_deep_reactive`
 *   wrapped EVERY object in a Proxy, and a built-in's methods reject a Proxy
 *   receiver (internal slots), so `${@d}` threw inside boot and every sibling
 *   display stayed blank. Probed before the fix: Date, RegExp, Map, Set,
 *   WeakMap, WeakSet, Promise, typed arrays, ArrayBuffer, DataView, URL,
 *   URLSearchParams and Blob all THREW; Error "worked" but lost its brand
 *   (`[object Object]`). Fix: an allow-list — only arrays and plain objects
 *   are proxied.
 *
 * BUG 2 — every Date `==` every other Date. `_scrml_structural_eq` fell to its
 *   struct branch; a Date has no own enumerable keys, so the key-by-key loop
 *   compared nothing and returned true. Same for RegExp, Map, Set, URL,
 *   ArrayBuffer, DataView, Error, Promise, WeakMap, WeakSet. Fix: a rule per
 *   built-in class. §45.1: "`==` … performs structural value comparison";
 *   §45.8: "`==` SHALL perform deep structural comparison". A Date's value is
 *   its instant, so `==` compares `getTime()`.
 *
 * CHOICE (dpa-037 unruled): an invalid Date (NaN instant) follows the NaN
 *   rule — it is equal to nothing, itself included.
 *
 * The server copy of `_scrml_structural_eq` was a hand-written duplicate that
 * had drifted (no §59 map branch, no cycle guard, the same Date bug). It is
 * now sliced from the client runtime, so the §4 parity table below runs the
 * SAME cases through both copies.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME, SERVER_STRUCTURAL_EQ_SOURCE } from "../../src/runtime-template.js";
import { SERVER_STRUCTURAL_EQ_HELPER } from "../../src/codegen/emit-server.ts";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function compileToOutputs(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const read = (ext) => {
      const p = resolve(outDir, `${name}${ext}`);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: read(".client.js"),
      serverJs: read(".server.js"),
      html: read(".html"),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Compile, load the HTML + client JS into a FRESH happy-dom window, boot it,
 * and return the texts of every `span[id]` plus every error the page raised.
 * Boot runs inside a DOMContentLoaded listener, so a throw there surfaces as a
 * window "error" event, not as an exception out of dispatchEvent.
 */
async function bootPage(source, suffix) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const { errors, clientJs, html } = compileToOutputs(source, suffix);
  if (errors.length > 0) {
    throw new Error(`compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`);
  }
  const pageErrors = [];
  window.addEventListener("error", (e) => pageErrors.push(String(e.message ?? e.error)));
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(clientJs, `window.__s440_get = _scrml_reactive_get;\n`) +
    `\n})();`;
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const spans = () =>
    Object.fromEntries([...document.querySelectorAll("span[id]")].map((s) => [s.id, s.textContent]));
  return { clientJs, pageErrors, spans, get: (n) => window.__s440_get(n) };
}

/** The runtime's own helpers, evaluated once in an isolated scope. */
const RT = (() => {
  const box = {};
  // eslint-disable-next-line no-new-func
  new Function(
    "box",
    `${SCRML_RUNTIME}\nbox.deepReactive = _scrml_deep_reactive; box.eq = _scrml_structural_eq; box.effect = _scrml_effect;`,
  )(box);
  return box;
})();

/** The SERVER copy, evaluated from the exact text emit-server inlines. */
// eslint-disable-next-line no-new-func
const serverEq = new Function(`${SERVER_STRUCTURAL_EQ_HELPER}\nreturn _scrml_structural_eq;`)();

// ---------------------------------------------------------------------------
// §1 — _scrml_deep_reactive: the allow-list
// ---------------------------------------------------------------------------

// Each entry: a factory, and a use that calls the class's slot-reading methods.
const BUILTINS = {
  Date: [() => new Date(2020, 0, 1), (v) => [v.getTime(), v.toISOString(), String(v)]],
  RegExp: [() => /ab+c/gi, (v) => [v.test("xabbc"), v.source, v.flags, "abc".replace(v, "z")]],
  Map: [() => new Map([["k", 1]]), (v) => [v.get("k"), v.size, [...v]]],
  Set: [() => new Set([1, 2]), (v) => [v.has(1), v.size, [...v]]],
  WeakMap: [() => new WeakMap([[globalThis, 1]]), (v) => [v.get(globalThis)]],
  WeakSet: [() => new WeakSet([globalThis]), (v) => [v.has(globalThis)]],
  Promise: [() => Promise.resolve(7), (v) => [typeof v.then(() => 0)]],
  Uint8Array: [() => new Uint8Array([1, 2, 3]), (v) => [v[0], v.length, v.subarray(1).length]],
  Float64Array: [() => new Float64Array([1.5]), (v) => [v[0], v.length]],
  ArrayBuffer: [() => new ArrayBuffer(8), (v) => [v.byteLength, v.slice(0, 2).byteLength]],
  DataView: [() => new DataView(new ArrayBuffer(8)), (v) => [v.getInt8(0), v.byteLength]],
  Error: [() => new Error("boom"), (v) => [v.message, Object.prototype.toString.call(v)]],
  URL: [() => new URL("https://a.b/c?d=1"), (v) => [v.href, v.pathname]],
  URLSearchParams: [() => new URLSearchParams("a=1&b=2"), (v) => [v.get("a"), String(v)]],
  Blob: [() => new Blob(["x"]), (v) => [v.size]],
  ClassInstance: [
    () => new (class Point { #x = 3; get x() { return this.#x; } })(),
    (v) => [v.x],
  ],
};

describe("s440 §1 — _scrml_deep_reactive proxies only arrays and plain objects", () => {
  for (const [name, [make, use]] of Object.entries(BUILTINS)) {
    test(`${name} is returned unwrapped and its methods work`, () => {
      const raw = make();
      const out = RT.deepReactive(raw);
      expect(out).toBe(raw);
      expect(() => use(out)).not.toThrow();
    });
  }

  test("Error keeps its [object Error] brand", () => {
    expect(Object.prototype.toString.call(RT.deepReactive(new Error("x")))).toBe("[object Error]");
  });

  test("plain objects, null-prototype objects and arrays are still proxied", () => {
    const plain = { a: 1 };
    const bare = Object.assign(Object.create(null), { a: 1 });
    const arr = [1, 2];
    expect(RT.deepReactive(plain)).not.toBe(plain);
    expect(RT.deepReactive(bare)).not.toBe(bare);
    expect(RT.deepReactive(arr)).not.toBe(arr);
    expect(RT.deepReactive(plain).a).toBe(1);
    expect(RT.deepReactive(arr).map((x) => x * 2)).toEqual([2, 4]);
  });

  test("a Date nested in a proxied struct is read back raw (the lazy-wrap path)", () => {
    const d = new Date(2020, 0, 1);
    const struct = RT.deepReactive({ when: d, tags: [new Set(["a"])] });
    expect(struct.when).toBe(d);
    expect(struct.when.getFullYear()).toBe(2020);
    expect(struct.tags[0].has("a")).toBe(true);
  });

  test("fine-grained tracking on plain objects is unchanged", () => {
    const s = RT.deepReactive({ n: 1 });
    let seen = [];
    RT.effect(() => { seen.push(s.n); });
    s.n = 2;
    expect(seen).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// §2 — _scrml_structural_eq: built-in value rules (client runtime)
// ---------------------------------------------------------------------------

// [label, a, b, expected]
const EQ_CASES = () => {
  const invalid = new Date("not a date");
  const sameObj = { x: 1 };
  return [
    ["Date, different instants", new Date(2020, 0, 1), new Date(1999, 5, 5), false],
    ["Date, same instant, different objects", new Date(2020, 0, 1), new Date(2020, 0, 1), true],
    ["Date, two invalid Dates (NaN rule)", new Date("x"), new Date("y"), false],
    ["Date, the SAME invalid Date object (NaN rule)", invalid, invalid, false],
    ["Date vs plain object", new Date(0), {}, false],
    ["Date vs number of the same instant", new Date(0), 0, false],
    ["struct with Date fields, different instants", { d: new Date(1) }, { d: new Date(2) }, false],
    ["struct with Date fields, same instant", { d: new Date(1) }, { d: new Date(1) }, true],
    ["array of Dates", [new Date(1), new Date(2)], [new Date(1), new Date(3)], false],
    ["RegExp, same source + flags", /a+/g, /a+/g, true],
    ["RegExp, different source", /a/g, /b/g, false],
    ["RegExp, different flags", /a/g, /a/i, false],
    ["Map, same entries", new Map([[1, { v: 2 }]]), new Map([[1, { v: 2 }]]), true],
    ["Map, different values", new Map([[1, 2]]), new Map([[1, 3]]), false],
    ["Map, different keys", new Map([[1, 2]]), new Map([[3, 2]]), false],
    ["Map, structurally-equal object keys", new Map([[{ k: 1 }, 2]]), new Map([[{ k: 1 }, 2]]), true],
    ["Map, different sizes", new Map([[1, 2]]), new Map(), false],
    ["Set, same members", new Set([1, 2]), new Set([2, 1]), true],
    ["Set, different members", new Set([1]), new Set([2]), false],
    ["Set, structurally-equal object members", new Set([{ a: 1 }]), new Set([{ a: 1 }]), true],
    ["Set vs Map", new Set(), new Map(), false],
    ["Uint8Array, same elements", new Uint8Array([1, 2]), new Uint8Array([1, 2]), true],
    ["Uint8Array, different elements", new Uint8Array([1, 2]), new Uint8Array([1, 3]), false],
    ["Uint8Array vs Int8Array, same elements", new Uint8Array([1]), new Int8Array([1]), false],
    ["Float64Array holding NaN (NaN rule)", new Float64Array([NaN]), new Float64Array([NaN]), false],
    ["ArrayBuffer, same bytes", new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2]).buffer, true],
    ["ArrayBuffer, different bytes", new Uint8Array([1, 2]).buffer, new Uint8Array([1, 9]).buffer, false],
    ["DataView, same bytes", new DataView(new Uint8Array([4]).buffer), new DataView(new Uint8Array([4]).buffer), true],
    ["DataView, different bytes", new DataView(new Uint8Array([4]).buffer), new DataView(new Uint8Array([5]).buffer), false],
    ["URL, same href", new URL("https://a/x"), new URL("https://a/x"), true],
    ["URL, different href", new URL("https://a/"), new URL("https://b/"), false],
    ["URLSearchParams, same", new URLSearchParams("a=1"), new URLSearchParams("a=1"), true],
    ["URLSearchParams, different", new URLSearchParams("a=1"), new URLSearchParams("a=2"), false],
    ["Error, same class + message", new Error("a"), new Error("a"), true],
    ["Error, different message", new Error("a"), new Error("b"), false],
    ["Error, different class", new Error("a"), new TypeError("a"), false],
    ["Promise, two distinct", Promise.resolve(1), Promise.resolve(1), false],
    ["WeakMap, two distinct", new WeakMap(), new WeakMap(), false],
    ["WeakSet, two distinct", new WeakSet(), new WeakSet(), false],
    ["Blob, two distinct", new Blob(["x"]), new Blob(["x"]), false],
    // Pre-existing behavior that must not move.
    ["same plain object", sameObj, sameObj, true],
    ["plain structs, equal", { a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }, true],
    ["plain structs, unequal", { a: 1 }, { a: 2 }, false],
    ["enum values, same tag + payload", { _tag: "A", v: 1 }, { _tag: "A", v: 1 }, true],
    ["enum values, different tag", { _tag: "A" }, { _tag: "B" }, false],
    ["NaN number (NaN rule)", NaN, NaN, false],
    ["null vs undefined", null, undefined, false],
    [
      "§59 maps, different insertion order (order-independent, §59.9)",
      { __scrml_map: true, entries: { a: { k: "a", v: 1 }, b: { k: "b", v: 2 } }, order: ["a", "b"] },
      { __scrml_map: true, entries: { b: { k: "b", v: 2 }, a: { k: "a", v: 1 } }, order: ["b", "a"] },
      true,
    ],
  ];
};

describe("s440 §2 — _scrml_structural_eq (client runtime)", () => {
  for (const [label, a, b, want] of EQ_CASES()) {
    test(`${label} -> ${want}`, () => {
      expect(RT.eq(a, b)).toBe(want);
      expect(RT.eq(b, a)).toBe(want); // == is symmetric
    });
  }

  test("reading through a cell's proxy gives the same answers", () => {
    const a = RT.deepReactive({ d: new Date(2020, 0, 1) });
    const b = RT.deepReactive({ d: new Date(1999, 5, 5) });
    const c = RT.deepReactive({ d: new Date(2020, 0, 1) });
    expect(RT.eq(a, b)).toBe(false);
    expect(RT.eq(a, c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — the server copy is the client copy
// ---------------------------------------------------------------------------

describe("s440 §3 — the server helper is sliced from the client runtime", () => {
  test("SERVER_STRUCTURAL_EQ_HELPER carries the client function text verbatim", () => {
    expect(SERVER_STRUCTURAL_EQ_SOURCE.startsWith("function _scrml_structural_eq(a, b, seen) {")).toBe(true);
    expect(SERVER_STRUCTURAL_EQ_SOURCE.endsWith("}")).toBe(true);
    expect(SCRML_RUNTIME).toContain(SERVER_STRUCTURAL_EQ_SOURCE);
    expect(SERVER_STRUCTURAL_EQ_HELPER).toContain(SERVER_STRUCTURAL_EQ_SOURCE);
    // No slice marker leaks into emitted output.
    expect(SERVER_STRUCTURAL_EQ_HELPER).not.toContain("__SCRML_STRUCTURAL_EQ_");
  });

  test("every case gives the same answer on the server copy", () => {
    for (const [label, a, b, want] of EQ_CASES()) {
      expect([label, serverEq(a, b)]).toEqual([label, want]);
    }
  });

  test("a server fn comparing Dates inlines the helper, and the inlined text has no bare `undefined`", () => {
    const src = `<program>
\${
  server function sameDay(x, y) {
    const a = new Date(x)
    const b = new Date(y)
    return { same: a == b }
  }
  @res = { same: false }
  @res = sameDay(0, 1)
}
<div></div>
</program>`;
    const { errors, warnings, serverJs } = compileToOutputs(src, "s440-server-date");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("_scrml_structural_eq(a, b)");
    expect(serverJs).toContain("function _scrml_structural_eq(a, b, seen) {");
    expect(serverJs).toContain("return a.getTime() === b.getTime();");
    expect(warnings.filter((w) => w.code === "W-CG-UNDEFINED-INTERPOLATION")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 — end to end in happy-dom: the gauntlet reproducers
// ---------------------------------------------------------------------------

describe("s440 §4 — a Date cell renders, compares, and does not break its siblings", () => {
  test("`${@d}` renders and a sibling display still renders (b12d)", async () => {
    const page = await bootPage(
      `<program>
<a> = new Date(2020, 0, 1)
<ok> = "boot"
<div><span id="a">\${@a}</span><span id="ok">\${@ok}</span></div>
</program>
`,
      "s440-b12d",
    );
    expect(page.pageErrors).toEqual([]);
    expect(page.spans().ok).toBe("boot");
    expect(page.spans().a).toBe(String(new Date(2020, 0, 1)));
  });

  test("a Date method called through the cell works (b12c)", async () => {
    const page = await bootPage(
      `<program>
<a> = new Date(2020, 0, 1)
<y> = @a.getFullYear()
<t> = @a.getTime()
<div><span id="y">\${@y}</span><span id="t">\${@t}</span><span id="a">\${@a}</span></div>
</program>
`,
      "s440-b12c",
    );
    expect(page.pageErrors).toEqual([]);
    expect(page.spans().y).toBe("2020");
    expect(page.spans().t).toBe(String(new Date(2020, 0, 1).getTime()));
    expect(page.get("a")).toBeInstanceOf(Date);
  });

  test("two Date cells compare by instant (b12)", async () => {
    const page = await bootPage(
      `<program>
<a> = new Date(2020, 0, 1)
<b> = new Date(1999, 5, 5)
<c> = new Date(2020, 0, 1)
<eq> = @a == @b
<neq> = @a != @b
<same> = @a == @c
<div><span id="eq">\${@eq}</span><span id="neq">\${@neq}</span><span id="same">\${@same}</span></div>
</program>
`,
      "s440-b12",
    );
    expect(page.clientJs).toContain("_scrml_structural_eq(");
    expect(page.pageErrors).toEqual([]);
    expect(page.spans()).toEqual({ eq: "false", neq: "true", same: "true" });
  });

  test("two Date literals compare by instant (b12b)", async () => {
    const page = await bootPage(
      `<program>
<eq> = new Date(2020, 0, 1) == new Date(1999, 5, 5)
<div><span id="eq">\${@eq}</span></div>
</program>
`,
      "s440-b12b",
    );
    expect(page.spans().eq).toBe("false");
  });

  test("a write through a Date cell no longer throws; it mutates the value in place, untracked", async () => {
    // Dates are values (ruling #8); an in-place write is the §66.10 divergence
    // impl#1 carries. What this pins: it does not throw, the stored Date is
    // mutated, and — because the Date is no longer a Proxy — the write does
    // not notify, so the display keeps its old text until the cell is reassigned.
    const page = await bootPage(
      `<program>
<d> = new Date(2020, 0, 1)
function bump() {
    @d.setFullYear(2030)
}
function reassign() {
    @d = new Date(2031, 0, 1)
}
<div><span id="y">\${@d.getFullYear()}</span><button id="bump" onclick=bump()>b</button><button id="re" onclick=reassign()>r</button></div>
</program>
`,
      "s440-date-write",
    );
    expect(page.spans().y).toBe("2020");
    document.getElementById("bump").click();
    expect(page.pageErrors).toEqual([]);
    expect(page.get("d").getFullYear()).toBe(2030);
    expect(page.spans().y).toBe("2020");
    document.getElementById("re").click();
    expect(page.spans().y).toBe("2031");
  });
});

describe("s440 §5 — the other un-proxied classes, in a cell, in a page", () => {
  // [name, declaration RHS, a read through the cell, its expected text]
  // Typed arrays / ArrayBuffer / DataView are not in scrml's global scope
  // (E-SCOPE-001), so scrml source cannot put one in a cell directly — they
  // arrive only through JS interop; §1 covers them at the runtime level.
  // RegExp uses the constructor: a regex LITERAL as a top-level declaration
  // RHS is a separate, pre-existing parse bug (it swallows the next line).
  const CASES = [
    ["RegExp", `new RegExp("ab+c", "i")`, `@v.test("xABBC")`, "true"],
    ["Map", `new Map([["k", 41]])`, `@v.get("k") + 1`, "42"],
    ["Set", `new Set([1, 2, 3])`, `@v.has(2)`, "true"],
    ["URL", `new URL("https://example.com/p?q=1")`, `@v.pathname`, "/p"],
    ["URLSearchParams", `new URLSearchParams("a=1&b=2")`, `@v.get("b")`, "2"],
  ];
  for (const [name, rhs, read, want] of CASES) {
    test(`${name}: a method read through the cell works and a sibling still renders`, async () => {
      const page = await bootPage(
        `<program>
<v> = ${rhs}
<r> = ${read}
<ok> = "boot"
<div><span id="r">\${@r}</span><span id="ok">\${@ok}</span></div>
</program>
`,
        `s440-${name.toLowerCase()}`,
      );
      expect(page.pageErrors).toEqual([]);
      expect(page.spans()).toEqual({ r: want, ok: "boot" });
    });
  }

  test("two Map cells with different entries are not ==", async () => {
    const page = await bootPage(
      `<program>
<m1> = new Map([["k", 1]])
<m2> = new Map([["k", 2]])
<eq> = @m1 == @m2
<div><span id="eq">\${@eq}</span></div>
</program>
`,
      "s440-map-eq",
    );
    expect(page.pageErrors).toEqual([]);
    expect(page.spans().eq).toBe("false");
  });
});
