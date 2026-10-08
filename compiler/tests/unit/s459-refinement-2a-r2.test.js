/**
 * S459 refinement 2a fix round 2 — the S459 differential review findings.
 *
 *   MED-1    a refined collection write judges what it changes (a pushed element,
 *            a written element / field, a copy-on-write path update), not the
 *            whole value; the trailing set after an in-place push is not a second
 *            whole judge. Fails closed: an undescribed position (a union) judges
 *            the whole cell.
 *   LOW-4    an array held by two refined cells is judged against both, and a
 *            refused in-place change leaves it unchanged; a released alias no
 *            longer constrains it.
 *   LOW-MED-3 (see the union section) — a union member is never admitted wholesale.
 *
 * The runtime rows evaluate the EMITTED pruned runtime + client (no DOM needed:
 * the client's boot returns early without a document; cells register and write
 * at top level).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { judgeTypeOf, unjudgeableIn } from "../../src/refinement-obligations.ts";
import { judgeTypeExpr, judgeDescriptorExpr } from "../../src/codegen/emit-predicates.ts";

function compile(source, label) {
  const dir = resolve(tmpdir(), `scrml-s459-r2-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
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
  return { js, runtime, errors, all: r.errors ?? [] };
}

/** Load the emitted runtime + client; returns the store, the judges, and the runtime's setter / path helper. */
function load(js, runtime) {
  const api = new Function(`${runtime}\n${js}\n;return { state: _scrml_state, judges: _scrml_refine_judges, set: _scrml_reactive_set, deepSet: typeof _scrml_deep_set === "function" ? _scrml_deep_set : null };`)();
  const key = (cell) => Object.keys(api.judges).find((k) => k === cell || k.endsWith("$" + cell));
  return { ...api, key };
}

/** Count calls of descriptor d's ok (and, recursively, of its element / field descriptors). */
function instrument(d, counts, name) {
  const ok = d.ok;
  counts[name] = 0;
  d.ok = (v) => { counts[name]++; return ok(v); };
  if (d.el) instrument(d.el, counts, name + ".el");
  if (typeof d.fields === "function") {
    const fm = d.fields();
    for (const f of Object.keys(fm)) instrument(fm[f], counts, name + "." + f);
    d.fields = () => fm;
  }
}

const throwsContract = (fn) => {
  try { fn(); } catch (e) { return /^E-CONTRACT-001-RT/.test(String(e && e.message)); }
  return false;
};

const page = (decls) => `\${\n  type L:struct = { u: string, n: number(>0) }\n  ${decls}\n}\n<program>\n<p>x</p>\n</program>\n`;

describe("MED-1 — a refined collection write judges only what it changes", () => {
  test("the registration carries a descriptor built from the judge (element, struct fields by a hoisted parts function)", () => {
    const { js, errors } = compile(page(`<ls>: L[] = []\n  function g() {\n    const r = { u: "a", n: 1 }\n    @ls.push(r)\n  }`), "desc");
    expect(errors).toEqual([]);
    expect(js).toMatch(/_scrml_cs_refine_register\("ls", \{ ok: \(v\) => \(Array\.isArray\(v\) && _scrml_judge_each\(v, \(_scrml_el0\) => _scrml_judge_L_[a-z0-9]+\(_scrml_el0\)\)\), el: \{ ok: _scrml_judge_L_[a-z0-9]+, fields: _scrml_judge_parts_L_[a-z0-9]+ \} \}, "L\[\]", "ls"\);/);
    expect(js).toMatch(/function _scrml_judge_parts_L_[a-z0-9]+\(\) \{\n  return \{\n    n: \{ ok: \(v\) => \(typeof v === "number" && !Number\.isNaN\(v\) && \(v > 0\)\) \},\n  \};\n\}/);
    expect((js.match(/function _scrml_judge_parts_L_/g) ?? []).length).toBe(1);
  });

  test("N pushes judge N elements and never the whole array (the trailing set is not a second judge)", () => {
    const { js, runtime, errors } = compile(page(`<ls>: number(>0)[] = []`), "push");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("ls");
    const counts = {};
    instrument(rt.judges[k].d, counts, "ls");
    for (let i = 1; i <= 300; i++) {
      rt.state[k].push(i);
      rt.set(k, rt.state[k]); // what `@ls.push(i)` lowers to
    }
    expect(rt.state[k].length).toBe(300);
    expect(counts.ls).toBe(0);
    expect(counts["ls.el"]).toBe(300);
    expect(throwsContract(() => rt.state[k].push(-1))).toBe(true);
    expect(rt.state[k].length).toBe(300);
  });

  test("a field write on an element — in place, and by a copy-on-write path update — judges that field only", () => {
    const { js, runtime, errors } = compile(page(`<ls>: L[] = []\n  function w(i, v) { @ls[i].n = v }`), "field");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("ls");
    const rows = [];
    for (let i = 1; i <= 200; i++) rows.push({ u: "a", n: i });
    rt.set(k, rows); // one whole write: judged whole once
    const counts = {};
    instrument(rt.judges[k].d, counts, "ls");
    for (let i = 0; i < 200; i++) rt.set(k, rt.deepSet(rt.state[k], [i, "n"], i + 5)); // `@ls[i].n = i + 5`
    for (let i = 0; i < 200; i++) rt.state[k][i].n = i + 7; // in place, through the proxy
    expect(counts.ls).toBe(0);
    expect(counts["ls.el"]).toBe(0);
    expect(counts["ls.el.n"]).toBe(400);
    expect(rt.state[k][3].n).toBe(10);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [3, "n"], -1)))).toBe(true);
    expect(throwsContract(() => { rt.state[k][3].n = -1; })).toBe(true);
    expect(rt.state[k][3].n).toBe(10);
    // an unrefined field is not judged at all
    const before = counts["ls.el.n"];
    rt.state[k][3].u = "zz";
    rt.set(k, rt.deepSet(rt.state[k], [4, "u"], "q"));
    expect(counts["ls.el.n"]).toBe(before);
    expect(counts.ls + counts["ls.el"]).toBe(0);
    expect(rt.state[k][4].u).toBe("q");
  });

  test("fails closed: a position the descriptor does not describe (a union) re-judges the whole cell", () => {
    const { js, runtime, errors } = compile(page(`<u>: number(>0)[] | string = [1, 2]\n  function w(v) { @u[0] = v }`), "union");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("u");
    expect(rt.judges[k].d.el).toBeUndefined();
    const counts = {};
    instrument(rt.judges[k].d, counts, "u");
    rt.state[k].push(3);
    expect(counts.u).toBe(1);
    expect(throwsContract(() => rt.state[k].push(-3))).toBe(true);
    expect(throwsContract(() => rt.set(k, rt.deepSet(rt.state[k], [0], -1)))).toBe(true);
    expect(JSON.parse(JSON.stringify(rt.state[k]))).toEqual([1, 2, 3]);
  });

  test("an object held at two positions of one value is judged at both", () => {
    const { js, runtime, errors } = compile(`\${\n  type P:struct = { a: number(>0)[], b: number(>5)[] }\n  <p>: P = { a: [6], b: [8] }\n}\n<program>\n<p>x</p>\n</program>\n`, "two-pos");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("p");
    const arr = [6, 7];
    rt.set(k, { a: arr, b: arr });
    expect(throwsContract(() => rt.state[k].a.push(3))).toBe(true); // 3 > 0 for a, but not > 5 for b
    expect(JSON.parse(JSON.stringify(rt.state[k]))).toEqual({ a: [6, 7], b: [6, 7] });
    rt.state[k].a.push(9);
    expect(rt.state[k].b.length).toBe(3);
  });
});

describe("LOW-4 — an array shared by two refined cells", () => {
  const src = page(`<y>: number(>5)[] = [6, 7]\n  <x>: number(>0)[] = [1]`);

  test("a push one holder's type refuses is refused, and leaves the array unchanged", () => {
    const { js, runtime, errors } = compile(src, "shared");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const y = rt.key("y"), x = rt.key("x");
    rt.set(x, rt.state[y]); // @x = @y
    for (const via of [x, y]) {
      expect(throwsContract(() => { rt.state[via].push(3); rt.set(via, rt.state[via]); })).toBe(true);
      expect(throwsContract(() => { rt.state[via][0] = 3; })).toBe(true);
      expect(JSON.parse(JSON.stringify(rt.state[y]))).toEqual([6, 7]);
    }
    rt.state[x].push(9); // both types admit it
    expect(rt.state[y].length).toBe(3);
  });

  test("once the alias is released, the released cell's type no longer applies", () => {
    const { js, runtime } = compile(page(`<y>: number(>0)[] = [6, 7]\n  <x>: number(>5)[] = [9]`), "released");
    const rt = load(js, runtime);
    const y = rt.key("y"), x = rt.key("x");
    rt.set(x, rt.state[y]);
    expect(throwsContract(() => rt.state[y].push(3))).toBe(true); // x (> 5) still holds it
    rt.set(x, [8]);
    rt.state[y].push(3);
    expect(JSON.parse(JSON.stringify(rt.state[y]))).toEqual([6, 7, 3]);
  });
});

describe("LOW-MED-3 — a union member is never admitted wholesale", () => {
  const P = (op, value) => ({ kind: "predicated", baseType: "number", predicate: { kind: "comparison", op, value }, label: null });
  const U = (...members) => ({ kind: "union", members });

  test("date / timestamp are judged as the string-shaped primitives they are; a map / function by shape; asIs admits by meaning", () => {
    const judge = (m) => judgeTypeOf(U(P(">", 0), m));
    const date = judge({ kind: "primitive", name: "date" });
    expect(date.of[1]).toEqual({ k: "prim", baseType: "date" });
    expect(judgeTypeExpr(date, "v")).toContain(`typeof v === "string"`);
    expect(judge({ kind: "primitive", name: "timestamp" }).of[1]).toEqual({ k: "prim", baseType: "timestamp" });
    const map = judge({ kind: "map", key: { kind: "primitive", name: "string" }, value: { kind: "primitive", name: "number" }, ordered: false });
    expect(map.of[1]).toEqual({ k: "shape", shape: "map" });
    expect(judgeTypeExpr(map, "v")).toContain("v.__scrml_map === true");
    const fn = judge({ kind: "function", name: "f", params: [], returnType: { kind: "asIs" } });
    expect(judgeTypeExpr(fn, "v")).toContain(`typeof v === "function"`);
    expect(judge({ kind: "asIs", constraint: null }).of[1]).toEqual({ k: "any" });
    for (const j of [date, map, fn]) {
      expect(unjudgeableIn(j)).toBeNull();
      expect(judgeTypeExpr(j, "v")).not.toMatch(/\|\| true/);
    }
  });

  test("a member no runtime test can decide is unjudgeable, and its judge fails closed", () => {
    const refinedMap = judgeTypeOf(U(P(">", 0), { kind: "map", key: { kind: "primitive", name: "string" }, value: P(">", 0), ordered: false }));
    expect(unjudgeableIn(refinedMap)).toContain("map");
    expect(judgeTypeExpr(refinedMap, "v")).toContain("false /* §53 S458: unjudgeable predicate — refused */");
    expect(unjudgeableIn(judgeTypeOf(U(P(">", 0), { kind: "unknown" })))).toBe("an unresolved type");
    expect(unjudgeableIn(judgeTypeOf(U(P(">", 0), { kind: "html-element" })))).toContain("html-element");
  });

  test("the type stage refuses such a union at its declaration (E-CONTRACT-002); a shaped union compiles", () => {
    const bad = compile(page(`<m>: number(>0) | [string: number(>0)] = 1`), "unjudgeable");
    expect(bad.errors.map((e) => e.code)).toContain("E-CONTRACT-002");
    expect(bad.errors.find((e) => e.code === "E-CONTRACT-002").message).toContain("has no runtime test");
    const ok = compile(page(`<d>: number(>0) | date = 1\n  <a>: number(>0) | asIs = 1\n  <mp>: number(>0) | [string: number] = 1`), "shaped");
    expect(ok.errors).toEqual([]);
  });

  test("a nullable array is described as the array it is when present", () => {
    const d = judgeDescriptorExpr(judgeTypeOf(U({ kind: "array", element: P(">", 0) }, { kind: "not" })));
    expect(d).toMatch(/^\{ ok: \(v\) => \(v === null \|\| v === undefined \|\| .*\), el: \{ ok: \(v\) => .*v > 0.* \} \}$/);
  });
});

// ---------------------------------------------------------------------------
// S459 round 3
// ---------------------------------------------------------------------------

describe("r3 HIGH-1 — a copy-on-write delta is trusted only when proven, and only by the set that follows it", () => {
  const src = page(`<ls>: number(>0)[] = [1, 2]\n  <draft>: number[] = []\n  <other>: number = 0\n  function w(i, v) { @draft[i] = v }`);
  const cell = (rt, name) => Object.keys(rt.state).find((k) => k === name || k.endsWith("$" + name));

  test("an edit buffer: path-edited, then pushed in place, then committed — the commit is judged whole", () => {
    const { js, runtime, errors } = compile(src, "lp");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const ls = rt.key("ls"), draft = cell(rt, "draft");
    rt.set(draft, rt.state[ls]);                                  // @draft = @ls
    rt.set(draft, rt.deepSet(rt.state[draft], [0], 5));           // @draft[0] = 5
    rt.state[draft].push(-5);                                     // @draft.push(-5) (unrefined cell: unjudged)
    expect(throwsContract(() => rt.set(ls, rt.state[draft]))).toBe(true); // @ls = @draft
    expect(JSON.parse(JSON.stringify(rt.state[ls]))).toEqual([1, 2]);
  });

  test("a delta not set at once is discarded by the next set of ANY cell; a result changed off the path is not a path update", () => {
    const { js, runtime } = compile(src, "lp2");
    const rt = load(js, runtime);
    const ls = rt.key("ls"), other = cell(rt, "other");
    const counts = {};
    instrument(rt.judges[ls].d, counts, "ls");
    const r = rt.deepSet(rt.state[ls], [0], 7);
    rt.set(other, 1);                                             // an unrelated set consumes the fact
    rt.set(ls, r);
    expect(counts.ls).toBe(1);                                    // judged whole
    const r2 = rt.deepSet(rt.state[ls], [1], 8);
    r2.push(-1);                                                  // the result changed off the path
    expect(throwsContract(() => rt.set(ls, r2))).toBe(true);      // not proven -> judged whole -> refused
    expect(counts.ls).toBe(2);
    expect(JSON.parse(JSON.stringify(rt.state[ls]))).toEqual([7, 2]);
    rt.set(ls, rt.deepSet(rt.state[ls], [1], 9));                 // a genuine path update: judged at the path
    expect(counts.ls).toBe(2);
    expect(counts["ls.el"]).toBe(1);
    expect(JSON.parse(JSON.stringify(rt.state[ls]))).toEqual([7, 9]);
  });
});

describe("r3 MED-2 — `length` is not an element", () => {
  test("shortening is admitted (path update and in place); lengthening leaves holes, judged as `not`", () => {
    const { js, runtime, errors } = compile(page(`<rows>: L[] = []\n  <ls>: number(>0)[] = [1, 2, 3]\n  <o>: (number(>0) | not)[] = [1]\n  function w(n) { @rows.length = n }`), "len");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const rows = rt.key("rows"), ls = rt.key("ls"), o = rt.key("o");
    rt.set(rows, [{ u: "a", n: 1 }, { u: "b", n: 2 }]);
    rt.set(rows, rt.deepSet(rt.state[rows], ["length"], 1));
    expect(rt.state[rows].length).toBe(1);
    rt.set(ls, rt.deepSet(rt.state[ls], ["length"], 0));
    expect(rt.state[ls].length).toBe(0);
    rt.set(ls, [1, 2]);
    expect(throwsContract(() => rt.set(ls, rt.deepSet(rt.state[ls], ["length"], 4)))).toBe(true);
    expect(throwsContract(() => { rt.state[ls].length = 4; })).toBe(true);
    expect(throwsContract(() => rt.set(ls, [1, , 3]))).toBe(true); // a hole is `not` in a whole value too
    rt.state[ls].length = 1;
    expect(JSON.parse(JSON.stringify(rt.state[ls]))).toEqual([1]);
    rt.state[o].length = 3;                                       // `not` inhabits this element type
    expect(rt.state[o].length).toBe(3);
  });
});

describe("r3 LOW-MED-3 — an element removed in place leaves the cell", () => {
  test("shift / pop / splice / length / overwrite release it; a duplicate keeps it held", () => {
    const { js, runtime } = compile(page(`<rows>: L[] = []`), "release");
    const rt = load(js, runtime);
    const k = rt.key("rows");
    const fresh = () => rt.set(k, [{ u: "a", n: 1 }, { u: "b", n: 2 }, { u: "c", n: 3 }]);
    const removedThenWrite = (remove, pick) => { fresh(); const r = rt.state[k][pick]; remove(); r.n = -5; return r.n; };
    expect(removedThenWrite(() => rt.state[k].shift(), 0)).toBe(-5);
    expect(removedThenWrite(() => rt.state[k].pop(), 2)).toBe(-5);
    expect(removedThenWrite(() => rt.state[k].splice(1, 1), 1)).toBe(-5);
    expect(removedThenWrite(() => { rt.state[k].length = 1; }, 2)).toBe(-5);
    expect(removedThenWrite(() => { rt.state[k][0] = { u: "q", n: 9 }; }, 0)).toBe(-5);
    // still in the cell: refused
    fresh();
    expect(throwsContract(() => { rt.state[k].shift(); rt.state[k][0].n = -5; })).toBe(true);
    const dup = { u: "d", n: 4 };
    rt.set(k, [dup, dup]);
    rt.state[k].shift();
    expect(throwsContract(() => { rt.state[k][0].n = -5; })).toBe(true);
  });
});

describe("r3 LOW-4 — under debounced= the committed value stays held until the new one commits", () => {
  test("an in-place write to the still-committed value during the window is judged", () => {
    const { js, runtime, errors } = compile(page(`<rows debounced=50ms>: L[] = [{ u: "a", n: 1 }]`), "deb");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("rows");
    const e = rt.state[k][0];
    rt.set(k, [{ u: "b", n: 2 }]);                                // scheduled, not committed
    expect(rt.state[k][0].u).toBe("a");
    expect(throwsContract(() => { e.n = -5; })).toBe(true);
    expect(throwsContract(() => rt.set(k, [{ u: "c", n: -1 }]))).toBe(true); // judged when written, too
  });

  test("throttled=: the leading write commits (and is held) at once; a write inside the window is held back like a debounced one", () => {
    const { js, runtime, errors } = compile(page(`<rows throttled=1000ms>: L[] = [{ u: "a", n: 1 }]`), "thr");
    expect(errors).toEqual([]);
    const rt = load(js, runtime);
    const k = rt.key("rows");
    rt.set(k, [{ u: "b", n: 2 }]);                                // leading: committed now
    expect(rt.state[k][0].u).toBe("b");
    const e = rt.state[k][0];
    expect(throwsContract(() => { e.n = -5; })).toBe(true);
    rt.set(k, [{ u: "c", n: 3 }]);                                // inside the window: held back
    expect(rt.state[k][0].u).toBe("b");
    expect(throwsContract(() => { e.n = -5; })).toBe(true);       // the committed value is still judged
  });
});
