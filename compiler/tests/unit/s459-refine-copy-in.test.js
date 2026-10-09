/**
 * S459 — refined cells store their OWN copy of everything they admit
 * (ruling: user-voice-scrml.md S459 "a, go"; SPEC §53.3.3 copy-on-admission note).
 *
 * The rows evaluate the EMITTED pruned runtime + client (no DOM: the client's boot
 * returns early without a document; cells register and write at top level), and
 * drive the cell through the runtime's own setter / path helper / proxies.
 *
 *   copy-in   a whole write, a push, an element / field write and a path write each
 *             store a copy; the source stays the caller's (N2 raw reference, N3 draft).
 *   N1        a write that throws (an invalid length) changes nothing — and drops
 *             nothing from the cell.
 *   N4        Object.defineProperty is a write (judged); an accessor is refused; a
 *             prototype change is refused; a `__proto__` key is data.
 *   one read  what is copied is what is judged: a getter is read once.
 *   ownership an element removed in place leaves the cell; the cell's own children
 *             kept by a whole write stay judged; a value an unrefined cell also
 *             stores is path-written copy-on-write (never in place in the refined cell).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(source, label) {
  const dir = resolve(tmpdir(), `scrml-s459-copyin-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "out"), log: () => {} });
  const p = resolve(dir, "out", "app.client.js");
  const js = existsSync(p) ? readFileSync(p, "utf8") : "";
  const rtName = existsSync(resolve(dir, "out")) ? readdirSync(resolve(dir, "out")).find((f) => /^scrml-runtime\..*\.js$/.test(f)) : undefined;
  const runtime = rtName ? readFileSync(resolve(dir, "out", rtName), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
  return { js, runtime, errors };
}

function load(src, label) {
  const { js, runtime, errors } = compile(src, label);
  expect(errors).toEqual([]);
  const api = new Function(`${runtime}\n${js}\n;return { state: _scrml_state, judges: _scrml_refine_judges, set: _scrml_reactive_set, deepSet: _scrml_deep_set };`)();
  const key = (cell) => Object.keys(api.state).find((k) => k === cell || k.endsWith("$" + cell));
  const plain = (cell) => JSON.parse(JSON.stringify(api.state[key(cell)]));
  return { ...api, key, plain };
}

const throwsContract = (fn) => {
  try { fn(); } catch (e) { return /^E-CONTRACT-001-RT/.test(String(e && e.message)); }
  return false;
};

// (zz / zzw: a path write, so the shipped runtime carries the path helper the rows drive)
const page = (decls) => `\${\n  type L:struct = { u: string, n: number(>0) }\n  type Q:struct = { u: string, n: number }\n  <zz> = { a: 1 }\n  function zzw() { @zz.a = 2 }\n  ${decls}\n}\n<program>\n<p>x</p>\n</program>\n`;

describe("copy-in — what a refined cell admits is its own copy", () => {
  test("a whole write stores a copy: the source array and its elements stay the caller's", () => {
    const rt = load(page(`<rows>: L[] = []`), "whole");
    const k = rt.key("rows");
    const src = [{ u: "a", n: 1 }];
    rt.set(k, src);
    src[0].n = -5;            // N2: a raw reference written after the assignment
    src.push({ u: "b", n: -6 });
    expect(rt.plain("rows")).toEqual([{ u: "a", n: 1 }]);
    expect(rt.state[k][0]).not.toBe(src[0]);
  });

  test("a push stores a copy of the pushed element (N3: editing the draft afterwards does not reach the row)", () => {
    const rt = load(page(`<rows>: L[] = []\n  <draft>: Q = { u: "d", n: 1 }`), "push");
    const k = rt.key("rows"), dk = rt.key("draft");
    rt.state[k].push(rt.state[dk]);           // @rows.push(@draft)
    rt.set(k, rt.state[k]);
    const d = rt.state[dk];
    d.n = -5;                                  // an edit the unrefined draft admits
    expect(rt.plain("rows")).toEqual([{ u: "d", n: 1 }]);
    expect(rt.plain("draft")).toEqual({ u: "d", n: -5 });
  });

  test("an element / field write and a path write store copies", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }]`), "elem");
    const k = rt.key("rows");
    const o = { u: "o", n: 2 };
    rt.state[k][0] = o;                        // element write
    o.n = -5;
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 2 }]);
    const p = { u: "p", n: 3 };
    rt.set(k, rt.deepSet(rt.state[k], [0], p)); // `@rows[0] = p`
    p.n = -5;
    expect(rt.plain("rows")).toEqual([{ u: "p", n: 3 }]);
  });

  test("@x = @y stores x's own copy; a write through either never reaches the other", () => {
    const rt = load(page(`<y>: L[] = [{ u: "y", n: 9 }]\n  <x>: L[] = []`), "xy");
    const x = rt.key("x"), y = rt.key("y");
    rt.set(x, rt.state[y]);
    rt.state[x][0].n = 2;
    expect(rt.plain("y")).toEqual([{ u: "y", n: 9 }]);
    expect(throwsContract(() => { rt.state[y][0].n = -1; })).toBe(true);
    expect(rt.plain("x")).toEqual([{ u: "y", n: 2 }]);
  });

  test("what is copied is what is judged: a getter is read once, and the stored value is plain data", () => {
    const rt = load(page(`<l>: L = { u: "a", n: 1 }`), "getter");
    const k = rt.key("l");
    let reads = 0;
    const tricky = { u: "t", get n() { reads++; return reads === 1 ? 4 : -5; } };
    rt.set(k, tricky);
    expect(reads).toBe(1);
    expect(rt.state[k].n).toBe(4);
    expect(rt.state[k].n).toBe(4);
    expect(Object.getOwnPropertyDescriptor(rt.state[k], "n").get).toBeUndefined();
  });

  test("a cyclic value is refused (a value is acyclic, §45.1); the cell keeps its value", () => {
    const rt = load(page(`type C:struct = { u: string, n: number(>0), next: asIs }\n  <l>: C = { u: "a", n: 1, next: 0 }`), "cycle");
    const k = rt.key("l");
    const c = { u: "c", n: 2, next: null };
    c.next = c;
    expect(throwsContract(() => rt.set(k, c))).toBe(true);
    expect(rt.state[k].u).toBe("a");
  });

  test("a value that reaches one object twice is stored sharing ONE copy (each source object copied once); every place stays judged", () => {
    const rt = load(page(`<rows>: L[] = []`), "dup");
    const k = rt.key("rows");
    const o = { u: "o", n: 4 };
    rt.set(k, [o, o]);
    expect(rt.state[k][0]).toBe(rt.state[k][1]);
    o.n = -1;                                               // the source is still the caller's
    rt.state[k][1].n = 7;
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 7 }, { u: "o", n: 7 }]);
    // a PATH write names one place: that place gets its own copy first (as copy-on-write did)
    rt.set(k, rt.deepSet(rt.state[k], [0, "n"], 9));
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 9 }, { u: "o", n: 7 }]);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [1, "n"], -2)))).toBe(true);
    o.n = 4;
    rt.set(k, [o, o]);
    rt.state[k].shift();                                    // one place left: still in the cell
    expect(throwsContract(() => { rt.state[k][0].n = -5; })).toBe(true);
    const e = rt.state[k][0];
    rt.state[k].pop();                                      // no place left: the caller's
    e.n = -5;
    expect(rt.plain("rows")).toEqual([]);
  });

  test("MED-2: a DAG is copied once per distinct object (linear), and a write through a shared object is judged", () => {
    const rt = load(page(`type T:struct = { n: number(>0), kids: T[] }\n  <t>: T = { n: 1, kids: [] }`), "dag");
    const k = rt.key("t");
    let c = { n: 1, kids: [] };
    for (let i = 0; i < 40; i++) c = { n: 1, kids: [c, c] };  // 2^40 paths, 41 objects
    const t0 = performance.now();
    rt.set(k, c);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(rt.state[k].kids[0]).toBe(rt.state[k].kids[1]);
    // (the struct judge of a recursive type stops one level down — a separate, pre-existing gap — so
    // the write is made at the first level, which IS described)
    expect(throwsContract(() => { rt.state[k].kids[1].n = -5; })).toBe(true);
    rt.state[k].kids[1].n = 3;
    expect(rt.state[k].kids[0].n).toBe(3);
    rt.state[k].kids.pop();                                   // one of its two places removed: still in the cell
    expect(throwsContract(() => { rt.state[k].kids[0].n = -5; })).toBe(true);
  });

  test("LOW-1: a deep ACYCLIC chain is admitted; a cycle is refused as cyclic; only absurd depth is refused as too deep", () => {
    const rt = load(page(`type T:struct = { n: number(>0), kids: T[] }\n  <t>: T = { n: 1, kids: [] }`), "deep");
    const k = rt.key("t");
    const chain = (n) => { let c = { n: 1, kids: [] }; for (let i = 0; i < n; i++) c = { n: 1, kids: [c] }; return c; };
    rt.set(k, chain(1200));
    let depth = 0, x = rt.state[k];
    while (x.kids.length) { x = x.kids[0]; depth++; }
    expect(depth).toBe(1200);
    const cyc = { n: 1, kids: [] };
    cyc.kids.push(cyc);
    expect(() => rt.set(k, cyc)).toThrow(/cyclic/);
    expect(() => rt.set(k, chain(5000))).toThrow(/nested more than/);
  });

  test("MED-1: an object of another prototype at a judged position is copied as a record of its own data — never held", () => {
    const rt = load(page(`<l>: L = { u: "a", n: 1 }\n  <rows>: L[] = []`), "proto");
    const l = rt.key("l"), rows = rt.key("rows");
    const o = Object.create({ base: 1 });
    o.u = "o"; o.n = 5;
    rt.set(l, o);
    o.n = -5;
    expect(rt.state[l].n).toBe(5);
    expect(Object.getPrototypeOf(rt.state[l])).toBe(Object.prototype);
    expect(rt.state[l].base).toBeUndefined();
    class C { constructor() { this.u = "c"; this.n = 2; } }
    const inst = new C();
    rt.state[rows].push(inst);
    inst.n = -5;
    expect(rt.plain("rows")).toEqual([{ u: "c", n: 2 }]);
    const inner = Object.setPrototypeOf({ u: "s", n: 3 }, { z: 1 });
    rt.set(rows, [inner]);
    inner.n = -5;
    expect(rt.plain("rows")).toEqual([{ u: "s", n: 3 }]);
  });
});

describe("N4 — every way to write the stored value is judged", () => {
  test("Object.defineProperty with a data value is a write; an accessor is refused", () => {
    const rt = load(page(`<l>: L = { u: "a", n: 1 }\n  <ls>: number(>0)[] = [1, 2]`), "define");
    const l = rt.key("l"), ls = rt.key("ls");
    expect(throwsContract(() => Object.defineProperty(rt.state[l], "n", { value: -5, writable: true, enumerable: true, configurable: true }))).toBe(true);
    expect(throwsContract(() => Object.defineProperty(rt.state[ls], "0", { value: -5, writable: true, enumerable: true, configurable: true }))).toBe(true);
    expect(throwsContract(() => Object.defineProperty(rt.state[l], "n", { get() { return 5; }, enumerable: true, configurable: true }))).toBe(true);
    expect(throwsContract(() => Object.defineProperty(rt.state[ls], "length", { value: 4 }))).toBe(true); // holes
    Object.defineProperty(rt.state[l], "n", { value: 6, writable: true, enumerable: true, configurable: true });
    expect(rt.plain("l")).toEqual({ u: "a", n: 6 });
    expect(rt.plain("ls")).toEqual([1, 2]);
  });

  test("a prototype change is refused; a `__proto__` key in an admitted value is data", () => {
    const rt = load(page(`<l>: L = { u: "a", n: 1 }`), "proto");
    const k = rt.key("l");
    expect(throwsContract(() => Object.setPrototypeOf(rt.state[k], { n: -5 }))).toBe(true);
    expect(throwsContract(() => { rt.state[k].__proto__ = { n: -5 }; })).toBe(true);
    rt.set(k, JSON.parse('{"u": "j", "n": 3, "__proto__": {"n": -5}}'));
    expect(Object.getPrototypeOf(rt.state[k])).toBe(Object.prototype);
    expect(rt.state[k].n).toBe(3);
  });

  test("a sort comparator sees the cell's elements as the cell hands them out (judged), never raw", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }, { u: "b", n: 2 }]`), "sort");
    const k = rt.key("rows");
    expect(throwsContract(() => rt.state[k].sort((a, b) => { a.n = -5; return 0; }))).toBe(true);
    expect(rt.plain("rows").every((r) => r.n > 0)).toBe(true);
  });

  test("no raw stored object leaks: sort / reverse return the cell's proxy; a property descriptor's value is the proxy; freezing an object in place is refused", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }, { u: "b", n: 2 }]\n  <ls>: number(>0)[] = [1, 2]`), "leaks");
    const k = rt.key("rows");
    const sorted = rt.state[k].sort((a, b) => b.n - a.n);
    expect(throwsContract(() => { sorted[0].n = -5; })).toBe(true);
    const rev = rt.state[k].reverse();
    expect(throwsContract(() => { rev[0].n = -5; })).toBe(true);
    const d = Object.getOwnPropertyDescriptor(rt.state[k], "0");
    expect(throwsContract(() => { d.value.n = -5; })).toBe(true);
    const all = Object.getOwnPropertyDescriptors(rt.state[k]);
    expect(throwsContract(() => { all["1"].value.n = -5; })).toBe(true);
    expect(throwsContract(() => Object.freeze(rt.state[k]))).toBe(true);
    expect(rt.plain("rows").every((r) => r.n > 0)).toBe(true);
    // freeze / seal / preventExtensions of any refined value are refused (later writes would fail)
    expect(throwsContract(() => Object.freeze(rt.state[k][0]))).toBe(true);
    expect(throwsContract(() => Object.seal(rt.state[rt.key("ls")]))).toBe(true);
    expect(throwsContract(() => Object.preventExtensions(rt.state[rt.key("ls")]))).toBe(true);
    rt.state[k][0].n = 6;
    rt.state[rt.key("ls")].push(3);
    expect(rt.plain("ls")).toEqual([1, 2, 3]);
  });

  test("fill / copyWithin: every changed slot gets its own judged copy", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }, { u: "b", n: 2 }, { u: "c", n: 3 }]\n  <ls>: number(>0)[] = [1, 2, 3]`), "fill");
    const k = rt.key("rows"), ls = rt.key("ls");
    const f = { u: "f", n: 4 };
    rt.state[k].fill(f, 1);
    f.n = -5;
    rt.state[k][1].n = 8;
    expect(rt.plain("rows")).toEqual([{ u: "a", n: 1 }, { u: "f", n: 8 }, { u: "f", n: 4 }]);
    rt.state[k].copyWithin(0, 1, 2);
    rt.state[k][0].n = 9;
    expect(rt.plain("rows")).toEqual([{ u: "f", n: 9 }, { u: "f", n: 8 }, { u: "f", n: 4 }]);
    expect(throwsContract(() => rt.state[k].fill({ u: "x", n: -1 }))).toBe(true);
    expect(throwsContract(() => rt.state[ls].fill(-1, 0, 1))).toBe(true);
    expect(rt.plain("ls")).toEqual([1, 2, 3]);
  });
});

describe("N1 — a write that throws changes nothing", () => {
  test("an invalid length throws its RangeError before anything changes; the elements stay in the cell", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }, { u: "b", n: 2 }]`), "len");
    const k = rt.key("rows");
    for (const bad of [1.5, "x", -1]) {
      expect(() => { rt.state[k].length = bad; }).toThrow(RangeError);
    }
    expect(rt.state[k].length).toBe(2);
    expect(throwsContract(() => { rt.state[k][1].n = -5; })).toBe(true);
    expect(throwsContract(() => { rt.state[k][0].n = -5; })).toBe(true);
  });

  test("S460 L-A: a REFUSED path write through a shared sub-object does not un-share it (identity, sharing, places unchanged)", () => {
    const rt = load(page(`<rows>: L[] = []`), "la-refused");
    const k = rt.key("rows");
    const o = { u: "o", n: 4 };
    rt.set(k, [o, o]);
    const e = rt.state[k][0];
    expect(rt.state[k][1]).toBe(e);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [0, "n"], -5)))).toBe(true);
    expect(rt.state[k][0]).toBe(e);                         // the place kept its object
    expect(rt.state[k][1]).toBe(e);                         // still shared
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 4 }, { u: "o", n: 4 }]);
    e.n = 7;                                                // a held reference reaches every place
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 7 }, { u: "o", n: 7 }]);
    // place counts unchanged: the object stays in the cell until its LAST place is removed
    rt.state[k].pop();
    expect(throwsContract(() => { e.n = -1; })).toBe(true);
    rt.state[k].pop();
    e.n = -1;                                               // no place left: the caller's
    expect(rt.plain("rows")).toEqual([]);
  });

  test("S460 L-A: a valid path write still un-shares ([9, 4]); refused nested / length / hole writes un-share nothing", () => {
    const rt = load(page(`<rows>: L[] = []`), "la-valid");
    const k = rt.key("rows");
    const o = { u: "o", n: 4 };
    rt.set(k, [o, o]);
    rt.set(k, rt.deepSet(rt.state[k], [0, "n"], 9));
    expect(rt.plain("rows")).toEqual([{ u: "o", n: 9 }, { u: "o", n: 4 }]);
    expect(rt.state[k][0]).not.toBe(rt.state[k][1]);

    const g = load(page(`<g>: L[][] = []`), "la-nested");
    const gk = g.key("g");
    const arr = [o, o];
    o.n = 4;
    g.set(gk, [arr, arr]);
    const h0 = g.state[gk][0], he = h0[0];
    expect(throwsContract(() => g.set(gk, g.deepSet(g.state[gk], [0, 1, "n"], -5)))).toBe(true);
    expect(throwsContract(() => g.set(gk, g.deepSet(g.state[gk], [0, "length"], 3)))).toBe(true);   // holes read as `not`
    expect(throwsContract(() => g.set(gk, g.deepSet(g.state[gk], [0, 5], { u: "z", n: 1 })))).toBe(true);
    expect(() => g.set(gk, g.deepSet(g.state[gk], [0, "length"], 1.5))).toThrow(RangeError);
    expect(g.state[gk][0]).toBe(h0);
    expect(g.state[gk][1]).toBe(h0);
    expect(g.state[gk][0][0]).toBe(he);
    expect(g.state[gk][0][1]).toBe(he);
    he.n = 7;
    expect(g.plain("g")).toEqual([[{ u: "o", n: 7 }, { u: "o", n: 7 }], [{ u: "o", n: 7 }, { u: "o", n: 7 }]]);
    // and the valid nested write un-shares only the place it names
    g.set(gk, g.deepSet(g.state[gk], [0, 1, "n"], 9));
    expect(g.plain("g")).toEqual([[{ u: "o", n: 7 }, { u: "o", n: 9 }], [{ u: "o", n: 7 }, { u: "o", n: 7 }]]);
    expect(throwsContract(() => { g.state[gk][1][0].n = -1; })).toBe(true);
  });
});

describe("ownership — what is in the cell is exactly what its current value holds", () => {
  test("an element removed in place is the caller's again; one still in the cell is judged", () => {
    const rt = load(page(`<rows>: L[] = []`), "removed");
    const k = rt.key("rows");
    const fresh = () => rt.set(k, [{ u: "a", n: 1 }, { u: "b", n: 2 }, { u: "c", n: 3 }]);
    const removedThenWrite = (remove, pick) => { fresh(); const r = rt.state[k][pick]; remove(); r.n = -5; return r.n; };
    expect(removedThenWrite(() => rt.state[k].shift(), 0)).toBe(-5);
    expect(removedThenWrite(() => rt.state[k].pop(), 2)).toBe(-5);
    expect(removedThenWrite(() => rt.state[k].splice(1, 1), 1)).toBe(-5);
    expect(removedThenWrite(() => { rt.state[k].length = 1; }, 2)).toBe(-5);
    expect(removedThenWrite(() => { rt.state[k][0] = { u: "q", n: 9 }; }, 0)).toBe(-5);
    fresh();
    expect(throwsContract(() => { rt.state[k].shift(); rt.state[k][0].n = -5; })).toBe(true);
  });

  test("a whole write built from the cell's own value keeps its children (judged, once each place)", () => {
    const rt = load(page(`<rows>: L[] = [{ u: "a", n: 1 }]`), "keep");
    const k = rt.key("rows");
    const old = rt.state[k];
    const first = rt.state[k][0];
    rt.set(k, [...rt.state[k], { u: "b", n: 2 }, rt.state[k][0]]);   // `@rows = [...@rows, r, @rows[0]]`
    expect(throwsContract(() => { first.n = -5; })).toBe(true);       // kept, so still the cell's
    expect(throwsContract(() => { old[0].n = -5; })).toBe(true);
    rt.state[k][2].n = 7;                                             // the second @rows[0] is its own copy
    expect(rt.plain("rows")).toEqual([{ u: "a", n: 1 }, { u: "b", n: 2 }, { u: "a", n: 7 }]);
    expect(throwsContract(() => rt.set(k, [...rt.state[k], { u: "c", n: -1 }]))).toBe(true);
    expect(throwsContract(() => { first.n = -5; })).toBe(true);       // a refused write moved nothing
    expect(rt.plain("rows").length).toBe(3);
  });

  test("a path write on a value an unrefined cell also stores is copy-on-write: the refined cell is not written", () => {
    const rt = load(page(`<ls>: number(>0)[] = [1, 2]\n  <draft>: number[] = []`), "shared");
    const ls = rt.key("ls"), draft = rt.key("draft");
    rt.set(draft, rt.state[ls]);
    rt.set(draft, rt.deepSet(rt.state[draft], [0], -5));             // `@draft[0] = -5`
    expect(rt.plain("ls")).toEqual([1, 2]);
    expect(rt.plain("draft")).toEqual([-5, 2]);
    rt.set(ls, rt.deepSet(rt.state[ls], [1], 3));                    // @ls's own path write still works (whole, copied)
    expect(rt.plain("ls")).toEqual([1, 3]);
    expect(throwsContract(() => rt.set(ls, rt.deepSet(rt.state[ls], [1], -3)))).toBe(true);
    expect(rt.plain("ls")).toEqual([1, 3]);
  });

  test("a path write into a Map inside a refined value is refused as for any cell (not written onto the Map object)", () => {
    const rt = load(page(`type C:struct = { n: number(>0), m: asIs }\n  <c>: C = { n: 1, m: 0 }`), "mapPath");
    const k = rt.key("c");
    rt.set(k, { n: 2, m: new Map([["a", 1]]) });
    expect(() => rt.set(k, rt.deepSet(rt.state[k], ["m", "a"], 5))).toThrow(TypeError);
    expect(rt.state[k].m.get("a")).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(rt.state[k].m, "a")).toBe(false);
  });

  test("a removed nested array is the caller's; its old parent's cell no longer judges it", () => {
    const rt = load(page(`<nn>: number(>0)[][] = [[1], [2]]`), "nested");
    const k = rt.key("nn");
    const a = rt.state[k][0];
    expect(throwsContract(() => a.push(-5))).toBe(true);
    rt.state[k].shift();
    a.push(-5);
    expect(rt.plain("nn")).toEqual([[2]]);
  });
});
